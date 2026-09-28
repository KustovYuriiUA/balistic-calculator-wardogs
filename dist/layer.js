'use strict';
// Game-map layer: capture the in-game map panel and calibrate it to game units, by the zone rim when it is
// in view and by the terrain (offline satellite map) otherwise; recognise the zone, draw the overlay's points
// over the in-game map and show game coordinates under the cursor. Click-through, except in marker mode
// (Insert), when clicks become points in the overlay. Excluded from capture.
(()=>{
  const $=id=>document.getElementById(id),api=window.mapLayer,NS='http://www.w3.org/2000/svg';
  const NAMES={kavkazi:'Kavkazi',europe:'Europe',northamerica:'North America'},WORLDS=Object.keys(MAP_LANDMARKS);
  const zones=new Map();
  for(const [world,meta]of Object.entries(MAP_LANDMARKS))for(const zone of meta.zones)zones.set(`${world}/${zone.id}`,{world,zone,title:[NAMES[world]||world,meta.rotations.find(r=>r.id===zone.rotation)?.name||zone.rotation,zone.name==='Default'?'Основная':zone.name].join(' · ')});
  const patches=Object.fromEntries(Object.entries(ZONE_PATCHES.patches).map(([key,text])=>[key,decodePatch(text)]));
  // Frame pacing: the poll rate (a setting, 60 by default) while the map is calibrated, at most 10 per second while
  // waiting for it; unchanged frames cost nothing. A lost rim or terrain must stay lost for a moment before the map
  // counts as closed; a rim is checked against the zones until two frames agree. The wide terrain search is costly
  // (~0.3 s per map): in the background it runs rarely and backs off while nothing is found.
  const LOSE_MS=500,REOPEN_MS=3000,CHECK_MS=700,RECHECK_MS=5000,ACQUIRE_MS=[4000,15000],WAIT_MS=250;
  let fps=60,config=null,selected=null,stream=null,restarting=false,ring=null,candidate=null,crop=null,lostAt=0,recognised=null,vote={key:null,count:0},checkedAt=0,cursor=null,sent='';
  // rimHue: hue of the rim recognised as the zone; until then no circle calibrates (marker circles look alike).
  let rimHue=null,rimVerified=false,lastSig=null,lastCandidates=[],forced=0,busy=false;
  let scene=null,marking=false,drawn='',frameWaiters=[],abort=false,terrain=null,lastWorld=null,lastImg=null,acquireAt=0,acquireWait=ACQUIRE_MS[0],attempts=0,searching=null;
  // Timings for the troubleshooting snapshot: when each step first happened (ms since the page started), map loads.
  window.layerStats={frames:0,skipped:0,ms:0,acquisitions:0,timeline:{},loads:{},searches:[]};
  const mark=name=>{window.layerStats.timeline[name]??=Math.round(performance.now());};
  // While the map is closed the circle search (~15 ms a frame) runs 4 times a second: a few per cent of one core.
  const lockedMs=()=>1000/fps,searchMs=()=>Math.max(WAIT_MS,1000/fps);

  // Offline map pyramids: coarse (512², grey images made ahead by scripts/zone-patches.cjs, milliseconds to load)
  // for the wide search on every map; fine (2048², 8 m/px) for the map in view, shrunk from the 5120² map by
  // createImageBitmap, which keeps the ~0.7 s of decoding and shrinking off this thread.
  const loads=new Map(),ready=new Map(),coarseLevels=new Map();
  function load(world,size){
    const key=world+'@'+size;
    if(!loads.has(key))loads.set(key,(async()=>{
      const t0=performance.now(),img=new Image(),coarse=size===512;img.src=coarse?`maps/terrain-${world}.png`:`maps/${world}.webp`;await img.decode();
      const source=coarse?img:await createImageBitmap(img,{resizeWidth:size,resizeHeight:size,resizeQuality:'high'}),t1=performance.now();
      const g=new OffscreenCanvas(size,size).getContext('2d',{willReadFrequently:true});g.drawImage(source,0,0,size,size);
      if(!coarse)source.close();
      const pixels=g.getImageData(0,0,size,size),t2=performance.now(),levels=mapPyramid(lumaOf(pixels));
      window.layerStats.loads[key]={decode:Math.round(t1-t0),draw:Math.round(t2-t1),pyramid:Math.round(performance.now()-t2)};
      if(coarse){coarseLevels.set(world,levels);if(!ready.has(world))ready.set(world,levels);return levels;}
      // A fine pyramid is ~110 MB: keep only the map in view's, the other maps fall back to their coarse levels.
      for(const other of WORLDS)if(other!==world&&loads.has(other+'@2048')){loads.delete(other+'@2048');if(coarseLevels.has(other))ready.set(other,coarseLevels.get(other));else ready.delete(other);}
      ready.set(world,levels);
      return levels;
    })().catch(()=>null));
    return loads.get(key);
  }

  // The saved area in frame pixels (even, for I420 chroma) and back: frame pixel u → window pixel u/k + ox.
  function cropFor(frame){
    const v=frame.visibleRect,b=config.display.bounds,k=v.width/b.width,even=n=>Math.max(0,Math.floor(n/2)*2);
    const x=even((config.rect.x-b.x)*k),y=even((config.rect.y-b.y)*k);
    return {rect:{x:v.x+x,y:v.y+y,width:even(Math.min(v.width-x,config.rect.width*k)),height:even(Math.min(v.height-y,config.rect.height*k))},k,ox:x/k-(config.rect.x-b.x),oy:y/k-(config.rect.y-b.y)};
  }
  const activeKey=()=>recognised||selected;
  const rimEntry=()=>ring&&rimVerified&&zones.get(recognised);
  // Frame pixels ↔ game units: the rim when it is in view (and the zone known), else the terrain fix.
  function calibration(){
    const entry=rimEntry();
    if(entry){const t=ringTransform(ring,entry.zone);return {source:'rim',world:entry.world,toWorld:(a,b)=>pixelToWorld(t,a,b),toPixel:(x,y)=>worldToPixel(t,x,y),id:[t.cx,t.cy,t.scale],mpp:100/t.scale};}
    if(terrain){const f=terrain.fix;return {source:'terrain',world:terrain.world,toWorld:(a,b)=>fixToWorld(f,a,b),toPixel:(x,y)=>worldToFix(f,x,y),id:[f.x0,f.y0,f.s],mpp:f.s};}
    return null;
  }
  const toWindow=(cal,p)=>{const q=cal.toPixel(p.x,p.y);return {x:q.x/crop.k+crop.ox,y:q.y/crop.k+crop.oy};};
  const toWorld=(cal,x,y)=>cal.toWorld((x-crop.ox)*crop.k,(y-crop.oy)*crop.k);
  // A coarse fingerprint of the raw frame (luma of I420/NV12, or mean RGB), before any conversion.
  function rawSignature(buf,layout,format,w,h){
    const out=new Float32Array(256),yuv=format==='I420'||format==='NV12',{offset,stride}=layout[0];
    for(let j=0,k=0;j<16;j++)for(let i=0;i<16;i++,k++){const x=Math.floor((i+.5)*w/16),y=Math.floor((j+.5)*h/16),o=offset+y*stride+(yuv?x:x*4);out[k]=yuv?buf[o]:(buf[o]+buf[o+1]+buf[o+2])/3;}
    return out;
  }
  const rawUnchanged=(a,b)=>{let d=0;for(let i=0;i<a.length;i++)d+=Math.abs(a[i]-b[i]);return d/a.length<1.5;};
  // A coarse fingerprint of the frame: an unchanged map needs no new terrain search.
  const signature=img=>{const out=new Float32Array(256);for(let j=0,k=0;j<16;j++)for(let i=0;i<16;i++,k++){const o=(Math.floor((j+.5)*img.height/16)*img.width+Math.floor((i+.5)*img.width/16))*4;out[k]=img.data[o]+img.data[o+1]+img.data[o+2];}return out;};
  const unchanged=(a,b)=>{let d=0;for(let i=0;i<a.length;i++)d+=Math.abs(a[i]-b[i]);return d/a.length<6;};

  // A rectangle of the frame in a format frameToRgba reads: the frame's own, or RGBX converted by the browser for
  // anything else (10-bit, HDR, frames that live on the GPU). Buffers are reused while the size stays the same:
  // no 4 MB of garbage per frame at 60 frames a second. Readers of lastImg copy what they need synchronously.
  const pool={};
  async function copyFrame(frame,rect,slot){
    const direct=Boolean(frame.format)&&FRAME_FORMATS.test(frame.format),format=direct?frame.format:'RGBX',options=direct?{rect}:{rect,format};
    const size=frame.allocationSize(options),n=rect.width*rect.height*4;let p=pool[slot];
    if(!p||p.buf.length!==size)p=pool[slot]={buf:new Uint8Array(size),rgba:null};
    if(!p.rgba||p.rgba.length!==n)p.rgba=new Uint8ClampedArray(n);
    const layout=await frame.copyTo(p.buf,options);
    return {buf:p.buf,layout,format,rgba:()=>frameToRgba(p.buf,layout,format,rect.width,rect.height,frame.colorSpace,p.rgba)};
  }
  // Returns false when the frame was skipped as unchanged.
  async function analyse(frame,now){
    const c=cropFor(frame),{width,height}=c.rect;
    if(width<64||height<64)throw new Error('Область карты вне экрана');
    const copy=await copyFrame(frame,c.rect,'crop'),{buf,layout,format}=copy;
    // A static map (or a world standing still) needs no work, unless a rim waits for its confirming frame or its
    // zone check, a lost rim or terrain waits to count as gone, or a background terrain search is due.
    const sig=rawSignature(buf,layout,format,width,height);
    const settled=!(candidate&&!ring)&&!(ring&&!rimVerified)&&!(ring&&lostAt)&&!terrain?.lostAt&&(Boolean(crop&&calibration())||now<acquireAt);
    if(forced>0)forced--;else if(lastSig&&settled&&rawUnchanged(sig,lastSig))return false;
    lastSig=sig;
    const img={width,height,data:copy.rgba()};
    crop=c;lastImg=img;
    // Circles of any colour; once a rim is recognised as the zone only circles of its hue count as that rim.
    const candidates=ringCandidates(img),found=rimVerified?candidates.find(x=>hueGap(x.hue,rimHue)<=HUE_SPREAD)||null:candidates[0]||null;
    lastCandidates=candidates.map(x=>({cx:+x.cx.toFixed(1),cy:+x.cy.toFixed(1),r:+x.r.toFixed(1),hue:x.hue,rms:+x.rms.toFixed(2),coverage:+x.coverage.toFixed(2),continuity:+x.continuity.toFixed(2)}));
    // Locking on needs two frames with the same circle: a lucky fit on the 3D world does not repeat.
    const same=candidate&&Math.hypot(found?.cx-candidate.cx,found?.cy-candidate.cy)<4&&Math.abs(found.r-candidate.r)<Math.max(3,found.r*.02);
    candidate=found;
    if(found&&(ring||same)){
      ring=found;
      if(lostAt&&now-lostAt>REOPEN_MS)checkedAt=0;// the map was reopened, maybe in another match: verify the zone now
      lostAt=0;
      if(now-checkedAt>(rimVerified?RECHECK_MS:CHECK_MS)){checkedAt=now;recognise(img,found);}
    }else if(!found){if(!lostAt)lostAt=now;if(now-lostAt>LOSE_MS){ring=null;rimVerified=false;rimHue=null;vote={key:null,count:0};}}
    const entry=rimEntry();
    if(!config.snapped&&panelTries<3&&(entry||terrain)){panelTries++;if(await fitPanel(frame,c))panelTries=3;}
    if(entry){
      // The rim calibrates; the terrain tracker follows it, ready for when the rim leaves the view.
      const t=ringTransform(ring,entry.zone),corner=pixelToWorld(t,0,0);
      terrain={world:entry.world,fix:{x0:corner.x,y0:corner.y,s:100/t.scale},seen:null,lostAt:0};lastWorld=entry.world;acquireWait=ACQUIRE_MS[0];load(entry.world,2048);
      return;
    }
    if(terrain){track(img,now);return;}
    if(now>=acquireAt)await acquireInBackground(img);
  }
  // Once per drawn area, when the map is calibrated (so it is surely open): find the square map panel in the area
  // grown by 8 % on each side and have the overlay fit the area to it — nothing around the map is analysed then.
  // Up to three tries on later calibrated frames.
  let panelTries=0;
  async function fitPanel(frame,c){
    const v=frame.visibleRect,b=config.display.bounds,even=n=>Math.max(0,Math.floor(n/2)*2);
    const mx=Math.round(c.rect.width*.08),my=Math.round(c.rect.height*.08),x=even(Math.max(v.x,c.rect.x-mx)),y=even(Math.max(v.y,c.rect.y-my));
    const w=even(Math.min(v.x+v.width,c.rect.x+c.rect.width+mx)-x),h=even(Math.min(v.y+v.height,c.rect.y+c.rect.height+my)-y);
    const copy=await copyFrame(frame,{x,y,width:w,height:h},'panel'),p=findMapPanel({width:w,height:h,data:copy.rgba()});
    delete pool.panel;// a one-off: not worth keeping
    if(!p)return false;
    api.panel({x:b.x+(x+p.x-v.x)/c.k,y:b.y+(y+p.y-v.y)/c.k,width:p.width/c.k,height:p.height/c.k});
    return true;
  }
  function track(img,now){
    const sig=signature(img);if(terrain.seen&&unchanged(sig,terrain.seen))return;
    const levels=ready.get(terrain.world);if(!levels)return;
    const cap=captureOf(img),f=trackFix(levels,cap,terrain.fix)||recoverFix(levels,cap,terrain.fix);
    if(f){terrain.fix={x0:f.x0,y0:f.y0,s:f.s};terrain.seen=sig;terrain.lostAt=0;return;}
    if(!terrain.lostAt)terrain.lostAt=now;else if(now-terrain.lostAt>LOSE_MS){terrain=null;acquireAt=0;acquireWait=ACQUIRE_MS[0];}
  }
  // Wide terrain search on one frame (~0.7 s per map), the likely map first: the last matched one, then the
  // overlay's. `count` maps are tried; null lets every third background search try them all.
  function acquire(img,count){
    searching??=(async()=>{
      try{
        const prior=(activeKey()||'').split('/')[0],order=[...new Set([lastWorld,prior,...WORLDS])].filter(w=>MAP_LANDMARKS[w]),cap=captureOf(img);
        for(const world of order.slice(0,count??(attempts++%3===0?order.length:1))){
          const levels=ready.get(world)||await load(world,512);if(!levels||abort)continue;
          const began=performance.now(),steps=acquireSteps(levels,cap,{step:1.12});let r;
          for(;;){r=steps.next();if(r.done)break;await new Promise(res=>setTimeout(res,0));if(abort)return false;}
          window.layerStats.acquisitions++;window.layerStats.searches=[...window.layerStats.searches.slice(-9),{world,ms:Math.round(performance.now()-began),score:r.value?+r.value.score.toFixed(3):null,confident:Boolean(r.value?.confident)}];
          if(r.value?.confident){terrain={world,fix:{x0:r.value.x0,y0:r.value.y0,s:r.value.s},seen:signature(img),lostAt:0};lastWorld=world;load(world,2048);return true;}
        }
        return false;
      }finally{searching=null;}
    })();
    return searching;
  }
  async function acquireInBackground(img){
    const ok=await acquire(img,null);
    acquireWait=ok?ACQUIRE_MS[0]:Math.min(ACQUIRE_MS[1],acquireWait*1.5);acquireAt=performance.now()+acquireWait;
  }
  // Is this circle the zone rim, and which zone? Two agreeing checks (or one very clear one) verify it; from then on
  // its hue marks the rim. A confident disagreement drops the verification until the new zone is confirmed.
  function recognise(img,found){
    const result=recogniseZone(discSample(img,found,ZONE_PATCHES.size),patches);
    if(!result?.confident)return;
    const clear=result.score>=.55&&result.margin>=.3;
    vote=vote.key===result.key?{key:result.key,count:vote.count+1}:{key:result.key,count:clear?2:1};
    if(vote.count>=2){recognised=result.key;rimVerified=true;rimHue=found.hue;}
    else if(rimVerified&&recognised!==result.key)rimVerified=false;
  }

  const el=(parent,tag,attrs={})=>{const node=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))node.setAttribute(k,v);parent.append(node);return node;};
  function draw(){
    const cal=crop&&calibration(),entry=rimEntry(),rim=$('rim');
    document.body.classList.toggle('weak',Boolean(ring?.weak));document.body.classList.toggle('guess',Boolean(cal&&cal.source!=='rim'));document.body.classList.toggle('marking',marking);
    $('busy').hidden=!busy||Boolean(cal);
    rim.hidden=!ring||!crop;
    if(!rim.hidden){rim.setAttribute('cx',ring.cx/crop.k+crop.ox);rim.setAttribute('cy',ring.cy/crop.k+crop.oy);rim.setAttribute('r',ring.r/crop.k);}
    if(!cal){$('badge').hidden=true;$('readout').hidden=true;drawMarks(null);return;}
    $('badge').hidden=false;
    $('badge-title').textContent=marking?'Метки':entry?entry.title:`${NAMES[cal.world]||cal.world} · по местности`;
    $('badge-note').textContent=marking?`${scene?.hint||'ЛКМ — точка, ПКМ — разрыв'} · Insert или Esc — в игру`:entry&&ring.weak?'круг виден частично — отдали карту':(entry?(recognised?'распознано':'зона из оверлея'):'круга не видно')+' · Insert — метки';
    drawMarks(cal);drawReadout(cal);
  }
  // The overlay's pins, lines and solution label, as on its own map. Redrawn only when something moved.
  function drawMarks(cal){
    const key=cal&&scene?JSON.stringify([cal.id,crop.k,crop.ox,crop.oy,scene]):'';if(key===drawn)return;drawn=key;
    const g=$('marks');g.replaceChildren();if(!key)return;
    const at=p=>toWindow(cal,p),sel=scene.targets.find(x=>x.id===scene.selected);
    const line=(a,b,cls)=>{const p=at(a),q=at(b);el(g,'line',{x1:p.x,y1:p.y,x2:q.x,y2:q.y,class:cls});};
    if(scene.player){for(const x of scene.targets)if(x!==sel)line(scene.player,x,'ray');if(sel)line(scene.player,sel,'ray chosen');if(sel&&scene.hit)line(sel,scene.hit,'miss');if(scene.aim)line(scene.player,scene.aim,'aim');}
    if(sel){const q=at(sel);el(g,'circle',{cx:q.x,cy:q.y,r:17,class:'halo'});}
    const pin=(p,label,cls,id)=>{const q=at(p),node=el(g,'g',{class:'pin '+cls,...(id==null?{}:{'data-pin':id})});el(node,'circle',{cx:q.x,cy:q.y,r:11});el(node,'text',{x:q.x,y:q.y}).textContent=label;};
    for(const x of scene.targets)pin(x,String(x.id),x===sel?'target chosen':'target',x.id);
    if(scene.player)pin(scene.player,'Я','me','player');
    if(scene.aim)pin(scene.aim,'+','aim-pin');
    if(scene.hit)pin(scene.hit,'×','hit-pin');
    if(sel&&scene.label){const q=at(sel);el(g,'text',{x:q.x+19,y:q.y+4,class:'pin-label'}).textContent=scene.label;}
  }
  function drawReadout(cal=crop&&calibration()){
    const out=$('readout');
    if(!cursor||!cal){out.hidden=true;return;}
    const p=toWorld(cal,cursor.x,cursor.y);
    out.textContent=`x${p.x.toFixed(2)}  y${p.y.toFixed(2)}`;out.hidden=false;
    // Below-left of the cursor: the game prints its own readout to the right of it.
    out.style.left=Math.max(4,cursor.x-out.offsetWidth-14)+'px';out.style.top=Math.min(innerHeight-out.offsetHeight-4,cursor.y+18)+'px';
  }
  function report(status){
    const cal=crop&&calibration(),entry=rimEntry();
    // starting: no frame analysed yet; acquiring: a search asked for by Insert is running.
    status??={state:busy&&!cal?'acquiring':cal?(cal.source==='rim'&&ring.weak?'weak':'locked'):window.layerStats.timeline.firstAnalysed?'searching':'starting',key:entry?activeKey():null,recognised:Boolean(entry&&recognised),calibrated:Boolean(cal),source:cal?.source??null,world:cal?.world??null,metresPerPixel:cal?Math.round(cal.mpp*100)/100:null};
    const text=JSON.stringify(status);if(text!==sent){sent=text;api.status(status);}
  }

  async function start(){
    try{
      mark('start');config=await api.config();mark('config');selected??=config.selection;fps=config.fps||fps;
      // Coarse maps for every world right away; the first background search waits until the first frames are shown.
      for(const world of WORLDS)load(world,512);acquireAt=Math.max(acquireAt,performance.now()+1500);
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:config.sourceId,maxWidth:8192,maxHeight:8192,maxFrameRate:fps}}});
      mark('stream');const reader=new MediaStreamTrackProcessor({track:stream.getVideoTracks()[0],maxBufferSize:1}).readable.getReader();
      for(let last=0;;){
        const {value:frame,done}=await reader.read();
        if(done)throw new Error('Захват экрана остановлен');
        mark('firstFrame');
        const now=performance.now();
        if(now-last<(ring||terrain?lockedMs():searchMs())-2){frame.close();continue;}
        last=now;
        let analysed;try{analysed=await analyse(frame,now);}finally{frame.close();}
        const stats=window.layerStats;
        if(analysed===false){stats.skipped++;continue;}
        stats.ms=stats.ms*.9+(performance.now()-now)*.1;stats.frames++;mark('firstAnalysed');draw();report();
        frameWaiters.splice(0).forEach(resolve=>resolve());
      }
    }catch(error){
      stream?.getTracks().forEach(track=>track.stop());stream=null;
      // A new poll rate restarts the capture at once; any other end of the capture is an error, retried in 3 s.
      if(restarting){restarting=false;start();return;}
      ring=null;terrain=null;draw();
      // Our own errors are Russian; browser capture errors get a plain explanation.
      report({state:'error',message:/[а-я]/i.test(error?.message||'')?error.message:'не удалось захватить экран'});
      setTimeout(start,3000);
    }
  }

  // Marker mode: left click places the overlay's current tool (or hits a pin), right click marks the impact.
  function click(e,button){
    const cal=crop&&calibration();if(!marking||!cal)return;
    const hit=button==='left'?e.target.closest?.('[data-pin]')?.dataset.pin:undefined,p=toWorld(cal,e.clientX,e.clientY);
    api.click({x:Math.round(p.x*100)/100,y:Math.round(p.y*100)/100,button,pin:hit===undefined?null:hit==='player'?'player':Number(hit)});
  }
  addEventListener('click',e=>click(e,'left'));
  addEventListener('contextmenu',e=>{e.preventDefault();click(e,'right');});
  addEventListener('keydown',e=>{
    if(!marking||e.repeat)return;e.preventDefault();
    if(e.code==='Escape')api.exitMarking();else api.key({code:e.code,ctrl:e.ctrlKey});
  });
  // Insert with no calibration yet: search the terrain now, the likely map first, every map if need be. The map may
  // have been opened a moment ago (M, then Insert): stop a background search on an older frame, have the next frames
  // analysed even if they look unchanged, wait for one (at most 0.4 s) and search that frame. Shown as busy meanwhile.
  api.onAcquire(async()=>{
    busy=true;draw();report();
    try{
      abort=true;await searching;abort=false;
      forced=2;await new Promise(resolve=>{frameWaiters.push(resolve);setTimeout(resolve,400);});
      abort=true;await searching;abort=false;// that frame may have started a background search of its own
      // The likely map first (~0.3 s). The others only when a circle is in view or no map was found yet this
      // session: with the game map closed, Insert should open the overlay window without a long wait.
      const others=()=>lastCandidates.some(c=>c.r>=40)||lastWorld===null;
      const ok=Boolean(crop&&calibration())||Boolean(lastImg&&(await acquire(lastImg,1)||others()&&await acquire(lastImg,WORLDS.length)));
      busy=false;draw();report();api.acquired(ok);
    }catch{busy=false;draw();report();api.acquired(false);}
  });
  api.onSettings(next=>{
    const f=Math.round(Number(next?.fps));if(!Number.isFinite(f)||f===fps)return;
    fps=Math.max(5,Math.min(240,f));
    if(stream){restarting=true;stream.getTracks().forEach(track=>track.stop());}
  });
  // Snapshot for troubleshooting: the frame exactly as analysed (PNG) and what the layer made of it.
  api.onSnapshot(async()=>{
    let png=null;
    if(lastImg){const c=new OffscreenCanvas(lastImg.width,lastImg.height);c.getContext('2d').putImageData(new ImageData(lastImg.data,lastImg.width,lastImg.height),0,0);png=new Uint8Array(await(await c.convertToBlob({type:'image/png'})).arrayBuffer());}
    const cal=crop&&calibration();
    api.snapshot({png,info:{time:new Date().toISOString(),fps,area:config?.rect,crop:crop&&{...crop.rect,k:crop.k},status:JSON.parse(sent||'null'),candidates:lastCandidates,ring:ring&&{cx:ring.cx,cy:ring.cy,r:ring.r,hue:ring.hue,weak:ring.weak},rimVerified,rimHue,recognised,vote,terrain:terrain&&{world:terrain.world,fix:terrain.fix},calibration:cal&&{source:cal.source,world:cal.world,metresPerPixel:cal.mpp},loaded:[...ready.keys()],stats:window.layerStats}});
  });
  api.onMarking(on=>{marking=on;draw();});
  api.onScene(next=>{scene=next;if(config)draw();});
  api.onSelection(key=>{selected=key;if(config){draw();report();}});
  addEventListener('mousemove',e=>{cursor={x:e.clientX,y:e.clientY};if(crop)drawReadout();});
  document.addEventListener('mouseleave',()=>{cursor=null;drawReadout();});
  start();
})();
