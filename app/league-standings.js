// Public LeagueOS stage endpoints, separate from the optional schedule-feed
// service used by necc.js. No account or OBS connection is involved.
const API = 'https://api.leagueos.gg';
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return h; }
async function read(path, host, leagueId) {
  const did = String(hash(host)), aid = 'los-league', t = Math.floor(Date.now() / 1000);
  const res = await fetch(API + path, { headers: { accept: 'application/json', 'x-leagueos-did': did,
    'x-leagueos-aid': aid, 'x-leagueos-rid': String(hash(`${t - t % 10}${did}${aid}`)), 'x-leagueos-lid': leagueId }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`LeagueOS standings returned ${res.status}`);
  return (await res.json()).data;
}
async function paged(path, host, leagueId) {
  const out = [];
  for (let page = 1; page <= 100; page++) {
    const data = await read(`${path}?ipp=100&page=${page}`, host, leagueId);
    if (Array.isArray(data)) return out.concat(data);
    if (!Array.isArray(data?.results)) throw new Error('LeagueOS returned no standings list.');
    out.push(...data.results);
    if (!data.hasMore) return out;
  }
  throw new Error('Standings pagination did not finish.');
}
function stat(stats, path) {
  const key = String(path || '').replace(/^stats\./, ''), n = (k) => Number(stats[k]) || 0;
  if (typeof stats[key] === 'number') return stats[key];
  if (key === 'winPercentage') return n('wins') / (n('wins') + n('losses') + n('draws') || 1);
  if (key === 'gameWinPercentage') return n('gameWins') / (n('gameWins') + n('gameLosses') + n('gameDraws') || 1);
  if (key === 'totalScoreDelta') return n('totalScore') - n('totalScoreAgainst');
  return n(key);
}
function standingsRows(stage, rosters) {
  const props = (stage.scoringProps || []).filter((p) => p?.path);
  const rows = rosters.filter((r) => r.state === 'confirmed').map((r) => {
    const st = r.stats || {}, n = (k) => Math.max(0, Number(st[k]) || 0);
    const logoUrl = r.sourceId && r.avatar ? `https://images.leagueos.gg/teams/${r.sourceId}/${r.avatar}`
      : r.parent?.id && r.parent?.icon ? `https://images.leagueos.gg/groups/${r.parent.id}/${r.parent.icon}` : '';
    return { id: r.sourceId || r.id || '', name: r.name || '', tag: r.clanTag || '', org: r.parent?.name || '',
      color: r.color || '', colorAlt: r.colorAlt || '', logoUrl,
      w: n('wins'), l: n('losses'), d: n('draws'), gw: n('gameWins'), gl: n('gameLosses'), sf: n('totalScore'), sa: n('totalScoreAgainst'),
      keys: props.map((p) => stat(st, p.path)) };
  });
  const order = (a, b) => {
    for (let i = 0; i < props.length; i++) { const d = a.keys[i] - b.keys[i]; if (d) return props[i].sortDesc ? -d : d; }
    return 0;
  };
  rows.sort((a, b) => order(a, b) || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i && order(rows[i - 1], r) === 0 ? rows[i - 1].rank : i + 1; });
  rows.forEach((r) => { delete r.keys; });
  return { rows, played: rows.some((r) => r.w + r.l + r.d > 0), scored: rows.some((r) => r.sf + r.sa > 0) };
}
async function listSeasons(host, leagueId) {
  return (await paged('/league/seasons', host, leagueId)).map((s) => ({ id: s.id, name: s.name || '', state: s.state,
    activity: String(s.stdAct || '').toLowerCase(), start: (Number(s.dateStart) || 0) * 1000, end: (Number(s.dateEnd) || 0) * 1000 }));
}
async function listStages(host, leagueId, seasonId) { return paged(`/league/seasons/${seasonId}/stages`, host, leagueId); }
async function stageStandings(host, leagueId, stageId) {
  const stage = await read(`/league/stages/${stageId}`, host, leagueId);
  if (!stage || stage.leagueId && stage.leagueId !== leagueId) throw new Error('No stage for that league.');
  const rosters = await paged(`/league/stages/${stageId}/rosters`, host, leagueId);
  return { seasonId: stage.seasonId || stage.eventId || '', stageId, stageName: stage.name || '',
    activity: String(stage.stdAct || '').toLowerCase(), format: stage.format?.method,
    rounds: (stage.rounds || []).map((r) => ({ name: r.name || '', start: Number(r.start) * 1000 || 0, end: Number(r.end) * 1000 || 0 })),
    ...standingsRows(stage, rosters) };
}
module.exports = { listSeasons, listStages, stageStandings, standingsRows };
