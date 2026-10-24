# Cadence

A minimal, highly customizable desktop music player (Electron). Your library, a search bar, media
controls and your recently/most played music up front; a Now Playing sidebar that visibly plays
(cover art, live visualizer, synced lyrics, queue) like Spotify's.

Inspired by [Sonora](https://github.com/sonorahq/sonora): local playback plus streaming sources, synced
lyrics, gapless-ish playback, and appearance that is "(or will be) customizable".

## Run it

```bash
npm install        # installs Electron + music-metadata
npm start
npm test           # parser / matcher / scanner / Subsonic tests (Node 22+)
npm run dist       # installers via electron-builder (dmg / nsis / AppImage+deb)
```

You can also open `renderer/index.html` through any static server for a browser build with a demo
library (no desktop features such as folder scanning or server connections).

## What it does

**Library & playback**
- Add folders or files (MP3, FLAC, OGG, Opus, M4A, AAC, WAV) or drag them onto the window. Tags, cover art, ReplayGain and embedded lyrics are read with `music-metadata`; rescans skip unchanged files.
- Home: greeting, search, *Jump back in* (recently played), *Most played*, library shortcuts, recently added.
- Library (tracks / albums / artists, sortable), album and artist pages, playlists, Liked songs, instant search (title, artist, album).
- Queue with drag-to-reorder, play next / add to queue, shuffle, repeat, sleep timer (minutes or end of track), playback speed, 10-band EQ with presets, volume normalization, crossfade, OS media keys.
- Keyboard-first: press `?` for the list (Space, arrows, `/`, `L`, `V`, `Q`, `F`, ...).

**Importing from streaming services**
- *Playlist files* — export a playlist from Spotify / Apple Music / YouTube Music / Tidal / Deezer (or a transfer tool such as Exportify, TuneMyMusic, Soundiiz) as CSV, TSV, JSON, M3U, PLS or XSPF and drop it in. Entries are matched to your library by title + artist (ignoring "Remastered", "feat." noise); unmatched entries stay as placeholders and can be re-matched after you add music.
- *Your own server* — connect Navidrome / Airsonic / Gonic / any Subsonic-API server to stream your collection (auth uses a salted token, the password is never stored; the token is encrypted with the OS keychain when available).
- Cadence does **not** stream from Spotify/Apple Music/etc. or bypass their protections — those services only allow playback in their own apps. This matches Sonora's stance.

**Customization** (Settings, applied live)
- *Appearance*: 10 themes, custom background/panel/text/accent colours, adaptive accent from the cover, translucency, album-art backdrop, corner radius, UI size, density, cover size, font, theme import/export.
- *Animation*: on/off/follow system, speed, page transitions, hover lift, beat-pulsing cover, spinning-vinyl cover.
- *Visualizer*: bars, mirror, waveform, radial, particles, aurora; colour mode, sensitivity, smoothing, bar count, glow, FPS; shown on the cover and in a full-screen view.
- *Lyrics*: `.lrc` next to the file, embedded tags, optional lrclib.net lookup (off by default), paste/load manually; word-by-word highlight for enhanced LRC, per-track timing offset, size, alignment, font, blur, opacity, spacing, active colour.

## Layout

```
main.js, preload.js      Electron main process + secure bridge (contextIsolation, sandbox, CSP)
lib/                     store (JSON), library scanner, Subsonic client
renderer/js/             player engine, visualizer, lyrics, views, settings, importers (plain ES modules, no bundler)
renderer/styles.css      every colour/radius/font/motion value is a CSS variable set from settings
test/                    node:test suites
```

Local files are served to the page through a custom `cadence://` protocol that only exposes files you have
imported; the renderer has no Node access.

## Known limits

- Playback is *near*-gapless (next track is preloaded and started ~0.2 s early), not sample-accurate.
- No scrobbling or Discord presence yet; no WMA/ALAC (Chromium can't decode them).
- Subsonic lyrics endpoints and Spotify/YouTube-style direct APIs are not wired up.

## Building an executable

Run on the OS you are targeting (installers can't be cross-built reliably):

```bash
npm install
npm run dist:win     # dist/Cadence Setup x.y.z.exe + portable .exe
npm run dist:mac     # dist/Cadence-x.y.z.dmg (unsigned; right-click > Open the first time)
npm run dist:linux   # dist/Cadence-x.y.z.AppImage and .deb
```

Or push the project to GitHub and run the **Build executables** workflow (Actions tab): it builds all
three platforms and attaches the files as downloadable artifacts. Add `build/icon.png` (512×512) to
replace the default Electron icon.
