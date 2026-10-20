(() => {
  let root;
  const node = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const safeColor = (c, fallback) => /^#[0-9a-f]{6}$/i.test(c || '') ? c : fallback;
  const media = (src) => /^https?:\/\//i.test(src || '') || /^\/(?!\/)/.test(src || '') ? src : '/media?src=' + encodeURIComponent(src);
  const team = (state, key) => {
    const data = state['team' + key] || {};
    const name = data.name || 'Team ' + key;
    const tag = data.tag || name.replace(/\b(university|college)\b/gi, '').trim();
    return { ...data, name, tag, color: safeColor(data.color, (window.BRAND?.teamColors || {})[key] || '#6884a2') };
  };
  function render(state) {
    const view = document.getElementById('sb-view');
    const s = state.series;
    const ow = state.game === 'ow', mr = state.game === 'mr', lol = state.game === 'lol', r6 = state.game === 'r6', cod = state.game === 'cod', modesGame = ow || mr || cod;
    const styles = { val: 'valorant', ow: 'overwatch', mr: 'rivals', lol: 'league', r6: 'siege', cod: 'cod' };
    const gameName = s?.rules?.name || state.team;
    const active = !!styles[state.game] && state.scoreboard?.style === styles[state.game] && s?.game === state.game;
    view.classList.toggle('managed-series', active);
    for (const style of Object.values(styles)) view.classList.toggle(style, active && styles[state.game] === style);
    if (!active) { if (root) root.hidden = true; return false; }
    if (!root) { root = node('section'); document.getElementById('sb-stage').append(root); }
    root.className = 'val-board' + (mr ? ' mr-board' : ow ? ' ow-board' : lol ? ' lol-board' : r6 ? ' r6-board' : cod ? ' cod-board' : ''); root.setAttribute('aria-label', gameName + ' series scoreboard');
    root.hidden = s.visible === false;
    const boardWidth = s.showHistory ? 1000 : 560;
    root.style.width = boardWidth + 'px';
    root.replaceChildren();
    const m = s.maps[s.current];
    const key = s.leftTeam === 'B' ? 'B' : 'A';
    const keys = [key, key === 'A' ? 'B' : 'A'];
    const wins = (t) => Number(state.scoreboard['score' + t]) || 0;
    const winner = ['A', 'B'].find((t) => wins(t) >= s.winsRequired);
    const kicker = node('div', 'val-kicker');
    kicker.append(node('span', '', state.scoreboard.round || window.BRAND?.shortName || gameName), node('b', '', `${lol ? 'GAMES' : 'MAPS'} · FIRST TO ${s.winsRequired}`));
    const match = node('div', 'val-match');
    const blocks = keys.map((t, i) => {
      const info = team(state, t), side = node('div', 'val-team' + (i ? ' right' : ''));
      side.style.setProperty('--team-color', info.color); side.style.setProperty('--team-wash', info.color + '40');
      if (info.logoUrl) { const logo = node('img'); logo.src = media(info.logoUrl); logo.alt = ''; logo.addEventListener('error', () => { logo.hidden = true; }); side.append(logo); }
      const copy = node('div', 'val-team-copy');
      const tag = node('b', 'val-team-name', info.tag); tag.title = info.name;
      const roles = !lol && (!modesGame || (cod ? ['Search and Destroy', 'Control'] : mr ? ['Convoy', 'Convergence'] : ['Hybrid', 'Escort']).includes(m.mode));
      const role = lol ? (m.blueTeam ? (m.blueTeam === t ? 'BLUE SIDE' : 'RED SIDE') : 'SIDE REQUIRED') : roles && s.attackingTeam ? (s.attackingTeam === t ? 'ATK' : 'DEF') : 'MAP WINS';
      copy.append(tag, node('span', 'val-team-role', role)); side.append(copy);
      const score = node('b', 'val-score' + (winner === t ? ' winner' : ''), String(wins(t))); score.style.setProperty('--team-color', info.color);
      return { side, score };
    });
    match.append(blocks[0].side, blocks[0].score, blocks[1].score, blocks[1].side);
    const context = node('div', 'val-context' + (m.status === 'paused' ? ' paused' : winner ? ' final' : ''));
    const caption = modesGame ? (m.name || 'MAP NOT SET') : `${lol ? 'GAME' : 'MAP'} ${m.slot}${m.attempt > 1 ? ' / R' + m.attempt : ''} · ${m.name || (lol ? "SUMMONER'S RIFT" : 'MAP NOT SET')}`;
    const status = s.needsReview ? 'AWAITING REVIEW' : winner ? `${team(state, winner).tag} WIN` : m.pause ? `${m.pause.kind} PAUSE` : m.status === 'awaiting-result' ? 'RESULT PENDING' : m.status === 'final' ? 'MAP FINAL' : m.status === 'playing' ? 'LIVE' : m.status === 'void' ? 'VOID' : 'READY';
    root.append(kicker, match);
    if (modesGame) {
      const mode = node('div', 'ow-mode'); mode.append(node('b', '', `MAP ${m.slot}${m.attempt > 1 ? ' / R' + m.attempt : ''} · ${m.mode || 'MODE REQUIRED'}`), node('span', '', m.slot > s.bestOf ? (ow ? 'TIEBREAKER' : 'EXTRA MAP') : `BO${s.bestOf}`)); root.append(mode);
    }
    if (cod) { const edition = node('div', 'series-edition', `${s.config.title || 'TITLE REQUIRED'} · ${s.config.season || 'SEASON REQUIRED'}`); edition.title = edition.textContent; root.append(edition); }
    if (r6) root.append(node('div', 'series-edition', `BO${s.bestOf} · ${m.sides?.phase || 'BOMB'}${m.continuations?.length ? ' · REHOST' : ''}`));
    if (lol) root.append(node('div', 'series-edition', `BO${s.bestOf} · ${s.config.fearless === 'off' ? 'TOURNAMENT DRAFT' : s.config.fearless.toUpperCase() + ' FEARLESS'}${m.draftConfirmed ? ' · DRAFT CONFIRMED' : ''}`));
    context.append(node('b', '', caption), node('span', '', status)); root.append(context);
    if ((ow || mr) && (m.banA || m.banB)) {
      const bans = node('div', 'ow-bans');
      for (const t of keys) { const label = `${team(state, t).tag} BAN · ${m['ban' + t] || '—'}`; const span = node('span', '', label); span.title = label; bans.append(span); }
      root.append(bans);
    }
    if (mr && (m.lockA || m.lockB)) {
      const locks = node('div', 'ow-bans mr-locks');
      for (const t of keys) { const label = `${team(state, t).tag} LOCK · ${m['lock' + t] || '—'}`; const span = node('span', '', label); span.title = label; locks.append(span); }
      root.append(locks);
    }
    if (s.showHistory) {
      const history = node('div', 'val-history');
      const start = Math.max(0, Math.min(s.current - 4, s.maps.length - 9));
      for (const map of s.maps.slice(start, start + 9)) {
        const card = node('div', 'val-map' + (map.id === m.id ? ' current' : '') + (map.status === 'void' ? ' void' : ''));
        const result = map.result;
        const resultText = map.status === 'void' ? 'VOID' : result ? (result.winner ? team(state, result.winner).tag + ' WIN' : 'DRAW') + (!modesGame && result.scoreA != null ? ` ${result.scoreA}–${result.scoreB}` : '') : map.status === 'ready' ? 'UP NEXT' : 'IN PLAY';
        card.append(node('small', '', `${lol ? 'GAME' : 'MAP'} ${map.slot}${map.attempt > 1 ? ' / R' + map.attempt : ''}${modesGame ? ' · ' + (map.mode || 'MODE REQUIRED') : ''}`), node('b', '', map.name || (lol ? "Summoner's Rift" : 'TBD')), node('span', '', resultText));
        if (modesGame) card.append(node('span', 'ow-objective', map.status === 'final' && result?.scoreA != null ? `${result.scoreA}–${result.scoreB}${map.mode === 'Push' ? 'm' : ''}` : '\u00a0'));
        history.append(card);
      }
      root.append(history);
    }
    const pos = state.scoreboard.position || 'bottom-left';
    const scale = Math.min(1.5, Math.max(.75, s.scale || 1));
    const x = Math.max(0, Math.min(800, 1880 - boardWidth * scale, s.offsetX || 0));
    const y = Math.max(0, Math.min(500, s.offsetY || 0));
    root.style.left = root.style.right = root.style.top = root.style.bottom = '';
    if (pos === 'top') { root.style.left = (1920 - boardWidth * scale) / 2 + 'px'; root.style.top = 32 + y + 'px'; root.style.transformOrigin = 'top left'; }
    else {
      root.style[pos.endsWith('right') ? 'right' : 'left'] = 40 + x + 'px';
      root.style[pos.startsWith('top') ? 'top' : 'bottom'] = (pos.startsWith('top') ? 32 : 96) + y + 'px';
      root.style.transformOrigin = (pos.startsWith('top') ? 'top' : 'bottom') + ' ' + (pos.endsWith('right') ? 'right' : 'left');
    }
    root.style.transform = `scale(${scale})`;
    return true;
  }
  window.SeriesBoard = { render };
})();
