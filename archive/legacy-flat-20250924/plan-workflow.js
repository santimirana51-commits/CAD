/* Architectural preflight. Pure geometry: previews never mutate the drawing. */
(function(root) {
  'use strict';
  const Plan = root.NasjPlan || (typeof require === 'function' && require('./plan.js'));
  const round = n => Math.round(n * 100) / 100;
  const area = ps => Math.abs(Plan._test.polyArea(ps));
  const box = ps => ({minx:Math.min(...ps.map(p=>p.x)),miny:Math.min(...ps.map(p=>p.y)),maxx:Math.max(...ps.map(p=>p.x)),maxy:Math.max(...ps.map(p=>p.y))});
  const length = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const outdoors = k => /^(garden|terrace|driveway|patio|balcony|courtyard|pool|parking|outdoor)$/.test(k);
  const privateRoom = k => /bed|master|guest|maid|bath|wc|toilet|store|garage|utility|laundry|classroom|consultation|treatment|exam|operating|patient/.test(k);
  const clone = x => JSON.parse(JSON.stringify(x));
  const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  function validatePlot(plot) {
    if (!plot || !Array.isArray(plot.pts) || plot.pts.length < 3 || plot.pts.length > 160 || plot.pts.some(p=>!p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw Error('Inspect a closed measured boundary with 3–160 vertices.');
    const ps=plot.pts;
    for(let i=0;i<ps.length;i++) for(let j=i+2;j<ps.length;j++) {
      if(i===0&&j===ps.length-1)continue;
      const a=ps[i],b=ps[(i+1)%ps.length],c=ps[j],d=ps[(j+1)%ps.length];
      if(cross(a,b,c)*cross(a,b,d)<-1e-10 && cross(c,d,a)*cross(c,d,b)<-1e-10) throw Error('The site boundary crosses itself. Correct the survey outline before planning.');
    }
    if(area(ps)<1)throw Error('The measured site has less than 1 m². Verify units and scale.');
    return ps;
  }
  // A scanline can have several intervals on a concave site; never bridge a notch.
  function intervals(ps,axis,at) {
    const other=axis==='y'?'x':'y',values=[];
    for(let i=0;i<ps.length;i++) {
      const a=ps[i],b=ps[(i+1)%ps.length];
      if((a[axis]<=at&&b[axis]>at)||(b[axis]<=at&&a[axis]>at)) values.push(a[other]+(at-a[axis])*(b[other]-a[other])/(b[axis]-a[axis]));
    }
    values.sort((a,b)=>a-b);const spans=[];
    for(let i=0;i+1<values.length;i+=2)spans.push([round(values[i]),round(values[i+1])]);
    return spans;
  }
  function analyse(plot,setback) {
    const ps=validatePlot(plot), build=Plan.buildablePolygon(ps,setback);
    if(!build)throw Error('The supplied setbacks leave no usable site. Revise the brief, not the survey.');
    const b=box(build), bands=axis=>Array.from({length:11},(_,i)=>{
      const at=b['min'+axis]+(b['max'+axis]-b['min'+axis])*(i+.5)/11;
      return {at:round(at),spans:intervals(build,axis,at)};
    });
    return {units:'metres in the site frame',area:round(area(ps)),buildableArea:round(area(build)),bounds:b,vertices:build.map(p=>({x:round(p.x),y:round(p.y)})),
      horizontalBands:bands('y'),verticalBands:bands('x'),usableCore:usableCore(build,.25),
      instructions:'Each band lists usable intervals, not bounding-box area. Put circulation in connected wide bands; reserve tapered ends for suitable secondary/open space. Respect exact corners and supplied setbacks. Do not stretch a rectangular villa template across this site.',
      nextSkill:'plan_program'};
  }
  // Conservative sampled inscribed rectangle. Its area is a lower bound, not
  // an assertion that no other furniture orientation can fit the room.
  function usableCore(ps,padding=.12,minWidth=0) {
    const b=box(ps), nx=28,ny=28,dx=(b.maxx-b.minx)/nx,dy=(b.maxy-b.miny)/ny;
    if(dx<=0||dy<=0)return null;
    const inside=p=>Plan._test.pointInPoly(ps,p)||ps.some((a,i)=>{
      const c=ps[(i+1)%ps.length];return Math.abs(cross(a,c,p))<1e-7&&p.x>=Math.min(a.x,c.x)-1e-8&&p.x<=Math.max(a.x,c.x)+1e-8&&p.y>=Math.min(a.y,c.y)-1e-8&&p.y<=Math.max(a.y,c.y)+1e-8;
    });
    const heights=Array(nx).fill(0);let best=null,bestArea=0,qualified=null,qualifiedArea=0;
    for(let y=0;y<ny;y++) {
      for(let x=0;x<nx;x++) {
        const x0=b.minx+x*dx,y0=b.miny+y*dy,qs=[{x:x0,y:y0},{x:x0+dx,y:y0},{x:x0+dx,y:y0+dy},{x:x0,y:y0+dy}];
        const valid=qs.every(inside)&&!ps.some(p=>p.x>x0+1e-8&&p.x<x0+dx-1e-8&&p.y>y0+1e-8&&p.y<y0+dy-1e-8)&&qs.every((p,i)=>{
          const q=qs[(i+1)%4];return Plan.clipStrokes([[p,q]],ps).reduce((sum,r)=>sum+r.slice(1).reduce((s,v,j)=>s+length(r[j],v),0),0)>=length(p,q)-1e-6;
        });
        heights[x]=valid?heights[x]+1:0;
      }
      const stack=[];
      for(let x=0;x<=nx;x++) {
        const h=x===nx?0:heights[x];let start=x;
        while(stack.length&&stack.at(-1).h>h){const v=stack.pop(),w=(x-v.x)*dx-2*padding,d=v.h*dy-2*padding;start=v.x;
          if(w>0&&d>0){const r={x:round(b.minx+v.x*dx+padding),y:round(b.miny+(y+1-v.h)*dy+padding),w:round(w),h:round(d),area:round(w*d)};if(w*d>bestArea){bestArea=w*d;best=r;}if(Math.min(w,d)+.025>=minWidth&&w*d>qualifiedArea){qualifiedArea=w*d;qualified=r;}}
        }
        if(!stack.length||stack.at(-1).h<h)stack.push({x:start,h});
      }
    }
    return qualified||best;
  }
  function validateProgram(program) {
    if(!Array.isArray(program)||!program.length||program.length>40)throw Error('List a compact room program (1–40 rooms) before preview, with IDs, functions and area/width targets.');
    const ids=new Set();
    return program.map(r=>{
      if(!r||!/^[a-z][a-z0-9_]{0,39}$/.test(r.id)||ids.has(r.id)||typeof r.kind!=='string'||!['user','assumption'].includes(r.basis)||!Number.isFinite(r.minArea)||r.minArea<=0||!Number.isFinite(r.minWidth)||r.minWidth<=0)throw Error('Each program room needs a unique ID, kind, positive minArea/minWidth and basis user or assumption.');
      ids.add(r.id);return {id:r.id,kind:r.kind,minArea:r.minArea,minWidth:r.minWidth,basis:r.basis,accessVia:r.accessVia||null};
    });
  }
  function preview(layout,ctx,previousProgram,previousLayout) {
    if(layout.patch){
      if(!previousLayout)throw Error('Preview a complete candidate before patching its failing rooms.');
      const changes=layout.rooms||[];
      if(!Array.isArray(changes))throw Error('Room patches must be an array.');
      const rooms=clone(previousLayout.rooms),seen=new Set();
      for(const change of changes){if(seen.has(change.id))throw Error('Duplicate patched room ID.');seen.add(change.id);const index=rooms.findIndex(r=>r.id===change.id);if(index<0)rooms.push(clone(change));else rooms[index]={...rooms[index],...clone(change)};}
      layout={...clone(previousLayout),...clone(layout),rooms,patch:false};
    }
    const program=validateProgram(layout.program||previousProgram);
    const ordered=p=>JSON.stringify([...p].sort((a,b)=>a.id.localeCompare(b.id)));
    if(previousProgram && ordered(program)!==ordered(validateProgram(previousProgram)))throw Error('Keep this turn’s room program and targets. Do not drop rooms or lower requirements to hide a failed candidate; ask about a genuinely infeasible brief.');
    if(!Array.isArray(layout.rooms)||layout.rooms.length>50)throw Error('Use at most 50 layout cells.');
    const plot=ctx&&ctx.plot;
    if(plot)validatePlot(plot);
    const candidate={...clone(layout),program:clone(program),action:'draw',fill:false,fit:'boundary'};
    const out=Plan.compile(candidate,ctx);
    if(!out.ok)return {out,program,report:{ok:true,action:'preview',ready:false,findings:[{code:'COMPILE_FAILED',severity:'error',message:out.error}],summary:'Candidate could not be compiled. No drawing changed.'}};
    const findings=[],add=(code,message,room,severity='error')=>findings.push({code,message,room,severity});
    const ids=new Set();
    for(const r of layout.rooms){
      if(ids.has(r.id))add('DUPLICATE_ROOM','Duplicate room ID '+r.id+'.',r.id);ids.add(r.id);
      if(!['x','y','w','h'].every(k=>Number.isFinite(r[k]))||r.w<=0||r.h<=0)add('INVALID_ROOM','Room needs finite coordinates and positive dimensions.',r.id);
      if(plot&&(r.x<-.025||r.y<-.025||r.x+r.w>plot.W+.025||r.y+r.h>plot.H+.025))add('EXTENT_CHANGED','Room '+r.id+' extends outside the local site extent; the legacy compiler would silently slide or shrink it. Correct its coordinates.',r.id);
    }
    const metrics=[];
    for(const req of program) {
      const r=out.rooms.find(r=>r.id===req.id);
      if(!r||r.outdoor&&!outdoors(req.kind)||r.kind!==req.kind){add('MISSING_ROOM','Required '+req.id+' was lost, converted to open ground or relabelled.',req.id);continue;}
      const supplied=Number(layout.wall?.exterior),wall=Number.isFinite(supplied)&&supplied>0?Math.max(.1,Math.min(.6,supplied)):.25;
      const core=usableCore(r.points,outdoors(r.kind)?0:wall,req.minWidth);
      metrics.push({id:r.id,kind:r.kind,area:r.area,points:r.points,usableCore:core,target:req});
      if(r.area+0.05<req.minArea)add('ROOM_AREA',r.id+' has '+r.area+' m²; target is '+req.minArea+' m² ('+req.basis+').',r.id);
      if(!core||Math.min(core.w,core.h)+.05<req.minWidth)add('USABLE_WIDTH',r.id+' has no verified rectangular usable core '+req.minWidth+' m wide after wall allowance. Change its position/shape or verify a different orientation.',r.id);
    }
    for(const r of layout.rooms)if(!outdoors(r.kind)&&!program.some(p=>p.id===r.id))add('UNTRACKED_ROOM','Include '+r.id+' in the initial program; requirements may not silently change.',r.id);
    for(let i=0;i<layout.rooms.length;i++)for(let j=i+1;j<layout.rooms.length;j++) {
      const a=layout.rooms[i],b=layout.rooms[j],w=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x),h=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
      if(w>.05&&h>.05)add('ROOM_OVERLAP',a.id+' overlaps '+b.id+'; align shared edges before drawing.',a.id);
    }
    const rooms=out.rooms.filter(r=>!r.outdoor), links=out.connections.filter(c=>!c.vehicleOnly), graph=new Map([['outside',[]],...rooms.map(r=>[r.id,[]])]);
    for(const c of links){const a=c.from,b=c.to;if(graph.has(a)&&graph.has(b)){graph.get(a).push(b);graph.get(b).push(a);}}
    const reach=(restricted=false)=>{const seen=new Set(['outside']),q=['outside'];for(let i=0;i<q.length;i++){if(restricted&&q[i]!=='outside'&&privateRoom(rooms.find(r=>r.id===q[i])?.kind||''))continue;for(const next of graph.get(q[i])||[])if(!seen.has(next)){seen.add(next);q.push(next);}}return seen;};
    const all=reach(),publicReach=reach(true);
    for(const r of rooms){const req=program.find(p=>p.id===r.id),via=req?.accessVia;
      if(!all.has(r.id))add('INACCESSIBLE_ROOM',r.id+' has no pedestrian route from an exterior door.',r.id);
      else if(!publicReach.has(r.id)&&!(via&&publicReach.has(via)&&(graph.get(via)||[]).includes(r.id)))add('PRIVATE_TRANSIT',r.id+' requires passage through a private, teaching, treatment or service room. Connect it to circulation; an intentional en-suite needs accessVia.',r.id);
    }
    for(const d of layout.doors||[]) {
      const match=out.connections.find(c=>(c.from===d.from&&c.to===d.to)||(c.from===d.to&&c.to===d.from));
      if(!match){
        const a=layout.rooms.find(r=>r.id===d.from),b=layout.rooms.find(r=>r.id===d.to);let hint='';
        if(a&&b){const dx=Math.max(a.x-(b.x+b.w),b.x-(a.x+a.w),0),dy=Math.max(a.y-(b.y+b.h),b.y-(a.y+a.h),0);
          hint=dx||dy?' The cells are separated by '+round(dx)+' m in X and '+round(dy)+' m in Y. Room cells include walls: use equal shared-edge coordinates, never add a wall-thickness gap.':' Ensure a continuous shared wall longer than the door plus jambs; corner contact is not a doorway.';}
        add('MISSING_DOOR','Requested door '+d.from+' → '+d.to+' was not placed.'+hint,d.from);
      }
      else if(d.width&&match.width+.02<d.width)add('NARROW_DOOR','Door '+d.from+' → '+d.to+' was reduced to '+match.width+' m.',d.from);
    }
    if(plot)for(const r of rooms)for(let i=0;i<r.points.length;i++){
      const a=r.points[i],b=r.points[(i+1)%r.points.length],kept=Plan.clipStrokes([[a,b]],plot.pts).reduce((s,run)=>s+run.slice(1).reduce((t,p,j)=>t+length(run[j],p),0),0);
      if(kept<length(a,b)-.001){add('BOUNDARY_CROSSING','Room crosses a concave notch; split the building into connected wings.',r.id);break;}
    }
    for(const fault of out.faults||[])add('COMPILER_FINDING',fault,null,/planning preference|review whether/.test(fault)?'warning':'error');
    for(const name of out.unfurnished||[])add('FURNITURE_MISSING','Inspect and furnish '+name+' after the layout passes.',name,'warning');
    const ready=!findings.some(f=>f.severity==='error');
    const report={ok:true,action:'preview',ready,stage:ready?'layout_checked':'revise_layout',program,rooms:metrics,connections:out.connections,findings,
      layout:{rooms:candidate.rooms,doors:candidate.doors||[],wall:candidate.wall,setback:candidate.setback},siteArea:out.stats.siteArea,indoorArea:round(out.rooms.filter(r=>!r.outdoor).reduce((n,r)=>n+r.area,0)),unallocatedArea:out.stats.siteArea==null?null:round(out.stats.siteArea-out.rooms.reduce((n,r)=>n+r.area,0)),
      limits:['Concept preflight only. Usable cores are conservative sampled rectangles after wall allowance; not code or construction approval.','Door graph does not prove obstacle-free or accessible circulation. Inspect furniture, door swings and snapshots after placement.'],
      nextSkill:ready?'plan_delivery':'plan_layout',summary:ready?'Candidate passed the specified concept checks; commit this preview, then inspect/furnish the actual CAD.':'Candidate needs correction. No drawing changed; adjust the failing rooms before another preview.'};
    // Keep advisory size preferences out of the red defect count shown to users.
    const preference=message=>/planning preference|review whether/.test(message);
    out.faults=(out.faults||[]).filter(message=>!preference(message));
    out.notes=(out.notes||[]).map(message=>preference(message)?message.replace(/^FAULT:\s*/, 'Review: '):message);
    out.stats.faults=out.faults.length;
    return {out,program,layout:candidate,report};
  }
  function session(previous,contextKey) {
    return previous&&previous.contextKey===contextKey?previous:{contextKey,count:0,program:null,candidate:null};
  }
  function rememberSetback(state,value) {
    if(value===undefined)return state.setback;
    const raw=typeof value==='number'?{front:value,side:value,rear:value}:value===false?{}:value;
    if(!raw||typeof raw!=='object')throw Error('Supply nonnegative measured setbacks.');
    const normalized={};for(const k of ['front','side','rear']){const n=raw[k]??0;if(!Number.isFinite(n)||n<0)throw Error('Supply nonnegative measured setbacks.');normalized[k]=n;}
    if(state.setback&&JSON.stringify(state.setback)!==JSON.stringify(normalized))throw Error('Keep the measured setbacks from this planning turn; do not remove site constraints to pass a preview.');
    state.setback=normalized;return normalized;
  }
  function setProgram(state,raw,plot,setback) {
    const program=validateProgram(raw);
    if(state.program&&JSON.stringify([...state.program].sort((a,b)=>a.id.localeCompare(b.id)))!==JSON.stringify([...program].sort((a,b)=>a.id.localeCompare(b.id))))throw Error('The room program is already fixed for this turn; keep IDs, functions and numerical targets.');
    const fixedSetback=rememberSetback(state,setback),site=plot?analyse(plot,fixedSetback):null,minimumArea=round(program.reduce((sum,r)=>sum+r.minArea,0));
    const ready=!site||minimumArea<=site.buildableArea;
    if(ready)state.program=program;
    return {ok:true,action:'program',ready,program,site,budget:{minimumRoomArea:minimumArea,availableArea:site?.buildableArea??null,remainingArea:site?round(site.buildableArea-minimumArea):null},
      summary:ready?'Room program recorded. Next lay out exact shared room edges; no geometry changed.':'The requested minimum room area exceeds the available site. Reconcile concept assumptions or ask about the explicit brief before layout.',
      limits:['Area budget alone is not a geometric fit. minWidth is the shorter clear furniture-core dimension, after wall allowance; plan appropriate circulation and tapered residual land.'],nextSkill:ready?'plan_layout':'plan_program'};
  }
  function prepare(state,layout,ctx,fingerprint) {
    if(state.count>=6)throw Error('Six candidate previews used. Explain the measured feasibility conflict and smallest needed brief change; do not place a failed plan.');
    state.count++;
    // An unsuccessful newer attempt must invalidate the older passing preview.
    state.candidate=null;
    const fixedSetback=rememberSetback(state,layout.setback);
    const candidate=preview({...layout,...(fixedSetback?{setback:fixedSetback}:{})},ctx,state.program,state.layout);state.program=candidate.program;if(candidate.layout)state.layout=candidate.layout;
    const previewId='preview-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
    state.candidate={...candidate,previewId,fingerprint};
    return {...candidate.report,previewId,attempt:state.count};
  }
  function accept(state,previewId,fingerprint) {
    const candidate=state.candidate;
    if(!candidate||candidate.previewId!==previewId||candidate.fingerprint!==fingerprint)throw Error('This preview is missing or stale. Inspect the current site and preview the layout again.');
    if(!candidate.report.ready)throw Error('The preview still has blocking layout findings. Correct its rooms and connections before committing.');
    state.candidate=null;
    return candidate;
  }
  const api={analyse,preview,usableCore,validateProgram,intervals,session,rememberSetback,setProgram,prepare,accept};root.NasjPlanWorkflow=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
