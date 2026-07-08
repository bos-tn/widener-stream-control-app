const path = require('path');
const { app, BrowserWindow } = require('electron');
const { createServer } = require('./server');

const PORT = 4310;
const ICON_PATH = path.join(__dirname, 'build', 'icons', 'icon-256.png');

function createWindow() {
  const win = new BrowserWindow({
    width: 1150,
    height: 820,
    title: 'Widener Esports — Stream Control',
    icon: ICON_PATH,
  });
  win.setMenuBarVisibility(false);
  win.loadURL(`http://localhost:${PORT}/control`);
}

app.whenReady().then(() => {
  createServer(PORT, { dataDir: app.getPath('userData') });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
