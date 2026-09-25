/** src/agent/panel/plan-runner.js — REAL ESM migrated from agent-panel.js:3280-3555 */
import { st } from './state.js';
import { NEUTRAL } from '../../shared/config/tunables.js';
import { errText } from '../../shared/utils/helpers.js';
const N = () => window.Nasj || {};

// --- BEGIN MIGRATED SLICE ---
  /* ================================================================== *
   * draw_plan — real CAD from a room layout (plan.js)
   * ------------------------------------------------------------------
   * The agent's layout is rooms in metres in the plot's own frame. The
   * compiler cuts them to the land, raises the walls, hangs the doors and
   * windows, furnishes and labels; this end scales metres into drawing
   * units, turns the result back into the world and applies it in ONE undo
   * step on its own layers. Nothing is traced and nothing is guessed: the
   * picture path stays for what is not a plan of rooms.
   * ================================================================== */
  const planRuns = new WeakMap();
  const planCandidates = new WeakMap();
  const runPlan = async (args, row) => {
    const Plan = window.NasjPlan;
    if (!Plan) return toolFail(row, 'the plan engine is not available in this build.', NEUTRAL.plan);
    let a = args && typeof args === 'object' ? args : {};
    const repair = a.action === 'repair', reviewing = a.action === 'review';
    const staging = ['analyze','program','preview','commit'].includes(a.action);
    row.brief = a.action && a.action !== 'draw' ? a.action + ' the generated plan' : Plan.describe(a);
    toolProgress(row, 'setting out…');
    paintTool(row);
    const t0 = now();
    let at = st.attachment;
    /* the prompt box is bound to a selection but the attachment carries no
       plot (the picture path built it): read the land off the selection the
       way an attached sel-N is read */
    if (at && !Array.isArray(at.plot) && st.region && st.region.selId != null) {
      const ent = (N.doc && N.doc.entities || []).find((e) => e.id === st.region.selId);
      const sb = ent && selBounds(ent);
      const site = sb && largestBoundaryIn(sb);
      const fr = sb ? (site ? plotFrame(site.pts, sb, true) : rectFrame(sb)) : null;
      if (fr) at = Object.assign({}, at, { exact: true, ids: site ? site.ids : at.ids, bbox: Object.assign({}, fr.obb),
        frame: fr.turned ? { theta: fr.theta, c: fr.c, turned: true } : null, plot: fr.pts, landKey: site ? site.ids[0] : st.region.selId });
    }
    const doc = N.doc;
    if (!doc) return toolFail(row, 'Open a drawing first.', 'Open a drawing first.');
    const landKey = at && at.exact ? String(at.landKey ?? (at.ids && at.ids[0]) ?? at.label) : null;
    let runs = planRuns.get(doc);
    if (!runs) { runs = new Map(); planRuns.set(doc, runs); }
    let previous = runs.get(landKey);
    /* NJC preserves entity metadata. Recover the latest generated group after
       reopening a file, so a smaller revision cannot leave the old tail behind. */
    if (!previous) {
      const saved = doc.entities.findLast((e) => {
        const o = e.aiplanOrigin, xf = o && o.xf;
        return e.aiplan && typeof e.aiplanGroup === 'string' && o && o.landKey === landKey &&
          xf && ['scale', 'ox', 'oy', 'theta', 'cx', 'cy'].every((k) => num(xf[k])) && xf.scale > 0;
      });
      if (saved) {
        previous = { group: saved.aiplanGroup, landKey, xf: Object.assign({}, saved.aiplanOrigin.xf), history: null };
        runs.set(landKey, previous);
      }
    }
    const snapshot = (group) => doc.entities.filter((e) => e.aiplanGroup === group).map((e) => {
      const copy = JSON.parse(JSON.stringify(e));
      copy.layer = (doc.layers.find((l) => l.id === e.layerId) || {}).name || 'A-WALL';
      delete copy.id;
      return copy;
    });
    if(repair)st.turnPlanRepairAttempted=true;
    if(previous&&st.turnPlanRepairAttempted&&!repair&&!reviewing&&(!a.action||a.action==='draw'))return toolFail(row,'A bounded repair cannot be bypassed by regenerating the whole plan in the same turn. Use exact native corrections or report the unresolved design decision.','Whole-plan replacement refused after repair.');
    const carrier = previous && doc.entities.find(e=>e.aiplanGroup===previous.group && e.aiPlanLayout);
    if(repair || reviewing){
      if(!carrier){
        const message='This existing plan has no saved parametric layout. Use cad_document inspect for its actual group/IDs and continue native edits or service drafting. Do not recreate the plan or repeat a completed working_copy.';
        if(repair)return toolFail(row,message,message);
        const result={ok:true,action:'review',layoutAvailable:false,canRepair:false,layout:null,notes:[message],summary:'Existing CAD geometry is available; use native inspection instead of layout repair.'};toolOk(row,result.summary,result);return result;
      }
      const current=doc.entities.filter(e=>e.aiplanGroup===previous.group);
      if(window.NasjPlanRepair.fingerprint(current)!==carrier.aiPlanSignature) return toolFail(row,'The generated plan was edited. Inspect current geometry; automatic layout replacement would overwrite those changes.','The plan was edited.');
      if(reviewing){const result={ok:true,action:'review',layout:carrier.aiPlanLayout,report:carrier.aiPlanReport,group:previous.group,transform:previous.xf,summary:'Reviewed the saved plan layout and its actual compiler findings.'};toolOk(row,result.summary,result);return result;}
      try{a=window.NasjPlanRepair.patch(carrier.aiPlanLayout,a);}catch(e){return toolFail(row,errText(e),errText(e));}
    }
    if (a.action && a.action !== 'draw' && !staging) {
      if (!['show', 'remove', 'restore'].includes(a.action)) return toolFail(row, 'Unknown plan action.', 'Unknown plan action.');
      const current = previous ? snapshot(previous.group) : [];
      if (!previous || (!current.length && a.action !== 'restore')) {
        return toolFail(row, 'No generated plan from this session is available in this drawing.', 'No generated plan from this session is available in this drawing.');
      }
      let message;
      if (a.action === 'show') {
        const b = Plan.extent(current);
        if (!b || !frameBoxNow(b)) return toolFail(row, 'Switch to the 2D model view to show this plan.', 'Switch to the 2D model view to show this plan.');
        message = 'The view now shows the generated plan. No geometry changed.';
      } else if (a.action === 'remove') {
        opsForPlanRemove(doc, previous.group);
        previous.history = { entities: current, xf: previous.xf };
        message = 'Removed only the generated plan. Hand-drawn geometry is unchanged. Undo or restore brings the plan back.';
      } else {
        const old = previous.history;
        if (!old || !old.entities.length) return toolFail(row, 'No earlier plan revision is available in this session.', 'No earlier plan revision is available in this session.');
        applyPlan(old.entities, null, null, previous.group, previous.group, { landKey, xf: old.xf });
        previous.history = { entities: current, xf: previous.xf };
        previous.xf = old.xf;
        frameDrawn(row, Plan.extent(old.entities), st.appliedIds);
        message = 'Restored the preceding generated plan revision. Hand-drawn geometry is unchanged.';
      }
      const result = { ok: true, action: a.action, rooms: 0, doors: 0, windows: 0, stairs: 0, areas: [], notes: [message], faults: [], unfurnished: [] };
      toolOk(row, message, result);
      return result;
    }
    const replacing = a.mode !== 'add' && previous && previous.landKey === landKey &&
      doc.entities.some((e) => e.aiplanGroup === previous.group);
    let plot = null, xf = null, clearBox = null;
    let sw = 0;
    if (at && at.exact && Array.isArray(at.plot) && at.plot.length >= 3 && at.bbox) {
      const obb = at.bbox, fr = at.frame;
      let sc = planScale(obb.maxx - obb.minx, obb.maxy - obb.miny);
      /* the architect said how big the land really is: the drawn outline
         is read at that size, whatever the drawing's units suggested - and
         the land remembers it for the rest of the session */
      const key = at.landKey != null ? at.landKey : (at.ids && at.ids[0]);
      sw = Number(a.siteWidth);
      if (!(sw > 1) && key != null && stated[key] > 1) sw = stated[key];
      if (sw > 1 && obb.maxx - obb.minx > 0) { sc = (obb.maxx - obb.minx) / sw; if (key != null) stated[key] = sw; }
      plot = {
        pts: at.plot.map((p) => ({ x: (p.x - obb.minx) / sc, y: (p.y - obb.miny) / sc })),
        W: (obb.maxx - obb.minx) / sc, H: (obb.maxy - obb.miny) / sc
      };
      xf = { scale: sc, ox: obb.minx, oy: obb.miny,
        theta: fr ? fr.theta : 0, cx: fr ? fr.c.x : 0, cy: fr ? fr.c.y : 0 };
      /* the previous plan on this land is removed by its own mark (aiplan)
         when the new one is applied - never by geometry, which took the
         architect's survey lines and everything else in the drag with it */
      clearBox = null;
    }
    let out;
    if(staging){
      const workflow=window.NasjPlanWorkflow;
      if(!workflow)return toolFail(row,'Update the application to use staged planning.','Planning tools unavailable.');
      const fingerprint=window.NasjPlanRepair.fingerprint(doc.entities);
      const contextKey=JSON.stringify({plot,xf,epoch:st.sendEpoch});
      const state=workflow.session(planCandidates.get(doc),contextKey);planCandidates.set(doc,state);
      if(a.action==='analyze'){
        try{const result={ok:true,action:'analyze',site:plot?workflow.analyse(plot,workflow.rememberSetback(state,a.setback)):null,summary:plot?'Measured site and usable width bands. No geometry changed.':'No boundary supplied. Use explicit metre coordinates for a standalone concept and state the assumed footprint.',nextSkill:'plan_program'};toolOk(row,result.summary,result);return result;}catch(e){return toolFail(row,errText(e),errText(e));}
      }
      if(a.action==='program'){
        try{const result=workflow.setProgram(state,a.program,plot,a.setback);toolOk(row,result.summary,result);return result;}catch(e){return toolFail(row,errText(e),errText(e));}
      }
      if(a.action==='preview'){
        try{const result=workflow.prepare(state,a,{plot},fingerprint);toolOk(row,result.summary,result);return result;}
        catch(e){return toolFail(row,errText(e),errText(e));}
      }
      if(st.turnPlanRepairAttempted)return toolFail(row,'Do not replace a plan after native or bounded repairs; inspect the existing result.','Plan replacement refused.');
      try{const candidate=workflow.accept(state,a.previewId,fingerprint);a=candidate.layout;out=candidate.out;}
      catch(e){return toolFail(row,errText(e),errText(e));}
    }
    try { if(!out)out = Plan.compile(a, { plot }); }
    catch (e) { return toolFail(row, errText(e), NEUTRAL.plan); }
    if (!out || !out.ok) {
      const why = (out && out.error) || NEUTRAL.plan;
      return toolFail(row, why, why);
    }
    if(repair && carrier.aiPlanLayout.program && window.NasjPlanWorkflow){
      try{const checked=window.NasjPlanWorkflow.preview(a,{plot},carrier.aiPlanLayout.program);
        if(!checked.report.ready)return toolFail(row,'Repair failed the room program: '+checked.report.findings.filter(f=>f.severity==='error').slice(0,5).map(f=>f.message).join(' '),'Repair needs a layout correction.');
        out=checked.out;a=checked.layout;
      }catch(e){return toolFail(row,errText(e),errText(e));}
    }
    if(repair && (out.rooms.length<carrier.aiPlanReport.rooms || window.NasjPlanRepair.score(out)>=window.NasjPlanRepair.score(carrier.aiPlanReport)))
      return toolFail(row,'The proposed repair did not reduce the plan findings. Nothing changed. Revise the affected room adjacency or opening placement instead of repeating it.','Repair did not improve the plan.');
    if (!xf) {
      /* nothing attached: true size, in the middle of what is on screen */
      const sc = unitsPerMetre() || 1;
      const v = viewRect();
      xf = replacing ? Object.assign({}, previous.xf) :
        { scale: sc, ox: (v.minx + v.maxx) / 2 - out.extent.W * sc / 2,
          oy: (v.miny + v.maxy) / 2 - out.extent.H * sc / 2, theta: 0, cx: 0, cy: 0 };
    }
    const ents = Plan.place(out.entities, xf);
    /* the plan already on this land goes: only what a plan put there (aiplan),
       never the land or anything the architect drew. A second call in one
       turn, a Regenerate through site-N, a follow-up that redraws the plan -
       all used to stack a fresh plan on the old one. */
    const newBox = Plan.extent(ents);
    if (ents.length) ents[0].aiRooms = out.rooms.filter(r => !r.outdoor).map(r => ({id:r.id,name:r.name,kind:r.kind,points:Plan.place([{type:'polyline',pts:r.points}],xf)[0].pts}));
    if (ents.length) ents[0].aiWalls = (out.wallFills || []).map(pts => Plan.place([{type:'polyline',pts}],xf)[0].pts);
    if(ents.length){ents[0].aiPlanLayout=JSON.parse(JSON.stringify(a));ents[0].aiPlanReport={rooms:out.rooms.length,faults:out.faults||[],unfurnished:out.unfurnished||[],notes:out.notes||[]};}
    const group = replacing ? previous.group : 'plan-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const history = replacing ? { entities: snapshot(group), xf: previous.xf } : null;
    const n = applyPlan(ents, clearBox, a.mode === 'add' ? null : newBox, replacing ? group : null, group, { landKey, xf });
    if (n) {
      runs.set(landKey, { group, landKey, xf: Object.assign({}, xf), history });
      const generated=doc.entities.filter(e=>e.aiplanGroup===group),saved=generated.find(e=>e.aiPlanLayout);
      if(saved)saved.aiPlanSignature=window.NasjPlanRepair.fingerprint(generated);
    }
    st.applied = n;
    const box = Plan.extent(ents);
    row.pv = Plan.strokes(ents);
    row.planStats = out.stats;
    row.planNotes = out.notes.slice();
    row.stats = null;
    const s = out.stats;
    const plural = (k, w) => k + ' ' + w + (k === 1 ? '' : 's');
    const f1 = (v) => String(Math.round(v * 10) / 10);
    const land = plot ? f1(plot.W) + ' \u00d7 ' + f1(plot.H) + ' m' : (out.extent ? f1(out.extent.W) + ' \u00d7 ' + f1(out.extent.H) + ' m' : '');
    const faults = Array.isArray(out.faults) ? out.faults : [];
    const rest = out.notes.filter((x) => !/^FAULT/.test(x));
    const notes = out.notes.filter((x) => /^FAULT/.test(x)).concat(rest.slice(0, Math.max(0, 8 - Math.min(faults.length, 8))));
    /* the size it was built to travels back as a note, so the agent can say it */
    if (land) notes.unshift(plot ? 'built on a land of ' + land : 'standalone concept footprint ' + land + '; no survey boundary was supplied');
    const result = { ok: true, ...(repair?{action:'repair'}:staging?{action:'commit'}:{}), group, rooms: s.rooms, doors: s.doors, windows: s.windows, stairs: s.stairs,
      entities: n, seconds: Math.round((now() - t0) / 100) / 10, notes, faults,
      unfurnished: Array.isArray(out.unfurnished) ? out.unfurnished : [],
      areas: out.rooms.map((r) => r.name + (r.outdoor ? ' (outdoor)' : '') + ' ' + r.area + ' m²') };
    row.planLand = land;
    if (land && row.info) row.info.land = land + (sw > 1 ? ' (as stated)' : (row.info.land && /marked area/.test(row.info.land) ? ' (the marked area)' : ''));
    /* the architect stated the size: the chip and the prompt box say the
       size the plan was really built to, not the drawing's guess */
    if (land && sw > 1) {
      if (st.attachment) st.attachment.metres = land;
      if (st.region) st.region.metres = land;
      renderChips();
      renderRegionBox();
    }
    toolOk(row, plural(s.rooms, 'room') + (s.outdoor ? ' + ' + s.outdoor + ' outdoor' : '') + ', ' + plural(s.doors, 'door') + ', ' + plural(s.windows, 'window') + (land ? ' on ' + land : '') + (faults.length ? ' · ' + plural(faults.length, 'fault') : ''), result);
    if (n > 0 && box) frameDrawn(row, box, st.appliedIds);
    return result;
  };

  const opsForPlanRemove = (doc, group) => {
    N.docOps.pushUndo(doc);
    N.docOps.deleteEntities(doc, new Set(doc.entities.filter((e) => e.aiplanGroup === group).map((e) => e.id)));
    doc.modified = true;
    N.render();
    window.dispatchEvent(new CustomEvent('nasj:doc', { detail: { reason: 'ai-plan' } }));
  };

  const clearPlanIn = (doc, box) => {
    if (!box || !N.docOps || !N.geom) return 0;
    const w = box.maxx - box.minx, h = box.maxy - box.miny;
    const g = { minx: box.minx - w * 0.02, miny: box.miny - h * 0.02, maxx: box.maxx + w * 0.02, maxy: box.maxy + h * 0.02 };
    const doomed = [];
    for (const e of doc.entities) {
      if (!e || !e.aiplan) continue;
      let b; try { b = N.geom.entityBounds(e); } catch (_) { continue; }
      if (!b) continue;
      if (b.minx >= g.minx && b.maxx <= g.maxx && b.miny >= g.miny && b.maxy <= g.maxy) doomed.push(e.id);
    }
    if (doomed.length) N.docOps.deleteEntities(doc, new Set(doomed));
    return doomed.length;
  };
  const applyPlan = (ents, clearBox, planBox, replaceGroup, group, origin) => {
    const doc = N.doc, ops = N.docOps;
    const ids = [];
    st.appliedIds = ids;
    if (!doc || !ops || !ents.length) return 0;
    ops.pushUndo(doc);
    if (clearBox) clearRegionForEdit(doc, clearBox);
    if (replaceGroup) {
      ops.deleteEntities(doc, new Set(doc.entities.filter((e) => e.aiplanGroup === replaceGroup).map((e) => e.id)));
    } else if (planBox) clearPlanIn(doc, planBox);
    const colors = (window.NasjPlan && window.NasjPlan.LAYER_COLORS) || {};
    const layers = {};
    const layerFor = (name) => {
      if (!layers[name]) {
        let ly = (doc.layers || []).find((l) => String(l.name).toUpperCase() === name);
        if (!ly) { ly = ops.addLayer(doc, name); if (colors[name]) ly.color = colors[name]; }
        ly.on = true; ly.frozen = false;
        layers[name] = ly;
      }
      return layers[name];
    };
    for (const e of ents) {
      const ent = Object.assign({}, e, { layerId: layerFor(e.layer || 'A-WALL').id, aiplan: 1, aiplanGroup: group,
        aiplanOrigin: origin ? { landKey: origin.landKey, xf: Object.assign({}, origin.xf) } : undefined });
      delete ent.layer;
      const added = ops.addEntity(doc, ent);
      if (added && added.id) ids.push(added.id);
    }
    doc.modified = true;
    if (typeof N.render === 'function') N.render();
    window.dispatchEvent(new CustomEvent('nasj:doc', { detail: { reason: 'ai-plan' } }));
    return ids.length;
  };

// --- END MIGRATED SLICE ---

export const migrated=true;
export default {};
