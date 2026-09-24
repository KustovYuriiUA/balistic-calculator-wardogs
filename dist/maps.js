'use strict';
// Wardogs Zone map metadata: all three images span X 0..163.84, Y 163.84..0.
const MAP_EXTENT=163.84;
function coordToMap(p){return {x:p.x/MAP_EXTENT*1000,y:(1-p.y/MAP_EXTENT)*1000};}
function mapToCoord(p){return {x:p.x/1000*MAP_EXTENT,y:(1-p.y/1000)*MAP_EXTENT};}
function azimuth(from,to){const dx=to.x-from.x,dy=to.y-from.y;return Math.hypot(dx,dy)<1e-9?null:(Math.atan2(dx,dy)*180/Math.PI+360)%360;}
// Compass dial reading: three digits and tenths, 43.24 -> "043,2°".
function formatAzimuth(value){if(value===null||!Number.isFinite(value))return '—';const [whole,tenth]=(Math.round(value*10)/10%360).toFixed(1).split('.');return whole.padStart(3,'0')+','+tenth+'°';}
if(typeof module!=='undefined')module.exports={coordToMap,mapToCoord,azimuth,formatAzimuth};
if(typeof document!=='undefined'){
  const $=id=>document.getElementById(id),svg=$('terrain'),ns='http://www.w3.org/2000/svg';
  const worlds=new Map(),selections=new Map(),undoStacks=new Map();
  let world='kavkazi',tool='player',view={x:0,y:0,size:1000},drag=null,suppressClick=false,drawnSize=null,toastTimer=0;
  const storageKey='shot-map-presets-v1',uiKey='shot-ui-v1';let lastSaved='',storageReady=false;
  const ui=(()=>{try{return JSON.parse(localStorage.getItem(uiKey))||{};}catch{return {};}})();
  const saveUi=()=>{try{localStorage.setItem(uiKey,JSON.stringify(ui));}catch{}};
  const presetKey=()=>JSON.stringify([world,landmarkSelection().region,landmarkSelection().zone]);
  function persistPresets(){
    if(!storageReady)return;
    const payload=JSON.stringify({version:1,world,selections:[...selections],presets:[...worlds]});
    if(payload===lastSaved)return;
    const status=$('preset-status');
    try{localStorage.setItem(storageKey,payload);lastSaved=payload;status.textContent='Сохранено';status.classList.remove('error');}
    catch{status.textContent='Не сохранено';status.classList.add('error');status.title='Не удалось записать пресеты. Проверь свободное место и доступ к профилю приложения.';}
  }
  function restorePresets(){
    const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=1e9&&Math.abs(p.y)<=1e9;
    const str=v=>typeof v==='string'?v.slice(0,200):'';
    try{
      const raw=localStorage.getItem(storageKey);if(!raw)return;
      const data=JSON.parse(raw);if(data.version!==1)throw Error('version');
      for(const [map,choice]of data.selections||[]){
        const meta=MAP_LANDMARKS[map];if(!meta||!meta.rotations.some(r=>r.id===choice?.region))continue;
        selections.set(map,{region:choice.region,zone:meta.zones.some(z=>z.rotation===choice.region&&z.id===choice.zone)?choice.zone:''});
      }
      for(const [key,value]of data.presets||[]){
        const [map,region,zone]=JSON.parse(key),meta=MAP_LANDMARKS[map];
        if(!meta||!meta.rotations.some(r=>r.id===region)||(zone&&!meta.zones.some(z=>z.rotation===region&&z.id===zone))||!Array.isArray(value?.targets))continue;
        const ids=new Set(),targets=[];
        for(const t of value.targets){
          if(!Number.isSafeInteger(t?.id)||t.id<1||ids.has(t.id)||!point(t.point))continue;
          ids.add(t.id);const hit=str(t.hit);
          targets.push({id:t.id,point:{x:t.point.x,y:t.point.y},distance:str(t.distance),hit,previousAim:str(t.previousAim),origin:typeof t.origin==='string'?t.origin:null,shots:Number.isSafeInteger(t.shots)&&t.shots>=0&&t.shots<1e4?t.shots:hit?1:0});
        }
        worlds.set(key,{player:point(value.player)?{x:value.player.x,y:value.player.y}:null,targets,selected:ids.has(value.selected)?value.selected:targets[0]?.id??null,next:Math.max(1,...targets.map(t=>t.id+1),Number.isSafeInteger(value.next)?value.next:1)});
      }
      if(MAP_LANDMARKS[data.world])world=data.world;
    }catch{$('preset-status').textContent='Ошибка чтения';$('preset-status').classList.add('error');$('preset-status').title='Не удалось прочитать сохранения пресетов.';}
  }
  function switchPreset(change){
    saveForm();persistPresets();change();landmarkControls();
    $('map-coordinate').value='';$('map-error').textContent='';$('toast').hidden=true;
    setTool(state().player?'target':'player');loadSelected();fitRegion();persistPresets();
  }
  function landmarkSelection(){if(!selections.has(world)){const data=MAP_LANDMARKS[world];const rotation=data.rotations.find(r=>data.zones.some(z=>z.rotation===r.id))||data.rotations[0];selections.set(world,{region:rotation.id,zone:data.zones.find(z=>z.rotation===rotation.id)?.id||''});}return selections.get(world);}
  function landmarkItems(){const data=MAP_LANDMARKS[world],choice=landmarkSelection(),region=data.rotations.find(r=>r.id===choice.region);return {bases:data.spawns.filter(b=>region.towns.includes(b.town)),zone:data.zones.find(z=>z.id===choice.zone)};}
  function landmarkControls(){const data=MAP_LANDMARKS[world],choice=landmarkSelection();$('region-select').replaceChildren(...data.rotations.map(r=>new Option(r.name,r.id)));$('region-select').value=choice.region;const zones=data.zones.filter(z=>z.rotation===choice.region);if(!zones.some(z=>z.id===choice.zone))choice.zone=zones[0]?.id||'';$('zone-select').replaceChildren(...(zones.length?zones.map(z=>new Option(z.name==='Default'?'Основная':z.name,z.id)):[new Option('Нет данных','')]));$('zone-select').value=choice.zone;$('zone-select').disabled=!zones.length;}
  const svgEl=(parent,tag,attrs)=>{const el=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);parent.append(el);return el;};
  function drawLandmarks(unit){
    const {bases,zone}=landmarkItems(),layer=$('terrain-landmarks');layer.replaceChildren();
    if(zone){const x=zone.pos[0]*1000,y=zone.pos[1]*1000,r=zone.radiusM/16384*1000;svgEl(layer,'circle',{class:'control-zone',cx:x,cy:y,r,fill:'#fff2dd14',stroke:'#fff2dd','stroke-width':1.5,'stroke-dasharray':'6 4','vector-effect':'non-scaling-stroke'});svgEl(layer,'text',{x,y:y-r-6*unit,'text-anchor':'middle','font-size':12*unit,'stroke-width':3*unit,class:'landmark-label'}).textContent='Зона · '+zone.radiusM+' м';}
    for(const b of bases){const x=b.pos[0]*1000,y=b.pos[1]*1000,color={manticore:'#57c05f',valkyra:'#ef5a4f',lonestar:'#4d9be0'}[b.faction];const g=svgEl(layer,'g',{class:'spawn-base','data-town':b.town});svgEl(g,'circle',{cx:x,cy:y,r:11*unit,fill:'#08090a',stroke:color,'stroke-width':2,'vector-effect':'non-scaling-stroke'});svgEl(g,'text',{x,y:y+4.5*unit,'text-anchor':'middle',fill:color,'font-size':13*unit,'font-weight':'bold','font-family':'Bahnschrift, sans-serif'}).textContent=b.faction[0].toUpperCase();svgEl(g,'text',{x,y:y+25*unit,'text-anchor':'middle','font-size':12*unit,'stroke-width':3*unit,class:'landmark-label'}).textContent=b.town;}
  }
  // Grid adapts to zoom (10 → 1 unit = 1 km → 100 m); labels stay on the visible edges.
  function drawGrid(){
    const layer=$('terrain-grid'),unit=view.size/(svg.clientWidth||500),span=view.size/1000*MAP_EXTENT,step=span>70?10:span>30?5:span>12?2:1;
    const x0=view.x/1000*MAP_EXTENT,x1=(view.x+view.size)/1000*MAP_EXTENT,y0=(1-(view.y+view.size)/1000)*MAP_EXTENT,y1=(1-view.y/1000)*MAP_EXTENT;
    layer.replaceChildren();
    for(let c=Math.max(step,Math.ceil(x0/step)*step);c<Math.min(x1,MAP_EXTENT);c+=step){const x=c/MAP_EXTENT*1000,major=c%10===0?'major':'';svgEl(layer,'line',{x1:x,y1:0,x2:x,y2:1000,class:major});if(x-view.x>24*unit)svgEl(layer,'text',{x:x+3*unit,y:view.y+12*unit,'font-size':10*unit,'stroke-width':3*unit}).textContent=c;}
    for(let c=Math.max(step,Math.ceil(y0/step)*step);c<Math.min(y1,MAP_EXTENT);c+=step){const y=(1-c/MAP_EXTENT)*1000,major=c%10===0?'major':'';svgEl(layer,'line',{x1:0,y1:y,x2:1000,y2:y,class:major});if(y-view.y>24*unit)svgEl(layer,'text',{x:view.x+4*unit,y:y-3*unit,'font-size':10*unit,'stroke-width':3*unit}).textContent=c;}
  }
  function fitRegion(){const {bases,zone}=landmarkItems();const pts=bases.map(b=>({x:b.pos[0]*1000,y:b.pos[1]*1000}));if(zone){const r=zone.radiusM/16384*1000;pts.push({x:zone.pos[0]*1000-r,y:zone.pos[1]*1000-r},{x:zone.pos[0]*1000+r,y:zone.pos[1]*1000+r});}if(!pts.length)return;const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),size=Math.min(1000,Math.max(150,Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))*1.25));view={x:(Math.min(...xs)+Math.max(...xs)-size)/2,y:(Math.min(...ys)+Math.max(...ys)-size)/2,size};updateView();}
  $('fit-region').onclick=fitRegion;$('region-select').onchange=()=>switchPreset(()=>{landmarkSelection().region=$('region-select').value;});$('zone-select').onchange=()=>switchPreset(()=>{landmarkSelection().zone=$('zone-select').value;});

  // Undo: snapshots of the current preset before every change of points.
  function remember(){saveForm();const key=presetKey();if(!undoStacks.has(key))undoStacks.set(key,[]);const stack=undoStacks.get(key);stack.push(JSON.stringify(state()));if(stack.length>50)stack.shift();}
  function undo(){const key=presetKey(),stack=undoStacks.get(key);if(!stack?.length){toast('Нечего отменять');return;}worlds.set(key,JSON.parse(stack.pop()));$('map-error').textContent='';loadSelected();setTool(state().player?(tool==='player'?'target':tool):'player');toast('Отменено');}
  function toast(text,undoable=false){$('toast-text').textContent=text;$('toast-undo').hidden=!undoable;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},undoable?6000:2200);}
  $('toast-undo').onclick=undo;

  function removeTarget(id){remember();const s=state();s.targets=s.targets.filter(t=>t.id!==id);if(s.selected===id)s.selected=s.targets[0]?.id??null;loadSelected();toast(`Цель ${id} удалена`,true);}
  // First click selects a pin, a click on the selected pin removes it (Ctrl+Z brings it back).
  function markerClick(e,id){e.stopPropagation();if(state().selected===id)removeTarget(id);else choose(id);}
  function resetShots(){const s=state();for(const t of s.targets){t.distance=s.player?range(s.player,t.point).toFixed(2):'';t.hit='';t.previousAim='';t.shots=0;t.origin=originKey(s.player);}}
  function resetCorrection(){const s=state(),t=selected();if(!t?.hit)return;remember();t.hit='';t.previousAim='';t.shots=0;t.distance=s.player?range(s.player,t.point).toFixed(2):'';loadSelected();toast(`Поправка цели ${t.id} сброшена`,true);}
  $('reset-correction').onclick=resetCorrection;
  function solution(t){const s=state();if(!s.player||!t)return null;try{return t.hit?calculateShot(s.player,t.point,parseCoordinate(t.hit),(t.distance?.trim()?Number(t.distance.replace(',','.')):null),t.previousAim?parseCoordinate(t.previousAim):t.point):{aim:t.point,distance:Number(String(t.distance||'').replace(',','.'))||range(s.player,t.point)};}catch{return null;}}
  // What to dial in the game for this target: corrected azimuth/range once an impact is marked.
  function fire(t){
    const s=state();if(!s.player||!t)return null;
    const result=solution(t);if(!result)return {error:true};
    const corrected=Boolean(t.hit),base=azimuth(s.player,t.point),az=corrected?azimuth(s.player,result.aim):base;
    return {corrected,azimuth:az,delta:corrected&&az!==null&&base!==null?(az-base+540)%360-180:0,range:result.distance,coefficient:result.coefficient,hitDistance:result.hitDistance,targetDistance:range(s.player,t.point),aim:result.aim,shots:t.shots||(corrected?1:0)};
  }
  const state=()=>{const key=presetKey();if(!worlds.has(key))worlds.set(key,{player:null,targets:[],selected:null,next:1});return worlds.get(key);};
  const selected=()=>state().targets.find(t=>t.id===state().selected);
  const pointText=p=>`x${p.x.toFixed(2)}, y${p.y.toFixed(2)}`;
  const display=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n);
  const metres=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(n)+' м';
  const range=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y)*100;
  const signed=n=>(n>0?'+':n<0?'−':'')+display(Math.abs(Math.round(n*10)/10))+'°';
  const rangeText=f=>f.range===null?'× '+display(f.coefficient):metres(f.range);
  function setField(id,value){$(id).value=value;$(id).dispatchEvent(new Event('input',{bubbles:true}));}
  function changeTab(map){$('map-workspace').hidden=!map;$('calculator-workspace').hidden=map;$('maps-tab').setAttribute('aria-pressed',String(map));$('calculator-tab').setAttribute('aria-pressed',String(!map));if(storageReady){ui.tab=map?'map':'calc';saveUi();}if(map){syncFromForm();requestAnimationFrame(renderMap);}}
  $('maps-tab').onclick=()=>changeTab(true);$('calculator-tab').onclick=()=>changeTab(false);
  const toolText={player:['Моя позиция','↵ Позиция'],target:['новая цель','↵ Цель'],hit:['разрыв выбранной цели','↵ Разрыв']};
  function setTool(value){tool=value;svg.dataset.tool=tool;document.querySelectorAll('[data-map-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mapTool===tool)));$('map-coordinate-label').textContent='Вставить координаты → '+toolText[tool][0].toLowerCase();$('place-coordinate').textContent=toolText[tool][1];renderBrief();}
  document.querySelectorAll('[data-map-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.mapTool));
  const originKey=p=>p?`${p.x},${p.y}`:null;
  $('player').addEventListener('input',e=>{
    if(!e.isTrusted||!state().player)return;
    try{if(originKey(parseCoordinate($('player').value))===originKey(state().player))return;}catch{}
    for(const t of state().targets){t.distance='';t.hit='';t.previousAim='';t.shots=0;t.origin=null;}
    for(const id of ['hit','previous-aim','distance'])setField(id,'');
  });
  function saveForm(){const t=selected();if(!t)return;t.distance=$('distance').value;t.hit=$('hit').value;t.previousAim=$('previous-aim').value;if(!t.hit)t.shots=0;try{t.origin=originKey(parseCoordinate($('player').value));}catch{t.origin=null;}}
  function loadSelected(){
    const s=state(),t=selected();
    if(t&&t.origin!==originKey(s.player)){t.distance='';t.hit='';t.previousAim='';t.shots=0;}
    if(s.player)setField('player',pointText(s.player));else setField('player','');
    setField('target',t?pointText(t.point):'');setField('hit',t?.hit||'');setField('previous-aim',t?.previousAim||'');setField('distance',t?.distance||'');
    if(s.player&&t){
      const savedDistance=t.distance;
      $('calculate-distance').click();
      if(savedDistance){$('distance').value=savedDistance;if(!t.hit){$('distance-value').textContent=display(Number(savedDistance.replace(',','.')))+' м';$('distance-note').textContent='Базовая дальность выбранной цели. После выстрела укажи разрыв для поправки.';}}
      t.distance=$('distance').value;
      t.origin=originKey(s.player);
      if(t.hit)$('shot-form').requestSubmit();
    }
    render();
  }
  function choose(id){saveForm();state().selected=id;loadSelected();}
  function place(point){
    $('map-error').textContent='';
    if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.y<0||point.x>MAP_EXTENT||point.y>MAP_EXTENT){$('map-error').textContent='Координаты карты должны быть от 0 до 163,84.';return;}
    point={x:Number(point.x.toFixed(2)),y:Number(point.y.toFixed(2))};
    const s=state();saveForm();
    if(tool==='player'){remember();s.player=point;resetShots();setTool('target');}
    else if(tool==='target'){remember();const id=s.next++;s.targets.push({id,point,distance:'',hit:'',previousAim:'',shots:0});s.selected=id;}
    else if(tool==='hit'){
      const t=selected();
      if(!t){$('map-error').textContent='Сначала выбери цель в списке или на карте.';return;}
      if(!s.player||!t.distance){$('map-error').textContent='Сначала задай свою позицию.';return;}
      remember();
      // A new impact after a correction was fired with the corrected range and aim: chain from them.
      const previous=t.hit?solution(t):null;
      if(previous&&previous.distance!==null){t.distance=previous.distance.toFixed(2);t.previousAim=pointText(previous.aim);t.shots=(t.shots||1)+1;}else t.shots=1;
      t.hit=pointText(point);
    }
    else{$('map-error').textContent='Выбери инструмент точки.';return;}
    loadSelected();
  }
  function render(){renderList();renderSolution();renderBrief();renderMap();persistPresets();}
  function renderBrief(){
    const s=state(),t=selected();let step='',text,done=false;
    if(!s.player)[step,text]=['1/3',tool==='player'?'Поставь свою позицию: <b>ЛКМ</b> по карте или вставь координаты справа':'Сначала поставь свою позицию: инструмент <b>Я</b> (G)'];
    else if(tool==='player')text='<b>ЛКМ</b> по карте переставит твою позицию. Цели сохранятся, поправки сбросятся';
    else if(!s.targets.length)[step,text]=['2/3','Отметь цель: <b>ЛКМ</b> по карте'];
    else if(!t)text='Выбери цель в списке, на карте или клавишами <b>1–9</b>';
    else if(tool==='hit')text=`<b>ЛКМ</b> или <b>ПКМ</b> — место разрыва для цели ${t.id}`;
    else if(!t.hit)[step,text]=['3/3',`Выстрели с азимутом и дальностью цели ${t.id}, затем <b>ПКМ</b> по месту разрыва`];
    else [step,text,done]=['✓',`Поправка готова. Стреляй с новыми значениями, новый разрыв — снова <b>ПКМ</b>`,true];
    $('brief-step').hidden=!step;$('brief-step').textContent=step;$('map-brief').classList.toggle('done',done);$('map-help').innerHTML=text;
  }
  function renderSolution(){
    const s=state(),t=selected(),f=fire(t),box=$('fire-solution'),meta=$('fs-meta'),valid=f&&!f.error;
    box.classList.toggle('empty',!valid);$('fs-target').textContent=t?'Цель '+t.id:'Цель —';
    $('fs-azimuth').textContent=valid?formatAzimuth(f.azimuth):'—';$('fs-range').textContent=valid?rangeText(f):'—';
    $('fs-tag').hidden=!valid||!f.corrected;$('fs-tag').textContent=valid&&f.shots>1?'Поправка · '+f.shots:'Поправка';
    $('reset-correction').hidden=!t?.hit;
    meta.replaceChildren();
    const add=(label,value,cls)=>{const span=document.createElement('span');if(cls)span.className=cls;const b=document.createElement('b');b.textContent=value;span.append(label+' ',b);meta.append(span);};
    if(!s.player)meta.textContent='Нет позиции. Инструмент «Я» (G) и ЛКМ по карте.';
    else if(!t)meta.textContent=s.targets.length?'Выбери цель в списке или на карте.':'Отметь цель на карте: инструмент «Цель» (T).';
    else if(!valid)meta.textContent='Проверь разрыв и дальность в ручном расчёте.';
    else{add('до цели',metres(f.targetDistance));if(f.corrected){add('разрыв',metres(f.hitDistance));add('K','×'+display(f.coefficient),'aim');add('Δ аз',signed(f.delta),'aim');}}
  }
  function renderList(){
    const s=state(),t=selected(),list=$('target-list');
    $('target-count').textContent=s.targets.length;$('map-player-label').textContent=s.player?pointText(s.player):'не задана';$('map-player-label').classList.toggle('unset',!s.player);
    list.replaceChildren();
    const span=(cls,text)=>{const el=document.createElement('span');el.className=cls;el.textContent=text;return el;};
    for(const target of s.targets){
      const f=fire(target),valid=f&&!f.error;
      const row=document.createElement('div');row.className='target-row';row.dataset.targetId=target.id;
      if(t===target)row.classList.add('selected');if(target.hit)row.classList.add('corrected');
      const b=document.createElement('button');b.type='button';b.className='target-select';b.setAttribute('aria-pressed',String(t===target));b.title='Выбрать цель · '+(s.targets.indexOf(target)<9?s.targets.indexOf(target)+1:'клик');
      const name=document.createElement('strong');name.textContent=target.id;name.className='card-number';
      const direction=span('target-azimuth',valid?formatAzimuth(f.azimuth):'—');direction.title='Азимут от своей позиции: 0° — север (+Y), 90° — восток (+X)';
      const power=span('target-power',valid?rangeText(f):'—');power.title=target.hit?'Дальность с поправкой':'Дальность до цели';
      const detail=document.createElement('span');detail.className='target-detail';
      detail.append(span('card-coords',pointText(target.point)),span('card-range',s.player?'до цели '+metres(range(s.player,target.point)):'нет позиции'));
      if(target.hit&&valid){const k=span('target-coefficient','K ×'+display(f.coefficient));k.title='Коэффициент дальности этой цели';detail.append(k,span('card-shots','выстрел '+f.shots));}
      else if(target.hit)detail.append(span('card-error','проверь разрыв'));
      b.append(name,direction,power,detail);b.onclick=()=>choose(target.id);
      const remove=document.createElement('button');remove.type='button';remove.className='target-remove';remove.textContent='×';remove.title='Удалить · Del';remove.setAttribute('aria-label','Удалить цель '+target.id);remove.onclick=()=>removeTarget(target.id);
      row.append(b,remove);list.append(row);
    }
    const activeRow=list.querySelector('.selected');if(activeRow&&list.scrollHeight>list.clientHeight){const rowBounds=activeRow.getBoundingClientRect(),listBounds=list.getBoundingClientRect();if(rowBounds.bottom>listBounds.bottom)list.scrollTop+=rowBounds.bottom-listBounds.bottom;else if(rowBounds.top<listBounds.top)list.scrollTop-=listBounds.top-rowBounds.top;}
  }
  function renderMap(){
    if(!svg.clientWidth)return;
    const unit=view.size/svg.clientWidth,s=state(),t=selected(),f=fire(t),markers=$('terrain-markers');
    drawnSize=view.size;drawLandmarks(unit);drawGrid();markers.replaceChildren();
    const line=(a,b,attrs)=>{const p=coordToMap(a),q=coordToMap(b);svgEl(markers,'line',{x1:p.x,y1:p.y,x2:q.x,y2:q.y,'vector-effect':'non-scaling-stroke','pointer-events':'none',...attrs});};
    const pin=(p,label,{stroke,fill='#08090a',text=stroke,id=null,glyph=11})=>{const q=coordToMap(p),g=svgEl(markers,'g',{class:'map-pin','data-marker':id?'Цель '+id:label});svgEl(g,'circle',{cx:q.x,cy:q.y,r:11*unit,fill,stroke,'stroke-width':1.5,'vector-effect':'non-scaling-stroke'});svgEl(g,'text',{x:q.x,y:q.y,'text-anchor':'middle','dominant-baseline':'central',fill:text,'font-size':glyph*unit}).textContent=label;return g;};
    let hit=null;if(t?.hit){try{hit=parseCoordinate(t.hit);}catch{}}
    if(s.player){
      for(const target of s.targets)if(target!==t)line(s.player,target.point,{stroke:'#fff2dd','stroke-opacity':.5,'stroke-width':1});
      if(t)line(s.player,t.point,{stroke:'#ffd24a','stroke-width':2});
      if(t&&hit)line(t.point,hit,{stroke:'#ff6a3d','stroke-width':1.5,'stroke-dasharray':'4 3'});
      if(f?.corrected&&f.aim)line(s.player,f.aim,{stroke:'#c9a7ff','stroke-width':1.5,'stroke-dasharray':'6 5'});
    }
    if(t){const q=coordToMap(t.point);svgEl(markers,'circle',{class:'pin-halo',cx:q.x,cy:q.y,r:17*unit,fill:'none',stroke:'#ffd24a','stroke-width':1,'stroke-opacity':.7,'vector-effect':'non-scaling-stroke','pointer-events':'none'});}
    for(const target of s.targets){const g=pin(target.point,String(target.id),{stroke:target===t?'#ffd24a':'#fff2dd',id:target.id});const hint=target===t?'Удалить цель '+target.id:'Выбрать цель '+target.id;g.setAttribute('role','button');g.setAttribute('aria-label',hint);svgEl(g,'title',{}).textContent=target===t?hint+' · клик ещё раз':hint;g.onclick=e=>markerClick(e,target.id);}
    if(s.player){const g=pin(s.player,'Я',{stroke:'#08090a',fill:'#fff2dd',text:'#141310'});g.setAttribute('role','button');g.setAttribute('aria-label','Переставить мою позицию');g.onclick=e=>{e.stopPropagation();setTool('player');};}
    if(f?.corrected&&f.aim)pin(f.aim,'+',{stroke:'#c9a7ff',glyph:17}).style.pointerEvents='none';
    if(hit)pin(hit,'×',{stroke:'#ff6a3d',glyph:17}).style.pointerEvents='none';
    if(t&&f&&!f.error){const q=coordToMap(t.point);svgEl(markers,'text',{class:'pin-label',x:q.x+19*unit,y:q.y+4*unit,fill:'#ffd24a','font-size':12*unit,'stroke-width':3*unit}).textContent=formatAzimuth(f.azimuth)+' · '+rangeText(f);}
  }
  function syncFromForm(){
    const s=state();try{s.player=parseCoordinate($('player').value);}catch{s.player=null;}
    try{const p=parseCoordinate($('target').value);let t=selected();if(!t){t={id:s.next++,point:p,shots:0};s.targets.push(t);s.selected=t.id;}t.point=p;saveForm();}catch{}
    render();
  }
  $('open-correction').onclick=()=>changeTab(false);
  $('place-coordinate').onclick=()=>{try{place(parseCoordinate($('map-coordinate').value));}catch(e){$('map-error').textContent=e.message;}};
  $('map-coordinate').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('place-coordinate').click();}});
  $('terrain-select').onchange=()=>switchPreset(()=>{world=$('terrain-select').value;$('terrain-image').setAttribute('href',`maps/${world}.webp`);});
  // Panning keeps the pin scale, so only the grid labels follow; zoom redraws the markers.
  function updateView(){view.x=Math.max(0,Math.min(1000-view.size,view.x));view.y=Math.max(0,Math.min(1000-view.size,view.y));svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.size} ${view.size}`);if(view.size!==drawnSize)renderMap();else drawGrid();}
  function location(e){const rect=svg.getBoundingClientRect();return{x:view.x+(e.clientX-rect.left)/rect.width*view.size,y:view.y+(e.clientY-rect.top)/rect.height*view.size};}
  function zoom(factor,anchor={x:view.x+view.size/2,y:view.y+view.size/2}){const next=Math.max(40,Math.min(1000,view.size*factor)),ratio=next/view.size;view.x=anchor.x-(anchor.x-view.x)*ratio;view.y=anchor.y-(anchor.y-view.y)*ratio;view.size=next;updateView();}
  const resetView=()=>{view={x:0,y:0,size:1000};updateView();};
  $('zoom-in').onclick=()=>zoom(.7);$('zoom-out').onclick=()=>zoom(1/.7);$('reset-map').onclick=resetView;
  svg.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?.85:1/.85,location(e));},{passive:false});
  svg.addEventListener('contextmenu',e=>{e.preventDefault();if(suppressClick)return;const previous=tool;tool='hit';place(mapToCoord(location(e)));tool=previous;renderBrief();});
  svg.addEventListener('pointerdown',e=>{if(e.button<=2){suppressClick=false;drag={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y,moved:false};}});
  svg.addEventListener('pointermove',e=>{const p=mapToCoord(location(e));$('cursor-coords').textContent=`X ${p.x.toFixed(2)} · Y ${p.y.toFixed(2)}`;if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>5){drag.moved=true;suppressClick=true;svg.setPointerCapture(e.pointerId);svg.classList.add('panning');}if(drag.moved){const rect=svg.getBoundingClientRect();view.x=drag.vx-dx/rect.width*view.size;view.y=drag.vy-dy/rect.height*view.size;updateView();}}});
  svg.addEventListener('pointerleave',()=>{if(!drag)$('cursor-coords').textContent='X — · Y —';});
  svg.addEventListener('pointerup',e=>{if(drag){drag=null;svg.classList.remove('panning');if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);}});
  svg.addEventListener('pointercancel',()=>{drag=null;svg.classList.remove('panning');});
  svg.addEventListener('click',e=>{if(suppressClick){e.stopImmediatePropagation();suppressClick=false;return;}},true);
  svg.addEventListener('click',e=>{if(!e.target.closest('.map-pin')){place(mapToCoord(location(e)));}});
  restorePresets();landmarkControls();$('terrain-select').value=world;$('terrain-image').setAttribute('href',`maps/${world}.webp`);
  storageReady=true;setTool(state().player?'target':'player');loadSelected();
  $('shot-form').addEventListener('input',e=>{if(e.isTrusted)queueMicrotask(syncFromForm);});
  window.addEventListener('beforeunload',()=>{saveForm();persistPresets();});
  const narrow=matchMedia('(max-width: 760px)');let manualCompact=ui.compact===true;
  function compactMode(){const enabled=narrow.matches||manualCompact;document.body.classList.toggle('compact-map',enabled);$('compact-toggle').setAttribute('aria-pressed',String(enabled));$('compact-toggle').textContent=narrow.matches?'Компактно · авто':manualCompact?'Полный вид':'Компактно';$('compact-toggle').disabled=narrow.matches;if(enabled)changeTab(true);requestAnimationFrame(renderMap);}
  $('compact-toggle').onclick=()=>{manualCompact=!manualCompact;ui.compact=manualCompact;saveUi();compactMode();};narrow.addEventListener('change',compactMode);
  changeTab(ui.tab!=='calc');compactMode();
  new ResizeObserver(()=>{requestAnimationFrame(renderMap);}).observe(svg);
  // Physical key codes: hotkeys work on the Russian layout too.
  document.addEventListener('keydown',e=>{
    if($('map-workspace').hidden||e.altKey||e.metaKey||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable)return;
    const code=e.code,tools={KeyG:'player',KeyT:'target',KeyH:'hit'};
    if(e.ctrlKey){if(code==='KeyZ'){e.preventDefault();undo();}return;}
    if(tools[code]){e.preventDefault();setTool(tools[code]);}
    else if(/^(Digit|Numpad)[1-9]$/.test(code)){const t=state().targets[Number(code.slice(-1))-1];if(t){e.preventDefault();choose(t.id);}}
    else if(code==='Delete'){const t=selected();if(t){e.preventDefault();removeTarget(t.id);}}
    else if(code==='KeyF'){e.preventDefault();fitRegion();}
    else if(code==='KeyR'){e.preventDefault();resetView();}
    else if(code==='Equal'||code==='NumpadAdd'){e.preventDefault();zoom(.7);}
    else if(code==='Minus'||code==='NumpadSubtract'){e.preventDefault();zoom(1/.7);}
  });
}
