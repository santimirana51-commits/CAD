/** Extracted from agent-panel.js:273 — Site/Plot/Selection geometry pipeline
 *  Pure geometry + canvas ops. No DOM panel logic. All functions depend on
 *  window.Nasj at call-time (kept compat), but are importable/testable.
 */

import {
  PLAN_LAYERS,
  MAX_SITES,
  SITE_LOOP_MAX,
  LAND_TYPES,
  EDIT_PX,
  SITE_MARGIN,
  PLOT_COVER,
  PLOT_COVER_ALONE,
  PLOT_SQUARE,
  EPS,
  RATIOS
} from '@shared/config/tunables.js';
import { clamp } from '@shared/utils/helpers.js';

const N = () => window.Nasj || {};

export const planLayerIds = (doc) =>
  new Set((doc.layers || []).filter((l) => PLAN_LAYERS.indexOf(String(l.name).toUpperCase()) >= 0).map((l) => l.id));

export const landCandidates = (doc, anyLayer) => {
  const skip = anyLayer ? new Set() : planLayerIds(doc);
  return (doc.entities || []).filter(
    (e) => e && LAND_TYPES[e.type] && typeof e.aisel !== 'number' && !e.aiplan && !e.aiGroup && !skip.has(e.layerId)
  );
};

let sitesCache = null;

export function listSites() {
  const doc = N().doc;
  if (!doc || !Array.isArray(doc.entities) || !N().geom) return [];
  const ents = doc.entities;
  const first = ents.length ? ents[0].id : null,
    last = ents.length ? ents[ents.length - 1].id : null;
  const gen = typeof N().docGen === 'function' ? N().docGen(doc) : null;
  if (
    sitesCache &&
    sitesCache.ents === ents &&
    sitesCache.n === ents.length &&
    sitesCache.first === first &&
    sitesCache.last === last &&
    sitesCache.gen === gen &&
    gen !== null
  )
    return sitesCache.list;
  const cand = landCandidates(doc);
  const Plan = window.NasjPlan;
  let out = [];
  let loops = null;
  if (Plan && typeof Plan.findLoops === 'function' && cand.length <= SITE_LOOP_MAX) {
    try {
      loops = Plan.findLoops(cand, null);
    } catch (_) {
      loops = null;
    }
  }
  if (loops) {
    out = loops.map((L) => ({
      ent: L.ids[0] || null,
      ids: L.ids,
      sides: L.sides,
      pts: L.pts.map((p) => ({ x: p.x, y: p.y })),
      bbox: L.bbox,
      area: L.area
    }));
  } else {
    for (const e of cand) {
      if (e.type !== 'polyline' || !e.closed) continue;
      if (!Array.isArray(e.pts) || e.pts.length < 3) continue;
      const b = N().geom.entityBounds(e);
      out.push({
        ent: e.id,
        ids: [e.id],
        sides: e.pts.length,
        pts: e.pts.map((p) => ({ x: p.x, y: p.y })),
        bbox: b,
        area: (b.maxx - b.minx) * (b.maxy - b.miny)
      });
    }
    out.sort((a, c) => c.area - a.area);
  }
  const list = out.slice(0, MAX_SITES).map((o, i) => Object.assign(o, { id: 'site-' + (i + 1) }));
  sitesCache = { ents, n: ents.length, first, last, gen, list };
  return list;
}

export const findSite = (id) => listSites().find((s2) => s2.id === String(id || ''));

export function sidesWord(site) {
  const n = site && site.sides ? site.sides : site && site.pts ? site.pts.length : 0;
  return n > 12 ? 'curved' : n + '-sided';
}

export function ptsBounds(pts) {
  let minx = Infinity,
    miny = Infinity,
    maxx = -Infinity,
    maxy = -Infinity;
  for (const p of pts) {
    if (p.x < minx) minx = p.x;
    if (p.y < miny) miny = p.y;
    if (p.x > maxx) maxx = p.x;
    if (p.y > maxy) maxy = p.y;
  }
  return { minx, miny, maxx, maxy };
}

export const nearestRatio = (w, h) => {
  if (!(w > 0) || !(h > 0)) return '1:1';
  const t = Math.log(w / h);
  let best = '1:1',
    bd = Infinity;
  for (const [name, r] of RATIOS) {
    const d = Math.abs(Math.log(r) - t);
    if (d < bd) {
      bd = d;
      best = name;
    }
  }
  return best;
};

export function buildSiteReference(pts, bbox) {
  if (!pts || pts.length < 3) return null;
  const w = bbox.maxx - bbox.minx,
    h = bbox.maxy - bbox.miny;
  if (!(w > 0) || !(h > 0)) return null;
  const cw = Math.round(w >= h ? EDIT_PX : (EDIT_PX * w) / h);
  const ch = Math.round(h > w ? EDIT_PX : (EDIT_PX * h) / w);
  const m = Math.round(Math.min(cw, ch) * SITE_MARGIN);
  const sc = Math.min((cw - 2 * m) / w, (ch - 2 * m) / h);
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, cw, ch);
  g.strokeStyle = '#000';
  g.lineWidth = Math.max(3, Math.round(Math.min(cw, ch) / 250));
  g.lineJoin = 'miter';
  g.beginPath();
  const X = (p2) => m + (p2.x - bbox.minx) * sc;
  const Y = (p2) => ch - m - (p2.y - bbox.miny) * sc;
  g.moveTo(X(pts[0]), Y(pts[0]));
  for (let i = 1; i < pts.length; i++) g.lineTo(X(pts[i]), Y(pts[i]));
  g.closePath();
  g.stroke();
  return { dataUrl: cv.toDataURL('image/png'), w: cw, h: ch };
}

export function largestLoopOf(entities, box) {
  const Plan = window.NasjPlan;
  if (!Plan || typeof Plan.findLoops !== 'function') return null;
  let loops = [];
  try {
    loops = Plan.findLoops(entities, box || null, { margin: 0.02 });
  } catch (_) {
    loops = [];
  }
  const L = loops[0];
  if (!L) return null;
  return {
    id: L.ids[0] || null,
    ids: L.ids,
    pts: L.pts.map((p) => ({ x: p.x, y: p.y })),
    bbox: L.bbox,
    sides: L.sides
  };
}

export function largestBoundaryIn(box) {
  const doc = N().doc;
  if (!doc || !Array.isArray(doc.entities) || !N().geom) return null;
  let cands = landCandidates(doc, false);
  let loop = largestLoopOf(cands, box);
  if (!loop) {
    cands = landCandidates(doc, true);
    loop = largestLoopOf(cands, box);
  }
  if (loop) {
    const boundsOf = (e) => {
      try {
        return N().geom.entityBounds(e);
      } catch (_) {
        return null;
      }
    };
    const inBox = (b) =>
      b &&
      b.minx >= box.minx - EPS &&
      b.maxx <= box.maxx + EPS &&
      b.miny >= box.miny - EPS &&
      b.maxy <= box.maxy + EPS;
    let othersArea = 0;
    for (const e of doc.entities || []) {
      if (!e || typeof e.aisel === 'number' || loop.ids.indexOf(e.id) >= 0) continue;
      const b = boundsOf(e);
      if (!inBox(b)) continue;
      othersArea += Math.max(0, b.maxx - b.minx) * Math.max(0, b.maxy - b.miny);
    }
    const landArea = Math.max(EPS, (loop.bbox.maxx - loop.bbox.minx) * (loop.bbox.maxy - loop.bbox.miny));
    loop.alone = othersArea <= 0.05 * landArea;
    return loop;
  }
  let best = null,
    bestArea = 0;
  for (const e of cands) {
    if (e.type !== 'polyline' || !e.closed) continue;
    if (!Array.isArray(e.pts) || e.pts.length < 3) continue;
    const b = N().geom.entityBounds(e);
    if (!(b.minx >= box.minx && b.maxx <= box.maxx && b.miny >= box.miny && b.maxy <= box.maxy)) continue;
    const a = (b.maxx - b.minx) * (b.maxy - b.miny);
    if (a > bestArea) {
      bestArea = a;
      best = { id: e.id, pts: e.pts.map((p) => ({ x: p.x, y: p.y })), bbox: b };
    }
  }
  return best;
}

export function plotFrame(pts, box, force, alone) {
  if (!Array.isArray(pts) || pts.length < 3 || !box) return null;
  const pb = ptsBounds(pts);
  const boxArea = Math.max(EPS, (box.maxx - box.minx) * (box.maxy - box.miny));
  const cover = ((pb.maxx - pb.minx) * (pb.maxy - pb.miny)) / boxArea;
  if (!force && cover < (alone ? PLOT_COVER_ALONE : PLOT_COVER)) return null;
  let theta = 0,
    best = -1;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b2 = pts[(i + 1) % pts.length];
    const dx = b2.x - a.x,
      dy = b2.y - a.y,
      len = Math.hypot(dx, dy);
    if (len > best) {
      best = len;
      theta = Math.atan2(dy, dx);
    }
  }
  theta = ((theta % Math.PI) + Math.PI) % Math.PI;
  if (theta > Math.PI / 2) theta -= Math.PI;
  const c = { x: (pb.minx + pb.maxx) / 2, y: (pb.miny + pb.maxy) / 2 };
  if (Math.abs(theta) < PLOT_SQUARE) return { theta: 0, c, pts, obb: pb, turned: false };
  const cs = Math.cos(-theta),
    sn = Math.sin(-theta);
  const u = pts.map((p) => ({
    x: c.x + (p.x - c.x) * cs - (p.y - c.y) * sn,
    y: c.y + (p.x - c.x) * sn + (p.y - c.y) * cs
  }));
  return { theta, c, pts: u, obb: ptsBounds(u), turned: true };
}

export const rectPts = (b) => [
  { x: b.minx, y: b.miny },
  { x: b.maxx, y: b.miny },
  { x: b.maxx, y: b.maxy },
  { x: b.minx, y: b.maxy }
];

export const rectFrame = (b) => plotFrame(rectPts(b), b, true);

export const unturn = (fr) => {
  const cs = Math.cos(fr.theta),
    sn = Math.sin(fr.theta);
  return (q) => ({
    x: fr.c.x + (q.x - fr.c.x) * cs - (q.y - fr.c.y) * sn,
    y: fr.c.y + (q.x - fr.c.x) * sn + (q.y - fr.c.y) * cs
  });
};

const METRES_PER_UNIT = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 7: 1000, 10: 0.9144, 14: 0.1, 15: 10, 16: 100, 21: 0.3048006 };

export const unitsPerMetre = () => {
  const u = N().units && typeof N().units.get === 'function' ? N().units.get() : null;
  const m = u && METRES_PER_UNIT[u.insunits];
  return m ? 1 / m : null;
};

export const planScale = (w, h) => {
  const big = Math.max(w, h);
  if (!(big > 0)) return unitsPerMetre() || 1;
  const declared = unitsPerMetre();
  const plausible = (s) => big / s >= 5 && big / s <= 400;
  if (declared && plausible(declared)) return declared;
  for (const s of [1, 100, 1000, 3.28084, 39.3701]) if (plausible(s)) return s;
  return declared || big / 30;
};

export const scaleGuessed = (w, h) => {
  const big = Math.max(w, h);
  const declared = unitsPerMetre();
  return !(big > 0) || !declared || !(big / declared >= 5 && big / declared <= 400);
};

const stated = {};

export function plotMetres(pts, bbox, force, key) {
  const fr = plotFrame(pts, bbox, force) || { theta: 0, c: { x: 0, y: 0 }, pts, obb: ptsBounds(pts), turned: false };
  const w = fr.obb.maxx - fr.obb.minx,
    h = fr.obb.maxy - fr.obb.miny;
  const sw = key != null && stated[key] > 1 ? stated[key] : 0;
  const scale = sw && w > 0 ? w / sw : planScale(w, h);
  return {
    fr,
    scale,
    W: w / scale,
    H: h / scale,
    guessed: !sw && scaleGuessed(w, h),
    stated: !!sw,
    corners: fr.pts.map((p) => ({ x: (p.x - fr.obb.minx) / scale, y: (p.y - fr.obb.miny) / scale }))
  };
}

export const metresLabel = (pm) => {
  const f = (v) => String(Math.round(v * 10) / 10);
  return pm ? f(pm.W) + ' \u00d7 ' + f(pm.H) + ' m' : '';
};

export const metresNote = (pm) => {
  const f = (v) => String(Math.round(v * 10) / 10);
  return (
    'In its own frame (long edge horizontal, x right, y up, origin bottom-left) it measures ' +
    f(pm.W) +
    ' m by ' +
    f(pm.H) +
    ' m, corners at ' +
    pm.corners.map((p) => '(' + f(p.x) + ', ' + f(p.y) + ')').join(' ') +
    ' in metres - a draw_plan layout for it uses these metres.' +
    ' Follow this polygon with fit:boundary. Do not substitute a contained rectangle or assume setbacks. Use setbacks only if the architect specified them. Read the actual slanted corners when placing edge rooms; check remaining room areas and circulation.' +
    (pm.stated
      ? ' (as stated by the architect)'
      : pm.guessed
        ? ' (size is a GUESS: the drawing has no usable units; if the architect states the real width, pass siteWidth.)'
        : '')
  );
};

export function sitesNote(sites) {
  if (!sites.length) return '';
  const lines = sites.map((s2) => {
    const w = s2.bbox.maxx - s2.bbox.minx,
      h = s2.bbox.maxy - s2.bbox.miny;
    const pc = (v) => Math.round(clamp(v, 0, 1) * 100);
    const corners = s2.pts
      .map((p) => '(' + pc((p.x - s2.bbox.minx) / (w || 1)) + '%,' + pc((s2.bbox.maxy - p.y) / (h || 1)) + '%)')
      .join(' ');
    return (
      '  ' +
      s2.id +
      ': a closed ' +
      sidesWord(s2) +
      ' boundary, ' +
      'corners across its own extent from the top-left ' +
      corners +
      ', ' +
      (w >= h ? Math.round((w / (h || 1)) * 100) / 100 + ' times as wide as deep' : Math.round((h / (w || 1)) * 100) / 100 + ' times as deep as wide') +
      '. ' +
      metresNote(plotMetres(s2.pts, s2.bbox, true, s2.ent))
    );
  });
  return (
    '\n\n(Boundaries already drawn, available to attach:\n' +
    lines.join('\n') +
    '\nTo draw inside one, pass its id as `site`. ' +
    'Attaching it hands over the outline exactly as drawn, so do not ' +
    'describe the land, its shape or its proportions; name its size once, from the result.)'
  );
}

export function siteNote(pts, frameBox, key) {
  let box = frameBox;
  if (pts && pts.length >= 3) {
    box = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
    for (const q of pts) {
      if (q.x < box.minx) box.minx = q.x;
      if (q.y < box.miny) box.miny = q.y;
      if (q.x > box.maxx) box.maxx = q.x;
      if (q.y > box.maxy) box.maxy = q.y;
    }
  }
  const w = box.maxx - box.minx,
    h = box.maxy - box.miny;
  const pc = (v) => Math.round(clamp(v, 0, 1) * 100);
  const corners = (pts && pts.length >= 3 ? pts : [])
    .map((p) => '(' + pc((p.x - box.minx) / (w || 1)) + '%,' + pc((box.maxy - p.y) / (h || 1)) + '%)')
    .join(' ');
  return (
    '\n\n(From the drawing. The site boundary is ALREADY DRAWN and is ' +
    'handed to the drawing step exactly as drawn, so it will be followed ' +
    'exactly — you do not need to describe it, restate its shape or ask for ' +
    'it to be drawn.' +
    (corners
      ? ' Its corners, measured across its own extent from the ' +
        'top-left, are ' +
        corners +
        ', and it is ' +
        (w >= h ? Math.round((w / (h || 1)) * 10) / 10 + ' times as wide as it is deep' : Math.round((h / (w || 1)) * 10) / 10 + ' times as deep as it is wide') +
        '. Use that only to decide how the building sits inside it — its ' +
        'massing should follow the plot, not a shape of your own.'
      : '') +
    ' Describe only what goes inside it.' +
    (pts && pts.length >= 3 ? ' ' + metresNote(plotMetres(pts, box, true, key)) : '') +
    ')'
  );
}

export function placeIn(srcBox, dstBox) {
  const sx = dstBox.w / srcBox.w,
    sy = dstBox.h / srcBox.h;
  const sc = Math.min(sx, sy);
  return { scale: sc, dx: dstBox.x - srcBox.x * sc, dy: dstBox.y - srcBox.y * sc };
}

export function clearSitesCache() {
  sitesCache = null;
}
export function _stated() {
  return stated;
}
