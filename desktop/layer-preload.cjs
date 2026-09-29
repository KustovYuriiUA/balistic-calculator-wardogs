'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// Shared by the game-map layer and the area picker.
contextBridge.exposeInMainWorld('mapLayer',{
  // The interface language (i18n.js reads it on load) and a new one chosen in the overlay.
  language:ipcRenderer.sendSync('app:language'),
  onLanguage:callback=>ipcRenderer.on('app:language-changed',(_event,language)=>callback(language)),
  config:()=>ipcRenderer.invoke('layer:config'),
  status:status=>ipcRenderer.send('layer:status',status),
  onSelection:callback=>ipcRenderer.on('layer:selection',(_event,key)=>callback(key)),
  // Marker mode: what to draw (from the overlay), the mode itself, and clicks going back to the overlay.
  onScene:callback=>ipcRenderer.on('layer:scene',(_event,scene)=>callback(scene)),
  onMarking:callback=>ipcRenderer.on('layer:marking',(_event,on)=>callback(on)),
  click:click=>ipcRenderer.send('layer:click',click),
  // A wheel in marker mode: the mouse to the game for its zoom (true) and back (false); onPass: ended by the app.
  pass:on=>ipcRenderer.send('layer:pass',on===true),
  onPass:callback=>ipcRenderer.on('layer:pass',(_event,on)=>callback(on===true)),
  onSettings:callback=>ipcRenderer.on('layer:settings',(_event,settings)=>callback(settings)),
  // The map panel found in and around the area, in screen coordinates: the area is fitted to it. refit: the map's
  // frame is no longer on the fitted area's edges and the panel was found elsewhere: move the area to it.
  panel:rect=>ipcRenderer.send('layer:panel',rect),
  refit:rect=>ipcRenderer.send('layer:refit',rect),
  onSnapped:callback=>ipcRenderer.on('layer:snapped',()=>callback()),
  // The last calibration (map, zone, fix), kept across sessions for a quick start when the map opens.
  remember:memory=>ipcRenderer.send('layer:remember',memory),
  // Troubleshooting snapshot: the analysed frame as PNG plus what the layer made of it.
  onSnapshot:callback=>ipcRenderer.on('layer:snapshot',()=>callback()),
  snapshot:data=>ipcRenderer.send('layer:snapshot-data',data),
  picked:rect=>ipcRenderer.send('picker:done',rect),
  cancel:()=>ipcRenderer.send('picker:cancel'),
});
