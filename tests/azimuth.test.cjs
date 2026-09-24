'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {azimuth,formatAzimuth}=require('../dist/maps.js');
test('Compass azimuth: cardinal directions, quadrants, wrap and coincident positions',()=>{
  const p={x:20,y:20};
  for(const [x,y,expected]of [[20,30,0],[30,20,90],[20,10,180],[10,20,270],[30,30,45],[10,30,315]])assert.equal(azimuth(p,{x,y}),expected);
  assert.equal(azimuth(p,p),null);
  assert.ok(azimuth(p,{x:19.99,y:30})>359);
});
test('Azimuth reads like a compass dial: three digits, tenths, wrap to 000',()=>{
  for(const [value,expected]of [[0,'000,0°'],[43.24,'043,2°'],[90,'090,0°'],[210.44,'210,4°'],[359.96,'000,0°'],[null,'—']])assert.equal(formatAzimuth(value),expected);
});
