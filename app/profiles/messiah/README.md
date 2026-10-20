# Messiah Esports profile

This team profile runs on localhost port 4330, uses the `MU:` OBS scene prefix,
the `Messiah Stream` scene collection, and the separate
`messiah-stream-control` data folder. It uses the broadcast package with
optional This Week, Matchup, three player camera scenes, and a Player Cams
scene that shows all three feeds in landscape 4:3 windows for timeouts. Crowd Cam and Comp Room have
been retired; a scene rebuild removes their old OBS scenes and sources. The
LeagueOS Match Preview scene is excluded; use Messiah's Matchup scene instead.
Camera addresses are empty until the operator enters them. The default league
feed follows Messiah University's NECC and League of the East calendars and
shows only Messiah matches for the current Monday-to-Sunday week. It supplies
the Match page's League feed, This Week scene, ticker and other-match cards,
just as Widener's feed does. New installs follow both calendars automatically.
This update also adds them to existing beta installs, including an empty feed
marked as already configured or a feed containing only an imported season.
Other follows and saved matches are kept. Later deliberate clears stay cleared.
**Broadcast >
League feed > Default feed** restores both calendars. **Build scenes** creates
**MU: This Week** when This Week is selected under Match > Details.

Set Player 1, Player 2, and Player 3 under **Broadcast > Cameras**. A source can
be a local capture device or a network camera link. Build scenes after setup.
**Broadcast > Cameras > Player cameras** enables automatic Rocket League
windows (off by default). Camera numbers follow the home roster order. A home
player POV opens only that player's window at bottom left, 384 x 216, labelled
with the roster gamertag. An opponent or no match closes it. A goal replay
opens all three stacked on the left, first player on top; replay end restores
only the POV camera. Changes settle for 250 ms before the frames move, then
OBS follows after the frame delay.

Automation disables the manual **Show window** buttons and Live > Score's
**Player POV camera** selector. Turning it off closes player windows and
restores manual selection, which replaces the previous window. Window
position and size apply in manual mode. With automation on, a build includes
all three solo camera scenes and their sources. The panel marks the scene
difference when a build is needed. With it off, the optional scene choices
control what gets built; the timeout group stays independent.
**MU: Player Cams** is the three-feed timeout scene. Map each numbered camera
to the same seat for the whole match.
The timeout scene can be built on its own without enabling the solo scenes.
Its transparent openings and OBS crop rectangles both come from
`broadcast.cameraGroup.frames` in `profile.json`, scaled to the OBS canvas.

Five animated backgrounds from `design/messiah/` are built into the profile:

| Plate | Profile choice | Default scene |
| --- | --- | --- |
| 30 Wordmark Flood | `plate-30` | Be Right Back |
| 25 Ghost Falcon | `plate-25` | Starting Soon |
| 08 Tailwind | `plate-08` | Matchup, Post-Match |
| 01 Prism Current | `plate-01` | Rosters, This Week, league graphics |
| 05 Wing Wake | `plate-05` | Rocket League Stats |

Every non-gameplay scene can select any of the five backgrounds in the Live
page. The renderer copies the concept gallery's Canvas drawing code. It draws
only the selected plate at up to 30 fps, in an eight-second loop. The logo and
wordmark in plates 25 and 30 stay steady without shine sweeps. The Gameplay
scene keeps its transparent scoreboard over game capture. Messiah's scene
layout uses a vertical identity spine, separate team cards, vertical lineup
lists, translucent surfaces and cool light gradients. The large background
mark occupies the artwork column and is suppressed behind matchup, roster,
result and stats content. Left/right layout changes swap the hero columns.
Long copy fits within bounded slots; rosters with more than eight players
rotate every eleven seconds so substitutes remain visible. The timeout
camera scene and game graphics use the same visual language. Those elements
are profile-specific.

`npm run test:playercams` checks POV matching, replays, debounce, roster changes,
manual/automatic handover and optional scene builds with mock OBS and a TCP
Stats API feed. `npm run test:stats-entrance` checks the stats row hold and OBS
entrance in the renderer for every profile. A live game, live OBS and real
camera signals have not been checked for these ports.

`npm run test:messiah` checks the profile against mock OBS, including 720p
and 1080p crops, rapid POV switching, camera source changes and retirement
of old scenes. `npm run test:messiah:visual -- <output-folder>` captures the
scenes in Electron with isolated temporary data, checks text and collisions,
and verifies that the timeout camera openings are transparent. It also covers
long names, blank teams, large rosters, both hero orientations and all plates.
`npm run test:headlines` checks that headline and team-name sizes stay fixed
on page load and throughout repeated OBS entrances with incoming state updates.

Assets in `assets/guide/` are the eight SVG/PNG esports treatments extracted
from page 51 of Messiah Athletics' 2026 identity guide. `logo.png` and the
backgrounds use the blue-white guide artwork. `panel-logo.png` and the app icon
are lossless PNG conversions of the project-supplied LeagueOS image. Hanken
Grotesk is OFL licensed; its notice is in `assets/fonts/`. The generated
stinger is a 1.22-second alpha WebM with a 590 ms transition point. It is
optional in OBS until the operator creates and configures `Messiah Stinger`.

The identity guide asks users to obtain production
artwork and permission from Messiah Athletics before public reproduction.
