'use strict';
// Game-map layer core: find the green control-zone ring on a captured frame of the in-game map,
// recognise the zone against offline map patches and convert screen pixels to game units.
// Pure functions shared by layer.js and the tests. Images are {width, height, data: RGBA}.
const ZONE_WORLD=163.84;// game units across the map, same as MAP_EXTENT in maps.js

// Frame formats read directly. Capture delivers I420 here (NVIDIA); other GPUs and drivers may give NV12, I420A,
// I422, I444 or 8-bit RGB. Anything else (10-bit, HDR, GPU-only frames) is copied as RGBX by the browser.
const FRAME_FORMATS=/^(I420A?|I422|I444|NV12|RGB[AX]|BGR[AX])$/;
// VideoFrame.copyTo() output → RGBA; out: a buffer of the right size to reuse (one frame after another).
function frameToRgba(buf,layout,format,width,height,colorSpace,out=new Uint8ClampedArray(width*height*4)){
  if(/^(RGB|BGR)[AX]$/.test(format)){
    const bgr=format[0]==='B',{offset,stride}=layout[0];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const s=offset+y*stride+x*4,o=(y*width+x)*4;out[o]=buf[s+(bgr?2:0)];out[o+1]=buf[s+1];out[o+2]=buf[s+(bgr?0:2)];out[o+3]=255;}
    return out;
  }
  if(!FRAME_FORMATS.test(format))throw new Error('Формат кадра не поддерживается: '+format);
  const bt601=/smpte170m|bt470bg/.test(colorSpace?.matrix||''),kr=bt601?.299:.2126,kb=bt601?.114:.0722,kg=1-kr-kb;
  const full=colorSpace?.fullRange===true,ys=full?1:255/219,yo=full?0:16,cs=full?1:255/224,nv=format==='NV12',[Y,U,V]=layout;
  // Chroma subsampling: I420/I420A/NV12 2×2, I422 2×1, I444 none.
  const sx=format==='I444'?0:1,sy=format==='I420'||format==='I420A'||nv?1:0;
  for(let y=0;y<height;y++){
    const row=(y>>sy)*U.stride,vrow=nv?0:(y>>sy)*V.stride;
    for(let x=0;x<width;x++){
      const c=x>>sx,l=(buf[Y.offset+y*Y.stride+x]-yo)*ys;
      const cb=((nv?buf[U.offset+row+c*2]:buf[U.offset+row+c])-128)*cs,cr=((nv?buf[U.offset+row+c*2+1]:buf[V.offset+vrow+c])-128)*cs;
      const r=l+2*(1-kr)*cr,b=l+2*(1-kb)*cb,o=(y*width+x)*4;
      out[o]=r;out[o+1]=(l-kr*r-kb*b)/kg;out[o+2]=b;out[o+3]=255;
    }
  }
  return out;
}

// Rim pixels are saturated and bright, of any hue: the zone rim is green by default but can change colour.
// The tinted fill inside the rim and the grey map stay well below. Hue in degrees, −1 for other pixels.
function hueOf(r,g,b){const max=Math.max(r,g,b),min=Math.min(r,g,b),c=max-min;if(max<110||c<50)return -1;return 60*(max===r?((g-b)/c+6)%6:max===g?(b-r)/c+2:(r-g)/c+4);}
const hueGap=(a,b)=>{const d=Math.abs(a-b)%360;return d>180?360-d:d;};
const isRingColor=(r,g,b)=>hueOf(r,g,b)>=0;
const HUE_SPREAD=25;// a rim's pixels, antialiasing included, stay within this many degrees of its hue
function hueMap({width:w,height:h,data:d}){const out=new Int16Array(w*h);for(let i=0;i<w*h;i++)out[i]=Math.round(hueOf(d[i*4],d[i*4+1],d[i*4+2]))%360;return out;}
// Flat [x0,y0,x1,y1,…] of rim-coloured pixel centres (pixel x covers x…x+1, as for the cursor), of one hue if given.
function ringPoints(img,hue=null,hues=hueMap(img)){const w=img.width,pts=[];for(let i=0;i<hues.length;i++){const h=hues[i];if(h>=0&&(hue===null||hueGap(h,hue)<=HUE_SPREAD))pts.push(i%w+.5,Math.floor(i/w)+.5);}return pts;}
// The hues worth a circle search: peaks of the hue histogram with enough pixels for a rim.
function huePeaks(hues,{min=150,count=4}={}){
  const bins=new Float64Array(36);for(const h of hues)if(h>=0)bins[Math.floor(h/10)%36]++;
  const smooth=bins.map((v,i)=>v+(bins[(i+35)%36]+bins[(i+1)%36])/2),peaks=[];
  for(let i=0;i<36;i++)if(smooth[i]>=min&&smooth[i]>=smooth[(i+35)%36]&&smooth[i]>smooth[(i+1)%36])peaks.push({hue:i*10+5,n:smooth[i]});
  return peaks.sort((a,b)=>b.n-a.n).slice(0,count);
}
// The zone is a tinted disc whose saturation rises towards its edge and ends in a sharp drop to the grey map;
// the line at the edge is 7 px thick on one screenshot and a 14 px glow on another. So the rim is found on rays
// across the rough circle: the last sharp drop outwards, located where it passes half the local peak. Samples of
// other hues count as grey. Returns the rim points and how many rays saw the rim area.
function rimRays(img,c,hue,{rays=720,reach=30}={}){
  const {width:w,height:h,data:d}=img,pts=[],steps=reach*4+1;let visible=0;
  const sat=new Float32Array(steps);
  for(let k=0;k<rays;k++){
    const a=k/rays*2*Math.PI,cos=Math.cos(a),sin=Math.sin(a);
    if(!(c.cx+c.r*cos>=0&&c.cy+c.r*sin>=0&&c.cx+c.r*cos<w&&c.cy+c.r*sin<h))continue;
    visible++;let max=0;
    for(let i=0;i<steps;i++){
      const t=-reach+i/2,x=Math.floor(c.cx+(c.r+t)*cos),y=Math.floor(c.cy+(c.r+t)*sin);let s=0;
      if(x>=0&&y>=0&&x<w&&y<h){const o=(y*w+x)*4,r=d[o],g=d[o+1],b=d[o+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b);if(mx-mn>=12){const hh=60*(mx===r?((g-b)/(mx-mn)+6)%6:mx===g?(b-r)/(mx-mn)+2:(r-g)/(mx-mn)+4);if(hueGap(hh,hue)<=HUE_SPREAD+10)s=mx-mn;}}
      sat[i]=s;if(s>max)max=s;
    }
    if(max<30)continue;
    let edge=-1;for(let i=steps-1;i>=0;i--)if(sat[i]>=max/2){edge=i;break;}
    // Sharp outside: at most a quarter of the peak 8 px beyond the edge, else the ray ended on an icon or a gradient.
    if(edge<0||edge+16>=steps||sat[edge+16]>max/4)continue;
    // The zone ends where the tint ends: the outer edge, at half the local peak, interpolated between samples.
    // (The game's axis labels, 100 m apart, confirm this radius; the brightest line just inside it reads 0.5–2 % small.)
    let peak=0;for(let i=Math.max(0,edge-24);i<=edge;i++)if(sat[i]>peak)peak=sat[i];
    let i=edge;while(i+1<steps&&sat[i+1]>=peak/2)i++;
    const inner=sat[i],outer=sat[i+1],t=-reach+(i+(inner>outer?(inner-peak/2)/(inner-outer):0))/2;
    pts.push(c.cx+(c.r+t)*cos,c.cy+(c.r+t)*sin);
  }
  return {pts,visible};
}

// Algebraic (Kåsa) least-squares circle through the points listed in idx, on mean-centred coordinates.
function fitCircle(pts,idx){
  const m=idx.length;if(m<3)return null;
  let mx=0,my=0;for(const i of idx){mx+=pts[2*i];my+=pts[2*i+1];}mx/=m;my/=m;
  let suu=0,svv=0,suv=0,suz=0,svz=0,sz=0;
  for(const i of idx){const u=pts[2*i]-mx,v=pts[2*i+1]-my,z=u*u+v*v;suu+=u*u;svv+=v*v;suv+=u*v;suz+=u*z;svz+=v*z;sz+=z;}
  const det=suu*svv-suv*suv;if(Math.abs(det)<1e-9)return null;
  const D=(suv*svz-svv*suz)/det,E=(suv*suz-suu*svz)/det,r2=(D*D+E*E)/4+sz/m;
  return r2>0?{cx:mx-D/2,cy:my-E/2,r:Math.sqrt(r2)}:null;
}
function solve3(A,b){
  const det=m=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  const d=det(A);if(Math.abs(d)<1e-12)return null;
  return [0,1,2].map(k=>det(A.map((row,i)=>row.map((v,j)=>j===k?b[i]:v)))/d);
}
// Geometric refinement (Gauss–Newton on distance to the rim): the algebraic fit shrinks the radius on short arcs.
function refineCircle(pts,idx,c){
  let {cx,cy,r}=c;
  for(let step=0;step<6;step++){
    const A=[[0,0,0],[0,0,0],[0,0,0]],g=[0,0,0];
    for(const i of idx){const dx=pts[2*i]-cx,dy=pts[2*i+1]-cy,d=Math.hypot(dx,dy)||1e-9,j=[-dx/d,-dy/d,-1],f=d-r;for(let p=0;p<3;p++){g[p]-=j[p]*f;for(let q=0;q<3;q++)A[p][q]+=j[p]*j[q];}}
    const delta=solve3(A,g);if(!delta)break;
    cx+=delta[0];cy+=delta[1];r+=delta[2];
    if(Math.abs(delta[0])+Math.abs(delta[1])+Math.abs(delta[2])<1e-3)break;
  }
  return r>0?{cx,cy,r}:c;
}
function circumcircle(pts,i,j,k){
  const ax=pts[2*i],ay=pts[2*i+1],bx=pts[2*j],by=pts[2*j+1],cx=pts[2*k],cy=pts[2*k+1];
  if(Math.hypot(ax-bx,ay-by)<4||Math.hypot(bx-cx,by-cy)<4||Math.hypot(ax-cx,ay-cy)<4)return null;
  const d=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));if(Math.abs(d)<1e-6)return null;
  const a2=ax*ax+ay*ay,b2=bx*bx+by*by,c2=cx*cx+cy*cy,x=(a2*(by-cy)+b2*(cy-ay)+c2*(ay-by))/d,y=(a2*(cx-bx)+b2*(ax-cx)+c2*(bx-ax))/d;
  return {cx:x,cy:y,r:Math.hypot(ax-x,ay-y)};
}
const inliersOf=(pts,c,tolerance)=>{const idx=[];for(let i=0;i<pts.length/2;i++)if(Math.abs(Math.hypot(pts[2*i]-c.cx,pts[2*i+1]-c.cy)-c.r)<=tolerance)idx.push(i);return idx;};
// RANSAC on circumcircles of random triples: icons, markers and other green blobs do not pull the fit.
// Deterministic seed, so the same frame always gives the same circle.
// rough: the caller refines the circle itself (rays across the rim), so hypotheses are scored on fewer points and
// the final geometric refinement is skipped — a third of the cost.
function ransacCircle(pts,{iterations=160,tolerance=2.5,minR=12,maxR=1e5,rough=false}={}){
  const n=pts.length/2;if(n<3)return null;
  const stride=Math.max(1,Math.floor(n/(rough?800:2500)));let seed=0x2f6b5d1,best=null,bestCount=0;
  const pick=()=>{seed=(Math.imul(seed,1103515245)+12345)>>>0;return Math.floor(seed/4294967296*n);};
  for(let k=0;k<iterations;k++){
    const c=circumcircle(pts,pick(),pick(),pick());if(!c||c.r<minR||c.r>maxR)continue;
    let count=0;for(let q=0;q<n;q+=stride)if(Math.abs(Math.hypot(pts[2*q]-c.cx,pts[2*q+1]-c.cy)-c.r)<=tolerance)count++;
    if(count>bestCount){bestCount=count;best=c;}
  }
  if(!best)return null;
  let idx=inliersOf(pts,best,tolerance+1),c=idx.length>=3?fitCircle(pts,idx):null;if(!c)return null;
  if(rough)idx=inliersOf(pts,c,tolerance);
  else{for(const tol of [tolerance,tolerance]){c=refineCircle(pts,idx,c);idx=inliersOf(pts,c,tol);if(idx.length<3)return null;}c=refineCircle(pts,idx,c);}
  if(idx.length<3)return null;
  let square=0;const bins=new Uint8Array(72);
  for(const i of idx){const dx=pts[2*i]-c.cx,dy=pts[2*i+1]-c.cy;square+=(Math.hypot(dx,dy)-c.r)**2;bins[Math.min(71,Math.floor((Math.atan2(dy,dx)+Math.PI)/(2*Math.PI)*72))]=1;}
  return {cx:c.cx,cy:c.cy,r:c.r,inliers:idx.length,rms:Math.sqrt(square/idx.length),coverage:bins.reduce((s,v)=>s+v,0)/72};
}
// Every rim-like circle on this frame, largest first, each with its hue: a rough RANSAC circle on pixels of one
// hue, then the rim found on rays across it. coverage is the share of the circumference seen; continuity the share
// of rays that found the rim where the circle is on the frame; weak = too short an arc for a precise radius.
// Half the width and height, 2×2 box averages: the rough circle search runs on this, the rays on the full frame.
function halfImage({width:w,height:h,data:d}){
  const hw=w>>1,hh=h>>1,out=new Uint8ClampedArray(hw*hh*4);
  for(let y=0;y<hh;y++)for(let x=0;x<hw;x++){const a=((2*y)*w+2*x)*4,b=a+w*4,o=(y*hw+x)*4;for(let c=0;c<3;c++)out[o+c]=(d[a+c]+d[a+4+c]+d[b+c]+d[b+4+c])/4;out[o+3]=255;}
  return {width:hw,height:hh,data:out};
}
function ringCandidates(img,{minPoints=60,minCoverage=.15}={}){
  // Frames wider than 600 px are searched at half size (a quarter of the pixels): ring pixels and radii halve.
  const k=img.width>600?2:1,small=k===2?halfImage(img):img,hues=hueMap(small),found=[],maxR=Math.hypot(small.width,small.height)*4;
  for(const {hue}of huePeaks(hues,{min:150/k/k})){
    const pts=ringPoints(small,hue,hues);if(pts.length/2<minPoints/k)continue;
    const found1=ransacCircle(pts,{maxR,minR:12/k,iterations:pts.length>20000?300:160,rough:true});
    if(!found1||found1.inliers<minPoints/k||found1.coverage<minCoverage||found1.rms>1.6)continue;
    const rough={cx:found1.cx*k,cy:found1.cy*k,r:found1.r*k};
    // Two passes on the full frame: the second from the circle the first found, so the rays sit square on the rim.
    let c=rough,rim=null;
    for(let pass=0;pass<2&&c;pass++){
      // Coarse then fine: 360 rays ±24 px from the rough circle, then 720 rays ±16 px from the first fit (the edge
      // lies a few px outside the rim and must be seen with 8 px beyond it).
      rim=rimRays(img,c,hue,pass===0?{rays:360,reach:24}:{rays:720,reach:16});const n=rim.pts.length/2;if(n<(pass===0?15:30))break;
      let idx=[...Array(n).keys()],f=fitCircle(rim.pts,idx);if(!f)break;
      for(const tol of [3,1.5]){f=refineCircle(rim.pts,idx,f);idx=inliersOf(rim.pts,f,tol);if(idx.length<30){f=null;break;}}
      c=f&&{...refineCircle(rim.pts,idx,f),idx};
    }
    if(!c?.idx||c.r<12)continue;
    let square=0;const bins=new Uint8Array(72);
    for(const i of c.idx){const dx=rim.pts[2*i]-c.cx,dy=rim.pts[2*i+1]-c.cy;square+=(Math.hypot(dx,dy)-c.r)**2;bins[Math.min(71,Math.floor((Math.atan2(dy,dx)+Math.PI)/(2*Math.PI)*72))]=1;}
    const rms=Math.sqrt(square/c.idx.length),coverage=bins.reduce((s,v)=>s+v,0)/72,continuity=c.idx.length/Math.max(1,rim.visible);
    // A disc edge, not foliage or an icon: round (small residual), continuous along the part on the frame.
    if(rms>1.5||coverage<minCoverage||continuity<.6)continue;
    found.push({cx:c.cx,cy:c.cy,r:c.r,hue,inliers:c.idx.length,rms,coverage,continuity,weak:coverage<.35});
  }
  return found.sort((a,b)=>b.r-a.r);
}
// The rim on this frame, or null: the largest rim-like circle, or the largest of the given hue.
function detectRing(img,{hue=null,...options}={}){return ringCandidates(img,options).find(c=>hue===null||hueGap(c.hue,hue)<=HUE_SPREAD)||null;}

// The in-game map panel inside a loosely drawn area: the largest near-square whose four sides are straight lines
// running unbroken from one side to the other. Grid lines and the cursor's crosshair are straight too, but only
// the panel's edges make that square. Returns {x, y, width, height} in image pixels (outer edge lines), or null.
// The panel is square within half a per cent; 1.5 % keeps the shadow it casts on the sky from passing as an edge.
function findMapPanel(img,{step=12,minShare=.8,squareness=.015}={}){
  const {width:w,height:h,data:d}=img,L=new Float32Array(w*h);
  for(let i=0;i<w*h;i++)L[i]=.299*d[i*4]+.587*d[i*4+1]+.114*d[i*4+2];
  // Edge maps and prefix sums: how many rows y0…y1 have a vertical edge at column x (and the same for rows).
  const colSum=new Uint32Array((w)*(h+1)),rowSum=new Uint32Array((h)*(w+1));
  for(let x=1;x<w-1;x++)for(let y=0;y<h;y++)colSum[x*(h+1)+y+1]=colSum[x*(h+1)+y]+(Math.abs(L[y*w+x+1]-L[y*w+x-1])>step?1:0);
  for(let y=1;y<h-1;y++)for(let x=0;x<w;x++)rowSum[y*(w+1)+x+1]=rowSum[y*(w+1)+x]+(Math.abs(L[(y+1)*w+x]-L[(y-1)*w+x])>step?1:0);
  const colShare=(x,y0,y1)=>(colSum[x*(h+1)+y1]-colSum[x*(h+1)+y0])/Math.max(1,y1-y0);
  const rowShare=(y,x0,x1)=>(rowSum[y*(w+1)+x1]-rowSum[y*(w+1)+x0])/Math.max(1,x1-x0);
  // Candidate lines: local peaks of the full-length share, the 16 strongest each way.
  const peaks=(n,share)=>{const s=[];for(let i=1;i<n-1;i++)s.push(share(i));const out=[];for(let i=1;i<s.length-1;i++)if(s[i]>=.5&&s[i]>=s[i-1]&&s[i]>=s[i+1])out.push({at:i+1,s:s[i]});return out.sort((a,b)=>b.s-a.s).slice(0,16).map(p=>p.at);};
  const cols=peaks(w,x=>colShare(x,0,h)),rows=peaks(h,y=>rowShare(y,0,w));
  let best=null;
  for(const l of cols)for(const r of cols){
    const size=r-l;if(size<Math.min(w,h)*.5)continue;
    for(const t of rows)for(const b of rows){
      const tall=b-t;if(tall<=0||Math.abs(tall-size)>Math.max(3,size*squareness))continue;
      // Each side unbroken along the span between the other two (a few px in from the corners).
      const score=Math.min(colShare(l,t+3,b-3),colShare(r,t+3,b-3),rowShare(t,l+3,r-3),rowShare(b,l+3,r-3));
      if(score<minShare)continue;
      if(!best||size*tall>best.width*best.height+4*size||(Math.abs(size*tall-best.width*best.height)<=4*size&&score>best.score))best={x:l,y:t,width:size,height:tall,score};
    }
  }
  return best;
}
// Is the map open? Once the area is fitted to the panel, its frame lies on the area's edges. A strip across one edge
// (vertical: the strip runs top to bottom): the share of its length that one straight edge covers, best line of the
// strip. An open map scores 1 on every side, the 3D world behind a closed one about 0.1–0.3 (up to 0.7 on one side).
function lineShare({width:w,height:h,data:d},vertical,{step=12,skip=6}={}){
  const n=vertical?w:h,len=vertical?h:w,L=(i,j)=>{const o=(vertical?j*w+i:i*w+j)*4;return .299*d[o]+.587*d[o+1]+.114*d[o+2];};
  let best=0;
  for(let i=1;i<n-1;i++){let hits=0;for(let j=skip;j<len-skip;j++)if(Math.abs(L(i+1,j)-L(i-1,j))>step)hits++;best=Math.max(best,hits/Math.max(1,len-2*skip));}
  return best;
}
// Strips across the four edges of rect, margin px to each side of it: left, right, top, bottom.
function edgeStrips(rect,margin){const {x,y,width:w,height:h}=rect,m=margin;return [{x:x-m,y,width:2*m,height:h,vertical:true},{x:x+w-m,y,width:2*m,height:h,vertical:true},{x,y:y-m,width:w,height:2*m,vertical:false},{x,y:y+h-m,width:w,height:2*m,vertical:false}];}
// Open when three sides show the frame: an icon or the cursor may cover part of one.
const panelOpen=shares=>shares.filter(s=>s>=.6).length>=3;

// Screen ↔ game units: the rim is the zone's radius around its known centre (map north is up).
function ringTransform(circle,zone){return {cx:circle.cx,cy:circle.cy,scale:circle.r/(zone.radiusM/100),x:zone.pos[0]*ZONE_WORLD,y:(1-zone.pos[1])*ZONE_WORLD};}
function pixelToWorld(t,px,py){return {x:t.x+(px-t.cx)/t.scale,y:t.y-(py-t.cy)/t.scale};}
function worldToPixel(t,x,y){return {x:t.cx+(x-t.x)*t.scale,y:t.cy-(y-t.y)*t.scale};}

// Luminance of the circle's interior on a size×size grid over its bounding square (the same square as a zone patch).
// Cells off the frame, near the rim or under saturated icons are left out.
function discSample(img,circle,size){
  const {width:w,height:h,data:d}=img,cells=size*size,lum=new Float32Array(cells),sat=new Float32Array(cells),valid=new Uint8Array(cells);
  const cell=2*circle.r/size,k=Math.max(1,Math.min(6,Math.round(cell)));
  for(let j=0;j<size;j++)for(let i=0;i<size;i++){
    const a=(i+.5)/size*2-1,b=(j+.5)/size*2-1;if(a*a+b*b>.81)continue;
    const x0=circle.cx-circle.r+i*cell,y0=circle.cy-circle.r+j*cell;let L=0,S=0,inside=true;
    for(let q=0;q<k&&inside;q++)for(let p=0;p<k;p++){
      const x=Math.floor(x0+(p+.5)*cell/k),y=Math.floor(y0+(q+.5)*cell/k);if(x<0||y<0||x>=w||y>=h){inside=false;break;}
      const o=(y*w+x)*4,r=d[o],g=d[o+1],bl=d[o+2];L+=.299*r+.587*g+.114*bl;S+=Math.max(r,g,bl)-Math.min(r,g,bl);
    }
    if(inside){const c=j*size+i;lum[c]=L/(k*k);sat[c]=S/(k*k);valid[c]=1;}
  }
  const s=[];for(let c=0;c<cells;c++)if(valid[c])s.push(sat[c]);s.sort((x,y)=>x-y);
  const limit=(s[s.length>>1]??0)+25;let count=0;
  for(let c=0;c<cells;c++){if(valid[c]&&sat[c]>limit)valid[c]=0;count+=valid[c];}
  return {size,lum,valid,count};
}
// Normalised cross-correlation over the valid cells: immune to the green tint and the map's brightness.
function correlate(sample,patch,minCells=200){
  let n=0,ma=0,mb=0;for(let c=0;c<patch.length;c++)if(sample.valid[c]){n++;ma+=sample.lum[c];mb+=patch[c];}
  if(n<minCells)return null;ma/=n;mb/=n;
  let ab=0,aa=0,bb=0;for(let c=0;c<patch.length;c++)if(sample.valid[c]){const x=sample.lum[c]-ma,y=patch[c]-mb;ab+=x*y;aa+=x*x;bb+=y*y;}
  return aa>0&&bb>0?ab/Math.sqrt(aa*bb):null;
}
// Best matching zone. confident needs a clear score and a clear lead over every other zone.
function recogniseZone(sample,patches){
  let best=null,second=-1;
  for(const [key,patch]of Object.entries(patches)){const score=correlate(sample,patch);if(score===null)continue;if(!best||score>best.score){if(best)second=best.score;best={key,score};}else if(score>second)second=score;}
  return best&&{...best,margin:best.score-second,confident:best.score>=.4&&best.score-second>=.15};
}
function decodePatch(text){const s=atob(text),a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return a;}
if(typeof module!=='undefined')module.exports={ZONE_WORLD,FRAME_FORMATS,frameToRgba,hueOf,isRingColor,hueMap,halfImage,ringPoints,huePeaks,rimRays,findMapPanel,lineShare,edgeStrips,panelOpen,fitCircle,refineCircle,ransacCircle,ringCandidates,detectRing,ringTransform,pixelToWorld,worldToPixel,discSample,correlate,recogniseZone,decodePatch};
