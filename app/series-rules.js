// Manual companion rules. Example presets are versioned against the research
// document, never presented as verified NECC or LotE competition rules.
const modes = {
  bo7: ['Hardpoint', 'Search and Destroy', 'Overload'],
  legacy: ['Hardpoint', 'Search and Destroy', 'Control'],
  mw4: ['Hardpoint', 'Search and Destroy', 'Hijack'],
};
const codPresets = {
  bo7: { title: 'Black Ops 7', season: '2026 college example', modes: modes.bo7 },
  legacy: { title: 'Custom Control title', season: 'Organizer confirmation required', modes: modes.legacy },
  mw4: { title: 'Modern Warfare 4', season: '2027 announced example', modes: modes.mw4 },
  custom: { title: '', season: '', modes: ['Hardpoint', 'Search and Destroy', 'Custom'] },
};
const clean = (v, n = 160) => String(v || '').trim().slice(0, n);
const fail = (message) => { throw new Error(message); };
const tokens = (v) => clean(v, 300).split(',').map((t) => t.trim()).filter(Boolean);
const norm = (v) => String(v).trim().toLowerCase();
function defaults(game) {
  return { competition: { organizer: 'custom', version: '', season: '', url: '', verified: '' },
    ...(game === 'lol' ? { fearless: 'off' } : {}),
    ...(game === 'r6' ? { regulationRounds: 12, overtimeTarget: 8, overtimeCap: 3, overtimeWinBy: 2, overtimeSides: 'Swap each overtime round' } : {}),
    ...(game === 'cod' ? { preset: 'custom', title: '', season: '', customMode: '', customUnit: 'points', legalMaps: {} } : {}) };
}
function rules(s) {
  if (s.game === 'lol') return { name: 'League of Legends', style: 'league', unit: 'Game', modes: ["Summoner's Rift"], rotation: ["Summoner's Rift"], tiebreaker: "Summoner's Rift" };
  if (s.game === 'r6') return { name: 'Rainbow Six Siege', style: 'siege', unit: 'Map', modes: ['Bomb'], rotation: ['Bomb'], tiebreaker: 'Bomb' };
  if (s.game === 'cod') {
    const c = s.config || defaults('cod'), list = codPresets[c.preset]?.modes || codPresets.custom.modes;
    const available = [...list.filter((m) => m !== 'Custom'), ...(c.customMode ? [c.customMode] : [])];
    const rotation = [list[0], list[1], list[2] === 'Custom' ? c.customMode : list[2], list[0], list[1]];
    return { name: 'Call of Duty', style: 'cod', unit: 'Map', modes: available, rotation, tiebreaker: '', presets: codPresets };
  }
  return null;
}
function configure(s, c) {
  const cfg = s.config;
  if (c.competition) {
    const p = c.competition;
    if (!['custom', 'necc', 'lote'].includes(p.organizer)) fail('Unknown competition organizer.');
    if (p.url && !/^https?:\/\//i.test(p.url)) fail('Use an HTTP(S) rulebook URL.');
    cfg.competition = { organizer: p.organizer, version: clean(p.version), season: clean(p.season), url: clean(p.url, 500), verified: clean(p.verified, 10) };
  }
  const played = s.maps.some((m) => m.status !== 'ready');
  const settings = s.game === 'lol' ? ['fearless'] : s.game === 'r6' ? ['regulationRounds', 'overtimeTarget', 'overtimeCap', 'overtimeWinBy', 'overtimeSides'] : s.game === 'cod' ? ['preset', 'title', 'season', 'customMode', 'customUnit', 'legalMaps'] : [];
  if (played && settings.some((k) => c[k] !== undefined && JSON.stringify(c[k]) !== JSON.stringify(cfg[k]))) fail('Set competition rules before play. Start a new series to change them.');
  if (s.game === 'lol' && c.fearless !== undefined) {
    if (!['off', 'team', 'global'].includes(c.fearless)) fail('Unknown Fearless scope.');
    cfg.fearless = c.fearless;
  }
  if (s.game === 'r6') {
    for (const [k, min, max] of [['regulationRounds', 2, 30], ['overtimeTarget', 2, 99], ['overtimeCap', 0, 99], ['overtimeWinBy', 1, 10]]) if (c[k] !== undefined) {
      if (!Number.isInteger(Number(c[k])) || Number(c[k]) < min || Number(c[k]) > max) fail('Invalid Siege ' + k + '.');
      cfg[k] = Number(c[k]);
    }
    if (cfg.regulationRounds % 2 || cfg.overtimeTarget <= cfg.regulationRounds / 2 + 1 || (cfg.overtimeCap && cfg.overtimeCap % 2 === 0)) fail('Siege needs even regulation rounds, a higher overtime target and an odd overtime cap (0 means unlimited).');
    if (c.overtimeSides !== undefined) cfg.overtimeSides = clean(c.overtimeSides);
  }
  if (s.game === 'cod') {
    const previousCustomMode = cfg.customMode;
    const changed = c.preset !== undefined && c.preset !== cfg.preset;
    if (c.preset !== undefined) {
      if (!codPresets[c.preset]) fail('Unknown Call of Duty preset.');
      cfg.preset = c.preset;
      if (changed) { Object.assign(cfg, { title: codPresets[c.preset].title, season: codPresets[c.preset].season, legalMaps: {} }); }
    }
    for (const k of ['title', 'season', 'customMode', 'customUnit']) if (c[k] !== undefined) cfg[k] = clean(c[k], 80);
    if (c.legalMaps !== undefined) {
      if (!c.legalMaps || typeof c.legalMaps !== 'object' || Array.isArray(c.legalMaps)) fail('Enter legal maps by mode.');
      cfg.legalMaps = Object.fromEntries(Object.entries(c.legalMaps).slice(0, 15).map(([k, v]) => [clean(k, 80), tokens(v).join(', ')]));
    }
    if (changed || cfg.customMode !== previousCustomMode) {
      const r = rules(s);
      for (const m of s.maps) if (m.status === 'ready') m.mode = m.slot <= s.bestOf ? r.rotation[(m.slot - 1) % r.rotation.length] : '';
    }
  }
}
function exclusions(s, team, before = s.current) {
  if (s.config?.fearless === 'off') return [];
  return [...new Set(s.maps.slice(0, before).filter((m) => m.status === 'final' && m.result?.type === 'played').flatMap((m) =>
    (s.config.fearless === 'global' ? ['A', 'B'] : [team]).flatMap((t) => tokens(m['picks' + t]))))];
}
function editMap(s, m, c) {
  for (const k of ['picker', 'sideChooser']) if (c[k] !== undefined) {
    if (!['', 'A', 'B'].includes(c[k])) fail('Invalid map picker or side chooser.');
    m[k] = c[k];
  }
  if (s.game === 'lol') {
    if (['picksA', 'picksB', 'draftBansA', 'draftBansB'].some((k) => c[k] !== undefined && c[k] !== m[k])) m.draftConfirmed = false;
    if (c.blueTeam !== undefined) {
      if (!['', 'A', 'B'].includes(c.blueTeam)) fail('Invalid blue side assignment.');
      m.blueTeam = c.blueTeam;
    }
    for (const k of ['picksA', 'picksB', 'draftBansA', 'draftBansB']) if (c[k] !== undefined) m[k] = clean(c[k], 300);
    if (c.draftConfirmed !== undefined) m.draftConfirmed = c.draftConfirmed === true;
  }
  if (s.game === 'r6') for (const t of ['A', 'B']) if (c['ban' + t] !== undefined) m['ban' + t] = clean(c['ban' + t]);
  if (s.game === 'cod' && c.pool !== undefined) s.config.legalMaps[m.mode] = tokens(c.pool).join(', ');
}
function validateStart(s, m) {
  if (s.game === 'lol') {
    if (!['A', 'B'].includes(m.blueTeam)) fail('Assign blue and red sides for this game first.');
    const picks = [...tokens(m.picksA), ...tokens(m.picksB)], bans = [...tokens(m.draftBansA), ...tokens(m.draftBansB)];
    if (picks.length && !m.draftConfirmed) fail('Confirm final champion trades before starting.');
    if (new Set(picks.map(norm)).size !== picks.length || picks.some((p) => bans.map(norm).includes(norm(p)))) fail('A champion cannot be picked twice or both picked and banned.');
    for (const t of ['A', 'B']) {
      const used = exclusions(s, t).map(norm);
      if (tokens(m['picks' + t]).some((p) => used.includes(norm(p)))) fail('A picked champion is excluded by the selected Fearless scope.');
    }
  }
  if (s.game === 'cod') {
    if (!s.config.title || !s.config.season) fail('Enter the Call of Duty title and season before starting.');
    if (!rules(s).modes.includes(m.mode)) fail('Select the organizer-approved mode before starting this map.');
    const pool = tokens(s.config.legalMaps[m.mode]);
    if (pool.length && !pool.map(norm).includes(norm(m.name))) fail('Select a map from the confirmed legal pool for this mode.');
  }
}
function validateResult(s, m, result) {
  if (s.game === 'lol' && result.scoreA != null) fail('League results record games won, not kills. Leave gameplay scores blank.');
  if (['r6', 'cod'].includes(s.game) && result.type === 'played' && result.scoreA != null && (m.continuations || []).some((c) => result.scoreA < c.scoreA || result.scoreB < c.scoreB)) fail('Final scores cannot discard retained continuation scores.');
  if (s.game !== 'r6' || result.type !== 'played' || result.scoreA == null) return;
  const c = s.config, hi = Math.max(result.scoreA, result.scoreB), lo = Math.min(result.scoreA, result.scoreB), half = c.regulationRounds / 2;
  if (hi === half + 1 && lo < half) return;
  const ot = hi + lo - c.regulationRounds;
  const finish = (a, b) => (Math.max(a, b) >= c.overtimeTarget && Math.abs(a - b) >= c.overtimeWinBy) || (c.overtimeCap > 0 && a + b - c.regulationRounds === c.overtimeCap && a !== b);
  if (lo < half || ot <= 0 || (c.overtimeCap && ot > c.overtimeCap) || !finish(hi, lo) || finish(hi - 1, lo)) fail('Final rounds do not complete a map under the selected Siege regulation/overtime rules.');
}
module.exports = { defaults, rules, configure, editMap, validateStart, validateResult, exclusions };
