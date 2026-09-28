'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Z=require('../dist/zone-detect.js'),{ZONE_PATCHES}=require('../dist/zone-patches.js');
const fs=require('node:fs'),path=require('node:path');
const MAP_LANDMARKS=new Function(fs.readFileSync(path.join(__dirname,'..','dist','landmarks-data.js'),'utf8')+';return MAP_LANDMARKS;')();

// Colours sampled from a real in-game map: rim, the rim's tinted fill, terrain outside, a blue unit icon.
const RIM=[61,178,129],FILL=[89,113,94],GROUND=[30,30,30],ICON=[70,160,230];
function scene(w,h,{cx,cy,r,thickness=3}){
  const data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const d=Math.hypot(x+.5-cx,y+.5-cy),c=Math.abs(d-r)<=thickness/2?RIM:d<r?FILL:GROUND,o=(y*w+x)*4;data.set(c,o);data[o+3]=255;}
  return {width:w,height:h,data};
}
const paint=(img,x0,y0,w,h,c)=>{for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++)img.data.set(c,(y*img.width+x)*4);};

test('Rim is found despite green and blue icons; centre and outer edge within half a pixel',()=>{
  const img=scene(420,400,{cx:210.3,cy:190.7,r:150.2});
  paint(img,20,20,30,30,RIM);// a green icon outside the zone
  paint(img,190,60,40,40,ICON);paint(img,150,300,24,24,RIM);// markers over the fill and on the rim
  const ring=Z.detectRing(img);
  assert.ok(ring);
  // The zone ends at the outer edge of its line: the 3 px line centred on 150.2 ends at 151.7.
  assert.ok(Math.abs(ring.cx-210.3)<.5&&Math.abs(ring.cy-190.7)<.5&&Math.abs(ring.r-151.7)<.5,JSON.stringify(ring));
  assert.equal(ring.weak,false);assert.ok(ring.coverage>.95);
});
test('Zoomed in: a quarter of the rim is enough but flagged weak; a sliver or no rim is rejected',()=>{
  const quarter=Z.detectRing(scene(400,400,{cx:380,cy:380,r:300}));
  assert.ok(quarter&&Math.abs(quarter.cx-380)<2&&Math.abs(quarter.cy-380)<2&&Math.abs(quarter.r-300)<2,JSON.stringify(quarter));
  assert.equal(quarter.weak,true);
  assert.equal(Z.detectRing(scene(400,400,{cx:200,cy:1200,r:1010})),null,'a sliver of a huge circle');
  const empty=scene(300,300,{cx:-999,cy:-999,r:1});
  assert.equal(Z.detectRing(empty),null);
  paint(empty,100,100,60,60,RIM);
  assert.equal(Z.detectRing(empty),null,'a filled green square is not a rim');
});
test('A 14 px glow that brightens towards a sharp edge (zoomed out) is found at its edge, in any colour',()=>{
  // Saturation rises over 14 px up to the disc edge, then drops to the grey map: the look of the rim on Europe.
  const glow=(w,h,cx,cy,r,[R,G,B])=>{const data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const d=Math.hypot(x+.5-cx,y+.5-cy)-r,o=(y*w+x)*4,k=d>0?0:d>-14?.35+.65*(1+d/14):.35,grey=70;data.set([grey+(R-grey)*k,grey+(G-grey)*k,grey+(B-grey)*k,255],o);}return {width:w,height:h,data};};
  for(const colour of [[61,178,129],[220,60,50],[70,120,235]]){
    const ring=Z.detectRing(glow(760,720,380.4,360.7,330.2,colour));
    assert.ok(ring&&Math.hypot(ring.cx-380.4,ring.cy-360.7)<1&&ring.r>326&&ring.r<331.5,`${colour}: ${JSON.stringify(ring)}`);
  }
});
test('Several circles: the largest wins, or the one of the zone hue; a small marker circle alone is still found',()=>{
  const img=scene(700,700,{cx:350,cy:350,r:300});
  const yellow=[235,205,60],marker=(cx,cy,r)=>{for(let y=0;y<700;y++)for(let x=0;x<700;x++)if(Math.abs(Math.hypot(x+.5-cx,y+.5-cy)-r)<=1.5)img.data.set(yellow,(y*700+x)*4);};
  marker(220,260,40);
  assert.ok(Math.abs(Z.detectRing(img).r-300)<2,'largest');
  const all=Z.ringCandidates(img);
  assert.ok(all.length>=2&&all.some(c=>Math.abs(c.r-40)<2),JSON.stringify(all.map(c=>[c.r,c.hue])));
  assert.ok(Math.abs(Z.detectRing(img,{hue:all.find(c=>c.r<100).hue}).r-40)<2,'by hue');
});
test('Map panel inside a loosely drawn area: the square with unbroken sides, not grid lines, crosshair or a shadow',()=>{
  const w=520,h=500,px=(i,v)=>{img.data[i*4]=img.data[i*4+1]=img.data[i*4+2]=v;img.data[i*4+3]=255;},img={width:w,height:h,data:new Uint8ClampedArray(w*h*4)};
  let s=5;const rnd=()=>{s=(s*16807)%2147483647;return s/2147483647;};
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)px(y*w+x,150+Math.round(rnd()*10));// sky-like world, little texture
  const P={x:61,y:47,size:400};
  for(let y=P.y;y<=P.y+P.size;y++)for(let x=P.x;x<=P.x+P.size;x++)px(y*w+x,40+Math.round(rnd()*60));// textured map
  for(let k=0;k<=P.size;k++){px((P.y)*w+P.x+k,200);px((P.y+P.size)*w+P.x+k,200);px((P.y+k)*w+P.x,200);px((P.y+k)*w+P.x+P.size,200);}// light frame
  for(let x=P.x;x<=P.x+P.size;x++)px((P.y+150)*w+x,190);for(let y=P.y;y<=P.y+P.size;y++)px(y*w+P.x+230,190);// a grid line each way
  for(let x=0;x<w;x++)px(20*w+x,90);// a shadow line across the whole area above the panel (not a panel edge)
  const p=Z.findMapPanel(img);
  assert.ok(p&&Math.abs(p.x-P.x)<=2&&Math.abs(p.y-P.y)<=2&&Math.abs(p.width-P.size)<=3&&Math.abs(p.height-P.size)<=3,JSON.stringify(p));
  const inside={width:300,height:300,data:new Uint8ClampedArray(300*300*4)};
  for(let y=0;y<300;y++)inside.data.set(img.data.subarray(((P.y+50+y)*w+P.x+50)*4,((P.y+50+y)*w+P.x+350)*4),y*300*4);
  assert.equal(Z.findMapPanel(inside),null,'an area drawn inside the panel has no panel edges');
  // Open or closed, from strips across the fitted area's edges: the frame on all four sides, or on three when an icon
  // covers one; not when the panel is gone (the world behind a closed map). The real screenshot: tests/zone-check.cjs.
  const shares=(image,rect,m=6)=>Z.edgeStrips(rect,m).map(s=>{const strip={width:s.width,height:s.height,data:new Uint8ClampedArray(s.width*s.height*4)};for(let y=0;y<s.height;y++)strip.data.set(image.data.subarray(((s.y+y)*w+s.x)*4,((s.y+y)*w+s.x+s.width)*4),y*s.width*4);return Z.lineShare(strip,s.vertical);});
  const fitted={x:P.x,y:P.y,width:P.size,height:P.size},open=shares(img,fitted);
  assert.ok(open.every(v=>v>=.95)&&Z.panelOpen(open),JSON.stringify(open));
  paint(img,P.x-8,P.y+50,24,300,[20,20,20]);// a big icon over most of the left side
  const covered=shares(img,fitted);
  assert.ok(covered[0]<.6&&Z.panelOpen(covered),JSON.stringify(covered));
  const world={width:w,height:h,data:new Uint8ClampedArray(w*h*4)};for(let i=0;i<w*h;i++){world.data.set([150+Math.round(rnd()*10),150,150,255],i*4);}
  for(let x=0;x<w;x++)world.data.set([90,90,90,255],((P.y+P.size)*w+x)*4);// a horizon just where the bottom edge was
  assert.equal(Z.panelOpen(shares(world,fitted)),false,'one straight line in the world is not the frame');
});
test('Circle fits: algebraic on exact points, geometric refinement on a noisy short arc',()=>{
  const pts=[];for(let a=0;a<360;a+=7)pts.push(40+25*Math.cos(a*Math.PI/180),-12+25*Math.sin(a*Math.PI/180));
  const c=Z.fitCircle(pts,[...Array(pts.length/2).keys()]);
  assert.ok(Math.abs(c.cx-40)<1e-6&&Math.abs(c.cy+12)<1e-6&&Math.abs(c.r-25)<1e-6);
  const arc=[];let s=7;const noise=()=>{s=(s*16807)%2147483647;return s/2147483647-.5;};
  for(let a=200;a<260;a+=.5)arc.push(500+400*Math.cos(a*Math.PI/180)+noise()*2,500+400*Math.sin(a*Math.PI/180)+noise()*2);
  const idx=[...Array(arc.length/2).keys()],refined=Z.refineCircle(arc,idx,Z.fitCircle(arc,idx));
  assert.ok(Math.abs(refined.r-400)<6&&Math.hypot(refined.cx-500,refined.cy-500)<6,JSON.stringify(refined));
});
test('Screen ↔ game units from the rim of North America · Zestafona',()=>{
  const zone=MAP_LANDMARKS.northamerica.zones.find(z=>z.id==='zestafona-default');
  const t=Z.ringTransform({cx:413.9,cy:432.9,r:374.9},zone);
  assert.ok(Math.abs(t.scale-74.98)<.01);
  const centre=Z.pixelToWorld(t,413.9,432.9);
  assert.ok(Math.abs(centre.x-zone.pos[0]*163.84)<1e-9&&Math.abs(centre.y-(1-zone.pos[1])*163.84)<1e-9);
  const east=Z.pixelToWorld(t,413.9+374.9,432.9),north=Z.pixelToWorld(t,413.9,432.9-374.9);
  assert.ok(Math.abs(east.x-centre.x-5)<1e-9&&Math.abs(north.y-centre.y-5)<1e-9,'500 m east and north');
  const back=Z.worldToPixel(t,70,100);assert.deepEqual(Z.pixelToWorld(t,back.x,back.y).x.toFixed(9),'70.000000000');
});
test('Zone recognition: the right patch wins through tint, brightness, noise and icons; a blend is not confident',()=>{
  const N=16;let s=11;const rnd=()=>{s=(s*48271)%2147483647;return s/2147483647;};
  const texture=()=>Uint8Array.from({length:N*N},()=>Math.round(rnd()*255));
  const patches={a:texture(),b:texture(),c:texture()};
  const sample=from=>{const lum=Float32Array.from(from,v=>.55*v+40+(rnd()-.5)*20),valid=new Uint8Array(N*N).fill(1);return {size:N,lum,valid,count:N*N};};
  const correlate=(x,y)=>Z.correlate(x,y,50);
  assert.ok(correlate(sample(patches.b),patches.b)>.9);
  const clean=sample(patches.b);for(let i=0;i<30;i++)clean.lum[i]=255;// icons, not removed by the saturation filter
  const found=Z.recogniseZone(clean,patches);
  assert.equal(found.key,'b');assert.equal(found.confident,true);
  const mix=sample(patches.a.map((v,i)=>(v+patches.b[i])/2));
  const blended=Z.recogniseZone(mix,patches);assert.equal(blended.confident,false);
});
test('Disc sampling leaves out cells off the frame, near the rim and under saturated icons',()=>{
  const img=scene(200,200,{cx:100,cy:100,r:90});
  paint(img,90,90,20,20,ICON);
  const all=Z.discSample(img,{cx:100,cy:100,r:90},16);
  assert.ok(all.count>120&&all.count<180,String(all.count));
  const centre=7*16+7;assert.equal(all.valid[centre],0,'icon cell dropped');assert.equal(all.valid[0],0,'corner outside the disc');
  const half=Z.discSample(img,{cx:0,cy:100,r:90},16);
  assert.ok(half.count<all.count/2+10,'left half is off the frame');
});
test('Frame formats: BT.709 limited I420 and NV12, BT.601 full range, BGRX',()=>{
  const colours=[[61,178,129],[255,255,255],[0,0,0],[230,40,20]],kr=.2126,kb=.0722;
  const yuv=([r,g,b])=>{const l=kr*r+(1-kr-kb)*g+kb*b;return [16+l*219/255,128+(b-l)/(2*(1-kb))*224/255,128+(r-l)/(2*(1-kr))*224/255].map(Math.round);};
  for(const c of colours){
    const [y,u,v]=yuv(c),i420=Uint8Array.from([y,y,y,y,u,v]),nv12=Uint8Array.from([y,y,y,y,u,v]);
    const a=Z.frameToRgba(i420,[{offset:0,stride:2},{offset:4,stride:1},{offset:5,stride:1}],'I420',2,2,{matrix:'bt709',fullRange:false});
    const b=Z.frameToRgba(nv12,[{offset:0,stride:2},{offset:4,stride:2}],'NV12',2,2,{matrix:'bt709',fullRange:false});
    for(const out of [a,b])for(let k=0;k<3;k++)assert.ok(Math.abs(out[12+k]-c[k])<=3,`${c} → ${[...out.slice(12,15)]}`);
  }
  const [r,g,b]=[61,178,129],l=.299*r+.587*g+.114*b,full=Uint8Array.from([l,128+(b-l)/1.772,128+(r-l)/1.402].map(Math.round));
  const f=Z.frameToRgba(Uint8Array.from([full[0],full[1],full[2]]),[{offset:0,stride:1},{offset:1,stride:1},{offset:2,stride:1}],'I420',1,1,{matrix:'smpte170m',fullRange:true});
  assert.ok(Math.abs(f[0]-r)<=2&&Math.abs(f[1]-g)<=2&&Math.abs(f[2]-b)<=2,String([...f]));
  assert.deepEqual([...Z.frameToRgba(Uint8Array.from([9,8,7,0]),[{offset:0,stride:4}],'BGRX',1,1)],[7,8,9,255]);
  // Other GPUs and drivers: I420A (alpha plane ignored), I422 (2×1 chroma) and I444 (full chroma) read the same colour.
  const [y,u,v]=yuv([61,178,129]),space={matrix:'bt709',fullRange:false};
  const layouts={I420A:[Uint8Array.from([y,y,y,y,u,v,255,255,255,255]),[{offset:0,stride:2},{offset:4,stride:1},{offset:5,stride:1},{offset:6,stride:2}]],
    I422:[Uint8Array.from([y,y,y,y,u,u,v,v]),[{offset:0,stride:2},{offset:4,stride:1},{offset:6,stride:1}]],
    I444:[Uint8Array.from([y,y,y,y,u,u,u,u,v,v,v,v]),[{offset:0,stride:2},{offset:4,stride:2},{offset:8,stride:2}]]};
  for(const [format,[buf,layout]]of Object.entries(layouts)){const out=Z.frameToRgba(buf,layout,format,2,2,space);for(const o of [0,12])assert.ok(Math.abs(out[o]-61)<=3&&Math.abs(out[o+1]-178)<=3&&Math.abs(out[o+2]-129)<=3,`${format}: ${[...out.slice(o,o+3)]}`);}
  // A reused output buffer is filled in place.
  const reuse=new Uint8ClampedArray(16);assert.equal(Z.frameToRgba(...layouts.I444,'I444',2,2,space,reuse),reuse);
  // 10-bit and other formats are never read directly: the layer asks the browser for RGBX instead.
  assert.ok(!Z.FRAME_FORMATS.test('I420P10')&&!Z.FRAME_FORMATS.test('RGBAF16')&&Z.FRAME_FORMATS.test('NV12'));
  assert.throws(()=>Z.frameToRgba(new Uint8Array(4),[{offset:0,stride:4}],'I420P10',1,1),/не поддерживается/);
});
test('Every control zone has a 64×64 patch generated from the offline maps',()=>{
  const keys=Object.entries(MAP_LANDMARKS).flatMap(([world,meta])=>meta.zones.map(z=>`${world}/${z.id}`));
  assert.deepEqual(Object.keys(ZONE_PATCHES.patches).sort(),keys.sort());
  for(const text of Object.values(ZONE_PATCHES.patches))assert.equal(Z.decodePatch(text).length,ZONE_PATCHES.size**2);
});
