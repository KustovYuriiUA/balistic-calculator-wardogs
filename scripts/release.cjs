'use strict';
// Builds the GitHub release assets in release/: the full portable ZIP, the app update bundle
// (resources/app only) and update.json with sizes and SHA-256 that the in-app updater checks.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {writeZip, listFiles} = require('./zip.cjs');
const root = path.resolve(__dirname, '..'), release = path.join(root, 'release'), name = 'balistic-calculator-wardogs';
const {version} = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const electron = JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve('electron')), 'package.json'), 'utf8')).version;
const folder = path.join(release, name);
fs.rmSync(folder, {recursive: true, force: true});
execFileSync(process.execPath, [path.join(__dirname, 'package.cjs'), name], {stdio: 'inherit'});
const full = path.join(release, `${name}-win-x64.zip`), bundle = path.join(release, `app-${version}.zip`), manifestFile = path.join(release, 'update.json');
for (const file of [full, bundle, manifestFile]) fs.rmSync(file, {force: true});
writeZip(bundle, listFiles(path.join(folder, 'resources', 'app')));
writeZip(full, listFiles(folder, name + '/'));
const describe = file => { const data = fs.readFileSync(file); return {name: path.basename(file), size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex')}; };
const manifest = {version, electron, app: describe(bundle), full: describe(full)};
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
