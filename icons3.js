/* pixelbay CAD — icons3.js (owner: ICONS-B, SPEC3 Â§26)
 * View / Manage / Output / Express Tools / layer-tools icon set.
 * Self-contained plain script loaded AFTER icons.js: keeps its own inner-markup
 * table and chains NasjIcons.get (prev-fallback pattern), then appends its
 * names to NasjIcons.names (no duplicates). Never edits icons.js.
 * Style per SPEC Â§6: viewBox 0 0 32 32, fill=none, round caps/joins,
 * stroke-width 1.7 (2 at 16px). Palette: base #dfe3e7, red #e05252,
 * blue #3fa9e0, yellow #e8c25a, green #5fbf5f. All artwork original.
 */
(() => {
  'use strict';

  const S = '#dfe3e7'; // base stroke
  const R = '#e05252'; // red accent
  const U = '#3fa9e0'; // blue accent
  const Y = '#e8c25a'; // yellow accent
  const G = '#5fbf5f'; // green accent
  const M = '#3fbf3f'; // AutoSnap marker green (engine COL.snap)

  // Shared layer plate for the lay* family (plate bottom-left + state glyph top-right).
  const PLATE = `<path d="M11 17.5l8.5 4.75L11 27l-8.5-4.75z" stroke="${S}"/>`;
  // Shared spotlight lamp head for layiso/layuniso.
  const LAMP = `M22.6 3.4l6 6-3.4 3.4-6-6z`;
  const BEAM = `M19.4 7.1l-7.6 9.7M25.2 12.9l-5.3 8`;

  // Shared docked-palette board for the Palettes slide-out's mini column:
  // frame, left title strip, content lines (the object stands at its left).
  const PALB = `<rect x="15.5" y="5" width="13" height="21" stroke="${S}"/><path d="M19 5v21" stroke="${S}" opacity=".5"/><path d="M21.5 9.5h4M21.5 13.5h4M21.5 17.5h4" stroke="${S}" opacity=".7"/>`;

  // Shared ARC-flyout motif: quarter arc of radius 15 about (8.5,23.5), start
  // (8.5,8.5), mid (19.1,12.9), end (23.5,23.5) — matches icons2 'arc-center'.
  const ARCQ = `<path d="M8.5 8.5a15 15 0 0 1 15 15" stroke="${S}"/>`;
  const ARC_S = `<rect x="6.3" y="6.3" width="4.4" height="4.4" stroke="${U}"/>`;
  const ARC_M = `<rect x="17.3" y="11.1" width="3.6" height="3.6" stroke="${U}"/>`;
  const ARC_E = `<rect x="21.3" y="21.3" width="4.4" height="4.4" stroke="${U}"/>`;
  const ARC_CEN = `<circle cx="8.5" cy="23.5" r="2" fill="${R}" stroke="none"/>`;
  const ARC_LEGS = `<path d="M8.5 23.5v-15M8.5 23.5h15" stroke="${S}" opacity=".45"/>`;
  const ARC_WEDGE = `<path d="M8.5 17.5A6 6 0 0 1 14.5 23.5" stroke="${Y}"/>`;
  const ARC_CHORD = `<path d="M8.5 8.5L23.5 23.5" stroke="${U}"/>`;

  const P = {
    /* ---- file tabs ---- */
    // doc-current: the bullet the industry standard marks the open drawing with
    'doc-current': `<circle cx="16" cy="16" r="4" fill="${S}" stroke="none"/>`,
    /* ---- Modify slide-out (SPEC3 Â§26) ---- */
    // draw-order: two plates, the front one lifted clear with an arrow
    'draw-order': `<rect x="9" y="11" width="14" height="11" stroke="${S}" opacity=".5"/><rect x="4.5" y="16" width="14" height="11" stroke="${S}"/><path d="M26 14V5M22.6 8.4L26 5l3.4 3.4" stroke="${U}"/>`,
    // stop: the recorder's square, to sit beside 'record' and 'play'
    'stop': `<rect x="9.5" y="9.5" width="13" height="13" fill="${S}" stroke="${S}"/>`,
    /* dro-*: the Draw Order flyout. Two plates and an arrow — the plate the
       command moves is the blue one, the plate it moves past is grey, and
       the one in front is drawn solid while the one behind is faded. The
       four that pick out a kind carry that kind's glyph instead of a plate.
       Arrow column x 23..30, plates to its left. */
    // dro-front: the object clear of everything, arrow up
    'dro-front': `<rect x="8.5" y="15.5" width="12" height="9" stroke="${S}" opacity=".45"/><rect x="2.5" y="7.5" width="12" height="9" fill="${U}" fill-opacity=".15" stroke="${U}"/><path d="M26.5 21V9M23.1 12.4L26.5 9l3.4 3.4" stroke="${U}"/>`,
    // dro-back: the object under everything, arrow down
    'dro-back': `<rect x="2.5" y="7.5" width="12" height="9" stroke="${S}" opacity=".45"/><rect x="8.5" y="15.5" width="12" height="9" fill="${U}" fill-opacity=".15" stroke="${U}"/><path d="M26.5 9v12M23.1 17.6L26.5 21l3.4 3.4" stroke="${U}"/>`,
    // dro-above: the same, but the red dot is the reference object you pick
    'dro-above': `<rect x="8.5" y="15.5" width="12" height="9" stroke="${S}" opacity=".45"/><circle cx="14.5" cy="20" r="1.8" fill="${R}" stroke="none"/><rect x="2.5" y="7.5" width="12" height="9" fill="${U}" fill-opacity=".15" stroke="${U}"/><path d="M26.5 21V9M23.1 12.4L26.5 9l3.4 3.4" stroke="${U}"/>`,
    // dro-under: under that same picked reference
    'dro-under': `<rect x="2.5" y="7.5" width="12" height="9" stroke="${S}" opacity=".45"/><circle cx="8.5" cy="12" r="1.8" fill="${R}" stroke="none"/><rect x="8.5" y="15.5" width="12" height="9" fill="${U}" fill-opacity=".15" stroke="${U}"/><path d="M26.5 9v12M23.1 17.6L26.5 21l3.4 3.4" stroke="${U}"/>`,
    // dro-text-front: the A of 'text-multi' over a faded plate, arrow up
    'dro-text-front': `<rect x="3.5" y="15.5" width="17" height="9" stroke="${S}" opacity=".45"/><path d="M4 20.5L10 6.5l6 14M6.2 15.6h7.6" stroke="${U}"/><path d="M26.5 21V9M23.1 12.4L26.5 9l3.4 3.4" stroke="${U}"/>`,
    // dro-dim-front: an extension-line pair and its arrows, over the plate
    'dro-dim-front': `<rect x="3.5" y="15.5" width="17" height="9" stroke="${S}" opacity=".45"/><path d="M4.5 5.5v9M19.5 5.5v9" stroke="${S}"/><path d="M4.5 11h15" stroke="${U}"/><path d="M7.5 9.2L4.5 11l3 1.8M16.5 9.2L19.5 11l-3 1.8" stroke="${U}"/><path d="M26.5 21V9M23.1 12.4L26.5 9l3.4 3.4" stroke="${U}"/>`,
    // dro-leader-front: the landing and its arrowhead, over the plate
    'dro-leader-front': `<rect x="3.5" y="15.5" width="17" height="9" stroke="${S}" opacity=".45"/><path d="M4.5 13.5L11 6h9" stroke="${U}"/><path d="M7.3 12.6L4.5 13.5l.9-2.9" stroke="${U}"/><path d="M26.5 21V9M23.1 12.4L26.5 9l3.4 3.4" stroke="${U}"/>`,
    // dro-anno-front: text and dimension together — every annotation
    'dro-anno-front': `<rect x="3.5" y="15.5" width="17" height="9" stroke="${S}" opacity=".45"/><path d="M3.5 13.5L8 4l4.5 9.5M5.2 9.9h5.6" stroke="${U}"/><path d="M15.5 4.5v6M20.5 4.5v6" stroke="${S}"/><path d="M15.5 8h5" stroke="${U}"/><path d="M26.5 21V9M23.1 12.4L26.5 9l3.4 3.4" stroke="${U}"/>`,
    // dro-hatch-back: the hatched plate going down behind the plain one
    'dro-hatch-back': `<rect x="3.5" y="4.5" width="17" height="9" stroke="${S}" opacity=".45"/><rect x="3.5" y="15.5" width="17" height="9" stroke="${U}"/><path d="M3.5 21.5l6-6M8 24.5l9-9M14.5 24.5l6-6" stroke="${U}" opacity=".7"/><path d="M26.5 9v12M23.1 17.6L26.5 21l3.4 3.4" stroke="${U}"/>`,
    // set-bylayer: a layer plate feeding its colour down to an object
    'set-bylayer': `<path d="M16 3.5l11 6-11 6-11-6z" stroke="${S}"/><path d="M16 17.5v9M12.6 23.1l3.4 3.4 3.4-3.4" stroke="${U}"/><rect x="11.5" y="26.5" width="9" height="3" stroke="${Y}"/>`,
    // edit-pline: a two-segment polyline with its vertices marked
    'edit-pline': `<path d="M5 22.5L13 9.5l8 7 6-9" stroke="${S}"/><rect x="3.3" y="20.8" width="3.4" height="3.4" stroke="${U}"/><rect x="11.3" y="7.8" width="3.4" height="3.4" stroke="${U}"/><rect x="19.3" y="14.8" width="3.4" height="3.4" stroke="${U}"/><rect x="25.3" y="5.8" width="3.4" height="3.4" stroke="${U}"/>`,
    // edit-spline: a curve with its fit points
    'edit-spline': `<path d="M4.5 23c5-14 12 6 16.5-4.5 1.4-3.2 3.6-4.4 6.5-4" stroke="${S}"/><rect x="2.8" y="21.3" width="3.4" height="3.4" stroke="${U}"/><rect x="11.3" y="12.8" width="3.4" height="3.4" stroke="${U}"/><rect x="19.3" y="16.8" width="3.4" height="3.4" stroke="${U}"/><rect x="25.8" y="12.8" width="3.4" height="3.4" stroke="${U}"/>`,
    // edit-array: a grid of cells with one picked out
    'edit-array': `<rect x="4.5" y="6.5" width="8" height="8" stroke="${S}"/><rect x="16.5" y="6.5" width="8" height="8" stroke="${S}"/><rect x="4.5" y="18.5" width="8" height="8" stroke="${S}"/><rect x="16.5" y="18.5" width="8" height="8" stroke="${U}"/><path d="M26.5 20.5l3 3-4.5 4.5-3-3z" stroke="${Y}"/>`,
    // blend: two curve ends and the smooth run between them
    'blend': `<path d="M3.5 8.5c3.5 0 5.5 2 6.5 5" stroke="${S}"/><path d="M28.5 24.5c-3.5 0-5.5-2-6.5-5" stroke="${S}"/><path d="M10 13.5c1.6 4.8 4.6 7.2 12 6" stroke="${G}"/><rect x="8.3" y="11.8" width="3.4" height="3.4" stroke="${U}"/><rect x="20.3" y="17.8" width="3.4" height="3.4" stroke="${U}"/>`,
    // break-at: one line, one point, two pieces
    'break-at': `<path d="M3.5 16h11M17.5 16h11" stroke="${S}"/><path d="M16 8.5v15" stroke="${R}"/><rect x="14.3" y="14.3" width="3.4" height="3.4" stroke="${R}"/>`,
    // change-space: an object stepping from the model plate to the sheet
    'align-obj': `<path d="M4.5 24.5L12 9l7 8 8.5-6" stroke="${S}"/><path d="M4.5 27.5h23" stroke="${Y}" stroke-dasharray="3 3"/><path d="M9 4.5h14M20 2l3 2.5-3 2.5" stroke="${U}"/>`,
    /* ---- View tab ---- */
    // ucs-toggle: XY axis tripod with arrowheads + blue origin box
    'ucs-toggle': `<path d="M7 25V7M7 25h18" stroke="${S}"/><path d="M4.4 9.8L7 7l2.6 2.8M22.4 22.4L25 25l-2.6 2.6" stroke="${S}"/><rect x="4.8" y="22.8" width="4.4" height="4.4" stroke="${U}"/>`,
    // viewcube-toggle: axis gizmo — three axes with balls on their tips
    'viewcube-toggle': `<path d="M16 16L16 5.5M16 16l-9 5.5M16 16l9 5.5" stroke="${S}"/><circle cx="16" cy="5" r="3" fill="${U}" stroke="none"/><circle cx="6" cy="22" r="3" stroke="${S}"/><circle cx="26" cy="22" r="3" stroke="${Y}"/><circle cx="16" cy="16" r="1.4" fill="${S}" stroke="none"/>`,
    // navbar-toggle: canvas edge + docked vertical toolbar with compass dot
    'navbar-toggle': `<path d="M13.5 4.5h-9v23h9" stroke="${S}" opacity=".5"/><rect x="18.5" y="4.5" width="9" height="23" rx="2" stroke="${S}"/><circle cx="23" cy="9.5" r="2.1" stroke="${U}"/><path d="M20.5 15.5h5M20.5 19.5h5M20.5 23.5h5" stroke="${S}"/>`,
    // named-view: viewport with scene + yellow bookmark
    'named-view': `<rect x="4.5" y="6.5" width="23" height="19" stroke="${S}"/><path d="M19.5 6.5V15l3.5-2.6 3.5 2.6V6.5" stroke="${Y}"/><path d="M8 21.5l4.5-6 3.5 4 3-4.5 5 6.5" stroke="${S}"/>`,
    // new-view: small viewport + green plus
    'new-view': `<rect x="4.5" y="6.5" width="19" height="15" stroke="${S}"/><path d="M8 17.5l3.5-4.5 2.8 3 3.2-4.5 3 4" stroke="${S}" opacity=".7"/><path d="M24.5 18.5v9M20 23h9" stroke="${G}"/>`,
    // view-manager: list of view thumbnails, active one checked green
    'view-manager': `<rect x="4.5" y="4.5" width="23" height="23" stroke="${S}"/><rect x="8" y="8.5" width="7.5" height="6" stroke="${U}"/><rect x="8" y="17.5" width="7.5" height="6" stroke="${U}" opacity=".5"/><path d="M19 10.5l2 2 3.5-3.5" stroke="${G}"/><path d="M19 20.5h6" stroke="${S}" opacity=".6"/>`,
    // viewport-config: sheet split into 3 tiled viewports
    'viewport-config': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/><path d="M15 6v20M15 16h12.5" stroke="${U}"/>`,
    /* vpc-*: the Viewport Configuration gallery. One frame (4.5,6)-(27.5,26),
       divided the way that configuration divides model space — the dividers
       blue so the split reads at 16px. Keys match Nasj.vports. */
    'vpc-single': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/>`,
    'vpc-2v': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/><path d="M16 6v20" stroke="${U}"/>`,
    'vpc-2h': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/><path d="M4.5 16h23" stroke="${U}"/>`,
    'vpc-3r': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/><path d="M16 6v20M4.5 16h11.5" stroke="${U}"/>`,
    'vpc-3l': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/><path d="M16 6v20M16 16h11.5" stroke="${U}"/>`,
    'vpc-3a': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/><path d="M4.5 16h23M16 16v10" stroke="${U}"/>`,
    'vpc-3b': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/><path d="M4.5 16h23M16 6v10" stroke="${U}"/>`,
    'vpc-3v': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/><path d="M12.2 6v20M19.8 6v20" stroke="${U}"/>`,
    'vpc-3h': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/><path d="M4.5 12.7h23M4.5 19.3h23" stroke="${U}"/>`,
    'vpc-4e': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/><path d="M16 6v20M4.5 16h23" stroke="${U}"/>`,
    'vpc-4r': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/><path d="M16 6v20M4.5 12.7h11.5M4.5 19.3h11.5" stroke="${U}"/>`,
    'vpc-4l': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/><path d="M16 6v20M16 12.7h11.5M16 19.3h11.5" stroke="${U}"/>`,
    // vp-named: split viewports + yellow bookmark
    'vp-named': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/><path d="M13.5 6v20M13.5 15h14" stroke="${S}"/><path d="M19.5 6v6.5l3-2.2 3 2.2V6" stroke="${Y}"/>`,
    // vp-join: dashed divider with green arrows collapsing inward
    'vp-join': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/><path d="M16 6v20" stroke="${S}" stroke-dasharray="2.6 2.6" opacity=".5"/><path d="M7 16h6M10.7 13.7L13 16l-2.3 2.3M25 16h-6M21.3 13.7L19 16l2.3 2.3" stroke="${G}"/>`,
    // vp-restore: viewport + blue circular restore arrow
    'vp-restore': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/><path d="M21.7 12.6a7 7 0 1 0 1.8 6" stroke="${U}"/><path d="M22.3 8.8l.3 4.4-4.4-.3" stroke="${U}"/>`,
    /* ---- View â–¸ Palettes, and its slide-out ---- */
    // text-window: a console frame, its prompt caret green
    'text-window': `<rect x="3.5" y="6.5" width="25" height="19" stroke="${S}"/><path d="M3.5 11.5h25" stroke="${S}" opacity=".6"/><path d="M7 15.5l2.5 2.5L7 20.5" stroke="${G}"/><path d="M12.5 20.5h12M12.5 15.5h8" stroke="${S}" opacity=".8"/>`,
    // materials-browser: a shaded sphere beside a swatch grid
    'materials-browser': `<circle cx="11.5" cy="13" r="7.5" stroke="${S}"/><path d="M4.4 15.5a7.5 7.5 0 0 0 14.2 0" stroke="${S}" opacity=".5"/><rect x="20.5" y="18.5" width="4" height="4" stroke="${U}"/><rect x="25.5" y="18.5" width="4" height="4" stroke="${Y}"/><rect x="20.5" y="23.5" width="4" height="4" stroke="${G}"/><rect x="25.5" y="23.5" width="4" height="4" stroke="${R}"/>`,
    // materials-editor: the same sphere, under a pencil
    'materials-editor': `<circle cx="13" cy="16" r="8.5" stroke="${S}"/><path d="M4.6 18.5a8.5 8.5 0 0 0 16.8 0" stroke="${S}" opacity=".5"/><path d="M23 4.5l4 4-8.5 8.5-5 1 1-5z" stroke="${Y}"/>`,
    // visual-styles: a cube half wireframe, half shaded
    'visual-styles': `<path d="M16 4l10 5.5v11L16 26 6 20.5v-11z" stroke="${S}"/><path d="M6 9.5l10 5.5 10-5.5M16 15v11" stroke="${S}" opacity=".7"/><path d="M16 15l10-5.5v11L16 26z" fill="${U}" opacity=".3" stroke="none"/>`,
    /* The Palettes slide-out's mini column wears the industry standard's palette motif: a
       docked palette board on the right, the identifying object at its left.
       PALB is that shared board. */
    // designcenter: DesignCenter's chest of drawers beside the palette
    'designcenter': PALB + `<rect x="3.5" y="14.5" width="9.5" height="13" stroke="${Y}"/><path d="M3.5 19h9.5M3.5 23.5h9.5" stroke="${Y}"/><path d="M7 16.7h2.5M7 21.2h2.5M7 25.7h2.5" stroke="${Y}"/>`,
    // markup-set: the red marker pen beside the palette
    'markup-set': PALB + `<path d="M3.5 27.5l1.2-4.4 6.6-6.6 3.2 3.2-6.6 6.6z" stroke="${R}"/><path d="M12.6 15.2l1.4-1.4 3.2 3.2-1.4 1.4" stroke="${R}"/>`,
    // sun-props: the sun over its horizon, beside the palette board
    'sun-props': PALB + `<circle cx="8" cy="12" r="3.6" stroke="${Y}"/><path d="M8 4.5v2M8 17.5v2M1.5 12h2M12.5 12h2M3.4 7.4l1.4 1.4M11.2 15.2l1.4 1.4M12.6 7.4l-1.4 1.4M4.8 15.2l-1.4 1.4" stroke="${Y}"/><path d="M2.5 23.5h11" stroke="${S}" opacity=".6"/>`,
    // light-list: the lamp beside the palette board it is listed on
    'light-list': PALB + `<circle cx="8" cy="12" r="4" stroke="${Y}"/><path d="M8 3.5v2.5M2.6 6.6l1.8 1.8M13.4 6.6l-1.8 1.8M2.5 12h2.5M11 12h2.5" stroke="${Y}"/><path d="M6 17.5h4M6.5 20.5h3" stroke="${S}"/>`,
    // light-point: rays out of a bulb, every way at once
    'light-point': `<circle cx="16" cy="16" r="5" stroke="${Y}"/><path d="M16 3.5v5M16 23.5v5M3.5 16h5M23.5 16h5M7.2 7.2l3.5 3.5M21.3 21.3l3.5 3.5M24.8 7.2l-3.5 3.5M10.7 21.3l-3.5 3.5" stroke="${Y}"/>`,
    // light-spot: the lamp head and the cone it throws
    'light-spot': `<path d="M5.5 4.5l6 6-3 3-6-6z" stroke="${S}"/><path d="M10.5 12l17 6.5-9 9z" stroke="${Y}"/><path d="M13.5 15l9.5 3.6-5 5z" stroke="${Y}" opacity=".45"/>`,
    // light-distant: parallel rays, all one way, like the sun's
    'light-distant': `<circle cx="7" cy="7" r="3.5" stroke="${Y}"/><path d="M4.5 12.5L15 23M11.5 8.5L22 19M17.5 4.5L28 15" stroke="${Y}"/><path d="M11.5 23h3.5v-3.5M18.5 19H22v-3.5M24.5 15H28v-3.5" stroke="${Y}" opacity=".7"/>`,
    // render-presets: the lit sphere a render would shade, on its ground line,
    // beside the palette — the quality the preset picks, not the picture
    'render-presets': PALB + `<circle cx="8" cy="14" r="5.5" stroke="${S}"/><path d="M3.4 17a5.5 5.5 0 0 0 9.2 0" stroke="${S}" opacity=".5"/><path d="M2.5 22.5h11" stroke="${S}" opacity=".6"/><path d="M8 3.5v3M3.4 5.4l1.8 1.8M12.6 5.4l-1.8 1.8" stroke="${Y}"/>`,

    /* ---- Express Tools â–¸ Blocks slide-out: the nested-object family ---- */
    // block-to-xref: the block plate handed on to a linked sheet
    'block-to-xref': `<path d="M9 5.5l6.5 3.75L9 13 2.5 9.25z" stroke="${S}"/><path d="M12 18h8M17 15.5l3 2.5-3 2.5" stroke="${U}"/><rect x="21.5" y="12.5" width="8" height="11" stroke="${S}"/><path d="M23.5 20.7a2.1 2.1 0 0 1 0-3l1.4-1.4a2.1 2.1 0 0 1 3 3l-1.4 1.4a2.1 2.1 0 0 1-3 0" stroke="${G}"/>`,
    // copy-nested: the object inside the plate, copied out along the arrow
    'copy-nested': `<path d="M13 6.5l9.5 5.5-9.5 5.5-9.5-5.5z" stroke="${S}"/><circle cx="13" cy="12" r="2.6" stroke="${U}"/><path d="M17 21.5h9M22.6 18.1l3.4 3.4-3.4 3.4" stroke="${G}"/><circle cx="27.5" cy="27" r="2.6" stroke="${U}"/>`,
    // extend-nested: a line reaching the boundary the block carries
    'extend-nested': `<path d="M21 5.5l8.5 5-8.5 5-8.5-5z" stroke="${S}" opacity=".7"/><path d="M21 10.5v17" stroke="${S}"/><path d="M3.5 21h10M10.1 17.6l3.4 3.4-3.4 3.4" stroke="${G}"/>`,
    // trim-nested: the same nested edge, now cutting the line short
    'trim-nested': `<path d="M21 5.5l8.5 5-8.5 5-8.5-5z" stroke="${S}" opacity=".7"/><path d="M21 10.5v17" stroke="${S}"/><path d="M3.5 21h17.5" stroke="${S}"/><path d="M24 21h5" stroke="${R}" stroke-dasharray="2.4 2.2"/><path d="M19 18.5l4 5M23 18.5l-4 5" stroke="${R}"/>`,

    /* ---- Express Tools â–¸ Text slide-out ---- */
    // remote-text: a sheet whose lines arrive along the link from outside
    'remote-text': `<rect x="11.5" y="4.5" width="17" height="23" stroke="${S}"/><path d="M15 10.5h10M15 14.5h10M15 18.5h6" stroke="${S}" opacity=".7"/><path d="M2.5 23.5h6M6.1 20.9l2.6 2.6-2.6 2.6" stroke="${G}"/>`,
    // text-mask: the A standing on its filled masking patch
    'text-mask': `<rect x="5.5" y="5.5" width="21" height="21" fill="${U}" opacity=".28" stroke="${U}"/><path d="M11.5 23l4.5-13 4.5 13M13.4 18.5h5.2" stroke="${S}"/>`,
    // unmask-text: the same A, the patch reduced to a dashed memory
    'unmask-text': `<rect x="5.5" y="5.5" width="21" height="21" stroke="${U}" stroke-dasharray="3 2.6" opacity=".7"/><path d="M11.5 23l4.5-13 4.5 13M13.4 18.5h5.2" stroke="${S}"/>`,

    /* ---- Express Tools â–¸ Modify slide-out ---- */
    // flatten-obj: the tilted plate pressed down onto the flat line
    'flatten-obj': `<path d="M9.5 4.5l9 3.5-4.5 4.5-9-3.5z" stroke="${S}" opacity=".7"/><path d="M16 13.5v6.5M13 17l3 3 3-3" stroke="${U}"/><path d="M4.5 25.5h23" stroke="${S}"/><path d="M8.5 22.5h15" stroke="${S}" opacity=".45"/>`,
    // ext-clip: the block plate under a dashed red clipping circle
    'ext-clip': `<path d="M16 8l10.5 6L16 20 5.5 14z" stroke="${S}"/><circle cx="16" cy="17" r="9.5" stroke="${R}" stroke-dasharray="3 2.6"/>`,
    // ext-offset: the polyline and its offset twin, with the green plus
    'ext-offset': `<path d="M5.5 26.5V10.5h11" stroke="${S}"/><path d="M11.5 26.5v-10h10" stroke="${U}"/><path d="M24.5 5.5v7M21 9h7" stroke="${G}"/>`,
    // shape-to-block: the loose shape handed on to the block plate
    'shape-to-block': `<path d="M3.5 10.5c1.5-4.5 6-4.5 7 0s5.5 4.5 7 0" stroke="${Y}"/><path d="M8 17h8M13 14.5l3 2.5-3 2.5" stroke="${U}"/><path d="M21 15.5l7.5 4.25L21 24l-7.5-4.25z" stroke="${S}"/>`,

    /* ---- Express Tools â–¸ Tools slide-out ---- */
    // ext-plan: the plan sheet framed on the objects the selection picked
    'ext-plan': `<rect x="4.5" y="4.5" width="23" height="23" stroke="${S}" opacity=".5"/><rect x="9.5" y="9.5" width="13" height="13" stroke="${U}"/><path d="M12.5 19.5l3-4 2.5 2 2-3 2.5 3.5" stroke="${S}"/>`,
    // make-ltype: the dash pattern being made, with the green plus
    'make-ltype': `<path d="M3.5 10.5h8M14.5 10.5h4M21.5 10.5h2" stroke="${S}"/><path d="M3.5 17.5h5M11.5 17.5h6M20.5 17.5h3" stroke="${U}"/><path d="M24.5 21.5v7M21 25h7" stroke="${G}"/>`,
    // make-shape: the squiggle a shape would capture, with the plus
    'make-shape': `<path d="M4.5 16c2-7 7-7 8.5 0s6.5 7 8.5 0" stroke="${Y}"/><path d="M24.5 21.5v7M21 25h7" stroke="${G}"/>`,
    // vp-scale: a viewport frame with the ruler ticks its scale is read from
    'vp-scale': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/><path d="M8 22.5L23.5 9.5" stroke="${U}"/><path d="M10.5 20.4l1.8 2.1M14.4 17.1l1.8 2.1M18.3 13.8l1.8 2.1M22.2 10.5l1.8 2.1" stroke="${U}"/>`,

    /* ---- Manage / collaborate ---- */
    // dwg-compare: red vs green overlapping frames
    'dwg-compare': `<rect x="4.5" y="4.5" width="16" height="16" stroke="${R}"/><rect x="11.5" y="11.5" width="16" height="16" stroke="${G}"/>`,
    // activity-insights: axis + blue bars + yellow trend arrow
    'activity-insights': `<path d="M5 4.5v23h22.5" stroke="${S}"/><path d="M10 27.5v-8M16 27.5V13.5M22 27.5V16.5" stroke="${U}"/><path d="M8 12l6.5-5 4.5 3.5L27 4.5" stroke="${Y}"/><path d="M27 9V4.5h-4.5" stroke="${Y}"/>`,
    // tool-palettes: panel with side tabs + tool rows
    'tool-palettes': `<rect x="6.5" y="4.5" width="17" height="23" rx="1.5" stroke="${S}"/><path d="M23.5 8.5h4v6h-4M23.5 17.5h4v6h-4" stroke="${U}"/><path d="M10 10.5h10M10 15.5h10M10 20.5h7" stroke="${S}" opacity=".65"/>`,
    // palette-blocks: panel holding an iso block cube
    'palette-blocks': `<rect x="6.5" y="4.5" width="19" height="23" rx="1.5" stroke="${S}"/><path d="M16 8.5l5.5 3v6.5L16 21l-5.5-3v-6.5z" stroke="${U}"/><path d="M10.5 11.5l5.5 3 5.5-3M16 14.5V21" stroke="${U}"/><path d="M11 24.5h10" stroke="${S}" opacity=".6"/>`,
    // traces: tracing-paper overlay + yellow marker squiggle
    'traces': `<path d="M9 4.5h18.5V23" stroke="${S}" opacity=".45"/><rect x="4.5" y="9" width="23" height="18.5" stroke="${S}"/><path d="M8.5 22c3-7 5 1 8-4.5 1.7-3 4-4 7-3" stroke="${Y}"/>`,
    // count: block squares + green tally badge
    'count': `<rect x="5" y="18.5" width="8" height="8" stroke="${S}"/><rect x="17" y="18.5" width="8" height="8" stroke="${S}" opacity=".6"/><circle cx="22.5" cy="8.5" r="6" stroke="${G}"/><path d="M20.3 6.8h4.4M20.3 10.2h4.4" stroke="${G}"/>`,
    // cmd-macros: command window, prompt chevron + yellow play
    'cmd-macros': `<rect x="4.5" y="6.5" width="23" height="19" rx="1.5" stroke="${S}"/><path d="M8 12.5l3.5 3.5L8 19.5" stroke="${U}"/><path d="M14.5 19.5h6.5" stroke="${S}"/><path d="M20.5 10.2l4.6 2.7-4.6 2.7z" stroke="${Y}"/>`,
    // geometry-cleanup: broom sweeping stray marks
    'geometry-cleanup': `<path d="M27.5 4.5l-9 9" stroke="${S}"/><path d="M18.5 13.5l-8.6 2.7 5.9 5.9 2.7-8.6z" stroke="${Y}"/><path d="M8 24.5L5.5 27M12.5 27l-2 2.5M5.5 19.5L3 21.5" stroke="${S}" opacity=".7"/>`,
    // sheet-set: cascaded sheets, front one with entries
    'sheet-set': `<path d="M11.5 2.5H29v18" stroke="${S}" opacity=".35"/><path d="M8 6h18v18" stroke="${S}" opacity=".6"/><rect x="4.5" y="9.5" width="18" height="18" stroke="${S}"/><path d="M8.5 15.5h10M8.5 20.5h7" stroke="${U}"/>`,
    // switch-windows: two windows + double-headed diagonal arrow
    'switch-windows': `<rect x="4.5" y="4.5" width="12" height="9.5" stroke="${S}"/><rect x="15.5" y="18" width="12" height="9.5" stroke="${S}"/><path d="M11 21L21 11M21 15.5V11h-4.5M11 16.5V21h4.5" stroke="${U}"/>`,
    // file-tabs-toggle: document area with tabs on top (active blue)
    'file-tabs-toggle': `<rect x="4.5" y="10.5" width="23" height="17" stroke="${S}"/><path d="M7.5 10.5V8.5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="${U}"/><path d="M18 10.5V8.5a2 2 0 0 1 2-2h3.5a2 2 0 0 1 2 2v2" stroke="${S}" opacity=".5"/>`,
    // layout-tabs-toggle: document area with tabs below (active blue)
    'layout-tabs-toggle': `<rect x="4.5" y="4.5" width="23" height="17" stroke="${S}"/><path d="M7.5 21.5v2a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2" stroke="${U}"/><path d="M18 21.5v2a2 2 0 0 0 2 2h3.5a2 2 0 0 0 2-2v-2" stroke="${S}" opacity=".5"/>`,
    // tile-h: frame split by horizontal divider
    'tile-h': `<rect x="4.5" y="4.5" width="23" height="23" stroke="${S}"/><path d="M4.5 16h23" stroke="${U}"/>`,
    // tile-v: frame split by vertical divider
    'tile-v': `<rect x="4.5" y="4.5" width="23" height="23" stroke="${S}"/><path d="M16 4.5v23" stroke="${U}"/>`,
    // cascade: three stacked offset windows, front title bar blue
    'cascade': `<rect x="4.5" y="4.5" width="17" height="17" stroke="${S}" opacity=".35"/><rect x="7.5" y="7.5" width="17" height="17" stroke="${S}" opacity=".6"/><rect x="10.5" y="10.5" width="17" height="17" stroke="${S}"/><path d="M10.5 14.5h17" stroke="${U}"/>`,
    // record: ring + solid red dot
    'record': `<circle cx="16" cy="16" r="10.5" stroke="${S}"/><circle cx="16" cy="16" r="4.6" fill="${R}" stroke="none"/>`,
    // play: ring + green triangle
    'play': `<circle cx="16" cy="16" r="10.5" stroke="${S}"/><path d="M13 11.2l7.6 4.8-7.6 4.8z" stroke="${G}"/>`,
    // macro-select: list of macros, active row green play + blue line
    'macro-select': `<rect x="4.5" y="4.5" width="23" height="23" rx="1.5" stroke="${S}"/><path d="M8.5 9.8l4 2.4-4 2.4z" stroke="${G}"/><path d="M16 12.2h9.5" stroke="${U}"/><path d="M8.5 18.8l4 2.4-4 2.4z" stroke="${S}" opacity=".5"/><path d="M16 21.2h9.5" stroke="${S}" opacity=".5"/>`,
    // user-interface: app window with ribbon + side panel dividers
    'user-interface': `<rect x="4.5" y="4.5" width="23" height="23" rx="1.5" stroke="${S}"/><path d="M4.5 10.5h23M11.5 10.5v17" stroke="${U}"/>`,
    // cui-import: UI window + green down arrow
    'cui-import': `<rect x="4.5" y="4.5" width="19" height="19" rx="1.5" stroke="${S}"/><path d="M4.5 9.5h19M10.5 9.5v14" stroke="${S}"/><path d="M26.5 17.5v10M22.8 23.8l3.7 3.7 3.7-3.7" stroke="${G}"/>`,
    // cui-export: UI window + yellow up arrow
    'cui-export': `<rect x="4.5" y="4.5" width="19" height="19" rx="1.5" stroke="${S}"/><path d="M4.5 9.5h19M10.5 9.5v14" stroke="${S}"/><path d="M26.5 27.5v-10M22.8 21.2l3.7-3.7 3.7 3.7" stroke="${Y}"/>`,
    // edit-aliases: alias -> command mapping rows + pencil
    'edit-aliases': `<path d="M5 8.5h5.5M5 14.5h5.5" stroke="${S}"/><path d="M13.5 8.5H20M18.3 6.6L20 8.5l-1.7 1.9M13.5 14.5H20M18.3 12.6L20 14.5l-1.7 1.9" stroke="${U}"/><path d="M14.5 27.5l.9-3.9 8.1-8.1 3 3-8.1 8.1z" stroke="${Y}"/>`,
    // load-app: green arrow dropping into a box
    'load-app': `<rect x="5.5" y="15.5" width="21" height="12" stroke="${S}"/><path d="M11 20.5h10" stroke="${S}" opacity=".55"/><path d="M16 3v9.5M12 8.5l4 4 4-4" stroke="${G}"/>`,
    // run-script: script document + green play badge
    'run-script': `<path d="M6.5 3.5h11l5.5 5.5v8" stroke="${S}"/><path d="M6.5 3.5v24h8" stroke="${S}"/><path d="M17.5 3.5V9h5.5" stroke="${S}"/><path d="M10 13.5h7M10 17.5h5" stroke="${S}" opacity=".55"/><circle cx="22.5" cy="22.5" r="5.8" stroke="${G}"/><path d="M20.9 20l4.3 2.5-4.3 2.5z" stroke="${G}"/>`,
    // vb-editor: editor window + blue angle brackets
    'vb-editor': `<rect x="4.5" y="4.5" width="23" height="23" rx="1.5" stroke="${S}"/><path d="M4.5 10h23" stroke="${S}"/><path d="M12.5 14.5L8 19l4.5 4.5M19.5 14.5L24 19l-4.5 4.5" stroke="${U}"/>`,
    // lisp-editor: editor window + green parentheses
    'lisp-editor': `<rect x="4.5" y="4.5" width="23" height="23" rx="1.5" stroke="${S}"/><path d="M4.5 10h23" stroke="${S}"/><path d="M12.5 13.5c-2.6 2.9-2.6 8.1 0 11M19.5 13.5c2.6 2.9 2.6 8.1 0 11" stroke="${G}"/>`,
    // vba-macro: gear with yellow play inside
    'vba-macro': `<circle cx="16" cy="16" r="7.8" stroke="${S}"/><path d="M16 4.6v3.2M16 24.2v3.2M4.6 16h3.2M24.2 16h3.2M8 8l2.3 2.3M21.7 21.7L24 24M24 8l-2.3 2.3M10.3 21.7L8 24" stroke="${S}" stroke-width="2.6"/><path d="M14 13l5.2 3-5.2 3z" stroke="${Y}"/>`,
    // layer-translator: source plate -> blue target plate, yellow arrow
    'layer-translator': `<path d="M9.5 4.5L17 8.5l-7.5 4L2 8.5z" stroke="${S}"/><path d="M22.5 19.5l7.5 4-7.5 4-7.5-4z" stroke="${U}"/><path d="M11.5 14.5l8.5 5.5M17.2 20.6l2.8-.6-.4-2.9" stroke="${Y}"/>`,
    // check-standards: shield + green check
    'check-standards': `<path d="M16 3.5l10.5 3.8v7.9c0 6.8-4.2 11-10.5 13.3C9.7 26.2 5.5 22 5.5 15.2V7.3z" stroke="${S}"/><path d="M11.2 15.8l3.4 3.4 6.2-6.2" stroke="${G}"/>`,
    // configure-standards: shield + yellow mini gear
    'configure-standards': `<path d="M16 3.5l10.5 3.8v7.9c0 6.8-4.2 11-10.5 13.3C9.7 26.2 5.5 22 5.5 15.2V7.3z" stroke="${S}"/><circle cx="16" cy="14.5" r="3" stroke="${Y}"/><path d="M16 8.7v2.2M16 18.1v2.2M10.2 14.5h2.2M19.6 14.5h2.2" stroke="${Y}" stroke-width="2"/>`,
    // purge: funnel filtering out red unused items
    'purge': `<path d="M4.5 5.5h23l-9 10v10.5l-5-3.5V15.5z" stroke="${S}"/><path d="M10.8 9.5h.01M16 9.5h.01M21.2 9.5h.01" stroke="${R}" stroke-width="3"/>`,
    // audit: drawing file + magnifier with green check
    'audit': `<path d="M13.5 27.5h-7v-24h10.5l5.5 5.5V14" stroke="${S}"/><path d="M17 3.5V9h5.5" stroke="${S}"/><circle cx="20.5" cy="19.5" r="6" stroke="${U}"/><path d="M25 24l4 4" stroke="${U}"/><path d="M17.9 19.5l1.9 1.9 3.5-3.5" stroke="${G}"/>`,
    // overkill: solid line + dashed duplicate crossed out red
    'overkill': `<path d="M4.5 13h23" stroke="${S}"/><path d="M4.5 17.5h17.5" stroke="${S}" opacity=".4" stroke-dasharray="2.6 2.6"/><path d="M23.5 14.5l6 6M29.5 14.5l-6 6" stroke="${R}"/>`,
    // perf-analyzer: speedometer gauge, red needle
    'perf-analyzer': `<path d="M4.5 23.5a11.5 11.5 0 0 1 23 0" stroke="${S}"/><path d="M5 27.5h22" stroke="${S}" opacity=".5"/><path d="M8.1 15.6l1.9 1.3M16 11.6v2.3M23.9 15.6L22 16.9" stroke="${S}" opacity=".7"/><path d="M16 23.5l5.2-7" stroke="${R}"/>`,

    /* ---- Output ---- */
    // batch-plot: printer emitting a stack of sheets
    'batch-plot': `<path d="M9.5 10.5v-5h13v5" stroke="${S}"/><rect x="4.5" y="10.5" width="23" height="9" rx="1.5" stroke="${S}"/><rect x="8" y="16.5" width="12" height="10.5" stroke="${U}"/><path d="M20 14h4.5v10.5" stroke="${U}" opacity=".5"/>`,
    // plot-preview: sheet + blue magnifier
    'plot-preview': `<rect x="6.5" y="4.5" width="19" height="23" stroke="${S}"/><path d="M10.5 9.5h11M10.5 13.5h8" stroke="${S}" opacity=".55"/><circle cx="19.5" cy="19.5" r="5.5" stroke="${U}"/><path d="M23.6 23.6L28 28" stroke="${U}"/>`,
    // page-setup: sheet + yellow gear
    'page-setup': `<rect x="6.5" y="4.5" width="19" height="23" stroke="${S}"/><path d="M10.5 9.5h11" stroke="${S}" opacity=".55"/><circle cx="21" cy="21" r="3.6" stroke="${Y}"/><path d="M21 14.6v2.2M21 25.2v2.2M14.6 21h2.2M25.2 21h2.2M16.5 16.5l1.6 1.6M23.9 23.9l1.6 1.6M25.5 16.5l-1.6 1.6M18.1 23.9l-1.6 1.6" stroke="${Y}" stroke-width="2"/>`,
    // view-details: eye over detail lines
    'view-details': `<path d="M4 11c3.2-4.3 7.2-6.5 12-6.5S24.8 6.7 28 11c-3.2 4.3-7.2 6.5-12 6.5S7.2 15.3 4 11z" stroke="${S}"/><circle cx="16" cy="11" r="3.1" stroke="${U}"/><path d="M6 23h20M6 27.5h13" stroke="${S}" opacity=".7"/>`,
    // plotter-manager: printer + yellow config slider
    'plotter-manager': `<path d="M9.5 11v-5h13v5" stroke="${S}"/><rect x="4.5" y="11" width="23" height="9.5" rx="1.5" stroke="${S}"/><path d="M7.5 25.5h17" stroke="${S}"/><circle cx="13" cy="25.5" r="2.3" stroke="${Y}"/>`,
    // export-dwfx: drawing file + blue export arrow
    'export-dwfx': `<path d="M14.5 27.5H6.5v-24h10.5l5.5 5.5V14" stroke="${S}"/><path d="M17 3.5V9h5.5" stroke="${S}"/><path d="M17.5 21.5H29M25.3 17.8l3.7 3.7-3.7 3.7" stroke="${U}"/>`,

    /* ---- Express Tools ---- */
    // explode-attrs: attribute tag + yellow burst rays
    'explode-attrs': `<path d="M4.5 4.5h8.3l9.7 9.7a2 2 0 0 1 0 2.8l-5.5 5.5a2 2 0 0 1-2.8 0L4.5 12.8z" stroke="${S}"/><circle cx="9" cy="9" r="1.4" stroke="${S}"/><path d="M24.5 8.5L29 4M24.5 24.5L29 29M27 16.5h2.5" stroke="${Y}"/>`,
    // list-props: window with header + blue property readout
    'list-props': `<rect x="4.5" y="4.5" width="23" height="23" rx="1.5" stroke="${S}"/><path d="M4.5 9.5h23" stroke="${S}"/><path d="M8.5 14.5h9.5M8.5 19h13M8.5 23.5h7.5" stroke="${U}"/>`,
    // import-attrs: attribute tag + green down arrow
    'import-attrs': `<path d="M4.5 4.5h7.3l7.7 7.7a1.9 1.9 0 0 1 0 2.7l-4.6 4.6a1.9 1.9 0 0 1-2.7 0L4.5 11.8z" stroke="${S}"/><circle cx="8.7" cy="8.7" r="1.3" stroke="${S}"/><path d="M25 15.5v11M21 22.5l4 4 4-4" stroke="${G}"/>`,
    // export-attrs: attribute tag + yellow up arrow
    'export-attrs': `<path d="M4.5 4.5h7.3l7.7 7.7a1.9 1.9 0 0 1 0 2.7l-4.6 4.6a1.9 1.9 0 0 1-2.7 0L4.5 11.8z" stroke="${S}"/><circle cx="8.7" cy="8.7" r="1.3" stroke="${S}"/><path d="M25 26.5v-11M21 19.5l4-4 4 4" stroke="${Y}"/>`,
    // arc-text: blue arc with letter ticks + A below
    'arc-text': `<path d="M5.5 20.5A12 12 0 0 1 26.5 20.5" stroke="${U}"/><path d="M9.4 14.8L7.5 12.6M16 12.1V9.2M22.6 14.8l1.9-2.2" stroke="${S}"/><path d="M11.5 28l4.5-10.5L20.5 28M13.3 23.8h5.4" stroke="${S}"/>`,
    // modify-text: A + yellow pencil
    'modify-text': `<path d="M5.5 24L11.5 8l6 16M7.7 18.5h7.6" stroke="${S}"/><path d="M17 27.5l.9-3.9 7.7-7.7 3 3-7.7 7.7z" stroke="${Y}"/>`,
    // the Modify Text flyout: an A with what each command does to it
    'text-explode': `<path d="M6 22.5L11.5 9.5l5.5 13M8 18.5h7" stroke="${S}" stroke-dasharray="2.6 2.2"/><path d="M22 6.5l1.6 4.2 4.4 1.4-4.4 1.6L22 18l-1.6-4.3-4.4-1.6 4.4-1.4z" stroke="${Y}"/><path d="M20 22.5l2.5 6M25.5 21.5l3.5 4" stroke="${U}"/>`,
    'text-case': `<path d="M3.5 22L9 9l5.5 13M5.5 18h7" stroke="${S}"/><path d="M19.5 22v-8.5M19.5 16.5a3.2 3.2 0 1 1 6.4 0V22M25.9 18.4h-6.4" stroke="${U}"/>`,
    'text-rotate': `<path d="M6.5 23L12 10l5.5 13M8.5 19h7" stroke="${S}"/><path d="M22 8.5a7.5 7.5 0 1 1-6.4 3.6" stroke="${U}"/><path d="M15.2 7.4l.4 4.9 4.8-.9" stroke="${U}"/>`,
    'text-fit': `<path d="M11 21.5L14.5 12l3.5 9.5M12.4 18.6h4.2" stroke="${S}"/><path d="M4.5 8.5v15M27.5 8.5v15" stroke="${U}"/><path d="M6 16h4.5M6 16l2-1.8M6 16l2 1.8M26 16h-4.5M26 16l-2-1.8M26 16l-2 1.8" stroke="${U}"/>`,
    'text-justify': `<path d="M6.5 20.5L11 9.5l4.5 11M8 17.2h6" stroke="${S}"/><path d="M4.5 25.5h23M4.5 5.5h23" stroke="${U}" opacity=".55"/><rect x="19" y="12.5" width="4.4" height="4.4" stroke="${U}"/>`,
    // convert-mtext: single line -> paragraph block via yellow arrow
    'convert-mtext': `<path d="M4.5 6.5h10" stroke="${S}"/><path d="M8 10.5v4.5a3.5 3.5 0 0 0 3.5 3.5h1.5M10.8 16l2.7 2.5-2.7 2.5" stroke="${Y}"/><path d="M17.5 18.5h10M17.5 22.5h10M17.5 26.5h6.5" stroke="${U}"/>`,
    // auto-number: rows prefixed by growing green tally marks (1,2,3)
    'auto-number': `<path d="M6.5 6v4.5" stroke="${G}"/><path d="M11.5 8h15" stroke="${S}"/><path d="M4.9 14v4.5M8.1 14v4.5" stroke="${G}"/><path d="M11.5 16h15" stroke="${S}"/><path d="M3.5 22v4.5M6.5 22v4.5M9.5 22v4.5" stroke="${G}"/><path d="M12.5 24h14" stroke="${S}"/>`,
    // enclose-object: A wrapped in dashed blue box
    'enclose-object': `<path d="M11.5 21.5L16 9.5l4.5 12M13.2 17h5.6" stroke="${S}"/><rect x="4.5" y="4.5" width="23" height="23" stroke="${U}" stroke-dasharray="3.4 3.4"/>`,
    // mocoro: move cross + blue rotate arc (move/copy/rotate combo)
    'mocoro': `<path d="M16 5.5v21M5.5 16h21" stroke="${S}"/><path d="M13.4 7.9L16 5.3l2.6 2.6M13.4 24.1l2.6 2.6 2.6-2.6M7.9 13.4L5.3 16l2.6 2.6M24.1 13.4l2.6 2.6-2.6 2.6" stroke="${S}"/><path d="M22.5 4.2a12.6 12.6 0 0 1 5.3 5.3" stroke="${U}"/><path d="M28.4 5.1l-.3 4.6-4.6-.4" stroke="${U}"/>`,
    // stretch-multiple: two stretch rows (rect + dashed edge + blue arrow)
    'stretch-multiple': `<rect x="3.5" y="4.5" width="9" height="8" stroke="${S}"/><path d="M16.5 4.5v8" stroke="${S}" stroke-dasharray="2.4 2.4" opacity=".55"/><path d="M11 8.5h15.5M23 5.5l3.5 3-3.5 3" stroke="${U}"/><rect x="3.5" y="19.5" width="9" height="8" stroke="${S}"/><path d="M16.5 19.5v8" stroke="${S}" stroke-dasharray="2.4 2.4" opacity=".55"/><path d="M11 23.5h15.5M23 20.5l3.5 3-3.5 3" stroke="${U}"/>`,
    // align-space: two spaces aligned on a yellow datum line
    'align-space': `<rect x="4.5" y="4.5" width="10.5" height="23" stroke="${S}"/><rect x="18.5" y="4.5" width="9" height="23" stroke="${S}" opacity=".55"/><path d="M2.5 16h27" stroke="${Y}" stroke-dasharray="3.2 3.2"/><path d="M9.75 16h.01M23 16h.01" stroke="${Y}" stroke-width="3.4"/>`,
    // sync-viewports: two viewports + green cyclic arrows
    'sync-viewports': `<rect x="4.5" y="4.5" width="11.5" height="9" stroke="${S}"/><rect x="16" y="18.5" width="11.5" height="9" stroke="${S}"/><path d="M20 6.5c4.5.6 7.3 3.4 7.9 7.9" stroke="${G}"/><path d="M28.9 10.3l-1 4.5-4.5-1" stroke="${G}"/><path d="M12 25.5c-4.5-.6-7.3-3.4-7.9-7.9" stroke="${G}"/><path d="M3.1 21.7l1-4.5 4.5 1" stroke="${G}"/>`,
    // merge-layout: two small sheets funneling into one blue layout
    'merge-layout': `<rect x="4.5" y="4.5" width="8.5" height="8.5" stroke="${S}"/><rect x="4.5" y="19" width="8.5" height="8.5" stroke="${S}" opacity=".7"/><rect x="18.5" y="9.5" width="9" height="13" stroke="${U}"/><path d="M13.5 8.7c2.3.9 3.7 2.2 4.4 4M13.5 23.3c2.3-.9 3.7-2.2 4.4-4" stroke="${Y}"/>`,
    // breakline: line interrupted by yellow zigzag break symbol
    'breakline': `<path d="M3.5 16h8M20.5 16h8" stroke="${S}"/><path d="M11.5 16l3-5.5 3 11 3-5.5" stroke="${Y}"/>`,
    // superhatch: hatched square + odd yellow pattern element
    'superhatch': `<rect x="5" y="5" width="22" height="22" stroke="${S}"/><path d="M5 12.5l7.5-7.5M5 20l15-15M8.5 27L27 8.5M17 27l10-10" stroke="${U}" opacity=".75"/><circle cx="21" cy="21.5" r="3.6" stroke="${Y}"/>`,
    // annotation-attach: note lines + blue leader arrow onto object
    'annotation-attach': `<rect x="4.5" y="18.5" width="10" height="9" stroke="${S}"/><path d="M27.5 6.5h-7.5L13.5 17" stroke="${U}"/><path d="M16.6 16.1l-3.1.9.7-3.1" stroke="${U}"/><path d="M21.5 11h6M23.5 15h4" stroke="${S}" opacity=".7"/>`,
    // reset-text: A + green circular reset arrow
    'reset-text': `<path d="M4.5 24.5L10 9.5l5.5 15M6.6 19.5h6.8" stroke="${S}"/><path d="M28.5 13.5a6.8 6.8 0 1 1-2-4.8" stroke="${G}"/><path d="M28.7 5.4v4.4h-4.4" stroke="${G}"/>`,
    // import-style: dim-style glyph + green down arrow
    'import-style': `<path d="M4.5 6v10M14.5 6v10M4.5 11h10M7.1 9.3L4.5 11l2.6 1.7M11.9 9.3l2.6 1.7-2.6 1.7" stroke="${S}"/><path d="M24 15.5v11M20 22.5l4 4 4-4" stroke="${G}"/>`,
    // export-style: dim-style glyph + yellow up arrow
    'export-style': `<path d="M4.5 6v10M14.5 6v10M4.5 11h10M7.1 9.3L4.5 11l2.6 1.7M11.9 9.3l2.6 1.7-2.6 1.7" stroke="${S}"/><path d="M24 26.5v-11M20 19.5l4-4 4 4" stroke="${Y}"/>`,
    // cmd-aliases: prompt chevron + yellow equals rows
    'cmd-aliases': `<rect x="4.5" y="6.5" width="23" height="19" rx="1.5" stroke="${S}"/><path d="M8 12.5l3.5 3.5L8 19.5" stroke="${U}"/><path d="M16.5 14h7.5M16.5 18h7.5" stroke="${Y}"/>`,
    // attach-xdata: data cylinder + green plus
    'attach-xdata': `<ellipse cx="13.5" cy="7.5" rx="8" ry="3.2" stroke="${S}"/><path d="M5.5 7.5v13c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2v-13" stroke="${S}"/><path d="M5.5 14c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2" stroke="${S}" opacity=".6"/><path d="M26 19.5v9M21.5 24h9" stroke="${G}"/>`,
    // list-xdata: data cylinder + blue readout lines
    'list-xdata': `<ellipse cx="12.5" cy="7.5" rx="7.5" ry="3" stroke="${S}"/><path d="M5 7.5v13c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-13" stroke="${S}"/><path d="M5 14c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" stroke="${S}" opacity=".6"/><path d="M23.5 13.5h5.5M23.5 18h5.5M23.5 22.5h4" stroke="${U}"/>`,
    // sysvars: three variable sliders with blue knobs
    'sysvars': `<path d="M5 9.5h22M5 16h22M5 22.5h22" stroke="${S}"/><circle cx="11.5" cy="9.5" r="2.5" stroke="${U}"/><circle cx="20.5" cy="16" r="2.5" stroke="${U}"/><circle cx="14.5" cy="22.5" r="2.5" stroke="${U}"/>`,

    /* ---- Layer tools family: shared plate + state glyph ---- */
    // layiso: plate + spotlight lamp with yellow beam (isolate)
    'layiso': PLATE + `<path d="${LAMP}" stroke="${S}"/><path d="${BEAM}" stroke="${Y}"/>`,
    // layuniso: plate + dimmed spotlight, red slash through beam (unisolate)
    'layuniso': PLATE + `<path d="${LAMP}" stroke="${S}" opacity=".55"/><path d="${BEAM}" stroke="${Y}" opacity=".35"/><path d="M16.5 4.5l11 11" stroke="${R}"/>`,
    // layoff: dimmed plate + red slash
    'layoff': `<path d="M11 17.5l8.5 4.75L11 27l-8.5-4.75z" stroke="${S}" opacity=".5"/><path d="M27.5 4.5l-23 23" stroke="${R}"/>`,
    // layon: plate + lit yellow bulb
    'layon': PLATE + `<circle cx="23" cy="7.8" r="4" stroke="${Y}"/><path d="M21.4 11.5v2.6h3.2v-2.6" stroke="${Y}"/><path d="M23 1.2v1.7M16.9 7.8h-1.7M29.1 7.8h1.7" stroke="${Y}" opacity=".9"/>`,
    // layfrz: plate + blue snowflake (freeze)
    'layfrz': PLATE + `<path d="M23 2.8v11.4M18 5.6l10 5.8M28 5.6l-10 5.8" stroke="${U}"/>`,
    // laythw: plate + yellow sun (thaw)
    'laythw': PLATE + `<circle cx="23" cy="8.5" r="3.2" stroke="${Y}"/><path d="M23 2v2.2M23 12.8V15M16.5 8.5h2.2M27.3 8.5h2.2M18.4 3.9l1.6 1.6M26 12l1.6 1.6M27.6 3.9L26 5.5M20 12l-1.6 1.6" stroke="${Y}"/>`,
    // laylck: plate + closed yellow padlock
    'laylck': PLATE + `<rect x="18.6" y="8.2" width="9" height="7" rx="1.1" stroke="${Y}"/><path d="M20.8 8.2V5.9a2.35 2.35 0 0 1 4.7 0v2.3" stroke="${Y}"/>`,
    // layulk: plate + open green padlock (shackle raised)
    'layulk': PLATE + `<rect x="18.6" y="8.2" width="9" height="7" rx="1.1" stroke="${G}"/><path d="M22.9 8.2V4.9a2.35 2.35 0 0 1 4.7 0v1.2" stroke="${G}"/>`,
    // laymcur: plate + green check (make current)
    'laymcur': PLATE + `<path d="M17.5 8.5l3.8 3.8 7.2-7.2" stroke="${G}"/>`,

    /* ---- Ribbon-select swatches ---- */
    // color-wheel: four accent arcs + hub
    'color-wheel': `<path d="M16 5.5a10.5 10.5 0 0 1 10.5 10.5" stroke="${R}"/><path d="M26.5 16A10.5 10.5 0 0 1 16 26.5" stroke="${U}"/><path d="M16 26.5A10.5 10.5 0 0 1 5.5 16" stroke="${G}"/><path d="M5.5 16A10.5 10.5 0 0 1 16 5.5" stroke="${Y}"/><circle cx="16" cy="16" r="4" stroke="${S}"/>`,
    // linetype-icon: solid / dashed / dash-dot samples
    'linetype-icon': `<path d="M4.5 8h23" stroke="${S}"/><path d="M4.5 16h23" stroke="${U}" stroke-dasharray="4 2.6"/><path d="M4.5 24h23" stroke="${S}" stroke-dasharray="6 2.2 1.2 2.2"/>`,
    // lineweight-icon: thin / medium / thick samples
    'lineweight-icon': `<path d="M5 8.5h22" stroke="${S}" stroke-width="1.1"/><path d="M5 16h22" stroke="${S}" stroke-width="2.4"/><path d="M5 23.5h22" stroke="${U}" stroke-width="4.2"/>`,
    // more-colors: painter's palette with accent dots
    'more-colors': `<path d="M16 4.5C9.6 4.5 4.5 9.6 4.5 16S9.6 27.5 16 27.5c1.9 0 2.9-1.1 2.9-2.4 0-.8-.4-1.4-.9-2-.5-.6-.9-1.2-.9-2 0-1.3 1.1-2.4 2.4-2.4h2.8c3.5 0 5.2-2 5.2-4.7C27.5 8.6 22.4 4.5 16 4.5z" stroke="${S}"/><path d="M10.5 11h.01" stroke="${R}" stroke-width="3.4"/><path d="M16 8.5h.01" stroke="${Y}" stroke-width="3.4"/><path d="M21.5 11h.01" stroke="${U}" stroke-width="3.4"/><path d="M9 17.5h.01" stroke="${G}" stroke-width="3.4"/>`,

    /* ---- Object-snap mode glyphs (OSNAP flyout; marker drawn in AutoSnap
       green over base geometry, mirroring the on-canvas markers) ---- */
    'os-end': `<path d="M27.5 4.5L13 19" stroke="${S}"/><rect x="5.5" y="17.5" width="9" height="9" stroke="${M}"/>`,
    'os-mid': `<path d="M4 27L28 5" stroke="${S}"/><path d="M16 10.5l-6 10h12z" stroke="${M}"/>`,
    'os-cen': `<circle cx="16" cy="16" r="11" stroke="${S}" opacity=".75"/><circle cx="16" cy="16" r="4.5" stroke="${M}"/>`,
    'os-gcen': `<path d="M5.5 26.5v-15l10.5-6 10.5 6v15z" stroke="${S}" opacity=".75"/><circle cx="16" cy="17.5" r="4.5" stroke="${M}"/><path d="M11.5 17.5h9M16 13v9" stroke="${M}"/>`,
    'os-node': `<circle cx="16" cy="16" r="6.5" stroke="${M}"/><path d="M11.4 11.4l9.2 9.2M20.6 11.4l-9.2 9.2" stroke="${M}"/><circle cx="16" cy="16" r="1.2" fill="${S}" stroke="none"/>`,
    'os-quad': `<circle cx="16" cy="18.5" r="9" stroke="${S}" opacity=".75"/><path d="M16 4l5 5.5-5 5.5-5-5.5z" stroke="${M}"/>`,
    'os-int': `<path d="M4 16h24M6 27L26 5" stroke="${S}" opacity=".65"/><path d="M11 11l10 10M21 11L11 21" stroke="${M}"/>`,
    'os-ext': `<path d="M4 16h10" stroke="${S}"/><path d="M17.5 16h2.4M22.6 16h2.4M27.7 16h.6" stroke="${M}"/><circle cx="14" cy="16" r="1.2" fill="${S}" stroke="none"/>`,
    'os-ins': `<path d="M5 27V14h7" stroke="${S}" opacity=".6"/><rect x="9.5" y="8.5" width="9" height="9" stroke="${M}"/><rect x="14.5" y="13.5" width="9" height="9" stroke="${M}"/>`,
    'os-perp': `<path d="M8 5v22M8 27h19" stroke="${S}"/><path d="M8 19.5h7.5V27" stroke="${M}"/>`,
    'os-tan': `<circle cx="16" cy="19" r="8.5" stroke="${S}" opacity=".75"/><path d="M4 10.5h24" stroke="${M}"/><circle cx="16" cy="10.5" r="1.5" fill="${M}" stroke="none"/>`,
    'os-near': `<path d="M5 24.5L27 7.5" stroke="${S}" opacity=".75"/><path d="M11.5 11.5l9 9v-9l-9 9z" stroke="${M}"/>`,
    'os-appint': `<path d="M4 20h24M8 27L23 5" stroke="${S}" opacity=".6"/><rect x="10" y="10.5" width="12" height="12" stroke="${M}"/><path d="M12.5 13l7 7M19.5 13l-7 7" stroke="${M}"/>`,
    'os-par': `<path d="M5 26L21 5" stroke="${S}" opacity=".7"/><path d="M13.5 23.5L24 9.5M18.5 26L29 12" stroke="${M}"/>`,

    /* ---- ARC flyout variants (SPEC3 Â§24) — one quarter-arc motif read three
       ways: blue squares are picked points, the red dot is a picked center,
       the yellow wedge an included angle, the blue chord a chord length. ---- */
    'arc-3p': ARCQ + ARC_S + ARC_M + ARC_E,
    'arc-sce': ARCQ + ARC_S + ARC_E + ARC_CEN,
    'arc-sca': ARCQ + ARC_S + ARC_CEN + ARC_WEDGE,
    'arc-scl': ARCQ + ARC_S + ARC_CEN + ARC_CHORD,
    'arc-sea': ARCQ + ARC_S + ARC_E + ARC_LEGS + ARC_WEDGE,
    // the green arrow rides above the start square: the tangent the arc leaves on
    'arc-sed': ARCQ + ARC_S + ARC_E + `<path d="M4 3.5h9.2M10.4 1l2.8 2.5-2.8 2.5" stroke="${G}"/>`,
    'arc-ser': ARCQ + ARC_S + ARC_E + `<path d="M8.5 23.5L19.1 12.9" stroke="${U}"/>` + ARC_CEN,
    'arc-csa': ARCQ + ARC_LEGS + ARC_CEN + ARC_WEDGE,
    'arc-csl': ARCQ + ARC_LEGS + ARC_CEN + ARC_CHORD,
    // arc-continue: the arc leaves the last segment tangentially at the green node
    'arc-continue': `<path d="M3 26h9" stroke="${S}" opacity=".5"/><path d="M12 26a15 15 0 0 1 15-15" stroke="${S}"/><circle cx="12" cy="26" r="2.2" fill="${G}" stroke="none"/>`,

    /* ---- CIRCLE flyout variants (the three icons2 lacks) ---- */
    // circle-diameter: the blue span crosses the red centre, edge to edge
    'circle-diameter': `<circle cx="16" cy="16" r="10.5" stroke="${S}"/><path d="M5.5 16h21" stroke="${U}"/><circle cx="16" cy="16" r="2" fill="${R}" stroke="none"/>`,
    // circle-ttr: tucked into a corner, tangent to both legs, with its radius
    'circle-ttr': `<path d="M4.5 4.5v23h23" stroke="${S}"/><circle cx="12.5" cy="19.5" r="8" stroke="${U}"/><path d="M12.5 19.5l5.7-5.7" stroke="${R}"/>`,
    // circle-ttt: inscribed in a triangle — tangent to three objects
    'circle-ttt': `<path d="M5 27h22L16 7z" stroke="${S}"/><circle cx="16" cy="20.5" r="6.5" stroke="${U}"/>`,

    /* ---- Hatch flyout siblings ---- */
    // gradient: the same frame as 'hatch', filled by a fading wash
    'gradient': `<defs><linearGradient id="nasj-grad-ico" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0" stop-color="${U}" stop-opacity=".95"/>` +
      `<stop offset="1" stop-color="${U}" stop-opacity=".05"/></linearGradient></defs>` +
      `<rect x="6" y="6" width="20" height="20" fill="url(#nasj-grad-ico)" stroke="${S}"/>`,
    /* ---- status bar: annotation + customization ---- */
    // sb-annovis: the annotation A behind the eye that shows or hides it
    'sb-annovis': `<path d="M5 22.5L12 7.5l7 15M7.6 17.5h8.8" stroke="currentColor"/>` +
      `<path d="M19 24c2.5-3.4 7.5-3.4 10 0-2.5 3.4-7.5 3.4-10 0z" stroke="currentColor"/>` +
      `<circle cx="24" cy="24" r="1.6" fill="currentColor" stroke="none"/>`,
    // sb-annoauto: the annotation A with the arrows that add scales to it
    'sb-annoauto': `<path d="M5 22.5L12 7.5l7 15M7.6 17.5h8.8" stroke="currentColor"/>` +
      `<path d="M21 9.5h7v7" stroke="currentColor"/><path d="M28 9.5l-7 7" stroke="currentColor"/>` +
      `<path d="M28 27.5h-7v-7" stroke="currentColor"/><path d="M21 27.5l7-7" stroke="currentColor"/>`,
    // dim-diameter: the line across the whole circle, arrowed at both ends
    'dim-diameter': `<circle cx="16" cy="16" r="11" stroke="${S}"/>` +
      `<path d="M7.2 9.2L24.8 22.8" stroke="${U}"/>` +
      `<path d="M7.2 9.2l4.6.6-.6 4.6M24.8 22.8l-4.6-.6.6-4.6" stroke="${U}"/>`,
    // sb-customize: the three bars the industry standard ends its status bar with
    'sb-customize': `<path d="M5.5 10h21M5.5 16h21M5.5 22h21" stroke="currentColor"/>`,
    // sb-grid2: the paned square the industry standard uses for Grid Mode
    'sb-grid2': `<rect x="5.5" y="5.5" width="21" height="21" stroke="currentColor"/>` +
      `<path d="M12.5 5.5v21M19.5 5.5v21M5.5 12.5h21M5.5 19.5h21" stroke="currentColor"/>`,
    // sb-snap2: the dot grid Snap Mode locks the cursor onto
    'sb-snap2': `<path d="M8 8h.01M15 8h.01M22 8h.01M8 15h.01M22 15h.01M8 22h.01M15 22h.01M22 22h.01" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>` +
      `<path d="M13.4 12.6l7.6 3.2-3.1 1.3-1.3 3.1z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>`,
    // grad-centered: the gradient's highlight sitting dead centre in its frame
    'grad-centered': `<rect x="4.5" y="7.5" width="23" height="17" stroke="${S}"/>` +
      `<circle cx="16" cy="16" r="5.5" stroke="${U}"/><circle cx="16" cy="16" r="1.8" fill="${R}" stroke="none"/>` +
      `<path d="M16 7.5v2.6M16 21.9v2.6M4.5 16h2.6M24.9 16h2.6" stroke="${U}" opacity=".6"/>`,
    // boundary: the closed outline that came back from a pick inside the area
    'boundary': `<path d="M2.5 12.2l3.7 2.7M29.5 12.2L25.8 14.9" stroke="${S}" opacity=".4"/>` +
      `<path d="M16 5.5l10.5 7.6-4 12.4h-13l-4-12.4z" stroke="${U}"/>` +
      `<circle cx="16" cy="16" r="2" fill="${R}" stroke="none"/>`
  };

  // Local copy of the SPEC Â§6 wrapper (icons.js is not edited).
  const wrap = (inner, size = 32) => {
    const sw = size <= 16 ? 2 : 1.7;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  };

  const NI = window.NasjIcons || (window.NasjIcons = {
    // Defensive fallback if loaded standalone: dashed placeholder, never throws.
    get: (name, size = 32) => wrap(`<rect x="4.5" y="4.5" width="23" height="23" rx="2" stroke="${S}" stroke-dasharray="3 3" opacity=".6"/>`, size),
    names: []
  });

  const prev = NI.get;
  NI.get = (name, size = 32) =>
    Object.prototype.hasOwnProperty.call(P, name) ? wrap(P[name], size) : prev(name, size);

  const names = Array.from(NI.names || []);
  for (const n of Object.keys(P)) if (!names.includes(n)) names.push(n);
  NI.names = Object.freeze(names);
})();
