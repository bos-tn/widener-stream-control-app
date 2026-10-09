// Stream Control: control panel (v2.0.0, OBS first).
//
// OBS decides what is on stream. The app builds one OBS scene per overlay,
// each showing the same live match data, and the operator switches between
// them in OBS (Studio Mode previews a scene before it goes on air). The app
// cuts scenes itself only where a game's scoreboard calls for it (the stats
// after a Rocket League game, and back when the next one loads).
//
// The pages. Match sets a match up step by step: game, teams, details, then
// building the scenes. Live is for during the match: what is on air, the
// score, each scene's text and background, and the rosters. League (a league
// profile only) keeps each game's standings. Settings holds OBS, the stinger,
// music, videos, the team library, display and remote control.
//
// There is one match state on the server, shown on every scene at once. An
// edit goes out when a field is finished (Enter, or clicking away), so half
// typed text never reaches the stream. Every panel (the app window and an
// OBS dock) follows the server's state, except for the field being typed in.
//
// Sections, in order: brand, helpers, state + sending, preferences, file
// fields, rosters, Match page, Live page (on air, score, Rocket League,
// scenes), library + team sheet, League page, WebSocket, montages, pages, display,
// keyboard, shortcuts, info tips, toasts, OBS, stinger, music, remote
// control, setup guide, init.

const $id = (id) => document.getElementById(id);

// --- Brand (v1.0.0) ------------------------------------------------------------
//
// The league's name, logo, team colours and wording come from the app's
// profile (/brand.js, see profile.js on the server). Page text written as
// {{league}}, {{name}} and so on is filled in once, at start-up.

const BRAND = window.BRAND || {
  name: 'Stream Control', shortName: '', appName: 'Stream Control', panelLogo: '',
  league: { name: 'League', importHint: '' }, obsPrefix: '', socialHandle: '', matchExample: '', homeTeam: '',
  teamColors: { A: '#0054b8', B: '#f0b310' }, stinger: null, leagueTeams: 0, hasMusicTrack: false,
};
const LEAGUE = BRAND.league.name;
// The league's own scenes (Standings, Head to Head) and the scene
// backgrounds an operator can pick from. A school's own app has neither.
const LEAGUE_SCENES = [
  { key: 'matchup', label: 'Head to Head' },
  { key: 'standings', label: 'Standings' },
].filter((s) => (BRAND.leagueScenes || []).includes(s.key));
const BACKGROUNDS = (BRAND.backgrounds && BRAND.backgrounds.list) || [];
// The broadcast package's own scenes (a profile with a broadcast block): the
// week's matches, the matchup, and one per camera.
const BX = BRAND.broadcast || null;
const BX_SCENES = BX ? [
  { key: 'schedule', label: 'This Week', note: 'matches this week' },
  { key: 'versus', label: 'Matchup', note: 'both teams, before the match' },
].filter((s) => BX.scenes.includes(s.key)).concat(BX.cameras.map((c) => ({ key: `cam-${c.id}`, label: c.label, note: 'camera scene and window over the game' }))) : [];
// The typefaces the scene headlines can be set in, for a league with several.
const HEAD_FONTS = (BRAND.headlineFonts && BRAND.headlineFonts.list) || [];

function applyBrandText(root) {
  const tokens = {
    name: BRAND.name, short: BRAND.shortName, league: LEAGUE, prefix: BRAND.obsPrefix, appName: BRAND.appName,
    social: BRAND.socialHandle || 'handle', match: BRAND.matchExample,
    importHint: BRAND.league.importHint || `${LEAGUE} match page URL`,
  };
  const fill = (t) => t.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in tokens ? tokens[k] : m));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue.includes('{{')) n.nodeValue = fill(n.nodeValue);
  }
  const attrs = ['placeholder', 'data-tip', 'title', 'label', 'aria-label', 'alt'];
  root.querySelectorAll('[placeholder], [data-tip], [title], [label], [aria-label], [alt]').forEach((el) => {
    attrs.forEach((a) => { const v = el.getAttribute(a); if (v && v.includes('{{')) el.setAttribute(a, fill(v)); });
  });
}
applyBrandText(document.body);
document.title = BRAND.appName;
if (BRAND.panelLogo) $id('brandLogo').src = BRAND.panelLogo;

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

// A countdown length is typed as minutes:seconds ("10:00", "1:30"). A bare
// number is minutes. The server stores seconds.
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
function clockTime(d) { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// <input type=color> only accepts #rrggbb.
function toHex6(c) {
  c = String(c || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(c)) c = c.split('').map((ch) => ch + ch).join('');
  return /^[0-9a-f]{6}$/i.test(c) ? '#' + c.toLowerCase() : '';
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

// A destructive button (Reset score) asks for a second click within 3s
// instead of confirm(), which is unreliable inside an OBS dock.
function armed(btn, label) {
  if (btn.dataset.armedUntil && Date.now() < Number(btn.dataset.armedUntil)) {
    delete btn.dataset.armedUntil;
    btn.textContent = label;
    return true;
  }
  btn.dataset.armedUntil = String(Date.now() + 3000);
  btn.textContent = 'Confirm';
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

function getJson(url) { return fetch(url).then((r) => r.json()); }
function postJson(url, body) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
    .then((r) => r.json());
}

// --- State and sending -----------------------------------------------------------
//
// `state` is the server's one match state, as last received. An edit goes
// out as a partial update and is merged into `state` here at once, the same
// way the server merges it, so the panel never flickers back to the old
// value before the server's echo arrives.

let state = null;
let ws = null;
let games = [];
let library = { teams: [], matches: [], seeded: [] };
let libraryLoaded = false;

function wsOpen() { return ws && ws.readyState === WebSocket.OPEN; }

function mergeLocal(patch) {
  if (!state) return;
  const next = { ...state, ...patch };
  ['socials', 'scoreboard', 'backgrounds'].forEach((k) => { if (patch[k]) next[k] = { ...state[k], ...patch[k] }; });
  if (patch.views) {
    next.views = { ...state.views };
    Object.keys(patch.views).forEach((v) => { next.views[v] = { ...(state.views[v] || {}), ...patch.views[v] }; });
  }
  delete next.restartCountdown;
  state = next;
}

function send(patch) {
  if (!wsOpen()) { toast('App connection lost. Change not saved.'); return false; }
  ws.send(JSON.stringify({ type: 'update', data: patch }));
  mergeLocal(patch);
  return true;
}

// A form field shows the state's value, except while it is being typed in.
function setVal(el, v) {
  if (!el || document.activeElement === el) return;
  if (el.type === 'checkbox') el.checked = !!v;
  else el.value = v == null ? '' : v;
}

// A finished edit: Enter (in a text box) or leaving the field. `fn` returns
// the patch to send, or null for nothing. A short green ring confirms it.
function onCommit(el, fn) {
  const go = () => {
    const patch = fn(el);
    if (!patch) return;
    if (send(patch)) {
      el.classList.remove('saved'); void el.offsetWidth; el.classList.add('saved');
    }
    afterLocalChange();
  };
  el.addEventListener('change', go);
  if (el.tagName === 'INPUT' && /^(text|search|number|url)$/.test(el.type)) {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
  }
}

// Redraw everything that depends on the state.
function afterLocalChange() { renderAll(); }

// --- Panel preferences --------------------------------------------------------------
//
// Choices every open panel shares (the app window and an OBS dock), kept by
// the server: which league graphics get a scene, the game capture, Studio
// Mode, and whether the setup guide has run.

// In the order their scenes sit in OBS (the server's list): before the
// match, then during it.
const NECC_TYPES = [
  { key: 'matchPreview', label: 'Match Preview' },
  { key: 'matchRosters', label: 'Match Rosters' },
  { key: 'stageBracket', label: 'Bracket' },
  { key: 'seasonHeader', label: 'Season Header' },
  { key: 'matchProgress', label: 'Match Progress' },
  { key: 'matchActivity', label: 'Match Activity' },
];
let prefs = {
  neccTypes: ['stageBracket', 'matchPreview'], leagueScenes: LEAGUE_SCENES.map((s) => s.key), bxScenes: BX_SCENES.map((s) => s.key),
  setupDone: false, guideV2: false, gameCapture: true, studioMode: false, orderScenes: true,
};
let prefsLoaded = false;

function applyPrefs(p) {
  prefs = { ...prefs, ...(p || {}) };
  ['gameCaptureInput', 'wizGameCapture'].forEach((id) => { $id(id).checked = prefs.gameCapture; });
  ['studioModeInput', 'wizStudioMode'].forEach((id) => { $id(id).checked = prefs.studioMode; });
  $id('orderScenesInput').checked = prefs.orderScenes;
  renderNeccTypeList();
}

function savePrefs(patch) {
  applyPrefs(patch);
  postJson('/api/prefs', patch).catch(() => {});
}

async function loadPrefs() {
  try {
    const res = await getJson('/api/prefs');
    applyPrefs(res.prefs);
  } catch (e) { /* server restarting; defaults stand */ }
  prefsLoaded = true;
  maybeAutoWizard();
}

[['gameCaptureInput', 'gameCapture'], ['wizGameCapture', 'gameCapture'], ['studioModeInput', 'studioMode'], ['wizStudioMode', 'studioMode'], ['orderScenesInput', 'orderScenes']]
  .forEach(([id, key]) => $id(id).addEventListener('change', (e) => savePrefs({ [key]: e.target.checked })));

// The scenes beyond the base ones: the league's own (from the League page),
// then one per LeagueOS graphic. Ticking one only changes what the next
// build makes; the build adds it to OBS, or removes it.
const neccTypeList = $id('neccTypeList');
function renderNeccTypeList() {
  neccTypeList.innerHTML = '';
  const urls = (state && state.neccUrls) || {};
  const add = (list, pref, t, noteText) => {
    const label = document.createElement('label');
    label.className = 'checkbox';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = prefs[pref].includes(t.key);
    const txt = document.createElement('span');
    txt.textContent = t.label;
    const note = document.createElement('small');
    note.className = 'muted-note';
    note.textContent = noteText;
    label.append(input, txt, note);
    input.addEventListener('change', () => {
      const set = new Set(prefs[pref]);
      if (input.checked) set.add(t.key); else set.delete(t.key);
      savePrefs({ [pref]: list.map((x) => x.key).filter((k) => set.has(k)) });
      toast('Scene list changed. Rebuild to apply.', 'Build', () => { setPage('match'); showStep('build'); });
    });
    neccTypeList.appendChild(label);
  };
  BX_SCENES.forEach((t) => add(BX_SCENES, 'bxScenes', t, t.note));
  LEAGUE_SCENES.forEach((t) => add(LEAGUE_SCENES, 'leagueScenes', t, 'league site data'));
  NECC_TYPES.forEach((t) => add(NECC_TYPES, 'neccTypes', t,
    urls[t.key] ? `${LEAGUE} graphic, link imported` : (Object.keys(urls).length ? `${LEAGUE} graphic, no link in this match` : `${LEAGUE} graphic`)));
}

// --- Browse-first file fields (v0.12.0) ----------------------------------------
//
// The logo, background video and team logo fields show the chosen file by
// name, with Browse and Clear, instead of a raw path to type. "Paste a link"
// opens the text box for a web address. Choosing or clearing fires the
// input's change event, so it commits like any other field.

const fileFields = [];

function fileLabel(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (/^\/logos\//.test(v)) return 'Imported team logo';
  if (/^\/brand\/teams\//.test(v)) return `${LEAGUE} logo`;
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
    input.dispatchEvent(new Event('change', { bubbles: true }));
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
    warn = `File path unavailable in this window for "${f.name}". Use the app window or paste a URL.`;
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
// The two teams on the Rosters scene and the scoreboard. One editor, moved to
// whichever page shows it (Match, Type them in; and Live, Rosters). A typed
// name goes out when the field is finished; adding, removing or reordering a
// player goes out at once. Each player is a plain { name, gamertag }.

const DEFAULT_COLORS = { A: BRAND.teamColors.A, B: BRAND.teamColors.B };
function emptyRoster() { return { name: '', tag: '', color: '', colorAlt: '', logoUrl: '', players: [] }; }
function normalizeRoster(team) {
  if (!team) return emptyRoster();
  return {
    name: team.name || '', tag: team.tag || '', color: team.color || '', colorAlt: team.colorAlt || '',
    logoUrl: team.logoUrl || '',
    players: (team.players || []).map((p) => ({ name: p.name || '', gamertag: p.gamertag || '' })),
  };
}
// Blank player rows are left out of what goes on stream.
function rosterPayload(team) {
  const t = normalizeRoster(team);
  t.players = t.players.filter((p) => p.gamertag.trim() || p.name.trim());
  return t;
}
// LeagueOS import -> roster: the starters (position >= 0), no subs or coaches.
function importToRoster(team) {
  if (!team) return emptyRoster();
  return normalizeRoster({ ...team, players: (team.players || []).filter((p) => p.position >= 0) });
}

// The panel's working copy of each team (it may hold a blank row being
// filled in), refreshed from the state when that team isn't being edited.
const rosters = { A: emptyRoster(), B: emptyRoster() };
const rosterEls = {};
const rosterDirty = { A: false, B: false };

function stateTeam(L) { return normalizeRoster(state && (L === 'A' ? state.teamA : state.teamB)); }
function sendTeam(L) { send({ ['team' + L]: rosterPayload(rosters[L]) }); afterLocalChange(); }
function editingTeam(L) { return rosterEls[L] && rosterEls[L].box.contains(document.activeElement); }

const ROSTER_OPEN_KEY = 'stream-roster-open';
let rosterOpen = {};
try { rosterOpen = JSON.parse(lsGet(ROSTER_OPEN_KEY)) || {}; } catch (e) { rosterOpen = {}; }
function isRosterOpen(L) {
  if (typeof rosterOpen[L] === 'boolean') return rosterOpen[L];
  return !rosters[L].name && !rosters[L].players.length;
}
function setRosterOpen(L, open) {
  rosterOpen[L] = open;
  lsSet(ROSTER_OPEN_KEY, JSON.stringify(rosterOpen));
  renderRosterSummary(L);
}

function buildRosterEditor(L) {
  const box = $id('rosterEdit' + L);
  box.innerHTML = `
    <div class="ret-summary">
      <img class="ret-sum-logo" alt="" hidden>
      <div class="ret-sum-text">
        <span class="ret-letter">Team ${L}</span>
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
        <input type="text" class="ret-name" placeholder="Team ${L} name">
        <input type="text" class="ret-tag" placeholder="Short name">
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
  rosterEls[L] = els;
  els.logoField = makeFileField(els.logoInput, { accept: 'image/*', emptyText: 'No logo' });

  els.toggle.addEventListener('click', () => setRosterOpen(L, !isRosterOpen(L)));
  // Typing updates the working copy; finishing the field sends the team.
  const field = (el, key) => {
    el.addEventListener('input', () => { rosters[L][key] = el.value; rosterDirty[L] = true; renderRosterSummary(L); });
    el.addEventListener('change', () => { rosters[L][key] = key === 'logoUrl' ? el.value.trim() : el.value; commitTeam(L, el); });
    if (el.type === 'text') el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
  };
  field(els.name, 'name');
  field(els.tag, 'tag');
  field(els.color, 'color');
  field(els.logoInput, 'logoUrl');
  els.add.addEventListener('click', () => {
    rosters[L].players.push({ name: '', gamertag: '' });
    renderRosterEditor(L);
    const rows = els.players.querySelectorAll('.ret-player');
    const last = rows[rows.length - 1];
    if (last) last.querySelector('.ret-gamertag').focus();
  });
  els.lib.addEventListener('change', () => {
    const t = library.teams.find((x) => x.id === els.lib.value);
    els.lib.value = '';
    if (t) useLibraryTeam(L, t);
  });
  els.save.addEventListener('click', async () => {
    const team = rosterPayload(rosters[L]);
    if (!team.name.trim()) { flashText(els.save, 'Name required', 'Save to library'); return; }
    try {
      const res = await fetch('/api/library/teams', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(team) });
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
    const list = rosters[L].players;
    const [moved] = list.splice(dragFrom, 1);
    if (to > dragFrom) to -= 1;
    list.splice(Math.max(0, Math.min(list.length, to)), 0, moved);
    dragFrom = -1;
    renderRosterEditor(L);
    sendTeam(L);
  });
  els.players.addEventListener('dragend', () => {
    dragFrom = -1;
    els.players.querySelectorAll('.ret-player').forEach((r) => {
      r.draggable = false;
      r.classList.remove('dragging', 'drop-above', 'drop-below');
    });
  });
  // Leaving the team's editor: pick up anything another panel changed.
  box.addEventListener('focusout', () => setTimeout(() => {
    if (!editingTeam(L) && !rosterDirty[L]) syncRoster(L);
  }, 0));
}

function commitTeam(L, el) {
  rosterDirty[L] = false;
  sendTeam(L);
  if (el) { el.classList.remove('saved'); void el.offsetWidth; el.classList.add('saved'); }
}

function renderRosterSummary(L) {
  const team = rosters[L];
  const els = rosterEls[L];
  const open = isRosterOpen(L);
  els.box.classList.toggle('collapsed', !open);
  els.toggle.textContent = open ? 'Done' : 'Edit';
  els.box.style.setProperty('--team', toHex6(team.color) || DEFAULT_COLORS[L]);
  els.sumName.textContent = team.name || 'Not set';
  const n = rosterPayload(team).players.length;
  els.sumMeta.textContent = [team.tag, `${n} player${n === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  if (team.logoUrl) { els.sumLogo.src = mediaUrl(team.logoUrl); els.sumLogo.hidden = false; }
  else { els.sumLogo.removeAttribute('src'); els.sumLogo.hidden = true; }
}

function buildPlayerRow(L, player) {
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
  [[gt, 'gamertag'], [rn, 'name']].forEach(([el, key]) => {
    el.addEventListener('input', () => { player[key] = el.value; rosterDirty[L] = true; renderRosterSummary(L); });
    el.addEventListener('change', () => { player[key] = el.value; commitTeam(L, el); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
  });
  rm.addEventListener('click', () => {
    const idx = rosters[L].players.indexOf(player);
    if (idx >= 0) rosters[L].players.splice(idx, 1);
    renderRosterEditor(L);
    sendTeam(L);
  });
  row.append(handle, gt, rn, rm);
  return row;
}

function renderRosterEditor(L) {
  const team = rosters[L];
  const els = rosterEls[L];
  els.name.value = team.name || '';
  els.tag.value = team.tag || '';
  els.color.value = toHex6(team.color) || DEFAULT_COLORS[L];
  els.logoInput.value = team.logoUrl || '';
  els.logoField.render();
  els.players.innerHTML = '';
  team.players.forEach((p) => els.players.appendChild(buildPlayerRow(L, p)));
  renderRosterSummary(L);
}

// From the state, unless this team is mid-edit. Keeps a trailing blank row
// the operator just added.
function syncRoster(L) {
  if (editingTeam(L)) return;
  const fromState = stateTeam(L);
  const blanks = rosters[L].players.filter((p) => !p.gamertag.trim() && !p.name.trim()).length;
  const same = JSON.stringify(rosterPayload(rosters[L])) === JSON.stringify(fromState);
  if (same && !rosterDirty[L]) { renderRosterSummary(L); return; }
  rosters[L] = fromState;
  if (same) for (let i = 0; i < blanks; i++) rosters[L].players.push({ name: '', gamertag: '' });
  rosterDirty[L] = false;
  renderRosterEditor(L);
}

function useLibraryTeam(L, t) {
  rosters[L] = normalizeRoster(t);
  rosterDirty[L] = false;
  renderRosterEditor(L);
  sendTeam(L);
  autoSubtitle();
}

// The Starting Soon subtitle follows the matchup ("A vs B", or "vs B" on a
// school's own stream) unless the operator wrote something else there.
function matchupText() {
  const a = rosterPayload(rosters.A).name, b = rosterPayload(rosters.B).name;
  if (!a || !b) return '';
  if (BRAND.homeTeam) {
    const re = new RegExp(escapeRe(BRAND.homeTeam), 'i');
    if (re.test(a) && !re.test(b)) return `vs ${b}`;
    if (re.test(b) && !re.test(a)) return `vs ${a}`;
  }
  return `${a} vs ${b}`;
}
function autoSubtitle() {
  const sub = matchupText();
  if (!sub || !state) return;
  const cur = ((state.views || {})['starting-soon'] || {}).subtitle || '';
  if (cur === sub) return;
  if (!cur || /\bvs\.? /i.test(cur)) send({ views: { 'starting-soon': { subtitle: sub } } });
  // The saved-match name follows too, until the operator names it.
  const nameEl = $id('matchNameInput');
  const name = sub.startsWith('vs ') ? `${BRAND.shortName} ${sub}` : sub;
  if (!nameEl.value || nameEl.value === lastAutoName) { nameEl.value = name; lastAutoName = name; }
}
let lastAutoName = '';

// The editor lives on the Match page (Type them in) or the Live page.
function placeRosterEditor(page) {
  const slot = document.querySelector(`[data-roster-slot="${page === 'match' ? 'match' : 'live'}"]`);
  const ed = $id('rosterEditor');
  if (slot && ed.parentElement !== slot) slot.appendChild(ed);
}

// --- Match page -------------------------------------------------------------------
//
// Five steps. The first reads the whole match from a LeagueOS match link.
// The next three set the same things by hand or correct them: the game, the
// teams (the league's schools and saved teams, or typed in), the details.
// The last builds the scenes.
//
// The link step belongs to the broadcast package (its league feed offers
// matches there). A profile without it keeps v2.1's four steps: the link is
// one of the Teams step's sources.
const LINK_FIRST = !!BX;
const STEPS = LINK_FIRST ? ['link', 'game', 'teams', 'details', 'build'] : ['game', 'teams', 'details', 'build'];
const STEP_KEY = 'stream-match-step';
let currentStep = STEPS[0];
if (!LINK_FIRST) {
  document.querySelector('#stepper [data-step="link"]').parentElement.remove();
  document.querySelectorAll('#stepper b').forEach((b, i) => { b.textContent = String(i + 1); });
  $id('importPane').appendChild($id('linkField'));
  $id('importSrcBtn').hidden = false;
  $id('gameBackBtn').replaceWith(document.createElement('span'));
}

function showStep(step) {
  if (!STEPS.includes(step)) step = STEPS[0];
  currentStep = step;
  document.querySelectorAll('.step-card').forEach((c) => { c.hidden = c.dataset.step !== step; });
  document.querySelectorAll('#stepper button').forEach((b) => {
    b.classList.toggle('active', b.dataset.step === step);
    b.classList.toggle('done', stepDone(b.dataset.step) && b.dataset.step !== step);
  });
  lsSet(STEP_KEY, step);
  if (step === 'build') { renderChecklist(); refreshStinger(); refreshObs(true); }
  if (step === 'link') renderMatchNow();
  $id('pageCol').scrollTop = 0;
}
function stepDone(step) {
  if (!state) return false;
  if (step === 'link') return !!(state.teamA.name && state.teamB.name && Object.keys(state.neccUrls || {}).length);
  if (step === 'game') return games.some((g) => g.id === state.game) || !!state.team;
  if (step === 'teams') return !!(state.teamA.name && state.teamB.name);
  if (step === 'details') return !!(state.end);
  if (step === 'build') return !!(obsStatus && obsStatus.connected && sceneExists.scoreboard);
  return false;
}
document.querySelectorAll('#stepper button').forEach((b) => b.addEventListener('click', () => showStep(b.dataset.step)));
document.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', () => showStep(b.dataset.next)));

// Step 1: the match as it stands, under the link field.
function renderMatchNow() {
  const box = $id('matchNow');
  if (!state) return;
  const a = state.teamA.name, b = state.teamB.name;
  const ready = !!(a && b);
  $id('linkDetailsBtn').disabled = !ready;
  $id('linkBuildBtn').disabled = !ready;
  if (!ready) { box.innerHTML = '<div class="lib-empty">No teams set.</div>'; return; }
  const sb = state.scoreboard || {};
  const start = state.countdownMode === 'at' && state.end ? new Date(state.end) : null;
  const side = (t) => {
    const { logo } = teamTile(t);
    return `<span class="match-now-team">${logo}<b>${esc(t.name)}</b></span>`;
  };
  const meta = [state.team, sb.round, `Best of ${sb.bestOf || 3}`,
    start && !isNaN(start) ? `${start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${clockTime(start)}` : ''].filter(Boolean);
  box.innerHTML = `<div class="match-now-teams">${side(state.teamA)}<i>vs</i>${side(state.teamB)}</div><div class="match-now-meta">${esc(meta.join(' · '))}</div>`;
}

// Step 2: game.
const gameGrid = $id('gameGrid');
const teamInput = $id('teamInput');
// A series length from a LeagueOS import wins over a game's preset, so
// picking the game after importing doesn't undo it.
let importedBestOf = null;

function renderGameGrid() {
  const cur = state ? state.game : '';
  gameGrid.innerHTML = '';
  const add = (id, name, sub) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'game-btn' + (cur === id ? ' active' : '');
    b.innerHTML = `<b>${esc(name)}</b><small>${esc(sub)}</small>`;
    b.addEventListener('click', () => pickGame(id));
    gameGrid.appendChild(b);
  };
  // Every game reads the same way here: how its series is counted.
  games.forEach((g) => {
    const sb = g.scoreboard || {};
    add(g.id, g.name, `Best of ${sb.bestOf || 3}, by ${String(sb.unit || 'game').toLowerCase()}`);
  });
  add('', 'Other', 'Custom name');
}

function pickGame(id) {
  const g = games.find((x) => x.id === id);
  const patch = { game: id };
  if (g) {
    patch.team = g.name;
    patch.scoreboard = { ...defaultScoreboardConfig(), ...(g.scoreboard || {}), ...(importedBestOf ? { bestOf: importedBestOf } : {}) };
  } else {
    // A game without a preset keeps the series settings, but not another
    // game's own scoreboard (and so not its stats scene).
    patch.scoreboard = { style: 'standard' };
  }
  send(patch);
  afterLocalChange();
  if (!g) teamInput.focus();
}
onCommit(teamInput, (el) => ({ team: el.value }));

// Step 3: teams.
const SRC_KEY = 'stream-team-src';
let pickFor = 'A';
function showTeamSrc(src) {
  // Link first: the match link has its own step and is not a source here.
  if (src !== 'manual' && (LINK_FIRST || src !== 'import')) src = 'library';
  document.querySelectorAll('#teamSrc .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.src === src));
  document.querySelectorAll('.team-pane').forEach((p) => { p.hidden = p.dataset.src !== src; });
  lsSet(SRC_KEY, src);
  if (src === 'manual') { setRosterOpen('A', true); setRosterOpen('B', true); }
}
document.querySelectorAll('#teamSrc .seg-btn').forEach((b) => b.addEventListener('click', () => showTeamSrc(b.dataset.src)));
if (BRAND.leagueTeams) $id('libSrcBtn').textContent = `${LEAGUE} schools`;

function setPickFor(L) {
  pickFor = L;
  document.querySelectorAll('#pickFor .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.for === L));
  document.querySelectorAll('#matchup .slot').forEach((s) => s.classList.toggle('picking', s.dataset.slot === L));
}
document.querySelectorAll('#pickFor .seg-btn').forEach((b) => b.addEventListener('click', () => setPickFor(b.dataset.for)));
document.querySelectorAll('#matchup .slot').forEach((s) => s.addEventListener('click', () => {
  setPickFor(s.dataset.slot);
  const src = lsGet(SRC_KEY);
  if (src === 'manual') setRosterOpen(s.dataset.slot, true);
}));

function teamTile(t) {
  const color = toHex6(t.color) || '#444';
  const logo = t.logoUrl ? `<img src="${esc(mediaUrl(t.logoUrl))}" alt="">` : `<span class="mono" style="background:${color};color:${inkFor(color)}">${esc((t.tag || t.name || '?').slice(0, 3).toUpperCase())}</span>`;
  return { color, logo };
}

function renderMatchup() {
  ['A', 'B'].forEach((L) => {
    const t = rosterPayload(rosters[L]);
    const slot = document.querySelector(`#matchup .slot[data-slot="${L}"]`);
    const { color, logo } = teamTile(t);
    slot.style.setProperty('--team', t.name ? color : 'var(--panel-border)');
    slot.innerHTML = t.name
      ? `${logo}<span class="slot-text"><small>Team ${L}</small><b>${esc(t.name)}</b><em>${t.players.length} player${t.players.length === 1 ? '' : 's'}</em></span>`
      : `<span class="slot-empty">Team ${L}<small>empty</small></span>`;
  });
}

const schoolGrid = $id('schoolGrid');
const libSearch = $id('libSearch');
function renderSchoolGrid() {
  const q = libSearch.value.trim().toLowerCase();
  schoolGrid.innerHTML = '';
  const nameA = rosterPayload(rosters.A).name.toLowerCase();
  const nameB = rosterPayload(rosters.B).name.toLowerCase();
  const list = library.teams.filter((t) => !q || `${t.name} ${t.tag}`.toLowerCase().includes(q));
  if (!list.length) {
    schoolGrid.innerHTML = `<div class="lib-empty">${library.teams.length ? 'No match.' : `Library empty. Import a ${esc(LEAGUE)} match or enter the teams manually.`}</div>`;
    return;
  }
  list.forEach((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'school-tile';
    const { color, logo } = teamTile(t);
    b.style.setProperty('--team', color);
    const n = t.name.toLowerCase();
    const as = n === nameA ? 'A' : n === nameB ? 'B' : '';
    const players = (t.players || []).length;
    b.innerHTML = `${logo}<b>${esc(t.name)}</b><small>${esc([t.tag, players ? `${players} players` : ''].filter(Boolean).join(' · '))}</small>${as ? `<i class="as">Team ${as}</i>` : ''}`;
    b.title = `Make ${t.name} Team ${pickFor}`;
    b.addEventListener('click', () => {
      const L = pickFor;
      useLibraryTeam(L, t);
      // Picking Team A moves on to Team B.
      if (L === 'A') setPickFor('B');
    });
    schoolGrid.appendChild(b);
  });
}
libSearch.addEventListener('input', renderSchoolGrid);

// LeagueOS import.
const neccUrlInput = $id('neccUrlInput');
const neccFetchBtn = $id('neccFetchBtn');
const neccStatus = $id('neccStatus');
neccFetchBtn.addEventListener('click', async () => {
  const url = neccUrlInput.value.trim();
  if (!url) { neccUrlInput.focus(); return; }
  neccStatus.textContent = 'Importing…';
  neccStatus.classList.remove('error');
  neccFetchBtn.disabled = true;
  try {
    const res = await fetch('/api/necc/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');
    rosters.A = importToRoster(data.teams[0]);
    rosters.B = importToRoster(data.teams[1]);
    rosterDirty.A = rosterDirty.B = false;
    renderRosterEditor('A');
    renderRosterEditor('B');
    const patch = { teamA: rosterPayload(rosters.A), teamB: rosterPayload(rosters.B), neccUrls: data.overlayUrls || {} };
    // The game, if it is one of this league's, with its scoreboard preset.
    const g = data.game && games.find((x) => x.name.toLowerCase() === String(data.game).toLowerCase());
    importedBestOf = data.bestOf || null;
    if (g && (!state || state.game !== g.id)) {
      patch.game = g.id;
      patch.team = g.name;
      patch.scoreboard = { ...defaultScoreboardConfig(), ...(g.scoreboard || {}) };
    } else if (data.game && state && !state.game) {
      patch.team = data.game;
    }
    if (importedBestOf) patch.scoreboard = { ...(patch.scoreboard || {}), bestOf: importedBestOf };
    if (data.scheduledAt) { patch.countdownMode = 'at'; patch.end = new Date(data.scheduledAt).toISOString(); }
    send(patch);
    autoSubtitle();
    const urlCount = Object.keys(data.overlayUrls || {}).length;
    neccStatus.textContent = `Imported: ${data.game || 'match'}${data.eventName ? `, ${data.eventName}` : ''}${data.bestOf ? `, best of ${data.bestOf}` : ''}`
      + `${data.scheduledAt ? `, start ${clockTime(new Date(data.scheduledAt))}` : ''}. ${LEAGUE} graphic links: ${urlCount}.`;
    afterLocalChange();
  } catch (err) {
    neccStatus.textContent = err.message || 'Import failed';
    neccStatus.classList.add('error');
  } finally {
    neccFetchBtn.disabled = false;
  }
});
neccUrlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') neccFetchBtn.click(); });

// Step 4: details.
const modeAt = $id('modeAt');
const modeDuration = $id('modeDuration');
const atInput = $id('atInput');
const durationInput = $id('durationInput');
const countdownNote = document.createElement('div');
countdownNote.className = 'status-line';
$id('restartCountdownBtn').closest('.field-row').after(countdownNote);

function showCountdownFields() {
  $id('atField').hidden = !modeAt.checked;
  $id('durationField').hidden = !modeDuration.checked;
  $id('restartCountdownBtn').hidden = !modeDuration.checked;
}
modeAt.addEventListener('change', () => {
  showCountdownFields();
  if (atInput.value) send({ countdownMode: 'at', end: new Date(atInput.value).toISOString() });
  else atInput.focus();
  afterLocalChange();
});
modeDuration.addEventListener('change', () => {
  showCountdownFields();
  send({ countdownMode: 'duration', durationSec: parseDuration(durationInput.value) || 600 });
  afterLocalChange();
});
onCommit(atInput, (el) => (el.value ? { countdownMode: 'at', end: new Date(el.value).toISOString() } : null));
onCommit(durationInput, (el) => {
  const sec = parseDuration(el.value);
  el.value = formatDuration(sec);
  return { countdownMode: 'duration', durationSec: sec };
});
$id('restartCountdownBtn').addEventListener('click', (e) => {
  send({ countdownMode: 'duration', durationSec: parseDuration(durationInput.value) || 600, restartCountdown: true });
  flashText(e.target, 'Restarted', 'Restart countdown');
});

function renderCountdown() {
  if (!state) return;
  const isAt = state.countdownMode === 'at';
  if (document.activeElement !== modeAt && document.activeElement !== modeDuration) {
    modeAt.checked = isAt; modeDuration.checked = !isAt;
  }
  showCountdownFields();
  if (isAt) setVal(atInput, toDatetimeLocalValue(state.end));
  setVal(durationInput, formatDuration(state.durationSec));
  const end = new Date(state.end);
  countdownNote.textContent = isNaN(end) ? ''
    : end < Date.now() ? `Countdown ended ${clockTime(end)}.`
      : `Countdown target: ${clockTime(end)}${end.toDateString() !== new Date().toDateString() ? `, ${end.toLocaleDateString()}` : ''}.`;
}

const sbBestOfInput = $id('sbBestOfInput');
const sbRoundInput = $id('sbRoundInput');
const ssSubtitleInput = $id('ssSubtitleInput');
const nextInput = $id('nextInput');
const clipInput = $id('clipInput');
const montageInput = $id('montageInput');
onCommit(sbBestOfInput, (el) => { importedBestOf = null; return { scoreboard: { bestOf: clampInt(el.value, 1, 9, 3) } }; });
onCommit(sbRoundInput, (el) => ({ scoreboard: { round: el.value } }));
onCommit(ssSubtitleInput, (el) => ({ views: { 'starting-soon': { subtitle: el.value } } }));
onCommit(nextInput, (el) => ({ next: el.value }));
onCommit(clipInput, (el) => ({ clip: el.value.trim() }));
onCommit(montageInput, (el) => ({ montage: el.checked }));

function renderDetails() {
  if (!state) return;
  setVal(sbBestOfInput, String(state.scoreboard.bestOf || 3));
  setVal(sbRoundInput, state.scoreboard.round || '');
  setVal(ssSubtitleInput, ((state.views || {})['starting-soon'] || {}).subtitle || '');
  setVal(nextInput, state.next || '');
  setVal(clipInput, state.clip || '');
  setVal(montageInput, state.montage !== false);
  renderCountdown();
}

// Step 4: build.
let lastBuild = null;
// OBS's video settings, from /api/obs/inspect: { base, output, fps, ok,
// locked, bitrate, rescale }, or null when OBS has not been asked.
let obsVideo = null;
let videoBusy = false;
// The stream bitrate under which a 1080p60 picture is flagged.
const VIDEO_KBPS = 6000;
function renderChecklist() {
  const ul = $id('buildChecklist');
  if (!state) return;
  const a = state.teamA.name, b = state.teamB.name;
  const g = games.find((x) => x.id === state.game);
  const end = new Date(state.end);
  const items = [
    [obsStatus && obsStatus.connected, obsStatus && obsStatus.connected ? 'OBS connected' : 'OBS not connected', obsStatus && obsStatus.connected ? '' : 'connect'],
    [!!(g || state.team), g ? g.name : (state.team || 'No game selected'), g || state.team ? '' : 'game'],
    [!!(a && b), a && b ? `${a} vs ${b}` : 'Teams incomplete', a && b ? '' : 'teams'],
    [!isNaN(end) && end > Date.now(), !isNaN(end) && end > Date.now() ? `Start: ${clockTime(end)}` : 'Start time not set or in the past', !isNaN(end) && end > Date.now() ? '' : 'details', true],
  ];
  if (BRAND.stinger) {
    const ok = stingerState && stingerState.found;
    items.push([ok, ok ? `Transition present: ${BRAND.stinger.name}` : `Transition not found in OBS: ${BRAND.stinger.name}`, ok ? '' : 'stinger', true]);
  }
  // OBS's video settings against 1920x1080 at 60. OBS takes no change while
  // an output is running, so the button goes and the row says why.
  const v = obsStatus && obsStatus.connected ? obsVideo : null;
  if (v) {
    const text = `Video: ${videoText(v)}`;
    if (v.ok) items.push([true, text, '']);
    else if (v.locked) items.push([false, `${text}. Locked while OBS is streaming or recording.`, '', true]);
    else items.push([false, text, 'video', true]);
    if (v.rescale) items.push([false, `Stream rescaled to ${v.rescale}: OBS Settings > Output > Streaming.`, '', true]);
    if (v.ok && v.bitrate && v.bitrate < VIDEO_KBPS) {
      items.push([false, `Stream bitrate: ${v.bitrate} kbps. 1080p60 reference: ${VIDEO_KBPS} kbps. OBS Settings > Output.`, '', true]);
    }
  }
  // Said before it happens: a build takes out the app's scenes this match
  // doesn't use (another game's stats scene, an unticked extra scene).
  if (obsStatus && obsStatus.connected && sceneStale.length) {
    items.push([false, `Build will remove unused scenes: ${listText(sceneStale.map(shortScene))}`, '', true]);
  }
  ul.innerHTML = '';
  items.forEach(([ok, text, fix, optional]) => {
    const li = document.createElement('li');
    li.className = ok ? 'ok' : optional ? 'warn' : 'bad';
    const span = document.createElement('span');
    span.textContent = text;
    li.appendChild(span);
    if (fix) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn-secondary';
      btn.textContent = { connect: 'Connect', game: 'Select game', teams: 'Select teams', link: 'Import match', details: 'Set start time', stinger: 'Stinger setup', video: 'Set 1080p60' }[fix];
      if (fix === 'video') btn.disabled = videoBusy;
      btn.addEventListener('click', () => {
        if (fix === 'connect') openObsSettings();
        else if (fix === 'stinger') { setPage('settings'); openSection('set-stinger'); scrollToSection('set-stinger'); }
        else if (fix === 'video') raiseVideo();
        else showStep(fix);
      });
      li.appendChild(btn);
    }
    ul.appendChild(li);
  });
}

function videoText(v) {
  const size = (s) => `${s.w}x${s.h}`;
  const sizes = size(v.base) === size(v.output) ? size(v.output) : `canvas ${size(v.base)}, output ${size(v.output)}`;
  return `${sizes}, ${v.fps} fps`;
}
async function raiseVideo() {
  const statusEl = $id('buildStatus');
  videoBusy = true;
  renderChecklist();
  let res;
  try { res = await postJson('/api/obs/video'); } catch (e) { res = { error: 'App not reachable' }; }
  videoBusy = false;
  if (res.video) obsVideo = res.video;
  statusEl.classList.toggle('error', !!res.error);
  statusEl.textContent = res.error ? `Video settings not changed: ${res.error}` : '';
  renderChecklist();
}

$id('buildBtn').addEventListener('click', async (e) => {
  await runBuild(e.target, $id('buildStatus'), $id('buildResult'));
  renderChecklist();
});
$id('goLiveBtn').addEventListener('click', () => setPage('live'));

// Builds the scenes and reports what happened, wherever it was asked from.
async function runBuild(btn, statusEl, resultEl) {
  statusEl.classList.remove('error');
  statusEl.textContent = 'Building scenes…';
  btn.disabled = true;
  let res;
  try { res = await postJson('/api/obs/build-scenes'); } catch (e) { res = { error: 'App not reachable' }; }
  btn.disabled = false;
  if (res.error) {
    statusEl.textContent = `Build failed: ${res.error}`;
    statusEl.classList.add('error');
    if (resultEl) resultEl.hidden = true;
    return res;
  }
  lastBuild = res;
  const scenes = (res.built || []).filter((s) => !/: Music$/.test(s)).length;
  statusEl.textContent = `${scenes} scenes in scene collection "${res.collectionName}"${res.collection === 'created' ? ' (created)' : ''}.`;
  if (resultEl) { resultEl.hidden = false; resultEl.innerHTML = buildResultHtml(res); }
  await refreshObs(true);
  if (res.stinger) { stingerState = { ...(stingerState || {}), found: !!res.stinger.found, current: !!res.stinger.configured }; renderStingerGuides(); }
  return res;
}

function buildResultHtml(res) {
  const prefix = BRAND.obsPrefix;
  const lines = [];
  if (res.gameCapture === 'created') lines.push(`<li class="ok">Game capture added: <b>${esc(prefix)}-game-capture</b> (mode: any fullscreen application).</li>`);
  else if (res.gameCapture === 'exists') lines.push('<li class="ok">Game capture present.</li>');
  else if (res.gameCapture === 'manual') lines.push(`<li class="warn">Game Capture is unavailable in this OBS. Add the game manually:
    <ol><li>Select the <b>${esc(prefix)}: Scoreboard</b> scene.</li>
    <li><b>Sources</b> &gt; <b>+</b> &gt; <b>Window Capture</b> or <b>Display Capture</b>. Select the game.</li>
    <li>Place it below <b>${esc(prefix)}-src-scoreboard</b>.</li></ol></li>`);
  Object.keys(res.cameras || {}).forEach((id) => {
    // A network camera is a browser or media source and has no device.
    const { input, kind } = (res.cameraSources || {})[id] || { input: `${prefix}-cam-${id}`, kind: 'device' };
    const made = res.cameras[id];
    if (made === 'exists') lines.push(`<li class="ok">Camera source present: <b>${esc(input)}</b>.</li>`);
    else if (kind !== 'device') {
      lines.push(made === 'created'
        ? `<li class="ok">Network camera source added: <b>${esc(input)}</b>.</li>`
        : `<li class="warn">Network camera source not created: <b>${esc(input)}</b>. Check the address: Broadcast &gt; Cameras.</li>`);
    } else if (made === 'created') lines.push(`<li class="warn">Camera source added: <b>${esc(input)}</b>. No device selected: Broadcast &gt; Cameras.</li>`);
    else lines.push(`<li class="warn">No Video Capture Device source type in this OBS. Add a camera source named <b>${esc(input)}</b> manually.</li>`);
  });
  if ((res.removed || []).length) {
    lines.push(`<li class="ok">Removed unused scenes: ${esc(listText(res.removed.map(shortScene)))}.</li>`);
  }
  if (res.reloaded) {
    lines.push(`<li class="ok">Browser sources reloaded: ${res.reloaded}.</li>`);
  }
  // The scene list in OBS, top to bottom, in the order a stream uses it.
  const n = (res.moved || []).length;
  if (res.ordering === 'moved' && n) {
    lines.push(`<li class="ok">Scene order: moved ${n === 1 ? esc(shortScene(res.moved[0])) : `${n} scenes`}.</li>`);
  } else if (res.ordering === 'live') {
    lines.push('<li class="warn">Scene order not changed: OBS is streaming or recording.</li>');
  } else if (res.ordering === 'custom') {
    lines.push('<li class="warn">Scene order not changed: a scene contains a group or is nested in another scene.</li>');
  } else if (res.ordering === 'failed') {
    lines.push('<li class="warn">Scene order: interrupted by OBS. Rebuild to retry.</li>');
  }
  if (res.stinger) {
    if (res.stinger.configured) lines.push(`<li class="ok">Transition <b>${esc(res.stinger.name)}</b>: configured and selected.</li>`);
    else if (res.stinger.found === false && !res.stinger.none) lines.push(`<li class="warn">Transition <b>${esc(res.stinger.name)}</b>: not found in OBS. See Settings &gt; Stinger transition.</li>`);
  }
  if (prefs.studioMode) lines.push('<li class="ok">Studio Mode: enabled.</li>');
  return lines.length ? `<ul class="checklist">${lines.join('')}</ul>` : '';
}

// Saved matches. A saved match is the setup: teams, text, start time,
// scoreboard settings and the league graphic links. Never the score.
const matchSelect = $id('matchSelect');
const matchNameInput = $id('matchNameInput');
function matchData() {
  const s = state;
  const sb = { ...s.scoreboard };
  ['scoreA', 'scoreB', 'lostA', 'lostB', 'swap'].forEach((k) => delete sb[k]);
  const out = {
    game: s.game, team: s.team, next: s.next, teamA: s.teamA, teamB: s.teamB, views: s.views, scoreboard: sb,
    countdownMode: s.countdownMode, logo: s.logo, clip: s.clip, montage: s.montage, layout: s.layout,
    postMatchSec: s.postMatchSec, neccUrls: s.neccUrls, neccLink: neccUrlInput.value.trim(),
  };
  if (s.countdownMode === 'at') out.end = s.end; else out.durationSec = s.durationSec;
  return out;
}
$id('matchSaveBtn').addEventListener('click', async (e) => {
  const btn = e.target;
  const name = matchNameInput.value.trim() || matchupText();
  if (!name || !state) { flashText(btn, 'Name required', 'Save'); return; }
  try {
    const res = await fetch('/api/library/matches', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data: matchData() }) });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error);
    matchNameInput.value = name;
    setTimeout(() => { matchSelect.value = out.match.id; }, 50);
    flashText(btn, 'Saved', 'Save');
  } catch (err) {
    flashText(btn, 'Save failed', 'Save');
  }
});
$id('matchLoadBtn').addEventListener('click', () => {
  const m = library.matches.find((x) => x.id === matchSelect.value);
  if (!m) return;
  const d = { ...(m.data || {}) };
  neccUrlInput.value = d.neccLink || '';
  delete d.neccLink;
  // v1 saved matches keep the league graphic links under another name.
  if (d.neccOverlayUrls && !d.neccUrls) d.neccUrls = d.neccOverlayUrls;
  delete d.neccOverlayUrls;
  matchNameInput.value = m.name;
  rosterDirty.A = rosterDirty.B = false;
  send(d);
  ['A', 'B'].forEach((L) => { rosters[L] = stateTeam(L); renderRosterEditor(L); });
  afterLocalChange();
  toast(`Loaded: ${m.name}`);
});
$id('matchDeleteBtn').addEventListener('click', async () => {
  const m = library.matches.find((x) => x.id === matchSelect.value);
  if (!m) return;
  await fetch(`/api/library/matches/${encodeURIComponent(m.id)}`, { method: 'DELETE' }).catch(() => {});
  toast(`Deleted: ${m.name}`, 'Undo', () => {
    fetch('/api/library/matches', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id, name: m.name, data: m.data }) }).catch(() => {});
  });
});

// --- Live page: on air --------------------------------------------------------------
//
// What OBS has on program, from the server (which follows OBS's events),
// with an optional small picture of it.

let onAir = { key: '', view: '', necc: '', scene: '' };
const SHOT_KEY = 'stream-onair-shot';
const shotInput = $id('shotInput');

// "LotE: Standings" -> "Standings".
function shortScene(name) { return String(name).replace(/^[^:]+:\s*/, ''); }
// "A", "A and B", "A, B and C".
function listText(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
function sceneLabel(key) {
  const s = sceneList.find((x) => x.key === key);
  if (s) return shortScene(s.scene);
  return key;
}

function renderOnAir() {
  const connected = !!(obsStatus && obsStatus.connected);
  const name = !connected ? 'OBS not connected' : onAir.scene || 'None';
  $id('onairName').textContent = onAir.key ? sceneLabel(onAir.key) : name;
  $id('onairCard').classList.toggle('off', !connected);
  let sub = '';
  if (connected && onAir.scene && !onAir.key) sub = 'Not an app scene.';
  else if (connected && onAir.key === 'stats') sub = rlScreen.screen === 'series' ? 'Series overview' : 'Game stats';
  else if (connected && onAir.key === 'post-match') sub = 'Countdown started on air.';
  $id('onairSub').textContent = sub;
  document.querySelectorAll('.scene-row').forEach((r) => {
    const on = r.dataset.key === onAir.key && connected;
    r.classList.toggle('on-air', on);
    const btn = r.querySelector('.scene-go');
    if (btn) { btn.disabled = !connected || on; btn.textContent = on ? 'On air' : 'Put on air'; }
  });
  renderRlScreenBtns();
}

let shotTimer = 0;
async function pollShot() {
  clearTimeout(shotTimer);
  const want = shotInput.checked && currentPage === 'live' && obsStatus && obsStatus.connected && !document.hidden;
  $id('onairShotBox').hidden = !want;
  if (!want) return;
  try {
    const r = await getJson('/api/obs/program-shot?width=480');
    if (r.image) $id('onairShot').src = r.image;
  } catch (e) { /* next round */ }
  shotTimer = setTimeout(pollShot, 2500);
}
shotInput.addEventListener('change', () => { lsSet(SHOT_KEY, shotInput.checked ? 'on' : 'off'); pollShot(); });
document.addEventListener('visibilitychange', pollShot);

// --- Live page: score ---------------------------------------------------------------
//
// One scoreboard for every game. Series score always; the Smash crew-battle
// stock counter when turned on. Counters go to the server on their own
// message (applyScore), so a second panel can never send a stale score.

const scorePanel = $id('scorePanel');
const SB_COUNTERS = ['scoreA', 'scoreB', 'lostA', 'lostB', 'swap'];
function defaultScoreboardConfig() {
  return {
    round: '', unit: 'Game', bestOf: 3, crewSize: 4, stocksEach: 3, showStocks: false, position: 'top',
    style: 'standard', rlAutoSeries: true, rlPlayers: true, rlBoost: true, rlGameColors: true, rlAutoStats: true, rlHideHud: true,
  };
}
function sb() { return (state && state.scoreboard) || { ...defaultScoreboardConfig(), scoreA: 0, scoreB: 0, lostA: 0, lostB: 0, swap: false }; }

const SCORE_KEYS = { A: { lose: '1', undo: 'Shift+1', win: '3' }, B: { lose: '2', undo: 'Shift+2', win: '4' } };
function buildScoreSide(t) {
  const k = SCORE_KEYS[t];
  $id('sbSide' + t).innerHTML = `
    <div class="sb-side-head"><img class="sb-side-logo" id="sbLogo${t}" alt="" hidden><span class="sb-side-name" id="sbName${t}">Team ${t}</span><b class="sb-score-big" id="sbScore${t}">0</b></div>
    <button class="sb-win-big" type="button" data-sb="win" data-team="${t}"><span id="sbWin${t}">Won game</span><kbd>${k.win}</kbd></button>
    <div class="sb-score-row">
      <span class="lbl" id="sbWonLbl${t}">Games won</span>
      <button class="btn-secondary sb-step" type="button" data-sb="score-" data-team="${t}" aria-label="Remove a point" title="Remove a point">&minus;</button>
      <button class="btn-secondary sb-step" type="button" data-sb="score+" data-team="${t}" aria-label="Add a point" title="+1 (stocks unchanged)">+</button>
    </div>
    <div class="sb-side-stock sb-stock-only"><span id="sbStock${t}"></span></div>
    <div class="sb-side-onstage sb-stock-only" id="sbOn${t}"></div>
    <div class="sb-btns sb-stock-only">
      <button class="sb-big" type="button" data-sb="lose" data-team="${t}">Lost a stock <kbd>${k.lose}</kbd></button>
      <button class="btn-secondary" type="button" data-sb="undo" data-team="${t}">Undo <kbd>${k.undo}</kbd></button>
    </div>
    <div class="sb-ord sb-stock-only">
      <div class="sb-ord-head"><span class="lbl">Player order</span><small>Drag to reorder</small></div>
      <div class="sb-ord-list" id="sbOrd${t}"></div>
    </div>`;
  buildOrderList(t);
}

// The order a team's players take the stage in, under its stock counter: the
// roster's own order (stocks are lost down it, and the scoreboard lists the
// crew in it), so a row dragged here is a player moved in the roster. It goes
// out when the row is dropped. Pointer events, not HTML drag and drop: the
// whole row is the handle, and it works the same in an OBS dock.
let ordDragging = '';
function buildOrderList(t) {
  const list = $id('sbOrd' + t);
  let row = null;
  const rows = () => Array.from(list.querySelectorAll('.sb-ord-row'));
  // The gap the pointer is over: 0 is above the first row.
  const gapAt = (y) => {
    const rs = rows();
    const i = rs.findIndex((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
    return i < 0 ? rs.length : i;
  };
  // Where the dragged row would land, as a position in the list.
  const landing = (y) => {
    const from = rows().indexOf(row);
    const gap = gapAt(y);
    return { from, to: gap > from ? gap - 1 : gap };
  };
  const stop = () => {
    rows().forEach((r) => r.classList.remove('dragging', 'drop-above', 'drop-below'));
    row = null;
    ordDragging = '';
  };
  list.addEventListener('pointerdown', (e) => {
    const r = e.target.closest('.sb-ord-row');
    if (!r || e.button !== 0) return;
    e.preventDefault();
    row = r;
    ordDragging = t;
    // Captured, so the drag carries on when the pointer leaves the list.
    try { list.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ }
    r.classList.add('dragging');
  });
  list.addEventListener('pointermove', (e) => {
    if (!row) return;
    const rs = rows();
    const { from, to } = landing(e.clientY);
    rs.forEach((r) => r.classList.remove('drop-above', 'drop-below'));
    if (to !== from) rs[to].classList.add(to < from ? 'drop-above' : 'drop-below');
  });
  list.addEventListener('pointerup', (e) => {
    if (!row) return;
    const idx = rows().map((r) => Number(r.dataset.i));
    const { from, to } = landing(e.clientY);
    stop();
    if (to === from) return;
    // By player, not by index: the roster's working copy may hold a blank
    // row that this list leaves out.
    const players = rosters[t].players;
    const moved = players[idx[from]];
    const anchor = players[idx[to]];
    players.splice(players.indexOf(moved), 1);
    players.splice(players.indexOf(anchor) + (to > from ? 1 : 0), 0, moved);
    renderRosterEditor(t);
    sendTeam(t);
  });
  list.addEventListener('pointercancel', () => { if (row) { stop(); renderScorePanel(); } });
}

// One row per player: its place, its name, and where it stands on stocks.
function renderOrderList(t, crewSize, stocksEach, lost) {
  if (ordDragging === t) return;
  const list = $id('sbOrd' + t);
  const players = rosters[t].players.map((p, i) => ({ p, i })).filter(({ p }) => p.gamertag.trim() || p.name.trim());
  const active = Math.floor(lost / stocksEach);
  const out = lost >= crewSize * stocksEach;
  list.textContent = '';
  if (!players.length) {
    const none = document.createElement('div');
    none.className = 'lib-empty';
    none.textContent = 'No players in the roster.';
    list.appendChild(none);
    return;
  }
  players.forEach(({ p, i }, k) => {
    let cls = '', text = '';
    if (k >= crewSize) { cls = 'bench'; text = 'Bench'; }
    else if (out || k < active) { cls = 'out'; text = 'Out'; }
    else if (k === active) { cls = 'on'; text = `On stage · ${stocksEach - (lost % stocksEach)} left`; }
    else if (k === active + 1) text = 'Next';
    const row = document.createElement('div');
    row.className = 'sb-ord-row' + (cls ? ' ' + cls : '');
    row.dataset.i = String(i);
    row.title = 'Drag to reorder';
    const cell = (tag, c, s) => { const n = document.createElement(tag); n.className = c; n.textContent = s; return n; };
    row.append(cell('span', 'ret-handle', '⋮⋮'), cell('b', 'sb-ord-n', k < crewSize ? String(k + 1) : ''),
      cell('span', 'sb-ord-name', p.gamertag || p.name), cell('em', 'sb-ord-st', text));
    list.appendChild(row);
  });
}

function renderScorePanel() {
  const s = sb();
  const isRl = s.style === 'rl';
  const showStocks = s.showStocks && !isRl;
  const crewSize = clampInt(s.crewSize, 1, 8, 4), stocksEach = clampInt(s.stocksEach, 1, 5, 3);
  const total = crewSize * stocksEach;
  const unit = s.unit || 'Game';
  scorePanel.classList.toggle('no-stocks', !showStocks);
  $id('sbStockFields').style.display = showStocks ? '' : 'none';
  $id('sbRefillBtn').style.display = showStocks ? '' : 'none';
  $id('sbRlFields').style.display = isRl ? '' : 'none';
  $id('sbShowStocksField').style.display = isRl ? 'none' : '';
  $id('sbPositionField').style.visibility = isRl ? 'hidden' : '';
  // Only a game with a live scoreboard of its own offers the choice.
  const preset = (games.find((g) => g.id === (state && state.game)) || {}).scoreboard || {};
  $id('sbStyleField').style.display = isRl || (preset.style && preset.style !== 'standard') ? '' : 'none';
  const need = Math.ceil(clampInt(s.bestOf, 1, 9, 3) / 2);
  $id('scoreHint').textContent = `${s.round ? s.round + ' · ' : ''}Best of ${s.bestOf || 3}, first to ${need}`;
  ['A', 'B'].forEach((t) => {
    const team = rosterPayload(rosters[t]);
    const color = toHex6(team.color) || DEFAULT_COLORS[t];
    const side = $id('sbSide' + t);
    side.style.setProperty('--team', color);
    side.style.setProperty('--team-ink', inkFor(color));
    const logo = $id('sbLogo' + t);
    if (team.logoUrl) { logo.src = mediaUrl(team.logoUrl); logo.hidden = false; } else logo.hidden = true;
    const lost = Math.min(s['lost' + t] || 0, total);
    const left = total - lost;
    $id('sbName' + t).textContent = team.name || `Team ${t}`;
    $id('sbStock' + t).innerHTML = `<span><b>${left}</b> / ${total} stocks left</span>`;
    $id('sbScore' + t).textContent = String(s['score' + t] || 0);
    $id('sbWonLbl' + t).textContent = `${unit}s won`;
    $id('sbWin' + t).textContent = `Won ${unit.toLowerCase()}`;
    const on = $id('sbOn' + t);
    const idx = Math.floor(lost / stocksEach);
    // The order list below says who is on stage, when it has that player.
    on.hidden = left > 0 && !!team.players[idx];
    if (left <= 0) {
      on.textContent = 'Out of stocks';
    } else {
      const p = team.players[idx] || {};
      const name = p.gamertag || p.name || `Player ${idx + 1}`;
      on.innerHTML = 'On stage: <b></b>';
      on.querySelector('b').textContent = `${name} (${stocksEach - (lost % stocksEach)} left)`;
    }
    if (showStocks) renderOrderList(t, crewSize, stocksEach, lost);
    scorePanel.querySelector(`[data-sb="lose"][data-team="${t}"]`).disabled = left <= 0;
    scorePanel.querySelector(`[data-sb="undo"][data-team="${t}"]`).disabled = lost <= 0;
  });
  // Settings, unless being changed right now.
  setVal($id('sbStyleInput'), isRl ? 'rl' : 'standard');
  setVal($id('sbUnitInput'), ['Game', 'Map', 'Set', 'Round'].includes(s.unit) ? s.unit : 'Game');
  setVal($id('sbPositionInput'), s.position || 'top');
  setVal($id('sbCrewInput'), crewSize);
  setVal($id('sbStocksInput'), stocksEach);
  setVal($id('sbShowStocksInput'), s.showStocks === true);
  setVal($id('sbRlAutoInput'), s.rlAutoSeries !== false);
  setVal($id('sbRlPlayersInput'), s.rlPlayers !== false);
  setVal($id('sbRlBoostInput'), s.rlBoost !== false);
  setVal($id('sbRlColorsInput'), s.rlGameColors !== false);
  setVal($id('sbRlStatsInput'), s.rlAutoStats !== false);
  setVal($id('sbRlHudInput'), s.rlHideHud !== false);
  renderRlStatus();
}

[['sbStyleInput', 'style', (v) => (v === 'rl' ? 'rl' : 'standard')], ['sbUnitInput', 'unit', (v) => v], ['sbPositionInput', 'position', (v) => v],
  ['sbCrewInput', 'crewSize', (v) => clampInt(v, 1, 8, 4)], ['sbStocksInput', 'stocksEach', (v) => clampInt(v, 1, 5, 3)]]
  .forEach(([id, key, fn]) => onCommit($id(id), (el) => ({ scoreboard: { [key]: fn(el.value) } })));
[['sbShowStocksInput', 'showStocks'], ['sbRlAutoInput', 'rlAutoSeries'], ['sbRlPlayersInput', 'rlPlayers'], ['sbRlBoostInput', 'rlBoost'],
  ['sbRlColorsInput', 'rlGameColors'], ['sbRlStatsInput', 'rlAutoStats'], ['sbRlHudInput', 'rlHideHud']]
  .forEach(([id, key]) => onCommit($id(id), (el) => ({ scoreboard: { [key]: el.checked } })));

function sendScore(counters) {
  if (!wsOpen()) { toast('App connection lost. Score not changed.'); return; }
  ws.send(JSON.stringify({ type: 'score', scoreboard: counters }));
  mergeLocal({ scoreboard: counters });
  renderScorePanel();
}

function scoreAction(action, t, btn) {
  const s = sb();
  const total = clampInt(s.crewSize, 1, 8, 4) * clampInt(s.stocksEach, 1, 5, 3);
  const out = {};
  const score = (k) => s['score' + k] || 0;
  const lost = (k) => s['lost' + k] || 0;
  switch (action) {
    case 'lose': if (!s.showStocks) return; out['lost' + t] = Math.min(total, lost(t) + 1); break;
    case 'undo': if (!s.showStocks) return; out['lost' + t] = Math.max(0, Math.min(total, lost(t)) - 1); break;
    case 'score+': out['score' + t] = Math.min(9, score(t) + 1); break;
    case 'score-': out['score' + t] = Math.max(0, score(t) - 1); break;
    // A game/map/set is over: a point to the winner, and both crews refill.
    case 'win': Object.assign(out, { ['score' + t]: Math.min(9, score(t) + 1), lostA: 0, lostB: 0 }); break;
    case 'refill': Object.assign(out, { lostA: 0, lostB: 0 }); break;
    case 'swap': out.swap = !s.swap; break;
    case 'reset':
      if (btn && !armed(btn, 'Reset score')) return;
      Object.assign(out, { scoreA: 0, scoreB: 0, lostA: 0, lostB: 0, swap: false });
      // A new match also starts a new Rocket League series record.
      if (wsOpen()) ws.send(JSON.stringify({ type: 'rlSeriesReset' }));
      break;
    default: return;
  }
  if (t) {
    const side = $id('sbSide' + t);
    side.classList.remove('flash'); void side.offsetWidth; side.classList.add('flash');
  }
  sendScore(out);
}
scorePanel.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-sb]');
  if (btn) scoreAction(btn.dataset.sb, btn.dataset.team, btn);
});

// --- Rocket League (v0.11.0) ------------------------------------------------------
//
// The server reads Rocket League's Stats API (rlstats.js) and sends every
// page {type:'rl'} snapshots. Here they drive the status box and the header
// light. The Stats scene (v2.0.0) is its own OBS scene: these buttons pick
// what it shows and cut to it.

const rlStatusBox = $id('rlStatus');
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
  const tags = (t) => new Set(rosterPayload(rosters[t]).players.flatMap((p) => [norm(p.gamertag), norm(p.name)]).filter(Boolean));
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
  getJson('/api/rl/status').then((st) => { rlConfig = st.config; renderRlStatus(); }).catch(() => {});
}

function renderRlStatus() {
  const isRl = sb().style === 'rl';
  const light = $id('rlConn');
  light.hidden = !isRl;
  rlStatusBox.hidden = !isRl;
  $id('rlStatsBox').hidden = !isRl || !sceneList.some((s) => s.key === 'stats');
  if (!isRl) return;
  const st = rlSnap ? rlSnap.status : 'off';
  const connected = st === 'connected';
  $id('rlConnDot').className = 'dot' + (connected ? ' connected' : ' warn');
  $id('rlConnText').textContent = connected ? 'Rocket League' : 'Rocket League: waiting';
  let dot = '', text, sub = '';
  let canEnable = false;
  if (connected && rlSnap.inMatch) {
    dot = 'connected';
    const [blue, orange] = rlSnap.teams;
    text = `In a match: Blue ${blue ? blue.score : 0} - ${orange ? orange.score : 0} Orange, ${fmtClock(rlSnap.clock, rlSnap.overtime)}`;
    const notes = [];
    if (rlSnap.hudHidden) notes.push('Game HUD: hidden.');
    if (!rlSnap.target) notes.push('No spectated player: boost meter hidden.');
    sub = notes.join(' ');
  } else if (connected) {
    dot = 'connected';
    text = 'Rocket League: connected';
    sub = 'No active match.';
  } else {
    dot = 'warn';
    text = 'Rocket League: waiting';
    refreshRlConfig();
    if (rlConfig && !rlConfig.path) {
      sub = 'Rocket League settings folder not found. Launch the game once.';
    } else if (rlConfig && !rlConfig.enabled) {
      dot = '';
      text = 'Rocket League: Stats API not enabled';
      sub = 'Click Connect to Rocket League, then restart the game. The setting is read at launch.';
      canEnable = true;
    } else {
      sub = 'Stats API enabled. Start or restart Rocket League.';
    }
  }
  if (rlNote) sub = rlNote;
  $id('rlDot').className = 'dot' + (dot ? ' ' + dot : '');
  $id('rlText').textContent = text;
  $id('rlSub').textContent = sub;
  rlEnableBtn.hidden = !canEnable;
  // The left (blue) side is team A unless swapped. Offer a swap when the
  // roster names say the other team is on blue.
  const blue = rlBlueTeam();
  const shownBlue = sb().swap ? 'B' : 'A';
  rlSwapHintBtn.hidden = !blue || blue === shownBlue;
  if (!rlSwapHintBtn.hidden) {
    const name = rosterPayload(rosters[blue]).name || `Team ${blue}`;
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
  postJson('/api/rl/enable')
    .then((res) => {
      if (res.error) { showRlNote(res.error); return; }
      rlConfig = res.config;
      showRlNote('Stats API enabled. Restart Rocket League.');
    })
    .catch(() => showRlNote('App not reachable.'))
    .finally(() => { rlEnableBtn.disabled = false; });
});
rlSwapHintBtn.addEventListener('click', () => scoreAction('swap'));

let rlSeries = { games: [] };
let rlScreen = { screen: 'game', game: -1 };
const rlGamePick = $id('rlGamePick');
function renderRlScreenBtns() {
  const list = rlSeries.games || [];
  const prev = rlGamePick.value;
  rlGamePick.innerHTML = '';
  list.forEach((g, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `Game ${i + 1}: ${g.goals[0]}-${g.goals[1]}`;
    rlGamePick.appendChild(o);
  });
  const want = rlScreen.screen === 'game' && rlScreen.game >= 0 ? rlScreen.game : (prev !== '' && Number(prev) < list.length ? Number(prev) : list.length - 1);
  if (list.length) rlGamePick.value = String(Math.max(0, want));
  rlGamePick.hidden = !list.length;
  const statsUp = onAir.key === 'stats';
  document.querySelectorAll('[data-rls]').forEach((b) => {
    b.classList.toggle('on', statsUp && b.dataset.rls === rlScreen.screen);
    b.disabled = (b.dataset.rls === 'game' && !list.length) || !(obsStatus && obsStatus.connected);
  });
  $id('rlBackBtn').disabled = !(obsStatus && obsStatus.connected) || onAir.key === 'scoreboard';
}
document.querySelectorAll('[data-rls]').forEach((b) => b.addEventListener('click', () => {
  if (!wsOpen()) return;
  ws.send(JSON.stringify({ type: 'rlScreen', screen: b.dataset.rls, game: Number(rlGamePick.value || -1), show: true }));
}));
rlGamePick.addEventListener('change', () => {
  // Only switch what the Stats scene shows; cut to it with the button.
  if (wsOpen()) ws.send(JSON.stringify({ type: 'rlScreen', screen: 'game', game: Number(rlGamePick.value), show: onAir.key === 'stats' }));
});
$id('rlBackBtn').addEventListener('click', () => switchScene('scoreboard'));

// --- Live page: scenes --------------------------------------------------------------
//
// One row per scene the app built, with that scene's own words. The row of
// the scene on air is marked. "Put on air" cuts OBS to it with the current
// transition (the stinger once set up); otherwise OBS is where scenes change.

let sceneList = [];      // [{ key, scene }] from the server: the scenes this match uses
let sceneExists = {};    // key -> in OBS right now
let sceneStale = [];     // the app's scenes still in OBS that this match doesn't use
const SCENE_OPEN_KEY = 'stream-scene-open';
let sceneOpen = { 'starting-soon': true };
try { sceneOpen = JSON.parse(lsGet(SCENE_OPEN_KEY)) || sceneOpen; } catch (e) {}

const SCENE_TEXT = {
  'starting-soon': [['title', 'Title', 'Stream Starting Soon'], ['subtitle', 'Subtitle', 'Team A vs Team B'], ['status', 'Badge', 'Starting Soon']],
  'post-match': [['title', 'Title', 'Thanks for Watching'], ['subtitle', 'Subtitle', 'Optional'], ['status', 'Badge', 'Stream Ending Soon']],
  brb: [['title', 'Title', 'Be Right Back'], ['subtitle', 'Subtitle', 'Thanks for waiting']],
  standings: [['title', 'Heading', 'Standings']],
  matchup: [['title', 'Heading', 'Head to Head']],
};
if (BX) {
  SCENE_TEXT.roster = [['title', 'Heading', 'Starting Lineups']];
  SCENE_TEXT.schedule = [['title', 'Heading', 'This Week']];
  SCENE_TEXT.versus = [['title', 'Badge', 'Tonight']];
  BX.cameras.forEach((c) => { SCENE_TEXT[`cam-${c.id}`] = [['title', 'Label', c.title], ['subtitle', 'Location', c.subtitle || 'Optional'], ['status', 'Badge', 'Live']]; });
}

// The view a scene's background is kept under: every league graphic shares
// one, and the Scoreboard has none (the game shows through it).
function bgView(key) { return key.startsWith('necc:') ? 'necc' : key === 'scoreboard' || key.startsWith('cam-') ? '' : key; }
function bgValue(view) {
  const ok = (id) => BACKGROUNDS.some((b) => b.id === id);
  const picked = ((state && state.backgrounds) || {})[view];
  if (ok(picked)) return picked;
  const dflt = ((BRAND.backgrounds && BRAND.backgrounds.defaults) || {})[view];
  return ok(dflt) ? dflt : (BACKGROUNDS[0] || {}).id || '';
}

// The headline typeface in use: the one picked, else the league's default.
function headFontValue() {
  const ok = (id) => HEAD_FONTS.some((f) => f.id === id);
  const picked = state && state.headlineFont;
  if (ok(picked)) return picked;
  const dflt = (BRAND.headlineFonts || {}).default;
  return ok(dflt) ? dflt : (HEAD_FONTS[0] || {}).id || '';
}
// One button per typeface, its name set in that typeface.
function buildHeadFontPicker() {
  const seg = $id('headFontSeg');
  $id('headFontField').hidden = HEAD_FONTS.length < 2;
  if (HEAD_FONTS.length < 2) return;
  HEAD_FONTS.forEach((f) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'seg-btn'; b.dataset.font = f.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', f.name);
    b.title = f.name;
    b.textContent = f.name;
    b.style.fontFamily = `'${f.family}', system-ui, sans-serif`;
    b.addEventListener('click', () => {
      if (headFontValue() === f.id) return;
      send({ headlineFont: f.id });
      afterLocalChange();
    });
    seg.appendChild(b);
  });
}
buildHeadFontPicker();

function sceneNote(key) {
  if (key === 'roster') return 'Source: Rosters card.';
  if (key === 'schedule') return 'Source: Broadcast, Matches this week.';
  if (key === 'versus') return 'Both teams with logos, players and the countdown.';
  if (key.startsWith('cam-')) return 'Camera under a transparent frame. Device: Broadcast, Cameras.';
  if (key === 'scoreboard') return sb().style === 'rl' ? 'Live game data over the game capture.' : 'Manual score over the game capture.';
  if (key === 'stats') return 'Auto-cut after each game. Returns to Scoreboard at the next kickoff countdown.';
  if (key === 'standings') return `Source: ${league.site || 'league site'}.`;
  if (key === 'matchup') return `Source: ${league.site || 'league site'} standings.`;
  if (key === 'starting-soon') {
    const end = state && new Date(state.end);
    return end && !isNaN(end) ? `Countdown target: ${clockTime(end)}.` : '';
  }
  if (key.startsWith('necc:')) {
    const t = key.slice(5);
    return state && (state.neccUrls || {})[t] ? 'Link imported.' : `No link. Import a ${LEAGUE} match.`;
  }
  return '';
}

function buildSceneList() {
  const box = $id('sceneList');
  box.innerHTML = '';
  if (!sceneList.length) { box.innerHTML = '<div class="lib-empty">No scenes.</div>'; return; }
  sceneList.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'scene-row';
    row.dataset.key = s.key;
    const fields = SCENE_TEXT[s.key] || [];
    const extra = s.key === 'post-match';
    const hasBg = BACKGROUNDS.length > 1 && !!bgView(s.key);
    const expandable = fields.length || extra || hasBg;
    row.innerHTML = `
      <div class="scene-head">
        <span class="scene-tally" aria-hidden="true"></span>
        <button type="button" class="scene-name"${expandable ? '' : ' disabled'}><b>${esc(s.scene.replace(/^[^:]+:\s*/, ''))}</b>${expandable ? '<i class="chev"></i>' : ''}</button>
        <span class="scene-missing" hidden>Not in OBS</span>
        <button type="button" class="btn-secondary scene-go">Put on air</button>
      </div>
      <div class="scene-note"></div>
      <div class="scene-body"></div>`;
    const body = row.querySelector('.scene-body');
    fields.forEach(([field, label, ph]) => {
      const l = document.createElement('label');
      l.innerHTML = `<span class="lbl">${esc(label)}</span>`;
      const input = document.createElement('input');
      input.type = 'text'; input.placeholder = ph;
      input.dataset.view = s.key; input.dataset.field = field;
      l.appendChild(input);
      body.appendChild(l);
      onCommit(input, (el) => ({ views: { [s.key]: { [field]: el.value } } }));
    });
    if (s.key === 'post-match') {
      const l = document.createElement('label');
      l.innerHTML = '<span class="lbl">Countdown length (mm:ss)</span>';
      const input = document.createElement('input');
      input.type = 'text'; input.id = 'postMatchInput'; input.placeholder = '2:00';
      l.appendChild(input);
      body.appendChild(l);
      onCommit(input, (el) => { const sec = parseDuration(el.value) || 120; el.value = formatDuration(sec); return { postMatchSec: sec }; });
      const l2 = document.createElement('label');
      l2.innerHTML = '<span class="lbl">Layout</span>';
      const sel = document.createElement('select');
      sel.id = 'layoutInput';
      sel.innerHTML = '<option value="right">Video right, text left</option><option value="left">Video left, text right</option>';
      l2.appendChild(sel);
      body.appendChild(l2);
      onCommit(sel, (el) => ({ layout: el.value }));
    }
    // The scene's background, for a league with several.
    if (hasBg) {
      const l = document.createElement('label');
      l.innerHTML = `<span class="lbl">Background${s.key.startsWith('necc:') ? ` (all ${esc(LEAGUE)} graphics)` : ''}</span>`;
      const sel = document.createElement('select');
      sel.dataset.bg = bgView(s.key);
      BACKGROUNDS.forEach((b) => { const o = document.createElement('option'); o.value = b.id; o.textContent = b.name; sel.appendChild(o); });
      l.appendChild(sel);
      body.appendChild(l);
      onCommit(sel, (el) => ({ backgrounds: { [el.dataset.bg]: el.value } }));
    }
    row.querySelector('.scene-name').addEventListener('click', () => {
      sceneOpen[s.key] = !row.classList.contains('open');
      lsSet(SCENE_OPEN_KEY, JSON.stringify(sceneOpen));
      row.classList.toggle('open', sceneOpen[s.key]);
    });
    row.classList.toggle('open', !!(expandable && sceneOpen[s.key]));
    row.querySelector('.scene-go').addEventListener('click', () => switchScene(s.key));
    box.appendChild(row);
  });
  renderSceneList();
  renderOnAir();
}

function renderSceneList() {
  document.querySelectorAll('.scene-row').forEach((row) => {
    const key = row.dataset.key;
    row.querySelector('.scene-note').textContent = sceneNote(key);
    row.querySelector('.scene-missing').hidden = !(obsStatus && obsStatus.connected && sceneExists[key] === false);
    row.querySelectorAll('input[data-view]').forEach((input) => {
      const v = ((state && state.views) || {})[input.dataset.view] || {};
      setVal(input, v[input.dataset.field] || '');
    });
    row.querySelectorAll('select[data-bg]').forEach((sel) => setVal(sel, bgValue(sel.dataset.bg)));
  });
  if (state) {
    setVal($id('postMatchInput'), formatDuration(state.postMatchSec || 120));
    setVal($id('layoutInput'), state.layout || 'right');
    setVal($id('neccBgInput'), state.neccBg !== false);
    const font = headFontValue();
    document.querySelectorAll('#headFontSeg .seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.font === font);
      b.setAttribute('aria-checked', b.dataset.font === font ? 'true' : 'false');
    });
  }
  $id('neccBgField').hidden = !sceneList.some((s) => s.key.startsWith('necc:'));
  // OBS only changes on a build. Until then, say what differs: scenes this
  // match uses that OBS lacks, and the app's scenes it no longer uses.
  const connected = !!(obsStatus && obsStatus.connected);
  const missing = sceneList.filter((s) => sceneExists[s.key] === false).map((s) => shortScene(s.scene));
  const parts = [];
  if (missing.length) parts.push(`Missing in OBS: ${listText(missing)}`);
  if (sceneStale.length) parts.push(`Unused in OBS: ${listText(sceneStale.map(shortScene))}`);
  $id('sceneSync').hidden = !connected || !parts.length;
  $id('sceneSyncText').textContent = parts.length ? `${parts.join('. ')}.` : '';
}
$id('sceneSyncBtn').addEventListener('click', async (e) => {
  const res = await runBuild(e.target, document.createElement('span'), null);
  if (res.error) toast(`Build failed: ${res.error}`);
  else toast(`Scenes built${(res.removed || []).length ? `. Removed: ${listText(res.removed.map(shortScene))}` : ''}.`);
});
onCommit($id('neccBgInput'), (el) => ({ neccBg: el.checked }));

async function switchScene(key) {
  try {
    const r = await postJson('/api/obs/switch', { key });
    if (!r.switched) toast(r.error ? `Scene switch failed: ${r.error}` : 'Scene switch failed.');
  } catch (e) { toast('App not reachable.'); }
}

// --- Library and the team sheet -----------------------------------------------------

function renderLibrary() {
  const prev = matchSelect.value;
  matchSelect.innerHTML = library.matches.length ? '' : '<option value="">No saved matches</option>';
  library.matches.forEach((m) => {
    const o = document.createElement('option');
    const d = new Date(m.savedAt);
    o.value = m.id;
    o.textContent = `${m.name}${isNaN(d) ? '' : `  (${d.toLocaleDateString()})`}`;
    matchSelect.appendChild(o);
  });
  if (library.matches.some((m) => m.id === prev)) matchSelect.value = prev;
  $id('matchLoadBtn').disabled = $id('matchDeleteBtn').disabled = !library.matches.length;

  ['A', 'B'].forEach((L) => {
    const sel = rosterEls[L].lib;
    sel.innerHTML = `<option value="">${library.teams.length ? 'Load team…' : 'Library empty'}</option>`;
    library.teams.forEach((t) => {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.tag && t.tag !== t.name ? `${t.name} (${t.tag})` : t.name;
      sel.appendChild(o);
    });
  });
  renderSchoolGrid();
  renderTeamCards();
}

// The team library in Settings: logo, colour, short name and size at a
// glance, with Edit and Delete (undoable for a few seconds).
const libTeamList = $id('libTeamList');
const libManageSearch = $id('libManageSearch');
function renderTeamCards() {
  const q = libManageSearch.value.trim().toLowerCase();
  libTeamList.innerHTML = '';
  if (!library.teams.length) {
    libTeamList.innerHTML = '<div class="lib-empty">Library empty.</div>';
    return;
  }
  const list = library.teams.filter((t) => !q || `${t.name} ${t.tag}`.toLowerCase().includes(q));
  if (!list.length) { libTeamList.innerHTML = '<div class="lib-empty">No match.</div>'; return; }
  list.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'team-card';
    const color = toHex6(t.color);
    if (color) { card.style.setProperty('--team', color); card.style.setProperty('--team-ink', inkFor(color)); }
    const { logo } = teamTile(t);
    const n = (t.players || []).length;
    card.innerHTML = `<div class="tc-top">${logo.replace('<img ', '<img class="tc-logo" ').replace('class="mono"', 'class="tc-mono"')}<div class="tc-names"><b></b><small></small></div></div><div class="tc-actions"></div>`;
    card.querySelector('b').textContent = t.name;
    card.querySelector('small').textContent = [t.tag, `${n} player${n === 1 ? '' : 's'}`, t.league ? LEAGUE : ''].filter(Boolean).join(' · ');
    const actions = card.querySelector('.tc-actions');
    const mk = (text, cls, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn-secondary' + (cls ? ' ' + cls : ''); b.textContent = text;
      b.addEventListener('click', fn);
      actions.appendChild(b);
    };
    mk('Team A', '', () => useLibraryTeam('A', t));
    mk('Team B', '', () => useLibraryTeam('B', t));
    mk('Edit', '', () => openTeamSheet(t));
    mk('Delete', 'btn-quiet-danger', () => deleteTeam(t));
    libTeamList.appendChild(card);
  });
}
libManageSearch.addEventListener('input', renderTeamCards);

async function deleteTeam(t) {
  await fetch(`/api/library/teams/${encodeURIComponent(t.id)}`, { method: 'DELETE' }).catch(() => {});
  toast(`Deleted: ${t.name}`, 'Undo', () => {
    fetch('/api/library/teams', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) }).catch(() => {});
  });
}

// Edits a saved team in place (name, short name, colour, logo, players)
// without touching Team A or Team B.
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

// --- League (v2.0.0) -------------------------------------------------------------
// Each game's standings, read by the server from the league's site
// (league.json) and sent to every page. Read-only here: the table, the
// season it came from and when it was read. A row is { name, tag, rank, w, l,
// gw, gl, sf, sa, color, colorAlt, logoUrl }.

let league = { standings: {}, site: '' };
const lgGame = $id('lgGame');
const lgTable = $id('lgTable');
// Until a game is picked here, the page shows the match's game.
let lgGameChosen = false;
let lgBusy = false;

function norm(s) { return String(s || '').trim().toLowerCase(); }
// The standings row of a match team: by name, else by short name when only
// one row has it. (The overlay matches the same way.)
function rowIndex(rows, team) {
  const n = norm(team && team.name);
  if (!n) return -1;
  const starts = (a, b) => a === b || (a.startsWith(b) && /^[^a-z0-9]/.test(a.slice(b.length)));
  const byName = rows.findIndex((r) => { const rn = norm(r.name); return !!rn && (starts(n, rn) || starts(rn, n)); });
  if (byName >= 0) return byName;
  const tag = norm(team.tag);
  const byTag = tag ? rows.filter((r) => norm(r.tag) === tag) : [];
  return byTag.length === 1 ? rows.indexOf(byTag[0]) : -1;
}
function matchGameKey() { return (state && state.game) || 'other'; }
// The word for one game of a series in this game: "Map", "Game", "Set".
function lgUnit(key) {
  const g = games.find((x) => x.id === key);
  if (g && g.scoreboard && g.scoreboard.unit) return g.scoreboard.unit;
  return key === matchGameKey() ? (sb().unit || 'Game') : 'Game';
}
function signed(n) { return (n > 0 ? '+' : '') + n; }

async function lgRefresh(key) {
  if (lgBusy || !key) return;
  lgBusy = true;
  renderLeague();
  try {
    const res = await fetch('/api/league/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: key }) });
    const out = await res.json();
    if (res.ok && out.standings) league = out;
  } catch (e) { /* the status line reports the last read */ }
  lgBusy = false;
  renderLeague();
}

function renderLeague() {
  if (!LEAGUE_SCENES.length) return;
  const want = lgGameChosen && lgGame.value ? lgGame.value : matchGameKey();
  const list = games.map((g) => [g.id, g.name]);
  const sig = JSON.stringify(list);
  if (lgGame.dataset.sig !== sig) {
    lgGame.dataset.sig = sig;
    lgGame.innerHTML = '';
    list.forEach(([id, name]) => { const o = document.createElement('option'); o.value = id; o.textContent = name; lgGame.appendChild(o); });
  }
  if (document.activeElement !== lgGame) lgGame.value = list.some(([id]) => id === want) ? want : (list[0] || [''])[0];
  const key = lgGame.value;
  const s = league.standings[key] || { rows: [] };
  $id('lgSource').textContent = league.site || '';
  const status = $id('lgStatus');
  const at = (iso) => clockTime(new Date(iso));
  status.classList.toggle('error', !!s.error);
  if (lgBusy) status.textContent = `Reading ${league.site || 'the league site'}…`;
  else if (s.error) status.textContent = `Read failed: ${s.error}.${s.updatedAt ? ` Table from ${at(s.updatedAt)}.` : ''}`;
  else if (s.updatedAt) status.textContent = `${s.seasonName || 'Season'} · read ${at(s.updatedAt)}`;
  else status.textContent = 'Not read.';
  $id('lgRefresh').disabled = lgBusy || !key;
  $id('lgShow').disabled = !(obsStatus && obsStatus.connected) || sceneExists.standings === false || !sceneList.some((x) => x.key === 'standings') || key !== matchGameKey();

  const rows = s.rows || [];
  if (!rows.length) {
    lgTable.innerHTML = `<div class="lib-empty">${s.error || !s.updatedAt ? 'No table.' : 'No confirmed teams in this season.'}</div>`;
    return;
  }
  const unit = lgUnit(key);
  const here = key === matchGameKey();
  const playing = here ? [rowIndex(rows, rosterPayload(rosters.A)), rowIndex(rows, rosterPayload(rosters.B))] : [];
  const scoreHead = s.scored ? `<span>${esc(s.scoreName || 'Score')} diff</span>` : '';
  let html = `<div class="st-view-row st-view-head${s.scored ? ' scored' : ''}"><span>#</span><span></span><span class="l">School</span><span>Record</span><span>${esc(unit)}s</span><span>Diff</span>${scoreHead}</div>`;
  rows.forEach((r, i) => {
    const { color, logo } = teamTile(r);
    html += `<div class="st-view-row${s.scored ? ' scored' : ''}${playing.includes(i) ? ' playing' : ''}" style="--team:${color}">
      <b class="st-view-rank">${s.played ? r.rank : '–'}</b>${logo}<span class="st-view-name">${esc(r.name)}</span>
      <b>${r.w}-${r.l}</b><span>${r.gw}-${r.gl}</span><span>${signed(r.gw - r.gl)}</span>${s.scored ? `<span>${signed(r.sf - r.sa)}</span>` : ''}</div>`;
  });
  lgTable.innerHTML = html;
}

lgGame.addEventListener('change', () => {
  lgGameChosen = lgGame.value !== matchGameKey();
  renderLeague();
  // A game not read yet is read when it is picked.
  if (!league.standings[lgGame.value]) lgRefresh(lgGame.value);
});
$id('lgRefresh').addEventListener('click', () => lgRefresh(lgGame.value));
$id('lgShow').addEventListener('click', () => switchScene('standings'));

// --- WebSocket -------------------------------------------------------------------------

function setConnStatus(connected) {
  $id('connDot').classList.toggle('connected', connected);
  $id('connText').textContent = connected ? 'Connected' : 'Reconnecting…';
}

let firstState = true;
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.addEventListener('open', () => {
    setConnStatus(true);
    ws.send(JSON.stringify({ type: 'subscribe', role: 'panel' }));
  });
  ws.addEventListener('close', () => {
    setConnStatus(false);
    setTimeout(connect, 1500);
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    // A panel left open across an app update (an OBS dock) is the old
    // version's page: reload it, once per build.
    if (msg.type === 'hello') {
      const mine = (window.APP_STAMP || {}).panel || '';
      if (mine && msg.stamp && msg.stamp !== mine) {
        let done = false;
        try { done = sessionStorage.getItem('reloaded-for') === msg.stamp; sessionStorage.setItem('reloaded-for', msg.stamp); } catch (e) { done = true; }
        if (!done) { location.reload(); return; }
      }
    }
    if (msg.type === 'state') {
      state = msg.data;
      ['A', 'B'].forEach(syncRoster);
      renderAll();
      // A first visit opens on Match until both teams are picked.
      if (firstState) {
        firstState = false;
        if (!START_PAGE) setPage(state.teamA.name && state.teamB.name ? 'live' : 'match');
      }
    }
    if (msg.type === 'onair') { onAir = msg.onAir || onAir; renderOnAir(); renderSceneList(); }
    // The scenes this match uses changed (another game, an extra scene
    // ticked): redraw the list and ask OBS what it has.
    if (msg.type === 'scenes' && Array.isArray(msg.scenes)) {
      sceneList = msg.scenes;
      buildSceneList();
      renderRemoteList();
      renderRlStatus();
      refreshObs(true);
    }
    if (msg.type === 'league') { league = msg.league && msg.league.standings ? msg.league : { standings: {}, site: '' }; renderLeague(); }
    if (msg.type === 'rl') {
      const was = rlSnap;
      rlSnap = msg.rl;
      // Snapshots arrive up to 30 times a second; the status box only needs
      // redrawing when something it shows has changed.
      const key = (s) => (s ? [s.status, s.inMatch, s.clock, s.overtime, s.target, s.hudHidden, (s.teams || []).map((t) => t.score).join('-'), (s.players || []).map((p) => p.team + p.name).join()].join('|') : '');
      if (key(was) !== key(rlSnap)) renderRlStatus();
    }
    if (msg.type === 'music') renderMusic(msg.music);
    if (msg.type === 'prefs') applyPrefs(msg.prefs);
    if (msg.type === 'rlSeries') {
      rlSeries = msg.series || { games: [] };
      rlScreen = msg.screen || { screen: 'game', game: -1 };
      renderRlScreenBtns();
      renderOnAir();
    }
    if (msg.type === 'rlEvent' && msg.event && msg.event.type === 'matchEnded' && msg.event.series) {
      const t = msg.event.series;
      const name = rosterPayload(rosters[t]).name || `Team ${t}`;
      const side = $id('sbSide' + t);
      side.classList.remove('flash'); void side.offsetWidth; side.classList.add('flash');
      showRlNote(`Game over: ${name}. Series score updated.`);
    }
    if (msg.type === 'montages') { montageStatus = msg.montages || {}; renderMontages(); }
    if (window.bxPanel) window.bxPanel.onMessage(msg);
    if (msg.type === 'library') {
      library = msg.library || { teams: [], matches: [] };
      renderLibrary();
      renderLeague();
      if (!libraryLoaded) { libraryLoaded = true; maybeAutoWizard(); }
    }
  });
}

// Everything that shows the state.
function renderAll() {
  if (!state) return;
  setVal(teamInput, state.team || '');
  renderGameGrid();
  renderMatchup();
  renderMatchNow();
  renderSchoolGrid();
  renderDetails();
  renderNeccTypeList();
  renderScorePanel();
  renderSceneList();
  renderMontages();
  renderLeague();
  if (window.bxPanel) window.bxPanel.render();
  setVal($id('logoInput'), state.logo || '');
  ['twitch', 'twitter', 'instagram', 'youtube'].forEach((k) => setVal($id(k + 'Input'), (state.socials || {})[k] || ''));
  refreshFileFields();
  document.querySelectorAll('#stepper button').forEach((b) => b.classList.toggle('done', stepDone(b.dataset.step) && b.dataset.step !== currentStep));
  if (currentStep === 'build') renderChecklist();
}

onCommit($id('logoInput'), (el) => ({ logo: el.value.trim() }));
['twitch', 'twitter', 'instagram', 'youtube'].forEach((k) => onCommit($id(k + 'Input'), (el) => ({ socials: { [k]: el.value } })));

// --- Game montages (v0.10.0) ---------------------------------------------
// The server downloads each game's highlight video from Drive on demand
// (montages.js) and broadcasts progress; this only displays it and asks for
// downloads.
let montageStatus = {};
const montageList = $id('montageList');

function fmtGB(bytes) { return (bytes / 1e9).toFixed(2) + ' GB'; }
function montageText(m) {
  if (m.have) return 'Ready';
  if (m.downloading) return `Downloading ${Math.floor(100 * m.received / m.bytes)}% of ${fmtGB(m.bytes)}`;
  if (m.queued) return 'Queued';
  if (m.error) return 'Failed: ' + m.error;
  if (m.received > 0) return `Paused at ${Math.floor(100 * m.received / m.bytes)}%`;
  return `Not downloaded (${fmtGB(m.bytes)})`;
}
function requestMontage(game) { postJson('/api/montages/download', game ? { game } : {}).catch(() => {}); }

function renderMontages() {
  const game = state ? state.game : '';
  const m = montageStatus[game];
  const line = $id('gameMontageStatus');
  if (!game || !m) line.textContent = '';
  else line.textContent = (state.clip ? 'Highlight video: overridden by the Details video.' : 'Highlight video: ' + montageText(m));
  line.classList.toggle('error', !!(m && m.error && !m.have));

  montageList.innerHTML = '';
  let have = 0; let total = 0;
  games.forEach((g) => {
    const st = montageStatus[g.id];
    if (!st) return;
    total++;
    if (st.have) have++;
    const row = document.createElement('div');
    row.className = 'lib-row';
    row.innerHTML = '<span class="lib-name"></span><span class="lib-meta"></span>';
    row.querySelector('.lib-name').textContent = g.name;
    row.querySelector('.lib-meta').textContent = montageText(st);
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
  $id('montageTotal').textContent = total ? `${have}/${total} downloaded` : '';
  $id('montageAllBtn').disabled = have === total;
  $id('videosCard').hidden = total === 0;
  if (!$id('wizard').hidden) renderWizVideos();
}
$id('montageAllBtn').addEventListener('click', () => requestMontage(''));

// --- Pages and collapsible cards ----------------------------------------------------

const PAGE_KEY = 'stream-page';
const PAGES = ['match', 'live', ...(BX ? ['broadcast'] : []), ...(LEAGUE_SCENES.length ? ['league'] : []), 'settings'];
$id('bxPageBtn').hidden = !BX;
$id('leaguePageBtn').hidden = !LEAGUE_SCENES.length;
// ?page=live opens on that page, e.g. for an OBS dock that only keeps score.
const START_PAGE = [new URLSearchParams(location.search).get('page'), lsGet(PAGE_KEY)].find((p) => PAGES.includes(p)) || '';
let currentPage = 'live';
function setPage(name) {
  if (!PAGES.includes(name)) name = 'live';
  currentPage = name;
  document.querySelectorAll('.page-btn').forEach((b) => {
    const on = b.dataset.page === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.page[data-page]').forEach((p) => { p.hidden = p.dataset.page !== name; });
  placeRosterEditor(name);
  lsSet(PAGE_KEY, name);
  $id('pageCol').scrollTop = 0;
  if (name === 'match') showStep(currentStep);
  pollShot();
}
document.querySelectorAll('.page-btn').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.page)));

const COLLAPSED_KEY = 'stream-collapsed';
let collapsedSections = new Set(['set-remote', 'set-library']);
try { const saved = JSON.parse(lsGet(COLLAPSED_KEY)); if (Array.isArray(saved)) collapsedSections = new Set(saved); } catch (e) {}
function applyCollapsed() {
  document.querySelectorAll('.collapsible[data-section]').forEach((c) => c.classList.toggle('collapsed', collapsedSections.has(c.dataset.section)));
}
function saveCollapsed() { lsSet(COLLAPSED_KEY, JSON.stringify(Array.from(collapsedSections))); applyCollapsed(); }
function openSection(key) { collapsedSections.delete(key); saveCollapsed(); }
function scrollToSection(key) {
  const card = document.querySelector(`[data-section="${key}"]`);
  if (card) card.scrollIntoView({ block: 'start' });
}
document.addEventListener('click', (e) => {
  const head = e.target.closest && e.target.closest('.collapsible > .card-head');
  if (!head || e.target.closest('.info, button, a, input, select, label')) return;
  const key = head.parentElement.dataset.section;
  if (!key) return;
  if (collapsedSections.has(key)) collapsedSections.delete(key); else collapsedSections.add(key);
  saveCollapsed();
});

// --- Display (per window) ---------------------------------------------------------

const TEXT_KEY = 'widener-text-size';
const TEXT_SIZES = ['small', 'normal', 'large', 'xlarge'];
const TEXT_NAMES = { small: 'Small', normal: 'Normal', large: 'Large', xlarge: 'Extra large' };
function setTextSize(size, announce) {
  if (!TEXT_SIZES.includes(size)) size = 'normal';
  document.documentElement.dataset.text = size;
  document.querySelectorAll('#textSizeSeg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.size === size));
  lsSet(TEXT_KEY, size);
  if (announce) toast(`Text size: ${TEXT_NAMES[size]}`, null, null, 1500);
}
function stepTextSize(d) {
  const i = TEXT_SIZES.indexOf(document.documentElement.dataset.text || 'normal');
  setTextSize(TEXT_SIZES[Math.max(0, Math.min(TEXT_SIZES.length - 1, i + d))], true);
}
document.querySelectorAll('#textSizeSeg .seg-btn').forEach((b) => b.addEventListener('click', () => setTextSize(b.dataset.size)));

// --- Keyboard shortcuts ------------------------------------------------------------------

function isTypingTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'color', 'file', 'range'].includes(el.type);
}
function popupOpen() { return !$id('shortcutsModal').hidden || !teamSheet.hidden || !$id('wizard').hidden; }

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    hideTip();
    if (!$id('shortcutsModal').hidden) { closeShortcuts(); return; }
    if (!teamSheet.hidden) { closeTeamSheet(); return; }
  }
  // Text size. Taken here so Electron's whole-page zoom doesn't also run.
  if (mod && !e.altKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); stepTextSize(1); return; }
  if (mod && !e.altKey && (e.key === '-' || e.key === '_')) { e.preventDefault(); stepTextSize(-1); return; }
  if (mod && !e.altKey && e.key === '0') { e.preventDefault(); setTextSize('normal', true); return; }
  if (isTypingTarget(e.target) || popupOpen()) return;
  if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) { e.preventDefault(); openShortcuts(); return; }
  if (mod || e.altKey || e.repeat) return;
  // Scoring keys, on the Live page only.
  if (currentPage !== 'live') return;
  const keys = {
    Digit1: e.shiftKey ? ['undo', 'A'] : ['lose', 'A'],
    Digit2: e.shiftKey ? ['undo', 'B'] : ['lose', 'B'],
    Digit3: e.shiftKey ? null : ['win', 'A'],
    Digit4: e.shiftKey ? null : ['win', 'B'],
  };
  const hit = keys[e.code];
  if (hit) { e.preventDefault(); scoreAction(hit[0], hit[1]); }
});

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

// --- Info points --------------------------------------------------------------------------
//
// One shared floating bubble serves every .info dot. It's position:fixed and
// clamped to the viewport, so a tip can't be clipped by a scrolling column or
// squeezed off-screen in a narrow OBS dock.

const tipBubble = document.createElement('div');
tipBubble.className = 'tip-bubble';
tipBubble.setAttribute('role', 'tooltip');
document.body.appendChild(tipBubble);
const TIP_GAP = 8;
function showTip(el) {
  const text = el.getAttribute('data-tip');
  if (!text) return;
  tipBubble.textContent = text;
  const anchor = el.getBoundingClientRect();
  const bubble = tipBubble.getBoundingClientRect();
  let left = anchor.left + anchor.width / 2 - bubble.width / 2;
  left = Math.max(TIP_GAP, Math.min(left, window.innerWidth - bubble.width - TIP_GAP));
  let top = anchor.top - bubble.height - TIP_GAP;
  if (top < TIP_GAP) top = anchor.bottom + TIP_GAP;
  tipBubble.style.left = `${Math.round(left)}px`;
  tipBubble.style.top = `${Math.round(top)}px`;
  tipBubble.classList.add('visible');
}
function hideTip() { tipBubble.classList.remove('visible'); }
document.addEventListener('mouseover', (e) => { const el = e.target.closest && e.target.closest('.info'); if (el) showTip(el); });
document.addEventListener('mouseout', (e) => { if (e.target.closest && e.target.closest('.info')) hideTip(); });
document.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('.info'); if (el) showTip(el); });
document.addEventListener('focusout', (e) => { if (e.target.closest && e.target.closest('.info')) hideTip(); });
document.addEventListener('scroll', hideTip, true);
window.addEventListener('resize', hideTip);
// An info dot inside a <label> would otherwise toggle that label's checkbox.
document.addEventListener('click', (e) => { const el = e.target.closest && e.target.closest('.info'); if (el) { e.preventDefault(); showTip(el); } });

// --- Toasts -------------------------------------------------------------------------------
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
  while (box.children.length >= 3) box.firstChild.remove();
  box.appendChild(t);
  timer = setTimeout(close, ms || (actionLabel ? 8000 : 3500));
}

// --- OBS ---------------------------------------------------------------------------------
//
// The server owns the one obs-websocket connection; the password is entered
// here, sent over localhost, and only ever held in the server's memory (plus
// this machine's browser storage as a convenience). After one successful
// Connect the panel connects again by itself whenever the app starts, and
// the server reconnects if OBS restarts.

const obsHostInput = $id('obsHostInput');
const obsPortInput = $id('obsPortInput');
const obsPassInput = $id('obsPassInput');
const obsConnectBtn = $id('obsConnectBtn');
const obsDisconnectBtn = $id('obsDisconnectBtn');
const obsStatusEl = $id('obsStatus');

const OBS_SETTINGS_KEY = 'widener-obs-settings';
let obsAutoConnect = false;
let obsStatus = null;
let obsChecked = false;

function loadObsSettings() {
  try {
    const s = JSON.parse(lsGet(OBS_SETTINGS_KEY)) || {};
    if (s.host) obsHostInput.value = s.host;
    if (s.port) obsPortInput.value = s.port;
    if (typeof s.password === 'string') obsPassInput.value = s.password;
    obsAutoConnect = !!s.autoConnect;
  } catch (e) {}
}
function saveObsSettings() {
  lsSet(OBS_SETTINGS_KEY, JSON.stringify({
    host: obsHostInput.value.trim(),
    port: parseInt(obsPortInput.value, 10) || 4455,
    // Convenience only, on this machine. Not committed, not logged.
    password: obsPassInput.value,
    autoConnect: obsAutoConnect,
  }));
}

function renderObsStatus(st) {
  obsStatus = st;
  const connected = !!(st && st.connected);
  const reconnecting = !!(st && st.reconnecting);
  obsConnectBtn.disabled = connected;
  obsDisconnectBtn.disabled = !connected && !reconnecting;
  $id('obsConnDot').className = 'dot' + (connected ? ' connected' : reconnecting ? ' warn' : '');
  $id('obsConnText').textContent = connected ? 'OBS' : reconnecting ? 'OBS reconnecting…' : 'OBS offline';
  $id('obsBanner').hidden = connected || !obsChecked || !$id('wizard').hidden;
  $id('obsBannerText').textContent = reconnecting
    ? 'OBS connection lost. Retrying.'
    : 'OBS not connected. Scene builds and switches are unavailable.';
  $id('obsBannerBtn').hidden = reconnecting;
  if (st && Array.isArray(st.scenes) && JSON.stringify(st.scenes) !== JSON.stringify(sceneList)) {
    sceneList = st.scenes;
    buildSceneList();
    renderRemoteList();
  }
  if (st && st.collection) {
    $id('collectionName').textContent = st.collection;
    $id('wizCollection').textContent = st.collection;
  }
  if (!connected) {
    if (reconnecting) {
      obsStatusEl.textContent = `Connection lost. Retrying${st.error ? ` (${st.error})` : ''}.`;
      obsStatusEl.classList.add('error');
    } else {
      obsStatusEl.textContent = (st && st.error) ? `Not connected. ${st.error}` : 'Not connected';
      obsStatusEl.classList.toggle('error', !!(st && st.error));
    }
  } else {
    obsStatusEl.classList.remove('error');
    obsStatusEl.textContent = `Connected${st.currentScene ? ` · on air: ${st.currentScene}` : ''}`;
  }
  renderOnAir();
  renderSceneList();
  renderRlStatus();
  if (connected !== shotWasConnected) { shotWasConnected = connected; pollShot(); }
}
let shotWasConnected = false;

// Status plus which scenes exist in OBS and the stinger.
async function refreshObs(inspect) {
  try {
    const st = await getJson(inspect ? '/api/obs/inspect' : '/api/obs/status');
    obsChecked = true;
    if (st.exists) sceneExists = st.exists;
    if (Array.isArray(st.stale)) sceneStale = st.stale;
    if (!st.connected) sceneStale = [];
    if (st.stinger) { stingerState = { ...(stingerState || {}), ...st.stinger }; renderStingerGuides(); }
    if (st.video !== undefined) obsVideo = st.video;
    if (!st.connected) obsVideo = null;
    if (st.onAirNow) onAir = st.onAirNow;
    renderObsStatus(st);
    if (inspect && currentStep === 'build') renderChecklist();
    return st;
  } catch (e) {
    renderObsStatus({ connected: false, error: 'the app is not answering' });
    return null;
  }
}

async function obsConnect(retry) {
  saveObsSettings();
  obsStatusEl.classList.remove('error');
  obsStatusEl.textContent = 'Connecting…';
  obsConnectBtn.disabled = true;
  let st = null;
  try {
    st = await postJson('/api/obs/connect', {
      host: obsHostInput.value.trim(), port: parseInt(obsPortInput.value, 10) || 4455,
      password: obsPassInput.value, retry: !!retry,
    });
    if (st.connected) { obsAutoConnect = true; saveObsSettings(); }
    renderObsStatus(st);
    st = (await refreshObs(true)) || st;
  } catch (e) {
    st = { connected: false, error: 'connection failed' };
    renderObsStatus(st);
  }
  return st;
}
obsConnectBtn.addEventListener('click', () => obsConnect(false));
obsDisconnectBtn.addEventListener('click', async () => {
  obsAutoConnect = false;
  saveObsSettings();
  try { renderObsStatus(await postJson('/api/obs/disconnect')); } catch (e) {}
});
$id('obsBuildBtn').addEventListener('click', (e) => runBuild(e.target, $id('obsBuildStatus'), null));
$id('copyDockBtn').addEventListener('click', (e) => copyText($id('dockUrl').value, e.target));

// The OBS light and banner open the connection settings (or the guide, if
// this PC has never connected).
function openObsSettings() {
  if (!obsAutoConnect && !obsPassInput.value) { openWizard('connect'); return; }
  setPage('settings');
  openSection('set-obs');
  scrollToSection('set-obs');
  obsPassInput.focus();
}
$id('obsConn').addEventListener('click', openObsSettings);
$id('obsBannerBtn').addEventListener('click', openObsSettings);

// Keep the OBS status current (connection drops, reconnects). Scene changes
// arrive at once over the WebSocket; this catches the rest.
let obsWasConnected = false;
setInterval(async () => {
  const st = await refreshObs(false);
  const now = !!(st && st.connected);
  if (now && !obsWasConnected) refreshObs(true);
  obsWasConnected = now;
}, 4000);
// OBS has no event for a changed video setting: the Build step's checklist
// asks again when the panel is returned to.
window.addEventListener('focus', () => { if (currentPage === 'match' && currentStep === 'build') refreshObs(true); });

// --- Stinger -----------------------------------------------------------------------------
//
// OBS plays the league's stinger between scenes. obs-websocket can't create
// a transition, so the operator adds one Stinger, named for the league, once;
// the app then points it at the video (copied out of the app so OBS can read
// it), sets the cut point and the matte, and makes it OBS's transition.

let stingerState = null; // { found, current, name }
// The result of the last Set up click, shown until the next one.
let stingerMsg = null;   // { text, error }
let stingerFile = null;  // { path, transitionPoint, trackMatte, name }

async function refreshStinger() {
  if (!BRAND.stinger) return;
  try {
    const r = await getJson('/api/obs/stinger');
    stingerFile = r.file;
    stingerState = r.status;
  } catch (e) { /* keep what we had */ }
  renderStingerGuides();
  if (currentStep === 'build') renderChecklist();
}

function renderStingerGuides() {
  if (!BRAND.stinger) return;
  const st = BRAND.stinger;
  const f = stingerFile || {};
  const connected = !!(obsStatus && obsStatus.connected);
  const found = !!(stingerState && stingerState.found);
  const current = !!(stingerState && stingerState.current);
  document.querySelectorAll('[data-stinger-guide]').forEach((box) => {
    box.innerHTML = `
      <p class="card-text">obs-websocket cannot create transitions. Create the Stinger in OBS once; the app then configures and selects it.</p>
      <ol class="wiz-list">
        <li>OBS: <b>Scene Collection</b> &gt; <b>${esc((obsStatus && obsStatus.collection) || BRAND.shortName + ' Stream')}</b>. Transitions are stored per scene collection.</li>
        <li><b>Scene Transitions</b> dock (<b>Docks</b> &gt; <b>Scene Transitions</b> if hidden) &gt; <b>+</b> &gt; <b>Stinger</b>.</li>
        <li>Name: <code>${esc(st.name)}</code> <button type="button" class="btn-secondary mini" data-copy="${esc(st.name)}">Copy</button>. Click <b>OK</b>.</li>
        <li>Close the properties dialog with <b>OK</b>. No values are needed.</li>
        <li>Click <b>Configure stinger</b> below.</li>
      </ol>
      <div class="push-row"><button type="button" class="btn-accent stinger-go">Configure stinger</button></div>
      <div class="status-line stinger-status"></div>
      <details class="help" style="margin-top:12px">
        <summary>Applied settings</summary>
        <div class="help-body">
          <p>OBS: Scene Transitions dock &gt; gear &gt; Properties.</p>
          <p><b>Video file:</b> <code class="path">${esc(f.path || 'copied to the app data folder on setup')}</code>
            ${f.path ? `<button type="button" class="btn-secondary mini" data-copy="${esc(f.path)}">Copy</button>` : ''}</p>
          <p><b>Transition point type:</b> Time (milliseconds). <b>Transition point:</b> ${st.transitionPoint} ms</p>
          <p><b>Track matte:</b> ${st.trackMatte
            ? 'on: tick <b>Use a track matte</b>, layout <b>Same file, side-by-side (stinger on left, track matte on right)</b>.'
            : 'off. The video has an alpha channel.'}</p>
          <p><b>Audio:</b> none. The video has no audio track.</p>
        </div>
      </details>`;
    const status = box.querySelector('.stinger-status');
    if (stingerMsg && connected) { status.textContent = stingerMsg.text; status.classList.toggle('error', stingerMsg.error); }
    else if (!connected) status.textContent = 'OBS not connected.';
    else if (found && current) { status.textContent = `${st.name}: present, current transition.`; }
    else if (found) status.textContent = `${st.name}: present, not configured.`;
    else status.textContent = `${st.name}: not found in OBS.`;
    box.querySelector('.stinger-go').disabled = !connected;
    box.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy, b)));
    box.querySelector('.stinger-go').addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true;
      status.classList.remove('error');
      status.textContent = 'Configuring…';
      let r;
      try { r = await postJson('/api/obs/stinger'); } catch (err) { r = { error: 'App not reachable' }; }
      if (r.file) stingerFile = r.file;
      if (r.error) stingerMsg = { text: r.error, error: true };
      else if (!r.found) stingerMsg = { text: `No transition named "${r.name}" in OBS. The name is case-sensitive.`, error: true };
      else stingerMsg = { text: `${r.name}: configured and selected.`, error: false };
      if (!r.error) stingerState = { found: !!r.found, current: !!r.configured, name: r.name };
      renderStingerGuides();
      if (currentStep === 'build') renderChecklist();
    });
  });
}

// --- Background music (v0.11.0) ----------------------------------------------
// The server keeps the settings and tells OBS what to do (see obs.js); this
// only edits them. Music settings are machine-wide, not part of a match.
const musicEnable = $id('musicEnable');
const musicEnable2 = $id('musicEnable2');
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
  musicEnable2.checked = m.enabled;
  const dl = m.download || {};
  const hasTrack = m.hasTrack !== false;
  const usingTrack = hasTrack && (!m.file || m.customMissing);
  musicFileText.value = m.file ? fileLabel(m.file) : (hasTrack ? 'Default track' : 'No file');
  musicFileText.title = m.path || '';
  if (document.activeElement !== musicVolume) musicVolume.value = String(m.volume);
  musicVolumeText.textContent = musicVolText(Number(musicVolume.value));
  musicDefaultBtn.hidden = !hasTrack;
  musicDefaultBtn.disabled = !m.file;
  musicDownloadBtn.hidden = !usingTrack || dl.have || dl.downloading || dl.queued;
  let text;
  let error = false;
  if (!hasTrack && !m.file) text = 'No audio file selected.';
  else if (!hasTrack && m.customMissing) { text = 'Audio file missing.'; error = true; }
  else if (usingTrack && dl.downloading) text = `Downloading default track: ${Math.floor(100 * dl.received / dl.bytes)}%`;
  else if (usingTrack && dl.queued) text = 'Default track: queued.';
  else if (usingTrack && !dl.have) {
    text = dl.error ? `Download failed: ${dl.error}` : 'Default track: not downloaded.';
    if (m.customMissing) text = 'Custom file missing. ' + text;
    error = !!dl.error || m.customMissing;
  } else if (m.customMissing) text = 'Custom file missing. Using the default track.';
  else if (!m.enabled) text = 'Off.';
  else if (!m.obsConnected) text = 'OBS not connected.';
  else text = m.playing ? 'Playing.' : 'Faded out (gameplay scene on air).';
  musicStatusEl.textContent = text;
  musicStatusEl.classList.toggle('error', error || (!!m.customMissing && !usingTrack));
}
function saveMusic(patch) {
  postJson('/api/music', patch)
    .then((m) => {
      if (m.error) { musicStatusEl.textContent = m.error; musicStatusEl.classList.add('error'); return; }
      renderMusic(m);
    })
    .catch(() => {});
}
musicEnable.addEventListener('change', () => saveMusic({ enabled: musicEnable.checked }));
musicEnable2.addEventListener('change', () => saveMusic({ enabled: musicEnable2.checked }));
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
musicDownloadBtn.addEventListener('click', () => { postJson('/api/music/download').then(renderMusic).catch(() => {}); });

// --- Remote control (v0.12.0) -----------------------------------------------------
//
// The addresses a Stream Deck or Companion button can POST to (see the
// /api/remote routes in server.js), each with a Copy button.

const REMOTE_LABELS = {
  'stats/game': 'Stats: last game', 'stats/series': 'Stats: series overview',
  'score/a/win': 'Team A +1 series win', 'score/b/win': 'Team B +1 series win',
  'score/a/point': 'Team A +1 point', 'score/a/unpoint': 'Team A −1 point',
  'score/b/point': 'Team B +1 point', 'score/b/unpoint': 'Team B −1 point',
  'score/a/stock': 'Team A −1 stock', 'score/b/stock': 'Team B −1 stock',
  'score/a/unstock': 'Team A +1 stock', 'score/b/unstock': 'Team B +1 stock',
  'score/swap': 'Swap sides',
};
if (BX) {
  BX.cameras.forEach((c) => { REMOTE_LABELS[`cam/${c.id}/toggle`] = `${c.label} window: toggle`; });
  REMOTE_LABELS['lower/hide'] = 'Lower third: hide';
}
function renderRemoteList() {
  const list = $id('remoteList');
  const base = `${location.origin}/api/remote/`;
  const actions = [
    ...sceneList.map((s) => [`Cut to ${s.scene.replace(/^[^:]+:\s*/, '')}`, `scene/${s.key.replace(/^necc:/, 'necc-')}`]),
    ...Object.keys(REMOTE_LABELS).filter((p) => !p.startsWith('stats/') || sceneList.some((s) => s.key === 'stats')).map((p) => [REMOTE_LABELS[p], p]),
  ];
  list.innerHTML = '';
  actions.forEach(([label, p]) => {
    const row = document.createElement('div');
    row.className = 'remote-row';
    const name = document.createElement('span');
    name.textContent = label;
    const code = document.createElement('code');
    code.textContent = base + p;
    code.title = base + p;
    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'btn-secondary'; copy.textContent = 'Copy';
    copy.addEventListener('click', () => copyText(base + p, copy));
    row.append(name, code, copy);
    list.appendChild(row);
  });
}

// --- Setup guide (v2.0.0) -------------------------------------------------------------
//
// OBS is required, so the guide connects it, builds the scenes and adds the
// stinger, then offers the game video downloads. It opens by itself the first
// time this version runs; Settings can run it again any time.

const wizard = $id('wizard');
let wizStep = 'welcome';
let wizardDecided = false;

function hasGameVideos() { return Object.keys(montageStatus).length > 0; }
function wizOrder() {
  return ['welcome', 'connect', 'scenes', 'stinger', 'videos', 'done']
    .filter((s) => (s !== 'stinger' || BRAND.stinger) && (s !== 'videos' || hasGameVideos()));
}
function showWizStep(step) {
  wizStep = step;
  wizard.querySelectorAll('.wiz-step').forEach((s) => { s.hidden = s.dataset.step !== step; });
  const order = wizOrder();
  const idx = order.indexOf(step);
  $id('wizSteps').innerHTML = order.map((_, i) => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('');
  // Number the steps after the welcome in the order they appear.
  wizard.querySelectorAll('.wiz-step h3').forEach((h) => {
    const s = h.closest('.wiz-step').dataset.step;
    const n = order.indexOf(s);
    if (n > 0 && s !== 'done') h.textContent = h.textContent.replace(/^-?\d+\.\s*/, `${n}. `);
  });
  if (step === 'videos') renderWizVideos();
  if (step === 'connect') { $id('wizPass').value = obsPassInput.value; renderWizConnect(null); }
  if (step === 'stinger') refreshStinger();
  const focus = wizard.querySelector(`.wiz-step[data-step="${step}"] input[type=password], .wiz-step[data-step="${step}"] [data-wiz="next"]:not(:disabled), .wiz-step[data-step="${step}"] [data-wiz="finish"]`);
  if (focus) focus.focus();
}
function openWizard(step) {
  wizard.hidden = false;
  $id('obsBanner').hidden = true;
  showWizStep(step || 'welcome');
}
function closeWizard() {
  wizard.hidden = true;
  if (!prefs.guideV2) savePrefs({ guideV2: true, setupDone: true });
  renderObsStatus(obsStatus);
}
wizard.addEventListener('click', (e) => {
  const b = e.target.closest('[data-wiz]');
  if (!b) return;
  const order = wizOrder();
  const i = order.indexOf(wizStep);
  if (b.dataset.wiz === 'next') showWizStep(order[Math.min(order.length - 1, i + 1)]);
  if (b.dataset.wiz === 'back') showWizStep(order[Math.max(0, i - 1)]);
  if (b.dataset.wiz === 'skip') { closeWizard(); toast('Setup skipped. Available under Settings.'); }
  if (b.dataset.wiz === 'finish') { closeWizard(); setPage('match'); showStep(STEPS[0]); }
});

function renderWizConnect(res) {
  const st = $id('wizConnectStatus');
  const s = res || obsStatus;
  const connected = !!(s && s.connected);
  $id('wizConnectNext').disabled = !connected;
  st.classList.remove('error');
  if (connected) st.textContent = res ? 'Connected.' : 'Already connected.';
  else if (res) {
    const err = String(res.error || '');
    const why = /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/.test(err) ? 'No response. Check that OBS is running and its WebSocket server is enabled.'
      : /auth|password/i.test(err) ? 'Authentication failed. Copy the password from Show Connect Info.'
        : `${err ? err + '. ' : ''}Check that OBS is running, the WebSocket server is enabled and the password is correct.`;
    st.textContent = `Connection failed. ${why}`;
    st.classList.add('error');
  } else st.textContent = '';
}
$id('wizConnectBtn').addEventListener('click', async () => {
  obsPassInput.value = $id('wizPass').value;
  $id('wizConnectStatus').textContent = 'Connecting…';
  renderWizConnect(await obsConnect(false));
});
$id('wizPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $id('wizConnectBtn').click(); });
$id('wizBuildBtn').addEventListener('click', (e) => runBuild(e.target, $id('wizBuildStatus'), $id('wizBuildResult')));

function renderWizVideos() {
  const list = Object.values(montageStatus);
  const total = list.length;
  const have = list.filter((m) => m.have).length;
  const missing = list.reduce((sum, m) => sum + (m.have ? 0 : Math.max(0, m.bytes - (m.received || 0))), 0);
  $id('wizVideoSize').textContent = missing > 0
    ? `${total - have} of ${total} not downloaded (${fmtGB(missing)}).`
    : 'All downloaded.';
  $id('wizDownloadBtn').disabled = missing <= 0;
  const dl = list.find((m) => m.downloading);
  $id('wizVideoStatus').textContent = dl
    ? `Downloading: ${have}/${total}. Continues in the background.`
    : `${have}/${total} downloaded.`;
}
$id('wizDownloadBtn').addEventListener('click', () => { requestMontage(''); $id('wizVideoStatus').textContent = 'Starting…'; });

// Opens by itself the first time v2 runs on this PC, for new installs and
// upgrades alike: v1 users need the new scene collection and stinger too.
function maybeAutoWizard() {
  if (wizardDecided || !prefsLoaded || !libraryLoaded) return;
  wizardDecided = true;
  if (!prefs.guideV2) openWizard();
}
$id('wizardOpenBtn').addEventListener('click', () => openWizard());

// --- Init -----------------------------------------------------------------------------------------------

if (!BRAND.stinger) $id('stingerCard').hidden = true;
if (!BRAND.hasMusicTrack) $id('musicTrackHelp').firstChild.textContent = 'No default track. Select a local audio file. ';
makeFileField(clipInput, { accept: 'video/*', emptyText: 'Game highlight video' });
makeFileField($id('logoInput'), { accept: 'image/*', emptyText: `Default ${BRAND.shortName} logo` });
tsLogoField = makeFileField(tsLogo, { accept: 'image/*', emptyText: 'No logo' });
buildRosterEditor('A');
buildRosterEditor('B');
renderRosterEditor('A');
renderRosterEditor('B');
buildScoreSide('A');
buildScoreSide('B');
renderLibrary();
applyCollapsed();
setTextSize(lsGet(TEXT_KEY) || 'normal');
shotInput.checked = lsGet(SHOT_KEY) !== 'off';
showTeamSrc(lsGet(SRC_KEY) || (LINK_FIRST || BRAND.leagueTeams ? 'library' : 'import'));
setPickFor('A');
currentStep = [new URLSearchParams(location.search).get('step'), lsGet(STEP_KEY)].find((x) => STEPS.includes(x)) || STEPS[0];
setPage(START_PAGE || 'live');
showCountdownFields();
$id('dockUrl').value = `${location.origin}/control`;
loadObsSettings();
renderNeccTypeList();
renderStingerGuides();
loadPrefs();
getJson('/api/music').then(renderMusic).catch(() => {});
getJson('/api/version').then((v) => { $id('appVersion').textContent = 'v' + v.version; }).catch(() => {});

getJson('/games.json').then((data) => {
  games = data;
  renderGameGrid();
  connect();
});

// Reflect a connection that survived a panel reload, and connect by itself
// if this machine has connected before (e.g. the app was just started).
refreshObs(true).then((st) => {
  obsWasConnected = !!(st && st.connected);
  if (st && !st.connected && !st.reconnecting && obsAutoConnect) obsConnect(true);
  refreshStinger();
});
