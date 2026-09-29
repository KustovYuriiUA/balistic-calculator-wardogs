'use strict';
// End-to-end check of the game-map layer on this machine (run with Electron, needs a real screen): a stand-in
// "game" window shows the fixture screenshot and the saved area covers its map panel, loosely. The app must lock
// onto the rim, recognise North America · Detroit (zone zestafona-default), switch the overlay to it, fit the area to
// the panel and from then on tell an open map from a closed one by the panel's frame. Nothing may take the keyboard:
// the overlay turns clickable by itself while the map is open, Insert only switches marker mode, and in marker mode
// clicks on the game map become points drawn there. Closing the map removes the points at once; reopening it (rim
// painted over) finds it again from the remembered calibration, and without one by the wide terrain search in the
// workers.
const {app,BrowserWindow,screen}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(root,'.test-output','layer-'));
fs.mkdirSync(data,{recursive:true});
app.setPath('userData',data);
fs.writeFileSync(path.join(data,'settings.json'),JSON.stringify({language:'ru'}));// the texts below are Russian
// Do not take Insert from a running copy of the app; keep the handler to press it from the test.
const hotkeys={};require('electron').globalShortcut.register=(key,fn)=>{hotkeys[key]=fn;return true;};
const wait=async(label,fn,timeout=15000,step=150)=>{const end=Date.now()+timeout;for(;;){const value=await fn();if(value)return value;if(Date.now()>end)throw new Error('Timed out: '+label);await new Promise(r=>setTimeout(r,step));}};
const byPage=name=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().endsWith(name));
const read=(w,js)=>w.webContents.executeJavaScript(js);
const memoryFile=path.join(data,'game-map-memory.json');

app.on('web-contents-created',(_e,contents)=>{contents.on('console-message',e=>{if(e.level!=='info'&&e.level!=='debug')console.log('['+contents.getURL().split('/').pop()+']',e.message);});contents.on('preload-error',(_e,p,err)=>console.log('preload error',p,err.message));});
app.whenReady().then(async()=>{
  const display=screen.getPrimaryDisplay(),b=display.bounds,game={x:b.x+40,y:b.y+40,width:1251,height:1085};
  // The fixture's map panel is at 172,97 (876×878 px); keep the overlay window off it.
  fs.writeFileSync(path.join(data,'map-area.json'),JSON.stringify({display:{id:String(display.id),bounds:b},rect:{x:game.x+172-40,y:game.y+97-40,width:876+80,height:878+80}}));// drawn loosely, like the user did
  fs.writeFileSync(path.join(data,'window-position.json'),JSON.stringify({x:b.x+b.width-1090,y:b.y+20}));
  fs.copyFileSync(path.join(__dirname,'fixtures','zone-northamerica.webp'),path.join(data,'game.webp'));
  // The stand-in draws the screenshot on a canvas; hideRim() paints every green pixel grey (rim and tinted fill),
  // leaving only the terrain (the panel's grey frame stays).
  fs.writeFileSync(path.join(data,'game.html'),`<!doctype html><body style="margin:0;overflow:hidden;background:#000"><canvas id="map" width="1251" height="1085" style="display:block"></canvas><script>
    const c=document.getElementById('map'),g=c.getContext('2d'),img=new Image();img.onload=()=>g.drawImage(img,0,0);img.src='game.webp';
    let blink=0;window.animate=on=>{clearInterval(blink);const spots=[[200,125],[930,125],[200,860],[930,860],[560,110],[190,500]],saved=spots.map(([x,y])=>g.getImageData(x,y,60,60));let lit=false;
      const paint=()=>{lit=!lit;spots.forEach(([x,y],i)=>{if(lit){g.fillStyle=i%2?'#e0e4e8':'#101214';g.fillRect(x,y,60,60);}else g.putImageData(saved[i],x,y);});};
      if(on)blink=setInterval(paint,70);else if(lit)paint();};
    window.hideRim=()=>{const d=g.getImageData(0,0,c.width,c.height),p=d.data;for(let i=0;i<p.length;i+=4){const [r,gg,b]=[p[i],p[i+1],p[i+2]];const mx=Math.max(r,gg,b),mn=Math.min(r,gg,b);if(mx===gg&&mx-mn>=12){const l=.3*r+.59*gg+.11*b;p[i]=p[i+1]=p[i+2]=l;}}g.putImageData(d,0,0);};
  </script>`);
  const stand=new BrowserWindow({...game,frame:false,resizable:false,focusable:false,skipTaskbar:true,show:false,useContentSize:true});
  stand.setAlwaysOnTop(true,'screen-saver');await stand.loadFile(path.join(data,'game.html'));stand.showInactive();
  assert.equal(display.scaleFactor,1,'the stand-in shows the screenshot 1:1 only at 100 % scaling');
  const setMap=js=>read(stand,`${js};true`);

  require('../desktop/main.cjs');
  const overlay=await wait('overlay',()=>byPage('index.html'));
  await wait('overlay loaded',()=>!overlay.webContents.isLoading()&&read(overlay,'Boolean(document.body.classList.contains("desktop"))'));
  assert.equal(await read(overlay,'document.getElementById("terrain-select").value'),'kavkazi','starts on the default map');
  const status=()=>read(overlay,'[document.getElementById("game-map").dataset.state,document.getElementById("game-map-status").textContent]');
  const mode=()=>read(overlay,'document.body.dataset.mode');
  const noKeyboard=label=>{assert.equal(overlay.isFocused(),false,label+': overlay has no keyboard');const l=byPage('layer.html');assert.ok(!l||(!l.isFocused()&&!l.isFocusable()),label+': layer has no keyboard');};
  const locked=await wait('rim locked and zone recognised',async()=>{const [state,text]=await status();return state==='locked'&&text.includes('North America · Detroit · Основная')&&[state,text];}).catch(async error=>{const l=byPage('layer.html');console.log('status:',await status(),'layer:',l&&await read(l,'JSON.stringify({stats:window.layerStats,badge:document.getElementById("badge").textContent,hidden:document.getElementById("badge").hidden})'),'bounds:',l?.getBounds());const {desktopCapturer}=require('electron');const [src]=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:b.width,height:b.height}});fs.writeFileSync(path.join(data,'seen.png'),src.thumbnail.crop({x:game.x-b.x,y:game.y-b.y,width:game.width,height:game.height}).resize({width:626}).toPNG());console.log('saved',path.join(data,'seen.png'));throw error;});
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
  // The map is open (its frame is seen): the overlay is clickable by itself, without Insert and without the keyboard.
  await wait('overlay clickable while the game map is open',async()=>await mode()==='edit'&&read(overlay,'!document.body.classList.contains("view-only")'));
  assert.equal(overlay.isFocusable(),false);noKeyboard('map open');
  await wait('a search worker per map',async()=>(await read(layer,'window.layerStats')).workers===3);
  // Screenshot pixel → layer window pixel, wherever the layer ended up; game units → screenshot pixels on the grid.
  const px=(x,y)=>{const r=layer.getBounds();return {x:Math.round(537.5+(x-70)*74.98-(r.x-game.x)),y:Math.round(760.5-(y-100)*74.98-(r.y-game.y))};};
  // Game units the layer's calibration gives at a point of the game map (the layer shows no readout of its own).
  const readoutAt=async(x,y)=>{const p=px(x,y),r=await wait('calibration at a point',()=>read(layer,`window.layerAt(${p.x},${p.y})`));return {text:`x${r.x.toFixed(2)}  y${r.y.toFixed(2)}`,x:r.x,y:r.y};};
  // Grid line x=70 is column 537 and y=100 row 760 of the screenshot.
  const readout=await readoutAt(70,100);
  console.log('readout at grid 70/100:',readout.text);
  assert.ok(Math.abs(readout.x-70)<.05&&Math.abs(readout.y-100)<.06,readout.text);
  const stats=await read(layer,'window.layerStats');
  console.log(`frames analysed: ${stats.frames}, ~${stats.ms.toFixed(1)} ms per frame`);

  // Marker mode (Insert): clicks on the in-game map become points in the overlay; nobody takes the keyboard.
  const clickAt=(p,button='left')=>{for(const type of ['mouseDown','mouseUp'])layer.webContents.sendInputEvent({type,...p,button,clickCount:1});};
  const coords=js=>read(overlay,`(${js})?.textContent.match(/x([\\d.]+), y([\\d.]+)/)?.slice(1).map(Number)`);
  const pins=()=>read(layer,'document.querySelectorAll("#marks .pin").length');
  hotkeys.Insert();
  await wait('marker mode',async()=>(await status())[0]==='marking'&&read(layer,'document.body.classList.contains("marking")'));
  assert.equal(await read(overlay,'document.getElementById("overlay-mode").textContent'),'Метки');noKeyboard('marker mode');
  clickAt(px(70,103));
  const me=await wait('my position from the game map',()=>coords('document.getElementById("map-player-label")'));
  clickAt(px(72,101));
  const goal=await wait('target from the game map',()=>coords('document.querySelector(\'[data-target-id="1"] .card-coords\')'));
  clickAt(px(72.3,101.2),'right');
  await wait('impact from the game map',()=>read(overlay,'!document.getElementById("fs-tag").hidden'));
  console.log('placed on the game map: me',me.join(', '),'· target',goal.join(', '),'· azimuth',await read(overlay,'document.getElementById("fs-azimuth").textContent'));
  assert.ok(Math.hypot(me[0]-70,me[1]-103)<.05&&Math.hypot(goal[0]-72,goal[1]-101)<.05,'points within 5 m of where the game map was clicked');
  assert.equal(await wait('pins drawn over the game map',async()=>{const n=await pins();return n===4&&n;}),4,'me, target, corrected aim, impact');
  // A wheel in marker mode is for the game's map: the layer hands the mouse over and marker mode stays on. The mouse
  // comes back once the cursor moves off to aim, or once the map has stood still for a moment.
  const passing=()=>read(layer,'document.body.classList.contains("passing")');
  // Icons blink on the game's map as in the game: the picture never stands still, the map itself does.
  await stand.webContents.executeJavaScript('window.animate(true)');
  const wheel=p=>layer.webContents.sendInputEvent({type:'mouseWheel',...p,deltaX:0,deltaY:120,wheelTicksY:1,canScroll:true});
  wheel(px(71,102));
  await wait('a wheel hands the mouse to the game',passing,3000,50);
  assert.equal((await status())[0],'marking','marker mode stays on during the zoom');
  layer.webContents.sendInputEvent({type:'mouseMove',...px(73.5,99.5)});
  await wait('moving off to aim takes the mouse back',async()=>!await passing(),3000,50);
  wheel(px(71,102));await wait('a second wheel',passing,3000,50);
  const stillFrom=Date.now();await wait('a still map takes the mouse back',async()=>!await passing(),5000,50);
  console.log(`wheel in marker mode: handed to the game, back on a move and after ${Date.now()-stillFrom} ms of a still map`);
  // A drag hands the mouse over the same way (the next drag moves the game's map) and places no point; the mouse comes
  // back once the cursor and the map have stood still for a moment.
  const targets=()=>read(overlay,'document.querySelectorAll(".target-row").length'),before=await targets(),dragAt=px(71,102);
  layer.webContents.sendInputEvent({type:'mouseDown',...dragAt,button:'left',clickCount:1});
  for(let i=1;i<=4;i++)layer.webContents.sendInputEvent({type:'mouseMove',x:dragAt.x+i*6,y:dragAt.y+i*4,modifiers:['leftButtonDown']});
  await wait('a drag hands the mouse to the game',passing,3000,50);
  layer.webContents.sendInputEvent({type:'mouseUp',x:dragAt.x+24,y:dragAt.y+16,button:'left',clickCount:1});
  assert.equal(await read(layer,'document.getElementById("pass-hint").hidden'),false,'the hint says the game has the mouse');
  const dragFrom=Date.now();await wait('a still cursor and map take the mouse back',async()=>!await passing(),6000,50);
  await new Promise(r=>setTimeout(r,300));
  assert.equal(await targets(),before,'a drag places no point');
  console.log(`drag in marker mode: handed to the game, back after ${Date.now()-dragFrom} ms of a still cursor and map, no point placed (icons blinking all along)`);
  await stand.webContents.executeJavaScript('window.animate(false)');
  hotkeys.Insert();
  await wait('Insert again ends marker mode',async()=>(await status())[0]==='locked'&&!await read(layer,'document.body.classList.contains("marking")'));
  assert.equal(await mode(),'edit','the map is still open: the overlay stays clickable');noKeyboard('after marker mode');

  // Without the keyboard: the map list opens as the page's own list; a text field asks for the keyboard.
  const choose=async label=>{
    await read(overlay,'document.getElementById("terrain-select").dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true}));true');
    const options=await wait('map list',()=>read(overlay,'(l=>l&&[...l.querySelectorAll("button")].map(b=>b.textContent))(document.querySelector(".select-list"))'));
    assert.deepEqual(options,['Kavkazi','Europe','North America']);
    await read(overlay,`[...document.querySelectorAll(".select-list button")].find(b=>b.textContent===${JSON.stringify(label)}).click();true`);
    assert.equal(await read(overlay,'Boolean(document.querySelector(".select-list"))'),false,'the list closes');
    return read(overlay,'document.getElementById("terrain-select").value');
  };
  assert.equal(await choose('Europe'),'europe','picked from the list');
  assert.equal(await choose('North America'),'northamerica');
  // «↵ Позиция» with an empty field takes the coordinates from the clipboard (the user's clipboard is put back).
  const {clipboard}=require('electron'),userClipboard=await clipboard.readText();
  try{
    await clipboard.writeText('x71.50, y102.25');
    await read(overlay,'document.querySelector(\'[data-map-tool="player"]\').click();document.getElementById("map-coordinate").value="";document.getElementById("place-coordinate").click();true');
    await wait('position from the clipboard',async()=>{const c=await coords('document.getElementById("map-player-label")');return c&&Math.hypot(c[0]-71.5,c[1]-102.25)<.01;});
  }finally{await clipboard.writeText(userClipboard);}
  assert.equal(await mode(),'edit','pasting needs no keyboard');
  await read(overlay,'document.getElementById("map-coordinate").dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));true');
  await wait('a text field takes the keyboard',async()=>await mode()==='keyboard'&&overlay.isFocusable());
  overlay.emit('blur');// the user clicks the game
  await wait('keyboard handed back',async()=>await mode()==='edit'&&!overlay.isFocusable());

  // Closing the map: the frame is gone, the points go at once, the overlay goes back to viewing.
  const closedAt=Date.now();await setMap('document.getElementById("map").style.visibility="hidden"');
  await wait('map closed',async()=>(await status())[0]==='closed'&&await pins()===0,5000,20);
  const closeMs=Date.now()-closedAt;
  console.log(`map closed → points gone in ${closeMs} ms · status:`,(await status())[1]);
  // Nothing in the middle of the screen while the map is closed.
  const busyShown=()=>read(byPage("layer.html"),"!document.getElementById(\"busy\").hidden");
  for(let i=0;i<8;i++){assert.equal(await busyShown(),false,"no search box over a closed map");await new Promise(r=>setTimeout(r,150));}
  assert.ok(closeMs<600,'points gone within 0.6 s of closing the map');
  await wait('overlay back to viewing',async()=>await mode()==='view'&&read(overlay,'document.body.classList.contains("view-only")'));
  const memory=await wait('calibration remembered',()=>fs.existsSync(memoryFile)&&JSON.parse(fs.readFileSync(memoryFile,'utf8')));
  assert.equal(memory.world,'northamerica');assert.equal(memory.key,'northamerica/zestafona-default');

  // Insert with the map closed: marker mode waits for the map, the game keeps the keyboard (M would open it).
  hotkeys.Insert();
  await wait('marker mode waits for the map',async()=>{const [state,text]=await status();return state==='closed'&&text.startsWith('Метки вкл')&&await mode()==='edit';});
  noKeyboard('marker mode, map closed');
  // Reopened with the rim painted over: the remembered calibration finds it on the first frames, marker mode goes on.
  // It fades in over a quarter of a second, as a game map may: the first frames are half transparent.
  await setMap('{window.hideRim();const m=document.getElementById("map");m.style.opacity="0";m.style.transition="opacity .25s linear";}');
  const openedAt=Date.now();await setMap('{const m=document.getElementById("map");m.style.visibility="visible";requestAnimationFrame(()=>requestAnimationFrame(()=>{m.style.opacity="1";}));}');
  await wait('found again from memory',async()=>(await status())[0]==='marking'&&await read(layer,'document.body.classList.contains("marking")'),5000,20);
  const reopenMs=Date.now()-openedAt;
  const again=await readoutAt(70,100);
  console.log(`reopened (no rim, fading in over 250 ms) → marker mode on the map in ${reopenMs} ms · readout at grid 70/100: ${again.text}`);
  assert.ok(reopenMs<1500,'found again within 1.5 s');
  assert.ok(Math.abs(again.x-70)<.05&&Math.abs(again.y-100)<.05,'terrain calibration on the game grid within 5 m: '+again.text);
  hotkeys.Insert();
  await wait('marker mode off',async()=>(await status())[0]==='locked');

  // Picker: draw the same panel again (its calibration is forgotten first); the layer is rebuilt over it. With the
  // rim still painted over and nothing remembered, the workers find the map by the terrain.
  await setMap('document.getElementById("map").style.visibility="hidden"');
  await wait('closed before picking',async()=>(await status())[0]==='closed');
  await new Promise(r=>setTimeout(r,1300));// the memory file is written a second after the map closed
  fs.rmSync(memoryFile,{force:true});
  await read(overlay,'window.overlay.gameMap.pick()');
  const picker=await wait('picker',()=>byPage('area-picker.html'));
  await wait('picker loaded',()=>!picker.webContents.isLoading()&&picker.isVisible());
  assert.equal(overlay.isVisible(),false,'overlay hidden while picking');assert.equal(picker.isFocusable(),false,'the picker leaves the keyboard to the game');
  const from={x:game.x-b.x+172,y:game.y-b.y+97},to={x:from.x+876,y:from.y+878};
  picker.webContents.sendInputEvent({type:'mouseDown',x:from.x,y:from.y,button:'left',clickCount:1});
  for(let k=1;k<=5;k++)picker.webContents.sendInputEvent({type:'mouseMove',x:from.x+(to.x-from.x)*k/5,y:from.y+(to.y-from.y)*k/5,button:'left',modifiers:['leftButtonDown']});
  picker.webContents.sendInputEvent({type:'mouseUp',x:to.x,y:to.y,button:'left',clickCount:1});
  await wait('picker closed',()=>!byPage('area-picker.html'));
  const saved=JSON.parse(fs.readFileSync(path.join(data,'map-area.json'),'utf8'));
  assert.deepEqual(saved.rect,{x:game.x+172,y:game.y+97,width:876,height:878});
  assert.equal(overlay.isVisible(),true,'overlay back after picking');
  layer=await wait('new layer',()=>{const l=byPage('layer.html');return l&&l!==layer&&!l.webContents.isLoading()&&l;});
  const searchFrom=Date.now();await setMap('document.getElementById("map").style.visibility="visible"');
  const seen=[];let boxSeen=false;
  const [,byTerrain]=await wait('found by the terrain search',async()=>{const s=await status();if(!seen.includes(s[1]))seen.push(s[1]);if(await busyShown())boxSeen=true;return s[0]==='locked'&&s[1].includes('по местности')&&s;},20000,40).catch(async error=>{console.log('status:',await status(),'seen:',seen,'layer:',await read(layer,'JSON.stringify(window.layerStats)'));throw error;});
  const searchStats=await read(layer,'window.layerStats');
  console.log(`no memory, no rim → ${byTerrain} in ${Date.now()-searchFrom} ms · states seen: ${seen.join(' → ')} · searches: ${JSON.stringify(searchStats.searches)}`);
  assert.ok(seen.some(t=>t.includes('ищу по местности')),'the search shows its progress');
  assert.equal(boxSeen,false,'a background search (map state unknown, no marker mode) puts nothing in the middle of the screen');
  const found=await readoutAt(70,100);
  assert.ok(Math.abs(found.x-70)<.05&&Math.abs(found.y-100)<.05,'found by the search on the game grid within 5 m: '+found.text);
  await wait('picked area fitted (it is the panel already)',()=>JSON.parse(fs.readFileSync(path.join(data,'map-area.json'),'utf8')).snapped);
  noKeyboard('end');
  console.log(`PASS: a loosely drawn area fitted to the map panel, rim locked, zone recognised and applied to the overlay, readout on the game grid within 5 m; the overlay clickable while the map is open and nothing took the keyboard; marker mode placed my position, a target and an impact from clicks on the game map; a select list and keyboard on demand without the game losing focus; points gone ${closeMs} ms after closing the map; marker mode waited for the closed map; reopened without the rim it was found from memory in ${reopenMs} ms; after picking the area again the workers found it by the terrain.`);
  app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
