// Now Playing: the right-hand panel (cover, visualizer, lyrics, queue) and the full-screen view.
import { h, fmtTime, pickFile, clamp } from './util.js';
import { ic } from './icons.js';
import { S, on, emit, setSetting, toggleFav, isFav } from './state.js';
import { player } from './player.js';
import { Visualizer, bassLevel } from './visualizer.js';
import { LyricsView, getLyrics, setManualLyrics, fetchOnline, offsetFor, nudgeOffset } from './lyrics.js';
import { getVizPalette, lyricsActiveColor } from './art.js';
import { VIZ_MODES, motionOff } from './settings.js';
import { navigate } from './router.js';
import { artEl, modal, toast } from './ui.js';
import { h as el } from './util.js';

// ---------- shared lyrics state ----------
const L = { trackId: null, parsed: null, loading: false, token: 0 };

async function loadLyricsFor(track) {
  const token = ++L.token;
  L.trackId = track ? track.id : null;
  L.parsed = null;
  L.loading = !!track;
  emit('lyrics');
  if (!track) return;
  const parsed = await getLyrics(track);
  if (token !== L.token) return;
  L.parsed = parsed;
  L.loading = false;
  emit('lyrics');
}

const lyricActions = {
  async onLoadFile() {
    const [f] = await pickFile('.lrc,.txt');
    const t = player.current;
    if (!f || !t) return;
    L.parsed = setManualLyrics(t.id, await f.text());
    emit('lyrics');
  },
  async onPaste() {
    const t = player.current;
    if (!t) return;
    const area = h('textarea', { class: 'input', rows: 10, placeholder: 'Paste plain text or LRC with [mm:ss.xx] timestamps…' });
    const ok = await modal({ title: `Lyrics for “${t.title}”`, width: 560, body: area, actions: [{ label: 'Cancel', value: false }, { label: 'Save', primary: true, value: true }] });
    if (ok && area.value.trim()) { L.parsed = setManualLyrics(t.id, area.value); emit('lyrics'); }
  },
  async onSearchOnline() {
    const t = player.current;
    if (!t) return;
    toast('Searching lrclib.net…');
    const found = await fetchOnline(t);
    if (!found) { toast('No lyrics found online for this track'); return; }
    L.parsed = await getLyrics(t, { allowOnline: false });
    emit('lyrics');
  },
};

function bindLyricsView(view) {
  const render = () => {
    view.setColor(lyricsActiveColor());
    if (L.loading) view.empty('Looking for lyrics…', { loading: true });
    else if (!player.current) view.empty('Play something to see lyrics.', { actions: false });
    else if (!L.parsed) view.empty('No lyrics for this track.');
    else view.set(L.parsed);
    view.update(posMs());
  };
  on('lyrics', render);
  on('settings', () => { view.setColor(lyricsActiveColor()); if (L.parsed) view.set(L.parsed); view.update(posMs()); });
  on('palette', () => view.setColor(lyricsActiveColor()));
  on('player:time', () => view.update(posMs()));
  render();
}
const posMs = () => player.position * 1000 - offsetFor(L.trackId);

// ---------- Now Playing panel ----------
export function initNowPanel(root) {
  const tabs = ['now', 'queue'];
  let tab = 'now';
  const seg = h('div', { class: 'seg' }, tabs.map((t) => h('button', { class: 'seg-btn' + (t === tab ? ' on' : ''), 'data-tab': t, onClick: () => setTab(t) }, t === 'now' ? 'Now playing' : 'Queue')));
  const closeBtn = h('button', { class: 'icon-btn', title: 'Hide panel', 'aria-label': 'Hide panel', onClick: () => setSetting('appearance.nowPlayingPanel', false) }, ic('x', 16));
  const body = h('div', { class: 'np-body' });
  root.replaceChildren(h('div', { class: 'np-head' }, seg, closeBtn), body);

  // --- now playing tab
  const cover = h('div', { class: 'np-cover' });
  const canvas = h('canvas', { class: 'np-viz', 'aria-hidden': 'true' });
  const artBox = h('div', { class: 'np-art', onClick: () => openFull('lyrics'), title: 'Open full view' }, cover, canvas);
  const title = h('div', { class: 'np-title' });
  const artist = h('button', { class: 'np-artist link-quiet' });
  const heart = h('button', { class: 'icon-btn heart', title: 'Like', onClick: () => player.current && toggleFav(player.current.id) }, ic('heart', 20));
  const meta = h('div', { class: 'np-meta' }, h('div', { class: 'np-text' }, title, artist), heart);
  const lyricsBox = h('div', { class: 'np-lyrics' });
  const lyricsCard = h('div', { class: 'np-card' },
    h('div', { class: 'np-card-head' }, h('span', {}, 'Lyrics'), h('button', { class: 'icon-btn', title: 'Open full lyrics', 'aria-label': 'Open full lyrics', onClick: () => openFull('lyrics') }, ic('expand', 15))), lyricsBox);
  const nextCard = h('div', { class: 'np-card' });
  const nowTab = h('div', { class: 'np-tab' }, artBox, meta, lyricsCard, nextCard);
  const empty = h('div', { class: 'np-empty' }, ic('music', 34), h('p', {}, 'Nothing playing'), h('span', { class: 'muted' }, 'Pick a track and it will show up here.'));

  // --- queue tab
  const queueTab = h('div', { class: 'np-tab queue' });

  const lv = new LyricsView(lyricsBox, { compact: true, windowLines: 2, onSeek: (ms) => player.seek(ms / 1000), ...lyricActions });
  bindLyricsView(lv);

  const viz = new Visualizer(canvas, { getPalette: getVizPalette, compact: true });
  const syncViz = () => {
    const want = tab === 'now' && !!player.current && player.playing && S.settings.viz.onArt && S.settings.viz.mode !== 'off' && !root.hidden && root.offsetParent !== null;
    canvas.style.display = S.settings.viz.onArt && S.settings.viz.mode !== 'off' ? '' : 'none';
    if (want) viz.start(); else viz.stop();
  };

  function drawNow() {
    const t = player.current;
    body.replaceChildren(t ? (tab === 'now' ? nowTab : queueTab) : (tab === 'now' ? empty : queueTab));
    if (tab === 'queue') drawQueue();
    if (!t) return;
    cover.style.backgroundImage = t.art ? `url("${t.art.replace(/"/g, '%22')}")` : '';
    cover.classList.toggle('art-empty', !t.art);
    cover.replaceChildren(t.art ? '' : ic('music', 56));
    title.textContent = t.title;
    artist.textContent = `${t.artist}${t.album && t.album !== 'Unknown Album' ? ' · ' + t.album : ''}`;
    artist.onclick = () => { const ar = S.artists.find((a) => a.name === (t.albumArtist || t.artist)); if (ar) navigate('artist', ar.id); };
    heart.classList.toggle('on', isFav(t.id));
    heart.replaceChildren(ic('heart', 20, { filled: isFav(t.id) }));
    drawNext();
  }

  function drawNext() {
    const upcoming = player.queue.slice(player.index + 1, player.index + 4).map((id) => S.byId.get(id)).filter(Boolean);
    nextCard.hidden = !upcoming.length;
    nextCard.replaceChildren(
      h('div', { class: 'np-card-head' }, h('span', {}, 'Next in queue'), h('button', { class: 'link', onClick: () => setTab('queue') }, 'Open queue')),
      ...upcoming.map((t, k) => h('button', { class: 'mini-row', onClick: () => player.jump(player.index + 1 + k) },
        artEl(t.art, { title: t.album, cls: 'xs' }), h('div', { class: 'tt' }, h('div', { class: 't' }, t.title), h('div', { class: 'a' }, t.artist)))));
  }

  function drawQueue() {
    const items = player.queue.map((id, i) => ({ t: S.byId.get(id), i })).filter((x) => x.t);
    const cur = items.find((x) => x.i === player.index);
    const up = items.filter((x) => x.i > player.index);
    const history = items.filter((x) => x.i < player.index).slice(-3);
    let dragFrom = null;
    const row = ({ t, i }, { draggable = true } = {}) => {
      const r = h('div', { class: 'q-row' + (i === player.index ? ' current' : ''), draggable: draggable && i !== player.index, 'data-i': i },
        draggable && i !== player.index ? h('span', { class: 'grip' }, ic('grip', 14)) : h('span', { class: 'grip sp' }),
        h('button', { class: 'q-main', onClick: () => player.jump(i) }, artEl(t.art, { title: t.album, cls: 'xs' }), h('div', { class: 'tt' }, h('div', { class: 't' }, t.title), h('div', { class: 'a' }, t.artist))),
        i !== player.index ? h('button', { class: 'icon-btn', title: 'Remove', 'aria-label': 'Remove from queue', onClick: () => player.removeAt(i) }, ic('x', 14)) : h('span', { class: 'eq on' }, h('i'), h('i'), h('i'), h('i')));
      r.addEventListener('dragstart', (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; r.classList.add('dragging'); });
      r.addEventListener('dragend', () => r.classList.remove('dragging'));
      r.addEventListener('dragover', (e) => { if (dragFrom != null) { e.preventDefault(); r.classList.add('drop'); } });
      r.addEventListener('dragleave', () => r.classList.remove('drop'));
      r.addEventListener('drop', (e) => { e.preventDefault(); r.classList.remove('drop'); if (dragFrom != null && i > player.index) player.moveInQueue(dragFrom, i); dragFrom = null; });
      return r;
    };
    queueTab.replaceChildren(
      !items.length ? h('div', { class: 'np-empty' }, ic('queue', 30), h('p', {}, 'Your queue is empty'), h('span', { class: 'muted' }, 'Play something or use “Add to queue”.')) : null,
      history.length ? h('div', { class: 'q-label' }, 'Previously') : null, ...history.map((x) => row(x, { draggable: false })),
      cur ? h('div', { class: 'q-label' }, 'Now playing') : null, cur ? row(cur) : null,
      up.length ? h('div', { class: 'q-label split' }, h('span', {}, `Next up · ${up.length}`), h('button', { class: 'link', onClick: () => player.clearUpcoming() }, 'Clear')) : null, ...up.map((x) => row(x)));
  }

  function setTab(t) {
    tab = t;
    seg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    drawNow();
    syncViz();
  }

  // --- pulse + spin
  let pulseRaf = 0;
  const pulse = () => {
    pulseRaf = 0;
    if (!player.playing || motionOff(S.settings) || !S.settings.motion.pulseArt || tab !== 'now') { artBox.style.setProperty('--pulse', 1); return; }
    artBox.style.setProperty('--pulse', (1 + bassLevel() * 0.045).toFixed(4));
    pulseRaf = requestAnimationFrame(pulse);
  };
  const syncPulse = () => { if (!pulseRaf) pulseRaf = requestAnimationFrame(pulse); };

  on('player:track', () => { drawNow(); const t = player.current; loadLyricsFor(t); syncViz(); syncPulse(); });
  on('player:state', () => { artBox.classList.toggle('is-playing', player.playing); syncViz(); syncPulse(); });
  on('player:queue', () => { if (tab === 'queue') drawQueue(); else if (player.current) drawNext(); });
  on('favs', () => { const t = player.current; if (t) { heart.classList.toggle('on', isFav(t.id)); heart.replaceChildren(ic('heart', 20, { filled: isFav(t.id) })); } });
  on('settings', () => { syncViz(); syncPulse(); });
  on('panel', syncViz);
  drawNow();
  return { syncViz };
}

// ---------- full-screen view ----------
let full = null;

export function initFullView(root) {
  let mode = 'lyrics';
  const canvas = h('canvas', { class: 'fv-viz', 'aria-hidden': 'true' });
  const viz = new Visualizer(canvas, { getPalette: getVizPalette });
  const seg = h('div', { class: 'seg' }, [['lyrics', 'Lyrics'], ['viz', 'Visualizer']].map(([m, label]) => h('button', { class: 'seg-btn', 'data-mode': m, onClick: () => setMode(m) }, label)));
  const offsetLabel = h('span', { class: 'offset-val' });
  const offsetBox = h('div', { class: 'offset', title: 'Shift lyric timing for this track' },
    h('button', { class: 'icon-btn', 'aria-label': 'Lyrics earlier', onClick: () => nudge(-100) }, '−'), h('span', { class: 'muted' }, 'Sync'), offsetLabel,
    h('button', { class: 'icon-btn', 'aria-label': 'Lyrics later', onClick: () => nudge(100) }, '+'));
  const nudge = (d) => { if (L.trackId) { nudgeOffset(L.trackId, d); updOffset(); } };
  const updOffset = () => { const o = offsetFor(L.trackId); offsetLabel.textContent = `${o > 0 ? '+' : ''}${(o / 1000).toFixed(1)}s`; };
  const closeBtn = h('button', { class: 'icon-btn lg', title: 'Close (Esc)', 'aria-label': 'Close full view', onClick: () => closeFull() }, ic('down', 22));
  const cover = h('div', { class: 'fv-cover' });
  const title = h('div', { class: 'fv-title' });
  const artist = h('div', { class: 'fv-artist' });
  const left = h('div', { class: 'fv-left' }, cover, title, artist);
  const lyricsBox = h('div', { class: 'fv-lyrics' });
  const chips = h('div', { class: 'viz-chips' }, VIZ_MODES.filter(([m]) => m !== 'off').map(([m, label]) => h('button', { class: 'chip-btn', 'data-m': m, onClick: () => setSetting('viz.mode', m) }, label)));
  root.replaceChildren(canvas, h('div', { class: 'fv-top' }, closeBtn, seg, h('div', { class: 'grow' }), offsetBox), h('div', { class: 'fv-main' }, left, lyricsBox), chips);

  const lv = new LyricsView(lyricsBox, { onSeek: (ms) => player.seek(ms / 1000 + offsetFor(L.trackId) / 1000), ...lyricActions });
  bindLyricsView(lv);

  function paint() {
    const t = player.current;
    root.style.setProperty('--fv-art', t && t.art ? `url("${t.art.replace(/"/g, '%22')}")` : 'none');
    cover.style.backgroundImage = t && t.art ? `url("${t.art.replace(/"/g, '%22')}")` : '';
    cover.replaceChildren(t && t.art ? '' : ic('music', 64));
    title.textContent = t ? t.title : 'Nothing playing';
    artist.textContent = t ? `${t.artist}${t.album && t.album !== 'Unknown Album' ? ' · ' + t.album : ''}` : '';
    updOffset();
  }
  function applyMode() {
    root.dataset.mode = mode;
    seg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    chips.querySelectorAll('.chip-btn').forEach((b) => b.classList.toggle('on', b.dataset.m === S.settings.viz.mode));
    const base = S.settings.viz.fullOpacity;
    canvas.style.opacity = mode === 'viz' ? base : base * 0.4;
    offsetBox.hidden = mode !== 'lyrics';
    if (!root.hidden) { if (S.settings.viz.mode === 'off') viz.stop(); else viz.start(); }
  }
  function setMode(m) { mode = m; applyMode(); }

  full = {
    open(m) { if (m) mode = m; root.hidden = false; requestAnimationFrame(() => root.classList.add('open')); paint(); applyMode(); lv.scrollToActive(); emit('full', { open: true }); },
    close() { root.classList.remove('open'); viz.stop(); setTimeout(() => { if (!root.classList.contains('open')) root.hidden = true; }, motionOff(S.settings) ? 0 : 260); emit('full', { open: false }); },
    get isOpen() { return !root.hidden && root.classList.contains('open'); },
    toggle(m) { if (this.isOpen && mode === m) this.close(); else this.open(m); },
  };
  on('player:track', () => { paint(); });
  on('settings', applyMode);
  on('lyrics', () => { updOffset(); setTimeout(() => lv.scrollToActive(), 30); });
}

export const openFull = (m) => full && full.open(m);
export const closeFull = () => full && full.close();
export const toggleFull = (m) => full && full.toggle(m);
export const isFullOpen = () => !!full && full.isOpen;
