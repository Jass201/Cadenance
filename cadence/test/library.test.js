const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanPaths, readLyricsFor, trackIdFor } = require('../lib/library.js');

// Stand-in for music-metadata: tags are derived from the file name, so we test Cadence's own
// scanning logic (walking, filtering, caching, covers, lyrics) without the real parser.
const COVER = Buffer.from('fake-image-bytes');
const fakeMM = {
  parseFile: async (file) => {
    const base = path.basename(file, path.extname(file));
    if (base.startsWith('broken')) throw new Error('cannot parse');
    const [artist, title] = base.split(' - ');
    return {
      format: { duration: 123.4, bitrate: 320000, codec: 'MP3' },
      common: {
        title, artist, album: 'Test Album', albumartist: artist, track: { no: 3 }, disk: { no: 1 }, year: 2020, genre: ['Pop'],
        picture: [{ data: COVER, format: 'image/png' }],
        replaygain_track_gain: { dB: -6.5 },
        lyrics: base.startsWith('Synced') ? [{ syncText: [{ text: 'hello', timestamp: 1500 }, { text: 'world', timestamp: 65230 }] }] : [],
      },
    };
  },
  selectCover: (pics) => (pics && pics[0]) || null,
};

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-lib-')); }

test('scanPaths walks folders, skips hidden dirs and non-audio, tolerates broken files', async () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'Artist', 'Album'), { recursive: true });
  fs.mkdirSync(path.join(root, '.hidden'));
  fs.writeFileSync(path.join(root, 'Artist', 'Album', 'Ann - One.mp3'), 'x');
  fs.writeFileSync(path.join(root, 'Artist', 'Bob - Two.FLAC'), 'x');
  fs.writeFileSync(path.join(root, 'Artist', 'notes.txt'), 'x');
  fs.writeFileSync(path.join(root, '.hidden', 'Eve - Secret.mp3'), 'x');
  fs.writeFileSync(path.join(root, 'broken - file.mp3'), 'x');
  const coverDir = path.join(tmp(), 'covers');
  const progress = [];
  const tracks = await scanPaths([root], { coverDir, mm: fakeMM, onProgress: (p) => progress.push(p) });

  const titles = tracks.map((t) => t.title).sort();
  assert.deepEqual(titles, ['One', 'Two', 'broken - file']);
  const one = tracks.find((t) => t.title === 'One');
  assert.equal(one.artist, 'Ann');
  assert.equal(one.duration, 123.4);
  assert.equal(one.rg, -6.5);
  assert.equal(one.id, trackIdFor(path.join(root, 'Artist', 'Album', 'Ann - One.mp3')));
  assert.equal(one.uri, `cadence://track/${one.id}`);
  assert.match(one.art, /^cadence:\/\/cover\/[a-f0-9]{40}\.png$/);
  assert.equal(fs.readdirSync(coverDir).length, 1, 'identical covers are stored once');
  assert.equal(tracks.find((t) => t.title === 'broken - file').artist, 'Unknown Artist');
  assert.equal(progress.at(-1).phase, 'read');
  assert.equal(progress.at(-1).done, 3);
});

test('scanPaths reuses unchanged tracks and re-reads modified ones', async () => {
  const root = tmp();
  const file = path.join(root, 'Ann - One.mp3');
  fs.writeFileSync(file, 'x');
  const coverDir = path.join(tmp(), 'covers');
  const first = await scanPaths([root], { coverDir, mm: fakeMM });
  let calls = 0;
  const counting = { ...fakeMM, parseFile: (...a) => { calls++; return fakeMM.parseFile(...a); } };
  const existing = new Map(first.map((t) => [t.id, t]));
  const again = await scanPaths([root], { coverDir, mm: counting, existing });
  assert.equal(calls, 0);
  assert.equal(again[0], first[0]);
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
  await scanPaths([root], { coverDir, mm: counting, existing });
  assert.equal(calls, 1);
});

test('readLyricsFor prefers .lrc sidecars, then embedded synced tags (converted to LRC)', async () => {
  const root = tmp();
  const song = path.join(root, 'Ann - One.mp3');
  fs.writeFileSync(song, 'x');
  fs.writeFileSync(path.join(root, 'Ann - One.lrc'), '[00:01.00]from file');
  const side = await readLyricsFor(song, fakeMM);
  assert.deepEqual([side.synced, side.source, side.text], [true, 'file', '[00:01.00]from file']);

  const synced = path.join(root, 'Synced - Song.mp3');
  fs.writeFileSync(synced, 'x');
  const emb = await readLyricsFor(synced, fakeMM);
  assert.equal(emb.source, 'tags');
  assert.equal(emb.text, '[00:01.50]hello\n[01:05.23]world');

  const none = path.join(root, 'Plain - Song.mp3');
  fs.writeFileSync(none, 'x');
  assert.equal(await readLyricsFor(none, fakeMM), null);
});
