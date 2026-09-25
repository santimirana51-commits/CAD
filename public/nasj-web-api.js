/* pixelbay CAD — nasj-web-api.js
 *
 * THE WEB HALF OF window.nasjAPI. The desktop half is preload.js, beside
 * this file — the two are the same contract with two hosts behind it, and
 * they live in one repo so neither can drift without the diff saying so.
 *
 * pixelbay CAD's renderer (src/js/*.js) never touches Electron. It reaches its
 * host through exactly one object, `window.nasjAPI`, which preload.js builds
 * out of IPC in the desktop app. This file builds the same object out of
 * fetch, the DOM and the File System Access API, so the identical renderer
 * runs in a browser tab.
 *
 * KEEP THIS FILE IN STEP WITH preload.js. That file is the contract; a
 * method missing here is a feature that silently does nothing on the web —
 * unless the renderer feature-detects it, in which case ABSENT is the
 * honest answer and the renderer says so itself (PDF import, doc
 * streams). Everything else is present, even when all it can honestly do
 * is say it is unavailable.
 *
 * What genuinely differs, and cannot be papered over:
 *   - There is no OS window, so minimize/close are inert and Maximize is
 *     mapped to real fullscreen, which is the honest browser equivalent.
 *   - There are no file paths. Every save returns {path: null}, which the
 *     renderer already handles: the drawing keeps its name and stays
 *     "unsaved to disk", exactly as a browser can promise.
 *   - Printing goes through the browser's own dialog; the OS printer list is
 *     not reachable from a tab.
 *   - A .dwg or .dxf is decoded IN THE TAB, in a Web Worker running this
 *     repo's own reader (dwg-worker.js: nasjidwg + dwg-doc.js — the same
 *     dwgToDoc the desktop's main process runs), and reaches the renderer
 *     as the same paint-ordered slices the desktop streams over IPC. The
 *     file never leaves the machine and the site's server never sees it;
 *     /api/open remains only as the fallback for a tab whose worker could
 *     not load.
 *
 * Loaded by the website's sync script, which copies the renderer out of
 * this repo and injects this file ahead of the renderer's own scripts. It
 * installs itself ONLY when nothing else has — so if this ever ends up
 * inside Electron, the real bridge still wins.
 *
 * OPENING A DRAWING THE PAGE DID NOT PICK ITSELF — window.nasjWebOpen
 *
 * Two doors, both read off the address at boot once the renderer is up
 * (the same readiness ?new=1 in cad-web/nasj-pwa.js waits for), and both
 * wiped from the address bar afterwards with history.replaceState, so a
 * reload does not open the file a second time:
 *
 *   /cad?open=<path>[&name=<file name>]
 *       <path> is a SAME-ORIGIN path: it starts with one "/" — never "//",
 *       never a scheme. Anything else is refused with a toast and no
 *       request is made. The file is fetched with the session cookie
 *       (credentials: same-origin), named from `name` or the address's
 *       last segment, and opened exactly as a picked file: through
 *       readPicked below and the renderer's own open — its own tab, framed
 *       to its extents, on the Recent list. The opening veil narrates the
 *       download (a percentage when the response says Content-Length) and
 *       then the read.
 *         e.g. /cad?open=/cad-blocks/files/dogs.dwg&name=Dogs.dwg
 *
 *   /cad?handoff=<id>
 *       A file the SITE stored for this page in IndexedDB — the phone's
 *       route: a navigation carries an address and nothing else, and there
 *       is no file input to press twice. The record is read, deleted, and
 *       opened like the above. The site writes it with nasj-handoff.js,
 *       beside this file — KEEP THE TWO IN STEP:
 *         database  'nasji-handoff'  (version 1)
 *         store     'files'          (out-of-line keys: the key is the id, a string)
 *         value     { name:  string       the file's name, extension included
 *                     type:  string       its MIME type, '' when unknown
 *                     size:  number       byte length
 *                     bytes: ArrayBuffer  the file itself
 *                     at:    number }     Date.now() when it was written
 *       A record older than an hour is swept whenever one is read.
 *
 * On failure — a path off this origin, a 404, a dropped connection, a
 * record that is not there — one toast and the app stands on its Start
 * page as if nothing had been asked. Each success reaches Nasj.track as
 * file_open with props.source 'url' | 'handoff': the result handed to the
 * renderer carries `source`, and app.js's finishOpen passes it on.
 *
 *   window.nasjWebOpen = { fromQuery(search), openUrl(path, name),
 *                          openHandoff(id), ready() }
 * fromQuery is what boot calls with location.search; a harness calls it
 * with a query of its own.
 */
(() => {
  'use strict';

  /* the desktop bridge is present: nothing here applies. One exception —
     an Electron harness that sets window.NASJ_WEB_QA before loading this
     file gets the web-only pieces (window.nasjWebOpen, the reader, the
     veil) against the desktop renderer, with the bridge left as it is. */
  const HOSTED = !!window.nasjAPI;
  if (HOSTED && !window.NASJ_WEB_QA) return;

  /* ------------------------------------------------------------------ *
   * The titlebar's right end, which on the web means something else.
   *
   * Minimize, Maximize and Close belong to the OS window, and a browser
   * has already drawn its own set two centimetres higher — offering a
   * second, weaker copy invites a click that does nothing (minimize) or
   * something the user did not ask for (close, which a tab may refuse
   * anyway). Help goes with them; F1 still opens it.
   *
   * What takes their place is the one move only the web version can make:
   * back to the site the app was opened from. Reading left to right it is
   * the action, then where it lands — â† Back to Website [N] — so the mark
   * is doing a job rather than sitting there as decoration.
   *
   * The old buttons are hidden in CSS rather than removed, so the
   * renderer's own listeners still find them and nothing upstream has to
   * know this file exists. Leaving with unsaved work is already guarded:
   * the beforeunload handler further down raises the browser's own
   * "Leave site?" prompt while the drawing is modified.
   * ------------------------------------------------------------------ */
  if (!HOSTED) (() => {
    const css = document.createElement('style');
    css.textContent =
      '#help-btn, #win-controls { display: none !important; }' +
      '#nasj-web-home{flex:none;display:flex;align-items:center;gap:8px;height:28px;' +
        'margin:0 10px 0 6px;padding:0 11px 0 9px;border:1px solid transparent;' +
        'border-radius:14px;background:transparent;cursor:pointer;color:#b4b4b4;' +
        'font:500 12px/1 "Segoe UI",system-ui,-apple-system,sans-serif;white-space:nowrap;' +
        'text-decoration:none;transition:background-color .16s ease,border-color .16s ease,' +
        'color .16s ease;-webkit-app-region:no-drag}' +
      '#nasj-web-home:hover{background:rgba(143,214,255,.10);border-color:rgba(143,214,255,.28);' +
        'color:#dbeeff}' +
      '#nasj-web-home:active{background:rgba(143,214,255,.16)}' +
      '#nasj-web-home:focus-visible{outline:2px solid #8fd6ff;outline-offset:2px}' +
      '#nasj-web-home .arw{flex:none;width:14px;height:14px;transition:transform .16s ease}' +
      '#nasj-web-home:hover .arw{transform:translateX(-2px)}' +
      '#nasj-web-home .mark{flex:none;width:17px;height:17px;border-radius:4px;display:block}' +
      /* a narrow window keeps the mark and drops the words */
      '@media (max-width:900px){#nasj-web-home .lbl{display:none}' +
        '#nasj-web-home{padding:0 8px;gap:6px}}';
    (document.head || document.documentElement).appendChild(css);

    const build = () => {
      const bar = document.getElementById('titlebar');
      if (!bar || document.getElementById('nasj-web-home')) return;
      const a = document.createElement('a');
      a.id = 'nasj-web-home';
      a.href = '/';
      a.title = 'Leave the drawing and go back to the NASJI website';
      a.innerHTML =
        '<svg class="arw" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
          '<path d="M9.8 3.5 5.3 8l4.5 4.5" stroke="currentColor" stroke-width="1.6" ' +
            'stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '<span class="lbl">Back to Website</span>' +
        '<img class="mark" src="logo.png" alt="NASJI">';
      /* last in the row: exactly where the window buttons used to sit */
      bar.appendChild(a);
    };

    if (document.getElementById('titlebar')) build();
    else document.addEventListener('DOMContentLoaded', build, { once: true });
  })();

  /* ------------------------------------------------------------------ *
   * helpers
   * ------------------------------------------------------------------ */
  const noop = () => {};
  const unsub = () => noop;

  const extOf = (name) => {
    const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  };

  /* a plain anchor download — the fallback everywhere showSaveFilePicker
     is missing (Firefox, Safari, every mobile browser) */
  const download = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    /* revoking immediately cancels the download in some browsers */
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  const dataUrlToBlob = async (dataUrl) => {
    const u = String(dataUrl);
    if (!u.startsWith('data:image/') && !u.startsWith('data:application/')) throw new Error('invalid dataUrl');
    return (await fetch(u)).blob();
  };

  /* DXF text -> DWG bytes, through the converter the site already runs.
     /api/convert takes a .dxf upload and returns a 2018-format DWG. */
  const dxfToDwgBlob = async (dxfText) => {
    const form = new FormData();
    form.append('file', new Blob([dxfText], { type: 'application/dxf' }), 'drawing.dxf');
    form.append('target', 'dwg');
    const res = await fetch('/api/convert', { method: 'POST', body: form, credentials: 'same-origin' });
    if (!res.ok) {
      let message = 'DWG conversion failed (HTTP ' + res.status + ')';
      try { const j = await res.json(); if (j && j.error) message = j.error; } catch (e) { /* not json */ }
      throw new Error(message);
    }
    return res.blob();
  };

  /* ------------------------------------------------------------------ *
   * Saving
   *
   * Chromium gives a real Save dialog through showSaveFilePicker, so the
   * user picks the folder AND the format exactly as in the desktop app.
   * Everywhere else it is a download of whatever the drawing is called.
   * ------------------------------------------------------------------ */
  const bodyFor = async (ext, payload) => {
    if (ext === 'njc') {
      const njc = payload.njc != null ? payload.njc : payload.json;
      return new Blob([String(njc == null ? '' : njc)], { type: 'application/json' });
    }
    if (ext === 'dwg') {
      if (!payload.dxf) throw new Error('this drawing produced no DXF to convert');
      return dxfToDwgBlob(payload.dxf);
    }
    if (payload.dxf == null) throw new Error('DXF export is unavailable for this drawing');
    return new Blob([String(payload.dxf)], { type: 'application/dxf' });
  };

  const SAVE_TYPES = [
    { description: 'DWG Drawing', accept: { 'image/vnd.dwg': ['.dwg'] } },
    { description: 'DXF Drawing', accept: { 'application/dxf': ['.dxf'] } },
    { description: 'pixelbay CAD Drawing', accept: { 'application/json': ['.njc'] } },
  ];

  const saveDrawing = async (payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    const suggested = String(p.suggestedName || 'Drawing.dxf');

    if (typeof window.showSaveFilePicker === 'function') {
      let handle;
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: suggested,
          types: SAVE_TYPES,
        });
      } catch (err) {
        if (err && err.name === 'AbortError') return null;      /* canceled */
        handle = null;                                          /* fall through */
      }
      if (handle) {
        const name = handle.name || suggested;
        const blob = await bodyFor(extOf(name) || 'dxf', p);
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        /* no real path exists in a browser sandbox; the renderer treats a
           null path as "named, but not on a disk we can address" */
        return { path: null, name };
      }
    }

    const name = suggested;
    download(await bodyFor(extOf(name) || 'dxf', p), name);
    return { path: null, name };
  };

  /* ------------------------------------------------------------------ *
   * The upload veil — WEB ONLY, and only for the SERVER FALLBACK.
   *
   * A drawing read in the tab reports its stages through onDocProgress and
   * the renderer's own bar, exactly as the desktop does. The fallback has
   * three silent phases the renderer cannot see — the upload, the server's
   * dwgToDoc, the reply coming back down — and a user who clicks Open and
   * sees NOTHING for four seconds concludes the click was lost. This veil
   * owns exactly that gap: it appears only if the read is still running
   * after 150 ms, reports each phase honestly with real byte counts off
   * XHR progress events, and stays up through the renderer's own
   * JSON.parse until the drawing actually lands in Nasj.docs.
   *
   * Styled to the app's own bed: #1b222a card, #333d49 hairline, #8fd6ff
   * accent — the same palette the renderer draws with.
   * ------------------------------------------------------------------ */
  const upFx = (() => {
    const RING = 2 * Math.PI * 36;               /* r=36 circumference */
    let root = null, els = null, showTimer = 0, visible = false, watch = 0;

    const fmtMB = (b) => {
      const mb = b / 1048576;
      return (mb >= 100 ? Math.round(mb) : mb < 10 ? mb.toFixed(2) : mb.toFixed(1)) + ' MB';
    };

    const ensure = () => {
      if (root) return;
      const style = document.createElement('style');
      style.textContent =
        '.nasj-webup{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;' +
          'justify-content:center;background:rgba(11,15,20,.62);backdrop-filter:blur(7px);' +
          '-webkit-backdrop-filter:blur(7px);opacity:0;transition:opacity .22s ease;pointer-events:all}' +
        '.nasj-webup.on{opacity:1}' +
        '.nasj-webup-card{width:min(400px,calc(100vw - 48px));background:#1b222a;' +
          'border:1px solid #333d49;border-radius:16px;padding:30px 32px 26px;text-align:center;' +
          'box-shadow:0 0 0 1px rgba(143,214,255,.06),0 28px 70px -28px rgba(0,0,0,.95);' +
          'font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:#dbeeff;' +
          'transform:translateY(6px);transition:transform .22s ease}' +
        '.nasj-webup.on .nasj-webup-card{transform:none}' +
        '.nasj-webup-ringwrap{position:relative;width:88px;height:88px;margin:0 auto 18px}' +
        '.nasj-webup-svg{width:88px;height:88px;transform:rotate(-90deg)}' +
        '.nasj-webup-svg .track{fill:none;stroke:#2a323c;stroke-width:5}' +
        '.nasj-webup-svg .arc{fill:none;stroke:#8fd6ff;stroke-width:5;stroke-linecap:round;' +
          'stroke-dasharray:' + RING.toFixed(2) + ';stroke-dashoffset:' + RING.toFixed(2) + ';' +
          'transition:stroke-dashoffset .15s linear;filter:drop-shadow(0 0 6px rgba(143,214,255,.55))}' +
        '.nasj-webup.spin .nasj-webup-svg{animation:nasj-webup-rot 1s linear infinite}' +
        '.nasj-webup.spin .nasj-webup-svg .arc{stroke-dasharray:' +
          (RING * 0.28).toFixed(2) + ' ' + (RING * 0.72).toFixed(2) + ';stroke-dashoffset:0;transition:none}' +
        '@keyframes nasj-webup-rot{to{transform:rotate(270deg)}}' +
        '.nasj-webup-pct{position:absolute;inset:0;display:flex;align-items:center;' +
          'justify-content:center;font:600 15px/1 Consolas,ui-monospace,monospace;color:#8fd6ff}' +
        '.nasj-webup.spin .nasj-webup-pct{font-size:19px;letter-spacing:2px}' +
        '.nasj-webup-name{font:600 13px/1.3 Consolas,ui-monospace,monospace;' +
          'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:7px}' +
        '.nasj-webup-phase{font-size:12.5px;color:#8a99ab;margin-bottom:5px}' +
        '.nasj-webup-bytes{font:11px/1 Consolas,ui-monospace,monospace;color:#6b7a8c;' +
          'min-height:11px}';
      root = document.createElement('div');
      root.className = 'nasj-webup';
      root.innerHTML =
        '<div class="nasj-webup-card">' +
          '<div class="nasj-webup-ringwrap">' +
            '<svg class="nasj-webup-svg" viewBox="0 0 88 88">' +
              '<circle class="track" cx="44" cy="44" r="36"></circle>' +
              '<circle class="arc" cx="44" cy="44" r="36"></circle>' +
            '</svg>' +
            '<div class="nasj-webup-pct"></div>' +
          '</div>' +
          '<div class="nasj-webup-name"></div>' +
          '<div class="nasj-webup-phase"></div>' +
          '<div class="nasj-webup-bytes"></div>' +
        '</div>';
      document.head.appendChild(style);
      els = {
        arc: root.querySelector('.arc'),
        pct: root.querySelector('.nasj-webup-pct'),
        name: root.querySelector('.nasj-webup-name'),
        phase: root.querySelector('.nasj-webup-phase'),
        bytes: root.querySelector('.nasj-webup-bytes'),
      };
    };

    const spin = (on) => { root.classList.toggle('spin', on); if (on) els.pct.textContent = 'â‹¯'; };

    const api = {
      /* arm the veil; it becomes visible only if the read outlives 150 ms */
      begin(name, idx, count) {
        ensure();
        clearTimeout(showTimer);
        clearInterval(watch);
        els.name.textContent = count > 1 ? name + '  —  file ' + idx + ' of ' + count : name;
        els.phase.textContent = 'Reading the file…';
        els.bytes.textContent = '';
        spin(true);
        if (!root.isConnected) document.body.appendChild(root);
        if (!visible) {
          showTimer = setTimeout(() => {
            visible = true;
            requestAnimationFrame(() => root.classList.add('on'));
          }, 150);
        }
      },
      /* a line of narration; spinning: the ring turns again, the byte
         count goes — the read after a download that showed a percentage */
      phase(text, spinning) {
        if (!els) return;
        els.phase.textContent = text;
        if (spinning) { spin(true); els.bytes.textContent = ''; }
      },
      /* kind: 'up' the fallback's upload, 'server' its wait, 'down' its
         reply, 'fetch' a drawing named in the address coming down */
      progress(kind, loaded, total) {
        if (!els) return;
        if (kind === 'up') {
          els.phase.textContent = 'Uploading';
          if (total > 0) {
            spin(false);
            const p = Math.min(1, loaded / total);
            els.arc.style.strokeDashoffset = String(RING * (1 - p));
            els.pct.textContent = Math.round(p * 100) + '%';
            els.bytes.textContent = fmtMB(loaded) + ' of ' + fmtMB(total);
          } else {
            els.bytes.textContent = fmtMB(loaded);
          }
        } else if (kind === 'server') {
          spin(true);
          els.phase.textContent = 'Preparing the drawing…';
          els.bytes.textContent = '';
        } else { /* down | fetch */
          els.phase.textContent = kind === 'fetch' ? 'Downloading' : 'Receiving the drawing';
          if (total > 0) {
            spin(false);
            const p = Math.min(1, loaded / total);
            els.arc.style.strokeDashoffset = String(RING * (1 - p));
            els.pct.textContent = Math.round(p * 100) + '%';
            els.bytes.textContent = fmtMB(loaded) + ' of ' + fmtMB(total);
          } else {
            spin(true);
            els.bytes.textContent = fmtMB(loaded);
          }
        }
      },
      /* the bytes are here; the renderer's parse and first paint are not.
         Hold the veil until the drawing really lands in Nasj.docs (or a
         generous cap — never trap the user behind a stuck overlay). */
      opening(name) {
        if (!visible) { api.dismiss(); return; }
        ensure();
        spin(true);
        els.phase.textContent = 'Opening…';
        els.name.textContent = name;
        els.bytes.textContent = '';
        const before = (window.Nasj && Array.isArray(window.Nasj.docs))
          ? window.Nasj.docs.length : -1;
        const t0 = Date.now();
        clearInterval(watch);
        watch = setInterval(() => {
          const docs = window.Nasj && window.Nasj.docs;
          const landed = Array.isArray(docs) && (before < 0 || docs.length > before);
          if (landed || Date.now() - t0 > 90000) api.dismiss();
        }, 200);
      },
      dismiss() {
        clearTimeout(showTimer);
        clearInterval(watch);
        showTimer = 0; watch = 0;
        if (!root) return;
        visible = false;
        root.classList.remove('on');
        setTimeout(() => { if (!visible && root && root.isConnected) root.remove(); }, 240);
      },
    };
    return api;
  })();

  /* ------------------------------------------------------------------ *
   * Opening
   *
   * .njc is text and opens entirely in the tab. .dwg and .dxf go to the
   * READER WORKER — dwg-worker.js, this repo's own converter (nasjidwg +
   * dwg-doc.js, the same call the desktop's File â–¸ Open makes) bundled for
   * the browser and run off the main thread. A light drawing comes back
   * as one JSON string, the dwgdoc shape the renderer already parses; a
   * heavy one comes back as a STREAM descriptor and its slices are pushed
   * through onDocChunk in paint order, so the saved view is on screen
   * while the block library is still crossing — exactly the desktop's
   * open. The bytes never leave the machine.
   *
   * The server route (/api/open) is kept for one case only: a tab whose
   * worker script could not load at all. A drawing the worker fails to
   * READ is reported, not re-tried on the server — a file that is corrupt
   * here is corrupt there too, and a 100 MB upload is not a retry.
   * ------------------------------------------------------------------ */
  const pickFiles = (accept, multiple) => new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept || '.njc,.dxf,.dwg';
    if (multiple) input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    /* there is no cancel event; the focus returning with no file is it */
    const done = (files) => { input.remove(); resolve(files); };
    input.addEventListener('change', () => {
      done(input.files && input.files.length ? [...input.files] : null);
    });
    window.addEventListener('focus', () => setTimeout(() => {
      if (document.body.contains(input) && !(input.files && input.files.length)) done(null);
    }, 400), { once: true });
    input.click();
  });

  /* the address this file was loaded from carries the build's version
     query (?v=…, stamped by the site's sync script); the worker is fetched
     with the same one so the two can never be from different builds */
  const OWN_SRC = (document.currentScript && document.currentScript.src) || '';
  const WORKER_URL = (() => {
    const q = /\?[^#]*/.exec(OWN_SRC);
    return new URL('js/dwg-worker.js' + (q ? q[0] : ''), document.baseURI).href;
  })();

  /* ---- the reader worker's client ---------------------------------- */
  const reader = (() => {
    let w = null;
    let seq = 0;
    let unavailable = false;     /* the script itself would not load */
    let spoke = false;           /* a worker has answered at least once */
    const jobs = new Map();      /* id -> {resolve, reject} of an open */
    const streams = new Map();   /* id -> 'held' | 'streaming' */
    const chunkListeners = new Set();
    const progListeners = new Set();
    const tell = (set, m) => {
      for (const cb of set) { try { cb(m); } catch (e) { /* keep going */ } }
    };

    /* a worker that dies takes every open and every stream it was holding
       with it — each is failed by name, so no open waits on it forever */
    const failAll = (why) => {
      for (const j of jobs.values()) j.reject(new Error(why));
      jobs.clear();
      const ids = [...streams.keys()];
      streams.clear();
      for (const id of ids) tell(chunkListeners, { id, i: -1, n: 0, error: why });
    };

    /* the worker holds a whole converted drawing until its stream is read;
       once a heavy one has crossed it is let go and the next open starts
       clean — a fresh worker costs one script load out of cache, a kept
       one holds a quarter of a gigabyte of parse until the collector gets
       to it. Never while an open or an unread stream is still on it. */
    let retire = false;
    const maybeRetire = () => {
      if (!retire || !w || jobs.size || streams.size) return;
      retire = false;
      const old = w; w = null;
      old.terminate();
    };

    const ensure = () => {
      if (w) return w;
      if (typeof Worker !== 'function') unavailable = true;
      if (unavailable) throw new Error('the drawing reader is unavailable');
      w = new Worker(WORKER_URL);
      w.onmessage = (ev) => {
        const m = ev.data || {};
        spoke = true;
        if (m.op === 'progress') {
          tell(progListeners, { text: m.text, pct: m.pct });
        } else if (m.op === 'doc' || m.op === 'stream') {
          const j = jobs.get(m.id);
          if (!j) return;
          jobs.delete(m.id);
          if (m.op === 'stream') streams.set(m.id, 'held');
          j.resolve(m.op === 'doc' ? { json: m.json } : { stream: m.stream });
        } else if (m.op === 'error') {
          const j = jobs.get(m.id);
          if (!j) return;
          jobs.delete(m.id);
          j.reject(new Error(m.error || 'Could not read drawing file.'));
        } else if (m.op === 'chunk') {
          if (m.i < 0 || m.i >= m.n - 1) { streams.delete(m.id); maybeRetire(); }
          tell(chunkListeners, m);
        }
      };
      /* a script that never ran at all (404, a blocked CSP) is remembered
         so the server route takes over; a crash mid-drawing is not — the
         next open starts a fresh worker. The one is told from the other by
         whether any worker ever answered: the error of a script that did
         not load arrives after the first open has already been posted. */
      w.onerror = (ev) => {
        const why = (ev && ev.message) || 'the drawing reader failed';
        if (!spoke) unavailable = true;
        const dead = w; w = null;
        try { dead.terminate(); } catch (e) { /* already gone */ }
        failAll(why);
      };
      return w;
    };

    return {
      get unavailable() { return unavailable; },
      /* File -> {json} | {stream}; whole: one string whatever the size */
      async open(file, kind, whole) {
        const worker = ensure();
        const id = 'wr' + (++seq);
        const buf = await file.arrayBuffer();
        /* the worker died while the bytes were being read (its script did
           not load): say so, rather than post to it and wait forever */
        if (w !== worker) {
          throw new Error(unavailable ? 'the drawing reader is unavailable' : 'the drawing reader failed');
        }
        return new Promise((resolve, reject) => {
          jobs.set(id, { resolve, reject });
          worker.postMessage({ op: 'open', id, name: file.name, kind, buf, whole: !!whole }, [buf]);
        });
      },
      start(id) {
        if (!w || !streams.has(id)) {
          tell(chunkListeners, { id, i: -1, n: 0, error: 'the drawing reader was closed' });
          return Promise.resolve({ ok: false });
        }
        streams.set(id, 'streaming');
        retire = true;
        w.postMessage({ op: 'start', id });
        return Promise.resolve({ ok: true });
      },
      drop(id) {
        streams.delete(id);
        if (w) w.postMessage({ op: 'drop', id });
        maybeRetire();
      },
      onChunk(cb) {
        if (typeof cb !== 'function') return unsub();
        chunkListeners.add(cb);
        return () => chunkListeners.delete(cb);
      },
      onProgress(cb) {
        if (typeof cb !== 'function') return unsub();
        progListeners.add(cb);
        return () => progListeners.delete(cb);
      },
    };
  })();

  const docStreamStart = (id) => reader.start(id);
  const docStreamDrop = (id) => reader.drop(id);
  const onDocChunk = (cb) => reader.onChunk(cb);
  const onDocProgress = (cb) => reader.onProgress(cb);

  /* DWG bytes -> the Nasj document as JSON text, server-side: THE FALLBACK.
     XHR rather than fetch for one reason: fetch cannot see upload progress,
     and the upload is the phase the veil most needs to narrate. */
  const dwgFileToDocJson = (file) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/open');
    xhr.responseType = 'text';
    xhr.upload.onprogress = (e) => upFx.progress('up', e.loaded, e.lengthComputable ? e.total : 0);
    /* the request is fully sent; the server is now inside dwgToDoc */
    xhr.upload.onload = () => upFx.progress('server', 0, 0);
    xhr.onprogress = (e) => upFx.progress('down', e.loaded, e.lengthComputable ? e.total : 0);
    xhr.onerror = () => reject(new Error('could not reach the DWG reader'));
    xhr.ontimeout = () => reject(new Error('the DWG reader timed out'));
    xhr.onload = () => {
      if (xhr.status === 200) {
        /* the document crosses as ONE string and the renderer's dwgdoc
           path does the single JSON.parse — the shape desktop IPC carries */
        resolve(xhr.response);
        return;
      }
      let message = 'Opening this .dwg failed (HTTP ' + xhr.status + ')';
      try {
        const j = JSON.parse(xhr.response);
        if (j && j.error) message = j.error;
      } catch (e) { /* not json */ }
      reject(new Error(message));
    };
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });

  /* one picked File -> the contract's per-file result: {ok, path, name,
     kind, json|stream, size}. The document keeps its own name whatever the
     kind resolves to. whole: the callers that want one string (xref attach,
     IMPORT) — never a stream. */
  const readPicked = async (file, whole) => {
    const kind = extOf(file.name) || 'njc';
    const base = { ok: true, path: null, name: file.name, size: file.size };
    try {
      if (kind === 'dwg' || kind === 'dxf') {
        if (!reader.unavailable) {
          try {
            const got = await reader.open(file, kind, whole);
            return Object.assign(base, { kind: 'dwgdoc' }, got);
          } catch (err) {
            /* only a reader that never loaded hands the file elsewhere */
            if (!reader.unavailable) throw err;
          }
        }
        if (kind === 'dwg') {
          upFx.begin(file.name, 1, 1);
          let json;
          try { json = await dwgFileToDocJson(file); }
          catch (err) { upFx.dismiss(); throw err; }
          upFx.opening(file.name);
          return Object.assign(base, { kind: 'dwgdoc', json });
        }
        /* a DXF is text: the renderer's own importer reads it in-page */
        return Object.assign(base, { kind, json: await file.text() });
      }
      return Object.assign(base, { kind, json: await file.text() });
    } catch (err) {
      return { ok: false, path: null, name: file.name,
        error: (err && err.message) || String(err) };
    }
  };

  const openDrawing = async () => {
    const files = await pickFiles('.njc,.dxf,.dwg', false);
    if (!files) return null;
    const res = await readPicked(files[0]);
    if (!res.ok) {
      if (window.Nasj && typeof window.Nasj.toast === 'function') window.Nasj.toast(res.error);
      else alert(res.error);
      return null;
    }
    return res;
  };

  /* the multi-select dialog: one result per file, ok or not, like the
     desktop's file:open-multi. Read one after another: the worker holds a
     converted drawing until its stream is read, and two heavy ones held at
     once is twice the memory for no time saved on one thread. */
  const openDrawings = async () => {
    const files = await pickFiles('.njc,.dxf,.dwg', true);
    if (!files) return null;
    const out = [];
    for (let i = 0; i < files.length; i++) out.push(await readPicked(files[i]));
    return out;
  };

  /* Drag-and-drop. A browser File has no disk path, so filePathOf hands out
     a token the renderer treats as a path, and readDrawing redeems it
     through the reader — a dropped DWG and a dropped DXF both parse off the
     main thread this way. An NJC is left to the renderer, which reads the
     text itself. */
  let dropSeq = 0;
  const droppedFiles = new Map();
  const filePathOf = (file) => {
    if (!file || !/\.(dwg|dxf)$/i.test(String(file.name || ''))) return '';
    const token = 'web-drop:' + (++dropSeq) + ':' + file.name;
    droppedFiles.set(token, file);
    /* a token nobody redeems must not pin the File in memory forever */
    setTimeout(() => droppedFiles.delete(token), 120000);
    return token;
  };

  const readDrawing = async (payload) => {
    const p = payload && typeof payload === 'object' ? String(payload.path || '') : '';
    const file = droppedFiles.get(p);
    if (!file) {
      return { ok: false, path: p, name: p.replace(/^.*[\\/]/, ''),
        error: 'a browser tab cannot read files by path' };
    }
    droppedFiles.delete(p);
    return readPicked(file);
  };

  /* ------------------------------------------------------------------ *
   * Opening a drawing the page did not pick itself: /cad?open=<path> and
   * /cad?handoff=<id>. The addresses, the record and what happens on
   * failure are stated at the top of the file.
   * ------------------------------------------------------------------ */
  const webOpen = (() => {
    const FAIL = 'That file could not be opened';
    const OFFSITE = 'Only a drawing on this site can be opened this way';
    const HANDOFF_DB = 'nasji-handoff';
    const HANDOFF_STORE = 'files';
    const HANDOFF_TTL = 60 * 60 * 1000;
    const OUR_KEYS = ['open', 'name', 'handoff'];
    const DRAWING_EXT = /\.(dwg|dxf|njc)$/i;
    const READY_MS = 20000;

    const toast = (m) => {
      if (window.Nasj && typeof window.Nasj.toast === 'function') window.Nasj.toast(m);
    };
    const fileOps = () => (window.Nasj && window.Nasj.fileOps) || null;

    /* the renderer is up when its file flows exist and the Start page has
       been built — the same sign ?new=1 waits for in nasj-pwa.js */
    const ready = () => {
      const f = fileOps();
      return !!(f && typeof f.openResults === 'function' &&
        document.querySelector('#start-page .st-split.primary .st-split-main'));
    };
    const whenReady = (ms) => new Promise((resolve) => {
      const t0 = Date.now();
      const poll = () => {
        if (ready()) { resolve(true); return; }
        if (Date.now() - t0 > ms) { resolve(false); return; }
        setTimeout(poll, 100);
      };
      poll();
    });

    /* one failure, one toast, the veil down; the reason goes to the console */
    const fail = (why, msg) => {
      console.warn('[pixelbay] open by address: ' + why);
      upFx.dismiss();
      toast(msg || FAIL);
      return { ok: false, error: why };
    };

    /* a file name, never a path: the query's `name`, else the address's
       last segment; the address may carry the extension the name lacks */
    const cleanName = (s) => Array.from(String(s == null ? '' : s)
      .replace(/[\\/]+/g, '/').split('/').pop())
      .filter((ch) => ch.charCodeAt(0) >= 32).join('').trim().slice(0, 160);
    const nameFor = (path, name) => {
      const raw = String(path == null ? '' : path).split(/[?#]/)[0];
      let seg;
      try { seg = cleanName(decodeURIComponent(raw)); } catch (e) { seg = cleanName(raw); }
      let n = cleanName(name) || seg || 'Drawing.dwg';
      const ext = DRAWING_EXT.exec(seg);
      if (ext && !DRAWING_EXT.test(n)) n += ext[0].toLowerCase();
      return n;
    };

    /* on this origin, and said as a path: one leading slash — "//host" is
       another site, and a backslash is a slash to the URL parser */
    const onSite = (p) => {
      if (typeof p !== 'string' || !/^\/(?![\\/])/.test(p)) return false;
      try { return new URL(p, location.href).origin === location.origin; }
      catch (e) { return false; }
    };

    /* our keys leave the address bar; anything else (utm_…) stays */
    const stripQuery = () => {
      try {
        const q = new URLSearchParams(location.search);
        let hit = false;
        for (const k of OUR_KEYS) if (q.has(k)) { q.delete(k); hit = true; }
        if (!hit) return;
        const s = q.toString();
        history.replaceState(history.state, '', location.pathname + (s ? '?' + s : '') + location.hash);
      } catch (e) { /* a page that may not rewrite its address */ }
    };

    /* GET the file, the veil counting the bytes as they come */
    const download = async (path, name) => {
      const res = await fetch(path, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const total = Number(res.headers.get('Content-Length')) || 0;
      const type = res.headers.get('Content-Type') || '';
      let parts;
      if (res.body && typeof res.body.getReader === 'function') {
        const rd = res.body.getReader();
        parts = [];
        let loaded = 0;
        for (;;) {
          const r = await rd.read();
          if (r.done) break;
          parts.push(r.value);
          loaded += r.value.byteLength;
          upFx.progress('fetch', loaded, total);
        }
      } else {
        parts = [await res.blob()];
      }
      return new File(parts, name, { type });
    };

    /* the site's record: read and deleted in one transaction, and the
       stale ones beside it deleted with it */
    const handoffDb = () => new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB is unavailable')); return; }
      let req;
      try { req = indexedDB.open(HANDOFF_DB, 1); }
      catch (err) { reject(err); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(HANDOFF_STORE)) db.createObjectStore(HANDOFF_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('the handoff store would not open'));
      req.onblocked = () => reject(new Error('the handoff store is held open elsewhere'));
    });
    const takeHandoff = async (id) => {
      const db = await handoffDb();
      try {
        return await new Promise((resolve, reject) => {
          let rec = null;
          const tx = db.transaction(HANDOFF_STORE, 'readwrite');
          const st = tx.objectStore(HANDOFF_STORE);
          const get = st.get(id);
          get.onsuccess = () => {
            rec = get.result || null;
            if (rec) st.delete(id);
            const cut = Date.now() - HANDOFF_TTL;
            const cur = st.openCursor();
            cur.onsuccess = () => {
              const c = cur.result;
              if (!c) return;
              const v = c.value;
              if (c.key !== id && !(v && typeof v.at === 'number' && v.at > cut)) c.delete();
              c.continue();
            };
          };
          tx.oncomplete = () => resolve(rec);
          tx.onerror = () => reject(tx.error || new Error('the handoff store failed'));
          tx.onabort = () => reject(tx.error || new Error('the handoff store aborted'));
        });
      } finally { db.close(); }
    };

    /* the File goes the way a picked one goes — readPicked, then the
       renderer's own open: a tab, the extents, the Recent list, and the
       usage event, tagged with where the file came from */
    const openFile = async (file, source) => {
      const off = onDocProgress((p) => { if (p && p.text) upFx.phase(String(p.text)); });
      let res;
      try {
        upFx.phase('Opening…', true);
        res = await readPicked(file);
      } finally { off(); }
      res.source = source;
      /* the veil holds until the drawing lands in Nasj.docs — or it goes
         now, if it never showed */
      upFx.opening(file.name);
      try { await fileOps().openResults([res]); }
      finally { upFx.dismiss(); }
      return res.ok
        ? { ok: true, source, name: file.name }
        : { ok: false, source, name: file.name, error: res.error };
    };

    const openUrl = async (path, name) => {
      if (!onSite(path)) return fail('not a path on this site: ' + String(path), OFFSITE);
      const fname = nameFor(path, name);
      upFx.begin(fname, 1, 1);
      upFx.phase('Downloading…', true);
      let file;
      try { file = await download(path, fname); }
      catch (err) { return fail(path + ': ' + ((err && err.message) || err)); }
      return openFile(file, 'url');
    };

    const openHandoff = async (id) => {
      const key = String(id == null ? '' : id).trim();
      if (!key) return fail('handoff: no id');
      let rec;
      try { rec = await takeHandoff(key); }
      catch (err) { return fail('handoff ' + key + ': ' + ((err && err.message) || err)); }
      if (!rec || rec.bytes == null) return fail('handoff ' + key + ': no such record');
      const fname = nameFor('', rec.name);
      upFx.begin(fname, 1, 1);
      let file;
      try { file = new File([rec.bytes], fname, { type: String(rec.type || '') }); }
      catch (err) { return fail('handoff ' + key + ': ' + ((err && err.message) || err)); }
      return openFile(file, 'handoff');
    };

    /* the address, acted on once the renderer is up; our keys leave it
       whichever way the open went */
    const fromQuery = async (search) => {
      let q;
      try { q = new URLSearchParams(String(search == null ? location.search : search)); }
      catch (e) { return null; }
      const open = q.get('open');
      const handoff = q.get('handoff');
      if (open == null && handoff == null) return null;
      try {
        if (!(await whenReady(READY_MS))) return fail('the renderer did not come up');
        return handoff != null ? await openHandoff(handoff) : await openUrl(open, q.get('name'));
      } catch (err) {
        return fail((err && err.message) || String(err));
      } finally { stripQuery(); }
    };

    /* boot: a query that names a file is a launch onto a file — the
       tracker's word for a double-clicked drawing on the desktop */
    if (!HOSTED && /[?&](open|handoff)=/.test(location.search)) {
      try {
        const t = window.Nasj && window.Nasj.track;
        if (t && typeof t.hint === 'function') t.hint({ launch: 'file' });
      } catch (e) { /* the tracker is not there */ }
      const go = () => { fromQuery(location.search).catch(noop); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
      else go();
    }

    return { fromQuery, openUrl, openHandoff, ready };
  })();
  window.nasjWebOpen = webOpen;

  /* XREF attach and IMPORT share the Open dialog's reading; the renderer
     only wants the {ok, name, kind, json} shape back — one string, never a
     stream, whatever the size. */
  const pickXref = async () => {
    const files = await pickFiles('.njc,.dxf,.dwg', false);
    if (!files) return null;
    return readPicked(files[0], true);
  };

  /* IMAGEATTACH: the picked image travels as a data URL, same as a drop */
  const pickImage = async () => {
    const files = await pickFiles('image/*', false);
    if (!files) return null;
    const file = files[0];
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const rd = new FileReader();
        rd.onload = () => resolve(String(rd.result));
        rd.onerror = () => reject(new Error('could not read the image'));
        rd.readAsDataURL(file);
      });
      return { ok: true, name: file.name, dataUrl };
    } catch (err) {
      return { ok: false, name: file.name, error: (err && err.message) || String(err) };
    }
  };

  /* RTEXT: the file picks fine; by-path refresh cannot exist in a tab, and
     the renderer already skips refresh for path-less remote texts */
  const pickText = async () => {
    const files = await pickFiles('.txt,text/plain', false);
    if (!files) return null;
    try {
      return { ok: true, path: null, name: files[0].name, text: await files[0].text() };
    } catch (err) {
      return { ok: false, name: files[0].name, error: (err && err.message) || String(err) };
    }
  };
  const readText = async () => ({ ok: false, error: 'a browser tab cannot read files by path' });

  /* MKLTYPE's .lin and MKSHAPE's .shp: a text file through the save dialog,
     or a download where the dialog does not exist */
  const saveTextFile = async (payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    const name = String(p.suggestedName || 'file.txt');
    const blob = new Blob([String(p.content == null ? '' : p.content)], { type: 'text/plain' });
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: name });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        return { path: null, name: handle.name || name };
      } catch (err) {
        if (err && err.name === 'AbortError') return null;
        /* fall through to a download */
      }
    }
    download(blob, name);
    return { path: null, name };
  };

  /* ------------------------------------------------------------------ *
   * Raster / print / PDF
   * ------------------------------------------------------------------ */
  const exportPng = async (payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    const name = String(p.suggestedName || 'drawing.png');
    if (!p.dataUrl) return null;
    download(await dataUrlToBlob(p.dataUrl), name);
    return name;
  };

  /* One print window serves PDF export and both plot paths: a browser
     cannot drive a named printer, but its own dialog does Save-as-PDF and
     every installed printer, which is the same two things asked for. */
  const printImage = (dataUrl, landscape) => new Promise((resolve) => {
    if (!dataUrl) { resolve(false); return; }
    const w = window.open('', '_blank');
    if (!w) { resolve(false); return; }
    w.document.write(
      '<!DOCTYPE html><html><head><title>pixelbay CAD</title><style>' +
      '@page{size:' + (landscape ? 'landscape' : 'portrait') + ';margin:0}' +
      'html,body{margin:0;padding:0;background:#fff}' +
      'img{width:100%;height:100%;object-fit:contain;display:block}' +
      '</style></head><body><img alt="drawing"></body></html>');
    w.document.close();
    const img = w.document.querySelector('img');
    img.addEventListener('load', () => {
      w.focus();
      w.print();
      resolve(true);
    });
    img.addEventListener('error', () => { w.close(); resolve(false); });
    img.src = dataUrl;
  });

  const exportPdf = async (payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    const ok = await printImage(p.dataUrl, p.landscape);
    if (!ok) return null;
    /* the browser's dialog owns the filename from here */
    return String(p.suggestedName || 'drawing.pdf');
  };

  const plot = async (payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    return { ok: await printImage(p.dataUrl, p.landscape) };
  };

  const plotPrint = async (payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    const ok = await printImage(p.dataUrl, p.landscape);
    return ok ? { ok: true }
      : { ok: false, error: 'the browser blocked the print window — allow pop-ups for this site' };
  };

  /* the plot dialog needs something to list; naming the browser dialog is
     truthful, where inventing "HP LaserJet" would not be */
  const listPrinters = async () => ([{
    name: 'Browser print dialog',
    isDefault: true,
    description: 'Choose the printer, or Save as PDF, in your browser',
  }]);

  /* ------------------------------------------------------------------ *
   * Fonts — the real installed set where the browser will say (Chromium,
   * behind a permission prompt), a safe list everywhere else.
   * ------------------------------------------------------------------ */
  const WEB_SAFE = [
    'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS',
    'Consolas', 'Courier New', 'Georgia', 'Impact', 'Lucida Console',
    'Palatino Linotype', 'Segoe UI', 'Tahoma', 'Times New Roman',
    'Trebuchet MS', 'Verdana',
  ];

  const listFonts = async () => {
    if (typeof window.queryLocalFonts === 'function') {
      try {
        const got = await window.queryLocalFonts();
        const names = [...new Set(got.map((f) => f.family))].sort();
        if (names.length) return names.map((name) => ({ name, tt: true }));
      } catch (e) { /* denied or unsupported — fall through */ }
    }
    return WEB_SAFE.map((name) => ({ name, tt: true }));
  };

  /* ------------------------------------------------------------------ *
   * Graphics info — read off a throwaway WebGL context
   * ------------------------------------------------------------------ */
  const gfxInfo = async () => {
    let renderer = 'unknown';
    let vendor = 'unknown';
    try {
      const cv = document.createElement('canvas');
      const gl = cv.getContext('webgl2') || cv.getContext('webgl');
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || renderer;
          vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || vendor;
        }
        return {
          info: { renderer, vendor, platform: 'web' },
          status: { webgl: 'enabled', canvas: 'enabled' },
          accel: true,
        };
      }
    } catch (e) { /* no webgl */ }
    return {
      info: { renderer, vendor, platform: 'web' },
      status: { webgl: 'unavailable', canvas: 'enabled' },
      accel: false,
    };
  };

  /* the browser owns this switch; reporting the truth beats pretending */
  const gfxSetAccel = async () => true;

  /* ------------------------------------------------------------------ *
   * Window controls. Maximize is real fullscreen; the rest cannot exist.
   * ------------------------------------------------------------------ */
  const maxListeners = new Set();
  document.addEventListener('fullscreenchange', () => {
    const on = Boolean(document.fullscreenElement);
    for (const cb of maxListeners) { try { cb(on); } catch (e) { /* keep going */ } }
  });

  const toggleMaximize = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(noop);
    }
  };

  /* the renderer's unsaved-changes flow, mapped onto the only warning a
     tab is allowed to raise */
  let closeGuard = null;
  window.addEventListener('beforeunload', (e) => {
    if (!closeGuard) return;
    const doc = window.Nasj && window.Nasj.doc;
    if (doc && doc.modified) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ------------------------------------------------------------------ *
   * The drawing pipeline. aiRaster is the site's tracer, free and open to
   * anyone; aiImage (below, with the agent) is the drafting engine, which
   * runs on the account's balance.
   * ------------------------------------------------------------------ */
  const aiRaster = async (payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    try {
      const res = await fetch('/api/raster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: p.dataUrl }),
      });
      const j = await res.json();
      if (!res.ok) {
        return { ok: false, backend: 'web', size: [0, 0], strokes: [], counts: { strokes: 0, points: 0 },
          notes: [], error: (j && j.error) || ('the tracer failed (HTTP ' + res.status + ')') };
      }
      return j;
    } catch (err) {
      return { ok: false, backend: 'web', size: [0, 0], strokes: [], counts: { strokes: 0, points: 0 },
        notes: [], error: 'could not reach the tracer: ' + ((err && err.message) || err) };
    }
  };

  /* ------------------------------------------------------------------ *
   * The agent, on the site's account.
   *
   * The desktop runs the loop in its main process and the renderer only
   * sees events. Here the loop runs on the site: POST /api/agent streams
   * one round as server-sent events, in the desktop's shapes, and ends on
   * `tool-exec` when the model wants a drawing — the panel draws in the
   * tab, agentToolResult posts the outcome, and that opens the next round.
   * `conv` names the conversation to keep; `error` carries a `code` (login,
   * balance, model, …) the panel turns into a card with the way in.
   *
   * Balance is the site's: a turn is charged to the account, a drawing
   * takes the draw fee in /api/ai-image, and whatever the server says the
   * balance now is goes to the panel as an `account` event.
   * ------------------------------------------------------------------ */
  const errMsg = (e) => (e && e.message) || String(e);
  const postJson = (url, body, signal) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  const agentListeners = new Set();
  const toolListeners = new Set();
  const emit = (set, e) => {
    for (const cb of set) { try { cb(e); } catch (err) { /* keep going */ } }
  };
  const account = (patch) => emit(agentListeners, Object.assign({ kind: 'account' }, patch));

  const aiImage = async (payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    let res, j;
    try {
      res = await postJson('/api/ai-image', {
        prompt: p.prompt, refDataUrl: p.refDataUrl,
        imageSize: p.imageSize, aspectRatio: p.aspectRatio,
      });
      j = await res.json();
    } catch (err) {
      return { ok: false, error: 'could not reach the drafting service: ' + errMsg(err) };
    }
    if (j && typeof j.balanceMicro === 'number') account({ balanceMicro: j.balanceMicro });
    if (j && typeof j.ok === 'boolean') return j;
    return { ok: false, error: 'the drafting service failed (HTTP ' + res.status + ')' };
  };

  let convId = null;
  let inflight = null;                   /* AbortController of the open stream */

  const stream = async (body) => {
    if (inflight) inflight.abort();
    const ctl = new AbortController();
    inflight = ctl;
    const finish = () => { if (inflight === ctl) inflight = null; };

    let raw = null;
    try { raw = localStorage.getItem('pixelbay.byok') || localStorage.getItem('nasjicad.byok'); } catch (_) {}
    let cfg = {};
    try { cfg = raw ? JSON.parse(raw) : {}; } catch (_) {}

    const provider = cfg.provider || cfg.AGENT_PROVIDER || 'deepseek';
    const apiKey = cfg.GEMINI_API_KEY || cfg.DEEPSEEK_API_KEY || cfg.OPENROUTER_API_KEY || cfg.CUSTOM_API_KEY || cfg.key || '';

    if (!apiKey) {
      finish();
      emit(agentListeners, { kind: 'error', code: 'no_key', message: 'API Key belum diisi. Masukkan API Key via menu BYOK / Console.' });
      return;
    }

    emit(agentListeners, { kind: 'think', text: 'Menghubungkan ke ' + provider + '…' });

    if (provider === 'gemini') {
      const model = cfg.AGENT_MODEL || cfg.GEMINI_MODEL || 'gemini-1.5-flash';
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              { role: 'user', parts: [{ text: 'System instruction: You are pixelbay CAD assistant. Help with 2D/3D CAD geometry and architectural layout.\n\nUser request: ' + (body.text || '') }] }
            ]
          }),
          signal: ctl.signal
        });

        if (!res.ok) {
          const t = await res.text();
          let msg = 'HTTP ' + res.status;
          try { msg = JSON.parse(t).error.message || msg; } catch (_) {}
          finish();
          emit(agentListeners, { kind: 'error', code: 'ai_err', message: 'Gemini Error: ' + msg });
          return;
        }

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';

          for (const line of lines) {
            const trim = line.trim();
            if (!trim || !trim.startsWith('data:')) continue;
            const dataStr = trim.replace(/^data:\s*/, '');
            if (dataStr === '[DONE]') continue;
            try {
              const j = JSON.parse(dataStr);
              const part = j.candidates?.[0]?.content?.parts?.[0];
              if (part?.text) {
                emit(agentListeners, { kind: 'delta', text: part.text });
              }
            } catch (_) {}
          }
        }

        finish();
        emit(agentListeners, { kind: 'done', byok: true });
        return;
      } catch (err) {
        finish();
        if (!ctl.signal.aborted) {
          emit(agentListeners, { kind: 'error', code: 'network', message: err.message || 'Koneksi Gemini gagal.' });
        }
        return;
      }
    }

    let endpoint = 'https://api.deepseek.com/chat/completions';
    let model = cfg.AGENT_MODEL || cfg.DEEPSEEK_MODEL || 'deepseek-chat';
    if (provider === 'openrouter') {
      endpoint = 'https://openrouter.ai/api/v1/chat/completions';
      model = cfg.OPENROUTER_MODEL || 'deepseek/deepseek-chat';
    } else if (provider === 'custom' && cfg.AGENT_BASE_URL) {
      endpoint = cfg.AGENT_BASE_URL.replace(/\/+$/, '') + '/chat/completions';
      model = cfg.CUSTOM_MODEL || cfg.AGENT_MODEL || 'gpt-4o-mini';
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'pixelbay CAD'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are pixelbay CAD assistant. Help with CAD drawing, floor plans, and geometry.' },
            { role: 'user', content: body.text || '' }
          ],
          stream: true
        }),
        signal: ctl.signal
      });

      if (!res.ok) {
        const t = await res.text();
        let msg = 'HTTP ' + res.status;
        try { msg = JSON.parse(t).error.message || msg; } catch (_) {}
        finish();
        emit(agentListeners, { kind: 'error', code: 'ai_err', message: msg });
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          const trim = line.trim();
          if (!trim || !trim.startsWith('data:')) continue;
          const dataStr = trim.replace(/^data:\s*/, '');
          if (dataStr === '[DONE]') continue;
          try {
            const j = JSON.parse(dataStr);
            const delta = j.choices && j.choices[0] && j.choices[0].delta;
            if (delta && delta.content) {
              emit(agentListeners, { kind: 'delta', text: delta.content });
            }
            if (delta && delta.reasoning_content) {
              emit(agentListeners, { kind: 'think', text: delta.reasoning_content });
            }
          } catch (_) {}
        }
      }

      finish();
      emit(agentListeners, { kind: 'done', byok: true });
    } catch (err) {
      finish();
      if (!ctl.signal.aborted) {
        emit(agentListeners, { kind: 'error', code: 'network', message: err.message || 'Koneksi gagal.' });
      }
    }
  };

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          chunk(buf.slice(0, i));
          buf = buf.slice(i + 2);
        }
      }
      if (buf.trim()) chunk(buf);
    } catch (err) {
      if (!ctl.signal.aborted) {
        settled = true;
        emit(agentListeners, { kind: 'error', code: 'network',
          message: 'The connection to the agent dropped: ' + errMsg(err) });
      }
    }
    finish();
    if (!settled && !ctl.signal.aborted) {
      emit(agentListeners, { kind: 'error', code: 'server',
        message: 'The agent stopped before it finished. Send the message again.' });
    }
  };

  const agentLibrary = async (options={}) => {
    const res=await fetch('/api/agent/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(options)}),j=await res.json();
    if(!res.ok||!j.ok)throw Error(j.error||'Library unavailable.');return j;
  };
  const agentHistory = async (options={}) => {
    const q=new URLSearchParams();for(const k of ['q','cursor','before'])if(options[k]!=null)q.set(k,String(options[k]).slice(0,500));
    const suffix=options.id?'/'+encodeURIComponent(String(options.id).slice(0,100)):'';
    const res=await fetch('/api/agent/conversations'+suffix+'?'+q,{cache:'no-store'}),j=await res.json();
    if(!res.ok||!j.ok)throw Error(j.error||'History could not be loaded.');return j;
  };
  const agentSend = (payload) => {
    const text = payload && payload.text != null ? String(payload.text) : '';
    if(payload && Object.prototype.hasOwnProperty.call(payload,'convId')) convId=payload.convId || null;
    stream({ text, images: payload && payload.images,displayText:payload && payload.displayText,references:payload && payload.references,drawing:payload && payload.drawing });
  };
  const agentToolResult = (id, result) => { stream({ toolResult: { id, result } }); };
  const agentStop = () => {
    const c = inflight;
    inflight = null;
    if (c) c.abort();
  };
  const agentReset = () => { agentStop(); convId = null; };

  /* the account behind the panel: balance, the model it runs on, the fee */
  const accountGet = async () => {
    let raw = null;
    try { raw = localStorage.getItem('pixelbay.byok') || localStorage.getItem('nasjicad.byok'); } catch (_) {}
    let cfg = {};
    try { cfg = raw ? JSON.parse(raw) : {}; } catch (_) {}

    const provider = cfg.provider || cfg.AGENT_PROVIDER || 'deepseek';
    const key = cfg.DEEPSEEK_API_KEY || cfg.OPENROUTER_API_KEY || cfg.CUSTOM_API_KEY || cfg.key || '';
    const hasKey = !!key;
    const model = cfg.AGENT_MODEL || (provider === 'deepseek' ? 'deepseek-chat' : provider === 'openrouter' ? 'deepseek/deepseek-chat' : 'custom');

    const acct = {
      ok: true,
      balanceMicro: 0,
      unlimitedAi: hasKey,
      model: {
        label: hasKey ? (provider.toUpperCase() + ' (' + model + ')') : 'No API Key',
        byok: hasKey,
        provider
      }
    };
    account(acct);
    return acct;
  };

  /* BYOK on the web: the key is stored encrypted on the account and used by
     the site; the tab only ever sees its tail. The panel speaks the desktop
     store's field names (XAI_API_KEY, AGENT_MODEL, …), so they are mapped
     to the account's {provider, model, baseUrl, key} here. The drafting key
     is the site's and has no slot. */
  const byokStatus = (b, extra) => {
    let raw = null;
    try { raw = localStorage.getItem('pixelbay.byok') || localStorage.getItem('nasjicad.byok'); } catch (_) {}
    let local = {};
    try { local = raw ? JSON.parse(raw) : {}; } catch (_) {}

    const provider = local.provider || local.AGENT_PROVIDER || (b && b.provider) || 'deepseek';
    const keyVal = local.DEEPSEEK_API_KEY || local.OPENROUTER_API_KEY || local.CUSTOM_API_KEY || local.key || (b && b.keyTail);
    const keyTail = keyVal ? (keyVal.length > 8 ? '…' + keyVal.slice(-6) : '…') : '';

    const key = keyVal
      ? { set: true, source: 'you', tail: keyTail }
      : { set: false, source: null, tail: '' };

    const s = Object.assign({
      web: true,
      provider,
      model: local.AGENT_MODEL || local.DEEPSEEK_MODEL || (b && b.model) || null,
      baseUrl: local.AGENT_BASE_URL || (b && b.baseUrl) || null,
      active: true,
      inUse: true,
      agent: key,
      deepseek: key,
      openrouter: key,
      custom: key,
      gemini: { set: false, source: null, tail: '' },
    }, extra || {});

    s[provider] = key;
    return s;
  };

  const byokGet = async () => {
    return byokStatus();
  };

  const byokSet = async (patch) => {
    const p = patch && typeof patch === 'object' ? patch : {};
    let raw = null;
    try { raw = localStorage.getItem('pixelbay.byok') || localStorage.getItem('nasjicad.byok'); } catch (_) {}
    let local = {};
    try { local = raw ? JSON.parse(raw) : {}; } catch (_) {}

    const updated = Object.assign(local, p);
    if (typeof p.AGENT_PROVIDER === 'string') updated.provider = p.AGENT_PROVIDER;
    if (typeof p.AGENT_BASE_URL === 'string') updated.AGENT_BASE_URL = p.AGENT_BASE_URL;
    if (typeof p.AGENT_MODEL === 'string') updated.AGENT_MODEL = p.AGENT_MODEL;
    if (typeof p.BYOK_ACTIVE === 'string') updated.active = p.BYOK_ACTIVE === '1';

    for (const k of Object.keys(p)) {
      if (typeof p[k] !== 'string') continue;
      if (k === 'AGENT_MODEL' || /_MODEL$/.test(k)) updated.AGENT_MODEL = p[k];
      const m = /^([A-Z]+)_API_KEY$/.exec(k);
      if (m) {
        updated[k] = p[k];
        updated.key = p[k];
        if (m[1] !== 'AGENT') updated.provider = m[1].toLowerCase();
      }
    }

    try {
      localStorage.setItem('pixelbay.byok', JSON.stringify(updated));
    } catch (_) {}

    return byokStatus(updated, { ok: true });
  };

  /* ------------------------------------------------------------------ *
   * The bridge
   * ------------------------------------------------------------------ */
  const bridge = {
    /* window */
    minimize: noop,
    toggleMaximize,
    close: () => { try { window.close(); } catch (e) { /* tabs may refuse */ } },
    onCloseRequest: (cb) => { if (typeof cb === 'function') closeGuard = cb; },
    forceClose: noop,
    closeCancelled: noop,
    /* no application menu in a browser tab: nothing ever arrives, and a
       native edit is the document's own command */
    onMenuCommand: () => () => {},
    editNative: (name) => {
      try { document.execCommand(String(name || '')); } catch (e) { /* the field stands */ }
    },
    onMaximizedChange: (cb) => {
      if (typeof cb !== 'function') return unsub();
      maxListeners.add(cb);
      return () => maxListeners.delete(cb);
    },

    /* files. savePick/saveWrite are deliberately absent: the renderer then
       takes its single-phase saveDrawing path, which is the browser-correct
       one — a tab cannot resolve a target file before it has the bytes. */
    saveDrawing,
    openDrawing,
    openDrawings,
    readDrawing,
    filePathOf,
    /* document streams — the reader worker's slices, in the desktop's shape */
    docStreamStart,
    docStreamDrop,
    onDocChunk,
    onDocProgress,
    pickXref,
    importDrawing: pickXref,               /* IMPORT reads the same formats */
    pickImage,
    pickText,
    readText,
    saveTextFile,
    exportPng,
    exportPdf,
    plot,
    pickFolder: async () => null,          /* a tab cannot name a folder */
    confirmBox: async (payload) => {
      const p = payload && typeof payload === 'object' ? payload : {};
      return window.confirm(String(p.message == null ? 'Are you sure?' : p.message));
    },

    /* graphics */
    gfxInfo,
    gfxSetAccel,

    /* fonts + plot */
    listFonts,
    listPrinters,
    plotPrint,

    /* drawing pipeline */
    aiImage,
    aiRaster,
    onAiProgress: unsub,
    onAiRasterChunk: unsub,

    /* agent */
    agentSend,
    agentHistory, agentLibrary,
    agentStop,
    agentReset,
    onAgentEvent: (cb) => {
      if (typeof cb !== 'function') return unsub();
      agentListeners.add(cb);
      return () => agentListeners.delete(cb);
    },
    onAgentToolExec: (cb) => {
      if (typeof cb !== 'function') return unsub();
      toolListeners.add(cb);
      return () => toolListeners.delete(cb);
    },
    agentToolResult,

    /* the account the agent runs on — web only; the desktop has no account */
    accountGet,
    byokGet,
    byokSet,

    /* environment */
    platform: 'web',
  };
  if (!HOSTED) window.nasjAPI = bridge;

  /* window.nasjDesktop — the desktop's second bridge (preload.js: the usage
     tracker's platform key, its QA flag, the device id and the batch queue)
     — is deliberately ABSENT here. Its absence is how src/js/nasj-track.js
     knows it is in a tab: batches then go to same-origin /api/track with
     the session cookie, and wait in localStorage while offline. */
})();
