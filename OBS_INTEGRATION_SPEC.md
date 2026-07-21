# OBS Dock + Scene-Sync Integration — Spec & Handoff

**Read this whole file before touching code.** It is written for a fresh AI
coding chat (Fable 5) that has *no* prior context on this project. It describes
(1) what the app already is, in enough detail to work on it, and (2) the new
feature to build on this branch.

- **Branch:** `experiment/obs-dock-and-scenes` (do all work here; do NOT merge to
  `master` until the user approves — this is a throwaway-friendly experiment).
- **Goal in one sentence:** add an *optional* OBS integration so the app can (a)
  run its control panel as a dock inside OBS, and (b) auto-build an OBS scene
  collection with one scene per overlay type and switch between them using OBS's
  own transitions (e.g. the Widener stinger) — while keeping the existing
  single-URL live-push model fully working for anyone who doesn't opt in.

---

## Part 1 — What the app already is

### Elevator pitch
An Electron desktop app for Widener University Esports that replaces a folder of
16 hand-edited per-game stream-overlay HTML files. It serves **one** overlay web
page and a control panel from a bundled local server (`localhost:4310`). OBS
points a single Browser Source at `http://localhost:4310/overlay` and never
changes; everything (which game, which "moment", NECC graphics) is **pushed
state** over WebSocket, not a URL change. Runs 100% local — no cloud, no
accounts.

### Stack
- **Electron** (main process `app/main.js`) starts a bundled **Express + `ws`**
  server (`app/server.js`) and opens the control-panel window.
- Plain vanilla JS/HTML/CSS for both the control panel and the overlay (no
  framework, no build step for the front-end).
- **electron-builder** produces the Windows NSIS installer.
- Current version: see `app/package.json` (`version`). It is at **0.6.4** as of
  this writing. Bump it on every shippable change (project rule).

### Repo layout (the parts that matter)
```
app/
  main.js                    Electron entry: starts server.js, opens control window
  server.js                  Express + ws server: state model, WS protocol, NECC route, /media
  necc.js                    LeagueOS API client (match/roster import + overlay URL construction)
  templates/
    overlay.html             THE overlay — single file, all games, all modes (live-pushed)
    games.json               the games list for the Game dropdown
  public/
    control/
      index.html             control panel UI
      control.css
      control.js             control panel logic (WS client, draft/push, roster editor, NECC)
    overlay-assets/
      curtain-stinger.webm   the Widener curtain-wipe stinger (side-by-side track matte)
      widener-logo.png       default on-stream logo (bundled locally)
  build/
    make-icon.js             regenerates icon.ico + PNGs from ../../widenerstreamlogofixed.png
    icons/                   generated icons (icon.ico used by electron-builder + window icon)
  data/                      dev-only state.json (gitignored). Packaged app uses Electron userData.
  package.json               version + electron-builder "build" config (note the files whitelist)
PROJECT_NOTES.md             deeper architecture notes + session history (READ THIS TOO)
README.md                    user-facing docs
widenerstreamlogofixed.png   app-ICON source (NOT the on-stream logo)
.claude/launch.json          dev server configs: stream-app-server (4310), stream-app-dev (4311)
```

### The core architecture idea — **Draft vs Live**
The server holds **two** copies of the overlay state:
- `live` — what every OBS-connected `/overlay` page sees.
- `draft` — what the control panel's own preview iframe (`/overlay?preview=1`)
  sees.

Editing any control fits only ever mutates `draft`. Clicking **Push Live** copies
`draft` → `live` verbatim and broadcasts it. This is what makes the preview
trustworthy: nothing reaches stream until you push. There is **no** bypass of
this (an old `set-mode` shortcut was removed on purpose — do not reintroduce it).

- `isDirty()` on the server compares draft vs live (key-order-independent, ignores
  the derived countdown `end` timestamp in duration mode) and broadcasts
  `{type:'dirty'}` so the panel can pulse the Push Live button and enable Revert.
- `{type:'revert'}` copies live → draft and the panel repopulates its whole form
  from the next draft broadcast.

### WebSocket protocol (path `/ws`)
Client → server:
- `{type:'subscribe', channel:'live'|'draft'}` — overlay pages subscribe `live`
  (or `draft` when `?preview=1`); the control panel subscribes `draft`.
- `{type:'update', channel:'draft', data:{...partialState}}` — an edit.
- `{type:'push', transition?:'stinger'}` — copy draft→live, broadcast to both
  channels; the optional `transition:'stinger'` rides along as a side-channel
  field telling live overlays to play the curtain wipe while swapping content.
- `{type:'revert'}`.

Server → client:
- `{type:'state', channel, data, transition?}` — full state for that channel.
- `{type:'dirty', dirty:boolean}` — to draft subscribers only.

### State shape (`DEFAULT_STATE` in `server.js`)
```js
{
  mode,            // 'starting-soon' | 'post-match' | 'roster' | 'necc'
  game, team, title, status, subtitle, next,
  countdownMode: 'duration'|'at', durationSec, end,   // end = computed absolute ISO
  layout: 'left'|'right', clip, logo, montage: bool,
  neccUrl, neccType,           // only meaningful when mode==='necc'
  neccBg: true,                // stripe backdrop behind transparent NECC overlays vs flat black
  socials: { twitch, twitter, instagram, youtube },   // default "wideneresports"
  teamA, teamB: { name, tag, color, colorAlt, logoUrl, players:[{name, gamertag}] },
}
```
Both `live` and `draft` are this same shape, persisted together in one
`state.json` as `{ live, draft }`. `normalizeLoaded()` merges a loaded file OVER
fresh defaults (not a straight replace) so old state files missing new fields
don't break — keep doing that when you add fields.

### The overlay (`templates/overlay.html`) — one page, four visual states
Controlled by `state.mode`:
- `starting-soon` / `post-match` — title/subtitle/countdown + a montage panel.
- `roster` — full two-team lineup view; player rows scale via a `--roster-count`
  CSS var so 2 players render big and 7 render tight.
- `necc` — a full-bleed passthrough `<iframe>` to a LeagueOS-hosted overlay URL
  (bracket, match preview, etc). `state.neccBg` toggles a transparent frame so
  the animated Widener stripe background shows through transparent NECC pages
  (like the bracket) instead of flat black.

Also in the overlay:
- **Curtain stinger**: on a push flagged `transition:'stinger'`, the overlay plays
  `overlay-assets/curtain-stinger.webm` (a side-by-side track-matte: left half =
  curtain fill, right half = luminance matte) composited live with a WebGL shader,
  and swaps the new state in at 1.4s (dead center of the full-cover window,
  measured from the file). Every failure path (no WebGL, missing file, autoplay
  rejection) applies state instantly; a 4s safety timeout bounds it.
- **/media route**: local file paths chosen in the control panel (logo/clip) are
  streamed through `GET /media?src=<absolute path>` (whitelisted extensions,
  Range support) because Chromium blocks `file://` subresources from an http page.

### Control panel (`public/control/*`)
- Live preview pane renders the overlay at real 1920×1080 scaled down.
- Overlay dropdown switches `mode` (Widener views) and, when a NECC match has been
  imported, points at LeagueOS overlay URLs — all as ordinary draft edits.
- **Editable rosters** (v0.6.4): type team names/tags and add/remove players by
  hand; a NECC fetch just pre-fills the same fields (starters only).
- Push Live optionally plays the stinger (checkbox, localStorage-persisted).

### NECC / LeagueOS (`necc.js`)
Talks to `api.leagueos.gg` — an **unofficial** API reverse-engineered from
LeagueOS's own web client (no login; three lightweight anti-abuse headers).
`importMatch(url)` returns `{ matchId, game, eventName, division, scheduledAt,
teams:[...], overlayUrls:{...} }`. Overlay asset URLs look like
`https://overlays.leagueos.gg/o/{type}/{league}/{season}/{stage}/{match}/` where
`type` ∈ `seasonHeader | stageBracket | matchPreview | matchActivity |
matchProgress | matchRosters`. If LeagueOS changes anything this degrades to
manual entry — nothing else depends on it.

### Build / dev / verify workflow (FOLLOW THESE CONVENTIONS)
- **Dev server:** `node app/server.js` (port 4310) or the `stream-app-dev`
  launch config (port 4311) for a throwaway instance. Fastest loop.
- **Full app:** `npm start` in `app/` (runs `electron .`).
- **Package:** `npm run dist` in `app/` → `app/dist/Widener Esports Stream Control
  Setup <version>.exe` + a portable `app/dist/win-unpacked/…exe`.
- **Bump `version` in `app/package.json` before every rebuild** (hard rule).
- **If the packaged app is already running, its files are locked.** Either ask
  before killing it, or build to a separate output dir:
  `npx electron-builder --win "-c.directories.output=dist-vXYZ"` (and clean it up
  after). Note an Electron app shows as several same-named processes (main +
  helpers) — that's one instance, not many.
- **Any new top-level `app/*.js` file MUST be added to `build.files` in
  `app/package.json`** or the packaged app crashes with `Cannot find module`
  (dev reads from disk; packaged reads from a read-only asar). Currently
  whitelisted: `main.js, server.js, necc.js, package.json, templates/**/*,
  public/**/*, build/icons/**/*`.
- **Verify behavior, don't trust screenshots alone.** This project is verified by
  driving the dev server and inspecting real DOM / computed styles / WS messages.
  Screenshots of the overlay intermittently time out in the preview tool.

---

## Part 2 — The new feature to build (this branch)

The user explicitly wants **both** of these. They are independent — ship them as
two opt-in pieces layered on top of the existing model. **Do not** remove or
weaken the current single-URL push model; this is additive and optional.

### Piece A — Control panel as an OBS **browser dock**
OBS (official Windows builds, which include CEF/browser-source support) can load
any URL as a custom dock panel: **Docks → Custom Browser Docks…**, give it a name
and the URL `http://localhost:4310/control`. The existing control panel then lives
*inside* the OBS window like the Twitch chat dock.

- There is **no obs-websocket call to register a dock** — it's a one-time manual
  setup the user does in OBS. So the deliverable here is mostly:
  1. Confirm the control panel works correctly when loaded inside OBS's CEF dock
     (it's just a web page hitting `localhost:4310` over WS — should "just work",
     but verify: WS connects, preview iframe loads, layout is usable in a narrow
     dock; the panel already has a responsive stacked layout below 980px width).
  2. Add a small **"Add to OBS" helper** in the control panel (a copyable dock URL
     + short instructions), mirroring how the OBS Browser Source URL is already
     surfaced. Optional nicety: detect narrow widths and tighten the layout.
- OBS injects a `window.obsstudio` object into browser docks/sources (has
  `getCurrentScene`, `getStatus`, pver, and fires `obsSceneChanged` /
  `obsStreamingStarting` etc. events on `window`). The dock can use this to show
  live OBS status, but full control should go through obs-websocket (Piece B) so
  the same code path works whether the panel is a dock or the standalone window.

### Piece B — obs-websocket scene sync + OBS-native transitions
Use **obs-websocket v5** (bundled in OBS 28+, default `ws://127.0.0.1:4455`,
password set in OBS → Tools → WebSocket Server Settings). Node client:
**`obs-websocket-js` v5** (`npm i obs-websocket-js` inside `app/`).

**Recommended architecture — the hybrid that preserves the current model:**

> **OBS owns *between-view* transitions; the app keeps owning *within-view* live
> data.** Create one OBS **scene per overlay type**, each containing a single
> Browser Source locked to that type's URL. Switching overlay type in the app
> becomes `SetCurrentProgramScene` → OBS fires its configured transition (the
> Widener stinger set up as an OBS Stinger transition). The existing WebSocket
> push still drives the *content* inside each view (title, countdown, roster
> names, etc.) live and instantly, exactly as today.

This means the in-overlay WebGL stinger is no longer needed *for people using
scene-sync* (OBS does the wipe between scenes), but it must remain for everyone
still on the single-source model.

**Per-type overlay URLs — required design change.** Today the overlay renders
whatever `mode` is pushed. For OBS to hold a *fixed* source per type, each source
needs a URL that locks that page to one view. Add a query param the overlay reads
on load, e.g.:
- `/overlay?view=starting-soon`
- `/overlay?view=post-match`
- `/overlay?view=roster`
- `/overlay?view=necc&necc=stageBracket` (or point the NECC source straight at the
  LeagueOS URL — but prefer routing through our page so the `neccBg` stripe
  backdrop still works)

When `view` is present, the overlay pins `mode` to that value and ignores pushed
`mode` changes, but still applies all other field updates for its channel. When
`view` is absent, behavior is exactly as today (single source, mode-driven).
Keep this backward-compatible.

**What the app's OBS module should do (suggest a new `app/obs.js`, added to
`build.files`):**
1. **Connect / disconnect** to obs-websocket with host/port/password from a new
   settings panel (persist in localStorage or state; password is sensitive — do
   not commit it, do not log it).
2. **"Build scenes" action** — idempotently create (or update):
   - a scene collection or a set of scenes named e.g. `WU: Starting Soon`,
     `WU: Post-Match`, `WU: Rosters`, `WU: Bracket`, `WU: Match Preview`, …
   - one `browser_source` input per scene pointing at the matching
     `/overlay?view=…` URL at 1920×1080.
   - Use `GetSceneList` / `GetInputList` first and reuse existing items so
     re-running doesn't duplicate. Use stable input/scene names as the key.
3. **Switch view** — when the operator picks an overlay type (and, likely, on
   Push Live), call `SetCurrentProgramScene(targetScene)`. Optionally set the
   current transition first (`SetCurrentSceneTransition`) so the stinger is used.
4. **Surface OBS state** — connection status, current program scene, and whether
   the scenes exist, in the control panel.

**Relevant obs-websocket v5 requests:** `CreateScene`, `CreateInput` (kind
`browser_source`, settings `{url,width,height}`), `SetInputSettings`,
`GetSceneItemId`, `SetSceneItemTransform`, `SetSceneItemEnabled`,
`GetSceneList`, `GetInputList`, `SetCurrentProgramScene`,
`GetSceneTransitionList`, `SetCurrentSceneTransition`,
`SetCurrentSceneTransitionDuration`. (Stinger transitions themselves are created
in the OBS UI; obs-websocket can select an existing one as current but cannot
author one — document the one-time OBS setup, or point the user to import the
`.webm`.)

### How the two models coexist (important UX decision)
There should be a clear **mode switch** in the app:
- **Single-source mode (default, unchanged):** OBS has one Browser Source at
  `/overlay`; app pushes `mode` + content; in-overlay WebGL stinger does
  transitions. Everything works with zero OBS setup.
- **Scene-sync mode (new, opt-in):** app is connected to obs-websocket, scenes are
  built, and switching overlay type drives OBS scene switches + OBS transitions.
  The in-overlay stinger should be suppressed to avoid a double transition.

Persist which mode is active. Never assume OBS is reachable — every obs-websocket
call must fail soft (show a status, never block a push, never crash the app).

---

## Suggested implementation phases
1. **Per-type overlay URL (`?view=`)** in `overlay.html` + verify each view renders
   standalone against the dev server while still receiving live field updates.
   This is the foundation and is testable with zero OBS.
2. **Browser dock (Piece A):** add the "Add to OBS" helper + dock URL in the
   control panel; verify the panel is usable in a narrow width. (Manual OBS dock
   setup is a doc step.)
3. **`app/obs.js` + connection settings UI:** connect/disconnect + status. Add to
   `build.files`. Test against a real OBS with WebSocket Server enabled.
4. **Build-scenes action:** idempotent scene/source creation. Verify in OBS.
5. **Switch-on-select / switch-on-push + transition selection.** Verify the OBS
   stinger fires between views and content still updates live within a view.
6. **Mode switch + stinger suppression** so single-source and scene-sync don't
   double-transition. Persist the choice.
7. Bump version, update `PROJECT_NOTES.md` + `README.md`, build, smoke-test the
   packaged exe, then hand back to the user for the merge decision.

## Constraints, gotchas, open questions
- **Keep it additive.** The single-URL push model and its "one OBS URL forever"
  promise are the product's whole reason to exist — do not regress it. Scene-sync
  is strictly opt-in.
- **obs-websocket password is a secret.** Don't commit, don't log, don't put it in
  any URL/query string.
- **Idempotency is the hard part.** Re-running "build scenes" must not spawn
  duplicate scenes/sources; handle the user having renamed things.
- **New top-level `app/*.js` (e.g. `obs.js`) → add to `build.files`** or the
  packaged app breaks (dev won't catch it).
- **Verify against a real OBS**, not just unit logic — obs-websocket behavior
  (transition timing, scene-item creation) is the risky surface.
- **Out of scope for now** (user chose dock + scenes): embedding OBS's live
  *program output* inside the app. If revisited, the practical route is OBS
  Virtual Camera → `getUserMedia` in the Electron renderer (~30fps, consumes the
  virtual cam), or low-fps `GetSourceScreenshot` polling. Not part of this task.
- **Open questions for the user** (ask if they matter): should switching views
  happen on *select* (preview-then-push feels wrong once OBS is the switcher) or
  only on *Push Live*? Should scene-sync mode reuse the existing draft/preview
  pane at all, or does OBS's own preview replace it? Flag these rather than
  guessing.

---

## First things the Fable 5 chat should do
1. Read this file, then `PROJECT_NOTES.md`, then skim `app/server.js`,
   `app/templates/overlay.html`, `app/public/control/control.js`.
2. Confirm you're on branch `experiment/obs-dock-and-scenes`.
3. Start with Phase 1 (`?view=` param) — it's the foundation, needs no OBS, and is
   fully verifiable with the dev server via the preview tooling.
4. Work in small, verified increments; bump the version and follow the build/verify
   conventions above before calling anything done.
