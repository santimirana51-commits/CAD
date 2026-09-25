/* Bounded, reversible production of coordination bases and native symbols. */
(function(root){
 'use strict';
 const fail=s=>{throw Error(s)},clone=x=>JSON.parse(JSON.stringify(x)),pt=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
 const symbols={
  light:{name:'Ceiling light',layer:'E-LIGHT',lines:[[-.35,-.35,.35,.35],[-.35,.35,.35,-.35]],circle:true},
  switch:{name:'Light switch',layer:'E-SWITCH',text:'S',circle:true},
  outlet:{name:'Power outlet',layer:'E-POWER',lines:[[-.15,-.2,-.15,.2],[.15,-.2,.15,.2]],circle:true},
  data:{name:'Data outlet',layer:'E-DATA',text:'D',box:true},
  panel:{name:'Distribution panel',layer:'E-PANEL',lines:[[-.5,-.5,.5,.5]],box:true},
  heater:{name:'Water heater',layer:'E-EQPM',text:'WH',box:true},
  detector:{name:'Smoke detector',layer:'E-FIRE',text:'SD',circle:true},
  emergency_light:{name:'Emergency light',layer:'E-EMRG',text:'EL',box:true},
  supply_air:{name:'Supply air terminal',layer:'M-AIR-SUP',lines:[[-.5,-.5,.5,.5],[-.5,.5,.5,-.5]],box:true},
  return_air:{name:'Return air terminal',layer:'M-AIR-RET',lines:[[-.5,-.25,.5,-.25],[-.5,0,.5,0],[-.5,.25,.5,.25]],box:true},
  drain:{name:'Floor drain',layer:'P-DRAIN',lines:[[-.5,-.5,.5,.5],[-.5,.5,.5,-.5]],box:true},
  level:{name:'Level marker',layer:'A-ANNO-LEVEL',lines:[[-.5,0,.5,0],[-.3,.3,0,0],[0,0,.3,.3],[-.3,.3,.3,.3]]},
  section_mark:{name:'Section reference',layer:'A-ANNO-SECT',lines:[[0,-.5,0,-1],[0,-1,.7,-1],[.7,-1,.4,-.8],[.7,-1,.4,-1.2]],circle:true},
  detail_mark:{name:'Detail reference',layer:'A-ANNO-DETL',circle:true},
 };
 const catalogue=()=>Object.entries(symbols).map(([kind,s])=>({kind,name:s.name,layer:s.layer}));
 function drawSymbols(a){
  if(!Array.isArray(a.placements)||!a.placements.length||a.placements.length>60)fail('Place 1–60 symbols using explicit drawing coordinates and size.');
  const es=[],used=new Set(),add=(kind,p,size,rotation=0,label)=>{
   const s=symbols[kind];if(!s||!pt(p)||!Number.isFinite(size)||size<=0||size>1e6||!Number.isFinite(rotation))fail('Choose a listed symbol with finite position, positive size and rotation in degrees.');
   const t=rotation*Math.PI/180,c=Math.cos(t),n=Math.sin(t),P=(x,y)=>({x:p.x+size*(x*c-y*n),y:p.y+size*(x*n+y*c)}),layer=s.layer;
   for(const [x,y,X,Y]of s.lines||[])es.push({type:'line',a:P(x,y),b:P(X,Y),layer});
   if(s.circle)es.push({type:'circle',c:p,r:size*.5,layer});
   if(s.box)es.push({type:'polyline',pts:[P(-.5,-.5),P(.5,-.5),P(.5,.5),P(-.5,.5)],closed:true,layer});
   if(s.text)es.push({type:'text',p:P(-s.text.length*.12,-.14),str:s.text,h:size*.32,layer,rot:t});
   if(label){if(typeof label!=='string'||label.length>60)fail('Keep symbol labels under 60 characters.');es.push({type:'text',p:P(.7,-.12),str:label,h:size*.3,layer:'A-ANNO-TEXT'});}
  };
  for(const p of a.placements){add(p.kind,{x:p.x,y:p.y},p.size,p.rotation||0,p.label);used.add(p.kind);}
  if(a.legendOrigin){if(!pt(a.legendOrigin))fail('Supply a finite legend origin.');const size=a.placements[0].size;let i=0;for(const kind of used)add(kind,{x:a.legendOrigin.x,y:a.legendOrigin.y-i++*size*2},size,0,symbols[kind].name);}
  if(es.length>500)fail('Split the symbols into smaller batches.');return es;
 }
 function copyBase(N,a){
  if(!a.group&&!a.ids?.length)fail('Choose the inspected plan group or explicit IDs for the working copy.');
  if(!pt(a.origin))fail('Choose an empty destination origin for the working copy.');
  const wanted=a.ids&&new Set(a.ids.map(String)),source=N.doc.entities.filter(e=>!e.aisel&&(!a.group||e.aiplanGroup===a.group||e.aiGroup===a.group)&&(!wanted||wanted.has(String(e.id))));
  if(!source.length||source.length>5000||wanted&&source.length!==wanted.size)fail('Inspect the current plan again: working-copy source IDs are missing or too broad.');
  const anchor=source.find(e=>e.aiRooms),rooms=anchor?.aiRooms||[],layouts=anchor?.aiPlanLayout?.rooms||[];
  const bounds=e=>N.geom.entityBounds(e),layer=e=>N.doc.layers.find(l=>l.id===e.layerId)?.name||'0';
  const omit=new Set(a.omitIds||[]);if([...omit].some(id=>!source.some(e=>String(e.id)===id)))fail('Inspect again: an omitted ID is not in this source.');
  const retained=[],omitted=[];let unclassified=0;
  for(const e of source){
   let loose=false;
   if(a.removeLooseFurniture&&layer(e)==='A-FURN'){
    const b=bounds(e),r=rooms.find(r=>b&&[{x:b.minx,y:b.miny},{x:b.maxx,y:b.miny},{x:b.maxx,y:b.maxy},{x:b.minx,y:b.maxy}].every(p=>root.NasjPlan._test.pointInPoly(r.points,p)));
    const kind=e.aiFurniture?.roomKind||r?.kind||layouts.find(x=>x.id===r?.id)?.kind;
    if(kind)loose=!/kitchen|bath|wc|toilet|laundry|utility/i.test(kind);else unclassified++;
   }
   if(omit.has(String(e.id))||loose)omitted.push(String(e.id));else retained.push(e);
  }
  if(!retained.length)fail('A working copy must retain drawing geometry.');
  const bs=source.map(bounds).filter(Boolean),b={minx:Math.min(...bs.map(b=>b.minx)),miny:Math.min(...bs.map(b=>b.miny)),maxx:Math.max(...bs.map(b=>b.maxx)),maxy:Math.max(...bs.map(b=>b.maxy))};
  const dx=a.origin.x-b.minx,dy=a.origin.y-b.miny,dest={minx:b.minx+dx,miny:b.miny+dy,maxx:b.maxx+dx,maxy:b.maxy+dy};
  if(N.doc.entities.some(e=>{const q=bounds(e);return q&&q.minx<dest.maxx&&q.maxx>dest.minx&&q.miny<dest.maxy&&q.maxy>dest.miny;}))fail('The working-copy destination overlaps existing geometry; inspect extents and choose empty space.');
  return {source,entities:retained,dx,dy,omitted,unclassified,rooms:clone(rooms)};
 }
 root.NasjWorkingDrawings={catalogue,drawSymbols,copyBase};if(typeof module!=='undefined')module.exports={catalogue,drawSymbols,copyBase};
})(typeof window!=='undefined'?window:globalThis);
