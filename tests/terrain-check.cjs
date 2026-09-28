'use strict';
// Terrain matching on the real screenshot and on frames rendered from the offline map (run with Electron: WebP).
// Ground truth for the screenshot is the zone-rim calibration, which the terrain search never sees.
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Z=require('../dist/zone-detect.js'),T=require('../dist/terrain-match.js');
const root=path.resolve(__dirname,'..');
app.setPath('userData',path.join(root,'.test-output','terrain-check-profile'));
const MAP_LANDMARKS=new Function(fs.readFileSync(path.join(root,'dist','landmarks-data.js'),'utf8')+';return MAP_LANDMARKS;')();
const crop=(img,x0,y0,w,h)=>{const data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)data.set(img.data.subarray(((y0+y)*img.width+x0)*4,((y0+y)*img.width+x0+w)*4),y*w*4);return {width:w,height:h,data};};
const ms=t=>(performance.now()-t).toFixed(0)+' ms';
// Error of a fix against the truth: metres at the capture centre and scale in per cent.
const error=(fix,truth,cap)=>{const a=T.fixToWorld(fix,cap.width/2,cap.height/2),b=T.fixToWorld(truth,cap.width/2,cap.height/2);return {metres:Math.hypot(a.x-b.x,a.y-b.y)*100,scale:(fix.s/truth.s-1)*100};};
const fmt=e=>`${e.metres.toFixed(1)} m, scale ${e.scale>=0?'+':''}${e.scale.toFixed(2)} %`;

app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false});await win.loadURL('about:blank');
  const decode=(file,size)=>win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const i=new Image();i.onerror=reject;i.onload=()=>{const w=${size||'i.width'},h=${size||'i.height'},c=new OffscreenCanvas(w,h),g=c.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(i,0,0,w,h);resolve({width:w,height:h,data:g.getImageData(0,0,w,h).data});};i.src=${JSON.stringify('data:image/webp;base64,'+fs.readFileSync(file).toString('base64'))};})`).then(r=>({width:r.width,height:r.height,data:new Uint8ClampedArray(r.data)}));
  let t=performance.now();
  const pyramids={};for(const world of Object.keys(MAP_LANDMARKS))pyramids[world]=T.mapPyramid(T.lumaOf(await decode(path.join(root,'dist','maps',world+'.webp'),2048)));
  console.log('pyramids of 3 maps:',ms(t));
  const shot=await decode(path.join(__dirname,'fixtures','zone-northamerica.webp'));
  const area=crop(shot,172,97,876,878),cap=T.captureOf(area);
  const ring=Z.detectRing(area),zone=MAP_LANDMARKS.northamerica.zones.find(z=>z.id==='zestafona-default'),rt=Z.ringTransform(ring,zone),corner=Z.pixelToWorld(rt,0,0);
  const truth={x0:corner.x,y0:corner.y,s:100/rt.scale};
  console.log(`truth from the rim: s ${truth.s.toFixed(3)} m/px, corner x${truth.x0.toFixed(2)} y${truth.y0.toFixed(2)}`);

  const results={};
  for(const world of Object.keys(pyramids)){t=performance.now();const f=T.acquireFix(pyramids[world],cap);results[world]=f;console.log(`acquire on ${world}: ${ms(t)}, score ${f?.score.toFixed(3)} lead ${f?.lead.toFixed(3)} confident ${f?.confident}`+(world==='northamerica'&&f?` → ${fmt(error(f,truth,cap))}`:''));}
  const na=results.northamerica;
  assert.ok(na?.confident,'confident on North America');
  for(const w of ['kavkazi','europe'])assert.ok(!results[w]||results[w].score<na.score-.1,'other maps score clearly lower');
  const e=error(na,truth,cap);assert.ok(e.metres<8&&Math.abs(e.scale)<1.5,'acquired within 8 m and 1.5 %: '+fmt(e));

  // Tracking: the map moved by ~40 m and zoomed 3 % since the last frame.
  t=performance.now();const moved=T.trackFix(pyramids.northamerica,cap,{...truth,x0:truth.x0+.3,y0:truth.y0-.25,s:truth.s*1.03});
  console.log(`track from a 40 m / 3 % offset: ${ms(t)}, score ${moved?.score.toFixed(3)} → ${moved&&fmt(error(moved,truth,cap))}`);
  assert.ok(moved&&error(moved,truth,cap).metres<8,'tracking within 8 m');
  // A wheel notch: zoom 20 % and pan 150 m in one frame. Plain tracking loses it, recovery finds it.
  const jumped={...truth,x0:truth.x0-1.1,y0:truth.y0+1,s:truth.s*1.2};
  t=performance.now();const recovered=T.recoverFix(pyramids.northamerica,cap,jumped);
  console.log(`recover from a 150 m / 20 % jump: ${ms(t)}, score ${recovered?.score.toFixed(3)} → ${recovered&&fmt(error(recovered,truth,cap))}`);
  assert.ok(recovered&&error(recovered,truth,cap).metres<8,'recovery within 8 m');

  // Zooming in: the screenshot's centre blown up, 1.2× per step, followed from the full view by recovery.
  const shotLuma=T.integralOf(T.lumaOf(area));let fix=truth;
  for(const zoom of [1.2,1.44,1.73]){
    const w=876,h=878,cw=w/zoom,ch=h/zoom,x=(w-cw)/2,y=(h-ch)/2,l=T.resampleBox(shotLuma,x,y,x+cw,y+ch,w,h);
    const zoomed={width:w,height:h,I:T.integralOf(l)},truthZ={x0:truth.x0+x*truth.s/100,y0:truth.y0-y*truth.s/100,s:truth.s/zoom};
    t=performance.now();fix=T.trackFix(pyramids.northamerica,zoomed,fix)||T.recoverFix(pyramids.northamerica,zoomed,fix);
    console.log(`zoomed in ${zoom}× (${truthZ.s.toFixed(2)} m/px): ${ms(t)}, score ${fix?.score.toFixed(3)} → ${fix&&fmt(error(fix,truthZ,zoomed))}`);
    assert.ok(fix&&error(fix,truthZ,zoomed).metres<6,'followed while zooming in');
  }
  // A zoom step that doubles the scale at once.
  t=performance.now();const doubled=T.recoverFix(pyramids.northamerica,cap,{...truth,s:truth.s*2});
  console.log(`recover from a 2× zoom jump: ${ms(t)}, score ${doubled?.score.toFixed(3)} → ${doubled&&fmt(error(doubled,truth,cap))}`);
  assert.ok(doubled&&error(doubled,truth,cap).metres<8,'recovery from 2×');

  // Europe, the user's second screenshot (shrunk to 2000 px wide, 3.5 m/px), area with a margin of 3D world.
  const eu=await decode(path.join(__dirname,'fixtures','zone-europe.webp')),k=eu.width/5120;
  const euImg=crop(eu,Math.round(2031*k),Math.round(216*k),Math.round(1076*k),Math.round(987*k)),euCap=T.captureOf(euImg);
  const euRing=Z.detectRing(euImg),euT=Z.ringTransform(euRing,MAP_LANDMARKS.europe.zones.find(z=>z.id==='ozeti-river')),euCorner=Z.pixelToWorld(euT,0,0),euTruth={x0:euCorner.x,y0:euCorner.y,s:100/euT.scale};
  const euFound={};for(const world of Object.keys(pyramids)){t=performance.now();euFound[world]=T.acquireFix(pyramids[world],euCap,{step:1.12});console.log(`europe screenshot on ${world}: ${ms(t)}, score ${euFound[world]?.score.toFixed(3)} lead ${euFound[world]?.lead.toFixed(3)} confident ${euFound[world]?.confident}`+(world==='europe'&&euFound[world]?` → ${fmt(error(euFound[world],euTruth,euCap))}`:''));}
  assert.ok(euFound.europe?.confident&&error(euFound.europe,euTruth,euCap).metres<15,'Europe found by terrain within 15 m');
  for(const w of ['kavkazi','northamerica'])assert.ok(!euFound[w]?.confident,'no confident match on '+w);

  t=performance.now();const quick=T.acquireFix(pyramids.northamerica,cap,{step:1.12});
  console.log(`acquire with 12 % scale steps: ${ms(t)}, score ${quick?.score.toFixed(3)} lead ${quick?.lead.toFixed(3)} → ${quick&&fmt(error(quick,truth,cap))}`);

  // Zoomed out: frames rendered from the offline map itself, grey, low contrast, with a tinted disc and noise.
  const world=await decode(path.join(root,'dist','maps','northamerica.webp'));const worldI=T.integralOf(T.lumaOf(world));
  for(const s of [4,12]){
    const cx=70.6,cy=103.0,w=876,h=878,x0=cx-w/2*s/100,y0=cy+h/2*s/100,k=world.width/T.TERRAIN_UNITS;
    const lum=T.resampleBox(worldI,x0*k,(T.TERRAIN_UNITS-y0)*k,(x0+w*s/100)*k,(T.TERRAIN_UNITS-y0+h*s/100)*k,w,h);
    const rgba=new Uint8ClampedArray(w*h*4);let seed=3;const noise=()=>{seed=(seed*16807)%2147483647;return seed/2147483647-.5;};
    for(let i=0;i<w*h;i++){const px=i%w-w/2,py=Math.floor(i/w)-h/2,inDisc=Math.hypot(px,py)<500/s,g=.6*lum.data[i]+30+noise()*16;rgba.set(inDisc?[g*.8,g*.8+30,g*.8+10,255]:[g,g,g,255],i*4);}
    const synthetic=T.captureOf({width:w,height:h,data:rgba}),truthS={x0,y0,s};
    t=performance.now();const f=T.acquireFix(pyramids.northamerica,synthetic);
    console.log(`synthetic ${s} m/px: ${ms(t)}, score ${f?.score.toFixed(3)} lead ${f?.lead.toFixed(3)} → ${f&&fmt(error(f,truthS,synthetic))}`);
    assert.ok(f?.confident&&error(f,truthS,synthetic).metres<s*6,'synthetic zoom-out acquired');
  }
  console.log('PASS');
  app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
