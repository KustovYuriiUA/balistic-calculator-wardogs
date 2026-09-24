'use strict';
const path=require('node:path');
const {build}=require('electron-builder');
const mapsBuild=process.argv.includes('--maps');
build({projectDir:path.resolve(__dirname,'..'),publish:'never',config:{appId:'local.basketball.shot-overlay',productName:'Точный бросок',electronDist:path.dirname(require('electron')),directories:{output:mapsBuild?'release/maps-portable':'release/single-exe'},files:['desktop/**/*','dist/**/*','package.json'],asar:true,npmRebuild:false,win:{target:[{target:'portable',arch:['x64']}],signAndEditExecutable:false},portable:{artifactName:mapsBuild?'Basketball-Maps-Portable.exe':'Basketball-Portable.exe',requestExecutionLevel:'user'}}}).then(files=>console.log(files.join('\n'))).catch(error=>{console.error(error);process.exitCode=1;});
