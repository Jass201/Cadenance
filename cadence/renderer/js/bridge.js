// `api` is the preload bridge when running in the desktop app. In a plain browser (used for
// development and automated tests) a small shim stands in: localStorage persistence and
// in-memory blob URLs for files the user picks. Streaming servers need the desktop app.
import { hashStr } from './util.js';

const AUDIO_RE = /\.(mp3|flac|ogg|oga|opus|m4a|m4b|aac|wav|webm)$/i;
const LS = 'cadence:';

function readDuration(url) {
  return new Promise((resolve) => {
    const a = new Audio();
    const done = (d) => { a.src = ''; resolve(Number.isFinite(d) ? d : 0); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(0);
    setTimeout(() => done(0), 4000);
    a.src = url;
  });
}

function pickFiles(directory, accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (directory) input.webkitdirectory = true;
    if (accept) input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve([{ __files: [...input.files] }]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

const progressListeners = new Set();

const shim = {
  isDesktop: false,
  platform: 'web',
  kv: {
    async load(key) { try { const v = localStorage.getItem(LS + key); return v ? JSON.parse(v) : null; } catch { return null; } },
    async save(key, value) { try { localStorage.setItem(LS + key, JSON.stringify(value)); } catch { /* quota */ } return true; },
  },
  pickFolders: () => pickFiles(true),
  pickFiles: () => pickFiles(false, 'audio/*'),
  pathsFromFiles: (files) => [{ __files: [...files] }],
  async scan(items) {
    const files = items.flatMap((i) => i.__files || []).filter((f) => AUDIO_RE.test(f.name));
    const tracks = [];
    let done = 0;
    for (const f of files) {
      const url = URL.createObjectURL(f);
      const parts = (f.webkitRelativePath || '').split('/').filter(Boolean);
      let title = f.name.replace(/\.[^.]+$/, '').replace(/^\d+[\s._-]+/, '');
      let artist = parts.length >= 3 ? parts[parts.length - 3] : 'Unknown Artist';
      const album = parts.length >= 2 ? parts[parts.length - 2] : 'Unknown Album';
      const dash = title.indexOf(' - ');
      if (dash > 0 && artist === 'Unknown Artist') { artist = title.slice(0, dash); title = title.slice(dash + 3); }
      tracks.push({
        id: 'b' + hashStr(f.name + f.size + f.lastModified).toString(36), source: 'local', volatile: true,
        title, artist, albumArtist: artist, album, track: Number((f.name.match(/^(\d+)/) || [])[1]) || 0, disc: 1,
        duration: await readDuration(url), uri: url, art: null, addedAt: Date.now(),
      });
      done++;
      progressListeners.forEach((cb) => cb({ phase: 'read', done, total: files.length }));
    }
    return tracks;
  },
  onScanProgress(cb) { progressListeners.add(cb); return () => progressListeners.delete(cb); },
  lyrics: {
    async local() { return null; },
    async online(q) {
      const p = new URLSearchParams({ track_name: q.title, artist_name: q.artist });
      if (q.duration) p.set('duration', String(Math.round(q.duration)));
      const res = await fetch(`https://lrclib.net/api/get?${p}`);
      if (!res.ok) return null;
      const d = await res.json();
      if (d.syncedLyrics) return { synced: true, text: d.syncedLyrics, source: 'lrclib' };
      return d.plainLyrics ? { synced: false, text: d.plainLyrics, source: 'lrclib' } : null;
    },
  },
  reveal: async () => false,
  info: async () => ({ version: 'web', platform: 'web', data: 'browser storage' }),
  sub: {
    async list() { return []; },
    async connect() { throw new Error('Connecting to a streaming server needs the desktop app.'); },
    async remove() { return true; },
    async sync() { throw new Error('Streaming servers need the desktop app.'); },
    async playlists() { return []; },
    async playlist() { return { name: '', tracks: [] }; },
    onProgress() { return () => {}; },
  },
};

export const api = window.cadence || shim;
export const isDesktop = Boolean(window.cadence);
