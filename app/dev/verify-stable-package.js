// Verify a stable installer and its packaged source before release.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');
const yaml = require('js-yaml');
const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2]);
const archive = path.join(out, 'win-unpacked/resources/app.asar');
const files = asar.listPackage(archive).map(p => p.replaceAll('\\', '/'));
const source = require('../package.json');
const packaged = JSON.parse(asar.extractFile(archive, 'package.json'));
for (const key of ['name', 'version', 'main', 'dependencies']) assert.deepEqual(packaged[key], source[key]);
assert(!source.version.includes('-'), 'stable version');
assert(!files.some(p => /^\/(dev|build|data)\//.test(p)));
assert(!files.some(p => /^\/profiles\/[^/]+\/local\.json$/.test(p)));
const tracked = execFileSync('git', ['ls-files', 'app'], { cwd: path.dirname(root), encoding: 'utf8' }).trim().split(/\r?\n/)
  .map(p => p.slice(4)).filter(p => /^[^/]+\.js$/.test(p) || /^(profiles|public|icons|templates)\//.test(p));
for (const file of tracked) assert(asar.extractFile(archive, path.normalize(file)).equals(fs.readFileSync(path.join(root, file))), file);
for (const font of ['PinkBlue.ttf', 'Zentras.ttf']) assert(files.includes('/profiles/lote/assets/fonts/' + font));
for (const id of ['widener', 'lote', 'messiah']) {
  const profile = JSON.parse(asar.extractFile(archive, path.join('profiles', id, 'profile.json')));
  assert.equal(profile.locked === true, id === 'messiah');
}
const script = fs.readFileSync(path.join(out, 'installer.nsh'), 'utf8');
assert(script.includes('Messiah Esports (Locked)'));
const config = yaml.load(fs.readFileSync(path.join(out, 'win-unpacked/resources/app-update.yml'), 'utf8'));
assert.equal(config.owner, 'bos-tn'); assert.equal(config.repo, 'widener-stream-control-app'); assert(!config.channel);
const info = yaml.load(fs.readFileSync(path.join(out, 'latest.yml'), 'utf8'));
assert.equal(info.version, source.version);
assert.equal(fs.readFileSync(path.join(out, 'latest.yml'), 'utf8'), fs.readFileSync(path.join(out, 'lote.yml'), 'utf8'));
const exe = fs.readFileSync(path.join(out, info.path));
assert.equal(exe.length, info.files[0].size);
assert.equal(crypto.createHash('sha512').update(exe).digest('base64'), info.sha512);
assert.equal(info.sha512, info.files[0].sha512);
const assets = [info.path, info.path + '.blockmap', 'latest.yml', 'lote.yml'].map(name => {
  const data = fs.readFileSync(path.join(out, name));
  return { name, size: data.length, digest: 'sha256:' + crypto.createHash('sha256').update(data).digest('hex') };
});
fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify({ version: source.version, productionFiles: tracked.length, assets }, null, 2));
console.log(`PASS ${source.version}: ${tracked.length} production files, profile locks, fonts, private-file exclusions, updater configuration and installer hashes`);
