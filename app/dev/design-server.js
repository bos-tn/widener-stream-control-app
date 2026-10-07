// The app's server with demo data, for reviewing the broadcast package's
// designs (test branch): node app/dev/design-server.js, then open
// http://localhost:4313/showcase.
//
// It keeps its own data folder (app/data/design, seeded on the first run), so
// the real app's match and library are never touched. The highlight videos
// and music are read from the real dev folders if they have been downloaded.
// The game feed is pointed at a port nothing listens on.

const path = require('path');
const fs = require('fs');

const dataRoot = path.join(__dirname, '..', 'data');
const dataDir = process.env.STREAM_DATA_DIR || path.join(dataRoot, 'design');
process.env.STREAM_DATA_DIR = dataDir;
process.env.STREAM_DEMO = '1';
if (!process.env.WIDENER_MONTAGE_DIR) process.env.WIDENER_MONTAGE_DIR = path.join(dataRoot, 'montages');
if (!process.env.WIDENER_MUSIC_DIR) process.env.WIDENER_MUSIC_DIR = path.join(dataRoot, 'music');
if (!process.env.WIDENER_RL_PORT) process.env.WIDENER_RL_PORT = '49199';

// --fresh starts the demo over.
if (process.argv.includes('--fresh')) fs.rmSync(dataDir, { recursive: true, force: true });
if (require('./demo').seed(dataDir)) console.log(`Demo data written to ${dataDir}`);

const { createServer, PROFILE } = require('../server');
const port = Number(process.env.PORT) || 4313;
createServer(port);
console.log(`${PROFILE.name} design review: http://localhost:${port}/showcase`);
