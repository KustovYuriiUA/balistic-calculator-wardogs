// Starts through the real boot script with a throwaway profile, like the portable EXE does.
const {app,globalShortcut}=require('electron');
app.setPath('userData',process.env.SHOT_POSITION_TEST_DATA);
globalShortcut.register=()=>true;
require('../desktop/boot.cjs');
