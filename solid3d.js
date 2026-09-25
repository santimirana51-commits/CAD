/* pixelbay CAD — solid3d.js
 * THE BODY MODEL, on descriptive-geometry lines. A solid is nothing but its
 * planar faces; a face is a plane — a ring of points and the normal that
 * stands outward from the body — with, when the face is pierced, the rings
 * of its holes. Every 3D entity the renderer shades answers through ONE
 * function, facesOf, whatever it is made of:
 *
 *   box      the axis-aligned volume it always was, as six faces
 *   solid    a polyhedral body: faces stored outright (a DWG's 3DSOLID, a
 *            MESH, an EXTRUDEd outline), plus the wires of any face the
 *            reader could not flatten — a tube's rulings stay lines
 *   wall     BIM: a run of points with a thickness and a height, mitred at
 *            its corners and pierced by its doors and windows
 *   slab     BIM: a closed outline with a thickness
 *   face3d   one facet on its own
 *
 * The plan view draws a body's horizontal projection — its footprint and
 * the symbols of its openings — and the 3D view its faces. Both are pure
 * geometry: nothing here reads the camera or the canvas.
 */
(() => {
  'use strict';
  const N = window.Nasj = window.Nasj || {};
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const zOf = (p) => (p && isNum(p.z)) ? p.z : 0;
  const P3 = (x, y, z) => ({ x, y, z });

  /* the normal of a planar ring (Newell), unit length, or null when flat */
  const newell = (pts) => {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const az = zOf(a), bz = zOf(b);
      nx += (a.y - b.y) * (az + bz);
      ny += (az - bz) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
    }
    const l = Math.hypot(nx, ny, nz);
    return l > 1e-12 ? [nx / l, ny / l, nz / l] : null;
  };
  /* the signed area of an xy ring: positive when it runs counter-clockwise */
  const area2 = (pts) => {
    let s = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
  };
  const ccw = (pts) => area2(pts) < 0 ? pts.slice().reverse() : pts.slice();
  const cw = (pts) => area2(pts) > 0 ? pts.slice().reverse() : pts.slice();

  /* a face whose ring is turned so its normal agrees with `want` */
  const face = (pts, want, holes) => {
    let n = newell(pts);
    if (!n) return null;
    if (want && n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) {
      pts = pts.slice().reverse();
      // A hole must keep the opposite winding to its face. In particular,
      // the bottom cap of an extrusion reverses both perimeter and holes.
      if (holes) holes = holes.map((ring) => ring.slice().reverse());
      n = [-n[0], -n[1], -n[2]];
    }
    const f = { pts, n };
    if (holes && holes.length) f.holes = holes;
    return f;
  };

  /* EXTRUSION: an xy ring (with optional hole rings) swept from z0 up by h.
     The outer ring runs counter-clockwise and the holes clockwise, so the
     same rule — the side of an edge aâ†’b faces (dy, âˆ’dx) — points out of the
     body on both. */
  const extrude = (ring, z0, h, holes) => {
    const out = [];
    if (!ring || ring.length < 3 || !(h > 0)) return out;
    const z1 = z0 + h;
    const O = ccw(ring);
    const H = (holes || []).filter((r) => r && r.length >= 3).map(cw);
    const lift = (r, z) => r.map((p) => P3(p.x, p.y, z));
    out.push(face(lift(O, z1), [0, 0, 1], H.map((r) => lift(r, z1))));
    out.push(face(lift(O, z0), [0, 0, -1], H.map((r) => lift(r, z0))));
    for (const r of [O].concat(H)) {
      for (let i = 0, n = r.length; i < n; i++) {
        const a = r[i], b = r[(i + 1) % n];
        const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.hypot(dx, dy) < 1e-12) continue;
        out.push(face([P3(a.x, a.y, z0), P3(b.x, b.y, z0), P3(b.x, b.y, z1), P3(a.x, a.y, z1)], [dy, -dx, 0]));
      }
    }
    return out.filter(Boolean);
  };

  /* ---------------- walls ----------------
   * The run p0..pn is the wall's centre line. Each side is the run offset
   * by half the thickness; consecutive sides meet where their lines cross
   * — the mitre — and an open run is capped square at both ends. */
  const wallSides = (ent) => {
    const pts = ent.pts, n = pts.length, t = ent.t / 2;
    const closed = !!ent.closed && n >= 3;
    const segs = closed ? n : n - 1;
    const dir = [];
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      dir.push({ x: (b.x - a.x) / l, y: (b.y - a.y) / l, l });
    }
    /* the corner a side turns at: the crossing of the two offset lines, or
       the plain offset point where the run is straight or the mitre would
       run away (a hairpin) */
    const corner = (i, side) => {
      const p = pts[i];
      const dIn = closed ? dir[(i - 1 + segs) % segs] : (i > 0 ? dir[i - 1] : null);
      const dOut = closed ? dir[i % segs] : (i < segs ? dir[i] : null);
      const d = dOut || dIn;
      const nrm = { x: -d.y * side * t, y: d.x * side * t };
      if (!dIn || !dOut) return { x: p.x + nrm.x, y: p.y + nrm.y };
      /* where the two offset lines cross: the sum of the two side normals,
         scaled back so the corner stands t off both sides */
      const nIx = -dIn.y, nIy = dIn.x, nOx = -dOut.y, nOy = dOut.x;
      const den = 1 + nIx * nOx + nIy * nOy;
      if (den < 1e-6) return { x: p.x + nrm.x, y: p.y + nrm.y };   /* a hairpin */
      const k = side * t / den;
      const mx = (nIx + nOx) * k, my = (nIy + nOy) * k;
      if (Math.hypot(mx, my) > 3 * t) return { x: p.x + nrm.x, y: p.y + nrm.y };
      return { x: p.x + mx, y: p.y + my };
    };
    const L = [], R = [];
    for (let i = 0; i < n; i++) { L.push(corner(i, 1)); R.push(corner(i, -1)); }
    return { L, R, dir, closed, segs };
  };
  /* the plan outline: one ring round an open run, outer + inner for a closed one */
  const wallRings = (ent) => {
    const s = wallSides(ent);
    if (s.closed) {
      const outer = area2(s.L) > area2(s.R) ? s.L : s.R;
      const inner = outer === s.L ? s.R : s.L;
      return { ring: outer, holes: [inner] };
    }
    return { ring: s.L.concat(s.R.slice().reverse()), holes: [] };
  };
  /* the openings of a wall as rectangles on its sides: the four corners on
     the left side, the four on the right, the run direction and the jambs */
  const wallOpenings = (ent) => {
    const out = [];
    if (!Array.isArray(ent.openings) || !ent.openings.length) return out;
    const s = wallSides(ent);
    const z0 = zOf(ent), t = ent.t / 2;
    for (const o of ent.openings) {
      const i = o.seg | 0;
      if (i < 0 || i >= s.segs) continue;
      const d = s.dir[i], p = ent.pts[i];
      const s0 = Math.max(0, Math.min(o.s, d.l)), s1 = Math.max(s0, Math.min(o.s + o.w, d.l));
      if (s1 - s0 < 1e-9) continue;
      const zl = z0 + (o.z0 || 0), zh = Math.min(zl + o.h, z0 + ent.h);
      if (zh - zl < 1e-9) continue;
      const at = (dist, side) => ({ x: p.x + d.x * dist - d.y * side * t, y: p.y + d.y * dist + d.x * side * t });
      out.push({ o, i, d, zl, zh, s0, s1,
        L0: at(s0, 1), L1: at(s1, 1), R0: at(s0, -1), R1: at(s1, -1) });
    }
    return out;
  };
  const wallFaces = (ent) => {
    const { ring, holes } = wallRings(ent);
    const z0 = zOf(ent), h = ent.h;
    const faces = extrude(ring, z0, h, holes);
    const ops = wallOpenings(ent);
    if (!ops.length) return faces;
    /* a side face is the one standing on the segment's offset edge; the
       opening's hole is cut into it and the reveals span the thickness */
    const lift = (q, z) => P3(q.x, q.y, z);
    const onSide = (f, q0, q1) => {
      if (f.n[2] !== 0 || f.pts.length !== 4) return false;
      const a = f.pts[0], b = f.pts[1];
      const ux = b.x - a.x, uy = b.y - a.y, l2 = ux * ux + uy * uy;
      if (l2 < 1e-18) return false;
      const off = (q) => Math.abs((q.x - a.x) * uy - (q.y - a.y) * ux) / Math.sqrt(l2);
      return off(q0) < 1e-6 && off(q1) < 1e-6;
    };
    for (const w of ops) {
      for (const f of faces) {
        let q0 = null, q1 = null;
        if (onSide(f, w.L0, w.L1)) { q0 = w.L0; q1 = w.L1; }
        else if (onSide(f, w.R0, w.R1)) { q0 = w.R0; q1 = w.R1; }
        if (!q0) continue;
        (f.holes || (f.holes = [])).push([lift(q0, w.zl), lift(q1, w.zl), lift(q1, w.zh), lift(q0, w.zh)]);
      }
      const d = w.d;
      faces.push(face([lift(w.L0, w.zl), lift(w.R0, w.zl), lift(w.R0, w.zh), lift(w.L0, w.zh)], [d.x, d.y, 0]));
      faces.push(face([lift(w.L1, w.zl), lift(w.R1, w.zl), lift(w.R1, w.zh), lift(w.L1, w.zh)], [-d.x, -d.y, 0]));
      if (w.zh < z0 + h - 1e-9) {
        faces.push(face([lift(w.L0, w.zh), lift(w.R0, w.zh), lift(w.R1, w.zh), lift(w.L1, w.zh)], [0, 0, -1]));
      }
      if (w.zl > z0 + 1e-9) {
        faces.push(face([lift(w.L0, w.zl), lift(w.R0, w.zl), lift(w.R1, w.zl), lift(w.L1, w.zl)], [0, 0, 1]));
      }
    }
    return faces.filter(Boolean);
  };
  /* what a wall draws in plan: its sides broken at the openings, its end
     caps and jambs, and the architectural symbol of each opening — a door
     is its leaf swung open with the arc it sweeps, a window the glass line */
  const wallPlan = (ent) => {
    const s = wallSides(ent);
    const ops = wallOpenings(ent);
    const runs = [];
    const n = ent.pts.length;
    const sideRun = (C, side) => {
      /* the corner chain, cut where an opening lands on each segment */
      for (let i = 0; i < s.segs; i++) {
        const a = C[i], b = C[(i + 1) % n];
        const cuts = ops.filter((w) => w.i === i).sort((p, q) => p.s0 - q.s0);
        let from = a;
        for (const w of cuts) {
          const q0 = side > 0 ? w.L0 : w.R0, q1 = side > 0 ? w.L1 : w.R1;
          runs.push([from, q0]);
          from = q1;
        }
        runs.push([from, b]);
      }
    };
    sideRun(s.L, 1);
    sideRun(s.R, -1);
    if (!s.closed) { runs.push([s.L[0], s.R[0]]); runs.push([s.L[n - 1], s.R[n - 1]]); }
    for (const w of ops) {
      runs.push([w.L0, w.R0]);
      runs.push([w.L1, w.R1]);
      if (w.o.kind === 'door') {
        /* the leaf hangs at the first jamb and stands open square to the
           wall, on the left side; the swing is the quarter circle it sweeps */
        const d = w.d, len = w.s1 - w.s0;
        const hinge = { x: (w.L0.x + w.R0.x) / 2, y: (w.L0.y + w.R0.y) / 2 };
        const tip = { x: hinge.x - d.y * len, y: hinge.y + d.x * len };
        runs.push([hinge, tip]);
        const arc = [];
        for (let k = 0; k <= 12; k++) {
          const a = (Math.PI / 2) * (k / 12);
          const ux = d.x * Math.cos(a) - d.y * Math.sin(a), uy = d.y * Math.cos(a) + d.x * Math.sin(a);
          arc.push({ x: hinge.x + ux * len, y: hinge.y + uy * len });
        }
        runs.push(arc);
      } else {
        const m0 = { x: (w.L0.x + w.R0.x) / 2, y: (w.L0.y + w.R0.y) / 2 };
        const m1 = { x: (w.L1.x + w.R1.x) / 2, y: (w.L1.y + w.R1.y) / 2 };
        runs.push([m0, m1]);
      }
    }
    return runs;
  };

  /* ---------------- the primitives ----------------
     The solids a 3D drawing starts from: a wedge, a cylinder, a cone, a
     sphere, a pyramid (the box is its own entity). Each is a convex body
     of planar faces — a curved surface is cut into facets round its axis
     — so every face ring is turned to face away from the body's centre.
     The seams between the facets of a curved surface are HIDDEN edges
     (solid3d's hid bits), all but every n/4th of them: the industry standard's ISOLINES
     of 4, so a cylinder in a wireframe is its two circles and four lines,
     while its faces shade as a body. */
  const P3c = (p) => P3(p.x, p.y, zOf(p));
  const convexFaces = (rings, c) => rings.map((r) => {
    const pts = r.pts;
    const n = newell(pts);
    if (!n) return null;
    let cx = 0, cy = 0, cz = 0;
    for (const q of pts) { cx += q.x; cy += q.y; cz += q.z; }
    cx /= pts.length; cy /= pts.length; cz /= pts.length;
    const out = n[0] * (cx - c.x) + n[1] * (cy - c.y) + n[2] * (cz - c.z) >= 0;
    const f = { pts: out ? pts : pts.slice().reverse() };
    if (r.hid) f.hid = out ? r.hid : flipHid(r.hid, pts.length);
    if (r.iso) f.iso = out ? r.iso : flipHid(r.iso, pts.length);
    return f;
  }).filter(Boolean);
  /* a reversed ring numbers its edges the other way: the edge from corner
     i to i+1 runs between the new corners nâˆ’2âˆ’i and nâˆ’1âˆ’i */
  const flipHid = (hid, n) => {
    let out = 0;
    for (let i = 0; i < n; i++) if (hid & (1 << i)) out |= 1 << ((2 * n - 2 - i) % n);
    return out;
  };
  const ISO = 4;
  const isoSeam = (i, n) => (n >= ISO) && (i % Math.max(1, Math.round(n / ISO)) === 0);
  const ring = (c, r, z, n, a0) => {
    const out = [];
    for (let i = 0; i < n; i++) { const a = (a0 || 0) + Math.PI * 2 * i / n; out.push(P3(c.x + r * Math.cos(a), c.y + r * Math.sin(a), z)); }
    return out;
  };
  /* WEDGE: a box whose top slopes from full height at the first corner's
     x down to nothing at the far x */
  const wedge = (p, w, d, h) => {
    const x0 = p.x, y0 = p.y, z0 = zOf(p), x1 = x0 + w, y1 = y0 + d, z1 = z0 + h;
    const c = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 };
    return convexFaces([
      { pts: [P3(x0, y0, z0), P3(x1, y0, z0), P3(x1, y1, z0), P3(x0, y1, z0)] },   /* bottom */
      { pts: [P3(x0, y0, z0), P3(x0, y1, z0), P3(x0, y1, z1), P3(x0, y0, z1)] },   /* back wall */
      { pts: [P3(x0, y0, z0), P3(x1, y0, z0), P3(x0, y0, z1)] },                   /* side */
      { pts: [P3(x0, y1, z0), P3(x1, y1, z0), P3(x0, y1, z1)] },                   /* side */
      { pts: [P3(x1, y0, z0), P3(x1, y1, z0), P3(x0, y1, z1), P3(x0, y0, z1)] },   /* the slope */
    ], { x: (x0 * 2 + x1) / 3, y: c.y, z: (z0 * 2 + z1) / 3 });
  };
  /* CYLINDER / CONE: a base circle, a top circle (or an apex), n facets */
  const cylinder = (c, r, h, n, rTop) => {
    const z0 = zOf(c), z1 = z0 + h;
    const cen = { x: c.x, y: c.y, z: (z0 + z1) / 2 };
    const B = ring(c, r, z0, n), rings = [{ pts: B.slice().reverse() }];
    const apex = !(rTop > 0);
    const T = apex ? null : ring(c, rTop, z1, n);
    if (!apex) rings.push({ pts: T });
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (apex) {
        /* edges: chord (0), seam jâ†’apex (1), apexâ†’seam i (2) */
        const hid = (isoSeam(j, n) ? 0 : 2) | (isoSeam(i, n) ? 0 : 4);
        const iso = (isoSeam(j, n) ? 2 : 0) | (isoSeam(i, n) ? 4 : 0);
        rings.push({ pts: [B[i], B[j], P3(c.x, c.y, z1)], hid, iso });
      } else {
        /* edges: bottom chord (0), seam j (1), top chord (2), seam i (3) */
        const hid = (isoSeam(j, n) ? 0 : 2) | (isoSeam(i, n) ? 0 : 8);
        const iso = (isoSeam(j, n) ? 2 : 0) | (isoSeam(i, n) ? 8 : 0);
        rings.push({ pts: [B[i], B[j], T[j], T[i]], hid, iso });
      }
    }
    return convexFaces(rings, cen);
  };
  /* SPHERE: latitude bands of n facets; the meridians and parallels that
     are not isolines are hidden */
  const sphere = (c, r, n) => {
    const cz = zOf(c), m = Math.max(4, Math.round(n / 2));
    const rows = [];
    for (let k = 1; k < m; k++) {
      const ph = -Math.PI / 2 + Math.PI * k / m;
      rows.push(ring(c, r * Math.cos(ph), cz + r * Math.sin(ph), n));
    }
    const S = P3(c.x, c.y, cz - r), N0 = P3(c.x, c.y, cz + r);
    const rings = [];
    const par = (k) => isoSeam(k, m);        /* a parallel that shows */
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const mi = isoSeam(i, n), mj = isoSeam(j, n);
      /* bottom cap triangles: S, r0[j], r0[i] — edges Sâ†’r0[j] (meridian j), chord (parallel 1), r0[i]â†’S (meridian i) */
      rings.push({ pts: [S, rows[0][j], rows[0][i]], hid: (mj ? 0 : 1) | (par(1) ? 0 : 2) | (mi ? 0 : 4),
        iso: (mj ? 1 : 0) | (par(1) ? 2 : 0) | (mi ? 4 : 0) });
      for (let k = 0; k + 1 < rows.length; k++) {
        /* band quad: r_k[i], r_k[j], r_k+1[j], r_k+1[i] — chord k+1 (0), meridian j (1), chord k+2 (2), meridian i (3) */
        rings.push({ pts: [rows[k][i], rows[k][j], rows[k + 1][j], rows[k + 1][i]],
          hid: (par(k + 1) ? 0 : 1) | (mj ? 0 : 2) | (par(k + 2) ? 0 : 4) | (mi ? 0 : 8),
          iso: (par(k + 1) ? 1 : 0) | (mj ? 2 : 0) | (par(k + 2) ? 4 : 0) | (mi ? 8 : 0) });
      }
      const top = rows[rows.length - 1];
      rings.push({ pts: [top[i], top[j], N0], hid: (par(m - 1) ? 0 : 1) | (mj ? 0 : 2) | (mi ? 0 : 4),
        iso: (par(m - 1) ? 1 : 0) | (mj ? 2 : 0) | (mi ? 4 : 0) });
    }
    return convexFaces(rings, { x: c.x, y: c.y, z: cz });
  };
  /* PYRAMID: a regular base of `sides`, an apex over its centre */
  const pyramid = (c, r, h, sides) => {
    const z0 = zOf(c), z1 = z0 + h, n = Math.max(3, sides | 0);
    const B = ring(c, r, z0, n, Math.PI / n + Math.PI / 2);
    const rings = [{ pts: B.slice().reverse() }];
    for (let i = 0; i < n; i++) rings.push({ pts: [B[i], B[(i + 1) % n], P3(c.x, c.y, z1)] });
    return convexFaces(rings, { x: c.x, y: c.y, z: (z0 * 2 + z1) / 3 });
  };

  /* ---------------- the one answer ---------------- */
  const solidFaceCache = new WeakMap();
  const facesRaw = (ent) => {
    if (!ent) return [];
    switch (ent.type) {
      case 'box': {
        const x = ent.p.x, y = ent.p.y;
        return extrude([{ x, y }, { x: x + ent.w, y }, { x: x + ent.w, y: y + ent.d }, { x, y: y + ent.d }], zOf(ent.p), ent.h);
      }
      case 'solid': {
        const hit = solidFaceCache.get(ent);
        if (hit && hit.src === ent.faces) return hit.faces;
        const faces = [];
        for (const f of ent.faces || []) {
          const n = newell(f.pts);
          if (!n) continue;
          /* a stored face is trusted as it stands: its ring was oriented
             outward by whoever built it (EXTRUDE, the ACIS reader). A face
             from a mesh carries no such promise and is drawn two-sided. */
          const g = { pts: f.pts, n, two: !!ent.two };
          if (f.holes && f.holes.length) g.holes = f.holes;
          if (f.hid) g.hid = f.hid;
          if (f.iso) g.iso = f.iso;
          if (f.color) g.color = f.color;   /* SOLIDEDIT Color Faces */
          faces.push(g);
        }
        solidFaceCache.set(ent, { src: ent.faces, faces });
        return faces;
      }
      case 'wall': return wallFaces(ent);
      case 'slab': return extrude(ent.pts, zOf(ent), ent.th);
      case 'face3d': {
        const n = newell(ent.pts);
        if (!n) return [];
        const f = { pts: ent.pts, n, two: true };
        if (ent.hid) f.hid = ent.hid;
        return [f];
      }
      default: return [];
    }
  };
  /* LIVE SECTION — display only. When a section object stands live
     (N.liveSection, kept by tools.js), every closed body ANSWERS ALREADY
     CUT: its faces clipped to the section's half-spaces and capped by
     the CSG kernel. The model itself is untouched — the raw answer stays
     reachable as rawFacesOf for the booleans, EXPLODE and the writers —
     and the clip is remembered per body until the section state turns. */
  const liveCutCache = new WeakMap();
  const liveCuttable = (ent) => !ent.secplane && !ent.surf &&
    (ent.type === 'box' || ent.type === 'wall' || ent.type === 'slab' || ent.type === 'solid');
  const liveCut = (ent, faces) => {
    const ls = N.liveSection;
    if (!ls || !ls.cuts || !ls.cuts.length || !faces.length || !N.csg || !liveCuttable(ent)) return faces;
    const hit = liveCutCache.get(ent);
    if (hit && hit.ver === ls.ver) return hit.out;
    let out = faces;
    for (const c of ls.cuts) {
      const r = N.csg.slice(out, { x: c.p[0], y: c.p[1], z: c.p[2] }, c.n);
      out = r.front || [];
      if (!out.length) break;
    }
    /* the renderers expect every face to carry its normal */
    out = out.map((f) => {
      const n = newell(f.pts);
      if (!n) return null;
      const g = { pts: f.pts, n };
      if (ent.two) g.two = true;
      if (f.holes && f.holes.length) g.holes = f.holes;
      if (f.hid) g.hid = f.hid;
      if (f.iso) g.iso = f.iso;
      return g;
    }).filter(Boolean);
    liveCutCache.set(ent, { ver: ls.ver, out });
    return out;
  };
  const facesOf = (ent) => liveCut(ent, facesRaw(ent));
  const isBody = (ent) => !!ent && (ent.type === 'box' || ent.type === 'solid' ||
    ent.type === 'wall' || ent.type === 'slab');
  const wiresOf = (ent) => (ent && ent.type === 'solid' && Array.isArray(ent.wires)) ? ent.wires : [];
  /* HIDDEN EDGES. A 3DFACE and a polyface mesh mark edges that are not
     drawn — the diagonal where a quad was split in two, the seam between
     two facets of one surface. A face carries them as a bitmask `hid`
     (bit i: the edge from corner i to i+1). The ring still bounds the
     face; only the stroke skips those edges, exactly as the industry standard draws. */
  const edgeRuns = (pts, hid) => {
    const n = pts.length;
    if (!hid || n < 2) return [{ pts, closed: true }];
    const out = [];
    let run = null;
    for (let i = 0; i < n; i++) {
      if (hid & (1 << i)) { run = null; continue; }
      const a = pts[i], b = pts[(i + 1) % n];
      if (run) run.pts.push(b);
      else { run = { pts: [a, b], closed: false }; out.push(run); }
    }
    return out;
  };
  /* every ring a wireframe strokes: the faces' outlines (less their hidden
     edges) and holes, the wires */
  /* THE EDGES OF A BODY, EACH ONCE. A body's faces meet along shared
     edges, and a ring walk strokes every shared edge twice — once from
     each face. The visible edges are gathered by their endpoints and
     emitted a single time as plain segments: half the line geometry the
     GPU holds and the painter strokes, the same picture. Remembered per
     body until its faces change. */
  const edgeCache = new WeakMap();
  const segmentsOf = (ent) => {
    const faces = facesOf(ent);
    const hit = edgeCache.get(ent);
    if (hit && hit.src === faces) return hit.segs;
    const seen = new Set();
    const segs = [];
    const key = (p) => p.x + ',' + p.y + ',' + zOf(p);
    /* an isoline (a seam a curved surface shows in a wireframe, f.iso)
       is a segment marked so: the shaded styles leave it out, as AutoCAD's do */
    const take = (a, b, iso) => {
      const ka = key(a), kb = key(b);
      if (ka === kb) return;
      const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      if (seen.has(k)) return;
      seen.add(k);
      const seg = [a, b];
      if (iso) seg.iso = true;
      segs.push(seg);
    };
    for (const f of faces) {
      const n = f.pts.length, hid = f.hid || 0, iso = f.iso || 0;
      for (let i = 0; i < n; i++) {
        if (hid & (1 << i)) continue;
        take(f.pts[i], f.pts[(i + 1) % n], !!(iso & (1 << i)));
      }
      for (const h of f.holes || []) for (let i = 0, m = h.length; i < m; i++) take(h[i], h[(i + 1) % m]);
    }
    /* a solid's faces are stored, so the cache keys on that array; the
       generated bodies (box, wall, slab) rebuild their faces on every
       call, and their few edges cost nothing to gather again */
    if (ent.type === 'solid') edgeCache.set(ent, { src: faces, segs });
    return segs;
  };
  /* every run a wireframe strokes: the body's edges, once each, and its wires */
  const edgesOf = (ent) => {
    const out = [];
    for (const s of segmentsOf(ent)) out.push({ pts: s, closed: false });
    for (const w of wiresOf(ent)) out.push({ pts: w, closed: false });
    return out;
  };
  /* the rings of the horizontal projection the plan tests against: a
     wall's outline, a slab's, a box's base, and every face of a solid */
  const footprint = (ent) => {
    switch (ent.type) {
      case 'wall': {
        const r = wallRings(ent);
        return [r.ring].concat(r.holes);
      }
      case 'slab': return [ent.pts];
      case 'box': {
        const x = ent.p.x, y = ent.p.y;
        return [[{ x, y }, { x: x + ent.w, y }, { x: x + ent.w, y: y + ent.d }, { x, y: y + ent.d }]];
      }
      case 'solid': return (ent.faces || []).map((f) => f.pts).concat(wiresOf(ent));
      default: return [];
    }
  };
  /* the runs the plan view strokes — a wall's are its own drawing */
  const planRuns = (ent) => {
    if (ent.type === 'wall') return wallPlan(ent);
    if (ent.type === 'solid') return edgesOf(ent);
    return footprint(ent).map((pts) => ({ pts, closed: true }));
  };
  /* distinct corners, for object snap */
  const vertices = (ent) => {
    const seen = new Set(), out = [];
    const take = (p) => {
      const k = p.x + ',' + p.y + ',' + zOf(p);
      if (seen.has(k)) return;
      seen.add(k);
      out.push(P3(p.x, p.y, zOf(p)));
    };
    for (const f of facesOf(ent)) {
      f.pts.forEach(take);
      for (const h of f.holes || []) h.forEach(take);
    }
    for (const w of wiresOf(ent)) { take(w[0]); take(w[w.length - 1]); }
    return out;
  };
  const zRange = (ent) => {
    let z0 = Infinity, z1 = -Infinity;
    for (const v of vertices(ent)) { if (v.z < z0) z0 = v.z; if (v.z > z1) z1 = v.z; }
    return isFinite(z0) ? [z0, z1] : [0, 0];
  };

  N.solid = { facesOf, rawFacesOf: facesRaw, isBody, wiresOf, edgesOf, segmentsOf, edgeRuns, footprint, planRuns, vertices, zRange,
    extrude, newell, area2, wallRings, wallOpenings,
    prims: { wedge, cylinder, sphere, pyramid } };
})();
