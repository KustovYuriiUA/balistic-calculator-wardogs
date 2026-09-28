'use strict';
const {app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, screen, dialog, clipboard} = require('electron');
const path = require('node:path');
const {readPosition,resolvePosition,savePosition}=require('./window-position.cjs');
const updater=require('./updater.cjs');
const {createMapLayer}=require('./map-layer.cjs');
const version=require('../package.json').version;
let overlay, tray, mapLayer;
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.setAppUserModelId('local.basketball.shot-overlay');
  // The overlay behaves as an overlay: it never takes the keyboard from the game by itself (a game in the background
  // mutes its sound, and its keys, M included, would stop working). Its mode follows from three things:
  //   view     — click-through, dimmed: the game map is closed and marker mode is off;
  //   edit     — clickable without the keyboard: marker mode is on (Insert), or the game map is open;
  //   keyboard — focused, for typing: a click into a text field (or the tray); a click on the game ends it.
  let keyboard=false,mode=null;
  const gameMapOpen=()=>{const s=mapLayer?.status();return Boolean(s&&(s.open===true||s.calibrated));};
  const reveal=()=>{
    if(!overlay||overlay.isDestroyed())return;
    if(overlay.isMinimized())overlay.restore();
    const bounds=overlay.getBounds();
    const onScreen=screen.getAllDisplays().some(({workArea:r})=>bounds.x+100>r.x&&bounds.x<r.x+r.width&&bounds.y+40>r.y&&bounds.y<r.y+r.height);
    if(!onScreen)overlay.center();
    overlay.setAlwaysOnTop(true,'screen-saver');
    if(!overlay.isVisible())overlay.showInactive();
  };
  const apply=()=>{
    if(!overlay||overlay.isDestroyed())return;
    const next=keyboard?'keyboard':mapLayer?.marking()||gameMapOpen()?'edit':'view';
    if(next===mode)return;
    mode=next;
    overlay.setIgnoreMouseEvents(mode==='view',{forward:true});
    overlay.setFocusable(mode==='keyboard');
    overlay.setOpacity(mode==='view'?0.85:1);
    if(mode==='keyboard'){reveal();overlay.show();overlay.focus();}
    overlay.webContents.send('overlay:mode',mode);
  };
  const setKeyboard=on=>{keyboard=on;apply();};
  // Insert: marker mode on or off, nothing else. The window comes back if it was hidden.
  const toggle=()=>{if(!mapLayer)return;mapLayer.setMarking(!mapLayer.marking());reveal();apply();};
  app.on('second-instance',()=>setKeyboard(true));
  app.whenReady().then(async()=>{
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const positionFile=path.join(app.getPath('userData'),'window-position.json');
    const saved=readPosition(positionFile);
    // «Компактно» shrinks the window to the compact layout; fullSize is what «Полный вид» restores (null = not compact).
    const FULL={width:Math.min(1080,area.width),height:Math.min(850,area.height)},COMPACT={width:420,height:780};
    let fullSize=saved?.compact?FULL:null;
    const {width,height}=fullSize?{width:Math.min(COMPACT.width,area.width),height:Math.min(COMPACT.height,area.height)}:FULL;
    const position=resolvePosition(saved,width,height,screen.getAllDisplays().map(d=>d.workArea),area);
    const icon = nativeImage.createFromPath(path.join(__dirname,'icon.png'));
    overlay = new BrowserWindow({title:'Точный бросок',width,height,...position,minWidth:Math.min(360,area.width),minHeight:Math.min(200,area.height),frame:false,show:false,alwaysOnTop:true,backgroundColor:'#08090a',autoHideMenuBar:true,icon,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false}});
    let positionTimer;
    const persistPosition=()=>{
      clearTimeout(positionTimer);
      if(overlay && !overlay.isDestroyed() && !overlay.isMinimized())savePosition(positionFile,{...overlay.getNormalBounds(),compact:Boolean(fullSize)});
    };
    // Resize toward the nearer screen edge: an overlay parked on the right stays on the right.
    // zoom: the font size chosen in the menu (page zoom of the overlay); the compact window widens with it.
    let zoom=1,contentHeight=0;// contentHeight: the compact window's current maximum, from the content (see overlay:fit-height)
    const setCompact=enabled=>{
      if(overlay.isDestroyed()||enabled===Boolean(fullSize))return;
      const b=overlay.getNormalBounds(),work=screen.getDisplayMatching(b).workArea;
      if(overlay.isMaximized())overlay.unmaximize();
      if(enabled)fullSize={width:b.width,height:b.height};
      const next=enabled?{width:Math.round(COMPACT.width*zoom),height:COMPACT.height}:fullSize,w=Math.min(next.width,work.width),h=Math.min(next.height,work.height);
      // The content limit belongs to the compact window only: lift it before restoring the full size.
      if(!enabled){fullSize=null;overlay.setMaximumSize(0,0);}
      contentHeight=0;
      const right=b.x+b.width/2>work.x+work.width/2,x=Math.max(work.x,Math.min(right?b.x+b.width-w:b.x,work.x+work.width-w)),y=Math.max(work.y,Math.min(b.y,work.y+work.height-h));
      overlay.setBounds({x,y,width:w,height:h});
      persistPosition();
    };
    overlay.on('move',()=>{clearTimeout(positionTimer);positionTimer=setTimeout(persistPosition,250);});
    overlay.on('hide',persistPosition);
    overlay.on('close',persistPosition);
    app.on('before-quit',persistPosition);
    // The game-map layer keeps its own window: closing the overlay still ends the app.
    overlay.on('closed',()=>app.quit());
    overlay.setMenu(null);
    overlay.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    overlay.webContents.on('will-navigate',event=>event.preventDefault());
    ipcMain.on('overlay:hide',event=>{if(event.sender===overlay.webContents)overlay.hide();});
    // view: marker mode off, keyboard back (as far as the window can give it: a click on the game takes it).
    ipcMain.on('overlay:view',event=>{if(event.sender===overlay.webContents){mapLayer.setMarking(false);setKeyboard(false);}});
    ipcMain.on('overlay:edit',event=>{if(event.sender===overlay.webContents)setKeyboard(true);});
    // A click into a text field: the window takes the keyboard (the game goes to the background until clicked).
    ipcMain.on('overlay:keyboard',event=>{if(event.sender===overlay.webContents)setKeyboard(true);});
    ipcMain.on('overlay:marking',event=>{if(event.sender===overlay.webContents)toggle();});
    // The page drags the window (title bar) or one of its edges (w, e, s, sw, se); the window follows the cursor
    // within its minimum and maximum size. Windows' own drag of the title bar would activate another window (the
    // desktop) for this one, which cannot take focus, and its own frame does nothing then.
    let dragging=null;
    ipcMain.on('overlay:drag',(event,kind,phase)=>{
      if(event.sender!==overlay.webContents||!['move','w','e','s','sw','se'].includes(kind))return;
      const p=screen.getCursorScreenPoint();
      if(phase==='start'){dragging={kind,from:p,bounds:overlay.getBounds()};return;}
      if(!dragging||dragging.kind!==kind)return;
      if(phase==='end'){dragging=null;persistPosition();return;}
      const dx=p.x-dragging.from.x,dy=p.y-dragging.from.y,b=dragging.bounds;
      if(kind==='move'){overlay.setPosition(b.x+dx,b.y+dy);return;}
      const [minW,minH]=overlay.getMinimumSize(),[maxW,maxH]=overlay.getMaximumSize(),fit=(v,lo,hi)=>Math.round(Math.max(lo,hi>0?Math.min(hi,v):v));
      const width=kind==='s'?b.width:fit(kind.endsWith('w')?b.width-dx:b.width+dx,minW,maxW),height=kind==='w'||kind==='e'?b.height:fit(b.height+dy,minH,maxH);
      overlay.setBounds({x:kind.endsWith('w')?b.x+b.width-width:b.x,y:b.y,width,height});
    });
    ipcMain.handle('overlay:paste',async event=>{if(event.sender!==overlay.webContents)throw new Error('Нет доступа');return String(await clipboard.readText()).slice(0,200);});
    overlay.on('blur',()=>{if(keyboard)setKeyboard(false);});
    ipcMain.on('overlay:quit',event=>{if(event.sender===overlay.webContents)app.quit();});
    ipcMain.on('overlay:update-action',(event,action)=>{if(event.sender===overlay.webContents&&['check','restart','open'].includes(action))updater.action(action);});
    const toOverlay=(channel,value)=>{if(!overlay.isDestroyed())overlay.webContents.send(channel,value);};
    // The game map opening or closing, and marker mode, switch the window between viewing and clicking.
    const userData=app.getPath('userData');
    mapLayer=createMapLayer({file:path.join(userData,'map-area.json'),memoryFile:path.join(userData,'game-map-memory.json'),diagnostics:path.join(userData,'diagnostics'),onStatus:status=>{toOverlay('overlay:game-map',status);apply();},onClick:click=>toOverlay('overlay:game-click',click),onNotice:text=>toOverlay('overlay:game-map-notice',text),beforePick:()=>overlay.hide(),afterPick:()=>{reveal();apply();}});
    app.on('before-quit',()=>mapLayer.flush());
    ipcMain.on('overlay:scene',(event,scene)=>{if(event.sender===overlay.webContents&&scene&&typeof scene==='object'&&JSON.stringify(scene).length<50000)mapLayer.scene(scene);});
    ipcMain.on('overlay:compact',(event,enabled)=>{if(event.sender===overlay.webContents)setCompact(enabled===true);});
    // Compact window: the content height (CSS px × zoom, down to the bottom of the screen) is the window's maximum
    // height, so it cannot be dragged into empty space. Dragged shorter, it stays so (the list scrolls). It is
    // resized here only when the content changes: grown if it was fitted, shrunk if it is now taller than the content.

    ipcMain.on('overlay:fit-height',(event,height)=>{
      if(event.sender!==overlay.webContents||!fullSize||!Number.isFinite(height)||overlay.isMaximized())return;
      const b=overlay.getBounds(),work=screen.getDisplayMatching(b).workArea,h=Math.round(Math.max(200,Math.min(work.y+work.height-b.y,height*zoom)));
      if(Math.abs(h-contentHeight)<=2)return;
      const fitted=!contentHeight||Math.abs(b.height-contentHeight)<=4;
      contentHeight=h;overlay.setMaximumSize(0,h);
      if(fitted||b.height>h)overlay.setBounds({...b,height:h});
    });
    ipcMain.on('overlay:zoom',(event,factor)=>{
      if(event.sender!==overlay.webContents||![.9,1,1.15,1.3].includes(factor))return;
      zoom=factor;overlay.webContents.setZoomFactor(factor);
      if(fullSize){const b=overlay.getBounds(),work=screen.getDisplayMatching(b).workArea,w=Math.min(work.width,Math.round(COMPACT.width*zoom)),right=b.x+b.width/2>work.x+work.width/2;overlay.setBounds({...b,x:Math.max(work.x,Math.min(right?b.x+b.width-w:b.x,work.x+work.width-w)),width:w});}
    });
    ipcMain.on('overlay:pick-area',event=>{if(event.sender===overlay.webContents)mapLayer.pick();});
    ipcMain.on('overlay:game-map-select',(event,key)=>{if(event.sender===overlay.webContents&&typeof key==='string'&&key.length<=100)mapLayer.select(key);});
    ipcMain.on('overlay:game-map-settings',(event,settings)=>{if(event.sender===overlay.webContents)mapLayer.settings(settings);});
    ipcMain.on('overlay:game-map-snapshot',event=>{if(event.sender===overlay.webContents)mapLayer.snapshot();});
    ipcMain.handle('overlay:copy',async(event,text)=>{if(event.sender!==overlay.webContents || typeof text!=='string' || !/^Y-?\d+(?:\.\d+)? X-?\d+(?:\.\d+)?$/.test(text) || text.length>100)throw new Error('Некорректные координаты');await clipboard.writeText(text);return true;});
    tray = new Tray(icon);
    tray.setToolTip(`Точный бросок ${version} · Insert — метки на карте игры`);
    const trayMenu=update=>{
      const updateItems=update.state==='ready'?[{label:`Обновить до ${update.version} и перезапустить`,click:()=>updater.action('restart')}]:update.state==='manual'?[{label:`Скачать версию ${update.version}…`,click:()=>updater.action('open')}]:[];
      tray.setContextMenu(Menu.buildFromTemplate([{label:'Метки на карте игры (Insert)',click:toggle},{label:'Окно с клавиатурой',click:()=>setKeyboard(true)},{label:'Скрыть',click:()=>overlay.hide()},{type:'separator'},{label:'Выбрать область карты игры…',click:()=>mapLayer.pick()},{label:'Снимок карты игры для отладки',click:()=>mapLayer.snapshot()},{type:'separator'},{label:`Версия ${version}`,enabled:false},...updateItems,{label:'Проверить обновления',enabled:update.enabled&&update.state!=='checking'&&update.state!=='downloading',click:()=>{updater.action('check');reveal();}},{label:'Обновлять автоматически',type:'checkbox',checked:update.auto,enabled:update.enabled,click:()=>updater.action('toggle-auto')},{type:'separator'},{label:'Выход',click:()=>app.quit()}]));
    };
    updater.start({version,userData:app.getPath('userData'),enabled:app.isPackaged||Boolean(process.env.SHOT_UPDATE_FEED),onChange:update=>{trayMenu(update);if(!overlay.isDestroyed())overlay.webContents.send('overlay:update',update);}});
    overlay.webContents.on('did-finish-load',()=>{overlay.webContents.send('overlay:update',updater.current());overlay.webContents.send('overlay:game-map',mapLayer.status());overlay.webContents.send('overlay:mode',mode||'view');});
    tray.on('double-click',toggle);
    const registered=globalShortcut.register('Insert',toggle);
    await overlay.loadFile(path.join(__dirname,'../dist/index.html'));
    mapLayer.start();
    updater.confirm();
    apply();reveal();
    if (!registered) dialog.showMessageBox(overlay,{type:'warning',title:'Insert занят',message:'Не удалось назначить Insert.',detail:'Клавиша занята другим приложением. Освободи её и перезапусти калькулятор. Пока метки включаются двойным щелчком по значку в трее.'});
  }).catch(error=>{dialog.showErrorBox('Не удалось открыть калькулятор',error.message);app.quit();});
  app.on('window-all-closed',()=>app.quit());
  app.on('will-quit',()=>globalShortcut.unregisterAll());
}
