'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validArea,readArea,resolveArea,areaFromSelection,snapArea,saveArea}=require('../desktop/map-area.cjs');
const {cleanStatus,cleanClick,cleanFps,FPS_CHOICES}=require('../desktop/map-layer.cjs');
const main={id:101,bounds:{x:0,y:0,width:2560,height:1440}},left={id:7,bounds:{x:-1920,y:0,width:1920,height:1080}};

test('Picker rectangle becomes a screen area on that monitor, clamped, at least 120 px',()=>{
  assert.deepEqual(areaFromSelection({x:172.4,y:97.6,width:876.2,height:878},main),{display:{id:'101',bounds:main.bounds},rect:{x:172,y:98,width:877,height:878},snapped:false});
  assert.deepEqual(areaFromSelection({x:1500,y:-20,width:600,height:500},left).rect,{x:-420,y:0,width:420,height:480},'negative monitor, clamped to its edges');
  assert.equal(areaFromSelection({x:10,y:10,width:119,height:400},main),null);
  assert.equal(areaFromSelection({x:NaN,y:0,width:500,height:500},main),null);
});
test('Saved area applies only to the same monitor at the same position and resolution',()=>{
  const area=areaFromSelection({x:100,y:100,width:800,height:800},main);
  assert.deepEqual(resolveArea(area,[left,main]),{display:main,rect:area.rect,snapped:false});
  assert.equal(resolveArea(area,[left]),null,'monitor unplugged');
  assert.equal(resolveArea(area,[{...main,bounds:{...main.bounds,width:1920,height:1080}}]),null,'resolution changed');
  assert.equal(resolveArea(null,[main]),null);
});
test('A loosely drawn area snaps to the map panel found in it; implausible panels are refused',()=>{
  // The user's real case: area 1076×987 with a margin of 3D world, panel 880×881 inside it.
  const drawn=areaFromSelection({x:2031,y:216,width:1076,height:987},{id:7,bounds:{x:0,y:0,width:5120,height:1440}});
  assert.deepEqual(snapArea(drawn,{x:2122.4,y:276.6,width:879.8,height:880.9}),{display:drawn.display,rect:{x:2122,y:277,width:880,height:881},snapped:true});
  assert.equal(snapArea(drawn,{x:2122,y:277,width:880,height:700}),null,'not square');
  assert.equal(snapArea(drawn,{x:2200,y:300,width:400,height:400}),null,'too small for the drawn area');
  assert.equal(snapArea(drawn,{x:1500,y:277,width:880,height:880}),null,'far outside the drawn area');
  assert.equal(snapArea(drawn,{x:2122,y:NaN,width:880,height:880}),null);
  assert.equal(resolveArea(snapArea(drawn,{x:2122,y:277,width:880,height:881}),[{id:7,bounds:{x:0,y:0,width:5120,height:1440}}]).snapped,true);
});
test('Area file round trip; broken or tampered files are ignored',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'map-area-')),file=path.join(dir,'nested','map-area.json');
  try{
    const area=areaFromSelection({x:100,y:100,width:800,height:800},main);
    assert.equal(saveArea(file,area),true);assert.deepEqual(readArea(file),area);
    fs.writeFileSync(file,'{');assert.equal(readArea(file),null);
    assert.equal(validArea({...area,rect:{...area.rect,x:2000}}),null,'outside the monitor');
    assert.equal(validArea({...area,display:{...area.display,id:5}}),null,'id must be a string');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Layer status is sanitised before it reaches the overlay',()=>{
  assert.deepEqual(cleanStatus({state:'locked',key:'northamerica/zestafona-default',recognised:true,calibrated:true,source:'rim',world:'northamerica',metresPerPixel:1.33,extra:1}),{state:'locked',key:'northamerica/zestafona-default',recognised:true,calibrated:true,source:'rim',world:'northamerica',metresPerPixel:1.33,message:null});
  assert.deepEqual(cleanStatus({state:'hack',key:{},recognised:'yes',calibrated:1,source:'eval',world:'x'.repeat(41),metresPerPixel:'1',message:'x'.repeat(500)}),{state:'error',key:null,recognised:false,calibrated:false,source:null,world:null,metresPerPixel:null,message:null});
});
test('Poll rate of the game-map capture: one of the menu choices, 60 by default',()=>{
  assert.deepEqual(FPS_CHOICES,[15,30,60,120]);
  for(const v of FPS_CHOICES)assert.equal(cleanFps(v),v);
  for(const v of [undefined,0,59,'60',1e6,-5])assert.equal(cleanFps(v),60);
});
test('Clicks from the game-map layer: game units, left or right button, pin is my position or a target number',()=>{
  assert.deepEqual(cleanClick({x:70.12,y:103,button:'left',pin:'player',extra:1}),{x:70.12,y:103,button:'left',pin:'player'});
  assert.deepEqual(cleanClick({x:72,y:101,button:'right',pin:3}),{x:72,y:101,button:'right',pin:3});
  assert.equal(cleanClick({x:72,y:101,button:'left',pin:'<b>'}).pin,null);
  assert.equal(cleanClick({x:72,y:101,button:'left',pin:-1}).pin,null);
  for(const bad of [null,{x:'1',y:2,button:'left'},{x:1,y:NaN,button:'left'},{x:1,y:2,button:'middle'},{x:1e9,y:2,button:'left'}])assert.equal(cleanClick(bad),null);
});
