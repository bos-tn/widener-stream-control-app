// Game-specific manual setup. No field here claims authority over the game HUD.
(() => {
  const root = document.getElementById('seriesControls');
  const el = (id) => document.getElementById(id);
  const field = (id, label, type = 'text', extra = '') => `<label class="grow"><span class="lbl">${label}</span><input id="${id}" type="${type}" ${extra}></label>`;
  const choose = (id, label, options) => `<label class="grow"><span class="lbl">${label}</span><select id="${id}">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>`;
  const teams = [['', 'Not set'], ['A', 'Team A'], ['B', 'Team B']];
  const setup = document.createElement('div');
  setup.innerHTML = `
    <details id="seriesCompetition"><summary>Competition rules and source</summary><p class="muted-note">NECC and LotE are organizer labels. Enter the actual rulebook version and season; example settings are not verified organizer presets.</p><div class="field-row">${choose('seriesOrganizer', 'Organizer', [['custom', 'Custom'], ['necc', 'NECC'], ['lote', 'LotE']])}${field('seriesRuleSeason', 'Competition season')}${field('seriesRuleVersion', 'Rulebook version')}</div><div class="field-row">${field('seriesRuleUrl', 'Rulebook URL', 'url', 'maxlength="500"')}${field('seriesRuleDate', 'Verified date', 'date')}</div><button type="button" class="btn-secondary" id="seriesSaveCompetition">Save competition source</button></details>
    <details id="seriesCodSetup" hidden><summary>Call of Duty title and season</summary><p class="muted-note">Choose a research example or a custom title. Verify the rotation and legal map pool with your organizer. BO7 slots remain editable; no grand-final rotation is assumed.</p><div class="field-row">${choose('seriesCodPreset', 'Title preset', [['custom', 'Custom title / season'], ['bo7', 'Black Ops 7 college example'], ['legacy', 'Custom title with Control'], ['mw4', 'Modern Warfare 4 announced example']])}${field('seriesTitle', 'Game title', 'text', 'maxlength="80"')}${field('seriesSeason', 'Title season', 'text', 'maxlength="80"')}</div><div class="field-row">${field('seriesCustomMode', 'Additional / custom mode', 'text', 'maxlength="80"')}${field('seriesCustomUnit', 'Custom mode result unit', 'text', 'maxlength="80"')}</div><button type="button" class="btn-secondary" id="seriesSaveCod">Apply title and season</button></details>
    <details id="seriesSiegeSetup" hidden><summary>Siege regulation and overtime</summary><p class="muted-note">Research example: 12 regulation rounds, overtime target 8, cap 3 rounds. A capped overtime can finish 8–7. Set cap 0 for unlimited overtime. Verify against the event rulebook before starting.</p><div class="field-row">${field('seriesRegulation', 'Regulation rounds', 'number', 'min="2" max="30" step="2"')}${field('seriesOtTarget', 'Overtime win target', 'number', 'min="2" max="99"')}${field('seriesOtCap', 'Overtime round cap (0 unlimited)', 'number', 'min="0" max="99"')}${field('seriesOtWinBy', 'Overtime win difference', 'number', 'min="1" max="10"')}</div>${field('seriesOtSides', 'Overtime side rotation', 'text', 'maxlength="160"')}<button type="button" class="btn-secondary" id="seriesSaveSiege">Apply Siege rules</button></details>
    <div id="seriesLolSetup" hidden><div class="field-row">${choose('seriesBlue', 'Blue side team (other team is red)', teams)}${choose('seriesFearless', 'Fearless scope', [['off', 'Off / native draft only'], ['team', 'Own team previous champions'], ['global', 'Both teams previous champions']])}</div><details><summary>Optional draft and champion trades</summary><p class="muted-note">Comma separated champion names in confirmed player order. Fearless exclusions are separate from this game's draft bans. Void attempts do not consume champions.</p><div class="field-row">${field('seriesPicksA', 'Team A final champions', 'text', 'maxlength="300"')}${field('seriesPicksB', 'Team B final champions', 'text', 'maxlength="300"')}</div><div class="field-row">${field('seriesDraftBansA', 'Team A draft bans', 'text', 'maxlength="300"')}${field('seriesDraftBansB', 'Team B draft bans', 'text', 'maxlength="300"')}</div><label class="checkbox"><input type="checkbox" id="seriesDraftConfirmed">Final champion trades confirmed</label><p class="muted-note" id="seriesExclusions"></p><label class="checkbox"><input type="checkbox" id="seriesCarryDraft">Admin approved keeping draft on remake (confirm trades and sides again)</label></details></div>
    <div id="seriesMapExtras"><div class="field-row">${choose('seriesPicker', 'Map picked by', teams)}${choose('seriesSideChooser', 'Side chosen by', teams)}</div><div id="seriesCodPool" hidden>${field('seriesLegalPool', 'Confirmed legal maps for current mode (comma separated)', 'text', 'maxlength="300"')}</div><div id="seriesSiegeBans" hidden><div class="field-row">${field('seriesOperatorBansA', 'Team A operator bans', 'text', 'maxlength="160"')}${field('seriesOperatorBansB', 'Team B operator bans', 'text', 'maxlength="160"')}</div>${field('seriesPhase', 'Current side phase (regulation half / overtime round)', 'text', 'maxlength="80"')}</div></div>
    <details id="seriesRehost" hidden><summary>Admin continuation / rehost</summary><p class="muted-note">Preserve valid partial scores in this attempt without awarding a map. For a full replay use Void and remake. Final scores include retained play.</p><div class="field-row">${field('seriesRetainedA', 'Team A retained score', 'number', 'min="0" max="999"')}${field('seriesRetainedB', 'Team B retained score', 'number', 'min="0" max="999"')}</div>${field('seriesContinuationNote', 'Admin continuation instruction', 'text', 'maxlength="160"')}<button type="button" class="btn-secondary" id="seriesSaveRehost">Record continuation and technical pause</button><p class="muted-note" id="seriesContinuations"></p></details>`;
  el('seriesStatus').after(setup);
  let data, busy;
  const command = (action, fields) => window.seriesPanel.command(action, fields);
  const configure = (fields) => command('configure', { bestOf: data.series.bestOf, ...fields });
  const mapCommand = (fields) => command('map', { mapId: data.series.maps[data.series.current].id, ...fields });
  const onChange = (id, fn) => el(id).addEventListener('change', fn);
  const value = (id, v) => { if (document.activeElement !== el(id)) { if (el(id).type === 'checkbox') el(id).checked = !!v; else el(id).value = v ?? ''; } };
  el('seriesSaveCompetition').onclick = () => configure({ competition: { organizer: el('seriesOrganizer').value, season: el('seriesRuleSeason').value, version: el('seriesRuleVersion').value, url: el('seriesRuleUrl').value, verified: el('seriesRuleDate').value } });
  onChange('seriesCodPreset', () => { const p = data.series.rules.presets[el('seriesCodPreset').value]; el('seriesTitle').value = p.title; el('seriesSeason').value = p.season; });
  el('seriesSaveCod').onclick = () => configure({ preset: el('seriesCodPreset').value, title: el('seriesTitle').value, season: el('seriesSeason').value, customMode: el('seriesCustomMode').value, customUnit: el('seriesCustomUnit').value });
  el('seriesSaveSiege').onclick = () => configure({ regulationRounds: Number(el('seriesRegulation').value), overtimeTarget: Number(el('seriesOtTarget').value), overtimeCap: Number(el('seriesOtCap').value), overtimeWinBy: Number(el('seriesOtWinBy').value), overtimeSides: el('seriesOtSides').value });
  onChange('seriesFearless', () => configure({ fearless: el('seriesFearless').value }));
  for (const [id, key] of [['seriesBlue', 'blueTeam'], ['seriesPicksA', 'picksA'], ['seriesPicksB', 'picksB'], ['seriesDraftBansA', 'draftBansA'], ['seriesDraftBansB', 'draftBansB'], ['seriesPicker', 'picker'], ['seriesSideChooser', 'sideChooser'], ['seriesOperatorBansA', 'banA'], ['seriesOperatorBansB', 'banB'], ['seriesLegalPool', 'pool']]) onChange(id, () => mapCommand({ [key]: el(id).value }));
  onChange('seriesDraftConfirmed', () => mapCommand({ draftConfirmed: el('seriesDraftConfirmed').checked }));
  onChange('seriesPhase', () => command('sides', { leftTeam: data.series.leftTeam, attackingTeam: data.series.attackingTeam, phase: el('seriesPhase').value }));
  el('seriesSaveRehost').onclick = () => command('rehost', { scoreA: el('seriesRetainedA').value, scoreB: el('seriesRetainedB').value, note: el('seriesContinuationNote').value });
  function render(next, pending) {
    data = next; busy = pending;
    const s = data.series, m = s.maps[s.current], c = s.config, lol = data.game === 'lol', cod = data.game === 'cod', r6 = data.game === 'r6';
    const locked = busy || s.needsReview, played = s.maps.some((x) => x.status !== 'ready');
    for (const [id, visible] of [['seriesCodSetup', cod], ['seriesSiegeSetup', r6], ['seriesLolSetup', lol], ['seriesSiegeBans', r6], ['seriesCodPool', cod], ['seriesRehost', cod || r6]]) el(id).hidden = !visible;
    setup.querySelectorAll('input,select,button').forEach((e) => { e.disabled = locked; });
    for (const id of ['seriesCodSetup', 'seriesSiegeSetup']) el(id).querySelectorAll('input,select,button').forEach((e) => { e.disabled = locked || played; });
    for (const id of ['seriesLolSetup', 'seriesMapExtras']) el(id).querySelectorAll('input,select').forEach((e) => { e.disabled = locked || m.status !== 'ready'; });
    el('seriesPhase').disabled = locked; el('seriesFearless').disabled = locked || played;
    el('seriesSaveRehost').disabled = locked || !['playing', 'paused', 'awaiting-result'].includes(m.status);
    for (const [id, v] of Object.entries({ seriesOrganizer: c.competition.organizer, seriesRuleSeason: c.competition.season, seriesRuleVersion: c.competition.version, seriesRuleUrl: c.competition.url, seriesRuleDate: c.competition.verified,
      seriesCodPreset: c.preset, seriesTitle: c.title, seriesSeason: c.season, seriesCustomMode: c.customMode, seriesCustomUnit: c.customUnit,
      seriesRegulation: c.regulationRounds, seriesOtTarget: c.overtimeTarget, seriesOtCap: c.overtimeCap, seriesOtWinBy: c.overtimeWinBy, seriesOtSides: c.overtimeSides,
      seriesBlue: m.blueTeam || '', seriesFearless: c.fearless, seriesPicksA: m.picksA, seriesPicksB: m.picksB, seriesDraftBansA: m.draftBansA, seriesDraftBansB: m.draftBansB, seriesDraftConfirmed: m.draftConfirmed,
      seriesPicker: m.picker, seriesSideChooser: m.sideChooser, seriesOperatorBansA: m.banA, seriesOperatorBansB: m.banB, seriesPhase: m.sides?.phase, seriesLegalPool: c.legalMaps?.[m.mode] })) value(id, v);
    for (const id of ['seriesBlue', 'seriesPicker', 'seriesSideChooser']) for (const t of ['A', 'B']) el(id).querySelector(`[value="${t}"]`).textContent = data['team' + t]?.name || 'Team ' + t;
    el('seriesExclusions').textContent = ['A', 'B'].map((t) => `${data['team' + t]?.name || 'Team ' + t} Fearless exclusions: ${(s.exclusions?.[t] || []).join(', ') || 'none'}`).join(' · ');
    el('seriesContinuations').textContent = (m.continuations || []).map((x) => `${x.scoreA}–${x.scoreB}: ${x.note}`).join(' · ');
    root.querySelector('.series-summary small').firstChild.textContent = lol ? 'GAMES' : 'MAPS';
    el('seriesMapName').previousElementSibling.textContent = lol ? 'Current game label (optional)' : 'Current map name';
    if (lol) {
      el('seriesStart').textContent = 'Start game'; el('seriesAwait').textContent = 'Finish game'; el('seriesNext').textContent = 'Next game';
      el('seriesStart').disabled ||= !m.blueTeam;
    } else { el('seriesStart').textContent = 'Start map'; el('seriesAwait').textContent = 'Finish map'; el('seriesNext').textContent = 'Next map'; }
    if (cod) {
      el('seriesRotationNote').textContent = 'Confirm this title’s mode order and legal map pools. Extra maps require a mode choice. Native CODcaster owns live scores and clocks.';
      for (const t of ['A', 'B']) { el('seriesDetailLabel' + t).textContent = (data['team' + t]?.name || 'Team ' + t) + ' objective / remaining lives summary (optional)'; el('seriesDetail' + t).placeholder = 'Optional mode-specific final summary'; }
      el('seriesStart').disabled ||= !c.title || !c.season;
    }
  }
  window.SeriesSetup = { render, carryDraft: () => el('seriesCarryDraft').checked };
})();
