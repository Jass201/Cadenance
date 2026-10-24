// Audio engine: two decks (near-gapless playback + crossfade), 10-band EQ, limiter, analyser,
// queue with shuffle/repeat, play counting and OS media-key integration.
import { S, emit, on, recordStart, recordPlay, save, getSetting } from './state.js';
import { clamp } from './util.js';

export const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 0, 0, 1, 3, 5, 6],
  vocal: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  rock: [4, 3, 2, 0, -1, -1, 1, 3, 4, 5],
  electronic: [5, 4, 1, 0, -2, 2, 1, 2, 4, 5],
  acoustic: [3, 3, 2, 1, 1, 1, 2, 3, 2, 1],
  loudness: [5, 3, 0, 0, -1, 0, -1, 0, 3, 5],
};

const shuffled = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

class Player {
  constructor() {
    this.ctx = null;
    this.decks = [];
    this.curI = 0;
    this.queue = [];
    this.origQueue = [];
    this.index = -1;
    this.shuffle = false;
    this.repeat = 'off'; // off | all | one
    this.advancing = false;
    this.counted = false;
    this.errorStreak = 0;
    this.lastSavedAt = 0;
    this.analyser = null;
    this.timer = setInterval(() => this._tick(), 100);
  }

  // ----- graph -----
  ensure() {
    if (this.ctx) return;
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' }));
    this.eq = EQ_FREQS.map((f) => {
      const n = ctx.createBiquadFilter();
      n.type = 'peaking'; n.frequency.value = f; n.Q.value = 1.1; n.gain.value = 0;
      return n;
    });
    this.eq.reduce((a, b) => { a.connect(b); return b; });
    this.pre = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    this.master = ctx.createGain();
    this.bus = ctx.createGain();
    this.bus.connect(this.eq[0]);
    this.eq[this.eq.length - 1].connect(this.pre);
    this.pre.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.analyser.connect(this.master);
    this.master.connect(ctx.destination);
    for (let i = 0; i < 2; i++) {
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      const src = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();
      src.connect(gain);
      gain.connect(this.bus);
      const deck = { audio, gain, track: null };
      audio.addEventListener('ended', () => { if (this.deck === deck) this._ended(); });
      audio.addEventListener('error', () => { if (this.deck === deck && deck.track) this._failed(deck.track); });
      audio.addEventListener('play', () => { if (this.deck === deck) emit('player:state'); });
      audio.addEventListener('pause', () => { if (this.deck === deck) emit('player:state'); });
      this.decks.push(deck);
    }
    this.applyAudioSettings();
    this.setVolume(S.volume, true);
  }

  get deck() { return this.decks[this.curI]; }
  get other() { return this.decks[1 - this.curI]; }
  get current() { return this.index >= 0 ? S.byId.get(this.queue[this.index]) || null : null; }
  get playing() { return !!this.ctx && !!this.deck && !this.deck.audio.paused && !this.deck.audio.ended; }
  get position() { return this.deck ? this.deck.audio.currentTime || 0 : 0; }
  get duration() {
    const d = this.deck && this.deck.audio.duration;
    return Number.isFinite(d) && d > 0 ? d : (this.current && this.current.duration) || 0;
  }

  applyAudioSettings() {
    if (!this.ctx) return;
    const a = S.settings.audio;
    const now = this.ctx.currentTime;
    const gains = a.eqEnabled ? a.eq : EQ_PRESETS.flat;
    this.eq.forEach((n, i) => n.gain.setTargetAtTime(gains[i] || 0, now, 0.03));
    if (a.normalize) {
      this.limiter.threshold.value = -6; this.limiter.knee.value = 12; this.limiter.ratio.value = 6;
      this.limiter.attack.value = 0.005; this.limiter.release.value = 0.25;
    } else {
      this.limiter.threshold.value = 0; this.limiter.knee.value = 0; this.limiter.ratio.value = 1;
    }
    const t = this.current;
    const rg = a.normalize && t && typeof t.rg === 'number' ? clamp(10 ** (t.rg / 20), 0.1, 1) : 1;
    this.pre.gain.setTargetAtTime(rg, now, 0.05);
    for (const d of this.decks) { d.audio.playbackRate = a.speed; d.audio.preservesPitch = true; }
  }

  setVolume(v, silent) {
    S.volume = clamp(v, 0, 1);
    if (S.volume > 0) S.muted = false;
    if (this.ctx) this.master.gain.setTargetAtTime(S.muted ? 0 : S.volume ** 2, this.ctx.currentTime, 0.02);
    save('state');
    if (!silent) emit('player:volume');
  }
  toggleMute() {
    S.muted = !S.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(S.muted ? 0 : S.volume ** 2, this.ctx.currentTime, 0.02);
    save('state');
    emit('player:volume');
  }

  // ----- queue -----
  async playQueue(ids, index = 0, { shuffle } = {}) {
    this.ensure();
    if (shuffle !== undefined) this.shuffle = shuffle;
    this.origQueue = [...ids];
    if (this.shuffle) {
      const first = ids[index];
      this.queue = [first, ...shuffled(ids.filter((_, i) => i !== index))];
      index = 0;
    } else this.queue = [...ids];
    emit('player:queue');
    emit('player:modes');
    await this._go(index);
  }

  playTrack(id, contextIds) {
    const ids = contextIds && contextIds.includes(id) ? contextIds : [id];
    return this.playQueue(ids, ids.indexOf(id));
  }

  playNext(ids) {
    if (!this.queue.length) return this.playQueue(ids, 0);
    this.queue.splice(this.index + 1, 0, ...ids);
    this.origQueue.push(...ids);
    emit('player:queue');
  }
  enqueue(ids) {
    if (!this.queue.length) return this.playQueue(ids, 0);
    this.queue.push(...ids);
    this.origQueue.push(...ids);
    emit('player:queue');
  }
  removeAt(i) {
    if (i === this.index) return;
    this.queue.splice(i, 1);
    if (i < this.index) this.index--;
    emit('player:queue');
  }
  moveInQueue(from, to) {
    if (from === to || from === this.index) return;
    const [id] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, id);
    if (from < this.index && to >= this.index) this.index--;
    else if (from > this.index && to <= this.index) this.index++;
    emit('player:queue');
  }
  clearUpcoming() {
    this.queue = this.queue.slice(0, this.index + 1);
    emit('player:queue');
  }
  jump(i) { return this._go(i); }

  setShuffle(on_) {
    this.shuffle = on_;
    const cur = this.queue[this.index];
    if (on_) {
      const rest = this.queue.filter((_, i) => i !== this.index);
      this.queue = cur ? [cur, ...shuffled(rest)] : shuffled(rest);
      this.index = cur ? 0 : -1;
    } else {
      const pool = new Set(this.queue);
      this.queue = this.origQueue.filter((id) => pool.has(id));
      for (const id of pool) if (!this.queue.includes(id)) this.queue.push(id);
      this.index = this.queue.indexOf(cur);
    }
    emit('player:queue');
    emit('player:modes');
  }
  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    emit('player:modes');
  }

  _peekNextIndex() {
    if (!this.queue.length) return null;
    if (this.index + 1 < this.queue.length) return this.index + 1;
    return this.repeat === 'all' ? 0 : null;
  }

  // ----- transport -----
  async toggle() {
    this.ensure();
    if (this.playing) return this.pause();
    return this.resume();
  }
  async resume() {
    this.ensure();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (!this.current) {
      const ids = S.tracks.map((t) => t.id);
      if (ids.length) await this.playQueue(ids, 0);
      return;
    }
    if (!this.deck.track) { await this._go(this.index, { startPos: this.pendingPos || 0 }); return; }
    if (this.deck.audio.ended) this.deck.audio.currentTime = 0;
    this.deck.gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.02);
    try { await this.deck.audio.play(); } catch { /* blocked */ }
    emit('player:state');
  }
  pause() {
    if (!this.ctx) return;
    this.deck.audio.pause();
    this.other.audio.pause();
    this._persistQueue();
    emit('player:state');
  }
  seek(sec) {
    if (!this.deck.track) { this.pendingPos = sec; emit('player:time'); return; }
    this.deck.audio.currentTime = clamp(sec, 0, this.duration || sec);
    emit('player:time');
  }
  seekBy(d) { this.seek(this.position + d); }
  async next() {
    if (!this.queue.length) return;
    const ni = this._peekNextIndex();
    if (ni == null) { this.pause(); this.seek(0); return; }
    await this._go(ni);
  }
  async prev() {
    if (!this.queue.length) return;
    if (this.position > 3 || (this.index === 0 && this.repeat !== 'all')) { this.seek(0); return; }
    await this._go(this.index === 0 ? this.queue.length - 1 : this.index - 1);
  }

  async _go(index, { xf = 0.12, startPos = 0 } = {}) {
    this.ensure();
    const track = S.byId.get(this.queue[index]);
    if (!track) return;
    if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch { /* needs gesture */ } }
    const now = this.ctx.currentTime;
    const old = this.deck;
    const nu = this.other;
    if (!nu.track || nu.track.id !== track.id) { nu.audio.src = track.uri; nu.track = track; }
    nu.audio.playbackRate = S.settings.audio.speed;
    try { nu.audio.currentTime = startPos; } catch { /* not seekable yet */ }
    nu.gain.gain.cancelScheduledValues(now);
    nu.gain.gain.setValueAtTime(0, now);
    nu.gain.gain.linearRampToValueAtTime(1, now + Math.max(0.01, xf));
    if (old.track && !old.audio.paused) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.01, xf));
      const stale = old;
      clearTimeout(this.fadeTimer);
      this.fadeTimer = setTimeout(() => { if (this.deck !== stale) stale.audio.pause(); }, xf * 1000 + 80);
    } else old.audio.pause();
    this.curI = 1 - this.curI;
    this.index = index;
    this.counted = false;
    this.pendingPos = 0;
    this.applyAudioSettings();
    recordStart(track.id);
    emit('player:track');
    emit('player:state');
    try { await nu.audio.play(); this.errorStreak = 0; } catch (e) {
      if (e && e.name === 'NotAllowedError') emit('player:blocked');
    }
    this._persistQueue(true);
    clearTimeout(this.preloadTimer);
    this.preloadTimer = setTimeout(() => this._preload(), 1200);
    this._mediaSession();
  }

  _preload() {
    const ni = this._peekNextIndex();
    if (ni == null || this.repeat === 'one') return;
    const t = S.byId.get(this.queue[ni]);
    const o = this.other;
    if (!t || (o.track && o.track.id === t.id) || (!o.audio.paused && this.advancing)) return;
    if (!o.audio.paused) return;
    o.audio.src = t.uri;
    o.track = t;
    o.audio.load();
  }

  _ended() {
    if (this.advancing) return;
    if (this.stopAfter) { this.stopAfter = false; emit('player:sleep'); emit('player:state'); return; }
    if (this.repeat === 'one') { this.deck.audio.currentTime = 0; this.deck.audio.play(); return; }
    const ni = this._peekNextIndex();
    if (ni == null) { emit('player:state'); emit('player:ended'); return; }
    this._go(ni, { xf: 0.02 });
  }

  _failed(track) {
    this.errorStreak++;
    emit('player:error', { track });
    if (this.errorStreak < 3) this.next();
    else { this.errorStreak = 0; this.pause(); }
  }

  _tick() {
    if (!this.ctx || !this.deck.track) return;
    const d = this.deck.audio;
    emit('player:time');
    if (d.paused) return;
    const dur = d.duration;
    const pos = d.currentTime;
    if (!this.counted && this.current && (pos >= 30 || (dur && pos >= dur * 0.5))) {
      this.counted = true;
      recordPlay(this.current.id);
    }
    if (Date.now() - this.lastSavedAt > 5000) this._persistQueue();
    if (this.stopAfter && Number.isFinite(dur) && dur - pos <= 0.3) {
      this.stopAfter = false;
      this.pause();
      this.deck.audio.currentTime = 0;
      emit('player:sleep');
      return;
    }
    if (!Number.isFinite(dur) || dur <= 0 || this.repeat === 'one' || this.advancing) return;
    const a = S.settings.audio;
    const lead = a.crossfade > 0 ? Math.min(a.crossfade, dur / 2) : a.gapless ? 0.2 : 0;
    if (lead > 0 && dur - pos <= lead) {
      const ni = this._peekNextIndex();
      if (ni != null) {
        this.advancing = true;
        this._go(ni, { xf: Math.max(lead, 0.12) }).finally(() => { setTimeout(() => { this.advancing = false; }, 400); });
      }
    }
  }

  fadeOutAndPause(seconds = 8) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + seconds);
    setTimeout(() => {
      this.pause();
      this.master.gain.setValueAtTime(S.muted ? 0 : S.volume ** 2, this.ctx.currentTime);
    }, seconds * 1000 + 100);
  }

  // ----- persistence of the queue between sessions -----
  _persistQueue(force) {
    this.lastSavedAt = Date.now();
    if (!this.queue.length || this.index < 0) return;
    const ids = this.queue.slice(Math.max(0, this.index - 20), this.index + 300);
    S.queue = { ids, index: Math.min(this.index, 20), pos: force ? 0 : this.position };
    save('state');
  }

  async restore() {
    const q = S.queue;
    if (!q || !q.ids || !q.ids.length) return;
    const ids = q.ids.filter((id) => S.byId.has(id));
    if (!ids.length) return;
    this.queue = ids;
    this.origQueue = [...ids];
    this.index = clamp(q.index, 0, ids.length - 1);
    this.pendingPos = q.pos || 0;
    emit('player:queue');
    emit('player:track');
    emit('player:state');
  }

  // ----- OS integration -----
  _mediaSession() {
    if (!('mediaSession' in navigator)) return;
    const t = this.current;
    if (!t) return;
    const art = t.art ? [{ src: new URL(t.art, location.href).href }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: art });
  }
  bindMediaKeys() {
    if (!('mediaSession' in navigator)) return;
    const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch { /* unsupported */ } };
    set('play', () => this.resume());
    set('pause', () => this.pause());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next());
    set('seekto', (d) => this.seek(d.seekTime));
    set('seekbackward', () => this.seekBy(-10));
    set('seekforward', () => this.seekBy(10));
    on('player:state', () => { navigator.mediaSession.playbackState = this.playing ? 'playing' : 'paused'; });
  }
}

export const player = new Player();

on('settings', () => player.applyAudioSettings());
