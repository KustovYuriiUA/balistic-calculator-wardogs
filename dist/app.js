'use strict';
function parseCoordinate(text) {
  const value = String(text).trim().replace(/−/g, '-');
  const number = '[+-]?(?:\\d+(?:[.,]\\d+)?|[.,]\\d+)';
  const normalize = v => Number(v.replace(',', '.'));
  const tagged = [...value.matchAll(new RegExp('([xyху])\\s*[:=]?\\s*(' + number + ')', 'gi'))];
  let point;
  if (tagged.length) {
    const rest = value.replace(new RegExp('([xyху])\\s*[:=]?\\s*(' + number + ')', 'gi'), '').replace(/[\s,;()[\]{}]/g, '');
    const entries = tagged.map(m => [/[xх]/i.test(m[1]) ? 'x' : 'y', normalize(m[2])]);
    if (rest || entries.length !== 2 || entries[0][0] === entries[1][0]) throw new Error('Нужны две координаты: Y102 X88.');
    point = Object.fromEntries(entries);
  } else {
    const clean = value.replace(/^[([\s]+|[)\]\s]+$/g, '');
    const match = clean.match(new RegExp('^(' + number + ')(?:\\s*[;]\\s*|\\s+|,\\s+)(' + number + ')$'));
    if (!match) throw new Error('Вставь Y102 X88 или два числа: 102 88.');
    point = { y: normalize(match[1]), x: normalize(match[2]) };
  }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.max(Math.abs(point.x), Math.abs(point.y)) > 1e9) throw new Error('Координаты должны быть конечными числами до 1 млрд.');
  return point;
}
function calculateShot(player, target, hit, distance, previousAim = target) {
  const length = p => Math.hypot(p.x - player.x, p.y - player.y);
  const targetLength = length(target), hitLength = length(hit);
  if (targetLength < 1e-9) throw new Error('Твоя позиция совпадает с целью. Проверь координаты.');
  if (hitLength < 1e-9) throw new Error('Разрыв совпадает с твоей позицией: невозможно определить дальность и направление.');
  if (length(previousAim) < 1e-9) throw new Error('Точка прицеливания не может совпадать с твоей позицией.');
  if (distance !== null && (!Number.isFinite(distance) || distance <= 0)) throw new Error('Выставленная дальность должна быть больше нуля.');
  const bearing = p => Math.atan2(p.x - player.x, p.y - player.y);
  const angle = bearing(target) - (bearing(hit) - bearing(previousAim));
  const coefficient = targetLength / hitLength;
  const result = {aim: {y: player.y + targetLength * Math.cos(angle), x: player.x + targetLength * Math.sin(angle)}, targetDistance:targetLength * 100, hitDistance:hitLength * 100, coefficient, distance:distance === null ? null : distance * coefficient};
  if (result.distance !== null && !Number.isFinite(result.distance)) throw new Error('Слишком большая дальность. Проверь значение.');
  return result;
}
if (typeof module !== 'undefined') module.exports = {parseCoordinate, calculateShot};
if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id);
  if(window.overlay){document.body.classList.add('desktop');$('window-bar').hidden=false;$('hide-overlay').addEventListener('click',()=>window.overlay.hide());$('quit-overlay').addEventListener('click',()=>window.overlay.quit());$('view-overlay').addEventListener('click',()=>window.overlay.view());window.overlay.onMode(mode=>{const view=mode==='view';document.body.classList.toggle('view-only',view);$('overlay-mode').textContent=view?'Просмотр':'Редактирование';$('overlay-hint').innerHTML=view?'<kbd>Insert</kbd> редактировать':'<kbd>Insert</kbd> или <kbd>Esc</kbd> — в игру';});}
  const fields = ['player', 'target', 'hit', 'distance', 'previous-aim'];
  const fmt = n => new Intl.NumberFormat('ru-RU', {maximumFractionDigits:2}).format(Math.abs(n) < .00001 ? 0 : n);
  let last = null;
  let automaticBase = false;
  function calculateBase() {
    invalidate();
    $('base-status').textContent='';$('form-error').textContent='';
    const points={};let invalid=null;
    for(const id of ['player','target']) {
      $(id+'-error').textContent='';$(id).removeAttribute('aria-invalid');
      try {points[id]=parseCoordinate($(id).value);}catch(e){$(id+'-error').textContent=e.message;$(id).setAttribute('aria-invalid','true');invalid ||= id;}
    }
    if(invalid){$(invalid).focus();return;}
    const metres=Math.hypot(points.target.x-points.player.x,points.target.y-points.player.y)*100;
    if(metres<0.005){$('target-error').textContent='Позиция и цель совпадают или расстояние меньше 0,01 м. Проверь координаты.';$('target').setAttribute('aria-invalid','true');return;}
    $('distance').value=metres.toFixed(2);
    $('distance-error').textContent='';$('distance').removeAttribute('aria-invalid');
    automaticBase=true;
    $('base-status').textContent=`До цели ${fmt(metres)} м. Сохранено как дальность пробного выстрела.`;
    $('status').textContent='Дальность готова';
    last={aim:points.target,distance:Number(metres.toFixed(2)),targetDistance:metres};
    $('aim-value').textContent=`Y ${fmt(points.target.y)}   X ${fmt(points.target.x)}`;
    $('aim-azimuth').textContent=formatAzimuth(azimuth(points.player,last.aim));
    $('distance-value').textContent=`${fmt(last.distance)} м`;
    $('distance-note').textContent='Пробный выстрел: целься в цель с этой дальностью. После выстрела укажи разрыв для поправки.';
    $('target-distance').textContent=fmt(metres)+' м';
    $('hit-distance').textContent='—';$('coefficient').textContent='—';
    $('empty').hidden=true;$('result').hidden=false;$('copy').textContent='Копировать';
    draw({player:points.player,target:points.target});
  }
  function invalidate() {
    last = null; $('result').hidden = true; $('empty').hidden = false;
    $('status').textContent = 'Ждём расчёта'; $('status').className = 'badge';
    $('map').innerHTML = '<text x="260" y="150" text-anchor="middle" fill="#6b7580" font-size="15">Рассчитай обновлённые координаты</text>';
  }
  function draw(points) {
    const values = Object.values(points), xs = values.map(p=>p.x), ys = values.map(p=>p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min(380 / Math.max(maxX-minX,1e-9),190 / Math.max(maxY-minY,1e-9));
    const map = p => ({x:260+(p.x-(minX+maxX)/2)*scale,y:145-(p.y-(minY+maxY)/2)*scale});
    const origin = map(points.player), colors = {player:'#fff2dd',target:'#ffd24a',hit:'#ff6a3d',aim:'#c9a7ff'};
    const labels = {player:'Я',target:'Цель',hit:'Разрыв',aim:'Прицел'};
    const offsets={player:[12,22],target:[12,-16],hit:[12,24],aim:[12,-32]};
    let svg = '';
    for (const key of ['target','hit','aim'].filter(key=>points[key])) {const p=map(points[key]);svg+=`<line x1="${origin.x}" y1="${origin.y}" x2="${p.x}" y2="${p.y}" stroke="${colors[key]}" stroke-width="1.5" opacity=".65" ${key==='aim'?'stroke-dasharray="6 6"':''}/>`;}
    for (const [key,point] of Object.entries(points)) {const p=map(point),[dx,dy]=offsets[key];svg+=`<circle cx="${p.x}" cy="${p.y}" r="${key==='target'?9:5}" fill="${key==='target'?'#08090a':colors[key]}" stroke="${colors[key]}" stroke-width="2"/><text x="${p.x+dx}" y="${p.y+dy}" fill="${colors[key]}" font-size="13" font-weight="600" font-family="Bahnschrift, Segoe UI, sans-serif">${labels[key]}</text>`;}
    $('map').innerHTML = svg;
  }
  function run() {
    for (const id of fields) {$(id+'-error').textContent='';$(id).removeAttribute('aria-invalid');}
    $('form-error').textContent='';
    const points={};let invalid=null;
    for (const id of ['player','target','hit','previous-aim']) {
      if (id==='previous-aim' && !$(id).value.trim()) continue;
      try {points[id]=parseCoordinate($(id).value);} catch(e) {$(id+'-error').textContent=e.message;$(id).setAttribute('aria-invalid','true');invalid ||= id;}
    }
    const raw=$('distance').value.trim(), distance=raw ? Number(raw.replace(/\s/g,'').replace(',','.')) : null;
    if (raw && (!/^[+]?\d+(?:[.,]\d+)?$/.test(raw.replace(/\s/g,'')) || !Number.isFinite(distance) || distance<=0)) {$('distance-error').textContent='Введи положительное число в метрах.';$('distance').setAttribute('aria-invalid','true');invalid ||= 'distance';}
    if (invalid) {invalidate();if(invalid==='previous-aim') $('aim-details').open=true;$(invalid).focus();return null;}
    try {
      last=calculateShot(points.player,points.target,points.hit,distance,points['previous-aim'] || points.target);
      $('aim-value').textContent=`Y ${fmt(last.aim.y)}   X ${fmt(last.aim.x)}`;
      $('aim-azimuth').textContent=formatAzimuth(azimuth(points.player,last.aim));
      $('distance-value').textContent=last.distance===null?`× ${fmt(last.coefficient)}`:`${fmt(last.distance)} м`;
      $('distance-note').textContent=last.distance===null?'Прежняя дальность × коэффициент. Введи выставленную дальность, чтобы получить метры.':`Предыдущая настройка ${fmt(distance)} м × ${fmt(last.coefficient)}. Коэффициент применяется без округления.`;
      $('target-distance').textContent=fmt(last.targetDistance)+' м';$('hit-distance').textContent=fmt(last.hitDistance)+' м';$('coefficient').textContent='× '+fmt(last.coefficient);
      $('empty').hidden=true;$('result').hidden=false;$('status').textContent='Оценка готова';$('status').className='badge ready';$('copy').textContent='Копировать';
      draw({player:points.player,target:points.target,hit:points.hit,aim:last.aim});return last;
    } catch(e) {invalidate();$('form-error').textContent=e.message;return null;}
  }
  $('shot-form').addEventListener('submit', e=>{e.preventDefault();run();});
  $('calculate-distance').addEventListener('click',calculateBase);
  for(const id of ['player','target']) $(id).addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();calculateBase();}});
  for(const id of fields) $(id).addEventListener('input',()=>{
    invalidate();$(id+'-error').textContent='';$(id).removeAttribute('aria-invalid');$('form-error').textContent='';
    if(id==='player'||id==='target'){
      if(automaticBase){$('distance').value='';automaticBase=false;}
      $('base-status').textContent='';
    }
    if(id==='distance'){automaticBase=false;$('base-status').textContent='';}
  });
  $('example').addEventListener('click',()=>{$('player').value='Y102 X88';$('target').value='Y80 X72';$('hit').value='Y93 X80';$('distance').value='2720,29';$('previous-aim').value='';run();});
  $('copy').addEventListener('click',async()=>{
    if(!last)return;
    const coordinate=`Y${last.aim.y.toFixed(2)} X${last.aim.x.toFixed(2)}`;
    try{if(window.overlay)await window.overlay.copyCoordinates(coordinate);else await navigator.clipboard.writeText(coordinate);$('copy').textContent='Скопировано';}
    catch{const range=document.createRange();range.selectNodeContents($('aim-value'));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);$('copy').textContent='Нажми Ctrl+C';}
  });
  if(document.modelContext?.registerTool) {
    const lifecycle=new AbortController();
    try {Promise.resolve(document.modelContext.registerTool({name:'calculate_basketball_shot',title:'Рассчитать поправку броска',description:'Заполнить координаты и рассчитать точку прицеливания и дальность на странице.',inputSchema:{type:'object',properties:{player:{type:'string'},target:{type:'string'},hit:{type:'string'},distance:{type:'number',exclusiveMinimum:0},previousAim:{type:'string'}},required:['player','target','hit'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){
      if(!input || typeof input!=='object')throw new Error('Ожидаются данные броска.');
      for(const key of ['player','target','hit'])if(typeof input[key]!=='string')throw new Error('Нужны координаты '+key);
      if(input.previousAim!==undefined&&typeof input.previousAim!=='string')throw new Error('Точка прицеливания должна быть строкой.');
      const p=parseCoordinate(input.player),t=parseCoordinate(input.target),h=parseCoordinate(input.hit),a=input.previousAim?parseCoordinate(input.previousAim):t;
      calculateShot(p,t,h,input.distance??null,a);
      $('player').value=input.player;$('target').value=input.target;$('hit').value=input.hit;$('distance').value=input.distance??'';$('previous-aim').value=input.previousAim??'';
      return run();
    }},{signal:lifecycle.signal})).catch(()=>{});}catch{}
    window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  }
}
