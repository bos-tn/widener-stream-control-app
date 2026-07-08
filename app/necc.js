// Imports public match/roster data from LeagueOS (used by NECC and other
// leagues running on leagueos.gg) given a match page or overlay link.
//
// This talks to LeagueOS's internal API (api.leagueos.gg), which is NOT an
// official/documented public API - it's the same one their own web app calls
// for anyone viewing a public match page, with no login required. The three
// x-leagueos-* headers below are a lightweight anti-abuse fingerprint (not a
// secret credential) reverse-engineered from LeagueOS's own client bundle.
// If LeagueOS changes this internal contract, importMatch() will start
// throwing and this feature degrades to manual entry - nothing else in the
// app depends on it.

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
    game: match.activityName || '',
    eventName: match.eventName || '',
    division: (match.divisions && match.divisions[0]) || '',
    scheduledAt: match.date ? new Date(match.date * 1000).toISOString() : null,
    teams,
    overlayUrls,
  };
}

module.exports = { importMatch, parseMatchUrl };
