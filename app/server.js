const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const { importMatch, listSeasons, pickSeason, seasonStandings } = require('./necc');
const { createObs } = require('./obs');
const { createMontages } = require('./montages');
const { createRlStats } = require('./rlstats');
const { profileId, loadProfile, clientBrand, brandCss } = require('./profile');

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const CONTROL_DIR = path.join(__dirname, 'public', 'control');
const APP_VERSION = require('./package.json').version;

// The league this build is for (see profile.js): its games, colours, art,
// OBS scene names and defaults.
const PROFILE = loadProfile(profileId());
const GAMES = PROFILE.games;

const DEFAULT_SOCIAL = PROFILE.socialHandle;

// A stamp of the pages this build serves, so a page left open across an app
// update can tell it is the old one. OBS keeps every scene's browser source
// loaded (and a dock stays open) while the app is replaced underneath it;
// without this they showed the old version's look until refreshed by hand.
// Each page gets its stamp with /brand.js as it loads, and the current one
// again in a `hello` message every time it (re)connects: a mismatch reloads.
function pageStamp(files) {
  const h = crypto.createHash('sha1').update(APP_VERSION);
  files.filter(Boolean).forEach((f) => { try { h.update(fs.readFileSync(f)); } catch (e) { h.update('missing'); } });
  return h.digest('hex').slice(0, 12);
}
const PROFILE_FILE = path.join(PROFILE.dir, 'profile.json');
const PAGE_STAMPS = {
  overlay: pageStamp([path.join(TEMPLATES_DIR, 'overlay.html'), PROFILE.theme, PROFILE.themeScript, PROFILE_FILE]),
  panel: pageStamp(['index.html', 'control.js', 'control.css'].map((f) => path.join(CONTROL_DIR, f)).concat(PROFILE_FILE)),
};

function emptyTeam() {
  return { name: '', tag: '', color: '', colorAlt: '', logoUrl: '', players: [] };
}

// Per-overlay text. Each view owns its own headline/subtitle/status pill, so a
// page locked to one view (?view=…, each OBS scene's source) shows that
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
    // The league's own scenes (see LEAGUE_VIEWS in obs.js). The subtitle is
    // the line under the heading, e.g. "Through week 3".
    'standings': { title: 'Standings', subtitle: '', status: '' },
    'matchup': { title: 'Head to Head', subtitle: '', status: '' },
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
// the boost meter. The rl* flags turn its parts on and off; rlHideHud has the
// app turn the game's own HUD off for a spectator while the board is in use.
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
    rlHideHud: true,
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
  // Post-Match has its own countdown (v2.0.0), started when its scene goes
  // on air, so it never disturbs the Starting Soon one.
  postMatchSec: 120,
  postEnd: '',
  layout: 'right',
  clip: '',
  logo: '',
  montage: PROFILE.defaults.montage !== false,
  neccUrl: '',
  neccType: '',
  // Branded backdrop behind transparent league overlays (vs flat black)
  neccBg: true,
  // League graphic links from the last import, by type (stageBracket,
  // matchPreview, ...). Each league graphic has its own OBS scene (v2.0.0).
  neccUrls: {},
  // The background picked for a scene, by view (v2.0.0), for a league whose
  // profile has several. A view that isn't here uses the profile's default.
  backgrounds: {},
  // The headline typeface picked for the scenes (v2.0.0), for a league whose
  // profile has more than one. Empty means the profile's default.
  headlineFont: '',
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
    backgrounds: {},
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
    backgrounds: raw.backgrounds && typeof raw.backgrounds === 'object' ? { ...raw.backgrounds } : {},
    headlineFont: typeof raw.headlineFont === 'string' ? raw.headlineFont : '',
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
  // In dev, each league other than Widener keeps its own app/data/<id>.
  const dataDir = opts.dataDir || (PROFILE.id === 'widener' ? path.join(__dirname, 'data') : path.join(__dirname, 'data', PROFILE.id));
  const stateFile = path.join(dataDir, 'state.json');
  const libraryFile = path.join(dataDir, 'library.json');
  const logosDir = path.join(dataDir, 'logos');
  const settingsFile = path.join(dataDir, 'settings.json');
  // The included music track isn't in the installer: like the montages, it
  // downloads from the team Drive into this PC's data folder on request
  // (OBS reads it from there). A custom file needs no download.
  // A profile without an included track (music: null) plays only a file
  // picked on the PC.
  const musicDir = opts.musicDir || process.env.WIDENER_MUSIC_DIR || path.join(dataDir, 'music');
  const MUSIC_TRACK = PROFILE.music;
  const DEFAULT_MUSIC = MUSIC_TRACK ? path.join(musicDir, MUSIC_TRACK.file) : '';
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

  // One state since v2.0.0 (OBS first). OBS decides what is on air, so there
  // is no draft and no Push Live any more: every scene's browser source shows
  // this state as soon as it changes, and the operator previews a scene the
  // OBS way, in Studio Mode, before taking it to program. The file keeps v1's
  // { live, draft } shape, both the same, so an older version can still read
  // it after a downgrade.
  function savePersisted() {
    writeJsonSafe(stateFile, { live: state, draft: state });
  }
  const persisted = readJsonSafe(stateFile) || {};
  // From a v1 file, what was on stream (live) is the state to keep.
  let state = normalizeLoaded(persisted.live) || normalizeLoaded(persisted.draft) || initialState();

  function countdownSeconds(s) {
    const n = Number(s.durationSec);
    return isNaN(n) ? 0 : n;
  }

  function updateState(partial) {
    const target = state;
    const next = { ...partial };
    delete next.restartCountdown;
    // The countdown only restarts when it is actually changed: a new length,
    // a switch into "count down from now", or an explicit restart (the panel's
    // button, or Post-Match going on air). Every edit carries durationSec, so
    // restarting on any change would reset it while fixing a typo.
    const mode = next.countdownMode || target.countdownMode;
    if (mode === 'duration') {
      const durationChanged = next.durationSec != null && next.durationSec !== ''
        && Number(next.durationSec) !== Number(target.durationSec);
      const enteredDuration = next.countdownMode === 'duration' && target.countdownMode !== 'duration';
      if (partial.restartCountdown || durationChanged || enteredDuration) {
        next.end = new Date(Date.now() + countdownSeconds({ ...target, ...next }) * 1000).toISOString();
      }
    }
    state = {
      ...target,
      ...next,
      socials: { ...target.socials, ...(partial.socials || {}) },
      teamA: partial.teamA ? { ...emptyTeam(), ...partial.teamA } : target.teamA,
      teamB: partial.teamB ? { ...emptyTeam(), ...partial.teamB } : target.teamB,
      // Merged per view key: the panel only sends the scene text it changed.
      views: partial.views ? mergeViews(target.views, partial.views) : target.views,
      neccUrls: partial.neccUrls ? { ...partial.neccUrls } : target.neccUrls,
      backgrounds: partial.backgrounds ? { ...target.backgrounds, ...partial.backgrounds } : target.backgrounds,
      scoreboard: partial.scoreboard ? { ...target.scoreboard, ...partial.scoreboard } : target.scoreboard,
    };
    savePersisted();
    return state;
  }
  function mergeViews(have, patch) {
    const out = { ...have };
    Object.keys(patch).forEach((k) => { out[k] = { ...(have[k] || {}), ...patch[k] }; });
    return out;
  }

  // Scoreboard counters (stocks, series score, swap). Kept apart from the
  // panel's form updates, so a second open panel (an OBS dock) can never send
  // a stale score back over the real one.
  const COUNTERS = ['scoreA', 'scoreB', 'lostA', 'lostB', 'swap'];
  function applyScore(sb) {
    if (!sb || typeof sb !== 'object') return;
    const picked = {};
    COUNTERS.forEach((k) => { if (sb[k] !== undefined) picked[k] = sb[k]; });
    state = { ...state, scoreboard: { ...state.scoreboard, ...picked } };
    savePersisted();
  }

  // --- Team + match library (v0.9.0) --------------------------------------
  // Saved teams (name, tag, colours, logo, players) and saved match setups,
  // kept server-side so the app window and an OBS dock share one library.
  let library = readJsonSafe(libraryFile) || {};
  library = {
    teams: Array.isArray(library.teams) ? library.teams : [],
    matches: Array.isArray(library.matches) ? library.matches : [],
    seeded: Array.isArray(library.seeded) ? library.seeded : [],
  };
  function saveLibrary() { writeJsonSafe(libraryFile, library); }
  function newId() { return crypto.randomBytes(6).toString('hex'); }

  // A league's member schools (profiles/<id>/teams.json, v2.0.0) are in the
  // library from the first start: name, short name, colours and the league's
  // logo, no players. `seeded` remembers which ones were added, so a school
  // the operator deletes stays deleted, and a school the league adds later
  // still arrives with an update.
  const LEAGUE_TEAMS = PROFILE.teams.map((t) => ({
    id: t.id, name: t.name, tag: t.tag || '', color: t.color || '', colorAlt: t.colorAlt || '',
    logoUrl: t.logo ? '/brand/' + t.logo.split('/').map(encodeURIComponent).join('/') : '',
  }));
  {
    const seeded = new Set(library.seeded);
    const fresh = LEAGUE_TEAMS.filter((t) => !seeded.has(t.id));
    if (fresh.length) {
      fresh.forEach((t) => {
        const have = library.teams.some((x) => x.id === t.id || x.name.trim().toLowerCase() === t.name.toLowerCase());
        if (!have) library.teams.push({ ...t, players: [], league: true, updatedAt: new Date().toISOString() });
        seeded.add(t.id);
      });
      library.teams.sort((a, b) => a.name.localeCompare(b.name));
      library.seeded = [...seeded];
      saveLibrary();
    }
  }
  // The member school an imported team belongs to, by its name: "Widener
  // University", "Widener University Gold" and "Widener Esports" are all
  // Widener. Its league logo then replaces the LeagueOS one.
  function leagueTeamFor(name) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    const starts = (word) => { const w = word.toLowerCase(); return n === w || (n.startsWith(w) && /^[^a-z0-9]/.test(n.slice(w.length))); };
    return LEAGUE_TEAMS.find((t) => starts(t.name)) || LEAGUE_TEAMS.find((t) => t.tag && starts(t.tag)) || null;
  }
  function cleanTeam(t) {
    const team = { ...emptyTeam(), ...(t || {}) };
    return {
      id: team.id || newId(),
      name: String(team.name || ''), tag: String(team.tag || ''),
      color: String(team.color || ''), colorAlt: String(team.colorAlt || ''),
      logoUrl: String(team.logoUrl || ''),
      players: (Array.isArray(team.players) ? team.players : []).map((p) => ({ name: String(p.name || ''), gamertag: String(p.gamertag || '') })),
      league: team.league === true,
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
    if (idx >= 0) { team.id = library.teams[idx].id; team.league = team.league || library.teams[idx].league === true; library.teams[idx] = team; }
    else library.teams.push(team);
    library.teams.sort((a, b) => a.name.localeCompare(b.name));
    return team;
  }

  // --- League standings (v2.0.0) --------------------------------------------
  // Each game's standings are read from the league's site (LeagueOS, see
  // necc.js): the season for that game and its teams' records, in the
  // league's own scoring order. Nothing is typed in. They are fetched when a
  // game is selected, after a match import, every few minutes for the game
  // on stream and on request, and kept in league.json so the scenes have the
  // last table at the next start or without a connection.
  //   standings[gameId] = { rows, seasonId, seasonName, played, scored,
  //                         scoreName, updatedAt, checkedAt, error }
  //   row = { name, tag, rank, w, l, gw, gl, sf, sa, color, colorAlt, logoUrl }
  // w/l are matches, gw/gl games (or maps), sf/sa the score for and against.
  const leagueFile = path.join(dataDir, 'league.json');
  const LEAGUE_HOST = (() => { try { return new URL(PROFILE.league.site).hostname; } catch (e) { return ''; } })();
  const LEAGUE_ID = String(PROFILE.league.id || '');
  const LEAGUE_ON = !!(LEAGUE_HOST && LEAGUE_ID && PROFILE.leagueScenes.length);
  let league = readJsonSafe(leagueFile) || {};
  // Tables typed in by hand (the betas) are dropped.
  if (league.v !== 2 || !league.standings || typeof league.standings !== 'object') league = { v: 2, standings: {}, seasons: {} };
  if (!league.seasons || typeof league.seasons !== 'object') league.seasons = {};
  const STANDINGS_MIN_AGE = 60 * 1000;
  const STANDINGS_EVERY = 5 * 60 * 1000;
  const refreshing = {};
  function leagueMessage() {
    return { type: 'league', league: { standings: league.standings, site: LEAGUE_HOST } };
  }
  function refreshStandings(gameId, force) {
    const game = PROFILE.games.find((g) => g.id === gameId);
    if (!LEAGUE_ON || !game) return Promise.resolve(null);
    const have = league.standings[gameId];
    if (!force && have && Date.now() - new Date(have.checkedAt || 0).getTime() < STANDINGS_MIN_AGE) return Promise.resolve(have);
    if (refreshing[gameId]) return refreshing[gameId];
    refreshing[gameId] = (async () => {
      const now = new Date().toISOString();
      try {
        const seasons = await listSeasons(LEAGUE_HOST, LEAGUE_ID);
        // The season of the last imported match for this game while it is
        // still listed and not over; otherwise the game's season by date.
        const kept = league.seasons[gameId];
        const season = (kept && seasons.find((x) => x.id === kept.id && (!x.end || x.end >= Date.now())))
          || pickSeason(seasons, game.leagueActivity, game.name);
        if (!season) throw new Error(`${LEAGUE_HOST} has no ${game.name} season`);
        const st = await seasonStandings(LEAGUE_HOST, LEAGUE_ID, season.id);
        const rows = await Promise.all(st.rows.map(async (r) => {
          // A member school shows the league's own logo; any other team's is
          // downloaded once and served from /logos.
          const lt = leagueTeamFor(r.name) || leagueTeamFor(r.org);
          return {
            name: r.name, tag: r.tag || (lt ? lt.tag : ''), rank: r.rank,
            w: r.w, l: r.l, gw: r.gw, gl: r.gl, sf: r.sf, sa: r.sa,
            color: r.color || (lt ? lt.color : ''), colorAlt: r.colorAlt || (lt ? lt.colorAlt : ''),
            logoUrl: lt && lt.logoUrl ? lt.logoUrl : await cacheLogo(r.logoUrl),
          };
        }));
        league.standings[gameId] = { rows, seasonId: st.seasonId, seasonName: st.seasonName, played: st.played, scored: st.scored, scoreName: game.scoreName || '', updatedAt: now, checkedAt: now, error: '' };
      } catch (err) {
        league.standings[gameId] = { rows: [], ...(have || {}), checkedAt: now, error: String((err && err.message) || 'The league site did not answer').slice(0, 200) };
      }
      writeJsonSafe(leagueFile, league);
      sendToAll(leagueMessage());
      return league.standings[gameId];
    })().finally(() => { delete refreshing[gameId]; });
    return refreshing[gameId];
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

  // OBS (see obs.js). Since v2.0.0 it is required: the app builds the scenes
  // and OBS decides what is on air. The app follows the program scene:
  // state.mode becomes the view on air (so a plain /overlay still follows
  // it), Post-Match starts its own countdown as it goes on air, a league graphic
  // scene points the state at its link, and the music follows.
  // What OBS has on program: { key, view, necc, scene }. key is '' for a
  // scene the app didn't build (a camera or replay scene of the operator's).
  let onAir = { key: '', view: '', necc: '', scene: '' };
  // The LeagueOS graphics a scene can be made for, in the order their scenes
  // sit in OBS: the ones for before the match first, then the ones for
  // during it.
  const NECC_TYPES = [
    { key: 'matchPreview', label: 'Match Preview' },
    { key: 'matchRosters', label: 'Match Rosters' },
    { key: 'stageBracket', label: 'Bracket' },
    { key: 'seasonHeader', label: 'Season Header' },
    { key: 'matchProgress', label: 'Match Progress' },
    { key: 'matchActivity', label: 'Match Activity' },
  ];
  const obs = createObs({
    getOverlayBase: () => `http://localhost:${port}`,
    prefix: PROFILE.obs.prefix,
    collection: PROFILE.obs.collection || `${PROFILE.shortName} Stream`,
    stingerName: `${PROFILE.shortName} Stinger`,
    allNeccTypes: NECC_TYPES,
    onProgram: (p) => {
      if (p.key !== 'stats') autoStatsUp = false;
      onAir = { key: p.key, view: p.view, necc: p.necc, scene: p.scene };
      if (p.view && state.mode !== p.view) {
        const patch = { mode: p.view };
        if (p.view === 'post-match') patch.postEnd = new Date(Date.now() + (Number(state.postMatchSec) || 120) * 1000).toISOString();
        updateState(patch);
        broadcastState();
      }
      if (p.view === 'necc' && p.necc && state.neccType !== p.necc) {
        updateState({ neccType: p.necc, neccUrl: (state.neccUrls || {})[p.necc] || '' });
        broadcastState();
      }
      sendToPanels({ type: 'onair', onAir });
      updateMusic();
    },
  });

  // --- Background music (v0.11.0) -------------------------------------------
  // Played by OBS through one shared media source (see obs.js). The app's job
  // is the file, the level, and *when*: only while no gameplay is on screen.
  // Settings are machine-level, so they live in settings.json, not in the
  // overlay state.
  let appSettings = readJsonSafe(settingsFile) || {};

  // --- Panel preferences --------------------------------------------------
  // Choices every open panel must agree on (the app window and an OBS dock):
  // which league graphics and league scenes get an OBS scene, whether the
  // Scoreboard scene gets a game capture, whether setup turns on OBS Studio
  // Mode, and whether the setup guide has run.
  const DEFAULT_NECC_TYPES = ['stageBracket', 'matchPreview'];
  const PREF_FLAGS = ['setupDone', 'guideV2', 'gameCapture', 'studioMode', 'orderScenes'];
  const onlyLeagueScenes = (list) => PROFILE.leagueScenes.filter((s) => list.includes(s));
  function panelPrefs() {
    const p = appSettings.panel || {};
    return {
      neccTypes: Array.isArray(p.neccTypes) ? p.neccTypes.filter((t) => NECC_TYPES.some((x) => x.key === t)) : DEFAULT_NECC_TYPES.slice(),
      // The league's own scenes: all of them until the operator unticks one.
      leagueScenes: Array.isArray(p.leagueScenes) ? onlyLeagueScenes(p.leagueScenes) : PROFILE.leagueScenes.slice(),
      setupDone: p.setupDone === true,
      // The v2 setup guide (OBS scenes and the stinger) has run on this PC.
      guideV2: p.guideV2 === true,
      gameCapture: p.gameCapture !== false,
      studioMode: p.studioMode !== false,
      // A build puts the app's scenes in stream order in OBS's list.
      orderScenes: p.orderScenes !== false,
    };
  }
  function savePanelPrefs(patch) {
    const next = panelPrefs();
    PREF_FLAGS.forEach((k) => { if (typeof patch[k] === 'boolean') next[k] = patch[k]; });
    if (Array.isArray(patch.neccTypes)) next.neccTypes = patch.neccTypes.filter((t) => NECC_TYPES.some((x) => x.key === t));
    if (Array.isArray(patch.leagueScenes)) next.leagueScenes = onlyLeagueScenes(patch.leagueScenes);
    appSettings = { ...appSettings, panel: next };
    writeJsonSafe(settingsFile, appSettings);
    sendToPanels({ type: 'prefs', prefs: next });
    syncLayout();
    return next;
  }
  // What a scene build makes: the base scenes, the stats scene when this
  // match's scoreboard has one (the Rocket League board), the league's own
  // scenes, and one scene per picked league graphic. Scenes of the app's
  // that are not in this list are removed by the next build, so a Valorant
  // match never carries a Rocket League scene.
  function buildOptions() {
    const prefs = panelPrefs();
    return {
      neccTypes: NECC_TYPES.filter((t) => prefs.neccTypes.includes(t.key)),
      includeStats: state.scoreboard.style === 'rl',
      leagueScenes: prefs.leagueScenes,
      gameCapture: prefs.gameCapture,
      studioMode: prefs.studioMode,
      orderScenes: prefs.orderScenes,
    };
  }
  // The scene list follows the match (its game) and the picked scenes. OBS
  // itself only changes on a build; until then the panel marks what differs.
  let layoutKey = '';
  function syncLayout(quiet) {
    const o = buildOptions();
    const key = JSON.stringify([o.includeStats, o.leagueScenes, o.neccTypes.map((t) => t.key)]);
    if (key === layoutKey) return;
    layoutKey = key;
    obs.setLayout(o);
    if (!quiet) sendToPanels({ type: 'scenes', scenes: obs.status().scenes });
  }
  // v1 kept the last import's league graphic links in the panel preferences;
  // they belong to the match, so they now live in the state.
  {
    const legacy = (appSettings.panel || {}).neccOverlayUrls;
    if (legacy && typeof legacy === 'object' && !Object.keys(state.neccUrls || {}).length) {
      state = { ...state, neccUrls: { ...legacy } };
    }
  }
  // The scenes this match uses. Quiet: no panel is connected this early.
  syncLayout(true);

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
      download: musicTrack.status().music, hasTrack: !!MUSIC_TRACK,
      customMissing: !!m.file && !fs.existsSync(m.file), playing: musicOn,
      obsConnected: obs.status().connected,
    };
  }
  // Gameplay is on screen when the Scoreboard scene is on air, except on the
  // Rocket League board while the game is between matches. If the game feed
  // isn't connected, assume gameplay (never risk music over a match). The
  // Rocket League Stats scene and every other scene count as no gameplay.
  function gameplayOnScreen() {
    if (state.mode !== 'scoreboard') return false;
    if (state.scoreboard.style !== 'rl') return true;
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
    if (MUSIC_TRACK && m.enabled && !(m.file && fs.existsSync(m.file))) musicTrack.ensure('music', true, retry);
  }
  let musicHad = null;
  const musicTrack = createMontages({
    dir: musicDir,
    games: MUSIC_TRACK ? [{ id: 'music', montage: MUSIC_TRACK }] : [],
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
  // (or set up), so it is usually ready by the time its scene is on air.
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
      if (ev.type === 'gameStarting') onGameStarting();
      // The full player list is for the server's record only.
      const { players, ...light } = ev;
      sendToAll({ type: 'rlEvent', event: light });
    },
  });
  let lastRlMusicKey = '';
  // While the Rocket League board is in use, the game's own HUD is taken off
  // a spectating client's screen (the board's rlHideHud setting): the board
  // replaces it. rlstats.js gives it back when either stops being true.
  function updateRlActive() {
    const sb = state.scoreboard;
    rl.setActive(sb.style === 'rl');
    rl.setHideHud(sb.style === 'rl' && sb.rlHideHud !== false);
  }

  // --- Rocket League series record and the Stats scene ---------------------
  // Every finished game is recorded (score, map, each player's final stats)
  // in rl-series.json. Since v2.0.0 the stats have their own OBS scene,
  // Rocket League Stats. `rlScreen` is what it shows: one game's stats, or
  // the series overview. After a game the app cuts OBS to that scene by
  // itself (the scoreboard's "Show stats automatically" setting), and back to
  // the Scoreboard when the next game loads mid-series. The cast can cut to
  // the Stats scene any time to fill time. Reset match clears the record.
  const rlSeriesFile = path.join(dataDir, 'rl-series.json');
  let rlSeries = readJsonSafe(rlSeriesFile) || {};
  if (!Array.isArray(rlSeries.games)) rlSeries = { games: [] };
  let rlScreen = { screen: 'game', game: -1 };
  let rlScreenTimers = [];
  function rlSeriesMessage() { return { type: 'rlSeries', series: rlSeries, screen: rlScreen }; }
  function broadcastRlSeries() { sendToAll(rlSeriesMessage()); }
  function clearRlTimers() { rlScreenTimers.forEach(clearTimeout); rlScreenTimers = []; }
  // screen: 'game' (game = an index, or -1 for the latest) or 'series'.
  function setRlScreen(screen, game) {
    clearRlTimers();
    const last = rlSeries.games.length - 1;
    if (screen !== 'series') {
      screen = 'game';
      game = Number.isInteger(game) && game >= 0 && game <= last ? game : -1;
    }
    rlScreen = { screen, game: screen === 'game' ? game : -1 };
    broadcastRlSeries();
  }
  // What the panel's buttons and the remote routes do: pick what the Stats
  // scene shows and, with show, put it on air.
  function showRlStats(screen, game, show) {
    setRlScreen(screen, game);
    if (show) return obs.switchTo('stats');
    return Promise.resolve({ switched: false });
  }

  // BARL-style series tracking: a finished game adds a win to the team that
  // was on the winning colour. Blue is the left side in game, so it is team A
  // unless the sides are swapped. Then the Stats scene goes on air with that
  // game, and the series overview follows once the series is won.
  const STATS_DELAY_MS = 3000;
  const OVERVIEW_AFTER_MS = 15000;
  let lastGameEnd = { guid: '', at: 0 };
  let autoStatsUp = false;
  function onGameEnded(ev) {
    const sb = state.scoreboard;
    if (sb.style !== 'rl' || (ev.winner !== 0 && ev.winner !== 1)) return;
    // MatchEnded can arrive more than once for one game, and bot matches
    // have no GUID to tell games apart, so a short window guards both.
    const now = Date.now();
    if ((ev.guid && ev.guid === lastGameEnd.guid) || now - lastGameEnd.at < 15000) return;
    lastGameEnd = { guid: ev.guid, at: now };
    // Once a team has clinched, extra games (a show match after the series)
    // are neither counted nor recorded. The panel's + button still counts.
    const need = Math.ceil((Number(sb.bestOf) || 3) / 2);
    const decided = (s2) => (s2.scoreA || 0) >= need || (s2.scoreB || 0) >= need;
    if (decided(sb)) return;
    const blue = sb.swap ? 'B' : 'A';
    if (sb.rlAutoSeries !== false) {
      const key = ev.winner === 0 ? blue : (blue === 'A' ? 'B' : 'A');
      applyScore({ ['score' + key]: Math.min(9, (sb['score' + key] || 0) + 1) });
      broadcastState();
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
    const game = rlSeries.games.length - 1;
    setRlScreen('game', game);
    if (state.scoreboard.rlAutoStats === false) return;
    const won = decided(state.scoreboard);
    rlScreenTimers.push(setTimeout(() => {
      // Only cut away from the Scoreboard: if the cast is already somewhere
      // else (a replay scene, Be Right Back), leave them there.
      if (state.mode === 'scoreboard') { autoStatsUp = true; obs.switchTo('stats'); }
      if (won) rlScreenTimers.push(setTimeout(() => setRlScreen('series'), OVERVIEW_AFTER_MS));
    }, STATS_DELAY_MS));
  }
  // The stats have no time limit: they stay on air until the next game is
  // about to start. Its first kickoff countdown (rlstats.js 'gameStarting')
  // puts the Scoreboard back, mid-series, if the app was the one that cut to
  // the stats. The next match merely loading does not. Once the series is
  // won the stats stay up (a show match must not pull them off).
  function onGameStarting() {
    const sb = state.scoreboard;
    const need = Math.ceil((Number(sb.bestOf) || 3) / 2);
    if ((sb.scoreA || 0) >= need || (sb.scoreB || 0) >= need) return;
    clearRlTimers();
    if (autoStatsUp && state.mode === 'stats') obs.switchTo('scoreboard');
    autoStatsUp = false;
  }

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/control', express.static(CONTROL_DIR));
  // Media the overlay itself loads (stinger transition video, fonts, etc).
  app.use('/overlay-assets', express.static(path.join(__dirname, 'public', 'overlay-assets')));
  app.use('/logos', express.static(logosDir));
  // The league's brand (v1.0.0, see profile.js): its art at /brand/*, its
  // colours as CSS variables, an optional overlay theme, and window.BRAND for
  // the overlay and the control panel. Fetched fresh like /overlay, so OBS's
  // browser cache can never pin an old brand.
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  app.use('/brand', express.static(PROFILE.assetsDir));
  app.get('/brand.js', (req, res) => {
    noStore(res);
    res.type('application/javascript').send(`window.BRAND = ${JSON.stringify(clientBrand(PROFILE))};\nwindow.APP_STAMP = ${JSON.stringify(PAGE_STAMPS)};\n`);
  });
  app.get('/brand.css', (req, res) => { noStore(res); res.type('text/css').send(brandCss(PROFILE)); });
  app.get('/brand-theme.css', (req, res) => {
    noStore(res);
    res.type('text/css');
    if (!PROFILE.theme) return res.send('/* no theme for this profile */\n');
    res.sendFile(PROFILE.theme);
  });
  // The theme's script, for what CSS can't do alone: it builds the layers of
  // the league's scene backgrounds.
  app.get('/brand-theme.js', (req, res) => {
    noStore(res);
    res.type('application/javascript');
    if (!PROFILE.themeScript) return res.send('/* no theme script for this profile */\n');
    res.sendFile(PROFILE.themeScript);
  });
  app.get('/api/profile', (req, res) => res.json(clientBrand(PROFILE)));
  // Only finished, verified montages are served; never a .part file.
  app.get('/montages/:file', (req, res) => {
    const file = montages.readyPath(req.params.file);
    if (!file) return res.status(404).end();
    res.sendFile(file, (err) => {
      if (err && !res.headersSent) res.status(err.statusCode || 404).end();
    });
  });

  // The profile's game list (profiles/<id>/games.json).
  app.get('/games.json', (req, res) => {
    res.json(GAMES);
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
    res.json(state);
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
      await Promise.all((data.teams || []).map(async (t) => {
        // A member school shows the league's own logo, and its colours when
        // LeagueOS has none.
        const lt = leagueTeamFor(t.name);
        if (lt) {
          if (lt.logoUrl) t.logoUrl = lt.logoUrl;
          if (!t.color) t.color = lt.color;
          if (!t.colorAlt) t.colorAlt = lt.colorAlt;
          if (!t.tag) t.tag = lt.tag;
          t.league = true;
        } else {
          t.logoUrl = await cacheLogo(t.logoUrl);
        }
      }));
      // Every imported team goes into the library, so next week's rematch is
      // one click away even without the NECC link.
      let changed = false;
      (data.teams || []).forEach((t) => {
        if (upsertTeam({ ...t, players: (t.players || []).filter((p) => p.position >= 0) })) changed = true;
      });
      if (changed) { saveLibrary(); broadcastLibrary(); }
      // A match from this league's own site names the season its game's
      // standings come from.
      if (LEAGUE_ON && data.hostname === LEAGUE_HOST && data.seasonId) {
        const name = String(data.game || '').toLowerCase();
        const g = PROFILE.games.find((x) => x.name.toLowerCase() === name || (x.leagueActivity || []).includes(String(data.activity || '').toLowerCase()));
        if (g) {
          league.seasons[g.id] = { id: data.seasonId, at: new Date().toISOString() };
          refreshStandings(g.id, true).catch(() => {});
        }
      }
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

  // --- League routes ---
  // Every game's standings as last read, and a re-read of one game's.
  app.get('/api/league', (req, res) => res.json(leagueMessage().league));

  app.post('/api/league/refresh', async (req, res) => {
    const game = String((req.body && req.body.game) || state.game || '');
    if (!LEAGUE_ON) return res.status(400).json({ error: 'This profile has no league site' });
    if (!PROFILE.games.some((g) => g.id === game)) return res.status(400).json({ error: 'Unknown game' });
    await refreshStandings(game, true);
    res.json(leagueMessage().league);
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
    if (MUSIC_TRACK) musicTrack.ensure('music', true, true);
    res.json(musicStatus());
  });

  // --- Panel preference routes ---
  // `saved` is false until a panel has written them once, so the first panel
  // to connect after an upgrade can carry its old browser-storage choices up.
  app.get('/api/prefs', (req, res) => res.json({ prefs: panelPrefs(), saved: !!appSettings.panel }));
  app.post('/api/prefs', (req, res) => res.json({ prefs: savePanelPrefs(req.body || {}), saved: true }));

  // --- Remote control routes (v0.12.0, v2.0.0) ---
  // A Stream Deck (through a web-request plugin or Bitfocus Companion), a
  // macro pad, or a script on this PC can keep score, cut OBS to one of the
  // app's scenes and pick what the Rocket League Stats scene shows, with
  // plain POST requests. The server only listens on this PC, and a request
  // sent by a web page (an Origin other than this app) is refused, so a
  // website open in a browser on the streaming PC can't press these buttons.
  function remoteAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      const u = new URL(origin);
      return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && String(u.port) === String(port);
    } catch (e) {
      return false;
    }
  }
  app.use('/api/remote', (req, res, next) => {
    if (req.method === 'GET') return next();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
    if (!remoteAllowed(req)) return res.status(403).json({ error: 'Requests from web pages are not accepted' });
    next();
  });

  // League graphic scenes are necc-<type> in a URL (necc:<type> inside).
  const remoteKey = (k) => String(k || '').replace(/^necc-/, 'necc:');
  const urlKey = (k) => k.replace(/^necc:/, 'necc-');
  async function remoteScene(key) {
    const k = remoteKey(key);
    if (!obs.status().scenes.some((x) => x.key === k)) {
      return { error: `Unknown scene. Use one of: ${obs.status().scenes.map((x) => urlKey(x.key)).join(', ')}` };
    }
    const r = await obs.switchTo(k);
    return r.switched ? { scene: r.scene } : { error: r.error || 'OBS did not switch' };
  }

  function remoteScore(team, action) {
    const T = team === 'b' ? 'B' : team === 'a' ? 'A' : '';
    const sb = state.scoreboard;
    const total = (Number(sb.crewSize) || 4) * (Number(sb.stocksEach) || 3);
    const score = (k) => Number(sb['score' + k]) || 0;
    const lost = (k) => Number(sb['lost' + k]) || 0;
    const out = {};
    if (action === 'swap') {
      out.swap = !sb.swap;
    } else if (!T) {
      return { error: 'Team must be a or b' };
    } else if (action === 'win') {
      // A game, map or set won: a point, and both crews' stocks refill.
      Object.assign(out, { ['score' + T]: Math.min(9, score(T) + 1), lostA: 0, lostB: 0 });
    } else if (action === 'point') {
      out['score' + T] = Math.min(9, score(T) + 1);
    } else if (action === 'unpoint') {
      out['score' + T] = Math.max(0, score(T) - 1);
    } else if (action === 'stock' || action === 'unstock') {
      if (!sb.showStocks) return { error: 'The stock counter is off for this scoreboard' };
      out['lost' + T] = action === 'stock' ? Math.min(total, lost(T) + 1) : Math.max(0, Math.min(total, lost(T)) - 1);
    } else {
      return { error: 'Unknown score action. Use win, point, unpoint, stock, unstock or swap' };
    }
    applyScore(out);
    broadcastState();
    const s2 = state.scoreboard;
    return { scoreA: s2.scoreA, scoreB: s2.scoreB, lostA: s2.lostA, lostB: s2.lostB, swap: s2.swap };
  }

  function remoteReply(res, out) {
    if (out && out.error) return res.status(400).json(out);
    res.json({ ok: true, ...out });
  }

  app.get('/api/remote', (req, res) => {
    const base = `http://localhost:${port}/api/remote`;
    const scenes = obs.status().scenes.map((x) => x.key);
    res.json({
      note: 'Send each as a POST request from this PC.',
      actions: [
        ...scenes.map((k) => `${base}/scene/${urlKey(k)}`),
        ...(scenes.includes('stats') ? [`${base}/stats/game`, `${base}/stats/series`] : []),
        `${base}/score/a/win`, `${base}/score/b/win`, `${base}/score/a/point`, `${base}/score/a/unpoint`,
        `${base}/score/a/stock`, `${base}/score/a/unstock`, `${base}/score/swap`,
      ],
    });
  });
  app.post('/api/remote/scene/:key', async (req, res) => remoteReply(res, await remoteScene(req.params.key)));
  // v1 Stream Deck buttons (overlay/<view>) now cut to that view's scene.
  app.post('/api/remote/overlay/:view', async (req, res) => remoteReply(res, await remoteScene(req.params.view)));
  // The latest game's stats, or the series overview, on the Stats scene.
  app.post('/api/remote/stats/:screen', async (req, res) => {
    const screen = req.params.screen === 'series' ? 'series' : 'game';
    const r = await showRlStats(screen, -1, true);
    remoteReply(res, r.switched ? { screen } : { error: r.error || 'OBS did not switch' });
  });
  app.post('/api/remote/score/swap', (req, res) => remoteReply(res, remoteScore('', 'swap')));
  app.post('/api/remote/score/:team/:action', (req, res) => remoteReply(res, remoteScore(String(req.params.team).toLowerCase(), String(req.params.action))));

  // --- Rocket League routes ---
  // The panel shows whether the Stats API is turned on in the game's config,
  // and can turn it on (the game reads it at launch, so it needs a restart).
  app.get('/api/rl/status', (req, res) => res.json({ config: rl.config(), feed: rl.snapshot().status }));

  app.post('/api/rl/enable', (req, res) => {
    try { res.json({ config: rl.enable() }); }
    catch (err) { res.status(500).json({ error: err.message || 'Could not update the Rocket League config' }); }
  });

  // --- OBS routes -----------------------------------------------------------
  // The control panel drives OBS through these. The password is only ever
  // sent from the local panel to here over localhost; it is never persisted
  // server-side and never logged.
  app.get('/api/obs/status', (req, res) => res.json({ ...obs.status(), onAirNow: onAir }));

  app.get('/api/obs/inspect', async (req, res) => {
    try { res.json({ ...(await obs.inspect()), stingerFile: stingerInfo() }); }
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

  // Builds (or updates) the league's scene collection: every scene the
  // current options call for, the Scoreboard's game capture, the music
  // source. A stinger the operator already added is re-pointed at the file.
  app.post('/api/obs/build-scenes', async (req, res) => {
    try {
      updateMusic();
      const out = await obs.buildScenes(buildOptions());
      let stinger = null;
      try { stinger = await configureStinger(); } catch (e) { stinger = { found: false, error: e.message }; }
      res.json({ ...out, stinger });
    }
    catch (err) { res.status(502).json({ error: err.message || 'Failed to build scenes' }); }
  });

  // The league's stinger. OBS plays it, and OBS can't read a file inside the
  // app's installed archive, so it is copied to the data folder first.
  function stingerInfo() {
    const st = PROFILE.stinger;
    if (!st) return null;
    return { path: path.join(dataDir, 'obs', st.file), transitionPoint: st.transitionPoint, trackMatte: st.trackMatte, name: `${PROFILE.shortName} Stinger` };
  }
  function copyStinger() {
    const info = stingerInfo();
    if (!info) return null;
    const data = fs.readFileSync(path.join(PROFILE.assetsDir, PROFILE.stinger.file));
    let same = false;
    try { same = fs.statSync(info.path).size === data.length; } catch (e) { /* not copied yet */ }
    if (!same) {
      fs.mkdirSync(path.dirname(info.path), { recursive: true });
      fs.writeFileSync(info.path, data);
    }
    return info;
  }
  async function configureStinger() {
    const info = copyStinger();
    if (!info) return { found: false, none: true };
    const r = await obs.setupStinger({ file: info.path, transitionPoint: info.transitionPoint, trackMatte: info.trackMatte });
    return { ...r, file: info };
  }
  app.get('/api/obs/stinger', async (req, res) => {
    let info = null;
    try { info = copyStinger(); } catch (e) { return res.status(500).json({ error: e.message }); }
    res.json({ file: info, status: await obs.stingerStatus() });
  });
  app.post('/api/obs/stinger', async (req, res) => {
    try { res.json(await configureStinger()); }
    catch (err) { res.status(502).json({ error: err.message || 'Could not set up the stinger' }); }
  });

  // A small picture of what OBS has on program, for the panel.
  app.get('/api/obs/program-shot', async (req, res) => {
    noStore(res);
    res.json({ image: await obs.programShot(Number(req.query.width) || 480), onAir });
  });

  // Put one of the app's scenes on program: { key } (a view, or necc:<type>).
  app.post('/api/obs/switch', async (req, res) => {
    const r = await obs.switchTo(String((req.body || {}).key || ''));
    res.status(r.switched ? 200 : 502).json(r);
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
      if (i === 0) console.log(`${PROFILE.appName} overlay server running on http://localhost:${port}`);
    });
  });
  // Closing the returned server closes every listener.
  const closeFirst = server.close.bind(server);
  server.close = (cb) => { rl.close(); servers.slice(1).forEach((s) => { try { s.close(); } catch (e) {} }); return closeFirst(cb); };
  // For the app as it quits: drops the game feed, and says whether the game
  // was sent its HUD back (main.js then waits a moment before exiting).
  server.releaseGame = () => rl.close();

  // Every page subscribes as a 'panel' (the control panel, in the app window
  // or an OBS dock) or an overlay (every scene's browser source).
  function sendToPanels(obj) {
    const payload = JSON.stringify(obj);
    wss.clients.forEach((client) => {
      if (client.readyState === 1 && client.role === 'panel') client.send(payload);
    });
  }
  function sendToAll(obj) {
    const payload = JSON.stringify(obj);
    wss.clients.forEach((client) => {
      if (client.readyState === 1 && client.role) client.send(payload);
    });
  }
  // The one state, to every page: the scenes redraw, the panels refill.
  function broadcastState() { sendToAll({ type: 'state', data: state }); }
  // The standings show each team as the library has it, so they follow it.
  function broadcastLibrary() { sendToPanels({ type: 'library', library }); }

  // What a panel's edit may not change: OBS decides which view is on air,
  // and the league graphic follows the scene.
  const PROGRAM_FIELDS = ['mode', 'neccType', 'neccUrl'];

  wss.on('connection', (ws) => {
    ws.role = null;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'subscribe') {
        // v1 pages subscribed to a channel: 'draft' was a panel.
        ws.role = msg.role === 'panel' || msg.channel === 'draft' ? 'panel' : 'overlay';
        // First, so a page from an older version reloads before anything else.
        ws.send(JSON.stringify({ type: 'hello', version: APP_VERSION, stamp: PAGE_STAMPS[ws.role] }));
        // Montage status first, so an overlay's first render already knows
        // whether the game's montage can play.
        ws.send(JSON.stringify({ type: 'montages', montages: montages.status() }));
        ws.send(JSON.stringify({ type: 'state', data: state }));
        ws.send(JSON.stringify({ type: 'rl', rl: rl.snapshot() }));
        ws.send(JSON.stringify(rlSeriesMessage()));
        ws.send(JSON.stringify(leagueMessage()));
        if (ws.role === 'panel') {
          ws.send(JSON.stringify({ type: 'library', library }));
          ws.send(JSON.stringify({ type: 'music', music: musicStatus() }));
          ws.send(JSON.stringify({ type: 'prefs', prefs: panelPrefs() }));
          ws.send(JSON.stringify({ type: 'onair', onAir }));
        }
        return;
      }

      // An edit from a panel. It is on every scene at once; the panel only
      // sends text when the operator finishes a field (Enter or leaving it).
      if (msg.type === 'update' && ws.role === 'panel') {
        const data = { ...(msg.data || {}) };
        PROGRAM_FIELDS.forEach((k) => delete data[k]);
        const gameBefore = state.game;
        updateState(data);
        if (state.game !== gameBefore) refreshStandings(state.game).catch(() => {});
        wantMontage(state.game);
        updateRlActive();
        syncLayout();
        broadcastState();
        return;
      }

      // Scoreboard counters (see applyScore).
      if (msg.type === 'score') {
        applyScore(msg.scoreboard);
        broadcastState();
        return;
      }

      // The Rocket League Stats scene: { screen: 'game' | 'series', game,
      // show } picks what it shows, and show also cuts OBS to it.
      if (msg.type === 'rlScreen') {
        showRlStats(msg.screen, Number(msg.game), !!msg.show).catch(() => {});
        return;
      }
      if (msg.type === 'rlSeriesReset') {
        rlSeries = { games: [] };
        writeJsonSafe(rlSeriesFile, rlSeries);
        setRlScreen('game', -1);
      }
    });
  });

  // Resume or start the montages for the games already picked. Only now that
  // the WebSocket server exists to report their progress.
  wantMontage(state.game);
  updateRlActive();
  updateMusic();
  wantMusicTrack(false);
  // The current game's standings now, then every few minutes.
  if (LEAGUE_ON) {
    refreshStandings(state.game).catch(() => {});
    setInterval(() => { refreshStandings(state.game, true).catch(() => {}); }, STANDINGS_EVERY).unref();
  }

  return server;
}

module.exports = { createServer, GAMES, PROFILE };

if (require.main === module) {
  const port = process.env.PORT || PROFILE.port;
  createServer(port);
}
