// Player cameras (Messiah profile) against the mock OBS and a stand-in for the
// Rocket League Stats API. Off by default; on: the spectated home player's
// camera stays at the bottom left, and all three stack on the left during a
// goal replay.
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messiah-playercams-'));
process.env.STREAM_PROFILE = 'messiah';
process.env.STREAM_NO_LOCAL = '1';
process.env.STREAM_DATA_DIR = dataDir;
process.env.STREAM_APP_DATA = dataDir;
process.env.WIDENER_RL_PORT = '49198';
process.env.WIDENER_MUSIC_DIR = path.join(dataDir, 'music');
process.env.WIDENER_MONTAGE_DIR = path.join(dataDir, 'montages');
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ music: { enabled: false }, panel: { setupDone: true, guideV2: true, cameraPrefsVersion: 2, bxScenes: ['schedule', 'versus'] } }));
fs.writeFileSync(path.join(dataDir, 'broadcast.json'), JSON.stringify({ v: 1, defaultsDone: true }));

const { loadProfile } = require('../profile');
const { createServer } = require('../server');
const { createMockObs } = require('./mock-obs');
const profile = loadProfile('messiah');
fs.writeFileSync(path.join(dataDir, 'broadcast.json'), JSON.stringify({ v: 1, defaultsDone: true, defaultsVersion: profile.broadcast.follow.version }));
const obsPort = 4469;
const port = 4399;
const mock = createMockObs(obsPort);
const server = createServer(port, { profile, host: '127.0.0.1' });
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (route, body) => (await fetch(base + route, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
})).json();
const bxNow = async () => (await fetch(base + '/api/bx')).json();

// The game's feed: one client (the app), one frame a push.
const clients = new Set();
const feedServer = net.createServer((sock) => { clients.add(sock); sock.on('close', () => clients.delete(sock)); sock.on('error', () => {}); });
const NAMES = [['Pride Lion', 'Blue Hen', 'Chester'], ['Rival One', 'Rival Two', 'Rival Three']];
const players = NAMES.flatMap((names, team) => names.map((Name, i) => ({ Name, Shortcut: team * 3 + i + 1, TeamNum: team, Boost: 50, Speed: 1000, bHasCar: true })));
let frame = 0;
function feed({ target, replay }) {
  const t = players.find((p) => p.Name === target);
  const data = {
    MatchGuid: 'TEST', Players: players,
    Game: {
      Teams: [{ Name: 'Blue', TeamNum: 0, Score: 0 }, { Name: 'Orange', TeamNum: 1, Score: 0 }],
      TimeSeconds: 250 - (frame++), bOvertime: false, Ball: { Speed: 900, TeamNum: 0 }, bReplay: !!replay, bHasWinner: false,
      Arena: 'Stadium_P', bHasTarget: !!t, Target: t ? { Name: t.Name, Shortcut: t.Shortcut, TeamNum: t.TeamNum } : undefined,
    },
  };
  const out = JSON.stringify({ Event: 'UpdateState', Data: JSON.stringify(data) });
  clients.forEach((c) => c.write(out));
}

let passed = 0;
function check(name, cond, detail) {
  if (!cond) { console.error('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); process.exitCode = 1; throw new Error(name); }
  passed++; console.log('ok  ', name);
}
const up = (cams) => cams.filter((c) => c.pip).map((c) => c.id);
async function settle() { await sleep(1000); }

(async () => {
  let panel;
  try {
    await new Promise((r) => feedServer.listen(49198, '127.0.0.1', r));
    panel = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => panel.on('open', r));
    panel.send(JSON.stringify({ type: 'subscribe', role: 'panel' }));
    panel.send(JSON.stringify({ type: 'update', data: {
      teamA: { name: 'Messiah University', tag: 'MU', players: [{ name: 'A', gamertag: 'Pride Lion' }, { name: 'B', gamertag: 'Blue Hen' }, { name: 'C', gamertag: 'Chester' }] },
      teamB: { name: 'Rival U', tag: 'RIV', players: [{ name: 'D', gamertag: 'Rival One' }] },
      scoreboard: { style: 'rl' },
    } }));
    await sleep(300);

    const connected = await post('/api/obs/connect', { host: '127.0.0.1', port: obsPort, password: '' });
    check('OBS connects', connected.connected === true);

    // Off by default: no scenes, no sources, nothing opens.
    let s = await bxNow();
    check('setting is off by default', s.settings.playerCams.on === false, s.settings);
    const built0 = await post('/api/obs/build-scenes');
    check('first build succeeds', !built0.error, built0);
    check('no player camera scene while off', !mock.sceneNames().some((n) => /Player \d/.test(n)), mock.sceneNames());
    check('no player camera source while off', !Object.keys(mock.state.inputs).some((n) => /player/.test(n)));
    await sleep(500);
    for (let i = 0; i < 5; i++) { feed({ target: 'Pride Lion' }); await sleep(60); }
    await settle();
    s = await bxNow();
    check('off: spectating a home player opens nothing', up(s.cams).length === 0, up(s.cams));

    // On: the sources are built.
    await post('/api/bx/settings', { playerCams: { on: true } });
    const needed = await (await fetch(base + '/api/obs/inspect')).json();
    check('setting on marks player scenes as needing a build', needed.exists['cam-player1'] === false, needed.exists);
    check('automation setting is persisted', JSON.parse(fs.readFileSync(path.join(dataDir, 'broadcast.json'))).settings.playerCams.on === true);
    const built1 = await post('/api/obs/build-scenes');
    check('build with the setting on succeeds', !built1.error, built1);
    check('player camera scenes built', ['MU: Player 1', 'MU: Player 2', 'MU: Player 3'].every((n) => mock.sceneNames().includes(n)), mock.sceneNames());
    const sb = () => mock.items('MU: Gameplay/Scoreboard');
    check('all player window sources exist in the Scoreboard scene', ['player1', 'player2', 'player3'].every((id) => sb().some((x) => x.sourceName === `MU-cam-${id}`)));
    const win = (id) => sb().find((x) => x.sourceName === `MU-cam-${id}`);

    // Spectating a home player: that player's camera, bottom left.
    const hold = async (opts, ms = 1200) => { for (let i = 0; i < ms / 100; i++) { feed(opts); await sleep(100); } };
    await hold({ target: 'Pride Lion' });
    s = await bxNow();
    check('POV on player 1 opens camera 1 only', JSON.stringify(up(s.cams)) === '["player1"]', up(s.cams));
    check('camera 1 is at the bottom left', s.layout.pip.player1.pos === 'bottom-left' && s.layout.pip.player1.x === 40, s.layout.pip);
    check('frame is labelled with the gamertag', s.cams.find((c) => c.id === 'player1').tab === 'Pride Lion', s.cams.map((c) => c.tab));
    check('OBS shows camera 1 at its window', win('player1').sceneItemEnabled === true && win('player1').sceneItemTransform.positionX === s.layout.pip.player1.x && win('player1').sceneItemTransform.positionY === s.layout.pip.player1.y, win('player1'));
    check('other cameras stay hidden', !win('player2').sceneItemEnabled && !win('player3').sceneItemEnabled);

    await post('/api/bx/settings', { pip: { pos: 'top-right', size: 'l' } });
    s = await bxNow();
    check('automatic windows ignore manual corner and size', s.layout.pip.player1.pos === 'bottom-left' && s.layout.pip.player1.w === 384 && s.layout.pip.player1.h === 216);
    const manual = await post('/api/bx/cam', { id: 'player2', pip: true });
    check('manual requests cannot override automation', !!manual.error && JSON.stringify(up((await bxNow()).cams)) === '["player1"]');
    // A brief target change must not start a new frame or open an OBS item.
    feed({ target: 'Chester' }); await sleep(100);
    s = await bxNow();
    check('short POV change keeps the current frame', JSON.stringify(up(s.cams)) === '["player1"]');
    await hold({ target: 'Pride Lion' }, 800);
    check('cancelled POV change never opens camera 3 in OBS', !win('player3').sceneItemEnabled);

    // POV moves to another home player.
    await hold({ target: 'Chester' });
    s = await bxNow();
    check('POV on player 3 swaps to camera 3', JSON.stringify(up(s.cams)) === '["player3"]', up(s.cams));
    check('OBS follows the swap', win('player3').sceneItemEnabled === true && win('player1').sceneItemEnabled === false);

    // POV on an opponent: nothing.
    await hold({ target: 'Rival One' });
    s = await bxNow();
    check('POV on an opponent closes the camera', up(s.cams).length === 0 && !win('player3').sceneItemEnabled, up(s.cams));

    // Goal replay: all three, stacked on the left, first player on top.
    await hold({ target: 'Rival One', replay: true });
    s = await bxNow();
    const r = ['player1', 'player2', 'player3'].map((id) => s.layout.pip[id]);
    check('replay opens all three cameras', JSON.stringify(up(s.cams)) === '["player1","player2","player3"]', up(s.cams));
    check('replay stack is on the left, one above the other', r.every((x) => x && x.pos === 'bottom-left' && x.x === 40) && r[0].y < r[1].y && r[1].y < r[2].y && r[0].y + r[0].h < r[1].y && r[1].y + r[1].h < r[2].y, r);
    check('stack stays clear of the top of the screen and the scoreboard', r[0].y - 34 > 168 && r[2].y + r[2].h <= 1080 - 40, r);
    check('OBS shows all three', ['player1', 'player2', 'player3'].every((id) => win(id).sceneItemEnabled === true));

    // Replay over, POV back on a home player.
    await hold({ target: 'Blue Hen' });
    s = await bxNow();
    check('after the replay, only the POV camera stays', JSON.stringify(up(s.cams)) === '["player2"]', up(s.cams));
    check('OBS hides the others', win('player2').sceneItemEnabled === true && !win('player1').sceneItemEnabled && !win('player3').sceneItemEnabled);

    // Roster changes re-map a live target without a new game packet.
    const update = async (data) => {
      const changed = new Promise((resolve) => {
        const onMessage = (raw) => { if (JSON.parse(raw).type === 'state') { panel.off('message', onMessage); resolve(); } };
        panel.on('message', onMessage);
      });
      panel.send(JSON.stringify({ type: 'update', data }));
      await changed;
    };
    await update({ teamA: { name: 'Messiah University', tag: 'MU', players: [{ name: 'B', gamertag: 'BLUE HEN' }, { name: 'A', gamertag: 'Pride Lion' }, { name: 'C', gamertag: 'Chester' }] } });
    await settle();
    check('roster edits and case-insensitive gamertags re-map the POV', JSON.stringify(up((await bxNow()).cams)) === '["player1"]' && win('player1').sceneItemEnabled, await bxNow());
    await update({ teamA: { name: 'Messiah University', tag: 'MU', players: [{ name: 'Blue Hen', gamertag: 'DifferentTag' }, { name: 'A', gamertag: 'Pride Lion' }, { name: 'C', gamertag: 'Chester' }] } });
    await settle();
    check('name fallback keeps the camera and updates its tab', (await bxNow()).cams[0].tab === 'DifferentTag' && win('player1').sceneItemEnabled);
    await hold({ target: 'Pride Lion' });

    clients.forEach((c) => c.write(JSON.stringify({ Event: 'MatchDestroyed', Data: '{}' })));
    await settle();
    check('no match closes every player window', up((await bxNow()).cams).length === 0 && !win('player2').sceneItemEnabled);
    await hold({ target: 'Pride Lion', replay: true });

    // Turning the setting off closes them.
    await post('/api/bx/settings', { playerCams: { on: false } });
    check('turning off removes frames immediately', up((await bxNow()).cams).length === 0);
    await settle();
    s = await bxNow();
    check('turning the setting off closes the camera', up(s.cams).length === 0 && !win('player2').sceneItemEnabled, up(s.cams));
    await hold({ target: 'Pride Lion', replay: true }, 600);
    s = await bxNow();
    check('off again: a replay opens nothing', up(s.cams).length === 0, up(s.cams));
    await post('/api/obs/build-scenes');
    check('off rebuild removes unselected player scenes', !mock.sceneNames().some((n) => /Player \d/.test(n)));
    await post('/api/prefs', { bxScenes: ['camera-group'] });
    await post('/api/obs/build-scenes');
    check('off setting still permits the selected group alone', mock.sceneNames().includes('MU: Player Cams') && !mock.sceneNames().includes('MU: Player 1') && mock.items('MU: Player Cams').filter((i) => /MU-cam-player/.test(i.sourceName)).length === 3);
    await post('/api/bx/cam', { id: 'player1', pip: true }); await sleep(100);
    await post('/api/bx/settings', { playerCams: { on: true } });
    await hold({ target: 'Rival One' });
    check('automation cancels an outstanding manual opening', up((await bxNow()).cams).length === 0 && !win('player1').sceneItemEnabled);
    await hold({ target: 'Chester' }, 400);
    await post('/api/bx/settings', { playerCams: { on: false } });
    await settle();
    check('turning off cancels a pending automatic OBS opening', ['player1', 'player2', 'player3'].every((id) => !win(id).sceneItemEnabled));
    await post('/api/bx/cam', { id: 'player1', pip: true }); await settle();
    s = await bxNow();
    check('manual mode resumes with the selected corner and size', s.layout.pip.player1.pos === 'top-right' && s.layout.pip.player1.w === 640 && win('player1').sceneItemEnabled);
    console.log(`Player cameras: ${passed} checks passed`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (panel) panel.close();
    clients.forEach((c) => c.destroy());
    feedServer.close();
    await post('/api/obs/disconnect').catch(() => {});
    server.close();
    await mock.close();
    if (path.dirname(dataDir) === os.tmpdir() && path.basename(dataDir).startsWith('messiah-playercams-')) fs.rmSync(dataDir, { recursive: true, force: true });
  }
})();
