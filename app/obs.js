// OBS integration (obs-websocket v5). Since v2.0.0 the app is OBS-first: OBS
// is the switcher, and the app builds and maintains everything OBS shows.
//
// - Setup creates (or reuses) a scene collection for the league, so the
//   app's scenes never mix with someone's own.
// - One scene per overlay, each holding one locked browser source at
//   /overlay?view=<view>: Starting Soon, Post-Match, Rosters, Be Right Back,
//   Scoreboard (with a Game Capture under it), a stats scene when the match's
//   game has one (Rocket League), the league's own scenes (Standings, Head to
//   Head) and one scene per league graphic the operator picked (Bracket,
//   Match Preview...). A build also removes the app's scenes the match no
//   longer uses, so OBS only ever lists what this match can show.
// - The league's stinger: the app selects the operator's Stinger transition
//   and points it at the league's video with the right cut point.
// - The app reports which scene is on program (the panel's On air readout,
//   music, Post-Match's countdown) and switches scenes itself only where it
//   helps: to Rocket League Stats after a game, and back for the next one.
//
// Everything fails soft: OBS being unreachable or a call failing must never
// crash the app or stop the overlays, which the server keeps serving.
//
// SECURITY: the obs-websocket password is a secret. It is held in memory only
// for the life of a connection, never persisted server-side, and never logged.

const { OBSWebSocket } = require('obs-websocket-js');

// Scenes for the base overlays. `key` identifies a scene in the app (a view,
// or necc:<type> for a league graphic). Names are the idempotency key: a
// rebuild reuses anything already matching instead of duplicating it.
const BASE_VIEWS = {
  'starting-soon': { label: 'Starting Soon', src: 'starting-soon' },
  roster: { label: 'Rosters', src: 'roster' },
  // Transparent: the game capture sits under the browser source. It was
  // Smash-only in v0.8.0; the legacy names are renamed in place on a build.
  scoreboard: { label: 'Scoreboard', src: 'scoreboard', legacy: 'Smash Scoreboard', legacySrc: 'smash' },
  brb: { label: 'Be Right Back', src: 'brb' },
  'post-match': { label: 'Post-Match', src: 'post-match' },
};
const STATS_VIEW = { view: 'stats', label: 'Rocket League Stats', src: 'stats' };
// The league's own scenes (a profile's leagueScenes): drawn by the app from
// the standings kept on the League page.
const LEAGUE_VIEWS = [
  { view: 'matchup', label: 'Head to Head', src: 'matchup' },
  { view: 'standings', label: 'Standings', src: 'standings' },
];

// The scenes this match uses, in the order a stream runs through them, which
// is the order they sit in OBS from top to bottom (and in the panel's list):
// the countdown, the pre-game scenes (rosters, the league's comparison and
// table, the league graphics), the game and its stats, the break card, and
// the sign-off at the bottom.
function sceneEntries(prefix, opts) {
  const base = (view) => {
    const v = BASE_VIEWS[view];
    return {
      key: view, view,
      scene: `${prefix}: ${v.label}`, input: `${prefix}-src-${v.src}`,
      legacy: v.legacy ? { scene: `${prefix}: ${v.legacy}`, input: `${prefix}-src-${v.legacySrc}` } : null,
    };
  };
  const list = [base('starting-soon'), base('roster')];
  LEAGUE_VIEWS.filter((v) => (opts.leagueScenes || []).includes(v.view)).forEach((v) => {
    list.push({ key: v.view, view: v.view, scene: `${prefix}: ${v.label}`, input: `${prefix}-src-${v.src}` });
  });
  (opts.neccTypes || []).forEach((t) => {
    list.push({
      key: `necc:${t.key}`, view: 'necc', necc: t.key,
      scene: `${prefix}: ${t.label}`, input: `${prefix}-src-necc-${t.key}`,
    });
  });
  list.push(base('scoreboard'));
  if (opts.includeStats) {
    list.push({ key: 'stats', view: 'stats', scene: `${prefix}: ${STATS_VIEW.label}`, input: `${prefix}-src-stats` });
  }
  list.push(base('brb'), base('post-match'));
  return list;
}

// Background music (v0.11.0): ONE media source shared by every app scene, so
// a scene switch never restarts it. The server decides when it is heard
// (fadeMusic), since the Rocket League menus count as "no gameplay".
const MUSIC_OFF_DB = -60;
function musicSettings(file) {
  return {
    is_local_file: true, local_file: file, looping: true,
    restart_on_activate: false, close_when_inactive: false, clear_on_media_end: false,
  };
}

// How long to wait between reconnect attempts after OBS goes away.
const RECONNECT_MS = 5000;

// opts: getOverlayBase() -> "http://localhost:<port>", prefix ("WU"),
// collection (scene collection name), stingerName (the OBS transition name
// to look for), allNeccTypes (every league graphic there is, so an unpicked
// one's scene can be removed), onProgram({ key, view, necc, scene }) when the
// program scene changes.
function createObs(opts = {}) {
  const prefix = opts.prefix || 'APP';
  const getOverlayBase = opts.getOverlayBase || (() => 'http://localhost:4310');
  const onProgram = opts.onProgram || (() => {});
  const collectionName = opts.collection || `${prefix} Stream`;
  const stingerName = opts.stingerName || `${prefix} Stinger`;
  const musicInput = `${prefix}: Music`;
  const captureInput = `${prefix}-game-capture`;
  const obs = new OBSWebSocket();

  // The scenes this match uses (the server's build options), and every scene
  // the app could ever make: the difference is what a build removes.
  let scenes = sceneEntries(prefix, { includeStats: false, neccTypes: [] });
  const everyScene = () => sceneEntries(prefix, {
    includeStats: true, leagueScenes: LEAGUE_VIEWS.map((v) => v.view), neccTypes: opts.allNeccTypes || [],
  });
  function staleEntries() {
    const wanted = new Set(scenes.map((s) => s.key));
    return everyScene().filter((s) => !wanted.has(s.key));
  }
  let connected = false;
  // Set by a successful connect and cleared only by an explicit Disconnect.
  // While set, a dropped connection (OBS closed or restarted) is retried in
  // the background. Held in memory only, like the password inside it.
  let wanted = null;
  let reconnectTimer = null;
  let reconnecting = false;
  let currentScene = '';
  let lastError = '';
  // What the music should be doing; applied on connect, build and change.
  let music = { file: '', db: -18, on: false };
  let musicApplied = null;
  let fadeTimer = null;

  function entryForScene(name) {
    return scenes.find((s) => s.scene === name || (s.legacy && s.legacy.scene === name)) || null;
  }
  function entryForKey(key) { return scenes.find((s) => s.key === key) || null; }

  function reportProgram() {
    const t = entryForScene(currentScene);
    try { onProgram(t ? { key: t.key, view: t.view, necc: t.necc || '', scene: currentScene } : { key: '', view: '', necc: '', scene: currentScene }); }
    catch (e) { /* never break OBS events */ }
  }

  obs.on('ConnectionClosed', () => {
    const was = connected;
    connected = false;
    currentScene = '';
    if (was && wanted) scheduleReconnect();
    reportProgram();
  });
  obs.on('CurrentProgramSceneChanged', (d) => {
    currentScene = (d && (d.sceneName || d.currentProgramSceneName)) || currentScene;
    reportProgram();
  });
  // A renamed scene on program is still the scene on program (a build
  // renames one as it puts the scenes in order).
  obs.on('SceneNameChanged', (d) => {
    if (d && d.oldSceneName === currentScene) { currentScene = d.sceneName; reportProgram(); }
  });
  obs.on('CurrentSceneCollectionChanged', () => { refreshProgram(); });

  async function refreshProgram() {
    try {
      const r = await obs.call('GetCurrentProgramScene');
      currentScene = r.currentProgramSceneName || r.sceneName || '';
    } catch (e) { /* non-fatal */ }
    reportProgram();
  }

  function onAir() {
    const t = entryForScene(currentScene);
    return t ? { key: t.key, view: t.view, necc: t.necc || '' } : { key: '', view: '', necc: '' };
  }

  function status() {
    return {
      connected, reconnecting: !connected && reconnecting, currentScene, onAir: onAir(),
      collection: collectionName, stingerName, error: lastError,
      scenes: scenes.map((s) => ({ key: s.key, scene: s.scene })),
    };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnecting = true;
    reconnectTimer = setTimeout(async () => {
      if (!wanted || connected) { reconnecting = false; return; }
      try {
        await connect(wanted, true);
      } catch (e) {
        scheduleReconnect();
      }
    }, RECONNECT_MS);
  }

  function disconnectQuiet() {
    try { obs.disconnect(); } catch (e) { /* not connected */ }
    connected = false;
    currentScene = '';
  }

  // cfg.retry (the panel's automatic connect when the app starts) keeps trying
  // in the background if OBS isn't open yet, instead of giving up.
  async function connect(cfg = {}, fromRetry = false) {
    clearTimeout(reconnectTimer);
    disconnectQuiet();
    const host = cfg.host || '127.0.0.1';
    const port = cfg.port || 4455;
    const url = `ws://${host}:${port}`;
    try {
      // Empty password -> undefined, so an unauthenticated OBS server works.
      await obs.connect(url, cfg.password || undefined);
      connected = true;
      reconnecting = false;
      lastError = '';
      wanted = { ...cfg };
      await refreshProgram();
      musicApplied = null;
      applyMusic(0).catch(() => {});
      return status();
    } catch (e) {
      connected = false;
      // Never surface the password even if it were somehow in the message.
      lastError = scrub(e && e.message ? e.message : String(e), cfg.password);
      if (cfg.retry && !fromRetry) { wanted = { ...cfg }; scheduleReconnect(); }
      const err = new Error(lastError);
      err.soft = true;
      throw err;
    }
  }

  function disconnect() {
    wanted = null;
    reconnecting = false;
    clearTimeout(reconnectTimer);
    disconnectQuiet();
    reportProgram();
    return status();
  }

  async function videoBase() {
    try {
      const v = await obs.call('GetVideoSettings');
      return { w: v.baseWidth || 1920, h: v.baseHeight || 1080 };
    } catch (e) {
      return { w: 1920, h: 1080 };
    }
  }

  // Stretch a scene item over the whole canvas. Non-fatal if it fails.
  async function fitItem(sceneName, sceneItemId, base) {
    try {
      await obs.call('SetSceneItemTransform', {
        sceneName,
        sceneItemId,
        sceneItemTransform: {
          positionX: 0, positionY: 0,
          boundsType: 'OBS_BOUNDS_STRETCH',
          boundsWidth: base.w, boundsHeight: base.h,
          boundsAlignment: 0,
        },
      });
    } catch (e) { /* non-fatal */ }
  }

  // Switch to the league's own scene collection, creating it the first time.
  // Creating one switches to it; both calls return once OBS has finished.
  async function useCollection() {
    const r = await obs.call('GetSceneCollectionList');
    if (r.currentSceneCollectionName === collectionName) return 'current';
    if ((r.sceneCollections || []).includes(collectionName)) {
      await obs.call('SetCurrentSceneCollection', { sceneCollectionName: collectionName });
      return 'switched';
    }
    await obs.call('CreateSceneCollection', { sceneCollectionName: collectionName });
    return 'created';
  }

  async function ensureBrowserSource(t, base, url, existingInputs) {
    if (!existingInputs.has(t.input)) {
      // CreateInput both creates the browser source AND adds it to the scene.
      // It keeps running while off program, so a scene is ready the moment
      // it is cut to.
      const created = await obs.call('CreateInput', {
        sceneName: t.scene,
        inputName: t.input,
        inputKind: 'browser_source',
        inputSettings: { url, width: base.w, height: base.h, shutdown: false, restart_when_active: false },
        sceneItemEnabled: true,
      });
      existingInputs.add(t.input);
      await fitItem(t.scene, created.sceneItemId, base);
      return 'created';
    }
    await obs.call('SetInputSettings', { inputName: t.input, inputSettings: { url, width: base.w, height: base.h }, overlay: true });
    // A source that was already there still holds the page it loaded, which
    // after an app update is the old version's. Press its "Refresh cache of
    // current page" button, so every build leaves the scenes on this version.
    let reloaded = false;
    try {
      await obs.call('PressInputPropertiesButton', { inputName: t.input, propertyName: 'refreshnocache' });
      reloaded = true;
    } catch (e) { /* non-fatal: the page also reloads itself on a new version */ }
    let sceneItemId;
    try {
      ({ sceneItemId } = await obs.call('GetSceneItemId', { sceneName: t.scene, sourceName: t.input }));
    } catch (e) {
      ({ sceneItemId } = await obs.call('CreateSceneItem', { sceneName: t.scene, sourceName: t.input, sceneItemEnabled: true }));
    }
    await fitItem(t.scene, sceneItemId, base);
    return reloaded ? 'reloaded' : 'kept';
  }

  // The Scoreboard scene's game capture, under the browser source. "Capture
  // any fullscreen application" picks up the game (or the spectator client)
  // with no setup; the operator can point it at one window in OBS instead.
  async function ensureGameCapture(sceneName, existingInputs) {
    const kinds = await obs.call('GetInputKindList', { unversioned: true }).catch(() => ({ inputKinds: [] }));
    if (!(kinds.inputKinds || []).includes('game_capture')) return 'manual';
    let sceneItemId;
    let made = 'exists';
    if (!existingInputs.has(captureInput)) {
      ({ sceneItemId } = await obs.call('CreateInput', {
        sceneName, inputName: captureInput, inputKind: 'game_capture',
        inputSettings: { capture_mode: 'any_fullscreen', capture_cursor: false, allow_transparency: false },
        sceneItemEnabled: true,
      }));
      existingInputs.add(captureInput);
      made = 'created';
    } else {
      try {
        ({ sceneItemId } = await obs.call('GetSceneItemId', { sceneName, sourceName: captureInput }));
      } catch (e) {
        ({ sceneItemId } = await obs.call('CreateSceneItem', { sceneName, sourceName: captureInput, sceneItemEnabled: true }));
      }
    }
    // Bottom of the scene, under the transparent scoreboard.
    try { await obs.call('SetSceneItemIndex', { sceneName, sceneItemId, sceneItemIndex: 0 }); } catch (e) { /* non-fatal */ }
    return made;
  }

  // --- Scene order ------------------------------------------------------------
  // OBS lists the app's scenes in stream order, top to bottom (sceneEntries).
  // obs-websocket has no request that moves a scene in the list: a new scene
  // always lands at the bottom. So a build finds how far down the list is
  // already right, and makes everything after that in order: a missing scene
  // is created, and one that exists in the wrong place is rebuilt at the
  // bottom (moveSceneToBottom), each landing under the last.

  const movingName = (name) => `${name} (moving)`;

  // The scene list as OBS shows it, top first. obs-websocket numbers scenes
  // from the bottom (sceneIndex 0 is the lowest).
  async function sceneOrder() {
    const r = await obs.call('GetSceneList');
    const list = (r.scenes || []).slice();
    if (list.every((s) => Number.isFinite(s.sceneIndex))) list.sort((a, b) => b.sceneIndex - a.sceneIndex);
    else list.reverse();
    return list.map((s) => s.sceneName);
  }

  // Why the app's scenes can't be reordered right now, or '' when they can.
  // A scene is rebuilt by copying its sources into a new one, so nothing may
  // be on air, and a scene that holds a group or sits inside another scene is
  // left alone (a copy would lose those).
  async function reorderBlocker(names, allScenes) {
    const live = await Promise.all(['GetStreamStatus', 'GetRecordStatus'].map((req) => obs.call(req).then((s) => !!s.outputActive).catch(() => false)));
    if (live.some(Boolean)) return 'live';
    const moving = new Set(names);
    for (const sceneName of allScenes) {
      let items = [];
      try { items = (await obs.call('GetSceneItemList', { sceneName })).sceneItems || []; } catch (e) { continue; }
      if (moving.has(sceneName) && items.some((it) => it.isGroup)) return 'custom';
      if (items.some((it) => moving.has(it.sourceName))) return 'custom';
    }
    return '';
  }

  // Rebuilds one scene at the bottom of the list without losing what is in
  // it: a new scene gets every source of the old one (same sources, same
  // position, size, crop, order, visibility, lock and blend), the scene's own
  // filters and its transition override; then the old scene goes and the new
  // one takes its name. Sources are shared, not recreated, so a game capture
  // pointed at one window stays pointed at it. What OBS doesn't let an app
  // copy is a hotkey set on the scene itself.
  async function moveSceneToBottom(name) {
    const tmp = movingName(name);
    try { await obs.call('RemoveScene', { sceneName: tmp }); } catch (e) { /* no leftover */ }
    await obs.call('CreateScene', { sceneName: tmp });
    try {
      const items = ((await obs.call('GetSceneItemList', { sceneName: name })).sceneItems || [])
        .slice().sort((a, b) => a.sceneItemIndex - b.sceneItemIndex);
      // Bottom source first: each copy lands on top of the last.
      for (const it of items) {
        const copy = await obs.call('DuplicateSceneItem', { sceneName: name, sceneItemId: it.sceneItemId, destinationSceneName: tmp });
        if (it.sceneItemLocked) await obs.call('SetSceneItemLocked', { sceneName: tmp, sceneItemId: copy.sceneItemId, sceneItemLocked: true }).catch(() => {});
        if (it.sceneItemBlendMode && it.sceneItemBlendMode !== 'OBS_BLEND_NORMAL') {
          await obs.call('SetSceneItemBlendMode', { sceneName: tmp, sceneItemId: copy.sceneItemId, sceneItemBlendMode: it.sceneItemBlendMode }).catch(() => {});
        }
      }
      const filters = ((await obs.call('GetSourceFilterList', { sourceName: name }).catch(() => ({}))).filters || [])
        .slice().sort((a, b) => a.filterIndex - b.filterIndex);
      for (const f of filters) {
        await obs.call('CreateSourceFilter', { sourceName: tmp, filterName: f.filterName, filterKind: f.filterKind, filterSettings: f.filterSettings });
        if (f.filterEnabled === false) await obs.call('SetSourceFilterEnabled', { sourceName: tmp, filterName: f.filterName, filterEnabled: false }).catch(() => {});
      }
      const over = await obs.call('GetSceneSceneTransitionOverride', { sceneName: name }).catch(() => null);
      if (over && over.transitionName) {
        await obs.call('SetSceneSceneTransitionOverride', { sceneName: tmp, transitionName: over.transitionName, transitionDuration: over.transitionDuration }).catch(() => {});
      }
    } catch (e) {
      // Nothing has been taken away yet: drop the half-made copy and leave
      // the scene where it was.
      try { await obs.call('RemoveScene', { sceneName: tmp }); } catch (e2) { /* ignore */ }
      throw e;
    }
    // Program and preview follow the scene across, so OBS shows the same thing.
    const program = await obs.call('GetCurrentProgramScene').then((r) => r.currentProgramSceneName || r.sceneName).catch(() => '');
    if (program === name) await obs.call('SetCurrentProgramScene', { sceneName: tmp }).catch(() => {});
    const preview = await obs.call('GetCurrentPreviewScene').then((r) => r.currentPreviewSceneName || r.sceneName).catch(() => '');
    if (preview === name) await obs.call('SetCurrentPreviewScene', { sceneName: tmp }).catch(() => {});
    await obs.call('RemoveScene', { sceneName: name });
    await obs.call('SetSceneName', { sceneName: tmp, newSceneName: name });
  }

  // Build or update everything. opts: { neccTypes: [{ key, label }],
  // includeStats, leagueScenes, gameCapture, studioMode, orderScenes }. Safe
  // to run again: scenes and sources are reused by name, URLs and sizes are
  // corrected, nothing is duplicated, and scenes the operator added are left
  // alone. The app's own scenes that this match doesn't use (the stats scene
  // of another game, a league graphic that was unticked) are removed, and its
  // scenes are put in stream order (see Scene order above).
  async function buildScenes(buildOpts = {}) {
    if (!connected) throw softError('Not connected to OBS');
    const collection = await useCollection();
    scenes = sceneEntries(prefix, buildOpts);
    const base = await videoBase();
    const overlayBase = getOverlayBase();

    let order = await sceneOrder();
    const existingScenes = new Set(order);
    const inputList = await obs.call('GetInputList');
    const existingInputs = new Set((inputList.inputs || []).map((i) => i.inputName));

    // Names first, so the order below is judged on the scenes as they are
    // now called: v0.8's Smash Scoreboard, and a move that was cut short.
    for (const t of scenes) {
      if (t.legacy) {
        if (!existingScenes.has(t.scene) && existingScenes.has(t.legacy.scene)) {
          await obs.call('SetSceneName', { sceneName: t.legacy.scene, newSceneName: t.scene });
          existingScenes.delete(t.legacy.scene);
          existingScenes.add(t.scene);
        }
        if (!existingInputs.has(t.input) && existingInputs.has(t.legacy.input)) {
          await obs.call('SetInputName', { inputName: t.legacy.input, newInputName: t.input });
          existingInputs.delete(t.legacy.input);
          existingInputs.add(t.input);
        }
      }
      const tmp = movingName(t.scene);
      if (existingScenes.has(tmp)) {
        try {
          if (existingScenes.has(t.scene)) await obs.call('RemoveScene', { sceneName: tmp });
          else { await obs.call('SetSceneName', { sceneName: tmp, newSceneName: t.scene }); existingScenes.add(t.scene); }
        } catch (e) { /* non-fatal */ }
        existingScenes.delete(tmp);
      }
    }
    order = (await sceneOrder()).filter((n) => existingScenes.has(n));

    // How many scenes, from the top of the wanted order, are already in
    // place. Everything after them is created or moved, in order.
    let inPlace = 0;
    for (let last = -1; inPlace < scenes.length; inPlace++) {
      const pos = order.indexOf(scenes[inPlace].scene);
      if (pos < last || pos < 0) break;
      last = pos;
    }
    const toMove = scenes.slice(inPlace).filter((t) => existingScenes.has(t.scene)).map((t) => t.scene);
    // 'ordered' (nothing to move), 'moved', 'off' (the option is off), or why
    // not: 'live' (streaming or recording), 'custom' (a group, or a scene
    // used inside another), 'failed'.
    let ordering = 'ordered';
    if (toMove.length) {
      if (buildOpts.orderScenes === false) ordering = 'off';
      else ordering = (await reorderBlocker(toMove, order).catch(() => 'failed')) || 'moved';
    }
    const moved = [];

    const built = [];
    let reloaded = 0;
    for (let i = 0; i < scenes.length; i++) {
      const t = scenes[i];
      const url = `${overlayBase}/overlay?view=${t.view}${t.necc ? `&necc=${encodeURIComponent(t.necc)}` : ''}`;
      if (!existingScenes.has(t.scene)) {
        await obs.call('CreateScene', { sceneName: t.scene });
        existingScenes.add(t.scene);
      } else if (i >= inPlace && ordering === 'moved') {
        try { await moveSceneToBottom(t.scene); moved.push(t.scene); }
        catch (e) { ordering = 'failed'; }
      }
      if ((await ensureBrowserSource(t, base, url, existingInputs)) === 'reloaded') reloaded++;
      built.push(t.scene);
    }

    let gameCapture = 'skipped';
    if (buildOpts.gameCapture !== false) {
      const sb = entryForKey('scoreboard');
      gameCapture = await ensureGameCapture(sb.scene, existingInputs).catch(() => 'manual');
    }

    // The shared music source, in every app scene. Created silent;
    // applyMusic() then fades it to wherever it should be.
    if (music.file) {
      if (!existingInputs.has(musicInput)) {
        await obs.call('CreateInput', {
          sceneName: scenes[0].scene, inputName: musicInput, inputKind: 'ffmpeg_source',
          inputSettings: musicSettings(music.file), sceneItemEnabled: true,
        });
        existingInputs.add(musicInput);
        try { await obs.call('SetInputVolume', { inputName: musicInput, inputVolumeDb: MUSIC_OFF_DB }); } catch (e) { /* non-fatal */ }
      } else {
        await obs.call('SetInputSettings', { inputName: musicInput, inputSettings: musicSettings(music.file), overlay: true });
      }
      for (const t of scenes) {
        try { await obs.call('GetSceneItemId', { sceneName: t.scene, sourceName: musicInput }); }
        catch (e) { await obs.call('CreateSceneItem', { sceneName: t.scene, sourceName: musicInput, sceneItemEnabled: true }); }
      }
      built.push(musicInput);
      musicApplied = null;
      applyMusic(0).catch(() => {});
    }

    // A new collection starts on OBS's empty "Scene": go to Starting Soon and
    // remove it, so the collection holds only the app's scenes.
    await refreshProgram();
    const stale = staleEntries();
    if (!entryForScene(currentScene) && (collection === 'created' || stale.some((t) => t.scene === currentScene))) {
      try { await obs.call('SetCurrentProgramScene', { sceneName: scenes[0].scene }); } catch (e) { /* non-fatal */ }
    }
    // Scenes of the app's that this match doesn't use. The source goes
    // first, so nothing keeps loading a page nobody can see.
    const removed = [];
    for (const t of stale) {
      if (existingInputs.has(t.input)) {
        try { await obs.call('RemoveInput', { inputName: t.input }); } catch (e) { /* non-fatal */ }
      }
      if (existingScenes.has(t.scene)) {
        try { await obs.call('RemoveScene', { sceneName: t.scene }); removed.push(t.scene); } catch (e) { /* non-fatal */ }
      }
    }
    if (collection === 'created' && existingScenes.has('Scene')) {
      try {
        const items = await obs.call('GetSceneItemList', { sceneName: 'Scene' });
        if (!(items.sceneItems || []).length) await obs.call('RemoveScene', { sceneName: 'Scene' });
      } catch (e) { /* non-fatal */ }
    }
    if (buildOpts.studioMode) {
      try { await obs.call('SetStudioModeEnabled', { studioModeEnabled: true }); } catch (e) { /* non-fatal */ }
    }
    await refreshProgram();
    return { built, removed, reloaded, ordering, moved, gameCapture, collection, collectionName };
  }

  // The league's stinger. obs-websocket can't create a transition, so the
  // operator adds a Stinger transition named `stingerName` once (the setup
  // guide shows how); from then on the app finds it, makes it OBS's current
  // transition and points it at the league's video with the right cut point.
  // st: { file, transitionPoint (ms), trackMatte }.
  async function setupStinger(st) {
    if (!connected) throw softError('Not connected to OBS');
    const r = await obs.call('GetSceneTransitionList');
    const t = (r.transitions || []).find((x) => x.transitionName === stingerName);
    if (!t) return { found: false, name: stingerName, current: r.currentSceneTransitionName || '' };
    if (t.transitionKind && t.transitionKind !== 'obs_stinger_transition') {
      return { found: true, configured: false, name: stingerName, error: `"${stingerName}" is not a Stinger transition` };
    }
    await obs.call('SetCurrentSceneTransition', { transitionName: stingerName });
    await obs.call('SetCurrentSceneTransitionSettings', {
      transitionSettings: {
        path: st.file,
        tp_type: 0,                          // transition point in milliseconds
        transition_point: st.transitionPoint,
        track_matte_enabled: !!st.trackMatte,
        track_matte_layout: 0,               // matte beside the video, same file
      },
      overlay: true,
    });
    return { found: true, configured: true, name: stingerName };
  }

  async function stingerStatus() {
    if (!connected) return { found: false, current: false, name: stingerName };
    try {
      const r = await obs.call('GetSceneTransitionList');
      const found = (r.transitions || []).some((x) => x.transitionName === stingerName);
      return { found, current: r.currentSceneTransitionName === stingerName, name: stingerName };
    } catch (e) { return { found: false, current: false, name: stingerName }; }
  }

  // Fade the music source to a level in dB (null = silent) over `ms`. Steps
  // in dB, so it sounds even; the last step of a fade-out is a true zero.
  async function fadeMusic(toDb, ms) {
    let from;
    try { from = (await obs.call('GetInputVolume', { inputName: musicInput })).inputVolumeDb; }
    catch (e) { return false; } // no music source (scenes not built yet)
    if (!Number.isFinite(from)) from = MUSIC_OFF_DB;
    const target = toDb === null ? MUSIC_OFF_DB : toDb;
    clearInterval(fadeTimer);
    const steps = Math.max(1, Math.round(ms / 50));
    let i = 0;
    const step = () => {
      i++;
      const done = i >= steps;
      const vol = done && toDb === null ? { inputVolumeMul: 0 } : { inputVolumeDb: from + (target - from) * (i / steps) };
      obs.call('SetInputVolume', { inputName: musicInput, ...vol }).catch(() => {});
      if (done) clearInterval(fadeTimer);
    };
    if (steps === 1) step(); else fadeTimer = setInterval(step, 50);
    return true;
  }

  // Bring OBS in line with `music`: the right file, playing, at the right
  // level. Skips anything that hasn't changed since the last call.
  async function applyMusic(ms = 1500) {
    if (!connected) return;
    const want = { file: music.file, level: music.on ? music.db : null };
    const was = musicApplied;
    musicApplied = want;
    try {
      if (music.file && (!was || was.file !== music.file)) {
        await obs.call('SetInputSettings', { inputName: musicInput, inputSettings: musicSettings(music.file), overlay: true });
      }
      if (music.on) {
        const st = await obs.call('GetMediaInputStatus', { inputName: musicInput });
        if (st.mediaState !== 'OBS_MEDIA_STATE_PLAYING') {
          await obs.call('TriggerMediaInputAction', { inputName: musicInput, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY' });
        }
      }
    } catch (e) { musicApplied = null; return; } // source missing: nothing to do until scenes are built
    if (!was || was.level !== want.level) await fadeMusic(want.level, ms);
  }

  // Server -> desired music state. `fadeMs` is shorter for volume tweaks.
  function setMusic(next, fadeMs) {
    music = { ...music, ...next };
    return applyMusic(fadeMs).catch(() => {});
  }

  // Which of the app's scenes exist in OBS right now, and which are still
  // there that this match doesn't use (`stale`, by scene name).
  async function scenesExist() {
    if (!connected) return { exists: {}, stale: [] };
    try {
      const sceneList = await obs.call('GetSceneList');
      const have = new Set((sceneList.scenes || []).map((s) => s.sceneName));
      const exists = {};
      scenes.forEach((t) => { exists[t.key] = have.has(t.scene) || !!(t.legacy && have.has(t.legacy.scene)); });
      return { exists, stale: staleEntries().filter((t) => have.has(t.scene)).map((t) => t.scene) };
    } catch (e) { return { exists: {}, stale: [] }; }
  }

  // Put one of the app's scenes on program, with OBS's current transition
  // (the league's stinger once set up). `key` is a view or necc:<type>.
  async function switchTo(key) {
    if (!connected) return { switched: false, error: 'Not connected to OBS' };
    const t = entryForKey(key);
    if (!t) return { switched: false, error: `No scene for ${key}` };
    let sceneName = t.scene;
    if (t.legacy) {
      try {
        const list = await obs.call('GetSceneList');
        const names = new Set((list.scenes || []).map((x) => x.sceneName));
        if (!names.has(t.scene) && names.has(t.legacy.scene)) sceneName = t.legacy.scene;
      } catch (e) { /* use the current name */ }
    }
    try {
      await obs.call('SetCurrentProgramScene', { sceneName });
      return { switched: true, scene: sceneName };
    } catch (e) {
      lastError = scrub(e && e.message ? e.message : String(e), '');
      return { switched: false, error: lastError };
    }
  }

  // A small JPEG of what is on program, for the panel's thumbnail.
  async function programShot(width = 480) {
    if (!connected || !currentScene) return null;
    try {
      const r = await obs.call('GetSourceScreenshot', {
        sourceName: currentScene, imageFormat: 'jpg', imageWidth: width, imageCompressionQuality: 70,
      });
      return r.imageData || null;
    } catch (e) { return null; }
  }

  // A richer status that hits OBS live. Safe when disconnected.
  async function inspect() {
    if (!connected) return { ...status(), exists: {}, stale: [], stinger: { found: false, current: false, name: stingerName } };
    await refreshProgram();
    const [have, stinger] = await Promise.all([scenesExist(), stingerStatus()]);
    return { ...status(), exists: have.exists, stale: have.stale, stinger };
  }

  // Which scenes this match uses, without touching OBS. The server sets it
  // at start-up and whenever the game or the picked scenes change; the next
  // build brings OBS in line.
  function setLayout(buildOpts) { scenes = sceneEntries(prefix, buildOpts || {}); }

  return {
    connect, disconnect, status, inspect, buildScenes, setupStinger, stingerStatus,
    switchTo, programShot, setMusic, setLayout,
    isConnected: () => connected,
  };
}

function softError(msg) {
  const e = new Error(msg);
  e.soft = true;
  return e;
}

// Strip a password out of any string before it is shown or logged.
function scrub(msg, password) {
  let out = String(msg || '');
  if (password) out = out.split(password).join('***');
  return out;
}

module.exports = { createObs };
