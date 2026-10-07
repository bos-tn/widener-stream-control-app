// Runs dev/shot.js for a list of overlay views, one Electron process per page
// (dev only). From app/:
//
//   node dev/shots.js <out folder> [--port 4313] [--times 600,1500,6500] [--query "a=b"] <view> [<view> ...]
//
// A view is the overlay's ?view= value ("starting-soon", "cam-crowd", ...).
// "name=view&more=params" names the picture and adds parameters. Each page
// gets ?backdrop=1, the stand-in behind see-through scenes.

const { spawnSync } = require('child_process');
const path = require('path');
const electron = require('electron');

const args = process.argv.slice(2);
function opt(name, dflt) {
  const i = args.indexOf('--' + name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
const port = opt('port', '4313');
const times = opt('times', '6500');
const query = opt('query', '');
const out = path.resolve(args.shift() || 'shots');

let failed = 0;
args.forEach((spec) => {
  const [name, rest] = spec.includes('=') ? [spec.slice(0, spec.indexOf('=')), spec.slice(spec.indexOf('=') + 1)] : [spec, spec];
  const url = `http://localhost:${port}/overlay?backdrop=1&view=${rest}${query ? '&' + query : ''}&shot=${encodeURIComponent(name)}`;
  const r = spawnSync(electron, [path.join(__dirname, 'shot.js'), '--out', out, '--times', times, url], { encoding: 'utf8' });
  const files = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean).map((l) => path.basename(l));
  if (r.status !== 0 || !files.length) { failed++; console.log(`FAILED ${name} (exit ${r.status}) ${(r.stderr || '').trim().split(/\r?\n/).pop() || ''}`); }
  else console.log(files.join(' '));
});
process.exit(failed ? 1 : 0);
