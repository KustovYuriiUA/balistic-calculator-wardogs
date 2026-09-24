'use strict';
// Pure update helpers (no Electron): versions, manifest checks, ZIP reading, choosing the app to start.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function parseVersion(text) {
  const match = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(text).trim());
  return match ? match.slice(1).map(Number) : null;
}
function isNewer(candidate, current) {
  const a = parseVersion(candidate), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

const sha256 = /^[0-9a-f]{64}$/;
const assetName = /^[\w.-]{1,120}$/;
function validateManifest(manifest) {
  const ok = manifest && typeof manifest === 'object' && parseVersion(manifest.version) && typeof manifest.electron === 'string' && parseVersion(manifest.electron)
    && ['app', 'full'].every(key => manifest[key] && assetName.test(manifest[key].name) && Number.isSafeInteger(manifest[key].size) && manifest[key].size > 0 && sha256.test(manifest[key].sha256));
  if (!ok) throw new Error('Некорректный манифест обновления.');
  return manifest;
}

// Minimal ZIP reader for our own archives: stored or deflated entries, UTF-8 names, CRC-checked.
function readZip(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('Архив обновления повреждён.');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const files = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Архив обновления повреждён.');
    const method = buffer.readUInt16LE(offset + 10), crc = buffer.readUInt32LE(offset + 16), compressed = buffer.readUInt32LE(offset + 20), size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32), local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (!safeEntry(name)) throw new Error('Недопустимый путь в архиве: ' + name);
    if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('Архив обновления повреждён.');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(start, start + compressed);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data || data.length !== size || zlib.crc32(data) !== crc) throw new Error('Файл в архиве повреждён: ' + name);
    files.push({name, data});
  }
  return files;
}
function safeEntry(name) {
  return name.length > 0 && name.length < 260 && !name.includes('\\') && !name.startsWith('/') && !/^[a-z]:/i.test(name) && name.split('/').every(part => part && part !== '.' && part !== '..');
}

// Updates live in <userData>/updates/<version>; state.json names the one to start next.
const updatesDir = userData => path.join(userData, 'updates');
function readState(userData) {
  try { return JSON.parse(fs.readFileSync(path.join(updatesDir(userData), 'state.json'), 'utf8')); } catch { return null; }
}
function writeState(userData, state) {
  const dir = updatesDir(userData), temporary = path.join(dir, 'state.json.tmp');
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(temporary, JSON.stringify(state));
  fs.renameSync(temporary, path.join(dir, 'state.json'));
}
// Called by the boot script before anything else. An update that never confirmed a successful start
// gets one retry, then the bundled app starts again and the update is marked broken.
function chooseEntry(userData, bundledRoot) {
  const bundled = path.join(bundledRoot, 'desktop', 'main.cjs');
  try {
    const state = readState(userData), bundledVersion = JSON.parse(fs.readFileSync(path.join(bundledRoot, 'package.json'), 'utf8')).version;
    if (!state || state.broken || !isNewer(state.version, bundledVersion)) return bundled;
    const entry = path.join(updatesDir(userData), state.version, 'desktop', 'main.cjs');
    if (!fs.existsSync(entry)) return bundled;
    if (!state.confirmed) {
      if ((state.attempts || 0) >= 2) { writeState(userData, {...state, broken: true}); return bundled; }
      writeState(userData, {...state, attempts: (state.attempts || 0) + 1});
    }
    return entry;
  } catch { return bundled; }
}

module.exports = {parseVersion, isNewer, validateManifest, readZip, safeEntry, updatesDir, readState, writeState, chooseEntry};
