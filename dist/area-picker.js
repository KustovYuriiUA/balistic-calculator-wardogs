'use strict';
// Area picker: a dimmed full-screen window; drag a rectangle around the in-game map panel. Right click cancels (the
// window never takes the keyboard: the game keeps it, so M still opens the map meanwhile).
(()=>{
  const $=id=>document.getElementById(id),MIN=120;
  let start=null,box=null;
  const rectOf=(a,b)=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)});
  function show(r){const el=$('rect');el.hidden=false;Object.assign(el.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});$('size').textContent=`${Math.round(r.width)} × ${Math.round(r.height)}`;}
  addEventListener('pointerdown',e=>{if(e.button!==0)return;start={x:e.clientX,y:e.clientY};box=null;document.body.setPointerCapture(e.pointerId);document.body.classList.add('dragging');$('hint').classList.remove('error');});
  addEventListener('pointermove',e=>{if(start){box=rectOf(start,{x:e.clientX,y:e.clientY});show(box);}});
  addEventListener('pointerup',()=>{
    if(!start)return;start=null;
    if(box&&box.width>=MIN&&box.height>=MIN){window.mapLayer.picked(box);return;}
    document.body.classList.remove('dragging');$('rect').hidden=true;
    $('hint').classList.add('error');$('hint-text').textContent=I18N.t('picker.small',{min:MIN});
  });
  addEventListener('keydown',e=>{if(e.key==='Escape')window.mapLayer.cancel();});
  addEventListener('contextmenu',e=>{e.preventDefault();window.mapLayer.cancel();});
})();
