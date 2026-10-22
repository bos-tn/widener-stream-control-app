const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
process.env.STREAM_NO_LOCAL = '1';
const necc = require('../necc');
const source = require('../league-standings');
const { createStandings, currentWeek, matchGame, matchContext, playoffRule, sourceKey } = require('../standings');
const { loadProfile } = require('../profile');
const ids = { leagueId: 'league00000000001', seasonId: 'season00000000001', stageId: 'stage000000000001' };
const ctx = (host = 'necc.v1.leagueos.gg', stageId = ids.stageId) => ({ ...ids, hostname: host, stageId, gameId: 'rl', leagueName: host.split('.')[0] });
const roster = (name, wins, losses = 0) => ({ name, state: 'confirmed', sourceId: name, stats: { wins, losses, gameWins: wins * 4, gameLosses: losses * 4 } });
const stage = { ...ids, name: 'Northeast B', stdAct: 'rl', format: { method: 0 }, scoringProps: [{ path: 'stats.wins', sortDesc: true }, { path: 'stats.losses', sortDesc: false }], rounds: [{ name: 'Round 4', start: 1792540800, end: 1793145600 }] };
const sample = () => ({ ...source.standingsRows(stage, [roster('Home', 3), roster('Away', 1, 2)]),
  ...ids, activity: 'rl', stageName: stage.name, format: 0, rounds: stage.rounds.map((r) => ({ ...r, start: r.start * 1000, end: r.end * 1000 })) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function unit() {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    const u = new URL(url); calls.push(u.pathname);
    const data = u.pathname.endsWith('/rosters') ? [roster('Beta', 2), roster('Alpha', 2), roster('Last', 0), { ...roster('Unconfirmed', 10), state: 'pending' }]
      : u.pathname.includes('/matches/') ? { ...ids, activityName: 'Rocket League', stdAct: 'rl', leagueName: 'NECC' }
      : stage;
    return { ok: true, json: async () => ({ data }) };
  };
  const table = await source.stageStandings(ctx().hostname, ids.leagueId, ids.stageId);
  assert.deepEqual(table.rows.map((r) => [r.name, r.rank]), [['Alpha', 1], ['Beta', 1], ['Last', 3]]);
  assert.equal(table.rounds[0].start, stage.rounds[0].start * 1000);
  assert.equal(currentWeek(table.rounds, table.rounds[0].start), 'Week 4');
  assert.match(currentWeek(table.rounds, table.rounds[0].end), /complete/);
  assert.match(currentWeek(table.rounds, table.rounds[0].start - 1), /Upcoming/);
  assert.equal(currentWeek([], 1), 'Week unavailable');
  const gap = [{ name: 'Week 1', start: 10, end: 20 }, { name: 'Week 2', start: 30, end: 40 }];
  assert.equal(currentWeek(gap, 25), 'Break · next Week 2');
  // Match payload IDs remain usable even when rosters do not carry contextId.
  const imported = await necc.importMatch('https://necc.v1.leagueos.gg/league/matches/match00000000001');
  assert.equal(matchContext({ ...imported, hostname: ctx().hostname, leagueId: ids.leagueId, seasonId: ids.seasonId, overlayUrls: { stageBracket: `https://overlays.leagueos.gg/o/stageBracket/${ids.leagueId}/${ids.seasonId}/${ids.stageId}/` } }, loadProfile('widener').games).stageId, ids.stageId);
  assert(!calls.some((p) => /seasons.*rosters/.test(p)), 'stage table never fetches season totals');
  global.fetch = originalFetch;
  assert.equal(matchGame({ game: 'Super Smash Bros. Ultimate', activity: 'ssbu' }, loadProfile('lote').games).id, 'smash');

  const shipped = [loadProfile('widener'), loadProfile('lote')];
  const lid = shipped[0].league.id;
  let checked = 0;
  for (const rule of shipped[0].league.playoffs) for (const sid of rule.stageIds) {
    assert.equal(playoffRule(shipped, lid, rule.seasonId, sid, 'rl', 0)?.spots, 4);
    assert.equal(playoffRule(shipped, lid, rule.seasonId, sid, 'valorant', 0), null);
    assert.equal(playoffRule(shipped, lid, rule.seasonId, sid, 'rl', 1), null);
    checked++;
  }
  assert.equal(checked, 56, 'all listed Fall 2026 NECC Rocket League groups have the supplied top-four rule');
  const rule = shipped[0].league.playoffs[0];
  assert.equal(playoffRule(shipped, shipped[1].league.id, rule.seasonId, rule.stageIds[0], 'rl', 0), null);
  assert.equal(playoffRule(shipped, lid, 'futureseason00001', rule.stageIds[0], 'rl', 0), null);
  assert.equal(playoffRule(shipped, lid, rule.seasonId, 'unknownstage0001', 'rl', 0), null);
  const existing = { hostname: 'necc.v1.leagueos.gg', leagueId: lid, seasonId: rule.seasonId, stageId: rule.stageIds[0], gameId: 'rl' };
  const cached = createStandings({ profile: shipped[0], profiles: shipped, read: () => ({ v: 3, tables: {
    [sourceKey(existing)]: { ...sample(), seasonId: existing.seasonId, stageId: existing.stageId, playoffs: null },
  } }), write() {}, getState: () => ({ game: 'rl', leagueMatch: existing }), publish() {}, cacheRow: async (r) => r });
  assert.equal(cached.snapshot().standings.rl.playoffs?.spots, 4, 'cached tables receive the new cutoff without a network refresh');

  let state = { game: 'rl', leagueMatch: ctx() }, saved, fail = false, release;
  const profile = loadProfile('widener'), lote = loadProfile('lote');
  const fakeLeague = { ...profile, league: { ...profile.league, id: ids.leagueId,
    playoffs: [{ seasonId: ids.seasonId, stageId: ids.stageId, spots: 1, source: 'https://example.org/fixture-rules' }] } };
  source.stageStandings = async (host, lid, sid) => {
    if (fail) throw Error('offline');
    if (release) await new Promise((r) => { release.done = r; });
    return { ...sample(), seasonId: ids.seasonId, stageId: sid, rows: [{ ...sample().rows[0], name: host }] };
  };
  const options = { profile, profiles: [fakeLeague, lote], read: () => saved, write: (v) => { saved = structuredClone(v); }, getState: () => state, publish() {}, cacheRow: async (r) => r };
  let store = createStandings(options);
  await store.refresh('rl');
  assert.equal(store.snapshot().standings.rl.playoffs.spots, 1);
  state.leagueMatch = ctx('lote.v1.leagueos.gg', 'stage000000000002');
  assert.equal(store.snapshot().standings.rl.rows.length, 0, 'switching league hides the other league immediately');
  await store.refresh('rl');
  assert.equal(store.snapshot().standings.rl.rows[0].name, 'lote.v1.leagueos.gg');
  assert.equal(store.snapshot().standings.rl.playoffs, null, 'rules do not cross stage boundaries');
  fail = true; await store.refresh('rl', true);
  assert.equal(store.snapshot().standings.rl.rows[0].name, 'lote.v1.leagueos.gg');
  assert.match(store.snapshot().standings.rl.error, /offline/);
  store = createStandings(options);
  assert.equal(store.snapshot().standings.rl.rows.length, 1, 'same-group cache survives restart');
  fail = false; release = {};
  state.leagueMatch = ctx('necc.v1.leagueos.gg', 'stage000000000003');
  const pending = store.refresh('rl', true);
  await wait(0);
  state.leagueMatch = ctx('lote.v1.leagueos.gg', 'stage000000000002');
  release.done(); await pending; release = null;
  assert.equal(store.snapshot().standings.rl.rows[0].name, 'lote.v1.leagueos.gg', 'late response cannot replace selected league');
  console.log('Standings API, ranking, week boundaries, cache isolation, offline and race checks passed.');
}

async function serverTest(id) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'standings-test-'));
  Object.assign(process.env, { STREAM_APP_DATA: dataDir, STREAM_DATA_DIR: dataDir, WIDENER_RL_PORT: '49563' });
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ music: { enabled: false }, panel: { leagueScenes: [], setupDone: true } }));
  fs.writeFileSync(path.join(dataDir, 'broadcast.json'), JSON.stringify({ v: 1, defaultsDone: true, defaultsVersion: 2 }));
  source.listSeasons = async () => [];
  source.stageStandings = async (host, lid, sid) => ({ ...sample(), stageId: sid });
  necc.importMatch = async () => ({ hostname: ctx().hostname, leagueId: ids.leagueId, seasonId: ids.seasonId,
    activity: 'ssbu', game: 'Super Smash Bros. Ultimate', teams: [], overlayUrls: { stageBracket: `https://overlays.leagueos.gg/o/stageBracket/${ids.leagueId}/${ids.seasonId}/${ids.stageId}/` } });
  const { createMockObs } = require('./mock-obs');
  const { createServer } = require('../server');
  const WebSocket = require('ws');
  const profile = loadProfile(id), port = 4390, obsPort = 4490;
  profile.games = profile.games.map((g) => ({ ...g, montage: null }));
  const mock = createMockObs(obsPort), server = createServer(port, { profile, dataDir, host: '127.0.0.1' });
  if (!server.listening) await once(server, 'listening');
  const post = async (url, data) => fetch(`http://127.0.0.1:${port}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) }).then((r) => r.json());
  const imported = await post('/api/necc/import', { url: 'https://necc.v1.leagueos.gg/league/matches/match00000000001' });
  assert.equal(imported.standings.gameId, 'smash', 'import activity matches each profile game alias');
  assert.equal(imported.standings.stageId, ids.stageId);
  const panel = new WebSocket(`ws://127.0.0.1:${port}/ws`); await once(panel, 'open'); panel.send(JSON.stringify({ type: 'subscribe', role: 'panel' }));
  let snapshot;
  panel.on('message', (raw) => { const m = JSON.parse(raw); if (m.type === 'league') snapshot = m.league; });
  panel.send(JSON.stringify({ type: 'update', data: { game: 'rl', montage: false, leagueMatch: ctx(), team: 'Rocket League' } }));
  for (let i = 0; i < 100 && !snapshot?.standings.rl?.updatedAt; i++) await wait(20);
  assert.equal(snapshot.standings.rl.stageId, ids.stageId);
  await post('/api/obs/connect', { host: '127.0.0.1', port: obsPort, password: '' });
  assert(!(await post('/api/obs/build-scenes')).error);
  const name = profile.obs.prefix + ': Standings';
  assert(mock.sceneNames().includes(name), 'existing installation gains default standings');
  const order = mock.sceneNames();
  assert(order.indexOf(name) > order.indexOf(profile.obs.prefix + ': Rosters'));
  assert(order.indexOf(name) < order.indexOf(profile.obs.prefix + ': Gameplay/Scoreboard'));
  assert.equal(mock.items(name).filter((i) => i.sourceName === profile.obs.prefix + '-src-standings').length, 1);
  await post('/api/obs/build-scenes');
  assert.equal(mock.sceneNames().filter((n) => n === name).length, 1, 'rebuild is idempotent');
  // Loading another saved match for the SAME game refreshes its stage too.
  panel.send(JSON.stringify({ type: 'update', data: { leagueMatch: ctx('lote.v1.leagueos.gg', 'stage000000000002') } }));
  for (let i = 0; i < 100 && snapshot?.standings.rl?.stageId !== 'stage000000000002'; i++) await wait(20);
  assert.equal(snapshot.standings.rl.stageId, 'stage000000000002');
  let latestState;
  panel.on('message', (raw) => { const m = JSON.parse(raw); if (m.type === 'state') latestState = m.data; });
  panel.send(JSON.stringify({ type: 'update', data: { game: 'val', neccUrls: { stageBracket: `https://overlays.leagueos.gg/o/stageBracket/${ids.leagueId}/${ids.seasonId}/${ids.stageId}/` } } }));
  for (let i = 0; i < 100 && latestState?.game !== 'val'; i++) await wait(10);
  panel.send(JSON.stringify({ type: 'update', data: { game: 'rl' } }));
  for (let i = 0; i < 100 && latestState?.game !== 'rl'; i++) await wait(10);
  assert.equal(latestState.leagueMatch, null);
  assert.deepEqual(latestState.neccUrls, {}, 'manual game change clears the previous match graphics and source');
  await post('/api/prefs', { leagueScenes: [] }); await post('/api/prefs', { gameCapture: false });
  await post('/api/obs/build-scenes');
  assert(!mock.sceneNames().includes(name), 'deliberate opt-out survives other settings saves');
  panel.terminate(); await mock.close(); await new Promise((r) => server.close(r));
  console.log(id + ': mock OBS scene build, migration, same-game source switch and opt-out passed.');
}

(async () => {
  if (process.argv[2] === '--server') await serverTest(process.argv[3]);
  else {
    await unit();
    for (const id of ['widener', 'lote', 'messiah']) {
      const r = spawnSync(process.execPath, [__filename, '--server', id], { encoding: 'utf8', timeout: 60000 });
      process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || ''); assert.equal(r.status, 0, id);
    }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
