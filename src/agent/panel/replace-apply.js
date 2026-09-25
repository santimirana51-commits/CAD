/** src/agent/panel/replace-apply.js — REAL ESM migrated from agent-panel.js:3094-3279 */
import { st } from './state.js';
import { EPS } from '../../shared/config/tunables.js';
const N = () => window.Nasj || {};

// --- BEGIN MIGRATED SLICE ---
  /* ================================================================== *
   * REPLACE-INSIDE — an edit consumes what it redraws.
   *
   * "Take the door out" cannot work by addition: the model returns the
   * whole selected area with the change made, and if the old contents
   * stay, the unchanged walls double up and the removed door survives.
   * So a region edit CLEARS what it is about to redraw, in the same undo
   * step as the redraw itself:
   *   - entities lying wholly inside the selection are deleted;
   *   - a straight open polyline that CROSSES the selection is trimmed —
   *     its inside spans go, its outside spans stay, so a wall running
   *     through the area keeps its far ends;
   *   - one entity is spared: a closed (or visibly closed) outline that
   *     dominates the selection. That is the architect's land, drawn by
   *     hand and surveyed — a traced approximation must never silently
   *     replace it.
   * Polylines with arc segments that cross the edge are left whole rather
   * than mis-trimmed; the model redraws them and the copies coincide.
   * ================================================================== */
  const SITE_KEEP_FRACTION = 0.3;   /* of the selection's area */

  const effectivelyClosed = (e) => {
    if (e.type !== 'polyline' || !Array.isArray(e.pts) || e.pts.length < 3) return false;
    if (e.closed) return true;
    const a = e.pts[0], b = e.pts[e.pts.length - 1];
    return Math.hypot(a.x - b.x, a.y - b.y) < EPS;
  };

  /* Liang-Barsky: the [t0,t1] slice of segment a->b that lies inside box */
  const insideSpan = (a, b, box) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    let t0 = 0, t1 = 1;
    const clipEdge = (p, q) => {
      if (Math.abs(p) < 1e-12) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    if (clipEdge(-dx, a.x - box.minx) && clipEdge(dx, box.maxx - a.x) &&
        clipEdge(-dy, a.y - box.miny) && clipEdge(dy, box.maxy - a.y)) {
      return { t0, t1 };
    }
    return null;
  };

  /* -> the parts of an open straight polyline OUTSIDE the box */
  const outsideParts = (pts, box) => {
    const runs = [];
    let run = [];
    const at = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const inBox = (p) => p.x >= box.minx && p.x <= box.maxx &&
      p.y >= box.miny && p.y <= box.maxy;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const span = insideSpan(a, b, box);
      if (!span) {                          /* wholly outside */
        if (!run.length) run.push(a);
        run.push(b);
        continue;
      }
      if (span.t0 > 1e-9) {                 /* outside part before entry */
        if (!run.length) run.push(a);
        run.push(at(a, b, span.t0));
      } else if (run.length >= 2) { runs.push(run); run = []; }
      else run = [];
      if (span.t1 < 1 - 1e-9) {             /* outside part after exit */
        if (run.length >= 2) runs.push(run);
        run = [at(a, b, span.t1), b];
      } else if (!inBox(b)) {
        /* degenerate: b outside but no exit span — numerical edge, keep b */
        if (!run.length) run.push(b);
      }
    }
    if (run.length >= 2) runs.push(run);
    return runs;
  };

  /* Clears the selection for an edit. Returns how many entities changed. */
  const clearRegionForEdit = (doc, box) => {
    const ops = N.docOps;
    const boxArea = (box.maxx - box.minx) * (box.maxy - box.miny);
    if (!(boxArea > 0)) return 0;
    /* the land stays, whether it is one closed polyline or four lines: a
       Regenerate that erased the boundary it was regenerating inside of
       would leave the next plan with nothing to be cut to */
    const land = largestBoundaryIn(box);
    const keep = new Set(land && Array.isArray(land.ids) ? land.ids : []);
    const doomed = [];
    const replacements = [];
    for (const e of doc.entities.slice()) {
      if (typeof e.aisel === 'number') continue;   /* selections are cameras */
      if (keep.has(e.id)) continue;                /* the land is not the plan */
      const b = N.geom.entityBounds(e);
      const overlaps = !(b.maxx < box.minx || b.minx > box.maxx ||
        b.maxy < box.miny || b.miny > box.maxy);
      if (!overlaps) continue;
      const wholly = b.minx >= box.minx - EPS && b.maxx <= box.maxx + EPS &&
        b.miny >= box.miny - EPS && b.maxy <= box.maxy + EPS;
      if (wholly) {
        if (effectivelyClosed(e) &&
            (b.maxx - b.minx) * (b.maxy - b.miny) >= SITE_KEEP_FRACTION * boxArea) {
          continue;                          /* the land stays the land */
        }
        doomed.push(e.id);
        continue;
      }
      /* crossing: trim straight open polylines; leave everything else whole */
      if (e.type === 'polyline' && !e.closed && Array.isArray(e.pts) &&
          e.pts.length >= 2 && !e.pts.some((p) => typeof p.b === 'number')) {
        const keep = outsideParts(e.pts, box);
        const total = e.pts.length;
        const keptPts = keep.reduce((k, r) => k + r.length, 0);
        if (keep.length === 1 && keptPts === total) continue;  /* untouched */
        doomed.push(e.id);
        for (const r of keep) {
          replacements.push({ type: 'polyline', layerId: e.layerId, closed: false,
            color: e.color, w: e.w, pts: r });
        }
      }
    }
    if (doomed.length) ops.deleteEntities(doc, doomed);
    for (const r of replacements) ops.addEntity(doc, r);
    return doomed.length;
  };

  /* ================================================================== *
   * Apply — one pushUndo, one polyline per stroke, layer A-SKETCH
   * ================================================================== */
  const ensureLayer = (doc, name) => {
    const f = (doc.layers || []).find((l) => String(l.name).toUpperCase() === name);
    return f || N.docOps.addLayer(doc, name);
  };

  const applyStrokes = (list, clearBox, siteKey = null, targetLayer = 'A-SKETCH') => {
    const doc = N.doc, ops = N.docOps;
    const good = (list || []).filter((p) => p && p.length >= 2);
    /* WHAT THIS RUN BECOMES, by id: the row's way back measures THESE, so a
       drawing the architect has since moved is still what the target finds.
       Set before the early return, so a run that applies nothing cannot
       leave the last run's ids standing. */
    const ids = [];
    st.appliedIds = ids;
    if (!doc || !ops || !good.length) return 0;
    ops.pushUndo(doc);
    /* A new proposal for this land replaces only earlier generated work
       attached to the same land. Keep survey lines and manual edits. */
    if (siteKey !== null) ops.deleteEntities(doc, new Set(doc.entities.filter(e =>
      e.aiSketchSite === siteKey || (e.aiplan && e.aiplanOrigin && e.aiplanOrigin.landKey === siteKey)).map(e => e.id)));
    /* the edit consumes what it redraws — same undo step, so one UNDO
       brings back the old contents and removes the new in one motion */
    if (clearBox) clearRegionForEdit(doc, clearBox);
    const ly = ensureLayer(doc, targetLayer);
    const aiGroup = 'sketch-' + Date.now().toString(36);
    const mk = (pts) => ({
      type: 'polyline', layerId: ly.id, closed: false, aiGroup, ...(siteKey !== null ? { aiSketchSite: siteKey } : {}),
      pts: pts.map((p) => ({ x: p.x, y: p.y }))
    });
    if (clearBox) {
      /* AN EDIT ARRIVES AS ONE OBJECT. Its seams against the old drawing
         carry the tracer's pixel drift, and chasing that drift stroke by
         stroke is a losing game — so the whole result is packed into a
         BLOCK and placed as a single insert. One click selects it, MOVE
         nudges it onto its seams, ERASE removes the whole proposal, and
         EXPLODE breaks it apart when the fit is right. */
      doc.blocks = doc.blocks || {};
      let n = 1;
      while (doc.blocks['AI-EDIT-' + n]) n += 1;
      const name = 'AI-EDIT-' + n;
      const base = { x: clearBox.minx, y: clearBox.miny };
      doc.blocks[name] = { base, entities: good.map(mk) };
      const ins = ops.addEntity(doc, { type: 'insert', name, p: { x: base.x, y: base.y },
        sx: 1, sy: 1, rot: 0, layerId: ly.id, aiGroup });
      if (ins && ins.id) ids.push(ins.id);
    } else {
      for (const pts of good) {
        const e = ops.addEntity(doc, mk(pts));
        if (e && e.id) ids.push(e.id);
      }
    }
    doc.modified = true;
    if (typeof N.render === 'function') N.render();
    window.dispatchEvent(new CustomEvent('nasj:doc', { detail: { reason: 'ai-sketch' } }));
    return good.length;
  };

// --- END MIGRATED SLICE ---

export const migrated=true;
export default {};
