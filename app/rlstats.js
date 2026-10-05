// Rocket League live game data (v0.11.0), from Psyonix's official Stats API
// (`MatchStatsExporter_TA`, added when EAC shut BakkesMod out of online play).
//
// How the game exposes it: with PacketSendRate > 0 in TAStatsAPI.ini, the
// running game listens on a local TCP port (49123 by default) and, while a
// match is loaded, streams JSON messages to whoever connects. Despite Psyonix's
// docs calling it a websocket, it is a plain TCP socket carrying concatenated
// JSON objects with no delimiter, and each message's `Data` is itself a
// JSON-encoded *string*. This is the same feed BARL 2.x reads.
//
// This module owns the socket and boils the feed down to one small snapshot
// (clock, team goals, players' boost and stats, who the camera follows) that
// server.js forwards to every overlay. It only connects while something wants
// it (the scoreboard is set to the Rocket League style), and everything fails
// soft: no game, no match, or the API turned off just means status 'waiting'.

const fs = require('fs');
const net = require('net');
const path = require('path');

const DEFAULT_PORT = 49123;
const DEFAULT_RATE = 30;
const RETRY_MS = 2000;
// No UpdateState for this long means the match is over or we're in menus.
const STALE_MS = 4000;
// Overlays get at most this many snapshots a second, whatever the send rate.
const EMIT_MS = 33;
// Signs of play are not read as the next game starting for this long after a
// game ends: the finished game's last packets can still be in flight, and no
// game starts during the podium.
const INFER_AFTER_END_MS = 10000;
// Ball speed in the feed is in Unreal units/s (1 uu = 1 cm).
const UU_TO_KPH = 0.036;

const CONFIG_REL = path.join('My Games', 'Rocket League', 'TAGame', 'Config');
const CONFIG_FILE = 'TAStatsAPI.ini';
const SECTION = '[TAGame.MatchStatsExporter_TA]';

// --- TAStatsAPI.ini -----------------------------------------------------------
// The game copies DefaultStatsAPI.ini from its install folder into the user's
// Documents on first launch, and reads the Documents copy from then on, so
// that is the one to check and edit (the install folder also needs admin).
// Documents is often redirected into OneDrive, so several roots are tried.

function configCandidates(documentsDir) {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const roots = [
    documentsDir,
    process.env.OneDrive && path.join(process.env.OneDrive, 'Documents'),
    home && path.join(home, 'OneDrive', 'Documents'),
    home && path.join(home, 'Documents'),
  ].filter(Boolean);
  const seen = new Set();
  return roots.map((r) => path.join(r, CONFIG_REL, CONFIG_FILE)).filter((p) => {
    const k = p.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function readIniValue(text, key) {
  const m = text.match(new RegExp('^\\s*' + key + '\\s*=\\s*([^\\r\\n;]*)', 'mi'));
  return m ? m[1].trim() : null;
}

function configStatus(documentsDir) {
  const candidates = configCandidates(documentsDir);
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) {
    // The Config folder exists once the game has been run; the file can then
    // be created there.
    const dir = candidates.map(path.dirname).find((d) => fs.existsSync(d)) || null;
    return { found: false, path: dir ? path.join(dir, CONFIG_FILE) : null, port: DEFAULT_PORT, rate: 0, enabled: false };
  }
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { /* unreadable: report as off */ }
  const port = parseInt(readIniValue(text, 'Port'), 10);
  const rate = parseFloat(readIniValue(text, 'PacketSendRate'));
  return {
    found: true,
    path: file,
    port: port > 0 ? port : DEFAULT_PORT,
    rate: rate > 0 ? rate : 0,
    enabled: rate > 0,
  };
}

// Turn the exporter on: set PacketSendRate (and Port, if missing) inside the
// exporter's section, keeping every other line as it was. The game only reads
// this at launch, so the caller has to tell the operator to restart it.
function enableConfig(documentsDir, rate = DEFAULT_RATE) {
  const st = configStatus(documentsDir);
  if (!st.path) throw new Error('Rocket League\'s config folder was not found. Launch Rocket League once, close it, then try again.');
  let text = '';
  try { text = fs.readFileSync(st.path, 'utf8'); } catch (e) { /* new file */ }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let lines = text ? text.split(/\r?\n/) : [];
  let start = lines.findIndex((l) => l.trim().toLowerCase() === SECTION.toLowerCase());
  if (start < 0) {
    lines = [SECTION, `Port=${DEFAULT_PORT}`, `PacketSendRate=${rate}`, ''].concat(lines);
  } else {
    let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
    if (end < 0) end = lines.length;
    const set = (key, value, keep) => {
      const i = lines.findIndex((l, j) => j > start && j < end && new RegExp('^\\s*' + key + '\\s*=', 'i').test(l));
      if (i >= 0) { if (!keep) lines[i] = `${key}=${value}`; return; }
      lines.splice(start + 1, 0, `${key}=${value}`);
      end += 1;
    };
    set('PacketSendRate', rate, false);
    set('Port', DEFAULT_PORT, true);
  }
  fs.writeFileSync(st.path, lines.join(eol));
  return configStatus(documentsDir);
}

// --- Stream framing -------------------------------------------------------------
// Pull complete top-level JSON objects out of the byte stream. Braces inside
// strings (player names can contain anything) are skipped by tracking string
// and escape state. Partial objects stay buffered for the next chunk.
function createFramer() {
  let buf = Buffer.alloc(0);
  return {
    reset() { buf = Buffer.alloc(0); },
    push(chunk) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      const out = [];
      let cursor = 0;
      while (cursor < buf.length) {
        while (cursor < buf.length && buf[cursor] !== 0x7b) cursor++; // resync to '{'
        if (cursor >= buf.length) break;
        let depth = 0, inStr = false, esc = false, end = -1;
        for (let i = cursor; i < buf.length; i++) {
          const b = buf[i];
          if (esc) { esc = false; continue; }
          if (inStr) {
            if (b === 0x5c) esc = true;
            else if (b === 0x22) inStr = false;
            continue;
          }
          if (b === 0x22) inStr = true;
          else if (b === 0x7b) depth++;
          else if (b === 0x7d && --depth === 0) { end = i; break; }
        }
        if (end < 0) break;
        out.push(buf.subarray(cursor, end + 1).toString('utf8'));
        cursor = end + 1;
      }
      buf = buf.subarray(cursor);
      // A runaway unterminated object would otherwise grow forever.
      if (buf.length > 4 * 1024 * 1024) buf = Buffer.alloc(0);
      return out;
    },
  };
}

function decode(raw) {
  let env;
  try { env = JSON.parse(raw); } catch (e) { return null; }
  if (!env || typeof env.Event !== 'string') return null;
  let data = env.Data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (e) { return null; }
  }
  return { event: env.Event, data: data || {} };
}

// --- Snapshot ----------------------------------------------------------------------

function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function hexColor(c) {
  c = String(c || '').trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(c) ? '#' + c : '';
}
// Shortcut is unique per match; the team is included because bots in a
// private match can repeat other identifiers.
function playerKey(p) { return p ? `${num(p.TeamNum)}:${num(p.Shortcut)}` : null; }
function ref(p) { return p && p.Name ? { name: String(p.Name), team: num(p.TeamNum) } : null; }

function emptySnapshot(status) {
  return { status, inMatch: false, clock: 300, overtime: false, replay: false, paused: false, winner: -1, arena: '', teams: [], players: [], target: null };
}

function createRlStats(opts = {}) {
  const onSnapshot = opts.onSnapshot || (() => {});
  const onEvent = opts.onEvent || (() => {});
  const documentsDir = opts.documentsDir || null;
  const host = opts.host || '127.0.0.1';
  const fixedPort = opts.port || null; // tests and the mock feed

  let active = false;
  let socket = null;
  let retryTimer = null;
  let staleTimer = null;
  let emitTimer = null;
  let lastEmit = 0;
  let snap = emptySnapshot('off');
  const framer = createFramer();
  // The moment a game is about to start is reported once per game, as
  // { type: 'gameStarting' }: the first kickoff countdown (MatchInitialized,
  // CountdownBegin). If that was missed (the socket connected late), the
  // first sign of play stands in for it: RoundStarted, the clock running, or
  // a touched ball. `started` is that once-per-game latch; `fresh` says a
  // state without a winner has been seen since the last game ended, so the
  // finished game's own late packets are never read as play.
  let started = false;
  let fresh = true;
  let clockMax = 0;
  let endedAt = 0;
  function starting(why) {
    if (started) return;
    if (why !== 'countdown' && why !== 'round' && Date.now() - endedAt < INFER_AFTER_END_MS) return;
    started = true;
    onEvent({ type: 'gameStarting', why });
  }

  function emitNow() {
    clearTimeout(emitTimer); emitTimer = null;
    lastEmit = Date.now();
    onSnapshot(snap);
  }
  // Throttled with a trailing call, so the newest packet always goes out.
  function emit() {
    const wait = EMIT_MS - (Date.now() - lastEmit);
    if (wait <= 0) emitNow();
    else if (!emitTimer) emitTimer = setTimeout(emitNow, wait);
  }

  function setStatus(status) {
    if (snap.status === status) return;
    snap = status === 'connected' ? { ...snap, status } : emptySnapshot(status);
    emitNow();
  }

  function endMatch() {
    clearTimeout(staleTimer);
    if (!snap.inMatch) return;
    snap = emptySnapshot(snap.status);
    emitNow();
  }

  function onUpdate(d) {
    // Joining a match already in progress (or a feed that skips
    // MatchCreated) still counts as a match starting.
    if (!snap.inMatch && !(d.Game && d.Game.bHasWinner)) onEvent({ type: 'matchStart' });
    const g = d.Game || {};
    if (!g.bHasWinner) {
      fresh = true;
      // Ball.TeamNum is the last team to touch the ball, 255 before kickoff.
      const touched = g.Ball ? num(g.Ball.TeamNum, 255) : 255;
      if (!g.bReplay && (g.bOvertime || touched === 0 || touched === 1)) starting('play');
    }
    const teams = [0, 1].map((n) => {
      const t = (g.Teams || []).find((x) => num(x.TeamNum) === n) || {};
      return { name: String(t.Name || (n ? 'Orange' : 'Blue')), score: num(t.Score), color: hexColor(t.ColorPrimary), color2: hexColor(t.ColorSecondary) };
    });
    const players = (d.Players || []).map((p) => ({
      key: playerKey(p),
      name: String(p.Name || ''),
      team: num(p.TeamNum),
      // Boost and speed are spectator-only fields: absent means unknown, not 0.
      boost: p.Boost === undefined || p.Boost === null ? null : Math.max(0, Math.min(100, Math.round(num(p.Boost)))),
      boosting: !!p.bBoosting,
      supersonic: !!p.bSupersonic,
      demolished: !!p.bDemolished,
      score: num(p.Score), goals: num(p.Goals), assists: num(p.Assists), saves: num(p.Saves),
      shots: num(p.Shots), demos: num(p.Demos), touches: num(p.Touches),
    })).sort((a, b) => a.team - b.team || a.key.localeCompare(b.key, undefined, { numeric: true }));
    snap = {
      ...snap,
      inMatch: true,
      clock: Math.max(0, Math.round(num(g.TimeSeconds, snap.clock))),
      overtime: !!g.bOvertime,
      // The goal-replay events also set this; either source counts.
      replay: !!g.bReplay || snap.replayEvent === true,
      winner: g.bHasWinner ? (teams.findIndex((t) => t.name === g.Winner)) : -1,
      arena: String(g.Arena || ''),
      teams,
      players,
      target: g.bHasTarget && g.Target ? playerKey(g.Target) : null,
    };
    clearTimeout(staleTimer);
    staleTimer = setTimeout(endMatch, STALE_MS);
    emit();
  }

  function handle(msg) {
    const d = msg.data || {};
    switch (msg.event) {
      case 'UpdateState': onUpdate(d); break;
      case 'ClockUpdatedSeconds': {
        snap = { ...snap, clock: Math.max(0, Math.round(num(d.TimeSeconds, snap.clock))), overtime: !!d.bOvertime };
        emit();
        // A clock below its highest value this game is a clock that has run.
        const t = num(d.TimeSeconds, clockMax);
        if (fresh && (d.bOvertime || t < clockMax)) starting('clock');
        if (t > clockMax) clockMax = t;
        break;
      }
      case 'CountdownBegin': starting('countdown'); break;
      case 'RoundStarted': starting('round'); break;
      case 'GoalScored': {
        const scorer = ref(d.Scorer);
        onEvent({
          type: 'goal',
          team: scorer ? scorer.team : (d.BallLastTouch && d.BallLastTouch.Player ? num(d.BallLastTouch.Player.TeamNum) : -1),
          scorer,
          assister: ref(d.Assister),
          kph: Math.round(num(d.GoalSpeed) * UU_TO_KPH),
        });
        break;
      }
      case 'GoalReplayStart': snap = { ...snap, replay: true, replayEvent: true }; emitNow(); break;
      case 'GoalReplayEnd': snap = { ...snap, replay: false, replayEvent: false }; emitNow(); break;
      case 'MatchPaused': snap = { ...snap, paused: true }; emitNow(); break;
      case 'MatchUnpaused': snap = { ...snap, paused: false }; emitNow(); break;
      case 'MatchEnded': {
        let winner = d.WinnerTeamNum;
        if (winner !== 0 && winner !== 1 && snap.teams.length === 2) {
          winner = snap.teams[0].score > snap.teams[1].score ? 0 : snap.teams[1].score > snap.teams[0].score ? 1 : -1;
        }
        // The final numbers ride along: the server records each game for the
        // post-game stats screen and the series overview.
        onEvent({
          type: 'matchEnded', winner: winner === 0 || winner === 1 ? winner : -1, guid: d.MatchGuid || '',
          teams: snap.teams, players: snap.players, arena: snap.arena, overtime: snap.overtime,
        });
        // The next start signal belongs to the next game.
        started = false; fresh = false; clockMax = 0; endedAt = Date.now();
        break;
      }
      case 'MatchDestroyed': endMatch(); break;
      // MatchCreated: the match has loaded (teams created). MatchInitialized:
      // its first kickoff countdown has begun.
      case 'MatchCreated': case 'MatchInitialized':
        snap = { ...emptySnapshot(snap.status) };
        emitNow();
        onEvent({ type: 'matchStart' });
        started = false; clockMax = 0;
        if (msg.event === 'MatchInitialized') starting('countdown');
        break;
      default: break;
    }
  }

  function connect() {
    clearTimeout(retryTimer); retryTimer = null;
    if (!active || socket) return;
    const port = fixedPort || configStatus(documentsDir).port;
    const s = net.createConnection({ host, port });
    socket = s;
    framer.reset();
    s.setNoDelay(true);
    s.on('connect', () => setStatus('connected'));
    s.on('data', (chunk) => {
      framer.push(chunk).forEach((raw) => {
        const msg = decode(raw);
        if (msg) { try { handle(msg); } catch (e) { /* one bad packet never kills the feed */ } }
      });
    });
    s.on('error', () => {});
    s.on('close', () => {
      if (socket === s) socket = null;
      clearTimeout(staleTimer);
      if (!active) return;
      setStatus('waiting');
      retryTimer = setTimeout(connect, RETRY_MS);
    });
  }

  return {
    // Connect only while the Rocket League scoreboard is in use.
    setActive(on) {
      on = !!on;
      if (on === active) return;
      active = on;
      if (on) { setStatus('waiting'); connect(); return; }
      clearTimeout(retryTimer); retryTimer = null;
      if (socket) { const s = socket; socket = null; s.destroy(); }
      clearTimeout(staleTimer);
      setStatus('off');
    },
    snapshot() { return snap; },
    config() { return configStatus(documentsDir); },
    enable(rate) { return enableConfig(documentsDir, rate); },
    close() { this.setActive(false); clearTimeout(emitTimer); },
  };
}

module.exports = { createRlStats, createFramer, decode, configStatus, enableConfig, DEFAULT_PORT };
