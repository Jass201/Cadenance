// Settings model: defaults, themes, the declarative schema the settings UI is built from,
// and the code that turns appearance settings into CSS variables.

export const DEFAULTS = {
  appearance: {
    theme: 'midnight',
    custom: null,          // { bg, surface, text, accent } overrides on top of the theme
    adaptive: false,       // take the accent colour from the current album art
    radius: 14,
    density: 'comfortable',
    font: 'system',
    scale: 100,
    glass: 0,
    artBackdrop: true,
    gridSize: 'medium',
    nowPlayingPanel: true,
  },
  motion: {
    mode: 'system',        // system | on | off
    speed: 1,
    pageTransitions: true,
    hoverLift: true,
    spinArt: false,
    pulseArt: true,
  },
  viz: {
    mode: 'bars',
    color: 'gradient',
    sensitivity: 1.3,
    smoothing: 0.8,
    bars: 48,
    glow: true,
    fps: 60,
    onArt: true,
    fullOpacity: 0.85,
  },
  lyrics: {
    size: 34,
    align: 'left',
    activeColor: 'accent',
    inactiveOpacity: 0.32,
    blur: true,
    blurAmount: 2.5,
    spacing: 1.35,
    font: 'inherit',
    wordHighlight: true,
    smoothScroll: true,
    autoFetch: false,
  },
  audio: {
    crossfade: 0,
    gapless: true,
    normalize: false,
    eqEnabled: false,
    eqPreset: 'flat',
    eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    speed: 1,
  },
  library: { folders: [] },
};

export const THEMES = {
  midnight: { name: 'Midnight', dark: true, bg: '#0d0e12', surface: '#14161b', elevated: '#1c1f26', text: '#eceef3', muted: '#8a8f9c', accent: '#8b7bff', accent2: '#5eead4' },
  amoled:   { name: 'Amoled',   dark: true, bg: '#000000', surface: '#0a0a0a', elevated: '#151515', text: '#f2f2f2', muted: '#868686', accent: '#ff4d6d', accent2: '#ff9f43' },
  graphite: { name: 'Graphite', dark: true, bg: '#17181a', surface: '#1f2124', elevated: '#292c30', text: '#e8e8e6', muted: '#94979c', accent: '#e2b86b', accent2: '#e08e6b' },
  nord:     { name: 'Nord',     dark: true, bg: '#2e3440', surface: '#343b49', elevated: '#3b4252', text: '#eceff4', muted: '#9aa5b8', accent: '#88c0d0', accent2: '#b48ead' },
  rose:     { name: 'Rosé',     dark: true, bg: '#191724', surface: '#1f1d2e', elevated: '#26233a', text: '#e0def4', muted: '#908caa', accent: '#eb6f92', accent2: '#f6c177' },
  forest:   { name: 'Forest',   dark: true, bg: '#0f1512', surface: '#151e19', elevated: '#1d2823', text: '#e4eee8', muted: '#86998e', accent: '#6ee7a0', accent2: '#d9f99d' },
  sunset:   { name: 'Sunset',   dark: true, bg: '#1a1015', surface: '#231720', elevated: '#2d1e2a', text: '#fbeee9', muted: '#b39598', accent: '#ff7a59', accent2: '#ffc857' },
  ocean:    { name: 'Ocean',    dark: true, bg: '#08141f', surface: '#0e1d2b', elevated: '#152738', text: '#e6f1fa', muted: '#7f9bb3', accent: '#38bdf8', accent2: '#818cf8' },
  paper:    { name: 'Paper',    dark: false, bg: '#f4f1ea', surface: '#fbf9f4', elevated: '#ffffff', text: '#1d1c1a', muted: '#77736b', accent: '#d9480f', accent2: '#e8890c' },
  daylight: { name: 'Daylight', dark: false, bg: '#f1f4f9', surface: '#ffffff', elevated: '#ffffff', text: '#14171f', muted: '#6b7280', accent: '#5b4bff', accent2: '#06b6d4' },
};

export const FONTS = {
  system: { name: 'System', stack: 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif' },
  humanist: { name: 'Humanist', stack: '"Segoe UI","Gill Sans","Trebuchet MS",Optima,Candara,sans-serif' },
  rounded: { name: 'Rounded', stack: 'ui-rounded,"SF Pro Rounded","Hiragino Maru Gothic ProN",Quicksand,Nunito,"Varela Round",system-ui,sans-serif' },
  serif: { name: 'Serif', stack: '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif' },
  mono: { name: 'Mono', stack: 'ui-monospace,"JetBrains Mono","Cascadia Code",Menlo,Consolas,monospace' },
};

// ---------- helpers ----------
export function deepGet(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
export function deepSet(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys[keys.length - 1]] = value;
}
export function mergeDeep(base, extra) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return extra === undefined ? base : extra;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) out[k] = k in base ? mergeDeep(base[k], v) : v;
  return out;
}

export function hexToRgb(hex) {
  const m = String(hex).replace('#', '').match(/^([\da-f]{3}|[\da-f]{6})$/i);
  if (!m) return [128, 128, 128];
  let s = m[1];
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const onColor = (hex) => (luminance(hex) > 0.42 ? '#111111' : '#ffffff');
export function shiftHue(hex, deg) {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  return hslToHex(h + deg, s, l);
}
// Keep adaptive accents readable against the current background.
export function legibleAccent(hex, dark) {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  const ss = Math.max(0.45, s);
  const ll = dark ? Math.min(0.72, Math.max(0.55, l)) : Math.min(0.45, Math.max(0.3, l));
  return hslToHex(h, ss, ll);
}

export function effectiveTheme(appearance) {
  const base = THEMES[appearance.theme] || THEMES.midnight;
  const c = appearance.custom || {};
  const t = { ...base };
  if (c.bg) t.bg = c.bg;
  if (c.surface) { t.surface = c.surface; t.elevated = c.elevated || shiftLight(c.surface, base.dark ? 0.04 : -0.02); }
  if (c.text) t.text = c.text;
  if (c.accent) { t.accent = c.accent; t.accent2 = shiftHue(c.accent, 45); }
  return t;
}
function shiftLight(hex, d) {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  return hslToHex(h, s, Math.min(1, Math.max(0, l + d)));
}

export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
export function motionOff(settings) {
  const m = settings.motion.mode;
  return m === 'off' || (m === 'system' && prefersReducedMotion());
}

// Writes CSS variables + data attributes for the current settings. artColor: optional hex from album art.
export function applyAppearance(settings, artColor) {
  const a = settings.appearance;
  const m = settings.motion;
  const l = settings.lyrics;
  const t = effectiveTheme(a);
  const root = document.documentElement;
  const st = root.style;
  let accent = t.accent, accent2 = t.accent2;
  if (a.adaptive && artColor) { accent = legibleAccent(artColor, t.dark); accent2 = shiftHue(accent, 45); }
  st.setProperty('--bg', t.bg);
  st.setProperty('--surface', t.surface);
  st.setProperty('--surface-2', t.elevated);
  st.setProperty('--text', t.text);
  st.setProperty('--muted', t.muted);
  st.setProperty('--accent', accent);
  st.setProperty('--accent-2', accent2);
  st.setProperty('--on-accent', onColor(accent));
  st.setProperty('--radius', a.radius + 'px');
  st.setProperty('--glass-mix', (100 - a.glass * 0.55).toFixed(0) + '%');
  st.setProperty('--glass-blur', (a.glass * 0.28).toFixed(1) + 'px');
  st.setProperty('--speed', String(m.speed));
  st.setProperty('--font', (FONTS[a.font] || FONTS.system).stack);
  st.setProperty('--ly-size', l.size + 'px');
  st.setProperty('--ly-spacing', String(l.spacing));
  st.setProperty('--ly-align', l.align);
  st.setProperty('--ly-font', l.font === 'inherit' ? 'inherit' : (FONTS[l.font] || FONTS.system).stack);
  st.fontSize = (16 * a.scale / 100).toFixed(2) + 'px';
  st.colorScheme = t.dark ? 'dark' : 'light';
  root.dataset.dark = t.dark ? '1' : '0';
  root.dataset.density = a.density;
  root.dataset.grid = a.gridSize;
  root.dataset.motion = motionOff(settings) ? 'off' : 'on';
  root.dataset.hover = m.hoverLift ? 'on' : 'off';
  root.dataset.transitions = m.pageTransitions ? 'on' : 'off';
  root.dataset.spin = m.spinArt ? 'on' : 'off';
  root.dataset.pulse = m.pulseArt ? 'on' : 'off';
  root.dataset.backdrop = a.artBackdrop ? 'on' : 'off';
  return { accent, accent2 };
}

// ---------- Declarative schema for the settings screens ----------
export const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: 'settings' },
  { id: 'motion', label: 'Animation', icon: 'refresh' },
  { id: 'viz', label: 'Visualizer', icon: 'viz' },
  { id: 'lyrics', label: 'Lyrics', icon: 'lyrics' },
  { id: 'audio', label: 'Audio', icon: 'volume' },
  { id: 'about', label: 'Data & about', icon: 'file' },
];

const opts = (obj) => Object.entries(obj).map(([value, v]) => [value, v.name]);

export const VIZ_MODES = [['bars', 'Bars'], ['mirror', 'Mirror'], ['wave', 'Waveform'], ['radial', 'Radial'], ['particles', 'Particles'], ['aurora', 'Aurora'], ['off', 'Off']];

export const SCHEMA = {
  appearance: [
    { key: 'appearance.glass', type: 'range', label: 'Translucency', min: 0, max: 100, step: 1, unit: '%', hint: 'Blurs the album-art backdrop through panels.' },
    { key: 'appearance.artBackdrop', type: 'toggle', label: 'Album-art backdrop', hint: 'A soft glow of the current cover behind the interface.' },
    { key: 'appearance.adaptive', type: 'toggle', label: 'Adaptive accent', hint: 'Pull the accent colour from the playing track’s cover art.' },
    { key: 'appearance.radius', type: 'range', label: 'Corner radius', min: 0, max: 28, step: 1, unit: 'px' },
    { key: 'appearance.scale', type: 'range', label: 'Interface size', min: 80, max: 130, step: 5, unit: '%' },
    { key: 'appearance.density', type: 'select', label: 'Density', options: [['comfortable', 'Comfortable'], ['compact', 'Compact']] },
    { key: 'appearance.gridSize', type: 'select', label: 'Cover size', options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] },
    { key: 'appearance.font', type: 'select', label: 'Font', options: opts(FONTS) },
    { key: 'appearance.nowPlayingPanel', type: 'toggle', label: 'Show Now Playing panel', hint: 'The right-hand sidebar with cover, lyrics and queue.' },
  ],
  motion: [
    { key: 'motion.mode', type: 'select', label: 'Animations', options: [['system', 'Follow system'], ['on', 'Always on'], ['off', 'Off']], hint: 'Turn this off to remove all UI motion.' },
    { key: 'motion.speed', type: 'range', label: 'Animation speed', min: 0.5, max: 2, step: 0.1, unit: '×' },
    { key: 'motion.pageTransitions', type: 'toggle', label: 'Page transitions' },
    { key: 'motion.hoverLift', type: 'toggle', label: 'Hover lift on covers' },
    { key: 'motion.pulseArt', type: 'toggle', label: 'Cover pulses with the beat', hint: 'The Now Playing cover gently scales to the bass.' },
    { key: 'motion.spinArt', type: 'toggle', label: 'Spinning vinyl cover', hint: 'Turns the Now Playing cover into a spinning disc.' },
  ],
  viz: [
    { key: 'viz.mode', type: 'select', label: 'Style', options: VIZ_MODES },
    { key: 'viz.color', type: 'select', label: 'Colour', options: [['accent', 'Accent'], ['gradient', 'Accent gradient'], ['art', 'From album art'], ['rainbow', 'Rainbow']] },
    { key: 'viz.sensitivity', type: 'range', label: 'Sensitivity', min: 0.4, max: 3, step: 0.1, unit: '×' },
    { key: 'viz.smoothing', type: 'range', label: 'Smoothing', min: 0, max: 0.95, step: 0.01 },
    { key: 'viz.bars', type: 'range', label: 'Bar count', min: 12, max: 128, step: 2, when: (s) => ['bars', 'mirror', 'radial'].includes(s.viz.mode) },
    { key: 'viz.glow', type: 'toggle', label: 'Glow' },
    { key: 'viz.fps', type: 'select', label: 'Frame rate', options: [['30', '30 fps'], ['60', '60 fps']], number: true },
    { key: 'viz.onArt', type: 'toggle', label: 'Show on the Now Playing cover' },
    { key: 'viz.fullOpacity', type: 'range', label: 'Full-screen intensity', min: 0.2, max: 1, step: 0.05 },
  ],
  lyrics: [
    { key: 'lyrics.size', type: 'range', label: 'Text size', min: 18, max: 64, step: 1, unit: 'px' },
    { key: 'lyrics.align', type: 'select', label: 'Alignment', options: [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] },
    { key: 'lyrics.font', type: 'select', label: 'Font', options: [['inherit', 'Match interface'], ...opts(FONTS)] },
    { key: 'lyrics.activeColor', type: 'select', label: 'Active line colour', options: [['accent', 'Accent'], ['text', 'Text'], ['art', 'From album art']] },
    { key: 'lyrics.inactiveOpacity', type: 'range', label: 'Inactive line opacity', min: 0.1, max: 0.9, step: 0.02 },
    { key: 'lyrics.blur', type: 'toggle', label: 'Blur inactive lines' },
    { key: 'lyrics.blurAmount', type: 'range', label: 'Blur amount', min: 0.5, max: 6, step: 0.5, unit: 'px', when: (s) => s.lyrics.blur },
    { key: 'lyrics.spacing', type: 'range', label: 'Line spacing', min: 1, max: 2, step: 0.05 },
    { key: 'lyrics.wordHighlight', type: 'toggle', label: 'Word-by-word highlight', hint: 'Used when the lyrics file has word timings (enhanced LRC).' },
    { key: 'lyrics.smoothScroll', type: 'toggle', label: 'Smooth scrolling' },
    { key: 'lyrics.autoFetch', type: 'toggle', label: 'Look up missing lyrics online', hint: 'Queries lrclib.net with the title, artist, album and length. Off by default.' },
  ],
  audio: [
    { key: 'audio.crossfade', type: 'range', label: 'Crossfade', min: 0, max: 12, step: 1, unit: 's', hint: '0 keeps tracks back-to-back with only a tiny overlap.' },
    { key: 'audio.normalize', type: 'toggle', label: 'Normalize volume', hint: 'Applies ReplayGain tags when present and a gentle limiter.' },
    { key: 'audio.speed', type: 'range', label: 'Playback speed', min: 0.5, max: 2, step: 0.05, unit: '×' },
  ],
};
