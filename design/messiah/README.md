# Messiah Esports — design package, concept round 02

Open [index.html](index.html) in Chrome or Edge. It contains **32 live, eight-second animated plates** in seven families. The original 24 remain, and Hardline 25–32 adds stronger esports options based on the source marks and treatments in the existing stream control app. Select a plate to see it large; toggle the optional logo overlay, star 5–10 favorites, copy their IDs, and export a 1920×1080 PNG still or an eight-second silent WebM loop. The optional overlay is preview-only; Hardline plates themselves include the extracted marks and/or faded text. The HTML gallery and Canvas engine are local files and need no server or internet connection.

This is a **selection artifact** rather than an app profile. The source code in `app/profiles/` has not been changed. Once plates are chosen, their drawing logic can become Messiah's `theme.js`/`theme.css` backgrounds and the profile can be completed around approved marks and game data.

## Research synthesis

| Finding | Design consequence | Source |
| --- | --- | --- |
| Messiah's official primary palette is institutional navy `#002856` and white; light blue `#1C8AC2` and gray `#5B6770` are secondary. | Navy and white dominate. Light blue carries motion and highlights. | [University color palette](https://www.messiah.edu/visual-identity/color-palette/) |
| Green `#0B7367`, blue `#11698C`, purple `#614495`, yellow `#E5AE3A`, orange `#D6742A`, and red `#A63738` form a tertiary palette. | Use small refracted-light accents instead of a competing esports neon palette. | [University color palette](https://www.messiah.edu/visual-identity/color-palette/) |
| The university uses stained glass panes, joined color, and circular graphics to express distinct perspectives in one community. | Glass, radial, fusion, and paired-perspective plate families are anchored in the brand story. | [Stained glass metaphor](https://www.messiah.edu/visual-identity/stained-glass-metaphor/) |
| Messiah's ligatures fuse seemingly different ideas and can use gradient and stained glass elements. | Fusion Line and Dual Perspective use two fields that visibly join. | [Ligatures](https://www.messiah.edu/visual-identity/ligatures/) |
| “see anew” is the institutional tagline. | It informs the study title and halo family; the plates do **not** manufacture a new official tagline mark. | [See anew](https://www.messiah.edu/visual-identity/see-anew-tagline/) |
| Official type includes Priori, Aptifer, and limited Hand of Sean. Messiah's public brand manual lists Hanken Grotesk and Aleo as open Google Fonts alternatives for internal work. | The preview bundles Hanken Grotesk and Aleo under SIL OFL; no licensed brand font is included. | [Fonts](https://www.messiah.edu/visual-identity/fonts/), [brand manual](https://view.messiah.edu/brandmanual) |
| The updated athletics guide includes eight esports logo and wordmark treatments and says the esports logos were approved in January 2020. It also directs users to obtain permission and an electronic file from Messiah Athletics for reproduction. | The eight vector marks are clipped without redrawing for concept use. Request production masters and permission before public broadcast. | [2026 athletics guide, pages 38 and 51](https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/messiah.sidearmsports.com/documents/2026/2/26/Athletics_Brad_Identity_Guide_Updated.pdf) |
| Messiah's mascot is the Falcons and the Stoner Covered Bridge spans Yellow Breeches Creek at the Grantham campus. | Flight is abstract airflow, not a new Falcon mark. Campus concepts abstract the bridge and water. | [Athletics visual identity](https://gomessiah.com/sports/2014/7/28/GEN_0728141552.aspx?id=245), [Stoner Covered Bridge](https://www.messiah.edu/the_bridge/2023/volume-1/from-the-president) |
| Messiah Esports has competed in several titles and conferences. The university's 2024–25 report cites Overwatch, Smash, Valorant, Madden, and NBA 2K; its older program page lists other games. | No game art or fixed game roster is baked into these plates. Confirm the current teams before `games.json` is created. | [2024–25 student engagement report](https://www.messiah.edu/sse/_files/sse-annual-report-25-web.pdf), [Esports page](https://www.messiah.edu/student-engagement/esports/) |

### A color distinction to preserve

The [2026 athletics guide](https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/messiah.sidearmsports.com/documents/2026/2/26/Athletics_Brad_Identity_Guide_Updated.pdf) supersedes the older guide used in round 01. Its page 39 palette names **institutional navy `#002856`** as the athletics primary, white as secondary, and black plus cool gray `#BEC0C2` as accents. That navy agrees with the [institutional palette](https://www.messiah.edu/visual-identity/color-palette/). The project-supplied LeagueOS logo has sampled opaque blue near `#004B86` and gray near `#BFC1C2`; these are pixels in the artwork, **not** additional published brand swatches. Hardline plates draw the guide's artwork without recoloring it.

## Asset inventory

| Local file | Origin | Use |
| --- | --- | --- |
| `source/Athletics_Brad_Identity_Guide_Updated.pdf` | [2026 athletics guide](https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/messiah.sidearmsports.com/documents/2026/2/26/Athletics_Brad_Identity_Guide_Updated.pdf) | Unaltered source PDF, including the esports page (printed page 51; PDF page index 13). |
| `assets/guide/manifest.json` and eight SVG/PNG pairs | Page 51 of the 2026 guide | Exact vector clips and transparent 720 dpi PNG previews of four logo variants and four wordmarks. The two dark-background examples retain their printed blue field. |
| `assets/esports-logo-leagueos-source.webp` | [Project-supplied LeagueOS image](https://images.leagueos.gg/groups/c8tx1jcxhv89exuf7rdux1y43/648cd626832b120a065cdffc) | Unaltered 512×512 transparent WebP Falcon mark. Primary esports logo reference in the gallery; not embedded in background exports. |
| `assets/esports-wordmark-source.png` | [University Esports page image](https://www.messiah.edu/student-engagement/_images/esports_wordmark_stroke.png) | Unaltered 469×100 RGB wordmark. Earlier university-page reference, retained for provenance; not embedded in plates. |
| `assets/university-footer-logo-source.svg` | [University website footer](https://www.messiah.edu/assets/images/logo-footer.svg) | Unaltered white university logo for dark preview. |
| `assets/athletics-site-logo-reference.svg` | [GoMessiah site logo](https://dxbhsrqyrr690.cloudfront.net/sidearm.nextgen.sites/messiah.sidearmsports.com/images/responsive_2018/main_logo.svg) | Historical visual reference only. Do not use as the profile's production mark without current Athletics artwork/approval. |
| `fonts/hanken-*.ttf`, `fonts/aleo-*.ttf` | [Google Fonts CSS](https://fonts.googleapis.com/css2?family=Aleo:wght@400;700&family=Hanken+Grotesk:wght@400;600;700;800&display=swap) | Locally bundled OFL alternates; licenses are included beside the font files. |

The [institutional logo download page](https://www.messiah.edu/visual-identity/) offers an official package and says Messiah credentials are required. The athletics PDF contains vector artwork, and [extract_esports_logos.py](source/extract_esports_logos.py) preserves those paths in the eight SVG clips. The guide explicitly asks users to request permission and the electronic files from Messiah Athletics for reproduction. The extracted files support design review and are not a substitute for the approved production package. Preserve each mark's proportions and clear space.

## Plate catalogue

The 32 concepts are split between institutional, athletic, and esports directions. Every concept has a navy ground, a quieter central content region, and motion that returns to the same state every eight seconds. Plates 01–24 remain mark-free and text-free. Hardline 25–32 use the guide-extracted esports marks, separate faded words, or both; none contain game logos or camera feeds.

| IDs | Family | Visual idea | First scene uses |
| --- | --- | --- | --- |
| 01–04 | **Glass** | Moving panes, sunrise facets, concentric glass, cathedral-like light | Starting Soon, Rosters, Matchup, Standings |
| 05–08 | **Flight** | Airflow, feather-like linework, ascent beams, tailwind ribbons | Matchup, Gameplay, Highlight, Post-Match |
| 09–12 | **Arena** | Athletic rails, light field, score grid, competition tunnel | Starting Soon, Camera, Scoreboard, Stats |
| 13–16 | **Campus** | Covered bridge structure, creek reflections, night landscape, lit truss | Schedule, Be Right Back, Matchup |
| 17–20 | **Signal** | Circuit traces, pixel matrix, data columns, pulse field | Scoreboard, Stats, Gameplay |
| 21–24 | **Unity** | Halos, fused color fields, dual perspectives, unified orbits | Starting Soon, Rosters, Post-Match |
| 25–32 | **Hardline** | Falcon watermark and matrix, faded word rows, rally tape, blue impact rails, steady wordmark, scan field, finale | Starting Soon, Matchup, Scoreboard, Stats, Post-Match |

Hardline takes specific cues from the existing app's repeating marks, word rows, varsity rails, and pride tape. The logo and wordmark hold steady without traveling shine effects. It uses Messiah's extracted art and the current navy/white/gray system rather than transferring another profile's names or assets.

The exact names, intended scenes, and motion levels are in [plates-data.js](plates-data.js) and the interactive gallery.

## Broadcast design rules

1. **Format:** 1920×1080, 16:9, silent, eight-second loop, 30 fps target. The gallery runs Canvas live; WebM export is a browser recording. Verify each exported video in OBS before broadcast deployment.
2. **Safe zone:** Reserve approximately `x=420..1500`, `y=184..896` for scene titles and main data. Toggle the safe-area guide in the preview. Outside this region, more contrast and movement can be used.
3. **Contrast:** Use white on a dark navy panel for small scores and labels. Avoid placing fine glass seams directly behind roster names or standings rows.
4. **Motion:** Calm plates suit text-heavy scenes; high-energy plates suit matchups and entrances. Avoid rapid flashes, strobing, and continuous large-scale movement behind stats.
5. **Marks:** Keep the guide-extracted esports art intact and at its original proportions. The guide calls for 1/4-inch isolation in print; give the mark comparable breathing room in a final scene lockup. The repeating and faded Hardline use is a concept treatment that needs Athletics sign-off before production.
6. **No false game branding:** Keep game and league art out of the background plate so each can be chosen per match and licensed separately.

## Profile integration proposal

Reserve `messiah`, port `4330`, data folder `messiah-stream-control`, and OBS scene prefix `MU` for a team profile. These values are a proposal in [brand.json](brand.json), not a running profile. They are distinct from Widener and LotE. After the shortlist is chosen:

1. Use the 2026 guide and supplied LeagueOS mark as the identity references; request the production esports files and usage approval from Messiah Athletics.
2. Choose 5–10 backgrounds, assign them to Starting Soon, Rosters, Matchup, Scoreboard, Be Right Back, Post-Match, and any optional scenes.
3. Adapt the selected Canvas motifs into `app/profiles/messiah/theme.js` and `theme.css`, then create `profile.json`, `games.json`, and vetted assets.
4. Confirm current competitions, titles, home-team naming, social handle, stream location, and whether a LeagueOS feed belongs in the new profile. Sources found here are not enough to freeze those operational values.
5. Run both profile paths and mock OBS checks, then verify the selected backgrounds and marks in a live OBS preview.

## Preview and export

Double-click `index.html` in Chrome or Edge. The gallery is self-contained. A selected plate can be downloaded as a PNG still or recorded as a WebM. If the browser blocks recording from a local file, serve this directory with a simple local HTTP server on a spare port; do not use the app's production ports. The shortlist is stored in this browser's local storage.

This package is a research-backed design exploration for review. It does not represent approval from Messiah University or Athletics.
