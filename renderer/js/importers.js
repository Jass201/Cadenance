// Playlist-file importers (CSV/TSV, JSON, M3U, PLS, XSPF) and a matcher that links imported
// entries to tracks already in the library. This is how playlists from streaming services come in:
// export them with the service or a transfer tool, then drop the file onto Cadence.
import { norm } from './util.js';

const ALIASES = {
  title: ['track name', 'trackname', 'track', 'title', 'name', 'song', 'song name'],
  artist: ['artist name(s)', 'artist name', 'artistname', 'artist', 'artists', 'album artist'],
  album: ['album name', 'albumname', 'album'],
  duration: ['duration (ms)', 'duration_ms', 'durationms', 'duration', 'length', 'time', 'msplayed'],
  isrc: ['isrc'],
  playlist: ['playlist name', 'playlist', 'playlistname'],
  uri: ['track uri', 'uri', 'spotify uri', 'url', 'location', 'path'],
};

export function decodeText(buf) {
  const u = new Uint8Array(buf);
  if (u[0] === 0xff && u[1] === 0xfe) return new TextDecoder('utf-16le').decode(u.subarray(2));
  if (u[0] === 0xfe && u[1] === 0xff) return new TextDecoder('utf-16be').decode(u.subarray(2));
  const text = new TextDecoder('utf-8').decode(u);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseDuration(v, headerHint = '') {
  if (v == null || v === '') return 0;
  const s = String(v).trim();
  if (/^\d+:\d{1,2}(:\d{1,2})?$/.test(s)) {
    return s.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
  }
  const n = Number(s);
  if (!isFinite(n)) return 0;
  if (/ms|msplayed/i.test(headerHint) || n > 20000) return n / 1000; // milliseconds
  return n;
}

function splitCsvLine(line, delim) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

// Split text into records, honouring quoted newlines.
function splitRecords(text) {
  const rows = [];
  let cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') q = !q;
    if ((c === '\n' || c === '\r') && !q) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      rows.push(cur); cur = '';
    } else cur += c;
  }
  if (cur) rows.push(cur);
  return rows.filter((r) => r.trim() !== '');
}

function pick(obj, names) {
  for (const n of names) if (obj[n] != null && String(obj[n]).trim() !== '') return { key: n, value: obj[n] };
  return null;
}

function toEntry(rec) {
  const lower = {};
  for (const [k, v] of Object.entries(rec)) lower[k.toLowerCase().trim()] = v;
  const t = pick(lower, ALIASES.title);
  if (!t) return null;
  const a = pick(lower, ALIASES.artist);
  const al = pick(lower, ALIASES.album);
  const d = pick(lower, ALIASES.duration);
  const i = pick(lower, ALIASES.isrc);
  const artist = a ? String(a.value).split(/\s*[;|]\s*/)[0].trim() : '';
  return {
    title: String(t.value).trim(),
    artist,
    album: al ? String(al.value).trim() : '',
    duration: d ? parseDuration(d.value, d.key) : 0,
    isrc: i ? String(i.value).trim() : '',
  };
}

function group(entries, fallbackName) {
  const map = new Map();
  for (const { pl, entry } of entries) {
    const name = pl || fallbackName;
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(entry);
  }
  return [...map].map(([name, items]) => ({ name, entries: items }));
}

function parseDelimited(text, fallbackName) {
  const records = splitRecords(text);
  if (records.length < 2) return [];
  const head = records[0];
  const delim = [',', '\t', ';'].map((d) => [d, head.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const cols = splitCsvLine(head, delim).map((c) => c.trim());
  const out = [];
  for (const line of records.slice(1)) {
    const cells = splitCsvLine(line, delim);
    const rec = {};
    cols.forEach((c, i) => { rec[c] = cells[i]; });
    const entry = toEntry(rec);
    if (!entry) continue;
    const lower = {};
    for (const [k, v] of Object.entries(rec)) lower[k.toLowerCase()] = v;
    const pl = pick(lower, ALIASES.playlist);
    out.push({ pl: pl ? String(pl.value).trim() : '', entry });
  }
  return group(out, fallbackName);
}

function parseJson(text, fallbackName) {
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  const fromItem = (it) => toEntry(it && it.track && typeof it.track === 'object' ? { ...it, ...it.track } : it);
  if (Array.isArray(data)) {
    const entries = data.map(fromItem).filter(Boolean);
    return entries.length ? [{ name: fallbackName, entries }] : [];
  }
  const lists = Array.isArray(data.playlists) ? data.playlists : [data];
  const out = [];
  for (const pl of lists) {
    const items = pl.items || pl.tracks || pl.songs || [];
    const entries = items.map(fromItem).filter(Boolean);
    if (entries.length) out.push({ name: pl.name || pl.title || fallbackName, entries });
  }
  return out;
}

function parseM3u(text, fallbackName) {
  const entries = [];
  let meta = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const m = line.match(/^#EXTINF:\s*(-?\d+(?:\.\d+)?)[^,]*,(.*)$/);
      if (m) {
        const label = m[2].trim();
        const dash = label.indexOf(' - ');
        meta = { duration: Math.max(0, Number(m[1])), artist: dash > 0 ? label.slice(0, dash).trim() : '', title: dash > 0 ? label.slice(dash + 3).trim() : label };
      }
    } else if (!line.startsWith('#')) {
      const file = decodeURI(line).split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,4}$/i, '');
      entries.push({ title: (meta && meta.title) || file, artist: (meta && meta.artist) || '', album: '', duration: (meta && meta.duration) || 0, isrc: '' });
      meta = null;
    }
  }
  return entries.length ? [{ name: fallbackName, entries }] : [];
}

function parsePls(text, fallbackName) {
  const items = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(File|Title|Length)(\d+)=(.*)$/i);
    if (m) (items[m[2]] ||= {})[m[1].toLowerCase()] = m[3].trim();
  }
  const entries = Object.keys(items).sort((a, b) => a - b).map((k) => {
    const it = items[k];
    const label = it.title || (it.file || '').split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,4}$/i, '');
    const dash = label.indexOf(' - ');
    return { title: dash > 0 ? label.slice(dash + 3) : label, artist: dash > 0 ? label.slice(0, dash) : '', album: '', duration: Math.max(0, Number(it.length) || 0), isrc: '' };
  }).filter((e) => e.title);
  return entries.length ? [{ name: fallbackName, entries }] : [];
}

const xmlDecode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function parseXspf(text, fallbackName) {
  const tag = (block, name) => {
    const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
    return m ? xmlDecode(m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()) : '';
  };
  const title = tag(text.replace(/<trackList>[\s\S]*<\/trackList>/i, ''), 'title');
  const entries = [];
  for (const m of text.matchAll(/<track>([\s\S]*?)<\/track>/gi)) {
    const b = m[1];
    const t = tag(b, 'title');
    if (!t) continue;
    entries.push({ title: t, artist: tag(b, 'creator'), album: tag(b, 'album'), duration: (Number(tag(b, 'duration')) || 0) / 1000, isrc: '' });
  }
  return entries.length ? [{ name: title || fallbackName, entries }] : [];
}

// Returns [{ name, entries: [{title, artist, album, duration, isrc}] }]
export function parsePlaylistFile(filename, text) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const base = filename.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Imported playlist';
  const body = text.replace(/^﻿/, '');
  const head = body.trimStart().slice(0, 12).toLowerCase();
  if (ext === 'json') return parseJson(body, base);
  if (ext === 'm3u' || ext === 'm3u8') return parseM3u(body, base);
  if (ext === 'pls') return parsePls(body, base);
  if (ext === 'xspf') return parseXspf(body, base);
  // Unknown extension: sniff the content.
  if (/^\s*(\{|\[\s*[[{"\]])/.test(body.slice(0, 40))) return parseJson(body, base);
  if (head.startsWith('#extm3u')) return parseM3u(body, base);
  if (head.startsWith('[playlist]')) return parsePls(body, base);
  if (head.startsWith('<?xml') || head.startsWith('<playlist')) return parseXspf(body, base);
  const delimited = parseDelimited(body, base);
  return delimited.length ? delimited : parseM3u(body, base);
}

// ---------- Matching against the library ----------

export function cleanTitle(s) {
  return norm(s)
    .replace(/\s*[([][^)\]]*(feat|ft\.|with|remaster|remastered|live|version|edit|mono|stereo|deluxe|bonus|explicit)[^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+(\d{4}\s+)?(remaster(ed)?|live|mono|stereo|single version|radio edit).*$/g, '')
    .replace(/\s+(feat\.?|ft\.?)\s+.*$/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildMatcher(tracks) {
  const byKey = new Map();
  const byTitle = new Map();
  for (const t of tracks) {
    const ct = cleanTitle(t.title);
    const ca = cleanTitle(t.artist);
    const key = `${ct}|${ca}`;
    if (!byKey.has(key)) byKey.set(key, t);
    if (!byTitle.has(ct)) byTitle.set(ct, []);
    byTitle.get(ct).push(t);
  }
  return function match(entry) {
    const ct = cleanTitle(entry.title);
    const ca = cleanTitle(entry.artist);
    if (!ct) return null;
    const exact = byKey.get(`${ct}|${ca}`);
    if (exact) return exact;
    const candidates = byTitle.get(ct) || [];
    if (!candidates.length) return null;
    const scored = candidates.map((t) => {
      let score = 0;
      const tc = cleanTitle(t.artist);
      if (!ca) score += 0.4;
      else if (tc.includes(ca) || ca.includes(tc)) score += 1;
      if (entry.album && cleanTitle(entry.album) === cleanTitle(t.album)) score += 0.5;
      if (entry.duration && t.duration && Math.abs(entry.duration - t.duration) <= 3) score += 0.5;
      return { t, score };
    }).sort((a, b) => b.score - a.score);
    return scored[0].score >= 1 || (!ca && scored[0].score >= 0.4) ? scored[0].t : null;
  };
}
