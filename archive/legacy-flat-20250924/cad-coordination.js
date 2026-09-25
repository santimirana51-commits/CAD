/* Deterministic coordination: shared symbols/legends and directed service graphs.
 * No network, scripts or engineering-rating inference. All writes use CAD's atomic gate. */
(function(root){
 'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x)),fail=s=>{throw Error(s)},finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e8;
 const pt=p=>p&&finite(p.x)&&finite(p.y),str=(s,n=80)=>typeof s==='string'&&s.length>0&&s.length<=n&&!/[\x00-\x1f]/.test(s);
 const key=s=>str(s)&&/^[\w .:-]+$/.test(s),uid=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
 const signature=e=>JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k])=>!k.startsWith('ai')&&!k.startsWith('$')&&!['id','selected'].includes(k))));
 const layer=(N,e)=>e.layer||N.doc.layers.find(l=>l.id===e.layerId)?.name||'0';
 const sheet=(N,a)=>{if(!key(a.sheet))fail('Use a stable sheet ID, normally the inspected working-copy group.');return a.sheet;};
 const placements=(N,s)=>N.doc.entities.filter(e=>e.aiSymbol?.sheet===s&&e.aiSymbol.role==='placement');
 const bounds=(N,es,defs={})=>{const d=N.doc;try{N.doc={...d,blocks:{...d.blocks,...defs}};const bs=es.map(e=>N.geom.entityBounds(e)).filter(Boolean);return bs.length?{minx:Math.min(...bs.map(b=>b.minx)),miny:Math.min(...bs.map(b=>b.miny)),maxx:Math.max(...bs.map(b=>b.maxx)),maxy:Math.max(...bs.map(b=>b.maxy))}:null;}finally{N.doc=d;}};
 const clash=(a,b)=>a&&b&&a.minx<b.maxx-1e-7&&a.maxx>b.minx+1e-7&&a.miny<b.maxy-1e-7&&a.maxy>b.miny+1e-7;
 function symbols(N,a){
  const s=sheet(N,a),ps=a.placements;
  if(!Array.isArray(ps)||!ps.length||ps.length>12)fail('Place 1–12 symbols per batch.');
  const es=[],blocks={},catalog=root.NasjWorkingDrawings.catalogue(),existing=placements(N,s);
  for(const p of ps){
   const symbolKey=p.symbolKey||p.kind;if(!key(symbolKey))fail('Use a short stable symbolKey.');
   const registered=existing.find(e=>e.aiSymbol.key===symbolKey)||es.find(e=>e.aiSymbol?.key===symbolKey);
   const spec=catalog.find(c=>c.kind===p.kind)||registered&&{kind:registered.aiSymbol.kind,name:registered.aiSymbol.label,layer:layer(N,registered)};
   if(!spec||!pt(p)||!finite(p.size)||p.size<=0||!finite(p.rotation??0))fail('Use a listed kind or existing symbolKey, finite position, positive size and degree rotation.');
   if(registered&&p.kind&&registered.aiSymbol.kind!==p.kind)fail('This symbol key already refers to a different definition. Reuse it or choose a distinct variant key.');
   const name=registered?.name||'NASJI-SYM-'+uid();
   if(!registered){const geometry=root.NasjWorkingDrawings.drawSymbols({placements:[{kind:p.kind,x:0,y:0,size:1}]});blocks[name]={base:{x:0,y:0},entities:geometry.map(e=>({...e,color:'ByLayer'}))};}
   const graphic=bounds(N,[{type:'insert',name,p:{x:0,y:0},sx:1,sy:1,rot:0}],blocks),width=graphic&&graphic.maxx-graphic.minx;
   if(!(width>0))fail('Registered symbol has no measurable width.');
   es.push({type:'insert',name,p:{x:p.x,y:p.y},sx:p.size/width,sy:p.size/width,rot:(p.rotation||0)*Math.PI/180,layer:spec.layer,color:'ByLayer',...(registered?.aiLibrary?{aiLibrary:clone(registered.aiLibrary)}:{}),aiSymbol:{sheet:s,key:symbolKey,kind:spec.kind,label:spec.name,role:'placement'}});
   if(p.label){if(!str(p.label,60))fail('Keep device tags under 60 characters.');es.push({type:'text',p:{x:p.x+p.size*.8,y:p.y},str:p.label,h:p.size*.3,rot:0,layer:'A-ANNO-TEXT',color:'ByLayer',aiSymbol:{sheet:s,key:symbolKey,role:'tag'}});}
  }
  return {entities:es,blocks};
 }
 // Library definitions register the same semantic identity used by native symbols.
 function libraryMetadata(N,a,name){
  if(!a.sheet&&!a.symbolKey)return null;
  const s=sheet(N,a);if(!key(a.symbolKey))fail('A sheet library symbol requires a stable symbolKey.');
  const prior=placements(N,s).find(e=>e.aiSymbol.key===a.symbolKey);
  if(prior&&prior.aiLibrary?.slug!==a.slug)fail('This symbolKey already uses a different symbol. Use a separate variant key or replace every existing occurrence explicitly.');
  return {name:prior?.name||name,metadata:{sheet:s,key:a.symbolKey,kind:'library:'+a.slug,label:str(a.symbolLabel,60)?a.symbolLabel:a.symbolKey,role:'placement'}};
 }
 function register(N,a){
  const s=sheet(N,a);if(!key(a.symbolKey)||!str(a.symbolLabel,60))fail('Custom symbol needs a stable key and a short description.');
  if(placements(N,s).some(e=>e.aiSymbol.key===a.symbolKey))fail('This key is already registered. Reuse its existing definition instead of redefining it.');
  if(!Array.isArray(a.ids)||!a.ids.length||a.ids.length>60)fail('Select 1–60 inspected primitives belonging only to the custom symbol.');
  const es=a.ids.map(id=>N.doc.entities.find(e=>String(e.id)===String(id)));
  if(es.some(e=>!e||e.aisel||e.aiplan||e.aiSymbol||e.aiNetwork||!['line','circle','arc','polyline','text'].includes(e.type)))fail('Register only an isolated custom symbol made from native primitives; source plans and existing registered objects are protected.');
  const b=bounds(N,es);if(!b)fail('Custom symbol has no measurable graphic.');
  const p={x:(b.minx+b.maxx)/2,y:(b.miny+b.maxy)/2},name='NASJI-CUSTOM-'+uid(),entities=es.map(e=>{const v=clone(e);N.geom.translateEntity(v,-p.x,-p.y);for(const k of Object.keys(v))if(k==='id'||k.startsWith('ai')||k.startsWith('$'))delete v[k];v.layer=layer(N,e);delete v.layerId;return v;});
  return {entities:[{type:'insert',name,p,sx:1,sy:1,rot:0,color:'ByLayer',layer:layer(N,es[0]),aiSymbol:{sheet:s,key:a.symbolKey,label:a.symbolLabel,kind:'custom',role:'placement'}}],blocks:{[name]:{base:{x:0,y:0},entities}},replace:true,ids:a.ids};
 }
 function manifest(N,s){
  const rows=new Map();for(const e of placements(N,s)){
   const k=e.aiSymbol.key+'\0'+e.name;let r=rows.get(k);if(!r){r={key:e.aiSymbol.key,label:e.aiSymbol.label,name:e.name,count:0,layer:layer(N,e)};rows.set(k,r);}r.count++;
  }return [...rows.values()].sort((a,b)=>a.key.localeCompare(b.key)||a.name.localeCompare(b.name));
 }
 function legend(N,a){
  const s=sheet(N,a),rows=manifest(N,s);if(!rows.length)fail('No registered symbols on this sheet. Place symbols with sheet, or register a library symbol first.');
  if(!pt(a.origin)||!finite(a.textHeight)||a.textHeight<=0)fail('Legend needs an empty origin and positive textHeight in drawing units.');
  const h=a.textHeight,x=a.origin.x,y=a.origin.y,es=[],group='legend:'+s;
  const text=(str,x,y)=>es.push({type:'text',str,p:{x,y},h,rot:0,layer:'A-SCHEDULE',color:'ByLayer'});
  const descriptionX=x+h*(11+Math.max(14,...rows.map(r=>r.key.length*.7))),quantityX=descriptionX+h*(4+Math.max(26,...rows.map(r=>r.label.length*.7)));
  text('SYMBOL',x,y);text('KEY',x+h*8,y);text('DESCRIPTION',descriptionX,y);text('QTY',quantityX,y);
  rows.forEach((r,i)=>{
   if(!N.doc.blocks[r.name])fail('A symbol definition is missing. Repair its block before making a legend.');
   const b=bounds(N,[{type:'insert',name:r.name,p:{x:0,y:0},sx:1,sy:1,rot:0}]),w=b&&Math.max(b.maxx-b.minx,b.maxy-b.miny);
   if(!(w>0))fail('A symbol has no measurable graphic.');const scale=h*2/w,cy=y-(i+1)*h*5;
   es.push({type:'insert',name:r.name,p:{x:x+h-(b.minx+b.maxx)/2*scale,y:cy-(b.miny+b.maxy)/2*scale},sx:scale,sy:scale,rot:0,layer:r.layer,color:'ByLayer',aiSymbol:{sheet:s,key:r.key,role:'legend'}});
   text(r.key,x+h*8,cy);text(r.label,descriptionX,cy);text(String(r.count),quantityX,cy);
  });
  es[0].aiLegend={sheet:s,rows:clone(rows)};
  const old=N.doc.entities.filter(e=>e.aiGroup===group),b=bounds(N,es);
  if(N.doc.entities.some(e=>!old.includes(e)&&!e.aisel&&clash(b,N.geom.entityBounds(e))))fail('Legend overlaps existing geometry. Choose an empty origin from inspected extents.');
  return {entities:es,blocks:{},group,replace:old.length>0,rows};
 }
 const systems={cold:'P-COLD',hot:'P-HOT',waste:'P-WASTE',vent:'P-VENT',rain:'P-RAIN'};
 function validateNetwork(a){
  const n=clone(a.network||{});if(!key(n.id)||!systems[n.system])fail('Network needs an ID and cold, hot, waste, vent or rain system.');
  if(!Array.isArray(n.nodes)||n.nodes.length<2||n.nodes.length>80||!Array.isArray(n.edges)||!n.edges.length||n.edges.length>100)fail('Use 2–80 nodes and 1–100 directed pipe edges.');
  const ids=new Set(),nodes=new Map();for(const p of n.nodes){if(!key(p.id)||ids.has(p.id)||!pt(p)||p.z!==undefined&&!finite(p.z)||!['source','outlet','fixture','junction','cleanout'].includes(p.role))fail('Nodes require unique IDs, finite drawing coordinates/levels and valid roles.');ids.add(p.id);nodes.set(p.id,p);}
  const warnings=[],edgeKeys=new Set(),rows=[];
  for(const e of n.edges){
   const f=nodes.get(e.from),t=nodes.get(e.to),k=e.from+'>'+e.to;if(!f||!t||f===t||edgeKeys.has(k)||edgeKeys.has(e.to+'>'+e.from))fail('Every edge needs distinct existing endpoints; duplicate or reversed duplicate pipes are invalid.');edgeKeys.add(k);
   if(e.via!==undefined&&(!Array.isArray(e.via)||e.via.length>12||!e.via.every(pt)))fail('Pipe bends need at most 12 finite XY points.');
   if(e.diameter!==undefined&&(!finite(e.diameter)||e.diameter<=0))fail('Pipe diameters must be positive drawing-unit dimensions.');
   const points=[f,...(e.via||[]),t],length=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);
   if(length<=1e-7)fail('Zero-length plan pipes are not supported. Represent vertical risers by explicit notes, not a zero-length edge.');
   if(points.slice(1).some((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y)<=1e-7))fail('Remove coincident consecutive bends.');
   let slope=null;if(['waste','rain'].includes(n.system)){
    if(f.z===undefined||t.z===undefined)warnings.push({code:'LEVEL_REQUIRED',edge:k,message:'Invert levels missing; gravity fall is unverified.'});
    else {slope=(f.z-t.z)/length;if(slope<=0)fail('Gravity pipe '+k+' must fall in flow direction. Correct invert levels or route.');}
   }
   if(e.diameter===undefined)warnings.push({code:'SIZE_REQUIRED',edge:k,message:'Pipe size is TBD; demand/capacity has not been calculated.'});
   rows.push({edge:k,length,diameter:e.diameter??null,fromLevel:f.z??null,toLevel:t.z??null,slope});
  }
  const supply=['cold','hot'].includes(n.system),roots=n.nodes.filter(p=>p.role===(supply?'source':'outlet'));if(!roots.length)fail(supply?'Add an explicit supply source.':'Add an explicit discharge/vent outlet.');
  const reachable=new Set(roots.map(p=>p.id));let changed=true;while(changed){changed=false;for(const e of n.edges){const from=supply?e.from:e.to,to=supply?e.to:e.from;if(reachable.has(from)&&!reachable.has(to)){reachable.add(to);changed=true;}}}
  const disconnected=n.nodes.filter(p=>!reachable.has(p.id));if(disconnected.length)fail('Disconnected or reversed-flow nodes: '+disconnected.map(p=>p.id).join(', ')+'. Every node must connect in flow direction to its source/outlet.');
  // Drainage circuits cannot circulate; every branch must drain to a terminal.
  if(!supply){const visiting=new Set(),done=new Set(),visit=id=>{if(visiting.has(id))fail('Drainage/vent cycles are invalid.');if(done.has(id))return;visiting.add(id);n.edges.filter(e=>e.from===id).forEach(e=>visit(e.to));visiting.delete(id);done.add(id);};n.nodes.forEach(p=>visit(p.id));}
  if(!Array.isArray(n.assumptions)||n.assumptions.length>20||!n.assumptions.every(x=>str(x,240)))fail('List supplied design facts and explicit assumptions (max 20 short notes).');
  return {network:n,rows,warnings};
 }
 function network(N,a){
  const s=sheet(N,a),r=validateNetwork(a),n=r.network,es=[],l=systems[n.system],group='network:'+s+':'+n.id,h=a.textHeight;
  if(!N.units?.get().insunits)fail('Set actual drawing units before drawing a measured service network.');
  if(!finite(h)||h<=0)fail('Supply positive textHeight in drawing units.');
  const nodes=new Map(n.nodes.map(p=>[p.id,p])),sources=[],unit={1:'in',2:'ft',4:'mm',5:'cm',6:'m'}[N.units.get().insunits]||'units';
  for(const p of n.nodes){
   if(p.fixtureId!==undefined){const e=N.doc.entities.find(e=>String(e.id)===String(p.fixtureId)&&!e.aisel),b=e&&N.geom.entityBounds(e);if(!b||p.x<b.minx-1e-6||p.x>b.maxx+1e-6||p.y<b.miny-1e-6||p.y>b.maxy+1e-6)fail('Fixture node '+p.id+' must use an actual inspected fixture ID and a connection point within its bounds.');sources.push({id:String(e.id),signature:signature(e)});}
   else if(p.role==='fixture')r.warnings.push({code:'FIXTURE_UNLINKED',node:p.id,message:'Fixture point has no linked CAD source; verify its actual connection.'});
  }
  const old=N.doc.entities.filter(e=>e.aiGroup===group),occupied=N.doc.entities.filter(e=>!old.includes(e)&&['text','mtext'].includes(e.type)).map(e=>N.geom.entityBounds(e)).filter(Boolean);
  const label=(text,p)=>{const e={type:'text',str:text,p,h,rot:0,layer:'P-ANNO',color:'ByLayer'};es.push(e);const b=N.geom.entityBounds(e);if(b)occupied.push(b);return e;};
  const tag=(text,p)=>{
   let candidate;outer:for(const distance of [1.5,3,5,8,12,18])for(const [dx,dy]of [[1,1],[-1,1],[1,-1],[-1,-1],[0,1],[0,-1]]){
    const pos={x:p.x+dx*h*distance-(dx<0?text.length*h*.7:0),y:p.y+dy*h*distance},box=N.geom.entityBounds({type:'text',str:text,p:pos,h,rot:0});
    if(box&&!occupied.some(b=>clash(box,{minx:b.minx-h*.3,miny:b.miny-h*.3,maxx:b.maxx+h*.3,maxy:b.maxy+h*.3}))) {candidate=pos;break outer;}
   }
   const pos=candidate||{x:p.x+h*20,y:p.y+h*20};label(text,pos);
   es.push({type:'line',a:p,b:{x:pos.x,y:pos.y},layer:'P-ANNO',color:'ByLayer'});
  };
  const prefix=n.id.slice(0,12);

  for(const [i,e]of n.edges.entries()){
   const ps=[nodes.get(e.from),...(e.via||[]),nodes.get(e.to)].map(p=>({x:p.x,y:p.y}));
   es.push({type:'polyline',pts:ps,closed:false,layer:l,color:'ByLayer',aiService:{sheet:s,network:n.id,edge:r.rows[i].edge,role:'pipe'}});
   // Arrow follows the longest actual segment, scaled down in tight spaces.
   const seg=ps.slice(1).map((p,i)=>({a:ps[i],b:p,len:Math.hypot(p.x-ps[i].x,p.y-ps[i].y)})).sort((a,b)=>b.len-a.len)[0],dx=(seg.b.x-seg.a.x)/seg.len,dy=(seg.b.y-seg.a.y)/seg.len,q={x:(seg.a.x+seg.b.x)/2,y:(seg.a.y+seg.b.y)/2},size=Math.min(h*1.5,seg.len/5);
   for(const side of [-1,1])es.push({type:'line',a:q,b:{x:q.x-dx*size-dy*size*.4*side,y:q.y-dy*size+dx*size*.4*side},layer:l,color:'ByLayer'});
   tag(prefix+'-'+(i+1),q);
  }
  n.nodes.forEach((p,i)=>tag(prefix+'.N'+(i+1),p));
  // Keep full dimensions and levels in a measured schedule, outside tight rooms.
  const fmt=v=>v===null||v===undefined?'TBD':Number(v.toFixed(4)).toString();
  const lines=[n.id+' / '+n.system.toUpperCase()+' / units '+unit,'PIPE | FROM > TO | LENGTH | DIAMETER | INVERT FROM > TO | FALL',
   ...r.rows.map((row,i)=>prefix+'-'+(i+1)+' | N'+(n.nodes.findIndex(p=>p.id===n.edges[i].from)+1)+' > N'+(n.nodes.findIndex(p=>p.id===n.edges[i].to)+1)+' | '+fmt(row.length)+' | '+fmt(row.diameter)+' | '+fmt(row.fromLevel)+' > '+fmt(row.toLevel)+' | '+(row.slope===null?'unverified':(row.slope*100).toFixed(2)+'%')),
   'NODE KEY',...n.nodes.map((p,i)=>'N'+(i+1)+' = '+p.id+' / '+p.role+' / z '+fmt(p.z)),
   'Geometric routing only; capacity and installation require design inputs.'];
  const base=bounds(N,N.doc.entities.filter(e=>e.aiGroup===s||e.aiplanGroup===s))||bounds(N,es),width=Math.max(...lines.map(x=>x.length))*h*.8+4*h,height=(lines.length+1)*h*2.5;
  let origin=a.scheduleOrigin?clone(a.scheduleOrigin):{x:base.maxx+8*h,y:base.maxy};if(!pt(origin))fail('Schedule origin must be finite.');
  let clear=false;for(let attempt=0;attempt<15;attempt++){const box={minx:origin.x-h,miny:origin.y-height,maxx:origin.x+width,maxy:origin.y+2*h};
   if(!N.doc.entities.some(e=>!old.includes(e)&&!e.aisel&&clash(box,N.geom.entityBounds(e)))&&!es.some(e=>clash(box,N.geom.entityBounds(e)))){clear=true;break;}
   if(a.scheduleOrigin)break;origin.x+=width+8*h;
  }if(!clear)fail('Choose an empty scheduleOrigin; there is no clear space for the pipe schedule.');
  lines.forEach((line,i)=>label(line,{x:origin.x,y:origin.y-i*h*2.5}));
  es[0].aiNetwork={sheet:s,network:n,rows:r.rows,warnings:r.warnings,sources,units:N.units.get().insunits};
  return {entities:es,blocks:{},group,replace:N.doc.entities.some(e=>e.aiGroup===group),...r};
 }
 function seal(N,ids){
  // Called immediately after a successful atomic write, before any await/render work.
  const es=N.doc.entities.filter(e=>ids.includes(String(e.id))),carrier=es.find(e=>e.aiNetwork);
  if(carrier)carrier.aiNetwork.geometry=es.map(e=>({id:String(e.id),signature:signature(e)}));
  const legend=es.find(e=>e.aiLegend);if(legend)legend.aiLegend.geometry=es.map(e=>({id:String(e.id),signature:signature(e)}));
 }
 function review(N,a,context={}){
  const s=sheet(N,a),rows=manifest(N,s),findings=[],add=(code,message,ids=[])=>findings.push({code,message,ids:ids.slice(0,20)});
  const all=N.doc.entities,ps=placements(N,s),legends=all.filter(e=>e.aiLegend?.sheet===s),networks=all.filter(e=>e.aiNetwork?.sheet===s);
  const stale=refs=>(refs||[]).some(r=>{const e=all.find(e=>String(e.id)===r.id);return !e||signature(e)!==r.signature});
  if(context.scopeIds||context.scopeBounds&&!context.referenceSelection) return {ok:false,error:'Clear the selection for a complete sheet coordination review. A cropped inspection cannot certify the entire sheet.'};
  if(ps.length&&!legends.length)add('LEGEND_MISSING','Generate symbol_legend from the actual placements.');
  if(legends.length>1)add('DUPLICATE_LEGEND','More than one tracked legend belongs to this sheet.');
  for(const c of legends){if(JSON.stringify(c.aiLegend.rows)!==JSON.stringify(rows))add('LEGEND_STALE','Symbol counts, definitions or labels changed. Regenerate symbol_legend.',[String(c.id)]);if(stale(c.aiLegend.geometry))add('LEGEND_EDITED','The generated legend was manually edited. Regenerate it.',[String(c.id)]);}
  const definitions=new Map();for(const r of rows){const prior=definitions.get(r.key);if(prior&&prior!==r.name)add('SYMBOL_VARIANT_CONFLICT','Key '+r.key+' names different definitions. Use one definition or distinct keys.');definitions.set(r.key,r.name);}
  for(const e of ps)if(!N.doc.blocks[e.name])add('SYMBOL_DEFINITION_MISSING','A placed symbol has no block definition.',[String(e.id)]);
  for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){const a=ps[i],b=ps[j];if(clash(bounds(N,[a]),bounds(N,[b])))add('SYMBOL_OVERLAP','Device graphics overlap; inspect the pair and coordinate access.',[String(a.id),String(b.id)]);if(findings.length>100)break;}
  const networkRows=[];for(const e of networks){const m=e.aiNetwork;networkRows.push({id:m.network.id,system:m.network.system,nodes:m.network.nodes,edges:m.network.edges,assumptions:m.network.assumptions,rows:m.rows,state:stale(m.geometry)||stale(m.sources)||N.units.get().insunits!==m.units?'stale':'current'});if(stale(m.geometry)||stale(m.sources)||N.units.get().insunits!==m.units)add('NETWORK_STALE','Network '+m.network.id+' or linked fixtures changed. Rebuild its directed graph.',[String(e.id)]);for(const w of m.warnings)add(w.code,m.network.id+': '+w.message);}
  const base=all.filter(e=>e.aiGroup===s||e.aiplanGroup===s),b=bounds(N,base.filter(e=>!e.aiSymbol&&!e.aiNetwork));
  if(b)for(const e of ps){const q=bounds(N,[e]);if(q&&(q.minx<b.minx||q.maxx>b.maxx||q.miny<b.miny||q.maxy>b.maxy))add('SYMBOL_OUTSIDE_BASE','Symbol extends beyond the working base bounds; check its placement.',[String(e.id)]);}
  const untracked=all.filter(e=>!e.aiSymbol&&!e.aiService&&!e.aiNetwork&&!/^legend:|^network:/.test(e.aiGroup||'')&&/^[EPM]-/.test(layer(N,e))&&(e.aiGroup===s||b&&clash(b,N.geom.entityBounds(e))));
  if(untracked.length)add('UNTRACKED_SERVICE_GEOMETRY',untracked.length+' service primitives are not linked to registered symbols/networks; their legend/connectivity has not been verified.',untracked.map(e=>String(e.id)));
  if(!ps.length&&!networks.length)add('NO_TRACKED_CONTENT','No registered coordination symbols or service networks were found. Legacy/manual drawings require inspection; this is not a clean bill of health.');
  return {ok:true,action:'coordination_review',sheet:s,status:findings.length?'needs_review':'checks_passed',symbols:rows,networks:networkRows,findings:findings.slice(0,100),limitations:['Checks cover registered symbols/legends, graph connectivity, supplied gravity levels and stale references only. No hydraulic sizing, load calculation, code approval, full wall/door collision or fabrication verification.'],summary:findings.length?findings.length+' coordination findings to review.':'Registered symbols, legend and network data are consistent.'};
 }
 async function run(N,a,context={}){try{
  if(a.action==='design_context')return root.NasjDrawingQuality.designContext(N,a,context);
  if(a.action==='drawing_review')return root.NasjDrawingQuality.review(N,a,context);
  if(a.action==='coordination_review')return review(N,a,context);
  const spec=a.action==='symbol_legend'?legend(N,a):a.action==='symbol_register'?register(N,a):a.action==='service_network'?network(N,a):symbols(N,a),group=spec.group||a.group||a.sheet;
  const r=root.NasjCadDocument.run(N,{action:'apply',revision:a.revision,...(spec.ids?{ids:spec.ids}:{group}),...(spec.replace?{erase:true}:{})},{...context,generated:spec,generatedGroup:group,afterGenerated:ids=>seal(N,ids)});
  if(!r.ok)return r;
  return {...r,action:a.action,sheet:a.sheet,...(spec.rows?{rows:spec.rows}:{}),...(spec.network?{network:spec.network}:{}),...(spec.warnings?{findings:spec.warnings}:{}),summary:a.action==='symbol_legend'?'Generated legend from the same block definitions and actual placement counts.':a.action==='service_network'?'Created a connected, directed service network. Review remaining design inputs.':'Placed reusable, identifiable symbols on discipline layers.'};
 }catch(e){return {ok:false,error:String(e.message||e)}}}
 root.NasjCoordination={run,review,validateNetwork,libraryMetadata,manifest,signature};if(typeof module!=='undefined')module.exports=root.NasjCoordination;
})(typeof window!=='undefined'?window:globalThis);
