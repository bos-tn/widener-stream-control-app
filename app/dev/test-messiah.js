// Focused Messiah profile smoke test against the mock OBS server. No real OBS
// instance or installed profile data is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messiah-beta-mock-'));
process.env.STREAM_PROFILE = 'messiah';
process.env.STREAM_NO_LOCAL = '1';
process.env.STREAM_DATA_DIR = dataDir;
process.env.WIDENER_RL_PORT = '49199';
process.env.WIDENER_MUSIC_DIR = path.join(dataDir, 'music');
process.env.WIDENER_MONTAGE_DIR = path.join(dataDir, 'montages');
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ music: { enabled: false }, panel: { setupDone: true, guideV2: true } }));
fs.writeFileSync(path.join(dataDir, 'broadcast.json'), JSON.stringify({ v: 1, defaultsDone: true }));

const { loadProfile, listProfileCards } = require('../profile');
const { createServer } = require('../server');
const { createMockObs } = require('./mock-obs');
const profile = loadProfile('messiah');
const obsPort = 4468;
const port = 4398;
const mock = createMockObs(obsPort);
const server = createServer(port, { profile, host: '127.0.0.1' });
const base = `http://127.0.0.1:${port}`;
const get = (route) => fetch(base + route);
const post = async (route, body) => (await fetch(base + route, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
})).json();

(async () => {
  try {
    assert(listProfileCards().some((p) => p.id === 'messiah' && p.kind === 'team' && p.icon.startsWith('data:image/png;')));
    const brand = await (await get('/api/profile')).json();
    assert.equal(brand.id, 'messiah');
    assert.deepEqual(brand.backgrounds.list.map((b) => b.id), ['plate-30', 'plate-25', 'plate-08', 'plate-01', 'plate-05']);
    assert.equal(brand.backgrounds.defaults['starting-soon'], 'plate-25');
    assert.equal(brand.backgrounds.defaults.brb, 'plate-30');
    assert.equal(brand.backgrounds.defaults.stats, 'plate-05');
    assert.equal(brand.stinger.name, 'Messiah Stinger');
    for (const asset of ['logo.png', 'panel-logo.png', 'plate-engine.js', 'guide/logo-blue-white.png', 'guide/wordmark-blue-white.png']) {
      assert.equal((await get('/brand/' + asset)).status, 200, asset);
    }
    assert.equal((await get('/brand-theme.js')).status, 200);
    assert.equal((await get('/brand-theme.css')).status, 200);
    assert.equal((await get('/overlay?view=starting-soon')).status, 200);
    const games = await (await get('/api/games')).json();
    assert(games.some((g) => g.id === 'rl'));
    const teams = await (await get('/api/library')).json();
    assert(teams.teams.some((t) => t.name === 'Messiah University'));

    const connected = await post('/api/obs/connect', { host: '127.0.0.1', port: obsPort, password: '' });
    assert.equal(connected.connected, true);
    const built = await post('/api/obs/build-scenes');
    assert(!built.error, JSON.stringify(built));
    assert.equal(mock.state.current, 'Messiah Stream');
    const scenes = mock.sceneNames();
    for (const name of ['MU: Starting Soon', 'MU: This Week', 'MU: Matchup', 'MU: Rosters', 'MU: Gameplay/Scoreboard', 'MU: Be Right Back', 'MU: Post-Match']) {
      assert(scenes.includes(name), name);
    }
    assert(scenes.every((name) => name.startsWith('MU: ')), JSON.stringify(scenes));
    assert.equal(mock.state.inputs['MU-src-starting-soon'].settings.url, `http://localhost:${port}/overlay?view=starting-soon`);
    console.log('Messiah profile: brand, assets, library, and mock OBS scenes passed');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await post('/api/obs/disconnect').catch(() => {});
    server.close();
    await mock.close();
    if (path.dirname(dataDir) === os.tmpdir() && path.basename(dataDir).startsWith('messiah-beta-mock-')) fs.rmSync(dataDir, { recursive: true, force: true });
  }
})();
