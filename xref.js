/* pixelbay CAD — xref.js. Owner: REFERENCE.
 * External references: a drawing on disk, shown inside this one.
 *
 * A reference is NOT a new kind of entity. It is a block definition that
 * remembers the file it was read from (def.xref, validated in entities.js),
 * placed by ordinary `insert` entities. Everything the app already knows how
 * to do to a block reference — move, copy, scale, rotate, snap to, select —
 * therefore works on a reference for free, and the only code that has to know
 * about files is in here.
 *
 * The geometry is kept in the host drawing as well as on disk. That is
 * deliberate: a drawing whose reference has gone missing still shows what it
 * showed last time, and says so, instead of opening blank.
 *
 *   Nasj.xref.define(doc, payload, opts) -> {ok, name, fresh, warnings, error}
 *   Nasj.xref.place(doc, name, opts)     -> {ok, ent, error}
 *   Nasj.xref.attach(doc, payload, opts) -> define + place, in one call
 *   Nasj.xref.reload(doc, name)          -> Promise<{ok, warnings, error}>
 *   Nasj.xref.reloadAll(doc)             -> Promise<[{name, ok, error}]>
 *   Nasj.xref.unload/load/detach/bind(doc, name) -> {ok, error}
 *   Nasj.xref.list(doc)                  -> [{name, def, xref, count}]
 *   Nasj.xref.isXref(doc, nameOrEnt)     -> boolean
 *   Nasj.xref.defOf(doc, ent)            -> the xref block definition | null
 *   Nasj.xref.fadeOf(doc, ent)           -> 0..90, what this reference fades by
 *
 * Plain script, attaches to window.Nasj. No DOM access, no init at parse time.
 */
(() => {
  'use strict';
  const Nasj = window.Nasj = window.Nasj || {};

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const clampFade = (v) => Math.max(0, Math.min(90, v));

  /* Windows hands the same file back with either slash and either case, so a
     path is compared by its normalized form and never by string equality. */
  const normPath = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();

  const stem = (fileName) => String(fileName || 'Xref')
    .replace(/\.(njc|dxf|dwg)$/i, '').trim() || 'Xref';

  /* ------------------------------------------------------------------ *
   * Reading a reference file into the shape a block definition wants
   * ------------------------------------------------------------------ */

  /* The payload from xref:pick / xref:read -> {layers, entities, blocks}.
     Each format arrives differently: DWG is parsed in the main process, DXF
     text is parsed here, and a .njc is a whole saved drawing. */
  const dataOf = (payload) => {
    if (!payload) return null;
    const kind = String(payload.kind || '').toLowerCase();
    try {
      if (kind === 'dwg') return payload.data || null;
      if (kind === 'dxf') {
        if (!(Nasj.dxf && typeof Nasj.dxf.importText === 'function')) return null;
        return Nasj.dxf.importText(String(payload.json || ''));
      }
      if (kind === 'njc') {
        if (!(Nasj.docOps && typeof Nasj.docOps.deserialize === 'function')) return null;
        const d = Nasj.docOps.deserialize(String(payload.json || ''), 'Reference');
        return { layers: d.layers, entities: d.entities, blocks: d.blocks, warnings: [] };
      }
    } catch (err) {
      return null;
    }
    return null;
  };

  /* The reference's geometry as one flat list. A drawing may use blocks of
     its own, and a block definition here cannot hold a nested reference
     (insertEntities skips those), so the referenced drawing's own inserts are
     resolved to plain geometry now — otherwise attaching a drawing built out
     of blocks would attach almost nothing. */
  const flatten = (data) => {
    const host = { blocks: (data && data.blocks) || {} };
    const out = [];
    const geom = Nasj.geom;
    for (const e of ((data && data.entities) || [])) {
      if (!e || typeof e !== 'object') continue;
      if (e.type === 'insert') {
        if (geom && typeof geom.insertEntities === 'function') {
          for (const c of geom.insertEntities(e, host)) out.push(c);
        }
        continue;
      }
      out.push(e);
    }
    return out;
  };

  /* The reference's own layer table. These deliberately never join the host
     drawing's layers: two drawings both using layer "0" must not collide, and
     ULAYERS wants exactly this list to switch. */
  const layerTable = (data) => {
    const lys = (Array.isArray(data && data.layers) ? data.layers : [])
      .filter((l) => l && typeof l === 'object')
      .map((l) => ({
        id: String(l.id != null ? l.id : (l.name != null ? l.name : '0')),
        name: String(l.name != null ? l.name : (l.id != null ? l.id : '0')),
        color: typeof l.color === 'string' ? l.color : '#ffffff',
        on: l.on !== false
      }));
    if (!lys.some((l) => l.id === '0')) {
      lys.unshift({ id: '0', name: '0', color: '#ffffff', on: true });
    }
    return lys;
  };

  /* A reload must not undo the user's ULAYERS switches: a layer that comes
     back under the same name keeps the on/off it was given. */
  const mergeLayers = (prev, next) => {
    if (!Array.isArray(prev) || !prev.length) return next;
    const was = new Map(prev.map((l) => [l.name, l.on !== false]));
    return next.map((l) => (was.has(l.name) ? Object.assign({}, l, { on: was.get(l.name) }) : l));
  };

  /* ------------------------------------------------------------------ *
   * Finding references in a drawing
   * ------------------------------------------------------------------ */

  const defOfName = (doc, name) => {
    const def = doc && doc.blocks && doc.blocks[name];
    return (def && def.xref) ? def : null;
  };

  const defOf = (doc, ent) => (ent && ent.type === 'insert') ? defOfName(doc, ent.name) : null;

  const isXref = (doc, x) => !!(typeof x === 'string' ? defOfName(doc, x) : defOf(doc, x));

  /* Attaching the same file twice is ONE definition with two references —
     that is the whole point of a reference — so an existing definition for
     this path is reused rather than duplicated. The pathâ†’name index is
     kept per document and rebuilt when the block table changes shape
     (attach adds a key, detach removes one) — walking and normalizing
     6,000-odd definitions per lookup was paid on every attach and reload. */
  const pathIdx = new WeakMap();   /* doc -> { blocks, sig, map } */
  const pathIndexOf = (doc) => {
    const blocks = (doc && doc.blocks) || {};
    const names = Object.keys(blocks);
    /* the key list IS the signature: attach/detach/BLOCK all change it,
       while a def's path never changes in place (reload rewrites the same
       path; bind deletes def.xref, which the hit-guard below answers) */
    const sig = names.join('\x1f');
    let rec = pathIdx.get(doc);
    if (!rec || rec.blocks !== doc.blocks || rec.sig !== sig) {
      const map = new Map();
      for (const nm of names) {
        const def = blocks[nm];
        if (def && def.xref) {
          const key = normPath(def.xref.path);
          if (key && !map.has(key)) map.set(key, nm);
        }
      }
      rec = { blocks: doc.blocks, sig, map };
      if (doc) pathIdx.set(doc, rec);
    }
    return rec.map;
  };
  const findByPath = (doc, p) => {
    const key = normPath(p);
    if (!key) return null;
    const nm = pathIndexOf(doc).get(key);
    /* a def whose name was reused for a non-xref keeps the answer honest */
    return (nm !== undefined && defOfName(doc, nm)) ? nm : null;
  };

  const uniqueName = (doc, base) => {
    const blocks = (doc && doc.blocks) || {};
    if (!blocks[base]) return base;
    let i = 1;
    while (blocks[base + '_' + i]) i++;
    return base + '_' + i;
  };

  /* the drawing's reference definitions, cheapest question first — no
     entity walk at all (shared by list and reloadAll) */
  const xrefDefs = (doc) => {
    const out = [];
    for (const [name, def] of Object.entries((doc && doc.blocks) || {})) {
      if (def && def.xref) out.push({ name, def });
    }
    return out;
  };

  /* every reference in the drawing, with how many times it is placed.
     ONE walk counts every name together — a filter per reference was
     O(references Ã— entities) on a heavy drawing. */
  const list = (doc) => {
    const defs = xrefDefs(doc);
    if (!defs.length) return [];
    const counts = new Map(defs.map((d) => [d.name, 0]));
    for (const e of (doc.entities || [])) {
      if (e && e.type === 'insert' && counts.has(e.name)) {
        counts.set(e.name, counts.get(e.name) + 1);
      }
    }
    const out = defs.map(({ name, def }) =>
      ({ name, def, xref: def.xref, count: counts.get(name) }));
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  };

  /* ------------------------------------------------------------------ *
   * Fading — XDWGFADECTL, and ADJUST's per-reference override
   * ------------------------------------------------------------------ */

  const fadeCtl = () => {
    const s = Nasj.settings;
    return clampFade(s && isNum(s.xdwgfadectl) ? s.xdwgfadectl : 50);
  };

  const fadeOf = (doc, ent) => {
    const def = defOf(doc, ent);
    if (!def) return 0;
    return isNum(def.xref.fade) ? clampFade(def.xref.fade) : fadeCtl();
  };

  /* ------------------------------------------------------------------ *
   * Attach / reload / unload / detach / bind
   * ------------------------------------------------------------------ */

  /* Write a freshly-read file into a definition, keeping the switches the
     user has already set on it. Shared by attach and reload. */
  const fill = (def, data, path, opts, stat) => {
    const o = opts || {};
    const prev = def.xref || {};
    const st = stat || {};
    def.base = { x: 0, y: 0 };
    def.entities = flatten(data);
    def.xref = {
      path,
      /* what the file was when it was last read — the palette lists both */
      size: isNum(st.size) ? st.size : (isNum(prev.size) ? prev.size : null),
      date: isNum(st.mtime) ? st.mtime : (isNum(prev.date) ? prev.date : null),
      type: o.type === 'overlay' ? 'overlay'
        : (o.type === 'attach' ? 'attach' : (prev.type || 'attach')),
      pathType: o.pathType || prev.pathType || 'full',
      found: true,
      unloaded: false,
      fade: isNum(prev.fade) ? prev.fade : null,
      layers: mergeLayers(prev.layers, layerTable(data))
    };
    return def;
  };

  /* Read the file into a definition, WITHOUT placing it. Attaching is two
     steps because ATTACH can let the user drag the reference into position,
     and there is nothing to drag until the geometry is known.
     payload is what xref:pick / xref:read returned; opts carries the Attach
     dialog's Reference Type and Path type. */
  const define = (doc, payload, opts) => {
    if (!doc || !doc.blocks) return { ok: false, error: 'No drawing is open.' };
    const data = dataOf(payload);
    if (!data) {
      return { ok: false, error: 'Could not read ' + ((payload && payload.name) || 'the reference file') + '.' };
    }
    const path = String((payload && payload.path) || '');
    /* the same file attached twice is ONE definition with two placements */
    let name = findByPath(doc, path);
    const fresh = !name;
    if (!name) name = uniqueName(doc, stem(payload && payload.name));
    doc.blocks[name] = fill(doc.blocks[name] || {}, data, path, opts, payload);
    const warnings = Array.isArray(data.warnings) ? data.warnings.slice() : [];
    if (!doc.blocks[name].entities.length) {
      warnings.push(name + ' has no geometry this release can draw.');
    }
    return { ok: true, name, fresh, warnings };
  };

  /* Put a defined reference down. opts: {p, sx, sy, rot, layerId}. */
  const place = (doc, name, opts) => {
    const o = opts || {};
    if (!defOfName(doc, name)) return { ok: false, error: name + ' is not an external reference.' };
    const ent = {
      type: 'insert',
      name,
      p: (o.p && isNum(o.p.x) && isNum(o.p.y)) ? { x: o.p.x, y: o.p.y } : { x: 0, y: 0 },
      sx: (isNum(o.sx) && o.sx !== 0) ? o.sx : 1,
      sy: (isNum(o.sy) && o.sy !== 0) ? o.sy : 1,
      rot: isNum(o.rot) ? o.rot : 0,
      layerId: o.layerId || doc.currentLayerId
    };
    if (Nasj.docOps && typeof Nasj.docOps.addEntity === 'function') {
      Nasj.docOps.addEntity(doc, ent);
    } else {
      doc.entities.push(ent);
    }
    return { ok: true, name, ent };
  };

  /* define + place, for callers that already know where it goes */
  const attach = (doc, payload, opts) => {
    const d = define(doc, payload, opts);
    if (!d.ok) return d;
    const p = place(doc, d.name, opts);
    if (!p.ok) return p;
    return { ok: true, name: d.name, ent: p.ent, fresh: d.fresh, warnings: d.warnings };
  };

  /* Re-read a reference from disk. A file that has gone missing is not an
     error the user has to dismiss: the definition is marked not-found, keeps
     the geometry it last had, and the caller says so on the command line. */
  const reload = async (doc, name) => {
    const def = defOfName(doc, name);
    if (!def) return { ok: false, error: name + ' is not an external reference.' };
    const api = window.nasjAPI;
    if (!api || typeof api.readXref !== 'function') {
      return { ok: false, error: 'Reference reading is unavailable.' };
    }
    let res = null;
    try {
      res = await api.readXref({ path: def.xref.path });
    } catch (err) {
      res = { ok: false, error: (err && err.message) || String(err) };
    }
    if (!res || !res.ok) {
      def.xref.found = false;
      return { ok: false, error: (res && res.error) || 'File not found.' };
    }
    const data = dataOf(res);
    if (!data) {
      def.xref.found = false;
      return { ok: false, error: 'Could not read ' + def.xref.path + '.' };
    }
    fill(def, data, def.xref.path, null, res);
    return { ok: true, warnings: Array.isArray(data.warnings) ? data.warnings : [] };
  };

  /* Every reference in the drawing, re-read. Called when a drawing opens, so
     what it shows is what the referenced files say NOW. Only the NAMES are
     needed here — list()'s placement counts were a thrown-away entity walk. */
  const reloadAll = async (doc) => {
    const out = [];
    const defs = xrefDefs(doc).sort((a, b) => a.name.localeCompare(b.name));
    for (const { name } of defs) {
      const r = await reload(doc, name);
      out.push({ name, ok: !!r.ok, error: r.error });
    }
    return out;
  };

  const unload = (doc, name) => {
    const def = defOfName(doc, name);
    if (!def) return { ok: false, error: name + ' is not an external reference.' };
    def.xref.unloaded = true;
    return { ok: true };
  };

  const load = (doc, name) => {
    const def = defOfName(doc, name);
    if (!def) return { ok: false, error: name + ' is not an external reference.' };
    def.xref.unloaded = false;
    return { ok: true };
  };

  /* Detach removes the reference AND every placement of it — a definition
     nothing points at is not a reference, it is litter. */
  const detach = (doc, name) => {
    const def = defOfName(doc, name);
    if (!def) return { ok: false, error: name + ' is not an external reference.' };
    const before = doc.entities.length;
    doc.entities = doc.entities.filter((e) => !(e && e.type === 'insert' && e.name === name));
    delete doc.blocks[name];
    return { ok: true, removed: before - doc.entities.length };
  };

  /* Bind turns the reference into an ordinary block: the link to the file is
     cut, so the reference's own layer colours are baked into the geometry
     first — nothing else would know how to resolve them afterwards. */
  const bind = (doc, name) => {
    const def = defOfName(doc, name);
    if (!def) return { ok: false, error: name + ' is not an external reference.' };
    const lys = new Map((def.xref.layers || []).map((l) => [l.id, l]));
    def.entities = def.entities.filter((e) => {
      const ly = lys.get(e.layerId);
      return !(ly && ly.on === false);   /* a layer switched off stays hidden */
    }).map((e) => {
      const ly = lys.get(e.layerId);
      if (ly && (!e.color || e.color === 'ByLayer')) e.color = ly.color;
      e.layerId = doc.currentLayerId;
      return e;
    });
    delete def.xref;
    return { ok: true };
  };

  Nasj.xref = {
    define, place, attach, reload, reloadAll, unload, load, detach, bind,
    list, isXref, defOf, defOfName, fadeOf, fadeCtl,
    /* used by the Attach dialog and the reference manager */
    dataOf, stem, findByPath, normPath
  };
})();
