const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const { importMatch } = require('./necc');
const { createObs } = require('./obs');

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
const SCOREBOARD_POSITIONS = ['top', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
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
  };
}

function normalizeScoreboard(raw) {
  // v0.8.0 files carry `smash` instead: it was always a Smash crew battle, so
  // keep its numbers and label the series in sets with stocks shown.
  const src = raw.scoreboard || (raw.smash ? { unit: 'Set', showStocks: true, ...raw.smash } : {});
  const out = { ...defaultScoreboard(), ...src };
  if (!SCOREBOARD_POSITIONS.includes(out.position)) out.position = 'top';
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
    },
  });

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/control', express.static(CONTROL_DIR));
  // Media the overlay itself loads (stinger transition video, fonts, etc).
  app.use('/overlay-assets', express.static(path.join(__dirname, 'public', 'overlay-assets')));
  app.use('/logos', express.static(logosDir));

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
    try { res.json(await obs.connect(req.body || {})); }
    catch (err) { res.status(502).json({ ...obs.status(), error: err.message || 'Failed to connect to OBS' }); }
  });

  app.post('/api/obs/disconnect', (req, res) => res.json(obs.disconnect()));

  app.post('/api/obs/settings', (req, res) => res.json(obs.setSettings(req.body || {})));

  app.post('/api/obs/build-scenes', async (req, res) => {
    try { res.json(await obs.buildScenes()); }
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
  server.close = (cb) => { servers.slice(1).forEach((s) => { try { s.close(); } catch (e) {} }); return closeFirst(cb); };

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
  function broadcastDirty() { sendToPanels(dirtyMessage()); }
  function broadcastLibrary() { sendToPanels({ type: 'library', library }); }

  wss.on('connection', (ws) => {
    ws.subscribedChannel = null;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'subscribe') {
        ws.subscribedChannel = msg.channel === 'draft' ? 'draft' : 'live';
        ws.send(JSON.stringify({ type: 'state', channel: ws.subscribedChannel, data: ws.subscribedChannel === 'draft' ? draft : live }));
        if (ws.subscribedChannel === 'draft') {
          ws.send(JSON.stringify(dirtyMessage()));
          ws.send(JSON.stringify({ type: 'library', library }));
        }
        return;
      }

      // Every edit - including switching which overlay/mode is showing via
      // the overlay buttons - only ever touches draft. Nothing reaches the
      // stream until an explicit Push Live.
      if (msg.type === 'update') {
        const channel = msg.channel === 'draft' ? 'draft' : 'live';
        const newState = updateChannel(channel, msg.data || {});
        broadcast(channel, newState);
        broadcastDirty();
        return;
      }

      if (msg.type === 'push') {
        const newLive = pushLive();
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

      // Discard the draft: snap the preview (and the control panel form,
      // which repopulates from the draft broadcast) back to the live state.
      if (msg.type === 'revert') {
        const newDraft = revertDraft();
        broadcast('draft', newDraft);
        broadcastDirty();
      }
    });
  });

  return server;
}

module.exports = { createServer, GAMES };

if (require.main === module) {
  const port = process.env.PORT || 4310;
  createServer(port);
}
