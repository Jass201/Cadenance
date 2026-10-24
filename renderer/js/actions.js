// App-level actions shared by several screens (adding music, demo library).
import { api, isDesktop } from './bridge.js';
import { S, addTracks, emit, setSetting } from './state.js';
import { generateDemo } from './demo.js';
import { toast } from './ui.js';
import { plural } from './util.js';

let scanning = false;
api.onScanProgress((p) => emit('scan', p));

export async function scanInto(paths) {
  if (!paths.length || scanning) return 0;
  scanning = true;
  emit('scan', { phase: 'discover', done: 0, total: 0 });
  try {
    const tracks = await api.scan(paths);
    const added = addTracks(tracks);
    toast(added ? `Added ${plural(added, 'track')}` : tracks.length ? 'Library is already up to date' : 'No audio files found', { kind: added ? 'ok' : 'info' });
    return added;
  } catch (e) {
    toast(`Couldn’t read that: ${e.message || e}`, { kind: 'error', timeout: 5000 });
    return 0;
  } finally {
    scanning = false;
    emit('scan', { phase: 'done' });
  }
}

export async function addFolder() {
  const paths = await api.pickFolders();
  if (!paths.length) return;
  if (isDesktop) {
    const folders = new Set(S.settings.library.folders);
    paths.forEach((p) => folders.add(p));
    setSetting('library.folders', [...folders]);
  }
  await scanInto(paths);
}

export async function addFiles() {
  const paths = await api.pickFiles();
  if (paths.length) await scanInto(paths);
}

export async function rescanFolders() {
  const folders = S.settings.library.folders;
  if (!folders.length) { toast('No watched folders yet'); return; }
  await scanInto(folders);
}

export function loadDemo() {
  const { tracks, lyrics } = generateDemo();
  S.demoLyrics = lyrics;
  const added = addTracks(tracks);
  toast(`Loaded ${plural(added, 'demo track')} — synthesized, just for exploring`, { kind: 'ok', timeout: 4000 });
}
