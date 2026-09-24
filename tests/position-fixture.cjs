const {app}=require('electron');
app.setPath('userData',process.env.SHOT_POSITION_TEST_DATA);
// UI/position tests do not reserve Insert while the user's portable app is running.
if(process.env.SHOT_TEST_SKIP_SHORTCUT==='1')require('electron').globalShortcut.register=()=>true;
require('../desktop/main.cjs');
