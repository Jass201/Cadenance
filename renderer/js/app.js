// Boot, shell wiring (sidebar, top bar), keyboard shortcuts, drag & drop.
import { api } from './bridge.js';
import { S, on, emit, loadAll, flushAll, setSetting, createPlaylist, deletePlaylist, updatePlaylist, toggleFav } from './state.js';
import { applyAppearance } from './settings.js';
import { player } from './player.js';
import { h, $, debounce, plural } from './util.js';
import { ic } from './icons.js';
import { navigate, back, forward, route, canBack, canForward } from './router.js';
import { registerViews, watchData } from './views.js';
import { registerImport, importPlaylistFiles, isPlaylistFile } from './import-view.js';
import { registerSettings, showShortcuts } from './settings-view.js';
import { initNowPanel, initFullView, toggleFull, closeFull, isFullOpen } from './now-view.js';
import { initPlaybar } from './playbar.js';
import { getPalette, setArtPalette, refreshThemeColors, currentArtPalette } from './art.js';
import { scanInto, addFolder, loadDemo, addFiles } from './actions.js';
import { toast, promptBox, confirmBox, showMenu, markPlaying } from './ui.js';

const NAV = [['home', 'Home', 'home'], ['library', 'Library', 'library'], ['import', 'Import', 'import'], ['settings', 'Settings', 'settings']];
let playbar;

function applyTheme() {
  const pal = currentArtPalette();
  applyAppearance(S.settings, S.settings.appearance.adaptive && pal ? pal.a : null);
  refreshThemeColors();
  $('#app').dataset.panel = S.settings.appearance.nowPlayingPanel ? 'on' : 'off';
}

function setBackdrop() {
  const t = player.current;
  const pal = currentArtPalette();
  const bd = $('#backdrop');
  bd.style.setProperty('--bd-art', t && t.art ? `url("${t.art.replace(/"/g, '%22')}")` : 'none');
  bd.style.setProperty('--bd-tint', pal ? pal.a : 'var(--accent)');
}

// ---------- sidebar ----------
function buildSidebar() {
  const nav = $('#nav');
  nav.replaceChildren(...NAV.map(([id, label, icon]) => h('button', { class: 'nav-item', 'data-route': id, onClick: () => navigate(id) }, ic(icon, 18), label)));
  $('#newPlaylist').append(ic('plus', 16));
  $('#newPlaylist').addEventListener('click', async () => {
    const name = await promptBox('New playlist', '', { placeholder: 'Playlist name', confirm: 'Create' });
    if (name) navigate('playlist', createPlaylist(name).id);
  });
  drawPlaylists();
}

function drawPlaylists() {
  const liked = [...S.favs].filter((id) => S.byId.has(id)).length;
  const active = route.name === 'playlist' ? route.param : route.name === 'liked' ? 'liked' : null;
  const item = (id, name, count, icon, onClick, onMenu) => {
    const b = h('button', { class: 'side-item' + (active === id ? ' on' : ''), onClick },
      h('span', { class: 'side-ic' }, ic(icon, 15)), h('span', { class: 'side-name' }, name), h('span', { class: 'side-count' }, count));
    if (onMenu) b.addEventListener('contextmenu', (e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); });
    return b;
  };
  $('#sidePlaylists').replaceChildren(
    item('liked', 'Liked songs', liked, 'heart', () => navigate('liked')),
    ...S.playlists.map((p) => item(p.id, p.name, p.items.filter((i) => i.m || S.byId.has(i.t)).length, 'list', () => navigate('playlist', p.id), (x, y) => showMenu([
      { label: 'Play', icon: 'play', onClick: () => { const ids = p.items.filter((i) => i.t && S.byId.has(i.t)).map((i) => i.t); if (ids.length) player.playQueue(ids, 0); } },
      { label: 'Rename', icon: 'list', onClick: async () => { const n = await promptBox('Rename playlist', p.name, { confirm: 'Rename' }); if (n) updatePlaylist(p.id, { name: n }); } },
      { sep: true },
      { label: 'Delete', icon: 'trash', danger: true, onClick: async () => { if (await confirmBox('Delete playlist?', `“${p.name}” will be deleted.`, { danger: true, confirm: 'Delete' })) { deletePlaylist(p.id); if (route.name === 'playlist' && route.param === p.id) navigate('home'); } } },
    ], x, y))));
}

// ---------- top bar ----------
function buildTopbar() {
  $('#backBtn').append(ic('left', 18));
  $('#fwdBtn').append(ic('right', 18));
  $('#backBtn').addEventListener('click', back);
  $('#fwdBtn').addEventListener('click', forward);
  $('#searchIcon').append(ic('search', 16));
  $('#addBtn').append(ic('plus', 14), 'Add music');
  $('#addBtn').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu([
      { label: 'Add folder…', icon: 'folder', onClick: addFolder },
      { label: 'Add files…', icon: 'file', onClick: addFiles },
      { sep: true },
      { label: 'Import playlists or servers…', icon: 'import', onClick: () => navigate('import') },
    ], r.right - 230, r.bottom + 6);
  });

  const input = $('#searchInput');
  const go = debounce(() => {
    const q = input.value;
    if (!q.trim()) { if (route.name === 'search') navigate('search', '', { replace: true }); return; }
    navigate('search', q, { replace: route.name === 'search' });
  }, 120);
  input.addEventListener('input', go);
  input.addEventListener('focus', () => { if (input.value.trim() && route.name !== 'search') navigate('search', input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; input.blur(); if (route.name === 'search') back(); }
    if (e.key === 'Enter') go.flush();
  });
}

function wireRouteState() {
  on('route', (e) => {
    const { name, canBack: cb, canForward: cf } = e.detail;
    $('#backBtn').disabled = !cb;
    $('#fwdBtn').disabled = !cf;
    const owner = { album: 'library', artist: 'library', liked: null, playlist: null, search: null }[name] ?? name;
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('on', b.dataset.route === owner));
    if (name !== 'search') $('#searchInput').value = '';
    drawPlaylists();
    markPlaying();
  });
  on('playlists', drawPlaylists);
  on('favs', drawPlaylists);
  on('library', drawPlaylists);
}

function wireScanStatus() {
  const el = $('#scanStatus');
  on('scan', (e) => {
    const p = e.detail;
    if (p.phase === 'done') { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = p.phase === 'discover' ? `Looking for music… ${p.done ? p.done.toLocaleString() : ''}` : `Reading tags ${p.done.toLocaleString()} / ${p.total.toLocaleString()}`;
  });
}

// ---------- keyboard ----------
function typing(t) {
  return t && (t.tagName === 'INPUT' && !['range', 'checkbox', 'button', 'color'].includes(t.type) || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

function wireKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const mod = e.ctrlKey || e.metaKey;
    const t = e.target;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#searchInput').focus(); $('#searchInput').select(); return; }
    if (mod && e.key === ',') { e.preventDefault(); navigate('settings'); return; }
    if (typing(t) || $('#modalRoot').children.length) return;
    const onRange = t.tagName === 'INPUT' && t.type === 'range';
    const onSelect = t.tagName === 'SELECT';
    switch (e.key) {
      case ' ': e.preventDefault(); player.toggle(); break;
      case 'ArrowRight': if (e.altKey) { e.preventDefault(); forward(); } else if (mod) { e.preventDefault(); player.next(); } else if (!onRange && !onSelect) { e.preventDefault(); player.seekBy(5); } break;
      case 'ArrowLeft': if (e.altKey) { e.preventDefault(); back(); } else if (mod) { e.preventDefault(); player.prev(); } else if (!onRange && !onSelect) { e.preventDefault(); player.seekBy(-5); } break;
      case 'ArrowUp': if (!onRange && !onSelect && !mod) { e.preventDefault(); player.setVolume(S.volume + 0.05); } break;
      case 'ArrowDown': if (!onRange && !onSelect && !mod) { e.preventDefault(); player.setVolume(S.volume - 0.05); } break;
      case 'Escape': if (isFullOpen()) closeFull(); break;
      case '/': e.preventDefault(); $('#searchInput').focus(); break;
      case '?': showShortcuts(); break;
      default: {
        if (mod || e.altKey) return;
        const k = e.key.toLowerCase();
        if (k === 'm') player.toggleMute();
        else if (k === 's') player.setShuffle(!player.shuffle);
        else if (k === 'r') player.cycleRepeat();
        else if (k === 'f' && player.current) toggleFav(player.current.id);
        else if (k === 'l') toggleFull('lyrics');
        else if (k === 'v') toggleFull('viz');
        else if (k === 'q') playbar.openQueue();
      }
    }
  });
}

// ---------- drag & drop ----------
function wireDrop() {
  const hint = $('#dropHint');
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; hint.hidden = false; } });
  window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; hint.hidden = true; } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0; hint.hidden = true;
    const files = [...e.dataTransfer.files];
    const playlists = files.filter(isPlaylistFile);
    const rest = files.filter((f) => !isPlaylistFile(f));
    if (playlists.length) await importPlaylistFiles(playlists);
    if (rest.length) await scanInto(api.pathsFromFiles(rest));
  });
}

// ---------- boot ----------
async function boot() {
  await loadAll();
  applyTheme();
  buildSidebar();
  buildTopbar();
  wireRouteState();
  wireScanStatus();
  registerViews();
  registerImport();
  registerSettings();
  watchData(() => route);
  initNowPanel($('#nowPanel'));
  initFullView($('#nowView'));
  playbar = initPlaybar($('#playbar'));
  wireKeys();
  wireDrop();
  player.bindMediaKeys();

  on('settings', () => { applyTheme(); setBackdrop(); });
  on('player:track', async () => {
    const t = player.current;
    markPlaying();
    document.title = t ? `${t.title} · ${t.artist}` : 'Cadence';
    const pal = t && t.art ? await getPalette(t.art) : null;
    if (player.current !== t) return;
    setArtPalette(pal);
    applyTheme();
    setBackdrop();
    emit('palette');
  });
  on('player:state', markPlaying);
  on('player:error', (e) => toast(`Couldn’t play “${e.detail.track.title}”`, { kind: 'error' }));
  on('player:blocked', () => toast('Press play to start the audio'));
  window.addEventListener('beforeunload', flushAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAll(); });

  await player.restore();
  navigate('home');
  document.body.classList.add('ready');
}

boot().catch((e) => {
  console.error(e);
  document.body.append(h('pre', { class: 'fatal' }, `Cadence failed to start:\n${e && e.stack ? e.stack : e}`));
});

// Test hook (used by automated checks in the browser build).
window.__cadence = { S, player, navigate, loadDemo, setSetting };
