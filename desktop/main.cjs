'use strict';
const {app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, screen, dialog, clipboard} = require('electron');
const path = require('node:path');
const {readPosition,resolvePosition,savePosition}=require('./window-position.cjs');
let overlay, tray, editing=false;
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.setAppUserModelId('local.basketball.shot-overlay');
  const show = (interactive=true) => {
    if (!overlay || overlay.isDestroyed()) return;
    if (overlay.isMinimized()) overlay.restore();
    const bounds = overlay.getBounds();
    const onScreen = screen.getAllDisplays().some(({workArea:r}) => bounds.x+100>r.x && bounds.x<r.x+r.width && bounds.y+40>r.y && bounds.y<r.y+r.height);
    if (!onScreen) overlay.center();
    overlay.setAlwaysOnTop(true, 'screen-saver');
    editing=interactive;
    overlay.setIgnoreMouseEvents(!interactive,{forward:true});
    overlay.setFocusable(interactive);
    overlay.setOpacity(interactive?1:0.85);
    if(interactive){overlay.show();overlay.focus();}else{overlay.blur();overlay.showInactive();}
    overlay.webContents.send('overlay:mode',interactive?'edit':'view');
  };
  const toggle = () => {show(!overlay?.isVisible()||!editing);};
  app.on('second-instance',()=>show(true));
  app.whenReady().then(async()=>{
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(1080,area.width), height = Math.min(850,area.height);
    const positionFile=path.join(app.getPath('userData'),'window-position.json');
    const position=resolvePosition(readPosition(positionFile),width,height,screen.getAllDisplays().map(d=>d.workArea),area);
    const icon = nativeImage.createFromPath(path.join(__dirname,'icon.png'));
    overlay = new BrowserWindow({title:'Точный бросок',width,height,...position,minWidth:Math.min(360,area.width),minHeight:Math.min(480,area.height),frame:false,show:false,alwaysOnTop:true,backgroundColor:'#08090a',autoHideMenuBar:true,icon,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false}});
    let positionTimer;
    const persistPosition=()=>{
      clearTimeout(positionTimer);
      if(overlay && !overlay.isDestroyed() && !overlay.isMinimized())savePosition(positionFile,overlay.getNormalBounds());
    };
    overlay.on('move',()=>{clearTimeout(positionTimer);positionTimer=setTimeout(persistPosition,250);});
    overlay.on('hide',persistPosition);
    overlay.on('close',persistPosition);
    app.on('before-quit',persistPosition);
    overlay.setMenu(null);
    overlay.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    overlay.webContents.on('will-navigate',event=>event.preventDefault());
    ipcMain.on('overlay:hide',event=>{if(event.sender===overlay.webContents)overlay.hide();});
    ipcMain.on('overlay:view',event=>{if(event.sender===overlay.webContents)show(false);});
    ipcMain.on('overlay:edit',event=>{if(event.sender===overlay.webContents)show(true);});
    ipcMain.on('overlay:quit',event=>{if(event.sender===overlay.webContents)app.quit();});
    ipcMain.handle('overlay:copy',(event,text)=>{if(event.sender!==overlay.webContents || typeof text!=='string' || !/^Y-?\d+(?:\.\d+)? X-?\d+(?:\.\d+)?$/.test(text) || text.length>100)throw new Error('Некорректные координаты');clipboard.writeText(text);return true;});
    overlay.webContents.on('before-input-event',(event,input)=>{if(input.key==='Escape'&&input.type==='keyDown'){event.preventDefault();show(false);}});
    tray = new Tray(icon);
    tray.setToolTip('Точный бросок · Insert — редактирование / игра');
    tray.setContextMenu(Menu.buildFromTemplate([{label:'Редактировать (Insert)',click:()=>show(true)},{label:'Просмотр поверх игры',click:()=>show(false)},{label:'Скрыть',click:()=>overlay.hide()},{type:'separator'},{label:'Выход',click:()=>app.quit()}]));
    tray.on('double-click',toggle);
    const registered=globalShortcut.register('Insert',toggle);
    await overlay.loadFile(path.join(__dirname,'../dist/index.html'));
    show(false);
    if (!registered) dialog.showMessageBox(overlay,{type:'warning',title:'Insert занят',message:'Не удалось назначить Insert.',detail:'Клавиша занята другим приложением. Освободи её и перезапусти калькулятор. Пока можно открывать окно двойным щелчком по значку в трее.'});
  }).catch(error=>{dialog.showErrorBox('Не удалось открыть калькулятор',error.message);app.quit();});
  app.on('window-all-closed',()=>app.quit());
  app.on('will-quit',()=>globalShortcut.unregisterAll());
}
