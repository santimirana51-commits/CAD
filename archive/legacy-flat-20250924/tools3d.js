/* Nasjicad — tools3d.js
 * 3D-view UI wiring (3D foundation). Owner: ENGINE. Additive only:
 * - registers view commands through Nasj.cmd.def IF that API exists at load
 *   (it does not today — commands.js keeps its table private), otherwise the
 *   engine-side Nasj.setView / Nasj.view3d API stands alone;
 * - binds the view-navigator axis balls and replaces the [Top]
 *   viewport-label placeholder menu with a working preset-view menu
 *   (app.js owns no per-face logic, so these minimal DOM handlers are safe);
 * - keeps the viewport label / gizmo orientation in sync via 'nasj:view3d'.
 */
(() => {
  'use strict';
  const N = window.Nasj = window.Nasj || {};

  /* the industry standard's own menu order: the plan pair, the four elevations, the isos */
  const VIEWS = [
    ['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right'],
    ['front', 'Front'], ['back', 'Back'],
    ['swiso', 'SW Isometric'], ['seiso', 'SE Isometric'],
    ['neiso', 'NE Isometric'], ['nwiso', 'NW Isometric']
  ];
  const LABEL = { custom: 'Custom' };
  VIEWS.forEach(([k, l]) => { LABEL[k] = l; });
  const setView = (key) => {
    if (typeof N.setView === 'function') N.setView(key);
  };

  /* additive command defs — ONLY through a Nasj.cmd def API, when present */
  if (N.cmd && typeof N.cmd.def === 'function') {
    for (const [key, label] of VIEWS) {
      N.cmd.def('VIEW' + key.toUpperCase(), [], () => setView(key),
        label + ' view', { cat: 'View', icon: 'named-view' });
    }
  }

  /* ---------------- the [Top] view menu, the industry standard's own layout:
     Custom Model Views (the drawing's saved views, greyed when none),
     the ten standard views with a check on the current one, the View
     Manager, and the Parallel/Perspective pair. ---------------- */
  let menuEl = null;
  let subEl = null;
  const onAway = (e) => {
    if (menuEl && !menuEl.contains(e.target) &&
        !(subEl && subEl.contains(e.target))) closeMenu();
  };
  const closeSub = () => {
    if (subEl && subEl.parentNode) subEl.parentNode.removeChild(subEl);
    subEl = null;
  };
  const closeMenu = () => {
    closeSub();
    if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
    menuEl = null;
    document.removeEventListener('pointerdown', onAway, true);
  };

  const currentKey = () => {
    const v = N.view3d;
    if (!v || !v.active) return 'top';
    return LABEL[v.viewName] ? v.viewName : 'custom';
  };

  const MENU_STYLE = {
    position: 'fixed', zIndex: '300', minWidth: '176px',
    background: '#2b3138', border: '1px solid #454d57', borderRadius: '3px',
    boxShadow: '0 4px 14px rgba(0,0,0,.45)', padding: '3px 0',
    font: '12px "Segoe UI", sans-serif', color: '#d6d6d6'
  };
  const menuBox = (id) => {
    const m = document.createElement('div');
    m.id = id;
    Object.assign(m.style, MENU_STYLE);
    return m;
  };
  /* one row: a 14px check column, the label, an optional arrow for a submenu */
  const menuItem = (host, label, opts) => {
    const o = opts || {};
    const it = document.createElement('div');
    it.className = 'v3d-item';
    Object.assign(it.style, {
      display: 'flex', alignItems: 'center', gap: '2px',
      padding: '4px 12px 4px 8px', cursor: 'default', whiteSpace: 'nowrap'
    });
    const chk = document.createElement('span');
    chk.textContent = o.checked ? '✓' : '';
    Object.assign(chk.style, { flex: 'none', width: '14px', textAlign: 'center' });
    it.appendChild(chk);
    const lab = document.createElement('span');
    lab.textContent = label;
    lab.style.flex = '1';
    it.appendChild(lab);
    if (o.arrow) {
      const ar = document.createElement('span');
      ar.textContent = '▸';
      ar.style.flex = 'none';
      it.appendChild(ar);
    }
    if (o.disabled) {
      it.style.color = '#767e88';
    } else {
      it.addEventListener('mouseenter', () => {
        it.style.background = '#3a424c';
        if (o.enter) o.enter(it); else closeSub();
      });
      it.addEventListener('mouseleave', () => { it.style.background = ''; });
      if (o.run) {
        it.addEventListener('click', (e) => {
          e.stopPropagation();
          closeMenu();
          o.run();
        });
      }
    }
    host.appendChild(it);
    return it;
  };
  const menuSep = (host) => {
    const s = document.createElement('div');
    Object.assign(s.style, { height: '1px', background: '#454d57', margin: '4px 1px' });
    host.appendChild(s);
  };

  /* the saved views fly out beside their row, the industry standard's hover submenu */
  const openSub = (anchorItem, views) => {
    closeSub();
    const s = menuBox('view3d-submenu');
    for (const v of views) {
      menuItem(s, v.name, {
        run: () => { if (N.viewRestore) N.viewRestore(N.doc, v.name); }
      });
    }
    const rc = anchorItem.getBoundingClientRect();
    document.body.appendChild(s);
    s.style.left = Math.round(rc.right + 1) + 'px';
    s.style.top = Math.round(Math.min(rc.top - 4,
      window.innerHeight - s.offsetHeight - 6)) + 'px';
    subEl = s;
  };

  const openViewMenu = (anchor) => {
    if (menuEl) { closeMenu(); return; }
    const m = menuBox('view3d-menu');
    const cur = currentKey();
    const saved = (N.doc && Array.isArray(N.doc.views)) ? N.doc.views : [];
    menuItem(m, 'Custom Model Views', saved.length
      ? { arrow: true, enter: (it) => openSub(it, saved) }
      : { arrow: true, disabled: true });
    menuSep(m);
    for (const [key, label] of VIEWS) {
      menuItem(m, label, { checked: key === cur, run: () => setView(key) });
    }
    menuSep(m);
    menuItem(m, 'View Manager...', {
      run: () => {
        if (N.viewMgrUI) N.viewMgrUI.open();
        else if (N.cmd && N.cmd.execute) N.cmd.execute('VIEW');
      }
    });
    menuSep(m);
    const persp = !!(N.view3d && N.view3d.persp);
    const project = (on) => {
      if (N.cmd && N.cmd.execute) N.cmd.execute('PERSPECTIVE ' + (on ? 1 : 0));
      else if (N.setPerspective) N.setPerspective(on);
    };
    menuItem(m, 'Parallel', { checked: !persp, run: () => project(false) });
    menuItem(m, 'Perspective', { checked: persp, run: () => project(true) });
    const rc = anchor.getBoundingClientRect();
    m.style.left = Math.round(rc.left) + 'px';
    m.style.top = Math.round(rc.bottom + 4) + 'px';
    document.body.appendChild(m);
    menuEl = m;
    document.addEventListener('pointerdown', onAway, true);
  };

  /* [Top] viewport-label segment: intercept in the capture phase so app.js's
     "3D views aren't available" placeholder menu never opens */
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains('vp-seg')) return;
    if (!t.dataset || t.dataset.menu !== 'vpview') return;
    e.stopPropagation();
    e.preventDefault();
    openViewMenu(t);
  }, true);

  /* ================================================================
     View navigator — a tilted ground disc with axis beads, rendered on
     canvas with the engine's own azimuth/elevation (dial-and-bead
     orientation widgets are decades-old prior art; deliberately NOT a
     picking cube):
     - six axis balls (±X ±Y ±Z) with hover highlight; a click glides
       the camera down that axis (Top/Bottom/Front/Back/Left/Right)
     - the ±X/±Y beads sit on a ground ring; dragging the ring is a
       constrained turntable spin (azimuth only) that snaps near 45°
     - four small diagonal pips (hover) for the isometric views
     - drag anywhere else on the widget to orbit freely
     ================================================================ */
  const vcCanvas = document.querySelector('#viewcube .vc-canvas');
  const vcCtx = vcCanvas ? vcCanvas.getContext('2d') : null;
  const VC_S = 120;      /* css size (backing store 240 = 2x) */
  const CUBE_PX = 25;    /* projection scale: px per axis unit */

  const AXES = [
    { dir: [1, 0, 0], col: '#e0564a', lab: 'X' },
    { dir: [0, 1, 0], col: '#77bb41', lab: 'Y' },
    { dir: [0, 0, 1], col: '#4f8ce8', lab: 'Z' }
  ];
  const BALL_R = 1.62;   /* axis-ball distance from center, axis units */
  const ISO_R = 1.02;    /* iso-pip distance — inside the balls, clear of them */
  const ISO_DIRS = [[1, 1, 1], [-1, 1, 1], [-1, -1, 1], [1, -1, 1]];
  const VIEW_NAME = {
    'ax:0,0,1': 'Top', 'ax:0,0,-1': 'Bottom', 'ax:0,-1,0': 'Front',
    'ax:0,1,0': 'Back', 'ax:1,0,0': 'Right', 'ax:-1,0,0': 'Left',
    'iso:1,1,1': 'NE Isometric', 'iso:-1,1,1': 'NW Isometric',
    'iso:-1,-1,1': 'SW Isometric', 'iso:1,-1,1': 'SE Isometric'
  };

  let vcHover = null;      /* hovered region key */
  let vcOver = false;      /* pointer anywhere over the widget */
  let vcRegions = [];      /* [{key, dir, path}] rebuilt on every render */
  let vcDrag = null;
  let vcRingPath = null;   /* the ground ring's hit path, css px */
  let vcRingHover = false;
  let vcCenter = { x: VC_S / 2, y: VC_S / 2 + 3 };
  let vcTweenId = 0;       /* cancels an in-flight camera glide */

  const vcOrient = () => {
    const v = N.view3d;
    return (v && v.active)
      ? { az: v.azimuth, el: v.elevation, roll: v.roll || 0 }
      : { az: 0, el: Math.PI / 2, roll: 0 };
  };

  /* engine-matching orthographic projection (see engine worldToView3) */
  const vcProj = () => {
    const { az, el, roll } = vcOrient();
    const cA = Math.cos(az), sA = Math.sin(az);
    const cE = Math.cos(el), sE = Math.sin(el);
    const cR = Math.cos(roll), sR = Math.sin(roll);
    const C = VC_S / 2;
    const P = (p) => {
      const x = (p[0] * cA + p[1] * sA) * CUBE_PX;
      const y = ((-p[0] * sA + p[1] * cA) * sE + p[2] * cE) * CUBE_PX;
      return { x: C + x * cR - y * sR, y: C + 3 - (x * sR + y * cR) };
    };
    const depth = (p) => p[0] * sA * cE - p[1] * cA * cE + p[2] * sE;
    return { P, depth, dir: [sA * cE, -cA * cE, sE] };
  };

  const vcRegionFor = (key, dir) => {
    let r = vcRegions.find((x) => x.key === key);
    if (!r) {
      r = { key, dir, path: new Path2D() };
      vcRegions.push(r);
    }
    return r;
  };

  const renderCube = () => {
    if (!vcCtx) return;
    const g = vcCtx;
    const { P, depth } = vcProj();
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, VC_S, VC_S);
    vcRegions = [];

    const C = P([0, 0, 0]);
    const tint = (hex, f, a) => {
      const n = parseInt(hex.slice(1), 16);
      const ch = (v) => Math.max(0, Math.min(255, (v * f) | 0));
      return 'rgba(' + ch(n >> 16) + ',' + ch((n >> 8) & 255) + ',' + ch(n & 255) +
        ',' + (a == null ? 1 : a) + ')';
    };
    const shade = (hex, f) => tint(hex, f);
    /* a lit sphere: radial gradient with the highlight up-left */
    const sphere = (x, y, r, col, dim) => {
      const gr = g.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.12, x, y, r * 1.15);
      gr.addColorStop(0, shade(col, dim ? 1.12 : 1.42));
      gr.addColorStop(0.55, shade(col, dim ? 0.82 : 1.0));
      gr.addColorStop(1, shade(col, dim ? 0.5 : 0.62));
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = gr;
      g.fill();
    };

    /* soft backdrop disc while the pointer is over the widget */
    if (vcOver) {
      const bg = g.createRadialGradient(C.x, C.y, 10, C.x, C.y, 55);
      bg.addColorStop(0, 'rgba(140,150,162,.20)');
      bg.addColorStop(1, 'rgba(140,150,162,.05)');
      g.beginPath(); g.arc(C.x, C.y, 55, 0, Math.PI * 2);
      g.fillStyle = bg; g.fill();
    }

    /* gather every ball, then draw back-to-front for a 3D read;
       balls swell toward the eye and shrink away from it */
    const items = [];
    for (const ax of AXES) {
      const d = ax.dir;
      items.push({ kind: 'pos', ax, dir: d, r: 9.5,
        d3: [d[0], d[1], d[2]], p: P([d[0] * BALL_R, d[1] * BALL_R, d[2] * BALL_R]) });
      items.push({ kind: 'neg', ax, dir: [-d[0], -d[1], -d[2]], r: 7,
        d3: [-d[0], -d[1], -d[2]], p: P([-d[0] * BALL_R, -d[1] * BALL_R, -d[2] * BALL_R]) });
    }
    /* the iso pips fade in when the pointer arrives — idle, the widget
       is just the clean triad */
    if (vcOver) {
      for (const d of ISO_DIRS) {
        const L = Math.hypot(d[0], d[1], d[2]);
        const u = [d[0] / L, d[1] / L, d[2] / L];
        items.push({ kind: 'iso', dir: d.slice(), r: 4,
          d3: u, p: P([u[0] * ISO_R, u[1] * ISO_R, u[2] * ISO_R]) });
      }
    }
    for (const it of items) {
      it.z = depth(it.d3);
      it.r = it.r * (1 + 0.14 * it.z);
    }
    items.sort((a, b) => a.z - b.z);

    /* ---- ground ring in the z=0 plane; the ±X/±Y beads sit on it ----
       far half drawn faint, near half solid; brighter under the pointer */
    vcCenter = C;
    const RSEG = 72;
    const rpts = [], rdep = [];
    for (let i = 0; i <= RSEG; i++) {
      const a = (i / RSEG) * Math.PI * 2;
      rpts.push(P([Math.cos(a) * BALL_R, Math.sin(a) * BALL_R, 0]));
      rdep.push(depth([Math.cos(a), Math.sin(a), 0]));
    }
    vcRingPath = new Path2D();
    for (let i = 0; i <= RSEG; i++) {
      if (i) vcRingPath.lineTo(rpts[i].x, rpts[i].y);
      else vcRingPath.moveTo(rpts[i].x, rpts[i].y);
    }
    const ringLit = vcRingHover || (vcDrag && vcDrag.mode === 'ring');
    const ringRuns = (front) => {
      g.beginPath();
      let open = false;
      for (let i = 0; i <= RSEG; i++) {
        if ((rdep[i] > -1e-9) === front) {
          if (open) g.lineTo(rpts[i].x, rpts[i].y);
          else { g.moveTo(rpts[i].x, rpts[i].y); open = true; }
        } else open = false;
      }
      g.stroke();
    };
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(150,158,168,' + (ringLit ? 0.4 : 0.25) + ')';
    ringRuns(false);
    g.lineWidth = ringLit ? 2.6 : 2;
    g.strokeStyle = 'rgba(163,171,181,' + (ringLit ? 0.95 : 0.6) + ')';
    ringRuns(true);

    sphere(C.x, C.y, 3, '#9aa3ad', false);

    for (const it of items) {
      const key = (it.kind === 'iso' ? 'iso:' : 'ax:') + it.dir.join(',');
      const front = it.z > 0;
      const hov = vcHover === key;
      const hit = new Path2D();
      hit.arc(it.p.x, it.p.y, it.r + (it.kind === 'iso' ? 1.5 : 3), 0, Math.PI * 2);
      const rg = vcRegionFor(key, it.dir);
      rg.path.addPath(hit);
      rg.ctr = it.p;                    /* css px, for the QA surface */

      const r = hov ? it.r + 1.5 : it.r;
      g.shadowColor = 'rgba(0,0,0,.4)';
      g.shadowBlur = 3.5;
      g.shadowOffsetY = 1.2;
      if (it.kind === 'iso') {
        sphere(it.p.x, it.p.y, r, hov ? '#e8edf2' : '#8d97a2', !front && !hov);
      } else if (it.kind === 'pos') {
        sphere(it.p.x, it.p.y, r, it.ax.col, !front && !hov);
      } else {
        /* negative ball: the axis colour, faded — solid on hover */
        g.beginPath();
        g.arc(it.p.x, it.p.y, r, 0, Math.PI * 2);
        g.fillStyle = tint(it.ax.col, front ? 0.62 : 0.42, hov ? 0.95 : 0.55);
        g.fill();
        g.shadowColor = 'transparent';
        g.strokeStyle = tint(it.ax.col, front || hov ? 1.0 : 0.65, 0.9);
        g.lineWidth = 1.6;
        g.stroke();
      }
      g.shadowColor = 'transparent';
      g.shadowBlur = 0;
      g.shadowOffsetY = 0;
      if (hov) {
        g.beginPath(); g.arc(it.p.x, it.p.y, r + 1.8, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.4; g.stroke();
      }
      if (it.kind === 'pos') {
        g.font = '700 11px "Segoe UI", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = 'rgba(10,14,18,.78)';
        g.fillText(it.ax.lab, it.p.x, it.p.y + 0.5);
      }
    }

    /* the view the hovered ball would set, spelled out under the gizmo */
    if (vcHover && VIEW_NAME[vcHover]) {
      g.font = '600 10px "Segoe UI", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      const t = VIEW_NAME[vcHover];
      const w = g.measureText(t).width + 12;
      g.beginPath();
      if (g.roundRect) g.roundRect(C.x - w / 2, VC_S - 16, w, 15, 7);
      else g.rect(C.x - w / 2, VC_S - 16, w, 15);
      g.fillStyle = 'rgba(24,28,33,.88)';
      g.fill();
      g.fillStyle = '#dde3ea';
      g.fillText(t, C.x, VC_S - 5);
    }
  };

  /* shortest signed angular distance */
  const vcWrap = (a) => {
    a = a % (Math.PI * 2);
    if (a > Math.PI) a -= Math.PI * 2;
    if (a < -Math.PI) a += Math.PI * 2;
    return a;
  };

  /* glide the camera to (az, el, roll — default 0) over a short eased
     sweep, then hand off to `land` for the exact final state */
  const vcGlide = (az1, el1, land, ms, roll1) => {
    const o = vcOrient();
    const dAz = vcWrap(az1 - o.az), dEl = el1 - o.el,
      dR = vcWrap((roll1 || 0) - (o.roll || 0));
    if (Math.abs(dAz) < 1e-9 && Math.abs(dEl) < 1e-9 && Math.abs(dR) < 1e-9) {
      land();
      return;
    }
    const id = ++vcTweenId;
    const t0 = performance.now();
    const dur = ms || 180;
    const step = (now) => {
      if (id !== vcTweenId) return;
      const t = Math.min(1, (now - t0) / dur);
      if (t >= 1) { land(); return; }
      const k = 1 - Math.pow(1 - t, 3);
      N.orientView(o.az + dAz * k, o.el + dEl * k, (o.roll || 0) + dR * k);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /* region -> view orientation (dir is the viewer direction). A real
     pointer gets the glide; synthetic events (QA scripts) jump straight
     there so assertions can read the result in the same tick. */
  const vcApply = (r, animate) => {
    const d = r.dir;
    const top = d[0] === 0 && d[1] === 0 && d[2] === 1;
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    const az = top ? 0 : Math.atan2(d[0], -d[1]);
    const el = top ? Math.PI / 2 : Math.asin(d[2] / L);
    const land = () => {
      if (top) setView('top');
      else if (typeof N.orientView === 'function') N.orientView(az, el, 0);
    };
    if (animate && typeof N.orientView === 'function') vcGlide(az, el, land);
    else land();
  };

  /* x, y = css px from the canvas's top-left; the paths are drawn in that
     same space and the context carries the 2x backing-store transform */
  const vcHitAt = (x, y) => {
    for (let i = vcRegions.length - 1; i >= 0; i--) {
      if (vcCtx.isPointInPath(vcRegions[i].path, x * 2, y * 2)) return vcRegions[i];
    }
    return null;
  };
  const vcLocal = (ev) => {
    const rc = vcCanvas.getBoundingClientRect();
    return { x: ev.clientX - rc.left, y: ev.clientY - rc.top };
  };
  const vcHit = (ev) => {
    if (!vcCanvas) return null;
    const l = vcLocal(ev);
    return vcHitAt(l.x, l.y);
  };
  const vcOnRing = (x, y) => {
    if (!vcRingPath) return false;
    vcCtx.lineWidth = 11;
    return vcCtx.isPointInStroke(vcRingPath, x * 2, y * 2);
  };
  /* pointer's angle around the widget center, y-up mathematical sense */
  const vcAngleAt = (x, y) => Math.atan2(-(y - vcCenter.y), x - vcCenter.x);

  if (vcCanvas && vcCtx) {
    vcCanvas.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      vcTweenId++;                       /* a grab cancels any glide */
      const o = vcOrient();
      const l = vcLocal(ev);
      if (!vcHitAt(l.x, l.y) && vcOnRing(l.x, l.y)) {
        vcDrag = { mode: 'ring', x: ev.clientX, y: ev.clientY,
          az: o.az, el: o.el, roll: o.roll || 0,
          a0: vcAngleAt(l.x, l.y), moved: false };
      } else {
        vcDrag = { mode: 'orbit', x: ev.clientX, y: ev.clientY,
          az: o.az, el: o.el, moved: false };
      }
      try { vcCanvas.setPointerCapture(ev.pointerId); } catch (_) { /* noop */ }
    });
    vcCanvas.addEventListener('pointerenter', () => {
      if (!vcOver) {
        vcOver = true;
        renderCube();
      }
    });
    vcCanvas.addEventListener('pointermove', (ev) => {
      if (vcDrag && vcDrag.mode === 'ring') {
        /* turntable: spin the azimuth by the pointer's sweep around the
           center; edge-on (elevation near 0) falls back to horizontal
           pixels, where the sweep angle degenerates */
        const l = vcLocal(ev);
        const dx = ev.clientX - vcDrag.x, dy = ev.clientY - vcDrag.y;
        if (!vcDrag.moved && Math.hypot(dx, dy) <= 3) return;
        vcDrag.moved = true;
        if (typeof N.orientView !== 'function') return;
        const sE = Math.sin(vcDrag.el);
        const az = (Math.abs(sE) < 0.15)
          ? vcDrag.az + dx * 0.01
          : vcDrag.az + (sE >= 0 ? -1 : 1) * vcWrap(vcAngleAt(l.x, l.y) - vcDrag.a0);
        N.orientView(az, vcDrag.el, vcDrag.roll);
        return;
      }
      if (vcDrag) {
        const dx = ev.clientX - vcDrag.x, dy = ev.clientY - vcDrag.y;
        if (vcDrag.moved || Math.hypot(dx, dy) > 3) {
          vcDrag.moved = true;
          if (typeof N.orientView === 'function') {
            N.orientView(vcDrag.az + dx * 0.012, vcDrag.el + dy * 0.012);
          }
        }
        return;
      }
      const l = vcLocal(ev);
      const r = vcHitAt(l.x, l.y);
      const key = r ? r.key : null;
      const onRing = !r && vcOnRing(l.x, l.y);
      if (key !== vcHover || onRing !== vcRingHover) {
        vcHover = key;
        vcRingHover = onRing;
        vcCanvas.style.cursor = key ? 'pointer' : (onRing ? 'grab' : '');
        renderCube();
      }
    });
    vcCanvas.addEventListener('pointerup', (ev) => {
      const drag = vcDrag;
      vcDrag = null;
      try { vcCanvas.releasePointerCapture(ev.pointerId); } catch (_) { /* noop */ }
      if (drag && drag.moved) {
        /* a turntable spin released near a 45° stop settles onto it */
        if (drag.mode === 'ring' && typeof N.orientView === 'function') {
          const o = vcOrient();
          const q = Math.round(o.az / (Math.PI / 4)) * (Math.PI / 4);
          if (Math.abs(vcWrap(o.az - q)) < Math.PI / 24) {
            const rl = o.roll || 0;
            vcGlide(q, o.el, () => N.orientView(q, o.el, rl), 120, rl);
          }
        }
        return;
      }
      const r = vcHit(ev);
      if (r) vcApply(r, ev.isTrusted);
    });
    vcCanvas.addEventListener('pointerleave', () => {
      if (vcHover || vcOver || vcRingHover) {
        vcHover = null;
        vcOver = false;
        vcRingHover = false;
        vcCanvas.style.cursor = '';
        renderCube();
      }
    });
    renderCube();

    /* QA/scripting surface (like Nasj.ucsUi and glscene's status). The
       gizmo is a canvas and its zones are Path2D regions, so there is no
       element to click and no text to read: compass() maps the horizontal
       axis balls onto the four compass letters — css px from the canvas's
       top-left, which is what a pointer event measures from — and
       regionAt() says what lies under a point. A script aims with those
       and then presses the canvas for real, through the widget's own
       handlers, instead of a stand-in. */
    const COMPASS_KEYS = [
      ['N', 'ax:0,1,0'], ['E', 'ax:1,0,0'], ['S', 'ax:0,-1,0'], ['W', 'ax:-1,0,0']
    ];
    N.viewCube = {
      canvas: vcCanvas,
      compass: () => COMPASS_KEYS
        .map(([letter, key]) => {
          const r = vcRegions.find((x) => x.key === key);
          return r && r.ctr ? { letter, x: r.ctr.x, y: r.ctr.y } : null;
        })
        .filter(Boolean),
      regionAt: (x, y) => {
        const r = vcHitAt(x, y);
        return r ? r.key : null;
      },
    };
  }

  /* home: top view + zoom extents (the industry standard's home glyph) */
  const homeBtn = document.querySelector('#viewcube .vc-home');
  if (homeBtn) {
    homeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setView('top');
      const vp = N.viewport;
      if (vp && typeof vp.zoomExtents === 'function') vp.zoomExtents();
      if (N.render) N.render();
    });
  }

  /* curved arrows: spin the view 90° per click */
  const roll = (sel, delta) => {
    const b = document.querySelector('#viewcube ' + sel);
    if (!b) return;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof N.rollView === 'function') N.rollView(delta);
    });
  };
  roll('.vc-rl', Math.PI / 2);
  roll('.vc-rr', -Math.PI / 2);

  /* ---------------- label + cube sync on engine 'nasj:view3d' ------------ */
  const seg = document.querySelector('#vp-label .vp-seg[data-menu="vpview"]');
  window.addEventListener('nasj:view3d', (e) => {
    const d = (e && e.detail) || {};
    const key = !d.active ? 'top' : (LABEL[d.view] ? d.view : 'custom');
    if (seg) seg.textContent = '[' + LABEL[key] + ']';
    renderCube();
  });
})();
