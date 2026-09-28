'use strict';
// End-to-end check of the game-map layer on this machine (run with Electron, needs a real screen): a stand-in
// "game" window shows the fixture screenshot and the saved area covers its map panel. The app must lock onto the
// rim, recognise North America · Detroit (zone zestafona-default), switch the overlay to it and print game
// coordinates under the cursor; in marker mode (Insert) clicks on the game map must become points in the overlay
// and be drawn there; the picker redraws the area; closing the map drops the lock; with the rim painted over,
// Insert must find the map by the terrain.
const {app,BrowserWindow,screen}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(root,'.test-output','layer-'));
fs.mkdirSync(data,{recursive:true});
app.setPath('userData',data);
// Do not take Insert from a running copy of the app; keep the handler to press it from the test.
const hotkeys={};require('electron').globalShortcut.register=(key,fn)=>{hotkeys[key]=fn;return true;};
const wait=async(label,fn,timeout=15000)=>{const end=Date.now()+timeout;for(;;){const value=await fn();if(value)return value;if(Date.now()>end)throw new Error('Timed out: '+label);await new Promise(r=>setTimeout(r,150));}};
const byPage=name=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().endsWith(name));
const read=(w,js)=>w.webContents.executeJavaScript(js);

app.on('web-contents-created',(_e,contents)=>{contents.on('console-message',e=>{if(e.level!=='info'&&e.level!=='debug')console.log('['+contents.getURL().split('/').pop()+']',e.message);});contents.on('preload-error',(_e,p,err)=>console.log('preload error',p,err.message));});
app.whenReady().then(async()=>{
  const display=screen.getPrimaryDisplay(),b=display.bounds,game={x:b.x+40,y:b.y+40,width:1251,height:1085};
  // The fixture's map panel is at 172,97 (876×878 px); keep the overlay window off it.
  fs.writeFileSync(path.join(data,'map-area.json'),JSON.stringify({display:{id:String(display.id),bounds:b},rect:{x:game.x+172-40,y:game.y+97-40,width:876+80,height:878+80}}));// drawn loosely, like the user did
  fs.writeFileSync(path.join(data,'window-position.json'),JSON.stringify({x:b.x+b.width-1090,y:b.y+20}));
  fs.copyFileSync(path.join(__dirname,'fixtures','zone-northamerica.webp'),path.join(data,'game.webp'));
  // The stand-in draws the screenshot on a canvas; hideRim() paints every green pixel grey (rim and tinted fill),
  // leaving only the terrain.
  fs.writeFileSync(path.join(data,'game.html'),`<!doctype html><body style="margin:0;overflow:hidden;background:#000"><canvas id="map" width="1251" height="1085" style="display:block"></canvas><script>
    const c=document.getElementById('map'),g=c.getContext('2d'),img=new Image();img.onload=()=>g.drawImage(img,0,0);img.src='game.webp';
    window.hideRim=()=>{const d=g.getImageData(0,0,c.width,c.height),p=d.data;for(let i=0;i<p.length;i+=4){const [r,gg,b]=[p[i],p[i+1],p[i+2]];const mx=Math.max(r,gg,b),mn=Math.min(r,gg,b);if(mx===gg&&mx-mn>=12){const l=.3*r+.59*gg+.11*b;p[i]=p[i+1]=p[i+2]=l;}}g.putImageData(d,0,0);};
  </script>`);
  const stand=new BrowserWindow({...game,frame:false,resizable:false,focusable:false,skipTaskbar:true,show:false,useContentSize:true});
  stand.setAlwaysOnTop(true,'screen-saver');await stand.loadFile(path.join(data,'game.html'));stand.showInactive();
  assert.equal(display.scaleFactor,1,'the stand-in shows the screenshot 1:1 only at 100 % scaling');

  require('../desktop/main.cjs');
  const overlay=await wait('overlay',()=>byPage('index.html'));
  await wait('overlay loaded',()=>!overlay.webContents.isLoading()&&read(overlay,'Boolean(document.body.classList.contains("desktop"))'));
  assert.equal(await read(overlay,'document.getElementById("terrain-select").value'),'kavkazi','starts on the default map');
  const status=()=>read(overlay,'[document.getElementById("game-map").dataset.state,document.getElementById("game-map-status").textContent]');
  const locked=await wait('rim locked and zone recognised',async()=>{const [state,text]=await status();return state==='locked'&&text.includes('North America · Detroit · Основная')&&[state,text];}).catch(async error=>{const l=byPage('layer.html');console.log('status:',await status(),'layer:',l&&await read(l,'JSON.stringify({stats:window.layerStats,badge:document.getElementById("badge").textContent,hidden:document.getElementById("badge").hidden})'),'bounds:',l?.getBounds());const {desktopCapturer,nativeImage}=require('electron');const [src]=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:b.width,height:b.height}});fs.writeFileSync(path.join(data,'seen.png'),src.thumbnail.crop({x:game.x-b.x,y:game.y-b.y,width:game.width,height:game.height}).resize({width:626}).toPNG());console.log('saved',path.join(data,'seen.png'));throw error;});
  console.log('overlay status:',locked[1]);
  assert.equal(await read(overlay,'document.getElementById("terrain-select").value'),'northamerica','overlay switched to the recognised map');
  assert.equal(await read(overlay,'document.getElementById("zone-select").value'),'zestafona-default');
  // «Зона»: the overlay's own map shows the zone circle with a margin (500 m radius → 2.6 × 30.5 of 1000 units).
  const zoneView=await read(overlay,'document.getElementById("fit-zone").click();document.getElementById("terrain").getAttribute("viewBox").split(" ").map(Number)');
  assert.ok(Math.abs(zoneView[2]-2.6*500/16384*1000)<1,'zone fills the map: '+zoneView);

  // The loose area (40 px of 3D world around the panel) is fitted to the panel once the map is calibrated.
  const fitted=await wait('area fitted to the map panel',()=>{const a=JSON.parse(fs.readFileSync(path.join(data,'map-area.json'),'utf8'));return a.snapped&&a;});
  console.log('area fitted:',JSON.stringify(fitted.rect),'(panel at',game.x+172,game.y+97,'876×878)');
  assert.ok(Math.abs(fitted.rect.x-(game.x+172))<=3&&Math.abs(fitted.rect.y-(game.y+97))<=3&&Math.abs(fitted.rect.width-876)<=4&&Math.abs(fitted.rect.height-878)<=4,'fitted to the panel');
  await wait('locked again over the panel',async()=>{const l=byPage('layer.html');return l&&Math.abs(l.getBounds().x-fitted.rect.x)<1&&(await status())[0]==='locked';});
  let layer=byPage('layer.html');
  assert.equal(layer.isFocusable(),false);
  // Screenshot pixel → layer window pixel, wherever the layer ended up; game units → screenshot pixels on the grid.
  const px=(x,y)=>{const r=layer.getBounds();return {x:Math.round(537.5+(x-70)*74.98-(r.x-game.x)),y:Math.round(760.5-(y-100)*74.98-(r.y-game.y))};};
  // Grid line x=70 is column 537 and y=100 row 760 of the screenshot.
  layer.webContents.sendInputEvent({type:'mouseMove',...px(70,100)});
  const readout=await wait('cursor readout',()=>read(layer,'document.getElementById("readout").hidden?"":document.getElementById("readout").textContent'));
  const [, x, y]=readout.match(/x([\d.]+)\s+y([\d.]+)/).map(Number);
  console.log('readout at grid 70/100:',readout.trim());
  assert.ok(Math.abs(x-70)<.05&&Math.abs(y-100)<.06,readout);
  const stats=await read(layer,'window.layerStats');
  console.log(`frames analysed: ${stats.frames}, ~${stats.ms.toFixed(1)} ms per frame`);

  // Marker mode (Insert): clicks on the in-game map become points in the overlay, keys go to the overlay too.
  const clickAt=(p,button='left')=>{for(const type of ['mouseDown','mouseUp'])layer.webContents.sendInputEvent({type,...p,button,clickCount:1});};
  const coords=js=>read(overlay,`(${js})?.textContent.match(/x([\\d.]+), y([\\d.]+)/)?.slice(1).map(Number)`);
  hotkeys.Insert();
  await wait('marker mode',async()=>(await status())[0]==='marking'&&layer.isFocusable()&&read(layer,'document.body.classList.contains("marking")'));
  // The overlay window stays usable meanwhile: clickable (editing view) without taking the keyboard from the layer.
  await wait('overlay clickable in marker mode',()=>read(overlay,'!document.body.classList.contains("view-only")'));
  assert.equal(overlay.isFocusable(),true);assert.equal(overlay.isFocused(),false,'the layer keeps the keyboard');
  clickAt(px(70,103));
  const me=await wait('my position from the game map',()=>coords('document.getElementById("map-player-label")'));
  clickAt(px(72,101));
  const goal=await wait('target from the game map',()=>coords('document.querySelector(\'[data-target-id="1"] .card-coords\')'));
  clickAt(px(72.3,101.2),'right');
  await wait('impact from the game map',()=>read(overlay,'!document.getElementById("fs-tag").hidden'));
  console.log('placed on the game map: me',me.join(', '),'· target',goal.join(', '),'· azimuth',await read(overlay,'document.getElementById("fs-azimuth").textContent'));
  assert.ok(Math.hypot(me[0]-70,me[1]-103)<.05&&Math.hypot(goal[0]-72,goal[1]-101)<.05,'points within 5 m of where the game map was clicked');
  const pins=await wait('pins drawn over the game map',async()=>{const n=await read(layer,'document.querySelectorAll("#marks .pin").length');return n===4&&n;});
  assert.equal(pins,4,'me, target, corrected aim, impact');
  layer.webContents.sendInputEvent({type:'keyDown',keyCode:'G'});layer.webContents.sendInputEvent({type:'keyUp',keyCode:'G'});
  await wait('G from the layer selects my-position tool',()=>read(overlay,'document.querySelector(\'[data-map-tool="player"]\').getAttribute("aria-pressed")==="true"'));
  layer.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
  await wait('Esc hands the mouse back',async()=>(await status())[0]==='locked'&&!layer.isFocusable());
  await wait('overlay back to viewing',()=>read(overlay,'document.body.classList.contains("view-only")'));

  // Picker: draw the same panel again; the layer is rebuilt over it and locks again.
  await read(overlay,'window.overlay.gameMap.pick()');
  const picker=await wait('picker',()=>byPage('area-picker.html'));
  await wait('picker loaded',()=>!picker.webContents.isLoading()&&picker.isVisible());
  assert.equal(overlay.isVisible(),false,'overlay hidden while picking');
  const from={x:game.x-b.x+172,y:game.y-b.y+97},to={x:from.x+876,y:from.y+878};
  picker.webContents.sendInputEvent({type:'mouseDown',x:from.x,y:from.y,button:'left',clickCount:1});
  for(let k=1;k<=5;k++)picker.webContents.sendInputEvent({type:'mouseMove',x:from.x+(to.x-from.x)*k/5,y:from.y+(to.y-from.y)*k/5,button:'left',modifiers:['leftButtonDown']});
  picker.webContents.sendInputEvent({type:'mouseUp',x:to.x,y:to.y,button:'left',clickCount:1});
  await wait('picker closed',()=>!byPage('area-picker.html'));
  const saved=JSON.parse(fs.readFileSync(path.join(data,'map-area.json'),'utf8'));
  assert.deepEqual(saved.rect,{x:game.x+172,y:game.y+97,width:876,height:878});
  assert.equal(overlay.isVisible(),true,'overlay back after picking');
  await wait('locked after picking',async()=>(await status())[0]==='locked');
  layer=byPage('layer.html');// the picker rebuilt the layer window

  // "Close the map": the rim disappears, the layer goes back to waiting.
  await read(stand,'document.getElementById("map").style.visibility="hidden"');
  const [state,text]=await wait('map closed',async()=>{const s=await status();return s[0]==='searching'&&s;});
  console.log('after closing the map:',text);

  // Terrain: the map comes back with its rim painted over. Insert finds it by the terrain alone and enters marker mode.
  await read(stand,'document.getElementById("map").style.visibility="visible";window.hideRim();true');
  hotkeys.Insert();
  await wait('marker mode found by terrain',async()=>(await status())[0]==='marking',20000).catch(async error=>{console.log('status:',await status(),'layer:',await read(layer,'JSON.stringify({stats:window.layerStats,badge:document.getElementById("badge").textContent})'));throw error;});
  layer.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
  const [,byTerrain]=await wait('calibrated by terrain',async()=>{const s=await status();return s[0]==='locked'&&s[1].includes('по местности')&&s;});
  console.log('rim painted over:',byTerrain);
  layer.webContents.sendInputEvent({type:'mouseMove',x:10,y:10});layer.webContents.sendInputEvent({type:'mouseMove',...px(70,100)});
  const terrainReadout=await wait('terrain readout',()=>read(layer,'document.getElementById("readout").hidden?"":document.getElementById("readout").textContent'));
  const [, tx, ty]=terrainReadout.match(/x([\d.]+)\s+y([\d.]+)/).map(Number);
  console.log('terrain readout at grid 70/100:',terrainReadout.trim(),'· layer',JSON.stringify(await read(layer,'window.layerStats')));
  assert.ok(Math.abs(tx-70)<.05&&Math.abs(ty-100)<.05,'terrain calibration on the game grid within 5 m: '+terrainReadout);
  console.log('PASS: a loosely drawn area fitted to the map panel, rim locked on the stand-in game map, zone recognised and applied to the overlay, cursor readout on the game grid within 5 m, marker mode placed my position, a target and an impact from clicks on the game map and drew them there, picker saved the area, lock dropped when the map closed, and with the rim painted over Insert found the map by the terrain and the readout stayed on the grid.');
  app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
