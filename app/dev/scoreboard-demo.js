// Disposable companion-board demo. No automatic OBS connection, local camera defaults,
// game data, league fetches, or media downloads. Exit discards this run's data.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const id = process.argv[2] || 'widener';
const game = process.argv[3] || 'val', ow = game === 'ow', lol = game === 'lol', cod = game === 'cod', mr = game === 'mr', r6 = game === 'r6';
const ports = { val: 4396, ow: 4391, mr: 4392, lol: 4393, r6: 4394, cod: 4395 };
if (!ports[game]) throw new Error('Choose val, ow, mr, lol, r6 or cod.');
const port = ports[game];
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scoreboard-demo-' + id + '-'));
Object.assign(process.env, { STREAM_NO_LOCAL: '1', STREAM_APP_DATA: dataDir, STREAM_DATA_DIR: dataDir, WIDENER_RL_PORT: '49339' });
const { loadProfile } = require('../profile');
const { createSeries, changeSeries } = require('../series');
const profile = loadProfile(id);
profile.music = null; profile.leagueScenes = [];
profile.broadcast.follow = { links: [], scope: 'all' };
profile.games = profile.games.map((g) => ({ ...g, montage: undefined }));
if (!profile.games.some((g) => g.id === game)) throw new Error(`${id} does not support ${game}.`);
let series = createSeries(game);
const act = (action, data = {}) => { series = changeSeries(series, { action, seriesId: series.id, revision: series.revision, ...data }); };
if (cod) act('configure', { bestOf: 5, preset: 'bo7' });
act('map', { mapId: series.maps[0].id, name: ow ? 'Lijiang Tower' : mr ? 'Wakanda' : lol ? "Summoner's Rift" : r6 ? 'Bank' : cod ? 'Organizer map A' : 'Ascent', ...(lol ? { blueTeam: 'A' } : {}) });
act('start'); act('finish', { winner: 'A', ...(lol ? {} : { scoreA: ow || mr ? 2 : r6 ? 8 : cod ? 250 : 13, scoreB: ow || mr ? 1 : r6 ? 7 : cod ? 190 : 11 }) }); act('next');
act('map', { mapId: series.maps[1].id, name: ow ? 'Kings Row' : mr ? 'Tokyo 2099' : lol ? "Summoner's Rift" : r6 ? 'Chalet' : cod ? 'Organizer map B' : 'Haven', ...(lol ? { blueTeam: 'B' } : {}) });
if (ow) {
  act('start'); act('finish', { resultType: 'draw', detailA: '3 checkpoints, 0:00', detailB: '3 checkpoints, 0:00' }); act('next');
  act('map', { mapId: series.maps[2].id, name: 'Esperanca', banA: 'Mei', banB: 'Tracer' });
}
act('presentation', { showHistory: true });
const state = { mode: 'scoreboard', game, team: profile.games.find((g) => g.id === game).name, montage: false, series,
  teamA: { name: profile.name, tag: id === 'widener' ? 'WU' : id === 'messiah' ? 'MU' : 'LOTE', color: profile.colors.teamA || '#0054b8', logoUrl: '/brand/' + profile.assets.logo, players: [] },
  teamB: { name: 'Opponent University', tag: 'OPP', color: '#b54a64', players: [] },
  scoreboard: profile.games.find((g) => g.id === game).scoreboard };
fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({ live: state }));
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ music: { enabled: false }, panel: { setupDone: true, guideV2: true } }));
fs.writeFileSync(path.join(dataDir, 'broadcast.json'), JSON.stringify({ v: 1, defaultsDone: true }));
require('../server').createServer(port, { profile, dataDir, host: '127.0.0.1' });
console.log(`Control: http://127.0.0.1:${port}/control?page=live`);
console.log(`Preview: http://127.0.0.1:${port}/overlay?view=scoreboard&backdrop=1`);
console.log('Disposable data: ' + dataDir);
