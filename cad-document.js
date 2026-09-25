/* Bounded native drafting. No evaluated code, commands, network or filesystem.
 * Every write follows an inspection of the same, unchanged document and is one Undo. */
(function (root) {
  'use strict';
  const snapshots = new WeakMap();
  const copy = x => JSON.parse(JSON.stringify(x));
  const finite = n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e9;
  const point = p => p && finite(p.x) && finite(p.y);
  const fail = message => { throw new Error(message); };
  const number = (v, fallback, min = -1e9) => v === undefined ? fallback : finite(v) && v >= min ? v : fail('Invalid numeric argument.');
  const safeText = (v, max = 240) => typeof v === 'string' && v.length <= max && !/[\u0000-\u0008]/.test(v) ? v : fail('Invalid text.');
  const color = v => /^#[0-9a-f]{6}$/i.test(v || '') || v === 'ByLayer' ? v : fail('Use a six-digit hex color or ByLayer.');
  const union = boxes => {
    const b = {minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity};
    for (const x of boxes) if (x && Object.values(x).every(finite)) {
      b.minx = Math.min(b.minx, x.minx); b.miny = Math.min(b.miny, x.miny);
      b.maxx = Math.max(b.maxx, x.maxx); b.maxy = Math.max(b.maxy, x.maxy);
    }
    return Number.isFinite(b.minx) ? b : null;
  };
  function run(N, args, context = {}) {
    try {
      const a = {...(args || {})}, d = N.doc, ops = N.docOps, G = N.geom;
      if (!d || !ops || !G) fail('Open a drawing first.');
      const gen = () => N.docGen(d);
      const layer = id => d.layers.find(l => l.id === id);
      const bounds = es => union(es.map(e => G.entityBounds(e)));
      if (a.action==='apply' && a.finish && !a.group && !a.ids && !a.layer && !a.entities && !a.transform && !a.style && !a.erase) {
        const groups=new Set(d.entities.map(e=>e.aiplanGroup||e.aiGroup).filter(Boolean));
        if(groups.size===1) a.group=[...groups][0];
      }
      const idSet = a.ids === undefined ? null : Array.isArray(a.ids) && a.ids.length <= 5000 ? new Set(a.ids.map(String)) : fail('Use at most 5000 entity IDs.');
      const box = context.scopeBounds;
      const allowed = context.referenceSelection ? new Set((context.allowedIds || []).map(String)) : null;
      const scopeIds = Array.isArray(context.scopeIds) ? new Set(context.scopeIds.map(String)) : null;
      const contained = e => { if(allowed?.has(String(e.id)))return true;const b=G.entityBounds(e); return !box || b && b.minx>=box.minx-1e-7 && b.miny>=box.miny-1e-7 && b.maxx<=box.maxx+1e-7 && b.maxy<=box.maxy+1e-7; };
      let target = d.entities.filter(e => !e.aisel && (!scopeIds || scopeIds.has(String(e.id))) && contained(e) && (!idSet || idSet.has(String(e.id))) && (!a.group || e.aiplanGroup === a.group || e.aiGroup === a.group) && (!a.layer || (layer(e.layerId) || {}).name === a.layer));
      if (a.action === 'inspect') {
        const previous = snapshots.get(d), generation = gen(), space = d.$space && d.$space.L;
        // Reading another page, scope or quantity must not invalidate an unchanged drawing.
        const revision = previous && previous.gen === generation && previous.entities === d.entities && previous.space === space
          ? previous.revision : 'cad-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        snapshots.set(d, { revision, gen: generation, entities: d.entities, space });
        const groups = new Map();
        for (const e of d.entities) {
          const key = e.aiplanGroup || e.aiGroup;
          if (!key) continue;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(e);
        }
        const offset = number(a.offset, 0, 0);
        const sample = target.slice(offset, offset + 80).map(e => {
          const out = { id: String(e.id), type: e.type, layer: (layer(e.layerId) || {}).name, bounds: G.entityBounds(e) };
          for (const k of ['a','b','p','c','r','a0','a1','closed','str','h','rot','name','sx','sy','p1','p2','p3','kind','orient','color','aiFurniture','aiGroup','aiSymbol','aiLibrary','aiService','aiViewReference']) if (e[k] !== undefined) out[k] = copy(e[k]);
          if (e.pts) { out.pts = copy(e.pts.slice(0, 32)); out.pointsTotal = e.pts.length; }
          return out;
        });
        return { ok: true, action: 'inspect', revision, units: N.units && N.units.get ? N.units.get().insunits : 0,
          coordinateSystem: (d.$space ? 'Paper layout is active. Switch to Model before native drafting. ' : '') + 'Current drawing units, world XY, x right y up. Unit codes: 0 unspecified, 1 inches, 2 feet, 4 mm, 5 cm, 6 metres. Never guess a physical scale when units are unspecified.',
          scopeBounds: box || null, documentTotal: d.entities.filter(e=>!e.aisel).length,
          scopeIds: scopeIds ? [...scopeIds] : null,
          inspectionScope: scopeIds ? 'Only explicitly picked entities are editable. Other objects, including touching or overlapping objects, are protected.' : box && context.referenceSelection ? 'AI selection is a source reference, not an output boundary. Listed source objects and this task’s created objects are editable; unrelated existing objects are protected. New sheets, services and annotations may extend outside. working_copy with an inspected group copies its complete geometry without editing the source; no ID paging is needed.' : box ? 'AI selection: ONLY fully contained entities are listed. Outside and crossing entities still exist and are protected; this is NOT the entire drawing.' : 'Matching entities in the drawing; IDs, group or layer filters may narrow this list.',
          total: target.length, bounds: bounds(target), selected: Array.from(N.selection || []).map(String),
          layers: d.layers.slice(0, 100).map(l => ({ id: String(l.id), name: l.name, locked: !!l.locked, on: l.on, color: l.color })),
          groups: Array.from(groups).slice(-30).map(([id, es]) => ({ id, count: es.length, bounds: bounds(es), rooms: (es.find(e => e.aiRooms) || {}).aiRooms || [] })),
          entities: sample, nextOffset: offset + sample.length < target.length ? offset + sample.length : null,
          summary: 'Inspected ' + target.length + (box && !context.referenceSelection ? ' fully contained entities in the marked area' : ' matching entities') + '; no changes.' };
      }
      if (a.action !== 'apply') fail('Unknown native CAD action.');
      if (d.$space) fail('Switch to the Model tab before native drafting. Paper layout edits and print-scale setup are not supported by this tool.');
      if(!a.revision)fail('Missing revision: copy the exact revision returned by the latest cad_document inspect into this write request. Re-inspecting without passing revision will fail again.');
      const snap = snapshots.get(d);
      if (!snap || snap.revision !== a.revision || snap.gen !== gen() || snap.entities !== d.entities || snap.space !== (d.$space && d.$space.L)) fail('The drawing changed since inspection. Inspect it again before editing.');
      if (idSet && target.length !== idSet.size) return {ok:false,error:'Inspect the target again before editing: one or more IDs are missing or outside the allowed selection.',code:'TARGET_IDS_UNAVAILABLE',missingIds:[...idSet].filter(id=>!target.some(e=>String(e.id)===id)).slice(0,30),recovery:'Call cad_document inspect for the current group/layer; use only returned IDs. Do not retry guessed or shortened IDs.'};
      const scoped = idSet || a.group || a.layer;
      const finishNew = a.finish && !scoped && Array.isArray(a.entities) && a.entities.length && !a.transform && !a.style && !a.erase;
      const alters = a.transform || a.style || a.erase || a.finish || context.building;
      if (alters && !finishNew && (!scoped || !target.length)) fail('Choose explicit IDs, an inspected group, or an inspected layer for this edit.');
      if (alters && !finishNew && target.some(e => (layer(e.layerId) || {}).locked)) fail('The target includes a locked layer. Unlock it before editing.');
      if (target.length > 5000 && alters && !finishNew) fail('Edit at most 5000 entities per operation. Narrow the selection.');
      if (a.erase && (a.transform || a.style || a.finish)) fail('Erase cannot be combined with other changes to the same target.');
      if (a.transform && !(a.allowPartialGroup === true && idSet && target.length === 1)) {
        const ids = new Set(target.map(e=>e.id));
        const groups = new Set(target.map(e=>e.aiplanGroup || e.aiGroup).filter(Boolean));
        if (d.entities.some(e=>groups.has(e.aiplanGroup || e.aiGroup) && !ids.has(e.id) && (e.type==='dim' || e.aiFinish))) fail('This moves only part of an annotated group and would leave its dimensions or title behind. Transform the complete inspected group. Use group from inspection to move the object with its annotations. The individual-feature exception accepts one explicit entity ID only; it cannot move the entire part without its annotations.');
      }
      if(scopeIds && ((a.entities?.length && (!a.erase || !idSet)) || a.finish || context.building))fail('An element pick permits edits or an atomic replacement (erase plus entities with explicit IDs) of that element only. Clear it or mark an area for unrelated geometry.');
      const additions = [], replacements = new Map(), finishParts = new Set();
      const sourceGroups = new Set(target.map(e => e.aiplanGroup || e.aiGroup).filter(Boolean));
      const group = a.group || (scoped && sourceGroups.size === 1 ? [...sourceGroups][0] : 'native-' + Date.now().toString(36));
      const finishKey = finishNew ? group : a.group || (a.layer ? 'layer:' + a.layer : 'ids:' + [...(idSet || [])].sort().join(','));
      const overall = bounds(target);
      const defaultHeight = overall ? Math.max(overall.maxx-overall.minx,overall.maxy-overall.miny)/120 || 1 : 1;
      const prepare = raw => {
        if (!raw || typeof raw !== 'object') fail('Invalid entity.');
        const e = {type: raw.type, layer: safeText(raw.layer || (raw.type==='text'?'A-ANNO-TEXT':raw.type==='dim'?'A-ANNO-DIMS':raw.type==='hatch'?'A-HATCH':'AI-GEOMETRY'), 80), color: raw.color === undefined ? 'ByLayer' : color(raw.color), aiGroup: group};
        const pt = k => { if (!point(raw[k])) fail('Missing or invalid point ' + k + '.'); e[k] = {x: raw[k].x, y: raw[k].y}; };
        switch (e.type) {
          case 'line': pt('a'); pt('b'); break;
          case 'circle': pt('c'); e.r = number(raw.r, 0, 1e-9); if (!e.r) fail('Radius must be positive.'); break;
          case 'arc': pt('c'); e.r = number(raw.r, 0, 1e-9); e.a0 = number(raw.a0, 0); e.a1 = number(raw.a1, 0); if (!e.r || e.a0 === e.a1) fail('Arc needs a radius and sweep.'); break;
          case 'polyline':
            if (!Array.isArray(raw.pts) || raw.pts.length < 2 || raw.pts.length > 500 || !raw.pts.every(point)) fail('Polyline requires 2–500 finite XY points.');
            e.pts = raw.pts.map(p => ({x:p.x,y:p.y})); e.closed = raw.closed === true; break;
          case 'text': pt('p'); e.str = safeText(raw.str, 1000); e.h = number(raw.h, defaultHeight, 1e-6); if (!e.h) fail('Text needs a positive height.'); e.rot = number(raw.rot, 0); e.ha = 0; break;
          case 'dim':
            pt('p1'); pt('p2'); pt('p3'); e.kind = raw.kind === 'aligned' ? 'aligned' : 'linear'; e.orient = raw.orient === 'v' ? 'v' : 'h';
            e.h = number(raw.h, defaultHeight, 1e-6); if (!e.h) fail('Dimension needs a positive text height.'); break;
          case 'hatch':
            if (!Array.isArray(raw.pts) || raw.pts.length < 3 || raw.pts.length > 500 || !raw.pts.every(point)) fail('Solid fill requires a closed polygon of 3–500 points.');
            e.boundary = {kind:'pline',closed:true,pts:raw.pts.map(p => ({x:p.x,y:p.y}))}; e.pattern = 'SOLID'; e.scale = 1; e.angle = 0; break;
          default: fail('Unsupported native entity type.');
        }
        return e;
      };
      if (a.entities !== undefined) {
        if (!Array.isArray(a.entities) || a.entities.length > 500) fail('Add at most 500 entities per operation.');
        a.entities.forEach(e => additions.push(prepare(e)));
      }
      // Trusted workspace generators only; never populated from public tool arguments.
      // Keep block definitions and semantic metadata inside the same undo transaction.
      const generated=context.generated;
      if(generated){
        if(scopeIds) fail('Clear the element pick before adding coordination objects.');
        if(!Array.isArray(generated.entities)||generated.entities.length>1500) fail('Too many coordination objects.');
        additions.push(...copy(generated.entities).map(e=>({...e,aiGroup:context.generatedGroup||group})));
        for(const key of Object.keys(generated.blocks||{})) if(d.blocks[key]) fail('A generated block name already exists. Inspect again.');
      }
      if (context.workingCopy) {
        const c=context.workingCopy;
        if(scopeIds) fail('Clear the element pick before creating a separate working copy.');
        // Copying reads the full identified group but never changes it. Its
        // title/dimensions may cross the reference box around the plan.
        if(c.source.some(e=>!target.includes(e)) && !(context.referenceSelection && a.group && target.length)) fail('Every working-copy source must be inside the inspected scope.');
        if(c.entities.length>5000) fail('Copy at most 5000 entities at once.');
        const move=p=>({x:p.x+c.dx,y:p.y+c.dy});
        for(const src of c.entities){
          const e=copy(src);for(const k of ['id','aiBuilding','aiplan','aiplanGroup','aiplanOrigin','aiPlanLayout','aiPlanSignature','aiPlanReport','aiFinish','aiFinishPart','aiSymbol','aiService','aiNetwork','aiLegend'])delete e[k];
          G.translateEntity(e,c.dx,c.dy);
          if(e.aiRooms)e.aiRooms=e.aiRooms.map(r=>({...r,points:r.points.map(move)}));
          if(e.aiWalls)e.aiWalls=e.aiWalls.map(ps=>ps.map(move));
          e.aiGroup=context.copyGroup;e.aiWorkingSource=String(src.id);e.layer=(layer(src.layerId)||{}).name||'0';
          additions.push(e);
        }
      }
      for (const src of alters && !a.erase && !finishNew ? target : []) {
        const e = copy(src);
        if (a.transform) {
          const t = a.transform, base = t.origin || {x:0,y:0};
          if (!point(base)) fail('Invalid transform origin.');
          const scale = number(t.scale, 1, 1e-6), angle = number(t.rotate, 0), dx = number(t.dx, 0), dy = number(t.dy, 0);
          if (scale > 1e4) fail('Scale is too large.');
          const map = p => { const x=(p.x-base.x)*scale, y=(p.y-base.y)*scale; return {x:base.x+x*Math.cos(angle)-y*Math.sin(angle)+dx,y:base.y+x*Math.sin(angle)+y*Math.cos(angle)+dy}; };
          if (e.type === 'dim' && e.kind === 'linear' && Math.abs(Math.sin(angle)) > 1e-9) {
            const vertical=e.orient==='v', direction=angle+(vertical?Math.PI/2:0);
            if (Math.abs(Math.sin(direction))<1e-9) e.orient='h';
            else if (Math.abs(Math.cos(direction))<1e-9) e.orient='v';
            else if (Math.abs(vertical?e.p2.x-e.p1.x:e.p2.y-e.p1.y)<1e-8) {e.kind='aligned';delete e.orient;}
            else fail('This rotation needs a projected dimension orientation that the editor cannot represent. Keep the current dimension or recreate it after rotating the geometry.');
          }
          G.scaleEntityAbout(e, base, scale); G.rotateEntityAbout(e, base, angle); G.translateEntity(e, dx, dy);
          if (e.aiWalls) e.aiWalls = e.aiWalls.map(ps=>ps.map(map));
          if (e.aiRooms) e.aiRooms = e.aiRooms.map(r => ({...r, points:r.points.map(map)}));
          // A moved generated plan must not subsequently restore an obsolete frame.
          if (e.aiplanOrigin) delete e.aiplanOrigin;
        }
        if (a.style) {
          if (a.style.color !== undefined) e.color = color(a.style.color);
          if (a.style.layer !== undefined) e.layer = safeText(a.style.layer, 80);
        }
        if (a.transform || a.style) replacements.set(src.id, e);
      }
      const finish = a.finish;
      if (finish) {
        if (a.transform || a.erase) fail('Finish the sheet after a separate transform and inspection.');
        const content = finishNew ? additions.slice() : target.filter(e => !e.aiFinish);
        const measured = content.filter(e => !/(?:^|[-_ ])(?:CENTER|CENTRE|AXIS|AXES|GRID|ANNO|SHEET)(?:$|[-_ ])/i.test(e.layer || (layer(e.layerId)||{}).name || ''));
        const b = bounds(measured.length ? measured : content);
        if (!b) fail('The target has no measurable geometry.');
        const size = Math.max(b.maxx-b.minx,b.maxy-b.miny), h = number(finish.textHeight, size/100, 1e-6);
        if (!(h > 0)) fail('Cannot dimension zero-size geometry.');
        let part = 'dimensions';
        const add = e => { const x=prepare(e); x.aiFinishPart=part; finishParts.add(part); additions.push(x); };
        const dim = (p1,p2,p3,kind='aligned') => add({type:'dim',p1,p2,p3,h,kind,layer:'A-ANNO-DIMS'});
        if (finish.dimensions) {
          dim({x:b.minx,y:b.miny},{x:b.maxx,y:b.miny},{x:b.minx,y:b.miny-h*6});
          dim({x:b.minx,y:b.miny},{x:b.minx,y:b.maxy},{x:b.minx-h*6,y:b.miny});
          if (finish.dimensions === 'rooms') {
            const rooms = (content.find(e => e.aiRooms) || {}).aiRooms;
            if (!rooms || !rooms.length) fail('Room geometry is not available in this drawing. Use overall or explicit dimensions from inspected endpoints.');
            for (const r of rooms) {
              const ps=r.points, center=ps.reduce((s,p)=>({x:s.x+p.x/ps.length,y:s.y+p.y/ps.length}),{x:0,y:0});
              // Two longest non-parallel edges; real endpoints, no invented text override.
              const edges=ps.map((p,i)=>({p,q:ps[(i+1)%ps.length]})).sort((a,b)=>Math.hypot(b.q.x-b.p.x,b.q.y-b.p.y)-Math.hypot(a.q.x-a.p.x,a.q.y-a.p.y));
              let first=null;
              for (const e of edges) { const v={x:e.q.x-e.p.x,y:e.q.y-e.p.y},len=Math.hypot(v.x,v.y); if (len<h*8 || first && Math.abs(v.x*first.y-v.y*first.x)<len*Math.hypot(first.x,first.y)*.1) continue;
                const mid={x:(e.p.x+e.q.x)/2,y:(e.p.y+e.q.y)/2},sign=(center.x-mid.x)*(-v.y)+(center.y-mid.y)*v.x>=0?1:-1;
                dim(e.p,e.q,{x:mid.x-v.y/len*h*3*sign,y:mid.y+v.x/len*h*3*sign}); if (first) break; first=v;
              }
            }
          }
        }
        part = 'walls';
        if (finish.solidWalls) {
          const saved=(content.find(e=>e.aiWalls)||{}).aiWalls;
          let walls=saved || content.filter(e=>(layer(e.layerId)||{}).name==='A-WALL' && e.type==='polyline' && e.closed).map(e=>e.pts);
          if (!walls.length && root.NasjPlan && content.some(e=>e.aiplan)) {
            const candidates=content.filter(e=>(layer(e.layerId)||{}).name==='A-WALL');
            const scale=((content.find(e=>e.aiplanOrigin)||{}).aiplanOrigin||{}).xf?.scale || 1;
            const labels=content.filter(e=>e.type==='text'&&point(e.p));
            walls=root.NasjPlan.findLoops(candidates).filter(l=>{
              const perimeter=l.pts.reduce((s,p,i)=>s+Math.hypot(p.x-l.pts[(i+1)%l.pts.length].x,p.y-l.pts[(i+1)%l.pts.length].y),0);
              return l.area/perimeter < .35*scale && !labels.some(e=>root.NasjPlan._test.pointInPoly(l.pts,e.p));
            }).map(l=>l.pts);
          }
          if (!walls.length) fail('No wall material geometry in the target. Use a new generated plan or explicit closed wall polygons.');
          for (const pts of walls) add({type:'hatch',pts,color:'#000000',layer:'A-WALL-FILL'});
        }
        part = 'title';
        if (finish.title) {
          const pad=h*10,x=b.minx-pad,y=b.miny-pad*2,w=b.maxx-b.minx+pad*2,top=b.maxy+pad;
          add({type:'polyline',pts:[{x,y},{x:x+w,y},{x:x+w,y:top},{x,y:top}],closed:true,layer:'A-SHEET'});
          add({type:'line',a:{x,y:y+h*8},b:{x:x+w,y:y+h*8},layer:'A-SHEET'});
          add({type:'text',p:{x:x+h*2,y:y+h*5},str:safeText(finish.title),h:Math.min(h*1.5,(w-h*4)/(Math.max(1,finish.title.length)*.65)),layer:'A-SHEET'});
          add({type:'text',p:{x:x+h*2,y:y+h*2},str:safeText(finish.note || 'Concept drawing · verify dimensions and engineering requirements'),h:Math.min(h,(w-h*4)/(Math.max(1,(finish.note || 'Concept drawing · verify dimensions and engineering requirements').length)*.65)),layer:'A-SHEET'});
        }
        additions.filter(e => e.aiFinishPart).forEach(e => {e.aiFinish = finishKey; if (a.group && content.some(x=>x.aiplanGroup===a.group)) {e.aiplan=1;e.aiplanGroup=a.group;} });
      }
      if (context.building) {
        if(target.length!==1) fail('Choose one unlocked model carrier.');
        replacements.set(target[0].id, {...copy(target[0]),aiBuilding:copy(context.building)});
      }
      if (additions.length > (context.workingCopy ? 5000 : 1500)) fail('Too many generated annotations. Narrow the target.');
      const actualDoc=N.doc;
      try {
      if(generated?.blocks) N.doc={...d,blocks:{...d.blocks,...generated.blocks}};
      for (const e of [...additions,...replacements.values()]) {
        if(!context.referenceSelection && !contained(e)) fail('This edit would leave the marked AI selection. Enlarge or clear the selection first.');
        const box = G.entityBounds(e);
        if (!box || ![box.minx,box.miny,box.maxx,box.maxy].every(finite)) fail('The result exceeds the supported coordinate range.');
        if (e.layer !== undefined && !e.layer.trim()) fail('A layer name cannot be empty.');
        const ly=e.layer && d.layers.find(l=>l.name===e.layer);
        if (ly && ly.locked) fail('The destination layer is locked.');
      }
      } finally { N.doc=actualDoc; }
      if (!additions.length && !replacements.size && !a.erase) fail('No changes requested.');
      // Validation completed before the single mutation/undo boundary.
      // Full snapshot even if a manual drawing tool is active; scoped undo would miss additions.
      const active = N.tools && N.tools.activeName;
      if (active && !['select','none'].includes(active)) fail('Finish or cancel the active CAD command before applying this edit.');
      ops.pushUndo(d);
      const layerFor = name => {let l=d.layers.find(l=>l.name===name);if(!l) {l=ops.addLayer(d,name);const colors={'P-COLD':'#42a5f5','P-HOT':'#ef5350','P-WASTE':'#d4aa55','P-VENT':'#66bb6a','P-RAIN':'#26c6da'};if(colors[name]){l.color=colors[name];l.lw=.25;}if(name==='A-SECT-CUT')l.lw=.5;else if(/^A-SECT-/.test(name))l.lw=.18;}l.on=true;l.frozen=false;return l.id;};
      if(generated?.blocks) for(const [name,def] of Object.entries(copy(generated.blocks))){
        for(const e of def.entities){e.layerId=layerFor(e.layer||'0');delete e.layer;}
        d.blocks[name]=def;
      }
      const doomed=new Set(a.erase ? target.map(e=>e.id) : []);
      if (finish) d.entities.filter(e=>e.aiFinish===finishKey && finishParts.has(e.aiFinishPart)).forEach(e=>doomed.add(e.id));
      if (doomed.size) ops.deleteEntities(d,doomed);
      for (const [id,e] of replacements) { if (e.layer) {e.layerId=layerFor(e.layer);delete e.layer;} const dst=d.entities.find(x=>x.id===id); Object.assign(dst,e); if(a.transform) delete dst.aiplanOrigin; }
      const ids=[];
      for (const e of additions) {e.layerId=layerFor(e.layer);delete e.layer;const created=ops.addEntity(d,e);if(created) ids.push(created.id);}
      if(context.afterGenerated)context.afterGenerated(ids.map(String));
      d.modified=true; snapshots.delete(d); N.render();
      if (root.dispatchEvent) root.dispatchEvent(new CustomEvent('nasj:doc',{detail:{reason:'ai-native'}}));
      const revision = 'cad-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      snapshots.set(d,{revision,gen:gen(),entities:d.entities,space:d.$space && d.$space.L});
      return {ok:true,action:'apply',revision,group:context.copyGroup||context.generatedGroup||group,added:ids.length,changed:replacements.size,removed:doomed.size,ids:ids.map(String),changedIds:[...replacements.keys()].map(String),bounds:bounds(d.entities.filter(e=>ids.includes(e.id)||replacements.has(e.id))),
        summary:`Added ${ids.length}, changed ${replacements.size}, removed ${doomed.size} entities. One Undo reverses this operation.`,
        notes: finish && finish.dimensions==='rooms' ? ['Room dimensions measure layout cell edges; verify clear finished dimensions and clearances.'] : a.transform && a.allowPartialGroup === true ? ['An individual feature was edited. Review associated dimensions before relying on the sheet.'] : []};
    } catch (err) { return {ok:false,error:String(err.message || err)}; }
  }
  root.NasjCadDocument={run};
  if (typeof module !== 'undefined') module.exports={run};
})(typeof window !== 'undefined' ? window : globalThis);
