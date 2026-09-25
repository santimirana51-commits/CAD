/** Extracted from agent-panel.js:718 — AI selections as CAD objects + window references */

import { SEL_LAYER, SEL_COLOR, EDIT_PX } from '@shared/config/tunables.js';
import { nearestRatio } from './site.js';

const N = () => window.Nasj || {};

export const selEntities = () => (N().doc && N().doc.entities || []).filter((e) => typeof e.aisel === 'number');

export const selById = (name) => {
  const m = /^sel-(\d+)$/.exec(String(name || ''));
  if (!m) return null;
  return selEntities().find((e) => e.aisel === Number(m[1])) || null;
};

export const selBounds = (ent) => {
  const pts = (ent.boundary && ent.boundary.pts) || [];
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
  return isFinite(minx) ? { minx, miny, maxx, maxy } : null;
};

export function createSelection(bbox) {
  const doc = N().doc,
    ops = N().docOps;
  if (!doc || !ops) return null;
  ops.pushUndo(doc);
  let ly = (doc.layers || []).find((l) => String(l.name).toUpperCase() === SEL_LAYER);
  if (!ly) {
    ly = ops.addLayer(doc, SEL_LAYER);
    ly.color = SEL_COLOR;
  }
  const n = selEntities().reduce((k, e) => Math.max(k, e.aisel), 0) + 1;
  const ent = ops.addEntity(doc, {
    type: 'hatch',
    pattern: 'SOLID',
    angle: 0,
    scale: 1,
    layerId: ly.id,
    boundary: {
      kind: 'pline',
      closed: true,
      pts: [
        { x: bbox.minx, y: bbox.miny },
        { x: bbox.maxx, y: bbox.miny },
        { x: bbox.maxx, y: bbox.maxy },
        { x: bbox.minx, y: bbox.maxy }
      ]
    }
  });
  ent.aisel = n;
  const i = doc.entities.indexOf(ent);
  if (i > 0) {
    doc.entities.splice(i, 1);
    doc.entities.unshift(ent);
  }
  doc.modified = true;
  if (typeof N().render === 'function') N().render();
  return ent;
}

export function withSelectionsHidden(fn) {
  const doc = N().doc;
  const hidden = [];
  for (let i = doc.entities.length - 1; i >= 0; i--) {
    if (typeof doc.entities[i].aisel === 'number') {
      hidden.push({ e: doc.entities[i], i });
      doc.entities.splice(i, 1);
    }
  }
  try {
    return fn();
  } finally {
    for (let k = hidden.length - 1; k >= 0; k--) {
      doc.entities.splice(hidden[k].i, 0, hidden[k].e);
    }
  }
}

export function buildWindowReferenceRaw(box, ow, oh, color = false) {
  const LONG = 200,
    shortSide = (LONG * Math.min(ow, oh)) / Math.max(ow, oh);
  const cv = N().plotRender({
    area: 'window',
    win: { a: { x: box.minx, y: box.miny }, b: { x: box.maxx, y: box.maxy } },
    paperMm: { w: Math.min(LONG, shortSide), h: Math.max(LONG, shortSide) },
    landscape: ow >= oh,
    marginMm: 0,
    fitToPaper: true,
    centerPlot: true,
    dpi: Math.round((EDIT_PX * 25.4) / LONG),
    styleTable: color ? 'none' : 'monochrome',
    useLineweights: false,
    plotStamp: false
  });
  if (!cv || !cv.width || !cv.height) return null;
  if (color) return { cv, w: cv.width, h: cv.height };
  const g = cv.getContext('2d');
  const img = g.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 77 + d[i + 1] * 151 + d[i + 2] * 28) >> 8;
    const v = lum < 220 && d[i + 3] > 40 ? 0 : 255;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { cv, w: cv.width, h: cv.height };
}

export function buildWindowReference(box, color = false) {
  if (typeof N().plotRender !== 'function') return null;
  const ow = box.maxx - box.minx,
    oh = box.maxy - box.miny;
  if (!(ow > 0) || !(oh > 0)) return null;
  return withSelectionsHidden(() => {
    const raw = buildWindowReferenceRaw(box, ow, oh, color);
    if (!raw) return null;
    return {
      dataUrl: raw.cv.toDataURL('image/png'),
      w: raw.w,
      h: raw.h,
      ratioHint: nearestRatio(raw.w, raw.h)
    };
  });
}

export function selsNote() {
  // dynamic import to avoid circular deps — site.js needs selEntities too
  const list = selEntities();
  if (!list.length) return '';
  // lazy import plotMetres to keep this module light
  const { plotMetres, largestBoundaryIn, rectPts } = globalThis.__nasjSite || {};
  // fallback: require at call-time if global not set (compat)
  const _plotMetres = plotMetres || (() => null);
  const _largest = largestBoundaryIn || (() => null);
  const _rectPts = rectPts || ((b) => [{ x: b.minx, y: b.miny }, { x: b.maxx, y: b.miny }, { x: b.maxx, y: b.maxy }, { x: b.minx, y: b.maxy }]);
  const metresNoteFn = globalThis.__nasjMetresNote || (() => '');
  const sidesWordFn = globalThis.__nasjSidesWord || (() => '');
  const lines = list.map((e) => {
    const b = selBounds(e);
    const site = b && _largest(b);
    const pm = b ? _plotMetres(site ? site.pts : _rectPts(b), b, true, site ? site.ids[0] : e.id) : null;
    return (
      '  sel-' +
      e.aisel +
      ': a working area the architect marked' +
      (b
        ? ', ' +
          (b.maxx - b.minx >= b.maxy - b.miny
            ? Math.round(((b.maxx - b.minx) / Math.max(1e-9, b.maxy - b.miny)) * 100) / 100 + ' times as wide as deep'
            : Math.round(((b.maxy - b.miny) / Math.max(1e-9, b.maxx - b.minx)) * 100) / 100 + ' times as deep as wide')
        : '') +
      '.' +
      (site ? ' It holds a land outline, a closed ' + sidesWordFn(site) + ' boundary. ' + metresNoteFn(pm) : pm ? ' It holds no drawn outline: for a plan of rooms the marked rectangle itself is the land. ' + metresNoteFn(pm) : '')
    );
  });
  return '\n\n(Working areas the architect has marked on the drawing:\n' + lines.join('\n') + '\nWhen the architect names one, pass its id as `site` - the drawing step reads the area itself; you cannot see it.)';
}
