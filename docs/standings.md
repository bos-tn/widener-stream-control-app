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

The [NECC public rulebook page](https://necc.gg/pages/rulebooks) currently contains placeholder questions and answers. No current rulebook or qualification cutoff could be verified there. The supplied LotE v1 page redirects an unauthenticated browser to login; its public API exposes standings but no qualification rule. No public current LotE rulebook was found. Neither league ships a guessed cutoff. LeagueOS format.bracketSize is a default format setting, not evidence that that many teams qualify.

A verified rule can be added in the owning profile's profile.json, under league.playoffs, with seasonId, stageId, spots, and an HTTPS source URL (plus an optional note). Rules apply only to the exact season and stage, and only to round-robin standings. Green P markers denote provisional playoff positions. Amber T markers identify every team in a tie that crosses the cutoff; none of those tied teams is awarded a position based on alphabetical order. Without a verified rule the scene reads Playoff cutoff unverified.

## Checks

- npm run test:standings: API array responses, ranking ties, round boundaries, game aliases on import, cross-league caches, offline reuse, restart, late responses, and default/repeated/optional builds against mock OBS for Widener, LotE and Messiah.
- npm run test:broadcast: existing broadcast regression suite. TEST_APP_PORT and TEST_OBS_PORT can select isolated ports when another local test is running.
- npm run test:standings:visual -- <output-folder> [normalized-live-fixture.json]: hidden Electron review at 1920x1080 and 1280x720 for all profiles; pagination and cutoff ties use synthetic fixtures.
- Live OBS remains to be checked. No real OBS or installed app data was used in development.
