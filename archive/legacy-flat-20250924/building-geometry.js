/* Measured plan extraction and orthographic wall visibility. No model-generated XY. */
(function(root){
 'use strict';
 const EPS=1e-7, dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y), dot=(a,b)=>a.x*b.x+a.y*b.y;
 const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y}),fail=m=>{throw Error(m)};
 const unitsPerMetre={1:1/.0254,2:1/.3048,4:1000,5:100,6:1};
 const fromPlan=(N,a)=>{
  const scale=unitsPerMetre[N.units.get().insunits];if(!scale)fail('Set supported measured drawing units before deriving the building.');
  const groups=[...new Set(N.doc.entities.filter(e=>e.aiRooms&&(e.aiplanGroup||e.aiGroup)).map(e=>e.aiplanGroup||e.aiGroup))];
  const group=a.group||(groups.length===1?groups[0]:null);if(!group)fail('Choose the inspected plan group.');
  const es=N.doc.entities.filter(e=>e.aiplanGroup===group||e.aiGroup===group),anchor=es.find(e=>e.aiRooms);
  if(!anchor||!anchor.aiRooms.length)fail('This group has no measured room topology. Inspect the plan; do not invent its openings.');
  if(es.length>5000)fail('Review a coherent plan group with at most 5,000 entities.');
  const h=a.heights;if(!h||!['wall','door','window','windowSill'].every(k=>Number.isFinite(h[k]))||h.wall<=0||h.door<=0||h.window<=0||h.windowSill<0||h.door>h.wall||h.windowSill+h.window>h.wall||!Number.isFinite(h.base||0))fail('Supply valid wall, door, window and windowSill heights in drawing units.');
  if(h.garage!==undefined&&(!Number.isFinite(h.garage)||h.garage<=0||h.garage>h.wall))fail('The garage opening height must fit the wall.');
  if(!Array.isArray(a.assumptions)||!a.assumptions.length)fail('State the source or assumption for the supplied heights.');
  const p=q=>({x:q.x/scale,y:q.y/scale});
  const rooms=anchor.aiRooms.map(r=>({cell:r.points.map(p),outdoor:false}));
  const spec=anchor.aiPlanLayout?.wall||{},exterior=Math.min(.6,Math.max(.1,Number(spec.exterior)>0?Number(spec.exterior):.25)),interior=Math.min(.4,Math.max(.06,Number(spec.interior)>0?Number(spec.interior):.12));
  const pieces=root.NasjPlan.wallTopology(rooms,exterior,interior).filter(w=>w.cls!=='edge');
  const layers=new Map(N.doc.layers.map(l=>[l.id,l.name]));
  const edges=es.filter(e=>layers.get(e.layerId)==='A-WALL');
  const bbox=points=>({minx:Math.min(...points.map(p=>p.x)),maxx:Math.max(...points.map(p=>p.x)),miny:Math.min(...points.map(p=>p.y)),maxy:Math.max(...points.map(p=>p.y))});
  const actual=bbox(edges.flatMap(e=>e.pts||[e.a,e.b].filter(Boolean))),expected=bbox(anchor.aiRooms.flatMap(r=>r.points));
  if(!Object.keys(expected).every(k=>Number.isFinite(actual[k])&&Math.abs(actual[k]-expected[k])<scale*.002))fail('Room topology no longer matches the plan walls. Reconcile the edited plan before deriving views.');
  const lines=es.filter(e=>e.type==='line'),doorLines=lines.filter(e=>layers.get(e.layerId)==='A-DOOR');
  const intervals=[];
  const attach=(A,B,kind,sourceId,garage=false)=>{
   A=p(A);B=p(B);const L=dist(A,B);if(L<EPS)return;
   const candidates=pieces.map(w=>{const da=sub(A,w.a),db=sub(B,w.a),s0=dot(da,w.u),s1=dot(db,w.u),n0=dot(da,w.n),n1=dot(db,w.n);return {w,lo:Math.min(s0,s1),hi:Math.max(s0,s1),off:Math.abs((n0+n1)/2-w.c),parallel:Math.abs(n0-n1)<.002};}).filter(c=>c.parallel&&c.lo>=-.002&&c.hi<=c.w.len+.002&&c.off<=.35).sort((a,b)=>a.off-b.off);
   if(!candidates.length)fail('A plan opening no longer matches its host wall. Reconcile the plan before deriving views.');
   const c=candidates[0];intervals.push({wall:c.w.id,lo:Math.max(0,c.lo),hi:Math.min(c.w.len,c.hi),kind,garage,sourceIds:[String(sourceId)]});
  };
  for(const e of lines.filter(e=>layers.get(e.layerId)==='A-GLAZ'))attach(e.a,e.b,'window',e.id);
  const leaves=new Set();
  for(const e of es.filter(e=>e.type==='arc'&&layers.get(e.layerId)==='A-DOOR')){
   const ends=[e.a0,e.a1].map(t=>({x:e.c.x+e.r*Math.cos(t),y:e.c.y+e.r*Math.sin(t)}));
   const match=ends.map(t=>doorLines.find(l=>dist(l.a,e.c)<scale*.002&&dist(l.b,t)<scale*.002||dist(l.b,e.c)<scale*.002&&dist(l.a,t)<scale*.002));
   if(!match[0]&&!match[1])fail('A door swing has no matching leaf; reconcile the plan opening first.');
   const i=match[0]?0:1;leaves.add(match[i].id);attach(e.c,ends[1-i],'door',e.id);
  }
  // The remaining parallel A-DOOR lines are garage/shutter leaves, not swing leaves.
  for(const e of doorLines.filter(e=>!leaves.has(e.id)))attach(e.a,e.b,'door',e.id,true);
  const openings=[];
  for(const w of pieces){
   for(const kind of ['door','window']){
    const runs=intervals.filter(o=>o.wall===w.id&&o.kind===kind).sort((a,b)=>a.lo-b.lo),merged=[];
    for(const o of runs){const last=merged.at(-1);if(last&&o.lo<=last.hi+.002){last.hi=Math.max(last.hi,o.hi);last.sourceIds.push(...o.sourceIds)}else merged.push({...o,sourceIds:o.sourceIds.slice()});}
    for(const o of merged)openings.push({id:'plan-opening-'+openings.length,wallId:'plan-wall-'+w.id,at:o.lo*scale,width:(o.hi-o.lo)*scale,kind,garage:!!o.garage,sill:kind==='door'?0:h.windowSill,height:kind==='door'?(o.garage?h.garage||h.door:h.door):h.window,sourceIds:[...new Set(o.sourceIds)]});
   }
  }
  const walls=pieces.map(w=>({id:'plan-wall-'+w.id,a:{x:w.a.x*scale,y:w.a.y*scale},b:{x:w.b.x*scale,y:w.b.y*scale},sectionOffset:{x:w.n.x*w.c*scale,y:w.n.y*w.c*scale},thickness:w.t*scale,base:h.base||0,height:h.wall,exterior:w.cls==='ext',outward:w.out,roomIds:[w.L,w.R].map(i=>i>=0?anchor.aiRooms[i].id:'outside')}));
  return {name:'Measured plan building',sourceIds:es.filter(e=>e===anchor||['A-WALL','A-DOOR','A-GLAZ'].includes(layers.get(e.layerId))).map(e=>String(e.id)),walls,openings,elements:a.elements||[],assumptions:[...a.assumptions,'Opening positions/widths measured from CAD; wall thickness '+Math.round(exterior*1000)+' mm exterior / '+Math.round(interior*1000)+' mm internal from saved layout or compiler defaults. Verify construction build-ups.'],planGroup:group,measuredPlan:true,sectionGeometryVersion:2};
 };
 const elevation=(m,direction)=>{
  const x=p=>direction==='N'?-p.x:direction==='S'?p.x:direction==='E'?p.y:-p.y;
  const depth=p=>direction==='N'?p.y:direction==='S'?-p.y:direction==='E'?p.x:-p.x;
  const view={N:{x:0,y:1},S:{x:0,y:-1},E:{x:1,y:0},W:{x:-1,y:0}}[direction];
  if(!view)fail('Choose N, S, E or W.');
  const min=Math.min(...m.walls.flatMap(w=>[x(w.a),x(w.b)]));
  const walls=m.walls.filter(w=>w.exterior!==false&&(!w.outward||dot(w.outward,view)>EPS)).map(w=>{
   const A=x(w.a)-min,B=x(w.b)-min,lo=Math.min(A,B),hi=Math.max(A,B),da=depth(w.a),db=depth(w.b);
   return {...w,A,B,lo,hi,depth:q=>da+(db-da)*(q-A)/(B-A)};
  }).filter(w=>w.hi-w.lo>EPS);
  if(!walls.length)fail('No wall face is visible in this direction.');
  const unique=v=>[...new Set(v)].sort((a,b)=>a-b).filter((n,i,a)=>!i||n-a[i-1]>EPS);
  const breaks=walls.flatMap(w=>[w.lo,w.hi]);
  for(let i=0;i<walls.length;i++)for(let j=i+1;j<walls.length;j++){
   const a=walls[i],b=walls[j],lo=Math.max(a.lo,b.lo),hi=Math.min(a.hi,b.hi);if(hi-lo<EPS)continue;
   const dl=a.depth(lo)-b.depth(lo),dh=a.depth(hi)-b.depth(hi);if(dl*dh<0)breaks.push(lo+(hi-lo)*dl/(dl-dh));
  }
  const xs=unique(breaks),zs=unique(walls.flatMap(w=>[w.base,w.base+w.height])),cells=[];
  if(xs.length*zs.length>50000)fail('Simplify the wall model before projecting this view.');
  for(let i=0;i<xs.length-1;i++){cells[i]=[];for(let j=0;j<zs.length-1;j++){
   const q=(xs[i]+xs[i+1])/2,z=(zs[j]+zs[j+1])/2;
   cells[i][j]=walls.filter(w=>q>w.lo-EPS&&q<w.hi+EPS&&z>w.base-EPS&&z<w.base+w.height+EPS).sort((a,b)=>b.depth(q)-a.depth(q))[0]||null;
  }}
  const segments=[],push=(x1,z1,x2,z2,layer)=>{if(Math.hypot(x2-x1,z2-z1)>EPS)segments.push({x1,z1,x2,z2,layer})};
  for(let i=0;i<xs.length;i++)for(let j=0;j<zs.length-1;j++){
   const a=cells[i-1]?.[j],b=cells[i]?.[j];if(!!a!==!!b||a&&b&&Math.abs(a.depth(xs[i])-b.depth(xs[i]))>EPS)push(xs[i],zs[j],xs[i],zs[j+1],'A-ELEV');
  }
  for(let i=0;i<xs.length-1;i++)for(let j=0;j<zs.length;j++){
   const a=cells[i]?.[j-1],b=cells[i]?.[j],q=(xs[i]+xs[i+1])/2;if(!!a!==!!b||a&&b&&Math.abs(a.depth(q)-b.depth(q))>EPS)push(xs[i],zs[j],xs[i+1],zs[j],'A-ELEV');
  }
  const visibleOpenings=new Set(),visibleWalls=new Set(cells.flat().filter(Boolean).map(w=>w.id));
  for(const w of walls)for(const h of m.openings.filter(h=>h.wallId===w.id)){
   const L=dist(w.a,w.b),a=w.A+(w.B-w.A)*h.at/L,b=w.A+(w.B-w.A)*(h.at+h.width)/L,lo=Math.min(a,b),hi=Math.max(a,b),bottom=w.base+h.sill,top=bottom+h.height;
   const edges=[[lo,bottom,hi,bottom],[hi,bottom,hi,top],[hi,top,lo,top],[lo,top,lo,bottom]];
   for(const [x1,z1,x2,z2]of edges)for(let i=0;i<xs.length-1;i++)for(let j=0;j<zs.length-1;j++){
    if(cells[i][j]?.id!==w.id||Math.min(hi,xs[i+1])-Math.max(lo,xs[i])<=EPS||Math.min(top,zs[j+1])-Math.max(bottom,zs[j])<=EPS)continue;
    if(Math.abs(z2-z1)<EPS){if(z1<zs[j]-EPS||z1>zs[j+1]+EPS)continue;const l=Math.max(Math.min(x1,x2),xs[i]),r=Math.min(Math.max(x1,x2),xs[i+1]);if(r-l>EPS){push(l,z1,r,z1,'A-OPENING');visibleOpenings.add(h.id)}}
    else{if(x1<xs[i]-EPS||x1>xs[i+1]+EPS)continue;const l=Math.max(Math.min(z1,z2),zs[j]),r=Math.min(Math.max(z1,z2),zs[j+1]);if(r-l>EPS){push(x1,l,x1,r,'A-OPENING');visibleOpenings.add(h.id)}}
   }
  }
  // Union collinear pieces: no repeated wall outlines or internal coplanar seams.
  const bins=new Map();for(const s of segments){const horizontal=Math.abs(s.z1-s.z2)<EPS,fixed=horizontal?s.z1:s.x1,key=s.layer+':'+horizontal+':'+fixed.toFixed(6);if(!bins.has(key))bins.set(key,{horizontal,fixed,layer:s.layer,runs:[]});bins.get(key).runs.push(horizontal?[Math.min(s.x1,s.x2),Math.max(s.x1,s.x2)]:[Math.min(s.z1,s.z2),Math.max(s.z1,s.z2)]);}
  const out=[];for(const b of bins.values()){const merged=[];for(const r of b.runs.sort((a,b)=>a[0]-b[0])){const p=merged.at(-1);if(p&&r[0]<=p[1]+EPS)p[1]=Math.max(p[1],r[1]);else merged.push(r.slice())}for(const [l,r]of merged)out.push(b.horizontal?{x1:l,z1:b.fixed,x2:r,z2:b.fixed,layer:b.layer}:{x1:b.fixed,z1:l,x2:b.fixed,z2:r,layer:b.layer});}
  return {segments:out,visibleWallIds:[...visibleWalls],visibleOpeningIds:[...visibleOpenings]};
 };
 root.NasjBuildingGeometry={fromPlan,elevation};if(typeof module!=='undefined')module.exports={fromPlan,elevation};
})(typeof window!=='undefined'?window:globalThis);
