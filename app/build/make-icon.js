// Run with: npm run icons            (every profile)
//      or:  npm run icons -- lote    (one profile)
// Builds icon.ico and per-size PNGs for a league profile from its real
// source logo, profiles/<id>/icon-source.png (a square PNG, 512 px or larger),
// instead of a hand-drawn recreation. Output: profiles/<id>/icons/.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { PROFILES_DIR, listProfiles } = require('../profile');

async function makeIcons(id) {
  const sourcePng = path.join(PROFILES_DIR, id, 'icon-source.png');
  const source = nativeImage.createFromPath(sourcePng);
  if (source.isEmpty()) {
    throw new Error(`Could not read source icon at ${sourcePng}`);
  }

  const outDir = path.join(PROFILES_DIR, id, 'icons');
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
  const ids = wanted.length ? wanted : listProfiles();
  try {
    for (const id of ids) await makeIcons(id);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
  app.quit();
});

app.on('window-all-closed', () => {});
