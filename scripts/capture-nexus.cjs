'use strict';
const fs=require('node:fs'),path=require('node:path');
const {_electron}=require('../tests/playwright.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=path.join(root,'media','nexus');fs.mkdirSync(out,{recursive:true});
 const profile=fs.mkdtempSync(path.join(root,'.test-output','media-'));
 const app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'tests','position-fixture.cjs')],env:{...process.env,SHOT_POSITION_TEST_DATA:profile,SHOT_TEST_SKIP_SHORTCUT:'1'}});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForSelector('body.desktop');await page.waitForFunction(()=>document.body.classList.contains('view-only'));await page.evaluate(()=>window.overlay.edit());
  await page.waitForFunction(()=>!document.body.classList.contains('view-only'));
  const size=async(w,h)=>{await app.evaluate(({BrowserWindow},{w,h})=>BrowserWindow.getAllWindows()[0].setSize(w,h),{w,h});await page.waitForFunction(w=>innerWidth===w,w);await page.waitForTimeout(180);};
  const place=async(text)=>{await page.locator('#map-coordinate').fill(text);await page.locator('#map-coordinate').press('Enter');};
  const shot=async(target,hit)=>{await page.locator('[data-map-tool="target"]').click();await place(target);if(hit){await page.locator('[data-map-tool="hit"]').click();await place(hit);}};
  const capture=async(name)=>{await page.locator('#map-coordinate').fill('');await page.locator('#map-coordinate').blur();await page.mouse.move(4,35);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(150);await page.screenshot({path:path.join(out,name)});};
  await size(1080,850);await page.locator('#maps-tab').click();await page.locator('#fit-region').click();
  await place('x57.40, y48.20');
  await shot('x78.60, y70.80','x68.40, y69.10');
  await shot('x96.20, y60.40','x100.30, y59.10');
  await shot('x88.10, y80.30');
  await page.locator('.target-select').first().click();
  await capture('01_map_and_independent_corrections.png');
  await page.locator('[data-target-id="3"] .target-remove').click();await size(520,900);
  await capture('02_compact_overlay.png');
  await size(1080,900);await page.locator('#calculator-tab').click();
  await page.mouse.move(4,35);await page.screenshot({path:path.join(out,'03_aim_and_distance_calculator.png')});
  await page.locator('#maps-tab').click();await page.locator('#terrain-select').selectOption('europe');
  await place('x86.80, y45.20');
  await shot('x103.20, y62.40','x95.60, y62.10');
  await shot('x119.30, y74.20');
  await page.locator('.target-select').first().click();await size(1080,850);
  await capture('04_europe_map_preset.png');
  if(errors.length)throw Error(errors.join('\n'));
  console.log(out);
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

