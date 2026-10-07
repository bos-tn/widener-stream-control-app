# Widener Esports Stream Control App: Project Notes

Handoff doc for picking this up in a future session. Written at **v0.4.2**,
updated through **v2.1.0**. If you're starting a new chat, read the
v2.0.0 section first: it changed the app's whole model (OBS first, one state,
no Push Live), so much of the history below describes things that are gone.
The later sections are a history: each one records why something is the way
it is. v1.0.0 split everything league-specific into profiles (Widener and
League of the East); read that section before touching the build.

## How the app worked in v0.9 to v1.0 (see v2.0.0 for what changed)

- **One app per league (v1.0.0).** `profiles/<id>/` holds a league's name,
  colours, art, stinger, games, OBS prefix, port and installer identity;
  `build/dist.js` builds one installer per profile. Widener: port 4310,
  `WU:` scenes, `latest.yml`. League of the East: port 4320, `LotE:`
  scenes, `lote.yml`. Wherever this summary says 4310 or WU, read the
  profile's values.

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
- **Panel** (`public/control/`, rebuilt in v0.12.0): Studio Mode monitors
  (Preview, Push Live, Live) beside three pages: Prep (game, match, teams, team
  library cards), Live (overlay strip drawn from a hidden `<select>` that stays
  the source of truth, scoreboard card, an inspector showing only the
  previewed overlay's fields) and Settings. Undo/redo, keyboard shortcuts, a
  setup guide, toasts with Undo. It sends the whole draft on every edit
  (debounced 150 ms).
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
  measures live, so it re-runs once the real font has loaded. (Rebuilt in
  v2.1.0: see that section.)
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

## v0.12.0: control panel rebuild (test build)

From a usability review for a general audience (written up in the
"Adapting the Stream App for a New Esports League" doc, Control panel
usability tab). Measured on v0.11.0 at 1440x900: the Show tab was 2,513 px of
scrolling with 124 controls while the scoreboard was up, the preview got 397 x
223 px with black bands filling 61% of its column, and preview and live were
never on screen together. The rebuild keeps the overlay page, the state shape
and the WS protocol; nearly all of it is `index.html`, `control.css` and
`control.js`, plus two server additions.

- **Studio Mode monitors.** `#monitors` holds Preview (green, `?preview=1`),
  the push column, and Live (red, `?monitor=1`, now always loaded). The same
  DOM serves every page; only `.layout[data-page]` CSS moves it: across the top
  on Live, a right-hand column on Prep and Settings, stacked on top below 980
  px (OBS dock: preview full width, live as a small thumbnail beside Push
  Live). Never move the iframes in the DOM: that reloads them. `fitMonitor()`
  sizes each 16:9 box from its wrap, same reasoning as the old preview.
  Settings, Display can turn the live monitor off (it loads `about:blank`) for
  slower PCs.
- **Pages.** Prep (game, match import and saved matches, teams, team library),
  Live (overlay strip, scoreboard card, inspector), Settings. `widener-page`
  in localStorage; v0.11's `widener-tab` maps setup to settings.
- **Inspector.** Every field group in `#inspector` lists its overlays in
  `data-modes`; `applyInspector()` hides the rest. It follows what the overlay
  page actually draws: Rosters shows logo and next match (frame) but not the
  title, Be Right Back shows title and subtitle only, Scoreboard hides the
  inspector entirely (the Scoreboard card is its fields). The scoreboard card
  still shows while the scoreboard is live, after the inspector (`order:2`).
- **Overlay strip.** Cards with thumbnails drawn from the panel's own fields
  (`thumbHtml`), redrawn on every edit through `scheduleStripRender()`; no
  extra overlay pages. NECC cards without an imported match are dashed, say
  "Needs a match import", and take you to the import box.
- **Panel preferences on the server.** Transition on push, push on pick,
  instant scores, enabled NECC types, the last import's NECC links and
  `setupDone` used to be per-window localStorage, so the app window and an OBS
  dock disagreed. Now `settings.json` `panel`, `GET/POST /api/prefs`, broadcast
  as `{type:'prefs'}`. The first panel after the upgrade copies its old
  localStorage values up (`legacyPrefs`, only while `saved` is false).
  Text size, live monitor, page and folded cards stay per window on purpose.
- **Repopulate.** A draft broadcast can carry `repopulate: true`; every panel
  then reloads its form from it. Used by revert (so a second panel can't send
  its stale form back over a reverted draft, which v0.11 allowed) and by the
  remote overlay switch.
- **Remote control (`/api/remote/*`).** POST only. `push`, `discard`,
  `overlay/<view>` (and `overlay/necc-<type>`), `score/<a|b>/<win|point|
  unpoint|stock|unstock>`, `score/swap`. Overlay picks mirror the panel
  (countdown restart for Starting Soon / Post-Match, push if switchPush).
  Scores always go to both channels. A request with an Origin header other
  than this app's own is refused (403), so a web page can't drive it by CSRF;
  Stream Deck plugins and Companion send no Origin. `doPush()` is now shared
  by the WS handler and the remote route.
- **Setup guide.** A modal: managed scenes (recommended) or one browser
  source, connect, build scenes, download videos, done. Opens by itself only
  when the install looks fresh (no library teams or matches and OBS never
  connected from this window); an upgraded install is marked done silently.
  Settings can run it again.
- **Smaller pieces.** Browse-first file fields (`makeFileField`: name chip,
  Browse, Paste a link, Clear; the hidden text input stays the value) for the
  logo, background video and team logos. A window with no file path access
  (an OBS dock) says so instead of storing a bare file name. Countdown typed
  as minutes:seconds (`parseDuration`; the server still gets seconds).
  Rosters fold to one line once filled. Team library as cards with search and
  a side sheet editor. Deletes (saved match, library team) happen at once with
  an Undo toast. `?` opens the shortcut list; Ctrl+plus/minus/0 set text size
  (fonts are rem against `--ui-scale`; Ctrl+= is taken so Electron's page zoom
  doesn't also run). Collapsible cards remember their state. Renames: Revert to
  Discard changes, Status pill to Badge text, Curtain stinger on push to Play
  transition, Fetch to Import, montage clip to Background video, Turn on the
  Stats API to Connect to Rocket League, scene-sync to "Let the app switch OBS
  scenes", music volume in % instead of dB. Window default 1280 x 860.
- **NECC import subtitle.** "vs <opponent>" now goes into Starting Soon's view
  text whichever overlay is in the preview (it used to land in the current
  overlay's subtitle), and the import sends all views.
- **Verified** in the preview tool at 1440x900, 1280x860 and 400x900 (no
  horizontal overflow): page switching, strip selection, inspector per
  overlay, push/discard, scoreboard card order, team sheet, delete + Undo,
  file field paste/clear, text size, live monitor toggle, the setup guide's
  steps (OBS connect error path; no OBS on the dev PC), and the remote routes
  with curl (403 for a foreign Origin, overlay switch repopulating an open
  panel, score changes). **Not yet tried:** real OBS through the guide, a real
  Stream Deck, and the OBS dock's CEF (older Chromium: `:has()` only styles the
  guide's choice cards, so nothing breaks without it).

## v1.0.0: league profiles (Option A)

Built from "Option A" in the adaptation doc ("Adapting the Stream App for a
New Esports League"): one codebase, one profile per league, one installer per
profile. The first two profiles are Widener (unchanged on stream) and League
of the East (LotE), from the "League of the East" design system artifact
(colours, logos, games) and the "LotE Background Set" artifact (scene
background 09, Mark Shine).

- **Profiles.** `app/profiles/<id>/profile.json` + `games.json` + `assets/`
  (+ optional `theme.css`, `icon-source.png`, `icons/`). `profile.js` loads
  and checks one (missing assets throw at start-up, so a broken profile can't
  ship), and turns it into `window.BRAND` (`clientBrand`) and CSS variables
  (`brandCss`). Which profile runs: `--profile=<id>`, `STREAM_PROFILE`, or
  `streamProfile` in package.json, which `build/dist.js` writes into each
  installer through `extraMetadata`. Default widener.
- **Served brand.** `/brand.js`, `/brand.css`, `/brand-theme.css` (empty
  for a profile with no theme) and `/brand/*` (the assets folder), all
  `no-store` like `/overlay`. `/games.json` now returns the profile's games.
  The overlay and panel load `/brand.css` after their own styles and keep
  Widener values as fallbacks, so a page that loses the brand files still
  draws.
- **Overlay.** `--widener-blue`/`--widener-gold` became `--brand-primary`/
  `--brand-accent`; the navy panel tints, soft text, inks, ground gradient,
  team defaults and the watermark mask all read `--brand-*` variables. Text
  (brand line, BRB brand, tagline, alt texts, league name in the loading
  text) comes from `BRAND`. `.brand-bg` (four empty layers) is hidden unless
  a theme styles them: LotE's `theme.css` ports Mark Shine there (halo, the
  mark at 7%, the 9 s shine, vignette) as plain CSS at the set's own 1920 x
  1080 pixel positions, and gives the stats screens the purple ground.
- **Transition per profile.** `stinger.type`: `video` (file + measured
  `swapTime`, Widener's curtain at 1.4 s), `css`, or `none`. LotE has no
  stinger video yet ("Motion: not defined yet" in its brand book), so
  `playCssStinger` draws one: two skewed panels (league purple, then the dark
  panel carrying the mark) sweep in with the Web Animations API, the content
  swaps once they cover the screen, they sweep out in reverse. It shares the
  video stinger's queue and 4 s safety and works with OBS hardware
  acceleration off. Measured in the preview tool: covered at ~500 ms, clear
  by ~1.2 s.
- **Control panel.** Page text uses tokens (`{{name}}`, `{{short}}`,
  `{{league}}`, `{{prefix}}`, `{{social}}`, `{{match}}`, `{{importHint}}`)
  that `applyBrandText` fills at start-up, in text and in placeholder /
  data-tip / title / label / aria-label / alt. control.css's colours are
  `--brand-ui-*` variables (buttons, panels, borders, focus, tint, thumbnail
  background). The amber "unpushed changes" colour and the green/red tallies
  stay the same in every league on purpose. The home-team rule for the import
  subtitle is `homeTeam` (Widener: "vs <opponent>"; LotE has none, so
  "<team A> vs <team B>"). A profile with no included music track hides the
  track buttons; a game list with no highlight videos hides the videos card
  and the guide's download step.
- **OBS.** `obs.js` builds its scene list from `obs.prefix` and
  `obs.leagueScene` (`WU: NECC` stays `WU: NECC`; LotE gets `LotE: League
  Graphics`), and the music source is `<prefix>: Music`. The legacy Smash
  rename still applies.
- **Two apps on one PC.** Different `appId` and productName (separate
  install folders and uninstall entries), different package names, ports
  (4310, 4320) and OBS prefixes. Both can run at once. **The data folder comes
  from the package `name`, not productName**: the installed Widener app has
  always used `%APPDATA%widener-stream-overlay-app` (verified on the dev
  PC), because electron-builder does not write productName into the packaged
  package.json. So `build.packageName` (LotE: `lote-stream-control`) is set
  through `extraMetadata.name`, which also names electron-updater's download
  cache (`lote-stream-control-updater`). Widener has no packageName and keeps
  its folder, so upgrading keeps its data. `main.js` points a dev run of a
  profile with a packageName at the same folder (`app.setPath('userData')`). localStorage keys keep their `widener-`
  names: they are per origin, and the port makes each app its own origin.
- **Updates.** One GitHub release per version carries every league's files.
  `build/dist.js` sets `publish.channel` per profile, so electron-builder
  writes `latest.yml` (Widener) or `lote.yml` (LotE), and the embedded
  `app-update.yml` carries the channel; electron-updater's GitHub provider
  reads `options.channel` and fetches that file from the latest release. No
  `autoUpdater.channel` is set in code (setting it turns on allowDowngrade).
- **What was not bundled, and why.** The repo and releases are public. The
  Pink Blue accent font has an education licence held by the league, so it is
  not shipped (the overlay has no accent-word element anyway). School logos
  are not seeded into the LotE team library; they arrive with LeagueOS
  imports. LotE body text uses Inter, the brand book's listed fallback for
  Libre Franklin; Libre Franklin (OFL) could be added to
  `public/overlay-assets/fonts` later.
- **Dev.** `npm run start:lote` / `server:lote`; the `stream-app-lote-dev`
  launch config (port 4321). A non-Widener profile keeps its dev data in
  `app/data/<id>/`.
- **Verified** in the preview tool and with full-size Electron captures:
  Widener overlay and panel unchanged (stripes, gold, lion, W, NECC wording,
  included track, video step), LotE Starting Soon / BRB / Rosters /
  Scoreboard / control panel, the drawn transition's timing and its covering
  frame, no leftover tokens or Widener/NECC text in the LotE panel, every
  brand route for both profiles. Both installers built and their packaged
  servers smoke-tested on spare ports.

## v2.0.0: OBS first (test build, branch test/obs-first)

The user's idea: drop the one-link browser source and the app's own
preview/Push Live, make the OBS connection required, build every scene, and
let OBS (Studio Mode) be the preview and the switcher. The panel becomes a
step-by-step match setup plus a Live page for scores, rosters and scene text.
Their answers to the open questions, which decided the design:

- Edits going straight to air is fine; text goes out on **Enter or blur**,
  never per keystroke.
- A hard OBS dependency is fine (small studio, OBS is dependable, everyone runs
  the latest OBS).
- Rocket League stats get **their own scene**, and the app **cuts to it by
  default after each game** (the cast can go back to it to fill time).
- The app may switch scenes "when needed".
- The app creates the game capture, or explains how when it can't.
- The app handles the stinger, and the first-time setup shows how to add it.
- LotE's member schools (names, short names, colours, the league's logos) are in
  the app by default, for manual setups without a match link.

### Server (`server.js`)

- **One state.** `live`/`draft`, `pushLive`, `revertDraft`, `isDirty`, the
  `dirty` message, `push`/`revert` WS messages and the in-overlay stinger flag
  are gone. `state.json` still holds `{ live, draft }` (both the same object)
  so a downgrade can read it; loading prefers the old `live`.
- **WS roles.** `subscribe` carries `role: 'panel' | 'overlay'` (a v1 page's
  `channel: 'draft'` counts as a panel). `state` messages have no channel.
  Panels also get `library`, `music`, `prefs` and `onair` on subscribe.
  `update` (panels only) ignores `mode`, `neccType` and `neccUrl`: OBS owns
  those.
- **OBS follows, state follows OBS.** `obs.js` reports every program scene
  change (`onProgram`); the server sets `state.mode` to that scene's view (so
  an unlocked `/overlay` still follows), sets `neccType`/`neccUrl` for a
  league graphic scene, starts Post-Match's own countdown (`postEnd` =
  now + `postMatchSec`), updates music, and tells panels `{type:'onair'}`.
  A scene the app didn't build reports `key: ''`.
- **Rocket League Stats scene.** `rlScreen` is `{screen: 'game'|'series',
  game}` (no more `'live'`). `onGameEnded` records the game, sets the screen to
  it, and after 3 s cuts OBS to `stats` **only if the Scoreboard is on air**;
  once the series is won it moves to the overview 15 s later. `onGameStarting`
  cuts back to `scoreboard` mid-series only if the app made the cut
  (`autoStatsUp`, cleared by any manual cut away from Stats). Panel buttons
  send `{type:'rlScreen', screen, game, show}`.
- **League schools.** `profiles/<id>/teams.json` is seeded into the library
  once per school id (`library.seeded`), so a deleted school stays deleted and
  a school added to the file later still arrives. Logos are served from
  `/brand/teams/*`. An imported team whose name starts with a school's name
  (or short name) gets the league's logo instead of the LeagueOS one, and
  `league: true`.
- **Routes.** `/api/obs/build-scenes` builds with `buildOptions()` (league
  graphic scenes from prefs, the Stats scene when any game uses the RL board,
  game capture, Studio Mode) and re-points the stinger if it exists.
  `GET/POST /api/obs/stinger` copies the profile's stinger video out of the
  asar to `<data>/obs/<file>` and configures OBS. `GET /api/obs/program-shot`
  (a 480 px JPEG of program), `POST /api/obs/switch {key}`. Remote:
  `/api/remote/scene/<key>` (`necc-<type>` for league graphics), v1's
  `/overlay/<view>` kept as an alias, `/stats/game|series`, the score routes.
  `/push`, `/discard` and `/api/obs/settings` are gone.
- **Prefs** (`settings.json` `panel`): `neccTypes`, `gameCapture`, `studioMode`,
  `setupDone`, `guideV2` (the v2 guide has run; it opens once for upgrades too,
  since they need the new collection and stinger). v1's `neccOverlayUrls` moves
  into `state.neccUrls` on first start.

### OBS (`obs.js`, rewritten)

- `useCollection()` switches to (or creates) the league's own scene collection,
  `<shortName> Stream`. Creating one leaves OBS's empty `Scene`; the build
  removes it once the app's scenes exist.
- Scenes: the five base views, `Rocket League Stats` (`includeStats`), and one
  per picked league graphic (`<prefix>: <label>`, input
  `<prefix>-src-necc-<type>`, URL `?view=necc&necc=<type>`). Browser sources
  are created with `shutdown: false` so a scene is ready the moment it is cut to.
- `<prefix>-game-capture` (`game_capture`, `capture_mode: any_fullscreen`) goes
  at the bottom of the Scoreboard scene; `'manual'` if the input kind doesn't
  exist (the panel then gives Window Capture steps).
- **Stinger.** obs-websocket can't create transitions, so the operator adds a
  Stinger named `<shortName> Stinger` once. `setupStinger` makes it current and
  sets `path`, `tp_type: 0` (ms), `transition_point`, `track_matte_enabled`,
  `track_matte_layout: 0` (side by side). `path` and `track_matte_enabled` were
  confirmed against a stinger saved by the user's OBS 32; the rest are OBS's
  own defaults/names. **Transitions are stored per scene collection**, which is
  why the guide builds the collection first and says to keep it open.
- `setLayout()` restores the scene list at start-up without touching OBS.

### Overlay (`templates/overlay.html`)

- The in-page stinger (WebGL track-matte player and the drawn CSS one) is
  gone: OBS plays the stinger. LotE's drawn stinger became a real video,
  `profiles/lote/assets/stinger.webm` (VP9 with alpha, 1220 ms, cut at 590 ms),
  rendered by `build/make-stinger.js` in Electron and encoded by ffmpeg.
- New locked view `stats`: the scoreboard view with `.stats-scene`, showing the
  `.rls` screens only. Before game 1 it shows the series overview with the two
  rosters and "Up next". The Scoreboard view never shows stats any more.
- A `necc` page locked to a type shows `state.neccUrls[type]`.
- Post-Match counts down to `state.postEnd`. `?backdrop=1` (or v1's
  `?preview=1`/`?monitor=1`) draws the stand-in behind transparent views.

### Control panel (`public/control/`, rewritten)

- Pages: **Match** (stepper: Game, Teams, Details, Scenes; saved matches at the
  top), **Live** (On air with a program screenshot, Score, Scenes with per-scene
  text and Put on air, Rosters), **Settings** (setup guide, OBS, stinger, music,
  videos, frame and socials, team library, display, remote, shortcuts).
  `?page=` and `?step=` open a page or step.
- The panel shows the server's state; `setVal` skips the focused field, and
  `onCommit` sends on `change` (Enter blurs). Sends merge into the local copy
  at once (`mergeLocal`) so nothing flickers back before the echo. The roster
  editor is one DOM element moved between the Match and Live pages; it keeps a
  working copy per team and re-syncs from the state when that team isn't
  being edited.
- The setup guide: connect, build the scenes (game capture and Studio Mode
  options), add the stinger (steps plus the exact settings), videos.
- Undo/redo, the overlay strip, the monitors and Push Live are gone.

### Verified for v2.0.0-beta.1

Against a mock obs-websocket server (scratch tool, msgpack and JSON): the guide's
connect, build (new collection, empty `Scene` removed, game capture at the
bottom, Studio Mode), stinger setup (file copied, settings applied, transition
selected), on-air following OBS cuts, Post-Match's own countdown, league
graphic scenes. With `dev/mock-rlstats.js --fast`: game end, score 1-0, cut
to Stats 3 s later, back to the Scoreboard when the next game loaded. Panel
text going out only on Enter. Both leagues' panels and the Stats scene
renders. **Not yet verified against a real OBS** (the user's OBS was open and
in use during the build, so it was left alone).

## v2.0.0-beta.2: league design, league scenes, backgrounds

Asked for after the user tried beta.1 ("I love the new gui look and use"):

1. **No game preferred.** The user plays Rocket League and saw it leaking into
   general wording. And "when building the scenes if RL isn't selected as a
   game, rl stats scene needs to be deleted".
2. **LotE's scenes were Widener's with new colours.** Keep the clean feel but
   give the league its own layout. A director's concept art was offered as
   loose inspiration only (the user finds it cluttered): small line above a
   big headline on the left, the mark large on the right, socials bottom left.
3. **League-wide scenes**, "like the League Standings", so a stream can show
   how each school is doing in that game. The data has no source yet ("can be
   pulled from LotE standing page at a later date").
4. **Logos must never be cropped** (Widener's W lost its top corners).
5. Mid-build: three more backgrounds from the LotE Background Set (Word Rows,
   Mark Pattern, Curtains), **a background per scene**, mixed into the defaults.

### Scenes follow the match

- `buildOptions()` (server.js): `includeStats` is now `state.scoreboard.style
  === 'rl'` (it was "the league plays Rocket League"), plus `leagueScenes`
  from the prefs. `syncLayout()` re-runs it after every panel update and prefs
  save, calls `obs.setLayout()` and tells panels `{type:'scenes'}`.
- `obs.js` knows every scene the app could make (`everyScene()`: the stats
  scene, both league scenes, every LeagueOS graphic via `allNeccTypes`). A
  build **removes** the ones not in the layout: `RemoveInput` then
  `RemoveScene`, after moving program off a scene that is about to go. The
  build returns `removed`; `inspect()` returns `stale` (scene names).
- Panel: the Live page's Scenes card shows one line when OBS differs (a scene
  missing, or one of the app's still there but unused) with a build button;
  the build step's checklist says what a build will remove.
- Neutral wording: the game tiles all read "Best of N, by map/game/set"; the
  scoreboard Style select became "Scores come from" (this panel / the game)
  and only shows for a game whose preset has a live style; the setup guide,
  the OBS banner, the music tip and the shortcut list no longer single a game
  out. Picking "Another game" resets `scoreboard.style` to `standard`.

### Logos

Every logo box was `object-fit: cover` or had a `border-radius`, so a logo that
reaches its own image edges (Widener's W, most of the league's tight-cropped
files) lost its corners. Now `contain`, square corners, no plate: overlay
(`.roster-logo`, `.sb-logo`, `.sbc-logo`, the new ones) and panel
(`.brand-logo`, `.ret-sum-logo`, `.tc-logo`, `.slot img`, `.school-tile img`).
The files themselves were checked against the league's originals: tight, but
not cut. LotE's theme adds a thin light `drop-shadow` edge to school logos, so
a dark mark (LVC's navy, Albright's black A) reads on the purple ground.

### League of the East's own look (`profiles/lote/theme.css`, `theme.js`)

- **Fixed stage.** `--fixed-stage:1` makes the overlay scale `#widener-frame`
  and `.brand-bg` as one 1920x1080 stage (like Be Right Back), so the theme is
  written in stream pixels.
- **Layout.** Masthead (mark, league name, game) over a hairline with a short
  purple rule; text column on the left under a spaced-capitals line (the old
  pill); footer hairline with plain social handles. Square, lined panels in
  `rgba(37,8,57,.9)` instead of Widener's pills and slants.
- **Type.** Headlines in **Pink Blue** (the accent face in the LotE design
  system, "for one to three words"), everything else Kanit and Inter.
  `--title-lines:2` makes `fitTitle()` step the headline down until it fits two
  lines. Pink Blue is a licensed font (Rometheme): the file sits in
  `profiles/lote/assets/fonts/`, is **gitignored** (the repo is public) and is
  packed into the LotE installer from the build PC; without it the headlines
  fall back to Kanit. `build/dist.js` warns when it is missing. (beta.5 added
  Zentras as a second headline face, see below.)
- **Matchup row** (`#matchup`, hidden in the base CSS): both schools with logo,
  name and record on Starting Soon; on Post-Match the series score, "Final"
  once decided, the loser dimmed. A subtitle that only repeats "A vs B" is
  dropped beside it.
- **Rosters**: two panels topped with the school's colours (3:1 primary to
  secondary), numbered rows, a page heading in the masthead (`#page-head`).
- **Be Right Back**: masthead, a line above the headline (`#brb-kicker`: game
  and round), headline, a purple rule and the subtitle, and the mark itself
  large on the right (`#brb-art`).
- **Scoreboard**: rounded ends, dark score boxes over the team colour, the
  league's purple in the middle (standard bar and compact box). The Rocket
  League board keeps its own shape.
- **Backgrounds.** `profile.json` `backgrounds: { list, defaults }`; `theme.js`
  (served at `/brand-theme.js`, a new optional `themeScript`) builds one
  `.bg-<id>` layer per background in `.brand-bg`; `body[data-bg]` shows one.
  `state.backgrounds[view]` holds the operator's pick per view (`necc` is
  shared by every league graphic; the Scoreboard has none), merged per key like
  `views`, and not part of a saved match. The Stats scene shows the picked
  background too (`.rls` is transparent in this theme).
- **Entrances.** Animations sit under `body.enter`. The overlay re-applies the
  class when OBS reports the source active on program (`obsSourceActiveChanged`,
  which fires at the start of a transition) and removes it a few seconds later,
  so a row redrawn by a score or standings change appears in place.
  `--enter-delay` is the stinger's cut point less 150 ms. An unlocked page
  replays on a view change instead. This replaced Be Right Back restarting its
  wipe on every state update. **Not seen in a real OBS yet.**

### League scenes and standings

- `profile.json` `leagueScenes: ['standings', 'matchup']` (LotE only). Views
  `standings` and `matchup`, scenes `<prefix>: Standings` and `<prefix>: Head
  to Head`, drawn in `#lg-view` on the fixed stage with base styles any league
  could use.
- Data: `league.json` in the data folder, `{ standings: { <gameId>: { rows,
  note, playoffSpots, lastResult, updatedAt } } }`, a row being `{ teamId,
  name, tag, w, l, gw, gl, streak }` in display order. `GET /api/league`, `PUT
  /api/league/standings/<game>`; sent to every page as `{type:'league'}` with
  each row hydrated from the team library (name, short name, colours, logo).
  A future import from the league's standings page should write through the
  same PUT.
- Panel: a **League** page (only with `leagueScenes`): game, note, playoff
  spots, the table (rows edit in place and save on change; arrows reorder;
  Sort by record), Add every league school, and **Add this result to the
  standings** from the match on the Live page (win/loss, games for and
  against, streak; asks before adding the same result twice; Undo).
- Overlay: Standings is one column to ten rows and two beyond, the row height
  set from the count, the match's two schools highlighted, an optional playoff
  line. Head to Head compares place, record, games, difference and streak and
  dims the worse side. `recordText()` puts "4-1 · 2nd" on the matchup row and
  Rosters. A team is matched to a row by name the way imports are matched to
  schools (`sameSchool`, duplicated in the panel).

### Verified for v2.0.0-beta.2

Against the mock OBS: a Rocket League match builds the Stats scene; switching
the game to Valorant marks it stale in the panel; a build removes the scene and
its source, also when it is on program (program moves to Starting Soon first).
Renders of every LotE scene at 1920x1080, each background, standings at 6, 8,
12 and 16 rows, the video panel on. The League page: edit, sort, add result,
undo. Widener's scenes unchanged apart from the logo fit. Still **not run
against a real OBS**.

## v2.0.0-beta.3: scenes pick up an app update

The user, after installing beta.2 over beta.1: "when i update the app, and
build new scenes the sources are stuck in their old look unless i refresh the
browser source". Cause: the scene sources are created with `shutdown: false`,
so OBS keeps each page loaded while the app is replaced underneath it; the
page reconnects to the new server but is still the old HTML, CSS and script.
Two fixes, either enough on its own:

- **A build reloads them.** For a source that already existed, `obs.js` presses
  the browser source's "Refresh cache of current page" button
  (`PressInputPropertiesButton`, `propertyName: 'refreshnocache'`). The build
  returns `reloaded` (a count) and the panel says so. This is also what moves a
  page from beta.1 or beta.2, which has no self-reload, onto the new version.
- **A page reloads itself.** `server.js` hashes what it serves into
  `PAGE_STAMPS` (`overlay`: the template, the theme's CSS and script, the
  profile; `panel`: the three control files, the profile; both with the
  version). `/brand.js` hands a page its stamp as `window.APP_STAMP` as it
  loads, and every (re)connect gets `{type:'hello', stamp}` first. A different
  stamp reloads the page, at most once per stamp (`sessionStorage`
  `reloaded-for`), so a mismatch can't loop. The control panel does the same,
  for a dock left open in OBS.

Marvel Rivals is best of 5 (both profiles' `games.json`).

Verified: against the mock OBS a second build reports 9 reloaded and each
source's button was pressed once; in the browser an open scene reloaded itself
when the server came back with a different stamp. **`refreshnocache` has not
been pressed on a real OBS yet.**

## v2.0.0-beta.4: scenes in stream order

The user: "modify the scene build order from top to bottom to be more in line
with the use of the scenes throughout the stream, ie starting soon at the top,
and ending at the bottom".

- `sceneEntries()` (obs.js) now returns the scenes in stream order, which is
  the order they are created in, the order of the panel's scene list and the
  Stream Deck list: Starting Soon, Rosters, Head to Head, Standings, the league
  graphics (Match Preview, Match Rosters, Bracket, Season Header, Match
  Progress, Match Activity; `NECC_TYPES` in server.js and control.js is in
  that order), Scoreboard, Rocket League Stats, Be Right Back, Post-Match.
- **obs-websocket cannot reorder scenes.** A new scene lands at the bottom of
  the list and there is no request to move one. `GetSceneList` answers bottom
  scene first with `sceneIndex` 0 at the bottom, so `sceneOrder()` sorts by
  it, descending, for the list as OBS shows it.
- So `buildScenes()` works out how many scenes from the top of the wanted
  order are already in place (existing, and in rising positions), and makes
  everything after that in order: a missing scene is created, one that exists
  is moved by `moveSceneToBottom()`. A new collection needs no moves; adding
  the stats scene for a Rocket League match moves only Be Right Back and
  Post-Match.
- `moveSceneToBottom(name)`: create `<name> (moving)`, `DuplicateSceneItem`
  every item bottom first (same sources, so nothing is recreated; transform,
  crop and visibility come with it; lock and blend mode are set after), copy
  the scene's filters and transition override, move program and preview
  across if they were on it, `RemoveScene` the old one, `SetSceneName` the new
  one back. A leftover `(moving)` scene from a cut-short move is renamed or
  removed at the start of the next build. Lost: a hotkey bound to the scene
  in OBS (no API for it).
- It doesn't move anything (`ordering` in the build result says why) while OBS
  is streaming or recording (`live`), when a scene to move holds a group or is
  used as a source in another scene (`custom`), or with the `orderScenes`
  preference off (`off`, Settings, OBS).
- obs.js follows `SceneNameChanged`, so the scene on program is still known
  after it is renamed.

Verified against the mock OBS (which now answers `GetSceneList` the way the
real one does): a new collection in order; an old-order collection with the
operator's own scene in the middle put right, the Scoreboard's locked, cropped
game capture, scene filter and transition override intact, program and preview
unchanged; a second build moving nothing; the stats scene landing after the
Scoreboard; and the three reasons for leaving the order alone. **Not run on a
real OBS**: `DuplicateSceneItem` across scenes and removing a scene that was
just on program are the calls to watch.

## v2.0.0-beta.5: two headline typefaces

The user, with `zentras-font.zip`: "For the 'alt' font like the artist one for
big text, I want the option for 2 different ones. Can you also add this font
to the LotE design artifact."

- **Profile.** `headlineFonts: { list: [{ id, name, family, file }], default }`
  in `profile.json` (LotE: `pink-blue`, `zentras`). `profile.js` keeps only
  the ones whose file is in `assets/` (`missing` names the rest, and
  `build/dist.js` warns about each), `brandCss()` writes an `@font-face` per
  typeface into `/brand.css` (so the panel has them too), and `clientBrand()`
  passes `{ list: [{ id, name, family }], default }`.
- **State.** `headlineFont` (an id, `''` for the profile's default). One
  choice for the whole stream, not per scene: I judged that mixing a brush
  face and a blackletter between scenes would look unplanned. The user did not
  say which they meant.
- **Overlay.** `setHeadlineFont()` sets `body[data-headfont]`, loads the face
  and refits the two fitted headlines; both faces are fetched at page load so
  a switch shows at once. `fitTitle()` now measures `offsetHeight`:
  `scrollHeight` counted the blackletter's descent below the last line, so two
  lines read as three and the title was shrunk to one.
- **Theme.** `theme.css` sets every headline with `var(--font-accent)` and
  three variables a typeface can change: `--accent-case` (Pink Blue
  `uppercase`, Zentras `none`: blackletter capitals in a row don't read),
  `--accent-scale` (Zentras 1.24: it is narrow) and `--accent-space`. To add a
  third typeface: the file, a `headlineFonts` entry, and one
  `body[data-headfont="<id>"]` rule.
- **Panel.** Live page, under the scene list: **Headline typeface**, one
  button per face with its name set in that face (`buildHeadFontPicker()`).
  Hidden with fewer than two.
- **Licence.** `Zentras.ttf` is the free download from fontspace: its notes
  say "Demo just for personal use, not permitted for commercial use" (Alit
  Design, full version at alitdesign.net). It is gitignored like Pink Blue and
  packed into the LotE installer from the build PC. The user was told a league
  broadcast needs the full licence.
- The LotE design system artifact got the same typeface: `fonts/Zentras.ttf`,
  an `accent-2` family and `accent2-lg` / `accent2-md` styles in
  `tokens.json`, and the README's type section.

## v2.0.0-beta.6: Widener scene backgrounds

The user: "Create an artifact similar to the LotE background options but for
Widener. Then show it to me and I'll pick a few to give background options in
the Widener app just like the LotE app." They picked 01 Varsity Stripes, 02
Shutters, 12 W Shine, 14 Pride Lions and 27 Pride Tape.

- **The set.** "Widener Background Set"
  (https://claude.ai/artifact/X2XLXoJFFZqe14x5AZhx4n): a gallery page plus one
  standalone 1920 x 1080 page per loop under `bg/`, 27 loops and the app's
  current stripes for comparison, in blue and gold only. Each tile carries a
  measured text-contrast figure (scene text against the brightest 0.5% of the
  picture, worst case over a minute); all are 7 to 1 or better. Its builder
  lived in the session scratchpad and is not in the repo; the artifact's own
  files are the source.
- **Profile.** `profiles/widener/profile.json` gained `backgrounds` (six: the
  five picks and `stripes`, "Moving Stripes", the page's own), `theme` and
  `themeScript`. Defaults are mine, chosen from renders of every scene on
  every background: Starting Soon `varsity-stripes`, Rosters `shutters`, Be
  Right Back `w-shine` (the W sits in that scene's free right half), Post-Match
  `pride-tape`, league graphics `pride-lions`, Rocket League Stats `stripes`.
  Widener was all `stripes` before, so its default look changed; the user was
  told.
- **`profiles/widener/theme.css` and `theme.js`** (new) hold backgrounds only.
  The base overlay styles are still the Widener look. The layers are built in
  `.brand-bg` on a 1920 x 1080 stage scaled to cover (`--bg-fit`, set by
  theme.js, because Widener's page is not a fixed stage). Each layer starts
  with its own copy of the ground: `.brand-bg` is a stacking context, so
  without it the `screen` and `overlay` lights would blend against nothing
  and look different from the set. `--bg-w` and `--bg-lions` point at the
  profile's logo and mascot; the art is shown as it is, at low opacity, never
  recoloured, and the whole W is inside the frame.
- `stripes` shows the base page's `.stripes` and `.bg-gradient`; any other
  choice hides them. theme.js sets `body[data-bg]` to the scene's default at
  load, so a scene never shows the stripes for a moment before its state
  arrives.
- **Rocket League Stats** takes a background too (base CSS hid `.brand-bg`
  there): the theme draws the stats screens over it at half strength and
  drops `.rls`'s own ground. With `stripes` it looks close to what it did.
- **A jump fixed in the base page.** `.stripes` ran `drift 40s linear
  infinite` over a distance that was not a whole repeat of its 96px pattern,
  so it snapped back every 40 s; the sheen did the same every 9 s. Now one
  loop moves exactly one repeat (21.96px, 103.29px at scale 1.1, in 52 s, the
  same pace), and the sheen starts and ends off the page (18 s). Measured in
  the dev app: the frame before the restart and the frame after differ by no
  more than two frames 40 ms apart mid-loop.
- No panel or server change was needed: the Background select per scene, the
  `backgrounds` state and the page stamps were all built for LotE in beta.2.

Not checked on a real OBS. The canvas-drawn loops in the set were not picked,
so every background in the app is CSS only.

## v2.0.0-rc.1: standings from the league site, copy pass, release prep

The user, on the day of LotE's first match (Widener vs Messiah, Rocket League,
2026-10-05 8 PM, `https://lote.v1.leagueos.gg/league/matches/ak16dfawcqj8qxbxvdca0spaf`):
"Start prepping for the full release, clean up the instruction language to
sound less like AI giving casual instructions, it should be direct and
technical. There is also too much 'feature confirmation' where it feels like
you are trying to describe a feature in the way I told you to put it in just
to match what I wanted, fix it. Default font should be Zentras. [...]
Standings should not be manually editable. All details will come from the
league website [...] Each game has its own standings; the app needs to be
able to pull them from the site when the game is selected."

### Standings from LeagueOS

- The league site is an SPA; its season results page
  (`/league/seasons/<id>/results`) calls `api.leagueos.gg` with the same
  `x-leagueos-*` headers the match import already used. Found by reading the
  site's script chunks (`SeasonResults`, `league.season.rosters`):
  - `GET /league/seasons?ipp=&page=` (needs `x-leagueos-lid`): the league's
    seasons, one per game: `{ id, name, stdAct, dateStart, dateEnd }`.
  - `GET /league/seasons/<id>`: `scoringProps` (the sort order: `path`,
    `sortDesc`) and `displayProps`.
  - `GET /league/seasons/<id>/rosters?ipp=&page=` (`ipp` is required): teams
    with `state`, `name`, `clanTag`, colours, `parent` and `stats` (wins,
    losses, gameWins, gameLosses, totalScore, totalScoreAgainst, ...).
  The page lists `state === 'confirmed'` teams sorted by the scoring props.
  Win %, game win % and score delta are derived on the client, not stored.
- `necc.js`: `listSeasons`, `pickSeason` (running now, else next to start,
  else latest), `seasonStandings` (sorted rows with a rank shared on ties,
  `played`, `scored`). `importMatch` now also returns `hostname`, `leagueId`,
  `seasonId`, `activity`.
- Profile: `league.site` and `league.id` in `profile.json`; `leagueActivity`
  (LeagueOS `stdAct` values) and `scoreName` per game in `games.json`. LotE's
  activity ids seen on the site: `rl`, `valorant`, `overwatch`, `ssbu`. No
  Marvel Rivals season existed on 2026-10-05, so its ids are guesses and the
  season-name fallback covers it.
- `server.js`: `refreshStandings(gameId, force)` replaces the hand-typed
  store. Called at start, on a game change (the panel's update handler), after
  an import from the league's own host (which also pins that match's season
  for the game in `league.seasons`), every 5 minutes for the current game,
  and by `POST /api/league/refresh`. Results go to `league.json` (`v: 2`; the
  beta tables are dropped) and to every page as `{type:'league'}`. A failed
  read keeps the last rows and records `error`. `PUT
  /api/league/standings/:game` is gone.
- Overlay: columns are record, games, difference, plus the score difference
  when `scored`. Streak, the playoff line and the note line are gone (the site
  has none of them). No rank is drawn until `played`. Team-to-row matching is
  by name prefix, then by short name only when one row has it: Messiah and
  Marywood are both `MU`.
- Panel: the League page is a read-only table with the season name, the read
  time or error, Refresh and Put Standings on air.
- At the time of writing every LotE record was 0-0 (the season started that
  night), so the ordering and tie code was checked against the live data only
  in its all-level case.

### Copy

Every string in `index.html`, `control.js`, `main.js` and the overlay's
operator-visible lines was rewritten: noun headings, one factual sentence per
tooltip, status lines as `subject: state`, no second-person narration, no
reassurance, and no toast that only restates what a control just did (the
font, team-slot and scene-toggle confirmations are gone). The README was
rewritten as a reference in the same register. Button names that changed:
"Build scenes", "Configure stinger", "Run setup", "Restart countdown", "Game
stats", "Series overview", "Back to Scoreboard".

A standing instruction from the user for future work: UI and documentation
text is direct and technical, and never describes a feature in terms of the
request that produced it.

### Other

- LotE's default headline font is Zentras (`headlineFonts.default`).
- Version `2.0.0-rc.1`. Nothing was committed, pushed or published.

## v2.0.0-rc.2: stats stay up until the next kickoff

The user: "How long does the stats screen stay up for RL after a game? It
should stay open until the next game is about to start."

- It never had a time limit, but it came down when the next match *loaded*:
  `onGameStarting()` ran on rlstats' `matchStart` (MatchCreated,
  MatchInitialized, or the first UpdateState after none, which also fires
  after the client's 4 s "no packets" timeout). A lobby that loads and then
  waits would have lost the stats early.
- The official docs (rocketleague.com/developer/stats-api, read 2026-10-05)
  give the events: `MatchCreated` "when all teams are created and
  replicated", `MatchInitialized` "when the first countdown starts",
  `CountdownBegin` "at the start of each round when the countdown starts",
  `RoundStarted` "after the countdown finishes", `MatchDestroyed` "when
  leaving the game". `Game.Ball.TeamNum` is 255 until the ball is touched.
- `rlstats.js` now emits `{ type: 'gameStarting', why }` once per game:
  `countdown` (MatchInitialized, CountdownBegin), else `round`
  (RoundStarted), else inferred `clock` (a clock below its highest value
  this game, or overtime) or `play` (a state with no winner and a touched
  ball). The latch resets on MatchEnded and MatchCreated. Inferred signals
  are ignored for 10 s after a game ends (`INFER_AFTER_END_MS`) and until a
  state without a winner has been seen, so the finished game's late packets
  can't cancel the pending cut to the stats.
- `server.js` calls `onGameStarting()` on `gameStarting` only. `matchStart`
  is still sent to the pages but no longer cuts.
- `dev/mock-rlstats.js` follows the documented order: MatchCreated, a wait,
  MatchInitialized + CountdownBegin, RoundStarted, play; the ball is 255
  until play.
- Tested end to end with a fake feed, the mock OBS and the server in process
  (dev code and the packaged LotE rc.2): stats at +3 s, kept through the
  podium, a silent lobby and the next match loading, back at the first
  countdown, back on the clock alone when every start event is missed, a
  stray post-game packet not cancelling the cut, and the decided series
  staying up. **Not run against the real game.**

## v2.0.0: release

The user, 2026-10-05: "Push the update for everything." Released from
`master`, fast-forwarded to `test/obs-first`, tag `v2.0.0`. The code is
rc.2's; only the version changed.

- The first public release since v0.11.0. v0.12.0-beta.1, v1.0.0 and every
  v2 beta and rc were local installers, and the v1.0.0 and v2 commits had
  never been pushed.
- One GitHub release holds both profiles' files: the Widener installer,
  its `.blockmap` and `latest.yml`; the LotE installer, its `.blockmap` and
  `lote.yml`. Installed Widener copies (0.9.0 and newer) update to it and
  then need **Run setup** once: v2 replaced the single browser source with
  a scene collection the app builds.
- **Fonts.** The released LotE installer carries Pink Blue and Zentras. The
  user's decision: "The fonts need to be with the app, the fonts are already
  available online for download, they just have licenses for stopping
  commercial use so you have to contact and pay the creator. Include the
  fonts." The files stay gitignored and reach the installer from the build
  PC. Do not strip them from a release build.
- Packaged checks before the release: the smoke tests on both builds and the
  Rocket League stats auto-cut test on the LotE build. **Still not run
  against a real OBS or the real game.**

## v2.1.0: game HUD off for a spectator, board at the top edge, name fitting

The user, 2026-10-06: review the latest Stats API functions and have the
game's HUD turn off by itself in spectator mode while the scoreboard is
running; the scoreboard should touch the top of the screen; and a full bug
test of team-name overflow on the scoreboards ("sometimes the ... comes out
in weird spots, like when gold is after widener university"). Released the
next day as v2.1.0 (the user: "Push this as a minor update, make sure the
auto updater grabs it too"); see Release at the end of this section.

### Stats API (docs re-read 2026-10-06, game v2.72 from August 2026)

- v2.72 made the feed two-way. **Commands** go to the game on the same
  socket, `{ "Command": name, "Data": { ... } }`: `SetHUDVisibility
  {bVisible}`, `ChangePOV {Focus, Perspective}` (spectator and replay),
  `SetMatchPaused {bPaused}`, and for saved replays `LoadReplay`,
  `SeekReplay`, `SetGameSpeed`. It also added a real WebSocket on `WebPort`
  (49124); the app stays on the TCP `Port`.
- Events and fields the app does not use: `BallHit`, `BoostPickup`,
  `CrossbarHit`, `StatfeedEvent`, `PlayerJoined`/`PlayerLeft`,
  `GoalReplayWillEnd`, `PodiumStart`, `ReplayCreated`; per player `Loadout`,
  `PickupClass`, `Attacker`, `PrimaryId`; `Game.PlaylistId`, `Frame`,
  `Elapsed`.
- The docs give no wire detail for commands. Two public clients send them the
  way `rlstats.js` now does: `Data` as an object (events arrive with `Data` as
  a string), one object per write. RLGymStream (Rolv-Arild, a live Rocket
  League broadcast) ends each with a newline and re-sends the HUD command on
  connect, `MatchCreated` and `CountdownBegin`; DevJMD's TypeScript client
  sends no newline. The app sends the newline.
- **Speeds may already be km/h.** RLGymStream treats `Speed` and `GoalSpeed`
  as km/h with no conversion, and the docs' own `GoalScored` example has
  `GoalSpeed: 87.3`. That would explain the goal banner's speed being
  "always wrong" in v0.11.0 (`UU_TO_KPH` multiplies it by 0.036). Not
  changed: the banner still leaves the speed off, and it needs one real game
  to confirm before `kph` is trusted.

### Game HUD (`rlstats.js`, `server.js`, `main.js`)

- `scoreboard.rlHideHud` (default on; "Hide game HUD while spectating" in
  Scoreboard settings). `updateRlActive()` calls `rl.setHideHud(style === 'rl'
  && rlHideHud !== false)`. Not tied to the Scoreboard scene being on air:
  OBS's preview shows the scene too, and `state.mode` goes stale without OBS.
- **Spectating** is read from the feed: the docs mark boost, speed and car
  state SPECTATOR ("only sent while spectating"), so any player carrying one
  means this client is spectating. It is sticky: it outlives a match (the HUD
  stays off between the games of a series) and only drops after 3 s of live
  states without those fields (`SPECTATOR_LOST_MS`), so replays or a few odd
  states never flash the HUD back. A playing client never gets a command.
- `syncHud()` sends hide when wanted and spectating, and show as soon as
  either stops. The hide is repeated on `MatchCreated`, `MatchInitialized` and
  `CountdownBegin`: nothing says the game keeps the setting across matches.
  `hudHidden` (what the game was last told) and `spectating` ride on every
  snapshot; the panel's status line shows `Game HUD: hidden.`
- **Giving it back.** `setActive(false)` writes the show command with
  `socket.end()` and destroys the socket 500 ms later, so the game reads it
  before any reset. `close()` returns whether that happened;
  `server.releaseGame()` exposes it and `main.js` holds `before-quit` for
  300 ms when it returns true (the app never used to close the server on
  quit). A socket that is closing ignores further data.
- `dev/mock-rlstats.js` prints commands, tracks the HUD, and `--player` sends
  a playing client's feed.
- Tested with a fake game (scratch script, 52 checks): hide on the first
  spectator state, exact bytes on the wire, no repeat on plain states, the
  repeats, setting off and on, match end and next match, replay and short
  gaps, playing for 3 s, reconnect, deactivate and quit paths, and the same
  through a real server and panel WebSocket. Then the real panel checkbox
  against the mock. **Not run against the real game**: whether v2.72 accepts
  the command exactly as sent is taken from the docs and the two clients above.

### Board at the top edge (`overlay.html`, LotE `theme.css`)

`.sb` (top bar) `top:22px` to 0; the Rocket League board `.rlb` and its player
rows `.rl-team` `top:18px` to 0; the goal banner follows (186 to 168). LotE's
bar keeps only its lower corners rounded. The corner boxes keep their inset.

### Team names (`overlay.html`)

Found with a scripted matrix in the preview (about 2,600 names over both
standard boards, tags, logos, stocks, swap: 97,000 checks; 200 names over the
stats screens):

- `fitTeamName()` only dropped a **trailing** "University", so "Widener
  University Gold" went straight to the stylesheet's ellipsis, which cuts
  wherever the box ends: "WIDENER UNIVERSITY G...". The user's report.
- Its `scrollWidth > clientWidth + 1` let a name one pixel too wide through to
  that ellipsis ("FAIRLEIGH DICKINSO..." beside a logo, 344 px in 342).
- Corner box with stocks: the stocks label lived inside the name's span, so a
  long name's ellipsis swallowed the count.
- Stats screens: `renderRlScreens()` drew a screen and then showed it. A
  hidden screen has no sizes, so a screen switched by the server (game stats
  to series overview, one `rlSeries` message) showed both names unfitted.
  Now shown first, then drawn.
- Stats header: the two names could end up in different sizes (32 px beside
  42 px).
- Rocket League board: the tag under a logo was clipped at both ends past
  about nine letters (LotE's "Misericordia", "Mount Aloysius"); with no logo
  it spilled out of its 112 px box from about seven letters ("WIDENER"), and
  a two-word tag wrapped and made the board taller.
- A corner box left over from the game before stayed on top of the Rocket
  League board: `renderScoreboard()` returned for the `rl` style before
  clearing `.compact`. Only on a page that lived through the game change.
- Fonts: `document.fonts.ready` settles once. A weight first used later (the
  scoreboard's on a page that was showing another view) never re-fitted.
  `loadingdone` now re-fits too (`refitText()`).

The fix is one ladder for every team name, `fitTeamName(el, name, {min,
tag})`, first fit wins: the name as entered; `shortTeamName()` (drops
"University"/"Univ."/"College" where the rest still names the team,
"University of X" becomes "X", "York College of Pennsylvania" has no shorter
form); that in smaller type down to `min` (bar 32 to 24 px, corner box 24 to
18, stats header 50 to 32); the team's tag (the bar then hides its tag
label); whole words plus an ellipsis, never ending on "of"/"the"/"and". The
stylesheet's ellipsis is switched off (`text-overflow: clip`) until the last
case, one word wider than the box. `matchNameSizes()` gives both teams the
smaller size. `fitTag()` sizes the Rocket League tags (`shrinkToFit`, then
the initials). The matchup row and standings use the same ladder without
`min`. `tooWide()` compares whole pixels with no tolerance: 646 fitting
names never read high.

### Release (2026-10-07)

- Version 2.1.0: a setting was added, so the minor number moved (it was
  2.0.1 for a day, never built). Committed on `update/v2.1.0`, fast-forwarded
  into `master`, tag `v2.1.0`.
- `npm run dist` builds both installers. Each `.yml` was checked against its
  installer (sha512, size) and each `app-update.yml` for its channel
  (`latest`, `lote`).
- **Packaged smoke test** (scratch script, not in the repo): the server is
  run out of `app.asar` by the build's own exe with `ELECTRON_RUN_AS_NODE=1`,
  on a spare port with a temp data folder. It checks the packaged version and
  profile, that `dev/` and the other league's profile are not shipped, LotE's
  two fonts, the overlay, panel and brand routes, and the HUD command from a
  panel WebSocket through to a fake game, including the quit path. Widener 23
  checks, LotE 27.
- **Publishing order.** The tag is pushed, the release is created as a
  **draft** with all six files, and only then published. The updater reads
  the newest published release, so a release that is public while its files
  are still uploading can hand an installed app an update file with no
  installer behind it.
- **Checking the updater without installing anything.** A throwaway Electron
  app whose `package.json` says 2.0.0 runs electron-updater with
  `forceDevUpdateConfig`, `autoDownload = false` and an update config for the
  channel (`latest`, then `lote`), and prints what `checkForUpdates()` finds.
  That is the installed app's own code path: GitHub's release feed, the
  channel's `.yml`, the version comparison.

## State shape (server.js `DEFAULT_STATE`)

```js
{
  mode, game, team, title, status, subtitle, next,
  countdownMode: 'duration'|'at', durationSec, end,   // end is the absolute ISO timestamp; in 'duration'
                                                        // mode it only changes on a deliberate restart (v0.9.0)
  postMatchSec, postEnd,                                // Post-Match's own countdown (v2.0.0), set as it goes on air
  layout: 'left'|'right', clip, logo, montage: bool,
  neccUrl, neccType,                                    // the league graphic on air (follows OBS, v2.0.0)
  neccUrls: { [type]: url },                            // every league graphic from the last import (v2.0.0)
  backgrounds: { [view]: id },                          // the background picked per scene (v2.0.0, a league theme's)
  headlineFont: '',                                     // the headline typeface for every scene (v2.0.0); '' = the profile's default
  views: {                                              // per-overlay text (v0.7.2); everything else is global
    'starting-soon'|'post-match'|'roster'|'brb'|'necc'|'scoreboard'|'standings'|'matchup': { title, subtitle, status },
  },
  socials: { twitch, twitter, instagram, youtube },     // default to "wideneresports" for all four
  teamA, teamB: { name, tag, color, colorAlt, logoUrl, players: [{name, gamertag}] },
  scoreboard: { round, unit, bestOf, position,                  // v0.9.0 (was `smash` in v0.8.0);
                scoreA, scoreB, lostA, lostB, swap,            // counters change via {type:'score'}
                crewSize, stocksEach, showStocks,
                style: 'standard'|'rl',                        // v0.11.0
                rlAutoSeries, rlPlayers, rlBoost, rlGameColors, rlAutoStats,
                rlHideHud },                                   // v2.1.0
}
```
Since v2.0.0 there is one state; `state.json` stores it as both `live` and
`draft` so an older version can still read it. `normalizeLoaded()` merges any loaded file
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
  - see that section above. Since **v2.0.0** OBS is required: the app builds
  the scenes and OBS switches them.
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
