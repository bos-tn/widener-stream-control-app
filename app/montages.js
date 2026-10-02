// Game montage videos (v0.10.0). Each game in games.json can name a montage
// on the team Google Drive ({file, driveId, bytes}). The videos are 0.5 to
// 1.6 GB each, far too big for the installer or an auto-update, so each PC
// downloads them on demand into its own data folder: the first time a game is
// picked, or all at once from the Setup tab. After that they play from disk
// and never need the internet again.
//
// The same downloader also fetches the included background music track
// (server.js, v0.11.0): an .m4a has the same 'ftyp' header check as an .mp4.
//
// The Drive files are shared "anyone with the link", so no sign-in is needed.
// Downloads go one at a time (a 1.6 GB file competing with the stream's own
// upload is bad enough), resume from a .part file after a dropped connection,
// and only become usable once the size and MP4 header check out, so OBS can
// never be handed a half-written or HTML-error file.

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const PROGRESS_MS = 500;

function driveUrl(id) {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
}

// opts.dir: where the videos live. opts.games: games.json. opts.onChange():
// called (throttled during a download) whenever status() would differ.
function createMontages(opts) {
  const dir = opts.dir;
  const onChange = opts.onChange || (() => {});
  const entries = {};
  (opts.games || []).forEach((g) => {
    if (g.montage && g.montage.file && g.montage.driveId) {
      entries[g.id] = { ...g.montage, have: false, downloading: false, queued: false, received: 0, error: '' };
    }
  });
  const queue = [];
  let active = null;
  let lastNotify = 0;

  function filePath(e) { return path.join(dir, e.file); }

  function sizeOf(f) {
    try { return fs.statSync(f).size; } catch (e) { return -1; }
  }

  // A finished file is trusted only if it is exactly the expected size. A
  // file of a different size is left alone (it may be a newer edit someone
  // copied in by hand) and reported, rather than overwritten.
  function check(e) {
    const size = sizeOf(filePath(e));
    e.have = size === e.bytes;
    if (size >= 0 && !e.have) e.error = `The file on this PC is ${size} bytes, expected ${e.bytes}. Delete it to download again.`;
    if (!e.have && !e.downloading) e.received = Math.max(0, sizeOf(filePath(e) + '.part'));
  }
  Object.values(entries).forEach(check);

  function status() {
    const out = {};
    Object.entries(entries).forEach(([id, e]) => {
      out[id] = {
        file: e.file, bytes: e.bytes, have: e.have, downloading: e.downloading,
        queued: e.queued, received: e.received, error: e.error,
      };
    });
    return out;
  }

  function notify(force) {
    const now = Date.now();
    if (!force && now - lastNotify < PROGRESS_MS) return;
    lastNotify = now;
    onChange();
  }

  // The one route the overlay may load a montage from. Only finished files.
  function readyPath(file) {
    const e = Object.values(entries).find((x) => x.file === file);
    return e && e.have ? filePath(e) : null;
  }

  // Queue a download. `first` puts it at the front: the game the operator
  // just picked shouldn't wait behind a "download all". Picking a game again
  // doesn't retry a download that failed (every edit would hammer Drive);
  // the panel's Download button passes `retry`.
  function ensure(id, first, retry) {
    const e = entries[id];
    if (!e || e.have || e.downloading) return false;
    if (e.error && !retry) return false;
    if (sizeOf(filePath(e)) >= 0) return false; // wrong-size file: see check()
    e.error = '';
    const at = queue.indexOf(id);
    if (at >= 0) queue.splice(at, 1);
    if (first) queue.unshift(id); else queue.push(id);
    e.queued = true;
    notify(true);
    pump();
    return true;
  }

  function ensureAll() {
    Object.keys(entries).forEach((id) => ensure(id, false, true));
  }

  async function pump() {
    if (active || !queue.length) return;
    const id = queue.shift();
    const e = entries[id];
    active = id;
    e.queued = false;
    e.downloading = true;
    notify(true);
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
      try {
        await download(e);
        e.error = '';
        break;
      } catch (err) {
        e.error = (err && err.message) || String(err);
        if (err && err.fatal) break;
        if (attempt < RETRIES) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
    e.downloading = false;
    check(e);
    if (e.have) e.error = '';
    active = null;
    notify(true);
    pump();
  }

  function fatal(msg) {
    const err = new Error(msg);
    err.fatal = true;
    return err;
  }

  async function download(e) {
    fs.mkdirSync(dir, { recursive: true });
    const part = filePath(e) + '.part';
    let start = Math.max(0, sizeOf(part));
    if (start > e.bytes) { fs.unlinkSync(part); start = 0; }
    if (start < e.bytes) {
      const res = await fetch(driveUrl(e.driveId), { headers: start ? { Range: `bytes=${start}-` } : {} });
      const type = (res.headers.get('content-type') || '').toLowerCase();
      // A private or removed file comes back as a Google sign-in or error
      // page, with a 200. Never write that into an .mp4.
      if (type.includes('text/html')) {
        throw fatal('Google Drive sent a web page instead of the file. Check it is still shared "Anyone with the link".');
      }
      if (res.status === 404) throw fatal('The file is no longer on Google Drive.');
      if (res.status !== 200 && res.status !== 206) throw new Error(`Google Drive answered ${res.status}`);
      if (res.status === 200) start = 0; // range ignored: start over
      const len = Number(res.headers.get('content-length'));
      if (len && start + len !== e.bytes) {
        throw fatal(`The file on Drive is ${start + len} bytes, expected ${e.bytes}. It may have been replaced; update the app's file list.`);
      }
      e.received = start;
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(part, { flags: start ? 'a' : 'w' });
        const body = Readable.fromWeb(res.body);
        body.on('data', (chunk) => { e.received += chunk.length; notify(false); });
        body.on('error', (err) => { out.destroy(); reject(err); });
        out.on('error', reject);
        out.on('finish', resolve);
        body.pipe(out);
      });
    }
    const got = sizeOf(part);
    if (got !== e.bytes) throw new Error(`Download stopped at ${got} of ${e.bytes} bytes`);
    const head = Buffer.alloc(8);
    const fd = fs.openSync(part, 'r');
    try { fs.readSync(fd, head, 0, 8, 0); } finally { fs.closeSync(fd); }
    if (head.toString('latin1', 4, 8) !== 'ftyp') {
      fs.unlinkSync(part);
      throw fatal('The downloaded file is not an MP4 or M4A file.');
    }
    fs.renameSync(part, filePath(e));
  }

  return { status, ensure, ensureAll, readyPath, has: (id) => !!(entries[id] && entries[id].have) };
}

module.exports = { createMontages };
