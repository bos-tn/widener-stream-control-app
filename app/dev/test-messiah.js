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
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ music: { enabled: false }, panel: { setupDone: true, guideV2: true,
  neccTypes: ['matchPreview', 'stageBracket'], bxScenes: ['schedule', 'versus', 'cam-crowd', 'cam-room'] } }));

const appRoot = process.env.STREAM_TEST_ROOT || path.join(__dirname, '..');
const { loadProfile, listProfileCards } = require(path.join(appRoot, 'profile'));
const { createServer } = require(path.join(appRoot, 'server'));
const { createMockObs } = require('./mock-obs');
const profile = loadProfile('messiah');
fs.writeFileSync(path.join(dataDir, 'broadcast.json'), JSON.stringify({ v: 1, defaultsDone: true, defaultsVersion: profile.broadcast.follow.version }));
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
    assert.deepEqual(brand.broadcast.cameras.map((c) => c.id), ['player1', 'player2', 'player3']);
    assert.deepEqual(brand.broadcast.cameraGroup.cameras, ['player1', 'player2', 'player3']);
    assert(brand.leagueGraphics.exclude.includes('matchPreview'));
    const prefs = (await (await get('/api/prefs')).json()).prefs;
    assert(!prefs.neccTypes.includes('matchPreview'));
    assert(prefs.bxScenes.includes('camera-group'));
    assert(prefs.bxScenes.includes('schedule'));
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
    for (const name of ['MU: Starting Soon', 'MU: This Week', 'MU: Matchup', 'MU: Rosters', 'MU: Gameplay/Scoreboard', 'MU: Player 1', 'MU: Player 2', 'MU: Player 3', 'MU: Player Cams', 'MU: Be Right Back', 'MU: Post-Match']) {
      assert(scenes.includes(name), name);
    }
    assert(!scenes.includes('MU: Crowd Cam') && !scenes.includes('MU: Comp Room') && !scenes.includes('MU: Match Preview'));
    assert.deepEqual(mock.items('MU: Player Cams').map((item) => item.sourceName).sort(),
      ['MU-cam-player1', 'MU-cam-player2', 'MU-cam-player3', 'MU-src-camera-group'].sort());
    assert.equal(mock.items('MU: Player Cams').at(-1).sourceName, 'MU-src-camera-group');
    assert.deepEqual(mock.items('MU: Player Cams').slice(0, 3).map((item) => item.sceneItemTransform.positionX), [96, 680, 1264]);
    const checkFrames = (scale = 1) => profile.broadcast.cameraGroup.frames.forEach((r, i) => {
      const t = mock.items('MU: Player Cams')[i].sceneItemTransform;
      assert.equal(t.positionX, r.x * scale);
      assert.equal(t.positionY, r.y * scale);
      assert.equal(t.boundsWidth, r.w * scale);
      assert.equal(t.boundsHeight, r.h * scale);
      assert.equal(t.cropToBounds, true);
    });
    checkFrames();
    mock.state.video.baseWidth = 1280; mock.state.video.baseHeight = 720;
    await post('/api/obs/build-scenes'); checkFrames(2 / 3);
    mock.state.video.baseWidth = 1920; mock.state.video.baseHeight = 1080;
    await post('/api/obs/build-scenes'); checkFrames();
    assert(scenes.every((name) => name.startsWith('MU: ')), JSON.stringify(scenes));
    assert.equal(mock.state.inputs['MU-src-starting-soon'].settings.url, `http://localhost:${port}/overlay?view=starting-soon`);
    assert.equal(mock.state.inputs['MU-src-schedule'].settings.url, `http://localhost:${port}/overlay?view=schedule`);
    await post('/api/bx/cam', { id: 'player1', pip: true });
    await new Promise((resolve) => setTimeout(resolve, 520));
    await post('/api/bx/cam', { id: 'player2', pip: true });
    await new Promise((resolve) => setTimeout(resolve, 520));
    const windows = mock.items('MU: Gameplay/Scoreboard');
    const activeWindow = windows.find((item) => item.sourceName === 'MU-cam-player2').sceneItemTransform;
    assert(activeWindow.positionY + activeWindow.boundsHeight <= 980, 'camera window leaves room for the raised ticker');
    assert.equal(windows.find((item) => item.sourceName === 'MU-cam-player1').sceneItemEnabled, false);
    assert.equal(windows.find((item) => item.sourceName === 'MU-cam-player2').sceneItemEnabled, true);
    // Rapid selection must cancel pending windows, including a camera which
    // has not yet passed the opening delay.
    await post('/api/bx/cam', { id: 'player1', pip: true });
    await post('/api/bx/cam', { id: 'player3', pip: true });
    await post('/api/bx/cam', { id: 'player2', pip: true });
    await new Promise((resolve) => setTimeout(resolve, 520));
    assert.deepEqual(mock.items('MU: Gameplay/Scoreboard').filter((item) => /MU-cam-player/.test(item.sourceName) && item.sceneItemEnabled).map((item) => item.sourceName), ['MU-cam-player2']);
    const changed = await post('/api/bx/cameras/player1/link', { url: 'http://127.0.0.1:8889/player1/' });
    assert.equal(changed.applied, 'created');
    assert(mock.items('MU: Player Cams').some((item) => item.sourceName === 'MU-netcam-player1'));
    assert(!mock.items('MU: Player Cams').some((item) => item.sourceName === 'MU-cam-player1'));
    checkFrames();
    await post('/api/bx/cameras/player2/link', { url: 'http://127.0.0.1:8889/player2/' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(mock.items('MU: Gameplay/Scoreboard').find((item) => item.sourceName === 'MU-netcam-player2').sceneItemEnabled, true);
    // Keeping the timeout scene must not re-enable unticked solo scenes.
    await post('/api/prefs', { bxScenes: ['schedule', 'versus', 'camera-group'] });
    await post('/api/obs/build-scenes');
    for (const label of ['Player 1', 'Player 2', 'Player 3']) assert(!mock.sceneNames().includes('MU: ' + label));
    assert.equal(mock.items('MU: Player Cams').filter((item) => /MU-(netcam|cam)-player/.test(item.sourceName)).length, 3);
    await post('/api/bx/cameras/player1/link', { url: '' });
    assert(mock.items('MU: Player Cams').some((item) => item.sourceName === 'MU-cam-player1'));
    await post('/api/prefs', { bxScenes: ['schedule', 'versus', 'cam-player1', 'cam-player2', 'cam-player3', 'camera-group'] });
    await post('/api/obs/build-scenes');
    mock.state.collections['Messiah Stream'].scenes.push({ name: 'MU: Crowd Cam', items: [{ id: 10001, source: 'MU-cam-crowd', enabled: true, transform: {} }], filters: [] });
    mock.state.collections['Messiah Stream'].scenes.push({ name: 'MU: Comp Room', items: [], filters: [] });
    mock.state.collections['Messiah Stream'].scenes.push({ name: 'MU: Match Preview', items: [], filters: [] });
    mock.state.inputs['MU-cam-crowd'] = { kind: 'dshow_input', settings: {} };
    mock.scene('MU: Gameplay/Scoreboard').items.push({ id: 10002, source: 'MU-cam-crowd', enabled: false, transform: {} });
    const rebuilt = await post('/api/obs/build-scenes');
    assert(rebuilt.removed.includes('MU: Crowd Cam') && rebuilt.removed.includes('MU: Comp Room') && rebuilt.removed.includes('MU: Match Preview'));
    assert(!mock.state.inputs['MU-cam-crowd']);
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
