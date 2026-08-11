const path = require('path');
const { app, BrowserWindow, dialog } = require('electron');
const { createServer } = require('./server');

const PORT = 4310;
const ICON_PATH = path.join(__dirname, 'build', 'icons', 'icon-256.png');

function createWindow() {
  const win = new BrowserWindow({
    width: 1150,
    height: 820,
    title: 'Widener Esports Stream Control',
    icon: ICON_PATH,
  });
  win.setMenuBarVisibility(false);
  win.loadURL(`http://localhost:${PORT}/control`);
}

// Only one copy of the app can own port 4310 (and the OBS overlays pointed at
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
    const server = createServer(PORT, { dataDir: app.getPath('userData') });
    server.on('error', (err) => {
      dialog.showErrorBox(
        'Widener Esports Stream Control',
        err && err.code === 'EADDRINUSE'
          ? `Port ${PORT} is already in use. Is another copy of the app, or an older version, still running?`
          : `The overlay server failed to start:\n${err}`
      );
      app.quit();
    });
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
