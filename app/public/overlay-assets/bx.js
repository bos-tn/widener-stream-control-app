// Broadcast package (test branch): the overlay's own layer for a profile with
// a `broadcast` block. The overlay page loads this file before its own
// script; it defines window.BX only when the profile has the package, and
// the page then hands it every state and message (see BX.init in
// overlay.html).
//
// What it draws, on a fixed 1920 x 1080 stage (bx.css):
//   - the full-screen scenes: Starting Soon, Post-Match, Rosters, Be Right
//     Back, and the package's own Matchup and This Week;
//   - a camera scene per camera of the profile (the camera is an OBS source
//     under this page);
//   - over any scene: the ticker, score pop-ups, the lower third, and the
//     frames of the camera windows that OBS shows over the game.
//
// Data: the match state and Rocket League series from the page, and the
// server's `bx` message (broadcast.js): this week's other matches, the
// ticker and pop-up settings, the lower third, the camera windows.
// Everything typed by an operator or read from a league site is set with
// textContent, never as markup.
(function () {
  'use strict';
  const BRAND = window.BRAND || {};
  if (!BRAND.broadcast) return;

  const CAMERAS = BRAND.broadcast.cameras || [];
  const FULL = ['starting-soon', 'post-match', 'roster', 'brb', 'versus', 'schedule'];
  const VIEWS = (BRAND.broadcast.scenes || []).concat(CAMERAS.map((c) => 'cam-' + c.id));
  const STAGE = { w: 1920, h: 1080 };

  let O = null;       // the page's side (BX.init)
  let state = null;   // the match state
  let view = '';      // the view this page shows
  let kind = '';      // 'full' | 'cam' | 'game' | 'pass'
  let bx = { matches: [], week: null, settings: null, lower: { on: false, id: 0 }, cams: [], layout: { reserved: {}, pip: {} } };

  // --- Helpers -----------------------------------------------------------------
  function h(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function refs(box) {
    const out = {};
    box.querySelectorAll('[data-r]').forEach((n) => { out[n.dataset.r] = n; });
    return out;
  }
  function rgba(hex, a) {
    let c = String(hex || '').replace('#', '');
    if (c.length === 3) c = c.split('').map((x) => x + x).join('');
    const n = parseInt(c, 16);
    return isNaN(n) ? `rgba(0,84,184,${a})` : `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  // A team's colour on an element: the colour, the ink that reads on it, and
  // two washes of it.
  function tint(el, color) {
    el.style.setProperty('--c', color);
    el.style.setProperty('--ink', O.inkFor(color));
    el.style.setProperty('--c-soft', rgba(color, 0.3));
    el.style.setProperty('--c-mid', rgba(color, 0.52));
  }
  function setImg(img, src) {
    if (src) { if (img.getAttribute('src') !== src) img.src = src; img.hidden = false; }
    else { img.removeAttribute('src'); img.hidden = true; }
  }
  // "York College of Pennsylvania" is YCP: joining words don't count.
  function initials(name) {
    return String(name || '').replace(/\s+(University|Univ\.?|College)\s*$/i, '').split(/\s+/)
      .filter((w) => w && !/^(of|the|and|at|for|de|&)$/i.test(w)).map((w) => w[0]).join('').slice(0, 4).toUpperCase();
  }
  function teamOf(k) {
    const t = (state && state['team' + k]) || {};
    return {
      key: k, name: t.name || '', tag: t.tag || initials(t.name) || k, ownTag: t.tag || '',
      color: O.safeColor(t.color, BRAND.teamColors[k]), logo: t.logoUrl ? O.mediaUrl(t.logoUrl) : '',
      players: (t.players || []).filter((p) => p && (p.gamertag || p.name)), raw: t,
    };
  }
  function bothTeams() { return !!(state && state.teamA && state.teamA.name && state.teamB && state.teamB.name); }
  function series() {
    const sb = (state && state.scoreboard) || {};
    const bestOf = O.clampInt(sb.bestOf, 1, 9, 3);
    const need = Math.ceil(bestOf / 2);
    const a = O.clampInt(sb.scoreA, 0, 99, 0);
    const b = O.clampInt(sb.scoreB, 0, 99, 0);
    return { a, b, bestOf, need, decided: a >= need || b >= need, any: a + b > 0, round: sb.round || '', unit: String(sb.unit || 'Game').trim() || 'Game', rl: sb.style === 'rl' };
  }
  function viewText(v) { return ((state && state.views) || {})[v] || {}; }
  function seriesLine() {
    const s = series();
    return [s.round, 'Best of ' + s.bestOf].filter(Boolean).join(' · ');
  }

  // Dates as the scenes say them.
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function fmtTime(d) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  function dayWord(d) {
    const now = new Date();
    if (sameDay(d, now)) return d.getHours() >= 17 ? 'Tonight' : 'Today';
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  }
  function startOf(m) { const d = m.start ? new Date(m.start) : null; return d && !isNaN(d) ? d : null; }
  function isToday(m) { const d = startOf(m); return m.state === 'live' || (!!d && sameDay(d, new Date())); }
  const GAME_SHORT = [[/smash/i, 'Smash'], [/league of legends/i, 'League'], [/rainbow six/i, 'R6 Siege'], [/call of duty/i, 'Call of Duty'], [/counter-?strike/i, 'CS2']];
  function shortGame(name) {
    const n = String(name || '');
    const hit = GAME_SHORT.find(([re]) => re.test(n));
    return hit ? hit[1] : n;
  }
  function shortTeam(name) { return O.shortTeamName(name) || name; }

  // --- The layer ---------------------------------------------------------------------
  const MU = `
    <div class="bx-mu-team a"><img class="bx-mu-logo" alt="" hidden><div class="bx-mu-who"><b class="bx-mu-name"></b><span class="bx-mu-rec"></span></div><b class="bx-mu-score"></b></div>
    <div class="bx-mu-mid">VS</div>
    <div class="bx-mu-team b"><img class="bx-mu-logo" alt="" hidden><div class="bx-mu-who"><b class="bx-mu-name"></b><span class="bx-mu-rec"></span></div><b class="bx-mu-score"></b></div>`;
  const COUNT = '<div class="bx-count-label" data-r="countLabel"></div><div class="bx-digits" data-r="digits"></div><div class="bx-count-done" data-r="countDone"></div>';
  const ALSO = '<div class="bx-also-head"><b data-r="alsoTitle"></b><span data-r="alsoDots"></span></div><div class="bx-also-rows" data-r="alsoRows"></div>';
  const HERO = `
    <div class="bx-hero-left">
      <div class="bx-kicker" data-r="kickerBox" data-in="left" style="--d:120ms"><i></i><span data-r="kicker"></span></div>
      <h1 class="bx-title" data-r="title" style="--d:200ms"></h1>
      <div class="bx-sub" data-r="sub" data-in="fade" style="--d:560ms"></div>
      <div class="bx-mu" data-r="mu" data-in="up" style="--d:600ms" hidden>${MU}</div>
      <div class="bx-count" data-r="count" data-in="up" style="--d:740ms">${COUNT}</div>
      <div class="bx-next" data-r="next" data-in="fade" style="--d:940ms"></div>
    </div>
    <div class="bx-hero-right">
      <div class="bx-video" data-r="video" data-in="right" style="--d:340ms"><span class="bx-video-tag">Highlights</span><i class="bx-video-c bl"></i><i class="bx-video-c br"></i><div data-r="slot"></div></div>
      <div class="bx-art" data-r="art" data-in="pop" style="--d:340ms" hidden><img alt=""></div>
      <div class="bx-also" data-r="also" data-in="right" style="--d:560ms" hidden>${ALSO}</div>
    </div>`;
  const RESULT_SIDE = (k) => `
    <div class="bx-pm-team ${k}" data-r="team${k.toUpperCase()}" data-in="${k === 'a' ? 'left' : 'right'}" style="--d:260ms">
      <div class="bx-pm-logo"><img alt="" hidden><b></b></div>
      <div class="bx-pm-who"><span class="bx-pm-tag"></span><div class="bx-pm-name"></div></div>
    </div>`;
  const RESULT = `
    <div class="bx-pm-result">
      <div class="bx-pm-kick" data-r="resKick" data-in="down" style="--d:120ms"></div>
      <div class="bx-pm-line">
        ${RESULT_SIDE('a')}
        <div class="bx-pm-score" data-in="pop" style="--d:520ms"><b data-r="scoreA"></b><i></i><b data-r="scoreB"></b></div>
        ${RESULT_SIDE('b')}
      </div>
      <div class="bx-pm-games" data-r="games" data-in="up" style="--d:760ms"></div>
    </div>`;
  const RO_TEAM = (k) => `
    <div class="bx-ro-team ${k}" data-r="team${k.toUpperCase()}">
      <div class="bx-ro-th" data-in="${k === 'a' ? 'left' : 'right'}" style="--d:260ms"><img class="bx-ro-logo" alt="" hidden><div class="bx-ro-who"><b class="bx-ro-name"></b><span class="bx-ro-tag"></span></div></div>
      <div class="bx-ro-list"></div>
    </div>`;
  const VS_SIDE = (k) => `
    <div class="bx-vs-side ${k}" data-r="side${k.toUpperCase()}">
      <div class="bx-vs-wash"></div>
      <div class="bx-vs-body">
        <div class="bx-vs-logo" data-in="pop" style="--d:760ms"><img alt="" hidden><b></b></div>
        <div class="bx-vs-name" data-in="up" style="--d:900ms"><span></span></div>
        <div class="bx-vs-meta" data-in="up" style="--d:1000ms"><b></b><span></span></div>
        <div class="bx-vs-players" data-in="up" style="--d:1100ms"></div>
      </div>
    </div>`;

  const root = h('div', 'bx-root');
  root.id = 'bx-root';
  root.innerHTML = `
    <div class="bx-stage" id="bx-stage">
      <div class="bx-camfill"><span>Camera feed shows here</span></div>
      <div class="bx-atmo"></div>

      <section class="bx-view bx-ss" data-view="starting-soon">${HERO}</section>
      <section class="bx-view bx-pm" data-view="post-match">${RESULT}${HERO}</section>

      <section class="bx-view bx-ro" data-view="roster">
        <div class="bx-ro-head" data-in="down" style="--d:120ms"><h2 data-r="title"></h2><span data-r="line"></span></div>
        ${RO_TEAM('a')}
        <div class="bx-ro-mid" data-in="fade" style="--d:420ms"><div class="bx-diamond"><b>VS</b></div></div>
        ${RO_TEAM('b')}
      </section>

      <section class="bx-view bx-vs" data-view="versus">
        ${VS_SIDE('a')}${VS_SIDE('b')}
        <div class="bx-vs-flash"></div>
        <div class="bx-vs-slash"></div>
        <div class="bx-vs-mid">
          <div class="bx-kicker" data-r="kickerBox" data-in="down" style="--d:1000ms"><i></i><span data-r="kicker"></span></div>
          <div class="bx-vs-emblem"><b>VS</b></div>
          <div class="bx-vs-info" data-in="up" style="--d:1050ms"><b data-r="game"></b><span data-r="line"></span></div>
          <div class="bx-count small" data-r="count" data-in="up" style="--d:1150ms">${COUNT}</div>
        </div>
      </section>

      <section class="bx-view bx-sch" data-view="schedule">
        <div class="bx-sch-head">
          <h1 class="bx-title" data-r="title" style="--d:160ms"></h1>
          <div class="bx-sch-page" data-in="right" style="--d:320ms"><b data-r="pageName"></b><span data-r="range"></span><div class="bx-sch-dots" data-r="dots"></div></div>
        </div>
        <div class="bx-sch-rows" data-r="rows"></div>
        <div class="bx-sch-empty" data-r="empty"></div>
      </section>

      <section class="bx-view bx-brb" data-view="brb">
        <div class="bx-brb-left">
          <div class="bx-brb-kick" data-in="left" style="--d:120ms"><span class="bx-bars"><i></i><i></i><i></i><i></i></span><span data-r="kick"></span></div>
          <h1 class="bx-title" data-r="title" style="--d:200ms"></h1>
          <div class="bx-brb-subrow"><div class="bx-brb-bar" data-in="grow" style="--d:520ms"></div><div class="bx-brb-sub" data-r="sub" data-in="fade" style="--d:700ms"></div></div>
          <div class="bx-mu" data-r="mu" data-in="up" style="--d:780ms" hidden>${MU}</div>
        </div>
        <div class="bx-brb-right">
          <div class="bx-brb-art" data-in="pop" style="--d:340ms"><img data-r="art" alt=""></div>
          <div class="bx-also" data-r="also" data-in="right" style="--d:620ms" hidden>${ALSO}</div>
        </div>
      </section>

      <section class="bx-view bx-cam" data-view="cam">
        <div class="bx-cam-shade"></div>
        <i class="bx-cam-c tl"></i><i class="bx-cam-c tr"></i><i class="bx-cam-c bl"></i><i class="bx-cam-c br"></i>
        <div class="bx-cam-bug">
          <div class="bx-cam-bug-brand"><img data-r="logo" alt=""></div>
          <div class="bx-cam-bug-name" data-r="name"></div>
          <div class="bx-cam-bug-live" data-r="liveBox"><i></i><span data-r="live"></span></div>
        </div>
        <div class="bx-cam-place" data-r="place"></div>
        <div class="bx-cam-score" data-r="score" hidden>
          <div class="bx-cs-team a" data-r="csA"><img alt="" hidden><span></span></div><b class="bx-cs-score" data-r="csScoreA"></b>
          <div class="bx-cs-mid"><b data-r="csGame"></b><span data-r="csLine"></span></div>
          <b class="bx-cs-score" data-r="csScoreB"></b><div class="bx-cs-team b" data-r="csB"><img alt="" hidden><span></span></div>
        </div>
        <div class="bx-cam-sting"><i class="a"></i><i class="b"></i><b data-r="sting"></b></div>
      </section>

      <header class="bx-mast">
        <div class="bx-mast-left" data-in="left">
          <div class="bx-mast-brand"><img class="bx-mast-logo" data-r="logo" alt=""><div class="bx-mast-name"><b data-r="brand"></b><span data-r="tagline"></span></div></div>
          <div class="bx-mast-game" data-r="game"></div>
        </div>
        <div class="bx-mast-right" data-in="right">
          <div class="bx-mast-info" data-r="info"></div>
          <div class="bx-mast-clock" data-r="clock"></div>
        </div>
        <i class="bx-mast-line" data-in="grow" style="--d:200ms"></i>
      </header>

      <footer class="bx-rail" data-in="up" style="--d:300ms">
        <div class="bx-rail-tag" data-r="tag"></div>
        <div class="bx-rail-crawl" data-r="crawl"><div class="bx-rail-track" data-r="track"></div></div>
        <div class="bx-rail-static" data-r="static"></div>
        <div class="bx-rail-social" data-r="social"></div>
      </footer>

      <div class="bx-pips" id="bx-pips"></div>
      <div class="bx-lower" id="bx-lower">
        <div class="bx-lower-mark"><img alt=""></div>
        <div class="bx-lower-text"><div class="bx-lower-title"></div><div class="bx-lower-sub"><b></b><span></span></div></div>
      </div>
      <div class="bx-alerts" id="bx-alerts"></div>
    </div>`;
  document.body.appendChild(root);

  const stage = root.querySelector('#bx-stage');
  const sections = {};
  root.querySelectorAll('.bx-view').forEach((s) => { sections[s.dataset.view] = { box: s, r: refs(s) }; });
  const mast = refs(root.querySelector('.bx-mast'));
  const railBox = root.querySelector('.bx-rail');
  const rail = refs(railBox);
  const pipsBox = root.querySelector('#bx-pips');
  const lowerBox = root.querySelector('#bx-lower');
  const alertsBox = root.querySelector('#bx-alerts');

  function sectionFor(v) { return v.startsWith('cam-') ? sections.cam : sections[v] || null; }
  function kindOf(v) { return FULL.includes(v) ? 'full' : v.startsWith('cam-') ? 'cam' : v === 'scoreboard' ? 'game' : 'pass'; }

  // --- Headlines ---------------------------------------------------------------------
  // A headline as words that rise one after another, stepped down in size
  // until it fits `lines` lines of its box (one line for a nowrap headline).
  function setTitle(el, text, opt) {
    text = String(text || '').trim();
    if (el.dataset.text !== text) {
      el.dataset.text = text;
      el.textContent = '';
      const words = text.split(/\s+/).filter(Boolean);
      words.forEach((w, i) => {
        const s = h('span', 'w' + (opt.hiLast && words.length > 1 && i === words.length - 1 ? ' hi' : ''));
        s.style.setProperty('--i', String(i));
        s.appendChild(h('i', '', w));
        el.append(s, ' ');
      });
    }
    el.style.fontSize = '';
    const cs = getComputedStyle(el);
    let size = parseFloat(cs.fontSize);
    const ratio = parseFloat(cs.lineHeight) / size || 1;
    const over = () => el.offsetHeight > size * ratio * opt.lines + 8 || el.scrollWidth > el.clientWidth + 2;
    while (size > opt.min && over()) { size -= 4; el.style.fontSize = size + 'px'; }
  }
  // Plain text stepped down until it fits `lines` lines.
  function fitLines(el, lines, min) {
    el.style.fontSize = '';
    const cs = getComputedStyle(el);
    let size = parseFloat(cs.fontSize);
    const ratio = parseFloat(cs.lineHeight) / size || 1;
    while (size > min && (el.offsetHeight > size * ratio * lines + 6 || el.scrollWidth > el.clientWidth + 2)) { size -= 2; el.style.fontSize = size + 'px'; }
  }

  // --- Countdown ----------------------------------------------------------------------
  // One tile per digit. A digit that changes rolls over; the rest stay put.
  function drawDigits(box, text) {
    const shape = text.replace(/\d/g, '0');
    if (box.dataset.shape !== shape) {
      box.dataset.shape = shape;
      box.textContent = '';
      text.split('').forEach((ch) => {
        if (ch === ':') { box.appendChild(h('span', 'bx-colon', ':')); return; }
        const tile = h('span', 'bx-digit');
        tile.dataset.v = ch;
        tile.appendChild(h('b', '', ch));
        box.appendChild(tile);
      });
      return;
    }
    const tiles = box.children;
    text.split('').forEach((ch, i) => {
      const tile = tiles[i];
      if (ch === ':' || tile.dataset.v === ch) return;
      tile.dataset.v = ch;
      // A page that isn't being drawn (its scene is off program) just swaps.
      if (document.hidden) { tile.textContent = ''; tile.appendChild(h('b', '', ch)); return; }
      Array.from(tile.children).forEach((old) => { old.className = 'out'; setTimeout(() => old.remove(), 440); });
      tile.appendChild(h('b', 'in', ch));
    });
  }
  function drawCount(r, label, doneText) {
    if (!r || !r.count) return;
    const end = O.countdownEnd;
    let diff = end - new Date();
    if (isNaN(diff)) diff = 0;
    const done = diff <= 0;
    // At zero the words that take the digits' place stand alone.
    r.countLabel.textContent = done ? '' : label;
    r.countDone.textContent = doneText || '';
    r.count.hidden = done && !doneText;
    r.count.classList.toggle('done', done);
    r.count.classList.toggle('last', !done && diff <= 10500);
    if (done) return;
    const hrs = Math.floor(diff / 3.6e6);
    const m = Math.floor((diff % 3.6e6) / 6e4);
    const s = Math.floor((diff % 6e4) / 1000);
    drawDigits(r.digits, (hrs > 0 ? hrs + ':' : '') + O.pad(m) + ':' + O.pad(s));
  }
  function tickCount() {
    if (!state || !O) return;
    if (view === 'starting-soon') drawCount(sections['starting-soon'].r, 'Match starts in', 'Starting shortly');
    if (view === 'post-match') drawCount(sections['post-match'].r, 'Stream ends in', '');
    if (view === 'versus') drawCount(sections.versus.r, 'Starts in', '');
  }
  setInterval(tickCount, 250);

  // --- The match on stream as a strip ------------------------------------------------
  function drawMu(box, scored) {
    const s = series();
    box.hidden = !bothTeams();
    if (box.hidden) return;
    box.classList.toggle('scored', scored);
    const names = [];
    ['A', 'B'].forEach((k) => {
      const t = teamOf(k);
      const el = box.querySelector('.bx-mu-team.' + k.toLowerCase());
      tint(el, t.color);
      setImg(el.querySelector('.bx-mu-logo'), t.logo);
      // One line where the name fits (shortened, smaller, or as its short
      // name); a long name with no short name takes two lines instead.
      const name = el.querySelector('.bx-mu-name');
      name.classList.remove('two-line');
      const how = O.fitTeamName(name, t.name, { min: 26, tag: t.ownTag });
      if (how === 'words' || how === 'cut') {
        name.style.fontSize = '';
        name.style.textOverflow = '';
        name.classList.add('two-line');
        name.textContent = shortTeam(t.name);
        fitLines(name, 2, 17);
      } else names.push(name);
      el.querySelector('.bx-mu-rec').textContent = [t.ownTag, O.recordText(state, t.raw)].filter(Boolean).join(' · ');
      el.querySelector('.bx-mu-score').textContent = scored ? String(k === 'A' ? s.a : s.b) : '';
      el.classList.toggle('lost', scored && s.decided && (k === 'A' ? s.a < s.b : s.b < s.a));
    });
    O.matchNameSizes(names);
    box.querySelector('.bx-mu-mid').textContent = scored ? (s.decided ? 'Final' : 'Series') : 'VS';
  }

  // --- Other matches -----------------------------------------------------------------
  function others() {
    const rank = (m) => (m.state === 'live' ? 0 : isToday(m) ? 1 : 2);
    return bx.matches.filter((m) => !m.onStream).slice().sort((x, y) => rank(x) - rank(y));
  }
  function stateChip(m, big) {
    const chip = h('span', 'bx-mrow-state');
    const d = startOf(m);
    if (m.state === 'final') { chip.classList.add('final'); chip.textContent = 'Final'; }
    else if (m.state === 'live') { chip.classList.add('live'); chip.append(h('i'), m.note || 'Live'); }
    else if (big) chip.textContent = m.note || '';
    else chip.textContent = d ? (sameDay(d, new Date()) ? fmtTime(d) : dayWord(d) + ' ' + fmtTime(d).replace(':00', '')) : (m.note || '');
    if (!chip.textContent) chip.style.visibility = 'hidden';
    return chip;
  }
  // One match as a row. `big` is the This Week scene's row: a day and time
  // column in front and full names.
  function matchRow(m, i, big) {
    const row = h('div', 'bx-mrow' + (big ? ' big' : '') + (m.home ? ' home' : ''));
    row.style.setProperty('--i', String(i));
    const d = startOf(m);
    if (big) {
      const when = h('div', 'bx-mrow-when');
      when.append(h('b', '', d ? dayWord(d) : '–'), h('span', '', d ? fmtTime(d) : ''));
      row.appendChild(when);
    }
    const game = h('div', 'bx-mrow-game');
    game.append(h('span', '', big ? m.game : shortGame(m.game)), h('small', '', [m.league, big ? m.round : ''].filter(Boolean).join(' · ')));
    const final = m.state === 'final';
    const side = (t, k, other) => {
      const el = h('div', 'bx-mrow-team ' + k + (final && t.score < other.score ? ' lost' : ''));
      const img = h('img'); img.alt = '';
      setImg(img, t.logo ? O.mediaUrl(t.logo) : '');
      const name = h('span', '', t.name);
      name.dataset.name = t.name;
      name.dataset.tag = t.tag || '';
      if (k === 'a') el.append(name, img); else el.append(img, name);
      return el;
    };
    const score = h('div', 'bx-mrow-score');
    if (m.state === 'upcoming') { score.classList.add('vs'); score.textContent = 'VS'; }
    else {
      score.append(h('b', final && m.a.score < m.b.score ? 'dim' : '', String(m.a.score)), h('i'), h('b', final && m.b.score < m.a.score ? 'dim' : '', String(m.b.score)));
    }
    row.append(game, side(m.a, 'a', m.b), score, side(m.b, 'b', m.a), stateChip(m, big));
    return row;
  }
  // Names are fitted once their rows are in the page.
  function fitRowNames(box) {
    box.querySelectorAll('.bx-mrow-team span').forEach((n) => { O.fitTeamName(n, n.dataset.name, { min: n.closest('.big') ? 22 : 16, tag: n.dataset.tag }); });
  }

  // The "other matches" card: three rows at a time, turning over.
  const ALSO_ROWS = 3;
  const ALSO_EVERY = 8000;
  const alsoState = { page: 0, sig: '', timer: 0 };
  function drawAlso(r, force) {
    if (!r || !r.also) return false;
    const list = others();
    r.also.hidden = !list.length;
    if (!list.length) return false;
    const pages = Math.ceil(list.length / ALSO_ROWS);
    if (alsoState.page >= pages) alsoState.page = 0;
    const rows = list.slice(alsoState.page * ALSO_ROWS, alsoState.page * ALSO_ROWS + ALSO_ROWS);
    const sig = JSON.stringify([view, alsoState.page, rows]);
    if (!force && sig === alsoState.sig) return true;
    alsoState.sig = sig;
    r.alsoTitle.textContent = rows.every(isToday) ? 'Also ' + (new Date().getHours() >= 17 ? 'tonight' : 'today') : 'This week';
    r.alsoDots.textContent = '';
    if (pages > 1) for (let i = 0; i < pages; i++) r.alsoDots.appendChild(h('i', i === alsoState.page ? 'on' : ''));
    r.alsoRows.textContent = '';
    rows.forEach((m, i) => r.alsoRows.appendChild(matchRow(m, i, false)));
    fitRowNames(r.alsoRows);
    return true;
  }
  function turnAlso() {
    const sec = sectionFor(view);
    if (!sec || !sec.r.also || document.hidden) return;
    const pages = Math.ceil(others().length / ALSO_ROWS);
    if (pages < 2) return;
    alsoState.page = (alsoState.page + 1) % pages;
    drawAlso(sec.r, true);
  }
  setInterval(turnAlso, ALSO_EVERY);

  // --- Scenes -------------------------------------------------------------------------
  function drawHero(v) {
    const { box, r } = sections[v];
    const vt = viewText(v);
    const post = v === 'post-match';
    const s = series();
    const result = post && s.any && bothTeams();
    box.classList.toggle('has-result', result);
    // The panel's Layout setting: the video on the left, the text on the right.
    box.classList.toggle('flip', String(state.layout || '').toLowerCase() === 'left');
    r.kicker.textContent = vt.status || '';
    r.kickerBox.classList.toggle('empty', !vt.status);
    setTitle(r.title, vt.title || '', { lines: 2, min: result ? 48 : 64, hiLast: true });
    // A subtitle that only repeats the matchup is dropped beside the strip.
    const a = teamOf('A').name.toLowerCase(), b = teamOf('B').name.toLowerCase();
    const sub = String(vt.subtitle || '').trim();
    const dup = bothTeams() && [a + ' vs ' + b, b + ' vs ' + a, 'vs ' + b, 'vs ' + a].includes(sub.toLowerCase());
    r.sub.textContent = dup ? '' : sub;
    drawMu(r.mu, post && s.any);
    r.next.textContent = state.next || '';
    // With nothing to play (no video for the game, not downloaded yet, or
    // failed) the artwork takes the panel's place. A page opened outside OBS
    // keeps the panel: its placeholder shows the download.
    const video = state.montage !== false && (O.clip || O.backdrop);
    r.video.hidden = !video;
    r.art.hidden = video;
    if (video && O.montage.parentNode !== r.slot) r.slot.appendChild(O.montage);
    if (!video) setImg(r.art.querySelector('img'), BRAND.mascot || BRAND.logo);
    drawAlso(r);
    if (result) drawResult(r, s);
    tickCount();
  }

  function drawResult(r, s) {
    r.resKick.textContent = s.decided ? 'Final' : 'Series score';
    const names = [];
    ['A', 'B'].forEach((k) => {
      const t = teamOf(k);
      const el = r['team' + k];
      const mine = k === 'A' ? s.a : s.b, theirs = k === 'A' ? s.b : s.a;
      tint(el, t.color);
      el.classList.toggle('win', s.decided && mine > theirs);
      el.classList.toggle('lose', s.decided && mine < theirs);
      setImg(el.querySelector('img'), t.logo);
      el.querySelector('.bx-pm-logo b').textContent = t.logo ? '' : t.tag;
      el.querySelector('.bx-pm-tag').textContent = s.decided && mine > theirs ? 'Winner' : t.tag;
      const name = el.querySelector('.bx-pm-name');
      name.textContent = t.name;
      fitLines(name, 2, 34);
      names.push(name);
      const score = r['score' + k];
      score.textContent = String(mine);
      score.style.setProperty('--c', t.color);
      score.className = s.decided && mine < theirs ? 'dim' : '';
    });
    O.matchNameSizes(names);
    // Game by game, when the board kept a record of the series (Rocket League).
    r.games.textContent = '';
    const games = (s.rl && O.series && O.series.games) || [];
    games.slice(0, 9).forEach((g, i) => {
      const blueIsA = g.blue !== 'B';
      const goals = blueIsA ? [g.goals[0], g.goals[1]] : [g.goals[1], g.goals[0]];
      const aWon = (g.winner === 0) === blueIsA;
      const chip = h('div', 'bx-pm-game');
      chip.style.setProperty('--c', teamOf(aWon ? 'A' : 'B').color);
      const score = h('b');
      score.append(h('u', aWon ? 'w' : '', String(goals[0] || 0)), ' – ', h('u', aWon ? '' : 'w', String(goals[1] || 0)));
      chip.append(h('small', '', s.unit + ' ' + (i + 1)), score, h('em', '', g.overtime ? 'OT' : ''));
      r.games.appendChild(chip);
    });
  }

  function drawRoster() {
    const { r } = sections.roster;
    r.title.textContent = viewText('roster').title || 'Starting Lineups';
    r.line.textContent = [state.team, seriesLine()].filter(Boolean).join(' · ');
    const teams = { A: teamOf('A'), B: teamOf('B') };
    const most = Math.max(1, teams.A.players.length, teams.B.players.length);
    // Both lists share a row height: the room under the headers, split by
    // the longer roster. A short roster gets taller rows, and the two blocks
    // sit a little above the middle of the room they have.
    const cap = most <= 3 ? 118 : most <= 5 ? 102 : 92;
    const rh = Math.max(46, Math.min(cap, Math.floor((606 - 10 * (most - 1)) / most)));
    const used = 126 + 14 + most * rh + 10 * (most - 1);
    sections.roster.box.style.setProperty('--pad', Math.max(0, Math.round((752 - used) * 0.4)) + 'px');
    sections.roster.box.style.setProperty('--used', used + 'px');
    const names = [];
    ['A', 'B'].forEach((k) => {
      const t = teams[k];
      const el = r['team' + k];
      tint(el, t.color);
      setImg(el.querySelector('.bx-ro-logo'), t.logo);
      const name = el.querySelector('.bx-ro-name');
      O.fitTeamName(name, t.name || 'Team ' + k, { min: 28, tag: t.ownTag });
      names.push(name);
      el.querySelector('.bx-ro-tag').textContent = [t.ownTag, O.recordText(state, t.raw)].filter(Boolean).join(' · ');
      const list = el.querySelector('.bx-ro-list');
      const sig = JSON.stringify([t.players, rh]);
      if (list.dataset.sig === sig) return;
      list.dataset.sig = sig;
      list.style.setProperty('--rh', rh + 'px');
      list.textContent = '';
      t.players.forEach((p, i) => {
        const row = h('div', 'bx-ro-p');
        row.style.setProperty('--i', String(i));
        const tag = p.gamertag || p.name || '';
        const real = p.name && p.gamertag && p.name !== p.gamertag ? p.name : '';
        row.append(h('span', 'n', O.pad(i + 1)), h('span', 'g', tag), h('span', 'r', real));
        list.appendChild(row);
      });
    });
    O.matchNameSizes(names);
  }

  function drawVersus() {
    const { r } = sections.versus;
    const vt = viewText('versus');
    r.kicker.textContent = vt.title || '';
    r.kickerBox.classList.toggle('empty', !vt.title);
    r.game.textContent = state.team || '';
    r.line.textContent = seriesLine();
    const names = [];
    ['A', 'B'].forEach((k) => {
      const t = teamOf(k);
      const el = r['side' + k];
      tint(el, t.color);
      const logo = el.querySelector('.bx-vs-logo');
      setImg(logo.querySelector('img'), t.logo);
      logo.querySelector('b').textContent = t.logo ? '' : t.tag;
      const name = el.querySelector('.bx-vs-name span');
      name.textContent = t.name || 'Team ' + k;
      fitLines(name, 2, 36);
      names.push(name);
      const meta = el.querySelector('.bx-vs-meta');
      meta.querySelector('b').textContent = t.ownTag;
      meta.querySelector('span').textContent = O.recordText(state, t.raw);
      const list = el.querySelector('.bx-vs-players');
      list.textContent = '';
      t.players.slice(0, 8).forEach((p) => list.appendChild(h('span', '', p.gamertag || p.name)));
    });
    O.matchNameSizes(names);
    tickCount();
  }

  // This Week: pages of seven rows. With more than one page the home team's
  // matches come first, then the rest game by game.
  const SCH_ROWS = 7;
  const SCH_EVERY = 11000;
  const schState = { page: 0, sig: '' };
  function schedulePages() {
    const all = bx.matches;
    const pages = [];
    const chunk = (label, list) => { for (let i = 0; i < list.length; i += SCH_ROWS) pages.push({ label, rows: list.slice(i, i + SCH_ROWS) }); };
    if (all.length <= SCH_ROWS) { if (all.length) chunk('All games', all); return pages; }
    const home = all.filter((m) => m.home);
    const rest = all.filter((m) => !m.home);
    if (home.length) chunk((BRAND.shortName || 'Home') + ' matches', home);
    if (rest.length <= SCH_ROWS) { if (rest.length) chunk(home.length ? 'Around the league' : 'All games', rest); return pages; }
    const byGame = new Map();
    rest.forEach((m) => { if (!byGame.has(m.game)) byGame.set(m.game, []); byGame.get(m.game).push(m); });
    byGame.forEach((list, game) => chunk(game || 'Matches', list));
    return pages;
  }
  function weekRange() {
    if (!bx.week) return '';
    const f = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const from = new Date(bx.week.from);
    const to = new Date(new Date(bx.week.to).getTime() - 1000);
    return f(from) + ' – ' + f(to);
  }
  function drawSchedule(force) {
    const { r } = sections.schedule;
    setTitle(r.title, viewText('schedule').title || 'This Week', { lines: 1, min: 48, hiLast: true });
    const pages = schedulePages();
    if (schState.page >= pages.length) schState.page = 0;
    const page = pages[schState.page];
    r.empty.textContent = page ? '' : (O.backdrop ? 'No matches this week. Add them on the Broadcast page.' : '');
    r.range.textContent = weekRange();
    r.pageName.textContent = page ? page.label : '';
    const sig = JSON.stringify([schState.page, page]);
    if (!force && sig === schState.sig) return;
    schState.sig = sig;
    r.dots.textContent = '';
    if (pages.length > 1) pages.forEach((p, i) => r.dots.appendChild(h('i', i === schState.page ? 'on' : '')));
    r.rows.textContent = '';
    if (!page) return;
    page.rows.forEach((m, i) => r.rows.appendChild(matchRow(m, i, true)));
    fitRowNames(r.rows);
  }
  setInterval(() => {
    if (view !== 'schedule' || document.hidden) return;
    const pages = schedulePages();
    if (pages.length < 2) return;
    schState.page = (schState.page + 1) % pages.length;
    drawSchedule(true);
  }, SCH_EVERY);

  function drawBrb() {
    const { box, r } = sections.brb;
    const vt = viewText('brb');
    const s = series();
    r.kick.textContent = [state.team, s.round].filter(Boolean).join(' · ') || BRAND.tagline || '';
    setTitle(r.title, vt.title || '', { lines: 1, min: 60, hiLast: false });
    r.sub.textContent = vt.subtitle || '';
    drawMu(r.mu, s.any);
    setImg(r.art, BRAND.mascot || BRAND.logo);
    box.classList.toggle('no-also', !drawAlso(r));
  }

  function drawCam() {
    const { r } = sections.cam;
    const cam = CAMERAS.find((c) => 'cam-' + c.id === view) || {};
    const vt = viewText(view);
    const name = vt.title || cam.label || 'Camera';
    setImg(r.logo, BRAND.logo);
    r.name.textContent = name;
    r.sting.textContent = name;
    r.live.textContent = vt.status || '';
    r.liveBox.classList.toggle('empty', !vt.status);
    r.place.textContent = vt.subtitle || '';
    // The score stays in view while the camera is up.
    const s = series();
    r.score.hidden = !bothTeams();
    if (r.score.hidden) return;
    ['A', 'B'].forEach((k) => {
      const t = teamOf(k);
      const el = r['cs' + k];
      tint(el, t.color);
      setImg(el.querySelector('img'), t.logo);
      el.querySelector('span').textContent = t.tag;
      const score = r['csScore' + k];
      tint(score, t.color);
      score.textContent = String(k === 'A' ? s.a : s.b);
    });
    r.csGame.textContent = shortGame(state.team) || 'Series';
    r.csLine.textContent = s.decided ? 'Final' : s.unit + ' ' + Math.min(s.a + s.b + 1, s.bestOf) + ' · Bo' + s.bestOf;
  }

  function drawMast() {
    setImg(mast.logo, BRAND.logo);
    mast.brand.textContent = BRAND.name || '';
    mast.tagline.textContent = BRAND.tagline || '';
    mast.game.textContent = (view !== 'schedule' && state && state.team) || '';
    mast.info.textContent = state && view !== 'schedule' ? seriesLine() : weekRange();
    mast.clock.textContent = fmtTime(new Date());
  }
  setInterval(() => { mast.clock.textContent = fmtTime(new Date()); }, 5000);

  // --- Ticker ---------------------------------------------------------------------------
  // The rail's crawl: this week's other matches, then the operator's lines.
  // One set of items is repeated until it is wider than the rail, and the
  // whole run twice, so sliding by half its length loops without a seam.
  const CRAWL_SPEED = 96; // stage pixels a second
  let tickerSig = '';
  let socialTimer = 0;
  let socialAt = 0;
  function tickerItems() {
    const out = [];
    others().forEach((m) => {
      const item = h('span', 'bx-tk');
      const d = startOf(m);
      const final = m.state === 'final';
      const logo = (t) => { const img = h('img'); img.alt = ''; setImg(img, t.logo ? O.mediaUrl(t.logo) : ''); return img; };
      item.appendChild(h('span', 'bx-tk-game', shortGame(m.game)));
      const aLost = final && m.a.score < m.b.score, bLost = final && m.b.score < m.a.score;
      item.append(logo(m.a), h('span', 'bx-tk-name' + (aLost ? ' dim' : ''), shortTeam(m.a.name)));
      if (m.state === 'upcoming') item.appendChild(h('span', 'bx-tk-vs', 'VS'));
      else item.append(h('span', 'bx-tk-score' + (aLost ? ' dim' : ''), String(m.a.score)), h('span', 'bx-tk-vs', '–'), h('span', 'bx-tk-score' + (bLost ? ' dim' : ''), String(m.b.score)));
      item.append(h('span', 'bx-tk-name' + (bLost ? ' dim' : ''), shortTeam(m.b.name)), logo(m.b));
      const st = h('span', 'bx-tk-state' + (final ? ' final' : m.state === 'live' ? ' live' : ''));
      st.textContent = final ? 'Final' : m.state === 'live' ? (m.note ? 'Live · ' + m.note : 'Live') : d ? dayWord(d) + ' ' + fmtTime(d) : 'Upcoming';
      item.appendChild(st);
      out.push(item);
    });
    ((bx.settings && bx.settings.ticker.messages) || []).forEach((text) => {
      const item = h('span', 'bx-tk');
      item.appendChild(h('span', 'bx-tk-msg', text));
      out.push(item);
    });
    return out;
  }
  function socialList() {
    const s = (state && state.socials) || {};
    return ['twitch', 'twitter', 'instagram', 'youtube'].filter((k) => s[k]).map((k) => ({ key: k, handle: s[k] }));
  }
  function socialNode(x) {
    const n = h('span');
    n.innerHTML = O.icons[x.key] || '';
    n.appendChild(h('span', '', '/' + x.handle));
    return n;
  }
  function turnSocial() {
    const list = socialList();
    rail.social.textContent = '';
    if (!list.length) { rail.social.style.display = 'none'; return; }
    rail.social.style.display = '';
    const n = socialNode(list[socialAt % list.length]);
    n.classList.add('swap');
    rail.social.appendChild(n);
    socialAt++;
  }
  function drawRail() {
    const t = bx.settings ? bx.settings.ticker : { on: false };
    const wanted = kind === 'full' || (t.on && ((kind === 'cam' && t.cams) || (kind === 'game' && t.gameplay)));
    const items = wanted && t.on ? tickerItems() : [];
    // Over a camera or the game the rail is only there to crawl.
    const show = wanted && (kind === 'full' || items.length > 0);
    root.dataset.rail = show ? '1' : '0';
    if (!show) { tickerSig = ''; return; }
    const isStatic = !items.length;
    railBox.classList.toggle('static', isStatic);
    rail.tag.textContent = isStatic ? (BRAND.shortName || BRAND.name || '') : 'This week';
    const sig = JSON.stringify([kind, isStatic, items.map((n) => n.textContent + n.querySelectorAll('img[src]').length), socialList()]);
    if (sig === tickerSig) return;
    tickerSig = sig;
    clearInterval(socialTimer);
    if (isStatic) {
      rail.static.textContent = '';
      socialList().forEach((x) => rail.static.appendChild(socialNode(x)));
      rail.static.appendChild(h('b', '', BRAND.tagline || ''));
      return;
    }
    socialAt = 0;
    turnSocial();
    socialTimer = setInterval(turnSocial, 6000);
    const track = rail.track;
    track.style.animation = 'none';
    track.textContent = '';
    items.forEach((n) => track.appendChild(n));
    const one = track.scrollWidth;
    const room = rail.crawl.clientWidth || STAGE.w;
    const copies = Math.max(1, Math.ceil(room / Math.max(1, one)));
    const set = Array.from(track.children);
    for (let i = 1; i < copies * 2; i++) set.forEach((n) => track.appendChild(n.cloneNode(true)));
    track.style.setProperty('--dur', Math.max(12, (one * copies) / CRAWL_SPEED) + 's');
    void track.offsetWidth;
    track.style.animation = '';
  }

  // --- Layout over the game ---------------------------------------------------------------
  // What a corner already holds: the scoreboard's part of it (from the
  // server), the rail, and the camera windows stacked there.
  function railHeight() { return root.dataset.rail === '1' ? (kind === 'full' ? 60 : 46) : 0; }
  function cornerBase(corner) {
    if (kind !== 'game') return 40;
    const res = (bx.layout && bx.layout.reserved) || {};
    return res[corner] === undefined ? 40 : res[corner];
  }
  function pipStack(corner) {
    if (kind !== 'game' || !bx.settings || bx.settings.pip.pos !== corner) return 0;
    const rects = Object.values((bx.layout && bx.layout.pip) || {});
    return rects.reduce((sum, r) => sum + r.h + 52, 0);
  }

  // --- Lower third ---------------------------------------------------------------------------
  let lowerShown = 0;
  let lowerTimer = 0;
  function lowerBottom() {
    if (kind === 'full') return 96;
    if (kind === 'cam') return 74 + railHeight();
    return cornerBase('bottom-left') + pipStack('bottom-left') + railHeight();
  }
  function drawLower() {
    const lt = bx.lower || { on: false };
    lowerBox.style.bottom = lowerBottom() + 'px';
    root.classList.toggle('lower-on', !!lt.on);
    if (lt.on && lt.id !== lowerShown) {
      lowerShown = lt.id;
      clearTimeout(lowerTimer);
      const mark = lowerBox.querySelector('.bx-lower-mark');
      const t = lt.team && state ? teamOf(lt.team) : null;
      tint(mark, t ? t.color : getComputedStyle(root).getPropertyValue('--bx-blue').trim() || '#0054B8');
      setImg(mark.querySelector('img'), (t && t.logo) || BRAND.logo);
      lowerBox.querySelector('.bx-lower-title').textContent = lt.title || '';
      const sub = lowerBox.querySelector('.bx-lower-sub');
      sub.querySelector('b').textContent = lt.kicker || '';
      sub.querySelector('span').textContent = lt.sub || '';
      sub.classList.toggle('empty', !lt.kicker && !lt.sub);
      lowerBox.classList.remove('hide', 'show');
      void lowerBox.offsetWidth;
      lowerBox.classList.add('show');
    } else if (!lt.on && lowerBox.classList.contains('show')) {
      lowerShown = 0;
      lowerBox.classList.remove('show');
      lowerBox.classList.add('hide');
      clearTimeout(lowerTimer);
      lowerTimer = setTimeout(() => lowerBox.classList.remove('hide'), 800);
    } else if (!lt.on) {
      lowerShown = 0;
    }
  }

  // --- Score pop-ups ---------------------------------------------------------------------------
  // One at a time. Each stays for its `seconds`, then leaves the way it
  // came, and the next one follows.
  const alertQueue = [];
  let alertUp = false;
  const ALERT_HEAD = { score: 'Score update', final: 'Final', live: 'Now live', upnext: 'Up next', note: 'Update' };
  function alertAllowed() {
    if (!bx.settings) return false;
    if (kind === 'game') return bx.settings.alerts.gameplay;
    return true;
  }
  function placeAlert(el) {
    if (kind === 'full') { el.classList.add('right'); el.style.top = '112px'; return; }
    if (kind === 'cam') { el.classList.add('right'); el.style.top = '150px'; return; }
    const corner = (bx.settings && bx.settings.alerts.pos) || 'top-right';
    el.classList.add(corner.endsWith('left') ? 'left' : 'right');
    let offset = cornerBase(corner) + pipStack(corner);
    if (corner.startsWith('bottom')) {
      offset += railHeight();
      if (corner === 'bottom-left' && bx.lower && bx.lower.on) offset += 124;
      el.style.bottom = offset + 'px';
    } else {
      el.style.top = offset + 'px';
    }
  }
  function buildAlert(ev) {
    const el = h('div', 'bx-alert ' + (ev.kind || 'score'));
    const head = h('div', 'bx-alert-head');
    const title = h('b');
    if (ev.kind === 'live') title.appendChild(h('i'));
    title.append(ev.kind === 'note' ? (ev.kicker || ALERT_HEAD.note) : (ALERT_HEAD[ev.kind] || ALERT_HEAD.score));
    head.appendChild(title);
    const m = ev.match;
    if (!m) {
      head.appendChild(h('span', '', BRAND.shortName || ''));
      const note = h('div', 'bx-alert-note');
      note.append(h('b', '', ev.title || ''), h('span', '', ev.body || ''));
      el.append(head, note);
      return el;
    }
    head.appendChild(h('span', '', [shortGame(m.game), m.league].filter(Boolean).join(' · ')));
    const body = h('div', 'bx-alert-body');
    const final = m.state === 'final';
    const side = (t, k, other) => {
      const box = h('div', 'bx-alert-team ' + k + (final && t.score < other.score ? ' lost' : ''));
      box.style.setProperty('--c', O.safeColor(t.color, k === 'a' ? BRAND.teamColors.A : BRAND.teamColors.B));
      const img = h('img'); img.alt = '';
      setImg(img, t.logo ? O.mediaUrl(t.logo) : '');
      const name = h('span', '', shortTeam(t.name));
      name.dataset.name = shortTeam(t.name);
      name.dataset.tag = t.tag || '';
      box.append(img, name);
      return box;
    };
    const score = h('div', 'bx-alert-score');
    if (m.state === 'upcoming') { score.classList.add('vs'); score.textContent = 'VS'; }
    else {
      score.append(
        h('b', (ev.changed === 'a' ? 'hit ' : '') + (final && m.a.score < m.b.score ? 'dim' : ''), String(m.a.score)), h('i'),
        h('b', (ev.changed === 'b' ? 'hit ' : '') + (final && m.b.score < m.a.score ? 'dim' : ''), String(m.b.score)));
    }
    body.append(side(m.a, 'a', m.b), score, side(m.b, 'b', m.a));
    const foot = h('div', 'bx-alert-foot');
    const d = startOf(m);
    const right = final ? 'Final' : m.state === 'live' ? (m.note ? 'Live · ' + m.note : 'Live') : d ? dayWord(d) + ' ' + fmtTime(d) : 'Upcoming';
    foot.append(h('span', '', m.round || ''), h('span', '', right));
    el.append(head, body, foot);
    return el;
  }
  function nextAlert() {
    if (alertUp) return;
    const ev = alertQueue.shift();
    if (!ev) return;
    alertUp = true;
    const el = buildAlert(ev);
    const life = Math.max(4, Number(ev.seconds) || 9);
    el.style.setProperty('--life', life + 's');
    placeAlert(el);
    alertsBox.appendChild(el);
    el.querySelectorAll('.bx-alert-team span').forEach((n) => O.fitTeamName(n, n.dataset.name, { min: 19, tag: n.dataset.tag }));
    void el.offsetWidth;
    el.classList.add('show');
    setTimeout(() => {
      el.classList.remove('show');
      el.classList.add('hide');
      setTimeout(() => { el.remove(); alertUp = false; nextAlert(); }, 650);
    }, life * 1000);
  }
  function pushAlert(ev) {
    if (!ev || !alertAllowed()) return;
    // The result of the series on stream is already what Post-Match shows.
    if (ev.own && view === 'post-match') return;
    if (alertQueue.length >= 4) alertQueue.shift();
    alertQueue.push(ev);
    nextAlert();
  }

  // --- Camera windows over the game ------------------------------------------------------------
  // OBS shows the camera in the window's rectangle, under this page, a
  // moment after the server says so (broadcast.js, PIP_SWITCH_MS). The frame
  // arrives closed, opens once the camera is under it, and closes again
  // before OBS takes the camera away.
  const PIP_OPEN_MS = 760;
  const PIP_CLOSE_MS = 500;
  const pips = {};
  function drawPips() {
    const rects = (kind === 'game' && bx.layout && bx.layout.pip) || {};
    const pos = (bx.settings && bx.settings.pip.pos) || 'bottom-left';
    (bx.cams || []).forEach((c) => {
      const rect = c.pip ? rects[c.id] : null;
      let p = pips[c.id];
      if (rect && !p) {
        const el = h('div', 'bx-pip');
        el.innerHTML = '<div class="bx-pip-win"><div class="bx-pip-fill">Camera</div><i class="bx-pip-sh l"></i><i class="bx-pip-sh r"></i><div class="bx-pip-logo"><img alt=""></div></div>'
          + '<i class="bx-pip-c tr"></i><i class="bx-pip-c bl"></i><div class="bx-pip-tab"><b></b><span><i></i>Live</span></div>';
        el.querySelector('.bx-pip-tab b').textContent = c.label;
        setImg(el.querySelector('.bx-pip-logo img'), BRAND.logo);
        pipsBox.appendChild(el);
        p = pips[c.id] = { el, timers: [] };
        void el.offsetWidth;
        el.classList.add('in');
        p.timers.push(setTimeout(() => el.classList.add('open'), PIP_OPEN_MS));
      }
      if (rect && p) {
        p.el.style.left = rect.x + 'px'; p.el.style.top = rect.y + 'px';
        p.el.style.width = rect.w + 'px'; p.el.style.height = rect.h + 'px';
        p.el.style.setProperty('--ox', pos.endsWith('left') ? 'left' : 'right');
        p.el.style.setProperty('--oy', pos.startsWith('top') ? 'top' : 'bottom');
      }
      if (!rect && p) {
        delete pips[c.id];
        p.timers.forEach(clearTimeout);
        p.el.classList.remove('open');
        setTimeout(() => { p.el.classList.remove('in'); p.el.classList.add('out'); }, PIP_CLOSE_MS);
        setTimeout(() => p.el.remove(), PIP_CLOSE_MS + 420);
      }
    });
  }

  // --- Putting it together -------------------------------------------------------------------------
  function drawView() {
    if (!state || !O) return;
    const sec = sectionFor(view);
    Object.values(sections).forEach((s) => s.box.classList.toggle('on', s === sec));
    root.dataset.view = view;
    root.dataset.kind = kind;
    root.dataset.backdrop = O.backdrop ? '1' : '0';
    drawRail();
    if (kind === 'full') drawMast();
    if (view === 'starting-soon' || view === 'post-match') drawHero(view);
    else if (view === 'roster') drawRoster();
    else if (view === 'versus') drawVersus();
    else if (view === 'schedule') drawSchedule();
    else if (view === 'brb') drawBrb();
    else if (kind === 'cam') drawCam();
    drawPips();
    drawLower();
  }

  // Names are measured to fit, so everything is drawn again once a typeface
  // has loaded.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { tickerSig = ''; drawView(); });
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { drawView(); });

  window.BX = {
    views: VIEWS,
    init(api) { O = api; },
    fit(transform) { stage.style.transform = transform; },
    onState(s, v) {
      state = s;
      if (v && v !== view) {
        view = v;
        kind = kindOf(v);
        alsoState.page = 0; schState.page = 0;
      }
      drawView();
    },
    onMessage(msg) {
      if (msg.type === 'bx' && msg.bx) { bx = msg.bx; drawView(); }
      if (msg.type === 'bxEvent' && msg.event) pushAlert(msg.event);
      if (msg.type === 'rlSeries' || msg.type === 'league') drawView();
    },
    // The scoreboard has just been drawn (overlay.html, renderScoreboard): a
    // team one win from taking the series is marked on it.
    onBoard(s) {
      if (!O) return;
      const sb = (s && s.scoreboard) || {};
      const bestOf = O.clampInt(sb.bestOf, 1, 9, 3);
      const need = Math.ceil(bestOf / 2);
      const won = { A: O.clampInt(sb.scoreA, 0, 99, 0), B: O.clampInt(sb.scoreB, 0, 99, 0) };
      const open = bestOf > 1 && won.A < need && won.B < need;
      // Swap puts team B on the left, on every board.
      const left = sb.swap ? 'B' : 'A';
      const point = { L: open && won[left] === need - 1, R: open && won[left === 'A' ? 'B' : 'A'] === need - 1 };
      const any = point.L || point.R;
      const byId = (id) => document.getElementById(id);
      ['L', 'R'].forEach((slot) => {
        byId('rlb' + slot + '-pips').classList.toggle('point', sb.style === 'rl' && point[slot]);
        if (sb.style === 'rl') return;
        byId('sb' + slot + '-score').classList.toggle('point', point[slot]);
        byId('sbc' + slot + '-row').classList.toggle('point', point[slot]);
      });
      if (sb.style === 'rl') {
        const top = byId('rlb-top');
        if (any && !top.querySelector('.point')) {
          top.append(h('i'), h('b', 'point', 'Match point'));
          O.shrinkToFit(top, 12);
        }
        return;
      }
      [['sb-bo', point.L && point.R ? '\u25c0 Match point \u25b6' : point.L ? '\u25c0 Match point' : 'Match point \u25b6'], ['sbc-bo', 'Match point']].forEach(([id, text]) => {
        const el = byId(id);
        el.classList.toggle('point', any);
        if (any) el.textContent = text;
      });
    },
    // The scene has just gone on air: its turning cards start from the top.
    onEnter() {
      alsoState.page = 0; schState.page = 0;
      alsoState.sig = ''; schState.sig = '';
      drawView();
    },
  };
})();
