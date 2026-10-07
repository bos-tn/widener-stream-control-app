// Checks of the broadcast package against a mock OBS (dev only):
//
//   node dev/test-broadcast.js
//
// It starts the app's server on a spare port with a throwaway data folder and
// dev/mock-obs.js beside it, then checks the scene build (order, camera
// sources, camera windows in the Scoreboard scene), the camera windows'
// timing and placement, device selection, the match centre, pop-ups, the
// lower third and the series-result pop-up. Nothing touches a real OBS, the
// real app's data or the network. Exit code 1 if a check fails.

const path = require('path');
const os = require('os');
const fs = require('fs');

const dataDir = path.join(os.tmpdir(), 'bx-test-' + Date.now());
process.env.STREAM_PROFILE = 'widener';
process.env.STREAM_DATA_DIR = dataDir;
process.env.WIDENER_RL_PORT = '49198';
process.env.WIDENER_MUSIC_DIR = path.join(dataDir, 'music');
process.env.WIDENER_MONTAGE_DIR = path.join(dataDir, 'montages');
fs.mkdirSync(dataDir, { recursive: true });
// No music or video downloads in a test.
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ music: { enabled: false }, panel: { setupDone: true, guideV2: true } }));

const WebSocket = require('ws');
const { createMockObs } = require('./mock-obs');
const { createServer } = require('../server');

const OBS_PORT = 4467;
const PORT = 4397;
const mock = createMockObs(OBS_PORT);
const server = createServer(PORT);
const j = async (u, o) => { const r = await fetch(`http://127.0.0.1:${PORT}${u}`, o); return r.json(); };
const send = (u, b, m) => j(u, { method: m || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) pass++; else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ' -> ' + JSON.stringify(detail)}`);
}

// A scene's page, as OBS would have it open: it collects the pop-ups sent.
const events = [];
function openPage(role) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    ws.on('open', () => { ws.send(JSON.stringify({ type: 'subscribe', role })); resolve(ws); });
    // Panels get the pop-ups too; one listener is enough.
    ws.on('message', (raw) => { const m = JSON.parse(raw); if (role === 'overlay' && m.type === 'bxEvent') events.push(m.event); });
  });
}

(async () => {
  await wait(500);
  let page, panel;
  try {
    page = await openPage('overlay');
    panel = await openPage('panel');
    const update = async (data) => { panel.send(JSON.stringify({ type: 'update', data })); await wait(120); };

    // --- OBS: scenes and cameras ---------------------------------------------
    const st = await send('/api/obs/connect', { host: '127.0.0.1', port: OBS_PORT, password: '' });
    check('connects to the mock', st.connected === true, st);
    const b1 = await send('/api/obs/build-scenes');
    check('build succeeds', !b1.error, b1);
    const want = ['WU: Starting Soon', 'WU: This Week', 'WU: Matchup', 'WU: Rosters', 'WU: Match Preview', 'WU: Bracket', 'WU: Scoreboard', 'WU: Crowd Cam', 'WU: Comp Room', 'WU: Be Right Back', 'WU: Post-Match'];
    check('scenes in stream order', JSON.stringify(mock.sceneNames()) === JSON.stringify(want), mock.sceneNames());
    check('collection created', b1.collection === 'created' && mock.state.current === 'Widener Stream', [b1.collection, mock.state.current]);
    check('cameras reported created', b1.cameras && b1.cameras.crowd === 'created' && b1.cameras.room === 'created', b1.cameras);
    check('camera inputs are capture devices', ['WU-cam-crowd', 'WU-cam-room'].every((n) => (mock.state.inputs[n] || {}).kind === 'dshow_input'), Object.keys(mock.state.inputs));
    const crowd = mock.items('WU: Crowd Cam');
    check('camera scene: camera under the page', crowd.length === 2 && crowd[0].sourceName === 'WU-cam-crowd' && crowd[1].sourceName === 'WU-src-cam-crowd', crowd.map((i) => i.sourceName));
    check('camera fills the canvas', crowd[0].sceneItemTransform.boundsWidth === 1920 && crowd[0].sceneItemTransform.boundsType === 'OBS_BOUNDS_SCALE_OUTER' && crowd[0].sceneItemTransform.cropToBounds === true, crowd[0].sceneItemTransform);
    check('camera page url', mock.state.inputs['WU-src-cam-crowd'].settings.url === `http://localhost:${PORT}/overlay?view=cam-crowd`, mock.state.inputs['WU-src-cam-crowd'].settings.url);
    check('This Week page url', mock.state.inputs['WU-src-schedule'].settings.url === `http://localhost:${PORT}/overlay?view=schedule`);
    const sb = mock.items('WU: Scoreboard');
    check('scoreboard: capture, cameras, page', JSON.stringify(sb.map((i) => i.sourceName)) === JSON.stringify(['WU-game-capture', 'WU-cam-crowd', 'WU-cam-room', 'WU-src-scoreboard']), sb.map((i) => i.sourceName));
    check('camera windows start hidden', sb.filter((i) => /cam/.test(i.sourceName)).every((i) => i.sceneItemEnabled === false), sb.map((i) => i.sceneItemEnabled));

    let cams = await j('/api/bx/cameras');
    check('camera status lists devices', cams.connected && cams.cameras[0].exists && cams.cameras[0].devices.length === 3 && cams.cameras[0].window === true, cams.cameras[0]);
    const dev = cams.cameras[0].devices[0].value;
    const setDev = await send('/api/bx/cameras/crowd/device', { device: dev });
    cams = await j('/api/bx/cameras');
    check('device is set in OBS', setDev.ok && mock.state.inputs['WU-cam-crowd'].settings.video_device_id === dev && cams.cameras[0].device === dev, cams.cameras[0].device);

    // --- Camera windows: the scenes hear first, OBS a moment later -------------
    const item = () => mock.items('WU: Scoreboard').find((i) => i.sourceName === 'WU-cam-room');
    await send('/api/bx/cam', { id: 'room', pip: true });
    const bxNow = await j('/api/bx');
    check('scenes are told at once', bxNow.cams.find((c) => c.id === 'room').pip === true && !!bxNow.layout.pip.room, bxNow.layout.pip);
    check('OBS not switched yet', item().sceneItemEnabled === false);
    await wait(650);
    const rect = bxNow.layout.pip.room;
    const tr = item().sceneItemTransform;
    check('OBS shows the camera after the delay', item().sceneItemEnabled === true);
    check('camera placed at the window', tr.positionX === rect.x && tr.positionY === rect.y && tr.boundsWidth === rect.w && tr.boundsHeight === rect.h, [tr, rect]);
    await send('/api/bx/cam', { id: 'crowd', pip: true });
    await wait(650);
    const both = (await j('/api/bx')).layout.pip;
    check('two windows do not overlap', both.crowd && both.room && Math.abs(both.crowd.y - both.room.y) >= both.room.h, both);
    check('the first window moved for the second', item().sceneItemTransform.positionY === both.room.y, [item().sceneItemTransform.positionY, both.room]);
    await send('/api/bx/settings', { pip: { pos: 'top-right', size: 's' } });
    await wait(200);
    const moved = (await j('/api/bx')).layout.pip;
    check('window setting moves it in OBS', item().sceneItemTransform.positionX === moved.room.x && item().sceneItemTransform.boundsWidth === 384, [item().sceneItemTransform, moved.room]);
    await send('/api/remote/cam/room/off');
    await send('/api/remote/cam/crowd/toggle');
    await wait(650);
    check('remote routes hide the windows', mock.items('WU: Scoreboard').filter((i) => /cam/.test(i.sourceName)).every((i) => !i.sceneItemEnabled));

    // --- On air follows OBS ------------------------------------------------------
    mock.cutTo('WU: Crowd Cam');
    await wait(150);
    const status = await j('/api/obs/status');
    check('on air: camera scene', status.onAirNow.key === 'cam-crowd' && (await j('/api/state')).mode === 'cam-crowd', status.onAirNow);
    const sw = await send('/api/obs/switch', { key: 'versus' });
    await wait(100);
    check('switch to Matchup', sw.switched && mock.state.collections[mock.state.current].program === 'WU: Matchup', sw);

    // --- Rebuilds ------------------------------------------------------------------
    const shape = () => JSON.stringify([mock.sceneNames(), Object.keys(mock.state.inputs).sort(), mock.items('WU: Scoreboard').map((i) => i.sourceName)]);
    const before = shape();
    const b2 = await send('/api/obs/build-scenes');
    check('second build is idempotent', before === shape() && b2.cameras.crowd === 'exists' && b2.ordering === 'ordered', [b2.cameras, b2.ordering]);
    check('device survives a build', mock.state.inputs['WU-cam-crowd'].settings.video_device_id === dev);
    await send('/api/prefs', { bxScenes: ['schedule', 'versus', 'cam-room'] });
    const insp = await j('/api/obs/inspect');
    check('unticked scene reported unused', insp.stale.includes('WU: Crowd Cam'), insp.stale);
    const b3 = await send('/api/obs/build-scenes');
    check('unticked scene removed', b3.removed.includes('WU: Crowd Cam') && !mock.sceneNames().includes('WU: Crowd Cam'), b3.removed);
    check('its camera input is kept', !!mock.state.inputs['WU-cam-crowd']);
    await send('/api/prefs', { bxScenes: ['schedule', 'versus', 'cam-crowd', 'cam-room'] });
    const b4 = await send('/api/obs/build-scenes');
    check('re-ticked scene returns in order', JSON.stringify(mock.sceneNames()) === JSON.stringify(want), [mock.sceneNames(), b4.ordering, b4.moved]);
    check('re-ticked camera scene reuses its input', mock.items('WU: Crowd Cam')[0].sourceName === 'WU-cam-crowd' && mock.state.inputs['WU-cam-crowd'].settings.video_device_id === dev, mock.items('WU: Crowd Cam').map((i) => i.sourceName));
    await update({ game: 'rl', scoreboard: { style: 'rl' } });
    await send('/api/obs/build-scenes');
    const names5 = mock.sceneNames();
    check('stats scene sits after Scoreboard', names5.indexOf('WU: Rocket League Stats') === names5.indexOf('WU: Scoreboard') + 1 && names5.indexOf('WU: Crowd Cam') === names5.indexOf('WU: Scoreboard') + 2, names5);
    check('layout reserves the Rocket League corners', (await j('/api/bx')).layout.reserved['bottom-right'] === 236);

    // --- Match centre and pop-ups ------------------------------------------------------
    await update({ teamA: { name: 'Widener University', tag: 'WU' }, teamB: { name: 'Rowan University', tag: 'RU' }, scoreboard: { style: 'standard', bestOf: 3, scoreA: 0, scoreB: 0 } });
    const tonight = new Date(Date.now() + 3600 * 1000).toISOString();
    const add = await send('/api/bx/matches', { game: 'VALORANT', league: 'NECC', start: tonight, a: { name: 'Widener University', tag: 'WU' }, b: { name: 'Stevenson University', tag: 'SU' } }, 'PUT');
    check('typed-in match saved', add.ok && add.match.state === 'upcoming', add);
    const same = await send('/api/bx/matches', { game: 'Rocket League', a: { name: 'Rowan University' }, b: { name: 'Widener University' } }, 'PUT');
    let bx = await j('/api/bx');
    const row = (id) => bx.matches.find((m) => m.id === id);
    check('home team marked', row(add.match.id).home === true);
    check('the match on stream is marked', row(same.match.id).onStream === true && row(add.match.id).onStream === false, bx.matches.map((m) => m.onStream));
    check('a match needs two teams', (await send('/api/bx/matches', { a: { name: 'Solo' } }, 'PUT')).error !== undefined);
    events.length = 0;
    await send(`/api/bx/matches/${add.match.id}/score`, { a: 1 });
    await send(`/api/bx/matches/${add.match.id}/score`, { a: 2 });
    bx = await j('/api/bx');
    check('scoring starts the match', row(add.match.id).state === 'live' && row(add.match.id).a.score === 2, row(add.match.id));
    check('no pop-up during the burst', events.length === 0, events);
    await wait(2800);
    check('one pop-up after the burst', events.length === 1 && events[0].kind === 'score' && events[0].changed === 'a' && events[0].match.a.score === 2, events);
    events.length = 0;
    await send(`/api/bx/matches/${same.match.id}/score`, { b: 1 });
    await wait(2800);
    check('no pop-up for the match on stream', events.length === 0, events);
    await send('/api/bx/alert', { matchId: add.match.id, kind: 'final' });
    await send('/api/bx/alert', { kicker: 'Tonight', title: 'Match two at 9 PM' });
    await wait(100);
    check('pop-ups on request', events.length === 2 && events[0].kind === 'final' && events[1].kind === 'note' && events[1].title === 'Match two at 9 PM', events);
    check('a message pop-up needs a headline', (await send('/api/bx/alert', { kicker: 'x' })).error !== undefined);
    const gone = await send(`/api/bx/matches/${add.match.id}`, undefined, 'DELETE');
    check('typed-in match removed', gone.ok && !(await j('/api/bx')).matches.some((m) => m.id === add.match.id));
    await send('/api/bx/matches', add.match, 'PUT');
    check('undo puts it back under the same id', (await j('/api/bx')).matches.some((m) => m.id === add.match.id));

    // --- Series result and lower third ------------------------------------------------------
    events.length = 0;
    await send('/api/remote/score/a/win');
    await wait(100);
    check('no result pop-up before the series is decided', events.length === 0, events);
    await send('/api/remote/score/a/win');
    await wait(100);
    check('result pop-up when the series is decided', events.length === 1 && events[0].kind === 'final' && events[0].own === true && events[0].match.a.score === 2 && events[0].match.a.name === 'Widener University', events);
    await send('/api/remote/score/a/point');
    await wait(100);
    check('no second result pop-up', events.length === 1, events.length);

    const lt = await send('/api/bx/lower', { title: 'Vanta', kicker: 'Player spotlight', team: 'A', seconds: 1 });
    check('lower third on', lt.lower.on === true && lt.lower.title === 'Vanta' && lt.lower.team === 'A', lt.lower);
    await wait(1300);
    check('lower third hides itself', (await j('/api/bx')).lower.on === false);
    await send('/api/bx/lower', { title: 'Stays', seconds: 0 });
    await wait(300);
    check('seconds 0 keeps it up', (await j('/api/bx')).lower.on === true);
    await send('/api/remote/lower/hide');
    check('remote hides it', (await j('/api/bx')).lower.on === false);
    check('a lower third needs a name', (await send('/api/bx/lower', { title: '  ' })).lower.on === false);

    const settings = (await send('/api/bx/settings', { alerts: { pos: 'nowhere', seconds: 500 }, ticker: { messages: [' one ', '', 'two'] } })).settings;
    check('settings are cleaned', settings.alerts.pos === 'top-right' && settings.alerts.seconds === 30 && JSON.stringify(settings.ticker.messages) === '["one","two"]', settings);
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'broadcast.json'), 'utf8'));
    check('stored on disk', saved.v === 1 && saved.manual.length === 2 && saved.settings.ticker.messages.length === 2, Object.keys(saved));
  } catch (e) {
    failed++;
    console.error('ERROR', e);
  }
  console.log(`\n${pass} passed, ${failed} failed`);
  [page, panel].forEach((ws) => { if (ws) ws.close(); });
  await send('/api/obs/disconnect').catch(() => {});
  server.close();
  await mock.close();
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})();
