// The profile page (public/picker) opened from the app's own files, before
// any profile runs: it lists the profiles and starts one through main.js.
// Pages served over http (the control panel, the profile page once a profile
// runs) do not get it; they use the server's /api/app routes.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('streamControl', {
    profiles: () => ipcRenderer.invoke('profiles:list'),
    choose: (id) => ipcRenderer.invoke('profiles:choose', id),
  });
}
