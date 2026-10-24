// Central app state, persistence and derived library indexes. Views read `S` and listen for events.
import { api } from './bridge.js';
import { DEFAULTS, mergeDeep, deepGet, deepSet } from './settings.js';
import { norm, uid, debounce } from './util.js';

const bus = new EventTarget();
export const on = (type, fn) => { bus.addEventListener(type, fn); return () => bus.removeEventListener(type, fn); };
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

export const S = {
  tracks: [], byId: new Map(),
  albums: [], albumById: new Map(),
  artists: [], artistById: new Map(),
  playlists: [],
  favs: new Set(),
  plays: {},          // trackId -> { count, last }
  history: [],        // [{ id, t }] newest first
  lyricsCache: {},    // trackId -> { synced, text, source }
  lyricOffsets: {},   // trackId -> ms
  settings: structuredClone(DEFAULTS),
  queue: null,        // saved { ids, index, pos }
  volume: 0.8, muted: false,
  sources: [],
  ready: false,
};

// ---------- persistence ----------
const savers = {
  library: debounce(() => api.kv.save('library', S.tracks.filter((t) => !t.volatile)), 700),
  playlists: debounce(() => api.kv.save('playlists', S.playlists), 400),
  settings: debounce(() => api.kv.save('settings', S.settings), 400),
  lyrics: debounce(() => api.kv.save('lyrics', S.lyricsCache), 800),
  state: debounce(() => api.kv.save('state', {
    favs: [...S.favs], plays: S.plays, history: S.history.slice(0, 300),
    lyricOffsets: S.lyricOffsets, queue: S.queue, volume: S.volume, muted: S.muted,
  }), 500),
};
export const save = (key) => savers[key]();
export const flushAll = () => Object.values(savers).forEach((s) => s.flush());

export async function loadAll() {
  const [library, playlists, settings, state, lyrics, sources] = await Promise.all([
    api.kv.load('library'), api.kv.load('playlists'), api.kv.load('settings'), api.kv.load('state'), api.kv.load('lyrics'), api.sub.list().catch(() => []),
  ]);
  if (Array.isArray(library)) S.tracks = library;
  if (Array.isArray(playlists)) S.playlists = playlists;
  if (settings) S.settings = mergeDeep(DEFAULTS, settings);
  if (state) {
    S.favs = new Set(state.favs || []);
    S.plays = state.plays || {};
    S.history = state.history || [];
    S.lyricOffsets = state.lyricOffsets || {};
    S.queue = state.queue || null;
    if (typeof state.volume === 'number') S.volume = state.volume;
    S.muted = !!state.muted;
  }
  S.lyricsCache = lyrics || {};
  S.sources = sources || [];
  rebuild();
  S.ready = true;
}

// ---------- library ----------
let searchIndex = new Map();

export function rebuild() {
  S.byId = new Map(S.tracks.map((t) => [t.id, t]));
  const albums = new Map();
  const artists = new Map();
  searchIndex = new Map();
  for (const t of S.tracks) {
    searchIndex.set(t.id, norm(`${t.title} ${t.artist} ${t.album}`));
    const aa = t.albumArtist || t.artist;
    const akey = `${norm(aa)}::${norm(t.album)}`;
    let al = albums.get(akey);
    if (!al) { al = { id: akey, name: t.album, artist: aa, year: t.year, art: t.art, trackIds: [], duration: 0 }; albums.set(akey, al); }
    al.trackIds.push(t.id);
    al.duration += t.duration || 0;
    if (!al.art && t.art) al.art = t.art;
    if (!al.year && t.year) al.year = t.year;

    const rkey = norm(aa);
    let ar = artists.get(rkey);
    if (!ar) { ar = { id: rkey, name: aa, trackIds: [], albumIds: new Set(), art: t.art }; artists.set(rkey, ar); }
    ar.trackIds.push(t.id);
    ar.albumIds.add(akey);
    if (!ar.art && t.art) ar.art = t.art;
  }
  for (const al of albums.values()) {
    al.trackIds.sort((a, b) => {
      const x = S.byId.get(a), y = S.byId.get(b);
      return (x.disc || 1) - (y.disc || 1) || (x.track || 0) - (y.track || 0) || x.title.localeCompare(y.title);
    });
  }
  S.albums = [...albums.values()].sort((a, b) => a.name.localeCompare(b.name));
  S.artists = [...artists.values()].map((a) => ({ ...a, albumIds: [...a.albumIds] })).sort((a, b) => a.name.localeCompare(b.name));
  S.albumById = new Map(S.albums.map((a) => [a.id, a]));
  S.artistById = new Map(S.artists.map((a) => [a.id, a]));
}

export function addTracks(list) {
  const map = new Map(S.tracks.map((t) => [t.id, t]));
  let added = 0;
  for (const t of list) { if (!map.has(t.id)) added++; map.set(t.id, { ...(map.get(t.id) || {}), ...t }); }
  S.tracks = [...map.values()];
  rebuild();
  save('library');
  emit('library');
  return added;
}

export function removeTracks(ids) {
  const drop = new Set(ids);
  S.tracks = S.tracks.filter((t) => !drop.has(t.id));
  for (const id of drop) S.favs.delete(id);
  rebuild();
  save('library'); save('state');
  emit('library');
}

export function removeSourceTracks(serverId) {
  removeTracks(S.tracks.filter((t) => t.serverId === serverId).map((t) => t.id));
}

// ---------- favourites / history ----------
export const isFav = (id) => S.favs.has(id);
export function toggleFav(id) {
  if (S.favs.has(id)) S.favs.delete(id); else S.favs.add(id);
  save('state');
  emit('favs', { id });
}

export function recordStart(id) {
  S.history = [{ id, t: Date.now() }, ...S.history.filter((h, i) => !(i === 0 && h.id === id))].slice(0, 500);
  save('state');
  emit('history');
}
export function recordPlay(id) {
  const p = S.plays[id] || { count: 0, last: 0 };
  S.plays[id] = { count: p.count + 1, last: Date.now() };
  save('state');
  emit('history');
}
export function recentTracks(n = 12) {
  const seen = new Set();
  const out = [];
  for (const h of S.history) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    const t = S.byId.get(h.id);
    if (t) out.push(t);
    if (out.length >= n) break;
  }
  return out;
}
export function mostPlayed(n = 8) {
  return Object.entries(S.plays)
    .filter(([id, p]) => p.count > 0 && S.byId.has(id))
    .sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last)
    .slice(0, n)
    .map(([id]) => S.byId.get(id));
}
export function recentlyAdded(n = 12) {
  return [...S.albums].sort((a, b) => {
    const ta = Math.max(...a.trackIds.map((id) => S.byId.get(id).addedAt || 0));
    const tb = Math.max(...b.trackIds.map((id) => S.byId.get(id).addedAt || 0));
    return tb - ta;
  }).slice(0, n);
}

// ---------- playlists ----------
export function createPlaylist(name, items = [], extra = {}) {
  const pl = { id: uid(), name: name || 'New playlist', desc: '', created: Date.now(), items, ...extra };
  S.playlists.push(pl);
  save('playlists'); emit('playlists');
  return pl;
}
export function updatePlaylist(id, patch) {
  const pl = S.playlists.find((p) => p.id === id);
  if (!pl) return;
  Object.assign(pl, patch);
  save('playlists'); emit('playlists');
}
export function deletePlaylist(id) {
  S.playlists = S.playlists.filter((p) => p.id !== id);
  save('playlists'); emit('playlists');
}
export function addToPlaylist(id, trackIds) {
  const pl = S.playlists.find((p) => p.id === id);
  if (!pl) return 0;
  const have = new Set(pl.items.filter((i) => i.t).map((i) => i.t));
  let n = 0;
  for (const tid of trackIds) if (!have.has(tid)) { pl.items.push({ t: tid }); n++; }
  save('playlists'); emit('playlists');
  return n;
}
export function removeFromPlaylist(id, index) {
  const pl = S.playlists.find((p) => p.id === id);
  if (!pl) return;
  pl.items.splice(index, 1);
  save('playlists'); emit('playlists');
}
export const playlistTrackIds = (pl) => pl.items.filter((i) => i.t && S.byId.has(i.t)).map((i) => i.t);

// ---------- search ----------
export function search(query, limit = 40) {
  const q = norm(query);
  if (!q) return { tracks: [], albums: [], artists: [], playlists: [] };
  const tokens = q.split(' ');
  const tracks = [];
  for (const t of S.tracks) {
    const hay = searchIndex.get(t.id) || '';
    if (!tokens.every((tok) => hay.includes(tok))) continue;
    const title = norm(t.title);
    let score = 0;
    if (title === q) score += 6;
    if (title.startsWith(q)) score += 4;
    else if (title.includes(q)) score += 2;
    if (norm(t.artist).includes(q)) score += 1;
    score += Math.log2(((S.plays[t.id] && S.plays[t.id].count) || 0) + 1) * 0.2;
    tracks.push({ t, score });
  }
  tracks.sort((a, b) => b.score - a.score);
  const match = (s) => { const n = norm(s); return tokens.every((tok) => n.includes(tok)); };
  return {
    tracks: tracks.slice(0, limit).map((x) => x.t),
    totalTracks: tracks.length,
    albums: S.albums.filter((a) => match(`${a.name} ${a.artist}`)).slice(0, 12),
    artists: S.artists.filter((a) => match(a.name)).slice(0, 12),
    playlists: S.playlists.filter((p) => match(p.name)).slice(0, 8),
  };
}

// ---------- settings ----------
export const getSetting = (path) => deepGet(S.settings, path);
export function setSetting(path, value) {
  deepSet(S.settings, path, value);
  save('settings');
  emit('settings', { path });
}
export function replaceSettings(next) {
  S.settings = mergeDeep(DEFAULTS, next);
  save('settings');
  emit('settings', { path: '*' });
}
