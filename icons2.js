/* pixelbay CAD — icons2.js (owner: ICONS-A, SPEC3 Â§25)
 * Insert / Annotate / Parametric (+cmd) icon pack. Loads AFTER icons.js and
 * chains NasjIcons.get with a prev-fallback; appends its names (no dupes).
 * Style per SPEC Â§6: original line art, viewBox 0 0 32 32, fill=none,
 * round caps/joins, stroke-width 1.7 (2 at 16px).
 * Palette: base #dfe3e7, red #e05252, blue #3fa9e0, yellow #e8c25a, green #5fbf5f.
 */
(() => {
  'use strict';

  const S = '#dfe3e7'; // base stroke
  const R = '#e05252'; // red accent
  const U = '#3fa9e0'; // blue accent
  const Y = '#e8c25a'; // yellow accent
  const G = '#5fbf5f'; // green accent

  // Shared motifs: attribute tag (attr-* family) and annotation-scale triangle
  // (scale family) so each family reads as one group with a different accent.
  const TAG = `<path d="M4.5 4.5h8.5l8.5 8.5-8 8-9-8z" stroke="${S}"/><circle cx="9" cy="9" r="1.6" stroke="${S}"/>`;
  const TRI = `<path d="M4.5 25.5V6.5l20.5 19z" stroke="${S}"/><path d="M9.5 25.5V12M14.5 25.5v-9M19.5 25.5v-4.5" stroke="${S}" opacity=".6"/>`;

  const P2 = {
    /* ---- Insert: references / underlays ---- */
    // attach: small drawing file + paperclip
    'attach': `<path d="M4.5 3.5h8l4 4v10h-12z" stroke="${S}"/><path d="M12.5 3.5v4h4" stroke="${S}"/><path d="M27.3 19.6l-5 5.1a3.3 3.3 0 0 1-4.7-4.7l5-5a2.2 2.2 0 0 1 3.1 3.1l-5 5a1.1 1.1 0 0 1-1.6-1.6l4.7-4.6" stroke="${U}"/>`,
    // clip: faded full extents, solid notched clip boundary
    'clip': `<rect x="5" y="6" width="22" height="20" stroke="${S}" opacity=".45"/><path d="M8.5 9.5h15v9h-7v7h-8z" stroke="${U}"/>`,
    // adjust: contrast circle (half filled)
    'adjust': `<circle cx="16" cy="16" r="10.5" stroke="${S}"/><path d="M16 5.5a10.5 10.5 0 0 1 0 21z" stroke="${U}" fill="${U}" fill-opacity=".25"/>`,
    // underlay-layers: referenced sheet with a layer plate stack
    'underlay-layers': `<path d="M6.5 4.5h11l5 5v18h-16z" stroke="${S}"/><path d="M17.5 4.5v5h5" stroke="${S}"/><path d="M14.5 13.5l6 3.25-6 3.25-6-3.25z" stroke="${U}"/><path d="M8.5 20.5l6 3.25 6-3.25" stroke="${U}" opacity=".55"/>`,
    // underlay-frames: dashed outer frame around an image
    'underlay-frames': `<rect x="4.5" y="4.5" width="23" height="23" stroke="${Y}" stroke-dasharray="3 3"/><rect x="9" y="9" width="14" height="14" stroke="${S}"/><path d="M9 19.5l4-4 3.5 3.5 2.5-2.5 4 4" stroke="${S}"/>`,
    // snap-underlay: faint sheet + green snap target square
    'snap-underlay': `<rect x="4.5" y="4.5" width="16" height="16" stroke="${S}" opacity=".45"/><rect x="14.5" y="14.5" width="13" height="13" stroke="${G}"/><path d="M21 17.5v7M17.5 21h7" stroke="${G}"/>`,
    // refresh: a circular arrow — read the references off disk again
    'refresh': `<path d="M21.25 6.9A10.5 10.5 0 1 1 26.5 16" stroke="${S}"/><path d="M17.4 8.7l4-1.8 1.8 4" stroke="${U}"/>`,
    // edit-reference: referenced sheet with a pencil working on it in place
    'edit-reference': `<path d="M5.5 3.5h10l4.5 4.5v8" stroke="${S}"/><path d="M15.5 3.5V8h4.5" stroke="${S}"/><path d="M5.5 3.5v25h9" stroke="${S}"/><path d="M9 11.5h7M9 16h5" stroke="${S}" opacity=".6"/><path d="M27.5 13.5l3 3-10 10-4 1 1-4z" stroke="${U}"/><path d="M25.5 15.5l3 3" stroke="${U}"/>`,
    // image-attach: a picture in its frame — sun and mountains, the classic
    'image-attach': `<rect x="4.5" y="6.5" width="23" height="19" rx="1.5" stroke="${S}"/><circle cx="12" cy="12.5" r="2.2" stroke="${Y}"/><path d="M6.5 23l6-6.5 4 4 5-5.5 6 6.5" stroke="${U}"/>`,
    // pdf-import: arrow entering a document
    'pdf-import': `<path d="M11.5 4.5h10.5l5.5 5.5V27.5h-16z" stroke="${S}"/><path d="M22 4.5V10h5.5" stroke="${S}"/><path d="M3 16h11M10.5 12.5L14 16l-3.5 3.5" stroke="${R}"/>`,
    // dgn-import: the same document + arrow, marked DGN
    'dgn-import': `<path d="M11.5 4.5h10.5l5.5 5.5V27.5h-16z" stroke="${S}"/><path d="M22 4.5V10h5.5" stroke="${S}"/><path d="M3 16h11M10.5 12.5L14 16l-3.5 3.5" stroke="${U}"/><text x="14" y="24.5" fill="${S}" stroke="none" font-size="7" font-family="Segoe UI">DGN</text>`,
    // file-import: the same document + arrow, no format mark
    'file-import': `<path d="M11.5 4.5h10.5l5.5 5.5V27.5h-16z" stroke="${S}"/><path d="M22 4.5V10h5.5" stroke="${S}"/><path d="M3 16h11M10.5 12.5L14 16l-3.5 3.5" stroke="${U}"/>`,

    /* ---- Insert: text recognition / fields / data ---- */
    // shx-text: letterform with vector nodes (text as geometry)
    'shx-text': `<path d="M8.5 25.5L16 6.5l7.5 19M11.2 18.5h9.6" stroke="${S}"/><rect x="13.8" y="4.3" width="4.4" height="4.4" stroke="${U}"/><rect x="6.3" y="23.3" width="4.4" height="4.4" stroke="${U}"/><rect x="21.3" y="23.3" width="4.4" height="4.4" stroke="${U}"/>`,
    // recognition-settings: letter + gear
    'recognition-settings': `<path d="M4.5 19.5L10 5.5l5.5 14M6.6 15.5h6.8" stroke="${S}"/><circle cx="21.5" cy="21.5" r="4.6" stroke="${Y}"/><path d="M21.5 13.5v2.6M21.5 26.9v2.6M13.5 21.5h2.6M26.9 21.5h2.6M15.8 15.8l1.9 1.9M25.3 25.3l1.9 1.9M27.2 15.8l-1.9 1.9M17.7 25.3l-1.9 1.9" stroke="${Y}" stroke-width="2.4"/>`,
    // combine-text: two small texts merging into one
    'combine-text': `<path d="M3.5 12.5L7 4l3.5 8.5M4.9 9.5h4.2" stroke="${S}"/><path d="M3.5 28L7 19.5l3.5 8.5M4.9 25h4.2" stroke="${S}"/><path d="M12.5 16h6M15.8 13.3l2.7 2.7-2.7 2.7" stroke="${G}"/><path d="M20.5 25.5L25 13.5l4.5 12M22.2 21.5h5.6" stroke="${U}"/>`,
    // field: shaded field box with text
    'field': `<rect x="4.5" y="10.5" width="23" height="11" rx="1.5" stroke="${S}" fill="${S}" fill-opacity=".15"/><path d="M8.5 16h9" stroke="${U}"/><path d="M21.5 16h3" stroke="${U}" opacity=".55"/>`,
    // update-fields: field box + refresh arrow
    'update-fields': `<rect x="4.5" y="13" width="15" height="9.5" rx="1.5" stroke="${S}" fill="${S}" fill-opacity=".15"/><path d="M7.5 17.8h9" stroke="${U}"/><path d="M28.5 8a5 5 0 1 1-1.5-3.5" stroke="${G}"/><path d="M27 4.5l3-.6M27 4.5l.6-3" stroke="${G}"/>`,
    // ole-object: embedded clock object in a frame
    'ole-object': `<rect x="4.5" y="6" width="23" height="20" rx="1.5" stroke="${S}"/><circle cx="12.5" cy="16" r="4.8" stroke="${U}"/><path d="M12.5 11.2V16l3.4 2.6" stroke="${U}"/><path d="M21 12.5h3.5M21 16h3.5M21 19.5h3.5" stroke="${S}" opacity=".7"/>`,
    // hyperlink: chain link
    'hyperlink': `<path d="M13 19l6-6" stroke="${S}"/><path d="M15.5 10l2.5-2.5a4.8 4.8 0 0 1 6.8 6.8l-2.5 2.5" stroke="${U}"/><path d="M16.5 22l-2.5 2.5a4.8 4.8 0 0 1-6.8-6.8l2.5-2.5" stroke="${U}"/>`,
    // data-link: table + chain links
    'data-link': `<rect x="4.5" y="4.5" width="16" height="12.5" stroke="${S}"/><path d="M4.5 9h16M11 4.5v12.5" stroke="${S}"/><ellipse cx="20.7" cy="24.3" rx="4.6" ry="2.9" transform="rotate(-45 20.7 24.3)" stroke="${G}"/><ellipse cx="26" cy="19" rx="4.6" ry="2.9" transform="rotate(-45 26 19)" stroke="${G}"/>`,
    // download-source / upload-source: file + direction arrow
    'download-source': `<path d="M4.5 4.5h9.5l5 5v16H4.5z" stroke="${S}"/><path d="M14 4.5v5h5" stroke="${S}"/><path d="M24.5 14.5V26M20.5 22.2l4 3.8 4-3.8" stroke="${G}"/>`,
    'upload-source': `<path d="M4.5 4.5h9.5l5 5v16H4.5z" stroke="${S}"/><path d="M14 4.5v5h5" stroke="${S}"/><path d="M24.5 26V14.5M20.5 18.3l4-3.8 4 3.8" stroke="${U}"/>`,
    // extract-data: table with arrow pulling data out
    'extract-data': `<rect x="4.5" y="6.5" width="16.5" height="19" stroke="${S}"/><path d="M4.5 12.5h16.5M11 12.5v13" stroke="${S}"/><path d="M16.5 19.5H29M25.5 16L29 19.5 25.5 23" stroke="${Y}"/>`,
    // set-location: map pin
    'set-location': `<path d="M16 28.5c-5.7-5.8-8.5-10-8.5-14.2a8.5 8.5 0 0 1 17 0c0 4.2-2.8 8.4-8.5 14.2z" stroke="${R}"/><circle cx="16" cy="14" r="3.2" stroke="${S}"/>`,

    /* ---- Insert: blocks & attributes (shared tag motif) ---- */
    // edit-attribute: tag + pencil
    'edit-attribute': `${TAG}<path d="M15.5 29.5l1-4.2 7.8-7.8 3.2 3.2-7.8 7.8z" stroke="${Y}"/>`,
    // retain-attr: tag + pushpin
    'retain-attr': `${TAG}<path d="M21.5 16.5l6.5 6.5-4 .9-.9 4-6.5-6.5z" stroke="${G}"/><path d="M16.9 21.7l-4.4 4.4" stroke="${G}"/>`,
    // define-attrs: tag + plus
    'define-attrs': `${TAG}<path d="M24 17.5v9M19.5 22h9" stroke="${G}"/>`,
    // manage-attrs: tag + sliders
    'manage-attrs': `${TAG}<path d="M17.5 21.5h11M17.5 26.5h11" stroke="${U}"/><circle cx="21.5" cy="21.5" r="1.9" fill="${U}" stroke="none"/><circle cx="25" cy="26.5" r="1.9" fill="${U}" stroke="none"/>`,
    // replace-block: two blocks with swap arrows
    'replace-block': `<rect x="4.5" y="4.5" width="10.5" height="10.5" stroke="${S}"/><rect x="17" y="17" width="10.5" height="10.5" stroke="${U}"/><path d="M19.5 9.5h8M24.8 6.8l2.7 2.7-2.7 2.7" stroke="${Y}"/><path d="M12.5 22.5h-8M7.2 19.8l-2.7 2.7 2.7 2.7" stroke="${Y}"/>`,
    // block-editor: block focused by editor corner brackets
    'block-editor': `<rect x="10" y="10" width="12" height="12" stroke="${S}"/><rect x="8.2" y="8.2" width="3.6" height="3.6" stroke="${U}"/><path d="M4.5 9.5v-5h5M22.5 4.5h5v5M27.5 22.5v5h-5M9.5 27.5h-5v-5" stroke="${Y}"/>`,

    /* ---- Annotate: text ---- */
    // mtext: letter + paragraph column
    'mtext': `<path d="M4.5 24.5L11 7.5l6.5 17M6.9 18.5h8.2" stroke="${S}"/><path d="M21.5 9h6M21.5 13.5h6M21.5 18h6M21.5 22.5h6" stroke="${U}"/>`,
    // find-text: magnifier over a letter
    'find-text': `<circle cx="13.5" cy="13.5" r="9.5" stroke="${S}"/><path d="M20.8 20.8L28.5 28.5" stroke="${S}"/><path d="M9.5 18.5l4-10 4 10M10.9 15h5.2" stroke="${U}"/>`,
    // text-scale: a letter with a resize arrow — a new height, the same place
    'text-scale': `<path d="M3.5 22.5L10 5.5l6.5 17M5.9 16.5h8.2" stroke="${S}"/><path d="M20.5 28.5L29.5 19.5" stroke="${U}"/><path d="M29.5 19.5h-5M29.5 19.5v5" stroke="${U}"/><path d="M20.5 28.5h5M20.5 28.5v-5" stroke="${U}"/>`,

    /* ---- Annotate: dimensions ---- */
    // dim-quick: dimension + lightning bolt
    'dim-quick': `<path d="M4.5 6.5v11M27.5 6.5v11" stroke="${S}"/><path d="M4.5 12h23M8 9.8L4.5 12 8 14.2M24 9.8l3.5 2.2-3.5 2.2" stroke="${U}"/><path d="M18.5 18.5L14 24.5h3.8l-2.3 6 6.5-7h-3.8l3.3-5z" stroke="${Y}"/>`,
    // dim-continue: chained spans off a shared extension line
    'dim-continue': `<path d="M4.5 7v13M16 7v13M27.5 7v13" stroke="${S}"/><path d="M4.5 13.5H16" stroke="${U}" opacity=".45"/><path d="M16 13.5h11.5M19.2 11.3L16 13.5l3.2 2.2M24.3 11.3l3.2 2.2-3.2 2.2" stroke="${U}"/>`,
    // centermark: circle with center-mark cross extending beyond
    'centermark': `<circle cx="16" cy="16" r="8" stroke="${S}"/><path d="M16 12.5v7M12.5 16h7" stroke="${R}"/><path d="M16 3.5v5M16 23.5v5M3.5 16h5M23.5 16h5" stroke="${R}"/>`,
    // centerline: dash-dot line between two edges
    'centerline': `<path d="M7.5 4.5v23M24.5 4.5v23" stroke="${S}"/><path d="M16 3.5v25" stroke="${R}" stroke-dasharray="5.2 2.6 1.2 2.6"/>`,
    // multileader: one note, two leaders
    'multileader': `<path d="M19.5 6.5h9M19.5 11h9" stroke="${U}"/><path d="M16.5 8.5L5.5 19.5M8.6 18.2L5.5 19.5l1.3-3.1" stroke="${S}"/><path d="M17 12l5.5 13M20.3 22.9l2.2 2.1.9-2.9" stroke="${S}"/>`,
    // wipeout: masking polygon interrupting lines behind it
    'wipeout': `<path d="M2.5 12h4.5M2.5 20h4.5" stroke="${S}"/><path d="M25.5 12h4M25.5 20h4" stroke="${S}"/><path d="M10 6.5l12.5-2 4.5 11-6 12L6 23.5z" stroke="${Y}" fill="${Y}" fill-opacity=".12"/>`,

    /* ---- Annotate: annotation scales (shared triangle motif) ---- */
    'add-scale': `${TRI}<path d="M24.5 4.5v9M20 9h9" stroke="${G}"/>`,
    'del-scale': `${TRI}<path d="M21.5 4.5l7 7M28.5 4.5l-7 7" stroke="${R}"/>`,
    'scale-list': `${TRI}<path d="M21 5h7.5M21 9.5h7.5M21 14h7.5" stroke="${U}"/>`,
    'sync-scale': `${TRI}<path d="M28.5 8a4.5 4.5 0 1 1-1.3-3.2" stroke="${G}"/><path d="M27.2 4.8l2.9-.6M27.2 4.8l.6-2.9" stroke="${G}"/>`,

    /* ---- Parametric: constraint family ----
     * Geometry in base stroke, relation marker in green — one mini-family. */
    'con-coincident': `<path d="M4.5 25L16 16" stroke="${S}"/><path d="M16 16c6-4.5 10-4 11.5 3.5" stroke="${S}"/><circle cx="16" cy="16" r="2.5" fill="${G}" stroke="none"/>`,
    'con-parallel': `<path d="M7 26L17 6M15 26L25 6" stroke="${S}"/><path d="M10.4 15.2l3.2 1.6M18.4 15.2l3.2 1.6" stroke="${G}"/>`,
    'con-perpendicular': `<path d="M6.5 25.5h19M6.5 25.5v-19" stroke="${S}"/><path d="M6.5 19h6.5v6.5" stroke="${G}"/>`,
    'con-tangent': `<path d="M4.5 12h23" stroke="${S}"/><circle cx="16" cy="19.5" r="7.5" stroke="${S}"/><circle cx="16" cy="12" r="2.4" fill="${G}" stroke="none"/>`,
    'con-horizontal': `<path d="M6.5 16h19" stroke="${S}"/><rect x="4.2" y="13.8" width="4.4" height="4.4" stroke="${G}"/><rect x="23.4" y="13.8" width="4.4" height="4.4" stroke="${G}"/>`,
    'con-vertical': `<path d="M16 6.5v19" stroke="${S}"/><rect x="13.8" y="4.2" width="4.4" height="4.4" stroke="${G}"/><rect x="13.8" y="23.4" width="4.4" height="4.4" stroke="${G}"/>`,
    'con-collinear': `<path d="M4 24l9-6.3M19 13.5l9-6.3" stroke="${S}"/><path d="M4 24L28 7.2" stroke="${G}" stroke-dasharray="2.4 2.4" opacity=".55"/>`,
    'con-concentric': `<circle cx="16" cy="16" r="10.5" stroke="${S}"/><circle cx="16" cy="16" r="5.5" stroke="${S}"/><circle cx="16" cy="16" r="1.9" fill="${G}" stroke="none"/>`,
    'con-symmetric': `<path d="M16 4v24" stroke="${G}" stroke-dasharray="3 3"/><path d="M11.5 8.5L5 16l6.5 7.5M20.5 8.5L27 16l-6.5 7.5" stroke="${S}"/>`,
    'con-equal': `<path d="M6 11.5h20M6 20.5h20" stroke="${S}"/><path d="M14.8 9l2.4 5M14.8 18l2.4 5" stroke="${G}"/>`,
    'con-fix': `<circle cx="16" cy="7.5" r="2.2" fill="${G}" stroke="none"/><path d="M16 10v6.5" stroke="${S}"/><path d="M7 16.5h18" stroke="${S}"/><path d="M9.5 22l4-5.5M15 22l4-5.5M20.5 22l4-5.5" stroke="${S}" opacity=".8"/>`,
    'con-smooth': `<path d="M4.5 25C11 25 12 8 18 8" stroke="${S}"/><path d="M18 8c4.5 0 6.5 4.5 9.5 4.5" stroke="${S}"/><circle cx="18" cy="8" r="2.4" fill="${G}" stroke="none"/>`,

    /* ---- Parametric: management ---- */
    // auto-constrain: corner constraint + sparkles
    'auto-constrain': `<path d="M7.5 6.5v19h19" stroke="${S}"/><path d="M13.5 25.5v-6h-6" stroke="${G}"/><path d="M22.5 4.5v6M19.5 7.5h6M28 13.5v4M26 15.5h4" stroke="${Y}"/>`,
    // show-hide / show-all / hide-all: eye variants
    'show-hide': `<path d="M3.5 16c3.4-5.7 7.6-8.5 12.5-8.5s9.1 2.8 12.5 8.5c-3.4 5.7-7.6 8.5-12.5 8.5S6.9 21.7 3.5 16z" stroke="${S}"/><circle cx="16" cy="16" r="3.6" stroke="${U}"/>`,
    'show-all': `<path d="M3.5 13.5c2.9-4.8 6.4-7.2 10.5-7.2s7.6 2.4 10.5 7.2c-2.9 4.8-6.4 7.2-10.5 7.2S6.4 18.3 3.5 13.5z" stroke="${S}"/><circle cx="14" cy="13.5" r="3" stroke="${U}"/><path d="M18.5 25.5l3.5 3.5 6.5-7" stroke="${G}"/>`,
    'hide-all': `<path d="M3.5 16c3.4-5.7 7.6-8.5 12.5-8.5s9.1 2.8 12.5 8.5c-3.4 5.7-7.6 8.5-12.5 8.5S6.9 21.7 3.5 16z" stroke="${S}" opacity=".55"/><circle cx="16" cy="16" r="3.6" stroke="${S}" opacity=".55"/><path d="M6.5 27L25.5 5" stroke="${R}"/>`,
    // dim-lock: dimensional constraint (dim + padlock)
    'dim-lock': `<path d="M4.5 6v11M18 6v11" stroke="${S}"/><path d="M4.5 11.5H18M7.8 9.3L4.5 11.5l3.3 2.2M14.7 9.3l3.3 2.2-3.3 2.2" stroke="${U}"/><rect x="19.5" y="20" width="9.5" height="7.5" rx="1" stroke="${Y}"/><path d="M21.7 20v-2.5a2.55 2.55 0 0 1 5.1 0V20" stroke="${Y}"/>`,
    // constraint-dynamic: a dimension held by a lock — the form that shows
    // only while the drawing is being worked on, and never plots
    'constraint-dynamic': `<path d="M3.5 8v10M15.5 8v10" stroke="${S}"/><path d="M3.5 13h12M6.8 10.8L3.5 13l3.3 2.2M12.2 10.8l3.3 2.2-3.3 2.2" stroke="${U}"/><rect x="19.5" y="17" width="9" height="7" rx="1" stroke="${Y}"/><path d="M21.6 17v-2.4a2.4 2.4 0 0 1 4.8 0V17" stroke="${Y}"/>`,
    // constraint-anno: the same dimension carrying the annotation-scale
    // triangle — the form that behaves like a dimension and does plot
    'constraint-anno': `<path d="M3.5 8v10M15.5 8v10" stroke="${S}"/><path d="M3.5 13h12M6.8 10.8L3.5 13l3.3 2.2M12.2 10.8l3.3 2.2-3.3 2.2" stroke="${U}"/><path d="M19.5 26.5V15l11 11.5z" stroke="${Y}"/>`,
    // parameters-fx: f(x) parameters manager
    'parameters-fx': `<path d="M13 7c-2.6 0-3.4 1.6-3.4 4V25M6 14.5h7" stroke="${S}"/><path d="M17.5 15.5L26 25.5M26 15.5l-8.5 10" stroke="${U}"/>`,
    // delete-constraints: constraint corner + red X
    'delete-constraints': `<path d="M5.5 25.5h13M5.5 25.5V7.5" stroke="${S}"/><path d="M5.5 19.5h6v6" stroke="${G}"/><path d="M20.5 8.5l8 8M28.5 8.5l-8 8" stroke="${R}"/>`,

    /* ---- Command-line extras ---- */
    // hand: pointing/select hand (distinct from the 'pan' mitten)
    'hand': `<path d="M12.5 16.2V6.3a2 2 0 0 1 4 0v7.2l7.1 2c1.7.5 2.7 2.1 2.3 3.8l-1.2 4.9c-.6 2.3-2.4 3.8-4.9 3.8h-4.1c-1.7 0-3.2-.7-4.2-2.1l-4.3-5.5c-1.1-1.4.5-3.2 2.1-2.5l3.2 1.5z" stroke="${S}"/>`,
    // circle-2p: circle by two diameter points
    'circle-2p': `<circle cx="16" cy="16" r="10.5" stroke="${S}"/><path d="M5.5 16h21" stroke="${U}" opacity=".6"/><rect x="3.3" y="13.8" width="4.4" height="4.4" stroke="${U}"/><rect x="24.3" y="13.8" width="4.4" height="4.4" stroke="${U}"/>`,
    // circle-3p: circle through three points
    'circle-3p': `<circle cx="16" cy="16" r="10.5" stroke="${S}"/><rect x="13.8" y="3.3" width="4.4" height="4.4" stroke="${U}"/><rect x="4.7" y="19.1" width="4.4" height="4.4" stroke="${U}"/><rect x="22.9" y="19.1" width="4.4" height="4.4" stroke="${U}"/>`,
    // arc-center: arc with center point and radius legs
    'arc-center': `<path d="M8.5 8.5a15 15 0 0 1 15 15" stroke="${S}"/><path d="M8.5 23.5v-15M8.5 23.5h15" stroke="${U}" opacity=".5"/><circle cx="8.5" cy="23.5" r="2" fill="${R}" stroke="none"/>`,
    // chamfer: corner cut by a straight bevel (vs fillet's arc)
    'chamfer': `<path d="M27 5.5H14M5.5 27V14" stroke="${S}"/><path d="M14 5.5L5.5 14" stroke="${U}"/>`,
    // array-path: items distributed along a curve
    'array-path': `<path d="M4.5 26.5C11 26.5 10.5 15.5 17 13c5-1.9 8.5-4 10.5-8" stroke="${S}" opacity=".65"/><rect x="4.3" y="24.3" width="4.4" height="4.4" stroke="${U}"/><rect x="12.1" y="13.6" width="4.4" height="4.4" stroke="${U}"/><rect x="21.8" y="6.3" width="4.4" height="4.4" stroke="${U}"/>`,
  };

  // Local copy of the icons.js svg wrapper (SPEC Â§6 — do not touch icons.js).
  const wrap = (inner, size) => {
    const sw = size <= 16 ? 2 : 1.7;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  };

  const base = window.NasjIcons;
  if (!base || typeof base.get !== 'function') {
    console.warn('NasjIcons2: icons.js not loaded first — creating standalone registry.');
    window.NasjIcons = {
      get: (name, size = 32) =>
        wrap(
          Object.prototype.hasOwnProperty.call(P2, name)
            ? P2[name]
            : `<rect x="4.5" y="4.5" width="23" height="23" rx="2" stroke="${S}" stroke-dasharray="3 3" opacity=".6"/>`,
          size
        ),
      names: Object.freeze(Object.keys(P2)),
    };
    return;
  }

  const prev = base.get;
  base.get = (name, size = 32) =>
    Object.prototype.hasOwnProperty.call(P2, name) ? wrap(P2[name], size) : prev(name, size);

  // Append names without duplicates (base.names is a frozen array — replace it).
  const existing = new Set(base.names || []);
  const added = Object.keys(P2).filter((n) => !existing.has(n));
  base.names = Object.freeze((base.names || []).concat(added));
})();
