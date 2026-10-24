// Lyrics loading (local file / embedded tags / optional LRCLIB lookup / manual) and the synced view.
import { api } from './bridge.js';
import { S, save } from './state.js';
import { parseLrc, activeIndex } from './lrc.js';
import { h, clamp } from './util.js';

const triedOnline = new Set();
const CACHEABLE = new Set(['lrclib', 'manual', 'demo']);

const toParsed = (found) => ({ ...parseLrc(found.text), source: found.source || 'file' });

export async function getLyrics(track, { allowOnline = true } = {}) {
  if (S.demoLyrics && S.demoLyrics[track.id]) return toParsed(S.demoLyrics[track.id]);
  const cached = S.lyricsCache[track.id];
  if (cached) return toParsed(cached);
  let found = null;
  try { found = await api.lyrics.local(track.id); } catch { /* none */ }
  if (!found && allowOnline && S.settings.lyrics.autoFetch && track.artist && !triedOnline.has(track.id)) {
    triedOnline.add(track.id);
    found = await fetchOnline(track);
  }
  if (found && CACHEABLE.has(found.source)) { S.lyricsCache[track.id] = found; save('lyrics'); }
  return found ? toParsed(found) : null;
}

export async function fetchOnline(track) {
  try {
    const found = await api.lyrics.online({ title: track.title, artist: track.artist, album: track.album, duration: track.duration });
    if (found) { S.lyricsCache[track.id] = found; save('lyrics'); }
    return found;
  } catch { return null; }
}

export function setManualLyrics(trackId, text) {
  const found = { synced: /\[\d+:\d+/.test(text), text, source: 'manual' };
  S.lyricsCache[trackId] = found;
  save('lyrics');
  return toParsed(found);
}

export const offsetFor = (id) => S.lyricOffsets[id] || 0;
export function nudgeOffset(id, deltaMs) {
  S.lyricOffsets[id] = clamp((S.lyricOffsets[id] || 0) + deltaMs, -10000, 10000);
  save('state');
  return S.lyricOffsets[id];
}

// Renders lyrics into `root` and follows playback position.
export class LyricsView {
  constructor(root, { onSeek, onLoadFile, onSearchOnline, onPaste, compact = false, windowLines = 0 } = {}) {
    this.root = root;
    this.opts = { onSeek, onLoadFile, onSearchOnline, onPaste, compact, windowLines };
    this.parsed = null;
    this.els = [];
    this.active = -2;
    this.root.classList.add('lyrics-view');
    this.root.classList.toggle('compact', compact);
  }

  setColor(color) { this.root.style.setProperty('--ly-active', color); }

  empty(message, { actions = true, loading = false } = {}) {
    this.parsed = null;
    this.els = [];
    this.root.replaceChildren(h('div', { class: 'ly-empty' },
      h('p', {}, message),
      actions && !loading ? h('div', { class: 'ly-actions' },
        this.opts.onLoadFile && h('button', { class: 'btn small', onClick: this.opts.onLoadFile }, 'Load .lrc file'),
        this.opts.onPaste && h('button', { class: 'btn small', onClick: this.opts.onPaste }, 'Paste lyrics'),
        this.opts.onSearchOnline && h('button', { class: 'btn small', onClick: this.opts.onSearchOnline }, 'Search online')) : null));
  }

  set(parsed) {
    this.parsed = parsed;
    this.active = -2;
    this.els = [];
    this.root.scrollTop = 0;
    if (!parsed || !parsed.lines.length) { this.empty('No lyrics for this track.'); return; }
    const wordMode = S.settings.lyrics.wordHighlight;
    const frag = document.createDocumentFragment();
    parsed.lines.forEach((line, i) => {
      const p = h('p', { class: 'ly-line' + (parsed.synced ? '' : ' plain') + (line.text ? '' : ' gap'), 'data-i': i });
      if (parsed.synced && wordMode && line.words) {
        line.words.forEach((w) => p.append(h('span', { class: 'w', style: { '--wp': 0 } }, w.text)));
        p.classList.add('has-words');
      } else p.textContent = line.text || ' ';
      if (parsed.synced && this.opts.onSeek) p.addEventListener('click', () => this.opts.onSeek(line.t));
      this.els.push(p);
      frag.append(p);
    });
    this.root.replaceChildren(h('div', { class: 'ly-pad' }), frag, h('div', { class: 'ly-pad' }));
    this.applyStyles();
  }

  applyStyles() {
    if (!this.parsed || !this.parsed.synced) return;
    const s = S.settings.lyrics;
    const a = this.active;
    this.els.forEach((el, i) => {
      const d = Math.abs(i - a);
      el.classList.toggle('is-active', i === a);
      el.classList.toggle('is-past', i < a);
      const hidden = this.opts.windowLines && d > this.opts.windowLines;
      el.hidden = !!hidden;
      if (i === a) { el.style.opacity = 1; el.style.filter = 'none'; return; }
      const op = a < 0 && i === 0 ? Math.min(1, s.inactiveOpacity + 0.25) : Math.max(0.08, s.inactiveOpacity * (1 - Math.min(d - 1, 6) * 0.1));
      el.style.opacity = op.toFixed(2);
      el.style.filter = s.blur ? `blur(${(Math.min(d, 4) / 4 * s.blurAmount).toFixed(1)}px)` : 'none';
      const words = this.parsed.lines[i].words;
      if (words && s.wordHighlight) el.querySelectorAll('.w').forEach((w) => w.style.setProperty('--wp', 0));
    });
  }

  update(posMs) {
    if (!this.parsed || !this.parsed.synced) return;
    const i = activeIndex(this.parsed.lines, posMs);
    if (i !== this.active) {
      this.active = i;
      this.applyStyles();
      this.scrollToActive();
    }
    const line = this.parsed.lines[i];
    if (line && line.words && S.settings.lyrics.wordHighlight) {
      const spans = this.els[i].querySelectorAll('.w');
      line.words.forEach((w, k) => {
        const end = k + 1 < line.words.length ? line.words[k + 1].t : line.end;
        const p = clamp((posMs - w.t) / Math.max(120, end - w.t), 0, 1);
        spans[k].style.setProperty('--wp', (p * 100).toFixed(0));
      });
    }
  }

  scrollToActive() {
    if (this.opts.compact || this.active < 0) return;
    const el = this.els[this.active];
    if (!el) return;
    const top = el.offsetTop - this.root.clientHeight * 0.36 + el.offsetHeight / 2;
    this.root.scrollTo({ top, behavior: S.settings.lyrics.smoothScroll && document.documentElement.dataset.motion !== 'off' ? 'smooth' : 'auto' });
  }
}
