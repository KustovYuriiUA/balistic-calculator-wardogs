const {_electron}=require('./playwright.cjs');
const path=require('node:path');
(async()=>{
  const app=await _electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')]});
  try{
    const page=await app.firstWindow();await page.waitForSelector('body.desktop');
    await app.evaluate(async({BrowserWindow})=>{const fixture=new BrowserWindow({title:'Проверка Insert',width:420,height:200,x:30,y:30});await fixture.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<html lang="ru"><body style="background:#20242d;color:white;font:18px Segoe UI;padding:20px"><h3>Проверка Insert</h3><p>Тестовое окно вместо игры.</p></body></html>'));fixture.show();fixture.focus();});
    console.log('READY: send Insert to the window titled Проверка Insert.');
    const wait=async(editing)=>{const until=Date.now()+90000;while(Date.now()<until){const state=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()!=='Проверка Insert').isFocusable());if(state===editing)return;await new Promise(r=>setTimeout(r,150));}throw new Error('Insert did not set editing to '+editing);};
    await wait(true);console.log('EDITING: first Insert passed. Send second Insert to Проверка Insert.');
    await wait(false);console.log('PASS: Insert switches editing / passive viewing globally from another window.');
  }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
