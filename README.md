<img src="app/public/control/assets/logo.png" alt="Widener Esports" width="80">

# Widener Esports Stream Control

A Windows app for running the Widener Esports stream overlays. It replaces the
old folder of per-game overlay HTML files with one overlay that you edit from a
control panel.

Download the installer from the [latest release](https://github.com/bos-tn/widener-stream-control-app/releases/latest).
Installing a new version over an old one keeps your settings.

The app runs entirely on the streaming PC. It needs internet access only for the
NECC import and the overlay fonts.

## What it does

The app has one overlay page that OBS loads from `http://localhost:4310/overlay`.
The control panel decides what that page shows. The available overlays are:

- Starting Soon and Post-Match, with a title, subtitle, countdown, and optional montage clip
- Rosters, a two-team lineup
- Be Right Back
- Smash Scoreboard, an in-game scoreboard for Super Smash Bros. Ultimate
- NECC graphics (bracket, match preview, and others) pulled from LeagueOS

Edits made in the control panel show up in the preview pane first. The stream
does not change until you click Push Live. Revert throws away your edits and
resets the preview to whatever is currently on stream. The Push Live button
turns gold when the preview has changes that have not been pushed.

## Setting up OBS

1. Install and open the app.
2. Copy the OBS Browser Source URL from the top of the control panel.
3. In OBS, add a Browser Source to each scene that needs the overlay. Paste the
   URL and set the size to 1920 x 1080.

The URL is the same for every game and every overlay, so this only needs to be
done once.

Do not use the preview pane's URL (the one ending in `?preview=1`) in OBS. That
page shows unpushed edits. If a red "Preview, not live" badge appears on
stream, the wrong URL is in OBS.

## Running a stream

1. Pick the game and the overlay from the two dropdowns at the top of the panel.
   Picking an overlay fills in a default title and countdown for it.
2. Edit the text, countdown, socials, logo, and montage clip as needed. The
   title, subtitle, and status pill are saved separately for each overlay, so
   the Be Right Back text stays the same when you switch to Starting Soon and
   back. Socials, logo, montage clip, rosters, and countdown are shared by all
   overlays.
3. Fill in the Rosters section by hand, or paste a NECC match link into the
   import box and click Fetch to fill it in automatically. You can edit the
   imported names afterward.
4. Click Push Live. If "Curtain stinger on push" is checked, the Widener curtain
   wipe plays on stream and the change happens behind it.

Clicking Push Live with no changes just plays the curtain wipe, which works as a
manual transition.

Hover over any ⓘ in the panel for a short explanation of that setting.

## Smash scoreboard

Select Smash Scoreboard in the Overlay dropdown. The scoring controls also
appear whenever the game is set to Super Smash Bros. Ultimate.

The scoreboard has a transparent background, so in OBS the browser source must
be placed above the game capture. It sits at the top center of the screen to
stay clear of the in-game damage display and timer.

The defaults match the NECC crew battle format: 4 players per team, 3 stocks
each (12 per team), best of 3 sets. These can be changed in the panel.

- Team names, tags, logos, and player order come from the Rosters section.
  Players are used in the order they are listed, and the first player with
  stocks left is shown as on stage.
- Click "Lost a stock" when a player loses a stock. Undo reverses a misclick.
- When a team runs out of stocks, click "Won set" on the winning team. This
  adds a set point and refills both teams' stocks.
- Swap sides moves each team to the other side of the scoreboard.
- Reset match sets everything back to zero. It needs a second click to confirm.
- For 1v1 sets, uncheck "Show stock counter" and use only the set score.

Stock and set changes go to the stream immediately, without Push Live or the
curtain wipe. Uncheck "Scores go live instantly" to preview them first instead.
Switching to or from the scoreboard still requires Push Live.

## Optional OBS features

Neither of these is required.

Control panel as an OBS dock: in OBS, go to Docks, then Custom Browser Docks.
Add a dock using the Custom Browser Dock URL shown in the panel
(`http://localhost:4310/control`). The panel then appears inside the OBS
window. You can keep the app window open at the same time; both stay in sync.

Scene-sync: this lets the app switch OBS scenes on each Push Live, using OBS's
own transition.

1. In OBS 28 or newer, go to Tools, then WebSocket Server Settings. Enable the
   server and copy the password.
2. In the panel's OBS scene-sync section, enter the host, port, and password,
   then click Connect.
3. Click "Build / update scenes". This creates one scene per overlay (Starting
   Soon, Post-Match, Rosters, Be Right Back, Smash Scoreboard, NECC). Running it
   again updates the existing scenes instead of making duplicates.
4. Check "Scene-sync on" and pick a transition.

While scene-sync is on, the in-overlay curtain wipe is turned off so the two
transitions do not play at once. One Push Live sends the text for every
overlay, so you can also switch scenes directly in OBS afterward. For the Smash
Scoreboard scene, add your game capture below the browser source yourself.

The OBS password is stored only on the streaming PC. If OBS cannot be reached,
Push Live still works normally.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| OBS shows an old version of the overlay | Right-click the browser source and click Refresh, or remove and re-add it. |
| The stream changes before Push Live is clicked | The OBS source is using the `?preview=1` URL. Copy the correct URL from the panel. |
| "Port 4310 is already in use" | Another copy of the app is still running. Close it first. |
| No curtain wipe on push | Check the "Curtain stinger on push" box. It is turned off automatically while scene-sync is on. It also needs hardware acceleration enabled in OBS. |
| Scene-sync says "Not connected" | Check that the WebSocket server is enabled in OBS and that the port and password match. |
| NECC Fetch fails | LeagueOS may have changed their site. Enter the rosters by hand. |
| Smash scoreboard is not visible over the game | The browser source is below the game capture in the OBS source list. Move it above. |

## For developers

Requires [Node.js](https://nodejs.org/) 18 or newer.

```bash
cd app
npm install
npm start        # run the full app
npm run server   # run only the server at http://localhost:4310
npm run dist     # build the installer
```

Bump `version` in `app/package.json` before building. The installer is written
to `app/dist/`, along with an unpacked copy in `app/dist/win-unpacked/`. Test
the unpacked build before releasing, since the packaged app can behave
differently from dev mode. Any new top-level `.js` file in `app/` must be added
to `build.files` in `app/package.json` or the packaged app will crash on launch.

The server holds two copies of the overlay state: `draft`, which the control
panel edits and the preview shows, and `live`, which OBS shows. Push Live copies
`draft` to `live`. The Smash scoreboard's stock and set counters are the one
exception and are written to both at once.

Repo layout:

```
app/
  main.js            Electron entry point
  server.js          local server, overlay state, WebSocket messages
  necc.js            NECC / LeagueOS import
  obs.js             optional OBS scene-sync
  templates/
    overlay.html     the overlay page (all overlays)
    games.json       game list
  public/control/    control panel
  public/overlay-assets/  stinger video and images
Stream/, archive/    old per-game overlay files, kept for reference
PROJECT_NOTES.md     detailed design notes and history
```

The NECC import uses LeagueOS's internal API, which is not official or
documented. If it breaks, everything can still be entered by hand.

This is an internal Widener University Esports project and is not licensed for
outside use.
