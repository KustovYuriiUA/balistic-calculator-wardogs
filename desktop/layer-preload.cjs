'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// Shared by the game-map layer and the area picker.
contextBridge.exposeInMainWorld('mapLayer',{
  config:()=>ipcRenderer.invoke('layer:config'),
  status:status=>ipcRenderer.send('layer:status',status),
  onSelection:callback=>ipcRenderer.on('layer:selection',(_event,key)=>callback(key)),
  // Marker mode: what to draw (from the overlay), the mode itself, and clicks going back to the overlay.
  onScene:callback=>ipcRenderer.on('layer:scene',(_event,scene)=>callback(scene)),
  onMarking:callback=>ipcRenderer.on('layer:marking',(_event,on)=>callback(on)),
  click:click=>ipcRenderer.send('layer:click',click),
  onSettings:callback=>ipcRenderer.on('layer:settings',(_event,settings)=>callback(settings)),
  // The map panel found in and around the area, in screen coordinates: the area is fitted to it. refit: the map's
  // frame is no longer on the fitted area's edges (the panel moved): fit it again.
  panel:rect=>ipcRenderer.send('layer:panel',rect),
  refit:()=>ipcRenderer.send('layer:refit'),
  onSnapped:callback=>ipcRenderer.on('layer:snapped',()=>callback()),
  // The last calibration (map, zone, fix), kept across sessions for a quick start when the map opens.
  remember:memory=>ipcRenderer.send('layer:remember',memory),
  // Troubleshooting snapshot: the analysed frame as PNG plus what the layer made of it.
  onSnapshot:callback=>ipcRenderer.on('layer:snapshot',()=>callback()),
  snapshot:data=>ipcRenderer.send('layer:snapshot-data',data),
  picked:rect=>ipcRenderer.send('picker:done',rect),
  cancel:()=>ipcRenderer.send('picker:cancel'),
});
