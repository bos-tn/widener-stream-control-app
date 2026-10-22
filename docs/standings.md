# League standings

Verified against public LeagueOS data on October 22, 2026. Imports select their actual season and stage; these links are research references, not fixed application defaults. A new season does not require a code update.

## Current tables

### League of the East

| Game | Stage | Standings |
| --- | --- | --- |
| VALORANT | Regular Season | [Open](https://lote.v1.leagueos.gg/league/stages/dvfemtq0dckrz8g8e4j52wo05/standings) |
| Smash Crews | Regular Season | [Open](https://lote.v1.leagueos.gg/league/stages/4c146138lg7m6imdbelgte3w9/standings) |
| Overwatch | Regular Season | [Open](https://lote.v1.leagueos.gg/league/stages/23d3tfsvh6s1egorkz3lgzg7e/standings) |
| Rocket League | Regular Season | [Open](https://lote.v1.leagueos.gg/league/stages/65zncjzr9trge0glte87jg6lx/standings) |

No current Marvel Rivals regular-season stage was published in the league season listing. The app can read one when a supported match is imported.

### NECC groups containing Widener teams

NECC publishes several divisions per game, each split into regional groups. These are the groups containing Widener teams; an imported match from another division selects its own group automatically.

| Game / division | Group | Teams | Standings |
| --- | --- | --- | --- |
| Overwatch \| Division V | Northeast B | 8 | [Open](https://necc.v1.leagueos.gg/league/stages/0jd39w7imwbey3w4msczn0ioe/standings) |
| LoL \| Division VI | East B | 8 | [Open](https://necc.v1.leagueos.gg/league/stages/ceibb1gu9p6ligq2tg9pn9bbd/standings) |
| Rocket League \| Division III | Northeast B | 8 | [Open](https://necc.v1.leagueos.gg/league/stages/ddooi05r9htev7zv78ggvt1kl/standings) |
| Rocket League \| Division VII | Northeast B | 7 | [Open](https://necc.v1.leagueos.gg/league/stages/77tzl60xc5iak9xw37nt7arx3/standings) |
| R6 \| Division VI | Group B | 7 | [Open](https://necc.v1.leagueos.gg/league/stages/d30kffwsi8oo1dy3yyusq09a4/standings) |
| Fall 2026 - SSBU Crews \| Division III | Northeast B | 8 | [Open](https://necc.v1.leagueos.gg/league/stages/19ci74v9z1r0jmimumddgd5ft/standings) |
| Fall 2026 - SSBU Crews \| Division IV | Northeast B | 8 | [Open](https://necc.v1.leagueos.gg/league/stages/ewffxbgz0ht0xgux0gfinv0tw/standings) |
| Marvel Rivals \| Division III | Northeast B | 8 | [Open](https://necc.v1.leagueos.gg/league/stages/3ihv199sfh98m2xo3p66apho0/standings) |
| Marvel Rivals \| Division V | Northeast B | 8 | [Open](https://necc.v1.leagueos.gg/league/stages/8gw4ymx3ncvpvw9rntgrbr4jw/standings) |
| VALORANT \| Division VI | Northeast B | 8 | [Open](https://necc.v1.leagueos.gg/league/stages/6o7kb12f9tx7qfjzrr8l36goa/standings) |
| VALORANT \| Division VIII | East A | 7 | [Open](https://necc.v1.leagueos.gg/league/stages/d37caqxyfe2bwotr4zdopnk5w/standings) |

No Call of Duty season was listed by these leagues. No standings are invented for unsupported or unpublished competitions.

## Weeks and ordering

The scene reads stage rosters and stage scoring properties, rather than season totals that may combine groups or playoffs. Rankings share positions when all configured league scoring values tie. Records include byes and forfeits as recorded by LeagueOS. Week labels come from the stage round start/end windows, with Round N displayed as Week N. Breaks, upcoming stages and finished stages are identified explicitly. A missing round calendar shows Week unavailable. On the checked date the supplied Rocket League groups report NECC Week 4 and LotE Fall - Week 3.

Tables have one column up to ten teams, two up to twenty, and pages beyond twenty that rotate every twelve seconds. Team and match records also continue to supply the existing Head to Head and roster views.

## Playoff rules

### Rocket League playoff cutoff

NECC Rocket League marks four provisional playoff positions in each listed Fall 2026 conference group (56 groups across Divisions I–IX). A green P marks a team above the cutoff and a green divider follows fourth place. A tie crossing the cutoff uses amber T markers for every tied team. Positions follow the league's published standings order and do not assert a clinched berth.

Source: the operator supplied **Rocket League Rulebook**, **Fall 2025 – Spring 2026**, last modified **March 16, 2026**, section **4.b.iii**, page **9**. That section specifies four teams from each conference group, with possible changes for participation and scheduling. Divisions I and II use double elimination; Divisions III and below use single elimination. The PDF SHA-256 is `b9b94dd560f9dde074d2243ee48862d82c9947530c8b7c652bbdad399067e53b`.

The supplied edition predates Fall 2026. The operator requested its cutoff for this release; it is scoped to the explicitly listed current NECC Rocket League season and stage IDs. It is not treated as a verified rule for future seasons. The full PDF is retained locally and is not redistributed in the repository or installer.

The rulebook's tiebreakers (section 4.b.iii.1, pages 9–10) are match win percentage, overall game differential, head-to-head record, differential against common opponents, then a coin flip. The app retains LeagueOS's published sorting and flags unresolved ties at the cutoff; it never simulates a coin flip or resolves a tie alphabetically.

LotE and other games have no cutoff configured. This NECC rulebook does not establish their qualification rules. The [NECC public rulebook page](https://necc.gg/pages/rulebooks) still contains placeholders; the supplied document is the source for this change.

Rules are stored in the owning profile's profile.json, under league.playoffs, with seasonId, stageId or stageIds, optional activity, spots, and an HTTPS source URL. They apply only to the listed season/stage/game and round-robin format. Any profile can display the NECC rule when importing a NECC match. Cached standings recalculate the configured cutoff immediately after an app update.

## Checks

- npm run test:standings: API array responses, ranking ties, round boundaries, game aliases on import, cross-league caches, offline reuse, restart, late responses, and default/repeated/optional builds against mock OBS for Widener, LotE and Messiah.
- npm run test:broadcast: existing broadcast regression suite. TEST_APP_PORT and TEST_OBS_PORT can select isolated ports when another local test is running.
- npm run test:standings:visual -- <output-folder> [normalized-live-fixture.json]: hidden Electron review at 1920x1080 and 1280x720 for all profiles; pagination and cutoff ties use synthetic fixtures.
- Live OBS remains to be checked. No real OBS or installed app data was used in development.
