// Release availability checks, using isolated files, localhost and hidden Electron.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-lock-'));
app.setPath('userData', path.join(dir, 'electron'));
Object.assign(process.env, { STREAM_NO_LOCAL: '1', STREAM_APP_DATA: dir, WIDENER_RL_PORT: '49349' });
const root = process.env.STREAM_RELEASE_ROOT || path.join(__dirname, '..');
const releaseRequire = createRequire(path.join(root, 'main.js'));
const { loadProfile, loadSelectableProfile, listProfileCards } = releaseRequire('./profile');
const { installerScript } = require('../build/dist');
const { createServer } = releaseRequire('./server');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let checks = 0, server, win;
const check = (label, fn) => { fn(); checks++; console.log('ok  ' + label); };
async function until(fn) { for (let i = 0; i < 50; i++) { if (await fn()) return; await wait(50); } throw new Error('Picker did not become ready.'); }

function mainHarness() {
  const folders = { appData: path.join(dir, 'appdata'), userData: path.join(dir, 'userdata') };
  Object.values(folders).forEach((p) => fs.mkdirSync(p, { recursive: true }));
  const handlers = {}, events = {}, calls = { starts: 0, relaunches: 0, pickers: 0 };
  const fakeApp = { isPackaged: true, setPath: (k, v) => { folders[k] = v; }, getPath: (k) => folders[k], getName: () => 'lock-test',
    getVersion: () => 'test', requestSingleInstanceLock: () => true, on: (name, fn) => { events[name] = fn; }, whenReady: () => ({ then() {} }), quit() {}, relaunch() { calls.relaunches++; } };
  const req = createRequire(path.join(root, 'main.js'));
  const context = { require: (name) => name === 'electron' ? { app: fakeApp, BrowserWindow: {}, dialog: { showErrorBox() {}, showMessageBox() { throw new Error('Locked launch must not offer a switch.'); } },
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, shell: {}, safeStorage: {} } : name === './server' ? { createServer: () => { calls.starts++; } } : name === './profile' ? { ...req(name), profileId: (argv) => req(name).profileId(argv || context.process.argv) } : req(name),
    __dirname: root, module: { exports: {} }, console, setTimeout,
    process: { ...process, env: { STREAM_APP_DATA: folders.appData }, argv: ['electron', 'main.js'], resourcesPath: path.join(dir, 'resources') } };
  fs.mkdirSync(context.process.resourcesPath, { recursive: true });
  vm.runInNewContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8') + '\nmodule.exports={pickProfile,startProfile,switchProfile,setWindow(w){win=w},setCurrent(p){current=p}};', context);
  context.module.exports.setWindow({ loadFile() { calls.pickers++; }, isMinimized: () => false, focus() {} });
  return { ...context.module.exports, context, folders, handlers, events, calls };
}

app.whenReady().then(async () => {
  try {
    const cards = listProfileCards(), messiah = cards.find((p) => p.id === 'messiah');
    check('Messiah stays listed but locked; other profiles remain selectable', () => {
      assert.equal(messiah.locked, true); assert(messiah.lockReason);
      assert.equal(loadSelectableProfile('widener').locked, false); assert.equal(loadSelectableProfile('lote').locked, false);
      assert.throws(() => loadSelectableProfile('messiah'), /locked/);
      assert.equal(loadProfile('messiah').games.length, 7, 'locked profile assets remain available for internal tests');
    });
    const script = installerScript([], cards), index = cards.findIndex((p) => p.id === 'messiah');
    check('Installer greys Messiah out and cannot persist it as the chosen profile', () => {
      assert(script.includes('Messiah Esports (Locked)')); assert(script.includes(`EnableWindow $profileRadio${index} 0`));
      assert(!script.includes(`\${NSD_Check} $profileRadio${index}`));
      assert(!script.includes(`\${NSD_GetState} $profileRadio${index}`));
      assert(!script.includes('$R1 == "messiah"'));
      assert(script.includes('$defaultProfile == "messiah"\n    StrCpy $defaultProfile ""'.replaceAll('\n', '\r\n')));
    });
    const main = mainHarness();
    const choiceFile = path.join(main.folders.userData, 'profile-choice.json');
    fs.mkdirSync(main.folders.userData, { recursive: true });
    const choice = (profile) => fs.writeFileSync(choiceFile, JSON.stringify({ profile }));
    choice('widener'); main.context.process.argv.push('--profile=messiah');
    check('A direct locked startup opens the picker instead of another team', () => assert.equal(main.pickProfile(), ''));
    main.context.process.argv.pop(); choice('messiah');
    check('A saved locked profile opens the picker and keeps its saved data intact', () => { assert.equal(main.pickProfile(), ''); assert.equal(JSON.parse(fs.readFileSync(choiceFile)).profile, 'messiah'); });
    fs.unlinkSync(choiceFile);
    fs.writeFileSync(path.join(main.context.process.resourcesPath, 'default-profile.ini'), '[profile]\nid=messiah\nset=test');
    check('An old locked installer default opens the picker', () => assert.equal(main.pickProfile(), ''));
    choice('lote');
    check('An available last-used profile still opens', () => assert.equal(main.pickProfile(), 'lote'));
    check('IPC and relaunch paths reject locked selections before saving a choice', () => {
      assert.throws(() => main.handlers['profiles:choose']({}, 'messiah'), /locked/);
      assert.throws(() => main.switchProfile('messiah'), /locked/);
      assert.equal(main.calls.relaunches, 0); assert.equal(JSON.parse(fs.readFileSync(choiceFile)).profile, 'lote');
      main.startProfile('messiah'); assert.equal(main.calls.starts, 0); assert.equal(main.calls.pickers, 1);
    });
    main.setCurrent(loadProfile('widener'));
    await main.events['second-instance']({}, ['app', '--profile=messiah']);
    check('A second launch cannot switch to the locked profile', () => assert.equal(main.calls.relaunches, 0));

    const profile = loadProfile('widener'); profile.music = null; profile.leagueScenes = [];
    profile.games = profile.games.map((g) => ({ ...g, montage: undefined })); profile.broadcast.follow = { links: [], scope: 'all' };
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ music: { enabled: false } }));
    fs.writeFileSync(path.join(dir, 'broadcast.json'), JSON.stringify({ v: 1, defaultsDone: true }));
    let switches = 0;
    server = createServer(4478, { profile, dataDir: dir, host: '127.0.0.1', onProfileChange: () => { switches++; } });
    if (!server.listening) await once(server, 'listening');
    const choose = async (id) => { const r = await fetch('http://127.0.0.1:4478/api/app/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); return { status: r.status, data: await r.json() }; };
    const denied = await choose('messiah');
    check('HTTP switch rejects locked Messiah', () => { assert.equal(denied.status, 403); assert.match(denied.data.error, /locked/); });
    const unknown = await choose('unknown'); assert.equal(unknown.status, 400);
    const current = await choose('widener'); assert.equal(current.data.restarting, false);

    win = new BrowserWindow({ show: false, width: 800, height: 760, webPreferences: { preload: path.join(root, 'picker-preload.js') } });
    const js = (code) => win.webContents.executeJavaScript(code);
    const assertPicker = async (where) => {
      await until(() => js("!!document.querySelector('[data-id=messiah]')"));
      const result = await js("(()=>{const m=document.querySelector('[data-id=messiah]');return {disabled:m.disabled,aria:m.getAttribute('aria-disabled'),text:m.textContent,filter:getComputedStyle(m).filter,others:[...document.querySelectorAll('.item:not([data-id=messiah])')].every(b=>!b.disabled),focused:document.activeElement.dataset.id}})()");
      check(where + ' picker visibly locks Messiah and leaves other choices enabled', () => { assert.equal(result.disabled, true); assert.equal(result.aria, 'true'); assert.match(result.text, /Locked/); assert.equal(result.filter, 'grayscale(1)'); assert(result.others); assert.notEqual(result.focused, 'messiah'); });
      await js("document.querySelector('[data-id=messiah]').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
      assert.equal(await js("document.getElementById('status').textContent"), messiah.lockReason);
    };
    await win.loadURL('http://127.0.0.1:4478/picker/'); await assertPicker('Settings');
    // A failed enabled choice must not re-enable the locked button.
    await win.webContents.session.protocol.handle('http', () => new Response(JSON.stringify({ error: 'Test switch failure' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
    await js("document.querySelector('[data-id=lote]').click()");
    await until(() => js("document.getElementById('status').textContent==='Test switch failure'"));
    const stillLocked = await js("document.querySelector('[data-id=messiah]').disabled");
    check('Failed switches keep Messiah disabled', () => assert.equal(stillLocked, true));
    await win.webContents.session.protocol.unhandle('http');
    ipcMain.handle('profiles:list', () => ({ profiles: cards, current: '', canSwitch: true }));
    ipcMain.handle('profiles:choose', (_e, id) => loadSelectableProfile(id));
    await win.loadFile(path.join(root, 'public/picker/index.html')); await assertPicker('Startup');
    await js("document.getElementById('status').textContent=''");
    const output = path.join(__dirname, '../dist/profile-lock-review'); fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'picker.png'), (await win.webContents.capturePage()).toPNG());
    const enabled = await choose('lote'); assert.equal(enabled.status, 200); await wait(250);
    check('LotE still switches; blocked selections never invoke the restart callback', () => assert.equal(switches, 1));
    console.log(`\n${checks} profile lock checks passed`);
    win.destroy(); await new Promise((resolve) => server.close(resolve)); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
