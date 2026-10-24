const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = (rel) => import(pathToFileURL(path.join(__dirname, '..', rel)).href);

test('LRC: standard, multi-stamp, offset and metadata lines', async () => {
  const { parseLrc, activeIndex } = await load('renderer/js/lrc.js');
  const r = parseLrc('[ti:Song]\n[offset:+500]\n[00:10.00]First\n[00:05.50][00:20.00]Chorus\n[00:30]Last');
  assert.equal(r.synced, true);
  assert.deepEqual(r.lines.map((l) => l.text), ['Chorus', 'First', 'Chorus', 'Last']);
  assert.equal(r.lines[0].t, 6000);
  assert.equal(activeIndex(r.lines, 5000), -1);
  assert.equal(activeIndex(r.lines, 6000), 0);
  assert.equal(activeIndex(r.lines, 25000), 2);
  assert.equal(activeIndex(r.lines, 99999), 3);
});

test('LRC: enhanced word timing', async () => {
  const { parseLrc } = await load('renderer/js/lrc.js');
  const r = parseLrc('[00:01.00]<00:01.00>Hello <00:01.50>big <00:02.00>world');
  assert.equal(r.lines[0].text, 'Hello big world');
  assert.deepEqual(r.lines[0].words.map((w) => [w.t, w.text]), [[1000, 'Hello '], [1500, 'big '], [2000, 'world']]);
});

test('LRC: unsynced text stays line-based', async () => {
  const { parseLrc } = await load('renderer/js/lrc.js');
  const r = parseLrc('one\ntwo\n\nthree\n');
  assert.equal(r.synced, false);
  assert.deepEqual(r.lines.map((l) => l.text), ['one', 'two', '', 'three']);
});

test('Importers: Exportify-style CSV with quoted commas and ms durations', async () => {
  const { parsePlaylistFile } = await load('renderer/js/importers.js');
  const csv = 'Track URI,Track Name,Album Name,Artist Name(s),Duration (ms)\n' +
    'spotify:track:1,"Hello, World",Greatest Hits,"Ann;Bob",215000\n' +
    'spotify:track:2,Second,Other,Cara,61000\n';
  const [pl] = parsePlaylistFile('My Mix.csv', csv);
  assert.equal(pl.name, 'My Mix');
  assert.equal(pl.entries.length, 2);
  assert.deepEqual(pl.entries[0], { title: 'Hello, World', artist: 'Ann', album: 'Greatest Hits', duration: 215, isrc: '' });
});

test('Importers: tab-delimited export with mm:ss times and a playlist column', async () => {
  const { parsePlaylistFile } = await load('renderer/js/importers.js');
  const tsv = 'Name\tArtist\tAlbum\tTime\tPlaylist Name\nA\tX\tAl\t3:05\tOne\nB\tY\tAl\t2:00\tTwo\n';
  const lists = parsePlaylistFile('lib.txt', tsv);
  assert.deepEqual(lists.map((l) => l.name), ['One', 'Two']);
  assert.equal(lists[0].entries[0].duration, 185);
});

test('Importers: JSON (Spotify data export shape), M3U, PLS, XSPF', async () => {
  const { parsePlaylistFile } = await load('renderer/js/importers.js');
  const json = JSON.stringify({ playlists: [{ name: 'P', items: [{ track: { trackName: 'T', artistName: 'A', albumName: 'B' } }] }] });
  assert.equal(parsePlaylistFile('Playlist1.json', json)[0].entries[0].title, 'T');

  const m3u = '#EXTM3U\n#EXTINF:123,Artist - Title\n/music/a.mp3\n';
  const m = parsePlaylistFile('x.m3u8', m3u)[0].entries[0];
  assert.deepEqual([m.artist, m.title, m.duration], ['Artist', 'Title', 123]);

  const pls = '[playlist]\nFile1=/a/b.mp3\nTitle1=Who - Song\nLength1=200\nNumberOfEntries=1\n';
  assert.equal(parsePlaylistFile('x.pls', pls)[0].entries[0].artist, 'Who');

  const xspf = '<?xml version="1.0"?><playlist><title>Mine</title><trackList><track><title>S &amp; T</title><creator>C</creator><duration>90000</duration></track></trackList></playlist>';
  const x = parsePlaylistFile('x.xspf', xspf)[0];
  assert.equal(x.name, 'Mine');
  assert.equal(x.entries[0].title, 'S & T');
  assert.equal(x.entries[0].duration, 90);
});

test('Matcher: ignores remaster/feat noise, needs artist agreement', async () => {
  const { buildMatcher } = await load('renderer/js/importers.js');
  const lib = [
    { id: 1, title: 'Neon Harbor', artist: 'Lumen Park', album: 'Night Shift', duration: 200 },
    { id: 2, title: 'Neon Harbor', artist: 'Someone Else', album: 'Other', duration: 100 },
    { id: 3, title: 'Glass Orchard (Remastered 2011)', artist: 'Soft Static', album: 'X', duration: 180 },
  ];
  const match = buildMatcher(lib);
  assert.equal(match({ title: 'Neon Harbor', artist: 'Lumen Park' }).id, 1);
  assert.equal(match({ title: 'Neon Harbor', artist: 'Someone Else' }).id, 2);
  assert.equal(match({ title: 'Glass Orchard - 2011 Remaster', artist: 'Soft Static' }).id, 3);
  assert.equal(match({ title: 'Neon Harbor', artist: 'Nobody' }), null);
  assert.equal(match({ title: 'Missing Song', artist: 'Lumen Park' }), null);
});

test('Subsonic client builds salted-token URLs without the password', async () => {
  const { SubsonicClient, makeAuth, md5, songToTrack } = require('../lib/subsonic.js');
  const { salt, token } = makeAuth('hunter2');
  assert.equal(token, md5('hunter2' + salt));
  const c = new SubsonicClient({ url: 'music.example.com/', user: 'me', token, salt });
  const url = new URL(c.streamUrl('42'));
  assert.equal(url.origin, 'https://music.example.com');
  assert.equal(url.pathname, '/rest/stream.view');
  assert.equal(url.searchParams.get('id'), '42');
  assert.equal(url.searchParams.get('t'), token);
  assert.ok(![...url.searchParams.values()].includes('hunter2'));
  const t = songToTrack({ id: 'a/b', title: 'T', artist: 'A', coverArt: 'c1', duration: 10 }, 'srv');
  assert.equal(t.uri, 'cadence://remote/srv/a%2Fb');
  assert.equal(t.art, 'cadence://remoteart/srv/c1');
});

test('Store persists values atomically', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { Store } = require('../lib/store.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-'));
  const s = new Store(dir);
  s.set('settings', { a: 1 });
  s.flush();
  assert.deepEqual(new Store(dir).get('settings'), { a: 1 });
  assert.equal(new Store(dir).get('missing', 'dflt'), 'dflt');
});
