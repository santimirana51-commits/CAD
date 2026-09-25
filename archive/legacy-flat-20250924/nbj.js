/* Nasjicad — nbj.js  (SPEC2 §18). Owner: FILEIO.
 * NBJ — the binary encoding the converted-document cache stores its heavy
 * segments in (main.js: container v3, CACHE_VER 4). One encoder, one
 * decoder, loaded as a plain script by the renderer (window.NasjNBJ) and
 * required as CommonJS by main.js — the same file in both processes, so the
 * two can never drift.
 *
 * WHY. A heavy drawing's conversion cache used to store JSON, and the
 * renderer paid JSON.parse for every byte of it — 1.4 s of a warm open of a
 * 246k-entity drawing went to re-reading decimal numbers out of text. NBJ
 * stores the same values as tagged binary: numbers are 8-byte doubles read
 * straight off a DataView, and every string in a segment lives once in a
 * per-segment pool, so hydration allocates per OBJECT (one entity, one
 * point), never per field string.
 *
 * SEGMENT LAYOUT (one 'ents' or 'blocks' cache segment):
 *
 *   [u32 LE poolBytes] [poolBytes: UTF-8 of a JSON string array — the pool]
 *   [u32 LE count]     [count × u32 LE seq]      [count encoded values]
 *
 * The pool is parsed with ONE JSON.parse (a flat string array — layer ids,
 * colour names, entity types, block names, text content, and every object
 * KEY, each stored once). `seq` is the item's position in the original
 * document array: segments may be streamed in any order (viewport-first)
 * and the reader re-seats every item at its exact original index, which is
 * what keeps the final draw order byte-identical to the conversion's.
 *
 * VALUE ENCODING — one tag byte, then:
 *   0 null   1 false   2 true
 *   3 f64            8 bytes LE
 *   4 int            zigzag LEB128 varint (safe 32-bit integers only)
 *   5 string         varint pool index
 *   6 array          varint length, then the items
 *   7 object         varint field count, then per field:
 *                      varint pool index of the key, then the value
 *   8 pt2  {x,y}     2 × f64   — the dominant shapes get their own tags:
 *   9 pt3  {x,y,z}   3 × f64     a polyline vertex costs 17 bytes and one
 *  10 pt2b {x,y,b}   3 × f64     allocation instead of an object header,
 *                                two key refs and two number parses
 * Tags 8-10 apply only when the object's OWN key order is exactly x,y /
 * x,y,z / x,y,b with all-finite numbers, so decoding rebuilds the identical
 * object shape and key order.
 *
 * JSON PARITY. The old cache ran through JSON.stringify, so this encoder
 * keeps its edge cases: non-finite numbers encode as null, undefined array
 * items as null, and undefined object fields are skipped. -0 encodes as a
 * double (harmless: it compares and renders as 0).
 *
 * GUARANTEES. Encode is one pass over the value graph; decode is one pass
 * over the bytes plus one JSON.parse of the pool — both strictly linear in
 * the input, no quadratic scans, so a machine N× slower decodes exactly N×
 * slower. Decode throws on any out-of-range pool index, varint over 5
 * bytes, or read past the end — a torn segment is an error, never garbage.
 */
(() => {
  'use strict';
  const HAS_WINDOW = typeof window !== 'undefined';

  const T_NULL = 0, T_FALSE = 1, T_TRUE = 2, T_F64 = 3, T_INT = 4,
    T_STR = 5, T_ARR = 6, T_OBJ = 7, T_PT2 = 8, T_PT3 = 9, T_PT2B = 10;

  /* ------------------------------ encode ------------------------------ */
  const encodeItems = (items, seqs) => {
    const n = items.length;
    let cap = 1 << 16;
    let u8 = new Uint8Array(cap);
    let dv = new DataView(u8.buffer);
    let p = 0;
    const ensure = (need) => {
      if (p + need <= cap) return;
      while (p + need > cap) cap *= 2;
      const next = new Uint8Array(cap);
      next.set(u8.subarray(0, p));
      u8 = next;
      dv = new DataView(u8.buffer);
    };
    const pool = [];
    const poolIx = new Map();
    const intern = (s) => {
      let ix = poolIx.get(s);
      if (ix === undefined) { ix = pool.length; pool.push(s); poolIx.set(s, ix); }
      return ix;
    };
    const varint = (v) => {
      ensure(5);
      while (v > 0x7f) { u8[p++] = (v & 0x7f) | 0x80; v >>>= 7; }
      u8[p++] = v;
    };
    const f64 = (v) => { ensure(9); u8[p++] = T_F64; dv.setFloat64(p, v, true); p += 8; };
    const num = (v) => {
      if (!isFinite(v)) { ensure(1); u8[p++] = T_NULL; return; }   /* JSON parity */
      if (Number.isInteger(v) && v > -0x40000000 && v < 0x40000000 && !Object.is(v, -0)) {
        ensure(1); u8[p++] = T_INT;
        varint(v < 0 ? (-v * 2 - 1) : v * 2);                      /* zigzag */
        return;
      }
      f64(v);
    };
    const fin = (v) => typeof v === 'number' && isFinite(v);
    const val = (v) => {
      if (v === null || v === undefined) { ensure(1); u8[p++] = T_NULL; return; }
      const t = typeof v;
      if (t === 'number') { num(v); return; }
      if (t === 'boolean') { ensure(1); u8[p++] = v ? T_TRUE : T_FALSE; return; }
      if (t === 'string') { ensure(1); u8[p++] = T_STR; varint(intern(v)); return; }
      if (Array.isArray(v)) {
        ensure(1); u8[p++] = T_ARR; varint(v.length);
        for (let i = 0; i < v.length; i++) val(v[i]);
        return;
      }
      if (t === 'object') {
        const keys = Object.keys(v);
        /* the dominant point shapes, only when key order matches exactly */
        if (keys.length >= 2 && keys[0] === 'x' && keys[1] === 'y' &&
            fin(v.x) && fin(v.y)) {
          if (keys.length === 2) {
            ensure(17); u8[p++] = T_PT2;
            dv.setFloat64(p, v.x, true); dv.setFloat64(p + 8, v.y, true); p += 16;
            return;
          }
          if (keys.length === 3 && keys[2] === 'z' && fin(v.z)) {
            ensure(25); u8[p++] = T_PT3;
            dv.setFloat64(p, v.x, true); dv.setFloat64(p + 8, v.y, true);
            dv.setFloat64(p + 16, v.z, true); p += 24;
            return;
          }
          if (keys.length === 3 && keys[2] === 'b' && fin(v.b)) {
            ensure(25); u8[p++] = T_PT2B;
            dv.setFloat64(p, v.x, true); dv.setFloat64(p + 8, v.y, true);
            dv.setFloat64(p + 16, v.b, true); p += 24;
            return;
          }
        }
        /* undefined fields are skipped, as JSON.stringify skips them */
        let nk = 0;
        for (let i = 0; i < keys.length; i++) if (v[keys[i]] !== undefined) nk++;
        ensure(1); u8[p++] = T_OBJ; varint(nk);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          const f = v[k];
          if (f === undefined) continue;
          varint(intern(k));
          val(f);
        }
        return;
      }
      ensure(1); u8[p++] = T_NULL;                                 /* JSON parity */
    };

    /* body first (the pool fills as it goes), then assemble */
    const seqStart = p;                    /* == 0; body follows the seqs */
    ensure(4 + 4 * n);
    p += 4 + 4 * n;                        /* count + seq slots, patched below */
    for (let i = 0; i < n; i++) val(items[i]);
    dv.setUint32(seqStart, n, true);
    for (let i = 0; i < n; i++) dv.setUint32(seqStart + 4 + 4 * i, (seqs ? seqs[i] : i) >>> 0, true);

    const poolBytes = new TextEncoder().encode(JSON.stringify(pool));
    const out = new Uint8Array(4 + poolBytes.length + p);
    const odv = new DataView(out.buffer);
    odv.setUint32(0, poolBytes.length, true);
    out.set(poolBytes, 4);
    out.set(u8.subarray(0, p), 4 + poolBytes.length);
    return out;
  };

  /* ------------------------------ decode ------------------------------ */
  /* bytes (Uint8Array, any byteOffset) -> {seqs: Uint32Array, items: []} */
  const decodeItems = (bytes) => {
    const u8 = bytes instanceof Uint8Array
      ? bytes : new Uint8Array(bytes.buffer || bytes);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const end = u8.length;
    let p = 0;
    const bad = () => { throw new Error('NBJ: corrupt segment'); };
    if (end < 8) bad();
    const poolLen = dv.getUint32(0, true);
    if (4 + poolLen + 4 > end) bad();
    const pool = JSON.parse(new TextDecoder('utf-8')
      .decode(u8.subarray(4, 4 + poolLen)));
    if (!Array.isArray(pool)) bad();
    const nPool = pool.length;
    p = 4 + poolLen;
    const n = dv.getUint32(p, true);
    p += 4;
    if (p + 4 * n > end) bad();
    const seqs = new Uint32Array(n);
    for (let i = 0; i < n; i++) { seqs[i] = dv.getUint32(p, true); p += 4; }

    const varint = () => {
      let v = 0, s = 0, i = 0;
      for (;;) {
        if (p >= end || i++ === 5) bad();
        const b = u8[p++];
        v |= (b & 0x7f) << s;
        if (!(b & 0x80)) return v >>> 0;
        s += 7;
      }
    };
    const val = () => {
      if (p >= end) bad();
      const t = u8[p++];
      switch (t) {
        case T_F64: { const v = dv.getFloat64(p, true); p += 8; return v; }
        case T_PT2: {
          const x = dv.getFloat64(p, true), y = dv.getFloat64(p + 8, true);
          p += 16; return { x, y };
        }
        case T_PT2B: {
          const x = dv.getFloat64(p, true), y = dv.getFloat64(p + 8, true),
            b = dv.getFloat64(p + 16, true);
          p += 24; return { x, y, b };
        }
        case T_PT3: {
          const x = dv.getFloat64(p, true), y = dv.getFloat64(p + 8, true),
            z = dv.getFloat64(p + 16, true);
          p += 24; return { x, y, z };
        }
        case T_INT: { const v = varint(); return (v & 1) ? -((v + 1) / 2) : v / 2; }
        case T_STR: { const i = varint(); if (i >= nPool) bad(); return pool[i]; }
        case T_ARR: {
          const m = varint();
          const a = new Array(m);
          for (let i = 0; i < m; i++) a[i] = val();
          return a;
        }
        case T_OBJ: {
          const m = varint();
          const o = {};
          for (let i = 0; i < m; i++) {
            const ki = varint();
            if (ki >= nPool) bad();
            o[pool[ki]] = val();
          }
          return o;
        }
        case T_NULL: return null;
        case T_TRUE: return true;
        case T_FALSE: return false;
        default: bad();
      }
    };
    const items = new Array(n);
    for (let i = 0; i < n; i++) items[i] = val();
    return { seqs, items };
  };

  const api = { encodeItems, decodeItems };
  if (HAS_WINDOW) window.NasjNBJ = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
