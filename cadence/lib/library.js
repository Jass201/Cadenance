'use strict';
// Scans folders for audio files, reads tags + cover art, and finds lyrics.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

// Formats Chromium can decode natively.
const AUDIO_EXT = new Set(['.mp3', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.m4b', '.aac', '.wav', '.webm']);

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const trackIdFor = (file) => 'l' + sha1(file).slice(0, 15);

let mmPromise;
const loadMM = () => (mmPromise ||= import('music-metadata'));

async function collectFiles(inputs, onFound) {
  const files = [];
  const stack = [...inputs];
  while (stack.length && files.length < 250000) {
    const p = stack.pop();
    let st;
    try { st = await fsp.stat(p); } catch { continue; }
    if (st.isDirectory()) {
      let entries = [];
      try { entries = await fsp.readdir(p, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        if (e.isDirectory() || e.isFile()) stack.push(path.join(p, e.name)); // symlinked dirs are not followed
      }
    } else if (AUDIO_EXT.has(path.extname(p).toLowerCase())) {
      files.push({ file: p, mtime: st.mtimeMs });
      if (files.length % 50 === 0) onFound && onFound(files.length);
    }
  }
  return files;
}

async function mapPool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

function coverExt(mime) {
  if (/png/i.test(mime)) return 'png';
  if (/webp/i.test(mime)) return 'webp';
  if (/gif/i.test(mime)) return 'gif';
  return 'jpg';
}

async function readTrack(mm, { file, mtime }, coverDir) {
  const base = path.basename(file, path.extname(file));
  const track = {
    id: trackIdFor(file), source: 'local', path: file, mtime,
    title: base, artist: 'Unknown Artist', albumArtist: 'Unknown Artist', album: 'Unknown Album',
    track: 0, disc: 1, year: null, genre: null, duration: 0, art: null,
    addedAt: Date.now(), hasLyrics: false,
  };
  track.uri = `cadence://track/${track.id}`;
  try {
    const meta = await mm.parseFile(file, { duration: true, skipPostHeaders: true });
    const c = meta.common;
    track.title = c.title || base;
    track.artist = c.artist || (c.artists && c.artists[0]) || 'Unknown Artist';
    track.albumArtist = c.albumartist || track.artist;
    track.album = c.album || 'Unknown Album';
    track.track = (c.track && c.track.no) || 0;
    track.disc = (c.disk && c.disk.no) || 1;
    track.year = c.year || null;
    track.genre = (c.genre && c.genre[0]) || null;
    track.duration = (meta.format && meta.format.duration) || 0;
    track.bitrate = (meta.format && meta.format.bitrate) || null;
    track.format = (meta.format && meta.format.codec) || path.extname(file).slice(1);
    track.hasLyrics = Boolean(c.lyrics && c.lyrics.length);
    const rg = c.replaygain_track_gain;
    if (rg && typeof rg.dB === 'number') track.rg = rg.dB;
    const pic = mm.selectCover(c.picture);
    if (pic && pic.data && pic.data.length) {
      const name = `${sha1(pic.data)}.${coverExt(pic.format)}`;
      const out = path.join(coverDir, name);
      try { await fsp.access(out); } catch { await fsp.writeFile(out, pic.data); }
      track.art = `cadence://cover/${name}`;
    }
  } catch { /* unreadable tags: keep filename-based defaults */ }
  return track;
}

async function scanPaths(inputs, { coverDir, existing = new Map(), onProgress, mm: parser } = {}) {
  await fsp.mkdir(coverDir, { recursive: true });
  const mm = parser || (await loadMM());
  onProgress && onProgress({ phase: 'discover', done: 0, total: 0 });
  const files = await collectFiles(inputs, (n) => onProgress && onProgress({ phase: 'discover', done: n, total: 0 }));
  const tracks = [];
  let done = 0;
  await mapPool(files, 8, async (f) => {
    const old = existing.get(trackIdFor(f.file));
    if (old && old.mtime === f.mtime) tracks.push(old);
    else tracks.push(await readTrack(mm, f, coverDir));
    done++;
    if (done % 10 === 0 || done === files.length) onProgress && onProgress({ phase: 'read', done, total: files.length });
  });
  return tracks;
}

const mmss = (ms) => {
  const t = Math.max(0, Math.round(ms));
  const m = Math.floor(t / 60000), s = Math.floor((t % 60000) / 1000), cs = Math.floor((t % 1000) / 10);
  return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}]`;
};

async function readLyricsFor(file, parser) {
  const dir = path.dirname(file);
  const base = path.basename(file, path.extname(file));
  for (const ext of ['.lrc', '.LRC', '.txt']) {
    try {
      const text = await fsp.readFile(path.join(dir, base + ext), 'utf8');
      if (text.trim()) return { synced: /\[\d+:\d+(?:[.:]\d+)?\]/.test(text), text, source: 'file' };
    } catch { /* no sidecar with this extension */ }
  }
  try {
    const mm = parser || (await loadMM());
    const meta = await mm.parseFile(file, { duration: false, skipCovers: true, skipPostHeaders: true });
    for (const item of meta.common.lyrics || []) {
      if (typeof item === 'string') { if (item.trim()) return { synced: false, text: item, source: 'tags' }; continue; }
      if (item.syncText && item.syncText.length) {
        return { synced: true, text: item.syncText.map((l) => mmss(l.timestamp) + l.text).join('\n'), source: 'tags' };
      }
      if (item.text && item.text.trim()) return { synced: /\[\d+:\d+/.test(item.text), text: item.text, source: 'tags' };
    }
  } catch { /* no embedded lyrics */ }
  return null;
}

module.exports = { scanPaths, readLyricsFor, trackIdFor, AUDIO_EXT };
