'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const core=require('../desktop/update-core.cjs'),{writeZip,listFiles}=require('../scripts/zip.cjs');
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'shot-update-'));
test('Versions: tags with or without v, numeric order, invalid input never counts as newer',()=>{
  assert.deepEqual(core.parseVersion('v1.10.2'),[1,10,2]);
  assert.equal(core.isNewer('1.10.0','1.9.9'),true);assert.equal(core.isNewer('v2.0.0','1.99.99'),true);
  for(const [a,b] of [['1.0.0','1.0.0'],['1.0.0','1.0.1'],['latest','1.0.0'],['1.0','0.9.0'],['1.0.0-beta','0.9.0']])assert.equal(core.isNewer(a,b),false,a+' vs '+b);
});
test('Manifest needs version, Electron version and both assets with size and SHA-256',()=>{
  const asset={name:'app-1.1.0.zip',size:10,sha256:'a'.repeat(64)},good={version:'1.1.0',electron:'44.3.0',app:asset,full:{...asset,name:'full.zip'}};
  assert.equal(core.validateManifest(good),good);
  for(const bad of [null,{...good,version:'x'},{...good,electron:''},{...good,app:{...asset,sha256:'zz'}},{...good,full:{...asset,name:'../x'}},{...good,app:{...asset,size:0}}])assert.throws(()=>core.validateManifest(bad));
});
test('ZIP round trip: deflated and stored entries, Cyrillic names, nested folders',()=>{
  const dir=temp(),src=path.join(dir,'src');fs.mkdirSync(path.join(src,'dist','maps'),{recursive:true});
  fs.writeFileSync(path.join(src,'package.json'),JSON.stringify({version:'1.2.3'}));
  fs.writeFileSync(path.join(src,'dist','maps','карта.webp'),Buffer.from([1,2,3]));
  fs.writeFileSync(path.join(src,'dist','index.html'),'<p>'+'повтор '.repeat(500)+'</p>');
  const zip=path.join(dir,'out.zip');writeZip(zip,listFiles(src,'root/'));
  const files=core.readZip(fs.readFileSync(zip));
  assert.deepEqual(files.map(f=>f.name),['root/dist/index.html','root/dist/maps/карта.webp','root/package.json']);
  assert.equal(files[0].data.toString(),fs.readFileSync(path.join(src,'dist','index.html'),'utf8'));
  assert.deepEqual([...files[1].data],[1,2,3]);
});
test('ZIP reader rejects escaping paths and corrupted data',()=>{
  for(const name of ['../evil.js','/abs.js','C:/x.js','a\\b.js','a/../b.js','a//b.js'])assert.equal(core.safeEntry(name),false,name);
  const dir=temp(),file=path.join(dir,'f.txt');fs.writeFileSync(file,'x'.repeat(1000));
  const zip=path.join(dir,'evil.zip');writeZip(zip,[{full:file,name:'../evil.js'}]);
  assert.throws(()=>core.readZip(fs.readFileSync(zip)),/Недопустимый путь/);
  writeZip(zip,[{full:file,name:'ok.txt'}]);const broken=fs.readFileSync(zip);broken[40]^=0xff;
  assert.throws(()=>core.readZip(broken));
});
test('Boot picks a newer staged update, retries an unconfirmed start once, then falls back',()=>{
  const userData=temp(),bundled=temp();
  fs.mkdirSync(path.join(bundled,'desktop'));fs.writeFileSync(path.join(bundled,'package.json'),JSON.stringify({version:'1.0.0'}));
  const bundledEntry=path.join(bundled,'desktop','main.cjs'),updateEntry=path.join(userData,'updates','1.1.0','desktop','main.cjs');
  assert.equal(core.chooseEntry(userData,bundled),bundledEntry,'Nothing staged');
  fs.mkdirSync(path.dirname(updateEntry),{recursive:true});fs.writeFileSync(updateEntry,'');
  core.writeState(userData,{version:'1.1.0',attempts:0,confirmed:false});
  assert.equal(core.chooseEntry(userData,bundled),updateEntry,'First start of the update');
  assert.equal(core.chooseEntry(userData,bundled),updateEntry,'One retry');
  assert.equal(core.chooseEntry(userData,bundled),bundledEntry,'Third unconfirmed start falls back');
  assert.equal(core.readState(userData).broken,true);
  core.writeState(userData,{version:'1.1.0',attempts:5,confirmed:true});
  assert.equal(core.chooseEntry(userData,bundled),updateEntry,'Confirmed update keeps starting');
  core.writeState(userData,{version:'0.9.0',confirmed:true});
  assert.equal(core.chooseEntry(userData,bundled),bundledEntry,'An older staged version never replaces a newer bundled app');
});
