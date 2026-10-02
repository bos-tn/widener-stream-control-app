// Widener Esports Stream Control: control panel.
//
// Sections, in order: element refs, shared state, rosters, scoreboard, the
// draft form (gather/populate), WebSocket + push, edit history (undo/redo),
// overlay buttons, NECC import, match + team library, tabs, preview/live
// monitor, keyboard shortcuts, info tooltips, OBS, init.

const $id = (id) => document.getElementById(id);

// --- Element refs ------------------------------------------------------------

const obsUrl = $id('obsUrl');
const copyUrlBtn = $id('copyUrlBtn');

const gameSelect = $id('gameSelect');
const overlaySelect = $id('overlaySelect');
const overlayBtns = $id('overlayBtns');
const switchPushInput = $id('switchPushInput');
const neccOptGroup = $id('neccOptGroup');
const neccBgField = $id('neccBgField');
const neccBgInput = $id('neccBgInput');

const teamInput = $id('teamInput');
const titleInput = $id('titleInput');
const subtitleInput = $id('subtitleInput');
const statusInput = $id('statusInput');
const nextInput = $id('nextInput');

const modeDuration = $id('modeDuration');
const modeAt = $id('modeAt');
const durationField = $id('durationField');
const atField = $id('atField');
const durationInput = $id('durationInput');
const atInput = $id('atInput');
const restartCountdownBtn = $id('restartCountdownBtn');

const twitchInput = $id('twitchInput');
const twitterInput = $id('twitterInput');
const instagramInput = $id('instagramInput');
const youtubeInput = $id('youtubeInput');

const logoInput = $id('logoInput');
const browseLogoBtn = $id('browseLogoBtn');
const logoFile = $id('logoFile');
const clipInput = $id('clipInput');
const browseClipBtn = $id('browseClipBtn');
const clipFile = $id('clipFile');
const montageInput = $id('montageInput');
const layoutField = $id('layoutField');
const layoutInput = $id('layoutInput');

const neccUrlInput = $id('neccUrlInput');
const neccFetchBtn = $id('neccFetchBtn');
const neccStatus = $id('neccStatus');

const scorePanel = $id('scorePanel');
const sbRoundInput = $id('sbRoundInput');
const sbBestOfInput = $id('sbBestOfInput');
const sbUnitInput = $id('sbUnitInput');
const sbPositionInput = $id('sbPositionInput');
const sbCrewInput = $id('sbCrewInput');
const sbStocksInput = $id('sbStocksInput');
const sbShowStocksInput = $id('sbShowStocksInput');
const sbStockFields = $id('sbStockFields');
const sbInstantInput = $id('sbInstantInput');
const sbRefillBtn = $id('sbRefillBtn');
const sbStyleInput = $id('sbStyleInput');
const sbRlFields = $id('sbRlFields');
const sbRlAutoInput = $id('sbRlAutoInput');
const sbRlPlayersInput = $id('sbRlPlayersInput');
const sbRlBoostInput = $id('sbRlBoostInput');
const sbRlColorsInput = $id('sbRlColorsInput');
const sbRlStatsInput = $id('sbRlStatsInput');

const matchSelect = $id('matchSelect');
const matchLoadBtn = $id('matchLoadBtn');
const matchDeleteBtn = $id('matchDeleteBtn');
const matchNameInput = $id('matchNameInput');
const matchSaveBtn = $id('matchSaveBtn');
const libTeamList = $id('libTeamList');

const pushBtn = $id('pushBtn');
const revertBtn = $id('revertBtn');
const undoBtn = $id('undoBtn');
const redoBtn = $id('redoBtn');
const stingerInput = $id('stingerInput');
const pushStatus = $id('pushStatus');
const connDot = $id('connDot');
const connText = $id('connText');

// When OBS scene-sync is active, OBS plays the transition between scenes, so
// the in-overlay curtain stinger is suppressed on push to avoid doubling it.
let obsSceneSyncActive = false;

// --- Shared helpers ------------------------------------------------------------

function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  return isNaN(n) ? dflt : Math.max(lo, Math.min(hi, n));
}

// Same rewrite the overlay does: local file paths are served through the
// app's /media route, since an http page can't load file:// images.
function mediaUrl(s) {
  if (!s) return '';
  s = String(s).trim();
  if (/^file:\/\//i.test(s)) {
    try { s = decodeURIComponent(s.replace(/^file:\/{2,3}/i, '')); } catch (e) {}
    return '/media?src=' + encodeURIComponent(s);
  }
  if (/^[a-zA-Z]:[\\/]/.test(s) || /^\\\\/.test(s)) return '/media?src=' + encodeURIComponent(s);
  return s;
}

function toDatetimeLocalValue(isoString) {
  const d = new Date(isoString);
  if (isNaN(d)) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, v) { try { localStorage.setItem(key, v); } catch (e) {} }

// A destructive button (delete, reset) asks for a second click within 3s
// instead of confirm(), which is unreliable inside an OBS dock.
function armed(btn, label) {
  if (btn.dataset.armedUntil && Date.now() < Number(btn.dataset.armedUntil)) {
    delete btn.dataset.armedUntil;
    btn.textContent = label;
    return true;
  }
  btn.dataset.armedUntil = String(Date.now() + 3000);
  btn.textContent = 'Click again to confirm';
  setTimeout(() => { if (btn.dataset.armedUntil) { delete btn.dataset.armedUntil; btn.textContent = label; } }, 3000);
  return false;
}

function flashText(btn, text, label) {
  btn.textContent = text;
  setTimeout(() => { btn.textContent = label; }, 1500);
}

// --- Shared state ----------------------------------------------------------------

// Fallback text for an overlay that has none saved yet, plus the countdown
// each mode starts from. Only the keys a mode actually defines are applied, so
// a view with no countdown (Be Right Back) leaves the countdown alone instead
// of resetting it.
const MODE_DEFAULTS = {
  'starting-soon': { title: 'Stream Starting Soon', status: 'Starting Soon', durationSec: 600 },
  'post-match': { title: 'Thanks for Watching', status: 'Stream Ending Soon', durationSec: 120 },
  'brb': { title: 'Be Right Back', subtitle: 'Thanks for waiting' },
};

let ws = null;
let games = [];
let currentMode = 'starting-soon';
// Which NECC overlay the draft points at (only meaningful when currentMode is
// 'necc'). Both ride along in every draft update, so switching overlays obeys
// the same preview-then-push flow as any text edit.
let currentNeccUrl = '';
let currentNeccType = '';
let applyingRemote = false;
let receivedInitialDraft = false;
// Set when we ask the server to revert the draft to live - the next draft
// broadcast is the reverted state and should repopulate the whole form.
let repopulateOnNextDraft = false;
let lastPushedAt = null;
// What is on stream right now, from the server's dirty messages. Drives the
// red LIVE dot on the overlay buttons.
let liveMode = '';
let liveNeccType = '';
// The next draft update asks the server to restart the countdown (the
// Restart button, or switching to an overlay with its own countdown). Other
// edits leave a running countdown alone.
let restartPending = false;
let library = { teams: [], matches: [] };

// Per-overlay text, mirroring `state.views` on the server. Each overlay owns
// its own title/subtitle/status pill, so editing text changes only the overlay
// you are currently on. That is what lets an OBS scene-sync source show its
// own wording the moment you switch scenes in OBS, with no Push Live: every
// locked page receives all views in one push and renders its own slice.
let viewTexts = {};

function currentViewText() {
  return { title: titleInput.value, subtitle: subtitleInput.value, status: statusInput.value };
}
// Remember what's typed for the overlay we're leaving, so switching away and
// back doesn't lose it.
function stashViewText() {
  viewTexts[currentMode] = currentViewText();
}
function loadViewText(mode) {
  const saved = viewTexts[mode];
  const t = saved || MODE_DEFAULTS[mode] || {};
  titleInput.value = t.title || '';
  subtitleInput.value = t.subtitle || '';
  statusInput.value = t.status || '';
}
function allViewTexts() {
  return { ...JSON.parse(JSON.stringify(viewTexts)), [currentMode]: currentViewText() };
}

// --- Rosters -------------------------------------------------------------------
//
// The two teams shown in the Rosters overlay and the scoreboard. Fully editable
// by hand (name, tag, colour, logo, players), filled by a NECC fetch, and
// loadable from the team library. Each player is a plain { name, gamertag }.

const DEFAULT_COLORS = { A: '#0054b8', B: '#f0b310' };
function emptyRoster() { return { name: '', tag: '', color: '', colorAlt: '', logoUrl: '', players: [] }; }
let rosterA = emptyRoster();
let rosterB = emptyRoster();
function rosterFor(letter) { return letter === 'A' ? rosterA : rosterB; }
function setRoster(letter, team) { if (letter === 'A') rosterA = team; else rosterB = team; }

// What actually goes in the state payload: drop rows the operator left blank
// so an empty "add player" row never shows up as a nameless slot on stream.
function rosterPayload(team) {
  return {
    name: team.name || '',
    tag: team.tag || '',
    color: team.color || '',
    colorAlt: team.colorAlt || '',
    logoUrl: team.logoUrl || '',
    players: (team.players || [])
      .filter((p) => (p.gamertag && p.gamertag.trim()) || (p.name && p.name.trim()))
      .map((p) => ({ name: p.name || '', gamertag: p.gamertag || '' })),
  };
}

function normalizeRoster(team) {
  if (!team) return emptyRoster();
  return {
    name: team.name || '',
    tag: team.tag || '',
    color: team.color || '',
    colorAlt: team.colorAlt || '',
    logoUrl: team.logoUrl || '',
    players: (team.players || []).map((p) => ({ name: p.name || '', gamertag: p.gamertag || '' })),
  };
}

// NECC import -> editable roster: keep the starters (position >= 0) as rows.
// Subs/coaches are left out by default; the operator can add or rename anyone
// by hand from here.
function neccToRoster(team) {
  if (!team) return emptyRoster();
  return normalizeRoster({ ...team, players: (team.players || []).filter((p) => p.position >= 0) });
}

// <input type=color> only accepts #rrggbb.
function toHex6(c) {
  c = String(c || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(c)) c = c.split('').map((ch) => ch + ch).join('');
  return /^[0-9a-f]{6}$/i.test(c) ? '#' + c.toLowerCase() : '';
}

const rosterEls = {};

// Builds one team's editor once; renderRosterEditor() then fills it.
function buildRosterEditor(letter) {
  const box = $id('rosterEdit' + letter);
  box.innerHTML = `
    <div class="ret-top">
      <select class="ret-lib" aria-label="Load a saved team"></select>
      <button class="btn-secondary ret-save" type="button">Save team</button>
    </div>
    <div class="ret-header">
      <img class="ret-logo" alt="" hidden>
      <input type="text" class="ret-name" placeholder="Team ${letter} name">
      <input type="text" class="ret-tag" placeholder="TAG">
      <input type="color" class="ret-color" title="Team colour (scoreboard and rosters)">
    </div>
    <div class="copy-row">
      <input type="text" class="ret-logo-input" placeholder="Logo URL or image file">
      <button class="btn-secondary ret-browse" type="button">Browse…</button>
      <input type="file" class="ret-logo-file" accept="image/*" hidden>
    </div>
    <div class="ret-players"></div>
    <button class="btn-secondary ret-add" type="button">+ Add player</button>`;
  const els = {
    lib: box.querySelector('.ret-lib'), save: box.querySelector('.ret-save'),
    logo: box.querySelector('.ret-logo'), name: box.querySelector('.ret-name'),
    tag: box.querySelector('.ret-tag'), color: box.querySelector('.ret-color'),
    logoInput: box.querySelector('.ret-logo-input'), browse: box.querySelector('.ret-browse'),
    logoFile: box.querySelector('.ret-logo-file'), players: box.querySelector('.ret-players'),
    add: box.querySelector('.ret-add'),
  };
  rosterEls[letter] = els;

  els.name.addEventListener('input', () => { rosterFor(letter).name = els.name.value; pushDraft(); });
  els.tag.addEventListener('input', () => { rosterFor(letter).tag = els.tag.value; pushDraft(); });
  els.color.addEventListener('input', () => { rosterFor(letter).color = els.color.value; pushDraft(); });
  els.logoInput.addEventListener('input', () => {
    rosterFor(letter).logoUrl = els.logoInput.value.trim();
    renderRosterLogo(letter);
    pushDraft();
  });
  els.browse.addEventListener('click', () => els.logoFile.click());
  els.logoFile.addEventListener('change', () => {
    const f = els.logoFile.files[0];
    if (!f) return;
    els.logoInput.value = f.path || f.name;
    rosterFor(letter).logoUrl = els.logoInput.value;
    renderRosterLogo(letter);
    pushDraft();
  });
  els.add.addEventListener('click', () => {
    rosterFor(letter).players.push({ name: '', gamertag: '' });
    renderRosterEditor(letter);
    const rows = els.players.querySelectorAll('.ret-player');
    const last = rows[rows.length - 1];
    if (last) last.querySelector('.ret-gamertag').focus();
    pushDraft();
  });
  els.lib.addEventListener('change', () => {
    const t = library.teams.find((x) => x.id === els.lib.value);
    els.lib.value = '';
    if (!t) return;
    setRoster(letter, normalizeRoster(t));
    renderRosterEditor(letter);
    pushDraft();
  });
  els.save.addEventListener('click', async () => {
    const team = rosterPayload(rosterFor(letter));
    if (!team.name.trim()) { flashText(els.save, 'Needs a name', 'Save team'); return; }
    try {
      const res = await fetch('/api/library/teams', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(team),
      });
      if (!res.ok) throw new Error();
      flashText(els.save, 'Saved', 'Save team');
    } catch (e) {
      flashText(els.save, 'Save failed', 'Save team');
    }
  });

  // Drag to reorder. Rows only become draggable while the handle is held, so
  // selecting text in a row's inputs still works normally.
  let dragFrom = -1;
  els.players.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.ret-player');
    if (!row) return;
    dragFrom = Array.from(els.players.children).indexOf(row);
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(dragFrom)); } catch (err) {}
  });
  els.players.addEventListener('dragover', (e) => {
    if (dragFrom < 0) return;
    e.preventDefault();
    const row = e.target.closest('.ret-player');
    els.players.querySelectorAll('.drop-above, .drop-below').forEach((r) => r.classList.remove('drop-above', 'drop-below'));
    if (!row) return;
    const r = row.getBoundingClientRect();
    row.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-above' : 'drop-below');
  });
  els.players.addEventListener('drop', (e) => {
    if (dragFrom < 0) return;
    e.preventDefault();
    const rows = Array.from(els.players.children);
    const row = e.target.closest('.ret-player');
    let to = row ? rows.indexOf(row) : rows.length - 1;
    if (row) {
      const r = row.getBoundingClientRect();
      if (e.clientY >= r.top + r.height / 2) to += 1;
    }
    const list = rosterFor(letter).players;
    const [moved] = list.splice(dragFrom, 1);
    if (to > dragFrom) to -= 1;
    list.splice(Math.max(0, Math.min(list.length, to)), 0, moved);
    dragFrom = -1;
    renderRosterEditor(letter);
    pushDraft();
  });
  els.players.addEventListener('dragend', () => {
    dragFrom = -1;
    els.players.querySelectorAll('.ret-player').forEach((r) => {
      r.draggable = false;
      r.classList.remove('dragging', 'drop-above', 'drop-below');
    });
  });
}

function renderRosterLogo(letter) {
  const team = rosterFor(letter);
  const els = rosterEls[letter];
  if (team.logoUrl) { els.logo.src = mediaUrl(team.logoUrl); els.logo.hidden = false; }
  else { els.logo.removeAttribute('src'); els.logo.hidden = true; }
}

function buildPlayerRow(letter, player) {
  const team = rosterFor(letter);
  const row = document.createElement('div');
  row.className = 'ret-player';
  const handle = document.createElement('span');
  handle.className = 'ret-handle';
  handle.title = 'Drag to reorder';
  handle.textContent = '⋮⋮';
  handle.addEventListener('mousedown', () => { row.draggable = true; });
  handle.addEventListener('mouseup', () => { row.draggable = false; });
  const gt = document.createElement('input');
  gt.type = 'text'; gt.className = 'ret-gamertag'; gt.placeholder = 'Gamertag'; gt.value = player.gamertag || '';
  const rn = document.createElement('input');
  rn.type = 'text'; rn.className = 'ret-realname'; rn.placeholder = 'Real name (optional)'; rn.value = player.name || '';
  const rm = document.createElement('button');
  rm.type = 'button'; rm.className = 'ret-remove'; rm.title = 'Remove player'; rm.textContent = '×';
  gt.addEventListener('input', () => { player.gamertag = gt.value; pushDraft(); });
  rn.addEventListener('input', () => { player.name = rn.value; pushDraft(); });
  rm.addEventListener('click', () => {
    const idx = team.players.indexOf(player);
    if (idx >= 0) team.players.splice(idx, 1);
    renderRosterEditor(letter);
    pushDraft();
  });
  row.append(handle, gt, rn, rm);
  return row;
}

function renderRosterEditor(letter) {
  const team = rosterFor(letter);
  const els = rosterEls[letter];
  els.name.value = team.name || '';
  els.tag.value = team.tag || '';
  els.color.value = toHex6(team.color) || DEFAULT_COLORS[letter];
  els.logoInput.value = team.logoUrl || '';
  renderRosterLogo(letter);
  els.players.innerHTML = '';
  team.players.forEach((p) => els.players.appendChild(buildPlayerRow(letter, p)));
}

// --- Scoreboard --------------------------------------------------------------------
//
// One scoreboard for every game. Series score always; the Smash crew-battle
// stock counter when turned on. Stocks are tracked as a count lost per team;
// the overlay derives who is on stage from it (crew order = Rosters order).
// Counter changes go straight to live by default (see applyScore in
// server.js): a stock or a map is won in real time, and waiting on Push Live
// plus a curtain wipe for each one would be unusable.

const SB_COUNTERS = ['scoreA', 'scoreB', 'lostA', 'lostB', 'swap'];
function defaultScoreboard() {
  return {
    round: '', unit: 'Game', bestOf: 3, scoreA: 0, scoreB: 0, crewSize: 4, stocksEach: 3, lostA: 0, lostB: 0, showStocks: false, swap: false, position: 'top',
    style: 'standard', rlAutoSeries: true, rlPlayers: true, rlBoost: true, rlGameColors: true, rlAutoStats: true,
  };
}
let scoreboard = defaultScoreboard();

function scoreboardConfig() {
  return {
    round: sbRoundInput.value,
    unit: sbUnitInput.value || 'Game',
    bestOf: clampInt(sbBestOfInput.value, 1, 9, 3),
    position: sbPositionInput.value || 'top',
    crewSize: clampInt(sbCrewInput.value, 1, 8, 4),
    stocksEach: clampInt(sbStocksInput.value, 1, 5, 3),
    showStocks: sbShowStocksInput.checked,
    style: sbStyleInput.value === 'rl' ? 'rl' : 'standard',
    rlAutoSeries: sbRlAutoInput.checked,
    rlPlayers: sbRlPlayersInput.checked,
    rlBoost: sbRlBoostInput.checked,
    rlGameColors: sbRlColorsInput.checked,
    rlAutoStats: sbRlStatsInput.checked,
  };
}
function setScoreboardConfig(c) {
  sbRoundInput.value = c.round || '';
  sbUnitInput.value = ['Game', 'Map', 'Set', 'Round'].includes(c.unit) ? c.unit : 'Game';
  sbBestOfInput.value = String(c.bestOf || 3);
  sbPositionInput.value = c.position || 'top';
  sbCrewInput.value = c.crewSize || 4;
  sbStocksInput.value = c.stocksEach || 3;
  sbShowStocksInput.checked = c.showStocks === true;
  sbStyleInput.value = c.style === 'rl' ? 'rl' : 'standard';
  sbRlAutoInput.checked = c.rlAutoSeries !== false;
  sbRlPlayersInput.checked = c.rlPlayers !== false;
  sbRlBoostInput.checked = c.rlBoost !== false;
  sbRlColorsInput.checked = c.rlGameColors !== false;
  sbRlStatsInput.checked = c.rlAutoStats !== false;
}
function scoreboardCounters() {
  const out = {};
  SB_COUNTERS.forEach((k) => { out[k] = scoreboard[k]; });
  return out;
}
function syncCounters(remote) {
  if (!remote) return;
  let changed = false;
  SB_COUNTERS.forEach((k) => {
    if (remote[k] !== undefined && remote[k] !== scoreboard[k]) { scoreboard[k] = remote[k]; changed = true; }
  });
  if (changed) renderScorePanel();
}

function buildScoreSide(t) {
  $id('sbSide' + t).innerHTML = `
    <div class="sb-side-head"><span class="sb-side-name" id="sbName${t}">Team ${t}</span><span class="sb-side-stock sb-stock-only" id="sbStock${t}"></span></div>
    <div class="sb-side-onstage sb-stock-only" id="sbOn${t}"></div>
    <div class="sb-btns sb-stock-only">
      <button class="sb-big" type="button" data-sb="lose" data-team="${t}">Lost a stock</button>
      <button class="btn-secondary" type="button" data-sb="undo" data-team="${t}">Undo</button>
    </div>
    <div class="sb-score-row">
      <span class="lbl" id="sbWonLbl${t}">Games won</span>
      <button class="btn-secondary sb-step" type="button" data-sb="score-" data-team="${t}" aria-label="Remove a point">&minus;</button>
      <b class="sb-score-val" id="sbScore${t}">0</b>
      <button class="btn-secondary sb-step" type="button" data-sb="score+" data-team="${t}" aria-label="Add a point">+</button>
      <button class="btn-secondary sb-win" type="button" data-sb="win" data-team="${t}" id="sbWin${t}">Won game</button>
    </div>`;
}

function renderScorePanel() {
  const { crewSize, stocksEach, unit, style } = scoreboardConfig();
  const isRl = style === 'rl';
  // Rocket League has no stocks and always uses the full top bar.
  const showStocks = scoreboardConfig().showStocks && !isRl;
  const total = crewSize * stocksEach;
  scorePanel.classList.toggle('no-stocks', !showStocks);
  sbStockFields.style.display = showStocks ? '' : 'none';
  sbRefillBtn.style.display = showStocks ? '' : 'none';
  sbRlFields.style.display = isRl ? '' : 'none';
  $id('sbShowStocksField').style.display = isRl ? 'none' : '';
  $id('sbPositionField').style.visibility = isRl ? 'hidden' : '';
  renderRlStatus();
  ['A', 'B'].forEach((t) => {
    const team = rosterPayload(rosterFor(t));
    const lost = Math.min(scoreboard['lost' + t] || 0, total);
    const left = total - lost;
    $id('sbName' + t).textContent = team.name || `Team ${t}`;
    $id('sbStock' + t).innerHTML = `<b>${left}</b> / ${total} stocks`;
    $id('sbScore' + t).textContent = String(scoreboard['score' + t] || 0);
    $id('sbWonLbl' + t).textContent = `${unit}s won`;
    $id('sbWin' + t).textContent = `Won ${unit.toLowerCase()}`;
    const on = $id('sbOn' + t);
    if (left <= 0) {
      on.textContent = 'Out of stocks';
    } else {
      const idx = Math.floor(lost / stocksEach);
      const p = team.players[idx] || {};
      const name = p.gamertag || p.name || `Player ${idx + 1}`;
      const theirs = stocksEach - (lost % stocksEach);
      on.innerHTML = 'On stage: <b></b>';
      on.querySelector('b').textContent = `${name} (${theirs} left)`;
    }
    scorePanel.querySelector(`[data-sb="lose"][data-team="${t}"]`).disabled = left <= 0;
    scorePanel.querySelector(`[data-sb="undo"][data-team="${t}"]`).disabled = lost <= 0;
  });
}

// Instant: straight to live and preview. Otherwise it is an ordinary draft
// edit that waits for Push Live like everything else.
function sendScore() {
  renderScorePanel();
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (sbInstantInput.checked) {
    ws.send(JSON.stringify({ type: 'score', scoreboard: scoreboardCounters() }));
  } else {
    ws.send(JSON.stringify({ type: 'update', channel: 'draft', data: { scoreboard: scoreboardCounters() } }));
  }
}

const SB_INSTANT_KEY = 'widener-smash-instant';
sbInstantInput.checked = lsGet(SB_INSTANT_KEY) !== 'off';
sbInstantInput.addEventListener('change', () => lsSet(SB_INSTANT_KEY, sbInstantInput.checked ? 'on' : 'off'));

function scoreAction(action, t, btn) {
  const { crewSize, stocksEach, showStocks } = scoreboardConfig();
  const total = crewSize * stocksEach;
  switch (action) {
    case 'lose':
      if (!showStocks) return;
      scoreboard['lost' + t] = Math.min(total, (scoreboard['lost' + t] || 0) + 1); break;
    case 'undo':
      if (!showStocks) return;
      scoreboard['lost' + t] = Math.max(0, Math.min(total, scoreboard['lost' + t] || 0) - 1); break;
    case 'score+': scoreboard['score' + t] = Math.min(9, (scoreboard['score' + t] || 0) + 1); break;
    case 'score-': scoreboard['score' + t] = Math.max(0, (scoreboard['score' + t] || 0) - 1); break;
    // A game/map/set is over: point to the winner, and both crews refill
    // their stocks for the next set.
    case 'win':
      scoreboard['score' + t] = Math.min(9, (scoreboard['score' + t] || 0) + 1);
      scoreboard.lostA = 0; scoreboard.lostB = 0;
      break;
    case 'refill': scoreboard.lostA = 0; scoreboard.lostB = 0; break;
    case 'swap': scoreboard.swap = !scoreboard.swap; break;
    case 'reset':
      if (btn && !armed(btn, 'Reset match')) return;
      Object.assign(scoreboard, { scoreA: 0, scoreB: 0, lostA: 0, lostB: 0, swap: false });
      // A new match also starts a new Rocket League series record.
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'rlSeriesReset' }));
      break;
    default: return;
  }
  if (t) {
    const side = $id('sbSide' + t);
    side.classList.remove('flash'); void side.offsetWidth; side.classList.add('flash');
  }
  sendScore();
}

scorePanel.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-sb]');
  if (btn) scoreAction(btn.dataset.sb, btn.dataset.team, btn);
});

// --- Rocket League game connection (v0.11.0) -------------------------------
//
// The server reads Rocket League's Stats API (rlstats.js) and sends every
// page {type:'rl'} snapshots. Here they only drive the status box: whether
// the game is connected, whether the API is turned on in the game's config
// (with a button to turn it on), and a hint when the teams look swapped.

const rlStatusBox = $id('rlStatus');
const rlDot = $id('rlDot');
const rlText = $id('rlText');
const rlSub = $id('rlSub');
const rlEnableBtn = $id('rlEnableBtn');
const rlSwapHintBtn = $id('rlSwapHintBtn');
let rlSnap = null;
let rlConfig = null;
let rlNote = '';
let rlNoteTimer = 0;
let rlConfigAt = 0;

function fmtClock(sec, overtime) {
  sec = Math.max(0, Math.round(sec || 0));
  return (overtime ? '+' : '') + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

// Which roster team the in-game blue players belong to, judged by matching
// in-game names against roster gamertags. null when nothing matches.
function rlBlueTeam() {
  if (!rlSnap || !rlSnap.inMatch) return null;
  const norm = (s) => String(s || '').trim().toLowerCase();
  const tags = (t) => new Set(rosterPayload(rosterFor(t)).players.flatMap((p) => [norm(p.gamertag), norm(p.name)]).filter(Boolean));
  const a = tags('A'), b = tags('B');
  let score = 0;
  rlSnap.players.forEach((p) => {
    const n = norm(p.name);
    const sign = p.team === 0 ? 1 : -1;
    if (a.has(n)) score += sign;
    if (b.has(n)) score -= sign;
  });
  return score > 0 ? 'A' : score < 0 ? 'B' : null;
}

function refreshRlConfig(force) {
  if (!force && Date.now() - rlConfigAt < 8000) return;
  rlConfigAt = Date.now();
  fetch('/api/rl/status').then((r) => r.json()).then((st) => { rlConfig = st.config; renderRlStatus(); }).catch(() => {});
}

function renderRlStatus() {
  const isRl = sbStyleInput.value === 'rl';
  rlStatusBox.hidden = !isRl;
  if (!isRl) return;
  const st = rlSnap ? rlSnap.status : 'off';
  let dot = '', text, sub = '';
  let canEnable = false;
  if (st === 'connected' && rlSnap.inMatch) {
    dot = 'connected';
    const [blue, orange] = rlSnap.teams;
    text = `In a match: Blue ${blue ? blue.score : 0} - ${orange ? orange.score : 0} Orange, ${fmtClock(rlSnap.clock, rlSnap.overtime)}`;
    if (!rlSnap.target) sub = 'No player is being followed, so the boost meter is hidden. Spectate a player to show it.';
  } else if (st === 'connected') {
    dot = 'connected';
    text = 'Connected to Rocket League';
    sub = 'Waiting for a match. Join or spectate one and the board fills in.';
  } else {
    dot = 'warn';
    text = 'Waiting for Rocket League';
    refreshRlConfig();
    if (rlConfig && !rlConfig.path) {
      sub = 'Rocket League\'s settings folder was not found on this PC. Launch the game once, then check again.';
    } else if (rlConfig && !rlConfig.enabled) {
      dot = '';
      text = 'The Stats API is turned off in Rocket League';
      sub = 'Turn it on below, then restart Rocket League. The game only reads this setting when it starts.';
      canEnable = true;
    } else {
      sub = 'Start Rocket League and it connects by itself. If the game was already running when the Stats API was turned on, restart it.';
    }
  }
  if (rlNote) sub = rlNote;
  rlDot.className = 'dot' + (dot ? ' ' + dot : '');
  rlText.textContent = text;
  rlSub.textContent = sub;
  rlEnableBtn.hidden = !canEnable;
  // The left (blue) side is team A unless swapped. Offer a swap when the
  // roster names say the other team is on blue.
  const blue = rlBlueTeam();
  const shownBlue = scoreboard.swap ? 'B' : 'A';
  rlSwapHintBtn.hidden = !blue || blue === shownBlue;
  if (!rlSwapHintBtn.hidden) {
    const name = rosterPayload(rosterFor(blue)).name || `Team ${blue}`;
    rlSwapHintBtn.textContent = `${name} is on blue: swap sides`;
  }
}

function showRlNote(text) {
  rlNote = text;
  clearTimeout(rlNoteTimer);
  rlNoteTimer = setTimeout(() => { rlNote = ''; renderRlStatus(); }, 12000);
  renderRlStatus();
}

rlEnableBtn.addEventListener('click', () => {
  rlEnableBtn.disabled = true;
  fetch('/api/rl/enable', { method: 'POST' })
    .then((r) => r.json())
    .then((res) => {
      if (res.error) { showRlNote(res.error); return; }
      rlConfig = res.config;
      showRlNote('Turned on. Restart Rocket League (fully close it first) and it will connect.');
    })
    .catch(() => showRlNote('Could not reach the app server.'))
    .finally(() => { rlEnableBtn.disabled = false; });
});

rlSwapHintBtn.addEventListener('click', () => scoreAction('swap'));

// Which screen the board shows (live game, a game's stats, the series
// overview). The server switches these by itself around each game; these
// buttons do it by hand. They act on stream immediately, like the score.
let rlSeries = { games: [] };
let rlScreen = { screen: 'live', game: -1 };
const rlGamePick = $id('rlGamePick');
function renderRlScreens() {
  const games = rlSeries.games || [];
  const want = rlScreen.screen === 'game' ? rlScreen.game : games.length - 1;
  rlGamePick.innerHTML = '';
  games.forEach((g, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `Game ${i + 1}: ${g.goals[0]}-${g.goals[1]}`;
    rlGamePick.appendChild(o);
  });
  if (games.length) rlGamePick.value = String(Math.max(0, want));
  rlGamePick.hidden = !games.length;
  document.querySelectorAll('[data-rls]').forEach((b) => {
    b.classList.toggle('on', b.dataset.rls === rlScreen.screen);
    b.disabled = b.dataset.rls === 'game' && !games.length;
  });
}
function sendRlScreen(screen) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'rlScreen', screen, game: Number(rlGamePick.value || -1) }));
}
document.querySelectorAll('[data-rls]').forEach((b) => b.addEventListener('click', () => sendRlScreen(b.dataset.rls)));
rlGamePick.addEventListener('change', () => sendRlScreen('game'));

// Per-game presets (games.json): picking a game loads that game's scoreboard
// settings into the draft. Counters are left alone.
// A series length from a NECC import wins over the game's preset, so picking
// the game after fetching the match doesn't undo it. Changing Best of by hand
// clears it.
let neccBestOf = null;
function applyGamePreset(gameId) {
  const g = games.find((x) => x.id === gameId);
  if (!g || !g.scoreboard) return;
  setScoreboardConfig({ ...defaultScoreboard(), ...g.scoreboard, ...(neccBestOf ? { bestOf: neccBestOf } : {}) });
  renderScorePanel();
}
sbBestOfInput.addEventListener('change', () => { neccBestOf = null; });

// --- Draft form -------------------------------------------------------------------

function updateUrlDisplay() {
  obsUrl.value = `${location.origin}/overlay`;
  const dockUrl = $id('dockUrl');
  if (dockUrl) dockUrl.value = `${location.origin}/control`;
}

function toggleLayoutVisibility() {
  layoutField.style.display = currentMode === 'post-match' ? '' : 'none';
  // The stripe-backdrop toggle only means anything while a NECC overlay is up.
  neccBgField.style.display = currentMode === 'necc' ? '' : 'none';
  // Scoring controls show while the scoreboard is being previewed or is live,
  // so the score can be kept while a different overlay is being prepared.
  const isBoard = currentMode === 'scoreboard';
  scorePanel.style.display = (isBoard || liveMode === 'scoreboard') ? '' : 'none';
  // The scoreboard has no headline, subtitle, pill or countdown, so hide the
  // fields that would do nothing while it's selected.
  ['titleField', 'subtitleField', 'statusField', 'countdownPanel'].forEach((id) => {
    $id(id).style.display = isBoard ? 'none' : '';
  });
}

// The complete draft this form represents. Pure: it does not consume the
// countdown restart flag (sendDraft does), so history snapshots can use it.
function buildDraft() {
  const data = {
    mode: currentMode,
    neccUrl: currentNeccUrl,
    neccType: currentNeccType,
    neccBg: neccBgInput.checked,
    game: gameSelect.value,
    team: teamInput.value,
    title: titleInput.value,
    subtitle: subtitleInput.value,
    status: statusInput.value,
    next: nextInput.value,
    logo: logoInput.value,
    clip: clipInput.value,
    montage: montageInput.checked,
    layout: layoutInput.value,
    socials: {
      twitch: twitchInput.value,
      twitter: twitterInput.value,
      instagram: instagramInput.value,
      youtube: youtubeInput.value,
    },
    // Only the overlay being edited is sent; the server merges it over the
    // other views so their text survives.
    views: { [currentMode]: currentViewText() },
    // Scoreboard settings only. The live counters (stocks, series score,
    // swap) are deliberately NOT here: they change through sendScore() alone,
    // so a second open panel (e.g. the app window plus an OBS dock) can never
    // overwrite the real score with its own stale copy.
    scoreboard: scoreboardConfig(),
  };
  if (modeAt.checked && atInput.value) {
    data.countdownMode = 'at';
    data.end = new Date(atInput.value).toISOString();
  } else {
    data.countdownMode = 'duration';
    data.durationSec = parseInt(durationInput.value || '0', 10);
  }
  data.teamA = rosterPayload(rosterA);
  data.teamB = rosterPayload(rosterB);
  return data;
}

function populateForm(state) {
  applyingRemote = true;
  currentMode = state.mode === 'smash' ? 'scoreboard' : (state.mode || 'starting-soon');
  currentNeccUrl = state.neccUrl || '';
  currentNeccType = state.neccType || '';
  if (currentMode === 'necc' && currentNeccType) {
    // Make sure the saved NECC type has an option to select, even if the
    // operator has since unchecked it in settings - the buttons should
    // always reflect what the draft is actually showing.
    if (!Array.from(overlaySelect.options).some((o) => o.value === `necc:${currentNeccType}`)) {
      const t = NECC_TYPES.find((x) => x.key === currentNeccType);
      const opt = document.createElement('option');
      opt.value = `necc:${currentNeccType}`;
      opt.textContent = t ? t.label : currentNeccType;
      neccOptGroup.appendChild(opt);
    }
    overlaySelect.value = `necc:${currentNeccType}`;
  } else {
    overlaySelect.value = `widener:${currentMode}`;
  }
  neccBgInput.checked = state.neccBg !== false;
  rosterA = normalizeRoster(state.teamA);
  rosterB = normalizeRoster(state.teamB);
  renderRosterEditor('A');
  renderRosterEditor('B');
  teamInput.value = state.team || '';
  // Seed every overlay's saved text, then show the one we're currently on.
  // Falls back to the shared top-level fields for a state file written before
  // per-view text existed.
  viewTexts = JSON.parse(JSON.stringify(state.views || {}));
  if (!viewTexts[currentMode]) {
    viewTexts[currentMode] = { title: state.title || '', subtitle: state.subtitle || '', status: state.status || '' };
  }
  loadViewText(currentMode);
  nextInput.value = state.next || '';
  logoInput.value = state.logo || '';
  clipInput.value = state.clip || '';
  montageInput.checked = state.montage !== false;
  layoutInput.value = state.layout || 'right';
  const socials = state.socials || {};
  twitchInput.value = socials.twitch || '';
  twitterInput.value = socials.twitter || '';
  instagramInput.value = socials.instagram || '';
  youtubeInput.value = socials.youtube || '';
  const isAt = state.countdownMode === 'at';
  modeAt.checked = isAt;
  modeDuration.checked = !isAt;
  durationField.style.display = isAt ? 'none' : '';
  atField.style.display = isAt ? '' : 'none';
  if (isAt && state.end) atInput.value = toDatetimeLocalValue(state.end);
  else if (!isAt) durationInput.value = state.durationSec || '';
  const match = games.find((g) => g.name === state.game || g.id === state.game);
  gameSelect.value = match ? match.id : '';
  renderMontages();
  // A full state carries the counters; an undo snapshot or saved match
  // doesn't, and then the current score is kept.
  scoreboard = { ...defaultScoreboard(), ...scoreboardCounters(), ...(state.scoreboard || {}) };
  setScoreboardConfig(scoreboard);
  toggleLayoutVisibility();
  renderScorePanel();
  renderOverlayButtons();
  applyingRemote = false;
}

// --- WebSocket + push ---------------------------------------------------------------

function setConnStatus(connected) {
  connDot.classList.toggle('connected', connected);
  connText.textContent = connected ? 'Connected' : 'Reconnecting…';
}

function sendDraft(data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (restartPending) { data.restartCountdown = true; restartPending = false; }
  ws.send(JSON.stringify({ type: 'update', channel: 'draft', data }));
  recordHistory();
}

let draftDebounce = null;
function pushDraft() {
  // Roster names/crew size feed the scoreboard panel's "on stage" readout.
  renderScorePanel();
  if (applyingRemote) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  clearTimeout(draftDebounce);
  draftDebounce = setTimeout(() => sendDraft(buildDraft()), 150);
}

// Immediate (undebounced) draft update - used for discrete actions like
// switching overlays, where the preview should react instantly.
function sendDraftNow() {
  if (applyingRemote) return;
  clearTimeout(draftDebounce);
  sendDraft(buildDraft());
}

// "Unpushed changes" indicator, driven by the server comparing draft vs live.
function setDirty(dirty) {
  pushBtn.classList.toggle('dirty', dirty);
  revertBtn.disabled = !dirty;
  if (dirty) {
    pushStatus.textContent = 'Preview has unpushed changes';
  } else {
    pushStatus.textContent = lastPushedAt ? `Pushed live at ${lastPushedAt}` : 'Preview matches live';
  }
}

function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.addEventListener('open', () => {
    setConnStatus(true);
    ws.send(JSON.stringify({ type: 'subscribe', channel: 'draft' }));
    // On a reconnect (not first connect), the form is the source of truth -
    // re-send it so edits made while disconnected aren't silently lost.
    if (receivedInitialDraft) sendDraft(buildDraft());
  });
  ws.addEventListener('close', () => {
    setConnStatus(false);
    setTimeout(connect, 1500);
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    // Only sync the form from the server on first connect (restoring the
    // draft from last time) or right after asking for a revert. Otherwise
    // this panel is the only writer to "draft" - applying our own broadcast
    // echoes back onto the form would race live edits.
    if (msg.type === 'state' && msg.channel === 'draft') {
      if (!receivedInitialDraft || repopulateOnNextDraft) {
        const first = !receivedInitialDraft;
        receivedInitialDraft = true;
        repopulateOnNextDraft = false;
        populateForm(msg.data);
        if (first) resetHistory(); else recordHistory(true);
      } else {
        // Scoreboard counters are server-authoritative: always follow them,
        // so every open panel shows the same score.
        syncCounters(msg.data.scoreboard);
      }
    }
    if (msg.type === 'dirty') {
      setDirty(msg.dirty);
      liveMode = msg.liveMode || '';
      liveNeccType = msg.liveNeccType || '';
      renderOverlayButtons();
      toggleLayoutVisibility();
    }
    if (msg.type === 'rl') {
      const was = rlSnap;
      rlSnap = msg.rl;
      // Snapshots arrive up to 30 times a second; the status box only needs
      // redrawing when something it shows has changed.
      const key = (s) => s ? [s.status, s.inMatch, s.clock, s.overtime, s.target, (s.teams || []).map((t) => t.score).join('-'), (s.players || []).map((p) => p.team + p.name).join()].join('|') : '';
      if (key(was) !== key(rlSnap)) renderRlStatus();
    }
    if (msg.type === 'music') renderMusic(msg.music);
    if (msg.type === 'rlSeries') {
      rlSeries = msg.series || { games: [] };
      rlScreen = msg.screen || { screen: 'live', game: -1 };
      renderRlScreens();
    }
    if (msg.type === 'rlEvent' && msg.event && msg.event.type === 'matchEnded' && msg.event.series) {
      const t = msg.event.series;
      const name = rosterPayload(rosterFor(t)).name || `Team ${t}`;
      const side = $id('sbSide' + t);
      side.classList.remove('flash'); void side.offsetWidth; side.classList.add('flash');
      showRlNote(`Game over: ${name} won, and the series score was updated. Use + or \u2212 to correct it.`);
    }
    if (msg.type === 'montages') {
      montageStatus = msg.montages || {};
      renderMontages();
    }
    if (msg.type === 'library') {
      library = msg.library || { teams: [], matches: [] };
      renderLibrary();
    }
  });
}

// Whether Push Live plays the curtain stinger on the live overlay. Persisted
// locally - it's an operator preference, not overlay content.
const STINGER_KEY = 'widener-stinger-on-push';
stingerInput.checked = lsGet(STINGER_KEY) !== 'off';
stingerInput.addEventListener('change', () => lsSet(STINGER_KEY, stingerInput.checked ? 'on' : 'off'));

function doPush() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  clearTimeout(draftDebounce);
  sendDraft(buildDraft());
  // In scene-sync mode OBS owns the transition, so don't also flag the
  // in-overlay curtain wipe (it would double up / play in the preview only).
  const useStinger = stingerInput.checked && !obsSceneSyncActive;
  ws.send(JSON.stringify({ type: 'push', transition: useStinger ? 'stinger' : undefined }));
  lastPushedAt = new Date().toLocaleTimeString();
  pushStatus.textContent = `Pushed live at ${lastPushedAt}`;
}
pushBtn.addEventListener('click', doPush);

revertBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  clearTimeout(draftDebounce);
  repopulateOnNextDraft = true;
  ws.send(JSON.stringify({ type: 'revert' }));
});

gameSelect.addEventListener('change', () => {
  const g = games.find((x) => x.id === gameSelect.value);
  if (g) teamInput.value = g.name;
  applyGamePreset(gameSelect.value);
  pushDraft();
  renderMontages();
});

// --- Game montages (v0.10.0) ---------------------------------------------
// The server downloads each game's montage from Drive on demand (montages.js)
// and broadcasts progress; this only displays it and asks for downloads.
let montageStatus = {};
const montageList = $id('montageList');
const gameMontageStatus = $id('gameMontageStatus');

function fmtGB(bytes) { return (bytes / 1e9).toFixed(2) + ' GB'; }

function montageText(m) {
  if (m.have) return 'Ready';
  if (m.downloading) return `Downloading ${Math.floor(100 * m.received / m.bytes)}% of ${fmtGB(m.bytes)}`;
  if (m.queued) return 'Waiting to download';
  if (m.error) return 'Failed: ' + m.error;
  if (m.received > 0) return `Paused at ${Math.floor(100 * m.received / m.bytes)}%`;
  return `Not downloaded (${fmtGB(m.bytes)})`;
}

function requestMontage(game) {
  fetch('/api/montages/download', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(game ? { game } : {}),
  }).catch(() => {});
}

function renderMontages() {
  // Status line under the Game picker, for the selected game only.
  const game = gameSelect.value;
  const m = montageStatus[game];
  if (!game) gameMontageStatus.textContent = '';
  else if (!m) gameMontageStatus.textContent = 'No montage for this game.';
  else gameMontageStatus.textContent = clipInput.value.trim()
    ? 'Montage: the clip under Media replaces it.'
    : 'Montage: ' + montageText(m);
  gameMontageStatus.classList.toggle('error', !!(m && m.error && !m.have));

  // Setup tab list.
  montageList.innerHTML = '';
  let have = 0; let total = 0;
  games.forEach((g) => {
    const st = montageStatus[g.id];
    if (!st) return;
    total++;
    if (st.have) have++;
    const row = document.createElement('div');
    row.className = 'lib-row';
    const name = document.createElement('span');
    name.className = 'lib-name';
    name.textContent = g.name;
    const meta = document.createElement('span');
    meta.className = 'lib-meta';
    meta.textContent = montageText(st);
    if (st.error && !st.have) meta.title = st.error;
    row.append(name, meta);
    if (!st.have && !st.downloading && !st.queued) {
      const btn = document.createElement('button');
      btn.className = 'btn-secondary lib-del';
      btn.type = 'button';
      btn.textContent = st.error ? 'Retry' : 'Download';
      btn.addEventListener('click', () => requestMontage(g.id));
      row.appendChild(btn);
    }
    montageList.appendChild(row);
  });
  $id('montageTotal').textContent = total ? `${have} of ${total} on this PC` : '';
  $id('montageAllBtn').disabled = have === total;
}

$id('montageAllBtn').addEventListener('click', () => requestMontage(''));
clipInput.addEventListener('input', renderMontages);

copyUrlBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(obsUrl.value).then(() => flashText(copyUrlBtn, 'Copied!', 'Copy'));
});

[modeDuration, modeAt].forEach((el) => el.addEventListener('change', () => {
  durationField.style.display = modeDuration.checked ? '' : 'none';
  atField.style.display = modeAt.checked ? '' : 'none';
  pushDraft();
}));

restartCountdownBtn.addEventListener('click', () => {
  if (modeAt.checked) return;
  restartPending = true;
  sendDraftNow();
  flashText(restartCountdownBtn, 'Restarted in preview', 'Restart countdown');
});

// Push a draft update on any text/checkbox/select change anywhere in the settings column.
document.querySelector('.settings-col').addEventListener('input', pushDraft);
document.querySelector('.settings-col').addEventListener('change', pushDraft);

// Browse buttons: use a hidden <input type=file>. Electron exposes the full
// local path via file.path for any renderer, so this fills in a real
// filesystem path when running inside the packaged app; in a plain browser
// (e.g. during dev) it falls back to just the file name.
function wireBrowse(button, fileInput, textInput) {
  button.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (!f) return;
    textInput.value = f.path || f.name;
    pushDraft();
  });
}
wireBrowse(browseLogoBtn, logoFile, logoInput);
wireBrowse(browseClipBtn, clipFile, clipInput);

// --- Edit history (undo / redo) -----------------------------------------------------
//
// Snapshots of the whole form (all overlays' text included). Quick edits in a
// row, like typing a word, are grouped into one step: a new step starts when
// there has been a pause of more than HISTORY_GAP_MS. Scoreboard counters are
// not part of it; the scoreboard has its own Undo buttons.

const HISTORY_GAP_MS = 1200;
const HISTORY_MAX = 100;
let undoStack = [];
let redoStack = [];
let currentSnap = null;
let lastEditAt = 0;

function formSnapshot() {
  return JSON.stringify({ ...buildDraft(), views: allViewTexts() });
}

function updateHistoryButtons() {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

function resetHistory() {
  undoStack = []; redoStack = [];
  currentSnap = formSnapshot();
  lastEditAt = 0;
  updateHistoryButtons();
}

function recordHistory(forceNewStep) {
  const snap = formSnapshot();
  if (snap === currentSnap) return;
  const now = Date.now();
  if (currentSnap !== null && (forceNewStep || now - lastEditAt > HISTORY_GAP_MS)) {
    undoStack.push(currentSnap);
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
  }
  redoStack = [];
  currentSnap = snap;
  lastEditAt = forceNewStep ? 0 : now;
  updateHistoryButtons();
}

function restoreSnapshot(snap) {
  const state = JSON.parse(snap);
  populateForm(state);
  currentSnap = snap;
  lastEditAt = 0;
  if (ws && ws.readyState === WebSocket.OPEN) {
    clearTimeout(draftDebounce);
    // Send every overlay's text, not just the current one, so undoing an edit
    // made on another overlay restores it too.
    ws.send(JSON.stringify({ type: 'update', channel: 'draft', data: { ...buildDraft(), views: state.views } }));
  }
  updateHistoryButtons();
}

function undo() {
  clearTimeout(draftDebounce);
  recordHistory();
  if (!undoStack.length) return;
  redoStack.push(currentSnap);
  restoreSnapshot(undoStack.pop());
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(currentSnap);
  restoreSnapshot(redoStack.pop());
}
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

// --- Overlay buttons ------------------------------------------------------------------
//
// Starting Soon, Rosters, Scoreboard, NECC graphics and the rest are ordinary
// draft edits: the preview updates instantly, the stream doesn't change until
// Push Live (or right away with "Push live as soon as I pick an overlay").
// Widener overlays also load their own text and countdown into the form.
// NECC overlays render inside our own /overlay page as a full-bleed iframe,
// so OBS never needs to know anything changed either way.

function isLiveOption(value) {
  const [kind, key] = value.split(':');
  if (kind === 'widener') return liveMode === key;
  return liveMode === 'necc' && liveNeccType === key;
}

function renderOverlayButtons() {
  overlayBtns.innerHTML = '';
  Array.from(overlaySelect.options).forEach((opt, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ov-btn' + (opt.value.startsWith('necc:') ? ' necc' : '');
    if (opt.value === overlaySelect.value) b.classList.add('active');
    if (isLiveOption(opt.value)) b.classList.add('is-live');
    b.dataset.value = opt.value;
    b.textContent = opt.textContent;
    if (i < 9) b.title = `Ctrl+${i + 1}`;
    if (opt.value.startsWith('necc:') && !lastImportedOverlayUrls[opt.value.slice(5)]) b.classList.add('unavailable');
    overlayBtns.appendChild(b);
  });
}

overlayBtns.addEventListener('click', (e) => {
  const b = e.target.closest('.ov-btn');
  if (b) selectOverlay(b.dataset.value);
});

function selectOverlay(value) {
  const [kind, key] = value.split(':');

  if (kind === 'widener') {
    // Keep the outgoing overlay's words before swapping in the new one's.
    stashViewText();
    currentMode = key;
    currentNeccType = '';
    currentNeccUrl = '';
    overlaySelect.value = value;
    toggleLayoutVisibility();
    loadViewText(key);
    // The countdown is global, not per view, so an overlay with its own
    // countdown resets it to that overlay's starting point.
    const d = MODE_DEFAULTS[key];
    if (d && d.durationSec !== undefined) {
      durationInput.value = d.durationSec;
      modeDuration.checked = true; modeAt.checked = false;
      durationField.style.display = ''; atField.style.display = 'none';
      restartPending = true;
    }
  } else {
    const url = lastImportedOverlayUrls[key];
    if (!url) {
      neccStatus.textContent = 'Import a match first to get this overlay link';
      neccStatus.classList.add('error');
      return;
    }
    neccStatus.classList.remove('error');
    stashViewText();
    currentMode = 'necc';
    loadViewText('necc');
    currentNeccType = key;
    currentNeccUrl = url;
    overlaySelect.value = value;
    toggleLayoutVisibility();
  }
  renderOverlayButtons();
  renderScorePanel();
  sendDraftNow();
  if (switchPushInput.checked) doPush();
}

const SWITCH_PUSH_KEY = 'widener-switch-push';
switchPushInput.checked = lsGet(SWITCH_PUSH_KEY) === 'on';
switchPushInput.addEventListener('change', () => lsSet(SWITCH_PUSH_KEY, switchPushInput.checked ? 'on' : 'off'));

// --- NECC / LeagueOS import ---------------------------------------------------------

const NECC_TYPES = [
  { key: 'stageBracket', label: 'Bracket' },
  { key: 'seasonHeader', label: 'Season Header' },
  { key: 'matchPreview', label: 'Match Preview' },
  { key: 'matchActivity', label: 'Match Activity' },
  { key: 'matchProgress', label: 'Match Progress' },
  { key: 'matchRosters', label: 'Match Rosters (LeagueOS)' },
];
const DEFAULT_NECC_TYPES = ['stageBracket', 'matchPreview'];
const NECC_TYPES_KEY = 'widener-necc-types';
// Overlay asset URLs (bracket, matchPreview, etc.) resolved by the last
// successful import, keyed by NECC type - what the NECC overlay buttons
// actually point at. Persisted to localStorage so they keep working after an
// app restart without re-importing.
const NECC_URLS_KEY = 'widener-necc-overlay-urls';
let lastImportedOverlayUrls = {};
let enabledNeccTypes = new Set(DEFAULT_NECC_TYPES);

function loadNeccTypeSettings() {
  try {
    const saved = JSON.parse(lsGet(NECC_TYPES_KEY));
    if (Array.isArray(saved) && saved.length) enabledNeccTypes = new Set(saved);
  } catch (e) {}
  try {
    const savedUrls = JSON.parse(lsGet(NECC_URLS_KEY));
    if (savedUrls && typeof savedUrls === 'object') lastImportedOverlayUrls = savedUrls;
  } catch (e) {}
}
function saveNeccTypeSettings() {
  lsSet(NECC_TYPES_KEY, JSON.stringify(Array.from(enabledNeccTypes)));
}
function setNeccOverlayUrls(urls) {
  lastImportedOverlayUrls = urls || {};
  lsSet(NECC_URLS_KEY, JSON.stringify(lastImportedOverlayUrls));
  // If a NECC graphic is being previewed, follow it to the new match.
  if (currentMode === 'necc' && lastImportedOverlayUrls[currentNeccType]) currentNeccUrl = lastImportedOverlayUrls[currentNeccType];
  renderOverlayButtons();
}

const neccTypeList = $id('neccTypeList');
function renderNeccTypeList() {
  neccTypeList.innerHTML = '';
  NECC_TYPES.forEach((t) => {
    const label = document.createElement('label');
    label.className = 'checkbox';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = enabledNeccTypes.has(t.key);
    label.appendChild(input);
    label.appendChild(document.createTextNode(' ' + t.label));
    input.addEventListener('change', () => {
      if (input.checked) enabledNeccTypes.add(t.key); else enabledNeccTypes.delete(t.key);
      saveNeccTypeSettings();
      refreshNeccDropdownOptions();
    });
    neccTypeList.appendChild(label);
  });
}

function refreshNeccDropdownOptions() {
  const current = overlaySelect.value;
  neccOptGroup.innerHTML = '';
  NECC_TYPES.filter((t) => enabledNeccTypes.has(t.key)).forEach((t) => {
    const opt = document.createElement('option');
    opt.value = `necc:${t.key}`;
    opt.textContent = t.label;
    neccOptGroup.appendChild(opt);
  });
  if (Array.from(overlaySelect.options).some((o) => o.value === current)) overlaySelect.value = current;
  renderOverlayButtons();
}

neccFetchBtn.addEventListener('click', async () => {
  const url = neccUrlInput.value.trim();
  if (!url) return;
  neccStatus.textContent = 'Fetching…';
  neccStatus.classList.remove('error');
  neccFetchBtn.disabled = true;
  try {
    const res = await fetch('/api/necc/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');

    rosterA = neccToRoster(data.teams[0]);
    rosterB = neccToRoster(data.teams[1]);
    renderRosterEditor('A');
    renderRosterEditor('B');
    setNeccOverlayUrls(data.overlayUrls);

    // Auto-fill from the imported match. A fetch is an explicit "load this
    // match" action, so these overwrite whatever the previous match left
    // behind - only filling empty fields meant a second import kept showing
    // the old opponent in the subtitle.
    if (data.game) teamInput.value = data.game;
    neccBestOf = data.bestOf || null;
    if (neccBestOf) sbBestOfInput.value = String(neccBestOf);
    const widener = data.teams.find((t) => /widener/i.test(t.org || t.name || ''));
    const opponent = data.teams.find((t) => t !== widener) || data.teams[1];
    if (opponent && opponent.name) subtitleInput.value = `vs ${opponent.name}`;
    if (data.scheduledAt) {
      modeAt.checked = true;
      modeDuration.checked = false;
      durationField.style.display = 'none';
      atField.style.display = '';
      atInput.value = toDatetimeLocalValue(data.scheduledAt);
    }
    if (!matchNameInput.value && data.teams[0] && data.teams[1]) {
      matchNameInput.value = `${data.teams[0].name} vs ${data.teams[1].name}`;
    }

    const urlCount = Object.keys(lastImportedOverlayUrls).length;
    neccStatus.textContent = `Loaded ${data.game || 'match'}${data.eventName ? `, ${data.eventName}` : ''}${data.bestOf ? `, best of ${data.bestOf}` : ''}${urlCount ? ` (${urlCount} overlay links ready)` : ' (no overlay links resolved, so NECC graphics are unavailable for this match)'}. Both teams were saved to the team library.`;
    pushDraft();
  } catch (err) {
    neccStatus.textContent = err.message || 'Failed to import match';
    neccStatus.classList.add('error');
  } finally {
    neccFetchBtn.disabled = false;
  }
});

// --- Match + team library --------------------------------------------------------------
//
// Stored by the server (library.json in the app's data folder), so the app
// window and an OBS dock share it. A saved match is the setup for a match:
// teams, rosters, text, countdown, scoreboard settings and the NECC links. It
// never includes which overlay is up or the live score.

function matchData() {
  const d = buildDraft();
  const out = {
    game: d.game, team: d.team, next: d.next, teamA: d.teamA, teamB: d.teamB,
    views: allViewTexts(), scoreboard: d.scoreboard,
    countdownMode: d.countdownMode, logo: d.logo, clip: d.clip, montage: d.montage, layout: d.layout,
    neccLink: neccUrlInput.value.trim(), neccOverlayUrls: lastImportedOverlayUrls,
  };
  if (d.countdownMode === 'at') out.end = d.end; else out.durationSec = d.durationSec;
  return out;
}

function renderLibrary() {
  // Saved matches
  const prev = matchSelect.value;
  matchSelect.innerHTML = '';
  if (!library.matches.length) {
    matchSelect.innerHTML = '<option value="">No saved matches</option>';
  }
  library.matches.forEach((m) => {
    const o = document.createElement('option');
    const d = new Date(m.savedAt);
    o.value = m.id;
    o.textContent = `${m.name}${isNaN(d) ? '' : `  (${d.toLocaleDateString()})`}`;
    matchSelect.appendChild(o);
  });
  if (library.matches.some((m) => m.id === prev)) matchSelect.value = prev;
  matchLoadBtn.disabled = matchDeleteBtn.disabled = library.matches.length === 0;

  // "Load saved team" pickers above each roster
  ['A', 'B'].forEach((letter) => {
    const sel = rosterEls[letter].lib;
    sel.innerHTML = `<option value="">${library.teams.length ? 'Load saved team…' : 'No saved teams yet'}</option>`;
    library.teams.forEach((t) => {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.tag ? `${t.name} (${t.tag})` : t.name;
      sel.appendChild(o);
    });
  });

  // Setup tab list
  libTeamList.innerHTML = '';
  if (!library.teams.length) {
    libTeamList.innerHTML = '<div class="lib-empty">No saved teams yet. Use Save team on a roster, or import a NECC match.</div>';
    return;
  }
  library.teams.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'lib-row';
    const sw = document.createElement('span');
    sw.className = 'lib-swatch';
    sw.style.background = toHex6(t.color) || '#242e42';
    const img = document.createElement('img');
    img.className = 'lib-logo';
    img.alt = '';
    if (t.logoUrl) img.src = mediaUrl(t.logoUrl); else img.hidden = true;
    const name = document.createElement('span');
    name.className = 'lib-name';
    name.textContent = t.tag ? `${t.name} (${t.tag})` : t.name;
    const count = document.createElement('span');
    count.className = 'lib-meta';
    count.textContent = `${(t.players || []).length} players`;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn-secondary lib-del';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      if (!armed(del, 'Delete')) return;
      await fetch(`/api/library/teams/${encodeURIComponent(t.id)}`, { method: 'DELETE' }).catch(() => {});
    });
    row.append(sw, img, name, count, del);
    libTeamList.appendChild(row);
  });
}

matchSaveBtn.addEventListener('click', async () => {
  const a = rosterA.name.trim(), b = rosterB.name.trim();
  const name = matchNameInput.value.trim() || (a && b ? `${a} vs ${b}` : '');
  if (!name) { flashText(matchSaveBtn, 'Name it first', 'Save'); return; }
  try {
    const res = await fetch('/api/library/matches', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: matchData() }),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error);
    matchNameInput.value = name;
    setTimeout(() => { matchSelect.value = out.match.id; }, 50);
    flashText(matchSaveBtn, 'Saved', 'Save');
  } catch (e) {
    flashText(matchSaveBtn, 'Save failed', 'Save');
  }
});

matchLoadBtn.addEventListener('click', () => {
  const m = library.matches.find((x) => x.id === matchSelect.value);
  if (!m) return;
  const d = m.data || {};
  // Start from the current form so the overlay on screen stays put, then lay
  // the saved match over it.
  const state = { ...JSON.parse(formSnapshot()), ...d };
  delete state.neccLink; delete state.neccOverlayUrls;
  state.scoreboard = { ...scoreboardConfig(), ...(d.scoreboard || {}) };
  if (d.neccOverlayUrls) setNeccOverlayUrls(d.neccOverlayUrls);
  state.mode = currentMode; state.neccType = currentNeccType; state.neccUrl = currentNeccUrl;
  neccUrlInput.value = d.neccLink || '';
  matchNameInput.value = m.name;
  populateForm(state);
  recordHistory(true);
  if (ws && ws.readyState === WebSocket.OPEN) {
    clearTimeout(draftDebounce);
    ws.send(JSON.stringify({ type: 'update', channel: 'draft', data: { ...buildDraft(), views: allViewTexts() } }));
  }
  neccStatus.classList.remove('error');
  neccStatus.textContent = `Loaded saved match: ${m.name}`;
});

matchDeleteBtn.addEventListener('click', async () => {
  const id = matchSelect.value;
  if (!id || !armed(matchDeleteBtn, 'Delete')) return;
  await fetch(`/api/library/matches/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
});

// --- Tabs ---------------------------------------------------------------------------------
//
// "Show" holds what is used during a broadcast; "Setup" holds what is set
// once (OBS, socials, NECC buttons, the team library, shortcuts).

const TAB_KEY = 'widener-tab';
function setTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.settings-col > .panel[data-tab]').forEach((p) => { p.hidden = p.dataset.tab !== name; });
  lsSet(TAB_KEY, name);
}
document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
setTab(lsGet(TAB_KEY) === 'setup' ? 'setup' : 'show');

// --- Preview / live monitor ------------------------------------------------------------------

const previewFrame = $id('previewFrame');
const liveFrame = $id('liveFrame');
document.querySelectorAll('.preview-label .seg-btn').forEach((b) => b.addEventListener('click', () => {
  const live = b.dataset.view === 'live';
  document.querySelectorAll('.preview-label .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
  // Loaded on first use only, so the panel doesn't run a second overlay page
  // for operators who never look at it.
  if (live && !liveFrame.getAttribute('src')) liveFrame.src = '/overlay?monitor=1';
  liveFrame.hidden = !live;
  previewFrame.hidden = live;
  $id('previewWrap').classList.toggle('showing-live', live);
}));

// --- Resizable preview column ------------------------------------------------------------------

const colResizer = $id('colResizer');
const layoutEl = $id('layout');
const PREVIEW_WIDTH_KEY = 'widener-preview-width';
const PREVIEW_HEIGHT_KEY = 'widener-preview-height';
// Same breakpoint as the CSS media query that stacks the columns into rows -
// below it, the resizer drags height instead of width.
const stackedLayoutQuery = window.matchMedia('(max-width: 980px)');

function setPreviewWidth(px) {
  const clamped = Math.max(280, Math.min(900, px));
  layoutEl.style.setProperty('--preview-width', clamped + 'px');
  lsSet(PREVIEW_WIDTH_KEY, String(clamped));
}
function setPreviewHeight(px) {
  const clamped = Math.max(200, Math.min(700, px));
  layoutEl.style.setProperty('--preview-height', clamped + 'px');
  lsSet(PREVIEW_HEIGHT_KEY, String(clamped));
}
setPreviewWidth(parseInt(lsGet(PREVIEW_WIDTH_KEY) || '440', 10));
setPreviewHeight(parseInt(lsGet(PREVIEW_HEIGHT_KEY) || '340', 10));

let resizingCol = false;
colResizer.addEventListener('mousedown', (e) => {
  resizingCol = true;
  colResizer.classList.add('dragging');
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!resizingCol) return;
  if (stackedLayoutQuery.matches) setPreviewHeight(window.innerHeight - e.clientY);
  else setPreviewWidth(window.innerWidth - e.clientX);
});
window.addEventListener('mouseup', () => {
  if (!resizingCol) return;
  resizingCol = false;
  colResizer.classList.remove('dragging');
});

// Preview scaling: render the overlay at its real 1920x1080 and scale the
// whole thing down to fit, so proportions always match the real stream. The
// box's own pixel size is computed here (not CSS aspect-ratio+max-height,
// which doesn't reliably shrink width when height is the tighter constraint)
// so it's always exactly 16:9 regardless of which dimension is binding.
const previewFrameWrap = document.querySelector('.preview-frame-wrap');
const previewBox = $id('previewBox');
const previewScaler = $id('previewScaler');
function updatePreviewScale() {
  const availW = previewFrameWrap.clientWidth;
  const availH = previewFrameWrap.clientHeight;
  let w = availW, h = w * 9 / 16;
  if (h > availH) { h = availH; w = h * 16 / 9; }
  previewBox.style.width = w + 'px';
  previewBox.style.height = h + 'px';
  previewScaler.style.transform = `scale(${w / 1920})`;
}
new ResizeObserver(updatePreviewScale).observe(previewFrameWrap);
updatePreviewScale();

// --- Keyboard shortcuts ----------------------------------------------------------------------------

function isTypingTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'color', 'file', 'range'].includes(el.type);
}

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'Enter') { e.preventDefault(); doPush(); return; }
  if (mod && !e.shiftKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
    const b = overlayBtns.querySelectorAll('.ov-btn')[Number(e.code.slice(5)) - 1];
    if (b) { e.preventDefault(); selectOverlay(b.dataset.value); }
    return;
  }
  if (isTypingTarget(e.target)) return;
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return; }
  if (mod || e.altKey || e.repeat) return;
  // Scoreboard keys, only while its controls are on screen.
  if (scorePanel.style.display === 'none' || scorePanel.hidden) return;
  const keys = {
    Digit1: e.shiftKey ? ['undo', 'A'] : ['lose', 'A'],
    Digit2: e.shiftKey ? ['undo', 'B'] : ['lose', 'B'],
    Digit3: e.shiftKey ? null : ['win', 'A'],
    Digit4: e.shiftKey ? null : ['win', 'B'],
  };
  const hit = keys[e.code];
  if (hit) { e.preventDefault(); scoreAction(hit[0], hit[1]); }
});

// --- Info points --------------------------------------------------------------------------------
//
// One shared floating bubble serves every .info dot. It's position:fixed and
// clamped to the viewport, so a tip can't be clipped by the scrolling settings
// column or squeezed off-screen when the panel runs as a narrow OBS dock -
// which a CSS-only ::after tooltip would be. Shown on hover and on keyboard
// focus; dismissed on scroll, blur, or Escape.

const tipBubble = document.createElement('div');
tipBubble.className = 'tip-bubble';
tipBubble.setAttribute('role', 'tooltip');
document.body.appendChild(tipBubble);

const TIP_GAP = 8;

function showTip(el) {
  const text = el.getAttribute('data-tip');
  if (!text) return;
  tipBubble.textContent = text;
  // A visibility:hidden element still gets a layout box, so the bubble can be
  // measured (and positioned) before it's ever shown - no first-frame flicker.
  const anchor = el.getBoundingClientRect();
  const bubble = tipBubble.getBoundingClientRect();
  let left = anchor.left + anchor.width / 2 - bubble.width / 2;
  left = Math.max(TIP_GAP, Math.min(left, window.innerWidth - bubble.width - TIP_GAP));
  // Prefer above the dot; flip below when there isn't room.
  let top = anchor.top - bubble.height - TIP_GAP;
  if (top < TIP_GAP) top = anchor.bottom + TIP_GAP;
  tipBubble.style.left = `${Math.round(left)}px`;
  tipBubble.style.top = `${Math.round(top)}px`;
  tipBubble.classList.add('visible');
}

function hideTip() {
  tipBubble.classList.remove('visible');
}

document.addEventListener('mouseover', (e) => {
  const el = e.target.closest && e.target.closest('.info');
  if (el) showTip(el);
});
document.addEventListener('mouseout', (e) => {
  if (e.target.closest && e.target.closest('.info')) hideTip();
});
document.addEventListener('focusin', (e) => {
  const el = e.target.closest && e.target.closest('.info');
  if (el) showTip(el);
});
document.addEventListener('focusout', (e) => {
  if (e.target.closest && e.target.closest('.info')) hideTip();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
// Capture phase so a scroll inside the settings column (which doesn't bubble)
// still dismisses a bubble anchored to a row that just moved.
document.addEventListener('scroll', hideTip, true);
window.addEventListener('resize', hideTip);
// An info dot inside a <label> would otherwise toggle that label's checkbox.
document.addEventListener('click', (e) => {
  const el = e.target.closest && e.target.closest('.info');
  if (el) { e.preventDefault(); showTip(el); }
});

// --- OBS dock URL copy + scene-sync -------------------------------------------------------------------
//
// All optional. Scene-sync talks to the server's /api/obs/* routes, which own
// the single obs-websocket connection; the password is entered here, sent
// over localhost, and only ever held in the server's memory (plus this
// machine's localStorage as a convenience) - never committed, never logged.
// After one successful Connect the panel connects again by itself whenever
// the app starts, and the server reconnects if OBS restarts.

const copyDockBtn = $id('copyDockBtn');
copyDockBtn.addEventListener('click', () => {
  navigator.clipboard.writeText($id('dockUrl').value).then(() => flashText(copyDockBtn, 'Copied!', 'Copy'));
});

const obsHostInput = $id('obsHostInput');
const obsPortInput = $id('obsPortInput');
const obsPassInput = $id('obsPassInput');
const obsConnectBtn = $id('obsConnectBtn');
const obsDisconnectBtn = $id('obsDisconnectBtn');
const obsStatusEl = $id('obsStatus');
const obsSyncControls = $id('obsSyncControls');
const obsSyncEnable = $id('obsSyncEnable');
const obsTransitionSelect = $id('obsTransitionSelect');
const obsBuildBtn = $id('obsBuildBtn');
const obsBuildStatus = $id('obsBuildStatus');
const obsConn = $id('obsConn');
const obsConnDot = $id('obsConnDot');
const obsConnText = $id('obsConnText');

const OBS_SETTINGS_KEY = 'widener-obs-settings';
let obsAutoConnect = false;
let obsWasConnected = false;

function loadObsSettings() {
  try {
    const s = JSON.parse(lsGet(OBS_SETTINGS_KEY)) || {};
    if (s.host) obsHostInput.value = s.host;
    if (s.port) obsPortInput.value = s.port;
    if (typeof s.password === 'string') obsPassInput.value = s.password;
    if (s.sceneSync) obsSyncEnable.checked = true;
    if (s.transitionName) obsTransitionSelect.dataset.saved = s.transitionName;
    obsAutoConnect = !!s.autoConnect;
  } catch (e) {}
}
function saveObsSettings() {
  lsSet(OBS_SETTINGS_KEY, JSON.stringify({
    host: obsHostInput.value.trim(),
    port: parseInt(obsPortInput.value, 10) || 4455,
    // Convenience only, on this machine. Not committed, not logged.
    password: obsPassInput.value,
    sceneSync: obsSyncEnable.checked,
    transitionName: obsTransitionSelect.value || obsTransitionSelect.dataset.saved || '',
    autoConnect: obsAutoConnect,
  }));
}

function renderObsStatus(st) {
  const connected = !!(st && st.connected);
  const reconnecting = !!(st && st.reconnecting);
  obsConnectBtn.disabled = connected;
  obsDisconnectBtn.disabled = !connected && !reconnecting;
  obsSyncControls.style.display = connected ? '' : 'none';
  obsSceneSyncActive = connected && !!(st && st.sceneSync);
  // Reflect scene-sync state onto the curtain-stinger checkbox: when OBS owns
  // the transition, the in-overlay wipe is off and can't be toggled here.
  stingerInput.disabled = obsSceneSyncActive;
  // Explain the disabled checkbox in its own info point rather than a separate
  // note, so the reason sits exactly where the control is.
  const stingerInfo = stingerInput.parentElement.querySelector('.info');
  if (stingerInfo) {
    stingerInfo.setAttribute('data-tip', obsSceneSyncActive
      ? 'Turned off while OBS scene-sync is on, because OBS is playing the transition instead. Two wipes would otherwise stack on every push.'
      : 'Plays the Widener curtain wipe on the live overlay whenever you push, hiding the switch.');
  }

  // Header indicator: only for operators who use the OBS connection.
  obsConn.hidden = !(connected || reconnecting || obsAutoConnect);
  obsConnDot.className = 'dot' + (connected ? ' connected' : reconnecting ? ' warn' : '');
  obsConnText.textContent = connected ? 'OBS' : reconnecting ? 'OBS reconnecting…' : 'OBS offline';

  if (!connected) {
    if (reconnecting) {
      obsStatusEl.textContent = `Lost the connection to OBS. Trying again every few seconds${st.error ? ` (${st.error})` : ''}.`;
      obsStatusEl.classList.add('error');
    } else {
      obsStatusEl.textContent = (st && st.error) ? `Not connected. ${st.error}` : 'Not connected';
      obsStatusEl.classList.toggle('error', !!(st && st.error));
    }
    return;
  }
  obsStatusEl.classList.remove('error');
  const scene = st.currentScene ? ` · on program: ${st.currentScene}` : '';
  obsStatusEl.textContent = `Connected${st.sceneSync ? ' · scene-sync ON' : ' · scene-sync off'}${scene}`;
}

function fillTransitions(list, selected) {
  const want = selected || obsTransitionSelect.value || obsTransitionSelect.dataset.saved || '';
  obsTransitionSelect.innerHTML = '<option value="">OBS default</option>';
  (list || []).forEach((t) => {
    const o = document.createElement('option');
    o.value = t; o.textContent = t;
    obsTransitionSelect.appendChild(o);
  });
  if (want && (list || []).includes(want)) obsTransitionSelect.value = want;
}

async function obsInspect() {
  try {
    const st = await fetch('/api/obs/inspect').then((r) => r.json());
    renderObsStatus(st);
    if (st.connected && st.transitions) fillTransitions(st.transitions);
    obsWasConnected = !!st.connected;
    return st;
  } catch (e) {
    renderObsStatus({ connected: false, error: 'server unreachable' });
    return null;
  }
}

async function obsConnect(retry) {
  saveObsSettings();
  obsStatusEl.classList.remove('error');
  obsStatusEl.textContent = 'Connecting…';
  obsConnectBtn.disabled = true;
  try {
    const st = await fetch('/api/obs/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: obsHostInput.value.trim(),
        port: parseInt(obsPortInput.value, 10) || 4455,
        password: obsPassInput.value,
        sceneSync: obsSyncEnable.checked,
        transitionName: obsTransitionSelect.value || obsTransitionSelect.dataset.saved || '',
        retry: !!retry,
      }),
    }).then((r) => r.json());
    if (st.connected) { obsAutoConnect = true; saveObsSettings(); }
    renderObsStatus(st);
    await obsInspect();
  } catch (e) {
    renderObsStatus({ connected: false, error: 'connection failed' });
  } finally {
    obsConnectBtn.disabled = false;
  }
}
obsConnectBtn.addEventListener('click', () => obsConnect(false));

obsDisconnectBtn.addEventListener('click', async () => {
  obsAutoConnect = false;
  saveObsSettings();
  try {
    const st = await fetch('/api/obs/disconnect', { method: 'POST' }).then((r) => r.json());
    renderObsStatus(st);
  } catch (e) {}
});

async function pushObsSettings() {
  saveObsSettings();
  try {
    const st = await fetch('/api/obs/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneSync: obsSyncEnable.checked, transitionName: obsTransitionSelect.value || '' }),
    }).then((r) => r.json());
    renderObsStatus(st);
  } catch (e) {}
}
obsSyncEnable.addEventListener('change', pushObsSettings);
obsTransitionSelect.addEventListener('change', pushObsSettings);

// --- Background music (v0.11.0) ----------------------------------------------
// The server keeps the settings and tells OBS what to do (see obs.js); this
// only edits them. Music settings are machine-wide, not part of a match.
const musicEnable = $id('musicEnable');
const musicFileText = $id('musicFileText');
const musicFile = $id('musicFile');
const musicVolume = $id('musicVolume');
const musicVolumeText = $id('musicVolumeText');
const musicStatusEl = $id('musicStatus');
const musicDefaultBtn = $id('musicDefaultBtn');
const musicDownloadBtn = $id('musicDownloadBtn');
function musicDbText(v) { return `${Math.round(-40 + 40 * (v / 100))} dB`; }
function renderMusic(m) {
  if (!m) return;
  musicEnable.checked = m.enabled;
  const dl = m.download || {};
  const usingTrack = !m.file || m.customMissing;
  musicFileText.value = m.file || 'Included track (rl-music-long.m4a)';
  musicFileText.title = m.path || '';
  if (document.activeElement !== musicVolume) musicVolume.value = String(m.volume);
  musicVolumeText.textContent = musicDbText(Number(musicVolume.value));
  musicDefaultBtn.disabled = !m.file;
  musicDownloadBtn.hidden = !usingTrack || dl.have || dl.downloading || dl.queued;
  let text;
  let error = false;
  if (usingTrack && dl.downloading) text = `Downloading the included track: ${Math.floor(100 * dl.received / dl.bytes)}%`;
  else if (usingTrack && dl.queued) text = 'The included track is waiting to download.';
  else if (usingTrack && !dl.have) {
    text = dl.error ? `Download failed: ${dl.error}` : 'The included track is not downloaded yet.';
    if (m.customMissing) text = 'The custom file is missing. ' + text;
    error = !!dl.error || m.customMissing;
  }
  else if (m.customMissing) text = 'The custom file is missing, so the included track is used.';
  else if (!m.enabled) text = 'Music is off.';
  else if (!m.obsConnected) text = 'OBS is not connected, so no music is playing. Connect under scene-sync above.';
  else text = m.playing ? 'Playing now (no gameplay on screen).' : 'Faded out: gameplay is on screen.';
  musicStatusEl.textContent = text;
  musicStatusEl.classList.toggle('error', error || (!!m.customMissing && !usingTrack));
}
function saveMusic(patch) {
  fetch('/api/music', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    .then((r) => r.json())
    .then((m) => {
      if (m.error) { musicStatusEl.textContent = m.error; musicStatusEl.classList.add('error'); return; }
      renderMusic(m);
    })
    .catch(() => {});
}
musicEnable.addEventListener('change', () => saveMusic({ enabled: musicEnable.checked }));
musicVolume.addEventListener('input', () => { musicVolumeText.textContent = musicDbText(Number(musicVolume.value)); });
musicVolume.addEventListener('change', () => saveMusic({ volume: Number(musicVolume.value) }));
$id('musicBrowseBtn').addEventListener('click', () => musicFile.click());
// The app window gives a real path for a picked file (Electron); a plain
// browser only gives a name, which the server rejects with a message.
musicFile.addEventListener('change', () => {
  const f = musicFile.files[0];
  if (f) saveMusic({ file: f.path || f.name });
  musicFile.value = '';
});
musicDefaultBtn.addEventListener('click', () => saveMusic({ file: '' }));
musicDownloadBtn.addEventListener('click', () => {
  fetch('/api/music/download', { method: 'POST' }).then((r) => r.json()).then(renderMusic).catch(() => {});
});
fetch('/api/music').then((r) => r.json()).then(renderMusic).catch(() => {});

obsBuildBtn.addEventListener('click', async () => {
  obsBuildStatus.classList.remove('error');
  obsBuildStatus.textContent = 'Building scenes in OBS…';
  obsBuildBtn.disabled = true;
  try {
    const res = await fetch('/api/obs/build-scenes', { method: 'POST' }).then((r) => r.json());
    if (res.error) throw new Error(res.error);
    obsBuildStatus.textContent = `Ready: ${(res.built || []).join(', ')}`;
    await obsInspect();
  } catch (e) {
    obsBuildStatus.textContent = e.message || 'Failed to build scenes';
    obsBuildStatus.classList.add('error');
  } finally {
    obsBuildBtn.disabled = false;
  }
});

// Keep the OBS status current (connection drops, reconnects, manual scene
// switches). A reconnect also refreshes the transition list.
const OBS_POLL_MS = 4000;
setInterval(async () => {
  try {
    const st = await fetch('/api/obs/status').then((r) => r.json());
    if (st.connected && !obsWasConnected) { await obsInspect(); return; }
    obsWasConnected = !!st.connected;
    renderObsStatus(st);
  } catch (e) { /* server restarting; the WS status shows that */ }
}, OBS_POLL_MS);

// --- Init -----------------------------------------------------------------------------------------------

buildRosterEditor('A');
buildRosterEditor('B');
renderRosterEditor('A');
renderRosterEditor('B');
buildScoreSide('A');
buildScoreSide('B');
loadNeccTypeSettings();
renderNeccTypeList();
refreshNeccDropdownOptions();
renderLibrary();

fetch('/api/version').then((r) => r.json()).then((v) => { $id('appVersion').textContent = 'v' + v.version; }).catch(() => {});

fetch('/games.json')
  .then((r) => r.json())
  .then((data) => {
    games = data;
    gameSelect.innerHTML = '<option value="">Custom</option>';
    games.forEach((g) => {
      const o = document.createElement('option');
      o.value = g.id; o.textContent = g.name;
      gameSelect.appendChild(o);
    });
    updateUrlDisplay();
    toggleLayoutVisibility();
    connect();
  });

loadObsSettings();
// Reflect any connection that survived a panel reload, and connect by itself
// if this machine has connected before (e.g. the app was just started).
obsInspect().then((st) => {
  if (st && !st.connected && !st.reconnecting && obsAutoConnect) obsConnect(true);
});
