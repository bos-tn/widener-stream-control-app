// Fake Rocket League Stats API feed, for working on the Rocket League
// scoreboard without the game. Speaks the same wire format as the real
// exporter: a raw TCP stream of concatenated JSON objects, each
// { Event, Data } with Data as a JSON-encoded string.
//
//   node dev/mock-rlstats.js [port] [--fast]
//
// Then run the app (or `node server.js`) with WIDENER_RL_PORT=<port> if the
// port isn't 49123, and pick Rocket League as the game. --fast runs the clock
// at 10x so a whole game, goal replays and the series win go by in under a
// minute. Not shipped: package.json's build file list leaves dev/ out.

const net = require('net');

const port = Number(process.argv.find((a) => /^\d+$/.test(a))) || 49123;
const fast = process.argv.includes('--fast');
const RATE = 30;
const GAME_SECONDS = 300;

const NAMES = [['Pride Lion', 'Blue Hen', 'Chester'], ['Rival One', 'Rival Two', 'Rival Three']];
let match;

function newMatch(n) {
  return {
    guid: 'MOCK' + Date.now().toString(16).toUpperCase() + n,
    clock: GAME_SECONDS, overtime: false, replayUntil: 0, ended: false, live: false,
    teams: [0, 0], target: 0, nextGoal: Date.now() + (fast ? 6000 : 25000),
    players: NAMES.flatMap((names, team) => names.map((name, i) => ({
      Name: name, Shortcut: team * 3 + i + 1, TeamNum: team, PrimaryId: 'Epic|mock' + team + i + '|0',
      Score: 0, Goals: 0, Shots: 0, Assists: 0, Saves: 0, Touches: 0, CarTouches: 0, Demos: 0,
      bHasCar: true, Speed: 0, Boost: 33, bBoosting: false, bOnGround: true, bOnWall: false,
      bPowersliding: false, bDemolished: false, bSupersonic: false,
    }))),
  };
}

const clients = new Set();
function send(event, data) {
  const frame = JSON.stringify({ Event: event, Data: JSON.stringify({ MatchGuid: match.guid, ...data }) });
  clients.forEach((c) => c.write(frame));
}
const ref = (p) => ({ Name: p.Name, Shortcut: p.Shortcut, TeamNum: p.TeamNum });

function tick() {
  const now = Date.now();
  const replay = now < match.replayUntil;
  match.players.forEach((p) => {
    // Boost drains while boosting and refills from pads, like a real car.
    if (!replay && !match.ended) {
      if (Math.random() < 0.04) p.bBoosting = !p.bBoosting && p.Boost > 0;
      p.Boost += p.bBoosting ? -1.1 : (Math.random() < 0.02 ? (Math.random() < 0.25 ? 100 : 12) : 0);
      p.Boost = Math.max(0, Math.min(100, p.Boost));
      if (p.Boost === 0) p.bBoosting = false;
      p.Speed = p.bBoosting ? 2300 : 1200 + Math.random() * 600;
      p.bSupersonic = p.Speed >= 2200;
      if (Math.random() < 0.01) { p.Touches++; p.Score += 2; }
      if (Math.random() < 0.002) { p.Shots++; p.Score += 10; }
      if (Math.random() < 0.0015) { p.Saves++; p.Score += 50; }
      if (Math.random() < 0.0008) { p.Demos++; p.Score += 10; }
    }
  });
  const target = match.players[match.target];
  send('UpdateState', {
    Players: match.players.map((p) => ({ ...p, Boost: Math.round(p.Boost) })),
    Game: {
      Teams: [
        { Name: 'Blue', TeamNum: 0, Score: match.teams[0], ColorPrimary: '1873FF', ColorSecondary: 'E5E5E5' },
        { Name: 'Orange', TeamNum: 1, Score: match.teams[1], ColorPrimary: 'C26418', ColorSecondary: 'E5E5E5' },
      ],
      TimeSeconds: match.clock, bOvertime: match.overtime, Ball: match.live ? { Speed: 900, TeamNum: 0 } : { Speed: 0, TeamNum: 255 },
      bReplay: replay, bHasWinner: match.ended,
      Winner: match.ended ? (match.teams[0] > match.teams[1] ? 'Blue' : 'Orange') : '',
      Arena: 'Stadium_P', bHasTarget: !match.ended, Target: ref(target),
    },
  });
}

function goal() {
  const team = Math.random() < 0.55 ? 0 : 1;
  const mates = match.players.filter((p) => p.TeamNum === team);
  const scorer = mates[Math.floor(Math.random() * mates.length)];
  const assister = Math.random() < 0.6 ? mates.find((p) => p !== scorer) : null;
  scorer.Goals++; scorer.Shots++; scorer.Score += 100;
  if (assister) { assister.Assists++; assister.Score += 50; }
  match.teams[team]++;
  send('GoalScored', {
    GoalSpeed: 1500 + Math.random() * 2500, GoalTime: GAME_SECONDS - match.clock,
    ImpactLocation: { X: 0, Y: team ? -5120 : 5120, Z: 200 },
    Scorer: ref(scorer), ...(assister ? { Assister: ref(assister) } : {}),
    BallLastTouch: { Player: ref(scorer), Speed: 2000 },
  });
  setTimeout(() => send('GoalReplayStart', {}), 1500);
  match.replayUntil = Date.now() + (fast ? 4000 : 8000);
  setTimeout(() => send('GoalReplayEnd', {}), fast ? 4000 : 8000);
  if (match.overtime) endGame();
}

function endGame() {
  if (match.ended) return;
  match.ended = true;
  send('MatchEnded', { WinnerTeamNum: match.teams[0] > match.teams[1] ? 0 : 1 });
  setTimeout(() => send('PodiumStart', {}), 3000);
  setTimeout(() => { send('MatchDestroyed', {}); match = null; }, fast ? 8000 : 15000);
  setTimeout(() => { match = newMatch(Date.now()); startMatch(); }, fast ? 12000 : 25000);
}

// A match loads, sits for a few seconds, counts down, then plays.
function startMatch() {
  const m = match;
  send('MatchCreated', {});
  send('ClockUpdatedSeconds', { TimeSeconds: m.clock, bOvertime: false });
  setTimeout(() => { if (match === m) { send('MatchInitialized', {}); send('CountdownBegin', {}); } }, fast ? 2000 : 6000);
  setTimeout(() => { if (match === m) { m.live = true; m.nextGoal = Date.now() + (fast ? 6000 : 25000); send('RoundStarted', {}); } }, fast ? 3000 : 9000);
}

match = newMatch(0);
setTimeout(startMatch, 500);
let lastClock = Date.now();
setInterval(() => {
  if (!match) return;
  const now = Date.now();
  // Clock runs only during live play.
  if (match.live && !match.ended && now >= match.replayUntil && now - lastClock >= (fast ? 100 : 1000)) {
    lastClock = now;
    if (match.overtime) match.clock++;
    else if (match.clock > 0) match.clock--;
    send('ClockUpdatedSeconds', { TimeSeconds: match.clock, bOvertime: match.overtime });
    if (!match.overtime && match.clock === 0) {
      if (match.teams[0] === match.teams[1]) match.overtime = true; else endGame();
    }
  }
  if (match.live && !match.ended && now >= match.replayUntil && now >= match.nextGoal) {
    match.nextGoal = now + (fast ? 5000 + Math.random() * 6000 : 20000 + Math.random() * 40000);
    goal();
  }
  // The spectator camera hops between players now and then.
  if (Math.random() < 1 / (RATE * 5)) match.target = Math.floor(Math.random() * match.players.length);
  tick();
}, 1000 / RATE);

net.createServer((sock) => {
  clients.add(sock);
  sock.on('close', () => clients.delete(sock));
  sock.on('error', () => clients.delete(sock));
}).listen(port, '127.0.0.1', () => console.log(`Mock Rocket League Stats API on 127.0.0.1:${port}${fast ? ' (fast clock)' : ''}`));
