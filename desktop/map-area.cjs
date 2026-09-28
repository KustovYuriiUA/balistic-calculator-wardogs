'use strict';
// Screen area of the in-game map panel: chosen once with the area picker, saved in userData.
const fs = require('node:fs');
const path = require('node:path');
const MIN_AREA = 120;
const int = v => Number.isSafeInteger(v);
const rectOk = r => r && int(r.x) && int(r.y) && int(r.width) && int(r.height) && r.width > 0 && r.height > 0;

function validArea(area) {
  const {display, rect} = area || {};
  if (!display || typeof display.id !== 'string' || display.id.length > 40 || !rectOk(display.bounds) || !rectOk(rect)) return null;
  if (rect.width < MIN_AREA || rect.height < MIN_AREA) return null;
  const b = display.bounds;
  if (rect.x < b.x || rect.y < b.y || rect.x + rect.width > b.x + b.width || rect.y + rect.height > b.y + b.height) return null;
  // snapped: the rectangle was fitted to the in-game map panel found inside the drawn one (snapArea).
  return {display: {id: display.id, bounds: {x: b.x, y: b.y, width: b.width, height: b.height}}, rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}, snapped: area.snapped === true};
}

// The map panel the layer found in and around the saved area (as read from the file) → the area fitted to it. The panel must be nearly
// square, at least half the area's size, and lie within the drawn area grown by 10 % on each side.
function snapArea(saved, panel) {
  if (![panel?.x, panel?.y, panel?.width, panel?.height].every(Number.isFinite)) return null;
  const r = saved.rect, grow = Math.max(r.width, r.height) * .1;
  const rect = {x: Math.round(panel.x), y: Math.round(panel.y), width: Math.round(panel.width), height: Math.round(panel.height)};
  if (Math.abs(rect.width - rect.height) > Math.max(4, rect.width * .03) || rect.width < r.width * .5 || rect.height < r.height * .5) return null;
  if (rect.x < r.x - grow || rect.y < r.y - grow || rect.x + rect.width > r.x + r.width + grow || rect.y + rect.height > r.y + r.height + grow) return null;
  return validArea({display: saved.display, rect, snapped: true});
}

function readArea(file) {
  try { return validArea(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return null; }
}

// A saved area only applies to the same monitor at the same position and resolution.
function resolveArea(saved, displays) {
  if (!saved) return null;
  const display = displays.find(d => String(d.id) === saved.display.id);
  const b = display?.bounds, s = saved.display.bounds;
  if (!b || b.x !== s.x || b.y !== s.y || b.width !== s.width || b.height !== s.height) return null;
  return {display, rect: saved.rect, snapped: saved.snapped === true};
}

// Picker rectangle in window coordinates of that display → saved area, clamped to the display.
function areaFromSelection(selection, display) {
  const b = display.bounds;
  if (![selection?.x, selection?.y, selection?.width, selection?.height].every(Number.isFinite)) return null;
  const x0 = Math.max(0, Math.round(selection.x)), y0 = Math.max(0, Math.round(selection.y));
  const x1 = Math.min(b.width, Math.round(selection.x + selection.width)), y1 = Math.min(b.height, Math.round(selection.y + selection.height));
  return validArea({display: {id: String(display.id), bounds: b}, rect: {x: b.x + x0, y: b.y + y0, width: x1 - x0, height: y1 - y0}});
}

function saveArea(file, area) {
  try {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(area));
    fs.renameSync(temporary, file);
    return true;
  } catch (error) {
    console.warn('Не удалось сохранить область карты игры:', error.message);
    return false;
  }
}
module.exports = {MIN_AREA, validArea, readArea, resolveArea, areaFromSelection, snapArea, saveArea};
