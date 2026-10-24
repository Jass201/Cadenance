// Settings screens: themes, custom colours, animation, visualizer, lyrics, audio, data.
import { h, download, pickFile, plural, fmtTime } from './util.js';
import { ic } from './icons.js';
import { S, getSetting, setSetting, replaceSettings, on, save } from './state.js';
import { api } from './bridge.js';
import { DEFAULTS, THEMES, SECTIONS, SCHEMA, effectiveTheme, mergeDeep } from './settings.js';
import { registerRoute, navigate } from './router.js';
import { Visualizer } from './visualizer.js';
import { LyricsView } from './lyrics.js';
import { parseLrc } from './lrc.js';
import { getVizPalette, lyricsActiveColor } from './art.js';
import { EQ_FREQS, EQ_PRESETS } from './player.js';
import { toast, confirmBox, bindRange, modal } from './ui.js';

let currentSection = 'appearance';

// ---------- generic controls ----------
function control(item, redraw) {
  const val = getSetting(item.key);
  let ctl;
  if (item.type === 'toggle') {
    ctl = h('button', { class: 'switch' + (val ? ' on' : ''), role: 'switch', 'aria-checked': String(!!val), 'aria-label': item.label, onClick: () => {
      setSetting(item.key, !getSetting(item.key));
      redraw();
    } }, h('span', { class: 'knob' }));
  } else if (item.type === 'select') {
    ctl = h('select', { class: 'select', 'aria-label': item.label, onChange: (e) => {
      setSetting(item.key, item.number ? Number(e.target.value) : e.target.value);
      redraw();
    } }, item.options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(val) }, label)));
  } else if (item.type === 'range') {
    const out = h('span', { class: 'range-val' });
    const input = h('input', { type: 'range', min: item.min, max: item.max, step: item.step, value: val, 'aria-label': item.label });
    const fmt = (v) => `${Number(v).toFixed(item.step < 1 ? (item.step < 0.1 ? 2 : 1) : 0)}${item.unit || ''}`;
    out.textContent = fmt(val);
    bindRange(input);
    input.addEventListener('input', () => { out.textContent = fmt(input.value); setSetting(item.key, Number(input.value)); });
    input.addEventListener('change', () => { if (SCHEMA_DEPENDS.has(item.key)) redraw(); });
    ctl = h('div', { class: 'range' }, input, out);
  }
  return h('div', { class: 'setting' },
    h('div', { class: 'setting-text' }, h('div', { class: 'setting-label' }, item.label), item.hint ? h('div', { class: 'setting-hint' }, item.hint) : null),
    ctl);
}
const SCHEMA_DEPENDS = new Set();

function controls(sectionId, redraw) {
  return h('div', { class: 'settings-list' }, SCHEMA[sectionId].filter((i) => !i.when || i.when(S.settings)).map((i) => control(i, redraw)));
}

// ---------- appearance ----------
function themeGallery(redraw) {
  const cur = getSetting('appearance.theme');
  return h('div', { class: 'theme-grid' }, Object.entries(THEMES).map(([id, t]) => h('button', {
    class: 'theme' + (cur === id ? ' on' : ''), 'aria-pressed': String(cur === id), title: t.name,
    onClick: () => { setSetting('appearance.theme', id); setSetting('appearance.custom', null); redraw(); },
  },
  h('span', { class: 'theme-prev', style: { background: t.bg } },
    h('span', { class: 'tp-side', style: { background: t.surface } }),
    h('span', { class: 'tp-line', style: { background: t.text, opacity: 0.8 } }),
    h('span', { class: 'tp-line s', style: { background: t.muted } }),
    h('span', { class: 'tp-dot', style: { background: `linear-gradient(135deg, ${t.accent}, ${t.accent2})` } })),
  h('span', { class: 'theme-name' }, t.name))));
}

function customColors(redraw) {
  const t = effectiveTheme(S.settings.appearance);
  const fields = [['bg', 'Background', t.bg], ['surface', 'Panels', t.surface], ['text', 'Text', t.text], ['accent', 'Accent', t.accent]];
  return h('div', { class: 'color-row' }, fields.map(([key, label, value]) => h('label', { class: 'color' },
    h('input', { type: 'color', value, 'aria-label': label, onInput: (e) => {
      setSetting('appearance.custom', { ...(getSetting('appearance.custom') || {}), [key]: e.target.value });
    }, onChange: redraw }),
    h('span', {}, label))),
  h('button', { class: 'btn small ghost', disabled: !getSetting('appearance.custom'), onClick: () => { setSetting('appearance.custom', null); redraw(); } }, 'Reset colours'));
}

function themeIO() {
  return h('div', { class: 'row-actions' },
    h('button', { class: 'btn small', onClick: () => download('cadence-theme.json', JSON.stringify({ cadenceTheme: 1, appearance: S.settings.appearance, motion: S.settings.motion, viz: S.settings.viz, lyrics: S.settings.lyrics }, null, 2)) }, 'Export theme'),
    h('button', { class: 'btn small', onClick: async () => {
      const [f] = await pickFile('.json');
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data.cadenceTheme) throw new Error('not a Cadence theme');
        replaceSettings({ ...S.settings, appearance: mergeDeep(DEFAULTS.appearance, data.appearance), motion: mergeDeep(DEFAULTS.motion, data.motion), viz: mergeDeep(DEFAULTS.viz, data.viz), lyrics: mergeDeep(DEFAULTS.lyrics, data.lyrics) });
        toast('Theme imported', { kind: 'ok' });
        navigate('settings', 'appearance', { replace: true });
      } catch { toast('That file isn’t a Cadence theme', { kind: 'error' }); }
    } }, 'Import theme'));
}

// ---------- panels ----------
function panel(id, cleanups) {
  const box = h('div', { class: 'panel-body' });
  const redraw = () => draw();
  function draw() {
    cleanups.splice(0).forEach((fn) => fn());
    box.replaceChildren();
    if (id === 'appearance') {
      box.append(h('h3', { class: 'group' }, 'Theme'), themeGallery(redraw),
        h('h3', { class: 'group' }, 'Custom colours'), customColors(redraw), themeIO(),
        h('h3', { class: 'group' }, 'Layout & feel'), controls('appearance', redraw));
    } else if (id === 'motion') {
      box.append(controls('motion', redraw));
    } else if (id === 'viz') {
      const canvas = h('canvas', { class: 'viz-preview', 'aria-label': 'Visualizer preview' });
      box.append(h('div', { class: 'preview-box' }, canvas, h('span', { class: 'preview-tag' }, 'Live preview')), controls('viz', redraw));
      const v = new Visualizer(canvas, { fake: true, getPalette: getVizPalette });
      v.start();
      cleanups.push(() => v.destroy());
    } else if (id === 'lyrics') {
      const root = h('div', { class: 'ly-preview' });
      box.append(h('div', { class: 'preview-box tall' }, root, h('span', { class: 'preview-tag' }, 'Live preview')), controls('lyrics', redraw));
      const view = new LyricsView(root, { onSeek: null });
      view.setColor(lyricsActiveColor());
      const sample = parseLrc('[00:01.00]<00:01.00>Every window <00:01.90>knows your <00:02.60>name\n[00:04.00]<00:04.00>I follow <00:04.80>the light <00:05.60>across the water\n[00:07.00]Nothing here is quite the same\n[00:10.00]Hold the night a little longer\n[00:13.00]Let the tide decide the rest\n[00:16.00]And we will not look back');
      view.set(sample);
      const t0 = performance.now();
      const timer = setInterval(() => view.update(((performance.now() - t0) % 19000) + 0), 80);
      const off = on('settings', () => { view.setColor(lyricsActiveColor()); view.set(sample); });
      cleanups.push(() => { clearInterval(timer); off(); });
    } else if (id === 'audio') {
      box.append(controls('audio', redraw), eqPanel(redraw));
    } else {
      box.append(aboutPanel());
    }
  }
  draw();
  return { box, destroy: () => cleanups.splice(0).forEach((fn) => fn()) };
}

function eqPanel(redraw) {
  const a = S.settings.audio;
  const presetNames = Object.keys(EQ_PRESETS);
  const isCustom = !presetNames.some((p) => EQ_PRESETS[p].every((v, i) => v === a.eq[i]));
  const labels = EQ_FREQS.map((f) => (f >= 1000 ? `${f / 1000}k` : String(f)));
  const sliders = h('div', { class: 'eq-sliders' }, a.eq.map((g, i) => {
    const input = h('input', { type: 'range', min: -12, max: 12, step: 1, value: g, class: 'eq-slider', 'aria-label': `${labels[i]} Hz`, disabled: !a.eqEnabled });
    input.addEventListener('input', () => {
      const eq = [...getSetting('audio.eq')];
      eq[i] = Number(input.value);
      setSetting('audio.eq', eq);
      setSetting('audio.eqPreset', 'custom');
      out.textContent = `${eq[i] > 0 ? '+' : ''}${eq[i]}`;
    });
    input.addEventListener('change', redraw);
    const out = h('span', { class: 'eq-val' }, `${g > 0 ? '+' : ''}${g}`);
    return h('div', { class: 'eq-band' }, out, input, h('span', { class: 'eq-lab' }, labels[i]));
  }));
  return h('div', {},
    h('h3', { class: 'group' }, 'Equalizer'),
    h('div', { class: 'settings-list' },
      control({ key: 'audio.eqEnabled', type: 'toggle', label: 'Enable equalizer' }, redraw),
      h('div', { class: 'setting' }, h('div', { class: 'setting-text' }, h('div', { class: 'setting-label' }, 'Preset')),
        h('select', { class: 'select', disabled: !a.eqEnabled, 'aria-label': 'EQ preset', onChange: (e) => {
          const p = e.target.value;
          if (EQ_PRESETS[p]) { setSetting('audio.eq', [...EQ_PRESETS[p]]); setSetting('audio.eqPreset', p); redraw(); }
        } }, [...presetNames.map((p) => h('option', { value: p, selected: !isCustom && a.eqPreset === p }, p[0].toUpperCase() + p.slice(1))), isCustom ? h('option', { value: 'custom', selected: true }, 'Custom') : null]))),
    sliders);
}

function aboutPanel() {
  const info = h('span', { class: 'muted' }, 'Loading…');
  api.info().then((i) => { info.textContent = `Cadence ${i.version} · ${i.platform} · data in ${i.data}`; });
  const row = (label, hint, ...btns) => h('div', { class: 'setting' }, h('div', { class: 'setting-text' }, h('div', { class: 'setting-label' }, label), h('div', { class: 'setting-hint' }, hint)), h('div', { class: 'row-actions' }, btns));
  return h('div', {},
    h('div', { class: 'settings-list' },
      row('Library', `${plural(S.tracks.length, 'track')} · ${plural(S.albums.length, 'album')} · ${plural(S.playlists.length, 'playlist')}`),
      row('Keyboard shortcuts', 'Everything in Cadence is reachable from the keyboard.', h('button', { class: 'btn small', onClick: showShortcuts }, ic('keyboard', 14), 'View shortcuts')),
      row('Play history', 'Clears “Jump back in” and “Most played”.', h('button', { class: 'btn small', onClick: async () => {
        if (await confirmBox('Clear play history?', 'Recently played and play counts will be reset.', { confirm: 'Clear', danger: true })) { S.history = []; S.plays = {}; save('state'); toast('Play history cleared'); }
      } }, 'Clear')),
      row('Lyrics cache', 'Lyrics you loaded manually or found online are stored locally.', h('button', { class: 'btn small', onClick: () => { S.lyricsCache = {}; save('lyrics'); toast('Lyrics cache cleared'); } }, 'Clear')),
      row('Reset settings', 'Restores every appearance, animation, visualizer, lyrics and audio option.', h('button', { class: 'btn small danger', onClick: async () => {
        if (await confirmBox('Reset all settings?', 'Your library and playlists are not affected.', { confirm: 'Reset', danger: true })) { replaceSettings({ ...DEFAULTS, library: S.settings.library }); navigate('settings', 'about', { replace: true }); }
      } }, 'Reset'))),
    h('p', { class: 'muted small about' }, info));
}

export function showShortcuts() {
  const keys = [
    ['Space', 'Play / pause'], ['Ctrl/⌘ + ← / →', 'Previous / next track'], ['← / →', 'Seek 5 seconds'], ['↑ / ↓', 'Volume'], ['M', 'Mute'],
    ['S', 'Shuffle'], ['R', 'Repeat'], ['F', 'Like current track'], ['L', 'Lyrics view'], ['V', 'Visualizer view'], ['Q', 'Queue'],
    ['/ or Ctrl/⌘ + K', 'Search'], ['Alt + ← / →', 'Back / forward'], ['Ctrl/⌘ + ,', 'Settings'], ['Esc', 'Close views and menus'],
  ];
  modal({ title: 'Keyboard shortcuts', width: 460, body: h('div', { class: 'shortcuts' }, keys.map(([k, d]) => h('div', { class: 'sc' }, h('kbd', {}, k), h('span', {}, d)))), actions: [{ label: 'Close', primary: true, value: null }] });
}

// ---------- the view ----------
function settingsView(section) {
  if (section && SECTIONS.some((s) => s.id === section)) currentSection = section;
  const cleanups = [];
  const el = h('div', { class: 'page settings' });
  const content = h('div', { class: 'settings-content' });
  let inner = null;
  const nav = h('nav', { class: 'settings-nav', 'aria-label': 'Settings sections' }, SECTIONS.map((s) => h('button', {
    class: 'snav' + (s.id === currentSection ? ' on' : ''), onClick: () => navigate('settings', s.id, { replace: true }),
  }, ic(s.icon, 16), s.label)));
  const sec = SECTIONS.find((s) => s.id === currentSection);
  inner = panel(currentSection, cleanups);
  content.append(h('h2', { class: 'settings-title' }, sec.label), inner.box);
  el.append(h('header', { class: 'page-head' }, h('h1', {}, 'Settings')), h('div', { class: 'settings-layout' }, nav, content));
  return { el, destroy: () => { inner.destroy(); cleanups.splice(0).forEach((fn) => fn()); } };
}

export function registerSettings() {
  registerRoute('settings', settingsView);
}
