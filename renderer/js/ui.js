// Shared UI components: artwork, track rows, cards, context menus, modals, toasts.
import { h, $$, fmtTime, hashStr, plural, fmtLong } from './util.js';
import { ic } from './icons.js';
import { S, isFav, toggleFav, removeTracks, createPlaylist, addToPlaylist, removeFromPlaylist } from './state.js';
import { player } from './player.js';
import { navigate } from './router.js';
import { api, isDesktop } from './bridge.js';

// ---------- artwork ----------
export function artEl(src, { title = '', cls = '', icon = 'music' } = {}) {
  const d = h('div', { class: `art ${cls}` });
  if (src) d.style.backgroundImage = `url("${String(src).replace(/"/g, '%22')}")`;
  else {
    const hue = hashStr(title || 'x') % 360;
    d.style.background = `linear-gradient(135deg, hsl(${hue} 42% 34%), hsl(${(hue + 40) % 360} 48% 20%))`;
    d.append(ic(icon, 22));
    d.classList.add('art-empty');
  }
  return d;
}

export function mosaic(trackIds, cls = '') {
  const arts = [];
  for (const id of trackIds) {
    const t = S.byId.get(id);
    if (t && t.art && !arts.includes(t.art)) arts.push(t.art);
    if (arts.length === 4) break;
  }
  if (arts.length < 4) return artEl(arts[0] || null, { title: String(trackIds.length), cls, icon: 'list' });
  return h('div', { class: `art mosaic ${cls}` }, arts.map((a) => artEl(a)));
}

// ---------- section / empty ----------
export function section(title, content, { action, sub } = {}) {
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' },
      h('h2', {}, title, sub ? h('span', { class: 'sub' }, sub) : null),
      action ? h('button', { class: 'link', onClick: action.onClick }, action.label) : null),
    content);
}

export function emptyState(icon, title, text, actions = []) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-ic' }, ic(icon, 30)),
    h('h3', {}, title),
    text ? h('p', {}, text) : null,
    actions.length ? h('div', { class: 'empty-actions' }, actions) : null);
}

// ---------- cards ----------
export function card({ art, title, sub, onClick, onPlay, onMenu, round = false, artTitle }) {
  const el = h('div', { class: 'card' + (round ? ' round' : ''), tabindex: 0, role: 'button' },
    h('div', { class: 'card-art' },
      artEl(art, { title: artTitle || title, cls: round ? 'round' : '' }),
      onPlay ? h('button', { class: 'card-play', title: 'Play', onClick: (e) => { e.stopPropagation(); onPlay(); } }, ic('play', 18)) : null),
    h('div', { class: 'card-title' }, title),
    sub ? h('div', { class: 'card-sub' }, sub) : null);
  el.addEventListener('click', () => onClick && onClick());
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') onClick && onClick(); });
  if (onMenu) el.addEventListener('contextmenu', (e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); });
  return el;
}

export function albumCard(al) {
  return card({
    art: al.art, title: al.name, sub: `${al.artist}${al.year ? ' · ' + al.year : ''}`, artTitle: al.name,
    onClick: () => navigate('album', al.id),
    onPlay: () => player.playQueue(al.trackIds, 0),
    onMenu: (x, y) => showMenu([
      { label: 'Play', icon: 'play', onClick: () => player.playQueue(al.trackIds, 0) },
      { label: 'Play next', icon: 'queue', onClick: () => { player.playNext(al.trackIds); toast('Playing next'); } },
      { label: 'Add to queue', icon: 'plus', onClick: () => { player.enqueue(al.trackIds); toast('Added to queue'); } },
      { sep: true },
      { label: 'Add to playlist', icon: 'list', submenu: playlistSubmenu(al.trackIds) },
      { label: 'Go to artist', icon: 'user', onClick: () => { const ar = S.artists.find((a) => a.name === al.artist); if (ar) navigate('artist', ar.id); } },
    ], x, y),
  });
}

export function artistCard(ar) {
  return card({
    art: ar.art, title: ar.name, sub: plural(ar.trackIds.length, 'track'), round: true, artTitle: ar.name,
    onClick: () => navigate('artist', ar.id),
    onPlay: () => player.playQueue(ar.trackIds, 0, { shuffle: false }),
  });
}

export function playlistCard(pl) {
  const ids = pl.items.filter((i) => i.t).map((i) => i.t);
  return card({
    art: null, title: pl.name, sub: plural(pl.items.filter((i) => i.m || S.byId.has(i.t)).length, 'track'),
    onClick: () => navigate('playlist', pl.id),
    onPlay: () => { const ok = ids.filter((id) => S.byId.has(id)); if (ok.length) player.playQueue(ok, 0); },
  });
}

// ---------- track rows ----------
export function trackRow(track, { ids, index, showAlbum = true, playlist = null, plIndex = -1, rank = null, plays = null } = {}) {
  const ctx = ids || [track.id];
  const i = ctx.indexOf(track.id);
  const row = h('div', { class: 'row', 'data-id': track.id, tabindex: 0 },
    h('div', { class: 'c-num' },
      h('span', { class: 'n' }, rank != null ? rank : (index ?? i) + 1),
      h('button', { class: 'rp', title: 'Play', onClick: (e) => { e.stopPropagation(); player.playQueue(ctx, i < 0 ? 0 : i); } }, ic('play', 14)),
      h('span', { class: 'eq' }, h('i'), h('i'), h('i'), h('i'))),
    h('div', { class: 'c-title' },
      artEl(track.art, { title: track.album, cls: 'sm' }),
      h('div', { class: 'tt' },
        h('div', { class: 't' }, track.title),
        h('button', { class: 'a link-quiet', onClick: (e) => { e.stopPropagation(); const ar = S.artists.find((x) => x.name === (track.albumArtist || track.artist)); if (ar) navigate('artist', ar.id); } }, track.artist))),
    showAlbum ? h('div', { class: 'c-album' }, h('button', { class: 'link-quiet', onClick: (e) => { e.stopPropagation(); const al = S.albums.find((x) => x.trackIds.includes(track.id)); if (al) navigate('album', al.id); } }, track.album)) : h('div'),
    plays != null ? h('div', { class: 'c-plays' }, plural(plays, 'play')) : null,
    h('button', { class: 'c-fav' + (isFav(track.id) ? ' on' : ''), title: 'Like', onClick: (e) => { e.stopPropagation(); toggleFav(track.id); } }, ic('heart', 16, { filled: isFav(track.id) })),
    h('div', { class: 'c-time' }, track.duration ? fmtTime(track.duration) : '–:––'),
    h('button', { class: 'c-more', title: 'More', onClick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); showMenu(trackMenu(track, { ids: ctx, playlist, plIndex }), r.right - 4, r.bottom + 4, true); } }, ic('more', 16)));
  if (!showAlbum) row.classList.add('no-album');
  if (plays != null) row.classList.add('with-plays');
  row.addEventListener('dblclick', () => player.playQueue(ctx, i < 0 ? 0 : i));
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter') player.playQueue(ctx, i < 0 ? 0 : i); });
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); showMenu(trackMenu(track, { ids: ctx, playlist, plIndex }), e.clientX, e.clientY); });
  return row;
}

export function trackHead({ showAlbum = true, plays = false } = {}) {
  return h('div', { class: 'row head' + (showAlbum ? '' : ' no-album') + (plays ? ' with-plays' : '') },
    h('div', { class: 'c-num' }, '#'), h('div', { class: 'c-title' }, 'Title'),
    showAlbum ? h('div', { class: 'c-album' }, 'Album') : h('div'),
    plays ? h('div', { class: 'c-plays' }, 'Plays') : null,
    h('div'), h('div', { class: 'c-time' }, ic('clock', 14)), h('div'));
}

// Renders large lists in chunks so a 10k-track library stays responsive.
export function trackList(tracks, { ids = tracks.map((t) => t.id), showAlbum = true, chunk = 120, playlist, playsOf } = {}) {
  const list = h('div', { class: 'tracklist' }, trackHead({ showAlbum, plays: !!playsOf }));
  let shown = 0;
  const more = h('button', { class: 'btn ghost more-btn' }, '');
  const render = () => {
    const next = Math.min(tracks.length, shown + chunk);
    const frag = document.createDocumentFragment();
    for (let k = shown; k < next; k++) frag.append(trackRow(tracks[k], { ids, index: k, showAlbum, playlist, plIndex: k, plays: playsOf ? playsOf(tracks[k]) : null }));
    shown = next;
    list.insertBefore(frag, more);
    more.hidden = shown >= tracks.length;
    more.textContent = `Show more (${tracks.length - shown} left)`;
    markPlaying();
  };
  more.addEventListener('click', render);
  list.append(more);
  render();
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && shown < tracks.length) render(); }, { rootMargin: '600px' });
    io.observe(more);
  }
  return list;
}

export function markPlaying() {
  const cur = player.current;
  const playing = player.playing;
  for (const r of $$('.row[data-id]')) {
    const on = !!cur && r.dataset.id === cur.id;
    r.classList.toggle('playing', on);
    r.classList.toggle('paused', on && !playing);
  }
}

export function summaryLine(tracks) {
  return `${plural(tracks.length, 'track')} · ${fmtLong(tracks.reduce((a, t) => a + (t.duration || 0), 0))}`;
}

// ---------- context menus ----------
let menuEls = [];
let menuCleanup = null;

export function closeMenu() {
  menuEls.forEach((m) => m.remove());
  menuEls = [];
  if (menuCleanup) { menuCleanup(); menuCleanup = null; }
}

function buildMenu(items) {
  const m = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it.sep) { m.append(h('div', { class: 'menu-sep' })); continue; }
    const btn = h('button', { class: 'menu-item' + (it.danger ? ' danger' : ''), disabled: !!it.disabled, role: 'menuitem' },
      it.icon ? ic(it.icon, 16) : h('span', { class: 'ic-wrap sp' }),
      h('span', { class: 'lbl' }, it.label),
      it.submenu ? ic('right', 14) : null);
    if (it.submenu) {
      const open = () => {
        while (menuEls.length > 1) menuEls.pop().remove();
        const sub = buildMenu(it.submenu);
        sub.classList.add('sub');
        document.getElementById('menuRoot').append(sub);
        const r = btn.getBoundingClientRect();
        const sr = sub.getBoundingClientRect();
        sub.style.left = Math.min(r.right - 4, innerWidth - sr.width - 8) + 'px';
        sub.style.top = Math.max(8, Math.min(r.top - 6, innerHeight - sr.height - 8)) + 'px';
        menuEls.push(sub);
      };
      btn.addEventListener('mouseenter', open);
      btn.addEventListener('click', open);
    } else {
      btn.addEventListener('mouseenter', () => { while (menuEls.length > 1) menuEls.pop().remove(); });
      btn.addEventListener('click', () => { closeMenu(); it.onClick && it.onClick(); });
    }
    m.append(btn);
  }
  return m;
}

export function showMenu(items, x, y) {
  closeMenu();
  const m = buildMenu(items);
  document.getElementById('menuRoot').append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  menuEls = [m];
  const onDown = (e) => { if (!menuEls.some((el) => el.contains(e.target))) closeMenu(); };
  const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };
  setTimeout(() => { document.addEventListener('mousedown', onDown, true); document.addEventListener('keydown', onKey, true); window.addEventListener('blur', closeMenu); window.addEventListener('resize', closeMenu); }, 0);
  menuCleanup = () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('blur', closeMenu); window.removeEventListener('resize', closeMenu); };
}

export function playlistSubmenu(trackIds) {
  return [
    { label: 'New playlist…', icon: 'plus', onClick: async () => {
      const name = await promptBox('New playlist', '', { placeholder: 'Playlist name', confirm: 'Create' });
      if (name) { const pl = createPlaylist(name, trackIds.map((t) => ({ t }))); toast(`Added to “${pl.name}”`); }
    } },
    ...(S.playlists.length ? [{ sep: true }] : []),
    ...S.playlists.filter((p) => !p.readonly).map((p) => ({
      label: p.name, icon: 'list',
      onClick: () => { const n = addToPlaylist(p.id, trackIds); toast(n ? `Added ${plural(n, 'track')} to “${p.name}”` : `Already in “${p.name}”`); },
    })),
  ];
}

export function trackMenu(track, { ids, playlist, plIndex } = {}) {
  const items = [
    { label: 'Play', icon: 'play', onClick: () => player.playQueue(ids || [track.id], Math.max(0, (ids || []).indexOf(track.id))) },
    { label: 'Play next', icon: 'queue', onClick: () => { player.playNext([track.id]); toast('Playing next'); } },
    { label: 'Add to queue', icon: 'plus', onClick: () => { player.enqueue([track.id]); toast('Added to queue'); } },
    { sep: true },
    { label: 'Add to playlist', icon: 'list', submenu: playlistSubmenu([track.id]) },
    { label: isFav(track.id) ? 'Remove from Liked songs' : 'Add to Liked songs', icon: 'heart', onClick: () => toggleFav(track.id) },
    { sep: true },
    { label: 'Go to artist', icon: 'user', onClick: () => { const ar = S.artists.find((x) => x.name === (track.albumArtist || track.artist)); if (ar) navigate('artist', ar.id); } },
    { label: 'Go to album', icon: 'disc', onClick: () => { const al = S.albums.find((x) => x.trackIds.includes(track.id)); if (al) navigate('album', al.id); } },
  ];
  if (isDesktop && track.source === 'local') items.push({ label: 'Show in folder', icon: 'folder', onClick: () => api.reveal(track.id) });
  items.push({ sep: true });
  if (playlist && plIndex >= 0 && !playlist.virtual) items.push({ label: 'Remove from this playlist', icon: 'x', onClick: () => removeFromPlaylist(playlist.id, playlist.items.findIndex((it) => it.t === track.id)) });
  items.push({ label: 'Remove from library', icon: 'trash', danger: true, onClick: async () => {
    if (await confirmBox('Remove from library?', `“${track.title}” will be removed from Cadence. The file itself is not deleted.`, { danger: true, confirm: 'Remove' })) removeTracks([track.id]);
  } });
  return items;
}

// ---------- modals ----------
export function modal({ title, body, actions = [{ label: 'Close', value: null }], width = 440 }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modalRoot');
    const prevFocus = document.activeElement;
    const done = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); prevFocus && prevFocus.focus && prevFocus.focus(); resolve(v); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const p = actions.find((a) => a.primary); if (p) { e.preventDefault(); done(typeof p.value === 'function' ? p.value() : p.value); } }
    };
    const back = h('div', { class: 'modal-back', onMouseDown: (e) => { if (e.target === back) done(null); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-label': title, style: { width: width + 'px' } },
        h('h3', {}, title),
        h('div', { class: 'modal-body' }, body),
        h('div', { class: 'modal-actions' }, actions.map((a) => h('button', {
          class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''),
          onClick: () => done(typeof a.value === 'function' ? a.value() : a.value),
        }, a.label)))));
    root.append(back);
    document.addEventListener('keydown', onKey, true);
    const first = back.querySelector('input,textarea,select') || back.querySelector('.btn.primary');
    first && first.focus();
  });
}

export function promptBox(title, value = '', { placeholder = '', confirm = 'OK', text } = {}) {
  const input = h('input', { type: 'text', class: 'input', value, placeholder });
  return modal({
    title, body: [text ? h('p', { class: 'muted' }, text) : null, input],
    actions: [{ label: 'Cancel', value: null }, { label: confirm, primary: true, value: () => input.value.trim() || null }],
  });
}

export function confirmBox(title, text, { confirm = 'OK', danger = false } = {}) {
  return modal({
    title, body: h('p', { class: 'muted' }, text),
    actions: [{ label: 'Cancel', value: false }, { label: confirm, primary: true, danger, value: true }],
  });
}

// ---------- toasts ----------
export function toast(message, { kind = 'info', timeout = 2800 } = {}) {
  const root = document.getElementById('toasts');
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, message);
  root.append(el);
  while (root.children.length > 4) root.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, timeout);
}

// ---------- form bits ----------
export function bindRange(input) {
  const upd = () => {
    const min = Number(input.min || 0), max = Number(input.max || 100);
    input.style.setProperty('--p', (((Number(input.value) - min) / (max - min)) * 100).toFixed(1) + '%');
  };
  input.addEventListener('input', upd);
  upd();
  return upd;
}
