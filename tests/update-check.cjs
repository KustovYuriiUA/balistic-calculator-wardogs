'use strict';
// End-to-end auto-update against a local fake of the GitHub releases API.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {_electron}=require('./playwright.cjs');
const {writeZip,listFiles}=require('../scripts/zip.cjs');
(async()=>{
  const root=path.resolve(__dirname,'..'),out=path.join(root,'.test-output');fs.mkdirSync(out,{recursive:true});
  const work=fs.mkdtempSync(path.join(out,'update-')),electron=JSON.parse(fs.readFileSync(path.join(root,'node_modules','electron','package.json'),'utf8')).version;
  // Update 9.9.9 = the current desktop/ and dist/ (without the large maps) with a bumped version.
  const stage=path.join(work,'stage');fs.cpSync(path.join(root,'desktop'),path.join(stage,'desktop'),{recursive:true});
  fs.cpSync(path.join(root,'dist'),path.join(stage,'dist'),{recursive:true,filter:src=>!src.includes(path.join('dist','maps'))});
  fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify({name:'basketball-overlay',version:'9.9.9',main:'desktop/boot.cjs'}));
  const bundleFile=path.join(work,'app-9.9.9.zip');writeZip(bundleFile,listFiles(stage));
  const bundle=fs.readFileSync(bundleFile),asset={name:'app-9.9.9.zip',size:bundle.length,sha256:crypto.createHash('sha256').update(bundle).digest('hex')};
  const manifests={good:{version:'9.9.9',electron,app:asset,full:{...asset,name:'full.zip'}},bad:{version:'9.9.9',electron,app:{...asset,sha256:'0'.repeat(64)},full:{...asset,name:'full.zip'}},manual:{version:'9.9.9',electron:'1.0.0',app:asset,full:{...asset,name:'full.zip'}}};
  const server=http.createServer((req,res)=>{
    const [,kind,file]=req.url.split('/'),base=`http://127.0.0.1:${server.address().port}/${kind}/`;
    if(!manifests[kind]){res.writeHead(404).end();return;}
    if(file==='latest'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({tag_name:'v9.9.9',html_url:'https://github.com/KustovYuriiUA/balistic-calculator-wardogs/releases/tag/v9.9.9',assets:['update.json','app-9.9.9.zip'].map(name=>({name,browser_download_url:base+name}))}));}
    else if(file==='update.json')res.writeHead(200).end(JSON.stringify(manifests[kind]));
    else if(file==='app-9.9.9.zip')res.writeHead(200,{'content-length':bundle.length}).end(bundle);
    else res.writeHead(404).end();
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const launch=async(kind,userData)=>{
    const application=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'update-fixture.cjs')],env:{...process.env,SHOT_POSITION_TEST_DATA:userData,SHOT_UPDATE_FEED:`http://127.0.0.1:${server.address().port}/${kind}/latest`,SHOT_UPDATE_DELAY:'200'}});
    const page=await application.firstWindow();await page.waitForSelector('body.desktop');return {application,page};
  };
  const pill=page=>page.locator('#update-pill');
  let run;
  try{
    const userData=path.join(work,'profile');fs.mkdirSync(userData);
    run=await launch('good',userData);
    await run.page.waitForFunction(()=>document.getElementById('update-pill').classList.contains('ready'),null,{timeout:30000});
    assert.match(await pill(run.page).textContent(),/Обновить до 9\.9\.9/);
    assert.equal(await run.page.locator('#window-brand').getAttribute('title'),'Точный бросок 1.0.0');
    assert.equal(fs.existsSync(path.join(userData,'updates','9.9.9','desktop','main.cjs')),true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userData,'updates','state.json'),'utf8')),{version:'9.9.9',attempts:0,confirmed:false});
    await run.application.close();
    run=await launch('good',userData);
    assert.match(await run.page.evaluate(()=>location.href),/updates\/9\.9\.9\/dist\/index\.html$/,'Next start runs the downloaded version');
    await run.page.waitForFunction(()=>document.getElementById('window-brand').title==='Точный бросок 9.9.9');
    await run.page.waitForTimeout(800);
    assert.equal(JSON.parse(fs.readFileSync(path.join(userData,'updates','state.json'),'utf8')).confirmed,true,'Successful start is confirmed');
    assert.equal(await pill(run.page).isVisible(),false,'Already on the latest version');
    await run.application.close();run=null;

    const tampered=path.join(work,'tampered');fs.mkdirSync(tampered);
    run=await launch('bad',tampered);await run.page.waitForTimeout(2500);
    assert.equal(fs.existsSync(path.join(tampered,'updates','9.9.9')),false,'Checksum mismatch installs nothing');
    assert.equal(await pill(run.page).isVisible(),false,'Automatic check fails silently');
    await run.application.close();run=null;

    const manual=path.join(work,'manual');fs.mkdirSync(manual);
    run=await launch('manual',manual);
    await run.page.waitForFunction(()=>document.getElementById('update-pill').dataset.action==='open',null,{timeout:30000});
    assert.match(await pill(run.page).textContent(),/Версия 9\.9\.9/,'Another Electron runtime asks for the full download');
    assert.equal(fs.existsSync(path.join(manual,'updates','9.9.9')),false);
    console.log('PASS: update found, downloaded, verified and staged; next start runs it and confirms; tampered bundle rejected; runtime change asks for full download.');
  }finally{if(run)await run.application.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
