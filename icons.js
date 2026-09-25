/* pixelbay CAD — icons.js (owner: ICONS)
 * Original line-art CAD-style SVG icons. SPEC Â§6.
 * viewBox 0 0 32 32, fill=none, round caps/joins, stroke-width 1.7 (2 at 16px).
 * Palette: base #dfe3e7, red #e05252, blue #3fa9e0, yellow #e8c25a, green #5fbf5f.
 * sb-* and UI-chrome icons (search/account/chevron-down/check) use stroke="currentColor" only.
 */
(() => {
  'use strict';

  const S = '#dfe3e7'; // base stroke
  const R = '#e05252'; // red accent
  const U = '#3fa9e0'; // blue accent
  const Y = '#e8c25a'; // yellow accent
  const G = '#5fbf5f'; // green accent

  const P = {
    /* ---- Quick access / file ---- */
    'qnew': `<path d="M7 3.5h11l7 7V28.5H7z" stroke="${S}"/><path d="M18 3.5v7h7" stroke="${S}"/><path d="M12.5 19.5h7M16 16v7" stroke="${U}"/>`,
    'qopen': `<path d="M4.5 26V7.5h8l3 3h10v3.5" stroke="${S}"/><path d="M4.5 26l4.5-10.5h20L24 26z" stroke="${Y}"/>`,
    'qsave': `<path d="M5.5 5.5h17l4 4v17h-21z" stroke="${S}"/><path d="M10.5 5.5V12h11V5.5" stroke="${S}"/><rect x="10" y="17.5" width="12" height="9" stroke="${U}"/>`,
    'saveas': `<path d="M5.5 5.5h14l4 4v14h-18z" stroke="${S}"/><path d="M9.5 5.5v5.5h9V5.5" stroke="${S}"/><path d="M17.5 28l1-4.2 8.3-8.3 3.2 3.2-8.3 8.3z" stroke="${Y}"/>`,
    'plot': `<path d="M9.5 12V5.5h13V12" stroke="${S}"/><rect x="4.5" y="12" width="23" height="9.5" rx="1.5" stroke="${S}"/><rect x="9.5" y="18" width="13" height="8.5" stroke="${U}"/>`,
    'undo': `<path d="M8.5 12.5H20.5a6.2 6.2 0 0 1 0 12.4H14" stroke="${S}"/><path d="M13.5 7.5l-5 5 5 5" stroke="${S}"/>`,
    'redo': `<path d="M23.5 12.5H11.5a6.2 6.2 0 0 0 0 12.4H18" stroke="${S}"/><path d="M18.5 7.5l5 5-5 5" stroke="${S}"/>`,

    /* ---- Draw ---- */
    'line': `<path d="M8 24L24 8" stroke="${S}"/><rect x="4.5" y="20.5" width="7" height="7" stroke="${U}"/><rect x="20.5" y="4.5" width="7" height="7" stroke="${U}"/>`,
    'polyline': `<path d="M5 26L12.5 9l7.5 9.5L27 6" stroke="${S}"/><rect x="10.3" y="6.8" width="4.4" height="4.4" stroke="${U}"/><rect x="17.8" y="16.3" width="4.4" height="4.4" stroke="${U}"/>`,
    'mline': `<path d="M4 21.5L13 10l8 8 7-8.5" stroke="${S}"/><path d="M4 27.5L13 16l8 8 7-8.5" stroke="${S}"/><rect x="1.8" y="19.3" width="4.4" height="4.4" stroke="${U}"/>`,
    'ray': `<rect x="4.3" y="21.3" width="4.4" height="4.4" stroke="${U}"/><path d="M8.5 21.5L25 5" stroke="${S}"/><path d="M25.5 4.5l-6.5 1.5M25.5 4.5L24 11" stroke="${S}"/>`,
    'xline': `<path d="M3 25L29 7" stroke="${S}"/><path d="M3.5 24.5l6-.8M3.5 24.5l1 -5.8M28.5 7.5l-6 .8M28.5 7.5l-1 5.8" stroke="${S}"/><rect x="13.8" y="13.8" width="4.4" height="4.4" stroke="${U}"/>`,
    'region': `<path d="M6 8.5C11 4 21 4 26 8.5c3 8-3 10 0 15-5 4.5-15 4.5-20 0 3-5-3-7 0-15z" stroke="${S}"/><path d="M10 12l12 10M14 9.5l10 8.5M10 17l9 7.5" stroke="${U}" opacity=".6"/>`,
    'helix': `<path d="M16 16m9 0a9 9 0 1 1-9-9 7 7 0 1 1-7 7 5 5 0 1 0 5-5 3 3 0 0 0-3 3" stroke="${S}" fill="none"/>`,
    'donut': `<circle cx="16" cy="16" r="10.5" stroke="${S}"/><circle cx="16" cy="16" r="4.5" stroke="${S}"/><path d="M16 5.5a10.5 10.5 0 0 1 0 21 10.5 10.5 0 0 1 0-21zm0 6a4.5 4.5 0 0 0 0 9 4.5 4.5 0 0 0 0-9z" fill="${S}" opacity=".25" stroke="none"/>`,
    'spline-cv': `<path d="M4 26C9 12 13 12 16 17s7 5 12-6" stroke="${S}"/><path d="M4 26L10 8l12 12 6-14" stroke="${U}" stroke-dasharray="3 2" opacity=".7"/><rect x="8" y="6" width="4" height="4" stroke="${U}"/><rect x="20" y="18" width="4" height="4" stroke="${U}"/>`,
    'poly3d': `<path d="M5 25l7-14 8 8 7-13" stroke="${S}"/><path d="M5 25l3.5 2.5M12 11l3.5 2M20 19l3.5 2" stroke="${U}" opacity=".7"/><rect x="10" y="9" width="4" height="4" stroke="${U}"/><rect x="18" y="17" width="4" height="4" stroke="${U}"/>`,
    'revcloud-poly': `<path d="M6 24a3 3 0 1 1 2-5l-3-7a3 3 0 1 1 5-2l6-4a3 3 0 1 1 6 1l4 7a3 3 0 1 1-2 5l-4 5a3 3 0 1 1-6 0z" stroke="${S}"/>`,
    'revcloud-free': `<path d="M5 22a3 2.5 0 1 1 3-4 3 3 0 1 1 4-3 3 3 0 1 1 5-1 3 3 0 1 1 5 2 3 2.5 0 1 1 3 4 3 2.5 0 1 1-2 4 3 2.5 0 1 1-5 2 3 3 0 1 1-6-1 3 2.5 0 1 1-7-3z" stroke="${S}"/>`,
    'circle': `<circle cx="16" cy="16" r="10.5" stroke="${S}"/><path d="M12.6 16h6.8M16 12.6v6.8" stroke="${R}"/>`,
    'arc': `<path d="M6 23.5A11.5 11.5 0 0 1 26 23.5" stroke="${S}"/><rect x="3.8" y="21.3" width="4.4" height="4.4" stroke="${U}"/><rect x="23.8" y="21.3" width="4.4" height="4.4" stroke="${U}"/>`,
    'rectangle': `<rect x="6" y="9" width="20" height="14" stroke="${S}"/><rect x="3.8" y="6.8" width="4.4" height="4.4" stroke="${U}"/><rect x="23.8" y="20.8" width="4.4" height="4.4" stroke="${U}"/>`,
    'polygon': `<path d="M16 6L5.5 13.6 9.5 25.9h13L26.5 13.6z" stroke="${S}"/><rect x="13.8" y="14.8" width="4.4" height="4.4" stroke="${U}"/>`,
    'base-point': `<path d="M10 27.5V5.5" stroke="${S}"/><path d="M10 6.5h13.5l-4 4.5 4 4.5H10z" stroke="${Y}"/><path d="M6.5 27.5h7" stroke="${S}"/>`,

    /* ---- Measure flyout ---- */
    'measure-quick': `<rect x="4.5" y="12" width="23" height="8" stroke="${Y}"/><path d="M8 12v4M12 12v6M16 12v4M20 12v6M24 12v4" stroke="${Y}"/><path d="M6 7l4-3M26 7l-4-3" stroke="${U}"/>`,
    'measure-radius': `<circle cx="16" cy="17" r="10.5" stroke="${S}"/><path d="M16 17L25 11.5" stroke="${Y}"/><circle cx="16" cy="17" r="1.4" fill="${Y}" stroke="none"/>`,
    'measure-angle': `<path d="M6 26L26 26M6 26L20 8" stroke="${S}"/><path d="M13 26a8.5 8.5 0 0 0-2.8-6.3" stroke="${Y}"/>`,
    'measure-area': `<path d="M5.5 8l8-3.5 13 4.5-8 3.5z" stroke="${S}"/><path d="M5.5 8v14l8 4.5v-14M26.5 9v13l-13 4.5" stroke="${S}"/><path d="M9 10.5l9-3.8" stroke="${Y}"/>`,
    'measure-volume': `<path d="M16 4.5l10.5 5v13L16 27.5l-10.5-5v-13z" stroke="${S}"/><path d="M5.5 9.5L16 14.5l10.5-5M16 14.5v13" stroke="${S}"/><path d="M16 4.5v10" stroke="${Y}"/>`,

    /* ---- Paste flyout ---- */
    'paste-block': `<path d="M6.5 6.5h13v7" stroke="${S}"/><path d="M10.5 4.5h5v3.5h-5z" stroke="${S}"/><rect x="12.5" y="15.5" width="14" height="11" stroke="${Y}"/><path d="M12.5 21h14M19.5 15.5v11" stroke="${Y}"/>`,
    'paste-hyperlink': `<path d="M6.5 6.5h13v6" stroke="${S}"/><path d="M10.5 4.5h5v3.5h-5z" stroke="${S}"/><circle cx="19.5" cy="21" r="7" stroke="${U}"/><path d="M12.5 21h14M19.5 14a11 11 0 0 1 0 14M19.5 14a11 11 0 0 0 0 14" stroke="${U}"/>`,
    'paste-orig': `<path d="M6.5 6.5h13v6" stroke="${S}"/><path d="M10.5 4.5h5v3.5h-5z" stroke="${S}"/><path d="M13 20.5h13M19.5 14v13" stroke="${Y}"/><text x="5" y="27" fill="${U}" stroke="none" font-size="9" font-family="Segoe UI">XY</text>`,
    'paste-special': `<path d="M6.5 6.5h13v7" stroke="${S}"/><path d="M10.5 4.5h5v3.5h-5z" stroke="${S}"/><path d="M20 15l1.8 3.8 4.2.6-3 3 .7 4.1-3.7-2-3.7 2 .7-4.1-3-3 4.2-.6z" stroke="${R}"/>`,
    'ellipse': `<ellipse cx="16" cy="16" rx="11.5" ry="7.5" stroke="${S}"/><path d="M12.6 16h6.8M16 12.6v6.8" stroke="${R}"/>`,
    'hatch': `<rect x="6" y="6" width="20" height="20" stroke="${S}"/><path d="M6 14l8-8M6 21l15-15M9 26L26 9M16 26l10-10M23 26l3-3" stroke="${U}"/>`,
    'spline': `<path d="M5 24C10 8 14 26 20 12c1.8-3.8 4.6-5.6 7.4-6" stroke="${S}"/><rect x="2.8" y="21.8" width="4.4" height="4.4" stroke="${U}"/><rect x="25.2" y="3.8" width="4.4" height="4.4" stroke="${U}"/>`,
    'point': `<path d="M16 5.5v6M16 20.5v6M5.5 16h6M20.5 16h6" stroke="${S}"/><circle cx="16" cy="16" r="1.8" fill="${S}" stroke="none"/>`,
    'revcloud': `<path d="M6 9.5a3.3 3.3 0 0 1 6.6 0 3.3 3.3 0 0 1 6.6 0 3.3 3.3 0 0 1 6.6 0 3.4 3.4 0 0 1 0 6.8 3.4 3.4 0 0 1 0 6.8 3.3 3.3 0 0 1-6.6 0 3.3 3.3 0 0 1-6.6 0 3.3 3.3 0 0 1-6.6 0 3.4 3.4 0 0 1 0-6.8 3.4 3.4 0 0 1 0-6.8z" stroke="${S}"/>`,

    /* ---- Modify ---- */
    'move': `<path d="M16 4v24M4 16h24" stroke="${S}"/><path d="M12.5 7.5L16 4l3.5 3.5M12.5 24.5L16 28l3.5-3.5M7.5 12.5L4 16l3.5 3.5M24.5 12.5L28 16l-3.5 3.5" stroke="${S}"/>`,
    'copy': `<rect x="4.5" y="4.5" width="16.5" height="16.5" stroke="${S}" opacity=".45"/><rect x="11" y="11" width="16.5" height="16.5" stroke="${S}"/>`,
    'rotate': `<path d="M6.5 17a9.5 9.5 0 0 1 19 0" stroke="${S}"/><path d="M28.7 14.2l-3.2 3.6-3.6-3.2" stroke="${S}"/><path d="M13.2 17h5.6M16 14.2v5.6" stroke="${R}"/>`,
    'mirror': `<path d="M12 8v16H4z" stroke="${S}"/><path d="M20 8v16h8z" stroke="${S}" opacity=".45"/><path d="M16 4.5v23" stroke="${Y}" stroke-dasharray="3.2 3.2"/>`,
    'scale': `<rect x="4.5" y="16.5" width="11" height="11" stroke="${S}"/><rect x="4.5" y="8.5" width="19" height="19" stroke="${S}" opacity=".4"/><path d="M13 19L27 5M27 12.5V5h-7.5" stroke="${U}"/>`,
    'trim': `<path d="M4 20h15.5" stroke="${S}"/><path d="M19.5 20H28" stroke="${S}" stroke-dasharray="2.5 2.5" opacity=".45"/><path d="M19.5 5.5v21" stroke="${Y}"/><path d="M21.8 17.8l4.4 4.4M26.2 17.8l-4.4 4.4" stroke="${R}"/>`,
    'fillet': `<path d="M27 5.5H16M5.5 27V16" stroke="${S}"/><path d="M16 5.5A10.5 10.5 0 0 0 5.5 16" stroke="${U}"/><path d="M5.5 10.5v-5h5" stroke="${S}" stroke-dasharray="2.2 2.2" opacity=".5"/>`,
    'stretch': `<rect x="4.5" y="10" width="12" height="12" stroke="${S}"/><path d="M20.5 10v12" stroke="${S}" stroke-dasharray="2.4 2.4" opacity=".6"/><path d="M13 16h13.5M22.5 12.5l4 3.5-4 3.5" stroke="${U}"/>`,
    'array': `<path d="M13.5 5h5v5h-5zM22 5h5v5h-5zM5 13.5h5v5H5zM13.5 13.5h5v5h-5zM22 13.5h5v5h-5zM5 22h5v5H5zM13.5 22h5v5h-5zM22 22h5v5h-5z" stroke="${S}"/><path d="M5 5h5v5H5z" stroke="${U}"/>`,
    'erase': `<path d="M11 27.5l-6.5-6.5L16.5 9a2.2 2.2 0 0 1 3.1 0l3.9 3.9a2.2 2.2 0 0 1 0 3.1z" stroke="${S}"/><path d="M9 16.5l6.5 6.5" stroke="${S}"/><path d="M16.5 27.5h4.5M24.5 27.5h4" stroke="${R}"/>`,
    'explode': `<rect x="12" y="12" width="8" height="8" stroke="${S}"/><path d="M9.5 9.5L5 5M22.5 9.5L27 5M9.5 22.5L5 27M22.5 22.5L27 27" stroke="${Y}"/>`,
    'offset': `<path d="M6 26V10a4 4 0 0 1 4-4h16" stroke="${S}"/><path d="M13 26V15.5a2.5 2.5 0 0 1 2.5-2.5H26" stroke="${U}"/>`,

    /* ---- Annotation ---- */
    'text-multi': `<path d="M8.5 25L15.9 6.5 23.3 25M11 18.7h9.8" stroke="${S}"/><path d="M27.5 8.5v15M25.7 8.5h3.6M25.7 23.5h3.6" stroke="${U}"/>`,
    'text-single': `<path d="M9.5 23L16 7.5 22.5 23M11.8 17.5h8.4" stroke="${S}"/><path d="M5 27.5h22" stroke="${U}"/>`,
    'dim-linear': `<path d="M6 6v14M26 6v14" stroke="${S}"/><path d="M6 16h20" stroke="${U}"/><path d="M9.5 13.8L6 16l3.5 2.2M22.5 13.8L26 16l-3.5 2.2" stroke="${U}"/>`,
    'dim-aligned': `<path d="M4.5 22.5l5 5M22.5 4.5l5 5" stroke="${S}"/><path d="M7 25L25 7" stroke="${U}"/><path d="M7.5 20.8L7 25l4.2-.5M20.8 7.5L25 7l-.5 4.2" stroke="${U}"/>`,
    'dim-radius': `<circle cx="14" cy="18" r="9.5" stroke="${S}"/><path d="M14 18L27 5" stroke="${U}"/><path d="M19.5 14.7L20.7 11.3 17.3 12.5" stroke="${U}"/>`,
    'dim-angular': `<path d="M5.5 26.5h21M5.5 26.5L21.5 7" stroke="${S}"/><path d="M17.5 26.5A12 12 0 0 0 13.1 17.2" stroke="${U}"/>`,
    'leader': `<path d="M5 26L17 12h9.5" stroke="${S}"/><path d="M8.2 24.6L5 26l1-3.4" stroke="${S}"/><path d="M20 7.5h8M20 16.5h8" stroke="${U}" opacity=".85"/>`,
    'table': `<rect x="4.5" y="6" width="23" height="20" stroke="${S}"/><rect x="4.5" y="6" width="23" height="6" fill="${U}" opacity=".25" stroke="none"/><path d="M4.5 12h23M4.5 19h23M12.2 12v14M19.8 12v14" stroke="${S}"/>`,

    /* ---- Layers ---- */
    'layer-props': `<path d="M16 4.5L27.5 10.75 16 17 4.5 10.75z" stroke="${U}" fill="${U}" fill-opacity=".18"/><path d="M4.5 16.5L16 22.75l11.5-6.25" stroke="${S}"/><path d="M4.5 21.5L16 27.75l11.5-6.25" stroke="${S}"/>`,
    'layer-off': `<path d="M16 9L27.5 15 16 21 4.5 15z" stroke="${S}"/><path d="M7 26L25 6" stroke="${R}"/>`,
    'layer-freeze': `<path d="M22.5 3.5v11M17.7 6.3l9.6 5.4M27.3 6.3l-9.6 5.4" stroke="${U}"/><path d="M11 17.5l8.5 4.75L11 27l-8.5-4.75z" stroke="${S}"/>`,
    'layer-lock': `<path d="M10 16.5l8 4.5-8 4.5-8-4.5z" stroke="${S}"/><rect x="18.5" y="13.5" width="10.5" height="8.5" rx="1.2" stroke="${Y}"/><path d="M21 13.5v-2.7a2.75 2.75 0 0 1 5.5 0v2.7" stroke="${Y}"/>`,
    'layer-match': `<path d="M10 4.5L18 9l-8 4.5L2 9z" stroke="${U}"/><path d="M22 18.5l8 4.5-8 4.5-8-4.5z" stroke="${S}"/><path d="M9.5 15.5v6.5h4M11 19.5l2.8 2.5-2.8 2.5" stroke="${Y}"/>`,

    /* ---- Blocks ---- */
    'block-insert': `<rect x="11" y="11" width="16.5" height="16.5" stroke="${S}"/><path d="M4.5 4.5L14 14M14 8.5V14H8.5" stroke="${U}"/>`,
    'block-create': `<rect x="4.5" y="12" width="15" height="15" stroke="${S}"/><path d="M24 4.5v10M19 9.5h10" stroke="${G}"/>`,
    'block-edit': `<rect x="4.5" y="4.5" width="14.5" height="14.5" stroke="${S}"/><path d="M13.5 28.5l1-4.2 8.3-8.3 3.2 3.2-8.3 8.3z" stroke="${Y}"/>`,

    /* ---- Utilities ---- */
    'match-props': `<path d="M28 4L16.5 15.5" stroke="${S}"/><path d="M16.5 15.5c-3.6.2-6.2 1.8-7.6 4.8-1.2 2.6-2.4 4.7-4.4 6.2 2.6 1.2 7.6 1.6 10.4-1.2 2.3-2.3 3.2-6 1.6-9.8z" stroke="${Y}"/>`,
    'transparency': `<rect x="4.5" y="4.5" width="15" height="15" stroke="${S}"/><rect x="12.5" y="12.5" width="15" height="15" stroke="${U}" opacity=".6"/><path d="M12.5 20.5h7v-8" stroke="${U}" stroke-dasharray="2.4 2.4"/>`,
    'list': `<rect x="5.5" y="4" width="21" height="24" rx="1.5" stroke="${S}"/><path d="M9.5 10h7M9.5 15h13M9.5 20h13M9.5 25h9" stroke="${U}"/>`,
    'measure': `<rect x="3" y="17.5" width="26" height="9" rx="1.5" stroke="${S}"/><path d="M8 17.5v3.5M13 17.5v5M18 17.5v3.5M23 17.5v5" stroke="${S}"/><path d="M5 6v6M27 6v6M5 9h22" stroke="${U}"/>`,
    'quickselect': `<rect x="4.5" y="4.5" width="23" height="23" stroke="${S}" stroke-dasharray="3 3" opacity=".7"/><path d="M17.5 6.5L11 16h4.5L13 25.5 22 15h-4.5z" stroke="${Y}"/>`,
    'calc': `<rect x="7" y="4" width="18" height="24" rx="2" stroke="${S}"/><rect x="10.5" y="7.5" width="11" height="4.5" stroke="${U}"/><path d="M11.5 16.5h.01M16 16.5h.01M20.5 16.5h.01M11.5 20.8h.01M16 20.8h.01M20.5 20.8h.01M11.5 25.1h.01M16 25.1h.01M20.5 25.1h.01" stroke="${S}" stroke-width="2.6"/>`,
    'group': `<rect x="3" y="3" width="26" height="26" rx="2" stroke="${U}" stroke-dasharray="3 3"/><circle cx="11.5" cy="20" r="5" stroke="${S}"/><rect x="16.5" y="8" width="9.5" height="8.5" stroke="${S}"/>`,
    'ungroup': `<rect x="3.5" y="5" width="11" height="11" stroke="${S}"/><circle cx="23.5" cy="21.5" r="5.5" stroke="${S}"/><path d="M20.5 3.5l-9 25" stroke="${R}" stroke-dasharray="3 3"/>`,
    'group-edit': `<rect x="3" y="6" width="22" height="19" rx="2" stroke="${U}" stroke-dasharray="3 3"/><circle cx="10.5" cy="19" r="4.5" stroke="${S}"/><rect x="14.5" y="10" width="7" height="6.5" stroke="${S}"/><path d="M20 27l6.5-6.5 2.6 2.6L22.6 29.6 19.4 30.2z" stroke="${Y}"/>`,
    'group-select': `<rect x="3" y="3" width="22" height="22" rx="2" stroke="${U}" stroke-dasharray="3 3"/><circle cx="10" cy="18" r="4.5" stroke="${S}"/><rect x="14" y="7.5" width="7.5" height="7" stroke="${S}"/><path d="M20 18l8.5 3.5-3.7 1.3 2.4 4-2.2 1.3-2.4-4L20 27z" stroke="${S}" fill="#dfe3e7"/>`,
    'group-manager': `<rect x="3" y="4" width="26" height="24" rx="1.5" stroke="${S}"/><path d="M3 10.5h26" stroke="${S}"/><rect x="6.5" y="14" width="6" height="4.5" stroke="${U}"/><path d="M15.5 16.2h10" stroke="${S}"/><rect x="6.5" y="21" width="6" height="4.5" stroke="${U}"/><path d="M15.5 23.2h10" stroke="${S}"/>`,
    'group-bbox': `<rect x="3.5" y="6" width="25" height="20" stroke="${U}" stroke-dasharray="3 3"/><circle cx="12" cy="19.5" r="4.5" stroke="${S}"/><rect x="17" y="10" width="8" height="7" stroke="${S}"/><rect x="13.8" y="13.8" width="4.4" height="4.4" fill="${U}" stroke="none"/>`,

    /* ---- Clipboard ---- */
    'paste': `<rect x="5" y="5" width="16.5" height="22" rx="1.5" stroke="${S}"/><rect x="10" y="3" width="6.5" height="4.5" rx="1" stroke="${S}"/><rect x="15" y="13.5" width="12.5" height="14" stroke="${U}"/><path d="M18 18h6.5M18 22h6.5" stroke="${U}" opacity=".6"/>`,
    'cut': `<circle cx="7" cy="9.5" r="3.6" stroke="${S}"/><circle cx="7" cy="22.5" r="3.6" stroke="${S}"/><path d="M10.2 11.3l17.3 9.7M10.2 20.7L27.5 11" stroke="${S}"/>`,
    'copyclip': `<rect x="5.5" y="4.5" width="21" height="23" rx="2" stroke="${S}"/><rect x="11.5" y="2.5" width="9" height="4.5" rx="1" stroke="${S}"/><rect x="10" y="11.5" width="8" height="9" stroke="${U}" opacity=".5"/><rect x="14" y="14.5" width="8" height="9" stroke="${U}"/>`,

    /* ---- Navigate ---- */
    'pan': `<path d="M9.7 17V10.2a1.8 1.8 0 0 1 3.6 0V8.4a1.8 1.8 0 0 1 3.6 0v1a1.8 1.8 0 0 1 3.6 0v1.8a1.8 1.8 0 0 1 3.6 0v8.6c0 4.8-3.2 8.2-8.3 8.2-3.9 0-6-1.5-7.8-4.6l-2.9-5c-.9-1.6.7-3.4 2.4-2.6l2.2 1z" stroke="${S}"/>`,
    'zoom-extents': `<circle cx="13.5" cy="13.5" r="9.5" stroke="${S}"/><path d="M20.8 20.8L28.5 28.5" stroke="${S}"/><path d="M8.5 11V8.5H11M16 8.5h2.5V11M8.5 16v2.5H11M18.5 16v2.5H16" stroke="${U}"/>`,
    'zoom-window': `<circle cx="13.5" cy="13.5" r="9.5" stroke="${S}"/><path d="M20.8 20.8L28.5 28.5" stroke="${S}"/><rect x="9" y="9" width="9" height="9" stroke="${U}" stroke-dasharray="2.2 2.2"/>`,
    'zoom-previous': `<circle cx="13.5" cy="13.5" r="9.5" stroke="${S}"/><path d="M20.8 20.8L28.5 28.5" stroke="${S}"/><path d="M17.5 13.5H10M12.8 10.7l-2.8 2.8 2.8 2.8" stroke="${U}"/>`,
    'zoom-realtime': `<circle cx="13.5" cy="13.5" r="9.5" stroke="${S}"/><path d="M20.8 20.8L28.5 28.5" stroke="${S}"/><path d="M13.5 8v11M13.5 8l-2.6 2.6M13.5 8l2.6 2.6M13.5 19l-2.6-2.6M13.5 19l2.6-2.6" stroke="${U}"/>`,
    'zoom-all': `<circle cx="13.5" cy="13.5" r="9.5" stroke="${S}"/><path d="M20.8 20.8L28.5 28.5" stroke="${S}"/><rect x="7.5" y="7.5" width="12" height="12" stroke="${U}"/><rect x="10.5" y="10.5" width="6" height="6" stroke="${U}" opacity=".55"/>`,
    'zoom-dynamic': `<circle cx="13.5" cy="13.5" r="9.5" stroke="${S}"/><path d="M20.8 20.8L28.5 28.5" stroke="${S}"/><rect x="8" y="9" width="11" height="9" stroke="${U}" stroke-dasharray="2.2 2.2"/><path d="M11.2 11.2l4.6 4.6M15.8 11.2l-4.6 4.6" stroke="${U}"/>`,
    'zoom-scale': `<circle cx="13.5" cy="13.5" r="9.5" stroke="${S}"/><path d="M20.8 20.8L28.5 28.5" stroke="${S}"/><path d="M7.5 16.5h12M9.5 16.5v-3M12.5 16.5v-4.5M15.5 16.5v-3M18.5 16.5v-4.5" stroke="${U}"/>`,
    'zoom-center': `<circle cx="13.5" cy="13.5" r="9.5" stroke="${S}"/><path d="M20.8 20.8L28.5 28.5" stroke="${S}"/><path d="M13.5 7.5v12M7.5 13.5h12" stroke="${U}" opacity=".55"/><circle cx="13.5" cy="13.5" r="2.4" stroke="${U}"/>`,
    'zoom-object': `<circle cx="13.5" cy="13.5" r="9.5" stroke="${S}"/><path d="M20.8 20.8L28.5 28.5" stroke="${S}"/><path d="M13.5 8.5l5.5 9.5H8z" stroke="${U}"/>`,
    'zoom-in': `<circle cx="13.5" cy="13.5" r="9.5" stroke="${S}"/><path d="M20.8 20.8L28.5 28.5" stroke="${S}"/><path d="M8.5 13.5h10M13.5 8.5v10" stroke="${U}"/>`,
    'zoom-out': `<circle cx="13.5" cy="13.5" r="9.5" stroke="${S}"/><path d="M20.8 20.8L28.5 28.5" stroke="${S}"/><path d="M8.5 13.5h10" stroke="${U}"/>`,
    'orbit': `<circle cx="16" cy="16" r="8" stroke="${S}"/><ellipse cx="16" cy="16" rx="13.5" ry="5" stroke="${U}"/>`,
    'orbit-free': `<circle cx="16" cy="16" r="11" stroke="${S}" stroke-dasharray="3 2.4"/><circle cx="16" cy="16" r="5" stroke="${U}"/><circle cx="5" cy="16" r="2.2" stroke="${U}"/><circle cx="27" cy="16" r="2.2" stroke="${U}"/><circle cx="16" cy="5" r="2.2" stroke="${U}"/><circle cx="16" cy="27" r="2.2" stroke="${U}"/>`,
    'orbit-continuous': `<circle cx="16" cy="16" r="8" stroke="${S}"/><ellipse cx="16" cy="16" rx="13.5" ry="5" stroke="${U}"/><path d="M27 13.6l2.5 2.4-2.5 2.4M5 18.4L2.5 16 5 13.6" stroke="${U}"/>`,
    'wheel': `<circle cx="16" cy="16" r="11" stroke="${S}"/><circle cx="16" cy="16" r="4" stroke="${S}"/><path d="M16 5v7M16 20v7M5 16h7M20 16h7" stroke="${S}"/>`,

    /* ---- Palettes / misc ---- */
    'properties': `<path d="M5 9h22M5 16h22M5 23h22" stroke="${S}"/><circle cx="12" cy="9" r="2.7" stroke="${U}"/><circle cx="21" cy="16" r="2.7" stroke="${U}"/><circle cx="9" cy="23" r="2.7" stroke="${U}"/>`,
    'palette-layers': `<rect x="4.5" y="4.5" width="23" height="23" rx="1.5" stroke="${S}"/><path d="M4.5 10h23" stroke="${S}"/><path d="M8.5 15.5h3M15.5 15.5h8M8.5 21.5h3M15.5 21.5h8" stroke="${U}"/>`,
    'xref': `<path d="M14 5.5H5.5v21h21V18" stroke="${S}"/><path d="M19.5 5.5h7V12M26.5 5.5l-10 10" stroke="${U}"/>`,
    'image-attach': `<rect x="4.5" y="6.5" width="23" height="19" rx="1.5" stroke="${S}"/><circle cx="11.5" cy="12.5" r="2.2" stroke="${Y}"/><path d="M4.5 21.5l6.5-6 5 4.5 5.5-6 6 6.5" stroke="${S}"/>`,
    'export-png': `<rect x="4.5" y="4.5" width="17" height="17" rx="1.5" stroke="${S}"/><circle cx="9.5" cy="9.5" r="1.8" stroke="${Y}"/><path d="M5.5 19l4.5-4.5 5.5 5.5" stroke="${S}"/><path d="M26 28.5v-9M22.5 22.9l3.5-3.5 3.5 3.5" stroke="${G}"/>`,
    'export-pdf': `<path d="M7 4.5h11l6 6V27.5H7z" stroke="${S}"/><path d="M18 4.5v6h6" stroke="${S}"/><path d="M15.5 13.5v9M11.5 19l4 4 4-4" stroke="${R}"/>`,
    'close-doc': `<path d="M7 4.5h11l6 6V27.5H7z" stroke="${S}"/><path d="M18 4.5v6h6" stroke="${S}"/><path d="M12 15.5l7 7M19 15.5l-7 7" stroke="${R}"/>`,

    /* ---- Status bar (currentColor only) ---- */
    'sb-grid': `<path d="M4 10.7h24M4 16h24M4 21.3h24M10.7 4v24M16 4v24M21.3 4v24" stroke="currentColor"/>`,
    'sb-snap': `<path d="M5 11h22M5 21h22M11 5v22M21 5v22" stroke="currentColor" opacity=".55"/><circle cx="11" cy="11" r="4.2" stroke="currentColor"/>`,
    'sb-infer': `<path d="M6 26V6l20 20z" stroke="currentColor"/><path d="M6 19.5h6.5V26" stroke="currentColor" opacity=".7"/>`,
    'sb-ortho': `<path d="M7 5v20h20" stroke="currentColor"/><path d="M13 25v-6H7" stroke="currentColor" opacity=".7"/>`,
    /* industry-standard-style: dashed horizontal ray + tracking ray at an angle,
       protractor arc and a vertex dot */
    'sb-polar': `<path d="M6 26h4.5M14 26h4.5M22 26h4.5" stroke="currentColor" opacity=".7"/><path d="M6 26L22.5 5.5" stroke="currentColor"/><path d="M15.5 26a9.5 9.5 0 0 0-4.1-7.8" stroke="currentColor" opacity=".9"/><circle cx="6" cy="26" r="1.7" fill="currentColor" stroke="none"/>`,
    /* industry-standard-style: snap marker square sitting on a line */
    'sb-osnap': `<path d="M4.5 27.5l6.5-6.5M21 11l6.5-6.5" stroke="currentColor"/><rect x="11.5" y="11.5" width="9" height="9" stroke="currentColor"/>`,
    'sb-otrack': `<path d="M3.5 21h25M21 3.5v25" stroke="currentColor" stroke-dasharray="3.2 3.2"/><rect x="17.5" y="17.5" width="7" height="7" stroke="currentColor"/>`,
    'sb-dyn': `<path d="M8.5 4.5v12M2.5 10.5h12" stroke="currentColor"/><rect x="14" y="18" width="14.5" height="9" rx="1" stroke="currentColor"/><path d="M17 22.5h8.5" stroke="currentColor" opacity=".7"/>`,
    'sb-lwt': `<path d="M5 8h22" stroke="currentColor" stroke-width="1.1"/><path d="M5 15.5h22" stroke="currentColor" stroke-width="2.6"/><path d="M5 23.5h22" stroke="currentColor" stroke-width="4.4"/>`,
    'sb-transparency': `<rect x="5" y="5" width="22" height="22" stroke="currentColor"/><path d="M5 16L16 5M5 27L27 5M16 27L27 16" stroke="currentColor" stroke-dasharray="2.4 2.4" opacity=".55"/>`,
    'sb-cycling': `<rect x="4.5" y="11" width="13" height="13" stroke="currentColor" opacity=".5"/><rect x="11.5" y="15" width="13" height="12.5" stroke="currentColor"/><path d="M11 5.5h10M18 2.5l3 3-3 3" stroke="currentColor"/>`,
    'sb-units': `<rect x="4" y="11" width="24" height="10" rx="1" stroke="currentColor"/><path d="M9 11v4M14 11v6M19 11v4M24 11v6" stroke="currentColor"/>`,
    'sb-isolate': `<rect x="3.5" y="3.5" width="25" height="25" rx="1.5" stroke="currentColor" stroke-dasharray="3 3" opacity=".5"/><circle cx="16" cy="16" r="5.5" stroke="currentColor"/>`,
    'sb-gear': `<circle cx="16" cy="16" r="8.2" stroke="currentColor"/><circle cx="16" cy="16" r="3.4" stroke="currentColor"/><path d="M16 4v3.5M16 24.5V28M4 16h3.5M24.5 16H28M7.5 7.5L10 10M22 22l2.5 2.5M24.5 7.5L22 10M10 22l-2.5 2.5" stroke="currentColor" stroke-width="3"/>`,
    'sb-fullscreen': `<path d="M5 12V5h7M20 5h7v7M27 20v7h-7M12 27H5v-7" stroke="currentColor"/>`,

    /* ---- UI chrome (currentColor only) ---- */
    'search': `<circle cx="14" cy="14" r="8.5" stroke="currentColor"/><path d="M20.4 20.4L28 28" stroke="currentColor"/>`,
    'account': `<circle cx="16" cy="11" r="5.5" stroke="currentColor"/><path d="M5.5 27.5c0-5.8 4.7-9 10.5-9s10.5 3.2 10.5 9" stroke="currentColor"/>`,
    'chevron-down': `<path d="M8 12l8 8 8-8" stroke="currentColor"/>`,
    'check': `<path d="M6 17l7 7L26 9" stroke="currentColor"/>`,
    'folder': `<path d="M4.5 25.5v-18h8l3 3h12v15z" stroke="${Y}"/><path d="M4.5 13.5h23" stroke="${Y}" opacity=".5"/>`,
    'file-drawing': `<path d="M7 4.5h11l7 7V27.5H7z" stroke="${S}"/><path d="M18 4.5v7h7" stroke="${S}"/><circle cx="13" cy="19" r="3.2" stroke="${U}"/><path d="M15.3 21.3l5.2 4.2" stroke="${U}"/>`,

    /* ================= v2 additions (SPEC2 Â§19) ================= */

    /* ---- Modify v2 ---- */
    // extend: solid segment continued (dashed + arrow) to a boundary edge
    'extend': `<path d="M24 5.5v21" stroke="${Y}"/><path d="M3.5 16H12" stroke="${S}"/><path d="M12 16h8" stroke="${U}" stroke-dasharray="2.4 2.4"/><path d="M17.5 12.5l3.5 3.5-3.5 3.5" stroke="${U}"/>`,
    // array-polar: items ringed around a center mark (vs rectangular 'array' grid)
    'array-polar': `<circle cx="16" cy="16" r="10.5" stroke="${S}" stroke-dasharray="2.6 2.6" opacity=".55"/><path d="M13.5 16h5M16 13.5v5" stroke="${R}"/><rect x="13.8" y="3.3" width="4.4" height="4.4" stroke="${U}"/><rect x="24.3" y="13.8" width="4.4" height="4.4" stroke="${S}"/><rect x="13.8" y="24.3" width="4.4" height="4.4" stroke="${S}"/><rect x="3.3" y="13.8" width="4.4" height="4.4" stroke="${S}"/>`,

    /* ---- Layers v2 ---- */
    // make-current: arrow dropping onto a layer plate
    'make-current': `<path d="M16 13.5l11.5 6.25L16 26 4.5 19.75z" stroke="${S}"/><path d="M16 2.5v8M12.2 6.8L16 10.5l3.8-3.7" stroke="${G}"/>`,
    // match-layer: eyedropper applying a picked layer onto a plate
    'match-layer': `<path d="M11 18.5l8.5 4.75L11 28l-8.5-4.75z" stroke="${S}"/><path d="M28.5 3.5l-4.2 1.2-8 8 3 3 8-8z" stroke="${Y}"/><path d="M17.8 12.2l-4.3 4.3" stroke="${Y}"/>`,

    /* ---- Blocks / attributes v2 ---- */
    // edit-attributes: attribute sheet with pencil
    'edit-attributes': `<rect x="4.5" y="4.5" width="17.5" height="20" rx="1.5" stroke="${S}"/><path d="M8 10h10.5M8 14.5h10.5M8 19h6.5" stroke="${U}"/><path d="M16.5 28.5l1-4.2 7.3-7.3 3.2 3.2-7.3 7.3z" stroke="${Y}"/>`,
    // block-attr: block square with an attribute "A" tag
    'block-attr': `<rect x="4.5" y="12.5" width="15" height="15" stroke="${S}"/><path d="M20.5 11.5l4-9 4 9M21.9 8.2h5.2" stroke="${G}"/>`,
    // base: crosshair with base-point circle at origin
    'base': `<path d="M16 3.5V12M16 20v8.5M3.5 16H12M20 16h8.5" stroke="${S}"/><circle cx="16" cy="16" r="4" stroke="${R}"/>`,
    // detect-convert: wand + sparkles detecting a dashed boundary
    'detect-convert': `<path d="M4.5 27.5L12 20" stroke="${S}"/><path d="M13.8 18.2l2.7-2.7" stroke="${S}"/><rect x="16.5" y="4.5" width="11" height="11" stroke="${U}" stroke-dasharray="2.4 2.4"/><path d="M6.5 3.5v5M4 6h5M25 21.5v5M22.5 24h5" stroke="${Y}"/>`,

    /* ---- Hatch v2 ---- */
    // hatch-solid: fully filled boundary
    'hatch-solid': `<rect x="6" y="6" width="20" height="20" stroke="${S}" fill="${U}" fill-opacity=".4"/>`,
    // hatch-ansi31: sparse 45Â° section lines (opposite direction to 'hatch')
    'hatch-ansi31': `<rect x="6" y="6" width="20" height="20" stroke="${S}"/><path d="M6 10l16 16M6 17l9 9M10 6l16 16M17 6l9 9" stroke="${Y}"/>`,

    /* ---- Navigate v2 ---- */
    // nav-wheel: steering-wheel with X spokes + blue hub (vs 'wheel' + spokes)
    'nav-wheel': `<circle cx="16" cy="16" r="11" stroke="${S}"/><circle cx="16" cy="16" r="4.5" stroke="${U}"/><path d="M8.3 8.3l4.5 4.5M23.7 8.3l-4.5 4.5M8.3 23.7l4.5-4.5M23.7 23.7l-4.5-4.5" stroke="${S}"/>`,
    // showmotion: playback screen with thumbnail strip
    'showmotion': `<rect x="4.5" y="4.5" width="23" height="15.5" rx="1.5" stroke="${S}"/><path d="M13.8 8.5l6.4 3.75-6.4 3.75z" stroke="${G}"/><rect x="4.5" y="23" width="6.5" height="4.5" stroke="${S}" opacity=".8"/><rect x="12.75" y="23" width="6.5" height="4.5" stroke="${S}" opacity=".8"/><rect x="21" y="23" width="6.5" height="4.5" stroke="${S}" opacity=".8"/>`,
    // plus-tab: new document tab with plus
    'plus-tab': `<path d="M4.5 26.5v-15A2.5 2.5 0 0 1 7 9h7a2.5 2.5 0 0 1 2.5 2.5v15" stroke="${S}"/><path d="M2.5 26.5h27" stroke="${S}"/><path d="M24.5 6.5v9M20 11h9" stroke="${G}"/>`,

    /* ---- UI chrome v2 (currentColor only) ---- */
    'menu': `<path d="M6 9h20M6 16h20M6 23h20" stroke="currentColor"/>`,
    'wrench': `<path d="M19.6 8.4a1.3 1.3 0 0 0 0 1.9l2.1 2.1a1.3 1.3 0 0 0 1.9 0l5-5a8 8 0 0 1-10.6 10.6l-9.2 9.2a2.85 2.85 0 0 1-4-4l9.2-9.2A8 8 0 0 1 24.6 3.4l-5 5z" stroke="currentColor"/>`,
    'help': `<circle cx="16" cy="16" r="11.5" stroke="currentColor"/><path d="M12.3 12.3a3.7 3.7 0 1 1 5.8 3c-1.3.9-2.1 1.7-2.1 3.2" stroke="currentColor"/><path d="M16 23.2h.01" stroke="currentColor" stroke-width="2.8"/>`,
    'list-view': `<path d="M11.5 8h15.5M11.5 16h15.5M11.5 24h15.5" stroke="currentColor"/><path d="M5.5 8h.01M5.5 16h.01M5.5 24h.01" stroke="currentColor" stroke-width="3.2"/>`,
    'grid-view': `<rect x="5" y="5" width="9.5" height="9.5" rx="1.5" stroke="currentColor"/><rect x="17.5" y="5" width="9.5" height="9.5" rx="1.5" stroke="currentColor"/><rect x="5" y="17.5" width="9.5" height="9.5" rx="1.5" stroke="currentColor"/><rect x="17.5" y="17.5" width="9.5" height="9.5" rx="1.5" stroke="currentColor"/>`,

    /* ---- Start page empty state (viewBox 0 0 140 140) ---- */
    // File cabinet with an open drawer and a paper hanging out of it.
    'start-empty': `<g stroke-width="2.5">`
      + `<rect x="40" y="16" width="60" height="70" rx="3" stroke="#9aa0a6"/>`
      + `<path d="M40 39h60M40 62h60" stroke="#9aa0a6"/>`
      + `<path d="M62 27.5h16M62 50.5h16" stroke="#6b7075"/>`
      + `<path d="M40 86l-12 11M100 86l12 11" stroke="#6b7075" opacity=".8"/>`
      + `<g transform="rotate(-5 68 84)">`
      + `<path d="M56 99V71h17l8 8v20" stroke="#9aa0a6"/>`
      + `<path d="M73 71v8h8" stroke="#6b7075"/>`
      + `<path d="M62 84h11M62 91h13" stroke="#6b7075" opacity=".8"/>`
      + `</g>`
      + `<rect x="28" y="97" width="84" height="25" rx="3" stroke="#9aa0a6"/>`
      + `<path d="M58 109.5h24" stroke="#6b7075"/>`
      + `</g>`
  };

  // Non-default viewBoxes (illustrations); everything else is 0 0 32 32.
  const VIEWBOX = { 'start-empty': '0 0 140 140' };

  const PLACEHOLDER = `<rect x="4.5" y="4.5" width="23" height="23" rx="2" stroke="${S}" stroke-dasharray="3 3" opacity=".6"/>`;
  const warned = new Set();

  const get = (name, size = 32) => {
    let inner = Object.prototype.hasOwnProperty.call(P, name) ? P[name] : undefined;
    if (inner === undefined) {
      const key = String(name);
      if (!warned.has(key)) {
        warned.add(key);
        console.warn(`NasjIcons: unknown icon "${key}" — using placeholder.`);
      }
      inner = PLACEHOLDER;
    }
    const sw = size <= 16 ? 2 : 1.7;
    const vb = Object.prototype.hasOwnProperty.call(VIEWBOX, name) ? VIEWBOX[name] : '0 0 32 32';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${vb}" fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  };

  window.Nasj = window.Nasj || {};
  window.NasjIcons = { get, names: Object.freeze(Object.keys(P)) };
})();
