const path = require('path');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');
const { importMatch } = require('./necc');

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const CONTROL_DIR = path.join(__dirname, 'public', 'control');

const GAMES = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, 'games.json'), 'utf8'));

const DEFAULT_SOCIAL = 'wideneresports';

function emptyTeam() {
  return { name: '', tag: '', color: '', colorAlt: '', logoUrl: '', players: [] };
}

const DEFAULT_STATE = {
  mode: 'starting-soon',
  game: '',
  team: '',
  title: 'Stream Starting Soon',
  status: 'Starting Soon',
  subtitle: '',
  next: '',
  countdownMode: 'duration',
  durationSec: 600,
  layout: 'right',
  clip: '',
  logo: '',
  montage: true,
  neccUrl: '',
  neccType: '',
  socials: {
    twitch: DEFAULT_SOCIAL,
    twitter: DEFAULT_SOCIAL,
    instagram: DEFAULT_SOCIAL,
    youtube: DEFAULT_SOCIAL,
  },
  teamA: emptyTeam(),
  teamB: emptyTeam(),
};

function initialState() {
  return {
    ...DEFAULT_STATE,
    socials: { ...DEFAULT_STATE.socials },
    teamA: emptyTeam(),
    teamB: emptyTeam(),
    end: new Date(Date.now() + DEFAULT_STATE.durationSec * 1000).toISOString(),
  };
}

function normalizeLoaded(raw) {
  if (!raw || typeof raw.mode !== 'string') return null;
  return {
    ...initialState(),
    ...raw,
    socials: { ...DEFAULT_STATE.socials, ...raw.socials },
    teamA: { ...emptyTeam(), ...raw.teamA },
    teamB: { ...emptyTeam(), ...raw.teamB },
  };
}

// dataDir defaults to app/data for standalone `node server.js` use in dev.
// The packaged Electron app passes app.getPath('userData') instead, since the
// app's own install directory lives inside a read-only asar archive.
function createServer(port, opts = {}) {
  const dataDir = opts.dataDir || path.join(__dirname, 'data');
  const stateFile = path.join(dataDir, 'state.json');

  function loadPersisted() {
    try {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch {
      return null;
    }
  }

  function savePersisted() {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ live, draft }, null, 2));
  }

  // "live" is what every OBS Browser Source sees. "draft" is what the control
  // panel's own preview pane sees. Editing only ever touches draft; clicking
  // Push Live is the one moment draft is copied into live (and broadcast to
  // any connected OBS overlays). This is what lets you preview a change
  // before it goes out on stream. Guards against a state.json left over from
  // an older, incompatible schema (e.g. the original single-channel format)
  // by falling back to fresh defaults rather than trusting a shape we don't
  // recognize.
  const persisted = loadPersisted() || {};
  let live = normalizeLoaded(persisted.live) || initialState();
  let draft = normalizeLoaded(persisted.draft) || { ...live };

  function updateChannel(channel, partial) {
    const target = channel === 'live' ? live : draft;
    const next = { ...partial };
    if (next.durationSec != null && next.durationSec !== '') {
      next.end = new Date(Date.now() + Number(next.durationSec) * 1000).toISOString();
    }
    const merged = {
      ...target,
      ...next,
      socials: { ...target.socials, ...(partial.socials || {}) },
      teamA: partial.teamA ? { ...emptyTeam(), ...partial.teamA } : target.teamA,
      teamB: partial.teamB ? { ...emptyTeam(), ...partial.teamB } : target.teamB,
    };
    if (channel === 'live') live = merged; else draft = merged;
    savePersisted();
    return merged;
  }

  // Push Live: draft becomes live, verbatim, so preview and stream match
  // exactly. Deep copy so later draft edits can never alias into live.
  function pushLive() {
    live = JSON.parse(JSON.stringify(draft));
    savePersisted();
    return live;
  }

  // Revert: throw away the in-progress draft and snap the preview back to
  // whatever is currently live on stream.
  function revertDraft() {
    draft = JSON.parse(JSON.stringify(live));
    savePersisted();
    return draft;
  }

  // Key-order-independent stringify so live/draft comparison never produces a
  // false "dirty" just because two equal objects were assembled differently.
  function stableStringify(v) {
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
  }

  // Does the preview differ from what's live? Powers the control panel's
  // "unpushed changes" indicator. In duration countdown mode `end` is a
  // derived timestamp recomputed on every draft edit, so it would always
  // mismatch - ignore it unless someone is actually editing an absolute
  // target time ('at' mode), where `end` IS the content.
  function isDirty() {
    const a = { ...live };
    const b = { ...draft };
    if (a.countdownMode === 'duration' && b.countdownMode === 'duration') {
      delete a.end;
      delete b.end;
    }
    return stableStringify(a) !== stableStringify(b);
  }

  const app = express();
  app.use(express.json());
  app.use('/control', express.static(CONTROL_DIR));
  // Media the overlay itself loads (stinger transition video, etc).
  app.use('/overlay-assets', express.static(path.join(__dirname, 'public', 'overlay-assets')));

  app.get('/games.json', (req, res) => {
    res.sendFile(path.join(TEMPLATES_DIR, 'games.json'));
  });

  app.get('/api/games', (req, res) => res.json(GAMES));

  app.get('/overlay', (req, res) => {
    // OBS's embedded Chromium (CEF) will happily cache this page indefinitely
    // otherwise, which makes edits look "stuck" until the source is manually
    // refreshed. This is the one route that must always be fetched fresh.
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(TEMPLATES_DIR, 'overlay.html'));
  });

  app.get('/api/state', (req, res) => {
    res.json(req.query.channel === 'draft' ? draft : live);
  });

  app.post('/api/necc/import', async (req, res) => {
    const url = req.body && req.body.url;
    if (!url) return res.status(400).json({ error: 'url is required' });
    try {
      const data = await importMatch(url);
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err.message || 'Failed to import match' });
    }
  });

  const server = app.listen(port, () => {
    console.log(`Widener stream overlay server running on http://localhost:${port}`);
  });

  const wss = new WebSocketServer({ server, path: '/ws' });

  // `extra` lets a broadcast carry side-channel fields alongside the state -
  // currently just { transition: 'stinger' } on a Push Live, which tells live
  // overlays to play the curtain stinger and swap content mid-cover.
  function broadcast(channel, data, extra) {
    const payload = JSON.stringify({ type: 'state', channel, data, ...(extra || {}) });
    wss.clients.forEach((client) => {
      if (client.readyState === 1 && client.subscribedChannel === channel) client.send(payload);
    });
  }

  // Tell every control panel (draft subscriber) whether the preview currently
  // differs from live, after anything that could have changed either channel.
  function broadcastDirty() {
    const payload = JSON.stringify({ type: 'dirty', dirty: isDirty() });
    wss.clients.forEach((client) => {
      if (client.readyState === 1 && client.subscribedChannel === 'draft') client.send(payload);
    });
  }

  wss.on('connection', (ws) => {
    ws.subscribedChannel = null;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'subscribe') {
        ws.subscribedChannel = msg.channel === 'draft' ? 'draft' : 'live';
        ws.send(JSON.stringify({ type: 'state', channel: ws.subscribedChannel, data: ws.subscribedChannel === 'draft' ? draft : live }));
        if (ws.subscribedChannel === 'draft') ws.send(JSON.stringify({ type: 'dirty', dirty: isDirty() }));
        return;
      }

      // Every edit - including switching which overlay/mode is showing via
      // the Overlay dropdown - only ever touches draft. Nothing reaches the
      // stream until an explicit Push Live.
      if (msg.type === 'update') {
        const channel = msg.channel === 'draft' ? 'draft' : 'live';
        const newState = updateChannel(channel, msg.data || {});
        broadcast(channel, newState);
        broadcastDirty();
        return;
      }

      if (msg.type === 'push') {
        const newLive = pushLive();
        broadcast('live', newLive, msg.transition === 'stinger' ? { transition: 'stinger' } : undefined);
        broadcast('draft', draft);
        broadcastDirty();
        return;
      }

      // Discard the draft: snap the preview (and the control panel form,
      // which repopulates from the draft broadcast) back to the live state.
      if (msg.type === 'revert') {
        const newDraft = revertDraft();
        broadcast('draft', newDraft);
        broadcastDirty();
      }
    });
  });

  return server;
}

module.exports = { createServer, GAMES };

if (require.main === module) {
  const port = process.env.PORT || 4310;
  createServer(port);
}
