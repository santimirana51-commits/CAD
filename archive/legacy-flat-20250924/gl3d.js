/* Nasjicad — gl3d.js
 * THE 3D VIEW ON THE GPU. In a 3D view the geometry is drawn by WebGL 1
 * with a depth buffer: every pixel keeps the nearest surface, so a wall
 * hides what stands behind it whatever order anything was drawn in, a line
 * that runs into a body is cut where it enters, and a frame costs what the
 * GPU charges, not a walk over every entity. The 2D canvas keeps what it
 * always drew — text, dimensions, hatches, selection, grips — over it.
 *
 * Built to run everywhere the 2D GL path runs: WebGL 1 and the one
 * extension that path already requires (ANGLE_instanced_arrays — Apple's
 * ANGLE over Metal has it, every integrated GPU has it). No float
 * textures, no VAOs, no 32-bit indices: plain drawArrays over interleaved
 * buffers. Positions are float32 RELATIVE TO AN ANCHOR and the camera is
 * folded to the target's own pixel in doubles on the CPU, so a 200,000-
 * unit drawing holds sub-pixel precision at any zoom on a float32 GPU.
 * Block references draw as instances of their definition's mesh — one
 * tessellation per definition, one 32-byte record per reference.
 *
 * The CPU painter in engine.js stays the fallback: where the GPU probe
 * says no (software renderers, 'glscene' off), nothing here runs.
 *
 * Projection is the engine's own camera, in the same terms w2s3d uses:
 * a basis d (toward the eye), r (screen right), u (screen up); a point's
 * view coordinates measured from the TARGET; orthographic projectors
 * parallel to d, perspective ones through the eye at dist along d.
 */
(() => {
  'use strict';
  const N = window.Nasj = window.Nasj || {};
  const TAU = Math.PI * 2;
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const zOf = (p) => (p && isNum(p.z)) ? p.z : 0;

  /* ---------------- context ---------------- */
  let cv = null, gl = null, extInst = null, lost = false, failed = false;
  let progFace = null, progLine = null;
  const ensureGL = () => {
    if (gl) return !lost;
    if (failed) return false;
    cv = document.createElement('canvas');
    /* a GPU the probe graded below the top tier skips multisampling: the
       fill it costs is the one thing a weak GPU cannot spare */
    const weak = !!(N.glscene && typeof N.glscene.weakTier === 'function' && N.glscene.weakTier());
    try {
      gl = cv.getContext('webgl', {
        alpha: true, antialias: !weak, premultipliedAlpha: true, depth: true,
        stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance'
      });
    } catch (e) { gl = null; }
    if (!gl) { failed = true; return false; }
    extInst = gl.getExtension('ANGLE_instanced_arrays');
    if (!extInst) { failed = true; gl = null; return false; }
    cv.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); lost = true; freeScene(); });
    cv.addEventListener('webglcontextrestored', () => { lost = false; progFace = progLine = null; makePrograms(); });
    makePrograms();
    return true;
  };

  /* the camera, in the shader: q = the point measured from the target.
     U = r·q, V = u·q, D = d·q. Orthographic: screen = c0 + rolled(U,V)·scale.
     Perspective: the same with (U,V) scaled by dist/w, w = dist − D — done
     homogeneously, so the GPU divides. c0 is the target's own pixel,
     folded in doubles on the CPU: nothing large ever meets float32. */
  const VS_CAM = `
    uniform vec3 u_anchor;              /* chunk anchor − target */
    uniform vec3 u_r, u_u, u_d;
    uniform float u_persp, u_dist, u_k; /* k = dist (perspective) or 1 */
    uniform float u_cR, u_sR, u_scale;
    uniform vec2 u_c0;                  /* the target's pixel (x right, y up) */
    uniform vec2 u_size;                /* css width, height */
    uniform float u_zA, u_zB;
    vec4 project(vec3 p) {
      vec3 q = p + u_anchor;
      float U = dot(u_r, q), V = dot(u_u, q), D = dot(u_d, q);
      float w = u_persp > 0.5 ? (u_dist - D) : 1.0;
      float xw = (u_cR * U - u_sR * V) * u_k * u_scale + u_c0.x * w;
      float yw = (u_sR * U + u_cR * V) * u_k * u_scale + u_c0.y * w;
      float zh = u_persp > 0.5 ? (u_zA * w + u_zB) : (u_zA * D + u_zB);
      return vec4(xw * 2.0 / u_size.x - w, yw * 2.0 / u_size.y - w, zh, w);
    }`;
  /* an instance: a 2×2 placement (rotation · scale, the insert's) and a
     translation from the chunk anchor; a vertex colour with alpha 0 means
     ByBlock and takes the instance's colour */
  const VS_INST = `
    attribute vec4 a_m;
    attribute vec3 a_t;
    attribute vec4 a_icol;
    vec3 place(vec3 p) { return vec3(a_m.x * p.x + a_m.y * p.y, a_m.z * p.x + a_m.w * p.y, p.z) + a_t; }
    vec4 colourOf(vec4 c) { return c.a < 0.002 ? a_icol : c; }`;
  const VS_FACE = VS_CAM + VS_INST + `
    attribute vec3 a_pos;
    attribute vec3 a_nrm;
    attribute vec4 a_col;
    uniform vec3 u_light, u_eye;
    uniform float u_hidden, u_gray, u_alpha, u_gooch;
    uniform vec3 u_bg;
    varying vec4 v_col;
    void main() {
      vec3 n = normalize(vec3(a_m.x * a_nrm.x + a_m.y * a_nrm.y, a_m.z * a_nrm.x + a_m.w * a_nrm.y, a_nrm.z));
      float d = abs(dot(n, u_light));
      vec4 c = colourOf(a_col);
      vec3 rgb;
      if (u_gooch > 0.5) {
        /* Conceptual: AutoCAD's Gooch tones, warm to the light and cool
           away from it, over the body's own colour — the engine's goochColor */
        float t = d * (2.0 - d);
        vec3 cool = vec3(0.0, 0.0, 0.38) + 0.40 * c.rgb;
        vec3 warm = vec3(0.11, 0.11, 0.0) + 0.83 * c.rgb;
        rgb = min(mix(cool, warm, t), vec3(1.0));
      } else {
        /* AutoCAD's default lighting: a white body tops out light grey, and
           its default material has a gloss — a Blinn-Phong highlight where
           a face turns the light toward the eye, the bright streak down a
           cone's flank */
        rgb = c.rgb * (0.24 + 0.60 * d);
        vec3 hv = normalize(u_light + u_eye);
        float sp = pow(abs(dot(n, hv)), 20.0);
        rgb = min(rgb + vec3(0.9 * sp), vec3(1.0));
      }
      /* Shades of Gray: one grey ramp for every body — the engine's grayColor */
      if (u_gray > 0.5) rgb = vec3(0.27 + 0.28 * d);
      if (u_hidden > 0.5) rgb = u_bg;
      v_col = vec4(rgb * u_alpha, u_alpha);
      gl_Position = project(place(a_pos));
    }`;
  /* a_par is the segment's other end, bound for body edges only: Sketchy
     needs it to overshoot the corner along the edge and to wobble across
     it — the engine's sketchPath, in pixels, hashed from the vertex so the
     figure holds still. u_sk = (extension px, jitter px, pass). */
  const VS_LINE = VS_CAM + VS_INST + `
    attribute vec3 a_pos;
    attribute vec3 a_par;
    attribute vec4 a_col;
    uniform float u_dim, u_gray, u_isoOff;
    uniform vec3 u_sk;
    varying vec4 v_col;
    float skHash(vec3 p, float k) {
      return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719)) + k * 91.17) * 43758.5453);
    }
    void main() {
      vec4 c = colourOf(a_col);
      vec3 rgb = c.rgb * u_dim;
      /* Shades of Gray: loose lines in their grey, body edges (u_gray 2) white */
      if (u_gray > 1.5) rgb = vec3(1.0);
      else if (u_gray > 0.5) { float g = dot(rgb, vec3(0.299, 0.587, 0.114)); rgb = vec3(g); }
      v_col = vec4(rgb, 1.0);
      vec4 pc = project(place(a_pos));
      if (u_sk.x > 0.0) {
        vec4 qc = project(place(a_par));
        vec2 hs = u_size * 0.5;
        vec2 p = pc.xy / pc.w * hs, q = qc.xy / qc.w * hs;
        vec2 dv = p - q;
        float L = length(dv);
        if (L > 0.001) {
          vec2 dir = dv / L, nrm = vec2(-dir.y, dir.x);
          float ext = u_sk.x * (0.6 + 0.8 * skHash(a_pos, u_sk.z));
          float jit = u_sk.y * (skHash(a_pos, u_sk.z + 5.0) * 2.0 - 1.0);
          p += dir * ext + nrm * jit;
          pc.xy = p / hs * pc.w;
          /* a displaced edge leaves its own face's plane, and the face
             next door is nearer where it now lies: pull it a few pixels'
             worth of depth toward the eye so the depth test keeps it */
          float ppu = u_k * u_scale / pc.w;      /* pixels per world unit here */
          pc.z -= 4.0 / ppu * abs(u_zA);
        }
      }
      /* an isoline (alpha 254 marks it) is clipped away in a shaded style */
      if (u_isoOff > 0.5 && a_col.a > 0.99 && a_col.a < 0.998) pc = vec4(2.0, 2.0, 2.0, 1.0);
      gl_Position = pc;
      gl_PointSize = 1.0;
    }`;
  const FS = `
    precision mediump float;
    varying vec4 v_col;
    void main() { gl_FragColor = v_col; }`;

  const compile = (vs, fs) => {
    const sh = (t, src) => {
      const s = gl.createShader(t);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('[gl3d] shader', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error('[gl3d] link', gl.getProgramInfoLog(p)); return null; }
    const P = { p, a: {}, u: {} };
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) { const a = gl.getActiveAttrib(p, i); P.a[a.name] = gl.getAttribLocation(p, a.name); }
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) { const u = gl.getActiveUniform(p, i); P.u[u.name] = gl.getUniformLocation(p, u.name); }
    return P;
  };
  const makePrograms = () => {
    progFace = compile(VS_FACE, FS);
    progLine = compile(VS_LINE, FS);
    if (!progFace || !progLine) { failed = true; gl = null; }
  };

  /* ---------------- the vertex sinks ---------------- */
  const FSTRIDE = 28;   /* pos 3f, nrm 3f, col 4ub */
  const LSTRIDE = 16;   /* pos 3f, col 4ub */
  const ISTRIDE = 32;   /* m 4f, t 3f, col 4ub */
  const ANCHOR_R = 16384;
  const CHUNK_VERTS = 200000;
  const sink = (stride, cap) => ({
    buf: new ArrayBuffer(cap * stride), n: 0, cap, stride,
    ensure(k) {
      if (this.n + k <= this.cap) return;
      let c = this.cap;
      while (c < this.n + k) c *= 2;
      const nb = new ArrayBuffer(c * this.stride);
      new Uint8Array(nb).set(new Uint8Array(this.buf, 0, this.n * this.stride));
      this.buf = nb; this.cap = c; this.f32 = null; this.u8 = null;
    },
    views() {
      if (!this.f32) { this.f32 = new Float32Array(this.buf); this.u8 = new Uint8Array(this.buf); }
      return this;
    }
  });
  const pushFace = (s, x, y, z, nx, ny, nz, col) => {
    s.ensure(1); s.views();
    const o = s.n * FSTRIDE, f = o >> 2;
    s.f32[f] = x; s.f32[f + 1] = y; s.f32[f + 2] = z;
    s.f32[f + 3] = nx; s.f32[f + 4] = ny; s.f32[f + 5] = nz;
    s.u8[o + 24] = col[0]; s.u8[o + 25] = col[1]; s.u8[o + 26] = col[2]; s.u8[o + 27] = col[3];
    s.n++;
  };
  const keyOf = (p) => p.x + ',' + p.y + ',' + zOf(p);
  const pushLine = (s, x, y, z, col) => {
    s.ensure(1); s.views();
    const o = s.n * LSTRIDE, f = o >> 2;
    s.f32[f] = x; s.f32[f + 1] = y; s.f32[f + 2] = z;
    s.u8[o + 12] = col[0]; s.u8[o + 13] = col[1]; s.u8[o + 14] = col[2]; s.u8[o + 15] = col[3];
    s.n++;
  };

  /* a mesh under construction: faces, body edges, loose lines, all
     relative to one anchor, and the world box it spans */
  const newMesh = (ax, ay, az) => ({
    ax, ay, az,
    faces: sink(FSTRIDE, 1024), edges: sink(LSTRIDE, 1024), lines: sink(LSTRIDE, 1024),
    bx0: Infinity, by0: Infinity, bz0: Infinity, bx1: -Infinity, by1: -Infinity, bz1: -Infinity,
    vboF: null, vboE: null, vboL: null, nF: 0, nE: 0, nL: 0
  });
  const grow = (m, x, y, z) => {
    if (x < m.bx0) m.bx0 = x; if (x > m.bx1) m.bx1 = x;
    if (y < m.by0) m.by0 = y; if (y > m.by1) m.by1 = y;
    if (z < m.bz0) m.bz0 = z; if (z > m.bz1) m.bz1 = z;
  };
  const vertCount = (m) => m.faces.n + m.edges.n + m.lines.n;

  /* ---------------- colours ---------------- */
  const colCache = new Map();
  const rgbOf = (s) => {
    let c = colCache.get(s);
    if (c) return c;
    c = [255, 255, 255, 255];
    if (typeof s === 'string') {
      if (s[0] === '#') {
        const h = s.slice(1);
        if (h.length === 3) c = [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 255];
        else if (h.length >= 6) c = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
      } else {
        const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
        if (m) c = [+m[1] | 0, +m[2] | 0, +m[3] | 0, 255];
      }
    }
    if (c.some((v) => !(v >= 0 && v <= 255))) c = [255, 255, 255, 255];
    colCache.set(s, c);
    return c;
  };
  const BYBLOCK = [0, 0, 0, 0];   /* alpha 0: the instance's colour */

  /* ---------------- tessellation ---------------- */
  const G = () => N.geom;
  const segsFor = (r, sweep) => Math.max(8, Math.min(192, Math.ceil(64 * Math.abs(sweep) / TAU * Math.max(1, Math.log2(1 + r / 10)))));
  /* the runs (polylines) an entity's curve breaks into, with heights */
  const runsOf = (ent) => {
    const g = G();
    switch (ent.type) {
      case 'line': return [{ pts: [ent.a, ent.b], closed: false }];
      case 'polyline': {
        const r = g.polylinePoints(ent);
        return r.pts.length >= 2 ? [r] : [];
      }
      case 'circle': {
        const k = segsFor(ent.r, TAU), pts = [];
        for (let i = 0; i < k; i++) { const p = g.arcPoint(ent, TAU * i / k); if (ent.c && isNum(ent.c.z)) p.z = ent.c.z; pts.push(p); }
        return [{ pts, closed: true }];
      }
      case 'arc': {
        const s = g.arcSweep(ent.a0, ent.a1);
        if (!(s > 0)) return [];
        const k = segsFor(ent.r, s), pts = [];
        for (let i = 0; i <= k; i++) { const p = g.arcPoint(ent, ent.a0 + s * i / k); if (ent.c && isNum(ent.c.z)) p.z = ent.c.z; pts.push(p); }
        return [{ pts, closed: false }];
      }
      case 'ellipse': {
        const rmax = Math.max(ent.rx, ent.ry);
        if (!(rmax > 0)) return [];
        const arc = g.ellipseIsArc(ent);
        const s = arc ? g.ellipseSweep(ent) : TAU;
        const k = segsFor(rmax, s), pts = [];
        const a0 = arc ? ent.a0 : 0;
        for (let i = 0; i < (arc ? k + 1 : k); i++) pts.push(g.ellipsePoint(ent, a0 + s * i / k));
        return [{ pts, closed: !arc }];
      }
      case 'spline': {
        const bz = g.splineBeziers(ent);
        if (!bz.length) return [];
        const pts = [bz[0].a];
        for (const seg of bz) {
          for (let i = 1; i <= 12; i++) {
            const t = i / 12, mt = 1 - t;
            pts.push({
              x: mt * mt * mt * seg.a.x + 3 * mt * mt * t * seg.c1.x + 3 * mt * t * t * seg.c2.x + t * t * t * seg.b.x,
              y: mt * mt * mt * seg.a.y + 3 * mt * mt * t * seg.c1.y + 3 * mt * t * t * seg.c2.y + t * t * t * seg.b.y,
              z: mt * mt * mt * zOf(seg.a) + 3 * mt * mt * t * zOf(seg.c1) + 3 * mt * t * t * zOf(seg.c2) + t * t * t * zOf(seg.b)
            });
          }
        }
        return [{ pts, closed: !!ent.closed }];
      }
      case 'mline': {
        const out = [];
        for (const part of g.mlineParts(ent) || []) for (const r of runsOf(part)) out.push(r);
        return out;
      }
      default: return [];
    }
  };
  /* a planar face (ring + holes) as triangles: ear clipping in the plane's
     two axes, holes bridged into the ring first */
  const triangulate = (f) => {
    const n = f.n, ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    const uv = az >= ax && az >= ay ? (p) => [p.x, p.y]
      : ax >= ay ? (p) => [p.y, zOf(p)] : (p) => [zOf(p), p.x];
    let ring = f.pts.slice();
    const area = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = uv(r[i]), b = uv(r[(i + 1) % r.length]); s += a[0] * b[1] - b[0] * a[1]; } return s; };
    if (area(ring) < 0) ring.reverse();
    for (const h0 of f.holes || []) {
      /* bridge: the hole's rightmost point to the nearest ring vertex */
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
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inside = (a, b, c, p) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
    let guard = 0;
    while (idx.length > 3 && guard++ < 6 * ring.length) {
      let cut = false;
      for (let i = 0; i < idx.length; i++) {
        const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
        const a = P[i0], b = P[i1], c = P[i2];
        if (cross(a, b, c) <= 1e-12) continue;
        let clear = true;
        for (const j of idx) {
          if (j === i0 || j === i1 || j === i2) continue;
          const p = P[j];
          if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1]) || (p[0] === c[0] && p[1] === c[1])) continue;
          if (inside(a, b, c, p)) { clear = false; break; }
        }
        if (!clear) continue;
        out.push(ring[i0], ring[i1], ring[i2]);
        idx.splice(i, 1);
        cut = true;
        break;
      }
      if (!cut) break;
    }
    if (idx.length === 3) out.push(ring[idx[0]], ring[idx[1]], ring[idx[2]]);
    return out;
  };

  /* one entity into a mesh, in coordinates relative to the mesh anchor */
  const addEntity = (m, ent, col) => {
    const S = N.solid;
    const rel = (p) => [p.x - m.ax, p.y - m.ay, zOf(p) - m.az];
    const run = (sinkS, pts, closed, c) => {
      const n = pts.length;
      const segs = closed ? n : n - 1;
      const lc = c || col;
      for (let i = 0; i < segs; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const ra = rel(a), rb = rel(b);
        pushLine(sinkS, ra[0], ra[1], ra[2], lc);
        pushLine(sinkS, rb[0], rb[1], rb[2], lc);
        grow(m, a.x, a.y, zOf(a)); grow(m, b.x, b.y, zOf(b));
      }
    };
    if (ent.type === 'hatch') {
      /* a SOLID fill: the boundary as one face on the ground, no edges */
      const b = N.geom.hatchBoundary(ent);
      const r = b ? runsOf(b)[0] : null;
      if (!r || r.pts.length < 3) return;
      const c = col[0] === 0 && col[1] === 0 && col[2] === 0 && col[3] === 1 ? rgbOf(N.activeBg ? N.activeBg() : '#212830') : col;
      for (const p of triangulate({ pts: r.pts, n: [0, 0, 1] })) { const q = rel(p); pushFace(m.faces, q[0], q[1], q[2], 0, 0, 1, c); }
      for (const p of r.pts) grow(m, p.x, p.y, zOf(p));
      return;
    }
    if (ent.type === 'face3d' || S.isBody(ent)) {
      const faces = S.facesOf(ent);
      /* SMOOTH SHADING: a curved surface is facets meeting along seams
         (hidden edges, and the isolines among them). A corner on a seam
         takes the mean of the normals of the facets meeting there, so the
         shade runs smoothly round the surface instead of stepping facet by
         facet — AutoCAD's "smooths the edges between polygon faces". A
         corner on a real edge (a cap's rim, a box) keeps its face's own. */
      const seamN = new Map();                 /* corner key -> summed normal */
      const seamOf = new Map();                /* face -> its corners on seams */
      for (const f of faces) {
        const seam = (f.hid || 0) | (f.iso || 0);
        if (!seam) continue;
        const n = f.pts.length, mine = new Set();
        for (let i = 0; i < n; i++) {
          if (!(seam & (1 << i))) continue;
          mine.add(keyOf(f.pts[i])); mine.add(keyOf(f.pts[(i + 1) % n]));
        }
        for (const k of mine) {
          const a = seamN.get(k);
          if (a) { a[0] += f.n[0]; a[1] += f.n[1]; a[2] += f.n[2]; }
          else seamN.set(k, [f.n[0], f.n[1], f.n[2]]);
        }
        seamOf.set(f, mine);
      }
      for (const f of faces) {
        const tri = triangulate(f);
        const fc = f.color ? rgbOf(f.color) : col;   /* Color Faces */
        const mine = seamOf.get(f);
        for (const p of tri) {
          const r = rel(p);
          let nx = f.n[0], ny = f.n[1], nz = f.n[2];
          const k = mine ? keyOf(p) : null;
          const a = k && mine.has(k) ? seamN.get(k) : null;
          if (a) {
            const L = Math.hypot(a[0], a[1], a[2]);
            if (L > 1e-12) { nx = a[0] / L; ny = a[1] / L; nz = a[2] / L; }
          }
          pushFace(m.faces, r[0], r[1], r[2], nx, ny, nz, fc);
        }
      }
      /* the body's edges, each once, less the ones the drawing marks
         hidden; an isoline goes out marked (alpha 254) so the shaded styles
         can drop it */
      const isoCol = col[3] === 255 ? [col[0], col[1], col[2], 254] : col;
      for (const s of S.segmentsOf(ent)) run(m.edges, s, false, s.iso ? isoCol : null);
      for (const w of S.wiresOf(ent)) run(m.lines, w, false);
      return;
    }
    for (const r of runsOf(ent)) run(m.lines, r.pts, r.closed);
  };

  /* ---------------- ownership ---------------- */
  const OWN = { line: 1, polyline: 1, circle: 1, arc: 1, ellipse: 1, spline: 1, mline: 1,
    face3d: 1, box: 1, solid: 1, wall: 1, slab: 1 };
  /* a SOLID hatch is a face; a pattern hatch is the 2D layer's procedural
     line families, and stays there (as on the 2D GL path) */
  const ownsType = (e) => !!e && (OWN[e.type] === 1 ||
    (e.type === 'hatch' && !e.grad && typeof e.aisel !== 'number' &&
     String(e.pattern || '').toUpperCase() === 'SOLID'));
  /* a reference is drawn entirely here when every drawable child is */
  const defWhole = new WeakMap();
  const defAllOwned = (doc, name, seen) => {
    const def = doc.blocks && doc.blocks[name];
    if (!def || !Array.isArray(def.entities)) return false;
    const hit = defWhole.get(def.entities);
    if (hit !== undefined) return hit;
    seen = seen || new Set();
    if (seen.has(name)) return true;
    seen.add(name);
    let all = true;
    for (const c of def.entities) {
      if (!c || c.construction || c.type === 'bparam') continue;
      if (c.type === 'insert') { if (!defAllOwned(doc, c.name, seen)) { all = false; break; } continue; }
      if (!ownsType(c)) { all = false; break; }
    }
    defWhole.set(def.entities, all);
    return all;
  };
  const owns = (doc) => (e) => {
    if (!e) return false;
    if (e.type === 'insert') return defAllOwned(doc, e.name);
    return ownsType(e);
  };

  /* ---------------- the scene ---------------- */
  let scene = null;   /* {doc, rev, lsig, chunks:[mesh], defs:Map, inst:[{mesh, buf, n}], box} */
  const restCache = new WeakMap();
  const freeMesh = (m) => {
    if (!gl || !m) return;
    for (const k of ['vboF', 'vboE', 'vboEP', 'vboL']) if (m[k]) { gl.deleteBuffer(m[k]); m[k] = null; }
  };
  const freeScene = () => {
    if (!scene) return;
    if (gl && !lost) {
      for (const m of scene.chunks) freeMesh(m);
      for (const k of ['defF', 'defE', 'defEP', 'defL', 'instVbo', 'one']) if (scene[k]) gl.deleteBuffer(scene[k]);
    }
    scene = null;
  };
  /* the edges' partner positions — vertex 2k's is 2k+1's and back — read
     off the edge buffer itself, for the line shader's Sketchy figure */
  const partnerBuf = (u8, n) => {
    const f = new Float32Array(u8.buffer, u8.byteOffset, n * 4);
    const out = new Float32Array(n * 3);
    for (let i = 0; i + 1 < n; i += 2) {
      const p = i * 4, q = p + 4, o = i * 3;
      out[o] = f[q]; out[o + 1] = f[q + 1]; out[o + 2] = f[q + 2];
      out[o + 3] = f[p]; out[o + 4] = f[p + 1]; out[o + 5] = f[p + 2];
    }
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, out, gl.STATIC_DRAW);
    return b;
  };
  const upload = (m) => {
    const up = (s) => {
      if (!s.n) return null;
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(s.buf, 0, s.n * s.stride), gl.STATIC_DRAW);
      return b;
    };
    m.vboF = up(m.faces); m.nF = m.faces.n;
    m.vboE = up(m.edges); m.nE = m.edges.n;
    m.vboEP = m.nE ? partnerBuf(new Uint8Array(m.edges.buf, 0, m.nE * LSTRIDE), m.nE) : null;
    m.vboL = up(m.lines); m.nL = m.lines.n;
    m.faces = m.edges = m.lines = null;   /* the CPU copy is spent */
  };
  const layerVisible = (ly) => !!ly && ly.on !== false && !ly.frozen;
  /* a reference simple enough to draw as an instance of its definition */
  const plainInsert = (ent, doc) => !ent.dyn && !ent.vis &&
    !(ent.attrs && Object.keys(ent.attrs).length) &&
    !(N.geom.insertClipWorld && N.geom.insertClipWorld(ent, doc)) &&
    !(N.xref && N.xref.fadeOf && N.xref.fadeOf(doc, ent));

  const build = (doc, rev, lsig) => {
    freeScene();
    const lmap = new Map(doc.layers.map((l) => [l.id, l]));
    const own = owns(doc);
    const chunks = [];
    const defs = new Map();
    const inst = [];
    let cur = null;
    const chunkFor = (x, y, z, need) => {
      if (cur && (Math.abs(x - cur.ax) > ANCHOR_R || Math.abs(y - cur.ay) > ANCHOR_R ||
          vertCount(cur) + need > CHUNK_VERTS)) cur = null;
      if (!cur) { cur = newMesh(x, y, z); chunks.push(cur); }
      return cur;
    };
    const colourOf = (e, parent) => {
      if (e.color === '@bg') return [0, 0, 0, 1];   /* a wipeout: the background, resolved at build */
      if (e.color === 'ByBlock' && parent) return rgbOf(N.docOps.resolveColor(doc, parent));
      return rgbOf(N.docOps.resolveColor(doc, e));
    };
    /* the definition's mesh, in definition coordinates about its base;
       every definition's vertices go into ONE buffer per kind, so a frame
       binds the geometry once and a reference costs a handful of calls */
    const defMesh = (name) => {
      const def = doc.blocks[name];
      let d = defs.get(name);
      if (d) return d;
      const base = (def && def.base) || { x: 0, y: 0 };
      const m = newMesh(base.x, base.y, 0);
      for (const c of def.entities) {
        if (!c || c.construction || c.type === 'bparam' || !ownsType(c)) continue;
        const ly = lmap.get(c.layerId);
        if (ly && !layerVisible(ly)) continue;
        const col = c.color === 'ByBlock' ? BYBLOCK : colourOf(c, null);
        addEntity(m, c, col);
      }
      m.nF = m.faces.n; m.nE = m.edges.n; m.nL = m.lines.n;
      d = { mesh: m, recs: [], n: 0 };
      defs.set(name, d);
      return d;
    };
    const box = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
    /* what this layer does NOT draw — the 2D pass walks only these */
    const rest = [];
    const growBox = (m, tx, ty, tz, sx, sy) => {
      if (!isFinite(m.bx0)) return;
      /* the mesh box, placed (a rotation is covered by the larger span) */
      const rx = Math.max(Math.abs(m.bx0 - m.ax), Math.abs(m.bx1 - m.ax)) * Math.abs(sx);
      const ry = Math.max(Math.abs(m.by0 - m.ay), Math.abs(m.by1 - m.ay)) * Math.abs(sy);
      const r = Math.hypot(rx, ry);
      box.x0 = Math.min(box.x0, tx - r); box.x1 = Math.max(box.x1, tx + r);
      box.y0 = Math.min(box.y0, ty - r); box.y1 = Math.max(box.y1, ty + r);
      box.z0 = Math.min(box.z0, tz + m.bz0 - m.az); box.z1 = Math.max(box.z1, tz + m.bz1 - m.az);
    };
    /* the walk over the entities, resumable: a heavy drawing is taken
       apart across frames, the CPU painter drawing until it is done */
    let i = 0;
    const ents = doc.entities;
    const hid = N.hiddenIds || null;
    const step = (deadline) => {
     for (; i < ents.length; i++) {
      if ((i & 15) === 0 && performance.now() > deadline) return false;
      const ent = ents[i];
      if (!ent) continue;
      /* isolation and the modify drag's ghost both hide by id — the sync
         key (lsig) carries the hidden generation, so this walk reruns */
      if (hid && hid.has(ent.id)) continue;
      if (!own(ent)) rest.push(ent);
      const ly = lmap.get(ent.layerId);
      if (!layerVisible(ly)) continue;
      if (ent.type === 'insert') {
        const def = doc.blocks && doc.blocks[ent.name];
        if (!def || !Array.isArray(def.entities)) continue;
        const nested = def.entities.some((c) => c && c.type === 'insert');
        if (!nested && plainInsert(ent, doc)) {
          const d = defMesh(ent.name);
          if (!d.mesh.nF && !d.mesh.nE && !d.mesh.nL) continue;
          d.n++;
          const sx = isNum(ent.sx) ? ent.sx : 1, sy = isNum(ent.sy) ? ent.sy : 1;
          const rot = ent.rot || 0, co = Math.cos(rot), si = Math.sin(rot);
          const tz = zOf(ent.p);
          d.recs.push({ m: [sx * co, -sy * si, sx * si, sy * co], t: [ent.p.x, ent.p.y, tz],
            col: rgbOf(N.docOps.resolveColor(doc, ent)) });
          growBox(d.mesh, ent.p.x, ent.p.y, tz, sx, sy);
          continue;
        }
        /* anything else: the flattened children, placed by the engine's own walk */
        for (const c of N.geom.insertEntities(ent, doc)) {
          if (!ownsType(c)) continue;
          const b = c.a || c.p || c.c || (c.pts && c.pts[0]) || ent.p;
          const m = chunkFor(b.x, b.y, 0, 64);
          addEntity(m, c, colourOf(c, ent));
        }
        continue;
      }
      if (!own(ent)) continue;
      const b = ent.a || ent.p || ent.c || (ent.pts && ent.pts[0]) || (ent.faces && ent.faces[0] && ent.faces[0].pts[0]);
      if (!b) continue;
      const m = chunkFor(b.x, b.y, 0, 64);
      addEntity(m, ent, colourOf(ent, null));
     }
     return true;
    };
    /* the upload, in four steps a pump spreads over frames: the loose
       chunks, the definitions' faces, their lines, then the references */
    let defF = null, defE = null, defEP = null, defL = null, fstep = 0;
    const finish = () => {
    if (fstep === 0) { fstep = 1; for (const m of chunks) { growBox(m, m.ax, m.ay, m.az, 1, 1); upload(m); } return false; }
    /* the definitions' geometry, concatenated: each keeps its vertex offset */
    const cat = (key, stride) => {
      let total = 0;
      for (const d of defs.values()) if (d.n) total += d.mesh[key].n;
      if (!total) return null;
      const all = new Uint8Array(total * stride);
      let at = 0;
      for (const d of defs.values()) {
        const s = d.mesh[key];
        d.mesh['off' + key[0].toUpperCase()] = at;
        if (!d.n || !s.n) continue;
        all.set(new Uint8Array(s.buf, 0, s.n * stride), at * stride);
        at += s.n;
      }
      if (key === 'edges') defEP = partnerBuf(all, total);
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, all, gl.STATIC_DRAW);
      return b;
    };
    if (fstep === 1) { fstep = 2; defF = cat('faces', FSTRIDE); defE = cat('edges', LSTRIDE); return false; }
    if (fstep === 2) { fstep = 3; defL = cat('lines', LSTRIDE); return false; }
    for (const d of defs.values()) d.mesh.faces = d.mesh.edges = d.mesh.lines = null;
    /* instance records, grouped about anchors like the geometry, all in
       one buffer: a group is a byte offset and a count */
    const allRecs = sink(ISTRIDE, 1024);
    for (const d of defs.values()) {
      if (!d.recs.length) continue;
      let rec = d.recs;
      rec.sort((a, b) => a.t[0] - b.t[0]);
      let group = null;
      const m0 = d.mesh;
      const mr = isFinite(m0.bx0) ? Math.hypot(Math.max(Math.abs(m0.bx0 - m0.ax), Math.abs(m0.bx1 - m0.ax)),
        Math.max(Math.abs(m0.by0 - m0.ay), Math.abs(m0.by1 - m0.ay))) : 0;
      const flush = () => {
        if (!group || !group.n) return;
        inst.push({ mesh: d.mesh, off: group.first * ISTRIDE, n: group.n, ax: group.ax, ay: group.ay, az: group.az,
          /* the group's world box (every instance, placed) and the widest
             instance's radius: what a frame culls and dots by */
          box: group.box, r: group.r });
        group = null;
      };
      for (const r of rec) {
        if (group && (Math.abs(r.t[0] - group.ax) > ANCHOR_R || Math.abs(r.t[1] - group.ay) > ANCHOR_R || group.n >= 65536)) flush();
        if (!group) group = { ax: r.t[0], ay: r.t[1], az: r.t[2], s: allRecs, first: allRecs.n, n: 0, r: 0,
          box: { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity } };
        const sc = Math.max(Math.abs(r.m[0]) + Math.abs(r.m[1]), Math.abs(r.m[2]) + Math.abs(r.m[3]));
        const rr = mr * sc;
        if (rr > group.r) group.r = rr;
        const gb = group.box;
        gb.x0 = Math.min(gb.x0, r.t[0] - rr); gb.x1 = Math.max(gb.x1, r.t[0] + rr);
        gb.y0 = Math.min(gb.y0, r.t[1] - rr); gb.y1 = Math.max(gb.y1, r.t[1] + rr);
        gb.z0 = Math.min(gb.z0, r.t[2] + (isFinite(m0.bz0) ? m0.bz0 - m0.az : 0));
        gb.z1 = Math.max(gb.z1, r.t[2] + (isFinite(m0.bz1) ? m0.bz1 - m0.az : 0));
        const s = group.s;
        s.ensure(1); s.views();
        const o = s.n * ISTRIDE, f = o >> 2;
        s.n++;
        s.f32[f] = r.m[0]; s.f32[f + 1] = r.m[1]; s.f32[f + 2] = r.m[2]; s.f32[f + 3] = r.m[3];
        s.f32[f + 4] = r.t[0] - group.ax; s.f32[f + 5] = r.t[1] - group.ay; s.f32[f + 6] = r.t[2] - group.az;
        s.u8[o + 28] = r.col[0]; s.u8[o + 29] = r.col[1]; s.u8[o + 30] = r.col[2]; s.u8[o + 31] = 255;
        group.n++;
      }
      flush();
      d.recs = null;
    }
    let instVbo = null;
    if (allRecs.n) {
      instVbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, instVbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(allRecs.buf, 0, allRecs.n * ISTRIDE), gl.STATIC_DRAW);
    }
    /* the single identity instance the loose chunks draw with */
    const one = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, one);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1, 0, 0, 1, 0, 0, 0, 0]), gl.STATIC_DRAW);
    scene = { doc, rev, lsig, chunks, defs, inst, one, box, defF, defE, defEP, defL, instVbo, rest };
    return true;
    };
    return { step, finish };
  };
  /* the build in progress, pumped between frames */
  let buildJob = null, pumpRaf = 0;
  const SLICE_MS = 40;
  const pump = () => {
    pumpRaf = 0;
    if (!buildJob) return;
    if (!gl || lost) { buildJob = null; return; }
    let done = false;
    try { done = buildJob.step(performance.now() + SLICE_MS); }
    catch (e) { console.error('[gl3d] build', e); buildJob = null; return; }
    if (!done) { pumpRaf = requestAnimationFrame(pump); return; }
    const tf = performance.now();
    let landed = false;
    try { landed = buildJob.finish(); } catch (e) { console.error('[gl3d] build', e); freeScene(); buildJob = null; return; }
    lastFrame.finishMs = (lastFrame.finishMs || 0) + +(performance.now() - tf).toFixed(1);
    if (!landed) { pumpRaf = requestAnimationFrame(pump); return; }
    lastFrame.buildMs = +(performance.now() - buildJob.t0).toFixed(1);
    buildJob = null;
    if (N.render) N.render();
  };

  /* ---------------- render ---------------- */
  let lastFrame = { ms: 0 };
  const bindAnchor = (P, cam, ax, ay, az) =>
    gl.uniform3f(P.u.u_anchor, ax - cam.T.x, ay - cam.T.y, az - cam.T.z);
  const bindCam = (P, cam) => {
    const u = P.u;
    gl.uniform3f(u.u_r, cam.r[0], cam.r[1], cam.r[2]);
    gl.uniform3f(u.u_u, cam.u[0], cam.u[1], cam.u[2]);
    gl.uniform3f(u.u_d, cam.d[0], cam.d[1], cam.d[2]);
    gl.uniform1f(u.u_persp, cam.persp ? 1 : 0);
    gl.uniform1f(u.u_dist, cam.dist);
    gl.uniform1f(u.u_k, cam.persp ? cam.dist : 1);
    gl.uniform1f(u.u_cR, cam.cR);
    gl.uniform1f(u.u_sR, cam.sR);
    gl.uniform1f(u.u_scale, cam.scale);
    gl.uniform2f(u.u_c0, cam.c0x, cam.c0y);
    gl.uniform2f(u.u_size, cam.w, cam.h);
    gl.uniform1f(u.u_zA, cam.zA);
    gl.uniform1f(u.u_zB, cam.zB);
  };
  /* the instance attributes: the identity record (loose geometry) or a
     group's records at a byte offset into the one instance buffer */
  const bindInst = (P, vbo, off) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const a = P.a;
    const grp = off != null;
    gl.enableVertexAttribArray(a.a_m);
    gl.vertexAttribPointer(a.a_m, 4, gl.FLOAT, false, grp ? ISTRIDE : 0, grp ? off : 0);
    extInst.vertexAttribDivisorANGLE(a.a_m, 1);
    gl.enableVertexAttribArray(a.a_t);
    gl.vertexAttribPointer(a.a_t, 3, gl.FLOAT, false, grp ? ISTRIDE : 0, grp ? off + 16 : 16);
    extInst.vertexAttribDivisorANGLE(a.a_t, 1);
    if (grp) {
      gl.enableVertexAttribArray(a.a_icol);
      gl.vertexAttribPointer(a.a_icol, 4, gl.UNSIGNED_BYTE, true, ISTRIDE, off + 28);
      extInst.vertexAttribDivisorANGLE(a.a_icol, 1);
    } else {
      gl.disableVertexAttribArray(a.a_icol);
      gl.vertexAttrib4f(a.a_icol, 1, 1, 1, 1);
    }
  };
  /* the per-vertex attributes of a buffer, bound once for every draw from it */
  const bindFaceVerts = (P, vbo) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const a = P.a;
    vertexAttr(a.a_pos, 3, gl.FLOAT, false, FSTRIDE, 0);
    vertexAttr(a.a_nrm, 3, gl.FLOAT, false, FSTRIDE, 12);
    vertexAttr(a.a_col, 4, gl.UNSIGNED_BYTE, true, FSTRIDE, 24);
  };
  const bindLineVerts = (P, vbo, pvbo) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const a = P.a;
    vertexAttr(a.a_pos, 3, gl.FLOAT, false, LSTRIDE, 0);
    vertexAttr(a.a_col, 4, gl.UNSIGNED_BYTE, true, LSTRIDE, 12);
    /* the partner positions ride a buffer of their own, body edges only */
    if (a.a_par === undefined || a.a_par < 0) return;
    if (pvbo) { gl.bindBuffer(gl.ARRAY_BUFFER, pvbo); vertexAttr(a.a_par, 3, gl.FLOAT, false, 12, 0); }
    else { gl.disableVertexAttribArray(a.a_par); gl.vertexAttrib3f(a.a_par, 0, 0, 0); }
  };
  /* a per-vertex attribute: enabled, pointed, and its divisor cleared —
     the same location serves an instance attribute in the other program */
  const vertexAttr = (loc, size, type, norm, stride, off) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, type, norm, stride, off);
    extInst.vertexAttribDivisorANGLE(loc, 0);
  };
  /* every attribute array off: WebGL validates each ENABLED array's
     buffer against the draw whatever the program reads, so a stale one
     from the other program would fail a draw or read the wrong buffer */
  let maxAttribs = 0;
  const resetAttribs = () => {
    if (!maxAttribs) maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) | 0;
    for (let i = 0; i < maxAttribs; i++) { gl.disableVertexAttribArray(i); extInst.vertexAttribDivisorANGLE(i, 0); }
  };
  const drawDots = (P, it) => {
    gl.drawArrays(gl.POINTS, it.off / ISTRIDE, it.n);
  };

  /* the camera of this frame, from the engine's view state, the target's
     pixel folded in doubles */
  const cameraNow = (w, h) => {
    const v = N.view3d, vp = N.viewport;
    const cA = Math.cos(v.azimuth), sA = Math.sin(v.azimuth);
    const cE = Math.cos(v.elevation), sE = Math.sin(v.elevation);
    const cR = Math.cos(v.roll || 0), sR = Math.sin(v.roll || 0);
    const d = [sA * cE, -cA * cE, sE], r = [cA, sA, 0], u = [-sA * sE, cA * sE, cE];
    const T = { x: v.target.x, y: v.target.y, z: v.target.z || 0 };
    const rT = r[0] * T.x + r[1] * T.y + r[2] * T.z;
    const uT = u[0] * T.x + u[1] * T.y + u[2] * T.z;
    const c0x = (cR * rT - sR * uT) * vp.scale + vp.tx;
    const c0y = (sR * rT + cR * uT) * vp.scale + vp.ty;
    const dist = v.distance > 0 ? v.distance : 1000;
    const cam = { T, d, r, u, cR, sR, scale: vp.scale, c0x, c0y, w, h, persp: !!v.persp, dist, zA: 1, zB: 0 };
    /* the depth range: the scene box's corners along d, from the target */
    const b = scene.box;
    let D0 = Infinity, D1 = -Infinity;
    if (isFinite(b.x0)) {
      for (let i = 0; i < 8; i++) {
        const x = (i & 1 ? b.x1 : b.x0) - T.x, y = (i & 2 ? b.y1 : b.y0) - T.y, z = (i & 4 ? b.z1 : b.z0) - T.z;
        const D = d[0] * x + d[1] * y + d[2] * z;
        if (D < D0) D0 = D; if (D > D1) D1 = D;
      }
    } else { D0 = -1; D1 = 1; }
    const pad = Math.max((D1 - D0) * 0.02, 1e-6);
    D0 -= pad; D1 += pad;
    if (!cam.persp) {
      /* z_ndc = (D1 − D) / (D1 − D0) · 2 − 1: nearer (larger D) is smaller */
      cam.zA = -2 / (D1 - D0);
      cam.zB = 2 * D1 / (D1 - D0) - 1;
    } else {
      const near = Math.max(dist - D1, dist * 1e-4), far = Math.max(dist - D0, near * 1.001);
      cam.zA = (far + near) / (far - near);
      cam.zB = -2 * far * near / (far - near);
    }
    /* the headlight: mostly from the eye, a little over the right shoulder
       and from the sky — the engine's own faceShade */
    const lx = 0.75 * d[0] + 0.30 * r[0], ly = 0.75 * d[1] + 0.30 * r[1], lz = 0.75 * d[2] + 0.30 * r[2] + 0.55;
    const ll = Math.hypot(lx, ly, lz) || 1;
    cam.light = [lx / ll, ly / ll, lz / ll];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    cam.eye = [d[0] / dl, d[1] / dl, d[2] / dl];      /* toward the viewer, for the gloss */
    /* Conceptual's light: over the left shoulder and a little above the
       eye — the engine's goochLight */
    const gx = 0.86 * d[0] - 0.36 * r[0] + 0.36 * u[0], gy = 0.86 * d[1] - 0.36 * r[1] + 0.36 * u[1], gz = 0.86 * d[2] + 0.36 * u[2];
    const gl2 = Math.hypot(gx, gy, gz) || 1;
    cam.lightG = [gx / gl2, gy / gl2, gz / gl2];
    /* Shades of Gray's light: the eye and the sky, no shoulder — the
       engine's grayLight */
    const yx = 0.75 * d[0], yy = 0.75 * d[1], yz = 0.75 * d[2] + 0.55;
    const yl = Math.hypot(yx, yy, yz) || 1;
    cam.lightY = [yx / yl, yy / yl, yz / yl];
    return cam;
  };

  /* where a world box lands on screen this frame: its eight corners through
     the same projection the shader runs, in doubles */
  const screenBox = (cam, b) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const qx = (i & 1 ? b.x1 : b.x0) - cam.T.x, qy = (i & 2 ? b.y1 : b.y0) - cam.T.y, qz = (i & 4 ? b.z1 : b.z0) - cam.T.z;
      const U = cam.r[0] * qx + cam.r[1] * qy + cam.r[2] * qz;
      const V = cam.u[0] * qx + cam.u[1] * qy + cam.u[2] * qz;
      const D = cam.d[0] * qx + cam.d[1] * qy + cam.d[2] * qz;
      const wv = cam.persp ? Math.max(cam.dist - D, cam.dist * 1e-3) : 1;
      const k = (cam.persp ? cam.dist : 1) / wv * cam.scale;
      const x = (cam.cR * U - cam.sR * V) * k + cam.c0x, y = (cam.sR * U + cam.cR * V) * k + cam.c0y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
  };
  const DOT_PX = 1.5;
  /* an instance group this frame: 'skip' (off screen), 'dot' (under a
     pixel and a half: one point per instance, one call), or 'draw' */
  const groupMode = (cam, it) => {
    const sb = screenBox(cam, it.box);
    if (sb.x1 < -8 || sb.x0 > cam.w + 8 || sb.y1 < -8 || sb.y0 > cam.h + 8) return 'skip';
    return (!cam.persp && it.r * 2 * cam.scale < DOT_PX) ? 'dot' : 'draw';
  };
  /* the instance records read as vertices — a_t the position, the
     instance colour the colour, the placement the identity — for the
     references drawn as a point each */
  const bindDotVerts = (P) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, scene.instVbo);
    const a = P.a;
    gl.disableVertexAttribArray(a.a_m);
    gl.vertexAttrib4f(a.a_m, 1, 0, 0, 1);
    gl.disableVertexAttribArray(a.a_t);
    gl.vertexAttrib3f(a.a_t, 0, 0, 0);
    gl.disableVertexAttribArray(a.a_icol);
    gl.vertexAttrib4f(a.a_icol, 1, 1, 1, 1);
    vertexAttr(a.a_pos, 3, gl.FLOAT, false, ISTRIDE, 16);
    vertexAttr(a.a_col, 4, gl.UNSIGNED_BYTE, true, ISTRIDE, 28);
  };
  /* profiling (N.gl3d.profile = true): each phase synced by a 1px read,
     so the GPU's own time lands against the phase that spent it */
  const prof = { on: false, t: 0, marks: null };
  const mark = (name) => {
    if (!prof.on) return;
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    const t = performance.now();
    prof.marks[name] = +(t - prof.t).toFixed(1);
    prof.t = t;
  };
  const render = (w, h, dpr) => {
    prof.on = !!N.gl3d.profile;
    if (prof.on) { prof.marks = {}; prof.t = performance.now(); }
    const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    gl.viewport(0, 0, pw, ph);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    const cam = cameraNow(w, h);
    for (const it of scene.inst) it.mode = groupMode(cam, it);
    const vs = N.vstyleRender || { fills: false, edges: true, gray: false, alpha: 1, hidden: false };
    const bg = rgbOf(N.activeBg ? N.activeBg() : '#212830');
    const fills = !!vs.fills;
    /* faces first, pushed back a hair so their edges win the depth test */
    if (fills) {
      const P = progFace;
      gl.useProgram(P.p);
      resetAttribs();
      const L = vs.gray ? cam.lightY : vs.gooch ? cam.lightG : cam.light;
      gl.uniform3f(P.u.u_light, L[0], L[1], L[2]);
      gl.uniform3f(P.u.u_eye, cam.eye[0], cam.eye[1], cam.eye[2]);
      gl.uniform1f(P.u.u_gooch, vs.gooch ? 1 : 0);
      gl.uniform1f(P.u.u_hidden, vs.hidden ? 1 : 0);
      gl.uniform1f(P.u.u_gray, vs.gray ? 1 : 0);
      gl.uniform1f(P.u.u_alpha, vs.alpha < 1 ? vs.alpha : 1);
      gl.uniform3f(P.u.u_bg, bg[0] / 255, bg[1] / 255, bg[2] / 255);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 2);
      if (vs.alpha < 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
      else { gl.disable(gl.BLEND); gl.depthMask(true); }
      bindCam(P, cam);
      bindInst(P, scene.one, null);
      for (const m of scene.chunks) {
        if (!m.nF) continue;
        bindAnchor(P, cam, m.ax, m.ay, m.az);
        bindFaceVerts(P, m.vboF);
        extInst.drawArraysInstancedANGLE(gl.TRIANGLES, 0, m.nF, 1);
      }
      if (scene.defF) {
        bindFaceVerts(P, scene.defF);
        for (const it of scene.inst) {
          if (!it.mesh.nF || it.mode !== 'draw') continue;
          bindAnchor(P, cam, it.ax, it.ay, it.az);
          bindInst(P, scene.instVbo, it.off);
          extInst.drawArraysInstancedANGLE(gl.TRIANGLES, it.mesh.offF, it.mesh.nF, it.n);
        }
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      mark('faces');
    }
    const P = progLine;
    gl.useProgram(P.p);
    resetAttribs();
    gl.uniform1f(P.u.u_gray, vs.gray ? 1 : 0);
    gl.uniform3f(P.u.u_sk, 0, 0, 0);
    /* isolines show in a wireframe and in Hidden, never on shaded faces */
    gl.uniform1f(P.u.u_isoOff, fills && !vs.hidden ? 1 : 0);
    const edges = !fills || vs.edges;
    bindCam(P, cam);
    /* one kind of line over the loose chunks, then over every reference
       group from the shared definition buffer */
    const drawSet = (vboKey, nKey, offKey, defVbo, pKey, defP) => {
      bindInst(P, scene.one, null);
      for (const m of scene.chunks) {
        if (!m[nKey] || !m[vboKey]) continue;
        bindAnchor(P, cam, m.ax, m.ay, m.az);
        bindLineVerts(P, m[vboKey], pKey ? m[pKey] : null);
        extInst.drawArraysInstancedANGLE(gl.LINES, 0, m[nKey], 1);
      }
      if (!defVbo) return;
      bindLineVerts(P, defVbo, defP || null);
      for (const it of scene.inst) {
        if (it.mode !== 'draw' || !it.mesh[nKey]) continue;
        bindAnchor(P, cam, it.ax, it.ay, it.az);
        bindInst(P, scene.instVbo, it.off);
        extInst.drawArraysInstancedANGLE(gl.LINES, it.mesh[offKey], it.mesh[nKey], it.n);
      }
    };
    /* loose lines in their own colour; body edges dimmed against the
       shaded faces they outline, full in a wireframe */
    gl.uniform1f(P.u.u_dim, 1);
    drawSet('vboL', 'nL', 'offL', scene.defL);
    mark('lines');
    if (edges) {
      gl.uniform1f(P.u.u_dim, fills && !vs.hidden && !vs.gooch && !vs.gray ? 0.75 : 1);
      if (vs.gray) gl.uniform1f(P.u.u_gray, 2);
      if (vs.sketch) {
        /* Sketchy: the edges twice, each pass overshooting and wobbling
           its own way — the engine's SK_EXT / SK_JIT / SK_PASSES */
        for (let k = 0; k < 2; k++) {
          gl.uniform3f(P.u.u_sk, 6, 1.5, k);
          drawSet('vboE', 'nE', 'offE', scene.defE, 'vboEP', scene.defEP);
        }
        gl.uniform3f(P.u.u_sk, 0, 0, 0);
      } else drawSet('vboE', 'nE', 'offE', scene.defE);
      if (vs.gray) gl.uniform1f(P.u.u_gray, 1);
      mark('edges');
    }
    /* the references under a pixel and a half: a point each */
    gl.uniform1f(P.u.u_dim, 1);
    let nd = 0, ng = 0;
    if (scene.instVbo) {
      bindDotVerts(P);
      for (const it of scene.inst) {
        if (it.mode === 'draw') ng++;
        if (it.mode !== 'dot') continue;
        nd++;
        bindAnchor(P, cam, it.ax, it.ay, it.az);
        drawDots(P, it);
      }
    }
    if (prof.on) { prof.marks.dotGroups = nd; prof.marks.drawGroups = ng; }
    mark('dots');
    resetAttribs();
  };

  /* ---------------- public surface ---------------- */
  const enabled = () => {
    if (N.settings && (N.settings.gl3d === false || N.settings.gl3d === 'off')) return false;
    /* the 2D GL path's probe is the one verdict on this GPU */
    if (N.glscene && typeof N.glscene.active === 'function' && !N.glscene.active()) return false;
    return true;
  };
  const live = () => !!(scene && gl && !lost && N.view3d && N.view3d.active && !N.paper);
  N.gl3d = {
    /* keep the scene at the document's pace; called by the engine before a
       3D pass. Returns true when this layer will draw the frame. */
    sync(doc, rev, lsig) {
      if (!doc || !N.view3d || !N.view3d.active || N.paper || !enabled()) { freeScene(); buildJob = null; return false; }
      if (!ensureGL()) return false;
      if (doc.loading) { freeScene(); buildJob = null; return false; }
      if (scene && scene.doc === doc && scene.rev === rev && scene.lsig === lsig) {
        if (buildJob) buildJob = null;
        return true;
      }
      if (!buildJob || buildJob.doc !== doc || buildJob.rev !== rev || buildJob.lsig !== lsig) {
        try { buildJob = Object.assign(build(doc, rev, lsig), { doc, rev, lsig, t0: performance.now() }); }
        catch (e) { console.error('[gl3d] build', e); buildJob = null; return false; }
      }
      /* a small drawing is whole within this call; a heavy one carries on
         between frames, and the CPU painter draws until it lands */
      let done = false;
      try { done = buildJob.step(performance.now() + 12); }
      catch (e) { console.error('[gl3d] build', e); buildJob = null; return false; }
      if (done) {
        /* a small drawing uploads whole here; a heavy one's upload goes to the pump too */
        let landed = false;
        try { while (!(landed = buildJob.finish()) && performance.now() - buildJob.t0 < 25) { /* next step */ } }
        catch (e) { console.error('[gl3d] build', e); freeScene(); buildJob = null; return false; }
        if (landed) {
          lastFrame.buildMs = +(performance.now() - buildJob.t0).toFixed(1);
          buildJob = null;
          return true;
        }
      }
      if (!pumpRaf) pumpRaf = requestAnimationFrame(pump);
      return false;
    },
    live,
    owner: () => (scene ? owns(scene.doc) : null),
    ownsType,
    /* the entities left to the 2D pass, in document order */
    remainder: () => (scene ? scene.rest : null),
    /* of a reference the GPU draws only part of: the children it leaves,
       placed, remembered for the scene's life — materialising a block's
       whole tree on every frame to draw its few labels was the frame */
    restChildren(ent, doc) {
      if (!scene || scene.doc !== doc) return N.geom.insertEntities(ent, doc);
      let hit = restCache.get(ent);
      if (hit && hit.rev === scene.rev && hit.lsig === scene.lsig) return hit.kids;
      const kids = [];
      for (const c of N.geom.insertEntities(ent, doc)) if (!ownsType(c)) kids.push(c);
      restCache.set(ent, { rev: scene.rev, lsig: scene.lsig, kids });
      return kids;
    },
    /* the frame: rendered, then laid into the 2D canvas under its remainder */
    compose(ctx2d, w, h, dpr) {
      if (!live()) return false;
      const t0 = performance.now();
      render(w, h, dpr);
      ctx2d.save();
      ctx2d.setTransform(1, 0, 0, 1, 0, 0);
      ctx2d.drawImage(cv, 0, 0);
      ctx2d.restore();
      lastFrame.ms = +(performance.now() - t0).toFixed(2);
      return true;
    },
    status: () => ({
      live: live(), enabled: enabled(), lost, failed, building: !!buildJob,
      chunks: scene ? scene.chunks.length : 0, defs: scene ? scene.defs.size : 0,
      instances: scene ? scene.inst.reduce((s, it) => s + it.n, 0) : 0,
      faceVerts: scene ? scene.chunks.reduce((s, m) => s + m.nF, 0) : 0,
      lineVerts: scene ? scene.chunks.reduce((s, m) => s + m.nE + m.nL, 0) : 0,
      lastFrame,
      profile: prof.marks,
      renderer: gl ? (() => { const d = gl.getExtension('WEBGL_debug_renderer_info'); return String(d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); })() : 'none'
    }),
    dispose() { freeScene(); }
  };
})();
