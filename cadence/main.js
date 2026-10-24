'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, session, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { Store } = require('./lib/store');
const { scanPaths, readLyricsFor, AUDIO_EXT } = require('./lib/library');
const { SubsonicClient, songToTrack, makeAuth, normalizeUrl } = require('./lib/subsonic');

const RENDERER = path.join(__dirname, 'renderer');
const KV_KEYS = new Set(['library', 'playlists', 'settings', 'state', 'lyrics']);

protocol.registerSchemesAsPrivileged([
  { scheme: 'cadence', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let store = null;
let coverDir = null;
const trackPaths = new Map(); // track id -> absolute file path (only files the user imported)

// ---------- Streaming sources (Subsonic-compatible servers) ----------
function loadSources() { return store.get('sources', []); }
function saveSources(list) { store.set('sources', list); }

function sealSecret(obj) {
  const json = JSON.stringify(obj);
  if (safeStorage.isEncryptionAvailable()) return { sec: safeStorage.encryptString(json).toString('base64') };
  return { plain: obj, insecure: true };
}
function openSecret(rec) {
  if (rec.sec) return JSON.parse(safeStorage.decryptString(Buffer.from(rec.sec, 'base64')));
  return rec.plain;
}
function clientFor(id) {
  const rec = loadSources().find((s) => s.id === id);
  if (!rec) throw new Error('Unknown server');
  const { token, salt } = openSecret(rec);
  return { rec, client: new SubsonicClient({ url: rec.url, user: rec.user, token, salt }, net.fetch.bind(net)) };
}
const publicSource = (s) => ({ id: s.id, type: 'subsonic', name: s.name, url: s.url, user: s.user, lastSync: s.lastSync || null, count: s.count || 0 });

// ---------- Custom protocol: app files, local tracks, covers, remote streams ----------
function withCors(res) {
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
const rangeHeaders = (req) => (req.headers.get('range') ? { range: req.headers.get('range') } : {});
const notFound = () => new Response('Not found', { status: 404 });

async function handleProtocol(req) {
  const u = new URL(req.url);
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  try {
    switch (u.hostname) {
      case 'app': {
        const full = path.normalize(path.join(RENDERER, parts.join('/') || 'index.html'));
        if (!full.startsWith(RENDERER + path.sep)) return new Response('Forbidden', { status: 403 });
        return withCors(await net.fetch(pathToFileURL(full).toString()));
      }
      case 'track': {
        const file = trackPaths.get(parts[0]);
        if (!file) return notFound();
        return withCors(await net.fetch(pathToFileURL(file).toString(), { headers: rangeHeaders(req) }));
      }
      case 'cover': {
        if (!/^[a-f0-9]{40}\.(jpg|png|webp|gif)$/.test(parts[0] || '')) return notFound();
        return withCors(await net.fetch(pathToFileURL(path.join(coverDir, parts[0])).toString()));
      }
      case 'remote': {
        const { client } = clientFor(parts[0]);
        return withCors(await net.fetch(client.streamUrl(parts[1]), { headers: rangeHeaders(req) }));
      }
      case 'remoteart': {
        const { client } = clientFor(parts[0]);
        return withCors(await net.fetch(client.coverUrl(parts[1], 400)));
      }
      default: return notFound();
    }
  } catch {
    return notFound();
  }
}

// ---------- Window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 840, minWidth: 920, minHeight: 600,
    backgroundColor: '#0d0e12', autoHideMenuBar: true, title: 'Cadence',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.loadURL('cadence://app/index.html');
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

const trusted = (e) => e.senderFrame && e.senderFrame.url.startsWith('cadence://app/');
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!trusted(e)) throw new Error('Untrusted sender');
    return fn(e, ...args);
  });
}
const sendTo = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

function registerIpc() {
  handle('kv:load', (_e, key) => {
    if (!KV_KEYS.has(key)) throw new Error('Bad key');
    return store.get(key, null);
  });
  handle('kv:save', (_e, key, value) => {
    if (!KV_KEYS.has(key)) throw new Error('Bad key');
    store.set(key, value);
    if (key === 'library' && Array.isArray(value)) {
      for (const t of value) if (t.source === 'local' && t.path) trackPaths.set(t.id, t.path);
    }
    return true;
  });

  handle('dialog:folders', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });
  handle('dialog:files', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: [...AUDIO_EXT].map((e) => e.slice(1)) }],
    });
    return r.canceled ? [] : r.filePaths;
  });

  handle('library:scan', async (_e, paths) => {
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string' && path.isAbsolute(p))) throw new Error('Bad paths');
    const existing = new Map((store.get('library', []) || []).filter((t) => t.source === 'local').map((t) => [t.id, t]));
    const tracks = await scanPaths(paths, { coverDir, existing, onProgress: (p) => sendTo('scan:progress', p) });
    for (const t of tracks) trackPaths.set(t.id, t.path);
    return tracks;
  });

  handle('lyrics:local', async (_e, id) => {
    const file = trackPaths.get(id);
    return file ? readLyricsFor(file) : null;
  });

  handle('lyrics:online', async (_e, q) => {
    const params = new URLSearchParams({ track_name: String(q.title || ''), artist_name: String(q.artist || '') });
    if (q.album && q.album !== 'Unknown Album') params.set('album_name', String(q.album));
    if (q.duration) params.set('duration', String(Math.round(q.duration)));
    const res = await net.fetch(`https://lrclib.net/api/get?${params}`, {
      headers: { 'User-Agent': `Cadence/${app.getVersion()} (desktop music player)` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.syncedLyrics) return { synced: true, text: data.syncedLyrics, source: 'lrclib' };
    if (data.plainLyrics) return { synced: false, text: data.plainLyrics, source: 'lrclib' };
    return null;
  });

  handle('file:reveal', (_e, id) => {
    const file = trackPaths.get(id);
    if (file) shell.showItemInFolder(file);
    return !!file;
  });

  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, data: app.getPath('userData') }));

  // --- Subsonic ---
  handle('sub:list', () => loadSources().map(publicSource));
  handle('sub:connect', async (_e, { name, url, user, password }) => {
    const base = normalizeUrl(url);
    const { salt, token } = makeAuth(password);
    const client = new SubsonicClient({ url: base, user, token, salt }, net.fetch.bind(net));
    await client.ping();
    const rec = { id: crypto.randomBytes(4).toString('hex'), name: name || new URL(base).host, url: base, user, ...sealSecret({ token, salt }) };
    saveSources([...loadSources(), rec]);
    return publicSource(rec);
  });
  handle('sub:remove', (_e, id) => { saveSources(loadSources().filter((s) => s.id !== id)); return true; });
  handle('sub:sync', async (_e, id) => {
    const { rec, client } = clientFor(id);
    const songs = await client.fetchAllSongs((n) => sendTo('sub:progress', { id, count: n }));
    const tracks = songs.map((s) => songToTrack(s, id));
    const list = loadSources().map((s) => (s.id === id ? { ...s, lastSync: Date.now(), count: tracks.length } : s));
    saveSources(list);
    return { source: publicSource(list.find((s) => s.id === rec.id)), tracks };
  });
  handle('sub:playlists', async (_e, id) => {
    const { client } = clientFor(id);
    return (await client.playlists()).map((p) => ({ id: p.id, name: p.name, count: p.songCount || 0 }));
  });
  handle('sub:playlist', async (_e, id, playlistId) => {
    const { client } = clientFor(id);
    const p = await client.playlist(playlistId);
    return { name: p.name, tracks: (p.entry || []).map((s) => songToTrack(s, id)) };
  });
}

app.whenReady().then(() => {
  store = new Store(path.join(app.getPath('userData'), 'data'));
  coverDir = path.join(app.getPath('userData'), 'covers');
  fs.mkdirSync(coverDir, { recursive: true });
  for (const t of store.get('library', []) || []) if (t.source === 'local' && t.path) trackPaths.set(t.id, t.path);

  protocol.handle('cadence', handleProtocol);
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  registerIpc();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('before-quit', () => store && store.flush());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
