const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('vinylAccounts', Object.freeze({
  qqStatus: () => ipcRenderer.invoke('accounts:qq-status'),
  openQQ: () => ipcRenderer.invoke('accounts:qq-open'),
  disconnectQQ: () => ipcRenderer.invoke('accounts:qq-disconnect'),
  authorizeSpotify: params => ipcRenderer.invoke('accounts:spotify-authorize', params)
}));
