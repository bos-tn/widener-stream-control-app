// League profiles (v1.0.0). One codebase serves several leagues: everything
// that belongs to one league (name, colours, logos, stinger, games, member
// schools, OBS scene names, port, installer identity) lives in profiles/<id>/profile.json and its
// assets folder, and each installer is built with exactly one profile inside.
//
// Which profile runs: `--profile=<id>` on the command line (dev), the
// STREAM_PROFILE environment variable, or `streamProfile` in package.json,
// which build/dist.js writes into each installer. Default: widener.

const fs = require('fs');
const path = require('path');

const PROFILES_DIR = path.join(__dirname, 'profiles');
const LEAGUE_SCENES = ['standings', 'matchup'];

const FONT_FORMATS = { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' };

// The broadcast package (test branch, optional). A profile with a `broadcast`
// block gets the redesigned scenes, the match centre, the ticker, pop-ups and
// the lower third, plus these extras: its own scenes ('schedule', the week's
// matches; 'versus', the matchup) and one scene and one pop-up window per
// camera: { id, label, title, subtitle }.
const BROADCAST_SCENES = ['schedule', 'versus'];

// A network camera's address, as typed or as a profile gives it: a web page
// (http, https) or a stream (rtsp, rtmp, srt, ...). An address with no
// scheme is taken as RTSP on the RTSP ports (554, 8554) and as a web page
// otherwise. '' when it is not an address.
const CAMERA_LINK = /^(https?|rtsps?|rtmps?|srt|udp|rist):\/\/[^\s]+$/i;
function cameraLink(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    const port = (/^[^/]*:(\d+)(\/|$)/.exec(s) || [])[1];
    s = (port === '554' || port === '8554' ? 'rtsp://' : 'http://') + s;
  }
  return CAMERA_LINK.test(s) && s.length <= 500 ? s : '';
}
// What OBS shows it with: 'page' (a browser source), 'stream' (a media
// source), or 'device' for no address (a capture device on this PC).
function cameraLinkKind(link) {
  if (!link) return 'device';
  return /^https?:\/\//i.test(link) && !/\.m3u8(\?|#|$)/i.test(link) ? 'page' : 'stream';
}

// local: profiles/<id>/local.json, `{ "cameras": { "<camera id>": "<address>" } }`.
// Addresses on the organisation's own network are kept there and not in
// profile.json: that file is in the public repository, local.json is not
// (.gitignore), and it is left out of an installer (build/dist.js). It is
// for dev runs on that PC; an installed app's operator types the addresses
// in once (Broadcast, Cameras), and they are kept in its data folder.
function broadcastOptions(raw, local) {
  if (!raw || typeof raw !== 'object') return { enabled: false, scenes: [], cameras: [] };
  const cameras = (Array.isArray(raw.cameras) ? raw.cameras : []).filter((c) => c && /^[a-z0-9]+$/.test(c.id || '')).slice(0, 4)
    // link: the camera's address on the network (local.json, else `url`
    // here). Without one the camera is a capture device on this PC.
    .map((c) => ({ id: c.id, label: String(c.label || c.id), title: String(c.title || c.label || c.id), subtitle: String(c.subtitle || ''),
      link: cameraLink(((local && local.cameras) || {})[c.id] !== undefined ? local.cameras[c.id] : c.url) }));
  const scenes = (Array.isArray(raw.scenes) ? raw.scenes : BROADCAST_SCENES).filter((x) => BROADCAST_SCENES.includes(x));
  // The league feed a new install follows: LeagueOS links (a school's page
  // follows that school's teams), and whose matches are kept: 'home' (the
  // profile's home team) or 'all'.
  const f = raw.follow && typeof raw.follow === 'object' ? raw.follow : {};
  const follow = {
    links: (Array.isArray(f.links) ? f.links : []).filter((l) => /^https:\/\/[a-z0-9.-]+\.leagueos\.gg\//i.test(String(l))).slice(0, 6),
    scope: f.scope === 'home' ? 'home' : 'all',
  };
  return { enabled: true, scenes, cameras, follow };
}

// Headline typefaces the operator can pick between (v2.0.0, optional):
// { list: [{ id, name, family, file }], default }. A typeface whose file is
// not in assets/ (a licensed one, kept out of the repository) is left out of
// the choice and named in `missing`. /brand.css declares the faces; the
// theme gives each its sizes and letter case.
function headlineFonts(raw, assetsDir) {
  const listed = ((raw && raw.list) || []).filter((f) => f && /^[a-z0-9-]+$/.test(f.id || '') && /^[A-Za-z0-9 _-]+$/.test(f.family || '')
    && /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.(ttf|otf|woff2?)$/i.test(f.file || ''));
  const have = (f) => fs.existsSync(path.join(assetsDir, f.file));
  const list = listed.filter(have).map((f) => ({ id: f.id, name: f.name || f.family, family: f.family, file: f.file }));
  const wanted = raw && raw.default;
  return {
    list,
    default: list.some((f) => f.id === wanted) ? wanted : (list[0] || {}).id || '',
    missing: listed.filter((f) => !have(f)).map((f) => f.file),
  };
}

function profileId() {
  const arg = process.argv.find((a) => a.startsWith('--profile='));
  if (arg) return arg.slice('--profile='.length);
  if (process.env.STREAM_PROFILE) return process.env.STREAM_PROFILE;
  try { return require('./package.json').streamProfile || 'widener'; } catch (e) { return 'widener'; }
}

function listProfiles() {
  return fs.readdirSync(PROFILES_DIR).filter((d) => fs.existsSync(path.join(PROFILES_DIR, d, 'profile.json')));
}

// Reads and checks one profile. Missing optional parts get safe defaults, so
// a new league can start from a short profile.json and grow.
// What this PC adds to a profile (see broadcastOptions). STREAM_NO_LOCAL=1
// leaves it out, for tests.
function readLocal(dir) {
  if (process.env.STREAM_NO_LOCAL === '1') return {};
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'local.json'), 'utf8')) || {}; } catch (e) { return {}; }
}

function loadProfile(id) {
  if (!/^[a-z0-9-]+$/.test(id || '')) throw new Error(`Bad profile id "${id}"`);
  const dir = path.join(PROFILES_DIR, id);
  const file = path.join(dir, 'profile.json');
  if (!fs.existsSync(file)) throw new Error(`No profile "${id}" (looked for ${file})`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const assetsDir = path.join(dir, 'assets');
  const assets = { logo: 'logo.png', panelLogo: 'logo.png', mascot: '', watermark: '', ...(raw.assets || {}) };
  ['logo', 'panelLogo', 'mascot', 'watermark'].forEach((k) => {
    if (assets[k] && !fs.existsSync(path.join(assetsDir, assets[k]))) throw new Error(`Profile "${id}": assets/${assets[k]} (${k}) is missing`);
  });
  // The league's OBS Stinger transition (v2.0.0): a video in assets/, the
  // moment (ms) OBS cuts to the new scene under it, and whether the file
  // carries a track matte beside the picture (Widener's) or real alpha.
  const st = raw.stinger || {};
  const stinger = st.file && fs.existsSync(path.join(assetsDir, st.file))
    ? { file: st.file, transitionPoint: Math.max(0, Number(st.transitionPoint) || 0), trackMatte: st.trackMatte === true }
    : null;
  // The league's member schools (v2.0.0, optional): name, short name,
  // colours and logo, preloaded into the team library.
  const teamsFile = path.join(dir, 'teams.json');
  const teams = fs.existsSync(teamsFile)
    ? JSON.parse(fs.readFileSync(teamsFile, 'utf8')).filter((t) => t && t.id && t.name)
    : [];
  const p = {
    id,
    name: raw.name || id,
    shortName: raw.shortName || raw.name || id,
    appName: raw.appName || `${raw.name || id} Stream Control`,
    tagline: raw.tagline || '',
    port: Number(raw.port) || 4310,
    homeTeam: raw.homeTeam || '',
    league: { name: 'League', importHint: 'Paste the LeagueOS match page link', ...(raw.league || {}) },
    obs: { prefix: id.toUpperCase(), leagueScene: 'League Graphics', ...(raw.obs || {}) },
    socialHandle: raw.socialHandle || '',
    matchExample: raw.matchExample || 'Team A vs Team B, Week 1',
    colors: raw.colors || {},
    assets,
    stinger,
    teams,
    // The league's own scenes (v2.0.0): 'standings' and 'matchup' (Head to
    // Head), drawn from the standings kept on the panel's League page. A
    // school's own app (Widener) has none.
    leagueScenes: (Array.isArray(raw.leagueScenes) ? raw.leagueScenes : []).filter((s) => LEAGUE_SCENES.includes(s)),
    // Scene backgrounds the operator can pick per scene (v2.0.0, optional):
    // { list: [{ id, name }], defaults: { <view>: <id> } }. The theme draws
    // them (theme.css, and themeScript builds their layers).
    backgrounds: {
      list: ((raw.backgrounds && raw.backgrounds.list) || []).filter((b) => b && /^[a-z0-9-]+$/.test(b.id || '')).map((b) => ({ id: b.id, name: b.name || b.id })),
      defaults: { ...((raw.backgrounds && raw.backgrounds.defaults) || {}) },
    },
    headlineFonts: headlineFonts(raw.headlineFonts, assetsDir),
    broadcast: broadcastOptions(raw.broadcast, readLocal(dir)),
    themeScript: raw.themeScript && fs.existsSync(path.join(dir, raw.themeScript)) ? path.join(dir, raw.themeScript) : '',
    music: raw.music && raw.music.driveId ? raw.music : null,
    defaults: raw.defaults || {},
    theme: raw.theme && fs.existsSync(path.join(dir, raw.theme)) ? path.join(dir, raw.theme) : '',
    build: raw.build || {},
    dir,
    assetsDir,
    iconsDir: path.join(dir, 'icons'),
    games: JSON.parse(fs.readFileSync(path.join(dir, 'games.json'), 'utf8')),
  };
  return p;
}

// What the overlay and control panel may know, as window.BRAND (/brand.js).
// Asset paths are the URLs the server serves them at.
function clientBrand(p) {
  const url = (f) => (f ? `/brand/${encodeURIComponent(f)}` : '');
  return {
    id: p.id,
    name: p.name,
    shortName: p.shortName,
    appName: p.appName,
    tagline: p.tagline,
    homeTeam: p.homeTeam,
    league: p.league,
    obsPrefix: p.obs.prefix,
    socialHandle: p.socialHandle,
    matchExample: p.matchExample,
    teamColors: { A: (p.colors.teamA || '#0054B8').toLowerCase(), B: (p.colors.teamB || '#F0B310').toLowerCase() },
    logo: url(p.assets.logo),
    panelLogo: url(p.assets.panelLogo),
    mascot: url(p.assets.mascot) || url(p.assets.logo),
    watermark: url(p.assets.watermark) || url(p.assets.logo),
    stinger: p.stinger ? { name: `${p.shortName} Stinger`, transitionPoint: p.stinger.transitionPoint, trackMatte: p.stinger.trackMatte } : null,
    leagueTeams: p.teams.length,
    leagueScenes: p.leagueScenes,
    backgrounds: p.backgrounds,
    headlineFonts: { list: p.headlineFonts.list.map(({ id, name, family }) => ({ id, name, family })), default: p.headlineFonts.default },
    hasMusicTrack: !!p.music,
    broadcast: p.broadcast.enabled ? { scenes: p.broadcast.scenes, cameras: p.broadcast.cameras.map(({ link, ...c }) => c) } : null,
  };
}

// The profile's colours as CSS custom properties (/brand.css), and its
// headline typefaces as @font-face rules. The overlay and the control panel
// keep their own fallbacks, so a missing value just means the Widener
// default.
function brandCss(p) {
  const c = p.colors || {};
  const ui = c.ui || {};
  const vars = {
    '--brand-primary': c.primary,
    '--brand-accent': c.accent,
    '--brand-accent-ink': c.accentInk,
    '--brand-text': c.text,
    '--brand-muted': c.muted,
    '--brand-team-a': c.teamA,
    '--brand-team-b': c.teamB,
    '--brand-panel': c.panel,
    '--brand-panel-dark': c.panelDark,
    '--brand-chip': c.chip,
    '--brand-chip-active': c.chipActive,
    '--brand-soft-text': c.softText,
    '--brand-ink-dark': c.inkDark,
    '--brand-ink-muted': c.inkMuted,
    '--brand-paused': c.paused,
    '--brand-ground': c.ground,
    '--brand-ui-bg': ui.bg,
    '--brand-ui-panel': ui.panel,
    '--brand-ui-panel-2': ui.panel2,
    '--brand-ui-border': ui.border,
    '--brand-ui-muted': ui.muted,
    '--brand-ui-focus': ui.focus,
    '--brand-ui-button': ui.button,
    '--brand-ui-button-hover': ui.buttonHover,
    '--brand-ui-tint': ui.tint,
    '--brand-ui-placeholder': ui.placeholder,
    '--brand-ui-primary-2': ui.primary2,
    '--brand-ui-thumb': ui.thumb,
  };
  const watermark = p.assets.watermark || p.assets.logo;
  const lines = Object.keys(vars)
    .filter((k) => typeof vars[k] === 'string' && vars[k] && !/[;{}<>]/.test(vars[k]))
    .map((k) => `  ${k}:${vars[k]};`);
  lines.push(`  --brand-watermark:url(/brand/${encodeURIComponent(watermark)});`);
  const glow = /^#([0-9a-f]{6})$/i.exec(c.accent || '');
  if (glow) {
    const n = parseInt(glow[1], 16);
    lines.push(`  --brand-accent-glow:rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},.55);`);
  }
  const faces = p.headlineFonts.list.map((f) => {
    const url = `/brand/${f.file.split('/').map(encodeURIComponent).join('/')}`;
    return `@font-face{ font-family:'${f.family}'; font-weight:400; font-style:normal; font-display:block; src:local('${f.family}'), url(${url}) format('${FONT_FORMATS[f.file.split('.').pop().toLowerCase()]}'); }\n`;
  });
  return `/* ${p.name}: generated from profiles/${p.id}/profile.json */\n:root{\n${lines.join('\n')}\n}\n${faces.join('')}`;
}

module.exports = { PROFILES_DIR, profileId, listProfiles, loadProfile, clientBrand, brandCss, cameraLink, cameraLinkKind };
