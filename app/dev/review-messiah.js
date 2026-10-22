// Deterministic release review in Electron, using isolated data and no OBS.
// node_modules/.bin/electron dev/review-messiah.js [output folder]
// Outputs 1080p PNGs and a JSON report; exits nonzero on layout/runtime errors.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messiah-visual-'));
app.setPath('userData', path.join(dataDir, 'electron'));
const output = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'messiah-release-review', 'after'));
const profileId = process.env.STREAM_REVIEW_PROFILE || 'messiah';
Object.assign(process.env, { STREAM_PROFILE:profileId, STREAM_NO_LOCAL:'1', STREAM_APP_DATA:dataDir, STREAM_DATA_DIR:dataDir,
  STREAM_DEMO:'1', WIDENER_RL_PORT:'49201', WIDENER_MUSIC_DIR:path.join(dataDir,'music'), WIDENER_MONTAGE_DIR:path.join(dataDir,'montages') });
const { seed, PRESETS } = require('./demo');
seed(dataDir);
const { loadProfile } = require('../profile');
const profile = loadProfile(profileId);
const port = 4394;
const base = `http://127.0.0.1:${port}`;
let server, win, socket;
const report = [];
const errors = [];
const pause = (ms) => new Promise((r) => setTimeout(r,ms));
const post = (url,data) => fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
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
async function shot(name, view, size = [1920,1080], ready) {
  win.setContentSize(...size);
  await win.loadURL(`${base}/${view.startsWith('control') ? view : 'overlay?view='+view}`);
  await win.webContents.executeJavaScript('document.fonts.ready');
  for (let i=0;i<50;i++) {
    if (await win.webContents.executeJavaScript(view.startsWith('control') ? "!!document.querySelector('#obsBanner') || document.body.innerText.includes('Match')" : "!!document.querySelector('.bx-view.on') || ['stats','scoreboard'].includes(document.body.dataset.mode)")) break;
    await pause(100);
  }
  // Let the real entrance and its deferred stinger cue finish. Removing the
  // class early races that cue and can capture invisible or moving content.
  if (ready) { await pause(300); await ready(); }
  await pause(3200);
  await pause(100);
  const audit = await win.webContents.executeJavaScript(`(() => {
    const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const selectors = '.bx-view.on .bx-title,.bx-view.on .bx-sub,.bx-view.on .bx-next,.bx-view.on .bx-brb-sub,.bx-view.on .bx-vs-name span,.bx-view.on .bx-pm-name,.bx-view.on .bx-ro-name,.bx-view.on .bx-ro-p .g,.bx-view.on .bx-ro-p .r,.bx-view.on .bx-group-card-label b,.bx-mast-game,.bx-mast-info,.bx-lower.show .bx-lower-title,.bx-lower.show .bx-lower-sub,.bx-alert-note b,.brand-title,.brand-sub';
    const overflow = [...document.querySelectorAll(selectors)].filter(visible).filter(el => {
      const cs=getComputedStyle(el), max=parseFloat(cs.maxHeight);
      // Visible font ink can extend below its line box without being cut.
      // Fail actual clipping, a bounded slot overflow, or horizontal overflow.
      return el.scrollWidth > el.clientWidth+3 || (el.scrollHeight > el.clientHeight+3 && (cs.overflowY==='hidden' || (Number.isFinite(max) && el.scrollHeight>max+3)));
    }).map(el => ({class:el.className,text:el.textContent,client:[el.clientWidth,el.clientHeight],scroll:[el.scrollWidth,el.scrollHeight]}));
    const broken = [...document.images].filter(visible).filter(el => el.src && el.complete && !el.naturalWidth).map(el => el.src);
    const rect = el => { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; };
    const frames = [...document.querySelectorAll('.bx-group-card')].map(rect);
    const overlaps = [];
    const pairs = [['.bx-hero-left','.bx-hero-right'],['.bx-brb-left','.bx-brb-right'],['.bx-vs-side.a','.bx-vs-side.b']];
    for (const [a,b] of pairs) { const x=document.querySelector('.bx-view.on '+a),y=document.querySelector('.bx-view.on '+b); if(!x||!y)continue; const p=rect(x),q=rect(y); if(Math.min(p.x+p.w,q.x+q.w)>Math.max(p.x,q.x)+1 && Math.min(p.y+p.h,q.y+q.h)>Math.max(p.y,q.y)+1)overlaps.push([a,b]); }
    const rail=document.querySelector('.bx-rail');
    const foot=document.querySelector('.bx-view.on .bx-group-foot');
    if(foot&&visible(rail)&&rect(foot).y+rect(foot).h>rect(rail).y)overlaps.push(['camera footer','ticker']);
    for(const pip of document.querySelectorAll('.bx-pip')) {
      if(document.querySelector('.bx-root[data-rail="1"]') && rect(pip).y+rect(pip).h>rect(rail).y)overlaps.push(['camera window','ticker']);
    }
    if(location.pathname==='/control' && document.documentElement.scrollWidth>innerWidth+2)overlaps.push(['control panel','horizontal overflow']);
    const header=[...document.querySelectorAll('.topbar > *')].filter(visible);
    for(let i=0;i<header.length;i++)for(let j=i+1;j<header.length;j++){
      const p=rect(header[i]),q=rect(header[j]);
      if(Math.min(p.x+p.w,q.x+q.w)>Math.max(p.x,q.x)+1 && Math.min(p.y+p.h,q.y+q.h)>Math.max(p.y,q.y)+1)overlaps.push([header[i].className,header[j].className]);
    }
    if(header.some(el=>rect(el).x<0 || rect(el).x+rect(el).w>innerWidth+1))overlaps.push(['header','outside viewport']);
    return {overflow,broken,overlaps,frames};
  })()`);
  if (view === 'camera-group') assert.deepEqual(audit.frames, profile.broadcast.cameraGroup.frames);
  const capture = await win.webContents.capturePage();
  if (view === 'camera-group') {
    const bitmap = capture.toBitmap();
    const alpha = (x,y) => bitmap[(y*1920+x)*4+3];
    for (const r of profile.broadcast.cameraGroup.frames) assert.equal(alpha(r.x+r.w/2,r.y+r.h/2),0,'camera aperture must be transparent');
    assert.equal(alpha(80,450),255,'camera matte must be opaque');
  }
  fs.writeFileSync(path.join(output,name+'.png'),capture.toPNG());
  report.push({name,view,...audit});
  console.log(name, audit.overflow.length || audit.broken.length || audit.overlaps.length ? JSON.stringify(audit) : 'OK');
}
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(output,{recursive:true});
    server = require('../server').createServer(port,{profile,host:'127.0.0.1'});
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve,reject) => { socket.once('open',resolve); socket.once('error',reject); });
    socket.send(JSON.stringify({type:'subscribe',role:'panel'}));
    await pause(200);
    win = new BrowserWindow({width:1920,height:1080,show:false,frame:false,transparent:true,useContentSize:true,backgroundColor:'#00000000',webPreferences:{offscreen:true,backgroundThrottling:false}});
    win.webContents.setFrameRate(30); win.webContents.setAudioMuted(true);
    win.webContents.on('console-message',(_e,level,message) => { if(level>=3)errors.push(message); });
    win.webContents.on('render-process-gone',(_e,details) => errors.push(JSON.stringify(details)));
    await patch(home());
    if (!process.env.STREAM_REVIEW_FOCUS) {
      for (const view of ['starting-soon','versus','roster','schedule','brb','post-match','camera-group','cam-player1','scoreboard','stats']) await shot(view,view);
      await patch({layout:'left'});
      await shot('starting-soon-left','starting-soon'); await shot('post-match-left','post-match');
      await patch(home('long'));
      for (const view of ['starting-soon','versus','roster','brb','post-match','scoreboard']) await shot('long-'+view,view);
      await patch(home('val')); await shot('five-player-roster','roster'); await shot('valorant-scoreboard','scoreboard');
      await patch(home('smash')); await shot('smash-scoreboard','scoreboard');
      const large=home('val');
      large.teamA.players=Array.from({length:11},(_,i)=>({gamertag:'FalconPlayer'+(i+1),name:'Player '+(i+1)}));
      await patch(large); await shot('large-roster','roster');
      await pause(8000);
      const playerNumbers=await win.webContents.executeJavaScript("[...document.querySelectorAll('.bx-ro-team.a .n')].map(el=>el.textContent)");
      assert.deepEqual(playerNumbers,['09','10','11'],'large lineups rotate without losing substitutes');
      await patch(home('blank'));
      for (const view of ['starting-soon','versus','roster','post-match']) await shot('blank-'+view,view);
      await patch(home());
      await shot('gameplay-graphics','scoreboard',[1920,1080],async()=>{
        await post('/api/bx/lower',{on:true,title:'Alexandria Montgomery — Messiah University Esports Broadcast Analyst',kicker:'Broadcast Team',sub:'Conference championship coverage with the Messiah Falcons',seconds:0});
        await post('/api/bx/alert',{title:'Conference championship coverage resumes after this short break',body:'Stay with us for the next match and interviews with the players.',kicker:'Broadcast update'});
      });
      await post('/api/bx/lower',{on:false});
      for (const bg of ['plate-30','plate-25','plate-08','plate-01','plate-05']) {
        await patch({backgrounds:{'starting-soon':bg}}); await shot(bg,'starting-soon');
      }
    }
    if(profile.broadcast.cameraGroup) await shot('gameplay-camera-ticker','scoreboard',[1920,1080],async()=>{
      await post('/api/bx/settings',{ticker:{on:true,gameplay:true,messages:['Messiah Esports — Go Falcons']},pip:{pos:'bottom-left',size:'m'}});
      await post('/api/bx/cam',{id:'player1',pip:true});
      await post('/api/bx/lower',{on:true,title:'Messiah Broadcast Team',kicker:'On air',sub:'Conference championship coverage',seconds:0});
    });
    await shot('live-panel','control?page=live',[1280,900]);
    await shot('match-panel','control?page=match',[1280,900]);
    if(profile.broadcast.enabled) await shot('broadcast-panel','control?page=broadcast',[1280,900],async()=>{
      await win.webContents.executeJavaScript("document.querySelector('#bxCamList').scrollIntoView({block:'center'})");
    });
    await shot('settings-panel','control?page=settings',[1280,900]);
    await shot('narrow-live-panel','control?page=live',[800,900]);
    await shot('dock-live-panel','control?page=live',[560,900]);
    await shot('large-text-live-panel','control?page=live',[1280,900],async()=>{
      await win.webContents.executeJavaScript("document.documentElement.dataset.text='xlarge'");
    });
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({report,errors},null,2));
    const failed=report.filter(r=>r.overflow.length||r.broken.length||r.overlaps.length);
    assert.equal(failed.length,0,`${failed.length} layouts failed; see report.json`);
    assert.equal(errors.length,0,errors.join('\n'));
    console.log(`PASS: ${report.length} renders, no text overflow, collisions, broken images or runtime errors. ${output}`);
  } catch(e) { console.error(e); process.exitCode=1; }
  finally { if(win)win.destroy(); if(socket)socket.close(); if(server)server.close(); app.exit(process.exitCode||0); }
});
