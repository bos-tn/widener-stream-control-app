// Hidden Electron review of real control-panel actions and the overlay in
// all profiles. Artifacts go to the requested folder, never runtime data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const WebSocket = require('ws');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'series-visual-'));
const game = process.argv[3] || 'val';
const ow = game === 'ow';
const mr = game === 'mr', lol = game === 'lol', cod = game === 'cod', r6 = game === 'r6';
const samples = { val: ['Ascent', 'Haven'], ow: ['Lijiang Tower', 'Kings Row'], mr: ['Wakanda', 'Tokyo 2099'], lol: ["Summoner's Rift", 'Game two'], r6: ['Bank', 'Chalet'], cod: ['Organizer map A', 'Organizer map B'] };
if (!samples[game]) throw new Error('Choose val, ow, mr, lol, r6 or cod.');
const [firstMap, secondMap] = samples[game];
const output = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'scoreboard-review'));
app.setPath('userData', path.join(dataDir, 'electron'));
Object.assign(process.env, { STREAM_NO_LOCAL: '1', STREAM_APP_DATA: dataDir, WIDENER_RL_PORT: '49329' });
const { loadProfile } = require('../profile');
const { createServer } = require('../server');
const errors = [], report = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let server, socket, panel, overlay;
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.commandLine.appendSwitch('force-device-scale-factor', '1');
async function until(fn, label) { for (let i = 0; i < 80; i++) { if (await fn()) return; await wait(75); } throw new Error('Timed out: ' + label); }
function windowOf(w, h) {
  const win = new BrowserWindow({ width: w, height: h, useContentSize: true, show: false, frame: false, transparent: true, backgroundColor: '#00000000', webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3 && !/ERR_FILE_NOT_FOUND|favicon/.test(message)) errors.push(message); });
  win.webContents.on('render-process-gone', (_e, info) => errors.push(JSON.stringify(info)));
  return win;
}
async function screenshot(win, name) {
  await wait(200);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(output, name + '.png'), image.toPNG());
}
app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const [i, id] of ['widener', 'lote', 'messiah'].entries()) {
      const dir = path.join(dataDir, id); fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ music: { enabled: false }, panel: { setupDone: true, guideV2: true } }));
      fs.writeFileSync(path.join(dir, 'broadcast.json'), JSON.stringify({ v: 1, defaultsDone: true }));
      const profile = loadProfile(id); profile.music = null; profile.leagueScenes = []; profile.broadcast.follow = { links: [], scope: 'all' };
      if (!profile.games.some((g) => g.id === game)) continue;
      profile.games = profile.games.map((g) => ({ ...g, montage: undefined }));
      const port = 4496 + i, base = `http://127.0.0.1:${port}`;
      server = createServer(port, { profile, dataDir: dir, host: '127.0.0.1' });
      if (!server.listening) await once(server, 'listening');
      socket = new WebSocket(base.replace('http', 'ws') + '/ws'); await once(socket, 'open');
      socket.send(JSON.stringify({ type: 'subscribe', role: 'panel' })); await wait(100);
      const changed = new Promise((resolve) => { const listener = (raw) => { const m = JSON.parse(raw); if (m.type === 'state' && m.data.game === game) { socket.off('message', listener); resolve(); } }; socket.on('message', listener); });
      socket.send(JSON.stringify({ type: 'update', data: { game, team: profile.games.find((g) => g.id === game).name, montage: false,
        teamA: { name: profile.name, tag: id === 'widener' ? 'WU' : id === 'lote' ? 'LOTE' : 'MU', color: profile.colors.teamA || '#1557a1', logoUrl: '/brand/' + profile.assets.logo },
        teamB: { name: 'Very Long Opponent University Esports Program', tag: 'OPP', color: '#b54a64', logoUrl: '' },
        scoreboard: profile.games.find((g) => g.id === game).scoreboard } })); await changed;
      panel = windowOf(1200, 1000); overlay = windowOf(1920, 1080);
      await panel.loadURL(base + '/control?page=live');
      const js = (code) => panel.webContents.executeJavaScript(code);
      await until(() => js(`!!window.seriesPanel && state?.game === '${game}' && !document.getElementById('seriesControls').hidden`), 'panel loaded');
      const edit = async (id, value) => {
        await js(`(() => { const e=document.getElementById(${JSON.stringify(id)}); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
        await until(() => js("!document.getElementById('seriesUndo').disabled"), 'command complete');
        await wait(120);
      };
      await edit('seriesMapName', firstMap);
      if (ow) { await edit('seriesBanA', 'Ana'); await edit('seriesBanB', 'Kiriko'); }
      if (mr) { await edit('seriesBanA', 'Hulk, Thor'); await edit('seriesLockB', 'Luna Snow, Mantis'); }
      if (lol) { await edit('seriesBlue', 'B'); await edit('seriesPicksA', 'Ahri, Jinx'); await js("document.getElementById('seriesDraftConfirmed').checked=true; document.getElementById('seriesDraftConfirmed').dispatchEvent(new Event('change',{bubbles:true}))"); await until(() => js('state.series.maps[0].draftConfirmed && !document.getElementById("seriesStart").disabled'), 'draft confirmed'); }
      if (cod) {
        await js("document.getElementById('seriesCodPreset').value='bo7'; document.getElementById('seriesCodPreset').dispatchEvent(new Event('change',{bubbles:true})); document.getElementById('seriesSaveCod').click()");
        await until(() => js("state.series.config.title==='Black Ops 7' && !document.getElementById('seriesStart').disabled"), 'title and season');
      }
      await js("document.getElementById('seriesStart').click()");
      await until(() => js("state.series.maps[state.series.current].status === 'playing' && !document.getElementById('seriesAwait').disabled"), 'started');
      await js("document.getElementById('seriesAwait').click()");
      await until(() => js("state.series.maps[state.series.current].status === 'awaiting-result' && !document.getElementById('seriesConfirm').disabled"), 'await result');
      await js(`document.getElementById('seriesRoundsA').value='${lol ? '' : ow || mr ? 2 : cod ? 250 : r6 ? 8 : 13}'; document.getElementById('seriesRoundsB').value='${lol ? '' : ow || mr ? 1 : cod ? 190 : r6 ? 7 : 11}'; document.getElementById('seriesConfirm').click()`);
      await until(() => js("state.scoreboard.scoreA===1 && !document.getElementById('seriesNext').disabled"), 'confirmed');
      await js("document.getElementById('seriesNext').click()");
      await until(() => js("state.series.current===1 && !document.getElementById('seriesMapName').disabled"), 'advanced');
      await edit('seriesMapName', secondMap);
      if (lol) await edit('seriesBlue', 'A');
      if (ow) {
        assert.equal(await js("document.getElementById('seriesMode').value"), 'Hybrid');
        assert.equal(await js("document.getElementById('seriesPayload').hidden"), false);
        await js("document.getElementById('seriesStart').click()");
        await until(() => js("state.series.maps[1].status==='playing' && !document.getElementById('seriesConfirm').disabled"), 'Hybrid started');
        await js("document.getElementById('seriesWinner').value='draw'; document.getElementById('seriesDetailA').value='3 checkpoints, 0:00'; document.getElementById('seriesDetailB').value='3 checkpoints, 0:00'; document.getElementById('seriesConfirm').click()");
        await until(() => js("state.series.maps[1].result?.type==='draw' && !document.getElementById('seriesNext').disabled"), 'Hybrid draw');
        await js("document.getElementById('seriesNext').click()");
        await until(() => js("state.series.current===2 && !document.getElementById('seriesStart').disabled"), 'Push next');
        await edit('seriesMapName', 'Esperanca'); await edit('seriesBanA', 'Mei'); await edit('seriesBanB', 'Tracer');
        assert.equal(await js("document.getElementById('seriesRoundsA').step"), '0.01');
        assert.equal(await js("document.getElementById('seriesAttackerField').hidden"), true);
      }
      await js("document.getElementById('seriesStart').click()");
      await until(() => js("state.series.maps[state.series.current].status==='playing' && !document.getElementById('seriesTac').disabled"), 'second map');
      await js("document.getElementById('seriesTac').click()");
      await until(() => js("state.series.maps[state.series.current].status==='paused' && !document.getElementById('seriesResume').disabled"), 'timeout');
      await js("document.getElementById('seriesShowHistory').checked=true; document.getElementById('seriesShowHistory').dispatchEvent(new Event('change',{bubbles:true}))");
      await until(() => js("state.series.showHistory && !document.getElementById('seriesResume').disabled"), 'history');
      assert.equal(await js("document.getElementById('seriesError').textContent"), '');
      await overlay.loadURL(base + '/overlay?view=scoreboard');
      await until(() => overlay.webContents.executeJavaScript("!!document.querySelector('.val-board') && document.querySelector('.val-context').textContent.includes('tactical')"), 'overlay');
      await overlay.webContents.executeJavaScript('document.fonts.ready');
      // A neutral review background helps inspect the transparent browser source.
      await overlay.webContents.executeJavaScript("document.body.style.background='#253143'");
      await screenshot(overlay, id + '-' + game);
      await screenshot(panel, id + '-' + game + '-controls');
      const audit = await overlay.webContents.executeJavaScript(`(() => {
        const box=document.querySelector('.val-board').getBoundingClientRect();
        return {box:{x:box.x,y:box.y,w:box.width,h:box.height},oldBoardVisible:[...document.querySelectorAll('#sb,#sbc')].some(e=>getComputedStyle(e).display!=='none'),text:document.querySelector('.val-board').textContent};
      })()`);
      assert(!audit.oldBoardVisible); assert(audit.box.x >= 0 && audit.box.y >= 0 && audit.box.x + audit.box.w <= 1920 && audit.box.y + audit.box.h <= 1080);
      assert(audit.box.y > 500, 'companion starts in bottom corner for ' + id);
      assert(audit.text.includes(lol ? 'GAMES' : 'MAPS')); assert(audit.text.includes(firstMap)); assert(audit.text.includes(secondMap));
      if (ow) { assert(audit.text.includes('DRAW')); assert(audit.text.includes('Push')); assert(audit.text.toUpperCase().includes('MEI')); }
      if (mr) { assert(audit.text.includes('Domination')); assert(audit.text.includes('Convoy')); }
      if (lol) { assert(audit.text.includes('GAMES')); assert(audit.text.includes('BLUE SIDE')); }
      if (cod) { assert(audit.text.includes('Black Ops 7')); assert(audit.text.includes('Search and Destroy')); }
      panel.setContentSize(390, 1000); await wait(100); await screenshot(panel, id + '-' + game + '-controls-narrow');
      assert.equal(await js('document.documentElement.scrollWidth <= innerWidth + 2'), true, id + ' narrow panel overflow');
      {
        await js("document.getElementById('seriesHistory').parentElement.open=true; document.getElementById('seriesHistory').scrollIntoView({block:'center'})");
        await wait(100); assert.equal(await js('document.documentElement.scrollWidth <= innerWidth + 2'), true, id + ' narrow schedule overflow');
        await screenshot(panel, id + '-' + game + '-schedule-narrow');
      }
      if (ow) {
        const act = async (action, data = {}) => assert.equal(await js(`window.seriesPanel.command(${JSON.stringify(action)},${JSON.stringify(data)})`), true, action);
        await act('finish', { winner: 'B', scoreA: 80.12, scoreB: 123.45 });
        await act('next'); await act('start'); await act('finish', { winner: 'A', scoreA: 3, scoreB: 2 });
        await act('next'); await act('sides', { leftTeam: 'B', attackingTeam: 'B' }); await act('start'); await act('finish', { winner: 'B', detailA: '2 checkpoints + 52m', detailB: '3 checkpoints' });
        await act('next'); await edit('seriesMapName', 'Nepal');
        assert.equal(await js('state.series.attackingTeam'), '', 'new map clears old attack assignment');
        await until(() => overlay.webContents.executeJavaScript("document.querySelector('.ow-mode').textContent.includes('TIEBREAKER')"), 'tiebreaker board');
        assert.equal(await overlay.webContents.executeJavaScript("document.querySelector('.ow-bans') === null"), true, 'old bans cleared');
        await screenshot(overlay, id + '-ow-tiebreaker');
      }
      overlay.setContentSize(1280, 720); await wait(100); await screenshot(overlay, id + '-' + game + '-720');
      report.push({ id, game, ...audit });
      // Exercise actual saved-match controls. Setup survives; results and draft
      // from a played game are never silently imported into a new match.
      const saved = await js('matchData()');
      assert(saved.seriesSetup); assert(!JSON.stringify(saved.seriesSetup).includes('"result":'));
      await js("document.getElementById('matchNameInput').value='Scoreboard review fixture'; document.getElementById('matchSaveBtn').click()");
      await until(() => js("library.matches.some(m=>m.name==='Scoreboard review fixture')"), 'match saved');
      await js("window.confirm=()=>true; document.getElementById('matchSelect').value=library.matches.find(m=>m.name==='Scoreboard review fixture').id; document.getElementById('matchLoadBtn').click()");
      await until(() => js("state.scoreboard.scoreA===0 && state.series.maps[0].name===" + JSON.stringify(firstMap) + " && !document.getElementById('seriesUndo').disabled"), 'saved match setup restored');
      if (cod) assert.equal(await js('state.series.config.title'), 'Black Ops 7');
      await until(() => overlay.webContents.executeJavaScript("!document.querySelector('.val-history')"), 'compact gameplay board');
      const compact = await overlay.webContents.executeJavaScript("document.querySelector('.val-board').getBoundingClientRect().width");
      assert(Math.abs(compact - 560 * 2 / 3) < 2, 'compact board remains 560px at 1080p');
      await screenshot(overlay, id + '-' + game + '-compact-720');
      if (cod) {
        assert(await js("window.seriesPanel.command('configure',{bestOf:7})"));
        assert(await js("window.seriesPanel.command('presentation',{showHistory:true,scale:1.5,offsetX:800})"));
        await until(() => overlay.webContents.executeJavaScript("document.querySelectorAll('.val-map').length===7"), 'BO7 break schedule');
        assert(await overlay.webContents.executeJavaScript("(()=>{const b=document.querySelector('.val-board').getBoundingClientRect();return b.x>=-1&&b.right<=innerWidth+1&&b.y>=0&&b.bottom<=innerHeight+1})()"), 'scaled/inset break board stays inside canvas');
        await screenshot(overlay, id + '-cod-bo7-720');
      }
      panel.destroy(); overlay.destroy(); panel = overlay = null;
      socket.close(); await once(socket, 'close'); socket = null;
      await new Promise((r) => server.close(r)); server = null;
      console.log(id + ': panel workflow and 1080p/720p render passed');
    }
    assert.deepEqual(errors, [], 'Browser errors');
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ report, errors }, null, 2));
    console.log('Screenshots: ' + output);
    app.exit(0);
  } catch (error) {
    console.error(error); fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: error.stack, errors }, null, 2)); app.exit(1);
  }
});
