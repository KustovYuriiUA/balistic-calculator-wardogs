'use strict';
// Smoke check of the built pages, off screen (run `pnpm build` first, then `pnpm exec electron tests/pages-check.cjs`):
// each page of dist/ loads from file:// like the app loads it, without errors; the overlay renders its React tree
// (as the web variant: no preload), and the terrain search worker, an ES module worker, starts from file://.
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist');
app.setPath('userData',path.join(root,'.test-output','pages-check-profile'));

async function open(page){
  const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});
  const errors=[];
  win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
  win.webContents.on('preload-error',(_e,_p,error)=>errors.push(String(error)));
  await win.loadFile(path.join(dist,page));
  return {win,errors,run:js=>win.webContents.executeJavaScript(js)};
}

app.whenReady().then(async()=>{
  for(const page of ['index.html','layer.html','area-picker.html'])assert.ok(fs.existsSync(path.join(dist,page)),'dist/'+page+' (the updater checks index.html)');

  const overlay=await open('index.html');
  const state=await overlay.run(`new Promise(resolve=>setTimeout(()=>resolve({
    workspace:Boolean(document.getElementById('map-workspace')),
    calculator:Boolean(document.getElementById('calculator-workspace')),
    terrain:Boolean(document.querySelector('#terrain image')),
    bases:document.querySelectorAll('.spawn-base').length,
    tools:document.querySelectorAll('[data-map-tool]').length,
    title:document.title,
    windowBar:Boolean(document.getElementById('window-bar')),
  }),500))`);
  assert.equal(state.workspace,true,'the map workspace rendered');
  assert.equal(state.calculator,true,'the calculator rendered');
  assert.equal(state.terrain,true,'the offline map image');
  assert.ok(state.bases>0,'spawn bases of the region on the map');
  assert.equal(state.tools,3,'three map tools');
  assert.equal(state.windowBar,false,'no title bar on the web variant');
  assert.match(state.title,/Tochny Brosok|Точный бросок/);
  // A click on the map places my position; the fire solution panel follows the store.
  const placed=await overlay.run(`(()=>{const svg=document.getElementById('terrain'),r=svg.getBoundingClientRect();
    svg.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));
    return new Promise(resolve=>setTimeout(()=>resolve(document.getElementById('map-player-label').textContent),100));})()`);
  assert.match(placed,/\d/,'my position placed by a click: '+placed);
  assert.deepEqual(overlay.errors,[],'overlay console errors');

  const layer=await open('layer.html');
  const worker=fs.readdirSync(path.join(dist,'assets')).find(f=>/^terrain\.worker-.*\.js$/.test(f));
  assert.ok(worker,'the terrain worker is built');
  const started=await layer.run(`new Promise(resolve=>{
    const w=new Worker(new URL('assets/${worker}',location.href),{type:'module'});
    w.onerror=e=>resolve('error: '+(e.message||'failed to load'));
    setTimeout(()=>{w.terminate();resolve('ok');},1000);
  })`);
  assert.equal(started,'ok','the module worker starts from file://');
  assert.deepEqual(layer.errors,[],'layer console errors');

  const picker=await open('area-picker.html');
  await picker.run('new Promise(r=>setTimeout(r,200))');
  assert.deepEqual(picker.errors,[],'picker console errors');

  console.log('pages-check: overlay, layer and picker load; worker starts; ok');
  app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
