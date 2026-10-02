const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const { importMatch } = require('./necc');
const { createObs } = require('./obs');
const { createMontages } = require('./montages');
const { createRlStats } = require('./rlstats');

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const CONTROL_DIR = path.join(__dirname, 'public', 'control');
const APP_VERSION = require('./package.json').version;

const GAMES = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, 'games.json'), 'utf8'));

const DEFAULT_SOCIAL = 'wideneresports';

function emptyTeam() {
  return { name: '', tag: '', color: '', colorAlt: '', logoUrl: '', players: [] };
}

// Per-overlay text. Each view owns its own headline/subtitle/status pill, so a
// page locked to one view (?view=…, i.e. an OBS scene-sync source) shows that
// view's words no matter which view was last edited. Without this, every
// locked scene rendered the single shared title, so switching scenes in OBS
// showed the previous view's text until someone pushed again.
// Everything else (socials, logo, montage, rosters, countdown) stays global -
// only these three vary per view.
function defaultViewText() {
  return {
    'starting-soon': { title: 'Stream Starting Soon', subtitle: '', status: 'Starting Soon' },
    'post-match': { title: 'Thanks for Watching', subtitle: '', status: 'Stream Ending Soon' },
    'roster': { title: '', subtitle: '', status: '' },
    'brb': { title: 'Be Right Back', subtitle: 'Thanks for waiting', status: '' },
    'necc': { title: '', subtitle: '', status: '' },
    'scoreboard': { title: '', subtitle: '', status: '' },
  };
}

// Match scoreboard (v0.9.0; was the Smash-only `smash` object in v0.8.0).
// One scoreboard serves every game: team names, games/maps/sets won, best-of.
// The crew-battle stock counter is an option (showStocks) that the Smash
// preset turns on. `unit` is the word for one game of the series ("Set",
// "Map", "Game"). Stocks are stored as a count *lost* per team, not
// per-player arrays, so the crew order and who is on stage are derived:
// player index = lost / stocksEach. That keeps it correct when the roster is
// edited mid-set. `position` is where the board sits: 'top' is the full bar,
// the four corners use the compact box, for games whose own HUD owns the top.
// `style: 'rl'` (v0.11.0) swaps in the Rocket League board, which reads the
// game itself (see rlstats.js): live goals and clock, player boost bars, and
// the boost meter. The rl* flags turn its parts on and off.
const SCOREBOARD_POSITIONS = ['top', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
const SCOREBOARD_STYLES = ['standard', 'rl'];
function defaultScoreboard() {
  return {
    round: '',
    unit: 'Game',
    bestOf: 3,
    scoreA: 0,
    scoreB: 0,
    crewSize: 4,
    stocksEach: 3,
    lostA: 0,
    lostB: 0,
    showStocks: false,
    swap: false,
    position: 'top',
    style: 'standard',
    rlAutoSeries: true,
    rlPlayers: true,
    rlBoost: true,
    rlGameColors: true,
    rlAutoStats: true,
  };
}

function normalizeScoreboard(raw) {
  // v0.8.0 files carry `smash` instead: it was always a Smash crew battle, so
  // keep its numbers and label the series in sets with stocks shown.
  const src = raw.scoreboard || (raw.smash ? { unit: 'Set', showStocks: true, ...raw.smash } : {});
  const out = { ...defaultScoreboard(), ...src };
  if (!SCOREBOARD_POSITIONS.includes(out.position)) out.position = 'top';
  if (!SCOREBOARD_STYLES.includes(out.style)) out.style = 'standard';
  return out;
}

function normalizeViews(raw, parent) {
  const out = defaultViewText();
  if (raw && typeof raw === 'object') {
    if (raw.smash && !raw.scoreboard) raw = { ...raw, scoreboard: raw.smash };
    Object.keys(out).forEach((k) => {
      if (raw[k] && typeof raw[k] === 'object') out[k] = { ...out[k], ...raw[k] };
    });
    return out;
  }
  // Upgrade path from before per-view text existed: the file has one shared
  // title/subtitle/status and no `views`. Carry those into whichever view was
  // active, so an operator's own wording survives the upgrade instead of being
  // silently replaced by defaults. Other views start from defaults.
  if (parent && typeof parent.mode === 'string' && out[parent.mode]) {
    const v = out[parent.mode];
    out[parent.mode] = {
      title: parent.title !== undefined ? parent.title : v.title,
      subtitle: parent.subtitle !== undefined ? parent.subtitle : v.subtitle,
      status: parent.status !== undefined ? parent.status : v.status,
    };
  }
  return out;
}

const DEFAULT_STATE = {
  mode: 'starting-soon',
  game: '',
  team: '',
  title: 'Stream Starting Soon',
  status: 'Starting Soon',
  subtitle: '',
  next: '',
  countdownMode: 'duration',
  durationSec: 600,
  layout: 'right',
  clip: '',
  logo: '',
  montage: true,
  neccUrl: '',
  neccType: '',
  // Widener stripe backdrop behind transparent NECC overlays (vs flat black)
  neccBg: true,
  socials: {
    twitch: DEFAULT_SOCIAL,
    twitter: DEFAULT_SOCIAL,
    instagram: DEFAULT_SOCIAL,
    youtube: DEFAULT_SOCIAL,
  },
  teamA: emptyTeam(),
  teamB: emptyTeam(),
  views: defaultViewText(),
  scoreboard: defaultScoreboard(),
};

function initialState() {
  return {
    ...DEFAULT_STATE,
    socials: { ...DEFAULT_STATE.socials },
    teamA: emptyTeam(),
    teamB: emptyTeam(),
    views: defaultViewText(),
    scoreboard: defaultScoreboard(),
    end: new Date(Date.now() + DEFAULT_STATE.durationSec * 1000).toISOString(),
  };
}

function normalizeLoaded(raw) {
  if (!raw || typeof raw.mode !== 'string') return null;
  const out = {
    ...initialState(),
    ...raw,
    socials: { ...DEFAULT_STATE.socials, ...raw.socials },
    teamA: { ...emptyTeam(), ...raw.teamA },
    teamB: { ...emptyTeam(), ...raw.teamB },
    // State files written before v0.7.2 have no `views` at all; merging over
    // fresh defaults gives them the per-view text without losing anything.
    views: normalizeViews(raw.views, raw),
    scoreboard: normalizeScoreboard(raw),
  };
  delete out.smash;
  if (out.mode === 'smash') out.mode = 'scoreboard';
  return out;
}

// Write JSON so that a crash or power cut mid-save can never leave a
// half-written file: write a temp file, keep the previous good copy as .bak,
// then swap the temp file into place. Loading falls back to the .bak copy.
function writeJsonSafe(file, obj) {
  const json = JSON.stringify(obj, null, 2);
  const tmp = file + '.tmp';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, json);
    try { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak'); } catch (e) { /* backup is best-effort */ }
    try {
      fs.renameSync(tmp, file);
    } catch (e) {
      // Antivirus or OneDrive can briefly lock the target on Windows; a plain
      // write is still better than losing the save.
      fs.writeFileSync(file, json);
      try { fs.unlinkSync(tmp); } catch (e2) { /* ignore */ }
    }
  } catch (err) {
    // Never let a failed save take down the server mid-broadcast.
    console.error(`Could not save ${path.basename(file)}: ${err.message}`);
  }
}

function readJsonSafe(file) {
  for (const f of [file, file + '.bak']) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { /* try the next */ }
  }
  return null;
}

// dataDir defaults to app/data for standalone `node server.js` use in dev.
// The packaged Electron app passes app.getPath('userData') instead, since the
// app's own install directory lives inside a read-only asar archive.
function createServer(port, opts = {}) {
  const dataDir = opts.dataDir || path.join(__dirname, 'data');
  const stateFile = path.join(dataDir, 'state.json');
  const libraryFile = path.join(dataDir, 'library.json');
  const logosDir = path.join(dataDir, 'logos');
  const settingsFile = path.join(dataDir, 'settings.json');
  // The included music track isn't in the installer: like the montages, it
  // downloads from the team Drive into this PC's data folder on request
  // (OBS reads it from there). A custom file needs no download.
  const musicDir = opts.musicDir || process.env.WIDENER_MUSIC_DIR || path.join(dataDir, 'music');
  const MUSIC_TRACK = { file: 'rl-music-long.m4a', driveId: '1M4encA-tBLZ3dBZzKcqDpvBESad2WX26', bytes: 36077636 };
  const DEFAULT_MUSIC = path.join(musicDir, MUSIC_TRACK.file);
  // Game montages are several GB, so a dev run can point this somewhere other
  // than app/data (which sits inside OneDrive on the dev PC).
  const montageDir = opts.montageDir || process.env.WIDENER_MONTAGE_DIR || path.join(dataDir, 'montages');
  // Only this PC may reach the server. OBS, the app window and an OBS dock all
  // run on the streaming PC, and listening on every interface let anyone on the
  // campus network open the control panel and change the stream. Both loopback
  // addresses are used because "localhost" resolves to IPv6 ::1 first on
  // Windows; with only 127.0.0.1 every connection paid a failed-IPv6 delay.
  const hosts = opts.host || process.env.WIDENER_HOST
    ? [opts.host || process.env.WIDENER_HOST]
    : ['127.0.0.1', '::1'];

  function savePersisted() {
    writeJsonSafe(stateFile, { live, draft });
  }

  // "live" is what every OBS Browser Source sees. "draft" is what the control
  // panel's own preview pane sees. Editing only ever touches draft; clicking
  // Push Live is the one moment draft is copied into live (and broadcast to
  // any connected OBS overlays). This is what lets you preview a change
  // before it goes out on stream. Guards against a state.json left over from
  // an older, incompatible schema (e.g. the original single-channel format)
  // by falling back to fresh defaults rather than trusting a shape we don't
  // recognize.
  const persisted = readJsonSafe(stateFile) || {};
  let live = normalizeLoaded(persisted.live) || initialState();
  let draft = normalizeLoaded(persisted.draft) || JSON.parse(JSON.stringify(live));

  function countdownSeconds(s) {
    const n = Number(s.durationSec);
    return isNaN(n) ? 0 : n;
  }

  function updateChannel(channel, partial) {
    const target = channel === 'live' ? live : draft;
    const next = { ...partial };
    delete next.restartCountdown;
    // The countdown only restarts when it is actually changed: a new length,
    // a switch into "count down from now", or an explicit restart (the panel's
    // button, or switching overlay). It used to restart on every edit, because
    // every edit carries durationSec, so fixing a typo and pushing reset the
    // countdown on stream.
    const mode = next.countdownMode || target.countdownMode;
    if (mode === 'duration') {
      const durationChanged = next.durationSec != null && next.durationSec !== ''
        && Number(next.durationSec) !== Number(target.durationSec);
      const enteredDuration = next.countdownMode === 'duration' && target.countdownMode !== 'duration';
      if (partial.restartCountdown || durationChanged || enteredDuration) {
        next.end = new Date(Date.now() + countdownSeconds({ ...target, ...next }) * 1000).toISOString();
      }
    }
    const merged = {
      ...target,
      ...next,
      socials: { ...target.socials, ...(partial.socials || {}) },
      teamA: partial.teamA ? { ...emptyTeam(), ...partial.teamA } : target.teamA,
      teamB: partial.teamB ? { ...emptyTeam(), ...partial.teamB } : target.teamB,
      // Merged per view key: the panel only ever sends the view it just
      // edited, so the other views' text must survive the update.
      views: partial.views ? { ...target.views, ...partial.views } : target.views,
      scoreboard: partial.scoreboard ? { ...target.scoreboard, ...partial.scoreboard } : target.scoreboard,
    };
    if (channel === 'live') live = merged; else draft = merged;
    savePersisted();
    return merged;
  }

  // Scoreboard counters (stocks, series score, swap) go straight to BOTH
  // channels. This is the one deliberate exception to draft-then-push: a stock
  // or a map is won in real time, and making the operator press Push Live (and
  // sit through the curtain stinger) for each one would make live scorekeeping
  // unusable. Only the counters are touched, so which overlay is on stream
  // still changes only on Push Live. Writing both keeps draft == live for
  // these fields, so it never shows up as an unpushed change.
  const COUNTERS = ['scoreA', 'scoreB', 'lostA', 'lostB', 'swap'];
  function applyScore(sb) {
    if (!sb || typeof sb !== 'object') return;
    const picked = {};
    COUNTERS.forEach((k) => { if (sb[k] !== undefined) picked[k] = sb[k]; });
    live = { ...live, scoreboard: { ...live.scoreboard, ...picked } };
    draft = { ...draft, scoreboard: { ...draft.scoreboard, ...picked } };
    savePersisted();
  }

  // Push Live: draft becomes live, verbatim, so preview and stream match
  // exactly. Deep copy so later draft edits can never alias into live.
  // A countdown that was restarted in the preview starts counting on stream
  // from the moment of the push, not from when it was restarted in the
  // preview (otherwise waiting before pushing would shorten it).
  function pushLive() {
    if (draft.countdownMode === 'duration' && draft.end !== live.end) {
      draft = { ...draft, end: new Date(Date.now() + countdownSeconds(draft) * 1000).toISOString() };
    }
    live = JSON.parse(JSON.stringify(draft));
    savePersisted();
    return live;
  }

  // Revert: throw away the in-progress draft and snap the preview back to
  // whatever is currently live on stream.
  function revertDraft() {
    draft = JSON.parse(JSON.stringify(live));
    savePersisted();
    return draft;
  }

  // Key-order-independent stringify so live/draft comparison never produces a
  // false "dirty" just because two equal objects were assembled differently.
  function stableStringify(v) {
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
  }

  // Does the preview differ from what's live? Powers the control panel's
  // "unpushed changes" indicator. The countdown end time is compared too: it
  // now only changes when the countdown is deliberately restarted, and a
  // restart that hasn't been pushed is a real difference.
  function isDirty() {
    return stableStringify(live) !== stableStringify(draft);
  }

  // --- Team + match library (v0.9.0) --------------------------------------
  // Saved teams (name, tag, colours, logo, players) and saved match setups,
  // kept server-side so the app window and an OBS dock share one library.
  let library = readJsonSafe(libraryFile) || {};
  library = { teams: Array.isArray(library.teams) ? library.teams : [], matches: Array.isArray(library.matches) ? library.matches : [] };
  function saveLibrary() { writeJsonSafe(libraryFile, library); }
  function newId() { return crypto.randomBytes(6).toString('hex'); }
  function cleanTeam(t) {
    const team = { ...emptyTeam(), ...(t || {}) };
    return {
      id: team.id || newId(),
      name: String(team.name || ''), tag: String(team.tag || ''),
      color: String(team.color || ''), colorAlt: String(team.colorAlt || ''),
      logoUrl: String(team.logoUrl || ''),
      players: (Array.isArray(team.players) ? team.players : []).map((p) => ({ name: String(p.name || ''), gamertag: String(p.gamertag || '') })),
      updatedAt: new Date().toISOString(),
    };
  }
  // Insert or update. Matches by id first, then by team name, so importing
  // the same NECC opponent twice updates their entry instead of duplicating.
  function upsertTeam(t) {
    const team = cleanTeam(t);
    if (!team.name.trim()) return null;
    let idx = library.teams.findIndex((x) => x.id === t.id);
    if (idx < 0) idx = library.teams.findIndex((x) => x.name.trim().toLowerCase() === team.name.trim().toLowerCase());
    if (idx >= 0) { team.id = library.teams[idx].id; library.teams[idx] = team; }
    else library.teams.push(team);
    library.teams.sort((a, b) => a.name.localeCompare(b.name));
    return team;
  }

  // --- NECC logo cache (v0.9.0) -------------------------------------------
  // Team logos from a NECC import are downloaded once and served locally from
  // /logos, so the overlay doesn't depend on images.leagueos.gg answering
  // mid-broadcast. On any failure the original remote URL is kept.
  const LOGO_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/avif': '.avif' };
  async function cacheLogo(url) {
    if (!/^https?:\/\//i.test(url || '')) return url;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return url;
      const ext = LOGO_TYPES[(res.headers.get('content-type') || '').split(';')[0].trim()];
      if (!ext) return url;
      const buf = Buffer.from(await res.arrayBuffer());
      const name = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + ext;
      fs.mkdirSync(logosDir, { recursive: true });
      fs.writeFileSync(path.join(logosDir, name), buf);
      return '/logos/' + name;
    } catch (e) {
      return url;
    }
  }

  // Optional OBS integration (see obs.js). Points OBS browser sources at this
  // same server. Everything it does is opt-in and fails soft - if OBS is never
  // connected, none of this runs and the app behaves exactly as before.
  const obs = createObs({
    getOverlayBase: () => `http://localhost:${port}`,
    // Someone switched scenes by hand in OBS (or the push did it). With
    // scene-sync on, OBS decides what is actually on program, so the app's
    // idea of "live" follows it: the panel's LIVE marker and live monitor then
    // show the truth instead of whatever was last pushed.
    onProgramView: (view) => {
      if (!obs.isSceneSync() || !view || live.mode === view) return;
      live = { ...live, mode: view };
      savePersisted();
      broadcast('live', live);
      broadcastDirty();
      updateMusic();
    },
  });

  // --- Background music (v0.11.0) -------------------------------------------
  // Played by OBS through one shared media source (see obs.js). The app's job
  // is the file, the level, and *when*: only while no gameplay is on screen.
  // Settings are machine-level, so they live in settings.json, not in the
  // live/draft overlay state.
  let appSettings = readJsonSafe(settingsFile) || {};
  function musicConfig() {
    const m = appSettings.music || {};
    const volume = Number(m.volume);
    return {
      enabled: m.enabled !== false,
      file: typeof m.file === 'string' ? m.file : '',
      volume: Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : 55,
    };
  }
  // A custom file that has gone missing falls back to the included track,
  // once that is downloaded. '' = nothing to play yet.
  function musicFile() {
    const m = musicConfig();
    if (m.file && fs.existsSync(m.file)) return m.file;
    return musicTrack.has('music') ? DEFAULT_MUSIC : '';
  }
  // The volume slider is 0-100; 100 is OBS's 0 dB, 0 is -40 dB.
  function musicDb(volume) { return -40 + 40 * (volume / 100); }
  function musicStatus() {
    const m = musicConfig();
    return {
      ...m, db: Math.round(musicDb(m.volume)), path: musicFile(), defaultPath: DEFAULT_MUSIC,
      download: musicTrack.status().music,
      customMissing: !!m.file && !fs.existsSync(m.file), playing: musicOn,
      obsConnected: obs.status().connected,
    };
  }
  // Gameplay is on screen when the Scoreboard view is live, except on the
  // Rocket League board when a stats screen is up or the game is between
  // matches. If the game feed isn't connected, assume gameplay (never risk
  // music over a match).
  function gameplayOnScreen() {
    if (live.mode !== 'scoreboard') return false;
    if (live.scoreboard.style !== 'rl') return true;
    if (rlScreen.screen !== 'live') return false;
    const snap = rl.snapshot();
    return snap.status !== 'connected' || snap.inMatch;
  }
  let musicOn = false;
  function updateMusic(fadeMs) {
    const m = musicConfig();
    const on = m.enabled && !!musicFile() && !gameplayOnScreen();
    const changed = on !== musicOn;
    musicOn = on;
    obs.setMusic({ file: musicFile(), db: musicDb(m.volume), on }, fadeMs);
    if (changed) sendToPanels({ type: 'music', music: musicStatus() });
  }
  // Fetch the included track when it's what would play: music on and no
  // custom file. Picking the included track (or the panel's Download
  // button) asks again, and also retries a failed download.
  function wantMusicTrack(retry) {
    const m = musicConfig();
    if (m.enabled && !(m.file && fs.existsSync(m.file))) musicTrack.ensure('music', true, retry);
  }
  let musicHad = null;
  const musicTrack = createMontages({
    dir: musicDir,
    games: [{ id: 'music', montage: MUSIC_TRACK }],
    onChange: () => {
      sendToPanels({ type: 'music', music: musicStatus() });
      // Finished downloading: OBS can have the file now.
      const has = musicTrack.has('music');
      if (has !== musicHad) { musicHad = has; updateMusic(); }
    },
  });

  // Game montages (see montages.js). Every page gets the status: the panel
  // shows progress, the overlay needs to know which montages are playable.
  const montages = createMontages({
    dir: montageDir,
    games: GAMES,
    onChange: () => sendToAll({ type: 'montages', montages: montages.status() }),
  });
  // Start the download the moment a game with a missing montage is picked
  // (or pushed), so it is usually ready by the time the overlay is live.
  function wantMontage(game) { if (game) montages.ensure(game, true); }

  // Rocket League live data (see rlstats.js). Every page gets the snapshots:
  // the overlay draws them, the panel shows the connection. The socket to the
  // game is only open while either channel's scoreboard uses the Rocket
  // League style.
  const rl = createRlStats({
    documentsDir: opts.documentsDir,
    port: opts.rlPort || Number(process.env.WIDENER_RL_PORT) || null,
    onSnapshot: (snap) => {
      sendToAll({ type: 'rl', rl: snap });
      const key = snap.status + ':' + snap.inMatch;
      if (key !== lastRlMusicKey) { lastRlMusicKey = key; updateMusic(); }
    },
    onEvent: (ev) => {
      if (ev.type === 'matchEnded') onGameEnded(ev);
      if (ev.type === 'matchStart') onGameStarting();
      // The full player list is for the server's record only.
      const { players, ...light } = ev;
      sendToAll({ type: 'rlEvent', event: light });
    },
  });
  let lastRlMusicKey = '';
  function updateRlActive() {
    rl.setActive(live.scoreboard.style === 'rl' || draft.scoreboard.style === 'rl');
  }

  // --- Rocket League series record and screens (v0.11.0) -----------------
  // Every finished game is recorded (score, map, each player's final stats)
  // in rl-series.json, for the post-game stats screen and the series
  // overview. `rlScreen` is what the scoreboard view shows: the live board,
  // one game's stats, or the series overview. Like the game feed it is not
  // part of live/draft: it follows the game in real time, and the preview
  // and the stream always agree. Cleared by the panel's Reset match.
  const rlSeriesFile = path.join(dataDir, 'rl-series.json');
  let rlSeries = readJsonSafe(rlSeriesFile) || {};
  if (!Array.isArray(rlSeries.games)) rlSeries = { games: [] };
  let rlScreen = { screen: 'live', game: -1 };
  let rlScreenTimers = [];
  function rlSeriesMessage() { return { type: 'rlSeries', series: rlSeries, screen: rlScreen }; }
  function broadcastRlSeries() { sendToAll(rlSeriesMessage()); }
  function clearRlTimers() { rlScreenTimers.forEach(clearTimeout); rlScreenTimers = []; }
  function setRlScreen(screen, game) {
    clearRlTimers();
    const last = rlSeries.games.length - 1;
    if (screen === 'game') game = Number.isInteger(game) && game >= 0 && game <= last ? game : last;
    if ((screen === 'game' && game < 0) || !['live', 'game', 'series'].includes(screen)) screen = 'live';
    rlScreen = { screen, game: screen === 'game' ? game : -1 };
    broadcastRlSeries();
    updateMusic();
  }

  // BARL-style series tracking: a finished game adds a win to the team that
  // was on the winning colour. Blue is the left side in game, so it is team A
  // unless the sides are swapped. Uses the live board's settings, since that
  // is what is on stream, and goes through applyScore like a panel click.
  // Then, RLCS-style, the board cuts to that game's stats, and to the series
  // overview once the series is won.
  const STATS_DELAY_MS = 3000;
  const OVERVIEW_AFTER_MS = 15000;
  let lastGameEnd = { guid: '', at: 0 };
  function onGameEnded(ev) {
    const sb = live.scoreboard;
    if (sb.style !== 'rl' || (ev.winner !== 0 && ev.winner !== 1)) return;
    // MatchEnded can arrive more than once for one game, and bot matches
    // have no GUID to tell games apart, so a short window guards both.
    const now = Date.now();
    if ((ev.guid && ev.guid === lastGameEnd.guid) || now - lastGameEnd.at < 15000) return;
    lastGameEnd = { guid: ev.guid, at: now };
    // Once a team has clinched, extra games (a show match after the series)
    // are neither counted nor recorded. The panel's + button still counts.
    const need = Math.ceil((Number(sb.bestOf) || 3) / 2);
    const decided = (s) => (s.scoreA || 0) >= need || (s.scoreB || 0) >= need;
    if (decided(sb)) return;
    const blue = sb.swap ? 'B' : 'A';
    if (sb.rlAutoSeries !== false) {
      const key = ev.winner === 0 ? blue : (blue === 'A' ? 'B' : 'A');
      applyScore({ ['score' + key]: Math.min(9, (sb['score' + key] || 0) + 1) });
      broadcast('live', live);
      broadcast('draft', draft);
      broadcastDirty();
      ev.series = key;
    }
    rlSeries.games.push({
      at: new Date(now).toISOString(),
      blue,
      winner: ev.winner,
      goals: (ev.teams || []).map((t) => t.score || 0),
      arena: ev.arena || '',
      overtime: !!ev.overtime,
      players: (ev.players || []).map((p) => ({
        name: p.name, team: p.team, score: p.score, goals: p.goals, assists: p.assists,
        shots: p.shots, saves: p.saves, demos: p.demos,
      })),
    });
    writeJsonSafe(rlSeriesFile, rlSeries);
    broadcastRlSeries();
    if (live.scoreboard.rlAutoStats === false) return;
    const game = rlSeries.games.length - 1;
    const won = decided(live.scoreboard);
    clearRlTimers();
    rlScreenTimers.push(setTimeout(() => {
      setRlScreen('game', game);
      if (won) rlScreenTimers.push(setTimeout(() => setRlScreen('series'), OVERVIEW_AFTER_MS));
    }, STATS_DELAY_MS));
  }
  // The next game loading puts the live board back, mid-series. Once the
  // series is won the stats and overview stay up (a show match or the next
  // lobby loading must not pull them off); the panel switches back by hand.
  function onGameStarting() {
    const sb = live.scoreboard;
    const need = Math.ceil((Number(sb.bestOf) || 3) / 2);
    if ((sb.scoreA || 0) >= need || (sb.scoreB || 0) >= need) return;
    if (rlScreen.screen !== 'live' || rlScreenTimers.length) setRlScreen('live');
  }

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/control', express.static(CONTROL_DIR));
  // Media the overlay itself loads (stinger transition video, fonts, etc).
  app.use('/overlay-assets', express.static(path.join(__dirname, 'public', 'overlay-assets')));
  app.use('/logos', express.static(logosDir));
  // Only finished, verified montages are served; never a .part file.
  app.get('/montages/:file', (req, res) => {
    const file = montages.readyPath(req.params.file);
    if (!file) return res.status(404).end();
    res.sendFile(file, (err) => {
      if (err && !res.headersSent) res.status(err.statusCode || 404).end();
    });
  });

  app.get('/games.json', (req, res) => {
    res.sendFile(path.join(TEMPLATES_DIR, 'games.json'));
  });

  app.get('/api/games', (req, res) => res.json(GAMES));
  app.get('/api/version', (req, res) => res.json({ version: APP_VERSION }));

  app.get('/overlay', (req, res) => {
    // OBS's embedded Chromium (CEF) will happily cache this page indefinitely
    // otherwise, which makes edits look "stuck" until the source is manually
    // refreshed. This is the one route that must always be fetched fresh.
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(TEMPLATES_DIR, 'overlay.html'));
  });

  app.get('/api/state', (req, res) => {
    res.json(req.query.channel === 'draft' ? draft : live);
  });

  // Local media passthrough. The control panel's Browse buttons store the
  // logo/clip as plain filesystem paths, but the overlay is an http page and
  // Chromium blocks file:// subresources from it - so the overlay requests
  // /media?src=<path> and the file is streamed from here instead (sendFile
  // handles Range requests, which video seeking needs). Only media file
  // types are served, so this can't be used to read arbitrary files.
  const MEDIA_EXTENSIONS = new Set([
    '.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi', '.ogv',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif',
  ]);
  app.get('/media', (req, res) => {
    const src = String(req.query.src || '');
    if (!src || !path.isAbsolute(src)) return res.status(400).send('src must be an absolute file path');
    if (!MEDIA_EXTENSIONS.has(path.extname(src).toLowerCase())) return res.status(403).send('unsupported media type');
    res.sendFile(src, (err) => {
      if (err && !res.headersSent) res.status(err.statusCode || 404).end();
    });
  });

  app.post('/api/necc/import', async (req, res) => {
    const url = req.body && req.body.url;
    if (!url) return res.status(400).json({ error: 'url is required' });
    try {
      const data = await importMatch(url);
      await Promise.all((data.teams || []).map(async (t) => { t.logoUrl = await cacheLogo(t.logoUrl); }));
      // Every imported team goes into the library, so next week's rematch is
      // one click away even without the NECC link.
      let changed = false;
      (data.teams || []).forEach((t) => {
        if (upsertTeam({ ...t, players: (t.players || []).filter((p) => p.position >= 0) })) changed = true;
      });
      if (changed) { saveLibrary(); broadcastLibrary(); }
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err.message || 'Failed to import match' });
    }
  });

  // --- Library routes ---
  app.get('/api/library', (req, res) => res.json(library));

  app.put('/api/library/teams', (req, res) => {
    const team = upsertTeam(req.body || {});
    if (!team) return res.status(400).json({ error: 'A team needs a name to be saved' });
    saveLibrary(); broadcastLibrary();
    res.json({ team, library });
  });

  app.delete('/api/library/teams/:id', (req, res) => {
    library.teams = library.teams.filter((t) => t.id !== req.params.id);
    saveLibrary(); broadcastLibrary();
    res.json({ library });
  });

  app.put('/api/library/matches', (req, res) => {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'A saved match needs a name' });
    const match = { id: body.id || newId(), name, savedAt: new Date().toISOString(), data: body.data || {} };
    const idx = library.matches.findIndex((m) => m.id === match.id || m.name.toLowerCase() === name.toLowerCase());
    if (idx >= 0) { match.id = library.matches[idx].id; library.matches[idx] = match; }
    else library.matches.unshift(match);
    saveLibrary(); broadcastLibrary();
    res.json({ match, library });
  });

  app.delete('/api/library/matches/:id', (req, res) => {
    library.matches = library.matches.filter((m) => m.id !== req.params.id);
    saveLibrary(); broadcastLibrary();
    res.json({ library });
  });

  // --- Montage routes ---
  app.get('/api/montages', (req, res) => res.json(montages.status()));

  // { game } downloads one game's montage; no game downloads every missing one.
  app.post('/api/montages/download', (req, res) => {
    const game = (req.body || {}).game;
    if (game) montages.ensure(game, true, true); else montages.ensureAll();
    res.json(montages.status());
  });

  // --- Music routes ---
  app.get('/api/music', (req, res) => res.json(musicStatus()));
  // { enabled?, file?, volume? }. file '' goes back to the bundled track.
  app.post('/api/music', (req, res) => {
    const body = req.body || {};
    const m = { ...musicConfig() };
    if (body.enabled !== undefined) m.enabled = !!body.enabled;
    if (body.volume !== undefined && Number.isFinite(Number(body.volume))) m.volume = Math.max(0, Math.min(100, Number(body.volume)));
    if (body.file !== undefined) {
      const file = String(body.file || '');
      if (file && (!path.isAbsolute(file) || !fs.existsSync(file))) return res.status(400).json({ error: 'That file was not found on this PC.' });
      m.file = file;
    }
    appSettings = { ...appSettings, music: m };
    writeJsonSafe(settingsFile, appSettings);
    wantMusicTrack(body.file === '');
    // A volume change is a quick ramp; on/off is the usual slow fade.
    updateMusic(body.volume !== undefined && body.enabled === undefined ? 300 : undefined);
    const status = musicStatus();
    sendToPanels({ type: 'music', music: status });
    res.json(status);
  });

  app.post('/api/music/download', (req, res) => {
    musicTrack.ensure('music', true, true);
    res.json(musicStatus());
  });

  // --- Rocket League routes ---
  // The panel shows whether the Stats API is turned on in the game's config,
  // and can turn it on (the game reads it at launch, so it needs a restart).
  app.get('/api/rl/status', (req, res) => res.json({ config: rl.config(), feed: rl.snapshot().status }));

  app.post('/api/rl/enable', (req, res) => {
    try { res.json({ config: rl.enable() }); }
    catch (err) { res.status(500).json({ error: err.message || 'Could not update the Rocket League config' }); }
  });

  // --- OBS integration routes (all optional, all fail soft) ----------------
  // The control panel drives OBS through these. Note the password is only ever
  // sent from the local panel to here over localhost; it is never persisted
  // server-side and never logged.
  app.get('/api/obs/status', (req, res) => res.json(obs.status()));

  app.get('/api/obs/inspect', async (req, res) => {
    try { res.json(await obs.inspect()); }
    catch (err) { res.json({ ...obs.status(), error: err.message || String(err) }); }
  });

  app.post('/api/obs/connect', async (req, res) => {
    try {
      updateMusic();
      const st = await obs.connect(req.body || {});
      sendToPanels({ type: 'music', music: musicStatus() });
      res.json(st);
    }
    catch (err) { res.status(502).json({ ...obs.status(), error: err.message || 'Failed to connect to OBS' }); }
  });

  app.post('/api/obs/disconnect', (req, res) => {
    const st = obs.disconnect();
    sendToPanels({ type: 'music', music: musicStatus() });
    res.json(st);
  });

  app.post('/api/obs/settings', (req, res) => res.json(obs.setSettings(req.body || {})));

  app.post('/api/obs/build-scenes', async (req, res) => {
    try { updateMusic(); res.json(await obs.buildScenes()); }
    catch (err) { res.status(502).json({ error: err.message || 'Failed to build scenes' }); }
  });

  // Manual scene switch (e.g. a "test switch" button). Push Live already drives
  // this automatically via obs.onPush when scene-sync is enabled.
  app.post('/api/obs/switch', async (req, res) => {
    try { res.json(await obs.switchToView((req.body || {}).view)); }
    catch (err) { res.status(502).json({ error: err.message || 'Failed to switch scene' }); }
  });

  // The first address is the one that matters: its errors (e.g. the port is
  // already in use) are what main.js reports. The IPv6 one is best-effort, for
  // PCs with IPv6 disabled.
  const servers = hosts.map((h) => http.createServer(app));
  const server = servers[0];
  const wss = new WebSocketServer({ noServer: true });
  servers.forEach((srv, i) => {
    srv.on('upgrade', (req, socket, head) => {
      if ((req.url || '').split('?')[0] !== '/ws') { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req));
    });
    if (i > 0) srv.on('error', () => {});
    srv.listen(port, hosts[i], () => {
      if (i === 0) console.log(`Widener stream overlay server running on http://localhost:${port}`);
    });
  });
  // Closing the returned server closes every listener.
  const closeFirst = server.close.bind(server);
  server.close = (cb) => { rl.close(); servers.slice(1).forEach((s) => { try { s.close(); } catch (e) {} }); return closeFirst(cb); };

  // `extra` lets a broadcast carry side-channel fields alongside the state -
  // currently just { transition: 'stinger' } on a Push Live, which tells live
  // overlays to play the curtain stinger and swap content mid-cover.
  function broadcast(channel, data, extra) {
    const payload = JSON.stringify({ type: 'state', channel, data, ...(extra || {}) });
    wss.clients.forEach((client) => {
      if (client.readyState === 1 && client.subscribedChannel === channel) client.send(payload);
    });
  }

  function sendToPanels(obj) {
    const payload = JSON.stringify(obj);
    wss.clients.forEach((client) => {
      if (client.readyState === 1 && client.subscribedChannel === 'draft') client.send(payload);
    });
  }

  // Tell every control panel (draft subscriber) whether the preview currently
  // differs from live, and which overlay is live (for the LIVE marker on the
  // overlay buttons), after anything that could have changed either channel.
  function dirtyMessage() {
    return { type: 'dirty', dirty: isDirty(), liveMode: live.mode, liveNeccType: live.neccType || '' };
  }
  function sendToAll(obj) {
    const payload = JSON.stringify(obj);
    wss.clients.forEach((client) => {
      if (client.readyState === 1 && client.subscribedChannel) client.send(payload);
    });
  }

  function broadcastDirty() { sendToPanels(dirtyMessage()); }
  function broadcastLibrary() { sendToPanels({ type: 'library', library }); }

  wss.on('connection', (ws) => {
    ws.subscribedChannel = null;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'subscribe') {
        ws.subscribedChannel = msg.channel === 'draft' ? 'draft' : 'live';
        // Montage status first, so an overlay's first render already knows
        // whether the game's montage can play.
        ws.send(JSON.stringify({ type: 'montages', montages: montages.status() }));
        ws.send(JSON.stringify({ type: 'state', channel: ws.subscribedChannel, data: ws.subscribedChannel === 'draft' ? draft : live }));
        ws.send(JSON.stringify({ type: 'rl', rl: rl.snapshot() }));
        ws.send(JSON.stringify(rlSeriesMessage()));
        if (ws.subscribedChannel === 'draft') {
          ws.send(JSON.stringify(dirtyMessage()));
          ws.send(JSON.stringify({ type: 'library', library }));
          ws.send(JSON.stringify({ type: 'music', music: musicStatus() }));
        }
        return;
      }

      // Every edit - including switching which overlay/mode is showing via
      // the overlay buttons - only ever touches draft. Nothing reaches the
      // stream until an explicit Push Live.
      if (msg.type === 'update') {
        const channel = msg.channel === 'draft' ? 'draft' : 'live';
        const newState = updateChannel(channel, msg.data || {});
        wantMontage(newState.game);
        updateRlActive();
        broadcast(channel, newState);
        broadcastDirty();
        return;
      }

      if (msg.type === 'push') {
        const newLive = pushLive();
        wantMontage(newLive.game);
        updateRlActive();
        // The stinger flag rides along to both channels: the live overlay
        // plays the wipe while swapping content, and the control panel's
        // preview plays it too as operator confirmation.
        const extra = msg.transition === 'stinger' ? { transition: 'stinger' } : undefined;
        broadcast('live', newLive, extra);
        broadcast('draft', draft, extra);
        broadcastDirty();
        // Scene-sync (if connected + enabled): OBS switches to the scene for
        // the newly-live view and fires its own transition. Fire-and-forget -
        // it must never delay or fail the push that already went out.
        obs.onPush(newLive).catch(() => {});
        updateMusic();
        return;
      }

      // Instant scoreboard update (see applyScore): live and preview both
      // change immediately, with no transition.
      if (msg.type === 'score') {
        applyScore(msg.scoreboard);
        broadcast('live', live);
        broadcast('draft', draft);
        broadcastDirty();
        return;
      }

      // Rocket League screens: the panel's Live / Game stats / Series
      // buttons, and Reset match clearing the series record.
      if (msg.type === 'rlScreen') { setRlScreen(msg.screen, Number(msg.game)); return; }
      if (msg.type === 'rlSeriesReset') {
        rlSeries = { games: [] };
        writeJsonSafe(rlSeriesFile, rlSeries);
        setRlScreen('live');
        return;
      }

      // Discard the draft: snap the preview (and the control panel form,
      // which repopulates from the draft broadcast) back to the live state.
      if (msg.type === 'revert') {
        const newDraft = revertDraft();
        updateRlActive();
        broadcast('draft', newDraft);
        broadcastDirty();
      }
    });
  });

  // Resume or start the montages for the games already picked. Only now that
  // the WebSocket server exists to report their progress.
  wantMontage(live.game);
  wantMontage(draft.game);
  updateRlActive();
  updateMusic();
  wantMusicTrack(false);

  return server;
}

module.exports = { createServer, GAMES };

if (require.main === module) {
  const port = process.env.PORT || 4310;
  createServer(port);
}
