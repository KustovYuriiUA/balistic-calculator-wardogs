'use strict';
// Minimal ZIP writer: deflate or store, UTF-8 names with forward slashes, streamed to disk.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function dosTime(date) {
  return {time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1), date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()};
}
function listFiles(dir, prefix = '') {
  return fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const full = path.join(dir, entry.name), name = prefix + entry.name;
    return entry.isDirectory() ? listFiles(full, name + '/') : [{full, name}];
  });
}
// entries: [{full, name}] where name is the path inside the archive.
function writeZip(output, entries) {
  const fd = fs.openSync(output, 'w'), central = [], stamp = dosTime(new Date());
  let offset = 0;
  const write = buffer => { fs.writeSync(fd, buffer); offset += buffer.length; };
  try {
    for (const {full, name} of entries) {
      const data = fs.readFileSync(full), crc = zlib.crc32(data), deflated = zlib.deflateRawSync(data, {level: 9});
      const stored = deflated.length >= data.length, body = stored ? data : deflated, method = stored ? 0 : 8, fileName = Buffer.from(name, 'utf8');
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(method, 8);
      header.writeUInt16LE(stamp.time, 10); header.writeUInt16LE(stamp.date, 12); header.writeUInt32LE(crc, 14);
      header.writeUInt32LE(body.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(fileName.length, 26);
      const local = offset;
      write(header); write(fileName); write(body);
      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x0800, 8); record.writeUInt16LE(method, 10);
      record.writeUInt16LE(stamp.time, 12); record.writeUInt16LE(stamp.date, 14); record.writeUInt32LE(crc, 16);
      record.writeUInt32LE(body.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(fileName.length, 28); record.writeUInt32LE(local, 42);
      central.push(record, fileName);
    }
    const start = offset;
    for (const part of central) write(part);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(offset - start, 12); end.writeUInt32LE(start, 16);
    write(end);
  } finally { fs.closeSync(fd); }
}
module.exports = {writeZip, listFiles};
