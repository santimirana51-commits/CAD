/* Nasjicad — commands.js (owner: INTERACT)
   Command line, parsing, autocomplete, history, dynamic input, clipboard. SPEC §10. */
(() => {
  'use strict';
  const N = window.Nasj = window.Nasj || {};

  let elInput = null, elHist = null, elSuggest = null, elLabel = null;
  let inited = false;
  let promptText = '';
  let lastCommand = null;
  const typedHist = [];
  let typedIdx = -1;
  let sug = { items: [], sel: 0, nav: false, visible: false };
  const MAX_HISTORY = 200;

  const emit = (n, d) => {
    if (typeof N.emit === 'function') N.emit(n, d);
    else window.dispatchEvent(new CustomEvent(n, { detail: d }));
  };
  const awaiting = () => (N.tools && N.tools.awaiting) || 'none';

  /* ---------------- printing / prompt ---------------- */
  const print = (text, cls = '') => {
    if (!elHist) elHist = document.getElementById('command-history');
    if (!elHist) return;
    const div = document.createElement('div');
    div.className = 'cmd-line' + (cls ? ' ' + cls : '');
    div.textContent = String(text);
    div.style.whiteSpace = 'pre-wrap';
    elHist.appendChild(div);
    while (elHist.children.length > MAX_HISTORY) elHist.removeChild(elHist.firstChild);
    elHist.scrollTop = elHist.scrollHeight;
  };

  /* Prompt label with clickable [Keyword] chips (spec §0.2: each bracketed
     keyword is a clickable chip; the <default> is clickable too = Enter). */
  const chipAbbr = (kw) => {
    const caps = (kw.match(/[A-Z0-9]/g) || []).join('');
    return caps || kw.trim().split(/\s+/)[0];
  };
  const chipClick = (kw) => {
    const abbr = chipAbbr(kw);
    print('> ' + abbr, 'echo');
    routeText(abbr);
  };
  /* keywords inside [...] are slash-separated, except where the industry standard spaces
     them (MEASUREGEOM). A space list is only one when EVERY token carries a
     capital, so "[Pick points]" and "[Multiple points]" stay single. */
  const splitKeywords = (s) => {
    if (s.indexOf('/') >= 0) return s.split('/');
    const w = s.trim().split(/\s+/);
    return (w.length > 1 && w.every((t) => /[A-Z]/.test(t))) ? w : [s];
  };
  /* THE OPTIONS MUST SURVIVE THE ROW. A long prompt was cut by the row's
     ellipsis exactly where its options are — "ZOOM Specify corner of
     window, enter a scale factor (nX or nX…" — so the one part that is
     clickable never reached the screen. The industry standard keeps the bracket list and
     the default on the input line and lets the descriptive half live in
     the prompt tooltip beside the cursor; so do we now.
     The descriptive half is HIDDEN, not removed: textContent still reads
     the whole prompt, which is what the app's own record and every test
     that greps a prompt rely on. Only the pixels go. */
  const renderPromptLabel = () => {
    if (!elLabel) return;
    elLabel.textContent = '';
    elLabel.title = '';
    if (!promptText) return;
    const m = /^(\S+\s+)(.*?)(\[[^\]]*\].*)$/.exec(promptText);
    if (!m) { renderPromptInto(promptText); return; }
    renderPromptInto(m[1]);
    const desc = document.createElement('span');
    desc.className = 'pl-desc';
    desc.textContent = m[2];
    elLabel.appendChild(desc);
    renderPromptInto(m[3]);
    if (elLabel.scrollWidth > elLabel.clientWidth + 1) {
      desc.style.display = 'none';
      elLabel.title = promptText;
    }
  };
  /* appends; the caller clears */
  const renderPromptInto = (src) => {
    if (!src) return;
    const re = /\[([^\]]*)\]|<([^>]*)>/g;
    const addText = (t) => { if (t) elLabel.appendChild(document.createTextNode(t)); };
    let last = 0, m;
    while ((m = re.exec(src))) {
      addText(src.slice(last, m.index));
      last = re.lastIndex;
      if (m[1] !== undefined && m[1].length) {
        addText('[');
        const parts = splitKeywords(m[1]);
        const sep = m[1].indexOf('/') >= 0 ? '/' : ' ';
        parts.forEach((kw, i) => {
          if (i) addText(sep);
          const span = document.createElement('span');
          span.className = 'kw-chip';
          span.textContent = kw;
          Object.assign(span.style, {
            color: 'var(--accent-bright, #4fb3ea)',
            cursor: 'pointer',
            textDecoration: 'underline dotted',
            pointerEvents: 'auto',
          });
          span.title = `Click for ${chipAbbr(kw)}`;
          span.addEventListener('mousedown', (ev) => { ev.preventDefault(); chipClick(kw); });
          elLabel.appendChild(span);
        });
        addText(']');
      } else {
        const span = document.createElement('span');
        span.className = 'kw-default';
        span.textContent = '<' + (m[2] || '') + '>';
        Object.assign(span.style, { cursor: 'pointer', pointerEvents: 'auto' });
        span.title = 'Click to accept the default';
        span.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          if (awaiting() !== 'none') { print('>', 'echo'); N.tools.feedEnter(); }
        });
        elLabel.appendChild(span);
      }
    }
    addText(src.slice(last));
  };
  const setPrompt = (text) => {
    promptText = text || '';
    renderPromptLabel();
    if (elInput) elInput.placeholder = promptText ? '' : 'Type a command';
    updateDyn();
  };
  const clearPrompt = () => setPrompt('');

  /* ---------------- command table ---------------- */
  const CMDS = [];
  /* opts: { cat: help-group name, edit: true → the command changes geometry,
     icon: NasjIcons name for the suggest popup / search (SPEC3 §21),
     trans: true → may run transparently with a ' prefix (spec §0.1) } */
  const def = (name, aliases, run, desc, opts = {}) =>
    CMDS.push({
      name, aliases, run, desc,
      cat: opts.cat || 'Utility',
      edit: !!opts.edit,
      trans: !!opts.trans,
      icon: opts.icon || 'file-drawing',
    });
  /* the tool name is tagged on so N.cmd.runWith can restart the same command
     with an option already answered */
  const startTool = (t) => {
    const run = () => N.tools.start(t);
    run.tool = t;
    return run;
  };
  const fileAction = (action) => () => emit('nasj:file', { action });
  const toggleSetting = (key, label) => () => {
    if (typeof N.toggleSetting === 'function') N.toggleSetting(key);
    else if (N.settings) {
      N.settings[key] = !N.settings[key];
      emit('nasj:settings', { key, value: N.settings[key] });
      if (N.render) N.render();
    } else { print('Settings are unavailable.', 'err'); return; }
    const on = N.settings ? !!N.settings[key] : false;
    print(`<${label} ${on ? 'on' : 'off'}>`);
  };
  const doUndo = () => {
    const doc = N.doc;
    if (!doc) return;
    /* the step behind the cursor may be a Block Editor CLOSE — undoing that
       re-enters the editor with the session as it stood, rather than merely
       reverting the definition underneath */
    if (N.tools && typeof N.tools.beditResume === 'function' && N.tools.beditResume()) return;
    /* an ordinary undo moves the drawing away from the close it would have
       resumed — and popping can bring the stack LENGTH back to the memento's
       number with a different drawing under it, so the memento dies here,
       not by arithmetic */
    N.beditMemento = null;
    if (!doc.undoStack || !doc.undoStack.length) { print('Nothing to undo.'); return; }
    N.docOps.undo(doc);
    if (N.setSelection) N.setSelection([]);
    if (N.render) N.render();
    emit('nasj:doc', { doc });
    print('UNDO');
  };
  const doRedo = () => {
    const doc = N.doc;
    if (!doc) return;
    N.beditMemento = null;    /* same rule as undo: the drawing moved on */
    if (!doc.redoStack || !doc.redoStack.length) { print('Nothing to redo.'); return; }
    N.docOps.redo(doc);
    if (N.setSelection) N.setSelection([]);
    if (N.render) N.render();
    emit('nasj:doc', { doc });
    print('REDO');
  };
  const HELP_ORDER = ['Draw', 'Modify', 'Annotate', 'Blocks', 'Layers', 'View',
    'Settings', 'Clipboard', 'File', 'Utility'];
  const showHelp = () => {
    print('Available commands:');
    const cats = HELP_ORDER.concat(
      CMDS.map((c) => c.cat).filter((cat) => !HELP_ORDER.includes(cat)));
    const seen = new Set();
    for (const cat of cats) {
      if (seen.has(cat)) continue;
      seen.add(cat);
      const items = CMDS.filter((c) => c.cat === cat)
        .map((c) => c.name + (c.aliases.length ? ' (' + c.aliases.join(',') + ')' : ''));
      if (!items.length) continue;
      print(cat + ':');
      const colw = Math.max(...items.map((s) => s.length)) + 2;
      const perRow = Math.max(1, Math.floor(64 / colw));
      for (let i = 0; i < items.length; i += perRow) {
        print('  ' + items.slice(i, i + perRow).map((s) => s.padEnd(colw)).join(''));
      }
    }
    print('Coordinates: X,Y absolute · @DX,DY relative · @D<A polar (degrees).');
    if (N.paper) {
      print('Paper space: drawing lands on the sheet — double-click a viewport to work in the model.');
    }
  };

  /* ---------------- v3 immediate commands (SPEC3 §22) ---------------- */
  const docTouched = (doc) => {
    doc.modified = true;
    if (N.render) N.render();
    emit('nasj:doc', { doc });
  };

  /* LAYON — turn every layer on */
  const doLayOn = () => {
    const doc = N.doc;
    if (!doc) return;
    const off = doc.layers.filter((l) => !l.on);
    if (!off.length) { print('All layers are already on.'); return; }
    N.docOps.pushUndo(doc);
    off.forEach((l) => { l.on = true; });
    docTouched(doc);
    print(`${off.length} layer(s) turned on.`);
  };

  /* LAYTHW — thaw every frozen layer */
  const doLayThw = () => {
    const doc = N.doc;
    if (!doc) return;
    const frozen = doc.layers.filter((l) => l.frozen);
    if (!frozen.length) { print('No layers are frozen.'); return; }
    N.docOps.pushUndo(doc);
    frozen.forEach((l) => { l.frozen = false; });
    docTouched(doc);
    print(`${frozen.length} layer(s) thawed.`);
  };

  /* LAYUNISO — restore the on/off snapshot taken by LAYISO */
  const doLayUniso = () => {
    const doc = N.doc;
    if (!doc) return;
    const snap = N.pref && N.pref.layIso;
    if (!snap || !Array.isArray(snap.states)) { print('No LAYISO state to restore.', 'err'); return; }
    N.docOps.pushUndo(doc);
    let n = 0;
    for (const st of snap.states) {
      const l = doc.layers.find((x) => x.id === st.id);
      if (l && l.on !== st.on) { l.on = st.on; n++; }
    }
    delete N.pref.layIso;
    docTouched(doc);
    print(`Layer state before LAYISO restored (${n} layer(s) changed).`);
  };

  /* PURGE — unused block defs + empty non-current layers */
  const doPurge = () => {
    const doc = N.doc;
    if (!doc) return;
    const blocks = doc.blocks || {};
    const used = new Set(doc.entities.filter((e) => e.type === 'insert').map((e) => e.name));
    for (const bn of Object.keys(blocks)) {
      for (const e of (blocks[bn].entities || [])) if (e.type === 'insert') used.add(e.name);
    }
    const deadBlocks = Object.keys(blocks).filter((bn) => !used.has(bn));
    const usedLayers = new Set(doc.entities.map((e) => e.layerId));
    const deadLayers = doc.layers.filter((l) =>
      l.id !== '0' && l.id !== doc.currentLayerId && !usedLayers.has(l.id));
    if (!deadBlocks.length && !deadLayers.length) { print('Nothing to purge.'); return; }
    N.docOps.pushUndo(doc);
    for (const bn of deadBlocks) delete blocks[bn];
    if (deadLayers.length) doc.layers = doc.layers.filter((l) => !deadLayers.includes(l));
    docTouched(doc);
    print(`${deadBlocks.length} unused block definition(s) and ${deadLayers.length} empty layer(s) purged.`);
  };

  /* AUDIT — repair pass: drop invalid entities, fix orphaned layer ids */
  const doAudit = () => {
    const doc = N.doc;
    if (!doc) return;
    const layerIds = new Set(doc.layers.map((l) => l.id));
    const validBounds = (e) => {
      try {
        const b = N.geom.entityBounds(e);
        return !!b && isFinite(b.minx) && isFinite(b.miny) && isFinite(b.maxx) && isFinite(b.maxy);
      } catch (_) { return false; }
    };
    const drop = new Set();
    const relayer = [];
    for (const e of doc.entities) {
      if (!e || typeof e.type !== 'string' || !validBounds(e)) { drop.add(e); continue; }
      if (!layerIds.has(e.layerId)) relayer.push(e);
    }
    const total = doc.entities.length;
    if (!drop.size && !relayer.length) {
      print(`AUDIT: ${total} object(s) audited, 0 errors found.`);
      return;
    }
    N.docOps.pushUndo(doc);
    if (drop.size) doc.entities = doc.entities.filter((e) => !drop.has(e));
    for (const e of relayer) e.layerId = doc.currentLayerId;
    if (N.setSelection) N.setSelection([]);
    docTouched(doc);
    print(`AUDIT: ${total} object(s) audited, ${drop.size} invalid object(s) removed, ${relayer.length} object(s) repaired.`);
  };

  /* ALIASES — alias table in columns */
  const showAliases = () => {
    print('Command aliases:');
    const rows = [];
    for (const c of CMDS) for (const a of c.aliases) rows.push([a, c.name]);
    rows.sort((x, y) => x[0].localeCompare(y[0]));
    const items = rows.map(([a, n]) => `${a.padEnd(10)} ${n}`);
    if (!items.length) { print('  (none)'); return; }
    const colw = Math.max(...items.map((s) => s.length)) + 3;
    const perRow = Math.max(1, Math.floor(72 / colw));
    for (let i = 0; i < items.length; i += perRow) {
      print('  ' + items.slice(i, i + perRow).map((s) => s.padEnd(colw)).join(''));
    }
  };

  /* SYSVARS — Nasj.settings key/values */
  const showSysvars = () => {
    if (!N.settings) { print('Settings are unavailable.', 'err'); return; }
    print('System variables:');
    for (const [k, v] of Object.entries(N.settings)) {
      print(`  ${k.toUpperCase().padEnd(14)}= ${v}`);
    }
    print(`  DRAWCOLOR     = ${N.drawColor || 'ByLayer'}`);
    print(`  DRAWLT        = ${N.drawLt || 'ByLayer'}`);
    print(`  DRAWLW        = ${typeof N.drawLw === 'number' ? N.drawLw : 'ByLayer'}`);
  };

  /* Draw */
  def('LINE', ['L'], startTool('line'), 'Draw straight line segments', { cat: 'Draw', edit: true, icon: 'line' });
  def('PLINE', ['PL'], startTool('polyline'), 'Draw a polyline', { cat: 'Draw', edit: true, icon: 'polyline' });
  def('MLINE', ['ML'], startTool('mline'), 'Create multiple parallel lines', { cat: 'Draw', edit: true, icon: 'mline' });
  def('GROUP', ['G'], startTool('group'), 'Group objects so a pick selects them all', { cat: 'Modify', edit: true, icon: 'group' });
  def('UNGROUP', ['UNG'], startTool('ungroup'), 'Explode a group back into loose objects', { cat: 'Modify', edit: true, icon: 'ungroup' });
  def('GROUPEDIT', [], startTool('groupedit'), 'Add or remove group members, or rename a group', { cat: 'Modify', edit: true, icon: 'group' });
  def('UCS', [], startTool('ucstool'), 'Move the drawing origin, or return it to World', { cat: 'View', icon: 'sb-units' });
  def('UCSMAN', ['UC', 'DDUCS'], () => {
    if (N.ucsmanUI && N.ucsmanUI.open) N.ucsmanUI.open();
    else print('The UCS dialog is unavailable.', 'err');
  }, 'Manage named and orthographic UCSs and the UCS icon (the UCS dialog)', { cat: 'View', icon: 'sb-units' });
  def('SECTIONPLANESETTINGS', [], () => {
    if (N.sectionSettingsUI && N.sectionSettingsUI.open) N.sectionSettingsUI.open();
    else print('The Section Settings dialog is unavailable.', 'err');
  }, 'Set display options for section planes (the Section Settings dialog)', { cat: 'View', icon: 'section-plane' });
  /* the two view-style managers, the industry standard's own box for each family */
  const viewStyleMgr = (kind) => () => {
    if (N.viewStyleUI) N.viewStyleUI.open(kind);
    else print('The view style managers are unavailable.', 'err');
  };
  def('VIEWDETAILSTYLE', [], viewStyleMgr('detail'),
    'Create and modify detail view styles (the Detail View Style Manager)',
    { cat: 'View', icon: 'base' });
  def('VIEWSECTIONSTYLE', [], viewStyleMgr('section'),
    'Create and modify section view styles (the Section View Style Manager)',
    { cat: 'View', icon: 'base' });
  def('VIEWSTD', [], () => {
    if (N.viewStdUI) N.viewStdUI.open(); else print('The Drafting Standard dialog is unavailable.', 'err');
  }, 'Set what new drawing views default to (the Drafting Standard dialog)', { cat: 'View', icon: 'base' });
  def('VIEWBASE', [], () => {
    print('Base views come from a 3D model; this release draws in 2D, so there is no model ' +
      'to project. VIEWSTD sets the standard those views would follow.', 'err');
  }, 'Create a base view from a 3D model', { cat: 'View', icon: 'base' });
  def('PTYPE', ['DDPTYPE'], () => {
    if (N.ptypeUI) N.ptypeUI.open(); else print('The Point Style dialog is unavailable.', 'err');
  }, 'Choose the point glyph and its size (the Point Style dialog)', { cat: 'Settings', icon: 'point' });
  def('CLASSICGROUP', ['GROUPMANAGER'], () => {
    if (N.groupUI) N.groupUI.open(); else print('The Group Manager is unavailable.', 'err');
  }, 'Open the Object Grouping dialog (the Group Manager)', { cat: 'Modify', icon: 'group' });
  def('MLEDIT', [], () => {
    if (!N.mleditUI) { print('Multiline editing is unavailable.', 'err'); return; }
    N.mleditUI.open();
  }, 'Edit multiline intersections, breaks and vertices', { cat: 'Modify', edit: true, icon: 'mline' });
  def('CIRCLE', ['C'], startTool('circle'), 'Draw a circle (center-radius, 2P or 3P)', { cat: 'Draw', edit: true, icon: 'circle' });
  def('ARC', ['A'], startTool('arc'), 'Draw an arc (three-point or center)', { cat: 'Draw', edit: true, icon: 'arc' });
  def('RECTANG', ['REC'], startTool('rectangle'), 'Draw a rectangle', { cat: 'Draw', edit: true, icon: 'rectangle' });
  def('POLYGON', ['POL'], startTool('polygon'), 'Draw an equilateral closed polyline', { cat: 'Draw', edit: true, icon: 'polygon' });
  def('ELLIPSE', ['EL'], startTool('ellipse'), 'Draw an ellipse', { cat: 'Draw', edit: true, icon: 'ellipse' });
  def('POINT', ['PO'], startTool('point'), 'Place point objects', { cat: 'Draw', edit: true, icon: 'point' });
  def('HATCH', ['H', 'SUPERHATCH'], startTool('hatch'), 'Fill an enclosed area or selected object with a hatch pattern', { cat: 'Draw', edit: true, icon: 'hatch' });
  def('GRADIENT', ['GD'], startTool('gradient'), 'Fill an enclosed area with a gradient', { cat: 'Draw', edit: true, icon: 'gradient' });
  def('BOUNDARY', ['BO'], startTool('boundary'), 'Trace an enclosed area into a closed polyline', { cat: 'Draw', edit: true, icon: 'boundary' });
  def('HATCHEDIT', ['HE'], startTool('hatchedit'), 'Edit a hatch on the Hatch Editor tab', { cat: 'Modify', edit: true, icon: 'hatch' });
  def('SPLINE', ['SPL'], startTool('spline'), 'Draw a spline by fit points or control vertices', { cat: 'Draw', edit: true, icon: 'spline' });
  def('REVCLOUD', [], startTool('revcloud'), 'Draw a revision cloud — rectangular, polygonal or freehand', { cat: 'Draw', edit: true, icon: 'revcloud' });
  def('RAY', [], startTool('ray'), 'Draw a construction line that runs forever one way', { cat: 'Draw', edit: true, icon: 'ray' });
  def('XLINE', ['XL'], startTool('xline'), 'Draw a construction line that runs forever both ways', { cat: 'Draw', edit: true, icon: 'xline' });
  def('DONUT', ['DO'], startTool('donut'), 'Draw a filled ring by inside and outside diameter', { cat: 'Draw', edit: true, icon: 'donut' });
  def('HELIX', [], startTool('helix'), 'Draw a 2D spiral or a 3D helix', { cat: 'Draw', edit: true, icon: 'helix' });
  def('REGION', ['REG'], startTool('region'), 'Convert closed shapes into regions', { cat: 'Draw', edit: true, icon: 'region' });
  def('3DPOLY', [], startTool('poly3d'), 'Draw a 3D polyline — straight segments only', { cat: 'Draw', edit: true, icon: 'poly3d' });
  def('WIPEOUT', [], startTool('wipeout'), 'Mask an area with an opaque background patch', { cat: 'Draw', edit: true, icon: 'wipeout' });
  def('BREAKLINE', [], startTool('breakline'), 'Draw a break-line symbol between two points', { cat: 'Draw', edit: true, icon: 'breakline' });
  /* Modify */
  def('ERASE', ['E'], startTool('erase'), 'Erase objects', { cat: 'Modify', edit: true, icon: 'erase' });
  def('MOVE', ['M', 'MOCORO'], startTool('move'), 'Move objects', { cat: 'Modify', edit: true, icon: 'move' });
  def('COPY', ['CO', 'CP'], startTool('copy'), 'Copy objects', { cat: 'Modify', edit: true, icon: 'copy' });
  def('ROTATE', ['RO'], startTool('rotate'), 'Rotate objects', { cat: 'Modify', edit: true, icon: 'rotate' });
  def('MIRROR', ['MI'], startTool('mirror'), 'Mirror objects', { cat: 'Modify', edit: true, icon: 'mirror' });
  def('SCALE', ['SC'], startTool('scale'), 'Scale objects', { cat: 'Modify', edit: true, icon: 'scale' });
  def('OFFSET', ['O'], startTool('offset'), 'Offset line, polyline or circle', { cat: 'Modify', edit: true, icon: 'offset' });
  def('TRIM', ['TR'], startTool('trim'), 'Trim objects at cutting edges (Shift-click extends)', { cat: 'Modify', edit: true, icon: 'trim' });
  def('EXTEND', ['EX', 'EXT'], startTool('extend'), 'Extend objects to boundary edges (Shift-click trims)', { cat: 'Modify', edit: true, icon: 'extend' });
  def('FILLET', ['F'], startTool('fillet'), 'Fillet two lines with a tangent arc', { cat: 'Modify', edit: true, icon: 'fillet' });
  def('CHAMFER', ['CHA'], startTool('chamfer'), 'Bevel the corner between two lines', { cat: 'Modify', edit: true, icon: 'chamfer' });
  def('STRETCH', ['S'], startTool('stretch'), 'Stretch objects with a crossing window', { cat: 'Modify', edit: true, icon: 'stretch' });
  def('LENGTHEN', ['LEN'], startTool('lengthen'), 'Change the length of lines and arcs', { cat: 'Modify', edit: true, icon: 'stretch' });
  def('BREAK', ['BR'], startTool('break'), 'Break an object between two points', { cat: 'Modify', edit: true, icon: 'trim' });
  def('JOIN', ['J'], startTool('join'), 'Join lines, polylines and arcs into one object', { cat: 'Modify', edit: true, icon: 'polyline' });
  def('ARRAY', ['AR'], startTool('array'), 'Rectangular, path or polar array of objects', { cat: 'Modify', edit: true, icon: 'array' });
  /* the industry standard's three named forms — ARRAY with its type already answered. The
     type rides N.tools.arrayPreset, not the one-shot prefeed: prefed "R"
     would reach a Select objects: prompt first, where it means Remove. */
  const startArray = (type) => () => { N.tools.arrayPreset = type; N.tools.start('array'); };
  def('ARRAYRECT', [], startArray('Rectangular'), 'Array objects in rows and columns', { cat: 'Modify', edit: true, icon: 'array' });
  def('ARRAYPATH', [], startArray('PAth'), 'Array objects along a path curve', { cat: 'Modify', edit: true, icon: 'array-path' });
  def('ARRAYPOLAR', [], startArray('POlar'), 'Array objects around a center point', { cat: 'Modify', edit: true, icon: 'array-polar' });
  def('EXPLODE', ['X'], startTool('explode'), 'Explode compound objects into primitives', { cat: 'Modify', edit: true, icon: 'explode' });
  def('DIVIDE', ['DIV'], startTool('divide'), 'Place point nodes at equal divisions of an object', { cat: 'Modify', edit: true, icon: 'point' });
  def('REVERSE', [], startTool('reverse'), 'Reverse the direction of lines, polylines and splines', { cat: 'Modify', edit: true, icon: 'polyline' });
  def('OVERKILL', ['GEOMCLEAN'], startTool('overkill'), 'Delete exactly-duplicate objects in the selection', { cat: 'Modify', edit: true, icon: 'overkill' });
  def('PEDIT', ['PE'], startTool('pedit'), 'Edit a polyline — close, open, join, width, reverse', { cat: 'Modify', edit: true, icon: 'edit-pline' });
  def('SPLINEDIT', ['SPE'], startTool('splinedit'), 'Edit a spline — close, open, reverse', { cat: 'Modify', edit: true, icon: 'edit-spline' });
  def('BLEND', ['BL'], startTool('blend'), 'Draw a smooth curve between two open curves', { cat: 'Modify', edit: true, icon: 'blend' });
  def('BREAKATPOINT', [], startTool('breakatpoint'), 'Break an object in two at one point', { cat: 'Modify', edit: true, icon: 'break-at' });
  def('SETBYLAYER', [], startTool('setbylayer'), 'Give the selection back to its layer’s colour, linetype and lineweight', { cat: 'Modify', edit: true, icon: 'set-bylayer' });
  def('DRAWORDER', ['DR'], startTool('draworder'), 'Move objects in front of or behind others', { cat: 'Modify', edit: true, icon: 'draw-order' });
  def('ISOLATEOBJECTS', ['ISOLATE'], startTool('isolateobjects'), 'Hide every object except the selection, for this session', { cat: 'Modify', icon: 'layiso' });
  def('HIDEOBJECTS', [], startTool('hideobjects'), 'Hide the selected objects, for this session', { cat: 'Modify', icon: 'layoff' });
  def('UNISOLATEOBJECTS', ['UNISOLATE', 'UNHIDE'], startTool('unisolateobjects'), 'Show the objects hidden by ISOLATEOBJECTS or HIDEOBJECTS', { cat: 'Modify', icon: 'layon' });
  def('TEXTTOFRONT', [], startTool('texttofront'), 'Bring text, dimensions and leaders in front of every other object', { cat: 'Modify', edit: true, icon: 'dro-anno-front' });
  def('HATCHTOBACK', [], startTool('hatchtoback'), 'Send every hatch behind every other object', { cat: 'Modify', edit: true, icon: 'dro-hatch-back' });
  /* Annotate */
  def('TEXT', ['DT'], startTool('text'), 'Place single-line text', { cat: 'Annotate', edit: true, icon: 'text-single' });
  def('MTEXT', ['MT'], startTool('mtext'), 'Place multiline text in a two-corner frame (in-place editor)', { cat: 'Annotate', edit: true, icon: 'mtext' });
  def('DIMLINEAR', ['DLI'], startTool('dimlinear'), 'Create a horizontal or vertical dimension', { cat: 'Annotate', edit: true, icon: 'dim-linear' });
  def('DIMALIGNED', ['DAL'], startTool('dimaligned'), 'Create an aligned dimension', { cat: 'Annotate', edit: true, icon: 'dim-aligned' });
  def('QDIM', [], startTool('qdim'), 'Create a series of dimensions from selected geometry — Quick Dimension', { cat: 'Annotate', edit: true, icon: 'dim-linear' });
  def('DIMRADIUS', ['DRA'], startTool('dimradius'), 'Dimension the radius of an arc or circle', { cat: 'Annotate', edit: true, icon: 'dim-radius' });
  def('DIMDIAMETER', ['DDI'], startTool('dimdiameter'), 'Dimension the diameter of an arc or circle', { cat: 'Annotate', edit: true, icon: 'dim-diameter' });
  def('DIMANGULAR', ['DAN'], startTool('dimangular'), 'Dimension the angle between two lines', { cat: 'Annotate', edit: true, icon: 'dim-angular' });
  def('DIMBASELINE', ['DBA'], startTool('dimbaseline'), 'Stack a dimension off the last one, spaced by the style', { cat: 'Annotate', edit: true, icon: 'dim-continue' });
  def('DIMCONTINUE', ['DCO'], startTool('dimcontinue'), 'Continue a dimension from where the last one ended', { cat: 'Annotate', edit: true, icon: 'dim-continue' });
  def('LEADER', ['LE'], startTool('leader'), 'Draw a leader with text', { cat: 'Annotate', edit: true, icon: 'leader' });
  def('TABLE', [], startTool('table'), 'Insert a table — the Insert Table dialog', { cat: 'Annotate', edit: true, icon: 'table' });
  def('-TABLE', [], startTool('tablecmd'), 'Insert a table at the command line', { cat: 'Annotate', edit: true, icon: 'table' });
  def('STYLE', ['ST', 'DDSTYLE'], () => {
    if (N.textStyleUI) N.textStyleUI.open();
    else print('The Text Style dialog is unavailable in this build.', 'err');
  }, 'Create, modify and set text styles', { cat: 'Annotate', icon: 'modify-text' });
  def('-STYLE', [], startTool('dashstyle'), 'Set or create a text style at the command line', { cat: 'Annotate', icon: 'modify-text' });
  def('DIMSTYLE', ['D', 'DST', 'DDIM'], () => {
    if (N.dimStyleUI) N.dimStyleUI.open();
    else print('The Dimension Style Manager is unavailable in this build.', 'err');
  }, 'Create, modify and set dimension styles', { cat: 'Annotate', icon: 'dim-linear' });
  def('-DIMSTYLE', [], startTool('dimstyle'), 'Set or create a dimension style at the command line', { cat: 'Annotate', icon: 'dim-linear' });
  def('MLEADERSTYLE', ['MLS'], () => {
    if (N.mleaderStyleUI) N.mleaderStyleUI.open();
    else print('The Multileader Style Manager is unavailable in this build.', 'err');
  }, 'Create, modify and set multileader styles', { cat: 'Annotate', icon: 'multileader' });
  def('-MLEADERSTYLE', [], startTool('mleaderstyle'), 'Set or create a multileader style at the command line', { cat: 'Annotate', icon: 'multileader' });
  def('TABLESTYLE', ['TS'], () => {
    if (N.tableStyleUI) N.tableStyleUI.open();
    else print('The Table Style dialog is unavailable in this build.', 'err');
  }, 'Create, modify and set table styles', { cat: 'Annotate', icon: 'table' });
  def('-TABLESTYLE', [], startTool('tablestyle'), 'Set or create a table style at the command line', { cat: 'Annotate', icon: 'table' });
  def('SCALETEXT', [], startTool('scaletext'), 'Change the height of text without moving it',
    { cat: 'Annotate', edit: true, icon: 'text-scale' });
  def('CONSTRAINTSETTINGS', ['CSETTINGS'], () => {
    if (N.constraintUI) N.constraintUI.open();
    else print('The Constraint Settings dialog is unavailable.', 'err');
  }, 'How constraints are inferred, shown and named', { cat: 'Parametric', icon: 'auto-constrain' });
  def('DELCONSTRAINT', ['DELCON'], startTool('delconstraint'),
    'Removes all constraints from the selected objects',
    { cat: 'Parametric', edit: true, icon: 'delete-constraints' });
  def('CENTERMARK', [], startTool('centermark'), 'Add center lines to a circle or arc', { cat: 'Annotate', edit: true, icon: 'centermark' });
  def('CENTERLINE', [], startTool('centerline'), 'Draw a centerline midway between two lines', { cat: 'Annotate', edit: true, icon: 'centerline' });
  /* Blocks */
  /* BLOCK on its own opens the Block Definition box, the way the industry standard's
     does; BLOCK with arguments — and -BLOCK always — is the command-line
     form, the industry standard's own split */
  const blockRun = () => {
    if (!N.cmd.argc && N.blockDefUI) { N.blockDefUI.open(); return; }
    N.tools.start('block');
  };
  blockRun.tool = 'block';
  def('BLOCK', ['B'], blockRun, 'Create a block from the selection (the Block Definition box)', { cat: 'Blocks', edit: true, icon: 'block-create' });
  def('-BLOCK', [], startTool('block'), 'Create a block at the command line', { cat: 'Blocks', edit: true, icon: 'block-create' });
  def('BASE', [], startTool('base'), 'Set the base point BLOCK offers as its default', { cat: 'Blocks', edit: true, icon: 'base-point' });
  def('INSERT', ['I'], startTool('insert'), 'Insert a block reference', { cat: 'Blocks', edit: true, icon: 'block-insert' });
  def('BEDIT', ['BE'], () => {
    if (N.beditDialog) N.beditDialog.open();
    else print('The Edit Block Definition dialog is unavailable.', 'err');
  }, 'Choose a block definition and open it for editing', { cat: 'Blocks', icon: 'block-edit' });
  def('BCLOSE', [], startTool('refclose'),
    'Close the block editing session — save or discard the changes',
    { cat: 'Blocks', edit: true, icon: 'block-edit' });
  def('GEOMCONSTRAINT', ['GCON'], startTool('geomconstraint'),
    'Apply a geometric constraint — the geometry moves to satisfy it, and the relation is recorded',
    { cat: 'Parametric', edit: true, icon: 'auto-constrain' });
  def('AUTOCONSTRAIN', [], startTool('autoconstrain'),
    'Record the geometric constraints a selection already satisfies',
    { cat: 'Parametric', edit: true, icon: 'auto-constrain' });
  def('BCPARAMETER', [], startTool('bcparameter'),
    'Add a dimensional constraint to a line — the Parameters Manager drives its value',
    { cat: 'Parametric', edit: true, icon: 'dim-lock' });
  def('BCONSTRUCTION', [], startTool('bconstruction'),
    'Toggle construction geometry — authoring lines a reference never draws',
    { cat: 'Blocks', edit: true, icon: 'block-edit' });
  def('BPARAMETER', [], startTool('bparameter'),
    'Place a point parameter in the block — the grip a reference grows',
    { cat: 'Blocks', edit: true, icon: 'block-edit' });
  def('BACTIONTOOL', [], startTool('bactiontool'),
    'Bind a Move action: the chosen objects follow the parameter grip',
    { cat: 'Blocks', edit: true, icon: 'block-edit' });
  def('BACTIONBAR', [], startTool('bactionbar'),
    'Show or hide the action bars the parameters wear',
    { cat: 'Blocks', icon: 'block-edit' });
  def('BTABLE', ['BLOCKTABLE'], () => {
    if (N.blockTableUI) N.blockTableUI.open();
    else print('The Block Properties Table is built in the Block Editor.', 'err');
  }, 'The block’s table of value sets — one row is one configuration',
    { cat: 'Blocks', icon: 'table' });
  def('BSAVEAS', [], () => {
    if (N.beditSaveAsUI) N.beditSaveAsUI.open();
    else print('Save Block As runs in the Block Editor.', 'err');
  }, 'Save the open block under a new name and edit that one',
    { cat: 'Blocks', icon: 'block-create' });
  def('BVSTATE', [], () => {
    if (N.beditVisUI) N.beditVisUI.open();
    else print('Visibility States are managed in the Block Editor.', 'err');
  }, 'Manage the block’s visibility states', { cat: 'Blocks', icon: 'block-edit' });
  def('BTESTBLOCK', [], () => {
    if (N.beditTestUI) N.beditTestUI.open();
    else print('Test Block runs in the Block Editor.', 'err');
  }, 'See the block as a placed reference would show it', { cat: 'Blocks', icon: 'block-edit' });
  def('PARAMETERS', [], () => {
    if (N.beditParamsUI) N.beditParamsUI.open();
    else print('The Parameters Manager runs in the Block Editor.', 'err');
  }, 'The Parameters Manager — dimensional constraint values, editable',
    { cat: 'Parametric', icon: 'dim-lock' });
  def('ATTDEF', ['ATT', 'DDATTDEF'], startTool('attdef'), 'Define a block attribute', { cat: 'Blocks', edit: true, icon: 'define-attrs' });
  def('ATTSYNC', [], startTool('attsync'), 'Square every block reference with its definition', { cat: 'Blocks', edit: true, icon: 'sync-scale' });
  def('BATTMAN', [], () => {
    if (N.attManagerUI) N.attManagerUI.open();
    else print('The Block Attribute Manager is unavailable in this build.', 'err');
  }, 'Manage the attributes of a block', { cat: 'Blocks', icon: 'manage-attrs' });
  /* Layers */
  def('LAYER', ['LA'], () => emit('nasj:open-palette', { which: 'layers' }), 'Open the layers palette', { cat: 'Layers', icon: 'layer-props' });
  def('MAKECURRENT', [], startTool('makecurrent'), "Make an object's layer the current layer", { cat: 'Layers', edit: true, icon: 'make-current' });
  def('MATCHLAYER', [], startTool('matchlayer'), "Move objects to another object's layer", { cat: 'Layers', edit: true, icon: 'match-layer' });
  def('MATCHPROP', ['MA', 'PAINTER'], startTool('matchprop'), "Apply one object's properties to others", { cat: 'Modify', edit: true, icon: 'match-props' });
  def('LAYCUR', [], startTool('laycur'), 'Change selected objects to the current layer', { cat: 'Layers', edit: true, icon: 'laymcur' });
  def('COPYTOLAYER', [], startTool('copytolayer'), "Copy selected objects to another object's layer", { cat: 'Layers', edit: true, icon: 'copy' });
  def('LAYMRG', [], startTool('laymrg'), 'Merge one layer into another and remove it', { cat: 'Layers', edit: true, icon: 'match-layer' });
  def('LAYDEL', [], startTool('laydel'), 'Delete a layer and everything drawn on it', { cat: 'Layers', edit: true, icon: 'erase' });
  def('LAYISO', [], startTool('layiso'), 'Isolate the layers of selected objects', { cat: 'Layers', edit: true, icon: 'layiso' });
  def('LAYUNISO', [], doLayUniso, 'Restore layers hidden by LAYISO', { cat: 'Layers', edit: true, icon: 'layuniso' });
  def('LAYOFF', [], startTool('layoff'), "Turn a picked object's layer off", { cat: 'Layers', edit: true, icon: 'layoff' });
  def('LAYON', [], doLayOn, 'Turn all layers on', { cat: 'Layers', edit: true, icon: 'layon' });
  def('LAYFRZ', [], startTool('layfrz'), "Freeze a picked object's layer", { cat: 'Layers', edit: true, icon: 'layfrz' });
  def('LAYTHW', [], doLayThw, 'Thaw all frozen layers', { cat: 'Layers', edit: true, icon: 'laythw' });
  def('LAYLCK', [], startTool('laylck'), "Lock a picked object's layer", { cat: 'Layers', edit: true, icon: 'laylck' });
  def('LAYULK', [], startTool('layulk'), "Unlock a picked object's layer", { cat: 'Layers', edit: true, icon: 'layulk' });
  def('LAYMCUR', [], startTool('laymcur'), "Make a picked object's layer current", { cat: 'Layers', edit: true, icon: 'laymcur' });
  /* View */
  def('AISELECT', ['AISEL'], startTool('aiselect'),
    'Drag a rectangle over part of the drawing and edit it with a prompt',
    { cat: 'AI', edit: true, icon: 'ai-assistant' });
  def('ZOOM', ['Z'], startTool('zoom'), 'Zoom the view [All/Center/Dynamic/Extents/Previous/Scale/Window/Object]', { cat: 'View', trans: true, icon: 'zoom-window' });
  def('ZE', [], () => {
    if (N.viewport && N.viewport.zoomExtents) {
      if (N.tools && N.tools.pushZoomPrev) N.tools.pushZoomPrev(); /* ZOOM Previous sees it */
      N.viewport.zoomExtents();
      if (N.render) N.render();
    }
  }, 'Zoom to drawing extents', { cat: 'View', trans: true, icon: 'zoom-extents' });
  def('PAN', ['P'], startTool('pan'), 'Pan the view with the hand tool', { cat: 'View', trans: true, icon: 'hand' });
  /* solids and BIM — bodies the 3D view shades and the plan draws */
  def('WALL', [], startTool('wall'), 'Draw a wall: a run of points with a thickness and a height', { cat: 'Draw', edit: true, icon: 'rectangle' });
  def('SLAB', [], startTool('slab'), 'Draw a slab: a closed outline with a thickness', { cat: 'Draw', edit: true, icon: 'rectangle' });
  def('DOOR', [], startTool('door'), 'Cut a door opening into a wall', { cat: 'Draw', edit: true, icon: 'rectangle' });
  def('WINDOW', [], startTool('window'), 'Cut a window opening into a wall', { cat: 'Draw', edit: true, icon: 'rectangle' });
  def('EXTRUDE', ['EXT'], startTool('extrude'), 'Stand a closed outline up into a solid', { cat: 'Modify', edit: true, icon: 'explode' });
  /* the solid primitives */
  def('BOX', [], startTool('box3d'), 'Draw a solid box: two corners and a height', { cat: 'Draw', edit: true, icon: 'rectangle' });
  def('WEDGE', ['WE'], startTool('wedge'), 'Draw a solid wedge: two corners and a height', { cat: 'Draw', edit: true, icon: 'rectangle' });
  def('CYLINDER', ['CYL'], startTool('cylinder'), 'Draw a solid cylinder: centre, radius and height', { cat: 'Draw', edit: true, icon: 'circle' });
  def('CONE', [], startTool('cone'), 'Draw a solid cone: centre, radius and height', { cat: 'Draw', edit: true, icon: 'circle' });
  def('SPHERE', [], startTool('sphere'), 'Draw a solid sphere: centre and radius', { cat: 'Draw', edit: true, icon: 'circle' });
  def('PYRAMID', ['PYR'], startTool('pyramid'), 'Draw a solid pyramid: centre, base radius and height', { cat: 'Draw', edit: true, icon: 'rectangle' });
  def('3DFACE', ['3F'], startTool('face3d'), 'Draw a 3D face: three or four points', { cat: 'Draw', edit: true, icon: 'rectangle' });
  /* the Solid tab: the makers, the booleans, the editors */
  def('POLYSOLID', ['PSOLID'], startTool('polysolid'), 'Draw a solid like a polyline, with width and height [Object/Height/Width/Justify]', { cat: 'Draw', edit: true, icon: 'polysolid' });
  def('PRESSPULL', [], startTool('presspull'), 'Press or pull a bounded area into a solid', { cat: 'Modify', edit: true, icon: 'presspull' });
  def('REVOLVE', ['REV'], startTool('revolve'), 'Revolve a closed profile about an axis into a solid', { cat: 'Modify', edit: true, icon: 'revolve' });
  def('SWEEP', [], startTool('sweep'), 'Sweep a closed profile along a path into a solid', { cat: 'Modify', edit: true, icon: 'sweep' });
  def('LOFT', [], startTool('loft'), 'Loft a solid through two or more cross sections', { cat: 'Modify', edit: true, icon: 'loft' });
  def('UNION', ['UNI'], startTool('union3d'), 'Join solids into one', { cat: 'Modify', edit: true, icon: 'union' });
  def('SUBTRACT', ['SU'], startTool('subtract3d'), 'Carve one set of solids out of another', { cat: 'Modify', edit: true, icon: 'subtract' });
  def('INTERSECT', ['IN'], startTool('intersect3d'), 'Keep only the volume solids share', { cat: 'Modify', edit: true, icon: 'intersect' });
  def('SLICE', ['SL'], startTool('slice3d'), 'Cut solids with a plane [3points/XY/YZ/ZX]', { cat: 'Modify', edit: true, icon: 'slice' });
  def('SOLIDEDIT', [], startTool('solidedit'), 'Edit the faces of a solid [Face/Edge/Body]', { cat: 'Modify', edit: true, icon: 'taper-faces' });
  def('THICKEN', [], startTool('thicken'), 'Thicken a 3D face into a solid', { cat: 'Modify', edit: true, icon: 'thicken' });
  def('XEDGES', [], startTool('xedges'), 'Extract the edges of solids as lines', { cat: 'Modify', edit: true, icon: 'extract-edges' });
  def('INTERFERE', ['INF'], startTool('interfere'), 'Find where solids run into each other', { cat: 'Modify', edit: true, icon: 'interfere' });
  /* the Surface tab: sheets — open, two-sided face lists */
  def('PLANESURF', [], startTool('planesurf'), 'Create a planar surface from two corners or a closed outline', { cat: 'Draw', edit: true, icon: 'surf-planar' });
  def('SURFNETWORK', ['NETWORK'], startTool('surfnetwork'), 'Create a surface between the curves of two directions', { cat: 'Draw', edit: true, icon: 'surf-network' });
  def('SURFBLEND', [], startTool('surfblend'), 'Create a surface between two curves', { cat: 'Draw', edit: true, icon: 'surf-blend' });
  def('SURFPATCH', [], startTool('surfpatch'), 'Cap a closed outline with a surface', { cat: 'Draw', edit: true, icon: 'surf-patch' });
  def('SURFOFFSET', [], startTool('surfoffset'), 'Offset a surface along its own normals', { cat: 'Modify', edit: true, icon: 'surf-offset' });
  def('SURFSCULPT', [], startTool('surfsculpt'), 'Turn surfaces that enclose a watertight volume into a solid', { cat: 'Modify', edit: true, icon: 'surf-sculpt' });
  def('INTERSECTIONEXTRACT', [], startTool('xintersect'), 'Extract the curves where solids and surfaces cross, as lines', { cat: 'Modify', edit: true, icon: 'extract-intersections' });
  def('SECTIONPLANE', ['SPLANE'], startTool('sectionplane'), 'Lay a section object through the model [Draw section/Orthographic/Type]', { cat: 'Draw', edit: true, icon: 'section-plane' });
  def('LIVESECTION', [], startTool('livesection'), 'Start or stop a section object cutting the display', { cat: 'View', edit: true, icon: 'live-section' });
  /* the Mesh tab: subdivision bodies — a coarse base and a smoothness level */
  def('MESH', [], startTool('mesh3d'), 'Draw a mesh primitive [Box/Cone/CYlinder/Pyramid/Sphere/Wedge/Torus]', { cat: 'Draw', edit: true, icon: 'mesh-box' });
  def('MESHSMOOTH', ['SMOOTH'], startTool('meshsmooth'), 'Convert solids and surfaces to smooth meshes', { cat: 'Modify', edit: true, icon: 'mesh-smooth' });
  def('MESHSMOOTHMORE', [], startTool('meshsmoothmore'), 'Turn the smoothness of meshes up one level', { cat: 'Modify', edit: true, icon: 'smooth-more' });
  def('MESHSMOOTHLESS', [], startTool('meshsmoothless'), 'Turn the smoothness of meshes down one level', { cat: 'Modify', edit: true, icon: 'smooth-less' });
  def('MESHREFINE', [], startTool('meshrefine'), 'Bake the smoothed faces in as the new mesh base', { cat: 'Modify', edit: true, icon: 'mesh-refine' });
  def('MESHCREASE', [], startTool('meshcrease'), 'Hold a mesh sharp against its smoothing', { cat: 'Modify', edit: true, icon: 'add-crease' });
  def('MESHUNCREASE', [], startTool('meshuncrease'), 'Let a creased mesh smooth again', { cat: 'Modify', edit: true, icon: 'remove-crease' });
  def('MESHCAP', [], startTool('meshcap'), 'Close the open holes of meshes and surfaces', { cat: 'Modify', edit: true, icon: 'close-hole' });
  def('CONVTOSOLID', [], startTool('convtosolid'), 'Convert watertight meshes and surfaces to solids', { cat: 'Modify', edit: true, icon: 'conv-solid' });
  def('CONVTOSURFACE', [], startTool('convtosurface'), 'Convert meshes and solids to surfaces', { cat: 'Modify', edit: true, icon: 'conv-surface' });
  def('MESHPRIMITIVEOPTIONS', [], () => {
    if (N.meshPrimUI && N.meshPrimUI.open) N.meshPrimUI.open();
    else print('The Mesh Primitive Options dialog is unavailable.', 'err');
  }, 'Set the tessellation divisions the MESH primitives are built with', { cat: 'Draw', icon: 'mesh-box' });
  def('MESHOPTIONS', [], () => {
    if (N.meshTessUI && N.meshTessUI.open) N.meshTessUI.open();
    else print('The Mesh Tessellation Options dialog is unavailable.', 'err');
  }, 'Set how MESHSMOOTH converts solids and surfaces to meshes', { cat: 'Modify', icon: 'mesh-smooth' });
  def('PERSPECTIVE', [], startTool('perspective'),
    'Perspective projection on or off in a 3D view', { cat: 'View', trans: true, icon: 'orbit' });
  def('3DORBIT', ['3DO', 'ORBIT'], startTool('orbit'),
    'Orbit the view, its up direction held', { cat: 'View', trans: true, icon: 'orbit' });
  def('3DFORBIT', ['FORBIT'], startTool('forbit'),
    "Orbit the view freely with the arcball", { cat: 'View', trans: true, icon: 'orbit-free' });
  def('3DCORBIT', ['CORBIT'], startTool('corbit'),
    'Set the view orbiting and let it keep turning', { cat: 'View', trans: true, icon: 'orbit-continuous' });
  def('REGEN', ['RE'], () => {
    if (N.render) N.render();
    print('Regenerating model.');
    /* remote text follows its file on REGEN, exactly as RTEXT does */
    if (N.rtextUI && N.doc) N.rtextUI.refresh(N.doc);
  }, 'Regenerate the display', { cat: 'View', trans: true, icon: 'wheel' });
  def('PROPERTIES', ['PR', 'CH'], () => emit('nasj:open-palette', { which: 'properties' }), 'Open the properties palette', { cat: 'View', icon: 'properties' });
  def('VIEW', ['V'], () => {
    if (N.viewMgrUI) N.viewMgrUI.open();
    else print('The View Manager is unavailable.', 'err');
  }, 'Save, restore and manage named views (the View Manager)', { cat: 'View', icon: 'view-manager' });
  def('CUI', [], () => {
    if (N.cuiUI) N.cuiUI.open();
    else print('The CUI editor is unavailable.', 'err');
  }, 'Customize the user interface (the CUI editor)', { cat: 'Settings', icon: 'sb-gear' });
  def('VIEWSAVE', [], startTool('viewsave'), 'Save the current view by name', { cat: 'View', icon: 'new-view' });
  def('VIEWRESTORE', [], startTool('viewrestore'), 'Restore a named view', { cat: 'View', icon: 'named-view' });
  def('FIND', [], startTool('find'), 'Find text and zoom to the first match', { cat: 'View', icon: 'find-text' });
  /* Settings */
  def('GRID', [], toggleSetting('grid', 'Grid'), 'Toggle the grid', { cat: 'Settings', trans: true, icon: 'sb-grid' });
  def('SNAP', [], toggleSetting('snap', 'Snap'), 'Toggle grid snap', { cat: 'Settings', trans: true, icon: 'sb-snap' });
  def('ORTHO', [], toggleSetting('ortho', 'Ortho'), 'Toggle ortho mode', { cat: 'Settings', trans: true, icon: 'sb-ortho' });
  def('OSNAP', ['OS'], toggleSetting('osnap', 'Osnap'), 'Toggle object snap', { cat: 'Settings', trans: true, icon: 'sb-osnap' });
  /* alias 'POC', never 'PO' — POINT owns PO */
  def('POCHE', ['POC'], toggleSetting('poche', 'Poché'), 'Toggle poché wall fill (closed polylines on A-WALL* layers fill solid)', { cat: 'Settings', trans: true, icon: 'sb-grid' });
  def('OPTIONS', ['OP'], () => {
    if (N.optionsDialog && typeof N.optionsDialog.open === 'function') {
      N.optionsDialog.open();
    } else print('The Options dialog is unavailable in this build.', 'err');
  }, 'Open the Options dialog', { cat: 'Utility', icon: 'sb-gear' });
  def('DSETTINGS', ['DS', 'SE'], () => {
    /* the real tabbed dialog when the shell provides it; the text summary
       stays as the headless/QA fallback */
    if (N.dsettingsDialog && typeof N.dsettingsDialog.open === 'function') {
      N.dsettingsDialog.open();
      return;
    }
    const st = N.settings || {};
    const onOff = (k) => (st[k] ? 'On' : 'Off');
    print('Drafting settings:');
    print(`  Snap: ${onOff('snap')} (grid size ${st.gridSize || 10})   Grid: ${onOff('grid')}`);
    print(`  Ortho: ${onOff('ortho')}   Polar: ${onOff('polar')} (increment ${st.polarAng || 90}°)   Osnap: ${onOff('osnap')}   Otrack: ${onOff('otrack')}`);
    print(`  Dynamic input: ${onOff('dyn')}   Lineweight display: ${onOff('lwt')}`);
    const M = st.osnapModes || {};
    const names = { end: 'Endpoint', mid: 'Midpoint', cen: 'Center', gcen: 'Geometric Center', node: 'Node', quad: 'Quadrant', int: 'Intersection', ext: 'Extension', ins: 'Insertion', perp: 'Perpendicular', tan: 'Tangent', near: 'Nearest', appint: 'Apparent Intersection', par: 'Parallel' };
    const on = Object.keys(names).filter((k) => M[k]).map((k) => names[k]);
    print(`  Osnap modes: ${on.length ? on.join(', ') : '(none)'}`);
    print('  Right-click the OSNAP status button for snap modes, POLAR for the increment angle.');
  }, 'Show drafting settings (snap, grid, polar, osnap, dynamic input)', { cat: 'Settings', trans: true, icon: 'sb-gear' });
  def('SETVAR', ['SET'], startTool('setvar'), 'List or change a system variable', { cat: 'Settings', trans: true, icon: 'sysvars' });
  def('LIMITS', [], startTool('limits'), 'Set the model space drawing limits', { cat: 'Settings', icon: 'sb-units' });
  /* SELECTSIMILAR: grow the selection to every object of the same KIND on
     the same LAYER — the industry standard's default SELECTSIMILARMODE. A block matches
     by name too: two inserts of different blocks are not similar. */
  def('SELECTSIMILAR', ['SELSIM'], () => {
    const doc = N.doc;
    if (!doc) return;
    const sel = N.selection instanceof Set ? N.selection : new Set();
    if (!sel.size) {
      print('Select an object first — SELECTSIMILAR matches its kind and layer.', 'err');
      return;
    }
    const kindOf = (e) => JSON.stringify([e.type, e.layerId || '',
      e.type === 'insert' ? String(e.name || '') : '']);
    const kinds = new Set();
    for (const e of doc.entities) if (sel.has(e.id)) kinds.add(kindOf(e));
    const hid = N.hiddenIds instanceof Set ? N.hiddenIds : null;
    const out = [];
    for (const e of doc.entities) {
      if (hid && hid.has(e.id)) continue;      /* isolation hides them from a pick too */
      if (kinds.has(kindOf(e))) out.push(e.id);
    }
    N.setSelection(out);
    print(out.length + ' found.');
  }, 'Select every object of the same kind on the same layer', { cat: 'Utility', edit: true, icon: 'quickselect' });
  def('QSELECT', [], () => {
    if (N.qselectDialog && typeof N.qselectDialog.open === 'function') N.qselectDialog.open();
    else print('The Quick Select dialog is unavailable in this build.', 'err');
  }, 'Select objects by type and property — Quick Select', { cat: 'Utility', icon: 'quickselect' });
  def('NAVSWHEEL', ['WHEEL', 'STEERINGWHEELS'], () => {
    if (N.navWheel && typeof N.navWheel.toggle === 'function') N.navWheel.toggle();
    else print('The steering wheel is unavailable in this build.', 'err');
  }, 'Show the steering wheel — pan, zoom and rewind at the cursor', { cat: 'View', icon: 'nav-wheel' });
  def('ACTRECORD', [], () => actStart(), 'Start the Action Recorder', { cat: 'Utility', icon: 'record' });
  def('ACTSTOP', [], startTool('actstop'), 'Stop the Action Recorder and save the macro', { cat: 'Utility', icon: 'record' });
  def('ACTPLAY', [], startTool('actplay'), 'Play a recorded macro', { cat: 'Utility', icon: 'record' });
  def('QUICKCALC', ['QC', 'CALCULATOR', 'CAL'], () => {
    if (N.quickCalc) N.quickCalc.open();
    else print('The calculator is unavailable in this release.', 'err');
  }, 'Open the quick calculator palette', { cat: 'Utility', trans: true, icon: 'calc' });
  /* TEXTSCR / GRAPHSCR — the industry standard's Text Window, which F2 toggles. TEXTSCR
     toggles it here too, so the key, the command and the ribbon button are
     one behaviour. */
  def('TEXTSCR', ['TEXTWINDOW'], () => {
    if (!N.textWindow) { print('The Text Window is unavailable.', 'err'); return; }
    print(N.textWindow.open() ? 'Text Window opened.' : 'Text Window closed.');
  }, 'Open the Text Window — the whole command history (F2)',
  { cat: 'View', trans: true, icon: 'text-window' });
  def('GRAPHSCR', [], () => {
    if (N.textWindow) N.textWindow.close();
  }, 'Close the Text Window and return to the drawing (F2)',
  { cat: 'View', trans: true, icon: 'text-window' });
  /* TOOLPALETTES — the tool board Ctrl+3 toggles. The industry standard's TOOLPALETTES
     opens and TOOLPALETTESCLOSE closes; the key toggles, so this one does
     too, and says which way it went. */
  def('TOOLPALETTES', ['TP', 'TOOLPALETTESOPEN'], () => {
    if (!N.toolPalettes) { print('The Tool Palettes window is unavailable.', 'err'); return; }
    print(N.toolPalettes.toggle() ? 'Tool Palettes opened.' : 'Tool Palettes closed.');
  }, 'Open or close the Tool Palettes window (Ctrl+3)',
  { cat: 'View', trans: true, icon: 'tool-palettes' });
  def('TOOLPALETTESCLOSE', [], () => {
    if (N.toolPalettes) N.toolPalettes.close();
  }, 'Close the Tool Palettes window',
  { cat: 'View', trans: true, icon: 'tool-palettes' });
  /* CLEANSCREEN: the ribbon, the file tabs and the palettes step aside so
     the drawing has the window. The industry standard's ON and OFF are separate commands
     and Ctrl+0 toggles, so all three are here. */
  const cleanScreen = (mode) => () => {
    if (!N.cleanScreen) { print('Clean screen is unavailable.', 'err'); return; }
    if (mode === 'toggle') N.cleanScreen.toggle(); else N.cleanScreen.set(mode === 'on');
  };
  def('CLEANSCREEN', ['CLEANSCREENTOGGLE'], cleanScreen('toggle'),
    'Hide the ribbon, the file tabs and the palettes, leaving the drawing (Ctrl+0)',
    { cat: 'View', trans: true, icon: 'sb-fullscreen' });
  def('CLEANSCREENON', [], cleanScreen('on'), 'Clear the screen down to the drawing',
    { cat: 'View', trans: true, icon: 'sb-fullscreen' });
  def('CLEANSCREENOFF', [], cleanScreen('off'), 'Bring the ribbon and palettes back',
    { cat: 'View', trans: true, icon: 'sb-fullscreen' });
  /* the material palettes and the Visual Styles Manager — the industry standard's names,
     the OPEN commands toggling the way QUICKCALC does */
  def('MATBROWSEROPEN', ['MAT', 'MATERIALS'], () => {
    if (N.materialsUI) N.materialsUI.browser();
    else print('The Materials Browser is unavailable.', 'err');
  }, 'Open the Materials Browser palette', { cat: 'View', icon: 'materials-browser' });
  def('MATBROWSERCLOSE', [], () => {
    if (N.materialsUI) N.materialsUI.browserClose();
  }, 'Close the Materials Browser palette', { cat: 'View', icon: 'materials-browser' });
  def('MATEDITOROPEN', [], () => {
    if (N.materialsUI) N.materialsUI.editor();
    else print('The Materials Editor is unavailable.', 'err');
  }, 'Open the Materials Editor palette', { cat: 'View', icon: 'materials-editor' });
  def('MATEDITORCLOSE', [], () => {
    if (N.materialsUI) N.materialsUI.editorClose();
  }, 'Close the Materials Editor palette', { cat: 'View', icon: 'materials-editor' });
  /* ARCTEXT — Express Tools' Arc Aligned text: pick an arc, and the
     ArcAlignedText Workshop lays the words along it letter by letter. */
  def('ARCTEXT', [], startTool('arctext'),
    'Place text along an arc (Extra Tools: Arc Aligned)',
    { cat: 'Annotate', edit: true, icon: 'arc-text' });
  /* TCOUNT — Express Tools' Auto Number: sort the picked texts, count from
     a start by an increment, and put the number in each string. */
  def('TCOUNT', [], startTool('tcount'),
    'Number text objects in sequence — prefix, suffix, overwrite or find and replace (Extra Tools: Auto Number)',
    { cat: 'Annotate', edit: true, icon: 'auto-number' });
  /* TXT2MTXT — Express Tools' Convert to Mtext: the picked texts become one
     multiline text, or each its own, by the Text to MText Settings sheet.
     COMBINETEXT is the same command's newer name in the industry standard. */
  def('TXT2MTXT', ['COMBINETEXT'], startTool('txt2mtxt'),
    'Convert text to multiline text — combine, order and word-wrap (Extra Tools: Convert to Mtext)',
    { cat: 'Annotate', edit: true, icon: 'convert-mtext' });
  /* TCIRCLE — Express Tools' Enclose Text with Object: circles, slots or
     rectangles drawn around the picked texts. */
  def('TCIRCLE', [], startTool('tcircle'),
    'Surround text or mtext with circles, slots, or rectangles (Extra Tools: Enclose in Object)',
    { cat: 'Annotate', edit: true, icon: 'enclose-object' });
  /* Express Tools ▸ Modify Text — the industry standard's five, the flyout's own order */
  def('TXTEXP', [], startTool('txtexp'),
    'Explode text into the polylines that draw it (Extra Tools: Explode Text)',
    { cat: 'Annotate', edit: true, icon: 'text-explode' });
  def('TCASE', [], startTool('tcase'),
    'Change the case of text — sentence, lower, UPPER, Title or tOGGLE (Extra Tools: Change Case)',
    { cat: 'Annotate', edit: true, icon: 'text-case' });
  def('TORIENT', [], startTool('torient'),
    'Rotate text to an absolute angle, or stand upside-down text back up (Extra Tools: Rotate Text)',
    { cat: 'Annotate', edit: true, icon: 'text-rotate' });
  def('TEXTFIT', [], startTool('textfit'),
    'Stretch text between two points by its width factor (Extra Tools: Text Fit)',
    { cat: 'Annotate', edit: true, icon: 'text-fit' });
  def('TJUST', [], startTool('tjust'),
    'Change text justification without moving the text (Extra Tools: Justify Text)',
    { cat: 'Annotate', edit: true, icon: 'text-justify' });
  /* SHEETSET — the Sheet Set Manager, Ctrl+4. This release has no .dst
     files; its sheet set is the session itself — every open drawing's
     layout tabs are its sheets, and the palette reads them live. */
  def('SHEETSET', ['SSM'], () => {
    if (!N.sheetsetUI) { print('The Sheet Set Manager is unavailable.', 'err'); return; }
    print(N.sheetsetUI.toggle()
      ? 'Sheet Set Manager opened. ' + N.sheetsetUI.count() + ' sheet(s) across the open drawings.'
      : 'Sheet Set Manager closed.');
  }, 'Open or close the Sheet Set Manager — the open drawings\' layout sheets (Ctrl+4)',
  { cat: 'View', trans: true, icon: 'sheet-set' });
  def('SHEETSETHIDE', [], () => {
    if (N.sheetsetUI) N.sheetsetUI.close();
  }, 'Close the Sheet Set Manager',
  { cat: 'View', trans: true, icon: 'sheet-set' });
  /* Lights. A light is data about how a scene would be lit — the same
     standing a material has here — so it is created, named, aimed, edited,
     selected and saved whether or not anything ever shades it. Point and
     spot lights draw a glyph; a distant light draws none, which is what the
     Lights in Model palette's own note tells the user. */
  def('POINTLIGHT', [], startTool('pointlight'),
    'Create a point light — source location, then its settings',
    { cat: 'View', edit: true, icon: 'light-point' });
  def('SPOTLIGHT', [], startTool('spotlight'),
    'Create a spot light — source and target, then its settings',
    { cat: 'View', edit: true, icon: 'light-spot' });
  def('DISTANTLIGHT', [], startTool('distantlight'),
    'Create a distant light — the direction its parallel rays travel',
    { cat: 'View', edit: true, icon: 'light-distant' });
  def('LIGHTLIST', ['LIGHTS'], () => {
    if (!N.lightsUI) { print('The Lights in Model palette is unavailable.', 'err'); return; }
    const n = N.lightsUI.count();
    print(N.lightsUI.toggle()
      ? 'Lights in Model opened. ' + (n ? n + ' light(s) in the model.' : 'No lights in the model.')
      : 'Lights in Model closed.');
  }, 'Open or close the Lights in Model palette',
  { cat: 'View', trans: true, icon: 'light-list' });
  def('LIGHTLISTCLOSE', [], () => {
    if (N.lightsUI) N.lightsUI.close();
  }, 'Close the Lights in Model palette',
  { cat: 'View', trans: true, icon: 'light-list' });
  /* The sun. Its angle really is calculated from the date, the time and the
     drawing's own place on the globe, so SUNPROPERTIES reports it. */
  def('SUNPROPERTIES', ['SUN'], () => {
    if (!N.sunUI) { print('The Sun Properties palette is unavailable.', 'err'); return; }
    if (!N.sunUI.toggle()) { print('Sun Properties closed.'); return; }
    const p = N.sunUI.position();
    print('Sun Properties opened. Azimuth ' + p.azimuth.toFixed(4) +
      '°, altitude ' + p.altitude.toFixed(4) + '°.');
  }, 'Open or close the Sun Properties palette — the sun, the sky and its angle',
  { cat: 'View', trans: true, icon: 'sun-props' });
  def('SUNPROPERTIESCLOSE', [], () => {
    if (N.sunUI) N.sunUI.close();
  }, 'Close the Sun Properties palette',
  { cat: 'View', trans: true, icon: 'sun-props' });
  def('GEOGRAPHICLOCATION', ['GEO', 'NORTH'], startTool('geoloc'),
    "Set the drawing's latitude, longitude, time zone and north direction",
    { cat: 'View', icon: 'set-location' });

  /* RENDERPRESETS — the Render Presets Manager. RPREF opens the same palette
     in the modern industry standard, so it is an alias rather than a second window. What
     the presets configure — RENDER itself — is in the compat table below:
     this release has no render engine, and the palette does not pretend it
     does, exactly as materials exist without anything shading them. */
  def('RENDERPRESETS', ['RP', 'RPREF', 'RPR'], () => {
    if (!N.renderPresetsUI) { print('The Render Presets Manager is unavailable.', 'err'); return; }
    print(N.renderPresetsUI.toggle()
      ? 'Render Presets Manager opened. Current preset: ' + N.renderPresetsUI.current() + '.'
      : 'Render Presets Manager closed.');
  }, 'Open or close the Render Presets Manager — render size, duration and accuracy',
  { cat: 'View', trans: true, icon: 'render-presets' });
  def('RENDERPRESETSCLOSE', [], () => {
    if (N.renderPresetsUI) N.renderPresetsUI.close();
  }, 'Close the Render Presets Manager',
  { cat: 'View', trans: true, icon: 'render-presets' });
  def('VISUALSTYLES', ['VSM'], () => {
    if (N.vstyleUI) N.vstyleUI.open();
    else print('The Visual Styles Manager is unavailable.', 'err');
  }, 'Open the Visual Styles Manager', { cat: 'View', icon: 'visual-styles' });
  def('ACTIVITYINSIGHTSOPEN', ['ACTIVITYINSIGHTS'], () => {
    if (N.activityUI) N.activityUI.open();
    else print('The Activity Insights palette is unavailable.', 'err');
  }, 'Open or close the Activity Insights palette — the drawing\'s history',
  { cat: 'View', icon: 'activity-insights' });
  def('ACTIVITYINSIGHTSCLOSE', [], () => {
    if (N.activityUI) N.activityUI.close();
  }, 'Close the Activity Insights palette', { cat: 'View', icon: 'activity-insights' });
  /* Express Tools ▸ Blocks — the nested-object family */
  def('NCOPY', [], startTool('ncopy'),
    'Copy objects nested inside a block or xref into the drawing',
    { cat: 'Modify', edit: true, icon: 'copy-nested' });
  def('BLOCKTOXREF', [], startTool('blocktoxref'),
    'Replace every reference of a block with an external reference',
    { cat: 'Blocks', edit: true, icon: 'block-to-xref' });
  /* TRIM and EXTEND here already reach nested geometry — an insert offered
     as an edge cuts with the block's own lines — so the B variants are the
     same tools, said out loud. */
  def('BTRIM', [], () => {
    print('Nested edges are live here — a block reference offered as a cutting edge cuts.');
    N.tools.start('trim');
  }, 'Trim to cutting edges inside blocks or xrefs', { cat: 'Modify', edit: true, icon: 'trim-nested' });
  def('BEXTEND', [], () => {
    print('Nested edges are live here — a block reference offered as a boundary bounds.');
    N.tools.start('extend');
  }, 'Extend to boundary edges inside blocks or xrefs', { cat: 'Modify', edit: true, icon: 'extend-nested' });
  /* Express Tools ▸ Text — remote text and the mask pair */
  def('RTEXT', [], startTool('rtext'),
    'Place text read from a file or a DIESEL expression — REGEN re-reads it (Remote Text)',
    { cat: 'Annotate', edit: true, icon: 'remote-text' });
  def('TEXTMASK', [], startTool('textmask'),
    'Mask what lies behind text with a background patch',
    { cat: 'Annotate', edit: true, icon: 'text-mask' });
  def('TEXTUNMASK', [], startTool('textunmask'),
    'Remove the mask behind text',
    { cat: 'Annotate', edit: true, icon: 'unmask-text' });
  /* Express Tools ▸ Modify */
  def('FLATTEN', [], startTool('flatten'),
    'Press 3D geometry onto the XY plane — every z zeroed, a box to its plan',
    { cat: 'Modify', edit: true, icon: 'flatten-obj' });
  def('CLIPIT', [], startTool('clipit'),
    'Clip a block or xref with a polyline, circle, arc or ellipse (Extended Clip)',
    { cat: 'Modify', edit: true, icon: 'ext-clip' });
  def('EXOFFSET', [], () => {
    print("EXOFFSET's Through, Erase and Layer options live in OFFSET here, " +
      'Multiple included — one object at a time.');
    N.tools.start('offset');
  }, 'Offset with the extended options (Extended Offset)',
  { cat: 'Modify', edit: true, icon: 'ext-offset' });
  def('EXPLAN', [], startTool('explan'),
    'Plan view, framed on a selection (Extended Plan)',
    { cat: 'View', icon: 'ext-plan' });
  def('MKLTYPE', [], startTool('mkltype'),
    'Make a linetype from selected geometry — it loads live and travels with the drawing',
    { cat: 'Settings', edit: true, icon: 'make-ltype' });
  def('MKSHAPE', [], startTool('mkshape'),
    'Write selected geometry as a .shp shape source file (Make Shape)',
    { cat: 'Blocks', icon: 'make-shape' });
  def('VPSCALE', [], startTool('vpscale'),
    'List the paper-to-model scale of a layout viewport (List Viewport Scale)',
    { cat: 'View', icon: 'vp-scale' });
  def('SHP2BLK', [], () => {
    print('Shape (SHP) entities are not in this release — there is no shape to convert. ' +
      'BLOCK (B) turns selected geometry into a block definition.', 'err');
  }, 'Convert a shape entity to a block (Convert Shape to Block)',
  { cat: 'Blocks', icon: 'shape-to-block' });
  /* COUNT — how many of each block the drawing holds. The industry standard shows this in
     a palette; here it is the tally itself, on the command line. */
  def('COUNT', [], () => {
    const doc = N.doc;
    if (!doc) return;
    const tally = new Map();
    for (const e of doc.entities) {
      if (e.type !== 'insert') continue;
      const nm = String(e.name || '(unnamed)');
      tally.set(nm, (tally.get(nm) || 0) + 1);
    }
    if (!tally.size) { print('No block references in the drawing.'); return; }
    const rows = [...tally.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const w = Math.max(...rows.map((r) => r[0].length)) + 3;
    let total = 0;
    print('Block references in the drawing:');
    for (const [nm, n] of rows) { total += n; print(`  ${nm.padEnd(w)}${n}`); }
    print(`  ${'Total'.padEnd(w)}${total} in ${rows.length} block` +
      (rows.length === 1 ? '' : 's') + '.');
  }, 'Count the block references in the drawing', { cat: 'Blocks', icon: 'count' });
  /* Count Selection (the selection right-click row): COUNT's tally, but
     over the picked objects instead of the whole drawing */
  def('COUNTSEL', [], () => {
    const doc = N.doc;
    if (!doc) return;
    const sel = N.selection instanceof Set ? N.selection : new Set();
    if (!sel.size) { print('Nothing is selected.', 'err'); return; }
    const tally = new Map();
    let n = 0;
    for (const e of doc.entities) {
      if (!sel.has(e.id)) continue;
      n++;
      if (e.type !== 'insert') continue;
      const nm = String(e.name || '(unnamed)');
      tally.set(nm, (tally.get(nm) || 0) + 1);
    }
    if (!tally.size) {
      print(n + ' object' + (n === 1 ? '' : 's') + ' selected, no block references among them.');
      return;
    }
    const rows = [...tally.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const w = Math.max(...rows.map((r) => r[0].length)) + 3;
    let total = 0;
    print('Block references in the selection:');
    for (const [nm, k] of rows) { total += k; print('  ' + nm.padEnd(w) + k); }
    print('  ' + 'Total'.padEnd(w) + total + ' in ' + rows.length + ' block' +
      (rows.length === 1 ? '' : 's') + ', of ' + n + ' selected.');
  }, 'Count the block references among the selected objects', { cat: 'Blocks', edit: true, icon: 'count' });
  def('UNITS', ['UN', 'DDUNITS'], () => {
    if (N.unitsDialog) N.unitsDialog.open();
    else print('Drawing units are unavailable in this release.', 'err');
  }, 'Set the display format and precision of lengths and angles', { cat: 'Settings', icon: 'sb-units' });
  def('COLOR', [], startTool('color'), 'Set the current color and recolor the selection', { cat: 'Settings', edit: true, icon: 'color-wheel' });
  def('LINETYPE', ['LT'], startTool('linetype'), 'Set the current linetype and apply to the selection', { cat: 'Settings', edit: true, icon: 'linetype-icon' });
  def('LWEIGHT', ['LW'], startTool('lweight'), 'Set the current lineweight and apply to the selection', { cat: 'Settings', edit: true, icon: 'lineweight-icon' });
  /* Clipboard */
  def('COPYCLIP', [], startTool('copyclip'), 'Copy selection to clipboard', { cat: 'Clipboard', icon: 'copyclip' });
  def('CUTCLIP', [], startTool('cutclip'), 'Cut selection to clipboard', { cat: 'Clipboard', edit: true, icon: 'cut' });
  def('COPYBASE', [], startTool('copybase'), 'Copy the selection with a base point for pasting', { cat: 'Clipboard', icon: 'copyclip' });
  def('CUTBASE', [], startTool('cutbase'), 'Cut the selection with a base point for pasting', { cat: 'Clipboard', edit: true, icon: 'cut' });
  def('PASTEASHYPERLINK', [], () => print('PASTEASHYPERLINK — hyperlinks are not in this release.', 'err'),
    'Paste clipboard contents as a hyperlink', { cat: 'Clipboard' });
  def('PASTESPEC', ['PA'], () => {
    if (N.pasteSpecialDialog && typeof N.pasteSpecialDialog.open === 'function') N.pasteSpecialDialog.open();
    else print('The Paste Special dialog is unavailable in this build.', 'err');
  }, 'Paste clipboard contents in a chosen format', { cat: 'Clipboard', icon: 'paste' });
  def('PASTECLIP', ['PASTE'], () => N.clipboard.paste(), 'Paste clipboard contents', { cat: 'Clipboard', edit: true, icon: 'paste' });
  def('PASTEBLOCK', [], () => N.clipboard.pasteBlock(), 'Paste clipboard contents as a block', { cat: 'Clipboard', edit: true, icon: 'paste-block' });
  def('PASTEORIG', [], () => N.clipboard.pasteOrig(), 'Paste to the coordinates the objects were copied from', { cat: 'Clipboard', edit: true, icon: 'paste-orig' });
  /* File */
  def('NEW', [], fileAction('new'), 'Create a new drawing', { cat: 'File', icon: 'qnew' });
  def('OPEN', [], fileAction('open'), 'Open a drawing', { cat: 'File', icon: 'qopen' });
  /* the Insert ▸ Import panel: a file brought INTO this drawing, not opened
     as another one — so each of the three changes geometry (edit: true) */
  def('IMPORT', ['IMP'], fileAction('import'), 'Import a file into this drawing',
    { cat: 'File', edit: true, icon: 'file-import' });
  def('PDFIMPORT', [], fileAction('pdfimport'), "Import a PDF page's geometry",
    { cat: 'File', edit: true, icon: 'pdf-import' });
  def('DGNIMPORT', [], fileAction('dgnimport'), 'Import a MicroStation DGN file',
    { cat: 'File', edit: true, icon: 'dgn-import' });
  def('IMAGEATTACH', ['IAT'], fileAction('imageattach'), 'Attach an image to the drawing',
    { cat: 'Insert', edit: true, icon: 'image-attach' });
  def('SAVE', [], fileAction('save'), 'Save the drawing', { cat: 'File', icon: 'qsave' });
  def('SAVEAS', [], fileAction('saveas'), 'Save the drawing as…', { cat: 'File', icon: 'saveas' });
  def('EXPORTPNG', [], fileAction('exportpng'), 'Export the view as PNG', { cat: 'File', icon: 'export-png' });
  def('EXPORTPDF', [], fileAction('exportpdf'), 'Export the drawing as PDF', { cat: 'File', icon: 'export-pdf' });
  def('PLOT', [], fileAction('plot'), 'Print the drawing', { cat: 'File', icon: 'plot' });
  /* the industry standard's Page Setup Manager is a subset of the Plot dialog here: the
     same dialog owns named setups, Apply to Layout and Save changes */
  def('PAGESETUP', [], fileAction('plot'), 'Manage page setups (opens the Plot dialog)', { cat: 'File', icon: 'page-setup' });
  /* the two halves of a layout: the sheet, and the model seen through a frame */
  const spaceCmd = (which) => () => {
    const ops = N.spaceOps;
    if (!ops || !ops[which]()) { print('Only a layout has paper space — open a layout tab first.', 'err'); return; }
    print(which === 'mspace'
      ? 'Model space: the viewport is active.' : 'Paper space: the sheet is active.');
  };
  def('MSPACE', ['MS'], spaceCmd('mspace'), 'Work in model space inside the layout viewport', { cat: 'View', icon: 'layout-tabs-toggle' });
  def('PSPACE', ['PS'], spaceCmd('pspace'), 'Work on the layout sheet', { cat: 'View', icon: 'layout-tabs-toggle' });
  def('CLOSE', [], fileAction('close'), 'Close the drawing', { cat: 'File', icon: 'close-doc' });
  /* QUIT asks about every unsaved drawing in turn, and Cancel on any one of
     them leaves the app open — the industry standard's behaviour, and the reason it is a
     three-button box rather than a plain confirm. */
  def('QUIT', ['EXIT'], fileAction('quit'), 'Leave Nasjicad, offering to save every changed drawing',
    { cat: 'File', icon: 'close-doc' });
  def('CLOSEALL', [], fileAction('closeall'), 'Close every open drawing', { cat: 'File', icon: 'close-doc' });
  def('SAVEALL', [], fileAction('saveall'), 'Save every drawing that has changed', { cat: 'File', icon: 'qsave' });
  def('NEWFROM', [], fileAction('newfrom'), 'Start a new drawing from an existing one', { cat: 'File', icon: 'file-drawing' });
  /* Utility */
  def('DIST', ['DI', 'MEA'], startTool('dist'), 'Measure distance and angle between two points', { cat: 'Utility', trans: true, icon: 'measure' });
  def('MEASUREGEOM', ['MG'], startTool('measuregeom'), 'Measure objects — quick pick, radius, angle, area, volume', { cat: 'Utility', icon: 'measure-quick' });
  def('MEASURE', ['ME'], startTool('measureseg'), 'Place point nodes at fixed intervals along an object', { cat: 'Utility', edit: true, icon: 'measure' });
  def('ID', [], startTool('id'), 'Print the coordinates of a picked point', { cat: 'Utility', trans: true, icon: 'set-location' });
  def('OOPS', [], () => {
    const doc = N.doc;
    if (!doc) return;
    const items = (N.pref && N.pref.oops) || [];
    if (!items.length) { print('Nothing to restore.', 'err'); return; }
    N.docOps.pushUndo(doc);
    const ids = [];
    for (const e of items) {
      const c = JSON.parse(JSON.stringify(e));
      delete c.id;
      if (!doc.layers.some((l) => l.id === c.layerId)) c.layerId = doc.currentLayerId;
      ids.push(N.docOps.addEntity(doc, c).id);
    }
    N.pref.oops = [];
    if (N.setSelection) N.setSelection(ids);
    docTouched(doc);
    print(`${ids.length} erased object(s) restored.`);
  }, 'Restore the most recently erased objects', { cat: 'Utility', edit: true, icon: 'undo' });
  def('LIST', ['LI'], startTool('list'), 'List type, layer, color and geometry of objects', { cat: 'Utility', icon: 'list-props' });
  def('AREA', ['AA'], startTool('area'), 'Report the area and perimeter of a traced ring or an object', { cat: 'Utility', icon: 'calc' });
  def('PURGE', [], doPurge, 'Remove unused block definitions and empty layers', { cat: 'Utility', edit: true, icon: 'purge' });
  def('AUDIT', [], doAudit, 'Check the drawing and repair invalid objects', { cat: 'Utility', edit: true, icon: 'audit' });
  def('ALIGN', ['AL'], startTool('align'), 'Move, rotate and optionally scale objects onto two destination points', { cat: 'Modify', edit: true, icon: 'move' });
  def('APERTURE', [], startTool('aperture'), 'Set the object snap target box size in pixels', { cat: 'Settings', icon: 'sb-osnap' });
  def('ZOOMFACTOR', [], startTool('zoomfactor'), 'Set how much one mouse wheel notch zooms (3-100 percent)', { cat: 'View', trans: true, icon: 'zoom-in' });
  def('ABOUT', [], () => {
    print(('Nasjicad V' + (window.NASJ_VERSION || '')) + ' — professional 2D CAD for Windows.');
    print('DWG/DXF files, dimensions, hatches, layouts, groups and PDF plotting.');
  }, 'About Nasjicad', { cat: 'Utility', icon: 'qnew' });
  def('ACADINFO', [], () => {
    const doc = N.doc || {};
    print(('Nasjicad V' + (window.NASJ_VERSION || '')) + ' — drawing "' + (doc.name || 'Drawing') + '": ' +
      ((doc.entities || []).length) + ' entities, ' + ((doc.layers || []).length) + ' layers, ' +
      Object.keys(doc.blocks || {}).length + ' blocks, ' + ((doc.groups || []).length) + ' groups.');
  }, 'Print drawing and version diagnostics', { cat: 'Utility', icon: 'qnew' });
  /* ADDSELECTED: draw another of whatever is selected, the industry standard's shortcut */
  def('ADDSELECTED', [], () => {
    const doc = N.doc;
    const id = (N.selection && N.selection.size) ? Array.from(N.selection)[0] : null;
    const e = (id && doc) ? N.docOps.entityById(doc, id) : null;
    if (!e) { print('Select an object first — ADDSELECTED draws another of its kind.', 'err'); return; }
    const map = {
      line: 'LINE', polyline: 'PLINE', circle: 'CIRCLE', arc: 'ARC', ellipse: 'ELLIPSE',
      spline: 'SPLINE', point: 'POINT', hatch: 'HATCH', mline: 'MLINE',
      leader: 'LEADER', table: 'TABLE', dim: 'DIMLINEAR', insert: 'INSERT',
      text: e.mt ? 'MTEXT' : 'TEXT', xline: e.ray ? 'RAY' : 'XLINE',
    };
    const cmd = map[e.type];
    if (!cmd || !INDEX[cmd]) { print('ADDSELECTED cannot draw a ' + e.type + '.', 'err'); return; }
    execute(cmd);
  }, 'Start drawing another object of the selected kind', { cat: 'Draw', edit: true, icon: 'qnew' });
  def('ARRAYCLASSIC', [], startTool('array'), 'Array objects — the classic entry to ARRAY', { cat: 'Modify', edit: true, icon: 'array' });
  def('ARRAYCLOSE', [], () => {
    if (N.arrayTool) N.arrayTool.commit(); else print('No array is being edited.', 'err');
  }, 'Save the array and close the Array Creation tab', { cat: 'Modify', icon: 'array' });
  def('ARRAYEDIT', [], () => {
    print('Associative arrays are not in this release — the arrays Nasjicad places are plain copies.', 'err');
  }, 'Edit an associative array', { cat: 'Modify', icon: 'array' });
  def('ACADBLOCKDIALOG', [], startTool('block'), 'Create a block (the BLOCK dialog name)', { cat: 'Blocks', edit: true, icon: 'block-create' });
  /* the annotation-scale trio: this release has one annotation scale, so
     visibility and updates are already what they ask for */
  def('ANNOALLVISIBLE', [], () => print('ANNOALLVISIBLE = 1 — annotative objects show at every scale in this release.'),
    'Show annotative objects at all scales', { cat: 'Annotate', icon: 'sb-annovis' });
  def('ANNOUPDATE', [], () => print('0 annotative object(s) updated — dimensions here follow their scale live.'),
    'Update annotative objects to the current scale', { cat: 'Annotate', icon: 'sb-annoauto' });
  def('ANNORESET', [], () => print('0 annotative object(s) reset.'),
    'Reset annotative object scale positions', { cat: 'Annotate', icon: 'sb-annoauto' });

  /* ---------------- the industry standard's compatibility names ----------------
     Every command the industry standard's popup offers under A is recognized here; the
     ones whose features Nasjicad does not ship say so plainly instead of
     answering "Unknown command". */
  const compat = (what, names) => {
    for (const n of names) {
      def(n, [], () => print(n + ' — ' + what, 'err'), what, { cat: 'Compat' });
    }
  };
  compat('an architectural add-on command; not part of Nasjicad.',
    ['AECVERSION', 'AEC3DPRINT', 'AECFILEOPENMESSAGE', 'AECFILESAVEMESSAGE',
      'AECOBJECTCOPYMESSAGE', 'AECTOACAD']);
  /* ACTRECORD / ACTSTOP are real now (defined above); only the corners of
     the Action Recorder that still do not exist stay as compat stubs */
  compat('part of the Action Recorder, which is not in this release.',
    ['ACTMANAGER', 'ACTUSERINPUT', 'ACTUSERMESSAGE', 'ACTBASEPOINT', 'ALLPLAY']);
  compat('3D surface analysis, which is not in this release.',
    ['ANALYSISOPTIONS', 'ANALYSISCURVATURE', 'ANALYSISDRAFT', 'ANALYSISZEBRA']);
  compat('ACIS solid exchange, which is not in this release.',
    ['ACISIN', 'ACISOUT']);
  /* RENDERPRESETS is real and above: the presets are data, and they save and
     edit whether or not anything shades them. Producing the picture is what
     needs the engine this release has no part of. */
  compat('the render engine, which is not in this release — RENDERPRESETS ' +
    'still keeps the presets a render would use.',
  ['RENDER', 'RR', 'RENDERCROP', 'RC', 'RENDERWIN', 'RW', 'RENDERENVIRONMENT',
    'RENDEREXPOSURE', 'RENDERONLINE', 'ANIPATH']);
  compat('part of the Content Center, which is not in this release.',
    ['ADCENTER', 'ADC', 'ADCCLOSE', 'ADCNAVIGATE', 'ADCCUSTOMNAVIGATE']);
  /* ATTDEF, ATTSYNC and BATTMAN are real now; these are the rest of the
     attribute family, still to come */
  compat('editing attribute values in place, which is not in this release.',
    ['ATTEDIT', 'ATE', 'ATTIPEDIT', 'ATI', 'ATTDISP', 'ATTEXT']);
  compat('add-on loading, which is not in this release.',
    ['APPLOAD', 'AP', 'ARX', 'APPAUTOLOADER']);
  compat('an internal dimension helper of another program; not part of Nasjicad.',
    ['AIDIMFLIPARROW', 'AIDIMPREC', 'AIDIMSTYLE', 'AIDIMTEXTMOVE']);
  compat('multileader editing, which is not in this release.',
    ['AIMLEADEREDITADD', 'AIMLEADEREDITREMOVE']);
  compat('an Express Tools UCS preset; the UCS here moves only its origin.',
    ['ACETUCS-TOP', 'ACETUCS-BOTTOM', 'ACETUCS-BACK', 'ACETUCS-FRONT',
      'ACETUCS-LEFT', 'ACETUCS-RIGHT']);
  compat('a markup assist command; not part of Nasjicad.',
    ['ACMRBASEPOINT', 'ACMRSELECT', 'ACPTOOLTIPS']);
  compat('block authoring actions, which are not in this release.', ['AC', 'BACTION']);
  compat('sheet-set archiving, which is not in this release.', ['ARCHIVE']);
  compat('automatic publishing, which is not in this release.', ['AUTOPUBLISH']);
  compat('animation paths, which are not in this release.', ['ANIPATH']);
  /* Insert ▸ Reference. An external reference is a drawing on disk shown
     inside this one: ATTACH reads it, and the rest of the panel works on
     what ATTACH put there. CLIP and REFEDIT take plain blocks too, the way
     the industry standard's do — a reference is a block that remembers a file. */
  def('ATTACH', ['XATTACH', 'XA'], () => {
    if (N.attachUI) N.attachUI.open();
    else print('The Attach dialog is unavailable.', 'err');
  }, 'Attach a drawing as an external reference', { cat: 'Blocks', edit: true, icon: 'attach' });
  def('XREF', ['XR', 'EXTERNALREFERENCES', 'ER'], () => {
    if (N.xrefUI) N.xrefUI.open();
    else print('The External References palette is unavailable.', 'err');
  }, 'List, reload, unload, detach or bind the external references',
  { cat: 'Blocks', icon: 'xref' });
  def('CLIP', ['XCLIP', 'XC'], startTool('xclip'),
    'Clip a reference or block to a boundary', { cat: 'Blocks', edit: true, icon: 'clip' });
  def('ADJUST', [], () => {
    if (N.adjustUI) N.adjustUI.open();
    else print('The Adjust dialog is unavailable.', 'err');
  }, 'Fade a reference back, or bring it forward', { cat: 'Blocks', edit: true, icon: 'adjust' });
  def('ULAYERS', [], () => {
    if (N.ulayersUI) N.ulayersUI.open();
    else print("The reference layer list is unavailable.", 'err');
  }, "Switch a reference's own layers on and off", { cat: 'Blocks', icon: 'underlay-layers' });
  def('REFEDIT', [], startTool('refedit'),
    'Edit a reference or block in place', { cat: 'Blocks', edit: true, icon: 'edit-reference' });
  def('REFCLOSE', [], startTool('refclose'),
    'Save or discard an in-place reference edit', { cat: 'Blocks', edit: true, icon: 'edit-reference' });

  /* The three system variables the Reference panel drives. SETVAR already
     reaches every key in Nasj.settings; these let the name be typed on its
     own, which is how the industry standard sets a system variable. */
  const sysvarCmd = (key) => () => { N.tools.start('setvar'); N.tools.macro([key]); };
  def('XDWGFADECTL', [], sysvarCmd('xdwgfadectl'),
    'How far external references fade back (0-90)', { cat: 'Settings', icon: 'attach' });
  def('FRAME', [], sysvarCmd('frame'),
    'Whether clipping boundaries are shown and plotted (0-3)',
    { cat: 'Settings', icon: 'underlay-frames' });
  def('UOSNAP', [], sysvarCmd('uosnap'),
    'Whether object snap reaches into a reference', { cat: 'Settings', icon: 'snap-underlay' });
  compat('hyperlinks, which are not in this release.', ['ATTACHURL']);
  compat('a scripting helper; not part of Nasjicad.', ['ADDVARS2SCR']);
  compat('writing a block to its own file, which is not in this release.',
    ['ACADWBLOCKDIALOG', 'WBLOCK']);
  def('ALIASES', [], showAliases, 'Print the command alias table', { cat: 'Utility', icon: 'cmd-aliases' });
  def('SYSVARS', [], showSysvars, 'Print the current system variables', { cat: 'Utility', icon: 'sysvars' });
  def('UNDO', ['U'], doUndo, 'Undo the last operation', { cat: 'Utility', icon: 'undo' });
  def('REDO', [], doRedo, 'Redo the last undone operation', { cat: 'Utility', icon: 'redo' });
  def('HELP', ['?'], showHelp, 'List available commands', { cat: 'Utility', trans: true, icon: 'help' });

  const INDEX = {};
  for (const c of CMDS) {
    INDEX[c.name] = c;
    for (const a of c.aliases) INDEX[a] = c;
  }

  /* ---------------- execute / repeat / AutoCorrect ---------------- */
  /* optimal-string-alignment distance (with transpositions) for AutoCorrect */
  const osaDist = (a, b) => {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    const d = [];
    for (let i = 0; i <= m; i++) { d[i] = [i]; }
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[m][n];
  };
  const autoCorrect = (tok) => {
    if (!/^[A-Za-z]/.test(tok) || tok.length < 2) return null;
    let best = null;
    for (const c of CMDS) {
      for (const cand of [c.name].concat(c.aliases)) {
        const dd = osaDist(tok, cand);
        if (!best || dd < best.d || (dd === best.d && cand.length > best.cand.length)) {
          best = { d: dd, c, cand };
        }
      }
    }
    const lim = tok.length >= 5 ? 2 : 1;
    return (best && best.d <= lim) ? best.c : null;
  };
  /* ---- command-line input preferences (the wrench menu) — persisted in a
     small localStorage blob of their own, like UNITS ---- */
  const CLI_KEY = 'nasjicad.cli';
  const CONTENT_TYPES = ['Block', 'Layer', 'Hatch', 'Text Style', 'Dim Style', 'Visual Style'];
  const cli = (() => {
    const d = { autoComplete: true, autoCorrect: true, midSearch: true,
      sysvars: true, sepSysvars: true, searchContent: true, sortAlpha: false,
      rememberFixes: true, correctAfter: 3, delay: 0, promptLines: 3,
      opacity: 100, rollover: 100,
      contentOrder: CONTENT_TYPES.slice(),
      contentOn: { Block: true, Layer: true, Hatch: true,
        'Text Style': true, 'Dim Style': true, 'Visual Style': true },
      use: {}, fixes: {} };
    try { Object.assign(d, JSON.parse(localStorage.getItem(CLI_KEY) || '{}')); }
    catch (_) { /* defaults stand */ }
    if (!Array.isArray(d.contentOrder) || d.contentOrder.length !== CONTENT_TYPES.length) {
      d.contentOrder = CONTENT_TYPES.slice();
    }
    return d;
  })();
  const saveCli = () => {
    try { localStorage.setItem(CLI_KEY, JSON.stringify(cli)); }
    catch (_) { /* session only */ }
  };
  const applyCli = () => {
    /* prompt-history lines: 18px line + 2px gap each; the focus-within
       expansion in the stylesheet stays in charge of browsing */
    const rs = document.documentElement.style;
    rs.setProperty('--cli-lines', (Math.max(1, cli.promptLines || 3) * 20 + 4) + 'px');
    /* the industry standard's Transparency dialog: a resting opacity and a rollover one */
    const op = (v) => Math.min(100, Math.max(10, Number(v) || 100)) / 100;
    rs.setProperty('--cli-op', String(op(cli.opacity)));
    rs.setProperty('--cli-op-roll', String(op(cli.rollover)));
  };
  N.cli = {
    get: (k) => cli[k],
    set(k, v) {
      cli[k] = v;
      saveCli();
      applyCli();
    },
  };

  /* Recent Input: canonical names of the commands that ran, oldest first */
  const recentIn = [];
  let prefeeding = false;

  /* ---- Action Recorder (ACTRECORD / ACTSTOP / ACTPLAY) ----
     Records what the user actually does — the command lines run, the text
     answered at prompts, the points clicked, the bare Enters — and plays
     it back through the same doors it came in by. Values typed into the
     near-cursor boxes are not captured in this release. Macros live in
     localStorage, per machine, like the CLI's own settings. */
  const ACT_KEY = 'nasjicad.actmacros';
  const actLoad = () => {
    try { return JSON.parse(localStorage.getItem(ACT_KEY) || '{}') || {}; }
    catch (_) { return {}; }
  };
  const actSave = (m) => {
    try { localStorage.setItem(ACT_KEY, JSON.stringify(m)); } catch (_) { /* session only */ }
  };
  const rec = { on: false, steps: [], playing: false, prevDown: null, prevEnter: null };
  const actStart = () => {
    if (rec.on) { print('The Action Recorder is already recording.'); return; }
    rec.on = true;
    rec.steps = [];
    /* clicks and bare Enters pass through N.tools — wrap them for the take */
    rec.prevDown = N.tools.onDown;
    rec.prevEnter = N.tools.feedEnter;
    N.tools.onDown = (pt) => {
      if (rec.on && !rec.playing && pt && pt.world) {
        rec.steps.push({ t: 'i', s: pt.world.x + ',' + pt.world.y });
      }
      rec.prevDown(pt);
    };
    N.tools.feedEnter = () => {
      if (rec.on && !rec.playing &&
          N.tools.activeName !== 'actstop' && N.tools.activeName !== 'actplay') {
        rec.steps.push({ t: 'e' });
      }
      rec.prevEnter();
    };
    print('Action Recorder: recording. ACTSTOP stops and saves.');
    if (N.toast) N.toast('Recording — ACTSTOP stops and saves');
  };
  const actStop = (name) => {
    if (!rec.on) { print('The Action Recorder is not recording.'); return; }
    rec.on = false;
    N.tools.onDown = rec.prevDown;
    N.tools.feedEnter = rec.prevEnter;
    const steps = rec.steps;
    rec.steps = [];
    if (!steps.length) { print('Nothing was recorded.'); return; }
    if (!name) { print(`Recording discarded (${steps.length} step(s)).`); return; }
    const m = actLoad();
    m[name] = steps;
    actSave(m);
    print(`Macro "${name}" saved (${steps.length} step(s)). ACTPLAY plays it.`);
  };
  const actPlay = (name) => {
    if (rec.on) { print('Stop recording before playing a macro.', 'err'); return; }
    const m = actLoad();
    const steps = m[name];
    if (!steps) {
      const names = Object.keys(m);
      print(`No macro named "${name}".` +
        (names.length ? ` Saved: ${names.join(', ')}.` : ' Nothing is saved yet.'), 'err');
      return;
    }
    rec.playing = true;
    try {
      for (const st of steps) {
        if (st.t === 'c') execute(st.s);
        else if (st.t === 'i') routeText(st.s);
        else if (st.t === 'e') N.tools.feedEnter();
      }
    } finally { rec.playing = false; }
    print(`Macro "${name}" played (${steps.length} step(s)).`);
  };

  /* the commands that need no drawing under them (canonical names: an
     alias — EXIT, OP, ? — has already resolved to one of these) */
  const START_OK = new Set(['NEW', 'OPEN', 'HELP', 'OPTIONS', 'QUIT']);
  const execute = (raw) => {
    let s = String(raw || '').trim();
    if (!s) return;
    if (s[0] === "'") s = s.slice(1).trim(); /* bare 'CMD at an idle prompt */
    if (!s) return;
    const parts = s.split(/\s+/);
    const tok = parts[0].toUpperCase();
    let c = INDEX[tok];
    if (!c) {
      /* spec §0.1: AutoCorrect instead of hard-failing (wrench menu toggle).
         A typo corrected often enough is remembered and fixed silently. */
      const fx = cli.fixes[tok];
      if (cli.autoCorrect !== false && cli.rememberFixes !== false &&
          fx && fx.n >= (cli.correctAfter || 3) && INDEX[fx.name]) {
        c = INDEX[fx.name];
      } else {
        c = cli.autoCorrect === false ? null : autoCorrect(tok);
        if (c) {
          print(`Unknown command "${tok}". Trying: ${c.name}`);
          const f = cli.fixes[tok] || (cli.fixes[tok] = { name: c.name, n: 0 });
          if (f.name === c.name) f.n += 1; else { f.name = c.name; f.n = 1; }
          saveCli();
        } else { print(`Unknown command "${s}". Press F1 for help.`, 'err'); return; }
      }
    }
    /* THE START PAGE IS NOT A DRAWING (app.js greys the ribbon to match):
       a command that would work on one refuses while it stands, however it
       was started — typed, clicked or on a shortcut. The few that need no
       drawing are the way off the page. Gated BEFORE the bookkeeping, so a
       refused command joins neither the repeat, the recent list nor the
       usage counts. */
    if (N.startActive && !START_OK.has(c.name)) {
      print('The Start page has no drawing. Open one, or start a new one, first.');
      return;
    }
    if (c.name !== 'HELP') {
      lastCommand = c.name;
      N.cmd.lastCommand = c.name;
    }
    /* the phone's command palette keeps its Recent tiles by this */
    emit('nasj:command', { name: c.name });
    /* Recent Input: every command that actually ran, however it was started —
       typed, clicked on the ribbon, or picked off a menu. The context menu's
       list reads this; the typed history stays the input box's own. */
    if (recentIn[recentIn.length - 1] !== c.name) recentIn.push(c.name);
    if (recentIn.length > 30) recentIn.shift();
    /* the recorder takes the whole line, prefeed arguments included — but
       never its own commands, and nothing while a macro is replaying */
    if (rec.on && !rec.playing && c.name.indexOf('ACT') !== 0) {
      rec.steps.push({ t: 'c', s });
    }
    /* usage counts feed the suggestion list's frequency ordering */
    cli.use[c.name] = (cli.use[c.name] || 0) + 1;
    saveCli();
    /* how many arguments follow on the line, for the commands that answer
       with a DIALOG when given none and run at the command line when given
       some — the industry standard's BLOCK versus -BLOCK */
    N.cmd.argc = parts.length - 1;
    c.run();
    /* one-shot prefeed (SPEC3 §22/§24): "CIRCLE 2P", "ARC C", "VIEWSAVE name" —
       remaining tokens are fed to the now-prompting tool like typed input */
    prefeeding = true;
    try {
      for (let i = 1; i < parts.length; i++) {
        if (awaiting() === 'none') break;
        /* "\" (pause for the user) and ";" (Enter) turn the rest of the line into
           a ribbon macro the tool answers as the picks come in */
        if (parts[i] === '\\' || parts[i] === ';') { N.tools.macro(parts.slice(i)); break; }
        routeText(parts[i]);
      }
    } finally { prefeeding = false; }
  };
  const repeatLast = () => {
    if (!lastCommand) { print('Nothing to repeat.'); return; }
    print('> ' + lastCommand, 'echo');
    execute(lastCommand);
  };

  /* ---------------- input routing / coordinate parsing ---------------- */
  const NUM = '(-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)';
  const rePt = new RegExp(`^${NUM}\\s*,\\s*${NUM}$`);
  const rePt3 = new RegExp(`^${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}$`); /* x,y,z (spec §0.4) */
  const reRel = new RegExp(`^@\\s*${NUM}\\s*,\\s*${NUM}$`);
  const reRel3 = new RegExp(`^@\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}$`);
  const rePol = new RegExp(`^@\\s*${NUM}\\s*<\\s*${NUM}$`);
  const reNum = new RegExp(`^${NUM}$`);

  /* Lengths and angles are typed in whatever UNITS is set to: 1'6" and
     45d30' reach here as text, so the decimal regexes above are only the
     fast path. Angles typed after "<" are directions (ANGBASE/ANGDIR). */
  const U = () => N.units;
  const uLen = (s) => (U() ? U().parseLen(s) : (reNum.test(s) ? Number(s) : null));
  const uDir = (s) => (U() ? U().parseAng(s) : (reNum.test(s) ? Number(s) : null));
  /* "a,b[,c]" / "@a,b[,c]" / "@d<a" in the current units, or null */
  const parseTyped = (s) => {
    const rel = s[0] === '@';
    const body = rel ? s.slice(1).trim() : s;
    const pol = body.split('<');
    if (pol.length === 2) {
      const d = uLen(pol[0].trim()), a = uDir(pol[1].trim());
      if (d == null || a == null) return null;
      const r = a * Math.PI / 180;
      return { rel, pt: { x: Math.cos(r) * d, y: Math.sin(r) * d } };
    }
    const parts = body.split(',');
    if (parts.length < 2 || parts.length > 3) return null;
    const v = parts.map((t) => uLen(t.trim()));
    if (v.some((n) => n == null)) return null;
    return { rel, pt: v.length === 3 ? { x: v[0], y: v[1], z: v[2] } : { x: v[0], y: v[1] } };
  };

  /* commands that may run inside another command with a ' prefix (spec §0.1) */
  const runTransparent = (rest) => {
    const tok = rest.split(/\s+/)[0].toUpperCase();
    const c = INDEX[tok];
    if (!c) { print(`Unknown command "${rest}".`, 'err'); return; }
    if (!c.trans) { print(`** ${c.name} command not allowed transparently **`, 'err'); return; }
    const savedLast = lastCommand;
    if (N.tools && N.tools.setTransparentPending) N.tools.setTransparentPending(true);
    execute(rest);
    if (N.tools && N.tools.setTransparentPending) N.tools.setTransparentPending(false);
    lastCommand = savedLast; /* a transparent command is not "the last command" */
    N.cmd.lastCommand = savedLast;
  };

  const routeText = (s) => {
    /* the Action Recorder takes every input a live prompt is answered with —
       except prefeed replays of a line it already holds whole, and the
       recorder's own name prompts */
    if (rec.on && !rec.playing && !prefeeding &&
        N.tools.activeName !== 'actstop' && N.tools.activeName !== 'actplay') {
      rec.steps.push({ t: 'i', s });
    }
    const mode = awaiting();
    if (s && s[0] === "'") { /* transparent 'ZOOM / 'PAN / 'ID / 'DIST … */
      const rest = s.slice(1).trim();
      if (!rest) return;
      if (mode !== 'none') { runTransparent(rest); return; }
      execute(rest);
      return;
    }
    /* 'string' is 'text' that keeps its spaces: names, descriptions and
       drawn text feed through whole, and the spacebar types rather than
       submits while one is being asked for */
    if (mode === 'text' || mode === 'string') { N.tools.feedText(s); return; }
    if (mode !== 'none') {
      let m;
      /* a Mac's Arabic keyboard layout types the digits as ٠١٢… and the
         comma as "،" (Windows' layout types 0-9 and ","), so "0,0" typed
         there never read as a point. Coordinates and numbers read either
         way; the text fed to a prompt stays as typed. */
      const n = s.replace(/[٠-٩]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x0630))
        .replace(/،/g, ',').replace(/٫/g, '.');
      /* absolute coordinates are read in the current UCS */
      const abs = (p) => (N.fromUcs ? Object.assign({}, p, N.fromUcs(p)) : p);
      if ((m = rePt3.exec(n))) { N.tools.feedPoint(abs({ x: +m[1], y: +m[2], z: +m[3] })); return; }
      if ((m = rePt.exec(n))) { N.tools.feedPoint(abs({ x: +m[1], y: +m[2] })); return; }
      if ((m = reRel3.exec(n))) {
        const b = N.tools.lastPoint || { x: 0, y: 0 };
        N.tools.feedPoint({ x: b.x + +m[1], y: b.y + +m[2], z: (typeof b.z === 'number' ? b.z : 0) + +m[3] });
        return;
      }
      if ((m = reRel.exec(n))) {
        const b = N.tools.lastPoint || { x: 0, y: 0 };
        N.tools.feedPoint({ x: b.x + +m[1], y: b.y + +m[2] });
        return;
      }
      if ((m = rePol.exec(n))) {
        const b = N.tools.lastPoint || { x: 0, y: 0 };
        const dir = uDir(m[2]);                 /* typed angles follow UNITS */
        const a = (dir == null ? +m[2] : dir) * Math.PI / 180, d = +m[1];
        N.tools.feedPoint({ x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d });
        return;
      }
      if (reNum.test(n)) { N.tools.feedValue(parseFloat(n)); return; }
      /* not decimal: it may still be a point or a length in the current units */
      const typed = parseTyped(n);
      if (typed) {
        if (!typed.rel) { N.tools.feedPoint(N.fromUcs ? N.fromUcs(typed.pt) : typed.pt); return; }
        const b = N.tools.lastPoint || { x: 0, y: 0 };
        const p = { x: b.x + typed.pt.x, y: b.y + typed.pt.y };
        if (typed.pt.z !== undefined) p.z = (typeof b.z === 'number' ? b.z : 0) + typed.pt.z;
        N.tools.feedPoint(p);
        return;
      }
      const len = uLen(n);
      if (len != null) { N.tools.feedValue(len); return; }
      N.tools.feedText(s);
      return;
    }
    execute(s);
  };

  const submit = () => {
    if (!elInput) return;
    const raw = elInput.value;
    elInput.value = '';
    hideSuggest();
    typedIdx = -1;
    const s = raw.trim();
    if (!s) {
      if (awaiting() !== 'none') N.tools.feedEnter();
      else repeatLast();
      return;
    }
    print('> ' + s, 'echo');
    typedHist.push(s);
    if (typedHist.length > MAX_HISTORY) typedHist.shift();
    routeText(s);
  };

  /* ---------------- autocomplete (SPEC3 §21) ---------------- */
  const SUG_MAX = 120; /* popup shows 9 rows; the container scrolls beyond that */
  const matchCmds = (t) => {
    const up = t.toUpperCase();
    const seen = new Set();
    const take = (pred) => {
      const got = [];
      for (const c of CMDS) {
        if (seen.has(c.name)) continue;
        /* typed the alias exactly? show it the industry standard's way — "ML (MLINE)" —
           even though the letters also open the command's own name */
        const exact = c.aliases.find((a) => a.toUpperCase() === up);
        if (exact !== undefined) { seen.add(c.name); got.push({ c, byAlias: exact }); continue; }
        if (pred(c.name)) { seen.add(c.name); got.push({ c, byAlias: null }); continue; }
        const al = c.aliases.find(pred);
        if (al !== undefined) { seen.add(c.name); got.push({ c, byAlias: al }); }
      }
      /* Input Search Options: alphabetical, or by how often each is used */
      got.sort(cli.sortAlpha
        ? (a, b) => a.c.name.localeCompare(b.c.name)
        : (a, b) => (cli.use[b.c.name] || 0) - (cli.use[a.c.name] || 0));
      return got;
    };
    const out = take((nm) => nm.startsWith(up)); /* prefix matches rank first */
    if (cli.midSearch !== false) { /* spec §0.1: typing SET offers DSETTINGS too */
      out.push(...take((nm) => nm.includes(up)));
    }
    /* named drawing content joins the list (Input Search Options), in the
       Content Type order the dialog sets */
    if (cli.searchContent !== false && N.doc) {
      const doc = N.doc;
      const hit = (nm) => nm.toUpperCase().startsWith(up) ||
        (cli.midSearch !== false && nm.toUpperCase().includes(up));
      for (const type of (cli.contentOrder || [])) {
        if (out.length >= SUG_MAX) break;
        if (cli.contentOn && cli.contentOn[type] === false) continue;
        if (type === 'Block' && doc.blocks) {
          for (const nm of Object.keys(doc.blocks)) {
            if (out.length >= SUG_MAX) break;
            if (!hit(nm)) continue;
            out.push({ c: { name: nm, desc: 'Block — insert it', icon: 'block-insert' },
              byAlias: null, run: () => execute('INSERT ' + nm) });
          }
        } else if (type === 'Layer' && Array.isArray(doc.layers)) {
          for (const l of doc.layers) {
            if (out.length >= SUG_MAX) break;
            const nm = String(l.name || l.id);
            if (!hit(nm)) continue;
            out.push({ c: { name: nm, desc: 'Layer — make it current', icon: 'layer-props' },
              byAlias: null,
              run: ((lid, lnm) => () => {
                doc.currentLayerId = lid;
                print('Current layer: ' + lnm);
                emit('nasj:doc', { doc });
                if (N.render) N.render();
              })(l.id, nm) });
          }
        }
      }
    }
    return out.slice(0, SUG_MAX);
  };
  const icon16 = (name) => {
    const I = window.NasjIcons;
    if (I && typeof I.get === 'function') {
      try { return I.get(name || 'file-drawing', 16); } catch (_) { /* fall through */ }
    }
    return '';
  };
  let sugTimer = 0;
  const showSuggest = () => {
    /* Input Search Options: the list waits its delay time before opening */
    const dl = Number(cli.delay) || 0;
    clearTimeout(sugTimer);
    if (dl > 0) { sugTimer = setTimeout(showSuggestNow, dl); return; }
    showSuggestNow();
  };
  const showSuggestNow = () => {
    if (!elSuggest || !elInput) return;
    if (cli.autoComplete === false) { hideSuggest(); return; }
    const t = elInput.value.trim();
    if (!t || awaiting() !== 'none' || !/^[A-Za-z?]/.test(t)) { hideSuggest(); return; }
    const list = matchCmds(t);
    if (!list.length) { hideSuggest(); return; }
    sug = { items: list, sel: 0, nav: false, visible: true };
    elSuggest.innerHTML = '';
    list.forEach((it, i) => {
      const d = document.createElement('div');
      d.className = 'sug-item';
      const ico = document.createElement('span');
      ico.className = 'sug-ico';
      ico.innerHTML = icon16(it.c.icon);
      d.appendChild(ico);
      /* "ALIAS (NAME)" when the typed text matched an alias; else "NAME" —
         with the matched substring (prefix or mid-string) in bold */
      const nameSpan = document.createElement('span');
      nameSpan.className = 'sug-name';
      const src = it.byAlias || it.c.name;
      const idx = Math.max(0, src.toUpperCase().indexOf(t.toUpperCase()));
      if (idx > 0) nameSpan.appendChild(document.createTextNode(src.slice(0, idx)));
      const b = document.createElement('b');
      b.textContent = src.slice(idx, idx + t.length);
      nameSpan.appendChild(b);
      nameSpan.appendChild(document.createTextNode(
        src.slice(idx + t.length) + (it.byAlias ? ' (' + it.c.name + ')' : '')));
      d.appendChild(nameSpan);
      const desc = document.createElement('span');
      desc.className = 'sug-desc';
      desc.textContent = it.c.desc || '';
      d.appendChild(desc);
      d.addEventListener('mousedown', (ev) => { ev.preventDefault(); acceptSuggest(i, true); });
      elSuggest.appendChild(d);
    });
    elSuggest.classList.remove('hidden');
    paintSuggestSel();
    /* rendered after a delay: dock it under the crosshair box if one shows */
    dockSuggest();
  };
  const hideSuggest = () => {
    clearTimeout(sugTimer);
    sug.visible = false;
    sug.nav = false;
    if (elSuggest) { elSuggest.classList.add('hidden'); elSuggest.innerHTML = ''; }
  };
  const paintSuggestSel = () => {
    if (!elSuggest) return;
    Array.from(elSuggest.children).forEach((el, i) => {
      const isSel = i === sug.sel;
      el.classList.toggle('sel', isSel);
      let h = el.querySelector('.sug-help');
      if (isSel && !h) { /* dim right-aligned "?" glyph on the selected row */
        h = document.createElement('span');
        h.className = 'sug-help';
        h.textContent = '?';
        h.style.marginLeft = 'auto';
        h.style.opacity = '.45';
        el.appendChild(h);
      } else if (!isSel && h) h.remove();
      if (isSel && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    });
  };
  const acceptSuggest = (i, run) => {
    const it = sug.items[i];
    if (!it) return;
    if (it.run) {                /* named content: the row IS the action */
      elInput.value = '';
      hideSuggest();
      syncDynCmd();
      it.run();
      return;
    }
    elInput.value = it.c.name;
    hideSuggest();
    if (run) submit();
    syncDynCmd();
  };

  /* ---------------- typed-command recall ---------------- */
  const histRecall = (dir) => {
    if (!typedHist.length || !elInput) return;
    if (dir < 0) typedIdx = (typedIdx === -1) ? typedHist.length - 1 : Math.max(0, typedIdx - 1);
    else {
      if (typedIdx === -1) return;
      typedIdx += 1;
      if (typedIdx >= typedHist.length) { typedIdx = -1; elInput.value = ''; return; }
    }
    elInput.value = typedHist[typedIdx];
    hideSuggest();
  };

  /* ---------------- key handling ---------------- */
  const onInputKey = (ev) => {
    const k = ev.key;
    if (k === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      if (sug.visible) { hideSuggest(); return; }
      /* the keyword list closes first, the command stands */
      if (dynMenuOpen()) { hideDynMenu(); return; }
      elInput.value = '';
      typedIdx = -1;
      if (!ev.__nasjHandled) {
        ev.__nasjHandled = true;
        if (N.tools && N.tools.cancel) N.tools.cancel();
        print('*Cancel*');
      }
      return;
    }
    /* nothing typed yet: the dynamic-input boxes get Tab and the digits, so
       they work while the command line holds focus (it usually does) */
    if (!elInput.value && dynKey(ev)) return;
    /* and so does the keyword list — the command line holding the focus is
       exactly why ArrowDown used to reach the history instead of the options */
    if (!elInput.value && dynMenuKey(ev)) return;
    if (sug.visible) {
      if (k === 'ArrowDown') { sug.sel = (sug.sel + 1) % sug.items.length; sug.nav = true; paintSuggestSel(); ev.preventDefault(); return; }
      if (k === 'ArrowUp') { sug.sel = (sug.sel - 1 + sug.items.length) % sug.items.length; sug.nav = true; paintSuggestSel(); ev.preventDefault(); return; }
      if (k === 'Tab') { acceptSuggest(sug.sel, false); ev.preventDefault(); return; }
      if (k === 'Enter') {
        ev.preventDefault();
        if (!sug.nav && INDEX[elInput.value.trim().toUpperCase()]) { hideSuggest(); submit(); }
        else acceptSuggest(sug.sel, true);
        return;
      }
    }
    if (k === 'Enter') { ev.preventDefault(); submit(); return; }
    /* the spacebar is Enter, as the industry standard reads it — except while a free
       string (drawn text, a name, a description) is being typed */
    if (k === ' ' && awaiting() !== 'string') { ev.preventDefault(); submit(); return; }
    if (k === 'ArrowUp') { histRecall(-1); ev.preventDefault(); return; }
    if (k === 'ArrowDown') { histRecall(1); ev.preventDefault(); return; }
  };

  const onWindowKey = (ev) => {
    if (ev.key === 'F1') { ev.preventDefault(); execute('HELP'); return; }
    /* F2 flips between the drawing and the Text Window, as the industry standard's does —
       from anywhere, the command line included */
    if (ev.key === 'F2') { ev.preventDefault(); execute('TEXTSCR'); return; }
    const t = ev.target;
    if (t === elInput) return; // input's own handler manages
    const isOtherInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (isOtherInput) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key;
    if (k === 'Enter') { ev.preventDefault(); submit(); return; }
    if (k === ' ') {
      if (awaiting() !== 'string') { ev.preventDefault(); submit(); }
      else if (elInput) elInput.focus();
      return;
    }
    /* dynamic input: numeric keystrokes and Tab land in the near-cursor boxes;
       letters still go to the command line (option keywords, commands) */
    if (dynMenuKey(ev)) return;
    if (dynState.mode) {
      if (dynState.mode !== 'tip' && dynKey(ev)) return;
    }
    /* any printable character — Arabic and other scripts included, not
       just ASCII — lands in the freshly focused input */
    if (k.length === 1 && /\S/.test(k) && elInput) {
      elInput.focus();
    }
  };

  /* ---------------- dynamic input (industry-standard-style, F12) ----------------
     Near-cursor prompt bubble plus editable value boxes:
       - point prompt, no base point:  X / Y coordinate boxes
       - point prompt with a rubber band (ui.dyn): distance + angle boxes
       - value prompt: one distance box
     Digits typed anywhere land in the active box; Tab locks it and moves to
     the next; Enter/Space submits; ArrowDown / the ⌄ opens keyword options.
     While polar tracking is locked the bubble reads "Polar: d < a°". */
  let dynEls = null;
  let lastPtr = null;
  const DYN_DEG = 180 / Math.PI;
  const dynState = { mode: null, dirty1: false, dirty2: false, lock1: false, active: 1, promptKey: null, anchor: null, sel: -1 };

  const promptTail = () => {
    if (!promptText) return '';
    const m = /^[A-Z?*>' -]+\s+(.*)$/.exec(promptText);
    return m ? m[1] : promptText;
  };
  const promptKeywords = () => {
    const m = /\[([^\]]*)\]/.exec(promptText || '');
    return m && m[1] ? splitKeywords(m[1]) : [];
  };

  const dynMode = () => {
    if (!N.settings || !N.settings.dyn || !promptText) return null;
    const aw = awaiting();
    if (aw === 'point') {
      if (N.ui && N.ui.dynTipOnly) return 'tip'; /* freehand fence: no boxes */
      if (N.ui && N.ui.dynOptList) return 'tip'; /* keyword prompt: no boxes */
      if (N.ui && N.ui.dynLen) return 'len';  /* OFFSET: one distance box */
      if (N.ui && N.ui.dynBox) return 'wh';   /* RECTANG: length + width boxes */
      /* Pointer Input Settings ▸ Format: a second point normally reads as
         polar (distance and angle, the industry standard's default); Cartesian keeps the
         X and Y boxes for every point instead */
      if (N.settings.dynFormat === 'cartesian') return 'xy';
      return (N.ui && N.ui.dyn && N.ui.dyn.base) ? 'da' : 'xy';
    }
    if (aw === 'value') return 'val';
    /* a text prompt that asks for an edit box (EXTRUDE's expression) gets
       one beside the tip; the rest are the tip alone */
    if (aw === 'text' || aw === 'string') return (N.ui && N.ui.dynText) ? 'txt' : 'tip';
    return null;
  };

  const dynFieldOf = (idx) => (idx === 2 ? dynEls.f2 : dynEls.f1);
  const dynActiveField = () => dynEls && dynFieldOf(dynState.active);
  const dynHasFocus = () =>
    dynEls && (document.activeElement === dynEls.f1 || document.activeElement === dynEls.f2);

  const hideDynMenu = () => {
    if (dynEls) dynEls.menu.style.display = 'none';
    dynState.sel = -1;
  };
  const dynMenuOpen = () => !!(dynEls && dynEls.menu.style.display === 'block');
  const dynMenuRows = () => (dynEls ? [...dynEls.menu.children] : []);
  const paintDynMenuSel = () =>
    dynMenuRows().forEach((r, i) => r.classList.toggle('sel', i === dynState.sel));
  const showDynMenu = () => {
    const el = ensureDyn();
    const kws = promptKeywords();
    if (!el || !kws.length) return;
    /* the <default> option carries the industry standard's dot */
    const dm = /<([^>]*)>/.exec(promptText || '');
    const def = dm ? dm[1].trim() : null;
    el.menu.innerHTML = '';
    dynState.sel = 0;
    kws.forEach((kw, i) => {
      const row = document.createElement('div');
      row.className = 'dyn-mi';
      if (def && (kw === def || chipAbbr(kw) === def)) {
        row.classList.add('cur');
        dynState.sel = i;      /* the list opens on the option Enter would take */
      }
      row.textContent = kw;
      /* the pointer highlights what it is over, so mouse and keys agree */
      row.addEventListener('mouseenter', () => { dynState.sel = i; paintDynMenuSel(); });
      row.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        hideDynMenu();
        chipClick(kw);
      });
      el.menu.appendChild(row);
    });
    paintDynMenuSel();
    el.menu.style.display = 'block';
    el.menu.style.left = el.tip.style.left;
    el.menu.style.top = (parseFloat(el.tip.style.top || '0') + el.tip.offsetHeight + 3) + 'px';
  };
  /* the industry standard's keyword list, worked from the keyboard: ArrowDown opens it at
     any prompt carrying options, the arrows walk it, Enter or Space takes the
     one highlighted, and Escape puts the list away without touching the
     command underneath. Answers true when it has taken the key. */
  const dynMenuKey = (ev) => {
    const k = ev.key;
    if (dynMenuOpen()) {
      const rows = dynMenuRows();
      const step = (d) => {
        if (!rows.length) return;
        dynState.sel = (dynState.sel + d + rows.length) % rows.length;
        paintDynMenuSel();
      };
      if (k === 'ArrowDown') { ev.preventDefault(); step(1); return true; }
      if (k === 'ArrowUp') { ev.preventDefault(); step(-1); return true; }
      if (k === 'Enter' || k === ' ') {
        ev.preventDefault();
        const row = rows[dynState.sel];
        hideDynMenu();
        if (row) chipClick(row.textContent);
        return true;
      }
      if (k === 'Escape') { ev.preventDefault(); ev.stopPropagation(); hideDynMenu(); return true; }
      return false;
    }
    if (k === 'ArrowDown' && dynMode() && promptKeywords().length) {
      ev.preventDefault();
      showDynMenu();
      return true;
    }
    return false;
  };

  const resetDynFields = () => {
    dynState.dirty1 = dynState.dirty2 = false;
    dynState.lock1 = false;
    dynState.active = 1;
    dynState.anchor = null;
    if (N.ui) N.ui.dynBoxLock = null;   /* a new prompt drops any locked side */
    if (dynEls) {
      dynEls.box1.classList.remove('locked');
      dynEls.box2.classList.remove('locked');
      if (dynHasFocus()) document.activeElement.blur();
    }
    hideDynMenu();
  };

  /* a length typed into a dynamic-input box, in the current units */
  const dynNum = (s, fb) => {
    const t = String(s).replace(/[°<]/g, '').trim();
    const v = U() ? U().parseLen(t) : parseFloat(t);
    return (v != null && isFinite(v)) ? v : fb;
  };
  /* the angle box holds a magnitude, not a direction: unit change only */
  const dynAng = (s, fb) => {
    const t = String(s).replace(/[°<]/g, '').trim();
    const v = U() ? U().parseAngVal(t) : parseFloat(t);
    return (v != null && isFinite(v)) ? v : fb;
  };
  const fmtLenUi = (v) => (U() ? U().fmtLen(v) : (+v).toFixed(4));

  const submitDyn = () => {
    const el = dynEls;
    const mode = dynState.mode;
    if (!el || !mode) return;
    const w = lastPtr && lastPtr.world;
    if (mode === 'xy') {
      const wu = (w && N.toUcs) ? N.toUcs(w) : w;
      const x = dynNum(el.f1.value, wu ? wu.x : null);
      const y = dynNum(el.f2.value, wu ? wu.y : null);
      if (x == null || y == null) return;
      print(`> ${x},${y}`, 'echo');
      resetDynFields();
      N.tools.feedPoint(N.fromUcs ? N.fromUcs({ x, y }) : { x, y });
      return;
    }
    if (mode === 'txt') {
      const raw = el.f1.value.trim();
      if (!raw) return;
      print('> ' + raw, 'echo');
      resetDynFields();
      N.tools.feedText(raw);
      return;
    }
    if (mode === 'val' || mode === 'len') {
      const v = dynNum(el.f1.value, null);
      if (v == null) {
        /* not a number: a keyword typed into the box (E for Expression)
           reaches the prompt as the command line would hand it over */
        const raw = el.f1.value.trim();
        if (!raw) return;
        print('> ' + raw, 'echo');
        resetDynFields();
        N.tools.feedText(raw);
        return;
      }
      print('> ' + v, 'echo');
      resetDynFields();
      N.tools.feedValue(v);
      return;
    }
    if (mode === 'wh') {                    /* RECTANG length × width */
      const bx = N.ui && N.ui.dynBox;
      if (!bx) return;
      const liveW = Math.abs(bx.rel.x), liveH = Math.abs(bx.rel.y);
      const wv = (dynState.dirty1 || dynState.lock1) ? dynNum(el.f1.value, liveW) : liveW;
      const hv = dynState.dirty2 ? dynNum(el.f2.value, liveH) : liveH;
      if (!(wv > 0) || !(hv > 0)) return;
      const lx = (bx.rel.x < 0 ? -1 : 1) * wv, ly = (bx.rel.y < 0 ? -1 : 1) * hv;
      const co = Math.cos(bx.rot), si = Math.sin(bx.rot);
      print(`> ${fmtLenUi(wv)} x ${fmtLenUi(hv)}`, 'echo');
      resetDynFields();
      N.tools.feedPoint({ x: bx.a.x + lx * co - ly * si, y: bx.a.y + lx * si + ly * co });
      return;
    }
    if (mode === 'da') {
      const dg = N.ui && N.ui.dyn;
      if (!dg || !dg.base) return;
      const liveD = Math.hypot(dg.p.x - dg.base.x, dg.p.y - dg.base.y);
      const d = (dynState.dirty1 || dynState.lock1) ? dynNum(el.f1.value, liveD) : liveD;
      if (!(d > 0)) return;
      if (dynState.dirty2) {
        const aDeg = dynAng(el.f2.value, null);
        if (aDeg == null) return;
        /* displayed angles are 0-180: pick the side the cursor is on */
        const cur = Math.atan2(dg.p.y - dg.base.y, dg.p.x - dg.base.x);
        let a = aDeg / DYN_DEG, bestDiff = Infinity;
        for (const c of [aDeg / DYN_DEG, -aDeg / DYN_DEG]) {
          const diff = Math.abs(Math.atan2(Math.sin(c - cur), Math.cos(c - cur)));
          if (diff < bestDiff) { bestDiff = diff; a = c; }
        }
        print(`> ${d}<${aDeg}`, 'echo');
        resetDynFields();
        N.tools.feedPoint({ x: dg.base.x + Math.cos(a) * d, y: dg.base.y + Math.sin(a) * d });
      } else {
        print('> ' + d, 'echo');
        resetDynFields();
        N.tools.feedValue(d); /* direct distance entry along the rubber band */
      }
    }
  };

  const dynMarkDirty = (idx) => {
    if (idx === 1) dynState.dirty1 = true; else dynState.dirty2 = true;
    const f = dynFieldOf(idx);
    f.classList.remove('hot');
    f.style.width = Math.max(4, f.value.length + 1) + 'ch';
  };

  const dynNextField = () => {
    if (dynState.active === 1) {
      dynState.lock1 = dynState.dirty1 || !!dynEls.f1.value;
      if (dynState.lock1) dynState.dirty1 = true;
      dynEls.box1.classList.toggle('locked', dynState.lock1);
      dynState.active = 2;
      /* RECTANG: the length just typed holds while the width is entered */
      if (dynState.mode === 'wh' && dynState.lock1 && N.ui) {
        const wv = dynNum(dynEls.f1.value, null);
        N.ui.dynBoxLock = (wv != null && wv > 0) ? { w: wv } : null;
      }
    } else {
      dynState.active = 1;
    }
    const f = dynActiveField();
    f.focus();
    f.select();
    updateDyn();
  };

  /* Keystrokes that belong to the dynamic-input boxes wherever focus happens
     to be — the canvas cannot take focus, so the command line usually holds
     it and would otherwise swallow Tab and the digits. */
  const dynKey = (ev) => {
    if (!dynState.mode || dynState.mode === 'tip' || !dynEls) return false;
    const k = ev.key;
    if (k === 'Tab' ||
        (k === ',' && (dynState.mode === 'xy' || dynState.mode === 'wh')) ||
        (k === '<' && dynState.mode === 'da')) {
      /* single-box modes have nowhere to hop to */
      if (dynState.mode === 'val' || dynState.mode === 'len' || dynState.mode === 'txt') return false;
      ev.preventDefault();
      dynNextField();
      return true;
    }
    /* the edit box takes every character; the number boxes the digits */
    if (k.length === 1 && (dynState.mode === 'txt' ? /\S/.test(k) : /[0-9.+\-]/.test(k))) {
      const f = dynActiveField();
      if (!f) return false;
      const dirty = dynState.active === 1 ? (dynState.dirty1 || dynState.lock1) : dynState.dirty2;
      ev.preventDefault();
      f.value = dirty ? f.value + k : k;           /* the live value is replaced */
      f.focus();
      dynMarkDirty(dynState.active);
      return true;
    }
    return false;
  };

  const wireDynField = (f, idx) => {
    f.addEventListener('input', () => dynMarkDirty(idx));
    f.addEventListener('keydown', (ev) => {
      const k = ev.key;
      /* an open keyword list owns Enter, the arrows and Escape before the
         box does — picking the option is what the reader is looking at */
      if (dynMenuKey(ev)) { ev.stopPropagation(); return; }
      if (k === 'Enter' || (k === ' ')) { ev.preventDefault(); ev.stopPropagation(); submitDyn(); return; }
      if (k === 'Tab') { ev.preventDefault(); dynNextField(); return; }
      if (k === ',' && (dynState.mode === 'xy' || dynState.mode === 'wh') && idx === 1) {
        ev.preventDefault();
        dynNextField();
        return;
      }
      if (k === '<' && dynState.mode === 'da' && idx === 1) { ev.preventDefault(); dynNextField(); return; }
      if (k === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        resetDynFields();
        updateDyn();
      }
    });
  };

  const ensureDyn = () => {
    if (dynEls || !inited) return dynEls;
    const host = document.getElementById('viewport-container') || document.body;
    if (!host) return null;
    const mk = (cls) => {
      const d = document.createElement('div');
      d.className = cls;
      d.style.display = 'none';
      host.appendChild(d);
      return d;
    };
    const tip = mk('dyn-tip');
    const tipText = document.createElement('span');
    tip.appendChild(tipText);
    const tipArrow = document.createElement('span');
    tipArrow.className = 'dyn-arrow';
    tipArrow.innerHTML = '&#9662;';
    tipArrow.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      if (dynEls.menu.style.display === 'block') hideDynMenu(); else showDynMenu();
    });
    tip.appendChild(tipArrow);
    const box1 = mk('dyn-box');
    const f1 = document.createElement('input');
    f1.className = 'dyn-field';
    f1.spellcheck = false;
    box1.appendChild(f1);
    const box2 = mk('dyn-box');
    const f2 = document.createElement('input');
    f2.className = 'dyn-field';
    f2.spellcheck = false;
    box2.appendChild(f2);
    const menu = mk('dyn-menu');
    dynEls = { host, tip, tipText, tipArrow, box1, f1, box2, f2, menu };
    wireDynField(f1, 1);
    wireDynField(f2, 2);
    return dynEls;
  };

  const placeBox = (el, x, y) => {
    const host = dynEls.host;
    const w = el.offsetWidth, h = el.offsetHeight;
    x = Math.max(0, Math.min(x, host.clientWidth - w - 2));
    y = Math.max(0, Math.min(y, host.clientHeight - h - 2));
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
  };

  const updateDyn = () => {
    const el = ensureDyn();
    if (!el) return;
    if (promptText !== dynState.promptKey) { /* new prompt: fields start clean */
      dynState.promptKey = promptText;
      resetDynFields();
    }
    const mode = dynMode();
    dynState.mode = mode;
    /* the mode on the host, for the phone's stylesheet: under touch.js's
       focus layout the X/Y pair of a first point is not shown at all */
    if (el.host.dataset.dyn !== (mode || '')) el.host.dataset.dyn = mode || '';
    const hide = (x) => { x.style.display = 'none'; };
    if (!mode || !lastPtr) {
      hide(el.tip); hide(el.box1); hide(el.box2); hideDynMenu();
      return;
    }
    const s = lastPtr.screen, w = lastPtr.world;
    const track = N.ui && N.ui.polarTrack;
    const kws = promptKeywords();

    /* prompt bubble (or the polar readout while a tracking lock is on) */
    if (track && mode === 'da') {
      /* a lock onto the Z axis names the axis rather than an angle: the
         angle of a line drawn straight up has no meaning on the ground
         plane the other readings are measured in */
      const ang = track.axis ? track.axis
        : (U() ? U().fmtAng(track.ang * DYN_DEG, true)
          : Math.round((((track.ang * DYN_DEG) % 360) + 360) % 360) + '°');
      el.tipText.textContent =
        `${track.kind === 'par' ? 'Parallel' : 'Polar'}: ${fmtLenUi(track.dist)} < ${ang}`;
      el.tipArrow.style.display = 'none';
    } else {
      let t = promptTail();
      const br = t.indexOf('[');
      if (br >= 0) t = t.slice(0, br).trim();
      if (t.endsWith(':')) t = kws.length ? t.slice(0, -1).trim() : t;
      /* a tool may hang a live reading above the prompt (MEASUREGEOM) */
      const banner = (N.ui && N.ui.dynBanner) ? String(N.ui.dynBanner) : '';
      el.tipText.textContent = banner ? banner + '\n' + t : t;
      el.tip.classList.toggle('dyn-tip-2', !!banner);
      el.tipArrow.style.display = kws.length ? '' : 'none';
    }
    el.tip.style.display = 'flex';
    /* an option-only prompt anchors where it first appeared, so the mouse
       can travel to the list and click it — everything else rides along.
       A tool that wants its options STANDING OPEN at the cursor (TCOUNT's
       sort and placement, industry-standard-style) says so with ui.dynOptList. */
    const optList = mode === 'tip' && kws.length &&
      ((N.ui && N.ui.dynOptList) || /Enter an option/i.test(promptText));
    if (optList) {
      if (!dynState.anchor) dynState.anchor = { x: s.x + 22, y: s.y + 16 };
      placeBox(el.tip, dynState.anchor.x, dynState.anchor.y);
    } else {
      dynState.anchor = null;
      placeBox(el.tip, s.x + 22, s.y + 16);
    }

    const setLive = (f, idx, val) => {
      const dirty = idx === 1 ? (dynState.dirty1 || dynState.lock1) : dynState.dirty2;
      if (!dirty) {
        f.value = val;
        f.classList.toggle('hot', dynState.active === idx);
        /* a focused live value stays selected: the next keystroke replaces it
           instead of being appended to the number the cursor is showing */
        if (document.activeElement === f) f.select();
      }
      /* size the box to its content */
      f.style.width = (Math.max(4, f.value.length) + 0.5) + 'ch';
    };

    if (mode === 'txt') {
      /* a text prompt with its edit box: what is typed lands beside the tip */
      hide(el.box2);
      hideDynMenu();
      el.box1.style.display = 'block';
      setLive(el.f1, 1, '');
      placeBox(el.box1, s.x + 22 + el.tip.offsetWidth + 5, s.y + 16);
      return;
    }
    if (mode === 'tip') {
      hide(el.box1);
      hide(el.box2);
      /* an option-only prompt IS its list: shown once, anchored under the
         tip, and left alone so the rows stay still for the click */
      if (optList) {
        if (el.menu.style.display !== 'block') showDynMenu();
      } else hideDynMenu();
      return;
    }

    /* OFFSET: a single distance box. With two ends it sits in the gap it
       measures (the offset distance); otherwise it rides the cursor. */
    if (mode === 'len') {
      const dl = N.ui.dynLen, vpl = N.viewport;
      hide(el.box2);
      el.box1.style.display = 'block';
      const live = (dl.value != null) ? dl.value
        : (dl.base && dl.p ? Math.hypot(dl.p.x - dl.base.x, dl.p.y - dl.base.y) : 0);
      /* dl.text: a count (POLYGON sides), not a length — no unit formatting */
      setLive(el.f1, 1, dl.text != null ? dl.text : fmtLenUi(live));
      if (dl.base && dl.p && vpl) {
        const A = vpl.worldToScreen(dl.base), B = vpl.worldToScreen(dl.p);
        placeBox(el.box1, (A.x + B.x) / 2 - el.box1.offsetWidth / 2,
          (A.y + B.y) / 2 - el.box1.offsetHeight - 4);
      } else placeBox(el.box1, s.x + 22 + el.tip.offsetWidth + 5, s.y + 16);
      return;
    }

    /* RECTANG: length on the bottom edge, width on the left edge — each box
       sits just outside its own side of the rubber rectangle */
    if (mode === 'wh') {
      const bx = N.ui.dynBox, vpb = N.viewport;
      if (!bx || !vpb) { hide(el.box1); hide(el.box2); return; }
      const co = Math.cos(bx.rot), si = Math.sin(bx.rot);
      const scr = (x, y) => vpb.worldToScreen({
        x: bx.a.x + x * co - y * si, y: bx.a.y + x * si + y * co
      });
      const x0 = Math.min(0, bx.rel.x), x1 = Math.max(0, bx.rel.x);
      const y0 = Math.min(0, bx.rel.y), y1 = Math.max(0, bx.rel.y);
      const mid = scr((x0 + x1) / 2, (y0 + y1) / 2);
      const outside = (box, edge) => {           /* push it clear of the frame */
        const dx = edge.x - mid.x, dy = edge.y - mid.y;
        const L = Math.hypot(dx, dy) || 1;
        placeBox(box, edge.x + (dx / L) * 30 - box.offsetWidth / 2,
          edge.y + (dy / L) * 30 - box.offsetHeight / 2);
      };
      el.box1.style.display = 'block';
      el.box2.style.display = 'block';
      setLive(el.f1, 1, fmtLenUi(Math.abs(bx.rel.x)));
      setLive(el.f2, 2, fmtLenUi(Math.abs(bx.rel.y)));
      outside(el.box1, scr((x0 + x1) / 2, y0));
      outside(el.box2, scr(x0, (y0 + y1) / 2));
      return;
    }

    /* A WORDED DEFAULT IS THE FIELD. At a prompt whose default is a
       keyword rather than a number — ZOOM's <real time> — the industry standard offers
       that word in the input box, selected, so Enter takes it and typing
       replaces it. A numeric default keeps the coordinate boxes, which are
       what a point prompt wants. Only before the first point: once a base
       exists the boxes are measuring, and the default is long gone. */
    if (mode === 'xy' && !N.tools.lastPoint && !dynState.dirty1 && !dynState.dirty2) {
      const dm = /<([^>]*)>\s*:?\s*$/.exec(promptText);
      const dv = dm ? dm[1].trim() : '';
      if (dv && !/^[-+.\d]/.test(dv)) {
        el.box1.style.display = 'block';
        hide(el.box2);
        setLive(el.f1, 1, dv);
        placeBox(el.box1, s.x + 22 + el.tip.offsetWidth + 5, s.y + 16);
        return;
      }
    }

    if (mode === 'xy' || mode === 'val') {
      el.box1.style.display = 'block';
      const wu = (mode === 'xy' && N.toUcs) ? N.toUcs(w) : w;  /* boxes read in UCS */
      /* a value box with nothing to measure offers the prompt's <default>,
         selected, as the industry standard's does: Enter takes it, typing replaces it */
      const dvm = (mode === 'val' && !N.tools.lastPoint) ? /<([^>]*)>\s*:?\s*$/.exec(promptText) : null;
      /* a value the tool measures live (EXTRUDE's height up the Z axis)
         shows in the box as the cursor moves, the way AutoCAD's does */
      const dl = (mode === 'val' && N.ui && N.ui.dynLen && N.ui.dynLen.live && N.ui.dynLen.value != null) ? N.ui.dynLen : null;
      setLive(el.f1, 1, mode === 'xy' ? fmtLenUi(wu.x)
        : dl ? (dl.text != null ? dl.text : fmtLenUi(dl.value))
          : (N.tools.lastPoint ? fmtLenUi(Math.hypot(w.x - N.tools.lastPoint.x, w.y - N.tools.lastPoint.y))
            : (dvm ? dvm[1].trim() : '')));
      placeBox(el.box1, s.x + 22 + el.tip.offsetWidth + 5, s.y + 16);
      if (mode === 'xy') {
        el.box2.style.display = 'block';
        setLive(el.f2, 2, fmtLenUi(wu.y));
        placeBox(el.box2, s.x + 22 + el.tip.offsetWidth + el.box1.offsetWidth + 10, s.y + 16);
      } else hide(el.box2);
      return;
    }

    /* mode === 'da': distance box on the dimension line, angle box on the arc */
    const dg = N.ui.dyn;
    const vp2 = N.viewport;
    if (!dg || !vp2) { hide(el.box1); hide(el.box2); return; }
    const A = vp2.worldToScreen(dg.base), B = vp2.worldToScreen(dg.p);
    const dx = B.x - A.x, dy = B.y - A.y;
    const L = Math.hypot(dx, dy);
    if (L < 4) { hide(el.box1); hide(el.box2); return; }
    const ux = dx / L, uy = dy / L;
    const nx = uy, ny = -ux; /* matches the engine's dyn frame side */
    el.box1.style.display = 'block';
    setLive(el.f1, 1, fmtLenUi(Math.hypot(dg.p.x - dg.base.x, dg.p.y - dg.base.y)));
    placeBox(el.box1,
      (A.x + B.x) / 2 + nx * 24 - el.box1.offsetWidth / 2,
      (A.y + B.y) / 2 + ny * 24 - el.box1.offsetHeight / 2);

    const th = Math.atan2(dg.p.y - dg.base.y, dg.p.x - dg.base.x); /* world */
    let disp = ((th * DYN_DEG) % 360 + 360) % 360;
    if (disp > 180) disp = 360 - disp;
    el.box2.style.display = 'block';
    setLive(el.f2, 2, U() ? U().fmtAngVal(disp) : Math.round(disp) + '°');
    if (Math.abs(th) > 0.02) {
      const rl = Math.max(30, Math.min(L - 8, L * 0.8));
      const half = -th / 2; /* screen angle = -world angle */
      placeBox(el.box2,
        A.x + Math.cos(half) * rl - el.box2.offsetWidth / 2,
        A.y + Math.sin(half) * rl - el.box2.offsetHeight / 2);
    } else {
      placeBox(el.box2, B.x - el.box2.offsetWidth / 2, B.y + 30);
    }
  };

  /* ---- typing in the drawing area (the industry standard's DYN command box) ----
     With dynamic input on and no command running, a typed command shows in
     a white box beside the crosshair — the keystrokes still land in the
     command line, which keeps every behaviour (history, Tab, Enter, the
     suggestion keys); the box is that input, echoed where the eyes are.
     The suggestion list docks underneath it, as the industry standard's does, and goes
     home to the command line when the box closes. The box anchors where
     the crosshair stood when typing began: an anchor that chased the
     mouse would drag the list out from under the click aimed at it. */
  let dynCmdEl = null;
  let dynCmdAnchor = null;
  const ensureDynCmd = () => {
    if (dynCmdEl) return dynCmdEl;
    const el = ensureDyn();
    if (!el) return null;
    dynCmdEl = document.createElement('div');
    dynCmdEl.className = 'dyn-cmd';
    dynCmdEl.style.display = 'none';
    const txt = document.createElement('span');
    const caret = document.createElement('span');
    caret.className = 'dc-caret';
    dynCmdEl.appendChild(txt);
    dynCmdEl.appendChild(caret);
    el.host.appendChild(dynCmdEl);
    return dynCmdEl;
  };
  /* The list is MOVED into the drawing area's own layer while docked — its
     home under the command line sits inside a filtered ancestor, where
     fixed positioning answers to the ancestor and the list lands off
     screen. A reparented node keeps its rows' handlers, so the clicks
     work from either home. */
  let sugHome = null;
  const dockSuggest = () => {
    if (!elSuggest || !dynCmdEl || dynCmdEl.style.display === 'none') return;
    const host = dynEls && dynEls.host;
    if (!host) return;
    if (!sugHome) sugHome = { parent: elSuggest.parentElement, next: elSuggest.nextSibling };
    if (elSuggest.parentElement !== host) host.appendChild(elSuggest);
    elSuggest.classList.add('sug-at-cursor');
    Object.assign(elSuggest.style, {
      position: 'absolute',
      left: dynCmdEl.style.left,
      top: ((parseFloat(dynCmdEl.style.top) || 0) + dynCmdEl.offsetHeight + 2) + 'px',
      bottom: 'auto', right: 'auto', minWidth: '260px',
    });
  };
  const undockSuggest = () => {
    if (!elSuggest) return;
    elSuggest.classList.remove('sug-at-cursor');
    ['position', 'left', 'top', 'bottom', 'right', 'minWidth']
      .forEach((p) => { elSuggest.style[p] = ''; });
    if (sugHome && sugHome.parent && elSuggest.parentElement !== sugHome.parent) {
      sugHome.parent.insertBefore(elSuggest, sugHome.next);
    }
    sugHome = null;
  };
  const hideDynCmd = () => {
    dynCmdAnchor = null;
    if (dynCmdEl && dynCmdEl.style.display !== 'none') {
      dynCmdEl.style.display = 'none';
      undockSuggest();
    }
  };
  const syncDynCmd = () => {
    const idle = N.settings && N.settings.dyn && awaiting() === 'none' &&
      elInput && elInput.value && lastPtr;
    if (!idle) { hideDynCmd(); return; }
    const box = ensureDynCmd();
    if (!box) return;
    if (!dynCmdAnchor) {
      dynCmdAnchor = { x: lastPtr.screen.x + 22, y: lastPtr.screen.y + 16 };
    }
    box.firstChild.textContent = elInput.value;
    box.style.display = 'inline-flex';
    placeBox(box, dynCmdAnchor.x, dynCmdAnchor.y);
    dockSuggest();
  };

  const onPointer = (ev) => {
    if (ev && ev.detail && ev.detail.world && ev.detail.screen) {
      lastPtr = ev.detail;
      updateDyn();
    }
  };

  const onToolChange = (ev) => {
    // Tool cancelled/finished from outside the input (Escape on canvas, etc.):
    // drop any stale typed text so the next Enter repeats cleanly.
    const name = ev && ev.detail && ev.detail.name;
    if (name === 'select' && elInput && elInput.value) {
      elInput.value = '';
      typedIdx = -1;
      hideSuggest();
    }
    syncDynCmd();   /* a command starting or ending closes the crosshair box */
  };

  /* ---------------- clipboard (SPEC §11 utilities) ---------------- */
  N.clipboard = {
    items: [],
    base: { x: 0, y: 0 },
    copy() {
      const doc = N.doc;
      if (!doc || !N.selection || !N.selection.size) { print('Nothing selected.', 'err'); return false; }
      const ents = doc.entities.filter((e) => N.selection.has(e.id));
      if (!ents.length) { print('Nothing selected.', 'err'); return false; }
      this.items = ents.map((e) => JSON.parse(JSON.stringify(e)));
      /* Cross-document paste: a block reference is nothing without its
         definition, and an entity without its layer loses its color and
         linetype. Capture the closure of referenced definitions (nested
         references included) and the layer rows the copied geometry
         stands on, so paste can rebuild them in the target drawing. */
      this.blocks = {};
      const needDefs = [];
      const noteDefs = (list) => {
        for (const e of list) if (e && e.type === 'insert' && e.name != null) needDefs.push(String(e.name));
      };
      noteDefs(ents);
      while (needDefs.length) {
        const nm = needDefs.pop();
        if (Object.prototype.hasOwnProperty.call(this.blocks, nm)) continue;
        const def = doc.blocks && doc.blocks[nm];
        if (!def || !Array.isArray(def.entities)) continue;
        this.blocks[nm] = JSON.parse(JSON.stringify(def));
        noteDefs(def.entities);
      }
      const usedLayers = new Set();
      const noteLayers = (list) => {
        for (const e of list) if (e && e.layerId != null) usedLayers.add(e.layerId);
      };
      noteLayers(ents);
      for (const nm of Object.keys(this.blocks)) noteLayers(this.blocks[nm].entities);
      this.layers = doc.layers
        .filter((l) => usedLayers.has(l.id))
        .map((l) => JSON.parse(JSON.stringify(l)));
      let b = null;
      for (const e of ents) {
        const eb = N.geom.entityBounds(e);
        if (!b) b = { minx: eb.minx, miny: eb.miny, maxx: eb.maxx, maxy: eb.maxy };
        else {
          b.minx = Math.min(b.minx, eb.minx); b.miny = Math.min(b.miny, eb.miny);
          b.maxx = Math.max(b.maxx, eb.maxx); b.maxy = Math.max(b.maxy, eb.maxy);
        }
      }
      this.base = b ? { x: (b.minx + b.maxx) / 2, y: (b.miny + b.maxy) / 2 } : { x: 0, y: 0 };
      print(`${this.items.length} object(s) copied to clipboard.`);
      return true;
    },
    cut() {
      if (!this.copy()) return;
      const doc = N.doc;
      N.docOps.pushUndo(doc);
      N.docOps.deleteEntities(doc, new Set(N.selection));
      if (N.setSelection) N.setSelection([]);
      if (N.render) N.render();
      emit('nasj:doc', { doc });
      print(`${this.items.length} object(s) cut to clipboard.`);
    },
    paste() {
      if (!this.items.length) { print('Clipboard is empty.', 'err'); return; }
      N.tools.start('paste');
    },
    /* Make the clipboard's dependencies real in `doc` before a paste lands:
       layers merge by NAME (an existing layer of that name wins), block
       definitions merge by NAME (an existing definition wins — the industry standard's
       rule for cross-drawing paste). Returns the source→target layer-id
       map the pasted clones must be rewritten through. Call it after
       pushUndo so the merge is part of the paste's own undo step. */
    materialize(doc) {
      const lm = {};
      for (const sl of this.layers || []) {
        const hit = doc.layers.find((l) => l.name === sl.name);
        if (hit) { lm[sl.id] = hit.id; continue; }
        const nl = N.docOps.addLayer(doc, sl.name);
        for (const k of Object.keys(sl)) {
          if (k !== 'id' && k !== 'name') nl[k] = JSON.parse(JSON.stringify(sl[k]));
        }
        lm[sl.id] = nl.id;
      }
      const names = Object.keys(this.blocks || {});
      if (names.length) doc.blocks = doc.blocks || {};
      for (const nm of names) {
        if (Object.prototype.hasOwnProperty.call(doc.blocks, nm)) continue;
        const d = JSON.parse(JSON.stringify(this.blocks[nm]));
        for (const k of d.entities || []) {
          if (!k || k.layerId == null) continue;
          if (lm[k.layerId] != null) k.layerId = lm[k.layerId];
          else if (!doc.layers.some((l) => l.id === k.layerId)) k.layerId = doc.currentLayerId;
        }
        doc.blocks[nm] = d;
      }
      return lm;
    },
    /* Paste as Block: the same placement flow, but the drop makes a block */
    pasteBlock() {
      if (!this.items.length) { print('Clipboard is empty.', 'err'); return; }
      N.tools.pasteMode = 'block';
      N.tools.start('paste');
    },
    /* Paste to Original Coordinates: the clones land exactly where the
       originals were copied from — no pointer involved */
    pasteOrig() {
      if (!this.items.length) { print('Clipboard is empty.', 'err'); return; }
      const doc = N.doc;
      N.docOps.pushUndo(doc);
      const lm = this.materialize(doc);
      const ids = [];
      for (const e of this.items) {
        const c = JSON.parse(JSON.stringify(e));
        delete c.id;
        if (lm[c.layerId] != null) c.layerId = lm[c.layerId];
        else if (!doc.layers.some((l) => l.id === c.layerId)) c.layerId = doc.currentLayerId;
        ids.push(N.docOps.addEntity(doc, c).id);
      }
      if (N.setSelection) N.setSelection(ids);
      doc.modified = true;
      if (N.render) N.render();
      emit('nasj:doc', { doc });
      print(`${ids.length} object(s) pasted to their original coordinates.`);
    },
  };

  /* ---------------- public API / init ---------------- */
  N.cmd = {
    execute,
    print,
    setPrompt,
    clearPrompt,
    repeatLast,
    /* Run a command with one of its options already answered. The ribbon's
       Draw Order buttons need this: their option is a keyword the command
       only asks for AFTER the selection, so it cannot be prefed on the
       command line. Enter still repeats the command, as the industry standard does. */
    runWith: (name, opts) => {
      const c = INDEX[String(name).toUpperCase()];
      if (!c || !c.run.tool) { print(`Unknown command "${name}".`, 'err'); return; }
      lastCommand = c.name;
      N.cmd.lastCommand = c.name;
      cli.use[c.name] = (cli.use[c.name] || 0) + 1;
      saveCli();
      emit('nasj:command', { name: c.name });
      N.tools.start(c.run.tool, opts);
    },
    lastCommand: null,
    /* late registration seam — tools3d.js adds its VIEW* commands here.
       The wrapper also indexes the new command; bare def() would leave it
       unreachable from the command line. */
    def: (name, aliases, run, desc, opts) => {
      def(name, aliases, run, desc, opts);
      const c = CMDS[CMDS.length - 1];
      INDEX[c.name] = c;
      for (const a of c.aliases) INDEX[a] = c;
    },
    /* the commands that ran, oldest first, however they were started —
       typed, ribbon or menu. The context menu's Recent Input reads it. */
    recentInputs: () => recentIn.slice(),
    /* SPEC2 §16 + SPEC3 §22: command metadata (now includes icon) */
    commandInfo: () => CMDS.map((c) => ({
      name: c.name, aliases: c.aliases.slice(), desc: c.desc, icon: c.icon || 'file-drawing',
      cat: c.cat || 'Other',
    })),
  };

  /* the Action Recorder's public face — the context menu and the ACTSTOP /
     ACTPLAY tools drive it through this */
  N.actrec = {
    start: actStart,
    stop: actStop,
    play: actPlay,
    list: () => Object.keys(actLoad()),
    recording: () => rec.on,
  };

  N.cmdInit = () => {
    elInput = document.getElementById('command-input');
    elHist = document.getElementById('command-history');
    elSuggest = document.getElementById('command-suggest');
    elLabel = document.getElementById('command-prompt-label');
    inited = true;
    if (elInput) {
      elInput.addEventListener('keydown', onInputKey);
      elInput.addEventListener('input', showSuggest);
      /* typing answers the prompt directly: the keyword list steps aside */
      elInput.addEventListener('input', () => { if (elInput.value) hideDynMenu(); });
      /* the crosshair command box echoes the input — after showSuggest, so
         the list it docks is the one just rendered; the keydown timeout
         catches every path that edits the value without an input event
         (Enter clearing it, Escape, the history keys) */
      elInput.addEventListener('input', syncDynCmd);
      elInput.addEventListener('keydown', () => setTimeout(syncDynCmd, 0));
      elInput.addEventListener('blur', () => setTimeout(hideSuggest, 120));
    }
    /* While the keyword list stands open it owns its keys outright, ahead of
       every other window listener: the engine hands a bare Enter to the
       active tool, which would end the command under the open list instead
       of taking the option the reader is looking at. The command line and
       the value boxes are inputs and answer it in their own handlers. */
    window.addEventListener('keydown', (ev) => {
      const t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (dynMenuOpen() && dynMenuKey(ev)) ev.stopImmediatePropagation();
    }, true);
    window.addEventListener('keydown', onWindowKey);
    window.addEventListener('nasj:pointer', onPointer);
    window.addEventListener('nasj:tool', onToolChange);
    window.addEventListener('nasj:settings', updateDyn); /* F12 toggles live */
    applyCli(); /* prompt-history lines + transparency from the wrench menu */
    setPrompt(promptText); // sync label/placeholder with current tool state
    print(('Nasjicad V' + (window.NASJ_VERSION || '')) + ' — type a command or press F1 for help.');
  };
})();
