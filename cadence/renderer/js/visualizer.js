// Canvas audio visualizer with several styles. One class drives every canvas in the app
// (Now Playing cover, full-screen view, settings preview).
import { S } from './state.js';
import { player } from './player.js';
import { hexToRgb } from './settings.js';

const mix = (c1, c2, t) => {
  const a = hexToRgb(c1), b = hexToRgb(c2);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
};

let bassEnv = 0;
const bassBuf = { buf: null };
// Smoothed bass energy (0..1), used by the cover "pulse" effect.
export function bassLevel() {
  const an = player.analyser;
  if (!an || !player.playing) { bassEnv *= 0.85; return bassEnv; }
  if (!bassBuf.buf || bassBuf.buf.length !== an.frequencyBinCount) bassBuf.buf = new Uint8Array(an.frequencyBinCount);
  an.getByteFrequencyData(bassBuf.buf);
  let sum = 0;
  for (let i = 1; i < 8; i++) sum += bassBuf.buf[i];
  const v = Math.min(1, (sum / 7 / 255) * 1.25);
  bassEnv = v > bassEnv ? v : bassEnv * 0.88;
  return bassEnv;
}

export class Visualizer {
  constructor(canvas, { getPalette, fake = false, mode = null, compact = false } = {}) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.getPalette = getPalette || (() => ({ a: '#8b7bff', b: '#5eead4' }));
    this.fake = fake;
    this.modeOverride = mode;
    this.compact = compact;
    this.bars = new Float32Array(128);
    this.parts = [];
    this.raf = 0;
    this.last = 0;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  resize() {
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  start() { if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t)); }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; this.g.clearRect(0, 0, this.canvas.width, this.canvas.height); }
  destroy() { this.stop(); this.ro.disconnect(); }

  get mode() { return this.modeOverride || S.settings.viz.mode; }

  readData(t) {
    const an = player.analyser;
    const live = an && player.playing;
    const bins = an ? an.frequencyBinCount : 1024;
    if (!this.freq || this.freq.length !== bins) { this.freq = new Uint8Array(bins); this.td = new Uint8Array(bins * 2); }
    if (live) {
      an.smoothingTimeConstant = 0.55;
      an.getByteFrequencyData(this.freq);
      an.getByteTimeDomainData(this.td);
      return true;
    }
    if (this.fake) {
      const s = t / 1000;
      const beat = Math.pow(Math.max(0, Math.sin(s * 5.2)), 6);
      for (let i = 0; i < bins; i++) {
        const f = i / bins;
        this.freq[i] = 255 * Math.max(0, (0.35 + 0.35 * Math.sin(s * 2.1 + i * 0.045) + 0.3 * beat * (1 - f * 4)) * Math.exp(-f * 5.5));
      }
      for (let i = 0; i < this.td.length; i++) {
        const x = i / this.td.length;
        this.td[i] = 128 + 70 * (Math.sin(x * 38 + s * 4) * 0.6 + Math.sin(x * 91 - s * 7) * 0.3 * (0.5 + beat));
      }
      return true;
    }
    this.freq.fill(0);
    this.td.fill(128);
    return false;
  }

  colorAt(frac, pal) {
    const mode = S.settings.viz.color;
    if (mode === 'accent') return pal.a;
    if (mode === 'rainbow') return `hsl(${Math.round(frac * 300 + 200) % 360} 85% 62%)`;
    return mix(pal.a, pal.b, frac);
  }

  frame(t) {
    this.raf = requestAnimationFrame((n) => this.frame(n));
    const v = S.settings.viz;
    const minDt = 1000 / (v.fps || 60);
    if (t - this.last < minDt - 2) return;
    this.last = t;
    this.resize();
    const { width: w, height: h } = this.canvas;
    const g = this.g;
    g.clearRect(0, 0, w, h);
    const mode = this.mode;
    if (mode === 'off') return;
    this.readData(t);

    const N = this.compact ? Math.min(v.bars, 40) : v.bars;
    const nyq = (player.ctx ? player.ctx.sampleRate : 44100) / 2;
    const bins = this.freq.length;
    const decay = 0.8 + v.smoothing * 0.18;
    for (let i = 0; i < N; i++) {
      const f0 = 40 * Math.pow(16000 / 40, i / N), f1 = 40 * Math.pow(16000 / 40, (i + 1) / N);
      const b0 = Math.min(bins - 1, Math.floor((f0 / nyq) * bins));
      const b1 = Math.min(bins, Math.max(b0 + 1, Math.ceil((f1 / nyq) * bins)));
      let sum = 0;
      for (let b = b0; b < b1; b++) sum += this.freq[b];
      let val = Math.min(1, (sum / (b1 - b0) / 255) * v.sensitivity * (1 + (i / N) * 0.9));
      val = Math.pow(val, 1.35);
      this.bars[i] = val > this.bars[i] ? this.bars[i] + (val - this.bars[i]) * 0.7 : Math.max(val, this.bars[i] * decay);
    }

    const pal = this.getPalette();
    g.save();
    g.lineCap = 'round';
    if (v.glow && !this.compact) { g.shadowBlur = 14 * this.dpr; g.shadowColor = pal.a; }
    if (mode === 'bars') this.drawBars(g, w, h, N, pal, false);
    else if (mode === 'mirror') this.drawBars(g, w, h, N, pal, true);
    else if (mode === 'wave') this.drawWave(g, w, h, pal, v);
    else if (mode === 'radial') this.drawRadial(g, w, h, N, pal);
    else if (mode === 'particles') this.drawParticles(g, w, h, N, pal, v);
    else if (mode === 'aurora') this.drawAurora(g, w, h, N, pal, t, v);
    g.restore();
  }

  drawBars(g, w, h, N, pal, mirror) {
    const gap = Math.max(2 * this.dpr, (w / N) * 0.28);
    const bw = Math.max(1, (w - gap * (N - 1)) / N);
    for (let i = 0; i < N; i++) {
      const bh = Math.max(bw * 0.9, this.bars[i] * h * 0.94);
      const x = i * (bw + gap);
      g.fillStyle = this.colorAt(i / N, pal);
      g.beginPath();
      g.roundRect(x, mirror ? (h - bh) / 2 : h - bh, bw, bh, bw / 2);
      g.fill();
    }
  }

  drawWave(g, w, h, pal, v) {
    const n = this.td.length / 2;
    const grad = g.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 4; i++) grad.addColorStop(i / 4, this.colorAt(i / 4, pal));
    for (let pass = 0; pass < 2; pass++) {
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * w;
        const y = h / 2 + ((this.td[i] - 128) / 128) * h * 0.42 * v.sensitivity * (pass ? 0.55 : 1);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.strokeStyle = grad;
      g.globalAlpha = pass ? 0.35 : 1;
      g.lineWidth = (pass ? 5 : 2.6) * this.dpr;
      g.lineJoin = 'round';
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  drawRadial(g, w, h, N, pal) {
    const cx = w / 2, cy = h / 2, m = Math.min(w, h);
    const r0 = m * 0.2;
    g.lineWidth = Math.max(2 * this.dpr, ((2 * Math.PI * r0) / N) * 0.55);
    const spin = performance.now() / 14000;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2 + spin;
      const len = Math.max(m * 0.012, this.bars[i] * m * 0.3);
      g.strokeStyle = this.colorAt(i / N, pal);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
      g.stroke();
    }
    g.globalAlpha = 0.25;
    g.lineWidth = this.dpr * 1.5;
    g.beginPath();
    g.arc(cx, cy, r0 * 0.88, 0, Math.PI * 2);
    g.strokeStyle = pal.a;
    g.stroke();
    g.globalAlpha = 1;
  }

  drawParticles(g, w, h, N, pal, v) {
    const bass = (this.bars[0] + this.bars[1] + this.bars[2] + this.bars[3]) / 4;
    const cx = w / 2, cy = h / 2, m = Math.min(w, h);
    const spawn = Math.floor(bass * 9 * v.sensitivity);
    for (let i = 0; i < spawn && this.parts.length < 700; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.8 + Math.random() * 2.2 + bass * 3) * this.dpr;
      this.parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, size: (1.2 + Math.random() * 2.8) * this.dpr, c: Math.random() });
    }
    g.globalCompositeOperation = 'lighter';
    const core = m * (0.05 + bass * 0.12);
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, core * 2.2);
    rg.addColorStop(0, pal.a);
    rg.addColorStop(1, 'transparent');
    g.globalAlpha = 0.55;
    g.fillStyle = rg;
    g.beginPath();
    g.arc(cx, cy, core * 2.2, 0, Math.PI * 2);
    g.fill();
    for (const p of this.parts) {
      p.x += p.vx; p.y += p.vy; p.life -= 0.012;
      p.vx *= 1.006; p.vy *= 1.006;
      g.globalAlpha = Math.max(0, p.life) * 0.9;
      g.fillStyle = this.colorAt(p.c, pal);
      g.beginPath();
      g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      g.fill();
    }
    this.parts = this.parts.filter((p) => p.life > 0 && p.x > -20 && p.x < w + 20 && p.y > -20 && p.y < h + 20);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  drawAurora(g, w, h, N, pal, t, v) {
    g.shadowBlur = 0;
    g.globalCompositeOperation = 'lighter';
    const q = Math.max(1, Math.floor(N / 4));
    for (let k = 0; k < 4; k++) {
      let e = 0;
      for (let i = k * q; i < (k + 1) * q; i++) e += this.bars[i] || 0;
      e /= q;
      const s = t * 0.00035 * (k + 1);
      const cx = w * (0.5 + 0.36 * Math.sin(s * 1.7 + k * 1.9));
      const cy = h * (0.5 + 0.32 * Math.cos(s * 1.3 + k * 2.3));
      const r = Math.min(w, h) * (0.32 + 0.3 * e * v.sensitivity);
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, this.colorAt(k / 3, pal));
      grad.addColorStop(1, 'transparent');
      g.globalAlpha = 0.5 + e * 0.4;
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
}
