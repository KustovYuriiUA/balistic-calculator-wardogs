'use strict';
// Terrain matching: where does the captured in-game map sit on the offline satellite map (scale and offset,
// north up)? Works without the zone circle, at any zoom and pan. Normalised cross-correlation of luminance:
// FFT over the whole map on a coarse level to acquire, direct local search on finer levels to refine and
// to track frame to frame. Pure functions shared by layer.js and the tests.
// A fix is {x0, y0, s}: capture pixel (a, b) → game x = x0 + a·s/100, y = y0 − b·s/100 (s = metres per pixel).
const TERRAIN_UNITS=163.84,TERRAIN_METRES=16384;

// Luminance images are {width, height, data: Float32Array}; integrals make any box average O(1).
function lumaOf({width,height,data}){const out=new Float32Array(width*height);for(let i=0;i<out.length;i++)out[i]=.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2];return {width,height,data:out};}
function integralOf({width:w,height:h,data},square=false){
  const s=new Float64Array((w+1)*(h+1));
  for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){const v=data[y*w+x];row+=square?v*v:v;s[(y+1)*(w+1)+x+1]=s[y*(w+1)+x+1]+row;}}
  return {width:w,height:h,sum:s};
}
// Integral at a fractional point (bilinear), so box averages work for any footprint, even below a pixel.
function integralAt(I,x,y){
  const w=I.width,h=I.height;x=Math.max(0,Math.min(w,x));y=Math.max(0,Math.min(h,y));
  const x0=Math.min(w-1,Math.floor(x)),y0=Math.min(h-1,Math.floor(y)),fx=x-x0,fy=y-y0,s=I.sum,W=w+1;
  const a=s[y0*W+x0],b=s[y0*W+x0+1],c=s[(y0+1)*W+x0],d=s[(y0+1)*W+x0+1];
  return a*(1-fx)*(1-fy)+b*fx*(1-fy)+c*(1-fx)*fy+d*fx*fy;
}
// Resample the box x0…x1, y0…y1 of an image (given by its integral) onto a w×h grid of box averages.
function resampleBox(I,x0,y0,x1,y1,w,h){
  const out=new Float32Array(w*h),dx=(x1-x0)/w,dy=(y1-y0)/h,area=dx*dy;
  for(let j=0;j<h;j++){const ya=y0+j*dy,yb=ya+dy;for(let i=0;i<w;i++){const xa=x0+i*dx,xb=xa+dx;out[j*w+i]=(integralAt(I,xb,yb)-integralAt(I,xa,yb)-integralAt(I,xb,ya)+integralAt(I,xa,ya))/area;}}
  return {width:w,height:h,data:out};
}
// Remove slow brightness changes (the zone's tint, vignettes): subtract a box blur of the given radius.
function highPass(img,radius){
  const I=integralOf(img),{width:w,height:h}=img,out=new Float32Array(w*h);
  for(let y=0;y<h;y++){const y0=Math.max(0,y-radius),y1=Math.min(h,y+radius+1);for(let x=0;x<w;x++){const x0=Math.max(0,x-radius),x1=Math.min(w,x+radius+1),s=I.sum,W=w+1;out[y*w+x]=img.data[y*w+x]-(s[y1*W+x1]-s[y0*W+x1]-s[y1*W+x0]+s[y0*W+x0])/((x1-x0)*(y1-y0));}}
  return {width:w,height:h,data:out};
}
const FILTER=3;// high-pass radius in level pixels, same on the map and the capture

// One level of the offline map: r metres per pixel, filtered image, integrals for window sums, FFT for the wide search.
function makeLevel(img,r){const f=highPass(img,FILTER);return {r,img:f,I:integralOf(f),I2:integralOf(f,true),spectrum:null};}
// Offline map luminance at 8 m/px (2048²) → levels 8, 16, 32, 64, 128 m/px.
function mapPyramid(luma){
  const levels=[];let img=luma,r=TERRAIN_METRES/luma.width;
  for(;;){levels.push(makeLevel(img,r));if(img.width<=128)break;
    const w=img.width>>1,h=img.height>>1,d=new Float32Array(w*h),s=img.data,W=img.width;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)d[y*w+x]=(s[2*y*W+2*x]+s[2*y*W+2*x+1]+s[(2*y+1)*W+2*x]+s[(2*y+1)*W+2*x+1])/4;
    img={width:w,height:h,data:d};r*=2;}
  return levels;
}

// In-place radix-2 FFT of n×n complex data (rows, then columns).
function fft1(re,im,n,inverse,tw){
  for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
  for(let len=2;len<=n;len<<=1){const half=len>>1,step=n/len;for(let i=0;i<n;i+=len)for(let k=0;k<half;k++){const c=tw.cos[k*step],sn=inverse?-tw.sin[k*step]:tw.sin[k*step],a=i+k,b=a+half,xr=re[b]*c-im[b]*sn,xi=re[b]*sn+im[b]*c;re[b]=re[a]-xr;im[b]=im[a]-xi;re[a]+=xr;im[a]+=xi;}}
}
const twiddles=new Map();
function fft2(re,im,n,inverse){
  if(!twiddles.has(n)){const cos=new Float64Array(n/2),sin=new Float64Array(n/2);for(let k=0;k<n/2;k++){cos[k]=Math.cos(2*Math.PI*k/n);sin[k]=-Math.sin(2*Math.PI*k/n);}twiddles.set(n,{cos,sin});}
  const tw=twiddles.get(n),r=new Float64Array(n),i=new Float64Array(n);
  for(let y=0;y<n;y++){r.set(re.subarray(y*n,y*n+n));i.set(im.subarray(y*n,y*n+n));fft1(r,i,n,inverse,tw);re.set(r,y*n);im.set(i,y*n);}
  for(let x=0;x<n;x++){for(let y=0;y<n;y++){r[y]=re[y*n+x];i[y]=im[y*n+x];}fft1(r,i,n,inverse,tw);for(let y=0;y<n;y++){re[y*n+x]=r[y];im[y*n+x]=i[y];}}
}
function spectrumOf(level){
  if(level.spectrum)return level.spectrum;
  const n=level.img.width,re=Float64Array.from(level.img.data),im=new Float64Array(n*n);fft2(re,im,n,false);
  return level.spectrum={re,im};
}
// Map window statistics for a template of tw×th at level pixel (u, v).
function windowStats(level,u,v,tw,th){
  const W=level.img.width+1,a=(s)=>s[(v+th)*W+u+tw]-s[v*W+u+tw]-s[(v+th)*W+u]+s[v*W+u];
  const n=tw*th,s1=a(level.I.sum),s2=a(level.I2.sum);return s2-s1*s1/n;
}
function zeroMean(t){let m=0;for(const v of t.data)m+=v;m/=t.data.length;const d=Float32Array.from(t.data,v=>v-m);let e=0;for(const v of d)e+=v*v;return {width:t.width,height:t.height,data:d,energy:e};}
// NCC of the template everywhere on the level (FFT), best peaks first. Valid positions only: no wrap-around.
function searchWide(level,tpl,count=3){
  const n=level.img.width,t=zeroMean(tpl);if(t.width>n||t.height>n||t.energy<=0)return [];
  const S=spectrumOf(level),re=new Float64Array(n*n),im=new Float64Array(n*n);
  for(let y=0;y<t.height;y++)for(let x=0;x<t.width;x++)re[y*n+x]=t.data[y*t.width+x];
  fft2(re,im,n,false);
  for(let k=0;k<n*n;k++){const ar=S.re[k],ai=S.im[k],br=re[k],bi=-im[k];re[k]=ar*br-ai*bi;im[k]=ar*bi+ai*br;}
  fft2(re,im,n,true);
  return peaksOf(level,re,t,count);
}
// The same search for two templates at once: both real, packed as re + i·im into one forward FFT, their spectra
// split by symmetry, and both correlations back from one inverse FFT (real and imaginary part).
function searchWidePair(level,tplA,tplB,count=2){
  const n=level.img.width,a=zeroMean(tplA),b=zeroMean(tplB);
  const fits=t=>t.width<=n&&t.height<=n&&t.energy>0;if(!fits(a)||!fits(b))return [fits(a)?searchWide(level,tplA,count):[],fits(b)?searchWide(level,tplB,count):[]];
  const S=spectrumOf(level),re=new Float64Array(n*n),im=new Float64Array(n*n);
  for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)re[y*n+x]=a.data[y*a.width+x];
  for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++)im[y*n+x]=b.data[y*b.width+x];
  fft2(re,im,n,false);
  const pr=new Float64Array(n*n),pi=new Float64Array(n*n);
  for(let ky=0;ky<n;ky++)for(let kx=0;kx<n;kx++){
    const k=ky*n+kx,m=((n-ky)%n)*n+(n-kx)%n,zr=re[k],zi=im[k],wr=re[m],wi=-im[m];
    const ar=(zr+wr)/2,ai=(zi+wi)/2,br=(zi-wi)/2,bi=-(zr-wr)/2,sr=S.re[k],si=S.im[k];
    const c1r=sr*ar+si*ai,c1i=si*ar-sr*ai,c2r=sr*br+si*bi,c2i=si*br-sr*bi;// S·conj(A), S·conj(B)
    pr[k]=c1r-c2i;pi[k]=c1i+c2r;
  }
  fft2(pr,pi,n,true);
  return [peaksOf(level,pr,a,count),peaksOf(level,pi,b,count)];
}
// NCC peaks from a raw correlation (not yet divided by n²): the best few, at least half a template apart.
function peaksOf(level,corr,t,count){
  const n=level.img.width,scale=1/(n*n),best=[];
  for(let v=0;v<=n-t.height;v++)for(let u=0;u<=n-t.width;u++){
    const w=windowStats(level,u,v,t.width,t.height);if(w<=1e-6)continue;
    const score=corr[v*n+u]*scale/Math.sqrt(w*t.energy);
    if(best.length===count&&score<=best[count-1].score)continue;
    const near=best.findIndex(p=>Math.abs(p.u-u)<t.width/2&&Math.abs(p.v-v)<t.height/2);
    if(near>=0){if(best[near].score>=score)continue;best.splice(near,1);}
    best.push({score,u,v});best.sort((x,y)=>y.score-x.score);if(best.length>count)best.pop();
  }
  return best;
}
// Direct NCC at one integer position.
function nccAt(level,t,u,v){
  const n=level.img.width;if(u<0||v<0||u+t.width>n||v+t.height>n)return -1;
  const w=windowStats(level,u,v,t.width,t.height);if(w<=1e-6)return -1;
  let dot=0;const d=level.img.data;
  for(let y=0;y<t.height;y++){const row=(v+y)*n+u,tr=y*t.width;for(let x=0;x<t.width;x++)dot+=d[row+x]*t.data[tr+x];}
  return dot/Math.sqrt(w*t.energy);
}

// The capture as a template for level r at scale s (metres per capture pixel), aligned with the capture's corner.
// Templates skip a margin of the capture on every side: a loosely drawn area has 3D world and grid labels there,
// whose contrast would drown the terrain. 10 % covers the usual slack and costs a tight area little.
const INSET=.1;
function captureTemplate(cap,r,s,max=Infinity){
  const iw=cap.width*(1-2*INSET),ih=cap.height*(1-2*INSET);
  const k=Math.min(1,max/Math.max(iw,ih)*r/s),w=Math.max(4,Math.floor(iw*s/r*k)),h=Math.max(4,Math.floor(ih*s/r*k));
  // The template covers the centre of the capture; k < 1 when it would be larger than max.
  const cw=w*r/s,ch=h*r/s,x0=(cap.width-cw)/2,y0=(cap.height-ch)/2;
  return {tpl:zeroMean(highPass(resampleBox(cap.I,x0,y0,x0+cw,y0+ch,w,h),FILTER)),x0,y0};
}
// Level pixel of the template corner ↔ fix.
const fixFrom=(level,u,v,s,off)=>({x0:u*level.r/100-off.x0*s/100,y0:TERRAIN_UNITS-v*level.r/100+off.y0*s/100,s});
const cornerOf=(level,fix,off)=>({u:(fix.x0+off.x0*fix.s/100)*100/level.r,v:(TERRAIN_UNITS-fix.y0+off.y0*fix.s/100)*100/level.r});
// Parabola through three scores: sub-pixel offset of the peak in −0.5…0.5.
const vertex=(a,b,c)=>{const d=a-2*b+c;return d<0?Math.max(-.5,Math.min(.5,(a-c)/(2*d))):0;};

// The fix zoomed by f about the capture's centre, as the in-game map zooms.
const zoomFix=(fix,cap,f)=>{const c=fixToWorld(fix,cap.width/2,cap.height/2),s=fix.s*f;return {x0:c.x-cap.width/2*s/100,y0:c.y+cap.height/2*s/100,s};};
// Best fix near a guess on one level: integer search ±radius over a few scale factors (ascending), then
// sub-pixel position and a sub-step scale from parabolas through the neighbouring scores.
function refineOn(level,cap,fix,{radius=3,scales=[.97,.985,1,1.015,1.03],max=128}={}){
  let best=null,k=-1;const peak=[];
  scales.forEach((f,i)=>{
    const zoomed=zoomFix(fix,cap,f),s=zoomed.s,{tpl,x0,y0}=captureTemplate(cap,level.r,s,max),off={x0,y0},c=cornerOf(level,zoomed,off),cu=Math.round(c.u),cv=Math.round(c.v);
    peak[i]=-1;
    for(let dv=-radius;dv<=radius;dv++)for(let du=-radius;du<=radius;du++){const score=nccAt(level,tpl,cu+du,cv+dv);if(score>peak[i])peak[i]=score;if(!best||score>best.score){best={score,u:cu+du,v:cv+dv,s,tpl,off};k=i;}}
  });
  if(!best||best.score<=-1)return null;
  const {u,v,tpl,off}=best,at=(a,b)=>nccAt(level,tpl,a,b);
  const fu=vertex(at(u-1,v),best.score,at(u+1,v)),fv=vertex(at(u,v-1),best.score,at(u,v+1));
  const d=k>0&&k<scales.length-1?vertex(peak[k-1],peak[k],peak[k+1]):0,zoom=d<0?(scales[k-1]/scales[k])**-d:(scales[k+1]/scales[k])**d;
  return {...zoomFix(fixFrom(level,u+fu,v+fv,best.s,off),cap,zoom),score:best.score};
}
// Pick the level whose template size comes closest to max without exceeding it.
const levelFor=(levels,cap,s,max)=>levels.find(l=>Math.max(cap.width,cap.height)*(1-2*INSET)*s/l.r<=max)||levels[levels.length-1];

// Capture (RGBA) → luminance with integral, as used by every search.
function captureOf(img){const l=lumaOf(img);return {width:l.width,height:l.height,I:integralOf(l)};}

// Track: refine the previous fix on a coarse and then a fine level. Null when the map moved too far or closed.
function trackFix(levels,cap,fix,{minScore=.3}={}){
  let f=fix;
  for(const [max,radius] of [[48,3],[110,2],[200,2]]){const r=refineOn(levelFor(levels,cap,f.s,max),cap,f,{radius,max});if(!r)return null;f=r;}
  return f.score>=minScore?f:null;
}
// Acquire: wide FFT search over scales on coarse levels, then refine the best candidates. Scales in metres per
// capture pixel; the zoom range of the in-game map lies well inside the default.
// Recover after a fast zoom or pan: coarse search ±radius with a wide range of scales, then the usual refinement.
function recoverFix(levels,cap,fix,{minScore=.3}={}){
  // Wide enough for a zoom step that halves or doubles the scale at once.
  const scales=[];for(let f=.5;f<=2.01;f*=1.1)scales.push(f);
  const coarse=refineOn(levelFor(levels,cap,fix.s,40),cap,fix,{radius:10,scales,max:40});
  return coarse?trackFix(levels,cap,coarse,{minScore}):null;
}
// A generator that yields after every scale, so the layer can spread the search over its event loop.
// minLead: the best match must beat the runner-up clearly. The 3D world scores as high as a map (0.45 against
// 0.53) but never with a lead: many places fit it about equally (lead < 0.06); a real map leads by 0.4 or more.
function* acquireSteps(levels,cap,{minS=.7,maxS=19,step=1.08,wideMax=80,keep=6,minScore=.3,minLead=.2}={}){
  // The wide search stays on levels of 512² and coarser: an FFT of the 2048² level costs about a second.
  const candidates=[],wide=levels.filter(l=>l.img.width<=512),jobs=[];
  for(let s=minS;s<=maxS;s*=step){
    const level=levelFor(wide,cap,s,wideMax),{tpl,x0,y0}=captureTemplate(cap,level.r,s,wideMax);
    if(tpl.width>=16&&tpl.height>=16)jobs.push({s,level,tpl,off:{x0,y0}});
  }
  // Neighbouring scales on the same level share their FFTs (searchWidePair): about half the cost.
  for(let i=0;i<jobs.length;){
    const a=jobs[i],b=jobs[i+1]?.level===a.level?jobs[i+1]:null;
    const found=b?searchWidePair(a.level,a.tpl,b.tpl,2):[searchWide(a.level,a.tpl,2)];
    [a,b].forEach((job,k)=>{if(job)for(const p of found[k])candidates.push({...fixFrom(job.level,p.u,p.v,job.s,job.off),score:p.score});});
    i+=b?2:1;
    yield;
  }
  candidates.sort((a,b)=>b.score-a.score);
  const refined=[];
  for(const c of candidates.slice(0,keep)){const f=trackFix(levels,cap,c,{minScore:-1});if(f&&!refined.some(r=>Math.hypot(r.x0-f.x0,r.y0-f.y0)<1&&Math.abs(r.s/f.s-1)<.05))refined.push(f);}
  refined.sort((a,b)=>b.score-a.score);
  const best=refined[0];if(!best)return null;
  const lead=best.score-(refined[1]?.score??0);
  return {...best,lead,confident:best.score>=minScore&&lead>=minLead};
}
function acquireFix(levels,cap,options){const steps=acquireSteps(levels,cap,options);for(;;){const r=steps.next();if(r.done)return r.value;}}
const fixToWorld=(fix,a,b)=>({x:fix.x0+a*fix.s/100,y:fix.y0-b*fix.s/100});
const worldToFix=(fix,x,y)=>({x:(x-fix.x0)*100/fix.s,y:(fix.y0-y)*100/fix.s});
if(typeof module!=='undefined')module.exports={TERRAIN_UNITS,TERRAIN_METRES,lumaOf,integralOf,resampleBox,highPass,mapPyramid,fft2,searchWide,nccAt,captureTemplate,captureOf,searchWidePair,refineOn,trackFix,recoverFix,acquireSteps,acquireFix,fixToWorld,worldToFix};
