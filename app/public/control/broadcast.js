// Stream Control: the Broadcast page (test branch), for a profile with a
// `broadcast` block. Loaded after control.js and shares its helpers ($id,
// esc, toast, state, library, games, switchScene, ...).
//
// The server's broadcast.js owns everything shown here and sends it to every
// panel and scene as one `bx` message. This page draws that and posts
// changes to /api/bx/*: this week's other matches (typed in, or read from
// followed LeagueOS seasons), the ticker, pop-ups, the lower third and the
// cameras.
(function () {
  if (!BRAND.broadcast) return;

  let bx = null;
  let cams = { connected: false, cameras: [] };
  let editing = '';   // id of the typed-in match in the form, '' for a new one

  function call(method, url, body) {
    return fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then((r) => r.json()).catch(() => ({ error: 'App not reachable' }));
  }
  const post = (url, body) => call('POST', url, body || {});
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function button(text, cls, onClick) {
    const b = el('button', cls || 'btn-secondary', text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function whenText(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return 'No start time';
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const day = sameDay(d, now) ? 'Today' : sameDay(d, tomorrow) ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return `${day} ${clockTime(d)}`;
  }

  // --- Matches this week ---------------------------------------------------------
  const matchList = $id('bxMatchList');
  let matchSig = '';

  function matchRow(m) {
    const row = el('div', 'bx-m' + (m.home ? ' home' : '') + (m.state === 'live' ? ' live' : '') + (m.onStream ? ' on-stream' : ''));
    row.dataset.id = m.id;

    const top = el('div', 'bx-m-top');
    top.append(el('b', '', [m.game, m.league, m.round].filter(Boolean).join(' · ') || 'Match'), el('span', '', whenText(m.start)));
    const tags = [m.src === 'league' ? 'League feed' : 'Manual'];
    if (m.corrected) tags.push('Corrected');
    if (m.onStream) tags.push('On stream');
    top.appendChild(el('em', '', tags.join(' · ')));

    const main = el('div', 'bx-m-main');
    const stepper = (side) => {
      const box = el('span', 'bx-m-step');
      const v = m[side].score;
      box.append(
        button('−', 'btn-secondary sb-step', () => post(`/api/bx/matches/${m.id}/score`, { [side]: Math.max(0, v - 1) })),
        el('b', '', String(v)),
        button('+', 'btn-secondary sb-step', () => post(`/api/bx/matches/${m.id}/score`, { [side]: v + 1 })));
      return box;
    };
    main.append(el('span', 'bx-m-team a', m.a.name), stepper('a'), el('i', '', '–'), stepper('b'), el('span', 'bx-m-team b', m.b.name));

    const foot = el('div', 'bx-m-foot');
    const seg = el('div', 'segmented');
    [['upcoming', 'Upcoming'], ['live', 'Live'], ['final', 'Final']].forEach(([v, label]) => {
      const b = button(label, 'seg-btn' + (m.state === v ? ' active' : ''), () => post(`/api/bx/matches/${m.id}/score`, { state: v }));
      seg.appendChild(b);
    });
    const note = el('input', 'bx-m-note');
    note.type = 'text'; note.placeholder = 'Note, e.g. Map 2'; note.value = m.note || ''; note.maxLength = 60;
    note.addEventListener('change', () => post(`/api/bx/matches/${m.id}/score`, { note: note.value }));
    note.addEventListener('keydown', (e) => { if (e.key === 'Enter') note.blur(); });
    foot.append(seg, note);
    foot.appendChild(button('Pop up', 'btn-secondary', async (e) => {
      const r = await post('/api/bx/alert', { matchId: m.id });
      if (r.error) toast(`Pop-up failed: ${r.error}`); else flashText(e.target, 'Sent', 'Pop up');
    }));
    if (m.src === 'manual') foot.appendChild(button('Edit', 'btn-secondary', () => openForm(m)));
    if (m.corrected) foot.appendChild(button('Use league score', 'btn-secondary', () => post(`/api/bx/matches/${m.id}/uncorrect`)));
    foot.appendChild(button('Remove', 'btn-secondary btn-quiet-danger', async () => {
      await call('DELETE', `/api/bx/matches/${encodeURIComponent(m.id)}`);
      if (m.src === 'manual') {
        toast(`Removed: ${m.a.name} vs ${m.b.name}`, 'Undo', () => call('PUT', '/api/bx/matches', m));
      }
    }));
    row.append(top, main, foot);
    return row;
  }

  function renderMatches() {
    if (!bx) return;
    const week = bx.week ? `${new Date(bx.week.from).toLocaleDateString([], { month: 'short', day: 'numeric' })} to ${new Date(new Date(bx.week.to).getTime() - 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : '';
    $id('bxWeek').textContent = week;
    $id('bxRestoreBtn').hidden = !bx.hidden;
    $id('bxRestoreBtn').textContent = `Restore removed (${bx.hidden})`;
    // A note being typed is not thrown away by a redraw.
    const typing = matchList.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    const sig = JSON.stringify(bx.matches);
    if (sig === matchSig || typing) return;
    matchSig = sig;
    matchList.textContent = '';
    if (!bx.matches.length) { matchList.appendChild(el('div', 'lib-empty', 'No matches this week.')); return; }
    bx.matches.forEach((m) => matchList.appendChild(matchRow(m)));
  }

  // The form for a typed-in match. A team named as in the library takes its
  // short name, colour and logo from there.
  function libraryTeam(name) {
    const n = String(name || '').trim().toLowerCase();
    return (library.teams || []).find((t) => t.name.trim().toLowerCase() === n) || null;
  }
  function formTeam(name, was) {
    const t = libraryTeam(name);
    if (t) return { name: t.name, tag: t.tag || '', color: t.color || '', logo: t.logoUrl || '' };
    if (was && was.name === name.trim()) return { name: was.name, tag: was.tag, color: was.color, logo: was.logo };
    return { name: name.trim(), tag: '', color: '', logo: '' };
  }
  function openForm(m) {
    editing = m ? m.id : '';
    $id('bxForm').hidden = false;
    $id('bxFormTitle').textContent = m ? 'Edit match' : 'New match';
    $id('bxfGame').value = m ? m.game : ((games.find((g) => g.id === (state && state.game)) || {}).name || '');
    $id('bxfLeague').value = m ? m.league : '';
    $id('bxfRound').value = m ? m.round : '';
    $id('bxfA').value = m ? m.a.name : '';
    $id('bxfB').value = m ? m.b.name : '';
    $id('bxfStart').value = m && m.start ? toDatetimeLocalValue(m.start) : '';
    $id('bxfStatus').textContent = '';
    $id('bxfA').focus();
  }
  $id('bxAddBtn').addEventListener('click', () => openForm(null));
  $id('bxfCancel').addEventListener('click', () => { $id('bxForm').hidden = true; });
  $id('bxfSave').addEventListener('click', async () => {
    const was = editing && bx ? bx.matches.find((m) => m.id === editing) : null;
    const start = $id('bxfStart').value;
    const body = {
      id: editing || undefined,
      game: $id('bxfGame').value, league: $id('bxfLeague').value, round: $id('bxfRound').value,
      start: start ? new Date(start).toISOString() : '',
      a: formTeam($id('bxfA').value, was && was.a), b: formTeam($id('bxfB').value, was && was.b),
    };
    const r = await call('PUT', '/api/bx/matches', body);
    const st = $id('bxfStatus');
    st.classList.toggle('error', !!r.error);
    if (r.error) { st.textContent = r.error; return; }
    $id('bxForm').hidden = true;
  });
  $id('bxRestoreBtn').addEventListener('click', () => post('/api/bx/matches/restore'));
  $id('bxRefreshBtn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    await post('/api/bx/refresh');
    e.target.disabled = false;
  });

  // --- League feed -----------------------------------------------------------------
  function renderFollows() {
    const box = $id('bxFollowList');
    box.textContent = '';
    if (!bx.follows.length) { box.appendChild(el('div', 'lib-empty', 'No seasons followed.')); return; }
    bx.follows.forEach((f) => {
      const row = el('div', 'lib-row');
      const name = el('span', 'lib-name', [f.game || f.name, f.league].filter(Boolean).join(' · '));
      name.title = f.host;
      const meta = el('span', 'lib-meta' + (f.error ? ' error' : ''));
      meta.textContent = f.error ? `Read failed: ${f.error}` : f.checkedAt ? `${f.count} in range · read ${clockTime(new Date(f.checkedAt))}` : 'Reading';
      row.append(name, meta, button('Remove', 'btn-secondary lib-del', () => call('DELETE', `/api/bx/follows/${encodeURIComponent(f.id)}`)));
      box.appendChild(row);
    });
  }
  async function follow() {
    const input = $id('bxFollowUrl');
    const st = $id('bxFollowStatus');
    const url = input.value.trim();
    if (!url) return;
    st.classList.remove('error');
    st.textContent = 'Reading the league site…';
    const r = await post('/api/bx/follows', { url });
    if (r.error) { st.textContent = r.error; st.classList.add('error'); return; }
    st.textContent = r.added ? `Following: ${r.seasons.join(', ')}.` : 'Already followed.';
    input.value = '';
  }
  $id('bxFollowBtn').addEventListener('click', follow);
  $id('bxFollowUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') follow(); });

  // --- Settings: scope, ticker, pop-ups, camera window --------------------------------
  const set = (patch) => post('/api/bx/settings', patch);
  const CHECKS = [
    ['bxTickerOn', 'ticker', 'on'], ['bxTickerCams', 'ticker', 'cams'], ['bxTickerGame', 'ticker', 'gameplay'],
    ['bxAlertAuto', 'alerts', 'auto'], ['bxAlertEdit', 'alerts', 'onEdit'], ['bxAlertSeries', 'alerts', 'series'], ['bxAlertGame', 'alerts', 'gameplay'],
  ];
  CHECKS.forEach(([id, group, key]) => $id(id).addEventListener('change', (e) => set({ [group]: { [key]: e.target.checked } })));
  $id('bxScope').addEventListener('change', (e) => set({ scope: e.target.value }));
  $id('bxAlertPos').addEventListener('change', (e) => set({ alerts: { pos: e.target.value } }));
  $id('bxAlertSeconds').addEventListener('change', (e) => set({ alerts: { seconds: Number(e.target.value) || 9 } }));
  $id('bxPipPos').addEventListener('change', (e) => set({ pip: { pos: e.target.value } }));
  $id('bxPipSize').addEventListener('change', (e) => set({ pip: { size: e.target.value } }));
  $id('bxTickerMsgs').addEventListener('change', (e) => set({ ticker: { messages: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) } }));
  $id('bxlSeconds').addEventListener('change', (e) => set({ lower: { seconds: Math.max(0, Number(e.target.value) || 0) } }));

  function renderSettings() {
    const s = bx.settings;
    CHECKS.forEach(([id, group, key]) => setVal($id(id), s[group][key]));
    setVal($id('bxScope'), s.scope);
    setVal($id('bxAlertPos'), s.alerts.pos);
    setVal($id('bxAlertSeconds'), s.alerts.seconds);
    setVal($id('bxPipPos'), s.pip.pos);
    setVal($id('bxPipSize'), s.pip.size);
    setVal($id('bxTickerMsgs'), (s.ticker.messages || []).join('\n'));
    setVal($id('bxlSeconds'), s.lower.seconds);
  }

  // --- Message pop-up ---------------------------------------------------------------------
  $id('bxnShow').addEventListener('click', async (e) => {
    const title = $id('bxnTitle').value.trim();
    if (!title) { flashText(e.target, 'Headline required', 'Show'); return; }
    const r = await post('/api/bx/alert', { kicker: $id('bxnKicker').value, title, body: $id('bxnBody').value });
    if (r.error) toast(`Pop-up failed: ${r.error}`); else flashText(e.target, 'Sent', 'Show');
  });

  // --- Lower third ---------------------------------------------------------------------------
  $id('bxlShow').addEventListener('click', async (e) => {
    const title = $id('bxlTitle').value.trim();
    if (!title) { flashText(e.target, 'Name required', 'Show'); return; }
    await post('/api/bx/lower', {
      on: true, title, kicker: $id('bxlKicker').value, sub: $id('bxlSub').value, team: $id('bxlTeam').value,
      seconds: Math.max(0, Number($id('bxlSeconds').value) || 0),
    });
  });
  $id('bxlHide').addEventListener('click', () => post('/api/bx/lower', { on: false }));
  function renderLower() {
    const lt = bx.lower || {};
    $id('bxLowerState').textContent = lt.on ? `On air: ${lt.title}` : '';
    $id('bxLowerCard').classList.toggle('bx-live', !!lt.on);
    $id('bxlHide').disabled = !lt.on;
  }
  // A click on a player fills the fields; Show puts it on air.
  let playerSig = '';
  function renderPlayers() {
    const box = $id('bxlPlayers');
    if (!state) return;
    const teams = [['A', state.teamA], ['B', state.teamB]];
    const sig = JSON.stringify(teams);
    if (sig === playerSig) return;
    playerSig = sig;
    box.textContent = '';
    let any = false;
    teams.forEach(([L, t]) => {
      ((t && t.players) || []).forEach((p) => {
        const tag = p.gamertag || p.name;
        if (!tag) return;
        any = true;
        const chip = button(tag, 'btn-secondary bx-chip team-' + L.toLowerCase(), () => {
          $id('bxlTitle').value = tag;
          $id('bxlSub').value = [p.name && p.name !== tag ? p.name : '', t.name].filter(Boolean).join(' · ');
          $id('bxlTeam').value = L;
          if (!$id('bxlKicker').value.trim()) $id('bxlKicker').value = 'Player spotlight';
        });
        chip.style.setProperty('--c', toHex6(t.color) || DEFAULT_COLORS[L]);
        box.appendChild(chip);
      });
    });
    if (!any) box.appendChild(el('div', 'lib-empty', 'No players in the rosters.'));
    const names = { A: (state.teamA && state.teamA.name) || 'Team A', B: (state.teamB && state.teamB.name) || 'Team B' };
    Array.from($id('bxlTeam').options).forEach((o) => { if (o.value) o.textContent = names[o.value]; });
  }

  // --- Cameras -----------------------------------------------------------------------------------
  async function refreshCams() {
    cams = await call('GET', '/api/bx/cameras');
    if (!Array.isArray(cams.cameras)) cams = { connected: false, cameras: [] };
    renderCams();
  }
  function renderCams() {
    const box = $id('bxCamList');
    if (!bx) return;
    // A device list being used is not rebuilt under the pointer.
    if (box.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
    box.textContent = '';
    bx.cams.forEach((c) => {
      const info = cams.cameras.find((x) => x.id === c.id) || { exists: false, devices: [], device: '', window: false };
      const row = el('div', 'bx-cam' + (c.pip ? ' on' : ''));
      const head = el('div', 'bx-cam-head');
      head.append(el('b', '', c.label));
      const status = !cams.connected ? 'OBS not connected' : !info.exists ? 'Source missing. Build scenes.' : !info.device ? 'No device selected' : '';
      head.appendChild(el('span', 'bx-cam-status' + (status ? ' warn' : ''), status || `${BRAND.obsPrefix}-cam-${c.id}`));
      const controls = el('div', 'bx-cam-row');
      const sel = el('select');
      sel.setAttribute('aria-label', `${c.label} device`);
      sel.appendChild(new Option(info.devices.length ? 'Select a device' : 'No devices listed', ''));
      info.devices.forEach((d) => sel.appendChild(new Option(d.name, d.value)));
      // A device OBS has set but no longer lists (unplugged) stays visible.
      if (info.device && !info.devices.some((d) => d.value === info.device)) sel.appendChild(new Option('Not connected: ' + info.device.split(':')[0], info.device));
      sel.value = info.device || '';
      sel.disabled = !cams.connected || !info.exists;
      sel.addEventListener('change', async () => {
        const r = await post(`/api/bx/cameras/${c.id}/device`, { device: sel.value });
        if (r.error) toast(`Device not set: ${r.error}`);
        refreshCams();
      });
      const win = button(c.pip ? 'Hide window' : 'Show window', c.pip ? 'btn-accent' : 'btn-secondary', () => post('/api/bx/cam', { id: c.id, pip: !c.pip }));
      win.title = 'Camera window over the game, on the Scoreboard scene';
      const air = button('Put scene on air', 'btn-secondary', () => switchScene('cam-' + c.id));
      air.disabled = !cams.connected;
      controls.append(sel, win, air);
      row.append(head, controls);
      box.appendChild(row);
    });
    $id('bxCamStatus').textContent = cams.connected ? '' : 'Device lists and camera windows need OBS.';
  }
  $id('bxCamRefresh').addEventListener('click', refreshCams);
  $id('bxPageBtn').addEventListener('click', refreshCams);

  // --- Lists for the form ---------------------------------------------------------------------------
  function fillLists() {
    const gl = $id('bxGameList');
    gl.textContent = '';
    (games || []).forEach((g) => gl.appendChild(new Option(g.name, g.name)));
    const tl = $id('bxTeamList');
    tl.textContent = '';
    (library.teams || []).forEach((t) => tl.appendChild(new Option(t.name, t.name)));
  }

  function renderAllBx() {
    if (!bx) return;
    renderMatches();
    renderFollows();
    renderSettings();
    renderLower();
    renderCams();
  }

  window.bxPanel = {
    onMessage(msg) {
      if (msg.type === 'bx' && msg.bx) { bx = msg.bx; renderAllBx(); }
      if (msg.type === 'library') fillLists();
      // A build may have just made the camera sources.
      if (msg.type === 'scenes') refreshCams();
    },
    // The match state changed (control.js renderAll).
    render() { renderPlayers(); fillLists(); },
  };

  refreshCams();
})();
