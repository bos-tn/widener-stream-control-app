const obsUrl = document.getElementById('obsUrl');
const copyUrlBtn = document.getElementById('copyUrlBtn');

// When OBS scene-sync is active, OBS plays the transition between scenes, so
// the in-overlay curtain stinger is suppressed on push to avoid doubling it.
let obsSceneSyncActive = false;

const gameSelect = document.getElementById('gameSelect');
const overlaySelect = document.getElementById('overlaySelect');
const neccOptGroup = document.getElementById('neccOptGroup');
const neccBgField = document.getElementById('neccBgField');
const neccBgInput = document.getElementById('neccBgInput');

const teamInput = document.getElementById('teamInput');
const titleInput = document.getElementById('titleInput');
const subtitleInput = document.getElementById('subtitleInput');
const statusInput = document.getElementById('statusInput');
const nextInput = document.getElementById('nextInput');

const modeDuration = document.getElementById('modeDuration');
const modeAt = document.getElementById('modeAt');
const durationField = document.getElementById('durationField');
const atField = document.getElementById('atField');
const durationInput = document.getElementById('durationInput');
const atInput = document.getElementById('atInput');

const twitchInput = document.getElementById('twitchInput');
const twitterInput = document.getElementById('twitterInput');
const instagramInput = document.getElementById('instagramInput');
const youtubeInput = document.getElementById('youtubeInput');

const logoInput = document.getElementById('logoInput');
const browseLogoBtn = document.getElementById('browseLogoBtn');
const logoFile = document.getElementById('logoFile');
const clipInput = document.getElementById('clipInput');
const browseClipBtn = document.getElementById('browseClipBtn');
const clipFile = document.getElementById('clipFile');
const montageInput = document.getElementById('montageInput');
const layoutField = document.getElementById('layoutField');
const layoutInput = document.getElementById('layoutInput');

const neccUrlInput = document.getElementById('neccUrlInput');
const neccFetchBtn = document.getElementById('neccFetchBtn');
const neccStatus = document.getElementById('neccStatus');

const rosterEditEls = {
  A: {
    name: document.getElementById('editNameA'), tag: document.getElementById('editTagA'),
    logo: document.getElementById('editLogoA'), players: document.getElementById('editPlayersA'),
    add: document.getElementById('addPlayerA'),
  },
  B: {
    name: document.getElementById('editNameB'), tag: document.getElementById('editTagB'),
    logo: document.getElementById('editLogoB'), players: document.getElementById('editPlayersB'),
    add: document.getElementById('addPlayerB'),
  },
};

const pushBtn = document.getElementById('pushBtn');
const revertBtn = document.getElementById('revertBtn');
const stingerInput = document.getElementById('stingerInput');
const pushStatus = document.getElementById('pushStatus');
const connDot = document.getElementById('connDot');
const connText = document.getElementById('connText');

// Fallback text for an overlay that has none saved yet, plus the countdown
// each mode starts from. Only the keys a mode actually defines are applied, so
// a view with no countdown (Be Right Back) leaves the countdown alone instead
// of resetting it.
const MODE_DEFAULTS = {
  'starting-soon': { title: 'Stream Starting Soon', status: 'Starting Soon', durationSec: 600 },
  'post-match': { title: 'Thanks for Watching', status: 'Stream Ending Soon', durationSec: 120 },
  'brb': { title: 'Be Right Back', subtitle: 'Thanks for waiting' },
};

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
  const fallback = MODE_DEFAULTS[mode] || {};
  const t = saved || fallback;
  titleInput.value = t.title || '';
  subtitleInput.value = t.subtitle || '';
  statusInput.value = t.status || '';
}

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

// The two teams shown in the Rosters overlay. Fully editable by hand (type a
// name/tag, add/remove player rows) and also what a NECC fetch fills in. Each
// player is a plain { name, gamertag }.
function emptyRoster() { return { name: '', tag: '', color: '', colorAlt: '', logoUrl: '', players: [] }; }
let rosterA = emptyRoster();
let rosterB = emptyRoster();
function rosterFor(letter) { return letter === 'A' ? rosterA : rosterB; }
// Overlay asset URLs (bracket, matchPreview, etc.) resolved by the last
// successful import, keyed by NECC type - what the Overlay dropdown's NECC
// options actually point at when selected. Persisted to localStorage so the
// dropdown keeps working after an app restart without re-importing.
let lastImportedOverlayUrls = {};
const NECC_URLS_KEY = 'widener-necc-overlay-urls';

function toDatetimeLocalValue(isoString) {
  const d = new Date(isoString);
  if (isNaN(d)) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function updateUrlDisplay() {
  obsUrl.value = `${location.origin}/overlay`;
  const dockUrl = document.getElementById('dockUrl');
  if (dockUrl) dockUrl.value = `${location.origin}/control`;
}

function toggleLayoutVisibility() {
  layoutField.style.display = currentMode === 'post-match' ? '' : 'none';
  // The stripe-backdrop toggle only means anything while a NECC overlay is up.
  neccBgField.style.display = currentMode === 'necc' ? '' : 'none';
}

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
  return {
    name: team.name || '',
    tag: team.tag || '',
    color: team.color || '',
    colorAlt: team.colorAlt || '',
    logoUrl: team.logoUrl || '',
    players: (team.players || []).filter((p) => p.position >= 0).map((p) => ({ name: p.name || '', gamertag: p.gamertag || '' })),
  };
}

function buildPlayerRow(letter, player) {
  const team = rosterFor(letter);
  const row = document.createElement('div');
  row.className = 'ret-player';
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
  row.append(gt, rn, rm);
  return row;
}

function renderRosterEditor(letter) {
  const team = rosterFor(letter);
  const els = rosterEditEls[letter];
  els.name.value = team.name || '';
  els.tag.value = team.tag || '';
  if (team.logoUrl) { els.logo.src = team.logoUrl; els.logo.hidden = false; }
  else { els.logo.removeAttribute('src'); els.logo.hidden = true; }
  els.players.innerHTML = '';
  team.players.forEach((p) => els.players.appendChild(buildPlayerRow(letter, p)));
}

['A', 'B'].forEach((letter) => {
  const els = rosterEditEls[letter];
  els.name.addEventListener('input', () => { rosterFor(letter).name = els.name.value; pushDraft(); });
  els.tag.addEventListener('input', () => { rosterFor(letter).tag = els.tag.value; pushDraft(); });
  els.add.addEventListener('click', () => {
    const team = rosterFor(letter);
    team.players.push({ name: '', gamertag: '' });
    renderRosterEditor(letter);
    const rows = els.players.querySelectorAll('.ret-player');
    const last = rows[rows.length - 1];
    if (last) last.querySelector('.ret-gamertag').focus();
    pushDraft();
  });
});

function gatherForm() {
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
  currentMode = state.mode || 'starting-soon';
  currentNeccUrl = state.neccUrl || '';
  currentNeccType = state.neccType || '';
  if (currentMode === 'necc' && currentNeccType) {
    // Make sure the saved NECC type has an option to select, even if the
    // operator has since unchecked it in settings - the dropdown should
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
  toggleLayoutVisibility();
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
  applyingRemote = false;
}

function setConnStatus(connected) {
  connDot.classList.toggle('connected', connected);
  connText.textContent = connected ? 'Connected' : 'Reconnecting…';
}

let draftDebounce = null;
function pushDraft() {
  if (applyingRemote) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  clearTimeout(draftDebounce);
  draftDebounce = setTimeout(() => {
    ws.send(JSON.stringify({ type: 'update', channel: 'draft', data: gatherForm() }));
  }, 150);
}

// Immediate (undebounced) draft update - used for discrete actions like
// switching overlays, where the preview should react instantly.
function sendDraftNow() {
  if (applyingRemote) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  clearTimeout(draftDebounce);
  ws.send(JSON.stringify({ type: 'update', channel: 'draft', data: gatherForm() }));
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
    if (receivedInitialDraft) {
      ws.send(JSON.stringify({ type: 'update', channel: 'draft', data: gatherForm() }));
    }
  });
  ws.addEventListener('close', () => {
    setConnStatus(false);
    setTimeout(connect, 1500);
  });
  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      // Only sync the form from the server on first connect (restoring the
      // draft from last time) or right after asking for a revert. Otherwise
      // this panel is the only writer to "draft" - applying our own broadcast
      // echoes back onto the form would race live edits.
      if (msg.type === 'state' && msg.channel === 'draft' && (!receivedInitialDraft || repopulateOnNextDraft)) {
        receivedInitialDraft = true;
        repopulateOnNextDraft = false;
        populateForm(msg.data);
      }
      if (msg.type === 'dirty') setDirty(msg.dirty);
    } catch (e) {}
  });
}

// Whether Push Live plays the curtain stinger on the live overlay. Persisted
// locally - it's an operator preference, not overlay content.
const STINGER_KEY = 'widener-stinger-on-push';
stingerInput.checked = localStorage.getItem(STINGER_KEY) !== 'off';
stingerInput.addEventListener('change', () => {
  localStorage.setItem(STINGER_KEY, stingerInput.checked ? 'on' : 'off');
});

pushBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'update', channel: 'draft', data: gatherForm() }));
  // In scene-sync mode OBS owns the transition, so don't also flag the
  // in-overlay curtain wipe (it would double up / play in the preview only).
  const useStinger = stingerInput.checked && !obsSceneSyncActive;
  ws.send(JSON.stringify({ type: 'push', transition: useStinger ? 'stinger' : undefined }));
  lastPushedAt = new Date().toLocaleTimeString();
  pushStatus.textContent = `Pushed live at ${lastPushedAt}`;
});

revertBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  clearTimeout(draftDebounce);
  repopulateOnNextDraft = true;
  ws.send(JSON.stringify({ type: 'revert' }));
});

gameSelect.addEventListener('change', () => {
  const g = games.find((x) => x.id === gameSelect.value);
  if (g) teamInput.value = g.name;
  pushDraft();
});

copyUrlBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(obsUrl.value).then(() => {
    copyUrlBtn.textContent = 'Copied!';
    setTimeout(() => { copyUrlBtn.textContent = 'Copy'; }, 1500);
  });
});

[modeDuration, modeAt].forEach((el) => el.addEventListener('change', () => {
  durationField.style.display = modeDuration.checked ? '' : 'none';
  atField.style.display = modeAt.checked ? '' : 'none';
  pushDraft();
}));

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

// --- Overlay dropdown: switches which overlay the preview is showing -------
//
// Both Widener options (Starting Soon / Post-Match / Rosters) and NECC
// options (Bracket, Match Preview, etc) are ordinary draft edits: the preview
// pane updates instantly, the stream doesn't change until Push Live. Widener
// mode switches also auto-fill sensible title/status/countdown defaults into
// the form (still draft-only - push to send them out). NECC overlays render
// inside our own /overlay page as a full-bleed iframe, so OBS never needs to
// know anything changed either way.

overlaySelect.addEventListener('change', () => {
  const [kind, key] = overlaySelect.value.split(':');

  if (kind === 'widener') {
    // Keep the outgoing overlay's words before swapping in the new one's.
    stashViewText();
    currentMode = key;
    currentNeccType = '';
    currentNeccUrl = '';
    toggleLayoutVisibility();
    loadViewText(key);
    // The countdown is global, not per view, so it still resets to the mode's
    // starting point.
    const d = MODE_DEFAULTS[key];
    if (d && d.durationSec !== undefined) {
      durationInput.value = d.durationSec;
      modeDuration.checked = true; modeAt.checked = false;
      durationField.style.display = ''; atField.style.display = 'none';
    }
    sendDraftNow();
    return;
  }

  // kind === 'necc'
  const url = lastImportedOverlayUrls[key];
  if (!url) {
    neccStatus.textContent = 'Import a match first to get this overlay link';
    neccStatus.classList.add('error');
    overlaySelect.value = currentMode === 'necc' && currentNeccType ? `necc:${currentNeccType}` : `widener:${currentMode}`;
    return;
  }
  neccStatus.classList.remove('error');
  stashViewText();
  currentMode = 'necc';
  loadViewText('necc');
  currentNeccType = key;
  currentNeccUrl = url;
  toggleLayoutVisibility();
  sendDraftNow();
});

// --- NECC / LeagueOS import ---------------------------------------------

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

let enabledNeccTypes = new Set(DEFAULT_NECC_TYPES);

function loadNeccTypeSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(NECC_TYPES_KEY));
    if (Array.isArray(saved) && saved.length) enabledNeccTypes = new Set(saved);
  } catch (e) {}
  // Restore the overlay links from the last successful import, so the NECC
  // dropdown options keep working across app restarts without re-fetching.
  try {
    const savedUrls = JSON.parse(localStorage.getItem(NECC_URLS_KEY));
    if (savedUrls && typeof savedUrls === 'object') lastImportedOverlayUrls = savedUrls;
  } catch (e) {}
}
function saveNeccTypeSettings() {
  localStorage.setItem(NECC_TYPES_KEY, JSON.stringify(Array.from(enabledNeccTypes)));
}

const neccTypeList = document.getElementById('neccTypeList');
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
    lastImportedOverlayUrls = data.overlayUrls || {};
    localStorage.setItem(NECC_URLS_KEY, JSON.stringify(lastImportedOverlayUrls));

    renderRosterEditor('A');
    renderRosterEditor('B');

    // Auto-fill from the imported match. A fetch is an explicit "load this
    // match" action, so these overwrite whatever the previous match left
    // behind - only filling empty fields meant a second import kept showing
    // the old opponent in the subtitle.
    if (data.game) teamInput.value = data.game;
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

    const urlCount = Object.keys(lastImportedOverlayUrls).length;
    neccStatus.textContent = `Loaded ${data.game || 'match'}${data.eventName ? `, ${data.eventName}` : ''}${urlCount ? ` (${urlCount} overlay links ready)` : ' (no overlay links resolved, so bracket and preview switching are unavailable for this match)'}`;
    pushDraft();
  } catch (err) {
    neccStatus.textContent = err.message || 'Failed to import match';
    neccStatus.classList.add('error');
  } finally {
    neccFetchBtn.disabled = false;
  }
});

// --- Resizable preview column ----------------------------------------------

const colResizer = document.getElementById('colResizer');
const layoutEl = document.getElementById('layout');
const PREVIEW_WIDTH_KEY = 'widener-preview-width';
const PREVIEW_HEIGHT_KEY = 'widener-preview-height';
// Same breakpoint as the CSS media query that stacks the columns into rows -
// below it, the resizer drags height instead of width.
const stackedLayoutQuery = window.matchMedia('(max-width: 980px)');

function setPreviewWidth(px) {
  const clamped = Math.max(280, Math.min(900, px));
  layoutEl.style.setProperty('--preview-width', clamped + 'px');
  localStorage.setItem(PREVIEW_WIDTH_KEY, String(clamped));
}
function setPreviewHeight(px) {
  const clamped = Math.max(200, Math.min(700, px));
  layoutEl.style.setProperty('--preview-height', clamped + 'px');
  localStorage.setItem(PREVIEW_HEIGHT_KEY, String(clamped));
}
setPreviewWidth(parseInt(localStorage.getItem(PREVIEW_WIDTH_KEY) || '440', 10));
setPreviewHeight(parseInt(localStorage.getItem(PREVIEW_HEIGHT_KEY) || '340', 10));

let resizingCol = false;
colResizer.addEventListener('mousedown', (e) => {
  resizingCol = true;
  colResizer.classList.add('dragging');
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!resizingCol) return;
  if (stackedLayoutQuery.matches) {
    setPreviewHeight(window.innerHeight - e.clientY);
  } else {
    setPreviewWidth(window.innerWidth - e.clientX);
  }
});
window.addEventListener('mouseup', () => {
  if (!resizingCol) return;
  resizingCol = false;
  colResizer.classList.remove('dragging');
});

// --- Preview scaling: render the overlay at its real 1920x1080 and scale ---
// the whole thing down to fit, so proportions always match the real stream.
// The box's own pixel size is computed here (not CSS aspect-ratio+max-height,
// which doesn't reliably shrink width when height is the tighter constraint)
// so it's always exactly 16:9 regardless of which dimension is binding.

const previewFrameWrap = document.querySelector('.preview-frame-wrap');
const previewBox = document.getElementById('previewBox');
const previewScaler = document.getElementById('previewScaler');
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

// --- Init --------------------------------------------------------------

loadNeccTypeSettings();
renderNeccTypeList();
refreshNeccDropdownOptions();

fetch('/games.json')
  .then((r) => r.json())
  .then((data) => {
    games = data;
    gameSelect.innerHTML = '<option value="">Custom</option>' + games.map((g) => `<option value="${g.id}">${g.name}</option>`).join('');
    updateUrlDisplay();
    toggleLayoutVisibility();
    connect();
  });

// --- Info points -----------------------------------------------------------
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

// --- OBS dock URL copy + scene-sync ----------------------------------------
//
// All optional. The dock URL just mirrors how the Browser Source URL is
// surfaced. Scene-sync talks to the server's /api/obs/* routes, which own the
// single obs-websocket connection; the password is entered here, sent over
// localhost, and only ever held in the server's memory (plus this machine's
// localStorage as a convenience) - never committed, never logged.

const copyDockBtn = document.getElementById('copyDockBtn');
copyDockBtn.addEventListener('click', () => {
  const dockUrl = document.getElementById('dockUrl');
  navigator.clipboard.writeText(dockUrl.value).then(() => {
    copyDockBtn.textContent = 'Copied!';
    setTimeout(() => { copyDockBtn.textContent = 'Copy'; }, 1500);
  });
});

const obsHostInput = document.getElementById('obsHostInput');
const obsPortInput = document.getElementById('obsPortInput');
const obsPassInput = document.getElementById('obsPassInput');
const obsConnectBtn = document.getElementById('obsConnectBtn');
const obsDisconnectBtn = document.getElementById('obsDisconnectBtn');
const obsStatusEl = document.getElementById('obsStatus');
const obsSyncControls = document.getElementById('obsSyncControls');
const obsSyncEnable = document.getElementById('obsSyncEnable');
const obsTransitionSelect = document.getElementById('obsTransitionSelect');
const obsBuildBtn = document.getElementById('obsBuildBtn');
const obsBuildStatus = document.getElementById('obsBuildStatus');

const OBS_SETTINGS_KEY = 'widener-obs-settings';

function loadObsSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(OBS_SETTINGS_KEY)) || {};
    if (s.host) obsHostInput.value = s.host;
    if (s.port) obsPortInput.value = s.port;
    if (typeof s.password === 'string') obsPassInput.value = s.password;
    if (s.sceneSync) obsSyncEnable.checked = true;
    if (s.transitionName) obsTransitionSelect.dataset.saved = s.transitionName;
  } catch (e) {}
}
function saveObsSettings() {
  localStorage.setItem(OBS_SETTINGS_KEY, JSON.stringify({
    host: obsHostInput.value.trim(),
    port: parseInt(obsPortInput.value, 10) || 4455,
    // Convenience only, on this machine. Not committed, not logged.
    password: obsPassInput.value,
    sceneSync: obsSyncEnable.checked,
    transitionName: obsTransitionSelect.value || '',
  }));
}

function renderObsStatus(st) {
  const connected = !!(st && st.connected);
  obsConnectBtn.disabled = connected;
  obsDisconnectBtn.disabled = !connected;
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

  if (!st || !connected) {
    obsStatusEl.textContent = (st && st.error) ? `Not connected. ${st.error}` : 'Not connected';
    obsStatusEl.classList.toggle('error', !!(st && st.error));
    return;
  }
  obsStatusEl.classList.remove('error');
  const scene = st.currentScene ? ` · program scene: ${st.currentScene}` : '';
  obsStatusEl.textContent = `Connected${st.sceneSync ? ' · scene-sync ON' : ' · scene-sync off'}${scene}`;
}

function fillTransitions(list, selected) {
  const want = selected || obsTransitionSelect.value || obsTransitionSelect.dataset.saved || '';
  obsTransitionSelect.innerHTML = '<option value="">OBS default</option>' +
    (list || []).map((t) => `<option value="${t}">${t}</option>`).join('');
  if (want && (list || []).includes(want)) obsTransitionSelect.value = want;
}

async function obsInspect() {
  try {
    const st = await fetch('/api/obs/inspect').then((r) => r.json());
    renderObsStatus(st);
    if (st.connected && st.transitions) fillTransitions(st.transitions);
    return st;
  } catch (e) {
    renderObsStatus({ connected: false, error: 'server unreachable' });
    return null;
  }
}

obsConnectBtn.addEventListener('click', async () => {
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
      }),
    }).then((r) => r.json());
    renderObsStatus(st);
    await obsInspect();
  } catch (e) {
    renderObsStatus({ connected: false, error: 'connection failed' });
  } finally {
    obsConnectBtn.disabled = false;
  }
});

obsDisconnectBtn.addEventListener('click', async () => {
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

loadObsSettings();
obsInspect(); // reflect any connection that survived a panel reload
