// Hidden Electron layout checks; fixtures never touch installed app data or OBS.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const WebSocket = require('ws');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'standings-visual-'));
Object.assign(process.env, { STREAM_NO_LOCAL: '1', STREAM_APP_DATA: root, WIDENER_RL_PORT: '49565' });
app.setPath('userData', path.join(root, 'electron'));
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {});
const source = require('../league-standings');
const { loadProfile } = require('../profile');
const { createServer } = require('../server');
const output = path.resolve(process.argv[2] || path.join(root, 'screenshots'));
const liveFile = process.argv[3];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) { for (let i = 0; i < 300; i++) { if (await fn()) return; await wait(40); } throw Error('Render did not settle'); }
const ids = { necc: ['b1q6j3ea75j6zgk1s4i79dlw7', '65emcmbcbon2rip7m924fxp9s', 'ddooi05r9htev7zv78ggvt1kl'], lote: ['9kx1eizx9o0eq89ga5k4dda2e', 'bz10kiwm95vfrb3iowwefwqys', '65zncjzr9trge0glte87jg6lx'] };
const row = (i) => ({ name: i === 1 ? 'Widener University Gold' : 'Example University Esports Team ' + i, tag: 'T' + i,
  rank: i === 5 ? 4 : i, w: Math.max(0, 8 - i), l: Math.min(i, 8), d: 0, gw: 12, gl: 5, sf: 0, sa: 0, color: '#246ab5', logoUrl: '' });
const synthetic = (league) => ({ seasonId: ids[league][1], stageId: ids[league][2], stageName: 'Regular Season', format: 0,
  activity: 'rl', played: true, scored: false, rounds: [{ name: 'Week 4', start: Date.now() - 3600000, end: Date.now() + 3600000 }], rows: Array.from({ length: 25 }, (_, i) => row(i + 1)) });
app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  const live = liveFile ? JSON.parse(fs.readFileSync(liveFile)) : null;
  const errors = [], report = [];
  try {
    for (const id of ['widener', 'lote', 'messiah']) {
      const league = id === 'lote' ? 'lote' : 'necc', [leagueId, seasonId, stageId] = ids[league];
      const dataDir = path.join(root, id); fs.mkdirSync(dataDir);
      const profile = loadProfile(id); profile.games = profile.games.map((g) => ({ ...g, montage: null }));
      let fixture = live ? live[league] : synthetic(league);
      source.stageStandings = async () => structuredClone(fixture);
      fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ music: { enabled: false }, panel: { setupDone: true, guideV2: true } }));
      fs.writeFileSync(path.join(dataDir, 'broadcast.json'), JSON.stringify({ v: 1, defaultsDone: true, defaultsVersion: 2 }));
      fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ live: { mode: 'standings', game: 'rl', team: 'Rocket League', montage: false,
        teamA: { name: 'Widener University Gold' }, teamB: { name: 'SNHU Blue' }, leagueMatch: { gameId: 'rl', hostname: league + '.v1.leagueos.gg', leagueId, seasonId, stageId, seasonName: league === 'necc' ? 'Rocket League | Division III' : 'Rocket League' } } }));
      const server = createServer(4388, { profile, dataDir, host: '127.0.0.1' });
      if (!server.listening) await once(server, 'listening');
      const win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } });
      win.webContents.on('console-message', (_, level, message) => { if (level >= 3 && !/ERR_FILE_NOT_FOUND|ERR_NAME_NOT_RESOLVED/.test(message)) errors.push(id + ': ' + message); });
      await win.loadURL('http://127.0.0.1:4388/overlay?view=standings&backdrop=1');
      const js = (code) => win.webContents.executeJavaScript(code);
      await until(() => js("document.querySelectorAll('.st-row').length > 0"));
      await js('document.fonts.ready'); await wait(250);
      await until(() => js("!document.body.classList.contains('enter')"));
      for (const [w, h] of [[1920, 1080], [1280, 720]]) {
        win.setContentSize(w, h); await wait(150);
        const measured = await js(`(() => ({ title: document.getElementById('lg-sub').textContent,
          rows: [...document.querySelectorAll('.st-row')].map(e => {const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}),
          names: [...document.querySelectorAll('.st-name')].map(e=>({text:e.textContent,font:getComputedStyle(e).fontSize,color:getComputedStyle(e).color,width:e.clientWidth})),
          footer: document.getElementById('st-source').textContent, playoff: document.querySelectorAll('.st-row.playoff').length,
          width: innerWidth, height: innerHeight }))()`);
        assert(measured.rows.every((r) => r.left >= 0 && r.right <= w + 1 && r.top >= 0 && r.bottom <= h - 50), 'rows fit canvas');
        assert.match(measured.title, /Week/);
        assert.equal(measured.playoff, league === 'necc' ? live ? 4 : 3 : 0, 'NECC Rocket League cutoff applies across profiles; LotE stays unmarked');
        if (league === 'necc') assert.match(await js("document.getElementById('st-legend').textContent"), /Top 4/);
        assert(measured.names.every((n) => n.text && n.width > 30 && parseFloat(n.font) >= 16), 'team names remain readable');
        fs.writeFileSync(path.join(output, `${id}-${h}.png`), (await win.webContents.capturePage()).toPNG());
        report.push({ id, w, h, ...measured });
      }
      if (id === 'widener') {
        // A larger table must rotate through every row, and a cutoff tie must
        // remain unresolved instead of awarding an alphabetical playoff spot.
        fixture = synthetic(league);
        await fetch('http://127.0.0.1:4388/api/league/refresh', { method: 'POST' });
        await until(() => js("document.querySelectorAll('.st-row').length === 20"));
        assert.equal(await js("document.querySelectorAll('.st-row.playoff').length"), 3);
        assert.equal(await js("document.querySelectorAll('.st-row.cutoff-tie').length"), 2);
        await js('stPage++;renderStandings(lastState,standingsFor(lastState))');
        assert.equal(await js("document.querySelectorAll('.st-row').length"), 5);
        assert.match(await js("document.getElementById('st-source').textContent"), /Page 2 \/ 2/);
        fs.writeFileSync(path.join(output, 'pagination-720.png'), (await win.webContents.capturePage()).toPNG());
      }
      win.destroy(); await new Promise((r) => server.close(r));
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log('All profiles rendered at 1080p and 720p; pagination and cutoff tie checks passed. ' + output);
    app.exit(0);
  } catch (e) { console.error(e); app.exit(1); }
});
