/* Nasjicad — dxf.js  (SPEC2 §17). Owner: FILEIO.
 * ASCII DXF R2000 (AC1015) export + tolerant import for the Nasj document
 * schema. Plain script, attaches to window.Nasj as Nasj.dxf. No DOM access,
 * no init at parse time.
 *
 *   Nasj.dxf.exportDoc(doc)   -> string        (DXF text)
 *   Nasj.dxf.importText(text) -> {layers, entities, blocks, warnings}
 */
(() => {
  'use strict';
  /* ONE WRITER, THREE HOSTS. The desktop app and the browser build both load
     this as a plain script and read it off window.Nasj; the website's
     converter requires it as a CommonJS module in node, where there is no
     window at all. It is deliberately the same file in all three: the moment
     the site keeps its own copy, a fix made here stops reaching the DWG the
     site hands the customer, and the two quietly drift apart. */
  const HAS_WINDOW = typeof window !== 'undefined';
  const Nasj = HAS_WINDOW ? (window.Nasj = window.Nasj || {}) : {};

  const TAU = Math.PI * 2;
  const DEG = 180 / Math.PI;
  const RAD = Math.PI / 180;

  /* ---- the STYLE table's fonts ------------------------------------- *
   * A style names a FONT FILE; a canvas wants a family. A TrueType style
   * names the file the family lives in, so the name minus its extension IS
   * the family. An SHX style names one of the stroke fonts the industry standard ships,
   * which no machine has installed as a font at all — those draw in the
   * thin monoline face, which beside a TTF label reads the way the industry standard's
   * own lettering does instead of as a second heavy typeface.
   * Shared with dwg-doc.js so both routes into a document name the same
   * face for the same style.
   */
  const SHX_FACE = 'Segoe UI Light';
  const CAD_FACE = 'Arial';          /* what the renderer draws CAD text in */
  const TTF_EXT = /^(ttf|ttc|otf|fon)$/i;
  const fontFamily = (file) => {
    const f = String(file || '').trim();
    if (!f) return null;
    const dot = f.lastIndexOf('.');
    const stem = (dot >= 0 ? f.slice(0, dot) : f).trim();
    if (!stem) return null;
    /* the industry standard's own rule: a font file named with no extension is an .shx,
       and every SHX is a stroke font no machine has as a typeface */
    return TTF_EXT.test(dot >= 0 ? f.slice(dot + 1) : '') ? stem : SHX_FACE;
  };

  /* ------------------------------------------------------------------ *
   * Standard 256-entry Color Index table (published RGB values;
   * index 0 is the ByBlock placeholder, 1..255 are real colors).
   * ------------------------------------------------------------------ */
  const ACI = [
    0x000000, 0xFF0000, 0xFFFF00, 0x00FF00, 0x00FFFF, 0x0000FF, 0xFF00FF, 0xFFFFFF,
    0x808080, 0xC0C0C0, 0xFF0000, 0xFF7F7F, 0xA50000, 0xA55252, 0x7F0000, 0x7F3F3F,
    0x4C0000, 0x4C2626, 0x260000, 0x261313, 0xFF3F00, 0xFF9F7F, 0xA52900, 0xA56752,
    0x7F1F00, 0x7F4F3F, 0x4C1300, 0x4C2F26, 0x260900, 0x261713, 0xFF7F00, 0xFFBF7F,
    0xA55200, 0xA57C52, 0x7F3F00, 0x7F5F3F, 0x4C2600, 0x4C3926, 0x261300, 0x261C13,
    0xFFBF00, 0xFFDF7F, 0xA57C00, 0xA59152, 0x7F5F00, 0x7F6F3F, 0x4C3900, 0x4C4226,
    0x261C00, 0x262113, 0xFFFF00, 0xFFFF7F, 0xA5A500, 0xA5A552, 0x7F7F00, 0x7F7F3F,
    0x4C4C00, 0x4C4C26, 0x262600, 0x262613, 0xBFFF00, 0xDFFF7F, 0x7CA500, 0x91A552,
    0x5F7F00, 0x6F7F3F, 0x394C00, 0x424C26, 0x1C2600, 0x212613, 0x7FFF00, 0xBFFF7F,
    0x52A500, 0x7CA552, 0x3F7F00, 0x5F7F3F, 0x264C00, 0x394C26, 0x132600, 0x1C2613,
    0x3FFF00, 0x9FFF7F, 0x29A500, 0x67A552, 0x1F7F00, 0x4F7F3F, 0x134C00, 0x2F4C26,
    0x092600, 0x172613, 0x00FF00, 0x7FFF7F, 0x00A500, 0x52A552, 0x007F00, 0x3F7F3F,
    0x004C00, 0x264C26, 0x002600, 0x132613, 0x00FF3F, 0x7FFF9F, 0x00A529, 0x52A567,
    0x007F1F, 0x3F7F4F, 0x004C13, 0x264C2F, 0x002609, 0x135817, 0x00FF7F, 0x7FFFBF,
    0x00A552, 0x52A57C, 0x007F3F, 0x3F7F5F, 0x004C26, 0x264C39, 0x002613, 0x13581C,
    0x00FFBF, 0x7FFFDF, 0x00A57C, 0x52A591, 0x007F5F, 0x3F7F6F, 0x004C39, 0x264C42,
    0x00261C, 0x135858, 0x00FFFF, 0x7FFFFF, 0x00A5A5, 0x52A5A5, 0x007F7F, 0x3F7F7F,
    0x004C4C, 0x264C4C, 0x002626, 0x135858, 0x00BFFF, 0x7FDFFF, 0x007CA5, 0x5291A5,
    0x005F7F, 0x3F6F7F, 0x00394C, 0x26427E, 0x001C26, 0x135858, 0x007FFF, 0x7FBFFF,
    0x0052A5, 0x527CA5, 0x003F7F, 0x3F5F7F, 0x00264C, 0x26397E, 0x001326, 0x131C58,
    0x003FFF, 0x7F9FFF, 0x0029A5, 0x5267A5, 0x001F7F, 0x3F4F7F, 0x00134C, 0x262F7E,
    0x000926, 0x131758, 0x0000FF, 0x7F7FFF, 0x0000A5, 0x5252A5, 0x00007F, 0x3F3F7F,
    0x00004C, 0x26267E, 0x000026, 0x131358, 0x3F00FF, 0x9F7FFF, 0x2900A5, 0x6752A5,
    0x1F007F, 0x4F3F7F, 0x13004C, 0x2F267E, 0x090026, 0x171358, 0x7F00FF, 0xBF7FFF,
    0x5200A5, 0x7C52A5, 0x3F007F, 0x5F3F7F, 0x26004C, 0x39267E, 0x130026, 0x1C1358,
    0xBF00FF, 0xDF7FFF, 0x7C00A5, 0x9152A5, 0x5F007F, 0x6F3F7F, 0x39004C, 0x42264C,
    0x1C0026, 0x581358, 0xFF00FF, 0xFF7FFF, 0xA500A5, 0xA552A5, 0x7F007F, 0x7F3F7F,
    0x4C004C, 0x4C264C, 0x260026, 0x581358, 0xFF00BF, 0xFF7FDF, 0xA5007C, 0xA55291,
    0x7F005F, 0x7F3F6F, 0x4C0039, 0x4C2642, 0x26001C, 0x581358, 0xFF007F, 0xFF7FBF,
    0xA50052, 0xA5527C, 0x7F003F, 0x7F3F5F, 0x4C0026, 0x4C2639, 0x260013, 0x58131C,
    0xFF003F, 0xFF7F9F, 0xA50029, 0xA55267, 0x7F001F, 0x7F3F4F, 0x4C0013, 0x4C262F,
    0x260009, 0x581317, 0x000000, 0x656565, 0x666666, 0x999999, 0xCCCCCC, 0xFFFFFF
  ];

  const intToHex = (n) => '#' + (n & 0xFFFFFF).toString(16).padStart(6, '0');
  const hexToInt = (hex) => {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
    return m ? parseInt(m[1], 16) : 0xFFFFFF;
  };
  const aciToHex = (i) => intToHex(ACI[(i >= 1 && i <= 255) ? Math.floor(i) : 7]);

  /* nearest ACI index (1..255) for a #rrggbb color */
  const nearestAci = (hex) => {
    const v = hexToInt(hex);
    const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    let best = 7, bestD = Infinity;
    for (let i = 1; i <= 255; i++) {
      const c = ACI[i];
      const dr = r - ((c >> 16) & 255), dg = g - ((c >> 8) & 255), db = b - (c & 255);
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = i; if (d === 0) break; }
    }
    return best;
  };

  /* ------------------------------------------------------------------ *
   * shared helpers
   * ------------------------------------------------------------------ */
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const isPt = (p) => !!p && isNum(p.x) && isNum(p.y);

  // AI working areas are editor references, never solid drawing geometry.
  // Their identity travels as XDATA on an outline so other CAD readers also
  // get a harmless frame, even when they do not understand our metadata.
  const aiSelectionNumber = (n) => Number.isInteger(n) && n > 0 && n <= 2147483647;
  const aiSelectionFromPairs = (pairs) => {
    let app = '', marker = false;
    for (const [code, value] of pairs || []) {
      if (code === 1001) { app = String(value).toUpperCase(); marker = false; }
      else if (app === 'NASJICAD' && code === 1000) marker = value === 'AI_SELECTION_V1';
      else if (app === 'NASJICAD' && marker && code === 1071) {
        const n = Number(value);
        if (aiSelectionNumber(n)) return n;
      }
    }
    return null;
  };
  const restoreAiSelections = (entities, layers) => {
    const layerMap = new Map((layers || []).map(l => [l.id, l]));
    const used = new Set((entities || []).filter(e => aiSelectionNumber(e.aisel)).map(e => e.aisel));
    const seen = new Set(), areas = [], rest = [];
    let next = 1;
    const rectangle = (pts) => {
      if (!Array.isArray(pts) || pts.length !== 4 || !pts.every(isPt) || pts.some(p => p.b || p.z)) return false;
      for (let i = 0; i < 4; i++) {
        const a = pts[i], b = pts[(i + 1) % 4], c = pts[(i + 2) % 4];
        const ux = b.x-a.x, uy = b.y-a.y, vx = c.x-b.x, vy = c.y-b.y;
        const lengths = Math.hypot(ux,uy)*Math.hypot(vx,vy);
        if (!(lengths > 1e-12) || Math.abs(ux*vx+uy*vy) > lengths*1e-7) return false;
      }
      return true;
    };
    for (const e of entities || []) {
      const ly = layerMap.get(e.layerId);
      let boundary = e.type === 'hatch' ? e.boundary : e.type === 'polyline' && e.closed
        ? { kind:'pline', closed:true, pts:e.pts } : null;
      // Some DWG readers repeat the first vertex to close a hatch loop.
      const points = boundary?.pts;
      if (Array.isArray(points) && points.length > 3 && isPt(points[0]) && isPt(points[points.length-1]) &&
          Math.hypot(points[0].x-points[points.length-1].x, points[0].y-points[points.length-1].y) < 1e-9) {
        boundary = Object.assign({}, boundary, {pts:points.slice(0,-1)});
      }
      const tagged = aiSelectionNumber(e.aisel);
      // Only migrate the exact older selection signature. Ordinary blue
      // hatches, even nearby, retain their fill and drawing order.
      const legacy = !tagged && e.type === 'hatch' && e.pattern === 'SOLID' &&
        !e.islands?.length && !e.boundary?.islands?.length &&
        String(ly?.name).toUpperCase() === 'A-AI-SEL' &&
        String(e.color && e.color !== 'ByLayer' ? e.color : ly?.color).toLowerCase() === '#3fa9e0' &&
        rectangle(boundary?.pts);
      if (!(tagged || legacy) || boundary?.kind !== 'pline' || boundary.closed === false ||
          !Array.isArray(boundary.pts) || boundary.pts.length < 3 || !boundary.pts.every(isPt)) {
        rest.push(e); continue;
      }
      if (!tagged || seen.has(e.aisel)) {
        while (used.has(next)) next++;
        e.aisel = next; used.add(next);
      }
      seen.add(e.aisel);
      e.type = 'hatch'; e.pattern = 'SOLID'; e.boundary = boundary;
      e.angle = 0; e.scale = 1;
      delete e.pts; delete e.closed; delete e.w;
      areas.push(e);
    }
    // The reference wash remains behind geometry after native/DWG reopens.
    if (areas.length) {
      let i = 0;
      for (const e of areas) entities[i++] = e;
      for (const e of rest) entities[i++] = e;
    }
    return areas.length;
  };

  const fmt = (v) => {
    if (!isFinite(v)) return '0';
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
    let s = String(v);
    if (s.indexOf('e') !== -1 || s.indexOf('E') !== -1) {
      s = v.toFixed(12).replace(/0+$/, '');
      if (s.endsWith('.')) s += '0';
    }
    return s;
  };

  let _seq = 0;
  const uid = () => 'dxf' + Date.now().toString(36) + (++_seq).toString(36);

  /* ------------------------------------------------------------------ *
   * DXF text control codes (SPEC2 §17).
   * Import: %%d -> ° (U+00B0), %%c -> Ø (U+00D8), %%p -> ± (U+00B1),
   * %%u / %%o underline/overline toggles stripped, %%% -> %, %%nnn ->
   * font char nnn, \U+XXXX -> the real character.
   * Export: ° Ø ± are written back as %%d/%%c/%%p for compatibility with
   * legacy readers; all other non-ASCII text is written as-is (UTF-8).
   * ------------------------------------------------------------------ */
  const CP1252_HIGH = [ /* bytes 0x80..0x9F of Windows-1252 -> Unicode */
    0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
    0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F,
    0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178
  ];

  const decodeDxfText = (v) => {
    const s = String(v == null ? '' : v);
    if (s.indexOf('%%') === -1 && s.indexOf('\\U+') === -1 && s.indexOf('\\u+') === -1) {
      return normalizeIncoming(s);
    }
    return normalizeIncoming(s
      .replace(/\\[Uu]\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/%%(%|\d{1,3}|[A-Za-z])/g, (m, code) => {
        if (code === '%') return '%';
        if (code >= '0' && code <= '9') {
          const n = parseInt(code, 10);
          if (n >= 32 && n <= 255) {
            return (n >= 0x80 && n <= 0x9F)
              ? String.fromCharCode(CP1252_HIGH[n - 0x80]) : String.fromCharCode(n);
          }
          return '';
        }
        const c = code.toLowerCase();
        if (c === 'd') return '°';
        if (c === 'c') return 'Ø';
        if (c === 'p') return '±';
        if (c === 'u' || c === 'o') return '';
        return m;                        /* unknown %%x — keep literally */
      }));
  };

  const encodeDxfText = (v) => String(v == null ? '' : v)
    .replace(/°/g, '%%d')
    .replace(/Ø/g, '%%c')
    .replace(/±/g, '%%p');

  /* ------------------------------------------------------------------ *
   * ARABIC SHAPING for export (Unicode Presentation Forms-B).
   * Field evidence (the industry standard's 2027 release): even as MTEXT, logical Arabic arriving
   * through \U+ escapes can lose its joins in the industry standard's renderer — the
   * first letter draws isolated. Presentation forms bake the joining into
   * the codepoint itself (initial ت is its own character), so every reader
   * draws the word connected no matter how its shaper behaves. Import
   * normalizes the forms back to plain letters, so our editors always
   * hold logical Arabic.
   * ------------------------------------------------------------------ */
  const AR_FORMS = {};   /* cp -> [isolated, final, initial, medial] */
  [[0x0626, 0xFE89], [0x0628, 0xFE8F], [0x062A, 0xFE95], [0x062B, 0xFE99],
   [0x062C, 0xFE9D], [0x062D, 0xFEA1], [0x062E, 0xFEA5], [0x0633, 0xFEB1],
   [0x0634, 0xFEB5], [0x0635, 0xFEB9], [0x0636, 0xFEBD], [0x0637, 0xFEC1],
   [0x0638, 0xFEC5], [0x0639, 0xFEC9], [0x063A, 0xFECD], [0x0641, 0xFED1],
   [0x0642, 0xFED5], [0x0643, 0xFED9], [0x0644, 0xFEDD], [0x0645, 0xFEE1],
   [0x0646, 0xFEE5], [0x0647, 0xFEE9], [0x064A, 0xFEF1]]
    .forEach(([cp, b]) => { AR_FORMS[cp] = [b, b + 1, b + 2, b + 3]; });
  [[0x0622, 0xFE81], [0x0623, 0xFE83], [0x0624, 0xFE85], [0x0625, 0xFE87],
   [0x0627, 0xFE8D], [0x0629, 0xFE93], [0x062F, 0xFEA9], [0x0630, 0xFEAB],
   [0x0631, 0xFEAD], [0x0632, 0xFEAF], [0x0648, 0xFEED], [0x0649, 0xFEEF]]
    .forEach(([cp, b]) => { AR_FORMS[cp] = [b, b + 1]; });
  AR_FORMS[0x0621] = [0xFE80];                       /* ء never joins       */
  AR_FORMS[0x0640] = [0x0640, 0x0640, 0x0640, 0x0640]; /* tatweel joins both */
  const LAM_ALEF = {                                 /* lam + alef ligatures */
    0x0622: [0xFEF5, 0xFEF6], 0x0623: [0xFEF7, 0xFEF8],
    0x0625: [0xFEF9, 0xFEFA], 0x0627: [0xFEFB, 0xFEFC]
  };
  const AR_TRANS = (cp) => (cp >= 0x064B && cp <= 0x065F) || cp === 0x0670;

  const shapeArabic = (s) => {
    if (!/[ء-ي]/.test(s)) return s;
    const src = Array.from(String(s));
    const out = [];
    let prevJoins = false;                           /* previous glyph joins forward */
    for (let i = 0; i < src.length; i++) {
      const cp = src[i].codePointAt(0);
      if (AR_TRANS(cp)) { out.push(src[i]); continue; }   /* diacritics ride along */
      const f = AR_FORMS[cp];
      if (!f) { out.push(src[i]); prevJoins = false; continue; }
      if (cp === 0x0644 && i + 1 < src.length) {
        const la = LAM_ALEF[src[i + 1].codePointAt(0)];
        if (la) {
          out.push(String.fromCharCode(prevJoins ? la[1] : la[0]));
          i++;                                       /* the alef is consumed */
          prevJoins = false;
          continue;
        }
      }
      const dual = f.length === 4;
      let nextAccepts = false;
      for (let j = i + 1; j < src.length; j++) {
        const nc = src[j].codePointAt(0);
        if (AR_TRANS(nc)) continue;
        const nf = AR_FORMS[nc];
        nextAccepts = !!(nf && nf.length >= 2);
        break;
      }
      const idx = (dual && nextAccepts) ? (prevJoins ? 3 : 2) : (prevJoins ? 1 : 0);
      out.push(String.fromCharCode(f[Math.min(idx, f.length - 1)]));
      prevJoins = dual && nextAccepts;
    }
    return out.join('');
  };

  const AR_UNSHAPE = {};
  Object.keys(AR_FORMS).forEach((cp) => {
    AR_FORMS[cp].forEach((fm) => {
      if (fm !== 0x0640) AR_UNSHAPE[fm] = String.fromCharCode(cp);
    });
  });
  Object.keys(LAM_ALEF).forEach((cp) => {
    LAM_ALEF[cp].forEach((fm) => {
      AR_UNSHAPE[fm] = 'ل' + String.fromCharCode(cp);
    });
  });
  const unshapeArabic = (s) => (/[ﭐ-ﻼ]/.test(s)
    ? s.replace(/[ﭐ-ﻼ]/g, (ch) => AR_UNSHAPE[ch.charCodeAt(0)] || ch)
    : s);

  /* BRACKET MIRRORING (UAX#9 N0-lite). The industry standard positions brackets with its
     bidi but never mirrors the glyph, so an RTL "(كذا)" draws inside-out.
     On RTL lines the exporter swaps each matched pair that encloses Arabic;
     the importer (recognizing our pre-shaped text) swaps them back. */
  const BRACKET_MIRROR = {
    '(': ')', ')': '(', '[': ']', ']': '[',
    '{': '}', '}': '{', '<': '>', '>': '<'
  };
  const strongDirOf = (cp) =>
    ((cp >= 0x0600 && cp <= 0x06FF) || (cp >= 0xFB50 && cp <= 0xFEFC)) ? 'R'
      : ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) ? 'L' : null;
  const mirrorBracketsLine = (line, invert) => {
    if (!/[()[\]{}<>]/.test(line)) return line;
    let dir = null;
    for (const ch of line) {
      dir = strongDirOf(ch.codePointAt(0));
      if (dir) break;
    }
    if (dir !== 'R') return line;               /* LTR lines stay logical */
    const OPEN = invert ? ')]}>' : '([{<';
    const CLOSE = invert ? '([{<' : ')]}>';
    const chars = Array.from(line);
    const stack = [];
    for (let i = 0; i < chars.length; i++) {
      if (OPEN.indexOf(chars[i]) >= 0) { stack.push(i); continue; }
      if (CLOSE.indexOf(chars[i]) >= 0 && stack.length) {
        const j = stack.pop();
        let hasArabic = false;
        for (let k = j + 1; k < i && !hasArabic; k++) {
          hasArabic = strongDirOf(chars[k].codePointAt(0)) === 'R';
        }
        if (hasArabic) {
          chars[j] = BRACKET_MIRROR[chars[j]];
          chars[i] = BRACKET_MIRROR[chars[i]];
        }
      }
    }
    return chars.join('');
  };
  const mirrorBrackets = (s, invert) =>
    s.split('\n').map((l) => mirrorBracketsLine(l, invert)).join('\n');

  /* incoming text: only OUR pre-shaped output (presentation forms are the
     signature) gets unshaped + unmirrored; native logical Arabic from files
     the industry standard itself wrote passes through untouched */
  const normalizeIncoming = (t) => (/[ﭐ-ﻼ]/.test(t)
    ? mirrorBrackets(unshapeArabic(t), true)
    : t);

  /* sample a clamped B-spline (de Boor) — used for control-point-only
     SPLINE import. degree>=1, pts are {x,y}. Returns sampled points. */
  const sampleBSpline = (ctrl, degree, knots, samples) => {
    const n = ctrl.length;
    const p = Math.max(1, Math.min(degree || 3, n - 1));
    let U = Array.isArray(knots) && knots.length === n + p + 1 ? knots.slice() : null;
    if (!U) {
      U = [];
      for (let i = 0; i < n + p + 1; i++) {
        U.push(i <= p ? 0 : (i >= n ? n - p : i - p));
      }
    }
    const u0 = U[p], u1 = U[n];
    const out = [];
    for (let s = 0; s <= samples; s++) {
      const u = u0 + (u1 - u0) * (s / samples);
      /* find knot span k with U[k] <= u < U[k+1] */
      let k = p;
      for (let i = p; i < n; i++) { if (u >= U[i] && u <= U[i + 1] && U[i + 1] > U[i]) { k = i; break; } }
      if (u >= U[n]) k = n - 1;
      const d = [];
      for (let j = 0; j <= p; j++) {
        const c = ctrl[Math.min(n - 1, Math.max(0, j + k - p))];
        d.push({ x: c.x, y: c.y });
      }
      for (let r = 1; r <= p; r++) {
        for (let j = p; j >= r; j--) {
          const i = j + k - p;
          const den = U[i + p - r + 1] - U[i];
          const a = den > 0 ? (u - U[i]) / den : 0;
          d[j] = {
            x: (1 - a) * d[j - 1].x + a * d[j].x,
            y: (1 - a) * d[j - 1].y + a * d[j].y
          };
        }
      }
      out.push(d[p]);
    }
    return out;
  };

  /* WIPEOUT boundary -> world points. Clip vertices live in image pixel
   * space; the mapping (verified against the industry standard's own embedded WCS blob
   * to 16 digits) is WCS = position + u*(cx+0.5) + v*(heightPx-0.5-cy).
   * Exactly 2 clip points are a rectangle's opposite corners; none means
   * the full frame. A duplicate closing vertex (the industry standard's DXF writes the
   * ring closed) is dropped. Shared by the DXF importer and the direct
   * DWG converter (dwg-doc.js) so both emit the same mask. */
  const wipeoutPts = (pos, u, v, wPx, hPx, clip) => {
    if (!isPt(pos) || !isPt(u) || !isPt(v)) return null;
    const w = isNum(wPx) && wPx > 0 ? wPx : 1;
    const h = isNum(hPx) && hPx > 0 ? hPx : 1;
    let cl = Array.isArray(clip) ? clip.filter(isPt) : [];
    if (cl.length === 2) {
      const a = cl[0], b = cl[1];
      cl = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
    } else if (cl.length < 3) {
      cl = [{ x: -0.5, y: -0.5 }, { x: w - 0.5, y: -0.5 },
            { x: w - 0.5, y: h - 0.5 }, { x: -0.5, y: h - 0.5 }];
    }
    const pts = cl.map((c) => {
      const fx = c.x + 0.5, fy = h - 0.5 - c.y;
      return { x: pos.x + u.x * fx + v.x * fy, y: pos.y + u.y * fx + v.y * fy };
    });
    const p0 = pts[0], pN = pts[pts.length - 1];
    if (pts.length > 3 && Math.hypot(pN.x - p0.x, pN.y - p0.y) < 1e-9) pts.pop();
    return pts.length >= 3 ? pts : null;
  };

  /* ------------------------------------------------------------------ *
   * Nested-insert flattening (import support). SPEC2 §15 forbids nested
   * inserts inside block defs, so after parsing, every INSERT found inside
   * a block definition is expanded into transformed copies of the target
   * definition's entities (translate / rotate / uniform-scale).
   * Dependency-free: node tests load this file standalone.
   * ------------------------------------------------------------------ */
  /* The two CONJUGATE semi-diameters of the image of a round curve, turned
     back into the axis pair an ellipse names plus the parameter shift that
     keeps a swept one on the points it drew. A nested reference that scales
     x and y differently makes an ELLIPSE of every circle and arc below it,
     and scaling the radius by |sx| while the centre goes through both
     scales left the curve nowhere near its own centre — one arc-fit
     hairline (radius 3.1 million, sweep 1.8 microradians, under 600×800)
     came out 580,000 definition units away and single-handedly held a
     drawing's extents at five times its true height. */
  const conjAxes = (u, v) => {
    const uu = u.x * u.x + u.y * u.y;
    const vv = v.x * v.x + v.y * v.y;
    const t0 = 0.5 * Math.atan2(2 * (u.x * v.x + u.y * v.y), uu - vv);
    const c0 = Math.cos(t0), s0 = Math.sin(t0);
    const ax = u.x * c0 + v.x * s0, ay = u.y * c0 + v.y * s0;
    const bx = v.x * c0 - u.x * s0, by = v.y * c0 - u.y * s0;
    return {
      rx: Math.hypot(ax, ay), ry: Math.hypot(bx, by),
      rot: Math.atan2(ay, ax), t0, flip: (ax * by - ay * bx) < 0
    };
  };

  const xformBlockChild = (src, base, ins, newId) => {
    const sx = isNum(ins.sx) ? ins.sx : 1;
    const sy = isNum(ins.sy) ? ins.sy : 1;
    const rot = isNum(ins.rot) ? ins.rot : 0;
    const co = Math.cos(rot), si = Math.sin(rot);
    const sr = Math.abs(sx) || 1;               /* uniform scale for r/h */
    const tp = (q) => {
      const x = ((q && isNum(q.x) ? q.x : 0) - base.x) * sx;
      const y = ((q && isNum(q.y) ? q.y : 0) - base.y) * sy;
      return { x: ins.p.x + x * co - y * si, y: ins.p.y + x * si + y * co };
    };
    /* the placement's linear part alone — null unless it squashes, so a
       uniform or mirrored one keeps the arc rules below exactly as they were */
    const squash = Math.abs(Math.abs(sx) - Math.abs(sy)) >
      1e-12 * Math.max(Math.abs(sx), Math.abs(sy), 1);
    const lin = (q) => {
      const x = q.x * sx, y = q.y * sy;
      return { x: x * co - y * si, y: x * si + y * co };
    };
    /* e is filled in as the ellipse the round curve becomes; p0/p1 are the
       source's own sweep, or null for a whole one */
    const toEllipse = (e, c, r0, rr, ro, p0, p1) => {
      const cr = Math.cos(ro), sn = Math.sin(ro);
      const A = conjAxes(lin({ x: r0 * cr, y: r0 * sn }), lin({ x: -rr * sn, y: rr * cr }));
      e.type = 'ellipse'; e.c = tp(c); e.rx = A.rx; e.ry = A.ry; e.rot = A.rot;
      delete e.r;
      if (p0 == null) { delete e.a0; delete e.a1; return e; }
      let s0 = p0 - A.t0, s1 = p1 - A.t0;
      if (A.flip) { const t = s0; s0 = -s1; s1 = -t; }
      e.a0 = s0; e.a1 = s1;
      return e;
    };
    /* a shallow copy suffices: every case below rebuilds the object fields
       it transforms fresh (pts arrays via .map, tp() points, the boundary),
       so no mutable geometry is ever shared with the source definition —
       a JSON deep clone here cost seconds on block-heavy drawings */
    const e = Object.assign({}, src);
    e.id = newId();
    const flip = sx * sy < 0;                   /* mirrored: bulge signs flip */
    switch (e.type) {
      case 'line': e.a = tp(src.a); e.b = tp(src.b); break;
      case 'polyline':
        e.pts = (src.pts || []).map((q) => {
          const o = tp(q);
          if (isNum(q.b) && q.b) o.b = flip ? -q.b : q.b;
          return o;
        });
        if (isNum(src.w) && src.w > 0) e.w = src.w * sr;
        break;
      case 'spline': e.pts = (src.pts || []).map(tp); break;
      case 'mline':
        e.pts = (src.pts || []).map(tp);
        if (isNum(src.scale)) e.scale = src.scale * sr;
        break;
      case 'xline': {
        const q = tp({ x: src.p.x + src.d.x, y: src.p.y + src.d.y });
        e.p = tp(src.p);
        const dl = Math.hypot(q.x - e.p.x, q.y - e.p.y) || 1;
        e.d = { x: (q.x - e.p.x) / dl, y: (q.y - e.p.y) / dl };
        break;
      }
      case 'circle':
        if (squash) return toEllipse(e, src.c, src.r, src.r, 0, null, null);
        e.c = tp(src.c); e.r = src.r * sr; break;
      case 'arc':
        if (squash) return toEllipse(e, src.c, src.r, src.r, 0, src.a0, src.a1);
        e.c = tp(src.c); e.r = src.r * sr;
        /* A negative scale REFLECTS the sweep — the arc runs the other way
           round its centre and its ends trade places — and two of them are
           a half turn. Carrying the stored angles through either drew the
           arc on the far side of its centre, which for the hairline arcs
           real files are full of is a whole diameter from where the industry standard
           draws it (a 290-unit radius put a nested symbol 580 units out). */
        if (flip) {
          const m = (sx < 0 ? Math.PI : 0) + rot;
          e.a0 = m - src.a1; e.a1 = m - src.a0;
        } else {
          const t = (sx < 0 ? Math.PI : 0) + rot;
          e.a0 = src.a0 + t; e.a1 = src.a1 + t;
        }
        break;
      case 'ellipse':
        if (squash) {
          return toEllipse(e, src.c, src.rx, src.ry, src.rot || 0,
            isNum(src.a0) && isNum(src.a1) ? src.a0 : null, src.a1);
        }
        e.c = tp(src.c); e.rx = src.rx * sr; e.ry = src.ry * sr;
        e.rot = (src.rot || 0) + rot;
        break;
      case 'text':
        e.p = tp(src.p); e.h = (isNum(src.h) && src.h > 0 ? src.h : 5) * sr;
        if (isPt(src.p2)) e.p2 = tp(src.p2);
        e.rot = (src.rot || 0) + rot;
        break;
      case 'point': e.p = tp(src.p); break;
      case 'leader':
        e.pts = (src.pts || []).map(tp);
        e.h = (isNum(src.h) && src.h > 0 ? src.h : 2.5) * sr;
        break;
      case 'hatch': {
        const b = src.boundary;
        if (!b || typeof b !== 'object') return null;
        if (b.kind === 'pline' && Array.isArray(b.pts)) {
          e.boundary = { kind: 'pline', pts: b.pts.map(tp), closed: true };
        } else if (squash && (b.kind === 'circle' || b.kind === 'ellipse')) {
          const q = toEllipse({}, b.c,
            b.kind === 'circle' ? b.r : b.rx, b.kind === 'circle' ? b.r : b.ry,
            b.rot || 0, null, null);
          e.boundary = { kind: 'ellipse', c: q.c, rx: q.rx, ry: q.ry, rot: q.rot };
        } else if (b.kind === 'circle') {
          e.boundary = { kind: 'circle', c: tp(b.c), r: b.r * sr };
        } else if (b.kind === 'ellipse') {
          e.boundary = {
            kind: 'ellipse', c: tp(b.c), rx: b.rx * sr, ry: b.ry * sr,
            rot: (b.rot || 0) + rot
          };
        } else return null;
        if (isNum(src.sp) && src.sp > 0) e.sp = src.sp * sr;
        break;
      }
      default:
        return null;                             /* insert / unknown → caller */
    }
    return e;
  };

  /* Expand nested INSERTs inside every block def, in place. Depth-limited
     (8) and cycle-safe (name stack). Unresolvable references are dropped;
     warnings are aggregated (one line each), never per-block spam. */
  const flattenNestedInserts = (blocks, warnings, newId) => {
    let expanded = 0, dropped = 0;
    const done = Object.create(null);
    const flatten = (name, stack) => {
      const def = blocks[name];
      if (!def || done[name]) return;
      done[name] = true;
      const src = Array.isArray(def.entities) ? def.entities : [];
      if (!src.some(e => e && e.type === 'insert')) return;
      const out = [];
      for (const ent of src) {
        if (!ent) continue;
        if (ent.type !== 'insert') { out.push(ent); continue; }
        const tgtName = ent.name;
        const tgt = blocks[tgtName];
        if (!tgt || tgtName === name || stack.indexOf(tgtName) !== -1 ||
            stack.length >= 8) { dropped++; continue; }
        flatten(tgtName, stack.concat(name));
        const base = isPt(tgt.base) ? tgt.base : { x: 0, y: 0 };
        for (const child of (Array.isArray(tgt.entities) ? tgt.entities : [])) {
          const copy = child && xformBlockChild(child, base, ent, newId);
          if (copy) out.push(copy);
        }
        expanded++;
      }
      def.entities = out;
    };
    for (const nm of Object.keys(blocks)) flatten(nm, []);
    if (expanded) {
      warnings.push(expanded + ' nested block reference' +
        (expanded === 1 ? '' : 's') + ' expanded.');
    }
    if (dropped) {
      warnings.push(dropped + ' nested block reference' +
        (dropped === 1 ? '' : 's') + ' dropped (missing or cyclic definition).');
    }
  };

  /* ================================================================== *
   * EXPORT
   * ================================================================== */
  /* The writer is a GENERATOR: it yields at natural checkpoints (every
     few hundred entities) and returns the finished text. exportDoc drives
     it to completion in one go — byte-for-byte the classic export — and
     the desktop save drives the same generator on a 6ms budget so a heavy
     drawing's save never holds the thread (SPEC §18; engine's
     LOAD_SLICE_MS idiom). */
  function* exportDocGen(doc, opts) {
    const out = [];
    /* opts.thumbnail: the preview a file manager shows — a Windows DIB
       (base64 or bytes), written as the THUMBNAILIMAGE section right after
       HEADER, the way the format lays it out. Readers that do not know the
       section skip it; ours and nasjidwg's do. */
    const thumbnail = opts && opts.thumbnail ? opts.thumbnail : null;
    /* THE ETERNAL ARABIC FIX. An R2000 ASCII DXF is codepage text, not
       UTF-8: raw Arabic (or any non-ASCII) bytes turn to mojibake the
       moment the industry standard opens the file. Every character above ASCII therefore
       travels as the industry standard's own \U+XXXX escape — text, layer names, block
       names, everything — and every reader (ours included, see
       decodeDxfText) rebuilds the exact character. */
    const escU = (s) => {
      let r = '';
      for (let i = 0; i < s.length; i++) {
        const cu = s.charCodeAt(i);
        r += (cu > 126)
          ? '\\U+' + cu.toString(16).toUpperCase().padStart(4, '0')
          : s[i];
      }
      return r;
    };
    const w = (code, val) => {
      let v = String(val);
      if (/[^\x00-\x7E]/.test(v)) v = escU(v);
      out.push(String(code), v);
    };
    let handleCounter = 0x100;
    const handle = () => (handleCounter++).toString(16).toUpperCase();
    /* the plot-style dictionary and its Normal placeholder: fixed, low
       handles the way the industry standard numbers them, below the counter */
    const PLOTSTYLE_DICT = 'E';
    const PLOTSTYLE_HOLDER = 'F';

    const layers = Array.isArray(doc.layers) && doc.layers.length
      ? doc.layers
      : [{ id: '0', name: '0', color: '#ffffff', on: true, frozen: false, locked: false }];
    /* one map, not a per-entity linear find — 738 layers × 1.6 million
       entity writes was most of a heavy export. First match kept, exactly
       as find() answered. */
    const layerById = new Map();
    for (const ly of layers) if (!layerById.has(ly.id)) layerById.set(ly.id, ly);
    const layerName = (id) => {
      const ly = layerById.get(id);
      return (ly && ly.name) ? String(ly.name) : '0';
    };
    const blocks = Object.assign({}, (doc.blocks && typeof doc.blocks === 'object') ? doc.blocks : {});
    // Native AI dimensions remain DIMENSION records, with an anonymous display
    // block for readers that do not regenerate them. Do not mutate doc.blocks.
    // Autodesk DXF: AcDbDimension + AcDbAlignedDimension (+ AcDbRotatedDimension).
    const nativeDims = new Map(), dimNames = new Set();
    for (const e of doc.entities || []) {
      if (!e.aiGroup || e.type !== 'dim' || !['linear','aligned'].includes(e.kind) || ![e.p1,e.p2,e.p3].every(isPt)) continue;
      let parts; try { parts=Nasj.explode(doc,e); } catch (_) { continue; }
      if (!Array.isArray(parts) || !parts.length) continue;
      let i=1;while(blocks['*D'+i])i++;
      const name='*D'+i, style='NASJI_DIM_'+i;
      blocks[name]={base:{x:0,y:0},entities:parts};dimNames.add(name);
      const textPart=parts.find(p=>p.type==='text'), textBox=textPart && Nasj.geom.entityBounds(textPart);
      nativeDims.set(e,{name,style,h:e.h||2.5,textMid:textBox ? {x:(textBox.minx+textBox.maxx)/2,y:(textBox.miny+textBox.maxy)/2} : e.p3});
    }
    /* *Model_Space / *Paper_Space are written unconditionally below — never
       emit doc.blocks entries with those names (some importers stash them). */
    const isSystemBlock = (nm) => /^\*(model_space|paper_space)/i.test(String(nm));
    const blockNames = Object.keys(blocks).filter((nm) => !isSystemBlock(nm));
    /* '*'-prefixed names are RESERVED anonymous blocks (owned by dimensions
       etc.) — real CAD rejects files where a foreign writer defines them as
       ordinary blocks. Rename on export; inserts follow the map. */
    const blockRename = {};
    for (const nm of blockNames) {
      blockRename[nm] = dimNames.has(nm) ? nm : String(nm)
        .replace(/^\*/, 'ND_')
        .replace(/[<>\/\\":;?*|=`,]/g, '_');
    }
    const outBlockName = (nm) => blockRename[nm] || nm;

    /* Ownership handles: entities must reference their owner BLOCK_RECORD
       (330) or LibreDWG/strict readers drop them from model space.
       *Model_Space / *Paper_Space use the industry standard's CANONICAL handles (1F/1B) so
       DWG converters merge into their template records instead of creating a
       duplicate, empty model space (which the industry standard itself would then read). */
    const msRecHandle = '1F';                   /* *Model_Space  */
    const psRecHandle = '1B';                   /* *Paper_Space  */
    const blockRecHandle = {};                  /* name -> handle */
    for (const nm of blockNames) blockRecHandle[nm] = handle();
    /* MLINE entities point at the STANDARD MLINESTYLE object by handle;
       the object itself lands in OBJECTS only when one was written */
    const mlineDictHandle = handle();
    const mlineStyleHandle = handle();
    let wroteMline = false;

    /* ---- THE SAVED VIEW -------------------------------------------------
       A DXF that declares no extents and no viewport opens whereever the
       reading CAD's default template happens to look — for the industry standard that is
       a small window at the origin, so a 2000-unit drawing needs ZOOM ALL
       before anything is visible. Three things fix it together, and all
       three are needed:
         $EXTMIN/$EXTMAX   what ZOOM EXTENTS uses, and what a viewer reads
                           to frame a preview
         $LIMMIN/$LIMMAX   what ZOOM ALL uses — it frames the LIMITS union
                           the extents, so stale default limits (an A3 sheet
                           at the origin) are exactly what makes ZOOM ALL
                           land zoomed out with the drawing in a corner
         VPORT *Active     the view actually restored on open: centre and
                           height. Without the record there is nothing to
                           restore and the template's own view wins.
       The bbox is computed from the entities themselves rather than tracked
       while writing, because the header is written first. --------------- */
    const ext = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
    const grow = (x, y) => {
      if (!isNum(x) || !isNum(y)) return;
      if (x < ext.minx) ext.minx = x;
      if (x > ext.maxx) ext.maxx = x;
      if (y < ext.miny) ext.miny = y;
      if (y > ext.maxy) ext.maxy = y;
    };
    const growPts = (pts) => {
      if (!Array.isArray(pts)) return;
      for (const p of pts) if (isPt(p)) grow(p.x, p.y);
    };
    /* Annotations are written as their exploded parts (SPEC2 §17), and the
       extents must frame those same parts — but exploding once for the
       header and AGAIN for the writer paid the whole cost twice and threw
       the first result away. The pre-pass parks each explosion here and
       the writer takes it (and frees it) when that entity's turn comes. */
    const explodeCache = new Map();
    const explodeOf = (ent) => {
      if (explodeCache.has(ent)) return explodeCache.get(ent);
      let parts = null;
      try { parts = Nasj.explode(doc, ent); } catch (e) { parts = null; }
      explodeCache.set(ent, parts);
      return parts;
    };

    /* ---- a dimension goes out AS a dimension. AutoCAD keeps one as its
       definition points (a DIMENSION record) plus an anonymous *D block of
       the drawn lines, arrowheads and text; that is what cadDimension
       (import) turns back into the app's own, so a saved drawing reopens
       with each dimension ONE object again, not a line, two triangles and
       a text with a grip on every one. The points go out by the same
       codes cadDimension reads them by. A kind it does not read back
       (none today) keeps the exploded form below. ---- */
    const dimRecord = (e) => {
      const P = (p) => isPt(p) ? { x: p.x, y: p.y } : null;
      const p1 = P(e.p1), p2 = P(e.p2), p3 = P(e.p3), p4 = P(e.p4);
      const D = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
      switch (e.kind) {
        case 'linear': {
          if (!p1 || !p2 || !p3 || (e.orient !== 'h' && e.orient !== 'v')) return null;
          const v = e.orient === 'v';
          return { type: 0, def: p3, p13: p1, p14: p2, rot: v ? 90 : 0,
            meas: Math.abs(v ? p2.y - p1.y : p2.x - p1.x) };
        }
        case 'aligned':
          if (!p1 || !p2 || !p3) return null;
          return { type: 1, def: p3, p13: p1, p14: p2, meas: D(p1, p2) };
        case 'radius':
          if (!p1 || !p2) return null;
          return { type: 4, def: p1, p15: p2, tm: p3 || p2, user: true, meas: D(p1, p2) };
        case 'diameter':
          if (!p1 || !p2) return null;
          /* 10 and 15 straddle the centre */
          return { type: 3, def: { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y }, p15: p2,
            tm: p3 || p2, user: true, meas: 2 * D(p1, p2) };
        case 'angular': {
          if (!p1 || !p2 || !p3 || !p4) return null;
          const TAU = Math.PI * 2, wrap = (a) => ((a % TAU) + TAU) % TAU;
          const a = Math.atan2(p2.y - p1.y, p2.x - p1.x), b = Math.atan2(p3.y - p1.y, p3.x - p1.x);
          const m = Math.atan2(p4.y - p1.y, p4.x - p1.x);
          let sw = wrap(b - a);
          if (wrap(m - a) > sw) sw = TAU - sw;   /* the arc point picks the angle */
          return { type: 5, def: p4, p13: p2, p14: p3, p15: p1, meas: sw };
        }
        default: return null;
      }
    };
    const dimBlocks = [];                    /* {ent, rec: DIMENSION groups, name, owner, parts} */
    const dimBlockOf = new Map();
    if (typeof Nasj.explode === 'function' && Array.isArray(doc.entities)) {
      for (const ent of doc.entities) {
        if (!ent || ent.type !== 'dim') continue;
        const rec = dimRecord(ent);
        if (!rec) continue;
        const parts = explodeOf(ent);
        if (!Array.isArray(parts) || !parts.length) continue;
        /* the text's middle (group 11), read off the drawn geometry */
        if (!rec.tm && Nasj.geom && typeof Nasj.geom.entityAnno === 'function') {
          try {
            const t = Nasj.geom.entityAnno(ent).texts[0];
            if (t && isPt(t.p)) rec.tm = t.anchor === 'center' ? { x: t.p.x, y: t.p.y } : Nasj.geom.annoTextOrigin(t);
          } catch (_) { /* no text, no middle */ }
        }
        const b = { ent, rec, name: '*D' + (dimBlocks.length + 1), owner: handle(), parts };
        dimBlocks.push(b);
        dimBlockOf.set(ent, b);
      }
    }
    /* the DIMSTYLE variables a style sets, by header name, table code and
       kind — the header carries the current style's (this app's reader
       takes them from there), the table every style a dimension names */
    const curDimStyle = (doc.styles && doc.styles.dim && doc.styles.dim.current) || '';
    const dimStyleName = (e) => (e && e.style && String(e.style).trim()) || curDimStyle || 'Standard';
    const dimStyleOf = (name) => (Nasj.geom && typeof Nasj.geom.dimStyleOf === 'function')
      ? Nasj.geom.dimStyleOf(doc, { style: name }) : null;
    const TVERT = ['Centered', 'Above', 'Outside', 'JIS', 'Below'];
    const ZIN = { None: 0, Leading: 4, Trailing: 8, Both: 12 };
    const DIMVARS = [
      ['DIMSCALE', 40, 'r', (s) => s.scale], ['DIMASZ', 41, 'r', (s) => s.asz],
      ['DIMEXO', 42, 'r', (s) => s.exo], ['DIMDLI', 43, 'r', (s) => s.dli],
      ['DIMEXE', 44, 'r', (s) => s.exe], ['DIMRND', 45, 'r', (s) => s.rnd],
      ['DIMDLE', 46, 'r', (s) => s.dle], ['DIMTXT', 140, 'r', (s) => s.txtH],
      ['DIMCEN', 141, 'r', (s) => s.cen === 'None' ? 0 : (s.cen === 'Line' ? -s.cenSize : s.cenSize)],
      ['DIMLFAC', 144, 'r', (s) => s.lfac], ['DIMGAP', 147, 'r', (s) => s.gap],
      ['DIMTIH', 73, 'i', (s) => s.talign === 'Horizontal' ? 1 : 0],
      ['DIMTOH', 74, 'i', (s) => s.talign === 'Aligned' ? 0 : 1],
      ['DIMSE1', 75, 'i', (s) => s.se1 ? 1 : 0], ['DIMSE2', 76, 'i', (s) => s.se2 ? 1 : 0],
      ['DIMTAD', 77, 'i', (s) => Math.max(0, TVERT.indexOf(s.tvert))],
      ['DIMZIN', 78, 'i', (s) => ZIN[s.zin] || 0],
      ['DIMTOFL', 172, 'i', (s) => s.tofl ? 1 : 0],
      ['DIMADEC', 179, 'i', (s) => s.aprec], ['DIMDEC', 271, 'i', (s) => s.prec],
      ['DIMAUNIT', 275, 'i', (s) => s.aunit], ['DIMLUNIT', 277, 'i', (s) => s.lunit],
      ['DIMSD1', 281, 'i', (s) => s.sd1 ? 1 : 0], ['DIMSD2', 282, 'i', (s) => s.sd2 ? 1 : 0],
      ['DIMPOST', 3, 's', (s) => (s.pre || s.suf) ? String(s.pre || '') + '<>' + String(s.suf || '') : ''],
    ];
    const writeDimVars = (st, header) => {
      for (const [nm, code, kind, get] of DIMVARS) {
        let v;
        try { v = get(st); } catch (_) { continue; }
        if (kind === 's') { if (!v) continue; }
        else if (!isNum(v)) continue;
        if (header) w(9, '$' + nm);
        const c = header ? (kind === 's' ? 1 : (kind === 'r' ? 40 : 70)) : code;
        w(c, kind === 's' ? encodeDxfText(v) : (kind === 'r' ? fmt(v) : Math.round(v)));
      }
    };
    /* A radius bound is the circumscribed box: never smaller than the true
       arc/ellipse bbox, so the view can be generous but never clip. */
    const growEnt = (ent, depth) => {
      if (!ent || typeof ent !== 'object' || depth > 4) return;
      switch (ent.type) {
        case 'line': growPts([ent.a, ent.b]); break;
        case 'polyline': case 'spline': case 'face3d': growPts(ent.pts); break;
        case 'box': case 'solid': case 'wall': case 'slab':
          if (Nasj.solid) for (const r of Nasj.solid.footprint(ent)) growPts(r);
          break;
        case 'circle': case 'arc':
          if (isPt(ent.c) && isNum(ent.r)) {
            grow(ent.c.x - ent.r, ent.c.y - ent.r);
            grow(ent.c.x + ent.r, ent.c.y + ent.r);
          }
          break;
        case 'ellipse':
          if (isPt(ent.c)) {
            const rr = Math.max(isNum(ent.rx) ? ent.rx : 0, isNum(ent.ry) ? ent.ry : 0);
            grow(ent.c.x - rr, ent.c.y - rr);
            grow(ent.c.x + rr, ent.c.y + rr);
          }
          break;
        case 'text': {
          if (!isPt(ent.p)) break;
          const hgt = isNum(ent.h) ? ent.h : 5;
          const wide = String(ent.str == null ? '' : ent.str).length * hgt * 0.8;
          grow(ent.p.x, ent.p.y - hgt);
          grow(ent.p.x + wide, ent.p.y + hgt);
          if (isPt(ent.p2)) grow(ent.p2.x, ent.p2.y);
          break;
        }
        case 'point': case 'insert': if (isPt(ent.p)) grow(ent.p.x, ent.p.y); break;
        case 'hatch': {
          const b = ent.boundary;
          if (!b) break;
          growPts(b.pts);
          if (Array.isArray(b.loops)) for (const lp of b.loops) growPts(lp && lp.pts ? lp.pts : lp);
          if (isPt(b.c) && isNum(b.r)) {
            grow(b.c.x - b.r, b.c.y - b.r);
            grow(b.c.x + b.r, b.c.y + b.r);
          }
          break;
        }
        /* XLINE and RAY are infinite: the industry standard leaves them out of the extents
           and so must we, or one construction line blows the view up to the
           whole coordinate space. */
        case 'xline': break;
        case 'dim': case 'leader': case 'table': case 'mline': {
          /* the same explosion the writer emits, so the view frames what
             actually lands in the file — parked for the writer to reuse */
          if (typeof Nasj.explode !== 'function') break;
          const parts = explodeOf(ent);
          if (Array.isArray(parts)) for (const p of parts) growEnt(p, depth + 1);
          break;
        }
        default: break;
      }
    };

    /* an '@bg' SOLID hatch over a polyline boundary IS this app's wipeout
       (WIPEOUT / TEXTMASK, tools.js) — it travels as a WIPEOUT record, so
       the mask survives the round-trip. Frame = the boundary bbox; clip
       vertices invert the wipeoutPts import mapping exactly. Degenerate
       boundaries (zero span, < 3 points) return null and keep the
       plain-HATCH path. Used by the entity writer AND, before the header
       is written, to decide whether the CLASSES section is needed. */
    /* a planar polygon cut into triangles by ear clipping, in the plane's
       own two axes — concave outlines (an L-shaped wall's top) cut right */
    const earClip = (pts, n) => {
      const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      const uv = az >= ax && az >= ay ? (p) => [p.x, p.y]
        : ax >= ay ? (p) => [p.y, isNum(p.z) ? p.z : 0] : (p) => [isNum(p.z) ? p.z : 0, p.x];
      const P = pts.map(uv);
      let area = 0;
      for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; area += a[0] * b[1] - b[0] * a[1]; }
      const sgn = area >= 0 ? 1 : -1;
      const idx = pts.map((_, i) => i);
      const out = [];
      const cross = (a, b, c) => ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) * sgn;
      const inside = (a, b, c, p) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
      let guard = 0;
      while (idx.length > 3 && guard++ < 4 * pts.length) {
        let cut = false;
        for (let i = 0; i < idx.length; i++) {
          const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
          const a = P[i0], b = P[i1], c = P[i2];
          if (cross(a, b, c) <= 0) continue;
          let clear = true;
          for (const j of idx) {
            if (j === i0 || j === i1 || j === i2) continue;
            if (inside(a, b, c, P[j])) { clear = false; break; }
          }
          if (!clear) continue;
          out.push([pts[i0], pts[i1], pts[i2]]);
          idx.splice(i, 1);
          cut = true;
          break;
        }
        if (!cut) break;
      }
      if (idx.length === 3) out.push([pts[idx[0]], pts[idx[1]], pts[idx[2]]]);
      return out;
    };
    const wipeoutFrame = (ent) => {
      if (!ent || ent.type !== 'hatch' || ent.color !== '@bg' ||
          ent.pattern !== 'SOLID') return null;
      const b = ent.boundary;
      if (!b || b.kind !== 'pline' || !Array.isArray(b.pts)) return null;
      const pts = b.pts.filter(isPt);
      if (pts.length < 3) return null;
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const p of pts) {
        if (p.x < minx) minx = p.x;
        if (p.x > maxx) maxx = p.x;
        if (p.y < miny) miny = p.y;
        if (p.y > maxy) maxy = p.y;
      }
      const bw = maxx - minx, bh = maxy - miny;
      if (bw <= 1e-12 || bh <= 1e-12) return null;
      return { pts, minx, miny, bw, bh };
    };

    /* ---- ONE pre-pass over model space: the extents, the wipeout flag
       the CLASSES section needs, and the arc-text count the tail used to
       take three separate walks (and a discarded explosion) for. ---- */
    let sawWipeout = false;
    let skippedArcText = 0;
    {
      const list = Array.isArray(doc.entities) ? doc.entities : [];
      for (let i = 0; i < list.length; i++) {
        const ent = list[i];
        growEnt(ent, 0);
        if (!sawWipeout && wipeoutFrame(ent)) sawWipeout = true;
        if (ent && ent.type === 'arctext') skippedArcText++;
        if ((i & 511) === 511) yield { phase: 'extents', done: i + 1, total: list.length };
      }
    }

    /* An empty drawing has no extents to state; the industry standard's own "nothing here"
       sentinel is a min above a max, and every reader knows to ignore it. */
    const hasExt = ext.maxx >= ext.minx && ext.maxy >= ext.miny;
    const exMin = hasExt ? { x: ext.minx, y: ext.miny } : { x: 1e20, y: 1e20 };
    const exMax = hasExt ? { x: ext.maxx, y: ext.maxy } : { x: -1e20, y: -1e20 };
    const spanX = hasExt ? Math.max(ext.maxx - ext.minx, 1e-6) : 100;
    const spanY = hasExt ? Math.max(ext.maxy - ext.miny, 1e-6) : 100;
    const ctrX = hasExt ? (ext.minx + ext.maxx) / 2 : 0;
    const ctrY = hasExt ? (ext.miny + ext.maxy) / 2 : 0;
    /* VIEW_ASPECT is the shape of a plausible CAD window: the saved height
       must cover the drawing once that aspect has had its say, or a wide
       drawing in a tall window is cropped left and right on open. */
    const VIEW_ASPECT = 1.6;
    const VIEW_MARGIN = 1.06;
    const viewH = Math.max(spanY, spanX / VIEW_ASPECT) * VIEW_MARGIN;

    /* ---- HEADER ---- */
    w(0, 'SECTION'); w(2, 'HEADER');
    w(9, '$ACADVER'); w(1, 'AC1015');
    w(9, '$DWGCODEPAGE'); w(3, 'ANSI_1252');   /* non-ASCII never relies on it */
    /* drawing units (UNITS) travel with the file, so the industry standard opens it
       showing the same lengths and angles this app shows */
    const un = (Nasj.settings && Nasj.settings.units) || {};
    const uv = (k, dflt) => (typeof un[k] === 'number' ? un[k] : dflt);
    w(9, '$INSUNITS'); w(70, uv('insunits', 4));
    w(9, '$LUNITS'); w(70, uv('lunits', 2));
    w(9, '$LUPREC'); w(70, uv('luprec', 4));
    w(9, '$AUNITS'); w(70, uv('aunits', 0));
    w(9, '$AUPREC'); w(70, uv('auprec', 2));
    w(9, '$ANGBASE'); w(50, fmt(uv('angbase', 0)));
    w(9, '$ANGDIR'); w(70, uv('angdir', 0));
    /* the point glyph travels with the drawing, as in the industry standard */
    const st = Nasj.settings || {};
    w(9, '$PDMODE'); w(70, Math.round(Number(st.pdmode) || 0));
    w(9, '$PDSIZE'); w(40, fmt(Number(st.pdsize) || 0));
    w(9, '$EXTMIN'); w(10, fmt(exMin.x)); w(20, fmt(exMin.y)); w(30, 0);
    w(9, '$EXTMAX'); w(10, fmt(exMax.x)); w(20, fmt(exMax.y)); w(30, 0);
    /* limits = the extents, so ZOOM ALL and ZOOM EXTENTS agree */
    w(9, '$LIMMIN'); w(10, fmt(hasExt ? ext.minx : 0)); w(20, fmt(hasExt ? ext.miny : 0));
    w(9, '$LIMMAX'); w(10, fmt(hasExt ? ext.maxx : 100)); w(20, fmt(hasExt ? ext.maxy : 100));
    w(9, '$LIMCHECK'); w(70, 0);       /* limits frame the view, never gate input */
    w(9, '$VIEWCTR'); w(10, fmt(ctrX)); w(20, fmt(ctrY));
    w(9, '$VIEWSIZE'); w(40, fmt(viewH));
    w(9, '$HANDSEED'); w(5, 'FFFF');
    if (dimBlocks.length) {
      /* the current dimension style, the way AutoCAD's header carries it */
      const cur = dimStyleName(null), st = dimStyleOf(cur);
      w(9, '$DIMSTYLE'); w(2, encodeDxfText(cur));
      if (st) writeDimVars(st, true);
    }
    w(0, 'ENDSEC');

    /* ---- THUMBNAILIMAGE: the DIB, 128 bytes (256 hex digits) a line ---- */
    if (thumbnail) {
      const bytes = typeof thumbnail === 'string'
        ? Uint8Array.from(atob(thumbnail), (c) => c.charCodeAt(0)) : thumbnail;
      if (bytes.length) {
        w(0, 'SECTION'); w(2, 'THUMBNAILIMAGE');
        w(90, bytes.length);
        for (let i = 0; i < bytes.length; i += 128) {
          let hex = '';
          for (let k = i; k < Math.min(i + 128, bytes.length); k++) {
            hex += (bytes[k] < 16 ? '0' : '') + bytes[k].toString(16).toUpperCase();
          }
          w(310, hex);
        }
        w(0, 'ENDSEC');
      }
    }

    /* ---- CLASSES. Always: the plot-style dictionary every LAYER points
       into (OBJECTS, below) is a with-default dictionary holding a
       placeholder, and both are class-numbered objects the industry standard registers
       in every R2000+ file it writes; a file that lacks them is refused by
       Open ("Error in LAYER Table"). WIPEOUT joins them only when one will
       be emitted: DXFIN drops an unregistered WIPEOUT ("Unknown object
       type"), and with the class registered reads it back group-for-group. ---- */
    const anyWipeout = (list) => Array.isArray(list) && list.some(wipeoutFrame);
    w(0, 'SECTION'); w(2, 'CLASSES');
    w(0, 'CLASS'); w(1, 'ACDBDICTIONARYWDFLT'); w(2, 'AcDbDictionaryWithDefault');
    w(3, 'ObjectDBX Classes'); w(90, 0); w(280, 0); w(281, 0);
    w(0, 'CLASS'); w(1, 'ACDBPLACEHOLDER'); w(2, 'AcDbPlaceholder');
    w(3, 'ObjectDBX Classes'); w(90, 0); w(280, 0); w(281, 0);
    if (sawWipeout ||
        blockNames.some((nm) => anyWipeout((blocks[nm] || {}).entities))) {
      w(0, 'CLASS'); w(1, 'WIPEOUT'); w(2, 'AcDbWipeout'); w(3, 'WipeOut');
      w(90, 0); w(280, 0); w(281, 1);
    }
    w(0, 'ENDSEC');

    /* ---- TABLES ---- */
    w(0, 'SECTION'); w(2, 'TABLES');

    /* VPORT — the *Active record IS the view a CAD restores when the file
       opens. 12/22 is the view centre in DCS and 40 the view HEIGHT (the
       width follows from 41, the window's aspect); 16/26/36 looks straight
       down at the XY plane. Named *Active rather than *ACTIVE because that
       is the spelling the industry standard writes and some readers match it verbatim. */
    w(0, 'TABLE'); w(2, 'VPORT'); w(5, handle()); w(100, 'AcDbSymbolTable'); w(70, 1);
    w(0, 'VPORT'); w(5, handle());
    w(100, 'AcDbSymbolTableRecord'); w(100, 'AcDbViewportTableRecord');
    w(2, '*Active'); w(70, 0);
    /* What the industry standard saves is the view on screen, so that is what goes out:
       the live viewport when this doc is the one being looked at, the
       extents-fitted default otherwise (the website's node path has no
       viewport at all). Groups 12/22 live in the twisted frame (DCS). */
    const live = (HAS_WINDOW && doc === Nasj.doc && Nasj.viewport &&
      typeof Nasj.viewport.savedView === 'function')
      ? Nasj.viewport.savedView() : null;
    const twist0 = live ? (live.twist || 0)
      : ((Nasj.doc && Nasj.doc.view && isNum(Nasj.doc.view.twist))
        ? Nasj.doc.view.twist : 0);
    const twDeg = twist0 * DEG;
    const twc = Math.cos(twist0), tws = Math.sin(twist0);
    const dcsX = live ? live.center.x : (ctrX * twc - ctrY * tws);
    const dcsY = live ? live.center.y : (ctrX * tws + ctrY * twc);
    const outViewH = (live && live.height > 0) ? live.height : viewH;
    w(10, 0); w(20, 0);                          /* viewport lower-left  */
    w(11, 1); w(21, 1);                          /* viewport upper-right */
    w(12, fmt(dcsX)); w(22, fmt(dcsY));          /* view centre (DCS)    */
    w(13, 0); w(23, 0);                          /* snap base            */
    w(14, 10); w(24, 10);                        /* snap spacing         */
    w(15, 10); w(25, 10);                        /* grid spacing         */
    w(16, 0); w(26, 0); w(36, 1);                /* view direction: +Z   */
    w(17, 0); w(27, 0); w(37, 0);                /* view target          */
    w(40, fmt(outViewH));                        /* view height          */
    w(41, fmt(VIEW_ASPECT));                     /* aspect ratio         */
    w(42, 50); w(43, 0); w(44, 0);               /* lens, front/back clip */
    w(50, 0); w(51, fmt(twDeg));                 /* snap / view twist    */
    w(71, 0); w(72, 100); w(73, 1); w(74, 3); w(75, 0);
    w(76, 0); w(77, 0); w(78, 0);
    w(0, 'ENDTAB');

    w(0, 'TABLE'); w(2, 'LTYPE'); w(5, handle()); w(100, 'AcDbSymbolTable'); w(70, 7);
    const ltypeRec = (name, desc, elems) => {
      w(0, 'LTYPE'); w(5, handle());
      w(100, 'AcDbSymbolTableRecord'); w(100, 'AcDbLinetypeTableRecord');
      w(2, name); w(70, 0); w(3, desc); w(72, 65); w(73, elems.length);
      w(40, fmt(elems.reduce((s, e) => s + Math.abs(e), 0)));
      for (const e of elems) { w(49, fmt(e)); w(74, 0); }
    };
    /* ByBlock and ByLayer lead the table in every R2000+ file: Open refuses
       a drawing without them ("Missing Default entry ByLayer") */
    ltypeRec('ByBlock', '', []);
    ltypeRec('ByLayer', '', []);
    ltypeRec('Continuous', 'Solid line', []);
    ltypeRec('DASHED', 'Dashed __ __ __', [0.5, -0.25]);
    ltypeRec('CENTER', 'Center ____ _ ____', [1.25, -0.25, 0.25, -0.25]);
    ltypeRec('HIDDEN', 'Hidden __ __', [0.25, -0.125]);
    ltypeRec('DOT', 'Dot . . .', [0, -0.25]);
    w(0, 'ENDTAB');

    const LT_OUT = { dashed: 'DASHED', center: 'CENTER', hidden: 'HIDDEN', dot: 'DOT' };
    const ltName = (lt) => LT_OUT[String(lt || '').toLowerCase()] || 'Continuous';

    w(0, 'TABLE'); w(2, 'LAYER'); w(5, handle()); w(100, 'AcDbSymbolTable');
    w(70, layers.length);
    for (const ly of layers) {
      const aci = Math.max(1, nearestAci(ly.color || '#ffffff'));
      w(0, 'LAYER'); w(5, handle());
      w(100, 'AcDbSymbolTableRecord'); w(100, 'AcDbLayerTableRecord');
      w(2, ly.name != null ? ly.name : '0');
      w(70, (ly.frozen ? 1 : 0) | (ly.locked ? 4 : 0));
      w(62, ly.on === false ? -aci : aci);
      w(420, hexToInt(ly.color || '#ffffff'));
      w(6, ltName(ly.lt));
      if (String(ly.name).toUpperCase() === 'A-AI-SEL') w(290, 0);
      if (typeof ly.lw === 'number' && isFinite(ly.lw)) w(370, Math.round(ly.lw * 100));
      /* the plot style, by handle: Open refuses a LAYER without it */
      w(390, PLOTSTYLE_HOLDER);
    }
    w(0, 'ENDTAB');

    /* STYLE, VIEW, UCS, APPID, DIMSTYLE: every one goes out even when
       empty. Open discards the whole drawing over a missing symbol table
       ("Missing SymbolTable:VIEW"), and every TEXT names Standard, every
       DIMENSION a dimension style. */
    w(0, 'TABLE'); w(2, 'STYLE'); w(5, handle()); w(100, 'AcDbSymbolTable'); w(70, 1);
    w(0, 'STYLE'); w(5, handle());
    w(100, 'AcDbSymbolTableRecord'); w(100, 'AcDbTextStyleTableRecord');
    w(2, 'Standard'); w(70, 0); w(40, fmt(0)); w(41, fmt(1)); w(50, fmt(0)); w(71, 0); w(42, 2.5);
    w(3, 'txt'); w(4, '');
    w(0, 'ENDTAB');
    w(0, 'TABLE'); w(2, 'VIEW'); w(5, handle()); w(100, 'AcDbSymbolTable'); w(70, 0);
    w(0, 'ENDTAB');
    w(0, 'TABLE'); w(2, 'UCS'); w(5, handle()); w(100, 'AcDbSymbolTable'); w(70, 0);
    w(0, 'ENDTAB');
    w(0, 'TABLE'); w(2, 'APPID'); w(5, handle()); w(100, 'AcDbSymbolTable'); w(70, 1);
    w(0, 'APPID'); w(5, handle());
    w(100, 'AcDbSymbolTableRecord'); w(100, 'AcDbRegAppTableRecord');
    w(2, 'ACAD'); w(70, 0);
    w(0, 'ENDTAB');
    w(0, 'TABLE'); w(2, 'DIMSTYLE'); w(5, handle()); w(100, 'AcDbSymbolTable'); w(70, 1 + nativeDims.size);
    w(100, 'AcDbDimStyleTable'); w(71, 0);
    w(0, 'DIMSTYLE'); w(105, handle());
    w(100, 'AcDbSymbolTableRecord'); w(100, 'AcDbDimStyleTableRecord');
    w(2, 'Standard'); w(70, 0);
    for (const d of nativeDims.values()) {
      w(0,'DIMSTYLE');w(105,handle());w(100,'AcDbSymbolTableRecord');w(100,'AcDbDimStyleTableRecord');
      w(2,d.style);w(70,0);w(40,1);w(140,fmt(d.h));w(41,fmt(d.h));w(42,fmt(d.h*.4));w(44,fmt(d.h*.6));w(147,fmt(d.h*.3));w(271,2);
    }
    w(0, 'ENDTAB');

    /* the applications whose extended data the entities may carry — a
       strict reader wants every one of them registered */
    w(0, 'TABLE'); w(2, 'APPID'); w(5, handle()); w(100, 'AcDbSymbolTable'); w(70, 2);
    for (const nm of ['ACAD', 'NASJICAD']) {
      w(0, 'APPID'); w(5, handle());
      w(100, 'AcDbSymbolTableRecord'); w(100, 'AcDbRegAppTableRecord');
      w(2, nm); w(70, 0);
    }
    w(0, 'ENDTAB');

    /* DIMSTYLE — every style a DIMENSION names must exist in the table */
    if (dimBlocks.length) {
      const names = [];
      for (const b of dimBlocks) {
        const nm = dimStyleName(b.ent);
        if (!names.some((n) => n.toUpperCase() === nm.toUpperCase())) names.push(nm);
      }
      const tbl = handle();
      w(0, 'TABLE'); w(2, 'DIMSTYLE'); w(5, tbl); w(100, 'AcDbSymbolTable');
      w(70, names.length); w(100, 'AcDbDimStyleTable'); w(71, 0);
      for (const nm of names) {
        w(0, 'DIMSTYLE'); w(105, handle()); w(330, tbl);
        w(100, 'AcDbSymbolTableRecord'); w(100, 'AcDbDimStyleTableRecord');
        w(2, encodeDxfText(nm)); w(70, 0);
        const st = dimStyleOf(nm);
        if (st) writeDimVars(st, false);
      }
      w(0, 'ENDTAB');
    }

    /* BLOCK_RECORD entries improve interop with strict R2000 readers */
    w(0, 'TABLE'); w(2, 'BLOCK_RECORD'); w(5, handle()); w(100, 'AcDbSymbolTable');
    w(70, 2 + blockNames.length + dimBlocks.length);
    const brHandleOf = (nm) => nm === '*Model_Space' ? msRecHandle
      : nm === '*Paper_Space' ? psRecHandle : blockRecHandle[nm];
    for (const nm of ['*Model_Space', '*Paper_Space'].concat(blockNames)) {
      w(0, 'BLOCK_RECORD'); w(5, brHandleOf(nm));
      w(100, 'AcDbSymbolTableRecord'); w(100, 'AcDbBlockTableRecord');
      w(2, isSystemBlock(nm) ? nm : outBlockName(nm));
    }
    for (const b of dimBlocks) {
      w(0, 'BLOCK_RECORD'); w(5, b.owner);
      w(100, 'AcDbSymbolTableRecord'); w(100, 'AcDbBlockTableRecord');
      w(2, b.name);
    }
    w(0, 'ENDTAB');
    w(0, 'ENDSEC');

    /* ---- entity writers ---- */
    let currentOwner = msRecHandle;   /* BLOCK_RECORD that owns entities being written */

    const zOf = (p) => (p && typeof p.z === 'number' && isFinite(p.z)) ? p.z : 0;
    const entStart = (dxfName, ent, subclass) => {
      const h = handle();
      w(0, dxfName); w(5, h);
      w(330, currentOwner);
      w(100, 'AcDbEntity');
      w(8, layerName(ent.layerId));
      if (ent.color === 'ByBlock') w(62, 0);
      else if (ent.color && ent.color !== 'ByLayer' && ent.color !== '@bg') {
        w(62, nearestAci(ent.color));
        w(420, hexToInt(ent.color));
      }
      if (ent.lt && ent.lt !== 'ByLayer') w(6, ltName(ent.lt));
      if (typeof ent.lw === 'number' && isFinite(ent.lw)) w(370, Math.round(ent.lw * 100));
      /* linetype scale (group 48) — written only when it differs from 1 */
      if (isNum(ent.lts) && ent.lts > 0 && Math.abs(ent.lts - 1) > 1e-12) w(48, fmt(ent.lts));
      if (subclass) w(100, subclass);
      return h;
    };
    /* a polyline whose vertices stand at different heights is a 3D
       polyline: the heavyweight POLYLINE with its VERTEX records, each
       carrying its own z — the one DXF form that holds such a thing */
    const write3dPolyline = (ent, pts, closed) => {
      const ph = entStart('POLYLINE', ent, 'AcDb3dPolyline');
      w(66, 1);
      w(10, 0); w(20, 0); w(30, 0);
      w(70, 8 | (closed ? 1 : 0));
      /* the heights once more as extended data: the DWG library flattens
         a 3D polyline to a lightweight one but carries extended data
         through, and the DWG reader on this side puts the heights back */
      w(1001, 'NASJICAD'); w(1000, 'Z3D');
      for (const p of pts) w(1040, fmt(zOf(p)));
      for (const p of pts) {
        w(0, 'VERTEX'); w(5, handle()); w(330, ph);
        w(100, 'AcDbEntity'); w(8, layerName(ent.layerId));
        w(100, 'AcDbVertex'); w(100, 'AcDb3dPolylineVertex');
        w(10, fmt(p.x)); w(20, fmt(p.y)); w(30, fmt(zOf(p)));
        w(70, 32);
      }
      w(0, 'SEQEND'); w(5, handle()); w(330, ph);
      w(100, 'AcDbEntity'); w(8, layerName(ent.layerId));
    };

    const writePolylinePath = (pts, closed, inner) => {
      w(92, inner ? 2 : 3);   /* polyline; external unless it is a hole */
      w(72, 0);           /* no bulges */
      w(73, closed ? 1 : 0);
      w(93, pts.length);
      for (const p of pts) { w(10, fmt(p.x)); w(20, fmt(p.y)); }
      w(97, 0);
    };

    const writeEntity = (ent) => {
      if (!ent || typeof ent !== 'object') return false;
      if (aiSelectionNumber(ent.aisel) && ent.type === 'hatch') {
        const b = ent.boundary;
        if (b?.kind !== 'pline' || !Array.isArray(b.pts) || b.pts.length < 3 || !b.pts.every(isPt)) return false;
        entStart('LWPOLYLINE', Object.assign({}, ent, {lt:'dashed'}), 'AcDbPolyline');
        w(90, b.pts.length); w(70, 1);
        for (const p of b.pts) { w(10, fmt(p.x)); w(20, fmt(p.y)); }
        w(1001, 'NASJICAD'); w(1000, 'AI_SELECTION_V1'); w(1071, ent.aisel);
        return true;
      }
      if (nativeDims.has(ent)) {
        const d=nativeDims.get(ent), aligned=ent.kind==='aligned';
        entStart('DIMENSION',ent,'AcDbDimension');w(2,d.name);
        const point=(code,p)=>{w(code,fmt(p.x));w(code+10,fmt(p.y));w(code+20,0);};
        point(10,ent.p3);point(11,d.textMid);
        w(70,32+(aligned?1:0));w(71,5);w(1,ent.txt||'');w(3,d.style);
        w(100,'AcDbAlignedDimension');point(13,ent.p1);point(14,ent.p2);
        // Preserve the measurement direction for readers that project both kinds.
        w(50,fmt(aligned ? Math.atan2(ent.p2.y-ent.p1.y,ent.p2.x-ent.p1.x)*DEG : ent.orient==='v'?90:0));
        if(!aligned)w(100,'AcDbRotatedDimension');
        return true;
      }
      switch (ent.type) {
        case 'line':
          if (!isPt(ent.a) || !isPt(ent.b)) return false;
          entStart('LINE', ent, 'AcDbLine');
          w(10, fmt(ent.a.x)); w(20, fmt(ent.a.y)); w(30, fmt(zOf(ent.a)));
          w(11, fmt(ent.b.x)); w(21, fmt(ent.b.y)); w(31, fmt(zOf(ent.b)));
          return true;

        case 'xline':                /* XLINE/RAY: base point + unit direction */
          if (!isPt(ent.p) || !isPt(ent.d)) return false;
          entStart(ent.ray ? 'RAY' : 'XLINE', ent, ent.ray ? 'AcDbRay' : 'AcDbXline');
          w(10, fmt(ent.p.x)); w(20, fmt(ent.p.y)); w(30, 0);
          w(11, fmt(ent.d.x)); w(21, fmt(ent.d.y)); w(31, 0);
          return true;

        /* A BODY travels as the 3DFACEs of its planar faces — the one 3D
           record every DXF reader shades. A face of more than four corners
           is cut into triangles; a pierced face goes whole, its holes left
           behind (a 3DFACE has none). */
        case 'face3d': case 'box': case 'solid': case 'wall': case 'slab': {
          const S = Nasj.solid;
          if (!S) return false;
          let n = 0;
          const face = (pts, hid) => {
            entStart('3DFACE', ent, 'AcDbFace');
            for (let i = 0; i < 4; i++) {
              const p = pts[Math.min(i, pts.length - 1)];
              w(10 + i, fmt(p.x)); w(20 + i, fmt(p.y)); w(30 + i, fmt(isNum(p.z) ? p.z : 0));
            }
            /* a triangle's closing edge is its third; the writer's fourth
               corner repeats the third, so the flag moves up a bit */
            if (hid) w(70, pts.length === 3 ? ((hid & 3) | ((hid & 4) ? 8 : 0)) : (hid & 15));
            n++;
          };
          const key = (a, b) => a.x + ',' + a.y + ',' + (a.z || 0) + '|' + b.x + ',' + b.y + ',' + (b.z || 0);
          for (const f of (S.rawFacesOf || S.facesOf)(ent)) {
            if (f.pts.length <= 4) { face(f.pts, f.hid); continue; }
            /* a face cut into triangles: the cuts are hidden edges, so the
               reader draws the outline the face had */
            const outline = new Set();
            for (let i = 0, m = f.pts.length; i < m; i++) {
              outline.add(key(f.pts[i], f.pts[(i + 1) % m]));
              outline.add(key(f.pts[(i + 1) % m], f.pts[i]));
            }
            for (const tri of earClip(f.pts, f.n)) {
              let hid = 0;
              for (let i = 0; i < 3; i++) {
                if (!outline.has(key(tri[i], tri[(i + 1) % 3]))) hid |= 1 << i;
                else if (f.hid) {
                  /* an outline edge the face itself hid */
                  const j = f.pts.indexOf(tri[i]), k = f.pts.indexOf(tri[(i + 1) % 3]);
                  const e = (j >= 0 && k === (j + 1) % f.pts.length) ? j : (k >= 0 && j === (k + 1) % f.pts.length) ? k : -1;
                  if (e >= 0 && (f.hid & (1 << e))) hid |= 1 << i;
                }
              }
              face(tri, hid);
            }
          }
          for (const wire of S.wiresOf(ent)) {
            entStart('LWPOLYLINE', ent, 'AcDbPolyline');
            w(90, wire.length);
            w(70, 0);
            for (const p of wire) { w(10, fmt(p.x)); w(20, fmt(p.y)); }
            n++;
          }
          return n > 0;
        }

        case 'polyline': {
          if (!Array.isArray(ent.pts) || ent.pts.length < 2) return false;
          /* one height for the whole run is a lightweight polyline's
             elevation; heights that differ make it a 3D polyline */
          const z0 = zOf(ent.pts[0]);
          if (ent.pts.some((p) => Math.abs(zOf(p) - z0) > 1e-9)) {
            write3dPolyline(ent, ent.pts, !!ent.closed);
            return true;
          }
          entStart('LWPOLYLINE', ent, 'AcDbPolyline');
          w(90, ent.pts.length);
          w(70, ent.closed ? 1 : 0);
          if (isNum(ent.w) && ent.w > 0) w(43, fmt(ent.w));   /* constant width */
          if (z0) w(38, fmt(z0));
          for (const p of ent.pts) {
            w(10, fmt(p.x)); w(20, fmt(p.y));
            if (isNum(p.b) && p.b !== 0) w(42, fmt(p.b));     /* vertex bulge */
          }
          return true;
        }

        case 'circle':
          if (!isPt(ent.c) || !isNum(ent.r)) return false;
          entStart('CIRCLE', ent, 'AcDbCircle');
          w(10, fmt(ent.c.x)); w(20, fmt(ent.c.y)); w(30, fmt(zOf(ent.c)));
          w(40, fmt(ent.r));
          return true;

        case 'arc':
          if (!isPt(ent.c) || !isNum(ent.r)) return false;
          entStart('ARC', ent, 'AcDbCircle');
          w(10, fmt(ent.c.x)); w(20, fmt(ent.c.y)); w(30, fmt(zOf(ent.c)));
          w(40, fmt(ent.r));
          w(100, 'AcDbArc');
          w(50, fmt(ent.a0 * DEG));
          w(51, fmt(ent.a1 * DEG));
          return true;

        case 'ellipse': {
          if (!isPt(ent.c) || !isNum(ent.rx) || !isNum(ent.ry)) return false;
          const rot = ent.rot || 0;
          /* DXF requires ratio <= 1: put the major axis along the longer radius */
          let mx, my, ratio;
          if (ent.ry <= ent.rx) {
            mx = ent.rx * Math.cos(rot); my = ent.rx * Math.sin(rot);
            ratio = ent.rx > 0 ? ent.ry / ent.rx : 1;
          } else {
            mx = -ent.ry * Math.sin(rot); my = ent.ry * Math.cos(rot);
            ratio = ent.ry > 0 ? ent.rx / ent.ry : 1;
          }
          entStart('ELLIPSE', ent, 'AcDbEllipse');
          w(10, fmt(ent.c.x)); w(20, fmt(ent.c.y)); w(30, 0);
          w(11, fmt(mx)); w(21, fmt(my)); w(31, 0);
          w(40, fmt(ratio));
          /* DXF measures the sweep from the MAJOR axis; when ry is the longer
             radius the axis written above is a quarter turn on, so the
             parameters shift with it */
          const shift = (ent.ry <= ent.rx) ? 0 : Math.PI / 2;
          const hasArc = isNum(ent.a0) && isNum(ent.a1);
          const nrm = (a) => { const t = a % TAU; return t < 0 ? t + TAU : t; };
          w(41, hasArc ? fmt(nrm(ent.a0 - shift)) : 0);
          w(42, hasArc ? fmt(nrm(ent.a1 - shift)) : fmt(TAU));
          return true;
        }

        case 'text': {
          if (!isPt(ent.p)) return false;
          /* multiline (ent.mt) — and ANY complex-script text — exports as a
             real MTEXT. Measured in the industry standard's 2027 release: a TEXT entity carrying
             \U+ escapes breaks Arabic shaping runs (letters disconnect),
             while the MTEXT engine joins them correctly. So Arabic, Hebrew
             and friends always travel through MTEXT. */
          const complex = /[֐-ࣿיִ-ﻼ]/.test(String(ent.str == null ? '' : ent.str));
          if (ent.mt || complex) {
            const ha = (ent.ha === 1 || ent.ha === 2 || ent.ha === 4) ? ent.ha : 0;
            const va = (ent.va === 1 || ent.va === 2 || ent.va === 3) ? ent.va : 0;
            /* attachment 1-9 from the TEXT justification; plain baseline-left
               text lands bottom-left (7), mt keeps its top-left contract (1) */
            const col = (ha === 1 || ha === 4) ? 2 : (ha === 2 ? 3 : 1);
            const row = ent.mt ? 0 : (va === 3 ? 0 : (va === 2 || ha === 4) ? 1 : 2);
            const ap = (!ent.mt && (ha || va) && isPt(ent.p2)) ? ent.p2 : ent.p;
            entStart('MTEXT', ent, 'AcDbMText');
            w(10, fmt(ap.x)); w(20, fmt(ap.y)); w(30, 0);
            w(40, fmt(isNum(ent.h) ? ent.h : 5));
            w(71, row * 3 + col);
            let rest = shapeArabic(
              mirrorBrackets(encodeDxfText(ent.str).replace(/\r\n?/g, '\n'), false))
              .replace(/\n/g, '\\P');
            while (rest.length > 250) {            /* DXF chunking contract */
              w(3, rest.slice(0, 250));
              rest = rest.slice(250);
            }
            w(1, rest);
            w(50, fmt((ent.rot || 0) * DEG));
            return true;
          }
          /* justification (SPEC2 §15 optional fields): 72/73 + 11/21 + 41 */
          const ha = (ent.ha === 1 || ent.ha === 2 || ent.ha === 4) ? ent.ha : 0;
          const va = (ent.va === 1 || ent.va === 2 || ent.va === 3) ? ent.va : 0;
          const wf = (isNum(ent.wf) && ent.wf > 0) ? ent.wf : 1;
          entStart('TEXT', ent, 'AcDbText');
          w(10, fmt(ent.p.x)); w(20, fmt(ent.p.y)); w(30, 0);
          w(40, fmt(isNum(ent.h) ? ent.h : 5));
          w(1, encodeDxfText(ent.str).replace(/[\r\n]+/g, ' '));
          w(50, fmt((ent.rot || 0) * DEG));
          if (wf !== 1) w(41, fmt(wf));
          if (ha) w(72, ha);
          if (ha || va) {
            const ap = isPt(ent.p2) ? ent.p2 : ent.p;
            w(11, fmt(ap.x)); w(21, fmt(ap.y)); w(31, 0);
          }
          w(100, 'AcDbText');
          if (va) w(73, va);
          return true;
        }

        case 'point':
          if (!isPt(ent.p)) return false;
          entStart('POINT', ent, 'AcDbPoint');
          w(10, fmt(ent.p.x)); w(20, fmt(ent.p.y)); w(30, fmt(zOf(ent.p)));
          return true;

        case 'spline': {
          if (!Array.isArray(ent.pts) || ent.pts.length < 2) return false;
          entStart('SPLINE', ent, 'AcDbSpline');
          w(210, 0); w(220, 0); w(230, 1);
          w(70, 8);           /* planar */
          w(71, 3);           /* degree */
          w(72, 0);           /* knots */
          w(73, 0);           /* control points */
          w(74, ent.pts.length);
          for (const p of ent.pts) { w(11, fmt(p.x)); w(21, fmt(p.y)); w(31, fmt(zOf(p))); }
          return true;
        }

        case 'hatch': {
          const b = ent.boundary;
          if (!b || typeof b !== 'object') return false;
          /* the app's wipeout travels as a WIPEOUT record (see wipeoutFrame);
             the industry standard's 2027 release reads this back group-for-group */
          const wf = wipeoutFrame(ent);
          if (wf) {
            entStart('WIPEOUT', ent, 'AcDbWipeout');
            w(90, 0);                                  /* class version */
            w(10, fmt(wf.minx)); w(20, fmt(wf.miny)); w(30, 0);
            w(11, fmt(wf.bw)); w(21, 0); w(31, 0);     /* u: frame width  */
            w(12, 0); w(22, fmt(wf.bh)); w(32, 0);     /* v: frame height */
            w(13, 1); w(23, 1);                        /* image size: 1x1 px */
            w(340, 0);                                 /* no image def object */
            w(70, 7);                                  /* show + unaligned + clip */
            w(280, 1);                                 /* clipping enabled */
            w(281, 50); w(282, 50); w(283, 0);         /* brightness/contrast/fade */
            w(71, 2);                                  /* polygonal clip */
            /* the industry standard's DXFIN requires the ring CLOSED (first vertex repeated);
               our importer drops the duplicate on the way back in */
            w(91, wf.pts.length + 1);
            for (const p of wf.pts.concat([wf.pts[0]])) {
              w(14, fmt((p.x - wf.minx) / wf.bw - 0.5));
              w(24, fmt(0.5 - (p.y - wf.miny) / wf.bh));
            }
            return true;
          }
          /* SOLID (gradients ride on it) writes as a solid fill; every
             OTHER pattern goes out under its own name — LINE, NET, the
             ANSI set, all of them — or a save turned each one into a
             grey slab on reopen. Imported hatches keep their original
             DXF name (patName) over the app's key. */
          const solid = !ent.pattern || String(ent.pattern).toUpperCase() === 'SOLID';
          const patOut = (typeof ent.patName === 'string' && ent.patName.trim())
            ? ent.patName.trim()
            : (!solid ? String(ent.pattern).trim() : null);
          /* THE HOLES TRAVEL WITH THE FILL. A hatch traced around the
             windows in a wall keeps them as island loops; only the outer
             loop was ever written, so the drawing reopened with the fill
             painted straight over its own windows. */
          const isles = (Array.isArray(ent.islands) ? ent.islands : [])
            .filter((l) => Array.isArray(l) && l.length >= 3);
          entStart('HATCH', ent, 'AcDbHatch');
          w(10, 0); w(20, 0); w(30, 0);
          w(210, 0); w(220, 0); w(230, 1);
          w(2, solid ? 'SOLID' : (patOut || 'ANSI31'));
          w(70, solid ? 1 : 0);
          w(71, 0);
          w(91, 1 + isles.length);
          if (b.kind === 'pline' && Array.isArray(b.pts) && b.pts.length >= 2) {
            writePolylinePath(b.pts, true);
          } else if (b.kind === 'circle' && isPt(b.c) && isNum(b.r)) {
            w(92, 1); w(93, 1);
            w(72, 2);         /* circular arc edge */
            w(10, fmt(b.c.x)); w(20, fmt(b.c.y));
            w(40, fmt(b.r));
            w(50, 0); w(51, 360); w(73, 1);
            w(97, 0);
          } else if (b.kind === 'ellipse' && isPt(b.c) && isNum(b.rx) && isNum(b.ry)) {
            const rot = b.rot || 0;
            let mx, my, ratio;
            if (b.ry <= b.rx) {
              mx = b.rx * Math.cos(rot); my = b.rx * Math.sin(rot);
              ratio = b.rx > 0 ? b.ry / b.rx : 1;
            } else {
              mx = -b.ry * Math.sin(rot); my = b.ry * Math.cos(rot);
              ratio = b.ry > 0 ? b.rx / b.ry : 1;
            }
            w(92, 1); w(93, 1);
            w(72, 3);         /* ellipse edge */
            w(10, fmt(b.c.x)); w(20, fmt(b.c.y));
            w(11, fmt(mx)); w(21, fmt(my));
            w(40, fmt(ratio));
            w(50, 0); w(51, 360); w(73, 1);
            w(97, 0);
          } else {
            return false;
          }
          for (const loop of isles) writePolylinePath(loop, true, true);
          w(75, 0);           /* hatch style: normal — odd parity, so holes */
          w(76, 1);           /* pattern type: predefined */
          if (!solid) {
            const angDeg = isNum(ent.angle) ? ent.angle : 0;
            const scale = isNum(ent.scale) && ent.scale > 0 ? ent.scale : 1;
            /* true pattern line spacing (imported ent.sp) wins; a native
               hatch fits the pattern to its shape — sqrt(bbox area)/30 ×
               scale, the same rule engine.js renders with */
            let bw = 0, bh = 0;
            if (b.kind === 'pline') {
              let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
              for (const p of b.pts) {
                if (!isPt(p)) continue;
                if (p.x < minx) minx = p.x;
                if (p.x > maxx) maxx = p.x;
                if (p.y < miny) miny = p.y;
                if (p.y > maxy) maxy = p.y;
              }
              if (maxx > minx && maxy > miny) { bw = maxx - minx; bh = maxy - miny; }
            } else if (b.kind === 'circle') {
              bw = bh = 2 * b.r;
            } else {
              const rot = b.rot || 0, cr = Math.cos(rot), sr = Math.sin(rot);
              bw = 2 * Math.hypot(b.rx * cr, b.ry * sr);
              bh = 2 * Math.hypot(b.rx * sr, b.ry * cr);
            }
            const fit = (bw > 0 && bh > 0) ? Math.sqrt(bw * bh) / 30 : 0;
            const off = (isNum(ent.sp) && ent.sp > 0) ? ent.sp : (fit > 0 ? fit : 6) * scale;
            /* the definition lines: the renderer's own pattern library
               (families of ang/sp/off/dash) spelled the way acad.pat is —
               53 line angle, 43/44 base point, 45/46 the offset to the
               next line, 49 dash runs. In the node host (no engine) the
               legacy one-or-two-line spelling stands in. */
            const patU = String(patOut || 'ANSI31').toUpperCase();
            const cross = patU.indexOf('CROSS') >= 0 ||
              patU === 'ANSI37' || patU === 'NET' || patU === 'GRID' || patU === 'SQUARE';
            const fams = (typeof Nasj.hatchPatternDef === 'function' &&
              Nasj.hatchPatternDef(patU)) ||
              (cross ? [{ ang: 45 }, { ang: 135 }] : [{ ang: 45 }]);
            w(52, fmt(angDeg));
            w(41, fmt(scale));
            w(77, 0);
            w(78, fams.length);
            for (const fam of fams) {
              const la = (fam.ang || 0) + angDeg;
              const lineAng = la * RAD;
              const d = off * (fam.sp > 0 ? fam.sp : 1);
              const shift = (fam.off > 0 ? fam.off : 0) * d;
              w(53, fmt(la));
              w(43, fmt(-Math.sin(lineAng) * shift));
              w(44, fmt(Math.cos(lineAng) * shift));
              w(45, fmt(-Math.sin(lineAng) * d));
              w(46, fmt(Math.cos(lineAng) * d));
              const dash = Array.isArray(fam.dash) ? fam.dash : null;
              w(79, dash ? dash.length : 0);
              if (dash) {
                for (let i = 0; i < dash.length; i++) {
                  w(49, fmt((i % 2 ? -1 : 1) * Math.abs(dash[i]) * off));
                }
              }
            }
          }
          w(98, 0);
          return true;
        }

        case 'insert':
          if (!ent.name || !isPt(ent.p)) return false;
          entStart('INSERT', ent, 'AcDbBlockReference');
          w(2, outBlockName(String(ent.name)));
          w(10, fmt(ent.p.x)); w(20, fmt(ent.p.y)); w(30, 0);
          w(41, fmt(isNum(ent.sx) ? ent.sx : 1));
          w(42, fmt(isNum(ent.sy) ? ent.sy : 1));
          w(43, 1);
          w(50, fmt((ent.rot || 0) * DEG));
          return true;

        case 'mline': {
          /* a REAL multiline: the path, style, scale and justification —
             reopened, it is the one object it was, not loose lines. The
             MLINESTYLE object it names is written in OBJECTS below. */
          const pts = (Array.isArray(ent.pts) ? ent.pts : []).filter(isPt);
          if (pts.length < 2) return false;
          const closed = !!ent.closed;
          const scale = isNum(ent.scale) && ent.scale !== 0 ? ent.scale : 1;
          /* the app's element offsets: STANDARD ±0.5, shifted by the
             justification and scaled — entities.js's own numbers */
          const jbase = ent.just === 'Zero' ? 0 : (ent.just === 'Bottom' ? -0.5 : 0.5);
          const offs = [(0.5 - jbase) * scale, (-0.5 - jbase) * scale];
          const n = pts.length;
          const segCount = closed ? n : n - 1;
          const segd = (i) => {
            const a = pts[((i % n) + n) % n], b = pts[(((i + 1) % n) + n) % n];
            const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
            return { x: dx / L, y: dy / L };
          };
          entStart('MLINE', ent, 'AcDbMline');
          w(2, String(ent.style || 'STANDARD'));
          w(340, mlineStyleHandle);
          w(40, fmt(scale));
          w(70, ent.just === 'Zero' ? 1 : (ent.just === 'Bottom' ? 2 : 0));
          w(71, 1 | (closed ? 2 : 0));
          w(72, n);
          w(73, 2);
          w(10, fmt(pts[0].x)); w(20, fmt(pts[0].y)); w(30, 0);
          for (let i = 0; i < n; i++) {
            const hasPrev = closed || i > 0;
            const hasNext = closed || i < n - 1;
            const dir = hasNext ? segd(i) : segd(i - 1);
            const nPrev = hasPrev ? (() => { const d = segd(i - 1); return { x: -d.y, y: d.x }; })() : null;
            const nNext = hasNext ? { x: -dir.y, y: dir.x } : null;
            /* the miter: the bisector of the two side normals, and the
               1/cos factor that keeps the element offsets true along it */
            let m, k = 1;
            if (nPrev && nNext) {
              let bx = nPrev.x + nNext.x, by = nPrev.y + nNext.y;
              const L = Math.hypot(bx, by);
              if (L > 1e-9) {
                bx /= L; by /= L;
                const c = bx * nNext.x + by * nNext.y;
                if (Math.abs(c) > 1e-6) { m = { x: bx, y: by }; k = 1 / c; }
              }
              if (!m) m = nNext;               /* a hairpin: square it off */
            } else m = nNext || nPrev;
            w(11, fmt(pts[i].x)); w(21, fmt(pts[i].y)); w(31, 0);
            w(12, fmt(dir.x)); w(22, fmt(dir.y)); w(32, 0);
            w(13, fmt(m.x)); w(23, fmt(m.y)); w(33, 0);
            for (const off of offs) {
              w(74, 2);
              w(41, fmt(off * k));
              w(41, 0);
              w(75, 0);
            }
          }
          wroteMline = true;
          return true;
        }

        case 'dim':
          if (dimBlockOf.has(ent)) {
            const b = dimBlockOf.get(ent), r = b.rec;
            const pt = (c, p) => { w(c, fmt(p.x)); w(c + 10, fmt(p.y)); w(c + 20, 0); };
            entStart('DIMENSION', ent, 'AcDbDimension');
            w(2, b.name);
            pt(10, r.def);
            if (r.tm) pt(11, r.tm);
            /* 32: the block serves this dimension alone; 128: the text
               sits where the user put it */
            w(70, r.type | 32 | (r.user ? 128 : 0));
            w(71, 5);
            w(42, fmt(r.meas));
            const ov = ent.txt == null ? '' : String(ent.txt).trim();
            if (ov) w(1, encodeDxfText(ov));
            w(3, encodeDxfText(dimStyleName(ent)));
            switch (r.type) {
              case 0:
                w(100, 'AcDbAlignedDimension'); pt(13, r.p13); pt(14, r.p14);
                w(50, fmt(r.rot)); w(100, 'AcDbRotatedDimension');
                break;
              case 1:
                w(100, 'AcDbAlignedDimension'); pt(13, r.p13); pt(14, r.p14);
                break;
              case 3:
                w(100, 'AcDbDiametricDimension'); pt(15, r.p15); w(40, 0);
                break;
              case 4:
                w(100, 'AcDbRadialDimension'); pt(15, r.p15); w(40, 0);
                break;
              case 5:
                w(100, 'AcDb3PointAngularDimension'); pt(13, r.p13); pt(14, r.p14); pt(15, r.p15);
                break;
              default: break;
            }
            return true;
          }
          /* falls through: a kind the reader would not take back */
        case 'leader':
        case 'table': {
          /* export as exploded primitives (SPEC2 §17) — the pre-pass
             already exploded model-space annotations for the extents;
             take that result and free it */
          if (typeof Nasj.explode !== 'function') return false;
          let parts = null;
          if (explodeCache.has(ent)) {
            parts = explodeCache.get(ent);
            explodeCache.delete(ent);
          } else {
            try { parts = Nasj.explode(doc, ent); } catch (e) { parts = null; }
          }
          if (!Array.isArray(parts)) return false;
          let ok = false;
          for (const part of parts) {
            if (!part) continue;
            if (!part.layerId) part.layerId = ent.layerId;
            if (!part.color) part.color = ent.color;
            if (writeEntity(part)) ok = true;
          }
          return ok;
        }

        default:
          return false;
      }
    };

    /* ---- BLOCKS ---- */
    w(0, 'SECTION'); w(2, 'BLOCKS');
    for (const nm of ['*Model_Space', '*Paper_Space']) {
      const owner = brHandleOf(nm);
      w(0, 'BLOCK'); w(5, handle()); w(330, owner);
      w(100, 'AcDbEntity'); w(8, '0'); w(100, 'AcDbBlockBegin');
      w(2, nm); w(70, 0); w(10, 0); w(20, 0); w(30, 0); w(3, nm); w(1, '');
      w(0, 'ENDBLK'); w(5, handle()); w(330, owner);
      w(100, 'AcDbEntity'); w(8, '0'); w(100, 'AcDbBlockEnd');
    }
    for (const nm of blockNames) {
      const def = blocks[nm];
      if (!def || typeof def !== 'object') continue;
      const base = isPt(def.base) ? def.base : { x: 0, y: 0 };
      const owner = blockRecHandle[nm];
      w(0, 'BLOCK'); w(5, handle()); w(330, owner);
      w(100, 'AcDbEntity'); w(8, '0'); w(100, 'AcDbBlockBegin');
      w(2, outBlockName(nm)); w(70, dimNames.has(nm) ? 1 : 0);
      w(10, fmt(base.x)); w(20, fmt(base.y)); w(30, 0);
      w(3, outBlockName(nm)); w(1, '');
      currentOwner = owner;
      if (Array.isArray(def.entities)) {
        for (let i = 0; i < def.entities.length; i++) {
          writeEntity(def.entities[i]);
          if ((i & 511) === 511) yield { phase: 'blocks', done: i + 1, total: def.entities.length };
        }
      }
      currentOwner = msRecHandle;
      w(0, 'ENDBLK'); w(5, handle()); w(330, owner);
      w(100, 'AcDbEntity'); w(8, '0'); w(100, 'AcDbBlockEnd');
    }
    /* the dimensions' anonymous blocks: the drawn form of each, in world
       coordinates about a base of 0,0 (the DIMENSION's group 12) */
    for (const b of dimBlocks) {
      const ly = layerName(b.ent.layerId);
      w(0, 'BLOCK'); w(5, handle()); w(330, b.owner);
      w(100, 'AcDbEntity'); w(8, ly); w(100, 'AcDbBlockBegin');
      w(2, b.name); w(70, 1); w(10, 0); w(20, 0); w(30, 0); w(3, b.name); w(1, '');
      currentOwner = b.owner;
      for (const part of b.parts) {
        if (!part) continue;
        if (!part.layerId) part.layerId = b.ent.layerId;
        if (!part.color) part.color = b.ent.color;
        writeEntity(part);
      }
      currentOwner = msRecHandle;
      w(0, 'ENDBLK'); w(5, handle()); w(330, b.owner);
      w(100, 'AcDbEntity'); w(8, ly); w(100, 'AcDbBlockEnd');
      explodeCache.delete(b.ent);
      b.parts = null;
    }
    w(0, 'ENDSEC');

    /* ---- ENTITIES ---- */
    w(0, 'SECTION'); w(2, 'ENTITIES');
    currentOwner = msRecHandle;
    if (Array.isArray(doc.entities)) {
      for (let i = 0; i < doc.entities.length; i++) {
        writeEntity(doc.entities[i]);
        if ((i & 511) === 511) yield { phase: 'entities', done: i + 1, total: doc.entities.length };
      }
    }
    w(0, 'ENDSEC');

    /* ---- OBJECTS. Always: the named objects dictionary, the plot-style
       dictionary every LAYER's 390 points into (a with-default dictionary
       whose one entry, Normal, is a placeholder — exactly the shape the
       industry standard writes), and the MLINESTYLE a written MLINE names
       (DXFIN wants the named style to exist, and its dictionary chain
       with it) ---- */
    {
      w(0, 'SECTION'); w(2, 'OBJECTS');
      w(0, 'DICTIONARY'); w(5, 'C'); w(330, '0');
      w(100, 'AcDbDictionary'); w(281, 1);
      w(3, 'ACAD_PLOTSTYLENAME'); w(350, PLOTSTYLE_DICT);
      if (wroteMline) { w(3, 'ACAD_MLINESTYLE'); w(350, mlineDictHandle); }
      w(0, 'ACDBDICTIONARYWDFLT'); w(5, PLOTSTYLE_DICT); w(330, 'C');
      w(100, 'AcDbDictionary'); w(281, 1);
      w(3, 'Normal'); w(350, PLOTSTYLE_HOLDER);
      w(100, 'AcDbDictionaryWithDefault'); w(340, PLOTSTYLE_HOLDER);
      w(0, 'ACDBPLACEHOLDER'); w(5, PLOTSTYLE_HOLDER); w(330, PLOTSTYLE_DICT);
    }
    if (wroteMline) {
      w(0, 'DICTIONARY'); w(5, mlineDictHandle); w(330, 'C');
      w(100, 'AcDbDictionary'); w(281, 1);
      w(3, 'STANDARD'); w(350, mlineStyleHandle);
      w(0, 'MLINESTYLE'); w(5, mlineStyleHandle); w(330, mlineDictHandle);
      w(100, 'AcDbMlineStyle');
      w(2, 'STANDARD');
      w(70, 0);
      w(3, '');
      w(62, 256);
      w(51, fmt(90)); w(52, fmt(90));
      w(71, 2);
      w(49, fmt(0.5)); w(62, 256); w(6, 'BYLAYER');
      w(49, fmt(-0.5)); w(62, 256); w(6, 'BYLAYER');
    }
    w(0, 'ENDSEC');

    w(0, 'EOF');
    /* what could not be written is SAID, not swallowed — a drawing saved to
       DXF and reopened must not lose objects in silence. (The count came
       from the pre-pass — the tail no longer walks the drawing again.) */
    if (skippedArcText && Nasj.cmd && typeof Nasj.cmd.print === 'function') {
      Nasj.cmd.print(skippedArcText + ' arc-aligned text object(s) were not written — ' +
        'DXF carries no such object. The .json format keeps them.', 'err');
    }
    /* the join, sliced too: chunk results concatenate to exactly
       out.join('\n') + '\n' — the '\n' closing each chunk IS the separator
       before the next chunk's first element */
    let res = '';
    const CHUNK = 1 << 18;   /* ~260k pairs a slice keeps each join under the budget's neighbourhood */
    for (let i = 0; i < out.length; i += CHUNK) {
      res += out.slice(i, i + CHUNK).join('\n') + '\n';
      if (i + CHUNK < out.length) yield { phase: 'join', done: i + CHUNK, total: out.length };
    }
    return res;
  }
  /* the classic synchronous call — drives the generator to completion */
  const exportDoc = (doc, opts) => {
    const it = exportDocGen(doc, opts);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  };

  /* ================================================================== *
   * IMPORT — tolerant group-code pair scanner; never throws.
   * ================================================================== */
  /* ---- a CAD DIMENSION as this app's own dimension (import parity) ----
     AutoCAD keeps a dimension as its definition points plus an anonymous
     *D block of the drawn lines. The block used to come in as-is — a bundle
     of lines and a text with a grip on every one — which is not what a
     dimension is. The points map onto the 'dim' entity's own for the kinds
     it draws; a kind it does not (ordinate, arc length, a rotated linear
     off the axes) keeps the block. Points by group code:
       linear/aligned: 13, 14 = extension origins, 10 on the dimension line
       radius: 10 = centre, 15 on the curve; diameter: 10 and 15 straddle it
       angular 3-point: 15 = vertex, 13/14 = ends, 10 = arc point
       angular 2-line: 13->14 and 15->10 are the lines, 16 = arc point
     Group 1 is an override ('' or '<>' = the measurement itself).
     opt.h is the drawn text height read off the *D block (exact for every
     style, where the header's DIMTXT speaks for the current one only);
     opt.S is DIMSCALE, which the app's style multiplies back in. */
  const cadDimension = (src, opt) => {
    const kind = src.kind || ['linear', 'aligned', 'angular2ln', 'diameter',
      'radius', 'angular3pt', 'ordinate'][(src.type | 0) & 7];
    const P = (p) => (p && isFinite(p.x) && isFinite(p.y)) ? { x: p.x, y: p.y } : null;
    const def = P(src.def), p13 = P(src.p13), p14 = P(src.p14);
    const p15 = P(src.p15), p16 = P(src.p16), tm = P(src.textMid);
    const TAU2 = Math.PI * 2;
    const wrap = (a) => ((a % TAU2) + TAU2) % TAU2;
    let e = null;
    switch (kind) {
      case 'linear': {
        if (!def || !p13 || !p14) return null;
        const r = ((src.rotation || 0) % Math.PI + Math.PI) % Math.PI;
        const orient = (r < 1e-6 || Math.PI - r < 1e-6) ? 'h'
          : (Math.abs(r - Math.PI / 2) < 1e-6 ? 'v' : null);
        if (!orient) return null;
        e = { kind: 'linear', orient, p1: p13, p2: p14, p3: def };
        break;
      }
      case 'aligned':
        if (!def || !p13 || !p14) return null;
        e = { kind: 'aligned', p1: p13, p2: p14, p3: def };
        break;
      case 'radius':
        if (!def || !p15) return null;
        e = { kind: 'radius', p1: def, p2: p15, p3: tm || p15 };
        break;
      case 'diameter': {
        if (!def || !p15) return null;
        const c = { x: (def.x + p15.x) / 2, y: (def.y + p15.y) / 2 };
        e = { kind: 'diameter', p1: c, p2: p15, p3: tm || p15 };
        break;
      }
      case 'angular3pt':
        if (!def || !p13 || !p14 || !p15) return null;
        e = { kind: 'angular', p1: p15, p2: p13, p3: p14, p4: def };
        break;
      case 'angular2ln': {
        if (!def || !p13 || !p14 || !p15 || !p16) return null;
        const d1 = { x: p14.x - p13.x, y: p14.y - p13.y };
        const d2 = { x: def.x - p15.x, y: def.y - p15.y };
        const den = d1.x * d2.y - d1.y * d2.x;
        if (Math.abs(den) < 1e-12) return null;
        const t = ((p15.x - p13.x) * d2.y - (p15.y - p13.y) * d2.x) / den;
        const v = { x: p13.x + d1.x * t, y: p13.y + d1.y * t };
        /* each line lends the end whose ray, with the other's, sweeps the
           smallest arc that still holds the arc point — an end sitting on
           the vertex itself (two lines meeting at a corner) has no ray */
        const am = Math.atan2(p16.y - v.y, p16.x - v.x);
        const away = (p) => Math.hypot(p.x - v.x, p.y - v.y) > 1e-9;
        let best = null;
        for (const a of [p13, p14].filter(away)) {
          for (const b of [p15, def].filter(away)) {
            const aa = Math.atan2(a.y - v.y, a.x - v.x), ab = Math.atan2(b.y - v.y, b.x - v.x);
            for (const [x, y, sw] of [[a, b, wrap(ab - aa)], [b, a, wrap(aa - ab)]]) {
              const from = Math.atan2(x.y - v.y, x.x - v.x);
              if (wrap(am - from) <= sw + 1e-9 && (!best || sw < best.sw)) best = { x, y, sw };
            }
          }
        }
        if (!best) return null;
        e = { kind: 'angular', p1: v, p2: best.x, p3: best.y, p4: p16 };
        break;
      }
      default: return null;
    }
    e.type = 'dim';
    const S = (opt && opt.S > 0) ? opt.S : 1;
    const hBlk = opt && opt.h > 0 ? opt.h / S : 0;
    const hTxt = opt && opt.txtH > 0 ? opt.txtH : 0;
    e.h = hBlk > 0 ? hBlk : (hTxt > 0 ? hTxt : 3);
    const txt = String(src.text == null ? '' : src.text).trim();
    if (txt && txt !== '<>') {
      let s = txt;
      if (s.indexOf('<>') >= 0 && isFinite(src.measurement)) {
        const dec = (opt && opt.dec >= 0) ? Math.round(opt.dec) : 2;
        const m = e.kind === 'angular' ? src.measurement * 180 / Math.PI : src.measurement;
        s = s.split('<>').join(m.toFixed(dec));
      }
      e.txt = s;
    }
    return e;
  };
  /* the dimension style a CAD drawing draws with, from its DIM variables —
     get(name) answers a variable without its $ ('DIMTXT'); anything it
     does not know keeps the app's default */
  const cadDimStyle = (name, get) => {
    const n = (k) => { const v = get(k); return (typeof v === 'number' && isFinite(v)) ? v : null; };
    const st = { name };
    const num = (k, f, min) => { const v = n(k); if (v != null && !(min != null && v < min)) st[f] = v; };
    num('DIMTXT', 'txtH', 0.01);
    num('DIMASZ', 'asz', 0); num('DIMEXO', 'exo', 0); num('DIMEXE', 'exe', 0);
    num('DIMGAP', 'gap', 0); num('DIMDLI', 'dli', 0); num('DIMDLE', 'dle', 0);
    num('DIMLFAC', 'lfac', 1e-6); num('DIMRND', 'rnd', 0);
    const sc = n('DIMSCALE'); st.scale = sc > 0 ? sc : 1;   /* 0 = fit to plot */
    const dec = n('DIMDEC'); if (dec != null && dec >= 0) st.prec = Math.min(8, Math.round(dec));
    const cen = n('DIMCEN');
    if (cen != null) { st.cen = cen === 0 ? 'None' : (cen < 0 ? 'Line' : 'Mark'); st.cenSize = Math.abs(cen); }
    const tsz = n('DIMTSZ'); if (tsz > 0) { st.arrow = 'Oblique'; st.arrow2 = 'Oblique'; st.asz = tsz; }
    const tad = n('DIMTAD');
    if (tad != null) st.tvert = ['Centered', 'Above', 'Outside', 'JIS', 'Below'][Math.round(tad)] || 'Centered';
    const tih = n('DIMTIH'), toh = n('DIMTOH');
    if (tih != null && toh != null) st.talign = tih ? 'Horizontal' : (toh ? 'ISO' : 'Aligned');
    const lu = n('DIMLUNIT'); if (lu >= 1 && lu <= 5) st.lunit = Math.round(lu);
    const zin = n('DIMZIN');
    if (zin != null) st.zin = (zin & 12) === 12 ? 'Both' : ((zin & 8) ? 'Trailing' : ((zin & 4) ? 'Leading' : 'None'));
    const ds = n('DIMDSEP');
    if (ds != null) { const ch = String.fromCharCode(ds); if (ch === '.' || ch === ',' || ch === ' ') st.dsep = ch; }
    const post = get('DIMPOST');
    if (typeof post === 'string' && post) {
      const i = post.indexOf('<>');
      if (i >= 0) { st.pre = post.slice(0, i); st.suf = post.slice(i + 2); } else st.suf = post;
    }
    const au = n('DIMAUNIT'); if (au != null && au >= 0 && au <= 3) st.aunit = Math.round(au);
    const ad = n('DIMADEC'); if (ad != null && ad >= 0) st.aprec = Math.min(8, Math.round(ad));
    for (const [k, f] of [['DIMSE1', 'se1'], ['DIMSE2', 'se2'], ['DIMSD1', 'sd1'], ['DIMSD2', 'sd2'],
      ['DIMTOFL', 'tofl'], ['DIMALT', 'alt']]) { const v = n(k); if (v != null) st[f] = !!v; }
    num('DIMALTF', 'altFac', 1e-6);
    const altd = n('DIMALTD'); if (altd != null && altd >= 0) st.altPrec = Math.min(8, Math.round(altd));
    const ts = get('DIMTXSTY'); if (typeof ts === 'string' && ts.trim()) st.txtsty = ts.trim();
    return st;
  };
  /* what the *D block says about its dimension's style: the drawn text
     height, and the arrowhead the block inserts by name (the AutoCAD
     arrow blocks) with its size — a closed filled head is a SOLID, not an
     insert, and is the app's default anyway */
  const CAD_ARROWS = {
    '_ARCHTICK': 'Architectural tick', '_OBLIQUE': 'Oblique', '_DOT': 'Dot',
    '_DOTSMALL': 'Dot small', '_DOTBLANK': 'Dot blank', '_SMALL': 'Dot small blank',
    '_OPEN': 'Open', '_OPEN30': 'Open 30', '_OPEN90': 'Right angle',
    '_CLOSED': 'Closed', '_CLOSEDBLANK': 'Closed blank', '_ORIGIN': 'Origin indicator',
    '_ORIGIN2': 'Origin indicator 2', '_BOXBLANK': 'Box', '_BOXFILLED': 'Box filled',
    '_DATUMBLANK': 'Datum triangle', '_DATUMFILLED': 'Datum triangle filled',
    '_INTEGRAL': 'Integral', '_NONE': 'None'
  };
  /* ents: the block's entities in either shape — the app's (text h, insert
     name/sx) or the DWG library's raw (height, name/scale.x) */
  const cadDimBlockInfo = (ents) => {
    const info = { h: 0, arrow: null, asz: 0 };
    for (const e of ents || []) {
      if (!e) continue;
      if (e.type === 'text' || e.type === 'mtext') {
        const h = e.h > 0 ? e.h : (e.height > 0 ? e.height : 0);
        if (h > 0 && !info.h) info.h = h;
      } else if (e.type === 'insert' && (typeof e.name === 'string' || typeof e.blockName === 'string')) {
        const nm = String(e.name || e.blockName).toUpperCase();
        if (!(nm in CAD_ARROWS) || info.arrow) continue;
        info.arrow = CAD_ARROWS[nm];
        const sx = isFinite(e.sx) ? e.sx : (e.scale && isFinite(e.scale.x) ? e.scale.x : 1);
        info.asz = Math.abs(sx);
      }
    }
    return info;
  };
  /* the style entry for one dimension, made on first sight of its name:
     the drawing's DIM variables, then what its block shows — the head the
     style draws, sized so the app draws it at the block's size (the app
     scales a style's sizes by h/txtH), and text above the line when the
     block's text sits off it */
  const cadDimStyleFor = (list, name, get, info, native, src) => {
    const nm = (name && String(name).trim()) || 'Standard';
    let st = list.find((s) => s.name.toUpperCase() === nm.toUpperCase());
    if (st) return st.name;
    st = cadDimStyle(nm, get);
    if (info && info.arrow) {
      st.arrow = st.arrow2 = info.arrow;
      const k = (st.txtH > 0 ? native.h / st.txtH : 1);
      if (info.asz > 0 && k > 0) st.asz = info.asz / k;
    }
    if (st.tvert == null && src && src.textMid && (native.kind === 'linear' || native.kind === 'aligned')) {
      const tm = src.textMid, def = src.def;
      if (tm && def && isFinite(tm.x) && isFinite(def.x)) {
        const u = native.kind === 'aligned'
          ? (() => { const dx = native.p2.x - native.p1.x, dy = native.p2.y - native.p1.y, L = Math.hypot(dx, dy) || 1; return { x: dx / L, y: dy / L }; })()
          : (native.orient === 'v' ? { x: 0, y: 1 } : { x: 1, y: 0 });
        const off = Math.abs((tm.x - def.x) * -u.y + (tm.y - def.y) * u.x);
        if (st.tvert == null) st.tvert = off > native.h * 0.4 ? 'Above' : 'Centered';
      }
    }
    list.push(st);
    return st.name;
  };

  /* the anonymous *D block of a dimension that came in as the app's own
     is spent — the dimension draws itself from its points now. Kept, it
     would go out on the next save as an ordinary block (renamed ND_D…),
     one more with every round trip. A block some insert still names
     stays. Shared with the DWG route (dwg-doc.js). */
  const dropSpentDimBlocks = (blocks, entities, names) => {
    if (!names || !names.size) return;
    const used = new Set();
    const scan = (list) => {
      for (const e of list || []) if (e && e.type === 'insert' && e.name != null) used.add(String(e.name));
    };
    scan(entities);
    for (const nm of Object.keys(blocks)) scan(blocks[nm] && blocks[nm].entities);
    for (const nm of names) if (/^\*D/i.test(nm) && !used.has(nm) && (nm in blocks)) delete blocks[nm];
  };

  const importText = (text) => {
    const warnings = [];
    const layers = [];
    const layerByName = Object.create(null);
    const blocks = {};
    const entities = [];
    const skipped = Object.create(null);
    let hdrLtScale = 1;   /* $LTSCALE — folded into each entity's lts */
    let pdmode = null, pdsize = null;   /* $PDMODE/$PDSIZE — the point glyph */
    let savedView = null;               /* the *Active viewport: centre/height/twist */
    const styles = [];                  /* the STYLE table (see styleText) */
    const styleByName = Object.create(null);
    const dimStyles = [];               /* one per DIMSTYLE name a dimension names */
    let dimStyleCur = null;             /* $DIMSTYLE, the drawing's current one */
    const spentDimBlocks = new Set();   /* *D blocks whose dimension came in as the app's own */

    const ensureLayer = (name) => {
      /* names travel as \U+XXXX escapes (see exportDoc) — decode them so an
         Arabic layer name comes back as Arabic, not as escape soup */
      const nm = (name == null || name === '') ? '0' : decodeDxfText(String(name));
      if (!layerByName[nm]) {
        const ly = { id: nm, name: nm, color: '#ffffff', on: true, frozen: false, locked: false };
        layerByName[nm] = ly;
        layers.push(ly);
      }
      return layerByName[nm];
    };

    try {
      /* ---- tokenize into (code, value) pairs ---- */
      const lines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
      const pairs = [];
      for (let i = 0; i + 1 < lines.length; i += 2) {
        const code = parseInt(lines[i], 10);
        if (!isFinite(code)) { i -= 1; continue; }   /* resync on stray line */
        pairs.push([code, lines[i + 1]]);
      }

      const val = (i) => pairs[i][1].trim();
      const findNext0 = (i, name, end) => {
        for (let k = i; k < end; k++) {
          if (pairs[k][0] === 0 && (!name || val(k) === name)) return k;
        }
        return end;
      };

      /* ---- header variables (group 9 appears only in HEADER) ----
         $LTSCALE folds into each entity's lts; $PDMODE/$PDSIZE are the
         point glyph and its size, which the drawing owns the way the industry standard
         does — without them every POINT drew this app's default dot. */
      const hdrVar = (name, code) => {
        for (let k = 0; k < pairs.length; k++) {
          if (pairs[k][0] !== 9 || val(k) !== name) continue;
          for (let j = k + 1; j < pairs.length && pairs[j][0] !== 9 && pairs[j][0] !== 0; j++) {
            if (pairs[j][0] === code) {
              const v = parseFloat(pairs[j][1]);
              return isFinite(v) ? v : null;
            }
          }
          return null;
        }
        return null;
      };
      const hdrStr = (name) => {
        for (let k = 0; k < pairs.length; k++) {
          if (pairs[k][0] !== 9 || val(k) !== name) continue;
          for (let j = k + 1; j < pairs.length && pairs[j][0] !== 9 && pairs[j][0] !== 0; j++) {
            if (pairs[j][0] === 1 || pairs[j][0] === 2 || pairs[j][0] === 7) return String(pairs[j][1]).trim();
          }
          return null;
        }
        return null;
      };
      dimStyleCur = hdrStr('$DIMSTYLE');
      const lts0 = hdrVar('$LTSCALE', 40);
      if (lts0 != null && lts0 > 0) hdrLtScale = lts0;
      pdmode = hdrVar('$PDMODE', 70);
      pdsize = hdrVar('$PDSIZE', 40);

      /* ---- group record helpers ---- */
      const collectGroups = (i, end) => {
        /* i points at the (0, TYPE) pair; returns {type, g:[[code,value]...], next} */
        const type = val(i).toUpperCase();
        const g = [];
        let k = i + 1;
        while (k < end && pairs[k][0] !== 0) { g.push([pairs[k][0], pairs[k][1]]); k++; }
        return { type, g, next: k };
      };
      const G = (g) => ({
        num(code, def) {
          for (const [c, v] of g) if (c === code) { const n = parseFloat(v); return isFinite(n) ? n : def; }
          return def;
        },
        int(code, def) {
          for (const [c, v] of g) if (c === code) { const n = parseInt(v, 10); return isFinite(n) ? n : def; }
          return def;
        },
        str(code, def) {
          for (const [c, v] of g) if (c === code) return v.trim();
          return def;
        },
        rawAll(code) {
          const out = [];
          for (const [c, v] of g) if (c === code) out.push(v);
          return out;
        },
        nums(code) {
          const out = [];
          for (const [c, v] of g) if (c === code) { const n = parseFloat(v); if (isFinite(n)) out.push(n); }
          return out;
        }
      });

      const pairUp = (xs, ys) => {
        const n = Math.min(xs.length, ys.length);
        const pts = [];
        for (let i = 0; i < n; i++) pts.push({ x: xs[i], y: ys[i] });
        return pts;
      };

      /* TEXT/ATTRIB justification: per DXF spec, when 72 or 73 is nonzero the
         anchor is the second alignment point (11/21). halign 3 (aligned) and
         5 (fit) span p..p2 — mapped to center anchored at the span midpoint. */
      /* stamp a text with the style (group 7) it was drawn with: the NAME
         the palette reads, the family the renderer needs, the slant, and
         the style's own width factor where the object states none. The
         `cad` flag is the durable "the industry standard's metrics" mark — height means CAP
         height and the face measures as the industry standard's does — which used to be
         inferred from the ABSENCE of a style name and could not survive
         one being carried across. */
      const styleText = (e, name) => {
        e.cad = true;
        const nm = name == null ? '' : decodeDxfText(String(name)).trim();
        if (!nm) return e;
        e.style = nm;
        const st = styleByName[nm.toUpperCase()];
        if (!st) return e;
        /* the face is stamped even when it IS the default one: a drawing
           whose styles are named Standard or Annotative would otherwise
           resolve against THIS app's styles of those names */
        e.fnt = st.font;
        if (st.oblique) e.obl = st.oblique;
        if (st.fstyle !== 'Regular') e.fst = st.fstyle;
        /* THE WIDTH FACTOR IS THE OBJECT'S OWN (group 41), never the style's.
           the industry standard's own textbox proves it: a text on a style of width 0.65
           whose own 41 is 1 measures its FULL width, and the style's factor
           only ever seeds a NEW object. Folding the style's in condensed
           every such label by a third against the drawing the industry standard plots. */
        return e;
      };

      const applyTextJust = (e, ha, va, p2, wf) => {
        if (isFinite(wf) && wf > 0 && wf !== 1) e.wf = wf;
        const spanned = (ha === 3 || ha === 5);
        if (spanned) ha = 1;
        if (!(ha === 1 || ha === 2 || ha === 4)) ha = 0;
        if (!(va === 1 || va === 2 || va === 3)) va = 0;
        if (!ha && !va) return e;
        e.ha = ha;
        e.va = va;
        e.p2 = spanned
          ? { x: (e.p.x + p2.x) / 2, y: (e.p.y + p2.y) / 2 }
          : { x: p2.x, y: p2.y };
        return e;
      };

      const BSL = String.fromCharCode(1);   /* placeholder for escaped backslashes */
      const cleanMtext = (s) => String(s)
        .replace(/\\\\/g, BSL)
        .replace(/\\P/gi, '\n')
        .replace(/\\~/g, ' ')
        .replace(/\\[LOKlok]/g, '')
        .replace(/\\[ACcHQTWFfpx][^;]*;/g, '')
        .replace(/[{}]/g, '')
        .replace(new RegExp(BSL, 'g'), '\\');

      const entityColor = (q) => {
        const tc = q.num(420, null);
        if (tc != null) return intToHex(tc);
        const aci = q.int(62, null);
        if (aci != null && aci >= 1 && aci <= 255) return aciToHex(aci);
        /* ACI 0 is ByBlock: the entity takes the colour of the block
           reference that draws it, NOT its layer's. Folding it into
           ByLayer painted a dimension's dot arrowheads in the layer
           colour (white) where the industry standard draws them in the dimension's. */
        if (aci === 0) return 'ByBlock';
        return 'ByLayer';
      };

      const ltIn = (name) => {
        const u = String(name || '').toUpperCase();
        if (!u || u === 'BYLAYER') return null;
        if (u.indexOf('CENTER') >= 0) return 'center';
        if (u.indexOf('HIDDEN') >= 0) return 'hidden';
        if (u.indexOf('DOT') >= 0) return 'dot';
        if (u.indexOf('DASH') >= 0) return 'dashed';
        return null; /* Continuous / unknown → ByLayer default */
      };

      const baseProps = (q) => {
        const p = {
          id: uid(),
          layerId: ensureLayer(q.str(8, '0')).id,
          color: entityColor(q)
        };
        const lt = ltIn(q.str(6, null));
        if (lt) p.lt = lt;
        const lw = q.int(370, null);
        if (lw != null && lw > 0) p.lw = lw / 100;
        /* linetype scale: entity 48 x doc-level $LTSCALE, stored when != 1 */
        const lts48 = q.num(48, null);
        const lts = (lts48 != null && lts48 > 0 ? lts48 : 1) * hdrLtScale;
        if (Math.abs(lts - 1) > 1e-12 && lts > 0) p.lts = lts;
        return p;
      };

      const skip = (type) => { skipped[type] = (skipped[type] || 0) + 1; };

      /* ---------------- hatch boundary loops (SPEC2 §17) ----------------
       * Every 92-loop is parsed: polyline paths (bulges sampled) AND edge
       * paths — line/arc/ellipse/spline edges chained in file order and
       * sampled into a closed pline. A lone full circle/ellipse edge keeps
       * its exact boundary kind. */
      /* every loop counts now that inner ones are kept as islands: a wall
         with two dozen windows is one hatch with two dozen holes */
      const HATCH_MAX_LOOPS = 256;

      /* append a sampled segment to the loop chain, keeping continuity
         (edges may be stored end-to-start; pick the closer orientation) */
      const chainAppend = (chain, seg) => {
        if (!seg || !seg.length) return;
        if (chain.length) {
          const end = chain[chain.length - 1];
          const d0 = Math.hypot(seg[0].x - end.x, seg[0].y - end.y);
          const d1 = Math.hypot(seg[seg.length - 1].x - end.x, seg[seg.length - 1].y - end.y);
          if (d1 < d0) seg = seg.slice().reverse();
        }
        for (const p of seg) {
          const last = chain[chain.length - 1];
          if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-9) chain.push({ x: p.x, y: p.y });
        }
      };

      /* sample angles over a CCW sweep a0->a1 (radians); DXF's clockwise
         edges (ccw flag 0) are mirrored across the x axis first */
      const sweepAngles = (a0, a1, ccw) => {
        if (!ccw) { const t = a0; a0 = -a1; a1 = -t; }
        let sweep = (a1 - a0) % TAU;
        if (sweep < 0) sweep += TAU;
        if (sweep < 1e-9) sweep = TAU;
        const n = Math.max(4, Math.min(96, Math.ceil(sweep / (Math.PI / 24))));
        const out = [];
        for (let s = 0; s <= n; s++) out.push(a0 + sweep * (s / n));
        return out;
      };

      /* sampled points of a polyline-path bulge segment a->b (incl. ends) */
      const bulgeSegPts = (a, b, bl) => {
        const chord = Math.hypot(b.x - a.x, b.y - a.y);
        const theta = 4 * Math.atan(bl);
        if (!(chord > 1e-12) || Math.abs(theta) < 1e-9) return [a, b];
        const r = Math.abs(chord / (2 * Math.sin(theta / 2)));
        const h = (chord / 2) / Math.tan(theta / 2);
        const ux = (b.x - a.x) / chord, uy = (b.y - a.y) / chord;
        const c = { x: (a.x + b.x) / 2 - uy * h, y: (a.y + b.y) / 2 + ux * h };
        const s0 = Math.atan2(a.y - c.y, a.x - c.x);
        const n = Math.max(4, Math.min(48, Math.ceil(Math.abs(theta) / (Math.PI / 24))));
        const out = [];
        for (let s = 0; s <= n; s++) {
          const t = s0 + theta * (s / n);
          out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
        }
        return out;
      };

      /* dedupe + drop the closing duplicate; >=3 pts -> closed pline loop */
      const closeLoop = (raw) => {
        const pts = [];
        for (const p of raw) {
          const last = pts[pts.length - 1];
          if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-9) pts.push(p);
        }
        while (pts.length > 2 &&
               Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-9) {
          pts.pop();
        }
        return pts.length >= 3 ? { kind: 'pline', pts, closed: true } : null;
      };

      /* full-precision hatch boundary parse over an entity's group list —
         returns EVERY convertible loop (up to HATCH_MAX_LOOPS) */
      const parseHatchBoundaries = (g) => {
        const n = g.length;
        const code = (k) => g[k][0];
        const num = (k) => { const v = parseFloat(g[k][1]); return isFinite(v) ? v : 0; };
        const loops = [];
        let i = 0;
        while (i < n && loops.length < HATCH_MAX_LOOPS) {
          while (i < n && code(i) !== 92) i++;
          if (i >= n) break;
          const flag = parseInt(g[i][1], 10) || 0;
          i++;
          const stop = (c) => c === 92 || c === 75 || c === 97 || c === 98;
          if (flag & 2) {
            /* polyline path: 72 hasBulge, 73 closed, 93 nverts, 10/20 (+42) */
            const verts = [];
            let cur = null;
            for (; i < n && !stop(code(i)); i++) {
              const c = code(i);
              if (c === 10) { cur = { x: num(i), y: 0 }; verts.push(cur); }
              else if (c === 20 && cur) cur.y = num(i);
              else if (c === 42 && cur) { const b = num(i); if (b) cur.b = b; }
            }
            const chain = [];
            for (let k = 0; k < verts.length; k++) {
              const a = verts[k], b = verts[(k + 1) % verts.length];
              if (a.b) chainAppend(chain, bulgeSegPts(a, b, a.b));
              else chainAppend(chain, [a]);
            }
            const loop = closeLoop(chain);
            if (loop) loops.push(loop);
            continue;
          }
          /* edge path: 93 numEdges, then per edge 72 type + ordered data */
          const chain = [];
          let single = null;   /* lone full circle/ellipse edge -> exact kind */
          let edgeCount = 0;
          while (i < n && !stop(code(i))) {
            if (code(i) !== 72) { i++; continue; }
            const etype = parseInt(g[i][1], 10) || 0;
            i++;
            edgeCount++;
            /* collect this edge's groups (codes repeat inside spline edges);
               spline edges own their 97 (num fit points) group */
            const vals = {};
            while (i < n) {
              const c = code(i);
              if (c === 72 || c === 92 || c === 75 || c === 98) break;
              if (c === 97 && etype !== 4) break;
              if (c === 330) { i++; continue; }         /* source object refs */
              (vals[c] || (vals[c] = [])).push(num(i));
              i++;
            }
            const v1 = (c, d) => (vals[c] && vals[c].length) ? vals[c][0] : d;
            if (etype === 1 && vals[10] && vals[20] && vals[11] && vals[21]) {
              chainAppend(chain, [
                { x: vals[10][0], y: vals[20][0] },
                { x: vals[11][0], y: vals[21][0] }
              ]);
            } else if (etype === 2 && vals[10] && vals[20] && v1(40, 0) > 0) {
              const c0 = { x: vals[10][0], y: vals[20][0] };
              const r = v1(40, 0);
              const a0 = v1(50, 0), a1 = v1(51, 360);
              const ccw = v1(73, 1) !== 0;
              const full = Math.abs(Math.abs(a1 - a0) - 360) < 1e-6 || a1 === a0;
              if (full && edgeCount === 1) single = { kind: 'circle', c: c0, r };
              else {
                single = null;
                chainAppend(chain, sweepAngles(a0 * RAD, a1 * RAD, ccw)
                  .map(t => ({ x: c0.x + r * Math.cos(t), y: c0.y + r * Math.sin(t) })));
              }
            } else if (etype === 3 && vals[10] && vals[20] && vals[11] && vals[21]) {
              const c0 = { x: vals[10][0], y: vals[20][0] };
              const mx = vals[11][0], my = vals[21][0];
              const rx = Math.hypot(mx, my);
              const ratio = v1(40, 1) > 0 ? v1(40, 1) : 1;
              const a0 = v1(50, 0), a1 = v1(51, 360);
              const ccw = v1(73, 1) !== 0;
              const full = Math.abs(Math.abs(a1 - a0) - 360) < 1e-6 || a1 === a0;
              if (rx > 0 && full && edgeCount === 1) {
                single = { kind: 'ellipse', c: c0, rx, ry: rx * ratio, rot: Math.atan2(my, mx) };
              } else if (rx > 0) {
                single = null;
                const ry = rx * ratio;
                const co = mx / rx, si = my / rx;
                chainAppend(chain, sweepAngles(a0 * RAD, a1 * RAD, ccw).map(t => {
                  const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
                  return { x: c0.x + ex * co - ey * si, y: c0.y + ex * si + ey * co };
                }));
              }
            } else if (etype === 4) {
              /* spline edge: fit points (11/21) preferred, else sampled
                 control points (10/20, knots 40, degree 94) */
              single = null;
              const fit = pairUp(vals[11] || [], vals[21] || []);
              if (fit.length >= 2) chainAppend(chain, fit);
              else {
                const ctrl = pairUp(vals[10] || [], vals[20] || []);
                if (ctrl.length >= 2) {
                  const samples = Math.min(64, Math.max(16, ctrl.length * 4));
                  chainAppend(chain, sampleBSpline(ctrl, v1(94, 3), vals[40] || null, samples));
                }
              }
            }
          }
          if (single && edgeCount === 1) { loops.push(single); continue; }
          const loop = closeLoop(chain);
          if (loop) loops.push(loop);
        }
        return loops;
      };

      /* boundary -> sampled polygon (containment tests) */
      const boundaryPoly = (b) => {
        if (b.kind === 'pline') return b.pts;
        const out = [];
        const N2 = 24;
        for (let s = 0; s < N2; s++) {
          const t = TAU * (s / N2);
          if (b.kind === 'circle') {
            out.push({ x: b.c.x + b.r * Math.cos(t), y: b.c.y + b.r * Math.sin(t) });
          } else { /* ellipse */
            const co = Math.cos(b.rot || 0), si = Math.sin(b.rot || 0);
            const ex = b.rx * Math.cos(t), ey = b.ry * Math.sin(t);
            out.push({ x: b.c.x + ex * co - ey * si, y: b.c.y + ex * si + ey * co });
          }
        }
        return out;
      };

      const polyCentroid = (pts) => {
        let a2 = 0, cx = 0, cy = 0;
        for (let i2 = 0; i2 < pts.length; i2++) {
          const p = pts[i2], q2 = pts[(i2 + 1) % pts.length];
          const cr = p.x * q2.y - q2.x * p.y;
          a2 += cr; cx += (p.x + q2.x) * cr; cy += (p.y + q2.y) * cr;
        }
        if (Math.abs(a2) > 1e-12) return { x: cx / (3 * a2), y: cy / (3 * a2) };
        let sx = 0, sy = 0;
        for (const p of pts) { sx += p.x; sy += p.y; }
        return { x: sx / pts.length, y: sy / pts.length };
      };

      const pointInPoly = (p, pts) => {
        let inside = false;
        for (let i2 = 0, j2 = pts.length - 1; i2 < pts.length; j2 = i2++) {
          const a = pts[i2], b = pts[j2];
          if ((a.y > p.y) !== (b.y > p.y) &&
              p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
        }
        return inside;
      };

      /* multi-loop policy (SPEC2 §17): disjoint loops each become their own
         hatch entity; a loop INSIDE another is an island — the hole the fill
         was traced around — and rides on that outer loop's entity. Keeping
         only the outer loop (what this did) painted a reopened wall over its
         own windows. Every inner loop, at any depth, hangs on its outermost
         ancestor: the fill is drawn even-odd, so a loop inside a hole fills
         again, the way the industry standard's Normal style paints it.
         Answers [{ b, isles }] — one group per hatch entity. */
      const pickHatchLoops = (loops) => {
        if (loops.length <= 1) return loops.map((b) => ({ b, isles: [] }));
        const polys = loops.map(boundaryPoly);
        const cents = polys.map(polyCentroid);
        const boxOf = (poly) => {
          let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
          for (const p of poly) {
            if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
            if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
          }
          return [minx, miny, maxx, maxy];
        };
        const boxes = polys.map(boxOf);
        const areas = boxes.map((b) => (b[2] - b[0]) * (b[3] - b[1]));
        /* the boxes settle most pairs without walking a polygon at all —
           this runs over every loop of every hatch as a file opens */
        const inBox = (p, b) => p.x >= b[0] && p.x <= b[2] && p.y >= b[1] && p.y <= b[3];
        /* Each loop's tightest container, or -1 for one nothing contains.
           The container has to be the BIGGER of the two: concentric loops
           all hold each other's centre, and without that test three boxes
           inside one another each claimed the next as their owner — a ring
           of claims with no outermost loop at all. */
        const owner = loops.map((_l, i) => {
          let best = -1;
          for (let j = 0; j < loops.length; j++) {
            if (i === j || !polys[j].length || !(areas[j] > areas[i])) continue;
            if (!inBox(cents[i], boxes[j])) continue;
            if (!pointInPoly(cents[i], polys[j])) continue;
            if (best < 0 || areas[j] < areas[best]) best = j;
          }
          return best;
        });
        const out = [];
        const groupAt = new Map();
        loops.forEach((b, i) => {
          if (owner[i] >= 0) return;
          groupAt.set(i, out.length);
          out.push({ b, isles: [] });
        });
        if (!out.length) return [{ b: loops[0], isles: [] }];  /* a ring of claims */
        loops.forEach((_b, i) => {
          if (owner[i] < 0) return;
          let root = i, guard = 0;
          while (owner[root] >= 0 && guard++ < loops.length) root = owner[root];
          const at = groupAt.get(root);
          if (at != null) out[at].isles.push(polys[i]);
        });
        return out;
      };

      /* ---- solid-modeller entities -------------------------------- *
       * A 3DSOLID carries no drawable geometry of its own — only the
       * modelling kernel's stream, as ciphered SAT text (groups 1 and 3,
       * up to R2004) or as binary SAB chunks (group 310, R2007 on). Its
       * wireframe is the EDGES of that stream, which is what the industry standard
       * draws and what its XEDGES command extracts.
       *
       * The extractor lives in nasjidwg, and this file deliberately does
       * not depend on it: the same source runs in the desktop app, the
       * browser build and the website's node converter, and only the
       * first has the library. A host that has it installs it as
       * Nasj.dxf.acisWiresFromPayload; the others keep today's behaviour
       * and report the entity skipped.
       *
       * NOTE for R2013 and later: the industry standard does not put the kernel stream
       * in a DXF at all there — the record carries the acis-empty flag
       * (290) and a revision id, nothing more — so no reader can draw
       * those from a DXF. Only the DWG carries them.
       */
      const acisOutline = (q, g) => {
        const fn = Nasj.dxf && Nasj.dxf.acisWiresFromPayload;
        if (typeof fn !== 'function') return null;
        let wires = null;
        const hex = q.rawAll(310).join('').replace(/[^0-9A-Fa-f]/g, '');
        if (hex.length >= 32) {
          const bin = new Uint8Array(hex.length >> 1);
          for (let i = 0; i < bin.length; i++) {
            bin[i] = parseInt(hex.substr(i * 2, 2), 16);
          }
          try { wires = fn(bin); } catch (_) { wires = null; }
        }
        if (!wires || !wires.length) {
          /* group 1 opens a line of SAT text, group 3 continues it; the
             text is ciphered with (159 - c) unless a foreign producer
             wrote it plain (then it opens with the version digits) */
          const lines = [];
          for (const [c, v] of g) {
            if (c === 1) lines.push(v);
            else if (c === 3 && lines.length) lines[lines.length - 1] += v;
          }
          if (lines.length) {
            let sat = lines.join('\n');
            if (!/^\d/.test(sat)) {
              let plain = '';
              for (let k = 0; k < sat.length; k++) {
                const ch = sat.charCodeAt(k);
                plain += String.fromCharCode(ch <= 32 || ch > 126 ? ch : 159 - ch);
              }
              sat = plain;
            }
            try { wires = fn(sat, 'sat'); } catch (_) { wires = null; }
          }
        }
        if (!wires || !wires.length) return null;
        const out = [];
        for (const w of wires) {
          if (!w || w.length < 2) continue;
          const pts = w.map((p) => {
            const r = { x: p.x, y: p.y };
            if (p.z) r.z = p.z;
            return r;
          });
          const a = pts[0], z = pts[pts.length - 1];
          const closed = pts.length > 2 && Math.abs(a.x - z.x) < 1e-9
            && Math.abs(a.y - z.y) < 1e-9 && Math.abs((a.z || 0) - (z.z || 0)) < 1e-9;
          if (closed) pts.pop();
          if (pts.length < 2) continue;
          out.push(Object.assign(baseProps(q), { type: 'polyline', pts, closed }));
        }
        return out.length ? out : null;
      };

      /* ---- entity conversion ---- */
      const convertEntity = (type, g) => {
        const q = G(g);
        switch (type) {
          case 'LINE': {
            /* the ends carry their heights (30/31): a line standing up is a
               line, not a point on the ground */
            const a = { x: q.num(10, 0), y: q.num(20, 0) };
            const b = { x: q.num(11, 0), y: q.num(21, 0) };
            const az = q.num(30, 0), bz = q.num(31, 0);
            if (az) a.z = az;
            if (bz) b.z = bz;
            return Object.assign(baseProps(q), { type: 'line', a, b });
          }
          case '3DFACE': { /* a facet with its heights; a fourth corner on the third is a triangle */
            const pts = [];
            for (let i = 0; i < 4; i++) {
              const p = { x: q.num(10 + i, 0), y: q.num(20 + i, 0) };
              const z = q.num(30 + i, 0);
              if (z) p.z = z;
              pts.push(p);
            }
            const same = (a, b) => Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12 && Math.abs((a.z || 0) - (b.z || 0)) < 1e-12;
            const tri = same(pts[3], pts[2]);
            if (tri) pts.pop();
            let hid = q.num(70, 0) & 15;
            if (tri && hid) hid = (hid & 3) | ((hid & 8) ? 4 : 0);
            return Object.assign(baseProps(q), { type: 'face3d', pts }, hid ? { hid } : null);
          }
          case 'LWPOLYLINE': {
            /* positional walk: 42 (bulge) / 40/41 (widths) belong to the
               vertex started by the preceding 10 */
            const pts = [];
            const vw = [];
            let cur = null;
            for (const [c, v] of g) {
              const nv = parseFloat(v);
              if (c === 10) { cur = { x: isFinite(nv) ? nv : 0, y: 0 }; pts.push(cur); }
              else if (c === 20 && cur) cur.y = isFinite(nv) ? nv : 0;
              else if (c === 42 && cur && isFinite(nv) && nv !== 0) cur.b = nv;
              else if ((c === 40 || c === 41) && cur && isFinite(nv) && nv > 0) vw.push(nv);
            }
            if (pts.length < 2) return null;
            const elev = q.num(38, 0);           /* a lightweight polyline stands at one height */
            if (elev) for (const p of pts) p.z = elev;
            const e = Object.assign(baseProps(q), {
              type: 'polyline', pts, closed: (q.int(70, 0) & 1) === 1
            });
            const cw = q.num(43, null);          /* constant width */
            if (cw != null && cw > 0) e.w = cw;
            else if (vw.length) e.w = vw.reduce((s, x) => s + x, 0) / vw.length;
            return e;
          }
          case 'CIRCLE': {
            const r = q.num(40, 0);
            if (!(r > 0)) return null;
            const c = { x: q.num(10, 0), y: q.num(20, 0) };
            const cz = q.num(30, 0);
            if (cz) c.z = cz;
            return Object.assign(baseProps(q), { type: 'circle', c, r });
          }
          case 'ARC': {
            const r = q.num(40, 0);
            if (!(r > 0)) return null;
            const c = { x: q.num(10, 0), y: q.num(20, 0) };
            const cz = q.num(30, 0);
            if (cz) c.z = cz;
            return Object.assign(baseProps(q), {
              type: 'arc', c, r,
              a0: q.num(50, 0) * RAD, a1: q.num(51, 360) * RAD
            });
          }
          case 'ELLIPSE': {
            const c = { x: q.num(10, 0), y: q.num(20, 0) };
            const mx = q.num(11, 1), my = q.num(21, 0);
            const ratio = q.num(40, 1);
            const rx = Math.hypot(mx, my);
            if (!(rx > 0) || !(ratio > 0)) return null;
            const rot = Math.atan2(my, mx);
            const p0 = q.num(41, 0), p1 = q.num(42, TAU);
            const sweep = Math.abs(p1 - p0);
            /* a partial ellipse comes home as a real elliptical arc — it used
               to be sampled into a 48-point polyline, which survived the trip
               but arrived as something else, unable to be trimmed or grip-
               edited as the ellipse it is. The DXF parameters are measured
               from the major axis, which is the frame `rot` already names. */
            const base = { type: 'ellipse', c, rx, ry: rx * ratio, rot };
            if (sweep < TAU - 1e-9) { base.a0 = p0; base.a1 = p1; }
            return Object.assign(baseProps(q), base);
          }
          case 'TEXT': {
            const h = q.num(40, 5);
            const e = Object.assign(baseProps(q), {
              type: 'text', p: { x: q.num(10, 0), y: q.num(20, 0) },
              str: decodeDxfText(q.str(1, '')), h: h > 0 ? h : 5, rot: q.num(50, 0) * RAD
            });
            applyTextJust(e, q.int(72, 0), q.int(73, 0),
              { x: q.num(11, e.p.x), y: q.num(21, e.p.y) }, q.num(41, 1));
            styleText(e, q.str(7, ''));
            return e;
          }
          case 'MTEXT': {
            const partsRaw = q.rawAll(3).concat(q.rawAll(1));
            const strVal = decodeDxfText(cleanMtext(partsRaw.join('')).trim());
            const h = q.num(40, 5);
            const e = Object.assign(baseProps(q), {
              type: 'text', p: { x: q.num(10, 0), y: q.num(20, 0) },
              str: strVal, h: h > 0 ? h : 5, rot: q.num(50, 0) * RAD
            });
            /* group 41 on an MTEXT is the reference column width, so an
               MTEXT takes its width factor from its style alone */
            styleText(e, q.str(7, ''));
            /* multiline MTEXT becomes our mt form (top-left anchored, real
               line breaks); a center/bottom attachment is approximated at
               the insertion point. Single-line MTEXT keeps the ha/va path. */
            if (strVal.indexOf('\n') >= 0) {
              e.mt = true;
              return e;
            }
            /* MTEXT 71 attachment point 1-9 -> ha/va; anchor is the insertion
               point itself (no p2). Group 41 here is the reference column
               width, NOT a width factor — intentionally ignored. */
            const ap = q.int(71, 1);
            if (ap >= 1 && ap <= 9) {
              e.ha = (ap - 1) % 3;                     /* 0 left/1 center/2 right */
              e.va = [3, 2, 1][Math.floor((ap - 1) / 3)]; /* top/middle/bottom */
            }
            return e;
          }
          case 'POINT': {
            const p = { x: q.num(10, 0), y: q.num(20, 0) };
            const pz = q.num(30, 0);
            if (pz) p.z = pz;
            return Object.assign(baseProps(q), { type: 'point', p });
          }
          case 'SPLINE': {
            const fit = pairUp(q.nums(11), q.nums(21));
            if (fit.length >= 2) {
              const zs = q.nums(31);           /* the fit points' heights */
              fit.forEach((p, i) => { if (zs[i]) p.z = zs[i]; });
              return Object.assign(baseProps(q), { type: 'spline', pts: fit });
            }
            const ctrl = pairUp(q.nums(10), q.nums(20));
            if (ctrl.length >= 2) {
              const degree = q.int(71, 3);
              const samples = Math.min(64, Math.max(16, ctrl.length * 4));
              const pts = sampleBSpline(ctrl, degree, q.nums(40), samples);
              return Object.assign(baseProps(q), { type: 'spline', pts });
            }
            return null;
          }
          case 'SOLID': {
            const c1 = { x: q.num(10, 0), y: q.num(20, 0) };
            const c2 = { x: q.num(11, 0), y: q.num(21, 0) };
            const c3 = { x: q.num(12, 0), y: q.num(22, 0) };
            const c4 = { x: q.num(13, c3.x), y: q.num(23, c3.y) };
            const pts = [c1, c2, c4, c3];
            return Object.assign(baseProps(q), {
              type: 'hatch', boundary: { kind: 'pline', pts, closed: true },
              pattern: 'SOLID', angle: 0, scale: 1
            });
          }
          case 'HATCH': {
            const boundaries = pickHatchLoops(parseHatchBoundaries(g));
            if (!boundaries.length) {
              warnings.push('HATCH with unsupported boundary skipped.');
              return null;
            }
            const rawName = q.str(2, '');
            const nameU = rawName.toUpperCase();
            const solid = q.int(70, 0) === 1 || nameU === 'SOLID';
            /* pattern definition line (53 angle / 45,46 offset) carries the
               true line spacing in drawing units -> optional ent.sp so the
               renderer matches the industry standard's density (SPEC2 §15) */
            let sp = null;
            if (!solid) {
              const a53 = q.num(53, null);
              const ox = q.num(45, null), oy = q.num(46, null);
              if (a53 != null && ox != null && oy != null) {
                const a = a53 * RAD;
                let d = Math.abs(-Math.sin(a) * ox + Math.cos(a) * oy);
                if (!(d > 1e-12)) d = Math.hypot(ox, oy);
                if (isFinite(d) && d > 1e-12) sp = d;
              }
              /* sp becomes the renderer's BASE spacing, which it multiplies
                 by each family's own factor — so a pattern whose first
                 family is not 1× (ANSI32's is 3×) must hand back the base,
                 not the first family's spacing */
              if (sp != null && typeof Nasj.hatchPatternDef === 'function') {
                const fams = Nasj.hatchPatternDef(nameU);
                if (fams && fams[0] && fams[0].sp > 0) sp /= fams[0].sp;
              }
            }
            const ents = boundaries.map((grp) => {
              const e = Object.assign(baseProps(q), {
                type: 'hatch', boundary: grp.b,
                /* the real pattern name: the renderer resolves it against its
                   library and falls back to ANSI31 lines for unknown names */
                pattern: solid ? 'SOLID' : (nameU || 'ANSI31'),
                angle: solid ? 0 : q.num(52, 0),
                scale: solid ? 1 : (q.num(41, 1) > 0 ? q.num(41, 1) : 1)
              });
              /* keep the original pattern name (line/cross fill render) */
              if (!solid && rawName) e.patName = rawName;
              if (sp != null) e.sp = sp;
              if (grp.isles.length) e.islands = grp.isles;
              return e;
            });
            return ents.length === 1 ? ents[0] : ents;
          }
          case 'INSERT': {
            const nm = decodeDxfText(q.str(2, ''));
            if (!nm) return null;
            return Object.assign(baseProps(q), {
              type: 'insert', name: nm,
              p: { x: q.num(10, 0), y: q.num(20, 0) },
              sx: q.num(41, 1), sy: q.num(42, 1),
              rot: q.num(50, 0) * RAD,
              _checkBlock: true
            });
          }
          case 'DIMENSION': {
            const nm = q.str(2, '');
            /* the app's own dimension first (see cadDimension); the block
               only for a kind it does not draw */
            const pt = (c) => ({ x: q.num(c, NaN), y: q.num(c + 10, NaN) });
            const rot = q.num(50, null);
            const src = {
              type: q.int(70, 0), def: pt(10), textMid: pt(11),
              p13: pt(13), p14: pt(14), p15: pt(15), p16: pt(16),
              rotation: rot == null ? 0 : rot * RAD,
              text: decodeDxfText(cleanMtext(q.str(1, ''))), measurement: q.num(42, NaN)
            };
            const blk = nm && blocks[nm];
            const info = cadDimBlockInfo(blk && blk.entities);
            const S = hdrVar('$DIMSCALE', 40);
            const native = cadDimension(src, {
              h: info.h, S: S > 0 ? S : 1, txtH: hdrVar('$DIMTXT', 40), dec: hdrVar('$DIMDEC', 70)
            });
            if (native) {
              const get = (k) => {
                if (k === 'DIMPOST' || k === 'DIMTXSTY') return hdrStr('$' + k);
                const v = hdrVar('$' + k, k === 'DIMSCALE' || k === 'DIMTXT' || k === 'DIMASZ' ||
                  k === 'DIMEXO' || k === 'DIMEXE' || k === 'DIMGAP' || k === 'DIMDLI' ||
                  k === 'DIMDLE' || k === 'DIMLFAC' || k === 'DIMRND' || k === 'DIMCEN' ||
                  k === 'DIMTSZ' || k === 'DIMALTF' ? 40 : 70);
                return v == null ? undefined : v;
              };
              native.style = cadDimStyleFor(dimStyles, q.str(3, ''), get, info, native, src);
              if (nm) spentDimBlocks.add(nm);
              return Object.assign(baseProps(q), native);
            }
            /* group 2 names the anonymous *D block holding the rendered
               dimension geometry, defined in world coordinates → identity
               insert. Missing block def → counted as skipped (as before). */
            if (!nm) { skip(type); return null; }
            return Object.assign(baseProps(q), {
              type: 'insert', name: nm, p: { x: 0, y: 0 },
              sx: 1, sy: 1, rot: 0,
              _checkBlock: true, _dim: true
            });
          }
          case 'LEADER': {
            const pts = pairUp(q.nums(10), q.nums(20));
            if (pts.length < 2) return null;      /* invalid leader → drop */
            return Object.assign(baseProps(q), {
              type: 'leader', pts, str: '', h: 2.5
            });
          }
          case 'WIPEOUT': {
            /* the mask is exactly what the WIPEOUT command creates: a
               SOLID hatch painted in the canvas background colour, kept
               at its place in the entity order (masking = draw order) */
            const pts = wipeoutPts(
              { x: q.num(10, 0), y: q.num(20, 0) },
              { x: q.num(11, 1), y: q.num(21, 0) },
              { x: q.num(12, 0), y: q.num(22, 1) },
              q.num(13, 1), q.num(23, 1),
              pairUp(q.nums(14), q.nums(24)));
            if (!pts) { skip(type); return null; }
            const e = Object.assign(baseProps(q), {
              type: 'hatch', boundary: { kind: 'pline', pts, closed: true },
              pattern: 'SOLID', angle: 0, scale: 1
            });
            e.color = '@bg';
            return e;
          }
          case 'MLINE': {
            /* the app's own multiline comes back AS one: the STANDARD
               two-element style is exactly what the renderer derives its
               lines from, so the vertex path plus the style fields ARE
               the whole object. Foreign styles (other element counts)
               keep the exploded polylines below. */
            if (q.int(73, 0) === 2) {
              const styleName = q.str(2, '').trim().toUpperCase();
              if (!styleName || styleName === 'STANDARD') {
                const xs = [], ys = [];
                for (const [c, v] of g) {
                  const nv = parseFloat(v);
                  if (c === 11) xs.push(isFinite(nv) ? nv : 0);
                  else if (c === 21) ys.push(isFinite(nv) ? nv : 0);
                }
                const pts = [];
                for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
                  pts.push({ x: xs[i], y: ys[i] });
                }
                if (pts.length >= 2) {
                  const j70 = q.int(70, 0);
                  const sc = q.num(40, 1);
                  return Object.assign(baseProps(q), {
                    type: 'mline', pts, closed: (q.int(71, 0) & 2) !== 0,
                    just: j70 === 1 ? 'Zero' : (j70 === 2 ? 'Bottom' : 'Top'),
                    scale: isNum(sc) && sc !== 0 ? Math.abs(sc) : 1,
                    style: 'STANDARD',
                  });
                }
              }
            }
            /* positional walk: 11 opens a vertex, 13/23 its miter
               direction, 74 opens an element's parameter run, 41 appends
               to it. Element j passes each vertex at position + miter *
               params[0] — the parallel polylines the mline is drawn as.
               (MLINESTYLE colours live in OBJECTS, which this importer
               does not read; elements keep the entity colour.) */
            const verts = [];
            let cur = null, curEl = null;
            for (const [c, v] of g) {
              const nv = parseFloat(v);
              if (c === 11) {
                cur = { x: isFinite(nv) ? nv : 0, y: 0, mx: 0, my: 1, els: [] };
                verts.push(cur);
                curEl = null;
              } else if (!cur) continue;
              else if (c === 21) cur.y = isFinite(nv) ? nv : 0;
              else if (c === 13) cur.mx = isFinite(nv) ? nv : 0;
              else if (c === 23) cur.my = isFinite(nv) ? nv : 0;
              else if (c === 74) { curEl = []; cur.els.push(curEl); }
              else if (c === 41 && curEl) curEl.push(isFinite(nv) ? nv : 0);
            }
            if (verts.length < 2 || !verts[0].els.length) { skip(type); return null; }
            const closed = (q.int(71, 0) & 2) !== 0;
            const ents = [];
            for (let j = 0; j < verts[0].els.length; j++) {
              const pts = [];
              for (const vx of verts) {
                const parms = vx.els[j];
                if (!parms || !parms.length) { pts.length = 0; break; }
                pts.push({ x: vx.x + vx.mx * parms[0], y: vx.y + vx.my * parms[0] });
              }
              if (pts.length >= 2) {
                ents.push(Object.assign(baseProps(q), { type: 'polyline', pts, closed }));
              }
            }
            if (!ents.length) { skip(type); return null; }
            return ents.length === 1 ? ents[0] : ents;
          }
          case '3DSOLID':
          case 'REGION':
          case 'BODY':
          case 'SURFACE':
          case 'PLANESURFACE':
          case 'EXTRUDEDSURFACE':
          case 'LOFTEDSURFACE':
          case 'REVOLVEDSURFACE':
          case 'SWEPTSURFACE':
          case 'NURBSURFACE': {
            const ents = acisOutline(q, g);
            if (!ents) { skip(type); return null; }
            return ents;
          }
          case 'ATTRIB':
            /* stray ATTRIB (not directly behind an INSERT) — still a text */
            return attribText(g);
          case 'SEQEND':
          case 'VIEWPORT':
            return null;                          /* skip silently */
          default:
            skip(type);
            return null;
        }
      };

      /* ATTRIB record -> top-level text entity (already world coordinates);
         invisible attributes (70 bit 1) and empty values return null */
      const attribText = (g2) => {
        const aq = G(g2);
        if ((aq.int(70, 0) & 1) === 1) return null;   /* invisible */
        const str = decodeDxfText(aq.str(1, ''));
        if (!String(str).length) return null;
        const h = aq.num(40, 5);
        const e = Object.assign(baseProps(aq), {
          type: 'text', p: { x: aq.num(10, 0), y: aq.num(20, 0) },
          str, h: h > 0 ? h : 5, rot: aq.num(50, 0) * RAD
        });
        /* ATTRIB vertical justification is group 74 (not 73) */
        applyTextJust(e, aq.int(72, 0), aq.int(74, 0),
          { x: aq.num(11, e.p.x), y: aq.num(21, e.p.y) }, aq.num(41, 1));
        styleText(e, aq.str(7, ''));
        return e;
      };

      /* parse a run of entities in pairs[start..end); returns array */
      const parseEntities = (start, end) => {
        const out = [];
        let i = findNext0(start, null, end);
        while (i < end) {
          const v0 = val(i);
          if (v0 === 'ENDSEC' || v0 === 'ENDBLK' || v0 === 'EOF') break;
          const rec = collectGroups(i, end);
          let entOut = null;
          if (rec.type === 'POLYLINE') {
            /* heavyweight polyline: POLYLINE + VERTEX* + SEQEND */
            const q = G(rec.g);
            const closed = (q.int(70, 0) & 1) === 1;
            const dsw = q.num(40, 0), dew = q.num(41, 0); /* default widths */
            const pts = [];
            const vw = [];
            let k = rec.next;
            while (k < end && pairs[k][0] === 0 && val(k) === 'VERTEX') {
              const vr = collectGroups(k, end);
              const vq = G(vr.g);
              const p = { x: vq.num(10, 0), y: vq.num(20, 0) };
              const vz = vq.num(30, 0);       /* a 3D polyline's vertex height */
              if (vz) p.z = vz;
              const b = vq.num(42, 0);
              if (isFinite(b) && b !== 0) p.b = b;
              pts.push(p);
              const sw = vq.num(40, dsw), ew = vq.num(41, dew);
              if (sw > 0) vw.push(sw);
              if (ew > 0) vw.push(ew);
              k = vr.next;
            }
            if (k < end && pairs[k][0] === 0 && val(k) === 'SEQEND') {
              k = collectGroups(k, end).next;
            }
            if (pts.length >= 2) {
              entOut = Object.assign(baseProps(q), { type: 'polyline', pts, closed });
              if (vw.length) entOut.w = vw.reduce((s, x) => s + x, 0) / vw.length;
            }
            i = k;
          } else if (rec.type === 'INSERT') {
            /* INSERT [+ ATTRIB* + SEQEND]: attributes carry world coordinates
               and become top-level text entities (title blocks etc.) */
            entOut = convertEntity(rec.type, rec.g);
            let k = rec.next;
            while (k < end && pairs[k][0] === 0 && val(k) === 'ATTRIB') {
              const ar = collectGroups(k, end);
              const t = attribText(ar.g);
              if (t) out.push(t);
              k = ar.next;
            }
            if (k < end && pairs[k][0] === 0 && val(k) === 'SEQEND') {
              k = collectGroups(k, end).next;
            }
            i = k;
          } else {
            entOut = convertEntity(rec.type, rec.g);
            i = rec.next;
          }
          const areaNumber = aiSelectionFromPairs(rec.g);
          if (areaNumber != null && entOut && !Array.isArray(entOut) &&
              (entOut.type === 'polyline' || entOut.type === 'hatch')) entOut.aisel = areaNumber;
          if (Array.isArray(entOut)) { for (const e2 of entOut) out.push(e2); }
          else if (entOut) out.push(entOut);
          i = findNext0(i, null, end);
        }
        return out;
      };

      /* ---- TABLES ---- */
      const parseTables = (start, end) => {
        let i = findNext0(start, 'TABLE', end);
        while (i < end) {
          const tName = (pairs[i + 1] && pairs[i + 1][0] === 2) ? val(i + 1) : '';
          const tEnd = findNext0(i + 1, 'ENDTAB', end);
          if (tName === 'LAYER') {
            let k = findNext0(i + 1, 'LAYER', tEnd);
            while (k < tEnd) {
              const rec = collectGroups(k, tEnd);
              const q = G(rec.g);
              const nm = q.str(2, '');
              if (nm !== '') {
                const c62 = q.int(62, 7);
                const flags = q.int(70, 0);
                const tc = q.num(420, null);
                const aci = Math.abs(c62);
                const ly = ensureLayer(nm);
                ly.color = tc != null ? intToHex(tc)
                  : (aci >= 1 && aci <= 255 ? aciToHex(aci) : '#ffffff');
                ly.on = c62 >= 0;
                ly.frozen = (flags & 1) === 1;
                ly.locked = (flags & 4) === 4;
                const llt = ltIn(q.str(6, null));
                if (llt) ly.lt = llt;
                const llw = q.int(370, null);
                if (llw != null && llw > 0) ly.lw = llw / 100;
              }
              k = findNext0(rec.next, 'LAYER', tEnd);
            }
          }
          if (tName === 'STYLE') {
            let k = findNext0(i + 1, 'STYLE', tEnd);
            while (k < tEnd) {
              const rec = collectGroups(k, tEnd);
              const q = G(rec.g);
              const nm = decodeDxfText(q.str(2, '')).trim();
              /* bit 1 of 70 is a SHAPE file, which names no text style */
              if (nm && !(q.int(70, 0) & 1) && !styleByName[nm.toUpperCase()]) {
                const wf = q.num(41, 1);
                const fh = q.num(40, 0);
                /* a TrueType style names its file in group 3 and its FAMILY
                   in the ACAD xdata (1000), and only the family is a name a
                   canvas knows — some styles carry nothing else at all */
                const acad = String(q.str(1001, '')).trim().toUpperCase() === 'ACAD';
                const face = acad ? q.str(1000, '') : '';
                const flg = acad ? q.int(1071, 0) : 0;
                const st = {
                  name: nm,
                  font: (face && face.trim()) || fontFamily(q.str(3, '')) || CAD_FACE,
                  wf: (isFinite(wf) && wf > 0) ? wf : 1,
                  oblique: isFinite(q.num(50, 0)) ? q.num(50, 0) : 0,
                  fstyle: ((flg & 0x2000000) ? ((flg & 0x1000000) ? 'Bold Italic' : 'Bold')
                    : ((flg & 0x1000000) ? 'Italic' : 'Regular')),
                  h: (isFinite(fh) && fh > 0) ? fh : 0
                };
                styleByName[nm.toUpperCase()] = st;
                styles.push(st);
              }
              k = findNext0(rec.next, 'STYLE', tEnd);
            }
          }
          if (tName === 'VPORT') {
            /* The *Active viewport IS what the industry standard shows on open: centre
               (12/22, in the view's own frame), height (40) and twist (51,
               degrees). A georeferenced site plan is often DRAWN at an
               angle with its sheet far from the survey grid; opening on
               this view — instead of refitting extents — is what makes it
               come up square and framed exactly as it was left. The twist
               rotates the VIEW only; no coordinate is touched. */
            let k = findNext0(i + 1, 'VPORT', tEnd);
            while (k < tEnd) {
              const rec = collectGroups(k, tEnd);
              const q = G(rec.g);
              const nm = String(q.str(2, '')).toUpperCase();
              if (nm === '*ACTIVE' || !savedView) {
                const tw = q.num(51, null);
                const cx = q.num(12, null), cy = q.num(22, null);
                const vh = q.num(40, null);
                const v = {};
                if (tw != null && isFinite(tw) && tw % 360 !== 0) v.twist = tw * RAD;
                if (cx != null && cy != null && isFinite(cx) && isFinite(cy) &&
                    vh != null && isFinite(vh) && vh > 0) {
                  v.center = { x: cx, y: cy };
                  v.height = vh;
                }
                if (v.twist != null || v.height != null) savedView = v;
              }
              k = findNext0(rec.next, 'VPORT', tEnd);
            }
          }
          i = findNext0(tEnd + 1, 'TABLE', end);
        }
      };

      /* ---- BLOCKS ---- */
      const parseBlocks = (start, end) => {
        let i = findNext0(start, 'BLOCK', end);
        while (i < end) {
          const rec = collectGroups(i, end);
          const q = G(rec.g);
          const nm = decodeDxfText(q.str(2, ''));
          const blkEnd = findNext0(rec.next, 'ENDBLK', end);
          /* skip layout system blocks — the exporter always writes its own */
          const isSystem = /^\*(model_space|paper_space)/i.test(nm);
          if (nm && !isSystem && !(nm in blocks)) {
            /* nested INSERTs are kept here and expanded into transformed
               copies once every block def is known (flattenNestedInserts). */
            let ents = parseEntities(rec.next, blkEnd);
            /* only inserts carry the markers (_dim never rides without
               _checkBlock) — a blanket delete re-shaped a million untouched
               block children for nothing (parity: dwg-doc.js) */
            ents.forEach(e => { if (e._checkBlock) { delete e._checkBlock; delete e._dim; } });
            /* A dimension's block carries its definition points on
               DEFPOINTS: construction data the industry standard never draws. Kept, they
               appear as point glyphs the source drawing does not show. */
            ents = ents.filter(e => !(e.type === 'point' &&
              /^defpoints$/i.test(String(e.layerId || ''))));
            blocks[nm] = {
              base: { x: q.num(10, 0), y: q.num(20, 0) },
              entities: ents
            };
          }
          i = findNext0(blkEnd + 1, 'BLOCK', end);
        }
      };

      /* ---- walk sections ---- */
      let i = 0;
      const entityRuns = [];
      while (i < pairs.length) {
        if (pairs[i][0] === 0 && val(i) === 'SECTION') {
          const secName = (pairs[i + 1] && pairs[i + 1][0] === 2) ? val(i + 1) : '';
          const secEnd = findNext0(i + 2, 'ENDSEC', pairs.length);
          if (secName === 'TABLES') parseTables(i + 2, secEnd);
          else if (secName === 'BLOCKS') parseBlocks(i + 2, secEnd);
          else if (secName === 'ENTITIES') entityRuns.push([i + 2, secEnd]);
          i = secEnd + 1;
        } else {
          i++;
        }
      }
      /* all block defs known → expand nested inserts inside them */
      flattenNestedInserts(blocks, warnings, uid);

      for (const [s, e] of entityRuns) {
        for (const ent of parseEntities(s, e)) {
          if (ent._checkBlock) {
            const fromDim = !!ent._dim;
            delete ent._checkBlock;
            delete ent._dim;
            if (!(ent.name in blocks)) {
              if (fromDim) skip('DIMENSION');
              else warnings.push('INSERT references missing block "' + ent.name + '" — skipped.');
              continue;
            }
          }
          entities.push(ent);
        }
      }

      for (const type of Object.keys(skipped)) {
        warnings.push('Skipped ' + skipped[type] + ' ' + type +
          ' entit' + (skipped[type] === 1 ? 'y' : 'ies') + ' (not supported).');
      }
    } catch (err) {
      warnings.push('DXF import error: ' + (err && err.message ? err.message : String(err)));
    }

    /* warnings hygiene: aggregate repeated messages into one line each */
    if (warnings.length > 1) {
      const counts = new Map();
      for (const wmsg of warnings) counts.set(wmsg, (counts.get(wmsg) || 0) + 1);
      if (counts.size < warnings.length) {
        warnings.length = 0;
        counts.forEach((n, wmsg) => {
          warnings.push(n > 1 ? wmsg + ' (x' + n + ')' : wmsg);
        });
      }
    }

    if (!layers.length) ensureLayer('0');
    restoreAiSelections(entities, layers);
    dropSpentDimBlocks(blocks, entities, spentDimBlocks);
    const out = { layers, entities, blocks, warnings };
    /* the STYLE table the file brought, in docOps.repairStyles' own shape
       (see the same note in dwg-doc.js: docFromImport would have to carry
       it for the STYLE dialog to list these; every text draws with its own
       face either way) */
    if (styles.length) out.styles = { text: { current: styles[0].name, list: styles } };
    if (dimStyles.length) {
      out.styles = out.styles || {};
      const cur = dimStyleCur;
      out.styles.dim = { current: (cur && dimStyles.some((s) => s.name === cur)) ? cur : dimStyles[0].name, list: dimStyles };
    }
    if (savedView) out.view = savedView;
    if (pdmode != null || pdsize != null) {
      out.settings = {};
      if (pdmode != null) out.settings.pdmode = pdmode;
      if (pdsize != null) out.settings.pdsize = pdsize;
    }
    return out;
  };

  Nasj.dxf = {
    exportDoc, exportDocGen, importText, aciToHex, nearestAci,
    aiSelectionFromPairs, restoreAiSelections,
    cadDimension, cadDimBlockInfo, cadDimStyleFor, dropSpentDimBlocks,
    /* shared with the direct DWG converter (dwg-doc.js), so both routes
       into a document run the very same text, spline, colour and
       nested-block machinery */
    decodeDxfText, sampleBSpline, intToHex, flattenNestedInserts, wipeoutPts,
    fontFamily, CAD_FACE, SHX_FACE
  };
  /* node: the website's pipeline requires this file directly out of the
     submodule, so there is exactly one DXF writer in the company */
  if (typeof module !== 'undefined' && module.exports) module.exports = Nasj.dxf;
})();
