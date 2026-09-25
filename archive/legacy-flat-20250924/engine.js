/* Nasjicad — engine.js
 * Viewport, rendering, pointer/osnap pipeline (SPEC §8). Owner: ENGINE.
 * Plain script, attaches to window.Nasj. DOM is touched only from engineInit()
 * and the render functions (called after boot).
 */
(() => {
  'use strict';
  const Nasj = window.Nasj = window.Nasj || {};

  const TAU = Math.PI * 2;

  /* Colors are the exact values from SPEC §2/§8 (tokens.css mirrors them). */
  const COL = {
    bg: '#212830',
    gridMinor: '#2a323c',
    gridMajor: '#333d49',
    axisX: 'rgba(224,90,90,.5)',
    axisY: 'rgba(100,200,100,.5)',
    accentBright: '#4fb3ea',
    accentSoft: 'rgba(33,150,217,.35)',
    preview: '#9fb3c8',
    snap: '#3fbf3f',
    grip: '#2b7de9',
    gripHot: '#e05252',
    selWindow: 'rgba(0,120,215,.16)',
    selWindowBorder: '#3b8fd4',
    selCrossing: 'rgba(70,200,90,.16)',
    selCrossingBorder: '#4fc06a',
    crosshair: 'rgba(255,255,255,.85)',
    crosshairPaper: 'rgba(0,0,0,.85)',   /* on a layout's white sheet */
    qmeasure: '#e0a63c',         /* MEASUREGEOM Quick: the live readout */
    areaAdd: 'rgba(38,150,62,.55)',   /* AREA: the ring being counted in */
    areaSub: 'rgba(190,52,52,.55)',   /* AREA: the ring coming back off */
    /* Drawing Window Colors edits these by name, so each one is a real
       stroke the drawing area makes rather than a literal buried in a
       draw call: the tracking vector, the dynamic dimension lines, and
       the hull a spline's control points make */
    track: 'rgba(96,196,116,.85)',
    dynDim: 'rgba(190,190,190,.75)',
    ctrlHull: 'rgba(120,160,220,.8)'
  };

  /* engine-private state */
  let canvas = null, overlay = null, ctx = null, octx = null, container = null;
  /* the modify drag's faint originals, drawn once into a layer of their own */
  let dimLayer = null;
  let hovLayer = null;           /* hover highlight, cached like ghostDim */
  let cssW = 0, cssH = 0, dpr = 1;
  let pointerInside = false;
  /* what the last pointer event came from. A finger gets no crosshair (it
     would sit under the finger), a wider snap aperture and a wider pick
     box; js/touch.js replays a finger's events with pointerType 'touch'.
     Nasj.coarse is touch.js's reading of the (pointer: coarse) media
     query — a phone is touch before its first finger lands. */
  let lastPointerType = 'mouse';
  const touchInput = () => lastPointerType === 'touch' || !!Nasj.coarse;
  Nasj.touchInput = touchInput;
  const pan = { active: false, pointerId: null, lastX: 0, lastY: 0 };

  /* ---------------- settings / ui / events ---------------- */
  /* CONSTRAINTSETTINGS — how constraints would be inferred, shown and named.
     A factory, not a literal, because the dialog's Reset button restores these
     exact values and there must be only one statement of what they are. */
  const defaultConstraints = () => ({
    infer: false,                 /* CONSTRAINTINFER */
    /* which constraint types show on a constraint bar */
    bars: {
      perp: true, para: true, horz: true, vert: true, tan: true, smooth: true,
      coll: true, conc: true, sym: true, eq: true, coin: true, fix: true,
    },
    planeOnly: false,
    barTrans: 50,                 /* constraint bar transparency, % */
    barsAfterApply: true,
    barsOnSelect: true,
    nameFormat: 2,                /* CONSTRAINTNAMEFORMAT: 0 name, 1 value, 2 name and expression */
    lockIcon: true,
    showHidden: true,
    /* AutoConstrain: the order IS the priority, and `on` is the Apply column */
    auto: [
      { type: 'Coincident', on: true }, { type: 'Collinear', on: true },
      { type: 'Parallel', on: true }, { type: 'Perpendicular', on: true },
      { type: 'Tangent', on: true }, { type: 'Concentric', on: true },
      { type: 'Horizontal', on: true }, { type: 'Vertical', on: true },
      { type: 'Equal', on: true },
    ],
    tanShare: true,
    perpShare: false,
    tolDist: 0.05,
    tolAng: 1.0,
  });
  Nasj.defaultConstraints = defaultConstraints;

  Nasj.settings = {
    /* polar tracking ships ON, as the industry standard's does: the green alignment
       vector and its "Polar: d < a°" readout appear while drawing and
       dimensioning, whenever the cursor nears a tracking angle */
    grid: true, snap: false, infer: false, ortho: false, polar: true,
    osnap: true, otrack: true, dyn: true, lwt: false, transparency: false,
    cycling: false, gridSize: 10, poche: false,
    /* what a trackpad's two-finger scroll does on the drawing: 'auto' pans
       when the wheel stream looks like a trackpad and zooms for a mouse
       wheel (engine onWheel tells them apart), 'always' pans every scroll,
       'never' zooms every scroll the way a mouse wheel does. OPTIONS ▸ User
       Preferences keeps it; app.js copies the saved value here at boot. */
    trackpadPan: 'auto',
    /* Drafting Settings ▸ Snap and Grid. gridSize stays the one number the
       status bar and older code set; X and Y fall back to it, so a drawing
       that never opens the dialog behaves exactly as it always did. */
    snapX: 0, snapY: 0,        /* 0 = follow gridSize */
    gridX: 0, gridY: 0,        /* 0 = follow gridSize */
    majorEvery: 5,             /* GRIDMAJOR: minor lines between major ones */
    snapIso: false,            /* SNAPSTYL: isometric snap/grid */
    snapPolar: false,          /* SNAPTYPE: PolarSnap replaces grid snap */
    polarDist: 0,              /* POLARDIST: 0 = follow the snap X spacing */
    /* ZOOMFACTOR: percent a wheel notch zooms by, 3-100; kept across sessions
       as the industry standard keeps it in the registry */
    zoomFactor: (() => {
      try { const v = +localStorage.getItem('nasjicad.zoomfactor'); return (v >= 3 && v <= 100) ? v : 60; }
      catch (_) { return 60; }
    })(),
    isoPlane: 0,               /* ISOPLANE 0 left, 1 top, 2 right */
    gridAdaptive: true,        /* thin the grid out rather than crowd it */
    gridBeyond: true,          /* draw past the drawing limits */
    /* ▸ Polar Tracking */
    /* ▸ Dynamic Input — the industry standard ships both prompt lines on */
    dynDim: true, dynPrompt: true, dynTips: true,
    polarExtra: [],            /* additional angles, degrees */
    polarUseExtra: false,      /* whether the additional list is in play */
    polarRel: false,           /* measure from the last segment, not absolute */
    otrackAll: false,          /* osnap tracking follows every polar angle */
    pickGroups: true,  /* PICKSTYLE: picking one member selects the group */
    /* PICKADD, on the industry standard's own default: 2 means every pick and window
       ADDS to what is already selected and Shift takes away. 0 is the
       other way round — the newest selection replaces the last. */
    pickadd: 2,
    /* PDMODE 1 is the industry standard's "display nothing" point style, and it is the one
       this ships with: the nodes DIVIDE and MEASURE lay down are meant to be
       snapped to, not looked at, and a drawing full of dots is a drawing full
       of litter. They are still real objects — Node snap finds them the
       moment the cursor rests on one, and Point Style (PTYPE) puts a glyph
       back for anyone who wants to see them. */
    pdmode: 1,         /* PDMODE: the point glyph (0 dot, 1 none … 96+ ringed) */
    pdsize: 0,         /* PDSIZE: 0 = 5% of screen; <0 = %; >0 = units */
    lockFade: 50,  /* LAYLOCKFADECTL: how far a locked layer fades back (%) */
    xdwgfadectl: 50, /* XDWGFADECTL: how far an external reference fades back (%) */
    frame: 3,      /* FRAME: 0 hidden, 1 display+plot, 2 display only, 3 varies */
    uosnap: true,  /* UOSNAP: object snap reaches into a reference */
    /* CENTERLAYER / MARKUPLAYER / TEXTLAYER: the layer new center marks and
       centerlines, new revision clouds and wipeouts, and new text are drawn
       on. "." is the industry standard's own default and each Annotate panel shows it as
       "Use Current" — the drawing's current layer, whatever that is. */
    centerlayer: '.',
    markuplayer: '.',
    textlayer: '.',
    /* CCONSTRAINTFORM: the form a new dimensional constraint takes —
       0 dynamic (shown only while working, never plotted), 1 annotational
       (behaves like a dimension and plots). The Parametric ▸ Dimensional
       slide-out is where the industry standard sets it. */
    cconstraintform: 0,
    /* the rest of the Constraint Settings dialog (CONSTRAINTSETTINGS) */
    constraints: defaultConstraints(),
    polarAng: 90, /* polar tracking increment, degrees */
    /* running object snap modes (the industry standard's defaults: End/Mid/Cen/GCen/Int/Ext) */
    /* Node rides with the rest: DIVIDE and MEASURE exist to put nodes down to
       snap to, and with Node off, hovering one caught nothing and the whole
       command was decoration. This set is already more generous than
       the industry standard's default OSMODE (which omits mid, gcen, near and perp too). */
    osnapModes: {
      end: true, mid: true, cen: true, gcen: true, node: true, quad: false,
      int: true, ext: true, ins: false, perp: true, tan: false, near: true,
      appint: false, par: false
    },
    /* drawing units (UNITS dialog) — the industry standard's system variables. Defaults
       reproduce what the app displayed before UNITS existed: decimal
       lengths at 0.0000, decimal degrees, millimetres for inserts. */
    units: {
      lunits: 2,     /* 1 Scientific 2 Decimal 3 Engineering 4 Architectural 5 Fractional */
      luprec: 4,     /* length precision: decimals, or 1/2^n for arch/fractional */
      aunits: 0,     /* 0 Decimal Degrees 1 Deg/Min/Sec 2 Grads 3 Radians 4 Surveyor */
      auprec: 2,     /* angle precision */
      angdir: 0,     /* 0 counter-clockwise, 1 clockwise */
      angbase: 0,    /* direction of angle zero, degrees CCW from east */
      insunits: 4,   /* DXF $INSUNITS: 4 = millimetres */
      lighting: 2    /* 0 Generic 1 American 2 International (SI) */
    }
  };

  /* ------------------------------------------------------------------ *
   * Drawing units — the one place that turns a number into the text the
   * user reads and turns typed text back into a number. Lengths follow
   * LUNITS/LUPREC; angle *directions* also follow ANGBASE/ANGDIR, while
   * angle *values* (a rotation, an included angle) only change unit.
   * Internally every length is a drawing unit and every angle is degrees
   * counter-clockwise from east — nothing here touches stored geometry.
   * ------------------------------------------------------------------ */
  const U = () => Nasj.settings.units;
  const clampI = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
  const norm360 = (d) => ((d % 360) + 360) % 360;
  const gcdI = (a, b) => (b ? gcdI(b, a % b) : a);
  const pad2 = (n, dec) => (n < 10 ? '0' : '') + (dec ? n.toFixed(dec) : String(n));

  /* whole + n/d, reduced (1'-3 2/4" is never what the industry standard prints) */
  const fracPart = (a, den) => {
    let whole = Math.floor(a);
    let num = Math.round((a - whole) * den);
    if (num >= den) { whole += 1; num = 0; }
    if (!num) return { whole, txt: '' };
    const g = gcdI(num, den) || 1;
    return { whole, txt: (num / g) + '/' + (den / g) };
  };

  const fmtSci = (n, p) =>
    n.toExponential(p).toUpperCase().replace(/E([+-])(\d)$/, 'E$10$2');

  const fmtEng = (n, p) => {                   /* 1'-6.5000" (unit = inch) */
    const sign = n < 0 ? '-' : '';
    const a = Math.abs(n);
    let ft = Math.floor(a / 12);
    let inch = Number((a - ft * 12).toFixed(p));
    if (inch >= 12) { ft += 1; inch -= 12; }
    return sign + (ft ? ft + "'-" : '') + inch.toFixed(p) + '"';
  };

  const fmtArch = (n, p) => {                  /* 1'-6 1/2" (unit = inch) */
    const sign = n < 0 ? '-' : '';
    const f = fracPart(Math.abs(n), 1 << clampI(p, 0, 8));
    const ft = Math.floor(f.whole / 12), inch = f.whole % 12;
    return sign + (ft ? ft + "'-" : '') + inch + (f.txt ? ' ' + f.txt : '') + '"';
  };

  const fmtFrac = (n, p) => {                  /* 18 1/2 — inches, no feet */
    const sign = n < 0 ? '-' : '';
    const f = fracPart(Math.abs(n), 1 << clampI(p, 0, 8));
    if (!f.txt) return sign + f.whole;
    return sign + (f.whole ? f.whole + ' ' : '') + f.txt;
  };

  const fmtLen = (v) => {
    const n = Number(v);
    if (!isFinite(n)) return '0';
    const u = U(), p = clampI(u.luprec, 0, 8);
    switch (clampI(u.lunits, 1, 5)) {
      case 1: return fmtSci(n, p);
      case 3: return fmtEng(n, p);
      case 4: return fmtArch(n, p);
      case 5: return fmtFrac(n, p);
      default: return n.toFixed(p);
    }
  };

  const fmtDms = (d, p) => {                   /* 45d12'30.00" */
    if (p <= 0) return norm360(Math.round(d)) + 'd';
    if (p === 1) {
      const tot = Math.round(d * 60);
      const deg = Math.floor(tot / 60);
      return norm360(deg) + 'd' + pad2(tot - deg * 60) + "'";
    }
    const dec = p - 2, f = Math.pow(10, dec);
    let tot = Math.round(d * 3600 * f) / f;
    const deg = Math.floor(tot / 3600); tot -= deg * 3600;
    const min = Math.floor(tot / 60), sec = tot - min * 60;
    return norm360(deg) + 'd' + pad2(min) + "'" + pad2(sec, dec) + '"';
  };

  const fmtSurv = (d, p) => {                  /* N 45d0'0" E */
    const a = norm360(d), eps = 1e-9;
    if (a < eps || 360 - a < eps) return 'E';
    if (Math.abs(a - 90) < eps) return 'N';
    if (Math.abs(a - 180) < eps) return 'W';
    if (Math.abs(a - 270) < eps) return 'S';
    const ns = (a < 90 || a > 270) ? 'N' : 'S';
    const ew = (a < 180) ? (a < 90 ? 'E' : 'W') : (a < 270 ? 'W' : 'E');
    const off = a < 90 ? 90 - a : (a < 180 ? a - 90 : (a < 270 ? 270 - a : a - 270));
    return ns + ' ' + fmtDms(off, p) + ' ' + ew;
  };

  /* unit conversion only — for an angle that is a value, not a direction */
  const fmtAngVal = (deg) => {
    const u = U(), p = clampI(u.auprec, 0, 8);
    const d = Number(deg) || 0;
    switch (clampI(u.aunits, 0, 4)) {
      case 1: case 4: return (d < 0 ? '-' : '') + fmtDms(Math.abs(d), p);
      case 2: return (d * 10 / 9).toFixed(p) + 'g';
      case 3: return (d * Math.PI / 180).toFixed(p) + 'r';
      default: return d.toFixed(p);
    }
  };

  /* a direction: ANGBASE moves zero, ANGDIR flips which way it grows */
  const toDisplayDeg = (deg) => {
    const u = U();
    return norm360((Number(deg) - (u.angbase || 0)) * (u.angdir ? -1 : 1));
  };
  const fromDisplayDeg = (deg) => {
    const u = U();
    return norm360((u.angdir ? -Number(deg) : Number(deg)) + (u.angbase || 0));
  };

  const fmtAng = (deg, degSign) => {
    const u = U(), p = clampI(u.auprec, 0, 8);
    const d = toDisplayDeg(deg);
    switch (clampI(u.aunits, 0, 4)) {
      case 1: return fmtDms(d, p);
      case 2: return (d * 10 / 9).toFixed(p) + 'g';
      case 3: return (d * Math.PI / 180).toFixed(p) + 'r';
      case 4: return fmtSurv(d, p);
      default: return d.toFixed(p) + (degSign ? '°' : '');
    }
  };

  /* ---- typed input ---- */
  const reDec = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

  /* 12.5 · 1'6" · 1'-6 1/2" · 6" · 1' · 6 1/2 · 1/2  →  drawing units */
  const parseLen = (str) => {
    let s = String(str == null ? '' : str).trim();
    if (!s) return null;
    if (reDec.test(s)) return Number(s);
    let sign = 1;
    if (s[0] === '-') { sign = -1; s = s.slice(1).trim(); }
    else if (s[0] === '+') s = s.slice(1).trim();
    let total = 0, seen = false;
    const ft = /^(\d+(?:\.\d+)?)\s*['’]/.exec(s);
    if (ft) {
      total += Number(ft[1]) * 12;
      seen = true;
      s = s.slice(ft[0].length).trim();
      if (s[0] === '-') s = s.slice(1).trim();
    }
    if (s) {
      const fr = /^(?:(\d+)[\s-]+)?(\d+)\s*\/\s*(\d+)\s*["”]?$/.exec(s);
      const wh = fr ? null : /^(\d+(?:\.\d+)?)\s*["”]?$/.exec(s);
      if (fr) {
        if (!(+fr[3])) return null;
        total += (fr[1] ? +fr[1] : 0) + (+fr[2]) / (+fr[3]);
        seen = true;
      } else if (wh) {
        total += Number(wh[1]);
        seen = true;
      } else return null;                    /* trailing junk: not a length */
    }
    return seen ? sign * total : null;
  };

  /* 45 · 45.5d · 45d12'30" · 50g · 0.7854r  →  degrees, unit conversion only */
  const parseAngVal = (str) => {
    const s = String(str == null ? '' : str).trim();
    if (!s) return null;
    const dms = /^([-+]?\d+(?:\.\d+)?)\s*d\s*(?:(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*["”])?)?$/i.exec(s);
    if (dms) {
      const sign = Number(dms[1]) < 0 ? -1 : 1;
      return sign * (Math.abs(Number(dms[1])) + (dms[2] ? +dms[2] / 60 : 0) + (dms[3] ? +dms[3] / 3600 : 0));
    }
    const suf = /^([-+]?(?:\d+\.?\d*|\.\d+))\s*([dgr])$/i.exec(s);
    if (suf) {
      const v = Number(suf[1]), k = suf[2].toLowerCase();
      return k === 'g' ? v * 0.9 : (k === 'r' ? v * 180 / Math.PI : v);
    }
    if (!reDec.test(s)) return null;
    const v = Number(s);
    switch (clampI(U().aunits, 0, 4)) {
      case 2: return v * 0.9;                  /* grads */
      case 3: return v * 180 / Math.PI;        /* radians */
      default: return v;                       /* degrees */
    }
  };

  /* a typed direction: read in the current units, then through ANGBASE/ANGDIR */
  const parseAng = (str) => {
    const s = String(str == null ? '' : str).trim();
    if (!s) return null;
    const surv = /^([NS])\s*(.+?)\s*([EW])$/i.exec(s);
    if (surv) {                                /* bearings are absolute */
      const v = parseAngVal(surv[2]);
      if (v == null) return null;
      const ns = surv[1].toUpperCase(), ew = surv[3].toUpperCase();
      return norm360(ns === 'N' ? (ew === 'E' ? 90 - v : 90 + v)
        : (ew === 'E' ? 270 + v : 270 - v));
    }
    const v = parseAngVal(s);
    return v == null ? null : fromDisplayDeg(v);
  };

  /* DXF $INSUNITS codes, in the order the industry standard lists them */
  const INSUNITS = [
    [0, 'Unitless'], [1, 'Inches'], [2, 'Feet'], [3, 'Miles'], [4, 'Millimeters'],
    [5, 'Centimeters'], [6, 'Meters'], [7, 'Kilometers'], [8, 'Microinches'],
    [9, 'Mils'], [10, 'Yards'], [11, 'Angstroms'], [12, 'Nanometers'],
    [13, 'Microns'], [14, 'Decimeters'], [15, 'Dekameters'], [16, 'Hectometers'],
    [17, 'Gigameters'], [18, 'Astronomical Units'], [19, 'Light Years'],
    [20, 'Parsecs'], [21, 'US Survey Feet'], [22, 'US Survey Inch'],
    [23, 'US Survey Yard'], [24, 'US Survey Mile']
  ];

  Nasj.units = {
    get: () => U(),
    set: (patch) => {
      Object.assign(U(), patch || {});
      Nasj.emit('nasj:settings', { key: 'units', value: U() });
      if (typeof Nasj.render === 'function') Nasj.render();
    },
    fmtLen, fmtAng, fmtAngVal, parseLen, parseAng, parseAngVal,
    /* the same formatters, told which units to use rather than reading the
       drawing's — a dimension style carries its own (DIMLUNIT/DIMAUNIT) */
    fmtLenAs: (v, lunits, prec) => {
      const n = Number(v);
      if (!isFinite(n)) return '0';
      const p = clampI(prec, 0, 8);
      switch (clampI(lunits, 1, 5)) {
        case 1: return fmtSci(n, p);
        case 3: return fmtEng(n, p);
        case 4: return fmtArch(n, p);
        case 5: return fmtFrac(n, p);
        default: return n.toFixed(p);
      }
    },
    fmtAngAs: (deg, aunits, prec) => {
      const p = clampI(prec, 0, 8);
      const d = Number(deg) || 0;
      switch (clampI(aunits, 0, 3)) {
        case 1: return (d < 0 ? '-' : '') + fmtDms(Math.abs(d), p);
        case 2: return (d * 10 / 9).toFixed(p) + 'g';
        case 3: return (d * Math.PI / 180).toFixed(p) + 'r';
        default: return d.toFixed(p) + '°';
      }
    },
    insUnitsList: () => INSUNITS.map((r) => r.slice()),
    insUnitsName: () => {
      const row = INSUNITS.find((r) => r[0] === clampI(U().insunits, 0, 24));
      return row ? row[1] : 'Unitless';
    }
  };

  /* SPEC3 §23: UI visibility flags — engine exposes only the object;
     SHELL applies the show/hide classes. */
  Nasj.uiFlags = {
    ucsIcon: true, viewCube: true, navBar: true, fileTabs: true, sheetTabs: true
  };

  /* ------------------------------------------------------------------ *
   * UCS — the drawing's own origin. Geometry is always stored in world
   * coordinates; the UCS only moves where "0,0" is for what the user
   * reads and types, and where the axis icon sits. Translation only.
   * ------------------------------------------------------------------ */
  /* THE CONSTRUCTION PLANE — the industry standard's UCS, and the reason a drawing can be
     made on the ZY or ZX plane rather than only on the ground. The frame is
     two unit vectors: U is the plane's own X, V its own Y, and their cross
     product is the normal a picked point lands on. World is the ground
     plane, which is what every drawing before this one was made on.
     UCS X / Y / Z turn it 90 degrees about that world axis, the gesture
     the industry standard uses to stand the plane up. */
  const UCS_FRAMES = {
    world: { u: [1, 0, 0], v: [0, 1, 0], label: ['X', 'Y'], name: 'World' },
    /* about X: the plane's own Y rises into world Z — the XZ plane */
    x: { u: [1, 0, 0], v: [0, 0, 1], label: ['X', 'Z'], name: 'X' },
    /* about Y: the plane's own X lies along world Z — the ZY plane */
    y: { u: [0, 0, 1], v: [0, 1, 0], label: ['Z', 'Y'], name: 'Y' },
    /* about Z: still the ground, turned a quarter within it */
    z: { u: [0, 1, 0], v: [-1, 0, 0], label: ['X', 'Y'], name: 'Z' },
    /* the four standing views, for UCSORTHO: each frame's U runs along
       screen-right in its own view and V straight up it, so what is drawn
       lies on the plane being looked at */
    front: { u: [1, 0, 0], v: [0, 0, 1], label: ['X', 'Z'], name: 'Front' },
    back: { u: [-1, 0, 0], v: [0, 0, 1], label: ['X', 'Z'], name: 'Back' },
    right: { u: [0, 1, 0], v: [0, 0, 1], label: ['Y', 'Z'], name: 'Right' },
    left: { u: [0, -1, 0], v: [0, 0, 1], label: ['Y', 'Z'], name: 'Left' },
    /* the lying pair, completing the industry standard's six orthographic UCSs: Top is
       the ground under its own name, Bottom the ground seen from below —
       X runs the other way so the normal points down */
    top: { u: [1, 0, 0], v: [0, 1, 0], label: ['X', 'Y'], name: 'Top' },
    bottom: { u: [-1, 0, 0], v: [0, 1, 0], label: ['X', 'Y'], name: 'Bottom' },
  };
  const ucsFrame = () => UCS_FRAMES[(Nasj.ucs && Nasj.ucs.plane) || 'world'] ||
    UCS_FRAMES.world;
  /* the plane's normal, and its origin as a full three-dimensional point */
  const ucsNormal = () => {
    const f = ucsFrame();
    const [ax, ay, az] = f.u, [bx, by, bz] = f.v;
    return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
  };
  const ucsOrigin = () => ({
    x: (Nasj.ucs && Nasj.ucs.x) || 0,
    y: (Nasj.ucs && Nasj.ucs.y) || 0,
    z: (Nasj.ucs && Nasj.ucs.z) || 0,
  });
  /* a point given in the plane's own two numbers, out in world terms */
  const ucsToWorld = (a, b) => {
    const f = ucsFrame(), O = ucsOrigin();
    return {
      x: O.x + a * f.u[0] + b * f.v[0],
      y: O.y + a * f.u[1] + b * f.v[1],
      z: O.z + a * f.u[2] + b * f.v[2],
    };
  };
  Nasj.ucsPlane = {
    frame: ucsFrame,
    normal: ucsNormal,
    origin: ucsOrigin,
    toWorld: ucsToWorld,
    names: () => Object.keys(UCS_FRAMES),
    /* the plane a drawing is being made on; 'world' is the ground */
    set(key) {
      const k = String(key || 'world').toLowerCase();
      if (!UCS_FRAMES[k]) return false;
      Nasj.ucs = Nasj.ucs || { x: 0, y: 0 };
      Nasj.ucs.plane = k === 'world' ? undefined : k;
      Nasj.emit('nasj:ucs', { ucs: Nasj.ucs });
      if (typeof Nasj.render === 'function') Nasj.render();
      return true;
    },
    get: () => (Nasj.ucs && Nasj.ucs.plane) || 'world',
  };
  Nasj.ucs = Nasj.ucs || { x: 0, y: 0 };
  Nasj.toUcs = (p) => ({ x: p.x - Nasj.ucs.x, y: p.y - Nasj.ucs.y });
  Nasj.fromUcs = (p) => ({ x: p.x + Nasj.ucs.x, y: p.y + Nasj.ucs.y });
  Nasj.setUcs = (p) => {
    Nasj.ucs = { x: Number(p.x) || 0, y: Number(p.y) || 0 };
    Nasj.emit('nasj:ucs', { ucs: Nasj.ucs });
    if (typeof Nasj.render === 'function') Nasj.render();
    if (typeof Nasj.renderOverlay === 'function') Nasj.renderOverlay();
  };

  Nasj.ui = {
    crosshair: true,
    preview: [],
    selRect: null,
    selLasso: null,       /* {pts:[world…], crossing} — the press-drag lasso */
    snapMark: null,
    hoverId: null,
    hotGrip: null,        /* {x,y} of the active (hot) grip during stretch */
    stretchBox: null,     /* STRETCH flexible mode: {minx..maxy, handles, hot} */
    warmGrips: null,      /* [{x,y}] Shift-warmed grips awaiting a multi-grip drag */
    cursor: { world: { x: 0, y: 0 }, screen: { x: 0, y: 0 } }
  };

  /* snap-point kinds that are drawn (and hit-tested) as grip squares */
  const GRIP_KINDS = { end: 1, center: 1, mid: 1, quad: 1, node: 1, param: 1 };
  /* the grip square's side: OPTIONS' slider, and at least 14px under a
     finger — a 7px square is a target a fingertip covers four times over */
  const TOUCH_GRIP_PX = 14;
  const gripPx = () => {
    const g = (Nasj.opt && Nasj.opt.gripSize >= 3) ? Nasj.opt.gripSize : 7;
    return touchInput() ? Math.max(g, TOUCH_GRIP_PX) : g;
  };
  Nasj.gripPx = gripPx;

  Nasj.emit = (name, detail) =>
    window.dispatchEvent(new CustomEvent(name, { detail }));

  /* ---------------- platform: the Mac ----------------
     The Mac's shortcut modifier is Command. Every shortcut gate in the
     program asks Nasj.cmdKey(e) rather than e.ctrlKey, so Cmd+S on a
     MacBook is what Ctrl+S is on Windows; Ctrl keeps the few native uses
     macOS gives it (Ctrl+click is the right-click, and the OS has made it
     one before the page hears of it) and is never read as Command. The
     labels follow: Nasj.keyLabel('Ctrl+Shift+S') prints ⇧⌘S on a Mac and
     stays as written elsewhere. html.mac on the document is what the CSS
     keys off (the renderer's own window buttons give way to the traffic
     lights). Nasj.forceMac(true|false|null) is the QA hook: there is no
     Mac on the build machine, and the Windows harness proves the Mac
     paths through it. */
  let macForced = null;
  const macByUa = () => /Mac|iPhone|iPad|iPod/.test(
    (navigator.platform || '') + ' ' + (navigator.userAgent || ''));
  Nasj.isMac = () => (macForced === null ? macByUa() : macForced);
  /* html.mac on every Mac (Safari and Chrome on the web build too: the
     labels read ⌘ there as well); html.mac-app only in the desktop app,
     where the window's traffic lights are the CSS's business */
  Nasj.applyPlatformClass = () => {
    const h = document.documentElement;
    if (!h) return;
    const mac = Nasj.isMac();
    const api = window.nasjAPI;
    const desktop = !!(api && api.platform && api.platform !== 'web');
    h.classList.toggle('mac', mac);
    h.classList.toggle('mac-app', mac && desktop);
  };
  Nasj.forceMac = (on) => {
    macForced = (on === null || on === undefined) ? null : !!on;
    Nasj.applyPlatformClass();
    Nasj.emit('nasj:platform', { mac: Nasj.isMac() });
    return Nasj.isMac();
  };
  /* the platform's command modifier, and the OTHER platform's, which every
     gate refuses (Cmd+S on Windows and Ctrl+S on the Mac stay whatever the
     OS makes of them) */
  Nasj.cmdKey = (e) => !!(e && (Nasj.isMac() ? e.metaKey : e.ctrlKey));
  Nasj.otherModKey = (e) => !!(e && (Nasj.isMac() ? e.ctrlKey : e.metaKey));
  const MAC_MOD = { ctrl: '⌘', shift: '⇧', alt: '⌥' };
  const MAC_MOD_ORDER = ['alt', 'shift', 'ctrl'];   /* ⌥ ⇧ ⌘ — the Mac's own order */
  Nasj.keyLabel = (s) => {
    s = String(s == null ? '' : s);
    if (!Nasj.isMac()) return s;
    return s.replace(/\b((?:(?:Ctrl|Shift|Alt)\+)+)([A-Za-z0-9]+|[^\s()+,]+)/g, (_, mods, key) => {
      const have = new Set(mods.toLowerCase().split('+').filter(Boolean));
      return MAC_MOD_ORDER.filter((m) => have.has(m)).map((m) => MAC_MOD[m]).join('') + key;
    });
  };

  /* ---------------- paper space (SPEC2 §15) ---------------- */
  /* truthy ({name:'Layout1'}) = paper-space preview; null = model space */
  Nasj.paper = Nasj.paper || null;

  const SHEET = { w: 420, h: 297, margin: 10, vpInset: 24, color: '#fdfdfd' };
  /* A layout viewport is a rectangle of sheet (mm) showing the model point
     `ctr` at its middle, at `scale` sheet-mm per model unit. While one is
     ACTIVATED the world is model space again and the pointer reaches the
     drawing through it — the industry standard's MSPACE, the double-click state. */
  let mspVp = null;
  const mToP = (v, p) => ({
    x: v.x + v.w / 2 + (p.x - v.ctr.x) * v.scale,
    y: v.y + v.h / 2 + (p.y - v.ctr.y) * v.scale,
  });
  const pToM = (v, p) => ({
    x: v.ctr.x + (p.x - v.x - v.w / 2) / v.scale,
    y: v.ctr.y + (p.y - v.y - v.h / 2) / v.scale,
  });
  /* model space, whichever list doc.entities currently points at */
  const modelEnts = (doc) => ((Nasj.docOps && Nasj.docOps.modelEntities)
    ? Nasj.docOps.modelEntities(doc) : doc.entities);
  const layoutRec = () => (Nasj.paper && Nasj.doc && Nasj.docOps
    ? Nasj.docOps.layoutData(Nasj.doc, Nasj.paper.name) : null);
  let knockoutColor = COL.bg; /* dim-text knockout follows the active background */

  /* LIMITS: the drawing's model-space limits rectangle, as the LIMITS
     command set it — the industry standard's metric default sheet until it says otherwise */
  const limitsRect = (doc) => {
    const L = (doc && doc.limits) || { min: { x: 0, y: 0 }, max: { x: 420, y: 297 } };
    return {
      minx: Math.min(L.min.x, L.max.x), miny: Math.min(L.min.y, L.max.y),
      maxx: Math.max(L.min.x, L.max.x), maxy: Math.max(L.min.y, L.max.y)
    };
  };
  Nasj.limitsRect = limitsRect;

  /* SPEC3 §23: the active background color — model canvas vs paper sheet
     white. resolveColor('@bg') calls this (wipeout behavior). */
  Nasj.activeBg = () => (Nasj.paper ? SHEET.color : COL.bg);

  /* ---------------- viewport ---------------- */
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---------------- 3D view state (3D foundation) ----------------
   * Orthographic orbit view. While INACTIVE the viewport keeps the original
   * 2D worldToScreen/screenToWorld functions (they are swapped back in), so
   * the 2D fast path is byte-identical to the pre-3D engine. All projection
   * math runs in CPU doubles (precision invariant).
   * Angles in radians. Top view = azimuth 0 / elevation +90°, which projects
   * exactly like the 2D mapping (points on z=0). Viewer direction for a
   * given azimuth/elevation is (sin az·cos el, −cos az·cos el, sin el). */
  const DEG = Math.PI / 180;
  const ISO_EL = Math.atan(1 / Math.SQRT2); /* 35.264…°: true isometric tilt */

  const view3d = Nasj.view3d = {
    active: false,
    azimuth: 0,
    elevation: Math.PI / 2,
    target: { x: 0, y: 0, z: 0 },  /* orbit pivot (projects to a fixed pixel) */
    roll: 0,                       /* Free Orbit's ring: a turn about the view axis */
    persp: false,                  /* PERSPECTIVE: projectors fan out of the eye */
    distance: 1000,                /* eye distance: the perspective's strength */
    viewName: 'top'
  };

  let v3cA = 1, v3sA = 0, v3cE = 0, v3sE = 1; /* cached trig of azimuth/elevation */
  let v3cR = 1, v3sR = 0;                     /* and of the roll */
  const v3sync = () => {
    v3cA = Math.cos(view3d.azimuth);
    v3sA = Math.sin(view3d.azimuth);
    v3cE = Math.cos(view3d.elevation);
    v3sE = Math.sin(view3d.elevation);
    v3cR = Math.cos(view3d.roll);
    v3sR = Math.sin(view3d.roll);
  };

  let saved2d = null;    /* 2D transform captured on activation; Top restores it */
  let viewName = 'top';  /* preset key, or 'custom' after an orbit */

  /* world → view plane (rotate about Z by azimuth, tilt by elevation, drop
     depth). Doubles only; optional z defaults to 0. */
  const worldToView3 = (p) => {
    const z = (typeof p.z === 'number' && isFinite(p.z)) ? p.z : 0;
    const x = p.x * v3cA + p.y * v3sA;
    const y = (-p.x * v3sA + p.y * v3cA) * v3sE + z * v3cE;
    return { x: x * v3cR - y * v3sR, y: x * v3sR + y * v3cR };
  };

  /* The axis worldToView3 drops: how far a point lies ALONG the view, which
     is what a shaded 3D pass sorts by. Larger is farther from the eye, so a
     far-to-near paint is a plain descending sort. */
  const worldToDepth3 = (p) => {
    const z = (typeof p.z === 'number' && isFinite(p.z)) ? p.z : 0;
    return (-p.x * v3sA + p.y * v3cA) * v3cE - z * v3sE;
  };
  Nasj.worldToDepth3 = worldToDepth3;

  /* The visual style the drawing is shown in, as the renderer needs it —
     app.js owns the styles and their settings and hands the resolved rules
     down. Wireframe until told otherwise, which is what every style drew
     as before there was anything to shade with. */
  const vstyle = Nasj.vstyleRender = {
    name: '2D Wireframe',
    fills: false,      /* faces paint solid */
    edges: true,       /* and their outlines are drawn */
    gray: false,       /* Shades of Gray */
    alpha: 1,          /* X-Ray */
    hidden: false,     /* Hidden: faces paint in the background, so they
                          hide what stands behind them and show nothing */
    gooch: false,      /* Conceptual: warm-to-cool tones instead of a dimming */
    sketch: false,     /* Sketchy: edges overshoot their corners and wobble */
  };
  /* shading only means anything in a 3D view: a plan has no faces to hide */
  const shaded3d = () => view3d.active && vstyle.fills;
  Nasj.shaded3d = shaded3d;

  /* A face's shade. The industry standard's default lighting is a headlight, so a face
     square to the eye is brightest and one edge-on is darkest. The colour
     the face would have drawn in is dimmed by that, never brightened, so a
     shaded model keeps the drawing's own colours. */
  /* the r, g, b of a resolved entity colour. Only #rgb / #rrggbb and rgb()
     appear here; anything else is null, and the callers hand the colour
     back untouched rather than guess at it. */
  const cssRgb = (css) => {
    let r, g, b;
    const t = String(css || '').trim();
    if (t.charAt(0) === '#') {
      const h = t.slice(1);
      if (h.length === 3) {
        r = parseInt(h[0] + h[0], 16); g = parseInt(h[1] + h[1], 16); b = parseInt(h[2] + h[2], 16);
      } else if (h.length >= 6) {
        r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
      } else return null;
    } else {
      const open = t.indexOf('(');
      if (open < 0) return null;
      const parts = t.slice(open + 1).split(',');
      if (parts.length < 3) return null;
      r = parseFloat(parts[0]); g = parseFloat(parts[1]); b = parseFloat(parts[2]);
    }
    if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return null;
    return [r, g, b];
  };
  /* a colour dimmed by a face's shade */
  const shadeColor = (css, k) => {
    const rgb = cssRgb(css);
    if (!rgb) return css;
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return 'rgb(' + c(rgb[0]) + ',' + c(rgb[1]) + ',' + c(rgb[2]) + ')';
  };
  /* Shades of Gray is AutoCAD's Gooch in monochrome: one grey ramp for
     every body whatever its colour, dark where a face turns from the light
     and no lighter than a mid grey square to it, under a light from the
     eye and the sky alone — so in an isometric the two sides match and
     the top stands lighter, as AutoCAD's box shows. */
  const grayColor = (d) => {
    const g = Math.round((0.27 + 0.28 * d) * 255);
    return 'rgb(' + g + ',' + g + ',' + g + ')';
  };
  const grayLight = () => [0.75 * v3sA * v3cE, -0.75 * v3cA * v3cE, 0.75 * v3sE + 0.55];
  /* Conceptual is AutoCAD's Gooch face style: a face turned to the light
     goes WARM (a cream, for a white body) and one turned away goes COOL (a
     blue-violet), with the body's own colour under both — never a plain
     dimming. The tones are the ones AutoCAD's Conceptual shows on a white
     box: top cream, lit side near-neutral, shadowed side blue. d is how
     square the face is to the light, 0..1. */
  const goochColor = (css, d) => {
    const rgb = cssRgb(css);
    if (!rgb) return css;
    const t = d * (2 - d);
    const c = (v, cool, warm) => {
      const k = v / 255;
      const lo = cool + 0.40 * k, hi = warm + 0.83 * k;
      return Math.max(0, Math.min(255, Math.round((lo + (hi - lo) * t) * 255)));
    };
    return 'rgb(' + c(rgb[0], 0, 0.11) + ',' + c(rgb[1], 0, 0.11) + ',' + c(rgb[2], 0.38, 0) + ')';
  };
  /* Conceptual's light rides the view too, but over the LEFT shoulder and
     a little above the eye, where AutoCAD's default lighting sits: that is
     what makes the top warm, the left side neutral and the right side cool
     in a south-west isometric. */
  const goochLight = () => {
    const ex0 = v3sA * v3cE, ey0 = -v3cA * v3cE, ez0 = v3sE;   /* eye   */
    const rx = v3cA, ry = v3sA;                                /* right */
    const ux = -v3sA * v3sE, uy = v3cA * v3sE, uz = v3cE;      /* up    */
    return [0.86 * ex0 - 0.36 * rx + 0.36 * ux,
      0.86 * ey0 - 0.36 * ry + 0.36 * uy,
      0.86 * ez0 + 0.36 * uz];
  };
  /* how square a face is to a light: |n·l|, 0..1; two-sided, since a 3D
     face carries no winding worth trusting */
  const faceLit = (pts, nrm, L) => {
    if (!nrm && (!pts || pts.length < 3)) return 1;
    const z0 = (q) => ((typeof q.z === 'number' && isFinite(q.z)) ? q.z : 0);
    let nx, ny, nz;
    if (nrm) { nx = nrm[0]; ny = nrm[1]; nz = nrm[2]; }
    else {
      const ax = pts[1].x - pts[0].x, ay = pts[1].y - pts[0].y, az = z0(pts[1]) - z0(pts[0]);
      const bx = pts[2].x - pts[0].x, by = pts[2].y - pts[0].y, bz = z0(pts[2]) - z0(pts[0]);
      nx = ay * bz - az * by; ny = az * bx - ax * bz; nz = ax * by - ay * bx;
    }
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 1e-12)) return 1;
    const ll = Math.hypot(L[0], L[1], L[2]) || 1;
    return Math.abs((nx * L[0] + ny * L[1] + nz * L[2]) / (len * ll));
  };
  const faceShade = (pts, nrm) => {
    /* The light rides the view, a little up and to the right of the eye —
       the industry standard's default lighting is offset the same way, and it has to be:
       under a light exactly on the eye axis the three faces of a cube in an
       ISOMETRIC view all return the same 0.577 and the model reads as one
       flat silhouette. The offset is what separates top from side. */
    const ex0 = v3sA * v3cE, ey0 = -v3cA * v3cE, ez0 = v3sE;   /* eye   */
    const rx = v3cA, ry = v3sA, rz = 0;                        /* right */
    /* mostly from the eye, part from over the right shoulder, and part
       straight down from the sky. The sky term is what a CAD isometric
       needs: with the light on the eye axis alone the three faces of a cube
       all return the same 0.577 and the model reads as one flat blob. */
    const lx = 0.75 * ex0 + 0.30 * rx;
    const ly = 0.75 * ey0 + 0.30 * ry;
    const lz = 0.75 * ez0 + 0.30 * rz + 0.55;
    /* AutoCAD's default lighting: a white body tops out light grey, and the
       shade runs down to a mid grey where a face turns from the light */
    return 0.24 + 0.60 * faceLit(pts, nrm, [lx, ly, lz]);
  };
  /* the fill a lit face takes in the current style */
  const faceFill = (color, pts, nrm) => (vstyle.gray
    ? grayColor(faceLit(pts, nrm, grayLight()))
    : vstyle.gooch
      ? goochColor(color, faceLit(pts, nrm, goochLight()))
      : shadeColor(color, faceShade(pts, nrm)));


  /* ---------------- view twist (SPEC2 §18: the saved view's rotation) ----
   * A site plan is very often DRAWN at an angle in the world and only reads
   * square because the file's viewport carries a twist — the industry standard turns the
   * view, not the drawing. Painting model coordinates straight onto the
   * canvas therefore shows such a plan on its side, which is exactly what
   * it used to do.
   *
   * The angle belongs to the VIEW: it turns the picture, the grid, the
   * crosshair and the axes ortho follows, and it never touches a
   * coordinate. What the drawing holds is still what it holds — the
   * readout, the measurements and the file that gets saved are untouched.
   *
   * Zero is the ordinary case and stays on the original code path, so a
   * drawing without a twist maps exactly as it did before.
   * ------------------------------------------------------------------ */
  let twist = 0, twCos = 1, twSin = 0;
  /* world -> the view's own frame, and back */
  const rotW = (p) => (twist
    ? { x: p.x * twCos - p.y * twSin, y: p.x * twSin + p.y * twCos } : p);
  const unrotW = (p) => (twist
    ? { x: p.x * twCos + p.y * twSin, y: -p.x * twSin + p.y * twCos } : p);
  /* a world angle as the canvas sees it: the y flip negates it, and a
     twisted view turns it with everything else */
  const scrAng = (a) => -(a + twist);

  /* ------------------------------------------------------------------ *
   * THE CONTENT FIT, FOUND ONCE — AND, DURING AN OPEN, IN SLICES.
   *
   * zoomContent frames the drawing's dense mass, and finding that mass is
   * a sweep of every entity's box plus two sorts of a quarter-million
   * numbers: 182ms, measured, on a block library. It was paid by the
   * opening frame, again by the zoom-out tile warm, and again by every
   * ZOOM Content — and each time it was 182ms in which the thread could
   * not put a frame up and the crosshair stood still.
   *
   * The answer is a world rectangle. It only moves when the drawing does,
   * so it is found once per revision and kept; and behind the open's
   * progress bar it is found a frame's worth at a time. The percentiles
   * come off a quickselect instead of a sort — the same elements at the
   * same ranks, without ordering everything around them — and the boxes
   * live in typed arrays instead of a quarter-million small objects.
   * Every number this produces is the one the sorted version produced.
   * ------------------------------------------------------------------ */
  /* the answer is per DRAWING and keyed to that drawing's own revision:
     one cache object meant a tab click threw the fit away, and the next
     thing to want it (the idle tile warm, a zoom-out) paid the whole sweep
     again — 410ms of it on a block library, in one unsliced idle task. */
  const fitCaches = new Map();
  const FIT_DOCS = 8;
  let fitJob = null;
  const fitCacheOk = (doc) => {
    const c = doc ? fitCaches.get(doc) : null;
    return !!(c && c.rect && c.ents === doc.entities && c.gen === docGen(doc) &&
      c.twist === twist);
  };
  /* the k-th smallest of a Float64Array's first n, in place. A partial
     order is all a percentile needs, and repeated calls on the same array
     stay correct — it is still the same multiset, merely moved around. */
  const nthElement = (a, n, k) => {
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const p = a[(lo + hi) >> 1];
      let i = lo, j = hi;
      while (i <= j) {
        while (a[i] < p) i++;
        while (a[j] > p) j--;
        if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
      }
      if (k <= j) hi = j;
      else if (k >= i) lo = i;
      else break;
    }
    return a[k];
  };
  const fitJobStart = (doc, all) => {
    const n = doc.entities.length;
    return { doc, ents: doc.entities, gen: docGen(doc), twist,
      lmap: layerMap(doc), all: !!all, i: 0, k: 0, vis: 0,
      bx0: new Float64Array(n), by0: new Float64Array(n),
      bx1: new Float64Array(n), by1: new Float64Array(n),
      minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
  };
  /* true while there is more of the sweep to do */
  const fitJobRun = (job, deadline) => {
    const ents = job.ents;
    let i = job.i, k = job.k, vis = job.vis;
    for (; i < ents.length; i++) {
      /* every 8, not 512: one batch can hold several rotated references
         whose exact bounds each materialize a definition (~35ms apiece,
         measured) — the coarser checks let a warm slice run to 136-151ms.
         The clock read is nothing beside one such box. */
      if (deadline && !(i & 7) && performance.now() > deadline) break;
      const ent = ents[i];
      if (!job.all && !entVisible(ent, job.lmap)) continue;
      vis++;
      /* the cluster is measured where it will be SEEN: in a twisted view
         the drawing squares up, and its own frame is the honest one */
      const b = job.twist ? viewBoxOf(ent) : Nasj.geom.entityBounds(ent);
      if (!isFinite(b.minx) || !isFinite(b.maxx) ||
          !isFinite(b.miny) || !isFinite(b.maxy)) continue;
      job.bx0[k] = b.minx; job.by0[k] = b.miny;
      job.bx1[k] = b.maxx; job.by1[k] = b.maxy;
      k++;
      if (b.minx < job.minx) job.minx = b.minx;
      if (b.miny < job.miny) job.miny = b.miny;
      if (b.maxx > job.maxx) job.maxx = b.maxx;
      if (b.maxy > job.maxy) job.maxy = b.maxy;
    }
    job.i = i; job.k = k; job.vis = vis;
    return i < ents.length;
  };
  /* the rectangle the sweep adds up to: null = nothing framable, .ext =
     the cluster did not win and plain extents are the answer */
  const fitJobFinish = (job) => {
    const k = job.k;
    if (!k) return null;
    let qx0, qx1, qy0, qy1;
    if (job.fqy1 !== undefined) {
      /* the sliced path (contentFitStep) already ran the quantile passes
         one per slice — take its answers instead of re-biting them here */
      qx0 = job.fqx0; qx1 = job.fqx1; qy0 = job.fqy0; qy1 = job.fqy1;
    } else {
      const cx = new Float64Array(k), cy = new Float64Array(k);
      for (let i = 0; i < k; i++) {
        cx[i] = (job.bx0[i] + job.bx1[i]) / 2;
        cy[i] = (job.by0[i] + job.by1[i]) / 2;
      }
      const lo = Math.min(k - 1, Math.floor(k * 0.05));
      const hi = Math.min(k - 1, Math.floor(k * 0.95));
      qx0 = nthElement(cx, k, lo); qx1 = nthElement(cx, k, hi);
      qy0 = nthElement(cy, k, lo); qy1 = nthElement(cy, k, hi);
    }
    const spanX = Math.max(qx1 - qx0, 1e-9);
    const spanY = Math.max(qy1 - qy0, 1e-9);
    /* half a span of slack each side: enough to take in a title block or
       a section detail parked beside the plan, not enough to frame the
       empty ground between the drawing and something left at the origin */
    const gx0 = qx0 - spanX / 2, gx1 = qx1 + spanX / 2;
    const gy0 = qy0 - spanY / 2, gy1 = qy1 + spanY / 2;
    let fx0 = Infinity, fy0 = Infinity, fx1 = -Infinity, fy1 = -Infinity;
    for (let i = 0; i < k; i++) {
      const x0 = job.bx0[i], y0 = job.by0[i], x1 = job.bx1[i], y1 = job.by1[i];
      const bx = (x0 + x1) / 2, by = (y0 + y1) / 2;
      if (bx < gx0 || bx > gx1 || by < gy0 || by > gy1) continue;
      /* an object wildly bigger than the mass is not part of it: a block
         left at the origin whose contents sit megaunits away reaches
         across the gap, and framing that reach frames emptiness */
      if ((x1 - x0) > 3 * spanX || (y1 - y0) > 3 * spanY) continue;
      /* Clipped to the gate, so no ONE object can stretch the frame past
         where the drawing lives. */
      const cx0 = Math.max(x0, gx0), cy0 = Math.max(y0, gy0);
      const cx1 = Math.min(x1, gx1), cy1 = Math.min(y1, gy1);
      if (cx0 < fx0) fx0 = cx0;
      if (cy0 < fy0) fy0 = cy0;
      if (cx1 > fx1) fx1 = cx1;
      if (cy1 > fy1) fy1 = cy1;
    }
    if (!isFinite(fx0) ||
        ((job.maxx - job.minx) < 4 * Math.max(fx1 - fx0, 1e-9) &&
         (job.maxy - job.miny) < 4 * Math.max(fy1 - fy0, 1e-9))) {
      /* plain extents — and the sweep already has them, so nobody sweeps
         a second time for what zoomExtents would have recomputed */
      return { ext: true, x0: job.minx, y0: job.miny, x1: job.maxx, y1: job.maxy };
    }
    return { x0: fx0, y0: fy0, x1: fx1, y1: fy1 };
  };
  /* the finished sweep's answer, cached — or null when nothing visible had
     a box and the whole table still owes a pass, exactly as the
     "vis.length ? vis : doc.entities" fallback always did */
  const fitJobEnd = (job) => {
    if (!job.vis && !job.all && job.ents.length) return null;
    const rect = fitJobFinish(job) || { none: true };
    fitCaches.delete(job.doc);
    fitCaches.set(job.doc, { ents: job.ents, gen: job.gen, twist: job.twist, rect });
    while (fitCaches.size > FIT_DOCS) fitCaches.delete(fitCaches.keys().next().value);
    return rect;
  };
  const contentRect = (doc) => {
    if (fitCacheOk(doc)) return fitCaches.get(doc).rect;
    fitJob = null;
    for (let all = 0; all < 2; all++) {
      const job = fitJobStart(doc, !!all);
      fitJobRun(job, 0);
      const r = fitJobEnd(job);
      if (r) return r;
    }
    return { none: true };
  };
  /* one slice of the same sweep — the open front-load's step */
  const contentFitStep = (doc, deadline) => {
    if (fitCacheOk(doc)) { fitJob = null; return false; }
    if (!fitJob || fitJob.doc !== doc || fitJob.ents !== doc.entities ||
        fitJob.gen !== docGen(doc) || fitJob.twist !== twist) fitJob = fitJobStart(doc);
    if (fitJobRun(fitJob, deadline)) return true;
    /* the finish is seven-odd passes over a quarter-million boxes (the
       percentile selections and the union) — 141ms in one bite, measured
       — so it drains one PASS per slice: centres, then each nthElement,
       then the union, before the cache write on the last call */
    const J = fitJob;
    if (J.fin === undefined) { J.fin = 0; return true; }
    const k = J.k;
    if (k && J.fin < 6) {
      if (J.fin === 0) {
        J.fcx = new Float64Array(k);
        J.fcy = new Float64Array(k);
        for (let i = 0; i < k; i++) {
          J.fcx[i] = (J.bx0[i] + J.bx1[i]) / 2;
          J.fcy[i] = (J.by0[i] + J.by1[i]) / 2;
        }
      } else {
        const lo = Math.min(k - 1, Math.floor(k * 0.05));
        const hi = Math.min(k - 1, Math.floor(k * 0.95));
        /* nthElement mutates its input: each quantile works on a copy */
        if (J.fin === 1) J.fqx0 = nthElement(J.fcx.slice(), k, lo);
        else if (J.fin === 2) J.fqx1 = nthElement(J.fcx.slice(), k, hi);
        else if (J.fin === 3) J.fqy0 = nthElement(J.fcy.slice(), k, lo);
        else if (J.fin === 4) J.fqy1 = nthElement(J.fcy.slice(), k, hi);
        else { J.fcx = J.fcy = null; }
      }
      J.fin++;
      return true;
    }
    if (fitJobEnd(J)) { fitJob = null; return false; }
    fitJob = fitJobStart(doc, true);      /* the fallback pass is owed */
    return true;
  };

  const vp = Nasj.viewport = {
    scale: 1, tx: 0, ty: 0,

    /* the saved view's rotation, in radians CCW (0 = the ordinary case) */
    get twist() { return twist; },
    set twist(rad) {
      const v = (typeof rad === 'number' && isFinite(rad)) ? rad % TAU : 0;
      twist = v;
      twCos = v ? Math.cos(v) : 1;
      twSin = v ? Math.sin(v) : 0;
    },

    /* screen = twist(world)*scale + t, world Y is UP: sy = H - (wy*scale + ty) */
    worldToScreen: (p) => {
      const r = rotW(p);
      return { x: r.x * vp.scale + vp.tx, y: cssH - (r.y * vp.scale + vp.ty) };
    },
    screenToWorld: (p) => unrotW({
      x: (p.x - vp.tx) / vp.scale, y: (cssH - p.y - vp.ty) / vp.scale
    }),

    zoomAt(sx, sy, factor) {
      /* a malformed call (object coords, missing factor — a QA harness
         passed (factor, {point})) must not poison the viewport: NaN scale
         paints an honestly empty view and the whole drawing "disappears"
         until the next valid zoom. Refuse it whole instead. */
      if (!isFinite(sx) || !isFinite(sy) || !isFinite(factor) || factor <= 0) return;
      if (mspVp) {   /* the sheet holds still; the view inside the frame zooms */
        const m = vp.screenToWorld({ x: sx, y: sy });
        mspVp.scale = clamp(mspVp.scale * factor, 1e-9, 1e9);
        const q = s2w2d({ x: sx, y: sy });      /* the paper point it sits on */
        mspVp.ctr.x = m.x - (q.x - mspVp.x - mspVp.w / 2) / mspVp.scale;
        mspVp.ctr.y = m.y - (q.y - mspVp.y - mspVp.h / 2) / mspVp.scale;
        return;
      }
      if (view3d.active) { /* anchor the z=0-plane point under the cursor */
        const w = vp.screenToWorld({ x: sx, y: sy });
        const v = worldToView3({ x: w.x, y: w.y, z: 0 });
        vp.scale = clamp(vp.scale * factor, 1e-6, 1e7);
        vp.tx = sx - v.x * vp.scale;
        vp.ty = cssH - sy - v.y * vp.scale;
        return;
      }
      const w = rotW(vp.screenToWorld({ x: sx, y: sy }));
      vp.scale = clamp(vp.scale * factor, 1e-6, 1e7);
      vp.tx = sx - w.x * vp.scale;
      vp.ty = cssH - sy - w.y * vp.scale;
    },

    panBy(dx, dy) { /* dx,dy in screen px */
      if (mspVp) {   /* panning inside an activated viewport moves its view */
        const k = vp.scale * mspVp.scale;
        mspVp.ctr.x -= dx / k;
        mspVp.ctr.y += dy / k;
        return;
      }
      vp.tx += dx;
      vp.ty -= dy;
    },

    zoomExtents() {
      if (mspVp) { Nasj.fitViewport(mspVp); return; }
      if (Nasj.paper) { fitWorldRect(0, 0, SHEET.w, SHEET.h); return; } /* fit the sheet */
      const doc = Nasj.doc;
      if (!doc || !doc.entities.length) { vp.zoomExtentsOrDefault(); return; }
      const vis = visibleEntities(doc);
      const list = vis.length ? vis : doc.entities;
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      let minz = 0, maxz = 0;
      for (const ent of list) {
        /* view-frame boxes when the view is twisted, world boxes otherwise */
        const b = (twist && !view3d.active) ? viewBoxOf(ent) : Nasj.geom.entityBounds(ent);
        if (b.minx < minx) minx = b.minx;
        if (b.miny < miny) miny = b.miny;
        if (b.maxx > maxx) maxx = b.maxx;
        if (b.maxy > maxy) maxy = b.maxy;
        if (view3d.active) {
          const zr = entZRange(ent);
          if (zr[0] < minz) minz = zr[0];
          if (zr[1] > maxz) maxz = zr[1];
        }
      }
      if (!isFinite(minx)) { vp.zoomExtentsOrDefault(); return; }
      if (twist && !view3d.active) { fitViewBox(minx, miny, maxx, maxy); return; }
      fitWorldRect(minx, miny, maxx, maxy, minz, maxz);
    },

    zoomExtentsOrDefault() {
      if (Nasj.paper) { vp.zoomExtents(); return; }
      const doc = Nasj.doc;
      if (doc && doc.entities.length) { vp.zoomExtents(); return; }
      const A = activeRect();
      vp.scale = 1;
      vp.tx = A.x + 70;
      vp.ty = cssH - (A.y + A.h) + 70; /* origin near the tile's bottom-left */
    },

    /* Frame the drawing's dense mass, not its raw extents. A stray entity
       parked megaunits from the content (georeferenced UTM drawings keep
       junk at the origin, and vice versa) makes plain extents show the real
       drawing as a dot. Cluster = 5th..95th percentile of entity-bounds
       centres per axis, grown 2x its span to take in outliers that still
       belong; the cluster only wins when the full extents dwarf it (>4x
       linear) — ordinary drawings frame exactly like zoomExtents. */
    zoomContent() {
      const doc = Nasj.doc;
      if (mspVp || Nasj.paper || view3d.active ||
          !doc || !doc.entities.length) { vp.zoomExtentsOrDefault(); return; }
      /* the cluster sweep, once per revision (see contentRect above) */
      const r = contentRect(doc);
      if (!r || r.none || !isFinite(r.x0)) { vp.zoomExtentsOrDefault(); return; }
      if (twist) { fitViewBox(r.x0, r.y0, r.x1, r.y1); return; }
      fitWorldRect(r.x0, r.y0, r.x1, r.y1);
    },

    zoomWindow(w1, w2) {
      if (mspVp) {
        const r = [Math.min(w1.x, w2.x), Math.min(w1.y, w2.y),
          Math.max(w1.x, w2.x), Math.max(w1.y, w2.y)];
        fitViewportTo(mspVp, r[0], r[1], r[2], r[3]);
        return;
      }
      /* the window was dragged on the SCREEN, so its two corners are a
         rectangle in the view's frame, not in the world's */
      const a = rotW(w1), b = rotW(w2);
      fitViewBox(Math.min(a.x, b.x), Math.min(a.y, b.y),
        Math.max(a.x, b.x), Math.max(a.y, b.y));
    },

    /* The view a file was saved with: centre and height in the view's own
       (possibly twisted) frame — what the industry standard shows on open. Framing this
       instead of refitting extents is what brings a plan up exactly as its
       author left it, sheet filling the canvas, survey grid off-stage. */
    /* the live view, in saved-view terms: what an export should write so
       the file opens elsewhere exactly as it looks here */
    savedView() {
      const A = activeRect();
      const W = A.w || 1600, H = A.h || 900;
      const ctrX = A.x + W / 2, ctrY = A.y + H / 2;
      return {
        twist,
        center: {
          x: (ctrX - vp.tx) / vp.scale,
          y: (cssH - ctrY - vp.ty) / vp.scale
        },
        height: H / vp.scale
      };
    },

    setSavedView(v) {
      vp.twist = (typeof v.twist === 'number') ? v.twist : 0;
      const A = activeRect();
      const W = A.w || 1600, H = A.h || 900;
      if (!(v.height > 0) || !v.center ||
          !isFinite(v.center.x) || !isFinite(v.center.y)) return false;
      const keep = { scale: vp.scale, tx: vp.tx, ty: vp.ty };
      vp.scale = clamp(H / v.height, 1e-6, 1e7);
      const ctrX = A.x + W / 2, ctrY = A.y + H / 2;
      vp.tx = ctrX - v.center.x * vp.scale;
      vp.ty = cssH - ctrY - v.center.y * vp.scale;
      /* Trust, then verify: a view that shows NONE of the drawing is a
         corrupt one (a converter that fit its height to raw extents, a
         hand-edited header), and honoring it opens on empty space. One
         pass over the entities settles it. */
      const doc = Nasj.doc;
      if (doc && doc.entities.length) {
        const b = viewWorldBounds();
        let seen = false;
        for (const ent of doc.entities) {
          const eb = Nasj.geom.entityBounds(ent);
          if (!isFinite(eb.minx)) continue;
          if (eb.maxx >= b.minx && eb.minx <= b.maxx &&
              eb.maxy >= b.miny && eb.miny <= b.maxy) { seen = true; break; }
        }
        if (!seen) {
          vp.scale = keep.scale; vp.tx = keep.tx; vp.ty = keep.ty;
          return false;                    /* caller falls back to a refit */
        }
      }
      return true;
    },

    setFromDoc(doc) {
      if (!doc || !doc.view) return;
      const v = doc.view;
      const n = (x) => typeof x === 'number' && isFinite(x);
      saved2d = null;
      if (n(v.azimuth) && n(v.elevation)) { /* saved 3D view (3D foundation) */
        view3d.active = true;
        view3d.azimuth = v.azimuth;
        view3d.elevation = clamp(v.elevation, -Math.PI / 2, Math.PI / 2);
        if (n(v.distance) && v.distance > 0) view3d.distance = v.distance;
        v3sync();
        vp.worldToScreen = w2s3d;
        vp.screenToWorld = s2w3d;
        viewName = 'custom';
      } else if (view3d.active) { /* 2D doc view: leave 3D mode */
        view3d.active = false;
        view3d.azimuth = 0;
        view3d.elevation = Math.PI / 2;
        v3sync();
        vp.worldToScreen = w2s2d;
        vp.screenToWorld = s2w2d;
        viewName = 'top';
      }
      vp.scale = v.scale > 0 ? v.scale : 1;
      vp.tx = v.tx || 0;
      vp.ty = v.ty || 0;
      vp.twist = n(v.twist) ? v.twist : 0;   /* each drawing its own rotation */
      tilesRecenter();   /* a split space: every tile takes the saved view */
      if (view3d.active) { /* orbit pivot: plane point at the view center */
        const c = vp.screenToWorld({ x: (cssW || 1600) / 2, y: (cssH || 900) / 2 });
        view3d.target = { x: c.x, y: c.y, z: n(v.targetZ) ? v.targetZ : 0 };
      }
      emitView3d();
    },

    saveToDoc(doc) {
      if (!doc) return;
      /* what a document stores is one view for one canvas, so a tile's view
         is written back re-centred on the whole of it — exactly what
         setFromDoc hands out again */
      const v = tiled() ? shiftView({ scale: vp.scale, tx: vp.tx, ty: vp.ty },
        activeRect(), { x: 0, y: 0, w: cssW, h: cssH }) : vp;
      doc.view = { scale: v.scale, tx: v.tx, ty: v.ty };
      if (twist) doc.view.twist = twist;   /* the saved view's rotation */
      if (view3d.active) { /* optional 3D fields (additive, 3D foundation) */
        doc.view.azimuth = view3d.azimuth;
        doc.view.elevation = view3d.elevation;
        doc.view.distance = view3d.distance;
        doc.view.targetZ = view3d.target.z || 0;
      }
    }
  };

  const fitWorldRect = (minx, miny, maxx, maxy, minz, maxz) => {
    /* the current tile is what a zoom fits into — the whole canvas when
       model space is not split */
    const A = activeRect();
    const W = A.w || 1600, H = A.h || 900;
    const margin = Math.min(40, W / 6, H / 6);
    const ctrX = A.x + W / 2, ctrY = A.y + H / 2;
    if (view3d.active) { /* fit the projected corners of the world box */
      const z0 = isFinite(minz) ? minz : 0, z1 = isFinite(maxz) ? maxz : 0;
      let vx0 = Infinity, vy0 = Infinity, vx1 = -Infinity, vy1 = -Infinity;
      for (const x of [minx, maxx]) {
        for (const y of [miny, maxy]) {
          for (const z of (z0 === z1 ? [z0] : [z0, z1])) {
            const v = worldToView3({ x, y, z });
            if (v.x < vx0) vx0 = v.x;
            if (v.y < vy0) vy0 = v.y;
            if (v.x > vx1) vx1 = v.x;
            if (v.y > vy1) vy1 = v.y;
          }
        }
      }
      let w = vx1 - vx0, h = vy1 - vy0;
      if (w < 1e-9 && h < 1e-9) { w = h = 20; }
      else { w = Math.max(w, 1e-9); h = Math.max(h, 1e-9); }
      const scale = clamp(Math.min((W - 2 * margin) / w, (H - 2 * margin) / h), 1e-6, 1e7);
      vp.scale = scale;
      vp.tx = ctrX - (vx0 + vx1) / 2 * scale;
      vp.ty = cssH - ctrY - (vy0 + vy1) / 2 * scale;
      /* keep the orbit pivot at the new view center */
      const c = vp.screenToWorld({ x: ctrX, y: ctrY });
      view3d.target.x = c.x;
      view3d.target.y = c.y;
      return;
    }
    /* a twisted view frames what the SCREEN will hold, so the rectangle is
       measured after the turn — the four corners, since a turned rectangle
       is not one */
    let vx0 = minx, vy0 = miny, vx1 = maxx, vy1 = maxy;
    if (twist) {
      vx0 = vy0 = Infinity; vx1 = vy1 = -Infinity;
      for (const x of [minx, maxx]) {
        for (const y of [miny, maxy]) {
          const r = rotW({ x, y });
          if (r.x < vx0) vx0 = r.x;
          if (r.y < vy0) vy0 = r.y;
          if (r.x > vx1) vx1 = r.x;
          if (r.y > vy1) vy1 = r.y;
        }
      }
    }
    fitViewRect(vx0, vy0, vx1, vy1, W, H, margin, ctrX, ctrY);
  };

  /* fit a rectangle already expressed in the view's own frame */
  const fitViewRect = (vx0, vy0, vx1, vy1, W, H, margin, ctrX, ctrY) => {
    let w = vx1 - vx0, h = vy1 - vy0;
    if (w < 1e-9 && h < 1e-9) { w = h = 20; } /* degenerate: zoom on the point */
    else { w = Math.max(w, 1e-9); h = Math.max(h, 1e-9); }
    const scale = clamp(Math.min((W - 2 * margin) / w, (H - 2 * margin) / h), 1e-6, 1e7);
    const cx = (vx0 + vx1) / 2, cy = (vy0 + vy1) / 2;
    vp.scale = scale;
    vp.tx = ctrX - cx * scale;
    vp.ty = cssH - ctrY - cy * scale;
  };

  /* fit a view-frame rectangle into the active tile */
  const fitViewBox = (vx0, vy0, vx1, vy1) => {
    const A = activeRect();
    const W = A.w || 1600, H = A.h || 900;
    fitViewRect(vx0, vy0, vx1, vy1, W, H,
      Math.min(40, W / 6, H / 6), A.x + W / 2, A.y + H / 2);
  };

  /* The view-frame box of an entity, measured from the geometry rather
     than from its world box. Turning a box GROWS it — a plan drawn at 45°
     measured that way comes out square and frames with half the canvas
     empty — so the shapes that carry their own points give them, and a
     circle gives its centre and radius, which no rotation changes. Only
     the shapes with neither fall back to turning the four corners. */
  const viewBoxOf = (ent) => {
    const b = Nasj.geom.entityBounds(ent);
    if (!twist) return b;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    const add = (x, y, r) => {
      const q = rotW({ x, y });
      const k = r || 0;
      if (q.x - k < minx) minx = q.x - k;
      if (q.y - k < miny) miny = q.y - k;
      if (q.x + k > maxx) maxx = q.x + k;
      if (q.y + k > maxy) maxy = q.y + k;
    };
    switch (ent.type) {
      case 'line':
        add(ent.a.x, ent.a.y); add(ent.b.x, ent.b.y);
        break;
      case 'polyline': case 'spline': case 'leader':
        for (const p of (ent.pts || [])) add(p.x, p.y);
        break;
      case 'circle': case 'arc':
        add(ent.c.x, ent.c.y, ent.r);
        break;
      case 'ellipse':
        add(ent.c.x, ent.c.y, Math.max(ent.rx || 0, ent.ry || 0));
        break;
      case 'point': case 'text': case 'attdef':
        add(ent.p.x, ent.p.y, (b.maxx - b.minx + b.maxy - b.miny) / 4);
        break;
      default:
        for (const x of [b.minx, b.maxx]) for (const y of [b.miny, b.maxy]) add(x, y);
    }
    return isFinite(minx) ? { minx, miny, maxx, maxy } : b;
  };

  /* ---------------- 3D view machinery (3D foundation) ---------------- */
  /* the exact pre-3D 2D mappings, restored whenever view3d is inactive */
  const w2s2d = vp.worldToScreen;
  const s2w2d = vp.screenToWorld;

  /* MSPACE: model coordinates, reached through the activated viewport */
  const w2sMsp = (p) => w2s2d(mToP(mspVp, p));
  const s2wMsp = (s) => pToM(mspVp, s2w2d(s));

  /* fit a model rectangle into a viewport's frame */
  const fitViewportTo = (v, minx, miny, maxx, maxy) => {
    let w = maxx - minx, h = maxy - miny;
    if (w < 1e-9 && h < 1e-9) { w = h = 20; }
    else { w = Math.max(w, 1e-9); h = Math.max(h, 1e-9); }
    v.scale = clamp(Math.min(v.w / w, v.h / h) * 0.92, 1e-9, 1e9);
    v.ctr = { x: (minx + maxx) / 2, y: (miny + maxy) / 2 };
  };
  /* ZOOM Extents inside a viewport: the drawing, framed */
  Nasj.fitViewport = (v) => {
    const doc = Nasj.doc;
    const list = doc ? modelEnts(doc) : [];
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    if (doc) {
      const m = layerMap(doc);
      for (const ent of list) {
        if (!entVisible(ent, m)) continue;
        const b = Nasj.geom.entityBounds(ent);
        if (b.minx < minx) minx = b.minx;
        if (b.miny < miny) miny = b.miny;
        if (b.maxx > maxx) maxx = b.maxx;
        if (b.maxy > maxy) maxy = b.maxy;
      }
    }
    if (!isFinite(minx)) { minx = -50; miny = -50; maxx = 50; maxy = 50; }
    fitViewportTo(v, minx, miny, maxx, maxy);
  };

  /* the layout's viewports; a fresh sheet gets the industry standard's single frame,
     inset from the paper edge and already framing the drawing */
  Nasj.layoutViewports = () => {
    const L = layoutRec();
    if (!L) return [];
    if (!L.viewports.length) {
      const i = SHEET.vpInset;
      const v = { x: i, y: i, w: SHEET.w - 2 * i, h: SHEET.h - 2 * i, ctr: { x: 0, y: 0 }, scale: 1 };
      Nasj.fitViewport(v);
      L.viewports.push(v);
    }
    return L.viewports;
  };
  /* the frame a sheet point falls inside, or null out on the bare paper */
  Nasj.viewportAt = (p) => Nasj.layoutViewports().find((v) =>
    p.x >= v.x && p.x <= v.x + v.w && p.y >= v.y && p.y <= v.y + v.h) || null;
  /* where a frame sits on screen right now — the chrome follows it */
  Nasj.viewportScreenRect = (v) => {
    const a = w2s2d({ x: v.x, y: v.y + v.h });      /* top-left on screen */
    const b = w2s2d({ x: v.x + v.w, y: v.y });      /* bottom-right */
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  };
  /* the sheet point under a screen point, whichever space is active */
  Nasj.screenToSheet = (s) => s2w2d(s);
  Nasj.paperVp = () => mspVp;
  /* screen pixels per world unit — inside a viewport the sheet's zoom and the
     frame's scale multiply, and every pick box and snap radius rides on it */
  Nasj.worldScale = () => vp.scale * (mspVp ? mspVp.scale : 1);
  /* activate a viewport (MSPACE) or hand the pointer back to the sheet */
  Nasj.setPaperVp = (v) => {
    mspVp = v || null;
    paperFrameSig = '';                 /* the chrome re-places on the next frame */
    vp.worldToScreen = mspVp ? w2sMsp : (view3d.active ? w2s3d : w2s2d);
    vp.screenToWorld = mspVp ? s2wMsp : (view3d.active ? s2w3d : s2w2d);
  };

  /* ---------------- tiled model viewports (VPORTS) ----------------
   * the industry standard splits MODEL space into tiles, each holding its own view of the
   * one drawing, one of them current. A tile here is nothing but a fraction
   * of the drawing area plus a {scale,tx,ty} in the same screen space vp
   * uses — so every existing drawing path renders into one untouched, and
   * the current tile's view IS vp. `tiles` null = the single viewport. */
  const VPORT_LAYOUTS = {     /* [x, y, w, h] fractions, y down; first = current */
    single: [[0, 0, 1, 1]],
    '2v': [[0, 0, .5, 1], [.5, 0, .5, 1]],
    '2h': [[0, 0, 1, .5], [0, .5, 1, .5]],
    '3r': [[.5, 0, .5, 1], [0, 0, .5, .5], [0, .5, .5, .5]],
    '3l': [[0, 0, .5, 1], [.5, 0, .5, .5], [.5, .5, .5, .5]],
    '3a': [[0, 0, 1, .5], [0, .5, .5, .5], [.5, .5, .5, .5]],
    '3b': [[0, .5, 1, .5], [0, 0, .5, .5], [.5, 0, .5, .5]],
    '3v': [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]],
    '3h': [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]],
    '4e': [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]],
    '4r': [[.5, 0, .5, 1], [0, 0, .5, 1 / 3], [0, 1 / 3, .5, 1 / 3], [0, 2 / 3, .5, 1 / 3]],
    '4l': [[0, 0, .5, 1], [.5, 0, .5, 1 / 3], [.5, 1 / 3, .5, 1 / 3], [.5, 2 / 3, .5, 1 / 3]]
  };
  let tiles = null;          /* [{f:[x,y,w,h], view:{scale,tx,ty}}] */
  let tileActive = 0;
  let tileKey = 'single';

  /* whole pixels, and the far edge derived from the far fraction — halves of
     an odd width must still meet, with no seam and no overlap */
  const tileRect = (t) => {
    const x = Math.round(t.f[0] * cssW), y = Math.round(t.f[1] * cssH);
    return { x, y,
      w: Math.round((t.f[0] + t.f[2]) * cssW) - x,
      h: Math.round((t.f[1] + t.f[3]) * cssH) - y };
  };
  /* tiles split MODEL space; a layout draws its own frames and vp is the
     sheet's, so the split sits out every paper-space pass and comes back
     with the Model tab */
  const tiled = () => !!tiles && !Nasj.paper;
  const activeRect = () => (tiled() ? tileRect(tiles[tileActive])
    : { x: 0, y: 0, w: cssW, h: cssH });
  const tileSave = () => {
    if (tiles) tiles[tileActive].view = { scale: vp.scale, tx: vp.tx, ty: vp.ty };
  };
  const tileLoad = () => {
    if (!tiles) return;
    const v = tiles[tileActive].view;
    vp.scale = v.scale; vp.tx = v.tx; vp.ty = v.ty;
  };
  /* the same view, re-centred from one rectangle onto another: tx/ty are a
     screen translation whichever projection is in play, so a split hands
     every tile what the viewport was showing, centred on itself */
  const shiftView = (v, from, to) => ({
    scale: v.scale,
    tx: v.tx + (to.x + to.w / 2) - (from.x + from.w / 2),
    ty: v.ty - ((to.y + to.h / 2) - (from.y + from.h / 2))
  });
  /* a document's saved view is one view for one canvas; when tiles are up,
     each of them takes it, re-centred on itself */
  const tilesRecenter = () => {
    if (!tiled()) return;
    const from = { x: 0, y: 0, w: cssW, h: cssH };
    const cur = { scale: vp.scale, tx: vp.tx, ty: vp.ty };
    tiles.forEach((t) => { t.view = shiftView(cur, from, tileRect(t)); });
    tileActive = 0;
    tileLoad();
  };
  /* the drawing area changed size: every tile keeps what it was showing,
     re-centred on where it has moved to. tx is a plain screen translation;
     ty is measured from the bottom, so it takes the height change too. */
  const tilesResize = (before, oldH) => {
    if (!tiled() || !before || before.length !== tiles.length) return;
    tileSave();
    tiles.forEach((t, i) => {
      const o = before[i], n = tileRect(t);
      t.view = {
        scale: t.view.scale,
        tx: t.view.tx + (n.x + n.w / 2) - (o.x + o.w / 2),
        ty: t.view.ty + (cssH - oldH) - ((n.y + n.h / 2) - (o.y + o.h / 2))
      };
    });
    tileLoad();
  };
  const emitVports = () => Nasj.emit('nasj:vports',
    { key: tileKey, count: tiles ? tiles.length : 1, active: tileActive });
  const vportsChanged = () => {
    Nasj.render();
    Nasj.renderOverlay();
    emitVports();
  };

  Nasj.vports = {
    keys: () => Object.keys(VPORT_LAYOUTS),
    key: () => tileKey,
    count: () => (tiles ? tiles.length : 1),
    active: () => tileActive,
    activeRect,
    rect: (i) => (tiles && tiles[i] ? tileRect(tiles[i]) : { x: 0, y: 0, w: cssW, h: cssH }),
    /* the tile a screen point falls in, or -1 when there is only the one */
    at(s) {
      if (!tiles) return -1;
      for (let i = 0; i < tiles.length; i++) {
        const R = tileRect(tiles[i]);
        if (s.x >= R.x && s.x <= R.x + R.w && s.y >= R.y && s.y <= R.y + R.h) return i;
      }
      return -1;
    },
    /* split model space into a named configuration ('single' joins it back) */
    set(key) {
      const L = VPORT_LAYOUTS[key];
      if (!L) return false;
      const from = activeRect();
      const cur = { scale: vp.scale, tx: vp.tx, ty: vp.ty };
      tileKey = key;
      if (L.length === 1) {
        tiles = null;
        tileActive = 0;
        const v = shiftView(cur, from, { x: 0, y: 0, w: cssW, h: cssH });
        vp.scale = v.scale; vp.tx = v.tx; vp.ty = v.ty;
      } else {
        tiles = L.map((f) => ({ f, view: cur }));
        tiles.forEach((t) => { t.view = shiftView(cur, from, tileRect(t)); });
        tileActive = 0;
        tileLoad();
      }
      vportsChanged();
      return true;
    },
    /* make a tile current: its view becomes vp, and the pointer draws in it */
    setActive(i) {
      if (!tiles || !tiles[i] || i === tileActive) return false;
      tileSave();
      tileActive = i;
      tileLoad();
      vportsChanged();
      return true;
    }
  };

  /* THE CAMERA, restructured on descriptive-geometry lines: one basis —
     d toward the eye, r across the screen, u up it — and every mapping is
     a projection along d (orthographic) or through the eye (perspective).
     Perspective scales a point's view coordinates about the TARGET by
     dist/w, its depth from the eye: at the target plane the two modes
     agree exactly, so toggling PERSPECTIVE never jumps the picture. */
  const camBasis = () => ({
    d: [v3sA * v3cE, -v3cA * v3cE, v3sE],   /* toward the eye   */
    r: [v3cA, v3sA, 0],                     /* screen right     */
    u: [-v3sA * v3sE, v3cA * v3sE, v3cE],   /* screen up        */
  });
  const dot3 = (a, x, y, z) => a[0] * x + a[1] * y + a[2] * z;
  const w2s3d = (p) => {
    if (!view3d.persp) {
      const v = worldToView3(p);
      return { x: v.x * vp.scale + vp.tx, y: cssH - (v.y * vp.scale + vp.ty) };
    }
    const { d, r, u } = camBasis();
    const T = view3d.target, dist = view3d.distance > 0 ? view3d.distance : 1000;
    const z = (typeof p.z === 'number' && isFinite(p.z)) ? p.z : 0;
    const ex = T.x + d[0] * dist, ey = T.y + d[1] * dist, ez = (T.z || 0) + d[2] * dist;
    const px = p.x - ex, py = p.y - ey, pz = z - ez;
    /* depth from the eye; a point at or behind it is clamped just in
       front, so geometry passing the camera distorts instead of exploding */
    let w = -dot3(d, px, py, pz);
    if (w < dist * 1e-3) w = dist * 1e-3;
    const k = dist / w;
    const U = dot3(r, T.x, T.y, T.z || 0) + dot3(r, px, py, pz) * k;
    const V = dot3(u, T.x, T.y, T.z || 0) + dot3(u, px, py, pz) * k;
    const x = U * v3cR - V * v3sR, y = U * v3sR + V * v3cR;   /* roll */
    return { x: x * vp.scale + vp.tx, y: cssH - (y * vp.scale + vp.ty) };
  };

  /* picking in 3D: the point on the CONSTRUCTION PLANE under the screen
     position. On the ground plane this is the closed form it always was.
     On a standing plane the projection is solved instead: a point there is
     O + a·U + b·V, the projection is affine in a and b, and the screen
     position gives two equations for those two unknowns. A plane seen
     edge-on has no solution — the determinant vanishes — and the ground
     answer stands in, which is the only sensible thing to pick when the
     plane you are drawing on is a line on screen. */
  const s2wPlane = (p) => {
    const rx = (p.x - vp.tx) / vp.scale;
    const ry = (cssH - p.y - vp.ty) / vp.scale;
    const vx = rx * v3cR + ry * v3sR;
    const vy = -rx * v3sR + ry * v3cR;
    const y1 = Math.abs(v3sE) > 1e-9 ? vy / v3sE : 0;
    return { x: vx * v3cA - y1 * v3sA, y: vx * v3sA + y1 * v3cA };
  };
  /* the two view axes the projection measures along, in world terms */
  const viewU = () => [v3cA, v3sA, 0];
  const viewV = () => [-v3sA * v3sE, v3cA * v3sE, v3cE];
  /* Picking is descriptive geometry proper: the pixel becomes a RAY — the
     projector through that pixel — and the picked point is the ray's trace
     on the construction plane. Orthographic projectors are parallel to the
     view axis; perspective projectors fan out of the eye. One intersection
     serves every case. The orthographic ground pick keeps its closed form,
     byte-identical to what every drawing so far was made with. */
  /* the world point under a pixel on the level plane at height z — the
     plane a raised point's next pick lies in, as AutoCAD tracks it: the
     same ray as the ground mapping, met at that height instead */
  Nasj.screenToWorldAtZ = (p, z) => {
    const w0 = vp.screenToWorld(p);
    if (!view3d.active || !(Math.abs(z) > 1e-12)) return { x: w0.x, y: w0.y, z: z || 0 };
    const { d } = camBasis();
    if (view3d.persp) {
      const T = view3d.target, dist = view3d.distance > 0 ? view3d.distance : 1000;
      const ex = T.x + d[0] * dist, ey = T.y + d[1] * dist, ez = (T.z || 0) + d[2] * dist;
      if (Math.abs(ez) < 1e-9) return { x: w0.x, y: w0.y, z };
      const s = (z - ez) / (0 - ez);
      return { x: ex + s * (w0.x - ex), y: ey + s * (w0.y - ey), z };
    }
    if (Math.abs(d[2]) < 1e-9) return { x: w0.x, y: w0.y, z };
    const t = z / d[2];
    return { x: w0.x + t * d[0], y: w0.y + t * d[1], z };
  };
  const s2w3d = (p) => {
    const standing = !!(Nasj.ucs && Nasj.ucs.plane);
    if (!standing && !view3d.persp) return s2wPlane(p);
    const { d, r, u } = camBasis();
    const T = view3d.target, dist = view3d.distance > 0 ? view3d.distance : 1000;
    const Tz = T.z || 0;
    /* the pixel in view coordinates, roll undone */
    const rx = (p.x - vp.tx) / vp.scale;
    const ry = (cssH - p.y - vp.ty) / vp.scale;
    const U = rx * v3cR + ry * v3sR;
    const V = -rx * v3sR + ry * v3cR;
    /* the ray: through the point of the target plane under the pixel */
    const du = U - dot3(r, T.x, T.y, Tz);
    const dv = V - dot3(u, T.x, T.y, Tz);
    const qx = T.x + du * r[0] + dv * u[0];
    const qy = T.y + du * r[1] + dv * u[1];
    const qz = Tz + du * r[2] + dv * u[2];
    let ox, oy, oz, vx, vy, vz;
    if (view3d.persp) {
      ox = T.x + d[0] * dist; oy = T.y + d[1] * dist; oz = Tz + d[2] * dist;
      vx = qx - ox; vy = qy - oy; vz = qz - oz;
    } else {
      ox = qx; oy = qy; oz = qz;
      vx = -d[0]; vy = -d[1]; vz = -d[2];
    }
    /* the plane: the construction plane standing, or the ground */
    const O = standing ? ucsOrigin() : { x: 0, y: 0, z: 0 };
    const N = standing ? ucsNormal() : [0, 0, 1];
    const den = N[0] * vx + N[1] * vy + N[2] * vz;
    if (Math.abs(den) < 1e-9 * Math.hypot(vx, vy, vz)) return s2wPlane(p);
    const t = (N[0] * (O.x - ox) + N[1] * (O.y - oy) + N[2] * ((O.z || 0) - oz)) / den;
    const wx = ox + vx * t, wy = oy + vy * t, wz = oz + vz * t;
    return standing ? { x: wx, y: wy, z: wz } : { x: wx, y: wy };
  };

  /* The projector through a pixel as a world-space ray {o, v} — the same
     construction s2w3d intersects with the construction plane, handed out
     whole so face picking (SOLIDEDIT) can run it against each face's own
     plane instead. In the 2D plan view the projector is the vertical
     through the picked point. `persp` tells the caller whether hits
     behind the ray origin are real (orthographic) or behind the eye. */
  Nasj.pickRay = (p) => {
    if (!view3d.active) {
      const w = vp.screenToWorld(p);
      return { o: [w.x, w.y, 1e9], v: [0, 0, -1], persp: false };
    }
    const { d, r, u } = camBasis();
    const T = view3d.target, dist = view3d.distance > 0 ? view3d.distance : 1000;
    const Tz = T.z || 0;
    const rx = (p.x - vp.tx) / vp.scale;
    const ry = (cssH - p.y - vp.ty) / vp.scale;
    const U = rx * v3cR + ry * v3sR;
    const V = -rx * v3sR + ry * v3cR;
    const du = U - dot3(r, T.x, T.y, Tz);
    const dv = V - dot3(u, T.x, T.y, Tz);
    const qx = T.x + du * r[0] + dv * u[0];
    const qy = T.y + du * r[1] + dv * u[1];
    const qz = Tz + du * r[2] + dv * u[2];
    if (view3d.persp) {
      const ox = T.x + d[0] * dist, oy = T.y + d[1] * dist, oz = Tz + d[2] * dist;
      return { o: [ox, oy, oz], v: [qx - ox, qy - oy, qz - oz], persp: true };
    }
    return { o: [qx, qy, qz], v: [-d[0], -d[1], -d[2]], persp: false };
  };

  /* the heights a block definition's children reach, in definition
     coordinates — a reference carries them unscaled, so they are its own */
  const defZCache = new WeakMap();
  const defZRange = (doc, name, seen) => {
    const def = doc && doc.blocks && doc.blocks[name];
    if (!def || !Array.isArray(def.entities)) return [0, 0];
    const hit = defZCache.get(def.entities);
    if (hit) return hit;
    seen = seen || new Set();
    if (seen.has(name)) return [0, 0];
    seen.add(name);
    let z0 = 0, z1 = 0;
    for (const c of def.entities) {
      if (!c) continue;
      const r = c.type === 'insert' ? defZRange(doc, c.name, seen) : entZRange(c);
      if (r[0] < z0) z0 = r[0];
      if (r[1] > z1) z1 = r[1];
    }
    const out = [z0, z1];
    defZCache.set(def.entities, out);
    return out;
  };
  /* an entity's heights, remembered per revision — a wall's come from its
     faces, which are not rebuilt for every frame */
  const zRangeCache = new WeakMap();
  const zRangeOf = (ent) => {
    const hit = zRangeCache.get(ent);
    if (hit && hit.rev === docRev) return hit.r;
    const r = entZRange(ent);
    zRangeCache.set(ent, { rev: docRev, r });
    return r;
  };
  /* the screen box an entity's 3D box projects to: its plan bounds at the
     two heights it spans, through the live projection */
  const pad3 = 8;
  const screenBox3 = (ent) => {
    const b = boundsOf(ent);
    const zr = ent.type === 'insert' ? defZRange(Nasj.doc, ent.name) : zRangeOf(ent);
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    const take = (x, y, z) => {
      const s = vp.worldToScreen({ x, y, z });
      if (s.x < minx) minx = s.x;
      if (s.x > maxx) maxx = s.x;
      if (s.y < miny) miny = s.y;
      if (s.y > maxy) maxy = s.y;
    };
    const zs = zr[0] === zr[1] ? [zr[0]] : [zr[0], zr[1]];
    for (const z of zs) {
      take(b.minx, b.miny, z); take(b.maxx, b.miny, z);
      take(b.maxx, b.maxy, z); take(b.minx, b.maxy, z);
    }
    return { minx, miny, maxx, maxy };
  };

  /* conservative z-range of an entity (world units) for zoom-extents in 3D */
  const entZRange = (ent) => {
    let z0 = 0, z1 = 0;
    const zof = (p) => (p && typeof p.z === 'number' && isFinite(p.z)) ? p.z : 0;
    const acc = (z) => { if (z < z0) z0 = z; if (z > z1) z1 = z; };
    if (Nasj.solid.isBody(ent)) {
      const r = Nasj.solid.zRange(ent);
      acc(r[0]);
      acc(r[1]);
    } else if (ent.type === 'insert') { /* the heights its definition reaches */
      const r = defZRange(Nasj.doc, ent.name);
      acc(r[0] + zof(ent.p));
      acc(r[1] + zof(ent.p));
    } else if (Array.isArray(ent.pts)) {
      for (const p of ent.pts) acc(zof(p));
    } else {
      if (ent.a) acc(zof(ent.a));
      if (ent.b) acc(zof(ent.b));
    }
    return [z0, z1];
  };

  const emitView3d = () => {
    view3d.viewName = view3d.active ? viewName : 'top';
    Nasj.emit('nasj:view3d', {
      active: view3d.active,
      azimuth: view3d.azimuth,
      elevation: view3d.elevation,
      view: view3d.viewName,
      target: { x: view3d.target.x, y: view3d.target.y, z: view3d.target.z },
      distance: view3d.distance
    });
  };

  /* enter 3D at the top orientation (projects identically to the 2D
     transform, so activation is visually seamless); remembers the 2D
     transform so setView('top') can restore it exactly */
  const activate3d = () => {
    if (view3d.active) return true;
    if (Nasj.paper) return false; /* paper-space preview stays 2D */
    saved2d = { scale: vp.scale, tx: vp.tx, ty: vp.ty };
    const c = s2w2d({ x: (cssW || 1600) / 2, y: (cssH || 900) / 2 });
    view3d.target = { x: c.x, y: c.y, z: 0 };
    view3d.azimuth = 0;
    view3d.elevation = Math.PI / 2;
    view3d.roll = 0;
    view3d.active = true;
    v3sync();
    vp.worldToScreen = w2s3d;
    vp.screenToWorld = s2w3d;
    return true;
  };

  const deactivate3d = () => {
    if (!view3d.active) return;
    view3d.active = false;
    view3d.azimuth = 0;
    view3d.elevation = Math.PI / 2;
    view3d.roll = 0;
    v3sync();
    vp.worldToScreen = w2s2d;
    vp.screenToWorld = s2w2d;
    if (saved2d) { /* exact pre-activation 2D transform */
      vp.scale = saved2d.scale;
      vp.tx = saved2d.tx;
      vp.ty = saved2d.ty;
      saved2d = null;
    }
  };

  /* re-orient about the target; its screen position is held fixed */
  const setOrientation = (az, el, roll) => {
    const t = view3d.target;
    const s0 = w2s3d(t);
    view3d.azimuth = az;
    view3d.elevation = el;
    if (roll !== undefined) view3d.roll = roll;
    v3sync();
    const s1 = w2s3d(t);
    vp.tx += s0.x - s1.x;
    vp.ty -= s0.y - s1.y;
  };

  const normAz = (a) => { /* wrap into (−π, π] */
    a %= TAU;
    if (a > Math.PI) a -= TAU;
    if (a < -Math.PI) a += TAU;
    return a;
  };

  const VIEW_PRESETS = {
    bottom: { az: 0, el: -Math.PI / 2 },
    front: { az: 0, el: 0 },
    back: { az: Math.PI, el: 0 },
    right: { az: Math.PI / 2, el: 0 },
    left: { az: -Math.PI / 2, el: 0 },
    swiso: { az: -Math.PI / 4, el: ISO_EL },
    seiso: { az: Math.PI / 4, el: ISO_EL },
    neiso: { az: 3 * Math.PI / 4, el: ISO_EL },
    nwiso: { az: -3 * Math.PI / 4, el: ISO_EL }
  };

  /* Nasj.setView('top'|'bottom'|'front'|'back'|'left'|'right'|
     'swiso'|'seiso'|'neiso'|'nwiso') — 'top' returns to pure 2D mode. */
  /* UCSORTHO, on as the industry standard ships it: choosing an orthographic view turns
     the construction plane to FACE it, so drawing in a front view lands on
     the plane being looked at instead of skewing onto the invisible ground.
     This is what connects the axes: Front and Back stand the XZ plane up,
     Left and Right the ZY one, Top and Bottom lay it back down. The
     isometric views leave the plane alone, exactly as the industry standard's do. */
  const UCS_ORTHO_VIEW = {
    top: 'world', bottom: 'world',
    front: 'front', back: 'back', left: 'left', right: 'right',
  };
  Nasj.setView = (name) => {
    const key = String(name == null ? '' : name).toLowerCase();
    if (key === 'top') {
      deactivate3d();
      viewName = 'top';
    } else {
      const pv = VIEW_PRESETS[key];
      if (!pv) return false;
      if (!activate3d()) return false;
      setOrientation(pv.az, pv.el, 0);
      viewName = key;
      /* a preset view is a parallel projection, as AutoCAD's are: a body
         seen from the Left shows its true outline, not a vanishing one */
      view3d.persp = false;
    }
    if (UCS_ORTHO_VIEW[key] && Nasj.ucsPlane) Nasj.ucsPlane.set(UCS_ORTHO_VIEW[key]);
    Nasj.render();
    emitView3d();
    return true;
  };

  /* PERSPECTIVE on or off. The eye stands back from the target by the
     height of the current view, so the vanishing is visible but gentle —
     the industry standard's default feel — and because the two projections agree at the
     target plane, the toggle deepens the picture without jumping it. */
  Nasj.setPerspective = (on) => {
    if (!view3d.active) return false;
    const want = !!on;
    if (want === !!view3d.persp) return true;
    if (want) {
      const worldH = (cssH || 900) / (vp.scale || 1);
      view3d.distance = Math.max(worldH * 1.5, 1e-6);
    }
    view3d.persp = want;
    Nasj.render();
    emitView3d();
    if (Nasj.renderOverlay) Nasj.renderOverlay();
    return true;
  };

  /* ViewCube curved arrows: spin the view 90° about the vertical axis (in
     the plan view this reads as rotating the drawing / compass on screen) */
  Nasj.rollView = (delta) => {
    if (!view3d.active && !activate3d()) return false;
    setOrientation(normAz(view3d.azimuth + delta), view3d.elevation);
    viewName = 'custom';
    Nasj.render();
    emitView3d();
    if (Nasj.renderOverlay) Nasj.renderOverlay();
    return true;
  };

  /* Free orientation for the interactive ViewCube (drag-orbit and edge/
     corner picks). Labels the view with the matching preset name if any. */
  Nasj.orientView = (az, el, roll) => {
    if (!view3d.active && !activate3d()) return false;
    az = normAz(az);
    el = clamp(el, -Math.PI / 2, Math.PI / 2);
    setOrientation(az, el, roll);
    viewName = 'custom';
    for (const [key, pv] of Object.entries(VIEW_PRESETS)) {
      if (Math.abs(normAz(az - pv.az)) < 1e-6 && Math.abs(el - pv.el) < 1e-6) {
        viewName = key;
        break;
      }
    }
    Nasj.render();
    emitView3d();
    if (Nasj.renderOverlay) Nasj.renderOverlay();
    return true;
  };

  /* ---------------- named views (SPEC3 §23) ---------------- */
  /* Save the current viewport into doc.views under `name` (replace same
     name). A 3D view keeps its whole camera — orientation, perspective,
     target — and opts.layers snapshots which layers are on/frozen, the
     View Manager's "layer snapshot with view". */
  Nasj.viewSave = (doc, name, opts) => {
    if (!doc || name == null || String(name) === '') return null;
    if (!Array.isArray(doc.views)) doc.views = [];
    const v = { name: String(name), scale: vp.scale, tx: vp.tx, ty: vp.ty };
    if (view3d.active) {
      v.vp3 = {
        az: view3d.azimuth, el: view3d.elevation, roll: view3d.roll || 0,
        persp: !!view3d.persp, dist: view3d.distance,
        target: { x: view3d.target.x, y: view3d.target.y, z: view3d.target.z || 0 },
      };
    }
    if (opts && opts.layers) {
      v.layers = doc.layers.map((l) => ({ id: l.id, on: !!l.on, frozen: !!l.frozen }));
    }
    const i = doc.views.findIndex(x => x && x.name === v.name);
    if (i >= 0) doc.views[i] = v; else doc.views.push(v);
    doc.modified = true;
    return v;
  };

  /* Restore a named view into the viewport; returns true when found. A view
     saved with a 3D camera brings it back; one saved flat returns to plan,
     so the pan/zoom it kept means what it meant. A layer snapshot, when the
     view carries one, turns the layers back to how they were saved. */
  Nasj.viewRestore = (doc, name) => {
    if (!doc || !Array.isArray(doc.views)) return false;
    const v = doc.views.find(x => x && x.name === String(name));
    if (!v || !(v.scale > 0)) return false;
    if (v.vp3) {
      if (!view3d.active && !activate3d()) return false;
      setOrientation(v.vp3.az, v.vp3.el, v.vp3.roll || 0);
      view3d.persp = !!v.vp3.persp;
      if (v.vp3.dist > 0) view3d.distance = v.vp3.dist;
      if (v.vp3.target) {
        view3d.target = { x: v.vp3.target.x || 0, y: v.vp3.target.y || 0,
          z: v.vp3.target.z || 0 };
      }
      viewName = 'custom';
    } else if (view3d.active) {
      deactivate3d();
      viewName = 'top';
    }
    vp.scale = clamp(v.scale, 1e-6, 1e7);
    vp.tx = isFinite(v.tx) ? v.tx : 0;
    vp.ty = isFinite(v.ty) ? v.ty : 0;
    if (Array.isArray(v.layers) && Array.isArray(doc.layers)) {
      for (const rec of v.layers) {
        const ly = doc.layers.find((l) => l.id === rec.id);
        if (ly) { ly.on = !!rec.on; ly.frozen = !!rec.frozen; }
      }
      Nasj.emit('nasj:doc', { doc });
    }
    emitView3d();
    Nasj.render();
    return true;
  };

  /* a preset's camera angles, for the View Manager's property grid */
  Nasj.viewPresetAngles = (key) => {
    if (key === 'top') return { az: 0, el: Math.PI / 2 };
    const pv = VIEW_PRESETS[String(key || '').toLowerCase()];
    return pv ? { az: pv.az, el: pv.el } : null;
  };

  /* ---------------- shared helpers ---------------- */
  /* CACHED on the layer ARRAY and the revision. The map holds the layer
     OBJECTS, so every property a caller reads through it — on, frozen,
     locked, colour, lineweight — is already live; only adding or removing
     a layer makes a different map, and every path that does either emits
     a doc event (the revision moves). Nobody writes to it. A full scene
     pass over a block library rebuilt this 738-entry map once per slice,
     121 times, for an answer that never differed. */
  let lmapCache = { arr: null, rev: -1, n: -1, m: null };
  const layerMap = (doc) => {
    const arr = doc.layers;
    const c = lmapCache;
    if (c.m && c.arr === arr && c.rev === docRev && c.n === arr.length) return c.m;
    const m = new Map();
    for (const l of arr) m.set(l.id, l);
    lmapCache = { arr, rev: docRev, n: arr.length, m };
    return m;
  };

  const layerVisible = (ly) => !ly || (ly.on && !ly.frozen);

  /* Object isolation (ISOLATEOBJECTS / HIDEOBJECTS): ids hidden for the
     SESSION, over and above layer state — the industry standard's default isolation is
     per-session too, so nothing of it is written to the document. The set
     is shared with tools.js, whose hit-testing honours it; the bump
     invalidates the static-scene cache, which is keyed on signatures. */
  const hiddenIds = new Set();
  let hiddenGen = 0;
  Nasj.hiddenIds = hiddenIds;
  Nasj.hiddenBump = () => { hiddenGen++; };
  const entVisible = (ent, m) => layerVisible(m.get(ent.layerId)) && !hiddenIds.has(ent.id);

  const visibleEntities = (doc) => {
    const m = layerMap(doc);
    return doc.entities.filter(e => entVisible(e, m));
  };

  /* ---------------- perf caches (SPEC §8 — behavior-neutral) ----------------
   * A document revision counter keys every cache below. It is bumped by the
   * mutating Nasj.docOps entry points (wrapped once here — every edit flow
   * calls pushUndo/addEntity/deleteEntities/undo/redo) and by any 'nasj:doc'
   * event. Stale entries are recomputed lazily, so results are always
   * identical to the uncached code — only faster. */
  let docRev = 1;
  /* THE GEOMETRY REVISION keys the per-entity tables (bounds, snap and
     grip points, prims). It is docRev minus the bumps a commit vouched
     for: a transform that announced every entity it touched (the capture
     contract below) leaves the other entities' tables warm, where a
     docRev bump used to re-measure 241k entities on the next overlay. */
  let geomRev = 1;
  /* PER-DOCUMENT REVISION. docRev is one counter for "something, somewhere,
     changed" — which is all a single-document cache ever needed. The caches
     that are now held PER DOCUMENT (the spatial index below, the GL scene in
     glscene.js, the scene bitmap) need the narrower question: has THIS
     drawing moved since I last read it? A drawing parked behind a tab
     cannot be edited except through the docOps wraps, and those name the
     document they touch; the bare 'nasj:doc' bump belongs to whichever
     drawing is on screen. So the same bump sites feed a per-document
     counter, and a drawing that was merely switched away from and back
     comes home with every cache it left. Activating a document is not an
     edit and never bumps it. */
  const docGens = new WeakMap();
  const docGen = (d) => (d ? (docGens.get(d) || 1) : 0);
  const docGenBump = (d) => { if (d) docGens.set(d, (docGens.get(d) || 1) + 1); };
  Nasj.docGen = docGen;
  Nasj.docGenBump = docGenBump;
  /* a stable identity for a document, for cache keys that are strings */
  const docTags = new WeakMap();
  let docTagN = 0;
  const docTag = (d) => {
    if (!d) return 0;
    let t = docTags.get(d);
    if (t === undefined) { t = ++docTagN; docTags.set(d, t); }
    return t;
  };
  /* phase 4: set by the op-wrap block below; the 'nasj:doc' listener calls
     it after its docRev bump to re-home capture-mutated entities */
  let sidxRehome = null;
  let sidxFlushPend = null;

  (() => { /* entities.js loads before engine.js, so docOps exists here */
    const ops = Nasj.docOps;
    if (!ops || ops._revWrapped) return;
    ops._revWrapped = true;
    for (const k of ['undo', 'redo']) {
      const fn = ops[k];
      if (typeof fn !== 'function') continue;
      ops[k] = function (doc) { docRev++; geomRev++; docGenBump(doc || Nasj.doc); return fn.apply(this, arguments); };
    }
    /* GL-PLAN phase 4 (the drawing hang): a docRev bump used to cost the
       NEXT osnap query a full spatial-index rebuild — 467-683ms of it on a
       block library, once per pencil click. The ops below can vouch for
       exactly what moved, so the index absorbs the bump in place:
       - pushUndo mutates nothing by itself (the in-place edit that follows
         it always ends in a 'nasj:doc' emit, whose bump is NOT absorbed —
         mutated geometry still re-indexes exactly as before);
       - addEntity adds one known entity: it joins its cells directly;
       - deleteEntities removes known ids: they leave their cells.
       Undo/redo replace the array wholesale and keep the full rebuild. */
    /* the membership stamp is checked BEFORE a patch is accepted, while the
       array is still the one the index was built from: an out-of-band
       truncate-and-refill is invisible to these wraps, and without this the
       first add after it would patch — and re-stamp — an index still full
       of entities the document no longer has */
    const sidxCurrent = (doc, gen0) => {
      const rec = sidxRec(doc);
      return !!(rec && rec.ents === doc.entities && rec.gen === gen0 &&
        sidxStampOk(doc));
    };
    /* an entity joins (or leaves) EVERY grid the document keeps — the whole
       point of holding several is that they all answer, so they all stay
       true. A grid is at most four cell edits per entity, so the patch is
       the same shape it always was, once per resident cell size. */
    const sidxInsert = (doc, ent) => {
      const rec = sidxRec(doc);
      if (!rec) return;
      const b = snapBox(ent);
      for (const [cell, g] of rec.grids) {
        /* a translated grid hashes in its own shifted frame (see
           Nasj.spatialTranslate): live coords minus the offset */
        const ox = g.offx || 0, oy = g.offy || 0;
        const cx0 = Math.floor((b.minx - ox) / cell), cx1 = Math.floor((b.maxx - ox) / cell);
        const cy0 = Math.floor((b.miny - oy) / cell), cy1 = Math.floor((b.maxy - oy) / cell);
        if (!isFinite(cx0) || !isFinite(cx1) || !isFinite(cy0) || !isFinite(cy1) ||
            (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 1024) {
          g.oversize.push(ent);
          idxRefs++; g.refs++;
        } else {
          for (let cx = cx0; cx <= cx1; cx++) {
            for (let cy = cy0; cy <= cy1; cy++) {
              const key = cx + ',' + cy;
              const arr = g.map.get(key);
              if (arr) arr.push(ent);
              else { const a2 = [ent]; a2.cx = cx; a2.cy = cy; g.map.set(key, a2); }
              idxRefs++; g.refs++;
            }
          }
        }
      }
      /* strictly above every existing position — an appended entity is
         topmost in draw order (pos.size would collide after deletes) */
      rec.pos.set(ent, rec.posMax++);
    };
    const sidxRemove = (doc, ent) => {
      const rec = sidxRec(doc);
      if (!rec) return;
      const b = snapBox(ent);
      let g = null;
      const drop = (arr) => {
        if (!arr) return;
        const i = arr.indexOf(ent);
        if (i >= 0) { arr.splice(i, 1); idxRefs--; g.refs--; }
      };
      for (const [cell, gg] of rec.grids) {
        g = gg;
        const ox = g.offx || 0, oy = g.offy || 0;
        const cx0 = Math.floor((b.minx - ox) / cell), cx1 = Math.floor((b.maxx - ox) / cell);
        const cy0 = Math.floor((b.miny - oy) / cell), cy1 = Math.floor((b.maxy - oy) / cell);
        if (!isFinite(cx0) || !isFinite(cx1) || !isFinite(cy0) || !isFinite(cy1) ||
            (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 1024) {
          drop(g.oversize);
        } else {
          for (let cx = cx0; cx <= cx1; cx++) {
            for (let cy = cy0; cy <= cy1; cy++) drop(g.map.get(cx + ',' + cy));
          }
        }
      }
      /* kept entries keep their pos values: deletion preserves relative
         draw order, which is all the pos sort ever reads */
      rec.pos.delete(ent);
    };
    const pu = ops.pushUndo;
    ops.pushUndo = function (doc) {
      docRev++;
      const g0 = docGen(doc); docGenBump(doc);
      if (sidxCurrent(doc, g0)) sidxSetGen(doc);
      return pu.apply(this, arguments);
    };
    const ae = ops.addEntity;
    ops.addEntity = function (doc) {
      docRev++;
      const g0 = docGen(doc); docGenBump(doc);
      const ok = sidxCurrent(doc, g0);
      const r = ae.apply(this, arguments);
      if (ok && r && sidxRec(doc) && sidxRec(doc).ents === doc.entities) {
        try { sidxInsert(doc, r); sidxSetGen(doc); sidxStamp(doc); }
        catch (e) { sidxDrop(doc); /* rebuild */ }
      }
      return r;
    };
    /* captureEntity: the caller is ABOUT to mutate this entity in place
       (PLINE vertex growth). Its cells still describe the OLD geometry, so
       it leaves them now; the commit's trailing 'nasj:doc' emit re-homes
       it with the new geometry (see the listener below). Draw-order note:
       re-insertion gives it a top position — the only current caller is
       the entity being actively drawn, which is topmost anyway. */
    const sidxPend = [];
    const sidxPendSet = new Set();
    let sidxDirty = false;
    /* the first few captures of a commit leave their cells at once (four
       cell edits each); past that a commit is a mass transform, and the
       rest leave together at flush time in one filtering pass over the
       cells they occupied — 120k one-by-one removals (an indexOf per
       dense cell array each) cost 15s on BLOCKS.dwg */
    const SIDX_EAGER = 64;
    const sidxCapture = (doc, ent) => {
      const rec = sidxRec(doc);
      if (!ent || sidxPendSet.has(ent) || !sidxCurrent(doc, docGen(doc)) || !rec.pos.has(ent)) return;
      /* the slot is kept so the rehome does not lift a moved entity to
         the top of the draw order */
      const p = { doc, rec, ent, pos: rec.pos.get(ent), out: false, box: null };
      if (sidxPend.length < SIDX_EAGER) {
        try { sidxRemove(doc, ent); p.out = true; }
        catch (e) { sidxDrop(doc); sidxPend.length = 0; sidxPendSet.clear(); return; }
      } else p.box = snapBox(ent);        /* the cells it leaves, read now */
      sidxPend.push(p);
      sidxPendSet.add(ent);
      sidxDirty = true;
    };
    /* only the cells the leaving entities occupied are swept — each
       array once — so the pass is the size of the move, not of the grid */
    const sidxRemoveMany = (rec, lazy) => {
      const set = new Set();
      for (const p of lazy) set.add(p.ent);
      for (const [cell, g] of rec.grids) {
        const ox = g.offx || 0, oy = g.offy || 0;
        const sweep = (arr) => {
          let w = 0;
          for (let i = 0; i < arr.length; i++) {
            const e = arr[i];
            if (set.has(e)) { idxRefs--; g.refs--; } else arr[w++] = e;
          }
          arr.length = w;
        };
        const done = new Set();
        let over = false;
        for (const p of lazy) {
          const b = p.box;
          const cx0 = Math.floor((b.minx - ox) / cell), cx1 = Math.floor((b.maxx - ox) / cell);
          const cy0 = Math.floor((b.miny - oy) / cell), cy1 = Math.floor((b.maxy - oy) / cell);
          if (!isFinite(cx0) || !isFinite(cx1) || !isFinite(cy0) || !isFinite(cy1) ||
              (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 1024) { over = true; continue; }
          for (let cx = cx0; cx <= cx1; cx++) {
            for (let cy = cy0; cy <= cy1; cy++) {
              const key = cx + ',' + cy;
              if (done.has(key)) continue;
              done.add(key);
              const arr = g.map.get(key);
              if (arr) sweep(arr);
            }
          }
        }
        if (over) sweep(g.oversize);
      }
      for (const e of set) rec.pos.delete(e);
    };
    /* past this share of the drawing a rebuild is the cheaper truth: the
       cell edits of a mass move cost more than the grid (measured: a
       tenth of BLOCKS.dwg re-celled in 418ms, the grid builds in 350) */
    const SIDX_REBUILD_SHARE = 20;      /* 1/20 = 5% of the entities */
    let sidxNeedBuild = null;           /* the doc a flush gave up on */
    /* the pending entities rejoin the grids under their NEW geometry.
       Runs from both index doors (so the paint or hover right after the
       transform loop already reads true cells) and from the commit's emit. */
    const sidxFlush = (doc) => {
      if (!sidxPend.length) return;
      const pend = sidxPend.slice();
      sidxPend.length = 0;
      sidxPendSet.clear();
      const rec = sidxRec(doc);
      const mine = [];
      const lazy = [];
      for (const p of pend) {
        if (p.doc !== doc) { sidxDrop(p.doc); continue; }
        if (p.rec !== rec) continue;
        mine.push(p);
        if (!p.out) lazy.push(p);
      }
      if (!rec || !mine.length) return;
      if (lazy.length * SIDX_REBUILD_SHARE > doc.entities.length) {
        sidxDrop(doc);
        sidxNeedBuild = doc;
        return;
      }
      try {
        if (lazy.length) sidxRemoveMany(rec, lazy);
        for (const p of mine) {
          /* erased since it was captured: it left for good */
          if (Nasj.docOps.entityById(doc, p.ent.id) !== p.ent) continue;
          sidxInsert(doc, p.ent);
          rec.pos.set(p.ent, p.pos);
        }
      } catch (e) { sidxDrop(doc); }
    };
    sidxFlushPend = sidxFlush;
    const ce = ops.captureEntity;
    if (typeof ce === 'function') {
      ops.captureEntity = function (doc, ent) {
        sidxCapture(doc, ent);              /* reads the OLD bounds first */
        /* and its own tables go with the old geometry: a vouched commit
           leaves geomRev alone, so nothing else would ever drop them — a
           polyline grown vertex by vertex kept the bounds of its first
           segment, re-homed into those cells, and could be picked or
           crossed by that segment alone */
        if (ent) touchEntCaches(ent);
        return ce.apply(this, arguments);
      };
    }
    /* the same contract for an in-place transform (MOVE, ROTATE, SCALE,
       MIRROR, STRETCH and the grips all go through tools' xformInPlace):
       the entity leaves its cells and rejoins at the commit — cell edits,
       where the first hover after the commit used to pay a full
       synchronous rebuild (350-600ms on BLOCKS.dwg) */
    Nasj.spatialCapture = (doc, ent, shift) => {
      /* the drag paths nudge CLONES per frame: not the document's own */
      if (!ent || !doc || Nasj.docOps.entityById(doc, ent.id) !== ent) return;
      /* shift.index === false: the caller re-frames the grids itself */
      if (!(shift && shift.index === false)) sidxCapture(doc, ent); /* reads the OLD bounds first */
      else sidxDirty = true;              /* still a vouched-for commit */
      touchEntCaches(ent, shift);
    };
    /* the trailing emit's side of the capture contract: the mutation has
       landed, the entities rejoin the index under their NEW geometry (if
       a paint has not already flushed them), and the bump is absorbed — a
       PLINE vertex costs cell edits, not a rebuild on the next osnap move */
    sidxRehome = (gen0) => {
      if (!sidxDirty) return false;
      sidxDirty = false;
      const doc = Nasj.doc;
      const rec = sidxRec(doc);
      let vouched = false;
      if (rec && rec.ents === doc.entities && rec.gen === gen0) {
        sidxFlush(doc);
        if (sidxRec(doc)) sidxSetGen(doc);
        vouched = true;
      } else { sidxPend.length = 0; sidxPendSet.clear(); }
      /* a mass move gave the grid up: it is rebuilt HERE, inside the
         commit, so the first hover after it pays nothing */
      if (sidxNeedBuild === doc) {
        sidxNeedBuild = null;
        if (!sidxRec(doc) && doc.entities.length) {
          try { ensureIndex(doc); } catch (e) { /* the doors rebuild */ }
        }
      }
      return vouched;
    };
    const de = ops.deleteEntities;
    ops.deleteEntities = function (doc, idSet) {
      docRev++;
      const g0 = docGen(doc); docGenBump(doc);
      const ok = sidxCurrent(doc, g0);
      let removed = null;
      if (ok) {
        removed = [];
        try {
          for (const id of (idSet instanceof Set ? idSet : new Set(idSet || []))) {
            const e = ops.entityById(doc, id);
            if (e) removed.push(e);
          }
        } catch (e) { removed = null; }
      }
      const r = de.apply(this, arguments);
      if (ok && removed) {
        try {
          for (const e of removed) sidxRemove(doc, e);
          sidxRec(doc).ents = doc.entities;   /* the filter made a new array */
          sidxSetGen(doc);
          sidxStamp(doc);
        } catch (e) { sidxDrop(doc); /* half-patched: force the rebuild */ }
      }
      return r;
    };
  })();

  /* Some flows mutate, render, THEN emit 'nasj:doc' — schedule one repaint
   * after the bump so no stale cached frame can survive to the screen. */
  let renderScheduled = false;
  const scheduleRender = () => {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      if (ctx) Nasj.render();
    });
  };
  /* glscene phase 4: the GL layer's own beats (build finished, mode flip)
     carry no document edit. Bumping docRev for them re-colded every cache
     the open just warmed — the spatial index (467-683ms rebuilt on the next
     hover), the snap tables, the insert tiles — exactly when the first hand
     reached the mouse. Ownership DID move, so the scene bitmap must still
     re-render: a generation of its own rides the scene signature (sameSig,
     never sameSigContent — mid-gesture the old bitmap is still a whole
     picture, merely double-covering what GL now draws underneath). */
  let glOwnGen = 0;
  window.addEventListener('nasj:doc', (ev) => {
    const r = ev && ev.detail && ev.detail.reason;
    if (r === 'glscene' || r === 'glscene-mode') {
      glOwnGen++;
      scheduleRender();
      return;
    }
    /* SWITCHING DRAWINGS IS NOT AN EDIT. activateDoc emits this event so
       the chrome refreshes; not one entity of either drawing has moved.
       Bumping the revision here re-colded every cache the switch exists to
       keep — the bounds and snap tables, the layer map, the scene bitmap's
       own signature — so the incoming drawing arrived to a cold engine
       however carefully its own state had been kept. Neither counter moves
       for it: every cache below pairs its revision with the document (or
       with the entity object itself), so nothing can read another
       drawing's answer. */
    const gen0 = docGen(Nasj.doc);
    if (r === 'activate' || r === 'close') {
      /* 'close' is the same argument from the other side: another drawing
         left the tab strip, and the one on screen did not move an inch */
      if (sidxRehome) sidxRehome(gen0);
      if (Nasj.geom && Nasj.geom.layersChanged) Nasj.geom.layersChanged();
      scheduleRender();
      return;
    }
    /* phase 4 (the drawing hang): a commit's trailing bare emit used to
       re-cold the spatial index the op wraps had just kept warm — 553ms
       (measured) on the very next osnap move while drawing. When the
       render that preceded this emit consumed the whole cycle with NO
       in-place geometry change (glscene's word, one-shot, taken every
       emit so it can never go stale), the index absorbs this bump too.
       Reasoned emits ('load' and kin) never absorb.
       AND THE BUMP ITSELF WAS THE SECOND PAINT. pushUndo+addEntity already
       raised the generation; render absorbed the LINE; this emit used to
       raise it again and schedule another compose (the 52ms click hitch
       on BLOCKS.dwg, then a leftover frame). */
    const glClean = Nasj.glscene && Nasj.glscene.cleanTake
      ? Nasj.glscene.cleanTake() : false;
    if (r == null && glClean && Nasj.doc) {
      const rec = sidxRec(Nasj.doc);
      if (rec && rec.ents === Nasj.doc.entities && rec.gen === gen0) sidxSetGen(Nasj.doc);
      return;
    }
    docRev++;
    docGenBump(Nasj.doc);
    /* capture-mutated entities rejoin; when the commit vouched for every
       entity it touched, the per-entity tables of the rest stay warm */
    if (!(sidxRehome && sidxRehome(gen0))) geomRev++;
    /* a layer thawed or switched off changes what a reference materializes,
       and an edit is not obliged to wait for a frame before anything asks */
    if (Nasj.geom && Nasj.geom.layersChanged) Nasj.geom.layersChanged();
    scheduleRender();
  });

  /* per-entity world bounds, keyed by id + revision + object identity */
  let boundsCache = new Map();
  const boundsOf = (ent) => {
    let e = boundsCache.get(ent.id);
    if (!e || e.rev !== geomRev || e.ent !== ent) {
      e = { rev: geomRev, ent, b: Nasj.geom.entityBounds(ent) };
      boundsCache.set(ent.id, e);
    }
    return e.b;
  };
  /* the same cache for whoever else pays per-entity bounds at scale — the
     marquee release re-derived every block reference's flattened bounds
     through geom.entityBounds (uncached there) on a walk this cache had
     already served to the draw pass */
  Nasj.entityBoundsCached = boundsOf;

  /* A block reference expands to every flattened child of its definition —
     tens of thousands for the big library blocks — so the osnap path hands
     these caches its cursor box and only the children in reach expand
     (SPEC §8 holds: a snap beyond the aperture is unreachable by
     definition). Cached against a grown box so a cursor drifting within it
     rides the cache; any caller without a box (grips, selection) gets — and
     caches — the full set. */
  const SNAP_BOX_GROW = 1.5; /* half-widths added each side of the box */
  const growBox = (b) => {
    const gx = (b.maxx - b.minx) * SNAP_BOX_GROW, gy = (b.maxy - b.miny) * SNAP_BOX_GROW;
    return { minx: b.minx - gx, miny: b.miny - gy, maxx: b.maxx + gx, maxy: b.maxy + gy };
  };
  const boxCovers = (e, box) =>
    !e.box || (box && box.minx >= e.box.minx && box.miny >= e.box.miny &&
               box.maxx <= e.box.maxx && box.maxy <= e.box.maxy);

  /* when the grown box swallowed the entity's whole bounds nothing was
     culled: the clipped result IS the full set, valid for any later query —
     a block drawn smaller than the aperture pays its expansion once, ever */
  const wholeOf = (ent, gen) => {
    if (!gen) return true;
    /* a clip crops the bounds away from geometry that still answers, and a
       dynamic offset moves children off the cached bounds — no shortcut */
    if (ent.clip || ent.dyn) return false;
    const b = boundsOf(ent);
    return b && gen.minx <= b.minx && gen.miny <= b.miny &&
           gen.maxx >= b.maxx && gen.maxy >= b.maxy;
  };

  /* per-entity snap points, same keying (SPEC §8: osnap results identical) */
  let snapCache = new Map();
  const snapPointsOf = (ent, box) => {
    let e = snapCache.get(ent.id);
    if (!e || e.rev !== geomRev || e.ent !== ent || !(e.whole || boxCovers(e, box))) {
      const gen = (box && ent.type === 'insert') ? growBox(box) : null;
      e = { rev: geomRev, ent, box: gen, whole: wholeOf(ent, gen),
        pts: Nasj.geom.entitySnapPoints(ent, gen) };
      snapCache.set(ent.id, e);
    }
    return e.pts;
  };

  /* per-entity GRIP points, same keying. The snap table for everything
     except a block reference, whose grips are its insertion point + its
     parameter grips only (entities.js entityGripPoints) — never the child
     expansion the OSNAP table carries. */
  let gripPtCache = new Map();
  const gripPointsOf = (ent) => {
    /* a curved body is hundreds of facets: a grip on every corner of them
       buries the body under rows of squares (a selected loft read as a
       hatch of dashes). AutoCAD shows none on a smooth face; a body of a
       few flat faces (a box, a wedge) keeps its corner grips. */
    if (ent.type === 'solid' && Array.isArray(ent.faces) && ent.faces.length > 64) return [];
    /* a helix is one curve of hundreds of chords, and a grip on every chord
       buries it the same way: it is gripped at its two ends, as AutoCAD's is */
    if (ent.type === 'polyline' && ent.helix && ent.pts.length > 2) {
      const a = ent.pts[0], b = ent.pts[ent.pts.length - 1];
      const at = (sp, p) => Math.abs(sp.x - p.x) < 1e-9 && Math.abs(sp.y - p.y) < 1e-9;
      return snapPointsOf(ent).filter((sp) => sp.kind === 'end' && (at(sp, a) || at(sp, b)));
    }
    if (ent.type !== 'insert') return snapPointsOf(ent);
    let e = gripPtCache.get(ent.id);
    if (!e || e.rev !== geomRev || e.ent !== ent) {
      e = { rev: geomRev, ent, pts: Nasj.geom.entityGripPoints(ent) };
      gripPtCache.set(ent.id, e);
    }
    return e.pts;
  };

  /* per-entity analytic prims (segments/arcs), for intersection & tracking
     osnaps; same keying as the snap-point cache */
  let primCache = new Map();
  const primsOfEnt = (ent, box) => {
    let e = primCache.get(ent.id);
    if (!e || e.rev !== geomRev || e.ent !== ent || !(e.whole || boxCovers(e, box))) {
      const gen = (box && ent.type === 'insert') ? growBox(box) : null;
      e = { rev: geomRev, ent, box: gen, whole: wholeOf(ent, gen),
        prims: Nasj.geom.entityPrims(ent, gen) };
      primCache.set(ent.id, e);
    }
    return e.prims;
  };
  /* an entity announced as about to change (see Nasj.spatialCapture):
     its tables go — except that a pure translation moves its bounds
     along, so a MOVE's overlay re-measures nothing at all */
  const touchEntCaches = (ent, shift) => {
    const id = ent.id;
    const e = boundsCache.get(id);
    if (e && shift && e.ent === ent && e.rev === geomRev && e.b && isFinite(e.b.minx) &&
        isFinite(shift.dx) && isFinite(shift.dy)) {
      e.b = Object.assign({}, e.b, {
        minx: e.b.minx + shift.dx, maxx: e.b.maxx + shift.dx,
        miny: e.b.miny + shift.dy, maxy: e.b.maxy + shift.dy });
    } else boundsCache.delete(id);
    snapCache.delete(id);
    gripPtCache.delete(id);
    primCache.delete(id);
  };

  /* prims whose bbox crosses the (w ± tol) cursor box — keeps the pairwise
     intersection test O(prims-near-cursor²), not O(entity-size²) */
  const primsNear = (ent, w, tol, box) => primsOfEnt(ent, box).filter((P) => {
    if (P.seg) {
      const [a, b] = P.seg;
      return w.x >= Math.min(a.x, b.x) - tol && w.x <= Math.max(a.x, b.x) + tol &&
             w.y >= Math.min(a.y, b.y) - tol && w.y <= Math.max(a.y, b.y) + tol;
    }
    const A = P.arc;
    return w.x >= A.c.x - A.r - tol && w.x <= A.c.x + A.r + tol &&
           w.y >= A.c.y - A.r - tol && w.y <= A.c.y + A.r + tol;
  });

  /* snap prefilter box: entity bbox unioned with an arc's center, which can
   * lie outside it (same union the un-indexed computePoint used).
   * A construction line's bbox is its base point alone — it must never widen
   * the drawing's extents — but the line itself runs off to infinity, so its
   * PREFILTER box is the whole plane: it reaches every cell, and the index
   * files it as oversize (always checked) instead of parking it in the one
   * cell its base happens to sit in, where a pick or a snap anywhere else
   * along it would never see it. */
  const snapBox = (ent) => {
    if (ent.type === 'xline') {
      return { minx: -Infinity, miny: -Infinity, maxx: Infinity, maxy: Infinity };
    }
    const b = boundsOf(ent);
    let minx = b.minx, miny = b.miny, maxx = b.maxx, maxy = b.maxy;
    if (ent.type === 'arc') {
      if (ent.c.x < minx) minx = ent.c.x;
      if (ent.c.y < miny) miny = ent.c.y;
      if (ent.c.x > maxx) maxx = ent.c.x;
      if (ent.c.y > maxy) maxy = ent.c.y;
    }
    return { minx, miny, maxx, maxy };
  };

  /* ============================================================ *
   * THE SPATIAL INDEX — ONE PER DRAWING, ONE PER CELL SIZE, ALL RESIDENT.
   *
   * Uniform grid over snap boxes. A grid built at ANY cell size answers
   * every query correctly (each query reads the grid's own cell), so the
   * cell size was never a matter of truth — only of tightness: ~64 css px
   * keeps a screenful to a few hundred cells and a cell to a handful of
   * entities. That is why it was derived from the zoom, and why zooming
   * re-celled: a quarter-million-entity library rebuilt whole, 27 times
   * and eleven seconds across one measured session, and switching between
   * two heavy drawings paid one of those rebuilds INSIDE the paint (664ms,
   * measured — the frozen tab switch).
   *
   * Both go away by keeping what was built. A drawing holds a MAP of grids
   * keyed by cell size; a zoom that wants a size already resident is a
   * lookup, and a drawing switched away from and back finds its own grids
   * where it left them. Nothing on a blocking path ever builds: the paint
   * path takes the best resident grid or says it cannot vouch (exactly as
   * it already does while a drawing loads), and the ideal size is built in
   * slices at idle. The whole cache is bounded by a global reference
   * budget with an LRU, the active drawing's bound grid never evicted.
   * ============================================================ */
  const sindex = { doc: null, ents: null, gen: -1, cell: 0, map: null,
    oversize: null, pos: null, posMax: 0, n: -1, ends: '' };
  /* one entity reference in one cell. A grid over 241k entities measured
     ~0.9-2.4M of them depending on the cell size (~8 bytes each in a packed
     array, plus the cell arrays themselves): six million references is
     roughly 80-100MB of JS heap, which is the same order as ONE heavy GL
     scene and buys every zoom level of two heavy drawings at once. */
  const IDX_REF_CAP = 6e6;
  const IDX_DOCS = 8;                    /* and never more drawings than this */
  let idxRefs = 0;
  /* doc -> { ents, gen, pos, posMax, n, ends, grids: Map<cell, grid>, use }
     Map iteration order is insertion order, and re-insertion moves an entry
     to the end: that is the LRU, with no second structure to keep true. */
  const idxDocs = new Map();
  let idxUse = 0;
  const sidxRec = (doc) => (doc ? (idxDocs.get(doc) || null) : null);
  const sidxDropGrid = (rec, cell) => {
    const g = rec.grids.get(cell);
    if (!g) return;
    idxRefs -= g.refs;
    rec.grids.delete(cell);
    if (sindex.doc === rec.doc && sindex.cell === cell) sindex.map = null;
  };
  const sidxDrop = (doc) => {
    const rec = idxDocs.get(doc);
    if (!rec) return;
    for (const g of rec.grids.values()) idxRefs -= g.refs;
    idxDocs.delete(doc);
    if (sindex.doc === doc) { sindex.map = null; sindex.doc = null; }
  };
  Nasj.spatialForget = sidxDrop;      /* a closed drawing gives its grids back */
  /* the grid cache as the memory policy sees it (QA / probes) */
  Nasj.spatialStats = () => ({
    docs: idxDocs.size, refs: idxRefs, refCap: IDX_REF_CAP,
    /* what keeping the grids has saved: one build per drawing per cell
       size, where it used to be one every time a zoom crossed an octave */
    builds: idxBuilds, buildMs: Math.round(idxBuildMs),
    grids: [...idxDocs.values()].map((r) => ({
      name: (r.doc && r.doc.name) || '?', cells: [...r.grids.keys()],
      refs: [...r.grids.values()].reduce((n, g) => n + g.refs, 0), pos: r.pos.size }))
  });
  /* the budget, enforced oldest-first: other drawings before this one, and
     within a drawing the least recently asked-for cell size. The grid the
     screen is reading is never taken. */
  const idxEvict = () => {
    let guard = 64;
    while ((idxRefs > IDX_REF_CAP || idxDocs.size > IDX_DOCS) && guard-- > 0) {
      let victim = null, vcell = 0, vuse = Infinity;
      for (const rec of idxDocs.values()) {
        for (const [cell, g] of rec.grids) {
          if (rec.doc === sindex.doc && cell === sindex.cell && rec.doc === Nasj.doc) continue;
          const u = g.use + (rec.doc === Nasj.doc ? 1e9 : 0);
          if (u < vuse) { vuse = u; victim = rec; vcell = cell; }
        }
      }
      if (!victim) break;
      sidxDropGrid(victim, vcell);
      if (!victim.grids.size) { idxDocs.delete(victim.doc); }
    }
  };
  const sidxSetGen = (doc) => {
    const rec = idxDocs.get(doc);
    if (rec) rec.gen = docGen(doc);
    if (sindex.doc === doc) sindex.gen = docGen(doc);
  };
  /* A WHOLE-DOCUMENT TRANSLATION IS NOT A REBUILD EITHER. When MOVE
     commits with everything selected, every entity's box moved by one
     (dx,dy) — so the grids are still exactly right in a coordinate frame
     shifted by that much. Each grid carries the accumulated offset
     (queries and patches subtract it before hashing a cell), and the
     first osnap after the commit costs nothing where it used to pay a
     full synchronous rebuild INSIDE the commit click's own task (the
     ~700ms of an independently measured 844ms block). */
  Nasj.spatialTranslate = (doc, dx, dy) => {
    if (!isFinite(dx) || !isFinite(dy)) return false;
    const rec = idxDocs.get(doc);
    if (!rec || rec.ents !== doc.entities || !sidxStampOk(doc)) return false;
    for (const g of rec.grids.values()) {
      g.offx = (g.offx || 0) + dx;
      g.offy = (g.offy || 0) + dy;
    }
    rec.gen = docGen(doc);
    if (sindex.doc === doc) {
      sindex.gen = rec.gen;
      const g0 = rec.grids.get(sindex.cell);
      if (g0) { sindex.offx = g0.offx; sindex.offy = g0.offy; }
    }
    return true;
  };
  /* A REORDER IS NOT A REBUILD. DRAWORDER and kin permute doc.entities in
     place: membership and geometry stand, only draw order moved — so the
     grids stay true and just the pos map re-numbers. Called AFTER the
     commit's emit, it also re-stamps ends and generation, and the next
     hover pays 15ms of Map fill instead of the 458ms grid rebuild the
     wholesale array replacement used to force. */
  Nasj.spatialReorder = (doc) => {
    const rec = idxDocs.get(doc);
    if (!rec || rec.ents !== doc.entities || rec.pos.size !== doc.entities.length) return false;
    for (let i = 0; i < doc.entities.length; i++) rec.pos.set(doc.entities[i], i);
    rec.posMax = doc.entities.length;
    rec.n = doc.entities.length;
    rec.ends = sidxEnds(doc.entities);
    rec.gen = docGen(doc);
    if (sindex.doc === doc) {
      sindex.gen = rec.gen;
      sindex.n = rec.n;
      sindex.ends = rec.ends;
      sindex.posMax = rec.posMax;
    }
    return true;
  };
  /* bind the module-wide view onto one of a drawing's grids: every query
     below reads sindex.cell/map/oversize/pos and is untouched by the fact
     that several of these now exist */
  const sidxBind = (rec, cell) => {
    const g = rec.grids.get(cell);
    if (!g) return null;
    g.use = ++idxUse;
    rec.use = idxUse;
    idxDocs.delete(rec.doc); idxDocs.set(rec.doc, rec);   /* LRU touch */
    sindex.doc = rec.doc;
    sindex.ents = rec.ents;
    sindex.gen = rec.gen;
    sindex.cell = cell;
    sindex.map = g.map;
    sindex.oversize = g.oversize;
    sindex.offx = g.offx || 0;
    sindex.offy = g.offy || 0;
    sindex.pos = rec.pos;
    sindex.posMax = rec.posMax;
    sindex.n = rec.n;
    sindex.ends = rec.ends;
    return sindex;
  };
  /* the resident grid closest (in octaves) to the one the view would like */
  const sidxBest = (rec, cell) => {
    let best = 0, bd = Infinity;
    for (const c of rec.grids.keys()) {
      const d = Math.abs(Math.log2(c / cell));
      if (d < bd || (d === bd && c > best)) { bd = d; best = c; }
    }
    return best;
  };

  /* MEMBERSHIP STAMP. The index is patched in place by the add/delete wraps,
     so its length moves legitimately and cannot itself be the freshness
     test — but an array mutated OUTSIDE those wraps (a truncate-and-refill:
     the QA harnesses do exactly this, and it is what entityById's own id
     index guards against, see entities.js) leaves the array identity, the
     revision and the length all standing while the membership is new. The
     stamp is the same shape entityById proved: the count the index holds
     plus its first and last ids, refreshed by every legitimate patch. A
     stale index handed the marquee entities that no longer exist in the
     document, and unlike a hover — where the exact test rejects them — a
     selection would have taken them. */
  const sidxEnds = (arr) => (arr.length
    ? String(arr[0].id) + ' ' + String(arr[arr.length - 1].id) : '');
  const sidxStamp = (doc) => {
    const rec = idxDocs.get(doc);
    if (rec) { rec.n = doc.entities.length; rec.ends = sidxEnds(doc.entities); }
    if (sindex.doc === doc) { sindex.n = doc.entities.length; sindex.ends = sidxEnds(doc.entities); }
  };
  const sidxStampOk = (doc) => {
    const rec = idxDocs.get(doc);
    return !!rec && rec.n === doc.entities.length && rec.ends === sidxEnds(doc.entities);
  };

  /* when a render last saw the scale change / the pointer or wheel last
     streamed — a live zoom gesture defers work that only a settle needs */
  let lastZoomT = -1e9;
  let lastInteractT = -1e9;
  /* a gesture the engine's own listeners never see — touch.js keeps the
     real finger's pointer events off the canvas and drives the viewport
     itself — says so here, so the idle warm-up yields to it exactly as it
     yields to a mouse */
  Nasj.interacting = () => { lastInteractT = performance.now(); };

  /* ============================================================ *
   * THE LOAD BUDGET. An open may take its time behind the progress bar,
   * but it may never take the THREAD: for as long as this one is busy the
   * compositor cannot put a frame up, and the crosshair — whoever draws
   * it — stops dead. So every phase of an open slices to one frame's
   * worth of work and hands the thread back (app.js yields between
   * slices), and the crosshair itself becomes the OS's for the duration
   * (see renderOverlay). Six milliseconds leaves room inside a 120Hz
   * frame for the yield, the input that was waiting, and the paint.
   * ============================================================ */
  const LOAD_SLICE_MS = 6;
  const docLoading = () => !!(Nasj.doc && Nasj.doc.loading);

  const indexCellSize = () => {
    const ws = Nasj.worldScale();
    const raw = 64 / (ws > 0 ? ws : 1);
    const p = Math.pow(2, Math.round(Math.log2(raw)));
    return (isFinite(p) && p > 0) ? p : 64;
  };

  /* ONE BUILD, TWO PACES. The sweep below is a quarter of a million snap
     boxes — 580ms, measured, on a block library — and it is the same work
     whether the first hover asks for it or the open front-load does. Held
     as a resumable job so the open can pay it a frame at a time; called
     straight through (deadline 0) everywhere else, exactly as before. */
  let idxJob = null;
  const idxJobStart = (doc, cell) => {
    /* rebuild — also purge caches so deleted entities don't accumulate */
    const cap = doc.entities.length * 2 + 64;
    if (boundsCache.size > cap) boundsCache = new Map();
    if (snapCache.size > cap) snapCache = new Map();
    if (gripPtCache.size > cap) gripPtCache = new Map();
    if (primCache.size > cap) primCache = new Map();
    /* the generation the sweep reads: committed as-is, so an edit that
       lands mid-build leaves the index looking stale (it is) and it
       rebuilds. The position map belongs to the DRAWING, not to one grid —
       draw order does not care how big the cells are — so a second cell
       size for a drawing that already has one reuses the map it built. */
    const rec = idxDocs.get(doc);
    const share = !!(rec && rec.ents === doc.entities && rec.gen === docGen(doc));
    return { doc, ents: doc.entities, gen: docGen(doc), cell, i: 0, refs: 0,
      map: new Map(), oversize: [],
      pos: share ? rec.pos : new Map(), sharedPos: share };
  };
  let idxBuilds = 0, idxBuildMs = 0;      /* see Nasj.spatialStats */
  const idxJobRun = (job, deadline) => {
    const t0 = performance.now();
    if (!job.i) idxBuilds++;
    try { return idxJobRun_(job, deadline); }
    finally { idxBuildMs += performance.now() - t0; }
  };
  const idxJobRun_ = (job, deadline) => {
    const ents = job.ents, cell = job.cell, map = job.map;
    const oversize = job.oversize, pos = job.pos, share = job.sharedPos;
    let i = job.i, refs = job.refs;
    for (; i < ents.length; i++) {
      /* every 8: a cold snapBox on a rotated reference materializes its
         definition (~35ms), and stacking a few between coarser checks made
         a 120ms idle slice out of a 6ms budget */
      if (deadline && !(i & 7) && performance.now() > deadline) break;
      const ent = ents[i];
      /* draw order: the index loses it, this map restores it after a query */
      if (!share) pos.set(ent, i);
      if (!ent || !ent.id) continue;
      const b = snapBox(ent);
      const cx0 = Math.floor(b.minx / cell), cx1 = Math.floor(b.maxx / cell);
      const cy0 = Math.floor(b.miny / cell), cy1 = Math.floor(b.maxy / cell);
      if (!isFinite(cx0) || !isFinite(cx1) || !isFinite(cy0) || !isFinite(cy1) ||
          (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 1024) {
        oversize.push(ent);
        refs++;
        continue;
      }
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const key = cx + ',' + cy;
          const arr = map.get(key);
          if (arr) arr.push(ent);
          else { const a2 = [ent]; a2.cx = cx; a2.cy = cy; map.set(key, a2); }
          refs++;
        }
      }
    }
    job.i = i;
    job.refs = refs;
    return i < ents.length;
  };
  const idxJobCommit = (job) => {
    const doc = job.doc;
    let rec = idxDocs.get(doc);
    /* the drawing moved under a build that was still running: throw the
       whole record away rather than mix two revisions of one drawing */
    if (rec && (rec.ents !== job.ents || rec.gen !== job.gen)) { sidxDrop(doc); rec = null; }
    if (!rec) {
      rec = { doc, ents: job.ents, gen: job.gen, pos: job.pos,
        posMax: job.ents.length,   /* next appended entity's slot */
        n: -1, ends: '', grids: new Map(), use: 0 };
      idxDocs.set(doc, rec);
    }
    const old = rec.grids.get(job.cell);
    if (old) idxRefs -= old.refs;
    rec.grids.set(job.cell,
      { map: job.map, oversize: job.oversize, refs: job.refs, use: ++idxUse });
    idxRefs += job.refs;
    rec.n = doc.entities.length;
    rec.ends = sidxEnds(doc.entities);
    sidxBind(rec, job.cell);
    idxEvict();
  };
  /* a grid this document can be queried through is resident. Any cell size
     answers (each query reads the grid's own cell); `cell` asks the
     narrower question of whether THAT size is one of them. */
  const indexFresh = (doc, cell) => {
    const rec = doc ? idxDocs.get(doc) : null;
    if (!rec || rec.ents !== doc.entities || rec.gen !== docGen(doc) ||
        !rec.grids.size || !sidxStampOk(doc)) return false;
    return cell === undefined || rec.grids.has(cell);
  };
  /* a record still true for this drawing, or nothing (and the stale one
     dropped on the way out) */
  const idxRecFresh = (doc) => {
    let rec = doc ? idxDocs.get(doc) : null;
    if (rec && (rec.ents !== doc.entities || rec.gen !== docGen(doc) ||
        !sidxStampOk(doc))) { sidxDrop(doc); rec = null; }
    if (rec && sidxFlushPend) { sidxFlushPend(doc); rec = idxDocs.get(doc) || null; }
    return (rec && rec.grids.size) ? rec : null;
  };

  /* THE POINTER PATH'S DOOR. The grid the view wants if the drawing has it,
     else the nearest one it does have (with the ideal armed for idle), and
     only a drawing with no grid at all builds here. */
  const ensureIndex = (doc) => {
    const cell = indexCellSize();
    const rec = idxRecFresh(doc);
    if (rec) {
      if (rec.grids.has(cell)) return sidxBind(rec, cell);
      /* a stale cell size still culls correctly — the ideal one is built at
         idle, in slices, and this answer stands until it lands */
      warmIndexIdle();
      return sidxBind(rec, sidxBest(rec, cell));
    }
    /* an idle build already under way for this very grid finishes from
       where it stopped instead of starting over */
    const job = (idxJob && idxJob.doc === doc && idxJob.ents === doc.entities &&
      idxJob.cell === cell && idxJob.gen === docGen(doc)) ? idxJob : idxJobStart(doc, cell);
    idxJobRun(job, 0);
    idxJobCommit(job);
    idxJob = null;
    return sindex;
  };

  /* THE PAINT PATH'S DOOR. Never builds: the best resident grid, or null
     and a sliced build armed at idle. A drawing switched to whose grids
     have been evicted therefore costs the paint nothing — the cull falls
     back to the walk it would have done anyway, exactly as it does while a
     drawing is still loading. */
  const indexResident = (doc) => {
    const rec = idxRecFresh(doc);
    if (!rec) { warmIndexIdle(); return null; }
    const cell = indexCellSize();
    if (rec.grids.has(cell)) return sidxBind(rec, cell);
    warmIndexIdle();
    return sidxBind(rec, sidxBest(rec, cell));
  };

  /* the same build, one slice per call — the open front-load's step and the
     idle warm's. true while there is more to do. */
  const indexWarmStep = (doc, deadline) => {
    const cell = indexCellSize();
    if (indexFresh(doc, cell)) { idxJob = null; return false; }
    if (!idxJob || idxJob.doc !== doc || idxJob.ents !== doc.entities ||
        idxJob.cell !== cell || idxJob.gen !== docGen(doc)) {
      idxJob = idxJobStart(doc, cell);
    }
    if (idxJobRun(idxJob, deadline)) return true;
    idxJobCommit(idxJob);
    idxJob = null;
    return false;
  };

  /* The same index, for whoever else pays per mouse move. Hover hit-testing
     walked every entity of a quarter-million-entity drawing on every move —
     420ms a move, half a second of freeze per twitch — when the candidates
     near the cursor were already sitting in these cells. Top-of-draw-order
     first, exactly the order picking wants. */
  Nasj.spatialCandidates = (x, y, tol) => {
    const doc = Nasj.doc;
    if (!doc || !doc.entities.length) return null;
    const ix = ensureIndex(doc);
    const out = queryIndex(doc, x, y, tol);
    out.sort((a, b) => (ix.pos.get(b) || 0) - (ix.pos.get(a) || 0));
    return out;
  };
  /* rectangle form (window/crossing select); null = spans too many cells,
     caller falls back to the full walk */
  Nasj.spatialRect = (minx, miny, maxx, maxy) => {
    const doc = Nasj.doc;
    if (!doc || !doc.entities.length) return null;
    return queryIndexRect(doc, minx, miny, maxx, maxy);
  };

  /* entities whose box may touch a world rectangle — the draw pass asks
     this for tight views of heavy drawings, so a detail view culls in
     hundreds of lookups instead of a quarter-million bounds tests. null
     when the rect spans too many cells to be worth it (zoomed far out). */
  const queryIndexRect = (doc, minx, miny, maxx, maxy) => {
    /* WHILE THE DRAWING LOADS, NOBODY BUILDS THE INDEX HERE. Both callers
       on the paint path ask this — the heavy-scene verdict and the full
       pass's cull — and both were paying the 580ms rebuild inside a rAF,
       once per 'load' emit, which is two of the second-long freezes the
       crosshair was measured against. Say "cannot vouch": the verdict then
       reads heavy (which a quarter-million arriving entities are) and the
       cull falls back to the walk it would have done anyway. The front-load
       builds the index for real, in slices, before the bar comes down. */
    /* AND A DRAWING JUST SWITCHED TO IS THE SAME CASE. The rebuild that
       used to happen here is what froze the tab switch between two heavy
       drawings — 664ms, measured, inside the one paint. Nothing is built
       on this path any more, in or out of a load: the answer is the best
       grid the drawing already has, or none at all. */
    const ix = indexResident(doc);
    if (!ix || (doc && doc.loading && !indexFresh(doc))) return null;
    const cell = ix.cell;
    const ox = ix.offx || 0, oy = ix.offy || 0;
    const cx0 = Math.floor((minx - ox) / cell), cx1 = Math.floor((maxx - ox) / cell);
    const cy0 = Math.floor((miny - oy) / cell), cy1 = Math.floor((maxy - oy) / cell);
    if (!isFinite(cx0) || !isFinite(cx1) || !isFinite(cy0) || !isFinite(cy1) ||
        (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 4096) return null;
    const seen = new Set();
    const out = [];
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const arr = ix.map.get(cx + ',' + cy);
        if (!arr) continue;
        for (const ent of arr) {
          if (!seen.has(ent.id)) { seen.add(ent.id); out.push(ent); }
        }
      }
    }
    for (const ent of ix.oversize) {
      if (!seen.has(ent.id)) out.push(ent);
    }
    out.sort((a, b) => (ix.pos.get(a) || 0) - (ix.pos.get(b) || 0));
    return out;
  };

  /* THE SAME QUESTION, WHEN ONLY "MORE THAN cap?" IS ASKED. The heavy-scene
     predictor built the whole sorted list to look at its length — 30ms
     over a block library at a mid view (measured), on every gesture frame
     that is not blitting. It counts DISTINCT ids exactly as the list does
     and stops the moment the cap is passed, so the verdict is identical
     and the cost is the cap, not the view.
     -1 = cannot vouch (the same cases that return null above), 1 = over
     the cap, 0 = at or under it. */
  const queryIndexOver = (doc, minx, miny, maxx, maxy, cap) => {
    const ix = indexResident(doc);
    if (!ix || (doc && doc.loading && !indexFresh(doc))) return -1;
    const cell = ix.cell;
    const ox = ix.offx || 0, oy = ix.offy || 0;
    const cx0 = Math.floor((minx - ox) / cell), cx1 = Math.floor((maxx - ox) / cell);
    const cy0 = Math.floor((miny - oy) / cell), cy1 = Math.floor((maxy - oy) / cell);
    if (!isFinite(cx0) || !isFinite(cx1) || !isFinite(cy0) || !isFinite(cy1) ||
        (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 4096) return -1;
    const seen = new Set();
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const arr = ix.map.get(cx + ',' + cy);
        if (!arr) continue;
        for (const ent of arr) {
          if (seen.has(ent.id)) continue;
          seen.add(ent.id);
          if (seen.size > cap) return 1;
        }
      }
    }
    for (const ent of ix.oversize) {
      if (seen.has(ent.id)) continue;
      seen.add(ent.id);
      if (seen.size > cap) return 1;
    }
    return 0;
  };

  /* THE SAME QUESTION AS A MEMBERSHIP SET. The chunked pass filters its own
     ordered list through the index, so it needs to know WHICH entities the
     rectangle can touch and never in what order — and the sort the list
     form owes (a quarter of a million entries through a Map comparator) was
     45-55ms of it. This gives up the moment the answer passes `cap`,
     because a cull that keeps nearly everything is not worth its own set:
     null then, and the caller walks its list whole exactly as before. */
  const queryIndexIdSet = (doc, minx, miny, maxx, maxy, cap) => {
    const ix = indexResident(doc);
    if (!ix || (doc && doc.loading && !indexFresh(doc))) return null;
    const cell = ix.cell;
    const ox = ix.offx || 0, oy = ix.offy || 0;
    const cx0 = Math.floor((minx - ox) / cell), cx1 = Math.floor((maxx - ox) / cell);
    const cy0 = Math.floor((miny - oy) / cell), cy1 = Math.floor((maxy - oy) / cell);
    if (!isFinite(cx0) || !isFinite(cx1) || !isFinite(cy0) || !isFinite(cy1) ||
        (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 4096) return null;
    const seen = new Set();
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const arr = ix.map.get(cx + ',' + cy);
        if (!arr) continue;
        for (const ent of arr) {
          seen.add(ent.id);
          if (seen.size > cap) return null;
        }
      }
    }
    for (const ent of ix.oversize) {
      seen.add(ent.id);
      if (seen.size > cap) return null;
    }
    return seen;
  };

  /* entities whose snap box may intersect the (x±tol, y±tol) query box.
     A CELL IS 64 PIXELS AND THE APERTURE IS 8, so on a block-library sheet
     one cell hands back forty thousand entities where fifteen thousand
     reach the cursor — and BOTH callers (the osnap prefilter and the pick
     walk) then test every one of them against its own box. That test is
     made here instead, once, off the cached bounds: each caller's own
     filter is a superset of this one, so the answers are unchanged and the
     walks are as short as the boxes allow. */
  const queryIndex = (doc, x, y, tol) => {
    const ix = ensureIndex(doc);
    const cell = ix.cell;
    const ox = ix.offx || 0, oy = ix.offy || 0;
    const cx0 = Math.floor((x - tol - ox) / cell), cx1 = Math.floor((x + tol - ox) / cell);
    const cy0 = Math.floor((y - tol - oy) / cell), cy1 = Math.floor((y + tol - oy) / cell);
    const out = [];
    const reach = (ent) => {
      const b = snapBox(ent);
      return !(x < b.minx - tol || x > b.maxx + tol ||
               y < b.miny - tol || y > b.maxy + tol);
    };
    /* one cell holds each entity once, and the oversize list is disjoint
       from the map — so the single-cell query needs no seen-set at all */
    if (cx0 === cx1 && cy0 === cy1) {
      const arr = ix.map.get(cx0 + ',' + cy0);
      if (arr) for (const ent of arr) if (reach(ent)) out.push(ent);
      for (const ent of ix.oversize) if (reach(ent)) out.push(ent);
      return out;
    }
    /* THE APERTURE CAN OUTGROW THE GRID. Zoomed far out the snap aperture
       spans thousands of drawing units, and the grid answering is the one
       resident — the cell size this scale wants is built at idle, and a
       wheel held down never gives idle a turn. The box below then probed
       cells that hold nothing, by the square of the zoom: 11 SECONDS of
       Map.get per mouse move, measured on an 1,800-entity drawing at
       1:40000, which is the freeze a long zoom out walks into. Past the
       point where the box asks for more cells than the drawing has
       entities, the entities are read instead of the cells — the same
       answer through the same reach(), at the size of the DRAWING rather
       than the square of the zoom. */
    const span = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    if (!isFinite(span) || span > doc.entities.length) {
      for (const ent of doc.entities) if (reach(ent)) out.push(ent);
      return out;
    }
    const seen = new Set();
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const arr = ix.map.get(cx + ',' + cy);
        if (!arr) continue;
        for (const ent of arr) {
          if (seen.has(ent.id)) continue;
          seen.add(ent.id);
          if (reach(ent)) out.push(ent);
        }
      }
    }
    for (const ent of ix.oversize) {
      if (!seen.has(ent.id) && reach(ent)) out.push(ent);
    }
    return out;
  };

  /* A zoom leaves the spatial index stale (deliberately — the rebuild must
     not ride the wheel), and the FIRST pointer query after the settle paid
     it: 83ms on a 246k-entity drawing, an ambush if that query is the first
     move of a marquee. The settle now hands the rebuild to an idle slot —
     along with the marquee preview's two warmables (the accent-recolored
     scene bitmap and the GL tint pass's pipeline state), whose first-use
     cost was the first marquee frame's dropped vsync. */
  let idxIdle = 0;
  /* AND IT IS SLICED. The rebuild used to run straight through in the idle
     slot — a ~90ms hitch on a block library, which an idle slot may hide
     and may not. Now it is the same resumable job the open front-load
     drives, one frame's worth at a time, so the grid the new zoom wants
     grows in behind a window that keeps its cadence. */
  const warmIndexIdle = () => {
    if (idxIdle) return;
    const doc = Nasj.doc;
    if (!doc || doc.loading || !doc.entities.length) return;
    const pump = () => {
      idxIdle = 0;
      const d = Nasj.doc;
      if (!d || d.loading || !d.entities.length) return;
      if (d.entities.length > SCENE_ASYNC_N &&
          indexWarmStep(d, performance.now() + LOAD_SLICE_MS)) {
        idxIdle = requestAnimationFrame(() => { idxIdle = 0; pump(); });
        return;
      }
    };
    idxIdle = (typeof requestIdleCallback === 'function')
      ? requestIdleCallback(pump, { timeout: 600 })
      : setTimeout(pump, 180);
  };

  /* ---- incremental marquee candidate accumulator (window/crossing drag) ----
   * A selection rectangle dragged over a quarter-million entities must not
   * re-enumerate everything it covers on every move OR on release. While the
   * drag runs, each move enumerates only the DELTA BAND of index cells
   * between the previous rectangle and the new one; every candidate carries
   * a refcount of the covered cells it sits in, so a shrinking rectangle
   * drops an entity exactly when its last cell leaves. take() hands back the
   * id map — a SUPERSET of everything the final rect can select (xlines and
   * other unboundables ride the oversize list, refcounted Infinity so no
   * shrink can evict them) — or null when it cannot vouch (rect spans more
   * cells than the index serves, no index), and the caller falls back to
   * the spatialRect query. Cost per move tracks hand speed, not coverage. */
  Nasj.marqueeAccum = (() => {
    let st = null;
    const CELL_CAP = 4096;                 /* same bound queryIndexRect draws */
    /* cells of rect A outside rect B (ranges are [x0,x1,y0,y1] inclusive) */
    const eachOutside = (A, B, fn) => {
      for (let cx = A[0]; cx <= A[1]; cx++) {
        const inX = B && cx >= B[0] && cx <= B[1];
        for (let cy = A[2]; cy <= A[3]; cy++) {
          if (inX && cy >= B[2] && cy <= B[3]) { cy = B[3]; continue; }
          fn(cx, cy);
        }
      }
    };
    return {
      begin() {
        st = { counts: null, ents: null, ix: null, cell: 0, map: null,
          range: null, full: false };
      },
      end() { st = null; },
      update(minx, miny, maxx, maxy) {
        if (!st || st.full) return;
        const doc = Nasj.doc;
        if (!doc || !doc.entities.length) { st.full = true; return; }
        const ix = ensureIndex(doc);
        const cell = ix.cell;
        const iox = ix.offx || 0, ioy = ix.offy || 0;
        const nx0 = Math.floor((minx - iox) / cell), nx1 = Math.floor((maxx - iox) / cell);
        const ny0 = Math.floor((miny - ioy) / cell), ny1 = Math.floor((maxy - ioy) / cell);
        if (!isFinite(nx0) || !isFinite(nx1) || !isFinite(ny0) || !isFinite(ny1) ||
            (nx1 - nx0 + 1) * (ny1 - ny0 + 1) > CELL_CAP) { st.full = true; return; }
        if (st.ix !== ix || st.map !== ix.map || st.cell !== cell ||
            st.offx !== iox || st.offy !== ioy) {
          /* the index rebuilt mid-drag (a wheel zoom crossed a cell-size
             boundary): reseed against the CURRENT rect from scratch */
          st.ix = ix; st.map = ix.map; st.cell = cell; st.range = null;
          st.offx = iox; st.offy = ioy;
          st.counts = new Map();
          st.ents = new Map();
          for (const ent of ix.oversize) {
            st.counts.set(ent.id, Infinity);
            st.ents.set(ent.id, ent);
          }
        }
        const N = [nx0, nx1, ny0, ny1], O = st.range;
        const counts = st.counts, ents = st.ents;
        const add = (cx, cy) => {
          const arr = ix.map.get(cx + ',' + cy);
          if (!arr) return;
          for (const ent of arr) {
            const c = counts.get(ent.id);
            if (c === undefined) { counts.set(ent.id, 1); ents.set(ent.id, ent); }
            else counts.set(ent.id, c + 1);
          }
        };
        const del = (cx, cy) => {
          const arr = ix.map.get(cx + ',' + cy);
          if (!arr) return;
          for (const ent of arr) {
            const c = counts.get(ent.id);
            if (c === undefined) continue;
            if (c <= 1) { counts.delete(ent.id); ents.delete(ent.id); }
            else counts.set(ent.id, c - 1);
          }
        };
        eachOutside(N, O, add);
        if (O) eachOutside(O, N, del);
        st.range = N;
      },
      /* the candidate entities, keyed by id (a superset of anything the
         current rect can select); null = fall back to spatialRect */
      take() { return (st && !st.full && st.ents) ? st.ents : null; },
    };
  })();

  const brighten = (hex, f) => {
    if (typeof hex !== 'string' || hex[0] !== '#') return hex;
    let h = hex.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return hex;
    const n = parseInt(h, 16);
    if (Number.isNaN(n)) return hex;
    const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
    const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
    const b = Math.min(255, Math.round((n & 255) * f));
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  };

  const viewWorldBounds = () => {
    if (view3d.active) { /* bbox of the visible z=0-plane parallelogram */
      const cs = [
        vp.screenToWorld({ x: 0, y: 0 }), vp.screenToWorld({ x: cssW, y: 0 }),
        vp.screenToWorld({ x: 0, y: cssH }), vp.screenToWorld({ x: cssW, y: cssH })
      ];
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const c of cs) {
        if (c.x < minx) minx = c.x;
        if (c.y < miny) miny = c.y;
        if (c.x > maxx) maxx = c.x;
        if (c.y > maxy) maxy = c.y;
      }
      return { minx, miny, maxx, maxy };
    }
    if (twist) {
      /* the visible region is a turned rectangle; its world box is what
         culling and the grid need, so take all four corners */
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const c of [
        vp.screenToWorld({ x: 0, y: 0 }), vp.screenToWorld({ x: cssW, y: 0 }),
        vp.screenToWorld({ x: 0, y: cssH }), vp.screenToWorld({ x: cssW, y: cssH })
      ]) {
        if (c.x < minx) minx = c.x;
        if (c.y < miny) miny = c.y;
        if (c.x > maxx) maxx = c.x;
        if (c.y > maxy) maxy = c.y;
      }
      return { minx, miny, maxx, maxy };
    }
    const tl = vp.screenToWorld({ x: 0, y: 0 });
    const br = vp.screenToWorld({ x: cssW, y: cssH });
    return { minx: tl.x, miny: br.y, maxx: br.x, maxy: tl.y };
  };

  /* build the screen-space path of an entity (line/polyline/circle/arc/ellipse) */
  const entPath = (c2d, ent) => {
    switch (ent.type) {
      case 'line': {
        const a = vp.worldToScreen(ent.a), b = vp.worldToScreen(ent.b);
        c2d.moveTo(a.x, a.y);
        c2d.lineTo(b.x, b.y);
        break;
      }
      /* each element is its own subpath of the one object's stroke */
      case 'mline':
        for (const part of Nasj.geom.mlineParts(ent)) entPath(c2d, part);
        break;
      case 'xline': {                /* off both screen edges (rays, one) */
        const L = 1e6;
        const a = ent.ray ? ent.p
          : { x: ent.p.x - ent.d.x * L, y: ent.p.y - ent.d.y * L };
        const A = vp.worldToScreen(a);
        const B = vp.worldToScreen({ x: ent.p.x + ent.d.x * L, y: ent.p.y + ent.d.y * L });
        c2d.moveTo(A.x, A.y);
        c2d.lineTo(B.x, B.y);
        break;
      }
      case 'polyline': {
        const pts = ent.pts;
        if (!pts || !pts.length) break;
        const p0 = vp.worldToScreen(pts[0]);
        c2d.moveTo(p0.x, p0.y);
        const n = pts.length;
        const segs = ent.closed ? n : n - 1;
        for (let i = 0; i < segs; i++) {
          const a = pts[i], b = pts[(i + 1) % n];
          /* a bulge only draws as an arc when its sagitta (|b|*chord/2)
             spans pixels — an epsilon bulge (|b|~1e-11 arc-fit junk) implies
             an astronomical radius the canvas rasterizes as stray rays, and
             its chord is visually identical anyway */
          const A = (a && typeof a.b === 'number' && isFinite(a.b) && a.b !== 0 &&
            Math.abs(a.b) * Math.hypot(b.x - a.x, b.y - a.y) * vp.scale >= 0.5)
            ? Nasj.geom.bulgeArc(a, b, a.b) : null;
          if (A && isFinite(A.r) && A.r * vp.scale <= 1e7) {
            /* true arc for the bulge segment; screen y flip mirrors angles
               (world CCW -> canvas anticlockwise), same as the 'arc' case */
            const c = vp.worldToScreen(A.c);
            const r = Math.max(A.r * vp.scale, 0.01);
            c2d.arc(c.x, c.y, r, scrAng(A.a0), scrAng(A.a0 + A.theta), A.theta > 0);
          } else {
            const p = vp.worldToScreen(b);
            c2d.lineTo(p.x, p.y);
          }
        }
        if (ent.closed) c2d.closePath();
        break;
      }
      case 'circle': {
        const c = vp.worldToScreen(ent.c);
        c2d.arc(c.x, c.y, Math.max(ent.r * vp.scale, 0.01), 0, TAU);
        break;
      }
      case 'arc': {
        /* world CCW a0->a1; screen y is flipped so world angle t maps to
           canvas angle -t and world-CCW becomes canvas-anticlockwise */
        const c = vp.worldToScreen(ent.c);
        const r = Math.max(ent.r * vp.scale, 0.01);
        /* kernel treats a0===a1 (sweep ~TAU) as a full circle — draw one */
        if (Nasj.geom.arcSweep(ent.a0, ent.a1) >= TAU - 1e-9) c2d.arc(c.x, c.y, r, 0, TAU);
        else c2d.arc(c.x, c.y, r, scrAng(ent.a0), scrAng(ent.a1), true);
        break;
      }
      case 'ellipse': {
        const c = vp.worldToScreen(ent.c);
        const rx = Math.max(Math.abs(ent.rx) * vp.scale, 0.01);
        const ry = Math.max(Math.abs(ent.ry) * vp.scale, 0.01);
        /* screen Y runs the other way, so the parametric run is walked
           backwards on canvas — the same flip the rotation already takes */
        const swept = Number.isFinite(ent.a0) && Number.isFinite(ent.a1);
        const a0 = swept ? ent.a0 : 0;
        const a1 = swept ? ent.a0 + Nasj.geom.ellipseSweep(ent) : TAU;
        c2d.ellipse(c.x, c.y, rx, ry, scrAng(ent.rot || 0), -a0, -a1, true);
        break;
      }
      case 'spline': { /* Catmull-Rom through fit points as cubic Béziers */
        const bz = Nasj.geom.splineBeziers(ent);
        if (!bz.length) break;
        const s0 = vp.worldToScreen(bz[0].a);
        c2d.moveTo(s0.x, s0.y);
        for (const seg of bz) {
          const c1 = vp.worldToScreen(seg.c1);
          const c2 = vp.worldToScreen(seg.c2);
          const b = vp.worldToScreen(seg.b);
          c2d.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
        }
        if (ent.closed) c2d.closePath();
        break;
      }
      case 'hatch': entPath(c2d, Nasj.geom.hatchBoundary(ent)); break;
      case 'face3d': /* pts carry z; a DWG's hidden edges are not stroked */
        if (ent.hid) { for (const r of Nasj.solid.edgeRuns(ent.pts, ent.hid)) polyPath(c2d, r.pts, r.closed); }
        else polyPath(c2d, ent.pts, true);
        break;
      /* a body's lines: in plan its horizontal projection — a wall's sides,
         jambs and door swings — and in a 3D view every edge of every face */
      case 'solid': case 'wall': case 'slab': {
        const runs = view3d.active ? Nasj.solid.edgesOf(ent) : Nasj.solid.planRuns(ent);
        for (const r of runs) polyPath(c2d, r.pts || r, !!r.pts && r.closed);
        break;
      }
      case 'box': { /* 12 edges; verticals collapse to points in top view */
        const s = Nasj.geom.boxCorners(ent).map(q => vp.worldToScreen(q));
        for (const ring of [0, 4]) { /* bottom + top rectangles */
          c2d.moveTo(s[ring].x, s[ring].y);
          for (let i = 1; i <= 4; i++) {
            const q = s[ring + (i % 4)];
            c2d.lineTo(q.x, q.y);
          }
        }
        for (let i = 0; i < 4; i++) { /* vertical edges */
          c2d.moveTo(s[i].x, s[i].y);
          c2d.lineTo(s[i + 4].x, s[i + 4].y);
        }
        break;
      }
    }
  };

  /* Every face and wire of every body in the draw list — the bodies
     themselves and the ones the block references hold — taken apart ONCE
     per document revision. A camera turn only culls and sorts this list;
     materialising six thousand references again on every orbit frame is
     what took seconds. ByBlock takes the reference's colour, as it always
     did; a reference whose definition holds no body is never walked. */
  let bodyListCache = { rev: -1, ents: null, src: null, items: null };
  const defBodyFlag = new WeakMap();
  const defHasBodies = (doc, name, seen) => {
    const def = doc.blocks && doc.blocks[name];
    if (!def || !Array.isArray(def.entities)) return false;
    const hit = defBodyFlag.get(def.entities);
    if (hit !== undefined) return hit;
    seen = seen || new Set();
    if (seen.has(name)) return false;
    seen.add(name);
    let has = false;
    for (const c of def.entities) {
      if (!c) continue;
      if (c.type === 'face3d' || Nasj.solid.isBody(c)) { has = true; break; }
      if (c.type === 'insert' && defHasBodies(doc, c.name, seen)) { has = true; break; }
    }
    defBodyFlag.set(def.entities, has);
    return has;
  };
  const bodyItemsOf = (doc, list) => {
    const bc = bodyListCache;
    if (bc.rev === docRev && bc.ents === doc.entities && bc.src === list) return bc.items;
    const items = [];
    const takeBody = (ent, owner, col) => {
      for (const f of Nasj.solid.facesOf(ent)) items.push({ face: f, ent: owner, col });
      for (const w of Nasj.solid.wiresOf(ent)) items.push({ wire: w, ent: owner, col });
    };
    for (const ent of list) {
      if (ent.type === 'face3d' || Nasj.solid.isBody(ent)) { takeBody(ent, ent, null); continue; }
      if (ent.type !== 'insert' || !defHasBodies(doc, ent.name)) continue;
      for (const c of Nasj.geom.insertEntities(ent, doc)) {
        if (!(c.type === 'face3d' || Nasj.solid.isBody(c))) continue;
        const col = (c.color && c.color !== 'ByBlock' && c.color !== 'ByLayer') ? c.color
          : (c.color === 'ByBlock' || !doc.layers.some((l) => l.id === c.layerId))
            ? Nasj.docOps.resolveColor(doc, ent) : Nasj.docOps.resolveColor(doc, c);
        takeBody(c, ent, col);
      }
    }
    bodyListCache = { rev: docRev, ents: doc.entities, src: list, items };
    return items;
  };
  /* the camera as the shaded pass keys its sort on: everything that moves
     a face's depth or turns one toward or away from the eye */
  const camSig = () => view3d.azimuth + '/' + view3d.elevation + '/' + view3d.roll +
    (view3d.persp ? '/p' + view3d.distance + '/' + view3d.target.x + ',' + view3d.target.y + ',' + view3d.target.z : '') +
    (xray() ? '/x' : '');
  /* X-Ray sees through a body: its back faces are kept, so their edges
     show through the front ones, and they blend under them */
  const xray = () => vstyle.alpha < 1;
  /* does this face look toward the eye? Orthographic projectors all run
     along d, so the test is the normal against d; perspective projectors
     run from the eye, so it is the normal against the line to the eye. */
  const faceVisible = (f) => {
    if (f.two) return true;
    const { d } = camBasis();
    if (!view3d.persp) return f.n[0] * d[0] + f.n[1] * d[1] + f.n[2] * d[2] > 1e-9;
    const T = view3d.target, dist = view3d.distance > 0 ? view3d.distance : 1000;
    const q = f.pts[0];
    const ex = T.x + d[0] * dist - q.x, ey = T.y + d[1] * dist - q.y;
    const ez = (T.z || 0) + d[2] * dist - ((typeof q.z === 'number' && isFinite(q.z)) ? q.z : 0);
    return f.n[0] * ex + f.n[1] * ey + f.n[2] * ez > 1e-9;
  };
  /* one face of the shaded pass: painted solid in the headlight's shade of
     its colour — or in the background, in the Hidden style, where a face
     is there only to hide — then outlined when the style shows edges */
  const drawFace = (c2d, f, color, alpha, selected, hovered) => {
    if (f.color) {                     /* a face painted its own (Color Faces) */
      color = plotColorMap ? plotColorMap(f.color, null) : f.color;
    }
    c2d.save();
    c2d.globalAlpha = alpha * vstyle.alpha;
    /* on paper a hidden face hides with the paper's own white, not the
       screen background, and edges thicken with the plot's resolution */
    c2d.fillStyle = vstyle.hidden ? (plotColorMap ? '#ffffff' : COL.bg)
      : faceFill(color, f.pts, f.n);
    c2d.beginPath();
    polyPath(c2d, f.pts, true);
    for (const h of f.holes || []) polyPath(c2d, h, true);
    c2d.fill('evenodd');
    if (vstyle.edges || selected || hovered) {
      c2d.globalAlpha = alpha;
      /* Shades of Gray outlines every body in white, whatever its colour */
      c2d.strokeStyle = selected ? COL.accentBright
        : vstyle.gray ? (plotColorMap ? plotColorMap('#ffffff', null) : '#ffffff')
          : (vstyle.hidden || vstyle.gooch) ? color : shadeColor(color, 0.75);
      c2d.lineWidth = (hovered ? 1.8 : 1.2) * (plotDashScale > 0 ? plotDashScale : 1);
      if (selected) c2d.setLineDash([5, 4]);
      /* the outline less its hidden edges — the fill above used the whole
         ring — and in Sketchy the outline as sketched strokes */
      const path = vstyle.sketch && !selected ? sketchPath : polyPath;
      /* the isolines of a curved surface show in a wireframe and the Hidden
         style, never on a shaded face — AutoCAD's Realistic draws none */
      const hid = (f.hid || 0) | (vstyle.fills && !vstyle.hidden ? (f.iso || 0) : 0);
      if (hid || path !== polyPath) {
        c2d.beginPath();
        const runs = hid ? Nasj.solid.edgeRuns(f.pts, hid) : [{ pts: f.pts, closed: true }];
        for (const r of runs) path(c2d, r.pts, r.closed);
        for (const h of f.holes || []) path(c2d, h, true);
      }
      c2d.stroke();
    }
    c2d.restore();
  };
  /* the shaded preview of a body: every face the eye sees, lit by the
     style's own light, sorted far to near; each face also stroked in its
     own fill so adjacent facets leave no seam. */
  const drawPreviewBody = (c2d, ent) => {
    let color = '#d0d0d0';
    try { const c = Nasj.docOps.resolveColor(Nasj.doc, ent); if (c && c !== 'ByLayer' && c !== 'ByBlock') color = c; } catch (_) { /* the default */ }
    const ex = v3sA * v3cE, ey = -v3cA * v3cE, ez = v3sE;
    const faces = Nasj.solid.facesOf(ent);
    const order = [];
    for (const f of faces) {
      /* every face, back ones too: a body under construction is not always
         oriented yet, and painting far to near covers what should be covered */
      let cx = 0, cy = 0, cz = 0;
      for (const p of f.pts) { cx += p.x; cy += p.y; cz += (typeof p.z === 'number' ? p.z : 0); }
      const n = f.pts.length;
      order.push({ f, d: (cx * ex + cy * ey + cz * ez) / n });
    }
    order.sort((a, b) => a.d - b.d);
    c2d.save();
    c2d.globalAlpha = 0.92;
    c2d.setLineDash([]);
    c2d.lineWidth = 0.8;
    for (const { f } of order) {
      const fill = faceFill(color, f.pts, f.n);
      c2d.fillStyle = fill;
      c2d.strokeStyle = fill;
      c2d.beginPath();
      polyPath(c2d, f.pts, true);
      for (const h of f.holes || []) polyPath(c2d, h, true);
      c2d.fill('evenodd');
      c2d.stroke();
    }
    c2d.restore();
  };
  const strokeRun = (c2d, pts, closed, color, width, alpha, dash) => {
    c2d.save();
    c2d.globalAlpha = alpha;
    c2d.strokeStyle = color;
    c2d.lineWidth = width;
    if (dash) c2d.setLineDash(dash);
    c2d.beginPath();
    if (vstyle.sketch && !dash) sketchPath(c2d, pts, closed); else polyPath(c2d, pts, closed);
    c2d.stroke();
    c2d.restore();
  };

  /* screen-space path through world points */
  const polyPath = (c2d, pts, close) => {
    if (!pts || !pts.length) return;
    const p0 = vp.worldToScreen(pts[0]);
    c2d.moveTo(p0.x, p0.y);
    for (let i = 1; i < pts.length; i++) {
      const p = vp.worldToScreen(pts[i]);
      c2d.lineTo(p.x, p.y);
    }
    if (close) c2d.closePath();
  };
  /* Sketchy's strokes, AutoCAD's line extensions and jitter: every edge
     overshoots its corners by a few pixels and is drawn twice, each pass
     displaced its own way, so the outline reads as pencil work. The
     displacements are hashed from the edge's own world coordinates, so
     they hold still from frame to frame and only change when the edge
     does. The GL layer's line shader draws the same figures. */
  const SK_EXT = 6, SK_JIT = 1.5, SK_PASSES = 2;
  const skHash = (a, b, k) => {
    const h = Math.sin(a * 12.9898 + b * 78.233 + k * 37.719) * 43758.5453;
    return h - Math.floor(h);
  };
  const skSeed = (p) => p.x * 3.1 + p.y * 5.7 + ((typeof p.z === 'number' && isFinite(p.z)) ? p.z : 0) * 7.3;
  const sketchPath = (c2d, pts, close) => {
    if (!pts || pts.length < 2) return;
    const n = pts.length, segs = close ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const A = pts[i], B = pts[(i + 1) % n];
      const a = vp.worldToScreen(A), b = vp.worldToScreen(B);
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      if (!(L > 1e-6)) continue;
      const ux = dx / L, uy = dy / L;
      const sa = skSeed(A), sb = skSeed(B);
      for (let k = 0; k < SK_PASSES; k++) {
        const ea = SK_EXT * (0.6 + 0.8 * skHash(sa, sb, k)), eb = SK_EXT * (0.6 + 0.8 * skHash(sb, sa, k));
        const ja = SK_JIT * (skHash(sa, sb, k + 5) * 2 - 1), jb = SK_JIT * (skHash(sb, sa, k + 5) * 2 - 1);
        c2d.moveTo(a.x - ux * ea - uy * ja, a.y - uy * ea + ux * ja);
        c2d.lineTo(b.x + ux * eb - uy * jb, b.y + uy * eb + ux * jb);
      }
    }
  };

  /* patterns rendered with a second, perpendicular line pass (crosshatch) */
  const CROSS_PATTERNS = { ANSI37: 1, NET: 1, GRID: 1, SQUARE: 1 };
  const isCrossPattern = (name) => {
    const u = String(name || '').toUpperCase();
    return !!u && (u.indexOf('CROSS') >= 0 || CROSS_PATTERNS[u] === 1);
  };

  /* ---------------- hatch pattern library ----------------
   * Each pattern is a list of line FAMILIES rendered inside the clipped
   * boundary. Per family: ang (deg, added to ent.angle), sp (multiple of the
   * base spacing), off (perpendicular offset, fraction of the family
   * spacing), dash (on/off run lengths as fractions of the base spacing).
   * Base spacing keeps the native contract: ent.sp (imported, world units)
   * or 6 * ent.scale. Visual approximations of the acad.pat standards —
   * close enough to read as the named material on a drawing. */
  const HATCH_PATTERNS = {
    ANSI31: [{ ang: 45 }],
    ANSI32: [{ ang: 45, sp: 3 }, { ang: 45, sp: 3, off: 0.29 }],
    ANSI33: [{ ang: 45, sp: 2 }, { ang: 45, sp: 2, off: 0.5, dash: [0.5, 0.25] }],
    ANSI34: [{ ang: 45, sp: 6 }, { ang: 45, sp: 6, off: 0.12 }],
    ANSI35: [{ ang: 45, sp: 2 }, { ang: 45, sp: 2, off: 0.5, dash: [1.25, 0.25, 0.25, 0.25] }],
    ANSI36: [{ ang: 45, sp: 2, dash: [1.25, 0.25, 0.25, 0.25] }],
    ANSI37: [{ ang: 45 }, { ang: 135 }],
    ANSI38: [{ ang: 45 }, { ang: 135, sp: 2, dash: [1.25, 0.5] }],
    ANGLE: [{ ang: 0, dash: [0.7, 0.3] }, { ang: 90, dash: [0.7, 0.3] }],
    BRICK: [{ ang: 0 }, { ang: 90, sp: 2, dash: [1, 1] }],
    DASH: [{ ang: 45, dash: [0.6, 0.4] }],
    DOLMIT: [{ ang: 0 }, { ang: 45, sp: 4 }],
    DOTS: [{ ang: 0, dash: [0.06, 0.94], dot: true }],
    EARTH: [{ ang: 0, dash: [0.7, 0.3] }, { ang: 0, off: 0.5, dash: [0.7, 0.3], shift: 0.5 },
      { ang: 90, dash: [0.7, 0.3] }],
    FLEX: [{ ang: 0, dash: [0.5, 0.5] }],
    GRASS: [{ ang: 45, sp: 3, dash: [0.35, 2.65], dot: false },
      { ang: 135, sp: 3, dash: [0.35, 2.65] }],
    GRATE: [{ ang: 0, sp: 0.5 }, { ang: 90, sp: 2 }],
    HEX: [{ ang: 0, dash: [0.6, 1.2] }, { ang: 60, dash: [0.6, 1.2] }, { ang: 120, dash: [0.6, 1.2] }],
    HONEY: [{ ang: 0, dash: [0.5, 1] }, { ang: 60, dash: [0.5, 1] }, { ang: 120, dash: [0.5, 1] }],
    INSUL: [{ ang: 0, sp: 2 }, { ang: 0, sp: 2, off: 0.17 }, { ang: 0, sp: 2, off: 0.34 }],
    LINE: [{ ang: 0 }],
    MUDST: [{ ang: 0, dash: [0.5, 0.25, 0.05, 0.25] }],
    NET: [{ ang: 0 }, { ang: 90 }],
    NET3: [{ ang: 0 }, { ang: 90 }, { ang: 45 }],
    PLAST: [{ ang: 0, sp: 2 }, { ang: 0, sp: 2, off: 0.25 }, { ang: 0, sp: 2, off: 0.45 }],
    SACNCR: [{ ang: 45 }, { ang: 45, off: 0.5, dash: [0.05, 0.95], dot: true }],
    SQUARE: [{ ang: 0, dash: [0.5, 0.5] }, { ang: 90, dash: [0.5, 0.5] }],
    STEEL: [{ ang: 45, sp: 2 }, { ang: 45, sp: 2, off: 0.25 }],
    TRANS: [{ ang: 0 }, { ang: 0, off: 0.5, dash: [0.5, 0.5] }],
    TRIANG: [{ ang: 0, dash: [0.6, 0.6] }, { ang: 60, dash: [0.6, 0.6] }, { ang: 120, dash: [0.6, 0.6] }],
    ZIGZAG: [{ ang: 0, dash: [0.4, 0.4] }, { ang: 90, sp: 2, dash: [0.4, 1.2] }]
  };
  Nasj.hatchPatternNames = () => ['SOLID'].concat(Object.keys(HATCH_PATTERNS));
  Nasj.hatchPatternDef = (name) => HATCH_PATTERNS[String(name || '').toUpperCase()] || null;

  /* ---------------- gradient library (GRADIENT) ----------------
   * Each name is a colour ramp across the boundary box: `radial` picks the
   * shape, `stops` are [position, which colour] with 0 = colour 1 and 1 =
   * colour 2, and `dome` pushes a radial highlight off centre so the fill
   * reads as a hemisphere rather than a ball. The industry-standard gradient names,
   * built from the transition each one is named for. */
  const GRADIENTS = {
    GR_LINEAR: { stops: [[0, 0], [1, 1]] },
    GR_CYLIN: { stops: [[0, 0], [0.5, 1], [1, 0]] },
    GR_INVCYL: { stops: [[0, 1], [0.5, 0], [1, 1]] },
    GR_CURVED: { stops: [[0, 0], [0.72, 1], [1, 1]] },
    GR_INVCURVED: { stops: [[0, 1], [0.28, 0], [1, 0]] },
    GR_SPHER: { radial: true, stops: [[0, 1], [1, 0]] },
    GR_INVSPHER: { radial: true, stops: [[0, 0], [1, 1]] },
    GR_HEMISP: { radial: true, dome: true, stops: [[0, 1], [1, 0]] },
    GR_INVHEMISP: { radial: true, dome: true, stops: [[0, 0], [1, 1]] }
  };
  Nasj.gradientNames = () => Object.keys(GRADIENTS);
  Nasj.gradientDef = (name) => GRADIENTS[String(name || '').toUpperCase()] || GRADIENTS.GR_LINEAR;

  const hex2rgb = (h) => {
    const s = String(h || '').replace('#', '');
    const t = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
    const n = parseInt(t, 16);
    return isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [63, 169, 224];
  };
  const mixHex = (a, b, t) => {
    const A = hex2rgb(a), B = hex2rgb(b);
    const v = (i) => Math.round(A[i] + (B[i] - A[i]) * t);
    return `rgb(${v(0)},${v(1)},${v(2)})`;
  };
  /* the pair a gradient actually paints: one-colour mode tints colour 1
     toward white by the tint percentage instead of using colour 2 */
  Nasj.gradientColors = (g) => {
    const c1 = (g && g.c1) || '#3fa9e0';
    if (g && g.one) return [c1, mixHex(c1, '#ffffff', Math.min(1, Math.max(0, (g.tint || 0) / 100)))];
    return [c1, (g && g.c2) || '#12384f'];
  };

  /* hatch interior: SOLID fill / patterned line families clipped to the
     boundary (with render-only island holes via even-odd clipping) */
  const drawHatchPattern = (c2d, ent, color, alpha0) => {
    const bnd = Nasj.geom.hatchBoundary(ent);
    /* Hatch Transparency (0–90%), a property of the fill only */
    const tr = Math.min(90, Math.max(0, Number(ent.transp) || 0));
    const alpha = alpha0 * (1 - tr / 100);
    c2d.save();
    c2d.beginPath();
    entPath(c2d, bnd);
    /* islands traced at creation punch render-time holes (the industry standard "Outer") */
    const isles = Array.isArray(ent.islands) ? ent.islands : null;
    if (isles) {
      for (const loop of isles) {
        if (Array.isArray(loop) && loop.length >= 3) polyPath(c2d, loop, true);
      }
    }
    const pat = ent.pattern === 'SOLID' ? null
      : (HATCH_PATTERNS[String(ent.pattern || '').toUpperCase()] || HATCH_PATTERNS.ANSI31);
    if (pat) {
      c2d.clip(isles ? 'evenodd' : 'nonzero');
      const b = Nasj.geom.entityBounds(bnd);
      /* imported hatches carry the true pattern line spacing (ent.sp,
         world units) — native hatches fit the pattern to the shape:
         spacing = sqrt(bbox area)/30 × scale, so a 5-unit tile and a
         5000-unit site both show ~42 lines across at scale 1 (dxf.js
         exports the same spacing) */
      const bw = b.maxx - b.minx, bh = b.maxy - b.miny;
      const fit = (bw > 0 && bh > 0) ? Math.sqrt(bw * bh) / 30 : 0;
      const base = (typeof ent.sp === 'number' && isFinite(ent.sp) && ent.sp > 0)
        ? ent.sp : (fit > 0 ? fit : 6) * (ent.scale > 0 ? ent.scale : 1); /* world units */
      const cx = (b.minx + b.maxx) / 2, cy = (b.miny + b.maxy) / 2;
      const D0 = Math.hypot(b.maxx - b.minx, b.maxy - b.miny) / 2;
      c2d.globalAlpha = alpha;
      c2d.strokeStyle = color;
      c2d.lineWidth = 1;
      /* legacy crosshatch contract for imported patterns kept via patName */
      let fams = pat;
      if (fams.length === 1 && isCrossPattern(ent.patName)) {
        fams = [fams[0], Object.assign({}, fams[0], { ang: (fams[0].ang || 0) + 90 })];
      }
      /* a family under ~2px apart is tone, not lines: hundreds of
         sub-pixel hairlines shimmer as moiré and cost per line, while the
         same tone is one low-alpha fill of the boundary (whose path is
         still current from the clip above) — which is what a dense hatch
         looks like anyway */
      let dense = false;
      for (const fam of fams) {
        if (base * (fam.sp > 0 ? fam.sp : 1) * vp.scale < 2) dense = true;
      }
      if (dense) {
        c2d.globalAlpha = alpha * 0.25;
        c2d.fillStyle = color;
        c2d.fill(isles ? 'evenodd' : 'nonzero');
        c2d.globalAlpha = alpha;
      }
      for (const fam of fams) {
        const spacing = base * (fam.sp > 0 ? fam.sp : 1);
        if (spacing * vp.scale < 2) continue;
        const th = ((fam.ang || 0) + (ent.angle || 0)) * Math.PI / 180;
        const ux = Math.cos(th), uy = Math.sin(th); /* line direction */
        const nx = -uy, ny = ux;                    /* normal */
        const D = D0 + spacing;
        const basePos = cx * nx + cy * ny;          /* origin-anchored pattern */
        const shift = (fam.off > 0 ? fam.off : 0) * spacing;
        const o0 = Math.ceil((basePos - D - shift) / spacing) * spacing + shift;
        c2d.setLineDash(fam.dash ? fam.dash.map((d) => Math.max(0.5, d * base * vp.scale)) : []);
        if (fam.dot) c2d.lineCap = 'round';
        c2d.beginPath();
        let guard = 0;
        for (let o = o0; o <= basePos + D && guard++ < 1200; o += spacing) {
          const pcx = cx + nx * (o - basePos), pcy = cy + ny * (o - basePos);
          const s1 = vp.worldToScreen({ x: pcx - ux * D, y: pcy - uy * D });
          const s2 = vp.worldToScreen({ x: pcx + ux * D, y: pcy + uy * D });
          c2d.moveTo(s1.x, s1.y);
          c2d.lineTo(s2.x, s2.y);
        }
        c2d.stroke();
        if (fam.dot) c2d.lineCap = 'butt';
      }
      c2d.setLineDash([]);
    } else if (ent.grad) { /* GRADIENT: a named colour ramp across the box */
      const b = Nasj.geom.entityBounds(bnd);
      const def = Nasj.gradientDef(ent.grad.name);
      const cols = Nasj.gradientColors(ent.grad);
      const cx = (b.minx + b.maxx) / 2, cy = (b.miny + b.maxy) / 2;
      const R = Math.hypot(b.maxx - b.minx, b.maxy - b.miny) / 2 || 1;
      const th = ((ent.angle || 0) * Math.PI) / 180;
      const ux = Math.cos(th), uy = Math.sin(th);
      /* the industry standard's "Centered" off, and every dome, throw the highlight off
         centre so the fill reads as lit from one side */
      const off = (ent.grad.centered === false ? 0.45 : 0) + (def.dome ? 0.5 : 0);
      const hx = cx - ux * R * off, hy = cy - uy * R * off;
      let g;
      if (def.radial) {
        const h = vp.worldToScreen({ x: hx, y: hy });
        g = c2d.createRadialGradient(h.x, h.y, 0, h.x, h.y, R * vp.scale * (1 + off));
      } else {
        const s1 = vp.worldToScreen({ x: hx - ux * R, y: hy - uy * R });
        const s2 = vp.worldToScreen({ x: hx + ux * R, y: hy + uy * R });
        g = c2d.createLinearGradient(s1.x, s1.y, s2.x, s2.y);
      }
      for (const [pos, which] of def.stops) g.addColorStop(pos, cols[which]);
      c2d.globalAlpha = alpha;    /* a gradient is the drawing, not a screen aid */
      c2d.fillStyle = g;
      c2d.fill(isles ? 'evenodd' : 'nonzero');
    } else { /* SOLID */
      /* A SOLID FILL IS INK, NOT A WASH. It used to go on at .45 alpha, so a
         black fill came out a grey haze and the grid, the axes and every
         older fill under it read straight through — the industry standard's solid fill
         hides what it covers, and a fill you cannot get to black is not a
         poché. Transparency is what makes a fill see-through, and it is a
         property of the hatch (ent.transp, already in `alpha`), so the
         fill goes on at the alpha it was given.
         SPEC3 §23: a SOLID hatch of '@bg' is a wipeout — fully opaque
         whatever its transparency. Plotting with "Plot transparency" off
         (the industry-standard default) is opaque too: transparency is a screen aid,
         not ink. */
      c2d.globalAlpha = (ent.color === '@bg' || plotOpaqueFills) ? 1 : alpha;
      c2d.fillStyle = (plotFillPatterns && ent.color !== '@bg')
        ? fillPatternFor(c2d, color) : color;
      c2d.fill(isles ? 'evenodd' : 'nonzero');
    }
    c2d.restore();
  };

  /* ---------------- linetypes (SPEC3 §23) ---------------- */
  /* screen-space dash patterns; selection/preview overlays are unaffected
     because they always pass their own dash explicitly */
  const LT_DASH = {
    dashed: [8, 4],
    center: [16, 4, 3, 4],
    hidden: [5, 3],
    dot: [1.5, 3]
  };
  /* MKLTYPE: a linetype made from geometry joins the dash table live */
  Nasj.registerLinetype = (name, dash) => {
    if (typeof name !== 'string' || !name || !Array.isArray(dash) || dash.length < 2) return false;
    LT_DASH[name.toLowerCase()] = dash.map(Number);
    return true;
  };

  /* plot-mode hooks (Nasj.plotRender): remap colors of insert children for
     the active plot style table and scale screen-space dashes to plot dpi */
  let plotColorMap = null;
  let plotDashScale = 0;
  /* plot-mode: solid hatches print opaque unless "Plot transparency" is on */
  /* LAYLOCKFADECTL: how far a locked layer fades back, as a percentage */
  const lockedAlpha = (ly) => {
    if (!ly || !ly.locked) return 1;
    const f = Nasj.settings && isFinite(Nasj.settings.lockFade) ? Nasj.settings.lockFade : 50;
    return Math.max(0.05, 1 - Math.min(90, Math.max(0, f)) / 100);
  };
  let plotOpaqueFills = false;
  /* plot-mode: Fill Patterns.ctb prints filled areas as a pattern, not flat ink.
     The nine industry-standard tiles, chosen by the nearest standard colour index. */
  let plotFillPatterns = false;
  const FILL_TILES = [
    null,                                                       /* solid */
    [[0, 0, 4, 4], [4, 4, 4, 4]],                               /* checkerboard */
    [[0, 3, 8, 2], [3, 0, 2, 8]],                               /* crosshatch */
    [[3, 0, 2, 2], [0, 3, 2, 2], [6, 3, 2, 2], [3, 6, 2, 2]],   /* diamonds */
    [[0, 2, 8, 2]],                                             /* horizontal bars */
    [[0, 0, 2, 2], [2, 2, 2, 2], [4, 4, 2, 2], [6, 6, 2, 2]],   /* slant left */
    [[6, 0, 2, 2], [4, 2, 2, 2], [2, 4, 2, 2], [0, 6, 2, 2]],   /* slant right */
    [[1, 1, 2, 2], [5, 5, 2, 2]],                               /* square dots */
    [[2, 0, 2, 8]]                                              /* vertical bar */
  ];
  const ACI9 = [[255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255],
    [255, 0, 255], [255, 255, 255], [128, 128, 128], [192, 192, 192]];
  const fillPatternFor = (c2d, hex) => {
    const c = hexRgb(hex) || { r: 0, g: 0, b: 0 };
    let best = 0, bestD = Infinity;
    ACI9.forEach((a, i) => {
      const d = (a[0] - c.r) * (a[0] - c.r) + (a[1] - c.g) * (a[1] - c.g) +
        (a[2] - c.b) * (a[2] - c.b);
      if (d < bestD) { bestD = d; best = i; }
    });
    const tile = FILL_TILES[best];
    if (!tile) return hex;                     /* this colour prints solid */
    const cv = document.createElement('canvas');
    cv.width = 8;
    cv.height = 8;
    const g = cv.getContext('2d');
    g.fillStyle = hex;
    for (const t of tile) g.fillRect(t[0], t[1], t[2], t[3]);
    return c2d.createPattern(cv, 'repeat') || hex;
  };
  /* POCHÉ MODE: closed polylines on layers matching /^A-WALL/ fill solid
     with their resolved color (walls read as figure). Model/paper renders
     follow Nasj.settings.poche; Nasj.plotRender follows opts.pocheWalls.
     The flag is set at the start of every render pass. */
  let pocheMode = false;

  const ltDashOf = (ent) => {
    const doc = Nasj.doc;
    let lt;
    if (doc && Nasj.docOps && Nasj.docOps.resolveLt) lt = Nasj.docOps.resolveLt(doc, ent);
    else lt = (ent.lt && ent.lt !== 'ByLayer') ? ent.lt : 'continuous';
    let dash = LT_DASH[lt] || null;
    if (dash) {
      /* entity linetype scale (lts), clamped so dashes stay visible */
      const lts = (typeof ent.lts === 'number' && isFinite(ent.lts) && ent.lts > 0)
        ? Math.min(50, Math.max(0.05, ent.lts)) : 1;
      const f = lts * (plotDashScale > 0 ? plotDashScale : 1);
      if (f !== 1) dash = dash.map((v) => v * f);
    }
    return dash;
  };

  /* GREEKING (screen only, never plot/export): below ~3px a glyph is an
     unreadable smudge, yet the font machinery still costs more than every
     other entity kind combined — 6k tiny texts froze zoom for ~185ms per
     settle. One translucent bar keeps the text's footprint on screen for
     ~1% of the cost. */
  const GREEK_PX = 3;
  /* Legible glyphs are shaped per fillText call (~0.1ms each, and the state
     churn around them is peanuts by comparison — measured, not guessed): a
     view holding thousands of small-but-legible texts froze every zoom
     settle for ~170ms. Each scene pass therefore budgets the glyphs: when
     more than GREEK_BUDGET texts in view clear the base cutoff, the cutoff
     rises so only the GREEK_BUDGET LARGEST — the readable, informative
     ones — get real glyphs and the rest draw as bars. Sparse views never
     hit the budget and render exactly as before. */
  const GREEK_BUDGET = 800;
  let greekCutoff = GREEK_PX;   /* per-scene-pass; hover reads it too so the
                                   two passes always agree on representation */
  /* No save/restore here: 6k bars × the state-stack round trip cost more
     than the glyphs they replaced. Alpha is unwound by hand; the transform
     is touched only for rotated text. */
  const drawGreekBar = (c2d, str, px, x, y, rot, align, color, alpha) => {
    const w = px * 0.55 * Math.min(str.length, 80);
    const dx = align === 'center' ? -w / 2 : (align === 'right' ? -w : 0);
    const ga = c2d.globalAlpha;
    c2d.globalAlpha = alpha * 0.5;
    c2d.fillStyle = color;
    if (rot || twist) {
      const tf = c2d.getTransform();
      c2d.translate(x, y);
      c2d.rotate(scrAng(rot));
      c2d.fillRect(dx, -px * 0.8, w, px * 0.9);
      c2d.setTransform(tf);
    } else {
      c2d.fillRect(x + dx, y - px * 0.8, w, px * 0.9);
    }
    c2d.globalAlpha = ga;
  };

  /* Assigning c2d.font re-parses the CSS font string every time, and
     save/restore pops it — so each small text used to pay a full parse
     (~0.1ms; the dominant cost of a text-heavy drawing, not the glyphs).
     Set-if-changed through this cache instead. Any pass that may inherit
     a context someone else set fonts on resets it (renderSceneInto,
     plotRender). */
  let fontC2d = null, fontLast = '', dirLast = '';
  const resetFontCache = () => { fontC2d = null; fontLast = ''; dirLast = ''; };

  /* A DXF/DWG text height is the CAP height (baseline to the top of the
     capitals), and Top/Middle/Bottom justify that cap box — a CSS font-size
     is the em, and the canvas baselines follow the FONT's own box. Both
     ratios are asked of the face once, off a scratch context so the cache
     above never sees the probe. Arial at cap height reproduces the industry standard's own
     measured advance for arial.ttf styles to 0.4% (its MTEXT group 42). */
  /* One ratio per FACE: a style that names Segoe UI Light puts its capitals
     somewhere Arial does not, and the em that lands them on the stated cap
     height moves with it. The descender ratio stays Arial's, which is the
     face the baseline offsets were matched against. */
  /* FONTALT. A font the machine does not have is a font the industry standard draws with
     its own stroke font instead — on this drawing that is 14 of its 59
     styles, every VNI-* and Bitstream face among them. The canvas answers
     the same question by measuring: a family it cannot resolve falls
     through to the stack's last entry, so it measures exactly as a name
     nobody has. Memoized per family; the probe never touches the font
     cache the draw path rides. */
  /* one scratch context for every face question ever asked: a canvas per
     probe cost most of the first frame that met a drawing's style table */
  let probeC2d = null;
  const probeCtx = () => (probeC2d ||
    (probeC2d = document.createElement('canvas').getContext('2d')));
  const FACE_PROBE = 'HAMBURGEFONTSIV mwq 1234';
  let monoW = 0;
  const resolves = new Map();
  const faceResolves = (fam) => {
    if (!fam) return false;
    let ok = resolves.get(fam);
    if (ok === undefined) {
      const m = probeCtx();
      if (!monoW) { m.font = '80px monospace'; monoW = m.measureText(FACE_PROBE).width; }
      m.font = '80px "' + fam + '", monospace';
      ok = m.measureText(FACE_PROBE).width !== monoW;
      resolves.set(fam, ok);
    }
    return ok;
  };

  let descR = 0;
  const capRs = new Map();
  const capRatio = (fam) => {
    const key = fam || 'Arial';
    let r = capRs.get(key);
    if (r === undefined) {
      /* probed at 1000px, not 200: the canvas quantizes an ink metric, and
         at 200 the quantum is half a percent of the em — which showed up as
         half a percent of extra width on every imported label */
      const m = probeCtx();
      m.font = '1000px "' + key + '", "Segoe UI", sans-serif';
      const g = m.measureText('H');
      r = (g.actualBoundingBoxAscent > 0) ? g.actualBoundingBoxAscent / 1000 : 0.715;
      capRs.set(key, r);
      if (key === 'Arial') {
        descR = (g.fontBoundingBoxDescent > 0) ? g.fontBoundingBoxDescent / 1000 : 0.21;
      } else if (!descR) capRatio('Arial');
    }
    return r;
  };
  const setFontCached = (c2d, f, dir) => {
    if (c2d !== fontC2d) { fontC2d = c2d; fontLast = ''; dirLast = ''; }
    if (f !== fontLast) { c2d.font = f; fontLast = f; }
    if (dir !== dirLast) { c2d.direction = dir; dirLast = dir; }
  };

  /* dim/leader/table anno text ({p,str,h,ang,anchor,knockout}) */
  const drawAnnoText = (c2d, t, color, alpha, primary) => {
    const str = String(t.str == null ? '' : t.str);
    if (!str.length) return;
    const s = vp.worldToScreen(t.p);
    const px = Math.max(t.h * vp.scale, 0.5);
    if (px < GREEK_PX && !plotDashScale) {
      drawGreekBar(c2d, str, px, s.x, s.y, t.ang || 0,
        t.anchor === 'center' ? 'center' : 'left', t.color || color, alpha);
      return;
    }
    c2d.save();
    c2d.globalAlpha = alpha;
    c2d.translate(s.x, s.y);
    if (t.ang || twist) c2d.rotate(scrAng(t.ang || 0));
    /* a dimension writes in the text style its dimension style names */
    c2d.font = t.font
      ? (String(t.fstyle || '').indexOf('Italic') >= 0 ? 'italic ' : '') +
        (String(t.fstyle || '').indexOf('Bold') >= 0 ? 'bold ' : '') +
        px + 'px "' + t.font + '", "Segoe UI", sans-serif'
      : px + 'px "Segoe UI", sans-serif';
    if (t.color) color = t.color;
    if (t.anchor === 'center') {
      c2d.textAlign = 'center';
      c2d.textBaseline = 'middle';
      /* the background behind the measurement: the dimension style's fill
         colour, else the knockout that keeps the line out of the text */
      if (primary && (t.knockout || t.fill)) {
        const w = c2d.measureText(str).width;
        c2d.fillStyle = t.fill || knockoutColor;
        c2d.fillRect(-w / 2 - px * 0.25, -px * 0.65, w + px * 0.5, px * 1.3);
      }
      if (primary && t.frame) {          /* Basic tolerance, or a boxed value */
        const w = c2d.measureText(str).width;
        c2d.strokeStyle = color;
        c2d.lineWidth = Math.max(1, px * 0.05);
        c2d.setLineDash([]);
        c2d.strokeRect(-w / 2 - px * 0.3, -px * 0.72, w + px * 0.6, px * 1.44);
      }
    } else {
      c2d.textAlign = 'left';
      c2d.textBaseline = 'alphabetic';
    }
    c2d.fillStyle = color;
    c2d.fillText(str, 0, 0);
    c2d.restore();
  };

  /* dim/leader/table: segments + arcs + filled arrowheads + text (+fills) */
  const drawAnno = (c2d, ent, color, lineWidth, dash, alpha, primary) => {
    const G = Nasj.geom.entityAnno(ent);
    if (!G) return;
    c2d.save();
    c2d.globalAlpha = alpha;
    c2d.strokeStyle = color;
    c2d.fillStyle = color;
    c2d.lineWidth = lineWidth;
    c2d.lineCap = 'round';
    c2d.lineJoin = 'round';
    if (primary && G.fills.length) { /* table row fills */
      for (const f of G.fills) {
        c2d.save();
        c2d.globalAlpha = alpha * (f.alpha == null ? 0.12 : f.alpha);
        if (f.color) c2d.fillStyle = f.color;
        c2d.beginPath();
        polyPath(c2d, f.pts, true);
        c2d.fill();
        c2d.restore();
      }
    }
    /* A dimension style can give the dimension line and the extension lines
       a colour, linetype and lineweight of their own; ByBlock (the default)
       is the dimension's own. Segments carry which part they belong to, so
       each group is stroked with what its part asks for. */
    const part = (kind) => {
      /* a table's borders belong to the cell style of the row they edge */
      if (primary && ent.type === 'table' && /-bord$/.test(String(kind))) {
        const st = Nasj.geom.tableStyleOf(Nasj.doc, ent);
        const k = String(kind).charAt(0);
        const c = st[k + 'BordClr'], lt = st[k + 'BordLt'], lw = st[k + 'BordLw'];
        return {
          color: (c && c !== 'ByBlock' && c !== 'ByLayer') ? c : color,
          dash: (lt && lt !== 'ByBlock' && lt !== 'ByLayer')
            ? (LT_DASH[String(lt).toLowerCase()] || dash) : dash,
          width: isFinite(Number(lw)) && Number(lw) > 0 && Nasj.settings.lwt
            ? Math.max(lineWidth, Number(lw) * 2.2) : lineWidth,
        };
      }
      if (primary && (ent.type === 'dim' || ent.type === 'leader')) {
        const lead = ent.type === 'leader';
        const st = lead ? Nasj.geom.mleaderStyleOf(Nasj.doc, ent)
          : Nasj.geom.dimStyleOf(Nasj.doc, ent);
        const c = lead ? st.clr : (kind === 'ext' ? st.clre : st.clrd);
        const lt = lead ? st.lt : (kind === 'ext' ? st.lte1 : st.ltd);
        const lw = lead ? st.lw : (kind === 'ext' ? st.lwe : st.lwd);
        return {
          color: (c && c !== 'ByBlock' && c !== 'ByLayer') ? c : color,
          dash: (lt && lt !== 'ByBlock' && lt !== 'ByLayer')
            ? (LT_DASH[String(lt).toLowerCase()] || dash) : dash,
          width: isFinite(Number(lw)) && Number(lw) > 0 && Nasj.settings.lwt
            ? Math.max(lineWidth, Number(lw) * 2.2) : lineWidth,
        };
      }
      return { color, dash, width: lineWidth };
    };
    const groups = new Map();
    for (const s of G.segs) {
      const kind = s[2] || 'dim';
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind).push(s);
    }
    if (!groups.size) groups.set('dim', []);
    for (const [kind, segs] of groups) {
      const p = part(kind);
      c2d.strokeStyle = p.color;
      c2d.lineWidth = p.width;
      c2d.setLineDash(p.dash || []);
      c2d.beginPath();
      for (const [a, b] of segs) {
        const s1 = vp.worldToScreen(a), s2 = vp.worldToScreen(b);
        c2d.moveTo(s1.x, s1.y);
        c2d.lineTo(s2.x, s2.y);
      }
      /* the arcs belong to the dimension line (an angular dimension's) */
      if (kind === 'dim') {
        for (const A of G.arcs) {
          if (A.fill) continue;
          const c = vp.worldToScreen(A.c);
          const r = Math.max(A.r * vp.scale, 0.01);
          const sp = vp.worldToScreen(Nasj.geom.arcPoint(A, A.a0));
          c2d.moveTo(sp.x, sp.y);
          c2d.arc(c.x, c.y, r, scrAng(A.a0), scrAng(A.a1), true);
        }
      }
      c2d.stroke();
    }
    const pd = part('dim');
    c2d.strokeStyle = pd.color;
    c2d.fillStyle = pd.color;
    c2d.setLineDash([]);
    for (const tri of G.arrows) {
      c2d.beginPath();
      polyPath(c2d, tri, true);
      c2d.fill();
    }
    for (const A of G.arcs) {            /* dot arrowheads */
      if (!A.fill) continue;
      const c = vp.worldToScreen(A.c);
      c2d.beginPath();
      c2d.arc(c.x, c.y, Math.max(A.r * vp.scale, 0.5), 0, TAU);
      c2d.fill();
    }
    c2d.fillStyle = color;
    for (const t of G.texts) drawAnnoText(c2d, t, color, alpha, primary);
    c2d.restore();
  };

  const drawText = (c2d, ent, color, alpha) => {
    /* imported CAD text carries ha/va (DXF justification); native Nasjicad
       text has neither and renders exactly as before (SPEC2 §15). */
    const imported = ent.ha != null || ent.va != null;
    /* CAD text is the text an import made, and it says so: `cad` is the mark
       the converters stamp on. The rule this decides is the CAD convention —
       height means CAP height, and the face measures as the industry standard's does —
       not this app's own em-sized text. It used to be read off the ABSENCE
       of a style name, on the grounds that every converter dropped the STYLE
       table; the moment imported text started carrying the style it was
       drawn with, that reading would have sent every label in every opened
       drawing back to this app's UI font at its own em height. Text with no
       style at all is still CAD text, so drawings made before the mark
       existed keep the metrics they were drawn with. */
    const cad = ent.cad === true || !ent.style;
    const ha = imported && typeof ent.ha === 'number' ? ent.ha : 0;
    const va = imported && typeof ent.va === 'number' ? ent.va : 0;
    const p2ok = ent.p2 && isFinite(ent.p2.x) && isFinite(ent.p2.y);
    const anchor = ((ha || va) && p2ok) ? ent.p2 : ent.p;
    const s = vp.worldToScreen(anchor);
    const px = Math.max((ent.h || 5) * vp.scale, 0.5);
    if (px < greekCutoff && !plotDashScale) {
      const strG = String(ent.str == null ? '' : ent.str);
      if (strG.length) {
        drawGreekBar(c2d, strG.split('\n', 1)[0], px, s.x, s.y, ent.rot || 0,
          (ha === 1 || ha === 4) ? 'center' : (ha === 2 ? 'right' : 'left'),
          color, alpha);
      }
      return;
    }
    /* the text style the object names (null for imported text, which carries
       none): its font and effects are read here, so editing a style redraws
       everything drawn with it */
    const st = Nasj.docOps.textStyleOf(Nasj.doc, ent);
    /* THE FACE. The one the import stamped on the object wins — a payload's
       style table has no seat on docFromImport, so an opened drawing's own
       Standard would otherwise resolve against THIS app's style of that
       name. Then the style the object names, then this app's own default.
       A face this machine does not have goes the way the industry standard's FONTALT
       sends it: to the stroke font, not to whatever the canvas would
       silently substitute. */
    const want = ent.fnt || (st ? st.font : (cad ? 'Arial' : null));
    const fam = (want && !faceResolves(want))
      ? ((Nasj.dxf && Nasj.dxf.SHX_FACE) || 'Segoe UI Light') : want;
    /* no save/restore — it pops font/direction and forces the re-parse the
       cache above exists to avoid; alpha and transform unwind by hand */
    /* px is the CAP height; CAD text asks THE FACE for the em that puts its
       capitals there, so a 4.4-unit label measures 4.4 units tall and as
       wide as the industry standard draws it. */
    const fpx = cad ? px / capRatio(fam) : px;
    const fst = ent.fst || (st ? st.fstyle : '');
    const font = (fst.indexOf('Italic') >= 0 ? 'italic ' : '') +
      (fst.indexOf('Bold') >= 0 ? 'bold ' : '') +
      fpx + (fam ? 'px "' + fam + '", "Segoe UI", sans-serif' : 'px "Segoe UI", sans-serif');
    /* the bidi base follows the text's first strong character, so an
       Arabic line lays its runs out right-to-left the way it was written —
       the canvas otherwise assumes the document's LTR and scrambles a
       mixed line like "مبنى A" */
    const strTxt = String(ent.str == null ? '' : ent.str);
    const strong = strTxt.match(/[A-Za-z]|[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/);
    setFontCached(c2d, font, (strong && strong[0] >= '\u0590') ? 'rtl' : 'ltr');
    const ga = c2d.globalAlpha;
    c2d.globalAlpha = alpha;
    c2d.fillStyle = color;
    c2d.textAlign = (ha === 1 || ha === 4) ? 'center' : (ha === 2 ? 'right' : 'left');
    /* CAD text justifies the CAP box, so it draws on the baseline and takes
       the offset by hand; the canvas baselines measure the font's own box
       and would drift with the em the face happens to use */
    const dy = cad
      ? ((ha === 4 || va === 2) ? px / 2 : (va === 3 ? px : (va === 1 ? -fpx * descR : 0)))
      : 0;
    c2d.textBaseline = cad ? 'alphabetic'
      : ((ha === 4 || va === 2) ? 'middle'
        : (va === 3 ? 'top' : (va === 1 ? 'bottom' : 'alphabetic')));
    const tf = c2d.getTransform();
    c2d.translate(s.x, s.y);
    if (ent.rot || twist) c2d.rotate(scrAng(ent.rot || 0));
    /* the style's oblique angle slants the letters about the baseline; the
       y axis runs down the screen, so the shear is negated with it */
    const obl = ent.obl || (st ? st.oblique : 0);
    if (obl) c2d.transform(1, 0, Math.tan(-obl * Math.PI / 180), 1, 0, 0);
    const wf = (typeof ent.wf === 'number' && isFinite(ent.wf) && ent.wf > 0) ? ent.wf : 1;
    const k = wf * (st && st.backwards ? -1 : 1);
    const ky = (st && st.upside) ? -1 : 1;
    /* scaling about the translated anchor keeps the alignment point fixed */
    if (k !== 1 || ky !== 1) c2d.scale(k, ky);
    if (st && st.vertical) {
      /* a vertical style stacks the characters down the insertion point */
      c2d.textAlign = 'center';
      c2d.textBaseline = 'middle';
      [...String(ent.str == null ? '' : ent.str).replace(/\n/g, '')]
        .forEach((ch, i) => c2d.fillText(ch, 0, px * (0.5 + i)));
    } else if (ent.mt) {
      /* MTEXT: p is the top-left corner; lines stack down at 1.6 × height */
      if (!cad) c2d.textBaseline = 'top';
      const lineH = px * 1.6;
      String(ent.str == null ? '' : ent.str).split('\n')
        .forEach((ln, i) => c2d.fillText(ln, 0, dy + i * lineH));
    } else {
      c2d.fillText(String(ent.str == null ? '' : ent.str), 0, dy);
    }
    c2d.setTransform(tf);
    c2d.globalAlpha = ga;
  };

  /* the PDMODE glyph, shared with the Point Style dialog's previews:
     base 0 dot / 1 nothing / 2 + / 3 × / 4 tick; +32 rings a circle
     around it, +64 boxes it, +96 does both */
  Nasj.drawPointGlyph = (c2d, x, y, r, mode) => {
    const base = mode % 32;
    c2d.beginPath();
    if (base === 0) {
      c2d.arc(x, y, Math.max(1.2, r * 0.12), 0, TAU);
      c2d.fill();
      c2d.beginPath();
    }
    if (base === 2) {
      c2d.moveTo(x - r, y); c2d.lineTo(x + r, y);
      c2d.moveTo(x, y - r); c2d.lineTo(x, y + r);
    }
    if (base === 3) {
      const d = r * 0.8;
      c2d.moveTo(x - d, y - d); c2d.lineTo(x + d, y + d);
      c2d.moveTo(x + d, y - d); c2d.lineTo(x - d, y + d);
    }
    if (base === 4) { c2d.moveTo(x, y); c2d.lineTo(x, y - r); }
    if (mode & 32) { c2d.moveTo(x + r * 0.85, y); c2d.arc(x, y, r * 0.85, 0, TAU); }
    if (mode & 64) {
      const q = r * 0.85;
      c2d.rect(x - q, y - q, q * 2, q * 2);
    }
    c2d.stroke();
  };
  const drawPointEnt = (c2d, ent, color, alpha) => {
    const s = vp.worldToScreen(ent.p);
    const x = Math.round(s.x) + 0.5, y = Math.round(s.y) + 0.5;
    const pd = Number(Nasj.settings.pdsize) || 0;
    /* PDSIZE: zero is 5% of the view, negative a percent, positive units */
    const sizePx = pd <= 0
      ? ((pd === 0 ? 5 : -pd) / 100) * (cssH || 600)
      : pd * Nasj.worldScale();
    const r = Math.max(2, sizePx / 2);
    c2d.save();
    c2d.globalAlpha = alpha;
    c2d.strokeStyle = color;
    c2d.fillStyle = color;
    c2d.lineWidth = 1;
    c2d.setLineDash([]);
    Nasj.drawPointGlyph(c2d, x, y, r, (Nasj.settings.pdmode | 0));
    c2d.restore();
  };

  /* ArcAlignedText (Express Tools ARCTEXT): the string laid letter by letter
     along its arc. Convex puts the baseline outside the arc, concave inside;
     outward letters stand with their tops away from the centre, inward
     toward it; and the reading direction is chosen so the text reads
     left-to-right at the arc's midpoint — Reverse flips it. Justification
     seats the run at the left end, right end, centre, or stretches the
     spacing to Fit the whole arc. */
  const drawArcText = (c2d, ent, color, alpha) => {
    const str = String(ent.str == null ? '' : ent.str);
    if (!str) return;
    /* the geometry is the entity's own cache — syncArcTexts keeps it on the
       arc after every document change. Reading the arc here instead would be
       a WRITE inside the render pass, and it would read the wrong space's
       entity list whenever a layout is open. */
    const TAU2 = Math.PI * 2;
    const sweep = (((ent.a1 - ent.a0) % TAU2) + TAU2) % TAU2 || TAU2;
    const off = ent.offArc || 0;
    /* both clamps matter: a runaway offset must misplace letters at worst —
       a negative canvas radius would throw and blank the WHOLE frame */
    const baseR = Math.max(1e-6, ent.side === 'concave' ? ent.r - off : ent.r + off);
    const px = Math.max(ent.h * vp.scale, 0.5);
    const font = (ent.italic ? 'italic ' : '') + (ent.bold ? 'bold ' : '') +
      px + 'px "' + (ent.font || 'Arial') + '", "Segoe UI", sans-serif';
    c2d.save();
    c2d.globalAlpha = alpha;
    c2d.fillStyle = color;
    c2d.font = font;
    c2d.textAlign = 'center';
    c2d.textBaseline = 'alphabetic';
    /* character widths in drawing units */
    const wf = ent.wf > 0 ? ent.wf : 1;
    const chars = [...str];
    const widths = chars.map((ch) => (c2d.measureText(ch).width / vp.scale) * wf);
    let gap = ent.spacing || 0;
    const glyphLen = widths.reduce((a, b) => a + b, 0);
    const arcLen = Math.max(1e-6, sweep * baseR - (ent.offL || 0) - (ent.offR || 0));
    /* Fit stretches the spacing to fill the arc; one lone character has no
       gaps to stretch, so it centres — and the underline spans what the
       letters actually cover, in every case */
    const fitting = ent.just === 'F' && chars.length > 1;
    if (fitting) gap = Math.max(0, (arcLen - glyphLen) / (chars.length - 1));
    const used = fitting ? arcLen : glyphLen + gap * Math.max(0, chars.length - 1);
    let lead = ent.offL || 0;                       /* from the reading start */
    if (ent.just === 'C' || (ent.just === 'F' && !fitting)) lead += (arcLen - used) / 2;
    else if (ent.just === 'R') lead += arcLen - used;
    /* reading direction: text upright and left-to-right at the arc midpoint.
       The glyph 'up' is what decides — outward letters read with falling
       angle, inward with rising — and the SIDE only picks the radius, which
       is the industry standard's behaviour: moving to the concave side must not turn the
       words around. Reverse is the one thing that does. */
    let dir = ent.orient === 'in' ? 1 : -1;
    if (ent.reverse) dir = -dir;
    const startT = dir > 0 ? ent.a0 : ent.a0 + sweep;
    let s = lead;
    for (let i = 0; i < chars.length; i++) {
      const mid = s + widths[i] / 2;
      const t = startT + dir * (mid / baseR);
      const wpt = { x: ent.c.x + baseR * Math.cos(t), y: ent.c.y + baseR * Math.sin(t) };
      const sp = vp.worldToScreen(wpt);
      /* the glyph's up: radially out for outward letters, in for inward */
      const up = ent.orient === 'in' ? t + Math.PI : t;
      /* canvas y runs down, so world angle a becomes screen rotation -a;
         the baseline lies 90° clockwise (in world) from the up direction */
      c2d.save();
      c2d.translate(sp.x, sp.y);
      c2d.rotate(scrAng(up - Math.PI / 2));
      if (wf !== 1) c2d.scale(wf, 1);
      c2d.fillText(chars[i], 0, 0);
      c2d.restore();
      s += widths[i] + gap;
    }
    if (ent.underline) {
      /* the baseline arc under the run, letter-height thin */
      const t0 = startT + dir * (lead / baseR);
      const t1 = startT + dir * ((lead + used) / baseR);
      const uR = Math.max(1e-6,
        ent.orient === 'in' ? baseR + ent.h * 0.12 : baseR - ent.h * 0.12);
      const sc = vp.worldToScreen(ent.c);
      c2d.beginPath();
      c2d.strokeStyle = color;
      c2d.lineWidth = Math.max(1, ent.h * 0.06 * vp.scale);
      /* screen angles run mirrored (y down): world t -> -t */
      c2d.arc(sc.x, sc.y, uR * vp.scale, scrAng(t0), scrAng(t1), dir > 0);
      c2d.stroke();
    }
    c2d.restore();
  };

  /* A light's glyph. The industry standard draws these at a fixed size on screen, not in
     drawing units, because a light has no extent to scale — and it draws NO
     glyph for a distant light, which is exactly what the Lights in Model
     palette's own note tells the user. A light switched off draws faint. */
  const drawLightEnt = (c2d, ent, color, alpha) => {
    if (ent.lkind === 'distant') return;
    const s = vp.worldToScreen(ent.p);
    const x = Math.round(s.x) + 0.5, y = Math.round(s.y) + 0.5;
    const r = 7;
    c2d.save();
    c2d.globalAlpha = alpha * (ent.on === false ? 0.4 : 1);
    c2d.strokeStyle = color;
    c2d.fillStyle = color;
    c2d.lineWidth = 1;
    c2d.setLineDash([]);
    c2d.beginPath();
    c2d.arc(x, y, r * 0.5, 0, Math.PI * 2);
    c2d.stroke();
    /* the eight rays that make it read as a lamp rather than a circle */
    c2d.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      const ux = Math.cos(a), uy = Math.sin(a);
      c2d.moveTo(x + ux * r * 0.78, y + uy * r * 0.78);
      c2d.lineTo(x + ux * r * 1.35, y + uy * r * 1.35);
    }
    c2d.stroke();
    if (ent.lkind === 'spot' && ent.tgt) {
      /* the aim line, and the falloff cone opening along it */
      const t = vp.worldToScreen(ent.tgt);
      const dx = t.x - s.x, dy = t.y - s.y;
      const L = Math.hypot(dx, dy);
      c2d.setLineDash([4, 3]);
      c2d.beginPath();
      c2d.moveTo(x, y);
      c2d.lineTo(t.x, t.y);
      c2d.stroke();
      c2d.setLineDash([]);
      if (L > 1) {
        const ux = dx / L, uy = dy / L;
        const half = ((Number(ent.fall) || 50) / 2) * Math.PI / 180;
        const tan = Math.tan(Math.min(half, 1.4));
        const nx = -uy, ny = ux;
        const ex = t.x, ey = t.y, w = L * tan;
        c2d.beginPath();
        c2d.moveTo(x, y); c2d.lineTo(ex + nx * w, ey + ny * w);
        c2d.moveTo(x, y); c2d.lineTo(ex - nx * w, ey - ny * w);
        c2d.stroke();
      }
    }
    c2d.restore();
  };

  /* the XCLIP ring as a screen-space subpath (world points, in order) */
  const clipRingPath = (c2d, pts) => {
    const a = vp.worldToScreen(pts[0]);
    c2d.moveTo(a.x, a.y);
    for (let i = 1; i < pts.length; i++) {
      const q = vp.worldToScreen(pts[i]);
      c2d.lineTo(q.x, q.y);
    }
    c2d.closePath();
  };

  /* FRAME — the clipping boundary itself. 0 hides it; 2 shows it on screen but
     keeps it off the paper; 1 and 3 plot it with everything else. */
  const drawClipFrame = (c2d, clip, color, alpha, primary) => {
    const f = Nasj.settings.frame;
    const frame = isFinite(f) ? (f | 0) : 3;
    if (!primary || frame === 0) return;
    if (plotColorMap && frame === 2) return;
    c2d.save();
    c2d.globalAlpha = alpha;
    c2d.strokeStyle = color;
    c2d.lineWidth = 1;
    c2d.setLineDash([]);
    c2d.beginPath();
    clipRingPath(c2d, clip.pts);
    c2d.stroke();
    c2d.restore();
  };

  /* stroke an entity with the given style (text/point/anno/insert handled
     specially). `primary` marks the main opaque pass: it enables hatch
     fills/patterns, table shading and dim-text knockouts, which must stay off
     for selection glow/dash and rubber-band preview passes. */
  /* ---- raster image attachments (IMAGEATTACH) ----
   * The bitmap decodes once per data URL; the first frame after an attach or
   * an open draws the frame alone, and onload asks for the next frame. */
  const imgCache = new Map();          /* dataURL -> {img, ok, bad} */
  const imageBitmap = (src) => {
    let e = imgCache.get(src);
    if (!e) {
      e = { img: new Image(), ok: false, bad: false };
      /* the decode outruns nothing: the scene that drew the empty frame is
         CACHED, so the finished bitmap must bump the revision or the cache
         would serve the frame-only picture until the next real edit */
      e.img.onload = () => {
        e.ok = true;
        /* the picture this drawing shows has changed: its own
           revision moves too, so its cached bitmap is beaten */
        docRev++; docGenBump(Nasj.doc);
        if (Nasj.render) Nasj.render();
      };
      e.img.onerror = () => { e.bad = true; };
      e.img.src = src;
      imgCache.set(src, e);
    }
    return e;
  };
  const drawImageEnt = (c2d, ent, color, lineWidth, alpha, primary) => {
    const s = Nasj.geom.imageCorners(ent).map((q) => vp.worldToScreen(q));
    const doc = Nasj.doc;
    const src = (doc && doc.images) ? doc.images[ent.img] : null;
    const rec = src ? imageBitmap(src) : null;
    if (primary && rec && rec.ok) {
      c2d.save();
      c2d.globalAlpha = alpha;
      /* multiplied onto the current transform (which carries the device
         pixel ratio), mapping the bitmap's pixel grid onto the frame
         whatever the zoom, rotation or mirror — s[3] is the top-left */
      c2d.transform(
        (s[2].x - s[3].x) / rec.img.width, (s[2].y - s[3].y) / rec.img.width,
        (s[0].x - s[3].x) / rec.img.height, (s[0].y - s[3].y) / rec.img.height,
        s[3].x, s[3].y);
      c2d.drawImage(rec.img, 0, 0);
      c2d.restore();
    }
    /* the frame — and the crossed placeholder the industry standard shows while an image
       is loading or its bitmap is gone */
    c2d.save();
    c2d.globalAlpha = alpha;
    c2d.strokeStyle = color;
    c2d.lineWidth = lineWidth;
    c2d.beginPath();
    c2d.moveTo(s[0].x, s[0].y);
    for (let i = 1; i < 4; i++) c2d.lineTo(s[i].x, s[i].y);
    c2d.closePath();
    if (primary && (!rec || !rec.ok)) {
      c2d.moveTo(s[0].x, s[0].y); c2d.lineTo(s[2].x, s[2].y);
      c2d.moveTo(s[1].x, s[1].y); c2d.lineTo(s[3].x, s[3].y);
    }
    c2d.stroke();
    c2d.restore();
  };

  /* ---- per-definition bitmap tiles (heavy drawings only) ----
   * A mid-size block reference re-clones and re-strokes its whole definition
   * on every scene pass — the same picture every time. So the flattened def
   * renders ONCE into an offscreen tile at a quantized scale bucket, and
   * every later reference is one drawImage through its placement (rotation
   * lives in the transform, not the key). Only the plain case caches:
   * primary scene pass, no clip/fade/attrs/dash, uniform |sx|=|sy|, full
   * alpha. Everything else keeps the vector path — as do selection, hover,
   * paper, plot and light drawings. */
  const INS_TILE_CAP = 64 << 20;              /* device bytes, all tiles */
  const LOG1_25 = Math.log(1.25);
  const insTiles = new Map();                 /* key -> tile | null (LRU) */
  let insTilesBytes = 0;
  /* THE CONTENT INPUTS, AS A KEY PREFIX RATHER THAN A WHOLESALE WIPE. This
     used to clear the pool whenever the inputs moved — which included
     clicking a tab, since the layer and style tables are the drawing's
     own: every block reference in the incoming drawing then re-baked its
     tile, and a single scene-job slice was measured at 154ms doing it. The
     inputs are the front of each tile's key instead, so two drawings' tiles
     coexist and a stale set simply ages out of the byte-capped LRU.

     AND THE PREFIX IS A TOKEN, NOT THE SIGNATURE. The signature is tens of
     kilobytes on a drawing with 738 layers and a full style table; putting
     it in front of every tile key made each Map lookup hash 40KB of string,
     thousands of times a pass — measured at 13x the extents pass. The
     signature is compared once, here, and stands for a short serial number
     that the keys carry. The serial is remembered PER DRAWING, so tabbing
     between two drawings does not hand each of them a fresh one. */
  const insTileKeys = new Map();         /* doc -> {sig, prefix}, 8 kept */
  let insTileSerial = 0;
  let insTilePrefix = '', insTilePrefixDoc = null;
  const insTilesSync = (doc) => {
    const sig = docGen(doc) + '|' + layersSig(doc) + '|' +
      textStylesSig(doc) + '|' + (Nasj.settings.lwt ? 1 : 0) +
      (pocheMode ? 1 : 0) + '|' + knockoutColor + '|' + dpr +
      '|' + (Nasj.settings.pdmode | 0) + '/' +
      (Number(Nasj.settings.pdsize) || 0);
    let e = insTileKeys.get(doc);
    if (!e || e.sig !== sig) {
      e = { sig, prefix: (++insTileSerial) + '|' };
      insTileKeys.delete(doc);
      insTileKeys.set(doc, e);
      while (insTileKeys.size > 8) insTileKeys.delete(insTileKeys.keys().next().value);
    }
    insTilePrefix = e.prefix;
    insTilePrefixDoc = doc;
  };
  const buildInsTile = (ent, doc, color, lineWidth, B) => {
    const def = doc.blocks && doc.blocks[ent.name];
    if (!def || !Array.isArray(def.entities)) return null;
    const probe = {
      type: 'insert', name: ent.name, p: { x: 0, y: 0 },
      sx: (ent.sx || 1) < 0 ? -1 : 1, sy: (ent.sy || 1) < 0 ? -1 : 1, rot: 0
    };
    const b = Nasj.geom.entityBounds(probe);
    if (!b || !isFinite(b.minx + b.miny + b.maxx + b.maxy)) return null;
    /* junk-geometry defence: drawn ink must fit the def box or the tile
       clips what the direct pass visibly paints. A construction line or a
       light fits no box; an arc whose radius dwarfs the def can stray
       (imported wrong-sweep arcs); and an epsilon bulge (|b|~1e-11 arc-fit
       junk) implies an astronomical radius the canvas rasterizes as stray
       rays. Such defs keep the vector path, stroke for stroke. */
    const span = Math.max(b.maxx - b.minx, b.maxy - b.miny);
    for (const kid of def.entities) {
      if (!kid) continue;
      if (kid.type === 'xline' || kid.type === 'light') return null;
      if ((kid.type === 'arc' || kid.type === 'arctext') &&
          isFinite(kid.r) && kid.r * 2 > span * 3) return null;
      if (kid.type === 'polyline' && Array.isArray(kid.pts)) {
        const P = kid.pts, n = P.length;
        const segs = kid.closed ? n : n - 1;
        for (let i = 0; i < segs; i++) {
          const p1 = P[i], bg = p1 && p1.b;
          if (typeof bg !== 'number' || !isFinite(bg) || Math.abs(bg) < 1e-12) continue;
          const p2 = P[(i + 1) % n];
          const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
          if (chord * (1 + bg * bg) / (2 * Math.abs(bg)) > span * 3) return null;
        }
      }
    }
    const m = lineWidth + 4;                  /* round caps bleed past bounds */
    const w = (b.maxx - b.minx) * B + 2 * m;
    const h = (b.maxy - b.miny) * B + 2 * m;
    const dw = Math.ceil(w * dpr), dh = Math.ceil(h * dpr);
    if (!(dw >= 1) || !(dh >= 1) || dw > 1024 || dh > 1024) return null;
    const cv = document.createElement('canvas');
    cv.width = dw;
    cv.height = dh;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const keep = { sc: vp.scale, tx: vp.tx, ty: vp.ty, w: cssW, h: cssH,
      tw: twist, gk: greekCutoff };
    vp.scale = B; vp.tx = m - b.minx * B; vp.ty = m - b.miny * B;
    vp.twist = 0;                 /* the placement transform re-applies it */
    cssW = w; cssH = h;
    greekCutoff = GREEK_PX;       /* a tile pays its glyphs once, not per pass */
    try {
      strokeEntity(g, probe, color, lineWidth, null, 1, true);
    } finally {
      vp.scale = keep.sc; vp.tx = keep.tx; vp.ty = keep.ty;
      vp.twist = keep.tw;
      cssW = keep.w; cssH = keep.h;
      greekCutoff = keep.gk;
    }
    return { cv, w: dw / dpr, h: dh / dpr,
      ox: m - b.minx * B, oy: b.maxy * B + m, B, bytes: dw * dh * 4 };
  };
  const drawInsTile = (c2d, ent, doc, color, lineWidth) => {
    const pxu = Math.abs(ent.sx || 1) * vp.scale;   /* px per def unit */
    if (!(pxu > 0) || !isFinite(pxu)) return false;
    const B = Math.pow(1.25, Math.ceil(Math.log(pxu) / LOG1_25));
    /* light drawings never reach insTilesSync (it rides the dotting path),
       so the prefix is taken here whenever it is not this drawing's */
    if (insTilePrefixDoc !== doc) insTilesSync(doc);
    const key = insTilePrefix + ent.name + '|' + B + '|' +
      ((ent.sx || 1) < 0 ? 'x' : '') + ((ent.sy || 1) < 0 ? 'y' : '') +
      '|' + color + '|' + lineWidth;
    let t = insTiles.get(key);
    if (t === undefined) {
      t = buildInsTile(ent, doc, color, lineWidth, B);
      insTiles.set(key, t);          /* nulls too: don't re-try every pass */
      if (t) {
        insTilesBytes += t.bytes;
        while (insTilesBytes > INS_TILE_CAP && insTiles.size) {
          const [k0, t0] = insTiles.entries().next().value;
          insTiles.delete(k0);
          if (t0) insTilesBytes -= t0.bytes;
        }
      }
    } else if (t) {
      insTiles.delete(key);          /* LRU refresh */
      insTiles.set(key, t);
    }
    if (!t) return false;
    const k = pxu / t.B;
    const sp = vp.worldToScreen(ent.p);
    c2d.save();
    c2d.translate(sp.x, sp.y);
    const ra = scrAng(ent.rot || 0);
    if (ra) c2d.rotate(ra);
    c2d.drawImage(t.cv, -t.ox * k, -t.oy * k, t.w * k, t.h * k);
    c2d.restore();
    return true;
  };

  const strokeEntity = (c2d, ent, color, lineWidth, dash, alpha, primary, tileOK, near) => {
    /* object transparency (0–90) dims everything the entity draws; hatches
       already fold ent.transp into their fill, so they are left alone */
    const trE = Math.min(90, Math.max(0, Number(ent.transp) || 0));
    if (trE && ent.type !== 'hatch') alpha *= 1 - trE / 100;
    if (!ent || !ent.type) return;
    /* SPEC3 §23: the primary pass applies the entity's resolved linetype;
       glow/selection/preview passes bring their own dash (or none) */
    if (primary && !dash) dash = ltDashOf(ent);
    /* a bare attribute definition draws its tag, the way the industry standard shows one
       before it is made part of a block */
    if (ent.type === 'text' || ent.type === 'attdef') { drawText(c2d, ent, color, alpha); return; }
    if (ent.type === 'point') { drawPointEnt(c2d, ent, color, alpha); return; }
    if (ent.type === 'light') { drawLightEnt(c2d, ent, color, alpha); return; }
    if (ent.type === 'arctext') { drawArcText(c2d, ent, color, alpha); return; }
    if (ent.type === 'image') { drawImageEnt(c2d, ent, color, lineWidth, alpha, primary); return; }
    if (ent.type === 'dim' || ent.type === 'leader' || ent.type === 'table') {
      drawAnno(c2d, ent, color, lineWidth, dash, alpha, primary);
      return;
    }
    if (ent.type === 'insert') { /* block reference: transformed children */
      const doc = Nasj.doc;
      /* An external reference draws back. XDWGFADECTL — or the override ADJUST
         put on this one reference — is what makes an xref read as background
         against the drawing being worked on. Only the primary pass fades:
         a selection glow stays full strength, or picking one would be hard. */
      const fade = (primary && Nasj.xref) ? Nasj.xref.fadeOf(doc, ent) : 0;
      const a = fade ? alpha * (1 - fade / 100) : alpha;
      /* XCLIP: what falls outside the boundary is not drawn. Clipping the
         canvas rather than cutting the geometry is what the industry standard shows —
         curves and text are cut exactly where the boundary crosses them. */
      const clip = Nasj.geom.insertClipWorld(ent, doc);
      /* the tile fast path (see insTiles above): only the plain case, and
         only mid-size references — tiny ones are greeked before they get
         here, huge ones would blur */
      if (tileOK && primary && !clip && !fade && a === 1 && !dash &&
          !view3d.active && !Nasj.paper && !plotColorMap &&
          doc && doc.entities.length > SCENE_ASYNC_N &&
          Math.abs(ent.sx || 1) === Math.abs(ent.sy || 1) &&
          !(ent.attrs && Object.keys(ent.attrs).length)) {
        const bb = boundsOf(ent);
        const spx = Math.max(bb.maxx - bb.minx, bb.maxy - bb.miny) * vp.scale;
        if (spx >= 3 && spx <= 256 && drawInsTile(c2d, ent, doc, color, lineWidth)) return;
      }
      if (clip) {
        c2d.save();
        c2d.beginPath();
        /* an inverted clip keeps the OUTSIDE, so the ring becomes a hole in a
           rectangle large enough to count as everywhere */
        if (clip.inverted) c2d.rect(-1e6, -1e6, 2e6, 2e6);
        clipRingPath(c2d, clip.pts);
        c2d.clip('evenodd');
      }
      /* LEVEL OF DETAIL (the industry standard's regen greeking). A child of the block
         smaller than a pixel on screen cannot draw as anything but a dot —
         so it draws AS a dot, batched into one path, instead of being
         materialized, transformed and stroked. On a dense block library
         this is most of the crisp pass. Draw-only: snapping and picking
         always see the full geometry. */
      let lod = null;
      if (primary && !view3d.active && !Nasj.paper) {
        const kk = (Math.abs(ent.sx || 1) + Math.abs(ent.sy || 1)) / 2;
        const px = kk * vp.scale;                 /* screen px per def unit */
        if (px > 0 && isFinite(px)) lod = { minLocal: INS_DOT_PX / px, dots: [] };
      }
      const g3c = gl3dLive();
      const sh3 = shaded3d() && !g3c;
      /* the GPU layer draws the block's geometry: only the children it
         leaves are placed here, from its cache; the shaded CPU pass took
         the bodies apart into sorted faces — either way, not here */
      const kids = g3c ? Nasj.gl3d.restChildren(ent, doc) : Nasj.geom.insertEntities(ent, doc, lod, near || null);
      /* a hover pass hands a view box as `near`: past the cap the children
         would hitch the overlay, so the box of the reference is the cue */
      if (near && kids.length > HOVER_INS_CAP) {
        const bb = boundsOf(ent);
        const s0 = vp.worldToScreen({ x: bb.minx, y: bb.miny });
        const s1 = vp.worldToScreen({ x: bb.maxx, y: bb.maxy });
        c2d.save();
        c2d.globalAlpha = a;
        c2d.strokeStyle = color;
        c2d.lineWidth = lineWidth;
        c2d.setLineDash([]);
        c2d.strokeRect(Math.min(s0.x, s1.x), Math.min(s0.y, s1.y),
          Math.abs(s1.x - s0.x), Math.abs(s1.y - s0.y));
        c2d.restore();
        if (clip) {
          c2d.restore();
          drawClipFrame(c2d, clip, color, alpha, primary);
        }
        return;
      }
      const lmapIns = (primary && doc) ? layerMap(doc) : null;
      for (const child of kids) {
        if (child.type === 'insert') continue;
        if (sh3 && (child.type === 'face3d' || Nasj.solid.isBody(child))) continue;
        /* ByBlock keeps the reference's own colour — that is what it
           means, and it is how a dimension's dot arrowheads come out in
           the dimension's colour instead of their layer's */
        let col = color;
        if (child.color === 'ByBlock') { /* col stays the reference's */ }
        else if (primary && child.color && child.color !== 'ByLayer') col = child.color;
        else if (lmapIns && lmapIns.get(child.layerId)) {
          col = Nasj.docOps.resolveColor(doc, child);
        }
        if (primary && plotColorMap) col = plotColorMap(col, child);
        strokeEntity(c2d, child, col, lineWidth, dash, a, primary);
      }
      if (lod && lod.dots.length) {
        c2d.save();
        c2d.fillStyle = color;
        /* dots batch into alpha steps (one fill each) instead of one opaque
           path: the per-dot alpha is what keeps a zoom from stepping the
           block's luminance at the LOD threshold, and what keeps a child
           too small to leave ink from leaving any */
        const buckets = [];
        for (const q of lod.dots) {
          const t = q.a == null ? 1 : q.a;
          const bi = dotBucket(t, t * INS_DOT_PX);
          if (bi < 0) continue;
          let p = buckets[bi];
          if (!p) p = buckets[bi] = new Path2D();
          const s = vp.worldToScreen(q);
          p.rect(s.x - 0.5, s.y - 0.5, 1, 1);
        }
        for (let bi = 0; bi < DOT_STEPS; bi++) {
          if (!buckets[bi]) continue;
          c2d.globalAlpha = a * (bi + 1) / DOT_STEPS;
          c2d.fill(buckets[bi]);
        }
        c2d.restore();
      }
      if (clip) {
        c2d.restore();          /* the frame is drawn OUTSIDE its own clip */
        drawClipFrame(c2d, clip, color, alpha, primary);
      }
      return;
    }
    if (ent.type === 'hatch' && primary) {
      if (typeof ent.aisel === 'number') {
        /* an agent selection is a frame, not a fill: a solid fill hid the
           very drawing it was meant to point at. A faint wash says "this
           area", a dashed outline says "this is not geometry". */
        c2d.save();
        c2d.beginPath();
        entPath(c2d, ent);
        c2d.globalAlpha = alpha * 0.07;
        c2d.fillStyle = color;
        c2d.fill();
        c2d.globalAlpha = alpha;
        c2d.strokeStyle = color;
        c2d.lineWidth = 1.5;
        c2d.setLineDash([6, 4]);
        c2d.stroke();
        c2d.restore();
        return;
      }
      drawHatchPattern(c2d, ent, color, alpha);
      /* A hatch has no outline of its own: the boundary you see belongs to the
         boundary objects, and stroking here would repaint their edge in the
         hatch's colour. The agent's sel-N frames (aisel) are drawn AS a framed
         rectangle, so those keep theirs. */
      if (typeof ent.aisel !== 'number') return;
    }
    /* poché: solid wall fill UNDER the outline stroke */
    if (primary && pocheMode && ent.type === 'polyline' && ent.closed) {
      const pd = Nasj.doc;
      const ply = pd && pd.layers.find((l) => l.id === ent.layerId);
      if (ply && /^A-WALL/.test(ply.name)) {
        c2d.save();
        c2d.globalAlpha = alpha;
        c2d.fillStyle = color;
        c2d.beginPath();
        entPath(c2d, ent);
        c2d.fill();
        c2d.restore();
      }
    }
    if (ent.type === 'face3d' && primary && view3d.active) {
      /* A 3D face paints SOLID in a shaded style, lit by the headlight, so
         the faces in front really cover the ones behind — the draw list is
         sorted far-to-near for exactly this. Wireframe styles keep the faint
         wash that shows a face is there without hiding anything. */
      const sh = shaded3d();
      c2d.save();
      c2d.globalAlpha = alpha * (sh ? vstyle.alpha : 0.12);
      c2d.fillStyle = sh ? faceFill(color, ent.pts) : color;
      c2d.beginPath();
      polyPath(c2d, ent.pts, true);
      c2d.fill();
      c2d.restore();
      /* a style that shows no edges draws the face and nothing else */
      if (sh && !vstyle.edges) return;
    }
    c2d.save();
    c2d.globalAlpha = alpha;
    c2d.strokeStyle = color;
    /* hatch outline stays a hairline in the primary pass (SPEC2 §15) */
    let strokeW = (ent.type === 'hatch' && primary) ? 1 : lineWidth;
    /* polyline constant width w (world units): at least the style width.
       vp.scale is the live screen scale, the paper-preview clone scale, or
       the plot renderer's device scale — dpi handled automatically. */
    if (ent.type === 'polyline' && typeof ent.w === 'number' && isFinite(ent.w) && ent.w > 0) {
      strokeW = Math.max(strokeW, ent.w * vp.scale);
    }
    c2d.lineWidth = strokeW;
    c2d.lineCap = 'round';
    c2d.lineJoin = 'round';
    c2d.setLineDash(dash || []);
    c2d.beginPath();
    entPath(c2d, ent);
    c2d.stroke();
    c2d.restore();
  };

  /* ---------------- main render ---------------- */
  /* grid on the z=0 plane in 3D: the same world-space lines, projected */
  const drawGrid3d = (c2d) => {
    const s0 = Nasj.settings.gridSize > 0 ? Nasj.settings.gridSize : 10;
    const b = viewWorldBounds();
    if (!isFinite(b.minx) || !isFinite(b.maxx)) return;
    let step = s0, guard = 0;
    const lineCount = () => (b.maxx - b.minx) / step + (b.maxy - b.miny) / step;
    while (guard++ < 24 && lineCount() > 240) step *= 10;
    if (!isFinite(step) || lineCount() > 400) return; /* near-horizon: skip */

    const minor = new Path2D(), major = new Path2D();
    const seg = (path, w1, w2) => {
      const a = vp.worldToScreen(w1), c = vp.worldToScreen(w2);
      path.moveTo(a.x, a.y);
      path.lineTo(c.x, c.y);
    };
    const i0x = Math.ceil(b.minx / step), i1x = Math.floor(b.maxx / step);
    for (let i = i0x; i <= i1x; i++) {
      seg((i % 5 === 0) ? major : minor,
        { x: i * step, y: b.miny }, { x: i * step, y: b.maxy });
    }
    const i0y = Math.ceil(b.miny / step), i1y = Math.floor(b.maxy / step);
    for (let i = i0y; i <= i1y; i++) {
      seg((i % 5 === 0) ? major : minor,
        { x: b.minx, y: i * step }, { x: b.maxx, y: i * step });
    }
    c2d.lineWidth = 1;
    c2d.strokeStyle = COL.gridMinor;
    c2d.stroke(minor);
    c2d.strokeStyle = COL.gridMajor;
    c2d.stroke(major);

    /* axes on the plane, through the UCS origin (same colors as 2D) */
    const axis = (w1, w2, color) => {
      const a = vp.worldToScreen(w1), c = vp.worldToScreen(w2);
      c2d.strokeStyle = color;
      c2d.beginPath();
      c2d.moveTo(a.x, a.y);
      c2d.lineTo(c.x, c.y);
      c2d.stroke();
    };
    const U = ucsOrigin();
    c2d.lineWidth = 1;
    if (b.miny <= U.y && b.maxy >= U.y) {
      axis({ x: b.minx, y: U.y }, { x: b.maxx, y: U.y }, COL.axisX);
    }
    if (b.minx <= U.x && b.maxx >= U.x) {
      axis({ x: U.x, y: b.miny }, { x: U.x, y: b.maxy }, COL.axisY);
    }
  };

  /* GRID LAYER CACHE. Stroking the grid live every composite reintroduced
     GPU anti-alias jitter (±1 per channel between identical frames), which
     broke byte-stable recomposites. Drawing it ONCE per viewport onto its
     own canvas and blitting restores exactness — canvas-to-canvas copies
     are byte-precise — and makes the per-frame cost one drawImage. */
  /* the industry standard's GRIPOBJLIMIT: up to this many selected entities every grip
     shows — tier 1, today's exact code path, byte-identical. The industry standard's
     default (100) kept: measured on BLOCKS.dwg (246k, insert-fixed grips)
     the full-grip overlay stays under 1.5ms/frame far beyond 100, but 100
     is what the app has always shown and is the industry standard's own default, so the
     small-selection feel stays byte-identical. Past it the grips no longer
     vanish — they REDUCE (see gdyn below). */
  const GRIP_OBJ_LIMIT = 100;
  /* grips by intent, tier 2→3 boundary: up to this many selected entities
     the reduced per-entity grips (ends/centers/nodes/params, thinned on
     screen) still draw; beyond it the selection wears envelope grips only.
     Measured on BLOCKS.dwg (246k): thinning bounds the reduced overlay so
     hard it never crossed 1.5ms/frame up to 16,000 selected (med 0.1ms,
     table 35,273 → 507 drawn squares) — the boundary is set where the
     squares stop carrying information instead: at 2,000 selected, 5,505
     grips thin to ~62 visible squares at a framing zoom (>98% collapsed),
     so past here the envelope reads clearer than the noise, and the
     selection-event table build is still ≤15ms. */
  const GRIP_ENV_LIMIT = 2000;
  /* past this many selected entities, the selection styling goes single-pass */
  const SEL_STYLE_LIMIT = 300;
  /* ...and past it the GPU takes the highlight instead, whenever it can do
     so exactly. See selTintNow: the tinted pass paints the selection's whole
     box, so the entities inside it that are NOT selected have to be painted
     back by the 2D pass — and past this many of those the restroke is the
     very cost the tint was there to avoid. Measured on BLOCKS.dwg: the
     single-stroke 2D highlight runs at ~12us an entity, so 1,500 exceptions
     are ~18ms — about one frame, and the crossover where the tint stops
     paying for itself. */
  /* ZERO. The box mixes EVERYTHING it covers to the accent, and the 2D pass
     re-strokes the not-selected few in their own colours over that — but a
     hairline never covers the blue one beneath it, and every one of those
     objects kept a translucent cyan fringe: a light on the rest of the
     drawing, thrown by a selection that never touched it. So the tint
     stands only when the box holds nothing but the selection (select-all
     and its edits, which is what it was built for); any foreign object
     inside it hands the highlight back to the per-entity strokes. */
  const SEL_TINT_EXC_MAX = 0;
  /* a hovered insert used to expand every child and restroke them on the
     scene canvas (and `layers.some` 738 times per child). Past this many
     still-visible children the overlay draws the box instead — the GL
     picture already shows the block; the box is the hover cue. */
  const HOVER_INS_CAP = 1600;

  let gridCanvas = null, gctx = null, gridState = null;
  const gridSigNow = () => ({
    scale: vp.scale, tx: vp.tx, ty: vp.ty, w: cssW, h: cssH, dpr,
    gs: Nasj.settings.gridSize,
    ux: Nasj.ucs.x, uy: Nasj.ucs.y,        /* the axes ride the UCS origin */
    tw: twist,                             /* and the whole grid rides the view */
    v3a: view3d.active, vaz: view3d.azimuth, vel: view3d.elevation,
    vpp: !!view3d.persp, vpd: view3d.persp ? view3d.distance : 0, vro: view3d.roll,
    /* the grid-beyond-limits clip: the toggle, and the rectangle it cuts to */
    gb: Nasj.settings.gridBeyond === false ? JSON.stringify(limitsRect(Nasj.doc)) : ''
  });
  const sameGridSig = (a, b) => !!a && !!b &&
    a.scale === b.scale && a.tx === b.tx && a.ty === b.ty &&
    a.w === b.w && a.h === b.h && a.dpr === b.dpr && a.gs === b.gs &&
    a.ux === b.ux && a.uy === b.uy && a.tw === b.tw &&
    a.v3a === b.v3a && a.vaz === b.vaz && a.vel === b.vel &&
    a.vpp === b.vpp && a.vpd === b.vpd && a.vro === b.vro && a.gb === b.gb;
  const drawGridCached = (c2d) => {
    if (!gridCanvas) {
      gridCanvas = document.createElement('canvas');
      gctx = gridCanvas.getContext('2d');
    }
    const sig = gridSigNow();
    if (gridCanvas.width !== canvas.width || gridCanvas.height !== canvas.height) {
      gridCanvas.width = Math.max(1, canvas.width);
      gridCanvas.height = Math.max(1, canvas.height);
      gridState = null;
    }
    if (!sameGridSig(gridState, sig)) {
      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gctx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
      gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawGrid(gctx);
      gridState = sig;
    }
    const t = c2d.getTransform();
    c2d.setTransform(1, 0, 0, 1, 0, 0);
    c2d.drawImage(gridCanvas, 0, 0);
    c2d.setTransform(t);
  };

  const drawGrid = (c2d) => {
    if (view3d.active) { drawGrid3d(c2d); return; }
    /* X and Y carry their own spacing (Drafting Settings); each falls back
       to the one gridSize number the status bar has always set */
    const s0 = Nasj.settings.gridSize > 0 ? Nasj.settings.gridSize : 10;
    const gx0 = Nasj.settings.gridX > 0 ? Nasj.settings.gridX : s0;
    const gy0 = Nasj.settings.gridY > 0 ? Nasj.settings.gridY : s0;
    /* the adaptive grid thins out rather than crowding into a smear; with
       it off the grid simply stops once its lines would touch */
    const adapt = Nasj.settings.gridAdaptive !== false;
    const fit = (g) => {
      let s = g, guard = 0;
      if (adapt) while (s * vp.scale < 6 && guard++ < 24) s *= 10;
      return s;
    };
    const stepX = fit(gx0), stepY = fit(gy0);
    if (stepX * vp.scale < 6 || stepY * vp.scale < 6 ||
        !isFinite(stepX) || !isFinite(stepY)) return;
    const every = (Nasj.settings.majorEvery | 0) > 0 ? (Nasj.settings.majorEvery | 0) : 5;

    /* "Display grid beyond Limits" off: the grid keeps to the LIMITS
       rectangle, as the industry standard's grid does; the axes stay full-length */
    let gclip = false;
    if (Nasj.settings.gridBeyond === false) {
      const L = limitsRect(Nasj.doc);
      const a = vp.worldToScreen({ x: L.minx, y: L.miny });
      const c = vp.worldToScreen({ x: L.maxx, y: L.maxy });
      c2d.save();
      c2d.beginPath();
      c2d.rect(Math.min(a.x, c.x), Math.min(a.y, c.y),
        Math.abs(c.x - a.x), Math.abs(c.y - a.y));
      c2d.clip();
      gclip = true;
    }

    const b = viewWorldBounds();
    const minor = new Path2D(), major = new Path2D();
    const sy0 = 0.5, sy1 = cssH; /* vertical lines run full height */

    /* Screen chrome, never geometry: the grid keeps its straight lines
       whatever the view's twist — only the DRAWING turns. In a twisted
       view the lines are laid out in the view's own frame (the world box
       corners no longer bound it), anchored so one line passes through
       the projected origin. */
    const o = vp.worldToScreen({ x: 0, y: 0 });
    const pxX = stepX * vp.scale, pxY = stepY * vp.scale;
    for (let sx = ((o.x % pxX) + pxX) % pxX; sx <= cssW; sx += pxX) {
      const i = Math.round((sx - o.x) / pxX);
      const path = (i % every === 0) ? major : minor;
      const X = Math.round(sx) + 0.5;
      path.moveTo(X, 0);
      path.lineTo(X, cssH);
    }
    for (let sy = ((o.y % pxY) + pxY) % pxY; sy <= cssH; sy += pxY) {
      const i = Math.round((sy - o.y) / pxY);
      const path = (i % every === 0) ? major : minor;
      const Y = Math.round(sy) + 0.5;
      path.moveTo(0, Y);
      path.lineTo(cssW, Y);
    }

    c2d.lineWidth = 1;
    /* the adaptive x10 step used to snap a whole line family in at the
       6px cutoff — fading minors over 6→12px lands the family invisible
       exactly where the step switches it, so the zoom never pops */
    const aMinor = Math.max(0, Math.min(1, (Math.min(pxX, pxY) - 6) / 6));
    if (aMinor > 0) {
      c2d.globalAlpha = aMinor;
      c2d.strokeStyle = COL.gridMinor;
      c2d.stroke(minor);
      c2d.globalAlpha = 1;
    }
    c2d.strokeStyle = COL.gridMajor;
    c2d.stroke(major);
    if (gclip) c2d.restore();

    /* axes through the UCS origin: X (horizontal) red-ish, Y green-ish */
    const O = vp.worldToScreen(Nasj.ucs);
    c2d.lineWidth = 1;
    if (O.y >= 0 && O.y <= cssH) {
      const sy = Math.round(O.y) + 0.5;
      c2d.strokeStyle = COL.axisX;
      c2d.beginPath();
      c2d.moveTo(0, sy);
      c2d.lineTo(cssW, sy);
      c2d.stroke();
    }
    if (O.x >= 0 && O.x <= cssW) {
      const sx = Math.round(O.x) + 0.5;
      c2d.strokeStyle = COL.axisY;
      c2d.beginPath();
      c2d.moveTo(sx, 0);
      c2d.lineTo(sx, cssH);
      c2d.stroke();
    }
  };

  /* paper-space preview: dark desk, white A3 sheet, dashed margin, viewport
     rect with the model scaled-to-fit (SPEC2 §15). No grid/axes. */
  /* Paper space draws two different worlds on one canvas, so the transform is
     pinned for each: `withPaper` puts the sheet's own millimetres under
     worldToScreen, `withViewport` puts the model space one frame looks at. */
  const withTransform = (scale, tx, ty, fn) => {
    const s = vp.scale, x = vp.tx, y = vp.ty;
    const w2s = vp.worldToScreen, s2w = vp.screenToWorld;
    vp.scale = scale; vp.tx = tx; vp.ty = ty;
    vp.worldToScreen = w2s2d; vp.screenToWorld = s2w2d;
    try { fn(); } finally {
      vp.scale = s; vp.tx = x; vp.ty = y;
      vp.worldToScreen = w2s; vp.screenToWorld = s2w;
    }
  };
  const withPaper = (fn) => withTransform(paperScale, paperTx, paperTy, fn);
  /* model → paper → screen collapses to one affine, so the ordinary 2D
     drawing path (entities, grid, axes) works inside a frame untouched */
  const withViewport = (v, fn) => withTransform(
    paperScale * v.scale,
    (v.x + v.w / 2 - v.ctr.x * v.scale) * paperScale + paperTx,
    (v.y + v.h / 2 - v.ctr.y * v.scale) * paperScale + paperTy, fn);
  /* the sheet view, which vp.scale/tx/ty hold except inside the two wrappers */
  let paperScale = 1, paperTx = 0, paperTy = 0;

  /* a tiled viewport's view, borrowed for one pass. Unlike withTransform it
     leaves the projection alone: a tile draws through whichever mapping the
     view is in, 2D or 3D. */
  const withView = (v, fn) => {
    const s = vp.scale, x = vp.tx, y = vp.ty;
    vp.scale = v.scale; vp.tx = v.tx; vp.ty = v.ty;
    try { fn(); } finally { vp.scale = s; vp.tx = x; vp.ty = y; }
  };

  const clipToRect = (c2d, R) => {
    c2d.beginPath();
    c2d.rect(R.x, R.y, R.w, R.h);
    c2d.clip();
  };

  /* ---------------- paper-scene cache ----------------
   * renderPaper stroked every visible model entity into every frame on
   * every call: a Model→Layout click on a heavy drawing paid 700ms+, and
   * paid it again on every switch back. The finished sheet is a static
   * picture until something it shows changes, so each layout keeps its
   * last bitmap — a switch is one drawImage — and the signature says
   * when the picture must actually be painted again. */
  const PAPER_BMP_MAX = 4;
  const paperBmp = new Map();     /* layout name -> {canvas, sig, doc, sel, selN, msp} */
  Nasj.paperForget = () => paperBmp.clear();
  const paperSceneSig = (doc) => {
    let vps = '';
    for (const v of Nasj.layoutViewports()) {
      vps += '|' + v.x + ',' + v.y + ',' + v.w + ',' + v.h + ',' + v.scale + ',' +
        (v.ctr ? v.ctr.x + ',' + v.ctr.y : '');
    }
    return [docGen(doc), layersSig(doc), textStylesSig(doc),
      vp.scale, vp.tx, vp.ty, cssW, cssH, dpr,
      Nasj.settings.grid ? 1 : 0, Nasj.settings.gridSize,
      Nasj.settings.lwt ? 1 : 0, Nasj.settings.poche ? 1 : 0,
      Nasj.settings.pdmode | 0, Number(Nasj.settings.pdsize) || 0,
      Number(Nasj.settings.xdwgfadectl) || 0, Nasj.settings.frame | 0,
      Number(Nasj.settings.lockFade) || 0].join(':') + vps;
  };

  const renderPaper = () => {
    greekCutoff = GREEK_PX;   /* paper never inherits a model-view budget */
    pocheMode = !!Nasj.settings.poche;
    paperScale = vp.scale; paperTx = vp.tx; paperTy = vp.ty;
    /* the canvas now holds the SHEET, not the model composite: without
       this, a return to Model whose signature still matched skipped the
       repaint ("nothing changed, nothing paints") and the sheet stayed
       on screen — the tab had switched, the picture had not */
    painted = null;
    /* the sheet is unchanged? then this pass is one drawImage */
    const pkey = ((Nasj.doc && Nasj.doc.name) || '') + '|' +
      ((Nasj.paper && Nasj.paper.name) || '');
    const psig = Nasj.doc ? paperSceneSig(Nasj.doc) : '';
    const phit = Nasj.doc ? paperBmp.get(pkey) : null;
    /* a switch hands over a FRESH empty selection Set every time — an
       empty set is an empty set, only a real selection breaks the hit */
    const pselN = Nasj.selection ? Nasj.selection.size : 0;
    if (phit && phit.doc === Nasj.doc && phit.sig === psig &&
        (phit.sel === Nasj.selection || (phit.selN === 0 && pselN === 0)) &&
        phit.selN === pselN &&
        phit.msp === mspVp &&
        phit.canvas.width === canvas.width && phit.canvas.height === canvas.height) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(phit.canvas, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paperFrameSync();
      if (Nasj.renderOverlay) Nasj.renderOverlay();
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#2e2e2e';
    ctx.fillRect(0, 0, cssW, cssH);

    const tl = w2s2d({ x: 0, y: SHEET.h });           /* sheet top-left */
    const w = SHEET.w * vp.scale, h = SHEET.h * vp.scale;

    /* white sheet with soft shadow */
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = SHEET.color;
    ctx.fillRect(tl.x, tl.y, w, h);
    ctx.restore();

    /* dashed printable margin, inset 10 */
    const m = SHEET.margin * vp.scale;
    ctx.save();
    ctx.strokeStyle = '#b0b0b0';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(tl.x + m, tl.y + m, w - 2 * m, h - 2 * m);
    ctx.restore();

    const doc = Nasj.doc;
    if (!doc) { if (Nasj.renderOverlay) Nasj.renderOverlay(); return; }
    const lmap = layerMap(doc);
    /* a paper-space colour: white geometry prints dark on the sheet */
    const sheetColor = (ent) => {
      let col = Nasj.docOps.resolveColor(doc, ent);
      if (ent.color !== '@bg' && (col === '#ffffff' || col === '#fff')) col = '#1b1b1b';
      return col;
    };
    const strokeInto = (ent) => {
      const width = Nasj.settings.lwt
        ? Math.max(1.4, Nasj.docOps.resolveLw(doc, ent) * 2.2) : 1;
      strokeEntity(ctx, ent, sheetColor(ent), width, null,
        lockedAlpha(lmap.get(ent.layerId)), true);
    };

    knockoutColor = SHEET.color;
    /* each frame: the model grid and drawing it looks at, clipped to it */
    const model = modelEnts(doc).filter((e) => entVisible(e, lmap));
    for (const v of Nasj.layoutViewports()) {
      const R = Nasj.viewportScreenRect(v);
      const live = (v === mspVp);
      ctx.save();
      clipToRect(ctx, R);
      withViewport(v, () => {
        if (Nasj.settings.grid) {
          /* the grid is tuned for the dark canvas; on the white sheet it wants
             the industry standard's light-on-light tint instead */
          const mi = COL.gridMinor, ma = COL.gridMajor;
          COL.gridMinor = '#e2e6ea';
          COL.gridMajor = '#ccd2d8';
          try { drawGrid(ctx); } finally { COL.gridMinor = mi; COL.gridMajor = ma; }
        }
        for (const ent of model) strokeInto(ent);
      });
      ctx.restore();
      /* the frame itself: heavier while the pointer is working inside it */
      ctx.save();
      ctx.setLineDash([]);
      ctx.strokeStyle = live ? '#3d3d3d' : '#888888';
      ctx.lineWidth = live ? 2.5 : 1;
      ctx.strokeRect(R.x + .5, R.y + .5, R.w, R.h);
      ctx.restore();
    }

    /* the sheet's own geometry — title blocks, notes, anything drawn here */
    const paper = layoutRec();
    if (paper) {
      withPaper(() => {
        const own = (doc.$space && doc.$space.L === paper) ? doc.entities : paper.entities;
        for (const ent of own) {
          if (entVisible(ent, lmap)) strokeInto(ent);
        }
      });
    }
    knockoutColor = COL.bg;

    /* snapshot the finished sheet: the next unchanged pass is one blit */
    if (Nasj.doc && canvas) {
      let e = paperBmp.get(pkey);
      if (!e) e = { canvas: document.createElement('canvas') };
      paperBmp.delete(pkey);
      if (e.canvas.width !== canvas.width || e.canvas.height !== canvas.height) {
        e.canvas.width = canvas.width;
        e.canvas.height = canvas.height;
      }
      const pc = e.canvas.getContext('2d');
      pc.setTransform(1, 0, 0, 1, 0, 0);
      pc.clearRect(0, 0, e.canvas.width, e.canvas.height);
      pc.drawImage(canvas, 0, 0);
      e.sig = psig;
      e.doc = Nasj.doc;
      e.sel = Nasj.selection;
      e.selN = Nasj.selection ? Nasj.selection.size : 0;
      e.msp = mspVp;
      paperBmp.set(pkey, e);
      while (paperBmp.size > PAPER_BMP_MAX) paperBmp.delete(paperBmp.keys().next().value);
    }

    paperFrameSync();
    if (Nasj.renderOverlay) Nasj.renderOverlay();
  };
  /* the HTML chrome rides the activated frame, so tell the shell whenever
     panning or zooming the sheet has moved it */
  const paperFrameSync = () => {
    const R = mspVp ? Nasj.viewportScreenRect(mspVp) : null;
    const sig = R ? [R.x, R.y, R.w, R.h].map(Math.round).join() : '';
    if (sig !== paperFrameSig) {
      paperFrameSig = sig;
      Nasj.emit('nasj:paper', { rect: R });
    }
  };
  let paperFrameSig = '';

  /* ---------------- static-scene cache ----------------
   * The full scene (background, grid, entities incl. selection styling) is
   * rendered once into an offscreen canvas; Nasj.render() then only blits
   * it and paints the hover highlight on top. A full scene redraw happens
   * only when the viewport, document, layers, selection, canvas size or
   * render-affecting settings change (or an "unsafe" hover — one whose
   * translucent fills can't simply be overdrawn — must be baked in). */
  let sceneCanvas = null, sctx = null;
  let sceneState = null;     /* signature of what sceneCanvas currently holds */

  /* ============================================================ *
   * AND THE BITMAP IS PER DRAWING TOO. One canvas meant a tab click threw
   * away a finished picture of a drawing that had not changed, and the
   * incoming drawing came back to a blank scene signature: a background
   * regen restarted from nothing (its 20-25ms slices landing straight
   * after the click) and the eye watched the text and dimensions fill back
   * in over a second or two. Each drawing keeps the bitmap it left, at the
   * view it left it at — which is exactly the view a switch restores — so
   * the signature still matches and the switch is one drawImage.
   *
   * THE BUDGET, in the same spirit as the GL cache and much smaller: a
   * bitmap is one screenful plus the 35% pad ring each side, ~30MB at a
   * 1600x900 window on a 2x display. Three drawings' worth is the cap:
   * the pair a switch alternates between plus the one being left, and
   * beyond that the oldest is dropped and its drawing regenerates the way
   * it always did.
   * ============================================================ */
  const BMP_DOCS = 4;
  const BMP_BYTE_CAP = 192 * 1024 * 1024;
  const bmpDocs = new Map();               /* doc -> {canvas, ctx, state} */
  const bmpBytesOf = (c) => (c ? c.width * c.height * 4 : 0);
  let bmpBytes = 0;
  const bmpTrim = () => {
    while (bmpDocs.size > BMP_DOCS ||
        (bmpBytes > BMP_BYTE_CAP && bmpDocs.size > 1)) {
      const k = bmpDocs.keys().next().value;
      const e = bmpDocs.get(k);
      bmpBytes -= bmpBytesOf(e && e.canvas);
      bmpDocs.delete(k);
    }
    if (bmpBytes < 0) bmpBytes = 0;
  };
  const parkBitmap = () => {
    if (!sceneCanvas || !sceneState || !sceneState.doc) {
      /* nothing identifiable on it: whatever it holds is nobody's picture */
      sceneCanvas = null; sctx = null; sceneState = null;
      return;
    }
    const d = sceneState.doc;
    const had = bmpDocs.get(d);
    if (had) bmpBytes -= bmpBytesOf(had.canvas);
    bmpDocs.delete(d);
    bmpDocs.set(d, { canvas: sceneCanvas, ctx: sctx, state: sceneState });
    bmpBytes += bmpBytesOf(sceneCanvas);
    bmpTrim();
    sceneCanvas = null; sctx = null; sceneState = null;
  };
  const bindBitmap = (doc) => {
    if (sceneState && sceneState.doc === doc) return;
    if (sceneState && sceneState.doc && sceneState.doc !== doc) parkBitmap();
    else if (!sceneState) { sceneCanvas = null; sctx = null; }
    const e = doc ? bmpDocs.get(doc) : null;
    if (!e) return;
    bmpDocs.delete(doc);
    bmpBytes -= bmpBytesOf(e.canvas);
    sceneCanvas = e.canvas; sctx = e.ctx; sceneState = e.state;
    /* the screen still holds the drawing being left: the composite must
       run, however well the signature matches */
    painted = null;
  };
  Nasj.sceneForget = (doc) => {
    const e = bmpDocs.get(doc);
    if (!e) return;
    bmpBytes -= bmpBytesOf(e.canvas);
    bmpDocs.delete(doc);
  };
  /* is this drawing's picture still where it left it? */
  Nasj.sceneResident = (doc) => !!doc &&
    (bmpDocs.has(doc) || !!(sceneState && sceneState.doc === doc));
  /* read-only introspection, in the same spirit as _sceneMs above: what the
     bitmap budget is holding, for QA and the curious. No behavior rides on it. */
  Nasj._bmpStats = () => ({ docs: bmpDocs.size, parked: bmpBytes,
    bytes: bmpBytes + bmpBytesOf(sceneCanvas), capBytes: BMP_BYTE_CAP });

  /* ============================================================ *
   * UNDEFEATABLE REGEN. Past this entity count the crisp scene pass
   * stops being one synchronous stroke-everything call (12 SECONDS of
   * frozen window on a 240k-entity DWG) and becomes a BACKGROUND JOB:
   * a second offscreen canvas filled a time-budgeted chunk per frame,
   * the screen meanwhile showing the old scene blitted through the
   * viewport delta — or, when the content itself changed, the partial
   * build growing in, which is the industry standard's own regen behaviour. The job
   * swaps in atomically when it finishes; any change of view or content
   * before then simply restarts it. Light drawings never enter here, so
   * every existing pixel-for-pixel behaviour below this count is
   * untouched.
   * ============================================================ */
  const SCENE_ASYNC_N = 20000;
  /* NO BLUR WHERE CRISP IS CHEAP. The interactive blit exists because a
     full scene pass can cost seconds — but at most views it costs
     milliseconds (the cull leaves little to stroke). The smoothed cost of
     recent passes decides: under this budget the next frames render crisp
     directly, every frame, and the stretched-bitmap blur never appears.
     Over it, the blit carries the interaction and the crisp lands at the
     settle. One hitch on the transition into a heavy view re-measures. */
  const CRISP_EVERY_MS = 40;
  /* HYSTERESIS, NOT A HAIR TRIGGER. A raw last-sample flips a mid-density
     view between crisp and blurred frames tick by tick; the cost is
     smoothed and the mode is sticky — blit above the enter budget, back
     to every-frame crisp only once passes are clearly cheap again */
  const CRISP_EXIT_MS = 20;
  let sceneMsEma = 0;
  let blitMode = false;
  const noteSceneMs = (ms) => {
    sceneMsEma = sceneMsEma ? sceneMsEma * 0.6 + ms * 0.4 : ms;
    if (sceneMsEma > CRISP_EVERY_MS) blitMode = true;
    else if (sceneMsEma < CRISP_EXIT_MS) blitMode = false;
  };
  /* glscene phase 3: read-only introspection — the 2D settle cost (EMA of
     the full remainder pass), for the perf probes. No behavior rides on it. */
  Nasj._sceneMs = () => sceneMsEma;
  Nasj._sceneGen = () => sceneGen;     /* phase-4 probes: bitmap generation */
  /* and which way a gesture frame went: the blit latch, and whether what is
     on screen came from a crisp composite. Read-only, for the perf probes. */
  Nasj._blitMode = () => blitMode;
  Nasj._painted = () => (painted ? { crisp: !!painted.crisp } : null);
  /* Reveals back off: the first increments are what tell the eye the window
     is alive, and by the tenth the picture is mostly there and each full-
     canvas composite is only stealing from the finish. */
  const REVEAL_MS = 120, REVEAL_MAX_MS = 500;
  let baseCanvas = null, bctx = null;   /* what a reveal grows over */
  let jobCanvas = null, jctx = null;
  let sceneJob = null;       /* {sig, i, cutoff, raf, cpu} */
  /* glscene phase 3: bumped whenever sceneCanvas gains fresh content — the
     GL layer re-uploads its remainder texture only when this moves */
  let sceneGen = 0;
  const cancelSceneJob = () => {
    if (!sceneJob) return;
    if (sceneJob.raf) cancelAnimationFrame(sceneJob.raf);
    sceneJob = null;
  };
  /* whether the partial build is what the screen is showing: only while the
     live view still stands exactly where the job is drawing it */
  const revealShows = (sig) => vp.scale === sig.scale &&
    vp.tx === sig.tx && vp.ty === sig.ty &&
    cssW === sig.w && cssH === sig.h && !Nasj.paper && !tiled();
  const sceneJobStep = () => {
    if (!sceneJob) return;
    sceneJob.raf = 0;
    const sig = sceneJob.sig;
    const doc = sig.doc;
    if (!doc || doc !== Nasj.doc) { cancelSceneJob(); return; }
    /* ONE SLICER PER FRAME DURING AN OPEN. While the GL scene is building
       behind the progress bar it is the one thing the open is waiting on,
       and a frame that ran its slice AND this one took two budgets — the
       window's own cadence halved for the length of the build. This waits;
       nothing on screen regresses meanwhile (the frame that is up stays
       up), and the GL scene's arrival is what completes the picture. */
    if (docLoading() && Nasj.glscene && Nasj.glscene.building &&
        Nasj.glscene.building()) {
      sceneJob.raf = requestAnimationFrame(sceneJobStep);
      return;
    }
    /* THE LIST MUST STILL BE TRUE. This job's slices are indices into the
       remainder as it stood when the job began; if ownership has moved
       since — an edit patched, a layer went off, a definition stopped
       being pure — the half-drawn bitmap is of a drawing that no longer
       exists. Ask again (O(1) while nothing moved) and, if the answer is a
       different list, drop this job and let the render start a true one. */
    if (sceneJob.rest && glRestNow() !== sceneJob.rest) {
      cancelSceneJob();
      scheduleRender();
      return;
    }
    pocheMode = !!Nasj.settings.poche;
    const padW = scenePadX(), padH = scenePadY();
    const sw = sig.w + 2 * padW, sh = sig.h + 2 * padH;
    /* borrow the JOB's transform, not the live one — the user may be
       panning while this builds */
    const keep = { sc: vp.scale, tx: vp.tx, ty: vp.ty, w: cssW, h: cssH };
    vp.scale = sig.scale; vp.tx = sig.tx + padW; vp.ty = sig.ty + padH;
    cssW = sw; cssH = sh;
    const t0 = performance.now();
    try {
      /* the deadline rides INTO the pass (fixed chunks froze: 400 entities
         of a block library — each an insert stroking a whole definition —
         held ~600ms of work between two time checks). And the CPU only
         ISSUES the strokes; a step that queues 20ms of issue at a dense
         view can queue far more GPU rasterization, and once that queue
         backs up the compositor starves rAF for seconds while timers keep
         firing. Shallow steps let the GPU drain between frames — but only
         while there is a live picture (the blit) to keep moving; when the
         partial build IS the picture, a wider step grows it in faster. */
      /* and the blit is the live picture only until the reveal below takes
         over: once the partial build is what the screen shows, this is the
         second case whatever moved — and the widest step, since nothing is
         left that a shallow one would keep moving */
      const showing = revealShows(sig);
      const live = !showing && sameSigContent(sceneState, sig) &&
        sig.scale / sceneState.scale > 0.04 && sig.scale / sceneState.scale < 25;
      /* nobody has touched pointer or wheel for 300ms: nothing needs the
         blit's 12ms headroom, so the step widens — and pulls straight back
         when a rAF gap over 40ms shows the compositor starving */
      if (sceneJob.pt && t0 - sceneJob.pt > 40) sceneJob.slow = t0;
      sceneJob.pt = t0;
      const wide = t0 - lastInteractT > 300 &&
        !(sceneJob.slow && t0 - sceneJob.slow < 300);
      /* glscene phase 5 (weak-device parity): on a weak GPU the CPU issue
         outruns the rasterizer several-fold — a 25ms step queued 400-600ms
         of raster and the compositor starved rAF for exactly that long
         (measured on the UHD 770, no long task anywhere). Below tier A the
         step stays shallow and the next one waits an extra frame, so the
         queue drains between steps; the crisp lands later, which the tier
         already promised. */
      const weakGpu = !!(Nasj.glscene && Nasj.glscene.weakTier &&
        Nasj.glscene.weakTier());
      sceneJob.weak = weakGpu;
      /* while the open's bar is up every step is one frame's worth at most
         — the crosshair belongs to the OS then, and the OS only gets to
         draw it when this thread lets the compositor run */
      /* AND ON THE GL PATH NOTHING ON SCREEN IS WAITING FOR THIS. Both wide
         cases above are about a picture the eye is missing: 25ms when the
         partial build IS the frame (grow it in), 20ms when neither blit nor
         reveal has anything to show. With the GPU drawing the geometry the
         frame is already whole and true — this pass only crisps the text —
         so a step wider than the display period buys nothing and costs a
         25ms rAF gap through every settle (measured: a sweep's settle ran
         into "wide" 300ms after the last notch and every remaining step
         became a 25ms hitch; flattened to 12 the hitches were still 19ms —
         a 12ms step plus overhead spills past a 100-120Hz vsync). The 6ms
         budget (principle: slice long work on a budget that yields to
         input) fits inside one display period with room for the
         compositor, so the settle stays invisible however long the
         remainder takes. */
      const glLiveJob = !!(Nasj.glscene && Nasj.glscene.live());
      const stepMs = docLoading() ? LOAD_SLICE_MS
        : glLiveJob ? 6
          : (live ? (wide ? 25 : 12) : (showing ? 25 : 20));
      const deadline = t0 + (weakGpu ? Math.min(6, stepMs) : stepMs);
      const L = sceneJob.list;
      while (sceneJob.i < L.length && performance.now() < deadline) {
        sceneJob.i = drawEntities(jctx, doc, sig.hoverBaked, sceneJob.i,
          Math.min(sceneJob.i + 2000, L.length),
          sceneJob.cutoff, deadline, L);
      }
    } finally {
      vp.scale = keep.sc; vp.tx = keep.tx; vp.ty = keep.ty;
      cssW = keep.w; cssH = keep.h;
    }
    sceneJob.cpu = (sceneJob.cpu || 0) + (performance.now() - t0);
    if (sceneJob.i >= sceneJob.list.length) {
      /* done: the finished bitmap becomes THE scene, atomically */
      noteSceneMs(sceneJob.cpu);
      const c = sceneCanvas, x = sctx;
      sceneCanvas = jobCanvas; sctx = jctx;
      jobCanvas = c; jctx = x;
      sceneState = sig;
      sceneGen++;
      sceneJob = null;
      sceneFadeIn();
      startWarmJob();     /* the picture has landed: warm the pointer path */
      return;
    }
    /* PROGRESSIVE REVEAL. The partial build is composited OVER whatever the
       screen already holds — the stale stretched blit at a new zoom, bare
       background when the content itself is new — so a heavy view fills in
       the way the industry standard's does instead of holding a frozen picture for as long
       as the build takes (a zoom-out over a quarter-million entities: two
       seconds of nothing). Only while the live view still matches the job's:
       panning meanwhile leaves the screen to the blit. The composite costs a
       few ms of its own, so after the first step it is throttled — a dozen
       increments read as growth, sixty read the same and cost five times as
       much. */
    if (revealShows(sig) &&
        /* glscene phase 4 (zero flashing): with GL live the frame on
           screen is already WHOLE — geometry true on the GL layer, the
           last-good remainder over it. A reveal would trade that for GL
           plus a PARTIAL remainder (its text dips out, then back: the
           measured per-pause flicker). Reveals belong to the 2D-only
           path; with GL live the finished job swaps in atomically. */
        !(Nasj.glscene && Nasj.glscene.live()) &&
        (!sceneJob.lastReveal || t0 - sceneJob.lastReveal >
          Math.min(REVEAL_MAX_MS, REVEAL_MS * Math.pow(1.5, sceneJob.reveals || 0)))) {
      sceneJob.lastReveal = t0;
      /* what the reveal grows OVER never changes while the job runs, and
         re-blitting a stretched scene per reveal costs more than the chunk
         it shows — so the settle's own composite, which is on screen the
         first time through, is kept and replayed 1:1 */
      if (!sceneJob.based) {
        sceneJob.based = true;
        if (!baseCanvas) {
          baseCanvas = document.createElement('canvas');
          bctx = baseCanvas.getContext('2d');
        }
        if (baseCanvas.width !== canvas.width || baseCanvas.height !== canvas.height) {
          baseCanvas.width = Math.max(1, canvas.width);
          baseCanvas.height = Math.max(1, canvas.height);
        }
        bctx.setTransform(1, 0, 0, 1, 0, 0);
        bctx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
        bctx.drawImage(canvas, 0, 0);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(baseCanvas, 0, 0);
      ctx.drawImage(jobCanvas,
        Math.round(padW * dpr), Math.round(padH * dpr),
        canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sceneJob.reveals = (sceneJob.reveals || 0) + 1;
    }
    /* phase 5: a weak GPU gets a drain frame between steps (see above) —
       identity-checked, so a cancel-and-restart never double-schedules */
    const j = sceneJob;
    sceneJob.raf = requestAnimationFrame(j.weak
      ? () => { if (sceneJob === j) j.raf = requestAnimationFrame(sceneJobStep); }
      : sceneJobStep);
  };
  const startSceneJob = (sig) => {
    cancelSceneJob();
    if (!jobCanvas) {
      jobCanvas = document.createElement('canvas');
      jctx = jobCanvas.getContext('2d');
    }
    const targetW = Math.max(1, Math.round((sig.w + 2 * scenePadX()) * dpr));
    const targetH = Math.max(1, Math.round((sig.h + 2 * scenePadY()) * dpr));
    if (jobCanvas.width !== targetW || jobCanvas.height !== targetH) {
      jobCanvas.width = targetW;
      jobCanvas.height = targetH;
    }
    jctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    jctx.clearRect(0, 0, targetW, targetH);
    /* the list this job will slice, resolved ONCE — the slices are indices
       into it, and it must be the same list from first slice to last or
       the bitmap would be part one drawing and part another. The raw
       remainder is kept beside it so each step can check it is still the
       one the GL layer is leaving (see sceneJobStep). */
    const rest = glRestNow();
    let jlist = glRestList(sig.doc, sig.hoverBaked, glOwnerNow(), rest) ||
      sig.doc.entities;
    /* AND THE SAME CULL THE SYNCHRONOUS PASS GETS. A full pass at a tight
       view asks the spatial index which entities the view can even touch
       and walks those; the chunked pass never did, so it walked the whole
       list every time — every entity of the drawing whenever the GL layer
       is not live (a rebuild after a switch: a quarter of a million), and
       the whole remainder when it is. Resolved ONCE here, with the job's
       own view borrowed, because the slices are indices into it and it
       must be the same list from the first to the last.
       WHAT THIS MAY AND MAY NOT DO. The index answers with a SUPERSET of
       what the rectangle touches, so filtering the list through it drops
       only entities the walk's own bounds rejection would have dropped —
       identical ink. Order is the list's own (a filter, never a re-sort),
       so draw order and the slice boundaries are what they were. The
       selection and hover extras glRestList appends are kept whatever the
       index says: their styling is drawn wherever they are. */
    const CULL_MIN = 1000;
    /* HOW BIG AN ANSWER IS WORTH ASKING FOR. The probe costs one Set entry
       per entity the view touches — measured at ~0.15µs each, so 48 000 is
       about 7ms — and it gives up the moment it passes that, so a view
       holding the whole drawing costs the cap and not the drawing. Against
       that: the pass it may halve is 80-100ms at a mid view with the GPU
       drawing the geometry and well over a second with the GPU layer off,
       where the list IS the document. Seven milliseconds, at most twice a
       second (see the refusal memo below), buys that. */
    const CULL_CAP = 48000;
    /* a view whose index answer was too big to be worth a set is still too
       big a beat later, and a gesture restarts this job over and over: the
       refusal stands for half a second at the same scale, the same way the
       greek cutoff's does */
    const cnow = performance.now();
    const cullOff = cullBail.doc === sig.doc && cullBail.scale === sig.scale &&
      cnow - cullBail.t < 500;
    if (!cullOff && !view3d.active && !Nasj.paper && !tiled() &&
        jlist.length > CULL_MIN) {
      const keep = { sc: vp.scale, tx: vp.tx, ty: vp.ty, w: cssW, h: cssH };
      let near = null;
      /* the job's view is the PADDED one — its bitmap carries a ring beyond
         the window so a pan can blit into it — so the cull must ask about
         the same rectangle the slices will draw */
      const padW = scenePadX(), padH = scenePadY();
      vp.scale = sig.scale; vp.tx = sig.tx + padW; vp.ty = sig.ty + padH;
      cssW = sig.w + 2 * padW; cssH = sig.h + 2 * padH;
      try {
        const view = viewWorldBounds();
        const pad = 4 / sig.scale;
        near = queryIndexIdSet(sig.doc, view.minx - pad, view.miny - pad,
          view.maxx + pad, view.maxy + pad, CULL_CAP);
      } finally {
        vp.scale = keep.sc; vp.tx = keep.tx; vp.ty = keep.ty;
        cssW = keep.w; cssH = keep.h;
      }
      if (near) {
        const sel = Nasj.selection instanceof Set ? Nasj.selection : null;
        const culled = jlist.filter((e) => near.has(e.id) ||
          (sel && sel.has(e.id)) || e.id === sig.hoverBaked);
        if (culled.length < jlist.length) jlist = culled;
      } else cullBail = { doc: sig.doc, scale: sig.scale, t: cnow };
    }
    /* the cutoff walk is O(entities), and a gesture restarts the job over
       the same content at the same scale — the last answer stands 500ms.
       Over the list, not the document: no text is ever GL-owned, so every
       glyph the budget weighs is in the list either way (and the cull
       above drops only glyphs the cutoff's own view test drops). */
    let cutoff;
    const gnow = performance.now();
    if (greekJobC.doc === sig.doc && greekJobC.rev === sig.rev &&
        greekJobC.scale === sig.scale && gnow - greekJobC.t < 500) {
      cutoff = greekJobC.val;
    } else {
      /* the cutoff wants the job's own view; borrow it for the measurement */
      const keep = { sc: vp.scale, tx: vp.tx, ty: vp.ty };
      vp.scale = sig.scale; vp.tx = sig.tx; vp.ty = sig.ty;
      try { cutoff = computeGreekCutoff(sig.doc, jlist); }
      finally { vp.scale = keep.sc; vp.tx = keep.tx; vp.ty = keep.ty; }
      greekJobC = { doc: sig.doc, rev: sig.rev, scale: sig.scale, t: gnow, val: cutoff };
    }
    sceneJob = { sig, i: 0, cutoff, list: jlist, rest, listN: jlist.length,
      raf: requestAnimationFrame(sceneJobStep) };
  };
  let greekJobC = { doc: null, rev: -1, scale: 0, t: -1e9, val: GREEK_PX };
  let cullBail = { doc: null, scale: 0, t: -1e9 };

  /* the EMA can be stale-low (a cheap detail view) the instant a zoom-out
     lands on the whole drawing — committing that first frame to the
     synchronous pass is a several-hundred-ms freeze mid-gesture. Ask the
     index how much the NEW view holds before the sync path may run. */
  const predictHeavyScene = (doc) => {
    if (doc.entities.length <= SCENE_ASYNC_N) return false;
    const view = viewWorldBounds();
    const pad = 4 / vp.scale;
    /* the count is a weak cost proxy — in a block library each "entity"
       strokes a whole definition — so the line sits low: a few hundred
       borderline entities settle through the job a frame later, which is
       invisible, while a wrong sync guess is a visible freeze */
    return queryIndexOver(doc, view.minx - pad, view.miny - pad,
      view.maxx + pad, view.maxy + pad, 500) !== 0;
  };

  /* a running job stays valid across a pan: same content, same scale —
     its bitmap merely lands elsewhere on screen, and letting it finish is
     what refills the pad mid-gesture. Only a scale or content change
     makes its picture wrong. */
  const sceneJobCovers = (sig) => !!sceneJob &&
    sceneJob.sig.scale === sig.scale && sceneJob.sig.glg === sig.glg &&
    sameSigContent(sceneJob.sig, sig);

  /* the finished crisp bitmap eases in over a few frames: the previous
     frame is held on top with a falling alpha, because the single-frame
     snap from stretched blit to crisp is itself one of the pops */
  let fadeCanvas = null, fctx = null, fadeRaf = 0;
  const FADE_STEPS = 3;
  const sceneFadeIn = () => {
    if (fadeRaf) { cancelAnimationFrame(fadeRaf); fadeRaf = 0; }
    /* AND NOTHING TO EASE WHEN NOTHING SNAPS. The ease exists for the
       single-frame jump from a stretched bitmap of the whole drawing to the
       crisp pass — one of the pops phase 4 hunted. Where the GPU draws the
       geometry, the frame that was on screen ALREADY held it true; what
       lands now is the 2D remainder crisping, measured at ~1% of the
       picture's edge energy (888 → 898 on BLOCKS at a deep view). Easing
       that costs four full-canvas composites and four frames of settle for
       a step the eye cannot find, so the GL path takes the crisp frame
       straight. Below tier A the gesture frames live on the DOM canvas and
       the 2D one holds only bg+grid — there the ease still has work to do,
       and keeps it. */
    if (Nasj.glscene && Nasj.glscene.live() &&
        (!(Nasj.glscene.weakTier && Nasj.glscene.weakTier()) ||
         (Nasj.glscene.dragActive && Nasj.glscene.dragActive()))) {
      /* mid-drag the ease has nothing to ease FROM: the presented canvas
         holds the ghost, and baking it into the fade frames drew a fading
         double-ghost trail — a crisp landing under a drag swaps straight */
      /* and it takes its own frame: this runs at the tail of the job's last
         slice, and the composite stacked on top of it is what made that one
         frame 41-50ms while every other frame of the settle was 12 */
      fadeRaf = requestAnimationFrame(() => {
        fadeRaf = 0;
        painted = null;
        Nasj.render();
      });
      return;
    }
    if (!fadeCanvas) {
      fadeCanvas = document.createElement('canvas');
      fctx = fadeCanvas.getContext('2d');
    }
    if (fadeCanvas.width !== canvas.width || fadeCanvas.height !== canvas.height) {
      fadeCanvas.width = Math.max(1, canvas.width);
      fadeCanvas.height = Math.max(1, canvas.height);
    }
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, fadeCanvas.width, fadeCanvas.height);
    fctx.drawImage(canvas, 0, 0);
    /* glscene phase 4 (zero flashing): with GL live the gesture frames
       lived on the GL DOM canvas — the 2D canvas under it holds only
       bg+grid, and a fade started from that partial dimmed every settled
       stroke for two frames (the measured ~13% settle pop). The fade
       must start from the COMPLETE frame the eye was just given. */
    let steps = FADE_STEPS;
    if (Nasj.glscene && Nasj.glscene.presentedCanvas) {
      const pc = Nasj.glscene.presentedCanvas();
      if (pc) {
        fctx.drawImage(pc, 0, 0);
        /* a GL gesture frame carries a STRETCHED remainder; at depth the
           crisping delta runs ~5-6% of ink, so the ease takes one more
           frame to keep every step under the 2% flash gate. The 2D-only
           path keeps its exact three. */
        steps = FADE_STEPS + 1;
      }
    }
    const sig0 = sceneState;
    let step = 0;
    const tick = () => {
      fadeRaf = 0;
      step++;
      painted = null;               /* each fade frame repaints in full */
      Nasj.render();
      if (step >= steps) return;
      /* a view or doc change mid-fade means the old frame no longer
         aligns — the render above already showed the right thing */
      if (!painted || !painted.crisp || sceneState !== sig0) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1 - step / steps;
      ctx.drawImage(fadeCanvas, 0, 0);
      ctx.globalAlpha = 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      painted = null;
      fadeRaf = requestAnimationFrame(tick);
    };
    tick();
  };

  /* ============================================================ *
   * THE FIRST HOVER IS A HOVER LIKE ANY OTHER. The pointer paths cull a
   * reference's children against the cursor using a per-definition table
   * of child boxes, and the first cursor to reach a definition the
   * renderer never measured builds it — for a 60,000-child library block
   * that is tens of milliseconds, paid on the pointer path, once per
   * definition, exactly when a hand first touches the mouse. So heavy
   * drawings build them HERE instead: every definition an insert actually
   * references, biggest first, in idle slices between frames, standing
   * aside the moment anything else wants the thread. Light drawings never
   * enter — their whole table costs less than one frame.
   * ============================================================ */
  const WARM_SLICE_MS = 8;
  let warmJob = null;
  /* per DRAWING, like everything else a switch must not undo: one record
     meant coming back to a warmed drawing re-ran its whole warm job */
  const warmDoneAt = new WeakMap();          /* doc -> generation */
  const warmIsDone = (doc) => !!doc && warmDoneAt.get(doc) === docGen(doc);
  const warmMarkDone = (doc) => { if (doc) warmDoneAt.set(doc, docGen(doc)); };
  const cancelWarmJob = () => {
    if (warmJob && warmJob.raf) cancelAnimationFrame(warmJob.raf);
    warmJob = null;
  };
  /* one bounded slice of the warm work (def metrics, then the view warm);
     returns false when everything is warm. Shared by the idle rAF pacing
     below and the open-time front-load (Nasj.openWarm), which drives it
     full speed while the progress bar is still up. */
  const warmSlice = (deadline) => {
    const doc = warmJob.doc;
    /* the id index behind entityById is rebuilt whole for a new drawing, and
       the first hover to land on something is what asks for it — a quarter
       of a million entries, on the pointer path */
    if (!warmJob.ids) {
      warmJob.ids = true;
      if (doc.entities.length) Nasj.docOps.entityById(doc, doc.entities[0].id);
      return true;
    }
    /* which definitions to warm, worst first — one walk of the whole model
       space, so it too is taken a slice at a time (see startWarmJob) */
    if (!warmJob.names && warmNameStep(warmJob, deadline)) return true;
    /* nothing an insert names: there is no pointer-path cost to warm here,
       and there never was — the job ends exactly where it used to */
    if (!warmJob.names.length) {
      warmMarkDone(doc);
      warmJob = null;
      return false;
    }
    const G = Nasj.geom;
    while (warmJob.i < warmJob.names.length && performance.now() < deadline) {
      const d = doc.blocks[warmJob.names[warmJob.i]];
      /* a definition with sixty thousand children is 40ms of metrics in one
         bite: behind the open's bar it too is taken a slice at a time, and
         this name is only ticked off when its table is whole */
      if (d && Array.isArray(d.entities) && G.defChildMetricsStep) {
        if (G.defChildMetricsStep(d, deadline)) return true;
      } else if (d && Array.isArray(d.entities)) G.defChildMetrics(d);
      warmJob.i++;
    }
    if (warmJob.i >= warmJob.names.length) {
      /* the metrics are done: warm the VIEW next (see viewWarmStep) */
      if (viewWarmStep(doc, warmJob, deadline)) return true;
      warmMarkDone(doc);
      warmJob = null;
      return false;
    }
    return true;
  };
  const warmStep = () => {
    if (!warmJob) return;
    warmJob.raf = 0;
    const doc = warmJob.doc;
    if (doc !== Nasj.doc || warmJob.gen !== docGen(doc)) { cancelWarmJob(); return; }
    const t0 = performance.now();
    /* the user is driving, or the scene is still building or easing in:
       wait, never compete */
    if (t0 - lastInteractT < 200 || sceneJob || crispTimer || fadeRaf) {
      warmJob.raf = requestAnimationFrame(warmStep);
      return;
    }
    if (warmSlice(t0 + WARM_SLICE_MS)) warmJob.raf = requestAnimationFrame(warmStep);
  };

  /* ============================================================ *
   * THE VIEW A ZOOM-OUT LANDS ON. Wheeling out to the whole drawing pays,
   * at the far end, every block definition's bitmap tile at a scale bucket
   * nothing has built yet — a second and a half of it on a quarter-million
   * entity library, with the screen holding a stale picture throughout, and
   * that is the "especially the first time" of the complaint. The view is
   * known before the gesture is made: it is the fitted one, where a
   * zoom-out stops. So it is drawn HERE, in the same idle slices, into a
   * scratch canvas nothing ever shows — the tiles it leaves behind are the
   * whole point. Nearly every reference in a library is unscaled, so a tile
   * BUCKET is a zoom level and not a per-block affair: the fitted view and
   * the bucket below it are the two a wheel can stop in around the fit, and
   * both are warmed. A view already inside a warmed bucket is skipped.
   * ============================================================ */
  let warmCanvas = null, wctx = null;
  const tileBucketOf = (s) => Math.ceil(Math.log(s) / LOG1_25);
  const viewWarmTargets = (doc) => {
    if (view3d.active || Nasj.paper || tiled() || twist) return [];
    const keep = { sc: vp.scale, tx: vp.tx, ty: vp.ty };
    let fit = null;
    try {
      vp.zoomContent();
      fit = { scale: vp.scale, tx: vp.tx, ty: vp.ty };
    } catch (e) { fit = null; }
    vp.scale = keep.sc; vp.tx = keep.tx; vp.ty = keep.ty;
    if (!fit || !(fit.scale > 0)) return [];
    const out = [];
    const seen = new Set([tileBucketOf(keep.sc)]);
    for (const s0 of [fit.scale, fit.scale / 1.25]) {
      const b = tileBucketOf(s0);
      if (seen.has(b)) continue;
      seen.add(b);
      /* the FOOT of the bucket, not the fit itself: every scale in a bucket
         shares its tiles, and the smallest of them frames the most drawing —
         so one pass warms whatever the wheel stops on inside that bucket */
      const s = Math.pow(1.25, b - 1) * 1.0005;
      const k = s / fit.scale;
      out.push({
        scale: s,
        tx: cssW / 2 - (cssW / 2 - fit.tx) * k,
        ty: cssH / 2 - (cssH / 2 - fit.ty) * k,
        i: 0, cutoff: null
      });
    }
    return out;
  };
  /* true while there is still warming to do */
  const viewWarmStep = (doc, job, deadline) => {
    if (job.vws === undefined) {
      /* finding the fit is one sweep of every entity's box — a quarter of
         a second of it — so at idle it waits for a longer stillness than
         the rest of the warm-up, and the one hitch it costs lands where no
         hand is on the mouse. The open-time front-load (job.fast) is behind
         the progress bar and may not hitch at all: there the sweep is taken
         a slice at a time, and viewWarmTargets then reads the answer off
         the fit cache without touching an entity. */
      if (!job.fast && performance.now() - lastInteractT < 800) return true;
      /* the fit sweep is a quarter of a second on a block library, and at
         idle it used to run straight through — one 410ms task, measured,
         a second after a tab click. It is the same resumable job the
         front-load drives; take it a slice at a time here too. */
      if (contentFitStep(doc, deadline)) return true;
      job.vws = viewWarmTargets(doc);
      job.vwi = 0;
    }
    while (job.vwi < job.vws.length && job.vws[job.vwi].i >= doc.entities.length) job.vwi++;
    const t = job.vws[job.vwi];
    if (!t) {
      warmCanvas = null; wctx = null;   /* a screenful of pixels, done with */
      return false;
    }
    if (!warmCanvas) {
      warmCanvas = document.createElement('canvas');
      wctx = warmCanvas.getContext('2d');
    }
    const W = Math.max(1, Math.round(cssW * dpr)), H = Math.max(1, Math.round(cssH * dpr));
    if (warmCanvas.width !== W || warmCanvas.height !== H) {
      warmCanvas.width = W;
      warmCanvas.height = H;
    }
    /* the pass reads the module's view and greeking state and writes both;
       every scrap of it is put back, because nothing on screen moved */
    const keep = { sc: vp.scale, tx: vp.tx, ty: vp.ty,
      gk: greekCutoff, gp: greekPrev, pm: pocheMode };
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!t.i) wctx.clearRect(0, 0, cssW, cssH);
    pocheMode = !!Nasj.settings.poche;
    vp.scale = t.scale; vp.tx = t.tx; vp.ty = t.ty;
    try {
      if (t.cutoff == null) t.cutoff = computeGreekCutoff(doc);
      while (t.i < doc.entities.length && performance.now() < deadline) {
        t.i = drawEntities(wctx, doc, null, t.i,
          Math.min(t.i + 500, doc.entities.length), t.cutoff, deadline);
      }
    } finally {
      vp.scale = keep.sc; vp.tx = keep.tx; vp.ty = keep.ty;
      greekCutoff = keep.gk; greekPrev = keep.gp; pocheMode = keep.pm;
    }
    return true;
  };
  /* only the definitions an insert names, worst first: the one that would
     cost the most on the pointer path is the one warmed first. The walk is
     over every entity in the drawing, so it is sliced like the rest — true
     while there is more of it to do. */
  const warmNameStep = (job, deadline) => {
    const ents = job.doc.entities;
    const size = job.size;
    let i = job.si;
    for (; i < ents.length; i++) {
      if (deadline && !(i & 511) && performance.now() > deadline) break;
      const e = ents[i];
      if (!e || e.type !== 'insert' || size.has(e.name)) continue;
      const d = job.doc.blocks[e.name];
      size.set(e.name, (d && Array.isArray(d.entities)) ? d.entities.length : -1);
    }
    job.si = i;
    if (i < ents.length) return true;
    const names = [];
    for (const [k, v] of size) if (v >= 0) names.push(k);
    names.sort((a, b) => size.get(b) - size.get(a));
    job.names = names;
    job.size = null;
    return false;
  };
  const startWarmJob = () => {
    const doc = Nasj.doc;
    if (!doc || !doc.blocks || doc.entities.length <= SCENE_ASYNC_N) return;
    if (warmIsDone(doc)) return;
    if (warmJob && warmJob.doc === doc && warmJob.gen === docGen(doc)) return;
    cancelWarmJob();
    warmJob = { doc, gen: docGen(doc), names: null, size: new Map(), si: 0, i: 0,
      raf: requestAnimationFrame(warmStep) };
  };

  /* ============================================================ *
   * GL-PLAN phase 4: the open-time FRONT-LOAD. app.js drives these while
   * the open progress bar is still up, so nothing cold is left to ambush
   * the first gesture — the same work the idle warms above do, minus the
   * waiting. Light drawings never call in (their warms cost milliseconds
   * and stay exactly where they were).
   * ============================================================ */
  Nasj.openWarm = {
    needed: (doc) => !!(doc && doc.blocks && doc.entities.length > SCENE_ASYNC_N),
    /* the crisp settle has landed and nothing is mid-flight */
    settled: () => !sceneJob && !crispTimer && !fadeRaf &&
      !!(painted && painted.crisp),
    /* the monolithic pointer-path sweeps, one slice per call: the spatial
       index (the first hover's 467-683ms) and the id index behind
       entityById. true while there is more to do. */
    primeStep(doc, budget) {
      if (!doc || doc !== Nasj.doc) return false;
      if (indexWarmStep(doc, performance.now() + Math.max(2, budget || LOAD_SLICE_MS))) return true;
      /* a quarter of a million entries, measured at 13ms — one slice */
      if (!this._ids && doc.entities.length) {
        this._ids = true;
        Nasj.docOps.entityById(doc, doc.entities[0].id);
        return true;
      }
      this._ids = false;
      return false;
    },
    /* the content fit a zoom-out lands on, one slice per call — the sweep
       the opening frame and the tile warm below both want */
    fitStep(doc, budget) {
      if (!doc || doc !== Nasj.doc) return false;
      return contentFitStep(doc, performance.now() + Math.max(2, budget || LOAD_SLICE_MS));
    },
    /* one bounded slice of def metrics + fitted-view tile warming;
       false = everything is warm (or nothing applies) */
    step(doc, budget) {
      if (!doc || doc !== Nasj.doc) return false;
      if (warmIsDone(doc)) return false;
      if (!warmJob || warmJob.doc !== doc || warmJob.gen !== docGen(doc)) startWarmJob();
      if (!warmJob) return false;
      warmJob.fast = true;               /* the bar is up: no idle waits */
      return warmSlice(performance.now() + Math.max(2, budget || LOAD_SLICE_MS));
    },
    /* progress for the bar: fraction of the def-metrics list done */
    progress() {
      if (!warmJob || !warmJob.names || !warmJob.names.length) return 1;
      return warmJob.i / warmJob.names.length;
    }
  };

  const layersSig = (doc) => {
    /* the isolation generation rides the layer signature: hiding an object
       changes what the scene shows exactly the way switching a layer off
       does, and the cached bitmap must be beaten the same way */
    let s = '#h' + hiddenGen + ';';
    for (const l of doc.layers) {
      s += l.id + '|' + l.color + '|' + (l.on ? 1 : 0) + (l.frozen ? 1 : 0) +
        (l.locked ? 1 : 0) + '|' + (l.lt || '') + '|' + (l.lw != null ? l.lw : '') + ';';
    }
    /* the geometry side keeps its own roll of the layers that hide a block's
       children, and this is the one place the whole table is already read
       and compared — so it is told here, and is exactly as fresh as the
       cached bitmap that turns on the same comparison */
    if (s !== lastLayersSig) {
      lastLayersSig = s;
      if (Nasj.geom && Nasj.geom.layersChanged) Nasj.geom.layersChanged();
    }
    return s;
  };
  let lastLayersSig = '';

  /* the text styles, as a signature: font and effects are read at draw time,
     so a style edit must beat the cached bitmap — the PTYPE lesson again */
  const textStylesSig = (doc) => {
    const s = doc && doc.styles;
    if (!s) return '';
    /* the whole of both tables: a text style's font and effects and a
       dimension style's lines, arrows and units are all read at draw time,
       so any edit to them has to beat the cached bitmap */
    try { return JSON.stringify(s); } catch (e) { return ''; }
  };

  const sceneSig = (doc) => {
    /* whether the mass highlight is the GPU tint or strokes in this very
       bitmap, and how many not-selected entities the tint owes the 2D pass */
    const t = selTintNow();
    return {
    /* THE DRAWING'S OWN REVISION, not the app's. A single global
       counter meant an edit in one tab invalidated the cached picture
       of every other, and a tab click invalidated all of them. */
    rev: docGen(doc),
    doc,
    ents: doc ? doc.entities : null,
    n: doc ? doc.entities.length : 0,
    lsig: doc ? layersSig(doc) : '',
    tsig: doc ? textStylesSig(doc) : '',
    sel: Nasj.selection instanceof Set ? Nasj.selection : null,
    selN: Nasj.selection instanceof Set ? Nasj.selection.size : 0,
    scale: vp.scale, tx: vp.tx, ty: vp.ty, tw: twist,
    v3a: view3d.active, vaz: view3d.azimuth, vel: view3d.elevation,
    vpp: !!view3d.persp, vpd: view3d.persp ? view3d.distance : 0,
    vro: view3d.roll, g3: gl3dLive(),
    w: cssW, h: cssH, dpr,
    grid: !!Nasj.settings.grid,
    gridSize: Nasj.settings.gridSize,
    /* the grid-beyond-limits clip is part of the picture: the toggle, and
       the LIMITS rectangle it cuts to, or the bitmap outlives both */
    gbl: Nasj.settings.gridBeyond === false ? JSON.stringify(limitsRect(doc)) : '',
    ux: Nasj.ucs.x, uy: Nasj.ucs.y,        /* the axes are drawn on the origin */
    lwt: !!Nasj.settings.lwt,
    poche: !!Nasj.settings.poche,
    /* PTYPE: point glyph and size — without these the cached bitmap
       outlives the style change and points never redraw */
    pdmode: Nasj.settings.pdmode | 0,
    pdsize: Number(Nasj.settings.pdsize) || 0,
    /* how far references fade and whether their clip frames show — both are
       settings, so the cached bitmap would otherwise outlive the change */
    xfade: Number(Nasj.settings.xdwgfadectl) || 0,
    frame: Nasj.settings.frame | 0,
    /* glscene phase 4: GL ownership generation — a build finish re-renders
       the settled bitmap (dropping the strokes GL now owns) WITHOUT
       breaking the content signature the gesture frames blit by */
    glg: glOwnGen,
    /* the visual style: a shaded style paints faces the wireframe ones do
       not, so the cached bitmap would otherwise outlive the change */
    vs: vstyle.name + '|' + (vstyle.fills ? 1 : 0) + (vstyle.edges ? 1 : 0) +
      (vstyle.gray ? 1 : 0) + '|' + vstyle.alpha,
    hoverBaked: null,
    tint: !!t,
    texc: t && t.exc ? t.exc.length : 0
    };
  };

  const sameSig = (a, b) => !!a && !!b && a.glg === b.glg &&
    a.rev === b.rev && a.doc === b.doc && a.ents === b.ents && a.n === b.n &&
    a.lsig === b.lsig && a.tsig === b.tsig && a.sel === b.sel && a.selN === b.selN &&
    a.scale === b.scale && a.tx === b.tx && a.ty === b.ty && a.tw === b.tw &&
    a.v3a === b.v3a && a.vaz === b.vaz && a.vel === b.vel &&
    a.vpp === b.vpp && a.vpd === b.vpd && a.vro === b.vro && a.g3 === b.g3 &&
    a.w === b.w && a.h === b.h && a.dpr === b.dpr &&
    a.grid === b.grid && a.gridSize === b.gridSize && a.gbl === b.gbl && a.lwt === b.lwt &&
    a.ux === b.ux && a.uy === b.uy &&
    a.pdmode === b.pdmode && a.pdsize === b.pdsize &&
    a.poche === b.poche && a.hoverBaked === b.hoverBaked &&
    a.xfade === b.xfade && a.frame === b.frame && a.vs === b.vs;

  /* glscene phase 4: the adoption test for GL-absorbed cycles — content
     minus exactly what absorption itself vouches for (the revision, the
     array identity, the count). Everything else equal, the remainder
     bitmap is byte-identical and may simply take the new revision. */
  const sameSigAdopt = (a, b) => !!a && !!b && a.tw === b.tw && a.glg === b.glg &&
    a.doc === b.doc &&
    a.lsig === b.lsig && a.tsig === b.tsig && a.sel === b.sel && a.selN === b.selN &&
    a.v3a === b.v3a && a.vaz === b.vaz && a.vel === b.vel &&
    a.vpp === b.vpp && a.vpd === b.vpd && a.vro === b.vro && a.g3 === b.g3 &&
    a.w === b.w && a.h === b.h && a.dpr === b.dpr &&
    a.grid === b.grid && a.gridSize === b.gridSize && a.gbl === b.gbl && a.lwt === b.lwt &&
    a.ux === b.ux && a.uy === b.uy &&
    a.pdmode === b.pdmode && a.pdsize === b.pdsize &&
    a.poche === b.poche && a.hoverBaked === b.hoverBaked &&
    a.xfade === b.xfade && a.frame === b.frame && a.vs === b.vs;

  /* a mass selection's highlight lives on the GPU (selTint). The remainder
     bitmap does not carry it — so a select-all or an 800-id set must not
     restroke 5,000 texts. Small selections bake a glow into the bitmap
     and still take the old path. */
  /* the highlight is IN the remainder bitmap whenever the 2D pass drew it:
     up to SEL_STYLE_LIMIT always, and past it whenever the GPU tint stood
     down (too many covered entities it does not own — see selTintNow) and
     the per-entity accent strokes ran instead */
  const selBakedInScene = (n, tintOn) => n > 0 && (n <= SEL_STYLE_LIMIT || !tintOn);
  const sameSigIgnoreSel = (a, b) => !!a && !!b && a.glg === b.glg &&
    a.rev === b.rev && a.doc === b.doc && a.ents === b.ents && a.n === b.n &&
    a.lsig === b.lsig && a.tsig === b.tsig &&
    a.scale === b.scale && a.tx === b.tx && a.ty === b.ty && a.tw === b.tw &&
    a.v3a === b.v3a && a.vaz === b.vaz && a.vel === b.vel &&
    a.vpp === b.vpp && a.vpd === b.vpd && a.vro === b.vro && a.g3 === b.g3 &&
    a.w === b.w && a.h === b.h && a.dpr === b.dpr &&
    a.grid === b.grid && a.gridSize === b.gridSize && a.gbl === b.gbl && a.lwt === b.lwt &&
    a.ux === b.ux && a.uy === b.uy &&
    a.pdmode === b.pdmode && a.pdsize === b.pdsize &&
    a.poche === b.poche && a.hoverBaked === b.hoverBaked &&
    a.xfade === b.xfade && a.frame === b.frame && a.vs === b.vs;

  /* everything but the viewport: when ONLY scale/tx/ty moved, the cached
     scene bitmap is still the truth — just somewhere else on screen */
  const sameSigContent = (a, b) => !!a && !!b && a.tw === b.tw &&
    a.rev === b.rev && a.doc === b.doc && a.ents === b.ents && a.n === b.n &&
    a.lsig === b.lsig && a.tsig === b.tsig && a.sel === b.sel && a.selN === b.selN &&
    a.v3a === b.v3a && a.vaz === b.vaz && a.vel === b.vel &&
    a.vpp === b.vpp && a.vpd === b.vpd && a.vro === b.vro && a.g3 === b.g3 &&
    a.w === b.w && a.h === b.h && a.dpr === b.dpr &&
    a.grid === b.grid && a.gridSize === b.gridSize && a.gbl === b.gbl && a.lwt === b.lwt &&
    a.ux === b.ux && a.uy === b.uy &&
    a.pdmode === b.pdmode && a.pdsize === b.pdsize &&
    a.poche === b.poche && a.hoverBaked === b.hoverBaked &&
    a.xfade === b.xfade && a.frame === b.frame && a.vs === b.vs;

  /* one entity in its hovered styling. Lives on the overlay (see
     renderOverlay): baking it into the scene made every hover change a
     full GL compose + remainder blit, and a library insert expanded every
     child on the 2D canvas. The overlay caches the stroke per id+view. */
  const drawHoverEntity = (c2d, doc, ent) => {
    const ly = layerMap(doc).get(ent.layerId);
    if (!layerVisible(ly)) return;
    const color = brighten(Nasj.docOps.resolveColor(doc, ent), 1.5);
    let width = 1.8;
    if (Nasj.settings.lwt) {
      width = Math.max(width, Nasj.docOps.resolveLw(doc, ent) * 2.2);
    }
    let near = null;
    if (ent.type === 'insert' && !view3d.active && Nasj.geom.insertLocalBox) {
      const b = viewWorldBounds();
      const pad = 8 / (vp.scale || 1);
      if (isFinite(b.minx) && isFinite(b.maxx)) {
        near = Nasj.geom.insertLocalBox(ent, {
          minx: b.minx - pad, miny: b.miny - pad,
          maxx: b.maxx + pad, maxy: b.maxy + pad
        }, doc);
      }
    }
    strokeEntity(c2d, ent, color, width, null, lockedAlpha(ly), true, false, near);
    const sel = Nasj.selection instanceof Set ? Nasj.selection : null;
    if (sel && sel.has(ent.id)) {
      strokeEntity(c2d, ent, COL.accentBright, 1.4, [5, 4], 1, false, false, near);
    }
  };

  /* full scene pass (the pre-cache Nasj.render body, drawing into c2d) */
  /* the margin rendered around the viewport, each side, as a fraction —
     it is what a zoom-out or a pan reveals BEFORE the crisp settle, so the
     interactive frames show drawing instead of void */
  const SCENE_PAD = 0.35;
  /* 2D only: the 3D projection routes through its own transform, and
     borrowing tx/ty there shifts the scene against its crop */
  /* quantised to WHOLE DEVICE PIXELS: a fractional pad puts the crop
     origin between device rows, drawImage resamples the whole blit, and
     the bottom scanline flickers ±1 between otherwise identical frames */
  const scenePadX = () => view3d.active ? 0 : Math.ceil(cssW * SCENE_PAD * dpr) / dpr;
  const scenePadY = () => view3d.active ? 0 : Math.ceil(cssH * SCENE_PAD * dpr) / dpr;

  /* every visible entity in its scene styling, through whatever transform vp
     is holding — the cached scene pass draws through this, and so does each
     tile of a split model space */
  /* glyph budget for a full pass (see GREEK_BUDGET above) — hoisted so an
     incremental scene build computes it once, not once per chunk */
  /* the cutoff is CONTINUOUS across settles: a raise lands at once (the
     budget is a freeze guard), but it comes DOWN only ~20% per settle and
     only while the view is well under budget — adjacent views otherwise
     flip thousands of texts between bar and glyph in one step, and near
     the budget the raw recompute oscillates */
  let greekPrev = GREEK_PX;
  const computeGreekCutoff = (doc, ents) => {
    if (view3d.active) return GREEK_PX;
    const view = viewWorldBounds();
    const pad = 4 / vp.scale;
    const pxs = [];
    const list = ents || doc.entities;
    for (const ent of list) {
      if (ent.type !== 'text') continue;
      const tpx = (ent.h || 5) * vp.scale;
      if (tpx < GREEK_PX) continue;
      const b = boundsOf(ent);
      if (b.maxx < view.minx - pad || b.minx > view.maxx + pad ||
          b.maxy < view.miny - pad || b.miny > view.maxy + pad) continue;
      pxs.push(tpx);
    }
    let want = GREEK_PX;
    if (pxs.length > GREEK_BUDGET) {
      pxs.sort((a, b) => b - a);
      want = Math.max(GREEK_PX, pxs[GREEK_BUDGET]);
    } else if (pxs.length > GREEK_BUDGET * 0.7) {
      want = greekPrev;
    }
    greekPrev = want >= greekPrev ? want : Math.max(want, greekPrev / 1.2);
    return greekPrev;
  };

  /* top-level LOD threshold: a whole entity under this many screen px is
     drawn as its centre dot (heavy drawings, scene passes only) */
  const DOT_PX = 1.5;

  /* SUB-PIXEL COVERAGE (the same rule the GL layer applies to its strokes).
     A dot stands in for something too small to draw, so it must carry that
     thing's INK and no more: the ramp is proportional to the entity's screen
     size and it runs all the way to zero. The old 8-step ramp had a floor —
     every entity, however small, got an eighth of full ink — and a drawing
     whose solids contribute twenty thousand edges that project to a point
     (the vertical edges of an extruded plate, seen from the top) came out
     speckled where the industry standard is blank. Below DOT_MIN_PX there is no ink at
     all; the steps are fine enough that 0.5..1.5px still reads exactly as
     it did (that is where dots earn their keep in a block library). */
  const DOT_STEPS = 32;
  const DOT_MIN_PX = 0.05;
  const INS_DOT_PX = 0.8;                /* the same threshold, inside a block */
  /* t = size / that path's own dot threshold; spx = the size in screen px.
     Returns the alpha bucket, or -1 for "not ink". */
  const dotBucket = (t, spx) => (spx > DOT_MIN_PX
    ? Math.max(0, Math.min(DOT_STEPS - 1,
      Math.round(Math.min(1, t) * DOT_STEPS) - 1))
    : -1);

  /* the shaded 3D draw order, kept until the drawing or the camera turns */
  let depthSortCache = { rev: -1, ents: null, n: -1, az: 0, el: 0, src: null, list: null };

  /* WHAT THE GL LAYER LEFT, AS A LIST. Both GPU layers answer ownership
     twice over: owner(), the predicate a walk tests every entity against,
     and remainder(), the same answer already turned into the ordered list
     of everything the predicate says no to. A full model pass walks the
     list — on a quarter-million-entity block library that is five thousand
     entities instead of two hundred and forty-one thousand, and the
     difference IS the pass. null means "no list this frame" (the path is
     off, the scene is not live, the view is paper or 3D): the caller
     walks the document, exactly as it always did. */
  const glOwnerNow = () => (gl3dLive() ? Nasj.gl3d.owner()
    : (Nasj.glscene && !view3d.active && !Nasj.paper)
      ? Nasj.glscene.owner() : null);
  const glRestNow = () => (gl3dLive() ? Nasj.gl3d.remainder()
    : (Nasj.glscene && !view3d.active && !Nasj.paper &&
       Nasj.glscene.remainder) ? Nasj.glscene.remainder() : null);
  /* ---- A MASS SELECTION'S HIGHLIGHT BELONGS ON THE GPU ----------------
   * Up to SEL_STYLE_LIMIT objects the 2D layer draws the industry standard's full
   * selection styling — a wide soft glow under, the entity, bright dashes
   * over — and none of that changes. Past it the highlight became one
   * accent stroke per entity, still drawn here: 2,900ms for a quarter of a
   * million (measured on BLOCKS.dwg), spread over eighty-odd frames, during
   * every one of which the drawing stood on screen in its ordinary colours
   * with nothing to show that anything was selected. That is the "they do
   * not turn blue until I start MOVE" report, exactly.
   * The GPU is already holding that geometry, and the marquee preview
   * already taught it to draw the scene in another colour (glscene's
   * uHl/uHlC). So it draws it again, once, scissored to the selection's own
   * box — a cost in PIXELS, not in entities, at any count.
   * A box is not a selection, though. What saves the arithmetic is that the
   * entities inside the box which are NOT selected are few whenever a mass
   * selection was made at all (a marquee takes everything it covers), and
   * those few are handed back to the 2D pass to be redrawn in their own
   * colours over the tint — so what is blue is exactly what is selected.
   * Past SEL_TINT_EXC_MAX of them the tint stands down and the old
   * single-stroke path runs, unchanged. */
  let selTintCache = { sel: null, rev: -1, glg: -1, on: false, box: null, exc: null };
  const selTintNow = () => {
    const doc = Nasj.doc;
    const sel = Nasj.selection instanceof Set ? Nasj.selection : null;
    if (!doc || !sel || sel.size <= SEL_STYLE_LIMIT) return null;
    if (view3d.active || Nasj.paper || tiled()) return null;
    if (!(Nasj.glscene && Nasj.glscene.live() && Nasj.glscene.setSelTint)) return null;
    const c = selTintCache;
    if (c.sel === sel && c.rev === docRev && c.glg === glOwnGen) return c.on ? c : null;
    c.sel = sel; c.rev = docRev; c.glg = glOwnGen; c.on = false; c.box = null; c.exc = null;
    const glOwn = Nasj.glscene.owner();
    if (!glOwn) return null;
    /* the mass-selection fast path: when the set covers all but a handful
       of what GL draws (select-all and its edits), the scene answers from
       its own records and item boxes — no 241k-entity bounds walk, which
       used to cost 130-250ms per docRev bump while a huge selection stood */
    if (typeof Nasj.glscene.selCover === 'function') {
      const fast = Nasj.glscene.selCover(sel, SEL_TINT_EXC_MAX);
      if (fast && fast.box) {
        if (fast.owned <= SEL_STYLE_LIMIT) return null;
        if (fast.exc && fast.exc.length > SEL_TINT_EXC_MAX) return null;
        c.on = true;
        c.box = fast.box;
        c.exc = fast.exc;
        return c;
      }
    }
    const lmap = layerMap(doc);
    /* the box the GPU-drawn part of the selection occupies — walk the
       SELECTION, not the document: 800 of 241k used to pay a full scan */
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    let nOwned = 0;
    for (const id of sel) {
      const ent = Nasj.docOps.entityById(doc, id);
      if (!ent || !glOwn(ent)) continue;
      if (hiddenIds.has(ent.id) || !layerVisible(lmap.get(ent.layerId))) continue;
      const b = boundsOf(ent);
      if (!b || !isFinite(b.minx)) continue;
      nOwned++;
      if (b.minx < minx) minx = b.minx;
      if (b.miny < miny) miny = b.miny;
      if (b.maxx > maxx) maxx = b.maxx;
      if (b.maxy > maxy) maxy = b.maxy;
    }
    if (nOwned <= SEL_STYLE_LIMIT || !isFinite(minx)) return null;
    /* everything the tinted pass would colour that is not selected. A box
       holding most of the drawing is not worth an index query — building
       and sorting its answer costs more than the walk it saves (35ms of a
       241k-entity release, measured) */
    const q = nOwned * 2 > doc.entities.length
      ? null : queryIndexRect(doc, minx, miny, maxx, maxy);
    const exc = [];
    for (const ent of (q || doc.entities)) {
      if (sel.has(ent.id) || hiddenIds.has(ent.id)) continue;
      if (!layerVisible(lmap.get(ent.layerId)) || !glOwn(ent)) continue;
      const b = boundsOf(ent);
      if (!b || b.maxx < minx || b.minx > maxx || b.maxy < miny || b.miny > maxy) continue;
      exc.push(ent);
      if (exc.length > SEL_TINT_EXC_MAX) return null;
    }
    c.on = true;
    c.box = { minx, miny, maxx, maxy };
    c.exc = exc;
    return c;
  };
  /* the tint's scissor box in css px — the engine hands it over on every
     frame it drives, so a pan or a zoom carries the highlight with it */
  const glSelTintPush = () => {
    if (!(Nasj.glscene && Nasj.glscene.setSelTint)) return;
    const t = selTintNow();
    if (!t) { Nasj.glscene.setSelTint(null); return; }
    const b = t.box;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [wx, wy] of [[b.minx, b.miny], [b.maxx, b.miny],
      [b.maxx, b.maxy], [b.minx, b.maxy]]) {
      const s = vp.worldToScreen({ x: wx, y: wy });
      if (s.x < x0) x0 = s.x;
      if (s.y < y0) y0 = s.y;
      if (s.x > x1) x1 = s.x;
      if (s.y > y1) y1 = s.y;
    }
    /* a hairline's width, so a stroke on the very edge is not half-tinted */
    const pad = 2;
    Nasj.glscene.setSelTint({ x: x0 - pad, y: y0 - pad,
      w: (x1 - x0) + 2 * pad, h: (y1 - y0) + 2 * pad,
      color: COL.accentBright, mix: 1 });
  };

  /* the remainder PLUS the selection and the hover — their highlight is
     drawn on this layer whoever owns the geometry underneath */
  const glRestList = (doc, hoverBakedId, glOwn, rest) => {
    if (!rest || !glOwn) return null;
    const sel = Nasj.selection instanceof Set ? Nasj.selection : null;
    const extra = [];
    if (sel && sel.size && sel.size <= SEL_STYLE_LIMIT) {
      for (const id of sel) { const e = Nasj.docOps.entityById(doc, id); if (e && glOwn(e)) extra.push(e); }
    }
    if (hoverBakedId != null) {
      const e = Nasj.docOps.entityById(doc, hoverBakedId);
      if (e && glOwn(e) && !(sel && sel.has(e.id))) extra.push(e);
    }
    /* the GPU has the highlight: the 2D pass owes only the few entities the
       tinted box covers that are not in the selection */
    const t = sel && sel.size > SEL_STYLE_LIMIT ? selTintNow() : null;
    if (t) {
      for (const e of t.exc) {
        if (hoverBakedId == null || hoverBakedId !== e.id) extra.push(e);
      }
    }
    if (extra.length) return rest.concat(extra);
    if (sel && sel.size > SEL_STYLE_LIMIT && !t) return null;   /* a huge selection: the full walk */
    return rest;
  };

  const drawEntities = (c2d, doc, hoverBakedId, from, to, cutoff, deadline, listIn) => {
    resetFontCache();   /* previous chrome passes may have moved c2d.font */
    const lmap = layerMap(doc);
    const sel = Nasj.selection instanceof Set ? Nasj.selection : null;
    const view = viewWorldBounds();
    const pad = 4 / vp.scale; /* small world-space slack for hairline widths */

    /* glscene phase 2: the GL layer owns some strokes, and the model scene
       passes skip exactly those — hit-testing, snapping, bounds and the
       selection/hover styling keep the full set, and paper, plot and
       previews never skip (owner() is null off the live model path). A
       split model space composes the GL frame per tile, so it skips too. */
    const g3 = gl3dLive();
    const glOwn = g3 ? Nasj.gl3d.owner()
      : (Nasj.glscene && !view3d.active && !Nasj.paper) ? Nasj.glscene.owner() : null;
    /* the GPU is drawing this selection's highlight: its entities are not
       this pass's business at all, selected or not (see selTintNow) */
    const selTintC = g3 ? null : selTintNow();
    const selTint = !!selTintC;
    /* except the ones the tint covers but does NOT own: they are in this
       list precisely so they can be redrawn in their own colours over it */
    let selExc = null;
    if (selTintC) {
      if (selTintC.excSetFor !== selTintC.exc) {
        selTintC.excSet = new Set((selTintC.exc || []).map((e) => e.id));
        selTintC.excSetFor = selTintC.exc;
      }
      selExc = selTintC.excSet;
    }
    /* with the GPU drawing the geometry, this pass walks only what it left.
       A CHUNKED (job) pass is handed the list its caller resolved once and
       slices that; a full pass resolves its own. The list is a shortcut,
       never a licence: glOwn still guards every entity in the loop below,
       so a list that has gone stale can only cost work, never ink. */
    const list3 = listIn ||
      ((from == null && to == null)
        ? glRestList(doc, hoverBakedId, glOwn, glRestNow()) : null);

    /* a FULL pass over a heavy drawing at a tight view culls through the
       spatial index instead of testing every entity's bounds — a detail
       view of a quarter-million entities walks hundreds, which is what
       lets those views render crisp EVERY frame. Chunked (job) passes
       keep the plain range walk: they exist for the views where the index
       would return nearly everything anyway. */
    let list = list3 || doc.entities;
    if (from == null && to == null && !view3d.active &&
        list.length > SCENE_ASYNC_N) {
      const q = queryIndexRect(doc, view.minx - pad, view.miny - pad,
        view.maxx + pad, view.maxy + pad);
      if (q && q.length < list.length / 2) list = q;
    }
    /* SHADED 3D: solid faces only hide what is behind them if what is
       behind is painted first, so the whole list goes far-to-near. The key
       is the entity's centre along the view axis, which is exact for a flat
       face and near enough for the rest — the industry standard sorts per face too, and
       the same limits show at a face that pierces another. Sorting a copy
       leaves the document's own order alone. */
    if (shaded3d() && !g3 && from == null && to == null) {
      /* THE SHADED PASS on the CPU — the fallback where the GPU layer is
         not drawing — is drawn face by face, not entity by entity. Every
         body is taken apart into its planar faces, a face turned away from
         the eye is dropped — the back of a closed body is never seen,
         except through X-Ray, which keeps it — and
         what is left is painted far-to-near together with the lines, each
         face by the depth of its own centre. That is what lets a roof sit
         on a box and a wall stand in front of a column: the old sort put a
         whole entity at one depth, and a box had no faces at all.
         CACHED per document revision and camera: sorting a heavy drawing
         on every frame — every pan, every hover — is what made a big
         shaded model unusable. A drawing with no faces at all has nothing
         to hide behind anything, and skips the sort outright. */
      const dc = depthSortCache;
      const cam = camSig();
      if (dc.rev === docRev && dc.ents === doc.entities && dc.n === list.length &&
          dc.cam === cam && dc.src === list) {
        list = dc.list;
      } else {
        const src = list;
        const hasFaces = bodyItemsOf(doc, list).length > 0;
        if (hasFaces) {
          const items = [], key = new Map();
          const depthOf = (pts) => {
            let x = 0, y = 0, z = 0, k = 0;
            for (const q of pts) {
              x += q.x; y += q.y; z += (typeof q.z === 'number' && isFinite(q.z)) ? q.z : 0; k++;
            }
            return worldToDepth3({ x: x / k, y: y / k, z: z / k });
          };
          /* the faces, taken apart once per revision; here only culled and keyed */
          for (const it of bodyItemsOf(doc, list)) {
            if (it.face && !xray() && !faceVisible(it.face)) continue;
            items.push(it);
            key.set(it, depthOf(it.face ? it.face.pts : it.wire));
          }
          for (const ent of list) {
            if (ent.type === 'face3d' || Nasj.solid.isBody(ent)) continue;
            const b = boundsOf(ent), zr = zRangeOf(ent);
            items.push(ent);
            key.set(ent, worldToDepth3({ x: (b.minx + b.maxx) / 2, y: (b.miny + b.maxy) / 2, z: (zr[0] + zr[1]) / 2 }));
          }
          list = items.sort((a, b) => key.get(b) - key.get(a));
        }
        depthSortCache = { rev: docRev, ents: doc.entities, n: src.length, cam, src, list };
      }
    }
    /* a culled list is small, so budgeting over it is cheap — and it keeps
       the cutoff continuous across the cull boundary instead of snapping
       every bar in view back to glyphs the moment the index kicks in */
    greekCutoff = cutoff != null ? cutoff : computeGreekCutoff(doc, list);

    /* TOP-LEVEL LOD (heavy drawings only): an entity whose whole box is
       under DOT_PX on screen is its centre dot — the same argument, the
       same alpha buckets, as the insert-internal dots — batched per
       resolved colour and filled once per chunk. Selected and hovered
       entities keep their strokes; point and light glyphs draw at a fixed
       screen size whatever their bounds, and a construction line's bounds
       are just its base point, so those are never dotted. */
    const dotting = doc.entities.length > SCENE_ASYNC_N;
    if (dotting && !view3d.active) insTilesSync(doc);
    let dotBk = null;
    const flushDots = () => {
      if (!dotBk) return;
      for (const [col, bk] of dotBk) {
        c2d.fillStyle = col;
        for (let bi = 0; bi < DOT_STEPS; bi++) {
          if (!bk[bi]) continue;
          c2d.globalAlpha = (bi + 1) / DOT_STEPS;
          c2d.fill(bk[bi]);
        }
      }
      c2d.globalAlpha = 1;
      dotBk = null;
    };

    const z = to == null ? list.length : Math.min(to, list.length);
    for (let idx = from | 0; idx < z; idx++) {
      const item = list[idx];
      const ent = (item.face || item.wire) ? item.ent : item;
      const ly = lmap.get(ent.layerId);
      if (!layerVisible(ly) || hiddenIds.has(ent.id)) continue;
      const body = item !== ent;   /* a face or a wire, in the shaded pass */

      /* the GL layer draws this one; the 2D pass keeps only its selection
         styling (drawn over the composited GL frame) and the hover bake */
      if (!body && glOwn && glOwn(ent) &&
          (selTint ? !(selExc && selExc.has(ent.id)) : !(sel && sel.has(ent.id))) &&
          !(hoverBakedId != null && hoverBakedId === ent.id)) continue;

      /* chunked (job) passes hand in a deadline: one entity can be a whole
         block definition, so only a check INSIDE the walk bounds a step at
         one entity's cost instead of a chunk's. Returns where it stopped.
         It sits BELOW the three skips above, not over them, because a
         skipped entity costs nothing to skip — reading the clock for one
         was 20.7ms of a 120ms pass on a quarter-million entities, and the
         guarantee it buys ("a step is one entity's work") is untouched:
         nothing has been drawn yet when it fires. */
      if (deadline && performance.now() > deadline) { flushDots(); return idx; }

      if (body) { /* one face, or one wire, of a body in the shaded pass */
        const hov = hoverBakedId != null && hoverBakedId === ent.id;
        let col = item.col || Nasj.docOps.resolveColor(doc, ent);
        if (hov) col = brighten(col, 1.5);
        const selF = sel && sel.has(ent.id);
        if (item.face) drawFace(c2d, item.face, col, lockedAlpha(ly), selF, hov);
        else strokeRun(c2d, item.wire, false, selF ? COL.accentBright : col, hov ? 1.8 : 1.4, lockedAlpha(ly), selF ? [5, 4] : null);
        continue;
      }

      /* early bounds rejection against the viewport: in plan against the
         world box, in 3D against the box the entity's heights project to */
      let dotSz = -1, dotCx = 0, dotCy = 0;
      if (view3d.active) {
        /* A 3D VIEW CULLS TOO. The entity's box — its plan bounds and its
           heights — projects to a box on screen; one that falls outside
           the canvas is not drawn, a block reference under a few pixels is
           its box, and an entity under a pixel and a half is its dot. The
           same three rules the plan view lives by, measured after the
           projection instead of before it: without them a 3D view of a
           heavy drawing drew every entity of it on every frame. */
        const sb = screenBox3(ent);
        if (sb.maxx < -pad3 || sb.minx > cssW + pad3 || sb.maxy < -pad3 || sb.miny > cssH + pad3) continue;
        const spn = Math.max(sb.maxx - sb.minx, sb.maxy - sb.miny);
        if (ent.type === 'insert' && spn < 3) {
          c2d.fillStyle = Nasj.docOps.resolveColor(doc, ent);
          c2d.globalAlpha = lockedAlpha(ly) * 0.45;
          c2d.fillRect(sb.minx - 0.5, sb.miny - 0.5, Math.max(1, sb.maxx - sb.minx), Math.max(1, sb.maxy - sb.miny));
          c2d.globalAlpha = 1;
          continue;
        }
        if (dotting && ent.type !== 'point' && ent.type !== 'light' &&
            ent.type !== 'xline' && spn < DOT_PX) {
          const b = boundsOf(ent);
          dotSz = spn;
          dotCx = (b.minx + b.maxx) / 2;
          dotCy = (b.miny + b.maxy) / 2;
        }
      } else {
        const b = boundsOf(ent);
        if (b.maxx < view.minx - pad || b.minx > view.maxx + pad ||
            b.maxy < view.miny - pad || b.miny > view.maxy + pad) continue;
        /* a whole block reference under a few pixels IS its box: draw the
           box (the industry standard's greeking) and skip materializing its children */
        if (ent.type === 'insert' &&
            (b.maxx - b.minx) * vp.scale < 3 && (b.maxy - b.miny) * vp.scale < 3) {
          const s0 = vp.worldToScreen({ x: b.minx, y: b.miny });
          const s1 = vp.worldToScreen({ x: b.maxx, y: b.maxy });
          c2d.fillStyle = Nasj.docOps.resolveColor(doc, ent);
          /* translucent, not solid: just past the threshold the real block
             is a sparse hairline sketch, and an opaque slab taking over
             from it steps the luminance both ways */
          c2d.globalAlpha = lockedAlpha(ly) * 0.45;
          c2d.fillRect(Math.min(s0.x, s1.x) - 0.5, Math.min(s0.y, s1.y) - 0.5,
            Math.max(1, Math.abs(s1.x - s0.x)), Math.max(1, Math.abs(s1.y - s0.y)));
          c2d.globalAlpha = 1;
          continue;
        }
        if (dotting && ent.type !== 'point' && ent.type !== 'light' &&
            ent.type !== 'xline') {
          const spn = Math.max(b.maxx - b.minx, b.maxy - b.miny) * vp.scale;
          if (spn < DOT_PX) {
            dotSz = spn;
            dotCx = (b.minx + b.maxx) / 2;
            dotCy = (b.miny + b.maxy) / 2;
          }
        }
      }

      let color = Nasj.docOps.resolveColor(doc, ent);
      const hovered = hoverBakedId != null && hoverBakedId === ent.id;
      if (hovered) color = brighten(color, 1.5);
      const alpha = lockedAlpha(ly);
      const selected = sel && sel.has(ent.id);

      if (dotSz >= 0 && !selected && !hovered && alpha === 1 && !(ent.transp > 0)) {
        const bi = dotBucket(dotSz / DOT_PX, dotSz);
        if (bi >= 0) {
          const sd = vp.worldToScreen({ x: dotCx, y: dotCy });
          if (!dotBk) dotBk = new Map();
          let bk = dotBk.get(color);
          if (!bk) dotBk.set(color, bk = []);
          (bk[bi] || (bk[bi] = new Path2D())).rect(sd.x - 0.5, sd.y - 0.5, 1, 1);
        }
        continue;
      }

      /* SPEC3 §23: with LWT on, stroke width = max(1.4, lw*2.2) px */
      let width = hovered ? 1.8 : 1.4;
      if (Nasj.settings.lwt) {
        width = Math.max(width, Nasj.docOps.resolveLw(doc, ent) * 2.2);
      }

      /* BIG SELECTIONS DROP THE JEWELLERY. The two-pass treatment —
         entity, bright dash on top — costs 400ms+ at ten thousand (the
         dashed pass above all). Past the limit a selected entity draws ONCE, in
         the bright accent: still unmistakably selected, an order of
         magnitude cheaper, and the same instinct as the grip cap. */
      const liteSel = selected && sel.size > SEL_STYLE_LIMIT;
      if (liteSel) {
        if (ent.type === 'hatch') {
          /* a hatch drawn once in the accent is a patch of blue light — the
             fill goes whole. It keeps its own fill and wears the dashed
             boundary instead, as the small-selection styling does. */
          strokeEntity(c2d, ent, color, width, null, alpha, true, false);
          strokeEntity(c2d, ent, COL.accentBright, 1, [5, 4], 1);
        } else strokeEntity(c2d, ent, COL.accentBright, width, null, alpha, true);
        continue;
      }
      /* with the GPU drawing the geometry, a selected entity it owns is
         already on screen, depth and all: only the dashed accent goes over
         it — a second white stroke would show through every face */
      if (selected && g3 && glOwn(ent) && !hovered) {
        strokeEntity(c2d, ent, COL.accentBright, 1.4, [5, 4], 1);
        continue;
      }
      /* NO HALO. The wide translucent stroke under a selected entity read
         as a blue light thrown over its NEIGHBOURS wherever the drawing is
         dense — six pixels reach well past a hairline at plan scale, and a
         stadium plan is nothing but neighbours. The bright dashed stroke
         below says selected on its own, which is what the industry standard says with. */

      strokeEntity(c2d, ent, color, width, null, alpha, true, !selected && !hovered);
      if (selected) {
        /* dashed bright stroke on top */
        strokeEntity(c2d, ent, COL.accentBright, 1.4, [5, 4], 1);
      }
    }
    flushDots();
    return z;
  };

  const renderSceneInto = (c2d, hoverBakedId) => {
    pocheMode = !!Nasj.settings.poche;
    const padW = scenePadX(), padH = scenePadY();
    const sw = cssW + 2 * padW, sh = cssH + 2 * padH;
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    c2d.clearRect(0, 0, sw, sh);          /* transparent: bg+grid live below */

    const doc = Nasj.doc;
    if (!doc) return;

    /* the whole engine projects through vp and the css dims; borrowing them
       for the duration of this ONE call renders the padded frame with every
       existing path untouched, culling included */
    const keep = { tx: vp.tx, ty: vp.ty, w: cssW, h: cssH };
    vp.tx += padW; vp.ty += padH;
    cssW = sw; cssH = sh;
    try {
      drawEntities(c2d, doc, hoverBakedId);
    } finally {
      vp.tx = keep.tx; vp.ty = keep.ty;
      cssW = keep.w; cssH = keep.h;
    }
  };

  let crispTimer = 0;          /* the settle re-render after a zoom/pan  */
  let crispPending2 = false;   /* the settle call must not blit again    */
  let painted = null;          /* {sig, hoverId, crisp} now on screen    */

  /* the interactive blit: the cached scene through the viewport delta.
     A pure pan (k===1) is 1:1 — snapped to whole DEVICE pixels with
     smoothing off, because a fractional offset resamples the whole scene
     half a pixel soft while the pixel-snapped grid above stays sharp,
     and that mismatch is what reads as blur */
  const blitScene = (k, sig) => {
    let offX = sig.tx - k * sceneState.tx;
    let offY = cssH * (1 - k) + k * sceneState.ty - sig.ty;
    const padW = scenePadX(), padH = scenePadY();
    const pan = k === 1;
    if (pan) {
      offX = Math.round(offX * dpr) / dpr;
      offY = Math.round(offY * dpr) / dpr;
    }
    ctx.imageSmoothingEnabled = !pan;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sceneCanvas,
      offX - padW * k, offY - padH * k,
      (cssW + 2 * padW) * k, (cssH + 2 * padH) * k);
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /* glscene phase 2: the GL frame lands INTO the 2D canvas, under the scene
     bitmap and over bg+grid — one picture, so getImageData, the QA suites
     and window captures all read the same thing. GL re-renders TRUE
     geometry at the live viewport every call (the blit above only ever
     stretches the 2D-owned remainder: text and friends). */
  const glCompose = (gesture) => {
    /* the 3D view: the GPU frame — faces and lines with a depth buffer —
       lands under the 2D remainder the same way */
    if (view3d.active) {
      if (gl3dLive()) Nasj.gl3d.compose(ctx, cssW, cssH, dpr);
      return;
    }
    if (Nasj.glscene && Nasj.glscene.live()) Nasj.glscene.compose(ctx, gesture);
  };
  /* WHERE A GESTURE FRAME LANDS. At tier A the GL frame is composed INTO
     the 2D canvas — one picture, true geometry, every frame (see compose()
     in glscene.js). Below tier A it presents through the GL DOM canvas, as
     phase 3 built it: that is the weak-device path, held frames and all,
     and nothing here changes it. */
  const glDomPresent = () => !!(Nasj.glscene && Nasj.glscene.live() &&
    Nasj.glscene.presentLive && Nasj.glscene.weakTier && Nasj.glscene.weakTier());
  /* is the 3D GPU layer drawing this view? */
  const gl3dLive = () => !!(view3d.active && !Nasj.paper && !tiled() &&
    Nasj.gl3d && Nasj.gl3d.live());
  /* glscene phase 3: what the GL layer needs to draw the 2D-owned
     remainder (the scene bitmap) as a textured quad on gesture frames —
     the capture-time transform of the bitmap, and a generation so the
     texture uploads only when the bitmap's content actually changed */
  /* the drag ghost's unified 2D source (see glscene dragBegin): the same
     snapshot the gesture frames present, handed out on demand so a
     whole-selection drag can BLIT the settled remainder through the drag
     affine instead of re-stroking content that is already a picture */
  Nasj.remainderSnap = (ok) => glRemainder(ok);
  const glRemainder = (ok) => ({
    ok: !!(ok && sceneState && sceneCanvas),
    /* phase 4: even when ok is false (content moved), the bitmap plus its
       capture transform is still the LAST-GOOD remainder — presenting it
       beats presenting nothing (the −59% first-gesture flash) */
    st: !!(sceneState && sceneCanvas && sceneState.doc === Nasj.doc),
    canvas: sceneCanvas, gen: sceneGen,
    scale: sceneState ? sceneState.scale : 1,
    tx: sceneState ? sceneState.tx : 0,
    ty: sceneState ? sceneState.ty : 0,
    tw: sceneState ? sceneState.tw : 0,
    w: sceneState ? sceneState.w : cssW,
    h: sceneState ? sceneState.h : cssH,
    padX: scenePadX(), padY: scenePadY()
  });
  /* THE PICTURE UNDER THE GHOST. A transform drag begun right after a
     zoom/pan finds the 2D canvas holding a gesture leftover — bg+grid
     below tier A (the frames lived on the GL DOM canvas, which the ghost
     is about to take), a centre-only blit at tier A — so the un-moved
     source "fills in" mid-drag when the crisp lands, and the eye reads
     the ghost as building progressively. One settled-shape composite at
     drag start: bg + grid + the GL frame + the LAST settled remainder
     blitted through the view delta. No restroke, complete from frame 1,
     merely softer until the crisp swaps in over it. */
  Nasj.dragUnderlay = () => {
    if (!ctx || Nasj.paper || tiled() || view3d.active) return false;
    const doc = Nasj.doc;
    if (!doc) return false;
    const sig = sceneSig(doc);
    if (painted && painted.sig && sameSig(painted.sig, sig) &&
        (painted.crisp || painted.under)) return true;
    /* the last settled snapshot carries whatever view it was taken at —
       the delta blit is the same rule the commit-blank fix draws by */
    const canBlit = sceneState && sceneCanvas && sceneState.doc === doc &&
      sig.scale / sceneState.scale > 0.04 && sig.scale / sceneState.scale < 25;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, cssW, cssH);
    if (Nasj.settings.grid) drawGridCached(ctx);
    glCompose(true);
    if (canBlit) blitScene(sig.scale / sceneState.scale, sig);
    painted = { sig, hoverId: null, crisp: false, under: true };
    return true;
  };

  /* OPTIONS ▸ Colors… (and Grip Colors / Visual Effect Settings): the
     palette is live. A changed color drops every cache — the scene and
     grid signatures do not carry colors, so without this the old paint
     would outlive the choice. */
  const COL_DEFAULTS = Object.assign({}, COL);
  Nasj.uiColors = {
    keys: () => Object.keys(COL),
    get: (k) => COL[k],
    set(k, v) {
      if (!(k in COL) || typeof v !== 'string') return false;
      COL[k] = v;
      if (k === 'bg') knockoutColor = Nasj.paper ? knockoutColor : v;
      gridState = null;
      sceneState = null;
      /* the palette is not the drawing's: every PARKED bitmap was painted
         in the old colours and none of them is a picture any more */
      bmpDocs.clear();
      bmpBytes = 0;
      painted = null;
      Nasj.render();
      if (Nasj.renderOverlay) Nasj.renderOverlay();
      return true;
    },
    default: (k) => COL_DEFAULTS[k],
  };

  /* A SPLIT MODEL SPACE, DRAWN LIKE THE SINGLE ONE — CRISP, WHOLE, EVERY
   * FRAME. Each tile draws its grid, the GPU frame at its own view when the
   * GL scene is live (the whole scene, full fidelity), and the 2D strokes
   * on top: the remainder GL does not own when it is live, or every stroke
   * when it is not. There is no cached bitmap, no stretched blit, no pad, no
   * settle — so nothing is ever shown in parts and nothing pops in late.
   *
   * This is affordable because the pass is cheap: with the GPU live the 2D
   * work is a handful of hatches; without it, a real drawing still strokes
   * in a couple of milliseconds (measured 2-3ms for both tiles of a 9,620-
   * entity elevation), because drawEntities culls through the spatial index
   * to what each tile actually shows. A view heavy enough that the whole
   * drawing must stroke on the CPU is the one case this cannot make cheap —
   * and that view wants the GPU, which draws it whole at any size. */
  const tileBorders = () => {
    ctx.save();
    ctx.setLineDash([]);
    tiles.forEach((t, i) => {
      const R = tileRect(t);
      const on = i === tileActive;
      ctx.strokeStyle = on ? COL.accentBright : '#4a525c';
      ctx.lineWidth = on ? 2 : 1;
      ctx.strokeRect(R.x + 1, R.y + 1, R.w - 2, R.h - 2);
    });
    ctx.restore();
  };
  const renderTiled = () => {
    pocheMode = !!Nasj.settings.poche;
    tileSave();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, cssW, cssH);
    const doc = Nasj.doc;
    const glLive = !!(Nasj.glscene && Nasj.glscene.live());
    const sig = sceneSig(doc);
    for (const t of tiles) {
      const R = tileRect(t);
      const v = t.view;
      /* A STILL TILE IS ITS OWN EXACT PICTURE. Its last crisp frame was
         copied off the canvas at THIS view and size, so while its view and
         the drawing both stand, that copy IS the frame — one drawImage, no
         re-stroke. It is pixel-exact (same view, no pad, no stretch), so
         nothing is ever shown in parts; only the tile being moved re-draws,
         and it re-draws crisp and whole every frame. */
      const cp = t.crisp;
      if (cp && cp.w === R.w && cp.h === R.h && cp.dpr === dpr && cp.gl === glLive &&
          cp.view.scale === v.scale && cp.view.tx === v.tx && cp.view.ty === v.ty &&
          sameSigContent(cp.sig, sig)) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(cp.cv, Math.round(R.x * dpr), Math.round(R.y * dpr));
        ctx.restore();
        continue;
      }
      ctx.save();
      clipToRect(ctx, R);
      if (Nasj.settings.grid) withView(v, () => drawGrid(ctx));
      if (glLive) withView(v, () => glCompose(false));
      withView(v, () => { if (doc) drawEntities(ctx, doc, null); });
      ctx.restore();
      /* keep this crisp frame for the passes the tile holds still */
      if (!t.crisp) t.crisp = { cv: document.createElement('canvas') };
      const q = t.crisp;
      const bw = Math.max(1, Math.round(R.w * dpr)), bh = Math.max(1, Math.round(R.h * dpr));
      if (q.cv.width !== bw || q.cv.height !== bh) { q.cv.width = bw; q.cv.height = bh; }
      const qx = q.cv.getContext('2d');
      qx.setTransform(1, 0, 0, 1, 0, 0);
      qx.clearRect(0, 0, bw, bh);
      qx.drawImage(canvas, Math.round(R.x * dpr), Math.round(R.y * dpr), bw, bh, 0, 0, bw, bh);
      q.w = R.w; q.h = R.h; q.dpr = dpr; q.gl = glLive; q.sig = sig;
      q.view = { scale: v.scale, tx: v.tx, ty: v.ty };
    }
    tileBorders();
    painted = null;          /* the cached composite is not what is on screen */
    sceneState = null;
    if (Nasj.renderOverlay) Nasj.renderOverlay();
  };

  Nasj.render = () => {
    if (!ctx) return;
    /* glscene phase 2: the GL scene keeps the doc's pace BEFORE this pass
       reads its owner() — edits patch here, environment changes tear down
       (the 2D path then carries every stroke until the rebuild lands) */
    if (Nasj.glscene) Nasj.glscene.sync();
    /* and it is told what the selection wants painted blue, before any of
       the three paths below reaches for a GL frame */
    glSelTintPush();
    /* the 3D GPU layer keeps the document's pace the same way; its verdict
       is read through gl3dLive() by the pass below */
    if (Nasj.gl3d) {
      const d3 = Nasj.doc;
      if (view3d.active && d3 && !Nasj.paper && !tiled()) Nasj.gl3d.sync(d3, docRev, layersSig(d3));
      else if (Nasj.gl3d.live()) Nasj.gl3d.sync(null);
    }
    if (Nasj.paper) { renderPaper(); return; }
    if (tiled()) { renderTiled(); return; }

    const doc = Nasj.doc;
    /* the drawing on screen takes back its own bitmap (see bindBitmap) */
    if (!sceneState || sceneState.doc !== doc) bindBitmap(doc);

    if (!sceneCanvas) {
      sceneCanvas = document.createElement('canvas');
      sctx = sceneCanvas.getContext('2d');
    }
    const targetW = Math.max(1, Math.round((cssW + 2 * scenePadX()) * dpr));
    const targetH = Math.max(1, Math.round((cssH + 2 * scenePadY()) * dpr));
    if (sceneCanvas.width !== targetW || sceneCanvas.height !== targetH) {
      sceneCanvas.width = targetW;
      sceneCanvas.height = targetH;
      sceneState = null;
    }

    const sig = sceneSig(doc);
    /* hover is overlay-owned: baking it (or overdrawing it) on this
       canvas made every hover change a full compose. painted.hoverId
       stays null so a hover never invalidates a crisp frame. */

    /* ============================================================ *
     * UNDEFEATABLE ZOOM (SPEC §8 spirit). The scene cache used to die on
     * every wheel tick, because the signature includes the viewport — so
     * zooming a heavy drawing re-stroked every entity per tick. But when
     * only the viewport moved, the cached bitmap is still a perfect
     * picture of the drawing, merely somewhere else on screen: so the
     * interactive frames BLIT it through the viewport delta — one
     * drawImage, O(1) in entity count — and the crisp full render runs
     * once, ~90ms after the interaction pauses. A 100k-entity file zooms
     * exactly as fast as an empty one.
     * ============================================================ */
    /* glscene phase 4 (the drawing hang): a cycle the GL layer absorbed
       whole — every touched entity GL-owned, the common case while
       DRAWING on the GL path — leaves the 2D remainder bitmap
       byte-identical. Adopt the new revision in place instead of paying
       a remainder restroke (and a settle pop) per pencil click. The take
       is one-shot and runs every pass, so a stale verdict can never pair
       with a later, unvouched-for revision. */
    const glAbsorbed = Nasj.glscene && Nasj.glscene.absorbedTake
      ? Nasj.glscene.absorbedTake() : false;
    /* the adoption vouches for the BITMAP, so the bitmap must be current:
       a restroke in flight (or a non-crisp frame) means it is yesterday's
       — a MOVE commit's trailing bare emit lands as an absorbed 'skip'
       cycle, and adopting there stamped the pre-move remainder with the
       post-move revision. The kept selection made the signatures match,
       so the ghost stood until the next zoom (found by pixel-diff QA). */
    if (glAbsorbed && sceneState && sceneState !== sig &&
        !sceneJob && painted && painted.crisp &&
        sig.rev !== sceneState.rev && sameSigAdopt(sceneState, sig)) {
      sceneState.rev = sig.rev;
      sceneState.ents = sig.ents;
      sceneState.n = sig.n;
      /* the GL frame itself DID change (the absorbed entity lives there):
         the composite must re-run — only the remainder restroke is saved */
      painted = null;
    }

    /* mass-selection (or empty) highlight is not in the remainder bitmap —
       adopt the new Set so this pass is overlay + GPU tint, not a restroke */
    /* …unless the highlight is, or was, STROKED into that bitmap — either
       because the tint stood down, or because it owes the 2D pass the
       entities it covers but does not own. Those arrive, and they leave,
       by a restroke: adopting there is what left a picked drawing blue
       after it was let go, until the next zoom. */
    if (sceneState && painted && painted.crisp &&
        !sig.texc && !(sceneState.texc | 0) &&
        sameSigIgnoreSel(sceneState, sig) &&
        !selBakedInScene(sceneState.selN | 0, sceneState.tint) &&
        !selBakedInScene(sig.selN | 0, sig.tint)) {
      sceneState.sel = sig.sel;
      sceneState.selN = sig.selN;
    }

    /* NOTHING CHANGED, NOTHING PAINTS. Hover lives on the overlay, so it
       is not part of this signature — a hover change must not recompose. */
    if (painted && painted.crisp && sameSig(painted.sig, sig)) {
      if (Nasj.renderOverlay) Nasj.renderOverlay();
      return;
    }

    if (!sameSig(sceneState, sig)) {
      const k = sceneState ? sig.scale / sceneState.scale : 1;
      /* glscene phase 2: with GL live the crisp pass is cheap, so blitMode
         never latches — but gesture frames still want the cheap 2D blit
         (text and friends stretch for a beat) UNDER the GL layer's true
         re-render, not the heavy-path bookkeeping every tick */
      const glLive = Nasj.glscene && Nasj.glscene.live();
      /* glscene phase 3: only a HEAVY doc routes gestures through the GL
         DOM presentation (whose frames leave the 2D canvas text-less until
         the settle). A light doc's crisp pass costs a few ms — cheaper
         than any blit bookkeeping, and every frame stays QA-readable. */
      const glGesture = glLive && doc && doc.entities.length > SCENE_ASYNC_N;
      /* AND THE LATCH IS THE CPU RENDERER'S, NOT THE GPU'S. sceneMsEma is
         one module-wide number fed by whatever the last crisp passes cost —
         including the whole-document passes a heavy drawing pays before its
         GL scene exists (measured 212ms on BLOCKS). Latched once, it made
         every LIGHT drawing on the GL path blit a stretched bitmap too,
         across tabs, though its crisp pass costs a couple of ms. With GL
         live the heavy-doc test above is the whole question; the latch
         keeps its old meaning for 2D-only sessions, untouched. */
      if (!crispPending2 && (glLive ? glGesture : blitMode) &&
          sameSigContent(sceneState, sig) &&
          !view3d.active && k > 0.04 && k < 25) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = COL.bg;
        ctx.fillRect(0, 0, cssW, cssH);
        /* the grid layer follows the CURRENT viewport — a grid baked into
           the scene warps with the blit and then snaps, and that snap is
           what the eye hates */
        if (Nasj.settings.grid) drawGridCached(ctx);
        /* glscene phase 3: below tier A the gesture frame PRESENTS through
           the GL DOM canvas (true geometry + the remainder quad on top) —
           no per-notch webgl→2d drawImage sync. At tier A, and in 2D-only
           mode, the classic composite+blit: at tier A that composite is the
           GL frame itself, so the geometry is true and the 2D canvas holds
           the whole picture; only the remainder stretches. */
        if (glDomPresent()) {
          Nasj.glscene.presentLive(glRemainder(true));
        } else {
          glCompose(glLive);
          blitScene(k, sig);
        }
        /* the highlight rides ON the blit — cheap and view-correct; losing
           it here made the hover flicker out on every interactive frame */
        if (Nasj.renderOverlay) Nasj.renderOverlay();
        /* the settle timer re-arms only when the VIEW moved since the last
           blit */
        const moved = !(painted && painted.sig &&
          painted.sig.scale === sig.scale &&
          painted.sig.tx === sig.tx && painted.sig.ty === sig.ty);
        /* a scale change marks the zoom gesture live: settles wait 150ms
           (a mid-gesture settle is thrown-away work), pans keep their 50.
           THE WAIT IS ONLY WORTH WHAT IT SAVES. It is a debounce — every
           notch clears and re-arms it — so it costs the eye a flat 150ms
           after the LAST notch, and it buys not restarting a pass that,
           before the GL layer, was the whole document. With GL live the
           pass is the remainder alone and a restart loses one slice, so
           the wait shrinks to a gesture gap: still longer than any wheel
           cadence, so a sweep still coalesces to one settle. */
        const zoomed = !(painted && painted.sig && painted.sig.scale === sig.scale);
        const zoomWaitMs = glGesture ? 90 : 150;
        if (zoomed) lastZoomT = performance.now();
        painted = { sig, hoverId: null, crisp: false };
        /* a sustained PAN starts the crisp build on its first frame, not
           50ms after its last one — jobs then finish mid-gesture and the
           pad refills from fresher bitmaps. Zoom frames don't: their job
           would be obsolete next tick, and issuing a near-extents build
           under a live gesture is what saturates the GPU queue.
           glscene phase 4 (pan at display rate): with GL live the job's
           12-25ms rAF steps were what held pan to 60Hz (measured: 37 vs
           zoom's 117 renders/s) — and its refill feeds only the 2D pad,
           which GL gesture frames barely need (geometry is true
           everywhere; only text past the pad waits for the pause). The
           gesture cancels the job; the settle brings it back. */
        if (glGesture) cancelSceneJob();
        else if (doc && doc.entities.length > SCENE_ASYNC_N && k === 1 &&
            !sceneJobCovers(sig)) {
          startSceneJob(sig);
        }
        if (moved) {
          if (crispTimer) clearTimeout(crispTimer);
          crispTimer = setTimeout(() => {
            crispTimer = 0;
            crispPending2 = true;
            try { Nasj.render(); } finally { crispPending2 = false; }
          }, zoomed ? zoomWaitMs : 50);
        } else if (!crispTimer && !sceneJob) {
          /* safety: a blurred screen must always have a settle on the way */
          crispTimer = setTimeout(() => {
            crispTimer = 0;
            crispPending2 = true;
            try { Nasj.render(); } finally { crispPending2 = false; }
          }, 150);
        }
        return;
      }
      if (doc && doc.entities.length > SCENE_ASYNC_N && !view3d.active &&
          (blitMode || predictHeavyScene(doc))) {
        /* the heavy crisp pass runs as a background job; until it lands the
           screen shows the old scene blitted (view-only change), or the
           partial build growing in (content change) */
        const zoomed = !(painted && painted.sig && painted.sig.scale === sig.scale);
        if (zoomed) lastZoomT = performance.now();
        /* a job issued mid-zoom is obsolete by the next notch (and its
           near-extents strokes saturate the GPU queue): while the scale is
           still moving, view-only changes blit and leave the crisp to the
           settle timer — which every notch re-arms, so a gesture's end
           always lands one. Content changes build immediately, as before.
           The window must match the wait the blit branch armed, or the
           settle it schedules arrives while this still calls the zoom live
           and re-arms another one — a settle that can never land. */
        const glGesture2 = Nasj.glscene && Nasj.glscene.live() &&
          doc.entities.length > SCENE_ASYNC_N;
        const zoomWaitMs2 = glGesture2 ? 90 : 150;
        const zoomLive = performance.now() - lastZoomT < zoomWaitMs2;
        if (!sceneJobCovers(sig)) {
          if (!(zoomLive && sameSigContent(sceneState, sig))) startSceneJob(sig);
          else {
            if (zoomed && crispTimer) { clearTimeout(crispTimer); crispTimer = 0; }
            if (!crispTimer) {
              crispTimer = setTimeout(() => {
                crispTimer = 0;
                crispPending2 = true;
                try { Nasj.render(); } finally { crispPending2 = false; }
              }, zoomWaitMs2);
            }
          }
        }
        /* THE SCREEN ALREADY HOLDS THIS EXACT FRAME. The settle's first
           render arrives with the view unmoved since the last gesture
           frame — its only job was to start the crisp build above. With GL
           live the frame on screen is true geometry at this very viewport;
           repainting it buys nothing (principle 8) and costs a full-canvas
           composite plus a GPU frame per settle. Skipping it also makes
           the settle exactly ONE visible change: the crisp landing. */
        if ((Nasj.glscene && Nasj.glscene.live()) &&
            painted && !painted.crisp &&
            sameSig(painted.sig, sig)) {
          if (Nasj.renderOverlay) Nasj.renderOverlay();
          return;
        }
        const canBlit = sameSigContent(sceneState, sig) &&
          sig.scale / sceneState.scale > 0.04 && sig.scale / sceneState.scale < 25;
        /* glscene phase 4 (mid-load blanking): while the drawing is still
           loading, a content change (a 'load' emit as block slices land)
           used to wipe to bg+grid here and the picture blinked out until
           the restarted job's first reveal. The frame on screen stands;
           the reveals grow the new content OVER it — ink only ever adds. */
        if (!canBlit && doc && doc.loading && painted) {
          painted = { sig, hoverId: null, crisp: false };
          if (Nasj.renderOverlay) Nasj.renderOverlay();
          return;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = COL.bg;
        ctx.fillRect(0, 0, cssW, cssH);
        if (Nasj.settings.grid) drawGridCached(ctx);
        /* glscene phase 3: same presentation rule on the heavy-job frames —
           the DOM canvas below tier A, the GL frame composed into the 2D
           canvas at tier A (see glDomPresent above) */
        const glLive2 = Nasj.glscene && Nasj.glscene.live();
        if (glDomPresent()) {
          Nasj.glscene.presentLive(glRemainder(canBlit));
        } else {
          glCompose(glLive2);
          if (canBlit) blitScene(sig.scale / sceneState.scale, sig);
          else if (glLive2 && sceneState && sceneState.doc === doc &&
              sig.scale / sceneState.scale > 0.04 && sig.scale / sceneState.scale < 25) {
            /* ZERO FLASHING ON A COMMIT. Content moved, so the remainder
               bitmap is stale and the job above is restroking it — but
               with GL live the geometry on screen is already true, and
               dropping the bitmap blanked every text and wide stroke for
               the length of the restroke (caught frame-by-frame: the
               banners vanish for ~200ms on a MOVE commit and come back).
               Yesterday's words beat none — the gesture frames' own
               drawRemainder rule, applied to the settled composite. */
            blitScene(sig.scale / sceneState.scale, sig);
          }
        }
        painted = { sig, hoverId: null, crisp: false };
        if (Nasj.renderOverlay) Nasj.renderOverlay();
        return;
      }
      cancelSceneJob();     /* light doc, cheap view or 3D: crisp right here */
      const tSync = performance.now();
      renderSceneInto(sctx, sig.hoverBaked);
      noteSceneMs(performance.now() - tSync);
      sceneState = sig;
      sceneGen++;
    }

    /* recomposite: live bg + live grid + GL frame + the scene's crop 1:1 */
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, cssW, cssH);
    if (Nasj.settings.grid) drawGridCached(ctx);
    glCompose();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(sceneCanvas,
      Math.round(scenePadX() * dpr), Math.round(scenePadY() * dpr),
      canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    painted = { sig, hoverId: null, crisp: true };
    startWarmJob();       /* the picture has landed: warm the pointer path */
    warmIndexIdle();      /* a zoom's deferred index rebuild lands at idle */

    /* keep grips/crosshair/previews in sync with the new transform */
    if (Nasj.renderOverlay) Nasj.renderOverlay();
  };

  /* ---------------- overlay render ---------------- */
  /* marker glyphs mirror the industry standard's AutoSnap shapes per osnap kind */
  /* the AutoSnap tooltip: the marker's name, the way the industry standard spells it */
  const SNAP_NAMES = {
    end: 'Endpoint', mid: 'Midpoint', center: 'Center', gcen: 'Geometric Center',
    node: 'Node', quad: 'Quadrant', int: 'Intersection',
    appint: 'Apparent Intersection', ext: 'Extension', ins: 'Insertion',
    perp: 'Perpendicular', tan: 'Tangent', near: 'Nearest', par: 'Parallel',
  };
  const drawSnapMark = (c2d, mark) => {
    const s = vp.worldToScreen(mark);
    const x = s.x, y = s.y, r = 4.5; /* 9px marker */
    c2d.save();
    c2d.strokeStyle = COL.snap;
    c2d.lineWidth = 1.5;
    c2d.setLineDash([]);
    c2d.beginPath();
    switch (mark.kind) {
      case 'end': /* square */
        c2d.rect(x - r, y - r, r * 2, r * 2);
        break;
      case 'mid': /* triangle */
        c2d.moveTo(x, y - r);
        c2d.lineTo(x - r, y + r);
        c2d.lineTo(x + r, y + r);
        c2d.closePath();
        break;
      case 'center': /* circle */
        c2d.arc(x, y, r, 0, TAU);
        break;
      case 'gcen': { /* circle with a cross (geometric center) */
        c2d.arc(x, y, r, 0, TAU);
        c2d.moveTo(x - r, y); c2d.lineTo(x + r, y);
        c2d.moveTo(x, y - r); c2d.lineTo(x, y + r);
        break;
      }
      case 'node': /* circle with an X */
        c2d.arc(x, y, r, 0, TAU);
        c2d.moveTo(x - r, y - r); c2d.lineTo(x + r, y + r);
        c2d.moveTo(x + r, y - r); c2d.lineTo(x - r, y + r);
        break;
      case 'int': /* X */
        c2d.moveTo(x - r, y - r); c2d.lineTo(x + r, y + r);
        c2d.moveTo(x + r, y - r); c2d.lineTo(x - r, y + r);
        break;
      case 'appint': /* boxed X */
        c2d.rect(x - r, y - r, r * 2, r * 2);
        c2d.moveTo(x - r, y - r); c2d.lineTo(x + r, y + r);
        c2d.moveTo(x + r, y - r); c2d.lineTo(x - r, y + r);
        break;
      case 'ext': /* ellipsis along the extension */
        for (const dx of [-r, 0, r]) {
          c2d.moveTo(x + dx + 0.9, y);
          c2d.arc(x + dx, y, 0.9, 0, TAU);
        }
        break;
      case 'ins': /* two offset squares (insertion) */
        c2d.rect(x - r, y - r, r * 1.2, r * 1.2);
        c2d.rect(x - r * 0.2, y - r * 0.2, r * 1.2, r * 1.2);
        break;
      case 'perp': /* right-angle symbol */
        c2d.moveTo(x - r, y - r); c2d.lineTo(x - r, y + r); c2d.lineTo(x + r, y + r);
        c2d.moveTo(x - r, y + r * 0.1); c2d.lineTo(x - r * 0.1, y + r * 0.1);
        c2d.lineTo(x - r * 0.1, y + r);
        break;
      case 'tan': /* circle with a tangent line on top */
        c2d.arc(x, y + r * 0.3, r * 0.85, 0, TAU);
        c2d.moveTo(x - r - 1, y - r * 0.55); c2d.lineTo(x + r + 1, y - r * 0.55);
        break;
      case 'near': /* bowtie */
        c2d.moveTo(x - r, y - r); c2d.lineTo(x + r, y + r);
        c2d.lineTo(x + r, y - r); c2d.lineTo(x - r, y + r);
        c2d.closePath();
        break;
      case 'par': /* two parallel slashes */
        c2d.moveTo(x - r, y + r * 0.4); c2d.lineTo(x + r * 0.2, y - r);
        c2d.moveTo(x - r * 0.2, y + r); c2d.lineTo(x + r, y - r * 0.4);
        break;
      case 'trk': /* OTRACK: a + riding the alignment ray */
        c2d.moveTo(x - r, y); c2d.lineTo(x + r, y);
        c2d.moveTo(x, y - r); c2d.lineTo(x, y + r);
        break;
      default: /* quad: diamond */
        c2d.moveTo(x, y - r);
        c2d.lineTo(x + r, y);
        c2d.lineTo(x, y + r);
        c2d.lineTo(x - r, y);
        c2d.closePath();
        break;
    }
    c2d.stroke();
    /* the tooltip naming the snap, offset below-right as the industry standard's is —
       and below the dynamic-input tip when that occupies the near spot */
    const name = SNAP_NAMES[mark.kind];
    if (name) {
      c2d.font = '11px "Segoe UI", sans-serif';
      const w = c2d.measureText(name).width + 12;
      const tx = x + 14, ty = y + (Nasj.settings.dyn ? 40 : 16);
      c2d.fillStyle = '#d4d4d4';
      c2d.strokeStyle = '#555';
      c2d.lineWidth = 1;
      c2d.fillRect(tx, ty, w, 18);
      c2d.strokeRect(tx + 0.5, ty + 0.5, w, 18);
      c2d.fillStyle = '#1c1c1c';
      c2d.textAlign = 'left';
      c2d.textBaseline = 'alphabetic';
      c2d.fillText(name, tx + 6, ty + 13);
    }
    c2d.restore();
  };

  /* 3-axis crosshair in 3D: rays along the projected world X/Y/Z directions */
  const AXIS3D = [
    [{ x: 1, y: 0, z: 0 }, 'rgba(224,90,90,.95)'],   /* X */
    [{ x: 0, y: 1, z: 0 }, 'rgba(100,200,100,.95)'], /* Y */
    [{ x: 0, y: 0, z: 1 }, 'rgba(79,179,234,.95)']   /* Z */
  ];

  const drawCrosshair3d = (c2d) => {
    const s = Nasj.ui.cursor.screen;
    const w = Nasj.ui.cursor.world || { x: 0, y: 0 };
    const arm = 42, box = 4; /* 8px pickbox */
    c2d.save();
    c2d.lineWidth = 1;
    c2d.setLineDash([]);
    const o = vp.worldToScreen({ x: w.x, y: w.y, z: 0 });
    for (const [u, color] of AXIS3D) {
      const q = vp.worldToScreen({ x: w.x + u.x, y: w.y + u.y, z: u.z });
      let dx = q.x - o.x, dy = q.y - o.y;
      const L = Math.hypot(dx, dy);
      if (L < 1e-6) continue; /* axis points at the viewer */
      dx /= L;
      dy /= L;
      c2d.strokeStyle = color;
      c2d.beginPath();
      c2d.moveTo(s.x + dx * box, s.y + dy * box);
      c2d.lineTo(s.x + dx * (box + arm), s.y + dy * (box + arm));
      c2d.stroke();
    }
    c2d.strokeStyle = COL.crosshair;
    c2d.beginPath();
    c2d.rect(Math.round(s.x) - box + 0.5, Math.round(s.y) - box + 0.5, box * 2, box * 2);
    c2d.stroke();
    c2d.restore();
  };

  /* the industry standard's cursor badge while objects are being window-selected: a small
     dashed rectangle riding the crosshair's upper right, filled the way the
     window itself is, so the mode reads at the cursor too. Only object
     selection wears it (the badge flag) — ZOOM Window and the AI panel's
     picker drag the same rectangle and get none, as in the industry standard. */
  const drawSelBadge = (c2d, box) => {
    const u = Nasj.ui;
    const rect = u.selRect && u.selRect.badge && u.selRect.a && u.selRect.b;
    const lasso = u.selLasso && u.selLasso.pts && u.selLasso.pts.length > 1;
    if (!rect && !lasso) return;
    const crossing = rect ? !!u.selRect.crossing : !!u.selLasso.crossing;
    const s = u.cursor.screen;
    const w = 13, h = 9;
    const x = Math.round(s.x + box + 3) + 0.5;
    const y = Math.round(s.y - box - 3 - h) + 0.5;
    c2d.save();
    c2d.fillStyle = crossing ? COL.selCrossing : COL.selWindow;
    c2d.fillRect(x, y, w, h);
    c2d.strokeStyle = Nasj.paper ? COL.crosshairPaper : COL.crosshair;
    c2d.lineWidth = 1;
    c2d.setLineDash([2, 2]);
    c2d.strokeRect(x, y, w, h);
    c2d.restore();
  };

  const drawCrosshair = (c2d) => {
    if (view3d.active) { drawCrosshair3d(c2d); drawSelBadge(c2d, 4); return; }
    const s = Nasj.ui.cursor.screen;
    const x = Math.round(s.x) + 0.5, y = Math.round(s.y) + 0.5;
    /* OPTIONS: crosshair size is a percentage (5% = the classic short arms,
       100% = full screen); the pickbox slider sizes the little square */
    const pct = (Nasj.opt && Nasj.opt.crosshair > 0) ? Nasj.opt.crosshair : 5;
    const arm = pct >= 100 ? Math.max(cssW, cssH) : Math.round(14 * pct);
    const box = 3 + ((Nasj.opt && Nasj.opt.pickbox >= 0) ? Nasj.opt.pickbox : 1);
    c2d.save();
    /* a layout is a white sheet, so the crosshair goes black there */
    c2d.strokeStyle = Nasj.paper ? COL.crosshairPaper : COL.crosshair;
    c2d.lineWidth = 1;
    c2d.setLineDash([]);
    c2d.beginPath();
    c2d.moveTo(x - box - arm, y); c2d.lineTo(x - box, y);
    c2d.moveTo(x + box, y); c2d.lineTo(x + box + arm, y);
    c2d.moveTo(x, y - box - arm); c2d.lineTo(x, y - box);
    c2d.moveTo(x, y + box); c2d.lineTo(x, y + box + arm);
    c2d.rect(x - box, y - box, box * 2, box * 2);
    c2d.stroke();
    c2d.restore();
    drawSelBadge(c2d, box);
  };

  /* ---- a finger placing a point (js/touch.js) ----
     The pick point rides 64px above the finger, so the finger never hides
     it; a ring with four ticks marks it, and a loupe — the drawing around
     the pick point at twice the size — stands above and to the left of the
     finger, where a hand holding the phone does not cover it. The loupe is
     a copy of the current frame: the scene canvas, the GPU layer while it
     is presenting, and the overlay as drawn so far (the rubber band and the
     snap marker included) — no second render of the region. */
  const PICK_RING_R = 11;              /* the ~22px ring */
  const LOUPE_R = 60;                  /* the ~120px loupe */
  const LOUPE_ZOOM = 2;
  const drawLoupe = (c2d, s, finger, stroke) => {
    const R = LOUPE_R;
    let cx = finger.x - 84, cy = finger.y - 160;
    /* no room above: the loupe goes beside the finger instead */
    if (cy < R + 4) { cx = finger.x + 100; cy = Math.max(R + 4, finger.y - 40); }
    cx = Math.max(R + 4, Math.min(cssW - R - 4, cx));
    cy = Math.max(R + 4, Math.min(cssH - R - 4, cy));
    const half = R / LOUPE_ZOOM;       /* css px of drawing on each side of the pick point */
    c2d.save();
    c2d.beginPath();
    c2d.arc(cx, cy, R, 0, TAU);
    c2d.clip();
    c2d.fillStyle = COL.bg;
    c2d.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    c2d.imageSmoothingEnabled = true;
    const put = (img) => {
      if (!img || !img.width || !img.height) return;
      const k = img.width / cssW;      /* the canvas's own backing scale */
      try {
        c2d.drawImage(img, (s.x - half) * k, (s.y - half) * k, 2 * half * k, 2 * half * k,
          cx - R, cy - R, 2 * R, 2 * R);
      } catch (_) { /* a canvas with no frame yet */ }
    };
    put(canvas);
    const glc = document.getElementById('gl-canvas');
    if (glc && glc.style.visibility !== 'hidden') put(glc);
    put(overlay);                      /* a copy of itself as it stands */
    c2d.restore();
    c2d.save();
    c2d.setLineDash([]);
    c2d.strokeStyle = stroke;
    c2d.lineWidth = 2;
    c2d.shadowColor = 'rgba(0,0,0,.55)';
    c2d.shadowBlur = 10;
    c2d.beginPath();
    c2d.arc(cx, cy, R, 0, TAU);
    c2d.stroke();
    c2d.shadowBlur = 0;
    c2d.lineWidth = 1;
    const X = Math.round(cx) + 0.5, Y = Math.round(cy) + 0.5;
    c2d.beginPath();
    c2d.moveTo(X - 12, Y); c2d.lineTo(X - 4, Y);
    c2d.moveTo(X + 4, Y); c2d.lineTo(X + 12, Y);
    c2d.moveTo(X, Y - 12); c2d.lineTo(X, Y - 4);
    c2d.moveTo(X, Y + 4); c2d.lineTo(X, Y + 12);
    c2d.stroke();
    c2d.restore();
  };
  const drawTouchPick = (c2d, tp) => {
    /* the marker sits where the point will land — the cursor, which grid
       snap may have moved off the raw pick point */
    const s = (Nasj.ui.cursor && Nasj.ui.cursor.screen) || tp.screen;
    if (!s) return;
    const stroke = Nasj.paper ? COL.crosshairPaper : COL.crosshair;
    if (tp.loupe !== false) drawLoupe(c2d, s, tp.finger || s, stroke);
    const r = PICK_RING_R, t0 = r + 3, t1 = r + 9;
    const x = Math.round(s.x) + 0.5, y = Math.round(s.y) + 0.5;
    c2d.save();
    c2d.strokeStyle = stroke;
    c2d.lineWidth = 1.5;
    c2d.setLineDash([]);
    c2d.beginPath();
    c2d.arc(x, y, r, 0, TAU);
    c2d.moveTo(x - t1, y); c2d.lineTo(x - t0, y);
    c2d.moveTo(x + t0, y); c2d.lineTo(x + t1, y);
    c2d.moveTo(x, y - t1); c2d.lineTo(x, y - t0);
    c2d.moveTo(x, y + t0); c2d.lineTo(x, y + t1);
    c2d.stroke();
    c2d.restore();
  };

  /* ---- UCS icon: X/Y axes standing on the origin, and draggable ---- */
  const UCS_ARM = 46, UCS_BOX = 9, UCS_EDGE = 26;
  const ucsUi = { hover: false, sel: false, drag: null };
  Nasj.ucsUi = ucsUi;                       /* QA/scripting surface */

  /* the icon stands on the origin while that is on screen, and parks in the
     lower-left corner (the industry standard's fallback) when it is not */
  const ucsAnchor = () => {
    const O = vp.worldToScreen(Nasj.ucs);
    /* inside an activated viewport the corner it parks in is the frame's */
    const R = mspVp ? Nasj.viewportScreenRect(mspVp) : { x: 0, y: 0, w: cssW, h: cssH };
    /* the Properties palette's "UCS icon at origin": No parks it for good */
    const on = Nasj.uiFlags.ucsAtOrigin !== false &&
      O.x >= R.x + UCS_EDGE && O.x <= R.x + R.w - UCS_EDGE &&
      O.y >= R.y + UCS_EDGE && O.y <= R.y + R.h - UCS_EDGE;
    return on ? { x: O.x, y: O.y, atOrigin: true }
      : { x: R.x + 22 + UCS_BOX, y: R.y + R.h - (mspVp ? 34 : 128), atOrigin: false };
  };
  /* on a sheet the model's icon belongs to the activated viewport, not the
     page; on a phone (touch.js's focus layout) it is one element too many
     on a screen that has room for the drawing alone */
  const ucsVisible = () => Nasj.uiFlags.ucsIcon !== false && !Nasj.focus &&
    (!Nasj.paper || !!mspVp);
  /* in 3D the icon is the three-armed triad, and it is chrome only: the
     drag that moves the origin belongs to the plan view it was drawn for */
  const ucsFlat = () => ucsVisible() && !view3d.active;
  /* the icon only answers the pointer between commands */
  const ucsIdle = () => ucsFlat() &&
    (!Nasj.tools || !Nasj.tools.activeName || Nasj.tools.activeName === 'select');
  /* the icon's own hit area: the origin box plus either arm */
  const ucsHit = (s) => {
    if (!ucsFlat()) return false;
    const A = ucsAnchor();
    if (!A.atOrigin) return false;          /* parked: nothing to grab */
    const dx = s.x - A.x, dy = s.y - A.y;
    if (Math.abs(dx) <= UCS_BOX + 3 && Math.abs(dy) <= UCS_BOX + 3) return true;
    if (dy > -4 && dy < 4 && dx > 0 && dx <= UCS_ARM + 8) return true;   /* X arm */
    if (dx > -4 && dx < 4 && dy < 0 && dy >= -(UCS_ARM + 8)) return true; /* Y arm */
    return false;
  };

  /* THE 3D ICON: three arms standing on the UCS origin, X and Y on the
     ground plane and Z square to both of them. Each arm is a world vector
     PROJECTED, so the triad leans with the view the way the drawing does —
     which is the whole point of it: it shows where +Z has gone. An arm the
     view sees end-on still appears, as the vector convention's circled dot
     (toward the eye) or circled cross (away from it), so every axis is
     named from every side. Every stroke stands on a background-colour halo
     so the triad stays readable when it lands on drawn geometry, and the
     icon parks in the corner when the origin leaves the screen, exactly as
     the flat icon does. */
  const drawUcsTriad = (c2d) => {
    const U = ucsOrigin();
    const O = vp.worldToScreen(U);
    const R = mspVp ? Nasj.viewportScreenRect(mspVp) : { x: 0, y: 0, w: cssW, h: cssH };
    const on = Nasj.uiFlags.ucsAtOrigin !== false &&
      O.x >= R.x + UCS_EDGE && O.x <= R.x + R.w - UCS_EDGE &&
      O.y >= R.y + UCS_EDGE && O.y <= R.y + R.h - UCS_EDGE;
    /* parked: room for arms leaning any way, plus a label past each tip */
    const A = on ? O
      : { x: R.x + UCS_ARM + 18, y: R.y + R.h - (mspVp ? UCS_ARM + 22 : 128) };
    /* a fixed length on SCREEN, so the triad never grows with the zoom */
    const len = UCS_ARM / (vp.scale || 1);
    const INK = '#cfd3d7';
    const ink = () => {
      c2d.strokeStyle = INK; c2d.lineWidth = 1.4; c2d.stroke();
    };
    const halo = () => {
      c2d.strokeStyle = COL.bg; c2d.lineWidth = 4.2; c2d.stroke();
    };
    const label2 = (t, x, y) => {
      c2d.strokeStyle = COL.bg; c2d.lineWidth = 3; c2d.strokeText(t, x, y);
      c2d.fillText(t, x, y);
    };
    const dirs = [], flat = [];
    const arm = (dx, dy, dz, label) => {
      const T = vp.worldToScreen({ x: U.x + dx * len, y: U.y + dy * len,
        z: U.z + dz * len });
      const vx = T.x - O.x, vy = T.y - O.y;
      const L = Math.hypot(vx, vy);
      if (L < 8) {                          /* end-on: drawn as a symbol below */
        flat.push({ label, toward: worldToDepth3({ x: U.x + dx, y: U.y + dy,
          z: U.z + dz }) < worldToDepth3(U) });
        return;
      }
      const ux = vx / L, uy = vy / L;
      dirs.push([ux, uy]);
      c2d.beginPath();
      c2d.moveTo(A.x, A.y);
      c2d.lineTo(A.x + vx, A.y + vy);
      halo(); ink();
      const hx = A.x + vx, hy = A.y + vy;
      const px = -uy, py = ux;              /* solid head, as the flat icon has */
      c2d.beginPath();
      c2d.moveTo(hx, hy);
      c2d.lineTo(hx - ux * 7 + px * 3, hy - uy * 7 + py * 3);
      c2d.lineTo(hx - ux * 7 - px * 3, hy - uy * 7 - py * 3);
      c2d.closePath();
      halo(); c2d.fill();
      label2(label, hx + ux * 9, hy + uy * 9);
    };
    c2d.save();
    c2d.fillStyle = INK;
    c2d.setLineDash([]);
    c2d.lineCap = 'butt';
    c2d.lineJoin = 'round';
    c2d.font = '11px "Segoe UI", sans-serif';
    c2d.textAlign = 'center';
    c2d.textBaseline = 'middle';
    /* the arms are the CONSTRUCTION PLANE's own two axes and its normal, so
       the icon says which plane a pick will land on — on the ground that is
       plain X, Y and Z, and standing up it is the pair being drawn on */
    const f = ucsFrame(), nrm = ucsNormal();
    arm(f.u[0], f.u[1], f.u[2], f.label[0]);
    arm(f.v[0], f.v[1], f.v[2], f.label[1]);
    /* the normal is the one world axis the plane leaves out */
    arm(nrm[0], nrm[1], nrm[2],
      ['X', 'Y', 'Z'].find((a) => a !== f.label[0] && a !== f.label[1]) || 'Z');
    /* the small square the arms stand on, as in the flat icon */
    c2d.beginPath();
    c2d.rect(A.x - 3.5, A.y - 3.5, 7, 7);
    halo(); ink();
    /* the end-on axis, set opposite the drawn arms so nothing overlaps */
    for (const d of flat) {
      let sx = 0, sy = 0;
      for (const [ux, uy] of dirs) { sx += ux; sy += uy; }
      const n = Math.hypot(sx, sy) || 1;
      const cx = A.x - (sx / n) * 16, cy = A.y - (sy / n) * 16;
      c2d.beginPath();
      c2d.arc(cx, cy, 5, 0, Math.PI * 2);
      halo(); ink();
      c2d.beginPath();
      if (d.toward) {                       /* the arrow's point: a dot */
        c2d.arc(cx, cy, 1.2, 0, Math.PI * 2);
        c2d.fill();
      } else {                              /* its fletching: a cross */
        const k = 5 * Math.SQRT1_2 - 1.4;
        c2d.moveTo(cx - k, cy - k); c2d.lineTo(cx + k, cy + k);
        c2d.moveTo(cx + k, cy - k); c2d.lineTo(cx - k, cy + k);
        ink();
      }
      label2(d.label, cx - (sx / n) * 14, cy - (sy / n) * 14);
    }
    c2d.restore();
  };

  const drawUcsIcon = (c2d) => {
    if (!ucsVisible()) return;
    if (view3d.active) { drawUcsTriad(c2d); return; }
    const A = ucsAnchor();
    const x = Math.round(A.x) + 0.5, y = Math.round(A.y) + 0.5;
    const live = A.atOrigin && (ucsUi.sel || ucsUi.hover || ucsUi.drag);
    c2d.save();
    c2d.strokeStyle = live ? '#ffd85e' : '#cfd3d7';
    c2d.fillStyle = c2d.strokeStyle;
    c2d.lineWidth = live ? 1.8 : 1.4;
    c2d.setLineDash([]);
    c2d.lineCap = 'butt';
    /* origin box + the two arms */
    c2d.strokeRect(x - UCS_BOX / 2, y - UCS_BOX / 2, UCS_BOX, UCS_BOX);
    c2d.beginPath();
    c2d.moveTo(x + UCS_BOX / 2, y); c2d.lineTo(x + UCS_ARM, y);
    c2d.moveTo(x, y - UCS_BOX / 2); c2d.lineTo(x, y - UCS_ARM);
    c2d.stroke();
    const head = (hx, hy, ux, uy) => {       /* solid arrowhead, 7px */
      const px = -uy, py = ux;
      c2d.beginPath();
      c2d.moveTo(hx, hy);
      c2d.lineTo(hx - ux * 7 + px * 3, hy - uy * 7 + py * 3);
      c2d.lineTo(hx - ux * 7 - px * 3, hy - uy * 7 - py * 3);
      c2d.closePath();
      c2d.fill();
    };
    head(x + UCS_ARM, y, 1, 0);
    head(x, y - UCS_ARM, 0, -1);
    c2d.font = '11px "Segoe UI", sans-serif';
    c2d.textBaseline = 'middle';
    c2d.fillText('X', x + UCS_ARM + 5, y + 1);
    c2d.textAlign = 'center';
    c2d.fillText('Y', x, y - UCS_ARM - 9);
    /* selected: the origin carries a grip, hot while it is being dragged */
    if (A.atOrigin && (ucsUi.sel || ucsUi.drag)) {
      c2d.fillStyle = ucsUi.drag ? COL.gripHot : COL.grip;
      c2d.strokeStyle = '#ffffff';
      c2d.lineWidth = 1;
      c2d.fillRect(x - 4, y - 4, 8, 8);
      c2d.strokeRect(x - 4.5, y - 4.5, 9, 9);
    }
    c2d.restore();
  };

  /* ---- THE 3D GIZMOS (chrome): the industry standard's coloured handles standing on
     the selection's centre in a 3D view, the one the ribbon's Gizmo
     flyout chose. MOVE: grab an arm and the selection moves along that
     axis alone. ROTATE: three rings, one about each axis; drag a ring and
     the selection turns about that axis through the centre. SCALE: the
     arms with a triangle between them; drag any of it and the selection
     scales uniformly about the centre. In every case the originals fade
     to the ghost the modify drags wear, transformed clones ride the
     cursor, and the release commits one undo step. The centre stays clear
     so grips keep their clicks; arms answer only past the dead zone. ---- */
  const GIZ_LEN = 68, GIZ_APX = 8, GIZ_DEAD = 16;
  const GIZ_AXES = [
    { v: [1, 0, 0], col: '#e05252', name: 'X' },
    { v: [0, 1, 0], col: '#5fbf5f', name: 'Y' },
    { v: [0, 0, 1], col: '#3fa9e0', name: 'Z' },
  ];
  const gizmo = { hover: null, drag: null };
  Nasj.gizmoUi = gizmo;                     /* QA/scripting surface */
  Nasj.gizmoUi.probe = (s) => {
    const h = gizmoHitArm(s);
    return { on: gizmoOn(), mode: gizmoMode(), hit: !!h, center: !!(h || {}).center,
      arm: h && h.arm ? h.arm.a.name : null, ring: h && h.ring ? h.ring.a.name : null,
      tri: !!(h || {}).tri, O: (gizmoArms() || {}).O || null };
  };
  Nasj.gizmoUi.rings = () => gizmoRings();
  Nasj.gizmoUi.arms = () => gizmoArms();
  /* the gizmo the ribbon chose — move, rotate, scale or none; a saved
     options file may still carry the older on/off flag */
  const gizmoMode = () => {
    const o = Nasj.opt || {};
    if (o.gizmo === 'rotate' || o.gizmo === 'scale' || o.gizmo === 'none' || o.gizmo === 'move') return o.gizmo;
    return o.gizmo3d === false ? 'none' : 'move';
  };
  const gizmoOn = () => view3d.active && !Nasj.paper && !mspVp && !ucsUi.drag &&
    gizmoMode() !== 'none' &&                        /* the ribbon's No Gizmo */
    Nasj.selection instanceof Set && Nasj.selection.size > 0 &&
    (!Nasj.tools || !Nasj.tools.activeName || Nasj.tools.activeName === 'select');
  const gizmoCenter = () => {
    const doc = Nasj.doc;
    if (!doc) return null;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    let z0 = Infinity, z1 = -Infinity, any = false;
    for (const id of Nasj.selection) {
      const ent = Nasj.docOps.entityById(doc, id);
      if (!ent) continue;
      const b = boundsOf(ent);
      if (!b || !isFinite(b.minx)) continue;
      any = true;
      if (b.minx < minx) minx = b.minx;
      if (b.miny < miny) miny = b.miny;
      if (b.maxx > maxx) maxx = b.maxx;
      if (b.maxy > maxy) maxy = b.maxy;
      /* the TRUE height span — zRangeOf anchors at 0 for culling, which
         would park the gizmo halfway down to the ground */
      const zof = (p) => (p && typeof p.z === 'number' && isFinite(p.z)) ? p.z : 0;
      const acc = (v) => { if (v < z0) z0 = v; if (v > z1) z1 = v; };
      if (Nasj.solid && Nasj.solid.isBody(ent)) {
        const r = Nasj.solid.zRange(ent);
        acc(r[0]); acc(r[1]);
      } else if (ent.type === 'insert') {
        const r = defZRange(doc, ent.name);
        const pz = zof(ent.p);
        acc(r[0] + pz); acc(r[1] + pz);
      } else if (Array.isArray(ent.pts)) {
        for (const p of ent.pts) acc(zof(p));
      } else {
        if (ent.a) acc(zof(ent.a));
        if (ent.b) acc(zof(ent.b));
        if (ent.c) acc(zof(ent.c));
        if (ent.p) acc(zof(ent.p));
      }
    }
    if (!any) return null;
    if (!isFinite(z0)) { z0 = 0; z1 = 0; }
    return { x: (minx + maxx) / 2, y: (miny + maxy) / 2, z: (z0 + z1) / 2 };
  };
  /* the arms as the screen sees them this frame */
  const gizmoArms = () => {
    const C = gizmoCenter();
    if (!C) return null;
    const len = GIZ_LEN / (vp.scale || 1);
    const O = vp.worldToScreen(C);
    const arms = [];
    for (const a of GIZ_AXES) {
      const T = vp.worldToScreen({ x: C.x + a.v[0] * len,
        y: C.y + a.v[1] * len, z: C.z + a.v[2] * len });
      const vx = T.x - O.x, vy = T.y - O.y;
      const L = Math.hypot(vx, vy);
      if (L < 6) continue;                  /* an arm seen end-on is no handle */
      arms.push({ a, O, T, ux: vx / L, uy: vy / L, L, ppu: L / len });
    }
    return { C, O, len, arms };
  };
  /* the rotate gizmo's rings as the screen sees them: each ring lies in
     the plane square to its axis, spanned by the two other axes u and w
     (u × w = the axis, so the ring's angle runs the right hand's way).
     U and W are those radii on screen; a ring seen edge-on is dropped. */
  const GIZ_RING = 0.8;                     /* ring radius, in arm lengths */
  const GIZ_PLANES = { X: [[0, 1, 0], [0, 0, 1]], Y: [[0, 0, 1], [1, 0, 0]], Z: [[1, 0, 0], [0, 1, 0]] };
  const gizmoRings = () => {
    const C = gizmoCenter();
    if (!C) return null;
    const R = GIZ_LEN * GIZ_RING / (vp.scale || 1);
    const O = vp.worldToScreen(C);
    const rings = [];
    for (const a of GIZ_AXES) {
      const [u, w] = GIZ_PLANES[a.name];
      const pu = vp.worldToScreen({ x: C.x + u[0] * R, y: C.y + u[1] * R, z: C.z + u[2] * R });
      const pw = vp.worldToScreen({ x: C.x + w[0] * R, y: C.y + w[1] * R, z: C.z + w[2] * R });
      const U = { x: pu.x - O.x, y: pu.y - O.y }, W = { x: pw.x - O.x, y: pw.y - O.y };
      const det = U.x * W.y - U.y * W.x;
      if (Math.abs(det) < 60) continue;     /* a ring seen edge-on is no handle */
      rings.push({ a, O, U, W, det });
    }
    return { C, O, R, rings };
  };
  /* where a screen point stands on a ring's plane: the angle t about the
     axis and the radius in ring units — the screen offset solved back
     through U and W, which is the ray-plane meeting in an orthographic view */
  const ringParam = (ring, s) => {
    const dx = s.x - ring.O.x, dy = s.y - ring.O.y;
    const c = (dx * ring.W.y - dy * ring.W.x) / ring.det;
    const sn = (ring.U.x * dy - ring.U.y * dx) / ring.det;
    return { t: Math.atan2(sn, c), r: Math.hypot(c, sn) };
  };
  const ringPoint = (ring, t) => ({
    x: ring.O.x + Math.cos(t) * ring.U.x + Math.sin(t) * ring.W.x,
    y: ring.O.y + Math.cos(t) * ring.U.y + Math.sin(t) * ring.W.y });
  /* the scale gizmo's triangle: the three arms joined part-way out */
  const GIZ_TRI = 0.42;
  const triCorners = (g) => g.arms.map((arm) => ({
    x: g.O.x + arm.ux * arm.L * GIZ_TRI, y: g.O.y + arm.uy * arm.L * GIZ_TRI }));
  const inTri = (s, T) => {
    const side = (p, q) => (q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x);
    const a = side(T[0], T[1]), b = side(T[1], T[2]), c = side(T[2], T[0]);
    return (a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0);
  };
  const gizmoHitArm = (s) => {
    if (!gizmoOn()) return null;
    const mode = gizmoMode();
    if (mode === 'rotate') {
      const g = gizmoRings();
      if (!g) return null;
      /* the nearest ring within reach: the rings cross where the axes
         pierce them, and there the closer one answers */
      let best = null;
      for (const ring of g.rings) {
        const q = ringParam(ring, s);
        const P = ringPoint(ring, q.t);
        const dist = Math.hypot(s.x - P.x, s.y - P.y);
        if (dist <= 7 && (!best || dist < best.dist)) best = { g, ring, t: q.t, dist };
      }
      return best;
    }
    const g = gizmoArms();
    if (!g) return null;
    /* the centre box first: the industry standard's free-move handle */
    if (Math.hypot(s.x - g.O.x, s.y - g.O.y) <= 8) return { g, center: true };
    for (const arm of g.arms) {
      const dx = s.x - arm.O.x, dy = s.y - arm.O.y;
      const along = dx * arm.ux + dy * arm.uy;
      const off = Math.abs(-arm.uy * dx + arm.ux * dy);
      if (off <= GIZ_APX && along >= GIZ_DEAD && along <= arm.L + 8) {
        return { g, arm };
      }
    }
    if (mode === 'scale' && g.arms.length === 3 && inTri(s, triCorners(g))) return { g, tri: true };
    return null;
  };
  /* the distance, angle or factor riding beside the cursor */
  const gizmoLabel = (c2d, label) => {
    const s = Nasj.ui.cursor.screen;
    if (!s) return;
    const w = c2d.measureText(label).width;
    c2d.fillStyle = COL.bg;
    c2d.fillRect(s.x + 12, s.y - 20, w + 10, 16);
    c2d.strokeStyle = '#5a6470';
    c2d.lineWidth = 1;
    c2d.strokeRect(s.x + 12.5, s.y - 19.5, w + 9, 15);
    c2d.fillStyle = '#e8eaec';
    c2d.fillText(label, s.x + 17 + w / 2, s.y - 12);
  };
  const drawRotateGizmo = (c2d) => {
    const g = gizmo.drag ? gizmo.drag.geom : gizmoRings();
    if (!g) return;
    c2d.save();
    c2d.setLineDash([]);
    c2d.lineCap = 'butt';
    c2d.font = '10px "Segoe UI", sans-serif';
    c2d.textAlign = 'center';
    c2d.textBaseline = 'middle';
    for (const ring of g.rings) {
      const active = gizmo.drag ? gizmo.drag.ring === ring : gizmo.hover === ring.a.name;
      /* while a ring is being dragged the OTHER two stand down */
      if (gizmo.drag && gizmo.drag.ring !== ring) continue;
      c2d.beginPath();
      for (let i = 0; i <= 48; i++) {
        const p = ringPoint(ring, i / 48 * Math.PI * 2);
        if (i) c2d.lineTo(p.x, p.y); else c2d.moveTo(p.x, p.y);
      }
      c2d.strokeStyle = COL.bg;
      c2d.lineWidth = 4.6;
      c2d.stroke();
      c2d.strokeStyle = active ? '#e8c25a' : ring.a.col;
      c2d.lineWidth = active ? 2.6 : 2;
      c2d.stroke();
    }
    /* the drag: the radius it started at and the one under the cursor,
       the angle between them riding beside */
    if (gizmo.drag && gizmo.drag.engaged) {
      const d = gizmo.drag;
      const p0 = ringPoint(d.ring, d.t0), p1 = ringPoint(d.ring, d.t0 + d.th);
      c2d.lineWidth = 1;
      c2d.setLineDash([6, 5]);
      c2d.strokeStyle = '#9fb3c8';
      c2d.beginPath();
      c2d.moveTo(g.O.x, g.O.y); c2d.lineTo(p0.x, p0.y);
      c2d.moveTo(g.O.x, g.O.y); c2d.lineTo(p1.x, p1.y);
      c2d.stroke();
      c2d.setLineDash([]);
      gizmoLabel(c2d, d.t.toFixed(2) + '\u00b0');
    }
    c2d.restore();
  };
  const drawGizmo = (c2d) => {
    if (!gizmoOn() && !gizmo.drag) return;
    const mode = gizmo.drag ? gizmo.drag.mode : gizmoMode();
    if (mode === 'rotate') { drawRotateGizmo(c2d); return; }
    const g = gizmo.drag ? gizmo.drag.geom : gizmoArms();
    if (!g) return;
    c2d.save();
    c2d.setLineDash([]);
    c2d.lineCap = 'butt';
    c2d.font = '10px "Segoe UI", sans-serif';
    c2d.textAlign = 'center';
    c2d.textBaseline = 'middle';
    for (const arm of g.arms) {
      const active = gizmo.drag ? gizmo.drag.arm === arm
        : gizmo.hover === arm.a.name;
      const col = active ? '#e8c25a' : arm.a.col;
      /* while an arm is being dragged the OTHER two stand down — unless
         the drag scales, which every arm takes part in */
      if (gizmo.drag && gizmo.drag.arm !== arm && mode !== 'scale') continue;
      c2d.strokeStyle = COL.bg;
      c2d.lineWidth = 4.6;
      c2d.beginPath();
      c2d.moveTo(g.O.x + arm.ux * 6, g.O.y + arm.uy * 6);
      c2d.lineTo(arm.T.x, arm.T.y);
      c2d.stroke();
      c2d.strokeStyle = col;
      c2d.lineWidth = active ? 2.6 : 2;
      c2d.stroke();
      const px = -arm.uy, py = arm.ux;
      c2d.fillStyle = col;
      c2d.beginPath();
      if (mode === 'scale') {               /* the scale gizmo tips its arms with boxes */
        c2d.rect(arm.T.x - 3.5, arm.T.y - 3.5, 7, 7);
      } else {
        c2d.moveTo(arm.T.x + arm.ux * 9, arm.T.y + arm.uy * 9);
        c2d.lineTo(arm.T.x - px * 4, arm.T.y - py * 4);
        c2d.lineTo(arm.T.x + px * 4, arm.T.y + py * 4);
        c2d.closePath();
      }
      c2d.fill();
    }
    /* the scale gizmo's triangle between the arms: the uniform handle */
    if (mode === 'scale' && g.arms.length === 3) {
      const T = triCorners(g);
      const hot = gizmo.drag ? gizmo.drag.engaged : gizmo.hover === 'T';
      c2d.beginPath();
      c2d.moveTo(T[0].x, T[0].y); c2d.lineTo(T[1].x, T[1].y); c2d.lineTo(T[2].x, T[2].y);
      c2d.closePath();
      c2d.fillStyle = hot ? 'rgba(232,194,90,0.35)' : 'rgba(207,211,215,0.18)';
      c2d.fill();
      c2d.strokeStyle = hot ? '#e8c25a' : '#cfd3d7';
      c2d.lineWidth = 1;
      c2d.stroke();
    }
    /* the centre box: the industry standard's free-move handle */
    if (!gizmo.drag || gizmo.drag.center) {
      const hotC = gizmo.drag ? gizmo.drag.engaged : gizmo.hover === 'C';
      c2d.strokeStyle = COL.bg;
      c2d.lineWidth = 4;
      c2d.strokeRect(g.O.x - 4.5, g.O.y - 4.5, 9, 9);
      c2d.strokeStyle = hotC ? '#e8c25a' : '#cfd3d7';
      c2d.lineWidth = hotC ? 2 : 1.4;
      c2d.strokeRect(g.O.x - 4.5, g.O.y - 4.5, 9, 9);
    }
    /* the drag: the axis runs on as a construction line (an arm), or the
       tether follows the cursor (the centre), the distance riding beside */
    if (gizmo.drag && gizmo.drag.engaged) {
      const d = gizmo.drag;
      const arm = d.arm;
      c2d.lineWidth = 1;
      c2d.setLineDash([6, 5]);
      c2d.beginPath();
      if (arm && mode !== 'scale') {
        c2d.strokeStyle = arm.a.col;
        c2d.moveTo(g.O.x - arm.ux * 4000, g.O.y - arm.uy * 4000);
        c2d.lineTo(g.O.x + arm.ux * 4000, g.O.y + arm.uy * 4000);
      } else {
        const cs = Nasj.ui.cursor.screen;
        c2d.strokeStyle = '#9fb3c8';
        c2d.moveTo(g.O.x, g.O.y);
        if (cs) c2d.lineTo(cs.x, cs.y);
      }
      c2d.stroke();
      c2d.setLineDash([]);
      gizmoLabel(c2d, d.t.toFixed(4));
    }
    c2d.restore();
  };
  /* ---- the transforms behind the rotate and scale gizmos ----
     A point turned about the axis v through C (Rodrigues), or scaled
     about C, heights included. A box, wall or slab under either becomes
     a general solid first — a tilted box is no box — while a scaled box
     stays the box it is. Everything else takes its own kind's transform:
     the plan rotation for a turn about Z (headings, arcs and text angles
     follow), the bare point map for a turn about X or Y. */
  const zOf3 = (p) => (p && typeof p.z === 'number' && isFinite(p.z)) ? p.z : 0;
  const rot3 = (p, C, v, th) => {
    const x = p.x - C.x, y = p.y - C.y, z = zOf3(p) - C.z;
    const c = Math.cos(th), s = Math.sin(th);
    const dot = v[0] * x + v[1] * y + v[2] * z;
    const cx = v[1] * z - v[2] * y, cy = v[2] * x - v[0] * z, cz = v[0] * y - v[1] * x;
    return { x: C.x + x * c + cx * s + v[0] * dot * (1 - c),
      y: C.y + y * c + cy * s + v[1] * dot * (1 - c),
      z: C.z + z * c + cz * s + v[2] * dot * (1 - c) };
  };
  const scl3 = (p, C, k) => ({ x: C.x + (p.x - C.x) * k, y: C.y + (p.y - C.y) * k, z: C.z + (zOf3(p) - C.z) * k });
  const bodyToSolid = (e) => {
    if (e.type === 'solid') return;
    const pt = (p) => ({ x: p.x, y: p.y, z: zOf3(p) });
    const faces = Nasj.solid.rawFacesOf(e).map((f) => {
      const g = { pts: f.pts.map(pt) };
      if (f.holes && f.holes.length) g.holes = f.holes.map((h) => h.map(pt));
      if (f.hid) g.hid = f.hid;
      if (f.color) g.color = f.color;
      return g;
    });
    for (const k of ['p', 'w', 'd', 'h', 'pts', 't', 'z', 'th', 'openings']) delete e[k];
    e.type = 'solid';
    e.faces = faces;
    e.wires = [];
  };
  const gizmoTransform = (e, d) => {
    const C = d.geom.C, G = Nasj.geom;
    const rotate = d.mode === 'rotate';
    const v = rotate ? d.ring.a.v : null;
    const fn = rotate ? (p) => rot3(p, C, v, d.th) : (p) => scl3(p, C, d.k);
    if (!rotate && e.type === 'box') { G.transformEntity(e, fn, { k: d.k }); return; }
    if (Nasj.solid.isBody(e)) {
      bodyToSolid(e);
      e.faces = e.faces.map((f) => {
        const g = { pts: f.pts.map(fn) };
        if (f.holes) g.holes = f.holes.map((h) => h.map(fn));
        if (f.hid) g.hid = f.hid;
        if (f.color) g.color = f.color;
        return g;
      });
      e.wires = (e.wires || []).map((w) => w.map(fn));
      return;
    }
    if (e.type === 'face3d') { e.pts = e.pts.map(fn); return; }
    if (!rotate) { G.transformEntity(e, fn, { k: d.k }); return; }
    if (v[2] && !v[0] && !v[1]) { G.rotateEntityAbout(e, C, d.th); return; }
    G.transformEntity(e, fn);
  };
  const gizmoPreview = (d) => {
    Nasj.ui.preview = d.ents.map((e) => {
      const c = JSON.parse(JSON.stringify(e));
      gizmoTransform(c, d);
      return c;
    });
    Nasj.renderOverlay();
  };
  const gizmoEngage = () => {
    const d = gizmo.drag;
    if (!d || d.engaged) return;
    d.engaged = true;
    /* the originals fade to the modify ghost while the clones ride */
    Nasj.ui.ghostDim = d.ents;
    for (const id of d.ids) hiddenIds.add(id);
    Nasj.hiddenBump();
    Nasj.render();
  };
  const gizmoBeginDrag = (screen, ev) => {
    const hit = gizmoHitArm(screen);
    if (!hit) return false;
    const doc = Nasj.doc;
    const ids = [...Nasj.selection];
    const ents = [];
    for (const id of Nasj.selection) {
      const e = Nasj.docOps.entityById(doc, id);
      if (e) ents.push(e);
    }
    gizmo.drag = { mode: gizmoMode(), arm: hit.arm || null, ring: hit.ring || null,
      tri: !!hit.tri, center: !!hit.center, geom: hit.g,
      s0: { x: screen.x, y: screen.y }, t: 0, dx: 0, dy: 0, ids, ents,
      engaged: false,
      w0: hit.center ? vp.screenToWorld(screen) : null,
      t0: hit.ring ? hit.t : 0, th: 0,        /* the rotate drag: start angle, turn */
      r0: Math.max(4, Math.hypot(screen.x - hit.g.O.x, screen.y - hit.g.O.y)), k: 1 };
    /* an arm takes hold at once; the CENTRE waits for a real drag, so a
       plain click there still reaches the grip that may stand under it */
    if (!hit.center) gizmoEngage();
    return true;
  };
  const gizmoMoveDrag = (screen) => {
    const d = gizmo.drag;
    if (d.mode === 'rotate') {
      /* the cursor's angle on the ring's plane, less the angle it took
         hold at: the turn, kept within a half circle either way */
      let th = ringParam(d.ring, screen).t - d.t0;
      while (th > Math.PI) th -= Math.PI * 2;
      while (th <= -Math.PI) th += Math.PI * 2;
      d.th = th;
      d.t = th * 180 / Math.PI;
      gizmoPreview(d);
      return;
    }
    if (d.mode === 'scale') {
      if (!d.engaged) {
        if (Math.hypot(screen.x - d.s0.x, screen.y - d.s0.y) < 4) return;
        gizmoEngage();
      }
      /* uniform: the cursor's distance from the centre against the
         distance it took hold at */
      d.k = Math.max(0.01, Math.hypot(screen.x - d.geom.O.x, screen.y - d.geom.O.y) / d.r0);
      d.t = d.k;
      gizmoPreview(d);
      return;
    }
    if (d.center) {
      if (!d.engaged) {
        if (Math.hypot(screen.x - d.s0.x, screen.y - d.s0.y) < 4) return;
        gizmoEngage();
      }
      /* free movement, the industry standard's centre box: the selection follows the
         cursor across the construction plane — heights stay their own,
         the rule every bare pick follows */
      const w = vp.screenToWorld(screen);
      d.dx = w.x - d.w0.x;
      d.dy = w.y - d.w0.y;
      d.t = Math.hypot(d.dx, d.dy);
      Nasj.ui.preview = d.ents.map((e) => {
        const c = JSON.parse(JSON.stringify(e));
        Nasj.geom.translateEntity(c, d.dx, d.dy, 0);
        return c;
      });
      Nasj.renderOverlay();
      return;
    }
    const arm = d.arm;
    const delta = (screen.x - d.s0.x) * arm.ux + (screen.y - d.s0.y) * arm.uy;
    d.t = delta / arm.ppu;
    const mv = arm.a.v;
    Nasj.ui.preview = d.ents.map((e) => {
      const c = JSON.parse(JSON.stringify(e));
      Nasj.geom.translateEntity(c, mv[0] * d.t, mv[1] * d.t, mv[2] * d.t);
      return c;
    });
    Nasj.renderOverlay();
  };
  const gizmoEndDrag = (commit) => {
    const d = gizmo.drag;
    if (!d) return;
    gizmo.drag = null;
    Nasj.ui.preview = [];
    Nasj.ui.ghostDim = null;
    for (const id of d.ids) hiddenIds.delete(id);
    Nasj.hiddenBump();
    const changed = d.mode === 'rotate' ? Math.abs(d.th) > 1e-9
      : d.mode === 'scale' ? Math.abs(d.k - 1) > 1e-9 : Math.abs(d.t) > 1e-9;
    if (commit && d.engaged && changed && d.mode !== 'move') {
      const doc = Nasj.doc;
      Nasj.docOps.pushUndo(doc);
      for (const e of d.ents) {
        /* the engine hears that this entity is about to change: the index
           re-cells it at the commit, its tables refresh */
        if (Nasj.spatialCapture) Nasj.spatialCapture(doc, e);
        gizmoTransform(e, d);
      }
      doc.modified = true;
      Nasj.emit('nasj:doc', { doc });
      if (Nasj.cmd && Nasj.cmd.print) {
        Nasj.cmd.print(d.ids.length + (d.mode === 'rotate'
          ? ' object(s) rotated ' + d.t.toFixed(2) + '\u00b0 about ' + d.ring.a.name + '.'
          : ' object(s) scaled by ' + d.k.toFixed(4) + '.'));
      }
    } else if (commit && d.engaged && changed) {
      const doc = Nasj.doc;
      const mv = d.center ? [0, 0, 0] : d.arm.a.v;
      const dx = d.center ? d.dx : mv[0] * d.t;
      const dy = d.center ? d.dy : mv[1] * d.t;
      const dz = d.center ? 0 : mv[2] * d.t;
      Nasj.docOps.pushUndo(doc);
      for (const e of d.ents) {
        Nasj.geom.translateEntity(e, dx, dy, dz);
      }
      doc.modified = true;
      Nasj.emit('nasj:doc', { doc });
      if (Nasj.cmd && Nasj.cmd.print) {
        Nasj.cmd.print(d.ids.length + ' object(s) moved ' + d.t.toFixed(4) +
          (d.center ? '.' : ' along ' + d.arm.a.name + '.'));
      }
    }
    Nasj.render();
    Nasj.renderOverlay();
  };

  /* ---- Block Editor authoring chrome (BEDIT session only) ----
     Constraint bars: a chip of glyphs beside geometry that carries
     geometric constraints (hidden per entity by Show/Hide, wholesale by
     Hide All). Dimensional constraints label themselves d1=…, teal, the
     editable value the Parameters Manager drives. A BPARAMETER draws as
     the cyan square grip-to-be with its name. Constraint-status mode
     boxes unconstrained geometry amber, the industry standard's colour-coding. */
  const GC_GLYPH = {
    horizontal: '━', vertical: '┃', parallel: '∥',
    perpendicular: '⊥', coincident: '◇', concentric: '◎',
    collinear: '≡', tangent: '○', equal: '=', fix: '⊕',
    smooth: '∿', symmetric: '⋈',
  };
  /* the industry standard's dimension-styled parameter, in screen points: ✕ at each
     picked point, and the WHOLE arrow line standing at the label point's
     offset — slide the label and the line slides with it, extension
     lines reaching back to the picks, exactly a dimension being placed.
     Shared by the placed parameter and the live placement preview. */
  /* the actions bound to a parameter, named for its ⚡ bar */
  const paramActs = (doc, name) => {
    const out = [];
    const LBL = { move: 'Move', stretch: 'Stretch', polarstretch: 'Polar Stretch',
      scale: 'Scale', rotate: 'Rotate', flip: 'Flip', array: 'Array', lookup: 'Lookup' };
    for (const x of doc.entities) {
      for (const b of x.boundTo || []) {
        const nm = (typeof b === 'string') ? b : b.p;
        if (nm !== name) continue;
        const a = LBL[(typeof b === 'string') ? 'move' : b.a] || 'Move';
        if (out.indexOf(a) < 0) out.push(a);
      }
    }
    return out;
  };

  const drawParamDim = (c2d, s, s2, lp, name) => {
    const BLUE = '#3a6fd8';
    c2d.strokeStyle = BLUE;
    c2d.lineWidth = 1;
    c2d.setLineDash([]);
    const xMark = (q) => {
      c2d.beginPath();
      c2d.moveTo(q.x - 5, q.y - 5); c2d.lineTo(q.x + 5, q.y + 5);
      c2d.moveTo(q.x - 5, q.y + 5); c2d.lineTo(q.x + 5, q.y - 5);
      c2d.stroke();
    };
    xMark(s); xMark(s2);
    let ux = s2.x - s.x, uy = s2.y - s.y;
    const L = Math.hypot(ux, uy) || 1;
    ux /= L; uy /= L;
    /* the dimension line runs through the label point, parallel to the
       measured pair: the picks project onto it perpendicular */
    const nx = -uy, ny = ux;
    const d = (lp.x - s.x) * nx + (lp.y - s.y) * ny;
    const pa = { x: s.x + nx * d, y: s.y + ny * d };
    const pb = { x: s2.x + nx * d, y: s2.y + ny * d };
    /* extension lines from the picks to the line, a small gap at the pick
       and a hair past the line, the way a dimension draws them */
    if (Math.abs(d) > 2) {
      const g = Math.sign(d) * 4, over = Math.sign(d) * 4;
      c2d.beginPath();
      c2d.moveTo(s.x + nx * g, s.y + ny * g);
      c2d.lineTo(pa.x + nx * over, pa.y + ny * over);
      c2d.moveTo(s2.x + nx * g, s2.y + ny * g);
      c2d.lineTo(pb.x + nx * over, pb.y + ny * over);
      c2d.stroke();
    }
    const arrow = (q, dx, dy) => {
      c2d.beginPath();
      c2d.moveTo(q.x, q.y);
      c2d.lineTo(q.x + dx * 9 - dy * 3.5, q.y + dy * 9 + dx * 3.5);
      c2d.lineTo(q.x + dx * 9 + dy * 3.5, q.y + dy * 9 - dx * 3.5);
      c2d.closePath();
      c2d.fillStyle = BLUE;
      c2d.fill();
    };
    c2d.beginPath();
    c2d.moveTo(pa.x, pa.y);
    c2d.lineTo(pb.x, pb.y);
    c2d.stroke();
    arrow(pa, ux, uy);
    arrow(pb, -ux, -uy);
    /* the name stands ON the line, at the label's own along-line spot */
    const t = (lp.x - pa.x) * ux + (lp.y - pa.y) * uy;
    const tp = { x: pa.x + ux * t, y: pa.y + uy * t };
    c2d.font = '13px "Segoe UI", sans-serif';
    c2d.textAlign = 'center';
    c2d.fillStyle = BLUE;
    c2d.fillText(name, tp.x, tp.y - 8);
    c2d.textAlign = 'left';
    c2d.font = '11px "Segoe UI", sans-serif';
  };

  const drawBeditChrome = (c2d, doc, only) => {
    const R = Nasj.refedit;
    const inEd = !!(R && R.bedit);
    const B = Nasj.geom.entityBounds;
    c2d.save();
    c2d.font = '11px "Segoe UI", sans-serif';
    c2d.textBaseline = 'middle';
    /* the base point the session carries (BPARAMETER Basepoint): ⊕ */
    if (inEd && R.base) {
      const bs = vp.worldToScreen(R.base);
      c2d.strokeStyle = '#e8a13a';
      c2d.lineWidth = 1;
      c2d.setLineDash([]);
      c2d.beginPath();
      c2d.arc(bs.x, bs.y, 6, 0, Math.PI * 2);
      c2d.moveTo(bs.x - 9, bs.y); c2d.lineTo(bs.x + 9, bs.y);
      c2d.moveTo(bs.x, bs.y - 9); c2d.lineTo(bs.x, bs.y + 9);
      c2d.stroke();
      c2d.fillStyle = '#b57f2d';
      c2d.fillText('Base', bs.x + 11, bs.y - 8);
    }
    for (const e of doc.entities) {
      if (only && !only.has(e.id)) continue;
      if (e.type === 'bparam') {
        if (!inEd) continue;
        const s = vp.worldToScreen(e);
        const measuring = e.kind === 'linear' || e.kind === 'polar' || e.kind === 'xy';
        if (measuring && e.x2 != null) {
          const s2 = vp.worldToScreen({ x: e.x2, y: e.y2 });
          const lp = (e.lx != null)
            ? vp.worldToScreen({ x: e.lx, y: e.ly })
            : { x: (s.x + s2.x) / 2, y: (s.y + s2.y) / 2 };
          drawParamDim(c2d, s, s2, lp, e.name || 'Distance');
          const acts2 = R.actionBars !== false ? paramActs(doc, e.name) : [];
          if (acts2.length) {
            const label2 = '⚡ ' + acts2.join(', ');
            const w2 = c2d.measureText(label2).width + 10;
            c2d.fillStyle = 'rgba(58,66,52,.92)';
            c2d.strokeStyle = '#c9c26a';
            c2d.beginPath();
            if (c2d.roundRect) c2d.roundRect(lp.x + 8, lp.y + 4, w2, 15, 3);
            else c2d.rect(lp.x + 8, lp.y + 4, w2, 15);
            c2d.fill();
            c2d.stroke();
            c2d.fillStyle = '#efe9a8';
            c2d.fillText(label2, lp.x + 13, lp.y + 12);
          }
          continue;
        }
        /* a two-point kind shows its own line: Flip its reflection line,
           Alignment its arrow */
        if (e.x2 != null && e.y2 != null) {
          const s2 = vp.worldToScreen({ x: e.x2, y: e.y2 });
          c2d.strokeStyle = '#37c8dc';
          c2d.lineWidth = 1;
          c2d.setLineDash(e.kind === 'flip' ? [5, 4] : [2, 3]);
          c2d.beginPath();
          c2d.moveTo(s.x, s.y);
          c2d.lineTo(s2.x, s2.y);
          c2d.stroke();
          c2d.setLineDash([]);
        }
        c2d.fillStyle = '#37c8dc';
        c2d.fillRect(s.x - 5, s.y - 5, 10, 10);
        c2d.strokeStyle = '#0d5560';
        c2d.lineWidth = 1;
        c2d.setLineDash([]);
        c2d.strokeRect(s.x - 5.5, s.y - 5.5, 11, 11);
        c2d.fillStyle = '#0f6b7a';
        c2d.fillText(e.name || 'Position', s.x + 9, s.y - 8);
        /* the ⚡ action bar: worn once an action is bound to this
           parameter, NAMING it, and put away by Hide All Actions */
        const acts = R.actionBars !== false ? paramActs(doc, e.name) : [];
        if (acts.length) {
          const label = '⚡ ' + acts.join(', ');
          const w = c2d.measureText(label).width + 10;
          c2d.fillStyle = 'rgba(58,66,52,.92)';
          c2d.strokeStyle = '#c9c26a';
          c2d.beginPath();
          if (c2d.roundRect) c2d.roundRect(s.x + 9, s.y + 2, w, 15, 3);
          else c2d.rect(s.x + 9, s.y + 2, w, 15);
          c2d.fill();
          c2d.stroke();
          c2d.fillStyle = '#efe9a8';
          c2d.fillText(label, s.x + 14, s.y + 10);
        }
        continue;
      }
      const b = B(e);
      if (!b) continue;
      const top = vp.worldToScreen({ x: (b.minx + b.maxx) / 2, y: b.maxy });
      if (Array.isArray(e.constraints) && e.constraints.length && !e.barHidden) {
        const glyphs = e.constraints.map((c) => GC_GLYPH[c.type] || '?').join(' ');
        const w = c2d.measureText(glyphs).width + 12;
        const x = top.x - w / 2, y = top.y - 22;
        c2d.fillStyle = 'rgba(38,72,120,.92)';
        c2d.strokeStyle = '#7aa7d9';
        c2d.lineWidth = 1;
        c2d.setLineDash([]);
        c2d.beginPath();
        if (c2d.roundRect) c2d.roundRect(x, y, w, 16, 4); else c2d.rect(x, y, w, 16);
        c2d.fill();
        c2d.stroke();
        c2d.fillStyle = '#dce9fa';
        c2d.fillText(glyphs, x + 6, y + 8);
      }
      if (Array.isArray(e.dimcon)) {
        const mid = vp.worldToScreen({ x: (b.minx + b.maxx) / 2, y: (b.miny + b.maxy) / 2 });
        e.dimcon.forEach((r, i) => {
          const label = r.name + '=' + (Math.round(r.val * 10000) / 10000) +
            (r.kind === 'angular' ? '°' : '');
          c2d.fillStyle = '#0e7d86';
          c2d.fillText(label, mid.x + 8, mid.y + 14 + i * 14);
        });
      }
      /* hidden in the visibility state being edited: say so on the spot */
      const vis = inEd && R.vis && R.vis.current;
      if (vis && Array.isArray(e.hideIn) && e.hideIn.indexOf(vis) >= 0) {
        const mid = vp.worldToScreen({ x: (b.minx + b.maxx) / 2, y: (b.miny + b.maxy) / 2 });
        c2d.fillStyle = 'rgba(120,126,134,.95)';
        c2d.fillText('(hidden in ' + vis + ')', mid.x + 8, mid.y - 10);
        const a2 = vp.worldToScreen({ x: b.minx, y: b.miny });
        const q2 = vp.worldToScreen({ x: b.maxx, y: b.maxy });
        c2d.strokeStyle = 'rgba(120,126,134,.8)';
        c2d.setLineDash([3, 3]);
        c2d.lineWidth = 1;
        c2d.strokeRect(Math.min(a2.x, q2.x) - 2, Math.min(a2.y, q2.y) - 2,
          Math.abs(q2.x - a2.x) + 4, Math.abs(q2.y - a2.y) + 4);
        c2d.setLineDash([]);
      }
      if (inEd && R.statusMode &&
          !(Array.isArray(e.constraints) && e.constraints.length) &&
          !(Array.isArray(e.dimcon) && e.dimcon.length)) {
        const a = vp.worldToScreen({ x: b.minx, y: b.miny });
        const q = vp.worldToScreen({ x: b.maxx, y: b.maxy });
        c2d.strokeStyle = 'rgba(220,150,40,.9)';
        c2d.setLineDash([4, 3]);
        c2d.lineWidth = 1;
        c2d.strokeRect(Math.min(a.x, q.x) - 3, Math.min(a.y, q.y) - 3,
          Math.abs(q.x - a.x) + 6, Math.abs(q.y - a.y) + 6);
      }
    }
    c2d.restore();
  };

  /* TRIM's red ✕ on the cursor: what is under it is about to be removed */
  const drawKillMark = (c2d) => {
    const s = Nasj.ui.cursor.screen;
    const x = Math.round(s.x) + 0.5, y = Math.round(s.y) + 0.5;
    const a = 5;                       /* arm length, just inside the pickbox */
    c2d.save();
    c2d.lineCap = 'round';
    c2d.setLineDash([]);
    c2d.beginPath();
    c2d.moveTo(x - a, y - a); c2d.lineTo(x + a, y + a);
    c2d.moveTo(x + a, y - a); c2d.lineTo(x - a, y + a);
    c2d.strokeStyle = 'rgba(0,0,0,.55)';  /* keeps it readable over geometry */
    c2d.lineWidth = 3.5;
    c2d.stroke();
    c2d.strokeStyle = '#ff3b30';
    c2d.lineWidth = 1.8;
    c2d.stroke();
    c2d.restore();
  };

  /* polar / parallel tracking vector: dashed ray from the base through the
     locked point out to the edge of the view (the industry standard's green vector) */
  const drawTrackVector = (c2d, tr) => {
    const A = vp.worldToScreen(tr.base), B = vp.worldToScreen(tr.point);
    let dx = B.x - A.x, dy = B.y - A.y;
    const L = Math.hypot(dx, dy);
    if (L < 1e-6) return;
    dx /= L; dy /= L;
    const far = cssW + cssH;
    c2d.save();
    c2d.strokeStyle = COL.track;
    c2d.lineWidth = 1;
    c2d.setLineDash([4, 4]);
    c2d.beginPath();
    c2d.moveTo(A.x, A.y);
    c2d.lineTo(A.x + dx * far, A.y + dy * far);
    c2d.stroke();
    c2d.restore();
  };

  /* dynamic-input construction frame while rubber-banding from a base point:
     dotted aligned-dimension offset lines + the angle arc from +X (the industry standard) */
  const drawDynFrame = (c2d, dgeo) => {
    const A = vp.worldToScreen(dgeo.base), B = vp.worldToScreen(dgeo.p);
    const dx = B.x - A.x, dy = B.y - A.y;
    const L = Math.hypot(dx, dy);
    if (L < 30) return;
    const ux = dx / L, uy = dy / L;
    const nx = uy, ny = -ux; /* world-left of the direction of travel */
    const dot = (px, py) => {
      c2d.beginPath();
      c2d.arc(px, py, 1.6, 0, TAU);
      c2d.fill();
    };
    c2d.save();
    c2d.strokeStyle = COL.dynDim;
    c2d.fillStyle = COL.dynDim;
    c2d.lineWidth = 1;
    c2d.lineCap = 'round';
    const off = 24;
    c2d.setLineDash([1.5, 4.5]);
    c2d.beginPath();
    /* extension ticks at both ends + the offset dimension line */
    c2d.moveTo(A.x + nx * 6, A.y + ny * 6);
    c2d.lineTo(A.x + nx * (off + 6), A.y + ny * (off + 6));
    c2d.moveTo(B.x + nx * 6, B.y + ny * 6);
    c2d.lineTo(B.x + nx * (off + 6), B.y + ny * (off + 6));
    c2d.moveTo(A.x + nx * off, A.y + ny * off);
    c2d.lineTo(B.x + nx * off, B.y + ny * off);
    /* +X reference ray and the angle arc through the cursor end */
    const a = Math.atan2(-dy, dx); /* world angle: screen y is flipped */
    if (Math.abs(a) > 0.02) {
      c2d.moveTo(A.x + 14, A.y);
      c2d.lineTo(A.x + L, A.y);
      c2d.stroke();
      c2d.beginPath();
      c2d.arc(A.x, A.y, L, 0, -a, a > 0); /* screen angle = -world angle */
      c2d.stroke();
    } else c2d.stroke();
    c2d.setLineDash([]);
    dot(A.x + nx * off, A.y + ny * off);
    dot(B.x + nx * off, B.y + ny * off);
    if (Math.abs(a) > 0.02) { dot(A.x + L, A.y); dot(B.x, B.y); }
    c2d.restore();
  };

  /* RECTANG's dynamic-input frame: dotted offset lines along the two sides
     the length/width boxes measure, so each box reads against its own edge */
  const drawDynBox = (c2d, bx) => {
    const co = Math.cos(bx.rot), si = Math.sin(bx.rot);
    const scr = (x, y) => vp.worldToScreen({
      x: bx.a.x + x * co - y * si, y: bx.a.y + x * si + y * co
    });
    const x0 = Math.min(0, bx.rel.x), x1 = Math.max(0, bx.rel.x);
    const y0 = Math.min(0, bx.rel.y), y1 = Math.max(0, bx.rel.y);
    const P00 = scr(x0, y0), P10 = scr(x1, y0), P01 = scr(x0, y1), P11 = scr(x1, y1);
    if (Math.hypot(P11.x - P00.x, P11.y - P00.y) < 40) return;
    const mid = { x: (P00.x + P11.x) / 2, y: (P00.y + P11.y) / 2 };
    const off = 30;
    c2d.save();
    c2d.strokeStyle = 'rgba(190,190,190,.75)';
    c2d.fillStyle = 'rgba(190,190,190,.9)';
    c2d.lineWidth = 1;
    c2d.lineCap = 'round';
    c2d.setLineDash([1.5, 4.5]);
    c2d.beginPath();
    const side = (A, B) => {                 /* dimension line outside the edge */
      const mx = (A.x + B.x) / 2 - mid.x, my = (A.y + B.y) / 2 - mid.y;
      const L = Math.hypot(mx, my) || 1;
      const nx = mx / L, ny = my / L;
      c2d.moveTo(A.x + nx * 5, A.y + ny * 5);
      c2d.lineTo(A.x + nx * (off + 6), A.y + ny * (off + 6));
      c2d.moveTo(B.x + nx * 5, B.y + ny * 5);
      c2d.lineTo(B.x + nx * (off + 6), B.y + ny * (off + 6));
      c2d.moveTo(A.x + nx * off, A.y + ny * off);
      c2d.lineTo(B.x + nx * off, B.y + ny * off);
    };
    side(P00, P10);                          /* bottom edge: the length */
    side(P00, P01);                          /* left edge: the width */
    c2d.stroke();
    c2d.setLineDash([]);
    c2d.restore();
  };

  /* canvas fallback for the "Polar: d < a°" tooltip when dynamic input is off */
  const drawTrackTip = (c2d, tr) => {
    const s = Nasj.ui.cursor.screen;
    const label = (tr.kind === 'par' ? 'Parallel'
      : tr.kind === 'trk' ? 'Track' : 'Polar') +
      ': ' + fmtLen(tr.dist) + ' < ' +
      (tr.axis ? tr.axis : fmtAng(tr.ang / DEG, true));
    c2d.save();
    c2d.font = '11px "Segoe UI", sans-serif';
    const w = c2d.measureText(label).width + 12;
    const x = s.x + 14, y = s.y + 22;
    c2d.fillStyle = '#d4d4d4';
    c2d.strokeStyle = '#555';
    c2d.lineWidth = 1;
    c2d.fillRect(x, y, w, 18);
    c2d.strokeRect(x + 0.5, y + 0.5, w, 18);
    c2d.fillStyle = '#1c1c1c';
    c2d.fillText(label, x + 6, y + 13);
    c2d.restore();
  };

  /* NO CONTENT PREVIEW UNDER THE MARQUEE. While the rectangle was dragged,
     everything it covered was repainted toward the selection accent — a
     light thrown over the whole drawing under the box, including the
     objects a window would never take, since only what falls wholly
     inside it is selected. The industry standard shows the selection area and nothing
     else: a translucent rectangle with its border, drawn below, and the
     drawing keeps its own colours until something is actually selected. */

  Nasj.renderOverlay = () => {
    if (!octx) return;
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, cssW, cssH);
    /* the save/restore bracketing this pass rolls the context's font back
       to the default at the end — so the cache MUST forget too, or the
       next pass skips setting the font and a preview's text (a SCALE
       ghost, a TEXT being placed) draws 10px tall from the second frame
       on, which reads as the ghost simply not being there */
    resetFontCache();
    const ui = Nasj.ui;
    /* ---------------------------------------------------------------- *
     * THE CROSSHAIR WHILE A DRAWING LOADS — drawn by the OS, not by us.
     *
     * Everything this pass puts on the canvas is drawn by THIS thread, and
     * a thread that is busy cannot draw: through an open the crosshair
     * froze and jumped, however small the slices got, because the paint
     * side of it was always behind whatever the load was doing. So for the
     * length of the load the drawing area wears a native `crosshair`
     * cursor — the compositor moves that one, at the display's rate,
     * whatever this thread is up to — and the drawn crosshair stands
     * down. The hotspot is the same point, so nothing under the cursor
     * shifts; the handover is one style write and one paint inside a
     * single task, so no frame ever shows both crosshairs or neither.
     * The pan/orbit/other-tile cursors are left exactly as they were:
     * only the empty style (which is `cursor: none` from the sheet, i.e.
     * "the drawn crosshair is the cursor") is ever taken over.
     * ---------------------------------------------------------------- */
    const osCross = !!(Nasj.doc && Nasj.doc.loading);
    if (osCross) {
      if (overlay.style.cursor === '') overlay.style.cursor = 'crosshair';
    } else if (overlay.style.cursor === 'crosshair') overlay.style.cursor = '';
    /* everything the overlay draws — previews, grips, snap marks, the
       crosshair — belongs to the viewport the pointer is working in, and
       stops at its edge when model space is split */
    octx.save();
    if (tiled()) clipToRect(octx, activeRect());

    /* HOVER HIGHLIGHT. Used to ride the scene canvas — every id change
       recomposed the GL frame and restroked a library insert's children.
       The overlay already clears every move, so the highlight lives here,
       cached per id+view the way ghostDim is: same entity, same view is
       one drawImage. Pan/orbit hide it (the picture is moving). */
    if (ui.hoverId != null && Nasj.doc && !Nasj.doc.loading &&
        !pan.active && !orbit.active) {
      const hent = Nasj.docOps.entityById(Nasj.doc, ui.hoverId);
      if (hent) {
        const hkey = ui.hoverId + '|' + vp.scale + '|' + vp.tx + '|' + vp.ty + '|' +
          (vp.twist || 0) + '|' + overlay.width + 'x' + overlay.height + '|' +
          (Nasj.docGen ? Nasj.docGen(Nasj.doc) : 0) + '|' +
          ((Nasj.selection instanceof Set && Nasj.selection.has(ui.hoverId)) ? 1 : 0);
        if (!hovLayer || hovLayer.key !== hkey) {
          if (!hovLayer) hovLayer = { cv: document.createElement('canvas'), key: '' };
          const cv = hovLayer.cv;
          if (cv.width !== overlay.width || cv.height !== overlay.height) {
            cv.width = overlay.width; cv.height = overlay.height;
          }
          const hx = cv.getContext('2d');
          hx.setTransform(1, 0, 0, 1, 0, 0);
          hx.clearRect(0, 0, cv.width, cv.height);
          hx.setTransform(octx.getTransform());
          drawHoverEntity(hx, Nasj.doc, hent);
          hovLayer.key = hkey;
        }
        octx.save();
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.drawImage(hovLayer.cv, 0, 0);
        octx.restore();
      }
    } else if (hovLayer) { hovLayer.key = ''; }

    /* AREA's shading: the ring being traced, filled the way the industry standard fills it
       — green for area going into the total, red for area coming off.
       ui.areaShade = [{pts:[...world], sub}], drawn under the rubber band. */
    if (Array.isArray(ui.areaShade) && ui.areaShade.length) {
      octx.save();
      octx.setLineDash([]);
      octx.lineWidth = 1;
      octx.strokeStyle = COL.preview;
      for (const ring of ui.areaShade) {
        if (!ring || !ring.pts || ring.pts.length < 3) continue;
        octx.beginPath();
        ring.pts.forEach((p, i) => {
          const S = vp.worldToScreen(p);
          if (i) octx.lineTo(S.x, S.y); else octx.moveTo(S.x, S.y);
        });
        octx.closePath();
        octx.fillStyle = ring.sub ? COL.areaSub : COL.areaAdd;
        octx.fill();
        octx.stroke();
      }
      octx.restore();
    }

    /* THE MODIFY DRAG'S FAINT ORIGINALS (ui.ghostDim): the industry standard dims what a
       drag is about to replace. The originals are hidden from the scene
       (hiddenIds — which the GL layer honours too) and redrawn here, over
       everything, at a whisper of their own colours — so the full-tone
       preview beside them reads as THE shape being decided. */
    /* THEY DO NOT MOVE. The originals stand still for the whole drag — it is
       the preview beside them that follows the cursor — so their pixels are
       drawn ONCE into a layer of their own and blitted after that, and the
       drag stops paying to re-stroke them every frame (5,000 of them was
       most of SCALE's frame). The layer is keyed on the list, the viewport
       and the canvas size: pan, zoom or a new selection and it is redrawn,
       exactly as before, at exactly the same pixels. */
    if (ui.ghostDim && ui.ghostDim.length) {
      const gdoc = Nasj.doc;
      const key = ui.ghostDim.length + '|' + vp.scale + '|' + vp.tx + '|' + vp.ty + '|' +
        (vp.twist || 0) + '|' + overlay.width + 'x' + overlay.height + '|' +
        (Nasj.docGen ? Nasj.docGen(gdoc) : 0);
      if (!dimLayer || dimLayer.key !== key || dimLayer.list !== ui.ghostDim) {
        if (!dimLayer) dimLayer = { cv: document.createElement('canvas'), key: '', list: null };
        const cv = dimLayer.cv;
        if (cv.width !== overlay.width || cv.height !== overlay.height) {
          cv.width = overlay.width; cv.height = overlay.height;
        }
        const dx = cv.getContext('2d');
        dx.setTransform(1, 0, 0, 1, 0, 0);
        dx.clearRect(0, 0, cv.width, cv.height);
        dx.setTransform(octx.getTransform());
        for (const ent of ui.ghostDim) {
          strokeEntity(dx, ent, Nasj.docOps.resolveColor(gdoc, ent), 1.4, null, 0.22, true);
        }
        dimLayer.key = key;
        dimLayer.list = ui.ghostDim;
      }
      octx.save();
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.drawImage(dimLayer.cv, 0, 0);
      octx.restore();
    } else if (dimLayer) { dimLayer.list = null; dimLayer.key = ''; }

    /* rubber-band previews from tools; hatch previews draw their real
       pattern (primary pass) so hovering an area shows the actual fill */
    if (ui.preview && ui.preview.length) {
      for (const ent of ui.preview) {
        if (ent.type === '@xfblit') {
          /* THE UNIFIED GHOST SOURCE, 2D EDITION. A whole-selection drag's
             content is already a picture — the scene bitmap — so the ghost
             is that bitmap drawn through the drag affine: one drawImage per
             frame, complete from frame 1, where the classic path stroked
             1,500 clones per frame (a SwiftShader session never finished
             one). Three bitmap corners map capture→world→affine→screen
             (worldToScreen carries the live twist), which is the whole
             transform, exactly. */
          const st = sceneState;
          if (st && sceneCanvas && st.doc === Nasj.doc && !(st.tw || 0) &&
              Array.isArray(ent.m) && ent.m.length >= 6) {
            const m = ent.m;
            const sc = st.scale, bx = st.tx + scenePadX(), by = st.ty + scenePadY();
            const sh = st.h + 2 * scenePadY();
            const mapPt = (u, v) => {
              const wx = (u / dpr - bx) / sc;
              const wy = (sh - v / dpr - by) / sc;
              return vp.worldToScreen({
                x: m[0] * wx + m[2] * wy + m[4],
                y: m[1] * wx + m[3] * wy + m[5]
              });
            };
            const p0 = mapPt(0, 0), p1 = mapPt(1, 0), p2 = mapPt(0, 1);
            octx.save();
            octx.setTransform(dpr, 0, 0, dpr, 0, 0);
            octx.transform(p1.x - p0.x, p1.y - p0.y, p2.x - p0.x, p2.y - p0.y,
              p0.x, p0.y);
            octx.globalAlpha = 0.65;
            octx.drawImage(sceneCanvas, 0, 0);
            octx.restore();
          }
          continue;
        }
        if (ent.facehl && ent.type === 'solid' && ent.faces) {
          /* SOLIDEDIT's face highlight: the hovered or picked face fills
             industry-standard-blue — a dashed outline alone vanishes on a shaded
             body. worldToScreen carries z in a 3D view, so the polygon
             lands exactly on the face the eye sees. */
          octx.save();
          octx.globalAlpha = ent.facehl === 'hover' ? 0.55 : 1;
          for (const f of ent.faces) {
            octx.beginPath();
            for (const ring of [f.pts].concat(f.holes || [])) {
              ring.forEach((p, i) => {
                const s = vp.worldToScreen(p);
                if (i) octx.lineTo(s.x, s.y); else octx.moveTo(s.x, s.y);
              });
              octx.closePath();
            }
            octx.fillStyle = COL.accentSoft;
            octx.fill('evenodd');
            octx.strokeStyle = COL.accentBright;
            octx.lineWidth = ent.facehl === 'hover' ? 1 : 1.6;
            octx.setLineDash([]);
            octx.stroke();
          }
          octx.restore();
          continue;
        }
        if (ent.edgehl && ent.type === 'polyline' && ent.pts) {
          /* an EDGE picked off a body (LOFT's Join multiple edges): the edge
             alone, AutoCAD-blue and solid, the body left as it is */
          octx.save();
          octx.beginPath();
          ent.pts.forEach((p, i) => {
            const s = vp.worldToScreen(p);
            if (i) octx.lineTo(s.x, s.y); else octx.moveTo(s.x, s.y);
          });
          if (ent.closed) octx.closePath();
          octx.strokeStyle = COL.accentBright;
          octx.lineWidth = 2.2;
          octx.setLineDash([]);
          octx.stroke();
          octx.restore();
          continue;
        }
        if (ent.type === 'solid' && Array.isArray(ent.faces) && shaded3d()) {
          /* a body being made (EXTRUDE, REVOLVE, LOFT, the primitives)
             previews shaded, as AutoCAD's does: its faces lit and painted
             far to near in the colour it will take, not a dashed cage */
          drawPreviewBody(octx, ent);
          continue;
        }
        if (ent.type !== 'hatch') {
          strokeEntity(octx, ent, COL.preview, 1, [5, 4], 1, false);
          continue;
        }
        /* the fill as it will really look, then the traced edge dashed over it
           — a placed hatch has no outline, but the one being aimed at wants one */
        const pc = (ent.color && ent.color !== 'ByLayer') ? ent.color : COL.preview;
        strokeEntity(octx, ent, pc, 1, [5, 4], 1, true);
        strokeEntity(octx, Nasj.geom.hatchBoundary(ent), COL.preview, 1, [5, 4], 1, false);
      }
    }

    if (!view3d.active) {
      if (ui.polarTrack) drawTrackVector(octx, ui.polarTrack);
      /* OTRACK: the little + on each acquired point, as the industry standard leaves */
      if (Nasj.settings.otrack && Nasj.acqTrackPoints && Nasj.acqTrackPoints.length &&
          Nasj.tools && Nasj.tools.awaiting !== 'none') {
        octx.save();
        octx.strokeStyle = COL.track;
        octx.lineWidth = 1;
        octx.setLineDash([]);
        octx.beginPath();
        for (const q of Nasj.acqTrackPoints) {
          const s = vp.worldToScreen(q);
          const x = Math.round(s.x) + 0.5, y = Math.round(s.y) + 0.5;
          octx.moveTo(x - 4, y); octx.lineTo(x + 4, y);
          octx.moveTo(x, y - 4); octx.lineTo(x, y + 4);
        }
        octx.stroke();
        octx.restore();
      }
      if (ui.snapMark && ui.snapMark.from) { /* extension: dotted lead-in */
        const F = vp.worldToScreen(ui.snapMark.from);
        const M = vp.worldToScreen(ui.snapMark);
        octx.save();
        octx.strokeStyle = 'rgba(190,190,190,.7)';
        octx.lineWidth = 1;
        octx.setLineDash([2, 4]);
        octx.beginPath();
        octx.moveTo(F.x, F.y);
        octx.lineTo(M.x, M.y);
        octx.stroke();
        octx.restore();
      }
      if (Nasj.settings.dyn && ui.dyn && ui.dyn.base && ui.dyn.p) drawDynFrame(octx, ui.dyn);
      if (Nasj.settings.dyn && ui.dynBox) drawDynBox(octx, ui.dynBox);
      if (!Nasj.settings.dyn && ui.polarTrack && pointerInside) drawTrackTip(octx, ui.polarTrack);
    }

    /* selection rectangle (a/b in world coords): chrome only */
    if (ui.selRect && ui.selRect.a && ui.selRect.b) {
      /* the cursor's own pixels when the tool kept them: a side-on 3D view
         collapses the ground plane, and only the kept pixels still span
         the rectangle the user is dragging. In plan the world corners stay
         authoritative — they survive a mid-drag wheel zoom. */
      const scr = view3d.active && ui.selRect.scrA && ui.selRect.scrB;
      const a = scr ? ui.selRect.scrA : vp.worldToScreen(ui.selRect.a);
      const b = scr ? ui.selRect.scrB : vp.worldToScreen(ui.selRect.b);
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      const crossing = !!ui.selRect.crossing;
      octx.save();
      octx.fillStyle = crossing ? COL.selCrossing : COL.selWindow;
      octx.fillRect(x, y, w, h);
      octx.strokeStyle = crossing ? COL.selCrossingBorder : COL.selWindowBorder;
      octx.lineWidth = 1;
      octx.setLineDash(crossing ? [4, 3] : []);
      octx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
      octx.restore();
    }

    /* 3DFORBIT's arcball, in screen pixels: the ring and the four handles
       that lock a turn to one axis. The one under the cursor lights up. */
    if (ui.arcball) {
      const b = ui.arcball;
      const hr = Math.max(10, b.r * 0.11);
      octx.save();
      octx.lineWidth = 1;
      octx.setLineDash([]);
      octx.strokeStyle = b.hot === 'roll' ? COL.accentBright : 'rgba(190,196,204,.75)';
      octx.beginPath();
      octx.arc(b.cx, b.cy, b.r, 0, Math.PI * 2);
      octx.stroke();
      const handles = [
        ['az', b.cx - b.r, b.cy], ['az', b.cx + b.r, b.cy],
        ['el', b.cx, b.cy - b.r], ['el', b.cx, b.cy + b.r]
      ];
      for (const [kind, x, y] of handles) {
        octx.beginPath();
        octx.arc(x, y, hr, 0, Math.PI * 2);
        octx.fillStyle = COL.bg;
        octx.fill();
        octx.strokeStyle = b.hot === kind ? COL.accentBright : 'rgba(190,196,204,.75)';
        octx.stroke();
      }
      octx.restore();
    }

    /* ZOOM Dynamic's screen: the drawing extents, the view we came from,
       and the view box — an X while it is being moved, an arrow at the edge
       that follows while it is being sized */
    if (ui.zoomDyn) {
      const d = ui.zoomDyn;
      const box = (r) => {
        const a = vp.worldToScreen({ x: r.minx, y: r.miny });
        const b = vp.worldToScreen({ x: r.maxx, y: r.maxy });
        return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
          w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
      };
      octx.save();
      octx.lineWidth = 1;
      const E = box(d.ext);
      octx.strokeStyle = COL.accentBright;
      octx.setLineDash([6, 4]);
      octx.strokeRect(Math.round(E.x) + 0.5, Math.round(E.y) + 0.5, Math.round(E.w), Math.round(E.h));
      const V = box(d.view);
      octx.strokeStyle = COL.selCrossingBorder;
      octx.setLineDash([3, 3]);
      octx.strokeRect(Math.round(V.x) + 0.5, Math.round(V.y) + 0.5, Math.round(V.w), Math.round(V.h));
      const B = box({ minx: d.cx - d.w / 2, miny: d.cy - d.h / 2,
        maxx: d.cx + d.w / 2, maxy: d.cy + d.h / 2 });
      octx.setLineDash([]);
      octx.strokeStyle = COL.crosshair;
      octx.strokeRect(Math.round(B.x) + 0.5, Math.round(B.y) + 0.5, Math.round(B.w), Math.round(B.h));
      const s = Math.max(4, Math.min(12, B.w / 2, B.h / 2));
      octx.beginPath();
      if (d.mode === 'size') {
        const y = B.y + B.h / 2, x = B.x + B.w - 3;
        octx.moveTo(x - 2 * s, y);
        octx.lineTo(x, y);
        octx.moveTo(x - s * 0.8, y - s * 0.5);
        octx.lineTo(x, y);
        octx.lineTo(x - s * 0.8, y + s * 0.5);
      } else {
        const cx = B.x + B.w / 2, cy = B.y + B.h / 2;
        octx.moveTo(cx - s, cy - s); octx.lineTo(cx + s, cy + s);
        octx.moveTo(cx + s, cy - s); octx.lineTo(cx - s, cy + s);
      }
      octx.stroke();
      octx.restore();
    }

    /* the press-drag lasso: the same window/crossing colours, but the shape
       is the path the cursor walked, closed back to where it started */
    if (ui.selLasso && ui.selLasso.pts && ui.selLasso.pts.length > 1) {
      const pts = (view3d.active && ui.selLasso.scr && ui.selLasso.scr.length > 1)
        ? ui.selLasso.scr : ui.selLasso.pts.map((p) => vp.worldToScreen(p));
      const crossing = !!ui.selLasso.crossing;
      octx.save();
      octx.beginPath();
      octx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
      octx.closePath();
      octx.fillStyle = crossing ? COL.selCrossing : COL.selWindow;
      octx.fill();
      octx.strokeStyle = crossing ? COL.selCrossingBorder : COL.selWindowBorder;
      octx.lineWidth = 1;
      octx.setLineDash(crossing ? [4, 3] : []);
      octx.stroke();
      octx.restore();
    }

    /* grips a running tool puts up (ARRAYRECT's count/spacing handles).
       ui.toolGrips: [{x, y, shape:'square'|'up'|'right', hot}] in world space. */
    /* MEASUREGEOM Quick: dimensions and right-angle marks that follow the
       cursor. ui.qmeasure = {dims:[{a,b,text}], corners:[{p,u,v}]} in world. */
    if (ui.qmeasure && (ui.qmeasure.dims || ui.qmeasure.corners || ui.qmeasure.arcs)) {
      const qm = ui.qmeasure;
      octx.save();
      octx.strokeStyle = COL.qmeasure;
      octx.fillStyle = COL.qmeasure;
      octx.lineWidth = 1;
      octx.setLineDash([]);
      octx.font = '12px "Segoe UI", sans-serif';
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      for (const dm of (qm.dims || [])) {
        const A = vp.worldToScreen(dm.a), B = vp.worldToScreen(dm.b);
        const dx = B.x - A.x, dy = B.y - A.y;
        const L = Math.hypot(dx, dy);
        if (L < 2) continue;
        const ux = dx / L, uy = dy / L;
        const nx = -uy, ny = ux;                 /* the tick direction */
        octx.beginPath();
        octx.moveTo(A.x, A.y);
        octx.lineTo(B.x, B.y);
        octx.moveTo(A.x - nx * 4, A.y - ny * 4); /* end ticks */
        octx.lineTo(A.x + nx * 4, A.y + ny * 4);
        octx.moveTo(B.x - nx * 4, B.y - ny * 4);
        octx.lineTo(B.x + nx * 4, B.y + ny * 4);
        octx.stroke();
        if (dm.text) {                           /* the number sits on the line */
          /* dm.t slides it along, so two crossing dimensions do not collide */
          const t = (typeof dm.t === 'number') ? dm.t : 0.5;
          const mx = A.x + dx * t, my = A.y + dy * t;
          const w = octx.measureText(dm.text).width;
          octx.save();
          octx.fillStyle = COL.bg;
          octx.fillRect(mx - w / 2 - 3, my - 8, w + 6, 16);
          octx.restore();
          octx.fillText(dm.text, mx, my);
        }
      }
      /* MEASUREGEOM Angle: the dotted arc between the two picked sides,
         with the angle sitting just outside its middle */
      for (const ar of (qm.arcs || [])) {
        const C = vp.worldToScreen(ar.c);
        const E = vp.worldToScreen({ x: ar.c.x + ar.r, y: ar.c.y });
        const rPx = Math.hypot(E.x - C.x, E.y - C.y);
        if (rPx < 2) continue;
        octx.setLineDash([2, 3]);
        octx.beginPath();
        /* world CCW sweep; the screen's y flip mirrors the angles */
        octx.arc(C.x, C.y, rPx, -ar.a0, -ar.a1, true);
        octx.stroke();
        octx.setLineDash([]);
        if (ar.text) {
          const am = (ar.a0 + ar.a1) / 2;
          const P = vp.worldToScreen({
            x: ar.c.x + Math.cos(am) * ar.r,
            y: ar.c.y + Math.sin(am) * ar.r,
          });
          const ox = P.x - C.x, oy = P.y - C.y;
          const oL = Math.hypot(ox, oy) || 1;
          const tx = C.x + ox + (ox / oL) * 16, ty = C.y + oy + (oy / oL) * 16;
          const wTxt = octx.measureText(ar.text).width;
          octx.save();
          octx.fillStyle = COL.bg;
          octx.fillRect(tx - wTxt / 2 - 3, ty - 8, wTxt + 6, 16);
          octx.restore();
          octx.fillText(ar.text, tx, ty);
        }
      }
      /* the little square the industry standard parks in a 90-degree corner */
      for (const c of (qm.corners || [])) {
        const P = vp.worldToScreen(c.p);
        const U = vp.worldToScreen({ x: c.p.x + c.u.x, y: c.p.y + c.u.y });
        const V = vp.worldToScreen({ x: c.p.x + c.v.x, y: c.p.y + c.v.y });
        const un = Math.hypot(U.x - P.x, U.y - P.y) || 1;
        const vn = Math.hypot(V.x - P.x, V.y - P.y) || 1;
        const s = 9;
        const ux2 = (U.x - P.x) / un * s, uy2 = (U.y - P.y) / un * s;
        const vx2 = (V.x - P.x) / vn * s, vy2 = (V.y - P.y) / vn * s;
        octx.beginPath();
        octx.moveTo(P.x + ux2, P.y + uy2);
        octx.lineTo(P.x + ux2 + vx2, P.y + uy2 + vy2);
        octx.lineTo(P.x + vx2, P.y + vy2);
        octx.stroke();
      }
      octx.restore();
    }

    if (Array.isArray(ui.toolGrips) && ui.toolGrips.length) {
      octx.save();
      octx.strokeStyle = '#ffffff';
      octx.lineWidth = 1;
      octx.setLineDash([]);
      for (const g of ui.toolGrips) {
        const s = vp.worldToScreen(g);
        if (s.x < -12 || s.y < -12 || s.x > cssW + 12 || s.y > cssH + 12) continue;
        octx.fillStyle = g.hot ? COL.gripHot : COL.grip;
        octx.beginPath();
        if (g.shape === 'up') {                    /* add rows */
          octx.moveTo(s.x, s.y - 5.5);
          octx.lineTo(s.x + 5, s.y + 4);
          octx.lineTo(s.x - 5, s.y + 4);
          octx.closePath();
        } else if (g.shape === 'right') {          /* add columns */
          octx.moveTo(s.x + 5.5, s.y);
          octx.lineTo(s.x - 4, s.y + 5);
          octx.lineTo(s.x - 4, s.y - 5);
          octx.closePath();
        } else if (g.shape === 'down') {
          /* a loft's menu grips: AutoCAD's — a square on the point and a
             fat arrowhead beside it, big enough to read on a shaded body */
          octx.rect(Math.round(s.x - 3.5) + 0.5, Math.round(s.y - 3.5) + 0.5, 7, 7);
          octx.fill(); octx.stroke();
          /* the round amber badge AutoCAD sets between the square and the arrow */
          octx.beginPath();
          octx.arc(s.x + 13, s.y + 1, 4.5, 0, Math.PI * 2);
          octx.fillStyle = '#e0a83a';
          octx.fill(); octx.stroke();
          octx.beginPath();
          octx.fillStyle = g.hot ? COL.gripHot : COL.grip;
          octx.moveTo(s.x + 25, s.y + 9);
          octx.lineTo(s.x + 32, s.y - 4);
          octx.lineTo(s.x + 18, s.y - 4);
          octx.closePath();
          octx.lineWidth = 1.5;
        } else if (g.shape === 'diamond') {        /* path array base */
          octx.moveTo(s.x, s.y - 5.5);
          octx.lineTo(s.x + 5.5, s.y);
          octx.lineTo(s.x, s.y + 5.5);
          octx.lineTo(s.x - 5.5, s.y);
          octx.closePath();
        } else {
          octx.rect(Math.round(s.x - 3.5) + 0.5, Math.round(s.y - 3.5) + 0.5, 7, 7);
        }
        octx.fill();
        octx.stroke();
      }
      octx.restore();
    }

    /* STRETCH's flexible mode: the bounding box of a wholly-selected shape
       and the eight handles that stretch it. Tools owns the geometry; this
       only draws what it put in ui.stretchBox, and the handle under the
       cursor paints red like a hot grip. */
    if (ui.stretchBox) {
      const sb = ui.stretchBox;
      const a = vp.worldToScreen({ x: sb.minx, y: sb.miny });
      const b = vp.worldToScreen({ x: sb.maxx, y: sb.maxy });
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      octx.save();
      octx.strokeStyle = COL.accentSoft;
      octx.lineWidth = 1;
      octx.setLineDash([6, 4]);
      octx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
      octx.setLineDash([]);
      octx.strokeStyle = '#ffffff';
      for (const hd of (sb.handles || [])) {
        const s = vp.worldToScreen(hd);
        const hx = Math.round(s.x - 4.5) + 0.5, hy = Math.round(s.y - 4.5) + 0.5;
        octx.fillStyle = (sb.hot === hd.i) ? COL.gripHot : COL.accentBright;
        octx.fillRect(hx, hy, 9, 9);
        octx.strokeRect(hx, hy, 9, 9);
      }
      octx.restore();
    }

    /* grips for selected entities (hot grip drawn red, industry-standard-style).
       BIG SELECTIONS SHOW NO GRIPS — the industry standard's own GRIPOBJLIMIT rule. A
       column detail selected whole put tens of thousands of grips on the
       overlay, redrawn on EVERY mouse move; past the limit the selection
       highlight alone says "selected", which is exactly what the industry standard does.
       Under the limit, grips batch into two paths (cold, hot) and off-screen
       grips are skipped — per-grip fillRect/strokeRect pairs were the cost. */
    const doc = Nasj.doc;
    const sel = Nasj.selection instanceof Set ? Nasj.selection : null;
    /* OPTIONS (Selection tab): Show grips, the grip size, and the limit */
    const gripLimit = (Nasj.opt && Nasj.opt.gripLimit > 0) ? Nasj.opt.gripLimit : GRIP_OBJ_LIMIT;
    const gripsOn = !(Nasj.opt && Nasj.opt.showGrips === false);
    if (doc && sel && sel.size && gripsOn && !ui.stretchBox && sel.size <= gripLimit) {
      const hot = ui.hotGrip;
      /* the industry standard's multi-grip stretch: Shift-clicked grips stay hot ("warm")
         until one of them is dragged; they paint hot alongside the hot grip */
      const warm = Array.isArray(ui.warmGrips) ? ui.warmGrips : [];
      const GPX = gripPx();
      const GH = GPX / 2;
      octx.save();
      octx.strokeStyle = '#ffffff';
      octx.lineWidth = 1;
      octx.setLineDash([]);
      const cold = new Path2D();
      const hotP = new Path2D();
      let anyHot = false;
      const W = cssW, H = cssH;
      for (const id of sel) {
        const ent = Nasj.docOps.entityById(doc, id);
        if (!ent) continue;
        for (const sp of gripPointsOf(ent)) {
          if (!GRIP_KINDS[sp.kind]) continue;
          const s = vp.worldToScreen(sp);
          if (s.x < -8 || s.y < -8 || s.x > W + 8 || s.y > H + 8) continue;
          const gx = Math.round(s.x - GH) + 0.5, gy = Math.round(s.y - GH) + 0.5;
          const isHot = (hot && Math.abs(hot.x - sp.x) < 1e-9 && Math.abs(hot.y - sp.y) < 1e-9) ||
            warm.some((wg) => Math.abs(wg.x - sp.x) < 1e-9 && Math.abs(wg.y - sp.y) < 1e-9);
          if (isHot) { hotP.rect(gx, gy, GPX, GPX); anyHot = true; }
          else cold.rect(gx, gy, GPX, GPX);
        }
      }
      octx.fillStyle = COL.grip;
      octx.fill(cold);
      octx.stroke(cold);
      if (anyHot) {
        octx.fillStyle = COL.gripHot;
        octx.fill(hotP);
        octx.stroke(hotP);
      }
      octx.restore();
    } else if (doc && sel && sel.size && gripsOn) {
      /* grips by intent (tiers 2/3): past GRIPOBJLIMIT the grips reduce
         instead of vanishing — same squares, same colors, same states */
      drawDynGrips(octx, doc, sel, ui);
    }

    /* group bounding boxes: a fully selected group reads as ONE object —
       the dashed box around it and its single square grip (OPTIONS both) */
    if (!view3d.active) {
      const showBox = !Nasj.opt || Nasj.opt.boundingBox !== false;
      const showGrip = !Nasj.opt || Nasj.opt.singleGripGroups !== false;
      if (showBox || showGrip) {
        for (const gb of Nasj.groupBoxes()) {
          const a = vp.worldToScreen({ x: gb.minx, y: gb.maxy });
          const b = vp.worldToScreen({ x: gb.maxx, y: gb.miny });
          octx.save();
          if (showBox) {
            octx.strokeStyle = COL.accentBright;
            octx.lineWidth = 1;
            octx.setLineDash([4, 3]);
            octx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5,
              Math.round(b.x - a.x), Math.round(b.y - a.y));
            octx.setLineDash([]);
          }
          if (showGrip) {
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            octx.fillStyle = COL.grip;
            octx.strokeStyle = '#ffffff';
            octx.lineWidth = 1;
            octx.fillRect(mx - 4, my - 4, 8, 8);
            octx.strokeRect(mx - 4.5, my - 4.5, 9, 9);
          }
          octx.restore();
        }
      }
    }

    /* The authoring chrome: constraint bars, dimensional constraint labels,
       parameter markers, status boxes. The Block Editor draws it for the
       whole session; outside one, a SELECTED entity still shows its bars —
       the Parametric tab records constraints in the drawing too, and a
       record nothing ever shows is a record nobody trusts. */
    if (Nasj.refedit && Nasj.refedit.bedit && doc) drawBeditChrome(octx, doc, null);
    else if (doc && sel && sel.size && sel.size <= 50) drawBeditChrome(octx, doc, sel);
    /* a measuring parameter mid-placement: the dimension is already there
       and the name RIDES THE CURSOR until the click sets it */
    if (ui.bparamPreview && Nasj.refedit && Nasj.refedit.bedit) {
      const P = ui.bparamPreview;
      octx.save();
      octx.textBaseline = 'middle';
      drawParamDim(octx, vp.worldToScreen(P.a), vp.worldToScreen(P.b),
        vp.worldToScreen(P.l), P.name);
      octx.restore();
    }

    /* An activated viewport is a window onto the model: what belongs to the
       model — the UCS icon, the crosshair — stops at its edge, exactly as
       the industry standard clips them. On the bare sheet the paper-space icon stands in. */
    octx.save();
    if (mspVp) clipToRect(octx, Nasj.viewportScreenRect(mspVp));
    drawUcsIcon(octx);
    drawGizmo(octx);
    if (ui.snapMark) drawSnapMark(octx, ui.snapMark);
    /* a finger gets no crosshair: it would lie under the finger, and a
       full-screen one reads as the drawing being crossed out. While one
       places a point the pick marker and the loupe stand in, below. */
    const finger = lastPointerType === 'touch';
    if (ui.crosshair && !osCross && !ui.zoomDyn && pointerInside && !pan.active &&
        !orbit.active && !finger) drawCrosshair(octx);
    if (ui.killMark && pointerInside && !pan.active && !orbit.active) drawKillMark(octx);
    octx.restore();
    if (Nasj.paper && !mspVp) drawPaperUcsIcon(octx);
    octx.restore();                      /* the split-space clip */
    /* the finger's pick marker and loupe: unclipped, they may lie over a
       neighbouring tile or the sheet — chrome, like the cursor itself */
    if (ui.touchPick && !osCross && !pan.active && !orbit.active) drawTouchPick(octx, ui.touchPick);
  };

  /* the industry standard's paper-space icon: a right triangle standing in the sheet's
     lower-left corner, saying "you are drawing on the paper" */
  const drawPaperUcsIcon = (c2d) => {
    if (Nasj.uiFlags.ucsIcon === false) return;
    const x = 14, y = cssH - 96, a = 40;
    c2d.save();
    c2d.strokeStyle = '#9aa0a6';
    c2d.fillStyle = '#9aa0a6';
    c2d.lineWidth = 1.4;
    c2d.setLineDash([]);
    c2d.beginPath();
    c2d.moveTo(x + .5, y + .5);
    c2d.lineTo(x + .5, y - a + .5);
    c2d.lineTo(x + a * 0.62 + .5, y + .5);
    c2d.closePath();
    c2d.stroke();
    c2d.strokeRect(x + 3.5, y - 7.5, 5, 5);   /* the little origin box */
    c2d.font = '11px "Segoe UI", sans-serif';
    c2d.textBaseline = 'middle';
    c2d.fillText('X', x + a * 0.62 + 4, y - 1);
    c2d.textAlign = 'center';
    c2d.fillText('Y', x + 1, y - a - 8);
    c2d.restore();
  };

  /* ---------------- grips (SPEC §8/§9 grip editing) ----------------
   * Grip list + screen-space hit test over the SELECTED entities, reusing
   * the cached snap points. Kinds mirror the drawn grip squares. */
  /* the selectable groups whose every member is in the selection */
  const fullGroups = (doc, sel) => {
    const out = [];
    if (!doc || !Array.isArray(doc.groups)) return out;
    for (const g of doc.groups) {
      if (g.selectable === false || !g.ids.length) continue;
      if (g.ids.every((id) => sel.has(id))) out.push(g);
    }
    return out;
  };
  /* world boxes of the fully selected groups — the overlay draws these, and
     OPTIONS' "single grip on groups" empties their members from gripList */
  Nasj.groupBoxes = () => {
    const doc = Nasj.doc;
    const sel = Nasj.selection instanceof Set ? Nasj.selection : null;
    if (!doc || !sel || !sel.size) return [];
    /* phase 4: this built a 246k-entry Map per OVERLAY PASS — ~20ms on
       every mouse move whenever anything was selected, groups or not.
       Bail before any per-entity work, and read the id index that
       already exists instead of building another. */
    const gs = fullGroups(doc, sel);
    if (!gs.length) return [];
    const out = [];
    for (const g of gs) {
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const id of g.ids) {
        const e = Nasj.docOps.entityById(doc, id);
        if (!e) continue;
        const b = Nasj.geom.entityBounds(e);
        if (b.minx < minx) minx = b.minx;
        if (b.miny < miny) miny = b.miny;
        if (b.maxx > maxx) maxx = b.maxx;
        if (b.maxy > maxy) maxy = b.maxy;
      }
      if (isFinite(minx)) out.push({ name: g.name, minx, miny, maxx, maxy });
    }
    return out;
  };
  Nasj.gripList = () => {
    const doc = Nasj.doc;
    const sel = Nasj.selection instanceof Set ? Nasj.selection : null;
    const out = [];
    if (!doc || !sel || !sel.size) return out;
    /* a fully selected group shows one grip on its box, not a hundred */
    let skip = null;
    if (!Nasj.opt || Nasj.opt.singleGripGroups !== false) {
      for (const g of fullGroups(doc, sel)) {
        if (!skip) skip = new Set();
        g.ids.forEach((id) => skip.add(id));
      }
    }
    for (const ent of doc.entities) {
      if (!sel.has(ent.id) || (skip && skip.has(ent.id))) continue;
      for (const sp of gripPointsOf(ent)) {
        if (GRIP_KINDS[sp.kind]) {
          const r = { id: ent.id, x: sp.x, y: sp.y, kind: sp.kind, param: sp.param, g: sp.g };
          if (typeof sp.z === 'number') r.z = sp.z;   /* the grip rides its height */
          out.push(r);
        }
      }
    }
    return out;
  };

  /* ---------------- grips by intent (tiers 2/3) ----------------
   * A mass selection must not cost a mass of grips — but nobody may ever
   * hunt for a grip that "should be there". Tiers by selection size:
   *   1 (≤ GRIPOBJLIMIT):     every grip — the untouched path above.
   *   2 (≤ GRIP_ENV_LIMIT):   reduced per-entity grips — ends, centers,
   *                           nodes, params; mids and quads rest. Squares
   *                           stacked within ~12 css px thin to one.
   *   3 (beyond):             envelope grips only — 8 handles on the
   *                           selection's bounds and one at its center,
   *                           each dragging the whole selection the way a
   *                           block's base grip drags the block.
   * In tiers 2/3, dwelling near one selected entity materializes THAT
   * entity's full grips (hover promotion, ≤1 frame); they retire when the
   * cursor walks away. Tables build lazily ON the selection — keyed by the
   * selection Set's identity + docRev — never per frame: a 246k-entity
   * select-all builds nine grips and one bounds sweep, not 246k tables. */
  const REDUCED_GRIP_KINDS = { end: 1, center: 1, node: 1, param: 1 };
  const GRIP_THIN_PX = 12;      /* stacked squares closer than this collapse */
  const gripTier1 = () =>
    (Nasj.opt && Nasj.opt.gripLimit > 0) ? Nasj.opt.gripLimit : GRIP_OBJ_LIMIT;
  const gripTier2 = () => Math.max(gripTier1(),
    (Nasj.opt && Nasj.opt.gripEnvLimit > 0) ? Nasj.opt.gripEnvLimit : GRIP_ENV_LIMIT);
  const gripTierOf = (sel) =>
    sel.size <= gripTier1() ? 1 : sel.size <= gripTier2() ? 2 : 3;

  const gdyn = {
    sel: null, rev: -1, ents: null,
    table: null,      /* tier 2: [{id,x,y,kind,…}] topmost first */
    cells: null,      /* tier 2: Map thin-cell -> table index (the reps) */
    thinSig: '',      /* the view the reps were computed at */
    env: null,        /* tier 3: {minx,miny,maxx,maxy,grips:[…]} */
    promoted: null,   /* the entity id wearing full grips under the cursor */
  };
  const gdynFresh = () => {
    const doc = Nasj.doc;
    const sel = Nasj.selection;
    const ents = doc ? doc.entities : null;
    if (gdyn.sel !== sel || gdyn.rev !== docRev || gdyn.ents !== ents) {
      if (gdyn.sel !== sel) gdyn.promoted = null;
      gdyn.sel = sel;
      gdyn.rev = docRev;
      gdyn.ents = ents;
      gdyn.table = null;
      gdyn.cells = null;
      gdyn.env = null;
      gdyn.thinSig = '';
    }
    return gdyn;
  };
  /* tier 2's grip table: one selection event's worth of reduced grips,
     topmost entity first (the order every grip hit-test resolves ties by) */
  const gdynTable = () => {
    const g = gdynFresh();
    if (g.table) return g.table;
    const doc = Nasj.doc;
    const sel = Nasj.selection;
    const out = [];
    if (!doc || !(sel instanceof Set) || !sel.size) { g.table = out; return out; }
    let skip = null;   /* the same one-grip-per-group fold tier 1 applies */
    if (!Nasj.opt || Nasj.opt.singleGripGroups !== false) {
      for (const grp of fullGroups(doc, sel)) {
        if (!skip) skip = new Set();
        grp.ids.forEach((id) => skip.add(id));
      }
    }
    const ranked = [];
    for (const id of sel) {
      if (skip && skip.has(id)) continue;
      const ent = Nasj.docOps.entityById(doc, id);
      if (ent) ranked.push(ent);
    }
    /* topmost first — the order the document walk used to give for free */
    for (const ent of ranked) {
      for (const sp of gripPointsOf(ent)) {
        if (REDUCED_GRIP_KINDS[sp.kind]) {
          const r = { id: ent.id, x: sp.x, y: sp.y, kind: sp.kind, param: sp.param, g: sp.g };
          if (typeof sp.z === 'number') r.z = sp.z;   /* the grip rides its height */
          out.push(r);
        }
      }
    }
    g.table = out;
    return out;
  };
  /* screen-space thinning: one representative per ~12px cell, recomputed on
     zoom settle (mid-gesture the stale reps still transform correctly —
     only their grouping granularity waits for the wheel to stop) */
  const gdynThin = () => {
    const g = gdynFresh();
    const table = gdynTable();
    const sig = vp.scale + ':' + twist + ':' + view3d.active + ':' +
      view3d.azimuth + ':' + view3d.elevation;
    if (g.cells && (g.thinSig === sig || performance.now() - lastZoomT < 150)) {
      return g.cells;
    }
    const cells = new Map();
    for (let i = 0; i < table.length; i++) {
      const s = vp.worldToScreen(table[i]);
      const key = Math.round(s.x / GRIP_THIN_PX) + ',' + Math.round(s.y / GRIP_THIN_PX);
      if (!cells.has(key)) cells.set(key, i);
    }
    g.cells = cells;
    g.thinSig = sig;
    return cells;
  };
  /* tier 3's envelope: the selection's world bounds (cached per-entity
     bounds — one sweep per selection event) and its nine handles */
  const gdynEnvelope = () => {
    const g = gdynFresh();
    if (g.env) return g.env;
    const doc = Nasj.doc;
    const sel = Nasj.selection;
    if (!doc || !(sel instanceof Set) || !sel.size) {
      g.env = { grips: [] };
      return g.env;
    }
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    const grow = (b) => {
      if (!b || !isFinite(b.minx)) return;
      if (b.minx < minx) minx = b.minx;
      if (b.miny < miny) miny = b.miny;
      if (b.maxx > maxx) maxx = b.maxx;
      if (b.maxy > maxy) maxy = b.maxy;
    };
    /* the select-all envelope, answered without a 241k-entity bounds walk
       (650ms on a cold cache, measured, twice per commit): when the
       selection covers everything GL draws, the GL item boxes ARE the
       owned part's bounds, and only the 2D remainder still measures */
    let fast = null;
    if (Nasj.glscene && typeof Nasj.glscene.selCover === 'function') {
      /* same cap as selTintNow, so the two share one selCover memo entry */
      const cov = Nasj.glscene.selCover(sel, SEL_TINT_EXC_MAX);
      if (cov && cov.box && cov.exc && cov.exc.length <= 8) {
        grow(cov.box);
        /* (near-)select-all: the remainder's cached box (idle-warmed and
           translation-shifted on the GL side) — no bounds walk at all.
           A handful of unselected stragglers overgrow the envelope by
           their own extent at most, which the handles absorb. */
        const rb = doc.entities.length - sel.size <= 8 &&
          typeof Nasj.glscene.remainderBox === 'function'
          ? Nasj.glscene.remainderBox() : undefined;
        if (rb !== undefined) {
          if (rb) grow(rb);
          fast = true;
        } else {
          const rest = Nasj.glscene.remainder();
          if (rest) {
            for (const ent of rest) if (sel.has(ent.id)) grow(boundsOf(ent));
            fast = true;
          }
        }
      }
    }
    if (!fast) {
      for (const ent of doc.entities) {
        if (!sel.has(ent.id)) continue;
        grow(boundsOf(ent));
      }
    }
    if (!isFinite(minx)) {
      g.env = { grips: [] };
      return g.env;
    }
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    const pts = [
      [minx, miny], [cx, miny], [maxx, miny], [maxx, cy],
      [maxx, maxy], [cx, maxy], [minx, maxy], [minx, cy], [cx, cy],
    ];
    g.env = { minx, miny, maxx, maxy,
      grips: pts.map(([x, y], i) => ({ x, y, kind: 'env', env: i })) };
    return g.env;
  };
  /* the tiers' overlay pass: same squares, same colors, same hot/warm
     states as every other grip in the app */
  const drawDynGrips = (octx, doc, sel, ui) => {
    const hot = ui.hotGrip;
    const warm = Array.isArray(ui.warmGrips) ? ui.warmGrips : [];
    const GPX = gripPx();
    const GH = GPX / 2;
    const isHot = (x, y) =>
      (hot && Math.abs(hot.x - x) < 1e-9 && Math.abs(hot.y - y) < 1e-9) ||
      warm.some((wg) => Math.abs(wg.x - x) < 1e-9 && Math.abs(wg.y - y) < 1e-9);
    octx.save();
    octx.strokeStyle = '#ffffff';
    octx.lineWidth = 1;
    octx.setLineDash([]);
    const cold = new Path2D();
    const hotP = new Path2D();
    let anyHot = false;
    const W = cssW, H = cssH;
    const put = (pt) => {
      const s = vp.worldToScreen(pt);
      if (s.x < -8 || s.y < -8 || s.x > W + 8 || s.y > H + 8) return;
      const gx = Math.round(s.x - GH) + 0.5, gy = Math.round(s.y - GH) + 0.5;
      if (isHot(pt.x, pt.y)) { hotP.rect(gx, gy, GPX, GPX); anyHot = true; }
      else cold.rect(gx, gy, GPX, GPX);
    };
    if (gripTierOf(sel) === 2) {
      const table = gdynTable();
      for (const i of gdynThin().values()) put(table[i]);
    } else {
      for (const gp of gdynEnvelope().grips) put(gp);
    }
    /* hover promotion: the entity the cursor dwells on wears its full set */
    const pid = gdyn.promoted;
    if (pid != null && sel.has(pid)) {
      const ent = Nasj.docOps.entityById(doc, pid);
      if (ent) {
        for (const sp of gripPointsOf(ent)) {
          if (GRIP_KINDS[sp.kind]) put(sp);
        }
      }
    }
    octx.fillStyle = COL.grip;
    octx.fill(cold);
    octx.stroke(cold);
    if (anyHot) {
      octx.fillStyle = COL.gripHot;
      octx.fill(hotP);
      octx.stroke(hotP);
    }
    octx.restore();
  };
  /* hover promotion, fed by the select tool's own hover hit every move: the
     grips appear on the SAME frame the cursor arrives and retire when it
     leaves — unless it left the geometry FOR one of the promoted grips (a
     circle's center grip stands off the circle, and a grip that vanished
     as it was approached would be exactly the getting-lost this whole
     mechanism exists to prevent). */
  Nasj.gripPromote = (id, screen) => {
    const sel = Nasj.selection instanceof Set ? Nasj.selection : null;
    if (!sel || !sel.size || sel.size <= gripTier1()) {
      gdyn.promoted = null;
      return;
    }
    gdynFresh();
    if (id != null && sel.has(id)) {
      gdyn.promoted = id;
      return;
    }
    const pid = gdyn.promoted;
    if (pid == null) return;
    if (screen && sel.has(pid)) {
      const doc = Nasj.doc;
      const ent = doc && Nasj.docOps.entityById(doc, pid);
      if (ent) {
        for (const sp of gripPointsOf(ent)) {
          if (!GRIP_KINDS[sp.kind]) continue;
          const s = vp.worldToScreen(sp);
          if (Math.hypot(s.x - screen.x, s.y - screen.y) <= 16) return;
        }
      }
    }
    gdyn.promoted = null;
  };
  /* the dynamic-grip state, for QA and debugging */
  Nasj.gripDyn = {
    limits: () => ({ full: gripTier1(), env: gripTier2() }),
    tier: () => {
      const sel = Nasj.selection instanceof Set ? Nasj.selection : null;
      return (sel && sel.size) ? gripTierOf(sel) : 0;
    },
    table: gdynTable,
    thinned: () => gdynThin().size,
    envelope: gdynEnvelope,
    promoted: () => gdyn.promoted,
  };
  /* tiers 2/3 grip pick: the promoted entity's squares first (they stand
     under the cursor by construction), then a fully selected group's box
     grip, then what the tier actually shows — tier 2's thinned squares
     resolve stacked grips to the entity under the cursor, tier 3 offers
     the envelope's nine handles. */
  const gripHitTestDyn = (doc, sel, screen, tol) => {
    const rec = (r) =>
      ({ id: r.id, x: r.x, y: r.y, kind: r.kind, param: r.param, g: r.g });
    const pid = gdyn.promoted;
    if (pid != null && sel.has(pid)) {
      const ent = Nasj.docOps.entityById(doc, pid);
      if (ent && !gripLocked(doc, ent)) {
        let best = null, bestD = Infinity;
        for (const sp of gripPointsOf(ent)) {
          if (!GRIP_KINDS[sp.kind]) continue;
          const s = vp.worldToScreen(sp);
          const d = Math.hypot(s.x - screen.x, s.y - screen.y);
          if (d <= tol && d < bestD - 1e-9) {
            bestD = d;
            best = rec({ id: ent.id, x: sp.x, y: sp.y, kind: sp.kind, param: sp.param, g: sp.g });
          }
        }
        if (best) return best;
      }
    }
    if (!Nasj.opt || Nasj.opt.singleGripGroups !== false) {
      for (const gb of Nasj.groupBoxes()) {
        const cx = (gb.minx + gb.maxx) / 2, cy = (gb.miny + gb.maxy) / 2;
        const s = vp.worldToScreen({ x: cx, y: cy });
        if (Math.hypot(s.x - screen.x, s.y - screen.y) <= tol) {
          return { group: gb.name, x: cx, y: cy, kind: 'gmove' };
        }
      }
    }
    if (gripTierOf(sel) === 2) {
      const table = gdynTable();
      let best = null, bestD = Infinity, hov = null, hovD = Infinity;
      for (const r of table) {
        const s = vp.worldToScreen(r);
        const d = Math.hypot(s.x - screen.x, s.y - screen.y);
        if (d > tol) continue;
        const ent = Nasj.docOps.entityById(doc, r.id);
        if (!ent || gripLocked(doc, ent)) continue;
        if (r.id === Nasj.ui.hoverId && d < hovD - 1e-9) { hovD = d; hov = r; }
        if (d < bestD - 1e-9) { bestD = d; best = r; }
      }
      const w = hov || best;
      return w ? rec(w) : null;
    }
    let best = null, bestD = Infinity;
    for (const gp of gdynEnvelope().grips) {
      const s = vp.worldToScreen(gp);
      const d = Math.hypot(s.x - screen.x, s.y - screen.y);
      if (d <= tol && d < bestD - 1e-9) { bestD = d; best = gp; }
    }
    return best ? { env: best.env, x: best.x, y: best.y, kind: 'env' } : null;
  };

  /* a locked layer's geometry shows its grips but cannot be grip-edited —
     the industry standard's rule — so the editing hit-tests skip it and a coincident
     unlocked grip underneath wins instead */
  const gripLocked = (doc, ent) => {
    /* an attribute definition with Lock position set holds its place in the
       block: the industry standard offers it no grip to be dragged by */
    if (ent.type === 'attdef' && ent.lockPos) return true;
    const l = layerMap(doc).get(ent.layerId);
    return !!(l && l.locked);
  };

  /* nearest grip within tolPx (default 8px) of a screen point, topmost
   * entity winning ties -> {id, x, y, kind} | null */
  Nasj.gripHitTest = (screen, tolPx) => {
    const doc = Nasj.doc;
    const sel = Nasj.selection instanceof Set ? Nasj.selection : null;
    if (!doc || !sel || !sel.size || !screen) return null;
    const tol = (typeof tolPx === 'number' && tolPx > 0) ? tolPx : 8;
    /* tiers 2/3 answer from their own cached tables — the full walk below
       priced a click at 1.7 SECONDS on a 246k select-all (measured) */
    if (sel.size > gripTier1()) return gripHitTestDyn(doc, sel, screen, tol);
    let best = null, bestD = Infinity;
    /* a grouped shape is rigid: its members' grips can neither be seen nor
       grabbed, and the single grip on the box moves the whole group */
    let skip = null;
    if (!Nasj.opt || Nasj.opt.singleGripGroups !== false) {
      for (const gb of Nasj.groupBoxes()) {
        const cx = (gb.minx + gb.maxx) / 2, cy = (gb.miny + gb.maxy) / 2;
        const s = vp.worldToScreen({ x: cx, y: cy });
        const d = Math.hypot(s.x - screen.x, s.y - screen.y);
        if (d <= tol && d < bestD - 1e-9) {
          bestD = d;
          best = { group: gb.name, x: cx, y: cy, kind: 'gmove' };
        }
      }
      for (const g of fullGroups(doc, sel)) {
        if (!skip) skip = new Set();
        g.ids.forEach((id) => skip.add(id));
      }
    }
    for (let i = doc.entities.length - 1; i >= 0; i--) {
      const ent = doc.entities[i];
      if (!sel.has(ent.id) || (skip && skip.has(ent.id)) || gripLocked(doc, ent)) continue;
      for (const sp of gripPointsOf(ent)) {
        if (!GRIP_KINDS[sp.kind]) continue;
        const s = vp.worldToScreen(sp);
        const d = Math.hypot(s.x - screen.x, s.y - screen.y);
        if (d <= tol && d < bestD - 1e-9) {
          bestD = d;
          best = { id: ent.id, x: sp.x, y: sp.y, kind: sp.kind, param: sp.param, g: sp.g };
          if (typeof sp.z === 'number') best.z = sp.z;
        }
      }
      if (best) return best; /* topmost selected entity wins */
    }
    return best;
  };

  /* Every grip of every selected entity that stands ON a world point —
     the industry standard's coincident-grip rule: where grips of different objects
     coincide, making one hot makes them all hot, which is what keeps the
     shared corner of an exploded shape in one piece when it is stretched.
     The tolerance is exactness up to floating-point: endpoints drawn with
     osnap share their coordinates to the bit, and 1e-12 of the coordinate
     magnitude forgives only the last digits of computed arc ends — it can
     never reach geometry that is merely close, even in a georeferenced
     drawing millions of units from the origin. Group-rigid members and
     locked layers are skipped exactly as gripHitTest skips them. */
  Nasj.gripsAt = (pt) => {
    const doc = Nasj.doc;
    const sel = Nasj.selection instanceof Set ? Nasj.selection : null;
    if (!doc || !sel || !sel.size || !pt) return [];
    const tol = Math.max(1e-9, 1e-12 * Math.max(Math.abs(pt.x), Math.abs(pt.y)));
    let skip = null;
    if (!Nasj.opt || Nasj.opt.singleGripGroups !== false) {
      for (const g of fullGroups(doc, sel)) {
        if (!skip) skip = new Set();
        g.ids.forEach((id) => skip.add(id));
      }
    }
    const out = [];
    const scan = (ent) => {
      if (!sel.has(ent.id) || (skip && skip.has(ent.id)) || gripLocked(doc, ent)) return;
      for (const sp of gripPointsOf(ent)) {
        if (!GRIP_KINDS[sp.kind]) continue;
        if (Math.abs(sp.x - pt.x) <= tol && Math.abs(sp.y - pt.y) <= tol) {
          const r = { id: ent.id, x: sp.x, y: sp.y, kind: sp.kind, param: sp.param, g: sp.g };
          if (typeof sp.z === 'number') r.z = sp.z;
          out.push(r);
        }
      }
    };
    /* a coincident grip stands ON the point, so only entities whose box
       reaches it can hold one — past tier 1 the spatial index hands those
       over (topmost first, the same order the full walk yields) instead of
       a quarter-million-entity sweep on every grip pick */
    if (sel.size > gripTier1() && typeof Nasj.spatialCandidates === 'function') {
      for (const ent of (Nasj.spatialCandidates(pt.x, pt.y, tol) || [])) scan(ent);
    } else {
      for (let i = doc.entities.length - 1; i >= 0; i--) scan(doc.entities[i]);
    }
    return out;
  };

  /* ---------------- osnap / grid snap ---------------- */
  const OSNAP_PX = 12;
  /* a finger's aperture: the pick point rides 64px above the finger and is
     read through a loupe, so a wider box costs nothing in precision and
     saves the finger from having to land within twelve pixels of an end */
  const TOUCH_OSNAP_PX = 24;
  /* APERTURE sets the snap box; the default is the industry standard's 12px-ish feel */
  const snapApx = () => {
    const a = (Nasj.settings.aperture >= 1 && Nasj.settings.aperture <= 50)
      ? Nasj.settings.aperture : OSNAP_PX;
    return touchInput() ? Math.max(a, TOUCH_OSNAP_PX) : a;
  };
  /* entities whose snap points one cursor position may generate (see the
     cap in computePoint) */
  const SNAP_CAND_MAX = 300;
  const TRACK_PX = 10; /* lateral aperture (px) for polar/parallel tracking */

  /* industry-standard-style hover acquisition for the tracking osnaps: Extension rays
     come from endpoints the cursor has visited, Parallel angles from straight
     segments it has hovered. Cleared when the command ends / tool changes. */
  const acqExt = [];   /* {x, y, dirs:[rad,..]} — most recent 3 endpoints */
  const acqPar = [];   /* source angles (rad, mod PI) — most recent 2 */
  const acqTrk = [];   /* OTRACK: acquired osnap points — most recent 3 */
  /* the hard geometric snaps worth tracking from (not near/ext/par/perp/tan,
     which move with the cursor or the command's base) */
  const ACQ_KINDS = { end: 1, mid: 1, center: 1, gcen: 1, quad: 1, node: 1, int: 1 };
  const clearAcquired = () => { acqExt.length = 0; acqPar.length = 0; acqTrk.length = 0; };
  Nasj.acqTrackPoints = acqTrk;  /* the overlay draws their + markers */
  window.addEventListener('nasj:tool', clearAcquired);

  const modeOn = (m) => {
    const M = Nasj.settings.osnapModes;
    return !M || !!M[m];
  };
  const KIND_MODE = { end: 'end', mid: 'mid', center: 'cen', quad: 'quad',
    node: 'node', gcen: 'gcen', ins: 'ins' };

  const samePt = (a, b) => Math.abs(a.x - b.x) < 1e-7 && Math.abs(a.y - b.y) < 1e-7;

  /* remember the extension rays leaving an endpoint the cursor just snapped
     to — p was accepted inside the cursor box, so prims ending on it survive
     the box-clipped expansion */
  const acquireExt = (p, nearEnts, box) => {
    if (acqExt.some((q) => samePt(q, p))) return;
    const dirs = [];
    for (const ent of nearEnts) {
      for (const P of primsOfEnt(ent, box)) {
        if (P.seg) {
          const [a, b] = P.seg;
          if (samePt(b, p)) dirs.push(Math.atan2(b.y - a.y, b.x - a.x));
          if (samePt(a, p)) dirs.push(Math.atan2(a.y - b.y, a.x - b.x));
        } else if (P.arc && !P.arc.full) {
          const A = P.arc;
          const e0 = { x: A.c.x + A.r * Math.cos(A.a0), y: A.c.y + A.r * Math.sin(A.a0) };
          const e1 = { x: A.c.x + A.r * Math.cos(A.a1), y: A.c.y + A.r * Math.sin(A.a1) };
          /* tangent rays leaving the arc (CCW a0 -> a1) */
          if (samePt(e1, p)) dirs.push(A.a1 + Math.PI / 2);
          if (samePt(e0, p)) dirs.push(A.a0 - Math.PI / 2);
        }
      }
    }
    if (dirs.length) {
      acqExt.push({ x: p.x, y: p.y, dirs });
      if (acqExt.length > 3) acqExt.shift();
    }
  };

  /* remember angles of straight segments under the cursor (Parallel osnap) */
  const acquirePar = (w, tolW, nearEnts, box) => {
    for (const ent of nearEnts) {
      for (const P of primsNear(ent, w, tolW, box)) {
        if (!P.seg) continue;
        const [a, b] = P.seg;
        const dx = b.x - a.x, dy = b.y - a.y;
        const L2 = dx * dx + dy * dy;
        if (L2 < 1e-18) continue;
        const t = Math.max(0, Math.min(1, ((w.x - a.x) * dx + (w.y - a.y) * dy) / L2));
        if (Math.hypot(w.x - a.x - t * dx, w.y - a.y - t * dy) > tolW) continue;
        let ang = Math.atan2(dy, dx) % Math.PI;
        if (ang < 0) ang += Math.PI;
        if (!acqPar.some((x) => Math.abs(x - ang) < 0.005 ||
            Math.abs(Math.abs(x - ang) - Math.PI) < 0.005)) {
          acqPar.push(ang);
          if (acqPar.length > 2) acqPar.shift();
        }
      }
    }
  };

  const computePoint = (screen) => {
    const worldRaw = vp.screenToWorld(screen);
    /* ZOOM Dynamic's view box rides the bare cursor — nothing snaps it */
    if (Nasj.ui.zoomDyn) {
      Nasj.ui.snapMark = null;
      Nasj.ui.polarTrack = null;
      return { world: worldRaw, worldRaw, screen };
    }
    /* glscene phase 4 (input during load): while the drawing is loading or
       warming, the crosshair glides free and nothing acquires — no osnap
       (the first query rebuilt the spatial index on the pointer path,
       467-683ms of it), no snap marks. Mid-command tools still receive
       the raw point. Un-gated atomically when doc.loading clears. */
    if (Nasj.doc && Nasj.doc.loading) {
      Nasj.ui.snapMark = null;
      Nasj.ui.polarTrack = null;
      return { world: worldRaw, worldRaw, screen };
    }
    let world = worldRaw;
    let mark = null;
    Nasj.ui.polarTrack = null; /* re-established below or by applyOrthoPolar */
    const awaitingPt = !!(Nasj.tools && Nasj.tools.awaiting !== 'none');
    if (!awaitingPt) clearAcquired();

    /* OBJECT SNAP IN 3D. Object snap used to switch itself off in a 3D view
       (the flat path below still says so), and it had to: every distance
       there is measured in world XY against the point the cursor makes on
       the z=0 plane, and a snap point forty units up in the air is nowhere
       near that point however exactly the cursor sits on it. Screen space is
       the one frame that means the same thing from every angle, so this
       measures there — the aperture in pixels, the way the industry standard's has always
       been described — and hands the point back WITH its height, which is
       what makes the snap three-dimensional rather than the shadow under it. */
    if (Nasj.settings.osnap && Nasj.doc && view3d.active) {
      const apx = snapApx();
      const lmap = layerMap(Nasj.doc);
      const S = screen;
      /* the entities worth asking, nearest first. An entity is placed by
         where its GROUND footprint projects, so a very tall one in a very
         crowded drawing can fall outside the nearest few hundred — the same
         bound the flat path draws, and for the same reason. */
      const cand = [];
      for (const ent of Nasj.doc.entities) {
        if (!ent || !entVisible(ent, lmap)) continue;
        const b = snapBox(ent);
        const c = vp.worldToScreen({ x: (b.minx + b.maxx) / 2, y: (b.miny + b.maxy) / 2 });
        cand.push({ ent, d: Math.hypot(c.x - S.x, c.y - S.y) });
      }
      if (cand.length > SNAP_CAND_MAX) {
        cand.sort((a, b) => a.d - b.d);
        cand.length = SNAP_CAND_MAX;
      }
      let best3 = null, bestPx = Infinity;
      for (const c of cand) {
        for (const sp of snapPointsOf(c.ent)) {
          const m = KIND_MODE[sp.kind];
          if (!m || !modeOn(m)) continue;
          const q = vp.worldToScreen(sp);
          const d = Math.hypot(q.x - S.x, q.y - S.y);
          if (d <= apx && d < bestPx) {
            bestPx = d;
            best3 = { x: sp.x, y: sp.y, kind: sp.kind };
            if (typeof sp.z === 'number' && isFinite(sp.z)) best3.z = sp.z;
            if (sp.param) best3.param = sp.param;
          }
        }
      }
      /* THE SNAPS THE POINT TABLES CANNOT GIVE — an intersection, the
         nearest point, the perpendicular foot — measured on the SCREEN
         like the rest and handed back ON the 3D geometry, heights and
         all. Segments come from the same source the screen hit-test
         reads (tools.js publishes it), so whatever can be picked can be
         snapped to. */
      if (typeof Nasj.segs3Of === 'function' &&
          (modeOn('int') || modeOn('appint') || modeOn('near') || modeOn('perp'))) {
        const z3 = (p) => (typeof p.z === 'number' && isFinite(p.z)) ? p.z : 0;
        const lerp3 = (a, b, t) => {
          const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          if (typeof a.z === 'number' || typeof b.z === 'number') {
            q.z = z3(a) + (z3(b) - z3(a)) * t;
          }
          return q;
        };
        /* the segments the cursor stands near, projected once */
        const near3 = [];
        for (const c of cand) {
          for (const sg of Nasj.segs3Of(c.ent, Nasj.doc, 0)) {
            const a = sg[0], b = sg[1];
            const A = vp.worldToScreen({ x: a.x, y: a.y, z: z3(a) });
            const B = vp.worldToScreen({ x: b.x, y: b.y, z: z3(b) });
            if (!isFinite(A.x) || !isFinite(B.x)) continue;
            if (S.x < Math.min(A.x, B.x) - apx || S.x > Math.max(A.x, B.x) + apx ||
                S.y < Math.min(A.y, B.y) - apx || S.y > Math.max(A.y, B.y) + apx) continue;
            near3.push({ id: c.ent.id, a, b, A, B });
            if (near3.length >= 400) break;
          }
          if (near3.length >= 400) break;
        }
        const consider3 = (p, kind) => {
          const q = vp.worldToScreen({ x: p.x, y: p.y, z: z3(p) });
          const d = Math.hypot(q.x - S.x, q.y - S.y);
          if (d <= apx && d < bestPx) {
            bestPx = d;
            best3 = { x: p.x, y: p.y, kind };
            if (typeof p.z === 'number' && isFinite(p.z)) best3.z = p.z;
          }
        };
        const segCross = (A, B, C, Dq) => {
          const rx = B.x - A.x, ry = B.y - A.y, sx = Dq.x - C.x, sy = Dq.y - C.y;
          const den = rx * sy - ry * sx;
          if (Math.abs(den) < 1e-12) return null;
          const t = ((C.x - A.x) * sy - (C.y - A.y) * sx) / den;
          const u = ((C.x - A.x) * ry - (C.y - A.y) * rx) / den;
          return (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9)
            ? { t: Math.max(0, Math.min(1, t)), u: Math.max(0, Math.min(1, u)) } : null;
        };
        /* intersections: where two edges cross as SEEN. The same station
           on both in space is the real crossing (Intersection); different
           heights is the apparent one, taken on the edge nearer the eye —
           the industry standard's own pair of snaps. */
        if (modeOn('int') || modeOn('appint')) {
          for (let i = 0; i < near3.length; i++) {
            for (let j = i + 1; j < near3.length; j++) {
              const g1 = near3[i], g2 = near3[j];
              if (g1.id === g2.id) continue;
              const r = segCross(g1.A, g1.B, g2.A, g2.B);
              if (!r) continue;
              const w1 = lerp3(g1.a, g1.b, r.t), w2 = lerp3(g2.a, g2.b, r.u);
              const gap = Math.hypot(w1.x - w2.x, w1.y - w2.y, z3(w1) - z3(w2));
              if (gap <= 1e-6) { if (modeOn('int')) consider3(w1, 'int'); }
              else if (modeOn('appint')) {
                consider3(worldToDepth3(w1) <= worldToDepth3(w2) ? w1 : w2, 'appint');
              }
            }
          }
        }
        /* perpendicular: the true 3D foot from the command's base point */
        const pbase = Nasj.ui.dynBase;
        if (modeOn('perp') && pbase) {
          const bz = z3(pbase);
          for (const g of near3) {
            const vx = g.b.x - g.a.x, vy = g.b.y - g.a.y, vz = z3(g.b) - z3(g.a);
            const L2 = vx * vx + vy * vy + vz * vz;
            if (L2 < 1e-12) continue;
            let t = ((pbase.x - g.a.x) * vx + (pbase.y - g.a.y) * vy +
              (bz - z3(g.a)) * vz) / L2;
            t = Math.max(0, Math.min(1, t));
            consider3(lerp3(g.a, g.b, t), 'perp');
          }
        }
        /* nearest only bites when no geometric snap did (the industry standard's rule) */
        if (!best3 && modeOn('near')) {
          for (const g of near3) {
            const vx = g.B.x - g.A.x, vy = g.B.y - g.A.y;
            const L2 = vx * vx + vy * vy;
            if (L2 < 1e-12) continue;
            let t = ((S.x - g.A.x) * vx + (S.y - g.A.y) * vy) / L2;
            t = Math.max(0, Math.min(1, t));
            consider3(lerp3(g.a, g.b, t), 'near');
          }
        }
      }
      if (best3) {
        world = (best3.z != null)
          ? { x: best3.x, y: best3.y, z: best3.z }
          : { x: best3.x, y: best3.y };
        mark = best3;
      }
    }
    /* a layout snaps like model space does: to the model through an activated
       viewport, to the sheet's own geometry out on the paper */
    if (Nasj.settings.osnap && Nasj.doc && !view3d.active) {
      const G = Nasj.geom;
      const apx = snapApx();
      const tolW = apx / Nasj.worldScale();
      const lmap = layerMap(Nasj.doc);
      const base = Nasj.ui.dynBase || null; /* active command's base point */
      /* the aperture box: every snap the cursor can accept lies inside it,
         so block references only expand the children that can reach it */
      const abox = { minx: worldRaw.x - tolW, miny: worldRaw.y - tolW,
        maxx: worldRaw.x + tolW, maxy: worldRaw.y + tolW };

      /* spatial index: only entities near the cursor instead of all of them.
         Snap-point prefilter box: an arc's center snap can lie outside the
         entity bbox, so union it in before rejecting. */
      let nearEnts = [];
      for (const ent of queryIndex(Nasj.doc, worldRaw.x, worldRaw.y, tolW)) {
        if (!entVisible(ent, lmap)) continue;
        const b = snapBox(ent);
        if (worldRaw.x < b.minx - tolW || worldRaw.x > b.maxx + tolW ||
            worldRaw.y < b.miny - tolW || worldRaw.y > b.maxy + tolW) continue;
        nearEnts.push(ent);
      }
      /* Zoomed far out the aperture spans thousands of drawing units, so
         "near" stops meaning anything and every entity's snap points were
         being generated on every mouse move. Keep the closest few hundred:
         the snap the cursor lands on is one of them by construction. */
      if (nearEnts.length > SNAP_CAND_MAX) {
        nearEnts = nearEnts
          .map((ent) => {
            const b = snapBox(ent);
            return { ent, d: Math.hypot(
              Math.max(b.minx - worldRaw.x, 0, worldRaw.x - b.maxx),
              Math.max(b.miny - worldRaw.y, 0, worldRaw.y - b.maxy)) };
          })
          .sort((a, b) => a.d - b.d)
          .slice(0, SNAP_CAND_MAX)
          .map((c) => c.ent);
      }

      let best = null, bestD = Infinity;
      const consider = (x, y, kind, extra) => {
        const d = Math.hypot(x - worldRaw.x, y - worldRaw.y);
        if (d <= tolW && d < bestD) {
          bestD = d;
          best = Object.assign({ x, y, kind }, extra || null);
        }
      };

      /* point snaps straight off the per-entity snap tables, mode-filtered.
         The reject box rides the live bestD: once some end sits practically
         on the cursor, a thumbnail block's hundred-thousand-point table
         costs four compares a point instead of a hypot (a skipped point is
         farther than tolW or the current best — consider refuses both). */
      const wx = worldRaw.x, wy = worldRaw.y;
      for (const ent of nearEnts) {
        for (const sp of snapPointsOf(ent, abox)) {
          const r = bestD < tolW ? bestD : tolW;
          if (sp.x < wx - r || sp.x > wx + r || sp.y < wy - r || sp.y > wy + r) continue;
          const m = KIND_MODE[sp.kind];
          if (m && modeOn(m)) consider(sp.x, sp.y, sp.kind);
        }
      }

      /* intersections (apparent == real in 2D) — prims clipped to the cursor
         box first so two long polylines don't cost n*m per mouse move. Even
         clipped, a dense block sheet can crowd tens of thousands of prims
         into the aperture, and the straight cross product ran to hundreds of
         millions of pair tests per move (measured). An intersection lies in
         both prims' boxes, so prims are bucketed on a small grid over the
         aperture box and only bucket-mates pair up — the same pairs in the
         same order as the cross product, minus those that cannot put an
         intersection within reach. */
      if ((modeOn('int') || modeOn('appint')) && bestD > 0) {
        /* An intersection is only accepted when it beats the best point
           snap already found (consider keeps the strictly closest), so the
           search radius shrinks from the aperture to bestD. Over a block
           drawn smaller than the aperture — a library sheet's thumbnails
           at ZOOM Extents put half a million prims inside it (measured) —
           some end/mid sits practically on the cursor, and only prims that
           could still beat it stay in the pair walk. */
        const rI = Math.min(tolW, bestD);
        const ibox = rI < tolW
          ? { minx: worldRaw.x - rI, miny: worldRaw.y - rI,
            maxx: worldRaw.x + rI, maxy: worldRaw.y + rI }
          : abox;
        const lists = nearEnts.map((e) => primsNear(e, worldRaw, rI, ibox));
        /* an intersection lies in both prims' boxes, so prims are bucketed
           on a small grid over the search box and only bucket-mates pair
           up — the same pairs in the same order the plain cross product
           visited, minus those that cannot put a point within reach */
        const IG = 16;
        const csx = (ibox.maxx - ibox.minx) / IG, csy = (ibox.maxy - ibox.miny) / IG;
        const cellIdx = (v, o, cs) => Math.max(0, Math.min(IG - 1, Math.floor((v - o) / cs)));
        const P = [];
        const buckets = new Array(IG * IG).fill(null);
        for (let i = 0; i < lists.length; i++) {
          for (let pi = 0; pi < lists[i].length; pi++) {
            const A = lists[i][pi];
            let bx0, by0, bx1, by1;
            if (A.seg) {
              const [a, b] = A.seg;
              bx0 = Math.min(a.x, b.x); bx1 = Math.max(a.x, b.x);
              by0 = Math.min(a.y, b.y); by1 = Math.max(a.y, b.y);
            } else {
              const C = A.arc;
              bx0 = C.c.x - C.r; bx1 = C.c.x + C.r;
              by0 = C.c.y - C.r; by1 = C.c.y + C.r;
            }
            const q = { prim: A, li: i, pi, bx0, by0, bx1, by1,
              cx0: cellIdx(bx0, ibox.minx, csx), cx1: cellIdx(bx1, ibox.minx, csx),
              cy0: cellIdx(by0, ibox.miny, csy), cy1: cellIdx(by1, ibox.miny, csy) };
            const id = P.length;
            P.push(q);
            for (let cy = q.cy0; cy <= q.cy1; cy++) {
              for (let cx = q.cx0; cx <= q.cx1; cx++) {
                const k = cy * IG + cx;
                (buckets[k] || (buckets[k] = [])).push(id);
              }
            }
          }
        }
        const pairs = [];
        for (let k = 0; k < buckets.length; k++) {
          const bk = buckets[k];
          if (!bk || bk.length < 2) continue;
          const cy = (k / IG) | 0, cx = k % IG;
          for (let u = 0; u < bk.length; u++) {
            const a = P[bk[u]];
            for (let v = u + 1; v < bk.length; v++) {
              const b = P[bk[v]];
              if (a.li === b.li) continue;
              /* each pair once: only in the first cell both boxes cover */
              if (Math.max(a.cx0, b.cx0) !== cx || Math.max(a.cy0, b.cy0) !== cy) continue;
              /* exact prune: the boxes must overlap, inside the search box */
              const ox0 = Math.max(a.bx0, b.bx0), ox1 = Math.min(a.bx1, b.bx1);
              const oy0 = Math.max(a.by0, b.by0), oy1 = Math.min(a.by1, b.by1);
              if (ox0 > ox1 || oy0 > oy1 || ox0 > ibox.maxx || ox1 < ibox.minx ||
                  oy0 > ibox.maxy || oy1 < ibox.miny) continue;
              pairs.push(a.li < b.li ? [a, b] : [b, a]);
            }
          }
        }
        /* the cross product's visit order, so an exact-tie pick cannot flip */
        pairs.sort((p, q) => (p[0].li - q[0].li) || (p[1].li - q[1].li) ||
          (p[0].pi - q[0].pi) || (p[1].pi - q[1].pi));
        for (const [A, B] of pairs) {
          for (const p of G.primIntersect(A.prim, B.prim)) consider(p.x, p.y, 'int');
        }
      }

      /* perpendicular / tangent are measured from the command's base point;
         a foot/tangency only lands if it beats the best snap so far, so the
         reference-clipping box rides the same shrinking radius */
      if (base) {
        const rB = Math.min(tolW, bestD);
        const bbox = { minx: worldRaw.x - rB, miny: worldRaw.y - rB,
          maxx: worldRaw.x + rB, maxy: worldRaw.y + rB };
        for (const ent of nearEnts) {
          if (modeOn('perp')) for (const p of G.perpPoints(ent, base, bbox)) consider(p.x, p.y, 'perp');
          if (modeOn('tan')) for (const p of G.tangentPoints(ent, base, bbox)) consider(p.x, p.y, 'tan');
        }
      }

      /* extension: project the cursor onto rays acquired from endpoints */
      if (modeOn('ext')) {
        for (const q of acqExt) {
          for (const ang of q.dirs) {
            const ux = Math.cos(ang), uy = Math.sin(ang);
            const t = (worldRaw.x - q.x) * ux + (worldRaw.y - q.y) * uy;
            if (t <= tolW) continue; /* behind or at the endpoint itself */
            consider(q.x + ux * t, q.y + uy * t, 'ext', { from: { x: q.x, y: q.y } });
          }
        }
      }

      /* parallel: cursor direction from the base near an acquired angle */
      if (modeOn('par') && base) {
        const dx = worldRaw.x - base.x, dy = worldRaw.y - base.y;
        const d = Math.hypot(dx, dy);
        if (d > 1e-9) {
          const cur = Math.atan2(dy, dx);
          for (const pa of acqPar) {
            for (const ang of [pa, pa + Math.PI]) {
              let da = cur - ang;
              da = Math.atan2(Math.sin(da), Math.cos(da));
              if (Math.abs(da) > Math.PI / 2) continue;
              if (Math.abs(Math.sin(da)) * d * vp.scale > TRACK_PX) continue;
              const t = d * Math.cos(da);
              consider(base.x + Math.cos(ang) * t, base.y + Math.sin(ang) * t, 'par',
                { base: { x: base.x, y: base.y }, ang });
            }
          }
        }
      }

      /* OBJECT SNAP TRACKING (F11): a point acquired by resting on it casts
         alignment rays — Ortho's four, or every polar angle when the
         Drafting Settings say so — and the cursor near one rides the ray.
         Near the crossing of two rays from two acquired points, the
         crossing itself is the snap: the "snap to a point, move off it,
         snap in line with another" the industry standard's move.

         A REAL OBJECT SNAP OUTRANKS A RAY. consider() ranks by distance
         alone, and a ray through a corner passes nearer the cursor than
         the corner itself for all but the last pixel — so the ray cast
         from the previous pick was swallowing the endpoint or midpoint
         being aimed at. ARC shows it worst: three point prompts in a row,
         and the ray from each pick runs along the very edge the next
         point wants. The industry standard gives the marker to the snap and leaves the
         ray as the line drawn behind it. Extension and Parallel are rides
         themselves, so they do not count as the snap that wins. */
      const rideKind = { ext: 1, par: 1 };
      const haveObjectSnap = !!best && !rideKind[best.kind];
      if (Nasj.settings.otrack && acqTrk.length && awaitingPt && !haveObjectSnap) {
        const step = Nasj.settings.otrackAll
          ? (Nasj.settings.polarAng > 0 ? Nasj.settings.polarAng : 90) * DEG
          : Math.PI / 2;
        const rays = [];
        for (const q of acqTrk) {
          for (let a = 0; a < TAU - 1e-9; a += step) {
            const ux = Math.cos(a), uy = Math.sin(a);
            const t = (worldRaw.x - q.x) * ux + (worldRaw.y - q.y) * uy;
            if (t <= tolW) continue;             /* behind or on the point */
            const px = q.x + ux * t, py = q.y + uy * t;
            if (Math.hypot(px - worldRaw.x, py - worldRaw.y) > tolW) continue;
            rays.push({ q, ux, uy, ang: a, px, py });
          }
        }
        /* two rays crossing: the crossing outranks riding either ray —
           when one is in reach, the rays themselves stand down */
        const crossings = [];
        for (let i = 0; i < rays.length; i++) {
          for (let j = i + 1; j < rays.length; j++) {
            const A = rays[i], B = rays[j];
            if (A.q === B.q) continue;
            const den = A.ux * B.uy - A.uy * B.ux;
            if (Math.abs(den) < 1e-9) continue;
            const t = ((B.q.x - A.q.x) * B.uy - (B.q.y - A.q.y) * B.ux) / den;
            if (t <= 0) continue;
            const ix = A.q.x + A.ux * t, iy = A.q.y + A.uy * t;
            if (Math.hypot(ix - worldRaw.x, iy - worldRaw.y) > tolW) continue;
            crossings.push({ ix, iy, from: { x: A.q.x, y: A.q.y }, ang: A.ang });
          }
        }
        if (crossings.length) {
          for (const c of crossings) {
            consider(c.ix, c.iy, 'trk', { from: c.from, ang: c.ang });
          }
        } else {
          for (const r of rays) {
            consider(r.px, r.py, 'trk', { from: { x: r.q.x, y: r.q.y }, ang: r.ang });
          }
        }
      }

      /* nearest only bites when no geometric snap did */
      if (!best && modeOn('near')) {
        for (const ent of nearEnts) {
          const p = G.closestPointOnEntity(ent, worldRaw, abox);
          if (p) consider(p.x, p.y, 'near');
        }
      }

      if (best) {
        world = { x: best.x, y: best.y };
        mark = best;
        if (best.kind === 'par') {
          Nasj.ui.polarTrack = {
            base: best.base, point: world, ang: best.ang, kind: 'par',
            dist: Math.hypot(world.x - best.base.x, world.y - best.base.y)
          };
        } else if (best.kind === 'trk') {
          Nasj.ui.polarTrack = {
            base: best.from, point: world, ang: best.ang, kind: 'trk',
            dist: Math.hypot(world.x - best.from.x, world.y - best.from.y)
          };
        }
      }

      /* hover acquisition for the tracking osnaps. Extension only reads
         prims ending on the snapped point itself, so its clipping box is a
         sliver around that point — a monster reference expands next to
         nothing for it. */
      if (awaitingPt) {
        if (modeOn('ext') && best && best.kind === 'end') {
          acquireExt(best, nearEnts, { minx: best.x - 1e-6, miny: best.y - 1e-6,
            maxx: best.x + 1e-6, maxy: best.y + 1e-6 });
        }
        if (modeOn('par')) acquirePar(worldRaw, tolW, nearEnts, abox);
        /* OTRACK acquisition: resting on any hard osnap point takes it —
           the little + the industry standard leaves behind — for the rays above */
        if (Nasj.settings.otrack && best && ACQ_KINDS[best.kind]) {
          if (!acqTrk.some((q) => samePt(q, best))) {
            acqTrk.push({ x: best.x, y: best.y });
            if (acqTrk.length > 3) acqTrk.shift();
          }
        }
      }
    }

    if (!mark && Nasj.settings.snap && !Nasj.settings.snapPolar) {
      /* snap spacing is its own pair of numbers (Drafting Settings), and
         falls back to the grid's when it has never been set. With the snap
         type on PolarSnap the grid rounding stands aside entirely — the
         snapping happens along the polar ray, in applyOrthoPolar. */
      const g = Nasj.settings.gridSize > 0 ? Nasj.settings.gridSize : 10;
      const sx = Nasj.settings.snapX > 0 ? Nasj.settings.snapX : g;
      const sy = Nasj.settings.snapY > 0 ? Nasj.settings.snapY : g;
      world = { x: Math.round(world.x / sx) * sx, y: Math.round(world.y / sy) * sy };
    }

    Nasj.ui.snapMark = mark;
    return { world, worldRaw, screen };
  };

  /* ---------------- ortho / polar constraint ---------------- */
  /* DRAWING UP THE Z AXIS. In a 3D view the pointer lands on the z=0 plane,
     so on its own it can never say 'go up'. This asks the SCREEN instead:
     +Z through the base point has a direction on screen, and a cursor lying
     along it means the user is drawing up the Z axis. The distance is read
     off that same screen direction and handed back as a real z, which is
     what makes the point three-dimensional rather than the plane point
     underneath it. Returns null when the cursor is not near the axis, so
     ordinary ground-plane drawing is untouched. */
  const Z_APERTURE = 12;                 /* screen px, like the polar aperture */
  const zAxisLock = (base, aperture) => {
    if (!view3d.active) return null;
    const s = Nasj.ui.cursor.screen;
    if (!s) return null;
    const bz = (typeof base.z === 'number' && isFinite(base.z)) ? base.z : 0;
    const O = vp.worldToScreen({ x: base.x, y: base.y, z: bz });
    const T = vp.worldToScreen({ x: base.x, y: base.y, z: bz + 1 });
    const vx = T.x - O.x, vy = T.y - O.y;
    const pxPerUnit = Math.hypot(vx, vy);
    /* looking straight down the Z axis it has no direction on screen, and
       nothing can be drawn along it — a plan view, in other words */
    if (!(pxPerUnit > 0.5)) return null;
    const ux = vx / pxPerUnit, uy = vy / pxPerUnit;
    const dx = s.x - O.x, dy = s.y - O.y;
    const along = dx * ux + dy * uy;              /* px up the axis */
    const off = Math.abs(dx * -uy + dy * ux);     /* px away from it */
    if (off > (aperture === undefined ? Z_APERTURE : aperture)) return null;
    const t = along / pxPerUnit;
    return { x: base.x, y: base.y, z: bz + t, zdist: t };
  };
  Nasj.zAxisLock = zAxisLock;

  Nasj.applyOrthoPolar = (base, p) => {
    if (!base || !p) return p;
    const ui = Nasj.ui;
    if (ui.snapMark) return p; /* an object snap beats ortho/polar (the industry standard) */
    const bz = (typeof base.z === 'number' && isFinite(base.z)) ? base.z : 0;
    /* a base standing off the ground keeps its height: tracking runs in
       the plane THROUGH the base, the industry standard's way, instead of dropping the
       next point back to the ground the cursor maps onto */
    const keepZ = (q) => (bz ? { x: q.x, y: q.y, z: bz } : q);
    /* ON A STANDING PLANE the constraint belongs to the plane's own two
       axes: drawing 'across' the ZY plane runs along Y and 'up' it runs
       along Z, and neither is a world X or Y the flat rule below could
       give. The nearer of the two wins, measured on screen. The same
       screen-measured lock serves the ground plane whenever the base has a
       height — its X and Y rays run AT that height, which the flat rule
       below could never say. */
    if (view3d.active && ((Nasj.ucs && Nasj.ucs.plane) || bz) &&
        (Nasj.settings.ortho || Nasj.settings.polar)) {
      const f = ucsFrame();
      const apx = Nasj.settings.ortho ? 26 : Z_APERTURE;
      const S = Nasj.ui.cursor.screen;
      const B = vp.worldToScreen({ x: base.x, y: base.y, z: bz });
      let win = null, winOff = Infinity;
      [[f.u, f.label[0]], [f.v, f.label[1]]].forEach(([d, name]) => {
        const T = vp.worldToScreen({ x: base.x + d[0], y: base.y + d[1], z: bz + d[2] });
        const vx = T.x - B.x, vy = T.y - B.y;
        const px = Math.hypot(vx, vy);
        if (!(px > 0.5) || !S) return;                /* that axis is end-on */
        const ux = vx / px, uy = vy / px;
        const dx = S.x - B.x, dy = S.y - B.y;
        const along = dx * ux + dy * uy;
        const off = Math.abs(dx * -uy + dy * ux);
        if (off > apx || off >= winOff) return;
        const t = along / px;
        winOff = off;
        win = {
          t,
          name: (t >= 0 ? '+' : '-') + name,
          p: { x: base.x + d[0] * t, y: base.y + d[1] * t, z: bz + d[2] * t },
        };
      });
      if (win && Math.abs(win.t) > 1e-9) {
        ui.polarTrack = {
          base: { x: base.x, y: base.y, z: bz },
          point: win.p, dist: Math.abs(win.t), ang: 0,
          axis: win.name, kind: 'polar',
        };
        return win.p;
      }
    }
    /* the Z axis answers first in 3D, for both ortho and polar: it is the
       one direction the ground plane cannot offer */
    if (view3d.active && (Nasj.settings.ortho || Nasj.settings.polar)) {
      const z = zAxisLock(base, Nasj.settings.ortho ? 26 : Z_APERTURE);
      if (z && Math.abs(z.zdist) > 1e-9) {
        ui.polarTrack = {
          base: { x: base.x, y: base.y, z: (typeof base.z === 'number' ? base.z : 0) },
          point: { x: z.x, y: z.y, z: z.z },
          dist: Math.abs(z.zdist),
          ang: 0,
          axis: z.zdist >= 0 ? '+Z' : '-Z',
          kind: 'polar',
        };
        return { x: z.x, y: z.y, z: z.z };
      }
    }
    if (Nasj.settings.ortho) {
      /* ortho locks to the axes the user SEES: in a twisted view those are
         the turned ones, so the constraint is applied in the view's frame
         and the point comes back out into the world */
      if (vp.twist) {
        const b = rotW(base), q = rotW(p);
        const c = (Math.abs(q.x - b.x) >= Math.abs(q.y - b.y))
          ? { x: q.x, y: b.y } : { x: b.x, y: q.y };
        return keepZ(unrotW(c));
      }
      return keepZ((Math.abs(p.x - base.x) >= Math.abs(p.y - base.y))
        ? { x: p.x, y: base.y }
        : { x: base.x, y: p.y });
    }
    if (Nasj.settings.polar) {
      const dx = p.x - base.x, dy = p.y - base.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-9) return p;
      const step = (Nasj.settings.polarAng > 0 ? Nasj.settings.polarAng : 90) * DEG;
      /* the rays are counted from the axis on screen, so a twisted view
         shifts them with it — 0 deg stays the horizontal the user sees */
      const a = Math.atan2(dy, dx);
      /* Polar Angle measurement: Absolute counts the rays from the axis;
         Relative to last segment counts them from the direction the last
         segment ran, so a chain turns by the increment each time */
      let off = 0;
      if (Nasj.settings.polarRel && Nasj.pref && Nasj.pref.lastEnd &&
          typeof Nasj.pref.lastEnd.ang === 'number' && isFinite(Nasj.pref.lastEnd.ang)) {
        off = Nasj.pref.lastEnd.ang;
      }
      let k = Math.round((a + twist - off) / step) * step + off - twist;
      /* the additional angles stand alongside the increment's rays; the
         nearest of all of them wins */
      if (Nasj.settings.polarUseExtra && Array.isArray(Nasj.settings.polarExtra)) {
        const norm = (x) => Math.atan2(Math.sin(x), Math.cos(x));
        let best = Math.abs(norm(a - k));
        for (const degA of Nasj.settings.polarExtra) {
          if (!isFinite(degA)) continue;
          const cand = degA * DEG + off - twist;
          for (const c of [cand, cand + Math.PI]) {
            const e = Math.abs(norm(a - c));
            if (e < best) { best = e; k = c; }
          }
        }
      }
      const da = a - k;
      /* industry-standard-style aperture: lock onto the polar ray only when the cursor
         is within a few pixels of it; otherwise the cursor stays free */
      if (Math.abs(Math.sin(da)) * d * vp.scale <= TRACK_PX) {
        let t = d * Math.cos(da);
        /* PolarSnap: with snap mode on and the type polar, the distance
           along the ray goes in polar-distance steps — a 0 distance follows
           the snap X spacing, and that the grid's (the industry standard's fallbacks) */
        if (Nasj.settings.snap && Nasj.settings.snapPolar) {
          const inc = Nasj.settings.polarDist > 0 ? Nasj.settings.polarDist
            : (Nasj.settings.snapX > 0 ? Nasj.settings.snapX
              : (Nasj.settings.gridSize > 0 ? Nasj.settings.gridSize : 10));
          t = Math.round(t / inc) * inc;
        }
        if (t > 1e-9) {
          const q = keepZ({ x: base.x + Math.cos(k) * t, y: base.y + Math.sin(k) * t });
          ui.polarTrack = { base: keepZ({ x: base.x, y: base.y }),
            point: q, ang: k, dist: t, kind: 'polar' };
          return q;
        }
      }
    }
    return p;
  };

  /* ---------------- PNG export ---------------- */
  Nasj.canvasDataUrl = () => {
    if (!canvas) return '';
    const c = document.createElement('canvas');
    c.width = canvas.width || 1;
    c.height = canvas.height || 1;
    const c2d = c.getContext('2d');
    c2d.fillStyle = COL.bg;
    c2d.fillRect(0, 0, c.width, c.height);
    c2d.drawImage(canvas, 0, 0);
    return c.toDataURL('image/png');
  };

  /* ---------------- plot renderer (Plot dialog) ----------------
   * Nasj.plotRender(opts) -> HTMLCanvasElement (offscreen, plot quality).
   * opts: {area:'display'|'extents'|'window', win:{a,b}|null, paperMm:{w,h},
   *   marginMm, landscape, upsideDown, fitToPaper, mmPerUnit (paper mm per
   *   drawing unit, used when !fitToPaper), offsetMm:{x,y}, centerPlot, dpi,
   *   styleTable:'none'|'monochrome'|'grayscale', useLineweights, plotStamp,
   *   pocheWalls (solid-fill closed polylines on A-WALL* layers),
   *   shadeVstyle: visual-style flags {fills,edges,gray,alpha,hidden} that
   *   stand in for the drawing's style (Shade plot), or null as displayed}.
   * Reuses the live entity-path pipeline (entPath/strokeEntity/…) by
   * temporarily swapping the viewport's world→screen mapping — same trick as
   * the paper-space preview, but at full print resolution on white paper.
   */
  const hexRgb = (hex) => {
    if (typeof hex !== 'string' || hex[0] !== '#') return null;
    let h = hex.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return null;
    const n = parseInt(h, 16);
    if (Number.isNaN(n)) return null;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  const luminance = (hex) => {
    const c = hexRgb(hex);
    if (!c) return 0.5;
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  };
  /* ink laid at `pct` intensity on white paper — the industry standard's screening */
  const mixToPaper = (hex, pct) => {
    const c = hexRgb(hex);
    if (!c) return hex;
    const v = (n) => Math.round(255 + (n - 255) * pct);
    return 'rgb(' + v(c.r) + ',' + v(c.g) + ',' + v(c.b) + ')';
  };
  const toGrayHex = (hex) => {
    const v = Math.round(Math.min(1, Math.max(0, luminance(hex))) * 255);
    const g = ('0' + v.toString(16)).slice(-2);
    return '#' + g + g + g;
  };

  /* The plot's geometry, shy of any pixels: paper (mm, orientation applied),
     margin, the plotted world bounds B for the chosen area, the scale kmm
     (paper mm per drawing unit) and the resolved offsets. Shared by the
     real plot and the dialog's partial-preview thumbnail, so the hatch on
     the little sheet is the truth about the big one. */
  const plotLayout = (opts) => {
    opts = opts || {};
    const doc = Nasj.doc;

    /* paper geometry (mm) — paperMm is the portrait sheet; landscape swaps */
    const nom = opts.paperMm && opts.paperMm.w > 0 && opts.paperMm.h > 0
      ? opts.paperMm : { w: 210, h: 297 };
    const pw = opts.landscape ? Math.max(nom.w, nom.h) : Math.min(nom.w, nom.h);
    const ph = opts.landscape ? Math.min(nom.w, nom.h) : Math.max(nom.w, nom.h);
    const margin = (isFinite(opts.marginMm) && opts.marginMm >= 0) ? opts.marginMm : 5;

    /* what to plot — world-space bounds */
    let B = null;
    if (opts.area === 'window' && opts.win && opts.win.a && opts.win.b) {
      B = {
        minx: Math.min(opts.win.a.x, opts.win.b.x),
        miny: Math.min(opts.win.a.y, opts.win.b.y),
        maxx: Math.max(opts.win.a.x, opts.win.b.x),
        maxy: Math.max(opts.win.a.y, opts.win.b.y)
      };
    } else if (opts.area === 'extents' && doc) {
      const list = visibleEntities(doc);
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const ent of list) {
        if (typeof ent.aisel === 'number') continue;
        const b = Nasj.geom.entityBounds(ent);
        if (b.minx < minx) minx = b.minx;
        if (b.miny < miny) miny = b.miny;
        if (b.maxx > maxx) maxx = b.maxx;
        if (b.maxy > maxy) maxy = b.maxy;
      }
      if (isFinite(minx)) B = { minx, miny, maxx, maxy };
    } else if (opts.area === 'limits') {
      /* the industry standard's Limits: the LIMITS rectangle prints, whatever it holds */
      B = limitsRect(doc);
    }
    if (!B) B = viewWorldBounds();           /* 'display' + fallbacks */

    /* A 3D view plots as seen: every point rides the view's own projection
       (worldToView3, orthographic) into the paper mapping, and the plotted
       bounds are the projection of the drawing's 3D box — plan bounds say
       nothing about where an isometric lands. */
    const in3d = view3d.active;
    if (in3d && doc) {
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const ent of visibleEntities(doc)) {
        const b = Nasj.geom.entityBounds(ent);
        const zr = zRangeOf(ent);
        for (const zz of zr) {
          for (const c of [[b.minx, b.miny], [b.maxx, b.miny],
            [b.minx, b.maxy], [b.maxx, b.maxy]]) {
            const q = worldToView3({ x: c[0], y: c[1], z: zz });
            if (q.x < minx) minx = q.x;
            if (q.y < miny) miny = q.y;
            if (q.x > maxx) maxx = q.x;
            if (q.y > maxy) maxy = q.y;
          }
        }
      }
      if (isFinite(minx)) B = { minx, miny, maxx, maxy };
    }

    const availW = Math.max(pw - 2 * margin, 1);
    const availH = Math.max(ph - 2 * margin, 1);
    const bw = Math.max(B.maxx - B.minx, 1e-9);
    const bh = Math.max(B.maxy - B.miny, 1e-9);

    /* scale (paper mm per drawing unit) + plot offset (mm) */
    let kmm;
    if (opts.fitToPaper !== false) kmm = Math.min(availW / bw, availH / bh);
    else kmm = (isFinite(opts.mmPerUnit) && opts.mmPerUnit > 0) ? opts.mmPerUnit : 1;
    if (!isFinite(kmm) || kmm <= 0) kmm = 1;
    let offX = (opts.offsetMm && isFinite(opts.offsetMm.x)) ? opts.offsetMm.x : 0;
    let offY = (opts.offsetMm && isFinite(opts.offsetMm.y)) ? opts.offsetMm.y : 0;
    if (opts.centerPlot) {
      offX = (availW - bw * kmm) / 2;
      offY = (availH - bh * kmm) / 2;
    }
    return { pw, ph, margin, availW, availH, B, bw, bh, kmm, offX, offY, in3d };
  };
  Nasj.plotLayout = plotLayout;

  Nasj.plotRender = (opts) => {
    resetFontCache();      /* fresh offscreen context, fresh font state */
    opts = opts || {};
    const doc = Nasj.doc;

    const { pw, ph, margin, availW, availH, B, kmm, offX, offY, in3d } = plotLayout(opts);

    /* raster size: paper mm at dpi, capped ~12000px per side */
    const dpi = (isFinite(opts.dpi) && opts.dpi >= 36) ? Math.min(opts.dpi, 2400) : 300;
    let ppm = dpi / 25.4;                    /* device px per paper mm */
    let CW = Math.round(pw * ppm), CH = Math.round(ph * ppm);
    const CAP = 12000;
    if (CW > CAP || CH > CAP) {
      const f = Math.min(CAP / CW, CAP / CH);
      CW = Math.max(1, Math.round(CW * f));
      CH = Math.max(1, Math.round(CH * f));
      ppm *= f;
    }

    /* Plot style table. "screenN" is the industry standard's screening: the ink goes down at
       N% intensity, which on white paper is the colour blended that far from
       the page. acad.ctb and DWF Virtual Pens plot in the object's own colour —
       pen numbers only matter to a pen-based device. */
    const stName = String(opts.styleTable || 'none');
    const screen = /^screen(\d+)$/.exec(stName);
    const mode = stName === 'monochrome' ? 'mono' : (stName === 'grayscale' ? 'gray' : 'color');
    const screenPct = screen ? Math.min(100, Math.max(0, Number(screen[1]))) / 100 : 1;
    plotFillPatterns = stName === 'fillpat';
    /* Per-colour rules from an edited plot style table (the Editor), keyed
       by the object colour's nearest ACI index exactly as a .ctb is. They
       carry the whole colour treatment, the table's own seeds included, so
       the name-derived mode above must not double-apply. */
    const rules = Array.isArray(opts.styleRules) ? opts.styleRules : null;
    const aciCache = new Map();
    const aciOf = (hex) => {
      if (typeof hex !== 'string' || hex[0] !== '#' || !Nasj.dxf) return 7;
      let a = aciCache.get(hex);
      if (a === undefined) { a = Nasj.dxf.nearestAci(hex); aciCache.set(hex, a); }
      return a;
    };
    const ruleLw = (hex) => {
      const r = rules && rules[aciOf(hex)];
      return r && r.lw > 0 ? r.lw : 0;
    };
    const mapColor = (col, ent) => {
      if (ent && ent.color === '@bg') return '#ffffff';   /* wipeouts stay paper-white */
      let c = col;
      if (rules) {
        const r = rules[aciOf(typeof c === 'string' ? c : '#ffffff')];
        if (r) {
          if (r.color) c = r.color;   /* a pinned colour prints as pinned */
          else if (typeof c === 'string' && c[0] === '#' && luminance(c) > 0.86) c = '#1b1b1b';
          if (r.gray) c = toGrayHex(c);
          const s = Math.min(100, Math.max(0, r.screening)) / 100;
          return s < 1 ? mixToPaper(c, s) : c;
        }
      }
      if (mode === 'mono') c = '#000000';
      else {
        if (typeof c === 'string' && c[0] === '#' && luminance(c) > 0.86) c = '#1b1b1b';
        if (mode === 'gray') c = toGrayHex(c);
      }
      return screenPct < 1 ? mixToPaper(c, screenPct) : c;
    };

    const out = document.createElement('canvas');
    out.width = CW;
    out.height = CH;
    const c2d = out.getContext('2d');
    /* PublishToWeb PNG (Transparent): the drawing without the sheet under it */
    if (!opts.transparentBg) {
      c2d.fillStyle = '#ffffff';
      c2d.fillRect(0, 0, CW, CH);
    }

    if (doc) {
      c2d.save();
      /* clip to the printable area; a uniform margin is symmetric, so the
         same rect is valid before and after the upside-down rotation */
      c2d.beginPath();
      c2d.rect(margin * ppm, margin * ppm, availW * ppm, availH * ppm);
      c2d.clip();
      if (opts.upsideDown) {                 /* rotate the whole plot 180° */
        c2d.translate(CW, CH);
        c2d.rotate(Math.PI);
      }

      /* swap the world→screen mapping under the shared draw pipeline */
      const savedW2S = vp.worldToScreen;
      const savedScale = vp.scale;
      const savedKnock = knockoutColor;
      vp.worldToScreen = (p) => {
        const q = in3d ? worldToView3(p) : p;
        return {
          x: (margin + offX + (q.x - B.minx) * kmm) * ppm,
          y: CH - (margin + offY + (q.y - B.miny) * kmm) * ppm
        };
      };
      vp.scale = kmm * ppm;
      knockoutColor = '#ffffff';
      plotColorMap = mapColor;
      plotDashScale = Math.max(1, ppm * 25.4 / 96);   /* dashes keep ~96dpi look */
      const savedPoche = pocheMode;
      pocheMode = !!opts.pocheWalls;                  /* "Poché walls" plot option */
      plotOpaqueFills = !opts.transparency;           /* "Plot transparency" */
      /* "Scale lineweights": weights follow the plot scale (1:2 halves them)
         instead of printing at absolute mm */
      const lwK = (isFinite(opts.lineweightScale) && opts.lineweightScale > 0)
        ? opts.lineweightScale : 1;
      /* Shade plot: the chosen mode's flags stand in for the drawing's own
         visual style for the length of the plot — "As displayed" hands in
         nothing and the screen's style plots. Faces shade only in a 3D
         view, as on screen: a plan has nothing to hide behind anything. */
      const savedVstyle = Object.assign({}, vstyle);
      if (opts.shadeVstyle) Object.assign(vstyle, opts.shadeVstyle);
      try {
        const lmap = layerMap(doc);
        let list = visibleEntities(doc).filter(e => typeof e.aisel !== 'number');
        if (shaded3d()) {
          /* the screen's CPU shaded pass, at paper resolution: bodies taken
             apart into faces, back faces dropped (kept in X-Ray), everything painted
             far-to-near by the depth of its own centre */
          const items = [], key = new Map();
          const depthOf = (pts) => {
            let x = 0, y = 0, z = 0, k = 0;
            for (const q of pts) {
              x += q.x; y += q.y; z += (typeof q.z === 'number' && isFinite(q.z)) ? q.z : 0; k++;
            }
            return worldToDepth3({ x: x / k, y: y / k, z: z / k });
          };
          for (const it of bodyItemsOf(doc, list)) {
            if (it.face && !xray() && !faceVisible(it.face)) continue;
            items.push(it);
            key.set(it, depthOf(it.face ? it.face.pts : it.wire));
          }
          for (const ent of list) {
            if (ent.type === 'face3d' || Nasj.solid.isBody(ent)) continue;
            const b = boundsOf(ent), zr = zRangeOf(ent);
            items.push(ent);
            key.set(ent, worldToDepth3({ x: (b.minx + b.maxx) / 2, y: (b.miny + b.maxy) / 2, z: (zr[0] + zr[1]) / 2 }));
          }
          list = items.sort((a, b) => key.get(b) - key.get(a));
        }
        for (const item of list) {
          const ent = (item.face || item.wire) ? item.ent : item;
          const ly = lmap.get(ent.layerId);
          const raw = item.col || Nasj.docOps.resolveColor(doc, ent);
          const col = mapColor(raw, ent);
          if (item !== ent) {          /* one face, or one wire, of a body */
            if (item.face) drawFace(c2d, item.face, col, lockedAlpha(ly), false, false);
            else strokeRun(c2d, item.wire, false, col, 1.4 * plotDashScale, lockedAlpha(ly), null);
            continue;
          }
          /* an edited table may pin this colour's lineweight (mm) */
          const lwOver = ruleLw(typeof raw === 'string' ? raw : '#ffffff');
          const width = (opts.useLineweights !== false)
            ? Math.max(1, (lwOver > 0 ? lwOver : Nasj.docOps.resolveLw(doc, ent)) * lwK * ppm)
            : 1;
          strokeEntity(c2d, ent, col, width, null, lockedAlpha(ly), true);
        }
      } finally {
        Object.assign(vstyle, savedVstyle);
        vp.worldToScreen = savedW2S;
        vp.scale = savedScale;
        knockoutColor = savedKnock;
        plotColorMap = null;
        plotDashScale = 0;
        pocheMode = savedPoche;
        plotOpaqueFills = false;
        plotFillPatterns = false;
      }
      c2d.restore();
    }

    if (opts.plotStamp) {                    /* 8pt gray stamp, bottom-left */
      const px = Math.max(6, 8 * (ppm * 25.4) / 72);
      c2d.save();
      c2d.fillStyle = '#8a8a8a';
      c2d.font = px + 'px "Segoe UI", sans-serif';
      c2d.textAlign = 'left';
      c2d.textBaseline = 'bottom';
      const name = (doc && doc.name) ? String(doc.name) : 'Drawing';
      const when = new Date().toLocaleString();
      c2d.fillText(name + ' — ' + when + ' — Nasjicad V' + (window.NASJ_VERSION || ''), margin * ppm + 2, CH - Math.max(2, margin * ppm * 0.25));
      c2d.restore();
    }

    return out;
  };

  /* UNTANGLE: a crossing loop tears a fill — a wedge out of the 2D
     even-odd paint, triangle soup out of the GL ear clipper. Classic 2-opt
     uncrossing: reversing the run between two crossing segments removes
     the crossing and keeps the area. Loops here are small (a simplified
     trace, a snapped boundary), so a few O(n²) passes settle it. Works in
     place; hands the loop back. */
  const loopSegX = (a, b, c, e2) => {
    const d1 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const d2 = (b.x - a.x) * (e2.y - a.y) - (b.y - a.y) * (e2.x - a.x);
    const d3 = (e2.x - c.x) * (a.y - c.y) - (e2.y - c.y) * (a.x - c.x);
    const d4 = (e2.x - c.x) * (b.y - c.y) - (e2.y - c.y) * (b.x - c.x);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  const loopSelfXing = (l) => {
    const n = l.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (loopSegX(l[i], l[(i + 1) % n], l[j], l[(j + 1) % n])) return true;
      }
    }
    return false;
  };
  const untangleLoop = (l) => {
    const n = l.length;
    if (n < 4) return l;
    for (let pass = 0; pass < 8; pass++) {
      let fixed = false;
      for (let i = 0; i < n && !fixed; i++) {
        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue;
          if (!loopSegX(l[i], l[(i + 1) % n], l[j], l[(j + 1) % n])) continue;
          for (let a2 = i + 1, b2 = j; a2 < b2; a2++, b2--) {
            const t2 = l[a2];
            l[a2] = l[b2];
            l[b2] = t2;
          }
          fixed = true;
          break;
        }
      }
      if (!fixed) break;
    }
    return l;
  };
  Nasj.untangleLoop = untangleLoop;
  Nasj.loopSelfXing = loopSelfXing;

  /* ---------------- boundary tracer (HATCH pick-internal-point) --------
   * Nasj.makeBoundaryTracer() -> { at(world) -> {pts, islands}|null } | null.
   *
   * the industry standard finds the enclosed area around a picked point analytically; we
   * find it the raster way, which handles ANY drawn geometry uniformly:
   *   1. every visible entity except hatches is stroked black-on-white into
   *      an offscreen raster over the drawing extents (dashes forced solid —
   *      a dashed wall still bounds a hatch, exactly like the industry standard);
   *   2. a flood fill from the picked point walks the blank paper; reaching
   *      the raster border means "not enclosed" (the industry standard's error case);
   *   3. the region's border edges are chained into loops — the largest is
   *      the boundary, the rest are islands (Outer island detection) — and
   *      each loop is Douglas-Peucker-simplified back into world points.
   * The raster is the VIEW, not the drawing: a hatch is picked on screen,
   * so only what the view can see can bound it. Rebuilt when the view or
   * the document moves; hover then pays only the flood. */
  Nasj.makeBoundaryTracer = () => {
    let built = null;                /* the view raster, viewSig-keyed */
    let rasters = new Map();         /* escalated rasters, one per box */
    let rastersSig = '';
    let extMemo = null;              /* drawing extents box, found lazily */
    /* one raster over a world box. The VIEW box may ride the GL picture —
       with GL live the view is already a picture of every owned stroke,
       and at extents on BLOCKS.dwg the old path walked 241k entities into
       a 2048 raster (1.4s on first HATCH hover). Any other box strokes
       only what the spatial index finds inside it. */
    let builds = 0;              /* rasters built — the cache's honesty meter */
    /* TEXT IS A BOX, NOT ITS LETTERS. the industry standard bounds a hatch at a text's
       rectangle — the fill stops at the box and the number stays legible
       inside it. Stroking the glyph outlines instead let the flood run
       between and through the letters: a SOLID fill then buried a
       dimension's number whole (white on white), or cut ragged letter-shaped
       holes where the region's edge crossed it. So a text's four corners
       (rotated with it) are painted solid into the raster in place of its
       outline, and the traced island is the box the industry standard leaves. */
    const isTextBox = (e) => e.type === 'text' || e.type === 'attdef';
    const fillTextBox = (g, e, toPx) => {
      let segs = null;
      try { segs = Nasj.geom.entitySegs(e, 1e-3); } catch (_) { segs = null; }
      if (!segs || segs.length < 3) return false;
      g.beginPath();
      segs.forEach((sg, i) => { const q = toPx(sg[0]); if (i === 0) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]); });
      g.closePath();
      g.fill();
      return true;
    };
    const buildRaster = (box, allowGl) => {
      builds++;
      const doc = Nasj.doc;
      if (!doc) return null;
      const minx = box.minx, miny = box.miny, maxx = box.maxx, maxy = box.maxy;
      if (!isFinite(minx) || !isFinite(maxx) || maxx <= minx || maxy <= miny) return null;
      const lmap = layerMap(doc);
      /* spatialRect answers null when the index is unbuilt or the rect
         spans too many cells — the full walk stands in */
      const raw0 = (typeof Nasj.spatialRect === 'function')
        ? Nasj.spatialRect(minx, miny, maxx, maxy) : null;
      /* the GL picture is a fallback for HEAVY boxes only: a few hundred
         entities stroke at 2048 in a millisecond and come out crisper
         than a screen-resolution blit ever can */
      const heavy = raw0 ? raw0.length > 4000 : doc.entities.length > 4000;
      const rest = (allowGl && heavy && Nasj.glscene && Nasj.glscene.live()
        && Nasj.glscene.remainder) ? Nasj.glscene.remainder() : null;
      const glCv = (typeof document !== 'undefined')
        ? document.getElementById('gl-canvas') : null;
      const useGl = !!(rest && glCv && glCv.width > 1 && glCv.height > 1);
      let list = [];
      const raw = useGl ? rest : (raw0 || doc.entities);
      for (const e of raw) {
        if (!e || e.type === 'hatch') continue;
        if (!entVisible(e, lmap)) continue;
        list.push(e);
      }
      if (!list.length && !useGl) return null;
      /* the view is already a picture: 1024 is enough to pick a region,
         and getImageData of 2048² was ~200ms of the first HATCH hover */
      const LONG = useGl ? 1024 : 2048;
      const k = LONG / Math.max(maxx - minx, maxy - miny, 1e-9);
      const W = Math.max(8, Math.min(LONG, Math.round((maxx - minx) * k)));
      const H = Math.max(8, Math.min(LONG, Math.round((maxy - miny) * k)));
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const g = cv.getContext('2d', { willReadFrequently: true });
      /* the GL frame keeps its transparent ground: ink is then ANY drawn
         pixel, read from alpha. Blitting colours onto white and looking
         for dark ones lost every light stroke — a white or yellow wall
         was no wall at all, and the flood walked out through it. */
      if (!useGl) {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, W, H);
      }
      if (useGl) {
        const blitView = (cv2, sx0, sy0, sx1, sy1) => {
          if (!cv2 || cv2.width < 2) return;
          const w00 = vp.screenToWorld({ x: sx0, y: sy0 });
          const w11 = vp.screenToWorld({ x: sx1, y: sy1 });
          const x0 = Math.min(w00.x, w11.x), x1 = Math.max(w00.x, w11.x);
          const y0 = Math.min(w00.y, w11.y), y1 = Math.max(w00.y, w11.y);
          const hx0 = (x0 - minx) * k, hx1 = (x1 - minx) * k;
          const hy0 = H - (y1 - miny) * k, hy1 = H - (y0 - miny) * k;
          g.drawImage(cv2, 0, 0, cv2.width, cv2.height,
            hx0, hy0, hx1 - hx0, hy1 - hy0);
        };
        blitView(glCv, 0, 0, cssW, cssH);
        /* the fills GL painted are NOT walls: a committed hatch reads as
           one solid blob of alpha and poisons every pick near it — the industry standard
           ignores hatches entirely while it hunts a boundary. Erase each
           hatch's own region out of the frame (even-odd with its islands,
           so an island's furniture keeps its strokes) before ink is read. */
        const px = (p) => [(p.x - minx) * k, H - (p.y - miny) * k];
        const loopPath = (path, pts) => {
          if (!Array.isArray(pts) || pts.length < 3) return;
          const p0 = px(pts[0]);
          path.moveTo(p0[0], p0[1]);
          for (let i2 = 1; i2 < pts.length; i2++) {
            const q = px(pts[i2]);
            path.lineTo(q[0], q[1]);
          }
          path.closePath();
        };
        g.save();
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = '#000000';
        for (const e of (raw0 || doc.entities)) {
          if (!e || e.type !== 'hatch' || !entVisible(e, lmap)) continue;
          const b = e.boundary;
          if (!b) continue;
          const path = new Path2D();
          if (b.kind === 'circle' && b.c && b.r > 0) {
            const c2 = px(b.c);
            path.arc(c2[0], c2[1], b.r * k, 0, Math.PI * 2);
          } else if (b.kind === 'ellipse' && b.c && b.rx > 0 && b.ry > 0) {
            const c2 = px(b.c);
            path.ellipse(c2[0], c2[1], b.rx * k, b.ry * k, -(b.rot || 0), 0, Math.PI * 2);
          } else if (Array.isArray(b.pts)) {
            loopPath(path, b.pts);
          } else {
            continue;
          }
          for (const isl of e.islands || []) loopPath(path, isl);
          g.fill(path, 'evenodd');
        }
        g.restore();
        /* GL already holds the walls that bound a hatch. The 2D remainder
           is texts and dims — not hatch edges — and restroking it was the
           rest of the 300ms first hover. The texts among it are walls of
           their own kind, though: each is its box (see fillTextBox). */
        g.fillStyle = '#000000';
        for (const e of rest) {
          if (e && isTextBox(e) && entVisible(e, lmap)) fillTextBox(g, e, px);
        }
        list = [];
      }
      const savedW2S = vp.worldToScreen, savedScale = vp.scale, savedMap = plotColorMap;
      vp.worldToScreen = (p) => ({ x: (p.x - minx) * k, y: H - (p.y - miny) * k });
      vp.scale = k;
      /* a block's children take their own layer's colour (white, on white
         paper, is no wall at all): the plot colour hook makes every stroke
         black, whatever it was */
      plotColorMap = () => '#000000';
      const nearWorld = { minx, miny, maxx, maxy };
      /* SOLID, whatever the linetype says. strokeEntity's primary pass
         applies the entity's own dashes, and a dotted or hidden wall then
         rastered with GAPS the flood walked straight through — "A closed
         boundary could not be determined" on a boundary that is closed.
         the industry standard bounds a hatch by the geometry, not by how it is drawn.
         An empty array is a dash the stroke keeps: setLineDash([]) is
         solid, and it survives into a block's children. */
      const SOLID = [];
      try {
        g.fillStyle = '#000000';
        for (const ent of list) {
          const b = boundsOf(ent);
          if (!b || !isFinite(b.minx)) continue;
          const sx = (b.maxx - b.minx) * k, sy = (b.maxy - b.miny) * k;
          if (sx < 1.5 && sy < 1.5) {
            g.fillRect(((b.minx + b.maxx) / 2 - minx) * k,
              H - ((b.miny + b.maxy) / 2 - miny) * k, 1, 1);
            continue;
          }
          if (isTextBox(ent) &&
              fillTextBox(g, ent, (q) => [(q.x - minx) * k, H - (q.y - miny) * k])) continue;
          const near = (ent.type === 'insert' && Nasj.geom.insertLocalBox)
            ? Nasj.geom.insertLocalBox(ent, nearWorld, doc) : null;
          strokeEntity(g, ent, '#000000', 1.6, SOLID, 1, true, false, near);
        }
      } finally {
        vp.worldToScreen = savedW2S;
        vp.scale = savedScale;
        plotColorMap = savedMap;
      }
      const img = g.getImageData(0, 0, W, H).data;
      const ink = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) {
        const o = i << 2;
        ink[i] = useGl
          ? (img[o + 3] > 16 ? 1 : 0)
          : ((img[o] < 160 || img[o + 1] < 160 || img[o + 2] < 160) ? 1 : 0);
      }
      return { minx, miny, maxx, maxy, k, W, H, ink };
    };
    const viewBox = () => {
      const vb = viewWorldBounds();
      const pad = 48 / (vp.scale || 1);
      return { minx: vb.minx - pad, miny: vb.miny - pad,
        maxx: vb.maxx + pad, maxy: vb.maxy + pad };
    };
    const viewSig = () => {
      const doc = Nasj.doc;
      return vp.scale + '|' + vp.tx + '|' + vp.ty + '|' + (vp.twist || 0) +
        '|' + cssW + 'x' + cssH + '|' + (doc && Nasj.docGen ? Nasj.docGen(doc) : 0);
    };
    const ensure = () => {
      const sig = viewSig();
      if (built && built.sig === sig) return built;
      const rec = buildRaster(viewBox(), true);
      if (!rec) { built = null; return null; }
      rec.sig = sig;
      built = rec;
      return built;
    };
    /* the drawing's extents plus a margin, found only when a region first
       runs off the view — an extents walk is not hover money */
    const extBox = () => {
      if (extMemo) return extMemo;
      const doc = Nasj.doc;
      if (!doc) return null;
      const lmap = layerMap(doc);
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const e of doc.entities) {
        if (!e || e.type === 'hatch') continue;
        if (!entVisible(e, lmap)) continue;
        const b = boundsOf(e);
        if (!b || !isFinite(b.minx)) continue;
        if (b.minx < minx) minx = b.minx;
        if (b.miny < miny) miny = b.miny;
        if (b.maxx > maxx) maxx = b.maxx;
        if (b.maxy > maxy) maxy = b.maxy;
      }
      if (!isFinite(minx) || !isFinite(maxx)) return null;
      const pad = 0.02 * Math.max(maxx - minx, maxy - miny, 1e-9);
      extMemo = { minx: minx - pad, miny: miny - pad,
        maxx: maxx + pad, maxy: maxy + pad };
      return extMemo;
    };
    const LEAK = {};                 /* the flood reached the raster's edge */

    /* perpendicular-distance Douglas-Peucker on a pixel-space loop */
    const rdp = (pts, eps) => {
      if (pts.length <= 3) return pts;
      const keep = new Uint8Array(pts.length);
      keep[0] = keep[pts.length - 1] = 1;
      const stack = [[0, pts.length - 1]];
      while (stack.length) {
        const [a, b] = stack.pop();
        if (b - a < 2) continue;
        const ax = pts[a][0], ay = pts[a][1];
        const dx = pts[b][0] - ax, dy = pts[b][1] - ay;
        const len = Math.hypot(dx, dy) || 1e-9;
        let bi = -1, bd = eps;
        for (let i = a + 1; i < b; i++) {
          const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
          if (d > bd) { bd = d; bi = i; }
        }
        if (bi > 0) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
      }
      const out = [];
      for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
      return out;
    };

    /* the region around `world` on one raster: {pts, islands}, LEAK when
       it runs off the raster, null when the pick sits on a line */
    const trace = (R, world) => {
      const { minx, miny, k, W, H, ink } = R;
      const toWorld = (x, y) => ({ x: minx + x / k, y: miny + (H - y) / k });
      const sx = Math.round((world.x - minx) * k);
      const sy = Math.round(H - (world.y - miny) * k);
      if (sx <= 0 || sy <= 0 || sx >= W - 1 || sy >= H - 1) return LEAK;
      if (ink[sy * W + sx]) return null;               /* picked ON a line */

      /* flood the blank paper around the pick */
      const region = new Uint8Array(W * H);
      const stack = [sy * W + sx];
      region[sy * W + sx] = 1;
      while (stack.length) {
        const i = stack.pop();
        const x = i % W, y = (i / W) | 0;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) return LEAK; /* leaked out */
        const n4 = [i - 1, i + 1, i - W, i + W];
        for (const j of n4) {
          if (!region[j] && !ink[j]) { region[j] = 1; stack.push(j); }
        }
      }

      /* border edges of the region -> chained loops. Each inside pixel
         contributes the unit edges facing outside; every loop closes by
         construction (outer boundary + one loop per island). */
      const edges = new Map();                          /* "x,y" -> [[x2,y2],...] */
      const addEdge = (x1, y1, x2, y2) => {
        const a = x1 + ',' + y1;
        let l = edges.get(a);
        if (!l) { l = []; edges.set(a, l); }
        l.push([x2, y2]);
      };
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!region[y * W + x]) continue;
          if (!region[(y - 1) * W + x]) addEdge(x, y, x + 1, y);         /* top    */
          if (!region[(y + 1) * W + x]) addEdge(x + 1, y + 1, x, y + 1); /* bottom */
          if (!region[y * W + x - 1]) addEdge(x, y + 1, x, y);           /* left   */
          if (!region[y * W + x + 1]) addEdge(x + 1, y, x + 1, y + 1);   /* right  */
        }
      }
      const loops = [];
      for (const [startKey, outs] of edges) {
        while (outs.length) {
          const start = startKey.split(',').map(Number);
          let prev = start;
          let cur = outs.pop();
          const loop = [start, cur];
          let guard = 0;
          while (guard++ < 4 * W * H) {
            const kk = cur[0] + ',' + cur[1];
            const nexts = edges.get(kk);
            if (!nexts || !nexts.length) break;
            /* a SADDLE — two regions meeting at one corner — offers two
               ways on. The border walks with the region on its right hand
               (by construction of the edges), so the sharpest right turn
               keeps this loop on its own area and the pinch unpicks into
               two touching loops instead of one crossing figure-eight. */
            let pick = 0;
            if (nexts.length > 1) {
              const dinx = cur[0] - prev[0], diny = cur[1] - prev[1];
              let bestS = -1;
              for (let z = 0; z < nexts.length; z++) {
                const dox = nexts[z][0] - cur[0], doy = nexts[z][1] - cur[1];
                const cr = dinx * doy - diny * dox;
                const dt = dinx * dox + diny * doy;
                const s = cr > 0 ? 2 : (dt > 0 ? 1 : 0);
                if (s > bestS) { bestS = s; pick = z; }
              }
            }
            prev = cur;
            cur = nexts.splice(pick, 1)[0];
            if (cur[0] === start[0] && cur[1] === start[1]) break;
            loop.push(cur);
          }
          if (loop.length >= 4) loops.push(loop);
        }
      }
      if (!loops.length) return null;
      const area = (l) => {
        let s = 0;
        for (let i = 0; i < l.length; i++) {
          const p = l[i], q = l[(i + 1) % l.length];
          s += p[0] * q[1] - q[0] * p[1];
        }
        return Math.abs(s) / 2;
      };
      loops.sort((a, b) => area(b) - area(a));
      /* Pull every border point to the CENTRE of the ink stroke it runs
         along. The flood stops at the stroke's region-facing edge — half a
         stroke short of the true geometry — and unlike an entity-outline
         snap this works for ANY wall: a block's edge, an mline, a text box.
         Direction is the local outward normal; the target is the middle of
         the ink run it meets. Running BEFORE the simplifier also keeps the
         simplifier's error off the walls: a centred straight run is
         colinear, and colinear points cost nothing to keep straight. */
      const inkAt = (x, y) => {
        const ix = Math.round(x - 0.5), iy = Math.round(y - 0.5);
        if (ix < 0 || iy < 0 || ix >= W || iy >= H) return 0;
        return ink[iy * W + ix];
      };
      const regionAt = (x, y) => {
        const ix = Math.round(x - 0.5), iy = Math.round(y - 0.5);
        if (ix < 0 || iy < 0 || ix >= W || iy >= H) return 0;
        return region[iy * W + ix];
      };
      const centerLoop = (l) => {
        const n = l.length;
        if (n < 3) return l;
        const out = new Array(n);
        for (let i = 0; i < n; i++) {
          const p = l[i], a = l[(i - 1 + n) % n], b = l[(i + 1) % n];
          let nx = b[1] - a[1], ny = -(b[0] - a[0]);
          const len = Math.hypot(nx, ny);
          if (!len) { out[i] = p; continue; }
          nx /= len;
          ny /= len;
          let dir = 0;
          for (const s of [0.75, 1.5]) {
            if (inkAt(p[0] + nx * s, p[1] + ny * s)) { dir = 1; break; }
            if (inkAt(p[0] - nx * s, p[1] - ny * s)) { dir = -1; break; }
          }
          if (!dir) { out[i] = p; continue; }
          nx *= dir;
          ny *= dir;
          let t0 = -1, t1 = -1;
          for (let t = 0.25; t <= 4.5; t += 0.25) {
            const hit = inkAt(p[0] + nx * t, p[1] + ny * t);
            if (t0 < 0) { if (hit) t0 = t; continue; }
            if (hit) t1 = t;
            else break;
          }
          if (t0 < 0) { out[i] = p; continue; }
          const tEnd = t1 < 0 ? t0 : t1;
          let tm = Math.min((t0 + tEnd) / 2, 1.25);
          /* a PENINSULA: our own region continues just past this ink — a
             thin spike poking into the fill. Both of its borders would
             centre onto the SAME stroke and cross into a self-intersecting
             loop; each stays at the ink's edge instead. */
          if (regionAt(p[0] + nx * (tEnd + 0.75), p[1] + ny * (tEnd + 0.75))) {
            out[i] = p;
            continue;
          }
          /* a NECK: when the opposite wall is pixels away, the two sides
             each keep to half the gap, or their borders cross into a
             bow-tie and the even-odd fill tears a wedge out of the hatch */
          for (let t = 0.5; t <= 6; t += 0.5) {
            if (inkAt(p[0] - nx * t, p[1] - ny * t)) { tm = Math.min(tm, t / 2 - 0.25); break; }
          }
          if (tm <= 0) { out[i] = p; continue; }
          out[i] = [p[0] + nx * tm, p[1] + ny * tm];
        }
        return out;
      };
      const EPS_PX = 1.8;
      const toLoop = (l) => untangleLoop(rdp(centerLoop(l), EPS_PX).map(([x, y]) => toWorld(x, y)));
      const pts = toLoop(loops[0]);
      if (pts.length < 3) return null;
      const MIN_ISLAND = 12;                            /* px² — grid noise cut */
      const islands = loops.slice(1)
        .filter((l) => area(l) > MIN_ISLAND)
        .map(toLoop)
        .filter((l) => l.length >= 3);
      /* res: world units per raster pixel — the trace's own error bar, so
         the caller can pull the polygon flush to the true geometry */
      return { pts, islands, res: 1 / k };
    };

    /* A region that runs off the view raster is NOT "not enclosed" yet: a
       small room picked in a big site may close beyond the screen. It is
       retried on a box four times the size about the pick, clamped to the
       drawing's extents — few steps even from a room to a whole site, and
       a room a quarter of its raster is still 500 px across. Escalated
       rasters are kept while the view stands still, so a hover preview
       pays for the flood, not the render. */
    const boxKey = (b) => [b.minx, b.miny, b.maxx, b.maxy].map((v) => v.toFixed(6)).join('|');
    const clampBox = (b, ext) => ({
      minx: Math.max(b.minx, ext.minx), miny: Math.max(b.miny, ext.miny),
      maxx: Math.min(b.maxx, ext.maxx), maxy: Math.min(b.maxy, ext.maxy) });
    const at = (world, opts) => {
      const nowait = !!(opts && opts.nowait);
      const sig = viewSig();
      if (rastersSig !== sig) { rasters = new Map(); extMemo = null; rastersSig = sig; }
      /* hover must not freeze the pointer: if the raster is not ready,
         the caller shows no preview and warms on the next frame */
      const rec = nowait ? (built && built.sig === sig ? built : null) : ensure();
      if (!rec) return null;
      const r = trace(rec, world);
      if (r !== LEAK) return r;
      const ext = extBox();
      if (!ext) return null;
      const w = rec.maxx - rec.minx, h = rec.maxy - rec.miny;
      for (let i = 0; i < 4; i++) {
        /* ×4 a step so the raster stays proportioned to the region — a
           straight jump to the extents traced a room at 10 units a pixel
           on a long drawing — but at most FOUR levels where the old
           ladder walked twelve: every level is a full raster build with
           the flood after it, and on a heavy plan that walk was the
           freeze between the click and the hatch. */
        const f = 2 * Math.pow(4, i);
        const box = i === 3 ? clampBox(ext, ext)
          : clampBox({ minx: world.x - f * w, miny: world.y - f * h,
              maxx: world.x + f * w, maxy: world.y + f * h }, ext);
        const key = boxKey(box);
        let R = rasters.get(key);
        if (!R) {
          if (rasters.has('pend:' + key)) return null;   /* still building */
          if (nowait) {
            /* build it just off the pointer's frame; the next hover
               finds it warm */
            rasters.set('pend:' + key, 1);
            setTimeout(() => {
              try {
                const B = buildRaster(box, false);
                if (B) rasters.set(key, B);
              } catch (e) { /* preview */ }
              rasters.delete('pend:' + key);
            }, 0);
            return null;
          }
          R = buildRaster(box, false);
          if (!R) return null;
          rasters.set(key, R);
        }
        const r2 = trace(R, world);
        if (r2 !== LEAK) return r2;
        if (key === boxKey(ext)) return null;            /* leaked off the drawing */
      }
      return null;
    };

    /* THE ZOOM MUST NOT BE PART OF THE ANSWER. The first pass rasters the
       VIEW, so the same click gave a different region at every zoom: a
       room's furniture resolved into seven islands close in and
       thirty-nine fragments far out, and the fill changed with it. Given
       the region that pass found, this one rasters THAT box alone — the
       full 2048 across the region itself, wherever the view happens to
       stand — and floods again from the same point. What comes back is
       the region's own resolution: the same hatch at any zoom, its
       islands cut on the furniture's real edges.
       Paid at the click, never on hover. */
    const refine = (world, b) => {
      if (!b || !isFinite(b.minx)) return null;
      const w = Math.max(b.maxx - b.minx, 1e-9), h = Math.max(b.maxy - b.miny, 1e-9);
      const pad = Math.max(w, h) * 0.03;
      const box = { minx: b.minx - pad, miny: b.miny - pad,
        maxx: b.maxx + pad, maxy: b.maxy + pad };
      const key = 'fine:' + boxKey(box);
      let R = rasters.get(key);
      if (!R) {
        R = buildRaster(box, false);
        if (!R) return null;
        rasters.set(key, R);
      }
      const r = trace(R, world);
      return (r && r !== LEAK) ? r : null;
    };

    /* ADOPT: the caller vouches that the only document change since the
       rasters were built was a HATCH — which the tracer does not see (the
       stroke path skips hatches, the blit path erases them), so the ink is
       still the truth. Without this, every committed hatch bumped docGen
       and threw away the view raster AND every escalated level: on a big
       drawing each hatch after the first re-paid seconds of builds. */
    const adopt = () => {
      const sig = viewSig();
      if (built) built.sig = sig;
      rastersSig = sig;
    };
    return { at, refine, warm: ensure, adopt, builds: () => builds };
  };

  /* ---------------- sizing ---------------- */
  const resizeCanvases = () => {
    if (!container) return;
    const r = container.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const d = window.devicePixelRatio || 1;
    if (w === cssW && h === cssH && d === dpr) return;
    const before = tiles ? tiles.map(tileRect) : null;
    const oldH = cssH;
    cssW = w; cssH = h; dpr = d;
    for (const c of [canvas, overlay]) {
      c.width = Math.round(w * d);
      c.height = Math.round(h * d);
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    tilesResize(before, oldH);
    Nasj.render();
    Nasj.renderOverlay();
    if (tiled()) emitVports();          /* the label rides the current tile */
  };

  /* ---------------- pointer / key plumbing ---------------- */
  const localXY = (ev) => {
    const r = overlay.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  const toolCall = (name, arg) => {
    const t = Nasj.tools; /* tools may not be ready during boot */
    if (t && typeof t[name] === 'function') {
      try { t[name](arg); } catch (err) { console.error('[tools.' + name + ']', err); }
    }
  };

  /* Pointer-move processing (osnap + tool hover hit-testing + overlay) is
   * coalesced to one run per animation frame: high-poll mice fire hundreds
   * of pointermove events per second and each run costs real work. Down/up/
   * wheel/leave flush the queued move first so event ORDER is unchanged —
   * only duplicate intermediate moves within a frame are dropped. */
  let queuedMove = null;
  let moveRaf = 0;

  const flushPointerMove = () => {
    if (moveRaf) { cancelAnimationFrame(moveRaf); moveRaf = 0; }
    const ev = queuedMove;
    queuedMove = null;
    if (ev) processPointerMove(ev);
  };
  Nasj._flushPointerMove = flushPointerMove;  /* headless QA harness hook */

  /* Shift+middle-drag orbit (classic CAD gesture) — activates 3D if needed */
  const orbit = { active: false, pointerId: null, lastX: 0, lastY: 0 };
  const ORBIT_RATE = 0.01;      /* rad per px */
  const EL_MAX = 89.9 * DEG;    /* smooth elevation clamp 0..89.9° */

  const onPointerDown = (ev) => {
    flushPointerMove();
    if (ev.pointerType) lastPointerType = ev.pointerType;
    const screen = localXY(ev);
    /* split model space: a pick in another tile makes that one current, and
       is spent doing it — the industry standard's click-to-activate. A wheel-pan carries
       on in the tile it just woke. */
    if (tiled() && (ev.button === 0 || ev.button === 1)) {
      const i = Nasj.vports.at(screen);
      if (i >= 0 && i !== tileActive) {
        Nasj.vports.setActive(i);
        if (ev.button === 0) return;
      }
    }
    if (ev.button === 1) {
      ev.preventDefault();
      if (ev.shiftKey) { /* orbit */
        if (!activate3d()) return;
        orbit.active = true;
        orbit.pointerId = ev.pointerId;
        orbit.lastX = screen.x;
        orbit.lastY = screen.y;
        overlay.style.cursor = 'move';
        try { overlay.setPointerCapture(ev.pointerId); } catch (_) { /* noop */ }
        emitView3d();
        Nasj.renderOverlay();
        return;
      }
      /* no double-middle-click Zoom Extents: two quick wheel presses while
         panning made the view LEAP to the whole drawing — a jump nobody
         asked for. The view moves only when the user moves it. */
      pan.active = true;
      pan.pointerId = ev.pointerId;
      pan.lastX = screen.x;
      pan.lastY = screen.y;
      overlay.style.cursor = 'grabbing';   /* hand while wheel-panning */
      try { overlay.setPointerCapture(ev.pointerId); } catch (_) { /* noop */ }
      Nasj.renderOverlay();                /* hide crosshair immediately */
      return;
    }
    if (ev.button === 0) {
      const pt = computePoint(screen);
      pt.ev = ev;
      Nasj.ui.cursor = cursorAt(pt, screen);
      /* the UCS icon is chrome, not geometry: it answers the pointer itself,
         but only while no command is running — and only while the UCS
         dialog's "Allow Selecting UCS icon" stands ticked */
      if ((!Nasj.opt || Nasj.opt.ucsIconSelect !== false) && ucsIdle() && ucsHit(screen)) {
        ucsUi.sel = true;
        ucsUi.drag = { from: { x: Nasj.ucs.x, y: Nasj.ucs.y }, moved: false, scr: screen };
        try { overlay.setPointerCapture(ev.pointerId); } catch (_) { /* noop */ }
        Nasj.renderOverlay();
        return;
      }
      if (ucsUi.sel) { ucsUi.sel = false; Nasj.renderOverlay(); }
      /* the Move Gizmo's arms answer before the tools do */
      if (gizmoBeginDrag(screen, ev)) {
        try { overlay.setPointerCapture(ev.pointerId); } catch (_) { /* noop */ }
        Nasj.renderOverlay();
        return;
      }
      toolCall('onDown', pt);
      Nasj.renderOverlay();
    }
    /* button 2 (right): context menu handled by app.js */
  };

  /* Snap mode moves the CROSSHAIR itself between the snap points, the way
     the industry standard's does — the visible half of grid snap; the rounding of the
     point underneath is the other. Object snaps keep the gliding crosshair
     and show their marker instead, again as the industry standard does, and PolarSnap
     leaves the cursor free until a ray captures it. */
  const cursorAt = (pt, screen) => {
    if (Nasj.settings.snap && !Nasj.settings.snapPolar && !Nasj.ui.snapMark &&
        !Nasj.ui.zoomDyn && !view3d.active) {
      return { world: pt.world, screen: vp.worldToScreen(pt.world) };
    }
    return { world: pt.world, screen };
  };

  const onPointerMove = (ev) => {
    lastInteractT = performance.now();
    /* glscene phase 4 (pan at display rate): pan frames render in the event
       task, exactly as wheel zoom does — the rAF hop held a 120Hz display
       to a rock-steady 60 (measured: rAF p50 16.6ms, CPU ~3ms). Captured
       pointermove is already coalesced to the display's cadence, so this
       renders at most once per delivered frame.
       The same direct path carries the crosshair through a LOAD: with the
       thread full of parse slices the queued rAF starves and the (hidden
       OS cursor's) crosshair freezes — processing in the event task moves
       it in whatever gaps the load leaves. The gated move is coords-only,
       so each one costs a crosshair repaint and nothing more. */
    if ((pan.active && ev.pointerId === pan.pointerId) ||
        (Nasj.doc && Nasj.doc.loading)) {
      if (moveRaf) { cancelAnimationFrame(moveRaf); moveRaf = 0; }
      queuedMove = null;
      processPointerMove(ev);
      return;
    }
    queuedMove = ev;
    if (moveRaf) return;
    moveRaf = requestAnimationFrame(() => {
      moveRaf = 0;
      const e = queuedMove;
      queuedMove = null;
      if (e) processPointerMove(e);
    });
  };

  const processPointerMove = (ev) => {
    const screen = localXY(ev);
    pointerInside = true;
    if (ev.pointerType) lastPointerType = ev.pointerType;

    if (orbit.active && ev.pointerId === orbit.pointerId) {
      const az = normAz(view3d.azimuth + (screen.x - orbit.lastX) * ORBIT_RATE);
      const el = clamp(view3d.elevation - (screen.y - orbit.lastY) * ORBIT_RATE, 0, EL_MAX);
      orbit.lastX = screen.x;
      orbit.lastY = screen.y;
      setOrientation(az, el);
      viewName = 'custom';
      const world = vp.screenToWorld(screen);
      Nasj.ui.cursor = { world, screen };
      Nasj.render();
      Nasj.emit('nasj:pointer', { world, screen });
      emitView3d();
      Nasj.renderOverlay();
      return;
    }

    if (pan.active && ev.pointerId === pan.pointerId) {
      vp.panBy(screen.x - pan.lastX, screen.y - pan.lastY);
      pan.lastX = screen.x;
      pan.lastY = screen.y;
      const world = vp.screenToWorld(screen);
      Nasj.ui.cursor = { world, screen };
      Nasj.render();
      Nasj.emit('nasj:pointer', { world, screen });
      Nasj.renderOverlay();
      return;
    }

    /* split model space: the pointer belongs to the current viewport. Over
       another tile the industry standard stops the crosshair, the snap and the coordinate
       readout where they are and shows a plain arrow — the pick that lands
       there wakes that viewport instead of drawing in this one. */
    if (tiled() && Nasj.vports.at(screen) !== tileActive) {
      pointerInside = false;
      Nasj.ui.snapMark = null;
      overlay.style.cursor = 'default';
      Nasj.renderOverlay();
      return;
    }
    if (overlay.style.cursor === 'default') overlay.style.cursor = '';

    const pt = computePoint(screen);
    pt.ev = ev;
    Nasj.ui.cursor = cursorAt(pt, screen);
    if (gizmo.drag) {                     /* the arm carries the selection */
      gizmoMoveDrag(screen);
      Nasj.emit('nasj:pointer', { world: pt.world, screen });
      return;
    }
    if (ucsUi.drag) {                     /* the icon follows the cursor */
      ucsUi.drag.moved = ucsUi.drag.moved ||
        Math.hypot(screen.x - ucsUi.drag.scr.x, screen.y - ucsUi.drag.scr.y) > 3;
      if (ucsUi.drag.moved) Nasj.setUcs(pt.world);   /* snapped like any pick */
      Nasj.emit('nasj:pointer', { world: pt.world, screen });
      Nasj.renderOverlay();
      return;
    }
    const hov = ucsIdle() && ucsHit(screen);
    if (hov !== ucsUi.hover) ucsUi.hover = hov;
    const gh = (gizmoOn() && !gizmo.drag) ? gizmoHitArm(screen) : null;
    gizmo.hover = gh ? (gh.center ? 'C' : gh.tri ? 'T' : (gh.arm || gh.ring).a.name) : null;
    toolCall('onMove', pt);
    Nasj.emit('nasj:pointer', { world: pt.world, screen });
    Nasj.renderOverlay();
  };

  const onPointerUp = (ev) => {
    flushPointerMove();
    if (ev.pointerType) lastPointerType = ev.pointerType;
    if (ev.button === 1 || (pan.active && ev.pointerId === pan.pointerId) ||
        (orbit.active && ev.pointerId === orbit.pointerId)) {
      pan.active = false;
      pan.pointerId = null;
      orbit.active = false;
      orbit.pointerId = null;
      overlay.style.cursor = '';           /* back to crosshair (cursor:none) */
      try { overlay.releasePointerCapture(ev.pointerId); } catch (_) { /* noop */ }
      Nasj.renderOverlay();
      return;
    }
    if (gizmo.drag) {
      try { overlay.releasePointerCapture(ev.pointerId); } catch (_) { /* noop */ }
      /* a centre CLICK that never became a drag falls through to the tools
         as the click it was — the grip under the box keeps its answer */
      if (!gizmo.drag.engaged && ev.button === 0) {
        gizmo.drag = null;
        const pt = computePoint(localXY(ev));
        pt.ev = ev;
        toolCall('onDown', pt);
        toolCall('onUp', pt);
        Nasj.renderOverlay();
        return;
      }
      gizmoEndDrag(true);
      return;
    }
    if (ucsUi.drag) {
      const moved = ucsUi.drag.moved;
      ucsUi.drag = null;
      try { overlay.releasePointerCapture(ev.pointerId); } catch (_) { /* noop */ }
      if (moved && Nasj.cmd && typeof Nasj.cmd.print === 'function') {
        const u = Nasj.units;
        Nasj.cmd.print('UCS origin: ' +
          (u ? u.fmtLen(Nasj.ucs.x) + ', ' + u.fmtLen(Nasj.ucs.y)
            : Nasj.ucs.x.toFixed(4) + ', ' + Nasj.ucs.y.toFixed(4)));
      }
      Nasj.renderOverlay();
      return;
    }
    if (ev.button === 0) {
      const pt = computePoint(localXY(ev));
      pt.ev = ev;
      toolCall('onUp', pt);
      Nasj.renderOverlay();
    }
  };

  const onPointerLeave = () => {
    if (moveRaf) { cancelAnimationFrame(moveRaf); moveRaf = 0; }
    queuedMove = null;                   /* drop, don't process, on exit */
    pointerInside = false;
    Nasj.ui.snapMark = null;
    Nasj.renderOverlay();
  };

  /* ---------------- the wheel: mouse, trackpad, pinch ----------------
     Chromium hands all three over as wheel events and tells them apart
     only by their shape, so the shape is what is read:
       PINCH  — ctrlKey set (Chromium's own convention for a trackpad
                pinch, on every OS): a smooth zoom about the cursor by
                exp(-deltaY * 0.01), clamped to ±25% an event, no steps;
       SCROLL — deltaMode 0 (pixels) with a horizontal component, or a
                fractional vertical one, or a small one (|deltaY| < 40): a
                two-finger scroll, and the view PANS by (-deltaX, -deltaY)
                in the direction the OS delivered it — natural or not is
                the person's own setting, not this program's;
       WHEEL  — the rest: the mouse's notches (integer ±100/±120/±53
                multiples and nothing sideways), the stepped zoom this
                always had, and with Shift held a horizontal pan.
     The stream teaches the classifier: a source that ever sent a
     horizontal or fractional delta, or a dense run (< 60 ms apart) of
     small integers, is a trackpad until 1.5 s of silence — the inertial
     tail of a flick sends clean integers, a fast flick sends 120s, and
     neither may zoom mid-gesture. A mouse's notches never arrive that
     small or that dense. Nasj.settings.trackpadPan ('auto' | 'always' |
     'never') overrides the guess; OPTIONS ▸ 3D Modeling's "Reverse mouse
     wheel zoom" turns the wheel's steps around.
     Safari has no ctrlKey pinch: it raises gesturestart/gesturechange/
     gestureend with a cumulative scale, handled below the wheel. */
  const PINCH_K = 0.01;
  const PINCH_MAX = 1.25;
  const TRACKPAD_MEMORY = 1500;
  const wheelSrc = { lastT: -1e9, trackpadT: -1e9, gesture: false, gestureScale: 1 };
  let wheelRaf = 0;
  const wheelKind = (ev) => {
    if (ev.ctrlKey) return wheelSrc.gesture ? 'none' : 'pinch';
    const now = performance.now();
    const gap = now - wheelSrc.lastT;
    wheelSrc.lastT = now;
    const dx = ev.deltaX || 0, dy = ev.deltaY || 0;
    if (!dx && !dy) return 'none';
    const mode = Nasj.settings.trackpadPan || 'auto';
    const px = ev.deltaMode === 0;
    let trackpad = false;
    if (px && !ev.shiftKey) {
      const frac = dx !== Math.round(dx) || dy !== Math.round(dy);
      const small = Math.abs(dy) < 40;
      if (dx !== 0 || frac || (small && gap < 60)) wheelSrc.trackpadT = now;
      trackpad = dx !== 0 || frac || small || (now - wheelSrc.trackpadT < TRACKPAD_MEMORY);
    }
    if (mode === 'never') trackpad = false;
    else if (mode === 'always' && px) trackpad = true;
    if (trackpad) return 'pan';
    return ev.shiftKey ? 'hpan' : 'zoom';
  };
  Nasj.wheelKind = (ev) => wheelKind(ev);    /* the classifier, for QA */
  const wheelPaint = (s, deferred) => {
    Nasj.ui.cursor = { world: vp.screenToWorld(s), screen: s };
    Nasj.emit('nasj:pointer', { world: Nasj.ui.cursor.world, screen: s });
    if (!deferred) {
      if (wheelRaf) { cancelAnimationFrame(wheelRaf); wheelRaf = 0; }
      Nasj.render();
      Nasj.renderOverlay();
      return;
    }
    /* a trackpad streams at 60–120 events a second: paint once a frame */
    if (wheelRaf) return;
    wheelRaf = requestAnimationFrame(() => {
      wheelRaf = 0;
      Nasj.render();
      Nasj.renderOverlay();
    });
  };
  /* one wheel notch: ZOOMFACTOR 60 zooms by 60% (x1.6), the step a hand
     used to the industry standard expects; 1.1 was six notches to its one */
  Nasj.wheelNotch = () => {
    const zf = Nasj.settings.zoomFactor;
    return 1 + ((zf >= 3 && zf <= 100) ? zf : 60) / 100;
  };
  const onWheel = (ev) => {
    lastInteractT = performance.now();
    flushPointerMove();
    ev.preventDefault();
    const kind = wheelKind(ev);
    if (kind === 'none') return;
    const s = localXY(ev);
    /* the wheel works the tile it is over, waking it first */
    if (tiled()) {
      const i = Nasj.vports.at(s);
      if (i >= 0) Nasj.vports.setActive(i);
    }
    if (kind === 'pan') {
      /* Shift turns a vertical-only scroll sideways here too ('always') */
      if (ev.shiftKey && !ev.deltaX) vp.panBy(-(ev.deltaY || 0), 0);
      else vp.panBy(-(ev.deltaX || 0), -(ev.deltaY || 0));
      wheelPaint(s, true);
      return;
    }
    if (kind === 'hpan') {
      /* Shift+wheel on a mouse: sideways, by the notch — Chromium may have
         already turned the delta horizontal, so whichever axis carries it */
      const d = ev.deltaX || ev.deltaY || 0;
      vp.panBy(-d, 0);
      wheelPaint(s, false);
      return;
    }
    if (kind === 'pinch') {
      const f = Math.min(PINCH_MAX, Math.max(1 / PINCH_MAX, Math.exp(-(ev.deltaY || 0) * PINCH_K)));
      vp.zoomAt(s.x, s.y, f);
      wheelPaint(s, true);
      return;
    }
    const rev = !!(Nasj.opt && Nasj.opt.revZoom);
    const zoomIn = (ev.deltaY < 0) !== rev;
    const notch = Nasj.wheelNotch();
    vp.zoomAt(s.x, s.y, zoomIn ? notch : 1 / notch);
    wheelPaint(s, false);
  };
  /* Safari's trackpad pinch: e.scale is cumulative from gesturestart, so
     each change zooms by the ratio to the last one, about the cursor */
  const onGestureStart = (ev) => {
    ev.preventDefault();
    wheelSrc.gesture = true;
    wheelSrc.gestureScale = ev.scale || 1;
  };
  const onGestureChange = (ev) => {
    ev.preventDefault();
    if (!wheelSrc.gesture) { wheelSrc.gesture = true; wheelSrc.gestureScale = 1; }
    const sc = ev.scale || 1;
    const f = sc / (wheelSrc.gestureScale || 1);
    wheelSrc.gestureScale = sc;
    if (!isFinite(f) || f <= 0 || f === 1) return;
    lastInteractT = performance.now();
    const s = localXY(ev);
    if (tiled()) {
      const i = Nasj.vports.at(s);
      if (i >= 0) Nasj.vports.setActive(i);
    }
    vp.zoomAt(s.x, s.y, Math.min(PINCH_MAX, Math.max(1 / PINCH_MAX, f)));
    wheelPaint(s, true);
  };
  const onGestureEnd = (ev) => {
    ev.preventDefault();
    wheelSrc.gesture = false;
    wheelSrc.gestureScale = 1;
  };

  const onKeyDown = (ev) => {
    /* Escape drops the UCS icon's selection, like any other pick */
    if (ev.key === 'Escape' && (ucsUi.sel || ucsUi.drag)) {
      ucsUi.sel = false;
      ucsUi.drag = null;
      Nasj.renderOverlay();
    }
    /* don't hijack typing in inputs — commands.js owns the command line */
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      /* exception: Delete in the EMPTY command input acts on the selection.
         Backspace too — a Mac keyboard has no Delete-forward key — but not
         the tail of the run of Backspaces that just emptied the line: the
         one pressed too many erases the typing, never the drawing. */
      if (ev.key === 'Delete' && t.id === 'command-input' && !t.value) toolCall('onKey', ev);
      else if (ev.key === 'Backspace' && t.id === 'command-input') {
        if (t.value) bsTypingT = performance.now();
        else if (performance.now() - bsTypingT > 600) toolCall('onKey', ev);
      }
      return;
    }
    toolCall('onKey', ev);
  };
  let bsTypingT = -1e9;                 /* the last Backspace that erased text */

  /* ---------------- init ---------------- */
  Nasj.engineInit = () => {
    canvas = document.getElementById('canvas');
    overlay = document.getElementById('overlay-canvas');
    container = document.getElementById('viewport-container');
    if (!canvas || !overlay || !container) {
      console.error('[engine] required canvases/container missing');
      return;
    }
    ctx = canvas.getContext('2d');
    octx = overlay.getContext('2d');

    resizeCanvases();
    let resizeFrame = 0;
    const ro = new ResizeObserver(() => { if (!resizeFrame) resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; resizeCanvases(); }); });
    ro.observe(container);
    window.addEventListener('resize', resizeCanvases);

    overlay.addEventListener('pointerdown', onPointerDown);
    overlay.addEventListener('pointermove', onPointerMove);
    overlay.addEventListener('pointerup', onPointerUp);
    overlay.addEventListener('pointerenter', () => { pointerInside = true; });
    overlay.addEventListener('pointerleave', onPointerLeave);
    overlay.addEventListener('wheel', onWheel, { passive: false });
    /* Safari's pinch (the web build on a MacBook): gesture events, never
       ctrlKey wheels; harmless to listen for where they never fire */
    overlay.addEventListener('gesturestart', onGestureStart, { passive: false });
    overlay.addEventListener('gesturechange', onGestureChange, { passive: false });
    overlay.addEventListener('gestureend', onGestureEnd, { passive: false });
    Nasj.applyPlatformClass();
    /* block middle-click autoscroll */
    overlay.addEventListener('mousedown', (ev) => { if (ev.button === 1) ev.preventDefault(); });
    window.addEventListener('keydown', onKeyDown);
  };
})();
