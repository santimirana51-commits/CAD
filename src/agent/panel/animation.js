/** src/agent/panel/animation.js — REAL ESM migrated from agent-panel.js:2584-3093 */
import { st } from './state.js';
import { INK, PEN, ANIM_MIN, ANIM_MAX, ANIM_PER_PT, ANIM_BASE, FRAME_MS, VIEW_FIT, EPS } from '../../shared/config/tunables.js';
import { now, clamp } from '../../shared/utils/helpers.js';
const N = () => window.Nasj || {};

// --- BEGIN MIGRATED SLICE ---
  /* ================================================================== *
   * Brush animation — replays the strokes in order on #overlay-canvas.
   * Everything is redrawn from the model on every Nasj.renderOverlay(),
   * so a pan, a zoom or a window resize mid-draw stays correct.
   * ================================================================== */
  const prefixPts = (seg, local) => {
    const out = [seg.pts[0]];
    for (let i = 1; i < seg.pts.length; i++) {
      const c = seg.cum[i];
      if (c <= local) { out.push(seg.pts[i]); continue; }
      const p0 = seg.pts[i - 1], c0 = seg.cum[i - 1], d = c - c0;
      const t = d > EPS ? (local - c0) / d : 0;
      out.push({ x: p0.x + (seg.pts[i].x - p0.x) * t, y: p0.y + (seg.pts[i].y - p0.y) * t });
      break;
    }
    return out;
  };

  /* ================================================================== *
   * THE CNC HEAD. A dot sliding along a line reads as a screensaver; a
   * MACHINE reads as an event. Everything here is theatre on the overlay
   * — gantry rails riding the head, a white-hot tip with a cooling tail,
   * rapid hops between cuts, a spool-up while the model works, and a
   * handover when the job lands — and none of it touches the geometry:
   * the strokes harvested at the end are exactly the pen's.
   * ================================================================== */
  const TAIL_PX = 140;              /* the hot, still-cooling ink, screen px */

  /* points of a segment between two arc lengths (local to the segment) */
  const rangePts = (seg, lo, hi) => {
    const out = [];
    const at = (i, t) => {
      const p0 = seg.pts[i - 1], p1 = seg.pts[i];
      return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
    };
    for (let i = 1; i < seg.pts.length; i++) {
      const c0 = seg.cum[i - 1], c1 = seg.cum[i];
      if (c1 <= lo) continue;
      if (c0 >= hi) break;
      const d = c1 - c0;
      if (!out.length) {
        out.push(c0 >= lo ? seg.pts[i - 1] : at(i, d > EPS ? (lo - c0) / d : 0));
      }
      out.push(c1 <= hi ? seg.pts[i] : at(i, d > EPS ? (hi - c0) / d : 1));
      if (c1 > hi) break;
    }
    return out;
  };

  const tracePath = (ctx, vp, pts) => {
    const s0 = vp.worldToScreen(pts[0]);
    ctx.beginPath();
    ctx.moveTo(s0.x, s0.y);
    for (let i = 1; i < pts.length; i++) {
      const p = vp.worldToScreen(pts[i]);
      ctx.lineTo(p.x, p.y);
    }
  };

  /* the machining envelope: crawling dashed frame + corner brackets */
  const drawEnvelope = (ctx, vp, box, tMs, alphaMul) => {
    if (!box) return;
    const k = alphaMul == null ? 1 : alphaMul;
    if (k <= 0) return;
    const p1 = vp.worldToScreen({ x: box.minx, y: box.maxy });
    const p2 = vp.worldToScreen({ x: box.maxx, y: box.miny });
    const x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y);
    const w = Math.abs(p2.x - p1.x), h = Math.abs(p2.y - p1.y);
    ctx.strokeStyle = 'rgba(143,214,255,' + (0.28 * k) + ')';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 7]);
    ctx.lineDashOffset = -(tMs / 40) % 12;               /* the frame CRAWLS */
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    const L = Math.min(18, w / 4, h / 4);
    ctx.strokeStyle = 'rgba(143,214,255,' + (0.85 * k) + ')';
    ctx.lineWidth = 2;
    for (const [cx2, cy2, dx, dy] of [
      [x, y, 1, 1], [x + w, y, -1, 1], [x + w, y + h, -1, -1], [x, y + h, 1, -1]
    ]) {
      ctx.beginPath();
      ctx.moveTo(cx2 + dx * L, cy2);
      ctx.lineTo(cx2, cy2);
      ctx.lineTo(cx2, cy2 + dy * L);
      ctx.stroke();
    }
  };

  /* gantry rails + tool ring + white-hot core */
  const drawHead = (ctx, sp, tMs, idle) => {
    const ov = ctx.canvas;
    const W = ov.width, H = ov.height;
    const pulse = idle
      ? 0.55 + 0.15 * Math.sin(tMs / 420)                /* parked: breathing */
      : 0.75 + 0.25 * Math.sin(tMs / 120);               /* cutting: alive    */

    ctx.strokeStyle = 'rgba(143,214,255,.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, sp.y); ctx.lineTo(W, sp.y);
    ctx.moveTo(sp.x, 0); ctx.lineTo(sp.x, H);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(143,214,255,.75)';
    ctx.lineWidth = 2.4;
    for (const [tx, ty, o] of [[sp.x, 10, 'v'], [sp.x, H - 10, 'v'],
      [10, sp.y, 'h'], [W - 10, sp.y, 'h']]) {
      ctx.beginPath();
      if (o === 'v') { ctx.moveTo(tx - 6, ty); ctx.lineTo(tx + 6, ty); }
      else { ctx.moveTo(tx, ty - 6); ctx.lineTo(tx, ty + 6); }
      ctx.stroke();
    }

    const grad = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 16 * pulse);
    grad.addColorStop(0, 'rgba(255,255,255,.85)');
    grad.addColorStop(0.25, 'rgba(143,214,255,.45)');
    grad.addColorStop(1, 'rgba(143,214,255,0)');
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 16 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 7.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(220,242,255,.9)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  };

  /* the DRO: two lines of machine-shop type in a chip beside the head */
  const drawDRO = (ctx, sp, line1, line2, alphaMul) => {
    const ov = ctx.canvas;
    const W = ov.width;
    const k = alphaMul == null ? 1 : alphaMul;
    if (k <= 0) return;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.font = '11px ui-monospace, Consolas, monospace';
    const tw = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width);
    let bx = sp.x + 16, by = sp.y - 44;
    if (bx + tw + 14 > W) bx = sp.x - tw - 30;
    if (by < 8) by = sp.y + 18;
    ctx.fillStyle = 'rgba(10,16,22,.82)';
    ctx.strokeStyle = 'rgba(143,214,255,.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, tw + 14, 34, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PEN;
    ctx.fillText(line1, bx + 7, by + 14);
    ctx.fillStyle = 'rgba(143,214,255,.65)';
    ctx.fillText(line2, bx + 7, by + 28);
    ctx.restore();
  };

  const fmtXY = (p) => {
    const fx = (v) => (v >= 0 ? ' ' : '') + v.toFixed(1);
    return 'X' + fx(p.x) + '  Y' + fx(p.y);
  };

  const drawInk = (ctx) => {
    const a = st.anim;
    if (!a || !ctx) return;
    const vp = N.viewport;
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    drawEnvelope(ctx, vp,
      (st.placement && st.placement.out) || parkBoxWorld(), a.elapsed, 1);

    /* ---- settled ink ---- */
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = INK;
    for (const seg of a.segs) {
      if (a.tPos <= seg.tOff) break;
      const ink = inkIn(a, seg);
      if (ink > EPS) {
        const pts = prefixPts(seg, ink);
        if (pts.length >= 2) {
          tracePath(ctx, vp, pts);
          ctx.stroke();
        }
      }
    }

    /* ---- where is the head, and is it cutting or rapiding? ---- */
    let pen = null, mode = 'FEED', rapidFrom = null, active = null;
    for (const seg of a.segs) {
      if (a.tPos < seg.tOff) break;
      active = seg;
      if (a.tPos >= seg.tOff + seg.rapidEff + seg.len) continue;   /* passed */
    }
    if (active) {
      const local = a.tPos - active.tOff;
      if (local < active.rapidEff - EPS && active.rapidDist > EPS) {
        mode = 'RAPID';
        rapidFrom = active.rapidFrom;
        const t = active.rapidEff > EPS ? local / active.rapidEff : 1;
        pen = {
          x: rapidFrom.x + (active.pts[0].x - rapidFrom.x) * t,
          y: rapidFrom.y + (active.pts[0].y - rapidFrom.y) * t
        };
      } else {
        const pts = prefixPts(active, inkIn(a, active));
        pen = pts.length ? pts[pts.length - 1] : active.pts[0];
      }
    }

    /* ---- the hot tail: the last stretch of INK is still cooling ---- */
    if (pen && active) {
      const o = vp.worldToScreen({ x: 0, y: 0 });
      const u = vp.worldToScreen({ x: 1, y: 0 });
      const scale = Math.max(1e-9, Math.hypot(u.x - o.x, u.y - o.y));
      const gInk = active.inkOff + inkIn(a, active);
      const lo = Math.max(0, gInk - TAIL_PX / scale);
      ctx.shadowColor = PEN;
      ctx.shadowBlur = 7;
      ctx.strokeStyle = 'rgba(220,242,255,.95)';
      ctx.lineWidth = 1.8;
      for (const seg of a.segs) {
        if (seg.inkOff + seg.len <= lo) continue;
        if (seg.inkOff >= gInk) break;
        const pts = rangePts(seg, Math.max(0, lo - seg.inkOff),
          Math.min(inkIn(a, seg), seg.len));
        if (pts.length >= 2) {
          tracePath(ctx, vp, pts);
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
    }

    /* ---- the rapid: a fading dashed hop, no ink ---- */
    if (pen && mode === 'RAPID' && rapidFrom) {
      const sF = vp.worldToScreen(rapidFrom);
      const sP = vp.worldToScreen(pen);
      ctx.strokeStyle = 'rgba(143,214,255,.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(sF.x, sF.y);
      ctx.lineTo(sP.x, sP.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (pen) {
      const sp = vp.worldToScreen(pen);
      drawHead(ctx, sp, a.elapsed, false);
      const pct = a.inkTotal > EPS
        ? Math.min(100, Math.round(100 *
            ((active ? active.inkOff + inkIn(a, active) : 0) / a.inkTotal)))
        : 0;
      drawDRO(ctx, sp, fmtXY(pen),
        mode === 'RAPID' ? 'RAPID' : 'FEED ' + pct + '%', 1);
    }
    ctx.restore();
  };

  /* SPOOLING — the head is on station while the model still works. The
     30-50s image wait was a dead screen; now it is a machine warming up:
     envelope up, head parked and breathing, the DRO counting real progress
     from the pipeline's own events. */
  const drawWarmup = (ctx) => {
    const wu = st.warmup;
    if (!wu || !ctx) return;
    const vp = N.viewport;
    const t = now() - wu.startedAt;
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    drawEnvelope(ctx, vp, parkBoxWorld(), t, 0.8);
    const sp = vp.worldToScreen(parkWorld());
    drawHead(ctx, sp, t, true);
    drawDRO(ctx, sp,
      'SPOOLING ' + Math.min(99, Math.round(wu.pct || 0)) + '%',
      (t / 1000).toFixed(1) + 's', 1);
    ctx.restore();
  };

  /* THE HANDOVER — flash the fresh work once, rapid the head home, breathe
     the envelope out, and let the DRO sign off with the job numbers. */
  const drawOutro = (ctx) => {
    const o = st.outro;
    if (!o || !ctx) return;
    const vp = N.viewport;
    const t = now() - o.startedAt;
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const envA = t < 600 ? 0.7 + 0.3 * Math.sin(t / 80) : Math.max(0, 1 - (t - 600) / 700);
    drawEnvelope(ctx, vp, o.box, t, envA);

    const flash = Math.max(0, 1 - t / 450);
    if (flash > 0) {
      ctx.shadowColor = PEN;
      ctx.shadowBlur = 9 * flash;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.8 * flash) + ')';
      ctx.lineWidth = 2;
      for (const pts of o.strokes) {
        if (pts.length < 2) continue;
        tracePath(ctx, vp, pts);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    const k = Math.min(1, t / 500);
    const e = k * k * (3 - 2 * k);                        /* smoothstep home */
    const pos = {
      x: o.pen.x + (o.park.x - o.pen.x) * e,
      y: o.pen.y + (o.park.y - o.pen.y) * e
    };
    const sp = vp.worldToScreen(pos);
    if (k < 1) {
      const sF = vp.worldToScreen(o.pen);
      ctx.strokeStyle = 'rgba(143,214,255,' + (0.5 * (1 - k)) + ')';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(sF.x, sF.y);
      ctx.lineTo(sp.x, sp.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawHead(ctx, sp, t, k >= 1);
    drawDRO(ctx, sp, 'DONE · ' + o.stats.n + ' strokes', o.stats.secs + 's',
      t < 1100 ? 1 : Math.max(0, 1 - (t - 1100) / 400));
    ctx.restore();
  };

  /* chain onto the engine's overlay pass (pan / zoom / resize all call it) */
  (() => {
    const prevRO = N.renderOverlay;
    if (typeof prevRO !== 'function') return;
    N.renderOverlay = function () {
      prevRO.apply(this, arguments);
      if (!st.anim && !st.warmup && !st.outro) return;
      const ov = document.getElementById('overlay-canvas');
      if (!ov) return;
      const ctx = ov.getContext('2d');
      if (st.anim) drawInk(ctx);
      else if (st.warmup) drawWarmup(ctx);
      else if (st.outro) drawOutro(ctx);
    };
  })();

  const repaint = () => { if (typeof N.renderOverlay === 'function') N.renderOverlay(); };

  /* RAPID vs FEED — the native grammar of a machine. Between two cuts a
     real head does not teleport and does not crawl: it RAPIDS, faster and
     inkless, and everyone who has run one recognises it instantly. So the
     pen's clock runs on a TIMELINE that alternates rapid hops (the gap to
     the next stroke, covered at RAPID_MULT speed, drawing nothing) with
     feed moves (the stroke itself, laying ink). Harvest reads ink lengths
     only — the geometry that lands in the document is untouched. */
  const RAPID_MULT = 3.5;

  const inkIn = (a, seg) =>
    clamp(a.tPos - seg.tOff - seg.rapidEff, 0, seg.len);

  const harvest = (a) => {
    const out = [];
    for (const seg of a.segs) {
      if (a.tPos <= seg.tOff) break;
      const pts = prefixPts(seg, inkIn(a, seg));
      if (pts.length >= 2) out.push(pts);
    }
    return out;
  };

  /* where the head parks before the first stroke and after the last */
  const parkBoxWorld = () => {
    if (st.region && st.region.bbox) return st.region.bbox;
    if (st.attachment && st.attachment.bbox) return st.attachment.bbox;
    return inset(viewRect(), VIEW_FIT);
  };
  const parkWorld = () => {
    const b = parkBoxWorld();
    return { x: b.minx, y: b.maxy };
  };

  /* The pen is a CONTINUOUS CONSUMER of a stroke queue, not a one-shot replay
     of a finished list: push() appends material at any time, close() says no
     more is coming, and the run ends when the queue is closed AND drained. */
  const DT_MAX = 100;               /* a throttled tab must not teleport the pen */

  const startAnim = () => {
    let settle = null;
    st.warmup = null;               /* the spool-up hands over to the pen  */
    st.outro = null;                /* a new run clears any old handover   */
    const a = {
      segs: [], tTotal: 0, inkTotal: 0, tPos: 0, points: 0, speed: 0,
      ms: clamp(ANIM_BASE, ANIM_MIN, ANIM_MAX),
      elapsed: 0, raf: 0, closed: false, running: true,
      lastEnd: null,
      startedAt: now(), lastT: now()
    };
    a.promise = new Promise((resolve) => { settle = resolve; });
    st.anim = a;

    const finish = (how) => {
      if (!a.running) return;
      a.running = false;
      if (a.raf) cancelAnimationFrame(a.raf);
      const out = how === 'failed' ? [] : harvest(a);
      const elapsed = now() - a.startedAt;
      /* THE HANDOVER. A drawing that pops into existence reads as a screen
         change; a machine DELIVERS: the fresh work flashes once, the head
         rapids home, the envelope takes a last breath, and the DRO signs
         off with the job numbers. Only a finished job gets the ceremony —
         a stop or a failure clears the stage at once. */
      let pen = null;
      for (const seg of a.segs) {
        if (a.tPos <= seg.tOff) break;
        const pts = prefixPts(seg, inkIn(a, seg));
        if (pts.length) pen = pts[pts.length - 1];
      }
      st.anim = null;
      if (how === 'done' && out.length && pen) {
        st.outro = {
          strokes: out, pen, park: parkWorld(),
          box: (st.placement && st.placement.out) || parkBoxWorld(),
          stats: { n: out.length, secs: Math.round(elapsed / 100) / 10 },
          startedAt: now()
        };
        startFx();
      }
      repaint();
      settle({ strokes: out, stopped: how === 'stopped', failed: how === 'failed', ms: elapsed });
    };

    a.push = (worldStrokes) => {
      if (!a.running) return 0;
      let added = 0;
      for (const pts of worldStrokes) {
        if (!pts || pts.length < 2) continue;
        const cum = [0];
        for (let i = 1; i < pts.length; i++) {
          cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
        }
        const from = a.lastEnd || parkWorld();
        const rapidDist = Math.hypot(pts[0].x - from.x, pts[0].y - from.y);
        const rapidEff = rapidDist / RAPID_MULT;
        const seg = {
          pts, cum, len: cum[cum.length - 1],
          rapidFrom: from, rapidDist, rapidEff,
          tOff: a.tTotal, inkOff: a.inkTotal
        };
        a.tTotal += seg.rapidEff + seg.len;
        a.inkTotal += seg.len;
        a.points += pts.length;
        a.lastEnd = pts[pts.length - 1];
        a.segs.push(seg);
        added++;
      }
      if (!added) return 0;
      a.ms = clamp(ANIM_BASE + a.points * ANIM_PER_PT, ANIM_MIN, ANIM_MAX);
      a.speed = Math.max(a.speed, a.tTotal / a.ms);
      return added;
    };
    a.close = () => { a.closed = true; };
    a.stop = () => finish('stopped');
    a.fail = () => finish('failed');

    const step = () => {
      if (!a.running) return;
      const t = now();
      const dt = Math.min(Math.max(0, t - a.lastT), DT_MAX);
      a.lastT = t;
      a.elapsed = t - a.startedAt;
      a.tPos = Math.min(a.tTotal, a.tPos + a.speed * dt);
      repaint();
      if (a.closed && a.tPos >= a.tTotal - EPS) {
        if (a.tTotal <= EPS) a.tPos = Infinity;   /* degenerate: keep it all */
        finish('done');
        return;
      }
      a.raf = requestAnimationFrame(step);
    };
    a.raf = requestAnimationFrame(step);
    return a;
  };

  /* one light loop for the states that have no pen driving repaints */
  let fxRaf = 0;
  const startFx = () => {
    if (fxRaf) return;
    const tick = () => {
      fxRaf = 0;
      if (st.outro && now() - st.outro.startedAt > 1500) {
        st.outro = null;
        repaint();
        return;
      }
      if (!st.warmup && !st.outro) return;
      if (st.anim) return;          /* the pen's own loop repaints */
      repaint();
      fxRaf = requestAnimationFrame(tick);
    };
    fxRaf = requestAnimationFrame(tick);
  };

// --- END MIGRATED SLICE ---

export const migrated = true;
export default {};
