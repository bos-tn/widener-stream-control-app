// Run with: node_modules/.bin/electron build/make-icon.js
// Builds icon.ico and per-size PNGs from the real source logo (a 512x512
// transparent PNG provided by the team), instead of a hand-drawn recreation.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const SOURCE_PNG = path.join(__dirname, '..', '..', 'widener-stream-control-app-icon.png');

app.whenReady().then(async () => {
  const source = nativeImage.createFromPath(SOURCE_PNG);
  if (source.isEmpty()) {
    throw new Error(`Could not read source icon at ${SOURCE_PNG}`);
  }

  const outDir = path.join(__dirname, 'icons');
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
  app.quit();
});

app.on('window-all-closed', () => {});
