'use strict';
// Real screenshot check of the game-map layer core (run with Electron: it decodes WebP). `pnpm check:zone` bundles the
// core from src/ first (scripts/build-test-core.mjs → .test-output/core.cjs).
// The first fixture is North America, zone Zestafona: game grid lines x=70 at column 537 and y=100 at row 760.
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Z=require('../.test-output/core.cjs'),{ZONE_PATCHES,MAP_LANDMARKS}=Z;
const root=path.resolve(__dirname,'..');
app.setPath('userData',path.join(root,'.test-output','zone-check-profile'));

// What desktop capture does to the frame: BT.709 limited-range I420 with 2×2 chroma, then back to RGBA.
function throughI420({width:w,height:h,data}){
  const cw=w>>1,ch=h>>1,buf=new Uint8Array(w*h+2*cw*ch),kr=.2126,kb=.0722,kg=1-kr-kb;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const o=(y*w+x)*4,l=kr*data[o]+kg*data[o+1]+kb*data[o+2];buf[y*w+x]=Math.round(16+l*219/255);}
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
    let cb=0,cr=0;
    for(const [dx,dy]of [[0,0],[1,0],[0,1],[1,1]]){const o=((2*y+dy)*w+2*x+dx)*4,r=data[o],g=data[o+1],b=data[o+2],l=kr*r+kg*g+kb*b;cb+=(b-l)/(2*(1-kb));cr+=(r-l)/(2*(1-kr));}
    buf[w*h+y*cw+x]=Math.round(128+cb/4*224/255);buf[w*h+cw*ch+y*cw+x]=Math.round(128+cr/4*224/255);
  }
  const layout=[{offset:0,stride:w},{offset:w*h,stride:cw},{offset:w*h+cw*ch,stride:cw}];
  return {width:w,height:h,data:Z.frameToRgba(buf,layout,'I420',w,h,{matrix:'bt709',fullRange:false})};
}
const crop=(img,x0,y0,w,h)=>{const data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)data.set(img.data.subarray(((y0+y)*img.width+x0)*4,((y0+y)*img.width+x0+w)*4),y*w*4);return {width:w,height:h,data};};
const patches=Object.fromEntries(Object.entries(ZONE_PATCHES.patches).map(([k,v])=>[k,Z.decodePatch(v)]));
const zone=MAP_LANDMARKS.northamerica.zones.find(z=>z.id==='zestafona-default');
// Ground truth for the scale: the game's axis labels are 1 unit (100 m) apart. Their period along a strip outside the
// panel (brightness autocorrelation, refined over several periods) gives px per unit independently of the rim.
function labelPeriod(img,[x0,y0,w,h],alongX){
  const along=alongX?w:h,across=alongX?h:w,p=new Float64Array(along);
  for(let a=0;a<along;a++){let s=0;for(let b=0;b<across;b++){const x=x0+(alongX?a:b),y=y0+(alongX?b:a),o=(y*img.width+x)*4;s+=img.data[o]+img.data[o+1]+img.data[o+2];}p[a]=s/across;}
  const mean=p.reduce((s,v)=>s+v,0)/along;for(let a=0;a<along;a++)p[a]-=mean;
  const ac=lag=>{let s=0,n=0;for(let a=0;a+lag<along;a++){s+=p[a]*p[a+lag];n++;}return s/n;};
  let best=15;for(let lag=15;lag<along/2;lag++)if(ac(lag)>ac(best))best=lag;
  const k=Math.floor(along/2/best);let top=Math.round(k*best);for(let lag=top-4;lag<=top+4;lag++)if(ac(lag)>ac(top))top=lag;
  return top/k;
}
// North America's zone is 500 m: with 75.35 px per unit from the labels the rim is 5 × 75.35 px.
const RIM_NA=376.75;

app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false});await win.loadURL('about:blank');
  const decode=async file=>{const url='data:image/webp;base64,'+fs.readFileSync(file).toString('base64');const raw=await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const i=new Image();i.onerror=reject;i.onload=()=>{const c=new OffscreenCanvas(i.width,i.height),g=c.getContext('2d');g.drawImage(i,0,0);resolve({width:i.width,height:i.height,data:g.getImageData(0,0,i.width,i.height).data});};i.src=${JSON.stringify(url)};})`);return {width:raw.width,height:raw.height,data:new Uint8ClampedArray(raw.data)};};
  const resize=async(img,w,h)=>{const out=await win.webContents.executeJavaScript(`(()=>{const s=new OffscreenCanvas(${img.width},${img.height});s.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(${JSON.stringify(Array.from(img.data))}),${img.width},${img.height}),0,0);const c=new OffscreenCanvas(${w},${h}),g=c.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(s,0,0,${w},${h});return g.getImageData(0,0,${w},${h}).data;})()`);return {width:w,height:h,data:new Uint8ClampedArray(out)};};
  const shot=await decode(path.join(__dirname,'fixtures','zone-northamerica.webp'));
  // The user's capture area: the square in-game map panel.
  const area={x:172,y:97,width:876,height:878},full=crop(shot,area.x,area.y,area.width,area.height);
  const report=[];
  for(const [label,img]of [['screenshot',full],['through I420',throughI420(full)]]){
    const began=performance.now();for(let i=0;i<5;i++)Z.ringCandidates(img);report.push(`${label}: circle search ${((performance.now()-began)/5).toFixed(1)} ms per frame of ${img.width}×${img.height}`);
    const ring=Z.detectRing(img);assert.ok(ring,label+': rim found');
    report.push(`${label}: rim ${Z.ringPoints(img).length/2} px, centre ${(ring.cx+area.x).toFixed(2)}, ${(ring.cy+area.y).toFixed(2)}, r ${ring.r.toFixed(2)}, rms ${ring.rms.toFixed(2)}, coverage ${ring.coverage.toFixed(2)}`);
    assert.ok(Math.abs(ring.cx+area.x-586)<1&&Math.abs(ring.cy+area.y-530)<1&&Math.abs(ring.r-RIM_NA)<1.5,label+': rim geometry');
    assert.equal(ring.isWeak,false);
    const t=Z.ringTransform(ring,zone);
    const gx=Z.pixelToWorld(t,537.5-area.x,0).x,gy=Z.pixelToWorld(t,0,760.5-area.y).y;// centres of the 1 px grid lines
    report.push(`${label}: grid x=70 → ${gx.toFixed(3)}, y=100 → ${gy.toFixed(3)} (1 px = ${(100/t.scale).toFixed(2)} m)`);
    assert.ok(Math.abs(gx-70)<.02&&Math.abs(gy-100)<.02,label+': game grid lines within 2 m');
    const found=Z.recogniseZone(Z.discSample(img,ring,ZONE_PATCHES.size),patches);
    report.push(`${label}: zone ${found.key} score ${found.score.toFixed(3)} lead ${found.margin.toFixed(3)}`);
    assert.equal(found.key,'northamerica/zestafona-default');assert.equal(found.isConfident,true);
  }
  // The rim's scale against the labels: bottom row, left column and the 100M column on the right.
  const naLabels=[labelPeriod(shot,[180,998,860,26],true),labelPeriod(shot,[112,110,50,860],false),labelPeriod(shot,[1055,110,70,860],false)];
  const naRim=Z.detectRing(full),naScale=naRim.r/5,naLabel=naLabels.reduce((s,v)=>s+v,0)/naLabels.length;
  report.push(`north america scale: rim ${naScale.toFixed(2)} px/unit, labels ${naLabels.map(v=>v.toFixed(2)).join(' / ')} → ${((naScale/naLabel-1)*100).toFixed(2)} %`);
  assert.ok(Math.abs(naScale/naLabel-1)<.005,'rim scale within 0.5 % of the axis labels');
  // Zoomed in / panned: only the north-west quarter of the circle is on screen.
  const part=crop(shot,180,110,420,420),arc=Z.detectRing(part);
  assert.ok(arc,'rim found on a quarter arc');
  report.push(`quarter arc: centre ${(arc.cx+180).toFixed(2)}, ${(arc.cy+110).toFixed(2)}, r ${arc.r.toFixed(2)}, coverage ${arc.coverage.toFixed(2)}, weak ${arc.isWeak}`);
  assert.ok(Math.abs(arc.cx+180-586)<3&&Math.abs(arc.cy+110-530)<3&&Math.abs(arc.r-RIM_NA)<4,'quarter arc geometry');
  assert.equal(arc.isWeak,true);
  // Map closed: the 3D world to the right of the panel has no rim.
  assert.equal(Z.detectRing(crop(shot,1052,100,198,900)),null,'no rim on the game world');

  // Europe, zone Ozeti River, zoomed out further: the whole 5120×1440 screen shrunk to 2000 px wide, so the rim is
  // a 5 px gradient; blown back up to screen size it is the 14 px glow the live capture sees. The user's area has a
  // margin of 3D world around the panel.
  const eu=await decode(path.join(__dirname,'fixtures','zone-europe.webp')),k=eu.width/5120,euArea={x:Math.round(2031*k),y:Math.round(216*k),width:Math.round(1076*k),height:Math.round(987*k)};
  const small=crop(eu,euArea.x,euArea.y,euArea.width,euArea.height),native=await resize(small,1076,987),river=MAP_LANDMARKS.europe.zones.find(z=>z.id==='ozeti-river');
  // Grid lines x=100 and y=60 of the game, found on the screenshot as the thinnest bright line near where they are drawn.
  const lineAt=(from,to,vertical)=>{let best=null;for(let p=from;p<=to;p++){let s=0;for(let q=0;q<120;q++){const [x,y]=vertical?[p,euArea.y+60+q*2]:[euArea.x+60+q*2,p],v=(xx,yy)=>{const o=(yy*eu.width+xx)*4;return eu.data[o]+eu.data[o+1]+eu.data[o+2];};s+=vertical?v(x,y)-(v(x-2,y)+v(x+2,y))/2:v(x,y)-(v(x,y-2)+v(x,y+2))/2;}if(!best||s>best.s)best={p,s};}return best.p+.5;};
  const gridX=lineAt(1060,1075,true),gridY=lineAt(328,342,false);
  for(const [label,img,f]of [['europe screenshot',small,1],['europe at screen size',native,1076/small.width]]){
    if(f>1){const began=performance.now();for(let i=0;i<5;i++)Z.ringCandidates(img);report.push(`${label}: circle search ${((performance.now()-began)/5).toFixed(1)} ms per frame of ${img.width}×${img.height}`);}
    const ring=Z.detectRing(img);assert.ok(ring,label+': rim found');
    const t=Z.ringTransform(ring,river),gx=Z.pixelToWorld(t,(gridX-euArea.x)*f,0).x,gy=Z.pixelToWorld(t,0,(gridY-euArea.y)*f).y;
    const found=Z.recogniseZone(Z.discSample(img,ring,ZONE_PATCHES.size),patches);
    report.push(`${label}: r ${ring.r.toFixed(2)} (= ${(ring.r/f).toFixed(2)} on the screenshot), rms ${ring.rms.toFixed(2)}, hue ${ring.hue}, grid x=100 → ${gx.toFixed(3)}, y=60 → ${gy.toFixed(3)}, zone ${found?.key} score ${found?.score.toFixed(3)} lead ${found?.margin.toFixed(3)}`);
    assert.ok(Math.abs(gx-100)<.035&&Math.abs(gy-60)<.035,label+': grid lines within 3.5 m (1 screenshot px)');
    assert.equal(found?.key,'europe/ozeti-river');assert.equal(found.isConfident,true);
  }
  // Europe's scale against the 100M column on the right (the bottom labels alternate in width and read double).
  const euLabel=labelPeriod(eu,[1175,100,30,360],false),euScale=Z.detectRing(small).r/5.5;
  report.push(`europe scale: rim ${euScale.toFixed(2)} px/unit, labels ${euLabel.toFixed(2)} → ${((euScale/euLabel-1)*100).toFixed(2)} %`);
  assert.ok(Math.abs(euScale/euLabel-1)<.015,'Europe rim scale within 1.5 % of the labels (1 px = 3.5 m on this shrunk screenshot)');
  // The map panel inside loosely drawn areas: North America (panel 172…1048 × 97…975), Europe (830…1172 × 108…452).
  for(const [label,img,x0,y0,expect]of [['north america ±60 px',crop(shot,112,40,996,990),112,40,[172,97,876,878]],['north america ±12 px',crop(shot,160,85,900,902),160,85,[172,97,876,878]],['europe user area',small,euArea.x,euArea.y,[830,108,342,344]]]){
    const p=Z.findMapPanel(img);
    report.push(`${label}: panel ${p?`${p.x+x0},${p.y+y0} ${p.width}×${p.height}`:'none'}`);
    assert.ok(p&&Math.abs(p.x+x0-expect[0])<=2&&Math.abs(p.y+y0-expect[1])<=3&&Math.abs(p.width-expect[2])<=4&&Math.abs(p.height-expect[3])<=4,label+': panel');
  }
  assert.equal(Z.findMapPanel(crop(shot,190,120,840,840)),null,'an area inside the panel has no panel');
  // Open or closed from the fitted area's edges: the frame on the panel, not on rects inside the map or in the world.
  const edgeShares=rect=>Z.edgeStrips(rect,8).map(s=>Z.lineShare(crop(shot,s.x,s.y,s.width,s.height),s.isVertical));
  const onPanel=edgeShares({x:172,y:97,width:876,height:878});
  report.push(`map frame on the panel: ${onPanel.map(v=>v.toFixed(2)).join(' ')}`);
  assert.ok(Z.panelOpen(onPanel)&&onPanel.every(v=>v>=.9),'the open map shows its frame on every side');
  for(const d of [20,40,60]){const inside=edgeShares({x:172+d,y:97+d,width:876-2*d,height:878-2*d});report.push(`${d} px inside: ${inside.map(v=>v.toFixed(2)).join(' ')}`);assert.equal(Z.panelOpen(inside),false,`no frame ${d} px inside the panel`);}
  assert.equal(Z.panelOpen(edgeShares({x:10,y:20,width:150,height:150})),false,'no frame in the 3D world');
  // Another colour: the same rim turned red, blue and yellow is found the same.
  for(const [name,swap]of [['red',(r,g,b)=>[g,r,b]],['blue',(r,g,b)=>[r,b,g]],['yellow',(r,g,b)=>[g,g,r]]]){
    const d=Uint8ClampedArray.from(full.data);for(let i=0;i<d.length;i+=4)d.set(swap(d[i],d[i+1],d[i+2]),i);
    const ring=Z.detectRing({width:full.width,height:full.height,data:d});
    report.push(`rim turned ${name}: r ${ring?.r.toFixed(2)}, hue ${ring?.hue}`);
    assert.ok(ring&&Math.abs(ring.r-RIM_NA)<1.5&&Math.abs(ring.cx+area.x-586.5)<1.5,name+' rim geometry');
  }
  console.log(report.join('\n'));
  console.log('PASS: rim found on both screenshots, at screen size and after I420, in any colour; scale equal to the axis labels; grid lines within 2–3.5 m; both zones recognised; quarter arc flagged weak; no rim on the game world; the open map frame found on the fitted area edges and nowhere else.');
  app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
