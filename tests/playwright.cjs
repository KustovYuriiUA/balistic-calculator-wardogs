'use strict';
// Playwright for the UI checks: installed package, or a copy pointed to by PLAYWRIGHT_PATH.
module.exports=require(process.env.PLAYWRIGHT_PATH||'playwright');
