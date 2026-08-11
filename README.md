<div align="center">

<img src="app/public/control/assets/logo.png" alt="Widener Esports" width="96">

# Widener Esports Stream Control

**One overlay. One URL. Nothing goes live until you say so.**

A desktop control room for Widener Esports' stream overlays. It replaces a folder
of 16 hand-edited HTML files with a single live-editable overlay, a trustworthy
preview, and a one-click curtain-wipe push to stream.

[![Latest release](https://img.shields.io/github/v/release/bos-tn/widener-stream-control-app?label=download&color=0054B8)](https://github.com/bos-tn/widener-stream-control-app/releases/latest)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-F0B310)
![Runs local](https://img.shields.io/badge/runs-100%25%20local-3ddc84)

**[⬇ Download the latest Windows installer](https://github.com/bos-tn/widener-stream-control-app/releases/latest)**

</div>

---

## Why this exists

Before this app, every game and every stream moment (starting soon, post-match,
rosters…) was its own overlay HTML file. Sixteen near-identical copies, edited by
hand mid-broadcast, each one a separate OBS Browser Source waiting to be pointed
at the wrong file. Now it's one app, one overlay, and one URL you paste into OBS
exactly once.

Everything runs on your own machine, in a local web server bundled inside an
Electron app. No cloud, no accounts, no internet dependency on game day.

## Highlights

- **One OBS URL, forever.** Point a Browser Source at
  `http://localhost:4310/overlay` and never touch it again. Games, moments, and
  NECC graphics are all switched from the control panel, never by editing OBS.
- **Preview everything before it airs.** Every edit, including text, countdowns,
  rosters, and even *which overlay is showing*, lands in a draft that only your
  preview pane can see. The stream doesn't change until you click **Push Live**.
- **Impossible to lose track.** Push Live glows gold whenever the preview has
  unpushed changes, and **Revert** snaps the preview back to whatever is
  currently on stream.
- **Curtain-wipe transitions.** Pushing plays the Widener curtain stinger on the
  live overlay and swaps your changes in while the screen is covered, so every
  push looks like a produced scene change. (Toggleable, of course.)
- **NECC / LeagueOS import.** Paste a match link to pull in both teams' names,
  logos, and starting rosters, then switch to NECC's own bracket and match
  graphics right from the overlay dropdown.
- **Fully editable rosters.** Type team names and players in by hand, add or
  remove players with a click. No import required. A NECC fetch just pre-fills
  the same fields, which you can then edit freely.
- **A real roster view.** Full-screen two-team lineup that scales player rows to
  fit however many players you enter.
- **A Be Right Back card.** Full-screen break screen with the Widener Pride lion,
  an animated headline wipe, and your social handles. The headline and subtitle
  are ordinary editable fields, so "Be Right Back" can just as easily read
  "Back after this match".
- **Live-sized preview.** The preview renders at a true 1920×1080 and scales
  down, so proportions always match what viewers see.
- **Optional OBS integration.** Run the control panel as a dock *inside* OBS, and
  if you want, let OBS drive the transitions: one scene per overlay type,
  switched with OBS's own stinger on every Push Live. Entirely opt-in. The
  one-URL setup above still works with zero OBS configuration.

## Setting up OBS (once)

1. Install the app and launch it.
2. Copy the **OBS Browser Source URL** from the top of the control panel.
3. In OBS, add a **Browser Source** to each scene that needs the overlay:
   paste the URL, set width **1920**, height **1080**.

That's the whole integration. The URL never changes, not for a new game, a new
week, or a new season.

> **Never** paste the preview pane's own URL (it ends in `?preview=1`) into OBS.
> That page mirrors your unsaved edits instantly. If a red **Preview, not live**
> badge ever shows on stream, that's what happened. Re-copy the real URL.

## Running the show

1. **Pick a game** and an **overlay**: Starting Soon, Post-Match, Rosters, Be
   Right Back, or a NECC graphic. Switching overlays previews first, like every
   other edit, and auto-fills sensible titles and countdowns for the moment you
   picked.
2. **Edit text, countdown, socials, logo, montage clip.** Everything autosaves
   to the draft and shows in the preview pane instantly.
3. **Rosters?** Type the teams and players straight into the Rosters panel, or
   paste a NECC/LeagueOS link and hit Fetch to pre-fill them, then edit, add, or
   remove any player by hand.
4. **Push Live.** Your draft goes to the stream exactly as previewed, behind the
   curtain stinger if the checkbox is on, instantly if it's not.
5. Changed your mind? **Revert** discards the draft and re-syncs the preview
   and form to what's live.

Anything in the panel marked with an **ⓘ** explains itself on hover or keyboard
focus, and the longer setup walkthroughs sit behind collapsible help blocks, so
the panel stays scannable during a broadcast.

Tip: pushing with no pending changes just fires the stinger, which gives you a
free manual transition whenever you want one.

## Optional: OBS dock and scene-sync

Everything above works with a single OBS Browser Source and no extra setup.
Two opt-in extras live in the control panel for people who want tighter OBS
integration. You can use either, both, or neither.

**Run the panel as an OBS dock.** In OBS, open **Docks** then **Custom Browser
Docks…**, give it a name, and paste the **Custom Browser Dock URL** from the
panel (`http://localhost:4310/control`). The control panel then lives inside the
OBS window, right next to your scenes.

**Let OBS drive the transitions (scene-sync).** In OBS 28 or newer, enable the
WebSocket server under **Tools** then **WebSocket Server Settings**, and note the
password. In the panel's **OBS scene-sync** section, enter the host, port, and
password, click **Connect**, then **Build / update scenes**. That creates one
scene per overlay type (*Starting Soon*, *Post-Match*, *Rosters*, *Be Right
Back*, *NECC*), each holding a locked Browser Source at
`…/overlay?view=<type>`. Turn **Scene-sync
on**, and every Push Live switches OBS to the matching scene using OBS's own
configured transition, which you can point at your Widener stinger. The overlay
content inside each scene still updates live over WebSocket exactly as before,
and the in-overlay curtain wipe switches itself off so the two never double up.

Notes:
- Scene-building is idempotent. Re-running it reuses existing scenes and sources
  by name instead of duplicating them.
- The obs-websocket password is held only in the app's memory and this machine's
  local settings. It is never committed and never logged.
- If OBS isn't reachable, none of this blocks a Push Live. The app simply falls
  back to the classic single-source behavior.

## For developers

Requirements: [Node.js](https://nodejs.org/) 18+ (developed on v22).

```bash
cd app
npm install
npm start        # full Electron app (control panel window)
npm run server   # or: just the server, http://localhost:4310
npm run dist     # build the Windows installer (bump "version" first!)
```

`npm run dist` produces the NSIS installer at
`app/dist/Widener Esports Stream Control Setup <version>.exe`, plus a portable
copy in `app/dist/win-unpacked/` that's handy for smoke tests. **Always test
the packaged exe** before shipping. Dev mode reads files off disk while the
packaged app reads from a bundled archive, and the two can disagree (see
`PROJECT_NOTES.md`).

### How it works

```
OBS Browser Source ──▶ /overlay ─── subscribes to ──▶ "live" state
Control panel      ──▶ /control ── every edit hits ──▶ "draft" state
Preview pane       ──▶ /overlay?preview=1 ─ mirrors ─▶ "draft" state

                 Push Live: draft ──copied verbatim──▶ live
```

The server (Express + WebSockets, bundled in the app) holds two copies of the
overlay state. Edits only ever touch `draft`; **Push Live** copies `draft` to
`live` and broadcasts it to every connected overlay. After each change the
server compares the two channels and tells the panel whether the preview is
"dirty", which is what drives the gold button and the Revert control.

The curtain stinger is the same side-by-side track-matte file used for OBS
scene transitions (fill left, luminance matte right). The overlay composites
it in real time with a WebGL shader and applies the pushed state at the exact
moment the fill fully covers the frame, measured from the video itself, so
the swap is never visible. If WebGL or the video is unavailable, pushes simply
apply instantly.

Adding `?view=<type>` to the overlay URL pins that page to one view: it ignores
pushed mode changes but still applies every other pushed field live. That is
what lets OBS hold a fixed source per scene in scene-sync mode. Without the
parameter, the overlay behaves exactly as it always has.

The Be Right Back card is authored as a fixed 1920×1080 composition, so it
renders at its true size and the whole stage is scaled to fit the viewport.
That keeps it pixel-exact on a 1080p source and correct in the small preview
pane. Its headline shrinks automatically if you type something longer than the
space allows, so a long line never runs off the edge.

### Repo layout

```
app/                 the Electron app (this is what ships)
  main.js            Electron entry: starts the server, opens the panel window
  server.js          Express + ws server: state model, WS protocol, NECC import, OBS routes
  necc.js            LeagueOS API client (match/roster import, overlay URLs)
  obs.js             optional obs-websocket client (scene-sync; fails soft if OBS is absent)
  templates/
    overlay.html     THE overlay: single file, all games, all modes
    games.json       games list for the Game dropdown
  public/
    control/         control panel UI
    overlay-assets/  curtain stinger video
  build/             icon source + generated icons

Stream/, archive/    the 16 legacy per-game files this app replaced (reference only)
PROJECT_NOTES.md     architecture notes + session history for future development
OBS_INTEGRATION_SPEC.md   the spec the v0.7.0 OBS work was built from
```

### NECC / LeagueOS import

`necc.js` talks to `api.leagueos.gg`, an unofficial API reverse-engineered from
LeagueOS's own web client (no login or key, just the headers their site computes
for anonymous visitors). If LeagueOS changes their internals the import fails
gracefully and everything can still be entered by hand. Nothing else depends
on it.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| OBS shows a stale overlay after an update | The `/overlay` route is served with `Cache-Control: no-store`, but OBS's browser can still cling to old pages. Right-click the source and refresh, or remove and re-add it. |
| Stream changes *before* you press Push Live | The OBS source URL has `?preview=1` on it. Re-copy the real URL from the panel. The red **Preview, not live** badge is the giveaway. |
| "Port 4310 is already in use" on launch | Another copy of the app (or an older version) is still running, so close it first. Launching a second copy normally just focuses the first window. |
| Packaged app crashes with `Cannot find module` | A new top-level `app/*.js` file wasn't added to `build.files` in `app/package.json`. Dev mode won't catch this; only the packaged build will. |
| Pushes apply instantly with no stinger | The checkbox may be off, OBS scene-sync may be on (which turns the in-overlay wipe off deliberately), or the overlay's browser has no WebGL. In OBS, check that hardware acceleration is enabled. |
| Scene-sync says "Not connected" | Check that the OBS WebSocket server is enabled under **Tools → WebSocket Server Settings**, and that the port and password match. The status line reports the underlying reason. |

## Tech

[Electron](https://www.electronjs.org/) ·
[Express](https://expressjs.com/) ·
[ws](https://github.com/websockets/ws) ·
[obs-websocket-js](https://github.com/obs-websocket-community-projects/obs-websocket-js) ·
[electron-builder](https://www.electron.build/)

No automated tests. The app is small and every change is verified by hand
against the real overlay (see `PROJECT_NOTES.md` for history and gotchas).

## License

Internal project for Widener University Esports. Not licensed for outside use
or redistribution.
