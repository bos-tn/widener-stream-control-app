# Messiah Esports profile

Beta only. Stable builds retain the assets but lock this profile in the
installer, picker and launch/switch paths. Saved profile data is kept.

This team profile runs on localhost port 4330, uses the `MU:` OBS scene prefix,
the `Messiah Stream` scene collection, and the separate
`messiah-stream-control` data folder. It uses the existing broadcast package,
including optional This Week, Matchup, Crowd Cam, and Comp Room scenes. Camera
addresses are empty until the operator enters them. The league feed is empty
until the operator follows a LeagueOS page.

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
scene keeps its transparent scoreboard over game capture.

Assets in `assets/guide/` are the eight SVG/PNG esports treatments extracted
from page 51 of Messiah Athletics' 2026 identity guide. `logo.png` and the
backgrounds use the blue-white guide artwork. `panel-logo.png` and the app icon
are lossless PNG conversions of the project-supplied LeagueOS image. Hanken
Grotesk is OFL licensed; its notice is in `assets/fonts/`. The generated
stinger is a 1.22-second alpha WebM with a 590 ms transition point. It is
optional in OBS until the operator creates and configures `Messiah Stinger`.

The identity guide asks users to obtain production
artwork and permission from Messiah Athletics before public reproduction.
