'use strict';
// Wide terrain search on one offline map, off the layer's thread: the layer runs one worker per map, all at once.
// In: {type:'map', size, luma} once (the coarse map), {type:'acquire', id, width, height, luma} (a capture's luminance),
// {type:'abort', id}. Out: {type:'ready'}, {type:'progress', id, value}, {type:'result', id, fix} (fix may be null).
importScripts('terrain-match.js');
let levels=null,current=0;
// A pause that lets an abort in, cheaper than setTimeout (clamped to 4 ms in a worker).
const channel=new MessageChannel();let wake=()=>{};channel.port1.onmessage=()=>wake();
const pause=()=>new Promise(resolve=>{wake=resolve;channel.port2.postMessage(0);});
onmessage=async({data})=>{
  if(data.type==='map'){levels=mapPyramid({width:data.size,height:data.size,data:data.luma});postMessage({type:'ready'});return;}
  if(data.type==='abort'){if(current===data.id)current=0;return;}
  if(data.type!=='acquire')return;
  const id=current=data.id;
  if(!levels){postMessage({type:'result',id,fix:null});return;}
  const cap={width:data.width,height:data.height,I:integralOf({width:data.width,height:data.height,data:data.luma})};
  const steps=acquireSteps(levels,cap,{step:1.12});let r;
  for(;;){r=steps.next();if(r.done)break;postMessage({type:'progress',id,value:r.value});await pause();if(current!==id)return;}
  current=0;
  const f=r.value;
  postMessage({type:'result',id,fix:f&&{x0:f.x0,y0:f.y0,s:f.s,score:f.score,lead:f.lead,confident:f.confident}});
};
