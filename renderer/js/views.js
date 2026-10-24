// Main content views: Home, Library, Album, Artist, Playlist, Liked songs, Search.
import { h, plural, greeting, fmtLong, norm } from './util.js';
import { ic } from './icons.js';
import { S, on, recentTracks, mostPlayed, recentlyAdded, updatePlaylist, deletePlaylist, playlistTrackIds, search } from './state.js';
import { player } from './player.js';
import { navigate, registerRoute, refresh } from './router.js';
import { addFolder, loadDemo } from './actions.js';
import { artEl, mosaic, card, section, emptyState, albumCard, artistCard, playlistCard, trackRow, trackList, trackHead, markPlaying, summaryLine, promptBox, confirmBox, toast, showMenu } from './ui.js';
import { buildMatcher } from './importers.js';

const playAll = (ids, shuffle) => ids.length && player.playQueue(ids, 0, { shuffle });

function pageHeader({ art, kind, title, meta, actions, onTitle }) {
  return h('header', { class: 'hero' },
    art,
    h('div', { class: 'hero-text' },
      h('div', { class: 'kind' }, kind),
      h('h1', { class: onTitle ? 'editable' : '', onClick: onTitle, title: onTitle ? 'Click to rename' : null }, title),
      h('div', { class: 'meta' }, meta),
      h('div', { class: 'hero-actions' }, actions)));
}
const playButtons = (ids) => [
  h('button', { class: 'btn primary', onClick: () => playAll(ids, false), disabled: !ids.length }, ic('play', 16), 'Play'),
  h('button', { class: 'btn', onClick: () => playAll(ids, true), disabled: !ids.length }, ic('shuffle', 16), 'Shuffle'),
];

// ---------- Home ----------
function home() {
  const el = h('div', { class: 'page home' });
  if (!S.tracks.length) {
    el.append(h('header', { class: 'page-head' }, h('h1', {}, greeting()), h('p', { class: 'sub' }, 'Your library is empty — let’s fix that.')));
    el.append(emptyState('music', 'Bring in your music', 'Point Cadence at a folder of music, import playlists from a streaming service, or explore with a built-in demo.', [
      h('button', { class: 'btn primary', onClick: addFolder }, ic('folder', 16), 'Add a music folder'),
      h('button', { class: 'btn', onClick: () => navigate('import') }, ic('import', 16), 'Import from a service'),
      h('button', { class: 'btn ghost', onClick: loadDemo }, 'Try the demo library'),
    ]));
    return el;
  }
  const all = S.tracks.map((t) => t.id);
  el.append(h('header', { class: 'page-head' },
    h('div', {}, h('h1', {}, greeting()), h('p', { class: 'sub' }, `${plural(S.tracks.length, 'track')} · ${plural(S.albums.length, 'album')} · ${plural(S.artists.length, 'artist')}`)),
    h('div', { class: 'hero-actions' },
      h('button', { class: 'btn primary', onClick: () => playAll(all, true) }, ic('shuffle', 16), 'Shuffle all'))));

  const recent = recentTracks(10);
  if (recent.length) {
    const ids = recent.map((t) => t.id);
    el.append(section('Jump back in', h('div', { class: 'grid' }, recent.map((t) => card({
      art: t.art, title: t.title, sub: t.artist, artTitle: t.album,
      onClick: () => player.playQueue(ids, ids.indexOf(t.id)),
      onPlay: () => player.playQueue(ids, ids.indexOf(t.id)),
    })))));
  }

  const top = mostPlayed(5);
  if (top.length) {
    const ids = top.map((t) => t.id);
    const list = h('div', { class: 'tracklist' }, trackHead({ showAlbum: true, plays: true }),
      top.map((t, i) => trackRow(t, { ids, index: i, rank: i + 1, plays: S.plays[t.id].count })));
    el.append(section('Most played', list));
  }

  const liked = [...S.favs].filter((id) => S.byId.has(id));
  const tiles = h('div', { class: 'tiles' },
    tile('heart', 'Liked songs', plural(liked.length, 'track'), () => navigate('liked')),
    tile('music', 'All tracks', plural(S.tracks.length, 'track'), () => navigate('library', { tab: 'tracks' })),
    tile('disc', 'Albums', plural(S.albums.length, 'album'), () => navigate('library', { tab: 'albums' })),
    tile('user', 'Artists', plural(S.artists.length, 'artist'), () => navigate('library', { tab: 'artists' })));
  el.append(section('Your library', tiles, { action: { label: 'Open library', onClick: () => navigate('library') } }));

  const added = recentlyAdded(8);
  el.append(section('Recently added', h('div', { class: 'grid' }, added.map(albumCard))));
  if (S.playlists.length) el.append(section('Playlists', h('div', { class: 'grid' }, S.playlists.slice(0, 8).map(playlistCard))));
  queueMicrotask(markPlaying);
  return el;
}

function tile(icon, title, sub, onClick) {
  return h('button', { class: 'tile', onClick }, h('span', { class: 'tile-ic' }, ic(icon, 20)), h('span', { class: 'tile-t' }, title), h('span', { class: 'tile-s' }, sub));
}

// ---------- Library ----------
const lib = { tab: 'tracks', sort: 'title' };
const SORTS = {
  title: ['Title', (a, b) => a.title.localeCompare(b.title)],
  artist: ['Artist', (a, b) => a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album) || (a.track || 0) - (b.track || 0)],
  album: ['Album', (a, b) => a.album.localeCompare(b.album) || (a.disc || 1) - (b.disc || 1) || (a.track || 0) - (b.track || 0)],
  added: ['Recently added', (a, b) => (b.addedAt || 0) - (a.addedAt || 0)],
  plays: ['Most played', (a, b) => ((S.plays[b.id] && S.plays[b.id].count) || 0) - ((S.plays[a.id] && S.plays[a.id].count) || 0)],
  duration: ['Length', (a, b) => (b.duration || 0) - (a.duration || 0)],
};

function library(param) {
  if (param && param.tab) lib.tab = param.tab;
  const el = h('div', { class: 'page' });
  const body = h('div', { class: 'lib-body' });
  const sortSel = h('select', { class: 'select', 'aria-label': 'Sort tracks', onChange: (e) => { lib.sort = e.target.value; draw(); } },
    Object.entries(SORTS).map(([k, [label]]) => h('option', { value: k, selected: k === lib.sort }, label)));
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, ['tracks', 'albums', 'artists'].map((t) => h('button', {
    class: 'tab' + (lib.tab === t ? ' on' : ''), role: 'tab', onClick: () => { lib.tab = t; refresh(); },
  }, t[0].toUpperCase() + t.slice(1))));
  el.append(h('header', { class: 'page-head' }, h('h1', {}, 'Library'), lib.tab === 'tracks' ? sortSel : null), tabs, body);
  function draw() {
    if (!S.tracks.length) { body.replaceChildren(emptyState('library', 'Nothing here yet', 'Add some music to fill your library.', [h('button', { class: 'btn primary', onClick: addFolder }, ic('folder', 16), 'Add a music folder')])); return; }
    if (lib.tab === 'tracks') {
      const tracks = [...S.tracks].sort(SORTS[lib.sort][1]);
      body.replaceChildren(trackList(tracks));
    } else if (lib.tab === 'albums') body.replaceChildren(h('div', { class: 'grid' }, S.albums.map(albumCard)));
    else body.replaceChildren(h('div', { class: 'grid' }, S.artists.map(artistCard)));
  }
  draw();
  return el;
}

// ---------- Album ----------
function album(id) {
  const al = S.albumById.get(id);
  if (!al) return emptyState('disc', 'Album not found', null, [h('button', { class: 'btn', onClick: () => navigate('library', { tab: 'albums' }) }, 'Back to albums')]);
  const tracks = al.trackIds.map((t) => S.byId.get(t));
  const el = h('div', { class: 'page' });
  el.append(pageHeader({
    art: artEl(al.art, { title: al.name, cls: 'hero-art' }), kind: 'Album', title: al.name,
    meta: [h('button', { class: 'link-quiet strong', onClick: () => { const ar = S.artists.find((a) => a.name === al.artist); ar && navigate('artist', ar.id); } }, al.artist), al.year ? ` · ${al.year}` : '', ` · ${summaryLine(tracks)}`],
    actions: playButtons(al.trackIds),
  }));
  el.append(trackList(tracks, { showAlbum: false }));
  return el;
}

// ---------- Artist ----------
function artist(id) {
  const ar = S.artistById.get(id);
  if (!ar) return emptyState('user', 'Artist not found', null, [h('button', { class: 'btn', onClick: () => navigate('library', { tab: 'artists' }) }, 'Back to artists')]);
  const tracks = ar.trackIds.map((t) => S.byId.get(t));
  const el = h('div', { class: 'page' });
  el.append(pageHeader({
    art: artEl(ar.art, { title: ar.name, cls: 'hero-art round' }), kind: 'Artist', title: ar.name,
    meta: `${plural(ar.albumIds.length, 'album')} · ${summaryLine(tracks)}`, actions: playButtons(ar.trackIds),
  }));
  const popular = [...tracks].sort((a, b) => ((S.plays[b.id] && S.plays[b.id].count) || 0) - ((S.plays[a.id] && S.plays[a.id].count) || 0)).slice(0, 5);
  const pids = popular.map((t) => t.id);
  if (tracks.length > 5) el.append(section('Popular', h('div', { class: 'tracklist' }, trackHead(), popular.map((t, i) => trackRow(t, { ids: pids, index: i })))));
  el.append(section('Albums', h('div', { class: 'grid' }, ar.albumIds.map((a) => S.albumById.get(a)).filter(Boolean).map(albumCard))));
  if (tracks.length <= 5) el.append(section('Tracks', trackList(tracks)));
  queueMicrotask(markPlaying);
  return el;
}

// ---------- Playlists ----------
function likedPlaylist() {
  const ids = [...S.favs].filter((id) => S.byId.has(id)).reverse();
  return { id: 'liked', name: 'Liked songs', virtual: true, items: ids.map((t) => ({ t })) };
}

function playlistView(id) {
  const pl = id === 'liked' ? likedPlaylist() : S.playlists.find((p) => p.id === id);
  if (!pl) return emptyState('list', 'Playlist not found', null, [h('button', { class: 'btn', onClick: () => navigate('home') }, 'Go home')]);
  const ids = playlistTrackIds(pl);
  const tracks = ids.map((t) => S.byId.get(t));
  const missing = pl.items.filter((i) => i.m);
  const el = h('div', { class: 'page' });
  const rename = async () => {
    const name = await promptBox('Rename playlist', pl.name, { confirm: 'Rename' });
    if (name) updatePlaylist(pl.id, { name });
  };
  const menuBtn = h('button', { class: 'btn icon', title: 'More', onClick: (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu([
      { label: 'Rename', icon: 'list', onClick: rename },
      ...(missing.length ? [{ label: `Re-match ${missing.length} missing with library`, icon: 'refresh', onClick: () => rematch(pl) }] : []),
      { sep: true },
      { label: 'Delete playlist', icon: 'trash', danger: true, onClick: async () => { if (await confirmBox('Delete playlist?', `“${pl.name}” will be deleted. Your music is not affected.`, { danger: true, confirm: 'Delete' })) { deletePlaylist(pl.id); navigate('home'); } } },
    ], r.left, r.bottom + 4);
  } }, ic('more', 18));
  el.append(pageHeader({
    art: pl.virtual ? artEl(null, { title: 'liked', cls: 'hero-art liked', icon: 'heart' }) : mosaic(ids, 'hero-art'),
    kind: pl.source ? `Playlist · imported from ${pl.source}` : 'Playlist', title: pl.name,
    meta: `${summaryLine(tracks)}${missing.length ? ` · ${missing.length} not in your library` : ''}`,
    actions: [...playButtons(ids), pl.virtual ? null : menuBtn], onTitle: pl.virtual ? null : rename,
  }));
  if (!pl.items.length) {
    el.append(emptyState(pl.virtual ? 'heart' : 'list', pl.virtual ? 'No liked songs yet' : 'This playlist is empty', pl.virtual ? 'Tap the heart on any track to collect it here.' : 'Use “Add to playlist” on any track to fill it.'));
    return el;
  }
  const list = h('div', { class: 'tracklist' }, trackHead());
  let k = 0;
  pl.items.forEach((it, idx) => {
    if (it.t && S.byId.has(it.t)) list.append(trackRow(S.byId.get(it.t), { ids, index: k++, playlist: pl, plIndex: idx }));
    else if (it.m) list.append(h('div', { class: 'row missing' },
      h('div', { class: 'c-num' }, h('span', { class: 'n' }, '·')),
      h('div', { class: 'c-title' }, artEl(null, { title: it.m.album, cls: 'sm' }), h('div', { class: 'tt' }, h('div', { class: 't' }, it.m.title), h('div', { class: 'a' }, it.m.artist || 'Unknown artist'))),
      h('div', { class: 'c-album' }, it.m.album || ''),
      h('div'),
      h('div', { class: 'c-time' }, h('span', { class: 'chip' }, 'Not in library')),
      h('button', { class: 'c-more', title: 'Search library', onClick: () => navigate('search', `${it.m.title} ${it.m.artist || ''}`.trim()) }, ic('search', 16))));
  });
  el.append(list);
  queueMicrotask(markPlaying);
  return el;
}

function rematch(pl) {
  const match = buildMatcher(S.tracks);
  let n = 0;
  const items = pl.items.map((it) => {
    if (!it.m) return it;
    const t = match(it.m);
    if (t) { n++; return { t: t.id }; }
    return it;
  });
  updatePlaylist(pl.id, { items });
  toast(n ? `Matched ${plural(n, 'track')}` : 'Nothing new matched yet', { kind: n ? 'ok' : 'info' });
}

// ---------- Search ----------
function searchView(query) {
  const q = (query || '').trim();
  const el = h('div', { class: 'page' });
  if (!q) {
    el.append(emptyState('search', 'Search your library', 'Find tracks, albums, artists and playlists by name.'));
    return el;
  }
  const r = search(q);
  const none = !r.tracks.length && !r.albums.length && !r.artists.length && !r.playlists.length;
  el.append(h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, `Results for “${q}”`), h('p', { class: 'sub' }, none ? 'Nothing matched' : plural(r.totalTracks, 'matching track')))));
  if (none) { el.append(emptyState('search', 'No results', 'Try fewer words or check the spelling.')); return el; }
  if (r.artists.length) el.append(section('Artists', h('div', { class: 'grid' }, r.artists.map(artistCard))));
  if (r.albums.length) el.append(section('Albums', h('div', { class: 'grid' }, r.albums.map(albumCard))));
  if (r.playlists.length) el.append(section('Playlists', h('div', { class: 'grid' }, r.playlists.map(playlistCard))));
  if (r.tracks.length) el.append(section('Tracks', trackList(r.tracks, { ids: r.tracks.map((t) => t.id) }), { sub: r.totalTracks > r.tracks.length ? ` showing ${r.tracks.length} of ${r.totalTracks}` : '' }));
  queueMicrotask(markPlaying);
  return el;
}

export function registerViews() {
  registerRoute('home', home);
  registerRoute('library', library);
  registerRoute('album', album);
  registerRoute('artist', artist);
  registerRoute('playlist', playlistView);
  registerRoute('liked', () => playlistView('liked'));
  registerRoute('search', searchView);
}

// Re-render the current page when the data it shows changes.
export function watchData(currentRoute) {
  const rerender = () => { if (['home', 'library', 'album', 'artist', 'playlist', 'liked'].includes(currentRoute().name)) refresh(); };
  on('library', rerender);
  on('playlists', rerender);
  on('favs', () => {
    document.querySelectorAll('.row[data-id]').forEach((r) => {
      const on_ = S.favs.has(r.dataset.id);
      const btn = r.querySelector('.c-fav');
      if (btn && btn.classList.contains('on') !== on_) { btn.classList.toggle('on', on_); btn.querySelector('svg').setAttribute('fill', on_ ? 'currentColor' : 'none'); }
    });
    if (currentRoute().name === 'liked') refresh();
  });
}
