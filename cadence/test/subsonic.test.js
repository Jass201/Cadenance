const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { SubsonicClient, makeAuth, songToTrack } = require('../lib/subsonic.js');

function mockServer(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      seen.push(url);
      const body = handler(url);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...body } }));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

const song = (i) => ({ id: String(i), title: `Song ${i}`, artist: 'A', album: 'Al', duration: 100 + i, coverArt: `c${i}`, track: i });

test('fetchAllSongs pages through search3 and sends salted-token auth on every call', async () => {
  const { server, seen, base } = await mockServer((url) => {
    if (url.pathname.endsWith('search3.view')) {
      const off = Number(url.searchParams.get('songOffset'));
      return { searchResult3: { song: Array.from({ length: off === 0 ? 500 : 120 }, (_, i) => song(off + i)) } };
    }
    return {};
  });
  try {
    const { salt, token } = makeAuth('pw');
    const client = new SubsonicClient({ url: base, user: 'me', token, salt });
    const counts = [];
    const songs = await client.fetchAllSongs((n) => counts.push(n));
    assert.equal(songs.length, 620);
    assert.deepEqual(counts, [500, 620]);
    assert.ok(seen.every((u) => u.searchParams.get('u') === 'me' && u.searchParams.get('t') === token && u.searchParams.get('s') === salt));
    assert.ok(seen.every((u) => u.searchParams.get('p') === null), 'plain password is never sent');
  } finally { server.close(); }
});

test('fetchAllSongs falls back to walking albums when search3 returns nothing', async () => {
  const { server, base } = await mockServer((url) => {
    const ep = url.pathname.split('/').pop();
    if (ep === 'search3.view') return { searchResult3: {} };
    if (ep === 'getAlbumList2.view') return { albumList2: { album: [{ id: 'a1' }, { id: 'a2' }] } };
    if (ep === 'getAlbum.view') return { album: { song: [song(Number(url.searchParams.get('id').slice(1)) * 10), song(Number(url.searchParams.get('id').slice(1)) * 10 + 1)] } };
    return {};
  });
  try {
    const client = new SubsonicClient({ url: base, user: 'me', token: 't', salt: 's' });
    const songs = await client.fetchAllSongs();
    assert.equal(songs.length, 4);
  } finally { server.close(); }
});

test('server errors surface a readable message; playlists map to tracks', async () => {
  const { server, base } = await mockServer((url) => {
    const ep = url.pathname.split('/').pop();
    if (ep === 'ping.view') return { status: 'failed', error: { code: 40, message: 'Wrong username or password' } };
    if (ep === 'getPlaylists.view') return { playlists: { playlist: [{ id: 'p1', name: 'Mix', songCount: 2 }] } };
    if (ep === 'getPlaylist.view') return { playlist: { id: 'p1', name: 'Mix', entry: [song(1), song(2)] } };
    return {};
  });
  try {
    const client = new SubsonicClient({ url: base, user: 'me', token: 't', salt: 's' });
    await assert.rejects(() => client.ping(), /Wrong username or password/);
    const lists = await client.playlists();
    assert.equal(lists[0].name, 'Mix');
    const pl = await client.playlist('p1');
    const tracks = pl.entry.map((s) => songToTrack(s, 'srv'));
    assert.deepEqual(tracks.map((t) => t.title), ['Song 1', 'Song 2']);
    assert.equal(tracks[0].id, 's-srv-1');
  } finally { server.close(); }
});
