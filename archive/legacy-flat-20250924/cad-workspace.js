/* Measured workspace tools. Images cover CAD only; no desktop/files/network access. */
(function(root){
 'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x));
 const fail=m=>{throw Error(m)};
 const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e8;
 const pt=p=>p&&finite(p.x)&&finite(p.y);
 const text=(s,max=160)=>typeof s==='string'&&s.length<=max&&!/[\x00-\x08]/.test(s);
 const len=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 const signature=e=>JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k])=>!k.startsWith('ai')&&!k.startsWith('$')&&k!=='selected')));
 const carrier=N=>(N.doc.entities||[]).find(e=>e.aiBuilding);
 const validate=(N,raw)=>{
  const m=clone(raw||{}), es=N.doc.entities;
  if(!Array.isArray(m.sourceIds)||!m.sourceIds.length||m.sourceIds.length>500)fail('Provide 1–500 inspected source IDs.');
  if(m.elements!==undefined&&(!Array.isArray(m.elements)||m.elements.length>60))fail('Use at most 60 measured element envelopes.');
  m.sourceIds=[...new Set([...m.sourceIds,...(m.elements||[]).flatMap(e=>Array.isArray(e.sourceIds)?e.sourceIds:[])].map(String))];
  if(m.sourceIds.length>500)fail('The model and its elements must use at most 500 source entities.');
  const src=m.sourceIds.map(id=>es.find(e=>String(e.id)===id&&!e.aisel));if(src.some(e=>!e))fail('A building source entity is missing. Inspect again.');
  if(!Array.isArray(m.assumptions)||m.assumptions.length>30||!m.assumptions.every(s=>text(s,300)))fail('List supplied facts or explicit assumptions for heights and levels.');
  if(!Array.isArray(m.walls)||!m.walls.length||m.walls.length>100)fail('Use 1–100 walls.');
  const ids=new Set();for(const w of m.walls){
   if(!text(w.id,60)||ids.has(w.id)||!pt(w.a)||!pt(w.b)||len(w.a,w.b)<1e-7||!finite(w.thickness)||w.thickness<=0||!finite(w.base)||!finite(w.height)||w.height<=0)fail('Invalid wall dimensions or duplicate ID.');ids.add(w.id);
  }
  if(!Array.isArray(m.openings)||m.openings.length>100)fail('Use at most 100 openings.');
  const openings=new Set();for(const o of m.openings){const w=m.walls.find(w=>w.id===o.wallId);
   if(!text(o.id,60)||openings.has(o.id)||!w||!['door','window'].includes(o.kind)||![o.at,o.width,o.sill,o.height].every(finite)||o.at<0||o.width<=0||o.sill<0||o.height<=0||o.at+o.width>len(w.a,w.b)+1e-7||o.sill+o.height>w.height+1e-7)fail('An opening does not fit its wall.');openings.add(o.id);
  }
  for(let i=0;i<m.openings.length;i++)for(let j=i+1;j<m.openings.length;j++){const a=m.openings[i],b=m.openings[j];if(a.wallId===b.wallId&&Math.min(a.at+a.width,b.at+b.width)-Math.max(a.at,b.at)>1e-7&&Math.min(a.sill+a.height,b.sill+b.height)-Math.max(a.sill,b.sill)>1e-7)fail('Openings overlap on the same wall. Reconcile their measured positions.');}
  const elementIds=new Set();
  m.elements=(m.elements||[]).map(e=>{
   if(!text(e.id,60)||elementIds.has(e.id)||ids.has(e.id)||!Array.isArray(e.sourceIds)||!e.sourceIds.length||e.sourceIds.length>80||!finite(e.base)||!finite(e.height)||e.height<=0)fail('Elements need a unique ID, 1–80 actual source IDs, and explicit base and height in drawing units.');
   elementIds.add(e.id);
   const boxes=e.sourceIds.map(id=>{const source=src.find(x=>String(x.id)===String(id));return source&&N.geom?.entityBounds(source)});
   if(boxes.some(b=>!b))fail('Inspect the actual element sources before defining their height.');
   const b={minx:Math.min(...boxes.map(b=>b.minx)),miny:Math.min(...boxes.map(b=>b.miny)),maxx:Math.max(...boxes.map(b=>b.maxx)),maxy:Math.max(...boxes.map(b=>b.maxy))};
   if(!Object.values(b).every(finite)||b.maxx-b.minx<1e-7||b.maxy-b.miny<1e-7)fail('An element needs a measurable plan footprint.');
   return {id:e.id,sourceIds:e.sourceIds.map(String),kind:text(e.kind,60)?e.kind:'fixture',base:e.base,height:e.height,footprint:[{x:b.minx,y:b.miny},{x:b.maxx,y:b.miny},{x:b.maxx,y:b.maxy},{x:b.minx,y:b.maxy}]};
  });
  m.name=text(m.name)?m.name:'Building model';m.units=N.units.get().insunits;
  if(!m.units)fail('Set actual drawing units before making a measured building model.');
  m.sources=src.map(e=>({id:String(e.id),signature:signature(e)}));
  if(JSON.stringify(m).length>160000)fail('Building model is too large.');return m;
 };
 const read=N=>{const c=carrier(N);if(!c)return {model:null,stale:false};const m=c.aiBuilding;const requiresPlanExtraction=(!m.measuredPlan||m.sectionGeometryVersion!==2)&&(m.sourceIds||[]).some(id=>N.doc.entities.some(e=>String(e.id)===id&&(e.aiplanGroup||e.aiRooms)));const stale=requiresPlanExtraction||(m.sources||[]).some(s=>{const e=N.doc.entities.find(e=>String(e.id)===s.id);return !e||signature(e)!==s.signature})||N.units.get().insunits!==m.units;const out=clone(m);delete out.sources;return {model:out,stale,requiresPlanExtraction,carrierId:String(c.id)};};
 const derived=(m,a)=>{
  if(!pt(a.origin))fail('Choose an explicit origin for the new view, away from the plan.');
  const out=[],o=a.origin,add=(x1,z1,x2,z2,layer='A-ELEV')=>out.push({type:'line',a:{x:o.x+x1,y:o.y+z1},b:{x:o.x+x2,y:o.y+z2},layer});
  const rect=(x1,z1,x2,z2,l)=>{add(x1,z1,x2,z1,l);add(x2,z1,x2,z2,l);add(x2,z2,x1,z2,l);add(x1,z2,x1,z1,l)};
  if(a.action==='elevation'){
   const projected=root.NasjBuildingGeometry.elevation(m,a.direction);
   for(const s of projected.segments)add(s.x1,s.z1,s.x2,s.z2,s.layer);
   out.visibility={visibleWallIds:projected.visibleWallIds,visibleOpeningIds:projected.visibleOpeningIds};
  }else{
   const projected=root.NasjSectionGeometry.section(m,a);
   for(const s of projected.segments)add(s.x1,s.z1,s.x2,s.z2,s.layer);
   out.visibility={visibleWallIds:projected.visibleWallIds,visibleOpeningIds:projected.visibleOpeningIds,visibleElementIds:projected.visibleElementIds,look:projected.look,viewVector:projected.viewVector,depth:projected.depth};
   if(!out.length)fail('No model geometry is visible in this cut direction and depth.');
   add(0,Math.min(...m.walls.map(w=>w.base)),projected.cutLength,Math.min(...m.walls.map(w=>w.base)),'A-LEVEL');
  }
  if(!out.length)fail('No walls intersect this view.');if(out.length>490)fail('Narrow the model/view to fewer walls.');
  const height=Math.max(...m.walls.map(w=>w.height)),h=height/35;
  out.push({type:'text',p:{x:o.x,y:o.y-height/8},str:(a.action==='section'?'Section ('+(a.look||'left')+')':'Elevation '+a.direction)+' · wall/opening model; verify assumptions',h,layer:'A-ANNO-TEXT'});
  return out;
 };
 async function run(N,args,context={}){try{
  const a=args||{},skills=root.NasjEngineeringSkills,C=root.NasjCadDocument;if(!N.doc)fail('Open a drawing first.');
  const ok=(data,summary)=>({ok:true,action:a.action,...data,summary});
  if(a.action==='skills')return ok({skills:skills.catalog()},'Engineering skills available.');
  if(a.action==='skill'){const skill=skills.get(a.skill);if(!skill)fail('Unknown skill. Use skills for the catalogue.');return ok({skill},'Loaded '+skill.title+'.');}
  if(a.action==='snapshot'){
   if(!context.snapshot)fail('Drawing snapshots are unavailable in this client.');const shot=await context.snapshot(a);if(!shot||!shot.image)fail('No drawable geometry in that area.');return ok(shot,'Captured the current CAD drawing.');
  }
  if(a.action==='symbol_catalog')return ok({symbols:root.NasjWorkingDrawings.catalogue()},'Native coordination symbols with dedicated layers; include a legend.');
  if(['symbol_register','symbol_legend','service_network','coordination_review','drawing_review','design_context'].includes(a.action)||a.action==='symbols'&&a.sheet)return root.NasjCoordination.run(N,a,context);
  if(a.action==='symbols'){
   const entities=root.NasjWorkingDrawings.drawSymbols(a),r=C.run(N,{action:'apply',revision:a.revision,entities,group:a.group},context);
   return r.ok?ok({...r,action:a.action,notes:['Diagrammatic symbols; size controls plotted appearance, not equipment dimensions. Verify design criteria and identify symbols in a legend.']},'Added editable coordination symbols.'):r;
  }
  if(a.action==='working_copy'){
   const spec=root.NasjWorkingDrawings.copyBase(N,a),copyGroup='working-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),r=C.run(N,{action:'apply',revision:a.revision,group:a.group,ids:a.ids},{...context,workingCopy:spec,copyGroup});
   return r.ok?ok({...r,action:a.action,sourcePreserved:true,omittedCount:spec.omitted.length,unclassifiedFurniture:spec.unclassified,notes:['Source drawing preserved. Only the copy is simplified.','Use cad_document inspect with the returned group to inspect copied fixture IDs and continue on this copy. It does not need a saved draw_plan layout. Do not make another copy when continuing or recovering.',...(spec.unclassified?['Unclassified furniture was retained; inspect it before removing explicit IDs.']:[])]},'Created a separate working drawing base; the source remains unchanged.'):r;
  }
  if(a.action==='building_read')return ok(read(N),'Read the shared building model and checked its source geometry.');
  if(a.action==='building_set'||a.action==='building_from_plan'){
   if(a.action==='building_set'&&(a.model?.sourceIds||[]).some(id=>N.doc.entities.some(e=>String(e.id)===String(id)&&e.aiplanGroup)))fail('Use building_from_plan for a generated plan: it measures actual wall and opening positions. Do not guess opening widths or offsets.');
   const model=validate(N,a.action==='building_from_plan'?root.NasjBuildingGeometry.fromPlan(N,a):a.model),c=carrier(N),id=c?String(c.id):model.sourceIds[0];
   if(context.scopeBounds&&!context.referenceSelection){const b=context.scopeBounds;if(model.sourceIds.some(id=>{const q=N.geom.entityBounds(N.doc.entities.find(e=>String(e.id)===id));return !q||q.minx<b.minx||q.miny<b.miny||q.maxx>b.maxx||q.maxy>b.maxy}))fail('All building sources must be inside the marked area. Enlarge or clear the selection first.');}
   const r=C.run(N,{action:'apply',revision:a.revision,ids:[id]},{...context,building:model});if(!r.ok)return r;
   return ok({...read(N),revision:r.revision},'Saved the measured wall/opening model. One Undo restores its previous state.');
  }
  if(a.action==='elevation'||a.action==='section'){
   const r=read(N);if(!r.model)fail('Create a measured building model first.');if(r.requiresPlanExtraction)fail('Rebuild this legacy guessed model with building_from_plan before deriving views.');if(r.stale)fail('The source geometry or units changed. Inspect and update the building model first.');
   const entities=derived(r.model,a),group='view-'+r.carrierId+'-'+a.action+'-'+(a.direction||JSON.stringify(a.cut)+(a.look==='right'?'-right':''));
   const old=N.doc.entities.filter(e=>e.aiGroup===group);
   const bounds=entities.map(e=>N.geom.entityBounds(e)).filter(Boolean),b={minx:Math.min(...bounds.map(b=>b.minx)),miny:Math.min(...bounds.map(b=>b.miny)),maxx:Math.max(...bounds.map(b=>b.maxx)),maxy:Math.max(...bounds.map(b=>b.maxy))};
   if(N.doc.entities.some(e=>!old.includes(e)&&!e.aisel&&(()=>{const q=N.geom.entityBounds(e);return q&&q.minx<b.maxx&&q.maxx>b.minx&&q.miny<b.maxy&&q.maxy>b.miny})()))fail('The derived view would overlap existing drawing geometry; inspect extents and choose an empty origin.');
   const result=C.run(N,{action:'apply',revision:a.revision,entities,group,...(old.length?{erase:true}:{})},context);
   if(!result.ok)return result;return ok({...result,action:a.action,view:{origin:a.origin,direction:a.direction,cut:a.cut,...entities.visibility,openings:r.model.openings.filter(h=>!entities.visibility||entities.visibility.visibleOpeningIds.includes(h.id))},assumptions:r.model.assumptions,limitations:['Measured walls/openings and explicitly supplied element envelopes only. Sections show nearest surfaces on the chosen side within the depth limit. Door leaves, roof, slab layers and reinforcement are not inferred. Element envelopes are schematic, not detailed manufacturer profiles.']},'Derived '+a.action+' from the shared model on dedicated layers.');
  }
  if(a.action==='quantities'){
   const r=C.run(N,{action:'inspect',ids:a.ids,group:a.group,layer:a.layer},context);if(!r.ok)return r;
   let es=N.doc.entities.filter(e=>!e.aisel&&(!a.ids||a.ids.includes(String(e.id)))&&(!a.group||e.aiGroup===a.group||e.aiplanGroup===a.group)&&(!a.layer||N.doc.layers.find(l=>l.id===e.layerId)?.name===a.layer));
   if(context.scopeBounds){const b=context.scopeBounds,allowed=new Set(context.referenceSelection?context.allowedIds||[]:[]);es=es.filter(e=>{const q=N.geom.entityBounds(e);return allowed.has(String(e.id))||q&&q.minx>=b.minx&&q.maxx<=b.maxx&&q.miny>=b.miny&&q.maxy<=b.maxy})}
   if(context.scopeIds){const picked=new Set(context.scopeIds.map(String));es=es.filter(e=>picked.has(String(e.id)));}
   if(es.length>20000)fail('Measure at most 20,000 entities at once.');const rows=new Map();let unsupported=0;
   for(const e of es){const layer=N.doc.layers.find(l=>l.id===e.layerId)?.name||'0',key=layer+':'+e.type;if(!rows.has(key))rows.set(key,{layer,type:e.type,count:0,length:0,closedArea:0});const v=rows.get(key);v.count++;
    if(e.type==='polyline'&&e.pts.some(p=>Math.abs(p.b||0)>1e-10)){unsupported++;continue;}
    if(e.type==='line')v.length+=len(e.a,e.b);else if(e.type==='circle'){v.length+=2*Math.PI*e.r;v.closedArea+=Math.PI*e.r*e.r}else if(e.type==='arc'){let sweep=(e.a1-e.a0)%(2*Math.PI);if(sweep<0)sweep+=2*Math.PI;v.length+=e.r*sweep}else if(e.type==='polyline'){for(let i=1;i<e.pts.length;i++)v.length+=len(e.pts[i-1],e.pts[i]);if(e.closed){v.length+=len(e.pts.at(-1),e.pts[0]);v.closedArea+=Math.abs(e.pts.reduce((s,p,i)=>{const q=e.pts[(i+1)%e.pts.length];return s+p.x*q.y-q.x*p.y},0))/2}}else unsupported++;
   }return ok({units:r.units,rows:[...rows.values()],unsupported,notes:['Geometric totals only. Areas overlap and are not net material quantities; lengths use current drawing units. Unsupported entities, including bulged polylines, contribute counts only, not lengths/areas.']},'Measured '+es.length+' entities by layer and type.');
  }
  fail('Unknown workspace operation.');
 }catch(e){return {ok:false,error:String(e.message||e)}}}
 root.NasjWorkspace={run,validate,derived,read};if(typeof module!=='undefined')module.exports={run,validate,derived,read};
})(typeof window!=='undefined'?window:globalThis);
