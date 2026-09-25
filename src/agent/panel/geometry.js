/** src/agent/panel/geometry.js — REAL ESM migrated from agent-panel.js:2296-2583 */
import { st } from './state.js';
import { clamp } from '../../shared/utils/helpers.js';
import { VIEW_FIT, FRAME_PAD, FRAME_MIN, BOUND_FIT, EPS } from '../../shared/config/tunables.js';
const N = () => window.Nasj || {};

// --- BEGIN MIGRATED SLICE ---
  /* ================================================================== *
   * Geometry — placement (image px -> world, plain similarity)
   * ================================================================== */
  const viewRect = () => {
    const vp = N.viewport;
    const ov = document.getElementById('overlay-canvas');
    const r = ov ? ov.getBoundingClientRect() : { width: 800, height: 600 };
    const a = vp.screenToWorld({ x: 0, y: 0 });
    const b = vp.screenToWorld({ x: r.width, y: r.height });
    return {
      minx: Math.min(a.x, b.x), miny: Math.min(a.y, b.y),
      maxx: Math.max(a.x, b.x), maxy: Math.max(a.y, b.y)
    };
  };

  const inset = (r, f) => {
    const cx = (r.minx + r.maxx) / 2, cy = (r.miny + r.maxy) / 2;
    const hw = (r.maxx - r.minx) * f / 2, hh = (r.maxy - r.miny) * f / 2;
    return { minx: cx - hw, miny: cy - hh, maxx: cx + hw, maxy: cy + hh };
  };

  const bboxOf = (strokes) => {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const pts of strokes) for (const p of pts) {
      if (p.x < minx) minx = p.x;
      if (p.y < miny) miny = p.y;
      if (p.x > maxx) maxx = p.x;
      if (p.y > maxy) maxy = p.y;
    }
    return { minx, miny, maxx, maxy };
  };

  /* The frame the strokes live in: the size the vectorizer reports. While a
     stream is running the final stroke bbox is NOT known, and a placement that
     grew with every chunk would drag already-drawn ink across the sheet — so
     the reported image size is the source box whenever it is usable. */
  const sizeBox = (size) => {
    if (!Array.isArray(size) || !num(size[0]) || !num(size[1])) return null;
    if (!(size[0] > 0) || !(size[1] > 0)) return null;
    return { minx: 0, miny: 0, maxx: size[0], maxy: size[1] };
  };

  /* THE LETTERBOX. The strokes come back in the CLEANED image's pixel space —
     a CLEAN_SIZE square of which only the centred content rect was ever drawn
     on; the bars are white padding this panel added itself. Placing against
     the whole square would hand that padding to the target box as well, so the
     plan would land shrunk by exactly the letterbox ratio (a 1.83:1 image
     loses 45% of the square) and offset inside its own margins. The source box
     is therefore the content rect, whose aspect is the generated image's. */
  const frameBox = (size, clean) => {
    const box = sizeBox(size);
    if (!box || !clean) return box;
    /* only when the vectorizer really worked on the frame we built */
    if (box.maxx !== clean.size || box.maxy !== clean.size) return box;
    const c = clean.content;
    return { minx: c.x, miny: c.y, maxx: c.x + c.w, maxy: c.y + c.h };
  };

  /* Uniform scale + translate, image Y (down) flipped to world Y (up).
   *
   * THREE TARGETS, AND A REGION EDIT IS NOT A BOUNDARY. Drawing INSIDE a plot
   * you selected wants breathing room, so a boundary is inset to BOUND_FIT.
   * A REGION EDIT is a replacement: the image step was told to fill the output
   * edge to edge with the contents of the red ring, so the only correct target
   * is that rectangle EXACTLY. Insetting it by 10% is what put a villa a
   * tenth short of the land boundary it was asked to sit inside — the drawing
   * was right and the placement shrank it. */
  /* image box -> a target box, then (a turned plot) back to the world */
  const placeIn = (src, target, frame) => {
    const bw = src.maxx - src.minx, bh = src.maxy - src.miny;
    const tw = target.maxx - target.minx, th = target.maxy - target.miny;
    const sx = bw > EPS ? tw / bw : Infinity;
    const sy = bh > EPS ? th / bh : Infinity;
    let s = Math.min(sx, sy);
    if (!isFinite(s) || s <= 0) s = 1;
    const ox = target.minx + (tw - bw * s) / 2;
    const oy = target.miny + (th - bh * s) / 2;
    const flat = (p) => ({ x: ox + (p.x - src.minx) * s, y: oy + (src.maxy - p.y) * s });
    let map = flat;
    let out = { minx: ox, miny: oy, maxx: ox + bw * s, maxy: oy + bh * s };
    if (frame && frame.turned) {
      const back = unturn(frame);
      map = (p) => back(flat(p));
      out = ptsBounds([
        back({ x: out.minx, y: out.miny }), back({ x: out.maxx, y: out.miny }),
        back({ x: out.maxx, y: out.maxy }), back({ x: out.minx, y: out.maxy })
      ]);
    }
    return { scale: s, src, target, map, out };
  };
  const computePlacement = (src) => {
    const exact = st.attachment && st.attachment.exact;
    const target = st.attachment
      ? (exact ? st.attachment.bbox : inset(st.attachment.bbox, BOUND_FIT))
      : inset(viewRect(), VIEW_FIT);
    return placeIn(src, target, st.attachment && st.attachment.frame);
  };

  /* ================================================================== *
   * FRAMING — a drawing that lands has to be SEEN
   * ------------------------------------------------------------------
   * The pen draws into 80% of whatever is on screen AT THE MOMENT IT
   * STARTS. Pan away while the model works, or let the agent draw inside
   * a boundary that is a postage stamp on this screen, and the run ends
   * with the panel reporting a finished plan over paper that looks
   * untouched. That is not hypothetical: an architect ran a housing
   * project through this panel, was told the work was done, and wrote
   * back that he could not see it on the page — then went looking for a
   * zoom shortcut. The drawing was there. Nothing had taken him to it.
   *
   * So a finished draw takes the view to ITSELF — the drawn extents with
   * air around them, glided rather than snapped, one quiet line on the
   * row saying the view moved on purpose, and a target on the row that
   * brings it back later. Never the whole document: a new plan dropped
   * beside a 200-metre site plan must not zoom out to the site.
   *
   * And when the work is already on screen at a size worth looking at,
   * NOTHING happens. A jump nobody asked for is its own annoyance.
   * ================================================================== */
  const boxOK = (b) => !!b && num(b.minx) && num(b.miny) && num(b.maxx) && num(b.maxy) &&
    b.maxx >= b.minx && b.maxy >= b.miny;

  /* air around the work, measured off its longer side so a thin plan is
     not framed inside a sliver of its own */
  const padBox = (b, f) => {
    const d = Math.max(b.maxx - b.minx, b.maxy - b.miny, EPS) * f;
    return { minx: b.minx - d, miny: b.miny - d, maxx: b.maxx + d, maxy: b.maxy + d };
  };

  /* ALREADY THERE? Wholly on screen and big enough to read: hands off. */
  const inView = (b) => {
    if (!boxOK(b) || !N.viewport) return true;
    const v = viewRect();
    const vw = v.maxx - v.minx, vh = v.maxy - v.miny;
    if (!(vw > EPS) || !(vh > EPS)) return true;
    if (b.minx < v.minx || b.maxx > v.maxx || b.miny < v.miny || b.maxy > v.maxy) return false;
    return Math.max((b.maxx - b.minx) / vw, (b.maxy - b.miny) / vh) >= FRAME_MIN;
  };

  const viewNow = () => {
    const vp = N.viewport;
    return (vp && num(vp.scale) && num(vp.tx) && num(vp.ty))
      ? { scale: vp.scale, tx: vp.tx, ty: vp.ty } : null;
  };
  const sameView = (a, b) => !!a && !!b && a.scale === b.scale && a.tx === b.tx && a.ty === b.ty;
  const paintView = () => {
    if (typeof N.render === 'function') N.render();
    repaint();
  };
  /* a 2-D fit is not a 3-D one: the engine frames a world box against the
     projection there and this does not, so in 3-D it stays out of the way */
  const flat = () => !(N.view3d && N.view3d.active);
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  let glide = null;
  const stopGlide = () => {
    if (!glide) return;
    if (glide.raf) cancelAnimationFrame(glide.raf);
    glide = null;
  };

  /* The move the engine already made, REWOUND and replayed over FRAME_MS —
     the eye can follow a glide from one part of a drawing to another; a
     teleport just leaves it somewhere new with no idea how it got there. */
  const glideTo = (from, to) => {
    const vp = N.viewport;
    const ov = document.getElementById('overlay-canvas');
    const r = ov ? ov.getBoundingClientRect() : { width: 800, height: 600 };
    /* the canvas height the engine measures its own transform against, read
       back off it: worldToScreen(origin).y === cssH - ty, at any twist */
    const cssH = vp.worldToScreen({ x: 0, y: 0 }).y + vp.ty;
    const ax = (r.width || 800) / 2, ay = cssH / 2;
    /* the point under that anchor in the view's own frame: the glide slides
       THAT from one view to the other while the magnification moves
       geometrically — a linear ramp between two magnifications lurches at
       one end and crawls at the other */
    const at = (s) => ({ x: (ax - s.tx) / s.scale, y: (cssH - ay - s.ty) / s.scale });
    const c0 = at(from), c1 = at(to);
    if (!num(cssH) || !num(c0.x) || !num(c0.y) || !num(c1.x) || !num(c1.y)) return false;
    const put = (e) => {
      const s = from.scale * Math.pow(to.scale / from.scale, e);
      const x = c0.x + (c1.x - c0.x) * e, y = c0.y + (c1.y - c0.y) * e;
      vp.scale = s;
      vp.tx = ax - x * s;
      vp.ty = (cssH - ay) - y * s;
    };
    const t0 = now();
    const g = { raf: 0, last: null };
    glide = g;
    const step = () => {
      g.raf = 0;
      if (glide !== g) return;
      /* a wheel, a pan, an open, the next run — whoever else moved the view
         wins, at once and without a fight */
      if (g.last && !sameView(g.last, viewNow())) { glide = null; return; }
      const k = clamp((now() - t0) / FRAME_MS, 0, 1);
      if (k >= 1) {
        vp.scale = to.scale; vp.tx = to.tx; vp.ty = to.ty;   /* land exactly */
        glide = null;
        paintView();
        return;
      }
      put(ease(k));
      g.last = viewNow();
      paintView();
      g.raf = requestAnimationFrame(step);
    };
    put(0);                        /* back where the eye last saw it */
    g.last = viewNow();
    paintView();
    g.raf = requestAnimationFrame(step);
    return true;
  };

  /* Take the view to a world box. The FIT is the engine's — twist, tiles
     and paper space are its business — so the move is made with its own
     zoom-to-a-window and then replayed as a glide, which is the only part
     the eye needs. A fit these three numbers cannot describe (an activated
     paper-space viewport) simply lands directly, which is honest. */
  const frameBoxNow = (b) => {
    const vp = N.viewport;
    if (!vp || typeof vp.zoomWindow !== 'function' || !boxOK(b) || !flat()) return false;
    const from = viewNow();
    stopGlide();
    const p = padBox(b, FRAME_PAD);
    try { vp.zoomWindow({ x: p.minx, y: p.miny }, { x: p.maxx, y: p.maxy }); }
    catch (_) { return false; }
    const to = viewNow();
    if (!to) {
      if (from) { vp.scale = from.scale; vp.tx = from.tx; vp.ty = from.ty; }
      return false;
    }
    if (!from || sameView(from, to) || !glideTo(from, to)) paintView();
    return true;
  };

  /* WHERE IT WENT, LATER. The entities are the truth — what was drawn may
     have been moved since — so they are measured again whenever they are
     still in the document; the extents kept on the row are the fallback for
     work that has been erased, exploded or undone. */
  const shotBox = (shot) => {
    const doc = N.doc;
    if (!shot || !doc || shot.doc !== doc) return null;
    const ids = shot.ids || [];
    if (ids.length && N.geom && typeof N.geom.entityBounds === 'function') {
      const want = new Set(ids);
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, k = 0;
      for (const e of doc.entities) {
        if (!e || !want.has(e.id)) continue;
        let eb = null;
        try { eb = N.geom.entityBounds(e); } catch (_) { eb = null; }
        if (!eb || !num(eb.minx) || !num(eb.maxy)) continue;
        if (eb.minx < minx) minx = eb.minx;
        if (eb.miny < miny) miny = eb.miny;
        if (eb.maxx > maxx) maxx = eb.maxx;
        if (eb.maxy > maxy) maxy = eb.maxy;
        k++;
      }
      if (k) return { minx, miny, maxx, maxy };
    }
    return boxOK(shot.box) ? shot.box : null;
  };

  /* the pen finished a real drawing: put it on screen, and say so */
  const frameDrawn = (row, box, ids) => {
    if (!row || window.NASJ_QA) return null;    /* a harness drives its own view */
    if (!boxOK(box) || !N.doc) return null;
    row.shot = {
      box: { minx: box.minx, miny: box.miny, maxx: box.maxx, maxy: box.maxy },
      ids: (ids || []).slice(), doc: N.doc
    };
    row.framed = inView(box) ? 'here' : (frameBoxNow(box) ? 'moved' : 'here');
    /* one line, and only when the view actually moved: an architect who
       watched it happen does not need to be told twice */
    row.note = row.framed === 'moved' ? 'Framed the new geometry' : null;
    paintTool(row);
    return row.framed;
  };

  /* the target on the row: land on that drawing again, wherever it is now */
  const showAgain = (row) => {
    if (!row || !row.shot) return false;
    if (!flat()) { toast('Switch to a 2D view to frame this drawing.'); return false; }
    const b = shotBox(row.shot);
    if (!b) { toast('That drawing is no longer in this document.'); return false; }
    return frameBoxNow(b);
  };

// --- END MIGRATED SLICE ---

export const migrated = true;
export default {};
