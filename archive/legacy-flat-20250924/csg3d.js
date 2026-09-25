/* Nasjicad — csg3d.js
 * BOOLEANS ON BODIES. A solid here is its planar faces (solid3d.js), and
 * this file is the algebra over them: UNION, SUBTRACT and INTERSECT by BSP
 * clipping (the csg.js construction), SLICE as an intersection with a
 * half-space box, and the volume that says whether anything is left.
 *
 * The pipeline: faces → triangles (ear clipping, holes bridged) → BSP →
 * clipped fragments → REBUILT faces. The rebuild is what keeps the result
 * a drawing rather than a triangle soup: fragments are gathered by the
 * plane they lie in, their edges split at every vertex that touches them
 * (the T-junctions BSP clipping leaves), opposite edges cancelled, and
 * the survivors chained into outer rings and holes. A seam between two
 * near-parallel faces — the facets of a cylinder that lived through the
 * boolean — is marked hidden (solid3d's hid bits), so the wireframe stays
 * circles and intersection curves, not thirty-two rulings.
 */
(() => {
  'use strict';
  const N = window.Nasj = window.Nasj || {};
  const zOf = (p) => (p && typeof p.z === 'number' && isFinite(p.z)) ? p.z : 0;
  const P3 = (x, y, z) => ({ x, y, z });

  /* the classification tolerance, set per operation from the model's size */
  let EPS = 1e-5;

  /* ---------------- vectors ---------------- */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const crossV = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dotV = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const lenV = (a) => Math.hypot(a[0], a[1], a[2]);
  const normV = (a) => { const l = lenV(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const vOf = (p) => [p.x, p.y, zOf(p)];

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

  /* ---------------- a face into triangles ----------------
     Ear clipping in the plane's two dominant axes, hole rings bridged into
     the outer ring first — the same construction gl3d.js shades with. */
  const triangulate = (f) => {
    const n = f.n || newell(f.pts);
    if (!n) return [];
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    const uv = az >= ax && az >= ay ? (p) => [p.x, p.y]
      : ax >= ay ? (p) => [p.y, zOf(p)] : (p) => [zOf(p), p.x];
    let ring = f.pts.slice();
    const area = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = uv(r[i]), b = uv(r[(i + 1) % r.length]); s += a[0] * b[1] - b[0] * a[1]; } return s; };
    const flip = area(ring) < 0;
    if (flip) ring.reverse();
    for (const h0 of f.holes || []) {
      const h = h0.slice();
      if (area(h) > 0) h.reverse();
      let hi = 0;
      for (let i = 1; i < h.length; i++) if (uv(h[i])[0] > uv(h[hi])[0]) hi = i;
      const hp = uv(h[hi]);
      let ri = 0, best = Infinity;
      for (let i = 0; i < ring.length; i++) { const p = uv(ring[i]); const d = (p[0] - hp[0]) ** 2 + (p[1] - hp[1]) ** 2; if (d < best) { best = d; ri = i; } }
      const rot = h.slice(hi).concat(h.slice(0, hi));
      ring = ring.slice(0, ri + 1).concat(rot, [rot[0]], ring.slice(ri));
    }
    const P = ring.map(uv);
    const idx = ring.map((_, i) => i);
    const out = [];
    const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inside = (a, b, c, p) => cross2(a, b, p) >= -1e-12 && cross2(b, c, p) >= -1e-12 && cross2(c, a, p) >= -1e-12;
    const take = (a, b, c) => { if (flip) out.push([c, b, a]); else out.push([a, b, c]); };
    let guard = 0;
    while (idx.length > 3 && guard++ < 6 * ring.length) {
      let cut = false;
      for (let i = 0; i < idx.length; i++) {
        const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
        const a = P[i0], b = P[i1], c = P[i2];
        if (cross2(a, b, c) <= 1e-12) continue;
        let clear = true;
        for (const j of idx) {
          if (j === i0 || j === i1 || j === i2) continue;
          const p = P[j];
          if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1]) || (p[0] === c[0] && p[1] === c[1])) continue;
          if (inside(a, b, c, p)) { clear = false; break; }
        }
        if (!clear) continue;
        take(ring[i0], ring[i1], ring[i2]);
        idx.splice(i, 1);
        cut = true;
        break;
      }
      if (!cut) break;
    }
    if (idx.length === 3) take(ring[idx[0]], ring[idx[1]], ring[idx[2]]);
    return out;
  };

  /* ---------------- BSP (the csg.js construction) ---------------- */
  const mkPlane = (a, b, c) => {
    const n = normV(crossV(sub(b, a), sub(c, a)));
    return { n, w: dotV(n, a) };
  };
  const flipPlane = (p) => ({ n: [-p.n[0], -p.n[1], -p.n[2]], w: -p.w });
  const mkPoly = (verts, plane) => ({ v: verts, plane });
  const flipPoly = (p) => mkPoly(p.v.slice().reverse(), flipPlane(p.plane));

  const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;
  const splitPolygon = (plane, poly, coFront, coBack, front, back) => {
    let type = 0;
    const types = [];
    for (const v of poly.v) {
      const t = dotV(plane.n, v) - plane.w;
      const ty = (t < -EPS) ? BACK : (t > EPS) ? FRONT : COPLANAR;
      type |= ty;
      types.push(ty);
    }
    switch (type) {
      case COPLANAR:
        (dotV(plane.n, poly.plane.n) > 0 ? coFront : coBack).push(poly);
        break;
      case FRONT: front.push(poly); break;
      case BACK: back.push(poly); break;
      case SPANNING: {
        const f = [], b = [];
        for (let i = 0; i < poly.v.length; i++) {
          const j = (i + 1) % poly.v.length;
          const ti = types[i], tj = types[j];
          const vi = poly.v[i], vj = poly.v[j];
          if (ti !== BACK) f.push(vi);
          if (ti !== FRONT) b.push(vi);
          if ((ti | tj) === SPANNING) {
            const t = (plane.w - dotV(plane.n, vi)) / dotV(plane.n, sub(vj, vi));
            const v = [vi[0] + t * (vj[0] - vi[0]), vi[1] + t * (vj[1] - vi[1]), vi[2] + t * (vj[2] - vi[2])];
            f.push(v);
            b.push(v);
          }
        }
        if (f.length >= 3) front.push(mkPoly(f, poly.plane));
        if (b.length >= 3) back.push(mkPoly(b, poly.plane));
        break;
      }
    }
  };

  const mkNode = (polys) => {
    const node = { plane: null, front: null, back: null, polys: [] };
    if (polys && polys.length) buildNode(node, polys);
    return node;
  };
  const buildNode = (node, polys) => {
    if (!polys.length) return;
    if (!node.plane) node.plane = polys[0].plane;
    const front = [], back = [];
    for (const p of polys) splitPolygon(node.plane, p, node.polys, node.polys, front, back);
    if (front.length) { if (!node.front) node.front = { plane: null, front: null, back: null, polys: [] }; buildNode(node.front, front); }
    if (back.length) { if (!node.back) node.back = { plane: null, front: null, back: null, polys: [] }; buildNode(node.back, back); }
  };
  const invertNode = (node) => {
    node.polys = node.polys.map(flipPoly);
    if (node.plane) node.plane = flipPlane(node.plane);
    if (node.front) invertNode(node.front);
    if (node.back) invertNode(node.back);
    const t = node.front; node.front = node.back; node.back = t;
  };
  const clipPolygons = (node, polys) => {
    if (!node.plane) return polys.slice();
    let front = [], back = [];
    for (const p of polys) splitPolygon(node.plane, p, front, back, front, back);
    if (node.front) front = clipPolygons(node.front, front);
    if (node.back) back = clipPolygons(node.back, back); else back = [];
    return front.concat(back);
  };
  const clipTo = (a, b) => {
    a.polys = clipPolygons(b, a.polys);
    if (a.front) clipTo(a.front, b);
    if (a.back) clipTo(a.back, b);
  };
  const allPolygons = (node, out) => {
    out = out || [];
    out.push(...node.polys);
    if (node.front) allPolygons(node.front, out);
    if (node.back) allPolygons(node.back, out);
    return out;
  };

  /* faces → BSP triangles */
  const polysOf = (faces) => {
    const out = [];
    for (const f of faces || []) {
      for (const t of triangulate(f)) {
        const v = t.map(vOf);
        const pl = mkPlane(v[0], v[1], v[2]);
        if (!isFinite(pl.w) || lenV(pl.n) < 0.5) continue;
        out.push(mkPoly(v, pl));
      }
    }
    return out;
  };

  const boundsOf = (faces) => {
    const b = { minx: Infinity, miny: Infinity, minz: Infinity, maxx: -Infinity, maxy: -Infinity, maxz: -Infinity };
    for (const f of faces || []) {
      for (const p of f.pts) {
        const z = zOf(p);
        if (p.x < b.minx) b.minx = p.x;
        if (p.y < b.miny) b.miny = p.y;
        if (z < b.minz) b.minz = z;
        if (p.x > b.maxx) b.maxx = p.x;
        if (p.y > b.maxy) b.maxy = p.y;
        if (z > b.maxz) b.maxz = z;
      }
    }
    return b;
  };
  const diagOf = (faces) => {
    const b = boundsOf(faces);
    return isFinite(b.minx) ? Math.hypot(b.maxx - b.minx, b.maxy - b.miny, b.maxz - b.minz) : 1;
  };
  const setEps = (a, b) => {
    const d = Math.max(diagOf(a), b ? diagOf(b) : 0, 1);
    EPS = Math.max(1e-8, d * 1e-7);
  };

  /* ---------------- fragments back into faces ----------------
     Fragments are gathered by plane; in each plane every edge is split at
     every vertex that lies on it (T-junctions), opposite edges cancel, and
     what survives is the region's boundary, chained into rings. CCW rings
     are faces, CW rings the holes inside them. */
  const facesFromPolys = (polys) => {
    const Q = EPS * 4;                      /* vertex weld grid */
    const qk = (v) => Math.round(v[0] / Q) + ',' + Math.round(v[1] / Q) + ',' + Math.round(v[2] / Q);
    /* ONE vertex pool for the whole body: an edge in one plane must split
       at a vertex the NEIGHBOURING plane introduced on it, or the two
       faces disagree about the edge and the body stops being closed */
    const verts = new Map();                /* key → 3D vertex */
    const vkey = (v) => { const k = qk(v); if (!verts.has(k)) verts.set(k, v); return k; };
    for (const p of polys) if (p.v.length >= 3) for (const v of p.v) vkey(v);
    const allV = Array.from(verts.entries()).map(([k, v]) => ({ k, v }));
    allV.sort((a, b) => a.v[0] - b.v[0]);   /* x-sorted, for the range scan */
    const allX = allV.map((e) => e.v[0]);
    const lowerX = (x) => {                 /* first index with allX[i] >= x */
      let lo = 0, hi = allX.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (allX[m] < x) lo = m + 1; else hi = m; }
      return lo;
    };
    /* group by plane, sign kept: the key rounds the normal and offset */
    const groups = new Map();
    for (const p of polys) {
      if (p.v.length < 3) continue;
      const n = p.plane.n, w = p.plane.w;
      const k = n.map((c) => Math.round(c * 1e4)).join(',') + '|' + Math.round(w / Q);
      let g = groups.get(k);
      if (!g) { g = { n, w, polys: [] }; groups.set(k, g); }
      g.polys.push(p);
    }
    const faces = [];
    for (const g of groups.values()) {
      /* the plane's 2D basis, right-handed about its normal */
      const n = g.n;
      const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const U = normV(crossV(ref, n));
      const V = normV(crossV(n, U));        /* U × V = n: CCW is about +n */
      const p2 = (v) => [dotV(v, U), dotV(v, V)];
      /* directed edges, opposite pairs cancelled */
      const eCount = new Map();             /* "ka>kb" → count */
      const bump = (ka, kb) => {
        if (ka === kb) return;
        const k = ka + '>' + kb, r = kb + '>' + ka;
        const rc = eCount.get(r) || 0;
        if (rc > 0) {                       /* an opposite edge cancels it */
          if (rc === 1) eCount.delete(r); else eCount.set(r, rc - 1);
          return;
        }
        eCount.set(k, (eCount.get(k) || 0) + 1);
      };
      /* each polygon edge, split at any body vertex lying on it */
      for (const p of g.polys) {
        for (let i = 0; i < p.v.length; i++) {
          const a = p.v[i], b = p.v[(i + 1) % p.v.length];
          const ka = vkey(a), kb = vkey(b);
          if (ka === kb) continue;
          const ab = sub(b, a), l2 = dotV(ab, ab);
          if (l2 < Q * Q * 0.01) { bump(ka, kb); continue; }
          /* the vertices on the segment, ordered along it */
          const on = [];
          const x0 = Math.min(a[0], b[0]) - Q, x1 = Math.max(a[0], b[0]) + Q;
          for (let vi = lowerX(x0); vi < allV.length && allX[vi] <= x1; vi++) {
            const k = allV[vi].k, v = allV[vi].v;
            if (k === ka || k === kb) continue;
            const t = dotV(sub(v, a), ab) / l2;
            if (t <= 0 || t >= 1) continue;
            const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
            if (lenV(sub(v, q)) <= Q) on.push({ t, k });
          }
          on.sort((x, y) => x.t - y.t);
          let prev = ka;
          for (const s of on) { bump(prev, s.k); prev = s.k; }
          bump(prev, kb);
        }
      }
      /* chain: at a junction take the sharpest left turn (interior left) */
      const outMap = new Map();             /* key → [destKey,...] */
      for (const [k, c] of eCount) {
        if (c <= 0) continue;
        const [ka, kb] = k.split('>');
        for (let i = 0; i < c; i++) {
          if (!outMap.has(ka)) outMap.set(ka, []);
          outMap.get(ka).push(kb);
        }
      }
      const angOf = (ka, kb) => {
        const a = p2(verts.get(ka)), b = p2(verts.get(kb));
        return Math.atan2(b[1] - a[1], b[0] - a[0]);
      };
      const rings = [];
      for (const [start] of outMap) {
        while (outMap.has(start) && outMap.get(start).length) {
          const ring = [start];
          let cur = start, prev = null, ok = false, guard = 0;
          while (guard++ < 100000) {
            const outs = outMap.get(cur);
            if (!outs || !outs.length) break;
            let pick = 0;
            if (outs.length > 1 && prev) {
              const back = angOf(cur, prev);
              let best = -Infinity;
              for (let i = 0; i < outs.length; i++) {
                let turn = angOf(cur, outs[i]) - back;
                while (turn <= 0) turn += Math.PI * 2;
                while (turn > Math.PI * 2) turn -= Math.PI * 2;
                if (turn > best - 1e-12 && turn < Math.PI * 2 - 1e-9) { best = turn; pick = i; }
              }
            }
            const nxt = outs.splice(pick, 1)[0];
            if (!outs.length) outMap.delete(cur);
            prev = cur;
            cur = nxt;
            if (cur === start) { ok = true; break; }
            ring.push(cur);
          }
          if (ok && ring.length >= 3) rings.push(ring);
          else break;
        }
      }
      /* rings → faces: collinear points dropped, area signs sorted out */
      const built = [];
      for (const ring of rings) {
        let pts = ring.map((k) => verts.get(k));
        /* drop collinear/repeat vertices */
        const keep = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
          const ab = sub(b, a), bc = sub(c, b);
          if (lenV(ab) <= Q) continue;
          if (lenV(crossV(ab, bc)) <= Q * (lenV(ab) + lenV(bc))) continue;
          keep.push(b);
        }
        if (keep.length < 3) continue;
        pts = keep;
        let ar = 0;
        const q0 = p2(pts[0]);
        for (let i = 1; i + 1 < pts.length; i++) {
          const q1 = p2(pts[i]), q2 = p2(pts[i + 1]);
          ar += (q1[0] - q0[0]) * (q2[1] - q0[1]) - (q2[0] - q0[0]) * (q1[1] - q0[1]);
        }
        if (Math.abs(ar) < Q * Q) continue;
        built.push({ pts, ar, uv: pts.map(p2) });
      }
      /* holes (CW) into the smallest CCW ring that contains them */
      const outer = built.filter((r) => r.ar > 0);
      const holes = built.filter((r) => r.ar < 0);
      const inRing = (uv, q) => {
        let inside = false;
        for (let i = 0, j = uv.length - 1; i < uv.length; j = i++) {
          if ((uv[i][1] > q[1]) !== (uv[j][1] > q[1]) &&
              q[0] < (uv[j][0] - uv[i][0]) * (q[1] - uv[i][1]) / (uv[j][1] - uv[i][1]) + uv[i][0]) inside = !inside;
        }
        return inside;
      };
      for (const o of outer) o.holeRings = [];
      for (const h of holes) {
        let best = null;
        for (const o of outer) {
          if (!inRing(o.uv, h.uv[0])) continue;
          if (!best || o.ar < best.ar) best = o;
        }
        if (best) best.holeRings.push(h.pts);
      }
      for (const o of outer) {
        const f = { pts: o.pts.map((v) => P3(v[0], v[1], v[2])) };
        if (o.holeRings.length) f.holes = o.holeRings.map((r) => r.map((v) => P3(v[0], v[1], v[2])));
        faces.push(f);
      }
    }
    markSeams(faces);
    return faces;
  };

  /* the seam between two near-parallel faces is hidden, as the primitives
     hide the seams between the facets of one curved surface */
  const SMOOTH = Math.cos(20 * Math.PI / 180);
  const markSeams = (faces) => {
    const norms = faces.map((f) => newell(f.pts));
    const ek = (a, b) => {
      const q = EPS * 8;
      const k = (p) => Math.round(p.x / q) + ',' + Math.round(p.y / q) + ',' + Math.round(zOf(p) / q);
      const ka = k(a), kb = k(b);
      return ka < kb ? ka + '|' + kb : kb + '|' + ka;
    };
    const edges = new Map();       /* key → [{fi, ei}] */
    faces.forEach((f, fi) => {
      for (let i = 0; i < f.pts.length; i++) {
        const k = ek(f.pts[i], f.pts[(i + 1) % f.pts.length]);
        if (!edges.has(k)) edges.set(k, []);
        edges.get(k).push({ fi, ei: i });
      }
    });
    for (const list of edges.values()) {
      if (list.length !== 2) continue;
      const [a, b] = list;
      const na = norms[a.fi], nb = norms[b.fi];
      if (!na || !nb || dotV(na, nb) < SMOOTH) continue;
      const fa = faces[a.fi], fb = faces[b.fi];
      fa.hid = (fa.hid || 0) | (1 << a.ei);
      fb.hid = (fb.hid || 0) | (1 << b.ei);
    }
  };

  /* ---------------- the operations ---------------- */
  const opRun = (aFaces, bFaces, op) => {
    setEps(aFaces, bFaces);
    const a = mkNode(polysOf(aFaces));
    const b = mkNode(polysOf(bFaces));
    if (op === 'union') {
      clipTo(a, b); clipTo(b, a);
      invertNode(b); clipTo(b, a); invertNode(b);
      buildNode(a, allPolygons(b));
    } else if (op === 'subtract') {
      invertNode(a); clipTo(a, b); clipTo(b, a);
      invertNode(b); clipTo(b, a); invertNode(b);
      buildNode(a, allPolygons(b)); invertNode(a);
    } else {                       /* intersect */
      invertNode(a); clipTo(b, a);
      invertNode(b); clipTo(a, b); clipTo(b, a);
      buildNode(a, allPolygons(b)); invertNode(a);
    }
    const faces = facesFromPolys(allPolygons(a));
    return faces.length ? faces : null;
  };
  const union = (a, b) => opRun(a, b, 'union');
  const subtract = (a, b) => opRun(a, b, 'subtract');
  const intersect = (a, b) => opRun(a, b, 'intersect');

  const volume = (faces) => {
    let v = 0;
    for (const f of faces || []) {
      for (const t of triangulate(f)) {
        const a = vOf(t[0]), b = vOf(t[1]), c = vOf(t[2]);
        v += dotV(a, crossV(b, c)) / 6;
      }
    }
    return v;
  };

  /* SLICE: the kept side is the body cut with a box that fills that side
     of the plane — its near wall lying exactly in the cutting plane */
  const slice = (faces, p0, nrm) => {
    setEps(faces, null);
    const n = normV(nrm);
    const bb = boundsOf(faces);
    const cen = isFinite(bb.minx)
      ? [(bb.minx + bb.maxx) / 2, (bb.miny + bb.maxy) / 2, (bb.minz + bb.maxz) / 2] : vOf(p0);
    const away = lenV(sub(cen, vOf(p0)));   /* the pick may stand far from the body */
    const d = (diagOf(faces) + away) * 2 + 1;
    const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = normV(crossV(ref, n));
    const v = normV(crossV(n, u));
    const o = vOf(p0);
    const boxFaces = (side) => {
      /* corners: o ± u·d ± v·d, out to o + n·side·d */
      const at = (su, sv, sn) => P3(
        o[0] + u[0] * su * d + v[0] * sv * d + n[0] * sn * side * d,
        o[1] + u[1] * su * d + v[1] * sv * d + n[1] * sn * side * d,
        o[2] + u[2] * su * d + v[2] * sv * d + n[2] * sn * side * d);
      const c = [at(-1, -1, 0), at(1, -1, 0), at(1, 1, 0), at(-1, 1, 0),
                 at(-1, -1, 1), at(1, -1, 1), at(1, 1, 1), at(-1, 1, 1)];
      const quad = (i, j, k, l) => {
        const pts = [c[i], c[j], c[k], c[l]];
        const nn = newell(pts);
        /* every ring turned outward from the box centre */
        const cen = [o[0] + n[0] * side * d / 2, o[1] + n[1] * side * d / 2, o[2] + n[2] * side * d / 2];
        const m = [(pts[0].x + pts[2].x) / 2 - cen[0], (pts[0].y + pts[2].y) / 2 - cen[1], (zOf(pts[0]) + zOf(pts[2])) / 2 - cen[2]];
        return (nn && dotV(nn, m) < 0) ? { pts: pts.slice().reverse() } : { pts };
      };
      return [quad(0, 1, 2, 3), quad(4, 5, 6, 7), quad(0, 1, 5, 4), quad(1, 2, 6, 5), quad(2, 3, 7, 6), quad(3, 0, 4, 7)];
    };
    return {
      front: intersect(faces, boxFaces(1)),
      back: intersect(faces, boxFaces(-1)),
    };
  };

  N.csg = { union, subtract, intersect, slice, volume, triangulate, newell, markSeams };
})();
