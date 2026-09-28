'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// Shared by the game-map layer and the area picker.
contextBridge.exposeInMainWorld('mapLayer',{
  config:()=>ipcRenderer.invoke('layer:config'),
  status:status=>ipcRenderer.send('layer:status',status),
  onSelection:callback=>ipcRenderer.on('layer:selection',(_event,key)=>callback(key)),
  // Marker mode: what to draw (from the overlay), the mode itself, and clicks/keys going back to the overlay.
  onScene:callback=>ipcRenderer.on('layer:scene',(_event,scene)=>callback(scene)),
  onMarking:callback=>ipcRenderer.on('layer:marking',(_event,on)=>callback(on)),
  click:click=>ipcRenderer.send('layer:click',click),
  key:key=>ipcRenderer.send('layer:key',key),
  exitMarking:()=>ipcRenderer.send('layer:exit-marking'),
  // Insert before the layer is calibrated: search the terrain now and answer whether the map was found.
  onAcquire:callback=>ipcRenderer.on('layer:acquire',()=>callback()),
  acquired:ok=>ipcRenderer.send('layer:acquired',ok===true),
  onSettings:callback=>ipcRenderer.on('layer:settings',(_event,settings)=>callback(settings)),
  // The map panel found in and around the area, in screen coordinates: the area is fitted to it.
  panel:rect=>ipcRenderer.send('layer:panel',rect),
  // Troubleshooting snapshot: the analysed frame as PNG plus what the layer made of it.
  onSnapshot:callback=>ipcRenderer.on('layer:snapshot',()=>callback()),
  snapshot:data=>ipcRenderer.send('layer:snapshot-data',data),
  picked:rect=>ipcRenderer.send('picker:done',rect),
  cancel:()=>ipcRenderer.send('picker:cancel'),
});
