// Server-owned series records. Game renderers consume these; only commands
// carrying the current record ID and revision may change them.
const { randomUUID } = require('crypto');
const adapters = require('./series-rules');
const clone = (v) => JSON.parse(JSON.stringify(v));
const other = (team) => team === 'A' ? 'B' : 'A';
const fail = (message) => { throw new Error(message); };
const text = (value, max = 80) => String(value || '').trim().slice(0, max);
function integer(value, min, max, label) {
  if (value === '' || typeof value === 'boolean' || !Number.isInteger(Number(value)) || Number(value) < min || Number(value) > max) fail(`Invalid ${label}.`);
  return Number(value);
}
function bestOf(value) {
  const n = integer(value, 1, 9, 'series length');
  if (n % 2 !== 1) fail('Series length must be 1, 3, 5, 7 or 9.');
  return n;
}
function gameRules(game, config) {
  const adapter = adapters.rules({ game, config });
  if (adapter) return adapter;
  if (game === 'ow') return { name: 'Overwatch', style: 'overwatch', modes: ['Control', 'Hybrid', 'Push', 'Flashpoint', 'Escort'],
    rotation: ['Control', 'Hybrid', 'Push', 'Flashpoint', 'Escort'], tiebreaker: 'Control' };
  if (game === 'val') return { name: 'VALORANT', style: 'valorant', modes: ['Standard'], rotation: ['Standard'], tiebreaker: 'Standard' };
  if (game === 'mr') return { name: 'Marvel Rivals', style: 'rivals', modes: ['Domination', 'Convoy', 'Convergence'],
    rotation: ['Domination', 'Convoy', 'Convergence', 'Domination', 'Convoy'], tiebreaker: '' };
  return null;
}
function scheduledMap(series, slot) {
  const rules = gameRules(series.game, series.config);
  return makeMap(slot, 1, '', slot <= series.bestOf ? rules.rotation[(slot - 1) % rules.rotation.length] : series.tiebreakerMode || rules.tiebreaker);
}
function makeMap(slot, attempt = 1, name = '', mode = 'Standard') {
  return { id: randomUUID(), slot, attempt, name: text(name), mode: text(mode, 80), status: 'ready', result: null };
}
function scores(series) {
  const out = { A: series.openingWins.A, B: series.openingWins.B };
  for (const map of series.maps) if (map.status === 'final' && ['A', 'B'].includes(map.result?.winner)) out[map.result.winner]++;
  return out;
}
function decided(series) {
  const s = scores(series);
  return s.A >= series.winsRequired || s.B >= series.winsRequired;
}
function createSeries(game = 'val', length, openingWins = {}) {
  const n = bestOf(length ?? (['ow', 'mr', 'cod'].includes(game) ? 5 : 3));
  const opening = (v) => Number.isInteger(Number(v)) ? Math.max(0, Math.min(99, Number(v))) : 0;
  const s = { version: 1, id: randomUUID(), game, revision: 0, bestOf: n, winsRequired: Math.ceil(n / 2),
    openingWins: { A: opening(openingWins.A), B: opening(openingWins.B) },
    leftTeam: 'A', attackingTeam: ['ow', 'mr', 'lol', 'cod'].includes(game) ? '' : 'A', visible: true, showHistory: false, offsetX: 0, offsetY: 0, scale: 1,
    config: adapters.defaults(game),
    tiebreakerMode: gameRules(game)?.tiebreaker ?? 'Standard', maps: [], current: 0, needsReview: false };
  s.maps = Array.from({ length: n }, (_, i) => scheduledMap(s, i + 1));
  return s;
}
function restoreSeries(raw, game, length, openingWins) {
  let safeLength = ['ow', 'mr', 'cod'].includes(game) ? 5 : 3;
  try { safeLength = bestOf(length); } catch { /* migrate an unsupported old format conservatively */ }
  const fallback = () => createSeries(game, safeLength, openingWins);
  if (!raw || raw.version !== 1 || raw.game !== game || !Array.isArray(raw.maps) || !raw.maps.length || raw.maps.length > 100 || !raw.id) return fallback();
  const s = clone(raw);
  s.config = { ...adapters.defaults(game), ...s.config };
  // A restarted app must not claim that an old live map or pause is current.
  const map = s.maps[s.current];
  try { bestOf(s.bestOf); } catch { return fallback(); }
  if (!map || !Number.isInteger(s.revision) || s.revision < 0 || !s.openingWins || s.winsRequired !== Math.ceil(s.bestOf / 2)
      || !['A', 'B'].includes(s.leftTeam) || !['A', 'B', ''].includes(s.attackingTeam)
      || !['A', 'B'].every((t) => Number.isInteger(s.openingWins[t]) && s.openingWins[t] >= 0)
      || !s.maps.every((m) => m && typeof m.id === 'string' && Number.isInteger(m.slot) && m.slot > 0 && Number.isInteger(m.attempt) && m.attempt > 0
        && ['ready', 'playing', 'paused', 'awaiting-result', 'final', 'void'].includes(m.status)
        && (m.status !== 'final' || (m.result && ['A', 'B', null].includes(m.result.winner))))) return fallback();
  if (['playing', 'paused', 'awaiting-result'].includes(map.status)) {
    s.needsReview = true;
    s.revision++;
  }
  return s;
}
function validateTimeline(s) {
  const wins = { ...s.openingWins };
  for (const map of s.maps) {
    if ((wins.A >= s.winsRequired || wins.B >= s.winsRequired) && ['playing', 'paused', 'awaiting-result', 'final'].includes(map.status)) {
      fail('That correction conflicts with later play. Void the later attempt first.');
    }
    if (map.status === 'final' && map.result.winner) wins[map.result.winner]++;
  }
}
function resultFrom(command, series, map) {
  const type = command.resultType || 'played';
  if (!['played', 'draw', 'forfeit', 'admin'].includes(type)) fail('Unknown result type.');
  const winner = type === 'draw' ? null : command.winner;
  if (type !== 'draw' && !['A', 'B'].includes(winner)) fail('Select the winning team.');
  const hasA = command.scoreA !== '' && command.scoreA != null;
  const hasB = command.scoreB !== '' && command.scoreB != null;
  const ow = series.game === 'ow', mr = series.game === 'mr';
  const payload = (ow && ['Hybrid', 'Escort'].includes(map.mode)) || (mr && ['Convoy', 'Convergence'].includes(map.mode));
  if (hasA !== hasB) fail('Enter both final scores or leave both blank.');
  if (payload && hasA) fail('Use the payload progress/time fields for this mode.');
  const number = (v) => {
    if (ow && map.mode === 'Push') {
      const n = Number(v);
      if (typeof v === 'boolean' || !Number.isFinite(n) || n < 0 || n > 9999 || Math.abs(n * 100 - Math.round(n * 100)) > .000001) fail('Invalid Push distance (up to two decimal places).');
      return n;
    }
    return integer(v, 0, mr ? 2 : ow ? (map.mode === 'Control' ? 2 : 3) : 999, 'final score');
  };
  const a = hasA ? number(command.scoreA) : null, b = hasB ? number(command.scoreB) : null;
  if (type === 'played' && hasA && (winner === 'A' ? a <= b : b <= a)) fail('The final score must agree with the winner.');
  if (type === 'played' && hasA && ow && ['Control', 'Flashpoint'].includes(map.mode) && Math.max(a, b) !== (map.mode === 'Control' ? 2 : 3)) fail('Enter a completed map score, not an individual objective or subround.');
  if (type === 'played' && hasA && mr && map.mode === 'Domination' && Math.max(a, b) !== 2) fail('Enter a completed Domination map score, not one subround.');
  if (type === 'draw' && hasA && a !== b) fail('A drawn map must have equal final scores.');
  const result = { type, winner, scoreA: a, scoreB: b, note: text(command.note, 160),
    ...(ow || mr ? { mode: map.mode, detailA: payload ? text(command.detailA, 80) : '', detailB: payload ? text(command.detailB, 80) : '' } : {}) };
  if (series.game === 'cod') Object.assign(result, { mode: map.mode, unit: map.mode === 'Search and Destroy' || map.mode === 'Control' ? 'rounds' : map.mode === 'Hardpoint' ? 'points' : series.config.customMode === map.mode ? series.config.customUnit : 'objective', detailA: text(command.detailA, 80), detailB: text(command.detailB, 80) });
  adapters.validateResult(series, map, result);
  return result;
}
function changeSeries(have, command) {
  if (!command || command.seriesId !== have.id || command.revision !== have.revision) fail('This series changed in another panel. Review the latest state and try again.');
  const s = clone(have);
  const map = s.maps[s.current];
  const locked = () => { if (s.needsReview) fail('Review and resume the restored series first.'); };
  const live = () => { locked(); if (map.status !== 'playing') fail('Start or resume this map first.'); };
  const action = command.action;
  const rememberSides = () => {
    map.sides = { leftTeam: s.leftTeam, attackingTeam: s.attackingTeam, phase: text(command.phase || map.sides?.phase, 80) };
    map.sideHistory = [...(map.sideHistory || []), { ...map.sides, at: new Date().toISOString() }].slice(-100);
  };
  switch (action) {
    case 'load-setup': {
      locked();
      if (s.maps.some((m) => m.status !== 'ready') || scores(s).A || scores(s).B) fail('Start a fresh series before loading saved setup.');
      const setup = command.setup;
      if (!setup || setup.game !== s.game || !Array.isArray(setup.maps)) fail('Saved setup belongs to another game.');
      adapters.configure(s, setup.config || {});
      for (const m of s.maps) {
        const saved = setup.maps.find((x) => x.slot === m.slot);
        if (!saved) continue;
        m.name = text(saved.name);
        if (saved.mode && !gameRules(s.game, s.config).modes.includes(saved.mode)) fail('Saved setup has an unsupported mode.');
        if (saved.mode) m.mode = text(saved.mode, 80);
        adapters.editMap(s, m, { picker: saved.picker || '', sideChooser: saved.sideChooser || '', ...(s.game === 'lol' ? { blueTeam: saved.blueTeam || '' } : {}) });
      }
      break;
    }
    case 'review': s.needsReview = false; if (['playing', 'paused'].includes(map.status)) { map.status = 'ready'; delete map.pause; } break;
    case 'configure': {
      const n = bestOf(command.bestOf);
      const wins = scores(s), need = Math.ceil(n / 2);
      if (wins.A > need || wins.B > need || (wins.A >= need && wins.B >= need)) fail('That format conflicts with recorded wins. Correct results first.');
      s.bestOf = n; s.winsRequired = need;
      adapters.configure(s, command);
      if (s.game === 'ow' && command.tiebreakerMode !== undefined) {
        if (!gameRules('ow').modes.includes(command.tiebreakerMode)) fail('Unknown Overwatch mode.');
        s.tiebreakerMode = command.tiebreakerMode;
      }
      validateTimeline(s);
      while (Math.max(...s.maps.map((m) => m.slot)) < n) s.maps.push(scheduledMap(s, Math.max(...s.maps.map((m) => m.slot)) + 1));
      break;
    }
    case 'map': {
      const target = s.maps.find((m) => m.id === command.mapId);
      if (!target || target.status !== 'ready') fail('Only a pending map can be edited.');
      if (command.name !== undefined) target.name = text(command.name);
      if (command.mode !== undefined) {
        if (!gameRules(s.game, s.config).modes.includes(command.mode)) fail(`Unknown ${gameRules(s.game).name} mode.`);
        target.mode = text(command.mode, 80);
      }
      if (s.game === 'ow') for (const t of ['A', 'B']) if (command['ban' + t] !== undefined) target['ban' + t] = text(command['ban' + t], 60);
      if (s.game === 'mr') {
        // Separate comma-delimited labels; no hero catalog or draft order is implied.
        for (const key of ['banA', 'banB', 'lockA', 'lockB']) if (command[key] !== undefined) target[key] = text(command[key], 180);
        const heroes = (value) => String(value || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
        const locks = [...heroes(target.lockA), ...heroes(target.lockB)];
        if ([...heroes(target.banA), ...heroes(target.banB)].some((hero) => locks.includes(hero))) fail('A locked hero cannot also be banned. Correct the draft labels first.');
      }
      adapters.editMap(s, target, command);
      break;
    }
    case 'sides':
      if (!['A', 'B'].includes(command.leftTeam) || !['A', 'B', ''].includes(command.attackingTeam)) fail('Invalid HUD side assignment.');
      s.leftTeam = command.leftTeam; s.attackingTeam = command.attackingTeam;
      rememberSides(); break;
    case 'swap': s.leftTeam = other(s.leftTeam); rememberSides(); break;
    case 'roles': s.attackingTeam = s.attackingTeam ? other(s.attackingTeam) : 'A'; rememberSides(); break;
    case 'presentation':
      if (typeof command.visible === 'boolean') s.visible = command.visible;
      if (typeof command.showHistory === 'boolean') s.showHistory = command.showHistory;
      if (command.offsetX !== undefined) s.offsetX = integer(command.offsetX, 0, 800, 'horizontal inset');
      if (command.offsetY !== undefined) s.offsetY = integer(command.offsetY, 0, 500, 'vertical inset');
      if (command.scale !== undefined) {
        const scale = Number(command.scale);
        if (!Number.isFinite(scale) || scale < .75 || scale > 1.5) fail('Scale must be between 0.75 and 1.5.');
        s.scale = scale;
      }
      break;
    case 'start':
      locked();
      if (decided(s)) fail('The series is final. Correct a result or start a new series.');
      if (map.status !== 'ready') fail('This map has already started.');
      if (s.game === 'mr' && !gameRules('mr').modes.includes(map.mode)) fail('Select the organizer-approved mode before starting this extra map.');
      adapters.validateStart(s, map);
      rememberSides();
      s.showHistory = false;
      map.status = 'playing'; map.startedAt = new Date().toISOString(); break;
    case 'pause':
      live();
      if (!['technical', 'tactical'].includes(command.kind)) fail('Choose technical or tactical pause.');
      map.status = 'paused'; map.pause = { kind: command.kind, team: ['A', 'B'].includes(command.team) ? command.team : '' }; break;
    case 'resume': locked(); if (map.status !== 'paused') fail('This map is not paused.'); map.status = 'playing'; delete map.pause; break;
    case 'await-result': live(); map.status = 'awaiting-result'; break;
    case 'finish':
      locked();
      if (decided(s)) fail('The series is already final. Correct or void a result first.');
      if (command.mapId && command.mapId !== map.id) fail('The current map changed. Review its result first.');
      if (!['playing', 'paused', 'awaiting-result'].includes(map.status) && !(map.status === 'ready' && ['forfeit', 'admin'].includes(command.resultType))) fail('This map cannot be finished again.');
      map.result = resultFrom(command, s, map); map.status = 'final'; delete map.pause; map.finishedAt = new Date().toISOString(); break;
    case 'edit-result': {
      locked();
      const target = s.maps.find((m) => m.id === command.mapId);
      if (!target || target.status !== 'final') fail('Choose a completed map to correct.');
      target.result = resultFrom(command, s, target);
      const wins = scores(s);
      if (wins.A > s.winsRequired || wins.B > s.winsRequired || (wins.A >= s.winsRequired && wins.B >= s.winsRequired)) fail('That correction conflicts with other results. Void a later result first.');
      validateTimeline(s);
      break;
    }
    case 'rehost':
      locked();
      if (!['r6', 'cod'].includes(s.game) || !['playing', 'paused', 'awaiting-result'].includes(map.status)) fail('Rehost requires a live Siege or Call of Duty map.');
      if (!text(command.note, 160)) fail('Record the admin continuation instruction.');
      { const a = integer(command.scoreA, 0, 999, 'retained score'), b = integer(command.scoreB, 0, 999, 'retained score');
        map.continuations = [...(map.continuations || []), { scoreA: a, scoreB: b, note: text(command.note, 160), at: new Date().toISOString(), sides: { leftTeam: s.leftTeam, attackingTeam: s.attackingTeam } }];
        map.status = 'paused'; map.pause = { kind: 'technical', team: '' }; }
      break;
    case 'void':
    case 'remake': {
      locked();
      const target = s.maps.find((m) => m.id === (command.mapId || map.id));
      if (!target || target.status === 'void') fail('That attempt is already void or missing.');
      if (action === 'remake' && target.id !== map.id) fail('Only the current map can be remade.');
      target.status = 'void'; target.voidReason = text(command.note, 160); delete target.pause;
      if (action === 'remake') {
        if (s.maps.length >= 100) fail('This record is full. Start a new series.');
        const replacement = makeMap(target.slot, target.attempt + 1, target.name, target.mode);
        if (s.game === 'lol' && command.carryDraft === true) for (const k of ['picksA', 'picksB', 'draftBansA', 'draftBansB']) replacement[k] = target[k] || '';
        // Hero bans are confirmed anew for a remake; the void attempt keeps its record.
        s.maps.splice(s.current + 1, 0, replacement); s.current++;
        s.attackingTeam = '';
      }
      break;
    }
    case 'next':
      locked();
      if (decided(s)) fail('The series is final. No next map is needed.');
      if (!['final', 'void'].includes(map.status)) fail('Finish or void the current map first.');
      if (s.current + 1 < s.maps.length) s.current++;
      else {
        if (s.maps.length >= 100) fail('This record is full. Start a new series.');
        s.maps.push(scheduledMap(s, Math.max(...s.maps.map((m) => m.slot)) + 1)); s.current++;
      }
      s.attackingTeam = '';
      break;
    case 'reset': return { ...createSeries(s.game, s.bestOf), revision: s.revision + 1 };
    default: fail('Unknown series action.');
  }
  s.revision++;
  return s;
}
module.exports = { createSeries, restoreSeries, changeSeries, scores, decided, gameRules };
