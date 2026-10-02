# Widener Esports Stream Control App: Project Notes

Handoff doc for picking this up in a future session. Written at **v0.4.2**,
updated through **v0.9.0**. If you're starting a new chat, read the summary
below first, then the sections relevant to what you're changing. The later
sections are a history: each one records why something is the way it is.

## How the app works now (v0.9.0 summary)

- **One process, one port.** `main.js` starts `server.js` (Express + `ws`)
  inside Electron on port 4310, listening on `127.0.0.1` and `::1` only, and
  opens the control panel (`/control`) in a window. OBS loads `/overlay`.
- **Two copies of state.** `draft` is what the panel edits and the preview
  (`/overlay?preview=1`) shows; `live` is what OBS shows. Push Live copies
  draft to live. The only thing that writes live directly is the scoreboard's
  counters (`{type:'score'}`) and, with OBS scene-sync on, a manual scene
  switch in OBS (which sets `live.mode`).
- **One overlay page, six modes**: `starting-soon`, `post-match`, `roster`,
  `brb`, `scoreboard`, `necc`. `?view=<mode>` pins a page to one mode (OBS
  scene-sync sources); `?monitor=1` is the panel's live monitor.
- **Panel** (`public/control/`): Show and Setup tabs, overlay buttons (drawn
  from a hidden `<select>` that stays the source of truth), rosters with team
  library, match save/load, scoreboard controls, undo/redo, keyboard
  shortcuts. It sends the whole draft on every edit (debounced 150 ms).
- **Data on disk** (Electron userData, or `app/data` in dev): `state.json`
  (`{live, draft}`), `library.json` (saved teams and matches), `logos/`
  (cached NECC logos). All JSON is written through `writeJsonSafe` (temp file
  + rename + `.bak`).
- **Game montages** (v0.10.0, `montages.js`): `games.json` gives each game
  except CoD a `montage: {file, driveId, bytes}`. The server downloads it from
  Drive into `<data>/montages` on demand and serves it at `/montages/<file>`;
  the overlay plays it when `clip` is blank. See the v0.10.0 section.
- **Rocket League live data** (v0.11.0, `rlstats.js`): the scoreboard's
  `style: 'rl'` reads Psyonix's Stats API over local TCP and the server
  forwards `{type:'rl'}` snapshots to every page. See the v0.11.0 section.
- **Optional pieces**: NECC import (`necc.js`, unofficial LeagueOS API), OBS
  scene-sync (`obs.js`, obs-websocket v5), auto-update (`electron-updater`
  against GitHub releases).

## What this is

An Electron desktop app that replaces manually editing 16 near-duplicate
per-game stream overlay HTML files. One app, one stable OBS Browser Source
URL, live-editable via a control panel, with a NECC/LeagueOS match-data
import and a preview pane that doesn't affect the live stream until you
explicitly push.

Runs entirely local (Express + WebSocket server bundled inside the Electron
app, `localhost:4310`). No cloud services, no accounts.

## Repo layout

```
app/                          - the actual Electron app (this is what ships)
  main.js                     - Electron entry: starts server.js, opens control panel window
  server.js                  - Express + ws server: state model, WS protocol, NECC import route, OBS routes
  necc.js                    - LeagueOS API client (match/roster import, overlay URL construction)
  obs.js                     - optional obs-websocket client (scene-sync; fails soft if OBS absent) [v0.7.0]
  templates/
    overlay.html              - THE overlay - single file, all games, all modes (see below)
    games.json                - the 8 games' {id, name} used by the Game dropdown
  public/control/
    index.html / control.css / control.js   - the control panel UI
    assets/logo.png            - control panel header logo: the classic Widener W
                                  (NOT the app icon - see below; kept separate on purpose as of v0.6.2)
  build/
    make-icon.js               - regenerates icon.ico + PNGs from the source logo (run manually if logo changes)
    icons/                     - generated icon files (icon.ico used by electron-builder + main.js window icon)
  data/                        - dev-only state.json (gitignored-in-spirit; real app uses Electron userData)
  dist/                        - electron-builder output (the installer .exe) - NOT committed, rebuilt each time
  package.json                 - version number lives here; bump on every shippable change

Stream/                        - REMOVED from the repo folder in v0.9.0 (it was never committed). The
                                  original per-game overlay files now sit in
                                  Documents/WidenerStreamApp-legacy-Stream on the dev PC.
archive/                       - the 16 old per-game HTML files, moved here in Phase 4 (reference only)
widenerstreamlogofixed.png     - APP ICON source (used by build/make-icon.js for icon.ico +
                                  window/taskbar PNGs; replaced widener-stream-control-app-icon.png
                                  in v0.6.1). The ICON ONLY - the user explicitly wants the classic
                                  Widener W (public/control/assets/logo.png and
                                  public/overlay-assets/widener-logo.png, bundled locally in v0.6.2)
                                  as the visible brand logo in the control panel header and as the
                                  overlay's default on-stream logo. Don't regenerate those two from
                                  the icon source.
.claude/launch.json            - preview-tool server configs: "stream-app-server" (port 4310, real),
                                  "stream-app-dev" (port 4311, for testing without touching the real app)
```

## Architecture: the big ideas

1. **One overlay URL, forever.** OBS points at `http://localhost:4310/overlay`
   and never needs editing again. Everything - which game, which moment
   (starting-soon/post-match/roster), NECC bracket vs match preview - is
   **pushed state**, not a URL change. This was an explicit, repeated user
   requirement across this whole build.

2. **Draft vs Live channels.** The server holds two copies of state: `live`
   (what OBS-connected overlays see) and `draft` (what the control panel's
   own preview iframe sees). Editing a field only ever touches `draft`.
   Clicking **Push Live** copies `draft` → `live` verbatim. This is what
   makes the preview pane trustworthy - it shows exactly what will go out,
   and nothing goes out until you say so.

   As of v0.5.0 there are **no exceptions** to this. The Overlay dropdown
   (mode/NECC switching) used to bypass draft-then-push via a dedicated
   `set-mode` WS message that hit both channels immediately - the user
   reported that as broken ("preview hold doesn't work when switching
   overlays") and it was removed. Mode is now just another draft field:
   `gatherForm()` always includes `mode`/`neccUrl`/`neccType`, the dropdown
   handler edits the form + sends an immediate (undebounced) draft update,
   and Push Live is what takes it to stream. Do not reintroduce `set-mode`.

   Supporting pieces added with that change:
   - Server compares draft vs live after every update/push/revert
     (`isDirty()`, key-order-independent, ignores the derived `end`
     timestamp unless countdownMode is 'at') and broadcasts
     `{type:'dirty'}` to draft subscribers - drives the control panel's
     gold pulsing Push Live button + status line.
   - `{type:'revert'}` WS message: server copies live → draft and
     rebroadcasts; the panel sets `repopulateOnNextDraft` so that one
     draft broadcast repopulates the whole form.
   - `neccType` is a persisted state field so the dropdown can restore
     which NECC overlay is selected after an app restart; the imported
     overlay URL map also persists in localStorage
     (`widener-necc-overlay-urls`).
   - On WS reconnect (not first connect) the panel re-sends `gatherForm()`
     so edits made while disconnected aren't lost.

3. **`overlay.html`'s visual states, controlled by `state.mode`** (a fifth,
   `brb`, was added in v0.7.1 - see its own section below):
   - `starting-soon` / `post-match` - the original title/subtitle/countdown/
     montage layout (mode just toggles text defaults, title size, montage
     placeholder text).
   - `roster` - a full third view: two-team lineup (`#roster-view`), montage
     and title content hidden. Player list font/padding/gap scale via a
     `--roster-count` CSS custom property set per-team in JS
     (`renderRosterTeam`), so 2 selected players render much bigger than 7.
     Vertically centered via `align-items:center` on `.roster-view`  (NOT
     `align-content` - there's only one grid row, content-sized, so
     `align-items` is what centers each team block within it. Verified at
     real 1920x1080 - a narrower test viewport triggers the responsive
     `@media (max-width:1200px)` stacked fallback and gives misleading
     measurements if you forget to resize first).
   - `necc` - full-bleed passthrough `<iframe>` (`#necc-frame` /
     `#necc-iframe`) to a LeagueOS-hosted overlay URL (`state.neccUrl`).
     The Widener topbar/frame/content are hidden. Confirmed LeagueOS's
     overlay pages send no `X-Frame-Options`/CSP restricting embedding, so
     this works. As of v0.6.3 the frame's backdrop is controlled by
     `state.neccBg` (default true): true makes `.necc-frame` transparent so
     the body gradient + animated stripes show through transparent NECC
     pages (e.g. the bracket); false keeps the old flat black. The control
     panel checkbox for it only renders while a NECC overlay is selected,
     and it's ordinary pushed state - preview first, live on push.

4. **Preview pane renders the overlay at its real 1920x1080** inside
   `#previewScaler` (fixed 1920x1080, `transform-origin:top left`), then a
   JS-computed `scale()` shrinks the whole thing to fit `#previewBox`.
   `#previewBox`'s own pixel width/height are computed explicitly in JS
   (`updatePreviewScale` in control.js) - **do not** go back to CSS
   `aspect-ratio` + `max-height` for this, it was tried and doesn't reliably
   shrink width when height is the binding constraint (produces a distorted
   non-16:9 box). JS explicitly picks the limiting dimension.

5. **Resizable preview column**: drag `#colResizer` between the settings and
   preview columns. Below 980px window width, CSS switches to a stacked
   (rows) layout - the JS drag handler checks `matchMedia('(max-width:980px)')`
   and drags height (`--preview-height`) instead of width (`--preview-width`)
   accordingly. Both persist to localStorage.

## Curtain stinger transition (v0.6.0)

Push Live can play the Widener curtain-wipe stinger on the live overlay
(control panel checkbox "Curtain stinger on push", localStorage
`widener-stinger-on-push`, default on). Details that matter:

- The video is the same **side-by-side track-matte** file used in OBS
  (`app/public/overlay-assets/curtain-stinger.webm`, copied from
  `Stream/General/Widener_Curtain_Wipe_Stinger.webm`): 3840x1080\@60,
  3.0s, yuv420p (no alpha). Left half = curtain fill, right half =
  luminance matte. Served via the `/overlay-assets` static route.
- OBS semantics (verified against obs-studio source + Elgato docs): the
  matte crossfades old scene -> new scene per pixel (black=old, white=new)
  and the fill plays on top. This file's fill **ends on solid black over a
  full-white matte** - the "curtain opening" is the fill fading away, not
  the matte.
- The overlay reproduces that with a WebGL shader in `overlay.html`:
  `alpha = matte_luma * smoothstep(0.02, 0.07, maxRGB(fill))` - i.e. the
  matte gates visibility AND near-black fill is luma-keyed transparent.
  Without the luma key the ending would be an opaque black pop.
- Timing was **measured from the file with ffmpeg** (signalstats): the
  fill has zero near-black pixels only from 1.083s to 1.667s (the
  full-bleed W cover). `STINGER_SWAP_TIME = 1.4` applies the new state
  dead-center in that window, so the content swap is never visible. If
  the stinger video is ever replaced, re-measure and update that constant
  (and re-check the 0.02/0.07 luma-key thresholds).
- Server side: the push WS message optionally carries
  `transition: 'stinger'`; as of v0.6.1 the push broadcast passes it to
  **both** channels - the live overlay plays it for real, and the control
  panel's preview pane plays it too as operator confirmation (its content
  already matches the draft, so it's purely cosmetic there). Ordinary
  draft edits still never carry a transition.
- v0.6.1 fixed "stinger never plays" (GitHub issue #2), two stacked bugs:
  (1) the stinger `<video>` was created detached from the DOM - Chromium
  classifies a detached, muted, video-only element as "background media"
  and **rejects play() to save power**; the element now lives in the DOM,
  invisible (opacity:0, 2x2px), with the WebGL canvas doing the drawing.
  (2) `video.currentTime = 0` right before `play()` triggers a seek (even
  when already at 0) that drops readyState mid-play-request and, on
  repushes, leaves `video.ended === true` long enough for the draw loop's
  ended-check to finish() instantly. Playback now only rewinds when
  actually needed, waits for the `seeked` event before starting, and
  retries a rejected play() twice before falling back. Don't "simplify"
  this back to seek-then-play-immediately.
- Overlay side fallbacks: no WebGL (OBS with hardware accel off), missing
  file, decode error, or persistent autoplay rejection all apply the state
  immediately; a `STINGER_MAX_MS` (4s) safety timeout guarantees a push is
  never delayed longer than the stinger. A repush mid-stinger just swaps
  the pending state.

## OBS dock + scene-sync (v0.7.0), optional and additive

Two opt-in OBS integrations, layered on top of the single-URL push model
without changing it. If the operator never touches them, the app behaves
exactly as v0.6.x did.

1. **Control panel as an OBS browser dock.** Pure documentation + a helper: the
   "Run this panel inside OBS" panel surfaces a copyable dock URL
   (`http://localhost:4310/control`); the user adds it via OBS **Docks → Custom
   Browser Docks…**. No code path is OBS-specific; it's the same web panel. The
   panel already stacks below 980px, and was checked to have zero horizontal
   overflow down to 380px wide (typical dock column).

2. **Per-type overlay URL (`?view=`).** `overlay.html` reads `?view=` on load
   (`starting-soon|post-match|roster|necc|brb`). When present it **pins `mode`** to
   that view and ignores any pushed `mode` change, while still applying every
   other pushed field live (title, countdown, roster names, `neccUrl`, …). With
   no `view` param, behavior is exactly as before (single source, mode-driven).
   A view-locked page also **suppresses the in-overlay curtain stinger** (OBS
   owns transitions in that mode, so playing the WebGL wipe too would double it).
   This is the foundation that lets OBS hold a fixed source per scene.

3. **obs-websocket scene-sync (`obs.js`).** Node module in the **server**
   process (not the renderer), using `obs-websocket-js` v5. The control panel
   drives it through `/api/obs/*` routes:
   - `POST /api/obs/connect {host,port,password,sceneSync,transitionName}`,
     `POST /api/obs/disconnect`, `POST /api/obs/settings`,
     `GET /api/obs/status` (cached, sync, safe), `GET /api/obs/inspect` (live
     query), `POST /api/obs/build-scenes`, `POST /api/obs/switch {view}`.
   - **Build scenes** is idempotent: one scene + one locked `browser_source`
     per view (`WU: Starting Soon` / `WU: Post-Match` / `WU: Rosters` /
     `WU: Be Right Back` / `WU: NECC`, sources `WU-src-*`), each pointing at
     `…/overlay?view=<view>`. It reuses existing scenes/inputs by name
     (`GetSceneList`/`GetInputList`) and only corrects URL/size, so re-running
     never duplicates. One NECC scene covers all NECC types (the locked page
     reads the pushed `neccUrl`).
   - **Switch-on-push**: `server.js`'s `push` handler calls `obs.onPush(live)`
     after `pushLive()`. If connected AND scene-sync is on, it optionally sets
     the configured transition (`SetCurrentSceneTransition`) then
     `SetCurrentProgramScene` for `live.mode`. We chose switch-on-**push** (not
     on select) to preserve the preview-then-push model. That was the open question in
     the spec. Fire-and-forget + fully soft: a failed/absent OBS never delays or
     breaks the push that already went out.
   - **Stinger suppression** (the mode switch): when scene-sync is active the
     control panel disables the "Curtain stinger on push" checkbox and Push Live
     stops sending `transition:'stinger'` (`obsSceneSyncActive` in control.js),
     so OBS's transition and the WebGL wipe never both fire.
   - **Password is a secret**: entered in the panel, sent over localhost, held
     only in `obs.js` memory (+ this machine's localStorage as a convenience).
     Never persisted server-side, never logged; `scrub()` strips it from any
     error string. Verified an ECONNREFUSED path returns no password in the
     response or logs.

   **`obs.js` is a new top-level `app/*.js`, and it IS in `build.files`.**
   `obs-websocket-js` is a production dependency, so electron-builder bundles it
   from `node_modules` automatically.

   **Not yet verified against a real OBS.** The fail-soft paths (disconnected
   connect/inspect/build, push while disconnected) were verified on the dev
   server; the actual `CreateScene`/`CreateInput`/`SetCurrentProgramScene`
   behavior and transition timing need a live OBS 28+ with the WebSocket server
   enabled. That's the one remaining smoke test.

## Per-overlay text (`state.views`, v0.7.2)

**Why it exists.** Reported from real OBS use: switching scenes in OBS did not
change the wording. Every locked scene page rendered the single shared
`title`/`subtitle`/`status`, so `WU: Be Right Back` showed whatever text was
last pushed (e.g. "Stream Starting Soon") until someone pressed Push Live. The
single-source model hid this, because there the panel's dropdown seeds the text
on the way to a push. With OBS as the switcher, nothing seeds.

**The model.** `state.views` holds `{ title, subtitle, status }` per mode
(`starting-soon`, `post-match`, `roster`, `brb`, `necc`). Each overlay owns its
own words. Everything else - socials, logo, montage, rosters, countdown, next -
stays global; only those three vary per view.

- The overlay resolves text as `state.views[lockedView || state.mode]`, falling
  back to the top-level fields. **One push distributes all five views' text to
  every connected page**, so each locked scene already holds its own wording and
  an OBS scene switch needs no push at all. That is the whole point.
- The panel keeps a `viewTexts` mirror. Switching the Overlay dropdown stashes
  the outgoing view's text and loads the incoming view's, so custom wording
  survives switching away and back. `gatherForm()` sends **only the current
  view** (`views: { [currentMode]: … }`); the server merges per key so the other
  views' text is not clobbered.
- `MODE_DEFAULTS` is now a *fallback* for a view with nothing saved, plus the
  countdown each mode starts from. The countdown is global, so it still resets
  on a mode switch; the text no longer does.
- **Migration matters here.** A state file written before v0.7.2 has no `views`,
  and naively defaulting would silently replace an operator's own wording with
  "Stream Starting Soon". `normalizeViews(raw.views, raw)` detects the missing
  key and carries the shared title/subtitle/status into whichever view was
  active. Verified against real pre-0.7.2 files, including the one in userData.

**Testing note that cost time:** pushes carry `transition:'stinger'` by default,
and a push arriving mid-stinger is *queued*, not applied, until the swap point
(or the 4s safety). An automated test that pushes and reads a few hundred ms
later will see stale content and look like a mode-switching bug. It is not.
Offscreen iframes make it worse, since the stinger video cannot play there and
the run only ends via the safety timeout. Turn the stinger checkbox off when
scripting push/read assertions.

## Smash Ultimate scoreboard (`mode: 'smash'`, v0.8.0)

> **Renamed in v0.9.0.** The mode is now `scoreboard` and the state key is
> `state.scoreboard`, and it serves every game (see the v0.9.0 section). The
> reasoning below still applies; read `smash` as `scoreboard`.

A sixth mode, and the first **in-game** overlay: the page goes transparent
(`body[data-mode="smash"]` drops the gradient, stripes, and sheen) so the game
capture under it in OBS shows through. Everything else in the app is a
full-screen card; this one is meant to sit on top of gameplay.

**Format researched, not guessed.** NECC Smash is crew battles: 4 players a
side, 3 stocks each (a shared pool of 12), best of 3 sets. Players go in a
chosen order; a player who runs out is replaced by the next, and the winner
keeps their remaining stocks. Those are the `defaultSmash()` values, and all
of them are editable (crew size, stocks each, best of, round label).

- **State is `state.smash`**: `{ round, bestOf, scoreA, scoreB, crewSize,
  stocksEach, lostA, lostB, showStocks, swap }`. Stocks are stored as a
  **count lost per team**, not per-player arrays. Who is on stage is derived
  (`floor(lost / stocksEach)`, crew order = Rosters order), so editing the
  roster mid-set can't desync anything. Old state files get the defaults via
  `normalizeLoaded`.
- **The one deliberate exception to draft-then-push.** A new WS message,
  `{type:'score', smash}`, merges into **both** live and draft and broadcasts
  both with no transition (`applyScore` in server.js). Counting stocks through
  Push Live plus a 3s curtain wipe per stock would be unusable. It only
  touches `smash`, so *which overlay is on stream* still changes only on Push
  Live, and writing both channels keeps it out of the dirty check. The panel
  checkbox "Scores go live instantly" (localStorage `widener-smash-instant`,
  default on) sends the same counters as an ordinary draft update instead.
- **Counters are server-authoritative.** `gatherForm()` sends only the
  scoreboard *settings* (`smashConfig()`), never the counters, and every draft
  broadcast re-syncs the counters into the panel (`syncCounters`). This
  matters because the app window and an OBS dock are often open at the same
  time: if `gatherForm` carried counters, a text edit in the stale panel would
  roll the score back.
- **Mid-stinger ticks are queued.** A `score` broadcast arriving while the
  curtain stinger is playing becomes the new `stingerPending` instead of being
  applied, otherwise it would reveal the new view before the curtain covered it.
- Layout: fixed 1920x1080 stage (same fit as BRB, `fitBrbStage` now fits both),
  scoreboard top-center because Ultimate's HUD (damage %) is along the bottom
  and the timer is top-right. Team colours come from NECC `color` when it's a
  plain hex (`safeColor`), else Widener blue / gold, and the score digits pick
  dark or light ink by luminance.
- `?preview=1` shows a striped "Game capture shows here" stand-in behind the
  scoreboard so the preview pane doesn't look empty. OBS never gets it.
- OBS scene-sync builds a sixth scene, `WU: Smash Scoreboard` (`WU-src-smash`).
  The operator adds their game capture under the browser source in that scene.
- The panel hides Title/Subtitle/Status/Countdown while on this mode (they do
  nothing there). "Reset match" needs a second click within 3s rather than
  `confirm()`, which is unreliable inside an OBS dock.

## Be Right Back view (v0.7.1)

A fifth `state.mode`, `brb`. It came in as an externally designed page (a
self-extracting "bundled" React/Helmet HTML the user dropped in Downloads) and
was **reimplemented natively** rather than embedded: the app has no build step
and no framework, and shipping React + Babel for one static card would have been
absurd. Extracting the design was cheap because the source was already built on
this app's own tokens (identical `#0054b8` / `#f0b310` / `#eaf2ff` / `#a9b7d6`,
Inter + Kanit, and the same stripes and sheen), so it reuses the page's existing
vars, fonts, backdrop, and `icons` map instead of importing copies.

- **The lion** (`public/overlay-assets/widener-lion.png`, 842KB RGBA, 1942x1158)
  was extracted from the bundle's base64 manifest. Bundled locally like every
  other overlay asset, since nothing on the overlay may depend on an external
  host mid-broadcast. Under `public/**`, so it ships without a `build.files`
  change.
- **Fixed 1920x1080 stage.** The design is authored in absolute px (content at
  304,212; a 150px headline; a 730x5 bar). Rather than re-expressing all of it
  in vw/vh, `.brb-stage` renders at true size and `fitBrbStage()` scales and
  centers it for the viewport, the same trick the control panel preview uses.
  Verified the rendered geometry matches the source design exactly.
- **`fitBrbHeadline()` is load-bearing, not polish.** The 150px `nowrap`
  headline was sized around the short "Be Right Back", but it renders
  `state.title`, which the operator can set to anything. "Stream Starting Soon"
  measured 2061px against a 1920 stage and was being clipped. It now shrinks the
  type to fit.
  - It measures with `width:max-content` **temporarily, then restores**. The h1
    is a block that fills its container, so `scrollWidth` reports the widest
    sibling row, which would shrink short headlines for nothing. The width is
    not left as max-content because the gradient is `background-clip:text` over
    the *box*, so hugging the text would change the intended colour ramp.
  - Re-fit on `document.fonts.ready`: a width measured against the fallback font
    sizes the headline wrongly.
- **Fields are shared, not new.** It reads `title`, `subtitle`, `brand`, and
  `socials`, so it is live-editable like everything else and **the state shape
  did not change**. `MODE_DEFAULTS.brb` seeds the two lines on selection, and
  the dropdown handler now applies **only the keys a mode defines**, so BRB
  (which has no countdown) stops resetting the countdown settings.
- Entering the view re-runs both fits and restarts the headline wipe, so
  switching to BRB always plays its intro instead of showing a finished card.

## Control panel help conventions (v0.7.0)

The panel used to carry its guidance as inline parenthetical `.hint` text in
every label plus `title=` attributes. That got unreadable once the OBS sections
landed, so help now lives in two places, and **new controls should follow the
same pattern** rather than reintroducing inline hints:

- **Short tips: a hover/focus info point.** `<span class="info" tabindex="0"
  role="button" aria-label="More information" data-tip="…">i</span>`, placed
  inside a `<span class="lbl">` alongside the label text.
- **Longer setup walkthroughs: a `<details class="help">` disclosure**, closed
  by default, with the steps in an `<ol>` inside `.help-body`.

Details that matter if you touch this:

- **One shared bubble, not a CSS `::after`.** `control.js` creates a single
  `.tip-bubble` on `document.body`, positions it `fixed`, and **clamps it to the
  viewport** (flipping below the dot when there's no room above). A CSS-only
  tooltip was rejected because `.settings-col` is `overflow-y:auto`, which clips
  on both axes, so bubbles got cut off in a narrow OBS dock. Verified all 14
  info points stay fully on-screen at 380px wide.
- **A `visibility:hidden` element still has a layout box**, which is why the
  bubble can be measured and positioned before it's shown, with no flicker.
- **The click handler calls `preventDefault()`.** An info dot sits inside
  `<label>` elements (e.g. the stinger checkbox), and without this, clicking the
  dot toggles that checkbox. This was caught in testing; don't remove it.
- Hover, focus, Escape, resize, and **capture-phase** scroll all drive show/hide.
  Capture phase is required because scrolling `.settings-col` doesn't bubble.
- **Label markup wraps text + dot in `<span class="lbl">`.** Field labels are
  `display:flex; flex-direction:column`, so without the wrapper the dot becomes
  its own anonymous flex item and drops to a line of its own.
- The stinger checkbox's tip text is **rewritten at runtime** by
  `renderObsStatus()` to explain why it's disabled under scene-sync.
- **No em-dashes in user-facing strings** (panel, overlay, or docs). This is a
  stated user preference, applied throughout in v0.7.0.

## NECC / LeagueOS integration (`necc.js`)

This talks to **`api.leagueos.gg`, which is not an official/documented public
API** - it's what LeagueOS's own web app calls for any anonymous visitor
viewing a public match page. Reverse-engineered from their client JS bundle.
No login, no API key in the traditional sense - just three lightweight
anti-abuse headers computed with a simple string-hash function
(`x-leagueos-did`, `x-leagueos-aid: "los-league"`, `x-leagueos-rid` - a
10-second-bucketed rolling signature). If LeagueOS changes this internal
contract, `importMatch()` throws and the feature degrades to manual entry -
nothing else in the app depends on it.

Confirmed-working endpoints:
- `GET /los/matches/{matchId}` → game/activity name, scheduled date, event
  name, division, `leagueId`
- `GET /los/matches/{matchId}/rosters` → both teams: name, tag, colors,
  `avatar` (logo hash), parent org name, and full member roster (real name,
  gamertag/`leagueTag`, `teamRank` position - `-1` means sub/coach, `1..N`
  means starter slot)
- `GET /league/stages/{stageId}` → resolves `seasonId` (the one ID not
  available from match/roster payloads directly)
- Team/org logos: `https://images.leagueos.gg/teams/{teamId}/{avatarHash}`
  (or `/groups/{orgId}/{iconHash}` fallback)
- Overlay asset URLs: `https://overlays.leagueos.gg/o/{type}/{league}/{season}/{stage}/{match}/`
  - segment count varies by type: `seasonHeader` needs league+season only,
    `stageBracket` needs +stage, the rest (`matchPreview`, `matchActivity`,
    `matchProgress`, `matchRosters`) need all four. This was verified
    **byte-for-byte** against a real URL the user provided.

`importMatch(url)` returns `{ matchId, game, eventName, division,
scheduledAt, teams: [...], overlayUrls: {...} }`. As of v0.6.4 an import just
**pre-fills the editable roster panel** (`neccToRoster()` keeps the starters,
`position >= 0`); it's no longer a separate read-only chip picker.

## Editable rosters (control panel, v0.6.4)

The Rosters panel is a plain editable form, always visible - it does NOT
require a NECC fetch anymore. `rosterA`/`rosterB` are the local model
(`{ name, tag, color, colorAlt, logoUrl, players: [{name, gamertag}] }`);
`renderRosterEditor(letter)` rebuilds the DOM rows from the model, each row's
inputs write straight back into the model on `input` and call `pushDraft()`.
Add/remove buttons mutate `players` and re-render. Key points:
- `gatherForm()` **always** sends `teamA`/`teamB` now (via `rosterPayload()`),
  which drops rows where both gamertag and real name are blank - so an empty
  "add player" row you're still typing into never shows as a nameless slot on
  stream, but stays in the editor.
- `populateForm()` seeds `rosterA/rosterB` from `state.teamA/teamB` and
  re-renders, so restore-on-connect and Revert rebuild the editor correctly.
- A NECC fetch fills the same model via `neccToRoster()` (starters only;
  subs/coaches are dropped by default and can be re-added/renamed by hand).
- The overlay side is unchanged - `renderRosterTeam()` already rendered
  whatever `players` array it was given, so manual entries "just work",
  including the `--roster-count` size scaling.

## Local media (`/media` route, v0.6.1)

The control panel's Browse buttons store the logo/clip fields as plain
filesystem paths (`C:\...`), but the overlay is an http page and Chromium
refuses to load `file://` subresources from it - this is why "montage clip
never appears" (GitHub issue #4) happened. The fix: the server exposes
`GET /media?src=<absolute path>` (express `sendFile`, so Range requests for
video seeking work), and the overlay's `mediaUrl()` rewrites Windows/UNC
paths and `file://` URLs to it. http(s) URLs pass through untouched. The
route only serves whitelisted video/image extensions, and a clip that fails
to load shows the montage placeholder with "Clip failed to load" instead of
an empty black panel.

Related v0.6.1 fix (GitHub issue #3): a NECC **Fetch now overwrites** the
game name, `vs <opponent>` subtitle, and scheduled countdown time on every
successful import. It used to fill only empty fields, so re-fetching a new
match link kept showing the previous opponent.

## Two real bugs found during this build (both fixed, worth knowing about)

1. **`set-mode` server handler only ever applied `mode`, silently dropping
   the rest of `data`.** (Historical - `set-mode` no longer exists as of
   v0.5.0; mode switching goes through the normal draft update flow. Kept
   here as context for why the old design was abandoned.)

2. **Packaging omission**: `necc.js` was added as a new top-level file but
   not added to `package.json`'s `build.files` whitelist, so it worked
   perfectly in dev (`node server.js` reads files off disk) but crashed the
   packaged app on launch (`Cannot find module './necc'`). **Any new
   top-level `app/*.js` file must be added to `build.files` in
   `app/package.json`.** Currently whitelisted: `main.js`, `server.js`,
   `necc.js`, `obs.js`, `package.json`, `templates/**/*`, `public/**/*`,
   `build/icons/**/*`.

General lesson from this project: **always smoke-test the actual packaged
exe** (`app/dist/win-unpacked/Widener Esports Stream Control.exe`) before
calling a build done - dev-mode (`node server.js`) and the packaged app do
not always behave the same (file whitelisting, userData path for state
persistence, asar read-only-ness).

## v0.9.0: the 25-item batch

A review of the whole app produced a numbered list; these were done together.
The ones with non-obvious reasoning:

- **Countdown no longer restarts on every edit (bug).** Every draft update
  carries `durationSec`, and `updateChannel` used to recompute `end` whenever
  it was present, so fixing a typo and pushing reset the countdown on stream.
  `end` is now recomputed only when the duration actually changes, the mode
  switches into "count down from now", or the update carries
  `restartCountdown: true` (the Restart countdown button, or selecting an
  overlay with its own countdown). `restartCountdown` is never stored.
  `isDirty()` now compares `end` too, since it only changes deliberately, and
  `pushLive()` restamps a restarted countdown at push time so waiting before
  pushing doesn't shorten it.
- **Localhost only.** The server listened on every interface, so anyone on the
  campus network could open the panel and change the stream. It now listens on
  `127.0.0.1` and `::1`. Both, because Chromium resolves `localhost` to `::1`
  first on Windows: with IPv4 only, every WebSocket connect took ~330 ms
  (failed IPv6 attempt, then fallback); with both it takes ~3 ms. The WS
  server runs in `noServer` mode and is attached to both listeners' `upgrade`
  events. `WIDENER_HOST` (env) or `opts.host` overrides with a single address
  if LAN access is ever wanted again.
- **Safe saves.** `writeJsonSafe` writes `file.tmp`, copies the old file to
  `file.bak`, then renames. A failed save logs and never throws (it used to
  run inside the WS handler, where a throw could crash the server). Loading
  falls back to `.bak`. Verified by truncating `state.json` mid-object.
- **Local fonts.** Inter 400/600/700/800 and Kanit 600/700/800 (latin, woff2,
  from Fontsource, OFL licence files alongside) in
  `public/overlay-assets/fonts`, `font-display:block`. Kanit italics were
  deliberately not added: the BRB card has always used synthesized italics,
  and real italics would change its look.
- **NECC logo cache.** `/api/necc/import` downloads each team logo to
  `userData/logos/<sha1>.<ext>` and rewrites `logoUrl` to `/logos/...`. On any
  failure the remote URL is kept. **Not verified against a live NECC import
  yet** (no public match link was available while building).
- **Scoreboard for every game.** `smash` became `scoreboard`, with `unit`
  (Game/Map/Set/Round), `position` (`top` = full bar, or a corner = compact
  box), and `showStocks` (default off; the Smash preset turns it on).
  Migration: `normalizeScoreboard` maps an old `smash` object to
  `{unit:'Set', showStocks:true, ...}`, `mode:'smash'` becomes `scoreboard`,
  `views.smash` becomes `views.scoreboard`, and the overlay treats
  `?view=smash` as `scoreboard`. OBS: the scene entry has `legacy` names, and
  Build scenes **renames** `WU: Smash Scoreboard` / `WU-src-smash` in place
  (keeping the operator's game capture inside it) instead of creating a
  second scene; `switchToView` falls back to the legacy name if the scenes
  haven't been rebuilt.
- **Per-game presets** live in `games.json` (`scoreboard` object per game). The
  corner positions and best-of values for non-Smash games are **best guesses,
  not checked against each game's HUD or NECC rules**; the user was told to
  verify them over real gameplay. Picking a game applies only scoreboard
  settings; it does not switch overlays.
- **Team + match library.** Server-side (`library.json`) so the app window and
  an OBS dock share it; changes broadcast as `{type:'library'}`. Teams upsert
  by id, then by case-insensitive name, so re-importing an opponent updates
  their entry. Every NECC import saves both teams. A saved match holds the
  setup (teams, text, countdown, scoreboard settings, NECC links) but never
  the current overlay or the live score; loading keeps both.
- **Undo/redo** is client-side: whole-form snapshots (all views' text
  included), edits within 1.2 s grouped into one step, 100 steps. Scoreboard
  counters are excluded (they have their own Undo). A Revert and a match
  load are each recorded as one undoable step. Restoring sends every view's
  text, not just the current view's.
- **Auto-update.** `electron-updater`, GitHub provider. It downloads in the
  background and **asks** before restarting (a restart blanks every OBS
  source for a few seconds); "Later" installs on quit. The installer's
  `artifactName` has no spaces, because GitHub turns spaces into dots on upload
  and `latest.yml` would then point at a file that doesn't exist. **Every
  release must attach `latest.yml` and the `.blockmap` with the `.exe`.**
  v0.8.0 and earlier have no updater, so v0.9.0 is a manual install; updates
  work from v0.9.0 onward. `npm run dist` passes `--publish never` so a stray
  `GH_TOKEN` can't publish from a local build.
- **OBS reconnect.** `obs.js` remembers the last good connect config (memory
  only) and retries every 5 s after `ConnectionClosed`, until an explicit
  Disconnect. The panel remembers that it has connected before (`autoConnect`
  in localStorage) and connects on startup with `retry:true`, so the app
  connects even if OBS opens second. A header light shows OBS state; the panel
  polls `/api/obs/status` every 4 s.
- **OBS scene changes follow back.** `CurrentProgramSceneChanged` maps the
  scene to a view and, with scene-sync on, sets `live.mode`, so the LIVE
  marker and live monitor reflect a manual OBS switch. Draft is untouched,
  so the panel correctly shows the preview as differing from live.
- **Panel layout.** Show/Setup tabs (`data-tab` on each `.panel`, `hidden`
  attribute; `.conn[hidden]` needed an explicit rule because `.conn` sets
  `display:flex`). Overlay buttons are drawn from the hidden `overlaySelect`,
  which stays the source of truth. The live monitor iframe loads lazily on
  first use.
- **Drag to reorder players**: rows become `draggable` only while the handle
  is held, so text selection in the inputs still works.
- **NECC loading state**: spinner until the iframe `load` event; after 12 s the
  preview and monitor say LeagueOS hasn't answered. A cross-origin iframe
  can't report failure, and Chromium fires `load` on its error page after
  ~20 s, which clears the spinner. That is expected, not a bug.
- **Housekeeping**: `OBS_INTEGRATION_SPEC.md` removed (the feature shipped in
  v0.7.0; history keeps it). `Stream/` moved out of the repo folder.

## v0.10.0: game montages

- **Where the videos live.** Seven silent 1080p60 H.264 MP4s (CoD has none),
  6.56 GB together, in the team Drive's Stream folder, shared "anyone with the
  link". Far too big for the installer: NSIS fails above ~2 GB, GitHub release
  assets cap at 2 GB, and every auto-update would download them again. So
  `montages.js` downloads each one on demand from
  `drive.usercontent.google.com/download?id=…&export=download&confirm=t`
  (`confirm=t` skips Drive's "can't scan for viruses" page for big files).
- **Download rules.** One at a time; the game just picked jumps the queue.
  Writes to `<file>.part` and resumes with a Range request after a dropped
  connection or app restart. A file is only used once its size matches
  `games.json` and it starts with an MP4 `ftyp` box. An HTML response (the
  file went private) fails at once and is never written. A finished file of
  the wrong size is left alone and reported, not overwritten. Picking a game
  doesn't retry a failed download (each edit would hit Drive again); the
  Setup tab's Retry / Download all do.
- **When downloads start.** On any draft update or push whose game is
  missing a montage, and at startup for the live and draft games. The startup
  calls sit at the end of `createServer`, after `wss` exists: called earlier,
  the first progress broadcast threw and the server failed to start.
- **Overlay.** `clipFor(state)`: `state.clip` if set, else the game's montage
  if `have`. The server sends `{type:'montages'}` to every page on subscribe
  and on change, so a montage that finishes downloading starts playing with
  no push. The preview and live monitor show download progress in the
  placeholder; the stream keeps its usual placeholder text.
- **Paused video.** Chromium pauses muted autoplay video while a page is
  hidden, and OBS reports a browser source hidden while its scene is off
  program. It didn't always resume, so the montage froze after a scene
  switch. The overlay now calls `play()` on `visibilitychange` and on any
  `pause` while visible.
- **Dev.** `WIDENER_MONTAGE_DIR` points the montage folder somewhere other
  than `app/data`, which sits in OneDrive on the dev PC.
- **Changing a montage.** Upload the new file to Drive, share it "anyone with
  the link", put its ID and exact byte size in `games.json`, and ship a new
  version. PCs with the old file report a size mismatch until it is deleted
  from `<data>/montages`; use a new filename to have them download it on
  their own instead.

## v0.11.0: Rocket League scoreboard (`rlstats.js`)

The user asked for a dedicated Rocket League board that "works the same way
the BARL overlay works", matching the other boards' look, plus a custom boost
meter in the bottom right.

- **The data source.** After the EAC update locked BakkesMod out of online
  play, Psyonix shipped an official Stats API (`MatchStatsExporter_TA`).
  BARL 2.x reads it (the installed BARL 1.6.4 on the dev PC is the old
  BakkesMod/RCON version; that is not what this copies). Despite Psyonix's
  docs calling it a websocket, it is a **raw TCP socket** on 127.0.0.1:49123
  streaming **concatenated JSON objects with no delimiter**, and each
  message's `Data` is a **JSON-encoded string**. `createFramer()` splits the
  stream by brace depth while tracking string/escape state (player names can
  contain braces). Speeds are Unreal units/s (`x0.036` for KPH). The goal
  banner's KPH was dropped after real-game testing: the user reported it was
  always wrong. `rlstats.js` still sends `kph` on goal events.
- **Turning it on.** Off by default: `PacketSendRate=0` in
  `Documents\My Games\Rocket League\TAGame\Config\TAStatsAPI.ini` (the game's
  own copy of the install folder's `DefaultStatsAPI.ini`; the install copy
  needs admin and isn't what the game reads after first launch). On the dev
  PC Documents is redirected into OneDrive, so `configCandidates()` tries
  Electron's documents path, `%OneDrive%\Documents`, `~\OneDrive\Documents`
  and `~\Documents`. The panel's button calls `POST /api/rl/enable`, which
  edits only that section's keys. The game reads the file at launch only.
  **Careful testing this**: `configStatus()` falls through to the next
  candidate when the first has no file, so a test pointing `documentsDir` at
  a temp folder will happily find and edit the real file. Override
  `USERPROFILE`, `HOME` and `OneDrive` too (this happened once in development
  and was reverted).
- **Not state.** The game feed is not in `live`/`draft`: it is high-frequency
  (throttled to ~30/s), not persisted, and both preview and stream show the
  same game. Only the board's settings (`style`, `rlAutoSeries`, `rlPlayers`,
  `rlBoost`, `rlGameColors`) live in `scoreboard` and go through Push Live.
  The socket is only open while either channel's style is `'rl'`
  (`updateRlActive()`).
- **Series auto-count** (`countSeriesWin`): `MatchEnded.WinnerTeamNum` (falls
  back to the last team scores) adds a win via `applyScore`, the same path as a
  panel click. Team 0 (blue) is the **left side**, i.e. team A unless `swap`.
  Guarded by MatchGuid and a 15 s window (bot matches have no GUID), and stops
  once a team has clinched so a post-series show match doesn't count. Uses the
  **live** board's settings: previewing the RL style without pushing counts
  nothing.
- **Overlay.** Reuses the `.sb` bar markup (narrower columns) so it matches
  the Smash board: score boxes show this game's goals, the centre shows the
  clock (`+m:ss` in overtime, REPLAY/PAUSED as words), series pips hang under
  each team. Around it: per-team boost bars (top corners), a goal banner, and
  the boost meter (SVG ring with `pathLength=100`, 270 degree sweep starting
  bottom-left, team-colour arc, blue-to-gold Widener rim, stats plate). Boost
  is spectator-only in the API: absent means unknown and renders as a dash.
  The meter follows `Game.Target` and hides in replays and free cam. The
  preview (never the stream or live monitor) shows `RL_SAMPLE` when no match
  is running so the layout can be checked.
- **Cleanup pass (user feedback on the first test build).** "Looks a bit
  soft": the scoreboard view (every game, not just Rocket League, so Smash
  still matches) dropped its gradients, glows and deep soft shadows for flat
  panels (`--sb-panel`, `--sb-dark` on `.sb-view`) and a tight
  `drop-shadow(0 3px 8px)`. The boost meter shrank from 264px to 184px, uses
  square arc ends, and has a faint Widener W watermark behind the number:
  `widener-logo.png` used as a CSS **mask** over a flat fill, so it reads as a
  single-colour silhouette rather than a faded colour logo.
- **Long team names** (all scoreboard layouts): `fitTeamName()` drops a
  trailing "University" only when the full name overflows its box. It
  measures live, so it re-runs once the real font has loaded.
- **Series length from NECC.** `importMatch()` now returns `bestOf` from the
  match's own `matchFormat`/`matchGameCount` (no extra request; verified
  against a real NECC match: `bestOf`, 5). Only odd best-of counts are used.
  The panel keeps it in `neccBestOf` so picking the game afterwards doesn't
  reset it to the preset; changing Best of by hand clears it. Rocket League's
  preset is now best of 7, and Best of gained a 9.
- **RLCS-style rework (second round of feedback).** The user sent RLCS
  screenshots and asked for a stats screen like theirs, automatic switching to
  it after each game, a series overview when the series ends, and a board
  "more like the RLCS one, don't copy it, use it to make ours cleaner and
  sharper". So the Rocket League style no longer reuses the wide `.sb` bar:
  - `.rlb`, a compact centre box: round/game strip, logo (or tag) boxes,
    goal boxes, a white clock box (gold in OT, blue for REPLAY), tags and
    series pips under it. The edge player rows are flush to the screen edge
    and the followed player's row fills with the team colour.
  - `.rls` screens (`#rls-game`, `#rls-series`): opaque full-stage screens
    with the Widener stripes and a big faint W. One CSS grid per stats table
    so rows line up across both teams; the middle column has each stat's
    team-total comparison bar. MVP is the top scorer on the winning team (the
    game's own rule); series MVP the same over series totals.
  - **Game records** (`rl-series.json` in the data dir): on MatchEnded the
    server stores score, map, OT, which roster team was blue, and each
    player's final stats (rlstats now attaches `players`/`arena` to the event).
    Players are mapped to roster teams per game through `blue`, so teams that
    change colour between games still total correctly. Reset match sends
    `rlSeriesReset`. Games after the series is clinched are not recorded.
  - **Screen state** (`rlScreen`, server-owned, not in live/draft, sent as
    `{type:'rlSeries'}`): 3 s after a game ends -> that game's stats; if it
    clinched the series, 15 s later -> overview. A match loading
    (`matchStart`, from MatchCreated/MatchInitialized or the first UpdateState
    after none) returns to live **only mid-series**: found in testing that the
    mock's next lobby loaded 12 s after the final and cancelled the overview.
    The panel's On the board buttons send `{type:'rlScreen'}`.
  - Tested with `test_screens`-style scripts against a fake TCP game (auto
    stats, return to live, clinch, overview staying up, manual switching,
    reset) and visually with the mock.
- **Background music (third round).** Asked for: music whenever there's no
  gameplay, the supplied track bundled, a custom file option, and in built
  scenes a looping media source that doesn't restart when a scene opens, so
  transitions stay smooth.
  - **One shared source**, `WU: Music` (`ffmpeg_source`, looping,
    `restart_on_activate:false`, `close_when_inactive:false`), added to every
    WU scene by `buildScenes()`. A source in several scenes is one source:
    it never restarts on a scene switch and plays once during a transition.
  - **When**: decided by the server (`gameplayOnScreen()`), applied by
    `obs.setMusic()` as a dB fade on that source (1.5 s; 300 ms for volume
    changes). Needed because the RL stats screens live in the same Scoreboard
    scene as the game. Silent on any non-RL scoreboard, and on the RL board
    while a match is in progress **or the game feed isn't connected** (never
    risk music over a match). Updated on push, OBS program-scene changes,
    `rlScreen` changes, and RL feed status/inMatch changes.
  - **File**: the included track (`rl-music-long.m4a`, 36 MB, about 25
    minutes) is **not in the installer**: the user didn't want it shipped in
    public releases. It briefly was (extraResources, commit 146500b, so it is
    still in git history); now it downloads from the team Drive into
    `<data>/music` through a second `createMontages()` instance (same resume,
    size and `ftyp` checks; an m4a has the MP4 header). It downloads on start
    when music is on and no custom file is set; the panel shows progress and
    a retry button. Until it exists `musicFile()` is '' and nothing plays or
    gets built. Settings (`enabled`, `file`, `volume` 0-100 mapped to -40..0 dB)
    are machine-level in `settings.json`, not live/draft. A custom file that
    disappears falls back to the bundled track.
  - Tested against a fake obs-websocket (module swapped via `Module._load`):
    source settings, every scene, one source, fades per view and RL state,
    volume, custom/missing file, persistence. **Not yet tried in real OBS.**
- **Stinger into stats.** The game -> stats cut plays the in-overlay curtain
  stinger. `stingerTransition(data)` became `playStinger(apply)` (a callback),
  and anything arriving mid-stinger is chained with `queueStinger` so nothing
  is dropped. It plays even on a view-locked page, because this change happens
  inside the Scoreboard view where OBS has no transition. The screen is swapped
  in under the curtain with its own wipe suppressed (`.cut`, set only when the
  screen changes so a later redraw doesn't restart the wipe).
- **Swap hint.** The panel matches in-game names against roster
  gamertags and offers "X is on blue: swap sides" when they disagree.
- **Testing without the game**: `node app/dev/mock-rlstats.js 49155 --fast`
  plus the `stream-app-rl-mock` launch config (server on 4312 with
  `WIDENER_RL_PORT=49155`). The mock plays whole games with goals, replays,
  overtime and a MatchEnded in under a minute. `dev/` is not in the build.
- Verified with the mock in the preview tool at 1920x1080 (board, bars, meter,
  goal banner, replay, auto-count on push, swap hint, API-off panel state)
  and a scripted fake-game test of the series logic. **Not yet verified
  against the real game**, which on the dev PC still has the API turned off.

## State shape (server.js `DEFAULT_STATE`)

```js
{
  mode, game, team, title, status, subtitle, next,
  countdownMode: 'duration'|'at', durationSec, end,   // end is the absolute ISO timestamp; in 'duration'
                                                        // mode it only changes on a deliberate restart (v0.9.0)
  layout: 'left'|'right', clip, logo, montage: bool,
  neccUrl, neccType,                                    // only meaningful when mode === 'necc';
                                                        // neccType is the dropdown key (e.g. 'stageBracket')
  views: {                                              // per-overlay text (v0.7.2); everything else is global
    'starting-soon'|'post-match'|'roster'|'brb'|'necc'|'scoreboard': { title, subtitle, status },
  },
  socials: { twitch, twitter, instagram, youtube },     // default to "wideneresports" for all four
  teamA, teamB: { name, tag, color, colorAlt, logoUrl, players: [{name, gamertag}] },
  scoreboard: { round, unit, bestOf, position,                  // v0.9.0 (was `smash` in v0.8.0);
                scoreA, scoreB, lostA, lostB, swap,            // counters change via {type:'score'}
                crewSize, stocksEach, showStocks,
                style: 'standard'|'rl',                        // v0.11.0
                rlAutoSeries, rlPlayers, rlBoost, rlGameColors },
}
```
Both `live` and `draft` are this same shape, persisted together in one
`state.json` as `{ live, draft }`. `normalizeLoaded()` merges any loaded file
over fresh defaults (not a straight replace) specifically so old state files
missing newer fields don't break the app - **keep doing this** when adding
new state fields.

## Build / test workflow

- Dev server: `node app/server.js` (or the `stream-app-dev` launch.json
  config, port 4311) - fastest iteration loop, no packaging needed.
- Full app dev run: `npm start` in `app/` (runs `electron .`).
- Package: `npm run dist` in `app/` (runs `electron-builder --win --publish never`) →
  `app/dist/Widener-Esports-Stream-Control-Setup-{version}.exe` plus `.blockmap`
  and `latest.yml`. Release all three on GitHub (see the auto-update notes).
- Server behaviour checks: a throwaway Node script against `createServer(port,
  {dataDir: <temp dir>})` exercised migration, countdown, score, library and
  corrupt-file recovery for v0.9.0. Worth turning into real tests.
- **Always bump `version` in `app/package.json` before rebuilding** - the
  user explicitly asked for this on every shippable change.
- Verification pattern used throughout this build: start the dev server via
  the Claude_Preview tool, drive it with `preview_eval`/`preview_fill`/
  `preview_click`, inspect actual DOM/computed-style/WS state rather than
  trusting screenshots alone (screenshots of this app intermittently time
  out in the preview tool for reasons unrelated to the app itself - use
  `preview_eval` + `getBoundingClientRect()`/`getComputedStyle()` instead
  when a screenshot hangs).
- The user has repeatedly asked to launch the **unpacked** build
  (`app/dist/win-unpacked/Widener Esports Stream Control.exe`) directly as a
  no-install "test ground" - launching it locks those files, so **check
  `tasklist` for a running instance and ask before killing it** if you need
  to rebuild.

## Known gaps / things not yet done

- An *early* OBS WebSocket integration (for a NECC/Widener source toggle) was
  removed at v0.4.1 in favor of the iframe approach. A **new, different**
  obs-websocket integration was then added at **v0.7.0** (`obs.js`, scene-sync)
  - see that section above. The two are unrelated; the app still has **no hard
  OBS dependency** (scene-sync is opt-in and fails soft).
- No automated tests - everything has been verified manually via the
  preview tool per session (plus ad-hoc server scripts in v0.9.0). There is no CI.
- Not yet verified for v0.9.0: the NECC logo cache against a real import, OBS
  reconnect and the legacy scene rename against a real OBS, and the
  auto-updater end to end (needs a second release after v0.9.0 to update to).
- The LeagueOS integration is inherently fragile (unofficial API) - if a
  future session finds `importMatch()` failing, check whether LeagueOS
  changed their header-signing scheme or endpoint shapes before assuming
  the code is broken.
- `archive/` at the project root is leftover from before this app existed -
  safe to ignore, not part of the shipped app.
