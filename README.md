# Widener Esports Stream Control

A desktop app for running Widener Esports' Twitch/stream overlays. It
replaces a folder of 16 near-duplicate per-game overlay HTML files with a
single overlay, one stable OBS Browser Source URL, and a live-editable
control panel with a safe preview-before-you-go-live workflow.

Built with Electron + Express + WebSockets. Runs entirely on your own
machine — no cloud services, no accounts, no external server.

**[⬇ Download the latest Windows installer](https://github.com/bos-tn/widener-stream-control-app/releases/latest)**

## Features

- **One overlay URL, forever.** Point an OBS Browser Source at
  `http://localhost:4310/overlay` once and never touch it again. Which
  game, which moment (Starting Soon / Post-Match / Rosters), and NECC
  bracket/match graphics are all switched via the control panel, not by
  changing URLs or re-adding sources.
- **Draft vs. Live.** Every edit you make lands in a "draft" that only the
  control panel's own preview pane can see. Nothing goes out to OBS until
  you click **Push Live**, so you can safely stage text, countdowns, and
  rosters mid-broadcast without anyone seeing the edit in progress.
- **Full-screen roster view** for two-team lineups, with player rows that
  automatically scale to fit however many players are selected.
- **NECC / LeagueOS match import** — paste a match or bracket link and pull
  in team names, logos, and rosters automatically, or fill everything in
  by hand.
- **Configurable countdown, socials, montage clip, logo, and layout**, all
  editable live from one panel.
- **Packaged as a normal Windows app** (installer + portable unpacked
  build) via electron-builder — no Node.js install required to run it.

## Requirements

- Windows 10/11 (the packaged build targets Windows; the dev server itself
  is cross-platform)
- [Node.js](https://nodejs.org/) 18+ (developed against v22) if you want to
  run from source or build the installer
- OBS Studio (or any tool that supports a Browser Source / embedded web
  view) to actually display the overlay on stream

## Quick start (running from source)

```bash
cd app
npm install
npm run server      # starts the Express/WS server only, on http://localhost:4310
```

or run it as the full Electron app (opens the control panel in its own
window):

```bash
cd app
npm install
npm start
```

Then in OBS, add a **Browser Source** pointed at:

```
http://localhost:4310/overlay
```

Width 1920, height 1080. That's it — this URL never needs to change again,
even when you switch games or overlay modes.

## Building a distributable installer

```bash
cd app
npm run dist
```

Produces `app/dist/Widener Esports Stream Control Setup <version>.exe`
(NSIS installer) plus an unpacked, no-install copy at
`app/dist/win-unpacked/Widener Esports Stream Control.exe` that's handy for
quick local testing.

**Bump the `version` field in `app/package.json` before every build** —
the installer filename and the app's "About" info are both derived from it.

## Using the control panel

1. **Copy the OBS Browser Source URL** from the top of the panel and paste
   it into an OBS Browser Source once. Do not use the preview pane's own
   URL (it has a `?preview=1` query string) — that one is only for the
   control panel's own preview and will make OBS mirror your unsaved edits
   instantly instead of waiting for Push Live. If you ever see a red
   "PREVIEW — NOT LIVE" badge on your actual stream, the wrong URL got
   pasted into OBS.
2. **Pick a game** from the dropdown (fills in the game name) and choose
   an **Overlay** mode — Starting Soon, Post-Match, or Rosters. Switching
   this dropdown takes effect on stream immediately (it's a scene switch,
   not a content edit), independent of Push Live.
3. **Edit text, countdown, socials, logo, and montage clip** in the
   settings column. Every change is auto-saved to the draft and reflected
   in the live-sized preview pane on the right — but nothing changes on
   stream until you click **Push Live**.
4. **Rosters mode**: import a match via the NECC/LeagueOS link field, or
   fill in team names/logos by hand. Click player chips to toggle who's
   actually playing; only selected players render on the overlay.
5. **Push Live** copies your current draft to the live overlay exactly as
   shown in the preview.

## How it works

```
app/                          the Electron app (this is what ships)
  main.js                     Electron entry: starts server.js, opens the control panel window
  server.js                   Express + ws server: state model, WebSocket protocol, NECC import route
  necc.js                     LeagueOS API client (match/roster import, overlay URL construction)
  templates/
    overlay.html              the overlay itself — single file, all games, all modes
    games.json                the games list used by the Game dropdown
  public/control/              the control panel UI (index.html / control.css / control.js)
  build/                       icon source + generated icon files
  data/                        dev-only local state (gitignored; the packaged app uses its own userData folder)

Stream/                        legacy per-game overlay files, superseded — not part of the shipped app
archive/                       the 16 old per-game HTML files this project replaced, kept for reference
```

**Draft vs. live, in more detail:** the server holds two copies of the
overlay's state — `live` (what every OBS Browser Source sees) and `draft`
(what the control panel's own preview iframe sees). Editing a field only
ever touches `draft`. Clicking **Push Live** copies `draft` → `live`
verbatim and broadcasts it over WebSocket to any connected overlays. The
overlay page (`templates/overlay.html`) subscribes to `live` by default;
it only subscribes to `draft` when loaded with a `?preview=1` query string,
which only the control panel's preview pane uses.

The one exception is the **Overlay dropdown** (switching between Starting
Soon / Post-Match / Rosters / NECC modes) — that's treated as a scene
switch, not a content edit, so it updates both channels immediately rather
than waiting for Push Live.

## NECC / LeagueOS import

`necc.js` talks to `api.leagueos.gg`, an unofficial API reverse-engineered
from LeagueOS's own web client (no login or API key — just headers their
own site computes for anonymous visitors). If LeagueOS changes their
internal contract, the import feature will fail gracefully and you can
still fill in team/roster info by hand; nothing else in the app depends on
it.

## Troubleshooting

- **OBS shows an old version of the overlay after an update.** OBS's
  embedded browser can cache pages aggressively. The `/overlay` route is
  served with `Cache-Control: no-store` specifically to prevent this, but
  if you still see stale content, right-click the source in OBS and
  refresh/reload it, or remove and re-add the Browser Source.
- **OBS is changing before you press Push Live.** Almost always means the
  URL pasted into the OBS Browser Source has `?preview=1` on the end —
  re-copy the URL from the control panel's "OBS Browser Source URL" field
  and replace it in OBS. A red "PREVIEW — NOT LIVE" badge appearing on the
  overlay is a giveaway that this is the issue.
- **The packaged app crashes on launch with a "Cannot find module" error.**
  A new top-level `app/*.js` file was added but not whitelisted in
  `build.files` in `app/package.json` — dev mode reads files straight off
  disk so this only shows up in the packaged build. Add the file there and
  rebuild.
- **Always test the actual packaged exe**
  (`app/dist/win-unpacked/Widener Esports Stream Control.exe`) before
  calling a change done — dev mode and the packaged app don't always
  behave identically (file bundling, local data storage path, read-only
  install directory).

## Tech stack

- [Electron](https://www.electronjs.org/) — desktop shell
- [Express](https://expressjs.com/) — local HTTP server
- [ws](https://github.com/websockets/ws) — WebSocket state sync between
  the control panel, preview, and live overlay
- [electron-builder](https://www.electron.build/) — packaging/installer

## Status

No automated test suite — this app is small and has been verified
manually each session (see `PROJECT_NOTES.md` for a detailed build/session
history and architectural notes if you're picking up development).

## License

Internal project for Widener University Esports. Not currently licensed
for outside use or redistribution.
