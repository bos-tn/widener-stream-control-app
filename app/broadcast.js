// Broadcast package (test branch). Everything the scenes show that is not the
// match on stream: the match centre (this week's other matches, typed in or
// read from a LeagueOS season), the ticker, score pop-ups, the lower third
// and the camera windows.
//
// A profile turns it on with a `broadcast` block (profile.js). Without one
// nothing here runs and no page gets a `bx` message.
//
// What a page receives:
//   { type: 'bx', bx }          the whole picture, on subscribe and on change
//   { type: 'bxEvent', event }  one pop-up to play now: { kind, match, ... }
//
// Stored in <data>/broadcast.json: typed-in matches, followed seasons, the
// last feed read from each, the operator's corrections to league matches,
// and the settings. The lower third and the camera windows are not stored:
// a restart starts with both off.

const path = require('path');
const crypto = require('crypto');
const { resolveLeagueLink, seasonMatches } = require('./necc');

const DAY = 24 * 60 * 60 * 1000;
// How often a followed season is read: while one of its matches is due or
// under way tonight, and otherwise.
const POLL_ACTIVE_MS = 90 * 1000;
const POLL_IDLE_MS = 15 * 60 * 1000;
// A match counts as "tonight" from this long before its start until this
// long after it, unless the league has marked it finished.
const ACTIVE_BEFORE_MS = 45 * 60 * 1000;
const ACTIVE_AFTER_MS = 5 * 60 * 60 * 1000;
// A burst of score clicks in the panel is one pop-up, sent this long after
// the last click.
const EDIT_ALERT_MS = 2500;
// A camera window is switched in OBS this long after the scenes are told, so
// the overlay's frame is in place (closed) before the camera appears under
// it, and closed again before the camera goes.
const PIP_SWITCH_MS = 450;

const STATES = ['upcoming', 'live', 'final'];
const CORNERS = ['bottom-left', 'bottom-right', 'top-left', 'top-right'];
const PIP_SIZES = { s: [384, 216], m: [480, 270], l: [640, 360] };
const PIP_GAP = 18;
const STAGE = { w: 1920, h: 1080 };

function defaultSettings() {
  return {
    // Whose matches the league feed keeps: 'all' or 'home' (the profile's
    // home team only).
    scope: 'all',
    ticker: { on: true, gameplay: false, cams: true, messages: [] },
    alerts: { auto: true, onEdit: true, series: true, gameplay: true, pos: 'top-right', seconds: 9 },
    pip: { pos: 'bottom-left', size: 'm' },
    lower: { seconds: 10 },
  };
}

function cleanText(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 120); }
function cleanScore(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(0, Math.min(99, n)) : 0; }
function cleanColor(c) {
  c = String(c || '').trim();
  if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c)) c = '#' + c;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : '';
}

// The week a date falls in, Monday to Sunday, in this PC's time zone.
function weekOf(now) {
  const d = new Date(now);
  const mondayOffset = (d.getDay() + 6) % 7;
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - mondayOffset).getTime();
  return { from, to: from + 7 * DAY };
}

// LeagueOS's match state as one of ours.
function leagueState(m) {
  // Verifying and disputed: the teams have played and reported.
  if (['finished', 'verifying', 'disputed'].includes(m.state)) return 'final';
  if (m.state === 'inProgress') return 'live';
  // A reported game means it has started, whatever the page says.
  if (m.wins[0] + m.wins[1] > 0) return 'live';
  return 'upcoming';
}

// opts: { dataDir, profile, readJson(file), writeJson(file, obj), sendAll(msg),
//         cacheLogo(url) -> url, getState() -> the match state, obs }
function createBroadcast(opts) {
  const { profile, readJson, writeJson, sendAll, cacheLogo, getState, obs } = opts;
  const file = path.join(opts.dataDir, 'broadcast.json');
  const cameras = profile.broadcast.cameras;
  const homeWord = String(profile.homeTeam || '').trim().toLowerCase();

  let store = readJson(file) || {};
  store = {
    v: 1,
    manual: Array.isArray(store.manual) ? store.manual : [],
    follows: Array.isArray(store.follows) ? store.follows : [],
    feed: store.feed && typeof store.feed === 'object' ? store.feed : {},
    overrides: store.overrides && typeof store.overrides === 'object' ? store.overrides : {},
    hidden: Array.isArray(store.hidden) ? store.hidden : [],
    settings: mergeSettings(defaultSettings(), store.settings),
  };
  function save() { writeJson(file, store); }
  function newId() { return crypto.randomBytes(5).toString('hex'); }

  function mergeSettings(base, patch) {
    const out = { ...base };
    const p = patch && typeof patch === 'object' ? patch : {};
    if (p.scope === 'all' || p.scope === 'home') out.scope = p.scope;
    ['ticker', 'alerts', 'pip', 'lower'].forEach((k) => {
      out[k] = { ...base[k] };
      const src = p[k] && typeof p[k] === 'object' ? p[k] : {};
      Object.keys(base[k]).forEach((f) => {
        if (src[f] === undefined) return;
        if (typeof base[k][f] === 'boolean') out[k][f] = !!src[f];
        else if (typeof base[k][f] === 'number') { const n = Number(src[f]); if (Number.isFinite(n)) out[k][f] = n; }
        else if (Array.isArray(base[k][f])) { if (Array.isArray(src[f])) out[k][f] = src[f].map((s) => cleanText(s, 140)).filter(Boolean).slice(0, 12); }
        else out[k][f] = cleanText(src[f], 40);
      });
    });
    if (!CORNERS.includes(out.alerts.pos)) out.alerts.pos = base.alerts.pos;
    if (!CORNERS.includes(out.pip.pos)) out.pip.pos = base.pip.pos;
    if (!PIP_SIZES[out.pip.size]) out.pip.size = base.pip.size;
    out.alerts.seconds = Math.max(4, Math.min(30, Math.round(out.alerts.seconds) || 9));
    out.lower.seconds = Math.max(0, Math.min(120, Math.round(out.lower.seconds) || 0));
    return out;
  }

  // Not stored: what is up right now.
  let lower = { on: false, id: 0, kicker: '', title: '', sub: '', team: '' };
  let lowerTimer = null;
  const cams = {};
  cameras.forEach((c) => { cams[c.id] = { pip: false }; });
  const pipTimers = {};

  // --- Matches ---------------------------------------------------------------
  function isHome(team) {
    if (!homeWord) return false;
    return [team.name, team.org].some((s) => String(s || '').toLowerCase().includes(homeWord));
  }
  function side(t) {
    return {
      name: cleanText(t.name, 80), tag: cleanText(t.tag, 12), color: cleanColor(t.color), logo: cleanText(t.logo || t.logoUrl, 600),
      score: cleanScore(t.score),
    };
  }
  function cleanManual(raw, have) {
    const m = { ...(have || {}), ...(raw || {}) };
    const start = m.start ? new Date(m.start) : null;
    return {
      // A removed match put back (the panel's Undo) keeps its id.
      id: (have && have.id) || (/^[a-z0-9-]{4,40}$/i.test(String(m.id || '')) ? String(m.id) : newId()), src: 'manual',
      game: cleanText(m.game, 40), league: cleanText(m.league, 60), round: cleanText(m.round, 60),
      start: start && !isNaN(start) ? start.toISOString() : '',
      state: STATES.includes(m.state) ? m.state : 'upcoming',
      a: side({ ...((have && have.a) || {}), ...(raw.a || {}) }),
      b: side({ ...((have && have.b) || {}), ...(raw.b || {}) }),
      note: cleanText(m.note, 60),
      updatedAt: new Date().toISOString(),
    };
  }

  // A league match as the scenes show it, with the operator's correction on
  // top if there is one. A correction is dropped once the league's own
  // numbers move past the ones it was made against.
  function fromLeague(follow, m) {
    const id = `lg-${m.id}`;
    const base = { state: leagueState(m), a: m.wins[0], b: m.wins[1] };
    const ov = store.overrides[id];
    const useOv = ov && ov.baseA === base.a && ov.baseB === base.b && ov.baseState === base.state;
    if (ov && !useOv) delete store.overrides[id];
    const t = (i) => ({
      name: m.teams[i].name, tag: m.teams[i].tag, color: cleanColor(m.teams[i].color), logo: m.teams[i].logoUrl,
      score: useOv ? ov[i ? 'b' : 'a'] : base[i ? 'b' : 'a'],
    });
    return {
      id, src: 'league', follow: follow.id, game: follow.game || follow.name, league: follow.league || '',
      round: m.round, start: new Date(m.start).toISOString(), state: useOv ? ov.state : base.state,
      a: t(0), b: t(1), note: useOv ? ov.note || '' : '', bestOf: m.bestOf || 0, corrected: !!useOv, link: m.link,
      home: m.teams.some(isHome),
    };
  }

  // Every match of this week, soonest first. A typed-in match with no start
  // time is kept as long as it exists.
  function matches() {
    const week = weekOf(Date.now());
    const hidden = new Set(store.hidden);
    const out = [];
    store.follows.forEach((f) => {
      const feed = store.feed[f.id];
      ((feed && feed.matches) || []).forEach((m) => {
        if (m.start < week.from || m.start >= week.to) return;
        const row = fromLeague(f, m);
        if (hidden.has(row.id)) return;
        if (store.settings.scope === 'home' && !row.home) return;
        out.push(row);
      });
    });
    store.manual.forEach((m) => {
      const t = m.start ? new Date(m.start).getTime() : 0;
      if (t && (t < week.from - DAY || t >= week.to + DAY)) return;
      out.push({ ...m, home: isHome(m.a) || isHome(m.b) });
    });
    const order = (m) => (m.start ? new Date(m.start).getTime() : Infinity);
    out.sort((x, y) => order(x) - order(y) || x.game.localeCompare(y.game));
    // The match on stream is marked, so the scenes can leave it out of
    // "elsewhere tonight" and the pop-ups skip it.
    const st = getState() || {};
    const onStream = [st.teamA, st.teamB].map((t) => String((t && t.name) || '').trim().toLowerCase()).filter(Boolean);
    out.forEach((m) => {
      const names = [m.a.name, m.b.name].map((n) => n.trim().toLowerCase());
      m.onStream = onStream.length === 2 && onStream.every((n) => names.includes(n));
    });
    return out;
  }

  // --- Layout over gameplay ----------------------------------------------------
  // Where the camera windows sit on the Scoreboard scene, in 1920x1080 stage
  // pixels, and how much of each corner the scoreboard already uses. OBS
  // places the camera by these numbers and the overlay draws its frame at the
  // same ones, so both come from here.
  function reserved() {
    const sb = (getState() || {}).scoreboard || {};
    const rl = sb.style === 'rl';
    const at = (corner) => !rl && sb.position === corner;
    const topBar = !rl && sb.position === 'top';
    return {
      'top-left': rl ? (sb.rlPlayers !== false ? 168 : 32) : at('top-left') ? 216 : topBar ? 170 : 32,
      'top-right': rl ? (sb.rlPlayers !== false ? 168 : 32) : at('top-right') ? 216 : topBar ? 170 : 32,
      'bottom-left': at('bottom-left') ? 226 : 40,
      'bottom-right': rl && sb.rlBoost !== false ? 236 : at('bottom-right') ? 226 : 40,
    };
  }
  function pipRects() {
    const res = reserved();
    const [w, h] = PIP_SIZES[store.settings.pip.size];
    const pos = store.settings.pip.pos;
    const out = {};
    let offset = res[pos];
    cameras.forEach((c) => {
      if (!cams[c.id].pip) return;
      const x = pos.endsWith('left') ? 40 : STAGE.w - 40 - w;
      const y = pos.startsWith('top') ? offset : STAGE.h - offset - h;
      out[c.id] = { x, y, w, h };
      offset += h + PIP_GAP + 34; // the frame's label tab sits above each window
    });
    return out;
  }
  // The rectangle a camera would take if it were switched on now (OBS is
  // told before the overlay shows it).
  function pipRectFor(id) {
    const was = cams[id].pip;
    cams[id].pip = true;
    const r = pipRects()[id];
    cams[id].pip = was;
    return r;
  }

  // --- What the pages get --------------------------------------------------------
  function snapshot() {
    const week = weekOf(Date.now());
    return {
      matches: matches(),
      week: { from: new Date(week.from).toISOString(), to: new Date(week.to).toISOString() },
      settings: store.settings,
      lower,
      cams: cameras.map((c) => ({ id: c.id, label: c.label, pip: cams[c.id].pip })),
      layout: { reserved: reserved(), pip: pipRects() },
      follows: store.follows.map((f) => {
        const feed = store.feed[f.id] || {};
        return { id: f.id, name: f.name, game: f.game, league: f.league, host: f.host, checkedAt: feed.checkedAt || '', error: feed.error || '', count: (feed.matches || []).length };
      }),
      hidden: store.hidden.length,
    };
  }
  let lastSent = '';
  function broadcast(force) {
    const bx = snapshot();
    const key = JSON.stringify(bx);
    if (!force && key === lastSent) return;
    lastSent = key;
    sendAll({ type: 'bx', bx });
  }

  // --- Pop-ups -------------------------------------------------------------------
  let alertSeq = 0;
  function alert(event) {
    alertSeq++;
    sendAll({ type: 'bxEvent', event: { id: `${Date.now()}-${alertSeq}`, seconds: store.settings.alerts.seconds, ...event } });
  }
  function kindFor(m, was) {
    if (m.state === 'final') return 'final';
    if (was && was.state !== 'live' && m.state === 'live' && m.a.score + m.b.score === 0) return 'live';
    if (m.state === 'upcoming') return 'upnext';
    return 'score';
  }
  function alertMatch(id, kind) {
    const m = matches().find((x) => x.id === id);
    if (!m) return false;
    alert({ kind: kind || kindFor(m), match: m });
    return true;
  }
  // The series on stream has just been decided: its result as a pop-up, on
  // every scene (the Scoreboard included, where the game is still on).
  function alertSeriesFinal() {
    if (!store.settings.alerts.series) return;
    const st = getState() || {};
    const sb = st.scoreboard || {};
    const t = (team, score) => ({ name: cleanText((team || {}).name, 80), tag: cleanText((team || {}).tag, 12), color: cleanColor((team || {}).color), logo: cleanText((team || {}).logoUrl, 600), score: cleanScore(score) });
    const a = t(st.teamA, sb.scoreA);
    const b = t(st.teamB, sb.scoreB);
    if (!a.name || !b.name) return;
    alert({ kind: 'final', own: true, match: { id: 'stream', src: 'stream', game: cleanText(st.team, 40), league: '', round: cleanText(sb.round, 60), start: '', state: 'final', a, b, note: '', home: true, onStream: true } });
  }

  // After a score is changed in the panel: one pop-up for the burst.
  const editTimers = {};
  function alertAfterEdit(id, was) {
    if (!store.settings.alerts.onEdit) return;
    clearTimeout(editTimers[id]);
    editTimers[id] = setTimeout(() => {
      delete editTimers[id];
      const m = matches().find((x) => x.id === id);
      if (!m || m.onStream || m.state === 'upcoming') return;
      const changed = !was ? '' : m.a.score !== was.a ? 'a' : m.b.score !== was.b ? 'b' : '';
      alert({ kind: kindFor(m, was), match: m, changed });
    }, EDIT_ALERT_MS);
  }

  // --- Typed-in matches and corrections ---------------------------------------------
  function upsertManual(raw) {
    const idx = store.manual.findIndex((m) => m.id === (raw && raw.id));
    const m = cleanManual(raw || {}, idx >= 0 ? store.manual[idx] : null);
    if (!m.a.name || !m.b.name) return { error: 'A match needs two team names' };
    if (idx >= 0) store.manual[idx] = m; else store.manual.push(m);
    save(); broadcast();
    return { match: m };
  }
  function removeMatch(id) {
    if (String(id).startsWith('lg-')) {
      if (!store.hidden.includes(id)) store.hidden.push(id);
    } else {
      store.manual = store.manual.filter((m) => m.id !== id);
    }
    save(); broadcast();
    return { ok: true };
  }
  function restoreHidden() { store.hidden = []; save(); broadcast(); return { ok: true }; }

  // A score, state or note change from the panel: { a, b, state, note }.
  // For a league match it is kept as a correction over the league's numbers.
  function setScore(id, patch) {
    const before = matches().find((x) => x.id === id);
    if (!before) return { error: 'No such match' };
    const was = { a: before.a.score, b: before.b.score, state: before.state };
    const next = {
      a: patch.a !== undefined ? cleanScore(patch.a) : before.a.score,
      b: patch.b !== undefined ? cleanScore(patch.b) : before.b.score,
      state: STATES.includes(patch.state) ? patch.state : before.state,
      note: patch.note !== undefined ? cleanText(patch.note, 60) : before.note,
    };
    // Scoring an upcoming match starts it.
    if (patch.state === undefined && next.state === 'upcoming' && next.a + next.b > 0) next.state = 'live';
    if (before.src === 'league') {
      const f = store.follows.find((x) => x.id === before.follow);
      const raw = f && ((store.feed[f.id] || {}).matches || []).find((x) => `lg-${x.id}` === id);
      if (!raw) return { error: 'No such match' };
      store.overrides[id] = { ...next, baseA: raw.wins[0], baseB: raw.wins[1], baseState: leagueState(raw) };
    } else {
      const m = store.manual.find((x) => x.id === id);
      m.a.score = next.a; m.b.score = next.b; m.state = next.state; m.note = next.note;
      m.updatedAt = new Date().toISOString();
    }
    save(); broadcast();
    if (next.a !== was.a || next.b !== was.b || next.state !== was.state) alertAfterEdit(id, was);
    return { ok: true };
  }
  function clearCorrection(id) { delete store.overrides[id]; save(); broadcast(); return { ok: true }; }

  // --- League feed ---------------------------------------------------------------
  const caches = {};
  const reading = {};
  let pollTimer = null;

  function activeTonight(f) {
    const now = Date.now();
    return ((store.feed[f.id] || {}).matches || []).some((m) => m.state !== 'finished' && m.state !== 'cancelled'
      && now > m.start - ACTIVE_BEFORE_MS && now < m.start + ACTIVE_AFTER_MS);
  }

  async function readFollow(f, quiet) {
    if (reading[f.id]) return reading[f.id];
    reading[f.id] = (async () => {
      const now = new Date().toISOString();
      const week = weekOf(Date.now());
      const before = new Map(matches().filter((m) => m.follow === f.id).map((m) => [m.id, m]));
      const hadFeed = !!store.feed[f.id];
      try {
        caches[f.id] = caches[f.id] || {};
        const res = await seasonMatches(f.host, f.leagueId, f.seasonId, { from: week.from - DAY, to: week.to + DAY }, caches[f.id]);
        // Logos are fetched once and served from this PC.
        const logos = new Map();
        res.matches.forEach((m) => m.teams.forEach((t) => { if (t.logoUrl) logos.set(t.logoUrl, t.logoUrl); }));
        await Promise.all([...logos.keys()].map(async (u) => { logos.set(u, await cacheLogo(u)); }));
        res.matches.forEach((m) => m.teams.forEach((t) => { if (t.logoUrl) t.logoUrl = logos.get(t.logoUrl) || t.logoUrl; }));
        if (!f.name && res.seasonName) f.name = res.seasonName;
        store.feed[f.id] = { matches: res.matches, checkedAt: now, error: '' };
      } catch (err) {
        store.feed[f.id] = { matches: [], ...(store.feed[f.id] || {}), checkedAt: now, error: String((err && err.message) || 'The league site did not answer').slice(0, 200) };
      }
      save();
      // What changed since the last read becomes a pop-up, for a match
      // other than the one on stream. Never on the first read of a season.
      if (hadFeed && !quiet && store.settings.alerts.auto) {
        matches().filter((m) => m.follow === f.id && !m.onStream).forEach((m) => {
          const was = before.get(m.id);
          if (!was || m.corrected) return;
          const scoreMoved = m.a.score !== was.a.score || m.b.score !== was.b.score;
          const stateMoved = m.state !== was.state;
          if (!scoreMoved && !stateMoved) return;
          if (m.state === 'upcoming') return;
          alert({ kind: kindFor(m, was), match: m, changed: m.a.score !== was.a.score ? 'a' : m.b.score !== was.b.score ? 'b' : '' });
        });
      }
      broadcast();
      return store.feed[f.id];
    })().finally(() => { delete reading[f.id]; });
    return reading[f.id];
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!store.follows.length) return;
    const active = store.follows.some(activeTonight);
    pollTimer = setTimeout(async () => {
      const now = Date.now();
      for (const f of store.follows) {
        const last = new Date((store.feed[f.id] || {}).checkedAt || 0).getTime();
        const every = activeTonight(f) ? POLL_ACTIVE_MS : POLL_IDLE_MS;
        if (now - last >= every - 5000) await readFollow(f).catch(() => {});
      }
      schedulePoll();
    }, active ? POLL_ACTIVE_MS : 60 * 1000);
    if (pollTimer.unref) pollTimer.unref();
  }

  function addSeasons(host, leagueId, seasons, league) {
    let added = 0;
    seasons.forEach((s) => {
      if (store.follows.some((f) => f.seasonId === s.id)) return;
      const game = (profile.games.find((g) => (g.leagueActivity || []).includes(s.activity)
        || s.name.toLowerCase().includes(g.name.toLowerCase())) || {}).name || s.name;
      store.follows.push({ id: newId(), host, leagueId, seasonId: s.id, name: s.name, game, league: league || '', addedAt: new Date().toISOString() });
      added++;
    });
    return added;
  }
  // A LeagueOS link: a league's home page follows every season it is
  // running; a season, stage or match link follows that season.
  async function follow(url, league) {
    const r = await resolveLeagueLink(url);
    const label = cleanText(league, 60) || leagueName(r.hostname);
    const added = addSeasons(r.hostname, r.leagueId, r.seasons, label);
    save();
    await Promise.all(store.follows.filter((f) => !store.feed[f.id]).map((f) => readFollow(f, true)));
    broadcast();
    schedulePoll();
    return { added, seasons: r.seasons.map((s) => s.name) };
  }
  // The season a match was imported from is followed too (server.js calls
  // this after an import), so its other matches that week show up.
  function followImported(data) {
    if (!data || !data.hostname || !data.leagueId || !data.seasonId) return;
    if (store.follows.some((f) => f.seasonId === data.seasonId)) return;
    addSeasons(data.hostname, data.leagueId, [{ id: data.seasonId, name: data.eventName || data.game || '', activity: String(data.activity || '').toLowerCase() }], leagueName(data.hostname));
    save();
    const f = store.follows[store.follows.length - 1];
    readFollow(f, true).catch(() => {}).then(schedulePoll);
  }
  function leagueName(hostname) {
    const sub = String(hostname || '').split('.')[0];
    return sub ? sub.toUpperCase() : '';
  }
  function unfollow(id) {
    store.follows = store.follows.filter((f) => f.id !== id);
    delete store.feed[id];
    delete caches[id];
    save(); broadcast(); schedulePoll();
    return { ok: true };
  }
  async function refresh() {
    await Promise.all(store.follows.map((f) => readFollow(f).catch(() => {})));
    broadcast(true);
    return snapshot();
  }

  // --- Lower third -----------------------------------------------------------------
  // { on, kicker, title, sub, team ('A' | 'B' | ''), seconds }. seconds 0
  // keeps it up until it is taken down.
  function setLower(patch) {
    clearTimeout(lowerTimer);
    const on = patch.on !== false && !!cleanText(patch.title !== undefined ? patch.title : lower.title, 80);
    if (!on) {
      lower = { ...lower, on: false };
    } else {
      lower = {
        on: true, id: lower.id + 1,
        kicker: cleanText(patch.kicker, 40), title: cleanText(patch.title, 80), sub: cleanText(patch.sub, 100),
        team: patch.team === 'A' || patch.team === 'B' ? patch.team : '',
      };
      const seconds = patch.seconds !== undefined ? Math.max(0, Math.min(120, Number(patch.seconds) || 0)) : store.settings.lower.seconds;
      if (seconds > 0) {
        lowerTimer = setTimeout(() => { lower = { ...lower, on: false }; broadcast(); }, seconds * 1000);
        if (lowerTimer.unref) lowerTimer.unref();
      }
    }
    broadcast();
    return { lower };
  }

  // --- Camera windows -----------------------------------------------------------------
  // A camera popped up over the game. on: true, false or 'toggle'.
  function setPip(id, on) {
    if (!cams[id]) return { error: 'No such camera' };
    const next = on === 'toggle' ? !cams[id].pip : !!on;
    if (next === cams[id].pip) return { pip: next };
    clearTimeout(pipTimers[id]);
    if (next) {
      // The overlay draws the closed frame first; OBS shows the camera under
      // it a moment later, and the frame then opens.
      const rect = pipRectFor(id);
      cams[id].pip = true;
      broadcast();
      pipTimers[id] = setTimeout(() => { obs.setCameraWindow(id, true, rect).catch(() => {}); applyPipRects(id); }, PIP_SWITCH_MS);
    } else {
      cams[id].pip = false;
      broadcast();
      pipTimers[id] = setTimeout(() => { obs.setCameraWindow(id, false).catch(() => {}); applyPipRects(); }, PIP_SWITCH_MS);
    }
    return { pip: next };
  }
  // The windows still up move when one beside them goes, or the scoreboard
  // changes corner.
  function applyPipRects(skip) {
    const rects = pipRects();
    Object.keys(rects).forEach((id) => { if (id !== skip) obs.setCameraWindow(id, true, rects[id]).catch(() => {}); });
  }

  function setSettings(patch) {
    const pipBefore = JSON.stringify(store.settings.pip);
    store.settings = mergeSettings(store.settings, patch);
    save(); broadcast();
    if (JSON.stringify(store.settings.pip) !== pipBefore) applyPipRects();
    return { settings: store.settings };
  }

  // The match state changed (teams, scoreboard position): the layout and the
  // on-stream mark follow it.
  let layoutKey = '';
  function onState() {
    const key = JSON.stringify(reserved());
    if (key !== layoutKey) { layoutKey = key; applyPipRects(); }
    broadcast();
  }

  // Start: read every followed season once, then keep them current.
  function start() {
    store.follows.forEach((f) => { readFollow(f, true).catch(() => {}); });
    schedulePoll();
    // The week rolls over at midnight on Sunday; a quiet re-send picks it up.
    const tick = setInterval(() => broadcast(), 10 * 60 * 1000);
    if (tick.unref) tick.unref();
  }

  return {
    snapshot, message: () => ({ type: 'bx', bx: snapshot() }), start, onState,
    upsertManual, removeMatch, restoreHidden, setScore, clearCorrection, alertMatch, alert, alertSeriesFinal,
    follow, followImported, unfollow, refresh,
    setLower, setPip, setSettings,
    cameras,
  };
}

module.exports = { createBroadcast, PIP_SIZES };
