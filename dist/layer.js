'use strict';
// Game-map layer: capture the in-game map panel and calibrate it to game units, by the zone rim when it is in view
// and by the terrain (offline satellite map) otherwise; recognise the zone and draw the overlay's points over the
// in-game map. Click-through, except in marker mode (Insert) while the map is calibrated, when clicks become points
// in the overlay, and a wheel or a drag still moves the game's map. It never takes the keyboard. Excluded from capture.
(()=>{
  const $=id=>document.getElementById(id),api=window.mapLayer,NS='http://www.w3.org/2000/svg',T=I18N.t;
  // Our own errors carry text for the overlay's status line; anything else is a capture error of the browser.
  const own=key=>Object.assign(new Error(T(key)),{own:true});
  const NAMES={kavkazi:'Kavkazi',europe:'Europe',northamerica:'North America'},WORLDS=Object.keys(MAP_LANDMARKS);
  const zones=new Map();
  for(const [world,meta]of Object.entries(MAP_LANDMARKS))for(const zone of meta.zones)zones.set(`${world}/${zone.id}`,{world,zone,get title(){return [NAMES[world]||world,meta.rotations.find(r=>r.id===zone.rotation)?.name||zone.rotation,zone.name==='Default'?T('zone.main'):zone.name].join(' · ');}});
  const patches=Object.fromEntries(Object.entries(ZONE_PATCHES.patches).map(([key,text])=>[key,decodePatch(text)]));
  // Frame pacing, the poll rate (a setting, 60 by default) at most: every frame while the map is calibrated (unchanged
  // frames cost nothing) and in the first 1.5 s after it opened, up to 30 a second while it is open and not found
  // yet, and while it is closed only its frame is checked, up to 30 a second (about 1 ms each). Before the area is
  // fitted to the map panel (open or closed unknown), 4 a second.
  // A lost rim or terrain must stay lost for a moment; a rim counts once two zone checks agree.
  const LOSE_MS=500,RECHECK_MS=5000,OPEN_MS=33,CLOSED_MS=33,WAIT_MS=250,PROBE_MS=1000,MEMORY_MS=1500;
  // Wide terrain searches (one worker per map, ~0.3–0.5 s): soon after the map opens and then backing off while it
  // stays open and unknown; rarely while its state is unknown; never while it is closed.
  const OPEN_SEARCH_MS=[250,1000,2000,4000,8000],BACKGROUND_MS=[4000,15000];
  let fps=60,config=null,selected=null,stream=null,restarting=false,crop=null,sent='',scene=null,marking=false,drawn='';
  // mapOpen: from the map's frame on the edges of the fitted area; null until the area is fitted.
  let mapOpen=null,openedAt=0,failures=0,probeAt=0,misfits=0,lastEdges=null;
  let ring=null,candidate=null,lostAt=0,recognised=null,vote={key:null,count:0},checkedAt=0,lastSig=null,lastCandidates=[],forced=0;
  // calMovedAt: when the calibration last moved by more than MOVE_PX (the game's map panned or zoomed). The picture
  // alone cannot tell: the game animates icons and units on a map that stands still. probePoints: the world points under
  // the frame's centre and corner on the last analysed frame.
  const MOVE_PX=1.5;let calMovedAt=0,probePoints=null;
  function watchMotion(now){
    const cal=crop&&calibration();if(!cal){probePoints=null;return;}
    const at=[[crop.rect.width/2,crop.rect.height/2],[0,0]];
    if(probePoints&&probePoints.some((p,i)=>{const q=cal.toPixel(p.x,p.y);return Math.hypot(q.x-at[i][0],q.y-at[i][1])>MOVE_PX;}))calMovedAt=now;
    probePoints=at.map(([a,b])=>cal.toWorld(a,b));
  }
  // The rim is tracked near where it was (a tenth of a full search) while it is recognised; a full search runs at
  // least every FULL_MS all the same. ringAt: when ring was last seen; ringTrail: the ring one frame earlier, whose
  // motion predicts the next position.
  const FULL_MS=2000;let fullAt=0,ringAt=0,ringTrail=null;
  // rimHue: hue of the rim recognised as the zone; until then no circle calibrates (marker circles look alike).
  let rimHue=null,rimVerified=false,terrain=null,lastWorld=null,lastImg=null,acquireAt=0,acquireWait=BACKGROUND_MS[0];
  // memory: the last calibration (map, zone, fix), kept by the app across sessions; tried on every frame until
  // memoryUntil after the map opens (once at start, while open or closed is not known).
  let memory=null,memoryUntil=Infinity,rememberedAt=0;
  // Timings for the troubleshooting snapshot: when each step first happened (ms since the page started), map loads.
  // rim: ms of the rim step (tracked or searched) and how often each ran.
  window.layerStats={frames:0,skipped:0,ms:0,acquisitions:0,timeline:{},loads:{},searches:[],rim:{ms:0,tracked:0,searched:0}};
  const mark=name=>{window.layerStats.timeline[name]??=Math.round(performance.now());};
  const interval=()=>ring||terrain||mapOpen&&performance.now()<memoryUntil?1000/fps:Math.max(mapOpen===false?CLOSED_MS:mapOpen?OPEN_MS:WAIT_MS,1000/fps);

  // Wide searches run in one worker per map, all maps at once, so capture and tracking go on meanwhile. A map whose
  // worker cannot start is searched on this thread instead.
  const searchers=new Map();
  for(const world of WORLDS){
    const s={worker:null,ready:false};searchers.set(world,s);
    try{s.worker=new Worker('terrain-worker.js');s.worker.onmessage=e=>searchMessage(world,e.data);s.worker.onerror=()=>{s.worker=null;s.ready=false;if(job?.left.has(world))searchMessage(world,{type:'result',id:job.id,fix:null});};}catch{s.worker=null;}
  }
  // Offline map pyramids. Coarse: the grey 1024² maps made ahead by scripts/zone-patches.cjs (milliseconds to load);
  // at 16 m/px they go to the map's search worker (512² is too coarse to tell the maps apart for sure), shrunk to
  // 512² they stay here for tracking until the fine one is loaded. Fine (2048², 8 m/px): the map in view, shrunk from
  // the 5120² map by createImageBitmap, which keeps the ~0.7 s of decoding and shrinking off this thread.
  const loads=new Map(),ready=new Map(),coarseLevels=new Map(),searchLevels=new Map();
  function load(world,size){
    const key=world+'@'+size;
    if(!loads.has(key))loads.set(key,(async()=>{
      const t0=performance.now(),img=new Image(),coarse=size===512;img.src=coarse?`maps/terrain-${world}.png`:`maps/${world}.webp`;await img.decode();
      const source=coarse?img:await createImageBitmap(img,{resizeWidth:size,resizeHeight:size,resizeQuality:'high'}),t1=performance.now();
      const grey=n=>{const g=new OffscreenCanvas(n,n).getContext('2d',{willReadFrequently:true});g.imageSmoothingQuality='high';g.drawImage(source,0,0,n,n);return lumaOf(g.getImageData(0,0,n,n));};
      const luma=grey(size),t2=performance.now(),levels=mapPyramid(luma);
      if(!coarse)source.close();
      window.layerStats.loads[key]={decode:Math.round(t1-t0),draw:Math.round(t2-t1),pyramid:Math.round(performance.now()-t2)};
      if(coarse){
        coarseLevels.set(world,levels);if(!ready.has(world))ready.set(world,levels);
        // A worker that cannot start leaves its map to this thread: the 16 m/px pyramid is kept here then.
        const s=searchers.get(world),search=grey(1024);
        if(s.worker)s.worker.postMessage({type:'map',size:1024,luma:search.data},[search.data.buffer]);else searchLevels.set(world,mapPyramid(search));
        return levels;
      }
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
  const hasFine=world=>ready.has(world)&&ready.get(world)!==coarseLevels.get(world);
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
  // From the luma when the frame gives it (three times the luma stands for the sum of R, G and B).
  const signature=img=>{const out=new Float32Array(256),L=img.luma?.data;for(let j=0,k=0;j<16;j++)for(let i=0;i<16;i++,k++){const p=Math.floor((j+.5)*img.height/16)*img.width+Math.floor((i+.5)*img.width/16);out[k]=L?3*L[p]:img.data[p*4]+img.data[p*4+1]+img.data[p*4+2];}return out;};
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
  // The map's frame (panelOpen): four thin strips across the fitted area's edges, 8 screen pixels to each side.
  async function frameOpen(frame,c){
    const v=frame.visibleRect,m=Math.max(4,Math.round(4*c.k)*2),even=n=>Math.floor(n/2)*2,shares=[];
    for(const [i,s]of edgeStrips(c.rect,m).entries()){
      const x=even(Math.max(v.x,s.x)),y=even(Math.max(v.y,s.y)),w=even(Math.min(v.x+v.width,s.x+s.width)-x),h=even(Math.min(v.y+v.height,s.y+s.height)-y);
      if(w<4||h<4){shares.push(0);continue;}
      const copy=await copyFrame(frame,{x,y,width:w,height:h},'edge'+i);
      shares.push(lineShare({width:w,height:h,data:copy.rgba()},s.vertical));
    }
    lastEdges=shares.map(s=>+s.toFixed(2));
    return panelOpen(shares);
  }
  // The map's frame decides open or closed on each frame: waiting for a second one only made opening feel slow.
  function openState(open,now){
    if(open===mapOpen)return;
    mapOpen=open;
    if(open)opened(now);else closed();
  }
  // Opened: the last calibration is tried on the first frame, the rim is checked at once, the terrain search follows
  // shortly unless the rim locks first. Closed: the points go at once; what was found is remembered for next time.
  function opened(now){openedAt=now;failures=0;misfits=0;memoryUntil=now+MEMORY_MS;checkedAt=0;lastSig=null;acquireAt=now+OPEN_SEARCH_MS[0];}
  function closed(){
    if(terrain)remember();
    ring=null;ringTrail=null;candidate=null;lostAt=0;terrain=null;rimVerified=false;rimHue=null;
    const key=recognised||vote.key;vote={key,count:key?1:0};// one agreeing check re-verifies the same zone
    if(job)endSearch(null);
  }
  function remember(){
    if(!terrain)return;
    const key=recognised||vote.key;
    memory={world:terrain.world,key:zones.get(key)?.world===terrain.world?key:null,fix:{...terrain.fix}};
    rememberedAt=performance.now();api.remember(memory);
  }
  // Returns false when the frame was skipped as unchanged.
  async function analyse(frame,now){
    const c=cropFor(frame),{width,height}=c.rect;
    if(width<64||height<64)throw own('layer.offscreen');
    // Closed: only the map's frame is checked (and a probe once a second), nothing else.
    let edges=false;
    if(config.snapped&&mapOpen===false){
      openState(await frameOpen(frame,c),now);edges=true;
      if(mapOpen===false){crop=c;if(now>=probeAt){probeAt=now+PROBE_MS;await probe(frame,c);}return true;}
    }
    const copy=await copyFrame(frame,c.rect,'crop'),{buf,layout,format}=copy;
    // A static map (or a world standing still) needs no work, unless the map is about to count as open or closed, a
    // rim waits for its confirming frame or its zone check, a lost rim or terrain waits to count as gone, a terrain
    // found by a search waits to be refined, or a search is due.
    const sig=rawSignature(buf,layout,format,width,height);
    const panelDue=!config.snapped&&now>=panelAt&&Boolean(ring&&rimVerified||terrain);
    const settled=!panelDue&&!terrain?.rough&&!(memory&&!terrain&&now<memoryUntil)&&!(candidate&&!ring)&&!(ring&&!rimVerified)&&!(ring&&lostAt)&&!terrain?.lostAt&&!(terrain?.fresh&&hasFine(terrain.world))&&(Boolean(crop&&calibration())||now<acquireAt);
    if(forced>0)forced--;else if(lastSig&&settled&&rawUnchanged(sig,lastSig))return false;
    lastSig=sig;
    if(config.snapped&&!edges){
      openState(await frameOpen(frame,c),now);
      if(mapOpen===false){crop=c;return true;}
    }
    // RGBA of the whole frame only when something needs it (a search, the zone check, the terrain, a snapshot): the
    // tracked rim reads its pixels straight from the copy.
    const img={width,height,read:pixelReader(buf,layout,format,frame.colorSpace),rgba:null,lum:undefined,
      get data(){return this.rgba??=copy.rgba();},
      // The terrain's luminance straight from the Y plane (RGB copies: from the RGBA), in a reused buffer.
      get luma(){if(this.lum===undefined){const n=width*height;if(pool.luma?.length!==n)pool.luma=new Float32Array(n);this.lum=frameLuma(buf,layout,format,width,height,pool.luma)||lumaOf(this);}return this.lum;}};
    crop=c;lastImg=img;
    // Circles of any colour; once a rim is recognised as the zone only circles of its hue count as that rim. A
    // recognised rim is tracked from the last frames; a full search when tracking loses it, and every FULL_MS.
    const rimFrom=performance.now(),rimStats=window.layerStats.rim;let found=null;
    if(ring&&rimVerified&&now-fullAt<FULL_MS){
      const steady=ringTrail&&now-ringAt<150&&ringAt-ringTrail.at<150?ringTrail:null;
      found=trackRing(img,ring,steady);if(found)rimStats.tracked++;
    }
    // While the terrain holds the calibration and no circle is in sight, the whole frame is searched for the rim 4
    // times a second (it takes ~15 ms), and on every frame once a circle turned up (it must show on two in a row).
    const searchDue=ring||candidate||!terrain||terrain.lostAt||now-fullAt>=250;
    if(!found&&searchDue){
      const candidates=ringCandidates(img);fullAt=now;rimStats.searched++;
      found=rimVerified?candidates.find(x=>hueGap(x.hue,rimHue)<=HUE_SPREAD)||null:candidates[0]||null;
      lastCandidates=candidates.map(x=>({cx:+x.cx.toFixed(1),cy:+x.cy.toFixed(1),r:+x.r.toFixed(1),hue:x.hue,rms:+x.rms.toFixed(2),coverage:+x.coverage.toFixed(2),continuity:+x.continuity.toFixed(2)}));
    }
    rimStats.ms=rimStats.ms*.9+(performance.now()-rimFrom)*.1;
    // Locking on needs two frames with the same circle: a lucky fit on the 3D world does not repeat.
    const same=candidate&&Math.hypot(found?.cx-candidate.cx,found?.cy-candidate.cy)<4&&Math.abs(found.r-candidate.r)<Math.max(3,found.r*.02);
    candidate=found;
    if(found&&(ring||same)){
      ringTrail=ring&&{cx:ring.cx,cy:ring.cy,r:ring.r,at:ringAt};ring=found;ringAt=now;lostAt=0;
      if(!rimVerified||now-checkedAt>RECHECK_MS){checkedAt=now;recognise(img,found);}
    }else if(!found){if(!lostAt)lostAt=now;if(now-lostAt>LOSE_MS){ring=null;ringTrail=null;rimVerified=false;rimHue=null;vote={key:recognised,count:recognised?1:0};}}
    // A rim the patches cannot vouch for is the zone all the same when the terrain puts it where a zone of that map
    // is, of that size (a zoomed-out map, where the disc is small and icons cover much of it).
    if(ring&&!rimVerified&&terrain&&!terrain.lostAt){
      const z=zoneAtPlace(MAP_LANDMARKS[terrain.world]?.zones||[],terrain.fix,ring),key=z&&terrain.world+'/'+z.id;
      if(key&&zones.has(key)){recognised=key;rimVerified=true;rimHue=ring.hue;vote={key,count:2};checkedAt=now;}
    }
    const entry=rimEntry();
    if(!config.snapped&&now>=panelAt&&(entry||terrain)){panelTries++;if(await fitPanel(frame,c))panelAt=Infinity;else if(panelTries%3===0)panelAt=now+8000;}
    if(entry){
      // The rim calibrates; the terrain tracker follows it, ready for when the rim leaves the view.
      if(job)endSearch(null);
      const t=ringTransform(ring,entry.zone),corner=pixelToWorld(t,0,0);
      terrain={world:entry.world,fix:{x0:corner.x,y0:corner.y,s:100/t.scale},score:null,seen:null,lostAt:0,fresh:false};lastWorld=entry.world;acquireWait=BACKGROUND_MS[0];failures=0;load(entry.world,2048);
    }else if(!terrain&&memory&&now<=memoryUntil)tryMemory(img);
    else if(terrain)track(img,now);
    if(terrain&&now-rememberedAt>10000)remember();
    if(!entry&&!terrain&&!job&&now>=acquireAt)search(img);
    return true;
  }
  // When the map is calibrated (so it is surely open) and the area not fitted yet: find the square map panel in the area
  // grown by 8 % on each side and have the overlay fit the area to it — nothing around the map is analysed then,
  // and the panel's frame tells open from closed. Three tries in a row, then three more every 8 s until it is found.
  let panelAt=0,panelTries=0;
  async function fitPanel(frame,c){
    const p=await findPanel(frame,c);if(!p)return false;
    api.panel(p);return true;
  }
  async function findPanel(frame,c){
    const v=frame.visibleRect,b=config.display.bounds,even=n=>Math.max(0,Math.floor(n/2)*2);
    const mx=Math.round(c.rect.width*.08),my=Math.round(c.rect.height*.08),x=even(Math.max(v.x,c.rect.x-mx)),y=even(Math.max(v.y,c.rect.y-my));
    const w=even(Math.min(v.x+v.width,c.rect.x+c.rect.width+mx)-x),h=even(Math.min(v.y+v.height,c.rect.y+c.rect.height+my)-y);
    const copy=await copyFrame(frame,{x,y,width:w,height:h},'panel'),p=findMapPanel({width:w,height:h,data:copy.rgba()});
    delete pool.panel;// a one-off: not worth keeping
    return p&&{x:b.x+(x+p.x-v.x)/c.k,y:b.y+(y+p.y-v.y)/c.k,width:p.width/c.k,height:p.height/c.k};
  }
  // While the frame says closed, once a second: is the zone rim there anyway? Three times in a row, the panel is
  // looked for around the area: found elsewhere (another UI scale in the game), the area moves to it. Found where it
  // was, or not found, the frame was only covered (a tooltip over its edge): the fitted area stays.
  async function probe(frame,c){
    const copy=await copyFrame(frame,c.rect,'crop'),img={width:c.rect.width,height:c.rect.height,data:copy.rgba()};
    const found=ringCandidates(img)[0],result=found&&recogniseZone(discSample(img,found,ZONE_PATCHES.size),patches);
    misfits=result?.confident?misfits+1:0;
    if(misfits>=3){misfits=0;const p=await findPanel(frame,c);delete pool.panel;if(p&&['x','y','width','height'].some(k=>Math.abs(p[k]-(k==='x'?config.rect.x:k==='y'?config.rect.y:config.rect[k]))>3))api.refit(p);}
  }
  // The last calibration, on the frames after the map opened: the map usually reopens as it was left, but may still
  // be fading or zooming in on the first ones. Without the map's frame (area not fitted yet) the map may be closed:
  // one try only then, and the 3D world must not pass for the map.
  function tryMemory(img){
    if(mapOpen!==true)memoryUntil=0;
    const levels=ready.get(memory.world);if(!levels)return;
    const minScore=mapOpen?.4:.5,cap=captureOf(img),f=trackFix(levels,cap,memory.fix,{minScore})||recoverFix(levels,cap,memory.fix,{minScore});
    // Found on the coarse levels (just after start): refined once the fine ones are loaded.
    if(f){terrain={world:memory.world,fix:{x0:f.x0,y0:f.y0,s:f.s},score:f.score,seen:signature(img),lostAt:0,fresh:!hasFine(memory.world)};lastWorld=memory.world;load(memory.world,2048);}
  }
  function track(img,now){
    // A map found by a search (fresh) is refined once its fine levels are loaded; until then, and while the map stands
    // still, the search's fix stays (at 16 m/px it is finer than this thread's coarse levels).
    const sig=signature(img),fine=hasFine(terrain.world);if(terrain.seen&&unchanged(sig,terrain.seen)&&!(terrain.fresh&&fine)&&!terrain.rough)return;
    const levels=ready.get(terrain.world);if(!levels)return;
    // Without the map's frame to say it closed, the match must stay near the scores this map gave: the 3D world
    // behind a closed map matches ~0.45–0.5 somewhere near, the map itself 0.55–0.7.
    const minScore=mapOpen===null&&terrain.score?Math.max(.3,terrain.score*.75):.3;
    // While the map moves (the calibration moved on the last frames), a quick track on the two coarser levels keeps up
    // with it; the fine level follows once the map stands still (rough: not refined yet, so that frame is not skipped).
    const quick=now-calMovedAt<150&&!terrain.fresh;
    const cap=captureOf(img),f=trackFix(levels,cap,terrain.fix,{minScore,quick})||recoverFix(levels,cap,terrain.fix,{minScore});
    if(fine)terrain.fresh=false;
    if(f){terrain.fix={x0:f.x0,y0:f.y0,s:f.s};terrain.score=terrain.score?terrain.score*.8+f.score*.2:f.score;terrain.seen=sig;terrain.lostAt=0;terrain.rough=quick;return;}
    if(!terrain.lostAt)terrain.lostAt=now;else if(now-terrain.lostAt>LOSE_MS){terrain=null;acquireAt=0;acquireWait=BACKGROUND_MS[0];failures=0;}
  }

  // One wide search: every map at once, in the workers. The first confident map wins and the others stop.
  let job=null,jobs=0;
  function search(img){
    acquireAt=Infinity;// until this search ends
    acquire(img).then(ok=>{
      // null: stopped (the rim locked or the map closed), neither found nor failed.
      if(ok!==false){if(ok){failures=0;acquireWait=BACKGROUND_MS[0];}acquireAt=0;return;}
      failures++;
      acquireAt=performance.now()+(mapOpen?OPEN_SEARCH_MS[Math.min(failures,OPEN_SEARCH_MS.length-1)]:(acquireWait=Math.min(BACKGROUND_MS[1],acquireWait*1.5)));
    });
  }
  function acquire(img){
    const luma=img.luma||lumaOf(img),worlds=[...new Set([lastWorld,(activeKey()||'').split('/')[0],...WORLDS])].filter(w=>MAP_LANDMARKS[w]);
    const current=job={id:++jobs,seen:signature(img),left:new Map(worlds.map(w=>[w,0])),total:worlds.length,began:performance.now()};
    current.done=new Promise(resolve=>{current.resolve=resolve;});
    window.layerStats.acquisitions++;
    for(const world of worlds){const s=searchers.get(world);if(s.worker&&s.ready)s.worker.postMessage({type:'acquire',id:current.id,width:luma.width,height:luma.height,luma:luma.data});else{current.cap??={width:luma.width,height:luma.height,I:integralOf(luma)};searchHere(world,current);}}
    draw();report();
    return current.done;
  }
  async function searchHere(world,current){
    if(!searchLevels.has(world))await load(world,512);
    const levels=searchLevels.get(world)||ready.get(world);let r={value:null};
    if(levels){const steps=acquireSteps(levels,current.cap,{step:1.12});for(;;){if(job!==current)return;r=steps.next();if(r.done)break;searchMessage(world,{type:'progress',id:current.id,value:r.value});await new Promise(res=>setTimeout(res,0));}}
    searchMessage(world,{type:'result',id:current.id,fix:r.value});
  }
  const searchProgress=()=>job?(job.total-job.left.size+[...job.left.values()].reduce((a,b)=>a+b,0))/job.total:null;
  function searchMessage(world,m){
    if(m.type==='ready'){searchers.get(world).ready=true;window.layerStats.workers=(window.layerStats.workers||0)+1;return;}
    if(!job||m.id!==job.id||!job.left.has(world))return;
    if(m.type==='progress'){job.left.set(world,m.value);draw();report();return;}
    if(m.type!=='result')return;
    job.left.delete(world);
    const f=m.fix;window.layerStats.searches=[...window.layerStats.searches.slice(-9),{world,ms:Math.round(performance.now()-job.began),score:f?+f.score.toFixed(3):null,confident:Boolean(f?.confident)}];
    if(f?.confident){
      terrain={world,fix:{x0:f.x0,y0:f.y0,s:f.s},score:f.score,seen:job.seen,lostAt:0,fresh:true};lastWorld=world;load(world,2048);
      endSearch(true);
    }else if(!job.left.size)endSearch(false);
    else{draw();report();}
  }
  // ok: true found, false nothing found, null stopped (the rim locked or the map closed).
  function endSearch(ok){
    const current=job;if(!current)return;
    job=null;
    for(const world of current.left.keys())searchers.get(world).worker?.postMessage({type:'abort',id:current.id});
    current.resolve(ok);draw();report();
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
  // What the search is doing, a small line at the top of the in-game map: opening it or Insert never looks like nothing.
  function busyText(cal){
    const since=performance.now()-openedAt,justOpened=mapOpen===true&&since>250&&since<5000;
    if(cal||mapOpen===false||!(marking||justOpened))return null;
    if(job)return T('layer.busySearch',{p:Math.round(searchProgress()*100)});
    if(failures)return T('layer.busyFailed');
    return T(mapOpen?'layer.busyOpen':'layer.busyWait');
  }
  function draw(){
    const cal=crop&&calibration(),entry=rimEntry(),rim=$('rim'),busy=busyText(cal);
    document.body.classList.toggle('weak',Boolean(ring?.weak));document.body.classList.toggle('guess',Boolean(cal&&cal.source!=='rim'));document.body.classList.toggle('marking',marking&&Boolean(cal));
    $('busy').hidden=!busy;if(busy)$('busy-text').textContent=busy;
    rim.hidden=!ring||!crop||mapOpen===false;
    if(!rim.hidden){rim.setAttribute('cx',ring.cx/crop.k+crop.ox);rim.setAttribute('cy',ring.cy/crop.k+crop.oy);rim.setAttribute('r',ring.r/crop.k);}
    if(!cal){$('badge').hidden=true;drawMarks(null);return;}
    $('badge').hidden=false;
    $('badge-title').textContent=entry?entry.title:T('gm.byTerrain',{world:NAMES[cal.world]||cal.world});
    $('badge-note').textContent=T(marking?'layer.noteMarking':entry&&ring.weak?'layer.noteWeak':'layer.noteIdle');
    drawMarks(cal);
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
    if(scene.player)pin(scene.player,T('tools.me'),'me','player');
    if(scene.aim)pin(scene.aim,'+','aim-pin');
    if(scene.hit)pin(scene.hit,'×','hit-pin');
    if(sel&&scene.label){const q=at(sel);el(g,'text',{x:q.x+19,y:q.y+4,class:'pin-label'}).textContent=scene.label;}
  }
  // Game units at a point of this window (the checks read the calibration with it; no readout of our own is shown:
  // the game prints its own next to its cursor).
  window.layerAt=(x,y)=>{const cal=crop&&calibration(),p=cal&&toWorld(cal,x,y);return p?{x:p.x,y:p.y}:null;};
  // starting: no frame analysed yet; closed / open: the map's frame says so (fitted area); searching: open or closed
  // unknown; acquiring: a wide terrain search runs (progress 0…1); failed: the last search found nothing.
  function report(status){
    const cal=crop&&calibration(),entry=rimEntry();
    status??={state:cal?(cal.source==='rim'&&ring.weak?'weak':'locked'):!window.layerStats.timeline.firstAnalysed?'starting':mapOpen===false?'closed':job?'acquiring':mapOpen?'open':'searching',key:entry?activeKey():null,recognised:Boolean(entry&&recognised),calibrated:Boolean(cal),source:cal?.source??null,world:cal?.world??null,metresPerPixel:cal?Math.round(cal.mpp*100)/100:null,open:mapOpen,progress:job?Math.round(searchProgress()*20)/20:null,failed:!cal&&failures>0};
    const text=JSON.stringify(status);if(text!==sent){sent=text;api.status(status);}
  }

  const validMemory=m=>m&&MAP_LANDMARKS[m.world]&&['x0','y0','s'].every(k=>Number.isFinite(m.fix?.[k]))&&m.fix.s>0?{world:m.world,key:zones.has(m.key)?m.key:null,fix:m.fix}:null;
  async function start(){
    try{
      mark('start');config=await api.config();mark('config');selected??=config.selection;fps=config.fps||fps;
      memory??=validMemory(config.memory);
      if(memory){lastWorld??=memory.world;if(!vote.key&&memory.key)vote={key:memory.key,count:1};}
      // Coarse maps for every world right away; the remembered map's fine one and the first background search wait
      // until the first frames are shown.
      for(const world of WORLDS)load(world,512);acquireAt=Math.max(acquireAt,performance.now()+1500);
      if(memory)setTimeout(()=>load(memory.world,2048),1500);
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:config.sourceId,maxWidth:8192,maxHeight:8192,maxFrameRate:fps}}});
      mark('stream');const reader=new MediaStreamTrackProcessor({track:stream.getVideoTracks()[0],maxBufferSize:1}).readable.getReader();
      for(let last=0;;){
        const {value:frame,done}=await reader.read();
        if(done)throw own('layer.captureStopped');
        mark('firstFrame');
        const now=performance.now();
        if(now-last<interval()-2){frame.close();continue;}
        last=now;
        let analysed;try{analysed=await analyse(frame,now);}finally{frame.close();}
        const stats=window.layerStats;
        if(analysed===false){stats.skipped++;continue;}
        stats.ms=stats.ms*.9+(performance.now()-now)*.1;stats.frames++;mark('firstAnalysed');watchMotion(now);draw();report();
      }
    }catch(error){
      stream?.getTracks().forEach(track=>track.stop());stream=null;
      // A new poll rate restarts the capture at once; any other end of the capture is an error, retried in 3 s.
      if(restarting){restarting=false;start();return;}
      ring=null;terrain=null;if(job)endSearch(null);draw();
      // Our own errors (and the app's, from layer:config) say what is wrong; browser capture errors get a plain explanation.
      const text=String(error?.message||''),app=/^Error invoking remote method '[^']*': (?:Error: )?/;
      report({state:'error',message:error?.own?text:app.test(text)?text.replace(app,''):T('layer.captureFailed')});
      setTimeout(start,3000);
    }
  }

  // Marker mode: left click places the overlay's current tool (or hits a pin), right click marks the impact.
  function click(e,button){
    if(dragged){dragged=false;return;}// the end of a drag, not a click
    const cal=crop&&calibration();if(!marking||!cal)return;
    const hit=button==='left'?e.target.closest?.('[data-pin]')?.dataset.pin:undefined,p=toWorld(cal,e.clientX,e.clientY);
    api.click({x:Math.round(p.x*100)/100,y:Math.round(p.y*100)/100,button,pin:hit===undefined?null:hit==='player'?'player':Number(hit)});
  }
  addEventListener('click',e=>click(e,'left'));
  addEventListener('contextmenu',e=>{e.preventDefault();click(e,'right');});
  // The game's map in marker mode: a wheel zooms it and a drag moves it. The app hands the mouse to the game for that;
  // the wheel notch or the drag that asked is lost (the game never saw it: nothing is ever sent to the game), the next
  // ones reach it. The layer takes the mouse back after a wheel once the cursor moves off to aim, or the map has
  // stood still for a moment; after a drag once the cursor and the map have both stood still for a moment; and after
  // WHEEL_MAX_MS or DRAG_MAX_MS whatever happens. "The map stood still" is its calibration standing still.
  const PASS_MOVE_PX=10,PASS_STILL_MS=600,PASS_MIN_MS=800,WHEEL_MAX_MS=4000,DRAG_PX=12,DRAG_STILL_MS=700,DRAG_MIN_MS=1500,DRAG_MAX_MS=8000;
  // press: where a button went down on the layer; dragged: it moved far enough to be a drag (no point on release).
  let pass=null,passTimer=0,press=null,dragged=false;
  function startPass(kind,e){
    if(pass||!marking||!(crop&&calibration()))return;
    const now=performance.now();
    pass={kind,x:e.clientX,y:e.clientY,at:now,movedAt:now,pinged:now};
    document.body.classList.add('passing');$('pass-hint').hidden=false;api.pass(true);
    passTimer=setInterval(()=>{
      const now=performance.now();
      const long=now-pass.at,still=now-Math.max(pass.at,calMovedAt);
      if(pass.kind==='wheel'?long>=PASS_MIN_MS&&still>=PASS_STILL_MS||long>=WHEEL_MAX_MS:long>=DRAG_MIN_MS&&now-pass.movedAt>=DRAG_STILL_MS&&still>=DRAG_STILL_MS||long>=DRAG_MAX_MS){endPass();return;}
      // Still needed: the app gives the mouse back by itself 3 s after the last word from here.
      if(now-pass.pinged>=1000){pass.pinged=now;api.pass(true);}
    },50);
  }
  function endPass(tell=true){
    if(!pass)return;
    pass=null;clearInterval(passTimer);document.body.classList.remove('passing');$('pass-hint').hidden=true;
    if(tell)api.pass(false);
  }
  addEventListener('wheel',e=>startPass('wheel',e),{passive:true});
  addEventListener('mousedown',e=>{press=marking&&!pass?{x:e.clientX,y:e.clientY}:null;dragged=false;});
  addEventListener('mouseup',()=>{press=null;});
  api.onPass(on=>{if(!on)endPass(false);});
  // Insert while the map is not found yet: search now, on fresh frames (the map may have opened a moment ago).
  api.onMarking(on=>{
    marking=on;if(!on){endPass(false);press=null;}
    if(on&&!(crop&&calibration())&&mapOpen!==false){forced=2;if(!job)acquireAt=0;}
    draw();report();
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
    api.snapshot({png,info:{time:new Date().toISOString(),fps,area:config?.rect,snapped:config?.snapped,crop:crop&&{...crop.rect,k:crop.k},status:JSON.parse(sent||'null'),mapOpen,edges:lastEdges,candidates:lastCandidates,ring:ring&&{cx:ring.cx,cy:ring.cy,r:ring.r,hue:ring.hue,weak:ring.weak},rimVerified,rimHue,recognised,vote,terrain:terrain&&{world:terrain.world,fix:terrain.fix,score:terrain.score},memory,workers:Object.fromEntries([...searchers].map(([w,s])=>[w,s.worker?(s.ready?'ready':'loading'):'this thread'])),calibration:cal&&{source:cal.source,world:cal.world,metresPerPixel:cal.mpp},loaded:[...ready.keys()],stats:window.layerStats}});
  });
  // The drawn area turned out to be the panel already: from now on its frame says open or closed.
  api.onSnapped(()=>{if(config){config.snapped=true;mapOpen=true;}});
  api.onScene(next=>{scene=next;if(config)draw();});
  // Another language chosen in the overlay: the badge, the search line and the pins follow at once.
  api.onLanguage?.(next=>{I18N.set(next);I18N.apply(document);drawn='';if(config)draw();});
  api.onSelection(key=>{selected=key;if(config){draw();report();}});
  // Moves reach the page while the mouse is with the game too (forwarded by the app).
  addEventListener('mousemove',e=>{
    if(press&&!pass&&e.buttons&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>=DRAG_PX){dragged=true;press=null;startPass('drag',e);}
    if(!pass)return;
    if(pass.kind==='wheel'&&Math.hypot(e.clientX-pass.x,e.clientY-pass.y)>=PASS_MOVE_PX)endPass();else pass.movedAt=performance.now();
  });
  start();
})();
