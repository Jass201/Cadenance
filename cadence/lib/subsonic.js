'use strict';
// Client for Subsonic-compatible servers (Navidrome, Airsonic, Gonic, Subsonic, ...).
// Auth uses the salted-token scheme, so the password itself is never stored.
const crypto = require('crypto');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

function normalizeUrl(input) {
  let u = String(input || '').trim();
  if (!u) throw new Error('Server address is required');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/\/+$/, '');
}

function makeAuth(password) {
  const salt = crypto.randomBytes(8).toString('hex');
  return { salt, token: md5(String(password) + salt) };
}

class SubsonicClient {
  constructor({ url, user, token, salt }, fetchImpl = globalThis.fetch) {
    this.base = normalizeUrl(url);
    this.user = user;
    this.token = token;
    this.salt = salt;
    this.fetch = fetchImpl;
  }

  buildUrl(endpoint, params = {}) {
    const q = new URLSearchParams({ u: this.user, t: this.token, s: this.salt, v: '1.16.1', c: 'Cadence', f: 'json' });
    for (const [k, v] of Object.entries(params)) if (v != null) q.append(k, String(v));
    return `${this.base}/rest/${endpoint}.view?${q.toString()}`;
  }

  async call(endpoint, params) {
    const res = await this.fetch(this.buildUrl(endpoint, params), { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Server replied with HTTP ${res.status}`);
    let body;
    try { body = await res.json(); } catch { throw new Error('That does not look like a Subsonic server'); }
    const r = body && body['subsonic-response'];
    if (!r) throw new Error('That does not look like a Subsonic server');
    if (r.status !== 'ok') throw new Error((r.error && r.error.message) || 'The server reported an error');
    return r;
  }

  ping() { return this.call('ping'); }
  streamUrl(id) { return this.buildUrl('stream', { id }); }
  coverUrl(id, size = 400) { return this.buildUrl('getCoverArt', { id, size }); }

  async fetchAllSongs(onProgress) {
    const out = [];
    const page = 500;
    // An empty query returns every song on Navidrome and other OpenSubsonic servers.
    try {
      for (let off = 0; off < 500000; off += page) {
        const r = await this.call('search3', { query: '""', artistCount: 0, albumCount: 0, songCount: page, songOffset: off });
        const songs = (r.searchResult3 && r.searchResult3.song) || [];
        out.push(...songs);
        onProgress && onProgress(out.length);
        if (songs.length < page) break;
      }
    } catch { /* fall through to the album walk */ }
    if (out.length) return out;
    return this.walkAlbums(onProgress);
  }

  async walkAlbums(onProgress) {
    const albums = [];
    for (let off = 0; ; off += 500) {
      const r = await this.call('getAlbumList2', { type: 'alphabeticalByName', size: 500, offset: off });
      const list = (r.albumList2 && r.albumList2.album) || [];
      albums.push(...list);
      if (list.length < 500) break;
    }
    const out = [];
    let next = 0;
    const worker = async () => {
      while (next < albums.length) {
        const a = albums[next++];
        try {
          const r = await this.call('getAlbum', { id: a.id });
          out.push(...((r.album && r.album.song) || []));
          onProgress && onProgress(out.length);
        } catch { /* skip an unreadable album */ }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return out;
  }

  async playlists() {
    const r = await this.call('getPlaylists');
    return (r.playlists && r.playlists.playlist) || [];
  }

  async playlist(id) {
    const r = await this.call('getPlaylist', { id });
    return r.playlist || { entry: [] };
  }
}

function songToTrack(song, serverId) {
  return {
    id: `s-${serverId}-${song.id}`,
    source: 'subsonic',
    serverId,
    remoteId: String(song.id),
    title: song.title || 'Untitled',
    artist: song.artist || 'Unknown Artist',
    albumArtist: song.albumArtist || song.artist || 'Unknown Artist',
    album: song.album || 'Unknown Album',
    track: song.track || 0,
    disc: song.discNumber || 1,
    year: song.year || null,
    genre: song.genre || null,
    duration: song.duration || 0,
    bitrate: song.bitRate ? song.bitRate * 1000 : null,
    format: song.suffix || null,
    uri: `cadence://remote/${serverId}/${encodeURIComponent(song.id)}`,
    art: song.coverArt ? `cadence://remoteart/${serverId}/${encodeURIComponent(song.coverArt)}` : null,
    addedAt: Date.parse(song.created) || Date.now(),
  };
}

module.exports = { SubsonicClient, songToTrack, makeAuth, normalizeUrl, md5 };
