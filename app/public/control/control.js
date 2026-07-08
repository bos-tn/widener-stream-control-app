const obsUrl = document.getElementById('obsUrl');
const copyUrlBtn = document.getElementById('copyUrlBtn');

const gameSelect = document.getElementById('gameSelect');
const overlaySelect = document.getElementById('overlaySelect');
const neccOptGroup = document.getElementById('neccOptGroup');

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
const neccTeams = document.getElementById('neccTeams');

const pushBtn = document.getElementById('pushBtn');
const revertBtn = document.getElementById('revertBtn');
const stingerInput = document.getElementById('stingerInput');
const pushStatus = document.getElementById('pushStatus');
const connDot = document.getElementById('connDot');
const connText = document.getElementById('connText');

const MODE_DEFAULTS = {
  'starting-soon': { title: 'Stream Starting Soon', status: 'Starting Soon', durationSec: 600 },
  'post-match': { title: 'Thanks for Watching', status: 'Stream Ending Soon', durationSec: 120 },
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

// The two teams built from a NECC import - each player has {id, name, gamertag,
// active, position, selected}. "selected" (which players are actually playing)
// is what the operator toggles via the roster chips.
let neccTeamA = null;
let neccTeamB = null;
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
}

function toggleLayoutVisibility() {
  layoutField.style.display = currentMode === 'post-match' ? '' : 'none';
}

function teamPayload(team) {
  if (!team) return null;
  return {
    name: team.name || '',
    tag: team.tag || '',
    color: team.color || '',
    colorAlt: team.colorAlt || '',
    logoUrl: team.logoUrl || '',
    players: (team.players || []).filter((p) => p.selected).map((p) => ({ name: p.name, gamertag: p.gamertag })),
  };
}

function gatherForm() {
  const data = {
    mode: currentMode,
    neccUrl: currentNeccUrl,
    neccType: currentNeccType,
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
  };
  if (modeAt.checked && atInput.value) {
    data.countdownMode = 'at';
    data.end = new Date(atInput.value).toISOString();
  } else {
    data.countdownMode = 'duration';
    data.durationSec = parseInt(durationInput.value || '0', 10);
  }
  if (neccTeamA) data.teamA = teamPayload(neccTeamA);
  if (neccTeamB) data.teamB = teamPayload(neccTeamB);
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
  teamInput.value = state.team || '';
  titleInput.value = state.title || '';
  subtitleInput.value = state.subtitle || '';
  statusInput.value = state.status || '';
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
  ws.send(JSON.stringify({ type: 'push', transition: stingerInput.checked ? 'stinger' : undefined }));
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
    currentMode = key;
    currentNeccType = '';
    currentNeccUrl = '';
    toggleLayoutVisibility();
    const d = MODE_DEFAULTS[key];
    if (d) {
      titleInput.value = d.title;
      statusInput.value = d.status;
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
  currentMode = 'necc';
  currentNeccType = key;
  currentNeccUrl = url;
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

function renderRosterPicker(container, team) {
  container.innerHTML = '';
  team.players.forEach((p) => {
    const chip = document.createElement('div');
    chip.className = 'roster-chip' + (p.selected ? ' selected' : '');
    chip.innerHTML = '<span class="rc-tag"></span><span class="rc-name"></span>';
    chip.querySelector('.rc-tag').textContent = p.gamertag || p.name;
    if (p.name && p.gamertag && p.name !== p.gamertag) chip.querySelector('.rc-name').textContent = p.name;
    chip.addEventListener('click', () => {
      p.selected = !p.selected;
      chip.classList.toggle('selected', p.selected);
      pushDraft();
    });
    container.appendChild(chip);
  });
}

function renderNeccTeam(letter, team) {
  document.getElementById(`neccLogo${letter}`).src = team.logoUrl || '';
  document.getElementById(`neccName${letter}`).textContent = team.name || '';
  document.getElementById(`neccTag${letter}`).textContent = team.tag || '';
  renderRosterPicker(document.getElementById(`neccRoster${letter}`), team);
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

    neccTeamA = { ...data.teams[0], players: (data.teams[0]?.players || []).map((p) => ({ ...p, selected: p.position >= 0 })) };
    neccTeamB = { ...data.teams[1], players: (data.teams[1]?.players || []).map((p) => ({ ...p, selected: p.position >= 0 })) };
    lastImportedOverlayUrls = data.overlayUrls || {};
    localStorage.setItem(NECC_URLS_KEY, JSON.stringify(lastImportedOverlayUrls));

    neccTeams.hidden = false;
    renderNeccTeam('A', neccTeamA);
    renderNeccTeam('B', neccTeamB);

    // Convenience auto-fill - only touches fields that are currently empty.
    if (data.game && !teamInput.value) teamInput.value = data.game;
    const widener = data.teams.find((t) => /widener/i.test(t.org || t.name || ''));
    const opponent = data.teams.find((t) => t !== widener) || data.teams[1];
    if (opponent && !subtitleInput.value) subtitleInput.value = `vs ${opponent.name}`;
    if (data.scheduledAt && !atInput.value) {
      modeAt.checked = true;
      modeDuration.checked = false;
      durationField.style.display = 'none';
      atField.style.display = '';
      atInput.value = toDatetimeLocalValue(data.scheduledAt);
    }

    const urlCount = Object.keys(lastImportedOverlayUrls).length;
    neccStatus.textContent = `Loaded ${data.game || 'match'}${data.eventName ? ` — ${data.eventName}` : ''}${urlCount ? ` (${urlCount} overlay links ready)` : ' (no overlay links resolved - bracket/preview switching unavailable for this match)'}`;
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
    gameSelect.innerHTML = '<option value="">— custom —</option>' + games.map((g) => `<option value="${g.id}">${g.name}</option>`).join('');
    updateUrlDisplay();
    toggleLayoutVisibility();
    connect();
  });
