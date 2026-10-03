// Widener Esports Stream Control: control panel.
//
// v0.12.0 layout: three pages. Prep holds the game, match import, teams and
// team library; Live holds the overlay strip, the scoreboard and the fields
// of the overlay in the preview; Settings holds OBS, music, downloads,
// socials, display and remote control. The Preview and Live monitors sit
// beside every page, Studio Mode style, with Push Live between them.
//
// Sections, in order: element refs, helpers, panel preferences, shared
// state, file fields, rosters, scoreboard, Rocket League, draft form,
// WebSocket + push, montages, edit history, overlay strip, inspector, NECC
// import, match + team library, team sheet, pages, monitors, display,
// keyboard, shortcuts, info tooltips, toasts, OBS, music, remote control,
// setup guide, init.

const $id = (id) => document.getElementById(id);

// --- Element refs ------------------------------------------------------------

const layoutEl = $id('layout');
const pageCol = $id('pageCol');

const obsUrl = $id('obsUrl');
const copyUrlBtn = $id('copyUrlBtn');

const gameSelect = $id('gameSelect');
const overlaySelect = $id('overlaySelect');
const overlayBtns = $id('overlayBtns');
const switchPushInput = $id('switchPushInput');
const neccOptGroup = $id('neccOptGroup');
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
const clipInput = $id('clipInput');
const montageInput = $id('montageInput');
const layoutInput = $id('layoutInput');

const neccUrlInput = $id('neccUrlInput');
const neccFetchBtn = $id('neccFetchBtn');
const neccStatus = $id('neccStatus');

const scorePanel = $id('scorePanel');
const sbLiveTag = $id('sbLiveTag');
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

const inspTitle = $id('inspTitle');
const rosterSummary = $id('rosterSummary');
const previewWhat = $id('previewWhat');
const liveWhat = $id('liveWhat');

const matchSelect = $id('matchSelect');
const matchLoadBtn = $id('matchLoadBtn');
const matchDeleteBtn = $id('matchDeleteBtn');
const matchNameInput = $id('matchNameInput');
const matchSaveBtn = $id('matchSaveBtn');
const libTeamList = $id('libTeamList');
const libSearch = $id('libSearch');

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

// --- Helpers -------------------------------------------------------------------

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

// The countdown length is typed as minutes:seconds ("10:00", "1:30"). A bare
// number is minutes. The server still stores seconds.
function parseDuration(v) {
  const s = String(v || '').trim();
  if (!s) return 0;
  if (s.includes(':')) {
    const [m, sec] = s.split(':');
    return Math.max(0, (parseInt(m, 10) || 0) * 60 + (parseInt(sec, 10) || 0));
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.max(0, Math.round(n * 60));
}
function formatDuration(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Dark or light text for a coloured background, by relative luminance.
function inkFor(color) {
  const h = toHex6(color);
  if (!h) return '#fff';
  const n = parseInt(h.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111' : '#fff';
}

function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, v) { try { localStorage.setItem(key, v); } catch (e) {} }

// A destructive button (Reset match) asks for a second click within 3s
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

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => flashText(btn, 'Copied!', btn.textContent)).catch(() => {});
}

// --- Panel preferences (v0.12.0) ------------------------------------------------
//
// The transition on push, push on pick, instant scores, which NECC graphics
// get a card, the last import's NECC links and whether the setup guide has
// run. These used to live in each window's browser storage, so the app
// window and an OBS dock could disagree. The server keeps them now and tells
// every panel when one changes.

const DEFAULT_NECC_TYPES = ['stageBracket', 'matchPreview'];
let prefs = {
  stingerOnPush: true, switchPush: false, scoresInstant: true,
  neccTypes: DEFAULT_NECC_TYPES.slice(), neccOverlayUrls: {}, setupDone: false,
};
let prefsLoaded = false;

function applyPrefs(p) {
  prefs = { ...prefs, ...(p || {}) };
  stingerInput.checked = prefs.stingerOnPush;
  switchPushInput.checked = prefs.switchPush;
  sbInstantInput.checked = prefs.scoresInstant;
  enabledNeccTypes = new Set(prefs.neccTypes || []);
  lastImportedOverlayUrls = prefs.neccOverlayUrls || {};
  renderNeccTypeList();
  refreshNeccDropdownOptions();
  renderRemoteList();
}

function savePrefs(patch) {
  applyPrefs(patch);
  fetch('/api/prefs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  }).catch(() => {});
}

// One-time move of a v0.11 window's own choices up to the server, the first
// time any panel connects after the upgrade.
function legacyPrefs() {
  const out = {};
  const st = lsGet('widener-stinger-on-push'); if (st) out.stingerOnPush = st !== 'off';
  const sp = lsGet('widener-switch-push'); if (sp) out.switchPush = sp === 'on';
  const si = lsGet('widener-smash-instant'); if (si) out.scoresInstant = si !== 'off';
  try { const t = JSON.parse(lsGet('widener-necc-types')); if (Array.isArray(t) && t.length) out.neccTypes = t; } catch (e) {}
  try { const u = JSON.parse(lsGet('widener-necc-overlay-urls')); if (u && typeof u === 'object') out.neccOverlayUrls = u; } catch (e) {}
  return out;
}

async function loadPrefs() {
  try {
    const res = await fetch('/api/prefs').then((r) => r.json());
    applyPrefs(res.prefs);
    if (!res.saved) savePrefs(legacyPrefs());
  } catch (e) { /* server restarting; defaults stand */ }
  prefsLoaded = true;
  maybeAutoWizard();
}

stingerInput.addEventListener('change', () => savePrefs({ stingerOnPush: stingerInput.checked }));
switchPushInput.addEventListener('change', () => savePrefs({ switchPush: switchPushInput.checked }));
sbInstantInput.addEventListener('change', () => savePrefs({ scoresInstant: sbInstantInput.checked }));

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
const MODE_NAMES = {
  'starting-soon': 'Starting Soon', 'post-match': 'Post-Match', roster: 'Rosters',
  brb: 'Be Right Back', scoreboard: 'Scoreboard', necc: 'NECC graphic',
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
// red Live marker on the overlay cards and the Live monitor's label.
let liveMode = '';
let liveNeccType = '';
// The next draft update asks the server to restart the countdown (the
// Restart button, or switching to an overlay with its own countdown). Other
// edits leave a running countdown alone.
let restartPending = false;
let library = { teams: [], matches: [] };
let libraryLoaded = false;

// Per-overlay text, mirroring `state.views` on the server. Each overlay owns
// its own title/subtitle/badge, so editing text changes only the overlay
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
function viewTextFor(mode) {
  return mode === currentMode ? currentViewText() : (viewTexts[mode] || MODE_DEFAULTS[mode] || {});
}

// --- Browse-first file fields (v0.12.0) ----------------------------------------
//
// The logo, background video and team logo fields show the chosen file by
// name, with Browse and Clear, instead of a raw path to type. "Paste a link"
// opens the text box for a web address. The text input underneath stays the
// value everything else reads (buildDraft, the rosters), so this is display.

const fileFields = [];

function fileLabel(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (/^\/logos\//.test(v)) return 'Imported team logo';
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      const last = u.pathname.split('/').filter(Boolean).pop();
      return last ? `${decodeURIComponent(last)} (${u.hostname})` : u.hostname;
    } catch (e) { return v; }
  }
  return v.split(/[\\/]/).pop() || v;
}

function makeFileField(input, opts) {
  const wrap = document.createElement('div');
  wrap.className = 'file-field';
  input.parentNode.insertBefore(wrap, input);
  const chip = document.createElement('span');
  chip.className = 'file-chip';
  const browse = document.createElement('button');
  browse.type = 'button'; browse.className = 'btn-secondary'; browse.textContent = 'Browse…';
  const link = document.createElement('button');
  link.type = 'button'; link.className = 'btn-secondary'; link.textContent = 'Paste a link';
  const clear = document.createElement('button');
  clear.type = 'button'; clear.className = 'btn-secondary file-clear'; clear.textContent = '×';
  clear.title = 'Clear'; clear.setAttribute('aria-label', 'Clear');
  const file = document.createElement('input');
  file.type = 'file'; file.accept = opts.accept || ''; file.hidden = true;
  wrap.append(chip, input, browse, link, clear, file);

  let linkMode = false;
  let warn = '';
  function render() {
    const v = input.value.trim();
    input.hidden = !linkMode;
    chip.hidden = linkMode;
    link.hidden = linkMode;
    chip.classList.toggle('empty', !v && !warn);
    chip.classList.toggle('warn', !!warn);
    chip.textContent = warn || (v ? fileLabel(v) : opts.emptyText);
    chip.title = warn ? '' : v;
    clear.hidden = !v;
  }
  function set(v) {
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    render();
  }
  browse.addEventListener('click', () => file.click());
  // Electron gives a picked file's full path; a plain browser (or an OBS
  // dock) only gives its name, which the overlay could never load.
  file.addEventListener('change', () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    if (f.path) { warn = ''; linkMode = false; set(f.path); return; }
    warn = `This window can't see where "${f.name}" is. Use the app window, or Paste a link.`;
    render();
  });
  link.addEventListener('click', () => { linkMode = true; warn = ''; render(); input.focus(); });
  clear.addEventListener('click', () => { linkMode = false; warn = ''; set(''); });
  input.addEventListener('input', render);
  input.addEventListener('blur', () => { linkMode = false; render(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  const field = { render: () => { warn = ''; render(); } };
  fileFields.push(field);
  render();
  return field;
}

function refreshFileFields() { fileFields.forEach((f) => f.render()); }

// --- Rosters -------------------------------------------------------------------
//
// The two teams shown in the Rosters overlay and the scoreboard. Fully editable
// by hand (name, tag, colour, logo, players), filled by a NECC import, and
// loadable from the team library. Each player is a plain { name, gamertag }.
// A filled-in team folds down to one line with an Edit button.

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
const ROSTER_OPEN_KEY = 'widener-roster-open';
let rosterOpen = {};

// Open by choice, or by default while the team is still empty.
function isRosterOpen(letter) {
  if (typeof rosterOpen[letter] === 'boolean') return rosterOpen[letter];
  const t = rosterFor(letter);
  return !t.name && !t.players.length;
}
function setRosterOpen(letter, open) {
  rosterOpen[letter] = open;
  lsSet(ROSTER_OPEN_KEY, JSON.stringify(rosterOpen));
  renderRosterSummary(letter);
}

// Builds one team's editor once; renderRosterEditor() then fills it.
function buildRosterEditor(letter) {
  const box = $id('rosterEdit' + letter);
  box.innerHTML = `
    <div class="ret-summary">
      <img class="ret-sum-logo" alt="" hidden>
      <div class="ret-sum-text">
        <span class="ret-letter">Team ${letter}</span>
        <span class="ret-sum-name"></span>
        <span class="ret-sum-meta"></span>
      </div>
      <button class="btn-secondary ret-toggle" type="button">Edit</button>
    </div>
    <div class="ret-body">
      <div class="ret-top">
        <select class="ret-lib" aria-label="Load a saved team"></select>
        <button class="btn-secondary ret-save" type="button">Save to library</button>
      </div>
      <div class="ret-header">
        <input type="text" class="ret-name" placeholder="Team ${letter} name">
        <input type="text" class="ret-tag" placeholder="TAG">
        <input type="color" class="ret-color" title="Team colour (scoreboard and rosters)">
      </div>
      <input type="text" class="ret-logo-input" placeholder="https://...">
      <div class="ret-players"></div>
      <button class="btn-secondary ret-add" type="button">+ Add player</button>
    </div>`;
  const els = {
    box,
    sumLogo: box.querySelector('.ret-sum-logo'), sumName: box.querySelector('.ret-sum-name'),
    sumMeta: box.querySelector('.ret-sum-meta'), toggle: box.querySelector('.ret-toggle'),
    lib: box.querySelector('.ret-lib'), save: box.querySelector('.ret-save'),
    name: box.querySelector('.ret-name'), tag: box.querySelector('.ret-tag'), color: box.querySelector('.ret-color'),
    logoInput: box.querySelector('.ret-logo-input'), players: box.querySelector('.ret-players'),
    add: box.querySelector('.ret-add'),
  };
  rosterEls[letter] = els;
  els.logoField = makeFileField(els.logoInput, { accept: 'image/*', emptyText: 'No logo' });

  els.toggle.addEventListener('click', () => setRosterOpen(letter, !isRosterOpen(letter)));
  els.name.addEventListener('input', () => { rosterFor(letter).name = els.name.value; renderRosterSummary(letter); pushDraft(); });
  els.tag.addEventListener('input', () => { rosterFor(letter).tag = els.tag.value; renderRosterSummary(letter); pushDraft(); });
  els.color.addEventListener('input', () => { rosterFor(letter).color = els.color.value; renderRosterSummary(letter); pushDraft(); });
  els.logoInput.addEventListener('input', () => {
    rosterFor(letter).logoUrl = els.logoInput.value.trim();
    renderRosterSummary(letter);
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
    useLibraryTeam(letter, t);
  });
  els.save.addEventListener('click', async () => {
    const team = rosterPayload(rosterFor(letter));
    if (!team.name.trim()) { flashText(els.save, 'Needs a name', 'Save to library'); return; }
    try {
      const res = await fetch('/api/library/teams', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(team),
      });
      if (!res.ok) throw new Error();
      flashText(els.save, 'Saved', 'Save to library');
    } catch (e) {
      flashText(els.save, 'Save failed', 'Save to library');
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

function renderRosterSummary(letter) {
  const team = rosterFor(letter);
  const els = rosterEls[letter];
  const open = isRosterOpen(letter);
  els.box.classList.toggle('collapsed', !open);
  els.toggle.textContent = open ? 'Done' : 'Edit';
  els.box.style.setProperty('--team', toHex6(team.color) || DEFAULT_COLORS[letter]);
  els.sumName.textContent = team.name || 'Not set yet';
  const n = rosterPayload(team).players.length;
  els.sumMeta.textContent = [team.tag, `${n} player${n === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  if (team.logoUrl) { els.sumLogo.src = mediaUrl(team.logoUrl); els.sumLogo.hidden = false; }
  else { els.sumLogo.removeAttribute('src'); els.sumLogo.hidden = true; }
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
  gt.addEventListener('input', () => { player.gamertag = gt.value; renderRosterSummary(letter); pushDraft(); });
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
  els.logoField.render();
  els.players.innerHTML = '';
  team.players.forEach((p) => els.players.appendChild(buildPlayerRow(letter, p)));
  renderRosterSummary(letter);
}

function useLibraryTeam(letter, t) {
  setRoster(letter, normalizeRoster(t));
  renderRosterEditor(letter);
  pushDraft();
  toast(`${t.name} is now Team ${letter}.`);
}

// --- Scoreboard --------------------------------------------------------------------
//
// One scoreboard for every game. Series score always; the Smash crew-battle
// stock counter when turned on. Stocks are tracked as a count lost per team;
// the overlay derives who is on stage from it (crew order = Teams order).
// Counter changes go straight to live by default (see applyScore in
// server.js): a stock or a map is won in real time, and waiting on Push Live
// plus a transition for each one would be unusable.

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
  if (changed) { renderScorePanel(); scheduleStripRender(); }
}

// Each team's column: a big team-coloured Won button, the score, and the
// stock buttons for crew battles. The key that does the same is on each one.
const SCORE_KEYS = { A: { lose: '1', undo: 'Shift+1', win: '3' }, B: { lose: '2', undo: 'Shift+2', win: '4' } };
function buildScoreSide(t) {
  const k = SCORE_KEYS[t];
  $id('sbSide' + t).innerHTML = `
    <div class="sb-side-head"><span class="sb-side-name" id="sbName${t}">Team ${t}</span><b class="sb-score-big" id="sbScore${t}">0</b></div>
    <button class="sb-win-big" type="button" data-sb="win" data-team="${t}"><span id="sbWin${t}">Won game</span><kbd>${k.win}</kbd></button>
    <div class="sb-score-row">
      <span class="lbl" id="sbWonLbl${t}">Games won</span>
      <button class="btn-secondary sb-step" type="button" data-sb="score-" data-team="${t}" aria-label="Remove a point" title="Remove a point">&minus;</button>
      <button class="btn-secondary sb-step" type="button" data-sb="score+" data-team="${t}" aria-label="Add a point" title="Add a point (stocks stay as they are)">+</button>
    </div>
    <div class="sb-side-stock sb-stock-only"><span id="sbStock${t}"></span></div>
    <div class="sb-side-onstage sb-stock-only" id="sbOn${t}"></div>
    <div class="sb-btns sb-stock-only">
      <button class="sb-big" type="button" data-sb="lose" data-team="${t}">Lost a stock <kbd>${k.lose}</kbd></button>
      <button class="btn-secondary" type="button" data-sb="undo" data-team="${t}">Undo <kbd>${k.undo}</kbd></button>
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
    const color = toHex6(team.color) || DEFAULT_COLORS[t];
    const side = $id('sbSide' + t);
    side.style.setProperty('--team', color);
    side.style.setProperty('--team-ink', inkFor(color));
    const lost = Math.min(scoreboard['lost' + t] || 0, total);
    const left = total - lost;
    $id('sbName' + t).textContent = team.name || `Team ${t}`;
    $id('sbStock' + t).innerHTML = `<span><b>${left}</b> / ${total} stocks left</span>`;
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
  scheduleStripRender();
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (sbInstantInput.checked) {
    ws.send(JSON.stringify({ type: 'score', scoreboard: scoreboardCounters() }));
  } else {
    ws.send(JSON.stringify({ type: 'update', channel: 'draft', data: { scoreboard: scoreboardCounters() } }));
  }
}

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
// page {type:'rl'} snapshots. Here they only drive the status box and the
// header light: whether the game is connected, whether the game is set up to
// share match data (with a button to do that), and a hint when the teams look
// swapped.

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

function renderRlLight() {
  const isRl = sbStyleInput.value === 'rl';
  const light = $id('rlConn');
  light.hidden = !isRl;
  if (!isRl) return;
  const connected = !!(rlSnap && rlSnap.status === 'connected');
  $id('rlConnDot').className = 'dot' + (connected ? ' connected' : ' warn');
  $id('rlConnText').textContent = connected ? 'Rocket League' : 'Rocket League: waiting';
}

function renderRlStatus() {
  renderRlLight();
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
      text = 'Rocket League is not set up to share match data yet';
      sub = 'Click Connect to Rocket League, then restart the game. It only reads this setting when it starts.';
      canEnable = true;
    } else {
      sub = 'Start Rocket League and it connects by itself. If the game was already running when it was set up, restart it.';
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
      showRlNote('Done. Fully close Rocket League and start it again, and it will connect.');
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
  const list = rlSeries.games || [];
  const want = rlScreen.screen === 'game' ? rlScreen.game : list.length - 1;
  rlGamePick.innerHTML = '';
  list.forEach((g, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `Game ${i + 1}: ${g.goals[0]}-${g.goals[1]}`;
    rlGamePick.appendChild(o);
  });
  if (list.length) rlGamePick.value = String(Math.max(0, want));
  rlGamePick.hidden = !list.length;
  document.querySelectorAll('[data-rls]').forEach((b) => {
    b.classList.toggle('on', b.dataset.rls === rlScreen.screen);
    b.disabled = b.dataset.rls === 'game' && !list.length;
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
sbStyleInput.addEventListener('change', renderRlStatus);

// --- Draft form -------------------------------------------------------------------

function updateUrlDisplay() {
  obsUrl.value = `${location.origin}/overlay`;
  $id('dockUrl').value = `${location.origin}/control`;
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
    data.durationSec = parseDuration(durationInput.value);
  }
  data.teamA = rosterPayload(rosterA);
  data.teamB = rosterPayload(rosterB);
  return data;
}

function showCountdownMode() {
  durationField.style.display = modeDuration.checked ? '' : 'none';
  atField.style.display = modeAt.checked ? '' : 'none';
  $id('restartRow').style.display = modeDuration.checked ? '' : 'none';
}

function populateForm(state) {
  applyingRemote = true;
  currentMode = state.mode === 'smash' ? 'scoreboard' : (state.mode || 'starting-soon');
  currentNeccUrl = state.neccUrl || '';
  currentNeccType = state.neccType || '';
  if (currentMode === 'necc' && currentNeccType) {
    // Make sure the saved NECC type has an option to select, even if the
    // operator has since unchecked it in settings - the strip should always
    // reflect what the draft is actually showing.
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
  showCountdownMode();
  if (isAt && state.end) atInput.value = toDatetimeLocalValue(state.end);
  else if (!isAt) durationInput.value = formatDuration(state.durationSec);
  const match = games.find((g) => g.name === state.game || g.id === state.game);
  gameSelect.value = match ? match.id : '';
  renderMontages();
  // A full state carries the counters; an undo snapshot or saved match
  // doesn't, and then the current score is kept.
  scoreboard = { ...defaultScoreboard(), ...scoreboardCounters(), ...(state.scoreboard || {}) };
  setScoreboardConfig(scoreboard);
  refreshFileFields();
  applyInspector();
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
  // Roster names/crew size feed the scoreboard card's "on stage" readout, and
  // every field can change an overlay card's thumbnail.
  renderScorePanel();
  scheduleStripRender();
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
    pushStatus.textContent = 'Preview has changes that are not on stream yet';
  } else {
    pushStatus.textContent = lastPushedAt ? `Pushed live at ${lastPushedAt}` : 'Preview matches the stream';
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
    // draft from last time), after a revert, or when something outside this
    // panel changed the draft (a remote button, another panel's revert,
    // marked `repopulate`). Otherwise this panel is the writer to "draft":
    // applying our own broadcast echoes back onto the form would race edits.
    if (msg.type === 'state' && msg.channel === 'draft') {
      if (!receivedInitialDraft || repopulateOnNextDraft || msg.repopulate) {
        const first = !receivedInitialDraft;
        receivedInitialDraft = true;
        repopulateOnNextDraft = false;
        clearTimeout(draftDebounce);
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
      applyInspector();
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
    if (msg.type === 'prefs') applyPrefs(msg.prefs);
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
      showRlNote(`Game over: ${name} won, and the series score was updated. Use + or − to correct it.`);
    }
    if (msg.type === 'montages') {
      montageStatus = msg.montages || {};
      renderMontages();
    }
    if (msg.type === 'library') {
      library = msg.library || { teams: [], matches: [] };
      renderLibrary();
      if (!libraryLoaded) { libraryLoaded = true; maybeAutoWizard(); }
    }
  });
}

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
// The server downloads each game's highlight video (montage) from Drive on
// demand (montages.js) and broadcasts progress; this only displays it and
// asks for downloads.
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
  else if (!m) gameMontageStatus.textContent = 'No highlight video for this game.';
  else gameMontageStatus.textContent = clipInput.value.trim()
    ? 'Highlight video: replaced by the background video picked on the Live page.'
    : 'Highlight video: ' + montageText(m);
  gameMontageStatus.classList.toggle('error', !!(m && m.error && !m.have));

  // Settings list.
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
  if (!$id('wizard').hidden) renderWizVideos();
}

$id('montageAllBtn').addEventListener('click', () => requestMontage(''));
clipInput.addEventListener('input', renderMontages);

copyUrlBtn.addEventListener('click', () => copyText(obsUrl.value, copyUrlBtn));

[modeDuration, modeAt].forEach((el) => el.addEventListener('change', () => {
  showCountdownMode();
  pushDraft();
}));
// Tidy what was typed ("10" becomes "10:00") once the field is left.
durationInput.addEventListener('blur', () => {
  if (durationInput.value.trim()) durationInput.value = formatDuration(parseDuration(durationInput.value));
});

restartCountdownBtn.addEventListener('click', () => {
  if (modeAt.checked) return;
  restartPending = true;
  sendDraftNow();
  flashText(restartCountdownBtn, 'Restarted in preview', 'Restart countdown');
});

// A draft update on any edit anywhere on the pages, except in parts marked
// data-nodraft (OBS connection, music, search, display), which save
// themselves elsewhere.
['input', 'change'].forEach((type) => pageCol.addEventListener(type, (e) => {
  if (e.target.closest && e.target.closest('[data-nodraft]')) return;
  pushDraft();
}));

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

// --- Overlay strip ------------------------------------------------------------------
//
// Starting Soon, Rosters, Scoreboard, NECC graphics and the rest are ordinary
// draft edits: the preview updates instantly, the stream doesn't change until
// Push Live (or right away with "Push live as soon as I pick an overlay").
// Widener overlays also load their own text and countdown into the form.
// NECC overlays render inside our own /overlay page as a full-bleed iframe,
// so OBS never needs to know anything changed either way.
//
// Each card's thumbnail is drawn from the panel's own fields, not a live copy
// of the overlay page, so the strip costs nothing to keep current. Green ring
// = in the preview, red = on stream.

function isLiveOption(value) {
  const [kind, key] = value.split(':');
  if (kind === 'widener') return liveMode === key;
  return liveMode === 'necc' && liveNeccType === key;
}

function overlayLabel(mode, neccType) {
  if (mode === 'necc') {
    const t = NECC_TYPES.find((x) => x.key === neccType);
    return t ? t.label : 'NECC graphic';
  }
  return MODE_NAMES[mode] || '';
}

function thumbHtml(kind, key) {
  if (kind === 'necc') {
    const t = NECC_TYPES.find((x) => x.key === key);
    return `<span class="ov-thumb"><span class="t-necc">NECC<small>${esc(t ? t.label : key)}</small></span></span>`;
  }
  const vt = viewTextFor(key);
  const a = rosterPayload(rosterA), b = rosterPayload(rosterB);
  const short = (t, L) => t.tag || t.name || L;
  switch (key) {
    case 'starting-soon':
    case 'post-match': {
      let count = formatDuration((MODE_DEFAULTS[key] || {}).durationSec);
      if (key === currentMode) {
        count = modeAt.checked ? (atInput.value ? atInput.value.slice(11, 16) : '') : formatDuration(parseDuration(durationInput.value));
      }
      const left = key === 'post-match' && layoutInput.value === 'left';
      return `<span class="ov-thumb${left ? ' left' : ''}"><span class="t-bar"></span>`
        + `<span class="t-text"><span class="t-pill"></span><span class="t-title">${esc(vt.title)}</span><span class="t-count">${esc(count)}</span></span>`
        + `${montageInput.checked ? '<span class="t-video"></span>' : ''}</span>`;
    }
    case 'roster':
      return `<span class="ov-thumb"><span class="t-bar"></span><span class="t-teams"><b>${esc(short(a, 'A'))}</b><i>VS</i><b>${esc(short(b, 'B'))}</b></span></span>`;
    case 'brb':
      return `<span class="ov-thumb"><span class="t-big">${esc(vt.title || 'Be Right Back')}</span></span>`;
    case 'scoreboard': {
      const [l, r] = scoreboard.swap ? [b, a] : [a, b];
      const [ls, rs] = scoreboard.swap ? [scoreboard.scoreB, scoreboard.scoreA] : [scoreboard.scoreA, scoreboard.scoreB];
      return `<span class="ov-thumb scoreboard"><span class="t-sb"><span>${esc(short(l, 'A'))}</span><em>${ls || 0}</em><em>${rs || 0}</em><span>${esc(short(r, 'B'))}</span></span></span>`;
    }
    default:
      return '<span class="ov-thumb"></span>';
  }
}

function renderOverlayButtons() {
  overlayBtns.innerHTML = '';
  Array.from(overlaySelect.options).forEach((opt, i) => {
    const [kind, key] = opt.value.split(':');
    const active = opt.value === overlaySelect.value;
    const live = isLiveOption(opt.value);
    const unavailable = kind === 'necc' && !lastImportedOverlayUrls[key];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ov-card';
    b.classList.toggle('active', active);
    b.classList.toggle('is-live', live);
    b.classList.toggle('unavailable', unavailable);
    b.dataset.value = opt.value;
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
    b.title = unavailable ? 'Import a match in Prep first' : `${opt.textContent}${i < 9 ? ` (Ctrl+${i + 1})` : ''}`;
    b.innerHTML = thumbHtml(kind, key)
      + `<span class="ov-name">${esc(opt.textContent)}</span>`
      + `<span class="ov-meta">${unavailable ? '<span class="ov-need">Needs a match import</span>' : (i < 9 ? `<kbd>Ctrl+${i + 1}</kbd>` : '')}</span>`
      + (live ? '<span class="ov-badge live">LIVE</span>' : '')
      + (active ? '<span class="ov-badge prev">PREVIEW</span>' : '');
    overlayBtns.appendChild(b);
  });
}

let stripFrame = 0;
function scheduleStripRender() {
  if (stripFrame) return;
  stripFrame = requestAnimationFrame(() => {
    stripFrame = 0;
    renderOverlayButtons();
    renderInspectorRosters();
  });
}

overlayBtns.addEventListener('click', (e) => {
  const b = e.target.closest('.ov-card');
  if (!b) return;
  if (b.classList.contains('unavailable')) { gotoImport(b.dataset.value.split(':')[1]); return; }
  selectOverlay(b.dataset.value);
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
    loadViewText(key);
    // The countdown is global, not per view, so an overlay with its own
    // countdown resets it to that overlay's starting point.
    const d = MODE_DEFAULTS[key];
    if (d && d.durationSec !== undefined) {
      durationInput.value = formatDuration(d.durationSec);
      modeDuration.checked = true; modeAt.checked = false;
      showCountdownMode();
      restartPending = true;
    }
  } else {
    const url = lastImportedOverlayUrls[key];
    if (!url) { gotoImport(key); return; }
    stashViewText();
    currentMode = 'necc';
    loadViewText('necc');
    currentNeccType = key;
    currentNeccUrl = url;
    overlaySelect.value = value;
  }
  applyInspector();
  renderOverlayButtons();
  renderScorePanel();
  sendDraftNow();
  if (switchPushInput.checked) doPush();
}

// A NECC card with no imported match takes the operator to the import box.
function gotoImport(key) {
  const t = NECC_TYPES.find((x) => x.key === key);
  setPage('prep');
  openSection('prep-match');
  neccStatus.textContent = `Import a match to use ${t ? t.label : 'that NECC graphic'}.`;
  neccStatus.classList.add('error');
  neccUrlInput.focus();
  neccUrlInput.scrollIntoView({ block: 'center' });
}

// --- Inspector --------------------------------------------------------------------
//
// The Live page shows only the fields of the overlay in the preview. Every
// group lists its overlays in data-modes. The Scoreboard card also shows while
// the scoreboard is on stream, so the score can be kept while the next
// overlay is being prepared.

function applyInspector() {
  document.querySelectorAll('#inspector [data-modes]').forEach((el) => {
    el.hidden = !el.dataset.modes.split(' ').includes(currentMode);
  });
  const label = overlayLabel(currentMode, currentNeccType);
  inspTitle.textContent = label;
  previewWhat.textContent = label;
  liveWhat.textContent = liveMode ? overlayLabel(liveMode, liveNeccType) : '';
  scorePanel.style.display = (currentMode === 'scoreboard' || liveMode === 'scoreboard') ? '' : 'none';
  sbLiveTag.hidden = liveMode !== 'scoreboard';
  // The Scoreboard card already is the scoreboard's set of fields. While the
  // scoreboard is only on stream, the preview's fields come first and the
  // scoreboard card follows them.
  $id('inspector').hidden = currentMode === 'scoreboard';
  scorePanel.style.order = currentMode === 'scoreboard' ? '' : '2';
  renderInspectorRosters();
}

function renderInspectorRosters() {
  if (currentMode !== 'roster') return;
  rosterSummary.innerHTML = '';
  ['A', 'B'].forEach((L) => {
    const t = rosterPayload(rosterFor(L));
    const d = document.createElement('div');
    d.className = 'rs-team';
    d.style.setProperty('--team', toHex6(t.color) || DEFAULT_COLORS[L]);
    if (t.logoUrl) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = mediaUrl(t.logoUrl);
      d.appendChild(img);
    }
    const txt = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = t.name || `Team ${L} is not set`;
    const meta = document.createElement('small');
    meta.textContent = `${t.players.length} player${t.players.length === 1 ? '' : 's'}`;
    txt.append(name, meta);
    d.appendChild(txt);
    rosterSummary.appendChild(d);
  });
}

// --- NECC / LeagueOS import ---------------------------------------------------------

const NECC_TYPES = [
  { key: 'stageBracket', label: 'Bracket' },
  { key: 'seasonHeader', label: 'Season Header' },
  { key: 'matchPreview', label: 'Match Preview' },
  { key: 'matchActivity', label: 'Match Activity' },
  { key: 'matchProgress', label: 'Match Progress' },
  { key: 'matchRosters', label: 'Match Rosters (LeagueOS)' },
];
// Overlay asset URLs (bracket, matchPreview, etc.) resolved by the last
// successful import, keyed by NECC type - what the NECC cards actually point
// at. Kept in the server's panel preferences so every window has them and
// they survive an app restart.
let lastImportedOverlayUrls = {};
let enabledNeccTypes = new Set(DEFAULT_NECC_TYPES);

function setNeccOverlayUrls(urls) {
  lastImportedOverlayUrls = urls || {};
  // If a NECC graphic is being previewed, follow it to the new match.
  if (currentMode === 'necc' && lastImportedOverlayUrls[currentNeccType]) currentNeccUrl = lastImportedOverlayUrls[currentNeccType];
  savePrefs({ neccOverlayUrls: lastImportedOverlayUrls });
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
      savePrefs({ neccTypes: Array.from(enabledNeccTypes) });
    });
    neccTypeList.appendChild(label);
  });
}

function refreshNeccDropdownOptions() {
  const current = overlaySelect.value;
  neccOptGroup.innerHTML = '';
  NECC_TYPES.filter((t) => enabledNeccTypes.has(t.key) || (currentMode === 'necc' && currentNeccType === t.key)).forEach((t) => {
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
  if (!url) { neccUrlInput.focus(); return; }
  neccStatus.textContent = 'Importing…';
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

    // Auto-fill from the imported match. An import is an explicit "load this
    // match" action, so these overwrite whatever the previous match left
    // behind - only filling empty fields meant a second import kept showing
    // the old opponent in the subtitle.
    if (data.game) teamInput.value = data.game;
    neccBestOf = data.bestOf || null;
    if (neccBestOf) sbBestOfInput.value = String(neccBestOf);
    // "vs <opponent>" goes on Starting Soon, whichever overlay is in the
    // preview while importing.
    const widener = data.teams.find((t) => /widener/i.test(t.org || t.name || ''));
    const opponent = data.teams.find((t) => t !== widener) || data.teams[1];
    if (opponent && opponent.name) {
      const sub = `vs ${opponent.name}`;
      if (currentMode === 'starting-soon') subtitleInput.value = sub;
      else viewTexts['starting-soon'] = { ...(viewTexts['starting-soon'] || MODE_DEFAULTS['starting-soon']), subtitle: sub };
    }
    if (data.scheduledAt) {
      modeAt.checked = true;
      modeDuration.checked = false;
      showCountdownMode();
      atInput.value = toDatetimeLocalValue(data.scheduledAt);
    }
    if (!matchNameInput.value && data.teams[0] && data.teams[1]) {
      matchNameInput.value = `${data.teams[0].name} vs ${data.teams[1].name}`;
    }

    const urlCount = Object.keys(lastImportedOverlayUrls).length;
    neccStatus.textContent = `Loaded ${data.game || 'match'}${data.eventName ? `, ${data.eventName}` : ''}${data.bestOf ? `, best of ${data.bestOf}` : ''}${urlCount ? ` (${urlCount} NECC graphics ready)` : ' (no NECC graphics were found for this match)'}. Both teams were saved to the team library.`;
    // Every view's text, so the Starting Soon subtitle lands even when
    // another overlay is in the preview.
    if (ws && ws.readyState === WebSocket.OPEN) {
      clearTimeout(draftDebounce);
      sendDraft({ ...buildDraft(), views: allViewTexts() });
    }
    renderScorePanel();
    renderOverlayButtons();
  } catch (err) {
    neccStatus.textContent = err.message || 'Failed to import match';
    neccStatus.classList.add('error');
  } finally {
    neccFetchBtn.disabled = false;
  }
});
neccUrlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') neccFetchBtn.click(); });

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
    sel.innerHTML = `<option value="">${library.teams.length ? 'Load a saved team…' : 'No saved teams yet'}</option>`;
    library.teams.forEach((t) => {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.tag ? `${t.name} (${t.tag})` : t.name;
      sel.appendChild(o);
    });
  });

  renderTeamCards();
}

// The team library as cards: logo, colour, tag and size at a glance, with
// buttons to use a team, edit it, or delete it (undoable for a few seconds).
function renderTeamCards() {
  const q = libSearch.value.trim().toLowerCase();
  libTeamList.innerHTML = '';
  if (!library.teams.length) {
    libTeamList.innerHTML = '<div class="lib-empty">No saved teams yet. Use Save to library under Teams, or import a NECC match.</div>';
    return;
  }
  const list = library.teams.filter((t) => !q || `${t.name} ${t.tag}`.toLowerCase().includes(q));
  if (!list.length) {
    libTeamList.innerHTML = '<div class="lib-empty">No saved team matches that search.</div>';
    return;
  }
  list.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'team-card';
    const color = toHex6(t.color);
    if (color) { card.style.setProperty('--team', color); card.style.setProperty('--team-ink', inkFor(color)); }
    const top = document.createElement('div');
    top.className = 'tc-top';
    if (t.logoUrl) {
      const img = document.createElement('img');
      img.className = 'tc-logo'; img.alt = ''; img.src = mediaUrl(t.logoUrl);
      top.appendChild(img);
    } else {
      const mono = document.createElement('span');
      mono.className = 'tc-mono';
      mono.textContent = (t.tag || t.name || '?').slice(0, 3).toUpperCase();
      top.appendChild(mono);
    }
    const names = document.createElement('div');
    names.className = 'tc-names';
    const nm = document.createElement('b');
    nm.textContent = t.name;
    const meta = document.createElement('small');
    const n = (t.players || []).length;
    meta.textContent = [t.tag, `${n} player${n === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    names.append(nm, meta);
    top.appendChild(names);
    const actions = document.createElement('div');
    actions.className = 'tc-actions';
    const mk = (text, cls, fn, title) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn-secondary' + (cls ? ' ' + cls : ''); b.textContent = text;
      if (title) b.title = title;
      b.addEventListener('click', fn);
      actions.appendChild(b);
    };
    mk('Team A', '', () => useLibraryTeam('A', t), 'Use as Team A');
    mk('Team B', '', () => useLibraryTeam('B', t), 'Use as Team B');
    mk('Edit', '', () => openTeamSheet(t));
    mk('Delete', 'btn-quiet-danger', () => deleteTeam(t));
    card.append(top, actions);
    libTeamList.appendChild(card);
  });
}
libSearch.addEventListener('input', renderTeamCards);

async function deleteTeam(t) {
  await fetch(`/api/library/teams/${encodeURIComponent(t.id)}`, { method: 'DELETE' }).catch(() => {});
  toast(`Deleted ${t.name} from the team library.`, 'Undo', () => {
    fetch('/api/library/teams', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) }).catch(() => {});
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

// Deleted at once, with Undo for a few seconds, instead of a confirm step.
matchDeleteBtn.addEventListener('click', async () => {
  const m = library.matches.find((x) => x.id === matchSelect.value);
  if (!m) return;
  await fetch(`/api/library/matches/${encodeURIComponent(m.id)}`, { method: 'DELETE' }).catch(() => {});
  toast(`Deleted the saved match "${m.name}".`, 'Undo', () => {
    fetch('/api/library/matches', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: m.id, name: m.name, data: m.data }),
    }).catch(() => {});
  });
});

// --- Team sheet -----------------------------------------------------------------------
//
// Edits a saved team in place (name, tag, colour, logo, players) without
// touching Team A or Team B. Saving updates the library entry by id.

const teamSheet = $id('teamSheet');
const teamSheetBackdrop = $id('teamSheetBackdrop');
const tsName = $id('tsName');
const tsTag = $id('tsTag');
const tsColor = $id('tsColor');
const tsLogo = $id('tsLogo');
const tsPlayers = $id('tsPlayers');
let tsLogoField = null;
let sheetTeam = null;
let sheetColorTouched = false;

function openTeamSheet(team) {
  sheetTeam = JSON.parse(JSON.stringify(team));
  sheetTeam.players = sheetTeam.players || [];
  sheetColorTouched = false;
  tsName.value = sheetTeam.name || '';
  tsTag.value = sheetTeam.tag || '';
  tsColor.value = toHex6(sheetTeam.color) || '#0054b8';
  tsLogo.value = sheetTeam.logoUrl || '';
  tsLogoField.render();
  renderSheetPlayers();
  $id('teamSheetTitle').textContent = `Edit ${sheetTeam.name || 'team'}`;
  teamSheet.hidden = false;
  teamSheetBackdrop.hidden = false;
  tsName.focus();
}
function closeTeamSheet() {
  teamSheet.hidden = true;
  teamSheetBackdrop.hidden = true;
  sheetTeam = null;
}
function renderSheetPlayers() {
  tsPlayers.innerHTML = '';
  sheetTeam.players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'ret-player';
    const gt = document.createElement('input');
    gt.type = 'text'; gt.className = 'ret-gamertag'; gt.placeholder = 'Gamertag'; gt.value = p.gamertag || '';
    const rn = document.createElement('input');
    rn.type = 'text'; rn.className = 'ret-realname'; rn.placeholder = 'Real name (optional)'; rn.value = p.name || '';
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'ret-remove'; rm.title = 'Remove player'; rm.textContent = '×';
    gt.addEventListener('input', () => { p.gamertag = gt.value; });
    rn.addEventListener('input', () => { p.name = rn.value; });
    rm.addEventListener('click', () => { sheetTeam.players.splice(i, 1); renderSheetPlayers(); });
    row.append(gt, rn, rm);
    tsPlayers.appendChild(row);
  });
}
$id('tsAddPlayer').addEventListener('click', () => {
  sheetTeam.players.push({ name: '', gamertag: '' });
  renderSheetPlayers();
  const rows = tsPlayers.querySelectorAll('.ret-gamertag');
  if (rows.length) rows[rows.length - 1].focus();
});
tsColor.addEventListener('input', () => { sheetColorTouched = true; });
$id('teamSheetSave').addEventListener('click', async () => {
  const btn = $id('teamSheetSave');
  const team = {
    ...sheetTeam,
    name: tsName.value.trim(),
    tag: tsTag.value.trim(),
    color: sheetColorTouched || sheetTeam.color ? tsColor.value : '',
    logoUrl: tsLogo.value.trim(),
    players: sheetTeam.players.filter((p) => (p.gamertag || '').trim() || (p.name || '').trim()),
  };
  if (!team.name) { flashText(btn, 'Needs a name', 'Save team'); tsName.focus(); return; }
  try {
    const res = await fetch('/api/library/teams', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(team) });
    if (!res.ok) throw new Error();
    closeTeamSheet();
    toast(`Saved ${team.name}.`);
  } catch (e) {
    flashText(btn, 'Save failed', 'Save team');
  }
});
$id('teamSheetCancel').addEventListener('click', closeTeamSheet);
$id('teamSheetClose').addEventListener('click', closeTeamSheet);
teamSheetBackdrop.addEventListener('click', closeTeamSheet);

// --- Pages and collapsible cards ----------------------------------------------------
//
// Prep: what is set up before a match. Live: what is used during it.
// Settings: what is set once. A card heading folds its card away; which are
// folded is remembered per window.

const PAGE_KEY = 'widener-page';
const PAGES = ['prep', 'live', 'settings'];
function setPage(name) {
  if (!PAGES.includes(name)) name = 'live';
  layoutEl.dataset.page = name;
  document.querySelectorAll('.page-btn').forEach((b) => {
    const on = b.dataset.page === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.page[data-page]').forEach((p) => { p.hidden = p.dataset.page !== name; });
  lsSet(PAGE_KEY, name);
  pageCol.scrollTop = 0;
  requestAnimationFrame(fitMonitors);
}
function initialPage() {
  const saved = lsGet(PAGE_KEY);
  if (PAGES.includes(saved)) return saved;
  // v0.11 had Show and Setup tabs.
  return lsGet('widener-tab') === 'setup' ? 'settings' : 'live';
}
document.querySelectorAll('.page-btn').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.page)));

const COLLAPSED_KEY = 'widener-collapsed';
// The long remote-control address list starts folded.
let collapsedSections = new Set(['set-remote']);
try { const saved = JSON.parse(lsGet(COLLAPSED_KEY)); if (Array.isArray(saved)) collapsedSections = new Set(saved); } catch (e) {}
function applyCollapsed() {
  document.querySelectorAll('.collapsible[data-section]').forEach((c) => {
    c.classList.toggle('collapsed', collapsedSections.has(c.dataset.section));
  });
}
function saveCollapsed() { lsSet(COLLAPSED_KEY, JSON.stringify(Array.from(collapsedSections))); applyCollapsed(); }
function openSection(key) { collapsedSections.delete(key); saveCollapsed(); }
document.addEventListener('click', (e) => {
  const head = e.target.closest && e.target.closest('.collapsible > .card-head');
  if (!head || e.target.closest('.info, button, a, input, select, label')) return;
  const key = head.parentElement.dataset.section;
  if (!key) return;
  if (collapsedSections.has(key)) collapsedSections.delete(key); else collapsedSections.add(key);
  saveCollapsed();
});
// "Edit teams in Prep" and the like.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-goto]');
  if (!b) return;
  const key = b.dataset.goto;
  setPage(key.split('-')[0] === 'set' ? 'settings' : 'prep');
  openSection(key);
  const card = document.querySelector(`[data-section="${key}"]`);
  if (card) card.scrollIntoView({ block: 'start' });
});

// --- Monitors -----------------------------------------------------------------------
//
// Each monitor renders the overlay at its real 1920x1080 and scales the whole
// thing down to fit, so proportions always match the real stream. The box's
// pixel size is computed here (not CSS aspect-ratio + max-height, which
// doesn't reliably shrink the width when the height is the tighter limit) so
// it's always exactly 16:9 whichever dimension is binding.

const previewFrame = $id('previewFrame');
const liveFrame = $id('liveFrame');
const monitorParts = [
  [$id('previewWrap'), $id('previewBox'), $id('previewScaler')],
  [$id('liveWrap'), $id('liveBox'), $id('liveScaler')],
];
function fitMonitor([wrap, box, scaler]) {
  const availW = wrap.clientWidth;
  const availH = wrap.clientHeight;
  if (!availW || !availH) return;
  let w = availW, h = w * 9 / 16;
  if (h > availH) { h = availH; w = h * 16 / 9; }
  box.style.width = w + 'px';
  box.style.height = h + 'px';
  scaler.style.transform = `scale(${w / 1920})`;
}
function fitMonitors() { monitorParts.forEach(fitMonitor); }
const monitorObserver = new ResizeObserver(fitMonitors);
monitorParts.forEach(([wrap]) => monitorObserver.observe(wrap));

// --- Display (per window) ---------------------------------------------------------

const TEXT_KEY = 'widener-text-size';
const TEXT_SIZES = ['small', 'normal', 'large', 'xlarge'];
const TEXT_NAMES = { small: 'Small', normal: 'Normal', large: 'Large', xlarge: 'Extra large' };
function setTextSize(size, announce) {
  if (!TEXT_SIZES.includes(size)) size = 'normal';
  document.documentElement.dataset.text = size;
  document.querySelectorAll('#textSizeSeg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.size === size));
  lsSet(TEXT_KEY, size);
  requestAnimationFrame(fitMonitors);
  if (announce) toast(`Text size: ${TEXT_NAMES[size]}`, null, null, 1500);
}
function stepTextSize(d) {
  const i = TEXT_SIZES.indexOf(document.documentElement.dataset.text || 'normal');
  setTextSize(TEXT_SIZES[Math.max(0, Math.min(TEXT_SIZES.length - 1, i + d))], true);
}
document.querySelectorAll('#textSizeSeg .seg-btn').forEach((b) => b.addEventListener('click', () => setTextSize(b.dataset.size)));

// The live monitor runs a second copy of the overlay page, so a slower PC can
// turn it off. Off loads a blank page in its place rather than just hiding it.
const LIVE_MON_KEY = 'widener-live-monitor';
const liveMonitorInput = $id('liveMonitorInput');
const LIVE_MONITOR_SRC = '/overlay?monitor=1';
function setLiveMonitor(on) {
  layoutEl.classList.toggle('no-live', !on);
  liveMonitorInput.checked = on;
  const loaded = (liveFrame.getAttribute('src') || '') === LIVE_MONITOR_SRC;
  if (on && !loaded) liveFrame.src = LIVE_MONITOR_SRC;
  if (!on && loaded) liveFrame.src = 'about:blank';
  lsSet(LIVE_MON_KEY, on ? 'on' : 'off');
  requestAnimationFrame(fitMonitors);
}
liveMonitorInput.addEventListener('change', () => setLiveMonitor(liveMonitorInput.checked));

// --- Keyboard shortcuts ----------------------------------------------------------------------------

function isTypingTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'color', 'file', 'range'].includes(el.type);
}

function popupOpen() {
  return !$id('shortcutsModal').hidden || !teamSheet.hidden || !$id('wizard').hidden;
}

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    hideTip();
    if (!$id('shortcutsModal').hidden) { closeShortcuts(); return; }
    if (!teamSheet.hidden) { closeTeamSheet(); return; }
  }
  if (mod && e.key === 'Enter') { e.preventDefault(); doPush(); return; }
  // Text size. Taken here so Electron's whole-page zoom doesn't also run.
  if (mod && !e.altKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); stepTextSize(1); return; }
  if (mod && !e.altKey && (e.key === '-' || e.key === '_')) { e.preventDefault(); stepTextSize(-1); return; }
  if (mod && !e.altKey && e.key === '0') { e.preventDefault(); setTextSize('normal', true); return; }
  if (mod && !e.shiftKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
    const b = overlayBtns.querySelectorAll('.ov-card')[Number(e.code.slice(5)) - 1];
    if (b) { e.preventDefault(); b.click(); }
    return;
  }
  if (isTypingTarget(e.target) || popupOpen()) return;
  if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) { e.preventDefault(); openShortcuts(); return; }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return; }
  if (mod || e.altKey || e.repeat) return;
  // Scoreboard keys, only while its card is on screen.
  if (scorePanel.offsetParent === null) return;
  const keys = {
    Digit1: e.shiftKey ? ['undo', 'A'] : ['lose', 'A'],
    Digit2: e.shiftKey ? ['undo', 'B'] : ['lose', 'B'],
    Digit3: e.shiftKey ? null : ['win', 'A'],
    Digit4: e.shiftKey ? null : ['win', 'B'],
  };
  const hit = keys[e.code];
  if (hit) { e.preventDefault(); scoreAction(hit[0], hit[1]); }
});

// --- Shortcut list -----------------------------------------------------------------------

const shortcutsModal = $id('shortcutsModal');
function openShortcuts() { shortcutsModal.hidden = false; shortcutsModal.querySelector('[data-close]').focus(); }
function closeShortcuts() {
  if (shortcutsModal.contains(document.activeElement)) document.activeElement.blur();
  shortcutsModal.hidden = true;
}
shortcutsModal.addEventListener('click', (e) => {
  if (e.target === shortcutsModal || e.target.closest('[data-close]')) closeShortcuts();
});
$id('helpBtn').addEventListener('click', openShortcuts);
$id('shortcutsOpenBtn').addEventListener('click', openShortcuts);

// --- Info points --------------------------------------------------------------------------------
//
// One shared floating bubble serves every .info dot. It's position:fixed and
// clamped to the viewport, so a tip can't be clipped by a scrolling column or
// squeezed off-screen when the panel runs as a narrow OBS dock - which a
// CSS-only ::after tooltip would be. Shown on hover and on keyboard focus;
// dismissed on scroll, blur, or Escape.

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
// Capture phase so a scroll inside a page (which doesn't bubble) still
// dismisses a bubble anchored to a row that just moved.
document.addEventListener('scroll', hideTip, true);
window.addEventListener('resize', hideTip);
// An info dot inside a <label> would otherwise toggle that label's checkbox.
document.addEventListener('click', (e) => {
  const el = e.target.closest && e.target.closest('.info');
  if (el) { e.preventDefault(); showTip(el); }
});

// --- Toasts -------------------------------------------------------------------------------------
//
// A short message at the bottom of the window, optionally with one action
// (Undo). Used instead of confirm(), which is unreliable inside an OBS dock.

function toast(text, actionLabel, onAction, ms) {
  const box = $id('toasts');
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  const span = document.createElement('span');
  span.textContent = text;
  t.appendChild(span);
  let timer = 0;
  const close = () => { clearTimeout(timer); t.remove(); };
  if (actionLabel) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-secondary';
    b.textContent = actionLabel;
    b.addEventListener('click', () => { close(); if (onAction) onAction(); });
    t.appendChild(b);
  }
  // Only the newest few stay up.
  while (box.children.length >= 3) box.firstChild.remove();
  box.appendChild(t);
  timer = setTimeout(close, ms || (actionLabel ? 8000 : 3500));
}

// --- OBS dock URL copy + scene-sync -------------------------------------------------------------------
//
// All optional. Scene-sync talks to the server's /api/obs/* routes, which own
// the single obs-websocket connection; the password is entered here, sent
// over localhost, and only ever held in the server's memory (plus this
// machine's localStorage as a convenience) - never committed, never logged.
// After one successful Connect the panel connects again by itself whenever
// the app starts, and the server reconnects if OBS restarts.

const copyDockBtn = $id('copyDockBtn');
copyDockBtn.addEventListener('click', () => copyText($id('dockUrl').value, copyDockBtn));

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
let lastObsStatus = null;

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
  lastObsStatus = st;
  const connected = !!(st && st.connected);
  const reconnecting = !!(st && st.reconnecting);
  obsConnectBtn.disabled = connected;
  obsDisconnectBtn.disabled = !connected && !reconnecting;
  obsSyncControls.style.display = connected ? '' : 'none';
  obsSceneSyncActive = connected && !!(st && st.sceneSync);
  // Reflect scene-sync state onto the transition checkbox: when OBS owns
  // the transition, the in-overlay wipe is off and can't be toggled here.
  stingerInput.disabled = obsSceneSyncActive;
  // Explain the disabled checkbox in its own info point rather than a separate
  // note, so the reason sits exactly where the control is.
  const stingerInfo = stingerInput.parentElement.querySelector('.info');
  if (stingerInfo) {
    stingerInfo.setAttribute('data-tip', obsSceneSyncActive
      ? 'Off while the app switches your OBS scenes, because OBS plays its own transition. Two would stack on every push.'
      : 'Plays the curtain transition on stream whenever you push, hiding the switch.');
  }

  // Header light: only for operators who use the OBS connection.
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
  obsStatusEl.textContent = `Connected${st.sceneSync ? ' · switching scenes on Push Live' : ' · not switching scenes'}${scene}`;
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

// Returns the resulting status, so the setup guide can report it.
async function obsConnect(retry) {
  saveObsSettings();
  obsStatusEl.classList.remove('error');
  obsStatusEl.textContent = 'Connecting…';
  obsConnectBtn.disabled = true;
  let st = null;
  try {
    st = await fetch('/api/obs/connect', {
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
    st = (await obsInspect()) || st;
  } catch (e) {
    st = { connected: false, error: 'connection failed' };
    renderObsStatus(st);
  } finally {
    obsConnectBtn.disabled = !!(st && st.connected);
  }
  return st;
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

async function obsBuild() {
  try {
    const res = await fetch('/api/obs/build-scenes', { method: 'POST' }).then((r) => r.json());
    await obsInspect();
    return res;
  } catch (e) {
    return { error: 'Could not reach the app server' };
  }
}
obsBuildBtn.addEventListener('click', async () => {
  obsBuildStatus.classList.remove('error');
  obsBuildStatus.textContent = 'Building scenes in OBS…';
  obsBuildBtn.disabled = true;
  const res = await obsBuild();
  if (res.error) {
    obsBuildStatus.textContent = res.error || 'Failed to build scenes';
    obsBuildStatus.classList.add('error');
  } else {
    obsBuildStatus.textContent = `Ready: ${(res.built || []).join(', ')}`;
  }
  obsBuildBtn.disabled = false;
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
function musicVolText(v) { return `${Math.round(v)}%`; }
function renderMusic(m) {
  if (!m) return;
  musicEnable.checked = m.enabled;
  const dl = m.download || {};
  const usingTrack = !m.file || m.customMissing;
  musicFileText.value = m.file ? fileLabel(m.file) : 'Included track';
  musicFileText.title = m.path || '';
  if (document.activeElement !== musicVolume) musicVolume.value = String(m.volume);
  musicVolumeText.textContent = musicVolText(Number(musicVolume.value));
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
  else if (!m.obsConnected) text = 'No music is playing, because OBS is not connected. Connect it under OBS above.';
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
musicVolume.addEventListener('input', () => { musicVolumeText.textContent = musicVolText(Number(musicVolume.value)); });
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

// --- Remote control (v0.12.0) -----------------------------------------------------
//
// The addresses a Stream Deck or Companion button can POST to (see the
// /api/remote routes in server.js), each with a Copy button.

const REMOTE_ACTIONS = [
  ['Push Live', 'push'],
  ['Discard changes', 'discard'],
  ['Starting Soon', 'overlay/starting-soon'],
  ['Post-Match', 'overlay/post-match'],
  ['Rosters', 'overlay/roster'],
  ['Be Right Back', 'overlay/brb'],
  ['Scoreboard', 'overlay/scoreboard'],
  ['Team A won a game', 'score/a/win'],
  ['Team B won a game', 'score/b/win'],
  ['Team A +1 point', 'score/a/point'],
  ['Team A −1 point', 'score/a/unpoint'],
  ['Team B +1 point', 'score/b/point'],
  ['Team B −1 point', 'score/b/unpoint'],
  ['Team A lost a stock', 'score/a/stock'],
  ['Team B lost a stock', 'score/b/stock'],
  ['Team A undo stock', 'score/a/unstock'],
  ['Team B undo stock', 'score/b/unstock'],
  ['Swap sides', 'score/swap'],
];
function renderRemoteList() {
  const list = $id('remoteList');
  if (!list) return;
  const base = `${location.origin}/api/remote/`;
  const necc = NECC_TYPES.filter((t) => enabledNeccTypes.has(t.key)).map((t) => [`NECC ${t.label}`, `overlay/necc-${t.key}`]);
  list.innerHTML = '';
  REMOTE_ACTIONS.slice(0, 7).concat(necc, REMOTE_ACTIONS.slice(7)).forEach(([label, path]) => {
    const row = document.createElement('div');
    row.className = 'remote-row';
    const name = document.createElement('span');
    name.textContent = label;
    const code = document.createElement('code');
    code.textContent = base + path;
    code.title = base + path;
    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'btn-secondary'; copy.textContent = 'Copy';
    copy.addEventListener('click', () => copyText(base + path, copy));
    row.append(name, code, copy);
    list.appendChild(row);
  });
}

// --- Setup guide (v0.12.0) ---------------------------------------------------------
//
// A first-run walkthrough: how OBS should show the overlays (the app managing
// scenes, or one browser source), connecting, building scenes, and the game
// video downloads. It opens by itself only on a fresh install; Settings can
// run it again any time.

const wizard = $id('wizard');
const WIZ_SYNC = ['welcome', 'choice', 'connect', 'videos', 'done'];
const WIZ_SINGLE = ['welcome', 'choice', 'url', 'videos', 'done'];
let wizStep = 'welcome';
let wizardDecided = false;

function wizOrder() {
  const v = (document.querySelector('input[name="wizObsMode"]:checked') || {}).value;
  return v === 'single' ? WIZ_SINGLE : WIZ_SYNC;
}
function showWizStep(step) {
  wizStep = step;
  wizard.querySelectorAll('.wiz-step').forEach((s) => { s.hidden = s.dataset.step !== step; });
  const order = wizOrder();
  const idx = order.indexOf(step);
  $id('wizSteps').innerHTML = order.map((_, i) => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('');
  if (step === 'url') $id('wizUrl').value = `${location.origin}/overlay`;
  if (step === 'videos') renderWizVideos();
  if (step === 'connect') { $id('wizPass').value = obsPassInput.value; renderWizConnect(null); }
  const focus = wizard.querySelector(`.wiz-step[data-step="${step}"] input:not([type=radio]), .wiz-step[data-step="${step}"] [data-wiz="next"], .wiz-step[data-step="${step}"] [data-wiz="finish"]`);
  if (focus) focus.focus();
}
function openWizard() { wizard.hidden = false; showWizStep('welcome'); }
function closeWizard() {
  wizard.hidden = true;
  if (!prefs.setupDone) savePrefs({ setupDone: true });
}
wizard.addEventListener('click', (e) => {
  const b = e.target.closest('[data-wiz]');
  if (!b) return;
  const order = wizOrder();
  const i = order.indexOf(wizStep);
  if (b.dataset.wiz === 'next') showWizStep(order[Math.min(order.length - 1, i + 1)]);
  if (b.dataset.wiz === 'back') showWizStep(order[Math.max(0, i - 1)]);
  if (b.dataset.wiz === 'skip') { closeWizard(); toast('Setup skipped. Run it any time from Settings.'); }
  if (b.dataset.wiz === 'finish') { closeWizard(); setPage('live'); }
});

function renderWizConnect(res) {
  const st = $id('wizConnectStatus');
  const s = res || lastObsStatus;
  const connected = !!(s && s.connected);
  $id('wizBuildBtn').disabled = !connected;
  st.classList.remove('error');
  if (connected) st.textContent = res ? 'Connected to OBS. Now build the scenes.' : 'Already connected to OBS.';
  else if (res) {
    const err = String(res.error || '');
    const why = /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/.test(err) ? 'OBS is not answering. Check that OBS is open and its WebSocket server is turned on.'
      : /auth|password/i.test(err) ? 'OBS turned down the password. Copy it again from Show Connect Info.'
        : `${err ? err + '. ' : ''}Check that OBS is open, the WebSocket server is on, and the password is right.`;
    st.textContent = `Could not connect. ${why}`;
    st.classList.add('error');
  } else st.textContent = '';
}
$id('wizConnectBtn').addEventListener('click', async () => {
  obsPassInput.value = $id('wizPass').value;
  // The operator chose to let the app manage scenes.
  obsSyncEnable.checked = true;
  $id('wizConnectStatus').textContent = 'Connecting…';
  renderWizConnect(await obsConnect(false));
});
$id('wizBuildBtn').addEventListener('click', async () => {
  const st = $id('wizConnectStatus');
  st.classList.remove('error');
  st.textContent = 'Building scenes in OBS…';
  obsSyncEnable.checked = true;
  await pushObsSettings();
  const res = await obsBuild();
  if (res.error) { st.textContent = `Could not build the scenes: ${res.error}`; st.classList.add('error'); return; }
  st.textContent = `Done. OBS now has ${(res.built || []).length} scenes, and Push Live will switch between them.`;
});
$id('wizCopyUrl').addEventListener('click', () => copyText($id('wizUrl').value, $id('wizCopyUrl')));

function renderWizVideos() {
  const list = Object.values(montageStatus);
  const total = list.length;
  const have = list.filter((m) => m.have).length;
  const missing = list.reduce((sum, m) => sum + (m.have ? 0 : Math.max(0, m.bytes - (m.received || 0))), 0);
  $id('wizVideoSize').textContent = missing > 0
    ? `${total - have} of ${total} still need downloading, about ${fmtGB(missing)}.`
    : 'They are all on this PC already.';
  $id('wizDownloadBtn').disabled = missing <= 0;
  const dl = list.find((m) => m.downloading);
  $id('wizVideoStatus').textContent = dl
    ? `Downloading, ${have} of ${total} done. It carries on in the background, so you can continue.`
    : `${have} of ${total} on this PC.`;
}
$id('wizDownloadBtn').addEventListener('click', () => { requestMontage(''); $id('wizVideoStatus').textContent = 'Starting the downloads…'; });

// Opens by itself only on what looks like a fresh install: nothing saved in
// the library and OBS never connected from this window. An existing install
// (an upgrade) is marked as set up without asking.
function maybeAutoWizard() {
  if (wizardDecided || !prefsLoaded || !libraryLoaded) return;
  wizardDecided = true;
  if (prefs.setupDone) return;
  const fresh = !library.teams.length && !library.matches.length && !obsAutoConnect;
  if (fresh) openWizard(); else savePrefs({ setupDone: true });
}
$id('wizardOpenBtn').addEventListener('click', openWizard);

// --- Init -----------------------------------------------------------------------------------------------

try { rosterOpen = JSON.parse(lsGet(ROSTER_OPEN_KEY)) || {}; } catch (e) { rosterOpen = {}; }
makeFileField(logoInput, { accept: 'image/*', emptyText: 'Default Widener logo' });
makeFileField(clipInput, { accept: 'video/*', emptyText: "The game's highlight video" });
tsLogoField = makeFileField(tsLogo, { accept: 'image/*', emptyText: 'No logo' });
buildRosterEditor('A');
buildRosterEditor('B');
renderRosterEditor('A');
renderRosterEditor('B');
buildScoreSide('A');
buildScoreSide('B');
applyPrefs({});
renderLibrary();
applyCollapsed();
setTextSize(lsGet(TEXT_KEY) || 'normal');
setLiveMonitor(lsGet(LIVE_MON_KEY) !== 'off');
setPage(initialPage());
showCountdownMode();
applyInspector();
updateUrlDisplay();
loadObsSettings();
loadPrefs();
fetch('/api/music').then((r) => r.json()).then(renderMusic).catch(() => {});

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
    connect();
  });

// Reflect any connection that survived a panel reload, and connect by itself
// if this machine has connected before (e.g. the app was just started).
obsInspect().then((st) => {
  if (st && !st.connected && !st.reconnecting && obsAutoConnect) obsConnect(true);
});
