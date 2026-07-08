# Widener Esports Stream Control App — Project Notes

Handoff doc for picking this up in a future session. Written at **v0.4.2**.
If you're starting a new chat, read this whole file before touching code.

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
  server.js                  - Express + ws server: state model, WS protocol, NECC import route
  necc.js                    - LeagueOS API client (match/roster import, overlay URL construction)
  templates/
    overlay.html              - THE overlay - single file, all games, all modes (see below)
    games.json                - the 8 games' {id, name} used by the Game dropdown
  public/control/
    index.html / control.css / control.js   - the control panel UI
    assets/logo.png            - app logo (also embedded as the .ico)
  build/
    make-icon.js               - regenerates icon.ico + PNGs from the source logo (run manually if logo changes)
    icons/                     - generated icon files (icon.ico used by electron-builder + main.js window icon)
  data/                        - dev-only state.json (gitignored-in-spirit; real app uses Electron userData)
  dist/                        - electron-builder output (the installer .exe) - NOT committed, rebuilt each time
  package.json                 - version number lives here; bump on every shippable change

Stream/                        - ORIGINAL per-game overlay files, now superseded. Left in place, unused.
archive/                       - the 16 old per-game HTML files, moved here in Phase 4 (reference only)
widener-stream-control-app-icon.png   - source logo file the user dropped in (used by build/make-icon.js)
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

   Exception: the **Overlay dropdown** (mode/NECC switching) bypasses the
   draft-then-push flow entirely via a dedicated `set-mode` WS message that
   updates a small surgical set of fields (`mode`, plus `title`/`status`/
   `durationSec` for Widener modes or `neccUrl` for NECC modes) on **both**
   channels immediately - it's a scene switch, not a content edit, so it
   doesn't wait for Push Live and doesn't drag along whatever text edits
   happen to be mid-draft.

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
     Everything else (topbar, frame, stripes) is hidden. Confirmed LeagueOS's
     overlay pages send no `X-Frame-Options`/CSP restricting embedding, so
     this works.

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
scheduledAt, teams: [...], overlayUrls: {...} }`. Control panel's roster
picker pre-checks players with `position >= 0` (starters), lets the operator
toggle who's actually playing, and only selected players get sent in the
`teamA`/`teamB` state payload.

## Two real bugs found during this build (both fixed, worth knowing about)

1. **`set-mode` server handler only ever applied `mode`, silently dropping
   the rest of `data`.** This meant the "auto-fill title/status when
   switching Starting Soon ↔ Post-Match" behavior (and later `neccUrl`) was
   broken from the moment `set-mode` was introduced, despite the client
   sending the right payload. Server now does
   `{ mode, ...data }` merge. If you add new fields to what `set-mode` should
   carry, they need to actually be in the `data` object sent from
   `control.js`'s `overlaySelect` handler - the server just merges whatever
   arrives.

2. **Packaging omission**: `necc.js` was added as a new top-level file but
   not added to `package.json`'s `build.files` whitelist, so it worked
   perfectly in dev (`node server.js` reads files off disk) but crashed the
   packaged app on launch (`Cannot find module './necc'`). **Any new
   top-level `app/*.js` file must be added to `build.files` in
   `app/package.json`.** Currently whitelisted: `main.js`, `server.js`,
   `necc.js`, `package.json`, `templates/**/*`, `public/**/*`,
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
  neccUrl,                                              // only meaningful when mode === 'necc'
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

- OBS WebSocket integration was built once (for a NECC/Widener source
  toggle) and then **fully removed** in favor of the iframe approach - if
  you see references to obs-websocket anywhere, that's stale; the app has no
  OBS connection dependency at all as of v0.4.1+.
- No automated tests - everything has been verified manually via the
  preview tool per session. There is no CI.
- The LeagueOS integration is inherently fragile (unofficial API) - if a
  future session finds `importMatch()` failing, check whether LeagueOS
  changed their header-signing scheme or endpoint shapes before assuming
  the code is broken.
- `Stream/` and `archive/` at the project root are leftover from before this
  app existed - safe to ignore, not part of the shipped app.
