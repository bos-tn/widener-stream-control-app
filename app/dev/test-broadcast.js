// Checks of the broadcast package against a mock OBS (dev only):
//
//   node dev/test-broadcast.js
//
// It starts the app's server on a spare port with a throwaway data folder and
// dev/mock-obs.js beside it, then checks the scene build (order, camera
// sources, camera windows in the Scoreboard scene), the camera windows'
// timing and placement, device selection, the video settings (read, raised to
// 1080p60, refused while live), the match centre, pop-ups, the
// lower third, the series-result pop-up, network cameras (a page, a stream,
// their signal) and the league feed (schools, the default feed, clearing). Nothing touches a real OBS, the real app's data
// or the network: the league site is stood in for below. Exit code 1 if a
// check fails.

const path = require('path');
const os = require('os');
const fs = require('fs');

const dataDir = path.join(os.tmpdir(), 'bx-test-' + Date.now());
process.env.STREAM_PROFILE = 'widener';
// The cameras start as capture devices whatever this PC's local.json says.
process.env.STREAM_NO_LOCAL = '1';
process.env.STREAM_DATA_DIR = dataDir;
process.env.WIDENER_RL_PORT = '49198';
process.env.WIDENER_MUSIC_DIR = path.join(dataDir, 'music');
process.env.WIDENER_MONTAGE_DIR = path.join(dataDir, 'montages');
fs.mkdirSync(dataDir, { recursive: true });
// No music or video downloads in a test.
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ music: { enabled: false }, panel: { setupDone: true, guideV2: true } }));
// The profile's default feed is asked for further down, not at start.
fs.writeFileSync(path.join(dataDir, 'broadcast.json'), JSON.stringify({ v: 1, defaultsDone: true }));

// The league site, stood in for. broadcast.js takes these from necc.js when
// it loads, so they are swapped before the server is required.
const necc = require('../necc');
const league = { schoolSeasons: [1, 2], atOnce: 0, peak: 0 };
const fakeSeason = (i) => ({ id: 'season' + String(i).padStart(11, '0'), name: `Rocket League | Division ${i}`, activity: 'rl', start: 0, end: 0 });
const fakeSchool = { id: 'school00000000000', name: 'Widener University', tag: 'WU' };
// Thursday noon of this week, so the matches are in range on any day.
const thisWeek = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) + 3, 12).getTime(); })();
necc.resolveLeagueLink = async (url) => {
  const base = { hostname: new URL(url).hostname, leagueId: 'league00000000000' };
  if (/\/groups\//.test(url)) return { ...base, seasons: league.schoolSeasons.map(fakeSeason), school: { ...fakeSchool, teamId: '' } };
  if (/\/seasons\//.test(url)) return { ...base, seasons: [fakeSeason(40)] };
  return { ...base, seasons: Array.from({ length: 20 }, (_, i) => fakeSeason(i + 10)) };
};
necc.schoolSeasons = async () => ({ school: fakeSchool, teams: [], seasons: league.schoolSeasons.map(fakeSeason) });
necc.seasonMatches = async (host, leagueId, seasonId) => {
  league.atOnce++;
  league.peak = Math.max(league.peak, league.atOnce);
  await new Promise((r) => setTimeout(r, 15));
  league.atOnce--;
  const team = (name) => ({ id: name, name, tag: '', org: name, color: '', colorAlt: '', logoUrl: '' });
  const match = (id, a, b) => ({ id: id + seasonId, round: 'Week 1', stage: '', start: thisWeek, state: 'scheduled', teams: [team(a), team(b)], wins: [0, 0], games: 0, bestOf: 5, link: `https://test.v1.leagueos.gg/league/matches/${id}` });
  return { seasonId, seasonName: 'Season', activity: 'rl', matches: [match('a', 'Widener University Gold', 'Rowan University'), match('b', 'Hood College', 'York College')] };
};

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
    check('build names each camera source', b1.cameraSources.crowd.input === 'WU-cam-crowd' && b1.cameraSources.crowd.kind === 'device', b1.cameraSources);
    check('Studio Mode is off unless ticked', mock.state.studioMode === false && (await j('/api/prefs')).prefs.studioMode === false);
    // The week runs between two local midnights, whatever the clocks do in it
    // (2026-11-01 and 2027-03-14 are the US changes).
    const { weekOf } = require('../broadcast');
    check('a week ends at local midnight on Monday', [new Date(2026, 9, 28, 15), new Date(2027, 2, 10, 15), new Date()].every((d) => {
      const w = weekOf(d.getTime());
      const [from, to] = [new Date(w.from), new Date(w.to)];
      return from.getDay() === 1 && to.getDay() === 1 && from.getHours() === 0 && to.getHours() === 0 && to.getDate() !== from.getDate() && w.from <= d.getTime() && d.getTime() < w.to;
    }));
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

    // --- Video settings ------------------------------------------------------------
    const video = async () => (await j('/api/obs/inspect')).video;
    const calls = (type) => mock.state.calls.filter((c) => c.requestType === type);
    const pageOf = (scene, source) => mock.items(scene).find((i) => i.sourceName === source);
    let v = await video();
    check('video read: 1080p60 passes', v.ok && v.base.w === 1920 && v.output.h === 1080 && v.fps === 60 && !v.locked && v.bitrate === 6000 && v.rescale === '', v);
    check('nothing to raise: OBS is not asked', (await send('/api/obs/video')).changed === false && calls('SetVideoSettings').length === 0);
    Object.assign(mock.state.video, { baseWidth: 1280, baseHeight: 720, outputWidth: 1280, outputHeight: 720, fpsNumerator: 30000, fpsDenominator: 1001 });
    await send('/api/obs/build-scenes');
    check('scenes built on a 720p canvas', mock.state.inputs['WU-src-brb'].settings.width === 1280 && pageOf('WU: Be Right Back', 'WU-src-brb').sceneItemTransform.boundsHeight === 720);
    v = await video();
    check('720p at 29.97 reads as low', !v.ok && v.base.w === 1280 && v.output.h === 720 && v.fps === 29.97 && !v.locked, v);
    mock.state.streaming = true;
    const held = await send('/api/obs/video');
    check('refused while streaming', held.changed === false && held.blocked === 'live' && held.video.locked === true && mock.state.video.baseWidth === 1280, held);
    check('read as locked while streaming', (await video()).locked === true);
    mock.state.streaming = false;
    const raised = await send('/api/obs/video');
    check('raised to 1080p60', raised.changed && raised.video.ok && JSON.stringify(mock.state.video) === JSON.stringify({ baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080, fpsNumerator: 60, fpsDenominator: 1 }), [raised, mock.state.video]);
    const brb = pageOf('WU: Be Right Back', 'WU-src-brb').sceneItemTransform;
    check('pages follow the canvas', raised.refitted === mock.sceneNames().length && mock.state.inputs['WU-src-brb'].settings.width === 1920 && mock.state.inputs['WU-src-brb'].settings.height === 1080 && brb.boundsWidth === 1920 && brb.boundsHeight === 1080, [raised.refitted, brb]);
    check('a page keeps its address', mock.state.inputs['WU-src-brb'].settings.url === `http://localhost:${PORT}/overlay?view=brb`);
    check('cameras follow the canvas', pageOf('WU: Crowd Cam', 'WU-cam-crowd').sceneItemTransform.boundsWidth === 1920 && pageOf('WU: Crowd Cam', 'WU-cam-crowd').sceneItemTransform.boundsHeight === 1080, pageOf('WU: Crowd Cam', 'WU-cam-crowd').sceneItemTransform);
    // A larger canvas scaled down: only the output size is under.
    Object.assign(mock.state.video, { baseWidth: 2560, baseHeight: 1440, outputWidth: 1280, outputHeight: 720, fpsNumerator: 60000, fpsDenominator: 1001 });
    v = await video();
    check('a scaled-down output reads as low, 59.94 does not', !v.ok && v.fps === 59.94, v);
    const outOnly = await send('/api/obs/video');
    const sent = calls('SetVideoSettings').pop().requestData;
    check('only the output size is raised', outOnly.changed && outOnly.refitted === 0 && JSON.stringify(sent) === JSON.stringify({ outputWidth: 1920, outputHeight: 1080 }) && mock.state.video.baseWidth === 2560 && mock.state.video.fpsNumerator === 60000, [sent, mock.state.video]);
    // What the stream is sent at, where OBS says.
    mock.state.profile['SimpleOutput/VBitrate'] = '2500';
    check('a Simple mode bitrate is read', (await video()).bitrate === 2500);
    Object.assign(mock.state.profile, { 'Output/Mode': 'Advanced', 'AdvOut/RescaleFilter': '3', 'AdvOut/RescaleRes': '1280x720' });
    v = await video();
    check('Advanced mode: a stream rescaled under 1080p is read, no bitrate', v.rescale === '1280x720' && v.bitrate === 0, v);
    mock.state.profile['AdvOut/RescaleFilter'] = '0';
    check('Advanced mode: rescale off', (await video()).rescale === '');
    Object.assign(mock.state.profile, { 'Output/Mode': 'Simple', 'SimpleOutput/VBitrate': '6000' });
    Object.assign(mock.state.video, { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080, fpsNumerator: 60, fpsDenominator: 1 });

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

    // --- Network cameras -----------------------------------------------------------------
    // Two stand-ins for a camera server: a page that answers a WebRTC request
    // the way MediaMTX does (400 for a path that is sending, 404 for one that
    // is not), and an RTSP port that describes /live and nothing else.
    const http = require('http');
    const net = require('net');
    const camPage = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/live/whep') { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end('{"status":"error","error":"failed to unmarshal SDP: EOF"}'); }
      if (req.method === 'POST' && /\/whep$/.test(req.url)) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"status":"error","error":"no stream is available on path \'idle\'"}'); }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<video id="video"></video>');
    });
    const camRtsp = net.createServer((sock) => {
      sock.on('data', (d) => {
        const live = /^DESCRIBE rtsp:\/\/[^/]+\/live /.test(d.toString());
        sock.end(live ? 'RTSP/1.0 200 OK\r\nCSeq: 1\r\nContent-Length: 0\r\n\r\n' : 'RTSP/1.0 404 Not Found\r\nCSeq: 1\r\n\r\n');
      });
      sock.on('error', () => {});
    });
    await new Promise((r) => camPage.listen(0, '127.0.0.1', r));
    await new Promise((r) => camRtsp.listen(0, '127.0.0.1', r));
    const pageUrl = (p) => `http://127.0.0.1:${camPage.address().port}/${p}/`;
    const rtspUrl = (p) => `rtsp://127.0.0.1:${camRtsp.address().port}/${p}`;
    const camRow = async (id) => (await j('/api/bx/cameras')).cameras.find((c) => c.id === id);
    const sceneItems = (name) => mock.items(name).map((i) => i.sourceName);
    const kindOf = (n) => (mock.state.inputs[n] || {}).kind;

    check('a camera with no link is a capture device', (await camRow('room')).kind === 'device' && kindOf('WU-cam-room') === 'dshow_input' && (await j('/api/bx')).cams.every((c) => c.link === ''));
    const l1 = await send('/api/bx/cameras/room/link', { url: pageUrl('live') });
    let room = await camRow('room');
    check('a page link makes a browser source', l1.ok && l1.link === pageUrl('live') && l1.applied === 'created' && kindOf('WU-netcam-room') === 'browser_source' && !mock.state.inputs['WU-cam-room'], [l1, Object.keys(mock.state.inputs).filter((n) => /room/.test(n))]);
    const pageSettings = mock.state.inputs['WU-netcam-room'].settings;
    check('it shows the link, restyled, sound through OBS', pageSettings.url === pageUrl('live') && /#message/.test(pageSettings.css) && /object-fit: cover/.test(pageSettings.css) && pageSettings.reroute_audio === true && pageSettings.shutdown === false, pageSettings);
    check('camera scene: the page source under the overlay', JSON.stringify(sceneItems('WU: Comp Room')) === JSON.stringify(['WU-netcam-room', 'WU-src-cam-room']), sceneItems('WU: Comp Room'));
    check('scoreboard: its window is there, off', mock.items('WU: Scoreboard').some((i) => i.sourceName === 'WU-netcam-room' && i.sceneItemEnabled === false) && !sceneItems('WU: Scoreboard').includes('WU-cam-room'), sceneItems('WU: Scoreboard'));
    check('status: a page, built, sending', room.kind === 'page' && room.exists && room.window && room.link === pageUrl('live') && room.live && room.live.state === 'live', room);
    check('the panel and scenes are told the link', (await j('/api/bx')).cams.find((c) => c.id === 'room').link === pageUrl('live'));

    await send('/api/bx/cam', { id: 'room', pip: true });
    await wait(700);
    const netWin = mock.items('WU: Scoreboard').find((i) => i.sourceName === 'WU-netcam-room');
    check('its window opens over the game', netWin.sceneItemEnabled === true && netWin.sceneItemTransform.boundsWidth > 0 && netWin.sceneItemTransform.cropToBounds === true, netWin);
    await send('/api/bx/cam', { id: 'room', pip: false });
    await wait(700);

    await send('/api/bx/cameras/room/link', { url: pageUrl('idle') });
    room = await camRow('room');
    check('a changed link is set on the same source', mock.state.inputs['WU-netcam-room'].settings.url === pageUrl('idle') && room.live.state === 'idle', [mock.state.inputs['WU-netcam-room'].settings.url, room.live]);
    await send('/api/bx/cameras/room/link', { url: 'http://127.0.0.1:9/gone/' });
    check('a link that does not answer says so', (await camRow('room')).live.state === 'down');

    const l2 = await send('/api/bx/cameras/room/link', { url: rtspUrl('live') });
    room = await camRow('room');
    const streamSettings = (mock.state.inputs['WU-stream-room'] || {}).settings || {};
    check('a stream address makes a media source', l2.applied === 'created' && kindOf('WU-stream-room') === 'ffmpeg_source' && !mock.state.inputs['WU-netcam-room'], Object.keys(mock.state.inputs).filter((n) => /room/.test(n)));
    check('it reads the stream over TCP, unbuffered', streamSettings.input === rtspUrl('live') && streamSettings.is_local_file === false && streamSettings.ffmpeg_options === 'rtsp_transport=tcp' && streamSettings.buffering_mb === 0, streamSettings);
    check('status: a stream, sending', room.kind === 'stream' && room.exists && room.live.state === 'live', room);
    await send('/api/bx/cameras/room/link', { url: rtspUrl('nothing') });
    check('a stream with no camera on it', (await camRow('room')).live.state === 'idle');
    const bare = await send('/api/bx/cameras/room/link', { url: '127.0.0.1:8554/cam1' });
    check('an address with an RTSP port and no scheme is RTSP', bare.link === 'rtsp://127.0.0.1:8554/cam1' && mock.state.inputs['WU-stream-room'].settings.input === bare.link, bare);
    const bad = await send('/api/bx/cameras/room/link', { url: 'not an address' });
    check('something that is not an address is refused', !!bad.error && (await j('/api/bx')).cams.find((c) => c.id === 'room').link === bare.link, bad);

    const bCam = await send('/api/obs/build-scenes');
    check('a build keeps a network camera as it is', bCam.cameras.room === 'exists' && bCam.cameras.crowd === 'exists' && kindOf('WU-stream-room') === 'ffmpeg_source' && kindOf('WU-cam-crowd') === 'dshow_input', bCam.cameras);
    check('build names a network camera by its own source', bCam.cameraSources.room.input === 'WU-stream-room' && bCam.cameraSources.room.kind === 'stream' && bCam.cameraSources.crowd.kind === 'device', bCam.cameraSources);
    const l3 = await send('/api/bx/cameras/room/link', { url: '' });
    check('no link: a capture device again', l3.link === '' && l3.applied === 'created' && kindOf('WU-cam-room') === 'dshow_input' && !mock.state.inputs['WU-stream-room'] && JSON.stringify(sceneItems('WU: Comp Room')) === JSON.stringify(['WU-cam-room', 'WU-src-cam-room']), [l3, sceneItems('WU: Comp Room')]);
    const savedCams = JSON.parse(fs.readFileSync(path.join(dataDir, 'broadcast.json'), 'utf8')).camLinks;
    check('the choice is stored only when it differs from the profile', JSON.stringify(savedCams) === '{}', savedCams);
    camPage.close();
    camRtsp.close();

    // --- Scene pages that never loaded ------------------------------------------------
    // No browser is behind the mock, so no page has connected: a few seconds
    // after the connect every scene's source was reloaded, once. A page that
    // is connected is left alone.
    const presses = (n) => ((mock.state.inputs[n] || {}).pressed || []).filter((p) => p === 'refreshnocache').length;
    const pressed = { soon: presses('WU-src-starting-soon'), brb: presses('WU-src-brb') };
    check('unloaded scene pages were reloaded after connecting', pressed.soon >= 1 && pressed.brb >= 1, pressed);
    const scenePage = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    await new Promise((r) => scenePage.on('open', r));
    scenePage.send(JSON.stringify({ type: 'subscribe', role: 'overlay', view: 'brb', necc: '' }));
    await wait(21000);
    await send('/api/obs/disconnect');
    await send('/api/obs/connect', { host: '127.0.0.1', port: OBS_PORT, password: '' });
    await wait(4600);
    check('a connected page is not reloaded', presses('WU-src-brb') === pressed.brb && presses('WU-src-starting-soon') === pressed.soon + 1, [presses('WU-src-brb'), presses('WU-src-starting-soon')]);
    scenePage.close();

    // --- League feed: schools, the default feed, clearing ------------------------------
    const feed = () => j('/api/bx');
    const fromLeague = (f) => f.matches.filter((m) => m.src === 'league');
    let f = await feed();
    check('an install that was already set up keeps its feed', f.follows.length === 0 && f.schools.length === 0 && f.defaultFeed === true, [f.follows.length, f.defaultFeed]);
    const d1 = await send('/api/bx/follows/default');
    await wait(200);
    f = await feed();
    check('default feed follows the school', !d1.error && d1.added === 2 && f.schools.length === 1 && f.schools[0].name === 'Widener University', d1);
    check('its seasons belong to it', f.follows.length === 2 && f.follows.every((x) => x.school === f.schools[0].id && x.checkedAt), f.follows);
    check('default scope keeps the home team', f.settings.scope === 'home' && fromLeague(f).length === 2 && fromLeague(f).every((m) => m.home), fromLeague(f).map((m) => m.a.name));
    await send('/api/bx/settings', { scope: 'all' });
    check('scope all shows every match', fromLeague(await feed()).length === 4);

    // The profile's own league: the school's link is offered instead.
    const big = await send('/api/bx/follows', { url: 'https://necc.v1.leagueos.gg/' });
    check('a league home page asks first', big.confirm === true && big.count === 20 && /\/groups\//.test(big.ownLink) && (await feed()).follows.length === 2, big);
    league.peak = 0;
    const all = await send('/api/bx/follows', { url: 'https://necc.v1.leagueos.gg/', all: true });
    await wait(500);
    f = await feed();
    check('all: true follows them', all.added === 20 && f.follows.length === 22, [all.added, f.follows.length]);
    check('seasons are read two at a time', league.peak === 2 && f.follows.every((x) => x.checkedAt && !x.error), league.peak);
    const one = await send('/api/bx/follows', { url: 'https://test.v1.leagueos.gg/league/seasons/x' });
    check('a season link follows one season', one.added === 1 && !one.confirm && (await feed()).follows.length === 23, one);

    // The school's teams move on: one season ends, another starts.
    league.schoolSeasons = [2, 3];
    await send('/api/bx/refresh');
    await wait(200);
    f = await feed();
    const schoolId = f.schools[0].id;
    check('a school follows its teams into a new season', f.follows.filter((x) => x.school === schoolId).map((x) => x.name.slice(-1)).sort().join('') === '23' && f.follows.length === 23, f.follows.filter((x) => x.school === schoolId).map((x) => x.name));

    const cleared = await send('/api/bx/follows', {}, 'DELETE');
    f = await feed();
    check('clear removes every season and school', cleared.removed.follows.length === 23 && cleared.removed.schools.length === 1 && !f.follows.length && !f.schools.length && !fromLeague(f).length, [f.follows.length, f.schools.length]);
    check('typed-in matches stay', f.matches.length === 2, f.matches.length);
    await send('/api/bx/follows/restore', cleared.removed);
    await wait(500);
    f = await feed();
    check('restore puts them back', f.follows.length === 23 && f.schools.length === 1 && f.follows.every((x) => x.checkedAt), [f.follows.length, f.schools.length]);
    await send('/api/bx/follows/restore', { follows: [{ id: 'abcd1234', host: 'example.com', leagueId: 'league00000000000', seasonId: 'season00000000099' }] });
    check('restore refuses a host that is not LeagueOS', (await feed()).follows.length === 23);
    await send(`/api/bx/schools/${schoolId}`, {}, 'DELETE');
    f = await feed();
    check('removing a school removes its seasons', !f.schools.length && f.follows.length === 21 && !f.follows.some((x) => x.school), [f.schools.length, f.follows.length]);
    const d2 = await send('/api/bx/follows/default');
    await wait(200);
    f = await feed();
    check('default feed replaces what was followed', d2.removed.follows.length === 21 && f.follows.length === 2 && f.schools.length === 1 && f.settings.scope === 'home', [f.follows.length, f.settings.scope]);
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
