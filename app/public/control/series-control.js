/* Map/series operations deliberately await the server rather than applying
   optimistic counters. An OBS dock and app window can operate concurrently. */
(() => {
  const root = document.getElementById('seriesControls');
  root.innerHTML = `
    <div class="series-summary"><div class="series-team"><img id="seriesLogoA" alt="" hidden><span id="seriesNameA"></span><b id="seriesScoreA">0</b></div><small>MAPS<br><span id="seriesFormat"></span></small><div class="series-team"><img id="seriesLogoB" alt="" hidden><span id="seriesNameB"></span><b id="seriesScoreB">0</b></div></div>
    <div class="series-review" id="seriesReview" hidden>Series restored after restart. Verify the map and HUD sides before continuing.<button class="btn-secondary" type="button" data-series="review">Reviewed and ready</button></div>
    <div class="series-status" id="seriesStatus" aria-live="polite"></div>
    <div class="field-row"><label class="grow"><span class="lbl">Current map name</span><input type="text" id="seriesMapName" maxlength="80" placeholder="Enter the confirmed map"></label><label><span class="lbl">Format</span><select id="seriesBestOf"><option value="1">BO1</option><option value="3">BO3</option><option value="5">BO5</option><option value="7">BO7</option><option value="9">BO9</option></select></label></div>
    <div id="seriesOverwatch" hidden><div class="field-row"><label class="grow"><span class="lbl">Current map mode</span><select id="seriesMode"></select></label><label class="grow"><span class="lbl">Extra map default mode</span><select id="seriesTiebreaker"></select></label></div><p class="muted-note" id="seriesRotationNote">Starting rotation: college example, not an event ruleset. Edit pending modes in the schedule to match your organizer. Draws award no win; extra maps continue until the first-to target is reached.</p><div class="field-row"><label class="grow"><span class="lbl" id="seriesBanLabelA">Team A hero ban</span><input id="seriesBanA" maxlength="60" placeholder="Optional confirmed hero ban"></label><label class="grow"><span class="lbl" id="seriesBanLabelB">Team B hero ban</span><input id="seriesBanB" maxlength="60" placeholder="Optional confirmed hero ban"></label></div><p class="muted-note" id="seriesDraftNote">Bans belong to this map attempt. Confirm them again for a remake. No ban restrictions are enforced.</p></div>
    <div class="field-row"><label class="grow"><span class="lbl">Native HUD left team</span><select id="seriesLeft"><option value="A">Team A</option><option value="B">Team B</option></select></label><label class="grow" id="seriesAttackerField"><span class="lbl">Attacking team</span><select id="seriesAttacker"><option value="">Not shown</option><option value="A">Team A</option><option value="B">Team B</option></select></label></div>
    <div class="series-actions"><button class="btn-accent" type="button" data-series="start" id="seriesStart">Start map</button><button class="btn-secondary" type="button" data-series="pause" data-kind="technical" id="seriesTech">Technical pause</button><button class="btn-secondary" type="button" data-series="pause" data-kind="tactical" id="seriesTac">Tactical timeout</button><button class="btn-secondary" type="button" data-series="resume" id="seriesResume">Resume</button><button class="btn-secondary" type="button" data-series="await-result" id="seriesAwait">Finish map</button><button class="btn-accent" type="button" data-series="next" id="seriesNext">Next map</button></div>
    <p class="muted-note">Rounds, timers and player status come from the game's spectator HUD. These controls update broadcast graphics only.</p>
    <div class="series-result" id="seriesResult"><div class="sub-head first" id="seriesResultHeading">Confirm map result</div><div class="field-row"><label class="grow"><span class="lbl">Result</span><select id="seriesWinner"><option value="A">Team A wins</option><option value="B">Team B wins</option><option value="draw">Draw by admin ruling</option></select></label><label class="grow"><span class="lbl">Result type</span><select id="seriesResultType"><option value="played">Played</option><option value="forfeit">Forfeit</option><option value="admin">Admin ruling</option></select></label></div><div class="field-row"><label class="grow"><span class="lbl" id="seriesRoundsLabelA">Team A final rounds optional</span><input id="seriesRoundsA" type="number" min="0" max="999" placeholder="Optional"></label><label class="grow"><span class="lbl" id="seriesRoundsLabelB">Team B final rounds optional</span><input id="seriesRoundsB" type="number" min="0" max="999" placeholder="Optional"></label></div><label><span class="lbl">Result or remake note</span><input type="text" id="seriesNote" maxlength="160" placeholder="Optional admin ruling or note"></label><p class="muted-note" id="seriesResultPreview"></p><div class="series-actions"><button class="btn-accent" type="button" id="seriesConfirm">Confirm result</button><button class="btn-secondary" type="button" id="seriesCancelEdit" hidden>Cancel correction</button></div></div>
    <div class="series-actions"><button class="btn-secondary" type="button" data-series="roles">Swap attack and defense</button><button class="btn-secondary" type="button" data-series="swap">Swap HUD left and right</button><button class="btn-secondary" type="button" data-series="remake" id="seriesRemake">Void and remake current map</button><button class="btn-secondary" type="button" data-series="undo" id="seriesUndo">Undo last change</button></div>
    <div class="series-error" id="seriesError" role="status"></div>
    <details><summary>Map schedule and results</summary><div class="series-history" id="seriesHistory"></div><p class="muted-note" id="seriesOpening"></p></details>
    <details><summary>Board visibility and placement</summary><label class="checkbox"><input type="checkbox" id="seriesVisible">Show board</label><label class="checkbox"><input type="checkbox" id="seriesShowHistory">Show recent map history on stream</label><div class="field-row"><label class="grow"><span class="lbl">Horizontal inset px</span><input id="seriesX" type="number" min="0" max="800" step="1"></label><label class="grow"><span class="lbl">Vertical inset px</span><input id="seriesY" type="number" min="0" max="500" step="1"></label><label class="grow"><span class="lbl">Scale</span><input id="seriesScale" type="number" min="0.75" max="1.5" step="0.05"></label></div><p class="muted-note">Choose a corner in Scoreboard settings. Insets move the board inward. Preview against your actual observer HUD before going live.</p></details>
    <button class="btn-secondary btn-quiet-danger" type="button" data-series="reset">Start a new series</button>`;
  const el = (id) => document.getElementById(id);
  const payloadFields = document.createElement('div'); payloadFields.className = 'field-row'; payloadFields.id = 'seriesPayload'; payloadFields.hidden = true;
  payloadFields.innerHTML = ['A', 'B'].map((t) => `<label class="grow"><span class="lbl" id="seriesDetailLabel${t}">Payload progress / time</span><input type="text" id="seriesDetail${t}" maxlength="80" placeholder="e.g. 3 checkpoints, 1:24 left"></label>`).join('');
  el('seriesNote').parentElement.before(payloadFields);
  const lockFields = document.createElement('div'); lockFields.className = 'field-row'; lockFields.id = 'seriesRivalsLocks'; lockFields.hidden = true;
  lockFields.innerHTML = ['A', 'B'].map((t) => `<label class="grow"><span class="lbl" id="seriesLockLabel${t}">Protected hero locks</span><input type="text" id="seriesLock${t}" maxlength="180" placeholder="Confirmed locks, comma separated"></label>`).join('');
  el('seriesDraftNote').before(lockFields);
  for (const t of ['A', 'B']) el('seriesBan' + t).type = 'text';
  let currentState, pending = false, editing = '', formKey = '';
  const series = () => currentState?.series;
  const supports = (data) => ['val', 'ow', 'mr', 'lol', 'r6', 'cod'].includes(data?.game) && data.series?.game === data.game;
  const ow = () => currentState?.game === 'ow';
  const mr = () => currentState?.game === 'mr';
  const cod = () => currentState?.game === 'cod';
  const modesGame = () => ow() || mr() || cod();
  const resultMap = () => series()?.maps.find((m) => m.id === editing) || series()?.maps[series().current];
  const unit = (m) => cod() ? (['Search and Destroy', 'Control'].includes(m.mode) ? 'rounds' : m.mode === 'Hardpoint' ? 'points' : m.mode === series().config.customMode ? series().config.customUnit : 'objective score') : mr() ? (m.mode === 'Domination' ? 'subrounds' : m.mode === 'Convoy' ? 'checkpoints / distance / time' : 'capture / payload progress') : !ow() ? 'rounds' : m.mode === 'Control' ? 'subrounds' : m.mode === 'Flashpoint' ? 'points' : m.mode === 'Push' ? 'distance (m)' : 'payload progress / time';
  const name = (t) => currentState?.['team' + t]?.name || 'Team ' + t;
  const label = (m) => `${currentState?.game === 'lol' ? 'Game' : 'Map'} ${m.slot}${m.attempt > 1 ? ' attempt ' + m.attempt : ''}${modesGame() ? ' · ' + (m.mode || 'MODE REQUIRED') : ''}${m.name ? ' · ' + m.name : ''}`;
  const score = (t) => currentState?.scoreboard?.['score' + t] || 0;
  function preview() {
    const m = series()?.maps.find((m) => m.id === editing) || series()?.maps[series().current];
    if (!m) return;
    const winner = el('seriesWinner').value;
    const rounds = el('seriesRoundsA').value || el('seriesRoundsB').value ? ` · ${unit(m)} ${el('seriesRoundsA').value || '?'}–${el('seriesRoundsB').value || '?'}` : '';
    const details = el('seriesDetailA').value || el('seriesDetailB').value ? ` · ${name('A')}: ${el('seriesDetailA').value || '—'}; ${name('B')}: ${el('seriesDetailB').value || '—'}` : '';
    el('seriesResultPreview').textContent = `${label(m)}: ${winner === 'draw' ? 'Draw, no map awarded' : name(winner) + ' wins'}${rounds}${details}. ${editing ? 'Replaces the recorded result.' : winner === 'draw' ? 'Series wins stay unchanged.' : 'Adds one completed map win.'}`;
    el('seriesResultType').disabled = winner === 'draw' || pending;
    const s = series(), active = s.maps[s.current];
    el('seriesConfirm').disabled = pending || s.needsReview || (!editing && (!['ready', 'playing', 'paused', 'awaiting-result'].includes(active.status) || (active.status === 'ready' && !['forfeit', 'admin'].includes(el('seriesResultType').value))));
  }
  async function command(action, fields = {}) {
    if (pending || !series()) return false;
    const s = series();
    pending = true; render(currentState); el('seriesError').textContent = '';
    try {
      const response = await fetch('/api/series', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, seriesId: s.id, revision: s.revision, ...fields }) });
      const data = await response.json();
      if (data.state && state?.game === s.game && state.series?.id === s.id && data.state.game === s.game && (data.state.series?.revision ?? 0) >= (state.series?.revision ?? 0)) { currentState = data.state; state = data.state; renderAll(); }
      if (!response.ok) throw new Error(data.error || 'Series change failed.');
      if (['finish', 'edit-result', 'reset', 'undo', 'next', 'remake'].includes(action)) { editing = ''; formKey = ''; }
      return true;
    } catch (error) { el('seriesError').textContent = error.message || 'Connection lost. Review the latest state before retrying.'; return false; }
    finally { pending = false; render(currentState); }
  }
  function render(data) {
    currentState = data;
    const active = supports(data);
    root.hidden = !active;
    if (!active) return;
    const s = series(), m = s.maps[s.current];
    const final = score('A') >= s.winsRequired || score('B') >= s.winsRequired;
    ['A', 'B'].forEach((t) => {
      el('seriesName' + t).textContent = name(t); el('seriesScore' + t).textContent = String(score(t));
      const logo = el('seriesLogo' + t), src = data['team' + t]?.logoUrl;
      logo.hidden = !src; if (src) logo.src = mediaUrl(src);
      el('seriesRoundsLabel' + t).textContent = `${name(t)} final ${unit(resultMap())} optional`;
      el('seriesBanLabel' + t).textContent = `${name(t)} hero ban`;
      el('seriesDetailLabel' + t).textContent = `${name(t)} ${mr() ? unit(resultMap()) : 'payload progress / time'} optional`;
      el('seriesDetail' + t).placeholder = mr() ? (resultMap().mode === 'Convoy' ? 'e.g. 3 checkpoints, 1:24 left' : 'e.g. capture + 2 checkpoints, 52m') : 'e.g. 3 checkpoints, 1:24 left';
      for (const id of ['seriesLeft', 'seriesAttacker']) el(id).querySelector(`[value="${t}"]`).textContent = name(t);
      el('seriesWinner').querySelector(`[value="${t}"]`).textContent = name(t) + ' wins';
    });
    el('seriesFormat').textContent = modesGame() ? `FIRST TO ${s.winsRequired}` : `BO${s.bestOf}`;
    el('seriesOverwatch').hidden = !modesGame();
    el('seriesTiebreaker').parentElement.hidden = !ow();
    el('seriesBanA').parentElement.parentElement.hidden = cod();
    el('seriesDraftNote').hidden = cod();
    el('seriesRotationNote').textContent = mr() ? 'Starting rotation: editable college example. Confirm modes with the organizer. Draws award no win. Extra maps require an explicit mode choice; no tiebreak procedure is assumed.' : 'Starting rotation: college example, not an event ruleset. Edit pending modes in the schedule to match your organizer. Draws award no win; extra maps continue until the first-to target is reached.';
    el('seriesDraftNote').textContent = mr() ? 'Enter confirmed heroes separated by commas. Bans and protected locks are separate; a locked hero cannot be banned. Follow the room’s draft order. Remakes clear all draft labels.' : 'Bans belong to this map attempt. Confirm them again for a remake. No ban restrictions are enforced.';
    el('seriesRivalsLocks').hidden = !mr();
    for (const id of ['seriesMode', 'seriesTiebreaker']) {
      const select = el(id), modes = s.rules?.modes || [];
      const modeKey = data.game + ':' + modes.join(',');
      if (select.dataset.game !== modeKey) { select.replaceChildren(...(mr() || cod() ? [new Option('Choose mode', '')] : []), ...modes.map((mode) => new Option(mode, mode))); select.dataset.game = modeKey; }
    }
    setVal(el('seriesMode'), m.mode); setVal(el('seriesTiebreaker'), s.tiebreakerMode || 'Control');
    for (const t of ['A', 'B']) {
      setVal(el('seriesBan' + t), m['ban' + t] || ''); el('seriesBan' + t).maxLength = mr() ? 180 : 60;
      el('seriesBan' + t).placeholder = mr() ? 'Confirmed bans, comma separated' : 'Optional confirmed hero ban';
      setVal(el('seriesLock' + t), m['lock' + t] || '');
      el('seriesLockLabel' + t).textContent = `${name(t)} protected hero locks`;
    }
    const payloadRoles = data.game !== 'lol' && (!modesGame() || (cod() ? ['Search and Destroy', 'Control'] : mr() ? ['Convoy', 'Convergence'] : ['Hybrid', 'Escort']).includes(m.mode));
    el('seriesAttackerField').hidden = !payloadRoles;
    root.querySelector('[data-series="roles"]').hidden = !payloadRoles;
    el('seriesStatus').textContent = `${final ? 'Series final · ' : ''}${label(m)} · ${m.status.replaceAll('-', ' ')}${m.pause ? ' · ' + m.pause.kind : ''}`;
    el('seriesReview').hidden = !s.needsReview;
    setVal(el('seriesMapName'), m.name); el('seriesMapName').disabled = m.status !== 'ready' || pending;
    setVal(el('seriesBestOf'), s.bestOf); setVal(el('seriesLeft'), s.leftTeam); setVal(el('seriesAttacker'), s.attackingTeam);
    setVal(el('seriesVisible'), s.visible !== false); setVal(el('seriesShowHistory'), !!s.showHistory);
    setVal(el('seriesX'), s.offsetX || 0); setVal(el('seriesY'), s.offsetY || 0); setVal(el('seriesScale'), s.scale || 1);
    root.querySelectorAll('button,select,input').forEach((e) => { if (e.id !== 'seriesMapName') e.disabled = pending; });
    const blocked = pending || s.needsReview;
    for (const id of ['seriesMode', 'seriesBanA', 'seriesBanB', 'seriesLockA', 'seriesLockB']) el(id).disabled = blocked || m.status !== 'ready';
    el('seriesStart').disabled = blocked || final || m.status !== 'ready' || ((mr() || cod()) && !s.rules.modes.includes(m.mode));
    el('seriesTech').disabled = el('seriesTac').disabled = el('seriesAwait').disabled = blocked || m.status !== 'playing';
    el('seriesResume').disabled = blocked || m.status !== 'paused';
    el('seriesNext').disabled = blocked || final || !['final', 'void'].includes(m.status);
    el('seriesUndo').disabled = pending || !s.canUndo;
    el('seriesRemake').disabled = blocked || m.status === 'void';
    if (editing && !s.maps.some((x) => x.id === editing && x.status === 'final')) editing = '';
    // A correction opened in another panel must refresh this editor too;
    // otherwise old form values could be submitted with the newest revision.
    const editedResult = editing ? JSON.stringify(s.maps.find((x) => x.id === editing)?.result) : '';
    const key = `${s.id}:${m.id}:${m.mode}:${editing}:${editedResult}`;
    if (key !== formKey) {
      formKey = key;
      const target = s.maps.find((x) => x.id === editing), result = target?.result;
      el('seriesWinner').value = result?.type === 'draw' ? 'draw' : result?.winner || 'A';
      el('seriesResultType').value = result?.type === 'draw' ? 'played' : result?.type || 'played';
      el('seriesRoundsA').value = result?.scoreA ?? ''; el('seriesRoundsB').value = result?.scoreB ?? ''; el('seriesNote').value = result?.note || '';
      el('seriesDetailA').value = result?.detailA || ''; el('seriesDetailB').value = result?.detailB || '';
    }
    const rm = resultMap(), payload = modesGame() && (mr() ? ['Convoy', 'Convergence'] : ['Hybrid', 'Escort']).includes(rm.mode);
    el('seriesPayload').hidden = !payload && !cod(); el('seriesRoundsA').parentElement.parentElement.hidden = payload || data.game === 'lol';
    for (const t of ['A', 'B']) { el('seriesRounds' + t).step = ow() && rm.mode === 'Push' ? '0.01' : '1'; el('seriesRounds' + t).max = mr() ? '2' : !ow() ? '999' : rm.mode === 'Control' ? '2' : rm.mode === 'Flashpoint' ? '3' : '9999'; }
    el('seriesWinner').querySelector('[value="draw"]').textContent = modesGame() ? 'Draw — no map win' : 'Draw by admin ruling';
    el('seriesResultHeading').textContent = editing ? `Correct ${label(s.maps.find((x) => x.id === editing))}` : 'Confirm current map result';
    el('seriesCancelEdit').hidden = !editing;
    el('seriesConfirm').disabled = blocked || (!editing && !['ready', 'playing', 'paused', 'awaiting-result'].includes(m.status));
    el('seriesHistory').replaceChildren();
    for (const map of s.maps) {
      const row = document.createElement('div'); row.className = 'series-map-row' + (map.id === m.id ? ' current' : '');
      const copy = document.createElement('div'); copy.className = 'series-map-copy';
      const title = document.createElement('b'); title.textContent = label(map);
      const detail = document.createElement('small');
      detail.textContent = map.status === 'final' ? (map.result.winner ? name(map.result.winner) + ' won' : 'Draw') + (map.result.scoreA != null ? ` · ${unit(map)} ${map.result.scoreA}–${map.result.scoreB}` : '') + (map.result.detailA || map.result.detailB ? ` · ${name('A')}: ${map.result.detailA || '—'}; ${name('B')}: ${map.result.detailB || '—'}` : '') + ` · ${map.result.type}` : map.status;
      if (map.banA || map.banB) detail.textContent += ` · Bans: ${name('A')}: ${map.banA || '—'}; ${name('B')}: ${map.banB || '—'}`;
      if (mr() && (map.lockA || map.lockB)) detail.textContent += ` · Locks: ${name('A')}: ${map.lockA || '—'}; ${name('B')}: ${map.lockB || '—'}`;
      if (map.picksA || map.picksB) detail.textContent += ` · Draft: ${name('A')}: ${map.picksA || '—'}; ${name('B')}: ${map.picksB || '—'}`;
      if (map.blueTeam) detail.textContent += ` · Blue: ${name(map.blueTeam)}`;
      if (map.picker) detail.textContent += ` · Pick: ${name(map.picker)}`;
      if (map.sideChooser) detail.textContent += ` · Side choice: ${name(map.sideChooser)}`;
      if (map.continuations) detail.textContent += map.continuations.map((c) => ` · Rehost ${c.scoreA}–${c.scoreB}: ${c.note}`).join('');
      if (map.voidReason) detail.textContent += ` · ${map.voidReason}`;
      if (map.result?.note) detail.textContent += ` · ${map.result.note}`;
      copy.append(title, detail); row.append(copy);
      if (map.status === 'final') {
        for (const [action, title] of [['edit','Correct'], ['void','Void']]) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-secondary'; b.dataset.history = action; b.dataset.map = map.id; b.textContent = title; b.disabled = blocked; row.append(b);
        }
      } else if (map.status === 'ready' && map.id !== m.id) {
        const input = document.createElement('input'); input.type = 'text'; input.maxLength = 80; input.value = map.name; input.placeholder = 'Map name'; input.setAttribute('aria-label', `Map ${map.slot} name`); input.style.maxWidth = '150px'; input.disabled = blocked;
        input.addEventListener('change', () => command('map', { mapId: map.id, name: input.value })); row.append(input);
      }
      if (modesGame() && map.status === 'ready' && map.id !== m.id) {
        const select = document.createElement('select'); select.setAttribute('aria-label', `Map ${map.slot} mode`);
        select.append(...(mr() || cod() ? [new Option('Choose mode', '')] : []), ...s.rules.modes.map((mode) => new Option(mode, mode))); select.value = map.mode; select.disabled = blocked;
        select.addEventListener('change', () => command('map', { mapId: map.id, mode: select.value })); row.append(select);
      }
      el('seriesHistory').append(row);
    }
    el('seriesOpening').textContent = s.openingWins.A || s.openingWins.B ? `Imported legacy score ${s.openingWins.A}–${s.openingWins.B}; no map names or results were invented. Start a new series to clear it.` : '';
    window.SeriesSetup?.render(data, pending);
    preview();
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-series],[data-history]'); if (!b || pending) return;
    if (b.dataset.history === 'edit') { editing = b.dataset.map; formKey = ''; render(currentState); el('seriesResult').scrollIntoView({ block: 'nearest' }); return; }
    const action = b.dataset.series || b.dataset.history;
    if (['reset','remake','void'].includes(action) && !confirm(action === 'reset' ? 'Start a new series and clear its results? Undo can restore the previous record.' : 'Void this map attempt? It will not count toward the series.')) return;
    command(action, { mapId: b.dataset.map, kind: b.dataset.kind, note: el('seriesNote').value, carryDraft: action === 'remake' && window.SeriesSetup?.carryDraft() });
  });
  el('seriesConfirm').addEventListener('click', () => command(editing ? 'edit-result' : 'finish', {
    mapId: editing || series().maps[series().current].id, winner: el('seriesWinner').value,
    resultType: el('seriesWinner').value === 'draw' ? 'draw' : el('seriesResultType').value,
    scoreA: el('seriesRoundsA').value, scoreB: el('seriesRoundsB').value, note: el('seriesNote').value,
    detailA: el('seriesDetailA').value, detailB: el('seriesDetailB').value,
  }));
  el('seriesCancelEdit').addEventListener('click', () => { editing = ''; formKey = ''; render(currentState); });
  for (const id of ['seriesWinner','seriesResultType','seriesRoundsA','seriesRoundsB','seriesDetailA','seriesDetailB']) el(id).addEventListener('input', preview);
  const commit = (id, fn) => {
    el(id).addEventListener('change', fn);
    el(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el(id).blur(); } });
  };
  commit('seriesMapName', () => { const m = series().maps[series().current]; if (el('seriesMapName').value !== m.name) command('map', { mapId: m.id, name: el('seriesMapName').value }); });
  commit('seriesBestOf', () => command('configure', { bestOf: Number(el('seriesBestOf').value) }));
  commit('seriesMode', () => command('map', { mapId: series().maps[series().current].id, mode: el('seriesMode').value }));
  commit('seriesTiebreaker', () => command('configure', { bestOf: series().bestOf, tiebreakerMode: el('seriesTiebreaker').value }));
  for (const t of ['A', 'B']) commit('seriesLock' + t, () => command('map', { mapId: series().maps[series().current].id, ['lock' + t]: el('seriesLock' + t).value }));
  for (const t of ['A', 'B']) commit('seriesBan' + t, () => command('map', { mapId: series().maps[series().current].id, ['ban' + t]: el('seriesBan' + t).value }));
  for (const id of ['seriesLeft','seriesAttacker']) commit(id, () => command('sides', { leftTeam: el('seriesLeft').value, attackingTeam: el('seriesAttacker').value }));
  for (const [id,key,kind] of [['seriesVisible','visible','bool'],['seriesShowHistory','showHistory','bool'],['seriesX','offsetX'],['seriesY','offsetY'],['seriesScale','scale']]) commit(id, () => command('presentation', { [key]: kind === 'bool' ? el(id).checked : Number(el(id).value) }));
  window.seriesPanel = { render, command, supports,
    async loadSetup(setup) {
      for (let i = 0; i < 50; i++) {
        if (supports(currentState) && currentState.game === setup.game && !pending) return command('load-setup', { setup });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    },
    async newMatch(length) {
      if (!series()) return true;
      if ((series().maps.some((m) => m.status !== 'ready') || score('A') || score('B')) && !confirm('Load a new match and start a fresh series? This clears the previous match record and undo history.')) return false;
      if (!await command('reset', { newMatch: true })) return false;
      return !length || Number(length) === series().bestOf || command('configure', { bestOf: Number(length) });
    },
    pickWinner(team) { if (!series()) return; editing = ''; formKey = ''; render(currentState); el('seriesWinner').value = team; preview(); el('seriesResult').scrollIntoView({ block: 'nearest' }); }
  };
})();
