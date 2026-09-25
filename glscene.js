/* pixelbay CAD — glscene.js (GL-PLAN.md phase 3: completeness)
 * WebGL1 + ANGLE_instanced_arrays renderer under the 2D engine.
 *
 * Phase 2 gave this module the strokes: a startup probe (real GPU by name +
 * a readPixels-synced micro-benchmark) decides the default; when live, the
 * engine's scene passes skip what owner() claims and the GL frame joins the
 * 2D canvas so QA reads one picture. Phase 3 adds, on top of that contract:
 *
 * - PRESENTATION (the 4.6ms/frame webglâ†’2d drawImage sync is gone from
 *   gestures): the GL canvas now sits in the DOM between #canvas and
 *   #overlay-canvas. Gesture frames present GL directly — geometry plus the
 *   2D-owned remainder (the engine's scene bitmap) drawn BY GL as a textured
 *   quad on top, so layering matches the settled composite. When the view
 *   settles, compose() draws the GL frame INTO the 2D canvas exactly as in
 *   phase 2 (getImageData/QA/capturePage read the settled state) and the DOM
 *   canvas hides. The sync cost is paid once per settle, never per notch.
 * - LAYER PALETTE: per-vertex layer indices sample a 1024-wide RGBA texture
 *   in the FRAGMENT shader (fragment sampling is universal; it is VERTEX
 *   texture fetch that is spotty on old GPUs, which is why the palette is
 *   read in the FS and the VS only computes UVs). Layer color and on/frozen
 *   changes update the texture only — no chunk rebuild. Ownership-shaping
 *   layer fields (locked/lt/lw, the table's id order) still rebuild.
 * - IN-STREAM FILLS: SOLID hatches and '@bg' wipeouts triangulate (ear
 *   clipping, embedded below) into the same doc-ordered chunks as the
 *   strokes. Ordering across primitives rides a depth buffer: every stream
 *   run carries a z group (bumped at lineâ†”fill transitions), opaque geometry
 *   draws in pass 1 with depth writes (GEQUAL: later covers earlier, in any
 *   draw order), translucent fills draw in pass 2 depth-tested against the
 *   opaque picture and blended in stream order. '@bg' fills take the theme
 *   background from a uniform, so a theme change costs nothing. Defs that
 *   contain fills are never instanced (an instanced group draws at one
 *   stream position — a fill there would mask out of order); they bake.
 *   A '@bg' candidate that would cover EARLIER 2D-owned content (text under
 *   a wipeout) is demoted to the 2D layer, where doc order still rules.
 * - EDIT HINTS: the docOps wraps now carry ids — addEntity/deleteEntities
 *   know theirs, pushUndo captures the selection when the active tool's
 *   commit provably touches only selection+wrapped ops (move/copy/rotate/…),
 *   and the Nasj.geom mutators contribute the ids they touch while a hint
 *   window is armed. A fully-hinted cycle diffs only those ids; anything
 *   else (undo, grips, property edits, unknown reasons) takes the full
 *   fingerprint sweep exactly as before. Layer-panel cycles (reason
 *   'layers') skip the sweep — the palette is the whole change.
 *
 * - BODIES: the app's polyhedral 'solid' (a DWG 3DSOLID/REGION/BODY, a MESH,
 *   an EXTRUDE) joins the line stream. A plan view strokes a body's visible
 *   face edges — each shared edge once, hidden-edge bits honoured — and its
 *   wires, and fills nothing (faces are painted only by a shaded 3D style,
 *   where owner() is null anyway). Definitions holding bodies are pure
 *   again, so their references bake or instance like any other.
 *
 * Still 2D-owned: text/attdef/arctext, images, PATTERN hatches (the engine
 * strokes their line families procedurally at draw time), gradients, dims/
 * leaders/tables, points, lights, xlines, dashed linetypes (the dash truth
 * is a screen-space pattern table with LTSCALE semantics — left to the 2D
 * layer this phase, deliberately), wide polylines, poché, locked/transparent
 * strokes, xrefs, clipped references. Paper space, 3D and split viewports
 * bail out.
 *
 * Timing discipline: nothing here paces by gl.finish() — ANGLE lies. The
 * probe syncs each benchmark frame with a 1px readPixels.
 */
(() => {
  'use strict';
  const Nasj = window.Nasj = window.Nasj || {};
  const TAU = Math.PI * 2;

  const MODE_KEY = 'pixelbay.glscene';   /* 'auto' | 'on' | 'off' */
  /* phase 5 bumped the key: verdicts now carry msNet (sync overhead out)
     and the quality tier — old caches re-probe once, ~100ms at idle */
  const PROBE_KEY = 'pixelbay.glprobe2'; /* {renderer, ok, ms, msNet, tier, reason} */
  const BAKE_MAX_SEGS = 200;             /* defs under this bake, never instance */
  const BENCH_SEGS = 100000;
  const BENCH_PASS_MS = 25;              /* keeps Intel HD, rejects pathology */
  /* delta chunks fold back into a fresh build once they carry this much */
  const DELTA_FOLD_IDS = 4000;
  const DELTA_FOLD_SEGS = 131072;
  const HINT_CAP = 4000;                 /* hinted ids beyond this: full sweep */
  const SEL_HATCH_CAP = 500;             /* selected hatches beyond this stay GL */

  /* phase 5 (weak-device parity): the probe grades the GPU by its NET
     benchmark ms — the synced 100k-segment frame minus a measured empty
     synced frame, so a driver whose readback roundtrip is expensive still
     grades on DRAW cost. Measured on this bench: RTX 4070 Ti 1.4ms gross /
     1.3 net (tier A), Intel UHD 770 12.2 gross / 11.9 net (tier B; its
     tier-B numbers meet every 60Hz-class gate). Tier A runs the
     full-fidelity build; B coarsens curve tessellation and carries
     decimated far-zoom companions; C additionally presents every 2nd
     gesture event. The gross â‰¥ BENCH_PASS_MS reject to 2D is unchanged. */
  const TIER_A_MS = 3;                   /* net ms — RTX-class: full fidelity */
  const TIER_B_MS = 14;                  /* net ms — UHD-770-class integrated */
  const TESS_MUL = { A: 1, B: 2, C: 4 }; /* chord-budget multiplier per tier */
  const DECIM_K = 4;                     /* companions keep every 4th segment */
  const DECIM_MIN = 2048;                /* segments below this: no companion */
  const DECIM_PX = 0.5;                  /* px per segment: denser = decimate */
  const GOV_GESTURE_MS = 120;            /* presents this close = one gesture */
  const GOV_SYNC_EVERY = 16;             /* true-synced sample cadence */
  const GOV_STRIKES = 3;                 /* budget misses in a row: step down */
  /* a scene lighter than the startup probe's own bench cannot grade a GPU */
  const REBENCH_MIN_SEGS = BENCH_SEGS * 2;
  let overdrawN = 1;                     /* throttle harness: NÃ— the scene */
  const gov = {
    eff: null,                           /* session step-down tier (null = probe's) */
    budget: 1000 / 60,                   /* display-derived frame budget (ms) */
    budgetKnown: false,                  /* the refresh sampler has answered */
    ema: 0, sync: 0,                     /* cheap EMA + last true-synced ms */
    cpuStrikes: 0, syncStrikes: 0,
    presents: 0, lastT: 0, skipTick: false, heldFrames: 0,
    stepDowns: 0, log: [], upTimer: 0,
    rb: null                             /* the sliced re-benchmark's state */
  };
  const tierOf = (ms) =>
    (ms >= 0 && ms <= TIER_A_MS) ? 'A' : (ms <= TIER_B_MS ? 'B' : 'C');

  /* curve tolerance (GL-PLAN): chord error keyed to entity size — see the
     PoC notes: the sagitta budget is ABSOLUTE (dense span / 200k, set per
     build) and the count follows each curve's radius, 8..256 per turn. */
  let tessTol = 0;
  const nFullFor = (r) => {
    if (!(r > 0)) return 8;
    const t = tessTol > 0 ? tessTol : r / 8000;
    if (t >= r) return 8;
    return Math.min(256, Math.max(8, Math.ceil(Math.PI / Math.acos(1 - t / r))));
  };
  /* SUB-PIXEL COVERAGE. GL_LINES lights at least one whole fragment however
     short the segment is, so a drawing full of edges that project to nothing
     (the vertical edges of a 3D solid, seen from the top) comes out speckled
     — the industry standard draws those as nothing at all. The fix is the rasterizer's own
     rule: ink in proportion to the coverage a stroke actually has. Every LINE
     vertex carries the world length of the RUN it belongs to — the connected
     chain, not the chord, so a finely tessellated curve keeps full ink and
     only a whole stroke smaller than a pixel fades — log-quantized into the
     one byte the line stream never used (a line's vertex alpha was always
     255; the fill streams keep theirs, and draw with uCv off). The vertex
     shader turns it into screen length and modulates alpha. Blending sums a
     DENSE cluster of such edges back into a solid tone, which is exactly
     what a mass of sub-pixel geometry does under anti-aliasing. */
  const COV_LO = -30;                    /* log2(world len) at code 1 */
  const COV_SPAN = 64;                   /* log2 decades across 254 steps */
  const covCode = (len) => {
    if (!(len > 0)) return 1;
    const t = (Math.log(len) / Math.LN2 - COV_LO) / COV_SPAN;
    return Math.max(1, Math.min(255, Math.round(t * 254) + 1));
  };
  /* a uniform scale on the geometry is a constant OFFSET in code space */
  const covShift = (k) => (k > 0
    ? Math.round((Math.log(k) / Math.LN2) / COV_SPAN * 254) : 0);
  const ANCHOR_R = 16384;                /* f32-relative precision radius */
  const CHUNK_VERTS = 262144;            /* per-chunk vertex budget (all kinds) */
  const VSTRIDE = 20;  /* chunk vert: xy f32, rgba u8, liC/liV1/liV2/z u16 */
  const MSTRIDE = 16;  /* f32 def-mesh vert: xy f32, rgba, liC/liV1 u16 */
  const QSTRIDE = 12;  /* quantized def-mesh vert: xy u16, rgba, liC/liV1 u16 */
  const ISTRIDE = 32;  /* instance: 2x3 f32, rgba u8, il u16, pad u16 */
  const PALW = 1024;                     /* palette texture width */
  const LI_MAX = 16383;                  /* 14-bit layer index; 2 flag bits */
  const F_BAKED = 0, F_PAL = 1, F_BG = 2, F_BYBLOCK = 3;   /* liC>>14 */
  const Z_CAP = 60000;                   /* stream z groups clamp here */
  const Z_DELTA_TOP = 65000;             /* delta appends live above the stream */

  let glCanvas = null, gl = null, extInst = null, extVao = null;
  let progChunk = null, progInst = null, progQuad = null, lwRange = null;
  let uni = null;                        /* cached uniform locations */
  let palTex = null, palRows = 1;
  let remTex = null, remGen = -1, quadVbo = null;
  let remLast = null;   /* last-good remainder params (texture already up) */
  let remHalfCv = null; /* phase 5: half-res upload staging below tier A */
  let domShown = false;
  let marqOwned = false;                 /* the DOM canvas carries a marquee tint */
  let marqKey = '';                      /* rect+view+scene of the tint on it */
  let scene = null;
  /* ============================================================ *
   * ONE SCENE PER DRAWING, AS MANY AS THE BUDGET HOLDS.
   *
   * This module used to keep exactly one scene: the live document's. A tab
   * click therefore threw it away and built the incoming drawing's from
   * nothing — 40-55ms of frozen window for a light drawing (built
   * synchronously) and seconds of sliced rebuild for a heavy one, every
   * time, both ways. A drawing switched away from and back has not changed;
   * its buffers are still on the GPU and still correct. So they stay, keyed
   * by the document, and a switch is a pointer swap.
   *
   * THE BUDGET. GPU memory is not ours to fill: BLOCKS.dwg's buffers are
   * 120MB and a WebGL context on ANGLE shares its device with the
   * compositor, the browser's own textures and whatever else the machine is
   * running. 256MB is two drawings of that weight resident with room to
   * build a third before the oldest is asked to leave — enough that the
   * pair a draughtsman actually works between (a plan and its details) is
   * always instant, and small enough that a weak integrated GPU with a
   * couple of hundred megabytes of shared memory is never pushed into
   * swapping or a lost context. Eviction is least-recently-shown first and
   * never the drawing on screen; an evicted drawing rebuilds on its next
   * activation, sliced behind the same progress affordance an open uses.
   * ============================================================ */
  const GL_BYTE_CAP = 256 * 1024 * 1024;
  const scenes = new Map();              /* doc -> scene; insertion order = LRU */
  let sceneBytes = 0;
  let sceneUse = 0;
  let evicted = 0;                       /* how many scenes the cap has taken */
  const sceneBytesOf = (sc) => ((sc && sc.stats && sc.stats.bytes &&
    sc.stats.bytes.total) || 0);
  let buildJob = null;
  let dirty = false;
  let patchGen = 0;
  let debugOn = false;
  let hooked = null;                     /* legacy follow() hook */
  let lastPatch = null;                  /* {ms, kind, ...} */
  let lastFrame = null;                  /* {ms, mode} */
  let lastRender = null;                 /* {decimDraws, tier, overdraw} */
  /* phase 4 (the drawing hang): true when the LAST consumed cycle was
     absorbed whole into GL — every touched entity GL-owned (a pencil
     stroke, an erase of GL geometry) or nothing entity-shaping at all —
     so the 2D remainder bitmap is byte-identical and the engine may adopt
     the new revision instead of restroking it. One-shot: the engine takes
     (and clears) it once per render. */
  let cycleAbsorbed = false;
  /* and, separately: true when the last consumed cycle provably moved NO
     geometry in place (adds and deletes only, or nothing) — the engine's
     spatial index was already patched by the op wraps, so the commit's
     trailing bare emit need not re-cold it (measured 553ms on the next
     osnap move). Also one-shot. */
  let cycleGeomClean = false;
  let depthBits = 0;

  /* the pending edit cycle, consumed at each sync (task-4 hints) */
  const pend = {
    full: false, unhinted: false, edit: false, noent: false,
    armed: false, ids: new Set(),
    /* a commit that provably translated EVERY entity by one (dx,dy) —
       MOVE with everything selected, or the undo/redo of one. The sweep
       for it is an anchor shift, never a rebuild (see xlateSweep). */
    xlate: null,
    /* the commit flows render BEFORE they emit 'nasj:doc' — the sweep has
       already consumed their signals by the time the bare event lands. A
       sequence pair tells a consumed event from a fresh one, so the event
       degrades to a cheap skip instead of a second full sweep. */
    sigSeq: 0, sweptSeq: -1
  };
  const pendReset = () => {
    pend.full = false; pend.unhinted = false; pend.edit = false;
    pend.noent = false; pend.armed = false; pend.ids.clear();
    pend.xlate = null;
    pend.sweptSeq = pend.sigSeq;
  };

  /* ---------------- mode & verdict ---------------- */
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* session */ } };

  const normMode = (v) => {
    if (v === true || v === 'on' || v === '1' || v === 1) return 'on';
    if (v === false || v === 'off' || v === '0' || v === 0) return 'off';
    return v === 'auto' ? 'auto' : null;
  };
  const mode = () => {
    if (lsGet('nasjiGL') === '1') return 'on';          /* PoC's force flag */
    const s = Nasj.settings && normMode(Nasj.settings.glscene);
    if (s) return s;
    return normMode(lsGet(MODE_KEY)) || 'auto';
  };

  let verdict = null;                    /* {ok, renderer, ms, reason, cached} */

  /* the probe: its own throwaway context, never the live underlay. Software
     renderers are rejected by name; anything real then draws ~100k segments
     a few frames, each frame synced by a 1px readPixels (gl.finish lies on
     ANGLE — 20 fake 0.2ms frames and a 341ms settle, measured in phase 1). */
  const runProbe = () => {
    const out = { ok: false, renderer: 'none', ms: -1, msNet: -1, tier: null, reason: '', cached: false };
    let cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 256;
    let g = null;
    try {
      g = cv.getContext('webgl', { powerPreference: 'high-performance', antialias: true });
    } catch (e) { g = null; }
    if (!g) { out.reason = 'no-webgl'; return out; }
    if (!g.getExtension('ANGLE_instanced_arrays')) {
      out.reason = 'no-instancing';
      return out;
    }
    const dbg = g.getExtension('WEBGL_debug_renderer_info');
    out.renderer = String(dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER));
    if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(out.renderer)) {
      out.reason = 'software-renderer';
      return out;
    }
    /* cached verdict, keyed by the renderer string: re-probe on GPU change */
    try {
      const c = JSON.parse(lsGet(PROBE_KEY) || 'null');
      if (c && c.renderer === out.renderer && typeof c.ok === 'boolean') {
        out.ok = c.ok;
        out.ms = c.ms;
        out.msNet = typeof c.msNet === 'number' ? c.msNet : c.ms;
        out.reason = c.reason || (c.ok ? 'benchmark' : 'benchmark-slow');
        out.tier = c.ok ? (c.tier || tierOf(out.msNet)) : null;
        out.cached = true;
        return out;
      }
    } catch (e) { /* re-probe */ }
    try {
      const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
      const fs = 'precision mediump float;void main(){gl_FragColor=vec4(1.,1.,1.,1.);}';
      const sh = (t, src) => {
        const s = g.createShader(t);
        g.shaderSource(s, src);
        g.compileShader(s);
        return s;
      };
      const pr = g.createProgram();
      g.attachShader(pr, sh(g.VERTEX_SHADER, vs));
      g.attachShader(pr, sh(g.FRAGMENT_SHADER, fs));
      g.bindAttribLocation(pr, 0, 'p');
      g.linkProgram(pr);
      if (!g.getProgramParameter(pr, g.LINK_STATUS)) { out.reason = 'link-failed'; return out; }
      g.useProgram(pr);
      const n = BENCH_SEGS * 2;
      const v = new Float32Array(n * 2);
      let seed = 1234567;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
      for (let i = 0; i < n * 2; i++) v[i] = rnd();
      const vbo = g.createBuffer();
      g.bindBuffer(g.ARRAY_BUFFER, vbo);
      g.bufferData(g.ARRAY_BUFFER, v, g.STATIC_DRAW);
      g.enableVertexAttribArray(0);
      g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
      g.viewport(0, 0, 256, 256);
      const px = new Uint8Array(4);
      /* phase 5: discrete GPUs idle at a fraction of their clock — the
         same RTX probed 1.4, 3.8 and 7.5ms across runs depending on how
         awake it was. Real bench frames spin for ~250ms so the clocks
         ramp, then the FASTEST timed frame grades: the sustained-clock
         capability is what a session actually gets. */
      const warmEnd = performance.now() + 250;
      while (performance.now() < warmEnd) {
        g.clear(g.COLOR_BUFFER_BIT);
        g.drawArrays(g.LINES, 0, n);
        g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px);   /* true sync */
      }
      /* then time until the minimum stops improving (â‰¤24 frames): a ramp
         tail or a compositor beat cannot pick the grade */
      let best = Infinity, since = 0, tf = 0;
      while (tf++ < 24 && since < 6) {
        const t0 = performance.now();
        g.clear(g.COLOR_BUFFER_BIT);
        g.drawArrays(g.LINES, 0, n);
        g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px);
        const dt = performance.now() - t0;
        if (dt < best - 0.05) { best = dt; since = 0; } else since++;
      }
      out.ms = best;
      /* the empty synced frame: the readPixels roundtrip itself, subtracted
         so the tier grade reads DRAW cost, not ANGLE's constant */
      const empties = [];
      for (let f = 0; f < 4; f++) {
        const t0 = performance.now();
        g.clear(g.COLOR_BUFFER_BIT);
        g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px);
        empties.push(performance.now() - t0);
      }
      empties.sort((a, b) => a - b);
      out.msNet = Math.max(0, +(out.ms - empties[1]).toFixed(2));
      out.ok = out.ms <= BENCH_PASS_MS;
      out.reason = out.ok ? 'benchmark' : 'benchmark-slow';
      out.tier = out.ok ? tierOf(out.msNet) : null;
    } catch (e) {
      out.reason = 'benchmark-error';
    }
    lsSet(PROBE_KEY, JSON.stringify({ renderer: out.renderer, ok: out.ok, ms: out.ms,
      msNet: out.msNet, reason: out.reason, tier: out.tier || null }));
    const lose = g.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();           /* the probe context goes home */
    return out;
  };

  const ensureVerdict = () => {
    if (!verdict) verdict = runProbe();
    return verdict;
  };

  /* the path is on when forced, or on 'auto' with a passing probe */
  const enabled = () => {
    const m = mode();
    if (m === 'off') return false;
    if (m === 'on') return true;
    return ensureVerdict().ok;
  };

  /* ---------------- phase 5: the adaptive quality governor ----------------
   * The probe grade decides the BUILD-time knobs (chord budget, decimated
   * companions); the live tier decides what the render engages. No device
   * list anywhere — the probe's own measured ms and the live frame times
   * are the only inputs. */
  const probeTier = () => {
    const v = verdict;                   /* never force a probe on a hot path */
    if (v && v.ok && v.tier) return v.tier;
    return 'A';                          /* unknown / forced-on: full fidelity */
  };
  const TIERS = ['A', 'B', 'C'];
  /* the SESSION's starting tier: the probe grade, stepped one down when the
     probe's net frame itself outruns this display's budget — a B-class GPU
     driving a 100Hz panel starts at C, the same GPU on a 60Hz one stays B.
     Still no device list: the probe ms and the measured refresh decide. */
  const baseTier = () => {
    const t = probeTier();
    if (t !== 'A' && verdict && verdict.ok &&
        typeof verdict.msNet === 'number' && verdict.msNet > gov.budget) {
      return TIERS[Math.min(TIERS.length - 1, TIERS.indexOf(t) + 1)];
    }
    return t;
  };
  const effTier = () => gov.eff || baseTier();

  const govStepDown = (why) => {
    const i = TIERS.indexOf(effTier());
    if (i < 0 || i >= TIERS.length - 1) return;      /* C is the floor: never 2D */
    gov.eff = TIERS[i + 1];
    gov.stepDowns++;
    gov.upFails = 0;                     /* conditions changed: measure anew */
    gov.cpuStrikes = gov.syncStrikes = 0;
    gov.log.push({ at: +performance.now().toFixed(0), to: gov.eff, why });
    try { console.log('[glscene] governor: step down to tier ' + gov.eff + ' (' + why + ')'); } catch (e) { /* logless */ }
    /* a tier-A build carries no decimated companions: one rebuild at the
       stepped-down tier brings them (async slices, 2D carries meanwhile) */
    if (scene && scene.qtier === 'A' && gov.eff !== 'A') fullRebuild('gov');
  };
  /* step back up only after a settled re-benchmark: the ACTUAL scene at the
     current view, truly synced — three frames, take the median.
     THE PROBE IS A GUESS; THIS IS A MEASUREMENT, and the measurement wins.
     The synthetic bench (100k full-screen random GL_LINES into 256x256) is
     fill-bound in a way no real drawing is: on the dev RTX 4070 Ti SUPER it
     costs 14.7ms — grading a B, then C once the 8.3ms display budget steps
     it down — while the SAME machine draws all of BLOCKS.dwg (4.98M
     segments) in 2.6ms. A session that merely STARTED below A used to have
     no way out of that: govArmStepUp returned early unless an explicit
     step-down had set gov.eff, and this refused any target above
     baseTier(). Both floors are gone; what remains is the same evidence bar
     — the REAL scene, truly synced, at HALF the display budget — which no
     weak GPU passes (the UHD 770's governed extents frame is 12.6ms against
     a 4.2ms bar). The measurement runs at the TARGET tier's own fidelity, so
     a step to A is priced with decimation off, never at C's discount. */
  const govRebench = () => {
    gov.upTimer = 0;
    if (!live() || buildJob) {
      if (gov.rb) { gov.eff = gov.rb.prev; gov.rb = null; }
      return;
    }
    /* never mid-gesture: three synced frames in the middle of a wheel spin
       is exactly the hitch this whole pass exists to remove */
    if (domShown || performance.now() - gov.lastT < GOV_GESTURE_MS) {
      if (gov.rb) { gov.eff = gov.rb.prev; gov.rb = null; }
      govArmStepUp();
      return;
    }
    /* AND ONLY WHERE THE ANSWER MEANS SOMETHING. An empty drawing's frame
       costs nothing on any GPU alive, so measuring one would hand tier A to
       the weakest machine in the room — and the first heavy drawing after
       that would build at full fidelity, run 40ms frames until the live
       governor caught it, and pay a full rebuild on the way down. The
       measurement needs a load: this scene must carry at least as much
       geometry as the startup probe's own bench, and the display budget it
       is judged against must be the measured one, not the 60Hz default. */
    if (!gov.budgetKnown) { if (gov.rb) { gov.eff = gov.rb.prev; gov.rb = null; } return; }
    const st = scene.stats && scene.stats.counts;
    const segs = st ? (st.segsLoose + st.segsBaked + st.segsDef) : 0;
    if (!(segs >= REBENCH_MIN_SEGS)) { if (gov.rb) { gov.eff = gov.rb.prev; gov.rb = null; } return; }
    let R = gov.rb;
    if (!R) {
      const cur = effTier();
      const i = TIERS.indexOf(cur);
      if (i <= 0) return;                /* already A: nothing above it */
      /* ONE SYNCED FRAME PER TICK. The whole measurement used to run in a
         single timer task — 94-140ms of blocked thread at idle, caught by
         a 4ms gap watcher. The frames now land one per 16ms tick (the GPU's
         boost clocks do not decay across a frame gap), with the same
         arithmetic at the end: median of the three timed, minus the
         cheapest empty. A gesture arriving mid-machine aborts and re-arms,
         exactly as it used to stand aside up front. */
      R = gov.rb = { target: TIERS[i - 1], prev: gov.eff, warm: 0, t3: [] };
      gov.eff = R.target;                /* price the frame the step would buy */
    }
    let mid = Infinity;
    try {
      const px = new Uint8Array(4);
      if (R.warm < 2) {
        /* the first synced frames after idle price the GPU's SLEEPING
           clocks, not the drawing (measured: 13ms cold, 6.7ms warm, same
           scene, same view) — two discarded frames spin the clocks up */
        render(true);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        R.warm++;
        gov.upTimer = setTimeout(govRebench, 16);
        return;
      }
      if (R.t3.length < 3) {
        const t0 = performance.now();
        render(true);                    /* the gesture-shaped frame is what
                                            the budget guards */
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        R.t3.push(performance.now() - t0);
        gov.upTimer = setTimeout(govRebench, 16);
        return;
      }
      /* AND THE ROUNDTRIP IS NOT THE DRAWING. A 1px readPixels is the only
         honest sync ANGLE offers and it costs ~6ms of its own on this
         driver — more than the whole 4.2ms bar at 120Hz, so a gross
         comparison could never pass however fast the GPU. The startup probe
         already subtracts an empty synced frame (msNet); this measures the
         same constant, on this context, right now. Empties last so the
         buffer is left holding the scene. */
      const empt = [];
      for (let f = 0; f < 4; f++) {
        const t0 = performance.now();
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        empt.push(performance.now() - t0);
      }
      render(true);                      /* leave the picture, not the clear */
      const t3 = R.t3.slice().sort((a, b) => a - b);
      empt.sort((a, b) => a - b);
      /* the CHEAPEST empty is the constant; the dearer ones carry whatever
         the queue still held (measured on the UHD 770: an inflated empty
         median handed the subtraction 20ms and a 28ms tier-A frame passed
         as 7.8). Min biases the net UP — a false refusal retries with
         backoff, a false pass ships jank. */
      mid = Math.max(0, t3[1] - empt[0]);
    } catch (e) { mid = Infinity; }
    const target = R.target;
    const prev = R.prev;
    gov.rb = null;
    /* the last verdict, for status() — a refused step-up is invisible
       otherwise, and it is the one number that explains a session's tier */
    /* THE BAR IS ONE DISPLAY PERIOD, of the frame's own cost. Half a period
       was the bar while this compared GROSS numbers, where the readPixels
       constant already ate most of the budget; against the net cost the
       right question is simply whether a full-fidelity gesture frame fits
       in a frame. BLOCKS.dwg at extents costs 7.0ms net on the dev RTX
       against an 8.33ms period — it fits, and the picture it buys is 30%
       more ink than the decimated one. The UHD 770's own full-fidelity
       extents frame is ~34ms net against 8.3-16.7 and is refused four
       times over, which is the whole point of the tier. Hysteresis is not
       lost: once at A the step-DOWN bar is four periods of the gross
       sample, so a frame that fits can never thrash back. */
    gov.lastRebench = { to: target, netMs: +mid.toFixed(2),
      barMs: +gov.budget.toFixed(2), pass: mid <= gov.budget };
    if (!(mid <= gov.budget)) {
      gov.eff = prev;
      /* a machine that will never pass must not be measured forever: five
         synced frames cost the WEAK GPU real stall, every 600ms, to learn
         what the last refusal already said (principle: never pay a cost
         and return nothing). Refusals back off; a pass or a step-down
         resets, and the settle sites' arm calls respect the pending timer. */
      gov.upFails = (gov.upFails || 0) + 1;
      gov.upTimer = setTimeout(govRebench,
        Math.min(600 * Math.pow(2, gov.upFails), 60000));
      return;
    }
    gov.upFails = 0;
    gov.cpuStrikes = gov.syncStrikes = 0;
    gov.log.push({ at: +performance.now().toFixed(0), to: effTier(), why: 'rebench ' + mid.toFixed(1) + 'ms' });
    try { console.log('[glscene] governor: step up to tier ' + effTier() + ' (rebench ' + mid.toFixed(1) + 'ms)'); } catch (e) { /* logless */ }
    govArmStepUp();                      /* Câ†’B may keep climbing to A */
  };
  /* a session below A always has a re-benchmark on the way: 3s of quiet
     after a step-DOWN (never thrash a tier the live frames just rejected),
     but promptly when the tier is only the probe's opening guess. */
  const govArmStepUp = () => {
    if (effTier() === 'A') return;
    /* ONE ON THE WAY IS ENOUGH. Re-arming on every present meant a busy
       app — an open's warm jobs, a settle, anything that composes twice a
       second — pushed the measurement out forever and the session never
       climbed. The timer is set once and allowed to land; govRebench
       itself stands aside for a live gesture and asks again. */
    if (gov.upTimer) return;
    gov.upTimer = setTimeout(govRebench, gov.stepDowns ? 3000 : 600);
  };
  /* every live present reports here: a cheap timestamp EMA per frame, a
     true-synced (1px readPixels) sample every GOV_SYNC_EVERY gesture
     frames — GOV_STRIKES misses in a row on either channel steps down */
  const govPresent = (cpuMs, gesture) => {
    gov.presents++;
    gov.ema = gov.ema ? gov.ema * 0.8 + cpuMs * 0.2 : cpuMs;
    if (!gesture) { gov.cpuStrikes = 0; govArmStepUp(); return; }
    /* THE SAMPLE IS NOT FREE AND TIER A IS NOT ON TRIAL. A 1px readPixels
       makes the CPU wait out the whole queued frame: at tier C's decimated
       frame that is a few ms, at tier A's full-fidelity extents frame it is
       ~29ms — a hitch the eye catches, once every 16 gesture frames, on the
       one tier that is already the destination. Tier A demotes only on
       three samples past FOUR budgets, a verdict that needs seconds of
       sustained miss either way, so it can afford to be asked four times
       less often; below A, where the sample is cheap and the step-down bar
       is one budget, the cadence is exactly what phase 5 shipped. */
    const every = effTier() === 'A' ? GOV_SYNC_EVERY * 4 : GOV_SYNC_EVERY;
    if (gov.presents % every === 0) {
      const t0 = performance.now();
      const px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gov.sync = +(cpuMs + performance.now() - t0).toFixed(2);
      if (effTier() === 'A') {
        /* tier A never steps down on marginal or one-off samples — the
           settle machinery's raster debt drains through these reads and a
           strong GPU wears the blame (measured 10.9 and 271.9ms samples on
           the RTX around settle collisions). Only a PERSISTENT structural
           miss — three samples running past 4Ã— budget, the shape of a
           probe that lied — may demote an A. */
        if (gov.sync > gov.budget * 4) {
          if (++gov.syncStrikes >= GOV_STRIKES) govStepDown('sync-A ' + gov.sync + 'ms > 4x' + gov.budget.toFixed(1));
        } else gov.syncStrikes = 0;
      } else if (gov.sync > gov.budget * 2) {
        /* below A a synced sample at twice the budget is a real miss —
           but ONE 250ms settle-collision sample is not a weak GPU (it
           used to demote Bâ†’C on an RTX in a single pan). Same strike
           count as every other channel. */
        if (++gov.syncStrikes >= GOV_STRIKES) govStepDown('sync-hard ' + gov.sync + 'ms > 2x' + gov.budget.toFixed(1));
      } else if (gov.sync > gov.budget) {
        if (++gov.syncStrikes >= GOV_STRIKES) govStepDown('sync ' + gov.sync + 'ms > ' + gov.budget.toFixed(1));
      } else gov.syncStrikes = 0;
    }
    if (cpuMs > gov.budget) {
      if (++gov.cpuStrikes >= GOV_STRIKES) govStepDown('cpu ' + cpuMs.toFixed(1) + 'ms > ' + gov.budget.toFixed(1));
    } else gov.cpuStrikes = 0;
    govArmStepUp();
  };
  /* the frame budget follows the display: 8.3ms at 120Hz, 16.7 at 60 —
     measured from idle rAF cadence once, snapped to the usual rates */
  (() => {
    const gaps = [];
    let tPrev = 0;
    const tick = (t) => {
      if (tPrev) gaps.push(t - tPrev);
      tPrev = t;
      if (gaps.length < 48) { requestAnimationFrame(tick); return; }
      gaps.sort((a, b) => a - b);
      const p50 = gaps[Math.floor(gaps.length / 2)];
      if (p50 > 0 && p50 < 40) {
        let hz = 60, err = Infinity;
        for (const h of [240, 165, 144, 120, 100, 90, 75, 60]) {
          const e = Math.abs(1000 / h - p50);
          if (e < err) { err = e; hz = h; }
        }
        gov.budget = 1000 / hz;
      }
      gov.budgetKnown = true;
    };
    requestAnimationFrame(tick);
  })();

  /* ---------------- colors ---------------- */
  const colCache = new Map();
  const rgbOf = (s) => {
    let c = colCache.get(s);
    if (c) return c;
    c = [255, 255, 255];
    if (typeof s === 'string') {
      if (s[0] === '#') {
        const h = s.slice(1);
        if (h.length === 3) c = [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
        else if (h.length >= 6) c = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      } else {
        const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
        if (m) c = [+m[1] | 0, +m[2] | 0, +m[3] | 0];
      }
    }
    if (c.some((v) => !(v >= 0 && v <= 255))) c = [255, 255, 255];
    colCache.set(s, c);
    return c;
  };

  /* ---------------- tessellation (Nasj.geom curve math) ---------------- */
  const nSweep = (r, sweep) =>
    Math.max(2, Math.ceil(nFullFor(r) * Math.abs(sweep) / TAU));

  const plineRuns = (ent) => {
    const G = Nasj.geom;
    const pts = ent.pts || [];
    const n = pts.length;
    if (n < 2) return [];
    const segs = ent.closed ? n : n - 1;
    const out = [];
    for (let i = 0; i < segs; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % n];
      out.push({ x: p1.x, y: p1.y });
      if (G.segHasBulge(p1)) {
        const A = G.bulgeArc(p1, p2, p1.b);
        if (A) {
          const k = nSweep(A.r, A.theta);
          for (let s = 1; s < k; s++) out.push(G.bulgeArcPoint(A, s / k));
        }
      }
    }
    out.push({ x: pts[ent.closed ? 0 : n - 1].x, y: pts[ent.closed ? 0 : n - 1].y });
    return [{ pts: out, closed: false }];   /* closure already appended */
  };

  const tessRuns = (ent) => {
    const G = Nasj.geom;
    switch (ent.type) {
      case 'line': return [{ pts: [ent.a, ent.b], closed: false }];
      case 'polyline': return plineRuns(ent);
      case 'circle': {
        const k = nFullFor(ent.r), pts = [];
        for (let i = 0; i < k; i++) pts.push(G.arcPoint(ent, TAU * i / k));
        return [{ pts, closed: true }];
      }
      case 'arc': {
        const s = G.arcSweep(ent.a0, ent.a1);
        if (!(s > 0)) return [];
        const k = nSweep(ent.r, s), pts = [];
        for (let i = 0; i <= k; i++) pts.push(G.arcPoint(ent, ent.a0 + s * i / k));
        return [{ pts, closed: false }];
      }
      case 'ellipse': {
        const rmax = Math.max(ent.rx, ent.ry);
        if (!(rmax > 0)) return [];
        if (G.ellipseIsArc(ent)) {
          const s = G.ellipseSweep(ent);
          const k = nSweep(rmax, s), pts = [];
          for (let i = 0; i <= k; i++) pts.push(G.ellipsePoint(ent, ent.a0 + s * i / k));
          return [{ pts, closed: false }];
        }
        const k = nFullFor(rmax), pts = [];
        for (let i = 0; i < k; i++) pts.push(G.ellipsePoint(ent, TAU * i / k));
        return [{ pts, closed: true }];
      }
      case 'spline': {
        const q = ent.pts || [];
        if (q.length < 2) return [];
        /* per-span count from the chord budget (sagitta ~ (L/k)^2/8L) */
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of q) {
          if (p.x < x0) x0 = p.x;
          if (p.y < y0) y0 = p.y;
          if (p.x > x1) x1 = p.x;
          if (p.y > y1) y1 = p.y;
        }
        const size = Math.max(x1 - x0, y1 - y0);
        if (!(size > 0)) return [];
        const spans = Math.max(1, ent.closed ? q.length : q.length - 1);
        const t = tessTol > 0 ? tessTol : size / 2048;
        const per = Math.min(32, Math.max(2, Math.ceil(Math.sqrt(size / (spans * 8 * t)))));
        const r = G.splinePoints(ent, per);
        return r.pts.length > 1 ? [r] : [];
      }
      case 'mline': {
        const out = [];
        for (const part of G.mlineParts(ent)) for (const r of plineRuns(part)) out.push(r);
        return out;
      }
      /* a facet's ring, less the edges the drawing marks invisible — the
         same Nasj.solid.edgeRuns split engine.js strokes it through */
      case 'face3d': return ent.pts && ent.pts.length > 2
        ? (ent.hid ? Nasj.solid.edgeRuns(ent.pts, ent.hid)
          : [{ pts: ent.pts, closed: true }]) : [];
      /* a body in plan: its visible face edges, each ONCE (solid3d dedups
         the edge two faces share and drops the hidden ones), then its
         wires. Cached in solid3d per faces array, so the 2D path and this
         one share the work. */
      case 'solid': return Nasj.solid.planRuns(ent);
      default: return null;              /* not strokeable here */
    }
  };

  /* ---------------- triangulation (fills) ----------------
   * Minimal ear clipping with hole bridging, written for this module (no
   * code vendored; the ALGORITHM is the classic one after David Eberly's
   * "Triangulation by Ear Clipping", Geometric Tools). Holes join the outer
   * loop through a bridge from each hole's rightmost vertex to a visible
   * outer vertex; then O(nÂ²) ear removal, with a forced clip so degenerate
   * input still terminates. Hatch boundaries are small (â‰¤ a few hundred
   * points after tessellation), so O(nÂ²) is nothing at build time. */
  const polyArea2 = (P) => {
    let a = 0;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      a += (P[j].x - P[i].x) * (P[j].y + P[i].y);
    }
    return a;                            /* >0 = clockwise in y-up terms */
  };
  const triContains = (ax, ay, bx, by, cx, cy, px, py) => {
    const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
    const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
    return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  };
  const bridgeHole = (poly, hole) => {
    let mi = 0;
    for (let i = 1; i < hole.length; i++) if (hole[i].x > hole[mi].x) mi = i;
    const M = hole[mi];
    /* the +x ray from M: the nearest crossing edge of the outer polygon */
    let bx = Infinity, bi = -1;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a.y >= M.y) === (b.y >= M.y)) continue;
      const t = (M.y - a.y) / (b.y - a.y);
      const x = a.x + t * (b.x - a.x);
      if (x >= M.x && x < bx) { bx = x; bi = i; }
    }
    if (bi < 0) return null;
    /* candidate connect vertex: the crossed edge's endpoint on the ray's
       side; any reflex outer vertex inside triangle (M, I, P) is nearer */
    const e0 = poly[bi], e1 = poly[(bi + 1) % poly.length];
    let pi = (e0.x > e1.x) ? bi : (bi + 1) % poly.length;
    let P = poly[pi];
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const v = poly[i];
      if (v === P || v.x < M.x) continue;
      if (!triContains(M.x, M.y, bx, M.y, P.x, P.y, v.x, v.y)) continue;
      const d = Math.abs(v.y - M.y) * 1e6 + Math.abs(v.x - M.x);
      if (d < best) { best = d; pi = i; P = v; }
    }
    /* splice: ...P, M, hole..., M, P... */
    const out = poly.slice(0, pi + 1);
    for (let k = 0; k <= hole.length; k++) out.push(hole[(mi + k) % hole.length]);
    out.push(poly[pi]);
    for (let i = pi + 1; i < poly.length; i++) out.push(poly[i]);
    return out;
  };
  /* outer: [{x,y}] (no repeated closing point); holes: array of loops.
     Returns a flat Float32Array [x,y Ã— 3 per triangle], or null. */
  const triangulate = (outer, holes) => {
    let poly = outer.filter((p) => p && isFinite(p.x + p.y));
    if (poly.length > 1) {
      const dedup = [poly[0]];
      for (let i = 1; i < poly.length; i++) {
        const q = dedup[dedup.length - 1], p = poly[i];
        if (p.x !== q.x || p.y !== q.y) dedup.push(p);
      }
      const f = dedup[0], l = dedup[dedup.length - 1];
      if (dedup.length > 1 && f.x === l.x && f.y === l.y) dedup.pop();
      poly = dedup;
    }
    if (poly.length < 3) return null;
    if (polyArea2(poly) > 0) poly.reverse();          /* outer counterwise */
    /* the area the fill OWES: the outer ring less every hole. Taken here,
       before bridging opens the rings into one, so the triangles can be
       held against it at the end. */
    let want = Math.abs(polyArea2(poly)) / 2;
    if (holes && holes.length) {
      const hs = [];
      for (const loop of holes) {
        if (!Array.isArray(loop) || loop.length < 3) continue;
        const h = loop.filter((p) => p && isFinite(p.x + p.y)).slice();
        if (h.length < 3) continue;
        if (polyArea2(h) < 0) h.reverse();            /* holes clockwise */
        want -= Math.abs(polyArea2(h)) / 2;
        hs.push(h);
      }
      hs.sort((a, b) => Math.max.apply(null, b.map((p) => p.x)) -
        Math.max.apply(null, a.map((p) => p.x)));
      for (const h of hs) {
        const merged = bridgeHole(poly, h);
        if (merged) poly = merged;                    /* a failed bridge: fill over */
      }
    }
    const n0 = poly.length;
    const idx = new Array(n0);
    for (let i = 0; i < n0; i++) idx[i] = i;
    const X = poly.map((p) => p.x), Y = poly.map((p) => p.y);
    const tris = [];
    let guard = n0 * n0 + 16;
    let forced = 0;
    let i = 0;
    while (idx.length > 3 && guard-- > 0) {
      const n = idx.length;
      const i0 = idx[(i + n - 1) % n], i1 = idx[i % n], i2 = idx[(i + 1) % n];
      const ax = X[i0], ay = Y[i0], bx2 = X[i1], by = Y[i1], cx = X[i2], cy = Y[i2];
      const cross = (bx2 - ax) * (cy - ay) - (by - ay) * (cx - ax);
      let ear = cross < 0;                            /* convex, counterwise */
      if (ear) {
        for (let k = 0; k < n; k++) {
          const j = idx[k];
          if (j === i0 || j === i1 || j === i2) continue;
          /* a bridge puts its two vertices in the loop TWICE: the twin of
             one of this ear's corners sits exactly on the ear and would
             veto it, and every ear along the bridge with it — the loop
             sticks and force-clips slivers across the fill */
          const px = X[j], py = Y[j];
          if ((px === ax && py === ay) || (px === bx2 && py === by) || (px === cx && py === cy)) continue;
          if (triContains(ax, ay, bx2, by, cx, cy, px, py)) { ear = false; break; }
        }
      }
      if (ear) {
        if (cross !== 0) tris.push(i0, i1, i2);
        idx.splice(i % n, 1);
        i = 0;
      } else if (++i > n * 2) {
        /* stuck (self-intersecting input): force-clip to terminate */
        forced++;
        if (cross !== 0) tris.push(i0, i1, i2);
        idx.splice(i % n, 1);
        i = 0;
      }
    }
    if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
    /* a fill that mostly terminated by force is triangle soup, not the
       region — the fan across half a plan a bad trace once drew. The 2D
       layer's even-odd fill draws even a crossing loop sanely, so the
       caller demotes on null. */
    if (forced > Math.max(4, n0 >> 3)) return null;
    if (!tris.length) return null;
    /* THE TRIANGLES MUST BE THE POLYGON. Ear clipping bridges every hole
       into the outer ring one after another, and a room full of furniture
       — forty islands, each a block — outruns it: the bridges tangle, the
       holes go uncut and the fill comes back as overlapping wedges across
       the room. A forced clip does not always announce it; the AREA does.
       What the triangles carry is held against what the rings owe, and a
       fill that fails is handed back for the 2D layer to paint even-odd,
       which no number of holes can fool. */
    let got = 0;
    for (let k = 0; k < tris.length; k += 3) {
      const ax = X[tris[k]], ay = Y[tris[k]];
      got += Math.abs((X[tris[k + 1]] - ax) * (Y[tris[k + 2]] - ay) -
        (X[tris[k + 2]] - ax) * (Y[tris[k + 1]] - ay)) / 2;
    }
    if (!(want > 0) || Math.abs(got - want) > want * 0.02) return null;
    const out = new Float32Array(tris.length * 2);
    for (let k = 0; k < tris.length; k++) {
      out[k * 2] = X[tris[k]];
      out[k * 2 + 1] = Y[tris[k]];
    }
    return out;
  };

  /* a hatch's boundary as one closed loop of points (world of the entity) */
  const hatchLoop = (ent) => {           /* caller sets tessTol first */
    const bnd = Nasj.geom.hatchBoundary(ent);
    const runs = tessRuns(bnd);
    if (!runs || !runs.length) return null;
    const pts = runs[0].pts;
    return (pts && pts.length >= 3) ? pts : null;
  };

  /* ---------------- fingerprints ----------------
   * Undo/redo JSON round-trips the whole document — every object identity
   * changes while almost nothing did — so the diff runs on VALUES: a cheap
   * rolling hash over the fields that shape what this module draws. */
  const fpF64 = new Float64Array(1);
  const fpI32 = new Int32Array(fpF64.buffer);
  let H = 0;
  const hN = (v) => {
    fpF64[0] = typeof v === 'number' ? v : -1e308;
    H = ((H * 31 | 0) + fpI32[0] + ((fpI32[1] * 7) | 0)) | 0;
  };
  /* strings repeat massively (types, layer ids, colors): hash once, memo */
  const strHashes = new Map();
  const hS = (s) => {
    if (!s) { H = (H * 31 + 1) | 0; return; }
    let v = strHashes.get(s);
    if (v === undefined) {
      v = 5381;
      for (let i = 0; i < s.length; i++) v = ((v * 33) | 0) + s.charCodeAt(i) | 0;
      strHashes.set(s, v);
    }
    H = ((H * 31) | 0) + v | 0;
  };
  /* un-memoized: one-off strings (per-reference dyn/attrs JSON) */
  const hSraw = (s) => {
    let v = 5381;
    for (let i = 0; i < s.length; i++) v = ((v * 33) | 0) + s.charCodeAt(i) | 0;
    H = ((H * 31) | 0) + v | 0;
  };
  const hP = (p) => { if (p) { hN(p.x); hN(p.y); } else H = (H * 29 + 3) | 0; };
  const hPts = (pts) => {
    /* position-weighted sums instead of per-point mixing: an order of
       magnitude cheaper on long polylines and still catches any single
       vertex, translation, rotation or bulge edit */
    let sx = 0, sy = 0, sb = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      sx += p.x * (i + 1);
      sy += p.y * (i + 1);
      if (typeof p.b === 'number') sb += p.b * (i + 1);
    }
    hN(pts.length); hN(sx); hN(sy); hN(sb);
  };
  /* a point ring with its heights: a body's edge set is deduped in 3D, so
     a z-only edit can change which edges are drawn */
  const hPtsZ = (pts) => {
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      sx += p.x * (i + 1);
      sy += p.y * (i + 1);
      if (typeof p.z === 'number') sz += p.z * (i + 1);
    }
    hN(pts.length); hN(sx); hN(sy); hN(sz);
  };
  /* A BODY'S GEOMETRY lives in arrays, not in the scalar fields fpEnt
     hashes — two different solids fingerprinted identically, so an edited
     one read as unchanged. Walking every face of 3,349 bodies on every
     sweep is not free, so the walk is cached against the faces array
     itself: every mutator (transform, place3, undo's JSON round-trip)
     replaces it, which is exactly when the hash must move. */
  const solidGeoCache = new WeakMap();
  const solidGeoHash = (e) => {
    const faces = e.faces, wires = e.wires;
    const hit = faces ? solidGeoCache.get(faces) : null;
    if (hit && hit.w === wires) return hit.h;
    const save = H;
    H = 23;
    if (Array.isArray(faces)) {
      hN(faces.length);
      for (const f of faces) {
        if (!f) { H = (H * 31 + 5) | 0; continue; }
        hN(f.hid);
        if (Array.isArray(f.pts)) hPtsZ(f.pts);
        if (Array.isArray(f.holes)) {
          hN(f.holes.length);
          for (const h of f.holes) if (Array.isArray(h)) hPtsZ(h);
        }
      }
    }
    if (Array.isArray(wires)) {
      hN(wires.length);
      for (const w of wires) if (Array.isArray(w)) hPtsZ(w);
    }
    const h = H;
    H = save;
    if (faces) solidGeoCache.set(faces, { w: wires, h });
    return h;
  };
  const fpEnt = (e) => {
    H = 17;
    hS(e.type);
    hS(e.layerId);
    hS(typeof e.color === 'string' ? e.color : '');
    hS(e.lt || '');
    hN(e.lts);
    hN(e.transp);
    hN(e.w);
    H = (H * 31 + (e.closed ? 1 : 0)) | 0;
    hN(e.rot);
    hP(e.a); hP(e.b); hP(e.c); hP(e.p);
    hN(e.r); hN(e.rx); hN(e.ry); hN(e.a0); hN(e.a1);
    hN(e.sx); hN(e.sy);
    hS(e.name || '');
    hS(e.just || '');
    hN(e.scale);
    const pts = e.pts;
    if (Array.isArray(pts)) hPts(pts);
    /* hatches are drawable now: their whole shape lives in these fields */
    if (e.type === 'hatch') {
      hS(e.pattern || '');
      hN(e.angle);
      hN(e.aisel);
      H = (H * 31 + (e.grad ? 1 : 0)) | 0;
      const b = e.boundary;
      if (b) {
        hS(b.kind || '');
        hP(b.c); hN(b.r); hN(b.rx); hN(b.ry); hN(b.rot);
        if (Array.isArray(b.pts)) hPts(b.pts);
      }
      if (Array.isArray(e.islands)) {
        hN(e.islands.length);
        for (const loop of e.islands) if (Array.isArray(loop)) hPts(loop);
      }
    }
    if (e.type === 'solid') {
      H = ((H * 31) | 0) + solidGeoHash(e) | 0;
      H = (H * 31 + (e.two ? 1 : 0)) | 0;
    }
    if (e.type === 'face3d') hN(e.hid);
    /* MLEDIT's gaps and trimmed-end caps reshape the drawn element lines
       without moving a vertex */
    if (e.type === 'mline') {
      hN(e.capS); hN(e.capE);
      if (Array.isArray(e.cuts)) {
        hN(e.cuts.length);
        for (const c of e.cuts) if (c) { hN(c.el); hN(c.s); hN(c.e); }
      }
    }
    if (e.dyn) { try { hSraw(JSON.stringify(e.dyn)); } catch (x) { hS('dyn'); } }
    if (e.visState) hS(String(e.visState));
    if (e.clip) hS(e.clip.on === false ? 'c0' : 'c1');
    if (e.attrs) { try { hSraw(JSON.stringify(e.attrs)); } catch (x) { hS('at'); } }
    return H;
  };
  /* a definition's value fingerprint, cached against its entities array —
     recomputed only when undo/bedit replaces the array itself */
  const defFpCache = new WeakMap();
  const fpDef = (arr) => {
    let f = defFpCache.get(arr);
    if (f !== undefined) return f;
    let acc = arr.length | 0;
    for (const c of arr) { if (c) acc = ((acc * 37) | 0) + fpEnt(c) | 0; }
    defFpCache.set(arr, acc);
    return acc;
  };

  /* ---------------- ownership ----------------
   * The single statement of what GL draws. The engine's scene passes skip
   * exactly what owner() answers; the build walks the same predicate. */
  /* 'solid' is the app's polyhedral BODY (a DWG 3DSOLID/REGION/BODY, a
     MESH, an EXTRUDE): planar faces with optional holes and hidden-edge
     bits, plus the wires of the faces the reader could not flatten. In a
     PLAN view — the only view this module ever draws — the 2D engine
     strokes exactly Nasj.solid.planRuns(ent) for it and fills nothing
     (faces are painted only by shaded3d(), which needs view3d.active, and
     owner() is null there). So a body is a line stream like any other. */
  const STROKEABLE = {
    line: 1, polyline: 1, circle: 1, arc: 1, ellipse: 1, spline: 1,
    mline: 1, face3d: 1, solid: 1
  };
  const ltSolidCache = new Map();
  const ltSolid = (lt) => {
    if (!lt || lt === 'ByLayer') return true;
    let v = ltSolidCache.get(lt);
    if (v === undefined) ltSolidCache.set(lt, v = /^continuous$/i.test(lt));
    return v;
  };
  const entLtSolid = (e, ly) =>
    (e.lt && e.lt !== 'ByLayer') ? ltSolid(e.lt) : ltSolid(ly && ly.lt);
  const lwWide = (doc, e, ly) => {
    if (!(Nasj.settings && Nasj.settings.lwt)) return false;
    const lw = (typeof e.lw === 'number' && isFinite(e.lw)) ? e.lw
      : (ly && typeof ly.lw === 'number' && isFinite(ly.lw)) ? ly.lw : 0.25;
    return lw * 2.2 > 1.5;               /* engine widens past its 1.4 floor */
  };

  /* phase 3: a SOLID hatch (and the '@bg' wipeout, which IS a SOLID hatch
     of '@bg' per SPEC3 Â§23) is GL-drawable. Pattern hatches are not: the
     engine generates their line families procedurally at draw time, so
     their strokes exist nowhere in the doc model — they stay 2D this
     phase. Gradients and agent-framed (aisel) hatches stay 2D too. */
  const hatchOwnable = (e) => {
    if (e.grad) return false;
    if (String(e.pattern || '').toUpperCase() !== 'SOLID') return false;
    if (typeof e.aisel === 'number') return false;
    return true;
  };

  /* a definition is PURE when every drawable child is a solid hairline
     stroke or an ownable SOLID/'@bg' hatch — then GL draws the whole
     reference and the 2D pass skips it. One 2D-only child (text, a dash,
     a width, a pattern hatch…) keeps the whole reference on the 2D layer,
     exactly as before, and GL never touches it. */
  const defPureCache = new Map();        /* name -> {arr, pure} */
  const defPure = (doc, name) => {
    const def = doc.blocks && doc.blocks[name];
    if (!def || !Array.isArray(def.entities)) return false;
    let c = defPureCache.get(name);
    if (c && c.arr === def.entities) return c.pure;
    const lmap = new Map(doc.layers.map((l) => [l.id, l]));
    let pure = true;
    for (const ch of def.entities) {
      if (!ch) continue;
      if (ch.type === 'insert') continue;          /* drawn nowhere (no nesting) */
      if (ch.construction || ch.type === 'bparam') continue;
      if (ch.type === 'hatch') {
        if (!hatchOwnable(ch)) { pure = false; break; }
        continue;                        /* transp is the fill's own alpha */
      }
      if (!STROKEABLE[ch.type]) { pure = false; break; }
      if (ch.transp > 0) { pure = false; break; }
      if (ch.type === 'polyline' && typeof ch.w === 'number' && ch.w > 0) { pure = false; break; }
      if (!entLtSolid(ch, lmap.get(ch.layerId))) { pure = false; break; }
    }
    defPureCache.set(name, { arr: def.entities, pure });
    return pure;
  };

  /* ly: the entity's layer record, already looked up by the caller */
  const entOwnable = (doc, e, ly) => {
    if (!e) return false;
    if (ly && ly.locked) return false;             /* locked layers fade on 2D */
    if (e.type === 'hatch') {
      if (!hatchOwnable(e)) return false;
      /* a selected hatch goes back to 2D so the selection styling is not a
         second translucent fill stacked over the GL one (capped: a mass
         selection keeps them on GL and wears the slightly denser look) */
      const sel = Nasj.selection;
      if (sel instanceof Set && sel.size <= SEL_HATCH_CAP && sel.has(e.id)) return false;
      return true;
    }
    const isIns = e.type === 'insert';
    if (!isIns && !STROKEABLE[e.type]) return false;
    if (e.transp > 0) return false;
    if (isIns) {
      const def = doc.blocks && doc.blocks[e.name];
      if (!def || !Array.isArray(def.entities)) return false;
      if (def.xref) return false;                  /* xrefs fade (XDWGFADECTL) */
      if (e.clip && e.clip.on !== false) return false;   /* XCLIP cuts on 2D */
      return defPure(doc, e.name);
    }
    if (e.type === 'polyline' && typeof e.w === 'number' && e.w > 0) return false;
    /* a zero-length line draws as its round cap on 2D — GL_LINES can't */
    if (e.type === 'line' && e.a && e.b && e.a.x === e.b.x && e.a.y === e.b.y) return false;
    if (!entLtSolid(e, ly)) return false;
    if (lwWide(doc, e, ly)) return false;
    if (Nasj.settings && Nasj.settings.poche && e.type === 'polyline' && e.closed &&
        ly && /^A-WALL/.test(ly.name)) return false;     /* poché fills on 2D */
    return true;
  };

  /* ---------------- environment signatures ----------------
   * Phase 3 splits the phase-2 envSig in two. envSigNow keeps only what
   * shapes OWNERSHIP or baked geometry: lwt/poche and per-layer id order +
   * locked + lt + lw — a change still rebuilds fully. (The isolation set
   * used to ride here too; it is diffed and hint-patched now, hidSigNow.)
   * palSigNow carries what the palette texture owns — per-layer color and
   * on/frozen — a change updates the texture, no rebuild. Above LI_MAX
   * layers the palette bows out and everything folds back into envSig
   * (phase-2 behavior, rebuild on any layer change). */
  const palCapable = (doc) => doc.layers.length + 1 <= LI_MAX;
  const envSigNow = (doc) => {
    const noPal = !palCapable(doc);
    let s = (Nasj.settings && Nasj.settings.lwt ? 'w' : '') +
      (Nasj.settings && Nasj.settings.poche ? 'p' : '') +
      (noPal ? 'n' : '') + '#';
    for (const l of doc.layers) {
      s += l.id + '|' + (l.locked ? 1 : 0) + '|' + (l.lt || '') + '|' +
        (l.lw != null ? l.lw : '') + ';';
      if (noPal) s += l.color + '|' + (l.on ? 1 : 0) + (l.frozen ? 1 : 0) + ';';
    }
    return s;
  };
  const palSigNow = (doc) => {
    if (!palCapable(doc)) return '';
    let s = '';
    for (const l of doc.layers) {
      s += l.color + '|' + (l.on && !l.frozen ? 1 : 0) + ';';
    }
    return s;
  };
  /* THE ISOLATION SET LEFT envSig. It used to ride there, which made every
     change a fullRebuild — and SCALE's drag dims its selection through
     Nasj.hiddenIds, so the first drag frame un-lived a 241k-entity scene
     and every frame after ran on the CPU (measured 69ms/frame). It is its
     own signature now: a change is DIFFED against the scene's snapshot and
     the changed ids ride the ordinary hint patch — the same chunk
     rebuilds a MOVE commit pays, the scene live throughout. Only a diff
     too big to hint (a whole-drawing ISOLATE) still rebuilds. */
  const hidSigNow = () => {
    const hid = Nasj.hiddenIds;
    if (!hid || !hid.size) return '0';
    let a = 0;
    for (const id of hid) { H = 7; hS(String(id)); a = (a + H) | 0; }
    return hid.size + '.' + a;
  };

  /* ---------------- GL plumbing ---------------- */
  const SH = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('glscene shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const PROG = (vs, fs, attrs) => {
    const p = gl.createProgram();
    gl.attachShader(p, SH(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, SH(gl.FRAGMENT_SHADER, fs));
    attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('glscene link: ' + gl.getProgramInfoLog(p));
    return p;
  };
  /* the shared fragment shader: color from the baked rgba, the palette
     texel, or the theme-background uniform; visibility is the product of
     two palette alphas (an entity's own layer and, for baked def children,
     the reference's layer). The palette is sampled HERE, never in the VS —
     fragment sampling is universal, vertex texture fetch is the spotty one. */
  const FS =
    'precision mediump float;uniform sampler2D uT;uniform vec3 uB;' +
    /* uHl/uHlC: the marquee preview's highlight — 0 on every normal frame,
       the tinted second pass mixes the resolved color toward the selection
       accent (scissored to the rectangle by the caller) */
    'uniform float uHl;uniform vec3 uHlC;' +
    'varying vec4 vc;varying vec2 vf;varying vec2 vuc;varying vec2 vua;varying vec2 vub;' +
    'void main(){' +
    'float vis=texture2D(uT,vua).a*texture2D(uT,vub).a;' +
    'vec3 rgb=mix(vc.rgb,texture2D(uT,vuc).rgb,vf.x);' +
    'rgb=mix(rgb,uB,vf.y);' +
    'rgb=mix(rgb,uHlC,uHl);' +
    'float a=vc.a*vis;' +
    'if(a<0.004)discard;' +
    'gl_FragColor=vec4(rgb*a,a);}';      /* premultiplied out */
  const UV_FN =
    'uniform float uPR;' +
    'vec2 uvOf(float i){float y=floor(i/1024.0);' +
    'return vec2((i-y*1024.0+0.5)/1024.0,(y+0.5)/uPR);}';
  /* chunk vertex: L = [liC(idx|flag*16384), liV1, liV2, zGroup] as raw u16 */
  /* uCv: device pixels per world unit for the LINE draws (0 on the fill
     draws, where c.a is the fill's own alpha). c.a on a line vertex is the
     log-quantized world length of its run; coverage = that length on screen,
     clamped at one pixel. */
  const VS_CHUNK =
    'attribute vec2 p;attribute vec4 c;attribute vec4 L;' +
    'uniform mat2 M;uniform vec2 O;uniform float uCv;' + UV_FN +
    'varying vec4 vc;varying vec2 vf;varying vec2 vuc;varying vec2 vua;varying vec2 vub;' +
    'void main(){' +
    'float f=floor(L.x/16384.0);float ic=L.x-f*16384.0;' +
    'vuc=uvOf(ic);vua=uvOf(L.y);vub=uvOf(L.z);' +
    'vf=vec2(step(0.5,f)*step(f,1.5),step(1.5,f));' +
    'float a=c.a;' +
    'if(uCv>0.0){a=clamp(exp2((c.a*255.0-1.0)/254.0*' + COV_SPAN.toFixed(1) +
    (COV_LO < 0 ? '-' : '+') + Math.abs(COV_LO).toFixed(1) + ')*uCv,0.0,1.0);}' +
    'vc=vec4(c.rgb,a);' +
    'gl_Position=vec4(M*p+O,L.w/32767.5-1.0,1.);}';
  /* instanced vertex: Lm = [liC, liV1] from the mesh; il.x carries the
     reference's layer index (+16384 when the reference color is ByLayer);
     f==3 (ByBlock) takes the instance color, itself baked or palette. */
  const VS_INST =
    'attribute vec2 p;attribute vec4 c;attribute vec2 Lm;' +
    'attribute vec2 m0;attribute vec2 m1;attribute vec2 m2;attribute vec4 ic;attribute vec2 il;' +
    'uniform mat2 M;uniform vec2 O;uniform float uZ;' + UV_FN +
    'varying vec4 vc;varying vec2 vf;varying vec2 vuc;varying vec2 vua;varying vec2 vub;' +
    'void main(){' +
    'vec2 w=m0*p.x+m1*p.y+m2;' +
    'gl_Position=vec4(M*w+O,uZ,1.);' +
    'float f=floor(Lm.x/16384.0);float ci=Lm.x-f*16384.0;' +
    'float g=floor(il.x/16384.0);float ri=il.x-g*16384.0;' +
    'vua=uvOf(Lm.y);vub=uvOf(ri);' +
    'float bb=step(2.5,f);' +
    'vuc=uvOf(mix(ci,ri,bb));' +
    'vf=vec2(step(0.5,f)*step(f,1.5)+bb*g,0.0);' +
    'vc=vec4(mix(c.rgb,ic.rgb,bb),1.0);}';
  /* the remainder quad: clip-space corners computed on the CPU in doubles */
  const VS_QUAD =
    'attribute vec2 p;attribute vec2 t;varying vec2 vt;' +
    'void main(){vt=t;gl_Position=vec4(p,0.,1.);}';
  const FS_QUAD =
    'precision mediump float;uniform sampler2D uT;varying vec2 vt;' +
    'void main(){gl_FragColor=texture2D(uT,vt);}';

  const cachePrograms = () => {
    progChunk = PROG(VS_CHUNK, FS, ['p', 'c', 'L']);
    progInst = PROG(VS_INST, FS, ['p', 'c', 'Lm', 'm0', 'm1', 'm2', 'ic', 'il']);
    progQuad = PROG(VS_QUAD, FS_QUAD, ['p', 't']);
    const U = (p, names) => {
      const o = {};
      for (const n of names) o[n] = gl.getUniformLocation(p, n);
      return o;
    };
    uni = {
      c: U(progChunk, ['M', 'O', 'uPR', 'uT', 'uB', 'uCv', 'uHl', 'uHlC']),
      i: U(progInst, ['M', 'O', 'uPR', 'uT', 'uB', 'uZ', 'uHl', 'uHlC']),
      q: U(progQuad, ['uT'])
    };
  };
  const makeTextures = () => {
    palTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, palTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, PALW, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array(PALW * 4).fill(255));
    palRows = 1;
    remTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, remTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    remGen = -1;
    remLast = null;                      /* the texture's pixels are gone */
    quadVbo = gl.createBuffer();
  };

  const ensureGL = () => {
    if (gl) return true;
    const main = document.getElementById('canvas');
    if (!main || !main.parentElement) return false;
    glCanvas = document.createElement('canvas');
    glCanvas.id = 'gl-canvas';
    glCanvas.setAttribute('data-nasj-gl', '1');
    /* phase 3: the canvas LIVES in the DOM, inserted right AFTER #canvas so
       any querySelector('canvas') in a QA suite still finds the main canvas
       first (document order), and under #overlay-canvas (z-index 2) so the
       crosshair and grips stay on top. It presents only during gestures;
       compose() hides it and the settled picture is the 2D canvas alone. */
    glCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;' +
      'z-index:1;pointer-events:none;visibility:hidden;';
    gl = glCanvas.getContext('webgl', {
      alpha: true, antialias: true, premultipliedAlpha: true, depth: true,
      stencil: false,
      /* no preserved buffer: each present renders whole in one task */
      preserveDrawingBuffer: false, powerPreference: 'high-performance'
    });
    if (!gl) { glCanvas = null; return false; }
    extInst = gl.getExtension('ANGLE_instanced_arrays');
    extVao = gl.getExtension('OES_vertex_array_object');
    if (!extInst) { glCanvas = null; gl = null; return false; }
    cachePrograms();
    makeTextures();
    depthBits = gl.getParameter(gl.DEPTH_BITS) | 0;
    main.parentElement.insertBefore(glCanvas, main.nextSibling);
    domShown = false;
    /* a lost context deactivates cleanly (2D takes every stroke back) and a
       restore rebuilds — long sessions survive driver resets */
    glCanvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      freeAllScenes(true);
      hideDom();
      emitDoc('glscene');
    });
    glCanvas.addEventListener('webglcontextrestored', () => {
      cachePrograms();
      makeTextures();
      lwRange = null;
      dirty = true;
    });
    return true;
  };

  const showDom = () => {
    if (!glCanvas || domShown) return;
    glCanvas.style.visibility = '';
    domShown = true;
  };
  const hideDom = () => {
    if (!glCanvas || !domShown) return;
    glCanvas.style.visibility = 'hidden';
    domShown = false;
  };

  const rendererString = () => {
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    }
    return ensureVerdict().renderer;
  };

  /* ---------------- palette ---------------- */
  const buildLayerIdx = (doc) => {
    const m = new Map();
    if (!palCapable(doc)) return m;      /* empty map = noPal, all baked */
    let i = 1;                           /* slot 0: always-visible white */
    for (const l of doc.layers) m.set(l.id, i++);
    return m;
  };
  /* WHOSE PALETTE IS ON THE TEXTURE. There is one palette texture and one
     palRows for the whole module, but its CONTENTS are a drawing's: its
     layer colours, and in the alpha byte the on/frozen bit every vertex is
     multiplied by. While there was one scene at a time that was the same
     thing. With a scene per drawing it is not, and the day it stopped
     being the same thing a tab click drew the incoming drawing through the
     outgoing one's palette: BLOCKS.dwg's 738 layers sampling a table
     uploaded for a 52-layer drawing found alpha 0 in every slot past the
     52nd and simply did not appear — a third of the ink gone, silently,
     with the scene correct and complete and rightly reporting itself
     clean. So the texture carries the identity of the layer index it was
     built from, and every draw entry makes it match the scene it is about
     to draw (see ensurePalette). */
  let palTexOf = null;                   /* the layerIdx the texture holds */
  const uploadPalette = (doc, layerIdx) => {
    if (!gl || !palTex) return;
    palTexOf = layerIdx;
    const n = layerIdx.size + 1;
    const rows = Math.max(1, Math.ceil(n / PALW));
    const buf = new Uint8Array(PALW * rows * 4);
    buf[0] = buf[1] = buf[2] = buf[3] = 255;         /* slot 0 */
    const lmap = new Map(doc.layers.map((l) => [l.id, l]));
    for (const [id, i] of layerIdx) {
      const l = lmap.get(id);
      const o = i * 4;
      if (!l) { buf[o] = buf[o + 1] = buf[o + 2] = 255; buf[o + 3] = 255; continue; }
      const c = rgbOf(l.color || '#ffffff');
      buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
      buf[o + 3] = (l.on && !l.frozen) ? 255 : 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, palTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, PALW, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    palRows = rows;
  };
  /* the one thing every draw entry owes the scene it is about to draw: the
     shared texture holding THAT drawing's table. A no-op (one pointer
     compare) for every frame of a document that has not been left. */
  const ensurePalette = () => {
    if (!scene || !gl || !palTex) return;
    if (palTexOf === scene.layerIdx) return;
    uploadPalette(scene.doc, scene.layerIdx);
  };

  /* ---------------- vertex sinks ---------------- */
  /* chunk sink: VSTRIDE 20 — xy f32, rgba u8, [liC liV1 liV2 z] u16 */
  const mkSink = (cap) => ({
    buf: new ArrayBuffer(cap * VSTRIDE), n: 0, cap,
    f32: null, u8: null, u16: null,
    init() {
      this.f32 = new Float32Array(this.buf);
      this.u8 = new Uint8Array(this.buf);
      this.u16 = new Uint16Array(this.buf);
      return this;
    },
    ensure(k) {
      if (this.n + k <= this.cap) return;
      let c = this.cap * 2;
      while (c < this.n + k) c *= 2;
      const b = new ArrayBuffer(c * VSTRIDE);
      new Uint8Array(b).set(this.u8);
      this.buf = b; this.cap = c; this.init();
    },
    push(x, y, st, z) {
      const i = this.n * 5, j = this.n * VSTRIDE, h = this.n * 10;
      this.f32[i] = x; this.f32[i + 1] = y;
      this.u8[j + 8] = st.r; this.u8[j + 9] = st.g; this.u8[j + 10] = st.b; this.u8[j + 11] = st.a;
      this.u16[h + 6] = st.c; this.u16[h + 7] = st.v1; this.u16[h + 8] = st.v2; this.u16[h + 9] = z;
      this.n++;
    }
  }).init();

  /* f32 def-mesh sink: MSTRIDE 16 — xy f32, rgba, [liC liV1] u16 */
  const mkSinkM = (cap) => ({
    buf: new ArrayBuffer(cap * MSTRIDE), n: 0, cap,
    f32: null, u8: null, u16: null,
    init() {
      this.f32 = new Float32Array(this.buf);
      this.u8 = new Uint8Array(this.buf);
      this.u16 = new Uint16Array(this.buf);
      return this;
    },
    push(x, y, st) {
      const i = this.n * 4, j = this.n * MSTRIDE, h = this.n * 8;
      this.f32[i] = x; this.f32[i + 1] = y;
      this.u8[j + 8] = st.r; this.u8[j + 9] = st.g; this.u8[j + 10] = st.b; this.u8[j + 11] = st.a;
      this.u16[h + 6] = st.c; this.u16[h + 7] = st.v1;
      this.n++;
    }
  }).init();

  /* quantized def-mesh sink: QSTRIDE 12 — xy u16, rgba, [liC liV1] u16 */
  const mkSink16 = (cap) => ({
    buf: new ArrayBuffer(cap * QSTRIDE), n: 0, cap,
    u16: null, u8: null,
    init() {
      this.u16 = new Uint16Array(this.buf);
      this.u8 = new Uint8Array(this.buf);
      return this;
    },
    push(x, y, st) {                     /* x,y already 0..65535 */
      const i = this.n * 6, j = this.n * QSTRIDE;
      this.u16[i] = x; this.u16[i + 1] = y;
      this.u8[j + 4] = st.r; this.u8[j + 5] = st.g; this.u8[j + 6] = st.b; this.u8[j + 7] = st.a;
      this.u16[i + 4] = st.c; this.u16[i + 5] = st.v1;
      this.n++;
    }
  }).init();

  const uploadBytes = (vbo, u8) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, u8, gl.STATIC_DRAW);
  };

  const bindChunkVerts = (vbo) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, VSTRIDE, 0);
    gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, VSTRIDE, 8);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_SHORT, false, VSTRIDE, 12);
  };
  const bindMeshVerts = (vbo, quant) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    if (quant) {
      gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, true, QSTRIDE, 0);
      gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, QSTRIDE, 4);
      gl.vertexAttribPointer(2, 2, gl.UNSIGNED_SHORT, false, QSTRIDE, 8);
    } else {
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, MSTRIDE, 0);
      gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, MSTRIDE, 8);
      gl.vertexAttribPointer(2, 2, gl.UNSIGNED_SHORT, false, MSTRIDE, 12);
    }
  };
  const bindInst = (ibo) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, ibo);
    for (let i = 3; i <= 5; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 2, gl.FLOAT, false, ISTRIDE, (i - 3) * 8);
      extInst.vertexAttribDivisorANGLE(i, 1);
    }
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 4, gl.UNSIGNED_BYTE, true, ISTRIDE, 24);
    extInst.vertexAttribDivisorANGLE(6, 1);
    gl.enableVertexAttribArray(7);
    gl.vertexAttribPointer(7, 2, gl.UNSIGNED_SHORT, false, ISTRIDE, 28);
    extInst.vertexAttribDivisorANGLE(7, 1);
  };

  const itemVao = (it) => {
    if (!extVao) return;
    if (it.vao) extVao.deleteVertexArrayOES(it.vao);
    it.vao = extVao.createVertexArrayOES();
    extVao.bindVertexArrayOES(it.vao);
    if (it.kind === 'chunk') bindChunkVerts(it.vbo);
    else { bindMeshVerts(it.mesh.vbo, it.mesh.quant); bindInst(it.ibo); }
    /* phase 5: the instanced companion rides its own VAO (mesh vboD + the
       same instance buffer); chunk companions get theirs at upload time */
    if (it.kind !== 'chunk' && it.mesh.vboD) {
      if (it.vaoD) extVao.deleteVertexArrayOES(it.vaoD);
      it.vaoD = extVao.createVertexArrayOES();
      extVao.bindVertexArrayOES(it.vaoD);
      bindMeshVerts(it.mesh.vboD, it.mesh.quant);
      bindInst(it.ibo);
    }
    extVao.bindVertexArrayOES(null);
  };

  const freeItem = (it) => {
    if (!gl) return;
    if (it.vao && extVao) extVao.deleteVertexArrayOES(it.vao);
    if (it.vaoD && extVao) extVao.deleteVertexArrayOES(it.vaoD);
    if (it.vbo) gl.deleteBuffer(it.vbo);
    if (it.vboD) gl.deleteBuffer(it.vboD);
    if (it.ibo) gl.deleteBuffer(it.ibo);
    it.vao = it.vbo = it.ibo = it.vaoD = it.vboD = null;
  };

  /* give one scene's buffers back, whichever drawing it belongs to */
  const freeSceneObj = (sc, lost) => {
    if (!sc) return;
    sc.fpJob = null;                     /* any pending re-walk dies with it */
    if (gl && !lost) {
      for (const it of sc.stream) freeItem(it);
      for (const it of sc.delta) freeItem(it);
      for (const m of sc.meshes) {
        if (m.vbo) gl.deleteBuffer(m.vbo);
        if (m.vboD) gl.deleteBuffer(m.vboD);
      }
    }
    if (scenes.get(sc.doc) === sc) {
      scenes.delete(sc.doc);
      sceneBytes -= sceneBytesOf(sc);
      if (sceneBytes < 0) sceneBytes = 0;
    }
  };
  const freeScene = (lost) => {
    if (buildJob) { if (buildJob.raf) cancelAnimationFrame(buildJob.raf); buildJob = null; }
    freeDrag();                          /* a drag never outlives its scene */
    if (!scene) return;
    freeSceneObj(scene, lost);
    scene = null;
    defPureCache.clear();
  };
  const freeAllScenes = (lost) => {
    freeScene(lost);
    for (const sc of [...scenes.values()]) freeSceneObj(sc, lost);
    scenes.clear();
    sceneBytes = 0;
  };
  /* the budget, oldest-shown first, never the drawing on screen */
  const SCENE_DOCS = 8;                  /* and never more than this many */
  const evictScenes = () => {
    let guard = 32;
    while ((sceneBytes > GL_BYTE_CAP || scenes.size > SCENE_DOCS) &&
        scenes.size > 1 && guard-- > 0) {
      let victim = null;
      for (const sc of scenes.values()) {
        if (sc === scene || sc.doc === Nasj.doc) continue;
        /* an empty drawing's scene weighs nothing: while only the byte
           budget is over, taking it frees nothing and costs its owner an
           instant switch. The count cap is the one that takes it. */
        if (scenes.size <= SCENE_DOCS && !sceneBytesOf(sc)) continue;
        if (!victim || sc.use < victim.use) victim = sc;
      }
      if (!victim) break;
      evicted++;
      freeSceneObj(victim, false);
    }
  };
  /* the live scene steps aside: what it owes when it comes back is written
     on it, and the module's pending-edit state is handed to whoever is
     next. A scene parked with signals against it sweeps on its return. */
  const parkScene = () => {
    if (!scene) return;
    /* a pending fingerprint re-walk PAUSES with the scene: its ticks stop
       (they read entities through the id index, and running against a
       background drawing would thrash the live one's), and bindScene
       resumes the same iterator — a parked drawing cannot move. */
    /* only an ENTITY signal makes a parked scene owe a sweep. `dirty` on
       its own says no more than "run the environment and palette checks",
       and those are re-run for whichever scene is bound next anyway. */
    scene.stale = !!(scene.stale || pend.full || pend.unhinted ||
      pend.edit || pend.ids.size);
    scene.gen = Nasj.docGen ? Nasj.docGen(scene.doc) : 0;
    scene.use = ++sceneUse;
    pendReset();
    dirty = false;
    freeDrag();
    scene = null;
  };
  /* and takes the incoming drawing's, if it still has one. A generation
     that moved while the drawing was parked (it was edited from another
     tab's flow) is answered with the full sweep, exactly as any unhinted
     cycle is — never with a wrong picture. */
  const bindScene = (doc) => {
    const sc = scenes.get(doc);
    if (!sc) return false;
    scene = sc;
    scene.use = ++sceneUse;
    scenes.delete(doc); scenes.set(doc, sc);      /* LRU touch */
    const gen = Nasj.docGen ? Nasj.docGen(doc) : 0;
    if (sc.stale || sc.gen !== gen) { sc.stale = false; pend.full = true; }
    sc.gen = gen;
    /* the environment and the palette are the app's, not the drawing's: a
       theme, a lineweight display toggle or a tier step-down while this
       scene was parked still has to be answered. That check is the cheap
       half of ensureFresh and runs on the next sync either way. */
    dirty = true;
    /* the presented canvas and its remainder texture belong to the drawing
       that was on screen; the next frame uploads this one's */
    remLast = null; remGen = -1; marqOwned = false; marqKey = '';
    if (sc.fpJob) fpJobPump(sc);         /* a paused re-walk picks back up */
    return true;
  };

  const emitDoc = (reason) => {
    if (typeof Nasj.emit === 'function') Nasj.emit('nasj:doc', { reason });
    else window.dispatchEvent(new CustomEvent('nasj:doc', { detail: { reason } }));
  };

  /* ---------------- styles & z groups ----------------
   * A vertex's style: baked rgba + liC (palette index | flag<<14) + two
   * visibility layer indices + the stream z group. One scratch object —
   * the sinks copy the fields immediately. */
  const stx = { r: 255, g: 255, b: 255, a: 255, c: 0, v1: 0, v2: 0 };
  const F = 16384;
  const fillAlpha = (ent) => {
    if (ent.color === '@bg') return 255;
    const tr = Math.min(90, Math.max(0, Number(ent.transp) || 0));
    /* a solid fill is ink: opaque unless the hatch's own Transparency
       says otherwise — the same rule drawHatchPattern paints by */
    return Math.max(1, Math.round(255 * (1 - tr / 100)));
  };

  /* z groups: bumped when the emitted kind (line / opaque fill / alpha
     fill) changes along the stream — order only matters at those seams.
     Rebuilds replay an entity's recorded groups instead of allocating. */
  const zBegin = (bs, plan) => {
    bs.entLast = null;
    bs.entZ = null;
    bs.zPlan = plan === undefined ? null : (plan == null ? 1 : plan);
    bs.zCur = -1;
  };
  const zTake = (bs, kind) => {
    if (kind !== bs.entLast) {
      bs.entLast = kind;
      bs.zCur++;
      if (bs.zPlan == null) {
        if (kind !== bs.lastKind) {
          bs.lastKind = kind;
          if (bs.zNext < bs.zMax) bs.zNext++;
        }
        const z = bs.zNext;
        if (bs.entZ == null) bs.entZ = z;
        else if (Array.isArray(bs.entZ)) { if (bs.entZ[bs.entZ.length - 1] !== z) bs.entZ.push(z); }
        else if (bs.entZ !== z) bs.entZ = [bs.entZ, z];
      }
    }
    if (bs.zPlan != null) {
      const p = bs.zPlan;
      return Array.isArray(p) ? p[Math.min(bs.zCur, p.length - 1)] : p;
    }
    return bs.zNext;
  };

  /* the '@bg' wipeout guard: a wipeout the GL layer owns cannot mask the
     2D-owned content composited ABOVE the GL frame — so a candidate whose
     box overlaps any EARLIER 2D-owned entity is demoted to the 2D layer,
     where doc order still rules. Bounds are computed lazily: most builds
     never ask (BLOCKS holds 17 wipeouts against ~6k 2D entities). */
  /* Whether anything the 2D layer already owns sits under this fill. The
     first call measures every 2D entity the walk has left behind — and on
     a block library that is 158ms in one bite (measured), because each of
     them may materialize a whole definition to give its box. The boxes are
     kept, so only the first call is long; behind the open's bar it takes
     the slice deadline like everything else and comes back where it
     stopped, keyed on the rectangle it was asked about. */
  const guardBlocked = (bs, x0, y0, x1, y1, deadline) => {
    if (!isFinite(x0 + y0 + x1 + y1)) return true;
    const E = bs.twoD, B = bs.twoDB, G = Nasj.geom;
    let J = bs.gbJob;
    if (J && (J.x0 !== x0 || J.y0 !== y0 || J.x1 !== x1 || J.y1 !== y1 ||
      J.n !== E.length)) J = null;
    let i = J ? J.i : 0;
    let ops = 0;
    for (; i < E.length; i++) {
      /* ONE box can cost a whole definition's materialization — 4.5ms of
         it, measured — so the deadline is asked about between every one:
         the clock read is nothing beside the work it bounds */
      if (deadline && ops++ && performance.now() > deadline) {
        bs.gbJob = { x0, y0, x1, y1, n: E.length, i };
        return PENDING;
      }
      let b = B[i];
      if (b === undefined) {
        try { b = G.entityBounds(E[i]) || null; } catch (e) { b = null; }
        B[i] = b;
      }
      if (!b || !isFinite(b.minx + b.miny + b.maxx + b.maxy)) continue;
      if (b.maxx >= x0 && b.minx <= x1 && b.maxy >= y0 && b.miny <= y1) {
        bs.gbJob = null;
        return true;
      }
    }
    bs.gbJob = null;
    return false;
  };

  /* ---------------- def CPU records ----------------
   * Flat segments AND triangles in def-local coords, in child order, cut
   * into homogeneous runs so a bake replays the exact stream interleaving.
   * Per-element meta: packed color (rgba; alpha = fill alpha) and packed
   * layer word (liC | liV1<<16). liC's flag: 0 baked, 1 palette, 2 '@bg'
   * uniform, 3 ByBlock (resolved to the reference's style at bake; kept
   * for the instanced shader). */
  const childVisLi = (bs, child) => {
    const id = child.layerId;
    if (id == null || id === '0') return 0;      /* follows the reference */
    return bs.layerIdx.get(id) || 0;
  };
  const childColorMeta = (bs, child) => {
    if (child.color === 'ByBlock') return { c: F_BYBLOCK * F, r: 255, g: 255, b: 255 };
    if (child.color === '@bg') return { c: F_BG * F, r: 0, g: 0, b: 0 };
    if (child.color && child.color !== 'ByLayer') {
      const q = rgbOf(child.color);
      return { c: 0, r: q[0], g: q[1], b: q[2] };
    }
    const idx = bs.layerIdx.get(child.layerId);
    if (idx) return { c: F_PAL * F + idx, r: 255, g: 255, b: 255 };
    if (bs.lmap.has(child.layerId)) {            /* known layer, noPal mode */
      const q = rgbOf(bs.ops.resolveColor(bs.doc, child));
      return { c: 0, r: q[0], g: q[1], b: q[2] };
    }
    return { c: F_BYBLOCK * F, r: 255, g: 255, b: 255 };   /* ref's color */
  };

  /* PENDING: a definition big enough to run past the slice's deadline says
     so and comes back to exactly where it stopped. Only the open's sliced
     build ever passes a deadline; every other caller runs straight through
     and never sees this. */
  const PENDING = { pending: true };
  const buildDefCPU = (bs, name, deadline) => {
    const doc = bs.doc;
    const def = doc.blocks[name];
    tessTol = bs.tolWorld > 0 ? bs.tolWorld / (bs.defScale.get(name) || 1) : 0;
    let J = bs.dcJob;
    if (!J || J.name !== name || J.ents !== def.entities) {
      J = bs.dcJob = { name, ents: def.entities, ci: 0,
        sx: [], sc: [], sm: [], txy: [], tc: [], tm: [], runs: [],
        minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity,
        hasBg: false, cSolid: 0, cBg: 0 };
    }
    const sx = J.sx, sc = J.sc, sm = J.sm;
    const txy = J.txy, tc = J.tc, tm = J.tm;
    const runs = J.runs;
    let minx = J.minx, miny = J.miny, maxx = J.maxx, maxy = J.maxy;
    let hasBg = J.hasBg, cSolid = J.cSolid, cBg = J.cBg;
    const run = (t) => {
      const last = runs.length ? runs[runs.length - 1] : null;
      if (last && last.t === t) return last;
      const r = { t, i0: t === 0 ? sc.length : tc.length, n: 0 };
      runs.push(r);
      return r;
    };
    const grow = (x, y) => {
      if (x < minx) minx = x;
      if (y < miny) miny = y;
      if (x > maxx) maxx = x;
      if (y > maxy) maxy = y;
    };
    const ents = J.ents;
    const ci0 = J.ci;
    for (; J.ci < ents.length; J.ci++) {
      /* one child can be a hatch worth ten thousand triangles, so the
         deadline is asked about between every one — the clock read is
         nothing beside the tessellation it bounds */
      if (deadline && J.ci > ci0 && performance.now() > deadline) {
        J.minx = minx; J.miny = miny; J.maxx = maxx; J.maxy = maxy;
        J.hasBg = hasBg; J.cSolid = cSolid; J.cBg = cBg;
        return PENDING;
      }
      const child = ents[J.ci];
      if (!child) continue;
      if (child.type === 'insert') { bs.stats.nestedInDefs++; continue; }
      if (child.construction || child.type === 'bparam') continue;
      if (bs.childHidden(child)) continue;       /* noPal mode only */
      const vli = childVisLi(bs, child);
      if (child.type === 'hatch') {
        const loop = hatchLoop(child);
        if (!loop) continue;
        const tri = triangulate(loop, child.islands);
        if (!tri) continue;
        const isBg = child.color === '@bg';
        const meta = isBg ? { c: F_BG * F, r: 0, g: 0, b: 0 } : childColorMeta(bs, child);
        const a = fillAlpha(child);
        const packedC = meta.r | (meta.g << 8) | (meta.b << 16) | (a << 24);
        const packedM = meta.c | (vli << 16);
        const r = run(isBg ? 1 : 2);
        for (let i = 0; i < tri.length; i += 6) {
          txy.push(tri[i], tri[i + 1], tri[i + 2], tri[i + 3], tri[i + 4], tri[i + 5]);
          tc.push(packedC);
          tm.push(packedM);
          r.n++;
          grow(tri[i], tri[i + 1]);
          grow(tri[i + 2], tri[i + 3]);
          grow(tri[i + 4], tri[i + 5]);
        }
        if (isBg) { hasBg = true; cBg++; } else cSolid++;
        continue;
      }
      const rr = tessRuns(child);
      if (rr === null || !rr.length) continue;   /* pure defs only get here */
      const meta = childColorMeta(bs, child);
      const rgb = meta.r | (meta.g << 8) | (meta.b << 16);
      const packedM = meta.c | (vli << 16);
      const r = run(0);
      for (const rn of rr) {
        const P = rn.pts, n = P.length;
        if (n < 2) continue;
        const m = rn.closed ? n : n - 1;
        /* def-LOCAL run length; the reference's scale shifts the code */
        const packedC = rgb | (covCode(runLen(P, m, n)) << 24);
        for (let i = 0; i < m; i++) {
          const p = P[i], q = P[(i + 1) % n];
          sx.push(p.x, p.y, q.x, q.y);
          sc.push(packedC);
          sm.push(packedM);
          r.n++;
          grow(p.x, p.y);
          grow(q.x, q.y);
        }
      }
    }
    bs.dcJob = null;
    if ((!sc.length && !tc.length) || !isFinite(minx)) return null;
    return {
      runs,
      sx: new Float32Array(sx), sc: new Uint32Array(sc), sm: new Uint32Array(sm),
      txy: new Float32Array(txy), tc: new Uint32Array(tc), tm: new Uint32Array(tm),
      n: sc.length, nt: tc.length,
      minx, miny, maxx, maxy,
      hasFill: tc.length > 0, hasBg, cSolid, cBg
    };
  };

  /* GPU mesh for an instanced def (strokes only — a def with fills bakes,
     so its interleaving stays in true stream order): uint16 normalized to
     def bounds when the quantization step stays under a quarter of the
     chord budget; f32 anchored at the center otherwise. */
  const buildDefMeshGPU = (bs, name, cpu) => {
    const spx = Math.max(cpu.maxx - cpu.minx, 1e-12);
    const spy = Math.max(cpu.maxy - cpu.miny, 1e-12);
    const quant = bs.tolWorld > 0 &&
      Math.max(spx, spy) * (bs.defScale.get(name) || 1) / 65535 <= bs.tolWorld / 4;
    let mesh;
    const push = (sink, map, step) => {
      for (let i = 0; i < cpu.n; i += (step || 1)) {
        const c = cpu.sc[i], m = cpu.sm[i];
        stx.r = c & 255; stx.g = (c >> 8) & 255; stx.b = (c >> 16) & 255; stx.a = 255;
        stx.c = m & 0xffff; stx.v1 = m >>> 16;
        map(cpu.sx[i * 4], cpu.sx[i * 4 + 1]);
        map(cpu.sx[i * 4 + 2], cpu.sx[i * 4 + 3]);
      }
    };
    /* phase 5 (tier B/C): the mesh's decimated companion — same layout,
       every DECIM_K-th segment; drawn when instances are sub-pixel-dense */
    const wantD = bs.qtier !== 'A' && cpu.n >= DECIM_MIN;
    let avgSegW = 0;
    if (wantD) {
      const S = cpu.sx;
      let len = 0;
      for (let i = 0; i < cpu.n; i++) {
        const j = i * 4;
        len += Math.abs(S[j + 2] - S[j]) + Math.abs(S[j + 3] - S[j + 1]);
      }
      avgSegW = len / cpu.n;
    }
    if (quant) {
      const kx = 65535 / spx, ky = 65535 / spy;
      const mapQ = (sk) => (x, y) => sk.push(
        Math.max(0, Math.min(65535, Math.round((x - cpu.minx) * kx))),
        Math.max(0, Math.min(65535, Math.round((y - cpu.miny) * ky))), stx);
      const sink = mkSink16(cpu.n * 2);
      push(sink, mapQ(sink));
      mesh = { name, quant: true, qx: spx, qy: spy, ox: cpu.minx, oy: cpu.miny,
        vbo: gl.createBuffer(), count: sink.n, bytes: sink.n * QSTRIDE, segs: cpu.n };
      uploadBytes(mesh.vbo, new Uint8Array(sink.buf, 0, sink.n * QSTRIDE));
      if (wantD) {
        const sinkD = mkSink16(Math.ceil(cpu.n / DECIM_K) * 2 + 2);
        push(sinkD, mapQ(sinkD), DECIM_K);
        mesh.vboD = gl.createBuffer();
        uploadBytes(mesh.vboD, new Uint8Array(sinkD.buf, 0, sinkD.n * QSTRIDE));
        mesh.countD = sinkD.n;
        mesh.bytesD = sinkD.n * QSTRIDE;
      }
    } else {
      const ax = (cpu.minx + cpu.maxx) / 2, ay = (cpu.miny + cpu.maxy) / 2;
      const mapF = (sk) => (x, y) => sk.push(x - ax, y - ay, stx);
      const sink = mkSinkM(cpu.n * 2);
      push(sink, mapF(sink));
      mesh = { name, quant: false, qx: 1, qy: 1, ox: ax, oy: ay,
        vbo: gl.createBuffer(), count: sink.n, bytes: sink.n * MSTRIDE, segs: cpu.n };
      uploadBytes(mesh.vbo, new Uint8Array(sink.buf, 0, sink.n * MSTRIDE));
      if (wantD) {
        const sinkD = mkSinkM(Math.ceil(cpu.n / DECIM_K) * 2 + 2);
        push(sinkD, mapF(sinkD), DECIM_K);
        mesh.vboD = gl.createBuffer();
        uploadBytes(mesh.vboD, new Uint8Array(sinkD.buf, 0, sinkD.n * MSTRIDE));
        mesh.countD = sinkD.n;
        mesh.bytesD = sinkD.n * MSTRIDE;
      }
    }
    mesh.avgSegW = avgSegW;
    return mesh;
  };

  /* insert placement 2x3: world = MÂ·local + T (insertXform math, doubles) */
  const placementOf = (ent, def) => {
    const sx = typeof ent.sx === 'number' ? ent.sx : 1;
    const sy = typeof ent.sy === 'number' ? ent.sy : 1;
    const rot = ent.rot || 0, co = Math.cos(rot), si = Math.sin(rot);
    const base = def.base || { x: 0, y: 0 };
    const m00 = sx * co, m10 = sx * si, m01 = -sy * si, m11 = sy * co;
    return {
      m00, m10, m01, m11,
      tx: ent.p.x - (m00 * base.x + m01 * base.y),
      ty: ent.p.y - (m10 * base.x + m11 * base.y)
    };
  };

  /* ---------------- the build state ---------------- */
  const newBuildState = (doc) => {
    const ops = Nasj.docOps;
    const lmap = new Map(doc.layers.map((l) => [l.id, l]));
    const layerIdx = buildLayerIdx(doc);
    const noPal = layerIdx.size === 0 && doc.layers.length > 0;
    const hid = new Set();
    if (noPal) for (const l of doc.layers) if (l && !(l.on && !l.frozen)) hid.add(l.id);
    const hidIds = Nasj.hiddenIds;
    const bs = {
      doc, ops, lmap, layerIdx, noPal,
      qtier: effTier(),                  /* phase 5: the build's quality tier */
      /* the signal counter this build starts from: anything that arrived
         before it is read BY it (see finishBuild's absorb) */
      seq0: pend.sigSeq,
      t0: performance.now(),
      heap0: performance.memory ? performance.memory.usedJSHeapSize : 0,
      ents: ops.modelEntities(doc),
      envSig: envSigNow(doc),
      /* a COPY, not the live set: the build is sliced, and a drag's dimOn
         can mutate Nasj.hiddenIds mid-build — the snapshot is what the
         first sync's diff reconciles against (per-id, through records, so
         a mixed read heals rather than lingers) */
      hidSig: hidSigNow(),
      hidSet: new Set(Nasj.hiddenIds || []),
      palSig: palSigNow(doc),
      phase: 'scan', i: 0,
      xs: [], ys: [],
      useCount: new Map(), defScale: new Map(),
      span: 0, tolWorld: 0,
      stream: [], chunks: [], meshes: [],
      defCPU: new Map(),                 /* name -> cpu | null */
      defInfo: new Map(),                /* name -> {instanced, mesh, items} */
      records: new Map(),                /* id -> {fp, w, z} */
      orderIds: [],
      chunk: null,
      skipped: {},
      zNext: 0, lastKind: null, zMax: Z_CAP,
      entLast: null, entZ: null, zPlan: null, zCur: -1,
      twoD: [], twoDB: [],
      demoted: new Set(),
      hatchIds: new Set(),
      stats: { segsLoose: 0, segsDef: 0, segsBaked: 0, inserts: 0, instanced: 0,
        baked: 0, inlinedRefs: 0, nestedInDefs: 0, loose: 0, owned2D: 0,
        fillsLoose: 0, fillsLooseBg: 0, fillTris: 0, defHatchesOwned: 0,
        defBgOwned: 0, demotedBg: 0, fillDefsBaked: 0 },
      tWalk: 0, tScan: 0,
      /* noPal: hidden layers leave the build (phase-2 behavior, envSig
         rebuilds on toggle). With the palette they stay in and the texture
         alpha hides them. Per-entity isolation always excludes. */
      entHidden: (e) => (noPal && e.layerId != null && hid.has(e.layerId)) ||
        (hidIds && hidIds.has(e.id)),
      childHidden: (c) => noPal && c.layerId != null && c.layerId !== '0' && hid.has(c.layerId),
      childColor: (child, refCol) => {
        if (child.color === 'ByBlock') return refCol;
        if (child.color && child.color !== 'ByLayer') return child.color;
        if (lmap.has(child.layerId)) return ops.resolveColor(doc, child);
        return refCol;
      }
    };
    return bs;
  };

  const skip = (bs, t, n) => { bs.skipped[t] = (bs.skipped[t] || 0) + (n || 1); };

  const chunkVerts = (ck) =>
    (ck.sL ? ck.sL.n : 0) + (ck.sT ? ck.sT.n : 0) + (ck.sA ? ck.sA.n : 0);
  const chunkSink = (ck, kind) => {
    if (kind === 'L') return ck.sL || (ck.sL = mkSink(8192));
    if (kind === 'T') return ck.sT || (ck.sT = mkSink(512));
    return ck.sA || (ck.sA = mkSink(512));
  };
  /* concat the three sinks (lines, opaque tris, alpha tris) into one VBO.
     wantD (phase 5, tier B/C builds): a decimated far-zoom companion —
     every DECIM_K-th LINE segment in its own small VBO, drawn instead of
     the full one when the chunk is sub-pixel-dense on screen. */
  const chunkUpload = (ck, wantD) => {
    const nL = ck.sL ? ck.sL.n : 0, nT = ck.sT ? ck.sT.n : 0, nA = ck.sA ? ck.sA.n : 0;
    const total = nL + nT + nA;
    const u8 = new Uint8Array(total * VSTRIDE);
    let o = 0;
    for (const s of [ck.sL, ck.sT, ck.sA]) {
      if (!s || !s.n) continue;
      u8.set(new Uint8Array(s.buf, 0, s.n * VSTRIDE), o);
      o += s.n * VSTRIDE;
    }
    if (!ck.vbo) ck.vbo = gl.createBuffer();
    uploadBytes(ck.vbo, u8);
    ck.nL = nL; ck.nT = nT; ck.nA = nA;
    ck.count = total;
    ck.bytes = total * VSTRIDE;
    if (wantD && nL >= DECIM_MIN * 2) {
      const segs = nL >> 1;
      const src = new Uint8Array(ck.sL.buf);
      const keep = Math.ceil(segs / DECIM_K);
      const d8 = new Uint8Array(keep * 2 * VSTRIDE);
      let od = 0;
      for (let s = 0; s < segs; s += DECIM_K) {
        d8.set(src.subarray(s * 2 * VSTRIDE, (s * 2 + 2) * VSTRIDE), od);
        od += 2 * VSTRIDE;
      }
      /* the decimation gate is the average segment's own screen size, not
         the chunk's span — a chunk that strays past the viewport must not
         thin geometry the eye can resolve (Manhattan length is plenty
         for a half-pixel threshold) */
      const f32 = new Float32Array(ck.sL.buf);
      let len = 0;
      for (let s = 0; s < segs; s++) {
        const o = s * 10;
        len += Math.abs(f32[o + 5] - f32[o]) + Math.abs(f32[o + 6] - f32[o + 1]);
      }
      ck.avgSegW = len / segs;
      const fresh = !ck.vboD;
      if (fresh) ck.vboD = gl.createBuffer();
      uploadBytes(ck.vboD, d8);
      ck.nLD = od / VSTRIDE;
      ck.bytesD = d8.byteLength;
      if (fresh && extVao) {
        if (ck.vaoD) extVao.deleteVertexArrayOES(ck.vaoD);
        ck.vaoD = extVao.createVertexArrayOES();
        extVao.bindVertexArrayOES(ck.vaoD);
        bindChunkVerts(ck.vboD);
        extVao.bindVertexArrayOES(null);
      }
    } else if (ck.vboD) {
      if (ck.vaoD && extVao) extVao.deleteVertexArrayOES(ck.vaoD);
      gl.deleteBuffer(ck.vboD);
      ck.vboD = ck.vaoD = null;
      ck.nLD = 0;
      ck.bytesD = 0;
    }
  };

  const flushChunk = (bs) => {
    const ck = bs.chunk;
    if (!ck || !chunkVerts(ck)) { bs.chunk = null; return; }
    chunkUpload(ck, bs.qtier !== 'A');
    ck.sL = ck.sT = ck.sA = null;        /* CPU copy dropped: GPU owns it */
    bs.chunks.push(ck);
    bs.chunk = null;
  };
  const chunkFor = (bs, x, y, need) => {
    const ck = bs.chunk;
    if (ck && (Math.abs(x - ck.ax) > ANCHOR_R || Math.abs(y - ck.ay) > ANCHOR_R ||
        chunkVerts(ck) + need > CHUNK_VERTS)) flushChunk(bs);
    if (!bs.chunk) {
      bs.chunk = { kind: 'chunk', ax: x, ay: y, sL: null, sT: null, sA: null,
        vbo: null, count: 0, nL: 0, nT: 0, nA: 0, ids: [], vao: null,
        hasInline: false,
        bx0: Infinity, by0: Infinity, bx1: -Infinity, by1: -Infinity };
      bs.stream.push(bs.chunk);
    }
    return bs.chunk;
  };

  /* world-space bounds per draw item: the render culls whole items, so a
     deep zoom pays only the chunks actually in view */
  const growB = (it, x0, y0, x1, y1) => {
    if (x0 < it.bx0) it.bx0 = x0;
    if (y0 < it.by0) it.by0 = y0;
    if (x1 > it.bx1) it.bx1 = x1;
    if (y1 > it.by1) it.by1 = y1;
  };

  /* the run's own world length: what the coverage rule measures */
  const runLen = (P, m, n) => {
    let L = 0;
    for (let i = 0; i < m; i++) {
      const p = P[i], q = P[(i + 1) % n];
      L += Math.hypot(q.x - p.x, q.y - p.y);
    }
    return L;
  };

  const sinkRuns = (bs, ck, runs, z) => {
    const sink = chunkSink(ck, 'L');
    const ax = ck.ax, ay = ck.ay;
    let segs = 0;
    for (const run of runs) {
      const P = run.pts, n = P.length;
      if (n < 2) continue;
      const m = run.closed ? n : n - 1;
      sink.ensure(m * 2);
      stx.a = covCode(runLen(P, m, n));
      for (let i = 0; i < m; i++) {
        const p = P[i], q = P[(i + 1) % n];
        sink.push(p.x - ax, p.y - ay, stx, z);
        sink.push(q.x - ax, q.y - ay, stx, z);
        segs++;
      }
    }
    return segs;
  };

  /* the style of a LOOSE entity (stx mutated in place) */
  const looseStyle = (bs, ent) => {
    stx.a = 255;
    stx.v1 = bs.layerIdx.get(ent.layerId) || 0;
    stx.v2 = 0;
    const col = ent.color;
    if (col === '@bg') { stx.c = F_BG * F; stx.r = stx.g = stx.b = 0; return; }
    if (col && col !== 'ByLayer' && col !== 'ByBlock') {
      const q = rgbOf(col);
      stx.c = 0; stx.r = q[0]; stx.g = q[1]; stx.b = q[2];
      return;
    }
    if ((!col || col === 'ByLayer') && stx.v1) {  /* palette-driven */
      stx.c = F_PAL * F + stx.v1;
      stx.r = stx.g = stx.b = 255;
      return;
    }
    const q = rgbOf(bs.ops.resolveColor(bs.doc, ent));   /* ByBlock / noPal */
    stx.c = 0; stx.r = q[0]; stx.g = q[1]; stx.b = q[2];
  };

  /* a loose entity into a chunk (into `into` when a rebuild pins one).
     Returns {chunk, segs}, null (nothing drawable) or 'demote' (a '@bg'
     hatch that would mask earlier 2D-owned content). */
  const addLoose = (bs, ent, into) => {
    tessTol = bs.tolWorld;
    if (ent.type === 'hatch') {
      const loop = hatchLoop(ent);
      if (!loop) return null;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of loop) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
      }
      const isBg = ent.color === '@bg';
      if (isBg && bs.twoD && guardBlocked(bs, x0, y0, x1, y1)) return 'demote';
      const tri = triangulate(loop, ent.islands);
      /* a boundary the clipper cannot triangulate cleanly is NOT invisible:
         the 2D layer keeps the whole hatch and fills it even-odd */
      if (!tri) return 'demote';
      const nv = tri.length / 2;
      const ck = typeof into === 'function' ? into(loop[0].x, loop[0].y, nv)
        : (into || chunkFor(bs, loop[0].x, loop[0].y, nv));
      looseStyle(bs, ent);
      if (isBg) { stx.c = F_BG * F; }
      stx.a = fillAlpha(ent);
      const z = zTake(bs, isBg ? 'T' : 'A');
      const sink = chunkSink(ck, isBg ? 'T' : 'A');
      sink.ensure(nv);
      for (let i = 0; i < tri.length; i += 2) {
        sink.push(tri[i] - ck.ax, tri[i + 1] - ck.ay, stx, z);
      }
      growB(ck, x0, y0, x1, y1);
      return { chunk: ck, segs: nv / 3, fill: true };
    }
    const runs = tessRuns(ent);
    if (runs === null || !runs.length) return null;
    const p0 = runs[0].pts[0];
    if (!p0 || !isFinite(p0.x + p0.y)) return null;
    let need = 0;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of runs) {
      need += r.pts.length * 2;
      for (const p of r.pts) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
      }
    }
    const ck = typeof into === 'function' ? into(p0.x, p0.y, need)
      : (into || chunkFor(bs, p0.x, p0.y, need));
    looseStyle(bs, ent);
    const z = zTake(bs, 'L');
    const segs = sinkRuns(bs, ck, runs, z);
    if (segs) growB(ck, x0, y0, x1, y1);
    return segs ? { chunk: ck, segs } : null;
  };

  /* the reference's own color word, for ByBlock children and inline refs */
  const refColorMeta = (bs, ent) => {
    const idx = bs.layerIdx.get(ent.layerId) || 0;
    const byLayer = !ent.color || ent.color === 'ByLayer';
    if (byLayer && idx) return { c: F_PAL * F + idx, r: 255, g: 255, b: 255, li: idx };
    const q = rgbOf(bs.ops.resolveColor(bs.doc, ent));
    return { c: 0, r: q[0], g: q[1], b: q[2], li: idx };
  };

  /* a pure def baked through one reference's placement, in stream order —
     the run list replays the def's own line/fill interleaving. Returns
     'demote' when the def carries a wipeout that would mask earlier
     2D-owned content. */
  const bakeRef = (bs, ent, cpu, into, deadline) => {
    /* a reference of a sixty-thousand-child definition is 170ms of vertex
       pushing in one go (measured): behind the open's bar it stops at the
       deadline and comes back at the same run and the same element. The
       chunk it opened, the z group it took and the box it grew are all
       held on the job, so a resumed bake writes exactly what an
       uninterrupted one writes, in the same order. */
    let J = bs.brJob;
    if (J && J.ent !== ent) J = bs.brJob = null;
    if (!J) {
      const def = bs.doc.blocks[ent.name];
      const P = placementOf(ent, def);
      const corners = [[cpu.minx, cpu.miny], [cpu.maxx, cpu.miny],
        [cpu.minx, cpu.maxy], [cpu.maxx, cpu.maxy]];
      let wx0 = Infinity, wy0 = Infinity, wx1 = -Infinity, wy1 = -Infinity;
      for (const [lx, ly] of corners) {
        const x = P.m00 * lx + P.m01 * ly + P.tx;
        const y = P.m10 * lx + P.m11 * ly + P.ty;
        if (x < wx0) wx0 = x;
        if (y < wy0) wy0 = y;
        if (x > wx1) wx1 = x;
        if (y > wy1) wy1 = y;
      }
      if (cpu.hasBg && bs.twoD) {
        const g = guardBlocked(bs, wx0, wy0, wx1, wy1, deadline);
        if (g === PENDING) return PENDING;
        if (g) return 'demote';
      }
      const S0 = cpu.sx;
      const ck0 = typeof into === 'function'
        ? into(P.m00 * S0[0] + P.m01 * S0[1] + P.tx || wx0,
            P.m10 * S0[0] + P.m11 * S0[1] + P.ty || wy0, cpu.n * 2 + cpu.nt * 3)
        : (into || chunkFor(bs, cpu.n ? P.m00 * S0[0] + P.m01 * S0[1] + P.tx : wx0,
            cpu.n ? P.m10 * S0[0] + P.m11 * S0[1] + P.ty : wy0, cpu.n * 2 + cpu.nt * 3));
      J = bs.brJob = { ent, P, ck: ck0, wx0, wy0, wx1, wy1,
        ref: refColorMeta(bs, ent), ri: 0, ei: -1, z: 0, sink: null };
    }
    const P = J.P, ck = J.ck, ref = J.ref;
    const wx0 = J.wx0, wy0 = J.wy0, wx1 = J.wx1, wy1 = J.wy1;
    const refLi = ref.li;
    const S = cpu.sx, C = cpu.sc, Mt = cpu.sm;
    const ax = ck.ax, ay = ck.ay;
    /* the placement's uniform scale: a constant offset on every run's
       def-local coverage code (the codes are logarithmic) */
    const dSc = covShift(Math.sqrt(Math.abs(P.m00 * P.m11 - P.m01 * P.m10)));
    /* resolve one element's meta into stx (ByBlock takes the ref's word) */
    const apply = (pc, pm, cov) => {
      let c = pm & 0xffff;
      if ((c >>> 14) === F_BYBLOCK) {
        stx.c = ref.c; stx.r = ref.r; stx.g = ref.g; stx.b = ref.b;
      } else {
        stx.c = c;
        stx.r = pc & 255; stx.g = (pc >> 8) & 255; stx.b = (pc >> 16) & 255;
      }
      const a = (pc >>> 24) & 255;
      stx.a = cov ? Math.max(1, Math.min(255, a + dSc)) : a;
      stx.v1 = pm >>> 16;
      stx.v2 = refLi;
    };
    /* a definition whose runs alternate stroke and fill can have tens of
       thousands of them, each one element long: the deadline is checked
       between runs as well as inside them, or the outer walk is the
       unbounded one */
    const ri0 = J.ri;
    for (; J.ri < cpu.runs.length; J.ri++) {
      if (deadline && J.ei < 0 && J.ri > ri0 &&
          performance.now() > deadline) return PENDING;
      const r = cpu.runs[J.ri];
      if (r.t === 0) {
        if (J.ei < 0) {
          J.z = zTake(bs, 'L');
          J.sink = chunkSink(ck, 'L');
          J.sink.ensure(r.n * 2);
          J.ei = r.i0;
        }
        const z = J.z, sink = J.sink;
        for (let i = J.ei; i < r.i0 + r.n; i++) {
          if (deadline && !(i & 511) && i > J.ei && performance.now() > deadline) {
            J.ei = i;
            return PENDING;
          }
          apply(C[i], Mt[i], true);
          const j = i * 4;
          sink.push(P.m00 * S[j] + P.m01 * S[j + 1] + P.tx - ax,
            P.m10 * S[j] + P.m11 * S[j + 1] + P.ty - ay, stx, z);
          sink.push(P.m00 * S[j + 2] + P.m01 * S[j + 3] + P.tx - ax,
            P.m10 * S[j + 2] + P.m11 * S[j + 3] + P.ty - ay, stx, z);
        }
        J.ei = -1;
      } else {
        const kind = r.t === 1 ? 'T' : 'A';
        if (J.ei < 0) {
          J.z = zTake(bs, kind);
          J.sink = chunkSink(ck, kind);
          J.sink.ensure(r.n * 3);
          J.ei = r.i0;
        }
        const z = J.z, sink = J.sink;
        const T = cpu.txy, TC = cpu.tc, TM = cpu.tm;
        for (let i = J.ei; i < r.i0 + r.n; i++) {
          if (deadline && !(i & 511) && i > J.ei && performance.now() > deadline) {
            J.ei = i;
            return PENDING;
          }
          apply(TC[i], TM[i]);
          for (let v = 0; v < 3; v++) {
            const j = i * 6 + v * 2;
            sink.push(P.m00 * T[j] + P.m01 * T[j + 1] + P.tx - ax,
              P.m10 * T[j] + P.m11 * T[j + 1] + P.ty - ay, stx, z);
          }
        }
        J.ei = -1;
      }
    }
    bs.brJob = null;
    growB(ck, wx0, wy0, wx1, wy1);
    return { chunk: ck, segs: cpu.n, tris: cpu.nt };
  };

  /* a dynamic reference of a pure def: materialized world children through
     the app's own insertEntities (exact squash/mirror/dyn/vis behavior),
     collected first so the whole reference lands in ONE chunk. Colors are
     BAKED here (a palette edit rebuilds inline chunks anyway, because
     insertEntities filters hidden children at materialization); the
     reference's own layer still gates visibility through liV2. */
  const inlineRef = (bs, ent, into) => {
    bs.stats.inlinedRefs++;
    const refCol = bs.ops.resolveColor(bs.doc, ent);
    const refLi = bs.layerIdx.get(ent.layerId) || 0;
    tessTol = bs.tolWorld;
    const packs = [];
    let need = 0, p0 = null, hasBg = false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (x, y) => {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    };
    for (const child of Nasj.geom.insertEntities(ent, bs.doc)) {
      if (child.type === 'insert') continue;
      if (child.type === 'hatch') {
        if (!hatchOwnable(child)) continue;       /* impure defs never inline */
        const loop = hatchLoop(child);
        if (!loop) continue;
        const tri = triangulate(loop, child.islands);
        if (!tri) continue;
        const isBg = child.color === '@bg';
        if (isBg) hasBg = true;
        if (!p0) p0 = { x: tri[0], y: tri[1] };
        for (let i = 0; i < tri.length; i += 2) grow(tri[i], tri[i + 1]);
        need += tri.length / 2;
        packs.push({ fill: true, isBg, tri, a: fillAlpha(child),
          col: isBg ? [0, 0, 0] : rgbOf(bs.childColor(child, refCol)) });
        continue;
      }
      const runs = tessRuns(child);
      if (runs === null || !runs.length) continue;
      if (!p0) p0 = runs[0].pts[0];
      for (const r of runs) {
        need += r.pts.length * 2;
        for (const p of r.pts) grow(p.x, p.y);
      }
      packs.push({ fill: false, runs, col: rgbOf(bs.childColor(child, refCol)) });
    }
    if (!packs.length || !p0 || !isFinite(p0.x + p0.y)) return null;
    if (hasBg && bs.twoD && guardBlocked(bs, x0, y0, x1, y1)) return 'demote';
    const ck = typeof into === 'function' ? into(p0.x, p0.y, need)
      : (into || chunkFor(bs, p0.x, p0.y, need));
    ck.hasInline = true;
    let segs = 0, tris = 0;
    for (const pk of packs) {
      stx.v1 = 0; stx.v2 = refLi;
      if (pk.fill) {
        stx.c = pk.isBg ? F_BG * F : 0;
        stx.r = pk.col[0]; stx.g = pk.col[1]; stx.b = pk.col[2];
        stx.a = pk.a;
        const z = zTake(bs, pk.isBg ? 'T' : 'A');
        const sink = chunkSink(ck, pk.isBg ? 'T' : 'A');
        sink.ensure(pk.tri.length / 2);
        for (let i = 0; i < pk.tri.length; i += 2) {
          sink.push(pk.tri[i] - ck.ax, pk.tri[i + 1] - ck.ay, stx, z);
        }
        tris += pk.tri.length / 6;
      } else {
        stx.c = 0; stx.a = 255;
        stx.r = pk.col[0]; stx.g = pk.col[1]; stx.b = pk.col[2];
        segs += sinkRuns(bs, ck, pk.runs, zTake(bs, 'L'));
      }
    }
    if (segs || tris) growB(ck, x0, y0, x1, y1);
    return (segs || tris) ? { chunk: ck, segs, tris } : null;
  };

  const defCPUFor = (bs, name, deadline) => {
    let cpu = bs.defCPU.get(name);
    if (cpu === undefined) {
      cpu = buildDefCPU(bs, name, deadline);
      if (cpu === PENDING) return PENDING;
      bs.defCPU.set(name, cpu);
      /* a def first met after the build joins the redefinition watch */
      if (scene && scene.defCPU === bs.defCPU && !scene.defsSig.has(name)) {
        const def = bs.doc.blocks[name];
        if (def && Array.isArray(def.entities)) scene.defsSig.set(name, fpDef(def.entities));
      }
    }
    return cpu;
  };

  const addInsert = (bs, ent, deadline) => {
    /* bs.pend: this reference was left mid-flight by a deadline and the
       walk is coming back to it — the counters it already moved must not
       move twice */
    if (!bs.pend) bs.stats.inserts++;
    const doc = bs.doc;
    const def = doc.blocks[ent.name];
    if (def.xref && def.xref.unloaded) return null;
    const dynamic = ent.dyn || ent.visState ||
      (def.visibility && Array.isArray(def.visibility.states) && def.visibility.states.length);
    if (dynamic) {
      const r = inlineRef(bs, ent);
      if (r && r !== 'demote') { bs.stats.segsLoose += r.segs; bs.stats.fillTris += r.tris || 0; }
      return r;
    }
    const cpu = defCPUFor(bs, ent.name, deadline);
    if (cpu === PENDING) return PENDING;
    if (!cpu) return null;               /* nothing drawable in the def */
    let info = bs.defInfo.get(ent.name);
    if (!info) {
      /* the collapse rule (phase-2 contract a) + the phase-3 fill rule:
         instanced only when the def is shared, heavy AND stroke-only — a
         fill inside an instanced group would draw at the group's one
         stream position and mask out of order, so fill defs always bake */
      const instanced = (bs.useCount.get(ent.name) || 0) >= 2 &&
        cpu.n >= BAKE_MAX_SEGS && !cpu.hasFill;
      info = { instanced, mesh: null, items: [] };
      if (instanced) {
        info.mesh = buildDefMeshGPU(bs, ent.name, cpu);
        bs.meshes.push(info.mesh);
        bs.stats.segsDef += cpu.n;
      }
      bs.defInfo.set(ent.name, info);
      if (cpu.hasFill) bs.stats.fillDefsBaked++;
    }
    if (!info.instanced) {
      const r = bakeRef(bs, ent, cpu, undefined, deadline);
      if (r === PENDING) return PENDING;
      if (r && r !== 'demote') {
        bs.stats.baked++;
        bs.stats.segsBaked += r.segs;
        bs.stats.segsLoose += r.segs;
        bs.stats.fillTris += r.tris || 0;
        if (cpu.hasFill) {
          bs.stats.defHatchesOwned += cpu.cSolid;
          bs.stats.defBgOwned += cpu.cBg;
        }
      }
      return r;
    }
    /* instanced: the group draws at its first reference's stream position */
    const mesh = info.mesh;
    const P = placementOf(ent, bs.doc.blocks[ent.name]);
    let m00 = P.m00, m10 = P.m10, m01 = P.m01, m11 = P.m11;
    const dx = mesh.ox, dy = mesh.oy;
    const tx = P.tx + m00 * dx + m01 * dy;
    const ty = P.ty + m10 * dx + m11 * dy;
    m00 *= mesh.qx; m10 *= mesh.qx; m01 *= mesh.qy; m11 *= mesh.qy;
    let it = null;
    for (const cand of info.items) {
      if (Math.abs(tx - cand.ax) <= ANCHOR_R && Math.abs(ty - cand.ay) <= ANCHOR_R) { it = cand; break; }
    }
    const z = zTake(bs, 'L');
    if (!it) {
      it = { kind: 'inst', name: ent.name, mesh, ax: tx, ay: ty, recs: [],
        ibo: null, n: 0, vao: null, z, sMax: 0,
        bx0: Infinity, by0: Infinity, bx1: -Infinity, by1: -Infinity };
      info.items.push(it);
      bs.stream.push(it);
    }
    const kS = Math.max(Math.abs(typeof ent.sx === 'number' ? ent.sx : 1),
      Math.abs(typeof ent.sy === 'number' ? ent.sy : 1)) || 1;
    if (kS > it.sMax) it.sMax = kS;
    const ref = refColorMeta(bs, ent);
    const il = ref.li + ((ref.c >>> 14) === F_PAL ? F : 0);
    it.recs.push(m00, m10, m01, m11, tx - it.ax, ty - it.ay,
      ref.r | (ref.g << 8) | (ref.b << 16), il);
    for (const [lx, ly] of [[cpu.minx, cpu.miny], [cpu.maxx, cpu.miny],
      [cpu.minx, cpu.maxy], [cpu.maxx, cpu.maxy]]) {
      const x = P.m00 * lx + P.m01 * ly + P.tx;
      const y = P.m10 * lx + P.m11 * ly + P.ty;
      growB(it, x, y, x, y);
    }
    bs.stats.instanced++;
    return { inst: ent.name };
  };

  const uploadInstItem = (it) => {
    const n = it.recs.length / 8;
    const buf = new ArrayBuffer(n * ISTRIDE);
    const f = new Float32Array(buf), u = new Uint8Array(buf), h = new Uint16Array(buf);
    for (let i = 0; i < n; i++) {
      const s = i * 8, o = i * 8;
      for (let k = 0; k < 6; k++) f[o + k] = it.recs[s + k];
      const c = it.recs[s + 6];
      u[i * ISTRIDE + 24] = c & 255;
      u[i * ISTRIDE + 25] = (c >> 8) & 255;
      u[i * ISTRIDE + 26] = (c >> 16) & 255;
      u[i * ISTRIDE + 27] = 255;
      h[i * 16 + 14] = it.recs[s + 7];
      h[i * 16 + 15] = 0;
    }
    if (!it.ibo) it.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, it.ibo);
    gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
    it.n = n;
    it.recs = null;
    return n * ISTRIDE;
  };

  /* one sliced step of the build; returns true when finished */
  const buildStep = (bs, deadline) => {
    const doc = bs.doc;
    if (bs.phase === 'scan') {
      const rep = (p) => { if (p && isFinite(p.x + p.y)) { bs.xs.push(p.x); bs.ys.push(p.y); } };
      const t0 = performance.now();
      while (bs.i < bs.ents.length) {
        if (performance.now() > deadline) return false;
        const z = Math.min(bs.i + 2000, bs.ents.length);
        for (; bs.i < z; bs.i++) {
          const e = bs.ents[bs.i];
          if (!e || bs.entHidden(e)) continue;
          if (e.type === 'insert') {
            bs.useCount.set(e.name, (bs.useCount.get(e.name) || 0) + 1);
            const k = Math.max(Math.abs(typeof e.sx === 'number' ? e.sx : 1),
              Math.abs(typeof e.sy === 'number' ? e.sy : 1)) || 1;
            if (k > (bs.defScale.get(e.name) || 0)) bs.defScale.set(e.name, k);
            rep(e.p);
          } else rep(e.a || e.c || e.p || (e.pts && e.pts[0]));
        }
      }
      bs.tScan += performance.now() - t0;
      /* the drawing's DENSE span (PoC): 5..95th-percentile cluster grown 2x
         wins when raw extents dwarf it — georeferenced junk stays out of
         the chord budget. Sampled: percentiles don't need every point. */
      const axisSpan = (a) => {
        if (!a.length) return 0;
        /* a typed sort, not a comparator sort: the same numbers in the same
           order, and 19ms of the open's freeze budget back (measured) */
        let s;
        if (a.length > 65536) {
          const st = Math.ceil(a.length / 65536);
          s = new Float64Array(Math.ceil(a.length / st));
          for (let i = 0, k = 0; i < a.length; i += st) s[k++] = a[i];
        } else s = Float64Array.from(a);
        s.sort();
        const full = s[s.length - 1] - s[0];
        const clus = (s[Math.floor(0.95 * (s.length - 1))] - s[Math.floor(0.05 * (s.length - 1))]) * 2;
        return (clus > 0 && full > 4 * clus) ? clus : full;
      };
      bs.span = Math.max(axisSpan(bs.xs), axisSpan(bs.ys));
      /* phase 5: the centralized chord budget scales with the quality tier —
         tier B doubles the sagitta tolerance (~29% fewer curve segments),
         tier C quadruples it (~50% fewer). Tier A is exactly as before. */
      bs.tolWorld = bs.span > 0 ? (bs.span / 200000) * (TESS_MUL[bs.qtier] || 1) : 0;
      bs.xs = bs.ys = null;
      bs.phase = 'walk';
      bs.i = 0;
      return false;
    }
    /* walk: the single ordered pass — chunks and baked refs in true stream
       order, instanced groups at their first reference */
    const t0 = performance.now();
    while (bs.i < bs.ents.length) {
      if (performance.now() > deadline) { bs.tWalk += performance.now() - t0; return false; }
      const ent = bs.ents[bs.i];
      if (!ent || bs.entHidden(ent)) { bs.i++; continue; }
      /* every ownable-shaped hatch joins the roll, even one sitting out
         for being selected — deselection must be able to call it back */
      if (ent.type === 'hatch' && hatchOwnable(ent)) bs.hatchIds.add(ent.id);
      if (!entOwnable(doc, ent, bs.lmap.get(ent.layerId))) {
        bs.stats.owned2D++;
        skip(bs, ent.type);
        bs.twoD.push(ent);
        bs.i++;
        continue;
      }
      /* ownable entities are recorded even when they yield no geometry
         (an insert of a def with nothing drawable, a zero-sweep arc) —
         an unrecorded ownable would look like an addition on every patch */
      /* a reference of a huge definition can run past the deadline: it says
         so, and the walk returns to THIS entity next slice. The z group it
         opened stays open, so the group is begun only on the first try. */
      if (!bs.pend) zBegin(bs);
      let w = null, demoted = false;
      if (ent.type === 'insert') {
        const r = addInsert(bs, ent, deadline);
        if (r === PENDING) { bs.pend = 1; bs.tWalk += performance.now() - t0; return false; }
        bs.pend = 0;
        if (r === 'demote') demoted = true;
        else if (r) w = r.inst ? r.inst : r.chunk;
      } else {
        const r = addLoose(bs, ent);
        if (r === 'demote') demoted = true;
        else if (r) {
          bs.stats.segsLoose += r.segs;
          if (r.fill) {
            bs.stats.fillsLoose++;
            if (ent.color === '@bg') bs.stats.fillsLooseBg++;
            bs.stats.fillTris += r.segs;
          } else bs.stats.loose++;
          w = r.chunk;
        }
      }
      if (demoted) {
        /* a wipeout over earlier 2D content: the 2D layer keeps it whole */
        bs.demoted.add(ent.id);
        bs.stats.demotedBg++;
        bs.stats.owned2D++;
        skip(bs, 'wipeout-2d');
        bs.twoD.push(ent);
        bs.i++;
        continue;
      }
      if (w && w.kind === 'chunk') {
        if (w.ids[w.ids.length - 1] !== ent.id) w.ids.push(ent.id);
      }
      bs.records.set(ent.id, { fp: fpEnt(ent), w, z: bs.entZ });
      bs.orderIds.push(ent.id);
      bs.i++;
    }
    bs.tWalk += performance.now() - t0;
    return true;
  };

  /* The finish — every item uploaded, every VAO made, every definition
   * fingerprinted — is as long as the walk that fed it (338ms, measured,
   * on a block library) and it used to run in one go the instant the walk
   * ended. Behind the open's progress bar that is a third of a second in
   * which the compositor never runs and the crosshair stands still, so it
   * takes a deadline too: resumable, one frame's worth per call, false
   * while there is more. Deadline 0 (or none) is the old straight-through
   * finish, which is what every other caller passes. */
  const finishBuild = (bs, deadline) => {
    if (!bs.fin) {
      flushChunk(bs);
      bs.fin = { phase: 0, i: 0, tUp: 0, sigKeys: null, defsSig: new Map(),
        instBytes: 0, defBytes: 0, chunkBytes: 0, defBytesQ: 0, defsQ: 0,
        hasAlpha: false, triBytes: 0,
        decimBytes: 0, decimChunks: 0, decimMeshes: 0 };
    }
    const F = bs.fin;
    const tUp0 = performance.now();
    const over = () => !!deadline && performance.now() > deadline;
    if (F.phase === 0) {
      for (; F.i < bs.stream.length; F.i++) {
        if (!(F.i & 31) && over()) { F.tUp += performance.now() - tUp0; return false; }
        const it = bs.stream[F.i];
        if (it.kind === 'chunk') {
          F.chunkBytes += it.bytes || 0;
          F.triBytes += (it.nT + it.nA) * VSTRIDE;
          if (it.nA) F.hasAlpha = true;
          if (it.nLD) { F.decimBytes += it.bytesD || 0; F.decimChunks++; }
          continue;
        }
        F.instBytes += uploadInstItem(it);
      }
      for (const m of bs.meshes) {
        F.defBytes += m.bytes;
        if (m.quant) { F.defBytesQ += m.bytes; F.defsQ++; }
        if (m.vboD) { F.decimBytes += m.bytesD || 0; F.decimMeshes++; }
      }
      F.phase = 1; F.i = 0;
    }
    if (F.phase === 1) {
      for (; F.i < bs.stream.length; F.i++) {
        if (!(F.i & 31) && over()) { F.tUp += performance.now() - tUp0; return false; }
        itemVao(bs.stream[F.i]);
      }
      uploadPalette(bs.doc, bs.layerIdx);
      F.phase = 2; F.i = 0;
      F.sigKeys = [...bs.defCPU.keys()];
    }
    F.tUp += performance.now() - tUp0;
    if (F.phase === 2) {
      for (; F.i < F.sigKeys.length; F.i++) {
        if (!(F.i & 31) && over()) return false;
        const name = F.sigKeys[F.i];
        const def = bs.doc.blocks[name];
        if (def && Array.isArray(def.entities)) F.defsSig.set(name, fpDef(def.entities));
      }
      F.phase = 3;
    }
    const instBytes = F.instBytes, defBytes = F.defBytes, chunkBytes = F.chunkBytes;
    const defBytesQ = F.defBytesQ, defsQ = F.defsQ;
    const hasAlpha = F.hasAlpha, triBytes = F.triBytes;
    const decimBytes = F.decimBytes, decimChunks = F.decimChunks, decimMeshes = F.decimMeshes;
    const tUp = F.tUp;
    const defsSig = F.defsSig;

    const liveEnts = Nasj.docOps.modelEntities(bs.doc);
    scene = {
      doc: bs.doc,
      qtier: bs.qtier,                   /* phase 5: the tier this build wears */
      entsN: liveEnts.length,
      entsEnds: liveEnts.length
        ? liveEnts[0].id + '|' + liveEnts[liveEnts.length - 1].id : '',
      envSig: bs.envSig,
      hidSig: bs.hidSig,
      hidSet: bs.hidSet,
      palSig: bs.palSig,
      layerIdx: bs.layerIdx,
      noPal: bs.noPal,
      tolWorld: bs.tolWorld,
      span: bs.span,
      stream: bs.stream,
      delta: [],
      deltaIds: 0,
      deltaSegs: 0,
      meshes: bs.meshes,
      defCPU: bs.defCPU,
      defInfo: bs.defInfo,
      defScale: bs.defScale,
      defsSig,
      records: bs.records,
      orderIds: bs.orderIds,
      demoted: bs.demoted,
      hatchIds: bs.hatchIds,
      hasAlpha,
      zNext: bs.zNext, lastKind: bs.lastKind,
      zDelta: Z_DELTA_TOP, zDeltaKind: null,
      stats: {
        renderer: rendererString(),
        depthBits,
        span: bs.span,
        tolWorld: bs.tolWorld,
        buildMs: { total: performance.now() - bs.t0, scan: bs.tScan, walk: bs.tWalk, upload: tUp },
        qtier: bs.qtier,
        tessMul: TESS_MUL[bs.qtier] || 1,
        decim: { chunks: decimChunks, meshes: decimMeshes, bytes: decimBytes, k: DECIM_K },
        bytes: { defMeshes: defBytes, defMeshesU16: defBytesQ, instances: instBytes,
          chunks: chunkBytes, fills: triBytes, decimated: decimBytes,
          total: defBytes + instBytes + chunkBytes + decimBytes },
        counts: {
          entities: bs.ents.length,
          loose: bs.stats.loose,
          inserts: bs.stats.inserts,
          instanced: bs.stats.instanced,
          baked: bs.stats.baked,
          inlinedRefs: bs.stats.inlinedRefs,
          owned2D: bs.stats.owned2D,
          defsMeshed: bs.meshes.length,
          defsQuantized: defsQ,
          chunks: bs.stream.filter((s) => s.kind === 'chunk').length,
          drawCalls: bs.stream.length,
          nestedInDefs: bs.stats.nestedInDefs,
          segsLoose: bs.stats.segsLoose,
          segsBaked: bs.stats.segsBaked,
          segsDef: bs.stats.segsDef,
          zGroups: bs.zNext,
          layers: bs.doc.layers.length
        },
        fills: {
          looseSolid: bs.stats.fillsLoose - bs.stats.fillsLooseBg,
          looseBg: bs.stats.fillsLooseBg,
          defHatchesOwned: bs.stats.defHatchesOwned,
          defBgOwned: bs.stats.defBgOwned,
          fillDefsBaked: bs.stats.fillDefsBaked,
          demotedBg: bs.stats.demotedBg,
          tris: bs.stats.fillTris
        },
        skipped: bs.skipped,
        jsHeapDelta: performance.memory
          ? performance.memory.usedJSHeapSize - bs.heap0 : null
      }
    };
    /* A FRESH BUILD IS THE FRESHEST READ THERE IS. The open's "the drawing
       is whole" emit lands around this build, and the sweep it asks for —
       every entity's fingerprint, 150ms measured on a block library — can
       never find anything this build did not already read. While the
       drawing is loading input is gated, so nothing but the open itself
       can have touched the document either: the signals this build started
       from are retired with it. Outside a load nothing is assumed and
       every signal still stands, and a signal that arrived WHILE the build
       ran moved the counter, so it stands too. */
    if (bs.doc.loading && pend.sigSeq === bs.seq0) { pendReset(); dirty = false; }
    /* the finished scene joins the per-document cache, and the budget is
       balanced right here — the moment its buffers exist is the moment the
       total is highest, so nothing else has to police it */
    scene.gen = Nasj.docGen ? Nasj.docGen(bs.doc) : 0;
    scene.stale = false;
    scene.use = ++sceneUse;
    const old = scenes.get(bs.doc);
    if (old && old !== scene) freeSceneObj(old, false);
    scenes.set(bs.doc, scene);
    sceneBytes += sceneBytesOf(scene);
    evictScenes();
    return true;
  };

  const scheduleBuild = (doc) => {
    if (!ensureGL()) return;
    if (buildJob) { if (buildJob.raf) cancelAnimationFrame(buildJob.raf); buildJob = null; }
    const bs = newBuildState(doc);
    buildJob = { doc, bs, raf: 0 };
    const step = () => {
      if (!buildJob || buildJob.bs !== bs) return;
      buildJob.raf = 0;
      if (doc !== Nasj.doc) { buildJob = null; return; }   /* switched away */
      /* someone else is pumping this build (the open front-load): stand by
         rather than run a second slice in the same frame */
      if (bs.pumpT && performance.now() - bs.pumpT < 250) {
        buildJob.raf = requestAnimationFrame(step);
        return;
      }
      /* behind the open's progress bar the slice is one frame's worth: the
         crosshair is the OS's there, and the OS only draws it when this
         thread lets the compositor have a turn */
      const load = !!(Nasj.doc && Nasj.doc.loading);
      let done = !!bs.walkDone;
      const deadline = performance.now() + (load ? LOAD_SLICE_MS : BUILD_SLICE_MS);
      while (!done && performance.now() < deadline) done = buildStep(bs, deadline);
      if (!done) { buildJob.raf = requestAnimationFrame(step); return; }
      bs.walkDone = true;
      if (!finishBuild(bs, load ? deadline : 0)) {
        buildJob.raf = requestAnimationFrame(step);
        return;
      }
      buildJob = null;
      /* the scene is live: the 2D path must drop what GL now owns — the
         doc event beats its cached bitmap the usual way. Edits that landed
         mid-build are still flagged dirty (their pend signals stand) and
         patch on the next frame. */
      emitDoc('glscene');
    };
    buildJob.raf = requestAnimationFrame(step);
  };
  const BUILD_SLICE_MS = 12;
  /* engine.js LOAD_SLICE_MS: one frame's worth, the open's whole budget */
  const LOAD_SLICE_MS = 6;

  /* one synchronous build — small docs and QA determinism */
  const buildNow = (doc) => {
    if (!ensureGL()) return null;
    if (buildJob) { if (buildJob.raf) cancelAnimationFrame(buildJob.raf); buildJob = null; }
    const bs = newBuildState(doc);
    let done = false;
    while (!done) done = buildStep(bs, performance.now() + 1e6);
    finishBuild(bs);
    return scene.stats;
  };

  /* the build path chosen by weight: a light doc builds in one go (a few
     ms — measured 2-4ms at 5k entities), a heavy one in idle slices with
     the 2D path carrying every frame meanwhile */
  const SYNC_BUILD_N = 20000;            /* engine's own SCENE_ASYNC_N line */
  const startBuild = (doc) => {
    if (Nasj.docOps.modelEntities(doc).length <= SYNC_BUILD_N) {
      buildNow(doc);
      emitDoc('glscene');
    } else scheduleBuild(doc);
  };

  /* ---------------- patch (the doc moved) ----------------
   * Value fingerprints find the touched entities; their chunks
   * re-tessellate in place (same VBO object, so VAOs stand), touched
   * instanced defs re-upload their records, additions append to delta
   * chunks drawn last (above the stream's z groups), and a changed owned
   * ORDER (DRAWORDER) or any environment change falls back to a full
   * rebuild. Phase 3: a fully-hinted edit cycle diffs only the hinted ids
   * instead of sweeping the whole model list. */

  const markDirtyWhere = (P, w) => {
    if (!w) return;
    if (typeof w === 'string') P.defs.add(w);
    else if (w.kind === 'chunk') { if (w.delta) P.delta = true; else P.chunks.add(w); }
  };

  const rebuildChunk = (bs2, ck) => {
    const doc = scene.doc;
    const ids = ck.ids;
    ck.sL = ck.sT = ck.sA = null;
    ck.ids = [];
    ck.hasInline = false;
    ck.bx0 = Infinity; ck.by0 = Infinity; ck.bx1 = -Infinity; ck.by1 = -Infinity;
    const kept = [];
    for (const id of ids) {
      const ent = Nasj.docOps.entityById(doc, id);
      const rec = scene.records.get(id);
      if (!ent || !rec) continue;        /* deleted, or no longer owned */
      zBegin(bs2, rec.z == null ? 1 : rec.z);
      let r = null;
      if (ent.type === 'insert') {
        const def = doc.blocks[ent.name];
        const dynamic = ent.dyn || ent.visState ||
          (def && def.visibility && Array.isArray(def.visibility.states) && def.visibility.states.length);
        if (dynamic) r = inlineRef(bs2, ent, ck);
        else {
          const cpu = defCPUFor(bs2, ent.name);
          if (cpu) r = bakeRef(bs2, ent, cpu, ck);
        }
      } else r = addLoose(bs2, ent, ck);
      void r;
      kept.push(id);      /* membership survives degenerate geometry too */
    }
    ck.ids = kept;
    chunkUpload(ck, scene.qtier !== 'A' && !ck.delta);
    ck.sL = ck.sT = ck.sA = null;
    if (!ck.vao) itemVao(ck);            /* same VBO object: the VAO stands */
  };

  const rebuildDefItems = (bs2, name, refs) => {
    const info = scene.defInfo.get(name);
    if (!info || !info.instanced) return;
    const old = info.items;
    let at = scene.stream.length;
    for (let i = 0; i < scene.stream.length; i++) {
      if (old.indexOf(scene.stream[i]) >= 0) { at = i; break; }
    }
    for (let i = scene.stream.length - 1; i >= 0; i--) {
      if (old.indexOf(scene.stream[i]) >= 0) scene.stream.splice(i, 1);
    }
    for (const it of old) freeItem(it);
    info.items = [];
    const mesh = info.mesh;
    const doc = scene.doc;
    for (const ent of refs) {
      const P = placementOf(ent, doc.blocks[ent.name]);
      let m00 = P.m00, m10 = P.m10, m01 = P.m01, m11 = P.m11;
      const tx = P.tx + m00 * mesh.ox + m01 * mesh.oy;
      const ty = P.ty + m10 * mesh.ox + m11 * mesh.oy;
      m00 *= mesh.qx; m10 *= mesh.qx; m01 *= mesh.qy; m11 *= mesh.qy;
      let it = null;
      for (const cand of info.items) {
        if (Math.abs(tx - cand.ax) <= ANCHOR_R && Math.abs(ty - cand.ay) <= ANCHOR_R) { it = cand; break; }
      }
      if (!it) {
        const rz = scene.records.get(ent.id);
        const z = rz && rz.z != null ? (Array.isArray(rz.z) ? rz.z[0] : rz.z) : 1;
        it = { kind: 'inst', name, mesh, ax: tx, ay: ty, recs: [], ibo: null, n: 0, vao: null,
          z, sMax: 0, bx0: Infinity, by0: Infinity, bx1: -Infinity, by1: -Infinity };
        info.items.push(it);
      }
      const kS2 = Math.max(Math.abs(typeof ent.sx === 'number' ? ent.sx : 1),
        Math.abs(typeof ent.sy === 'number' ? ent.sy : 1)) || 1;
      if (kS2 > it.sMax) it.sMax = kS2;
      const ref = refColorMeta(bs2, ent);
      const il = ref.li + ((ref.c >>> 14) === F_PAL ? F : 0);
      it.recs.push(m00, m10, m01, m11, tx - it.ax, ty - it.ay,
        ref.r | (ref.g << 8) | (ref.b << 16), il);
      const cpu = scene.defCPU.get(name);
      if (cpu) {
        for (const [lx, ly2] of [[cpu.minx, cpu.miny], [cpu.maxx, cpu.miny],
          [cpu.minx, cpu.maxy], [cpu.maxx, cpu.maxy]]) {
          const x = P.m00 * lx + P.m01 * ly2 + P.tx;
          const y = P.m10 * lx + P.m11 * ly2 + P.ty;
          growB(it, x, y, x, y);
        }
      } else { it.bx0 = -Infinity; it.by0 = -Infinity; it.bx1 = Infinity; it.by1 = Infinity; }
    }
    for (const it of info.items) {
      uploadInstItem(it);
      itemVao(it);
    }
    /* back into the stream where the group stood (its first old position) */
    scene.stream.splice(at, 0, ...info.items);
  };

  const deltaChunkFor = (bs2, x, y, need) => {
    const list = scene.delta;
    let ck = list.length ? list[list.length - 1] : null;
    if (ck && ((!ck.sL && !ck.sT && !ck.sA) || Math.abs(x - ck.ax) > ANCHOR_R ||
        Math.abs(y - ck.ay) > ANCHOR_R || chunkVerts(ck) + need > CHUNK_VERTS)) ck = null;
    if (!ck) {
      ck = { kind: 'chunk', delta: true, ax: x, ay: y, sL: null, sT: null, sA: null,
        vbo: null, count: 0, nL: 0, nT: 0, nA: 0, ids: [], vao: null,
        hasInline: false,
        bx0: Infinity, by0: Infinity, bx1: -Infinity, by1: -Infinity };
      list.push(ck);
    }
    return ck;
  };

  /* delta chunks keep their CPU sinks: appends re-upload in place. The
     entity routes through the same helpers as the build, aimed at the
     delta's own chunks, with z above every stream group so an addition
     draws on top exactly as a doc-order-last entity should. */
  const appendDelta = (bs2, ent, plan) => {
    const doc = scene.doc;
    zBegin(bs2, plan);
    let r = null;
    const probe = (x, y, need) => deltaChunkFor(bs2, x, y, need);
    if (ent.type === 'insert') {
      const def = doc.blocks[ent.name];
      const dynamic = ent.dyn || ent.visState ||
        (def && def.visibility && Array.isArray(def.visibility.states) && def.visibility.states.length);
      if (dynamic) r = inlineRef(bs2, ent, probe);
      else {
        const cpu = defCPUFor(bs2, ent.name);
        if (cpu && (cpu.n || cpu.nt)) r = bakeRef(bs2, ent, cpu, probe);
      }
    } else {
      r = addLoose(bs2, ent, probe);
    }
    /* a demoted fill must SURFACE from the patch path — swallowing it to
       null left the hatch owned with an empty record: invisible */
    if (r === 'demote') return 'demote';
    if (!r) return null;
    if (r.chunk.ids[r.chunk.ids.length - 1] !== ent.id) r.chunk.ids.push(ent.id);
    scene.deltaIds++;
    scene.deltaSegs += r.segs + (r.tris || 0);
    return r;
  };

  const rebuildDelta = (bs2) => {
    /* the delta is small by construction: re-tessellate it whole */
    const oldChunks = scene.delta;
    const ids = [];
    for (const ck of oldChunks) for (const id of ck.ids) ids.push(id);
    for (const ck of oldChunks) freeItem(ck);
    scene.delta = [];
    scene.deltaIds = 0;
    scene.deltaSegs = 0;
    const doc = scene.doc;
    for (const id of ids) {
      const rec = scene.records.get(id);
      if (!rec) continue;
      const ent = Nasj.docOps.entityById(doc, id);
      if (!ent) continue;
      const r = appendDelta(bs2, ent, rec.z == null ? undefined : rec.z);
      if (r === 'demote') {
        /* the 2D layer keeps it whole — an owned record with nothing in
           the chunk is an invisible entity */
        scene.records.delete(id);
        continue;
      }
      rec.w = r ? r.chunk : null;        /* never a freed chunk */
    }
  };

  const uploadDelta = () => {
    for (const ck of scene.delta) {
      if (!ck.sL && !ck.sT && !ck.sA) continue;
      chunkUpload(ck);                   /* the CPU sinks stay: appends */
      if (!ck.vao) itemVao(ck);
    }
  };

  /* a tiny build-state stand-in for the patch helpers (they share the
     bake/inline/loose paths with the build) */
  const patchState = () => {
    const doc = scene.doc;
    const lmap = new Map(doc.layers.map((l) => [l.id, l]));
    const ops = Nasj.docOps;
    const noPal = scene.noPal;
    const hid = new Set();
    if (noPal) for (const l of doc.layers) if (l && !(l.on && !l.frozen)) hid.add(l.id);
    return {
      doc, ops, lmap,
      layerIdx: scene.layerIdx,
      noPal,
      tolWorld: scene.tolWorld,
      defScale: scene.defScale,
      defCPU: scene.defCPU,
      stats: { nestedInDefs: 0, inlinedRefs: 0 },
      twoD: null, twoDB: null,           /* no wipeout guard on patches */
      zNext: scene.zDelta, lastKind: scene.zDeltaKind, zMax: 65534,
      entLast: null, entZ: null, zPlan: null, zCur: -1,
      childHidden: (c) => noPal && c.layerId != null && c.layerId !== '0' && hid.has(c.layerId),
      childColor: (child, refCol) => {
        if (child.color === 'ByBlock') return refCol;
        if (child.color && child.color !== 'ByLayer') return child.color;
        if (lmap.has(child.layerId)) return ops.resolveColor(doc, child);
        return refCol;
      }
    };
  };

  /* the entities LIST itself, as an O(1) signature (length + end ids —
     the entityById cache's own heuristic). The wraps resync it after every
     op they see; a mismatch at sync time means the list changed through a
     path no wrap saw (a QA harness's wipe-and-refill, a splice) — those
     cycles take the full sweep whatever the hints said. */
  const entsSync = () => {
    if (!scene) return;
    const l = Nasj.docOps.modelEntities(scene.doc);
    scene.entsN = l.length;
    scene.entsEnds = l.length ? l[0].id + '|' + l[l.length - 1].id : '';
  };
  const entsMoved = () => {
    if (!scene) return false;
    const l = Nasj.docOps.modelEntities(scene.doc);
    if (l.length !== scene.entsN) return true;
    const ends = l.length ? l[0].id + '|' + l[l.length - 1].id : '';
    return ends !== scene.entsEnds;
  };

  const fullRebuild = (why) => {
    const doc = scene ? scene.doc : Nasj.doc;
    freeScene();
    lastPatch = { ms: 0, kind: 'rebuild:' + why };
    if (doc && doc === Nasj.doc) startBuild(doc);
  };

  /* the hinted ids' ownability under the live layer table */
  const entOwnableNow = (bs2, ent) => {
    if (!ent) return false;
    const hidIds = Nasj.hiddenIds;
    if (hidIds && hidIds.has(ent.id)) return false;
    if (scene.demoted.has(ent.id)) return false;
    const ly = bs2.lmap.get(ent.layerId);
    if (bs2.noPal && ly && !(ly.on && !ly.frozen)) return false;
    return entOwnable(bs2.doc, ent, ly);
  };

  const applyDirty = (bs2, P, adds, instRefs, gen) => {
    for (const ck of P.chunks) rebuildChunk(bs2, ck);
    for (const name of P.defs) rebuildDefItems(bs2, name, instRefs ? (instRefs.get(name) || []) : []);
    if (P.delta) rebuildDelta(bs2);
    for (const ent of adds) {
      const r = appendDelta(bs2, ent);
      /* a fill the clipper hands back stays with the 2D layer: recording
         it as owned would make the freshly committed hatch invisible the
         moment the preview leaves it */
      if (r === 'demote') continue;
      scene.records.set(ent.id, { fp: fpEnt(ent), w: r ? r.chunk : null, z: bs2.entZ, g: gen });
      if (ent.type === 'hatch') scene.hatchIds.add(ent.id);
    }
    if (P.delta || adds.length) uploadDelta();
    scene.zDelta = bs2.zNext;
    scene.zDeltaKind = bs2.lastKind;
  };

  const foldIfHeavy = () => {
    if (scene.deltaIds > DELTA_FOLD_IDS || scene.deltaSegs > DELTA_FOLD_SEGS) {
      const d = scene.doc;
      freeScene();
      if (d === Nasj.doc) scheduleBuild(d);
    }
  };

  /* the hinted diff: only the cycle's ids, no model-list sweep */
  const hintSweep = (ids, t0, palMs) => {
    const doc = scene.doc;
    const bs2 = patchState();
    const records = scene.records;
    const P = { chunks: new Set(), defs: new Set(), delta: false };
    const gen = ++patchGen;
    const adds = [];
    let dels = 0, changed = 0;
    /* absorbed until an id proves 2D-visible: an unownable id (a 2D-owned
       entity edited or erased, an entity leaving GL), or a SELECTED or
       hovered one (their styling lives on the 2D layer), means the
       remainder bitmap moved and the engine must restroke it */
    let absorbedAll = true;
    /* geometry-clean until an id may have moved in place: a surviving
       2D-owned id (no fingerprint baseline to compare) or a changed
       recorded one — adds and deletes were index-patched by the wraps */
    let geomClean = true;
    const selNow = Nasj.selection instanceof Set ? Nasj.selection : null;
    const hovNow = Nasj.ui ? Nasj.ui.hoverId : null;
    for (const id of ids) {
      const ent = Nasj.docOps.entityById(doc, id);
      const rec = records.get(id);
      const ownable = ent && entOwnableNow(bs2, ent);
      if ((selNow && selNow.has(id)) || (hovNow != null && hovNow === id)) {
        absorbedAll = false;
      }
      if (!ownable) {
        absorbedAll = false;
        if (ent) geomClean = false;
        if (rec) { markDirtyWhere(P, rec.w); records.delete(id); dels++; }
        continue;
      }
      const fp = fpEnt(ent);
      if (!rec) { adds.push(ent); continue; }
      if (fp === rec.fp) continue;
      geomClean = false;
      if (!rec.w) {
        /* geometry grew where none was recorded: rehome through the delta */
        records.delete(id);
        adds.push(ent);
        continue;
      }
      rec.fp = fp;
      markDirtyWhere(P, rec.w);
      changed++;
    }
    let instRefs = null;
    if (P.defs.size) {
      /* record-backed refs of the dirty instanced defs, in doc order — one
         cheap walk (map lookups only, no fingerprints) */
      instRefs = new Map();
      for (const ent of Nasj.docOps.modelEntities(doc)) {
        if (!ent) continue;
        const rec = records.get(ent.id);
        if (rec && typeof rec.w === 'string' && P.defs.has(rec.w)) {
          let a = instRefs.get(rec.w);
          if (!a) instRefs.set(rec.w, a = []);
          a.push(ent);
        }
      }
    }
    applyDirty(bs2, P, adds, instRefs, gen);
    entsSync();
    /* an owned-only membership cycle does not change the remainder LIST —
       only its stamps (length, last id, record count). Undo the generic
       bump so the next ask does not walk 241k entities (LINE on BLOCKS). */
    if (dels === 0 && absorbedAll) {
      if (scene.restGen) scene.restGen--;
      const c = scene.rest;
      const entsNow = Nasj.docOps.modelEntities(scene.doc);
      if (c && c.ents === entsNow) {
        const n = entsNow.length;
        c.n = n;
        c.ends = n ? entsNow[0].id + '|' + entsNow[n - 1].id : '';
        c.recN = records.size;
        c.gen = scene.restGen || 0;
      }
    }
    /* a palette change restyles 2D-owned strokes too: never absorbed */
    cycleAbsorbed = absorbedAll && !palMs;
    cycleGeomClean = geomClean;
    lastPatch = {
      ms: performance.now() - t0, kind: 'hint',
      hinted: ids.size, adds: adds.length, chunks: P.chunks.size,
      defs: P.defs.size, dels, changed, delta: P.delta, palMs,
      absorbed: cycleAbsorbed
    };
    foldIfHeavy();
  };

  /* the full sweep: value fingerprints over the whole model list — the
     fallback for unhinted changes (undo, grips, property edits, anything
     a wrap could not attribute) */
  const fullSweep = (t0, palMs) => {
    const doc = scene.doc;
    const tDefs = performance.now();
    const bs2 = patchState();
    const ents = Nasj.docOps.modelEntities(doc);
    const records = scene.records;
    const P = { chunks: new Set(), defs: new Set(), delta: false };
    const gen = ++patchGen;
    let seenN = 0;
    const adds = [];
    const keptOrder = [];
    const instRefs = new Map();          /* name -> [refs] for instanced defs */
    /* stream order tracks only what lives in the stream: delta homes draw
       last by design and empty homes draw nothing, so both stay out of
       the order contract */
    const inStream = (w) => typeof w === 'string' || (w && !w.delta);
    for (const ent of ents) {
      if (!ent) continue;
      const ownable = entOwnableNow(bs2, ent);
      const rec = records.get(ent.id);
      if (!ownable) {
        if (rec) { markDirtyWhere(P, rec.w); records.delete(ent.id); }
        continue;
      }
      if (!rec) { adds.push(ent); continue; }
      const fp = fpEnt(ent);
      if (fp !== rec.fp && !rec.w) {
        /* geometry grew where none was recorded: rehome through the delta */
        records.delete(ent.id);
        adds.push(ent);
        continue;
      }
      rec.g = gen;
      seenN++;
      /* record-backed refs of instanced defs, in doc order: the pool a
         dirty def rebuilds its records from (adds go to the delta) */
      if (typeof rec.w === 'string') {
        let a = instRefs.get(rec.w);
        if (!a) instRefs.set(rec.w, a = []);
        a.push(ent);
      }
      if (inStream(rec.w)) keptOrder.push(ent.id);
      if (fp !== rec.fp) {
        rec.fp = fp;
        markDirtyWhere(P, rec.w);
      }
    }
    let dels = 0;
    if (seenN !== records.size) {
      for (const [id, rec] of records) {
        if (rec.g === gen) continue;
        markDirtyWhere(P, rec.w);
        records.delete(id);
        dels++;
      }
    }
    /* a changed owned order (DRAWORDER and kin) re-bakes the stream whole:
       the kept sequence must read exactly as the built order minus what
       left it (or moved to the delta) */
    {
      let j = 0, mismatch = false;
      const oldOrder = scene.orderIds;
      for (let i = 0; i < oldOrder.length && !mismatch; i++) {
        const id = oldOrder[i];
        const r2 = records.get(id);
        if (!r2 || !inStream(r2.w)) continue;    /* gone, or delta-homed now */
        if (keptOrder[j++] !== id) mismatch = true;
      }
      if (mismatch || j !== keptOrder.length) { fullRebuild('order'); return; }
    }
    const tWalkEnd = performance.now();
    applyDirty(bs2, P, adds, instRefs, gen);
    entsSync();
    scene.orderIds = keptOrder;
    lastPatch = {
      ms: performance.now() - t0, kind: 'patch',
      adds: adds.length, chunks: P.chunks.size, defs: P.defs.size,
      dels, delta: P.delta, palMs,
      defsMs: +(tDefs - t0).toFixed(1), walkMs: +(tWalkEnd - tDefs).toFixed(1),
      applyMs: +(performance.now() - tWalkEnd).toFixed(1)
    };
    foldIfHeavy();
  };

  /* ---------------- whole-document translation (MOVE-all) ----------------
   * A commit that moved EVERY entity by one (dx,dy) has not changed a
   * single vertex RELATIVE TO ITS ANCHOR: chunks store anchor-relative
   * points and instances store anchor-relative placements, so the whole
   * patch is "shift every anchor and every item box" — microseconds where
   * the full sweep re-tessellated the entire drawing (562ms measured on
   * BLOCKS.dwg). What DOES go stale is the value fingerprint of every
   * record; those re-hash in idle slices (fpJob), and any cycle that needs
   * them before the job lands finishes it synchronously first. */
  const fpJobRun = (sc, deadline) => {
    const J = sc.fpJob;
    if (!J) return true;
    const doc = sc.doc;
    const ops = Nasj.docOps;
    let n = 0;
    for (;;) {
      const s = J.it.next();
      if (s.done) { sc.fpJob = null; return true; }
      const ent = ops.entityById(doc, s.value[0]);
      if (ent) s.value[1].fp = fpEnt(ent);
      if (!(++n & 127) && performance.now() > deadline) return false;
    }
  };
  const fpJobPump = (sc) => {
    const tick = () => {
      if (!sc.fpJob || sc !== scene) return;   /* freed, done, or parked */
      if (!fpJobRun(sc, performance.now() + 5)) setTimeout(tick, 16);
    };
    setTimeout(tick, 16);
  };
  const armFpJob = () => {
    const sc = scene;
    if (!sc) return;
    sc.fpJob = { it: sc.records.entries() };   /* restart: live values re-read */
    fpJobPump(sc);
  };
  const XLATE_MISS_CAP = 100;            /* stay-behind records a shift absorbs */
  const xlateSweep = (x, t0, palMs) => {
    if (hidSigNow() !== scene.hidSig) return false;   /* isolation moved too */
    if (entsMoved()) return false;       /* membership changed out of band */
    const dx = Number(x.dx) || 0, dy = Number(x.dy) || 0;
    if (!isFinite(dx + dy)) return false;
    /* NEAR-ALL RIDES TOO: a handful of unselected records take the shift
       like everything else, then their chunks re-tessellate in place at
       their true (unmoved) coordinates — a few 20ms rebuilds instead of
       the whole drawing's. */
    let missing = null;
    if (!x.all) {
      const sel = x.ids;
      if (!(sel instanceof Set)) return false;
      for (const id of scene.records.keys()) {
        if (sel.has(id)) continue;
        if (!missing) missing = [];
        missing.push(id);
        if (missing.length > XLATE_MISS_CAP) return false;
      }
    }
    for (const it of scene.stream) {
      it.ax += dx; it.ay += dy;
      if (it.bx0 !== undefined) { it.bx0 += dx; it.bx1 += dx; it.by0 += dy; it.by1 += dy; }
    }
    for (const it of scene.delta) {
      it.ax += dx; it.ay += dy;
      if (it.bx0 !== undefined) { it.bx0 += dx; it.bx1 += dx; it.by0 += dy; it.by1 += dy; }
    }
    /* the stay-behind few: their homes re-tessellate at true coordinates */
    if (missing && missing.length) {
      const bs2 = patchState();
      const P = { chunks: new Set(), defs: new Set(), delta: false };
      for (const id of missing) {
        const rec = scene.records.get(id);
        if (rec) markDirtyWhere(P, rec.w);
      }
      let instRefs = null;
      if (P.defs.size) {
        instRefs = new Map();
        for (const ent of Nasj.docOps.modelEntities(scene.doc)) {
          if (!ent) continue;
          const rec = scene.records.get(ent.id);
          if (rec && typeof rec.w === 'string' && P.defs.has(rec.w)) {
            let a = instRefs.get(rec.w);
            if (!a) instRefs.set(rec.w, a = []);
            a.push(ent);
          }
        }
      }
      applyDirty(bs2, P, [], instRefs, ++patchGen);
    }
    /* membership did not move: the remainder LIST is still true (undo the
       generic bump ensureFresh paid on entry) and its box merely shifts —
       the grip envelope reads both instead of re-measuring 5,651 texts */
    if (scene.restGen) scene.restGen--;
    const rb = scene.restBox;
    if (rb && rb.box) {
      rb.box.minx += dx; rb.box.maxx += dx;
      rb.box.miny += dy; rb.box.maxy += dy;
      /* an undo/redo replaced the entities ARRAY (same ids, translated
         values): the cached list rebuilds off the new array here — one
         membership walk — and the shifted box pairs with it */
      rb.list = remainder();
    }
    /* the mass-selection cover: its box moved with the anchors — shift it
       when it has no exceptions (the whole-move case), re-ask otherwise */
    const memo = scene.selCoverMemo;
    if (memo && memo.out && memo.out.box && memo.out.exc && !memo.out.exc.length &&
        (!missing || !missing.length)) {
      memo.out.box.minx += dx; memo.out.box.maxx += dx;
      memo.out.box.miny += dy; memo.out.box.maxy += dy;
    } else scene.selCoverMemo = null;
    /* THE FINGERPRINTS OF AN UNDO ARE THE ONES THE COMMIT ALREADY HAD.
       An undo/redo of a whole-move restores the exact state the inverse
       sweep left — so instead of re-hashing 235k entities (a 160-190ms
       job whose forced finish blocked the first edit after an undo),
       each sweep STASHES the outgoing state's fps, and a sweep with the
       exact inverse delta restores the stash. Valid only while nothing
       else patched (patchGen), membership stood (the same records Map,
       same size, same first id — order is the Map's own), and the
       current set is coherent (no half-run job). */
    const rec2 = scene.records;
    const prev = scene.fpSwap;
    let stash = null;
    if (!scene.fpJob && (!missing || !missing.length)) {
      stash = { dx, dy, gen: patchGen, recs: rec2, n: rec2.size,
        id0: rec2.keys().next().value, fps: new Float64Array(rec2.size) };
      let i = 0;
      for (const r of rec2.values()) stash.fps[i++] = r.fp;
    }
    scene.fpSwap = stash;
    if (prev && stash && prev.dx === -dx && prev.dy === -dy &&
        prev.gen === patchGen && prev.recs === rec2 && prev.n === rec2.size &&
        prev.id0 === stash.id0) {
      let i = 0;
      for (const r of rec2.values()) r.fp = prev.fps[i++];
      /* the stash generation stands: an undo-redo ping-pong keeps swapping */
    } else {
      armFpJob();
    }
    entsSync();
    cycleAbsorbed = false;               /* the 2D remainder moved with it */
    cycleGeomClean = false;              /* in-place geometry: index re-colds */
    lastPatch = { ms: performance.now() - t0, kind: 'xlate',
      items: scene.stream.length + scene.delta.length,
      miss: missing ? missing.length : 0,
      fps: scene.records.size, palMs };
    return true;
  };

  /* the cycle's verdict, consumed at each sync */
  const takeCycle = () => {
    let m;
    if (pend.full) m = 'full';
    /* phase 4 fix: an unhinted cycle ALWAYS sweeps. The old 'skip' arm
       assumed a lone unhinted pushUndo carried no mutation — but the
       pedit/grips commit shape (pushUndo â†’ in-place mutate â†’ render â†’
       bare emit) is exactly that, and its render consumed the sequence
       before the emit could flag an edit: the GL scene went stale
       (measured: lastPatch 'skip', old geometry left on screen). */
    else if (pend.unhinted) m = 'full';
    else if (pend.ids.size) m = pend.ids.size > HINT_CAP ? 'full' : 'hint';
    else m = pend.edit ? 'full' : 'skip';
    const out = { mode: m, ids: m === 'hint' ? new Set(pend.ids) : null,
      /* the whole-document translation hint, valid only when nothing else
         signalled after it was placed (see xlateHint / the undo wrap) */
      xlate: (m === 'full' && !pend.full && pend.xlate &&
        pend.xlate.seq === pend.sigSeq) ? pend.xlate : null };
    pendReset();
    return out;
  };

  const ensureFresh = () => {
    if (!scene || buildJob) return;
    /* every door into a patch is this one: whatever the cycle turns out to
       be, ownership may move below, so the remainder's cached answer is
       spent here and recomputed on the next ask (see remainder()) */
    bumpRest();
    const t0 = performance.now();
    const doc = scene.doc;
    dirty = false;
    /* the generation this pass reconciles the scene WITH. Every exit below
       either leaves the scene current for it or throws the scene away
       (fullRebuild), so it is recorded once, here — and `vouch().gen` then
       means "reconciled", not "has not been touched since it was parked". */
    scene.gen = Nasj.docGen ? Nasj.docGen(doc) : scene.gen;
    cycleAbsorbed = false;               /* proven per cycle, never assumed */
    cycleGeomClean = false;
    const cy = takeCycle();
    /* an unobserved change to the entities list (wipe/splice) overrides
       whatever the cycle claimed — the full sweep is the only safe read */
    if (cy.mode !== 'full' && entsMoved()) cy.mode = 'full';
    /* environment first: anything baked wholesale means a fresh build */
    const env = envSigNow(doc);
    if (env !== scene.envSig) { fullRebuild('env'); return; }
    /* the isolation set: DIFFED, never rebuilt wholesale (see hidSigNow).
       The changed ids join the cycle's hints — entOwnableNow answers for
       each of them against the LIVE set, so a hide leaves its chunk and a
       show comes back through the delta, records staying truth throughout. */
    const hsig = hidSigNow();
    if (hsig !== scene.hidSig) {
      const hid = Nasj.hiddenIds || new Set();
      const was = scene.hidSet || new Set();
      const diff = new Set();
      for (const id of hid) if (!was.has(id)) diff.add(id);
      for (const id of was) if (!hid.has(id)) diff.add(id);
      if (cy.mode !== 'full' && (cy.ids ? cy.ids.size : 0) + diff.size > HINT_CAP) {
        fullRebuild('hidden');
        return;
      }
      scene.hidSig = hsig;
      scene.hidSet = new Set(hid);
      if (cy.mode === 'hint') for (const id of diff) cy.ids.add(id);
      else if (cy.mode !== 'full') { cy.mode = 'hint'; cy.ids = diff; }
      /* 'full' already re-answers every id against the live set */
    }
    /* used definitions: a redefined block (BEDIT, undo of one) rebuilds.
       A hinted/skip cycle cannot redefine one (those tools are membership
       or selection transforms) — skip the walk of every used name. */
    if (cy.mode === 'full') {
      for (const [name, sig] of scene.defsSig) {
        const def = doc.blocks && doc.blocks[name];
        if (!def || !Array.isArray(def.entities)) { fullRebuild('def-gone'); return; }
        if (fpDef(def.entities) !== sig) { fullRebuild('def-edit'); return; }
      }
    }
    /* the palette: layer colors and on/frozen update the texture only.
       Inline (dynamic) chunks re-bake — insertEntities filters hidden
       children at materialization, so their vertices follow the table. */
    let palMs = 0;
    const pal = palSigNow(doc);
    if (pal !== scene.palSig) {
      const tp = performance.now();
      scene.palSig = pal;
      uploadPalette(doc, scene.layerIdx);
      let inl = 0;
      const bs2p = patchState();
      for (const ck of scene.stream) {
        if (ck.kind === 'chunk' && ck.hasInline) { rebuildChunk(bs2p, ck); inl++; }
      }
      let dinl = false;
      for (const ck of scene.delta) if (ck.hasInline) { dinl = true; break; }
      if (dinl) { rebuildDelta(bs2p); uploadDelta(); }
      scene.zDelta = bs2p.zNext;
      scene.zDeltaKind = bs2p.lastKind;
      palMs = +(performance.now() - tp).toFixed(2);
      if (cy.mode === 'skip') {
        lastPatch = { ms: performance.now() - t0, kind: 'palette', inlineChunks: inl, palMs };
        return;
      }
    } else if (cy.mode === 'skip') {
      /* nothing entity-shaping happened (the bare post-commit emit, a
         'save'/'groups' beat): the remainder is untouched by definition */
      cycleAbsorbed = true;
      cycleGeomClean = true;
      lastPatch = { ms: performance.now() - t0, kind: 'skip' };
      return;
    }
    /* a pure whole-document translation: anchors shift, nothing rebuilds */
    if (cy.mode === 'full' && cy.xlate && xlateSweep(cy.xlate, t0, palMs)) return;
    /* the diff below compares value fingerprints — a pending re-walk from
       an earlier translation must land first or everything reads changed */
    if (scene.fpJob) fpJobRun(scene, Infinity);
    if (cy.mode === 'hint') hintSweep(cy.ids, t0, palMs);
    else fullSweep(t0, palMs);
  };

  /* ---------------- live state & the engine seams ---------------- */
  const live = () => !!(scene && gl && scene.doc === Nasj.doc && !buildJob &&
    !Nasj.paper && !(Nasj.view3d && Nasj.view3d.active) && enabled());

  /* the engine's scene passes ask for the skip predicate once per pass:
     null = keep every stroke (path off, scene missing, wrong doc) */
  const owner = () => {
    if (!live()) return null;
    const rec = scene.records;
    return (ent) => rec.has(ent.id);
  };

  /* THE REMAINDER — the same answer as owner(), turned inside out and
   * handed over as a LIST: every model entity GL does NOT own, in document
   * order. The 2D pass walks this instead of the whole document, which on
   * a block library is five thousand entities where it used to be a
   * quarter of a million.
   *
   * It is never PATCHED, only COMPUTED: one walk of the model list keeping
   * what records does not hold. That is what makes it impossible to hold a
   * wrong list — the only thing cached is the ANSWER, behind a stamp that
   * no ownership change can survive:
   *   ents/n/ends  the entities array itself moved, grew or was refilled
   *                (the same O(1) heuristic entsMoved() patches on)
   *   recN         records gained or lost members
   *   gen          any cycle that COULD have touched records — bumped at
   *                the head of ensureFresh, which is the one door every
   *                patch (hint, full, palette, rebuild) goes through, and
   *                which every edit, layer toggle, isolation bump, tier
   *                step and dynamic-block flip reaches by setting dirty.
   * A mismatch rebuilds on the spot; a scene that is not live answers
   * null and the caller walks the document, exactly as before. */
  /* the generation belongs to the SCENE, not to the module: a parked
     scene's records cannot move (nothing patches a scene that is not
     live), so its cached list is still the answer when it comes back —
     and a tab click no longer costs the incoming drawing a quarter-
     million-entity walk on the first ask. */
  const bumpRest = () => { if (scene) scene.restGen = (scene.restGen || 0) + 1; };
  const remainder = () => {
    if (!live()) return null;
    const ents = Nasj.docOps.modelEntities(scene.doc);
    const n = ents.length;
    const ends = n ? ents[0].id + '|' + ents[n - 1].id : '';
    const rec = scene.records;
    const c = scene.rest;
    const restGen = scene.restGen || 0;
    if (c && c.ents === ents && c.n === n && c.ends === ends &&
        c.gen === restGen && c.recN === rec.size) return c.list;
    const list = [];
    for (let i = 0; i < n; i++) {
      const e = ents[i];
      if (e && !rec.has(e.id)) list.push(e);
    }
    scene.rest = { ents, n, ends, gen: scene.restGen || 0, recN: rec.size, list };
    return list;
  };
  /* THE REMAINDER'S WORLD BOX — what the tier-3 grip envelope needs from
     the 2D-owned part. Measuring it is 5,651 entityBounds (texts, dims,
     impure references — 230ms cold, measured), so the answer is cached
     against the LIST identity, warmed in idle slices (restBoxWarm — the
     whole-scene drag arms it, so a commit finds it ready), and merely
     SHIFTED by a whole-document translation (xlateSweep above). */
  const restBoxCompute = (sc, deadline) => {   /* true when done */
    const J = sc.restBoxJob;
    if (!J) return true;
    const G = Nasj.geom;
    const list = J.list;
    let n = 0;
    while (J.i < list.length) {
      let b = null;
      try { b = G.entityBounds(list[J.i]); } catch (e) { b = null; }
      J.i++;
      if (b && isFinite(b.minx + b.miny + b.maxx + b.maxy)) {
        if (b.minx < J.x0) J.x0 = b.minx;
        if (b.miny < J.y0) J.y0 = b.miny;
        if (b.maxx > J.x1) J.x1 = b.maxx;
        if (b.maxy > J.y1) J.y1 = b.maxy;
      }
      /* every 8: the remainder is where the rotated monster references
         live, and one exact box costs ~35ms — the coarser check stacked
         several into one slice */
      if (!(++n & 7) && deadline && performance.now() > deadline) return false;
    }
    sc.restBox = { list,
      box: isFinite(J.x0) ? { minx: J.x0, miny: J.y0, maxx: J.x1, maxy: J.y1 } : null };
    sc.restBoxJob = null;
    return true;
  };
  const restBoxWarm = () => {
    if (!live()) return;
    const sc = scene;
    const list = remainder();
    if (!list) return;
    if (sc.restBox && sc.restBox.list === list) return;      /* already true */
    if (sc.restBoxJob && sc.restBoxJob.list === list) return; /* already warming */
    sc.restBoxJob = { list, i: 0,
      x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const tick = () => {
      if (!sc.restBoxJob || sc !== scene) return;
      if (!restBoxCompute(sc, performance.now() + 5)) setTimeout(tick, 16);
    };
    setTimeout(tick, 16);
  };

  /* late wraps: app.js (setSelection) loads after this module */
  const lateHooks = () => {
    if (typeof Nasj.setSelection === 'function' && !Nasj.setSelection._glHint) {
      const f = Nasj.setSelection;
      const w = function () {
        const prev = Nasj.selection instanceof Set ? Nasj.selection : null;
        const r = f.apply(this, arguments);
        /* a hatch whose selectedness flipped changes GL ownership (the
           selection styling must not stack a second translucent fill).
           Walk the HATCHES, not a copy of a 241k-id selection. */
        if (scene && scene.hatchIds && scene.hatchIds.size) {
          const cur = Nasj.selection instanceof Set ? Nasj.selection : null;
          for (const id of scene.hatchIds) {
            const was = !!(prev && prev.has(id));
            const now = !!(cur && cur.has(id));
            if (was !== now) { pend.ids.add(id); dirty = true; }
          }
        }
        return r;
      };
      w._glHint = true;
      Nasj.setSelection = w;
    }
  };

  /* called at the top of every Nasj.render: keeps the scene at the doc's
     pace BEFORE the 2D pass consumes owner() — edits patch here, a doc
     switch or environment change tears down and rebuilds (2D carries every
     frame in between, so nothing is ever missing on screen) */
  const sync = () => {
    lateHooks();
    if (!enabled()) {
      hideDom();
      if (scene || buildJob) { freeAllScenes(); emitDoc('glscene'); }
      return;
    }
    const doc = Nasj.doc;
    if (!doc) { hideDom(); if (scene) parkScene(); return; }
    if (Nasj.paper || (Nasj.view3d && Nasj.view3d.active)) { hideDom(); return; }
    /* THE SWITCH. The outgoing drawing's scene is parked, not freed, and
       the incoming one's taken back if it is still resident — the whole of
       a tab click, on this layer, is these two pointers. */
    if (buildJob && buildJob.doc !== doc) {
      if (buildJob.raf) cancelAnimationFrame(buildJob.raf);
      buildJob = null;
    }
    if (scene && scene.doc !== doc) parkScene();
    if (!scene && !buildJob) bindScene(doc);
    if (!scene) {
      /* phase 4: while a drawing is still streaming in, the build waits —
         ownership computed against a half-arrived block table was wrong
         (an insert whose def had not landed read as 2D-owned) and the
         slices competed with the stream's own parsing. The open front-load
         drives the build to completion behind the progress bar instead. */
      if (doc.loading && !buildJob) return;
      if (!buildJob || buildJob.doc !== doc) startBuild(doc);
      return;
    }
    if (dirty) ensureFresh();
  };

  /* ---------------- render ---------------- */
  const syncSize = () => {
    const main = document.getElementById('canvas');
    if (!main) return false;
    if (glCanvas.width !== main.width || glCanvas.height !== main.height) {
      glCanvas.width = main.width;
      glCanvas.height = main.height;
    }
    /* style writes only on change: identical strings still dirty layout */
    if (glCanvas.style.width !== main.style.width) glCanvas.style.width = main.style.width;
    if (glCanvas.style.height !== main.style.height) glCanvas.style.height = main.style.height;
    return glCanvas.width > 0;
  };

  const zClip = (g) => g / 32767.5 - 1;

  /* gestureQ (phase 5): gesture frames may decimate; settled frames (the
     compose, QA reads, screenshots) always draw full fidelity — the
     degradation lives only where the picture is moving.
     xf (whole-scene drag): a 2x3 world affine [a,b,c,d,e,f] folded into
     the view matrix and the anchors — the whole presented scene draws
     transformed at the cost of one ordinary frame (see dragBegin: when
     everything is selected, the ghost IS the scene). */
  const render = (gestureQ, tint, xf) => {
    if (!gl || !scene) return;
    if (Nasj.paper || (Nasj.view3d && Nasj.view3d.active)) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      return;
    }
    if (!syncSize()) return;
    ensurePalette();          /* the table this scene's vertices index into */
    const vp = Nasj.viewport;
    const cssW = parseFloat(document.getElementById('canvas').style.width) || glCanvas.width;
    const cssH = parseFloat(document.getElementById('canvas').style.height) || glCanvas.height;
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    if (debugOn) gl.clearColor(0x21 / 255, 0x28 / 255, 0x30 / 255, 1);
    else gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    /* the marquee preview's tinted pass: exactly the normal scene draw,
       scissored to the rectangle and mixed toward the selection accent by
       the uHl uniform — one pass at ANY coverage, no per-entity work. The
       canvas is cleared whole first (above), so outside the rect the DOM
       canvas stays transparent and the settled composite shows through. */
    if (tint) {
      const kx = glCanvas.width / cssW, ky = glCanvas.height / cssH;
      const sx = Math.max(0, Math.floor(tint.x * kx));
      const sy = Math.max(0, Math.floor((cssH - tint.y - tint.h) * ky));
      const sw = Math.min(glCanvas.width - sx, Math.ceil(tint.w * kx) + 1);
      const sh = Math.min(glCanvas.height - sy, Math.ceil(tint.h * ky) + 1);
      if (sw <= 0 || sh <= 0) return;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(sx, sy, sw, sh);
    }
    /* z: later stream groups sit NEARER (GEQUAL, cleared to 0) — opaque
       geometry batches freely in pass 1 and still layers by doc order */
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.GEQUAL);
    gl.depthMask(true);
    /* premultiplied blending is on throughout: opaque sources replace,
       the pass-2 fills blend — one state, no per-batch switching */
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (!lwRange) lwRange = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE);
    gl.lineWidth(Math.max(lwRange[0], Math.min(window.devicePixelRatio || 1, lwRange[1])));

    /* view matrix in JS doubles: clip = M2Â·R(twist)Â·AÂ·world + O(AÂ·anchor)
       — A is the optional drag affine, identity on every settled frame */
    const scale = vp.scale, tw = vp.twist || 0;
    const co = Math.cos(tw), si = Math.sin(tw);
    const kx = 2 * scale / cssW, ky = 2 * scale / cssH;
    const xa = xf ? xf[0] : 1, xb = xf ? xf[1] : 0, xc = xf ? xf[2] : 0;
    const xd = xf ? xf[3] : 1, xe = xf ? xf[4] : 0, xg = xf ? xf[5] : 0;
    const M2 = new Float32Array([
      kx * (co * xa - si * xb), ky * (si * xa + co * xb),
      kx * (co * xc - si * xd), ky * (si * xc + co * xd)]);
    const offOf = (ax0, ay0) => {
      const ax = xa * ax0 + xc * ay0 + xe, ay = xb * ax0 + xd * ay0 + xg;
      const rx = ax * co - ay * si, ry = ax * si + ay * co;   /* doubles */
      return [(rx * scale + vp.tx) * 2 / cssW - 1, (ry * scale + vp.ty) * 2 / cssH - 1];
    };

    const bg = rgbOf(typeof Nasj.activeBg === 'function' ? Nasj.activeBg() : '#212830');
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, palTex);

    /* device pixels per world unit — the unit the rasterizer works in, so
       the unit the coverage rule measures a run's length in. A scaled drag
       affine stretches every run by âˆš|det|, so coverage follows it. */
    const xfDet = xa * xd - xb * xc;
    const covPx = scale * (glCanvas.width / (cssW || glCanvas.width)) *
      (xf && Math.abs(xfDet) > 0 ? Math.sqrt(Math.abs(xfDet)) : 1);
    let covNow = -1;
    const setCov = (v) => {
      if (covNow === v) return;
      covNow = v;
      gl.uniform1f(uni.c.uCv, v);
    };

    /* the highlight the CURRENT pass carries. The marquee preview sets it up
       front for the whole (scissored) frame; the selection pass below sets
       it between two passes over the same items, which is why it is a
       variable and not the `tint` argument. */
    let hlMix = tint ? tint.mix : 0;
    let hlRGB = tint ? tint.rgb : null;
    let prog = null;
    const use = (p) => {
      if (prog === p) return;
      gl.useProgram(p);
      prog = p;
      const L = p === progChunk ? uni.c : uni.i;
      gl.uniformMatrix2fv(L.M, false, M2);
      gl.uniform1f(L.uPR, palRows);
      gl.uniform1i(L.uT, 0);
      gl.uniform3f(L.uB, bg[0] / 255, bg[1] / 255, bg[2] / 255);
      gl.uniform1f(L.uHl, hlMix);
      if (hlRGB) gl.uniform3f(L.uHlC, hlRGB[0] / 255, hlRGB[1] / 255, hlRGB[2] / 255);
    };

    /* view world AABB (twist-safe: the four screen corners inverted) —
       whole items outside it never reach the GPU, so a deep zoom draws
       only the chunks actually in view */
    let vx0 = Infinity, vy0 = Infinity, vx1 = -Infinity, vy1 = -Infinity;
    /* the tinted marquee pass culls to the RECT's world box, not the whole
       view — a small marquee pays for what it covers, a full one for one
       ordinary scene pass */
    const cx0 = tint ? tint.x : 0, cy0 = tint ? tint.y : 0;
    const cx1 = tint ? tint.x + tint.w : cssW, cy1 = tint ? tint.y + tint.h : cssH;
    for (const [sx, sy] of [[cx0, cy0], [cx1, cy0], [cx0, cy1], [cx1, cy1]]) {
      const rx = (sx - vp.tx) / scale, ry = (sy - vp.ty) / scale;
      let wx = rx * co + ry * si, wy = -rx * si + ry * co;    /* R(-twist) */
      if (xf) {
        /* item boxes are pre-transform world: cull against the view's
           pre-image through Aâ»Â¹ (a degenerate A draws everything) */
        if (Math.abs(xfDet) < 1e-12) { vx0 = vy0 = -Infinity; vx1 = vy1 = Infinity; break; }
        const px = wx - xe, py = wy - xg;
        wx = (xd * px - xc * py) / xfDet;
        wy = (xa * py - xb * px) / xfDet;
      }
      if (wx < vx0) vx0 = wx;
      if (wy < vy0) vy0 = wy;
      if (wx > vx1) vx1 = wx;
      if (wy > vy1) vy1 = wy;
    }
    const pad = 4 / scale;
    const inView = (it) => it.bx0 === undefined ||
      (it.bx1 >= vx0 - pad && it.bx0 <= vx1 + pad &&
       it.by1 >= vy0 - pad && it.by0 <= vy1 + pad);

    const bindItem = (it) => {
      if (extVao && it.vao) extVao.bindVertexArrayOES(it.vao);
      else if (it.kind === 'chunk') bindChunkVerts(it.vbo);
      else { bindMeshVerts(it.mesh.vbo, it.mesh.quant); bindInst(it.ibo); }
    };
    const setO = (it) => {
      const L = prog === progChunk ? uni.c : uni.i;
      const o = offOf(it.ax, it.ay);
      gl.uniform2f(L.O, o[0], o[1]);
    };
    /* phase 5: below tier A a GESTURE frame draws sub-pixel-dense buffers
       from their decimated companions — segments averaging under DECIM_PX
       on screen lose nothing the eye can resolve mid-motion, and the weak
       GPU pays a quarter of the verts. The settled frame is always exact. */
    const decimOn = !!gestureQ && effTier() !== 'A';
    let decimDraws = 0;
    let hasAlpha = false;
    const drawItem1 = (it) => {
      if (it.kind === 'chunk') {
        if (it.nA) hasAlpha = true;
        if (!it.nL && !it.nT) return;
        if (!inView(it)) return;
        use(progChunk);
        setO(it);
        if (decimOn && it.nLD && it.avgSegW * scale < DECIM_PX) {
          decimDraws++;
          if (extVao && it.vaoD) extVao.bindVertexArrayOES(it.vaoD);
          else {
            if (extVao) extVao.bindVertexArrayOES(null);
            bindChunkVerts(it.vboD);
          }
          setCov(covPx);
          gl.drawArrays(gl.LINES, 0, it.nLD);
          if (it.nT) {
            bindItem(it);
            setCov(0);
            gl.drawArrays(gl.TRIANGLES, it.nL, it.nT);
          }
          return;
        }
        bindItem(it);
        if (it.nL) { setCov(covPx); gl.drawArrays(gl.LINES, 0, it.nL); }
        if (it.nT) { setCov(0); gl.drawArrays(gl.TRIANGLES, it.nL, it.nT); }
        return;
      }
      if (!inView(it)) return;
      use(progInst);
      setO(it);
      gl.uniform1f(uni.i.uZ, zClip(it.z || 1));
      const m = it.mesh;
      if (decimOn && m.vboD &&
          m.avgSegW * (it.sMax || 1) * scale < DECIM_PX) {
        decimDraws++;
        if (extVao && it.vaoD) extVao.bindVertexArrayOES(it.vaoD);
        else {
          if (extVao) extVao.bindVertexArrayOES(null);
          bindMeshVerts(m.vboD, m.quant);
          bindInst(it.ibo);
        }
        extInst.drawArraysInstancedANGLE(gl.LINES, 0, m.countD, it.n);
        return;
      }
      bindItem(it);
      extInst.drawArraysInstancedANGLE(gl.LINES, 0, m.count, it.n);
    };
    /* phase 5 throttle harness: NÃ— overdraw â‰ˆ a GPU NÃ— weaker. Off (1) by
       default, never persisted, zero cost when off. */
    for (let od = 0; od < overdrawN; od++) {
      for (const it of scene.stream) drawItem1(it);
      for (const it of scene.delta) drawItem1(it);   /* additions draw last */
    }
    const drawItem2 = (it) => {
      if (it.kind !== 'chunk' || !it.nA || !inView(it)) return;
      use(progChunk);
      setO(it);
      bindItem(it);
      setCov(0);
      gl.drawArrays(gl.TRIANGLES, it.nL + it.nT, it.nA);
    };
    if (hasAlpha) {
      /* pass 2: translucent fills, depth-tested against the opaque picture
         (a later stroke keeps its crispness, an earlier one dims under the
         fill), blended in stream order within each buffer */
      gl.depthMask(false);
      for (let od = 0; od < overdrawN; od++) {
        for (const it of scene.stream) drawItem2(it);
        for (const it of scene.delta) drawItem2(it);
      }
      gl.depthMask(true);
    }
    /* ---- THE SELECTION, IN THE SELECTION COLOUR, IN ONE MORE PASS ----
     * Past a handful of objects the 2D layer used to take the highlight
     * back: every selected entity re-stroked in the accent, which for a
     * quarter-million of them is a 2.9-second restroke (measured) — the
     * drawing sat there un-blue while it ran. The same geometry is already
     * on this GPU, and the marquee preview already knows how to draw it in
     * another colour: the scene draws a SECOND time, scissored to the
     * selection's own box and mixed all the way to the accent by uHl. One
     * pass, whatever the count. The engine hands over the box only when
     * everything the box covers is selected but for a short list of
     * exceptions, and draws those exceptions itself in their own colours
     * over this — so what turns blue is exactly what is selected. */
    if (selT && !tint && !xf && scene) {
      const kx2 = glCanvas.width / cssW, ky2 = glCanvas.height / cssH;
      const sx2 = Math.max(0, Math.floor(selT.x * kx2));
      const sy2 = Math.max(0, Math.floor((cssH - selT.y - selT.h) * ky2));
      const sw2 = Math.min(glCanvas.width - sx2, Math.ceil(selT.w * kx2) + 1);
      const sh2 = Math.min(glCanvas.height - sy2, Math.ceil(selT.h * ky2) + 1);
      if (sw2 > 0 && sh2 > 0) {
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(sx2, sy2, sw2, sh2);
        hlMix = selT.mix;
        hlRGB = selT.rgb;
        prog = null;                       /* the uniforms are re-issued */
        covNow = -1;
        for (const it of scene.stream) drawItem1(it);
        for (const it of scene.delta) drawItem1(it);
        /* STROKES ONLY. The translucent fills (solid hatches) are already
           on the frame beneath in their own colours; drawing them again
           mixed to the accent laid a translucent blue light over every
           filled area of the selection — the one thing a highlight must
           not look like. The industry standard keeps a selected hatch's fill and marks
           its edges; the strokes above are those edges. */
        gl.disable(gl.SCISSOR_TEST);
      }
    }
    if (extVao) extVao.bindVertexArrayOES(null);
    if (tint) gl.disable(gl.SCISSOR_TEST);
    lastRender = { decimDraws, tier: decimOn ? effTier() : 'A', overdraw: overdrawN,
      selPass: !!(selT && !tint) };
  };

  /* the 2D-owned remainder (the engine's scene bitmap) as a textured quad
     over the geometry — the gesture-frame stand-in for the settled
     composite's "scene over GL" layering. Corners run capture-inverse â†’
     world â†’ current-forward in CPU doubles, so the text layer tracks the
     live viewport exactly the way blitScene stretched it. */
  const drawRemainder = (rem, xf) => {
    /* phase 4 (zero flashing): a stale remainder never blanks the text
       layer. When the engine cannot vouch for the current bitmap (the
       content signature moved — an edit landing, the GL build's own
       finish), the LAST-GOOD texture presents at its capture transform
       instead: mid-gesture, yesterday's words beat none. The measured
       flash was âˆ’59% of screen ink for a whole gesture. */
    if (!rem || !(rem.ok || (rem.st && rem.canvas))) {
      if (!remLast || remLast.doc !== Nasj.doc) return;
      rem = remLast;
    }
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(progQuad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, remTex);
    if (rem.canvas && rem.gen !== remGen) {
      /* phase 5, below tier A: the capture uploads at HALF resolution — the
         texImage2D readback of a screen-size accelerated canvas was the
         first-gesture frame's ~100ms on the UHD 770, and gesture frames are
         the only consumer (the settled compose is the true 2D canvas).
         Texture coords are normalized, so nothing else changes. */
      let src = rem.canvas;
      if (effTier() !== 'A' && src.width > 2 && src.height > 2) {
        if (!remHalfCv) remHalfCv = document.createElement('canvas');
        const hw = src.width >> 1, hh = src.height >> 1;
        if (remHalfCv.width !== hw || remHalfCv.height !== hh) {
          remHalfCv.width = hw;
          remHalfCv.height = hh;
        }
        const hcx = remHalfCv.getContext('2d');
        hcx.clearRect(0, 0, hw, hh);
        hcx.drawImage(src, 0, 0, hw, hh);
        src = remHalfCv;
      }
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      remGen = rem.gen;
    }
    if (rem !== remLast) {
      remLast = { doc: Nasj.doc, canvas: null, ok: true, gen: rem.gen,
        scale: rem.scale, tx: rem.tx, ty: rem.ty, tw: rem.tw,
        w: rem.w, h: rem.h, padX: rem.padX, padY: rem.padY };
    }
    gl.uniform1i(uni.q.uT, 0);
    const vp = Nasj.viewport;
    const main = document.getElementById('canvas');
    const cssW = parseFloat(main.style.width) || glCanvas.width;
    const cssH = parseFloat(main.style.height) || glCanvas.height;
    const cs = rem.scale, ctx0 = rem.tx, cty0 = rem.ty, ctw = rem.tw || 0;
    const cco = Math.cos(ctw), csi = Math.sin(ctw);
    const scale = vp.scale, tw = vp.twist || 0;
    const co = Math.cos(tw), si = Math.sin(tw);
    const W = rem.w + 2 * rem.padX, Hh = rem.h + 2 * rem.padY;
    const data = new Float32Array(16);
    let k = 0;
    for (const [sx, sy] of [[-rem.padX, -rem.padY], [rem.w + rem.padX, -rem.padY],
      [-rem.padX, rem.h + rem.padY], [rem.w + rem.padX, rem.h + rem.padY]]) {
      const rx = (sx - ctx0) / cs, ry = (sy - cty0) / cs;
      let wx = rx * cco + ry * csi, wy = -rx * csi + ry * cco;
      if (xf) {
        /* the drag ghost's quad: the same settled words, carried through
           the drag affine — the unified source, never a restroke */
        const qx = xf[0] * wx + xf[2] * wy + xf[4];
        wy = xf[1] * wx + xf[3] * wy + xf[5];
        wx = qx;
      }
      const fx = wx * co - wy * si, fy = wx * si + wy * co;
      data[k++] = (fx * scale + vp.tx) * 2 / cssW - 1;
      data[k++] = (fy * scale + vp.ty) * 2 / cssH - 1;
      data[k++] = (sx + rem.padX) / W;
      data[k++] = 1 - (sy + rem.padY) / Hh;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    for (let i = 2; i < 8; i++) gl.disableVertexAttribArray(i);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.DEPTH_TEST);
  };

  /* gesture frames: GL presents through its own DOM canvas — geometry plus
     the remainder quad — and the 2D canvas below carries only bg+grid.
     No cross-context drawImage, no GPU sync on the wheel path. */
  const presentLive = (rem) => {
    if (!live()) { hideDom(); return false; }
    const t0 = performance.now();
    const gesture = t0 - gov.lastT < GOV_GESTURE_MS;
    /* phase 5, tier C: mid-gesture, present every 2nd event — the frame on
       screen HOLDS whole (half the present rate, never a blank or a tear).
       The first event of a gesture and any frame carrying a doc edit
       always render, so latency and correctness keep their shape. */
    if (gesture && effTier() === 'C' && !dirty && domShown) {
      gov.skipTick = !gov.skipTick;
      if (gov.skipTick) {
        gov.lastT = t0;
        gov.heldFrames++;
        lastFrame = { ms: 0, mode: 'held' };
        return true;
      }
    } else gov.skipTick = false;
    render(true);
    drawRemainder(rem);
    showDom();
    marqOwned = false;                   /* a gesture frame took the canvas */
    marqKey = '';
    const ms = +(performance.now() - t0).toFixed(2);
    gov.lastT = performance.now();
    lastFrame = { ms, mode: 'dom' };
    govPresent(ms, gesture);
    return true;
  };

  /* the selection highlight's scissor box, in css px, or null (see the
     second pass in render). The engine sets it before every frame it
     drives, so a pan or a zoom carries it without any state of its own. */
  let selT = null;
  const setSelTint = (r) => {
    selT = (r && r.w > 0 && r.h > 0)
      ? { x: r.x, y: r.y, w: r.w, h: r.h, rgb: rgbOf(r.color),
        mix: Number(r.mix) || 1 } : null;
    return !!selT;
  };

  /* ---------------- marquee preview: the tinted second pass ----------------
   * While a window/crossing rectangle is dragged over a SETTLED view, the
   * content under it wears the selection accent: the scene draws once more,
   * scissored to the rect, its color mixed toward the accent by a uniform —
   * one-ish draw calls at any coverage — onto the (otherwise transparent)
   * DOM canvas riding over the settled composite. Presents are deduped by
   * rect+view+scene generation, since the overlay repaints more often than
   * the rect moves. presentLive/compose keep priority: a gesture frame or a
   * settle takes the canvas back, and the next overlay pass re-asserts. */
  const marqueePresent = (x, y, w, h, color, mix) => {
    if (!live() || !scene || buildJob) return false;
    const vp = Nasj.viewport;
    const key = [x, y, w, h, vp.scale, vp.tx, vp.ty, vp.twist || 0,
      patchGen, color, mix].join(',');
    if (marqOwned && domShown && key === marqKey) return true;
    /* gesture-grade fidelity: below tier A the pass may draw the decimated
       companions, exactly as a pan frame would — the tint is a live preview */
    render(true, { x, y, w, h, rgb: rgbOf(color), mix: Number(mix) || 0.5 });
    showDom();
    marqOwned = true;
    marqKey = key;
    return true;
  };
  const marqueeEnd = () => {
    marqKey = '';
    if (!marqOwned) return;
    marqOwned = false;
    hideDom();
  };
  /* settle-idle warm: one 2px scissored tint render on the HIDDEN canvas
     primes the pipeline-state combination (scissor + highlight uniform)
     whose first-ever use cost the first marquee frame a vsync. Never runs
     while the canvas is presenting — nothing on screen may change. */
  const marqueeWarm = () => {
    if (!live() || !scene || buildJob || domShown) return false;
    render(true, { x: 0, y: 0, w: 2, h: 2, rgb: [0, 0, 0], mix: 0 });
    return true;
  };

  /* the settled composite: the GL frame INTO the 2D canvas, under the
     scene bitmap and over bg+grid — one picture for getImageData, QA
     suites and window captures alike. The DOM canvas hides.
     AND, AT TIER A, THE GESTURE FRAMES TOO (gesture = true). Phase 3 moved
     gestures onto the DOM canvas to dodge a webglâ†’2d drawImage measured at
     4.6ms; on an accelerated 2D canvas that copy is now 0.0-0.2ms at
     2400x1079, and the whole gesture frame costs 3.8ms against the DOM
     path's 2.7. For that 1.1ms the picture stops being two layers: the 2D
     canvas carries the true geometry every frame (getImageData, QA pixels
     and the settle fade all read the frame the eye is given), and the grid
     under it can no longer march a notch ahead of the geometry over it.
     Below tier A the DOM presentation stands exactly as it was — that is
     where the 4.6ms class of copy still bites, and where the held frames
     live. The governor keeps its per-frame samples either way. */
  const compose = (ctx2d, gesture) => {
    if (!live()) { hideDom(); return; }
    const t0 = performance.now();
    render(!!gesture);
    ctx2d.save();
    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
    ctx2d.drawImage(glCanvas, 0, 0);
    ctx2d.restore();
    /* a drag in flight keeps its ghost presented: a settle landing
       mid-drag (the zoom's crisp arriving) must not blank the DOM canvas
       until the next pointermove — re-present over the fresh composite */
    if (drag && renderDrag()) showDom();
    else hideDom();
    marqOwned = false;                   /* the settle took the canvas back */
    marqKey = '';
    const ms = +(performance.now() - t0).toFixed(2);
    lastFrame = { ms, mode: gesture ? 'compose-live' : 'compose' };
    if (gesture) {
      gov.lastT = performance.now();
      govPresent(ms, true);
    } else govArmStepUp();               /* a settled frame: rebench window */
  };

  /* ---------------- phase 4: GPU drag (MOVE preview) ----------------
   * The dragged set builds ONCE into its own chunks (the same tessellation
   * helpers the delta uses); every frame after that is a translation
   * folded into each chunk's anchor offset — two uniforms per chunk, not a
   * 5,000-entity clone-and-restroke (51ms/frame on the 2D path, measured).
   * Presents through the DOM canvas OVER the settled composite, so the 2D
   * canvas below keeps the whole picture; 2D-owned kinds (text, dims…)
   * are returned to the caller as leftovers for its classic preview. */
  let drag = null;    /* {items, m:[a,b,c,d,e,f], whole, job} */
  const freeDrag = () => {
    if (!drag) return;
    if (gl && drag.items) for (const it of drag.items) freeItem(it);
    drag = null;
    if (dragPumpTimer) { clearTimeout(dragPumpTimer); dragPumpTimer = 0; }
  };
  const dragChunkFor = (x, y, need) => {
    const list = drag.items;
    let ck = list.length ? list[list.length - 1] : null;
    if (ck && (Math.abs(x - ck.ax) > ANCHOR_R || Math.abs(y - ck.ay) > ANCHOR_R ||
        chunkVerts(ck) + need > CHUNK_VERTS)) ck = null;
    if (!ck) {
      ck = { kind: 'chunk', ax: x, ay: y, sL: null, sT: null, sA: null,
        vbo: null, count: 0, nL: 0, nT: 0, nA: 0, ids: [], vao: null,
        hasInline: false,
        bx0: Infinity, by0: Infinity, bx1: -Infinity, by1: -Infinity };
      list.push(ck);
    }
    return ck;
  };
  /* one entity into the ghost: true (taken), false (a 2D-only kind — the
     caller's classic dashed preview draws it), or PENDING (a huge
     definition ran past the slice deadline; come back with the SAME
     entity — bakeRef/defCPUFor hold their place on bs2). */
  const dragTakeOne = (bs2, ent, probe, deadline) => {
    try {
      if (ent.type === 'insert') {
        const def = bs2.doc.blocks[ent.name];
        if (!def || !Array.isArray(def.entities)) return false;
        const dynamic = ent.dyn || ent.visState ||
          (def.visibility && Array.isArray(def.visibility.states) && def.visibility.states.length);
        if (dynamic) { zBegin(bs2, 1); return !!inlineRef(bs2, ent, probe); }
        const cpu = defCPUFor(bs2, ent.name, deadline);
        if (cpu === PENDING) return PENDING;
        if (!cpu || !(cpu.n || cpu.nt)) return false;
        if (!bs2.pend) zBegin(bs2, 1);
        const r = bakeRef(bs2, ent, cpu, probe, deadline);
        if (r === PENDING) { bs2.pend = 1; return PENDING; }
        bs2.pend = 0;
        return !!r;
      }
      if (STROKEABLE[ent.type] || (ent.type === 'hatch' && hatchOwnable(ent))) {
        zBegin(bs2, 1);
        const r = addLoose(bs2, ent, probe);
        return !!r && r !== 'demote';    /* demoted fills stay on the 2D preview */
      }
    } catch (e) { return false; }
    return false;
  };
  /* a big set builds in slices — one budget per pump (dragXform calls it
     every frame), the ghost growing under the cursor instead of freezing
     the first frame for the whole build. Kinds GL cannot take join
     d.leftover as they are met (the classic preview's list). */
  const DRAG_SYNC_N = 8000;
  const DRAG_SLICE_MS = 8;
  const DRAG_LEFTOVER_CAP = 2000;        /* callers preview â‰¤300 of them */
  const dragPump = (deadline) => {
    const d = drag;
    if (!d || !d.job || !scene) return;
    const J = d.job;
    const doc = scene.doc;
    for (;;) {
      let ent = J.cur;
      if (!ent) {
        const s = J.it.next();
        if (s.done) { d.job = null; break; }
        ent = typeof s.value === 'object' ? s.value
          : Nasj.docOps.entityById(doc, s.value);
        if (!ent) continue;
      }
      const r = dragTakeOne(J.bs2, ent, J.probe, deadline);
      if (r === PENDING) { J.cur = ent; break; }
      J.cur = null;
      if (!r && d.leftover.length < DRAG_LEFTOVER_CAP) d.leftover.push(ent.id);
      if (performance.now() > deadline) break;
    }
    /* finished chunks upload once and drop their sinks; the growing tail
       re-uploads each pump so what is built so far is always on screen */
    const last = d.items.length ? d.items[d.items.length - 1] : null;
    for (const ck of d.items) {
      if (!ck.sL && !ck.sT && !ck.sA) continue;
      chunkUpload(ck);
      if (!ck.vao) itemVao(ck);
      if (!d.job || ck !== last) ck.sL = ck.sT = ck.sA = null;
    }
  };
  /* THE PUMP DOES NOT WAIT FOR THE HAND. dragXform pumps a slice per
     pointermove — and that used to be the ONLY pump, so a still pointer
     froze the ghost half-built (the owner watched it: moving fills it in,
     holding still freezes it). While a job remains, these ticks carry the
     build and re-present the grown ghost at frame pace, motion or none. */
  let dragPumpTimer = 0;
  const dragPumpArm = () => {
    if (dragPumpTimer) return;
    const tick = () => {
      dragPumpTimer = 0;
      if (!drag || !drag.job || !scene) return;
      dragPump(performance.now() + DRAG_SLICE_MS);
      if (renderDrag()) {
        gov.lastT = performance.now();   /* a ghost frame IS a gesture */
        showDom();
      }
      if (drag && drag.job) dragPumpTimer = setTimeout(tick, 16);
    };
    dragPumpTimer = setTimeout(tick, 16);
  };
  const dragBegin = (idSet) => {
    freeDrag();
    if (!live()) return null;
    const t0 = performance.now();
    const rec = scene.records;
    const doc = scene.doc;
    /* TIER: when the set covers every GL-owned entity the ghost IS the
       scene — nothing is built for it, and every frame is one ordinary
       scene pass with the affine folded into the view matrix (render's
       xf). The 2D-owned remainder still ghosts: its strokeables and
       references build through the sliced job (they bake exactly as the
       per-entity ghost bakes them), and only the truly-2D kinds (text,
       dims…) go back as leftovers for the classic dashed preview. */
    if (idSet && rec.size && idSet.size >= rec.size) {
      /* select-all is the common heavy case: the set IS the document, so
         every GL record and every remainder entity is in it — skip the
         240k-key walk and the remainder scan (measured 300ms+ on the
         first MOVE frame of BLOCKS.dwg). */
      const all = !!(Nasj.doc && idSet.size === Nasj.doc.entities.length);
      let whole = all;
      if (!whole) {
        whole = true;
        for (const id of rec.keys()) if (!idSet.has(id)) { whole = false; break; }
      }
      if (whole) {
        const rest = all ? [] : (remainder() || []);
        /* THE UNIFIED SOURCE. When the selection covers the REMAINDER too
           (true select-all), the 2D-owned part of the ghost is not built
           at all: the settled remainder bitmap rides the drag affine as a
           quad — complete on frame 1, texts and banners included, where
           the sliced pump painted it in region by region (the owner
           watched it happen). The pump and the dashed leftover survive
           only as the degrade for a selection that covers every GL record
           but not every 2D entity, or when no bitmap can vouch. */
        let covered = all;
        if (!covered) {
          covered = true;
          for (const e of rest) if (!idSet.has(e.id)) { covered = false; break; }
        }
        let remSnap = null;
        if (covered && typeof Nasj.remainderSnap === 'function') {
          const snap = Nasj.remainderSnap(true);
          if (snap && snap.canvas && snap.st) remSnap = snap;
        }
        if (remSnap) {
          drag = { whole: true, covered: true, items: [], job: null,
            leftover: [], rem: remSnap, m: [1, 0, 0, 1, 0, 0] };
          if (!all) restBoxWarm();
          return { n: rec.size, whole: true, leftover: [],
            ms: +(performance.now() - t0).toFixed(1) };
        }
        const extras = [];
        const leftover = [];
        for (const e of rest) {
          if (!idSet.has(e.id)) continue;
          if (e.type === 'insert' || STROKEABLE[e.type] ||
              (e.type === 'hatch' && hatchOwnable(e))) extras.push(e);
          else if (leftover.length < DRAG_LEFTOVER_CAP) leftover.push(e.id);
        }
        /* covered marks the cold-open degrade (no snapshot EVER taken):
           the moment the first crisp lands mid-drag, renderDrag swaps the
           quad in over this pump and the ghost completes at once */
        drag = { whole: true, covered, items: [], job: null, leftover,
          m: [1, 0, 0, 1, 0, 0] };
        if (extras.length) {
          drag.job = { it: extras[Symbol.iterator](), cur: null,
            bs2: patchState(), probe: (x, y, need) => dragChunkFor(x, y, need) };
          dragPump(performance.now() + 8);
          dragPumpArm();                 /* a still pointer converges too */
        }
        if (!all) restBoxWarm();   /* select-all already has the content box */
        return { n: rec.size, whole: true, leftover,
          ms: +(performance.now() - t0).toFixed(1) };
      }
    }
    const bs2 = patchState();
    drag = { items: [], job: null, leftover: [], m: [1, 0, 0, 1, 0, 0] };
    const probe = (x, y, need) => dragChunkFor(x, y, need);
    if (idSet.size > DRAG_SYNC_N) {
      drag.job = { it: idSet.values(), cur: null, bs2, probe };
      dragPump(performance.now() + 24);
      dragPumpArm();                     /* a still pointer converges too */
      return { n: idSet.size, leftover: drag.leftover, sliced: true,
        ms: +(performance.now() - t0).toFixed(1) };
    }
    let n = 0;
    for (const id of idSet) {
      const ent = Nasj.docOps.entityById(doc, id);
      if (!ent) continue;
      if (dragTakeOne(bs2, ent, probe)) n++; else drag.leftover.push(id);
    }
    const leftover = drag.leftover;
    for (const ck of drag.items) {
      chunkUpload(ck);
      ck.sL = ck.sT = ck.sA = null;
      itemVao(ck);
    }
    if (!n) { freeDrag(); return null; }
    return { n, leftover, ms: +(performance.now() - t0).toFixed(1) };
  };
  const renderDrag = () => {
    if (!gl || !drag) return false;
    if (drag.whole) {
      /* the ghost is the scene itself, transformed — depth, fills, tiers
         and culling all exactly as a live frame draws them — plus either
         the settled remainder bitmap through the same affine (the unified
         source: texts and banners complete on frame 1) or, degraded, the
         strokeables the sliced job has baked so far */
      if (!scene) return false;
      render(true, null, drag.m);
      /* a crisp landing mid-drag: the fresher settled snapshot takes the
         quad over seamlessly (rem.gen moved — one texture re-upload, the
         same words merely sharper), and on the cold-open degrade (covered
         but no snapshot at dragBegin) it retires the pump outright */
      if (drag.covered && typeof Nasj.remainderSnap === 'function') {
        const s = Nasj.remainderSnap(true);
        if (s && s.canvas && s.st && (!drag.rem || s.gen !== drag.rem.gen)) {
          drag.rem = s;
          drag.job = null;
        }
      }
      if (drag.rem) drawRemainder(drag.rem, drag.m);
      else if (drag.items.length) drawDragItems(false);
      return true;
    }
    return drawDragItems(true);
  };
  const drawDragItems = (clear) => {
    if (!syncSize()) return false;
    ensurePalette();          /* the ghost indexes the same table */
    const vp = Nasj.viewport;
    const main = document.getElementById('canvas');
    const cssW = parseFloat(main.style.width) || glCanvas.width;
    const cssH = parseFloat(main.style.height) || glCanvas.height;
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    if (clear) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
    gl.disable(gl.DEPTH_TEST);            /* ghosts draw in build order */
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (!lwRange) lwRange = gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE);
    gl.lineWidth(Math.max(lwRange[0], Math.min(window.devicePixelRatio || 1, lwRange[1])));
    const scale = vp.scale, tw = vp.twist || 0;
    const co = Math.cos(tw), si = Math.sin(tw);
    const kx = 2 * scale / cssW, ky = 2 * scale / cssH;
    /* THE GHOST'S OWN TRANSFORM, FOLDED INTO THE VIEW MATRIX.
       A chunk's vertices are world points measured from its anchor, and the
       shader draws Mview*p + O. Under a world affine T(w) = A*w + t the
       drawn point is Mview*(A*(anchor+p) + t) = (Mview*A)*p +
       Mview*(A*anchor + t) — a 2x2 product and a moved anchor, both on the
       CPU once per frame. So ROTATE, SCALE and MIRROR cost the GPU exactly
       what MOVE's offset cost it. m = [a,b,c,d,e,f]:
         x' = a*x + c*y + e,  y' = b*x + d*y + f
       and identity-plus-translation is what dragTo sets, which is the only
       case that existed before. */
    const m = drag.m;
    const ma = m[0], mb = m[1], mc = m[2], md = m[3], me = m[4], mf = m[5];
    gl.useProgram(progChunk);
    gl.uniformMatrix2fv(uni.c.M, false, new Float32Array([
      kx * (co * ma - si * mb), ky * (si * ma + co * mb),
      kx * (co * mc - si * md), ky * (si * mc + co * md)]));
    gl.uniform1f(uni.c.uPR, palRows);
    gl.uniform1i(uni.c.uT, 0);
    const bg = rgbOf(typeof Nasj.activeBg === 'function' ? Nasj.activeBg() : '#212830');
    gl.uniform3f(uni.c.uB, bg[0] / 255, bg[1] / 255, bg[2] / 255);
    /* a scaled ghost's runs reach further (or less far) across the screen
       than the world lengths baked into c.a, so the coverage computed from
       them follows the transform's own scale — |det| is area, its root is
       length */
    const det = Math.abs(ma * md - mb * mc);
    const covPx = scale * (glCanvas.width / (cssW || glCanvas.width)) *
      (det > 0 ? Math.sqrt(det) : 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, palTex);
    for (const it of drag.items) {
      if (!it.vbo) continue;             /* a sliced build not yet uploaded */
      const ax = ma * it.ax + mc * it.ay + me;            /* the whole trick */
      const ay = mb * it.ax + md * it.ay + mf;
      const rx = ax * co - ay * si, ry = ax * si + ay * co;
      gl.uniform2f(uni.c.O,
        (rx * scale + vp.tx) * 2 / cssW - 1, (ry * scale + vp.ty) * 2 / cssH - 1);
      if (extVao && it.vao) extVao.bindVertexArrayOES(it.vao);
      else bindChunkVerts(it.vbo);
      if (it.nL) {
        gl.uniform1f(uni.c.uCv, covPx);
        gl.drawArrays(gl.LINES, 0, it.nL);
      }
      if (it.nT + it.nA) {
        gl.uniform1f(uni.c.uCv, 0);
        gl.drawArrays(gl.TRIANGLES, it.nL, it.nT + it.nA);
      }
    }
    if (extVao) extVao.bindVertexArrayOES(null);
    gl.enable(gl.DEPTH_TEST);
    return true;
  };

  /* ---------------- change signals (task-4 hints) ---------------- */
  (() => {
    const ops = Nasj.docOps;
    /* commits whose mutation set is provably (selection âˆª wrapped ops):
       verified against tools.js — move/rotate/scale/mirror run xformInPlace
       over selectedEnts() (geom wraps double-cover), copy/offset/draw tools
       only addEntity, erase/trim/extend only deleteEntities+addEntity.
       Everything else (fillet's second pick, grips, pedit, lengthen,
       property edits) is unhinted and takes the full sweep. */
    const ALLOW = {
      move: 1, copy: 1, rotate: 1, scale: 1, mirror: 1, erase: 1,
      trim: 1, extend: 1, offset: 1, stretch: 1,
      line: 1, pline: 1, polyline: 1, circle: 1, arc: 1, rect: 1,
      rectangle: 1, ellipse: 1, spline: 1, point: 1, hatch: 1
    };
    if (ops && !ops._glWrapped) {
      ops._glWrapped = true;
      for (const k of ['undo', 'redo']) {
        const fn = ops[k];
        if (typeof fn !== 'function') continue;
        ops[k] = function (doc) {
          pend.sigSeq++;
          dirty = true;
          /* a stack entry tagged as a whole-document translation (MOVE
             with everything selected — tools.js writes the tag) applies as
             an anchor shift, not a full sweep. The tag is trusted only for
             the live scene's own document. */
          const st = doc && (k === 'undo' ? doc.undoStack : doc.redoStack);
          const top = st && st.length ? st[st.length - 1] : null;
          const xf = (top && top.xf && scene && scene.doc === doc) ? top.xf : null;
          if (xf && isFinite(xf.dx) && isFinite(xf.dy)) {
            pend.unhinted = true;
            /* seq pins the hint to THIS cycle: any signal after it (an
               add, a delete, another commit) retires it — mixed cycles
               take the full sweep, exactly as before */
            pend.xlate = { dx: xf.dx, dy: xf.dy, all: true, seq: pend.sigSeq };
          } else pend.full = true;
          return fn.apply(this, arguments);
        };
      }
      const pu = ops.pushUndo;
      if (typeof pu === 'function') {
        ops.pushUndo = function () {
          dirty = true;
          pend.sigSeq++;
          const name = Nasj.tools && Nasj.tools.activeName;
          if (name && ALLOW[name]) {
            pend.armed = true;
            const sel = Nasj.selection;
            if (sel instanceof Set) {
              if (sel.size > HINT_CAP) pend.unhinted = true;
              else for (const id of sel) pend.ids.add(id);
            }
          } else pend.unhinted = true;
          return pu.apply(this, arguments);
        };
      }
      const ae = ops.addEntity;
      if (typeof ae === 'function') {
        ops.addEntity = function () {
          dirty = true;
          pend.sigSeq++;
          /* a list already moved through an unwrapped path (wipe/splice)
             must not be resynced away — flag it before absorbing the op */
          if (entsMoved()) pend.full = true;
          const r = ae.apply(this, arguments);
          if (r && r.id != null) pend.ids.add(r.id);
          entsSync();
          return r;
        };
      }
      /* phase 4: a live entity about to be mutated in place by a
         membership-only command (PLINE's vertex growth) — hint it, so the
         cycle patches the scene instead of skipping (the skip left the GL
         stroke stale AND let the index absorb a moved-geometry bump) */
      const ce = ops.captureEntity;
      if (typeof ce === 'function') {
        ops.captureEntity = function (doc, ent) {
          dirty = true;
          pend.sigSeq++;
          if (ent && ent.id != null && pend.ids.size <= HINT_CAP) pend.ids.add(ent.id);
          return ce.apply(this, arguments);
        };
      }
      const de = ops.deleteEntities;
      if (typeof de === 'function') {
        ops.deleteEntities = function (doc, idSet) {
          dirty = true;
          pend.sigSeq++;
          if (entsMoved()) pend.full = true;
          try {
            let n = 0;
            for (const id of (idSet instanceof Set ? idSet : (idSet || []))) {
              if (++n > HINT_CAP) { pend.unhinted = true; break; }
              pend.ids.add(id);
            }
          } catch (e) { pend.unhinted = true; }
          const r = de.apply(this, arguments);
          entsSync();
          return r;
        };
      }
    }
    /* the in-place mutators contribute ids while a hint window is ARMED
       (a pushUndo from an allowlisted tool) — previews run these on clones
       between commits, and the arming keeps that noise out of the set */
    const G = Nasj.geom;
    if (G && !G._glHints) {
      G._glHints = true;
      for (const k of ['translateEntity', 'rotateEntityAbout', 'scaleEntityAbout',
        'mirrorEntity', 'entityPointRefs']) {
        const fn = G[k];
        if (typeof fn !== 'function') continue;
        G[k] = function (e) {
          if (pend.armed && e && e.id != null && pend.ids.size <= HINT_CAP) pend.ids.add(e.id);
          return fn.apply(this, arguments);
        };
      }
    }
    if (typeof Nasj.hiddenBump === 'function' && !Nasj.hiddenBump._gl) {
      const hb = Nasj.hiddenBump;
      /* dirty only — the next sync's hidSig diff names the changed ids
         itself and they ride the hint patch (see ensureFresh); forcing a
         full sweep here is what made SCALE's dim un-live the scene */
      Nasj.hiddenBump = () => { pend.sigSeq++; dirty = true; return hb(); };
      Nasj.hiddenBump._gl = true;
    }
    /* reasons that never mutate entity geometry or per-entity styling —
       a cycle made only of these skips the fingerprint sweep entirely
       (the palette/env checks still run): the layer-panel <5ms path */
    /* 'activate' joins them: switching tabs does not touch a single entity
       of either drawing, and treating it as an unknown (therefore
       geometry-shaping) reason cost the incoming scene a full fingerprint
       sweep — 133-313ms, measured, which was most of what a switch to a
       heavy drawing still cost once its buffers stopped being thrown away */
    const NOENT = { layers: 1, 'current-layer': 1, save: 1, groups: 1,
      'plot-settings': 1, activate: 1, close: 1 };
    window.addEventListener('nasj:doc', (ev) => {
      const r = ev && ev.detail && ev.detail.reason;
      if (r === 'glscene' || r === 'glscene-mode') return;   /* our own beat */
      dirty = true;
      /* a bare {doc} whose signals were all consumed by the render that
         preceded the emit (docChanged renders first) is a no-op: skip the
         sweep instead of paying a second, empty full pass */
      if (r == null) { if (pend.sigSeq !== pend.sweptSeq) pend.edit = true; }
      else if (NOENT[r]) pend.noent = true;
      else { pend.unhinted = true; pend.edit = true; pend.sigSeq++; }
    });
    window.addEventListener('nasj:settings', (ev) => {
      const k = ev && ev.detail && ev.detail.key;
      if (k === 'lwt' || k === 'poche' || k === 'glscene') dirty = true;
    });
  })();

  /* CAN THIS SCENE BE VOUCHED FOR? Everything the presented picture rests
     on, each answered yes or no, so "the drawing on screen is whole and is
     this document's" is a thing that can be ASSERTED rather than looked at.
     The field that was missing is `palTex`: the scene was complete, its own
     bookkeeping was clean, and the table its vertices index into belonged
     to the drawing that had just been left. Anything false here and the
     next sync must put it right before the frame is presented. */
  const vouch = () => {
    if (!scene) return null;
    const doc = scene.doc;
    return {
      doc: doc === Nasj.doc,
      ents: !entsMoved(),
      gen: scene.gen === (Nasj.docGen ? Nasj.docGen(doc) : scene.gen),
      env: envSigNow(doc) === scene.envSig,
      hid: hidSigNow() === scene.hidSig,
      pal: palSigNow(doc) === scene.palSig,
      palTex: palTexOf === scene.layerIdx,
      tier: scene.qtier === effTier(),
      fresh: !scene.stale && !dirty,
      built: !buildJob
    };
  };
  /* what the scene actually holds, in the units a round trip can compare:
     if a drawing comes back short, one of these is short */
  const presented = () => {
    if (!scene) return null;
    const st = scene.stats.counts;
    const rest = live() ? remainder() : null;
    return {
      chunks: scene.stream.filter((s) => s.kind === 'chunk').length,
      instanced: scene.stream.filter((s) => s.kind !== 'chunk').length,
      draws: scene.stream.length + scene.delta.length,
      delta: scene.delta.length,
      meshes: scene.meshes.length,
      records: scene.records.size,
      owned2D: st.owned2D,
      remainder: rest ? rest.length : -1,
      segs: st.segsLoose + st.segsBaked + st.segsDef,
      tris: scene.stats.fills.tris,
      zGroups: st.zGroups,
      layers: scene.layerIdx.size,
      bytes: scene.stats.bytes.total
    };
  };

  /* ---------------- public surface ---------------- */
  Nasj.glscene = {
    /* mode & probe */
    mode,
    setMode(v) {
      const m = normMode(v) || 'auto';
      lsSet(MODE_KEY, m);
      if (Nasj.settings) Nasj.settings.glscene = m;
      dirty = true;
      if (m === 'off') { freeAllScenes(); hideDom(); }
      emitDoc('glscene-mode');
      return m;
    },
    probe: ensureVerdict,
    reprobe() { lsSet(PROBE_KEY, ''); verdict = null; return ensureVerdict(); },
    status() {
      return {
        mode: mode(),
        verdict: verdict ? Object.assign({}, verdict) : null,
        active: enabled(),
        live: live(),
        building: !!buildJob,
        dirty,
        renderer: verdict ? verdict.renderer : null,
        depthBits,
        stats: scene ? scene.stats : null,
        /* the picture's own word on itself (see vouch/presented above) */
        vouch: vouch(),
        presented: presented(),
        /* the per-document cache, as the memory policy sees it */
        cache: {
          docs: scenes.size,
          bytes: sceneBytes,
          capBytes: GL_BYTE_CAP,
          evicted,
          scenes: [...scenes.values()].map((sc) => ({
            name: (sc.doc && sc.doc.name) || '?',
            bytes: sceneBytesOf(sc),
            live: sc === scene,
            stale: !!sc.stale
          }))
        },
        drawCalls: scene ? scene.stream.length + scene.delta.length : 0,
        delta: scene ? { ids: scene.deltaIds, segs: scene.deltaSegs, chunks: scene.delta.length } : null,
        demoted: scene ? scene.demoted.size : 0,
        palRows,
        lastPatch,
        lastFrame,
        lastRender,
        domShown,
        remGen,
        /* an xlate patch's sliced fingerprint re-walk still in flight */
        fpPending: !!(scene && scene.fpJob),
        /* phase 5: the governor's full state, for QA and the curious */
        governor: {
          tier: probeTier(),
          base: baseTier(),
          eff: effTier(),
          buildTier: scene ? scene.qtier : null,
          budgetMs: +gov.budget.toFixed(2),
          emaMs: +gov.ema.toFixed(2),
          syncMs: gov.sync,
          stepDowns: gov.stepDowns,
          heldFrames: gov.heldFrames,
          overdraw: overdrawN,
          log: gov.log.slice(),
          /* the last step-up measurement, pass or refuse (see govRebench) */
          rebench: gov.lastRebench || null
        }
      };
    },
    /* phase 5 throttle harness (debug only, never persisted): draw the
       scene N times per frame â‰ˆ a GPU NÃ— weaker. 1 = off, zero cost. */
    setOverdraw(n) {
      overdrawN = Math.max(1, Math.min(64, Number(n) | 0 || 1));
      return overdrawN;
    },
    /* phase 5 debug: pin the effective tier (QA of the tier knobs), or
       null to hand the session back to the probe grade + live governor */
    setTier(t) {
      gov.eff = (t === 'A' || t === 'B' || t === 'C') ? t : null;
      return effTier();
    },
    /* engine seams */
    sync,
    owner,
    remainder,
    /* the 2D-owned part's world box (cached, idle-warmed, xlate-shifted) —
       null while this layer cannot answer for it */
    remainderBox() {
      if (!live()) return null;
      const list = remainder();
      if (!list) return null;
      if (scene.restBox && scene.restBox.list === list) return scene.restBox.box;
      if (!scene.restBoxJob || scene.restBoxJob.list !== list) {
        scene.restBoxJob = { list, i: 0,
          x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      }
      restBoxCompute(scene, 0);          /* finish what the warm started */
      return scene.restBox ? scene.restBox.box : null;
    },
    live,
    /* phase 5: the engine's background passes ask before queueing GPU debt
       a weak rasterizer cannot drain (the 400-600ms settle rAF stalls
       measured on the UHD 770) */
    weakTier: () => effTier() !== 'A',
    compose,
    presentLive,
    /* phase 4: the engine's settle fade captures the frame the eye was
       just given — when the gesture presented through the DOM canvas,
       that canvas IS the picture (the 2D one below holds only bg+grid) */
    presentedCanvas: () => (domShown && glCanvas ? glCanvas : null),
    /* phase 4 (the drawing hang): one-shot — true when the last consumed
       cycle was absorbed whole into GL (see cycleAbsorbed above). The
       engine takes it once per render; taking clears it, so a docRev bump
       glscene never saw (an image load) can never ride an old verdict. */
    absorbedTake() {
      const a = cycleAbsorbed;
      cycleAbsorbed = false;
      return a && live();
    },
    /* phase 4: one-shot — the last consumed cycle moved no geometry in
       place, AND nothing has signalled since (a pending pushUndo would
       mean an in-place edit may be mid-flight). The engine's spatial
       index absorbs the commit's trailing bare emit on this word. */
    cleanTake() {
      const c = cycleGeomClean;
      cycleGeomClean = false;
      return c && live() && pend.sigSeq === pend.sweptSeq &&
        !pend.full && !pend.unhinted && !pend.edit && !pend.noent &&
        pend.ids.size === 0;
    },
    /* the marquee preview's tinted pass (engine's overlay drives it) */
    marqueePresent,
    marqueeEnd,
    marqueeWarm,
    /* the mass selection's highlight, drawn by this layer (see render) */
    setSelTint,
    /* the tools' word that the commit just made translated EVERY entity by
       one (dx,dy): the next sync shifts anchors instead of sweeping (all
       verified against records when `all` is not asserted) */
    xlateHint(dx, dy, all) {
      if (!live()) return false;
      if (!isFinite(dx) || !isFinite(dy)) return false;
      pend.xlate = { dx, dy, all: !!all, seq: pend.sigSeq,
        ids: all ? null : (Nasj.selection instanceof Set ? Nasj.selection : null) };
      return true;
    },
    /* the mass selection's cover, answered from records instead of a
       241k-entity bounds walk: the union box of everything GL draws, and
       the (few) visible GL-owned entities NOT in the set — null when this
       layer cannot answer, {over:true} when the misses outgrow excMax and
       the caller's own walk is the cheaper truth. */
    selCover(sel, excMax) {
      if (!live() || !scene || !(sel instanceof Set)) return null;
      const rec = scene.records;
      if (!rec.size) return null;
      const doc = scene.doc;
      const cap = Math.max(1, excMax | 0);
      /* three callers per commit ask the same question: memo per
         (selection, records size, patch generation, isolation size) */
      const memo = scene.selCoverMemo;
      const hidN = Nasj.hiddenIds ? Nasj.hiddenIds.size : 0;
      if (memo && memo.sel === sel && memo.cap === cap && memo.recN === rec.size &&
          memo.gen === patchGen && memo.hidN === hidN) return memo.out;
      const keep = (out) => {
        scene.selCoverMemo = { sel, cap, recN: rec.size, gen: patchGen, hidN, out };
        return out;
      };
      const hidIds = Nasj.hiddenIds;
      let lmap = null;
      const exc = [];
      let miss = 0;
      for (const id of rec.keys()) {
        if (sel.has(id)) continue;
        if (++miss > cap * 8) return keep({ over: true });
        const ent = Nasj.docOps.entityById(doc, id);
        if (!ent) continue;
        if (hidIds && hidIds.has(id)) continue;
        if (!lmap) lmap = new Map(doc.layers.map((l) => [l.id, l]));
        const ly = lmap.get(ent.layerId);
        if (ly && !(ly.on && !ly.frozen)) continue;   /* invisible: no ink */
        exc.push(ent);
        if (exc.length > cap) return keep({ over: true });
      }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const grow = (it) => {
        if (it.bx0 === undefined || !isFinite(it.bx0) || !isFinite(it.bx1)) return;
        if (it.bx0 < x0) x0 = it.bx0;
        if (it.by0 < y0) y0 = it.by0;
        if (it.bx1 > x1) x1 = it.bx1;
        if (it.by1 > y1) y1 = it.by1;
      };
      for (const it of scene.stream) grow(it);
      for (const it of scene.delta) grow(it);
      if (!isFinite(x0)) return keep({ over: true });
      return keep({ box: { minx: x0, miny: y0, maxx: x1, maxy: y1 },
        exc, owned: rec.size - miss });
    },
    /* phase 4: GPU drag — build the ghost once, then a per-frame offset */
    dragBegin,
    /* a ghost is mid-flight (the engine's settle paths ask before easing) */
    dragActive: () => !!drag,
    dragTo(dx, dy) {
      return Nasj.glscene.dragXform([1, 0, 0, 1, Number(dx) || 0, Number(dy) || 0]);
    },
    /* the same per-frame move as ANY 2x3 affine. ROTATE, SCALE and MIRROR
       are transforms of the whole selection just as MOVE is, and a ghost
       that can carry one can carry all of them: their previews used to
       re-stroke every selected object on the CPU every frame (84ms and
       183ms at 5,000 selected, against MOVE's 17). */
    dragXform(m) {
      if (!drag || !live()) { freeDrag(); return false; }
      if (!Array.isArray(m) || m.length < 6) return false;
      for (let i = 0; i < 6; i++) if (!isFinite(m[i])) return false;
      drag.m = [m[0], m[1], m[2], m[3], m[4], m[5]];
      if (drag.job) dragPump(performance.now() + DRAG_SLICE_MS);
      if (!renderDrag()) return false;
      /* a ghost frame IS a gesture: the governor's synced re-benchmark
         must never land in the middle of a drag (it did — a 79ms frame
         among 20ms ones, caught by the 4ms gap watcher) */
      gov.lastT = performance.now();
      showDom();
      marqOwned = false;                 /* the ghost owns the canvas now */
      marqKey = '';
      return true;
    },
    dragEnd() {
      freeDrag();
      hideDom();
    },
    /* phase 4: the open front-load drives the build to completion at full
       speed, one bounded slice per call (the caller yields between calls so
       the progress bar keeps painting). Returns 'off' (path disabled, no
       doc, paper/3D), a 0..99 number while more remains, or 'done'. */
    buildWarm(budgetMs) {
      const doc = Nasj.doc;
      if (!doc || !enabled()) return 'off';
      if (Nasj.paper || (Nasj.view3d && Nasj.view3d.active)) return 'off';
      if (buildJob && buildJob.doc !== doc) {
        if (buildJob.raf) cancelAnimationFrame(buildJob.raf);
        buildJob = null;
      }
      if (scene && scene.doc !== doc) parkScene();
      if (!scene && !buildJob) bindScene(doc);
      if (scene && !buildJob) { if (dirty) ensureFresh(); return 'done'; }
      if (!buildJob || buildJob.doc !== doc) startBuild(doc);
      if (!buildJob) return scene ? 'done' : 'off';   /* small doc: built sync */
      const bs = buildJob.bs;
      /* ONE DRIVER AT A TIME. scheduleBuild's rAF pumps this same build,
         so a frame during the open ran that slice AND this one — two
         budgets' worth of work in a frame, and the frame rate halved. Say
         who is driving; the rAF stands by (and takes over again the moment
         this stops, so a caller that walks away never leaves a half-built
         scene). */
      bs.pumpT = performance.now();
      const deadline = performance.now() + Math.max(2, Number(budgetMs) || 40);
      let done = !!bs.walkDone;
      while (!done && performance.now() < deadline) done = buildStep(bs, deadline);
      if (!done) {
        return Math.min(99, Math.round(100 * (bs.i || 0) / Math.max(1, bs.ents.length)));
      }
      bs.walkDone = true;
      /* the finish is as long as the walk: it slices to the same budget */
      if (!finishBuild(bs, deadline)) return 99;
      if (buildJob.raf) cancelAnimationFrame(buildJob.raf);
      buildJob = null;
      emitDoc('glscene');
      return 'done';
    },
    /* whether a scene build is in flight — the 2D scene job stands aside
       for it during an open rather than share the frame (see engine.js) */
    building: () => !!buildJob,
    /* legacy/QA surface */
    active: enabled,
    build() {                            /* synchronous, for QA probes */
      const doc = Nasj.doc;
      if (!doc || !enabled()) return null;
      const st = buildNow(doc);
      emitDoc('glscene');
      return st;
    },
    render,
    stats: () => (scene ? scene.stats : null),
    rendererString,
    /* the PoC's follow(): still handy for standalone GL timing probes */
    follow() {
      if (hooked) return;
      hooked = Nasj.render;
      Nasj.render = () => { hooked(); render(); };
    },
    unfollow() {
      if (hooked) { Nasj.render = hooked; hooked = null; }
    },
    /* debug: one RGBA pixel at css coords (y from top), for alignment QA */
    readPix(x, y) {
      if (!gl) return null;
      const d = window.devicePixelRatio || 1;
      const px = new Uint8Array(4);
      gl.readPixels(Math.round(x * d), glCanvas.height - 1 - Math.round(y * d),
        1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [px[0], px[1], px[2], px[3]];
    },
    debugShow() {
      if (!glCanvas) return;
      debugOn = true;
      render();
      showDom();
    },
    debugHide() {
      if (!glCanvas) return;
      debugOn = false;
      hideDom();
      render();
    },
    /* does this drawing still have its scene, or did the budget take it?
       (app.js asks before a tab click, to know whether the switch is a
       swap or a rebuild that owes the progress affordance) */
    resident: (doc) => !!doc && (scenes.has(doc) || (!!scene && scene.doc === doc)),
    /* a closed drawing gives its buffers back at once, rather than waiting
       for the budget to notice a document nothing can reach any more */
    forget(doc) {
      const sc = scenes.get(doc);
      if (!sc) return false;
      if (sc === scene) freeScene();
      else freeSceneObj(sc, false);
      return true;
    },
    dispose() {
      this.unfollow();
      freeDrag();
      freeAllScenes();
      if (glCanvas) { glCanvas.remove(); glCanvas = null; }
      gl = null; extInst = null; extVao = null;
      progChunk = null; progInst = null; progQuad = null;
      palTex = null; remTex = null; quadVbo = null; uni = null; lwRange = null;
      remLast = null; remGen = -1;
      domShown = false;
    }
  };

  /* reflect the persisted mode into settings (Options-style code reads it),
     and take the probe off the first-frame path: it runs at idle, so by the
     time a drawing opens the verdict is already sitting in localStorage */
  if (Nasj.settings && Nasj.settings.glscene === undefined) {
    Nasj.settings.glscene = mode();
  }
  const idle = window.requestIdleCallback
    ? window.requestIdleCallback.bind(window) : ((f) => setTimeout(f, 250));
  idle(() => { if (mode() !== 'off') ensureVerdict(); });
})();
