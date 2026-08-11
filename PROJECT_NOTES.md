# Widener Esports Stream Control App — Project Notes

Handoff doc for picking this up in a future session. Written at **v0.4.2**,
updated through **v0.7.0**. If you're starting a new chat, read this whole
file before touching code.

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

Stream/                        - ORIGINAL per-game overlay files, now superseded. Left in place, unused.
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

## Architecture — the big ideas

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

3. **`overlay.html` has three-ish visual states, controlled by `state.mode`:**
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

## OBS dock + scene-sync (v0.7.0) — optional, additive

Two opt-in OBS integrations, layered on top of the single-URL push model
without changing it. If the operator never touches them, the app behaves
exactly as v0.6.x did.

1. **Control panel as an OBS browser dock.** Pure documentation + a helper: the
   "Run this panel inside OBS" panel surfaces a copyable dock URL
   (`http://localhost:4310/control`); the user adds it via OBS **Docks → Custom
   Browser Docks…**. No code path is OBS-specific — it's the same web panel. The
   panel already stacks below 980px, and was checked to have zero horizontal
   overflow down to 380px wide (typical dock column).

2. **Per-type overlay URL (`?view=`).** `overlay.html` reads `?view=` on load
   (`starting-soon|post-match|roster|necc`). When present it **pins `mode`** to
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
     `WU: NECC`, sources `WU-src-*`), each pointing at
     `…/overlay?view=<view>`. It reuses existing scenes/inputs by name
     (`GetSceneList`/`GetInputList`) and only corrects URL/size — re-running
     never duplicates. One NECC scene covers all NECC types (the locked page
     reads the pushed `neccUrl`).
   - **Switch-on-push**: `server.js`'s `push` handler calls `obs.onPush(live)`
     after `pushLive()`. If connected AND scene-sync is on, it optionally sets
     the configured transition (`SetCurrentSceneTransition`) then
     `SetCurrentProgramScene` for `live.mode`. We chose switch-on-**push** (not
     on select) to preserve the preview-then-push model — the open question in
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

   **`obs.js` is a new top-level `app/*.js` — it IS in `build.files`.**
   `obs-websocket-js` is a production dependency, so electron-builder bundles it
   from `node_modules` automatically.

   **Not yet verified against a real OBS.** The fail-soft paths (disconnected
   connect/inspect/build, push while disconnected) were verified on the dev
   server; the actual `CreateScene`/`CreateInput`/`SetCurrentProgramScene`
   behavior and transition timing need a live OBS 28+ with the WebSocket server
   enabled. That's the one remaining smoke test.

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

## State shape (server.js `DEFAULT_STATE`)

```js
{
  mode, game, team, title, status, subtitle, next,
  countdownMode: 'duration'|'at', durationSec, end,   // end is always the computed absolute ISO timestamp
  layout: 'left'|'right', clip, logo, montage: bool,
  neccUrl, neccType,                                    // only meaningful when mode === 'necc';
                                                        // neccType is the dropdown key (e.g. 'stageBracket')
  socials: { twitch, twitter, instagram, youtube },     // default to "wideneresports" for all four
  teamA, teamB: { name, tag, color, colorAlt, logoUrl, players: [{name, gamertag}] },
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
- Package: `npm run dist` in `app/` (runs `electron-builder --win`) →
  `app/dist/Widener Esports Stream Control Setup {version}.exe`.
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
  preview tool per session. There is no CI.
- The LeagueOS integration is inherently fragile (unofficial API) - if a
  future session finds `importMatch()` failing, check whether LeagueOS
  changed their header-signing scheme or endpoint shapes before assuming
  the code is broken.
- `Stream/` and `archive/` at the project root are leftover from before this
  app existed - safe to ignore, not part of the shipped app.
