'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('overlay',{hide:()=>ipcRenderer.send('overlay:hide'),view:()=>ipcRenderer.send('overlay:view'),edit:()=>ipcRenderer.send('overlay:edit'),onMode:callback=>ipcRenderer.on('overlay:mode',(_event,mode)=>callback(mode)),quit:()=>ipcRenderer.send('overlay:quit'),copyCoordinates:text=>ipcRenderer.invoke('overlay:copy',text),onUpdate:callback=>ipcRenderer.on('overlay:update',(_event,update)=>callback(update)),update:action=>ipcRenderer.send('overlay:update-action',action)});
