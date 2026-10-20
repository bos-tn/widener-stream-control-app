# Game Scoreboard Design and Operations Guide

Esports Stream Control | Research and implementation recommendations | October 19 2026

## Recommendation and scope

Build six game-specific scoreboard presets on one shared series engine. Ship a reliable manual operating workflow first, retain each game's native spectator HUD for rapidly changing gameplay information, and add live data only where it works in an actual tournament observer session. The first release should improve team identification, series context, map history, pauses, and results without requiring another person to type every gameplay event.

The supported game lists in the current working tree establish the scope below. Rocket League and Super Smash Bros Ultimate are excluded. Messiah is included because it is already present in the working tree.

| Game | Widener | LotE | Messiah | Current default |
| --- | --- | --- | --- | --- |
| VALORANT | Yes | Yes | Yes | BO3 maps |
| Overwatch | Yes | Yes | Yes | BO5 maps |
| Marvel Rivals | Yes | Yes | Yes | BO5 maps |
| League of Legends | Yes | No | Yes | BO3 games |
| Call of Duty | Yes | No | Yes | BO5 maps |
| Rainbow Six Siege | Yes | No | No | BO3 maps |

All six currently use the generic top-left series board. In `app/server.js`, the supported styles are `standard` and `rl`; the shared score fields represent series wins. The app does not currently have six separate gameplay score integrations. Sources for this inventory are the three `app/profiles/<id>/games.json` files, `app/server.js`, `app/templates/overlay.html`, and the current README.

### What the research establishes

Competitive rules define map selection, side selection, draws, observer access, and final results. Professional production adds a separate presentation layer. Riot's LCS HUD article explicitly describes an application feeding live data into the top bar; its MSI 2025 update reorganizes match information and objectives. Those are useful design precedents, but access to a professional broadcast's data infrastructure must be evaluated separately. [S1] [S2]

The layouts, dimensions, controls, rollout order, and state model in this guide are recommendations for this app. League settings attributed to sources are examples of documented practice, not universal rules. Use the actual match organizer's current rules ahead of a comparison league or a game's ranked defaults. In particular, create distinct NECC, LotE, and custom competition presets and attach a rulebook version to each.

### Recommended first build order

1. Shared series engine, map history, explicit side mapping, and undo.
2. VALORANT, then Overwatch and Marvel Rivals, which serve all three profiles.
3. League of Legends, with a small separate feasibility study for local observer data.
4. Rainbow Six Siege and Call of Duty, using the same engine with their own rules and layouts.

## How competitive broadcasts should be operated

### Separate the observer from the graphics operator

An observer chooses player perspectives and camera views in the game client. A producer chooses OBS scenes and cues graphics. A score operator maintains the series record, maps, sides, and confirmed results. One person can combine producer and score duties for a school broadcast, but requiring that person to maintain health, ultimate charge, objective percentages, and a game clock would make the system fragile.

Riot documents production pipelines in which observer video, cameras, audio, graphics, and replays are assembled into a broadcast feed. Blizzard's historical World Cup viewer guide also documents dedicated observing controls and advice from an Overwatch League observer. These support the separation of camera operation and presentation; the exact staffing plan here is a recommendation for a smaller crew. [S3] [S4]

### Recommended match night workflow

1. Before the show, load teams and rosters, choose the game and competition ruleset, set the first-to target, and enter confirmed maps or mode slots. Set observer permissions and required stream delay from that league's rules.
2. In a private lobby, confirm which actual team is on each native HUD side. Select the matching layout and inspect a preview over the captured game. Verify names, colors, logos, and score units.
3. Start the map explicitly. During gameplay, the native HUD owns the clock and objective. The app shows team branding, series wins, current map, and only approved contextual graphics.
4. At halftime or an attack/defense change, update the side assignment only when needed. A side change must never transfer a team's score or map history to its opponent.
5. When the map ends, read the game result or receive the official ruling. Select the winner, enter an optional final gameplay score, and confirm the map once. The app updates series wins and records the result together.
6. During the break, show map history, confirm the next map and sides, and then start it. Stop advancement when the series is won unless an operator explicitly starts an exhibition or corrects a ruling.
7. For a remake, mark the attempt void and restart that map. For a forfeit or administrative decision, record that result type explicitly. Retain an audit record and an undo action.

### Delay and authority

All overlay information must match the video moment viewers see. A delay applied to the entire composed OBS output delays video and overlay together. A delayed spectator client combined with an earlier data feed requires a separate synchronization buffer before compositing. Do not add two delays accidentally or reveal a winner while the delayed game is still playing.

For example, the current PlayVS college general rules require a 90-second delay and set conditions on external observers, official program channels, and separation from players. Marvel Rivals' official Tournament Room guide describes different spectator access types and an approximately 40-second delay for standard outside-room spectating. Those are different mechanisms and neither number should become a universal app default. [S5] [S6]

## Shared visual and control specification

### Build a companion layer around the native HUD

The permanent app layer should answer: who is playing, who leads the series, which map or game is active, and what stage of the match is underway. Native game elements should continue to answer: who leads this map, how much time remains, who is alive, and what is happening to the objective.

Use two clearly named rendering modes. **Companion** retains the complete native HUD and adds the series information in a verified free area. **Integrated** replaces only specific HUD regions after data coverage and capture alignment have passed testing. Companion is the default for every game in the first release.

### Starting geometry at 1920 by 1080

Treat the following as prototype budgets, not proven safe coordinates. Save offsets and scale per game and observer HUD variant after testing actual screenshots. There is no universally safe corner across all six games.

| Component | Starting budget | Required behavior |
| --- | --- | --- |
| Compact series strip | 420 to 560 px wide and 64 to 88 px high | Two logos or tags, labeled series score, current map |
| Map context line | Up to 560 by 32 px | Map name, mode, ordinal, optional pick marker |
| Expanded map history | Up to 1000 by 100 px | Breaks and setup only; collapse for active play |
| Pause label | Within the existing strip footprint | Technical or tactical; duration only when authoritative |
| Team typography | 24 to 30 px names and 32 to 40 px score | Use tags when names do not fit; inspect at 720p |

Use opaque dark surfaces behind critical text, tabular numerals, and restrained team-color accents. Keep school brand colors separate from the game's team colors. Pair side colors with text or an icon, such as ATK, DEF, BLUE, or RED. A color change alone must not imply a team identity change.

Animations should be brief and confined to the board. Reserve large win graphics and the full map strip for breaks. Gameplay tickers, pop-ups, camera windows, and lower thirds must share a layout exclusion map with the scoreboard; a board that avoids the HUD can still collide with another app graphic.

### Controls every game should share

Provide Start map, Finish map, Draw, Void attempt, Next map, Edit result, Undo, Assign HUD sides, Show history, Hide board, and Technical pause. Show the current map prominently next to its controls. Distinguish **maps won** from **rounds won** or **points** at every input. Ordinary scoreboard edits can retain the app's immediate update behavior; finishing a map should be a single explicit transaction with a review of winner and final score.

Use a clear control-panel state: Ready, Playing, Paused, Awaiting result, Map final, Series final. Keep correction and reset actions separate. Add a preview of the final map result before confirmation and prevent accidental double submission. These are proposed controls, not current app features.

## VALORANT scoreboard

### Competitive reference

VCT's official 2025 review describes a redesigned broadcast HUD with clearer cues, an updated round timeline, scoreboard, and clutch presentation. As a collegiate operating example, PlayVS specifies BO3, Tournament Mode, win-by-two overtime, a map veto with side choice, and two 60-second tactical timeouts per team per game. [S7] [S8]

### Recommended board

Build a compact tactical shooter series strip with team logos and tags, large **series maps won**, BO3 or the configured format, active map, and a small map history. Keep the native round score, phase timer, spike status, player cards, minimap, and kill feed visible. A full VCT-style player panel should be a later integration, not a prerequisite for a better board.

Prototype the strip in a lower outer region that the selected observer HUD leaves free, with the bottom corners evaluated first. Avoid treating the existing top-left placement as safe because of the minimap. The lower player card can also occupy the apparent free area; approve placement on actual observer frames. Offer a narrow alternative under a verified free native team-name area when a corner fails.

Example app readout: **WU 1 | MAPS | 0 OPP** with **MAP 2  •  ACTIVE MAP  •  BO3** below. The native HUD separately shows an illustrative **9–7** round score. If a later integrated board includes rounds, make rounds the larger current-map value and maps a smaller labeled value; never display two unlabeled scores.

### Operation and state

Before map one, enter the veto results and map picks, then assign each team to the native HUD left or right and attacker or defender. Store team identity, display position, and attack role independently. At halftime, a role change need not imply moving the teams on screen. Make the mapping follow the actual observer client, including overtime.

The operator confirms map results from the game or admin. Store an ordered optional round history with a team winner, side, and outcome, but make manual entry optional. Show a tactical timeout label only when called; the app timer is a graphic and does not pause the game. Distinguish tactical timeout from technical pause.

### Integration and release boundary

Riot's public VALORANT API documents content, match records, match lists, ranked standings, and status rather than a documented live observer event stream. Its data policies also govern player stats and opt-in. Overwolf documents game events, but specifically warns that `match_end` does not work in custom matches or training. Use that as a concrete reason to test tournament sessions before promising automatic map completion. [S9] [S10]

**First release:** manual series and map management with the native HUD. **Later:** an approved provider or tested observer companion. Accept the board only after checking a halftime change, extended overtime, a timeout, remake, duplicate finish, and a decisive map without covering the HUD.

## Rainbow Six Siege scoreboard

### Competitive reference

The BLAST R6 global rulebook describes multiple possible series lengths, while the PlayVS college example specifies BO3, the Pro League HUD, 12 regulation rounds, a side swap after six, and three overtime rounds. Ubisoft's historical caster HUD release describes native player identification, health feedback, drone information, and defuser presentation. [S11] [S12] [S13]

### Recommended board

Build a tactical shooter companion using the same series components as VALORANT, with Siege-specific labels and map history. Show team logos or tags, **maps won**, active map, BO format, and an optional small ATK or DEF marker when it adds information that is not already clear on the native HUD.

Keep the native round score and timer, operator roster, ban presentation, alive counts, kill feed, and defuser state. Do not paint over the Pro League HUD simply to use a wider school-branded bar. Prototype a narrow bottom outer strip and compare it against both first-person and overhead observer views; the native observed-player card can occupy the lower center. Save the winning placement with the exact HUD configuration.

Example app readout: **WU 0 | MAPS | 1 OPP**, followed by **MAP 2  •  ACTIVE MAP  •  BO3**. An illustrative **6–6** native round score is not a series tie; it is the current map entering overtime under the selected rules.

### Operation and state

Enter the vetoed map order, picks, and starting sides before going live. Store attack and defense assignments for regulation halves and overtime independently from team identity. Keep the history attached to the actual team even if the observer HUD rearranges its sides.

Represent a map's regulation settings, overtime cap, required score difference, and overtime side rotation in the competition preset. Support a capped overtime finish; a generic unlimited win-by-two check would be wrong for some Siege competitions. A first-to-seven shortcut is also insufficient when the map reaches overtime.

The operator should finish the entire map once, not once per half. Record the final round score, winner, map pick, and result type. For a rehost, retain the valid score and rounds as instructed by the admin; allow a replacement attempt without awarding another map. Keep bans as optional setup or break graphics, not permanent content over live play.

### Integration and release boundary

Overwolf documents Siege match, round, and roster events. That documents a possible integration surface, not proof of complete custom-lobby observer coverage. [S14] Make a proof of concept verify both teams, role changes, rehosts, and final results on the current patch before giving it authority.

**First release:** manual map results and series control with Pro League HUD retained. **Later:** tested local event adapter, with confirmation for finishes. Accept after checking regulation, capped overtime, a rehost with retained score, a role swap, and each observer camera view. Siege is enabled only in Widener's present game list.

## Overwatch scoreboard

### Competitive reference

OWCS is Blizzard's current professional circuit; use its present event rules rather than assuming historical Overwatch League formats. The current PlayVS college example is BO5 with Control, Hybrid, Push, Flashpoint, and Escort slots. Draws can leave the series tied after five maps, requiring extra Control maps until a team reaches three wins. It also specifies per-map hero bans. [S15] [S16]

### Recommended board

Build a compact hero shooter companion with team logos or tags, large **maps won**, active map and mode, and a map history that supports a visible DRAW result. The current map should have a distinct marker; future slots should look pending, never like losses.

Leave the native objective, clock, overtime indicator, hero portraits, health and ultimate status, observed-player information, and kill feed visible. Prototype a lower outer strip, evaluating both corners because the observer HUD and player camera arrangements vary. Use an expanded map schedule only during breaks. Do not place a full-width school bar across the native team and objective strip.

Example app readout: **WU 2 | MAPS | 2 OPP** and **TIEBREAKER  •  CONTROL  •  FIRST TO 3**. In map history, **DRAW** occupies a played slot but awards no series win. The game count and the win count are different quantities.

### Operation and state

Set the match as first to the configured number of map wins and keep an ordered map-attempt list of arbitrary length. Map one through five can follow the selected competition rotation; an extra map is not automatically an error. Make the actual event rotation configurable, since other organizers can use different selections.

Between maps, enter the selected map and the opposing team's side choice. Record hero bans per map, and track any series restrictions only when the chosen ruleset requires them. Keep hero portrait assets optional so the board still works with text if assets lag a patch.

When a map finishes, choose A win, B win, or Draw. A Control subround, an Escort attack completion, or a side transition must not award a series map. Store final results as mode-specific values: Control subround wins, payload progress and time, or Push distance. Do not force every mode into one generic points field.

### Integration and release boundary

Overwolf documents Overwatch match, roster, and kill-feed information, but its documentation includes restrictions on some roster data and a Stadium-only round outcome field. It does not establish a ready complete OWCS graphics feed for this app. [S17] Keep the native HUD responsible for live objective calculation.

**First release:** series wins, modes, map history, draws, bans, and break graphics. **Later:** tested observer data for selected fields. Accept only after a drawn map, sixth-map tiebreaker, attack/defense transition, overtime, and a new map start that clears old objective data without clearing series history.

## Marvel Rivals scoreboard

### Competitive reference

The official Ignite 2026 rules use different BO3, BO5, and BO7 formats by stage. Their map selection starts with Domination and then uses a loser-selection process across available modes; it is not the same as every college rotation. The PlayVS college example specifies BO5 with Domination, Convoy, Convergence, Domination, and Convoy. [S18] [S19]

The official Tournament Room guide documents room access, spectating, pause permissions, and Ban/Pick options. Its pause controls distinguish the actual game's state from a spectator's timeline position. Build around the actual observer workflow instead of assuming that a producer's pause graphic controls the room. [S6]

### Recommended board

Use the hero shooter foundation from Overwatch with Rivals-specific mode labels and draft state. Show school logos or tags, **maps won**, active map and mode, and a compact map history. Keep selected map, map picker, and side chooser as explicit setup values.

Retain the native six-player team status, objective progress, clock and overtime, kill feed, and observed-player information. Prototype a narrow lower outer strip and verify it in the actual tournament observer interface. Match the native side colors with small secondary markers; school identity remains consistent throughout the series.

Example app readout: **WU 1 | MAPS | 1 OPP**, with **MAP 3  •  CONVERGENCE** beneath. Domination round wins belong to the active map, while the series score counts completed maps. Finishing one attack in Convoy or Convergence must not finish the whole map.

### Operation and state

Before play, select the room format, map sequence rules, Ban/Pick variant, observer access, and pause permissions required by the organizer. Store hero bans and locks separately. A protected or locked hero must not be displayed as banned. The exact draft order should come from the selected competition preset.

After each completed map, confirm the winner and optional final objective summary. Present the next legal mode choices from the ruleset, with an override for an admin ruling. Support Draw, Void, and Remake without inventing a default tiebreak procedure; the organizer controls how unresolved results are settled.

Use mode-specific result fields for Domination subrounds, Convoy checkpoints and distance, and Convergence capture and payload progress. Native objective logic remains the source for live play. Keep previous-map data in the record while clearing the current-map display at the next start.

### Integration and release boundary

Overwolf's Rivals documentation includes roster information, banned characters, match outcomes including Draw, objective progress, and match and round events. This makes a local companion worth investigating, but observer and tournament-room coverage must be demonstrated. It is third-party provider documentation, not a NetEase promise of a public broadcast API. [S20]

**First release:** manual series and map controls, draft labels, and native HUD. **Later:** tested provider input for selected objectives and result suggestions. Accept after all three core modes, an attack/defense change, a drawn or void attempt, hero locks, and delayed spectating aligned with the graphic.

## League of Legends scoreboard

### Competitive reference

Riot's LCS HUD design emphasizes gold and critical match information; the MSI 2025 HUD groups match information and major objectives near the top center. These provide a hierarchy to study rather than a requirement to copy a particular season's artwork. [S1] [S2]

The PlayVS college example is BO3 on Summoner's Rift, Tournament Draft, lobby-only spectating, and Fearless Draft. The actual NECC or event rules should determine side choice and whether Fearless is in use. [S21]

### Recommended board

Build a series identity layer with team logos and tags, **games won**, current game ordinal, and blue/red assignment. Keep the native kills, gold, towers, objectives, game clock, minimap, player rows, and item display in the first release. Prototype compact team extensions beside verified free edges of the native top HUD, or one independent series strip in a free lower-left area. Validate against scoreboard panels, player cameras, and objective notifications.

Example app readout: **WU 1 | GAMES | 0 OPP** with **GAME 2  •  BLUE SIDE WU**. A later integrated top bar should prioritize gold alongside kills, then towers and objectives, with clearly labeled series wins at a smaller level. Do not make kills look like the match score.

### Operation and state

Assign teams to blue and red for every game. Store actual player identities independently from lobby order, champion selection order, and lane role. A side change must preserve the school's record and accumulated draft history.

Make draft a separate scene or panel. If Fearless is enabled, preserve the list of previously used champions according to the selected event's scope. Draft bans and Fearless exclusions must look different. Confirm final champion trades before the graphic settles into the starting lineup. The first release can use manually entered draft information or leave the native draft visible.

Confirm each game winner from the game or admin. A disconnect, return to lobby, or empty data response is not a win signal. A remake is a new attempt linked to the same game slot; the admin decides whether its draft or earlier state carries forward.

### Integration and release boundary

Riot documents a local HTTPS Live Client Data API, including `/liveclientdata/allgamedata`, and Data Dragon for versioned assets. Treat it as the strongest first-party integration candidate in this scope, while testing what is actually available in an observer session. Do not mistake active-player `currentGold` for total team gold or estimate earned gold by adding inventory prices. [S22]

The RCVolus observer tool and production toolkit provide useful implementation references for local observer and graphics workflows. Inspect current code and licenses before reuse. Historical LeagueBroadcast used memory reading and its repository warns of Vanguard incompatibility; it should not be adopted as a working full-HUD solution. [S23] [S24]

**First release:** manual games won, sides, game history, and optional draft. **Later:** documented local data for verified fields. Release a complete custom live HUD only after total team gold, objectives, pause behavior, side mapping, and spectator timing are correct; omit unsupported metrics.

## Call of Duty scoreboard

### Competitive reference

The game entry is simply Call of Duty, so it cannot identify the title or ruleset by itself. Current CDL competitive settings list Hardpoint, Search and Destroy, and Overload. The PlayVS Black Ops 7 example uses BO5, or BO7 for Premier grand finals, and a BO5 rotation of Hardpoint, Search and Destroy, Overload, Hardpoint, Search and Destroy. [S25] [S26]

CDL's October 14 2026 announcement says the 2027 Modern Warfare 4 season will instead include Hijack with Hardpoint and Search and Destroy. That is an announced future ruleset, not a reason to silently change an existing Black Ops 7 match. [S27]

### Recommended board

Build a mode-aware series companion with team logos and tags, **maps won**, title or season label, map name, active mode, and map ordinal. Show the full ordered mode schedule during breaks, marking the active slot. Reuse the same physical board across modes, but change labels and any optional gameplay fields.

Keep the native competitive spectator or CODcaster HUD responsible for the map's score, time, player status, minimap, kill feed, and objective. Activision's historical CODcaster feature description establishes the observer presentation pattern; current-client capabilities must be checked on the title being broadcast. [S28]

Prototype a narrow series strip beside a verified free edge of the native score area, with a lower outer alternative. Preserve the minimap and player statistics. A permanent full-width map schedule consumes too much gameplay space.

Example app readout: **WU 2 | MAPS | 1 OPP** and **MAP 4  •  HARDPOINT  •  ACTIVE MAP**. An illustrative native **210–190** is Hardpoint points. A Search and Destroy **5–4** represents rounds; neither should use the series map-win fields.

### Operation and state

Require a title and season at match setup. Load the competition's mode sequence, legal maps by mode, veto results, map picks, and side choices. Keep map names data-driven because pools change during a season.

Use a result type per mode: Hardpoint points; Search and Destroy rounds; Control rounds and remaining lives only for competitions that actually use Control; Overload or Hijack fields only for the matching title and rules. Keep an editable custom mode available so a new season does not require recoding the series engine.

At map completion, confirm the final score and winner, then advance to the next mode slot. Do not infer that reaching an old season's score limit always ends a map. Preserve valid partial results if an admin orders a continuation, and record full replayed maps as separate attempts.

### Integration and release boundary

A stats site or Warzone event integration is not evidence of a live competitive multiplayer observer feed for the selected title. Start with operator-driven map results. Evaluate a title-specific approved provider only against that exact game build, platform, lobby type, and spectator role.

**First release:** title and season presets, map/mode rotation, series score, and map history. **Later:** title-specific data adapter. Accept after switching between point and round modes, BO7 setup, a new season preset, a replayed map, and a series clinch that does not start an unused slot.

## Data integration decisions

### Compare the practical approaches

| Approach | Benefit | Limitation | Recommended use |
| --- | --- | --- | --- |
| Native HUD plus manual app layer | Works without a live-data contract | Operator confirms maps and context | Default release for all six games |
| Documented local game API | Direct access with limited external dependencies | Coverage can differ in observer mode | League of Legends feasibility study |
| Approved event provider | Can expose richer events and roster data | Runtime, distribution, licensing, coverage and patch dependencies | Optional tested adapter |
| OCR of visible HUD | Can suggest values without a game data feed | Font, effects, resolution and HUD changes cause errors | Suggestions with review, after core release |
| Publisher or event partner feed | May support a professional custom HUD | Access and capabilities require a specific agreement | Evaluate when such access is available |

**Do not build on an unverified private endpoint or process-memory reader.** A public match-history API and a website advertising real-time statistics do not establish access to current custom-match state. Provider game support must be checked per field and per observer mode, not just by the game's name on a compatibility list.

### Adapter qualification

For each candidate, record the provider, version, title and patch, distribution conditions, supported platform, custom-lobby support, observer support, field list, team identity semantics, clock origin, latency, and reconnection behavior. Replay a complete recorded series through the proposed integration before making it authoritative.

An adapter should publish capabilities such as map identity, team mapping, score, clock, objective, players, and final result separately. The UI should enable only proven capabilities. Map finish should initially be a suggestion the operator confirms. A future fully automatic finish needs a stable match/map identity, authoritative winner, duplicate suppression, and an audit trail.

### Failure behavior

Keep confirmed series results when a feed disconnects. Mark data health in the control panel, stop extrapolating clocks, and hide stale optional live fields. A proposed starting threshold is a warning after two seconds without expected high-frequency updates and hiding affected live fields after five; tune this per provider, since heartbeat timing differs from event timing. Silence is not a disconnect when a provider emits only on change.

Use match ID, map attempt ID, event ID or sequence, and source timestamp to reject stale and duplicate data. Manual overrides remain authoritative until the operator releases them or starts a new map. A reconnect must not overwrite a correction or increment the series twice.

## Implementation plan for the existing app

### Preserve the present application model

Keep the server as the owner of one match state, browser sources as renderers, and OBS as the owner of scene selection. Retain `/overlay?view=scoreboard` for compatibility. Do not duplicate the scene system for each game or make a general draft/push-live workflow a requirement for simple score changes.

Keep team and league brands, fonts, logos, assets, ports, and profile defaults inside `app/profiles/<id>/`. Shared scoreboard mechanics should work without the optional broadcast package; in particular, LotE needs all essential behavior without relying on `bx.js`. Messiah's theme overrides must not assume the generic or Rocket League markup is the only scoreboard structure.

### Proposed state model

| Object | Minimum fields | Purpose |
| --- | --- | --- |
| Ruleset | id, version, game, edition, winsRequired, modeOrder, drawPolicy, overtimePolicy | Competition behavior separate from artwork |
| Series | id, teamAId, teamBId, mapWinsA, mapWinsB, status | Stable team identity and confirmed result |
| Map attempt | id, slot, attempt, name, mode, status, winnerId, resultType, finalScore | Ordered record with draws, voids and replays |
| Side assignment | teamId, nativeSide, role, effectivePhase | Keep display position separate from identity |
| Presentation | layoutId, hudVariant, offset, scale, visible | Game and capture-specific geometry |
| Data source | provider, capabilities, lastHeartbeat, overrides | Honest data availability and corrections |

This is a proposal, not a description of existing fields. Keep current `scoreboard.scoreA` and `scoreB` as compatibility projections of confirmed series wins during migration. Never reuse them for round scores or objectives. Preserve existing Rocket League and Smash paths, including their reset and automatic series behavior.

Awarding a map should atomically finalize one attempt, recalculate series wins from valid final results, persist, and emit one updated snapshot. Starting a new map clears only live map fields. Starting a new series clears its history. A side swap updates the mapping and rendering, not the team records. Keep a revision number so two local control panels cannot confirm the same map twice.

### Code touchpoints and persistence

Extend validation and migration in `app/server.js`; scoreboard markup and rendering in `app/templates/overlay.html`; and game-aware controls in `app/public/control/control.js`, `index.html`, and `control.css`. Check scoreboard-related broadcast additions in `app/public/overlay-assets/bx.js` and profile theme CSS and scripts. Add new shared modules only when they simplify responsibility, and list any required new top-level `app/*.js` in `build.files`.

The current README says saved matches omit the score. Keep saved match setup separate from a resumable live series record. Persist confirmed results and in-progress state in a dedicated, versioned record in the profile's runtime data folder. On restart, restore the record for review and do not automatically trust an old live timer or source session.

Keep all control and ingestion listeners on localhost, preserve Origin and Host checks, and keep credentials out of browser state and source control. External adapters may be outbound clients without making the control panel remotely accessible. Follow the repo's isolated `STREAM_APP_DATA` and non-production port rules during implementation.

## Delivery milestones and acceptance

### Milestone one shared foundation

Deliver the series/map distinction, configurable wins required, map attempts, Draw/Void/Forfeit, side assignments, undo, persistence, and a preview over reference captures. Use the existing generic board as a fallback. Completion means these behaviors work in all three profiles before a new style depends on them.

### Milestone two six companion boards

Implement the six game presets and their fields, mode schedules, labels, and placement variants. Add break graphics using the same result record. Prioritize VALORANT, Overwatch, and Rivals because all profiles support them; move another game earlier if the actual broadcast schedule requires it. Each board can ship independently once its acceptance checks pass.

### Milestone three optional automation

Start with a short League of Legends observer-data experiment. In parallel as a workstream, rather than a release dependency, qualify provider support for the tactical shooters and hero shooters. Keep a manual path for every field required to run the show. Add OCR only when a specific operator burden justifies its maintenance cost.

### Required verification before each release

| Test area | Pass condition |
| --- | --- |
| Result integrity | Duplicate finish, undo, draw, void, remake and forfeit produce correct series wins |
| Identity | Side and role changes keep names, logos, scores and history attached to the right team |
| Rules | BO1/3/5/7, first-to targets, overtime and extra drawn-map slots obey the selected preset |
| Recovery | App restart, overlay reload and source reconnect preserve confirmed results without stale clocks |
| Presentation | No native HUD or app graphic collisions in representative live, pause, scoreboard and result frames |
| Readability | Long names, missing logos, similar colors and 720p output remain legible |
| Profiles | Widener and LotE paths pass; Messiah passes its own theme and geometry checks |
| Existing features | Rocket League automation, Smash stocks, scene builds and broadcast graphics still work |

Run the relevant mock OBS tests, including `npm run test:broadcast`, and add meaningful tests for the new result and migration logic. Use recorded state fixtures to verify each game's edge cases. No live OBS or game session was changed for this research task. Live checks still required for implementation include the current spectator HUD, actual capture geometry, observer data coverage, latency, and game-specific pauses and remakes.

### Decisions to lock before coding

Choose the first scheduled game, obtain the current NECC and LotE rulebook versions for that competition, capture its real observer HUD, and decide whether the first release needs only companion graphics or any integrated HUD region. For Call of Duty, also choose the exact title and season. These are implementation inputs; they do not prevent building the shared manual foundation.

## Source register

Sources accessed October 19 2026 in America New York. Historical sources are marked because their production concepts remain useful while their interfaces may have changed. Inline source IDs identify documented facts; recommendations elsewhere are the proposed design for Esports Stream Control.

- **S1** Riot Games, [Summer Broadcast Updates The HUD](https://lolesports.com/en-US/news/summer-broadcast-updates-the-hud), June 10 2020. Historical first-party account of LCS information hierarchy and a live-data application.
- **S2** Riot Games, [MSI 2025 Primer](https://lolesports.com/en-AU/news/msi-2025-primer), HUD section. First-party reference for top-center match and objective information.
- **S3** Riot Games, [Engineering Esports The Tech That Powers Worlds](https://www.riotgames.com/en/news/engineering-esports-tech-powers-worlds), 2019. Historical account of observer feeds and broadcast composition.
- **S4** Blizzard, [Overwatch World Cup Viewer A New Way To Experience Esports](https://news.blizzard.com/en-us/article/22639408/overwatch-world-cup-viewer-a-new-way-to-experience-esports), 2018. Historical observing controls and professional observer advice.
- **S5** PlayVS, [College League Competition Rulebook](https://help.playvs.com/en/articles/16193326-playvs-college-league-competition-rulebook), section 4.15 Broadcasting. College comparison for observer access, delays and broadcast separation.
- **S6** NetEase, [Marvel Rivals Tournament Room Guide](https://www.marvelrivals.com/match/20250422/41547_1229373.html), April 22 2025. Room settings, spectating delay, pause permissions and coaching views.
- **S7** Riot Games, [VCT 2025 Season Wrap Up](https://valorantesports.com/en-GB/news/vct-2025-season-wrap-up). First-party description of the Champions Paris broadcast HUD.
- **S8** PlayVS, [College League VALORANT Competition Rulebook](https://help.playvs.com/en/articles/16192034-playvs-college-league-valorant-competition-rulebook), sections 1.3 and 1.4. BO3, vetoes, overtime and timeouts.
- **S9** Riot Games, [VALORANT Developer Documentation](https://developer.riotgames.com/docs/valorant). Public API methods, player data policies and tournament policies.
- **S10** Overwolf, [VALORANT Game Events](https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/valorant/). Provider capabilities and the custom-match limitation on match end.
- **S11** Ubisoft and BLAST, [BLAST R6 Global Rulebook July 8 2025](https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/53GxmEddEWemHwz8BBbJpZ/392cb4bae1f69f8f67ff8af3f866dc32/BLASTR6_GLOBALRULEBOOK_2025_07_08_FINAL.pdf). Historical professional comparison; event-specific rules govern series format.
- **S12** PlayVS, [College League Rainbow Six Siege Competition Rulebook](https://help.playvs.com/en/articles/16192843-playvs-college-league-rainbow-six-siege-competition-rulebook), sections 1.3 and 1.4. Pro League HUD, rounds, overtime and vetoes.
- **S13** Ubisoft, [Operation Shadow Legacy](https://www.ubisoft.com/en-ca/game/rainbow-six/siege/news-updates/seasons/shadowlegacy), Caster HUD section, 2020. Historical native spectator information design.
- **S14** Overwolf, [Rainbow Six Siege Game Events](https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/rainbow-six-siege/). Third-party event schema; observer qualification required.
- **S15** Blizzard, [OWCS 2026 Season Competitive Details](https://news.blizzard.com/en-us/article/24246297/owcs-2026-season-competitive-details). Current professional circuit context.
- **S16** PlayVS, [College League Overwatch Competition Rulebook](https://help.playvs.com/en/articles/16192744-playvs-college-league-overwatch-competition-rulebook), sections 1.3 and 1.4. Mode rotation, draws, extra maps and hero bans.
- **S17** Overwolf, [Overwatch Game Events](https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/overwatch/). Roster restrictions and match and round data qualifications.
- **S18** NetEase, [Marvel Rivals Ignite 2026 Preseason and Stage 1 Rules](https://www.marvelrivals.com/Marvel_Rivals_Ignite_2026_Rules_Preseason_%26_Stage1_2026.3.13_V1.0.pdf), March 13 2026, version 1.0, sections V and XIX to XXII. Stage-dependent format and professional room and map procedures.
- **S19** PlayVS, [College League Marvel Rivals Competition Rulebook](https://help.playvs.com/en/articles/16192634-playvs-college-league-marvel-rivals-competition-rulebook), sections 1.3 and 1.4. College mode rotation, map choice and Ban-Lock workflow.
- **S20** Overwolf, [Marvel Rivals Game Events](https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/marvel-rivals/). Provider objective progress, bans, outcomes and events.
- **S21** PlayVS, [College League League of Legends Competition Rulebook](https://help.playvs.com/en/articles/16192287-playvs-college-league-league-of-legends-competition-rulebook), sections 1.3 and 1.4. Tournament Draft, side selection and Fearless Draft.
- **S22** Riot Games, [League of Legends Developer Documentation](https://developer.riotgames.com/docs/lol), Game Client API, Live Client Data API and Data Dragon. First-party local endpoints and static assets.
- **S23** RCVolus, [League Observer Tool](https://github.com/RCVolus/league-observer-tool) and [League Production Toolkit](https://github.com/RCVolus/league-prod-toolkit). Maintainer documentation for a possible reference architecture; verify current features before reuse.
- **S24** floh22, [LeagueBroadcast](https://github.com/floh22/LeagueBroadcast). Maintainer warning about memory reading and Vanguard; historical reference rather than a deployment recommendation.
- **S25** Call of Duty League, [Competitive Settings](https://callofdutyleague.com/en-us/competitive-settings), version 1.1 as accessed. Current displayed mode list; a mutable source to version in a preset.
- **S26** PlayVS, [College League Call of Duty Black Ops 7 Competition Rulebook](https://help.playvs.com/en/articles/16192053-playvs-college-league-call-of-duty-black-ops-7-competition-rulebook), sections 1.3 and 1.4. BO5, BO7 grand finals and mode sequence.
- **S27** Call of Duty League, [2027 Season Announcement](https://www.callofdutyleague.com/en-us/news/2027-season-announcement), October 14 2026. Future season example of why title and mode rules must be versioned.
- **S28** Activision, [Black Ops 3 Esports Features Revealed](https://blog.activision.com/call-of-duty/archives/call-of-duty-black-ops-3-esports-features-for-ps4-xbox-one-and-pc-revealed), 2015. Historical CODcaster concept; not a current-title capability guarantee.

### Organizer rules and source maintenance

NECC's [public rulebooks page](https://necc.gg/pages/rulebooks) should be treated as an entry point, while the current competition's distributed game rulebooks and admin rulings should govern its presets. The comparison sources above do not establish NECC or LotE settings. Store the confirmed organizer document URL, season, version and verification date beside every competition preset, and recheck after a season or major patch change.

### Repository references

`README.md` documents the one-state OBS architecture, current controls, saved-match behavior, profile system and local development rules. `PROJECT_NOTES.md` sections v2.0.0 and v2.3.0 explain the OBS-first model and unified installer. `app/server.js`, `app/templates/overlay.html`, `app/public/control/control.js`, and `app/profiles/*/games.json` establish the current scoreboard implementation and supported games. This guide proposes future work and does not change the application code.
