'use strict';
// Memory soak of the game-map layer (run with Electron on a real screen): a stand-in "game" window keeps its map
// moving so every frame is analysed, through three phases — rim in view (rim tracking), rim painted over (terrain
// tracking), map closed (only its frame checked) — while the memory of every process is sampled. Growth after warm-up
// means a leak. SHOT_SOAK_SECONDS sets the length (default 150); SHOT_TEST_NO_GPU=1 runs without GPU acceleration,
// the path of machines whose graphics driver Chromium rejects.
const {app,BrowserWindow,screen}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
if(process.env.SHOT_TEST_NO_GPU==='1')app.disableHardwareAcceleration();
const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'.test-output'),{recursive:true});
const data=fs.mkdtempSync(path.join(root,'.test-output','soak-'));
app.setPath('userData',data);
require('electron').globalShortcut.register=()=>true;
const seconds=Number(process.env.SHOT_SOAK_SECONDS)||150,wait=ms=>new Promise(r=>setTimeout(r,ms));
const byPage=name=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().endsWith(name));

app.whenReady().then(async()=>{
  const display=screen.getPrimaryDisplay(),b=display.bounds,game={x:b.x+40,y:b.y+40,width:1251,height:1085};
  fs.writeFileSync(path.join(data,'map-area.json'),JSON.stringify({display:{id:String(display.id),bounds:b},rect:{x:game.x+132,y:game.y+57,width:956,height:958}}));
  fs.writeFileSync(path.join(data,'window-position.json'),JSON.stringify({x:b.x+b.width-1090,y:b.y+20}));
  fs.copyFileSync(path.join(__dirname,'fixtures','zone-northamerica.webp'),path.join(data,'game.webp'));
  // The stand-in pans the map inside its panel ±12 px in a slow circle, so no two frames are alike; the panel's frame
  // stays put, as in the game.
  fs.writeFileSync(path.join(data,'game.html'),`<!doctype html><body style="margin:0;overflow:hidden;background:#000"><canvas id="map" width="1251" height="1085" style="display:block"></canvas><script>
    const c=document.getElementById('map'),g=c.getContext('2d'),img=new Image();let plain=null,t0=performance.now();
    img.onload=()=>{const o=new OffscreenCanvas(1251,1085),og=o.getContext('2d');og.drawImage(img,0,0);plain=o;requestAnimationFrame(draw);};img.src='game.webp';
    function draw(){const t=(performance.now()-t0)/1000;g.drawImage(plain,0,0);g.save();g.beginPath();g.rect(176,101,868,870);g.clip();g.fillStyle='#000';g.fillRect(176,101,868,870);g.drawImage(plain,Math.round(12*Math.sin(t*.7)),Math.round(12*Math.cos(t*.5)));g.restore();requestAnimationFrame(draw);}
    window.hideRim=()=>{const og=plain.getContext('2d'),d=og.getImageData(0,0,1251,1085),p=d.data;for(let i=0;i<p.length;i+=4){const mx=Math.max(p[i],p[i+1],p[i+2]),mn=Math.min(p[i],p[i+1],p[i+2]);if(mx===p[i+1]&&mx-mn>=12){const l=.3*p[i]+.59*p[i+1]+.11*p[i+2];p[i]=p[i+1]=p[i+2]=l;}}og.putImageData(d,0,0);};
  </script>`);
  const stand=new BrowserWindow({...game,frame:false,resizable:false,focusable:false,skipTaskbar:true,show:false,useContentSize:true});
  stand.setAlwaysOnTop(true,'screen-saver');await stand.loadFile(path.join(data,'game.html'));stand.showInactive();

  require('../desktop/main.cjs');
  let overlay;while(!(overlay=byPage('index.html'))||overlay.webContents.isLoading())await wait(200);
  const status=()=>overlay.webContents.executeJavaScript('[document.getElementById("game-map").dataset.state,document.getElementById("game-map-status").textContent]');
  // Memory per process type (working set and private bytes, MB) and the layer's JS heap.
  const sample=async label=>{
    const byType={};for(const p of app.getAppMetrics()){const t=p.type==='Tab'?(p.name||'renderer'):p.type;byType[t]??={ws:0,priv:0};byType[t].ws+=p.memory.workingSetSize/1024;byType[t].priv+=(p.memory.privateBytes||0)/1024;}
    const layer=byPage('layer.html'),heap=layer?await layer.webContents.executeJavaScript('performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null').catch(()=>null):null;
    const stats=layer?await layer.webContents.executeJavaScript('({frames:window.layerStats.frames,skipped:window.layerStats.skipped,ms:+window.layerStats.ms.toFixed(1)})').catch(()=>null):null;
    const total=Object.values(byType).reduce((s,v)=>s+v.priv,0);
    console.log(`${label.padEnd(26)} total ${total.toFixed(0).padStart(4)} MB · `+Object.entries(byType).map(([k,v])=>`${k} ${v.priv.toFixed(0)}`).join(' · ')+` · layer heap ${heap} MB · ${JSON.stringify(stats)} · ${(await status()).join(' ')}`);
    return {total,heap,byType};
  };
  const samples=[],phase=async(name,share)=>{const end=Date.now()+seconds*share*1000;while(Date.now()<end){await wait(10000);samples.push({name,...await sample(name)});}};
  console.log(`soak ${seconds} s, GPU ${process.env.SHOT_TEST_NO_GPU==='1'?'off':'on'}`);
  await phase('rim in view, moving',.4);
  await stand.webContents.executeJavaScript('window.hideRim();true');
  await phase('rim painted over (terrain)',.3);
  await stand.webContents.executeJavaScript('document.getElementById("map").style.visibility="hidden";true');
  await phase('map closed',.3);
  // After the first minute everything is loaded (fine map pyramid included): later samples may wobble but not climb.
  const warm=samples.filter((_,i)=>i>=Math.min(5,samples.length-2)),first=warm[0],last=warm[warm.length-1];
  const maxHeap=Math.max(...warm.map(s=>s.heap??0));
  console.log(`after warm-up: total ${first.total.toFixed(0)} → ${last.total.toFixed(0)} MB, layer heap peak ${maxHeap} MB`);
  assert.ok(last.total<first.total+80,'no steady growth of process memory after warm-up');
  assert.ok(maxHeap<400,'layer JS heap stays bounded');
  console.log('PASS: memory stayed bounded through rim tracking, terrain tracking and waiting for the map.');
  app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
