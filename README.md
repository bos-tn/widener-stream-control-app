<img src="app/public/control/assets/logo.png" alt="Widener Esports" width="80">

# Widener Esports Stream Control

A Windows app for running the Widener Esports stream overlays. It replaces the
old folder of per-game overlay HTML files with one overlay that you edit from a
control panel.

Download the installer from the [latest release](https://github.com/bos-tn/widener-stream-control-app/releases/latest).
From v0.9.0 on, the app checks for new versions by itself and offers to install
them. Installing over an old version keeps your settings.

The app runs entirely on the streaming PC and can only be reached from that PC.
It needs internet access only for the NECC import, NECC graphics, and update
checks.

## What it does

The app has one overlay page that OBS loads from `http://localhost:4310/overlay`.
The control panel decides what that page shows. The available overlays are:

- Starting Soon and Post-Match, with a title, subtitle, countdown, and the selected game's montage (or your own clip)
- Rosters, a two-team lineup
- Be Right Back
- Scoreboard, an in-game scoreboard for any game (series score, with a stock counter for Smash).
  For Rocket League it reads the game itself: goals, clock, boost, and player stats
- NECC graphics (bracket, match preview, and others) pulled from LeagueOS

Edits made in the control panel show up in the preview first. The stream does
not change until you click Push Live. Revert throws away your edits and resets
the preview to whatever is on stream. The Push Live button turns gold when the
preview has changes that have not been pushed.

The control panel has two tabs. Show has everything used during a stream.
Setup has the things you set once: the OBS URL, the OBS connection, socials,
which NECC graphics get a button, the team library, and the keyboard shortcuts.

## Setting up OBS

1. Install and open the app.
2. On the Setup tab, copy the OBS Browser Source URL.
3. In OBS, add a Browser Source to each scene that needs the overlay. Paste the
   URL and set the size to 1920 x 1080.

The URL is the same for every game and every overlay, so this only needs to be
done once.

Do not use the preview's URL (the one ending in `?preview=1`) in OBS. That page
shows unpushed edits. If a red "Preview, not live" badge appears on stream, the
wrong URL is in OBS.

## Running a stream

1. Pick the game. This fills in the game name and loads that game's scoreboard
   settings.
2. Click an overlay button. The button with the blue outline is what the
   preview shows; the one marked LIVE is what is on stream. Picking an overlay
   fills in a default title and countdown for it. Tick "Push live as soon as I
   pick an overlay" if you want overlay switches to skip the preview.
3. Fill in the teams in the Rosters section: type them in, pick a saved team
   from the dropdown above each roster, or paste a NECC match link under Match
   and click Fetch. Drag the handle on the left of a player to reorder them.
4. Edit the text, countdown, logo, and montage clip as needed. The title,
   subtitle, and status pill are saved separately for each overlay. Editing
   other fields no longer restarts a running countdown; use Restart countdown
   for that.
5. Click Push Live. If "Curtain stinger on push" is checked, the Widener curtain
   wipe plays on stream and the change happens behind it.

Undo edit and Redo, under Push Live, step back and forward through your recent
edits. The Live button above the preview shows what is on stream right now,
with a red border so it is not mistaken for the preview.

Hover over any ⓘ in the panel for a short explanation of that setting.

## Game montages

Every game except Call of Duty has a highlight montage on the team Google
Drive. Starting Soon, Post-Match and Be Right Back play the selected game's
montage in the montage panel, and picking a different game swaps it. A clip
typed into the Media section replaces the montage.

The montages are too big to ship with the installer (6.5 GB in all), so each
PC downloads them from Drive into the app's own data folder the first time a
game is picked. The status line under the Game picker shows the progress. To
avoid a download starting mid-stream, open Setup and click **Download all
montages** before your first stream on a new PC. A download that is cut off
picks up where it left off.

The Drive files must stay shared as "Anyone with the link". If they are made
private, downloads fail with a message saying so. Montages already on a PC keep
working.

## Saved matches and the team library

Under Match, "Save current setup as" stores the teams, rosters, text, countdown,
scoreboard settings, and NECC links for a match. Load brings them back later.
Loading does not change which overlay is up or the live score.

Each roster has a Save team button, and every NECC import saves both teams
automatically. Saved teams appear in the dropdown above each roster and in the
Team library list on the Setup tab, where they can be deleted. Team logos from
NECC are downloaded once and stored on the PC.

## Scoreboard

Click the Scoreboard overlay. Its controls also stay on the Show tab while the
scoreboard is live, so you can keep score while preparing the next overlay.

The scoreboard has a transparent background, so in OBS the browser source must
be placed above the game capture. It comes in two layouts: a full bar across
the top center, or a smaller box in one of the four corners for games whose own
HUD uses the top of the screen. Picking a game sets a starting position,
best-of, and wording (Game, Map, or Set); check these over real gameplay and
change them under Scoreboard settings if needed. Team colors come from the
color picker next to each team name.

- Click "Won game" (or map, or set) on the winning team to add a point. The
  minus and plus buttons correct the score.
- Swap sides moves each team to the other side.
- Reset match sets everything back to zero. It needs a second click to confirm.

For Smash crew battles, turn on the stock counter (the Smash preset does this).
The default is 4 players per team with 3 stocks each. Players are used in roster
order, and the first player with stocks left is shown as on stage. Click "Lost
a stock" when a player loses one; Undo reverses a misclick. "Won set" refills
both teams' stocks.

Score changes go to the stream immediately, without Push Live or the curtain
wipe. Uncheck "Scores go live instantly" to preview them first instead.

### Rocket League

Picking Rocket League as the game switches the scoreboard to its Rocket League
style, which reads live data from the game through Rocket League's official
Stats API (the same feed BARL uses since the EAC update; BakkesMod is not
needed). It shows:

- a compact centre board: round and game number, team logos, this game's goals, and
  the match clock (gold in overtime, REPLAY during goal replays)
- the series score as pips under each team, counted automatically when a game ends
  (best of 7 by default; a NECC Fetch sets it from the match)
- each player's boost in the top corners
- a goal banner with the scorer and assist
- a boost meter in the bottom right for the player the camera is following, with their stats
- a full-screen stats screen after each game (every player's score, goals, assists,
  shots, saves and demos, with the game's MVP), and a series overview once the
  series is won (each game's score and map, and series totals with a series MVP)

The board switches by itself: to the game's stats 3 seconds after a game ends
(under the Widener curtain stinger),
to the series overview 15 seconds after the deciding game, and back to the live
board when the next game loads (not once the series is won). The **On the board**
buttons in the Scoreboard section switch by hand, including to an earlier game's
stats. Reset match starts a new series record.

One-time setup on the streaming PC:

1. With the Scoreboard overlay selected, the Scoreboard section shows the game
   connection. If it says the Stats API is turned off, click **Turn on the
   Stats API**. This sets `PacketSendRate=30` in
   `Documents\My Games\Rocket League\TAGame\Config\TAStatsAPI.ini`.
2. Fully close and restart Rocket League. It only reads that file at launch.
3. Spectate the match. Hide the game's own HUD in spectator mode so its
   scoreboard and boost meter don't sit under ours.

Blue is always the left side. If team A is playing orange, click Swap sides;
the panel offers this itself when the roster gamertags match the players on
blue. Auto-counting stops once a team has clinched the series, and can be
turned off under Scoreboard settings for scrims. The plus and minus buttons
still correct the series score. The preview shows sample data when the game
isn't in a match, so the layout can be checked any time; the stream never does.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+Enter | Push Live |
| Ctrl+1 to Ctrl+9 | Pick an overlay by its position |
| Ctrl+Z / Ctrl+Y | Undo / redo an edit (outside text boxes) |
| 1 / 2 | Team A / Team B lost a stock |
| Shift+1 / Shift+2 | Undo a stock for Team A / Team B |
| 3 / 4 | Team A / Team B won a game, map, or set |

The scoreboard keys work while the scoreboard controls are showing and you are
not typing in a box. In an OBS dock, click the dock first so it has keyboard
focus.

## Background music

Music plays whenever there is no gameplay on screen: Starting Soon, Be Right
Back, Post-Match, Rosters, NECC, and the Rocket League stats screens and menus
between games. It fades out when gameplay is on screen. A track is included
with the app; Setup > Background music can pick a different file, change the
volume, or turn it off.

OBS plays the music, so it needs OBS connected (see below). Build / update
scenes adds one media source, **WU: Music**, to every WU scene. Because it is
the same source in every scene, it carries on through scene changes instead of
starting over, and it loops.

## Optional OBS features

Neither of these is required.

Control panel as an OBS dock: in OBS, go to Docks, then Custom Browser Docks.
Add a dock using the Custom Browser Dock URL from the Setup tab
(`http://localhost:4310/control`). The panel then appears inside the OBS
window. The app window and the dock can be open at the same time; they share
the same score, library, and draft.

Scene-sync: this lets the app switch OBS scenes on each Push Live, using OBS's
own transition.

1. In OBS 28 or newer, go to Tools, then WebSocket Server Settings. Enable the
   server and copy the password.
2. In the OBS scene-sync section of the Setup tab, enter the host, port, and
   password, then click Connect.
3. Click "Build / update scenes". This creates one scene per overlay (Starting
   Soon, Post-Match, Rosters, Be Right Back, Scoreboard, NECC). Running it again
   updates the existing scenes instead of making duplicates.
4. Check "Scene-sync on" and pick a transition.

After one successful Connect, the app connects to OBS by itself whenever it
starts, and reconnects if OBS is closed or restarted. An OBS status light
appears in the top bar. Switching scenes by hand in OBS moves the LIVE marker
on the overlay buttons to match. While scene-sync is on, the in-overlay curtain
wipe is turned off so the two transitions do not play at once. For the
Scoreboard scene, add your game capture below the browser source yourself.

The OBS password is stored only on the streaming PC. If OBS cannot be reached,
Push Live still works normally.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| OBS shows an old version of the overlay | Right-click the browser source and click Refresh, or remove and re-add it. |
| The stream changes before Push Live is clicked | The OBS source is using the `?preview=1` URL, or "Push live as soon as I pick an overlay" is ticked. |
| "Port 4310 is already in use" | Another copy of the app is still running. Close it first. |
| No curtain wipe on push | Check the "Curtain stinger on push" box. It is turned off automatically while scene-sync is on. It also needs hardware acceleration enabled in OBS. |
| OBS light says "OBS offline" or "reconnecting" | OBS is closed, or its WebSocket server is off. The app keeps trying on its own once OBS is back. |
| NECC Fetch fails | LeagueOS may have changed their site. Enter the rosters by hand or load a saved match. |
| A NECC graphic shows only a spinner | LeagueOS is slow or unreachable. The preview says so after about 12 seconds. |
| Scoreboard is not visible over the game | The browser source is below the game capture in the OBS source list. Move it above. |
| Rocket League stays on "Waiting for Rocket League" | Turn on the Stats API from the Scoreboard section, then fully restart the game. The board fills in once a match is loaded. |
| Rocket League boost shows a dash | The game only sends boost while spectating (or for your own team). Spectate the match from the streaming PC. |
| Another computer can't open the control panel | That is intended: the app only accepts connections from the streaming PC. |

## For developers

Requires [Node.js](https://nodejs.org/) 18 or newer.

```bash
cd app
npm install
npm start        # run the full app
npm run server   # run only the server at http://localhost:4310
npm run dist     # build the installer
```

Bump `version` in `app/package.json` before building. The installer and
`latest.yml` are written to `app/dist/`, along with an unpacked copy in
`app/dist/win-unpacked/`. Test the unpacked build before releasing, since the
packaged app can behave differently from dev mode. Any new top-level `.js` file
in `app/` must be added to `build.files` in `app/package.json` or the packaged
app will crash on launch.

To release, create a GitHub release tagged `v<version>` and attach the
installer `.exe`, its `.blockmap`, and `latest.yml`. Installed copies of the app
read `latest.yml` from the latest release to find updates, so a release without
it will not be offered to anyone.

The server holds two copies of the overlay state: `draft`, which the control
panel edits and the preview shows, and `live`, which OBS shows. Push Live copies
`draft` to `live`. The scoreboard's score and stock counters are the one
exception and are written to both at once.

Repo layout:

```
app/
  main.js            Electron entry point and update checks
  server.js          local server, overlay state, library, WebSocket messages
  necc.js            NECC / LeagueOS import
  obs.js             optional OBS scene-sync
  rlstats.js         Rocket League Stats API client (live game data)
  dev/mock-rlstats.js  fake Rocket League feed for testing without the game
  templates/
    overlay.html     the overlay page (all overlays)
    games.json       game list and per-game scoreboard settings
  public/control/    control panel
  public/overlay-assets/  stinger video, images, fonts
archive/             old per-game overlay files, kept for reference
PROJECT_NOTES.md     detailed design notes and history
```

The NECC import uses LeagueOS's internal API, which is not official or
documented. If it breaks, everything can still be entered by hand.

This is an internal Widener University Esports project and is not licensed for
outside use.
