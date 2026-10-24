'use strict';
// Tiny JSON key/value store with debounced, atomic writes.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
    this.timers = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }
  file(key) { return path.join(this.dir, key + '.json'); }
  get(key, fallback = null) {
    if (this.cache.has(key)) return this.cache.get(key);
    let value = fallback;
    try { value = JSON.parse(fs.readFileSync(this.file(key), 'utf8')); } catch { /* missing or corrupt: use fallback */ }
    this.cache.set(key, value);
    return value;
  }
  set(key, value) {
    this.cache.set(key, value);
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => this.flushKey(key), 400));
  }
  flushKey(key) {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    if (!this.cache.has(key)) return;
    const file = this.file(key);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.cache.get(key)));
    fs.renameSync(tmp, file);
  }
  flush() { for (const key of [...this.timers.keys()]) this.flushKey(key); }
}

module.exports = { Store };
