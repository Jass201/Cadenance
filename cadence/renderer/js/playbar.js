// Bottom playback bar: track info, transport, seek, volume and quick toggles.
import { h, fmtTime } from './util.js';
import { ic } from './icons.js';
import { S, on, toggleFav, isFav, setSetting } from './state.js';
import { player } from './player.js';
import { navigate } from './router.js';
import { artEl, bindRange, showMenu, toast } from './ui.js';
import { toggleFull, isFullOpen } from './now-view.js';

const sleep = { timer: null, endsAt: 0, eot: false };

export function sleepActive() { return !!sleep.timer || sleep.eot; }

function clearSleep() { clearTimeout(sleep.timer); sleep.timer = null; sleep.endsAt = 0; sleep.eot = false; player.stopAfter = false; }

function setSleep(minutes) {
  clearSleep();
  if (minutes === 'eot') { sleep.eot = true; player.stopAfter = true; toast('Will pause when this track ends'); }
  else if (minutes) {
    sleep.endsAt = Date.now() + minutes * 60000;
    sleep.timer = setTimeout(() => { player.fadeOutAndPause(8); clearSleep(); on_sleep(); }, minutes * 60000);
    toast(`Sleep timer set for ${minutes} minutes`);
  } else toast('Sleep timer off');
  on_sleep();
}
let on_sleep = () => {};

export function initPlaybar(root) {
  const art = h('div', { class: 'pb-art' });
  const title = h('div', { class: 'pb-title' });
  const artist = h('button', { class: 'pb-artist link-quiet' });
  const heart = h('button', { class: 'icon-btn heart', title: 'Like', 'aria-label': 'Like', onClick: () => player.current && toggleFav(player.current.id) }, ic('heart', 18));
  const info = h('div', { class: 'pb-info' }, art, h('div', { class: 'pb-text' }, title, artist), heart);

  const shuffle = h('button', { class: 'icon-btn', title: 'Shuffle (S)', 'aria-label': 'Shuffle', onClick: () => player.setShuffle(!player.shuffle) }, ic('shuffle', 18));
  const prev = h('button', { class: 'icon-btn lg', title: 'Previous', 'aria-label': 'Previous', onClick: () => player.prev() }, ic('prev', 20));
  const play = h('button', { class: 'play-btn', title: 'Play / pause (Space)', 'aria-label': 'Play', onClick: () => player.toggle() }, ic('play', 22));
  const next = h('button', { class: 'icon-btn lg', title: 'Next', 'aria-label': 'Next', onClick: () => player.next() }, ic('next', 20));
  const repeat = h('button', { class: 'icon-btn', title: 'Repeat (R)', 'aria-label': 'Repeat', onClick: () => player.cycleRepeat() }, ic('repeat', 18));
  const cur = h('span', { class: 'time' }, '0:00');
  const tot = h('span', { class: 'time' }, '0:00');
  const seek = h('input', { type: 'range', class: 'seek', min: 0, max: 1000, step: 1, value: 0, 'aria-label': 'Seek' });
  bindRange(seek);
  let seeking = false;
  seek.addEventListener('pointerdown', () => { seeking = true; });
  seek.addEventListener('input', () => { cur.textContent = fmtTime((seek.value / 1000) * player.duration); });
  seek.addEventListener('change', () => { player.seek((seek.value / 1000) * player.duration); seeking = false; });
  seek.addEventListener('pointerup', () => { seeking = false; });
  const center = h('div', { class: 'pb-center' }, h('div', { class: 'pb-ctrls' }, shuffle, prev, play, next, repeat), h('div', { class: 'pb-seek' }, cur, seek, tot));

  const lyricsBtn = h('button', { class: 'icon-btn', title: 'Lyrics (L)', 'aria-label': 'Lyrics', onClick: () => toggleFull('lyrics') }, ic('lyrics', 18));
  const vizBtn = h('button', { class: 'icon-btn', title: 'Visualizer (V)', 'aria-label': 'Visualizer', onClick: () => toggleFull('viz') }, ic('viz', 18));
  const panelBtn = h('button', { class: 'icon-btn', title: 'Now Playing panel', 'aria-label': 'Now Playing panel', onClick: () => setSetting('appearance.nowPlayingPanel', !S.settings.appearance.nowPlayingPanel) }, ic('panel', 18));
  const queueBtn = h('button', { class: 'icon-btn', title: 'Queue (Q)', 'aria-label': 'Queue', onClick: () => openQueue() }, ic('queue', 18));
  const sleepBtn = h('button', { class: 'icon-btn', title: 'Sleep timer', 'aria-label': 'Sleep timer', onClick: (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu([
      { label: 'Off', icon: 'x', onClick: () => setSleep(0) },
      { sep: true },
      ...[15, 30, 45, 60, 90].map((m) => ({ label: `${m} minutes`, icon: 'clock', onClick: () => setSleep(m) })),
      { label: 'End of this track', icon: 'moon', onClick: () => setSleep('eot') },
    ], r.left - 80, r.top - 230);
  } }, ic('moon', 18));
  const muteBtn = h('button', { class: 'icon-btn', title: 'Mute (M)', 'aria-label': 'Mute', onClick: () => player.toggleMute() }, ic('volume', 18));
  const vol = h('input', { type: 'range', class: 'vol', min: 0, max: 100, step: 1, value: Math.round(S.volume * 100), 'aria-label': 'Volume' });
  const volUpd = bindRange(vol);
  vol.addEventListener('input', () => player.setVolume(vol.value / 100));
  const volBox = h('div', { class: 'pb-vol' }, muteBtn, vol);
  volBox.addEventListener('wheel', (e) => { e.preventDefault(); player.setVolume(S.volume + (e.deltaY < 0 ? 0.04 : -0.04)); }, { passive: false });
  const right = h('div', { class: 'pb-right' }, sleepBtn, lyricsBtn, vizBtn, queueBtn, panelBtn, volBox);
  root.replaceChildren(info, center, right);

  function openQueue() {
    setSetting('appearance.nowPlayingPanel', true);
    const btn = document.querySelector('#nowPanel .seg-btn[data-tab="queue"]');
    if (btn) btn.click();
  }

  const paintTrack = () => {
    const t = player.current;
    art.replaceChildren(artEl(t && t.art, { title: t ? t.album : '', cls: 'sm' }));
    title.textContent = t ? t.title : 'Nothing playing';
    artist.textContent = t ? t.artist : 'Pick something from your library';
    artist.onclick = t ? () => { const ar = S.artists.find((a) => a.name === (t.albumArtist || t.artist)); if (ar) navigate('artist', ar.id); } : null;
    heart.classList.toggle('on', !!t && isFav(t.id));
    heart.replaceChildren(ic('heart', 18, { filled: !!t && isFav(t.id) }));
    heart.disabled = !t;
    tot.textContent = fmtTime(player.duration);
  };
  const paintState = () => {
    play.replaceChildren(ic(player.playing ? 'pause' : 'play', 22));
    play.setAttribute('aria-label', player.playing ? 'Pause' : 'Play');
    play.classList.toggle('is-playing', player.playing);
  };
  const paintModes = () => {
    shuffle.classList.toggle('on', player.shuffle);
    repeat.classList.toggle('on', player.repeat !== 'off');
    repeat.replaceChildren(ic(player.repeat === 'one' ? 'repeat1' : 'repeat', 18));
  };
  const paintVol = () => {
    vol.value = S.muted ? 0 : Math.round(S.volume * 100);
    volUpd();
    muteBtn.replaceChildren(ic(S.muted || S.volume === 0 ? 'mute' : S.volume < 0.45 ? 'volumeLow' : 'volume', 18));
  };
  const paintTime = () => {
    const d = player.duration, p = player.position;
    tot.textContent = fmtTime(d);
    if (seeking) return;
    cur.textContent = fmtTime(p);
    seek.value = d ? Math.round((p / d) * 1000) : 0;
    seek.dispatchEvent(new Event('input'));
    cur.textContent = fmtTime(p);
  };
  on_sleep = () => { sleepBtn.classList.toggle('on', sleepActive()); };

  on('player:track', () => { paintTrack(); paintTime(); });
  on('player:state', paintState);
  on('player:modes', paintModes);
  on('player:volume', paintVol);
  on('player:time', paintTime);
  on('player:sleep', () => { clearSleep(); on_sleep(); toast('Sleep timer: paused'); });
  on('favs', () => { const t = player.current; if (t) { heart.classList.toggle('on', isFav(t.id)); heart.replaceChildren(ic('heart', 18, { filled: isFav(t.id) })); } });
  on('settings', () => panelBtn.classList.toggle('on', S.settings.appearance.nowPlayingPanel));
  on('full', () => { lyricsBtn.classList.toggle('on', isFullOpen()); vizBtn.classList.toggle('on', isFullOpen()); });
  paintTrack(); paintState(); paintModes(); paintVol();
  panelBtn.classList.toggle('on', S.settings.appearance.nowPlayingPanel);
  return { openQueue };
}
