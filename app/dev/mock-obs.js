// A stand-in for OBS's WebSocket server (obs-websocket v5), for testing scene
// builds, cameras and switching without OBS (dev only).
//
//   node dev/mock-obs.js [port] [--log]        default port 4466, no password
//
// or, in a test: const mock = require('./dev/mock-obs').createMockObs(4466)
// and read mock.state afterwards.
//
// It keeps scene collections, scenes with their items, inputs and
// transitions in memory, and answers the requests obs.js makes the way OBS
// does where it matters: GetSceneList lists the bottom scene first with
// sceneIndex 0, a new scene lands at the bottom, a new scene item lands on
// top, and a scene item's index 0 is the bottom of the scene. Both of the
// protocol's encodings are spoken (msgpack and JSON).

const { WebSocketServer } = require('ws');
const { encode, decode } = require('@msgpack/msgpack');

const CAMERA_DEVICES = [
  { itemName: 'Logitech BRIO', itemValue: 'Logitech BRIO:\\\\?\\usb#vid_046d&pid_085e', itemEnabled: true },
  { itemName: 'Cam Link 4K', itemValue: 'Cam Link 4K:\\\\?\\usb#vid_0fd9&pid_0066', itemEnabled: true },
  { itemName: 'OBS Virtual Camera', itemValue: 'OBS Virtual Camera:', itemEnabled: true },
];

function createMockObs(port = 4466, opts = {}) {
  const log = opts.log ? (...a) => console.log('[mock-obs]', ...a) : () => {};
  const state = {
    collections: { Untitled: newCollection() },
    current: 'Untitled',
    inputs: {},          // name -> { kind, settings, volumeDb, pressed: [] }
    transitions: [{ transitionName: 'Cut', transitionKind: 'cut_transition' }, { transitionName: 'Fade', transitionKind: 'fade_transition' }],
    currentTransition: 'Fade',
    transitionSettings: {},
    studioMode: false,
    streaming: false,
    video: { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080, fpsNumerator: 60, fpsDenominator: 1 },
    // The profile's settings a test reads: 'Category/Name' -> string.
    profile: { 'Output/Mode': 'Simple', 'SimpleOutput/VBitrate': '6000' },
    kinds:['browser_source', 'ffmpeg_source', 'game_capture', 'dshow_input', 'image_source', 'color_source'],
    calls: [],
  };
  let nextItemId = 1;
  function newCollection() {
    // Scenes top first, as OBS shows them.
    return { scenes: [{ name: 'Scene', items: [], filters: [] }], program: 'Scene', preview: 'Scene' };
  }
  const coll = () => state.collections[state.current];
  const scene = (name) => coll().scenes.find((s) => s.name === name);
  function fail(code, comment) { const e = new Error(comment); e.code = code; return e; }
  function need(sc, name) { if (!sc) throw fail(600, `No source was found by the name of \`${name}\`.`); return sc; }
  // A removed input goes for good once no scene holds an item of it.
  function prune() {
    Object.keys(state.inputs).filter((n) => state.inputs[n].removed).forEach((n) => {
      const held = Object.values(state.collections).some((c) => c.scenes.some((s) => s.items.some((it) => it.source === n)));
      if (!held) delete state.inputs[n];
    });
  }
  // A scene's items bottom first, each with its index.
  const itemList = (sc) => sc.items.map((it, i) => ({
    sceneItemId: it.id, sourceName: it.source, sceneItemIndex: i, sceneItemEnabled: it.enabled, sceneItemLocked: it.locked,
    sceneItemBlendMode: it.blend, isGroup: false, sceneItemTransform: it.transform, inputKind: (state.inputs[it.source] || {}).kind || null,
  }));

  const clients = new Set();
  function event(eventType, eventData) { clients.forEach((c) => c.sendMsg({ op: 5, d: { eventType, eventIntent: 1, eventData } })); }
  function setProgram(name) { coll().program = name; event('CurrentProgramSceneChanged', { sceneName: name }); }

  const handlers = {
    GetVersion: () => ({ obsVersion: '32.0.0', obsWebSocketVersion: '5.6.0', rpcVersion: 1 }),
    GetVideoSettings: () => ({ ...state.video }),
    // As OBS does it: refused while an output is running, and a size or a
    // frame rate is given whole or not at all.
    SetVideoSettings: (d) => {
      if (state.streaming) throw fail(500, 'Video settings cannot be changed while an output is active.');
      [['baseWidth', 'baseHeight'], ['outputWidth', 'outputHeight'], ['fpsNumerator', 'fpsDenominator']].forEach(([a, b]) => {
        if ((d[a] === undefined) !== (d[b] === undefined)) throw fail(300, `\`${a}\` and \`${b}\` must be set together.`);
        if (d[a] !== undefined) Object.assign(state.video, { [a]: d[a], [b]: d[b] });
      });
    },
    GetProfileParameter: ({ parameterCategory, parameterName }) => {
      const v = state.profile[`${parameterCategory}/${parameterName}`];
      return { parameterValue: v === undefined ? null : v, defaultParameterValue: null };
    },
    GetVirtualCamStatus: () => ({ outputActive: false }),
    GetReplayBufferStatus: () => { throw fail(604, 'Replay buffer is not available.'); },
    GetSceneCollectionList: () => ({ currentSceneCollectionName: state.current, sceneCollections: Object.keys(state.collections) }),
    SetCurrentSceneCollection: ({ sceneCollectionName }) => {
      if (!state.collections[sceneCollectionName]) throw fail(600, 'No scene collection by that name');
      state.current = sceneCollectionName;
      event('CurrentSceneCollectionChanged', { sceneCollectionName });
    },
    CreateSceneCollection: ({ sceneCollectionName }) => {
      state.collections[sceneCollectionName] = newCollection();
      state.current = sceneCollectionName;
      event('CurrentSceneCollectionChanged', { sceneCollectionName });
    },
    GetSceneList: () => {
      const n = coll().scenes.length;
      return {
        currentProgramSceneName: coll().program, currentPreviewSceneName: coll().preview,
        scenes: coll().scenes.map((s, i) => ({ sceneName: s.name, sceneIndex: n - 1 - i })).reverse(),
      };
    },
    CreateScene: ({ sceneName }) => {
      if (scene(sceneName)) throw fail(601, 'A source already exists by that scene name.');
      coll().scenes.push({ name: sceneName, items: [], filters: [] });
    },
    RemoveScene: ({ sceneName }) => {
      need(scene(sceneName), sceneName);
      coll().scenes = coll().scenes.filter((s) => s.name !== sceneName);
      prune();
      if (coll().program === sceneName && coll().scenes.length) setProgram(coll().scenes[0].name);
    },
    SetSceneName: ({ sceneName, newSceneName }) => {
      need(scene(sceneName), sceneName).name = newSceneName;
      if (coll().program === sceneName) coll().program = newSceneName;
      if (coll().preview === sceneName) coll().preview = newSceneName;
      event('SceneNameChanged', { oldSceneName: sceneName, sceneName: newSceneName });
    },
    GetCurrentProgramScene: () => ({ currentProgramSceneName: coll().program, sceneName: coll().program }),
    SetCurrentProgramScene: ({ sceneName }) => { need(scene(sceneName), sceneName); setProgram(sceneName); },
    GetCurrentPreviewScene: () => ({ currentPreviewSceneName: coll().preview, sceneName: coll().preview }),
    SetCurrentPreviewScene: ({ sceneName }) => { need(scene(sceneName), sceneName); coll().preview = sceneName; },
    SetStudioModeEnabled: ({ studioModeEnabled }) => { state.studioMode = !!studioModeEnabled; },
    GetStreamStatus: () => ({ outputActive: state.streaming }),
    GetRecordStatus: () => ({ outputActive: false }),

    GetInputKindList: () => ({ inputKinds: state.kinds.slice() }),
    GetInputList: () => ({ inputs: Object.keys(state.inputs).map((n) => ({ inputName: n, inputKind: state.inputs[n].kind })) }),
    CreateInput: ({ sceneName, inputName, inputKind, inputSettings, sceneItemEnabled }) => {
      const sc = need(scene(sceneName), sceneName);
      if (state.inputs[inputName]) throw fail(601, 'A source already exists by that input name.');
      if (!state.kinds.includes(inputKind)) throw fail(400, 'The specified input kind is invalid.');
      state.inputs[inputName] = { kind: inputKind, settings: { ...(inputSettings || {}) }, volumeDb: 0, pressed: [], media: 'OBS_MEDIA_STATE_NONE' };
      const id = nextItemId++;
      sc.items.push({ id, source: inputName, enabled: sceneItemEnabled !== false, locked: false, blend: 'OBS_BLEND_NORMAL', transform: {} });
      return { sceneItemId: id };
    },
    // As OBS does it: the input is marked removed, and a scene only drops
    // its items of it as that scene is drawn (here: the program scene).
    // Until the last item is gone the input is still listed, its name is
    // taken, and it cannot be added to a scene.
    RemoveInput: ({ inputName }) => {
      if (!state.inputs[inputName] || state.inputs[inputName].removed) throw fail(600, 'No input by that name');
      state.inputs[inputName].removed = true;
      const prog = scene(coll().program);
      if (prog) prog.items = prog.items.filter((it) => it.source !== inputName);
      prune();
    },
    RemoveSceneItem: ({ sceneName, sceneItemId }) => {
      const sc = need(scene(sceneName), sceneName);
      if (!sc.items.some((it) => it.id === sceneItemId)) throw fail(600, 'No scene items were found in the specified scene by that ID.');
      const gone = sc.items.find((it) => it.id === sceneItemId).source;
      sc.items = sc.items.filter((it) => it.id !== sceneItemId);
      // An input is let go of when its last item goes.
      const held = Object.values(state.collections).some((c) => c.scenes.some((s) => s.items.some((it) => it.source === gone)));
      if (state.inputs[gone] && !held) delete state.inputs[gone];
      prune();
    },
    SetInputName: ({ inputName, newInputName }) => {
      if (!state.inputs[inputName]) throw fail(600, 'No input by that name');
      state.inputs[newInputName] = state.inputs[inputName];
      delete state.inputs[inputName];
      coll().scenes.forEach((s) => s.items.forEach((it) => { if (it.source === inputName) it.source = newInputName; }));
    },
    GetInputSettings: ({ inputName }) => {
      const input = state.inputs[inputName];
      if (!input) throw fail(600, `No source was found by the name of \`${inputName}\`.`);
      return { inputSettings: input.settings, inputKind: input.kind };
    },
    SetInputSettings: ({ inputName, inputSettings, overlay }) => {
      const input = state.inputs[inputName];
      if (!input) throw fail(600, `No source was found by the name of \`${inputName}\`.`);
      input.settings = overlay === false ? { ...inputSettings } : { ...input.settings, ...inputSettings };
    },
    GetInputPropertiesListPropertyItems: ({ inputName, propertyName }) => {
      const input = state.inputs[inputName];
      if (!input) throw fail(600, `No source was found by the name of \`${inputName}\`.`);
      return { propertyItems: input.kind === 'dshow_input' && propertyName === 'video_device_id' ? CAMERA_DEVICES : [] };
    },
    PressInputPropertiesButton: ({ inputName, propertyName }) => {
      const input = state.inputs[inputName];
      if (!input) throw fail(600, 'No input by that name');
      input.pressed.push(propertyName);
    },
    GetInputVolume: ({ inputName }) => {
      const input = state.inputs[inputName];
      if (!input) throw fail(600, `No source was found by the name of \`${inputName}\`.`);
      return { inputVolumeDb: input.volumeDb, inputVolumeMul: Math.pow(10, input.volumeDb / 20) };
    },
    SetInputVolume: ({ inputName, inputVolumeDb, inputVolumeMul }) => {
      const input = state.inputs[inputName];
      if (!input) throw fail(600, 'No input by that name');
      input.volumeDb = inputVolumeDb !== undefined ? inputVolumeDb : (inputVolumeMul > 0 ? 20 * Math.log10(inputVolumeMul) : -100);
    },
    GetMediaInputStatus: ({ inputName }) => {
      const input = state.inputs[inputName];
      if (!input) throw fail(600, 'No input by that name');
      return { mediaState: input.media };
    },
    TriggerMediaInputAction: ({ inputName }) => {
      const input = state.inputs[inputName];
      if (!input) throw fail(600, 'No input by that name');
      input.media = 'OBS_MEDIA_STATE_PLAYING';
    },

    GetSceneItemList: ({ sceneName }) => ({ sceneItems: itemList(need(scene(sceneName), sceneName)) }),
    GetSceneItemId: ({ sceneName, sourceName }) => {
      const it = need(scene(sceneName), sceneName).items.find((x) => x.source === sourceName);
      if (!it) throw fail(600, 'No scene items were found in the specified scene by that name or offset.');
      return { sceneItemId: it.id };
    },
    CreateSceneItem: ({ sceneName, sourceName, sceneItemEnabled }) => {
      const sc = need(scene(sceneName), sceneName);
      if (!state.inputs[sourceName] && !scene(sourceName)) throw fail(600, 'No source by that name');
      if ((state.inputs[sourceName] || {}).removed) throw fail(600, 'Failed to create the scene item.');
      const id = nextItemId++;
      sc.items.push({ id, source: sourceName, enabled: sceneItemEnabled !== false, locked: false, blend: 'OBS_BLEND_NORMAL', transform: {} });
      return { sceneItemId: id };
    },
    DuplicateSceneItem: ({ sceneName, sceneItemId, destinationSceneName }) => {
      const from = need(scene(sceneName), sceneName).items.find((x) => x.id === sceneItemId);
      if (!from) throw fail(600, 'No scene item by that id');
      const id = nextItemId++;
      need(scene(destinationSceneName || sceneName), destinationSceneName).items.push({ ...from, id, locked: false, blend: 'OBS_BLEND_NORMAL', transform: { ...from.transform } });
      return { sceneItemId: id };
    },
    SetSceneItemTransform: ({ sceneName, sceneItemId, sceneItemTransform }) => {
      const it = need(scene(sceneName), sceneName).items.find((x) => x.id === sceneItemId);
      if (!it) throw fail(600, 'No scene item by that id');
      it.transform = { ...it.transform, ...sceneItemTransform };
    },
    SetSceneItemIndex: ({ sceneName, sceneItemId, sceneItemIndex }) => {
      const sc = need(scene(sceneName), sceneName);
      const at = sc.items.findIndex((x) => x.id === sceneItemId);
      if (at < 0) throw fail(600, 'No scene item by that id');
      const [it] = sc.items.splice(at, 1);
      sc.items.splice(Math.max(0, Math.min(sc.items.length, sceneItemIndex)), 0, it);
    },
    SetSceneItemEnabled: ({ sceneName, sceneItemId, sceneItemEnabled }) => {
      const it = need(scene(sceneName), sceneName).items.find((x) => x.id === sceneItemId);
      if (!it) throw fail(600, 'No scene item by that id');
      it.enabled = !!sceneItemEnabled;
    },
    SetSceneItemLocked: ({ sceneName, sceneItemId, sceneItemLocked }) => {
      const it = need(scene(sceneName), sceneName).items.find((x) => x.id === sceneItemId);
      if (it) it.locked = !!sceneItemLocked;
    },
    SetSceneItemBlendMode: ({ sceneName, sceneItemId, sceneItemBlendMode }) => {
      const it = need(scene(sceneName), sceneName).items.find((x) => x.id === sceneItemId);
      if (it) it.blend = sceneItemBlendMode;
    },

    GetSourceFilterList: ({ sourceName }) => ({ filters: ((scene(sourceName) || {}).filters || []).map((f, i) => ({ ...f, filterIndex: i })) }),
    CreateSourceFilter: ({ sourceName, filterName, filterKind, filterSettings }) => {
      need(scene(sourceName), sourceName).filters.push({ filterName, filterKind, filterSettings: filterSettings || {}, filterEnabled: true });
    },
    SetSourceFilterEnabled: ({ sourceName, filterName, filterEnabled }) => {
      const f = need(scene(sourceName), sourceName).filters.find((x) => x.filterName === filterName);
      if (f) f.filterEnabled = !!filterEnabled;
    },
    GetSceneSceneTransitionOverride: ({ sceneName }) => ({ transitionName: need(scene(sceneName), sceneName).override || null, transitionDuration: null }),
    SetSceneSceneTransitionOverride: ({ sceneName, transitionName }) => { need(scene(sceneName), sceneName).override = transitionName; },

    GetSceneTransitionList: () => ({ currentSceneTransitionName: state.currentTransition, transitions: state.transitions }),
    SetCurrentSceneTransition: ({ transitionName }) => {
      if (!state.transitions.some((t) => t.transitionName === transitionName)) throw fail(600, 'No transition by that name');
      state.currentTransition = transitionName;
    },
    SetCurrentSceneTransitionSettings: ({ transitionSettings }) => { state.transitionSettings = { ...state.transitionSettings, ...transitionSettings }; },
    GetSourceScreenshot: () => ({ imageData: 'data:image/jpeg;base64,' }),
  };

  const wss = new WebSocketServer({ port, handleProtocols: (protocols) => (protocols.has('obswebsocket.msgpack') ? 'obswebsocket.msgpack' : protocols.has('obswebsocket.json') ? 'obswebsocket.json' : false) });
  wss.on('connection', (ws) => {
    const packed = ws.protocol === 'obswebsocket.msgpack';
    ws.sendMsg = (msg) => { if (ws.readyState === 1) ws.send(packed ? encode(msg) : JSON.stringify(msg)); };
    ws.sendMsg({ op: 0, d: { obsWebSocketVersion: '5.6.0', rpcVersion: 1 } });
    ws.on('message', (raw) => {
      let msg;
      try { msg = packed ? decode(raw) : JSON.parse(raw); } catch (e) { return; }
      if (msg.op === 1) { clients.add(ws); ws.sendMsg({ op: 2, d: { negotiatedRpcVersion: 1 } }); return; }
      if (msg.op !== 6) return;
      const { requestType, requestId, requestData } = msg.d;
      state.calls.push({ requestType, requestData: requestData || {} });
      let result = { result: true, code: 100 };
      let responseData;
      try {
        if (!handlers[requestType]) throw fail(204, `The request type ${requestType} is not in this mock.`);
        responseData = handlers[requestType](requestData || {});
        log(requestType, JSON.stringify(requestData || {}).slice(0, 140));
      } catch (e) {
        result = { result: false, code: e.code || 500, comment: e.message };
        log(requestType, 'FAILED', e.message);
      }
      ws.sendMsg({ op: 7, d: { requestType, requestId, requestStatus: result, responseData } });
    });
    ws.on('close', () => clients.delete(ws));
  });

  return {
    state, wss,
    // The scenes of the current collection as OBS lists them, top first.
    sceneNames: () => coll().scenes.map((s) => s.name),
    scene: (name) => scene(name),
    items: (name) => itemList(scene(name) || { items: [] }),
    // What an operator does in OBS: add a transition, cut to a scene.
    addTransition: (transitionName, transitionKind) => state.transitions.push({ transitionName, transitionKind: transitionKind || 'obs_stinger_transition' }),
    cutTo: (name) => setProgram(name),
    close: () => new Promise((r) => { clients.forEach((c) => c.terminate()); wss.close(() => r()); }),
  };
}

module.exports = { createMockObs };

if (require.main === module) {
  const port = Number(process.argv.find((a) => /^\d+$/.test(a))) || 4466;
  createMockObs(port, { log: process.argv.includes('--log') });
  console.log(`Mock OBS WebSocket server on ws://127.0.0.1:${port} (no password)`);
}
