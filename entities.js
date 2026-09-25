/* pixelbay CAD — entities.js
 * Data model + geometry kernel (SPEC Â§7). Owner: ENGINE.
 * Plain script, attaches to window.Nasj. No DOM access, no init at parse time.
 */
(() => {
  'use strict';
  const Nasj = window.Nasj = window.Nasj || {};

  const TAU = Math.PI * 2;
  const EPS = 1e-9;

  /* ---------------- id generation ---------------- */
  let _seq = 0;
  const uid = (pre = 'e') =>
    pre + Date.now().toString(36) + (++_seq).toString(36) +
    Math.floor(Math.random() * 46656).toString(36);

  /* ---------------- annotation styles ----------------
   * The drawing's four style tables — text, dimension, multileader, table —
   * each a list of named definitions plus the one that is current. Every
   * property here is one the geometry or the renderer really reads, so the
   * style an object is stamped with decides how it is drawn. A property is
   * { def } plus its bounds: min/max for numbers, oneOf for a fixed choice,
   * str for free text, bool for a flag.
   */
  /* the fonts to offer until the machine's own list arrives (app.js asks the
     main process for every installed font and replaces this) */
  const TEXT_FONTS = ['Segoe UI', 'Arial', 'Arial Narrow', 'Calibri', 'Cambria',
    'Consolas', 'Courier New', 'Georgia', 'Segoe Print', 'Tahoma',
    'Times New Roman', 'Trebuchet MS', 'Verdana'];
  const FONT_STYLES = ['Regular', 'Bold', 'Italic', 'Bold Italic'];
  /* the arrowheads a dimension can end with — the industry standard's DIMBLK set, in the
     order its Symbols and Arrows lists offer them. A custom arrow block
     (User Arrow…) travels as 'User:<block name>' beside these. */
  const ARROW_HEADS = ['Closed filled', 'Closed blank', 'Closed', 'Dot',
    'Architectural tick', 'Oblique', 'Open', 'Origin indicator',
    'Origin indicator 2', 'Right angle', 'Open 30', 'Dot small', 'Dot blank',
    'Dot small blank', 'Box', 'Box filled', 'Datum triangle',
    'Datum triangle filled', 'Integral', 'None'];
  const ZERO_SUPPRESS = ['None', 'Leading', 'Trailing', 'Both'];
  const TEXT_VERT = ['Centered', 'Above', 'Outside', 'JIS', 'Below'];
  const TEXT_HORIZ = ['Centered', 'At Ext Line 1', 'At Ext Line 2',
    'Over Ext Line 1', 'Over Ext Line 2'];
  const FIT_MODES = ['Best', 'Arrows', 'Text', 'Both', 'Keep text inside'];
  const CELL_ALIGN = ['Top Left', 'Top Center', 'Top Right',
    'Middle Left', 'Middle Center', 'Middle Right',
    'Bottom Left', 'Bottom Center', 'Bottom Right'];
  const CELL_FORMATS = ['General', 'Decimal', 'Percentage', 'Currency', 'Whole number'];
  const TOL_METHODS = ['None', 'Symmetrical', 'Deviation', 'Limits', 'Basic'];
  const STYLE_KINDS = {
    text: {
      label: 'text',
      props: {
        h: { def: 0, min: 0 },                    /* 0 = TEXT asks each time */
        wf: { def: 1, min: 0.01, max: 100 },
        oblique: { def: 0, min: -85, max: 85 },   /* degrees of slant */
        font: { def: 'Segoe UI', str: true },      /* any font the machine has */
        fstyle: { def: 'Regular', oneOf: FONT_STYLES },
        upside: { def: false, bool: true },
        backwards: { def: false, bool: true },
        vertical: { def: false, bool: true },
        anno: { def: false, bool: true },         /* height follows the anno scale */
      },
    },
    /* A dimension style states its sizes on paper, the way DIMSTYLE does;
       the dimension's own text height says how big that paper is in the
       drawing, so the defaults below draw exactly what this release always
       drew (gap 1.5, overshoot 1.5, arrow 2.5, text gap 1 at height 3). */
    dim: {
      label: 'dimension',
      props: {
        txtH: { def: 3, min: 0.01 },          /* text height */
        exo: { def: 1.5, min: 0 },            /* extension line offset from origin */
        exe: { def: 1.5, min: 0 },            /* extension beyond the dimension line */
        asz: { def: 2.5, min: 0 },            /* arrowhead size */
        gap: { def: 1, min: 0 },              /* text offset from the dimension line */
        dle: { def: 0, min: 0 },              /* dimension line beyond the ticks */
        dli: { def: 3.75, min: 0 },           /* baseline spacing */
        fxlon: { def: false, bool: true },    /* fixed-length extension lines */
        fxl: { def: 3, min: 0.01 },
        sd1: { def: false, bool: true },      /* suppress dimension line 1 / 2 */
        sd2: { def: false, bool: true },
        se1: { def: false, bool: true },      /* suppress extension line 1 / 2 */
        se2: { def: false, bool: true },
        clrd: { def: 'ByBlock', str: true },  /* dimension line colour/type/weight */
        ltd: { def: 'ByBlock', str: true },
        lwd: { def: 'ByBlock', str: true },
        clre: { def: 'ByBlock', str: true },  /* extension lines */
        lte1: { def: 'ByBlock', str: true },
        lte2: { def: 'ByBlock', str: true },
        lwe: { def: 'ByBlock', str: true },
        /* symbols and arrows */
        arrow: { def: 'Closed filled', oneOf: ARROW_HEADS, user: true },   /* first */
        arrow2: { def: 'Closed filled', oneOf: ARROW_HEADS, user: true },
        arrowLdr: { def: 'Closed filled', oneOf: ARROW_HEADS, user: true },
        cen: { def: 'Mark', oneOf: ['None', 'Mark', 'Line'] }, /* centre marks */
        cenSize: { def: 0.9, min: 0 },
        brk: { def: 1.25, min: 0 },               /* dimension break size */
        arcsym: { def: 'Preceding', oneOf: ['Preceding', 'Above', 'None'] },
        jogAng: { def: 45, min: 5, max: 89 },     /* radius jog */
        jogFac: { def: 1.5, min: 0.1 },           /* linear jog height */
        /* text */
        txtsty: { def: 'Standard', str: true },   /* the text style it writes in */
        clrt: { def: 'ByBlock', str: true },      /* text colour */
        fillt: { def: 'None', str: true },        /* text background fill */
        fracH: { def: 1, min: 0.1 },              /* fraction height scale */
        frame: { def: false, bool: true },        /* draw a frame around text */
        tvert: { def: 'Centered', oneOf: TEXT_VERT },
        thoriz: { def: 'Centered', oneOf: TEXT_HORIZ },
        tview: { def: 'Left-to-Right', oneOf: ['Left-to-Right', 'Right-to-Left'] },
        talign: { def: 'Aligned', oneOf: ['Horizontal', 'Aligned', 'ISO'] },
        /* fit */
        fit: { def: 'Best', oneOf: FIT_MODES },
        fitSup: { def: false, bool: true },       /* suppress arrows that do not fit */
        tplace: { def: 'Beside', oneOf: ['Beside', 'Leader', 'NoLeader'] },
        anno: { def: true, bool: true },          /* size follows the anno scale */
        scaleLayout: { def: false, bool: true },  /* scale to the layout instead */
        scale: { def: 1, min: 0.01, max: 1000 },  /* or this overall scale */
        tmanual: { def: false, bool: true },      /* place text manually */
        tofl: { def: false, bool: true },         /* dim line between ext lines */
        /* primary units */
        lunit: { def: 2, min: 1, max: 5 },        /* 1 sci 2 dec 3 eng 4 arch 5 frac */
        prec: { def: 2, min: 0, max: 8 },
        fracfmt: { def: 'Horizontal', oneOf: ['Horizontal', 'Diagonal', 'Not stacked'] },
        dsep: { def: '.', oneOf: ['.', ',', ' '] },
        rnd: { def: 0, min: 0 },                  /* round the measurement off */
        pre: { def: '', text: true },             /* prefix / suffix */
        suf: { def: '', text: true },
        lfac: { def: 1, min: 1e-6 },              /* measurement scale */
        lfacLayout: { def: false, bool: true },   /* … in layouts only */
        zin: { def: 'None', oneOf: ZERO_SUPPRESS },
        subFac: { def: 100, min: 1e-6 },          /* sub-units below 1 */
        subSuf: { def: '', text: true },
        aunit: { def: 0, min: 0, max: 3 },        /* 0 deg 1 dms 2 grad 3 rad */
        aprec: { def: 1, min: 0, max: 8 },
        azin: { def: 'None', oneOf: ZERO_SUPPRESS },
        /* alternate units */
        alt: { def: false, bool: true },
        altUnit: { def: 2, min: 1, max: 5 },
        altPrec: { def: 2, min: 0, max: 8 },
        altFac: { def: 25.4, min: 1e-6 },
        altRnd: { def: 0, min: 0 },
        altPre: { def: '', text: true },
        altSuf: { def: '', text: true },
        altZin: { def: 'None', oneOf: ZERO_SUPPRESS },
        altPlace: { def: 'After', oneOf: ['After', 'Below'] },
        /* tolerances */
        tol: { def: 'None', oneOf: TOL_METHODS },
        tolPrec: { def: 4, min: 0, max: 8 },
        tolUp: { def: 0 },
        tolLo: { def: 0 },
        tolH: { def: 1, min: 0.05 },              /* tolerance text height factor */
        tolVert: { def: 'Middle', oneOf: ['Top', 'Middle', 'Bottom'] },
        tolZin: { def: 'None', oneOf: ZERO_SUPPRESS },
        tolAlign: { def: 'Symbols', oneOf: ['Decimal', 'Symbols'] },
        altTolPrec: { def: 2, min: 0, max: 8 },
        altTolZin: { def: 'None', oneOf: ZERO_SUPPRESS },
        /* the feet and inches a foot-and-inch format can drop */
        zin0ft: { def: true, bool: true },
        zin0in: { def: true, bool: true },
        altZin0ft: { def: true, bool: true },
        altZin0in: { def: true, bool: true },
      },
    },
    /* A multileader style, the three tabs of MLEADERSTYLE: how the leader is
       drawn, how it is built, and what it carries. Sizes are on paper, like
       a dimension style's, and the defaults draw what this release drew. */
    mleader: {
      label: 'multileader',
      props: {
        /* leader format */
        ltype: { def: 'Straight', oneOf: ['Straight', 'Spline', 'None'] },
        clr: { def: 'ByBlock', str: true },
        lt: { def: 'ByBlock', str: true },
        lw: { def: 'ByBlock', str: true },
        arrow: { def: 'Closed filled', oneOf: ARROW_HEADS, user: true },
        asz: { def: 2.5, min: 0 },
        brk: { def: 1.25, min: 0 },           /* leader break size */
        /* leader structure */
        maxPts: { def: 2, min: 2, max: 10 },
        ang1on: { def: false, bool: true },   /* constrain the first segment */
        ang1: { def: 0, min: 0, max: 360 },
        ang2on: { def: false, bool: true },
        ang2: { def: 0, min: 0, max: 360 },
        landOn: { def: true, bool: true },    /* the horizontal tail */
        landFixed: { def: false, bool: true },
        landDist: { def: 3, min: 0 },
        anno: { def: true, bool: true },
        scaleLayout: { def: false, bool: true },
        scale: { def: 1, min: 0.01, max: 1000 },
        /* content */
        content: { def: 'Mtext', oneOf: ['Mtext', 'Block', 'None'] },
        defText: { def: 'Default Text', text: true },
        txtsty: { def: 'Standard', str: true },
        txtH: { def: 3, min: 0.01 },
        txtAng: { def: 'As inserted', oneOf: ['As inserted', 'Keep horizontal', 'Always right-reading'] },
        clrt: { def: 'ByBlock', str: true },
        leftJust: { def: false, bool: true },
        frame: { def: false, bool: true },
        attach: { def: 'Middle', oneOf: ['Top', 'Middle', 'Bottom', 'Underline'] },
        gap: { def: 1, min: 0 },              /* landing gap before the text */
      },
    },
    /* A table style, the way TABLESTYLE holds one: the table's own direction
       and cell size, then a set of properties for each of its three cell
       styles — the title, the header row and the data rows. */
    table: {
      label: 'table',
      props: (() => {
        const p = {
          rowh: { def: 8, min: 0.01 },
          colw: { def: 30, min: 0.01 },
          dir: { def: 'Down', oneOf: ['Down', 'Up'] },
          mergeNew: { def: true, bool: true },   /* merge the title row on creation */
        };
        /* t = title, h = header, d = data */
        for (const [k, fill, bold] of [['t', 'None', true], ['h', 'None', true], ['d', 'None', false]]) {
          p[k + 'Fill'] = { def: fill, str: true };
          p[k + 'Align'] = { def: bold ? 'Middle Center' : 'Top Left', oneOf: CELL_ALIGN };
          p[k + 'Fmt'] = { def: 'General', oneOf: CELL_FORMATS };
          p[k + 'Prec'] = { def: 2, min: 0, max: 8 };
          p[k + 'Sty'] = { def: 'Standard', str: true };
          p[k + 'H'] = { def: bold ? 0.6 : 0.55, min: 0.05 };   /* Ã— row height */
          p[k + 'Clr'] = { def: 'ByBlock', str: true };
          p[k + 'Ang'] = { def: 0, min: -360, max: 360 };
          p[k + 'MargH'] = { def: 0.225, min: 0 };              /* Ã— row height */
          p[k + 'MargV'] = { def: 0.225, min: 0 };
          p[k + 'Bord'] = { def: 'All', oneOf: ['All', 'Outside', 'Inside', 'None'] };
          p[k + 'BordClr'] = { def: 'ByBlock', str: true };
          p[k + 'BordLw'] = { def: 'ByBlock', str: true };
          p[k + 'BordLt'] = { def: 'ByBlock', str: true };
        }
        /* the title row this release has always shaded */
        p.tFill = { def: '@shade', str: true };
        return p;
      })(),
    },
  };
  /* a complete definition of the kind, filling in whatever src does not say */
  const styleDef = (kind, src) => {
    const spec = STYLE_KINDS[kind];
    if (!spec) return null;
    const nm = String((src && src.name != null) ? src.name : 'Standard').trim();
    const out = { name: nm || 'Standard' };
    for (const [k, p] of Object.entries(spec.props)) {
      const v = src ? src[k] : undefined;
      if (p.bool) out[k] = (v === undefined) ? p.def : !!v;
      else if (p.str) {
        const s = (typeof v === 'string') ? v.trim() : '';
        out[k] = (s && s.length <= 128) ? s : p.def;
      } else if (p.text) {   /* free text, and empty is a real answer */
        out[k] = (typeof v === 'string' && v.length <= 64) ? v : p.def;
      } else if (p.oneOf) {
        /* an arrowhead may also name a custom block: 'User:<name>' */
        out[k] = (p.oneOf.indexOf(v) >= 0 || (p.user && typeof v === 'string' &&
          v.indexOf('User:') === 0 && v.length <= 128)) ? v : p.def;
      }
      else {
        /* a number, inside whatever bounds it states — a tolerance may be
           negative, so an unstated minimum is no minimum at all */
        const lo = p.min === undefined ? -Infinity : p.min;
        const hi = p.max === undefined ? Infinity : p.max;
        out[k] = (isNum(v) && v >= lo && v <= hi) ? v : p.def;
      }
    }
    return out;
  };
  /* the styles a new drawing has, as the industry standard's own template does: Standard,
     and an Annotative text style whose height follows the annotation scale */
  const defaultStyles = () => {
    const out = {};
    for (const kind of Object.keys(STYLE_KINDS)) {
      out[kind] = { current: 'Standard', list: [styleDef(kind, null)] };
    }
    out.text.list.unshift(styleDef('text', { name: 'Annotative', h: 0.2, anno: true }));
    return out;
  };
  /* deserialize: keep every valid definition, and always leave a table that
     can be drawn with — a file with no styles simply gets the defaults */
  const repairStyles = (raw) => {
    const out = defaultStyles();
    if (!raw || typeof raw !== 'object') return out;
    for (const kind of Object.keys(STYLE_KINDS)) {
      const t = raw[kind];
      if (!t || typeof t !== 'object' || !Array.isArray(t.list)) continue;
      const seen = new Set(), list = [];
      for (const s of t.list) {
        if (!s || typeof s !== 'object' || s.name == null) continue;
        const d = styleDef(kind, s);
        const key = d.name.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        list.push(d);
      }
      if (!list.length) continue;
      out[kind].list = list;
      const cur = list.find((s) => s.name.toUpperCase() === String(t.current || '').trim().toUpperCase());
      out[kind].current = cur ? cur.name : list[0].name;
    }
    return out;
  };
  /* The style a text object is drawn with, looked up by the name it carries.
     Font, slant and the mirroring effects are read here at draw time, so
     editing a style redraws every object that names it — text that carries
     no style name at all (imported CAD text) resolves to null and keeps the
     renderer's own defaults. */
  const textStyleOf = (doc, ent) => {
    if (!ent || !ent.style) return null;
    const t = doc && doc.styles && doc.styles.text;
    if (!t || !Array.isArray(t.list)) return null;
    const key = String(ent.style).trim().toUpperCase();
    return t.list.find((s) => s.name.toUpperCase() === key) || null;
  };
  Nasj.styleKinds = STYLE_KINDS;
  Nasj.textFonts = TEXT_FONTS;
  Nasj.fontStyles = FONT_STYLES;
  Nasj.arrowHeads = ARROW_HEADS;
  Nasj.zeroSuppress = ZERO_SUPPRESS;
  Nasj.dimLists = { TEXT_VERT, TEXT_HORIZ, FIT_MODES, TOL_METHODS };
  Nasj.cellAligns = CELL_ALIGN;
  Nasj.cellFormats = CELL_FORMATS;

  /* ---------------- document ---------------- */
  Nasj.createDoc = (name) => ({
    name,
    chatDrawingId: 'drawing-' + (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),
    path: null,
    modified: false,
    layers: [{ id: '0', name: '0', color: '#ffffff', on: true, frozen: false, locked: false }],
    currentLayerId: '0',
    entities: [],
    blocks: {},            /* SPEC2 Â§15: {[name]: {base:{x,y}, entities:[...]}} */
    views: [],             /* SPEC3 Â§23: [{name, scale, tx, ty}] named views */
    layouts: ['Layout1', 'Layout2'],  /* the paper tabs, in tab order */
    layoutData: {},        /* per layout: {entities, undoStack, redoStack, viewports} */
    groups: [],            /* [{name, desc, selectable, ids}] — unnamed are *A1… */
    styles: defaultStyles(),  /* text/dim/mleader/table style tables + currents */
    undoStack: [],
    redoStack: [],
    view: { scale: 1, tx: 0, ty: 0 }
  });

  /* GL-PLAN phase 4 (the drawing hang): a snapshot used to be ONE
   * JSON.stringify of the whole document — entities AND the block table.
   * On a block library that is hundreds of megabytes of JSON, so every
   * pencil click (each commit calls pushUndo) froze the window for
   * seconds. Snapshots are now SECTIONS, and the block-table section is
   * reused by identity: a def edit replaces the def object or its
   * entities array (the invariant the renderer's def-fingerprint cache
   * already enshrines — fpDef is keyed on the array's identity), so
   * comparing those references proves the cached string still tells the
   * truth. Layers and groups mutate in place and are small: always
   * stringified. Entities are always stringified — that is the state
   * being protected. Unchanged block sections also SHARE one string
   * across the whole undo stack instead of copying it per step. */
  const blkCache = { doc: null, obj: null, names: null, arrs: null, json: '' };
  const blkCacheValid = (doc) => {
    const b = doc.blocks || {};
    if (blkCache.doc !== doc || blkCache.obj !== b) return false;
    const names = Object.keys(b);
    if (blkCache.names.length !== names.length) return false;
    for (let i = 0; i < names.length; i++) {
      const d = b[names[i]];
      const c = blkCache.arrs.get(names[i]);
      if (!c || c.def !== d || c.arr !== (d && d.entities)) return false;
    }
    return true;
  };
  const blocksJson = (doc) => {
    if (blkCacheValid(doc)) return blkCache.json;
    const b = doc.blocks || {};
    const names = Object.keys(b);
    const arrs = new Map();
    for (const n of names) arrs.set(n, { def: b[n], arr: b[n] && b[n].entities });
    blkCache.doc = doc;
    blkCache.obj = b;
    blkCache.names = names;
    blkCache.arrs = arrs;
    blkCache.json = JSON.stringify(b);
    return blkCache.json;
  };

  /* THE SAME STRING, A FRAME AT A TIME. A block library stringifies to a
   * third of a gigabyte and JSON.stringify does it in one 1.35s bite —
   * 1.35s in which the window cannot put a frame up and the crosshair
   * stands still. So the open front-load builds it definition by
   * definition against a deadline instead, appending as it goes (the
   * pieces stay a rope until something reads the whole string, so no slice
   * ever pays for the ones before it). What comes out is byte-identical to
   * JSON.stringify(doc.blocks): the same keys in the same insertion order,
   * with the same values, and keys whose value has no JSON dropped exactly
   * the way the whole-object call drops them. true = more to do. */
  let blkJob = null;
  /* ONE DEFINITION, and — when it is a big one — one child at a time.
     Object.keys is the order JSON.stringify writes, a key whose value has
     no JSON is dropped exactly as it drops it, and an array element that
     has none becomes null exactly as it makes it. Returns the string, or
     null while there is more of this definition to do. */
  const LONG_ARR = 1000;
  const defJsonStep = (j, def, deadline) => {
    if (def === undefined || typeof def === 'function') return { s: undefined };
    if (def === null || typeof def !== 'object' || Array.isArray(def)) {
      return { s: JSON.stringify(def) };
    }
    let d = j.d;
    if (!d) d = j.d = { keys: Object.keys(def), ki: 0, out: '', any: false, arr: null };
    while (d.ki < d.keys.length) {
      const k = d.keys[d.ki];
      const v = def[k];
      let s;
      if (Array.isArray(v) && v.length > LONG_ARR) {
        let a = d.arr;
        if (!a) a = d.arr = { i: 0, out: '' };
        while (a.i < v.length) {
          if (deadline && !(a.i & 255) && performance.now() > deadline) return null;
          const e = JSON.stringify(v[a.i]);
          a.out += (a.i ? ',' : '') + (e === undefined ? 'null' : e);
          a.i++;
        }
        s = '[' + a.out + ']';
        d.arr = null;
      } else {
        if (deadline && performance.now() > deadline) return null;
        s = JSON.stringify(v);
      }
      d.ki++;
      if (s === undefined) continue;      /* JSON.stringify drops these keys */
      d.out += (d.any ? ',' : '') + JSON.stringify(k) + ':' + s;
      d.any = true;
    }
    j.d = null;
    return { s: '{' + d.out + '}' };
  };
  const blocksJsonStep = (doc, deadline) => {
    if (blkCacheValid(doc)) { blkJob = null; return false; }
    const b = doc.blocks || {};
    if (!blkJob || blkJob.doc !== doc || blkJob.obj !== b) {
      blkJob = { doc, obj: b, names: Object.keys(b), i: 0, any: false,
        json: '', d: null, arrs: new Map() };
    }
    const j = blkJob;
    while (j.i < j.names.length) {
      if (deadline && !j.d && performance.now() > deadline) return true;
      const n = j.names[j.i];
      const r = defJsonStep(j, b[n], deadline);
      if (!r) return true;                /* mid-definition: come back */
      j.arrs.set(n, { def: b[n], arr: b[n] && b[n].entities });
      j.i++;
      if (r.s === undefined) continue;
      j.json += (j.any ? ',' : '') + JSON.stringify(n) + ':' + r.s;
      j.any = true;
    }
    blkCache.doc = doc;
    blkCache.obj = b;
    blkCache.names = j.names;
    blkCache.arrs = j.arrs;
    blkCache.json = '{' + j.json + '}';
    blkJob = null;
    return false;
  };

  /* ---- THE WARM SNAPSHOT ----------------------------------------------
   * A full-sectioned snapshot's entities string costs one JSON.stringify
   * of the whole drawing — 194ms of frozen commit on a 241k-entity block
   * library, paid by every command outside MEMB_ONLY/SCOPED_SEL and by
   * undo/redo's counter-snapshots. The document between commits is IDLE
   * TIME: the string builds there, in 5ms slices, and the next consumer
   * finds it warm. Construction is byte-identical to JSON.stringify
   * (element strings joined with commas inside brackets — exactly what
   * the one-bite call emits for an array of plain objects).
   * VALIDITY: the entities array's identity, length and end ids, dropped
   * besides on every op wrap below and on every 'nasj:doc' beat — an
   * in-place mutation is always bracketed by pushUndo (which drops)
   * before it and the commit's emit (which drops) after it. */
  const WARM_MIN_ENTS = 20000;
  const warmEnds = (arr) => (arr.length ? arr[0].id + ' ' + arr[arr.length - 1].id : '');
  let warm = null;        /* {doc, arr, len, ends, parts, i, json} */
  let warmTimer = 0;
  const warmDrop = () => {
    warm = null;
    if (warmTimer) { clearTimeout(warmTimer); warmTimer = 0; }
  };
  const warmValid = (doc) => !!(warm && warm.doc === doc &&
    warm.arr === doc.entities && warm.len === doc.entities.length &&
    warm.ends === warmEnds(doc.entities));
  const warmStep = (deadline) => {       /* true = more to do */
    const w = warm;
    if (!w || w.json !== null) return false;
    const arr = w.arr;
    while (w.i < arr.length) {
      w.parts.push(JSON.stringify(arr[w.i++]));
      if (!(w.i & 255) && performance.now() > deadline) return true;
    }
    w.json = arr.length ? '[' + w.parts.join(',') + ']' : '[]';
    w.parts = null;
    return false;
  };
  const warmTick = () => {
    warmTimer = 0;
    const w = warm;
    if (!w) return;
    if (w.doc !== Nasj.doc || !warmValid(w.doc)) { warmDrop(); return; }
    /* stand aside while the app is genuinely busy (an open's parse, the
       GL build) — the slices exist to fill quiet, not to make noise */
    if (w.doc.loading || (Nasj.glscene &&
        typeof Nasj.glscene.building === 'function' && Nasj.glscene.building())) {
      warmTimer = setTimeout(warmTick, 250);
      return;
    }
    if (warmStep(performance.now() + 5)) warmTimer = setTimeout(warmTick, 16);
  };
  const warmKick = (doc) => {
    warmDrop();
    if (!doc || !Array.isArray(doc.entities) ||
        doc.entities.length < WARM_MIN_ENTS) return;
    warm = { doc, arr: doc.entities, len: doc.entities.length,
      ends: warmEnds(doc.entities), parts: [], i: 0, json: null };
    warmTimer = setTimeout(warmTick, 200);
  };
  const entitiesJson = (doc) => {
    if (warmValid(doc)) {
      /* whatever the idle slices had not reached finishes here — never
         more than the cold stringify would have cost */
      while (warmStep(Infinity)) { /* run to the end */ }
      if (warm && warm.json !== null) return warm.json;
    }
    return JSON.stringify(doc.entities);
  };
  /* every commit ends in this beat: the state moved (drop), and the NEW
     state is the one the next snapshot will describe (re-arm at idle) */
  if (typeof window !== 'undefined') {
    window.addEventListener('nasj:doc', () => {
      warmDrop();
      warmTimer = setTimeout(() => { warmTimer = 0; warmKick(Nasj.doc); }, 400);
    });
  }

  const snapshot = (doc) => ({
    entities: entitiesJson(doc),
    layers: JSON.stringify(doc.layers),
    currentLayerId: doc.currentLayerId,
    blocks: blocksJson(doc),
    groups: JSON.stringify(doc.groups || [])
  });

  /* the non-entity sections shared by both snapshot shapes */
  const restoreSections = (doc, s) => {
    if (s.layers != null) doc.layers = JSON.parse(s.layers);
    if (s.currentLayerId != null) doc.currentLayerId = s.currentLayerId;
    /* the block table is huge and rarely moves: when the snapshot's string
       IS the cache's string and the cache still verifies against the live
       table, the two are equal — skip a re-parse of the whole library.
       Membership-only entries omit `blocks` and leave the live table. */
    if (s.blocks != null && !(s.blocks === blkCache.json && blkCacheValid(doc))) {
      doc.blocks = JSON.parse(s.blocks) || {};
    }
    if (s.groups != null) doc.groups = JSON.parse(s.groups) || [];
  };
  const applySnapshot = (doc, s) => {
    doc.entities = JSON.parse(s.entities);
    restoreSections(doc, s);
  };

  /* ---- membership-only undo entries (GL-PLAN phase 4, the drawing hang) —
   * the audited membership-only commands (they add and delete entities but
   * never mutate one in place; the same per-command audit the GL scene's
   * edit hints already ride): their pushUndo skips stringifying a quarter
   * of a million entities per pencil click and records the membership LOG
   * instead — each add's id, each delete's entities with their indices.
   * Undo replays the log backwards: an exact inverse, whatever the
   * interleaving. Everything else keeps the full sectioned snapshot. */
  const MEMB_ONLY = {
    line: 1, pline: 1, polyline: 1, circle: 1, arc: 1, rect: 1,
    rectangle: 1, ellipse: 1, spline: 1, point: 1, hatch: 1,
    copy: 1, offset: 1, erase: 1, trim: 1, extend: 1
  };

  /* ---- SCOPED UNDO ---------------------------------------------------
   * The commands above never mutate an entity in place, so their undo is
   * the membership log alone. The ones below DO — and they all mutate the
   * same known set: THE SELECTION. So their undo is that set's pre-images
   * plus the same membership log, and neither is the size of the drawing.
   * What this replaces: every one of them stringified all 241,280 entities
   * before it began (199ms of hang before a drag could start), and undo
   * and redo each stringified them again to fill the other stack (678ms).
   * The audit behind the list is the same one MEMB_ONLY carries: each of
   * these iterates the SELECTION and transforms in place (move/rotate/
   * scale/mirror/stretch/matchprop/the layer verbs/the 3D booleans), or
   * only adds and deletes (insert/explode/array/divide/measure) — and
   * every one is asserted in qa-eval-modify Â§U, which hashes the document
   * before the edit and again after undo and requires the two to be equal.
   * A command NOT in either table keeps the full sectioned snapshot, and
   * so does any command whose selection is a large part of the drawing
   * (there the scoped entry would cost what the snapshot costs). */
  const SCOPED_SEL = {
    move: 1, rotate: 1, scale: 1, mirror: 1, stretch: 1,
    insert: 1, explode: 1, divide: 1, measureseg: 1, array: 1,
    laycur: 1, matchlayer: 1, setbylayer: 1, scaletext: 1,
    union3d: 1, subtract3d: 1, intersect3d: 1
  };
  let membPend = null;             /* the armed entry's log, filled below */

  /* One scoped entry, applied in either direction. `ops` is the membership
     log in the order the command made it; `pre` is the scope's pre-images,
     which conceptually sit at its head. Going BACKWARD (undo) the log is
     replayed in reverse and the pre-images restored last; going FORWARD
     (redo) the post-images go first and the log replays in order.
     The post side is not known when the entry is made — the command has
     not run yet — so the first backward pass fills it in from the live
     document. After that the entry carries both sides and can be replayed
     either way for as long as it lives on a stack. */
  const scApply = (doc, sc, back) => {
    const arr = doc.entities;
    const fill = back && !sc.done;
    /* the scope is answered through one id map, in both directions: a
       scoped MOVE of five thousand objects would otherwise scan a
       quarter-million-entity array five thousand times, which is a
       thousand times the work the edit itself was. The map is built before
       any splice and rebuilt after the membership phase, which is the only
       thing that can move an index. */
    const indexOf = () => {
      const m = new Map();
      for (let i = 0; i < arr.length; i++) m.set(arr[i].id, i);
      return m;
    };
    /* AN IN-PLACE RESTORE KEEPS THE ENTITY OBJECT and changes its contents.
       entityById's index, the spatial index and the scene's per-entity
       records all key on IDENTITY, and none of them can tell that a fresh
       object with the same id at the same place is a different object — a
       scoped undo that changed nothing about membership would leave every
       one of them handing out a detached copy, and the next MOVE would move
       something the drawing no longer contains. Dropping the keys the
       pre-image does not carry makes the two exactly equal. */
    const putInto = (cur, json) => {
      const v = JSON.parse(json);
      for (const k of Object.keys(cur)) if (!(k in v)) delete cur[k];
      Object.assign(cur, v);
    };
    const putAll = (list, key) => {
      if (!list.length) return;
      const at = indexOf();
      for (const r of list) {
        const j = r[key];
        if (j == null) continue;                 /* the command deleted it */
        const i = at.get(r.id);
        if (i !== undefined) putInto(arr[i], j);
      }
    };
    if (back) {
      if (fill && sc.pre.length) {
        const at = indexOf();
        for (const r of sc.pre) {
          const i = at.get(r.id);
          r.post = (i === undefined) ? null : JSON.stringify(arr[i]);
        }
      }
      for (let k = sc.ops.length - 1; k >= 0; k--) {
        const ev = sc.ops[k];
        if (ev.a != null) {
          for (let i = arr.length - 1; i >= 0; i--) {   /* adds append: scan from the end */
            if (arr[i].id === ev.a) {
              /* WHERE it stood, not just what it was: an add appends, but a
                 command may move it afterwards and never say so (HATCH sends
                 its fill to the back, TEXTMASK slides its patch under the
                 text). Redo puts it back at the index undo found it at,
                 which is its place in the state this step produces. */
              if (fill) { ev.j = JSON.stringify(arr[i]); ev.i = i; }
              arr.splice(i, 1);
              break;
            }
          }
        } else if (ev.m) {
          /* in-place mutation: the captured pre-image replaces it */
          for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i].id === ev.m.id) {
              if (fill) ev.m.post = JSON.stringify(arr[i]);
              putInto(arr[i], ev.m.pre);
              break;
            }
          }
        } else {
          for (const r of ev.d) {
            arr.splice(Math.min(r.i, arr.length), 0, JSON.parse(r.json));
          }
        }
      }
      putAll(sc.pre, 'pre');
      sc.done = true;
      return;
    }
    putAll(sc.pre, 'post');
    for (let k = 0; k < sc.ops.length; k++) {
      const ev = sc.ops[k];
      if (ev.a != null) {
        if (ev.j != null) {
          const at = (typeof ev.i === 'number') ? Math.min(ev.i, arr.length) : arr.length;
          arr.splice(at, 0, JSON.parse(ev.j));
        }
      } else if (ev.m) {
        for (let i = arr.length - 1; i >= 0; i--) {
          if (arr[i].id === ev.m.id) { putInto(arr[i], ev.m.post); break; }
        }
      } else {
        const dead = new Set();
        for (const r of ev.d) {
          const q = JSON.parse(r.json);
          if (q && q.id != null) dead.add(q.id);
        }
        for (let i = arr.length - 1; i >= 0; i--) if (dead.has(arr[i].id)) arr.splice(i, 1);
      }
    }
  };
  /* the four non-entity sections, as they stand right now */
  const sectionsOf = (doc) => ({
    layers: JSON.stringify(doc.layers),
    currentLayerId: doc.currentLayerId,
    blocks: blocksJson(doc),
    groups: JSON.stringify(doc.groups || [])
  });
  /* membership-only tools never redefine a block. blocksJson still walked
     every definition to prove the cached string (6,484 Object.keys on
     BLOCKS.dwg, every LINE click). Undo keeps the live table. */
  const sectionsOfMemb = (doc) => ({
    layers: JSON.stringify(doc.layers),
    currentLayerId: doc.currentLayerId,
    groups: JSON.stringify(doc.groups || [])
  });

  /* deserialize validation: required finite geometry per type (SPEC Â§7) */
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const isPt = (p) => !!p && typeof p === 'object' && isNum(p.x) && isNum(p.y);

  /* a layout viewport: a rectangle of paper (mm) showing the model point ctr
     at its middle, at `scale` sheet millimetres per model unit */
  const repairViewport = (v) => {
    if (!v || typeof v !== 'object') return null;
    if (!(isNum(v.x) && isNum(v.y) && isNum(v.w) && isNum(v.h))) return null;
    if (!(v.w > 0 && v.h > 0)) return null;
    if (!isPt(v.ctr) || !(isNum(v.scale) && v.scale > 0)) return null;
    return { x: v.x, y: v.y, w: v.w, h: v.h, ctr: { x: v.ctr.x, y: v.ctr.y }, scale: v.scale };
  };

  /* hatch boundary validation (SPEC2 Â§15) */
  const repairBoundary = (b) => {
    if (!b || typeof b !== 'object') return null;
    switch (b.kind) {
      case 'pline': {
        if (!Array.isArray(b.pts)) return null;
        const pts = b.pts.filter(isPt);
        if (pts.length < 3) return null;
        b.pts = pts;
        b.closed = true;
        return b;
      }
      case 'circle': return (isPt(b.c) && isNum(b.r) && b.r > 0) ? b : null;
      case 'ellipse': {
        if (!(isPt(b.c) && isNum(b.rx) && b.rx > 0 && isNum(b.ry) && b.ry > 0)) return null;
        if (!isNum(b.rot)) b.rot = 0;
        return b;
      }
      default: return null;
    }
  };

  /* XCLIP boundary on a reference. The ring is kept in the DEFINITION's own
     coordinates, not the world's, so it rides along when the reference is
     moved, scaled or rotated — which is what the industry standard's clip does. */
  const repairClip = (c) => {
    if (!c || typeof c !== 'object') return null;
    const pts = (Array.isArray(c.pts) ? c.pts : []).filter(isPt);
    if (pts.length < 3) return null;
    return { pts, on: c.on !== false, inverted: !!c.inverted };
  };

  /* A block definition backed by a file on disk — an external reference.
     `layers` is the reference's OWN layer table (ULAYERS switches these; they
     are deliberately kept out of the host's table so two drawings that both
     use layer "0" cannot collide). `fade` overrides XDWGFADECTL for this one
     reference, the way ADJUST does; null means follow the system variable. */
  const repairXref = (x) => {
    if (!x || typeof x !== 'object') return null;
    if (typeof x.path !== 'string' || !x.path) return null;
    const layers = (Array.isArray(x.layers) ? x.layers : [])
      .filter(l => l && typeof l === 'object' && l.id != null)
      .map(l => ({
        id: String(l.id),
        name: l.name != null ? String(l.name) : String(l.id),
        color: typeof l.color === 'string' ? l.color : '#ffffff',
        on: l.on !== false
      }));
    return {
      path: x.path,
      /* what the file measured when it was last read (bytes, epoch ms) */
      size: isNum(x.size) ? x.size : null,
      date: isNum(x.date) ? x.date : null,
      type: x.type === 'overlay' ? 'overlay' : 'attach',
      pathType: (x.pathType === 'relative' || x.pathType === 'none') ? x.pathType : 'full',
      found: x.found !== false,
      unloaded: !!x.unloaded,
      fade: isNum(x.fade) ? Math.max(0, Math.min(90, x.fade)) : null,
      layers
    };
  };

  const DIM_KINDS = ['linear', 'aligned', 'radius', 'diameter', 'angular'];

  /* ---- linetype / lineweight (SPEC3 Â§23) ---- */
  const LT_NAMES = ['continuous', 'dashed', 'center', 'hidden', 'dot'];
  /* MKLTYPE's linetypes join this LIVE array for the session — canonLt reads
     the same list, so a custom name survives repairStyle and a reopen */
  Nasj.linetypeNames = LT_NAMES;

  /* canonical linetype name or null; 'ByLayer' allowed only on entities */
  const canonLt = (v, allowByLayer) => {
    if (typeof v !== 'string') return null;
    const s = v.toLowerCase();
    if (allowByLayer && s === 'bylayer') return 'ByLayer';
    return LT_NAMES.includes(s) ? s : null;
  };

  const clampLw = (v) => Math.min(2.11, Math.max(0, v));

  /* normalize optional lt/lw/lts on a deserialized entity (drop when invalid) */
  const repairStyle = (e) => {
    if (e.lt != null) {
      const lt = canonLt(e.lt, true);
      if (lt) e.lt = lt; else delete e.lt;
    }
    if (e.lw != null) {
      if (isNum(e.lw)) e.lw = clampLw(e.lw); else delete e.lw;
    }
    /* linetype scale (>0), multiplies the linetype dash pattern */
    if (e.lts != null && !(isNum(e.lts) && e.lts > 0)) delete e.lts;
    /* the annotation style the object was drawn with (text/dim/leader/table) */
    if (e.style != null) {
      const s = String(e.style).trim();
      if (s) e.style = s; else delete e.style;
    }
    return e;
  };

  /* ---- optional z coordinate (3D foundation) ----
     Any point may carry a finite z (default 0). Invalid z values are dropped,
     never fatal; xy validation is unchanged. */
  const fixZ = (p) => {
    if (p && typeof p === 'object' && p.z != null && !isNum(p.z)) delete p.z;
    return p;
  };

  const repairZ = (e) => {
    for (const k of ['a', 'b', 'c', 'p', 'p1', 'p2', 'p3', 'p4']) {
      if (e[k] && typeof e[k] === 'object') fixZ(e[k]);
    }
    if (Array.isArray(e.pts)) e.pts.forEach(fixZ);
    if (e.boundary && typeof e.boundary === 'object') {
      if (Array.isArray(e.boundary.pts)) e.boundary.pts.forEach(fixZ);
      if (e.boundary.c) fixZ(e.boundary.c);
    }
    return e;
  };

  /* returns the (possibly repaired) entity, or null if unsalvageable */
  const repairEntity = (e) => {
    const r = repairGeom(e);
    return r ? repairStyle(repairZ(r)) : null;
  };

  const repairGeom = (e) => {
    if (!e || typeof e !== 'object') return null;
    switch (e.type) {
      case 'line': return (isPt(e.a) && isPt(e.b)) ? e : null;
      case 'circle': return (isPt(e.c) && isNum(e.r) && e.r > 0) ? e : null;
      case 'arc':
        return (isPt(e.c) && isNum(e.r) && e.r > 0 && isNum(e.a0) && isNum(e.a1)) ? e : null;
      case 'polyline': {
        if (!Array.isArray(e.pts)) return null;
        const pts = e.pts.filter(isPt);
        if (pts.length < 2) return null;
        /* per-vertex bulge b (finite kept, else dropped) + const width w > 0 */
        for (const p of pts) { if (p.b != null && !isNum(p.b)) delete p.b; }
        e.pts = pts;
        if (e.w != null && !(isNum(e.w) && e.w > 0)) delete e.w;
        return e;
      }
      /* An ellipse may carry a sweep — a0/a1 in its OWN parametric angle,
         the same t ellipsePoint takes — which makes it an elliptical arc.
         Both together or neither; a full turn is stored as no sweep at all,
         so everything already written stays a plain ellipse. */
      case 'ellipse': {
        if (!(isPt(e.c) && isNum(e.rx) && e.rx > 0 && isNum(e.ry) && e.ry > 0)) return null;
        if (e.a0 == null && e.a1 == null) return e;
        if (!isNum(e.a0) || !isNum(e.a1)) { delete e.a0; delete e.a1; return e; }
        if (ellipseSweep(e) >= TAU - 1e-9) { delete e.a0; delete e.a1; }
        return e;
      }
      /* An attribute definition: a piece of text inside a block that asks
         for its value when the block is inserted. It draws exactly like
         text, so everything below it is the text repair, plus the tag,
         prompt, default and the modes the industry standard gives it. */
      case 'attdef': {
        if (!(isPt(e.p) && isNum(e.h) && e.h > 0)) return null;
        e.tag = String(e.tag == null ? 'TAG' : e.tag).trim().replace(/\s+/g, '_') || 'TAG';
        e.prompt = e.prompt == null ? '' : String(e.prompt);
        e.dflt = e.dflt == null ? '' : String(e.dflt);
        e.invisible = !!e.invisible;
        e.constant = !!e.constant;
        e.verify = !!e.verify;
        e.preset = !!e.preset;
        /* Lock position holds it in place inside the block (no grip);
           Multiple lines carries its boundary width; Annotative records
           that it should follow the annotation scale */
        e.lockPos = !!e.lockPos;
        e.mline = !!e.mline;
        if (!(isNum(e.bw) && e.bw > 0)) delete e.bw;
        if (!e.anno) delete e.anno; else e.anno = true;
        e.str = e.tag;                 /* what it shows before it is filled */
        if (e.ha != null && e.ha !== 0 && e.ha !== 1 && e.ha !== 2 && e.ha !== 4) delete e.ha;
        if (e.va != null && e.va !== 0 && e.va !== 1 && e.va !== 2 && e.va !== 3) delete e.va;
        if (e.p2 != null && !isPt(e.p2)) delete e.p2;
        if (e.wf != null && !(isNum(e.wf) && e.wf > 0)) delete e.wf;
        return e;
      }
      case 'text': {
        if (!(isPt(e.p) && e.str != null && isNum(e.h) && e.h > 0)) return null;
        /* optional DXF-style justification: ha 0 left/1 center/2 right/4 middle,
           va 0 baseline/1 bottom/2 middle/3 top, p2 second alignment point,
           wf width factor (>0). Invalid values are dropped, never fatal. */
        if (e.ha != null && e.ha !== 0 && e.ha !== 1 && e.ha !== 2 && e.ha !== 4) delete e.ha;
        if (e.va != null && e.va !== 0 && e.va !== 1 && e.va !== 2 && e.va !== 3) delete e.va;
        if (e.p2 != null && !isPt(e.p2)) delete e.p2;
        if (e.wf != null && !(isNum(e.wf) && e.wf > 0)) delete e.wf;
        return e;
      }
      case 'mline': {
        if (!Array.isArray(e.pts) || e.pts.length < 2 || !e.pts.every(isPt)) return null;
        e.pts = e.pts.map(p => ({ x: p.x, y: p.y }));
        e.closed = !!e.closed;
        if (MLINE_JUST.indexOf(e.just) < 0) e.just = 'Top';
        if (!(isNum(e.scale) && e.scale !== 0)) e.scale = 1;
        e.style = (typeof e.style === 'string' && e.style.trim()) ? e.style : 'STANDARD';
        /* MLEDIT's gaps: an element index and a run of length along it */
        if (Array.isArray(e.cuts)) {
          e.cuts = e.cuts
            .filter(c => c && isNum(c.el) && c.el >= 0 && isNum(c.s) && isNum(c.e) && c.s !== c.e)
            .map(c => ({ el: Math.floor(c.el), s: Math.min(c.s, c.e), e: Math.max(c.s, c.e) }));
          if (!e.cuts.length) delete e.cuts;
        } else delete e.cuts;
        return e;
      }
      case 'point': return isPt(e.p) ? e : null;
      /* A LIGHT is data about how a scene would be lit — the same standing a
         material has here. `p` is the source; a spot and a distant light also
         aim at `tgt`. Two fields deliberately avoid names an entity already
         uses: the kind is `lkind`, not `lt`, which is the linetype every
         entity carries and which repairStyle below would strip a light kind
         out of; and the filter colour is `fcolor`, clear of the `color` the
         glyph itself draws in. */
      case 'light': {
        if (!isPt(e.p)) return null;
        e.lkind = (e.lkind === 'spot' || e.lkind === 'distant') ? e.lkind : 'point';
        if (e.lkind === 'point') delete e.tgt;
        else if (!isPt(e.tgt)) return null;
        e.name = (typeof e.name === 'string' && e.name.trim()) ? e.name.trim() : 'Light';
        e.on = e.on !== false;
        e.int = (isNum(e.int) && e.int >= 0) ? e.int : 1;
        e.shadow = e.shadow !== false;
        if (typeof e.fcolor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(e.fcolor)) e.fcolor = '#ffffff';
        if (e.lkind === 'spot') {
          /* the industry standard keeps the hotspot inside the falloff; a cone that fell
             through itself would light nothing */
          e.hot = (isNum(e.hot) && e.hot > 0) ? Math.min(160, e.hot) : 44;
          e.fall = (isNum(e.fall) && e.fall > 0) ? Math.min(160, e.fall) : 50;
          if (e.hot > e.fall) e.hot = e.fall;
        } else { delete e.hot; delete e.fall; }
        if (e.lkind === 'distant') delete e.atten;
        else if (!['None', 'Inverse Linear', 'Inverse Square'].includes(e.atten)) e.atten = 'None';
        return e;
      }
      /* ArcAlignedText (Express Tools ARCTEXT): text laid letter by letter
         along an arc. It carries its own copy of the arc's geometry and the
         id of the arc it follows (srcId) — editing the arc re-reads it, and
         transforming the TEXT alone lets go, exactly the hatch contract. */
      case 'arctext': {
        if (!isPt(e.c) || !isNum(e.r) || e.r <= 0 || !isNum(e.a0) || !isNum(e.a1)) return null;
        e.str = String(e.str == null ? '' : e.str);
        e.h = (isNum(e.h) && e.h > 0) ? e.h : 1;
        e.wf = (isNum(e.wf) && e.wf > 0) ? e.wf : 1;
        e.spacing = (isNum(e.spacing) && e.spacing >= 0) ? e.spacing : 0;
        for (const kk of ['offArc', 'offL', 'offR']) e[kk] = isNum(e[kk]) ? e[kk] : 0;
        e.just = ['L', 'R', 'C', 'F'].includes(e.just) ? e.just : 'F';
        e.side = e.side === 'concave' ? 'concave' : 'convex';
        e.orient = e.orient === 'in' ? 'in' : 'out';
        e.reverse = !!e.reverse;
        e.bold = !!e.bold;
        e.italic = !!e.italic;
        e.underline = !!e.underline;
        if (typeof e.font !== 'string' || !e.font) e.font = 'Arial';
        return e;
      }
      case 'xline': {               /* construction line; ray = one-sided */
        if (!isPt(e.p) || !isPt(e.d)) return null;
        const L = Math.hypot(e.d.x, e.d.y);
        if (!(L > 1e-12)) return null;
        e.d = { x: e.d.x / L, y: e.d.y / L };
        e.ray = !!e.ray;
        return e;
      }
      case 'hatch': {
        if (!repairBoundary(e.boundary)) return null;
        /* any pattern NAME is kept (uppercased) — the renderer resolves it
           against its pattern library and falls back to ANSI31 lines, so an
           unknown name degrades visibly instead of silently going SOLID */
        e.pattern = (typeof e.pattern === 'string' && e.pattern.trim())
          ? e.pattern.trim().toUpperCase() : 'SOLID';
        if (!isNum(e.angle)) e.angle = 0;
        if (!isNum(e.scale) || e.scale <= 0) e.scale = 1;
        /* original DXF pattern name (string) — kept for render + round-trip */
        if (e.patName != null && typeof e.patName !== 'string') delete e.patName;
        /* optional true pattern line spacing (world units, imported CAD) */
        if (e.sp != null && !(isNum(e.sp) && e.sp > 0)) delete e.sp;
        /* render-only island loops from pick-point boundary tracing */
        if (e.islands != null) {
          const ok = Array.isArray(e.islands) &&
            e.islands.every((l) => Array.isArray(l) && l.length >= 3 && l.every(isPt));
          if (!ok) delete e.islands;
        }
        return e;
      }
      case 'spline': {
        if (!Array.isArray(e.pts)) return null;
        const pts = e.pts.filter(isPt);
        if (pts.length < 2) return null;
        e.pts = pts;
        return e;
      }
      case 'dim': {
        if (!DIM_KINDS.includes(e.kind)) return null;
        if (!(isPt(e.p1) && isPt(e.p2) && isPt(e.p3))) return null;
        if (e.kind === 'angular' && !isPt(e.p4)) e.p4 = mid(e.p2, e.p3);
        if (e.kind === 'linear' && e.orient !== 'h' && e.orient !== 'v') e.orient = 'h';
        if (!isNum(e.h) || e.h <= 0) e.h = 3;
        return e;
      }
      case 'leader': {
        if (!Array.isArray(e.pts)) return null;
        const pts = e.pts.filter(isPt);
        if (!pts.length) return null;
        e.pts = pts;
        if (e.str == null) e.str = '';
        if (!isNum(e.h) || e.h <= 0) e.h = 3;
        return e;
      }
      case 'table': {
        if (!isPt(e.p)) return null;
        e.rows = isNum(e.rows) && e.rows >= 1 ? Math.round(e.rows) : 1;
        e.cols = isNum(e.cols) && e.cols >= 1 ? Math.round(e.cols) : 1;
        if (!isNum(e.colw) || e.colw <= 0) e.colw = 30;
        if (!isNum(e.rowh) || e.rowh <= 0) e.rowh = 8;
        if (!e.cells || typeof e.cells !== 'object') e.cells = {};
        return e;
      }
      case 'insert': {
        if (typeof e.name !== 'string' || !e.name || !isPt(e.p)) return null;
        if (!isNum(e.sx) || e.sx === 0) e.sx = 1;
        if (!isNum(e.sy) || e.sy === 0) e.sy = 1;
        if (!isNum(e.rot)) e.rot = 0;
        const clip = repairClip(e.clip);
        if (clip) e.clip = clip; else delete e.clip;
        return e;
      }
      case 'face3d': { /* 3-4 corner planar facet; pts may carry z */
        /* a DWG calls them 'corners' — the same three or four points. Without
           this every 3D face in an imported model was dropped on the way in,
           which is why such a drawing arrived as bare edges. */
        if (!Array.isArray(e.pts) && Array.isArray(e.corners)) {
          e.pts = e.corners;
          delete e.corners;
        }
        if (!Array.isArray(e.pts)) return null;
        const pts = e.pts.filter(isPt);
        if (pts.length < 3) return null;
        e.pts = pts.slice(0, 4);
        /* the edges a DWG marks invisible: a bitmask, bit i for the edge
           from corner i to the next */
        if (!(isNum(e.hid) && e.hid > 0)) delete e.hid; else e.hid = e.hid | 0;
        return e;
      }
      case 'box': /* axis-aligned box: min corner p (z optional), w/d/h > 0 */
        return (isPt(e.p) && isNum(e.w) && e.w > 0 && isNum(e.d) && e.d > 0 &&
                isNum(e.h) && e.h > 0) ? e : null;
      case 'solid': { /* polyhedral body: planar faces {pts, holes?}, wires */
        if (!Array.isArray(e.faces)) return null;
        const ring = (r) => Array.isArray(r) && r.length >= 3 && r.every(isPt);
        e.faces = e.faces.filter((f) => f && ring(f.pts)).map((f) => {
          const g = { pts: f.pts };
          if (Array.isArray(f.holes)) {
            const h = f.holes.filter(ring);
            if (h.length) g.holes = h;
          }
          if (isNum(f.hid) && f.hid > 0) g.hid = f.hid | 0;
          /* per-face colour (SOLIDEDIT Color Faces) — a css color string */
          if (typeof f.color === 'string' && f.color) g.color = f.color;
          return g;
        });
        e.wires = Array.isArray(e.wires)
          ? e.wires.filter((w) => Array.isArray(w) && w.length >= 2 && w.every(isPt)) : [];
        if (!e.faces.length && !e.wires.length) return null;
        if (e.two !== true) delete e.two;
        return e;
      }
      case 'wall': { /* BIM wall: centre run pts, thickness t, height h, base z */
        if (!Array.isArray(e.pts)) return null;
        e.pts = e.pts.filter(isPt).map((p) => ({ x: p.x, y: p.y }));
        if (e.pts.length < 2 || !(isNum(e.t) && e.t > 0) || !(isNum(e.h) && e.h > 0)) return null;
        if (!isNum(e.z)) delete e.z;
        e.closed = !!e.closed && e.pts.length >= 3;
        if (Array.isArray(e.openings)) {
          e.openings = e.openings.filter((o) => o && isNum(o.seg) && isNum(o.s) &&
            isNum(o.w) && o.w > 0 && isNum(o.h) && o.h > 0).map((o) => ({
              kind: o.kind === 'door' ? 'door' : 'window', seg: o.seg | 0, s: o.s,
              w: o.w, z0: isNum(o.z0) ? o.z0 : 0, h: o.h }));
          if (!e.openings.length) delete e.openings;
        } else delete e.openings;
        return e;
      }
      case 'slab': { /* BIM slab: closed outline pts, thickness th, base z */
        if (!Array.isArray(e.pts)) return null;
        e.pts = e.pts.filter(isPt).map((p) => ({ x: p.x, y: p.y }));
        if (e.pts.length < 3 || !(isNum(e.th) && e.th > 0)) return null;
        if (!isNum(e.z)) delete e.z;
        return e;
      }
      case 'image': /* raster attachment (IMAGEATTACH): lower-left p, size
                       wÃ—h in world units, bitmap in doc.images[e.img] */
        if (!(isPt(e.p) && isNum(e.w) && e.w > 0 && isNum(e.h) && e.h > 0)) return null;
        if (typeof e.img !== 'string' || !e.img) return null;
        if (!isNum(e.rot)) e.rot = 0;
        e.fy = e.fy === -1 ? -1 : 1;    /* -1 = mirrored across its own width */
        if (!(isNum(e.iw) && e.iw > 0)) e.iw = 1;
        if (!(isNum(e.ih) && e.ih > 0)) e.ih = 1;
        return e;
      default: return null;
    }
  };

  /* entityById's id index (see below) */
  let idIndex = null, idIndexArr = null, idIndexLen = -1, idIndexEnds = '';
  /* entityPos's DRAW-ORDER index (see below). Separate from the id index and
     built only when something asks for order, so the drawing and hover paths
     never carry it. Patched by addEntity, dropped by a delete. */
  let posIndex = null, posArr = null, posLen = -1, posEnds = '';

  Nasj.docOps = {
    /* the style tables a fresh drawing starts with, one complete definition
       of a kind, and the style a text object draws with — the style registry
       (tools.js) and the renderer build on these */
    defaultStyles,
    repairStyles,
    styleDef,
    textStyleOf,

    /* ---- layouts (SPEC2 Â§15) ----------------------------------------
     * A layout owns its paper-space entities, its own undo stacks and its
     * viewports. Every tool reads doc.entities, so the space being edited
     * is swapped into that field: doc.$space parks model space while a
     * sheet is live, and hands it back when the sheet is left. */
    layoutData(doc, name) {
      if (!doc.layoutData || typeof doc.layoutData !== 'object') doc.layoutData = {};
      let L = doc.layoutData[name];
      if (!L || typeof L !== 'object') L = doc.layoutData[name] = {};
      if (!Array.isArray(L.entities)) L.entities = [];
      if (!Array.isArray(L.undoStack)) L.undoStack = [];
      if (!Array.isArray(L.redoStack)) L.redoStack = [];
      if (!Array.isArray(L.viewports)) L.viewports = [];
      return L;
    },
    /* L = the layout to edit, or null for model space */
    editSpace(doc, L) {
      membPend = null;               /* the entities list is being swapped */
      const cur = doc.$space;
      if (cur) {                        /* the sheet takes its own list back */
        cur.L.entities = doc.entities;
        cur.L.undoStack = doc.undoStack;
        cur.L.redoStack = doc.redoStack;
        doc.entities = cur.entities;
        doc.undoStack = cur.undoStack;
        doc.redoStack = cur.redoStack;
        doc.$space = null;
      }
      if (!L) return;
      doc.$space = {
        L, entities: doc.entities, undoStack: doc.undoStack, redoStack: doc.redoStack,
      };
      doc.entities = L.entities;
      doc.undoStack = L.undoStack;
      doc.redoStack = L.redoStack;
    },
    /* model space, whichever space is being edited right now */
    modelEntities(doc) { return doc.$space ? doc.$space.entities : doc.entities; },

    /* scopeIds (optional): the entities this command is about to change IN
       PLACE. A command that touches only the selection need not pass it —
       SCOPED_SEL names those, and the selection is read here. */
    pushUndo(doc, scopeIds) {
      membPend = null;
      const name = Nasj.tools && Nasj.tools.activeName;
      let scope = null;
      if (name && MEMB_ONLY[name]) {
        scope = [];                                  /* nothing mutates in place */
      } else {
        const ids = scopeIds || ((name && SCOPED_SEL[name]) ? Nasj.selection : null);
        if (ids) {
          const n = (ids.size !== undefined) ? ids.size : ids.length;
          /* past a slice of the drawing the scoped entry costs what the
             snapshot costs, and the snapshot needs no audit to be right */
          if (n * 2 <= doc.entities.length) {
            scope = [];
            for (const id of ids) {
              const e = this.entityById(doc, id);
              if (e) scope.push({ id, pre: JSON.stringify(e), post: null });
            }
          }
        }
      }
      let entry;
      if (scope) {
        const sc = { ops: [], pre: scope, done: false };
        entry = Object.assign({ sc },
          (name && MEMB_ONLY[name]) ? sectionsOfMemb(doc) : sectionsOf(doc));
        membPend = { doc, log: sc.ops };  /* the doc ref stays out of the entry */
      } else {
        entry = snapshot(doc);
      }
      /* the in-place mutation this entry protects against comes NEXT —
         the warm entities string is spent, whichever branch ran */
      warmDrop();
      doc.undoStack.push(entry);
      if (doc.undoStack.length > 100) doc.undoStack.shift();
      doc.redoStack.length = 0;
    },

    undo(doc) {
      if (!doc.undoStack.length) return false;
      membPend = null;
      const s = doc.undoStack.pop();
      if (s.sc) {
        /* THE INVERSE OF A SCOPED ENTRY IS SCOPED TOO. The redo stack used
           to be filled with a full snapshot of the document — the whole
           678ms of undo, spent describing the parts nothing had touched. */
        const after = sectionsOf(doc);
        scApply(doc, s.sc, true);
        restoreSections(doc, s);
        doc.redoStack.push(Object.assign({ sc: s.sc }, after));
      } else {
        const inv = snapshot(doc);
        /* a whole-document-translation tag rides to the counter-entry,
           negated: applying THAT entry translates the other way (the GL
           scene patches by anchor shift on the tag's word — tools.js) */
        if (s.xf) inv.xf = { dx: -s.xf.dx, dy: -s.xf.dy };
        doc.redoStack.push(inv);
        applySnapshot(doc, s);
      }
      warmDrop();
      doc.modified = true;
      return true;
    },

    redo(doc) {
      if (!doc.redoStack.length) return false;
      membPend = null;
      const s = doc.redoStack.pop();
      if (s.sc) {
        const before = sectionsOf(doc);
        scApply(doc, s.sc, false);
        restoreSections(doc, s);
        doc.undoStack.push(Object.assign({ sc: s.sc }, before));
      } else {
        const inv = snapshot(doc);
        if (s.xf) inv.xf = { dx: -s.xf.dx, dy: -s.xf.dy };
        doc.undoStack.push(inv);
        applySnapshot(doc, s);
      }
      warmDrop();
      doc.modified = true;
      return true;
    },

    addEntity(doc, ent) {
      if (!ent.id) ent.id = uid();
      if (!ent.layerId) ent.layerId = doc.currentLayerId;
      if (!ent.color) ent.color = 'ByLayer';
      doc.entities.push(ent);
      /* phase 4 (the drawing hang): membership grew by exactly this one —
         patch the id index instead of letting the next entityById rebuild
         a quarter-million-entry map on the pointer path */
      if (idIndex && idIndexArr === doc.entities) {
        idIndex.set(ent.id, ent);
        idIndexLen = doc.entities.length;
        idIndexEnds = doc.entities[0].id + ' ' + ent.id;
      }
      /* an add appends: every other position stands (COPY's Array option
         adds twenty times and asks for the selection between each) */
      if (posIndex && posArr === doc.entities) {
        posIndex.set(ent.id, doc.entities.length - 1);
        posLen = doc.entities.length;
        posEnds = doc.entities[0].id + ' ' + ent.id;
      }
      if (membPend && membPend.doc === doc) membPend.log.push({ a: ent.id });
      doc.modified = true;
      return ent;
    },

    deleteEntities(doc, idSet) {
      const s = idSet instanceof Set ? idSet : new Set(idSet);
      const before = doc.entities.length;
      const wasIndexed = idIndex && idIndexArr === doc.entities;
      if (membPend && membPend.doc === doc) {
        const recs = [];
        for (let i = 0; i < doc.entities.length; i++) {
          const e = doc.entities[i];
          if (s.has(e.id)) recs.push({ i, json: JSON.stringify(e) });
        }
        if (recs.length) membPend.log.push({ d: recs });
      }
      doc.entities = doc.entities.filter(e => !s.has(e.id));
      if (doc.entities.length !== before) doc.modified = true;
      /* same patch for erase: drop the ids, follow the replaced array */
      if (wasIndexed) {
        for (const id of s) idIndex.delete(id);
        idIndexArr = doc.entities;
        idIndexLen = doc.entities.length;
        idIndexEnds = doc.entities.length
          ? doc.entities[0].id + ' ' + doc.entities[doc.entities.length - 1].id : '';
      }
      /* erased members leave their groups; a group with nobody left goes too */
      if (Array.isArray(doc.groups) && doc.groups.length) {
        for (const g of doc.groups) g.ids = g.ids.filter(id => !s.has(id));
        doc.groups = doc.groups.filter(g => g.ids.length);
      }
    },

    resolveColor(doc, ent) {
      /* ByBlock outside a block reference has no block to take a colour
         from: the industry standard draws it white. (Inside one, strokeEntity resolves
         it to the reference's colour before this is reached.) */
      if (ent.color === 'ByBlock') return '#ffffff';
      let col = (ent.color && ent.color !== 'ByLayer') ? ent.color : null;
      if (!col) {
        const m = layerById(doc);
        const ly = m && m.get(ent.layerId);
        col = (ly && ly.color) || '#ffffff';
      }
      /* SPEC3 Â§23: '@bg' resolves to the active background (model vs paper) */
      if (col === '@bg') {
        col = (typeof Nasj.activeBg === 'function') ? Nasj.activeBg() : '#212830';
      }
      return col;
    },

    /* SPEC3 Â§23: linetype resolves like color (ent.lt -> layer.lt -> continuous) */
    resolveLt(doc, ent) {
      if (ent.lt && ent.lt !== 'ByLayer') return canonLt(ent.lt, false) || 'continuous';
      const m = layerById(doc);
      const ly = m && m.get(ent.layerId);
      return (ly && canonLt(ly.lt, false)) || 'continuous';
    },

    /* SPEC3 Â§23: lineweight in mm (ent.lw -> layer.lw -> the Default).
       The Default is the industry standard's LWDEFAULT — Options â–¸ Lineweight
       Settings, 0.25 mm unless set — and it is what every entity and layer
       with no weight of its own plots at: a drawing whose lines all carry
       0.05 and whose dimensions sit on layer 0 prints the dimensions five
       times heavier until the Default is brought down to match. */
    resolveLw(doc, ent) {
      if (isNum(ent.lw)) return ent.lw;
      const m = layerById(doc);
      const ly = m && m.get(ent.layerId);
      if (ly && isNum(ly.lw)) return ly.lw;
      const d = parseFloat(Nasj.opt && Nasj.opt.lwDefault);
      return (isFinite(d) && d >= 0) ? d : 0.25;
    },

    serialize(doc) {
      /* the sheet whose list is currently swapped into doc.entities is saved
         from there — doc.layoutData still holds the array it started with */
      const live = doc.$space;
      const lay = {};
      for (const [n, L] of Object.entries(doc.layoutData || {})) {
        const ents = (live && live.L === L) ? doc.entities : (L.entities || []);
        if (!ents.length && !(L.viewports || []).length) continue;
        lay[n] = { entities: ents, viewports: L.viewports || [] };
      }
      return JSON.stringify({
        app: 'pixelbay CAD',
        version: 1,
        name: doc.name,
        chatDrawingId: doc.chatDrawingId,
        layers: doc.layers,
        currentLayerId: doc.currentLayerId,
        entities: doc.entities,
        blocks: doc.blocks || {},
        views: doc.views || [],
        /* the layout tabs are the drawing's own, so they travel with it */
        layouts: doc.layouts || undefined,
        layoutData: Object.keys(lay).length ? lay : undefined,
        groups: (doc.groups && doc.groups.length) ? doc.groups : undefined,
        view: doc.view,
        /* plot dialog "Save changes to layout" / "Apply to Layout" land here;
           without this line they died with the session */
        plotSettings: doc.plotSettings || undefined,
        /* the LIMITS rectangle (and its ON/OFF) belongs to the drawing */
        limits: doc.limits || undefined,
        /* the status bar annotation scale belongs to the drawing */
        annoScale: doc.annoScale || undefined,
        /* named layer states (the Layers slide-out list) travel with the file */
        layerStates: doc.layerStates || undefined,
        /* the annotation style tables are the drawing's own */
        styles: doc.styles || undefined,
        /* attached image bitmaps (IMAGEATTACH) — kept OUTSIDE the entities so
           the undo snapshots never copy them; they travel with the file */
        images: (doc.images && Object.keys(doc.images).length) ? doc.images : undefined,
        /* the Materials Browser's document materials, and the current visual
           style — both the drawing's own */
        materials: (doc.materials && doc.materials.length) ? doc.materials : undefined,
        vstyle: doc.vstyle || undefined,
        /* the sun and the place on the globe it is computed for — both the
           drawing's own, the way the industry standard keeps them in the file */
        sun: doc.sun || undefined,
        geo: doc.geo || undefined,
        /* Activity Insights: the drawing's own history travels with it */
        activity: (doc.activity && doc.activity.length) ? doc.activity : undefined,
        /* MKLTYPE's linetypes are the drawing's own */
        ltypes: (doc.ltypes && Object.keys(doc.ltypes).length) ? doc.ltypes : undefined
      });
    },

    deserialize(json, name) {
      const d = JSON.parse(json);
      const doc = Nasj.createDoc(name || d.name || 'Drawing');
      if(typeof d.chatDrawingId==='string' && /^[\w-]{1,100}$/.test(d.chatDrawingId))doc.chatDrawingId=d.chatDrawingId;
      if (Array.isArray(d.layers)) {
        const lys = d.layers
          .filter(l => l && typeof l === 'object' && l.id != null)
          .map(l => {
            const o = {
              id: String(l.id),
              name: l.name != null ? String(l.name) : String(l.id),
              color: typeof l.color === 'string' ? l.color : '#ffffff',
              on: l.on !== false, frozen: !!l.frozen, locked: !!l.locked
            };
            /* optional lt/lw (SPEC3 Â§23) — kept only when valid */
            const lt = canonLt(l.lt, false);
            if (lt) o.lt = lt;
            if (isNum(l.lw)) o.lw = clampLw(l.lw);
            return o;
          });
        if (lys.length) doc.layers = lys;
      }
      doc.currentLayerId =
        (d.currentLayerId && doc.layers.some(l => l.id === d.currentLayerId))
          ? d.currentLayerId : doc.layers[0].id;
      /* attached image bitmaps: data URLs only — nothing else executes */
      doc.images = {};
      if (d.images && typeof d.images === 'object') {
        for (const [k, v] of Object.entries(d.images)) {
          if (typeof v === 'string' && /^data:image\//.test(v)) doc.images[k] = v;
        }
      }
      /* document materials: objects with a name; any texture must be a data
         URL, the same rule the image registry lives by */
      if (Array.isArray(d.materials)) {
        const okImg = (v) => (v && typeof v === 'object' &&
          typeof v.src === 'string' && /^data:image\//.test(v.src)) ? v : null;
        doc.materials = d.materials
          .filter((m) => m && typeof m === 'object' && typeof m.name === 'string' && m.name)
          .map((m) => Object.assign({}, m, {
            image: okImg(m.image),
            cutouts: m.cutouts ? Object.assign({}, m.cutouts, { image: okImg(m.cutouts.image) }) : m.cutouts,
            bump: m.bump ? Object.assign({}, m.bump, { image: okImg(m.bump.image) }) : m.bump
          }));
      }
      if (typeof d.vstyle === 'string' && d.vstyle) doc.vstyle = d.vstyle;
      /* The sun and the geographic location: numbers stay numbers and are held
         to their ranges, strings stay strings, and anything else is dropped —
         the Sun Angle Calculator divides by these, so a bad longitude out of a
         hand-edited file must not reach it. */
      if (d.sun && typeof d.sun === 'object') {
        const s = d.sun;
        const nm = (v, lo, hi, dflt) => (isNum(v) ? Math.max(lo, Math.min(hi, v)) : dflt);
        const rgb = (v, dflt) => (typeof v === 'string' &&
          /^\d{1,3},\d{1,3},\d{1,3}$/.test(v) &&
          v.split(',').every((n) => +n <= 255)) ? v : dflt;
        doc.sun = {
          status: !!s.status, shadows: s.shadows !== false,
          int: nm(s.int, 0, 100, 1),
          color: rgb(s.color, '180,168,133'),
          sky: ['Sky Off', 'Sky Background', 'Sky Background and Illumination']
            .includes(s.sky) ? s.sky : 'Sky Off',
          skyInt: nm(s.skyInt, 0, 25, 1),
          haze: nm(s.haze, 0, 15, 0),
          horizHeight: nm(s.horizHeight, -10, 10, 0),
          horizBlur: nm(s.horizBlur, 0, 10, 0.1),
          ground: rgb(s.ground, '128,128,128'),
          diskScale: nm(s.diskScale, 0, 25, 4),
          glowInt: nm(s.glowInt, 0, 25, 1),
          diskInt: nm(s.diskInt, 0, 25, 1),
          date: /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : '2026-09-21',
          time: /^\d{1,2}:\d{2}$/.test(s.time) ? s.time : '15:00',
          dst: !!s.dst
        };
      }
      if (d.geo && typeof d.geo === 'object') {
        const g = d.geo;
        const nm = (v, lo, hi, dflt) => (isNum(v) ? Math.max(lo, Math.min(hi, v)) : dflt);
        doc.geo = {
          city: typeof g.city === 'string' ? g.city : 'Current',
          tz: nm(g.tz, -12, 14, -8),
          tzLabel: typeof g.tzLabel === 'string' ? g.tzLabel
            : '(GMT-08:00) Pacific Time (US & Canada); Tijuana',
          lat: nm(g.lat, 0, 90, 0),
          latDir: g.latDir === 'South' ? 'South' : 'North',
          lon: nm(g.lon, 0, 180, 0),
          lonDir: g.lonDir === 'West' ? 'West' : 'East',
          north: nm(g.north, 0, 360, 0)
        };
      }
      /* the activity feed: kind + timestamp (+ optional detail), nothing else */
      if (Array.isArray(d.activity)) {
        doc.activity = d.activity
          .filter((a) => a && typeof a.k === 'string' && isNum(a.t))
          .map((a) => (a.d != null ? { k: a.k, t: a.t, d: String(a.d) } : { k: a.k, t: a.t }));
      }
      /* custom linetypes: a name and its dash pattern — each rejoins the
         session roster and the engine's dash table as it is read back */
      if (d.ltypes && typeof d.ltypes === 'object') {
        doc.ltypes = {};
        for (const [nm, def] of Object.entries(d.ltypes)) {
          if (!/^[a-z0-9_-]+$/i.test(nm) || !def || !Array.isArray(def.dash)) continue;
          const dash = def.dash.map(Number).filter((v) => isNum(v) && v > 0);
          if (dash.length < 2) continue;
          const key = nm.toLowerCase();
          doc.ltypes[key] = { dash, desc: def.desc != null ? String(def.desc) : '' };
          if (LT_NAMES.indexOf(key) < 0) LT_NAMES.push(key);
          if (typeof Nasj.registerLinetype === 'function') Nasj.registerLinetype(key, dash);
        }
      }
      const raw = Array.isArray(d.entities) ? d.entities : [];
      doc.entities = raw.map(repairEntity).filter(Boolean);
      // Repair affected files previously saved as NJC after a DWG reopen.
      Nasj.dxf?.restoreAiSelections?.(doc.entities, doc.layers);
      const dropped = raw.length - doc.entities.length;
      if (dropped > 0) console.warn('deserialize: dropped ' + dropped + ' invalid entit' + (dropped === 1 ? 'y' : 'ies'));
      /* block definitions (SPEC2 Â§15) — validate like entities, no nested inserts */
      doc.blocks = {};
      if (d.blocks && typeof d.blocks === 'object') {
        for (const [nm, def] of Object.entries(d.blocks)) {
          if (!def || typeof def !== 'object') continue;
          const ents = (Array.isArray(def.entities) ? def.entities : [])
            .map(repairEntity).filter(e => e && e.type !== 'insert');
          const b = { base: isPt(def.base) ? def.base : { x: 0, y: 0 }, entities: ents };
          /* an external reference remembers the file it was read from, so the
             drawing can go looking for it again the next time it is opened */
          const xr = repairXref(def.xref);
          if (xr) b.xref = xr;
          doc.blocks[nm] = b;
        }
      }
      /* named views (SPEC3 Â§23) — validate each entry */
      doc.views = [];
      if (Array.isArray(d.views)) {
        for (const v of d.views) {
          if (!v || typeof v !== 'object' || v.name == null) continue;
          if (!(isNum(v.scale) && v.scale > 0)) continue;
          doc.views.push({
            name: String(v.name),
            scale: v.scale,
            tx: isNum(v.tx) ? v.tx : 0,
            ty: isNum(v.ty) ? v.ty : 0
          });
        }
      }
      /* groups — names kept unique, members filtered to entities that exist */
      doc.groups = [];
      if (Array.isArray(d.groups)) {
        const have = new Set(doc.entities.map(e => e.id));
        const seen = new Set();
        for (const g of d.groups) {
          if (!g || typeof g !== 'object' || g.name == null) continue;
          const name = String(g.name).trim();
          if (!name || seen.has(name.toUpperCase())) continue;
          const ids = (Array.isArray(g.ids) ? g.ids : []).map(String).filter(id => have.has(id));
          if (!ids.length) continue;
          seen.add(name.toUpperCase());
          doc.groups.push({
            name,
            desc: g.desc != null ? String(g.desc) : '',
            selectable: g.selectable !== false,
            ids
          });
        }
      }
      /* layout tabs — named, unique, and at least one, or the defaults stand */
      if (Array.isArray(d.layouts)) {
        const seen = new Set();
        const lays = [];
        for (const n of d.layouts) {
          const s = (n == null) ? '' : String(n).trim();
          if (!s || s.toLowerCase() === 'model' || seen.has(s)) continue;
          seen.add(s);
          lays.push(s);
        }
        if (lays.length) doc.layouts = lays;
      }
      /* each sheet's own entities and viewports, validated like model space */
      doc.layoutData = {};
      if (d.layoutData && typeof d.layoutData === 'object') {
        for (const [n, L] of Object.entries(d.layoutData)) {
          if (!L || typeof L !== 'object') continue;
          const rec = Nasj.docOps.layoutData(doc, String(n));
          if (Array.isArray(L.entities)) {
            rec.entities = L.entities.map(repairEntity).filter(Boolean);
          }
          if (Array.isArray(L.viewports)) {
            rec.viewports = L.viewports.map(repairViewport).filter(Boolean);
          }
        }
      }
      if (d.plotSettings && typeof d.plotSettings === 'object') {
        doc.plotSettings = JSON.parse(JSON.stringify(d.plotSettings));
      }
      if (d.limits && typeof d.limits === 'object' &&
          d.limits.min && isFinite(d.limits.min.x) && isFinite(d.limits.min.y) &&
          d.limits.max && isFinite(d.limits.max.x) && isFinite(d.limits.max.y)) {
        doc.limits = {
          min: { x: +d.limits.min.x, y: +d.limits.min.y },
          max: { x: +d.limits.max.x, y: +d.limits.max.y },
          on: !!d.limits.on
        };
      }
      if (d.annoScale && typeof d.annoScale === 'object' && d.annoScale.f > 0) {
        doc.annoScale = { label: String(d.annoScale.label || '1:1'), f: d.annoScale.f };
      }
      if (d.layerStates && typeof d.layerStates === 'object') {
        doc.layerStates = JSON.parse(JSON.stringify(d.layerStates));
      }
      doc.styles = repairStyles(d.styles);
      if (d.view && isFinite(d.view.scale) && d.view.scale > 0) {
        doc.view = { scale: d.view.scale, tx: d.view.tx || 0, ty: d.view.ty || 0 };
        /* optional 3D view state (3D foundation) — kept only when coherent */
        if (isNum(d.view.azimuth) && isNum(d.view.elevation)) {
          doc.view.azimuth = d.view.azimuth;
          doc.view.elevation = d.view.elevation;
          if (isNum(d.view.distance) && d.view.distance > 0) doc.view.distance = d.view.distance;
          if (isNum(d.view.targetZ)) doc.view.targetZ = d.view.targetZ;
        }
      }
      return doc;
    },

    /* register an attached image's bitmap on the DRAWING, not the entity:
       snapshot() copies doc.entities into every undo step, and a photograph
       must not be duplicated a hundred times. The registry is never
       snapshotted, so an undone attachment keeps its bytes for the redo. */
    addImage(doc, src) {
      if (!doc.images || typeof doc.images !== 'object') doc.images = {};
      for (const [k, v] of Object.entries(doc.images)) if (v === src) return k;
      const id = uid('I');
      doc.images[id] = src;
      doc.modified = true;
      return id;
    },

    addLayer(doc, name) {
      const base = name || ('Layer' + doc.layers.length);
      let nm = base, i = 1;
      while (doc.layers.some(l => l.name === nm)) nm = base + ' (' + (i++) + ')';
      const layer = { id: uid('L'), name: nm, color: '#ffffff', on: true, frozen: false, locked: false };
      doc.layers.push(layer);
      doc.modified = true;
      return layer;
    },

    /* CENTERLAYER / MARKUPLAYER / TEXTLAYER (the Annotate slide-outs): the
       layer those commands draw on whatever layer is current. "." is "Use
       Current" — the drawing's current layer. A named layer the drawing has
       since lost is made again, which is what the industry standard does rather than
       dropping the geometry onto some other layer where the user will not
       think to look for it. */
    layerIdFor(doc, key) {
      const nm = Nasj.settings && Nasj.settings[key];
      if (!nm || nm === '.') return doc.currentLayerId;
      const found = doc.layers.find((l) => l.name === nm);
      return found ? found.id : this.addLayer(doc, nm).id;
    },

    /* GL-PLAN phase 4: the open front-load pre-builds the block-table
       undo string behind the progress bar, so the FIRST commit doesn't
       pay the one-time stringify of the whole library (1.3s, measured) */
    warmSnapshot(doc) { blocksJson(doc); },
    /* the same warm behind the open's progress bar, one slice per call —
       nothing there may hold the thread for longer than a frame */
    warmSnapshotStep(doc, budget) {
      return blocksJsonStep(doc, performance.now() + Math.max(2, budget || 6));
    },

    /* phase 4: a membership-only command about to mutate a LIVE entity in
       place (PLINE growing its one polyline vertex by vertex) announces it
       HERE, before writing. The armed undo entry records the pre-image so
       undo restores it exactly; the engine and GL wraps on this op re-home
       the spatial index and hint the scene. Costs one small stringify. */
    captureEntity(doc, ent) {
      if (!ent || ent.id == null) return;
      warmDrop();                        /* an in-place mutation follows */
      if (membPend && membPend.doc === doc) {
        membPend.log.push({ m: { id: ent.id, pre: JSON.stringify(ent), post: null } });
      }
    },

    entityById(doc, id) {
      /* O(1) VIA AN ID INDEX. This was a linear find — and selecting 12 000
         entities refreshed the properties palette with 12 000 finds over
         30 000 entities: 360 million comparisons, 400ms of hang, on every
         selection change. The index rebuilds when the entities ARRAY is
         replaced (delete/undo/redo) or its length moves (add); in-place
         edits never change membership, so they never invalidate it. */
      /* The ends guard catches what the length cannot: truncate the array in
         place and refill it to the SAME length (the QA harnesses' wipe-and-
         rebuild does exactly this) and the membership is new while the length
         is not. Ids are fresh on every add, so membership cannot change while
         the array, its length, and its first and last ids all stand. */
      const arr = doc.entities;
      const ends = arr.length ? arr[0].id + ' ' + arr[arr.length - 1].id : '';
      if (idIndexArr !== arr || idIndexLen !== arr.length || idIndexEnds !== ends) {
        idIndex = new Map();
        for (const e of arr) idIndex.set(e.id, e);
        idIndexArr = arr;
        idIndexLen = arr.length;
        idIndexEnds = ends;
      }
      return idIndex.get(id) || null;
    },

    /* THE DRAW-ORDER POSITION of an id, or -1. The selection is a Set of
       ids, and the answer commands have always been given is the selection
       in DOCUMENT order — which used to come free because the walk WAS the
       document (doc.entities.filter(sel.has)). Walking the selection through
       the id index instead is the size of the selection rather than the size
       of the drawing, and this restores the order it lost, exactly.
       Same membership guard as entityById; a delete drops the map rather
       than shifting a quarter of a million numbers. */
    entityPos(doc, id) {
      const arr = doc.entities;
      const ends = arr.length ? arr[0].id + ' ' + arr[arr.length - 1].id : '';
      if (posArr !== arr || posLen !== arr.length || posEnds !== ends) {
        posIndex = new Map();
        for (let i = 0; i < arr.length; i++) posIndex.set(arr[i].id, i);
        posArr = arr;
        posLen = arr.length;
        posEnds = ends;
      }
      const p = posIndex.get(id);
      return p === undefined ? -1 : p;
    }
  };

  /* ---------------- geometry helpers ---------------- */
  const dist = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);
  const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  /* the same, carrying height — for the snap points of geometry that climbs */
  const mid3 = (p, q) => {
    const pz = isNum(p.z) ? p.z : 0, qz = isNum(q.z) ? q.z : 0;
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    if (pz || qz) m.z = (pz + qz) / 2;
    return m;
  };
  const add = (p, q) => ({ x: p.x + q.x, y: p.y + q.y });
  const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });
  const len = (v) => Math.hypot(v.x, v.y);
  const angle = (p, q) => Math.atan2(q.y - p.y, q.x - p.x);
  const polar = (p, ang, d) => ({ x: p.x + Math.cos(ang) * d, y: p.y + Math.sin(ang) * d });

  const rotatePoint = (p, center, ang) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    const dx = p.x - center.x, dy = p.y - center.y;
    return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
  };

  const scalePoint = (p, center, k) => ({
    x: center.x + (p.x - center.x) * k,
    y: center.y + (p.y - center.y) * k
  });

  const mirrorPoint = (p, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    if (L2 < EPS) return { x: 2 * a.x - p.x, y: 2 * a.y - p.y };
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
    const fx = a.x + t * dx, fy = a.y + t * dy;
    return { x: 2 * fx - p.x, y: 2 * fy - p.y };
  };

  const closestPointOnSeg = (p, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    if (L2 < EPS) return { x: a.x, y: a.y };
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    return { x: a.x + t * dx, y: a.y + t * dy };
  };

  const distToSeg = (p, a, b) => dist(p, closestPointOnSeg(p, a, b));

  /* angles: normalize into [0, TAU) */
  const norm2pi = (a) => {
    a %= TAU;
    if (a < 0) a += TAU;
    return a;
  };

  /* CCW sweep from a0 to a1.
     A whole turn is SPELLED OUT — a0 to a0 Â± 2Ï€, the form a full sweep
     arrives in — while two equal angles are a zero-length arc, the
     leftover of an arc fit. Reading the second as the first drew a whole
     circle where the file draws nothing, and bounded, snapped, picked and
     gripped that circle too: the industry standard's 2027 release keeps such an ARC (50 = 51 to
     the bit) and shows no circle anywhere. */
  const arcSweep = (a0, a1) => {
    const raw = a1 - a0;
    if (Math.abs(raw) >= TAU - EPS) return TAU;
    if (Math.abs(raw) < EPS) return 0;
    return norm2pi(raw);
  };

  const angleInArc = (t, a0, a1) => norm2pi(t - a0) <= arcSweep(a0, a1) + 1e-7;

  const arcPoint = (ent, t) => ({
    x: ent.c.x + ent.r * Math.cos(t),
    y: ent.c.y + ent.r * Math.sin(t)
  });

  /* The radial band an ArcAlignedText's letters occupy: from its baseline
     radius out to the letter tops, across the arc's sweep. Bounds, hit and
     window tests all read this ring, so the text is picked where it is SEEN. */
  const arctextRadii = (e) => {
    const off = e.offArc || 0;
    /* the baseline sits on the chosen SIDE of the arc; the letters extend
       from it toward their ORIENT — the band must follow the letters, or
       two of the four combinations are picked where the text is not */
    const base = Math.max(1e-6, e.side === 'concave' ? e.r - off : e.r + off);
    const band = e.h * 1.15;
    let ri, ro;
    if (e.orient === 'in') { ro = base; ri = Math.max(1e-6, base - band); }
    else { ri = base; ro = base + band; }
    if (ro - ri < 1e-6) ro = ri + 1e-6;
    return { ri, ro };
  };
  const arctextRing = (e) => {
    const { ri, ro } = arctextRadii(e);
    const sweep = arcSweep(e.a0, e.a1);
    const n = Math.max(8, Math.ceil(sweep / 0.2));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = e.a0 + sweep * i / n;
      pts.push({ x: e.c.x + ri * Math.cos(t), y: e.c.y + ri * Math.sin(t) });
    }
    for (let i = n; i >= 0; i--) {
      const t = e.a0 + sweep * i / n;
      pts.push({ x: e.c.x + ro * Math.cos(t), y: e.c.y + ro * Math.sin(t) });
    }
    return pts;
  };

  const ellipsePoint = (ent, t) => {
    const rot = ent.rot || 0;
    const co = Math.cos(rot), si = Math.sin(rot);
    const ex = ent.rx * Math.cos(t), ey = ent.ry * Math.sin(t);
    return { x: ent.c.x + ex * co - ey * si, y: ent.c.y + ex * si + ey * co };
  };

  const textWidth = (ent) => {
    /* multiline (MTEXT) measures its longest line */
    const s = ent.str ? String(ent.str) : '';
    const n = s.indexOf('\n') >= 0
      ? s.split('\n').reduce((k, l) => Math.max(k, l.length), 0)
      : s.length;
    const wf = (isNum(ent.wf) && ent.wf > 0) ? ent.wf : 1;
    /* CAD text — what an import made, and what carries no style at all —
       draws at the industry standard's cap height: 0.67 Ã— that height per character, which
       is what the industry standard's own textbox measures for a mixed-case Latin line.
       The mark, not the absence of a style name: imported text now carries
       the style it was drawn with (see engine.js drawText). */
    const per = (ent.cad === true || !ent.style) ? 0.67 : 0.62;
    return Math.max(ent.h * per * n * wf, ent.h * 0.3);
  };

  /* MTEXT line spacing: 1.6 Ã— the text height, the industry standard's single-ish spacing */
  const MTEXT_LINE = 1.6;

  /* anchor + local (unrotated) box offset for a text entity. Justified text
     (ha/va set) anchors at p2 when present, else p; native text keeps the
     baseline-left box at p exactly as before. */
  const textLayout = (ent) => {
    const w = textWidth(ent), h = ent.h;
    /* MTEXT (ent.mt): anchor is the TOP-left corner, the box grows down;
       imported attachment (ha/va present) moves the anchor to the corner
       or edge it names — absent fields keep the top-left box exactly */
    if (ent.mt) {
      const lines = String(ent.str == null ? '' : ent.str).split('\n').length;
      const totalH = h + (lines - 1) * h * MTEXT_LINE;
      const ha = isNum(ent.ha) ? ent.ha : 0;
      const va = isNum(ent.va) ? ent.va : 3;
      const dx = (ha === 1 || ha === 4) ? -w / 2 : (ha === 2 ? -w : 0);
      const dy = va === 2 ? -totalH / 2 : (va === 1 ? 0 : -totalH);
      return { anchor: ent.p, dx, dy, w, h: totalH };
    }
    const ha = isNum(ent.ha) ? ent.ha : 0;
    const va = isNum(ent.va) ? ent.va : 0;
    const anchor = ((ha || va) && isPt(ent.p2)) ? ent.p2 : ent.p;
    const dx = (ha === 1 || ha === 4) ? -w / 2 : (ha === 2 ? -w : 0);
    const dy = (ha === 4 || va === 2) ? -h / 2 : (va === 3 ? -h : 0);
    return { anchor, dx, dy, w, h };
  };

  /* corners of an image attachment: lower-left p, then round the frame.
     fy = -1 runs the height the other way — a mirrored image. */
  const imageCorners = (ent) => {
    const rot = ent.rot || 0;
    const fy = ent.fy === -1 ? -1 : 1;
    const u = { x: Math.cos(rot), y: Math.sin(rot) };
    const v = { x: -u.y * fy, y: u.x * fy };
    const p = ent.p, w = ent.w, h = ent.h;
    return [
      { x: p.x, y: p.y },
      { x: p.x + u.x * w, y: p.y + u.y * w },
      { x: p.x + u.x * w + v.x * h, y: p.y + u.y * w + v.y * h },
      { x: p.x + v.x * h, y: p.y + v.y * h },
    ];
  };

  /* corners of the text box (justification-aware, world y up, rotated) */
  const textCorners = (ent) => {
    const L = textLayout(ent), rot = ent.rot || 0;
    const raw = [
      { x: L.dx, y: L.dy }, { x: L.dx + L.w, y: L.dy },
      { x: L.dx + L.w, y: L.dy + L.h }, { x: L.dx, y: L.dy + L.h }
    ];
    return raw.map(q =>
      rotatePoint({ x: L.anchor.x + q.x, y: L.anchor.y + q.y }, L.anchor, rot));
  };

  const SAMPLES = 48;
  const MAX_SAMPLES = 512;

  /* adaptive ellipse sample count: keeps chord sagitta <= tol (SAMPLES..MAX_SAMPLES) */
  /* how much of its parametric turn a swept ellipse covers (a full one: TAU) */
  const ellipseSweep = (ent) => {
    if (!isNum(ent.a0) || !isNum(ent.a1)) return TAU;
    const s = norm2pi(ent.a1 - ent.a0);
    return s < 1e-12 ? TAU : s;
  };
  const ellipseIsArc = (ent) => isNum(ent.a0) && isNum(ent.a1);
  const ellipseSamples = (ent, tol) => {
    const rmax = Math.max(ent.rx, ent.ry);
    if (!(tol > 0) || tol >= rmax) return SAMPLES;
    const n = Math.ceil(Math.PI / Math.acos(1 - tol / rmax));
    return Math.min(MAX_SAMPLES, Math.max(SAMPLES, n));
  };

  /* ================= v2 entity helpers (SPEC2 Â§15) ================= */
  const normalize = (v) => {
    const L = Math.hypot(v.x, v.y);
    return L < EPS ? { x: 1, y: 0 } : { x: v.x / L, y: v.y / L };
  };

  /* ---- polyline bulge arcs (DXF convention: b = tan(theta/4), theta =
     signed included angle, positive = CCW from segment start to end) ---- */
  /* Below this a bulge is arc-fit junk, not curvature. |b| is the sagitta
     over half the chord, so 1e-8 bows the segment 5e-9 of its own length —
     a radius a hundred million chords away, which the industry standard draws as the
     chord and which no zoom this side of 1e9 could tell from one. The
     guard belongs HERE, in the kernel: bounds, hatch fills, snaps, prims,
     hit tests, the spatial index and ZOOM EXTENTS all read this, and a
     sampled arc of radius 1e13 put every one of them in another county. */
  const BULGE_EPS = 1e-8;

  const bulgeArc = (p1, p2, b) => {
    if (!isNum(b) || Math.abs(b) < BULGE_EPS) return null;
    const chord = dist(p1, p2);
    if (chord < EPS) return null;
    const theta = 4 * Math.atan(b);
    const r = Math.abs(chord / (2 * Math.sin(theta / 2)));
    /* signed distance chord-midpoint -> center along the LEFT normal of p1->p2 */
    const h = (chord / 2) / Math.tan(theta / 2);
    const ux = (p2.x - p1.x) / chord, uy = (p2.y - p1.y) / chord;
    const c = { x: (p1.x + p2.x) / 2 - uy * h, y: (p1.y + p2.y) / 2 + ux * h };
    const a0 = Math.atan2(p1.y - c.y, p1.x - c.x);
    /* arc point at t in [0,1]: c + r*(cos,sin)(a0 + theta*t) */
    return { c, r, a0, theta };
  };

  const bulgeArcPoint = (A, t) => ({
    x: A.c.x + A.r * Math.cos(A.a0 + A.theta * t),
    y: A.c.y + A.r * Math.sin(A.a0 + A.theta * t)
  });

  const segHasBulge = (p) => p && isNum(p.b) && Math.abs(p.b) >= BULGE_EPS;

  const polylineHasBulge = (ent) =>
    Array.isArray(ent.pts) && ent.pts.some(segHasBulge);

  const BULGE_SAMPLES = 24; /* samples per bulge arc segment */

  /* polyline vertices with bulge segments expanded into sampled arc points */
  const polylinePoints = (ent) => {
    const pts = ent.pts || [];
    const closed = !!ent.closed;
    if (pts.length < 2 || !polylineHasBulge(ent)) {
      return { pts: pts.slice(), closed };
    }
    const n = pts.length;
    const segs = closed ? n : n - 1;
    const out = [];
    for (let i = 0; i < segs; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % n];
      out.push({ x: p1.x, y: p1.y });
      const A = segHasBulge(p1) ? bulgeArc(p1, p2, p1.b) : null;
      if (A) {
        for (let s = 1; s < BULGE_SAMPLES; s++) out.push(bulgeArcPoint(A, s / BULGE_SAMPLES));
      }
    }
    if (!closed) out.push({ x: pts[n - 1].x, y: pts[n - 1].y });
    return { pts: out, closed };
  };

  /* ---- 3D foundation helpers (face3d / box) ---- */
  const zOf = (p) => (p && isNum(p.z)) ? p.z : 0;

  /* base (z = p.z) rectangle ring of a box, xy only */
  const boxBase = (ent) => {
    const x = ent.p.x, y = ent.p.y;
    return [
      { x, y }, { x: x + ent.w, y },
      { x: x + ent.w, y: y + ent.d }, { x, y: y + ent.d }
    ];
  };

  /* all 8 corners with z: 4 bottom (indices 0-3) then 4 top (4-7) */
  const boxCorners = (ent) => {
    const z0 = zOf(ent.p), z1 = z0 + ent.h;
    const b = boxBase(ent);
    return b.map(q => ({ x: q.x, y: q.y, z: z0 }))
      .concat(b.map(q => ({ x: q.x, y: q.y, z: z1 })));
  };

  /* hatch boundary as a plain outline entity (polyline/circle/ellipse) */
  const hatchBoundary = (ent) => {
    const b = ent.boundary || {};
    switch (b.kind) {
      case 'pline': return { type: 'polyline', pts: b.pts || [], closed: true };
      case 'circle': return { type: 'circle', c: b.c, r: b.r };
      case 'ellipse': return { type: 'ellipse', c: b.c, rx: b.rx, ry: b.ry, rot: b.rot || 0 };
      default: return { type: 'polyline', pts: [], closed: true };
    }
  };

  const pointInLoop = (pts, p) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], c = pts[j];
      if ((a.y > p.y) !== (c.y > p.y) &&
          p.x < (c.x - a.x) * (p.y - a.y) / (c.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };

  const pointInBoundary = (ent, p) => {
    const b = ent.boundary || {};
    let inside;
    if (b.kind === 'circle') inside = dist(p, b.c) <= b.r;
    else if (b.kind === 'ellipse') {
      const q = rotatePoint(p, b.c, -(b.rot || 0));
      const dx = (q.x - b.c.x) / b.rx, dy = (q.y - b.c.y) / b.ry;
      inside = dx * dx + dy * dy <= 1;
    } else inside = pointInLoop(b.pts || [], p);
    if (!inside || !Array.isArray(ent.islands)) return inside;
    /* islands are rendered as holes, so they are holes to the pick too */
    for (const loop of ent.islands) {
      if (Array.isArray(loop) && loop.length >= 3 && pointInLoop(loop, p)) return false;
    }
    return true;
  };

  /* Catmull-Rom sampling through spline fit points (>=16 samples per segment) */
  const SPLINE_PER_SEG = 16;

  const crPoint = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return {
      x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
    };
  };

  const splinePoints = (ent, perSeg = SPLINE_PER_SEG) => {
    const pts = ent.pts || [];
    const n = pts.length;
    const closed = !!ent.closed;
    if (n < 2) return { pts: pts.slice(), closed: false };
    if (ent.cv && n >= 3) {          /* CV spline: sample its Bézier spans */
      const bz = splineBeziers(ent);
      const out = [];
      const bp = (s, t) => {
        const u = 1 - t;
        return {
          x: u * u * u * s.a.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.b.x,
          y: u * u * u * s.a.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.b.y,
        };
      };
      for (const s of bz) for (let k = 0; k < perSeg; k++) out.push(bp(s, k / perSeg));
      if (bz.length && !closed) out.push({ x: bz[bz.length - 1].b.x, y: bz[bz.length - 1].b.y });
      return { pts: out, closed };
    }
    const at = (i) => closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
    const out = [];
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (let s = 0; s < perSeg; s++) out.push(crPoint(p0, p1, p2, p3, s / perSeg));
    }
    if (!closed) out.push({ x: pts[n - 1].x, y: pts[n - 1].y });
    return { pts: out, closed };
  };

  /* Catmull-Rom -> cubic Bézier control points (exact same curve; for canvas).
     A CV spline (ent.cv) is a clamped uniform cubic B-spline over the same
     points instead: the curve hangs off the control cage rather than passing
     through it, the industry standard's SPLINE Method=CV. */
  const splineBeziers = (ent) => {
    const pts = ent.pts || [];
    const n = pts.length;
    if (n < 2) return [];
    const closed = !!ent.closed;
    if (ent.cv && n >= 3) {
      const src = closed ? pts : [pts[0], pts[0], ...pts, pts[n - 1], pts[n - 1]];
      const m = src.length;
      const at2 = (i) => src[closed ? ((i % m) + m) % m : Math.max(0, Math.min(m - 1, i))];
      const out = [];
      const spans = closed ? n : m - 3;
      for (let i = 0; i < spans; i++) {
        const q0 = at2(i), q1 = at2(i + 1), q2 = at2(i + 2), q3 = at2(i + 3);
        out.push({
          a: { x: (q0.x + 4 * q1.x + q2.x) / 6, y: (q0.y + 4 * q1.y + q2.y) / 6 },
          c1: { x: (2 * q1.x + q2.x) / 3, y: (2 * q1.y + q2.y) / 3 },
          c2: { x: (q1.x + 2 * q2.x) / 3, y: (q1.y + 2 * q2.y) / 3 },
          b: { x: (q1.x + 4 * q2.x + q3.x) / 6, y: (q1.y + 4 * q2.y + q3.y) / 6 },
        });
      }
      return out;
    }
    const at = (i) => closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
    const out = [];
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      out.push({
        a: p1,
        c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
        c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
        b: p2
      });
    }
    return out;
  };

  /* ---- dim/leader/table decomposition (shared by render/hit/bounds/explode).
     Shape: { segs:[[a,b]..], arcs:[{c,r,a0,a1}..], arrows:[[t1,t2,t3]..],
              texts:[{p,str,h,ang,anchor:'left'|'center',knockout}..],
              fills:[{pts:[..], alpha}..] } ---- */
  const annoText = (p, str, h, ang, anchor, knockout) => ({
    p, str: String(str == null ? '' : str), h,
    ang: ang || 0, anchor: anchor || 'left', knockout: !!knockout
  });

  const annoTextWidth = (t) =>
    Math.max(t.h * 0.62 * String(t.str).length, t.h * 0.3);

  const annoTextCorners = (t) => {
    const w = annoTextWidth(t), h = t.h;
    const raw = (t.anchor === 'center')
      ? [{ x: -w / 2, y: -h * 0.65 }, { x: w / 2, y: -h * 0.65 },
         { x: w / 2, y: h * 0.65 }, { x: -w / 2, y: h * 0.65 }]
      : [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    return raw.map(q => rotatePoint({ x: t.p.x + q.x, y: t.p.y + q.y }, t.p, t.ang || 0));
  };

  /* text-entity insertion point (baseline-left) equivalent to an anno text */
  const annoTextOrigin = (t) => {
    if (t.anchor !== 'center') return { x: t.p.x, y: t.p.y };
    const w = annoTextWidth(t);
    const off = rotatePoint({ x: w / 2, y: t.h / 2 }, { x: 0, y: 0 }, t.ang || 0);
    return { x: t.p.x - off.x, y: t.p.y - off.y };
  };

  const pointInTextBox = (t, p, tol) => {
    const q = rotatePoint(p, t.p, -(t.ang || 0));
    const w = annoTextWidth(t);
    if (t.anchor === 'center') {
      return Math.abs(q.x - t.p.x) <= w / 2 + tol && Math.abs(q.y - t.p.y) <= t.h * 0.65 + tol;
    }
    const dx = q.x - t.p.x, dy = q.y - t.p.y;
    return dx >= -tol && dx <= w + tol && dy >= -tol && dy <= t.h + tol;
  };

  /* filled triangle arrowhead: tip + unit direction tip->base + length */
  const arrowTri = (tip, dirTB, alen) => {
    const d = normalize(dirTB), w = alen * 0.35;
    const bx = tip.x + d.x * alen, by = tip.y + d.y * alen;
    return [
      { x: tip.x, y: tip.y },
      { x: bx - d.y * w, y: by + d.x * w },
      { x: bx + d.y * w, y: by - d.x * w }
    ];
  };

  /* Every arrowhead the Symbols and Arrows lists offer (the industry standard's DIMBLK
     set), one builder for dimensions and leaders alike. `seg` is the
     caller's stroke collector; filled shapes land in G.arrows and circles
     in G.arcs. `dirIn` points from the tip INTO the line. A 'User:<name>'
     head draws that block definition — tip at its base point, +X along the
     line, one drawing unit scaled to the arrow size — from the strokeable
     entities it holds (lines, polylines, circles, arcs). */
  const arrowHeadGeom = (G, seg, tip, dirIn, head, ALEN) => {
    const dir = normalize(dirIn);
    const px = -dir.y, py = dir.x;                    /* the perpendicular */
    const at = (a, b) => ({ x: tip.x + dir.x * a + px * b, y: tip.y + dir.y * a + py * b });
    const circle = (c, r, fill) => G.arcs.push({ c, r, a0: 0, a1: TAU, fill: !!fill });
    const openHead = (halfTan) => {
      const w = ALEN * halfTan;
      seg(tip, at(ALEN, w));
      seg(tip, at(ALEN, -w));
    };
    if (String(head).indexOf('User:') === 0) {
      const bdef = (Nasj.doc && Nasj.doc.blocks) ? Nasj.doc.blocks[String(head).slice(5)] : null;
      if (!bdef || !Array.isArray(bdef.entities)) return;
      const base = bdef.base || { x: 0, y: 0 };
      const rot = Math.atan2(dir.y, dir.x);
      const tp = (p) => at((p.x - base.x) * ALEN, (p.y - base.y) * ALEN);
      for (const e of bdef.entities) {
        if (!e) continue;
        if (e.type === 'line' && e.a && e.b) seg(tp(e.a), tp(e.b));
        else if ((e.type === 'polyline' || e.type === 'rectangle') && Array.isArray(e.pts)) {
          for (let i = 0; i + 1 < e.pts.length; i++) seg(tp(e.pts[i]), tp(e.pts[i + 1]));
          if (e.closed && e.pts.length > 2) seg(tp(e.pts[e.pts.length - 1]), tp(e.pts[0]));
        } else if (e.type === 'circle' && e.c) circle(tp(e.c), (e.r || 0) * ALEN, false);
        else if (e.type === 'arc' && e.c) {
          G.arcs.push({ c: tp(e.c), r: (e.r || 0) * ALEN, a0: e.a0 + rot, a1: e.a1 + rot, fill: false });
        }
      }
      return;
    }
    switch (head) {
      case 'Closed filled': G.arrows.push(arrowTri(tip, dir, ALEN)); return;
      case 'Closed blank': case 'Closed': {
        const t = arrowTri(tip, dir, ALEN);
        seg(t[0], t[1]); seg(t[0], t[2]); seg(t[1], t[2]);
        /* the industry standard's _Closed block carries its middle line; blank does not */
        if (head === 'Closed') seg(tip, at(ALEN, 0));
        return;
      }
      case 'Dot': circle(at(ALEN * 0.25, 0), ALEN * 0.25, true); return;
      case 'Dot blank': circle(at(ALEN * 0.25, 0), ALEN * 0.25, false); return;
      case 'Dot small': circle(tip, ALEN * 0.125, true); return;
      case 'Dot small blank': circle(tip, ALEN * 0.125, false); return;
      case 'Architectural tick': case 'Oblique': {
        const s = ALEN * 0.6 * Math.SQRT1_2;
        seg(at(-s, s), at(s, -s));
        return;
      }
      case 'Open': openHead(0.35); return;      /* the closed heads' flare */
      case 'Open 30': openHead(Math.tan(Math.PI / 12)); return;
      case 'Right angle': openHead(1); return;
      case 'Origin indicator': circle(at(ALEN * 0.5, 0), ALEN * 0.5, false); return;
      case 'Origin indicator 2':
        circle(at(ALEN * 0.5, 0), ALEN * 0.5, false);
        circle(at(ALEN * 0.5, 0), ALEN * 0.25, false);
        return;
      case 'Box': case 'Box filled': {
        const h = ALEN * 0.25;                /* a square centred on the point */
        const q = [at(-h, -h), at(-h, h), at(h, h), at(h, -h)];
        if (head === 'Box filled') G.arrows.push(q);
        else { seg(q[0], q[1]); seg(q[1], q[2]); seg(q[2], q[3]); seg(q[3], q[0]); }
        return;
      }
      case 'Datum triangle': case 'Datum triangle filled': {
        const w = ALEN * Math.tan(Math.PI / 6);   /* 60Â° at the tip (GD&T) */
        const t = [at(0, 0), at(ALEN, w), at(ALEN, -w)];
        if (head === 'Datum triangle filled') G.arrows.push(t);
        else { seg(t[0], t[1]); seg(t[1], t[2]); seg(t[2], t[0]); }
        return;
      }
      case 'Integral': {
        /* the âˆ« stroke: two shallow arcs meeting at the point */
        const rot = Math.atan2(dir.y, dir.x);
        const r = ALEN * 0.5, d = r * Math.SQRT1_2;
        G.arcs.push({ c: at(d, d), r, a0: rot + Math.PI * 1.25, a1: rot + Math.PI * 1.75, fill: false });
        G.arcs.push({ c: at(-d, -d), r, a0: rot + Math.PI * 0.25, a1: rot + Math.PI * 0.75, fill: false });
        return;
      }
      default: return;                            /* 'None' and the unknown */
    }
  };

  /* the style a dimension is drawn with — its own, else the current one */
  const dimStyleOf = (doc, ent) => {
    const t = doc && doc.styles && doc.styles.dim;
    if (!t || !Array.isArray(t.list) || !t.list.length) return styleDef('dim', null);
    const want = String((ent && ent.style) || t.current || '').trim().toUpperCase();
    return t.list.find((s) => s.name.toUpperCase() === want) ||
      t.list.find((s) => s.name.toUpperCase() === String(t.current || '').toUpperCase()) ||
      t.list[0];
  };

  /* stIn lets a preview draw with a style the drawing has not accepted yet */
  const dimGeometry = (ent, stIn) => {
    const st = stIn || dimStyleOf(Nasj.doc, ent);
    const h = (isNum(ent.h) && ent.h > 0) ? ent.h : 3;
    /* the style speaks in paper units; the dimension's height says how big
       one of those is here (a default style reproduces h/3 exactly) */
    /* the overall scale (DIMSCALE) multiplies every size the style states */
    const S = st.scale > 0 ? st.scale : 1;
    const k = (h / (st.txtH > 0 ? st.txtH : 3)) * S;
    const u = st.gap * k;                 /* text offset from the line */
    const GAP = st.exo * k, OVER = st.exe * k, ALEN = st.asz * k;
    const DLE = st.dle * k, FXL = st.fxl * k;
    const G = { segs: [], arcs: [], arrows: [], texts: [], fills: [] };
    /* every segment says which part of the dimension it is, so the renderer
       can give the dimension line and the extension lines their own colour,
       linetype and lineweight */
    const seg = (a, b, kind) =>
      G.segs.push([{ x: a.x, y: a.y }, { x: b.x, y: b.y }, kind || 'dim']);
    /* an extension line, unless the style suppresses that one; with fixed
       length it always runs the same distance back from the dimension line */
    const ext = (origin, at, which) => {
      if (which === 1 ? st.se1 : st.se2) return;
      const dv = sub(at, origin), L = len(dv);
      if (!(L > GAP + EPS)) return;
      const n = { x: dv.x / L, y: dv.y / L };
      let from = add(origin, { x: n.x * GAP, y: n.y * GAP });
      if (st.fxlon) {
        const back = Math.max(0, FXL - OVER);
        if (back < L - GAP) from = add(at, { x: -n.x * back, y: -n.y * back });
      }
      seg(from, add(at, { x: n.x * OVER, y: n.y * OVER }), 'ext');
    };
    /* the arrowhead the style asks for: a filled head, an open one drawn in
       two strokes, a slash for the tick marks, or nothing at all. `which`
       picks the end — the two can carry different heads. */
    const arrow = (tip, d, which) => {
      const head = which === 2 ? (st.arrow2 || st.arrow) : (which === 0 ? st.arrowLdr : st.arrow);
      if (head === 'None' || ALEN <= 0) return;
      arrowHeadGeom(G, (a, b) => seg(a, b, 'dim'), tip, d, head, ALEN);
    };
    /* the dimension line, in the two halves the industry standard can suppress apart */
    const dimLine = (a, b) => {
      const dv = sub(b, a), L = len(dv);
      const n = L > EPS ? { x: dv.x / L, y: dv.y / L } : { x: 1, y: 0 };
      /* the dimension line runs on past the extension lines by DIMDLE —
         the industry standard reserves it for tick heads, but the box is typed in here so
         whatever it says is drawn */
      const e = DLE;
      const a2 = add(a, { x: -n.x * e, y: -n.y * e });
      const b2 = add(b, { x: n.x * e, y: n.y * e });
      const m = mid(a, b);
      if (!st.sd1) seg(a2, m);
      if (!st.sd2) seg(m, b2);
    };
    /* a centre mark or centre lines at a circle's middle (DIMCEN) */
    const centreMark = (c, r) => {
      if (st.cen === 'None' || !(st.cenSize > 0)) return;
      const m = st.cenSize * k;
      seg({ x: c.x - m, y: c.y }, { x: c.x + m, y: c.y }, 'ext');
      seg({ x: c.x, y: c.y - m }, { x: c.x, y: c.y + m }, 'ext');
      if (st.cen !== 'Line') return;
      /* centre LINES run on past the circle, broken at the mark */
      for (const s of [1, -1]) {
        seg({ x: c.x + s * (m + m * 0.6), y: c.y }, { x: c.x + s * (r + m), y: c.y }, 'ext');
        seg({ x: c.x, y: c.y + s * (m + m * 0.6) }, { x: c.x, y: c.y + s * (r + m) }, 'ext');
      }
    };
    const readable = (a) => {
      a = norm2pi(a);
      if (a > Math.PI / 2 + 1e-9 && a <= 3 * Math.PI / 2 + 1e-9) a = norm2pi(a + Math.PI);
      return a;
    };
    /* $text: ephemeral measurement override used by the paper-space preview
       (a scaled-to-fit clone must keep the model-space value) */
    /* ent.txt is the Text/Mtext override typed at the dimension prompt;
       $text is the ephemeral one the paper-space preview substitutes */
    const label = (s) => (ent.$text != null ? String(ent.$text)
      : (ent.txt != null ? String(ent.txt) : s));
    /* ---- the measurement, written the way the style asks ----
       the unit format and precision, rounded off, scaled, its zeros kept or
       dropped, its separator, then prefix and suffix — and after that the
       tolerance and the alternate units, which the tabs above control. */
    const fmtUnit = (v, lunits, prec, zin, dsep) => {
      const U = Nasj.units;
      let s = (U && U.fmtLenAs) ? U.fmtLenAs(v, lunits, prec) : Number(v).toFixed(prec);
      if (zin === 'Leading' || zin === 'Both') s = s.replace(/^(-?)0\./, '$1.');
      if ((zin === 'Trailing' || zin === 'Both') && s.indexOf('.') >= 0) {
        s = s.replace(/0+$/, '').replace(/\.$/, '');
      }
      if (dsep && dsep !== '.') s = s.split('.').join(dsep);
      return s;
    };
    const roundOff = (v, r) => (r > 0 ? Math.round(v / r) * r : v);
    /* below the sub-units factor a small measurement is written in them
       (0.4 m at factor 100 with suffix "cm" reads 40cm) */
    const subUnits = (v, s) => {
      if (!(st.subFac > 1) || !st.subSuf || Math.abs(v) >= 1 || v === 0) return s;
      return fmtUnit(v * st.subFac, st.lunit, st.prec, st.zin, st.dsep) + st.subSuf;
    };
    const primary = (v) => {
      const m = roundOff(v * (st.lfac > 0 ? st.lfac : 1), st.rnd);
      return subUnits(m, fmtUnit(m, st.lunit, st.prec, st.zin, st.dsep));
    };
    const altOf = (v) => {
      const m = roundOff(v * (st.altFac > 0 ? st.altFac : 1), st.altRnd);
      return st.altPre + fmtUnit(m, st.altUnit, st.altPrec, st.altZin, st.dsep) + st.altSuf;
    };
    const tolOf = (v) => {
      const up = fmtUnit(st.tolUp, st.lunit, st.tolPrec, st.tolZin, st.dsep);
      const lo = fmtUnit(Math.abs(st.tolLo), st.lunit, st.tolPrec, st.tolZin, st.dsep);
      switch (st.tol) {
        case 'Symmetrical': return { suffix: ' Â±' + up };
        case 'Deviation': return { suffix: ' +' + up + '/-' + lo };
        case 'Limits': {
          const hi = primary(v + st.tolUp), low = primary(v - Math.abs(st.tolLo));
          return { replace: hi + ' / ' + low };
        }
        default: return {};   /* None, and Basic (which draws a frame instead) */
      }
    };
    /* the whole label: what the dimension has to say about a measurement */
    const fmtVal = (v) => {
      const t = tolOf(v);
      let s = t.replace != null ? t.replace : primary(v);
      if (t.suffix) s += t.suffix;
      if (st.alt && st.altPlace === 'After') s += ' [' + altOf(v) + ']';
      return st.pre + s + st.suf;
    };
    /* Below-placement alternate units ride under the measurement */
    const altBelow = (v) => (st.alt && st.altPlace === 'Below') ? '[' + altOf(v) + ']' : null;
    /* an angle, in the units and precision the style asks for */
    const fmtAngle = (deg) => {
      const U = Nasj.units;
      let s = (U && U.fmtAngAs) ? U.fmtAngAs(deg, st.aunit, st.aprec)
        : deg.toFixed(st.aprec) + 'Â°';
      if (st.azin === 'Leading' || st.azin === 'Both') s = s.replace(/^(-?)0\./, '$1.');
      if ((st.azin === 'Trailing' || st.azin === 'Both') && s.indexOf('.') >= 0) {
        s = s.replace(/0+(?=\D*$)/, '').replace(/\.(?=\D*$)/, '');
      }
      return st.pre + s + st.suf;
    };

    /* ---- a linear or aligned dimension, placed the way the Text and Fit
       tabs ask: the text along and across the line, the way it reads, and
       what steps outside when the two ends are too close together ---- */
    const drawLinear = (d1, d2, m, lineAng) => {
      const L = dist(d1, d2);
      const dir = L > EPS ? normalize(sub(d2, d1)) : { x: 1, y: 0 };
      const nrm = { x: -dir.y, y: dir.x };
      const str = label(fmtVal(m));
      const probe = annoText({ x: 0, y: 0 }, str, TH, 0, 'center', true);
      const tw = annoTextWidth(probe);
      /* what fits between the extension lines */
      const roomForBoth = L > tw + 2 * ALEN + 2 * u;
      const roomForText = L > tw + 2 * u;
      let textOut = false, arrowsOut = false;
      if (!roomForBoth) {
        switch (st.fit) {
          case 'Arrows': arrowsOut = true; break;
          case 'Text': textOut = true; break;
          case 'Both': textOut = arrowsOut = true; break;
          case 'Keep text inside': arrowsOut = true; break;
          default:                        /* best fit: move the one that helps */
            if (roomForText) arrowsOut = true;
            else { textOut = true; arrowsOut = true; }
        }
      }
      if (st.tmanual) textOut = false;    /* placed by hand: leave it be */
      /* the dimension line, and its arrowheads inside or outside */
      if (!arrowsOut || st.tofl) dimLine(d1, d2);
      if (arrowsOut) {
        const e = ALEN * 2;
        if (!st.sd1) seg(add(d1, { x: -dir.x * e, y: -dir.y * e }), d1);
        if (!st.sd2) seg(d2, add(d2, { x: dir.x * e, y: dir.y * e }));
      }
      if (!(st.fitSup && arrowsOut)) {
        const inward = arrowsOut ? { x: -dir.x, y: -dir.y } : dir;
        if (!st.sd1) arrow(d1, inward, 1);
        if (!st.sd2) arrow(d2, { x: -inward.x, y: -inward.y }, 2);
      }
      /* where the text sits along the line */
      let along = 0.5, over = false;
      if (st.thoriz === 'At Ext Line 1' || st.thoriz === 'Over Ext Line 1') along = 0;
      if (st.thoriz === 'At Ext Line 2' || st.thoriz === 'Over Ext Line 2') along = 1;
      over = st.thoriz.indexOf('Over') === 0;
      let p = { x: d1.x + dir.x * L * along, y: d1.y + dir.y * L * along };
      if (along === 0 && !over) p = add(p, { x: dir.x * (tw / 2 + ALEN), y: dir.y * (tw / 2 + ALEN) });
      if (along === 1 && !over) p = add(p, { x: -dir.x * (tw / 2 + ALEN), y: -dir.y * (tw / 2 + ALEN) });
      if (textOut) {
        p = add(d2, { x: dir.x * (tw / 2 + ALEN * 2 + u), y: dir.y * (tw / 2 + ALEN * 2 + u) });
        if (st.tplace !== 'NoLeader') {   /* a leader out to the text */
          seg(d2, add(d2, { x: dir.x * ALEN * 2, y: dir.y * ALEN * 2 }));
        }
      }
      /* and across it: centred on the line, or clear of it */
      const off = { Centered: 0, Above: 1, Outside: 1, JIS: 1, Below: -1 }[st.tvert] || 0;
      if (off) p = add(p, { x: nrm.x * off * (TH / 2 + u), y: nrm.y * off * (TH / 2 + u) });
      /* which way it reads */
      let ang = (st.talign === 'Horizontal') ? 0 : readable(lineAng);
      if (over) ang = readable(lineAng + Math.PI / 2);
      if (st.tview === 'Right-to-Left') ang = norm2pi(ang + Math.PI);
      const t = dress(annoText(p, str, TH, ang, 'center', off === 0 && !textOut));
      G.texts.push(t);
      const below = altBelow(m);
      if (below) {
        G.texts.push(dress(annoText(
          add(p, { x: -nrm.x * TH * 1.4, y: -nrm.y * TH * 1.4 }), below, TH, ang, 'center', false)));
      }
    };
    const TH = h * S;                     /* text height, overall scale in */
    /* the dimension writes in the text style it names, and in its own
       colour when the style gives it one — both ride on the text objects */
    const ts = textStyleOf(Nasj.doc, { style: st.txtsty });
    const dress = (t) => {
      if (ts) { t.font = ts.font; t.fstyle = ts.fstyle; }
      if (st.clrt && st.clrt !== 'ByBlock' && st.clrt !== 'ByLayer') t.color = st.clrt;
      if (st.fillt && st.fillt !== 'None') t.fill = st.fillt;
      /* a frame around the measurement: the Text tab's box, and what the
         Basic tolerance draws instead of a value */
      if (st.frame || st.tol === 'Basic') t.frame = true;
      return t;
    };
    const p1 = ent.p1, p2 = ent.p2, p3 = ent.p3;
    switch (ent.kind) {
      case 'linear': {
        const horiz = ent.orient !== 'v';
        const d1 = horiz ? { x: p1.x, y: p3.y } : { x: p3.x, y: p1.y };
        const d2 = horiz ? { x: p2.x, y: p3.y } : { x: p3.x, y: p2.y };
        const m = horiz ? Math.abs(p2.x - p1.x) : Math.abs(p2.y - p1.y);
        ext(p1, d1, 1);
        ext(p2, d2, 2);
        drawLinear(d1, d2, m, horiz ? 0 : Math.PI / 2);
        break;
      }
      case 'aligned': {
        const dir = normalize(sub(p2, p1));
        const n = { x: -dir.y, y: dir.x };
        const off = (p3.x - p1.x) * n.x + (p3.y - p1.y) * n.y;
        const d1 = add(p1, { x: n.x * off, y: n.y * off });
        const d2 = add(p2, { x: n.x * off, y: n.y * off });
        ext(p1, d1, 1);
        ext(p2, d2, 2);
        drawLinear(d1, d2, dist(p1, p2), angle(p1, p2));
        break;
      }
      case 'radius': {
        const r = dist(p1, p2);
        const uv = dist(p1, p3) > EPS ? normalize(sub(p3, p1))
          : (r > EPS ? normalize(sub(p2, p1)) : { x: 1, y: 0 });
        const q = add(p1, { x: uv.x * r, y: uv.y * r });
        const outside = dist(p1, p3) >= r;
        centreMark(p1, r);
        seg(p1, outside ? p3 : q);
        arrow(q, outside ? uv : { x: -uv.x, y: -uv.y }, 1);
        const t = dress(annoText({ x: 0, y: 0 }, label('R' + fmtVal(r)), TH, readable(Math.atan2(uv.y, uv.x)), 'center', true));
        const s = outside ? 1 : -1;
        const w = annoTextWidth(t);
        t.p = add(p3, { x: uv.x * s * (w / 2 + u), y: uv.y * s * (w / 2 + u) });
        G.texts.push(t);
        break;
      }
      case 'diameter': {
        /* the line crosses the whole circle through its centre; placed outside
           it runs on out to where you dropped it, as the industry standard's does */
        const r = dist(p1, p2);
        const uv = dist(p1, p3) > EPS ? normalize(sub(p3, p1))
          : (r > EPS ? normalize(sub(p2, p1)) : { x: 1, y: 0 });
        const near = add(p1, { x: uv.x * r, y: uv.y * r });
        const far = add(p1, { x: -uv.x * r, y: -uv.y * r });
        const outside = dist(p1, p3) >= r;
        centreMark(p1, r);
        seg(far, outside ? p3 : near);
        arrow(near, outside ? uv : { x: -uv.x, y: -uv.y }, 1);
        arrow(far, outside ? { x: -uv.x, y: -uv.y } : uv, 2);
        const t = dress(annoText({ x: 0, y: 0 }, label('Ã˜' + fmtVal(r * 2)), TH,
          readable(Math.atan2(uv.y, uv.x)), 'center', true));
        const s = outside ? 1 : -1;
        const w = annoTextWidth(t);
        t.p = add(p3, { x: uv.x * s * (w / 2 + u), y: uv.y * s * (w / 2 + u) });
        G.texts.push(t);
        break;
      }
      case 'angular': {
        const p4 = isPt(ent.p4) ? ent.p4 : mid(p2, p3);
        const r0 = dist(p1, p4);
        const r = r0 > EPS ? r0 : Math.max((dist(p1, p2) + dist(p1, p3)) / 4, 1);
        let a0 = angle(p1, p2), a1 = angle(p1, p3);
        if (!angleInArc(angle(p1, p4), a0, a1)) { const t = a0; a0 = a1; a1 = t; }
        const sweep = arcSweep(a0, a1);
        [[p2, a0, 1], [p3, a1, 2]].forEach(([pr, aa, which]) => {
          if (which === 1 ? st.se1 : st.se2) return;
          const to = r + OVER;
          let from = Math.min(dist(p1, pr) + GAP, r);
          if (st.fxlon) from = Math.max(from, to - FXL);
          if (to > from + EPS) seg(polar(p1, aa, from), polar(p1, aa, to), 'ext');
        });
        G.arcs.push({ c: { x: p1.x, y: p1.y }, r, a0, a1 });
        if (sweep * r > ALEN * 2) {
          if (!st.sd1) arrow(polar(p1, a0, r), { x: -Math.sin(a0), y: Math.cos(a0) }, 1);
          if (!st.sd2) arrow(polar(p1, a1, r), { x: Math.sin(a1), y: -Math.cos(a1) }, 2);
        }
        G.texts.push(dress(annoText(polar(p1, a0 + sweep / 2, r),
          label(fmtAngle(sweep * 180 / Math.PI)), TH,
          isNum(ent.trot) ? ent.trot : 0, 'center', true)));
        break;
      }
    }
    return G;
  };

  /* the style a multileader is drawn with — its own, else the current one */
  const mleaderStyleOf = (doc, ent) => {
    const t = doc && doc.styles && doc.styles.mleader;
    if (!t || !Array.isArray(t.list) || !t.list.length) return styleDef('mleader', null);
    const want = String((ent && ent.style) || t.current || '').trim().toUpperCase();
    return t.list.find((s) => s.name.toUpperCase() === want) ||
      t.list.find((s) => s.name.toUpperCase() === String(t.current || '').toUpperCase()) ||
      t.list[0];
  };

  const leaderGeometry = (ent, stIn) => {
    const st = stIn || mleaderStyleOf(Nasj.doc, ent);
    const h = (isNum(ent.h) && ent.h > 0) ? ent.h : 3;
    const S = st.scale > 0 ? st.scale : 1;
    const k = (h / (st.txtH > 0 ? st.txtH : 3)) * S;
    const TH = h * S;
    const u = st.gap * k;                    /* landing gap before the text */
    let ALEN = st.asz * k;
    const LAND = st.landDist * k;
    const G = { segs: [], arcs: [], arrows: [], texts: [], fills: [] };
    const seg = (a, b) => G.segs.push([{ x: a.x, y: a.y }, { x: b.x, y: b.y }, 'lead']);
    const pts = (ent.pts || []).slice();
    if (!pts.length) return G;
    /* An imported LEADER carries no text of its own (its annotation is a
       separate entity in the file) — the style's sample text is for the
       style dialog's preview only (stIn), never the drawing. A textless
       leader draws just its stored path and arrowhead, the way the industry standard
       does: no phantom text, no synthetic landing tail. */
    const str = (ent.str == null || ent.str === '') ? (stIn ? st.defText : '') : ent.str;
    const hasContent = st.content !== 'None' && str !== '';
    /* industry-standard-like suppression: an arrowhead is never larger than the
       segment it sits on — a style-sized arrow on a short imported leader
       would dwarf the leader itself */
    if (pts.length >= 2) ALEN = Math.min(ALEN, dist(pts[0], pts[1]) * 0.4);
    /* the landing: the horizontal tail the text sits off, added to the path */
    const last = pts[pts.length - 1];
    const prev = pts.length >= 2 ? pts[pts.length - 2] : { x: last.x - 1, y: last.y };
    const toRight = last.x >= prev.x;
    let tail = last;
    if (hasContent && st.landOn && (st.landFixed ? LAND > 0 : true)) {
      const d = st.landFixed ? LAND : Math.max(LAND, 0);
      if (d > EPS) {
        tail = { x: last.x + (toRight ? d : -d), y: last.y };
        pts.push(tail);
      }
    }
    /* the leader line itself: straight, curved, or not drawn at all */
    if (st.ltype === 'Spline' && pts.length >= 3) {
      const cs = splineBeziers({ pts, closed: false });
      for (const c of cs) {
        const n = 12;
        let p0 = c.a;
        for (let i = 1; i <= n; i++) {
          const t = i / n, mt = 1 - t;
          const p = {
            x: mt * mt * mt * c.a.x + 3 * mt * mt * t * c.c1.x + 3 * mt * t * t * c.c2.x + t * t * t * c.b.x,
            y: mt * mt * mt * c.a.y + 3 * mt * mt * t * c.c1.y + 3 * mt * t * t * c.c2.y + t * t * t * c.b.y,
          };
          seg(p0, p);
          p0 = p;
        }
      }
    } else if (st.ltype !== 'None') {
      for (let i = 0; i + 1 < pts.length; i++) seg(pts[i], pts[i + 1]);
    }
    /* the arrowhead the style asks for, at the point it was started from */
    if (st.ltype !== 'None' && st.arrow !== 'None' && ALEN > 0 &&
        pts.length >= 2 && dist(pts[0], pts[1]) > EPS) {
      const dir = normalize(sub(pts[1], pts[0]));
      arrowHeadGeom(G, seg, pts[0], dir, st.arrow, ALEN);
    }
    /* and what it carries */
    if (!hasContent) return G;
    const ts = textStyleOf(Nasj.doc, { style: st.txtsty });
    const t = annoText({ x: 0, y: 0 }, str, TH, 0, 'left', false);
    const w = annoTextWidth(t);
    /* left-justified text always starts to the right of the landing */
    const right = st.leftJust ? true : toRight;
    const dy = { Top: -TH, Middle: -TH / 2, Bottom: 0, Underline: 0 }[st.attach];
    t.p = right ? { x: tail.x + u, y: tail.y + dy } : { x: tail.x - u - w, y: tail.y + dy };
    if (ts) { t.font = ts.font; t.fstyle = ts.fstyle; }
    if (st.clrt && st.clrt !== 'ByBlock' && st.clrt !== 'ByLayer') t.color = st.clrt;
    if (st.frame) t.frame = true;
    G.texts.push(t);
    if (st.attach === 'Underline') {
      seg({ x: t.p.x, y: tail.y }, { x: t.p.x + w, y: tail.y });
    }
    return G;
  };

  const tableCorners = (ent) => {
    const cw = ent.colw > 0 ? ent.colw : 30, rh = ent.rowh > 0 ? ent.rowh : 8;
    const L = ent.p.x, T = ent.p.y;
    const R = L + (ent.cols || 1) * cw, B = T - (ent.rows || 1) * rh;
    return [{ x: L, y: T }, { x: R, y: T }, { x: R, y: B }, { x: L, y: B }];
  };

  /* the style a table is drawn with — its own, else the current one */
  const tableStyleOf = (doc, ent) => {
    const t = doc && doc.styles && doc.styles.table;
    if (!t || !Array.isArray(t.list) || !t.list.length) return styleDef('table', null);
    const want = String((ent && ent.style) || t.current || '').trim().toUpperCase();
    return t.list.find((s) => s.name.toUpperCase() === want) ||
      t.list.find((s) => s.name.toUpperCase() === String(t.current || '').toUpperCase()) ||
      t.list[0];
  };

  const tableGeometry = (ent, stIn) => {
    const st = stIn || tableStyleOf(Nasj.doc, ent);
    const rows = ent.rows || 1, cols = ent.cols || 1;
    const cw = ent.colw > 0 ? ent.colw : 30, rh = ent.rowh > 0 ? ent.rowh : 8;
    const L = ent.p.x, T = ent.p.y, R = L + cols * cw, B = T - rows * rh;
    const G = { segs: [], arcs: [], arrows: [], texts: [], fills: [] };
    /* which cell style a row belongs to: the title, the header, or the data
       — and the table can be built the other way up */
    const up = st.dir === 'Up';
    /* Insert Table lets the first row, the second and all the rest each be
       drawn by any of the three cell styles; a table without that mapping is
       the title/header/data one every table has always had */
    const rs = ent.rowStyles;
    const kindOfRow = (r) => {
      const i = up ? rows - 1 - r : r;
      if (rs) return rs[i === 0 ? 'first' : (i === 1 ? 'second' : 'rest')] || 'd';
      return i === 0 ? 't' : (i === 1 ? 'h' : 'd');
    };
    const P = (k, p) => st[k + p];
    /* the borders each cell style asks for */
    const wants = (k, edge) => {
      const b = P(k, 'Bord');
      if (b === 'None') return false;
      if (b === 'All') return true;
      return edge === 'out' ? b === 'Outside' : b === 'Inside';
    };
    const seg = (a, b, kind) =>
      G.segs.push([{ x: a.x, y: a.y }, { x: b.x, y: b.y }, kind]);
    /* the horizontal rules: each belongs to the row above and below it */
    for (let r = 0; r <= rows; r++) {
      const y = T - r * rh;
      const k = kindOfRow(Math.min(rows - 1, r === rows ? rows - 1 : r));
      const edge = (r === 0 || r === rows) ? 'out' : 'in';
      if (wants(k, edge)) seg({ x: L, y }, { x: R, y }, k + '-bord');
    }
    /* and the verticals, per row so each takes its own cell style */
    for (let r = 0; r < rows; r++) {
      const k = kindOfRow(r);
      const y0 = T - r * rh, y1 = y0 - rh;
      for (let c = 0; c <= cols; c++) {
        const edge = (c === 0 || c === cols) ? 'out' : 'in';
        if (wants(k, edge)) seg({ x: L + c * cw, y: y0 }, { x: L + c * cw, y: y1 }, k + '-bord');
      }
    }
    /* the fill behind each row that asks for one */
    for (let r = 0; r < rows; r++) {
      const k = kindOfRow(r);
      const f = P(k, 'Fill');
      if (!f || f === 'None') continue;
      const y0 = T - r * rh, y1 = y0 - rh;
      G.fills.push({
        pts: [{ x: L, y: y0 }, { x: R, y: y0 }, { x: R, y: y1 }, { x: L, y: y1 }],
        alpha: f === '@shade' ? 0.12 : 1,
        color: f === '@shade' ? null : f,
      });
    }
    /* what the cells say, written where their cell style puts it */
    const fmtCell = (k, s) => {
      const f = P(k, 'Fmt');
      if (f === 'General') return s;
      const v = Number(String(s).replace(/[^0-9.eE+-]/g, ''));
      if (!isNum(v)) return s;
      const p = P(k, 'Prec');
      if (f === 'Whole number') return String(Math.round(v));
      if (f === 'Percentage') return (v * 100).toFixed(p) + '%';
      if (f === 'Currency') return '$' + v.toFixed(p);
      return v.toFixed(p);
    };
    const cells = ent.cells || {};
    for (const key of Object.keys(cells)) {
      const m = /^(\d+)\s*,\s*(\d+)$/.exec(key);
      if (!m) continue;
      const r = +m[1], c = +m[2];
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      const k = kindOfRow(r);
      const h = rh * P(k, 'H');
      const mh = rh * P(k, 'MargH'), mv = rh * P(k, 'MargV');
      const str = fmtCell(k, cells[key]);
      const t = annoText({ x: 0, y: 0 }, str, h, P(k, 'Ang') * Math.PI / 180, 'left', false);
      const w = annoTextWidth(t);
      const [vert, horz] = String(P(k, 'Align')).split(' ');
      const x0 = L + c * cw, y0 = T - r * rh;
      t.p = {
        x: horz === 'Center' ? x0 + (cw - w) / 2
          : (horz === 'Right' ? x0 + cw - mh - w : x0 + mh),
        y: vert === 'Middle' ? y0 - (rh + h) / 2 + h * 0.15
          : (vert === 'Bottom' ? y0 - rh + mv : y0 - mv - h),
      };
      const ts = textStyleOf(Nasj.doc, { style: P(k, 'Sty') });
      if (ts) { t.font = ts.font; t.fstyle = ts.fstyle; }
      const col = P(k, 'Clr');
      if (col && col !== 'ByBlock' && col !== 'ByLayer') t.color = col;
      G.texts.push(t);
    }
    return G;
  };

  /* st: an explicit style, for a preview of one the drawing has not taken */
  const entityAnno = (ent, st) => {
    switch (ent.type) {
      case 'dim': return dimGeometry(ent, st);
      case 'leader': return leaderGeometry(ent, st);
      case 'table': return tableGeometry(ent, st);
      default: return null;
    }
  };

  /* every outline segment of a decomposed dim/leader/table (rect tests, snaps) */
  const annoSegList = (G) => {
    const segs = G.segs.map(([a, b]) => [a, b]);
    for (const A of G.arcs) {
      const s = arcSweep(A.a0, A.a1), n = 24;
      let prev = arcPoint(A, A.a0);
      for (let i = 1; i <= n; i++) {
        const p = arcPoint(A, A.a0 + s * i / n);
        segs.push([prev, p]);
        prev = p;
      }
    }
    for (const tri of G.arrows) {
      segs.push([tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]);
    }
    for (const t of G.texts) {
      const cs = annoTextCorners(t);
      for (let i = 0; i < 4; i++) segs.push([cs[i], cs[(i + 1) % 4]]);
    }
    return segs;
  };

  /* The placement map of a reference: the definition's own coordinates â†’ the
     world. Shared by the children (insertEntities) and by the clip ring, so
     the boundary can never drift away from the geometry it clips. */
  const insertXform = (ent, doc) => {
    const d = doc || Nasj.doc;
    const def = d && d.blocks && d.blocks[ent.name];
    const sx = isNum(ent.sx) ? ent.sx : 1;
    const sy = isNum(ent.sy) ? ent.sy : 1;
    const rot = ent.rot || 0;
    const co = Math.cos(rot), si = Math.sin(rot);
    const base = (def && isPt(def.base)) ? def.base : { x: 0, y: 0 };
    return (q) => {
      const lx = (q.x - base.x) * sx, ly = (q.y - base.y) * sy;
      return { x: ent.p.x + lx * co - ly * si, y: ent.p.y + lx * si + ly * co };
    };
  };

  /* The other direction: world â†’ the definition's own coordinates. XCLIP
     stores its ring this way, and REFEDIT saves its edits back through it. */
  const insertInvXform = (ent, doc) => {
    const d = doc || Nasj.doc;
    const def = d && d.blocks && d.blocks[ent.name];
    const sx = isNum(ent.sx) ? ent.sx : 1;
    const sy = isNum(ent.sy) ? ent.sy : 1;
    const rot = ent.rot || 0;
    const co = Math.cos(rot), si = Math.sin(rot);
    const base = (def && isPt(def.base)) ? def.base : { x: 0, y: 0 };
    return (w) => {
      const dx = w.x - ent.p.x, dy = w.y - ent.p.y;
      return {                            /* un-rotate, then un-scale */
        x: base.x + (dx * co + dy * si) / sx,
        y: base.y + (-dx * si + dy * co) / sy
      };
    };
  };

  /* The XCLIP ring in world coordinates, or null when this reference is not
     clipped (or its boundary is switched off, which XCLIP Off does). */
  const insertClipWorld = (ent, doc) => {
    const c = ent && ent.clip;
    if (!c || c.on === false || !Array.isArray(c.pts) || c.pts.length < 3) return null;
    const fn = insertXform(ent, doc);
    return { pts: c.pts.map(fn), inverted: !!c.inverted };
  };

  /* Is a world point on the side of the boundary that is drawn? An inverted
     clip (XCLIP Invert) keeps the outside and hides the inside. */
  const insertClipAccepts = (clip, p) => {
    if (!clip) return true;
    const inside = pointInLoop(clip.pts, p);
    return clip.inverted ? !inside : inside;
  };

  /* AN ARC UNDER A SQUASHED PLACEMENT IS AN ELLIPSE. A reference that
     scales x and y by different amounts turns every circle its definition
     holds into an elliptical one, and no single radius can stand for that:
     scaling the radius by the MEAN while the centre goes through both
     scales separately puts the drawn curve nowhere near its own centre. On
     one arc-fit hairline in a real file (radius 3.1 million, sweep 1.8
     microradians, under 600Ã—800) the point landed 580,000 definition units
     off, and one such child held the drawing's extents at five times the
     height the industry standard reports for it.
     The image is spelled by the two CONJUGATE semi-diameters the linear
     part maps the source's own pair to. `conjAxes` turns those back into
     the axis pair an ellipse names, plus the parameter shift that keeps a
     swept one on exactly the points it drew before. */
  const conjAxes = (u, v) => {
    const uu = u.x * u.x + u.y * u.y;
    const vv = v.x * v.x + v.y * v.y;
    const uv = u.x * v.x + u.y * v.y;
    /* |P(t)|Â² peaks at this t: P(t0) and P(t0+Ï€/2) are the axes themselves */
    const t0 = 0.5 * Math.atan2(2 * uv, uu - vv);
    const c0 = Math.cos(t0), s0 = Math.sin(t0);
    const ax = u.x * c0 + v.x * s0, ay = u.y * c0 + v.y * s0;
    const bx = v.x * c0 - u.x * s0, by = v.y * c0 - u.y * s0;
    return {
      rx: Math.hypot(ax, ay), ry: Math.hypot(bx, by),
      rot: Math.atan2(ay, ax), t0,
      /* a mirrored placement hands back a left-handed pair; the app's
         ellipse is always right-handed, so its parameter runs backwards */
      flip: (ax * by - ay * bx) < 0
    };
  };
  /* c is MUTATED into the ellipse its arc/circle/ellipse self becomes under
     the placement whose linear part is `lin` and whose full map is `fn` */
  const squashToEllipse = (c, lin, fn) => {
    let u, v, p0 = null, p1 = null;
    if (c.type === 'ellipse') {
      const ro = c.rot || 0, co = Math.cos(ro), si = Math.sin(ro);
      u = lin({ x: c.rx * co, y: c.rx * si });
      v = lin({ x: -c.ry * si, y: c.ry * co });
      if (isNum(c.a0) && isNum(c.a1)) { p0 = c.a0; p1 = c.a1; }
    } else {
      u = lin({ x: c.r, y: 0 });
      v = lin({ x: 0, y: c.r });
      if (c.type === 'arc') { p0 = c.a0; p1 = c.a1; }
    }
    const A = conjAxes(u, v);
    c.c = fn(c.c);
    c.type = 'ellipse';
    c.rx = A.rx; c.ry = A.ry; c.rot = norm2pi(A.rot);
    delete c.r;
    if (p0 == null) { delete c.a0; delete c.a1; return c; }
    let s0 = p0 - A.t0, s1 = p1 - A.t0;
    if (A.flip) { const t = s0; s0 = -s1; s1 = -t; }
    c.a0 = norm2pi(s0); c.a1 = norm2pi(s1);
    return c;
  };
  /* the same for the round boundary of a hatch (which carries no sweep) —
     a FRESH boundary, read off the source before the ordinary transform
     runs over it and written back after */
  const squashedBoundary = (b, lin, fn) => {
    const e = squashToEllipse({
      type: b.kind === 'circle' ? 'circle' : 'ellipse',
      c: b.c, r: b.r, rx: b.rx, ry: b.ry, rot: b.rot || 0
    }, lin, fn);
    return { kind: 'ellipse', c: e.c, rx: e.rx, ry: e.ry, rot: e.rot };
  };
  /* does this placement squash? a mirror or a uniform scale does not — the
     hairline-arc sweep rules below stay exactly as they were for those */
  const squashes = (sx, sy) => {
    const a = Math.abs(sx), b = Math.abs(sy);
    return Math.abs(a - b) > 1e-12 * Math.max(a, b, 1);
  };
  const roundOne = (c) => c.type === 'arc' || c.type === 'circle' || c.type === 'ellipse';
  const roundBoundary = (c) => c.type === 'hatch' && c.boundary &&
    (c.boundary.kind === 'circle' || c.boundary.kind === 'ellipse');

  /* Definition coordinates â†’ the world, for one placement. The entities are
     MUTATED and handed back, so callers pass copies they already own. */
  const insertToWorld = (ent, ents, doc) => {
    const sx = isNum(ent.sx) ? ent.sx : 1;
    const sy = isNum(ent.sy) ? ent.sy : 1;
    const rot = ent.rot || 0;
    const fn = insertXform(ent, doc);
    const k = (Math.abs(sx) + Math.abs(sy)) / 2;
    const co = Math.cos(rot), si = Math.sin(rot);
    /* the placement's linear part alone: scale the axes, then turn */
    const lin = squashes(sx, sy)
      ? (q) => { const x = q.x * sx, y = q.y * sy;
        return { x: x * co - y * si, y: x * si + y * co }; }
      : null;
    for (const c of ents) {
      if (lin && roundOne(c)) { squashToEllipse(c, lin, fn); continue; }
      const sq = (lin && roundBoundary(c)) ? squashedBoundary(c.boundary, lin, fn) : null;
      transformEntity(c, fn, { k });
      if (sq) c.boundary = sq;
      if (c.type === 'polyline' && sx * sy < 0) {
        /* mirrored placement reverses arc orientation: flip bulge signs */
        for (const p of c.pts) if (isNum(p.b) && p.b) p.b = -p.b;
      }
      if (c.type === 'arc' || c.type === 'arctext') {
        /* A negative scale REFLECTS the sweep — the arc runs the other way
           round its centre and its ends trade places — and two of them are
           a half turn. Carrying the stored angles through either drew the
           arc on the far side of its centre: a hairline of radius 290 came
           out a full diameter from where the industry standard draws it. */
        if (sx * sy < 0) {
          const m = (sx < 0 ? Math.PI : 0) + rot;
          const a0 = c.a0;
          c.a0 = norm2pi(m - c.a1);
          c.a1 = norm2pi(m - a0);
        } else {
          const t = (sx < 0 ? Math.PI : 0) + rot;
          c.a0 = norm2pi(c.a0 + t); c.a1 = norm2pi(c.a1 + t);
        }
      } else if (c.type === 'ellipse' || c.type === 'text' || c.type === 'attdef') c.rot = norm2pi((c.rot || 0) + rot);
      /* a squashed boundary took the turn with the squash — see above */
      else if (!sq && c.type === 'hatch' && c.boundary && c.boundary.kind === 'ellipse') {
        c.boundary.rot = norm2pi((c.boundary.rot || 0) + rot);
      }
    }
    return ents;
  };

  /* The world â†’ definition coordinates: exactly insertToWorld run backwards,
     step for step, so a round trip lands where it started. REFEDIT edits a
     reference's geometry out in the world where it can be seen, and this is
     what turns those edits back into the definition. */
  const insertToDef = (ent, ents, doc) => {
    const sx = isNum(ent.sx) ? ent.sx : 1;
    const sy = isNum(ent.sy) ? ent.sy : 1;
    const rot = ent.rot || 0;
    const inv = insertInvXform(ent, doc);
    const k = (Math.abs(sx) + Math.abs(sy)) / 2;
    const co = Math.cos(rot), si = Math.sin(rot);
    /* the inverse of the linear part: unturn, then unscale each axis. A
       round curve stays a round curve through it — the ellipse insertToWorld
       made of a squashed arc comes back the shape it started, and REFEDIT's
       trip out to the world and home again moves nothing. */
    const lin = squashes(sx, sy)
      ? (q) => ({ x: (q.x * co + q.y * si) / sx, y: (q.y * co - q.x * si) / sy })
      : null;
    for (const c of ents) {
      if (lin && roundOne(c)) { squashToEllipse(c, lin, inv); continue; }
      const sq = (lin && roundBoundary(c)) ? squashedBoundary(c.boundary, lin, inv) : null;
      /* insertToWorld adds the placement rotation last, so this takes it off
         first — the inverse of a composition reverses the order */
      if (c.type === 'arc' || c.type === 'arctext') { c.a0 = norm2pi(c.a0 - rot); c.a1 = norm2pi(c.a1 - rot); }
      else if (c.type === 'ellipse' || c.type === 'text' || c.type === 'attdef') c.rot = norm2pi((c.rot || 0) - rot);
      else if (!sq && c.type === 'hatch' && c.boundary && c.boundary.kind === 'ellipse') {
        c.boundary.rot = norm2pi((c.boundary.rot || 0) - rot);
      }
      if (c.type === 'polyline' && sx * sy < 0) {
        for (const p of c.pts) if (isNum(p.b) && p.b) p.b = -p.b;
      }
      transformEntity(c, inv, { k: k ? 1 / k : 1 });
      if (sq) c.boundary = sq;
    }
    return ents;
  };

  /* insert: transformed deep copies of the block definition's entities */
  /* plain-data deep copy, JSON-equivalent but with no string in between —
     the render path clones every block child per reference per regen, and
     the JSON round trip was the single hottest line in a heavy drawing */
  const cloneData = (v) => {
    if (Array.isArray(v)) {
      const a = new Array(v.length);
      for (let i = 0; i < v.length; i++) a[i] = cloneData(v[i]);
      return a;
    }
    if (v && typeof v === 'object') {
      const o = {};
      for (const k in v) {
        const x = v[k];
        if (x !== undefined) o[k] = cloneData(x);
      }
      return o;
    }
    return v;
  };

  /* Does a reference materialize this child as the AFFINE image of the
     definition's — for any placement at all? insertToWorld only maps points
     for these; everything else takes a radius, a bulge or a text height
     through the MEAN of |sx| and |sy| (and leaves a mirrored arc's sweep
     where it was), which under a squashed, mirrored or negative placement
     puts the materialized child outside the transform of the definition's.
     A box carried into definition coordinates holds those only when the
     placement is a proper similarity. */
  const affineExact = (c) => {
    switch (c.type) {
      case 'line': case 'point': case 'light': case 'face3d': case 'spline': return true;
      /* a bulge stays a circular arc through a squash that should have made
         it elliptical */
      case 'polyline': return !polylineHasBulge(c);
      /* only a polygon boundary is carried across point for point */
      case 'hatch': return !!(c.boundary && c.boundary.kind === 'pline');
      default: return false;
    }
  };

  /* The points of a child that stand OUTSIDE its own bounds and a cursor can
     still reach, unioned into the child's pointer box through `take`.
     Returns false when this type's reach cannot be bounded cheaply, which
     means "never cull this child". Every type named here keeps its bounds
     plus these: its snaps are vertices, midpoints and quadrants of the very
     geometry entityBounds was taken over, and every hit test it answers is
     witnessed by a point of that geometry within tol of the pick. */
  const childReach = (c, take) => {
    switch (c.type) {
      case 'line': case 'circle': case 'point': case 'light':
      case 'mline': case 'image': case 'face3d': return true;
      /* the centre snap of a swept curve stands off the swept extent */
      case 'arc': case 'ellipse': take(c.c); return true;
      case 'polyline':
        /* a wide one is PICKED across its whole band, and that band scales
           with the reference, not with the definition this box belongs to */
        if (isNum(c.w) && c.w > 0) return false;
        /* the closed one's geometric-centre snap: a self-crossing outline
           can throw the shoelace centroid clean out of the box. Vertices and
           bulge midpoints need no help — polylinePoints samples t=12/24,
           which IS the midpoint entitySnapPoints offers. */
        if (c.closed) {
          const P = polylinePoints(c).pts;
          if (P.length > 2) take(polyCentroid(P));
        }
        return true;
      /* control points shape the curve from off it */
      case 'spline': {
        const q = c.pts || [];
        q.forEach(take);
        if (c.closed && q.length > 2) take(polyCentroid(splinePoints(c).pts));
        return true;
      }
      case 'hatch': return childReach(hatchBoundary(c), take);
      /* Everything else keeps the whole plane. An xline's segments run clean
         across the view; an attribute takes its value, and so its size, from
         the reference; and text and the annotation objects draw at sizes
         their STYLE fixes in world units, which no scale on the reference
         carries — so what a reference materializes for them is not the
         definition's shape scaled, and this box could not hold it. */
      default: return false;
    }
  };

  /* per-child metrics of a definition — centre and largest dimension in
     def-local units, computed once and cached (non-enumerable, so it never
     rides into a saved file). The renderer's level-of-detail reads these:
     a child smaller than a pixel is a dot, not a path.
     The SAME pass records each child's pointer box: everything about the
     child a cursor can reach, in def-local units. The osnap and pick paths
     cull a reference's children against the cursor with it, so a monster
     definition costs the children under the cursor instead of all of them —
     and because the two tables are one, a definition the renderer has
     already measured costs the pointer path nothing at all.
     `seg` records whether any child can put segments into entitySegs at
     all: closestPointOnEntity's insertion-point fallback only stands when
     none can. `mat` counts the children a reference materializes and
     `perRef` says whether a reference can drop some of them — which is what
     lets the pick path tell "nothing near the cursor" from "nothing at all"
     without a second, unclipped expansion. */
  /* THE METRICS OF ONE DEFINITION'S CHILDREN — built straight through
   * (deadline 0) for whoever asks on the pointer path, and a frame's worth
   * at a time for the open front-load, where a 62 000-child definition is
   * 40ms in one bite. The table only becomes the definition's when it is
   * COMPLETE, so nothing can ever read a half-built one. */
  let cmJob = null;
  const cmFresh = (def) => {
    const m = def.__cm2;
    return (m && m.ents === def.entities && m.n === def.entities.length) ? m : null;
  };
  const cmStart = (def) => {
    const n = def.entities.length;
    return { def, ents: def.entities, i: 0, m: { ents: def.entities, n, seg: false, mat: 0,
      perRef: !!def.xref ||
        !!(def.visibility && Array.isArray(def.visibility.states) && def.visibility.states.length),
      cx: new Float64Array(n), cy: new Float64Array(n), sz: new Float64Array(n),
      minx: new Float64Array(n), miny: new Float64Array(n),
      maxx: new Float64Array(n), maxy: new Float64Array(n),
      aff: new Uint8Array(n) } };
  };
  /* true while there is more of the walk to do */
  const cmRun = (job, deadline) => {
    const def = job.def, m = job.m, n = m.n;
    let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
    const take = (p) => {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    };
    let i = job.i;
    for (; i < n; i++) {
      if (deadline && !(i & 255) && performance.now() > deadline) break;
      const c = def.entities[i];
      /* what a reference never materializes (see insertEntities) needs
         neither metric nor box — and a nested reference measured here would
         expand a whole definition for a number nobody reads */
      if (!c || c.type === 'insert' || c.type === 'bparam' || c.construction) {
        m.sz[i] = Infinity;
        m.minx[i] = m.miny[i] = Infinity;
        m.maxx[i] = m.maxy[i] = -Infinity;
        continue;
      }
      m.mat++;
      m.aff[i] = affineExact(c) ? 1 : 0;
      if (c.type === 'attdef' || (Array.isArray(c.hideIn) && c.hideIn.length)) m.perRef = true;
      if (!(c.type === 'point' || (c.type === 'light' && !c.tgt))) m.seg = true;
      const b = entityBounds(c);
      if (!b || !isFinite(b.minx)) {
        m.sz[i] = Infinity;
        m.minx[i] = m.miny[i] = -Infinity;    /* unknowable: keep it */
        m.maxx[i] = m.maxy[i] = Infinity;
        continue;
      }
      m.cx[i] = (b.minx + b.maxx) / 2;
      m.cy[i] = (b.miny + b.maxy) / 2;
      m.sz[i] = Math.max(b.maxx - b.minx, b.maxy - b.miny);
      x0 = b.minx; y0 = b.miny; x1 = b.maxx; y1 = b.maxy;
      if (c.type === 'attdef' || !childReach(c, take) ||
          !isFinite(x0) || !isFinite(y0) || !isFinite(x1) || !isFinite(y1)) {
        x0 = y0 = -Infinity; x1 = y1 = Infinity;
      }
      m.minx[i] = x0; m.miny[i] = y0; m.maxx[i] = x1; m.maxy[i] = y1;
    }
    job.i = i;
    return i < n;
  };
  const cmPublish = (job) => {
    Object.defineProperty(job.def, '__cm2',
      { value: job.m, writable: true, configurable: true });
  };
  const defChildMetrics = (def) => {
    const have = cmFresh(def);
    if (have) return have;
    const job = cmStart(def);
    cmRun(job, 0);
    cmPublish(job);
    return job.m;
  };
  const defChildMetricsStep = (def, deadline) => {
    if (cmFresh(def)) { cmJob = null; return false; }
    if (!cmJob || cmJob.def !== def || cmJob.ents !== def.entities) cmJob = cmStart(def);
    if (cmRun(cmJob, deadline)) return true;
    cmPublish(cmJob);
    cmJob = null;
    return false;
  };

  /* a world-space box carried into a reference's own coordinates — the AABB
     of the transformed corners (rotation mixes the axes). null on a
     degenerate placement (zero scale), which means "cull nothing". */
  const insertLocalBox = (ent, box, doc) => {
    const inv = insertInvXform(ent, doc);
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const q of [{ x: box.minx, y: box.miny }, { x: box.maxx, y: box.miny },
      { x: box.minx, y: box.maxy }, { x: box.maxx, y: box.maxy }]) {
      const l = inv(q);
      if (l.x < minx) minx = l.x;
      if (l.y < miny) miny = l.y;
      if (l.x > maxx) maxx = l.x;
      if (l.y > maxy) maxy = l.y;
    }
    if (!isFinite(minx) || !isFinite(miny) || !isFinite(maxx) || !isFinite(maxy)) return null;
    return { minx, miny, maxx, maxy };
  };

  /* THE LAYERS A REFERENCE'S CHILDREN ARE HIDDEN BY. A layer's state rules
     the geometry wherever the geometry sits: the industry standard's 2027 release neither draws,
     measures, picks nor plots a line on a frozen or switched-off layer for
     being inside a block definition, and the reference's own layer does not
     save it (verified on a synthetic file — a frozen inner layer collapsed
     ZOOM EXTENTS to the visible geometry alone, and the plotted PDF came
     out without the layer at all). Layer 0 is the exception the block
     contract makes: a child drawn there belongs to the REFERENCE's layer
     and follows THAT one's state.
     The set is answered O(1) — a reference asks per placement and a heavy
     drawing has thousands, so even one pass over a 738-layer table per
     reference cost thirty milliseconds of every extents sweep. It is rebuilt
     when the layer array itself changes and whenever `layersChanged` says
     the table was edited; the renderer calls that from the one place it
     already compares a layer signature every frame, so this table is exactly
     as fresh as the scene cache keyed on the same comparison. */
  let hidDoc = null, hidLayers = null, hidN = -1, hidSet = null;
  const hiddenLayers = (d) => {
    const L = d && d.layers;
    if (!Array.isArray(L)) return null;
    if (d === hidDoc && L === hidLayers && L.length === hidN) return hidSet;
    const s = new Set();
    for (const l of L) if (l && !(l.on && !l.frozen)) s.add(l.id);
    hidDoc = d; hidLayers = L; hidN = L.length; hidSet = s.size ? s : null;
    return hidSet;
  };
  /* the layer table was edited: the next reference re-reads its hidden roll */
  const layersChanged = () => {
    hidDoc = null; hidLayers = null; hidN = -1;
    lyDoc = null; lyArr = null; lyN = -1; lyMap = null;
  };
  /* resolveColor/Lt/Lw used to layers.find (738 compares) per child of
     every insert the 2D pass stroked — the hover overlay and the hatch
     raster paid it on BLOCKS.dwg. Same identity key as hiddenLayers. */
  let lyDoc = null, lyArr = null, lyN = -1, lyMap = null;
  const layerById = (doc) => {
    const L = doc && doc.layers;
    if (!Array.isArray(L)) return null;
    if (doc === lyDoc && L === lyArr && L.length === lyN) return lyMap;
    const m = new Map();
    for (const l of L) if (l) m.set(l.id, l);
    lyDoc = doc; lyArr = L; lyN = L.length; lyMap = m;
    return m;
  };
  /* `ent` is the reference the child is drawn by, or null where the answer
     must hold for every reference at once (the definition's cached box) —
     a layer-0 child then names no layer and is kept */
  const childHidden = (hid, c, ent) => {
    if (!hid) return false;
    const id = (c.layerId == null || c.layerId === '0') ? (ent && ent.layerId) : c.layerId;
    return id != null && hid.has(id);
  };

  /* lod (optional): {minLocal, dots} — children whose def-local size is
     under minLocal are NOT materialized; their transformed centres land in
     dots instead, for the caller to draw as single pixels. Draw-path only:
     snapping and picking always take the full set. near (optional): a
     def-local box — the osnap path's cursor neighbourhood; children whose
     snap bounds cannot reach it are not materialized (their snaps are
     beyond the aperture by construction, so the offered snaps are
     unchanged). */
  /* A binding entry: 'Name' is the legacy shorthand for a Move action on
     that parameter; the full form carries the action and its own data. */
  const blockActOf = (b) => (typeof b === 'string' ? { p: b, a: 'move' } : (b || {}));

  /* A parameter's own grips, the industry standard's: a measuring parameter carries one
     at each end of what it measures, and an XY parameter one at each corner
     of its box. Grip 0 is the parameter's base point, which is what a
     binding that names no grip has always meant. */
  const paramGrips = (P) => {
    if (!P) return [];
    const two = P.x2 != null && P.y2 != null;
    if (two && P.kind === 'xy') {
      return [{ x: P.x, y: P.y, g: 0 }, { x: P.x2, y: P.y, g: 1 },
        { x: P.x2, y: P.y2, g: 2 }, { x: P.x, y: P.y2, g: 3 }];
    }
    if (two && (P.kind === 'linear' || P.kind === 'polar')) {
      return [{ x: P.x, y: P.y, g: 0 }, { x: P.x2, y: P.y2, g: 1 }];
    }
    return [{ x: P.x, y: P.y, g: 0 }];
  };
  /* one offset per grip on a reference. Grip 0 keeps the parameter's plain
     name, so every reference saved before the other grips existed reads
     exactly as it always did. */
  const dynKey = (name, g) => (g ? name + '#' + g : name);

  /* What a parameter's drag does to a child, by ACTION — the industry standard's split:
     the parameter decides how the grip moves, the action decides what the
     geometry does about it. Returns the array of extra copies an Array
     action makes (or the one it was handed). */
  const applyBlockAction = (c, r, P, o, copies) => {
    const dx = o.dx || 0, dy = o.dy || 0;
    const at = { x: P.x, y: P.y };
    /* the parameter's own axis, for the actions measured along it */
    let ax = (P.x2 == null) ? 1 : P.x2 - P.x;
    let ay = (P.y2 == null) ? 0 : P.y2 - P.y;
    const axL = Math.hypot(ax, ay) || 1;
    ax /= axL; ay /= axL;
    const along = dx * ax + dy * ay;
    /* the points a stretch is allowed to move: those inside its frame */
    const inFrame = (p) => {
      const f = r.f;
      if (!f) return true;
      return p.x >= Math.min(f.x1, f.x2) && p.x <= Math.max(f.x1, f.x2) &&
             p.y >= Math.min(f.y1, f.y2) && p.y <= Math.max(f.y1, f.y2);
    };
    switch (r.a) {
      case 'stretch':
        for (const p of entityPointRefs(c)) {
          if (inFrame(p)) { p.x += dx; p.y += dy; }
        }
        break;
      case 'polarstretch': {
        /* the in-frame points travel AND turn about the parameter point,
           by the angle the drag swung away from the parameter's own axis */
        const ang = (dx || dy) ? Math.atan2(dy, dx) - Math.atan2(ay, ax) : 0;
        const co = Math.cos(ang), si = Math.sin(ang);
        for (const p of entityPointRefs(c)) {
          if (!inFrame(p)) continue;
          const vx = p.x - at.x, vy = p.y - at.y;
          p.x = at.x + vx * co - vy * si + dx;
          p.y = at.y + vx * si + vy * co + dy;
        }
        break;
      }
      case 'scale': {
        const k = 1 + along / axL;
        if (k > 1e-6 && Math.abs(k - 1) > 1e-9) scaleEntityAbout(c, at, k);
        break;
      }
      case 'rotate': {
        const ang = (o.ang != null) ? o.ang
          : ((dx || dy) ? Math.atan2(dy, dx) - Math.atan2(ay, ax) : 0);
        if (ang) rotateEntityAbout(c, at, ang);
        break;
      }
      case 'flip':
        if (o.flip) {
          mirrorEntity(c, at, (P.x2 == null)
            ? { x: P.x + 1, y: P.y } : { x: P.x2, y: P.y2 });
        }
        break;
      case 'array': {
        /* one extra copy per whole spacing dragged, the industry standard's column count */
        const gap = (r.gap > 0) ? r.gap : axL;
        const n = Math.floor(Math.abs(along) / gap);
        if (n > 0) {
          const sgn = along < 0 ? -1 : 1;
          copies = copies || [];
          for (let i = 1; i <= Math.min(n, 200); i++) {
            const k = cloneData(c);
            translateEntity(k, ax * gap * i * sgn, ay * gap * i * sgn);
            copies.push(k);
          }
        }
        break;
      }
      case 'lookup': break;      /* the tables ship later */
      default:
        if (dx || dy) translateEntity(c, dx, dy);
    }
    return copies;
  };

  const insertEntities = (ent, doc, lod, near) => {
    const d = doc || Nasj.doc;
    const def = d && d.blocks && d.blocks[ent.name];
    if (!def || !Array.isArray(def.entities)) return [];
    /* an unloaded reference keeps its place in the drawing but draws nothing */
    if (def.xref && def.xref.unloaded) return [];
    /* a reference brings its own layer table (see repairXref): the host has
       never heard of these layers, so they are resolved here and nowhere else */
    const xlys = (def.xref && def.xref.layers && def.xref.layers.length)
      ? new Map(def.xref.layers.map(l => [l.id, l])) : null;
    const hid = hiddenLayers(d);
    const met = (lod || near) ? defChildMetrics(def) : null;
    /* a proper similarity — rotation and a positive uniform scale — is the
       placement insertToWorld realizes exactly for every child; under any
       other one only the affine-exact children may be culled */
    const sim = near ? ((isNum(ent.sx) ? ent.sx : 1) === (isNum(ent.sy) ? ent.sy : 1) &&
      (isNum(ent.sx) ? ent.sx : 1) > 0) : false;
    const fn0 = lod ? insertXform(ent, d) : null;
    const out = [];
    /* dynamic blocks: the visibility state this reference shows — its own
       choice, or the definition's first state when it never chose */
    const vstates = def.visibility && Array.isArray(def.visibility.states)
      ? def.visibility.states : null;
    const vis = ent.visState || (vstates && vstates.length ? vstates[0] : null);
    /* the parameters, by name, for this reference's own grip offsets */
    const params = ent.dyn
      ? new Map(def.entities.filter((c) => c && c.type === 'bparam')
          .map((c) => [c.name, c]))
      : null;
    for (let ci = 0; ci < def.entities.length; ci++) {
      const child = def.entities[ci];
      if (!child || child.type === 'insert') continue; /* no nested inserts */
      /* authoring geometry stays in the editor: construction geometry and
         parameters never draw in a reference (BCONSTRUCTION / BPARAMETER) */
      if (child.construction || child.type === 'bparam') continue;
      /* a frozen or switched-off layer hides its geometry inside a
         definition exactly as it hides it out in the drawing */
      if (hid && childHidden(hid, child, ent)) continue;
      /* an entity hidden in this reference's visibility state draws nothing */
      if (vis && Array.isArray(child.hideIn) && child.hideIn.indexOf(vis) >= 0) continue;
      /* the pointer path's cursor-box cull — a dynamic-block grip offset
         shifts the child, so it shifts the box test too */
      if (near && (sim || met.aff[ci])) {
        let dx = 0, dy = 0, skip = false;
        if (ent.dyn && Array.isArray(child.boundTo)) {
          for (const b of child.boundTo) {
            const r = blockActOf(b);
            const o = ent.dyn[dynKey(r.p, r.g)];
            if (!o) continue;
            /* only a whole-child move shifts the box predictably; scale,
               rotate, stretch and array reshape it, so the cull stands
               aside rather than dropping a child that is really there */
            if (r.a && r.a !== 'move') { skip = true; break; }
            dx += o.dx || 0; dy += o.dy || 0;
          }
        }
        if (!skip &&
            (met.maxx[ci] + dx < near.minx || met.minx[ci] + dx > near.maxx ||
             met.maxy[ci] + dy < near.miny || met.miny[ci] + dy > near.maxy)) continue;
      }
      if (lod && met.sz[ci] < lod.minLocal) {
        const q = fn0({ x: met.cx[ci], y: met.cy[ci] });
        /* the dot dims with the child's true size (1 at the threshold) so
           zooming never steps the block's luminance — a full-strength dot
           for a far-sub-pixel child reads brighter than the geometry it
           stands in for */
        q.a = met.sz[ci] / lod.minLocal;
        lod.dots.push(q);
        continue;
      }
      /* a reference layer switched off draws nothing */
      const xly = xlys ? xlys.get(child.layerId) : null;
      if (xly && xly.on === false) continue;
      const c = cloneData(child);
      /* ByLayer inside a reference means the REFERENCE's layer colour */
      if (xly && (!c.color || c.color === 'ByLayer')) c.color = xly.color;
      /* an attribute draws the value this reference was given, not its tag,
         and an invisible one draws nothing at all */
      if (c.type === 'attdef') {
        if (c.invisible) continue;
        const vals = ent.attrs && typeof ent.attrs === 'object' ? ent.attrs : {};
        const v = c.constant ? c.dflt
          : (Object.prototype.hasOwnProperty.call(vals, c.tag) ? vals[c.tag] : c.dflt);
        c.type = 'text';
        c.str = String(v == null ? '' : v);
        delete c.tag; delete c.prompt; delete c.dflt;
        delete c.invisible; delete c.constant; delete c.verify; delete c.preset;
        if (c.str === '') continue;
      }
      /* a bound ACTION: the parameter's grip says how far it was dragged,
         and the action says what that does to this child */
      let copies = null;
      if (ent.dyn && Array.isArray(c.boundTo)) {
        for (const b of c.boundTo) {
          const r = blockActOf(b);
          const o = ent.dyn[dynKey(r.p, r.g)];
          const P = params && params.get(r.p);
          if (!o || !P) continue;
          copies = applyBlockAction(c, r, P, o, copies);
        }
      }
      out.push(c);
      if (copies) for (const k of copies) out.push(k);
    }
    return insertToWorld(ent, out, d);
  };

  /* ---------------- MLINE (SPEC2 Â§15) ----------------
   * One object holding the path that was picked plus its style. STANDARD is
   * two elements half a unit either side of the axis; `just` says which of
   * them the path runs along and `scale` multiplies the spacing, so with
   * STANDARD the scale IS the gap between the two lines. The parallel lines
   * are DERIVED, never stored — which is what makes the whole shape one
   * object: move a vertex and both lines follow. */
  const MLINE_OFFSETS = [0.5, -0.5];
  const MLINE_JUST = ['Top', 'Zero', 'Bottom'];
  const mlineOffsets = (ent) => {
    const s = isNum(ent.scale) ? ent.scale : 1;
    const hi = Math.max.apply(null, MLINE_OFFSETS);
    const lo = Math.min.apply(null, MLINE_OFFSETS);
    const base = ent.just === 'Zero' ? 0 : (ent.just === 'Bottom' ? lo : hi);
    return MLINE_OFFSETS.map(o => (o - base) * s);
  };
  /* where two straight lines cross, or null when they run parallel */
  const lineCross = (p1, p2, p3, p4) => {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (Math.abs(d) < 1e-12) return null;
    const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
  };
  /* one element: the path pushed sideways by a signed distance (positive is
     left of the direction of travel), corners mitered where segments meet */
  const mlineOffsetPts = (pts, d, closed) => {
    const n = pts.length;
    const segCount = closed ? n : n - 1;
    const offs = [];
    for (let i = 0; i < segCount; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      if (L < 1e-12) continue;
      const nx = -dy / L * d, ny = dx / L * d;
      offs.push({ a: { x: a.x + nx, y: a.y + ny }, b: { x: b.x + nx, y: b.y + ny } });
    }
    const m = offs.length;
    if (!m) return null;
    const corner = (p, q) => lineCross(p.a, p.b, q.a, q.b) ||
      { x: (p.b.x + q.a.x) / 2, y: (p.b.y + q.a.y) / 2 };
    const out = [];
    if (closed) {
      for (let i = 0; i < m; i++) out.push(corner(offs[(i - 1 + m) % m], offs[i]));
    } else {
      out.push({ x: offs[0].a.x, y: offs[0].a.y });
      for (let i = 1; i < m; i++) out.push(corner(offs[i - 1], offs[i]));
      out.push({ x: offs[m - 1].b.x, y: offs[m - 1].b.y });
    }
    return out;
  };
  /* MLEDIT end caps: ent.capS / ent.capE remember, as an angle CCW from the
     end's own tangent, the line that end was trimmed along — the face of the
     wall a tee stops on, or a corner's miter. The element lines slide along
     that line instead of ending squarely across the path, which is what puts
     a skew tee ON the face and lets two corner-joined runs meet without a
     notch. Relative to the tangent, so the entity moves and turns freely;
     absent (or Ï€/2) is the plain square end. */
  const capMlineEnds = (ent, path, els) => {
    const one = (ang, anchor, tx, ty, atStart) => {
      /* a cap nearly along the path would throw the miter to infinity */
      if (!isNum(ang) || ang < 0.05 || ang > Math.PI - 0.05) return;
      if (Math.abs(ang - Math.PI / 2) < 1e-9) return;
      const far = {
        x: anchor.x + Math.cos(ang) * tx - Math.sin(ang) * ty,
        y: anchor.y + Math.sin(ang) * tx + Math.cos(ang) * ty,
      };
      for (const el of els) {
        const q = el.pts;
        const i = atStart ? 0 : q.length - 1;
        const k = atStart ? 1 : q.length - 2;
        const hit = lineCross(q[k], q[i], anchor, far);
        if (hit) q[i] = { x: hit.x, y: hit.y };
      }
    };
    const n = path.length;
    let dx = path[1].x - path[0].x, dy = path[1].y - path[0].y;
    let L = Math.hypot(dx, dy) || 1;
    one(ent.capS, path[0], dx / L, dy / L, true);
    dx = path[n - 1].x - path[n - 2].x;
    dy = path[n - 1].y - path[n - 2].y;
    L = Math.hypot(dx, dy) || 1;
    one(ent.capE, path[n - 1], dx / L, dy / L, false);
  };

  /* the elements as MLEDIT sees them: whole, uncut, one per style offset */
  const mlineElements = (ent) => {
    const pts = ent.pts || [];
    if (pts.length < 2) return [];
    const closed = !!ent.closed;
    const out = [];
    for (const d of mlineOffsets(ent)) {
      const p = mlineOffsetPts(pts, d, closed);
      if (p && p.length >= 2) out.push({ type: 'polyline', pts: p, closed });
    }
    if (!closed && out.length && (isNum(ent.capS) || isNum(ent.capE))) {
      capMlineEnds(ent, pts, out);
    }
    return out;
  };

  /* ---- cuts (MLEDIT) ----
   * ent.cuts = [{el, s, e}] — a gap in element `el`, from distance s to e
   * measured along that element from its start. Cut All simply writes one
   * entry per element. Everything downstream reads the SPANS that survive. */
  const cumLen = (p, closed) => {
    const n = p.length, m = closed ? n : n - 1;
    const L = [0];
    for (let i = 0; i < m; i++) L.push(L[i] + dist(p[i], p[(i + 1) % n]));
    return L;
  };
  const atLen = (p, L, closed, d) => {   /* the point d along the element */
    const n = p.length, total = L[L.length - 1];
    const t = Math.max(0, Math.min(total, d));
    let i = 0;
    while (i + 1 < L.length && L[i + 1] < t) i++;
    const seg = L[i + 1] - L[i];
    const f = seg > 1e-12 ? (t - L[i]) / seg : 0;
    const a = p[i], b = p[(i + 1) % n];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, i, f };
  };
  /* how far along an element a world point falls, and how far off it is */
  const mlineProject = (part, q) => {
    const p = part.pts, n = p.length, closed = !!part.closed;
    const L = cumLen(p, closed), m = closed ? n : n - 1;
    let best = { d: Infinity, at: 0 };
    for (let i = 0; i < m; i++) {
      const a = p[i], b = p[(i + 1) % n];
      const c = closestPointOnSeg(q, a, b);
      const dd = dist(q, c);
      if (dd < best.d) best = { d: dd, at: L[i] + dist(a, c) };
    }
    return best;
  };
  /* the pieces of one element left after its cuts */
  const cutSpans = (part, cuts) => {
    const p = part.pts, closed = !!part.closed;
    const L = cumLen(p, closed), total = L[L.length - 1];
    const gaps = cuts
      .map(c => [Math.max(0, Math.min(c.s, c.e)), Math.min(total, Math.max(c.s, c.e))])
      .filter(g => g[1] - g[0] > 1e-9)
      .sort((a, b) => a[0] - b[0]);
    if (!gaps.length) return [part];
    /* merge overlapping gaps, then keep what is between them */
    const merged = [gaps[0].slice()];
    for (const g of gaps.slice(1)) {
      const last = merged[merged.length - 1];
      if (g[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], g[1]);
      else merged.push(g.slice());
    }
    const keep = [];
    let at = 0;
    for (const g of merged) { if (g[0] - at > 1e-9) keep.push([at, g[0]]); at = g[1]; }
    if (total - at > 1e-9) keep.push([at, total]);
    /* a cut ring opens up: its two loose ends join across the seam */
    if (closed && keep.length > 1 && keep[0][0] < 1e-9 &&
        Math.abs(keep[keep.length - 1][1] - total) < 1e-9) {
      const head = keep.shift();
      keep[keep.length - 1] = [keep[keep.length - 1][0], total + head[1]];
    }
    const n = p.length;
    const out = [];
    for (const [s, e] of keep) {
      const A = atLen(p, L, closed, s > total ? s - total : s);
      const pts = [{ x: A.x, y: A.y }];
      for (let i = A.i + 1; L[i] !== undefined && L[i] < Math.min(e, total) - 1e-9; i++) {
        pts.push({ x: p[i % n].x, y: p[i % n].y });
      }
      if (e > total) {                    /* wrapped past the seam */
        for (let i = 0; L[i] !== undefined && L[i] < e - total - 1e-9; i++) {
          pts.push({ x: p[i % n].x, y: p[i % n].y });
        }
      }
      const B = atLen(p, L, closed, e > total ? e - total : e);
      pts.push({ x: B.x, y: B.y });
      if (pts.length >= 2) out.push({ type: 'polyline', pts, closed: false });
    }
    return out;
  };
  /* the parallel lines an mline stands for — what is actually drawn */
  const mlineParts = (ent) => {
    const els = mlineElements(ent);
    const cuts = Array.isArray(ent.cuts) ? ent.cuts : null;
    if (!cuts || !cuts.length) return els;
    const out = [];
    els.forEach((part, i) => {
      out.push(...cutSpans(part, cuts.filter(c => c.el === i)));
    });
    return out;
  };

  /* polyline approximation of an entity outline as an array of points (open or ring) */
  const entityPolyPoints = (ent, tol) => {
    switch (ent.type) {
      case 'line': return { pts: [ent.a, ent.b], closed: false };
      case 'polyline': return polylinePoints(ent);
      /* construction lines run "forever": a span long enough that its ends
         never show, short enough that the math stays exact */
      case 'xline': {
        const L = 1e6;
        const a = ent.ray ? { x: ent.p.x, y: ent.p.y }
          : { x: ent.p.x - ent.d.x * L, y: ent.p.y - ent.d.y * L };
        return { pts: [a, { x: ent.p.x + ent.d.x * L, y: ent.p.y + ent.d.y * L }], closed: false };
      }
      /* the justification path — the elements are separate rings, so anything
         that needs them all asks entitySegs instead */
      case 'mline': return { pts: (ent.pts || []).slice(), closed: !!ent.closed };
      case 'circle': {
        const pts = [];
        for (let i = 0; i < SAMPLES; i++) pts.push(arcPoint(ent, TAU * i / SAMPLES));
        return { pts, closed: true };
      }
      case 'arc': {
        const s = arcSweep(ent.a0, ent.a1), pts = [];
        for (let i = 0; i <= SAMPLES; i++) pts.push(arcPoint(ent, ent.a0 + s * i / SAMPLES));
        return { pts, closed: false };
      }
      case 'ellipse': {
        const n = ellipseSamples(ent, tol), pts = [];
        /* a swept one is an open run from a0 through a1; a full one closes */
        if (ellipseIsArc(ent)) {
          const s = ellipseSweep(ent);
          for (let i = 0; i <= n; i++) pts.push(ellipsePoint(ent, ent.a0 + s * i / n));
          return { pts, closed: false };
        }
        for (let i = 0; i < n; i++) pts.push(ellipsePoint(ent, TAU * i / n));
        return { pts, closed: true };
      }
      case 'attdef':
      case 'text': return { pts: textCorners(ent), closed: true };
      case 'point': return { pts: [ent.p], closed: false };
      /* a light is its source, and for the aimed kinds the line it aims along */
      case 'light': return { pts: ent.tgt ? [ent.p, ent.tgt] : [ent.p], closed: false };
      /* arctext stands in the radial band its letters occupy */
      case 'arctext': return { pts: arctextRing(ent), closed: true };
      case 'spline': return splinePoints(ent);
      case 'hatch': return entityPolyPoints(hatchBoundary(ent), tol);
      /* 3D types project to their xy footprint for 2D hit/rect tests */
      case 'face3d': return { pts: ent.pts.slice(), closed: true };
      case 'box': return { pts: boxBase(ent), closed: true };
      /* a body's outline: its first footprint ring (a wall's outer side, a
         slab's edge); the hit test walks every ring */
      case 'solid': case 'wall': case 'slab': {
        const r = Nasj.solid.footprint(ent);
        return { pts: r.length ? r[0].slice() : [], closed: true };
      }
      case 'image': return { pts: imageCorners(ent), closed: true };
      default: return { pts: [], closed: false };
    }
  };

  /* segments [p,q] of the outline (used by rect tests) */
  const entitySegs = (ent, tol) => {
    switch (ent.type) {
      case 'dim':
      case 'leader':
      case 'table':
        return annoSegList(entityAnno(ent));
      case 'insert': {
        const segs = [];
        for (const c of insertEntities(ent)) segs.push(...entitySegs(c, tol));
        return segs;
      }
      case 'mline': {                 /* every element, as one run of segments */
        const segs = [];
        for (const part of mlineParts(ent)) segs.push(...entitySegs(part, tol));
        return segs;
      }
      default: {
        const { pts, closed } = entityPolyPoints(ent, tol);
        const segs = [];
        for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
        if (closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
        return segs;
      }
    }
  };

  /* ---------------- bounds ---------------- */
  const entityBounds = (ent) => {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    const take = (p) => {
      if (p.x < minx) minx = p.x;
      if (p.y < miny) miny = p.y;
      if (p.x > maxx) maxx = p.x;
      if (p.y > maxy) maxy = p.y;
    };
    switch (ent.type) {
      case 'line': take(ent.a); take(ent.b); break;
      case 'polyline': polylinePoints(ent).pts.forEach(take); break;
      case 'mline': for (const part of mlineParts(ent)) part.pts.forEach(take); break;
      /* a construction line never widens the drawing's extents */
      case 'xline': take(ent.p); break;
      case 'circle':
        take({ x: ent.c.x - ent.r, y: ent.c.y - ent.r });
        take({ x: ent.c.x + ent.r, y: ent.c.y + ent.r });
        break;
      case 'arc': {
        take(arcPoint(ent, ent.a0));
        take(arcPoint(ent, ent.a1));
        for (const q of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
          if (angleInArc(q, ent.a0, ent.a1)) take(arcPoint(ent, q));
        }
        break;
      }
      case 'ellipse': {
        /* a swept one is bounded by the run it actually draws, not by the
           whole ellipse it was cut from */
        if (ellipseIsArc(ent)) {
          for (const p of entitySegs(ent).flat()) take(p);
          break;
        }
        const rot = ent.rot || 0;
        const co = Math.cos(rot), si = Math.sin(rot);
        const ex = Math.sqrt((ent.rx * co) ** 2 + (ent.ry * si) ** 2);
        const ey = Math.sqrt((ent.rx * si) ** 2 + (ent.ry * co) ** 2);
        take({ x: ent.c.x - ex, y: ent.c.y - ey });
        take({ x: ent.c.x + ex, y: ent.c.y + ey });
        break;
      }
      case 'attdef':
      case 'text': textCorners(ent).forEach(take); break;
      case 'image': imageCorners(ent).forEach(take); break;
      case 'point': take(ent.p); break;
      case 'light': take(ent.p); if (ent.tgt) take(ent.tgt); break;
      case 'arctext': arctextRing(ent).forEach(take); break;
      case 'hatch': {
        const bb = entityBounds(hatchBoundary(ent));
        take({ x: bb.minx, y: bb.miny });
        take({ x: bb.maxx, y: bb.maxy });
        break;
      }
      case 'spline': splinePoints(ent).pts.forEach(take); break;
      case 'dim':
      case 'leader':
      case 'table': {
        const G = entityAnno(ent);
        for (const [a, b] of G.segs) { take(a); take(b); }
        for (const A of G.arcs) {
          const bb = entityBounds({ type: 'arc', c: A.c, r: A.r, a0: A.a0, a1: A.a1 });
          take({ x: bb.minx, y: bb.miny });
          take({ x: bb.maxx, y: bb.maxy });
        }
        for (const tri of G.arrows) tri.forEach(take);
        for (const t of G.texts) annoTextCorners(t).forEach(take);
        if (ent.type === 'dim') {
          take(ent.p1); take(ent.p2);
          if (ent.kind === 'angular' && isPt(ent.p4)) take(ent.p4);
        }
        break;
      }
      case 'insert': {
        /* A reference is boxed by the geometry it MATERIALIZES, the way
           the industry standard boxes one — the insertion point does not widen it. A
           block whose definition sits megaunits from its base (a symbol
           lifted out of a georeferenced survey) is placed by a point
           nowhere near what it draws, and taking that point made ZOOM
           EXTENTS frame a million units of empty ground: this file put
           the box at [-833099,-1181000] for a chair the industry standard frames at
           [310,72]. A reference that materializes nothing still stands at
           its point (see the fallback below). */
        /* a clip crops what the reference shows, so it crops its extents too —
           otherwise ZOOM EXTENTS frames geometry the clip has hidden */
        const clip = insertClipWorld(ent);
        /* FAST PATH: a square placement (rotation a multiple of 90Â°) of a
           plain definition takes the def's LOCAL bounds — computed once and
           cached on the definition — through the insert transform. Exact,
           and O(1) per reference where the walk below materializes every
           child: a block library's six thousand references cost
           milliseconds per extents instead of seconds. */
        if (!clip) {
          const d0 = Nasj.doc;
          const def0 = d0 && d0.blocks && d0.blocks[ent.name];
          const rot0 = ent.rot || 0;
          const si0 = Math.sin(rot0), co0 = Math.cos(rot0);
          if (def0 && !def0.xref && Array.isArray(def0.entities) &&
              (Math.abs(si0) < 1e-9 || Math.abs(co0) < 1e-9)) {
            /* what a hidden layer hides is not measured either, so the box
               is cached against the hidden roll that made it */
            const hid0 = hiddenLayers(d0);
            let lb = def0.__lb;
            if (!lb || lb.ents !== def0.entities || lb.n !== def0.entities.length ||
                lb.hid !== hid0) {
              lb = { ents: def0.entities, n: def0.entities.length, hid: hid0, att: false,
                minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
              for (const c0 of def0.entities) {
                if (!c0) continue;
                /* per-reference attribute values change the picture — a def
                   that carries any falls back to the full walk for good */
                if (c0.type === 'attdef') { lb.att = true; break; }
                if (c0.type === 'insert') continue;
                if (childHidden(hid0, c0, null)) continue;
                const bb = entityBounds(c0);
                if (!bb || !isFinite(bb.minx)) continue;
                if (bb.minx < lb.minx) lb.minx = bb.minx;
                if (bb.miny < lb.miny) lb.miny = bb.miny;
                if (bb.maxx > lb.maxx) lb.maxx = bb.maxx;
                if (bb.maxy > lb.maxy) lb.maxy = bb.maxy;
              }
              /* non-enumerable: the cache must never ride into a saved file */
              Object.defineProperty(def0, '__lb',
                { value: lb, writable: true, configurable: true });
            }
            if (!lb.att && isFinite(lb.minx)) {
              const sx0 = isNum(ent.sx) ? ent.sx : 1;
              const sy0 = isNum(ent.sy) ? ent.sy : 1;
              const b0 = isPt(def0.base) ? def0.base : { x: 0, y: 0 };
              for (const [qx, qy] of [[lb.minx, lb.miny], [lb.maxx, lb.miny],
                [lb.minx, lb.maxy], [lb.maxx, lb.maxy]]) {
                const lx = (qx - b0.x) * sx0, ly = (qy - b0.y) * sy0;
                take({ x: ent.p.x + lx * co0 - ly * si0,
                  y: ent.p.y + lx * si0 + ly * co0 });
              }
              break;
            }
          }
        }
        const box = clip && !clip.inverted
          ? clip.pts.reduce((b, q) => ({
            minx: Math.min(b.minx, q.x), miny: Math.min(b.miny, q.y),
            maxx: Math.max(b.maxx, q.x), maxy: Math.max(b.maxy, q.y)
          }), { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity })
          : null;
        for (const c of insertEntities(ent)) {
          const bb = entityBounds(c);
          const lo = { x: bb.minx, y: bb.miny }, hi = { x: bb.maxx, y: bb.maxy };
          if (box) {
            lo.x = Math.max(lo.x, box.minx); lo.y = Math.max(lo.y, box.miny);
            hi.x = Math.min(hi.x, box.maxx); hi.y = Math.min(hi.y, box.maxy);
            if (lo.x > hi.x || lo.y > hi.y) continue; /* clipped away entirely */
          }
          take(lo); take(hi);
        }
        /* Nothing drawn: an empty definition still stands at its point. One
           whose geometry a hidden layer took away stands nowhere — the industry standard
           passes such a reference over entirely (ZOOM Object on it is a
           no-op and it is absent from EXTMIN/EXTMAX), and taking its point
           held this drawing's extents at x=566 where the industry standard says 438. */
        if (!isFinite(minx)) {
          const dh = Nasj.doc;
          const hidz = hiddenLayers(dh);
          const dfh = hidz && dh && dh.blocks && dh.blocks[ent.name];
          if (!(dfh && Array.isArray(dfh.entities) &&
                dfh.entities.some((c0) => c0 && childHidden(hidz, c0, ent)))) take(ent.p);
        }
        break;
      }
      case 'face3d': ent.pts.forEach(take); break;   /* projected (xy) pts */
      case 'box': boxBase(ent).forEach(take); break; /* xy footprint */
      case 'solid': case 'wall': case 'slab':
        for (const r of Nasj.solid.footprint(ent)) r.forEach(take);
        break;
      default: take({ x: 0, y: 0 });
    }
    if (!isFinite(minx)) { minx = miny = maxx = maxy = 0; }
    return { minx, miny, maxx, maxy };
  };

  /* ---------------- hit testing ---------------- */
  const entityHitTest = (ent, p, tol) => {
    switch (ent.type) {
      case 'line': return distToSeg(p, ent.a, ent.b) <= tol;
      case 'polyline': {
        /* a constant-width polyline is hittable across its band */
        const t = (isNum(ent.w) && ent.w > 0) ? tol + ent.w / 2 : tol;
        for (const [a, b] of entitySegs(ent)) if (distToSeg(p, a, b) <= t) return true;
        return false;
      }
      /* any element answers for the whole object — pick one line, get the shape */
      case 'mline':
        for (const [a, b] of entitySegs(ent)) if (distToSeg(p, a, b) <= tol) return true;
        return false;
      case 'xline':
        for (const [a, b] of entitySegs(ent)) if (distToSeg(p, a, b) <= tol) return true;
        return false;
      case 'circle': return Math.abs(dist(p, ent.c) - ent.r) <= tol;
      case 'arc': {
        const d = dist(p, ent.c);
        if (Math.abs(d - ent.r) > tol) return false;
        if (d < EPS) return ent.r <= tol;
        return angleInArc(Math.atan2(p.y - ent.c.y, p.x - ent.c.x), ent.a0, ent.a1) ||
               dist(p, arcPoint(ent, ent.a0)) <= tol ||
               dist(p, arcPoint(ent, ent.a1)) <= tol;
      }
      case 'ellipse': {
        for (const [a, b] of entitySegs(ent, tol)) if (distToSeg(p, a, b) <= tol) return true;
        return false;
      }
      case 'attdef':
      case 'text': {
        const L = textLayout(ent);
        const q = rotatePoint(p, L.anchor, -(ent.rot || 0));
        const dx = q.x - L.anchor.x - L.dx, dy = q.y - L.anchor.y - L.dy;
        return dx >= -tol && dx <= L.w + tol && dy >= -tol && dy <= L.h + tol;
      }
      case 'point': return dist(p, ent.p) <= tol;
      /* a light is picked by its glyph, so a distant light cannot be picked
         from the drawing at all — it draws none. The Lights in Model palette
         is the only way to reach one, which is what the industry standard's own note on
         that palette says. */
      case 'light': return ent.lkind !== 'distant' && dist(p, ent.p) <= tol;
      /* arctext is picked anywhere in the band its letters occupy */
      case 'arctext': {
        const { ri, ro } = arctextRadii(ent);
        const d = dist(p, ent.c);
        if (d < ri - tol || d > ro + tol) return false;
        const t = Math.atan2(p.y - ent.c.y, p.x - ent.c.x);
        return angleInArc(t, ent.a0, ent.a1);
      }
      case 'image': {
        /* picked anywhere inside its frame, the way the industry standard picks one */
        const q = rotatePoint(p, ent.p, -(ent.rot || 0));
        const fy = ent.fy === -1 ? -1 : 1;
        const dx = q.x - ent.p.x;
        const dy = (q.y - ent.p.y) * fy;
        return dx >= -tol && dx <= ent.w + tol && dy >= -tol && dy <= ent.h + tol;
      }
      case 'hatch': {
        /* a hatch is picked anywhere inside it, whatever the pattern — the
           filled area IS the object. Nasj.tools.hitAt tries hatches last so a
           hatch never steals a click from what is drawn over it. */
        if (entityHitTest(hatchBoundary(ent), p, tol)) return true;
        return pointInBoundary(ent, p);
      }
      case 'spline': {
        for (const [a, b] of entitySegs(ent, tol)) if (distToSeg(p, a, b) <= tol) return true;
        return false;
      }
      case 'dim':
      case 'leader': {
        const G = entityAnno(ent);
        for (const [a, b] of G.segs) if (distToSeg(p, a, b) <= tol) return true;
        for (const A of G.arcs) {
          if (Math.abs(dist(p, A.c) - A.r) <= tol &&
              angleInArc(Math.atan2(p.y - A.c.y, p.x - A.c.x), A.a0, A.a1)) return true;
        }
        for (const tri of G.arrows) {
          if (distToSeg(p, tri[0], tri[1]) <= tol || distToSeg(p, tri[1], tri[2]) <= tol ||
              distToSeg(p, tri[2], tri[0]) <= tol) return true;
        }
        for (const t of G.texts) if (pointInTextBox(t, p, tol)) return true;
        return false;
      }
      case 'table': {
        const cs = tableCorners(ent); /* on/inside the outer rect */
        return p.x >= cs[0].x - tol && p.x <= cs[1].x + tol &&
               p.y <= cs[0].y + tol && p.y >= cs[2].y - tol;
      }
      case 'insert': {
        /* HOVER OVER A LIBRARY BLOCK. A reference answers a pick only through
           a child, and a child only when the pick point is within tol of its
           own geometry — so only the children whose box reaches the pick box
           can answer at all. Expanding the rest (each one cloned and
           transformed) is what made one mouse move over a 60,000-child block
           cost tens of milliseconds. SQRT2: the text and frame tests measure
           tol along their OWN rotated axes, which reaches a corner that much
           further out than an axis-aligned box of tol would. */
        const t2 = tol * Math.SQRT2;
        const kids = insertEntities(ent, null, null, insertLocalBox(ent,
          { minx: p.x - t2, miny: p.y - t2, maxx: p.x + t2, maxy: p.y + t2 }));
        if (!kids.length) {
          /* Nothing in reach. The only answer the unclipped walk could still
             give is the insertion point of a reference that materializes
             nothing at all — and that one is only reachable from within tol
             of the insertion point itself, so the full expansion is paid
             there and only there, and only when the definition is one a
             reference can empty out. */
          if (!(dist(p, ent.p) <= tol)) return false;
          const d0 = Nasj.doc;
          const def0 = d0 && d0.blocks && d0.blocks[ent.name];
          if (!def0 || !Array.isArray(def0.entities)) return true;
          const m0 = defChildMetrics(def0);
          if (!m0.mat) return true;
          return m0.perRef ? !insertEntities(ent).length : false;
        }
        /* clipped-away geometry is not drawn, so it cannot be picked either */
        if (!insertClipAccepts(insertClipWorld(ent), p)) return false;
        return kids.some(c => entityHitTest(c, p, tol));
      }
      case 'face3d':
      case 'box': { /* hit on the projected (xy) outline */
        for (const [a, b] of entitySegs(ent, tol)) if (distToSeg(p, a, b) <= tol) return true;
        return false;
      }
      case 'solid': case 'wall': case 'slab': { /* any ring of the footprint */
        for (const r of Nasj.solid.footprint(ent)) {
          for (let i = 0, n = r.length; i < n; i++) {
            if (distToSeg(p, r[i], r[(i + 1) % n]) <= tol) return true;
          }
        }
        return false;
      }
      default: return false;
    }
  };

  /* ---------------- rect (window / crossing) tests ---------------- */
  const normRect = (r) => {
    if (r && typeof r.minx === 'number') {
      return {
        minx: Math.min(r.minx, r.maxx), miny: Math.min(r.miny, r.maxy),
        maxx: Math.max(r.minx, r.maxx), maxy: Math.max(r.miny, r.maxy)
      };
    }
    const a = r.a, b = r.b;
    return {
      minx: Math.min(a.x, b.x), miny: Math.min(a.y, b.y),
      maxx: Math.max(a.x, b.x), maxy: Math.max(a.y, b.y)
    };
  };

  const ptInRect = (p, r) =>
    p.x >= r.minx - EPS && p.x <= r.maxx + EPS && p.y >= r.miny - EPS && p.y <= r.maxy + EPS;

  const segSegIntersect = (p1, p2, p3, p4) => {
    const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
    const den = d1x * d2y - d1y * d2x;
    const ex = p3.x - p1.x, ey = p3.y - p1.y;
    if (Math.abs(den) < EPS) {
      /* parallel: touch only if collinear and overlapping projections */
      if (Math.abs(ex * d1y - ey * d1x) > 1e-7) return false;
      const L2 = d1x * d1x + d1y * d1y;
      if (L2 < EPS) return dist(p1, p3) < 1e-7 || dist(p1, p4) < 1e-7;
      const t3 = (ex * d1x + ey * d1y) / L2;
      const t4 = ((p4.x - p1.x) * d1x + (p4.y - p1.y) * d1y) / L2;
      return Math.max(Math.min(t3, t4), 0) <= Math.min(Math.max(t3, t4), 1) + EPS;
    }
    const t = (ex * d2y - ey * d2x) / den;
    const u = (ex * d1y - ey * d1x) / den;
    return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS;
  };

  const segIntersectsRect = (a, b, r) => {
    if (ptInRect(a, r) || ptInRect(b, r)) return true;
    const c1 = { x: r.minx, y: r.miny }, c2 = { x: r.maxx, y: r.miny };
    const c3 = { x: r.maxx, y: r.maxy }, c4 = { x: r.minx, y: r.maxy };
    return segSegIntersect(a, b, c1, c2) || segSegIntersect(a, b, c2, c3) ||
           segSegIntersect(a, b, c3, c4) || segSegIntersect(a, b, c4, c1);
  };

  const entityInRect = (ent, r, crossing) => {
    const rr = normRect(r);
    /* a construction line is never wholly inside a window, so only a
       crossing selection can take it — where the line runs through */
    if (ent.type === 'xline') {
      if (!crossing) return false;
      return entitySegs(ent).some(([p, q]) => segIntersectsRect(p, q, rr));
    }
    /* a light is taken by its glyph, so a distant light — which draws none —
       is out of reach of any window, however far the window is thrown around
       it. Its bounds run to its target, which is not a thing on the screen,
       so this has to answer before `inside` below ever looks at them. */
    if (ent.type === 'light') {
      return ent.lkind !== 'distant' && ptInRect(ent.p, rr);
    }
    const b = entityBounds(ent);
    const inside = b.minx >= rr.minx && b.maxx <= rr.maxx &&
                   b.miny >= rr.miny && b.maxy <= rr.maxy;
    if (!crossing) return inside;
    if (inside) return true;
    if (b.maxx < rr.minx || b.minx > rr.maxx || b.maxy < rr.miny || b.miny > rr.maxy) return false;
    if (ent.type === 'point') return ptInRect(ent.p, rr);
    const segTol = Math.max(rr.maxx - rr.minx, rr.maxy - rr.miny) / 64;
    return entitySegs(ent, segTol).some(([p, q]) => segIntersectsRect(p, q, rr));
  };

  /* ---------------- snap points ---------------- */
  /* area centroid of a closed polygon (geometric-center osnap) */
  const polyCentroid = (pts) => {
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const cr = p.x * q.y - q.x * p.y;
      A += cr;
      cx += (p.x + q.x) * cr;
      cy += (p.y + q.y) * cr;
    }
    if (Math.abs(A) < 1e-12) { /* degenerate: average the vertices */
      let sx = 0, sy = 0;
      for (const p of pts) { sx += p.x; sy += p.y; }
      return { x: sx / pts.length, y: sy / pts.length };
    }
    return { x: cx / (3 * A), y: cy / (3 * A) };
  };

  /* a reference's parameter grips: one per point each BPARAMETER of its
     definition defines (both ends of a measuring parameter, all four
     corners of an XY one), plus the Block Properties Table's lookup grip
     at the top right of the block's extents — shared by the snap table
     and the grip table */
  const insertParamGrips = (ent) => {
    const out = [];
    const d0 = Nasj.doc;
    const def0 = d0 && d0.blocks && d0.blocks[ent.name];
    if (def0 && Array.isArray(def0.entities)) {
      const fn = insertXform(ent, d0);
      for (const ch of def0.entities) {
        if (!ch || ch.type !== 'bparam') continue;
        for (const gp of paramGrips(ch)) {
          const o = (ent.dyn && ent.dyn[dynKey(ch.name, gp.g)]) || null;
          const q = fn({ x: gp.x + (o ? o.dx || 0 : 0),
            y: gp.y + (o ? o.dy || 0 : 0) });
          out.push({ x: q.x, y: q.y, kind: 'param', param: ch.name, g: gp.g });
        }
      }
      if (def0.btable && (def0.btable.rows || []).length) {
        let mx = -Infinity, my = -Infinity;
        for (const ch of def0.entities) {
          if (!ch || ch.type === 'bparam') continue;
          const b = entityBounds(ch);
          if (!b) continue;
          if (b.maxx > mx) mx = b.maxx;
          if (b.maxy > my) my = b.maxy;
        }
        if (isFinite(mx) && isFinite(my)) {
          const q = fn({ x: mx, y: my });
          out.push({ x: q.x, y: q.y, kind: 'param', param: '@btable' });
        }
      }
    }
    return out;
  };

  /* GRIPS are not snaps. The industry standard grips a block reference at its insertion
     point (+ its parameter grips), never at its children's endpoints —
     those stay reachable by OSNAP (entitySnapPoints expands the children,
     which is what lets MOVE snap onto a wall inside a block), but they are
     not grab handles: a library part selected whole must read as ONE
     object with one square, not lines full of grips (measured on
     BLOCKS.dwg: one furniture insert carried 39,668 child grips).
     Every other type's grips ARE its snap points. */
  const entityGripPoints = (ent) => {
    if (ent.type !== 'insert') return entitySnapPoints(ent);
    const sp = { x: ent.p.x, y: ent.p.y, kind: 'end' };
    if (isNum(ent.p.z) && ent.p.z !== 0) sp.z = ent.p.z;
    return [sp].concat(insertParamGrips(ent));
  };

  /* near (optional): a world-space cursor box from the osnap path. Only a
     reference minds it — children beyond its reach are not expanded. Every
     caller without it (grips, selection) keeps the full set. */
  const entitySnapPoints = (ent, near) => {
    const out = [];
    const push = (p, kind) => { /* optional z rides along (3D grip display) */
      const sp = { x: p.x, y: p.y, kind };
      if (isNum(p.z) && p.z !== 0) sp.z = p.z;
      out.push(sp);
    };
    switch (ent.type) {
      case 'line':
        /* the midpoint of a line that climbs is halfway UP it too: a 2D
           midpoint puts the marker on the ground under the line, where
           nothing is, and a vertical line's midpoint on its own base */
        push(ent.a, 'end'); push(ent.b, 'end'); push(mid3(ent.a, ent.b), 'mid');
        break;
      /* a construction line offers its base point; 'nea' rides the line */
      case 'xline': push(ent.p, 'node'); break;
      /* you snap to the lines you can see, not to the justification path */
      case 'mline':
        for (const part of mlineParts(ent)) {
          const q = part.pts, n = q.length;
          q.forEach(v => push(v, 'end'));
          const m = part.closed ? n : n - 1;
          for (let i = 0; i < m; i++) push(mid(q[i], q[(i + 1) % n]), 'mid');
        }
        break;
      case 'polyline': {
        const pts = ent.pts;
        pts.forEach(p => push(p, 'end'));
        const segMid = (a, b) => {         /* arc midpoint on bulged segments */
          const A = segHasBulge(a) ? bulgeArc(a, b, a.b) : null;
          const m = A ? bulgeArcPoint(A, 0.5) : mid(a, b);
          /* a segment through heights carries its midpoint halfway up too */
          if (isNum(a.z) || isNum(b.z)) {
            m.z = ((isNum(a.z) ? a.z : 0) + (isNum(b.z) ? b.z : 0)) / 2;
          }
          return m;
        };
        for (let i = 0; i + 1 < pts.length; i++) push(segMid(pts[i], pts[i + 1]), 'mid');
        if (ent.closed && pts.length > 2) {
          push(segMid(pts[pts.length - 1], pts[0]), 'mid');
          const gc = polyCentroid(polylinePoints(ent).pts);
          if (pts.some((p) => isNum(p.z))) {
            gc.z = pts.reduce((s2, p) => s2 + (isNum(p.z) ? p.z : 0), 0) / pts.length;
          }
          push(gc, 'gcen');
        }
        break;
      }
      case 'circle':
        push(ent.c, 'center');
        push({ x: ent.c.x + ent.r, y: ent.c.y }, 'quad');
        push({ x: ent.c.x - ent.r, y: ent.c.y }, 'quad');
        push({ x: ent.c.x, y: ent.c.y + ent.r }, 'quad');
        push({ x: ent.c.x, y: ent.c.y - ent.r }, 'quad');
        break;
      case 'arc': {
        push(arcPoint(ent, ent.a0), 'end');
        push(arcPoint(ent, ent.a1), 'end');
        push(ent.c, 'center');
        push(arcPoint(ent, ent.a0 + arcSweep(ent.a0, ent.a1) / 2), 'mid');
        for (const q of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
          if (angleInArc(q, ent.a0, ent.a1)) push(arcPoint(ent, q), 'quad');
        }
        break;
      }
      case 'ellipse': {
        push(ent.c, 'center');
        if (ellipseIsArc(ent)) {
          /* the cut ends are endpoints, and only the quadrants still on the
             run are offered — a quad off the swept part is not there to snap */
          const s = ellipseSweep(ent);
          push(ellipsePoint(ent, ent.a0), 'end');
          push(ellipsePoint(ent, ent.a0 + s), 'end');
          for (const q of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
            if (norm2pi(q - ent.a0) <= s + 1e-9) push(ellipsePoint(ent, q), 'quad');
          }
          break;
        }
        push(ellipsePoint(ent, 0), 'quad');
        push(ellipsePoint(ent, Math.PI / 2), 'quad');
        push(ellipsePoint(ent, Math.PI), 'quad');
        push(ellipsePoint(ent, 3 * Math.PI / 2), 'quad');
        break;
      }
      case 'attdef':
      case 'text': {
        const anchor = textLayout(ent).anchor;
        push(anchor, 'node');
        push(anchor, 'ins');
        break;
      }
      case 'point': push(ent.p, 'node'); break;
      case 'light':
        push(ent.p, 'ins');
        if (ent.tgt) push(ent.tgt, 'node');
        break;
      case 'arctext': {
        const mid = ent.a0 + arcSweep(ent.a0, ent.a1) / 2;
        push({ x: ent.c.x + ent.r * Math.cos(mid), y: ent.c.y + ent.r * Math.sin(mid) }, 'ins');
        break;
      }
      case 'hatch':
        for (const sp of entitySnapPoints(hatchBoundary(ent))) out.push(sp);
        break;
      case 'spline': {
        const pts = ent.pts;
        pts.forEach((p, i) => push(p, (i === 0 || i === pts.length - 1) ? 'end' : 'node'));
        if (ent.closed && pts.length > 2) push(polyCentroid(splinePoints(ent).pts), 'gcen');
        break;
      }
      case 'dim':
        push(ent.p1, 'end');
        push(ent.p2, 'end');
        if (ent.kind === 'angular') push(ent.p3, 'end');
        break;
      case 'leader': ent.pts.forEach(p => push(p, 'end')); break;
      case 'table': tableCorners(ent).forEach(c => push(c, 'end')); break;
      case 'insert': {
        /* The insertion point alone is one grab-handle in empty space —
           measured on an AI-EDIT block: MOVE offered nothing on any wall
           inside it and felt like it would land at random. The children
           are already returned in world coordinates, so their own snap
           points (ends, mids, centers) are the block's. */
        push(ent.p, 'end');
        push(ent.p, 'ins');
        /* dynamic-block parameters surface as their own grips: one per
           BPARAMETER in the definition, standing at the parameter's spot
           plus whatever offset this reference has already been dragged to */
        for (const sp of insertParamGrips(ent)) out.push(sp);
        /* UOSNAP off: object snap stops reaching into a reference, and the
           insertion point is the only thing it still offers */
        if (Nasj.settings && Nasj.settings.uosnap === false &&
            Nasj.xref && Nasj.xref.isXref(Nasj.doc, ent)) break;
        /* a clip hides geometry, so it hides the snaps on it too */
        const clip = insertClipWorld(ent);
        const lbox = near ? insertLocalBox(ent, near) : null;
        for (const child of insertEntities(ent, null, null, lbox)) {
          if (child.type === 'insert') continue;
          for (const sp of entitySnapPoints(child)) {
            if (insertClipAccepts(clip, sp)) out.push(sp);
          }
        }
        break;
      }
      case 'face3d': ent.pts.forEach(p => push(p, 'end')); break;
      case 'box': boxCorners(ent).forEach(p => push(p, 'end')); break;
      case 'solid': case 'wall': case 'slab': {
        Nasj.solid.vertices(ent).forEach(p => push(p, 'end'));
        /* the middle of every edge, with its height */
        for (const f of Nasj.solid.facesOf(ent)) {
          const r = f.pts;
          for (let i = 0, n = r.length; i < n; i++) {
            const a = r[i], b = r[(i + 1) % n];
            push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (zOf(a) + zOf(b)) / 2 }, 'mid');
          }
        }
        break;
      }
      case 'image': {                 /* the frame: corners, and edge middles */
        const c = imageCorners(ent);
        c.forEach(q => push(q, 'end'));
        for (let i = 0; i < 4; i++) push(mid(c[i], c[(i + 1) % 4]), 'mid');
        break;
      }
    }
    return out;
  };

  /* ---------------- transforms (mutate in place, return ent) ---------------- */
  /* a reversed ring numbers its edges the other way: the edge from corner
     i to i+1 runs between the new corners nâˆ’2âˆ’i and nâˆ’1âˆ’i */
  const flipHid = (hid, n) => {
    let out = 0;
    for (let i = 0; i < n; i++) if (hid & (1 << i)) out |= 1 << ((2 * n - 2 - i) % n);
    return out;
  };
  /* a uniform scale k of a body in the plane grows its heights by k too,
     about the ground — which is where scaling in plan leaves z = 0 */
  const scaleHeights = (ent, k) => {
    const up = (p) => { if (isNum(p.z)) p.z *= k; };
    for (const f of ent.faces) { f.pts.forEach(up); for (const h of f.holes || []) h.forEach(up); }
    for (const w of ent.wires || []) w.forEach(up);
  };
  const transformEntity = (ent, fnPoint, opts = {}) => {
    const k = opts.k != null ? Math.abs(opts.k) : null;
    /* 2D transforms act on xy; an optional z rides along unchanged */
    const fp = (p) => {
      const q = fnPoint(p);
      if (p && isNum(p.z) && q.z == null) q.z = p.z;
      return q;
    };
    switch (ent.type) {
      case 'line': ent.a = fp(ent.a); ent.b = fp(ent.b); break;
      case 'polyline':
        /* keep per-vertex bulge through the transform; scale const width */
        ent.pts = ent.pts.map((p) => {
          const q = fp(p);
          if (isNum(p.b) && p.b) q.b = p.b;
          return q;
        });
        if (k != null && isNum(ent.w)) ent.w *= k;
        break;
      /* the path moves and the spacing scales with it — the elements follow */
      case 'mline':
        ent.pts = ent.pts.map(fp);
        if (k != null && isNum(ent.scale)) ent.scale *= k;
        /* a mirror runs the path round the other hand, so an end cap
           measured CCW from the tangent flips to its supplement */
        if (isNum(ent.capS) || isNum(ent.capE)) {
          const o = fp({ x: 0, y: 0 }), ex = fp({ x: 1, y: 0 }), ey = fp({ x: 0, y: 1 });
          if ((ex.x - o.x) * (ey.y - o.y) - (ex.y - o.y) * (ey.x - o.x) < 0) {
            if (isNum(ent.capS)) ent.capS = Math.PI - ent.capS;
            if (isNum(ent.capE)) ent.capE = Math.PI - ent.capE;
          }
        }
        break;
      /* three mapped corners say everything: where it sits, how big it is,
         which way it turns, and whether a mirror ran it the other hand */
      case 'image': {
        const c = imageCorners(ent);
        const p0 = fp(c[0]), p1 = fp(c[1]), p3 = fp(c[3]);
        ent.p = p0;
        ent.w = Math.hypot(p1.x - p0.x, p1.y - p0.y) || ent.w;
        ent.h = Math.hypot(p3.x - p0.x, p3.y - p0.y) || ent.h;
        ent.rot = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        const ux = (p1.x - p0.x) / (ent.w || 1);
        const uy = (p1.y - p0.y) / (ent.w || 1);
        ent.fy = (ux * (p3.y - p0.y) - uy * (p3.x - p0.x)) < 0 ? -1 : 1;
        break;
      }
      case 'xline': {                /* the base moves; the direction turns */
        const q = fp({ x: ent.p.x + ent.d.x, y: ent.p.y + ent.d.y });
        ent.p = fp(ent.p);
        const dx = q.x - ent.p.x, dy = q.y - ent.p.y;
        const L2 = Math.hypot(dx, dy) || 1;
        ent.d = { x: dx / L2, y: dy / L2 };
        break;
      }
      case 'circle': ent.c = fp(ent.c); if (k != null) ent.r *= k; break;
      case 'arc': ent.c = fp(ent.c); if (k != null) ent.r *= k; break;
      case 'arctext':
        ent.c = fp(ent.c);
        if (k != null) {
          ent.r *= k;
          ent.h *= k;
          ent.spacing *= k;
          ent.offArc *= k;
          ent.offL *= k;
          ent.offR *= k;
        }
        /* moved on its own, the text lets go of its arc — hatch's contract */
        if (ent.srcId != null) delete ent.srcId;
        break;
      case 'ellipse':
        ent.c = fp(ent.c);
        if (k != null) { ent.rx *= k; ent.ry *= k; }
        break;
      case 'attdef':
      case 'text':
        ent.p = fp(ent.p);
        if (isPt(ent.p2)) ent.p2 = fp(ent.p2);
        if (k != null) ent.h *= k;
        break;
      case 'point': ent.p = fp(ent.p); break;
      case 'light':
        ent.p = fp(ent.p);
        if (ent.tgt) ent.tgt = fp(ent.tgt);
        break;
      case 'hatch': {
        const b = ent.boundary;
        if (b) {
          if (b.kind === 'pline') b.pts = b.pts.map(fp);
          else if (b.kind === 'circle') { b.c = fp(b.c); if (k != null) b.r *= k; }
          else if (b.kind === 'ellipse') {
            b.c = fp(b.c);
            if (k != null) { b.rx *= k; b.ry *= k; }
          }
        }
        if (Array.isArray(ent.islands)) {
          ent.islands = ent.islands.map((loop) => loop.map(fp));
        }
        /* a hatch transformed on its own leaves its boundary object behind —
           the association is over (the industry standard disassociates here too) */
        if (ent.srcId != null) delete ent.srcId;
        /* THE PATTERN FOLLOWS THE SHAPE. A native hatch fits its pattern to
           its own boundary (engine.js: spacing = sqrt(bbox area)/30 x scale),
           so a scaled boundary carries the pattern with it already — and
           multiplying the factor in on top of that counted the scale twice:
           SCALE x2 drew the pattern x4 apart, half as many lines across the
           same shape, and x0.5 twice as many. An imported hatch measures in
           world units instead (ent.sp), and THAT is the one that scales. */
        if (k != null && isNum(ent.sp) && ent.sp > 0) ent.sp *= k;
        break;
      }
      case 'spline': ent.pts = ent.pts.map(fp); break;
      case 'dim':
        ent.p1 = fp(ent.p1);
        ent.p2 = fp(ent.p2);
        ent.p3 = fp(ent.p3);
        if (isPt(ent.p4)) ent.p4 = fp(ent.p4);
        if (k != null) ent.h = (ent.h || 3) * k;
        break;
      case 'leader':
        ent.pts = ent.pts.map(fp);
        if (k != null) ent.h = (ent.h || 3) * k;
        break;
      case 'table':
        ent.p = fp(ent.p);
        if (k != null) {
          ent.colw = (ent.colw || 30) * k;
          ent.rowh = (ent.rowh || 8) * k;
        }
        break;
      case 'insert':
        ent.p = fp(ent.p);
        if (k != null) {
          ent.sx = (ent.sx == null ? 1 : ent.sx) * k;
          ent.sy = (ent.sy == null ? 1 : ent.sy) * k;
        }
        break;
      case 'face3d': ent.pts = ent.pts.map(fp); break; /* xy moves, z kept */
      case 'box': /* min corner moves in xy; uniform scale sizes w/d/h */
        ent.p = fp(ent.p);
        if (k != null) { ent.w *= k; ent.d *= k; ent.h *= k; }
        break;
      case 'solid': { /* every face and wire point; a scale grows the heights too.
          A mirror turns every ring the other hand, and the outward side with
          it, so the rings run back the way they were */
        const o = fp({ x: 0, y: 0 }), ex = fp({ x: 1, y: 0 }), ey = fp({ x: 0, y: 1 });
        const flip = (ex.x - o.x) * (ey.y - o.y) - (ex.y - o.y) * (ey.x - o.x) < 0;
        const ring = (r) => { const m = r.map(fp); return flip ? m.reverse() : m; };
        ent.faces = ent.faces.map((f) => {
          const g = { pts: ring(f.pts) };
          if (f.holes) g.holes = f.holes.map(ring);
          if (f.hid) g.hid = flip ? flipHid(f.hid, f.pts.length) : f.hid;
          return g;
        });
        ent.wires = (ent.wires || []).map((w) => w.map(fp));
        if (k != null && k !== 1) scaleHeights(ent, k);
        break;
      }
      case 'wall': /* the run moves; thickness, height and openings scale with it */
        ent.pts = ent.pts.map((p) => { const q = fp(p); return { x: q.x, y: q.y }; });
        if (k != null) {
          ent.t *= k; ent.h *= k;
          if (isNum(ent.z)) ent.z *= k;
          for (const o of ent.openings || []) { o.s *= k; o.w *= k; o.h *= k; o.z0 *= k; }
        }
        /* a mirror runs each segment the other hand on the sheet but the run
           keeps its order, so the openings stay where they are along it */
        break;
      case 'slab':
        ent.pts = ent.pts.map((p) => { const q = fp(p); return { x: q.x, y: q.y }; });
        if (k != null) { ent.th *= k; if (isNum(ent.z)) ent.z *= k; }
        break;
    }
    return ent;
  };

  /* An entity's defining points as MUTABLE references — what a stretch
     moves when they fall inside its frame. Types with no meaningful
     vertex list answer empty, so a stretch simply passes them by. */
  const entityPointRefs = (e) => {
    if (!e) return [];
    switch (e.type) {
      case 'line': return [e.a, e.b];
      case 'polyline':
      case 'spline':
      case 'leader':
      case 'face3d':
      case 'wall':
      case 'slab': return (e.pts || []).slice();
      case 'circle':
      case 'arc':
      case 'ellipse': return [e.c];
      case 'point':
      case 'insert':
      case 'text':
      case 'mtext':
      case 'attdef':
      case 'table':
      case 'image': return e.p ? [e.p] : [];
      case 'dim': {
        const out = [];
        for (const k of ['p1', 'p2', 'p3']) if (e[k]) out.push(e[k]);
        return out;
      }
      default: return [];
    }
  };

  /* dz is optional and additive: without it the height rides along
     unchanged, exactly as it did before there was one */
  const xlPoint = (p, dx, dy) => {
    const q = { x: p.x + dx, y: p.y + dy };
    if (isNum(p.z)) q.z = p.z;
    return q;
  };
  const translateEntity = (ent, dx, dy, dz) => {
    /* the hand-unrolled common kinds: a MOVE of a quarter-million entities
       spends ~55ms of its commit in transformEntity's dispatch, closures
       and the fp shim; these write byte-identical objects (same fields in
       the same order, z carried, bulge carried) at a fraction of it.
       Anything else — and any dz — takes the generic path unchanged. */
    if (!dz) {
      switch (ent.type) {
        case 'insert':
        case 'point':
          ent.p = xlPoint(ent.p, dx, dy);
          return ent;
        case 'text':
        case 'attdef':
          ent.p = xlPoint(ent.p, dx, dy);
          if (isPt(ent.p2)) ent.p2 = xlPoint(ent.p2, dx, dy);
          return ent;
        case 'line':
          ent.a = xlPoint(ent.a, dx, dy);
          ent.b = xlPoint(ent.b, dx, dy);
          return ent;
        case 'circle':
        case 'arc':
          ent.c = xlPoint(ent.c, dx, dy);
          return ent;
        case 'polyline': {
          const pts = ent.pts;
          const out = new Array(pts.length);
          for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const q = { x: p.x + dx, y: p.y + dy };
            if (isNum(p.z)) q.z = p.z;
            if (isNum(p.b) && p.b) q.b = p.b;
            out[i] = q;
          }
          ent.pts = out;
          return ent;
        }
      }
    }
    return transformEntity(ent, p => {
      const q = { x: p.x + dx, y: p.y + dy };
      if (dz) q.z = (isNum(p.z) ? p.z : 0) + dz;
      return q;
    });
  };

  const rotateEntityAbout = (ent, c, ang) => {
    transformEntity(ent, p => rotatePoint(p, c, ang));
    if (ent.type === 'arc' || ent.type === 'arctext') {
      ent.a0 = norm2pi(ent.a0 + ang);
      ent.a1 = norm2pi(ent.a1 + ang);
    } else if (ent.type === 'ellipse') {
      ent.rot = norm2pi((ent.rot || 0) + ang);
    } else if (ent.type === 'text' || ent.type === 'attdef') {
      ent.rot = norm2pi((ent.rot || 0) + ang);
    } else if (ent.type === 'insert') {
      ent.rot = norm2pi((ent.rot || 0) + ang);
    } else if (ent.type === 'hatch') {
      if (ent.boundary && ent.boundary.kind === 'ellipse') {
        ent.boundary.rot = norm2pi((ent.boundary.rot || 0) + ang);
      }
      if (ent.pattern !== 'SOLID') ent.angle = (ent.angle || 0) + ang * 180 / Math.PI;
    }
    return ent;
  };

  const scaleEntityAbout = (ent, c, k) =>
    transformEntity(ent, p => scalePoint(p, c, k), { k });

  const mirrorEntity = (ent, a, b) => {
    const phi = (dist(a, b) < EPS) ? 0 : angle(a, b);
    transformEntity(ent, p => mirrorPoint(p, a, b));
    if (ent.type === 'polyline') {
      /* reflection reverses arc orientation: bulge signs flip */
      for (const p of ent.pts) if (isNum(p.b) && p.b) p.b = -p.b;
    }
    if (ent.type === 'arc' || ent.type === 'arctext') {
      /* reflection maps angle t -> 2*phi - t and reverses orientation;
         swap endpoints so the arc (and the arc a text follows) stays CCW */
      const na0 = norm2pi(2 * phi - ent.a1);
      const na1 = norm2pi(2 * phi - ent.a0);
      ent.a0 = na0; ent.a1 = na1;
      /* the mirrored run would read the other way; flipping reverse keeps
         the words legible, which is what the industry standard's MIRRTEXT=0 spirit wants */
      if (ent.type === 'arctext') ent.reverse = !ent.reverse;
    } else if (ent.type === 'ellipse') {
      ent.rot = norm2pi(2 * phi - (ent.rot || 0));
      /* a mirror reverses the parametric direction, so a swept ellipse walks
         its run the other way: the ends swap and each negates */
      if (isNum(ent.a0) && isNum(ent.a1)) {
        const a0 = ent.a0, a1 = ent.a1;
        ent.a0 = norm2pi(-a1);
        ent.a1 = norm2pi(-a0);
      }
    } else if (ent.type === 'text' || ent.type === 'attdef') {
      ent.rot = norm2pi(2 * phi - (ent.rot || 0));
    } else if (ent.type === 'insert') {
      /* Mâˆ˜(R(rot)Â·S) = R(2phi-rot)Â·S(sx,-sy) — exact mirrored placement */
      ent.rot = norm2pi(2 * phi - (ent.rot || 0));
      ent.sy = -(ent.sy == null ? 1 : ent.sy);
    } else if (ent.type === 'hatch') {
      if (ent.boundary && ent.boundary.kind === 'ellipse') {
        ent.boundary.rot = norm2pi(2 * phi - (ent.boundary.rot || 0));
      }
      if (ent.pattern !== 'SOLID') ent.angle = 2 * (phi * 180 / Math.PI) - (ent.angle || 0);
    }
    return ent;
  };

  /* ---------------- intersections (SPEC2 Â§15) ---------------- */
  /* decompose to analytic primitives: segments + (full) arcs; sampled otherwise */
  /* near (optional): world-space cursor box — same contract as
     entitySnapPoints. Only a reference is clipped by it; its children keep
     the exact segs/arcs the full expansion would have given them. */
  const primsOf = (ent, near) => {
    if (near && ent.type === 'insert') {
      const lbox = insertLocalBox(ent, near);
      const segs = [];
      for (const c of insertEntities(ent, null, null, lbox)) {
        for (const s of entitySegs(c, 1e-3)) segs.push({ seg: s });
      }
      return segs;
    }
    switch (ent.type) {
      case 'line': return [{ seg: [ent.a, ent.b] }];
      case 'polyline': {
        /* a bulge segment is a TRUE arc prim, not a run of sampled chords —
           intersections and perpendiculars land on the curve itself */
        const pts = ent.pts || [], n = pts.length, closed = !!ent.closed;
        if (n < 2) return [];
        const m = closed ? n : n - 1;
        const out = [];
        for (let i = 0; i < m; i++) {
          const a = pts[i], b = pts[(i + 1) % n];
          const A = segHasBulge(a) ? bulgeArc(a, b, a.b) : null;
          if (!A) { out.push({ seg: [a, b] }); continue; }
          /* prim arcs run CCW a0 -> a1; a negative theta walks clockwise */
          out.push({ arc: A.theta >= 0
            ? { c: A.c, r: A.r, a0: A.a0, a1: A.a0 + A.theta }
            : { c: A.c, r: A.r, a0: A.a0 + A.theta, a1: A.a0 } });
        }
        return out;
      }
      case 'circle': return [{ arc: { c: ent.c, r: ent.r, a0: 0, a1: 0, full: true } }];
      case 'arc': return [{ arc: { c: ent.c, r: ent.r, a0: ent.a0, a1: ent.a1 } }];
      default: return entitySegs(ent, 1e-3).map(s => ({ seg: s }));
    }
  };

  const inArcRange = (A, pt) =>
    A.full || angleInArc(Math.atan2(pt.y - A.c.y, pt.x - A.c.x), A.a0, A.a1);

  const segSegPoint = (a, b, c, d, out) => {
    const d1x = b.x - a.x, d1y = b.y - a.y;
    const d2x = d.x - c.x, d2y = d.y - c.y;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < EPS) return; /* parallel/collinear: no unique point */
    const ex = c.x - a.x, ey = c.y - a.y;
    const t = (ex * d2y - ey * d2x) / den;
    const s = (ex * d1y - ey * d1x) / den;
    if (t >= -1e-9 && t <= 1 + 1e-9 && s >= -1e-9 && s <= 1 + 1e-9) {
      out.push({ x: a.x + t * d1x, y: a.y + t * d1y });
    }
  };

  const segArcPoints = (a, b, A, out) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const fx = a.x - A.c.x, fy = a.y - A.c.y;
    const qa = dx * dx + dy * dy;
    if (qa < EPS) return;
    const qb = 2 * (fx * dx + fy * dy);
    const qc = fx * fx + fy * fy - A.r * A.r;
    let disc = qb * qb - 4 * qa * qc;
    if (disc < -1e-9) return;
    disc = Math.sqrt(Math.max(disc, 0));
    const ts = disc < EPS ? [-qb / (2 * qa)] : [(-qb - disc) / (2 * qa), (-qb + disc) / (2 * qa)];
    for (const t of ts) {
      if (t < -1e-9 || t > 1 + 1e-9) continue;
      const pt = { x: a.x + t * dx, y: a.y + t * dy };
      if (inArcRange(A, pt)) out.push(pt);
    }
  };

  const arcArcPoints = (A, B, out) => {
    const d = dist(A.c, B.c);
    if (d < EPS) return; /* concentric */
    if (d > A.r + B.r + 1e-9 || d < Math.abs(A.r - B.r) - 1e-9) return;
    const a = (A.r * A.r - B.r * B.r + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(A.r * A.r - a * a, 0));
    const ux = (B.c.x - A.c.x) / d, uy = (B.c.y - A.c.y) / d;
    const mx = A.c.x + a * ux, my = A.c.y + a * uy;
    const cands = h < 1e-9
      ? [{ x: mx, y: my }]
      : [{ x: mx - h * uy, y: my + h * ux }, { x: mx + h * uy, y: my - h * ux }];
    for (const pt of cands) if (inArcRange(A, pt) && inArcRange(B, pt)) out.push(pt);
  };

  /* near (optional): the world box the answer can possibly lie in — the
     overlap of the two entities' own boxes is all a caller ever needs, and
     a point outside it is not an intersection of BOTH. Handing it down to
     primsOf clips a block reference to the children that reach the box:
     TRIM's one click put this to a 62,784-child reference and paid 39ms to
     expand the whole thing for a crossing that could only happen inside a
     line's own bounds. Same points, minus the pairs already known empty. */
  const intersections = (entA, entB, near) => {
    if (!entA || !entB) return [];
    const raw = [];
    for (const A of primsOf(entA, near)) {
      for (const B of primsOf(entB, near)) {
        if (A.seg && B.seg) segSegPoint(A.seg[0], A.seg[1], B.seg[0], B.seg[1], raw);
        else if (A.seg && B.arc) segArcPoints(A.seg[0], A.seg[1], B.arc, raw);
        else if (A.arc && B.seg) segArcPoints(B.seg[0], B.seg[1], A.arc, raw);
        else arcArcPoints(A.arc, B.arc, raw);
      }
    }
    const out = [];
    for (const p of raw) {
      if (!out.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 1e-6)) out.push(p);
    }
    return out;
  };

  /* one prim pair ({seg:[a,b]} | {arc:{c,r,a0,a1,full?}}) -> intersection pts.
     Exposed for the engine's Intersection osnap, which prefilters prims to
     the cursor neighbourhood before paying for the pairwise test. */
  const primIntersect = (A, B) => {
    const out = [];
    if (A.seg && B.seg) segSegPoint(A.seg[0], A.seg[1], B.seg[0], B.seg[1], out);
    else if (A.seg && B.arc) segArcPoints(A.seg[0], A.seg[1], B.arc, out);
    else if (A.arc && B.seg) segArcPoints(B.seg[0], B.seg[1], A.arc, out);
    else if (A.arc && B.arc) arcArcPoints(A.arc, B.arc, out);
    return out;
  };

  /* feet of perpendiculars dropped from `base` onto the entity (perp osnap).
     near (optional): the osnap cursor box — a foot the cursor can accept lies
     inside it, so clipping a reference's prims to it drops nothing offered. */
  const perpPoints = (ent, base, near) => {
    const out = [];
    for (const P of primsOf(ent, near)) {
      if (P.seg) {
        const [a, b] = P.seg;
        const dx = b.x - a.x, dy = b.y - a.y;
        const L2 = dx * dx + dy * dy;
        if (L2 < EPS) continue;
        const t = ((base.x - a.x) * dx + (base.y - a.y) * dy) / L2;
        if (t > 1e-9 && t < 1 - 1e-9) out.push({ x: a.x + t * dx, y: a.y + t * dy });
      } else {
        const A = P.arc;
        const d = dist(base, A.c);
        if (d < EPS) continue;
        const ux = (base.x - A.c.x) / d, uy = (base.y - A.c.y) / d;
        for (const s of [1, -1]) {
          const pt = { x: A.c.x + ux * A.r * s, y: A.c.y + uy * A.r * s };
          if (inArcRange(A, pt)) out.push(pt);
        }
      }
    }
    return out;
  };

  /* tangency points on circles/arcs as seen from `base` (tangent osnap);
     near clips a reference's prims the same way perpPoints' does */
  const tangentPoints = (ent, base, near) => {
    const out = [];
    for (const P of primsOf(ent, near)) {
      const A = P.arc;
      if (!A) continue;
      const d = dist(base, A.c);
      if (d <= A.r + 1e-9) continue; /* base inside: no tangent */
      const a = Math.atan2(base.y - A.c.y, base.x - A.c.x);
      const off = Math.acos(Math.max(-1, Math.min(1, A.r / d)));
      for (const s of [off, -off]) {
        const pt = { x: A.c.x + A.r * Math.cos(a + s), y: A.c.y + A.r * Math.sin(a + s) };
        if (inArcRange(A, pt)) out.push(pt);
      }
    }
    return out;
  };

  /* near (optional): the osnap cursor box. Nearest on a reference then only
     expands children that can reach the box: a winner among them is the full
     answer whenever the full answer was within reach, and when nothing near
     remains the full walk could only have offered points beyond the aperture
     — except the insertion-point fallback of a reference with no seg
     geometry at all, which is kept. */
  const closestPointOnEntity = (ent, p, near) => {
    if (near && ent.type === 'insert') {
      const lbox = insertLocalBox(ent, near);
      if (lbox) {
        let best = null, bestD = Infinity;
        for (const c of insertEntities(ent, null, null, lbox)) {
          for (const [a, b] of entitySegs(c, 1e-3)) {
            const q = closestPointOnSeg(p, a, b);
            const d = dist(p, q);
            if (d < bestD) { bestD = d; best = q; }
          }
        }
        if (best) return best;
        const d0 = Nasj.doc;
        const def0 = d0 && d0.blocks && d0.blocks[ent.name];
        if (def0 && Array.isArray(def0.entities) && defChildMetrics(def0).seg) return null;
        return isPt(ent.p) ? { x: ent.p.x, y: ent.p.y } : { x: 0, y: 0 };
      }
    }
    switch (ent.type) {
      case 'line': return closestPointOnSeg(p, ent.a, ent.b);
      case 'circle': {
        const d = dist(p, ent.c);
        if (d < EPS) return { x: ent.c.x + ent.r, y: ent.c.y };
        return {
          x: ent.c.x + (p.x - ent.c.x) * ent.r / d,
          y: ent.c.y + (p.y - ent.c.y) * ent.r / d
        };
      }
      case 'arc': {
        const t = Math.atan2(p.y - ent.c.y, p.x - ent.c.x);
        if (dist(p, ent.c) > EPS && angleInArc(t, ent.a0, ent.a1)) return arcPoint(ent, t);
        const e0 = arcPoint(ent, ent.a0), e1 = arcPoint(ent, ent.a1);
        return dist(p, e0) <= dist(p, e1) ? e0 : e1;
      }
      case 'point':
      case 'light': return { x: ent.p.x, y: ent.p.y };
      default: {
        let best = null, bestD = Infinity;
        for (const [a, b] of entitySegs(ent, 1e-3)) {
          const q = closestPointOnSeg(p, a, b);
          const d = dist(p, q);
          if (d < bestD) { bestD = d; best = q; }
        }
        return best || (isPt(ent.p) ? { x: ent.p.x, y: ent.p.y } : { x: 0, y: 0 });
      }
    }
  };

  /* ---------------- explode (SPEC2 Â§15) ---------------- */
  const inherit = (src, e) => {
    e.id = uid();
    if (!e.layerId) e.layerId = src.layerId;
    if (!e.color) e.color = src.color || 'ByLayer';
    return e;
  };

  Nasj.explode = (doc, ent) => {
    if (!ent) return null;
    /* a body falls apart into its faces — a pierced face stays a one-face
       solid, since a 3D face has no holes — and its wires into polylines */
    if (Nasj.solid.isBody(ent)) {
      const out = [];
      const p3 = (p) => ({ x: p.x, y: p.y, z: zOf(p) });
      /* the TRUE faces: a live section clips the display, never the model */
      for (const f of (Nasj.solid.rawFacesOf || Nasj.solid.facesOf)(ent)) {
        if (!f.holes && f.pts.length <= 4) out.push(inherit(ent, Object.assign({ type: 'face3d', pts: f.pts.map(p3) }, f.hid ? { hid: f.hid } : null)));
        else out.push(inherit(ent, { type: 'solid', faces: [Object.assign({ pts: f.pts.map(p3), holes: (f.holes || []).map((h) => h.map(p3)) }, f.hid ? { hid: f.hid } : null)], wires: [] }));
      }
      for (const w of Nasj.solid.wiresOf(ent)) out.push(inherit(ent, { type: 'polyline', pts: w.map(p3), closed: false }));
      return out.length ? out : null;
    }
    switch (ent.type) {
      /* an mline falls apart into the parallel lines it was drawing */
      case 'mline': {
        const parts = mlineParts(ent);
        return parts.length ? parts.map(p => inherit(ent, p)) : null;
      }
      case 'polyline': {
        const pts = ent.pts || [];
        if (pts.length < 2) return null;
        const out = [];
        const emit = (p1, p2) => {
          const A = segHasBulge(p1) ? bulgeArc(p1, p2, p1.b) : null;
          if (A) { /* bulge segment -> true arc (CCW a0->a1 kernel form) */
            const arc = A.theta > 0
              ? { a0: norm2pi(A.a0), a1: norm2pi(A.a0 + A.theta) }
              : { a0: norm2pi(A.a0 + A.theta), a1: norm2pi(A.a0) };
            out.push(inherit(ent, { type: 'arc', c: { x: A.c.x, y: A.c.y }, r: A.r, a0: arc.a0, a1: arc.a1 }));
          } else {
            out.push(inherit(ent, { type: 'line', a: { x: p1.x, y: p1.y }, b: { x: p2.x, y: p2.y } }));
          }
        };
        for (let i = 0; i + 1 < pts.length; i++) emit(pts[i], pts[i + 1]);
        if (ent.closed && pts.length > 2) emit(pts[pts.length - 1], pts[0]);
        return out;
      }
      case 'spline': {
        const s = splinePoints(ent);
        return [inherit(ent, {
          type: 'polyline',
          pts: s.pts.map(p => ({ x: p.x, y: p.y })),
          closed: !!s.closed
        })];
      }
      case 'hatch':
        return [inherit(ent, JSON.parse(JSON.stringify(hatchBoundary(ent))))];
      case 'dim':
      case 'leader':
      case 'table': {
        const G = entityAnno(ent);
        const out = [];
        for (const [a, b] of G.segs) {
          out.push(inherit(ent, { type: 'line', a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }));
        }
        for (const A of G.arcs) {
          const s = arcSweep(A.a0, A.a1), n = 32, pts = [];
          for (let i = 0; i <= n; i++) pts.push(arcPoint(A, A.a0 + s * i / n));
          out.push(inherit(ent, { type: 'polyline', pts, closed: false }));
        }
        for (const tri of G.arrows) { /* arrowheads as tiny closed plines */
          out.push(inherit(ent, { type: 'polyline', pts: tri.map(p => ({ x: p.x, y: p.y })), closed: true }));
        }
        for (const t of G.texts) {
          if (!String(t.str).length) continue;
          out.push(inherit(ent, { type: 'text', p: annoTextOrigin(t), str: String(t.str), h: t.h, rot: t.ang || 0 }));
        }
        return out;
      }
      case 'insert': {
        const kids = insertEntities(ent, doc);
        if (!kids.length) return null;
        return kids.map(c => {
          const e = inherit(ent, c);
          if (doc && doc.layers && !doc.layers.some(l => l.id === e.layerId)) e.layerId = ent.layerId;
          return e;
        });
      }
      default: return null; /* line/circle/arc/ellipse/text/point */
    }
  };

  Nasj.geom = {
    dist, mid, add, sub, len, angle, polar,
    rotatePoint, scalePoint, mirrorPoint, closestPointOnSeg,
    closestPointOnEntity, intersections,
    entityPrims: primsOf, primIntersect, perpPoints, tangentPoints,
    /* extras used by engine/tools (harmless additions) */
    norm2pi, arcSweep, angleInArc, arcPoint, ellipsePoint, ellipseSweep, ellipseIsArc,
    textWidth, textLayout, entitySegs,
    imageCorners,
    bulgeArc, bulgeArcPoint, polylinePoints, zOf, boxBase, boxCorners,
    mlineParts, mlineElements, mlineProject,
    bulgeArc, segHasBulge,
    splinePoints, splineBeziers, hatchBoundary, pointInBoundary,
    dimGeometry, dimStyleOf, leaderGeometry, mleaderStyleOf, tableGeometry, tableStyleOf, entityAnno,
    annoTextWidth, annoTextCorners, annoTextOrigin, insertEntities, defChildMetrics,
    defChildMetricsStep,
    layersChanged,
    insertXform, insertInvXform, insertClipWorld, insertClipAccepts,
    insertLocalBox, insertToWorld, insertToDef,
    transformEntity, translateEntity, rotateEntityAbout, scaleEntityAbout, mirrorEntity,
    entityPointRefs,
    paramGrips, dynKey,
    entityBounds, entityHitTest, entityInRect, entitySnapPoints, entityGripPoints
  };
})();
