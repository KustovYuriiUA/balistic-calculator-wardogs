const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {_electron}=require('./playwright.cjs');
const {resolvePosition}=require('../desktop/window-position.cjs');
(async()=>{
  const root=path.resolve(__dirname,'..');
  fs.mkdirSync(path.join(root,'.test-output'),{recursive:true});
  const data=fs.mkdtempSync(path.join(root,'.test-output','position-'));
  const start=async()=>{
    const instance=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'position-fixture.cjs')],env:{...process.env,SHOT_POSITION_TEST_DATA:data}});
    const page=await instance.firstWindow();await page.waitForSelector('body.desktop');return instance;
  };
  let instance;
  try{
    instance=await start();
    const first=await instance.evaluate(({BrowserWindow,screen})=>({bounds:BrowserWindow.getAllWindows()[0].getBounds(),area:screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea}));
    assert.equal(first.bounds.x,first.area.x+Math.round((first.area.width-first.bounds.width)/2));
    assert.equal(first.bounds.y,first.area.y+Math.round((first.area.height-first.bounds.height)/2));
    const wanted={x:first.area.x+20,y:first.area.y+10};
    await instance.evaluate(({BrowserWindow},p)=>{BrowserWindow.getAllWindows()[0].setPosition(p.x,p.y);},wanted);
    await instance.close();instance=null;
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data,'window-position.json'),'utf8')),wanted);
    instance=await start();
    const restored=await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getPosition());
    assert.deepEqual(restored,[wanted.x,wanted.y]);
    const area={x:0,y:0,width:1920,height:1080};
    assert.deepEqual(resolvePosition({x:99999,y:99999},880,790,[area],area),{x:520,y:145});
    assert.deepEqual(resolvePosition({x:-1500,y:100},880,790,[{x:-1920,y:0,width:1920,height:1080},area],area),{x:-1500,y:100});
    console.log('PASS: first launch centered, moved position saved on close and restored after restart, disconnected/negative-coordinate monitors handled.');
  }finally{if(instance)await instance.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
