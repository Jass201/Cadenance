// Generates a small demo library entirely in the browser: synthesized instrumentals,
// generated cover art, and original lyrics (one track with word-level timings).
// Everything here is original; nothing is sampled from real recordings.
import { hashStr } from './util.js';

const SR = 22050;

const ALBUMS = [
  { name: 'Night Shift', artist: 'Lumen Park', year: 2023, hue: 255, tracks: [
    ['Neon Harbor', 220, 96, [0, 5, 3, 7], ['The harbor hums in neon blue', 'Every window knows your name', 'I follow the light across the water', 'Nothing here is quite the same', 'Hold the night a little longer', 'Let the tide decide the rest']],
    ['Glass Orchard', 196, 84, [0, 3, 8, 5], ['Branches made of morning glass', 'Fruit that shines but will not fall', 'I count the colours as they slip away', 'Leaning on a quiet wall', 'Every season sounds like silver', 'Every silence leaves a mark']],
    ['Paper Satellites', 247, 108, [0, 7, 5, 3], ['Fold a wish into a wing', 'Send it up above the roofs', 'Tiny signals in the dark', 'Circling for no one but us', 'If the static ever clears', 'Tell me what you heard']],
    ['Slow Orbit', 175, 72, [0, 5, 7, 5], ['We drift around the same bright spot', 'Never close and never gone', 'Gravity is just a habit', 'Pulling gently, holding on', 'Take the long way round tonight', 'The long way is the song']],
  ] },
  { name: 'Low Tide Letters', artist: 'The Tide Clerks', year: 2021, hue: 195, tracks: [
    ['Salt on the Window', 233, 92, [0, 8, 3, 10], ['Salt on the window, sun on the floor', 'The kettle is singing the morning in', 'I wrote you a letter and lost the end', 'So I started over again', 'Postmarked for somewhere the sea keeps', 'Signed with a wave of the hand']],
    ['Harbor Lights Out', 208, 78, [0, 3, 5, 7], ['One by one the lamps go dim', 'Boats lean in against the pier', 'Somebody hums a half-known tune', 'Nobody minds who can hear', 'Lights out, lights out on the harbor', 'Dark is only a kinder light']],
    ['Quiet Engines', 262, 116, [0, 5, 10, 7], ['Quiet engines under the floor', 'Carry us further than we planned', 'Counting the miles in the rattle of cups', 'Keeping time with the land', 'Wake me when the hills turn gold', 'Wake me when we land']],
    ['Morning Ledger', 185, 88, [0, 7, 3, 5], ['Write down everything that stayed', 'Write down what you let go', 'Balance the page in a steady hand', 'Leave a little room to grow', 'Every line is a small beginning', 'Every sum is almost home']],
  ] },
  { name: 'Soft Static', artist: 'Marlo Vale', year: 2025, hue: 335, tracks: [
    ['Velvet Static', 240, 100, [0, 3, 7, 10], ['Velvet static on the radio', 'Voices folded into sleep', 'Turn the dial to nowhere softly', 'Nowhere has a place to keep', 'Let the hiss become a blanket', 'Let it hold us till the dawn']],
    ['Afterglow Avenue', 215, 112, [0, 5, 8, 3], ['Streetlights blooming one by one', 'Afterglow on every door', 'We walk where the pavement remembers', 'Footsteps from the night before', 'Take my hand and take the corner', 'Nothing here is far']],
    ['Small Hours', 190, 68, [0, 7, 5, 8], ['The small hours keep their promises', 'Quiet as a folded sheet', 'Somewhere a clock forgets to hurry', 'Somewhere a street is sweet', 'Stay awake just a little while', 'Stay awake with me']],
    ['Kite Season', 270, 120, [0, 4, 7, 5], ['The wind is up and so are we', 'String between the sky and hand', 'Run until the hill runs out', 'Let the colours understand', 'Higher, higher, nobody counting', 'Higher than the roofs']],
  ] },
];

const MAJOR = [0, 4, 7];
const MINOR = [0, 3, 7];
const midi = (f, semis) => f * 2 ** (semis / 12);

function addNote(out, start, dur, freq, amp, kind) {
  const s0 = Math.floor(start * SR);
  const len = Math.floor(dur * SR);
  for (let i = 0; i < len && s0 + i < out.length; i++) {
    const t = i / SR;
    const attack = Math.min(1, t / 0.008);
    const env = attack * Math.exp(-t * (kind === 'pad' ? 0.6 : kind === 'bass' ? 3.2 : 6.5));
    const ph = 2 * Math.PI * freq * t;
    let v;
    if (kind === 'pad') v = Math.sin(ph) + 0.4 * Math.sin(ph * 2.003);
    else if (kind === 'bass') v = Math.sin(ph) + 0.25 * Math.sin(ph * 2);
    else v = (2 / Math.PI) * Math.asin(Math.sin(ph)) + 0.15 * Math.sin(ph * 3); // triangle-ish pluck
    out[s0 + i] += v * env * amp;
  }
}

function synth({ root, bpm, prog, seconds, seed }) {
  const out = new Float32Array(Math.floor(SR * seconds));
  const beat = 60 / bpm;
  const beats = Math.floor(seconds / beat);
  let rnd = seed || 1;
  const rand = () => { rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0; return rnd / 4294967296; };
  for (let b = 0; b < beats; b++) {
    const t = b * beat;
    const bar = Math.floor(b / 4);
    const chordRoot = prog[bar % prog.length];
    const third = prog[bar % prog.length] % 5 === 0 ? MAJOR : MINOR;
    const tones = third.map((x) => chordRoot + x);
    if (b % 4 === 0) tones.forEach((s) => addNote(out, t, beat * 4, midi(root, s), 0.07, 'pad'));
    addNote(out, t, beat * 0.9, midi(root / 4, chordRoot), 0.28, 'bass');
    const kickLen = Math.floor(0.2 * SR);
    for (let i = 0; i < kickLen; i++) {
      const tt = i / SR;
      const idx = Math.floor(t * SR) + i;
      if (idx < out.length) out[idx] += Math.sin(2 * Math.PI * (45 * tt + 75 * (1 - Math.exp(-tt * 28)) / 28)) * Math.exp(-tt * 18) * 0.5;
    }
    for (let e = 0; e < 2; e++) {
      const st = t + e * beat * 0.5;
      addNote(out, st, beat * 0.5, midi(root * 2, tones[(b * 2 + e) % tones.length]), 0.12, 'arp');
      if (e === 1) {
        const n = Math.floor(0.04 * SR);
        const s0 = Math.floor(st * SR);
        for (let i = 0; i < n && s0 + i < out.length; i++) out[s0 + i] += (rand() * 2 - 1) * Math.exp(-i / (SR * 0.01)) * 0.06;
      }
    }
  }
  // fade in/out and normalise
  const fade = Math.floor(0.6 * SR);
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    const g = Math.min(1, i / fade, (out.length - i) / fade);
    out[i] *= g;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  const k = peak ? 0.8 / peak : 1;
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

function wavBlob(samples) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const wr = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  wr(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); wr(8, 'WAVE'); wr(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wr(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Blob([buf], { type: 'audio/wav' });
}

function coverArt(hue, n, title) {
  const c = document.createElement('canvas');
  c.width = c.height = 360;
  const g = c.getContext('2d');
  const h1 = (hue + n * 14) % 360;
  const grad = g.createLinearGradient(0, 0, 360, 360);
  grad.addColorStop(0, `hsl(${h1} 70% 52%)`);
  grad.addColorStop(1, `hsl(${(h1 + 55) % 360} 75% 28%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 360, 360);
  const seed = hashStr(title);
  for (let i = 0; i < 6; i++) {
    const r = 40 + ((seed >> (i * 3)) & 63) * 2;
    g.beginPath();
    g.arc(((seed >> i) % 300) + 30, ((seed >> (i + 4)) % 300) + 30, r, 0, Math.PI * 2);
    g.fillStyle = `hsla(${(h1 + i * 30) % 360} 80% ${60 + (i % 3) * 8}% / 0.16)`;
    g.fill();
  }
  g.strokeStyle = 'rgba(255,255,255,.35)';
  g.lineWidth = 3;
  g.strokeRect(24, 24, 312, 312);
  return c.toDataURL('image/jpeg', 0.85);
}

const stamp = (sec) => {
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]`;
};

function buildLrc(lines, seconds, enhanced) {
  const first = 3;
  const gap = (seconds - first - 3) / lines.length;
  return lines.map((text, i) => {
    const t = first + i * gap;
    if (!enhanced) return stamp(t) + text;
    const words = text.split(' ');
    const per = (gap * 0.85) / words.length;
    return stamp(t) + words.map((w, k) => `<${stamp(t + k * per).slice(1, -1)}>${w}`).join(' ');
  }).join('\n');
}

export function generateDemo() {
  const tracks = [];
  const lyrics = {};
  const now = Date.now();
  ALBUMS.forEach((al, ai) => {
    al.tracks.forEach(([title, root, bpm, prog, words], ti) => {
      const seconds = 26 + ((ai * 4 + ti) % 4) * 2;
      const blob = wavBlob(synth({ root, bpm, prog, seconds, seed: hashStr(title) }));
      const id = 'demo-' + ai + '-' + ti;
      tracks.push({
        id, source: 'demo', volatile: true, title, artist: al.artist, albumArtist: al.artist, album: al.name,
        track: ti + 1, disc: 1, year: al.year, genre: 'Demo', duration: seconds,
        uri: URL.createObjectURL(blob), art: coverArt(al.hue, ti, title), addedAt: now - (ai * 4 + ti) * 60000,
      });
      lyrics[id] = { synced: true, text: buildLrc(words, seconds, ai === 0 && ti === 0), source: 'demo' };
    });
  });
  return { tracks, lyrics };
}
