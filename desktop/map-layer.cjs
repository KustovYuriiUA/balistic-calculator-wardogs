'use strict';
// Game-map layer: a click-through window over the in-game map panel. Its page (dist/layer.js) captures that
// screen area, calibrates it to game units and draws the overlay's points there. Insert turns marker mode on and
// off: while the map is calibrated the layer takes the mouse and its clicks go to the overlay as points; a wheel or a
// drag over it hands the mouse to the game for a moment, so the game's map zooms and moves. Neither the layer nor the picker for the area
// ever takes the keyboard: the game keeps its focus and its sound.
const path=require('node:path');
const {readArea,resolveArea,areaFromSelection,snapArea,saveArea}=require('./map-area.cjs');
const {t}=require('../dist/i18n.js');
const page=name=>path.join(__dirname,'..','dist',name);
// A session of their own: page zoom (the overlay's font size) propagates across same-origin pages of one session,
// and the layer draws in exact screen pixels.
const webPreferences={preload:path.join(__dirname,'layer-preload.cjs'),partition:'game-map-layer',contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false};
const frameless={frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:false,movable:false,minimizable:false,maximizable:false,fullscreenable:false,skipTaskbar:true,show:false,alwaysOnTop:true,focusable:false};
// closed / open: the map's frame on the fitted area's edges says so; searching: not known (area not fitted yet).
const STATES=['no-area','starting','closed','searching','open','acquiring','locked','weak','error'];

function cleanStatus(s){
  const text=(v,max)=>typeof v==='string'&&v.length<=max?v:null;
  // source: what calibrates the layer, the zone rim or the terrain; world: the map it matched; open: the map's frame
  // seen (null: unknown); progress: of a terrain search, 0…1; failed: the last search found nothing.
  return {state:STATES.includes(s?.state)?s.state:'error',key:text(s?.key,100),recognised:s?.recognised===true,calibrated:s?.calibrated===true,source:['rim','terrain'].includes(s?.source)?s.source:null,world:text(s?.world,40),metresPerPixel:Number.isFinite(s?.metresPerPixel)?s.metresPerPixel:null,open:typeof s?.open==='boolean'?s.open:null,progress:Number.isFinite(s?.progress)&&s.progress>=0&&s.progress<=1?s.progress:null,failed:s?.failed===true,message:text(s?.message,200)};
}
// A click on the in-game map in game units; pin is 'player' or a target number when a pin was hit.
function cleanClick(c){
  if(!Number.isFinite(c?.x)||!Number.isFinite(c?.y)||Math.abs(c.x)>1e4||Math.abs(c.y)>1e4||(c.button!=='left'&&c.button!=='right'))return null;
  return {x:c.x,y:c.y,button:c.button,pin:c.pin==='player'||(Number.isSafeInteger(c.pin)&&c.pin>0)?c.pin:null};
}
// The layer's last calibration: map, zone and fix (game x = x0 + a·s/100 at capture pixel a).
function cleanMemory(m){
  const world=typeof m?.world==='string'&&/^[a-z]{1,20}$/.test(m.world)?m.world:null,f=m?.fix;
  if(!world||!['x0','y0','s'].every(k=>Number.isFinite(f?.[k]))||Math.abs(f.x0)>1e4||Math.abs(f.y0)>1e4||!(f.s>0&&f.s<1000))return null;
  return {world,key:typeof m.key==='string'&&/^[a-z]{1,20}\/[a-z0-9-]{1,60}$/.test(m.key)?m.key:null,fix:{x0:f.x0,y0:f.y0,s:f.s}};
}

// Poll rate of the in-game map capture, frames per second.
const FPS_CHOICES=[15,30,60,120],DEFAULT_FPS=60;
// The mouse handed to the game for a wheel or a drag goes back to the layer this long after the layer last asked
// for it (it asks every second while the game's map moves), should the layer not give it back itself.
const PASS_MS=3000;
const cleanFps=v=>FPS_CHOICES.includes(v)?v:DEFAULT_FPS;

function createMapLayer({file,memoryFile,diagnostics,onStatus,onClick=()=>{},onNotice=()=>{},beforePick=()=>{},afterPick=()=>{}}){
  // Required here: the helpers above are unit-tested without Electron installed.
  const {BrowserWindow,desktopCapturer,ipcMain,screen,shell}=require('electron');
  const fs=require('node:fs');
  let layer=null,picker=null,pickerDisplay=null,area=null,selection=null,scene=null,marking=false,clickable=false,fps=DEFAULT_FPS,status=cleanStatus({state:'no-area'}),restart=0;
  // taking: the layer window has the mouse right now; passing: handed to the game for a wheel zoom (see layer:pass).
  let taking=false,passing=false,passTimer=0;
  const notify=()=>onStatus({...status,marking});
  // The layer takes the mouse only in marker mode and while the map is calibrated; otherwise every click goes to the
  // game. While passing the game has it too, and marker mode stays on.
  function applyLayer(){
    const on=marking&&status.calibrated&&live(),raise=on&&!clickable;
    clickable=on;
    if(!marking||!live())endPass();
    const take=on&&!passing;
    if(!live()||take===taking)return;
    taking=take;
    layer.setIgnoreMouseEvents(!take,{forward:true});
    if(raise){layer.setAlwaysOnTop(true,'screen-saver');layer.showInactive();}
  }
  function endPass(){if(!passing)return;passing=false;clearTimeout(passTimer);if(live())layer.webContents.send('layer:pass',false);}
  const report=next=>{status=cleanStatus(next);applyLayer();notify();};
  const guard=window=>{window.setMenu(null);window.setAlwaysOnTop(true,'screen-saver');window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());};
  const live=()=>Boolean(layer&&!layer.isDestroyed());
  function close(){clearTimeout(restart);clearTimeout(passTimer);clickable=taking=passing=false;if(live())layer.destroy();layer=null;}
  // (Re)create the layer exactly over the saved area; without a valid area there is nothing to capture.
  function open(){
    close();
    area=resolveArea(readArea(file),screen.getAllDisplays());
    if(!area){report({state:'no-area'});return;}
    const window=layer=new BrowserWindow({...area.rect,...frameless,title:t('layer.title'),webPreferences:{...webPreferences,backgroundThrottling:false}});
    guard(window);
    // Our own drawings must never reach the capture; outside marker mode the mouse always goes to the game.
    window.setContentProtection(true);
    window.setIgnoreMouseEvents(true,{forward:true});
    window.once('ready-to-show',()=>{if(!window.isDestroyed())window.showInactive();});
    window.on('closed',()=>{if(layer===window){layer=null;clearTimeout(passTimer);clickable=taking=passing=false;}});
    window.webContents.on('did-finish-load',()=>{if(scene)window.webContents.send('layer:scene',scene);if(marking)window.webContents.send('layer:marking',true);});
    window.webContents.on('render-process-gone',()=>{report({state:'error',message:t('layer.restarting')});restart=setTimeout(open,3000);});
    report({state:'starting'});
    window.loadFile(page('layer.html'));
  }
  // Marker mode (Insert): on until Insert again. With the map closed or not found yet it waits for it.
  function setMarking(on){
    marking=on===true;
    applyLayer();
    if(live())layer.webContents.send('layer:marking',marking);
    notify();
  }
  function pick(){
    if(picker&&!picker.isDestroyed())return;
    setMarking(false);
    pickerDisplay=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    beforePick();
    // Not focusable either: the game keeps the keyboard, so M still opens its map while the frame is drawn.
    const window=picker=new BrowserWindow({...pickerDisplay.bounds,...frameless,title:t('picker.title'),webPreferences});
    guard(window);
    window.once('ready-to-show',()=>{if(!window.isDestroyed())window.showInactive();});
    window.on('closed',()=>{picker=null;afterPick();});
    window.loadFile(page('area-picker.html'));
  }
  // The last calibration for this very area (kept while the area stays): {rect, world, key, fix}.
  const readMemory=()=>{try{const m=JSON.parse(fs.readFileSync(memoryFile,'utf8'));return area&&JSON.stringify(m?.rect)===JSON.stringify(area.rect)?cleanMemory(m):null;}catch{return null;}};
  let memoryTimer=0,pendingMemory=null;
  const saveMemory=()=>{if(!pendingMemory||!memoryFile)return;try{fs.mkdirSync(path.dirname(memoryFile),{recursive:true});fs.writeFileSync(memoryFile,JSON.stringify(pendingMemory));}catch(error){console.warn('Не удалось сохранить калибровку карты игры:',error.message);}pendingMemory=null;};
  const fromLayer=event=>live()&&event.sender===layer.webContents;
  ipcMain.handle('layer:config',async event=>{
    if(!fromLayer(event)||!area)throw new Error(t('layer.noArea'));
    const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:0,height:0}});
    const source=sources.find(s=>s.display_id===String(area.display.id))||(sources.length===1?sources[0]:null);
    if(!source)throw new Error(t('layer.noScreen'));
    return {sourceId:source.id,rect:area.rect,display:{bounds:area.display.bounds},snapped:area.snapped,selection,fps,memory:readMemory()};
  });
  ipcMain.on('layer:remember',(event,next)=>{
    const m=fromLayer(event)&&area&&cleanMemory(next);if(!m)return;
    pendingMemory={rect:area.rect,...m};clearTimeout(memoryTimer);memoryTimer=setTimeout(saveMemory,1000);
  });
  // Troubleshooting snapshot: userData/diagnostics/game-map-<time>.png and .json, shown in the file manager.
  ipcMain.on('layer:snapshot-data',(event,data)=>{
    if(!fromLayer(event)||!diagnostics)return;
    const png=data?.png instanceof Uint8Array&&data.png.length<40e6?data.png:null,info=JSON.stringify(data?.info??null,null,1);
    if(info.length>200000)return;
    try{
      fs.mkdirSync(diagnostics,{recursive:true});
      const base=path.join(diagnostics,'game-map-'+new Date().toISOString().replace(/[:.]/g,'-'));
      fs.writeFileSync(base+'.json',info);if(png)fs.writeFileSync(base+'.png',png);
      shell.showItemInFolder(base+(png?'.png':'.json'));
    }catch(error){console.warn('Не удалось сохранить снимок карты игры:',error.message);}
  });
  ipcMain.on('layer:status',(event,next)=>{if(fromLayer(event))report(next);});
  // The layer found the map panel in and around the drawn area: fit the area to it. Unchanged within 3 px only marks
  // the area as fitted; otherwise the layer is rebuilt exactly over the panel.
  ipcMain.on('layer:panel',(event,panel)=>{
    if(!fromLayer(event)||!area||area.snapped)return;
    const saved=readArea(file),next=saved&&snapArea(saved,panel);
    if(!next)return;// implausible: keep the drawn area, a later frame may find the panel
    const moved=['x','y','width','height'].some(k=>Math.abs(next.rect[k]-saved.rect[k])>3);
    if(!saveArea(file,moved?next:{...saved,snapped:true}))return;
    if(moved){onNotice(t('notice.fitted',{w:next.rect.width,h:next.rect.height}));open();}else{area.snapped=true;layer.webContents.send('layer:snapped');}
  });
  // The zone rim is in view, the map's frame is not on the area's edges, and the panel was found elsewhere around it
  // (another UI scale in the game): the area moves to that panel, still fitted. Anything implausible is ignored.
  ipcMain.on('layer:refit',(event,panel)=>{
    if(!fromLayer(event)||!area?.snapped)return;
    const saved=readArea(file),next=saved&&snapArea(saved,panel);
    if(!next||!['x','y','width','height'].some(k=>Math.abs(next.rect[k]-saved.rect[k])>3)||!saveArea(file,next))return;
    onNotice(t('notice.moved',{w:next.rect.width,h:next.rect.height}));open();
  });
  ipcMain.on('layer:click',(event,click)=>{const c=cleanClick(click);if(fromLayer(event)&&clickable&&c)onClick(c);});
  // A wheel or a drag over the layer in marker mode (that one is lost): the mouse goes to the game, whose map zooms or
  // moves, until the layer gives it back (see layer.js), or PASS_MS after the layer last asked. Asking again keeps it
  // there while marker mode lasts, even if the map is lost for a moment while it moves.
  ipcMain.on('layer:pass',(event,on)=>{
    if(!fromLayer(event))return;
    if(on===true&&(clickable||passing&&marking)){clearTimeout(passTimer);passing=true;passTimer=setTimeout(()=>{endPass();applyLayer();},PASS_MS);}
    else if(on===true)event.sender.send('layer:pass',false);
    else endPass();
    applyLayer();
  });
  ipcMain.on('picker:done',(event,rect)=>{
    if(!picker||event.sender!==picker.webContents)return;
    const next=areaFromSelection(rect,pickerDisplay);
    if(next&&saveArea(file,next))open();
    picker.close();
  });
  ipcMain.on('picker:cancel',event=>{if(picker&&event.sender===picker.webContents)picker.close();});
  // A new resolution or a monitor change moves the in-game map: the saved area may no longer apply.
  // Work-area changes (taskbar) also fire metrics events; they leave the layer alone.
  let displayTimer=0;
  const refresh=()=>{const next=resolveArea(readArea(file),screen.getAllDisplays());if(layer&&next&&JSON.stringify([next.rect,next.display.bounds])===JSON.stringify([area.rect,area.display.bounds]))return;open();};
  for(const name of ['display-added','display-removed','display-metrics-changed'])screen.on(name,()=>{clearTimeout(displayTimer);displayTimer=setTimeout(refresh,500);});
  return {
    start:open,pick,setMarking,
    status:()=>({...status,marking}),
    marking:()=>marking,
    select(key){selection=key;if(live())layer.webContents.send('layer:selection',key);},
    settings(next){fps=cleanFps(next?.fps);if(live())layer.webContents.send('layer:settings',{fps});},
    snapshot(){if(live())layer.webContents.send('layer:snapshot');return live();},
    scene(next){scene=next;if(live())layer.webContents.send('layer:scene',next);},
    // Another interface language: the layer (and an open picker) redraw their text in it.
    language(next){for(const w of [layer,picker])if(w&&!w.isDestroyed())w.webContents.send('app:language-changed',next);},
    flush:saveMemory,
  };
}
module.exports={createMapLayer,cleanStatus,cleanClick,cleanMemory,cleanFps,FPS_CHOICES};
