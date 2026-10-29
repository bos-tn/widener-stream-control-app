// Real renderer regression for stats loaded off air in OBS. Uses demo stats,
// a preload stub for obsstudio and isolated data; never connects to OBS.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-entrance-'));
Object.assign(process.env, { STREAM_NO_LOCAL: '1', STREAM_APP_DATA: dataDir,
  STREAM_DATA_DIR: dataDir, WIDENER_RL_PORT: '49204' });
app.setPath('userData', path.join(dataDir, 'electron'));
app.disableHardwareAcceleration();
// Keep the test process alive between its isolated renderer windows.
app.on('window-all-closed', () => {});
const preload = path.join(dataDir, 'obs-preload.js');
fs.writeFileSync(preload, 'window.obsstudio = {};');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server, win, panel;
let failed = false;
app.whenReady().then(async () => {
  try {
    const { seed } = require('./demo');
    seed(dataDir);
    const { loadProfile } = require('../profile');
    for (const id of ['widener', 'lote', 'messiah']) {
      const profile = loadProfile(id);
      // The renderer fixtures are entirely local, including LotE standings
      // and the montage list, which otherwise trigger background downloads.
      profile.broadcast.follow = { links: [] };
      profile.leagueScenes = [];
      profile.music = null;
      profile.games = profile.games.map(({ montage, ...game }) => game);
      server = require('../server').createServer(4389, { profile, host: '127.0.0.1' });
      win = new BrowserWindow({ width: 1920, height: 1080, show: false,
        webPreferences: { preload, contextIsolation: false, offscreen: true, backgroundThrottling: false } });
      win.webContents.setAudioMuted(true);
      if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
      await win.loadURL('http://127.0.0.1:4389/overlay?view=stats');
      const read = (script) => win.webContents.executeJavaScript(script);
      const rows = ".rls.on .rls-pname,.rls.on .rls-cell,.rls.on .rls-label,.rls.on .rls-game";
      for (let i = 0; i < 100; i++) {
        if (await read(`document.querySelectorAll('${rows}').length > 0`)) break;
        await pause(50);
      }
      assert(await read(`document.querySelectorAll('${rows}').length > 0`), id + ': demo stats must render');
      const hidden = () => read(`[...document.querySelectorAll('${rows}')].every(el => getComputedStyle(el).visibility === 'hidden')`);
      const visible = () => read(`[...document.querySelectorAll('${rows}')].every(el => getComputedStyle(el).visibility === 'visible')`);
      assert(await hidden(), id + ': rows hidden from OBS page load');
      assert(await read("[...document.querySelectorAll('.rls.on .rls-pname.mvp em')].every(el => getComputedStyle(el).visibility === 'hidden')"), id + ': MVP badge hidden with its player row');
      const active = (on) => read(`window.dispatchEvent(new CustomEvent('obsSourceActiveChanged', {detail:{active:${on}}})); true`);
      await active(false);
      await pause(3100);
      assert(await hidden(), id + ': explicit off-air state outlives fallback');
      await active(true);
      assert(await visible(), id + ': entrance releases hold in the same frame');
      await pause(2300);
      assert(await visible(), id + ': rows stay visible after entrance');
      // OBS reports the scene change only when the stinger ends, and the
      // server then pushes the state while the entrance is still on. The
      // rows must stay as they are, not start their entrance again.
      const cellIn = "getComputedStyle(document.querySelector('.rls.on .rls-cell')).opacity === '1'";
      for (let i = 0; i < 60 && !(await read(cellIn)); i++) await pause(50);
      assert(await read(cellIn), id + ': first row finished its entrance');
      assert(await read("document.body.classList.contains('enter')"), id + ': entrance still on for the state push');
      await read(`window.__cell = document.querySelector('.rls.on .rls-cell'); window.__heads = 0;
        new MutationObserver(() => window.__heads++).observe(document.querySelector('.rls.on .rls-head'), { childList: true }); true`);
      panel = new WebSocket('ws://127.0.0.1:4389/ws');
      await new Promise((resolve) => panel.once('open', resolve));
      panel.send(JSON.stringify({ type: 'subscribe', role: 'panel' }));
      panel.send(JSON.stringify({ type: 'update', data: {} }));
      for (let i = 0; i < 40 && !(await read('window.__heads > 0')); i++) await pause(25);
      assert(await read('window.__heads > 0'), id + ': state push reached the page');
      await pause(100);
      assert(await read(`document.querySelector('.rls.on .rls-cell') === window.__cell && ${cellIn}`), id + ': state push mid-entrance leaves the rows in place');
      // Another game's stats still redraw the table.
      panel.send(JSON.stringify({ type: 'rlScreen', screen: 'game', game: 0, show: false }));
      for (let i = 0; i < 40 && (await read("document.querySelector('.rls.on .rls-cell') === window.__cell")); i++) await pause(25);
      assert(await read("document.querySelector('.rls.on .rls-cell') !== window.__cell"), id + ': another game redraws the table');
      await active(false);
      assert(await hidden(), id + ': off air re-arms hold');
      panel.send(JSON.stringify({ type: 'rlScreen', screen: 'series', show: false }));
      for (let i = 0; i < 100; i++) {
        if (await read("document.querySelectorAll('.rls.on .rls-game').length > 0")) break;
        await pause(50);
      }
      assert(await read("document.querySelectorAll('.rls.on .rls-game').length > 0"), id + ': series cards must render');
      assert(await hidden(), id + ': series cards and rows stay hidden off air');
      panel.close(); panel = null;

      // Simulate CEF's visibility event independently from the OBS event.
      await active(true);
      await read("Object.defineProperty(document, 'hidden', {configurable:true, value:true}); document.dispatchEvent(new Event('visibilitychange')); true");
      assert(await hidden(), id + ': hidden document re-arms hold');
      await read("Object.defineProperty(document, 'hidden', {configurable:true, value:false}); document.dispatchEvent(new Event('visibilitychange')); true");
      assert(await hidden(), id + ': becoming visible waits for entrance');
      await active(true);
      assert(await visible(), id + ': second entrance releases hold');
      await win.loadURL('http://127.0.0.1:4389/overlay?view=stats');
      await pause(3300);
      assert(await visible(), id + ': no OBS event releases after fallback');
      win.destroy();
      win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
      await win.loadURL('http://127.0.0.1:4389/overlay?view=stats');
      assert.equal(await read("document.body.classList.contains('rls-hold')"), false, id + ': plain browser unaffected');
      win.destroy(); win = null;
      await new Promise((resolve) => server.close(resolve)); server = null;
      console.log('PASS', id, 'stats load, off air, entrance, visibility and fallback');
    }
  } catch (error) { console.error(error); failed = true; }
  finally {
    if (panel) panel.close();
    if (win) win.destroy();
    if (server) server.close();
    app.exit(failed ? 1 : 0);
  }
});
