// League profiles (v1.0.0). One codebase serves several leagues: everything
// that belongs to one league (name, colours, logos, stinger, games, OBS scene
// names, port, installer identity) lives in profiles/<id>/profile.json and its
// assets folder, and each installer is built with exactly one profile inside.
//
// Which profile runs: `--profile=<id>` on the command line (dev), the
// STREAM_PROFILE environment variable, or `streamProfile` in package.json,
// which build/dist.js writes into each installer. Default: widener.

const fs = require('fs');
const path = require('path');

const PROFILES_DIR = path.join(__dirname, 'profiles');

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
  const stinger = raw.stinger && raw.stinger.type === 'video' && raw.stinger.file
    ? { type: 'video', file: raw.stinger.file, swapTime: Number(raw.stinger.swapTime) || 1 }
    : { type: raw.stinger && raw.stinger.type === 'none' ? 'none' : 'css' };
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
    stinger: p.stinger.type === 'video'
      ? { type: 'video', url: url(p.stinger.file), swapTime: p.stinger.swapTime }
      : { type: p.stinger.type },
    hasMusicTrack: !!p.music,
  };
}

// The profile's colours as CSS custom properties (/brand.css). The overlay
// and the control panel keep their own fallbacks, so a missing value just
// means the Widener default.
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
  return `/* ${p.name}: generated from profiles/${p.id}/profile.json */\n:root{\n${lines.join('\n')}\n}\n`;
}

module.exports = { PROFILES_DIR, profileId, listProfiles, loadProfile, clientBrand, brandCss };
