/* Cross-discipline checks on actual CAD entities, with explicit scope and limits. */
(function(root){
 'use strict';
 const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e9;
 const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),eq=(a,b)=>dist(a,b)<1e-7;
 const overlap=(a,b)=>a&&b&&Math.min(a.maxx,b.maxx)>Math.max(a.minx,b.minx)+1e-7&&Math.min(a.maxy,b.maxy)>Math.max(a.miny,b.miny)+1e-7;
 const layer=(N,e)=>N.doc.layers.find(l=>l.id===e.layerId)?.name;
 function measure(e,b,kind){
  if(kind==='width')return b.maxx-b.minx;if(kind==='height')return b.maxy-b.miny;
  if(kind==='diameter')return e.type==='circle'?e.r*2:null;
  if(kind==='length'){
   if(e.type==='line')return dist(e.a,e.b);
   if(e.type==='circle')return 2*Math.PI*e.r;
   if(e.type==='polyline'&&!(e.pts||[]).some(p=>p.b))return e.pts.slice(1).reduce((s,p,i)=>s+dist(p,e.pts[i]),0)+(e.closed?dist(e.pts[0],e.pts.at(-1)):0);
   if(e.type==='dim')return e.kind==='aligned'?dist(e.p1,e.p2):Math.abs(e.orient==='v'?e.p2.y-e.p1.y:e.p2.x-e.p1.x);
  }return null;
 }
 function crossing(a,b,c,d){const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);return cross(a,b,c)*cross(a,b,d)<-1e-12&&cross(c,d,a)*cross(c,d,b)<-1e-12;}
 function shapeKey(e){
  if(e.type==='line')return JSON.stringify(['line',...[e.a,e.b].map(p=>[p.x,p.y]).sort((a,b)=>a[0]-b[0]||a[1]-b[1])]);
  const keys={circle:['c','r'],arc:['c','r','a0','a1'],polyline:['pts','closed'],text:['p','str','h','rot'],insert:['name','p','sx','sy','rot']};
  return keys[e.type]?JSON.stringify([e.type,...keys[e.type].map(k=>e[k])]):null;
 }
 function review(N,a,context={}){try{
  // Verification reads the requested output, including new sheets outside a reference box.
  if(context.referenceSelection)context={...context,scopeBounds:null,allowedIds:[]};
  const inspection=root.NasjCadDocument.run(N,{action:'inspect',group:a.group,ids:a.ids,layer:a.layer},context);if(!inspection.ok)return inspection;
  const idset=a.ids&&new Set(a.ids.map(String)),scopeIds=context.scopeIds&&new Set(context.scopeIds.map(String)),scope=context.scopeBounds,allowed=new Set(context.referenceSelection?context.allowedIds||[]:[]);
  const es=N.doc.entities.filter(e=>{
   if(e.aisel||idset&&!idset.has(String(e.id))||scopeIds&&!scopeIds.has(String(e.id))||a.group&&e.aiGroup!==a.group&&e.aiplanGroup!==a.group||a.layer&&layer(N,e)!==a.layer)return false;
   if(scope&&!allowed.has(String(e.id))){const b=N.geom.entityBounds(e);if(!b||b.minx<scope.minx||b.maxx>scope.maxx||b.miny<scope.miny||b.maxy>scope.maxy)return false;}return true;
  });
  if(es.length>5000)return {ok:false,error:'Review at most 5,000 entities. Use the actual output group or explicit IDs.'};
  if(idset&&es.length!==idset.size)return {ok:false,error:'Some review IDs are missing or outside the allowed selection. Inspect the current objects.'};
  const findings=[],add=(code,message,ids=[],severity='warning')=>{if(findings.length<100)findings.push({code,severity,message,ids:ids.map(String).slice(0,20)})},boxes=new Map(),seen=new Map(),texts=[];
  if(!es.length)add('EMPTY_SCOPE','No geometry matches the requested review scope.',[],'error');
  if(!inspection.units)add('UNITS_UNSPECIFIED','Physical dimensions cannot be verified until drawing units are set.');
  for(const e of es){
   let b;try{b=N.geom.entityBounds(e);}catch{b=null;}
   if(!b||!Object.values(b).every(finite)){add('INVALID_GEOMETRY','Object has no finite measurable bounds.',[e.id],'error');continue;}boxes.set(String(e.id),b);
   if(!layer(N,e))add('MISSING_LAYER','Object refers to a missing layer.',[e.id],'error');
   if(e.aiGroup&&layer(N,e)==='0')add('UNDISCIPLINED_LAYER','Generated geometry is on layer 0; assign its task/discipline layer.',[e.id]);
   if(e.type==='insert'&&!N.doc.blocks[e.name])add('MISSING_BLOCK','Inserted object has no block definition.',[e.id],'error');
   if(e.type==='line'&&eq(e.a,e.b)||['circle','arc'].includes(e.type)&&!(e.r>0))add('DEGENERATE_GEOMETRY','Zero-length line or invalid radius.',[e.id],'error');
   const k=shapeKey(e);if(k){if(seen.has(k))add('DUPLICATE_GEOMETRY','Coincident duplicate objects; inspect before deleting.',[seen.get(k),e.id]);else seen.set(k,e.id);}
   if(e.type==='text'||e.type==='mtext')texts.push(e);
   if(e.type==='polyline'&&e.closed&&!e.pts.some(p=>p.b)){
    const ps=e.pts;if(ps.length<3)add('INVALID_BOUNDARY','Closed boundary needs at least three vertices.',[e.id],'error');
    else if(ps.length<=200){let crossed=false;for(let i=0;i<ps.length&&!crossed;i++)for(let j=i+2;j<ps.length;j++){if(i===0&&j===ps.length-1)continue;if(crossing(ps[i],ps[(i+1)%ps.length],ps[j],ps[(j+1)%ps.length])){crossed=true;break;}}if(crossed)add('SELF_CROSSING_BOUNDARY','Closed boundary crosses itself; areas and containment are unreliable.',[e.id],'error');}
   }
  }
  const checkable=texts.slice(0,200);for(let i=0;i<checkable.length;i++)for(let j=i+1;j<checkable.length;j++){const a=checkable[i],b=checkable[j];if(overlap(boxes.get(String(a.id)),boxes.get(String(b.id))))add('TEXT_OVERLAP','Text bounding boxes overlap; inspect readability visually.',[a.id,b.id]);}
  const checks=a.checks||[];if(!Array.isArray(checks)||checks.length>40)throw Error('Use at most 40 explicit dimensional checks.');
  const measurements=[];for(const c of checks){
   if(!c||!['width','height','diameter','length','gap'].includes(c.kind)||!Array.isArray(c.ids)||c.ids.length!==(c.kind==='gap'?2:1)||typeof c.label!=='string'||c.label.length>100||c.min!==undefined&&!finite(c.min)||c.max!==undefined&&!finite(c.max)||c.min===undefined&&c.max===undefined||c.min!==undefined&&c.max!==undefined&&c.min>c.max)throw Error('Checks need a label, measurement kind, exact IDs and a valid min/max in drawing units.');
   const entities=c.ids.map(id=>es.find(e=>String(e.id)===String(id))),bs=c.ids.map(id=>boxes.get(String(id)));let value=null;
   if(entities.every(Boolean)&&bs.every(Boolean))value=c.kind==='gap'?Math.hypot(Math.max(0,bs[0].minx-bs[1].maxx,bs[1].minx-bs[0].maxx),Math.max(0,bs[0].miny-bs[1].maxy,bs[1].miny-bs[0].maxy)):measure(entities[0],bs[0],c.kind);
   const boundsOverlap=c.kind==='gap'&&bs.every(Boolean)&&overlap(bs[0],bs[1]);
   const pass=!boundsOverlap&&value!==null&&(c.min===undefined||value>=c.min-1e-7)&&(c.max===undefined||value<=c.max+1e-7);
   measurements.push({...c,value,...(c.kind==='gap'?{boundsOverlap}:{}),status:value===null?'unverified':pass?'passed':'failed',...(c.kind==='gap'?{method:'Axis-aligned bounding-box separation; conservative lower bound, not exact curved clearance.'}:{})});
   if(!pass)add(value===null?'MEASUREMENT_UNVERIFIED':'DIMENSION_MISMATCH',c.label+': '+(value===null?'unsupported or missing source':'measured '+value+' drawing units, outside the requested range'),c.ids,'error');
  }
  const model=root.NasjWorkspace?.read(N);if(model?.stale)add('STALE_BUILDING_MODEL','Source geometry changed; derived views need a fresh measured model.');
  const sheets=[...new Set(es.flatMap(e=>[e.aiSymbol?.sheet,e.aiNetwork?.sheet,e.aiLegend?.sheet]).filter(Boolean))];
  const coordination=[];if((!scope||context.referenceSelection)&&!scopeIds)for(const sheet of sheets){const r=root.NasjCoordination.review(N,{sheet},{});coordination.push(r);if(r.ok)r.findings.forEach(f=>add(f.code,f.message,f.ids));}
  return {ok:true,action:'drawing_review',revision:inspection.revision,scope:{group:a.group||null,ids:a.ids||null,layer:a.layer||null,bounds:scope||null,selectedIds:context.scopeIds||null,checked:es.length,documentTotal:inspection.documentTotal},units:inspection.units,status:findings.length?'needs_review':'checks_passed',findings,measurements,coordination,limits:['Basic geometry and requested measurements only; passing checks is not a complete design or code approval.','Text/bounding-box checks can be conservative; confirm with a CAD snapshot.','Review is limited to the stated scope. Text overlap examines at most 200 labels; straight closed boundaries at most 200 vertices.'],summary:findings.length?findings.length+' drawing quality findings.':'Basic geometry and requested dimensional checks passed within this scope.'};
 }catch(e){return {ok:false,error:String(e.message||e)}}}
 function designContext(N,a,context={}){try{
  const inspection=root.NasjCadDocument.run(N,{action:'inspect',group:a.group},context);if(!inspection.ok)return inspection;
  if(context.scopeIds||context.scopeBounds&&!context.referenceSelection)throw Error('Clear the cropped selection to assess whole-plan circulation.');
  const scale={1:1/.0254,2:1/.3048,4:1000,5:100,6:1}[inspection.units];if(!scale)throw Error('Set physical drawing units before assessing plan function.');
  const groups=[...new Set(N.doc.entities.filter(e=>e.aiRooms).map(e=>e.aiplanGroup||e.aiGroup).filter(Boolean))],group=a.group||(groups.length===1?groups[0]:null);
  if(!group)throw Error('Choose the inspected architectural plan group.');
  const es=N.doc.entities.filter(e=>e.aiplanGroup===group||e.aiGroup===group),anchor=es.find(e=>e.aiRooms);
  if(!anchor)throw Error('This drawing has no measured room topology. Use drawing_review and exact native inspection; do not invent a circulation graph.');
  // Height placeholders are private to XY extraction; they are never evidence of actual heights.
  const model=root.NasjBuildingGeometry.fromPlan(N,{group,heights:{wall:3*scale,door:2*scale,window:scale,windowSill:scale},assumptions:['XY-only extraction; vertical dimensions are not evaluated.']});
  const rooms=anchor.aiRooms.map(r=>{const ps=r.points,b={minx:Math.min(...ps.map(p=>p.x)),maxx:Math.max(...ps.map(p=>p.x)),miny:Math.min(...ps.map(p=>p.y)),maxy:Math.max(...ps.map(p=>p.y))};return {id:r.id,name:r.name,kind:r.kind,polygon:ps,area:Math.abs(ps.reduce((sum,p,i)=>{const q=ps[(i+1)%ps.length];return sum+p.x*q.y-q.x*p.y},0))/2,bounds:b,furnitureCount:es.filter(e=>e.aiFurniture?.roomId===r.id).length};});
  const openings=model.openings.map(o=>{const w=model.walls.find(w=>w.id===o.wallId),L=dist(w.a,w.b),p=t=>({x:w.a.x+(w.b.x-w.a.x)*t/L,y:w.a.y+(w.b.y-w.a.y)*t/L});return {id:o.id,kind:o.kind,vehicleOnly:o.garage,width:o.width,connects:w.roomIds,a:p(o.at),b:p(o.at+o.width),sourceIds:o.sourceIds};});
  const circulation=analyseCirculation(rooms,openings);
  return {ok:true,action:'design_context',revision:inspection.revision,group,units:inspection.units,rooms,openings,circulation,coordination:root.NasjCoordination.review(N,{sheet:group},{}),compilerFindings:anchor.aiPlanReport||null,limits:['Graph uses measured wall openings and saved room cells. Widths are geometric openings, not certified finished clear widths.','Room-cell area includes wall allowance; bounding boxes are not minimum usable room widths.','Furniture counts count primitives, not physical objects. No obstacle-aware path, daylight calculation, fire egress compliance or construction approval.','Vertical sizes, material layers and services are not evaluated in this XY functional context.'],editGuidance:'World XY coordinates in current drawing units. For draw_plan repair first use draw_plan review and its saved LOCAL metre coordinates; never pass these world coordinates as room x/y.',summary:'Measured room relationships, pedestrian entrance reachability and circulation candidates for independent design review.'};
 }catch(e){return {ok:false,error:String(e.message||e)}}}
 function analyseCirculation(rooms,openings){
  const graph=new Map([['outside',[]],...rooms.map(r=>[r.id,[]])]);
  for(const o of openings.filter(o=>o.kind==='door'&&!o.vehicleOnly)){const [a,b]=o.connects||[];if(a!==b&&graph.has(a)&&graph.has(b)){graph.get(a).push({to:b,opening:o.id,width:o.width});graph.get(b).push({to:a,opening:o.id,width:o.width});}}
  const reach=omit=>{const paths=new Map([['outside',[]]]),queue=['outside'];for(let i=0;i<queue.length;i++)for(const e of graph.get(queue[i])||[]){if(e.to===omit||paths.has(e.to))continue;paths.set(e.to,[...paths.get(queue[i]),{room:e.to,opening:e.opening,width:e.width}]);queue.push(e.to);}return paths;};
  const paths=reach(),inaccessible=rooms.filter(r=>!paths.has(r.id)).map(r=>r.id),deadEndCandidates=rooms.filter(r=>/corridor|hall|lobby/i.test(r.kind)&&new Set((graph.get(r.id)||[]).map(x=>x.to)).size<=1).map(r=>r.id),privateTransit=[];
  for(const r of rooms.filter(r=>/bed|bath|wc|toilet|store|closet/i.test(r.kind))){const removed=reach(r.id),dependent=rooms.filter(x=>x.id!==r.id&&paths.has(x.id)&&!removed.has(x.id)).map(x=>x.id);if(dependent.length)privateTransit.push({through:r.id,dependentRooms:dependent,note:'Assess privacy/function: an en-suite may be intentional; this alone is not a design defect.'});}
  return {inaccessible,deadEndCandidates,privateTransit,routes:rooms.map(r=>({room:r.id,path:paths.get(r.id)||null,minOpeningWidth:paths.has(r.id)&&paths.get(r.id).length?Math.min(...paths.get(r.id).map(p=>p.width)):null})),adjacency:[...graph].map(([room,links])=>({room,links})),note:'Topological candidates, not obstacle-aware travel distances or regulatory escape-route certification.'};
 }
 root.NasjDrawingQuality={review,designContext,analyseCirculation};if(typeof module!=='undefined')module.exports=root.NasjDrawingQuality;
})(typeof window!=='undefined'?window:globalThis);
