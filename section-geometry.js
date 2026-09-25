/* Orthographic sections through measured wall solids. XY and heights stay in
 * drawing units. A bounded view sees cut solids and the nearest surfaces beyond
 * the cut; it never projects the opposite half of the building into the view. */
(function(root){
 'use strict';
 const E=1e-7, fail=s=>{throw Error(s)}, sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y}), dot=(a,b)=>a.x*b.x+a.y*b.y;
 const unique=a=>[...new Set(a)].sort((a,b)=>a-b).filter((x,i,a)=>!i||x-a[i-1]>E);
 const finite=n=>Number.isFinite(n)&&Math.abs(n)<1e8;
 function section(m,a){
  const A=a.cut?.a,B=a.cut?.b;
  if(!A||!B||![A.x,A.y,B.x,B.y].every(finite))fail('Give two measured section cut points.');
  const L=Math.hypot(B.x-A.x,B.y-A.y);if(L<E)fail('Section cut points must be different.');
  const u={x:(B.x-A.x)/L,y:(B.y-A.y)/L},sign=a.look==='right'?-1:1,n={x:-u.y*sign,y:u.x*sign};
  if(a.look!==undefined&&!['left','right'].includes(a.look))fail('Section look must be left or right relative to cut a → b.');
  const depth=a.depth===undefined?Infinity:a.depth;if(!(depth>0)||depth!==Infinity&&!finite(depth))fail('Section depth must be positive in drawing units.');
  const project=p=>({x:dot(sub(p,A),u),y:dot(sub(p,A),n)});
  const solids=m.walls.map(original=>{
   const off=original.sectionOffset||{x:0,y:0},w={...original,a:{x:original.a.x+off.x,y:original.a.y+off.y},b:{x:original.b.x+off.x,y:original.b.y+off.y}};
   const v=sub(w.b,w.a),l=Math.hypot(v.x,v.y),q={x:-v.y/l*w.thickness/2,y:v.x/l*w.thickness/2};
   return {id:w.id,wall:w,base:w.base,top:w.base+w.height,poly:[{x:w.a.x+q.x,y:w.a.y+q.y},{x:w.b.x+q.x,y:w.b.y+q.y},{x:w.b.x-q.x,y:w.b.y-q.y},{x:w.a.x-q.x,y:w.a.y-q.y}].map(project)};
  });
  for(const e of m.elements||[])solids.push({id:e.id,element:e,base:e.base,top:e.base+e.height,poly:e.footprint.map(project)});
  // Include cut/far-plane intersections and opening jambs in the cell grid.
  const xs=[0,L],zs=[];
  for(const s of solids){
   xs.push(...s.poly.map(p=>p.x));zs.push(s.base,s.top);
   for(let i=0;i<s.poly.length;i++){const p=s.poly[i],q=s.poly[(i+1)%s.poly.length];for(const d of [0,depth])if(finite(d)&&(p.y-d)*(q.y-d)<0)xs.push(p.x+(q.x-p.x)*(d-p.y)/(q.y-p.y));}
   if(s.wall)for(const h of m.openings.filter(h=>h.wallId===s.id)){
    const w=s.wall,v=sub(w.b,w.a),l=Math.hypot(v.x,v.y);for(const t of [h.at,h.at+h.width])for(const side of [-1,1])xs.push(project({x:w.a.x+v.x*t/l-v.y/l*w.thickness/2*side,y:w.a.y+v.y*t/l+v.x/l*w.thickness/2*side}).x);
    zs.push(w.base+h.sill,w.base+h.sill+h.height);
   }
  }
  // At a crossing of oblique faces the nearest surface changes inside a span.
  const edges=solids.flatMap(s=>s.poly.map((p,i)=>[p,s.poly[(i+1)%s.poly.length]]));
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
   const [p,q]=edges[i],[r,t]=edges[j],v=sub(q,p),w=sub(t,r),d=v.x*w.y-v.y*w.x;if(Math.abs(d)<E)continue;
   const b=sub(r,p),f=(b.x*w.y-b.y*w.x)/d,g=(b.x*v.y-b.y*v.x)/d;
   if(f>E&&f<1-E&&g>E&&g<1-E){const y=p.y+f*v.y;if(y>=0&&y<=depth)xs.push(p.x+f*v.x);}
  }
  const X=unique(xs.filter(x=>x>=0&&x<=L)),Z=unique(zs),cells=[];
  if(X.length*Z.length*solids.length>3000000)fail('Narrow the section depth or simplify the measured model.');
  const interval=(poly,x)=>{
   const hits=[];for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length];if(Math.abs(p.x-q.x)<E)continue;if(x>=Math.min(p.x,q.x)-E&&x<=Math.max(p.x,q.x)+E)hits.push(p.y+(q.y-p.y)*(x-p.x)/(q.x-p.x));}
   return hits.length?[Math.min(...hits),Math.max(...hits)]:null;
  };
  const visibleWalls=new Set(),visibleOpenings=new Set(),visibleElements=new Set();
  for(let i=0;i<X.length-1;i++){cells[i]=[];const x=(X[i]+X[i+1])/2;for(let j=0;j<Z.length-1;j++){
   const z=(Z[j]+Z[j+1])/2,candidates=[];
   for(const s of solids){
    if(z<s.base||z>s.top)continue;const r=interval(s.poly,x);if(!r||r[1]<-E||r[0]>depth+E)continue;
    const d=Math.max(0,r[0]),cut=r[0]<=E&&r[1]>=-E;let opening=null;
    if(s.wall){const p={x:A.x+u.x*x+n.x*d,y:A.y+u.y*x+n.y*d},w=s.wall,v=sub(w.b,w.a),l=Math.hypot(v.x,v.y),t=dot(sub(p,w.a),v)/l;
     opening=m.openings.find(h=>h.wallId===w.id&&t>h.at-E&&t<h.at+h.width+E&&z>w.base+h.sill-E&&z<w.base+h.sill+h.height+E);
     // Open doorways and openings intersected by the cut reveal the next room.
     if(opening&&(opening.kind==='door'||cut))continue;
    }
    candidates.push({s,d,cut,opening,kind:opening?'opening':s.element?'element':cut?'cut':'wall'});
   }
   const c=candidates.sort((a,b)=>a.d-b.d||Number(b.cut)-Number(a.cut))[0]||null;cells[i][j]=c;
   if(c){if(c.s.wall)visibleWalls.add(c.s.id);else visibleElements.add(c.s.id);if(c.opening)visibleOpenings.add(c.opening.id);}
  }}
  const segments=[],layer=c=>c?.cut?'A-SECT-CUT':c?.opening?'A-SECT-OPENING':c?.s.element?'A-SECT-FIXTURE':'A-SECT-PROJ';
  const different=(a,b)=>!a!==!b||a&&b&&!(a.s.id===b.s.id&&a.kind===b.kind&&a.opening?.id===b.opening?.id)&&(a.kind!==b.kind||a.opening?.id!==b.opening?.id||a.s.element?.id!==b.s.element?.id||Math.abs(a.d-b.d)>E);
  const edge=(a,b,x1,z1,x2,z2)=>{if(!different(a,b))return;const c=[a,b].filter(Boolean).sort((a,b)=>Number(b.cut)-Number(a.cut)||Number(!!b.opening)-Number(!!a.opening)||a.d-b.d)[0];segments.push({x1,z1,x2,z2,layer:layer(c)});};
  for(let i=0;i<X.length;i++)for(let j=0;j<Z.length-1;j++)edge(cells[i-1]?.[j],cells[i]?.[j],X[i],Z[j],X[i],Z[j+1]);
  for(let i=0;i<X.length-1;i++)for(let j=0;j<Z.length;j++)edge(cells[i]?.[j-1],cells[i]?.[j],X[i],Z[j],X[i+1],Z[j]);
  // Merge adjacent edges for clean editable geometry and bounded tool results.
  const bins=new Map();for(const s of segments){const h=Math.abs(s.z1-s.z2)<E,f=h?s.z1:s.x1,k=s.layer+':'+h+':'+f.toFixed(7);if(!bins.has(k))bins.set(k,{h,f,layer:s.layer,runs:[]});bins.get(k).runs.push(h?[s.x1,s.x2]:[s.z1,s.z2]);}
  const out=[];for(const b of bins.values()){const merged=[];for(const r of b.runs.sort((a,b)=>a[0]-b[0])){const p=merged.at(-1);if(p&&r[0]<=p[1]+E)p[1]=Math.max(p[1],r[1]);else merged.push(r.slice());}for(const [l,r]of merged)out.push(b.h?{x1:l,z1:b.f,x2:r,z2:b.f,layer:b.layer}:{x1:b.f,z1:l,x2:b.f,z2:r,layer:b.layer});}
  return {segments:out,visibleWallIds:[...visibleWalls],visibleOpeningIds:[...visibleOpenings],visibleElementIds:[...visibleElements],look:a.look||'left',viewVector:n,depth:finite(depth)?depth:null,cutLength:L};
 }
 root.NasjSectionGeometry={section};if(typeof module!=='undefined')module.exports={section};
})(typeof window!=='undefined'?window:globalThis);
