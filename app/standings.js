// Match-specific league tables. Keep caches separated by league/season/stage:
// importing a second Rocket League match must never reuse another division.
const necc = require('./necc');
const source = require('./league-standings');

function matchGame(data, games) {
  const activity = String(data.activity || '').toLowerCase();
  const name = String(data.game || '').toLowerCase();
  return games.find((g) => (g.leagueActivity || []).includes(activity) || g.name.toLowerCase() === name);
}

function validContext(c) {
  return c && /(^|\.)leagueos\.gg$/i.test(c.hostname || '') && !/[/:?#]/.test(c.hostname)
    && ['leagueId', 'seasonId', 'stageId'].every((k) => /^[a-z0-9]{12,40}$/i.test(c[k] || ''));
}

function matchContext(data, games) {
  const game = matchGame(data, games);
  if (!game) return null;
  for (const link of Object.values(data.overlayUrls || {})) {
    try {
      const u = new URL(link), seg = u.pathname.split('/').filter(Boolean);
      const c = { hostname: data.hostname, leagueId: data.leagueId, seasonId: data.seasonId || seg[3],
        stageId: data.stageId || seg[4], gameId: game.id, leagueName: data.leagueName || '', seasonName: data.eventName || '' };
      if (u.hostname === 'overlays.leagueos.gg' && seg[0] === 'o' && validContext(c)) return c;
    } catch { /* Try the next imported graphic. */ }
  }
  return null;
}

function currentWeek(rounds, now = Date.now()) {
  const named = (rounds || []).filter((r) => r.start && r.end > r.start).sort((a, b) => a.start - b.start);
  const label = (r) => String(r.name || '').replace(/^Round\s+(\d+)$/i, 'Week $1');
  const active = named.find((r) => r.start <= now && now < r.end);
  if (active) return label(active);
  if (!named.length) return 'Week unavailable';
  if (now < named[0].start) return 'Upcoming · ' + label(named[0]);
  const next = named.find((r) => r.start > now);
  return next ? 'Break · next ' + label(next) : 'Stage complete';
}

function sourceKey(c) { return [c.hostname, c.leagueId, c.seasonId || c.gameId || '', c.stageId || ''].join('/'); }

function playoffRule(profiles, leagueId, seasonId, stageId, activity, format) {
  if (format !== 0) return null;
  return (profiles.find((p) => p.league.id === leagueId)?.league.playoffs || []).find((r) =>
    r.seasonId === seasonId && (r.stageId === stageId || r.stageIds?.includes(stageId)) && (!r.activity || r.activity === activity)
    && Number.isInteger(r.spots) && r.spots > 0 && /^https:\/\//.test(r.source || '')) || null;
}

function createStandings({ profile, profiles, read, write, getState, publish, cacheRow }) {
  const stored = read() || {};
  const tables = stored.v === 3 ? stored.tables || {} : {};
  const inflight = new Map();
  const defaults = new Map();
  const known = profiles.filter((p) => p.league.site && p.league.id);
  function context(gameId) {
    const state = getState();
    if (state.leagueMatch?.gameId === gameId && validContext(state.leagueMatch)) return state.leagueMatch;
    // Saved matches made before leagueMatch existed already contain this chain.
    if (gameId === state.game) {
      for (const link of Object.values(state.neccUrls || {})) {
        try {
          const u = new URL(link), seg = u.pathname.split('/').filter(Boolean);
          const p = known.find((x) => x.league.id === seg[2]);
          const c = { hostname: p && new URL(p.league.site).hostname, leagueId: seg[2], seasonId: seg[3], stageId: seg[4], leagueName: p?.league.name };
          if (u.hostname === 'overlays.leagueos.gg' && seg[0] === 'o' && validContext(c)) return c;
        } catch { /* An absent or malformed graphic does not select a league. */ }
      }
    }
    return { hostname: profile.league.site ? new URL(profile.league.site).hostname : '', leagueId: profile.league.id || '', gameId };
  }
  function table(gameId) {
    const c = context(gameId);
    const t = tables[sourceKey(c)];
    return t ? { ...t, week: currentWeek(t.rounds), playoffs: playoffRule(known, c.leagueId, t.seasonId, t.stageId, t.activity, t.format) }
      : { rows: [], site: c.hostname, leagueName: c.leagueName || profile.league.name };
  }
  function snapshot() {
    return { standings: Object.fromEntries(profile.games.map((g) => [g.id, table(g.id)])), site: table(getState().game).site || '' };
  }
  async function refresh(gameId, force = false) {
    const game = profile.games.find((g) => g.id === gameId);
    if (!game || !profile.leagueScenes.length) return null;
    const c = context(gameId), key = sourceKey(c), have = tables[key];
    if (!c.hostname || !c.leagueId) return null;
    if (!force && have && Date.now() - Date.parse(have.checkedAt || 0) < 60000) return have;
    if (inflight.has(key)) return inflight.get(key);
    const job = (async () => {
      const at = new Date().toISOString();
      try {
        let seasonId = c.seasonId, stageId = c.stageId, seasonName = '';
        if (!stageId) {
          // Cache discovery briefly; refuse to pick a random NECC division.
          let picked = defaults.get(key);
          if (!picked || Date.now() - picked.at > 6 * 3600000) {
            const seasons = await source.listSeasons(c.hostname, c.leagueId);
            const candidates = seasons.filter((s) => s.state !== 0 && s.state !== 4 && ((game.leagueActivity || []).includes(s.activity) || s.name.toLowerCase().includes(game.name.toLowerCase())));
            const running = candidates.filter((s) => s.start <= Date.now() && (!s.end || s.end >= Date.now()));
            if (running.length > 1) throw new Error('Import a match to select its league division.');
            const season = necc.pickSeason(running.length ? running : candidates, game.leagueActivity, game.name);
            if (!season) throw new Error(`No ${game.name} season is published by this league.`);
            const stages = (await source.listStages(c.hostname, c.leagueId, season.id)).filter((s) => s.state !== 0 && s.state !== 4 && s.format?.method === 0);
            if (stages.length !== 1) throw new Error('Import a match to select its standings group.');
            picked = { seasonId: season.id, seasonName: season.name, stageId: stages[0].id, at: Date.now() };
            defaults.set(key, picked);
          }
          ({ seasonId, seasonName, stageId } = picked);
        }
        const st = await source.stageStandings(c.hostname, c.leagueId, stageId);
        if (st.seasonId !== seasonId) throw new Error('The standings stage belongs to a different season.');
        if (st.activity && game.leagueActivity?.length && !game.leagueActivity.includes(st.activity)) throw new Error('The standings stage is for a different game. Import this match again.');
        const named = known.find((p) => p.league.id === c.leagueId);
        // Only verified, stage-specific rules may mark the playoff line. A
        // default bracketSize in LeagueOS is not a qualification rule.
        const rule = playoffRule(known, c.leagueId, seasonId, stageId, st.activity, st.format);
        tables[key] = { ...st, rows: await Promise.all(st.rows.map(cacheRow)), seasonName: seasonName || c.seasonName || '',
          site: c.hostname, leagueName: c.leagueName || named?.league.name || c.hostname.split('.')[0].toUpperCase(),
          sourceKey: key, sourceUrl: `https://${c.hostname}/league/stages/${stageId}/standings`,
          week: currentWeek(st.rounds), playoffs: st.format === 0 && rule ? rule : null,
          scoreName: game.scoreName || '', updatedAt: at, checkedAt: at, error: '' };
      } catch (e) {
        tables[key] = { rows: [], ...(have || {}), site: c.hostname, checkedAt: at, error: String(e.message || e).slice(0, 200) };
      }
      write({ v: 3, tables });
      publish(snapshot());
      return tables[key];
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  }
  return { snapshot, refresh, context };
}

module.exports = { createStandings, currentWeek, sourceKey, validContext, matchGame, matchContext, playoffRule };
