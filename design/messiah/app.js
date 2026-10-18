(function(){
  'use strict';
  const plates=window.MESSIAH_PLATES,engine=window.MESSIAH_ENGINE;
  const plateCount=plates.length;
  const $=id=>document.getElementById(id);
  const grid=$('plateGrid'),filters=$('filters'),preview=$('previewCanvas'),previewWrap=$('previewWrap');
  const contexts=new Map(),visible=new Set();
  const families=['All','Glass','Flight','Arena','Campus','Signal','Unity','Hardline'];
  const storageKey='messiah-motion-shortlist-v1';
  let picks;
  try{picks=new Set(JSON.parse(localStorage.getItem(storageKey)||'[]'));}catch(e){picks=new Set();}
  let current=plates[0],family='All',onlyPicks=false,guide=false,logoPreview=false,lastThumb=0,lastMain=0;
  let recording=false;
  function savePicks(){try{localStorage.setItem(storageKey,JSON.stringify([...picks]));}catch(e){}updateSelection();}
  function updateSelection(){
    $('shortlistCount').textContent=picks.size;
    $('pickButton').textContent=picks.has(current.id)?'★ Shortlisted':'☆ Add to shortlist';
    contexts.forEach((v,id)=>{const b=v.card.querySelector('.star');b.textContent=picks.has(id)?'★':'☆';b.classList.toggle('on',picks.has(id));b.setAttribute('aria-label',(picks.has(id)?'Remove ':'Add ')+v.plate.name+(picks.has(id)?' from shortlist':' to shortlist'));});
    applyFilter();
  }
  function togglePick(id){picks.has(id)?picks.delete(id):picks.add(id);if(!picks.size)onlyPicks=false;savePicks();}
  function select(p){
    current=p;
    contexts.forEach((v,id)=>v.card.classList.toggle('selected',id===p.id));
    $('detailNumber').textContent=`${p.id} / ${plateCount}`;
    $('detailFamily').textContent=p.family+' / '+p.energy+' motion';
    $('detailTitle').textContent=p.name;
    $('detailNote').textContent=p.note;
    $('detailScenes').textContent=p.scenes;
    $('detailEnergy').textContent=p.energy;
    $('pickButton').textContent=picks.has(p.id)?'★ Shortlisted':'☆ Add to shortlist';
    $('exportStatus').textContent='';
    if(window.innerWidth<900)previewWrap.scrollIntoView({behavior:'smooth',block:'center'});
  }
  function applyFilter(){
    let count=0;
    contexts.forEach(v=>{let show=(family==='All'||v.plate.family===family)&&(!onlyPicks||picks.has(v.plate.id));v.card.hidden=!show;if(show)count++;});
    $('selectionText').textContent=!count&&onlyPicks?'No plates in this filter. Clear the shortlist filter or choose another family.':picks.size?[...picks].sort().map(id=>`${id} ${plates.find(p=>p.id===id)?.name||''}`).join(' · '):'No plates selected yet.';
    filters.querySelectorAll('.filter').forEach(b=>b.classList.toggle('active',b.dataset.family===family));
    $('shortlistFilter').classList.toggle('active',onlyPicks);
  }
  families.forEach(f=>{let b=document.createElement('button');b.type='button';b.className='filter';b.dataset.family=f;b.textContent=f;b.onclick=()=>{family=f;onlyPicks=false;applyFilter();};filters.appendChild(b);});
  $('shortlistFilter').onclick=()=>{onlyPicks=!onlyPicks;applyFilter();};
  const observer=('IntersectionObserver' in window)?new IntersectionObserver(entries=>{entries.forEach(e=>e.isIntersecting?visible.add(e.target.dataset.id):visible.delete(e.target.dataset.id));},{rootMargin:'120px'}):null;
  plates.forEach(p=>{
    const card=document.createElement('article');card.className='plate-card';card.dataset.id=p.id;card.tabIndex=0;
    card.innerHTML=`<canvas width="384" height="216" aria-hidden="true"></canvas><div class="plate-top"><span class="plate-number">${p.id} / ${plateCount}</span><span class="plate-family">${p.family.toUpperCase()}</span></div><div class="plate-footer"><div><h3>${p.name}</h3><small>${p.energy.toUpperCase()} MOTION · ${p.scenes.split(' · ')[0].toUpperCase()}</small></div><button type="button" class="star" aria-label="Add ${p.name} to shortlist">☆</button></div>`;
    const canvas=card.querySelector('canvas');contexts.set(p.id,{plate:p,card,canvas,ctx:canvas.getContext('2d',{alpha:false})});
    card.addEventListener('click',()=>select(p));card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(p);}});
    card.querySelector('.star').addEventListener('click',e=>{e.stopPropagation();togglePick(p.id);});
    grid.appendChild(card);if(observer)observer.observe(card);else visible.add(p.id);
  });
  const mainCtx=preview.getContext('2d',{alpha:false});
  function tick(ms){
    if(!document.hidden){
      const sec=ms/1000;
      if(ms-lastMain>32){engine.draw(mainCtx,current,sec,preview.width,preview.height);lastMain=ms;}
      if(ms-lastThumb>80){contexts.forEach((v,id)=>{if(visible.has(id)&&!v.card.hidden)engine.draw(v.ctx,v.plate,sec,v.canvas.width,v.canvas.height);});lastThumb=ms;}
    }
    requestAnimationFrame(tick);
  }
  select(current);updateSelection();requestAnimationFrame(tick);
  $('pickButton').onclick=()=>togglePick(current.id);
  $('logoButton').onclick=()=>{logoPreview=!logoPreview;$('logoGuide').hidden=!logoPreview;$('logoButton').textContent=logoPreview?'Hide logo':'Preview logo';};
  $('guideButton').onclick=()=>{guide=!guide;$('safeGuide').hidden=!guide;$('guideButton').textContent=guide?'Hide safe area':'Safe area';};
  $('fullButton').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else previewWrap.requestFullscreen?.();};
  document.addEventListener('fullscreenchange',()=>{preview.width=document.fullscreenElement?1920:960;preview.height=document.fullscreenElement?1080:540;});
  function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);}
  $('pngButton').onclick=async()=>{const p=current;$('exportStatus').textContent='Preparing 1920 × 1080 still…';if(p.family==='Hardline'&&!await engine.marksReady){$('exportStatus').textContent='Source mark assets failed to load.';return;}const c=document.createElement('canvas');c.width=1920;c.height=1080;engine.draw(c.getContext('2d'),p,0,c.width,c.height);c.toBlob(b=>{if(!b){$('exportStatus').textContent='PNG export failed in this browser.';return;}download(b,`messiah-${p.id}-${p.key}-1920x1080.png`);$('exportStatus').textContent='PNG downloaded.';},'image/png');};
  $('webmButton').onclick=async()=>{
    if(recording)return;
    if(!HTMLCanvasElement.prototype.captureStream||!window.MediaRecorder){$('exportStatus').textContent='WebM recording needs current Chrome or Edge.';return;}
    const type=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
    if(!type){$('exportStatus').textContent='This browser has no WebM encoder.';return;}
    recording=true;const p=current,button=$('webmButton');button.disabled=true;
    try{
      if(p.family==='Hardline'&&!await engine.marksReady)throw new Error('Source mark assets failed to load');
      const c=document.createElement('canvas');c.width=1920;c.height=1080;const cx=c.getContext('2d',{alpha:false});engine.draw(cx,p,0,c.width,c.height);
      const stream=c.captureStream(30),chunks=[],rec=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:8000000});
      const finished=new Promise((resolve,reject)=>{rec.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};rec.onstop=resolve;rec.onerror=e=>reject(e.error||new Error('Recording failed'));});
      rec.start();const start=performance.now();
      await new Promise(resolve=>{function frame(now){const elapsed=(now-start)/1000;engine.draw(cx,p,Math.min(elapsed,8),c.width,c.height);$('exportStatus').textContent=`Recording ${p.name}: ${Math.min(100,Math.round(elapsed/8*100))}%`;if(elapsed>=8)resolve();else requestAnimationFrame(frame);}requestAnimationFrame(frame);});
      rec.stop();await finished;stream.getTracks().forEach(track=>track.stop());download(new Blob(chunks,{type:'video/webm'}),`messiah-${p.id}-${p.key}-8s-1920x1080.webm`);$('exportStatus').textContent='WebM downloaded. Check playback before OBS use.';
    }catch(e){$('exportStatus').textContent='Recording failed: '+(e.message||e);}finally{recording=false;button.disabled=false;}
  };
  $('copyButton').onclick=async()=>{const text=[...picks].sort().map(id=>`${id} ${plates.find(p=>p.id===id).name}`).join('\n');if(!text){$('selectionText').textContent='Choose plates first.';return;}try{await navigator.clipboard.writeText(text);$('selectionText').textContent='Copied '+picks.size+' plate choices.';}catch(e){window.prompt('Copy your selections:',text);}};
})();
