/* img2dwg — nasj-pwa.js: what makes the web build of Nasjicad installable.
 *
 * Copied by scripts/sync-cad.mjs into public/nasjicad/js/ and named last
 * in the synced index.html — the desktop app never sees it, and the
 * renderer never knows it is there. It is a separate file rather than an
 * inline script because the page's CSP allows no inline script at all.
 *
 * Three jobs:
 *   1. register /cad-sw.js (scope /cad) once the page has loaded, so the
 *      shell is cached and the next visit works with no connection;
 *   2. catch beforeinstallprompt and hold it as window.nasjPWA, so the
 *      browser's install flow can be started from our own button:
 *        window.nasjPWA = { canInstall, installed, install(), version }
 *   3. show one small "Install app" pill — bottom-right of the drawing on
 *      a desktop, bottom-centre of the Start page on a phone — hidden once
 *      the app is installed or running standalone, dismissible for the
 *      session. iOS has no prompt to hold, so there the pill is a one-line
 *      hint: Share, then Add to Home Screen.
 *
 * And one courtesy: /cad?new=1 (the launcher shortcut "New drawing")
 * presses the Start page's own New, then drops the query so a reload does
 * not press it again.
 */
(() => {
  'use strict';

  /* the desktop app has no use for any of this; nor does a file:// preview */
  if (/\bElectron\//.test(navigator.userAgent)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () =>
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    navigator.standalone === true;

  const DISMISS_KEY = 'nasj.pwa.dismissed';
  const dismissed = () => { try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; } };
  const dismiss = () => { try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch (e) { /* private mode */ } };

  /* ------------------------------------------------------------------ *
   * window.nasjPWA
   * ------------------------------------------------------------------ */
  let deferred = null;                 /* the BeforeInstallPromptEvent, held */
  const pwa = {
    canInstall: false,
    installed: standalone(),
    ios: isIOS,
    version: null,                     /* the worker's build, once it answers */
    /* start the browser's own install dialog; resolves 'accepted',
       'dismissed', or null when there is nothing to prompt with */
    async install() {
      if (!deferred) return null;
      const ev = deferred;
      deferred = null;
      pwa.canInstall = false;
      ev.prompt();
      const choice = await ev.userChoice.catch(() => null);
      const outcome = choice && choice.outcome ? choice.outcome : null;
      if (outcome !== 'accepted') { pwa.canInstall = true; deferred = ev; }
      render();
      return outcome;
    },
  };
  window.nasjPWA = pwa;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();               /* ours to show, at a moment of our choosing */
    deferred = e;
    pwa.canInstall = true;
    render();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    pwa.canInstall = false;
    pwa.installed = true;
    render();
    if (window.Nasj && typeof window.Nasj.toast === 'function') {
      window.Nasj.toast('Nasjicad is installed — open it from your apps');
    }
  });
  if (window.matchMedia) {
    const mq = window.matchMedia('(display-mode: standalone)');
    const onChange = () => { pwa.installed = standalone(); render(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* ------------------------------------------------------------------ *
   * the service worker
   * ------------------------------------------------------------------ */
  if ('serviceWorker' in navigator) {
    const register = () => {
      /* the worker's address carries the build stamp this script was served
         with: a new build registers a new URL, so an edge cache that keeps
         the old /cad-sw.js for hours cannot delay an update */
      const own = (document.currentScript && document.currentScript.src) ||
        (Array.from(document.scripts).map((x) => x.src).find((u) => /nasj-pwa\.js/.test(u)) || '');
      const stamp = (/[?&]v=([a-z0-9]+)/.exec(own) || [])[1];
      navigator.serviceWorker.register('/cad-sw.js' + (stamp ? '?v=' + stamp : ''), { scope: '/cad', updateViaCache: 'none' })
        .then(() => askVersion())
        .catch((err) => console.warn('[nasjicad] service worker not registered:', err && err.message ? err.message : err));
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    const askVersion = () => {
      const sw = navigator.serviceWorker.controller;
      if (!sw || !window.MessageChannel) return;
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => {
        if (e.data && e.data.type === 'nasj-sw-version') pwa.version = e.data.version;
      };
      sw.postMessage({ type: 'nasj-sw-version' }, [ch.port2]);
    };
    navigator.serviceWorker.addEventListener('controllerchange', askVersion);
  }

  /* ------------------------------------------------------------------ *
   * the pill
   * ------------------------------------------------------------------ */
  const css = document.createElement('style');
  css.textContent =
    /* bottom-right of the drawing: above the docked command row (40 px at
       bottom 6 px), left of the navigation strip (40 px at right 10 px) */
    '#nasj-pwa-pill{position:absolute;right:60px;bottom:56px;z-index:60;display:none;' +
      'align-items:center;gap:8px;height:32px;padding:0 6px 0 12px;border-radius:16px;' +
      'background:#2a2a2a;border:1px solid rgba(255,255,255,.14);color:#e8e8e8;' +
      'box-shadow:0 4px 18px rgba(0,0,0,.45);font:500 12px/1 "Segoe UI",system-ui,-apple-system,sans-serif;' +
      'white-space:nowrap;max-width:calc(100% - 80px);user-select:none;-webkit-user-select:none}' +
    '#nasj-pwa-pill.on{display:flex}' +
    '#nasj-pwa-pill .act{display:flex;align-items:center;gap:7px;height:100%;background:none;border:0;' +
      'padding:0;margin:0;color:inherit;font:inherit;cursor:pointer;min-width:0}' +
    '#nasj-pwa-pill .act:hover{color:#fff}' +
    '#nasj-pwa-pill .act svg{flex:none;width:15px;height:15px}' +
    '#nasj-pwa-pill .lbl{overflow:hidden;text-overflow:ellipsis}' +
    '#nasj-pwa-pill.hint .act{cursor:default}' +
    '#nasj-pwa-pill .x{flex:none;width:22px;height:22px;border-radius:11px;border:0;background:none;' +
      'padding:0;margin:0;color:#9a9a9a;font:600 14px/1 "Segoe UI",system-ui,sans-serif;cursor:pointer}' +
    '#nasj-pwa-pill .x:hover{background:rgba(255,255,255,.1);color:#fff}' +
    '#nasj-pwa-pill :focus-visible{outline:2px solid #8fd6ff;outline-offset:2px}' +
    'body.nasj-pwa-fixed #nasj-pwa-pill{position:fixed}' +
    /* a finger-first screen: bottom-centre, over the Start page only — a
       drawing in progress is not the place for it */
    '@media (pointer:coarse){' +
      '#nasj-pwa-pill{right:auto;left:50%;transform:translateX(-50%);height:38px;padding:0 8px 0 14px;' +
        'border-radius:19px;font-size:13px;bottom:calc(14px + env(safe-area-inset-bottom,0px))}' +
      '#nasj-pwa-pill .x{width:28px;height:28px;border-radius:14px}' +
      'body:not(.start-mode) #nasj-pwa-pill{display:none}}';
  (document.head || document.documentElement).appendChild(css);

  const ICON =
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      '<path d="M8 2v7.5M4.8 6.6 8 9.8l3.2-3.2" stroke="currentColor" stroke-width="1.6" ' +
        'stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M2.5 10.5v1.8c0 .7.5 1.2 1.2 1.2h8.6c.7 0 1.2-.5 1.2-1.2v-1.8" stroke="currentColor" ' +
        'stroke-width="1.6" stroke-linecap="round"/></svg>';

  let pill = null;
  const build = () => {
    if (pill) return pill;
    /* the drawing area itself, which the Start page also covers — never a
       palette or the agent panel docked beside it */
    const host = document.getElementById('viewport-container') || document.getElementById('workspace') || document.body;
    if (host === document.body) document.body.classList.add('nasj-pwa-fixed');
    pill = document.createElement('div');
    pill.id = 'nasj-pwa-pill';
    pill.setAttribute('role', 'status');
    pill.innerHTML =
      '<button type="button" class="act">' + ICON + '<span class="lbl"></span></button>' +
      '<button type="button" class="x" title="Not now" aria-label="Dismiss">&times;</button>';
    pill.querySelector('.act').addEventListener('click', () => { if (!isIOS) pwa.install(); });
    pill.querySelector('.x').addEventListener('click', () => { dismiss(); render(); });
    host.appendChild(pill);
    return pill;
  };

  /* what the pill says, or nothing at all */
  const render = () => {
    const show = !pwa.installed && !dismissed() && (pwa.canInstall || isIOS);
    if (!show) { if (pill) pill.classList.remove('on'); return; }
    if (!document.body) return;
    const el = build();
    el.classList.toggle('hint', isIOS && !pwa.canInstall);
    el.querySelector('.lbl').textContent = isIOS && !pwa.canInstall
      ? 'Install: Share → Add to Home Screen'
      : 'Install app';
    el.querySelector('.act').title = isIOS && !pwa.canInstall
      ? 'Safari: tap Share, then "Add to Home Screen" — Nasjicad opens like an app'
      : 'Install Nasjicad on this device — it opens on its own, and works with no connection';
    el.classList.add('on');
    if (fb) el.style.bottom = '94px';
  };

  /* ------------------------------------------------------------------ *
   * the feedback pill — the way a problem reaches the team from inside
   * the CAD. One small button at the bottom-right of the drawing; a press
   * opens three links in a new tab, each carrying which app, which build
   * and which page, so the report lands with its context attached.
   * Never on a phone in the middle of a drawing (pointer:coarse hides it
   * outside the Start page, like the install pill).
   * ------------------------------------------------------------------ */
  const fbCss = document.createElement('style');
  fbCss.textContent =
    '#nasj-fb{position:absolute;right:60px;bottom:56px;z-index:59;display:flex;flex-direction:column;align-items:flex-end;gap:6px;' +
      'font:500 12px/1 "Segoe UI",system-ui,-apple-system,sans-serif;user-select:none;-webkit-user-select:none}' +
    '#nasj-fb .fb-btn{display:flex;align-items:center;gap:6px;height:28px;padding:0 10px 0 9px;border-radius:14px;' +
      'background:#2a2a2a;border:1px solid rgba(255,255,255,.14);color:#c9c9c9;cursor:pointer;' +
      'box-shadow:0 4px 18px rgba(0,0,0,.45);font:inherit;white-space:nowrap}' +
    '#nasj-fb .fb-btn:hover,#nasj-fb.open .fb-btn{color:#fff;background:#333}' +
    '#nasj-fb .fb-btn svg{width:14px;height:14px;flex:none}' +
    '#nasj-fb .fb-menu{display:none;flex-direction:column;min-width:200px;padding:6px;border-radius:12px;' +
      'background:#2a2a2a;border:1px solid rgba(255,255,255,.14);box-shadow:0 8px 28px rgba(0,0,0,.5)}' +
    '#nasj-fb.open .fb-menu{display:flex}' +
    '#nasj-fb .fb-menu a{display:block;padding:8px 10px;border-radius:8px;color:#e8e8e8;text-decoration:none;font:inherit;font-size:12.5px}' +
    '#nasj-fb .fb-menu a:hover{background:rgba(255,255,255,.08);color:#fff}' +
    '#nasj-fb .fb-menu a small{display:block;margin-top:2px;color:#9a9a9a;font-size:11px}' +
    '#nasj-fb :focus-visible{outline:2px solid #8fd6ff;outline-offset:2px}' +
    'body.nasj-pwa-fixed #nasj-fb{position:fixed}' +
    /* the install pill, when it shows, sits above this one */
    '#nasj-fb ~ #nasj-pwa-pill,#nasj-pwa-pill ~ #nasj-fb{}' +
    '@media (pointer:coarse){#nasj-fb{right:12px;bottom:calc(60px + env(safe-area-inset-bottom,0px))}' +
      'body:not(.start-mode) #nasj-fb{display:none}}';
  (document.head || document.documentElement).appendChild(fbCss);

  const FB_ICON =
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      '<path d="M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8l-3.2 2.4V11.5H2.5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" ' +
        'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

  const fbLink = (category, from) => {
    const q = new URLSearchParams();
    if (category) q.set('category', category);
    q.set('from', 'cad');
    const v = (window.NASJ_VERSION ? String(window.NASJ_VERSION) : '') + (pwa.version ? ' ' + pwa.version : '');
    if (v.trim()) q.set('v', v.trim());
    q.set('url', location.origin + location.pathname);
    return location.origin + (from === 'hub' ? '/community' : '/community/new?' + q.toString());
  };

  let fb = null;
  const buildFb = () => {
    if (fb) return fb;
    const host = document.getElementById('viewport-container') || document.getElementById('workspace') || document.body;
    if (host === document.body) document.body.classList.add('nasj-pwa-fixed');
    fb = document.createElement('div');
    fb.id = 'nasj-fb';
    fb.innerHTML =
      '<div class="fb-menu" role="menu">' +
        '<a role="menuitem" target="_blank" rel="noopener" data-cat="problems">Report a problem<small>Something did not work: tell the team, attach the file</small></a>' +
        '<a role="menuitem" target="_blank" rel="noopener" data-cat="questions">Ask a question<small>How do I…? Members and the team answer</small></a>' +
        '<a role="menuitem" target="_blank" rel="noopener" data-cat="ideas">Suggest an idea<small>What would make NASJI better for your work</small></a>' +
        '<a role="menuitem" target="_blank" rel="noopener" data-cat="hub">Open the community<small>Everything people asked, reported and showed</small></a>' +
      '</div>' +
      '<button type="button" class="fb-btn" aria-haspopup="menu" aria-expanded="false" title="Report a problem or suggest an idea">' + FB_ICON + 'Feedback</button>';
    const btn = fb.querySelector('.fb-btn');
    const toggle = (on) => { fb.classList.toggle('open', on); btn.setAttribute('aria-expanded', on ? 'true' : 'false'); };
    btn.addEventListener('click', () => {
      const on = !fb.classList.contains('open');
      if (on) fb.querySelectorAll('a[data-cat]').forEach((a) => { a.href = fbLink(a.dataset.cat === 'hub' ? null : a.dataset.cat, a.dataset.cat === 'hub' ? 'hub' : 'new'); });
      toggle(on);
    });
    fb.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => toggle(false)));
    document.addEventListener('click', (e) => { if (fb && !fb.contains(e.target)) toggle(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
    host.appendChild(fb);
    return fb;
  };
  const showFb = () => { if (!document.body) return; buildFb(); /* the install pill, when both are up, moves above */ if (pill) pill.style.bottom = '94px'; };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(showFb, 400));
  else setTimeout(showFb, 400);

  /* ------------------------------------------------------------------ *
   * /cad?new=1 — the launcher's "New drawing"
   * ------------------------------------------------------------------ */
  const wantNew = /[?&]new=1(&|$)/.test(location.search);
  const pressNew = () => {
    const btn = document.querySelector('#start-page .st-split.primary .st-split-main');
    if (!btn) return false;
    btn.click();
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* fine */ }
    return true;
  };

  const start = () => {
    render();
    if (wantNew) {
      let tries = 0;
      const t = setInterval(() => { if (pressNew() || ++tries > 40) clearInterval(t); }, 100);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
