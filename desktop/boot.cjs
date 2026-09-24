'use strict';
// App entry: start the newest downloaded update (see updater.cjs) or the bundled app.
const {app} = require('electron');
const path = require('node:path');
const {chooseEntry} = require('./update-core.cjs');
const root = path.join(__dirname, '..');
// Development runs (`pnpm start`) always use the working copy unless a test feed is set.
require(app.isPackaged || process.env.SHOT_UPDATE_FEED ? chooseEntry(app.getPath('userData'), root) : path.join(root, 'desktop', 'main.cjs'));
