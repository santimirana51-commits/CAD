/* Nasjicad — touch.js. Fingers on the drawing.
 *
 * The engine speaks pointer events, and a browser does send those for touch —
 * but only until it decides the gesture was meant for it. One finger dragged
 * across a canvas with the default `touch-action` gets exactly one
 * pointermove and then a pointercancel: the page claims the drag as a scroll
 * and the drawing never moves. app.css pins `touch-action: none` on the two
 * canvases, which is what stops that.
 *
 * That alone makes a finger behave like a left button, which is right for
 * picking and wrong for looking around — there is no middle button on a
 * touchscreen, and the middle button is what pans. So this file owns touch on
 * the drawing surface outright: touchstart is prevented, no compatibility
 * mouse events are synthesised behind our back, and every gesture is decided
 * here.
 *
 * With no command running:
 *   one finger, moved      pan          (the common case: looking around)
 *   one finger, still      a click      (replayed to the engine: picking)
 *   two taps, quick        a double-click (text and hatch editing)
 *   one finger, held       a right-click (the context menu — Enter, Cancel,
 *                                        the last command — for a screen
 *                                        with no right button)
 *   two fingers            pinch zoom, and pan by their midpoint
 *
 * While a tool waits for a point (or a selection pick) the one finger is
 * the pointer, not the hand that moves the paper:
 *   one finger, quick tap  the point, where it tapped (snap applied)
 *   one finger, moved or   PLACING: the pick point rides 64px above the
 *     held past 250ms      finger — a ring marks it, object snaps take it
 *                          at a wider aperture, a loupe above-left shows
 *                          the drawing around it at twice the size, and
 *                          the tool's rubber band follows it (engine.js
 *                          drawTouchPick draws the chrome). Lifting
 *                          commits the point, snap and all.
 *   two fingers            still pinch and pan — a second finger drops
 *                          the placing and commits nothing
 * A tap commits blind; the drag is how a finger sees what it is doing.
 * A finger never gets a crosshair at all (engine.js: lastPointerType).
 *
 * Coarse pointers — a phone or a tablet, by the media query — also get
 * the action bar (Enter, Esc, Undo, a number pad that types into the
 * command line, the prompt's [options] as chips, a ⊞ that opens the
 * command palette and a ⋯ menu) and the html.coarse class that sizes the
 * chrome for fingers. The command line itself raises no system keyboard
 * on a tap — it is read-only until the ⌨ asks for one, or a prompt for
 * free text takes one — and a tap on it opens the palette (nothing
 * running) or the pad (a tool waiting). Nasj.touchMode(true|false|null)
 * forces or releases all of it, for the QA harness and for screenshots.
 *
 * A coarse pointer on a SMALL screen — a phone, narrow or short — gets
 * the focus layout as well (html.focus, at the end of this file): one
 * drawing surface with the chrome cut to a status strip, a round agent
 * button and a ribbon that opens as a sheet of tiles; while a tool runs
 * (html.drawing) the tab row goes too. Nasj.focusMode(true|false|null)
 * forces or releases it.
 *
 * A tap is replayed rather than passed through because the alternative is
 * both things happening at once — the engine starting a selection window on
 * the same finger this file is panning with. And it is not enough to replay
 * it: the browser raises a pointerdown for the real finger too, before this
 * file has decided anything, so every pan used to plant a tool's first point
 * and every tap arrived at the engine twice. A real touch pointer is now
 * stopped at the canvas door (capture phase, the overlay itself) and only the
 * replayed one, flagged, gets through. Pen and mouse pass untouched — a
 * stylus already behaves like a mouse, and a mouse is what the engine wants.
 *
 * Loaded in both hosts. A machine with no touchscreen never fires one of
 * these listeners; a Windows laptop with one gets the same gestures the web
 * build gets.
 */
(() => {
  'use strict';

  /* a finger that travels under this is a tap, not a drag */
  const TAP_SLOP = 10;      /* px */
  const HOLD_MS = 550;      /* still this long: a right-click */
  const DBL_MS = 320;       /* two taps this close: a double-click */
  const DBL_SLOP = 24;      /* ...and this near each other */
  /* placing a point (a tool is waiting): a tighter tap, and past it the
     pick point rides above the finger */
  const PLACE_SLOP = 8;     /* px: moved more than this and it is placing */
  const PLACE_MS = 250;     /* still longer than this: placing too */
  const PLACE_LIFT = 64;    /* css px: the pick point sits this far above the finger */

  const init = () => {
    const overlay = document.getElementById('overlay-canvas');
    if (!overlay) return;

    /* The real finger's pointer events stop here. The engine's listeners
       sit on this same element in the bubble phase, and the capture phase
       runs first at the target, so stopping immediate propagation keeps
       them out; document-level capture listeners (menus that close on a
       pointerdown anywhere) have already had theirs. */
    const gate = (ev) => {
      if (ev.pointerType === 'touch' && !ev.__nasjReplay) ev.stopImmediatePropagation();
    };
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel',
      'pointerenter', 'pointerleave', 'pointerover', 'pointerout']
      .forEach((t) => overlay.addEventListener(t, gate, true));

    const vp = () => (window.Nasj && window.Nasj.viewport) || null;
    const pts = new Map();          /* identifier -> {x, y} in canvas space */
    let mode = null;                /* 'pan' | 'pinch' */
    let last = null;                /* last anchor: the finger, or the midpoint */
    let lastGap = 0;                /* finger separation, for the zoom ratio */
    let travelled = 0;
    let startedAt = 0;
    let tapAt = null;
    let holdTimer = 0;
    let held = false;               /* the hold fired: the lift is not a tap */
    let prevTap = null;             /* {x, y, t} of the last tap, for doubles */

    /* where the canvas sits on the page — read once per gesture, not once
       per finger per move. getBoundingClientRect forces a layout whenever
       something has dirtied one, and the coordinate readout the pan feeds
       dirties one every frame: a two-finger drag was paying four layouts
       a frame for a rectangle that does not move while a finger is down.
       It is forgotten whenever a finger lands (the touch may close a menu
       and shift the page) and when the last one lifts. */
    let rect = null;
    const rectOf = () => rect || (rect = overlay.getBoundingClientRect());
    const local = (t) => {
      const r = rectOf();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const clientOf = (p) => {
      const r = rectOf();
      return { clientX: r.left + p.x, clientY: r.top + p.y };
    };
    const stopHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; } };

    /* The viewport's panBy and zoomAt move the view and paint nothing —
       every mouse path in the engine follows them with a render, and so
       must this one, or a finger drags the view and the picture stays put
       until something else happens to repaint. The engine is also told a
       hand is on the screen, so its idle warm-up waits instead of
       competing with the gesture for the thread, as it does for a mouse. */
    const paint = () => {
      const N = window.Nasj;
      if (typeof N.interacting === 'function') N.interacting();
      if (typeof N.render === 'function') N.render();
      if (typeof N.renderOverlay === 'function') N.renderOverlay();
    };

    /* the engine never saw the finger, so a tap is handed to it as the click
       it was — same element, same coordinates, pointerType 'touch'. The move
       goes first: it is what puts the cursor, the snap marker and the
       tracking where the finger is, so the down that follows picks the
       point a mouse would have. */
    const replay = (type, p, extra) => {
      const ev = new PointerEvent(type, Object.assign({
        bubbles: true, cancelable: true,
        pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: 0,
      }, clientOf(p), extra || {}));
      ev.__nasjReplay = true;
      overlay.dispatchEvent(ev);
    };
    const replayTap = (p) => {
      replay('pointermove', p);
      replay('pointerdown', p, { buttons: 1 });
      replay('pointerup', p);
    };

    /* ---- placing a point: the finger is the pointer ---- */
    let placeTimer = 0;
    let pick = null;                /* the pick point, canvas space */
    const N = () => window.Nasj || {};
    /* a tool is waiting for a point or a pick, so the finger places and
       does not pan. The select tool with nothing running says 'none'; a
       grip it has picked up, or a command's Select objects:, say 'point'. */
    const waiting = () => {
      const t = N().tools;
      return !!(t && t.awaiting && t.awaiting !== 'none');
    };
    const stopPlaceTimer = () => { if (placeTimer) { clearTimeout(placeTimer); placeTimer = 0; } };
    const movePlace = (f) => {
      pick = { x: f.x, y: f.y - PLACE_LIFT };
      const n = N();
      if (n.ui) n.ui.touchPick = { screen: pick, finger: { x: f.x, y: f.y } };
      if (typeof n.interacting === 'function') n.interacting();
      /* the engine snaps, tracks and rubber-bands to the pick point as it
         would to a mouse there, and paints the marker and the loupe */
      replay('pointermove', pick);
    };
    const beginPlace = (f) => {
      stopPlaceTimer();
      stopHold();
      mode = 'place';
      tapAt = null;
      document.body.classList.add('touch-placing');   /* the action bar steps aside */
      movePlace(f);
    };
    /* the finger lifts (commit) — or a second finger lands, or the system
       takes the touch (abandon: nothing is committed) */
    const endPlace = (commit) => {
      stopPlaceTimer();
      const p = pick;
      pick = null;
      document.body.classList.remove('touch-placing');
      const n = N();
      if (n.ui) n.ui.touchPick = null;
      if (commit && p) {
        /* the down flushes the last queued move first, so the point it
           computes is the one the marker showed — snap included */
        replay('pointerdown', p, { buttons: 1 });
        replay('pointerup', p);
      } else if (typeof n.renderOverlay === 'function') n.renderOverlay();
    };

    overlay.addEventListener('touchstart', (ev) => {
      ev.preventDefault();
      rect = null;
      for (const t of ev.changedTouches) pts.set(t.identifier, local(t));
      const all = [...pts.values()];
      stopHold();
      held = false;
      if (pts.size === 1) {
        last = all[0];
        tapAt = all[0];
        travelled = 0;
        startedAt = Date.now();
        /* touching the drawing is a click anywhere else in the program:
           the menu that was open closes, the ribbon that was peeking goes
           back up. With touchstart prevented no mousedown comes on its
           own, so the one those listeners wait for is raised here. */
        overlay.dispatchEvent(new MouseEvent('mousedown', Object.assign({
          bubbles: true, cancelable: true, button: 0, buttons: 1,
        }, clientOf(all[0]))));
        rect = null;                /* whatever that closed may have moved us */
        if (waiting()) {
          /* a tool wants a point: a quick tap gives it one where it
             tapped; anything longer or wider is placing. No right-click
             here — the bar has Enter and Esc, and a hold keeps the loupe */
          mode = 'arm';
          placeTimer = setTimeout(() => {
            placeTimer = 0;
            if (mode === 'arm' && pts.size === 1) beginPlace(last);
          }, PLACE_MS);
        } else {
          mode = 'pan';
          /* a finger held still is the right button: the context menu that
             carries Enter, Cancel and the last command */
          holdTimer = setTimeout(() => {
            holdTimer = 0;
            if (mode !== 'pan' || pts.size !== 1 || travelled > TAP_SLOP) return;
            held = true;
            tapAt = null;
            overlay.dispatchEvent(new MouseEvent('contextmenu', Object.assign({
              bubbles: true, cancelable: true, button: 2,
            }, clientOf(all[0]))));
          }, HOLD_MS);
        }
      } else if (pts.size >= 2) {
        /* a second finger: the placing is dropped, nothing is committed */
        if (mode === 'arm' || mode === 'place') endPlace(false);
        mode = 'pinch';
        last = mid(all[0], all[1]);
        lastGap = gap(all[0], all[1]);
        tapAt = null;               /* two fingers is never a tap */
      }
    }, { passive: false });

    overlay.addEventListener('touchmove', (ev) => {
      ev.preventDefault();
      const v = vp();
      for (const t of ev.changedTouches) {
        if (pts.has(t.identifier)) pts.set(t.identifier, local(t));
      }
      if (!v) return;
      const all = [...pts.values()];
      if ((mode === 'arm' || mode === 'place') && all.length === 1) {
        const f = all[0];
        travelled += Math.hypot(f.x - last.x, f.y - last.y);
        last = f;
        if (mode === 'place') movePlace(f);
        else if (travelled > PLACE_SLOP) beginPlace(f);
        return;
      }
      if (mode === 'pan' && all.length === 1) {
        const dx = all[0].x - last.x, dy = all[0].y - last.y;
        travelled += Math.hypot(dx, dy);
        /* hold still until it is clearly a drag, so a tap does not nudge */
        if (travelled > TAP_SLOP) { stopHold(); v.panBy(dx, dy); paint(); }
        last = all[0];
      } else if (mode === 'pinch' && all.length >= 2) {
        const m = mid(all[0], all[1]);
        const g = gap(all[0], all[1]);
        if (lastGap > 0 && g > 0) v.zoomAt(m.x, m.y, g / lastGap);
        v.panBy(m.x - last.x, m.y - last.y);
        last = m;
        lastGap = g;
        paint();
      }
    }, { passive: false });

    const lift = (ev) => {
      ev.preventDefault();
      stopHold();
      for (const t of ev.changedTouches) pts.delete(t.identifier);
      const now = Date.now();
      if ((mode === 'place' || mode === 'arm') && pts.size === 0) {
        const cancelled = ev.type === 'touchcancel';
        if (mode === 'place') endPlace(!cancelled);
        else {
          /* a quick tap while a tool waits: the point, where it tapped */
          stopPlaceTimer();
          if (!cancelled && tapAt && travelled <= PLACE_SLOP) replayTap(tapAt);
        }
        mode = null; last = null; tapAt = null; held = false; rect = null;
        return;
      }
      const still = travelled <= TAP_SLOP && (now - startedAt) < HOLD_MS;
      if (mode === 'pan' && tapAt && still && !held && pts.size === 0) {
        replayTap(tapAt);
        /* a second tap on the same spot, quickly: the double-click that
           opens text and hatches for editing */
        if (prevTap && now - prevTap.t < DBL_MS && gap(prevTap, tapAt) < DBL_SLOP) {
          overlay.dispatchEvent(new MouseEvent('dblclick', Object.assign({
            bubbles: true, cancelable: true, button: 0,
          }, clientOf(tapAt))));
          prevTap = null;
        } else prevTap = { x: tapAt.x, y: tapAt.y, t: now };
      }

      const all = [...pts.values()];
      if (all.length === 0) { mode = null; last = null; tapAt = null; held = false; rect = null; }
      else if (all.length === 1) {
        /* a pinch that lost a finger carries on as a pan, without the
           leftover becoming a stray tap */
        mode = 'pan'; last = all[0]; tapAt = null; travelled = TAP_SLOP + 1;
      } else {
        last = mid(all[0], all[1]);
        lastGap = gap(all[0], all[1]);
      }
    };
    overlay.addEventListener('touchend', lift, { passive: false });
    overlay.addEventListener('touchcancel', lift, { passive: false });

    /* ---- coarse pointers: the action bar, and chrome sized for fingers ----
       Enter, Esc and a typed distance need a keyboard a phone has to be
       asked for; the bar answers without one. It types into the command
       line and presses its keys, so every prompt reads it exactly as it
       reads a keyboard — a bare number is a distance, "@10<45" a polar
       coordinate, "U" the tool's own undo. */
    let bar = null;
    const cmdInput = () => document.getElementById('command-input');
    const typed = (i) => i.dispatchEvent(new Event('input', { bubbles: true }));
    const press = (key) => {
      const i = cmdInput();
      if (i) i.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    };
    const typeText = (ch) => {
      const i = cmdInput();
      if (!i) return;
      i.value = ch === '⌫' ? i.value.slice(0, -1) : i.value + ch;
      typed(i);
    };
    /* a whole line, the way the Text Window routes one: what was half
       typed in the line survives the detour */
    const routeText = (t) => {
      const i = cmdInput();
      if (!i) return;
      const pending = i.value;
      i.value = t;
      typed(i);
      press('Enter');
      if (pending && !i.value) { i.value = pending; typed(i); }
    };
    const awaitingNow = () => { const t = N().tools; return (t && t.awaiting) || 'none'; };
    /* Enter with nothing running repeats the last command, as a keyboard's
       does — except one that opens or closes a drawing: on a phone the last
       command is usually NEW (the toolbar's new-drawing button), and a ✓
       tapped after it made Drawing2 must not make Drawing3 */
    const NO_REPEAT = new Set(['NEW', 'OPEN', 'CLOSE', 'CLOSEALL', 'SAVEAS', 'QUIT']);
    const act = {
      enter: () => {
        const last = N().cmd && N().cmd.lastCommand;
        if (awaitingNow() === 'none' && last && NO_REPEAT.has(String(last).toUpperCase())) return;
        press('Enter');
      },
      esc: () => { press('Escape'); if (bar) bar.classList.remove('pad-open', 'more-open'); },
      undo: () => routeText('U'),
      /* the Delete key: the select tool erases what is selected */
      del: () => press('Delete'),
      num: () => { if (bar) { bar.classList.toggle('pad-open'); bar.classList.remove('more-open'); } placeBar(); },
      cmds: () => openPalette(),
      more: () => { if (bar) { bar.classList.toggle('more-open'); bar.classList.remove('pad-open'); } placeBar(); },
    };

    /* the bar floats over the drawing's bottom edge, above the command
       line — however tall the line is at the moment (a wrapped prompt on
       a phone, the history when it is open), and however far the system
       keyboard has lifted it */
    const placeBar = () => {
      if (!bar) return;
      const host = document.getElementById('viewport-container');
      const cp = document.getElementById('command-panel');
      let bottom = 8;
      if (host && cp && cp.offsetParent !== null) {
        const hr = host.getBoundingClientRect(), cr = cp.getBoundingClientRect();
        /* only a line docked along the bottom lifts the bar; one dragged
           elsewhere leaves the edge to the bar */
        if (cr.height > 0 && hr.bottom - cr.bottom < 60 + kbdLift) {
          bottom = Math.max(8, Math.round(hr.bottom - cr.top) + 8);
        }
      }
      bar.style.bottom = bottom + 'px';
    };
    const mkBtn = (cls, label, title, run) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.className = cls;
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', (e) => { e.preventDefault(); run(); });
      return b;
    };
    const GRID_SVG = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="6" height="6" rx="1.5"/>' +
      '<rect x="11.5" y="2.5" width="6" height="6" rx="1.5"/><rect x="2.5" y="11.5" width="6" height="6" rx="1.5"/>' +
      '<rect x="11.5" y="11.5" width="6" height="6" rx="1.5"/></svg>';
    const TRASH_SVG = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 5.5h14M7.5 5.5V3.5h5v2M5 5.5l1 11.5h8l1-11.5M8.5 9v5M11.5 9v5"/></svg>';
    const PAD_KEYS = ['7', '8', '9', '⌫', '4', '5', '6', '@', '1', '2', '3', '<', '0', '.', '-', ','];
    const buildBar = () => {
      if (bar) return;
      const host = document.getElementById('viewport-container');
      if (!host) return;
      bar = document.createElement('div');
      bar.id = 'touch-bar';
      const pad = document.createElement('div');
      pad.className = 'tb-pad';
      for (const k of PAD_KEYS) {
        pad.appendChild(mkBtn('tb-key' + (/\d/.test(k) ? '' : ' tb-sym'), k,
          k === '⌫' ? 'Backspace' : k, () => typeText(k)));
      }
      pad.appendChild(mkBtn('tb-key tb-ok', '✓', 'Enter', act.enter));
      /* the ⋯ menu: what the row has no room for */
      const menu = document.createElement('div');
      menu.className = 'tb-menu';
      const menuItem = (cls, glyph, label, run) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.tabIndex = -1;
        b.className = 'tb-mi ' + cls;
        b.innerHTML = '<span class="tb-mi-ic">' + glyph + '</span><span class="tb-mi-label"></span>' +
          '<span class="tb-mi-check">✓</span>';
        b.querySelector('.tb-mi-label').textContent = label;
        b.addEventListener('click', (e) => { e.preventDefault(); bar.classList.remove('more-open'); run(); });
        return b;
      };
      menu.appendChild(menuItem('tb-mi-cmds', GRID_SVG, 'Commands', openPalette));
      menu.appendChild(menuItem('tb-mi-kbd', '⌨', 'Keyboard', () => setKeyboard(!kbdWanted)));
      menu.appendChild(menuItem('tb-mi-hist', '≡', 'History', () => {
        const x = document.getElementById('cmd-expand');
        if (x) x.click();
      }));
      menu.appendChild(menuItem('tb-mi-opts', '⚙', 'Options', () => { if (N().cmd) N().cmd.execute('OPTIONS'); }));
      /* app.css lays the row out right to left (row-reverse), so its
         last child — the prompt's option chips — reads leftmost, beside
         ✓, and wraps to a line of its own above the buttons when the
         prompt has more options than the row has room for */
      const row = document.createElement('div');
      row.className = 'tb-row';
      row.appendChild(mkBtn('tb-btn tb-more', '⋯', 'More — Commands, Keyboard, History, Options', act.more));
      const cmds = mkBtn('tb-btn tb-cmds', '', 'Commands', act.cmds);
      cmds.innerHTML = GRID_SVG;
      row.appendChild(cmds);
      row.appendChild(mkBtn('tb-btn tb-num', '123', 'Type a distance, an angle or a coordinate', act.num));
      const del = mkBtn('tb-btn tb-del', '', 'Delete — erase the selection', act.del);
      del.innerHTML = TRASH_SVG;
      row.appendChild(del);
      row.appendChild(mkBtn('tb-btn tb-undo', '↶', 'Undo', act.undo));
      row.appendChild(mkBtn('tb-btn tb-esc', '✕', 'Cancel (Esc)', act.esc));
      row.appendChild(mkBtn('tb-btn tb-enter', '✓', 'Enter — accept / repeat', act.enter));
      const chips = document.createElement('div');
      chips.className = 'tb-chips empty';
      row.appendChild(chips);
      bar.appendChild(pad);
      bar.appendChild(menu);
      bar.appendChild(row);
      /* a tap on the bar must not take the focus — and the system
         keyboard with it — from wherever it was */
      bar.addEventListener('mousedown', (e) => e.preventDefault());
      host.appendChild(bar);
      syncKbdButtons();
      placeBar();
    };
    /* the ⋯ menu closes on a tap anywhere else */
    document.addEventListener('pointerdown', (e) => {
      if (bar && bar.classList.contains('more-open') &&
          !(e.target.closest && e.target.closest('.tb-menu, .tb-more'))) bar.classList.remove('more-open');
    }, true);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => placeBar());
      const cp = document.getElementById('command-panel');
      const host = document.getElementById('viewport-container');
      if (cp) ro.observe(cp);
      if (host) ro.observe(host);
    }
    window.addEventListener('nasj:tool', () => {
      /* the pad is for answering a tool: it goes when the tool does */
      if (bar && !toolRunning()) bar.classList.remove('pad-open');
      setTimeout(placeBar, 0);
    });
    window.addEventListener('resize', placeBar);

    /* ---- the prompt's options as chips ----
       "[Close/Undo]" in a prompt is a keyword list a keyboard answers with
       a letter; the bar shows each keyword as a chip that types the letter
       and Enter through the pad's own path. A Select objects: prompt takes
       ALL, Last and Previous whether or not it says so, and shows them.
       The chips are read off the prompt label whenever it changes, so
       they go the moment the prompt does. */
    const splitKw = (s) => {
      if (s.indexOf('/') >= 0) return s.split('/');
      const w = s.trim().split(/\s+/);
      return (w.length > 1 && w.every((t) => /[A-Z]/.test(t))) ? w : [s];
    };
    const kwAbbr = (kw) => (kw.match(/[A-Z0-9]/g) || []).join('') || kw.trim().split(/\s+/)[0];
    const promptChips = (text) => {
      const out = [];
      const m = /\[([^\]]*)\]/.exec(text || '');
      if (m && m[1]) {
        for (const kw of splitKw(m[1])) {
          const k = kw.trim();
          if (k) out.push({ label: k, type: kwAbbr(k) });
        }
      }
      if (/Select objects(:| or \[[^\]]*\]:)\s*$/.test(text || '')) {
        out.push({ label: 'All', type: 'ALL' }, { label: 'Last', type: 'L' }, { label: 'Previous', type: 'P' });
      }
      return out;
    };
    const promptLabel = () => document.getElementById('command-prompt-label');
    const renderChips = () => {
      if (!bar) return;
      const box = bar.querySelector('.tb-chips');
      const lab = promptLabel();
      const chips = promptChips(lab ? lab.textContent : '');
      box.textContent = '';
      for (const c of chips) box.appendChild(mkBtn('tb-chip', c.label, 'Option: ' + c.label, () => routeText(c.type)));
      box.classList.toggle('empty', !chips.length);
      placeBar();
    };

    /* ---- the command line without the system keyboard ----
       On a coarse pointer the line is read-only with inputmode=none: a tap
       raises no keyboard. It still takes focus and keys from the bar and
       the pad, which set its value and press Enter on it. The tap itself
       opens the palette while nothing runs, and the pad while a tool
       waits for a point, a value or a keyword. The keyboard comes two
       ways: the ⌨ (the palette's search row, the bar's ⋯ menu) keeps it
       until turned off; a prompt for free text — drawn text, a name —
       takes it for that prompt and gives it back after. A hardware
       keyboard's first letter unlocks the line too. */
    let kbdWanted = false;      /* the ⌨ */
    let kbdAuto = false;        /* a text prompt */
    const syncKbdButtons = () => {
      document.querySelectorAll('.tb-mi-kbd, .cp-kbd').forEach((b) => b.classList.toggle('on', kbdWanted));
    };
    const applyInputLock = () => {
      const i = cmdInput();
      if (!i) return;
      const lock = isCoarse() && !kbdWanted && !kbdAuto;
      i.readOnly = lock;
      if (isCoarse()) i.setAttribute('inputmode', lock ? 'none' : 'text');
      else i.removeAttribute('inputmode');
      i.classList.toggle('no-kbd', lock);
      syncKbdButtons();
    };
    const setKeyboard = (on) => {
      kbdWanted = !!on;
      applyInputLock();
      const i = cmdInput();
      if (!i) return;
      if (kbdWanted) i.focus();
      else if (!kbdAuto && document.activeElement === i) i.blur();
    };
    const autoKeyboard = () => {
      const want = awaitingNow() === 'string';
      if (want === kbdAuto) return;
      kbdAuto = want;
      applyInputLock();
      const i = cmdInput();
      if (!i) return;
      if (want) {
        /* not from a box that already has it — TEXT's own in-place box */
        const a = document.activeElement;
        if (!a || a === document.body || a === i) i.focus();
      } else if (!kbdWanted && document.activeElement === i) i.blur();
    };
    const tapInput = () => {
      const aw = awaitingNow();
      if (aw === 'none') { openPalette(); return; }
      if (aw === 'string') { kbdAuto = true; applyInputLock(); cmdInput().focus(); return; }
      if (bar && !bar.classList.contains('pad-open')) {
        bar.classList.add('pad-open');
        bar.classList.remove('more-open');
        placeBar();
      }
    };
    const wireInput = () => {
      const i = cmdInput();
      if (!i || i.__nasjTouch) return;
      i.__nasjTouch = true;
      const locked = () => isCoarse() && i.readOnly;
      const swallow = (e) => { if (locked()) e.preventDefault(); };
      i.addEventListener('pointerdown', swallow);
      i.addEventListener('mousedown', swallow);
      i.addEventListener('click', (e) => { if (!locked()) return; e.preventDefault(); tapInput(); });
    };
    window.addEventListener('keydown', (e) => {
      if (!isCoarse() || kbdWanted || kbdAuto) return;
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const other = t && t !== cmdInput() && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (!other) setKeyboard(true);
    }, true);
    const onPrompt = () => {
      if (!isCoarse()) return;
      renderChips();
      autoKeyboard();
    };
    const promptEl = promptLabel();
    if (promptEl && window.MutationObserver) {
      new MutationObserver(onPrompt).observe(promptEl, { childList: true, subtree: true, characterData: true });
    }

    /* ---- the command palette ----
       A bottom sheet of large tiles — icon and label from the registry
       (Nasj.cmdMeta: the ribbon's icon for the command, its aliases and
       description) — in sections: Recent (the last eight commands that
       ran, kept in localStorage), Draw, Modify, View and the drawing aids
       as on/off tiles. A tile runs its command and the sheet goes; an aid
       flips and the sheet stays. A hold on a tile shows its aliases and
       what it does. The search row filters the tiles by name, alias and
       label, and the rest of the registry by name and alias under More;
       it takes the system keyboard only when it is tapped. */
    const PAL_KEY = 'nasjicad.palette.recent';
    const PAL_RECENT = 8;
    const PAL_SECTIONS = [
      ['Draw', [['LINE', 'Line'], ['PLINE', 'Polyline'], ['CIRCLE', 'Circle'], ['ARC', 'Arc'],
        ['RECTANG', 'Rectangle'], ['POLYGON', 'Polygon'], ['ELLIPSE', 'Ellipse'], ['SPLINE', 'Spline'],
        ['HATCH', 'Hatch'], ['TEXT', 'Text'], ['MTEXT', 'Multiline Text'], ['DIMLINEAR', 'Dimension'],
        ['INSERT', 'Insert Block']]],
      ['Modify', [['MOVE', 'Move'], ['COPY', 'Copy'], ['ROTATE', 'Rotate'], ['MIRROR', 'Mirror'],
        ['SCALE', 'Scale'], ['TRIM', 'Trim'], ['EXTEND', 'Extend'], ['OFFSET', 'Offset'],
        ['FILLET', 'Fillet'], ['ARRAY', 'Array'], ['STRETCH', 'Stretch'], ['ERASE', 'Erase'],
        ['EXPLODE', 'Explode'], ['JOIN', 'Join']]],
      ['View', [['ZE', 'Zoom Extents'], ['ZOOM W', 'Zoom Window'], ['PAN', 'Pan'], ['REGEN', 'Regen'],
        ['LAYER', 'Layers'], ['PROPERTIES', 'Properties'], ['DIST', 'Measure'], ['UNDO', 'Undo'],
        ['REDO', 'Redo']]],
    ];
    const PAL_TOGGLES = [['OSNAP', 'Object Snap', 'osnap'], ['ORTHO', 'Ortho', 'ortho'],
      ['POLAR', 'Polar', 'polar'], ['GRID', 'Grid', 'grid'], ['SNAP', 'Grid Snap', 'snap']];
    const PAL_LABEL = {};
    for (const [, pairs] of PAL_SECTIONS) for (const [nm, lb] of pairs) PAL_LABEL[nm] = lb;
    for (const [nm, lb] of PAL_TOGGLES) PAL_LABEL[nm] = lb;
    let sheet = null, scrim = null;
    const loadRecent = () => {
      try {
        const a = JSON.parse(localStorage.getItem(PAL_KEY) || '[]');
        return Array.isArray(a) ? a.filter((s) => typeof s === 'string') : [];
      } catch (_) { return []; }
    };
    const noteRecent = (name) => {
      const list = loadRecent().filter((n) => n !== name);
      list.unshift(name);
      list.length = Math.min(list.length, PAL_RECENT);
      try { localStorage.setItem(PAL_KEY, JSON.stringify(list)); } catch (_) { /* session only */ }
      if (paletteOpen()) renderSections();
    };
    window.addEventListener('nasj:command', (e) => {
      const nm = e.detail && e.detail.name;
      if (nm) noteRecent(String(nm));
    });
    const meta = (name, label) => {
      const m = (typeof N().cmdMeta === 'function') ? N().cmdMeta(name)
        : { name: String(name).toUpperCase(), label: name, ic: 'file-drawing', aliases: [], desc: '' };
      m.label = label || PAL_LABEL[m.name] || m.label;
      return m;
    };
    const iconOf = (ic, size) => (window.NasjIcons && typeof window.NasjIcons.get === 'function')
      ? window.NasjIcons.get(ic, size) : '';
    const paletteOpen = () => !!(sheet && sheet.classList.contains('open'));
    const hideInfo = () => { const x = sheet && sheet.querySelector('.cp-info'); if (x) x.classList.add('hidden'); };
    const showInfo = (b, t) => {
      const info = sheet.querySelector('.cp-info');
      info.textContent = '';
      const h = document.createElement('div');
      h.className = 'cp-info-name';
      h.textContent = t.name + (t.aliases && t.aliases.length ? ' — ' + t.aliases.join(', ') : '');
      info.appendChild(h);
      if (t.desc) {
        const d = document.createElement('div');
        d.className = 'cp-info-desc';
        d.textContent = t.desc;
        info.appendChild(d);
      }
      info.classList.remove('hidden');
      const sr = sheet.getBoundingClientRect(), br = b.getBoundingClientRect();
      info.style.left = Math.max(8, Math.min(br.left - sr.left, sr.width - info.offsetWidth - 8)) + 'px';
      info.style.top = Math.max(8, br.top - sr.top - info.offsetHeight - 6) + 'px';
    };
    const runTile = (t, b) => {
      if (t.toggle) {
        if (typeof N().toggleSetting === 'function') N().toggleSetting(t.toggle);
        b.classList.toggle('on', !!(N().settings && N().settings[t.toggle]));
        return;
      }
      closePalette();
      if (N().cmd) N().cmd.execute(t.name);
    };
    const tileEl = (t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cp-tile';
      /* not data-cmd: app.js runs every [data-cmd] click as a command of
         its own, and the tile has its own tap */
      b.dataset.tile = t.name;
      b.innerHTML = '<span class="cp-ico">' + iconOf(t.ic, 26) + '</span><span class="cp-label"></span>';
      b.querySelector('.cp-label').textContent = t.label;
      if (t.toggle) b.classList.toggle('on', !!(N().settings && N().settings[t.toggle]));
      /* a tap runs it; a hold shows its aliases and what it does, and
         the lift after a hold runs nothing */
      let holdT = 0, heldTile = false;
      b.addEventListener('pointerdown', () => {
        heldTile = false;
        clearTimeout(holdT);
        holdT = setTimeout(() => { heldTile = true; showInfo(b, t); }, 500);
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, () => clearTimeout(holdT)));
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); clearTimeout(holdT); heldTile = true; showInfo(b, t); });
      b.addEventListener('click', (e) => {
        e.preventDefault();
        if (heldTile) { heldTile = false; return; }
        runTile(t, b);
      });
      return b;
    };
    const renderSections = () => {
      const body = sheet.querySelector('.cp-body');
      const q = sheet.querySelector('.cp-search').value.trim().toUpperCase();
      body.textContent = '';
      const hit = (t) => !q || t.name.indexOf(q) >= 0 || t.label.toUpperCase().indexOf(q) >= 0 ||
        (t.aliases || []).some((a) => String(a).toUpperCase().startsWith(q));
      const section = (title, tiles, cls) => {
        const list = tiles.filter(hit);
        if (!list.length) return 0;
        const sec = document.createElement('section');
        sec.className = 'cp-sec' + (cls ? ' ' + cls : '');
        sec.dataset.section = title;
        const h = document.createElement('div');
        h.className = 'cp-title';
        h.textContent = title;
        sec.appendChild(h);
        const grid = document.createElement('div');
        grid.className = 'cp-grid';
        for (const t of list) grid.appendChild(tileEl(t));
        sec.appendChild(grid);
        body.appendChild(sec);
        return list.length;
      };
      let n = 0;
      if (!q) {
        const rec = loadRecent();
        if (rec.length) n += section('Recent', rec.map((nm) => meta(nm)), 'cp-recent');
      }
      for (const [title, pairs] of PAL_SECTIONS) n += section(title, pairs.map(([nm, lb]) => meta(nm, lb)));
      n += section('Snap', PAL_TOGGLES.map(([nm, lb, key]) => Object.assign(meta(nm, lb), { toggle: key })));
      if (q) {
        const shown = new Set(Object.keys(PAL_LABEL).map((s) => s.split(/\s+/)[0]));
        const all = (N().cmd && typeof N().cmd.commandInfo === 'function') ? N().cmd.commandInfo() : [];
        const more = all.filter((c) => !shown.has(c.name) && (c.name.indexOf(q) >= 0 ||
          (c.aliases || []).some((a) => String(a).toUpperCase().startsWith(q)))).slice(0, 12);
        n += section('More', more.map((c) => meta(c.name)), 'cp-more');
      }
      if (!n) {
        const e = document.createElement('div');
        e.className = 'cp-empty';
        e.textContent = 'No matching commands.';
        body.appendChild(e);
      }
    };
    const buildPalette = () => {
      if (sheet) return;
      scrim = document.createElement('div');
      scrim.id = 'cmd-palette-scrim';
      scrim.addEventListener('click', () => closePalette());
      sheet = document.createElement('div');
      sheet.id = 'cmd-palette';
      sheet.innerHTML = '<div class="cp-head"><span class="cp-grab"></span>' +
        '<input class="cp-search" type="search" placeholder="Search commands" autocomplete="off" ' +
        'spellcheck="false" enterkeyhint="go">' +
        '<button type="button" class="cp-btn cp-kbd" title="Keyboard — type into the command line">⌨</button>' +
        '<button type="button" class="cp-btn cp-close" title="Close">✕</button></div>' +
        '<div class="cp-body"></div><div class="cp-info hidden"></div>';
      const search = sheet.querySelector('.cp-search');
      search.addEventListener('input', renderSections);
      search.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const first = sheet.querySelector('.cp-tile');
        if (first) { first.click(); return; }
        const q = search.value.trim();
        if (q) { closePalette(); if (N().cmd) N().cmd.execute(q); }
      });
      sheet.querySelector('.cp-kbd').addEventListener('click', () => { closePalette(); setKeyboard(!kbdWanted); });
      sheet.querySelector('.cp-close').addEventListener('click', () => closePalette());
      /* a hold's card goes with the next touch */
      sheet.addEventListener('pointerdown', hideInfo, true);
      /* the grab row drags the sheet down and away */
      const head = sheet.querySelector('.cp-head');
      let dragY = null;
      head.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button, input')) return;
        dragY = e.clientY;
        sheet.classList.add('dragging');
        try { head.setPointerCapture(e.pointerId); } catch (_) { /* a synthetic pointer */ }
      });
      head.addEventListener('pointermove', (e) => {
        if (dragY === null) return;
        sheet.style.transform = 'translateY(' + Math.max(0, e.clientY - dragY) + 'px)';
      });
      const endDrag = (e) => {
        if (dragY === null) return;
        const dy = e.clientY - dragY;
        dragY = null;
        sheet.classList.remove('dragging');
        sheet.style.transform = '';
        if (dy > 80) closePalette();
      };
      head.addEventListener('pointerup', endDrag);
      head.addEventListener('pointercancel', endDrag);
      document.body.appendChild(scrim);
      document.body.appendChild(sheet);
      syncKbdButtons();
    };
    const openPalette = () => {
      if (!isCoarse()) return;
      buildPalette();
      if (bar) bar.classList.remove('pad-open', 'more-open');
      sheet.querySelector('.cp-search').value = '';
      renderSections();
      hideInfo();
      scrim.classList.add('open');
      sheet.classList.add('open');
      sheet.querySelector('.cp-body').scrollTop = 0;
      window.dispatchEvent(new CustomEvent('nasj:palette', { detail: { open: true } }));
    };
    const closePalette = () => {
      if (!sheet) return;
      sheet.classList.remove('open');
      scrim.classList.remove('open');
      hideInfo();
      const s = sheet.querySelector('.cp-search');
      if (document.activeElement === s) s.blur();
    };
    const dropPalette = () => {
      if (sheet) { sheet.remove(); sheet = null; }
      if (scrim) { scrim.remove(); scrim = null; }
    };
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && paletteOpen()) { e.stopPropagation(); e.preventDefault(); closePalette(); }
    }, true);
    N().palette = { open: openPalette, close: closePalette, isOpen: paletteOpen, recent: loadRecent };

    /* the system keyboard: the visual viewport shrinks under it while the
       layout viewport — and the drawing laid out in it — stays put. The
       command line rides up by the hidden height (--kbd-lift, app.css)
       and the bar follows the line; nothing else moves. */
    const vv = window.visualViewport;
    let kbdLift = 0, forcedLift = null;
    const setKbdLift = (px) => {
      kbdLift = Math.max(0, Math.round(px || 0));
      const root = document.documentElement;
      root.style.setProperty('--kbd-lift', kbdLift + 'px');
      root.classList.toggle('kbd-up', kbdLift > 120);
      placeBar();
    };
    const measuredLift = () => (vv ? window.innerHeight - vv.height - vv.offsetTop : 0);
    const onViewport = () => { if (forcedLift === null) setKbdLift(measuredLift()); };
    if (vv) {
      vv.addEventListener('resize', onViewport);
      vv.addEventListener('scroll', onViewport);
    }
    /* the QA harness has no keyboard to raise: it says how tall one is */
    N().kbdLift = (px) => {
      forcedLift = (px === null || px === undefined) ? null : +px;
      setKbdLift(forcedLift === null ? measuredLift() : forcedLift);
      return kbdLift;
    };

    /* ---- the focus layout: a phone. Coarse AND small — narrow (a phone
       upright) or short (one on its side) — puts html.focus on the root,
       and app.css takes the chrome down to one drawing surface: no view
       cube, no viewport label, no navigation rail, no row of status
       toggles; one round button for the agent, one status strip (layer,
       snap, more), the command line's history folded to its prompt, and
       the ribbon's panels as a sheet of large tiles under the tab row.
       While a tool is running (html.drawing) the tab row and the file
       tabs go too: the drawing takes the height between the title bar
       and the action bar, and Esc or the tool's end brings them back.
       Nasj.focusMode(true|false|null) forces or releases it for the QA
       harness, whose window is a desktop's; the class never appears
       without coarse, so a mouse-only machine cannot be moved by it. */
    const FOCUS_W = 700, FOCUS_H = 560;   /* css px: at most this wide, or this short */
    let forcedFocus = null;
    let agentBtn = null;
    const isFocus = () => isCoarse() && (forcedFocus !== null ? forcedFocus
      : (window.innerWidth <= FOCUS_W || window.innerHeight <= FOCUS_H));
    const toolRunning = () => {
      const t = N().tools;
      return !!(t && t.activeName && t.activeName !== 'select');
    };
    /* the agent's sheet: full screen under focus, so it needs a close of
       its own — the panel's own header has only a Collapse the desktop
       uses. Added once the panel exists (agent-panel.js builds it after
       this file has loaded) and shown by app.css under html.focus only. */
    const ensureAgentClose = () => {
      const head = document.querySelector('#agent-panel .ag-head');
      if (!head || head.querySelector('#ag-focus-close')) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'ag-focus-close';
      b.className = 'ag-ghost';
      b.title = 'Close';
      b.textContent = '✕';
      b.addEventListener('click', () => { if (window.NasjAgent) window.NasjAgent.close(); });
      head.appendChild(b);
    };
    const buildAgentBtn = () => {
      if (agentBtn) return;
      const host = document.getElementById('viewport-container');
      if (!host) return;
      agentBtn = document.createElement('button');
      agentBtn.type = 'button';
      agentBtn.id = 'focus-agent';
      agentBtn.title = 'Agent — draft with words';
      agentBtn.innerHTML = (window.NasjIcons && typeof window.NasjIcons.get === 'function')
        ? window.NasjIcons.get('ai-assistant', 24) : 'AI';
      agentBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!window.NasjAgent) return;
        ensureAgentClose();
        window.NasjAgent.open();
      });
      host.appendChild(agentBtn);
    };
    const applyFocus = () => {
      const on = isFocus();
      const was = document.documentElement.classList.contains('focus');
      document.documentElement.classList.toggle('focus', on);
      document.documentElement.classList.toggle('drawing', on && toolRunning());
      N().focus = on;                /* the engine drops the UCS icon on it */
      if (on) { buildAgentBtn(); ensureAgentClose(); }
      else if (agentBtn) { agentBtn.remove(); agentBtn = null; }
      if (was !== on) {
        window.dispatchEvent(new CustomEvent('nasj:focus', { detail: { on } }));
        placeBar();
      }
    };
    window.addEventListener('nasj:tool', () => {
      document.documentElement.classList.toggle('drawing', isFocus() && toolRunning());
    });
    window.addEventListener('resize', applyFocus);

    /* the mode itself: the media query's answer, or the test hook's */
    const coarseMQ = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
    let forced = null;
    const isCoarse = () => (forced !== null) ? forced : !!(coarseMQ && coarseMQ.matches);
    const applyCoarse = () => {
      const on = isCoarse();
      document.documentElement.classList.toggle('coarse', on);
      N().coarse = on;               /* the engine widens grips and boxes on it */
      if (on) { buildBar(); wireInput(); renderChips(); }
      else {
        if (bar) { bar.remove(); bar = null; }
        dropPalette();
        kbdWanted = false;
        kbdAuto = false;
      }
      applyInputLock();
      applyFocus();
      /* the ribbon's panels change size with the class; the row is fitted
         again once they have, so a panel folded to a button at the wider
         size opens back up at the narrower one (and the other way round) */
      if (typeof N().fitRibbon === 'function') requestAnimationFrame(N().fitRibbon);
      if (typeof N().renderOverlay === 'function') N().renderOverlay();
    };
    N().touchMode = (on) => {
      forced = (on === null || on === undefined) ? null : !!on;
      applyCoarse();
      return isCoarse();
    };
    N().focusMode = (on) => {
      forcedFocus = (on === null || on === undefined) ? null : !!on;
      applyFocus();
      if (typeof N().renderOverlay === 'function') N().renderOverlay();
      return isFocus();
    };
    if (coarseMQ && coarseMQ.addEventListener) coarseMQ.addEventListener('change', applyCoarse);
    applyCoarse();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else init();
})();
