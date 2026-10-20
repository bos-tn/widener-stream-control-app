// Verify a local candidate without running its installer or publishing it.
// node dev/verify-package.js [build output directory]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const yaml = require('js-yaml');
const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist/messiah-review'));
const archive = path.join(out, 'win-unpacked/resources/app.asar');
const files = asar.listPackage(archive).map(p => p.replaceAll('\\', '/'));
assert(!files.some(p => /\/(?:dev|data|build)\//.test(p) && !p.startsWith('/node_modules/')));
assert(!files.some(p => /^\/profiles\/[^/]+\/local\.json$/.test(p)));
const production = ['main.js', 'templates/overlay.html', 'profile.js', 'server.js', 'obs.js', 'broadcast.js', 'series.js', 'series-rules.js',
  'public/control/series-control.js', 'public/control/series-setup.js', 'public/control/series-control.css',
  'public/overlay-assets/series-board.js', 'public/overlay-assets/series-board.css',
  'profiles/widener/games.json', 'profiles/lote/games.json', 'profiles/messiah/games.json',
  'public/overlay-assets/bx.js', 'public/control/broadcast.js', 'public/control/control.js',
  'public/control/control.css', 'public/control/index.html', 'profiles/messiah/theme.css',
  'profiles/messiah/theme.js', 'profiles/messiah/profile.json', 'profiles/messiah/assets/plate-engine.js'];
for (const file of production) {
  assert(asar.extractFile(archive, path.normalize(file)).equals(fs.readFileSync(path.join(root,file))), `${file} matches working tree`);
}
// electron-builder strips development metadata from the packaged manifest.
const pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
const source = require('../package.json');
for (const key of ['version', 'name', 'main', 'dependencies']) assert.deepEqual(pkg[key], source[key]);
const info = yaml.load(fs.readFileSync(path.join(out, 'latest.yml'), 'utf8'));
assert.equal(info.version, source.version);
const exe = fs.readFileSync(path.join(out, info.path));
assert.equal(exe.length, info.files[0].size);
assert.equal(crypto.createHash('sha512').update(exe).digest('base64'), info.sha512);
assert.equal(fs.readFileSync(path.join(out, 'lote.yml'), 'utf8'), fs.readFileSync(path.join(out, 'latest.yml'), 'utf8'));
const checks = { version:info.version, installer:info.path, bytes:exe.length,
  sha256:crypto.createHash('sha256').update(exe).digest('hex'), productionFilesMatched:production,
  profiles:['widener','lote','messiah'], privateRuntimeFilesExcluded:true };
fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(checks,null,2));
console.log(`PASS ${checks.installer}: ${production.length} production files, package metadata, private-file exclusions and installer hash.`);
