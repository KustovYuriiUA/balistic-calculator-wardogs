'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {_electron}=require('./playwright.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),userData=fs.mkdtempSync(path.join(root,'.test-output','presets-'));
 let application,page;const errors=[];
 const launch=async()=>{
  application=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'position-fixture.cjs')],env:{...process.env,SHOT_POSITION_TEST_DATA:userData,SHOT_TEST_SKIP_SHORTCUT:'1'}});
  page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.waitForSelector('body.desktop');await page.waitForFunction(()=>document.body.classList.contains('view-only'));
  await page.evaluate(()=>window.overlay.edit());await page.waitForFunction(()=>!document.body.classList.contains('view-only'));
  await page.locator('#maps-tab').click();
 };
 const place=async(text)=>{await page.locator('#map-coordinate').fill(text);await page.locator('#map-coordinate').press('Enter');};
 const empty=async()=>{
  assert.equal(await page.locator('.target-row').count(),0);
  for(const id of ['player','target','hit','distance','previous-aim','map-coordinate'])assert.equal(await page.locator('#'+id).inputValue(),'','New preset clears '+id);
  assert.equal(await page.locator('#terrain-markers .map-pin').count(),0);
  assert.equal(await page.locator('[data-map-tool="player"]').getAttribute('aria-pressed'),'true');
 };
 try{
  await launch();await place('x20,y20');await place('x40,y20');await page.locator('[data-map-tool="hit"]').click();await place('x30,y20');
  assert.equal(await page.locator('.target-coefficient').textContent(),'K ×2');
  await page.locator('#zone-select').selectOption('bakurani-farmland');await empty();
  await place('x10,y10');await place('x10,y40');await page.locator('[data-map-tool="hit"]').click();await place('x10,y50');
  assert.equal(await page.locator('.target-coefficient').textContent(),'K ×0,75');
  await page.locator('#region-select').selectOption('mindori');await empty();
  await place('x50,y50');await place('x80,y50');
  await page.locator('#terrain-select').selectOption('europe');await empty();
  await place('x100,y100');await place('x100,y120');
  await page.locator('#terrain-select').selectOption('kavkazi');
  assert.equal(await page.locator('#region-select').inputValue(),'mindori');
  assert.equal(await page.locator('#player').inputValue(),'x50.00, y50.00');
  await page.locator('#region-select').selectOption('bakurani');
  assert.equal(await page.locator('#zone-select').inputValue(),'bakurani-default');
  assert.equal(await page.locator('#player').inputValue(),'x20.00, y20.00');
  assert.match(await page.locator('.target-power').textContent(),/^4\s000 м$/);
  await page.locator('#zone-select').selectOption('bakurani-farmland');
  assert.match(await page.locator('.target-power').textContent(),/^2\s250 м$/);
  // Full process restart, same user profile.
  await application.close();application=null;await launch();
  assert.equal(await page.locator('#zone-select').inputValue(),'bakurani-farmland');
  assert.equal(await page.locator('#player').inputValue(),'x10.00, y10.00');
  assert.equal(await page.locator('.target-coefficient').textContent(),'K ×0,75');
  await page.locator('#zone-select').selectOption('bakurani-default');
  assert.equal(await page.locator('.target-coefficient').textContent(),'K ×2');
  assert.equal(await page.locator('#hit').inputValue(),'x30.00, y20.00');
  assert.equal(await page.locator('.card-shots').textContent(),'выстрел 1','Shot counter survives restart');
  await page.locator('.target-remove').click();
  await page.locator('#zone-select').selectOption('bakurani-farmland');assert.equal(await page.locator('.target-row').count(),1);
  await page.locator('#terrain-select').selectOption('europe');
  assert.equal(await page.locator('#player').inputValue(),'x100.00, y100.00');
  assert.match(await page.locator('.target-power').textContent(),/^2\s000 м$/);
  await page.locator('#terrain-select').selectOption('kavkazi');
  await page.locator('#zone-select').selectOption('bakurani-default');
  await application.close();application=null;await launch();
  assert.equal(await page.locator('.target-row').count(),0,'Deleted goal stays deleted after restart');
  assert.equal(await page.locator('#player').inputValue(),'x20.00, y20.00','Own position is saved without any goals');
  assert.deepEqual(errors,[]);
  console.log('PASS: isolated map/region/zone presets, cleared inputs, separate coefficients, full restart restoration, persistent deletion and own-position-only preset.');
 }finally{if(application)await application.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
