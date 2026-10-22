// Default-feed migration and two-league checks; no runtime files or network.
const assert = require('node:assert/strict');
process.env.STREAM_NO_LOCAL = '1';
const { loadProfile } = require('../profile');
const necc = require('../necc');
const hosts = ['necc.v1.leagueos.gg', 'lote.v1.leagueos.gg'];
let failHost = '';
const resolved = [];
const school = { id: 'c8tx1jcxhv89exuf7rdux1y43', name: 'Messiah University', teamId: '' };
const season = (host) => ({ id: host.split('.')[0] + 'season000000000', name: 'Rocket League', activity: 'rl' });
necc.resolveLeagueLink = async (url) => {
  const host = new URL(url).hostname;
  resolved.push(host);
  if (host === failHost) throw new Error('League temporarily unavailable');
  assert(hosts.includes(host));
  assert.equal(new URL(url).pathname, `/league/groups/${school.id}/calendar`);
  return { hostname: host, leagueId: host.split('.')[0] + 'league000000000', seasons: [season(host)], school };
};
necc.schoolSeasons = async (host) => ({ school, teams: [], seasons: [season(host)] });
necc.seasonMatches = async (host) => {
  const team = (name, org = name) => ({ name, org, tag: '', color: '', logoUrl: '' });
  const match = (id, start, a, b) => ({ id: host + id, start, state: 'scheduled',
    teams: [a, b], wins: [0, 0], link: `https://${host}/league/matches/${id}` });
  return { matches: [
    match('home', week.from + 12 * 3600000, team('Messiah University Blue'), team('Rowan University')),
    match('org', week.from + 24 * 3600000, team('Falcons Black', 'Messiah University'), team('York College')),
    match('away', week.from + 24 * 3600000, team('Hood College'), team('Rowan University')),
    match('previous', week.from - 1, team('Messiah University'), team('York College')),
    match('next', week.to, team('Messiah University'), team('York College')),
  ] };
};
const { createBroadcast, weekOf } = require('../broadcast');
const week = weekOf(Date.now());
function make(seed = {}, profile = loadProfile('messiah')) {
  let saved = structuredClone(seed);
  const bx = createBroadcast({ profile, dataDir: 'unused',
    readJson: () => structuredClone(saved), writeJson: (_, value) => { saved = structuredClone(value); },
    sendAll() {}, cacheLogo: async (url) => url, getState: () => ({}), obs: {},
  });
  return { bx, saved: () => structuredClone(saved) };
}
async function settled(test, expected) {
  for (let i = 0; i < 100; i++) {
    if (test.bx.snapshot().follows.length === expected && test.saved().defaultsDone) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail('Default feed did not settle');
}
(async () => {
  for (const seed of [{}, { v: 1, defaultsDone: true }, { v: 1, defaultsDone: true, defaultsVersion: 1 }]) {
    const test = make(seed);
    test.bx.start();
    await settled(test, 2);
    const snap = await test.bx.refresh();
    assert.deepEqual(snap.schools.map((s) => s.host).sort(), hosts.slice().sort());
    assert.deepEqual(snap.follows.map((s) => s.league).sort(), ['LOTE', 'NECC']);
    assert.equal(snap.settings.scope, 'home');
    assert.equal(snap.matches.length, 4, 'only home matches within the current week from both leagues');
    assert(snap.matches.every((m) => m.home && m.game === 'Rocket League'));
    assert(snap.follows.every((f) => !f.error));
    test.bx.clearFollows();
    const restart = make(test.saved());
    const calls = resolved.length;
    restart.bx.start();
    assert.equal(resolved.length, calls, 'a deliberate clear stays cleared after restart');
    assert.equal(restart.bx.snapshot().follows.length, 0);
  }
  const imported = { id: 'customfeed', host: hosts[0],
    leagueId: 'customleague', seasonId: 'customseason', name: 'Custom', game: 'Rocket League' };
  const custom = make({ defaultsDone: true, defaultsVersion: 1, follows: [imported],
    settings: { scope: 'all' }, camLinks: { player1: 'http://127.0.0.1:8889/player1/' } });
  custom.bx.upsertManual({ game: 'Rocket League', a: { name: 'Manual A' }, b: { name: 'Manual B' } });
  custom.bx.start();
  await settled(custom, 3);
  assert.equal(custom.bx.snapshot().follows[0].name, 'Custom');
  assert.equal(custom.bx.snapshot().schools.length, 2, 'defaults are added alongside an imported season');
  assert.equal(custom.bx.snapshot().settings.scope, 'all');
  assert.equal(custom.saved().camLinks.player1, 'http://127.0.0.1:8889/player1/');
  const unchanged = make(custom.saved());
  const calls = resolved.length;
  unchanged.bx.start();
  assert.equal(resolved.length, calls, 'completed migration is not repeated on restart');
  await custom.bx.refresh();
  const before = custom.saved();
  failHost = hosts[1];
  assert((await custom.bx.followDefault()).error);
  assert.deepEqual(custom.saved(), before, 'failure of second league preserves follows, scores and manual rows');
  const offline = make({ defaultsDone: true });
  offline.bx.start();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(offline.bx.snapshot().follows.length, 0, 'failed setup never seeds just one league');
  failHost = '';
  const retry = make(offline.saved());
  retry.bx.start();
  await settled(retry, 2);
  const partial = retry.saved();
  partial.defaultsVersion = 1;
  partial.schools = partial.schools.filter((s) => s.host === hosts[0]);
  partial.follows = partial.follows.filter((f) => f.host === hosts[0]);
  const repair = make(partial);
  repair.bx.start();
  await settled(repair, 2);
  assert.equal(repair.bx.snapshot().schools.length, 2, 'an existing NECC follow also gains LotE');
  failHost = hosts[1];
  const pending = make({ defaultsDone: true, defaultsVersion: 1, follows: [imported] });
  pending.bx.start();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(pending.saved().defaultsDone, false, 'an imported season cannot mark failed default setup complete');
  failHost = '';
  const recovered = make(pending.saved());
  recovered.bx.start();
  await settled(recovered, 3);
  assert(!(await custom.bx.followDefault()).error);
  assert.equal(custom.bx.snapshot().schools.length, 2);
  assert(custom.bx.snapshot().matches.some((m) => m.src === 'manual'));
  const widener = make({ defaultsDone: true }, loadProfile('widener'));
  const widenerCalls = resolved.length;
  widener.bx.start();
  assert.equal(resolved.length, widenerCalls, 'existing Widener empty feed stays empty');
  assert.equal(loadProfile('lote').broadcast.enabled, false);
  console.log('League feed: fresh/rc.3/partial/imported feeds, both calendars, home/week filtering, preserved data, clear/restart and failure/retry passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
