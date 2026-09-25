/* Authenticated catalogue only. Sources are parsed in memory, never opened over
 * the user's drawing. Insertion validates everything before one undo boundary. */
(function(root){
 'use strict';
 const cache=new Map(), inspected=new WeakMap(), clone=x=>JSON.parse(JSON.stringify(x));
 const fail=m=>{throw Error(m)}, finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e9;
 const allowed=new Set(['line','polyline','circle','arc','ellipse','spline','hatch','text','mtext','insert','dim','point','face3d']);
 const union=bs=>({minx:Math.min(...bs.map(b=>b.minx)),miny:Math.min(...bs.map(b=>b.miny)),maxx:Math.max(...bs.map(b=>b.maxx)),maxy:Math.max(...bs.map(b=>b.maxy))});
 function validate(data){
  let count=0;const visit=(es,stack=[])=>{for(const e of es){
   if(++count>10000||stack.length>12)fail('This block is too complex. Choose a simpler library object.');
   if(!allowed.has(e.type))fail('This block contains unsupported objects. Choose another candidate.');
   const walk=o=>{if(typeof o==='number'&&!finite(o))fail('The block has invalid coordinates.');if(o&&typeof o==='object')Object.values(o).forEach(walk);};walk(e);
   if(e.type==='insert'){if(stack.includes(e.name)||!data.blocks[e.name])fail('This block has a missing or circular definition.');visit(data.blocks[e.name].entities||[],[...stack,e.name]);}
  }};visit(data.entities);
  return count;
 }
 // The renderer's block definitions contain primitive children. Resolve every
 // nested source placement before creating one editable destination block.
 function flatten(N,data){
  const expand=es=>es.flatMap(e=>{
   if(e.type!=='insert')return [clone(e)];
   const def=data.blocks[e.name];if(def.visibility||def.xref||e.dyn)fail('Choose a static block; dynamic states and external references need manual review.');
   return N.geom.insertToWorld(e,expand(def.entities||[]),data);
  });
  // Remove only our own distribution stamp from inserted copies, never source attribution.
  const entities=expand(data.entities).filter(e=>!(['text','mtext'].includes(e.type)&&/^nasji\.com$/i.test(String(e.str||'').trim())));
  return {...data,entities,blocks:{}};
 }
 function measured(N,data,es=data.entities){const current=N.doc;try{N.doc=data;const boxes=es.map(e=>N.geom.entityBounds(e));if(!boxes.length||boxes.some(b=>!b||!['minx','miny','maxx','maxy'].every(k=>finite(b[k]))))fail('The block has no usable bounds.');return union(boxes);}finally{N.doc=current;}}
 async function run(N,args,context={}){try{
  const a=args||{},d=N.doc;if(!d)fail('Open a drawing first.');
  if(!context.fetch)fail('Update the app to use the library.');
  const ok=(data,summary)=>({ok:true,action:a.action,...data,summary});
  if(a.action==='search')return await context.fetch({action:'search',query:String(a.query||'').slice(0,160)});
  if(a.action==='inspect'){
   let item=cache.get(a.slug);
   if(!item){const r=await context.fetch({action:'read',slug:a.slug});if(!r||!r.ok)fail(r&&r.error||'Could not read this block.');
    if(typeof r.dxf!=='string'||r.dxf.length>2_000_000)fail('Library payload is too large.');
    let data=N.dxf.importText(r.dxf);data.blocks=data.blocks||{};
    validate(data);data=flatten(N,data);const count=data.entities.length,bounds=measured(N,data);item={data,bounds,count,block:r.block,image:r.image};
    if(cache.size>=8)cache.delete(cache.keys().next().value);cache.set(a.slug,item);
   }
   if(N.doc!==d||context.cancelled?.())fail('Drawing changed or request stopped. Inspect again.');
   const revision='lib-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
   if(!inspected.has(d))inspected.set(d,new Map());
   inspected.get(d).set(a.slug,{revision,gen:N.docGen(d),entities:d.entities,slug:a.slug});
   return ok({libraryRevision:revision,block:item.block,...(item.image?{image:item.image}:{}),sourceBounds:item.bounds,sourceEntities:item.count,
    sample:item.data.entities.slice(0,12).map(e=>({type:e.type,...(['text','mtext'].includes(e.type)?{text:String(e.str||'').slice(0,100)}:{})})),
    coordinateSystem:'Insertion point is the centre of the source bounds, in current world drawing units. Width is the unrotated overall width in current drawing units; uniform scaling preserves aspect ratio. Rotation is degrees counterclockwise. Inspect the destination drawing and room clearance first.'},'Opened the library block internally; the current drawing is unchanged.');
  }
  if(a.action!=='insert')fail('Use search, inspect or insert.');
  const snap=inspected.get(d)?.get(a.slug),item=cache.get(a.slug);
  if(!snap||snap.revision!==(a.libraryRevision||a.revision)||snap.slug!==a.slug||snap.gen!==N.docGen(d)||snap.entities!==d.entities||!item)fail('Inspect this library block again after changes to the drawing.');
  if(d.$space)fail('Switch to Model before inserting library furniture.');
  if(context.scopeIds)fail('Clear the element pick or mark an area before adding furniture.');
  if(context.cancelled?.())fail('Request stopped.');
  const active=N.tools&&N.tools.activeName;if(active&&!['none','select'].includes(active))fail('Finish the active CAD command first.');
  const layer=typeof a.layer==='string'?a.layer:'A-FURN';if(!/^[A-Za-z][A-Za-z0-9_-]{0,59}$/.test(layer))fail('Choose a dedicated layer, such as A-FURN or M-EQPM.');
  const oldLayer=d.layers.find(l=>l.name===layer);if(oldLayer&&(oldLayer.locked||oldLayer.frozen||oldLayer.on===false))fail('The destination layer is locked or hidden. Choose another layer.');
  const placements=a.placements;if(!Array.isArray(placements)||!placements.length||placements.length>20)fail('Provide 1–20 placements.');
  let b=item.bounds,w=b.maxx-b.minx;if(!(w>1e-8))fail('Block width is zero. Choose another candidate.');
  const prefix='LIB-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),name=prefix+'-root';
  const defs={},mapped=new Map(Object.keys(item.data.blocks).map((k,i)=>[k,prefix+'-'+i]));
  const kids=es=>clone(es).map(e=>{for(const k of Object.keys(e))if(k.startsWith('$')||k==='id'||k==='handle')delete e[k];e.color='ByLayer';if(e.type==='insert')e.name=mapped.get(e.name);return e;});
  for(const [k,v] of Object.entries(item.data.blocks))defs[mapped.get(k)]={...clone(v),entities:kids(v.entities||[])};
  defs[name]={base:{x:(b.minx+b.maxx)/2,y:(b.miny+b.maxy)/2},entities:kids(item.data.entities)};
  // Measure the actual imported hierarchy with its final visible layer mapping.
  const measureLayer=oldLayer||{id:'lib-measure',name:layer,on:true,frozen:false,locked:false};
  for(const def of Object.values(defs))for(const e of def.entities)e.layerId=measureLayer.id;
  defs[name].base={x:0,y:0};
  const measurementDoc={...d,layers:[...d.layers,...(oldLayer?[]:[measureLayer])],blocks:{...d.blocks,...defs}};
  b=measured(N,measurementDoc,[{type:'insert',name,p:{x:0,y:0},sx:1,sy:1,rot:0,layerId:measureLayer.id}]);w=b.maxx-b.minx;
  if(!(w>1e-8))fail('Imported block width is zero.');defs[name].base={x:(b.minx+b.maxx)/2,y:(b.miny+b.maxy)/2};
  const newEntities=placements.map(p=>{if(!p||!finite(p.x)||!finite(p.y)||!finite(p.width)||p.width<=0||!finite(p.rotation??0))fail('Every placement needs finite x, y, positive width and optional rotation in degrees.');return {type:'insert',name,p:{x:p.x,y:p.y},sx:p.width/w,sy:p.width/w,rot:(p.rotation||0)*Math.PI/180,color:'ByLayer',aiGroup:prefix,aiLibrary:{slug:a.slug,page:item.block.page,license:item.block.license}};});
  const registration=root.NasjCoordination?.libraryMetadata(N,a,name);
  if(registration){
   if(registration.name!==name){const rb=measured(N,d,[{type:'insert',name:registration.name,p:{x:0,y:0},sx:1,sy:1,rot:0}]);const rw=rb.maxx-rb.minx;if(!(rw>0))fail('Registered symbol has no usable width.');newEntities.forEach((e,i)=>{e.sx=e.sy=placements[i].width/rw;});}
   for(const e of newEntities){e.name=registration.name;e.aiSymbol=clone(registration.metadata);}
  }
  const temp=measurementDoc,boxes=newEntities.map(e=>measured(N,temp,[e]));
  const scope=context.scopeBounds;if(scope&&!context.referenceSelection&&boxes.some(b=>b.minx<scope.minx-1e-7||b.miny<scope.miny-1e-7||b.maxx>scope.maxx+1e-7||b.maxy>scope.maxy+1e-7))fail('Furniture would leave the marked area. Adjust its position or size.');
  N.docOps.pushUndo(d);
  const target=oldLayer||N.docOps.addLayer(d,layer);
  for(const def of Object.values(defs))for(const e of def.entities)e.layerId=target.id;
  if(!registration||registration.name===name)Object.assign(d.blocks,defs);
  const ids=newEntities.map(e=>N.docOps.addEntity(d,{...e,layerId:target.id}).id);
  d.modified=true;inspected.delete(d);N.render();root.dispatchEvent?.(new CustomEvent('nasj:doc',{detail:{reason:'ai-library'}}));
  const libraryRevision='lib-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  inspected.set(d,new Map([[a.slug,{revision:libraryRevision,gen:N.docGen(d),entities:d.entities,slug:a.slug}]]));
  return ok({libraryRevision,ids:ids.map(String),group:prefix,bounds:union(boxes),added:ids.length,block:item.block},'Inserted '+ids.length+' editable library block(s) on '+layer+'. Undo removes this insertion.');
 }catch(e){return {ok:false,error:String(e.message||e)}}}
 root.NasjCadLibrary={run};
})(typeof window!=='undefined'?window:globalThis);
