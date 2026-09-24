'use strict';
const fs = require('node:fs');
const path = require('node:path');

function readPosition(file) {
  try {
    const position = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Number.isSafeInteger(position.x) && Number.isSafeInteger(position.y)) return position;
  } catch {}
  return null;
}

function resolvePosition(saved, width, height, areas, fallback) {
  const centered = area => ({x:area.x + Math.round((area.width-width)/2),y:area.y + Math.round((area.height-height)/2)});
  if (!saved) return centered(fallback);
  // Restore on the same monitor, including monitors with negative coordinates.
  const area = areas.find(r => saved.x + Math.min(width,100) > r.x && saved.x < r.x+r.width && saved.y >= r.y && saved.y < r.y+r.height-40);
  if (!area) return centered(fallback);
  return {x:Math.max(area.x,Math.min(saved.x,area.x+Math.max(0,area.width-width))),y:Math.max(area.y,Math.min(saved.y,area.y+Math.max(0,area.height-height)))};
}

function savePosition(file, position) {
  try {
    fs.mkdirSync(path.dirname(file), {recursive:true});
    const temporary = file+'.tmp';
    fs.writeFileSync(temporary, JSON.stringify({x:position.x,y:position.y}));
    fs.renameSync(temporary, file);
  } catch (error) {
    console.warn('Не удалось сохранить положение окна:', error.message);
  }
}
module.exports = {readPosition,resolvePosition,savePosition};
