// Extracts a two-colour palette from cover art (used for adaptive accents, visualizer colours, backdrops).
import { hexToRgb, rgbToHsl, hslToHex } from './settings.js';
import { S } from './state.js';

const cache = new Map();

// Colours shared by the visualizer and lyrics. `refreshThemeColors` re-reads the CSS variables
// whenever the theme changes; `setArtPalette` is called when the playing track changes.
let themeColors = { a: '#8b7bff', b: '#5eead4' };
let artPalette = null;
export function refreshThemeColors() {
  const cs = getComputedStyle(document.documentElement);
  themeColors = { a: cs.getPropertyValue('--accent').trim() || themeColors.a, b: cs.getPropertyValue('--accent-2').trim() || themeColors.b };
}
export function setArtPalette(p) { artPalette = p; }
export const currentArtPalette = () => artPalette;
export const getVizPalette = () => (S.settings.viz.color === 'art' && artPalette ? artPalette : themeColors);
export function lyricsActiveColor() {
  const c = S.settings.lyrics.activeColor;
  if (c === 'text') return 'var(--text)';
  if (c === 'art' && artPalette) return artPalette.a;
  return 'var(--accent)';
}

export function getPalette(url) {
  if (!url) return Promise.resolve(null);
  if (cache.has(url)) return cache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 24;
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, size, size);
        const { data } = g.getImageData(0, 0, size, size);
        const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
        for (let i = 0; i < data.length; i += 4) {
          const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
          const weight = s * (1 - Math.abs(l - 0.5) * 1.6) + 0.02;
          if (weight <= 0) continue;
          const b = buckets[Math.floor(h / 30) % 12];
          b.w += weight; b.r += data[i] * weight; b.g += data[i + 1] * weight; b.b += data[i + 2] * weight;
        }
        const ranked = buckets.map((b, i) => ({ ...b, i })).filter((b) => b.w > 0).sort((a, b) => b.w - a.w);
        if (!ranked.length) return resolve(null);
        const toHex = (b) => hslToHex(...(() => { const [h, s, l] = rgbToHsl(b.r / b.w, b.g / b.w, b.b / b.w); return [h, Math.max(s, 0.5), Math.min(0.62, Math.max(0.45, l))]; })());
        const a = toHex(ranked[0]);
        const second = ranked.find((b) => Math.min(Math.abs(b.i - ranked[0].i), 12 - Math.abs(b.i - ranked[0].i)) >= 2);
        const [h, s, l] = rgbToHsl(...hexToRgb(a));
        resolve({ a, b: second ? toHex(second) : hslToHex(h + 40, s, l) });
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  cache.set(url, p);
  return p;
}
