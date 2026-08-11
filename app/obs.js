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
  // One NECC scene covers every NECC overlay type: the locked page reads the
  // pushed neccUrl, so picking bracket vs match-preview is a live content
  // update inside this same scene, not a new scene.
  { view: 'necc',          scene: 'WU: NECC',          input: 'WU-src-necc' },
];

function sceneForView(view) {
  return SCENES.find((s) => s.view === view) || null;
}

// opts.getOverlayBase() -> e.g. "http://localhost:4310" (where OBS should point
// its browser sources; OBS runs on the same machine, so localhost is correct).
function createObs(opts = {}) {
  const getOverlayBase = opts.getOverlayBase || (() => 'http://localhost:4310');
  const obs = new OBSWebSocket();

  let connected = false;
  let sceneSync = false;        // does a Push Live drive an OBS scene switch?
  let transitionName = '';      // '' -> leave OBS's current transition as-is
  let currentScene = '';
  let lastError = '';

  obs.on('ConnectionClosed', () => { connected = false; currentScene = ''; });
  obs.on('CurrentProgramSceneChanged', (d) => {
    currentScene = (d && (d.sceneName || d.currentProgramSceneName)) || currentScene;
  });

  function status() {
    return { connected, sceneSync, transitionName, currentScene, error: lastError };
  }

  function disconnectQuiet() {
    try { obs.disconnect(); } catch (e) { /* not connected */ }
    connected = false;
    currentScene = '';
  }

  async function connect(cfg = {}) {
    disconnectQuiet();
    const host = cfg.host || '127.0.0.1';
    const port = cfg.port || 4455;
    const url = `ws://${host}:${port}`;
    try {
      // Empty password -> pass undefined so an unauthenticated OBS server works.
      await obs.connect(url, cfg.password || undefined);
      connected = true;
      lastError = '';
      sceneSync = !!cfg.sceneSync;
      transitionName = cfg.transitionName || '';
      try {
        const r = await obs.call('GetCurrentProgramScene');
        currentScene = r.currentProgramSceneName || r.sceneName || '';
      } catch (e) { /* non-fatal */ }
      return status();
    } catch (e) {
      connected = false;
      // Never surface the password even if it were somehow in the message.
      lastError = scrub(e && e.message ? e.message : String(e), cfg.password);
      const err = new Error(lastError);
      err.soft = true;
      throw err;
    }
  }

  function disconnect() {
    disconnectQuiet();
    return status();
  }

  // Update sync/transition preferences without tearing down the connection.
  function setSettings(cfg = {}) {
    if (cfg.sceneSync !== undefined) sceneSync = !!cfg.sceneSync;
    if (cfg.transitionName !== undefined) transitionName = cfg.transitionName || '';
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
    return { built };
  }

  // Which of our target scenes currently exist in OBS (for status display).
  async function scenesExist() {
    if (!connected) return {};
    try {
      const sceneList = await obs.call('GetSceneList');
      const have = new Set((sceneList.scenes || []).map((s) => s.sceneName));
      const out = {};
      SCENES.forEach((t) => { out[t.view] = have.has(t.scene); });
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
    if (transitionName) {
      try { await obs.call('SetCurrentSceneTransition', { transitionName }); } catch (e) { /* non-fatal */ }
    }
    await obs.call('SetCurrentProgramScene', { sceneName: t.scene });
    return { switched: true, scene: t.scene };
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
    buildScenes, switchToView, onPush, listTransitions,
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
