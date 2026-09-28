'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const T=require('../dist/terrain-match.js');

// Synthetic terrain, 512² = 32 m/px for the 16 384 m world: coarse blobs, finer detail and noise.
function terrain(seed){
  let s=seed;const rnd=()=>{s=(s*48271)%2147483647;return s/2147483647;};
  const grid=(n)=>{const g=Float32Array.from({length:(n+1)*(n+1)},rnd);return (x,y)=>{const gx=x*n,gy=y*n,i=Math.min(n-1,Math.floor(gx)),j=Math.min(n-1,Math.floor(gy)),fx=gx-i,fy=gy-j,a=g[j*(n+1)+i],b=g[j*(n+1)+i+1],c=g[(j+1)*(n+1)+i],d=g[(j+1)*(n+1)+i+1];return a*(1-fx)*(1-fy)+b*fx*(1-fy)+c*(1-fx)*fy+d*fx*fy;};};
  const coarse=grid(24),fine=grid(160),n=512,data=new Float32Array(n*n);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)data[y*n+x]=120*coarse(x/n,y/n)+80*fine(x/n,y/n)+20*rnd();
  return {width:n,height:n,data};
}
// A capture of w×h pixels at s metres per pixel with its corner at game units (x0, y0), greyed and noisy like the game.
function capture(map,{x0,y0,s},w=300,h=280,seed=5){
  const I=T.integralOf(map),k=map.width/T.TERRAIN_UNITS,l=T.resampleBox(I,x0*k,(T.TERRAIN_UNITS-y0)*k,(x0+w*s/100)*k,(T.TERRAIN_UNITS-y0+h*s/100)*k,w,h);
  let r=seed;const noise=()=>{r=(r*16807)%2147483647;return r/2147483647-.5;};
  const rgba=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++){const g=.6*l.data[i]+40+noise()*12;rgba.set([g,g+8,g,255],i*4);}
  return T.captureOf({width:w,height:h,data:rgba});
}
const metres=(a,b,cap)=>{const p=T.fixToWorld(a,cap.width/2,cap.height/2),q=T.fixToWorld(b,cap.width/2,cap.height/2);return Math.hypot(p.x-q.x,p.y-q.y)*100;};
const home=T.mapPyramid(terrain(11)),other=T.mapPyramid(terrain(97));

test('FFT forward and inverse give the input back',()=>{
  const n=16,re=Float64Array.from({length:n*n},(_,i)=>Math.sin(i*.37)*10+i%5),im=new Float64Array(n*n),copy=Float64Array.from(re);
  T.fft2(re,im,n,false);T.fft2(re,im,n,true);
  for(let i=0;i<n*n;i++)assert.ok(Math.abs(re[i]/(n*n)-copy[i])<1e-9&&Math.abs(im[i]/(n*n))<1e-9);
});
test('Two templates through one packed FFT give the same peaks as two single searches',()=>{
  const cap=capture(terrain(11),{x0:52.3,y0:101.7,s:40}),level=home[1];
  const a=T.captureTemplate(cap,level.r,40,80).tpl,b=T.captureTemplate(cap,level.r,44,80).tpl,[pa,pb]=T.searchWidePair(level,a,b,2);
  for(const [pair,single]of [[pa,T.searchWide(level,a,2)],[pb,T.searchWide(level,b,2)]]){
    assert.equal(pair.length,single.length);
    pair.forEach((p,i)=>{assert.equal(p.u,single[i].u);assert.equal(p.v,single[i].v);assert.ok(Math.abs(p.score-single[i].score)<1e-9);});
  }
});
test('Pyramid levels halve down to 128² at 32, 64 and 128 m/px',()=>{
  assert.deepEqual(home.map(l=>[l.r,l.img.width]),[[32,512],[64,256],[128,128]]);
});
test('Acquisition finds scale and position of a capture without any circle, and rejects another map',()=>{
  const truth={x0:52.3,y0:101.7,s:18};const cap=capture(terrain(11),truth);
  const fix=T.acquireFix(home,cap,{minS:8,maxS:60});
  assert.ok(fix?.confident,JSON.stringify(fix));
  assert.ok(metres(fix,truth,cap)<40&&Math.abs(fix.s/truth.s-1)<.03,`${metres(fix,truth,cap).toFixed(1)} m, s ${fix.s.toFixed(2)}`);
  const wrong=T.acquireFix(other,cap,{minS:8,maxS:60});
  assert.ok(!wrong?.confident&&wrong.score<fix.score-.2,JSON.stringify(wrong&&{score:wrong.score,lead:wrong.lead}));
});
test('Tracking follows a small pan and zoom; recovery a wheel-notch jump; a frame of another map is lost',()=>{
  const truth={x0:40,y0:120,s:20},map=terrain(11),cap=capture(map,truth);
  const tracked=T.trackFix(home,cap,{x0:40.4,y0:119.7,s:20*1.025});
  assert.ok(tracked&&metres(tracked,truth,cap)<40,'tracked');
  const recovered=T.trackFix(home,cap,{x0:38.5,y0:121.2,s:20*1.22})||T.recoverFix(home,cap,{x0:38.5,y0:121.2,s:20*1.22});
  assert.ok(recovered&&metres(recovered,truth,cap)<40,'recovered');
  assert.equal(T.trackFix(home,capture(terrain(97),truth),truth),null,'another map drops the lock');
});
test('Game units ↔ capture pixels of a fix',()=>{
  const fix={x0:65.12,y0:108.82,s:1.334},p=T.fixToWorld(fix,400,300);
  assert.ok(Math.abs(p.x-(65.12+4*1.334))<1e-9&&Math.abs(p.y-(108.82-3*1.334))<1e-9);
  const back=T.worldToFix(fix,p.x,p.y);assert.ok(Math.abs(back.x-400)<1e-9&&Math.abs(back.y-300)<1e-9);
});
