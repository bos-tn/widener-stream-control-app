<div align="center">

<img src="app/public/control/assets/logo.png" alt="Widener Esports" width="96">

# Widener Esports Stream Control

**One overlay. One URL. Nothing goes live until you say so.**

A desktop control room for Widener Esports' stream overlays — replace a folder of
16 hand-edited HTML files with a single live-editable overlay, a trustworthy
preview, and a one-click curtain-wipe push to stream.

[![Latest release](https://img.shields.io/github/v/release/bos-tn/widener-stream-control-app?label=download&color=0054B8)](https://github.com/bos-tn/widener-stream-control-app/releases/latest)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-F0B310)
![Runs local](https://img.shields.io/badge/runs-100%25%20local-3ddc84)

**[⬇ Download the latest Windows installer](https://github.com/bos-tn/widener-stream-control-app/releases/latest)**

</div>

---

## Why this exists

Before this app, every game and every stream moment (starting soon, post-match,
rosters…) was its own overlay HTML file — sixteen near-identical copies, edited
by hand mid-broadcast, each one a separate OBS Browser Source waiting to be
pointed at the wrong file. Now it's one app, one overlay, and one URL you paste
into OBS exactly once.

Everything runs on your own machine — a local web server bundled inside an
Electron app. No cloud, no accounts, no internet dependency on game day.

## Highlights

- **One OBS URL, forever.** Point a Browser Source at
  `http://localhost:4310/overlay` and never touch it again. Games, moments, and
  NECC graphics are all switched from the control panel — never by editing OBS.
- **Preview everything before it airs.** Every edit — text, countdowns, rosters,
  even *which overlay is showing* — lands in a draft that only your preview pane
  can see. The stream doesn't change until you click **Push Live**.
- **Impossible to lose track.** Push Live glows gold whenever the preview has
  unpushed changes, and **Revert** snaps the preview back to whatever is
  currently on stream.
- **Curtain-wipe transitions.** Pushing plays the Widener curtain stinger on the
  live overlay and swaps your changes in while the screen is covered — every
  push looks like a produced scene change. (Toggleable, of course.)
- **NECC / LeagueOS import.** Paste a match link and pull in both teams' names,
  logos, and rosters. Click player chips to pick who's actually playing, and
  switch to NECC's own bracket/match graphics right from the overlay dropdown.
- **A real roster view.** Full-screen two-team lineup that scales player rows to
  fit however many are selected.
- **Live-sized preview.** The preview renders at a true 1920×1080 and scales
  down, so proportions always match what viewers see.

## Setting up OBS (once)

1. Install the app and launch it.
2. Copy the **OBS Browser Source URL** from the top of the control panel.
3. In OBS, add a **Browser Source** to each scene that needs the overlay:
   paste the URL, set width **1920**, height **1080**.

That's the whole integration. The URL never changes — not for a new game, a new
week, or a new season.

> **Never** paste the preview pane's own URL (it ends in `?preview=1`) into OBS.
> That page mirrors your unsaved edits instantly. If a red **PREVIEW — NOT
> LIVE** badge ever shows on stream, that's what happened — re-copy the real URL.

## Running the show

1. **Pick a game** and an **overlay** — Starting Soon, Post-Match, Rosters, or a
   NECC graphic. Switching overlays previews first, like every other edit, and
   auto-fills sensible titles and countdowns for the moment you picked.
2. **Edit text, countdown, socials, logo, montage clip.** Everything autosaves
   to the draft and shows in the preview pane instantly.
3. **Importing a match?** Paste the NECC/LeagueOS link, hit Fetch, and toggle
   the player chips for tonight's lineup.
4. **Push Live.** Your draft goes to the stream exactly as previewed — behind
   the curtain stinger if the checkbox is on, instantly if it's not.
5. Changed your mind? **Revert** discards the draft and re-syncs the preview
   and form to what's live.

Tip: pushing with no pending changes just fires the stinger — a free manual
transition whenever you want one.

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
the packaged exe** before shipping — dev mode reads files off disk, the
packaged app reads from a bundled archive, and they can disagree (see
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
"dirty" — that's what drives the gold button and the Revert control.

The curtain stinger is the same side-by-side track-matte file used for OBS
scene transitions (fill left, luminance matte right). The overlay composites
it in real time with a WebGL shader and applies the pushed state at the exact
moment the fill fully covers the frame — measured from the video itself, so
the swap is never visible. If WebGL or the video is unavailable, pushes simply
apply instantly.

### Repo layout

```
app/                 the Electron app (this is what ships)
  main.js            Electron entry: starts the server, opens the panel window
  server.js          Express + ws server: state model, WS protocol, NECC import
  necc.js            LeagueOS API client (match/roster import, overlay URLs)
  templates/
    overlay.html     THE overlay — single file, all games, all modes
    games.json       games list for the Game dropdown
  public/
    control/         control panel UI
    overlay-assets/  curtain stinger video
  build/             icon source + generated icons

Stream/, archive/    the 16 legacy per-game files this app replaced (reference only)
PROJECT_NOTES.md     architecture notes + session history for future development
```

### NECC / LeagueOS import

`necc.js` talks to `api.leagueos.gg` — an unofficial API reverse-engineered
from LeagueOS's own web client (no login or key; just the headers their site
computes for anonymous visitors). If LeagueOS changes their internals the
import fails gracefully and everything can still be entered by hand; nothing
else depends on it.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| OBS shows a stale overlay after an update | The `/overlay` route is served with `Cache-Control: no-store`, but OBS's browser can still cling to old pages — right-click the source and refresh, or remove/re-add it. |
| Stream changes *before* you press Push Live | The OBS source URL has `?preview=1` on it. Re-copy the real URL from the panel. The red **PREVIEW — NOT LIVE** badge is the giveaway. |
| "Port 4310 is already in use" on launch | Another copy of the app (or an older version) is still running — close it first. Launching a second copy normally just focuses the first window. |
| Packaged app crashes with `Cannot find module` | A new top-level `app/*.js` file wasn't added to `build.files` in `app/package.json`. Dev mode won't catch this — only the packaged build will. |
| Pushes apply instantly with no stinger | The checkbox may be off — or the overlay's browser has no WebGL (in OBS, check that hardware acceleration is enabled). |

## Tech

[Electron](https://www.electronjs.org/) ·
[Express](https://expressjs.com/) ·
[ws](https://github.com/websockets/ws) ·
[electron-builder](https://www.electron.build/)

No automated tests — the app is small and every change is verified by hand
against the real overlay (see `PROJECT_NOTES.md` for history and gotchas).

## License

Internal project for Widener University Esports. Not licensed for outside use
or redistribution.
