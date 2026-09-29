'use strict';
// Recognition across every zone and zoom (run with Electron: WebP and canvas). Two parts:
// 1. The user's own snapshots of the game map, North America · Detroit, zone Zestafona houses: one zoomed in (2 m/px,
//    game grid lines x=70 at column 425, y=110 and y=100 at rows 192 and 690), one zoomed out to the whole region
//    (9.2 m/px). The rim must be found and the zone recognised, by its patch or (the small disc of the zoomed-out map,
//    under icons) by where the terrain search puts it; the calibration must meet the grid and agree with that wide
//    terrain search, which never sees the rim.
// 2. Every zone of every map, rendered from the offline map as the game shows it (grey, darker, a tinted disc with a
//    bright rim), at 1.2 to 12 m/px, the zone off-centre, with a green and a red rim: the rim found, the zone
//    recognised, the calibration and a terrain track from a 30 m / 3 % guess within a few metres.
// Nothing is shown on screen.
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
app.setPath('userData',path.join(root,'.test-output','sweep-check-profile'));
const dataUrl=file=>'data:image/webp;base64,'+fs.readFileSync(file).toString('base64');

app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});await win.loadURL('about:blank');
  const run=js=>win.webContents.executeJavaScript(js);
  // The layer's own scripts, as its page loads them.
  for(const file of ['landmarks-data.js','zone-patches.js','zone-detect.js','terrain-match.js'])await run(fs.readFileSync(path.join(root,'dist',file),'utf8')+'\n;0');
  await run(`window.decode=(src,size)=>new Promise((resolve,reject)=>{const i=new Image();i.onerror=reject;i.onload=()=>resolve(i);i.src=src;});
    window.pixels=(i,w=i.width,h=i.height)=>{const c=new OffscreenCanvas(w,h),g=c.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(i,0,0,w,h);return {width:w,height:h,data:g.getImageData(0,0,w,h).data};};
    window.patches=Object.fromEntries(Object.entries(ZONE_PATCHES.patches).map(([k,v])=>[k,decodePatch(v)]));
    window.maps={};window.pyramids={};0`);
  for(const world of ['kavkazi','europe','northamerica'])await run(`(async()=>{const i=await decode(${JSON.stringify(dataUrl(path.join(root,'dist','maps',world+'.webp')))});maps.${world}=i;pyramids.${world}=mapPyramid(lumaOf(pixels(i,2048,2048)));return 0;})()`);
  const errors=[];

  // 1. The user's snapshots.
  const shots=await run(`(async()=>{
    const out={};
    for(const [name,src] of ${JSON.stringify([['near',dataUrl(path.join(__dirname,'fixtures','game-na-2mpx.webp'))],['far',dataUrl(path.join(__dirname,'fixtures','game-na-9mpx.webp'))]])}){
      const img=pixels(await decode(src)),ring=ringCandidates(img)[0],sample=ring&&discSample(img,ring,ZONE_PATCHES.size),zone=ring&&recogniseZone(sample,patches);
      let fix=null,grid=null;
      if(ring&&zone){const [world,id]=zone.key.split('/'),z=MAP_LANDMARKS[world].zones.find(z=>z.id===id),t=ringTransform(ring,z);fix=t;grid=[pixelToWorld(t,425.5,0).x,pixelToWorld(t,0,192.5).y,pixelToWorld(t,0,690.5).y];}
      const cap=captureOf(img),t0=performance.now(),terrain=acquireFix(pyramids.northamerica,cap,{step:1.12}),ms=performance.now()-t0;
      const placed=ring&&terrain&&zoneAtPlace(MAP_LANDMARKS.northamerica.zones,terrain,ring);
      const centre=f=>f&&(f.cx!==undefined?pixelToWorld(f,img.width/2,img.height/2):fixToWorld(f,img.width/2,img.height/2));
      out[name]={ring:ring&&{cx:ring.cx,cy:ring.cy,r:ring.r,hue:ring.hue},zone:zone&&{key:zone.key,score:zone.score,confident:zone.confident},placed:placed&&'northamerica/'+placed.id,grid,rim:centre(fix),terrain:centre(terrain),terrainScore:terrain?.score,ms};
    }
    return out;})()`);
  for(const [name,s] of Object.entries(shots)){
    const gap=s.rim&&s.terrain?Math.hypot(s.rim.x-s.terrain.x,s.rim.y-s.terrain.y)*100:null;
    console.log(`${name}: rim ${s.ring?`r ${s.ring.r.toFixed(1)} hue ${s.ring.hue}`:'none'} · zone by patch ${s.zone?`${s.zone.key} (${s.zone.score.toFixed(2)}${s.zone.confident?'':', not sure'})`:'none'}, by place ${s.placed||'none'} · terrain search ${s.terrain?`${gap.toFixed(1)} m from the rim calibration, score ${s.terrainScore.toFixed(2)}, ${s.ms.toFixed(0)} ms`:'nothing'}${name==='near'&&s.grid?` · grid x70 → ${s.grid[0].toFixed(2)}, y110 → ${s.grid[1].toFixed(2)}, y100 → ${s.grid[2].toFixed(2)}`:''}`);
    const key=s.zone?.confident?s.zone.key:s.placed;
    if(!s.ring||key!=='northamerica/zestafona-houses')errors.push(`${name}: rim or zone not found`);
    if(gap===null||gap>(name==='near'?6:45))errors.push(`${name}: terrain and rim disagree by ${gap?.toFixed(1)} m`);
  }
  const g=shots.near.grid;if(!g||Math.abs(g[0]-70)>.03||Math.abs(g[1]-110)>.03||Math.abs(g[2]-100)>.03)errors.push('near: calibration off the game grid by more than 3 m');

  // 2. Every zone, every zoom, green and red rims.
  const W=876,H=878,zooms=[1.2,2,4,6,9,12],colours={green:'61,178,129',red:'232,86,72'};
  const rows=await run(`(()=>{
    const out=[],W=${W},H=${H},m2src=5120/16384;
    for(const [world,meta] of Object.entries(MAP_LANDMARKS))for(const zone of meta.zones)for(const s of ${JSON.stringify(zooms)})for(const [colour,rgb] of Object.entries(${JSON.stringify(colours)})){
      // The zone centre off the capture's centre; capture px (a, b) shows map source px (sx + a·k, sy + b·k).
      const k=s*m2src,cx=W*.62,cy=H*.42,sx=zone.pos[0]*5120-cx*k,sy=zone.pos[1]*5120-cy*k,r=zone.radiusM/s;
      const c=new OffscreenCanvas(W,H),g=c.getContext('2d');g.fillStyle='#1c1e20';g.fillRect(0,0,W,H);
      g.filter='grayscale(1) brightness(.6) contrast(1.15)';g.imageSmoothingQuality='high';g.drawImage(maps[world],sx,sy,W*k,H*k,0,0,W,H);g.filter='none';
      g.beginPath();g.arc(cx,cy,r,0,2*Math.PI);g.fillStyle='rgba('+rgb+',.22)';g.fill();
      g.shadowColor='rgb('+rgb+')';g.shadowBlur=5;g.lineWidth=3;g.strokeStyle='rgb('+rgb+')';g.beginPath();g.arc(cx,cy,r-1.5,0,2*Math.PI);g.stroke();
      const img={width:W,height:H,data:g.getImageData(0,0,W,H).data},truth={x0:sx*.032,y0:163.84-sy*.032,s};
      const at=f=>fixToWorld(f,W/2,H/2),miss=(p,q)=>Math.hypot(p.x-q.x,p.y-q.y)*100,want=at(truth);
      const ring=ringCandidates(img)[0],found=ring&&Math.hypot(ring.cx-cx,ring.cy-cy)<3&&Math.abs(ring.r-r)<Math.max(2,r*.01);
      const zoneFound=found?recogniseZone(discSample(img,ring,ZONE_PATCHES.size),patches):null;
      const rimMiss=found?miss(pixelToWorld(ringTransform(ring,zone),W/2,H/2),want):null;
      // A terrain track from a guess 30 m and 3 % off, as from the frame before while the map moves.
      const guess={x0:truth.x0+.3,y0:truth.y0-.2,s:s*1.03},tracked=trackFix(pyramids[world],captureOf(img),guess),quick=trackFix(pyramids[world],captureOf(img),guess,{quick:true});
      out.push({key:world+'/'+zone.id,s,colour,found:Boolean(found),coverage:ring?.coverage,recognised:zoneFound?.key===world+'/'+zone.id&&zoneFound.confident,as:zoneFound?.key,score:zoneFound?.score,rimMiss,terrainMiss:tracked?miss(at(tracked),want):null,quickMiss:quick?miss(at(quick),want):null});
    }
    return out;})()`);
  for(const s of zooms){
    const at=rows.filter(r=>r.s===s),max=k=>Math.max(...at.map(r=>r[k]??Infinity));
    console.log(`${String(s).padStart(4)} m/px: rim ${at.filter(r=>r.found).length}/${at.length} · zone ${at.filter(r=>r.recognised).length}/${at.length} · rim calibration ≤ ${max('rimMiss').toFixed(1)} m · terrain track ≤ ${max('terrainMiss').toFixed(1)} m (quick ≤ ${max('quickMiss').toFixed(1)} m)`);
  }
  for(const r of rows){
    const limit=Math.max(3,r.s*1.5);// within a pixel and a half of the frame (a click is no finer than a pixel)
    if(!r.found)errors.push(`${r.key} ${r.s} m/px ${r.colour}: rim not found`);
    else if(!r.recognised)errors.push(`${r.key} ${r.s} m/px ${r.colour}: zone taken for ${r.as} (${r.score?.toFixed(2)})`);
    else if(r.rimMiss>limit)errors.push(`${r.key} ${r.s} m/px ${r.colour}: rim calibration ${r.rimMiss.toFixed(1)} m off`);
    if(r.terrainMiss===null||r.terrainMiss>Math.max(8,r.s*2))errors.push(`${r.key} ${r.s} m/px ${r.colour}: terrain track ${r.terrainMiss===null?'lost':r.terrainMiss.toFixed(1)+' m off'}`);
  }
  if(errors.length){console.log('FAIL:\n  '+errors.join('\n  '));process.exitCode=1;}
  else console.log(`PASS: the user's two snapshots recognised, on the game grid and matching the terrain search; ${rows.length} renders of all ${new Set(rows.map(r=>r.key)).size} zones at ${zooms.join(', ')} m/px, green and red: rim found, zone recognised, calibration and terrain track within limits.`);
  app.quit();
}).catch(error=>{console.error(error);process.exitCode=1;app.quit();});
