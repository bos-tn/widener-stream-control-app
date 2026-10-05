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
   fullscreen application), Studio Mode.
3. **Stinger transition.** obs-websocket cannot create transitions. In OBS,
   with the app's scene collection open: Scene Transitions dock > + > Stinger,
   named exactly `Widener Stinger` (LotE: `LotE Stinger`). Then **Configure
   stinger**: the app copies the stinger video to its data folder, sets the
   file, transition point and track matte, and selects the transition.
4. **Highlight videos** (Widener). **Download all**.

While OBS is not connected the panel shows a banner and scene builds and
switches are unavailable.

## Match setup

Match page, four steps.

1. **Game.** Sets the scoreboard preset (series length, unit, position, score
   source) and the highlight video. **Other** takes a custom name. On a league
   profile it also selects which standings are read.
2. **Teams.**
   - **Match link**: a LeagueOS match page URL. Imports both teams with
     rosters, the start time, the series length and the league graphic links.
     Both teams are saved to the team library.
   - **Team library** (LotE: **LotE schools**): assign a saved team to Team A
     or Team B.
   - **Manual**: names, short names, colours, logos, players.
   The Starting Soon subtitle defaults to `Team A vs Team B` (with a home
   team set: `vs Opponent`).
3. **Details.** Start time (set time or duration), series length, round,
   Starting Soon subtitle, next match line, optional scenes, video override,
   video panel, music.
4. **Scenes.** Checklist (OBS, game, teams, start time, stinger), then **Build
   scenes**. Rebuild after changing the game or the optional scenes. A match
   can be saved here and loaded from the list at the top of the page.

## Live page

- **On air**: program scene and a periodic program screenshot (Settings,
  Display).
- **Score**: +1 series win per team, +/− corrections, Swap sides, Reset score
  (two clicks). Crew battles add stock controls.
- **Scoreboard settings**: score source (Manual or live game data), series
  unit, position, Rocket League options, stock counter.
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
| Widener | Moving Stripes, Varsity Stripes, Shutters, W Shine, Pride Lions, Pride Tape | Starting Soon: Varsity Stripes. Rosters: Shutters. Be Right Back: W Shine. Post-Match: Pride Tape. League graphics: Pride Lions. Rocket League Stats: Moving Stripes |
| LotE | Mark Shine, Word Rows, Mark Pattern, Curtains | Starting Soon and league graphics: Mark Shine. Be Right Back and Standings: Curtains. Rosters and Rocket League Stats: Mark Pattern. Post-Match and Head to Head: Word Rows |

Widener draws the Rocket League Stats background at 50% opacity.

## Profiles

| | Widener | LotE |
| --- | --- | --- |
| Scene layout | Base layout | Own layout (`theme.css`): masthead, left text column, matchup row with records |
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
3. Spectate the match with the game's HUD hidden.

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
buttons: scene cuts, stats screens, score actions. Requests with an `Origin`
other than the app's own are rejected.

## OBS dock

OBS: Docks > Custom Browser Docks, URL `http://localhost:4310/control`.
`?page=live` opens on the Live page. The dock and the app window share state.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Banner: OBS not connected | Start OBS. Check Tools > WebSocket Server Settings > Enable WebSocket server. Click Connect. |
| Scene marked "Not in OBS", or a notice lists missing or unused scenes | **Build scenes**. Check that OBS has the app's scene collection open. |
| Scenes not in stream order | **Build scenes** while OBS is not streaming or recording. The build result states why sorting was skipped. |
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
```

### Profile files

`app/profiles/<id>/`. Each installer contains exactly one profile.

| File | Contents |
| --- | --- |
| `profile.json` | Names, port, OBS scene prefix, `league` (name, import hint, `site` and LeagueOS `id` for standings), home team, colours, asset file names, stinger (file, transition point in ms, track matte), music track, `leagueScenes`, `backgrounds` (list and per-view defaults), `headlineFonts` (list and default), defaults, installer identity (app id, package name, artifact name, update channel) |
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
