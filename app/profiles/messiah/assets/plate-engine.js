// Messiah beta plate renderer, adapted from design/messiah/plate-engine.js.
(function () {
  'use strict';
  const W = 1920, H = 1080, TAU = Math.PI * 2;
  const C = { navy:'#002856', deep:'#03182f', ink:'#061526', blue:'#1C8AC2', field:'#11698C', green:'#0B7367', purple:'#614495', gold:'#E5AE3A', orange:'#D6742A', red:'#A63738', white:'#ffffff', gray:'#5B6770', athleticsGray:'#BEC0C2' };
  function loadMark(src){const img=new Image();const ready=new Promise(resolve=>{img.onload=()=>resolve(true);img.onerror=()=>resolve(false);});img.src=src;return {img,ready};}
  const falcon=loadMark('/brand/guide/logo-blue-white.png');
  const esportsWordmark=loadMark('/brand/guide/wordmark-blue-white.png');
  const marksReady=Promise.all([falcon.ready,esportsWordmark.ready]).then(a=>a.every(Boolean));
  const rgba = (hex, a) => { const x=hex.replace('#',''); return `rgba(${parseInt(x.slice(0,2),16)},${parseInt(x.slice(2,4),16)},${parseInt(x.slice(4,6),16)},${a})`; };
  const mix = (a,b,t) => a+(b-a)*t;
  const wave = (t,n=1,o=0) => Math.sin(TAU*(t*n+o));
  const hash = n => { let x=Math.sin(n*127.1+78.233)*43758.5453; return x-Math.floor(x); };
  function fill(ctx,color){ ctx.fillStyle=color; ctx.fillRect(0,0,W,H); }
  function grad(ctx,x1,y1,x2,y2,stops){ const g=ctx.createLinearGradient(x1,y1,x2,y2); stops.forEach(([p,c])=>g.addColorStop(p,c)); return g; }
  function radial(ctx,x,y,r,inner,outer){ const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,inner);g.addColorStop(1,outer);return g; }
  function line(ctx,x1,y1,x2,y2,color,width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
  function poly(ctx,points,color,stroke,width=1){ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);for(let i=1;i<points.length;i++)ctx.lineTo(points[i][0],points[i][1]);ctx.closePath();if(color){ctx.fillStyle=color;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}}
  function ellipse(ctx,x,y,rx,ry,color){ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,TAU);ctx.fillStyle=color;ctx.fill();}
  function glow(ctx,x,y,r,color,a){ctx.fillStyle=radial(ctx,x,y,r,rgba(color,a),rgba(color,0));ctx.fillRect(x-r,y-r,r*2,r*2);}
  function mark(ctx,asset,x,y,w,a){if(!asset.img.complete||!asset.img.naturalWidth)return;ctx.save();ctx.globalAlpha=a;const h=w*asset.img.naturalHeight/asset.img.naturalWidth;ctx.drawImage(asset.img,x-w/2,y-h/2,w,h);ctx.restore();}
  function word(ctx,s,x,y,size,a,outline=false){ctx.save();ctx.font=`800 ${size}px Hanken, Arial, sans-serif`;ctx.textBaseline='middle';ctx.lineJoin='round';if(outline){ctx.strokeStyle=rgba(C.white,a);ctx.lineWidth=2;ctx.strokeText(s,x,y);}else{ctx.fillStyle=rgba(C.white,a);ctx.fillText(s,x,y);}ctx.restore();}
  function base(ctx,plate,t){
    const warm=['02','08','14','21','24'].includes(plate.id);
    fill(ctx,grad(ctx,0,0,W,H,[[0,warm?'#06172d':'#04152d'],[.5,'#002856'],[1,'#030e1c']]));
    glow(ctx,1600,300,850,warm?C.purple:C.blue,.18+.035*wave(t));
    glow(ctx,230,1000,680,warm?C.orange:C.field,.14);
    // A faint architectural grain gives empty areas depth without competing with scene copy.
    ctx.fillStyle='rgba(255,255,255,.014)';
    for(let i=0;i<70;i++){const x=hash(i+42)*W,y=hash(i+901)*H;ctx.fillRect(x,y,2,2);}
  }
  function finish(ctx){
    ctx.fillStyle=radial(ctx,960,540,1260,'rgba(0,0,0,0)','rgba(0,0,0,.40)');ctx.fillRect(0,0,W,H);
    line(ctx,0,0,W,0,'rgba(255,255,255,.055)',2);
  }
  function glass(ctx,v,t){
    if(v===1 || v===2){
      const warm=v===2, colors=warm?[C.gold,C.orange,C.blue,C.purple,C.white]:[C.blue,C.field,C.green,C.purple,C.white];
      for(let row=-1;row<5;row++)for(let col=-1;col<9;col++){
        const n=row*12+col+90, x=col*285-120+wave(t,1,n*.07)*22, y=row*290-110+wave(t,1,n*.11)*17;
        const k=hash(n), dx=92+80*k;
        poly(ctx,[[x,y],[x+280,y-32],[x+dx,y+270],[x-20,y+285]],rgba(colors[Math.floor(k*colors.length)],warm?.075:.067),'rgba(255,255,255,.10)',3);
        poly(ctx,[[x+280,y-32],[x+300,y+278],[x+dx,y+270]],rgba(colors[Math.floor(hash(n+18)*colors.length)],.11),null);
      }
      glow(ctx,warm?1450:1500,480,740,warm?C.gold:C.blue,warm?.17:.14);
      ctx.fillStyle=grad(ctx,0,0,W,0,[[0,'rgba(0,0,0,.08)'],[.29,'rgba(0,0,0,.38)'],[.7,'rgba(0,0,0,.36)'],[1,'rgba(0,0,0,.04)']]);ctx.fillRect(0,0,W,H);
    } else if(v===3){
      const cx=1410,cy=520;
      for(let r=810;r>160;r-=92){
        ctx.beginPath();ctx.arc(cx,cy,r,0,TAU);ctx.strokeStyle=rgba([C.blue,C.green,C.purple,C.white][Math.floor(r/92)%4],.13);ctx.lineWidth=60;ctx.stroke();
      }
      for(let i=0;i<18;i++){let a=TAU*(i/18+t*.12);line(ctx,cx+Math.cos(a)*130,cy+Math.sin(a)*130,cx+Math.cos(a)*880,cy+Math.sin(a)*880,'rgba(255,255,255,.12)',3);}
      for(let i=0;i<12;i++){let a=TAU*(i/12-t*.17);ellipse(ctx,cx+Math.cos(a)*550,cy+Math.sin(a)*550,8,8,rgba(i%3?C.blue:C.gold,.45));}
      ctx.fillStyle=grad(ctx,0,0,1200,0,[[0,'rgba(0,0,0,.32)'],[1,'rgba(0,0,0,0)']]);ctx.fillRect(0,0,W,H);
    } else {
      for(let i=0;i<15;i++){
        const x=i*155-140, shift=20*wave(t,1,i*.1), h=H*(.65+.32*hash(i));
        poly(ctx,[[x+shift,0],[x+122+shift,0],[x+95+shift,h],[x+12+shift,h]],rgba([C.blue,C.purple,C.green,C.gold][i%4],.055+.04*(1+wave(t,1,i*.08))/2),'rgba(255,255,255,.105)',3);
      }
      for(let i=0;i<5;i++){const x=i*400+150;poly(ctx,[[x,-100],[x+130,-100],[x+700,H],[x+500,H]],'rgba(255,255,255,.018)',null);}
      glow(ctx,1180,100,680,C.white,.11);
    }
  }
  function flight(ctx,v,t){
    if(v===1){
      for(let i=0;i<32;i++){
        const y=100+i*33,x=760+Math.sin(i*.26)*160+wave(t,1,i*.03)*50;
        ctx.beginPath();ctx.moveTo(-120,y+220);ctx.bezierCurveTo(560,y-160,x,y+50,2100,y-260-i*8);ctx.strokeStyle=rgba(i%7===0?C.white:C.blue,.055+(i%7===0?.085:0));ctx.lineWidth=i%7===0?4:2;ctx.stroke();
      }
      glow(ctx,1770,140,620,C.blue,.20);
    } else if(v===2){
      for(let side of [-1,1])for(let i=0;i<16;i++){
        const x=side<0?i*85-250:W-i*85+250, y=i*39-130+wave(t,1,i*.05)*20;
        ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x+side*150,y+105,x+side*45,y+300);ctx.strokeStyle=rgba(i%4===0?C.white:C.blue,.045+.065*hash(i));ctx.lineWidth=8+hash(i+2)*22;ctx.stroke();
      }
      glow(ctx,960,550,750,C.field,.12);
    } else if(v===3){
      for(let i=0;i<20;i++){
        const x=i*125-280,y=1100+100*hash(i),rise=650+420*hash(i+50)+40*wave(t,1,i*.05);
        poly(ctx,[[x,y],[x+55,y],[x+430,y-rise],[x+365,y-rise]],rgba(i%5===0?C.white:C.blue,.025+.06*hash(i+11)),null);
      }
      for(let i=0;i<7;i++){const x=i*290+40;line(ctx,x,1080,x+650,60,rgba(i%3?C.blue:C.gold,.16),3);}
      glow(ctx,1100,360,690,C.blue,.19);
    } else {
      for(let i=0;i<26;i++){
        const x=-500+i*120+120*wave(t,1,i*.037),y=i*43-180;
        poly(ctx,[[x,y],[x+500,y-190],[x+650,y-186],[x+150,y+4]],rgba(i%6===0?C.gold:C.blue,i%6===0?.14:.055),null);
      }
      glow(ctx,1750,490,720,C.orange,.12);glow(ctx,220,630,700,C.blue,.18);
    }
  }
  function arena(ctx,v,t){
    if(v===1){
      for(let i=-3;i<12;i++){
        const x=i*230+35*wave(t,1);
        poly(ctx,[[x,-80],[x+125,-80],[x+760,1160],[x+635,1160]],rgba(i%4===0?C.white:C.blue,i%4===0?.075:.095),null);
        line(ctx,x+126,-80,x+761,1160,rgba(C.white,.08),3);
      }
      poly(ctx,[[75,0],[94,0],[650,1080],[630,1080]],rgba(C.white,.21),null);
    } else if(v===2){
      for(let i=0;i<8;i++){const x=80+i*255;glow(ctx,x,-50,350,i%3===0?C.white:C.blue,.14+.025*wave(t,1,i*.1));}
      for(let i=0;i<11;i++)line(ctx,0,680+i*40,W,680+i*40,'rgba(255,255,255,.04)',2);
      glow(ctx,960,900,900,C.blue,.14);
    } else if(v===3){
      for(let x=0;x<=W;x+=80)line(ctx,x,0,x,H,'rgba(255,255,255,.035)',2);
      for(let y=0;y<=H;y+=80)line(ctx,0,y,W,y,'rgba(255,255,255,.035)',2);
      for(let i=0;i<9;i++){
        let y=140+i*110;
        line(ctx,0,y,380,y,rgba(i%3?C.blue:C.white,.19),4);
        line(ctx,1540,y,W,y,rgba(i%3?C.blue:C.white,.19),4);
      }
      const scan=120+760*(.5+.5*wave(t,1,-.25));ctx.fillStyle=grad(ctx,0,scan-80,0,scan+80,[[0,'rgba(28,138,194,0)'],[.5,'rgba(28,138,194,.09)'],[1,'rgba(28,138,194,0)']]);ctx.fillRect(0,scan-80,W,160);
    } else {
      const cx=960,cy=440;
      for(let i=0;i<16;i++){
        const s=1+i*.16+(.015*wave(t,1,i*.03));
        ctx.strokeStyle=rgba(i%5===0?C.white:C.blue,.045+.02*(1-i/16));ctx.lineWidth=i%5===0?6:3;
        ctx.strokeRect(cx-350*s,cy-205*s,700*s,410*s);
      }
      for(let i=0;i<10;i++)line(ctx,0,i*110,W,i*110,'rgba(255,255,255,.025)',2);
      glow(ctx,cx,cy,560,C.blue,.14);
    }
  }
  function campus(ctx,v,t){
    if(v===1 || v===4){
      const bright=v===4;
      const top=bright?140:250,bot=bright?930:900;
      for(let i=-2;i<12;i++){
        const x=i*220+20*wave(t,1);
        line(ctx,x,top,x+460,bot,rgba(bright?C.blue:C.white,bright?.15:.11),bright?10:6);
        line(ctx,x+460,top,x,bot,rgba(C.white,bright?.09:.055),bright?7:4);
        line(ctx,x,top,x+220,top,rgba(C.white,.14),5);
      }
      line(ctx,0,top,W,top,rgba(C.white,.23),9);line(ctx,0,bot,W,bot,rgba(C.white,.16),9);
      glow(ctx,1500,460,660,bright?C.blue:C.gold,bright?.17:.10);
    } else if(v===2){
      for(let i=0;i<33;i++){
        const y=390+i*24, amp=6+i*.35;
        ctx.beginPath();ctx.moveTo(-20,y);
        for(let x=0;x<=W+20;x+=30)ctx.lineTo(x,y+Math.sin(x/115+TAU*t+i*.24)*amp);
        ctx.strokeStyle=rgba(i%7===0?C.white:(i%4===0?C.green:C.blue),.045+.02*hash(i));ctx.lineWidth=i%7===0?4:2;ctx.stroke();
      }
      glow(ctx,1000,840,750,C.blue,.12);glow(ctx,390,450,610,C.green,.09);
    } else {
      const horizon=735;
      for(let i=0;i<28;i++){
        const x=i*82-60,h=45+180*hash(i+30);
        poly(ctx,[[x,horizon],[x+40,horizon-h],[x+80,horizon]],rgba(C.deep,.65),null);
      }
      ctx.fillStyle='rgba(0,8,18,.56)';ctx.fillRect(0,horizon,W,H-horizon);
      for(let i=0;i<70;i++){const x=hash(i+300)*W,y=hash(i+600)*510;ellipse(ctx,x,y,1+hash(i)*2,1+hash(i)*2,rgba(C.white,.10+.12*hash(i+20)));}
      glow(ctx,1230,650,700,C.blue,.17+.04*wave(t));
      line(ctx,0,horizon,W,horizon,rgba(C.gold,.18),2);
    }
  }
  function signal(ctx,v,t){
    if(v===1){
      for(let i=0;i<46;i++){
        const y=36+i*29,x=100+hash(i)*430;
        ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(x,y);ctx.lineTo(x+70,y+45);ctx.lineTo(x+420,y+45);
        ctx.strokeStyle=rgba(i%6===0?C.white:C.blue,.045+.07*hash(i+8));ctx.lineWidth=i%6===0?3:2;ctx.stroke();
        ellipse(ctx,x+420,y+45,3,3,rgba(C.blue,.22+.15*wave(t,1,i*.04)));
      }
      glow(ctx,1650,550,750,C.blue,.17);
    } else if(v===2){
      for(let y=0;y<22;y++)for(let x=0;x<39;x++){
        let d=Math.hypot(x-30,y-10),pulse=.5+.5*wave(t,1,(x+y)*.012);
        ctx.fillStyle=rgba((x+y)%13===0?C.white:C.blue,(d<10?.07:.03)+pulse*.045);
        ctx.fillRect(x*50+10,y*50+10,19,19);
      }
      for(let i=0;i<8;i++)poly(ctx,[[i*290-150,0],[i*290-40,0],[i*290+300,H],[i*290+170,H]],rgba(C.blue,.035),null);
    } else if(v===3){
      for(let i=0;i<46;i++){
        const x=18+i*42, h=70+530*hash(i+10), y=100+hash(i+12)*820;
        ctx.fillStyle=rgba(i%8===0?C.white:C.blue,.08+.04*wave(t,1,i*.024));ctx.fillRect(x,y,3,h);
        ctx.fillStyle=rgba(C.blue,.13);ctx.fillRect(x-5,y+h,14,3);
      }
      for(let i=0;i<5;i++){let y=170+i*170;line(ctx,0,y,W,y,rgba(C.white,.06),3);}
      glow(ctx,1350,420,790,C.purple,.09);
    } else {
      for(let i=0;i<52;i++){
        let x=i*40,y=540+Math.sin(i*.35+TAU*t)*180;
        line(ctx,x,y,x+28,y+Math.sin(i*.35+TAU*t+.3)*18,rgba(i%7===0?C.white:C.blue,.12+.1*hash(i)),i%7===0?7:3);
      }
      for(let i=0;i<10;i++){let y=100+i*90;line(ctx,0,y,W,y,rgba(C.white,.035),2);}
      glow(ctx,1000,540,850,C.blue,.18);
    }
  }
  function unity(ctx,v,t){
    if(v===1 || v===4){
      const cx=v===1?1400:970,cy=540;
      for(let i=0;i<10;i++){
        const r=160+i*85+8*wave(t,1,i*.07);
        ctx.beginPath();ctx.arc(cx,cy,r,0,TAU);
        ctx.strokeStyle=rgba([C.blue,C.green,C.purple,C.gold][i%4],v===1?.075:.10);ctx.lineWidth=v===1?28:17;ctx.stroke();
      }
      for(let i=0;i<9;i++){let a=TAU*(t+i/9);ellipse(ctx,cx+Math.cos(a)*(280+i*45),cy+Math.sin(a)*(280+i*45),5,5,rgba(i%3?C.blue:C.gold,.22));}
      glow(ctx,cx,cy,610,v===1?C.blue:C.white,v===1?.17:.14);
    } else if(v===2){
      for(let i=0;i<12;i++){
        let y=i*95-30,dx=60*wave(t,1,i*.035);
        poly(ctx,[[-50,y],[810+dx,y],[1030+dx,y+60],[-50,y+60]],rgba(i%4===0?C.green:C.blue,.045+.025*hash(i)),null);
        poly(ctx,[[1970,y+25],[1110-dx,y+25],[900-dx,y+85],[1970,y+85]],rgba(i%4===0?C.purple:C.white,.025+.024*hash(i+8)),null);
      }
      glow(ctx,980,510,710,C.blue,.13);
    } else {
      for(let i=0;i<13;i++){
        const y=i*100-70,dx=45*wave(t,1,i*.05);
        poly(ctx,[[0,y],[530+dx,y-42],[600+dx,y+24],[0,y+66]],rgba(C.blue,.065),null);
        poly(ctx,[[1920,y+10],[1390-dx,y+65],[1310-dx,y+2],[1920,y-56]],rgba(i%4===0?C.gold:C.purple,.055),null);
      }
      for(let i=0;i<5;i++){let x=500+i*250;line(ctx,x,0,x+140,H,rgba(C.white,.065),3);}
      glow(ctx,960,530,700,C.blue,.12);
    }
  }
  function hardline(ctx,n,t,options={}){
    // Motifs echo existing profile backgrounds: word rows,
    // repeating mark pattern, varsity rails, and pride tape. Extracted PDF
    // artwork is drawn intact; no new Falcon geometry is fabricated.
    if(n===1){
      glow(ctx,1500,500,850,C.blue,.24);
      for(let i=0;i<17;i++){let x=i*160-280+45*wave(t,1,i*.02);poly(ctx,[[x,-100],[x+14,-100],[x+650,1180],[x+635,1180]],rgba(i%5===0?C.white:C.blue,i%5===0?.085:.035),null);}
      if(options.showMark!==false)mark(ctx,falcon,options.markX||1510,390,650,.24);
    }else if(n===2){
      word(ctx,'MESSIAH',-170,280,320,.075);word(ctx,'ESPORTS',500,955,300,.07);
      for(let i=0;i<7;i++){let y=110+i*145,dx=80*wave(t,1,i*.08);word(ctx,'FALCONS',i%2?-300+dx:1050+dx,y,100,.045,true);}
      glow(ctx,1650,330,700,C.blue,.17);
      ctx.fillStyle=grad(ctx,0,0,W,0,[[0,'rgba(0,0,0,.15)'],[.3,'rgba(0,0,0,.30)'],[.7,'rgba(0,0,0,.30)'],[1,'rgba(0,0,0,.1)']]);ctx.fillRect(0,0,W,H);
    }else if(n===3){
      for(let row=0;row<6;row++)for(let col=-1;col<10;col++){const x=col*220+90+(row%2?60:-60)+35*wave(t,1,row*.12);mark(ctx,falcon,x,55+row*195,120,.22);}
      glow(ctx,300,240,650,C.blue,.19);
      ctx.fillStyle=grad(ctx,0,0,W,0,[[0,'rgba(0,0,0,.08)'],[.32,'rgba(0,0,0,.42)'],[.7,'rgba(0,0,0,.42)'],[1,'rgba(0,0,0,.08)']]);ctx.fillRect(0,0,W,H);
    }else if(n===4){
      for(let i=0;i<5;i++){const y=80+i*210,dx=120*wave(t,1,i*.13);ctx.fillStyle=rgba(i%2?C.white:C.blue,.10);ctx.fillRect(-100,y,W+200,105);word(ctx,i%2?'FALCONS  ·  MESSIAH ESPORTS':'MESSIAH ESPORTS  ·  FALCONS',-180+dx,y+55,112,i%2?.13:.19);}
      for(let i=0;i<11;i++){const x=i*225;poly(ctx,[[x,0],[x+42,0],[x+570,H],[x+525,H]],rgba(C.white,.025),null);}
      glow(ctx,1400,550,820,C.blue,.17);
    }else if(n===5){
      for(let i=-3;i<13;i++){let x=i*210+40*wave(t,1);poly(ctx,[[x,-100],[x+95,-100],[x+780,H+100],[x+685,H+100]],rgba(i%4===0?C.white:C.blue,i%4===0?.10:.085),null);}
      for(let i=0;i<7;i++){const x=i*310-300;line(ctx,x,H,x+690,0,rgba(i%3?C.blue:C.white,.22),i%3?4:10);}
      mark(ctx,falcon,1530,510,570,.22);glow(ctx,1670,440,620,C.blue,.22);
    }else if(n===6){
      for(let i=0;i<11;i++){const y=70+i*110;line(ctx,0,y,W,y,rgba(i%3?C.blue:C.white,.08),i%3?3:7);}
      glow(ctx,1540,460,750,C.blue,.19);
      if(options.showMark!==false)mark(ctx,esportsWordmark,options.markX||1510,390,660,.3);
    }else if(n===7){
      for(let y=0;y<24;y++)for(let x=0;x<38;x++){const a=.025+.04*(.5+.5*wave(t,1,(x+y)*.01));ctx.fillStyle=rgba((x+y)%11?C.blue:C.white,a);ctx.fillRect(x*52+8,y*48+8,10,10);}
      for(let i=0;i<20;i++){const y=i*58+10;line(ctx,0,y,W,y,rgba(C.white,.035),1);}
      mark(ctx,falcon,1510,555,690,.17);mark(ctx,falcon,1530+20*wave(t),550,690,.055);
      glow(ctx,1540,480,680,C.blue,.24);
    }else{
      for(let i=0;i<25;i++){const a=TAU*i/25,r=1300;line(ctx,1420,510,1420+Math.cos(a)*r,510+Math.sin(a)*r,rgba(i%5===0?C.white:C.blue,i%5===0?.10:.055),i%5===0?7:3);}
      for(let i=0;i<11;i++){const x=i*230-300;poly(ctx,[[x,1050],[x+55,1050],[x+630,0],[x+575,0]],rgba(i%4===0?C.white:C.blue,.04+.03*hash(i)),null);}
      word(ctx,'MESSIAH',-100,810,300,.065);mark(ctx,falcon,1450,510,690,.21);
      glow(ctx,1440,510,710,C.blue,.24);
    }
  }
  function draw(ctx,plate,seconds,width,height,options){
    const t=((seconds%8)+8)%8/8;
    ctx.setTransform(width/W,0,0,height/H,0,0);ctx.clearRect(0,0,W,H);
    base(ctx,plate,t);
    const v=(Number(plate.id)-1)%4+1;
    if(plate.family==='Glass')glass(ctx,v,t);
    else if(plate.family==='Flight')flight(ctx,v,t);
    else if(plate.family==='Arena')arena(ctx,v,t);
    else if(plate.family==='Campus')campus(ctx,v,t);
    else if(plate.family==='Signal')signal(ctx,v,t);
    else if(plate.family==='Hardline')hardline(ctx,Number(plate.id)-24,t,options);
    else unity(ctx,v,t);
    finish(ctx);
    ctx.setTransform(1,0,0,1,0,0);
  }
  window.MESSIAH_ENGINE={draw,width:W,height:H,loopSeconds:8,colors:C,marksReady};
})();
