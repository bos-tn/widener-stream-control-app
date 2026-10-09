// Demo data for reviewing the broadcast package's designs without a real
// match, OBS or the game (test branch). Dev only: dev/ is not in the
// installer, and server.js loads this file only when STREAM_DEMO=1.
//
// seed(dataDir) fills an empty data folder with a match, a team library, a
// finished Rocket League series and a week of other matches. attach(hooks)
// adds POST /api/dev/demo/<preset>, which swaps the match on stream between
// three games so every scoreboard layout can be looked at.

const fs = require('fs');
const path = require('path');

// School logos already in the repo (the League of the East profile's),
// reached through the app's /media route by absolute path.
const LOGOS = path.join(__dirname, '..', 'profiles', 'lote', 'assets', 'teams');
const logo = (file) => path.join(LOGOS, file);

function team(name, tag, color, colorAlt, file, players) {
  return { name, tag, color, colorAlt, logoUrl: logo(file), players: (players || []).map(([gamertag, real]) => ({ gamertag, name: real || '' })) };
}

const WIDENER = (players) => team('Widener University', 'WU', '#0054B8', '#F0B310', 'widener.png', players);
const TEAMS = {
  rowan: (players) => team('Rowan University', 'RU', '#57150B', '#FFCC00', 'rowan.png', players),
  arcadia: (players) => team('Arcadia University', 'ARC', '#B20837', '#757575', 'arcadia.png', players),
  hood: (players) => team('Hood College', 'HC', '#015596', '#8A8D8F', 'hood.png', players),
};

const ROSTERS = {
  rl: {
    a: [['Vanta', 'Jordan Reyes'], ['Kestrel', 'Sam Whitlock'], ['Mako', 'Dev Okafor']],
    b: [['Brix', 'Alex Tran'], ['Nyx', 'Riley Shah'], ['Tundra', 'Chris Medina']],
  },
  val: {
    a: [['Vanta', 'Jordan Reyes'], ['Kestrel', 'Sam Whitlock'], ['Mako', 'Dev Okafor'], ['Sable', 'Taylor Quinn'], ['Juno', 'Morgan Ellis']],
    b: [['Onyx', 'Casey Bauer'], ['Rook', 'Jamie Soto'], ['Fable', 'Drew Lindqvist'], ['Halo', 'Avery Park'], ['Pike', 'Robin Castell']],
  },
  smash: {
    a: [['Vanta', 'Jordan Reyes'], ['Kestrel', 'Sam Whitlock'], ['Mako', 'Dev Okafor'], ['Sable', 'Taylor Quinn']],
    b: [['Ember', 'Quinn Ashby'], ['Lark', 'Skyler Dunn'], ['Moss', 'Reese Calder'], ['Vex', 'Harper Lowe']],
  },
};

// The match on stream, per preset. `scoreboard` carries the counters too:
// the demo wants a series part-way through.
const PRESETS = {
  rl: () => ({
    game: 'rl', team: 'Rocket League',
    teamA: WIDENER(ROSTERS.rl.a), teamB: TEAMS.rowan(ROSTERS.rl.b),
    scoreboard: { round: 'Week 3', unit: 'Game', bestOf: 7, position: 'top', style: 'rl', showStocks: false, scoreA: 3, scoreB: 1, lostA: 0, lostB: 0, swap: false },
    views: { 'starting-soon': { title: 'Stream Starting Soon', subtitle: '', status: 'Starting Soon' } },
    next: 'Next: Friday 7 PM vs Arcadia',
  }),
  val: () => ({
    game: 'val', team: 'VALORANT',
    teamA: WIDENER(ROSTERS.val.a), teamB: TEAMS.arcadia(ROSTERS.val.b),
    scoreboard: { round: 'Quarterfinal', unit: 'Map', bestOf: 3, position: 'top-left', style: 'standard', showStocks: false, scoreA: 1, scoreB: 1, lostA: 0, lostB: 0, swap: false },
    views: { 'starting-soon': { title: 'Stream Starting Soon', subtitle: '', status: 'Starting Soon' } },
    next: 'Next: Monday 8 PM vs Rowan',
  }),
  smash: () => ({
    game: 'smash', team: 'Super Smash Bros. Ultimate',
    teamA: WIDENER(ROSTERS.smash.a), teamB: TEAMS.hood(ROSTERS.smash.b),
    scoreboard: { round: 'Crew Battle', unit: 'Set', bestOf: 3, position: 'top', style: 'standard', showStocks: true, crewSize: 4, stocksEach: 3, scoreA: 1, scoreB: 0, lostA: 4, lostB: 7, swap: false },
    views: { 'starting-soon': { title: 'Stream Starting Soon', subtitle: '', status: 'Starting Soon' } },
    next: 'Next: Wednesday 8 PM vs Hood',
  }),
  // The awkward cases, for checking that nothing overflows: long names, one
  // team with no logo, no short names, a long headline, seven players a side.
  long: () => ({
    game: 'ow', team: 'Overwatch',
    teamA: { ...team('Stevens Institute of Technology', '', '#A32638', '', 'stevens.png', [['Wintermute', 'Alexandria Montgomery'], ['Kestrel', 'Sam Whitlock'], ['Mako', 'Dev Okafor'], ['Sable', 'Taylor Quinn'], ['Juno', 'Morgan Ellis'], ['Quillon', 'Bartholomew Fitzgerald'], ['Io', 'Kai Lee']]) },
    teamB: { ...team('York College of Pennsylvania', '', '', '', 'york.png', [['Onyx', 'Casey Bauer'], ['Rook', 'Jamie Soto'], ['Fable', 'Drew Lindqvist'], ['Halo', 'Avery Park'], ['Pike', 'Robin Castell'], ['xX_Shadowstrike_Xx', ''], ['Bo', 'Bo Chen']]), logoUrl: '' },
    scoreboard: { round: 'Conference Semifinal', unit: 'Map', bestOf: 5, position: 'top-right', style: 'standard', showStocks: false, scoreA: 3, scoreB: 2, lostA: 0, lostB: 0, swap: false },
    views: { 'starting-soon': { title: 'Widener Esports Invitational Grand Final Starts Soon', subtitle: 'Presented by the Widener University Esports Program', status: 'Championship Sunday' } },
    next: 'Next: Saturday 12 PM, Conference Final, best of seven',
  }),
  // A fresh install: no teams, no rosters, default text.
  blank: () => ({
    game: '', team: '',
    teamA: { name: '', tag: '', color: '', colorAlt: '', logoUrl: '', players: [] }, teamB: { name: '', tag: '', color: '', colorAlt: '', logoUrl: '', players: [] },
    scoreboard: { round: '', unit: 'Game', bestOf: 3, position: 'top', style: 'standard', showStocks: false, scoreA: 0, scoreB: 0, lostA: 0, lostB: 0, swap: false },
    views: { 'starting-soon': { title: 'Stream Starting Soon', subtitle: '', status: 'Starting Soon' } },
    next: '',
  }),
};

// A finished-looking Rocket League series (4 games, 3-1) for the stats
// screens and the Post-Match result.
function rlSeries() {
  const line = (name, t, score, goals, assists, shots, saves, demos) => ({ name, team: t, score, goals, assists, shots, saves, demos });
  const game = (goals, winner, overtime, arena, rows) => ({ at: new Date().toISOString(), blue: 'A', winner, goals, arena, overtime, players: rows });
  return {
    games: [
      game([3, 2], 0, true, 'Stadium_P', [
        line('Vanta', 0, 612, 2, 0, 4, 2, 1), line('Kestrel', 0, 388, 1, 1, 2, 1, 0), line('Mako', 0, 274, 0, 2, 1, 3, 0),
        line('Brix', 1, 430, 1, 1, 3, 2, 1), line('Nyx', 1, 356, 1, 0, 2, 1, 0), line('Tundra', 1, 198, 0, 1, 1, 2, 0)]),
      game([1, 4], 1, false, 'EuroStadium_Night_P', [
        line('Vanta', 0, 240, 1, 0, 2, 1, 0), line('Kestrel', 0, 205, 0, 1, 2, 2, 0), line('Mako', 0, 162, 0, 0, 1, 1, 1),
        line('Brix', 1, 655, 2, 1, 4, 1, 0), line('Nyx', 1, 498, 1, 2, 3, 2, 1), line('Tundra', 1, 410, 1, 1, 2, 1, 0)]),
      game([2, 0], 0, false, 'UtopiaStadium_P', [
        line('Vanta', 0, 420, 1, 1, 3, 2, 0), line('Kestrel', 0, 505, 1, 0, 2, 4, 1), line('Mako', 0, 300, 0, 1, 1, 2, 0),
        line('Brix', 1, 220, 0, 0, 3, 1, 0), line('Nyx', 1, 185, 0, 0, 2, 2, 0), line('Tundra', 1, 140, 0, 0, 1, 1, 1)]),
      game([5, 3], 0, false, 'cs_p', [
        line('Vanta', 0, 780, 3, 1, 5, 1, 1), line('Kestrel', 0, 455, 1, 2, 3, 2, 0), line('Mako', 0, 390, 1, 1, 2, 2, 0),
        line('Brix', 1, 520, 2, 0, 4, 1, 0), line('Nyx', 1, 340, 1, 1, 2, 1, 0), line('Tundra', 1, 260, 0, 2, 1, 2, 1)]),
    ],
  };
}

// A week of other matches for the match centre, around today.
function otherMatches() {
  const now = new Date();
  const at = (dayOffset, hour, minute) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute || 0).toISOString();
  const side = (name, tag, color, file, score) => ({ name, tag, color, logo: logo(file), score: score || 0 });
  // Stay inside this week (Monday to Sunday), whatever day the demo runs.
  const dow = (now.getDay() + 6) % 7;
  const back = (n) => -Math.min(n, dow);
  const ahead = (n) => Math.min(n, 6 - dow);
  let n = 0;
  const m = (game, league, round, start, state, a, b, note) => ({ id: `demo${++n}`, src: 'manual', game, league, round, start, state, a, b, note: note || '', updatedAt: now.toISOString() });
  return [
    m('Rocket League', 'LOTE', 'Week 3', at(back(2), 19, 45), 'final', side('Saint Francis University', 'SFU', '#BD1F25', 'saint-francis.png', 4), side('Arcadia University', 'ARC', '#B20837', 'arcadia.png', 0)),
    m('Overwatch', 'LOTE', 'Week 3', at(back(1), 20, 0), 'final', side('Alvernia University', 'AU', '#9E053B', 'alvernia.png', 3), side('Messiah University', 'MU', '#264F91', 'messiah.png', 1)),
    m('VALORANT', 'NECC', 'Week 3', at(0, 19, 0), 'live', side('Widener University', 'WU', '#0054B8', 'widener.png', 1), side('Stevenson University', 'SU', '#006341', 'stevenson.png', 0), 'Map 2'),
    m('Super Smash Bros. Ultimate', 'LOTE', 'Week 3', at(0, 20, 0), 'upcoming', side('Hood College', 'HC', '#015596', 'hood.png'), side('Widener University', 'WU', '#0054B8', 'widener.png')),
    m('Overwatch', 'LOTE', 'Week 3', at(0, 21, 0), 'upcoming', side('Marywood University', 'MU', '#1A5632', 'marywood.png'), side('Lebanon Valley College', 'LVC', '#002B5C', 'lvc.png')),
    m('League of Legends', 'NECC', 'Week 3', at(ahead(1), 19, 0), 'upcoming', side('Widener University', 'WU', '#0054B8', 'widener.png'), side('York College of Pennsylvania', 'YCP', '#00693C', 'york.png')),
    m('Marvel Rivals', 'NECC', 'Week 3', at(ahead(2), 20, 30), 'upcoming', side('Stevens Institute of Technology', 'SIT', '#A32638', 'stevens.png'), side('Widener University', 'WU', '#0054B8', 'widener.png')),
    m('Rocket League', 'LOTE', 'Week 3', at(ahead(2), 20, 0), 'upcoming', side('DeSales University', 'DSU', '#002D72', 'desales.png'), side('Eastern University', 'EU', '#7A0019', 'eastern.png')),
  ];
}

function write(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

// Fills a data folder that has no state yet. Returns whether it did.
function seed(dataDir) {
  if (fs.existsSync(path.join(dataDir, 'state.json'))) return false;
  const p = PRESETS.rl();
  const state = {
    mode: 'starting-soon', ...p,
    countdownMode: 'duration', durationSec: 600, end: new Date(Date.now() + 600 * 1000).toISOString(),
    montage: true,
  };
  write(path.join(dataDir, 'state.json'), { live: state, draft: state });
  write(path.join(dataDir, 'library.json'), {
    teams: [WIDENER(ROSTERS.rl.a), TEAMS.rowan(ROSTERS.rl.b), TEAMS.arcadia(ROSTERS.val.b), TEAMS.hood(ROSTERS.smash.b)]
      .map((t, i) => ({ id: `demo-team-${i}`, ...t, league: false, updatedAt: new Date().toISOString() })),
    matches: [], seeded: [],
  });
  write(path.join(dataDir, 'rl-series.json'), rlSeries());
  write(path.join(dataDir, 'broadcast.json'), {
    // defaultsDone: the demo keeps to its own matches, without the profile's league feed.
    v: 1, manual: otherMatches(), follows: [], feed: {}, overrides: {}, hidden: [], defaultsDone: true,
    settings: { ticker: { on: true, gameplay: false, cams: true, messages: ['Follow /wideneresports on Twitch', 'Home matches are open to students: Widener Esports Arena'] } },
  });
  // The setup guide has nothing to do in a demo.
  write(path.join(dataDir, 'settings.json'), { panel: { setupDone: true, guideV2: true }, music: { enabled: false } });
  return true;
}

// hooks: { app, setMatch(patch), setSeries(series) }.
function attach(hooks) {
  hooks.app.post('/api/dev/demo/:preset', (req, res) => {
    const make = PRESETS[req.params.preset];
    if (!make) return res.status(400).json({ error: `Unknown preset. Use one of: ${Object.keys(PRESETS).join(', ')}` });
    hooks.setMatch(make());
    hooks.setSeries(req.params.preset === 'rl' ? rlSeries() : { games: [] });
    res.json({ ok: true, preset: req.params.preset });
  });
  hooks.app.get('/api/dev/demo', (req, res) => res.json({ presets: Object.keys(PRESETS) }));
}

module.exports = { seed, attach, PRESETS };
