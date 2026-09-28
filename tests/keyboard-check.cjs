// Manual check of the global Insert: send it to a stand-in "game" window. It must switch marker mode (the overlay
// clickable, then viewing again) while the game window keeps the keyboard throughout.
const {_electron}=require('./playwright.cjs');
const path=require('node:path');
(async()=>{
  const app=await _electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')]});
  try{
    const page=await app.firstWindow();await page.waitForSelector('body.desktop');
    await app.evaluate(async({BrowserWindow})=>{const fixture=new BrowserWindow({title:'Проверка Insert',width:420,height:200,x:30,y:30});await fixture.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<html lang="ru"><body style="background:#20242d;color:white;font:18px Segoe UI;padding:20px"><h3>Проверка Insert</h3><p>Тестовое окно вместо игры.</p></body></html>'));fixture.show();fixture.focus();});
    console.log('READY: send Insert to the window titled Проверка Insert.');
    const game=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Проверка Insert').isFocused());
    const wait=async(mode)=>{const until=Date.now()+90000;while(Date.now()<until){if(await page.evaluate(()=>document.body.dataset.mode)===mode){if(!await game())throw new Error('The game window lost the keyboard');return;}await new Promise(r=>setTimeout(r,150));}throw new Error('Insert did not switch the overlay to '+mode);};
    await wait('edit');console.log('MARKER MODE: first Insert passed, the game kept the keyboard. Send a second Insert to Проверка Insert.');
    await wait('view');console.log('PASS: Insert switches marker mode globally from another window, which keeps the keyboard.');
  }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
