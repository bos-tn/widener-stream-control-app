# OBS Dock + Scene-Sync Integration: Spec and Outcome

> **Status: implemented in v0.7.0** and merged to `master`.
> This began as a forward-looking handoff spec. It is kept as the record of what
> was specified, what actually shipped, and where the two differ.
>
> **Still outstanding: verification against a live OBS.** See
> [What is still unverified](#what-is-still-unverified).

For how the app works generally, read `PROJECT_NOTES.md` (architecture, state
model, WS protocol, NECC, build conventions) and `README.md` (user-facing docs).
This file no longer duplicates that material, so there is only one copy to keep
current.

## Goal

Add an *optional* OBS integration so the app can (a) run its control panel as a
dock inside OBS, and (b) auto-build an OBS scene collection with one scene per
overlay type and switch between them using OBS's own transitions, such as the
Widener stinger, while keeping the existing single-URL live-push model fully
working for anyone who doesn't opt in.

The constraint that shaped everything: **keep it additive.** The single-URL push
model and its "one OBS URL forever" promise are the product's whole reason to
exist. Scene-sync is strictly opt-in.

## What shipped

### Piece A: control panel as an OBS browser dock

OBS can load any URL as a custom dock panel via **Docks → Custom Browser
Docks…**. There is no obs-websocket call to register a dock, so this is a
one-time manual setup by the user, and the deliverable was mostly a helper plus
verification.

Shipped: a "Run this panel inside OBS" section in the control panel with a
copyable dock URL (`http://localhost:4310/control`) and collapsible setup steps.
Verified the panel has zero horizontal overflow down to 380px wide, a typical
dock column.

Not used: the `window.obsstudio` object OBS injects into docks and browser
sources. Full control goes through obs-websocket instead, so the same code path
works whether the panel is a dock or the standalone window.

### Piece B: per-type overlay URL (`?view=`)

The foundation for scene-sync, and testable with zero OBS. For OBS to hold a
*fixed* source per type, each source needs a URL that locks that page to one
view.

`overlay.html` now reads `?view=` on load:

- `/overlay?view=starting-soon`
- `/overlay?view=post-match`
- `/overlay?view=roster`
- `/overlay?view=necc` (optionally `&necc=<type>`)

When `view` is present the overlay pins `mode` to that value and ignores pushed
`mode` changes, but still applies all other field updates for its channel. When
`view` is absent, behavior is exactly as before. A view-locked page also
suppresses the in-overlay WebGL stinger, since OBS owns transitions in that mode
and the two would otherwise stack.

### Piece C: obs-websocket scene sync (`app/obs.js`)

Uses obs-websocket v5 (bundled in OBS 28+, default `ws://127.0.0.1:4455`) via
`obs-websocket-js` v5, running in the **server** process, not the renderer.

The architecture is the hybrid that preserves the current model:

> **OBS owns *between-view* transitions; the app keeps owning *within-view* live
> data.** One OBS scene per overlay type, each containing a single Browser Source
> locked to that type's URL. Switching overlay type becomes
> `SetCurrentProgramScene`, and OBS fires its configured transition. The existing
> WebSocket push still drives the *content* inside each view live and instantly.

What `obs.js` does:

1. **Connect and disconnect**, with host, port, and password from the panel's
   settings section.
2. **Build scenes**, idempotently. One scene plus one locked `browser_source`
   per view: `WU: Starting Soon`, `WU: Post-Match`, `WU: Rosters`, `WU: NECC`,
   with sources named `WU-src-*`. It reads `GetSceneList` and `GetInputList`
   first and reuses anything matching by name, correcting only the URL and size,
   so re-running never duplicates. One NECC scene covers every NECC overlay
   type, because the locked page reads the pushed `neccUrl`.
3. **Switch view** on Push Live, optionally selecting the configured transition
   first via `SetCurrentSceneTransition`.
4. **Surface OBS state**: connection status, current program scene, which scenes
   exist, and the available transitions.

obs-websocket requests used: `CreateScene`, `CreateInput` (kind
`browser_source`), `SetInputSettings`, `GetSceneItemId`, `CreateSceneItem`,
`SetSceneItemTransform`, `GetSceneList`, `GetInputList`, `GetVideoSettings`,
`GetCurrentProgramScene`, `SetCurrentProgramScene`, `GetSceneTransitionList`,
`SetCurrentSceneTransition`.

Stinger transitions themselves are created in the OBS UI. obs-websocket can
select an existing one as current but cannot author one, so that stays a
documented one-time setup step.

### How the two models coexist

- **Single-source mode (default, unchanged):** OBS has one Browser Source at
  `/overlay`, the app pushes `mode` plus content, and the in-overlay WebGL
  stinger does transitions. Works with zero OBS setup.
- **Scene-sync mode (opt-in):** the app is connected to obs-websocket, scenes
  are built, and switching overlay type drives OBS scene switches plus OBS
  transitions. The in-overlay stinger is suppressed to avoid a double
  transition, and the panel disables its stinger checkbox to show why.

Every obs-websocket call fails soft: OBS being unreachable never blocks a push
and never crashes the app.

## Where the outcome differs from the spec

| Spec said | What shipped | Why |
| --- | --- | --- |
| Open question: switch on *select* or on *Push Live*? | **On Push Live.** | Switching on select would break the preview-then-push model, which is the product's core promise. |
| A scene per NECC overlay type was implied (Bracket, Match Preview, and so on) | **One `WU: NECC` scene.** | The locked page reads the pushed `neccUrl`, so picking bracket vs match preview is a live content update, not a new scene. Fewer scenes to build and keep in sync. |
| Persist which mode is active | **Persisted client-side** in `localStorage` (`widener-obs-settings`), not in overlay state. | The obs-websocket password rides along in those settings, and overlay state is broadcast to every connected overlay. Keeping it out of state keeps the secret off the wire. |
| Password stored in "localStorage or state" | **Never in state.** The server holds it in memory only. | Same reason. It is also scrubbed from error strings before they reach the panel or the logs. |

Resolved from the spec's open questions:

- *Switch on select or on push?* Resolved: **on push**, as above.
- *Does scene-sync mode reuse the existing draft and preview pane?* **Still
  open.** The preview pane is untouched and still works. Whether it earns its
  space once OBS has its own preview is a judgment call for the operator after
  real use.

## What is still unverified

The fail-soft paths were verified against the dev server: connect, inspect, and
build-scenes while disconnected all return clean errors, a Push Live still works
with OBS absent, and no password appears in any response or log.

**Never exercised against a live OBS**, and these are the risky surfaces:

- `CreateScene` and `CreateInput` behavior, and whether the built scenes look
  right in OBS
- Whether re-running build-scenes really is duplicate-free in practice, and how
  it behaves if the user has renamed things
- Transition firing and timing on a scene switch
- That content still updates live *within* a scene while scene-sync is on

The README's "Optional: OBS dock and scene-sync" section is the user-facing
walkthrough for running that test.

## Gotchas worth keeping

- **Any new top-level `app/*.js` must be added to `build.files` in
  `app/package.json`**, or the packaged app crashes with `Cannot find module`.
  Dev reads from disk; the packaged app reads from a read-only asar, so dev will
  not catch it. `obs.js` is registered. Currently whitelisted: `main.js`,
  `server.js`, `necc.js`, `obs.js`, `package.json`, `templates/**/*`,
  `public/**/*`, `build/icons/**/*`.
- `obs-websocket-js` is a production dependency, so electron-builder bundles it
  from `node_modules` automatically. Verified present in the packaged asar.
- **Idempotency is the hard part.** Re-running build-scenes must not spawn
  duplicate scenes or sources. Stable names are the key.
- **The obs-websocket password is a secret.** Do not commit it, log it, or put
  it in any URL or query string.
- **Verify behavior, don't trust screenshots alone.** This project is verified by
  driving the dev server and inspecting real DOM, computed styles, and WS
  messages. Screenshots of the overlay intermittently time out in the preview
  tooling.

## Out of scope

Embedding OBS's live *program output* inside the app. If it is ever revisited,
the practical routes are OBS Virtual Camera into `getUserMedia` in the Electron
renderer (roughly 30fps, and it consumes the virtual cam), or low-fps
`GetSourceScreenshot` polling. Not part of this work.
