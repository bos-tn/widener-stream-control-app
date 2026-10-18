// Run with: npm run icons            (every profile, and the app's own icon)
//      or:  npm run icons -- lote    (one profile)
//      or:  npm run icons -- app     (the app's own icon)
// Builds icon.ico and per-size PNGs for a profile from its real source logo,
// profiles/<id>/icon-source.png (a square PNG, 512 px or larger), instead of
// a hand-drawn recreation. Output: profiles/<id>/icons/. The app's own icon
// (installer, exe, profile page) is drawn in build/icon-source.svg; output:
// icons/.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { PROFILES_DIR, listProfiles } = require('../profile');

const APP_SVG = path.join(__dirname, 'icon-source.svg');
const APP_ICONS = path.join(__dirname, '..', 'icons');

// The SVG drawn at 1024 px in a hidden window, with its transparent corners.
async function renderSvg(file) {
  const size = 1024;
  const win = new BrowserWindow({ show: false, width: size, height: size, useContentSize: true, frame: false, transparent: true });
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${fs.readFileSync(file, 'utf8')}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const img = await win.webContents.capturePage();
  win.destroy();
  return img.resize({ width: size, height: size, quality: 'best' });
}

async function makeIcons(id) {
  const sourcePng = id === 'app' ? '' : path.join(PROFILES_DIR, id, 'icon-source.png');
  const source = id === 'app' ? await renderSvg(APP_SVG) : nativeImage.createFromPath(sourcePng);
  if (source.isEmpty()) {
    throw new Error(`Could not read source icon at ${sourcePng || APP_SVG}`);
  }

  const outDir = id === 'app' ? APP_ICONS : path.join(PROFILES_DIR, id, 'icons');
  fs.mkdirSync(outDir, { recursive: true });

  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  const pngBuffers = [];
  for (const s of sizes) {
    const resized = source.resize({ width: s, height: s, quality: 'best' });
    const buf = resized.toPNG();
    fs.writeFileSync(path.join(outDir, `icon-${s}.png`), buf);
    pngBuffers.push(buf);
  }
  fs.writeFileSync(path.join(outDir, 'logo.png'), pngBuffers[sizes.indexOf(128)]);

  const { default: pngToIco } = await import('png-to-ico');
  const icoBuf = await pngToIco(pngBuffers.filter((_, i) => sizes[i] <= 256));
  fs.writeFileSync(path.join(outDir, 'icon.ico'), icoBuf);

  console.log('Icon assets generated in', outDir);
}

app.whenReady().then(async () => {
  const wanted = process.argv.slice(2).filter((a) => /^[a-z0-9-]+$/.test(a) && a !== '.');
  const ids = wanted.length ? wanted : listProfiles().concat('app');
  try {
    for (const id of ids) await makeIcons(id);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
  app.quit();
});

app.on('window-all-closed', () => {});
