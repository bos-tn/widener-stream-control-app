# Scoreboard implementation test branch

Branch: `codex/scoreboard-overhaul`

Target release: **2.5.0**. Current test build: `2.5.0-beta.1`. Based on the
released `v2.4.0` Messiah profile commit. The scoreboard overhaul is a separate
release from Messiah 2.4.0.

All six companion scoreboards from [the research guide](scoreboard-research.md)
are implemented on the shared server-owned series engine. Supported profiles:

| Game | Widener | LotE | Messiah | Style |
| --- | --- | --- | --- | --- |
| VALORANT | Yes | Yes | Yes | `valorant` |
| Overwatch | Yes | Yes | Yes | `overwatch` |
| Marvel Rivals | Yes | Yes | Yes | `rivals` |
| League of Legends | Yes | No | Yes | `league` |
| Rainbow Six Siege | Yes | No | No | `siege` |
| Call of Duty | Yes | No | Yes | `cod` |

These are manual **companion** boards. The native spectator HUD owns rapidly
changing gameplay data. No unqualified telemetry, invented clocks or automatic
map finishes are used. Rocket League and Smash retain their existing paths.

## Trying VALORANT

From `app/`, run `npm run design:scoreboard`, or append `-- lote` or
`-- messiah` to try another profile. Open
`http://127.0.0.1:4396/control?page=live` for the controls and
`http://127.0.0.1:4396/overlay?view=scoreboard&backdrop=1` for the preview.

This demo uses a new temporary data directory, port 4396, no local camera
defaults, no league/media downloads, and no automatic OBS connection. Stop the
process before starting another profile. It does not need a running game or OBS.

For an ordinary match, select VALORANT on Match, then use the Live page:

1. Choose BO1, BO3, BO5, BO7 or BO9 and enter the current map name. Name future
   maps under Map schedule and results.
2. Assign the native HUD left team and attacking team independently. Use Swap
   attack and defense at halftime without moving the teams' series results.
3. Start map. Technical pause and Tactical timeout change the broadcast label;
   they do not pause the actual game and do not invent a running game clock.
4. Finish map marks its result pending. Select the winner, optional final round
   scores, and result type, review the preview, then Confirm result. Forfeits and
   admin rulings can be recorded before a map starts.
5. Next map advances without awarding another win. Once a team reaches the
   first-to target, advancement stops. A draw awards no win and can require
   additional map slots.
6. Correct or void a completed result under Map schedule and results. Void and
   remake current map keeps its slot and creates a numbered replacement attempt.
   Undo restores the last change, including both the map result and series score.

Board visibility and placement controls show recent map history, hide the
board, or adjust scale and insets. The existing Scoreboard settings chooses its
corner. The default is bottom left, raised above the ticker. Preview against the
actual observer HUD before broadcasting; placement is a starting layout, not a
verified safe area for every spectator HUD variant.

The normal score shortcuts 3 and 4 select a winner for review; they do not
silently award a map. Old absolute score messages and legacy Stream Deck score
routes cannot change any of the six managed records. Rocket League, Smash and other generic games retain their routes.

## Trying Overwatch

Run `npm run design:scoreboard -- widener ow` from `app/` (substitute `lote`
or `messiah` for another profile). Controls are at
`http://127.0.0.1:4391/control?page=live` and the board is at
`http://127.0.0.1:4391/overlay?view=scoreboard&backdrop=1`.
It uses a new temporary data folder and can run beside the VALORANT demo.

Select Overwatch for an ordinary match. Its BO5 preset is first to three map
wins. The board shows maps won, current map/mode, optional recent results,
confirmed hero bans and pause/result status. Native objectives, clocks,
overtime, hero portraits, ultimates and the kill feed stay in the game HUD.

1. Confirm the format and map rotation with the organizer. Control, Hybrid,
   Push, Flashpoint, Escort is a starting college example, not an official
   NECC, LotE or universal OWCS preset. Change the current mode or each pending
   mode in Map schedule and results. Names do not reset selected modes.
2. Enter optional text hero bans before starting each map. Each field identifies
   the team's submitted ban; opponent applicability follows the event rules.
   Bans appear on the board and remain in the attempt's history. No hero catalog,
   draft order or series restriction is enforced automatically.
3. Assign native HUD left independently of school identity. Attack/defense is
   available for Hybrid and Escort. It clears when advancing or remaking a map
   so the next payload map does not claim a stale attack assignment.
4. Confirm only the completed map. Optional results use Control subrounds (2 to
   win), Flashpoint points (3 to win), or Push distance in meters (up to two
   decimal places). Hybrid and Escort use per-team text progress/time summaries,
   such as `3 checkpoints, 1:24 left`. The operator confirms the winner; payload
   text is retained for review and is not used to calculate a winner.
5. A Draw occupies a played slot and adds no win. After five maps, a 2–2 score
   advances to map six, labeled Tiebreaker. Extra slots default to Control;
   Extra map default mode changes future appended slots, and any ready slot's
   mode remains editable. More draws can create more slots until a team clinches.
6. Corrections, voids, undo, forfeit/admin results and recovery work through the
   same versioned commands as VALORANT. A remake keeps the map name/mode but
   clears its bans for reconfirmation; the void attempt retains its old bans.

The compact board is intended for gameplay; show map history during breaks.
It defaults to bottom left above the app ticker. Its mode and optional ban rows
are included in camera/lower-third reservations. Check the corner and insets
against the actual spectator HUD before using it on air.

## State and compatibility

`app/series.js` owns versioned map attempts and rules. `POST /api/series` accepts
commands with `seriesId` and `revision`; stale requests return HTTP 409 with the
latest state. The route checks the app's Host and Origin and remains on the
existing localhost server. Duplicate confirmation cannot award another map.

The existing profile `state.json` stores the record and the last 20 undo
snapshots with the existing atomic-save and backup behavior. Confirmed results
survive restarts. A restored live map requires operator review and a fresh start
or a reviewed result; it does not automatically claim play has resumed. There is
no game telemetry or gameplay clock in this first release.

`scoreboard.scoreA`, `scoreB`, `bestOf`, and `swap` are compatibility projections
for the broadcast package and result graphics. Gameplay round scores live in map
results. Legacy scores for all six games migrate as labeled opening wins without
inventing map details. A newly selected game starts a fresh managed record.
Loading or importing another match clears the previous record and its undo
history after an operator confirmation when it contains play/results. Saved
matches retain competition settings and the map/mode schedule, including Call of
Duty title/season and League side choices. Results, live state, and played drafts
are not imported into a new match. Versioned setup commands cannot replace live play.

The shared engine has a neutral map mode field and supports draws, voids,
forfeits, administrative outcomes, corrected results and extra map slots. Game
specific adapters and ruleset catalogs can extend it without replacing the
existing OBS scene and browser-source model. New modules and public assets are
included by the installer file list.

## Verification

- `npm run test:series` checks engine rules, duplicate and stale commands,
  Host/Origin restrictions, result persistence and review, score compatibility,
  mock OBS scene creation and the Rocket League/Smash paths across all profiles.
- `npm run test:series:visual -- <output-folder>` runs actual control-panel
  actions in hidden Electron windows, renders each profile at 1080p and 720p,
  checks narrow control layouts, and saves screenshots and a JSON report.
- Add `ow` after the visual output folder to review Overwatch, including a
  drawn Hybrid map, decimal Push results, narrow schedules and a sixth-map
  tiebreaker. Without it, the visual command reviews VALORANT.
- Run `npm run test:broadcast`, `npm run test:messiah`, and `npm run test:feed`
  for the existing shared behavior.

Live verification remains: current spectator HUD overlap for all six games, OBS capture
alignment, simultaneous school branding and native team sides, and broadcast
delay alignment. This work has not connected to real OBS or changed a live game.

## Marvel Rivals

Run `npm run design:scoreboard -- widener mr` (port **4392**). BO5 starts with
Domination, Convoy, Convergence, Domination, Convoy, as an editable college
example. Extra slots require an explicit organizer-approved mode.

Separate bans and protected locks use comma-separated hero labels. A locked hero
cannot be banned by either team. Confirm the draft in tournament-room order;
there is no hardcoded hero catalog. Domination results use completed subround
scores (2 to win); Convoy and Convergence use optional per-team progress/time
summaries. Draws award no win. Remakes retain the void draft in history and clear
current bans, locks and attack assignments. Map picker and side chooser are
explicit setup fields. Native objective calculation remains authoritative.

## League of Legends

Run `npm run design:scoreboard -- widener lol` (port **4393**), or use Messiah.
The board labels **GAMES**, current game, blue/red sides and draft status.
Assign blue/red for every game; HUD left/right is independent of school identity.
A new game or remake requires sides to be confirmed again.

Optional draft is a separate control panel. Enter champions in confirmed player
order, distinguish draft bans from Fearless exclusions, then confirm final trades.
Changing champions or bans clears that confirmation. Fearless can be off, own-team,
or global; exclusions derive from previous completed played games, excluding void
attempts. Champion labels are matched ignoring case. An admin can explicitly carry
a draft into a remake, but trades and sides still require confirmation.

Confirm the game winner only. Kills cannot be entered as a game score. No lobby
return, disconnect or missing client data awards a win. The native HUD continues
to show kills, gold, towers, objectives and clock. The documented Live Client Data
API feasibility study remains optional future integration work; this release does
not connect to it or estimate team gold.

## Rainbow Six Siege

Run `npm run design:scoreboard -- widener r6` (port **4394**). The board shows
maps won, active map, phase/rehost label and optional break history.

Before play, configure even regulation rounds, overtime target, required score
difference, overtime round cap (0 means unlimited), and overtime side rotation.
The starting research example is 12 regulation rounds, target 8, difference 2 and
a 3-round overtime cap: 7–5, 8–6 and capped 8–7 finish; 7–6 does not. Unlimited
win-by-two can continue to 10–8. Optional final rounds must match the configured
completion rule. Admin/forfeit outcomes remain explicit overrides.

Map picks, side chooser, optional operator bans, HUD ordering, attack/defense and
current phase are separate. Side changes retain phase history with the attempt.
**Admin continuation / rehost** stores valid partial scores and the admin instruction
inside the current attempt, adds a technical-pause label and awards no map.
Resume when approved and confirm the entire map once; final numeric scores cannot
discard retained play. A full replay uses **Void and remake**, keeping the void
record and creating a new numbered attempt. Pro League HUD stays visible.

## Call of Duty

Run `npm run design:scoreboard -- widener cod` (port **4395**), or use Messiah.
A title and season are required before starting. Choose a research example or
enter custom values; title rules cannot change after play starts. The examples
are Black Ops 7 college (Hardpoint / Search and Destroy / Overload), a custom
Control title, and the announced Modern Warfare 4 2027 Hijack example. These are
not verified NECC/LotE presets. The BO7 grand-final order is editable rather than
claimed as a universal rotation. Edit pending modes to match the organizer.

Add a custom mode and result unit without code changes. A confirmed comma-separated
legal pool can be entered per mode; a map outside that pool cannot start. Map
picker and side chooser are recorded independently. Hardpoint results are points,
Search and Destroy and Control results are rounds, and other modes retain their
objective score/custom unit plus an optional per-team final summary (including
remaining lives when the event uses them). No old title's target auto-finishes play.
Rehost continuations and full replay attempts work as described for Siege.

## Shared presentation and competition setup

**Competition rules and source** stores Custom/NECC/LotE organizer, season,
rulebook version, document URL and verification date. Selecting an organizer
never invents an official ruleset. Confirm the actual event's requirements.

The 560px companion defaults to the lower left above the ticker. Insets, scale
and the existing corner choices support observer capture variants. **Show recent
map history** expands the break board to 1000px and includes up to nine ordered
attempts/slots, enough for BO7/BO9 schedules. Longer remake histories show the
current neighborhood; the control panel retains every attempt. Starting a map
collapses break history. Camera and lower-third reservations include board height;
wide break boards reserve both adjacent corners conservatively. All geometry
remains a prototype until checked over actual observer frames.

## Verification results (October 20, 2026)

- `npm run test:series`: **202 checks passed**. Engine, real HTTP/WebSocket commands, persistence,
  stale/duplicate protection, saved setup, legacy migration, all supported profile
  paths and mock OBS scene builds. Includes League trades/Fearless/remakes,
  Siege capped/unlimited overtime/rehosts and CoD title/mode/custom-season rules.
- `npm run test:series:visual -- <output-folder> <game>` accepts `val`, `ow`,
  `mr`, `lol`, `r6`, or `cod`, and tests every profile supporting that game.
  Actual panel actions, saved-match loading, 1080p/720p overlays, narrow panel and
  schedule overflow, missing opponent logo and long names are checked in Electron.
  Screenshots and JSON reports are under `artifacts/scoreboards/<game>/`.
- Broadcast (116 checks), player cameras (40 checks), Messiah, profile and league-feed regression suites pass. Rocket League and
  Smash compatibility is also checked by the series suite.

Live data adapters are a separate milestone. Real game HUD/camera overlap,
capture alignment, native side colors, tournament-room behavior and broadcast
delay alignment still require live observer/OBS verification. No real OBS
connection, scene collection or installed profile data was changed by these tests.
