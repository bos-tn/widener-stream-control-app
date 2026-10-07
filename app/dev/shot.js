// Full-size pictures of overlay pages, for checking a design at stream
// resolution (dev only). Run with Electron from app/:
//
//   npx electron dev/shot.js --out <folder> [--times 600,1500,6000] [--size 1920x1080] <url> [<url> ...]
//
// Each page is drawn off screen at the given size and saved as a PNG at each
// time (milliseconds after it finished loading; default 6000, when entrances
// are over). Files are named after the page's `view` and the time. Off-screen
// drawing keeps animations running at full rate, which a hidden window does
// not.

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function opt(name, dflt) {
  const i = args.indexOf('--' + name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
const out = path.resolve(opt('out', 'shots'));
const times = String(opt('times', '6000')).split(',').map((t) => parseInt(t, 10)).filter((t) => t >= 0).sort((a, b) => a - b);
const [width, height] = String(opt('size', '1920x1080')).split('x').map((n) => parseInt(n, 10));
const PER = 2;
const urls = args.filter((a) => /^(https?|file):\/\//.test(a));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');

function nameFor(url, i) {
  try {
    const u = new URL(url);
    const tag = u.searchParams.get('shot');
    return (tag || u.searchParams.get('view') || u.pathname.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'page') + (tag ? '' : u.searchParams.get('necc') ? '-' + u.searchParams.get('necc') : '');
  } catch (e) { return 'page' + i; }
}

async function shoot(url, i) {
  const win = new BrowserWindow({
    width, height, show: false, frame: false, useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(30);
  win.webContents.setAudioMuted(true);
  await win.loadURL(url);
  const start = Date.now();
  for (const t of times) {
    const wait = t - (Date.now() - start);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const img = await win.webContents.capturePage();
    const file = path.join(out, `${nameFor(url, i)}${times.length > 1 ? '-' + String(t).padStart(5, '0') : ''}.png`);
    fs.writeFileSync(file, img.toPNG());
    console.log(file);
  }
  win.destroy();
}

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  if (!urls.length) { console.error('No page given.'); app.exit(1); return; }
  try {
    // Two at a time: every page keeps its own video and animations going.
    for (let i = 0; i < urls.length; i += PER) await Promise.all(urls.slice(i, i + PER).map((u, j) => shoot(u, i + j)));
  } catch (e) {
    console.error(e);
    app.exit(1);
    return;
  }
  app.exit(0);
});
