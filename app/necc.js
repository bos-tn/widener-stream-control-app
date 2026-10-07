// Reads public data from LeagueOS (used by NECC, League of the East and other
// leagues running on leagueos.gg): a match and its rosters from a match page
// or overlay link, and a season's standings.
//
// This talks to LeagueOS's internal API (api.leagueos.gg), which is NOT an
// official/documented public API - it's the same one their own web app calls
// for anyone viewing a public match page, with no login required. The three
// x-leagueos-* headers below are a lightweight anti-abuse fingerprint (not a
// secret credential) reverse-engineered from LeagueOS's own client bundle.
// If LeagueOS changes this internal contract, these calls start throwing:
// the match import degrades to manual entry and the standings keep their
// last fetched table. Nothing else in the app depends on it.

const APP_ID = 'los-league';

function hasher(str) {
  let hash = 0;
  for (let i = 0, len = str.length; i < len; i++) {
    const chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return hash;
}

function buildHeaders(hostname, leagueId) {
  const did = String(hasher(hostname));
  const range = 10;
  const ct = Math.floor(Date.now() / 1000);
  const rid = hasher(`${ct - (ct % range)}${did}${APP_ID}`);
  const headers = {
    'x-leagueos-did': did,
    'x-leagueos-aid': APP_ID,
    'x-leagueos-rid': String(rid),
    accept: 'application/json',
  };
  if (leagueId) headers['x-leagueos-lid'] = leagueId;
  return headers;
}

// Accepts either a match page URL (https://<league>.leagueos.gg/league/matches/<id>)
// or an overlay asset URL (https://overlays.leagueos.gg/o/<type>/<leagueId>/.../<matchId>/).
function parseMatchUrl(input) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    throw new Error('That does not look like a valid URL.');
  }
  const parts = u.pathname.split('/').filter(Boolean);
  let matchId;
  if (parts[0] === 'league' && parts[1] === 'matches' && parts[2]) {
    matchId = parts[2];
  } else if (parts[0] === 'o' && parts.length >= 2) {
    matchId = parts[parts.length - 1];
  }
  if (!matchId) {
    throw new Error('Could not find a match ID in that link.');
  }
  return { matchId, hostname: u.hostname };
}

async function fetchJSON(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LeagueOS API returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return res.json();
}

function playerName(m) {
  const full = `${m.givenName || ''} ${m.familyName || ''}`.trim();
  return full || m.leagueTag || 'Unknown Player';
}

function logoUrl(roster) {
  if (roster.sourceId && roster.avatar) {
    return `https://images.leagueos.gg/teams/${roster.sourceId}/${roster.avatar}`;
  }
  if (roster.parent && roster.parent.id && roster.parent.icon) {
    return `https://images.leagueos.gg/groups/${roster.parent.id}/${roster.parent.icon}`;
  }
  return '';
}

function normalizeRoster(roster) {
  const players = Object.values(roster.members || {})
    .map((m) => ({
      id: m.memberId,
      name: playerName(m),
      gamertag: m.leagueTag || '',
      active: !!m.active,
      // teamRank: 1..N = starter position, -1 = sub/coach/manager
      position: typeof m.teamRank === 'number' ? m.teamRank : -1,
    }))
    .sort((a, b) => {
      const ar = a.position < 0 ? 999 : a.position;
      const br = b.position < 0 ? 999 : b.position;
      return ar - br;
    });

  return {
    id: roster.sourceId || roster.id,
    name: roster.name || '',
    tag: roster.clanTag || '',
    color: roster.color || '',
    colorAlt: roster.colorAlt || '',
    org: roster.parent ? roster.parent.name : '',
    logoUrl: logoUrl(roster),
    players,
  };
}

// Overlay asset URLs (https://overlays.leagueos.gg/o/<type>/...) are built
// from a league -> season -> stage -> match ID chain. Confirmed by fetching
// /league/stages/{stageId}, which returns the stage's own seasonId - that's
// the one ID this app can't get from the match/roster payloads directly.
const OVERLAY_TYPES = {
  seasonHeader: { segments: ['league', 'season'] },
  stageBracket: { segments: ['league', 'season', 'stage'] },
  matchPreview: { segments: ['league', 'season', 'stage', 'match'] },
  matchActivity: { segments: ['league', 'season', 'stage', 'match'] },
  matchProgress: { segments: ['league', 'season', 'stage', 'match'] },
  matchRosters: { segments: ['league', 'season', 'stage', 'match'] },
};

function buildOverlayUrls(ids) {
  const urls = {};
  for (const [type, def] of Object.entries(OVERLAY_TYPES)) {
    if (def.segments.some((seg) => !ids[seg])) continue; // missing an ID this type needs
    const path = def.segments.map((seg) => ids[seg]).join('/');
    urls[type] = `https://overlays.leagueos.gg/o/${type}/${path}/`;
  }
  return urls;
}

async function importMatch(matchUrl) {
  const { matchId, hostname } = parseMatchUrl(matchUrl);
  const matchJson = await fetchJSON(`https://api.leagueos.gg/los/matches/${matchId}`, buildHeaders(hostname));
  const match = matchJson.data;
  if (!match) throw new Error('No match data returned for that link.');

  const leagueId = match.leagueId;
  const rostersJson = await fetchJSON(
    `https://api.leagueos.gg/los/matches/${matchId}/rosters`,
    buildHeaders(hostname, leagueId)
  );
  const teams = (rostersJson.data || []).map(normalizeRoster);

  // Stage (and thus season) comes from a roster's contextId - only resolvable
  // when context is "stages" (the common case for regular season matches).
  const firstRoster = rostersJson.data && rostersJson.data[0];
  const stageId = firstRoster && firstRoster.context === 'stages' ? firstRoster.contextId : null;

  let seasonId = null;
  if (stageId) {
    try {
      const stageJson = await fetchJSON(`https://api.leagueos.gg/league/stages/${stageId}`, buildHeaders(hostname, leagueId));
      seasonId = stageJson.data && stageJson.data.seasonId;
    } catch {
      // Overlay URLs are a bonus, not required - fall through with none.
    }
  }

  const overlayUrls = buildOverlayUrls({ league: leagueId, season: seasonId, stage: stageId, match: matchId });

  return {
    matchId,
    hostname,
    leagueId: leagueId || '',
    seasonId: seasonId || '',
    activity: match.stdAct || '',
    game: match.activityName || '',
    eventName: match.eventName || '',
    division: (match.divisions && match.divisions[0]) || '',
    scheduledAt: match.date ? new Date(match.date * 1000).toISOString() : null,
    // Series length (v0.11.0): matches carry their stage's format, e.g.
    // { matchFormat: 'bestOf', matchGameCount: 5 }. Only a best-of with an
    // odd count maps onto the scoreboard; anything else (a fixed number of
    // games) is left for the operator to set.
    bestOf: match.matchFormat === 'bestOf' && [1, 3, 5, 7, 9].includes(match.matchGameCount) ? match.matchGameCount : null,
    teams,
    overlayUrls,
  };
}

// --- Standings (v2.0.0) -------------------------------------------------------
// The same calls a league's season results page makes: the league's seasons
// (one per game), the season's scoring order, and the season's teams with
// their records. Teams the league has not confirmed are left out, as on the
// site.

const API = 'https://api.leagueos.gg';

// Every page of a paged list ({ results, hasMore }).
async function fetchPaged(pathname, hostname, leagueId) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const json = await fetchJSON(`${API}${pathname}?ipp=100&page=${page}`, buildHeaders(hostname, leagueId));
    const data = json.data || {};
    out.push(...(Array.isArray(data.results) ? data.results : []));
    if (!data.hasMore) break;
  }
  return out;
}

// [{ id, name, activity, start, end }], times in ms. `activity` is
// LeagueOS's id for the game ("rl", "valorant", "ssbu", ...).
async function listSeasons(hostname, leagueId) {
  const seasons = await fetchPaged('/league/seasons', hostname, leagueId);
  return seasons.map((s) => ({
    id: s.id, name: s.name || '', activity: String(s.stdAct || '').toLowerCase(),
    start: (Number(s.dateStart) || 0) * 1000, end: (Number(s.dateEnd) || 0) * 1000,
  }));
}

// The season for a game: its activity id is one of `activities`, or its name
// holds the game's name. Of several, the one running now, then the next to
// start, then the last one played.
function pickSeason(seasons, activities, gameName, now) {
  const acts = (activities || []).map((a) => String(a).toLowerCase());
  const name = String(gameName || '').trim().toLowerCase();
  const mine = seasons.filter((s) => acts.includes(s.activity) || (name && s.name.toLowerCase().includes(name)));
  const t = now || Date.now();
  const running = mine.filter((s) => s.start <= t && (!s.end || s.end >= t)).sort((a, b) => b.start - a.start);
  if (running.length) return running[0];
  const coming = mine.filter((s) => s.start > t).sort((a, b) => a.start - b.start);
  if (coming.length) return coming[0];
  return mine.sort((a, b) => b.start - a.start)[0] || null;
}

// One figure of a team's record by LeagueOS's path for it ("stats.wins").
// The three rates are not stored; the site derives them the same way.
function statValue(stats, statPath) {
  const s = stats || {};
  const n = (k) => Number(s[k]) || 0;
  const key = String(statPath || '').replace(/^stats\./, '');
  if (typeof s[key] === 'number') return s[key];
  if (key === 'winPercentage') { const t = n('wins') + n('losses') + n('draws'); return t ? n('wins') / t : 0; }
  if (key === 'gameWinPercentage') { const t = n('gameWins') + n('gameLosses') + n('gameDraws'); return t ? n('gameWins') / t : 0; }
  if (key === 'totalScoreDelta') return n('totalScore') - n('totalScoreAgainst');
  return n(key);
}

// A season's standings: { seasonId, seasonName, activity, played, scored,
// rows }. Rows are in the season's own scoring order (its scoringProps, each
// ascending or descending), then by name. `rank` is shared by teams level on
// every scoring figure. `played` says whether any match has a result yet,
// `scored` whether the league records a score for and against.
async function seasonStandings(hostname, leagueId, seasonId) {
  const seasonJson = await fetchJSON(`${API}/league/seasons/${seasonId}`, buildHeaders(hostname, leagueId));
  const season = seasonJson.data;
  if (!season) throw new Error('No season data returned.');
  const props = (Array.isArray(season.scoringProps) ? season.scoringProps : []).filter((p) => p && p.path);
  const rosters = await fetchPaged(`/league/seasons/${seasonId}/rosters`, hostname, leagueId);
  const rows = rosters.filter((r) => r.state === 'confirmed').map((r) => {
    const st = r.stats || {};
    const n = (k) => Math.max(0, Number(st[k]) || 0);
    return {
      id: r.sourceId || r.id || '', name: r.name || '', tag: r.clanTag || '', org: r.parent ? r.parent.name || '' : '',
      color: r.color || '', colorAlt: r.colorAlt || '', logoUrl: logoUrl(r),
      w: n('wins'), l: n('losses'), gw: n('gameWins'), gl: n('gameLosses'), sf: n('totalScore'), sa: n('totalScoreAgainst'),
      key: props.map((p) => statValue(st, p.path)),
    };
  });
  const order = (a, b) => {
    for (let i = 0; i < props.length; i++) {
      const d = a.key[i] - b.key[i];
      if (d) return props[i].sortDesc ? -d : d;
    }
    return 0;
  };
  rows.sort((a, b) => order(a, b) || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i > 0 && order(rows[i - 1], r) === 0 ? rows[i - 1].rank : i + 1; });
  rows.forEach((r) => { delete r.key; });
  return {
    seasonId, seasonName: season.name || '', activity: String(season.stdAct || '').toLowerCase(),
    played: rows.some((r) => r.w + r.l > 0), scored: rows.some((r) => r.sf + r.sa > 0), rows,
  };
}

// --- Season schedule (broadcast package) --------------------------------------
// The matches of a season, for the match centre's league feed: what the
// league's schedule page shows. A link to a league site names the league; a
// season, stage or match link names one season of it.

const LINK_ID = /^[a-z0-9]{12,40}$/i;
const LINK_KIND = { matches: 'match', seasons: 'season', stages: 'stage' };
// LeagueOS season and stage states: 0 draft, 1 upcoming, 2 in progress,
// 3 complete, 4 disabled.
const STATE_DRAFT = 0;
const STATE_RUNNING = [1, 2];
const STATE_DISABLED = 4;

// { hostname, leagueId, seasons: [{ id, name, activity, start, end }] } for a
// LeagueOS link. A league home page gives every season that is upcoming or
// running; a season, stage or match link gives that one season.
async function resolveLeagueLink(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch (e) { throw new Error('That does not look like a valid URL.'); }
  if (!/(^|\.)leagueos\.gg$/i.test(u.hostname)) throw new Error('Not a LeagueOS link.');
  const segs = u.pathname.split('/').filter(Boolean);
  const ids = {};
  let hostname = u.hostname;
  if (hostname === 'overlays.leagueos.gg' && segs[0] === 'o') {
    ['league', 'season', 'stage', 'match'].forEach((k, i) => { if (LINK_ID.test(segs[i + 2] || '')) ids[k] = segs[i + 2]; });
  } else {
    for (let i = 0; i < segs.length - 1; i++) {
      const k = LINK_KIND[segs[i]];
      if (k && !ids[k] && LINK_ID.test(segs[i + 1])) ids[k] = segs[i + 1];
    }
  }
  let leagueId = ids.league || '';
  let seasonId = ids.season || '';
  if (ids.match && (!leagueId || !seasonId)) {
    const m = (await fetchJSON(`${API}/los/matches/${ids.match}`, buildHeaders(hostname))).data || {};
    leagueId = leagueId || m.leagueId || '';
    seasonId = seasonId || m.seasonId || m.eventId || '';
    if (!ids.stage && m.stageId) ids.stage = m.stageId;
  }
  if (!leagueId) {
    const d = (await fetchJSON(`${API}/los/domains?hostname=${encodeURIComponent(hostname)}`, buildHeaders(hostname))).data || {};
    leagueId = d.leagueId || '';
  }
  if (!leagueId) throw new Error(`No LeagueOS league found for ${hostname}.`);
  if (!seasonId && ids.stage) {
    const s = (await fetchJSON(`${API}/league/stages/${ids.stage}`, buildHeaders(hostname, leagueId))).data || {};
    seasonId = s.seasonId || '';
  }
  // An overlay link has no league host of its own; the season's pages do.
  const seasons = await fetchPaged('/league/seasons', hostname, leagueId);
  const row = (s) => ({
    id: s.id, name: s.name || '', activity: String(s.stdAct || '').toLowerCase(),
    start: (Number(s.dateStart) || 0) * 1000, end: (Number(s.dateEnd) || 0) * 1000,
  });
  const picked = seasonId ? seasons.filter((s) => s.id === seasonId) : seasons.filter((s) => STATE_RUNNING.includes(s.state));
  if (!picked.length) throw new Error(seasonId ? 'That season is not listed by the league.' : 'The league has no season that is upcoming or running.');
  return { hostname, leagueId, seasons: picked.map(row) };
}

// A team as the match centre shows it, from a stage roster.
function scheduleTeam(r) {
  if (!r) return { id: '', name: 'TBD', tag: '', org: '', color: '', colorAlt: '', logoUrl: '' };
  return {
    id: r.sourceId || r.id || '', name: r.name || '', tag: r.clanTag || '', org: r.parent ? r.parent.name || '' : '',
    color: r.color || '', colorAlt: r.colorAlt || '', logoUrl: logoUrl(r),
  };
}

// One season's matches between two times (ms): { seasonId, seasonName,
// activity, matches }. A match is { id, round, start (ms), state, teams: [a,
// b], wins: [a, b], games, link }. `state` is LeagueOS's own word
// (scheduled, checkingIn, inProgress, verifying, finished, cancelled, ...);
// `wins` counts the games each team has won so far. `cache` keeps what
// rarely changes (the season, its stages and their teams) between calls.
const SCHEDULE_CACHE_MS = 30 * 60 * 1000;
async function seasonMatches(hostname, leagueId, seasonId, range, cache) {
  const c = cache || {};
  const now = Date.now();
  const headers = () => buildHeaders(hostname, leagueId);
  if (!c.season || now - (c.at || 0) > SCHEDULE_CACHE_MS) {
    c.season = (await fetchJSON(`${API}/league/seasons/${seasonId}`, headers())).data || {};
    const stages = (await fetchJSON(`${API}/league/seasons/${seasonId}/stages`, headers())).data || [];
    c.stages = (Array.isArray(stages) ? stages : []).filter((s) => s.state !== STATE_DRAFT && s.state !== STATE_DISABLED);
    c.rosters = {};
    c.at = now;
  }
  const from = (range && range.from) || 0;
  const to = (range && range.to) || Infinity;
  const out = [];
  for (const s of c.stages) {
    // A stage that ended before the range, or starts after it, has nothing.
    const sStart = (Number(s.dateStart) || 0) * 1000;
    const sEnd = (Number(s.dateEnd) || 0) * 1000;
    if ((sEnd && sEnd < from) || (sStart && sStart > to)) continue;
    if (!c.rosters[s.id]) {
      const rosters = (await fetchJSON(`${API}/league/stages/${s.id}/rosters`, headers())).data || [];
      c.rosters[s.id] = new Map((Array.isArray(rosters) ? rosters : []).map((r) => [r.sourceId || r.id, r]));
    }
    const byId = c.rosters[s.id];
    const rows = await fetchPaged(`/league/stages/${s.id}/matches`, hostname, leagueId);
    rows.forEach((m) => {
      const start = (Number(m.date) || 0) * 1000;
      if (!start || start < from || start > to) return;
      const ids = Array.isArray(m.teamIds) ? m.teamIds : [];
      if (ids.length !== 2) return;
      const wins = {};
      let games = 0;
      (m.games || []).forEach((g) => {
        const won = g.winnerIds || [];
        if (won.length || Object.keys(g.scores || {}).length) games++;
        won.forEach((id) => { wins[id] = (wins[id] || 0) + 1; });
      });
      out.push({
        id: m.id, round: m.roundName || '', stage: s.name || '', start, state: String(m.state || ''),
        teams: ids.map((id) => scheduleTeam(byId.get(id))),
        wins: ids.map((id) => wins[id] || 0), games,
        bestOf: m.matchFormat === 'bestOf' ? Number(m.matchGameCount) || 0 : 0,
        link: m.urlV1 || `https://${hostname}/league/matches/${m.id}`,
      });
    });
  }
  out.sort((a, b) => a.start - b.start);
  return {
    seasonId, seasonName: c.season.name || '', activity: String(c.season.stdAct || '').toLowerCase(), matches: out,
  };
}

module.exports = { importMatch, parseMatchUrl, listSeasons, pickSeason, seasonStandings, resolveLeagueLink, seasonMatches };
