const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, dialog, ipcMain, shell, safeStorage } = require('electron');
const { createServer } = require('./server');
const { profileId, listProfiles, listProfileCards, loadProfile, loadSelectableProfile } = require('./profile');

// One install for every team and league profile (v2.3.0). The app runs one
// profile at a time, with that profile's port, data folder, window title and
// icon, so each profile's OBS browser sources, docks and Stream Deck buttons
// keep the address they had when each profile was its own app.
const APP_TITLE = 'Esports Stream Control';
const APP_ICON = path.join(__dirname, 'icons', 'icon-256.png');
const PICKER_PAGE = path.join(__dirname, 'public', 'picker', 'index.html');

// Tests: STREAM_APP_DATA stands in for %APPDATA%, for every profile's data
// folder and Electron's own.
if (process.env.STREAM_APP_DATA) {
  app.setPath('appData', process.env.STREAM_APP_DATA);
  app.setPath('userData', path.join(process.env.STREAM_APP_DATA, app.getName()));
}

// The profile used last, in Electron's own folder (%APPDATA%\<package name>).
// Updates never touch it, so an updated app opens the same profile.
// installSet: the installer default (below) already applied for this user.
const choiceFile = () => path.join(app.getPath('userData'), 'profile-choice.json');
function readChoice() {
  try {
    const c = JSON.parse(fs.readFileSync(choiceFile(), 'utf8'));
    return { profile: String(c.profile || ''), installSet: String(c.installSet || '') };
  } catch (e) { return { profile: '', installSet: '' }; }
}
let appliedInstallSet = '';
function writeChoice(id) {
  const installSet = appliedInstallSet || readChoice().installSet;
  try { fs.writeFileSync(choiceFile(), JSON.stringify({ profile: id, installSet }, null, 2)); } catch (e) { /* the next start asks again */ }
}

// The default profile the installer wrote (its Profile page, --profile=<id>
// on its command line, or the one-profile app it replaced; build/dist.js):
// resources\default-profile.ini, [profile] id=<id>, set=<when it was picked>.
// An update keeps the file as it was.
function installDefault() {
  if (!app.isPackaged) return null;
  let text;
  try { text = fs.readFileSync(path.join(process.resourcesPath, 'default-profile.ini'), 'latin1').replace(/\u0000/g, ''); } catch (e) { return null; }
  const id = (/^\s*id\s*=\s*([a-z0-9-]+)\s*$/mi.exec(text) || [])[1] || '';
  const set = (/^\s*set\s*=\s*(\S+)\s*$/mi.exec(text) || [])[1] || '';
  return id ? { id, set } : null;
}

// Each profile keeps its data in its own folder in %APPDATA% (dataFolder in
// profile.json): the folder its own app used before v2.3.0.
const dataDirOf = (p) => path.join(app.getPath('appData'), p.dataFolder);

// The OBS connection (host, port, password, connect on start). OBS belongs
// to the PC, not to a profile, so every profile uses this one and a switch
// keeps it (the panel used to keep it in its page storage, which is per
// port, so per profile). In Electron's own folder; the password is
// encrypted with this Windows user's key (safeStorage, DPAPI) and is not
// kept where that is unavailable. Served to the panel at /api/obs/saved.
const obsFile = () => path.join(app.getPath('userData'), 'obs-connection.json');
const obsStore = {
  load() {
    let s;
    try { s = JSON.parse(fs.readFileSync(obsFile(), 'utf8')); } catch (e) { return null; }
    let password = '';
    try {
      if (s.password && safeStorage.isEncryptionAvailable()) password = safeStorage.decryptString(Buffer.from(s.password, 'base64'));
    } catch (e) { /* another user's or a damaged key: typed again */ }
    return { host: String(s.host || ''), port: Number(s.port) || 4455, password, autoConnect: !!s.autoConnect };
  },
  save(cfg) {
    const encrypt = safeStorage.isEncryptionAvailable();
    const out = {
      host: cfg.host, port: cfg.port, autoConnect: cfg.autoConnect,
      password: encrypt && cfg.password ? safeStorage.encryptString(cfg.password).toString('base64') : '',
    };
    try { fs.writeFileSync(obsFile(), JSON.stringify(out, null, 2)); } catch (e) { /* kept for this run only */ }
  },
};

// With no choice saved yet (the first start after an update from an app that
// held one profile): the profile whose data was written last on this PC.
function newestData() {
  let best = '';
  let bestTime = 0;
  listProfiles().forEach((id) => {
    let p;
    try { p = loadProfile(id); } catch (e) { return; }
    if (p.locked) return;
    ['state.json', 'settings.json', 'library.json'].forEach((f) => {
      try {
        const t = fs.statSync(path.join(dataDirOf(p), f)).mtimeMs;
        if (t > bestTime) { bestTime = t; best = id; }
      } catch (e) { /* not there */ }
    });
  });
  return best;
}

// --profile=<id> (a dev run, a restart into another profile, a shortcut);
// then a default picked at install that this user has not had yet (once, so
// a later switch sticks); the one used last; the installer default; the
// newest data. '' means the profile page asks.
function pickProfile() {
  const cards = listProfileCards();
  const known = cards.filter((p) => !p.locked).map((p) => p.id);
  const locked = (id) => cards.some((p) => p.id === id && p.locked);
  const ok = (id) => !!id && known.includes(id);
  if (locked(profileId())) return '';
  if (ok(profileId())) return profileId();
  const choice = readChoice();
  const def = installDefault();
  if (def && ok(def.id) && def.set && def.set !== choice.installSet) {
    appliedInstallSet = def.set;
    return def.id;
  }
  if (locked(choice.profile)) return '';
  if (ok(choice.profile)) return choice.profile;
  if (def && locked(def.id)) return '';
  if (def && ok(def.id)) return def.id;
  const newest = newestData();
  return ok(newest) ? newest : '';
}

// Shortcuts from before v2.3.0. Each profile's app had its own exe,
// `<appName>.exe`. The installers replace their own shortcuts, but one the
// operator made or pinned still points at the old exe, which is gone. Such a
// shortcut on this user's desktop, Start menu or taskbar is pointed at this
// app, opening that profile. The installed app only; checked on every start.
function fixOldShortcuts() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const oldExes = {};
  listProfiles().forEach((id) => {
    try { oldExes[`${loadProfile(id).appName}.exe`.toLowerCase()] = id; } catch (e) { /* skipped */ }
  });
  const appData = app.getPath('appData');
  const roots = [
    // A test run (STREAM_APP_DATA) leaves the real desktop alone.
    ...(process.env.STREAM_APP_DATA ? [] : [app.getPath('desktop')]),
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
  ];
  const visit = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    entries.forEach((e) => {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth > 0) visit(file, depth - 1); return; }
      if (!/\.lnk$/i.test(e.name)) return;
      let link;
      try { link = shell.readShortcutLink(file); } catch (err) { return; }
      const id = oldExes[path.basename(link.target || '').toLowerCase()];
      if (!id || fs.existsSync(link.target)) return;
      try {
        shell.writeShortcutLink(file, 'replace', {
          target: process.execPath, cwd: path.dirname(process.execPath), args: `--profile=${id}`,
          description: link.description || '', icon: process.execPath, iconIndex: 0,
          ...(link.appUserModelId ? { appUserModelId: link.appUserModelId } : {}),
        });
      } catch (err) { /* read-only or in use: left as it is */ }
    });
  };
  roots.forEach((r) => visit(r, 2));
}

let win = null;
let server = null;
let current = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 860,
    title: APP_TITLE,
    icon: APP_ICON,
    // Gives the profile page window.streamControl while no profile runs.
    webPreferences: { preload: path.join(__dirname, 'picker-preload.js') },
  });
  win.setMenuBarVisibility(false);
  return win;
}

function showPicker() {
  win.loadFile(PICKER_PAGE);
}

function startProfile(id) {
  let profile;
  try {
    profile = loadSelectableProfile(id);
  } catch (err) {
    dialog.showErrorBox(APP_TITLE, `Profile "${id}" could not be loaded:\n${err.message}`);
    showPicker();
    return;
  }
  current = profile;
  writeChoice(id);
  server = createServer(profile.port, {
    profile,
    dataDir: dataDirOf(profile),
    documentsDir: app.getPath('documents'),
    onProfileChange: switchProfile,
    obsStore,
  });
  server.on('error', (err) => {
    dialog.showErrorBox(
      profile.appName,
      err && err.code === 'EADDRINUSE'
        ? `Port ${profile.port} is in use. Another copy of the app, or of ${profile.appName}, may be running.`
        : `The overlay server failed to start:\n${err}`
    );
    app.quit();
  });
  win.setTitle(profile.appName);
  try { win.setIcon(path.join(profile.iconsDir, 'icon-256.png')); } catch (e) { /* keeps the app icon */ }
  win.loadURL(`http://localhost:${profile.port}/control`);
}

// Another profile: the app restarts in it. A restart, not a swap in place:
// the server's OBS connection, game feed, timers and open pages all belong to
// the old profile. The quit runs before-quit, which gives Rocket League its
// HUD back first.
function switchProfile(id) {
  loadSelectableProfile(id);
  writeChoice(id);
  const args = process.argv.slice(1).filter((a) => !a.startsWith('--profile=')).concat(`--profile=${id}`);
  app.relaunch({ args });
  app.quit();
}

// The profile page before any profile runs (picker-preload.js). Once one
// runs, the page is served by its server and switches through it.
ipcMain.handle('profiles:list', () => ({ profiles: listProfileCards(), current: '', live: false, canSwitch: true, version: app.getVersion() }));
ipcMain.handle('profiles:choose', (e, id) => {
  if (server || !listProfiles().includes(String(id))) return { restarting: false };
  loadSelectableProfile(String(id));
  startProfile(String(id));
  return { restarting: false };
});

// --- Automatic updates (v0.9.0) ----------------------------------------------
// Checks the GitHub releases for a newer version and downloads it in the
// background. It never restarts on its own: restarting stops the overlay
// server, which blanks every OBS browser source for a few seconds, so the
// operator chooses. "Later" installs it the next time the app is closed.
// Only runs in the installed app (a dev run has nothing to update), and any
// failure (offline, GitHub down) is ignored. The updated app opens the
// profile that was open (profile-choice.json).
const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;
function setupAutoUpdates() {
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

// Only one copy of the app runs, with one profile, so two profiles never
// connect to the same OBS at once. A second launch focuses the window; one
// that names another profile (--profile=<id>) offers to switch to it.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', async (e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const id = profileId(argv);
    if (!current || !id || id === current.id || !listProfiles().includes(id)) return;
    let target;
    try { target = loadSelectableProfile(id); } catch (err) { return; }
    const live = server ? await server.isLive().catch(() => false) : false;
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: APP_TITLE,
      buttons: ['Switch', 'Cancel'],
      defaultId: live ? 1 : 0,
      cancelId: 1,
      message: `${current.name} is open.`,
      detail: `Switching to ${target.name} restarts the app.${live ? ' OBS is streaming or recording.' : ''}`,
    });
    if (response === 0) switchProfile(id);
  });

  app.whenReady().then(() => {
    createWindow();
    const id = pickProfile();
    if (id) startProfile(id);
    else showPicker();
    setupAutoUpdates();
    fixOldShortcuts();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        if (current) win.loadURL(`http://localhost:${current.port}/control`);
        else showPicker();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // The app turns Rocket League's HUD off for a spectator (rlstats.js). On
  // the way out it turns it back on, and the command needs a moment to reach
  // the game before the process ends.
  let released = false;
  app.on('before-quit', (e) => {
    if (released || !server) return;
    released = true;
    if (!server.releaseGame()) return;
    e.preventDefault();
    setTimeout(() => app.quit(), 300);
  });
}
