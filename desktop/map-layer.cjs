'use strict';
// Game-map layer: a click-through window over the in-game map panel. Its page (dist/layer.js) captures that
// screen area, calibrates it to game units and draws the overlay's points there. Insert turns on marker mode:
// the layer takes the mouse and its clicks go to the overlay as points. Plus the one-off picker for the area.
const path=require('node:path');
const {readArea,resolveArea,areaFromSelection,snapArea,saveArea}=require('./map-area.cjs');
const page=name=>path.join(__dirname,'..','dist',name);
// A session of their own: page zoom (the overlay's font size) propagates across same-origin pages of one session,
// and the layer draws in exact screen pixels.
const webPreferences={preload:path.join(__dirname,'layer-preload.cjs'),partition:'game-map-layer',contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false};
const frameless={frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:false,movable:false,minimizable:false,maximizable:false,fullscreenable:false,skipTaskbar:true,show:false,alwaysOnTop:true};
const STATES=['no-area','starting','searching','acquiring','locked','weak','error'];

function cleanStatus(s){
  const text=(v,max)=>typeof v==='string'&&v.length<=max?v:null;
  // source: what calibrates the layer, the zone rim or the terrain; world: the map it matched.
  return {state:STATES.includes(s?.state)?s.state:'error',key:text(s?.key,100),recognised:s?.recognised===true,calibrated:s?.calibrated===true,source:['rim','terrain'].includes(s?.source)?s.source:null,world:text(s?.world,40),metresPerPixel:Number.isFinite(s?.metresPerPixel)?s.metresPerPixel:null,message:text(s?.message,200)};
}
// A click on the in-game map in game units; pin is 'player' or a target number when a pin was hit.
function cleanClick(c){
  if(!Number.isFinite(c?.x)||!Number.isFinite(c?.y)||Math.abs(c.x)>1e4||Math.abs(c.y)>1e4||(c.button!=='left'&&c.button!=='right'))return null;
  return {x:c.x,y:c.y,button:c.button,pin:c.pin==='player'||(Number.isSafeInteger(c.pin)&&c.pin>0)?c.pin:null};
}

// Poll rate of the in-game map capture, frames per second.
const FPS_CHOICES=[15,30,60,120],DEFAULT_FPS=60;
const cleanFps=v=>FPS_CHOICES.includes(v)?v:DEFAULT_FPS;

function createMapLayer({file,diagnostics,onStatus,onClick=()=>{},onKey=()=>{},onNotice=()=>{},beforePick=()=>{},afterPick=()=>{}}){
  // Required here: the helpers above are unit-tested without Electron installed.
  const {BrowserWindow,desktopCapturer,ipcMain,screen,shell}=require('electron');
  const fs=require('node:fs');
  let layer=null,picker=null,pickerDisplay=null,area=null,selection=null,scene=null,marking=false,fps=DEFAULT_FPS,status=cleanStatus({state:'no-area'}),restart=0;
  const notify=()=>onStatus({...status,marking});
  const report=next=>{status=cleanStatus(next);if(marking&&!status.calibrated)setMarking(false);else notify();};
  const guard=window=>{window.setMenu(null);window.setAlwaysOnTop(true,'screen-saver');window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());};
  const live=()=>layer&&!layer.isDestroyed();
  function close(){clearTimeout(restart);marking=false;if(live())layer.destroy();layer=null;}
  // (Re)create the layer exactly over the saved area; without a valid area there is nothing to capture.
  function open(){
    close();
    area=resolveArea(readArea(file),screen.getAllDisplays());
    if(!area){report({state:'no-area'});return;}
    const window=layer=new BrowserWindow({...area.rect,...frameless,focusable:false,title:'Точный бросок — карта игры',webPreferences:{...webPreferences,backgroundThrottling:false}});
    guard(window);
    // Our own drawings must never reach the capture; outside marker mode the mouse always goes to the game.
    window.setContentProtection(true);
    window.setIgnoreMouseEvents(true,{forward:true});
    window.once('ready-to-show',()=>{if(!window.isDestroyed())window.showInactive();});
    window.on('closed',()=>{if(layer===window){layer=null;if(marking){marking=false;notify();}}});
    window.webContents.on('did-finish-load',()=>{if(scene)window.webContents.send('layer:scene',scene);});
    window.webContents.on('render-process-gone',()=>{report({state:'error',message:'Слой карты игры перезапускается'});restart=setTimeout(open,3000);});
    report({state:'starting'});
    window.loadFile(page('layer.html'));
  }
  // Marker mode: the layer takes mouse and keyboard; leaving it hands both back to the game.
  function setMarking(on){
    if(on&&(!live()||!status.calibrated))return false;
    marking=on;
    if(live()){
      layer.setIgnoreMouseEvents(!on,{forward:true});
      layer.setFocusable(on);
      if(on){layer.setAlwaysOnTop(true,'screen-saver');layer.show();layer.focus();}else layer.blur();
      layer.webContents.send('layer:marking',on);
    }
    notify();
    return true;
  }
  function pick(){
    if(picker&&!picker.isDestroyed()){picker.focus();return;}
    setMarking(false);
    pickerDisplay=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    beforePick();
    const window=picker=new BrowserWindow({...pickerDisplay.bounds,...frameless,title:'Область карты игры',webPreferences});
    guard(window);
    window.once('ready-to-show',()=>{if(!window.isDestroyed()){window.show();window.focus();}});
    window.on('closed',()=>{picker=null;afterPick();});
    window.loadFile(page('area-picker.html'));
  }
  const fromLayer=event=>live()&&event.sender===layer.webContents;
  ipcMain.handle('layer:config',async event=>{
    if(!fromLayer(event)||!area)throw new Error('Область карты игры не выбрана');
    const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:0,height:0}});
    const source=sources.find(s=>s.display_id===String(area.display.id))||(sources.length===1?sources[0]:null);
    if(!source)throw new Error('Не найден экран с картой игры');
    return {sourceId:source.id,rect:area.rect,display:{bounds:area.display.bounds},snapped:area.snapped,selection,fps};
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
    if(moved){onNotice(`Область захвата подогнана под карту игры: ${next.rect.width}×${next.rect.height}`);open();}else area.snapped=true;
  });
  ipcMain.on('layer:click',(event,click)=>{const c=cleanClick(click);if(fromLayer(event)&&marking&&c)onClick(c);});
  ipcMain.on('layer:key',(event,key)=>{if(fromLayer(event)&&marking&&typeof key?.code==='string'&&key.code.length<=30)onKey({code:key.code,ctrl:key.ctrl===true});});
  ipcMain.on('layer:exit-marking',event=>{if(fromLayer(event))setMarking(false);});
  let answer=null;
  ipcMain.on('layer:acquired',(event,ok)=>{if(fromLayer(event)&&answer)answer(ok===true);});
  // Ask the layer to find the map on a fresh frame now (Insert before it was calibrated). False after 6 s.
  function acquireNow(){
    if(!live())return Promise.resolve(false);
    return new Promise(resolve=>{const timer=setTimeout(()=>{answer=null;resolve(false);},6000);answer=ok=>{clearTimeout(timer);answer=null;resolve(ok);};layer.webContents.send('layer:acquire');});
  }
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
    start:open,pick,setMarking,acquireNow,
    hasLayer:live,
    status:()=>({...status,marking}),
    marking:()=>marking,
    // The in-game map is open and calibrated: Insert goes to marker mode instead of the overlay window.
    canMark:()=>live()&&status.calibrated,
    select(key){selection=key;if(live())layer.webContents.send('layer:selection',key);},
    settings(next){fps=cleanFps(next?.fps);if(live())layer.webContents.send('layer:settings',{fps});},
    snapshot(){if(live())layer.webContents.send('layer:snapshot');return live();},
    scene(next){scene=next;if(live())layer.webContents.send('layer:scene',next);},
  };
}
module.exports={createMapLayer,cleanStatus,cleanClick,cleanFps,FPS_CHOICES};
