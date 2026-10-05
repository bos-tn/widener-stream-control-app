const path = require('path');
const { app, BrowserWindow, dialog } = require('electron');
const { createServer, PROFILE } = require('./server');

// The league profile this build was made for (see profile.js): its window
// title, icon and port. Each league's app has its own port, so two leagues'
// apps on one PC never fight over the same address.
const PORT = PROFILE.port;
const ICON_PATH = path.join(PROFILE.iconsDir, 'icon-256.png');
const APP_TITLE = PROFILE.appName;

// Each league's app keeps its data in its own folder, named after its
// package name. An installer already carries that name (build/dist.js); a dev
// run (`npm run start:lote`) still has the shared package.json, so point it
// at the same folder the installed app would use.
if (PROFILE.build.packageName && app.getName() !== PROFILE.build.packageName) {
  app.setPath('userData', path.join(app.getPath('appData'), PROFILE.build.packageName));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 860,
    title: APP_TITLE,
    icon: ICON_PATH,
  });
  win.setMenuBarVisibility(false);
  win.loadURL(`http://localhost:${PORT}/control`);
  return win;
}

// --- Automatic updates (v0.9.0) ----------------------------------------------
// Checks the GitHub releases for a newer version and downloads it in the
// background. It never restarts on its own: restarting stops the overlay
// server, which blanks every OBS browser source for a few seconds, so the
// operator chooses. "Later" installs it the next time the app is closed.
// Only runs in the installed app (a dev run has nothing to update), and any
// failure (offline, GitHub down) is ignored.
const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;
function setupAutoUpdates(win) {
  if (!app.isPackaged) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', () => {});
  let prompted = false;
  autoUpdater.on('update-downloaded', async (info) => {
    if (prompted) return;
    prompted = true;
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: APP_TITLE,
      buttons: ['Restart and update', 'Later'],
      defaultId: 1,
      cancelId: 1,
      message: `Version ${info.version} downloaded.`,
      detail: 'Restarting interrupts the overlay server for a few seconds; browser sources go blank meanwhile. '
        + 'Later: the update installs when the app closes.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, UPDATE_CHECK_MS);
}

// Only one copy of the app can own its port (and the OBS overlays pointed at
// it). If a second copy is launched, just focus the existing window instead of
// dying on a port conflict.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    const server = createServer(PORT, { dataDir: app.getPath('userData'), documentsDir: app.getPath('documents') });
    server.on('error', (err) => {
      dialog.showErrorBox(
        APP_TITLE,
        err && err.code === 'EADDRINUSE'
          ? `Port ${PORT} is in use. Another instance of the app may be running.`
          : `The overlay server failed to start:\n${err}`
      );
      app.quit();
    });
    const win = createWindow();
    setupAutoUpdates(win);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
