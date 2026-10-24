// Import screen: local folders, playlists from streaming services (via exported files), and
// your own Subsonic-compatible server (Navidrome, Airsonic, Gonic ...).
import { h, plural, pickFile, fmtTime } from './util.js';
import { ic } from './icons.js';
import { api, isDesktop } from './bridge.js';
import { S, on, setSetting, addTracks, createPlaylist, removeSourceTracks, emit } from './state.js';
import { registerRoute, refresh, navigate } from './router.js';
import { addFolder, addFiles, rescanFolders } from './actions.js';
import { section, modal, toast, confirmBox } from './ui.js';
import { parsePlaylistFile, decodeText, buildMatcher } from './importers.js';

const PLAYLIST_EXT = /\.(csv|tsv|txt|json|m3u8?|pls|xspf)$/i;
export const isPlaylistFile = (f) => PLAYLIST_EXT.test(f.name);

const SERVICES = [
  { id: 'Spotify', tip: 'Export a playlist to CSV with a tool such as Exportify, or use Playlist JSON files from Spotify’s account data download.' },
  { id: 'Apple Music', tip: 'In the Music app choose File › Library › Export Playlist… and save it as text or M3U.' },
  { id: 'YouTube Music', tip: 'Use a transfer tool such as TuneMyMusic or Soundiiz to export a playlist file.' },
  { id: 'Tidal', tip: 'Use a transfer tool such as TuneMyMusic or Soundiiz to export a playlist file.' },
  { id: 'Deezer', tip: 'Use a transfer tool such as TuneMyMusic or Soundiiz to export a playlist file.' },
  { id: 'Amazon Music', tip: 'Use a transfer tool such as TuneMyMusic or Soundiiz to export a playlist file.' },
];

// ---------- playlist file import ----------
export async function importPlaylistFiles(files, service = 'file') {
  const lists = [];
  for (const f of files) {
    try {
      const text = decodeText(await f.arrayBuffer());
      lists.push(...parsePlaylistFile(f.name, text));
    } catch { /* unreadable file */ }
  }
  if (!lists.length) { toast('No playlist found in that file. CSV, JSON, M3U, PLS and XSPF are supported.', { kind: 'error', timeout: 5000 }); return; }
  const match = buildMatcher(S.tracks);
  const prepared = lists.map((l) => {
    const items = l.entries.map((e) => { const t = match(e); return t ? { t: t.id } : { m: e }; });
    return { name: l.name, items, matched: items.filter((i) => i.t).length, total: items.length, include: true };
  });
  const rows = prepared.map((p) => {
    const cb = h('input', { type: 'checkbox', checked: true, onChange: () => { p.include = cb.checked; } });
    const name = h('input', { class: 'input', value: p.name, 'aria-label': 'Playlist name', onInput: () => { p.name = name.value; } });
    return h('div', { class: 'imp-row' }, cb, name, h('span', { class: 'chip' + (p.matched === p.total ? ' ok' : '') }, `${p.matched}/${p.total} matched`));
  });
  const totalMissing = prepared.reduce((a, p) => a + p.total - p.matched, 0);
  const body = [
    h('p', { class: 'muted' }, S.tracks.length
      ? `Entries are matched to tracks already in your library by title and artist. ${totalMissing ? `${plural(totalMissing, 'entry', 'entries')} will be kept as placeholders — add the music later and use “Re-match”.` : 'Everything matched.'}`
      : 'Your library is empty, so every entry will be kept as a placeholder until you add the matching music.'),
    h('div', { class: 'imp-list' }, rows),
  ];
  const ok = await modal({ title: `Import ${plural(prepared.length, 'playlist')}`, width: 520, body, actions: [{ label: 'Cancel', value: false }, { label: 'Import', primary: true, value: true }] });
  if (!ok) return;
  const chosen = prepared.filter((p) => p.include && p.items.length);
  chosen.forEach((p) => createPlaylist(p.name || 'Imported playlist', p.items, { source: service }));
  if (chosen.length) { toast(`Imported ${plural(chosen.length, 'playlist')}`, { kind: 'ok' }); if (chosen.length === 1) navigate('playlist', S.playlists[S.playlists.length - 1].id); }
}

async function chooseFiles(service) {
  const files = await pickFile('.csv,.tsv,.txt,.json,.m3u,.m3u8,.pls,.xspf', true);
  if (files.length) await importPlaylistFiles(files, service);
}

// ---------- server section ----------
function serverSection() {
  const wrap = h('div', { class: 'servers' });
  let sources = S.sources;

  const draw = () => {
    wrap.replaceChildren();
    if (!isDesktop) {
      wrap.append(h('p', { class: 'muted' }, 'Connecting to a streaming server is available in the desktop app.'));
      return;
    }
    if (sources.length) {
      wrap.append(h('div', { class: 'server-list' }, sources.map((s) => {
        const status = h('span', { class: 'muted small' }, `${plural(s.count, 'track')}${s.lastSync ? ' · synced ' + new Date(s.lastSync).toLocaleDateString() : ' · not synced yet'}`);
        const syncBtn = h('button', { class: 'btn small', onClick: () => sync(s, status, syncBtn) }, ic('refresh', 14), 'Sync');
        return h('div', { class: 'server' },
          h('span', { class: 'tile-ic' }, ic('server', 18)),
          h('div', { class: 'server-info' }, h('div', { class: 'strong' }, s.name), h('div', { class: 'muted small' }, `${s.user} @ ${s.url}`), status),
          h('div', { class: 'server-actions' },
            syncBtn,
            h('button', { class: 'btn small', onClick: () => importServerPlaylists(s) }, 'Playlists…'),
            h('button', { class: 'btn small danger', onClick: async () => {
              if (await confirmBox('Remove server?', `“${s.name}” and its ${plural(s.count, 'track')} will be removed from Cadence. Nothing on the server changes.`, { danger: true, confirm: 'Remove' })) {
                removeSourceTracks(s.id); await api.sub.remove(s.id); S.sources = sources = sources.filter((x) => x.id !== s.id); draw();
              }
            } }, ic('trash', 14))));
      })));
    }
    const f = { name: '', url: '', user: '', password: '' };
    const err = h('div', { class: 'form-error', role: 'alert', hidden: true });
    const field = (label, key, type = 'text', ph = '') => h('label', { class: 'field' }, h('span', {}, label),
      h('input', { class: 'input', type, placeholder: ph, autocomplete: 'off', spellcheck: 'false', onInput: (e) => { f[key] = e.target.value; } }));
    const btn = h('button', { class: 'btn primary', onClick: async () => {
      err.hidden = true;
      if (!f.url || !f.user || !f.password) { err.textContent = 'Server address, username and password are required.'; err.hidden = false; return; }
      btn.disabled = true; btn.textContent = 'Connecting…';
      try {
        const src = await api.sub.connect({ name: f.name, url: f.url, user: f.user, password: f.password });
        S.sources = sources = [...sources, src];
        toast(`Connected to ${src.name}`, { kind: 'ok' });
        draw();
        const row = wrap.querySelectorAll('.server')[sources.length - 1];
        sync(src, row.querySelector('.server-info > span'), row.querySelector('.server-actions .btn'));
      } catch (e) { err.textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); err.hidden = false; btn.disabled = false; btn.textContent = 'Connect'; }
    } }, 'Connect');
    wrap.append(h('div', { class: 'form' },
      h('div', { class: 'form-grid' }, field('Name (optional)', 'name', 'text', 'Home server'), field('Server address', 'url', 'text', 'https://music.example.com'), field('Username', 'user'), field('Password', 'password', 'password')),
      err, h('div', { class: 'form-foot' }, btn, h('span', { class: 'muted small' }, 'Cadence stores a salted token, never your password.'))));
  };

  async function sync(src, statusEl, btn) {
    btn.disabled = true;
    const off = api.sub.onProgress((p) => { if (p.id === src.id) statusEl.textContent = `Reading library… ${p.count.toLocaleString()} tracks`; });
    try {
      const res = await api.sub.sync(src.id);
      addTracks(res.tracks);
      S.sources = sources = sources.map((x) => (x.id === src.id ? res.source : x));
      toast(`Synced ${plural(res.tracks.length, 'track')} from ${src.name}`, { kind: 'ok' });
    } catch (e) { toast(`Sync failed: ${e.message || e}`, { kind: 'error', timeout: 5000 }); }
    finally { off(); draw(); }
  }

  async function importServerPlaylists(src) {
    let lists;
    try { lists = await api.sub.playlists(src.id); } catch (e) { toast(`Couldn’t load playlists: ${e.message || e}`, { kind: 'error' }); return; }
    if (!lists.length) { toast('That server has no playlists'); return; }
    const picked = new Set();
    const rows = lists.map((l) => h('label', { class: 'imp-row' }, h('input', { type: 'checkbox', onChange: (e) => (e.target.checked ? picked.add(l.id) : picked.delete(l.id)) }), h('span', { class: 'strong' }, l.name), h('span', { class: 'chip' }, plural(l.count, 'track'))));
    const ok = await modal({ title: `Playlists on ${src.name}`, body: h('div', { class: 'imp-list' }, rows), actions: [{ label: 'Cancel', value: false }, { label: 'Import selected', primary: true, value: true }] });
    if (!ok || !picked.size) return;
    for (const l of lists.filter((x) => picked.has(x.id))) {
      try {
        const p = await api.sub.playlist(src.id, l.id);
        addTracks(p.tracks);
        createPlaylist(p.name || l.name, p.tracks.map((t) => ({ t: t.id })), { source: src.name });
      } catch { toast(`Couldn’t import “${l.name}”`, { kind: 'error' }); }
    }
    toast('Playlists imported', { kind: 'ok' });
  }

  draw();
  return wrap;
}

// ---------- the view ----------
function importView() {
  const el = h('div', { class: 'page import' });
  el.append(h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Import'), h('p', { class: 'sub' }, 'Bring your music and playlists into Cadence.'))));

  // local music
  const folders = S.settings.library.folders;
  const folderList = folders.length ? h('div', { class: 'folder-list' }, folders.map((p) => h('div', { class: 'folder' },
    ic('folder', 16), h('span', { class: 'path', title: p }, p),
    h('button', { class: 'btn small ghost', title: 'Stop watching this folder', onClick: () => { setSetting('library.folders', folders.filter((x) => x !== p)); refresh(); } }, ic('x', 14))))) : null;
  el.append(section('Your music', h('div', { class: 'panel' },
    h('p', { class: 'muted' }, 'Add folders or files from your computer — MP3, FLAC, OGG, Opus, M4A, AAC and WAV. You can also drop them anywhere on this window.'),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn primary', onClick: async () => { await addFolder(); refresh(); } }, ic('folder', 16), 'Add folder'),
      h('button', { class: 'btn', onClick: addFiles }, ic('file', 16), 'Add files'),
      isDesktop && folders.length ? h('button', { class: 'btn', onClick: rescanFolders }, ic('refresh', 16), 'Rescan folders') : null),
    folderList)));

  // streaming services
  const drop = h('div', { class: 'dropzone', tabindex: 0, role: 'button', onClick: () => chooseFiles('file') },
    ic('import', 22), h('div', {}, h('strong', {}, 'Choose playlist files'), h('span', { class: 'muted' }, ' or drop them here · CSV, JSON, M3U, PLS, XSPF')));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation(); drop.classList.remove('over');
    const files = [...e.dataTransfer.files].filter(isPlaylistFile);
    if (files.length) await importPlaylistFiles(files); else toast('Those don’t look like playlist files');
  });
  el.append(section('Streaming services', h('div', { class: 'panel' },
    h('p', { class: 'muted' }, 'Commercial services only play inside their own apps, so Cadence doesn’t stream from them or bypass their protections. What it can do is bring your playlists across: export one from the service, drop the file here, and Cadence matches each entry to music in your library.'),
    h('div', { class: 'services' }, SERVICES.map((s) => h('button', { class: 'service', onClick: () => chooseFiles(s.id) },
      h('span', { class: 'strong' }, s.id), h('span', { class: 'muted small' }, s.tip)))),
    drop)));

  // server
  el.append(section('Your own server', h('div', { class: 'panel' },
    h('p', { class: 'muted' }, 'Connect to a Navidrome, Airsonic, Gonic or other Subsonic-compatible server to stream your own collection from anywhere.'),
    serverSection())));
  return el;
}

export function registerImport() {
  registerRoute('import', importView);
}
