'use strict';
// Auto-update from GitHub releases: check the latest release, download the app bundle,
// verify size and SHA-256 from update.json, unpack it into userData for the next start.
const {app, net, shell} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('./update-core.cjs');

const REPO = 'KustovYuriiUA/balistic-calculator-wardogs';
const RELEASES = `https://github.com/${REPO}/releases`;
const testFeed = process.env.SHOT_UPDATE_FEED;
const feed = testFeed || `https://api.github.com/repos/${REPO}/releases/latest`;
const hosts = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', ...(testFeed ? ['127.0.0.1', 'localhost'] : [])]);
const CHECK_EVERY = 6 * 60 * 60 * 1000, APP_LIMIT = 100 * 1024 * 1024;

let options = null, status = {state: 'idle'}, busy = false;
const settingsFile = () => path.join(options.userData, 'update-settings.json');
function settings() { try { return {auto: true, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))}; } catch { return {auto: true}; } }
function saveSettings(next) { try { fs.writeFileSync(settingsFile(), JSON.stringify(next)); } catch {} }
function publish(next) { status = {...next, current: options.version, auto: settings().auto, enabled: options.enabled}; options.onChange(status); }

function allowed(url) {
  const parsed = new URL(url);
  return (parsed.protocol === 'https:' || (testFeed && parsed.protocol === 'http:')) && hosts.has(parsed.hostname);
}
async function get(url, accept, timeout) {
  if (!allowed(url)) throw new Error('Недопустимый адрес обновления.');
  const response = await net.fetch(url, {headers: {Accept: accept, 'User-Agent': 'tochnyi-brosok-updater'}, signal: AbortSignal.timeout(timeout)});
  if (response.url && !allowed(response.url)) throw new Error('Недопустимое перенаправление обновления.');
  if (!response.ok) throw new Error('GitHub ответил ' + response.status + '.');
  return response;
}
async function download(url, limit, onProgress) {
  const response = await get(url, 'application/octet-stream', 5 * 60 * 1000);
  const total = Number(response.headers.get('content-length')) || 0;
  if (total > limit) throw new Error('Файл обновления слишком большой.');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) throw new Error('Файл обновления слишком большой.');
    chunks.push(value);
    if (onProgress && total) onProgress(size / total);
  }
  return Buffer.concat(chunks);
}

async function check(manual) {
  if (busy || !options.enabled) return;
  busy = true;
  try {
    publish({state: 'checking', manual});
    const release = await (await get(feed, 'application/vnd.github+json', 20000)).json();
    const version = String(release.tag_name || '').replace(/^v/, '');
    if (!core.isNewer(version, options.version)) { publish({state: 'latest', manual}); return; }
    const page = typeof release.html_url === 'string' && release.html_url.startsWith(RELEASES + '/') ? release.html_url : RELEASES + '/latest';
    const asset = name => (release.assets || []).find(item => item.name === name)?.browser_download_url;
    const manifestUrl = asset('update.json');
    // Releases without a manifest, or built on another Electron runtime, need the full download.
    if (!manifestUrl) { publish({state: 'manual', version, url: page}); return; }
    const manifest = core.validateManifest(JSON.parse((await download(manifestUrl, 1e6)).toString('utf8')));
    if (manifest.version !== version) throw new Error('Версия манифеста не совпадает с релизом.');
    const staged = core.readState(options.userData);
    if (manifest.electron !== process.versions.electron || (staged?.version === version && staged.broken)) { publish({state: 'manual', version, url: page}); return; }
    if (staged?.version === version && fs.existsSync(path.join(core.updatesDir(options.userData), version, 'desktop', 'main.cjs'))) { publish({state: 'ready', version}); return; }
    const bundleUrl = asset(manifest.app.name);
    if (!bundleUrl) throw new Error('В релизе нет файла ' + manifest.app.name + '.');
    let shown = -1;
    const progress = share => { const percent = Math.floor(share * 100); if (percent >= shown + 5) { shown = percent; publish({state: 'downloading', version, progress: percent}); } };
    progress(0);
    const bundle = await download(bundleUrl, APP_LIMIT, progress);
    if (bundle.length !== manifest.app.size || crypto.createHash('sha256').update(bundle).digest('hex') !== manifest.app.sha256) throw new Error('Контрольная сумма обновления не совпала.');
    install(version, bundle);
    publish({state: 'ready', version});
  } catch (error) {
    console.warn('Обновление не проверено:', error.message);
    publish({state: 'error', manual, message: error.message});
  } finally { busy = false; }
}
function install(version, bundle) {
  const files = core.readZip(bundle), dir = core.updatesDir(options.userData), target = path.join(dir, version), partial = target + '.partial';
  fs.rmSync(partial, {recursive: true, force: true});
  for (const file of files) {
    const destination = path.join(partial, ...file.name.split('/'));
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.writeFileSync(destination, file.data);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(partial, 'package.json'), 'utf8'));
  if (manifest.version !== version || !fs.existsSync(path.join(partial, 'desktop', 'main.cjs')) || !fs.existsSync(path.join(partial, 'dist', 'index.html'))) throw new Error('Обновление неполное.');
  fs.rmSync(target, {recursive: true, force: true});
  fs.renameSync(partial, target);
  core.writeState(options.userData, {version, attempts: 0, confirmed: false});
  // Keep the new version and the running one; older downloads are removed.
  for (const name of fs.readdirSync(dir)) if (name !== version && name !== options.version && core.parseVersion(name.replace(/\.partial$/, ''))) fs.rmSync(path.join(dir, name), {recursive: true, force: true});
}
// The window of a freshly installed update loaded: keep starting it.
function confirm() {
  const state = options && core.readState(options.userData);
  if (state && state.version === options.version && !state.confirmed) core.writeState(options.userData, {...state, confirmed: true});
}
function start(config) {
  options = config;
  publish({state: 'idle'});
  if (!options.enabled) return;
  const scheduled = () => { if (settings().auto) check(false); };
  setTimeout(scheduled, Number(process.env.SHOT_UPDATE_DELAY ?? 8000));
  setInterval(scheduled, CHECK_EVERY).unref();
}
function action(name) {
  if (name === 'check') check(true);
  else if (name === 'restart' && status.state === 'ready') { app.relaunch(); app.quit(); }
  else if (name === 'open' && status.url && status.url.startsWith(RELEASES)) shell.openExternal(status.url);
  else if (name === 'toggle-auto') { saveSettings({...settings(), auto: !settings().auto}); publish(status); if (settings().auto) check(false); }
}
module.exports = {start, action, confirm, current: () => status};
