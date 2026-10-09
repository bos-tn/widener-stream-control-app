// Builds one Windows installer per league profile (v1.0.0).
//   npm run dist              every profile
//   npm run dist -- lote      one profile
// Each installer holds exactly one profile (profiles/<id>), with that
// league's app id, name, icon, installer file name and update channel, so the
// leagues' apps install side by side, keep separate settings, and update
// independently from the same GitHub release. Output: dist/<id>/.
const fs = require('fs');
const path = require('path');
const { build, Platform } = require('electron-builder');
const pkg = require('../package.json');
const { listProfiles, loadProfile } = require('../profile');

// What electron-builder is given for one profile.
function profileConfig(id) {
  const p = loadProfile(id);
  const base = pkg.build;
  return {
    ...base,
    appId: p.build.appId || base.appId,
    productName: p.appName,
    // streamProfile is read back by profile.js in the installed app. The
    // package name is what Electron names the app's data folder
    // (%APPDATA%\<name>) and electron-updater its download cache after, so
    // every league but Widener gets its own (Widener keeps the original
    // name, so upgrading keeps its settings, teams and saved matches).
    extraMetadata: { streamProfile: id, ...(p.build.packageName ? { name: p.build.packageName } : {}) },
    directories: { ...base.directories, output: `dist/${id}` },
    // local.json (network camera addresses, see profile.js) stays on the PC
    // it was written on: an installer goes to a public release.
    files: [...base.files.filter((f) => !f.startsWith('profiles/')), `profiles/${id}/**/*`, `!profiles/${id}/local.json`],
    win: { ...base.win, icon: `profiles/${id}/icons/icon.ico` },
    nsis: { ...base.nsis, artifactName: p.build.artifactName || `${id}-Stream-Control-Setup-\${version}.\${ext}` },
    // The channel names the update file: latest.yml, lote.yml, ... Every
    // league's installer and update file go in one GitHub release per
    // version, and each app reads only its own file.
    publish: (base.publish || []).map((pub) => ({ ...pub, channel: p.build.channel || 'latest' })),
  };
}

async function buildProfile(id) {
  const p = loadProfile(id);
  const config = profileConfig(id);
  // Written out whole and passed as a file: given as an object, electron-
  // builder merges it into package.json's "build" (and folds a publish list
  // into its first entry, which breaks it), so a profile's files and channel
  // would not be exactly what is set here.
  const configFile = path.join(__dirname, '..', 'dist', `${id}.build.json`);
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify({ extends: null, ...config }, null, 2));
  console.log(`\n=== ${p.appName} (${id}) ===`);
  // A league's licensed fonts are kept out of the repository (see the README
  // in its assets/fonts folder). The installer works without one: that
  // typeface is left out of the choice, and with none the headlines use the
  // fallback.
  p.headlineFonts.missing.forEach((f) => {
    console.warn(`WARNING: profiles/${id}/assets/${f} is missing, so this installer won't offer that headline typeface. See the README in that folder.`);
  });
  await build({
    projectDir: path.join(__dirname, '..'),
    targets: Platform.WINDOWS.createTarget('nsis'),
    config: configFile,
    publish: 'never',
  });
}

module.exports = { profileConfig };

if (require.main === module) {
  (async () => {
    const wanted = process.argv.slice(2);
    const ids = wanted.length ? wanted : listProfiles();
    for (const id of ids) await buildProfile(id);
  })().catch((e) => {
    console.error(e && e.message ? e.message : e);
    process.exit(1);
  });
}
