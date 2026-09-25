/* pixelbay CAD — plan.js: a floor plan from a room layout, as real CAD.
 *
 * The agent lays rooms out as rectangles, in metres, inside the plot's own
 * frame (x to the right, y up, origin at the bottom-left of the plot's
 * extent). Everything else is drawn from that layout HERE, exactly:
 *
 *   - every room is cut to the plot's boundary, so a room on a slanted
 *     edge takes that slant — the outer walls run on the land's own lines
 *     and angles;
 *   - walls have a real thickness: two faces, mitred at the corners, a jog
 *     where an outer wall meets a partition, never a doubled or crossing
 *     line; interior walls between two rooms, exterior walls to the outside
 *     or to a garden, terrace, driveway;
 *   - doors are openings with jambs, a leaf and a quarter swing; windows are
 *     openings with jambs and the glazing lines; a straight flight of
 *     stairs with treads and an arrow; furniture by the kind of room; a
 *     label with the name and the area in the middle of each room.
 *
 * Nothing is traced. The output is a list of entities in frame metres —
 * lines, polylines, arcs, circles, text, each with a layer name — and
 * `place()` turns them into drawing units in the world, rotated back into
 * the plot's frame. The module has no DOM and no engine dependency, so the
 * plain-node suite (qa-plan.js) exercises the same code the panel runs.
 */
(function (root) {
  'use strict';

  const EPS = 1e-6;
  const SNAP = 0.05;                 /* metres: the layout grid */
  const MIN_ROOM = 0.6;              /* metres: narrower than this is not a room */
  const MIN_CELL_AREA = 1.0;         /* mÂ²: a sliver the boundary leaves is dropped */
  const LOST_TO_EDGE = 0.67;         /* a room keeping less than this of itself is reported */
  const NOTE_OVERLAP = 0.15;         /* metres: an overlap smaller than this is mended silently */
  const SAMPLE = 0.03;               /* metres either side of a wall piece to see who owns it */

  const LAYERS = {
    wall: 'A-WALL', door: 'A-DOOR', glaz: 'A-GLAZ', stair: 'A-FLOR-STRS',
    furn: 'A-FURN', text: 'A-ANNO-TEXT', site: 'A-SITE'
  };
  const LAYER_COLORS = {
    'A-WALL': '#f2f2f2', 'A-DOOR': '#4fd1c5', 'A-GLAZ': '#63b3ed', 'A-FLOR-STRS': '#f6e05e',
    'A-FURN': '#a0aec0', 'A-ANNO-TEXT': '#fbd38d', 'A-SITE': '#68d391'
  };

  const OUTDOOR = ['garden', 'terrace', 'patio', 'driveway', 'yard', 'pool', 'balcony',
    'porch', 'court', 'courtyard', 'lawn', 'veranda', 'deck', 'parking', 'outdoor'];
  const CIRCULATION = ['hall', 'entry', 'entrance', 'foyer', 'lobby', 'vestibule',
    'corridor', 'passage', 'landing', 'reception', 'living', 'lounge', 'family',
    'majlis', 'salon', 'dining', 'kitchen'];
  const HABITABLE = ['living', 'lounge', 'family', 'majlis', 'salon', 'dining', 'kitchen',
    'bedroom', 'master', 'guest', 'study', 'office', 'maid', 'nanny', 'library', 'reception'];
  const WET = ['bath', 'bathroom', 'wc', 'toilet', 'shower', 'ensuite', 'powder'];

  const num = (v) => typeof v === 'number' && isFinite(v);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const snap = (v) => Math.round(v / SNAP) * SNAP;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const r1 = (v) => Math.round(v * 10) / 10;
  /* the extent of the rooms as the layout gives them, or null */
  const rawBox = (raw) => {
    const b = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
    for (const r of (Array.isArray(raw) ? raw : [])) {
      const x = Number(r && r.x), y = Number(r && r.y), w = Number(r && r.w), h = Number(r && r.h);
      if (![x, y, w, h].every(num)) continue;
      b.minx = Math.min(b.minx, x); b.miny = Math.min(b.miny, y);
      b.maxx = Math.max(b.maxx, x + Math.abs(w)); b.maxy = Math.max(b.maxy, y + Math.abs(h));
    }
    return isFinite(b.minx) && b.maxx > b.minx && b.maxy > b.miny ? b : null;
  };
  const key = (p) => (Math.round(p.x * 1000) / 1000) + ',' + (Math.round(p.y * 1000) / 1000);

  /* ---- vectors ------------------------------------------------------ */
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const len = (a) => Math.hypot(a.x, a.y);
  const unit = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
  const left = (u) => ({ x: -u.y, y: u.x });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const SIDES = { N: { x: 0, y: 1 }, S: { x: 0, y: -1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } };

  /* ---- polygons ----------------------------------------------------- */
  const polyArea = (pts) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
    return a / 2;
  };
  const ccw = (pts) => (polyArea(pts) < 0 ? pts.slice().reverse() : pts.slice());
  const centroid = (pts) => {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const f = p.x * q.y - q.x * p.y;
      a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
    }
    if (Math.abs(a) < EPS) return pts[0] ? { x: pts[0].x, y: pts[0].y } : { x: 0, y: 0 };
    return { x: cx / (3 * a), y: cy / (3 * a) };
  };
  const pointInPoly = (pts, p) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
  const distToSeg = (p, a, b) => {
    const ab = sub(b, a), l2 = dot(ab, ab);
    if (l2 < EPS) return dist(p, a);
    const t = clamp(dot(sub(p, a), ab) / l2, 0, 1);
    return dist(p, add(a, mul(ab, t)));
  };
  const dedupe = (pts) => {
    const out = [];
    for (const p of pts) if (!out.length || dist(out[out.length - 1], p) > 1e-4) out.push(p);
    while (out.length > 1 && dist(out[0], out[out.length - 1]) <= 1e-4) out.pop();
    return out;
  };
  /* Sutherland–Hodgman against an axis-aligned rectangle: the subject may be
     concave (an L-shaped plot), the clip is convex, so the result is right */
  const clipHalf = (poly, inside, cut) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    return out;
  };
  /* a polygon without spurs (a vertex the path reaches and doubles back
     from) and without collinear middles: the clipper leaves both on a
     concave subject, and a spur would become a wall to nowhere */
  const simplifyPoly = (pts) => {
    let out = dedupe(pts);
    for (let guard = 0; guard < 64 && out.length >= 3; guard++) {
      let changed = false;
      for (let i = 0; i < out.length; i++) {
        const p = out[(i - 1 + out.length) % out.length], c = out[i], n = out[(i + 1) % out.length];
        const u = sub(c, p), v = sub(n, c);
        if (Math.abs(cross(u, v)) < 1e-7) { out.splice(i, 1); changed = true; break; }
      }
      if (!changed) break;
      out = dedupe(out);
    }
    return out;
  };
  const clipRect = (poly, r) => {
    let out = poly.slice();
    const atX = (x) => (a, b) => ({ x, y: a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x) });
    const atY = (y) => (a, b) => ({ x: a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y), y });
    out = clipHalf(out, (p) => p.x >= r.minx - EPS, atX(r.minx)); if (!out.length) return [];
    out = clipHalf(out, (p) => p.x <= r.maxx + EPS, atX(r.maxx)); if (!out.length) return [];
    out = clipHalf(out, (p) => p.y >= r.miny - EPS, atY(r.miny)); if (!out.length) return [];
    out = clipHalf(out, (p) => p.y <= r.maxy + EPS, atY(r.maxy)); if (!out.length) return [];
    out = simplifyPoly(out);
    return out.length >= 3 && Math.abs(polyArea(out)) > 1e-6 ? ccw(out) : [];
  };
  const bboxOf = (pts) => {
    const b = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
    for (const p of pts) {
      if (p.x < b.minx) b.minx = p.x; if (p.y < b.miny) b.miny = p.y;
      if (p.x > b.maxx) b.maxx = p.x; if (p.y > b.maxy) b.maxy = p.y;
    }
    return b;
  };
  /* the intersection of two lines (p + sÂ·u, q + tÂ·v) or null when parallel */
  const lineX = (p, u, q, v) => {
    const d = cross(u, v);
    if (Math.abs(d) < 1e-9) return null;
    const w = sub(q, p);
    const s = cross(w, v) / d;
    return add(p, mul(u, s));
  };

  /* ---- the entity emitters (frame metres) --------------------------- */
  const mkOut = () => {
    const ents = [];
    const P = (p) => ({ x: r3(p.x), y: r3(p.y) });
    return {
      ents,
      line: (a, b, layer) => { if (dist(a, b) > 1e-4) ents.push({ type: 'line', a: P(a), b: P(b), layer }); },
      pline: (pts, closed, layer) => {
        const q = dedupe(pts.map((p) => (p.b != null ? { x: r3(p.x), y: r3(p.y), b: p.b } : P(p))));
        if (q.length >= 2) ents.push({ type: 'polyline', pts: q, closed: !!closed, layer });
      },
      arc: (c, r, a0, a1, layer) => { if (r > 1e-4) ents.push({ type: 'arc', c: P(c), r: r3(r), a0, a1, layer }); },
      circle: (c, r, layer) => { if (r > 1e-4) ents.push({ type: 'circle', c: P(c), r: r3(r), layer }); },
      text: (p, str, h, layer) => { if (str) ents.push({ type: 'text', p: P(p), str: String(str), h: r3(h), rot: 0, ha: 4, layer }); },
      rect: (a, w, h, layer) => ents.push({ type: 'polyline', closed: true, layer,
        pts: [P(a), P({ x: a.x + w, y: a.y }), P({ x: a.x + w, y: a.y + h }), P({ x: a.x, y: a.y + h })] })
    };
  };

  /* ================================================================== *
   * 1. the layout: rooms as rectangles, inside the extent, not overlapping
   * ================================================================== */
  const kindOf = (r) => {
    const k = String(r.kind || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
    /* 'other' and an empty kind say nothing: the name does ('Reception', 'Entry') */
    if ((!k || k === 'other' || k === 'room') && r.name) {
      const name=String(r.name).toLowerCase();
      if (/Ø¹Ø±Ø¶|Ù…Ø­Ù„|Ù…Ø¨ÙŠØ¹Ø§Øª|ØªÙ„ÙŠÙÙˆÙ†|Ù‡Ø§ØªÙ|shop|retail|showroom|sales|tienda|magasin|å•†åº—|åº—èˆ—/.test(name)) return 'shop';
      if (/Ù…Ø®Ø²Ù†|ØªØ®Ø²ÙŠÙ†|storage|store|almacén|ä»“åº“|å€‰åº«/.test(name)) return 'store';
      if (/Ù…ÙƒØªØ¨|office|bureau|oficina|åŠžå…¬å®¤/.test(name)) return 'office';
      return name.replace(/[^a-z]+/g,' ').trim() || 'other';
    }
    return k || 'other';
  };
  const kindHas = (k, list) => list.some((w) => k === w || k.indexOf(w) >= 0);
  const isOutdoor = (r) => r.outdoor === true || kindHas(r.kind, OUTDOOR);

  const readRooms = (raw, W, H, notes) => {
    const list = Array.isArray(raw) ? raw : [];
    const rooms = [];
    const seen = new Set();
    list.forEach((r, i) => {
      if (!r || typeof r !== 'object') return;
      const x = Number(r.x), y = Number(r.y), w = Number(r.w), h = Number(r.h);
      if (![x, y, w, h].every(num)) { notes.push('room ' + (r.id || r.name || i + 1) + ' has no usable x, y, w, h and was left out'); return; }
      let id = String(r.id || r.name || ('room' + (i + 1))).trim().toLowerCase().replace(/\s+/g, '-');
      while (seen.has(id)) id += '-';
      seen.add(id);
      const kind = kindOf(r);
      if (snap(Math.abs(w)) < MIN_ROOM || snap(Math.abs(h)) < MIN_ROOM) {
        notes.push('FAULT: ' + String(r.name || r.kind || id) + ' is ' + r1(Math.abs(w)) + ' x ' + r1(Math.abs(h)) + ' m - too thin to be a room - and was left out');
        return;
      }
      rooms.push({
        id, name: String(r.name || r.kind || id).trim(), kind, outdoor: false,
        x: snap(x), y: snap(y), w: r3(snap(x + Math.abs(w)) - snap(x)), h: r3(snap(y + Math.abs(h)) - snap(y)), raw: r
      });
    });
    for (const r of rooms) {
      r.outdoor = isOutdoor(r);
      /* into the extent: shrink what is too big, then slide what hangs out */
      if (r.w > W) r.w = snap(W);
      if (r.h > H) r.h = snap(H);
      if (r.x < 0) r.x = 0;
      if (r.y < 0) r.y = 0;
      if (r.x + r.w > W + EPS) r.x = snap(Math.max(0, W - r.w));
      if (r.y + r.h > H + EPS) r.y = snap(Math.max(0, H - r.h));
    }
    return rooms;
  };

  /* Two rooms that overlap: the later one gives way along the axis of the
     smaller overlap, down to MIN_ROOM; then the earlier one; then the later
     one is dropped. The agent is told either way. */
  const resolveOverlaps = (rooms, notes) => {
    const shrink = (r, axis, amount, fromLow) => {
      const size = axis === 'x' ? r.w : r.h;
      if (size - amount < MIN_ROOM - EPS) return false;
      if (axis === 'x') { if (fromLow) r.x += amount; r.w -= amount; }
      else { if (fromLow) r.y += amount; r.h -= amount; }
      return true;
    };
    for (let pass = 0; pass < 12; pass++) {
      let changed = false;
      for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
          const a = rooms[i], b = rooms[j];
          if (a.dead || b.dead) continue;
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (ox <= SNAP / 2 + EPS || oy <= SNAP / 2 + EPS) continue;
          const axis = ox <= oy ? 'x' : 'y';
          const amount = snap(axis === 'x' ? ox : oy) || SNAP;
          const bLow = axis === 'x' ? b.x + b.w / 2 < a.x + a.w / 2 : b.y + b.h / 2 < a.y + a.h / 2;
          /* b gives way on the side that faces a */
          /* a few centimetres is the layout's arithmetic, not a fault: mended
             without a word; half a metre or more is worth telling */
          const worth = amount >= NOTE_OVERLAP - EPS;
          if (shrink(b, axis, amount, !bLow)) { changed = true; if (worth) notes.push(b.name + ' overlapped ' + a.name + ' by ' + r3(amount) + ' m and was trimmed'); continue; }
          if (shrink(a, axis, amount, bLow)) { changed = true; if (worth) notes.push(a.name + ' overlapped ' + b.name + ' by ' + r3(amount) + ' m and was trimmed'); continue; }
          b.dead = true; changed = true;
          notes.push(b.name + ' sat on top of ' + a.name + ' and was left out');
        }
      }
      if (!changed) break;
    }
    return rooms.filter((r) => !r.dead);
  };

  /* ================================================================== *
   * 2. cells: each room cut to the plot; 3. wall pieces between them
   * ================================================================== */
  /* the land pulled in by its setbacks: each edge offset inward by front
     (outward normal mostly -y), rear (+y) or side; adjacent offset edges
     meet at the new corners. Works for the slanted and the L-shaped plot. */
  const insetPoly = (poly, sb) => {
    const P = ccw(poly);
    const n = P.length;
    if (n < 3) return null;
    const off = [];
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      const u = unit(sub(b, a));
      const nrm = { x: u.y, y: -u.x };                /* outward, for a CCW ring */
      const d = nrm.y < -0.7 ? sb.front : nrm.y > 0.7 ? sb.rear : sb.side;
      const shift = mul(nrm, -d);
      off.push({ a: add(a, shift), b: add(b, shift), u });
    }
    const convex = P.every((a,i)=>cross(sub(P[(i+1)%n],a),sub(P[(i+2)%n],P[(i+1)%n]))>=-EPS);
    if (convex) {
      let clipped=P;
      for(const e of off) clipped=clipHalf(clipped,p=>cross(e.u,sub(p,e.a))>=-EPS,(a,b)=>{
        const da=cross(e.u,sub(a,e.a)),db=cross(e.u,sub(b,e.a));return lerp(a,b,da/(da-db));
      });
      return clipped.length>=3 && polyArea(clipped)>EPS ? simplifyPoly(clipped) : null;
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = off[(i - 1 + n) % n], q = off[i];
      const x = lineX(p.a, p.u, q.a, q.u);
      out.push(x || q.a);
    }
    const clean = simplifyPoly(out);
    if (clean.length < 3) return null;
    const area = polyArea(clean), whole = Math.abs(polyArea(P));
    if (!(area > EPS) || area > whole + EPS) return null;
    for(let i=0;i<clean.length;i++) {
      const a=clean[i],b=clean[(i+1)%clean.length],kept=clipStrokes([[a,b]],P).reduce((sum,r)=>sum+r.slice(1).reduce((s,p,j)=>s+dist(r[j],p),0),0);
      if(kept < dist(a,b)-1e-6)return null;
    }
    return clean;
  };
  const readSetback = (raw) => {
    if (raw === false || raw === 0) return null;
    if (num(raw)) return raw > 0 ? { front: raw, side: raw, rear: raw } : null;
    if (raw && typeof raw === 'object') {
      const g = (k, d) => (num(Number(raw[k])) && Number(raw[k]) >= 0 ? Number(raw[k]) : d);
      const sb = { front: g('front', 0), side: g('side', 0), rear: g('rear', 0) };
      return sb.front + sb.side + sb.rear > 0 ? sb : null;
    }
    return null;
  };

  const buildCells = (rooms, plot, notes, build, W, H, program) => {
    const out = [];
    const bb = build ? bboxOf(build) : null;
    for (const r of rooms) {
      let rect = { minx: r.x, miny: r.y, maxx: r.x + r.w, maxy: r.y + r.h };
      let poly = plot;
      if (build) {
        if (r.outdoor) {
          /* open ground on the building line runs on to the land's edge */
          if (Math.abs(rect.minx - bb.minx) < SNAP) rect.minx = 0;
          if (Math.abs(rect.maxx - bb.maxx) < SNAP) rect.maxx = W;
          if (Math.abs(rect.miny - bb.miny) < SNAP) rect.miny = 0;
          if (Math.abs(rect.maxy - bb.maxy) < SNAP) rect.maxy = H;
        } else poly = build;
      }
      const cell = clipRect(poly, rect);
      const area = cell.length ? polyArea(cell) : 0;
      if (area < MIN_CELL_AREA) { notes.push(r.name + ' lies outside the boundary and was left out'); continue; }
      /* a room the slanted edge took most of is a layout fault, not a room:
         the agent is told how much went, so it can move the room off the
         edge and put open ground or a corridor there instead */
      const meant = r.w * r.h;
      const cb = bboxOf(cell);
      const meanWidth = area / Math.max(EPS, Math.max(cb.maxx - cb.minx, cb.maxy - cb.miny));
      /* a strip: half the room gone, or squeezed to well under the width it was given (a 1.5 m corridor is a corridor) */
      if (!program?.some(p=>p.id===r.id) && !r.outdoor && meant > EPS && (area < 0.5 * meant || (meanWidth < 1.6 && meanWidth < 0.7 * Math.min(r.w, r.h)))) {
        /* what is left is not a room: it is open ground, and a FAULT */
        r.lost = Math.round((1 - area / meant) * 100);
        notes.push('FAULT: ' + r.name + ' (' + r1(r.w) + ' x ' + r1(r.h) + ' m) sits across the slanted edge and would be ' + r1(meanWidth) + ' m wide; it was left as open ground - move it inward and give this strip to a garden or a corridor');
        r.outdoor = true; r.unbuildable = true; r.name = r.name + ' (strip)';
      } else if (!r.outdoor && meant > EPS && area < LOST_TO_EDGE * meant) {
        r.lost = Math.round((1 - area / meant) * 100);
        notes.push(r.name + ' lost ' + r.lost + '% of its area to the boundary (' + r1(area) + ' mÂ² of ' + r1(meant) + ' mÂ² remain)');
      }
      r.cell = cell; r.area = area; r.c = centroid(cell); r.box = cb;
      out.push(r);
    }
    return out;
  };

  const roomAtFactory = (rooms) => (p) => {
    for (let i = 0; i < rooms.length; i++) if (!rooms[i].outdoor && pointInPoly(rooms[i].cell, p)) return i;
    for (let i = 0; i < rooms.length; i++) if (rooms[i].outdoor && pointInPoly(rooms[i].cell, p)) return i;
    return -1;
  };

  const buildPieces = (rooms, tExt, tInt) => {
    const segs = [];
    for (const r of rooms) for (let i = 0; i < r.cell.length; i++) segs.push({ a: r.cell[i], b: r.cell[(i + 1) % r.cell.length] });
    const pieces = [];
    const seenKeys = new Set();
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const d = sub(s.b, s.a), l = len(d);
      if (l < 1e-4) continue;
      const u = mul(d, 1 / l);
      const ts = [0, 1];
      for (let j = 0; j < segs.length; j++) {
        if (j === i) continue;
        const o = segs[j];
        const e = sub(o.b, o.a), le = len(e);
        if (le < 1e-4) continue;
        const v = mul(e, 1 / le);
        if (Math.abs(cross(u, v)) < 1e-6) {
          /* parallel: collinear neighbours split this one at their ends */
          if (Math.abs(cross(u, sub(o.a, s.a))) > 1e-4) continue;
          for (const q of [o.a, o.b]) { const t = dot(sub(q, s.a), u) / l; if (t > 1e-6 && t < 1 - 1e-6) ts.push(t); }
          continue;
        }
        /* crossing or touching */
        const den = cross(u, v);
        const w = sub(o.a, s.a);
        const t = cross(w, v) / den / l;
        const tt = cross(w, u) / den / le;
        if (t > 1e-6 && t < 1 - 1e-6 && tt >= -1e-6 && tt <= 1 + 1e-6) ts.push(t);
      }
      ts.sort((p, q) => p - q);
      for (let k = 0; k + 1 < ts.length; k++) {
        if (ts[k + 1] - ts[k] < 1e-5) continue;
        const a = add(s.a, mul(d, ts[k])), b = add(s.a, mul(d, ts[k + 1]));
        const ka = key(a), kb = key(b);
        const kk = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        if (seenKeys.has(kk)) continue;
        seenKeys.add(kk);
        pieces.push({ a, b, u: unit(sub(b, a)), len: dist(a, b) });
      }
    }
    const roomAt = roomAtFactory(rooms);
    const out = [];
    for (const p of pieces) {
      const m = lerp(p.a, p.b, 0.5), n = left(p.u);
      const L = roomAt(add(m, mul(n, SAMPLE))), R = roomAt(sub(m, mul(n, SAMPLE)));
      if (L === R) continue;
      const li = L >= 0 && !rooms[L].outdoor, ri = R >= 0 && !rooms[R].outdoor;
      let cls, t = tInt, out_ = null;
      if (li && ri) cls = 'int';
      else if (li || ri) { cls = 'ext'; t = tExt; out_ = li ? mul(n, -1) : n; }
      else if (L >= 0 && R >= 0) { cls = 'edge'; t = 0; }
      else continue;                              /* garden against the plot line: already drawn */
      /* where the wall's centre sits, along n: a partition is centred on the
         edge; an exterior wall keeps its outer face ON the edge and its body
         inside the room, so nothing is built over the boundary line */
      p.n = n; p.L = L; p.R = R; p.cls = cls; p.t = t; p.out = out_; p.openings = []; p.id = out.length;
      p.c = cls === 'ext' ? (li ? t / 2 : -t / 2) : 0;
      out.push(p);
    }
    return out;
  };

  /* ================================================================== *
   * 4. openings: doors and windows on the pieces
   * ================================================================== */
  const sideMatch = (dir, side) => { const s = SIDES[String(side || '').toUpperCase()]; return !s || dot(dir, s) > 0.7; };

  const fit = (piece, width, at, minW, gap) => {
    const margin = piece.cls === 'ext' ? 0.3 : 0.25;
    const room = piece.len - 2 * margin;
    if (room + EPS < minW) return null;
    const w = Math.min(width, room);
    const ats = [clamp(at, 0, 1), 0.5, 0.15, 0.85, 0, 1, 0.3, 0.7];
    for (const a of ats) {
      const s0 = margin + (room - w) * a, s1 = s0 + w;
      const clash = piece.openings.some((o) => !(s1 + gap <= o.s0 || s0 - gap >= o.s1));
      if (!clash) return { s0, s1, w };
    }
    return null;
  };

  const placeDoor = (pieces, rooms, spec, notes) => {
    const byId = (id) => rooms.findIndex((r) => r.id === String(id || '').trim().toLowerCase().replace(/\s+/g, '-'));
    const from = byId(spec.from);
    const toRaw = String(spec.to == null ? 'outside' : spec.to).trim().toLowerCase();
    let to = byId(toRaw);
    if (from < 0) { notes.push('a door was asked for from "' + spec.from + '", which is not a room'); return null; }
    if (to < 0) {
      if (/^(outside|out|exterior|external|street|front|garden|yard|road)$/.test(toRaw)) to = -1;
      else { notes.push('a door was asked for into "' + spec.to + '", which is not a room'); return null; }
    }
    let cands;
    if (to >= 0) cands = pieces.filter((p) => (p.L === from && p.R === to) || (p.L === to && p.R === from));
    else cands = pieces.filter((p) => p.cls === 'ext' && (p.L === from || p.R === from) && (p.L < 0 || p.R < 0 || rooms[p.L === from ? p.R : p.L].outdoor));
    if (spec.side) {
      const filtered = cands.filter((p) => { const dir = p.L === from ? mul(p.n, -1) : p.n; return sideMatch(dir, spec.side); });
      if (filtered.length || spec.strictSide) cands = filtered;
    }
    if (to < 0) {
      const outside = cands.filter((p) => p.L < 0 || p.R < 0);
      if (outside.length) cands = outside;
    }
    cands.sort((p, q) => q.len - p.len);
    const fromK = rooms[from].kind, toK = to >= 0 ? rooms[to].kind : '';
    const wet = kindHas(fromK, WET) || kindHas(toK, WET);
    const garage = kindHas(fromK, ['garage', 'carport']) && (to < 0 || rooms[to].outdoor) && spec.kind !== 'door';
    let width = num(Number(spec.width)) && Number(spec.width) > 0 ? Number(spec.width)
      : garage ? 2.8 : to < 0 ? (rooms[from].outdoor ? 1.0 : 1.2) : wet ? 0.8 : 0.9;
    const dbl = spec.double === true || (!garage && width >= 1.5 && (to < 0 || (to >= 0 && rooms[to].outdoor)));
    const at = num(Number(spec.at)) ? Number(spec.at) : (to < 0 ? 0.5 : 0.12);
    for (const p of cands) {
      const f = fit(p, width, at, 0.7, 0.1);
      if (!f) continue;
      /* the leaf goes into the room entered; an entrance opens inward */
      let swingRoom = to >= 0 && !rooms[to].outdoor ? to : from;
      if (spec.swing === 'out' && to >= 0) swingRoom = from;
      if (spec.swing === 'in' && to >= 0) swingRoom = to;
      const o = { kind: garage ? 'garage' : 'door', s0: f.s0, s1: f.s1, w: f.w, from, to, swingRoom, double: dbl, piece: p };
      p.openings.push(o);
      if (!spec.quiet && f.w + EPS < width) notes.push('Door from ' + rooms[from].name + ' to ' + (to < 0 ? 'outside' : rooms[to].name) + ' is ' + r1(f.w) + ' m wide (requested ' + r1(width) + ' m); verify the required clear opening.');
      return o;
    }
    if (!spec.quiet) notes.push(to >= 0
      ? rooms[from].name + ' and ' + rooms[to].name + ' share no wall long enough, so that door was not drawn'
      : rooms[from].name + ' has no outside wall long enough for its door');
    return null;
  };

  const placeWindow = (pieces, rooms, spec, notes, quiet) => {
    const ri = rooms.findIndex((r) => r.id === String(spec.room || '').trim().toLowerCase().replace(/\s+/g, '-'));
    if (ri < 0) { if (!quiet) notes.push('a window was asked for in "' + spec.room + '", which is not a room'); return null; }
    let cands = pieces.filter((p) => p.cls === 'ext' && (p.L === ri || p.R === ri));
    if (spec.side) {
      const f = cands.filter((p) => sideMatch(p.out, spec.side));
      if (f.length) cands = f; else if (!quiet) notes.push(rooms[ri].name + ' has no outside wall on its ' + spec.side + ' side; the window went elsewhere');
    }
    if (spec.piece) cands = [spec.piece];
    cands.sort((p, q) => q.len - p.len);
    const k = rooms[ri].kind;
    const width = num(Number(spec.width)) && Number(spec.width) > 0 ? Number(spec.width)
      : kindHas(k, WET) ? 0.6 : kindHas(k, ['kitchen', 'laundry']) ? 1.2 : 1.6;
    for (const p of cands) {
      const f = fit(p, Math.min(width, p.len * 0.6), num(Number(spec.at)) ? Number(spec.at) : 0.5, 0.45, 0.2);
      if (!f) continue;
      const o = { kind: 'window', s0: f.s0, s1: f.s1, w: f.w, room: ri, piece: p };
      p.openings.push(o);
      return o;
    }
    if (!quiet) notes.push(rooms[ri].name + ' has no outside wall for a window');
    return null;
  };

  const neighboursOf = (pieces, ri) => {
    const set = new Map();
    for (const p of pieces) {
      if (p.cls !== 'int') continue;
      const o = p.L === ri ? p.R : p.R === ri ? p.L : -1;
      if (o >= 0) set.set(o, (set.get(o) || 0) + p.len);
    }
    return set;
  };

  const SERVICE = ['garage', 'carport', 'store', 'storage', 'shed', 'boiler', 'plant', 'closet'];
  const BEDROOMS = ['bedroom', 'master', 'guest', 'maid', 'nanny', 'kids', 'child'];
  /* how good a room is to enter another room from: halls first, then living
     rooms; a bath, a bedroom, a garage last */
  const rank = (k) => {
    const i = CIRCULATION.findIndex((c) => kindHas(k, [c]));
    if (i >= 0) return i;
    if (kindHas(k, WET)) return 300;
    if (kindHas(k, SERVICE)) return 250;
    if (kindHas(k, BEDROOMS)) return 200;
    return 99;
  };
  const autoDoors = (pieces, rooms, doors, notes) => {
    const hasDoor = (ri) => doors.some((d) => d.from === ri || d.to === ri);
    for (let ri = 0; ri < rooms.length; ri++) {
      const r = rooms[ri];
      if (r.outdoor || hasDoor(ri)) continue;
      const nb = neighboursOf(pieces, ri);
      const list = Array.from(nb.keys()).filter((o) => !rooms[o].outdoor);
      list.sort((a, b) => (rank(rooms[a].kind) - rank(rooms[b].kind)) || (rooms[b].area - rooms[a].area));
      let placed = null;
      for (const o of list) { placed = placeDoor(pieces, rooms, { from: rooms[o].id, to: r.id, quiet: true }, []); if (placed) break; }
      if (!placed && kindHas(r.kind, SERVICE)) {
        placed = placeDoor(pieces, rooms, { from: r.id, to: 'outside', quiet: true }, []);
      }
      if (placed) doors.push(placed);
      // Final reachability is checked after the entrance is placed, not here.
    }
    /* one way in: from a hall or a living room, on the street side first */
    if (!doors.some((d) => d.to < 0 && !rooms[d.from].outdoor && d.kind === 'door')) {
      const order = rooms.map((r, i) => i).filter((i) => !rooms[i].outdoor)
        .sort((a, b) => rank(rooms[a].kind) - rank(rooms[b].kind) || rooms[b].area - rooms[a].area);
      let got = null;
      for (const ri of order) { got = placeDoor(pieces, rooms, { from: rooms[ri].id, to: 'outside', side: 'S', strictSide: true, width: 1.2, kind: 'door', quiet: true }, []); if (got) break; }
      if (!got) for (const ri of order) { got = placeDoor(pieces, rooms, { from: rooms[ri].id, to: 'outside', width: 1.2, kind: 'door', quiet: true }, []); if (got) break; }
      if (got) { doors.push(got); notes.push('the entrance was placed from ' + rooms[got.from].name + ' (no door to outside was named)'); }
    }
  };

  /* the garage gets a door a car can use: onto the driveway, else the street */
  const garageDoors = (pieces, rooms, doors, notes) => {
    rooms.forEach((r, ri) => {
      if (r.outdoor || !kindHas(r.kind, ['garage', 'carport'])) return;
      if (doors.some((d) => d.kind === 'garage' && (d.from === ri || d.to === ri))) return;
      const width = (p) => (p && p.len >= 6 ? 5.0 : 2.8);
      let placed = null;
      const drives = rooms.map((o, i) => i).filter((i) => rooms[i].outdoor && kindHas(rooms[i].kind, ['driveway', 'parking', 'drive', 'carport', 'yard', 'court']));
      for (const di of drives) {
        const shared = pieces.find((p) => (p.L === ri && p.R === di) || (p.L === di && p.R === ri));
        placed = placeDoor(pieces, rooms, { from: r.id, to: rooms[di].id, width: width(shared), at: 0.5, quiet: true }, []);
        if (placed) { notes.push(r.name + ' was given a ' + placed.w.toFixed(1).replace(/\.0$/, '') + ' m vehicle door onto ' + rooms[di].name); break; }
      }
      if (!placed) placed = placeDoor(pieces, rooms, { from: r.id, to: 'outside', side: 'S', strictSide: true, width: 2.8, at: 0.5, quiet: true }, []);
      if (!placed) placed = placeDoor(pieces, rooms, { from: r.id, to: 'outside', width: 2.8, at: 0.5, quiet: true }, []);
      if (placed) { if (!doors.includes(placed)) doors.push(placed); if (placed.to < 0) notes.push(r.name + ' was given a vehicle door to the street'); }
      else notes.push('FAULT: ' + r.name + ' has no wall onto the street or a driveway, so a car cannot enter');
    });
  };

  /* every room must be reachable from the front door through halls,
     corridors and living rooms - never only through a bath, a bedroom or
     the garage. The graph is checked, repaired where a wall allows, and
     reported where it does not. */
  const repairCirculation = (pieces, rooms, doors, notes) => {
    const n = rooms.length;
    const isIn = (i) => i >= 0 && !rooms[i].outdoor;
    const adj = () => { const a = rooms.map(() => new Set()); for (const d of doors) { if (isIn(d.from) && isIn(d.to)) { a[d.from].add(d.to); a[d.to].add(d.from); } } return a; };
    const seeds = () => { const s = new Set(); for (const d of doors) { if (isIn(d.from) && (d.to < 0 || !isIn(d.to))) s.add(d.from); if (isIn(d.to) && d.from >= 0 && !isIn(d.from)) s.add(d.to); } return s; };
    const isPass = (i) => rank(rooms[i].kind) < 99;                 /* a hall, corridor, living, dining, kitchen */
    const isPrivate = (i) => kindHas(rooms[i].kind, WET) || kindHas(rooms[i].kind, BEDROOMS) || kindHas(rooms[i].kind, SERVICE);
    /* reach: through any door at all (a bath off a bedroom is reached); a
       dry room or a stair entered only through private rooms is pass 2 */
    const reach = () => {
      const a = adj(), seen = new Set(), q = [];
      for (const sd of seeds()) { seen.add(sd); q.push(sd); }
      while (q.length) { const i = q.shift(); for (const j of a[i]) if (!seen.has(j)) { seen.add(j); q.push(j); } }
      return seen;
    };
    const score = (from, to, wall) => rank(rooms[from].kind) * 100 + (isPrivate(from) ? 5000 : 0) - wall;
    for (let guard = 0; guard < n + 2; guard++) {
      const seen = reach();
      const missing = rooms.map((r, i) => i).filter((i) => isIn(i) && !seen.has(i));
      if (!missing.length) break;
      let best = null;
      for (const to of missing) {
        const nb = neighboursOf(pieces, to);
        for (const [from, wall] of nb) {
          if (!seen.has(from) || !isIn(from) || wall + EPS < 1.2) continue;
          const sc = score(from, to, wall);
          if (!best || sc < best.sc) best = { from, to, sc };
        }
      }
      if (!best) {
        for (const to of missing) notes.push('FAULT: ' + rooms[to].name + ' cannot be reached from the entrance except through a bath, a bedroom or the garage');
        break;
      }
      const d = placeDoor(pieces, rooms, { from: rooms[best.from].id, to: rooms[best.to].id, quiet: true }, []);
      if (!d) { notes.push('FAULT: ' + rooms[best.to].name + ' cannot be reached from the entrance; no wall had room for a door'); break; }
      doors.push(d);
      notes.push(rooms[best.to].name + ' had no way in from the entrance; a door was added from ' + rooms[best.from].name);
    }
    /* a stair, a bedroom or any dry room entered only through a bath, a
       store, the garage or another bedroom */
    const a = adj();
    rooms.forEach((r, i) => {
      if (!isIn(i) || kindHas(r.kind, WET) || kindHas(r.kind, SERVICE)) return;
      const ways = Array.from(a[i]);
      const outDoor = doors.some((d) => d.from === i && !isIn(d.to)) || doors.some((d) => d.to === i && !isIn(d.from));
      if (outDoor || !ways.length || ways.some((j) => !isPrivate(j))) return;
      const nb = neighboursOf(pieces, i);
      const cands = Array.from(nb.entries()).filter(([j, wall]) => isIn(j) && !isPrivate(j) && wall + EPS >= 1.2).sort((p, q) => score(p[0], i, p[1]) - score(q[0], i, q[1]));
      let fixed = null;
      for (const [j] of cands) { fixed = placeDoor(pieces, rooms, { from: rooms[j].id, to: r.id, quiet: true }, []); if (fixed) { doors.push(fixed); notes.push(r.name + ' was entered only through ' + rooms[ways[0]].name + '; a door was added from ' + rooms[j].name); break; } }
      if (!fixed) notes.push('FAULT: ' + r.name + ' is entered only through ' + rooms[ways[0]].name);
    });
    /* a bath or WC entered only from the kitchen */
    rooms.forEach((r, i) => {
      if (!isIn(i) || !kindHas(r.kind, WET)) return;
      const ways = Array.from(a[i]);
      if (ways.length && ways.every((j) => kindHas(rooms[j].kind, ['kitchen']))) notes.push('FAULT: ' + r.name + ' opens only from the kitchen');
    });
  };

  const autoWindows = (pieces, rooms, windows, notes) => {
    for (let ri = 0; ri < rooms.length; ri++) {
      const r = rooms[ri];
      if (r.outdoor) continue;
      const k = r.kind;
      if (kindHas(k, ['garage', 'carport', 'store', 'storage', 'corridor', 'passage', 'closet', 'shed', 'plant', 'boiler'])) continue;
      if (windows.some((w) => w.room === ri)) continue;
      const ext = pieces.filter((p) => p.cls === 'ext' && (p.L === ri || p.R === ri) && (p.L < 0 || p.R < 0 || rooms[p.L === ri ? p.R : p.L].outdoor));
      if (!ext.length && kindHas(k, HABITABLE)) notes.push('FAULT: ' + r.name + ' has no outside wall, so it has no window and no daylight');
      ext.sort((p, q) => q.len - p.len);
      const want = kindHas(k, WET) ? 1 : kindHas(k, HABITABLE) ? Math.min(2, ext.length) : 1;
      let got = 0;
      for (const p of ext) {
        if (got >= want) break;
        if (p.len < 1.2) continue;
        const w = placeWindow(pieces, rooms, { room: r.id, piece: p }, notes, true);
        if (w) { windows.push(w); got++; }
      }
    }
  };

  /* ================================================================== *
   * 5. faces: the two lines of every wall, mitred, cut at the openings
   * ================================================================== */
  /* the pieces lying on a cell edge a->b, in order along it */
  const piecesOnEdge = (pieces, a, b) => {
    const d = sub(b, a), l = len(d), u = mul(d, 1 / l);
    const out = [];
    for (const p of pieces) {
      if (Math.abs(cross(u, p.u)) > 1e-6) continue;
      if (Math.abs(cross(u, sub(p.a, a))) > 1e-4) continue;
      const ta = dot(sub(p.a, a), u) / l, tb = dot(sub(p.b, a), u) / l;
      const lo = Math.min(ta, tb), hi = Math.max(ta, tb);
      if (lo < -1e-6 || hi > 1 + 1e-6) continue;
      out.push({ p, lo, hi, fwd: tb > ta });
    }
    out.sort((x, y) => x.lo - y.lo);
    return out;
  };

  /* an offset loop from ordered runs [{a, b, d, piece}] (each run's inward
     normal = left of its direction); consecutive runs meet in a mitre, a
     change of offset on the same line is a jog */
  const offsetLoop = (runs, side) => {
    const n = runs.length;
    if (!n) return [];
    const off = runs.map((r) => {
      const u = unit(sub(r.b, r.a)), nn = mul(left(u), side * r.d);
      return { a: add(r.a, nn), b: add(r.b, nn), u, piece: r.piece, d: r.d };
    });
    /* the join at the end of run i: a mitre when the two offset lines meet
       within three offsets of both ends (a corner), nothing when they are
       parallel (a jog) or the mitre runs away (a hairpin) */
    const ends = off.map((cur, i) => {
      const nxt = off[(i + 1) % n];
      if (Math.abs(cross(cur.u, nxt.u)) < 1e-6) return null;
      const j = lineX(cur.a, cur.u, nxt.a, nxt.u);
      if (!j) return null;
      const reach = 3 * Math.max(cur.d, nxt.d, 0.05) + 0.01;
      return (dist(j, cur.b) <= reach && dist(j, nxt.a) <= reach) ? j : null;
    });
    const segs = [];
    for (let i = 0; i < n; i++) {
      const cur = off[i], nxt = off[(i + 1) % n];
      const a = ends[(i - 1 + n) % n] || cur.a, b = ends[i] || cur.b;
      if (dist(a, b) > 1e-4) segs.push({ a, b, piece: cur.piece });
      if (!ends[i] && dist(b, nxt.a) > 1e-4) segs.push({ a: b, b: nxt.a, piece: null });
    }
    return segs;
  };

  const roomRuns = (room, pieces, tExt) => {
    const runs = [];
    const cell = room.cell;
    for (let i = 0; i < cell.length; i++) {
      const a = cell[i], b = cell[(i + 1) % cell.length];
      const on = piecesOnEdge(pieces, a, b);
      if (!on.length) { runs.push({ a, b, d: tExt, piece: null }); continue; }
      for (const e of on) {
        const pa = lerp(a, b, e.lo), pb = lerp(a, b, e.hi);
        runs.push({ a: pa, b: pb, d: e.p.cls === 'ext' ? e.p.t : e.p.t / 2, piece: e.p });
      }
    }
    return runs;
  };

  /* the exterior pieces chained into loops, the building on the left */
  const outerLoops = (pieces) => {
    const ext = pieces.filter((p) => p.cls === 'ext').map((p) => {
      const inLeft = p.L >= 0 && p.out && dot(p.out, p.n) < 0;
      return inLeft ? { a: p.a, b: p.b, u: p.u, piece: p } : { a: p.b, b: p.a, u: mul(p.u, -1), piece: p };
    });
    const starts = new Map();
    for (const e of ext) { const k = key(e.a); if (!starts.has(k)) starts.set(k, []); starts.get(k).push(e); }
    const used = new Set();
    const loops = [];
    for (const e0 of ext) {
      if (used.has(e0)) continue;
      const loop = [];
      let cur = e0;
      let guard = 0;
      while (cur && !used.has(cur) && guard++ < 10000) {
        used.add(cur); loop.push(cur);
        const cands = (starts.get(key(cur.b)) || []).filter((c) => !used.has(c));
        if (!cands.length) break;
        /* keep the building on the left: take the sharpest left turn */
        cands.sort((p, q) => Math.atan2(cross(cur.u, q.u), dot(cur.u, q.u)) - Math.atan2(cross(cur.u, p.u), dot(cur.u, p.u)));
        cur = cands[0];
      }
      if (loop.length) loops.push(loop);
    }
    return loops;
  };

  const cutOpenings = (segs, pieces) => {
    let out = segs;
    for (const p of pieces) {
      if (!p.openings.length) continue;
      const next = [];
      for (const s of out) {
        if (!s.piece || (s.piece !== p && s.piece.id !== p.id)) { next.push(s); continue; }
        /* the segment along the piece: cut every opening out of it */
        let parts = [s];
        for (const o of p.openings) {
          const np = [];
          for (const q of parts) {
            const la = dot(sub(q.a, p.a), p.u), lb = dot(sub(q.b, p.a), p.u);
            const lo = Math.min(la, lb), hi = Math.max(la, lb);
            if (hi <= o.s0 + 1e-6 || lo >= o.s1 - 1e-6) { np.push(q); continue; }
            const at = (t) => add(p.a, add(mul(p.u, t), mul(p.n, dot(sub(q.a, p.a), p.n))));
            const fwd = lb >= la;
            const keep = [];
            if (o.s0 - lo > 1e-4) keep.push(fwd ? { a: q.a, b: at(o.s0) } : { a: at(o.s0), b: q.b });
            if (hi - o.s1 > 1e-4) keep.push(fwd ? { a: at(o.s1), b: q.b } : { a: q.a, b: at(o.s1) });
            for (const k of keep) np.push({ a: k.a, b: k.b, piece: q.piece });
          }
          parts = np;
        }
        for (const q of parts) next.push(q);
      }
      out = next;
    }
    return out;
  };

  /* segments -> polylines, joined at shared ends */
  const chain = (segs) => {
    const ends = new Map();
    const addEnd = (k, i) => { if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); };
    segs.forEach((s, i) => { addEnd(key(s.a), i); addEnd(key(s.b), i); });
    const used = new Uint8Array(segs.length);
    const out = [];
    const walk = (i, fromStart) => {
      const pts = [];
      let cur = i, p = fromStart ? segs[i].a : segs[i].b, q = fromStart ? segs[i].b : segs[i].a;
      pts.push(p, q);
      used[cur] = 1;
      for (let guard = 0; guard < 100000; guard++) {
        const list = (ends.get(key(q)) || []).filter((j) => !used[j]);
        if (list.length !== 1) break;
        const j = list[0];
        used[j] = 1;
        const nq = key(segs[j].a) === key(q) ? segs[j].b : segs[j].a;
        pts.push(nq);
        q = nq;
        if (key(q) === key(pts[0])) break;
      }
      return pts;
    };
    /* open chains first, from their free ends */
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      const freeA = (ends.get(key(segs[i].a)) || []).filter((j) => !used[j]).length === 1;
      const freeB = (ends.get(key(segs[i].b)) || []).filter((j) => !used[j]).length === 1;
      if (freeA || freeB) out.push(walk(i, freeA));
    }
    for (let i = 0; i < segs.length; i++) if (!used[i]) out.push(walk(i, true));
    return out.map((pts) => {
      const closed = pts.length > 2 && key(pts[0]) === key(pts[pts.length - 1]);
      if (closed) pts.pop();
      /* drop the middle of three collinear points */
      const q = [];
      for (let i = 0; i < pts.length; i++) {
        const a = q[q.length - 1], c = pts[i];
        const nxt = pts[i + 1];
        if (a && nxt && Math.abs(cross(sub(c, a), sub(nxt, c))) < 1e-7 && dot(sub(c, a), sub(nxt, c)) > 0) continue;
        q.push(c);
      }
      return { pts: q, closed };
    });
  };

  /* ================================================================== *
   * 6. symbols: openings, stairs, furniture, labels
   * ================================================================== */
  const drawOpenings = (O, pieces, rooms) => {
    for (const p of pieces) {
      for (const o of p.openings) {
        const P = (s, off) => add(add(p.a, mul(p.u, s)), mul(p.n, p.c + off));
        const h = p.t / 2;
        O.line(P(o.s0, -h), P(o.s0, h), LAYERS.wall);
        O.line(P(o.s1, -h), P(o.s1, h), LAYERS.wall);
        if (o.kind === 'window') {
          O.line(P(o.s0, -p.t / 6), P(o.s1, -p.t / 6), LAYERS.glaz);
          O.line(P(o.s0, p.t / 6), P(o.s1, p.t / 6), LAYERS.glaz);
          continue;
        }
        if (o.kind === 'garage') {
          O.line(P(o.s0, 0), P(o.s1, 0), LAYERS.door);
          O.line(P(o.s0, -h * 0.4), P(o.s1, -h * 0.4), LAYERS.door);
          continue;
        }
        /* the leaf and its swing, into the room entered */
        const ns = o.swingRoom === p.L ? p.n : mul(p.n, -1);
        const leaf = (sHinge, sOther, w) => {
          const H = P(sHinge, dot(ns, p.n) * h);
          const tip = add(H, mul(ns, w));
          O.line(H, tip, LAYERS.door);
          const ud = mul(p.u, Math.sign(sOther - sHinge));
          const a0 = Math.atan2(ns.y, ns.x), a1 = Math.atan2(ud.y, ud.x);
          const sweep = ((a1 - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
          if (sweep < Math.PI) O.arc(H, w, a0, a1, LAYERS.door); else O.arc(H, w, a1, a0, LAYERS.door);
        };
        if (o.double) { leaf(o.s0, o.s1, o.w / 2); leaf(o.s1, o.s0, o.w / 2); }
        else {
          /* hinge on the side nearer the wall's end: the door opens against the corner */
          const hingeAtStart = o.s0 <= p.len - o.s1;
          leaf(hingeAtStart ? o.s0 : o.s1, hingeAtStart ? o.s1 : o.s0, o.w);
        }
      }
    }
  };

  /* the room's usable rectangle: its rect pulled in by the wall faces, and
     the four sides as local frames (u along the wall, n into the room) */
  /* how far in from each cell edge the room's clear space starts: the wall's
     whole thickness on an exterior edge, half on a partition, the exterior
     thickness where no piece was found (a slanted edge cut by the land) */
  const edgeInsets = (room, ri, pieces, tExt) => {
    const cell = room.cell;
    return cell.map((a, i) => {
      const b = cell[(i + 1) % cell.length];
      let d = 0;
      for (const e of piecesOnEdge(pieces, a, b)) d = Math.max(d, e.p.cls === 'ext' ? e.p.t : e.p.t / 2);
      return d || tExt;
    });
  };
  const innerRect = (room, ri, pieces, tExt) => {
    const b = room.box, cell = room.cell;
    const ins = edgeInsets(room, ri, pieces, tExt);
    const side = { S: tExt, E: tExt, N: tExt, W: tExt };
    cell.forEach((a, i) => {
      const q = cell[(i + 1) % cell.length];
      if (Math.abs(a.y - q.y) < 1e-6) { if (Math.abs(a.y - b.miny) < 1e-6) side.S = Math.min(side.S, ins[i]); if (Math.abs(a.y - b.maxy) < 1e-6) side.N = Math.min(side.N, ins[i]); }
      if (Math.abs(a.x - q.x) < 1e-6) { if (Math.abs(a.x - b.minx) < 1e-6) side.W = Math.min(side.W, ins[i]); if (Math.abs(a.x - b.maxx) < 1e-6) side.E = Math.min(side.E, ins[i]); }
    });
    return { minx: b.minx + side.W, miny: b.miny + side.S, maxx: b.maxx - side.E, maxy: b.maxy - side.N, insets: ins };
  };
  const sideFrames = (ir) => ([
    { side: 'S', o: { x: ir.minx, y: ir.miny }, u: { x: 1, y: 0 }, n: { x: 0, y: 1 }, len: ir.maxx - ir.minx },
    { side: 'E', o: { x: ir.maxx, y: ir.miny }, u: { x: 0, y: 1 }, n: { x: -1, y: 0 }, len: ir.maxy - ir.miny },
    { side: 'N', o: { x: ir.maxx, y: ir.maxy }, u: { x: -1, y: 0 }, n: { x: 0, y: -1 }, len: ir.maxx - ir.minx },
    { side: 'W', o: { x: ir.minx, y: ir.maxy }, u: { x: 0, y: -1 }, n: { x: 1, y: 0 }, len: ir.maxy - ir.miny }
  ]);

  const roomOpenings = (room, ri, pieces) => {
    const out = [];
    for (const p of pieces) {
      if (p.L !== ri && p.R !== ri) continue;
      for (const o of p.openings) {
        const into = o.kind === 'window' ? null : o.kind === 'garage' ? 'garage' : (o.swingRoom === ri);
        const s = (o.s0 + o.s1) / 2;
        const c = add(p.a, mul(p.u, s));
        const n = p.L === ri ? p.n : mul(p.n, -1);        /* into this room */
        out.push({ o, c, n, u: p.u, into, w: o.w });
      }
    }
    return out;
  };

  /* a placer: rectangles of furniture that must sit inside the cell, clear
     of the door swings and of each other */
  const placer = (room, ri, pieces, tExt) => {
    const ir = innerRect(room, ri, pieces, tExt);
    const ops = roomOpenings(room, ri, pieces);
    const zoneOf = (z, w, d) => {
      /* a w-wide, d-deep patch on this room's side of the opening */
      const c = add(z.c, mul(z.n, d / 2));
      return { c, hw: Math.abs(z.u.x) * w / 2 + Math.abs(z.n.x) * d / 2, hh: Math.abs(z.u.y) * w / 2 + Math.abs(z.n.y) * d / 2 };
    };
    /* the swing square of a door opening into the room; the approach of a
       door opening out of it; and, for deep wall items only, the light of
       a window */
    const zones = ops.filter((z) => z.into === true).map((z) => zoneOf(z, z.w + 0.2, z.w + 0.2))
      .concat(ops.filter((z) => z.into === false).map((z) => zoneOf(z, z.w + 0.2, 0.9)))
      .concat(ops.filter((z) => z.into === 'garage').map((z) => zoneOf(z, z.w + 0.2, 0.3)));
    const winZones = ops.filter((z) => z.into === null).map((z) => zoneOf(z, z.w + 0.2, 0.7));
    const taken = [];
    const okCorner = (p) => pointInPoly(room.cell, p) && room.cell.every((a, i) => distToSeg(p, a, room.cell[(i + 1) % room.cell.length]) >= ir.insets[i] - 1e-4);
    let deepItem = false;               /* set by the callers for wardrobes, runs, desks */
    const rectOK = (pts, box) => {
      if (!pts.every(okCorner)) return false;
      const zs = deepItem ? zones.concat(winZones) : zones;
      for (const z of zs) if (!(box.maxx <= z.c.x - z.hw || box.minx >= z.c.x + z.hw || box.maxy <= z.c.y - z.hh || box.miny >= z.c.y + z.hh)) return false;
      for (const t of taken) if (!(box.maxx <= t.minx + 1e-6 || box.minx >= t.maxx - 1e-6 || box.maxy <= t.miny + 1e-6 || box.miny >= t.maxy - 1e-6)) return false;
      return true;
    };
    const frames = sideFrames(ir);
    const doorSides = new Set(), winSides = new Set();
    for (const z of ops) {
      const f = frames.find((fr) => Math.abs(dot(fr.n, z.n) - 1) < 1e-6);
      if (f) (z.o.kind === 'window' ? winSides : doorSides).add(f.side);
    }
    const sideOrder = () => frames.slice().sort((a, b) => {
      const sa = (doorSides.has(a.side) ? 2 : 0) + (winSides.has(a.side) ? 1 : 0);
      const sb = (doorSides.has(b.side) ? 2 : 0) + (winSides.has(b.side) ? 1 : 0);
      return sa - sb || b.len - a.len;
    });
    /* try a wÃ—d item against a wall; -> local frame {o,u,n} or null */
    const tryAt = (f, s, w, d) => {
      const o = add(f.o, mul(f.u, s));
      const pts = [o, add(o, mul(f.u, w)), add(add(o, mul(f.u, w)), mul(f.n, d)), add(o, mul(f.n, d))];
      const box = bboxOf(pts);
      if (!rectOK(pts, box)) return null;
      taken.push(box);
      return { o, u: f.u, n: f.n, side: f.side, box, s, len: f.len };
    };
    const alongWall = (w, d, prefs, ats, keepOffWindows) => {
      const sides = prefs ? frames.filter((f) => prefs.indexOf(f.side) >= 0).concat(sideOrder().filter((f) => prefs.indexOf(f.side) < 0)) : sideOrder();
      deepItem = !!keepOffWindows;
      try {
        for (const f of sides) {
          if (f.len < w + 0.05) continue;
          for (const at of (ats || [0.5, 0.02, 0.98, 0.25, 0.75])) {
            const got = tryAt(f, 0.02 + (f.len - w - 0.04) * at, w, d);
            if (got) return got;
          }
        }
        return null;
      } finally { deepItem = false; }
    };
    const atWall = (side, s, w, d) => {
      const f = frames.find((fr) => fr.side === side);
      if (!f || s < 0 || s + w > f.len - 0.02) return null;
      return tryAt(f, s, w, d);
    };
    /* a wÃ—h item centred at c (axis aligned) */
    const centred = (c, w, h) => {
      const pts = [{ x: c.x - w / 2, y: c.y - h / 2 }, { x: c.x + w / 2, y: c.y - h / 2 }, { x: c.x + w / 2, y: c.y + h / 2 }, { x: c.x - w / 2, y: c.y + h / 2 }];
      const box = bboxOf(pts);
      if (!rectOK(pts, box)) return null;
      taken.push(box);
      return { o: pts[0], u: { x: 1, y: 0 }, n: { x: 0, y: 1 }, box };
    };
    /* centred, or as near the centre as the room allows: a door swing or a
       slanted wall must not leave the room empty */
    const centredNear = (c, w, h, reach) => {
      const steps = [0];
      for (let d = 0.3; d <= (reach || 1.5) + 1e-9; d += 0.3) steps.push(d, -d);
      for (const dy of steps) for (const dx of steps) {
        const got = centred({ x: c.x + dx, y: c.y + dy }, w, h);
        if (got) return got;
      }
      return null;
    };
    const reserve = pts => { const box=bboxOf(pts); if(!rectOK(pts,box))return false; taken.push(box); return true; };
    return { ir, alongWall, atWall, centred, centredNear, frames, taken, ops, reserve };
  };

  /* draw helpers in a local frame: L(x, y) = o + uÂ·x + nÂ·y */
  const local = (F) => (x, y) => add(add(F.o, mul(F.u, x)), mul(F.n, y));
  const lrect = (O, F, x, y, w, h, layer) => {
    const L = local(F);
    O.pline([L(x, y), L(x + w, y), L(x + w, y + h), L(x, y + h)], true, layer || LAYERS.furn);
  };
  const lround = (O, F, x, y, w, h, r, layer) => {
    /* a rounded rectangle as a bulged polyline */
    const L = local(F);
    const b = Math.tan(Math.PI / 8);
    r = Math.min(r, w / 2, h / 2);
    const pts = [L(x + r, y), L(x + w - r, y), L(x + w, y + r), L(x + w, y + h - r),
      L(x + w - r, y + h), L(x + r, y + h), L(x, y + h - r), L(x, y + r)];
    /* the bulge belongs to the segment leaving its vertex: every second one is an arc */
    O.pline(pts.map((p, i) => ({ x: p.x, y: p.y, b: i % 2 === 1 ? b : 0 })), true, layer || LAYERS.furn);
  };
  const lline = (O, F, x0, y0, x1, y1, layer) => { const L = local(F); O.line(L(x0, y0), L(x1, y1), layer || LAYERS.furn); };
  const lcircle = (O, F, x, y, r, layer) => { const L = local(F); O.circle(L(x, y), r, layer || LAYERS.furn); };

  const furnish = (O, room, ri, pieces, tExt) => {
    const k = room.kind;
    const P = placer(room, ri, pieces, tExt);
    const A = room.area;
    const n0 = O.ents.length;
    const wide = P.ir.maxx - P.ir.minx, deep = P.ir.maxy - P.ir.miny;
    const bed = (w) => {
      const F = P.alongWall(w, 2.05);
      if (!F) return false;
      lrect(O, F, 0, 0, w, 2.05);
      lrect(O, F, 0.02, 0.02, w - 0.04, 0.14);                 /* headboard */
      const pw = w >= 1.4 ? (w - 0.3) / 2 : w - 0.2;
      lround(O, F, 0.1, 0.22, pw, 0.42, 0.08);                 /* pillows */
      if (w >= 1.4) lround(O, F, w - 0.1 - pw, 0.22, pw, 0.42, 0.08);
      lline(O, F, 0, 0.78, w, 0.78);                           /* the blanket line */
      /* nightstands either side when there is room */
      const L = local(F);
      for (const sgn of [-1, 1]) {
        const x = sgn < 0 ? -0.52 : w + 0.02;
        const pts = [L(x, 0), L(x + 0.5, 0), L(x + 0.5, 0.5), L(x, 0.5)];
        const inside = P.reserve(pts);
        if (inside) { O.pline(pts, true, LAYERS.furn); O.circle(L(x + 0.25, 0.25), 0.12, LAYERS.furn); }
      }
      return true;
    };
    const wardrobe = () => {
      const w = Math.min(2.0, Math.max(1.2, wide - 1));
      const F = P.alongWall(w, 0.6, null, null, true);
      if (!F) return;
      lrect(O, F, 0, 0, w, 0.6);
      const doors = Math.max(2, Math.round(w / 0.5));
      for (let i = 1; i < doors; i++) lline(O, F, w * i / doors, 0, w * i / doors, 0.6);
      lline(O, F, 0, 0.6, w, 0);                                 /* the diagonal says "wardrobe" */
    };
    const sofaSet = () => {
      const w = Math.min(2.4, wide - 0.6);
      if (w < 1.6) return;
      const F = P.alongWall(w, 0.9);
      if (!F) return;
      lround(O, F, 0, 0, w, 0.9, 0.12);
      lline(O, F, 0.12, 0.28, w - 0.12, 0.28);                    /* backrest */
      lline(O, F, 0, 0.28, 0, 0);
      const seats = Math.max(2, Math.round(w / 0.8));
      for (let i = 1; i < seats; i++) lline(O, F, w * i / seats, 0.28, w * i / seats, 0.86);
      lline(O, F, 0.12, 0.28, 0.12, 0.86); lline(O, F, w - 0.12, 0.28, w - 0.12, 0.86);
      /* the coffee table in front, then the armchairs beside it */
      const L = local(F);
      const t = { o: L(w / 2 - 0.55, 1.35), u: F.u, n: F.n };
      const tpts = [L(w / 2 - 0.55, 1.35), L(w / 2 + 0.55, 1.35), L(w / 2 + 0.55, 1.95), L(w / 2 - 0.55, 1.95)];
      if (P.reserve(tpts)) { lround(O, t, 0, 0, 1.1, 0.6, 0.1); }
      for (const sgn of [-1, 1]) {
        const x = sgn < 0 ? -0.95 : w + 0.15;
        const pts = [L(x, 0.05), L(x + 0.8, 0.05), L(x + 0.8, 0.85), L(x, 0.85)];
        if (!P.reserve(pts)) continue;
        const G = { o: L(x, 0.05), u: F.u, n: F.n };
        lround(O, G, 0, 0, 0.8, 0.8, 0.1);
        lline(O, G, 0.1, 0.25, 0.7, 0.25);
        lline(O, G, 0.1, 0.25, 0.1, 0.75); lline(O, G, 0.7, 0.25, 0.7, 0.75);
      }
      /* the TV unit on the wall opposite */
      const opp = { S: 'N', N: 'S', E: 'W', W: 'E' }[F.side];
      const T = P.alongWall(Math.min(1.8, w), 0.45, [opp]);
      if (T && T.side === opp) { lrect(O, T, 0, 0, Math.min(1.8, w), 0.45); lrect(O, T, 0.3, 0.4, Math.min(1.8, w) - 0.6, 0.06); }
    };
    const diningSet = () => {
      const big = wide >= 3.2 && deep >= 3.2;
      const tw = big ? 1.8 : 1.4, td = 0.9;
      const c0 = { x: (P.ir.minx + P.ir.maxx) / 2, y: (P.ir.miny + P.ir.maxy) / 2 };
      /* the table with its chairs, near the middle; with less room around it
         when the door swings would otherwise leave the room bare */
      let F = P.centredNear(c0, wide >= deep ? tw + 1.2 : td + 1.2, wide >= deep ? td + 1.2 : tw + 1.2, 1.5);
      if (!F) F = P.centredNear(c0, wide >= deep ? tw + 0.6 : td + 0.6, wide >= deep ? td + 0.6 : tw + 0.6, 1.5);
      if (!F) return;
      const c = { x: (F.box.minx + F.box.maxx) / 2, y: (F.box.miny + F.box.maxy) / 2 };
      const W = wide >= deep ? tw : td, D = wide >= deep ? td : tw;
      const G = { o: { x: c.x - W / 2, y: c.y - D / 2 }, u: { x: 1, y: 0 }, n: { x: 0, y: 1 } };
      lrect(O, G, 0, 0, W, D);
      const chair = (x, y, dir) => {
        const H = { o: { x, y }, u: dir === 'x' ? { x: 1, y: 0 } : { x: 0, y: 1 }, n: dir === 'x' ? { x: 0, y: 1 } : { x: 1, y: 0 } };
        lround(O, H, 0, 0, 0.45, 0.45, 0.08);
      };
      const nl = Math.max(1, Math.round(Math.max(W, D) / 0.65));
      for (let i = 0; i < nl; i++) {
        const t = (i + 0.5) / nl;
        if (W >= D) { chair(c.x - W / 2 + t * W - 0.225, c.y - D / 2 - 0.55, 'x'); chair(c.x - W / 2 + t * W - 0.225, c.y + D / 2 + 0.1, 'x'); }
        else { chair(c.x - W / 2 - 0.55, c.y - D / 2 + t * D - 0.225, 'y'); chair(c.x + W / 2 + 0.1, c.y - D / 2 + t * D - 0.225, 'y'); }
      }
      if (W >= D) { chair(c.x - W / 2 - 0.55, c.y - 0.225, 'y'); chair(c.x + W / 2 + 0.1, c.y - 0.225, 'y'); }
      else { chair(c.x - 0.225, c.y - D / 2 - 0.55, 'x'); chair(c.x - 0.225, c.y + D / 2 + 0.1, 'x'); }
    };
    const kitchenRun = () => {
      let w = Math.min(3.6, Math.max(1.8, (wide >= deep ? wide : deep) - 0.9));
      let F = P.alongWall(w, 0.6, null, [0.98, 0.02, 0.5, 0.25, 0.75]);
      /* the walls are taken by doors and windows: a shorter run still is a kitchen */
      for (const shorter of [2.4, 1.8, 1.2]) { if (F || shorter >= w) continue; w = shorter; F = P.alongWall(w, 0.6, null, [0.98, 0.02, 0.5, 0.25, 0.75]); }
      if (!F) return;
      lrect(O, F, 0, 0, w, 0.6);
      /* sink at a third, hob at two thirds */
      lrect(O, F, w * 0.3 - 0.35, 0.08, 0.7, 0.44);
      lcircle(O, F, w * 0.3 - 0.17, 0.3, 0.14); lcircle(O, F, w * 0.3 + 0.17, 0.3, 0.14);
      lrect(O, F, w * 0.68 - 0.3, 0.05, 0.6, 0.5);
      for (const [dx, dy] of [[-0.15, -0.12], [0.15, -0.12], [-0.15, 0.12], [0.15, 0.12]]) lcircle(O, F, w * 0.68 + dx, 0.3 + dy, 0.09);
      /* the fridge at the run's free end */
      const atEnd = F.s > F.len / 2;
      const G = P.atWall(F.side, atEnd ? F.s - 0.75 : F.s + w + 0.05, 0.7, 0.7);
      if (G) { lrect(O, G, 0, 0, 0.7, 0.7); lrect(O, G, 0.06, 0.06, 0.58, 0.58); }
      /* the return leg of an L round the corner the run reaches */
      const next = { S: 'E', E: 'N', N: 'W', W: 'S' }, prev = { E: 'S', N: 'E', W: 'N', S: 'W' };
      const legLen = Math.min(2.4, (F.u.x !== 0 ? deep : wide) - 1.4);
      if (legLen < 0.9) return;
      const leg = atEnd ? P.atWall(next[F.side], 0.62, legLen, 0.6) : null;
      const legB = !leg ? (() => { const f = P.frames.find((fr) => fr.side === prev[F.side]); return f ? P.atWall(prev[F.side], f.len - 0.62 - legLen, legLen, 0.6) : null; })() : null;
      const R = leg || legB;
      if (R) lrect(O, R, 0, 0, legLen, 0.6);
    };
    const bathSet = (small) => {
      const wc = () => {
        const F = P.alongWall(0.45, 0.72);
        if (!F) return;
        lrect(O, F, 0.02, 0, 0.41, 0.2);                            /* cistern */
        const L = local(F);
        const c = L(0.225, 0.46);
        O.pline([{ ...L(0.045, 0.22), b: 0 }, { ...L(0.405, 0.22), b: 0.35 }, { ...L(0.405, 0.5), b: 0.6 }, { ...L(0.045, 0.5), b: 0.35 }], true, LAYERS.furn);
        O.circle(c, 0.05, LAYERS.furn);
      };
      const basin = () => {
        const F = P.alongWall(0.55, 0.45);
        if (!F) return;
        lrect(O, F, 0, 0, 0.55, 0.45);
        lcircle(O, F, 0.275, 0.24, 0.16);
        lcircle(O, F, 0.275, 0.1, 0.02);
      };
      wc(); basin();
      if (small) return;
      if (wide >= 2.3 && deep >= 1.9 || wide >= 1.9 && deep >= 2.3) {
        const F = P.alongWall(1.7, 0.75);
        if (F) { lrect(O, F, 0, 0, 1.7, 0.75); lround(O, F, 0.08, 0.08, 1.54, 0.59, 0.2); lcircle(O, F, 0.3, 0.375, 0.04); return; }
      }
      const F = P.alongWall(0.9, 0.9);
      if (F) { lrect(O, F, 0, 0, 0.9, 0.9); lline(O, F, 0, 0, 0.9, 0.9); lline(O, F, 0.9, 0, 0, 0.9); lcircle(O, F, 0.45, 0.45, 0.05); }
    };
    const desk = () => {
      const F = P.alongWall(1.5, 1.35); // Reserve the chair approach with the desk.
      if (!F) return;
      lrect(O, F, 0, 0, 1.5, 0.7);
      const G = { o: local(F)(0.5, 0.8), u: F.u, n: F.n };
      lround(O, G, 0, 0, 0.5, 0.5, 0.1);
      const S = P.alongWall(1.2, 0.35);
      if (S) { lrect(O, S, 0, 0, 1.2, 0.35); lline(O, S, 0, 0.175, 1.2, 0.175); }
    };
    const car = () => {
      const alongX = wide >= deep;
      const L = Math.min(4.6, (alongX ? wide : deep) - 0.6), Wc = 1.75;
      if (L < 3.6) return;
      const lanes = Math.max(1, Math.min(3, Math.floor((alongX ? deep : wide) / 2.6)));
      const span = alongX ? deep : wide;
      for (let i = 0; i < lanes; i++) {
        const off = (i + 0.5) * span / lanes;
        const c0 = alongX ? { x: (P.ir.minx + P.ir.maxx) / 2, y: P.ir.miny + off } : { x: P.ir.minx + off, y: (P.ir.miny + P.ir.maxy) / 2 };
        const F = P.centredNear(c0, alongX ? L : Wc, alongX ? Wc : L, 1.2);
        if (!F) continue;
        const c = { x: (F.box.minx + F.box.maxx) / 2, y: (F.box.miny + F.box.maxy) / 2 };
        const G = alongX ? { o: { x: c.x - L / 2, y: c.y - Wc / 2 }, u: { x: 1, y: 0 }, n: { x: 0, y: 1 } }
          : { o: { x: c.x + Wc / 2, y: c.y - L / 2 }, u: { x: 0, y: 1 }, n: { x: -1, y: 0 } };
        lround(O, G, 0, 0, L, Wc, 0.35);
        lline(O, G, L * 0.28, 0.1, L * 0.36, Wc - 0.1); lline(O, G, L * 0.72, 0.1, L * 0.64, Wc - 0.1);
        lline(O, G, L * 0.36, 0.1, L * 0.64, 0.1); lline(O, G, L * 0.36, Wc - 0.1, L * 0.64, Wc - 0.1);
      }
    };
    const machines = () => {
      const F = P.alongWall(1.3, 0.62);
      if (!F) return;
      lrect(O, F, 0, 0, 0.62, 0.62); lcircle(O, F, 0.31, 0.31, 0.22);
      lrect(O, F, 0.68, 0, 0.62, 0.62); lcircle(O, F, 0.99, 0.31, 0.22);
    };

    const shelving = (retail) => {
      const count=Math.min(16,Math.max(2,Math.floor((wide+deep)/2)));
      for(let i=0;i<count;i++) {
        const f=P.alongWall(retail?1.8:1.5,.5,null,[.02,.98,.25,.75,.5]);if(!f)break;
        lrect(O,f,0,0,retail?1.8:1.5,.5);
        for(let x=.3;x<(retail?1.8:1.5);x+=.3)lline(O,f,x,0,x,.5);
      }
      if(retail) desk();
    };
    if (kindHas(k, ['workshop'])) return false; // Equipment needs the task brief/library, not retail shelves.
    if (kindHas(k, ['shop','showroom','retail','sales'])) shelving(true);
    else if (kindHas(k, ['store','storage'])) shelving(false);
    else if (kindHas(k, ['master'])) { bed(1.8); wardrobe(); }
    else if (kindHas(k, ['bedroom', 'guest', 'kids', 'child', 'nanny', 'maid'])) { bed(A >= 11 ? 1.6 : 1.0); wardrobe(); }
    else if (kindHas(k, ['living', 'lounge', 'family', 'majlis', 'salon', 'reception', 'sitting'])) sofaSet();
    else if (kindHas(k, ['dining','meeting'])) diningSet();
    else if (kindHas(k, ['kitchen', 'kitchenette', 'pantry'])) kitchenRun();
    else if (kindHas(k, ['wc', 'toilet', 'powder'])) bathSet(true);
    else if (kindHas(k, ['bath', 'shower', 'ensuite'])) bathSet(false);
    else if (kindHas(k, ['study', 'office', 'library'])) desk();
    else if (kindHas(k, ['garage', 'carport', 'parking'])) car();
    else if (kindHas(k, ['laundry', 'utility'])) machines();
    else if (kindHas(k, ['hall','corridor','passage','entry','foyer','lobby','landing'])) return null;
    else return false;                  /* unknown furniture must not be called fully furnished */
    return O.ents.length > n0;
  };

  const drawStairs = (O, room, ri, pieces, tExt, spec, notes) => {
    const P = placer(room, ri, pieces, tExt);
    const ir = P.ir;
    const wide = ir.maxx - ir.minx, deep = ir.maxy - ir.miny;
    let side = String(spec.side || '').toUpperCase();
    if (!SIDES[side]) side = wide >= deep ? 'S' : 'W';
    const F = P.frames.find((f) => f.side === side);
    const w = num(Number(spec.width)) && Number(spec.width) > 0 ? Number(spec.width) : Math.min(1.2, Math.max(0.9, (F.u.x !== 0 ? deep : wide) - 0.2));
    const floorRise = num(Number(spec.rise)) && Number(spec.rise) >= 2 && Number(spec.rise) <= 5 ? Number(spec.rise) : 3;
    const neededTreads = Math.ceil(floorRise / .18) - 1;
    const length = Math.min(F.len - 0.1, neededTreads * .27);
    if (length < 1.6 || (F.u.x !== 0 ? deep : wide) < w) { notes.push('FAULT: the stairs do not fit in ' + room.name); return false; }
    if (Math.floor((length+EPS) / 0.27) < neededTreads) {
      const rise = num(Number(spec.rise)) && Number(spec.rise) >= 2 && Number(spec.rise) <= 5 ? Number(spec.rise) : 3;
      const risers = Math.ceil(rise / 0.18), first = Math.ceil((risers-2)/2), second = risers-2-first;
      const flight = num(Number(spec.width)) && Number(spec.width) >= .9 ? Number(spec.width) : .9;
      const run = first*.27, landing=flight, total=run+landing, breadth=2*flight+.1;
      const gf=P.alongWall(total,breadth);
      if(gf) {
        lrect(O,gf,0,0,run,flight,LAYERS.stair);lrect(O,gf,0,flight+.1,run,flight,LAYERS.stair);
        lrect(O,gf,run,0,landing,breadth,LAYERS.stair);
        for(let i=1;i<first;i++)lline(O,gf,i*.27,0,i*.27,flight,LAYERS.stair);
        for(let i=1;i<second;i++)lline(O,gf,run-i*.27,flight+.1,run-i*.27,breadth,LAYERS.stair);
        const L=local(gf);O.pline([L(.15,flight/2),L(run+landing/2,flight/2),L(run+landing/2,flight*1.5+.1),L(.15,flight*1.5+.1)],false,LAYERS.stair);
        lline(O,gf,.15,flight*1.5+.1,.4,flight*1.5-.04,LAYERS.stair);lline(O,gf,.15,flight*1.5+.1,.4,flight*1.5+.24,LAYERS.stair);
        notes.push('Dog-leg stairs in '+room.name+': '+risers+' risers over '+r1(rise)+' m '+(spec.rise?'as specified':'assumed floor height')+', '+r1(flight)+' m flights and landing; verify headroom, structure and local requirements.');
        return true;
      }
    }
    const at = num(Number(spec.at)) ? clamp(Number(spec.at), 0, 1) : 0;
    const o = add(F.o, mul(F.u, 0.05 + (F.len - 0.1 - length) * at));
    const G = { o, u: F.u, n: F.n };
    const L = local(G);
    O.pline([L(0, 0), L(length, 0), L(length, w), L(0, w)], true, LAYERS.stair);
    const treads = Math.floor((length+EPS) / 0.27);
    if (treads < neededTreads) notes.push('FAULT: the stairs in ' + room.name + ' run only ' + treads + ' treads (' + r1(length) + ' m); the ' + r1(floorRise) + ' m ' + (spec.rise ? 'specified' : 'assumed') + ' storey needs ' + neededTreads + ' treads - use a dog-leg or a longer room');
    for (let i = 1; i < treads; i++) lline(O, G, i * 0.27, 0, i * 0.27, w, LAYERS.stair);
    /* the arrow up the flight, and the break line two thirds along */
    lline(O, G, 0.12, w / 2, length - 0.15, w / 2, LAYERS.stair);
    lcircle(O, G, 0.12, w / 2, 0.05, LAYERS.stair);
    lline(O, G, length - 0.15, w / 2, length - 0.4, w / 2 - 0.12, LAYERS.stair);
    lline(O, G, length - 0.15, w / 2, length - 0.4, w / 2 + 0.12, LAYERS.stair);
    const bx = length * 0.62;
    O.pline([L(bx - 0.15, -0.05), L(bx + 0.05, w * 0.4), L(bx - 0.05, w * 0.6), L(bx + 0.15, w + 0.05)], false, LAYERS.stair);
    P.taken.push(bboxOf([L(0, 0), L(length, 0), L(length, w), L(0, w)]));
    return true;
  };

  const label = (O, room) => {
    const w = room.box.maxx - room.box.minx, h = room.box.maxy - room.box.miny;
    const small = Math.min(w, h) < 1.7 || room.area < 4;
    let hn = small ? 0.15 : 0.24; const ha = small ? 0.11 : 0.16;
    const name = String(room.name || room.kind).toUpperCase();
    const core = root.NasjPlanWorkflow?.usableCore(room.cell, .15);
    let c = core ? {x:core.x+core.w/2,y:core.y+core.h/2} : room.c;
    const area = room.area >= 100 ? Math.round(room.area) : Math.round(room.area * 10) / 10;
    if (Math.min(w, h) < 0.9) { O.text(c, name, 0.1, LAYERS.text); return; }
    // Keep labels inside a usable room core, including tapered/concave cells.
    const width = core ? Math.max(.3,core.w-.25) : w;
    const words=name.split(/\s+/),lines=[];let line='';
    const chars=Math.max(6,Math.floor(width/(hn*.72)));
    for(const word of words){if(line&&(line+' '+word).length>chars){lines.push(line);line=word;}else line+=(line?' ':'')+word;}
    if(line)lines.push(line);
    hn=Math.min(hn,width/(Math.max(...lines.map(s=>s.length),1)*.72));
    if(core)hn=Math.min(hn,core.h/(lines.length*1.4+2));
    // Find clear annotation space instead of writing over a bed/table/swing.
    const labelW=Math.max(...lines.map(s=>s.length),1)*hn*.72+.12;
    const down=hn*.9+Math.min(ha,hn)*.6,up=(lines.length-1)*hn*1.35+ha*.7+hn*.6;
    const obstacles=O.ents.filter(e=>e.aiFurniture?.roomId===room.id||e.layer===LAYERS.door&&e.type==='arc').map(e=>extent([e])).filter(Boolean);
    const candidates=[c];
    for(const fy of [.25,.4,.6,.75])for(const fx of [.25,.4,.6,.75])candidates.push({x:room.box.minx+w*fx,y:room.box.miny+h*fy});
    let best=Infinity;
    for(const q of candidates){
      const b={minx:q.x-labelW/2,miny:q.y-down,maxx:q.x+labelW/2,maxy:q.y+up};
      const corners=[{x:b.minx,y:b.miny},{x:b.maxx,y:b.miny},{x:b.maxx,y:b.maxy},{x:b.minx,y:b.maxy}];
      if(!corners.every(p=>pointInPoly(room.cell,p))||Math.abs(polyArea(clipRect(room.cell,b)))-(b.maxx-b.minx)*(b.maxy-b.miny)<-1e-5)continue;
      const overlap=obstacles.reduce((n,o)=>n+Math.max(0,Math.min(b.maxx,o.maxx)-Math.max(b.minx,o.minx))*Math.max(0,Math.min(b.maxy,o.maxy)-Math.max(b.miny,o.miny)),0);
      const score=overlap*100+dist(q,room.c)*.01;if(score<best){best=score;c=q;}
    }
    lines.forEach((text,i)=>O.text({x:c.x,y:c.y+(lines.length-1-i)*hn*1.35+ha*.7},text,hn,LAYERS.text));
    O.text({ x: c.x, y: c.y - hn * .9 }, area + ' mÂ²', Math.min(ha,hn), LAYERS.text);
  };

  /* ================================================================== *
   * compile(layout, ctx) -> {ok, entities, stats, notes, rooms} | {ok:false, error}
   *   layout: the tool arguments (rooms, doors, windows, stairs, wall, ...)
   *   ctx.plot: {pts:[{x,y}] metres CCW or CW, W, H} or null (the rooms' box)
   * ================================================================== */
  /* Largest sampled axis-aligned rectangle wholly inside a convex plot.
     Useful for slanted sites: retain all rooms instead of clipping off bedrooms.
     It is conservative (0.05m inside), not a promise of global optimality. */
  const containedBox = pts => {
    const ps = ccw(pts), b = bboxOf(ps);
    for (let i=0;i<ps.length;i++) {
      const a=ps[i],q=ps[(i+1)%ps.length],r=ps[(i+2)%ps.length];
      if ((q.x-a.x)*(r.y-q.y)-(q.y-a.y)*(r.x-q.x)<-EPS) return null;
    }
    const scan = y => {
      const xs=[];
      for(let i=0;i<ps.length;i++) {const a=ps[i],c=ps[(i+1)%ps.length];
        if(Math.abs(a.y-c.y)<EPS) {if(Math.abs(y-a.y)<EPS)xs.push(a.x,c.x);}
        else if(y>=Math.min(a.y,c.y)-EPS&&y<=Math.max(a.y,c.y)+EPS)xs.push(a.x+(c.x-a.x)*(y-a.y)/(c.y-a.y));
      }
      return xs.length?{lo:Math.min(...xs),hi:Math.max(...xs)}:null;
    };
    const ys=Array.from({length:65},(_,i)=>b.miny+(b.maxy-b.miny)*i/64), rows=ys.map(scan);
    let best=null, area=0;
    for(let i=0;i<ys.length-1;i++)for(let j=i+1;j<ys.length;j++) {
      if(!rows[i]||!rows[j])continue;
      const lo=Math.max(rows[i].lo,rows[j].lo)+SNAP,hi=Math.min(rows[i].hi,rows[j].hi)-SNAP;
      const y0=ys[i]+SNAP,y1=ys[j]-SNAP,a=(hi-lo)*(y1-y0);
      if(hi-lo>1&&y1-y0>1&&a>area){area=a;best={minx:lo,miny:y0,maxx:hi,maxy:y1};}
    }
    return best;
  };

  const compile = (layout, ctx) => {
    const notes = [];
    const lay = layout && typeof layout === 'object' ? layout : {};
    const wallSpec = lay.wall && typeof lay.wall === 'object' ? lay.wall : {};
    const tExt = clamp(num(Number(wallSpec.exterior)) && Number(wallSpec.exterior) > 0 ? Number(wallSpec.exterior) : 0.25, 0.1, 0.6);
    const tInt = clamp(num(Number(wallSpec.interior)) && Number(wallSpec.interior) > 0 ? Number(wallSpec.interior) : 0.12, 0.06, 0.4);

    let plot = ctx && ctx.plot && Array.isArray(ctx.plot.pts) && ctx.plot.pts.length >= 3 ? ctx.plot : null;
    let W, H;
    let rawRooms = Array.isArray(lay.rooms) ? lay.rooms : [];
    if (!rawRooms.length) return { ok: false, error: 'the layout names no rooms' };
    if (plot) {
      W = num(plot.W) ? plot.W : bboxOf(plot.pts).maxx;
      H = num(plot.H) ? plot.H : bboxOf(plot.pts).maxy;
    } else {
      const b = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
      for (const r of rawRooms) {
        const x = Number(r && r.x), y = Number(r && r.y), w = Number(r && r.w), h = Number(r && r.h);
        if (![x, y, w, h].every(num)) continue;
        b.minx = Math.min(b.minx, x); b.miny = Math.min(b.miny, y);
        b.maxx = Math.max(b.maxx, x + Math.abs(w)); b.maxy = Math.max(b.maxy, y + Math.abs(h));
      }
      if (!isFinite(b.minx)) return { ok: false, error: 'no room has usable x, y, w, h' };
      /* the layout's own origin becomes the frame's */
      rawRooms = rawRooms.map((r) => (r && typeof r === 'object' ? Object.assign({}, r, { x: Number(r.x) - b.minx, y: Number(r.y) - b.miny }) : r));
      W = b.maxx - b.minx; H = b.maxy - b.miny;
      plot = { pts: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], W, H, origin: { x: b.minx, y: b.miny } };
    }
    if (!(W > 1) || !(H > 1)) return { ok: false, error: 'the boundary is too small to plan in' };

    /* FILL THE LAND. A layout is meant to reach the land's extent edge to
       edge (fill: true, the default). When the rooms' own extent differs
       from W x H - a plan laid out for 20 x 15 handed a 24.3 x 16.2 plot -
       the whole layout is scaled onto the land, axis by axis, and moved to
       its origin, instead of sitting in a corner with a strip of nothing
       beside it or hanging over the far edge to be cut. Proportions move
       by the same factor everywhere, so what adjoins what is unchanged.
       fill: false keeps the metres and the position exactly as given (one
       small building on a big plot). */
    let fitted = null;
    /* SETBACKS: on a plot of land the house keeps off the boundary. The
       layout is mapped onto the buildable rectangle (the land pulled in by
       front, side and rear), indoor rooms are cut to it, and open ground on
       the building line runs on to the land's edge. */
    let build = null, buildBox = null;
    const sb = ctx && ctx.plot ? readSetback(lay.setback) : null;
    if (sb) {
      const poly0 = ccw(dedupe(plot.pts.map((p) => ({ x: Number(p.x), y: Number(p.y) }))));
      build = insetPoly(poly0, sb);
      if (build) {
        buildBox = bboxOf(build);
        notes.push('set back ' + r1(sb.front) + ' m front, ' + r1(sb.side) + ' m sides, ' + r1(sb.rear) + ' m rear: the house is laid out in ' + r1(buildBox.maxx - buildBox.minx) + ' x ' + r1(buildBox.maxy - buildBox.miny) + ' m of the ' + r1(W) + ' x ' + r1(H) + ' m land');
      } else return { ok: false, error: 'The requested setbacks leave no buildable area. Reduce the requested setbacks or revise the brief; they have not been silently removed.' };
    }
    if (ctx && ctx.plot && lay.fill !== false) {
      const lb = rawBox(rawRooms);
      const inside = lay.fit === 'inside' ? containedBox(build || plot.pts) : null;
      if (lay.fit === 'inside' && !inside) return {ok:false,error:'This boundary is concave or leaves no contained rectangular layout. Use fill:false and place rooms within its actual corners.'};
      const tb = inside || buildBox || { minx: 0, miny: 0, maxx: W, maxy: H };
      if (inside) notes.push('The room layout uses a contained '+r1(inside.maxx-inside.minx)+' x '+r1(inside.maxy-inside.miny)+' m rectangle inside the slanted boundary; remaining land is open ground.');
      if (lb) {
        const lw = lb.maxx - lb.minx, lh = lb.maxy - lb.miny;
        const tw = tb.maxx - tb.minx, th = tb.maxy - tb.miny;
        const sx = lw > EPS ? tw / lw : 1, sy = lh > EPS ? th / lh : 1;
        const moved = Math.abs(lb.minx - tb.minx) > SNAP || Math.abs(lb.miny - tb.miny) > SNAP;
        const scaled = Math.abs(sx - 1) > 0.02 || Math.abs(sy - 1) > 0.02;
        if ((moved || scaled) && sx > (inside ? 0.1 : 0.4) && sx < 2.5 && sy > (inside ? 0.1 : 0.4) && sy < 2.5) {
          rawRooms = rawRooms.map((r) => (r && typeof r === 'object' && [r.x, r.y, r.w, r.h].every((v) => num(Number(v)))
            ? Object.assign({}, r, { x: tb.minx + (Number(r.x) - lb.minx) * sx, y: tb.miny + (Number(r.y) - lb.miny) * sy, w: Math.abs(Number(r.w)) * sx, h: Math.abs(Number(r.h)) * sy })
            : r));
          fitted = { sx: r3(sx), sy: r3(sy), from: { W: r3(lw), H: r3(lh) } };
          if (scaled) notes.push('the layout measured ' + r1(lw) + ' x ' + r1(lh) + ' m and was scaled to fill the ' + (build ? 'buildable ' : 'land\'s ') + r1(tw) + ' x ' + r1(th) + ' m');
        }
      }
    }
    const poly = ccw(dedupe(plot.pts.map((p) => ({ x: Number(p.x), y: Number(p.y) }))));
    if (poly.length < 3) return { ok: false, error: 'the boundary is not a closed outline' };

    let rooms = readRooms(rawRooms, W, H, notes);
    if (!rooms.length) return { ok: false, error: 'no room has usable x, y, w, h' };
    rooms = resolveOverlaps(rooms, notes);
    rooms = buildCells(rooms, poly, notes, build, W, H, lay.program);
    if (!rooms.some((r) => !r.outdoor)) return { ok: false, error: 'no room lies inside the boundary' };
    /* what a room should measure: the sizes an engineer would query */
    for (const r of rooms) {
      if (r.outdoor) continue;
      const k = r.kind, w = r.box.maxx - r.box.minx, h = r.box.maxy - r.box.miny, mn = Math.min(w, h);
      if (kindHas(k, ['wc', 'toilet', 'powder']) && r.area > 4.5) notes.push('FAULT: ' + r.name + ' is ' + r1(r.area) + ' mÂ²; review the space allocated to a compact WC (planning preference, not a code maximum; preserve requested accessibility clearances)');
      else if (kindHas(k, ['bath', 'shower', 'ensuite']) && r.area > 10) notes.push('FAULT: ' + r.name + ' is ' + r1(r.area) + ' mÂ²; review whether this much bathroom area is intended; size depends on fixtures and accessibility');
      else if (kindHas(k, ['corridor', 'passage']) && mn < .9) notes.push('FAULT: ' + r.name + ' is only ' + r1(mn) + ' m wide; enlarge the circulation path and verify required clear width');
      else if (kindHas(k, ['corridor', 'passage']) && mn > 2 && r.area > 8) notes.push('FAULT: ' + r.name + ' is ' + r1(mn) + ' m wide; review whether this much circulation space is intended');
      else if (kindHas(k, ['stair']) && r.area > 25) notes.push(r.name + ' is ' + r1(r.area) + ' mÂ²; review whether this much stair and landing area is intended');
      else if (kindHas(k, BEDROOMS) && r.area < 9) notes.push('FAULT: ' + r.name + ' is ' + r1(r.area) + ' mÂ² - a bedroom needs 9 mÂ² or more');
      else if (kindHas(k, ['garage', 'carport']) && Math.max(w, h) < 5.2) notes.push('FAULT: ' + r.name + ' is ' + r1(w) + ' x ' + r1(h) + ' m - too short for a car (3 x 5.5 m)');
    }
    /* how much of the land the rooms account for: a hole in the tiling is
       land nobody planned, and the architect should hear of it */
    const onLand = !!(ctx && ctx.plot);   /* a drawn boundary, not the rooms' own box */
    const landArea = Math.abs(polyArea(build || poly));
    const fullLandArea = Math.abs(polyArea(poly));
    const covered = rooms.reduce((sum, r) => sum + Math.abs(polyArea(r.cell)), 0);
    const indoorArea = rooms.filter(r => !r.outdoor).reduce((sum, r) => sum + Math.abs(polyArea(r.cell)), 0);
    const coverage = landArea > EPS ? Math.min(1, covered / landArea) : 1;
    if (onLand && lay.fill !== false && coverage < 0.97) {
      notes.push((lay.fit === 'inside' ? '' : 'FAULT: ') + 'the layout covers ' + Math.round(coverage * 100) + '% of the ' + (build ? 'buildable area after setbacks' : 'land') + '; ' + r1(Math.max(0,landArea - covered)) + ' mÂ² is left unplanned' + (lay.fit === 'inside' ? ' by the requested rectangular footprint' : '. Fit the rooms to the actual boundary instead of treating the remaining area as requested open ground'));
    }
    if (onLand) notes.push('Indoor footprint: ' + r1(indoorArea) + ' mÂ² of the full ' + r1(fullLandArea) + ' mÂ² site (' + Math.round(indoorArea/fullLandArea*100) + '%).');

    const pieces = buildPieces(rooms, tExt, tInt);

    /* openings */
    const doors = [];
    for (const d of (Array.isArray(lay.doors) ? lay.doors : [])) {
      if (!d || typeof d !== 'object') continue;
      const o = placeDoor(pieces, rooms, d, notes);
      if (o) doors.push(o);
    }
    autoDoors(pieces, rooms, doors, notes);
    garageDoors(pieces, rooms, doors, notes);
    repairCirculation(pieces, rooms, doors, notes);
    const windows = [];
    for (const w of (Array.isArray(lay.windows) ? lay.windows : [])) {
      if (!w || typeof w !== 'object') continue;
      const o = placeWindow(pieces, rooms, w, notes, false);
      if (o) windows.push(o);
    }
    if (lay.windows !== false && lay.autoWindows !== false) autoWindows(pieces, rooms, windows, notes);

    const O = mkOut();

    /* walls: every room's inner faces, the outer faces of the mass */
    let faceSegs = [];
    rooms.forEach((r, ri) => {
      if (r.outdoor) return;
      const runs = roomRuns(r, pieces, tExt);
      for (const s of offsetLoop(runs, 1)) faceSegs.push(s);
    });
    for (const loop of outerLoops(pieces)) {
      const runs = loop.map((e) => ({ a: e.a, b: e.b, d: 0, piece: e.piece }));
      for (const s of offsetLoop(runs, -1)) faceSegs.push(s);
    }
    faceSegs = cutOpenings(faceSegs, pieces);
    for (const ch of chain(faceSegs)) O.pline(ch.pts, ch.closed, LAYERS.wall);
    drawOpenings(O, pieces, rooms);
    /* edges between two outdoor spaces: a single line */
    for (const p of pieces) if (p.cls === 'edge') O.line(p.a, p.b, LAYERS.site);

    /* stairs */
    let stairs = 0;
    const stairSpecs = Array.isArray(lay.stairs) ? lay.stairs.filter((s) => s && typeof s === 'object') : [];
    const stairRooms = new Set();
    for (const s of stairSpecs) {
      const ri = rooms.findIndex((r) => r.id === String(s.room || '').trim().toLowerCase().replace(/\s+/g, '-'));
      if (ri < 0) { notes.push('stairs were asked for in "' + s.room + '", which is not a room'); continue; }
      if (drawStairs(O, rooms[ri], ri, pieces, tExt, s, notes)) { stairs++; stairRooms.add(ri); }
    }
    rooms.forEach((r, ri) => {
      if (stairRooms.has(ri) || r.outdoor || !kindHas(r.kind, ['stair'])) return;
      if (drawStairs(O, r, ri, pieces, tExt, {}, notes)) { stairs++; stairRooms.add(ri); }
    });

    /* furniture and labels; a room that got none is named, so the reply can
       only claim what was drawn */
    const unfurnished = [];
    if (lay.furniture !== false) rooms.forEach((r, ri) => {
      if (r.outdoor || stairRooms.has(ri)) return;
      const start = O.ents.length;
      if (furnish(O, r, ri, pieces, tExt) === false) unfurnished.push(r.name);
      for (const e of O.ents.slice(start)) e.aiFurniture = {roomId:r.id,roomKind:r.kind};
    });
    if (lay.labels !== false) rooms.forEach((r) => label(O, r));

    /* the notes the agent must not miss come first, and again by name */
    notes.sort((a, b) => (/^FAULT/.test(b) ? 1 : 0) - (/^FAULT/.test(a) ? 1 : 0));
    const faults = notes.filter((n) => /^FAULT/.test(n)).map((n) => n.replace(/^FAULT:\s*/, ''));
    const stats = {
      rooms: rooms.filter((r) => !r.outdoor).length, outdoor: rooms.filter((r) => r.outdoor).length,
      doors: doors.length, windows: windows.length, stairs, entities: O.ents.length,
      landArea: onLand ? r1(landArea) : null, coverage: onLand ? Math.round(coverage * 1000) / 1000 : null, fitted,
      siteArea: onLand ? r1(fullLandArea) : null, siteCoverage: onLand ? Math.round(indoorArea / fullLandArea * 1000) / 1000 : null,
      setback: build ? { W: r1(buildBox.maxx - buildBox.minx), H: r1(buildBox.maxy - buildBox.miny) } : null, unfurnished: unfurnished.length, faults: faults.length
    };
    return {
      ok: true, entities: O.ents, stats, notes, faults, unfurnished,
      // Wall material strips, excluding every door/window opening. Kept as
      // metadata for native SOLID hatches; outline chains alone can be open.
      wallFills: pieces.filter(p => p.t > EPS && p.cls !== 'edge').flatMap(p => {
        let spans = [[0,p.len]];
        for (const o of p.openings) spans = spans.flatMap(([a,b]) => [[a,Math.min(b,o.s0)],[Math.max(a,o.s1),b]].filter(([lo,hi]) => hi-lo>EPS));
        return spans.map(([a,b]) => {
          const at=(t,d)=>add(p.a,add(mul(p.u,t),mul(p.n,p.c+d)));
          let q=[at(a,-p.t/2),at(b,-p.t/2),at(b,p.t/2),at(a,p.t/2)];
          // The source plot is convex in the contained-layout path. Clip
          // corner wedges to its true boundary, never spill over the survey.
          const convex=poly.every((x,i)=>cross(sub(poly[(i+1)%poly.length],x),sub(poly[(i+2)%poly.length],poly[(i+1)%poly.length]))>=-EPS);
          if(convex) for(let i=0;i<poly.length;i++) {const x=poly[i],v=sub(poly[(i+1)%poly.length],x);
            q=clipHalf(q,z=>cross(v,sub(z,x))>=-EPS,(a,b)=>{const da=cross(v,sub(a,x)),db=cross(v,sub(b,x));return lerp(a,b,da/(da-db));});
          }
          return q;
        }).filter(q=>q.length>=3);
      }),
      connections: doors.map((d,i) => ({id:'door'+(i+1),from:rooms[d.from]?.outdoor?'outside':rooms[d.from]?.id || 'outside',to:d.to<0||rooms[d.to]?.outdoor?'outside':rooms[d.to].id,width:r3(d.w),vehicleOnly:d.kind==='garage'})),
      rooms: rooms.map((r) => ({ id: r.id, name: r.name, kind: r.kind, outdoor: r.outdoor, points: r.cell.map(p => ({x:p.x,y:p.y})), area: Math.round(r.area * 10) / 10 })),
      extent: { W, H }, origin: plot.origin || null
    };
  };

  /* ================================================================== *
   * place(entities, xf): frame metres -> world drawing units
   *   xf = {scale (units per metre), ox, oy (the frame origin, in turned
   *         units), theta, cx, cy (the turn back to the world)}
   * ================================================================== */
  const place = (entities, xf) => {
    const sc = xf.scale, th = xf.theta || 0;
    const cs = Math.cos(th), sn = Math.sin(th);
    const cx = xf.cx || 0, cy = xf.cy || 0;
    const M = (p) => {
      const qx = xf.ox + p.x * sc, qy = xf.oy + p.y * sc;
      return { x: cx + (qx - cx) * cs - (qy - cy) * sn, y: cy + (qx - cx) * sn + (qy - cy) * cs };
    };
    const out = [];
    for (const e of entities) {
      switch (e.type) {
        case 'line': out.push({ type: 'line', a: M(e.a), b: M(e.b), layer: e.layer }); break;
        case 'polyline': out.push({ type: 'polyline', closed: !!e.closed, layer: e.layer,
          pts: e.pts.map((p) => (p.b ? Object.assign(M(p), { b: p.b }) : M(p))) }); break;
        case 'arc': out.push({ type: 'arc', c: M(e.c), r: e.r * sc, a0: e.a0 + th, a1: e.a1 + th, layer: e.layer }); break;
        case 'circle': out.push({ type: 'circle', c: M(e.c), r: e.r * sc, layer: e.layer }); break;
        case 'text': out.push({ type: 'text', p: M(e.p), str: e.str, h: e.h * sc, rot: (e.rot || 0) + th, ha: 4, layer: e.layer }); break;
        default: break;
      }
      if (e.aiFurniture && out.length) out[out.length-1].aiFurniture = {...e.aiFurniture};
    }
    return out;
  };

  /* the bounding box of placed entities (arcs by their circle: enough) */
  const extent = (entities) => {
    const b = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
    const take = (p) => { if (p.x < b.minx) b.minx = p.x; if (p.y < b.miny) b.miny = p.y; if (p.x > b.maxx) b.maxx = p.x; if (p.y > b.maxy) b.maxy = p.y; };
    for (const e of entities) {
      if (e.type === 'line') { take(e.a); take(e.b); }
      else if (e.type === 'polyline') e.pts.forEach(take);
      else if (e.type === 'arc' || e.type === 'circle') { take({ x: e.c.x - e.r, y: e.c.y - e.r }); take({ x: e.c.x + e.r, y: e.c.y + e.r }); }
      else if (e.type === 'text') take(e.p);
    }
    return isFinite(b.minx) ? b : null;
  };

  /* strokes for the card's preview: every entity as a polyline of points */
  const strokes = (entities) => {
    const out = [];
    for (const e of entities) {
      if (e.type === 'line') out.push([e.a, e.b]);
      else if (e.type === 'polyline') { const pts = e.pts.slice(); if (e.closed) pts.push(e.pts[0]); out.push(pts); }
      else if (e.type === 'arc' || e.type === 'circle') {
        const a0 = e.type === 'arc' ? e.a0 : 0, a1 = e.type === 'arc' ? e.a1 : 2 * Math.PI;
        const sweep = e.type === 'arc' ? ((a1 - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI : 2 * Math.PI;
        const n = Math.max(6, Math.ceil(sweep / (Math.PI / 12)));
        const pts = [];
        for (let i = 0; i <= n; i++) { const a = a0 + sweep * i / n; pts.push({ x: e.c.x + e.r * Math.cos(a), y: e.c.y + e.r * Math.sin(a) }); }
        out.push(pts);
      }
    }
    return out;
  };

  /* a one-paragraph reading of the layout, for the card */
  const describe = (layout) => {
    const rooms = Array.isArray(layout && layout.rooms) ? layout.rooms : [];
    const parts = rooms.filter((r) => r && typeof r === 'object').map((r) =>
      String(r.name || r.kind || r.id || 'room') + ' ' + r3(Number(r.w) || 0) + ' Ã— ' + r3(Number(r.h) || 0) + ' m');
    const d = Array.isArray(layout && layout.doors) ? layout.doors.length : 0;
    const w = Array.isArray(layout && layout.windows) ? layout.windows.length : 0;
    return parts.join('; ') + (d ? '; ' + d + ' door' + (d === 1 ? '' : 's') + ' named' : '') + (w ? '; ' + w + ' window' + (w === 1 ? '' : 's') + ' named' : '');
  };

  /* ================================================================== *
   * findLoops(entities, box, opts) -> [{pts, area, bbox, ids, sides}]
   *
   * THE LAND, HOWEVER IT WAS DRAWN. A plot reaches a drawing as a closed
   * polyline, as an open one whose ends meet, as four LINEs, as lines and
   * arcs meeting end to end, as a circle - and an architect who drew it
   * with the Line tool has drawn the land just as surely as one who typed
   * C to close. So every entity is flattened to points (bulges and arcs
   * sampled), open pieces are welded by coincident endpoints, a piece
   * drawn twice is one piece, dangling pieces are pruned, and each
   * connected bundle is walked round its OUTER face with the interior on
   * the left - so a boundary with a setback line or a partition touching
   * it still reads as the boundary, and two plots sharing a corner come
   * out as two rings.
   *
   * box (optional): only what lies inside it counts, with opts.margin of
   * the box's size as slack for a sloppy drag (default 0.02). Selections
   * (aisel hatches), text, dimensions and blocks never count. Largest
   * first, by the polygon's own area.
   * ================================================================== */
  const TWO_PI = 2 * Math.PI;
  const flattenBulge = (p, q, b, out) => {
    /* the points strictly between p and q along the bulge arc */
    const chord = dist(p, q);
    if (!(Math.abs(b) > 1e-9) || chord < 1e-12) return;
    const theta = 4 * Math.atan(Math.abs(b));
    const m = lerp(p, q, 0.5), u = unit(sub(q, p)), n = left(u);
    const d = chord * (1 - b * b) / (4 * b);
    const c = add(m, mul(n, d));
    const r = Math.hypot(chord / 2, d);
    const a0 = Math.atan2(p.y - c.y, p.x - c.x);
    const dir = b > 0 ? 1 : -1;
    const steps = Math.max(2, Math.ceil(theta / (Math.PI / 24)));
    for (let i = 1; i < steps; i++) {
      const a = a0 + dir * theta * i / steps;
      out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
    }
  };
  const flattenPline = (e) => {
    const src = e.pts.filter((p) => p && num(p.x) && num(p.y));
    const out = [];
    const nseg = e.closed ? src.length : src.length - 1;
    for (let i = 0; i < nseg; i++) {
      const p = src[i], q = src[(i + 1) % src.length];
      out.push({ x: p.x, y: p.y });
      if (num(p.b)) flattenBulge(p, q, p.b, out);
    }
    if (!e.closed && src.length) out.push({ x: src[src.length - 1].x, y: src[src.length - 1].y });
    return out;
  };
  /* the engine's rule: a whole turn is a0 -> a0 +- 2pi; two EQUAL angles are
     a zero-length arc, which draws nothing and so closes nothing */
  const sampleArc = (c, r, a0, a1, full) => {
    const raw = a1 - a0;
    const sweep = full || Math.abs(raw) >= TWO_PI - 1e-9 ? TWO_PI
      : Math.abs(raw) < 1e-9 ? 0 : (((raw % TWO_PI) + TWO_PI) % TWO_PI);
    if (!(sweep > 0)) return null;
    const n = Math.max(4, Math.ceil(sweep / (Math.PI / 24)));
    const out = [];
    for (let i = 0; i <= (full ? n - 1 : n); i++) { const a = a0 + sweep * i / n; out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }); }
    return out;
  };
  const norm2pi = (a) => ((a % TWO_PI) + TWO_PI) % TWO_PI;

  /* weld one bundle of open pieces at `tol`, walk every component round its
     outer face, and push the rings found; a component much smaller than the
     whole is re-welded at its own tolerance (a kilometre of road elsewhere
     in the box must not fuse a plot's two-metre gate recess) */
  const solveRings = (open, tol, depth, rings) => {
    if (!open.length) return;
    const nodes = [];
    const grid = new Map();            /* tol-sized cells -> node indices */
    const cellOf = (v) => Math.floor(v / tol);
    const nodeOf = (p) => {
      const cx = cellOf(p.x), cy = cellOf(p.y);
      let hit = -1;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const cell = grid.get((cx + dx) + ',' + (cy + dy));
        if (!cell) continue;
        for (const i of cell) if ((hit < 0 || i < hit) && dist(nodes[i].p, p) <= tol) hit = i;
      }
      if (hit >= 0) return hit;
      nodes.push({ p: { x: p.x, y: p.y }, edges: [] });
      const k = cx + ',' + cy;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(nodes.length - 1);
      return nodes.length - 1;
    };
    const edges = open.map((c, i) => ({ i, pts: c.pts, ids: c.ids.slice(), u: nodeOf(c.pts[0]), v: nodeOf(c.pts[c.pts.length - 1]), dead: false }));
    for (const e of edges) { if (e.u === e.v) { e.dead = true; continue; } nodes[e.u].edges.push(e); nodes[e.v].edges.push(e); }
    /* the same edge drawn twice - a line over a line, a neighbour's plot
       line on the shared boundary, one redrawn within tolerance - is one
       edge; two edges between the same nodes with different geometry (an
       arc and its chord) are a lens and both stay */
    const onEdge = (p, e) => { for (let i = 0; i < e.pts.length - 1; i++) if (distToSeg(p, e.pts[i], e.pts[i + 1]) <= tol) return true; return false; };
    for (const nd of nodes) {
      const live = nd.edges.filter((e) => !e.dead);
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        if (a.dead || b.dead) continue;
        if (!((a.u === b.u && a.v === b.v) || (a.u === b.v && a.v === b.u))) continue;
        if (a.pts.every((p) => onEdge(p, b)) && b.pts.every((p) => onEdge(p, a))) { b.dead = true; for (const id of b.ids) a.ids.push(id); }
      }
    }
    /* prune dangling pieces until every remaining node has two or more */
    const deg = nodes.map((nd) => nd.edges.filter((e) => !e.dead).length);
    const q = [];
    for (let i = 0; i < nodes.length; i++) if (deg[i] === 1) q.push(i);
    while (q.length) {
      const i = q.pop();
      if (deg[i] !== 1) continue;
      const e = nodes[i].edges.find((x) => !x.dead);
      if (!e) { deg[i] = 0; continue; }
      e.dead = true; deg[i] = 0;
      const j = e.u === i ? e.v : e.u;
      deg[j]--;
      if (deg[j] === 1) q.push(j);
    }
    /* components */
    const comp = new Array(nodes.length).fill(-1);
    let nc = 0;
    for (let i = 0; i < nodes.length; i++) {
      if (comp[i] >= 0 || deg[i] <= 0) continue;
      const stack = [i]; comp[i] = nc;
      while (stack.length) {
        const k = stack.pop();
        for (const e of nodes[k].edges) { if (e.dead) continue; const j = e.u === k ? e.v : e.u; if (comp[j] < 0) { comp[j] = nc; stack.push(j); } }
      }
      nc++;
    }
    const dirOut = (e, from) => {
      const pts = e.u === from ? e.pts : e.pts.slice().reverse();
      return Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
    };
    for (let c = 0; c < nc; c++) {
      const live = edges.filter((e) => !e.dead && comp[e.u] === c);
      if (!live.length) continue;
      const cpts = [];
      for (const e of live) for (const p of e.pts) cpts.push(p);
      const cb = bboxOf(cpts);
      const ctol = Math.max(1e-9, Math.hypot(cb.maxx - cb.minx, cb.maxy - cb.miny) * 0.003);
      if (ctol < tol * 0.999 && depth < 2) {
        solveRings(open.filter((ch, i) => comp[edges[i].u] === c || comp[edges[i].v] === c), ctol, depth + 1, rings);
        continue;
      }
      /* the lowest-leftmost POINT of the component, edge interiors included:
         an arc's belly or a polyline's inner vertex can lie below every node,
         and only a point on the hull is surely on the outer face. Leave it
         travelling towards +x - the way a ring with its interior on the left
         passes its lowest point. */
      let sp = null, sEdge = null, sIdx = -1;
      for (const e of live) for (let k = 0; k < e.pts.length; k++) {
        const p = e.pts[k];
        if (!sp || p.y < sp.y - 1e-12 || (Math.abs(p.y - sp.y) <= 1e-12 && p.x < sp.x)) { sp = p; sEdge = e; sIdx = k; }
      }
      let start, forced = null;
      if (sIdx === 0) start = sEdge.u;
      else if (sIdx === sEdge.pts.length - 1) start = sEdge.v;
      else {
        const prev = sEdge.pts[sIdx - 1], next = sEdge.pts[sIdx + 1];
        start = next.x - prev.x >= 0 ? sEdge.u : sEdge.v;
        forced = sEdge;
      }
      const cand = nodes[start].edges.filter((e) => !e.dead);
      if (!cand.length) continue;
      let first = forced;
      if (!first) { let best = Infinity; for (const e of cand) { const a = norm2pi(dirOut(e, start)); if (a < best) { best = a; first = e; } } }
      /* the walk: interior on the left, so at every node the most clockwise
         way on; straight back along a coincident edge is the last resort */
      const out = [];                  /* {p, node, e} */
      let at = start, e = first, steps = 0;
      const maxSteps = live.length * 2 + 2;
      let closed = false;
      for (;;) {
        const pts = e.u === at ? e.pts : e.pts.slice().reverse();
        for (let i = 0; i < pts.length - 1; i++) out.push({ p: pts[i], node: i === 0 ? at : -1, e });
        const next = e.u === at ? e.v : e.u;
        const inDir = Math.atan2(pts[pts.length - 1].y - pts[pts.length - 2].y, pts[pts.length - 1].x - pts[pts.length - 2].x);
        let pick = null, pickTurn = Infinity;
        for (const x of nodes[next].edges) {
          if (x.dead || x === e) continue;
          let turn = dirOut(x, next) - inDir;
          turn = ((turn % TWO_PI) + 3 * Math.PI) % TWO_PI - Math.PI;   /* (-pi, pi] */
          if (turn <= -Math.PI + 1e-3) turn += TWO_PI;
          if (turn < pickTurn) { pickTurn = turn; pick = x; }
        }
        if (!pick) pick = e;
        at = next; e = pick;
        if (at === start && e === first) { closed = true; break; }
        if (++steps > maxSteps) break;
      }
      if (!closed || out.length < 3) continue;
      /* a walk through a shared corner visits it twice: split there, so each
         lobe is a simple ring of its own */
      const lobes = [];
      const stack = [], stackNode = [];
      for (const o of out) {
        if (o.node >= 0) {
          const k = stackNode.indexOf(o.node);
          if (k >= 0) { lobes.push(stack.splice(k)); stackNode.splice(k); }
        }
        stack.push(o); stackNode.push(o.node);
      }
      lobes.push(stack);
      for (const lobe of lobes) {
        if (lobe.length < 3) continue;
        const ids = [];
        for (const o of lobe) for (const id of o.e.ids) if (id != null && ids.indexOf(id) < 0) ids.push(id);
        rings.push({ pts: lobe.map((o) => o.p), ids });
      }
    }
  };

  const findLoops = (entities, box, opts) => {
    const o = opts || {};
    const list = Array.isArray(entities) ? entities : [];
    let inside = () => true;
    if (box && num(box.minx) && num(box.maxx) && num(box.miny) && num(box.maxy)) {
      const mg = (o.margin == null ? 0.02 : o.margin);
      const mx = (box.maxx - box.minx) * mg, my = (box.maxy - box.miny) * mg;
      const g = { minx: box.minx - mx, miny: box.miny - my, maxx: box.maxx + mx, maxy: box.maxy + my };
      inside = (pts) => pts.every((p) => p.x >= g.minx && p.x <= g.maxx && p.y >= g.miny && p.y <= g.maxy);
    }
    const rings = [];     /* closed on their own: {pts, ids} */
    const chains = [];    /* open pieces: {pts, ids} */
    for (const e of list) {
      if (!e || typeof e !== 'object' || typeof e.aisel === 'number') continue;
      let pts = null, closed = false;
      if ((e.type === 'polyline' || e.type === 'rectangle') && Array.isArray(e.pts) && e.pts.length >= 2) {
        pts = flattenPline(e); closed = !!e.closed;
      } else if (e.type === 'line' && e.a && e.b && num(e.a.x) && num(e.a.y) && num(e.b.x) && num(e.b.y)) {
        pts = [{ x: e.a.x, y: e.a.y }, { x: e.b.x, y: e.b.y }];
      } else if (e.type === 'arc' && e.c && num(e.c.x) && num(e.c.y) && num(e.r) && e.r > 0 && num(e.a0) && num(e.a1)) {
        pts = sampleArc(e.c, e.r, e.a0, e.a1, false);
      } else if (e.type === 'circle' && e.c && num(e.c.x) && num(e.c.y) && num(e.r) && e.r > 0) {
        pts = sampleArc(e.c, e.r, 0, 0, true); closed = true;
      } else continue;
      if (!pts || pts.length < 2 || !inside(pts)) continue;
      if (closed) { if (pts.length >= 3) rings.push({ pts, ids: [e.id] }); continue; }
      chains.push({ pts, ids: [e.id] });
    }
    /* the scale of things, for "the same point" */
    const all = [];
    for (const c of chains) for (const p of c.pts) all.push(p);
    for (const r of rings) for (const p of r.pts) all.push(p);
    let tol = num(o.tol) ? o.tol : 0;
    if (!(tol > 0)) {
      const b = all.length ? bboxOf(all) : null;
      const diag = b ? Math.hypot(b.maxx - b.minx, b.maxy - b.miny) : 0;
      tol = Math.max(1e-9, diag * 0.003);
    }
    /* an open piece whose own ends meet is a ring */
    const open = [];
    for (const c of chains) {
      if (c.pts.length >= 3 && dist(c.pts[0], c.pts[c.pts.length - 1]) <= tol) rings.push({ pts: c.pts.slice(0, -1), ids: c.ids });
      else open.push(c);
    }
    solveRings(open, tol, 0, rings);
    /* size them up */
    const out = [];
    for (const r of rings) {
      const pts = dedupe(r.pts);
      if (pts.length < 3) continue;
      const area = Math.abs(polyArea(pts));
      const bb = bboxOf(pts);
      const size = Math.max(bb.maxx - bb.minx, bb.maxy - bb.miny);
      if (!(area > 1e-6 * size * size)) continue;
      const sides = simplifyPoly(pts).length;
      out.push({ pts: ccw(pts), area, bbox: bb, ids: r.ids.filter((v, i, a) => v != null && a.indexOf(v) === i), sides });
    }
    out.sort((a, b) => b.area - a.area);
    /* the same ring found twice (a closed polyline drawn over its lines) */
    const uniq = [];
    for (const r of out) {
      const dup = uniq.some((u) => Math.abs(u.area - r.area) <= 1e-6 * Math.max(u.area, 1) && dist({ x: u.bbox.minx, y: u.bbox.miny }, { x: r.bbox.minx, y: r.bbox.miny }) <= tol && dist({ x: u.bbox.maxx, y: u.bbox.maxy }, { x: r.bbox.maxx, y: r.bbox.maxy }) <= tol);
      if (!dup) uniq.push(r);
    }
    return uniq;
  };

  /* Clip each straight segment, including a segment crossing a concave
     notch with both endpoints inside. Preserve separate runs: joining
     them across an exterior gap would redraw the overrun. */
  const clipStrokes = (strokes, polygon) => {
    if (!Array.isArray(polygon) || polygon.length < 3 || polygon.some(p => !p || !num(p.x) || !num(p.y))) return [];
    const bounds = bboxOf(polygon), tolerance = Math.max(bounds.maxx-bounds.minx,bounds.maxy-bounds.miny,1)*1e-9;
    const cross2=(a,b)=>a.x*b.y-a.y*b.x, delta=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
    const onEdge = p => polygon.some((a,i) => {const b=polygon[(i+1)%polygon.length],v=delta(b,a),q=delta(p,a),l=Math.hypot(v.x,v.y);
      return l>tolerance && Math.abs(cross2(v,q))<=tolerance*l && q.x*v.x+q.y*v.y>=-tolerance*l && q.x*v.x+q.y*v.y<=l*l+tolerance*l;});
    const inside=p=>onEdge(p)||pointInPoly(polygon,p);
    const output=[];
    for (const stroke of strokes || []) {
      let run=[];
      const flush=()=>{if(run.length>1)output.push(run);run=[];};
      for(let i=1;i<stroke.length;i++) {
        const a=stroke[i-1],b=stroke[i];
        if(!a||!b||![a.x,a.y,b.x,b.y].every(num)){flush();continue;}
        const v=delta(b,a),len=Math.hypot(v.x,v.y);if(len<=tolerance)continue;
        const ts=[0,1];
        for(let j=0;j<polygon.length;j++){
          const c=polygon[j],d=polygon[(j+1)%polygon.length],w=delta(d,c),q=delta(c,a),den=cross2(v,w);
          if(Math.abs(den)<=tolerance*Math.max(len,Math.hypot(w.x,w.y))) {
            if(Math.abs(cross2(v,q))<=tolerance*len)for(const p of [c,d]){const t=((p.x-a.x)*v.x+(p.y-a.y)*v.y)/(len*len);if(t>0&&t<1)ts.push(t);}
          } else {const t=cross2(q,w)/den,u=cross2(q,v)/den;if(t>0&&t<1&&u>=-1e-9&&u<=1+1e-9)ts.push(t);}
        }
        ts.sort((a,b)=>a-b);const at=t=>({x:a.x+v.x*t,y:a.y+v.y*t});
        for(let j=1;j<ts.length;j++){
          if((ts[j]-ts[j-1])*len<=tolerance)continue;
          if(!inside(at((ts[j]+ts[j-1])/2))){flush();continue;}
          const start=at(ts[j-1]),end=at(ts[j]);
          if(run.length&&Math.hypot(run.at(-1).x-start.x,run.at(-1).y-start.y)>tolerance)flush();
          if(!run.length)run.push(start);run.push(end);
        }
      }
      flush();
    }
    return output;
  };
  const planningEnvelope = (pts, setback) => { const sb=readSetback(setback), poly=sb?insetPoly(ccw(pts),sb):ccw(pts); return poly ? containedBox(poly) : null; };
  const buildablePolygon = (pts,setback) => {const sb=readSetback(setback);return sb?insetPoly(ccw(pts),sb):ccw(pts);};
  const API = { compile, place, extent, strokes, describe, findLoops, planningEnvelope, buildablePolygon, clipStrokes, wallTopology:buildPieces, LAYERS, LAYER_COLORS,
    _test: { clipRect, simplifyPoly, pointInPoly, polyArea, centroid, buildPieces, chain, offsetLoop, resolveOverlaps, readRooms, rawBox, flattenPline } };
  root.NasjPlan = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
