/* Nasjicad — nasj-track.js
 * One usage tracker for both surfaces: the desktop app (this renderer
 * behind preload.js) and the web build at nasji.com/cad (the same renderer
 * in a tab or as a PWA). It loads right after version.js, before any other
 * renderer script, so it hears every error and every command from the
 * first one on. It never throws, never blocks, and says nothing on the
 * console.
 *
 * WHAT LEAVES. Batches, as JSON, to ${SITE}/api/track — the contract the
 * site reads, so no field here is renamed:
 *   { did, sid, source:'web'|'desktop', surface:'cad', version, platform?,
 *     screen:{w,h,dpr}, lang, touch, pwa, entry?, heartbeat:true,
 *     activeSec, events:[{kind,name,props,at}], tools:{COMMAND:count} }
 *   did      the device. On the desktop the UUID nasj-desktop.js keeps in
 *            userData/desktop.json (asked through window.nasjDesktop.getId,
 *            and stamped again by the main process on the way out). On the
 *            web localStorage nasji.did, mirrored into the nasji_did cookie
 *            (path=/, 400 days, SameSite=Lax) so the site's pages see it too.
 *   sid      the session: a fresh UUID per launch / page load, renewed after
 *            thirty minutes without activity.
 *   platform desktop only: windows | macarm | macx64 | linux (from preload).
 *   entry    {path, referrer, utm:{source,medium,campaign,content,term}} in
 *            the first batch of a session only.
 *   activeSec seconds of activity since the last batch (120 at most; the
 *            rest is carried to the next one). A second counts while the
 *            document is visible and something happened — pointer, key,
 *            wheel, touch — in the sixty seconds before it.
 *   at       epoch milliseconds.
 *   events   cad_open   once, first in the first batch; props {launch:
 *                       'start'|'file'|'pwa', mode:'focus'|'coarse'|'pointer'}
 *            cad_close  pagehide — sendBeacon on the web, the main process's
 *                       queue on the desktop
 *            file_open  name = the extension, lower case; props {size?,
 *                       entities?, source?} — source is 'url' | 'handoff'
 *                       when the web build opened the file from its address
 *                       (/cad?open=…) or the site's handoff (/cad?handoff=…);
 *                       absent for a dialog, a drop or the OS
 *                       file_save  name = the extension
 *            file_new   a new drawing (a template's gets name = extension)
 *            agent_turn the agent's turn ended; props {ok, rounds, ms}
 *            draw_cad   a draw_cad tool result came back; name = the tool;
 *                       props {ok, ms}
 *            error      window error + unhandledrejection; name = the
 *                       message (200), props.stack (500); twenty a session
 *            palette_open, agent_open, byok_set (name = provider),
 *            pwa_install (appinstalled), update_prompt_shown,
 *            update_accepted (name = the version offered)
 *   tools    counts, not events: every nasj:command name (LINE, CIRCLE…)
 *            and every nasj:tool start as tool:<name> — the idle select
 *            tool excepted — merged until the next batch.
 *
 * WHEN. Every 30 s if there are events or counts; a bare heartbeat once two
 * minutes of activity have accrued, or every five minutes while visible and
 * active; at once on cad_open; on hide and unload (sendBeacon). Never more
 * than 200 events a batch; the queue holds 500 (oldest dropped); counts are
 * merged, never dropped.
 *
 * HOW. The web posts same-origin /api/track (keepalive, credentials include:
 * the session cookie is what links a signed-in user). Offline, or when the
 * post fails, the batch waits in localStorage nasji.track.queue (50 at most)
 * and drains on `online`. The desktop hands each batch to
 * window.nasjDesktop.track → nasj-desktop.js, which keeps a file queue,
 * adds the signed-in bearer and posts with the same deadline and retry.
 *
 * OFF. Nasj.track.enabled is false when window.NASJ_QA is set, under
 * --screenshot / --eval-file (preload's nasjDesktop.qa) and on a ?qa=1 page:
 * nothing is recorded and nothing leaves. A harness stubs the transport,
 * then sets Nasj.track.enabled = true.
 *
 * Nasj.track = { did, sid, enabled, flush(opts), pending(), event(kind,
 *   name, props), count(name), hint({launch}), source() } plus the QA seams
 *   _clock(fn), _web(on), _bridge(obj), _reset().
 */
(() => {
  'use strict';
  const W = window;
  const D = document;
  const Nasj = W.Nasj = W.Nasj || {};

  const PATH = '/api/track';
  const FLUSH_MS = 30 * 1000;
  const HEART_MS = 5 * 60 * 1000;
  const IDLE_MS = 60 * 1000;
  const SESSION_MS = 30 * 60 * 1000;
  const OPEN_DELAY_MS = 800;         /* the OS's files and the touch classes land first */
  const BATCH_MAX = 200;
  const QUEUE_MAX = 500;
  const STORE_MAX = 50;
  const ERR_MAX = 20;
  const ACTIVE_MAX = 120;
  const KEEPALIVE_MAX = 60000;       /* keepalive bodies are capped by the browser */
  const STORE_KEY = 'nasji.track.queue';
  const DID_KEY = 'nasji.did';
  const DID_COOKIE = 'nasji_did';

  let T = () => Date.now();          /* the clock, replaceable by a harness */

  /* ---- helpers ------------------------------------------------------- */
  const uuid = () => {
    try { if (W.crypto && typeof W.crypto.randomUUID === 'function') return W.crypto.randomUUID(); } catch (_) { /* below */ }
    const b = new Uint8Array(16);
    try { W.crypto.getRandomValues(b); } catch (_) { for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  };
  const isUuid = (s) => typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* gone anyway */ } },
  };
  const cls = (c) => !!(D.documentElement && D.documentElement.classList.contains(c));
  const standalone = () => {
    try {
      return !!((W.matchMedia && W.matchMedia('(display-mode: standalone)').matches) ||
        navigator.standalone === true);
    } catch (_) { return false; }
  };
  const visible = () => D.visibilityState !== 'hidden';
  /* props: a flat object, twenty keys at most, strings cut to `max` */
  const clean = (raw, max) => {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    let n = 0;
    for (const k of Object.keys(raw)) {
      if (n >= 20) break;
      const v = raw[k];
      if (v === undefined || v === null || !/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
      if (typeof v === 'number') { if (Number.isFinite(v)) { out[k] = v; n++; } }
      else if (typeof v === 'boolean') { out[k] = v; n++; }
      else if (typeof v === 'string') { out[k] = v.slice(0, max); n++; }
    }
    return out;
  };

  /* ---- the host: the desktop bridge, or a tab ------------------------- */
  let forceWeb = false;              /* a harness drives the web path in Electron */
  let bridgeOverride = null;         /* a harness's stand-in: contextBridge objects are read-only */
  const bridge = () => {
    if (forceWeb) return null;
    const b = bridgeOverride || W.nasjDesktop;
    return b && typeof b === 'object' && typeof b.track === 'function' ? b : null;
  };
  const source = () => (bridge() ? 'desktop' : 'web');

  /* ---- on or off ----------------------------------------------------- */
  const qaRun = !!(W.nasjDesktop && W.nasjDesktop.qa) || /[?&]qa=1(&|$)/.test(location.search);
  let override = null;               /* Nasj.track.enabled = true|false */
  const enabled = () => (override !== null ? override : !(W.NASJ_QA || qaRun));

  /* ---- identity ------------------------------------------------------ */
  let did = null;
  let didReady = null;
  const cookieDid = () => {
    const m = /(?:^|;\s*)nasji_did=([0-9a-f-]{36})/i.exec(D.cookie || '');
    return m ? m[1] : null;
  };
  const mirrorCookie = (id) => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    try {
      D.cookie = DID_COOKIE + '=' + id + '; path=/; max-age=34560000; SameSite=Lax' +
        (location.protocol === 'https:' ? '; Secure' : '');
    } catch (_) { /* a cookie the page may not set */ }
  };
  const webDid = () => {
    let id = ls.get(DID_KEY);
    if (!isUuid(id)) id = cookieDid();
    if (!isUuid(id)) id = uuid();
    ls.set(DID_KEY, id);
    mirrorCookie(id);
    return id;
  };
  const initDid = () => {
    const B = bridge();
    if (!B || typeof B.getId !== 'function') {
      did = webDid();
      didReady = Promise.resolve(did);
      return;
    }
    didReady = new Promise((resolve) => {
      let done = false;
      const settle = (id) => {
        if (done) return;
        done = true;
        did = isUuid(id) ? id : webDid();   /* main stamps the real one anyway */
        resolve(did);
      };
      try {
        Promise.resolve(B.getId()).then((r) => settle(r && r.did), () => settle(null));
      } catch (_) { settle(null); }
      setTimeout(() => settle(null), 2000);
    });
  };

  let sid = uuid();
  let entrySent = false;
  let errCount = 0;
  const renew = () => { sid = uuid(); entrySent = false; errCount = 0; };

  /* ---- the envelope -------------------------------------------------- */
  const env = () => {
    const B = bridge();
    const s = W.screen || {};
    const o = {
      did, sid,
      source: source(),
      surface: 'cad',
      version: String(W.NASJ_VERSION || ''),
    };
    if (B) o.platform = String(B.platform || '');
    o.screen = { w: Number(s.width) || 0, h: Number(s.height) || 0, dpr: Number(W.devicePixelRatio) || 1 };
    o.lang = String(navigator.language || '');
    o.touch = cls('coarse');
    o.pwa = standalone();
    return o;
  };
  const entry = () => {
    const utm = {};
    try {
      const q = new URLSearchParams(location.search);
      for (const k of ['source', 'medium', 'campaign', 'content', 'term']) {
        const v = q.get('utm_' + k);
        if (v) utm[k] = String(v).slice(0, 200);
      }
    } catch (_) { /* no query */ }
    return {
      path: String(location.pathname || ''),
      referrer: String(D.referrer || '').slice(0, 500),
      utm,
    };
  };

  /* ---- the queue ----------------------------------------------------- */
  const events = [];
  let tools = {};
  /* every recorded event is echoed as nasj:track for anything else that
     listens (app.js feeds the marketing tags from it); errors are not */
  const echo = (kind, name, props) => {
    try { W.dispatchEvent(new CustomEvent('nasj:track', { detail: { kind, name, props } })); } catch (_) { /* never */ }
  };
  const record = (kind, name, props) => {
    try {
      if (!enabled()) return false;
      const k = String(kind || '').slice(0, 40);
      if (!k) return false;
      const ev = { kind: k, name: name == null ? '' : String(name).slice(0, 200), props: clean(props, 500), at: T() };
      events.push(ev);
      if (events.length > QUEUE_MAX) events.splice(0, events.length - QUEUE_MAX);
      if (k !== 'error') echo(k, ev.name, ev.props);
      return true;
    } catch (_) { return false; }
  };
  const count = (name) => {
    try {
      if (!enabled()) return;
      const n = String(name || '').slice(0, 60);
      if (n) tools[n] = (tools[n] || 0) + 1;
    } catch (_) { /* never */ }
  };

  /* ---- activity ------------------------------------------------------ *
   * Each mark opens a sixty-second window; the seconds inside the windows
   * are credited as they pass (at the next mark, a flush, or a hide), never
   * twice, and only while the document is visible.                        */
  let lastMark = null;
  let countedTo = 0;
  let activeMs = 0;
  const credit = (now) => {
    if (lastMark == null) return;
    const from = Math.max(countedTo, lastMark);
    const to = Math.min(now, lastMark + IDLE_MS);
    if (to > from) { activeMs += to - from; countedTo = to; }
  };
  const mark = () => {
    try {
      if (!visible()) return;
      const now = T();
      if (lastMark != null && now - lastMark < 1000) return;   /* a pointer stream */
      if (lastMark != null && now - lastMark > SESSION_MS) renew();
      credit(now);
      lastMark = now;
    } catch (_) { /* never */ }
  };

  /* ---- open, flush, close -------------------------------------------- */
  let opened = false;
  let closed = false;
  let launchHint = null;
  let lastFlush = 0;

  const build = (now) => {
    credit(now);
    const secs = Math.min(ACTIVE_MAX, Math.floor(activeMs / 1000));
    activeMs -= secs * 1000;
    const b = env();
    if (!entrySent) { b.entry = entry(); entrySent = true; }
    b.heartbeat = true;
    b.activeSec = secs;
    b.events = events.splice(0, BATCH_MAX);
    b.tools = tools;
    tools = {};
    return b;
  };

  /* -- transport: the desktop's bridge, or the tab's own fetch -- */
  const post = (body) => fetch(PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: body.length < KEEPALIVE_MAX,
    credentials: 'include',
  });
  const load = () => {
    try { const j = JSON.parse(ls.get(STORE_KEY) || '[]'); return Array.isArray(j) ? j : []; } catch (_) { return []; }
  };
  const save = (list) => { if (list.length) ls.set(STORE_KEY, JSON.stringify(list.slice(-STORE_MAX))); else ls.del(STORE_KEY); };
  const store = (batch) => { const l = load(); l.push(batch); save(l); };
  let draining = false;
  const drain = async () => {
    if (draining || bridge() || !enabled()) return;
    draining = true;
    try {
      for (;;) {
        let list = load();
        if (!list.length || navigator.onLine === false) break;
        let ok = false;
        try { ok = !!(await post(JSON.stringify(list[0]))); } catch (_) { ok = false; }
        if (!ok) break;
        list = load();
        list.shift();
        save(list);
      }
    } catch (_) { /* never */ } finally { draining = false; }
  };
  const webSend = async (batch, beacon) => {
    const body = JSON.stringify(batch);
    if (beacon) {
      let ok = false;
      try { ok = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(PATH, body); } catch (_) { ok = false; }
      if (!ok) store(batch);
      return !!ok;
    }
    if (navigator.onLine === false) { store(batch); return false; }
    if (load().length) await drain();
    try { await post(body); return true; }      /* any answer settles it */
    catch (_) { store(batch); return false; }
  };
  const send = (batch, beacon) => {
    const B = bridge();
    if (B) {
      try { B.track(batch); return Promise.resolve(true); } catch (_) { return Promise.resolve(false); }
    }
    return webSend(batch, beacon).catch(() => false);
  };

  const flush = (reason, opts) => {
    try {
      const o = opts || {};
      if (!enabled() || !opened) return Promise.resolve(false);
      credit(T());
      const has = events.length > 0 || Object.keys(tools).length > 0 || activeMs >= 1000;
      if (!has && !o.force) return Promise.resolve(false);
      const beacon = !!o.beacon;
      const go = () => {
        const batch = build(T());
        lastFlush = T();
        const p = send(batch, beacon);
        if (events.length) setTimeout(() => { flush(reason, { beacon }); }, 0);
        return p;
      };
      if (beacon || did || !didReady) return go();
      return didReady.then(go, go);
    } catch (_) { return Promise.resolve(false); }
  };

  const open = (quiet) => {
    if (opened || !enabled()) return false;
    opened = true;
    lastFlush = T();
    const launch = launchHint || (standalone() ? 'pwa' : 'start');
    const mode = cls('focus') ? 'focus' : (cls('coarse') ? 'coarse' : 'pointer');
    events.unshift({ kind: 'cad_open', name: '', props: { launch, mode }, at: T() });
    echo('cad_open', '', { launch, mode });
    if (!quiet) flush('open');
    return true;
  };
  const close = () => {
    try {
      if (closed || !enabled()) return;
      if (!opened) open(true);
      closed = true;
      credit(T());
      lastMark = null;
      record('cad_close', '', {});
      flush('close', { beacon: true });
    } catch (_) { /* never */ }
  };

  const tick = () => {
    try {
      if (!enabled() || !opened || closed) return;
      const now = T();
      if (events.length || Object.keys(tools).length) { flush('timer'); return; }
      credit(now);
      if (activeMs >= ACTIVE_MAX * 1000) { flush('active'); return; }
      if (visible() && activeMs >= 1000 && now - lastFlush >= HEART_MS) flush('heartbeat');
    } catch (_) { /* never */ }
  };

  /* ---- errors -------------------------------------------------------- */
  const onErr = (e) => {
    try {
      if (errCount >= ERR_MAX || !enabled()) return;
      const err = e && e.error;
      const msg = (err && err.message) || (e && e.message) || 'error';
      const props = { stack: err && err.stack ? String(err.stack).slice(0, 500) : '' };
      if (e && e.filename) props.src = String(e.filename).replace(/^.*[\\/]/, '').slice(0, 80);
      if (e && e.lineno) props.line = e.lineno;
      if (record('error', String(msg).slice(0, 200), props)) errCount++;
    } catch (_) { /* never */ }
  };
  const onRej = (e) => {
    try {
      if (errCount >= ERR_MAX || !enabled()) return;
      const r = e && e.reason;
      const msg = (r && r.message) || (typeof r === 'string' ? r : 'unhandled rejection');
      const props = { stack: r && r.stack ? String(r.stack).slice(0, 500) : '', rejection: true };
      if (record('error', String(msg).slice(0, 200), props)) errCount++;
    } catch (_) { /* never */ }
  };

  /* ---- wiring -------------------------------------------------------- */
  initDid();
  W.addEventListener('error', onErr);
  W.addEventListener('unhandledrejection', onRej);
  for (const t of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
    W.addEventListener(t, mark, { capture: true, passive: true });
  }
  W.addEventListener('nasj:command', (e) => count(e && e.detail && e.detail.name));
  W.addEventListener('nasj:tool', (e) => {
    const n = e && e.detail && e.detail.name;
    if (n && n !== 'select') count('tool:' + n);
  });
  W.addEventListener('nasj:agent', (e) => { if (e && e.detail && e.detail.open) record('agent_open', '', {}); });
  W.addEventListener('nasj:palette', (e) => { if (e && e.detail && e.detail.open) record('palette_open', '', {}); });
  W.addEventListener('appinstalled', () => record('pwa_install', '', {}));
  D.addEventListener('visibilitychange', () => {
    try {
      if (visible()) return;
      credit(T());
      lastMark = null;
      if (opened && !closed) flush('hide', { beacon: true });
    } catch (_) { /* never */ }
  });
  W.addEventListener('pagehide', close);
  W.addEventListener('beforeunload', () => { if (opened && !closed) flush('unload', { beacon: true }); });
  W.addEventListener('pageshow', (e) => { if (e && e.persisted) closed = false; });
  W.addEventListener('online', () => {
    const B = bridge();
    if (B && typeof B.flush === 'function') { try { B.flush(); } catch (_) { /* never */ } }
    else drain();
  });
  const schedule = () => setTimeout(() => open(false), OPEN_DELAY_MS);
  if (D.readyState === 'complete') schedule();
  else W.addEventListener('load', schedule);
  setInterval(tick, FLUSH_MS);

  Nasj.track = {
    get did() { return did; },
    get sid() { return sid; },
    get enabled() { return enabled(); },
    set enabled(v) {
      override = (v === null || v === undefined) ? null : !!v;
      if (override && !opened && D.readyState !== 'loading') open(false);
    },
    flush: (opts) => flush('manual', opts),
    pending: () => ({
      events: events.length,
      kinds: events.map((e) => e.kind),
      tools: Object.assign({}, tools),
      activeSec: Math.floor(activeMs / 1000),
      stored: bridge() ? 0 : load().length,
      opened, closed,
    }),
    event: record,
    count,
    /* app.js says how the run began once it knows: {launch:'file'} */
    hint: (o) => { if (o && typeof o.launch === 'string') launchHint = o.launch; },
    source,
    /* QA seams */
    _clock: (fn) => { T = typeof fn === 'function' ? fn : () => Date.now(); },
    _web: (on) => { forceWeb = !!on; },
    _bridge: (b) => { bridgeOverride = b && typeof b === 'object' ? b : null; },
    _reset: () => {
      events.length = 0; tools = {}; activeMs = 0; lastMark = null; countedTo = 0;
      opened = false; closed = false; launchHint = null; renew();
    },
  };
})();
