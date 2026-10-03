// Run with: npm run stinger -- <profile>   (needs ffmpeg on the PATH)
// Renders a league's drawn stinger (two angled panels in the league colours
// sweeping across, the second carrying the mark) frame by frame and encodes
// it as a transparent VP9 WebM for an OBS Stinger transition:
// profiles/<id>/assets/stinger.webm. Used for a league whose brand has no
// stinger video of its own (League of the East). The frames are drawn on a
// canvas at exact times, so the video is the same on every run.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadProfile } = require('../profile');

const FPS = 60;
// Timeline (ms), matching v1.0.0's in-overlay transition: panel 1 sweeps in,
// panel 2 follows 80 ms later and fully covers at 500, a short hold, then they
// sweep out in reverse order. OBS cuts to the new scene at the transition
// point, the middle of the full cover.
const IN_MS = 420, STAGGER = 80, HOLD_END = 680, END_MS = 1220;
const TRANSITION_POINT = 590;

const id = process.argv.slice(2).find((a) => /^[a-z0-9-]+$/.test(a)) || 'lote';

const PAGE = `<!doctype html><html><body style="margin:0;background:transparent">
<canvas id="c" width="1920" height="1080"></canvas>
<script>
const c = document.getElementById('c'), g = c.getContext('2d');
// cubic-bezier(.7,0,.25,1)
function bez(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t, sy = (t) => ((ay * t + by) * t + cy) * t;
  return (x) => { let lo = 0, hi = 1, t = x; for (let i = 0; i < 40; i++) { t = (lo + hi) / 2; if (sx(t) < x) lo = t; else hi = t; } return sy(t); };
}
const ease = bez(.7, 0, .25, 1);
const W = 1920, H = 1080, PW = W * 1.4, LEFT = -W * .2, SKEW = Math.tan(12 * Math.PI / 180);
// One skewed panel whose box is translated by tx (fraction of its width).
function panel(tx, fill) {
  const x0 = LEFT + tx * PW, half = SKEW * H / 2;
  g.beginPath();
  g.moveTo(x0 + half, 0); g.lineTo(x0 + PW + half, 0);
  g.lineTo(x0 + PW - half, H); g.lineTo(x0 - half, H); g.closePath();
  g.fillStyle = fill; g.fill();
  return x0 + PW / 2;
}
// Panel position at time t: off left (-1.2), covering (0), off right (1.2).
function pos(t, inStart, outStart) {
  if (t < inStart) return -1.2;
  if (t < inStart + ${IN_MS}) return -1.2 + 1.2 * ease((t - inStart) / ${IN_MS});
  if (t < outStart) return 0;
  if (t < outStart + ${IN_MS}) return 1.2 * ease((t - outStart) / ${IN_MS});
  return 1.2;
}
window.frame = (t, colors, mark) => new Promise((done) => {
  g.clearRect(0, 0, W, H);
  panel(pos(t, 0, ${HOLD_END} + ${STAGGER}), colors.a);
  const cx = panel(pos(t, ${STAGGER}, ${HOLD_END}), colors.b);
  const img = new Image();
  img.onload = () => { g.drawImage(img, cx - 170, H / 2 - 170, 340, 340); done(c.toDataURL('image/png')); };
  img.src = mark;
});
</script></body></html>`;

app.whenReady().then(async () => {
  try {
    const p = loadProfile(id);
    const colors = { a: p.colors.primary || '#8205A7', b: p.colors.panelDark || '#1A0327' };
    const markFile = path.join(p.assetsDir, p.assets.watermark || p.assets.logo);
    const mark = 'data:image/png;base64,' + fs.readFileSync(markFile).toString('base64');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `stinger-${id}-`));
    const win = new BrowserWindow({ width: 1920, height: 1080, show: false });
    await win.loadURL('data:text/html;base64,' + Buffer.from(PAGE).toString('base64'));
    const frames = Math.round(END_MS / 1000 * FPS);
    for (let i = 0; i < frames; i++) {
      const t = i * 1000 / FPS;
      const url = await win.webContents.executeJavaScript(`frame(${t}, ${JSON.stringify(colors)}, ${JSON.stringify(mark)})`);
      fs.writeFileSync(path.join(tmp, `f${String(i).padStart(4, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
    win.destroy();
    const out = path.join(p.assetsDir, 'stinger.webm');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(tmp, 'f%04d.png'),
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '28', '-auto-alt-ref', '0', out]);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`Stinger written to ${out} (${frames} frames at ${FPS} fps, transition point ${TRANSITION_POINT} ms)`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
  app.quit();
});
app.on('window-all-closed', () => {});
