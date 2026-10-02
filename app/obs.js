// Optional OBS integration (obs-websocket v5). This is strictly ADDITIVE and
// opt-in: the app's single-URL live-push model works with zero OBS connection.
// When the operator connects and enables "scene-sync", OBS owns the *between-
// view* transitions (one scene per overlay type, switched with OBS's own
// configured transition e.g. the Widener stinger) while the existing WebSocket
// push keeps driving the *content* inside each view live.
//
// Everything here fails soft: OBS being unreachable, mid-call errors, or a
// user having renamed things must never block a Push Live or crash the app.
//
// SECURITY: the obs-websocket password is a secret. It is held in memory only
// for the life of a connection, never persisted server-side, and never logged.

const { OBSWebSocket } = require('obs-websocket-js');

// One scene per overlay type, each holding a single locked browser source at
// /overlay?view=<view>. Names are the stable idempotency key - re-running
// "build scenes" reuses anything already matching these names instead of
// duplicating. Switching overlay type becomes a scene switch; the pushed state
// still updates the content inside whichever scene is live.
const SCENES = [
  { view: 'starting-soon', scene: 'WU: Starting Soon', input: 'WU-src-starting-soon' },
  { view: 'post-match',    scene: 'WU: Post-Match',    input: 'WU-src-post-match' },
  { view: 'roster',        scene: 'WU: Rosters',       input: 'WU-src-roster' },
  { view: 'brb',           scene: 'WU: Be Right Back', input: 'WU-src-brb' },
  // Transparent scoreboard: the game capture goes in this scene *under* the
  // browser source, so it's the one scene the operator adds their own source to.
  // It was Smash-only in v0.8.0; `legacy` names are renamed in place on the
  // next build so the operator's game capture inside it is kept.
  { view: 'scoreboard',    scene: 'WU: Scoreboard',    input: 'WU-src-scoreboard',
    legacy: { scene: 'WU: Smash Scoreboard', input: 'WU-src-smash' } },
  // One NECC scene covers every NECC overlay type: the locked page reads the
  // pushed neccUrl, so picking bracket vs match-preview is a live content
  // update inside this same scene, not a new scene.
  { view: 'necc',          scene: 'WU: NECC',          input: 'WU-src-necc' },
];

// Background music (v0.11.0): ONE media source shared by every WU scene.
// Because it is the same source everywhere, a scene switch never restarts it:
// it keeps playing straight through transitions. It loops, doesn't restart
// when a scene becomes active, and stays open while hidden. The app fades its
// volume (fadeMusic) so it is only heard when no gameplay is on screen; that
// is decided in server.js, since the Rocket League stats screens are inside
// the same Scoreboard scene as the game.
const MUSIC_INPUT = 'WU: Music';
const MUSIC_OFF_DB = -60;
function musicSettings(file) {
  return {
    is_local_file: true, local_file: file, looping: true,
    restart_on_activate: false, close_when_inactive: false, clear_on_media_end: false,
  };
}

function sceneForView(view) {
  return SCENES.find((s) => s.view === view) || null;
}

function viewForScene(sceneName) {
  const t = SCENES.find((s) => s.scene === sceneName || (s.legacy && s.legacy.scene === sceneName));
  return t ? t.view : null;
}

// How long to wait between reconnect attempts after OBS goes away.
const RECONNECT_MS = 5000;

// opts.getOverlayBase() -> e.g. "http://localhost:4310" (where OBS should point
// its browser sources; OBS runs on the same machine, so localhost is correct).
function createObs(opts = {}) {
  const getOverlayBase = opts.getOverlayBase || (() => 'http://localhost:4310');
  const onProgramView = opts.onProgramView || (() => {});
  const obs = new OBSWebSocket();

  let connected = false;
  // Set by a successful connect and cleared only by an explicit Disconnect.
  // While set, a dropped connection (OBS closed or restarted) is retried in the
  // background, so scene-sync comes back on its own instead of silently
  // staying off for the rest of the stream. Held in memory only, like the
  // password inside it.
  let wanted = null;
  let reconnectTimer = null;
  let reconnecting = false;
  let sceneSync = false;        // does a Push Live drive an OBS scene switch?
  let transitionName = '';      // '' -> leave OBS's current transition as-is
  let currentScene = '';
  let lastError = '';
  // What the music should be doing; applied on connect, build and change.
  let music = { file: '', db: -18, on: false };
  let musicApplied = null;
  let fadeTimer = null;

  obs.on('ConnectionClosed', () => {
    const was = connected;
    connected = false;
    currentScene = '';
    if (was && wanted) scheduleReconnect();
  });
  obs.on('CurrentProgramSceneChanged', (d) => {
    currentScene = (d && (d.sceneName || d.currentProgramSceneName)) || currentScene;
    // Report which of our overlays is now on program, whether the switch came
    // from a Push Live or from someone clicking a scene in OBS.
    const view = viewForScene(currentScene);
    if (view) { try { onProgramView(view); } catch (e) { /* never break OBS events */ } }
  });

  function status() {
    return { connected, reconnecting: !connected && reconnecting, sceneSync, transitionName, currentScene, error: lastError };
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

  // cfg.retry (sent by the panel's automatic connect when the app starts) keeps
  // trying in the background if OBS isn't open yet, instead of giving up.
  async function connect(cfg = {}, fromRetry = false) {
    clearTimeout(reconnectTimer);
    disconnectQuiet();
    const host = cfg.host || '127.0.0.1';
    const port = cfg.port || 4455;
    const url = `ws://${host}:${port}`;
    try {
      // Empty password -> pass undefined so an unauthenticated OBS server works.
      await obs.connect(url, cfg.password || undefined);
      connected = true;
      reconnecting = false;
      lastError = '';
      wanted = { ...cfg };
      sceneSync = !!cfg.sceneSync;
      transitionName = cfg.transitionName || '';
      try {
        const r = await obs.call('GetCurrentProgramScene');
        currentScene = r.currentProgramSceneName || r.sceneName || '';
      } catch (e) { /* non-fatal */ }
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
    return status();
  }

  // Update sync/transition preferences without tearing down the connection.
  function setSettings(cfg = {}) {
    if (cfg.sceneSync !== undefined) sceneSync = !!cfg.sceneSync;
    if (cfg.transitionName !== undefined) transitionName = cfg.transitionName || '';
    // A reconnect should come back with the current preferences, not the ones
    // from the original connect.
    if (wanted) wanted = { ...wanted, sceneSync, transitionName };
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

  // Stretch a scene item to fill the whole canvas. Non-fatal if it fails - the
  // source was already created at canvas size, this is just belt-and-braces.
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

  // Idempotently create (or reconcile) one scene + one locked browser source
  // per overlay type. Safe to run repeatedly: existing scenes/inputs are reused
  // by name and only their URL/size are corrected, so it never duplicates.
  async function buildScenes() {
    if (!connected) throw softError('Not connected to OBS');
    const base = await videoBase();
    const overlayBase = getOverlayBase();

    const sceneList = await obs.call('GetSceneList');
    const existingScenes = new Set((sceneList.scenes || []).map((s) => s.sceneName));
    const inputList = await obs.call('GetInputList');
    const existingInputs = new Set((inputList.inputs || []).map((i) => i.inputName));

    const built = [];
    for (const t of SCENES) {
      const url = `${overlayBase}/overlay?view=${t.view}`;
      // Rename a scene/source left from an older version rather than creating
      // a second one next to it.
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
      if (!existingScenes.has(t.scene)) {
        await obs.call('CreateScene', { sceneName: t.scene });
        existingScenes.add(t.scene);
      }

      if (!existingInputs.has(t.input)) {
        // CreateInput both creates the browser source AND adds it to the scene.
        const created = await obs.call('CreateInput', {
          sceneName: t.scene,
          inputName: t.input,
          inputKind: 'browser_source',
          inputSettings: { url, width: base.w, height: base.h },
          sceneItemEnabled: true,
        });
        existingInputs.add(t.input);
        await fitItem(t.scene, created.sceneItemId, base);
      } else {
        // Keep the URL/size correct even if the base canvas changed since.
        await obs.call('SetInputSettings', {
          inputName: t.input,
          inputSettings: { url, width: base.w, height: base.h },
          overlay: true,
        });
        // Make sure the (existing) source is actually present in its scene.
        let sceneItemId;
        try {
          ({ sceneItemId } = await obs.call('GetSceneItemId', { sceneName: t.scene, sourceName: t.input }));
        } catch (e) {
          ({ sceneItemId } = await obs.call('CreateSceneItem', { sceneName: t.scene, sourceName: t.input, sceneItemEnabled: true }));
        }
        await fitItem(t.scene, sceneItemId, base);
      }
      built.push(t.scene);
    }

    // The shared music source, added to every scene above. Created silent;
    // applyMusic() then fades it to wherever it should be.
    if (music.file) {
      if (!existingInputs.has(MUSIC_INPUT)) {
        await obs.call('CreateInput', {
          sceneName: SCENES[0].scene, inputName: MUSIC_INPUT, inputKind: 'ffmpeg_source',
          inputSettings: musicSettings(music.file), sceneItemEnabled: true,
        });
        existingInputs.add(MUSIC_INPUT);
        try { await obs.call('SetInputVolume', { inputName: MUSIC_INPUT, inputVolumeDb: MUSIC_OFF_DB }); } catch (e) { /* non-fatal */ }
      } else {
        await obs.call('SetInputSettings', { inputName: MUSIC_INPUT, inputSettings: musicSettings(music.file), overlay: true });
      }
      for (const t of SCENES) {
        try { await obs.call('GetSceneItemId', { sceneName: t.scene, sourceName: MUSIC_INPUT }); }
        catch (e) { await obs.call('CreateSceneItem', { sceneName: t.scene, sourceName: MUSIC_INPUT, sceneItemEnabled: true }); }
      }
      built.push(MUSIC_INPUT);
      musicApplied = null;
      applyMusic(0).catch(() => {});
    }
    return { built };
  }

  // Fade the music source to a level in dB (null = silent) over `ms`. Steps
  // in dB, so it sounds even; the last step of a fade-out is a true zero.
  async function fadeMusic(toDb, ms) {
    let from;
    try { from = (await obs.call('GetInputVolume', { inputName: MUSIC_INPUT })).inputVolumeDb; }
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
      obs.call('SetInputVolume', { inputName: MUSIC_INPUT, ...vol }).catch(() => {});
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
        await obs.call('SetInputSettings', { inputName: MUSIC_INPUT, inputSettings: musicSettings(music.file), overlay: true });
      }
      if (music.on) {
        const st = await obs.call('GetMediaInputStatus', { inputName: MUSIC_INPUT });
        if (st.mediaState !== 'OBS_MEDIA_STATE_PLAYING') {
          await obs.call('TriggerMediaInputAction', { inputName: MUSIC_INPUT, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY' });
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

  // Which of our target scenes currently exist in OBS (for status display).
  async function scenesExist() {
    if (!connected) return {};
    try {
      const sceneList = await obs.call('GetSceneList');
      const have = new Set((sceneList.scenes || []).map((s) => s.sceneName));
      const out = {};
      SCENES.forEach((t) => { out[t.view] = have.has(t.scene) || !!(t.legacy && have.has(t.legacy.scene)); });
      return out;
    } catch (e) { return {}; }
  }

  async function listTransitions() {
    if (!connected) return { transitions: [], current: '' };
    try {
      const r = await obs.call('GetSceneTransitionList');
      return {
        transitions: (r.transitions || []).map((x) => x.transitionName),
        current: r.currentSceneTransitionName || '',
      };
    } catch (e) { return { transitions: [], current: '' }; }
  }

  // Switch OBS's program scene to the one for `view`. Optionally selects the
  // configured transition first (so the Widener stinger fires). Only does
  // anything when connected AND scene-sync is enabled.
  async function switchToView(view) {
    if (!connected || !sceneSync) return { switched: false };
    const t = sceneForView(view);
    if (!t) return { switched: false };
    // Scenes built by v0.8.0 and not rebuilt since still carry the old name.
    let sceneName = t.scene;
    if (t.legacy) {
      try {
        const list = await obs.call('GetSceneList');
        const names = new Set((list.scenes || []).map((x) => x.sceneName));
        if (!names.has(t.scene) && names.has(t.legacy.scene)) sceneName = t.legacy.scene;
      } catch (e) { /* use the current name */ }
    }
    if (transitionName) {
      try { await obs.call('SetCurrentSceneTransition', { transitionName }); } catch (e) { /* non-fatal */ }
    }
    await obs.call('SetCurrentProgramScene', { sceneName });
    return { switched: true, scene: sceneName };
  }

  // Called by the server right after a Push Live. Fire-and-forget, fully soft:
  // a failed scene switch must never break the push that already happened.
  async function onPush(liveState) {
    if (!connected || !sceneSync || !liveState) return { switched: false };
    try {
      return await switchToView(liveState.mode);
    } catch (e) {
      lastError = scrub(e && e.message ? e.message : String(e), '');
      return { switched: false, error: lastError };
    }
  }

  // A richer status that hits OBS live (connection + scenes + transitions).
  // Safe when disconnected: returns the cached status with empty extras.
  async function inspect() {
    const base = status();
    if (!connected) return { ...base, scenes: {}, transitions: [] };
    const [exists, trans] = await Promise.all([scenesExist(), listTransitions()]);
    try {
      const r = await obs.call('GetCurrentProgramScene');
      currentScene = r.currentProgramSceneName || r.sceneName || currentScene;
    } catch (e) { /* non-fatal */ }
    return { ...status(), scenes: exists, transitions: trans.transitions };
  }

  return {
    connect, disconnect, setSettings, status, inspect,
    buildScenes, switchToView, onPush, listTransitions, setMusic,
    isSceneSync: () => sceneSync && connected,
  };
}

function softError(msg) {
  const e = new Error(msg);
  e.soft = true;
  return e;
}

// Defensive: strip the password out of any string before it's stored/returned.
function scrub(msg, password) {
  let out = String(msg || '');
  if (password) out = out.split(password).join('***');
  return out;
}

module.exports = { createObs, SCENES, sceneForView };
