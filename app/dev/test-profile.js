// Profile isolation and scene smoke test. Optional root may point at app.asar
// when run by the packaged exe with ELECTRON_RUN_AS_NODE=1.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const id = process.argv[2] || 'lote';
const root = path.resolve(process.argv[3] || path.join(__dirname, '..'));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-release-test-'));
Object.assign(process.env, { STREAM_PROFILE:id, STREAM_NO_LOCAL:'1', STREAM_DATA_DIR:data,
  STREAM_APP_DATA:data, WIDENER_RL_PORT:'49202', WIDENER_MUSIC_DIR:path.join(data,'music'), WIDENER_MONTAGE_DIR:path.join(data,'montages') });
fs.writeFileSync(path.join(data,'settings.json'), JSON.stringify({music:{enabled:false},panel:{setupDone:true,guideV2:true}}));
fs.writeFileSync(path.join(data,'broadcast.json'), JSON.stringify({v:1,defaultsDone:true}));
const { loadProfile, listProfiles } = require(path.join(root,'profile'));
const profile = loadProfile(id);
const { createMockObs } = require('./mock-obs');
const mock = createMockObs(4469);
const server = require(path.join(root,'server')).createServer(4399,{profile,host:'127.0.0.1'});
const base='http://127.0.0.1:4399';
const post = async (route,data={}) => (await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})).json();
(async()=>{
  try {
    assert.deepEqual(listProfiles().sort(),['lote','messiah','widener']);
    const brand=await (await fetch(base+'/api/profile')).json();
    assert.equal(brand.id,id);
    for(const url of ['/control','/overlay?view=starting-soon','/brand.js','/brand.css',brand.logo]) {
      assert.equal((await fetch(base+url)).status,200,url);
    }
    assert.equal((await fetch(base+'/api/bx')).status,profile.broadcast.enabled?200:404);
    assert.equal((await post('/api/obs/connect',{host:'127.0.0.1',port:4469,password:''})).connected,true);
    const first=await post('/api/obs/build-scenes');
    assert(!first.error,JSON.stringify(first));
    const scenes=mock.sceneNames();
    assert(scenes.length>=9,JSON.stringify(scenes));
    assert(scenes.every(n=>n.startsWith(profile.obs.prefix+': ')));
    const inputs=Object.values(mock.state.inputs);
    const pages=inputs.filter(i=>i.kind==='browser_source' && /overlay/.test(i.settings.url||''));
    assert(pages.length>=9);
    assert(pages.every(i=>i.settings.url.startsWith('http://localhost:4399/')));
    await post('/api/obs/build-scenes');
    assert.deepEqual(mock.sceneNames(),scenes,'rebuild must preserve scene set and order');
    if(root.endsWith('.asar')) {
      for(const folder of ['dev','build','data']) assert(!fs.existsSync(path.join(root,folder)),folder+' excluded');
      for(const p of listProfiles()) {
        assert(!fs.existsSync(path.join(root,'profiles',p,'local.json')),'local camera settings excluded');
        const loaded=loadProfile(p);
        assert.equal(loaded.headlineFonts.missing.length,0,p+' fonts');
      }
      assert(fs.existsSync(path.join(root,'profiles/messiah/assets/stinger.webm')));
    }
    console.log(`PASS ${id}: assets, isolated scene URLs, ${scenes.length} scenes, idempotent rebuild${root.endsWith('.asar')?', packaged files and fonts':''}`);
  } catch(e) { console.error(e); process.exitCode=1; }
  finally {
    await post('/api/obs/disconnect').catch(()=>{}); server.close(); await mock.close();
    if(path.dirname(data)===os.tmpdir() && path.basename(data).startsWith('profile-release-test-'))fs.rmSync(data,{recursive:true,force:true});
    setTimeout(()=>process.exit(process.exitCode||0),300);
  }
})();
