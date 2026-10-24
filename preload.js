'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const listen = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('cadence', {
  isDesktop: true,
  platform: process.platform,
  kv: {
    load: (key) => invoke('kv:load', key),
    save: (key, value) => invoke('kv:save', key, value),
  },
  pickFolders: () => invoke('dialog:folders'),
  pickFiles: () => invoke('dialog:files'),
  pathsFromFiles: (files) => Array.from(files).map((f) => webUtils.getPathForFile(f)).filter(Boolean),
  scan: (paths) => invoke('library:scan', paths),
  onScanProgress: listen('scan:progress'),
  lyrics: {
    local: (id) => invoke('lyrics:local', id),
    online: (query) => invoke('lyrics:online', query),
  },
  reveal: (id) => invoke('file:reveal', id),
  info: () => invoke('app:info'),
  sub: {
    list: () => invoke('sub:list'),
    connect: (cfg) => invoke('sub:connect', cfg),
    remove: (id) => invoke('sub:remove', id),
    sync: (id) => invoke('sub:sync', id),
    playlists: (id) => invoke('sub:playlists', id),
    playlist: (id, pid) => invoke('sub:playlist', id, pid),
    onProgress: listen('sub:progress'),
  },
});
