<img src="app/profiles/widener/assets/panel-logo.png" alt="Widener Esports" width="80"> <img src="app/profiles/lote/assets/logo-square.png" alt="League of the East" width="80">

# Widener Esports Stream Control

Windows app that builds and drives an OBS scene collection for esports
broadcasts. One codebase, one installer per league profile.

| App | Profile | Control panel | OBS scene collection |
| --- | --- | --- | --- |
| Widener Esports Stream Control | `widener` (NECC) | `http://localhost:4310/control` | `Widener Stream`, scenes `WU: …` |
| LotE Stream Control | `lote` (League of the East) | `http://localhost:4320/control` | `LotE Stream`, scenes `LotE: …` |

Installers: [latest release](https://github.com/bos-tn/widener-stream-control-app/releases/latest).
The apps install side by side with separate data folders and update channels.
An install over an older version keeps settings, teams and saved matches.

- Requires Windows and OBS 30 or newer on the same PC.
- The server listens on localhost only.
- Network access is used for the LeagueOS match import, league graphics,
  league standings, Google Drive downloads and update checks.

This document uses the Widener names. For LotE substitute `LotE` for `WU` and
port 4320 for 4310. Differences between the profiles are listed under
[Profiles](#profiles).

## Architecture

OBS owns scene selection. The app owns scene content.

- One match state on the server. Every scene is an OBS browser source loading
  `/overlay?view=<view>` and renders that state.
- The app connects to OBS over obs-websocket, creates the scene collection,
  and follows the program scene.
- The control panel edits the state. Edits reach every scene immediately.
  Text fields apply on Enter or blur.

Scenes, in the order they are created and sorted in OBS:

| Scene | Content | Built when |
| --- | --- | --- |
| Starting Soon | Title, subtitle, badge, countdown, video panel | Always |
| Rosters | Both lineups | Always |
| Head to Head | Both teams compared from the standings | Profile has league scenes and it is ticked |
| Standings | League table for the match's game | Profile has league scenes and it is ticked |
| League graphics | One scene per LeagueOS overlay (match preview, match rosters, bracket, season header, match progress, match activity) | Ticked under Match, Details |
| Scoreboard | Scoreboard over a game capture | Always |
| Rocket League Stats | Per-game and series stats | Score source is live game data |
| Be Right Back | Headline, subtitle | Always |
| Post-Match | Title, subtitle, badge, own countdown, video panel | Always |

A build creates missing scenes, updates existing ones in place, removes app
scenes the current match does not use, and reloads every browser source. Scenes
not created by the app are not modified.

Scene order: obs-websocket has no reorder request. With **Sort app scenes in
stream order** enabled, a build recreates out-of-order app scenes at the bottom
of the list and copies their items (transform, crop, lock, blend mode), filters
and transition override. Scene hotkeys are not copied. Sorting is skipped while
OBS is streaming or recording, and when a scene to be moved contains a group or
is nested in another scene.

Video settings: the Build step's checklist lists OBS's canvas size, output size
and frame rate. Under 1920x1080 at 60 fps (59.94 passes), **Set 1080p60** raises
whichever of the three is under and leaves the rest. After a canvas change the
app's browser sources and camera sources are resized to the new canvas. OBS
accepts a video change only while no output is running (stream, recording,
virtual camera, replay buffer). The bitrate is not changed. Listed when they
apply, both set in OBS Settings > Output: a stream bitrate under 6000 kbps at
1080p60 (Simple output mode; Advanced mode's bitrate cannot be read), and a
stream rescale under 1920x1080 (Advanced output mode).

The app switches scenes itself only for the Rocket League Stats auto-cut and
for **Put on air** in the panel. All other switching is done in OBS.

## Setup

Settings, Setup, **Run setup** (opens automatically on first run).

1. **Connect to OBS.** OBS: Tools > WebSocket Server Settings > Enable
   WebSocket server. Show Connect Info > copy the password into the app. The
   password is stored in the app's data folder. The app reconnects
   automatically.
2. **Scene collection.** Creates `Widener Stream` and switches OBS to it.
   Options: game capture on the Scoreboard scene (Game Capture, mode: any
   fullscreen application, on by default), Studio Mode (off by default).
3. **Stinger transition.** obs-websocket cannot create transitions. In OBS,
   with the app's scene collection open: Scene Transitions dock > + > Stinger,
   named exactly `Widener Stinger` (LotE: `LotE Stinger`). Then **Configure
   stinger**: the app copies the stinger video to its data folder, sets the
   file, transition point and track matte, and selects the transition.
4. **Highlight videos** (Widener). **Download all**.

While OBS is not connected the panel shows a banner and scene builds and
switches are unavailable.

## Match setup

Match page, five steps. Step 1 sets up the whole match from a link; steps 2
to 4 set the same fields by hand or correct them. A profile without the
broadcast package (LotE) has no step 1: its four steps start at Game, and the
match link is the **Match link** source of the Teams step.

1. **Match.** A LeagueOS match page URL and **Import**: the game with its
   scoreboard preset, both teams with rosters, the start time, the series
   length and the league graphic links. Both teams are saved to the team
   library. With the broadcast package, **League feed** lists this week's
   matches still to play from the followed links (the home team's, when the
   feed has any), each with **Import**. **Current match** shows what is set.
   **Manual setup** opens step 2.
2. **Game.** Sets the scoreboard preset (series length, unit, position, score
   source) and the highlight video. **Other** takes a custom name. On a league
   profile it also selects which standings are read.
3. **Teams.**
   - **Team library** (LotE: **LotE schools**): assign a saved team to Team A
     or Team B.
   - **Manual**: names, short names, colours, logos, players.
   The Starting Soon subtitle defaults to `Team A vs Team B` (with a home
   team set: `vs Opponent`).
4. **Details.** Start time (set time or duration), series length, round,
   Starting Soon subtitle, next match line, optional scenes, video override,
   video panel, music.
5. **Scenes.** Checklist (OBS, game, teams, start time, stinger), then **Build
   scenes**. Rebuild after changing the game or the optional scenes. A match
   can be saved here and loaded from the list at the top of the page.

## Live page

- **On air**: program scene and a periodic program screenshot (Settings,
  Display).
- **Score**: +1 series win per team, +/− corrections, Swap sides, Reset score
  (two clicks). Crew battles add stock controls and, under each team's stock
  counter, **Player order**: the roster in the order its players take the
  stage, each marked Out, On stage (with stocks left), Next or Bench. Drag a
  row to move a player; the scoreboard and the roster follow on drop. Stocks
  are lost down the order, so the player in the On stage row is the one whose
  stocks the counter takes.
- **Scoreboard settings**: score source (Manual or live game data), series
  unit, position, Rocket League options, stock counter. The top bar sits
  against the top edge of the screen. A team name too long for its box is
  shortened in this order: without "University" or "College", smaller type,
  the team's short name, whole words with an ellipsis.
- **Scenes**: the scenes of the current match with the program scene marked.
  Per scene: title, subtitle, badge, background. Post-Match: countdown length
  and layout. **Put on air** cuts OBS to the scene. A notice lists scenes
  missing from OBS or unused in OBS, with **Build scenes**.
- **Rosters**: names and player order.

Post-Match uses its own countdown (default 2:00), started when the scene goes
on air.

### Scene backgrounds

Each scene has a **Background** setting. League graphics share one. The
Scoreboard has none. Changes apply immediately.

| Profile | Backgrounds | Defaults |
| --- | --- | --- |
| Widener | Moving Stripes, Varsity Stripes, Shutters, W Shine, Pride Lions, Pride Tape, Floodlights, Speed Lines | Starting Soon: Varsity Stripes. This Week and Be Right Back: Floodlights. Matchup: Speed Lines. Rosters: Shutters. Post-Match: Pride Tape. League graphics: Pride Lions. Rocket League Stats: Moving Stripes |
| LotE | Mark Shine, Word Rows, Mark Pattern, Curtains | Starting Soon and league graphics: Mark Shine. Be Right Back and Standings: Curtains. Rosters and Rocket League Stats: Mark Pattern. Post-Match and Head to Head: Word Rows |

Widener draws the Rocket League Stats background at 50% opacity.

## Broadcast package (Widener)

Since v2.2.0. A
profile with a `broadcast` block in `profile.json` gets a second overlay
layer (`public/overlay-assets/bx.js`, `bx.css`) that redraws the full-screen
scenes and adds scenes, a ticker, pop-ups, a lower third and cameras. LotE has
no `broadcast` block and is unchanged.

### Scenes

| Scene | Content |
| --- | --- |
| Starting Soon | Badge, headline, matchup strip, countdown, highlight video, three other matches (turning every 8 s) |
| This Week (new) | The week's matches, seven per page, turning every 11 s. More than seven: the home team's matches first, then the rest by game |
| Matchup (new) | Both teams (logo, name, short name, players), game, round, series length, countdown |
| Rosters | Numbered player rows per team. Row height follows the longer roster |
| Scoreboard | Same boards. Added: team colour wash, "Match point" when a team is one win from the series |
| Rocket League Stats | Same screens. Rows enter in turn |
| Crowd Cam, Comp Room (new) | Transparent page over the camera: title on entry, label, badge, location line, series score |
| Be Right Back | Headline, series score, mascot, three other matches |
| Post-Match | With a series score: result with the winner marked, game scores for a Rocket League series, sign-off, countdown, video. Without: the Starting Soon layout |

Full-screen scenes carry a masthead (brand, game, round, time of day) and a
rail (ticker, or the social handles). Entrances start at the stinger's cut
point after a scene goes on air. Added backgrounds: Floodlights, Speed Lines.
The new scenes are listed under Match, Details, Optional scenes; a build adds
or removes them.

### Broadcast page

- **League feed**: a LeagueOS link and **Follow**.
  - School or team page: the seasons that school's teams (or that team) play
    in. The list is looked up again every 6 hours and on **Refresh league
    feed**, so a new season is added and a finished one dropped.
  - Season, stage or match page: that season.
  - League home page: every running season. Above 8 seasons nothing is
    followed until **Follow all** is pressed; on the profile's own league
    **<home team> teams only** follows the school instead.
  - A followed school is one row that opens to its seasons. More than 6
    seasons followed one by one fold into one row.
  - **Feed scope**: every match in the followed seasons, or the home team's
    only.
  - **Clear all** removes every followed link and the matches read from them
    (typed-in matches stay). **Default feed** replaces them with the
    profile's own feed (`broadcast.follow` in `profile.json`; Widener: its
    NECC school page, home team's matches only). Both have **Undo**.
  - A new install starts on the default feed. An install that already follows
    something keeps it.
  - Seasons are read two at a time, every 90 s while a match is due or in
    progress, otherwise every 15 min. Team logos are downloaded once.
- **Matches**: Monday to Sunday, from the league feed and from **Add match
  manually**. Per row: score steppers, Upcoming / Live / Final, a note, **Pop
  up**, **Remove**. A changed league row is marked Corrected until the
  league's own score changes; **Use league score** discards the change.
- **Ticker**: on full-screen scenes, camera scenes, gameplay. Lines are
  appended after the matches.
- **Pop-ups**: league feed changes, score changes made on the page (sent 2.5 s
  after the last change), the result when the series on stream is decided,
  and a typed message. Position and duration apply over gameplay; on
  full-screen and camera scenes pop-ups use the top right.
- **Lower third**: name, label, second line, mark (profile or a team),
  seconds (0: until **Hide**). A player chip fills the fields.
- **Cameras**: per camera a network address or a device, its signal,
  **Show window** (camera over the game on the Scoreboard scene), **Put
  scene on air**, window position and size.

### Cameras in OBS

A build creates one source per camera, places it under the overlay page in
its own scene, and adds a hidden copy to the Scoreboard scene under the
scoreboard page. **Show window** enables the copy at the window's position;
the overlay draws the frame. The source depends on the camera's address
(Broadcast, Cameras):

| Address | OBS source | Notes |
| --- | --- | --- |
| Web page (`http://`, `https://`) | Browser source `WU-netcam-<id>` | A MediaMTX WebRTC page (`http://host:8889/path/`) or any page that fills itself with the picture. Restyled: no background, no status text, picture cropped to fill. Kept loaded off air. |
| Stream (`rtsp://`, `rtmp://`, `srt://`, `.m3u8`) | Media source `WU-stream-<id>` | RTSP over TCP, no buffering, reconnect after 2 s. |
| None | Video Capture Device `WU-cam-<id>` | Device selected on the Broadcast page or in the source's properties. |

- An address with no scheme is RTSP on port 554 or 8554, otherwise a web page.
- Network sources are created muted, with their sound routed to OBS's mixer.
- A changed address is applied to OBS at once when the camera's scene exists.
  A camera has one source at a time; changing its sort removes the other.
- **Signal**: Live, No signal, Link answers, Link not reachable. A MediaMTX
  page and an RTSP address are asked whether the camera is publishing (no
  session is opened); any other page is only checked for an answer. Checked
  every 10 s while the Broadcast page is open.
- **Defaults**: `profiles/<id>/local.json`,
  `{ "cameras": { "<camera id>": "<address>" } }`. The file is not in the
  repository (`.gitignore`): the addresses are on the organisation's own
  network. It applies to dev runs only: the installer build leaves it out
  (`build/dist.js`), so an installed app starts with no addresses and the
  operator enters them once (kept in the data folder across updates). A
  `url` on a camera in `profile.json` is a default that ships, for an address
  that may be public. **Default link** on a camera goes back to its default.

### Review without OBS

```bash
cd app
npm run design          # demo data, http://localhost:4313/showcase
npm run test:broadcast  # 55 checks against a mock OBS
```

The showcase page shows every scene as a live tile, with buttons for pop-ups,
the lower third, camera windows and demo matches. It uses its own data folder
(`app/data/design`).

Run in OBS 32: the scene pages, the highlight video, and network cameras
(both scenes, both windows, cutting to and from them, changing a camera's
address and sort). Not yet run: a capture-device camera, the stinger, a live
league score change.

## Profiles

| | Widener | LotE |
| --- | --- | --- |
| Scene layout | Broadcast package; base layout without it | Own layout (`theme.css`): masthead, left text column, matchup row with records |
| League scenes | None | Standings, Head to Head |
| Standings source | None | `lote.v1.leagueos.gg` |
| Headline font | Kanit | Zentras (default) or Pink Blue |
| Team library | Empty | Member schools preloaded |
| Highlight videos | Per game, from Google Drive | None |
| Default music track | From Google Drive | None |
| Stinger | Video with track matte | Transparent WebM |

### Standings (LotE)

Standings are read from the league site and cannot be edited in the app.

- **Source**: the LeagueOS API behind the season results page
  (`/league/seasons/<id>/results`): the league's seasons, the season's scoring
  order, and its teams with their records. Only teams the league has
  confirmed are listed.
- **Season per game**: each game maps to a LeagueOS activity id
  (`leagueActivity` in `games.json`), with the season name as fallback. Of
  several seasons the one running now is used, then the next to start, then
  the most recent. A match imported from the league site pins its own season
  for that game.
- **Order**: the season's scoring properties in order (for example wins,
  losses, forfeits, game win %, game wins, score difference), then name.
  Teams level on every property share a rank. No rank is shown before the
  season has a result.
- **Refresh**: when a game is selected, after a match import, at start, every
  five minutes for the current game, and with **Refresh** on the League page.
- **Storage**: `league.json` in the data folder. If a read fails the last
  table is kept and the League page shows the error.
- **Columns**: record (matches), games or maps, difference, and the score
  difference when the league records scores.

The League page shows the table for any game, the season name and the time of
the last read. The Standings scene highlights the two teams of the current
match and uses two columns above ten teams. Head to Head compares standing,
record, games and differences. Each team's record is shown beside its name on
Starting Soon, Post-Match and Rosters.

### Headline font (LotE)

Live page, **Headline font**: Zentras (blackletter, mixed case) or Pink Blue
(brush capitals). One setting for all scenes. Both font files are excluded
from this repository (`app/profiles/lote/assets/fonts/README.md`) and packed
into the installer from the build PC. The Zentras file in use is the
designer's free download, licensed for personal use; broadcast use requires
the full licence from Alit Design.

## Rocket League

With the Rocket League preset the scoreboard reads live data from the game's
Stats API (no BakkesMod):

- centre board: round, game number, logos, goals, match clock (overtime,
  replay)
- series score as pips, counted when a game ends (best of 7 by default; a
  LeagueOS import sets the length)
- per-player boost bars
- goal banner with scorer and assist
- boost meter and stats for the spectated player

The **Rocket League Stats** scene exists only while the score source is live
game data. It shows one game's player stats with MVP, or the series overview.
With **Auto-cut to Stats after each game**:

- Three seconds after a game ends the app cuts to the scene.
- The scene has no time limit. It stays on program until the next game's
  first kickoff countdown starts (`MatchInitialized` or `CountdownBegin` from
  the Stats API), then the app cuts back to the Scoreboard. The next match
  loading does not end it. If the countdown events are missed, the first sign
  of play (round start, running clock, touched ball) triggers the cut.
- After the deciding game the scene switches to the series overview 15
  seconds later and stays on program.
- The app cuts back only if it made the cut and the scene is still on
  program.

**Game stats**, **Series overview** and **Back to Scoreboard** do the same
manually. Before game 1 the scene shows both rosters. Reset score starts a new
series record.

One-time setup:

1. Score card > **Connect to Rocket League**. Sets `PacketSendRate=30` in
   `Documents\My Games\Rocket League\TAGame\Config\TAStatsAPI.ini`.
2. Restart Rocket League. The file is read at launch.
3. Spectate the match.

**Hide game HUD while spectating** (Scoreboard settings, on by default): the
app sends the Stats API command `SetHUDVisibility` when the game client is
spectating, and again at each new match and kickoff countdown. Needs game
v2.72 or later. A client that is playing is left alone. The HUD is turned
back on when the setting is off, the score source is Manual, or the app
closes. On an older game version, hide the HUD in the game (default key H).

Blue is the left side. **Swap sides** when Team A is on orange; the panel
offers it when roster gamertags match the blue team. Auto-count stops once the
series is decided and can be disabled under Scoreboard settings.

## Highlight videos (Widener)

Starting Soon and Post-Match play the selected game's highlight video. A video
set under Match, Details overrides it. The files (6.5 GB in total) are
downloaded from the team Google Drive into the data folder when a game is
first selected, or all at once with Settings, Game highlight videos,
**Download all**. Interrupted downloads resume. The Drive files must be shared
as "Anyone with the link".

## Team library and saved matches

Imports save both teams. Settings, Team library: edit (name, short name,
colour, logo, players) and delete (undo for a few seconds). A deleted league
school is not re-added. An imported team that belongs to a league school uses
the league's logo.

A saved match stores teams, scene text, start time, scoreboard settings and
league graphic links. It does not store the score.

## Music

One OBS media source, `WU: Music`, present in every scene. It plays on
non-gameplay scenes and fades out on gameplay scenes. Settings, Background
music: enable, file, volume. Widener's default track is downloaded from the
team Google Drive on first use (36 MB).

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Enter (in a field) | Apply the field |
| 3 / 4 | Team A / Team B: +1 series win |
| 1 / 2 | Team A / Team B: −1 stock |
| Shift+1 / Shift+2 | Team A / Team B: +1 stock |
| Ctrl+plus / Ctrl+minus / Ctrl+0 | Panel text size: larger, smaller, reset |
| ? | Shortcut list |

Score keys are active on the Live page when no field has focus. An OBS dock
needs keyboard focus first.

## Remote control

`POST http://localhost:4310/api/remote/<action>` from a Stream Deck (web
request plugin), Bitfocus Companion or a script. `GET /api/remote` lists the
actions; Settings, Stream Deck and remote control lists them with Copy
buttons: scene cuts, stats screens, score actions, and with the broadcast
package `cam/<id>/on|off|toggle` (camera window) and `lower/hide`. Requests
with an `Origin` other than the app's own are rejected.

## OBS dock

OBS: Docks > Custom Browser Docks, URL `http://localhost:4310/control`.
`?page=live` opens on the Live page. The dock and the app window share state.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Banner: OBS not connected | Start OBS. Check Tools > WebSocket Server Settings > Enable WebSocket server. Click Connect. |
| Scene marked "Not in OBS", or a notice lists missing or unused scenes | **Build scenes**. Check that OBS has the app's scene collection open. |
| Scenes not in stream order | **Build scenes** while OBS is not streaming or recording. The build result states why sorting was skipped. |
| Video row: "Locked while OBS is streaming or recording" | OBS takes no video change while an output runs: stream, recording, virtual camera, replay buffer. Stop it, then **Set 1080p60**. |
| Stream is under 1080p with the Video row green | Advanced output mode rescales the stream: OBS Settings > Output > Streaming > Rescale Output. The checklist lists it. |
| Configure stinger reports no such transition | The name is case-sensitive (`Widener Stinger`, `LotE Stinger`) and transitions are stored per scene collection. |
| A scene shows an old version after an update | **Build scenes** reloads every browser source. Otherwise refresh the source in OBS. |
| Scoreboard scene shows no game | Set the `WU-game-capture` source to the game window, or run the game fullscreen. |
| Standings scene is empty | League page: check the status line. No table means the league site has no season or no confirmed teams for the game, or the read failed. |
| Team record missing beside a name | The team name does not match a row of the standings. Names are matched by prefix, short names only when unique. |
| Typed text not on stream | Press Enter or leave the field. |
| "Port 4310 is in use" | Another instance of the app is running. |
| Match import fails | LeagueOS changed or is unreachable. Enter teams manually or load a saved match. |
| League graphic scene is empty | Import the match. The graphic links come from the import. |
| Rocket League: waiting | Score card > Connect to Rocket League, then restart the game. |
| Camera scene or window is black | Broadcast > Cameras. A network camera: check its signal; "No signal" means the camera is not publishing, "Link not reachable" that this PC cannot reach its address. A device camera: select a device. "Source missing" means the scenes need a build. |
| Camera address not applied: "OBS still holds a removed source" | A source of that name was removed in OBS while a copy of it sat in another scene. Restart OBS, then **Build scenes**. |
| Camera window shows a frame with no picture | OBS is not connected, or the Scoreboard scene has no copy of the camera source: **Build scenes**. |
| League feed row: Read failed | LeagueOS changed or is unreachable. The last matches read stay in the list; add or correct matches by hand. |
| League feed: dozens of seasons followed | A league home page was followed. **Default feed**, or **Clear all** and follow the school's page. |
| Highlight video panel shows the mascot | No video for the game, the video is not downloaded yet, or it failed three times in a row. Settings, Game highlight videos shows the download state. |
| Scenes blank after OBS was opened before the app | The app reloads a scene source whose page has not loaded about 4 s after it connects to OBS. If OBS is not connected, connect it. |
| OBS log: `[highlight video] rebuilt at ...` | The video stopped decoding and was rebuilt at the same position. Logged under the scene source's name. |
| Rocket League boost shows a dash | Boost is only sent while spectating. |
| Panel unreachable from another computer | By design. The server accepts local connections only. |

## Development

Requires [Node.js](https://nodejs.org/) 18 or newer.

```bash
cd app
npm install
npm start             # Widener app
npm run start:lote    # LotE app
npm run server        # server only (Widener, port 4310)
npm run server:lote   # server only (LotE, port 4320)
npm run dist          # every profile's installer
npm run dist:lote     # one profile's installer
npm run icons         # app icons from profiles/<id>/icon-source.png
npm run stinger -- lote   # render a profile's stinger video (needs ffmpeg)
npm run design        # demo server for the broadcast package, http://localhost:4313/showcase
npm run test:broadcast    # checks against a mock OBS
```

### Profile files

`app/profiles/<id>/`. Each installer contains exactly one profile.

| File | Contents |
| --- | --- |
| `profile.json` | Names, port, OBS scene prefix, `league` (name, import hint, `site` and LeagueOS `id` for standings), home team, colours, asset file names, stinger (file, transition point in ms, track matte), music track, `leagueScenes`, `backgrounds` (list and per-view defaults), `headlineFonts` (list and default), `broadcast` (optional: `scenes`, `cameras` with id, label, title, subtitle and optional `url`, `follow`), defaults, installer identity (app id, package name, artifact name, update channel) |
| `games.json` | Games: id, name, scoreboard preset, highlight video, `leagueActivity` (LeagueOS activity ids), `scoreName` |
| `teams.json` | Optional member schools (id, name, short name, colours, logo), preloaded into the team library |
| `assets/` | Logo, panel logo, mascot, watermark, stinger video, `teams/` logos, `fonts/` |
| `theme.css` | Optional overlay styles loaded after the base styles |
| `theme.js` | Optional overlay script; builds the background layers |
| `icon-source.png`, `icons/` | App icon source and generated icons |

New profile: copy `profiles/lote`, change `profile.json` (`port`,
`obs.prefix`, `build.appId`, `build.packageName`, `build.artifactName`,
`build.channel`), replace assets, `games.json` and `teams.json`, then
`npm run icons -- <id>` and `npm run dist -- <id>`.

### Build and release

- `version` in `app/package.json` is shared by every profile.
- Output: `app/dist/<id>/` (installer, `.blockmap`, update file) and
  `app/dist/<id>/win-unpacked/`.
- A new top-level `.js` file in `app/` must be added to `build.files` in
  `app/package.json`.
- Licensed font files must be present in `profiles/lote/assets/fonts/` on the
  build PC. The build warns about missing ones.
- Release: one GitHub release tagged `v<version>` with, per profile, the
  installer, its `.blockmap` and its update file (`latest.yml` for Widener,
  `lote.yml` for LotE).

### Internals

- **State**: `state.json` in the data folder. Panels send partial updates
  (`{type:'update'}`); score counters are separate messages (`{type:'score'}`).
- **Views**: `/overlay?view=<view>`; league graphics add `&necc=<type>`.
- **Program scene**: followed through `CurrentProgramSceneChanged`; used for
  music, the Post-Match countdown, the Rocket League auto-cut and the panel's
  on-air marker.
- **Scene set**: `buildOptions()` in `server.js`.
- **Standings**: `league.json`; `GET /api/league`, `POST /api/league/refresh`;
  broadcast as `{type:'league'}`. Fetch code in `necc.js`.
- **Shared panel options**: `settings.json` under `panel`, served at
  `/api/prefs`.
- **OBS routes**: `/api/obs/*`. **Remote routes**: `POST /api/remote/*`.
- **Page version**: every page carries a build stamp and reloads when the
  server reports a different one.

```
app/
  main.js            Electron entry point, update checks
  server.js          local server, match state, library, standings, WebSocket
  profile.js         profile loading, /brand.js, /brand.css
  necc.js            LeagueOS: match import, seasons, standings
  obs.js             OBS: scene collection, scenes, stinger, music, program scene
  rlstats.js         Rocket League Stats API client
  build/dist.js      one installer per profile
  build/make-icon.js app icons
  build/make-stinger.js  drawn stinger video (transparent WebM)
  dev/mock-rlstats.js  mock Rocket League feed
  profiles/<id>/     profile.json, games.json, teams.json, assets, theme, icons
  templates/overlay.html   overlay page (all views, all profiles)
  public/control/    control panel
  public/overlay-assets/  shared fonts
archive/             old per-game overlay files
PROJECT_NOTES.md     design notes and history
```

LeagueOS access uses its internal, undocumented API. If it changes, the match
import and the standings refresh fail; manual team entry and the last stored
standings remain available.

Internal Widener University Esports project. Not licensed for outside use.
