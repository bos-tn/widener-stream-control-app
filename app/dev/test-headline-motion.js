// Frame-by-frame headline regression: replay OBS entrances while state updates
// arrive. Uses isolated demo data; no OBS connection or installed data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messiah-visual-'));
app.setPath('userData', path.join(dataDir, 'electron'));
const profileId = process.env.STREAM_REVIEW_PROFILE || 'messiah';
Object.assign(process.env, { STREAM_PROFILE:profileId, STREAM_NO_LOCAL:'1', STREAM_APP_DATA:dataDir, STREAM_DATA_DIR:dataDir,
  STREAM_DEMO:'1', WIDENER_RL_PORT:'49203', WIDENER_MUSIC_DIR:path.join(dataDir,'music'), WIDENER_MONTAGE_DIR:path.join(dataDir,'montages') });
const { seed, PRESETS } = require('./demo');
seed(dataDir);
const { loadProfile } = require('../profile');
const profile = loadProfile(profileId);
const port = 4395;
const base = `http://127.0.0.1:${port}`;
let server, win, socket;
const pause = (ms) => new Promise((r) => setTimeout(r,ms));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor','1');

function patch(data) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('State update timed out')),5000);
    const onMessage = (raw) => {
      if (JSON.parse(raw).type !== 'state') return;
      clearTimeout(timer); socket.off('message',onMessage); resolve();
    };
    socket.on('message',onMessage);
    socket.send(JSON.stringify({type:'update',data}));
  });
}
function home(preset = 'rl') {
  const p = PRESETS[preset]();
  if (profileId === 'messiah' && !['long','blank'].includes(preset)) p.teamA = { ...p.teamA, name:'Messiah University', tag:'MU', color:'#002856', colorAlt:'#BEC0C2', logoUrl:'/brand/logo.png' };
  if (preset === 'long') {
    p.views['starting-soon'].title = 'Messiah Esports Invitational Grand Final Starts Soon';
    p.views['starting-soon'].subtitle = 'Presented by the Messiah University Esports Program';
  }
  return { ...p, montage:false, layout:'right', durationSec:600, countdownMode:'duration', end:new Date(Date.now()+600000).toISOString(), backgrounds:{} };
}

app.whenReady().then(async () => {
  let failed = 0;
  try {
    server = require('../server').createServer(port,{profile,host:'127.0.0.1'});
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise(resolve => socket.once('open',resolve));
    socket.send(JSON.stringify({type:'subscribe',role:'panel'}));
    await pause(100);
    win = new BrowserWindow({width:1920,height:1080,show:false,frame:false,webPreferences:{offscreen:true,backgroundThrottling:false}});
    win.webContents.setFrameRate(60); win.webContents.setAudioMuted(true);
    for (const preset of ['rl','long']) {
      await patch(home(preset));
      for (const view of ['starting-soon','brb','post-match','versus']) {
        await win.loadURL(`${base}/overlay?view=${view}`);
        // The initial match arrives over WebSocket after the document loads.
        // Wait for actual copy before asking for the fonts it uses.
        for(let i=0;i<100;i++) {
          if(await win.webContents.executeJavaScript("[...document.querySelectorAll('.bx-view.on .bx-title,.bx-view.on .bx-vs-name span')].some(el=>el.clientWidth && el.textContent.trim())")) break;
          await pause(25);
        }
        await win.webContents.executeJavaScript('document.fonts.ready');
        const readSizes = () => win.webContents.executeJavaScript("[...document.querySelectorAll('.bx-view.on .bx-title,.bx-view.on .bx-vs-name span,.bx-view.on .bx-pm-name')].filter(el=>el.clientWidth).map(el=>getComputedStyle(el).fontSize).join(',')");
        const initial = await readSizes();
        assert(initial,`${view}: headline must render before measurement`);
        await pause(2600);
        const baseline = await readSizes();
        if(initial!==baseline) { failed++; console.log(`FAIL cold load ${view}: ${initial} -> ${baseline}`); }
        await win.webContents.executeJavaScript(`(() => {
          window.motionSamples=[];
          window.motionDone=false;
          const start=performance.now();
          const sample=()=>{
            const els=[...document.querySelectorAll('.bx-view.on .bx-title,.bx-view.on .bx-vs-name span,.bx-view.on .bx-pm-name')].filter(el=>el.clientWidth);
            motionSamples.push({t:Math.round(performance.now()-start),size:els.map(el=>getComputedStyle(el).fontSize).join(',')});
            if(performance.now()-start<2800) requestAnimationFrame(sample);
            else window.motionDone=true;
          };
          window.dispatchEvent(new CustomEvent('obsSourceActiveChanged',{detail:{active:true}}));
          requestAnimationFrame(sample);
        })()`);
        await pause(500); await patch({layout:'right'});
        await pause(700); await patch({layout:'right'});
        await pause(1700);
        for(let i=0;i<100;i++) {
          if(await win.webContents.executeJavaScript('motionDone')) break;
          await pause(50);
        }
        const samples=await win.webContents.executeJavaScript('motionSamples');
        const changes=samples.filter((s,i)=>!i||s.size!==samples[i-1].size);
        const ok=samples.length>=5 && samples.at(-1).t>=2800 && samples.every(s=>s.size===baseline);
        console.log(`${ok?'PASS':'FAIL'} ${profileId} ${preset} ${view}: baseline ${baseline}, ${samples.length} frames, ${JSON.stringify(changes)}`);
        if(!ok)failed++;
      }
    }
    assert.equal(failed,0,'headline size must remain stable during OBS entrances and unrelated state updates');
  } catch(e) { console.error(e); process.exitCode=1; }
  finally { if(win)win.destroy(); if(socket)socket.close(); if(server)server.close(); app.exit(process.exitCode||0); }
});
