/* pixelbay CAD — icons4.js (owner: ICONS-B)
 * The Solid and Surface tabs' icon set: primitives, the profile-followers,
 * booleans, solid editing, sectioning, sub-object selection, and the
 * surface makers, editors, control-vertex and analysis tools.
 * Self-contained plain script loaded AFTER icons3.js: keeps its own
 * inner-markup table and chains NasjIcons.get (prev-fallback pattern),
 * then appends its names to NasjIcons.names (no duplicates).
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

  // The shared isometric cube: top rhombus, left and right faces.
  const CT = 'M16 4l11 5.5-11 5.5-11-5.5z';
  const CL = 'M5 9.5v12l11 5.5v-12z';
  const CR = 'M27 9.5v12l-11 5.5v-12z';
  const CUBE = `<path d="${CT}" stroke="${S}"/><path d="${CL}" stroke="${S}"/><path d="${CR}" stroke="${S}"/>`;
  // Two overlapping plan squares, the boolean pair.
  const SQ_A = 'M5 8h14v14H5z';
  const SQ_B = 'M13 14h14v14H13z';

  const P = {
    // solid-box: the cube, its top tinted
    'solid-box': `${CUBE}<path d="M16 6.2l6.6 3.3-6.6 3.3-6.6-3.3z" stroke="${U}" opacity=".8"/>`,
    // solid-cylinder: top ellipse, sides, base arc
    'solid-cylinder': `<ellipse cx="16" cy="8" rx="9" ry="4" stroke="${S}"/>` +
      `<path d="M7 8v16M25 8v16" stroke="${S}"/><path d="M7 24a9 4 0 0 0 18 0" stroke="${S}"/>`,
    // solid-sphere: circle with equator and meridian
    'solid-sphere': `<circle cx="16" cy="16" r="11" stroke="${S}"/>` +
      `<ellipse cx="16" cy="16" rx="11" ry="4" stroke="${S}" opacity=".6"/>` +
      `<ellipse cx="16" cy="16" rx="4" ry="11" stroke="${S}" opacity=".4"/>`,
    // polysolid: an L-run of double walls standing up
    'polysolid': `<path d="M4 27V13h8v6h16v8z" stroke="${S}"/>` +
      `<path d="M4 13l3-3h8l-3 3M12 19l3-3h13l-3 3M28 19l0 8" stroke="${S}" opacity=".7"/>` +
      `<path d="M7 10v14" stroke="${U}" opacity=".8"/>`,
    // solid-history: the cube remembering — a clockwise arrow on its face
    'solid-history': `${CUBE}<path d="M12 20.5a4.5 4.5 0 1 1 4.5 4.5" stroke="${Y}"/>` +
      `<path d="M16.5 22.5v2.5H19" stroke="${Y}"/>`,
    // presspull: a base profile and the fat arrow pulling it up
    'presspull': `<path d="M5 23l11-5.5 11 5.5-11 5.5z" stroke="${S}"/>` +
      `<path d="M16 19V8" stroke="${U}"/><path d="M12 11l4-5 4 5" stroke="${U}"/>` +
      `<path d="M5 23v-5l4-2M27 23v-5l-4-2" stroke="${S}" opacity=".45"/>`,
    // revolve: a dashed axis and the profile swinging round it
    'revolve': `<path d="M8 4v24" stroke="${Y}" stroke-dasharray="4 2.5"/>` +
      `<path d="M13 8h7l4 6-4 2h-7z" stroke="${S}"/>` +
      `<path d="M25 22a12 5 0 1 1-9-4.8" stroke="${U}"/><path d="M13.5 15.2l2.5 2-3.1.8" stroke="${U}"/>`,
    // sweep: a circle profile carried along an S path
    'sweep': `<circle cx="7" cy="25" r="3.5" stroke="${U}"/>` +
      `<path d="M7 25c8 0 4-10 12-12" stroke="${Y}" stroke-dasharray="4 2.5"/>` +
      `<path d="M10.5 25c8 0 4-10 12-12M3.5 25c8 0 4-10 12-12" stroke="${S}"/>` +
      `<ellipse cx="21" cy="10.5" rx="3.5" ry="2.6" stroke="${S}" transform="rotate(20 21 10.5)"/>`,
    // loft: a small top section, a wide base, the skin between them
    'loft': `<ellipse cx="16" cy="7" rx="6" ry="2.5" stroke="${S}"/>` +
      `<ellipse cx="16" cy="25" rx="11" ry="4" stroke="${S}"/>` +
      `<path d="M10 7c-3 8-3 10-5 18M22 7c3 8 3 10 5 18" stroke="${U}"/>`,
    // union: two squares as one outline
    'union': `<path d="M5 8h14v6h8v14H13v-8H5z" stroke="${U}"/>`,
    // subtract: the first square notched where the second stood
    'subtract': `<path d="M5 8h14v6h-6v8H5z" stroke="${S}"/>` +
      `<path d="${SQ_B}" stroke="${R}" stroke-dasharray="3 2.5" opacity=".8"/>`,
    // intersect: only the shared middle kept
    'intersect': `<path d="${SQ_A}" stroke="${S}" opacity=".4"/><path d="${SQ_B}" stroke="${S}" opacity=".4"/>` +
      `<path d="M13 14h6v8h-6z" stroke="${U}"/>`,
    // slice: the cube parted by a plane, the halves drawn apart
    'slice': `<path d="M4 12l8-4v9l-8 4zM12 8l4 2v9l-4 2z" stroke="${S}"/>` +
      `<path d="M20 8l8 4v9l-8 4zM20 8l-4 2v9l4 2z" stroke="${S}"/>` +
      `<path d="M18 3v26" stroke="${Y}" stroke-dasharray="4 2.5"/>`,
    // thicken: a flat face given depth
    'thicken': `<path d="M5 14l11-5.5L27 14l-11 5.5z" stroke="${S}"/>` +
      `<path d="M5 14v6l11 5.5V19.5M27 14v6l-11 5.5" stroke="${U}"/>`,
    // imprint: a circle stamped onto the cube's top
    'imprint': `${CUBE}<ellipse cx="16" cy="9.5" rx="4.5" ry="2.2" stroke="${Y}"/>`,
    // interfere: two boxes and the volume they fight over
    'interfere': `<path d="M4 8h13v13H4z" stroke="${S}"/><path d="M15 11h13v13H15z" stroke="${S}"/>` +
      `<path d="M15 11h2v10h-2z" stroke="${R}"/>`,
    // extract-edges: the cube's edges pulled free, its faces gone faint
    'extract-edges': `<path d="${CT}" stroke="${S}" opacity=".35"/><path d="${CL}" stroke="${S}" opacity=".35"/><path d="${CR}" stroke="${S}" opacity=".35"/>` +
      `<path d="M16 15v12M16 15L5 9.5M16 15l11-5.5" stroke="${U}"/>`,
    // offset-edge: a face's outline offset inward on the face
    'offset-edge': `<path d="M5 10l11-5 11 5-11 5z" stroke="${S}"/>` +
      `<path d="M9.5 10l6.5-3 6.5 3-6.5 3z" stroke="${U}"/>` +
      `<path d="M5 10v12l11 5v-12M27 10v12l-11 5" stroke="${S}" opacity=".45"/>`,
    // fillet-edge: the cube with its near edge rounded
    'fillet-edge': `<path d="M16 6.5l9 4.5v9l-9 4.5-9-4.5v-9z" stroke="${S}" opacity=".45"/>` +
      `<path d="M13 8a22 22 0 0 0 0 16" stroke="${U}"/><path d="M16 27V15M16 15L27 9.5" stroke="${S}"/>`,
    // chamfer-edge: the near corner shaved flat
    'chamfer-edge': `<path d="M10 5h12l5 5v12l-5 5H10l-5-5V10z" stroke="${S}"/>` +
      `<path d="M10 5L5 10M22 27l5-5" stroke="${U}"/>`,
    // taper-faces: the sides leaning in as they rise
    'taper-faces': `<path d="M6 26h20M9 26l3-18M23 26l-3-18" stroke="${S}"/>` +
      `<path d="M12 8h8" stroke="${S}"/>` +
      `<path d="M25 7l-3 3" stroke="${U}"/><path d="M25 7l-2.6.4M25 7l-.4 2.6" stroke="${U}"/>`,
    // shell-solid: the cube opened, its wall thickness showing
    'shell-solid': `<path d="M5 9.5v12l11 5.5 11-5.5v-12" stroke="${S}"/>` +
      `<path d="M5 9.5l11 5.5 11-5.5M16 15v12" stroke="${S}"/>` +
      `<path d="M8.5 9.3l7.5 3.7 7.5-3.7" stroke="${U}"/><path d="M8.5 9.3L16 5.6l7.5 3.7" stroke="${U}" opacity=".5"/>`,
    // section-plane: the plane standing through the cube
    'section-plane': `<path d="${CT}" stroke="${S}" opacity=".5"/><path d="${CL}" stroke="${S}" opacity=".5"/><path d="${CR}" stroke="${S}" opacity=".5"/>` +
      `<path d="M22 3L10 8v18l12-5z" stroke="${Y}"/>`,
    // live-section: the cut face revealed, hatched
    'live-section': `<path d="M16 27L5 21.5v-12L16 4l11 5.5" stroke="${S}" opacity=".5"/>` +
      `<path d="M16 27V15L27 9.5v12z" stroke="${Y}"/>` +
      `<path d="M18 17.6v4.2M20.5 16.4v4.2M23 15.1v4.2" stroke="${R}"/>`,
    // add-jog: the section line stepping aside
    'add-jog': `<path d="M5 24h8v-8h6v-8h8" stroke="${Y}"/>` +
      `<path d="M5 24l-1.8 1.8M27 8l1.8-1.8" stroke="${S}"/>` +
      `<circle cx="13" cy="16" r="1.6" fill="${U}" stroke="none"/>`,
    // generate-section: the plane handed on as a flat drawing
    'generate-section': `<path d="M12 3L4 6.5v12L12 15z" stroke="${Y}"/>` +
      `<path d="M14 12h6" stroke="${S}"/><path d="M17.5 9.5L20 12l-2.5 2.5" stroke="${S}"/>` +
      `<rect x="17" y="17" width="11" height="11" stroke="${S}"/>` +
      `<path d="M19.5 20h6M19.5 22.5h6M19.5 25h3.5" stroke="${U}"/>`,
    // culling: the far edges gone from the pick
    'culling': `<path d="${CT}" stroke="${S}"/><path d="M5 9.5v12l11 5.5v-12zM27 9.5v12l-11 5.5v-12" stroke="${S}"/>` +
      `<path d="M5 9.5l4 2M27 9.5l-4 2M16 27v-4" stroke="${R}" stroke-dasharray="2 2" opacity=".8"/>`,
    // subobject filters: the funnel, and what it lets through
    'subobj-nofilter': `<path d="M5 6h22l-8 9v9l-6 3v-12z" stroke="${S}"/>` +
      `<path d="M6 27L26 5" stroke="${R}"/>`,
    'subobj-vertex': `${CUBE}<circle cx="16" cy="15" r="2.4" fill="${U}" stroke="none"/>`,
    'subobj-edge': `${CUBE}<path d="M16 15v12" stroke="${U}"/>`,
    'subobj-face': `${CUBE}<path d="M16 6.2l6.6 3.3-6.6 3.3-6.6-3.3z" stroke="${U}"/>` +
      `<path d="M13 8.2l3.3 1.6M13 10.9l3.3 1.6" stroke="${U}" opacity=".6"/>`,
    // the gizmos
    'gizmo-move': `<path d="M16 26V8" stroke="${U}"/><path d="M13 11l3-4 3 4" stroke="${U}"/>` +
      `<path d="M16 26L5 21" stroke="${G}"/><path d="M9.6 18.2L5 21l4.4 1" stroke="${G}"/>` +
      `<path d="M16 26l11-5" stroke="${R}"/><path d="M22.4 18.2L27 21l-4.4 1" stroke="${R}"/>`,
    'gizmo-rotate': `<ellipse cx="16" cy="16" rx="11" ry="4.2" stroke="${U}"/>` +
      `<ellipse cx="16" cy="16" rx="4.2" ry="11" stroke="${G}"/>` +
      `<circle cx="16" cy="16" r="11" stroke="${R}" opacity=".6"/>`,
    'gizmo-scale': `<path d="M6 26L26 6" stroke="${Y}"/><path d="M20 6h6v6" stroke="${Y}"/>` +
      `<path d="M6 26h7M6 26v-7" stroke="${S}"/>`,
    'gizmo-none': `<path d="M16 24V10M16 24l-8-3.5M16 24l8-3.5" stroke="${S}" opacity=".6"/>` +
      `<path d="M6 27L26 5" stroke="${R}"/>`,

    /* ---- the Surface tab ---- */
    // surf-planar: a flat sheet on the plane
    'surf-planar': `<path d="M4 21l8-10h16l-8 10z" stroke="${S}"/>` +
      `<path d="M8 16h16M10 13.5h13M6 18.5h15" stroke="${U}" opacity=".45"/>`,
    // surf-network: the curves of two directions and the patch they weave
    'surf-network': `<path d="M4 12c6-4 18-4 24 0M4 24c6-4 18-4 24 0" stroke="${Y}"/>` +
      `<path d="M8 9.6c-2 5-2 9-2 12.7M24 9.6c2 5 2 9 2 12.7" stroke="${Y}"/>` +
      `<path d="M4 18c6-4 18-4 24 0M12 8.4c-1 5-1 10-1 14.4M20 8.4c1 5 1 10 1 14.4" stroke="${S}" opacity=".6"/>`,
    // surf-blend: two edges and the sheet stretched between them
    'surf-blend': `<path d="M4 10c5 3 8 3 12 1M14 25c5 1 9-1 14-4" stroke="${Y}"/>` +
      `<path d="M4 10l10 15M16 11l12 10M9.5 12.4L21 18.2" stroke="${U}" opacity=".7"/>`,
    // surf-patch: a closed rim capped with a lid
    'surf-patch': `<ellipse cx="16" cy="20" rx="11" ry="5" stroke="${Y}"/>` +
      `<path d="M5 20c2-6 6-9 11-9s9 3 11 9" stroke="${S}"/>` +
      `<path d="M9 14.6c4-3 10-3 14 0" stroke="${S}" opacity=".5"/>`,
    // surf-offset: a sheet and its double standing off it
    'surf-offset': `<path d="M4 25l8-9h16l-8 9z" stroke="${S}"/>` +
      `<path d="M4 15l8-9h16l-8 9z" stroke="${U}"/>` +
      `<path d="M10 19l0-6M22 19l0-6" stroke="${Y}" stroke-dasharray="2.5 2"/>`,
    // surf-sculpt: sheets closing into a body
    'surf-sculpt': `<path d="M16 4l11 5.5v12L16 27 5 21.5v-12z" stroke="${S}"/>` +
      `<path d="M16 4v11M16 15L5 9.5M16 15l11-5.5M16 27V15" stroke="${U}" opacity=".7"/>` +
      `<path d="M12 18.5l3 3 5.5-5.5" stroke="${G}"/>`,
    // surf-assoc: the sheet chained to its curves
    'surf-assoc': `<path d="M4 21l8-10h16l-8 10z" stroke="${S}"/>` +
      `<circle cx="11" cy="7" r="3" stroke="${Y}"/><circle cx="17" cy="7" r="3" stroke="${Y}"/>` +
      `<path d="M12.8 7h2.4" stroke="${Y}"/>`,
    // nurbs-creation: a CV hull over its smooth curve
    'nurbs-creation': `<path d="M4 24c7-12 17-12 24-4" stroke="${S}"/>` +
      `<path d="M4 24L10 9l12-2 6 12" stroke="${U}" stroke-dasharray="3 2"/>` +
      `<rect x="8.3" y="7.3" width="3.4" height="3.4" stroke="${Y}"/>` +
      `<rect x="20.3" y="5.3" width="3.4" height="3.4" stroke="${Y}"/>`,
    // surf-fillet: two sheets meeting in a rounded corner
    'surf-fillet': `<path d="M5 5v10a12 12 0 0 0 12 12h10" stroke="${U}"/>` +
      `<path d="M5 5h6M27 27v-6" stroke="${S}"/>` +
      `<path d="M11 5h4a12 12 0 0 1 12 12v4" stroke="${S}" opacity=".45"/>`,
    // surf-trim: the scissors line across the sheet
    'surf-trim': `<path d="M4 21l8-10h16l-8 10z" stroke="${S}"/>` +
      `<path d="M9 8l14 16" stroke="${R}"/>` +
      `<circle cx="8" cy="6.5" r="1.8" stroke="${R}"/><circle cx="11.5" cy="5" r="1.8" stroke="${R}"/>`,
    // surf-untrim: the hole healed back over
    'surf-untrim': `<path d="M4 21l8-10h16l-8 10z" stroke="${S}"/>` +
      `<ellipse cx="16" cy="16" rx="4" ry="2.4" stroke="${R}" stroke-dasharray="2.5 2"/>` +
      `<path d="M22 6l4 4-4 4" stroke="${G}"/><path d="M26 10h-7" stroke="${G}"/>`,
    // surf-extend: the sheet reaching further
    'surf-extend': `<path d="M4 21l8-10h10l-8 10z" stroke="${S}"/>` +
      `<path d="M22 11h6l-8 10h-6" stroke="${U}" stroke-dasharray="3 2"/>` +
      `<path d="M20 16h8M25 13l3 3-3 3" stroke="${Y}"/>`,
    // cv-editbar: the vertex bar over a curve
    'cv-editbar': `<path d="M4 24c7-10 17-10 24-2" stroke="${S}"/>` +
      `<path d="M13 17V6" stroke="${Y}"/><rect x="11.3" y="15.3" width="3.4" height="3.4" stroke="${U}"/>` +
      `<path d="M9 6h8M13 6l-2.5-2M13 6l2.5-2" stroke="${Y}"/>`,
    // convert-nurbs: an arrow into the CV hull
    'convert-nurbs': `<path d="M4 12l7-7h10l-7 7z" stroke="${S}" opacity=".6"/>` +
      `<path d="M9 14v5a4 4 0 0 0 4 4h4" stroke="${G}"/><path d="M15 20l3 3-3 3" stroke="${G}"/>` +
      `<path d="M20 27c4-6 6-8 8-9" stroke="${S}"/>` +
      `<rect x="21.3" y="23.3" width="3" height="3" stroke="${Y}"/><rect x="25.3" y="16.3" width="3" height="3" stroke="${Y}"/>`,
    // cv-show / cv-hide: the hull's vertices, offered and refused
    'cv-show': `<path d="M4 24c7-12 17-12 24-4" stroke="${S}"/>` +
      `<path d="M4 24L10 9l12-2 6 12" stroke="${U}" stroke-dasharray="3 2" opacity=".7"/>` +
      `<rect x="8.3" y="7.3" width="3.4" height="3.4" stroke="${Y}"/>` +
      `<rect x="20.3" y="5.3" width="3.4" height="3.4" stroke="${Y}"/>` +
      `<rect x="2.3" y="22.3" width="3.4" height="3.4" stroke="${Y}"/>`,
    'cv-hide': `<path d="M4 24c7-12 17-12 24-4" stroke="${S}"/>` +
      `<path d="M6 27L26 5" stroke="${R}"/>`,
    // cv-rebuild / cv-add / cv-remove
    'cv-rebuild': `<path d="M4 24c7-12 17-12 24-4" stroke="${S}"/>` +
      `<path d="M12 8a7 7 0 1 1-2 6" stroke="${G}"/>` +
      `<path d="M9.6 14.4l.4-4.4 4 1.8" stroke="${G}"/>`,
    'cv-add': `<path d="M4 24c7-12 17-12 24-4" stroke="${S}"/>` +
      `<rect x="13.3" y="10.3" width="3.4" height="3.4" stroke="${Y}"/>` +
      `<path d="M23 7v8M19 11h8" stroke="${G}"/>`,
    'cv-remove': `<path d="M4 24c7-12 17-12 24-4" stroke="${S}"/>` +
      `<rect x="13.3" y="10.3" width="3.4" height="3.4" stroke="${Y}"/>` +
      `<path d="M19 11h8" stroke="${R}"/>`,
    // extract-isolines: one ruling lifted off the sheet
    'extract-isolines': `<path d="M4 21l8-10h16l-8 10z" stroke="${S}"/>` +
      `<path d="M10 13.5h13M6 18.5h15" stroke="${S}" opacity=".35"/>` +
      `<path d="M8 16h16" stroke="${U}"/><path d="M24 8l4-3M24 8l-3.7-.6M24 8l.6-3.7" stroke="${U}" opacity=".8"/>`,
    // auto-trim: the pen line trimming as it goes
    'auto-trim': `<path d="M4 21l8-10h16l-8 10z" stroke="${S}"/>` +
      `<path d="M8 24C14 18 20 14 27 12" stroke="${R}" stroke-dasharray="4 2.5"/>` +
      `<path d="M25 4l3 3-9 9-4 1 1-4z" stroke="${Y}"/>`,
    // project-*: geometry dropped onto the sheet
    'project-ucs': `<path d="M4 23l8-8h16l-8 8z" stroke="${S}"/>` +
      `<circle cx="16" cy="6" r="2.6" stroke="${Y}"/><path d="M16 9v7" stroke="${U}" stroke-dasharray="2.5 2"/>` +
      `<ellipse cx="16" cy="18.5" rx="2.6" ry="1.4" stroke="${U}"/>`,
    'project-view': `<path d="M4 23l8-8h16l-8 8z" stroke="${S}"/>` +
      `<path d="M12 4l4 3 4-3" stroke="${Y}"/><path d="M16 7v9" stroke="${U}" stroke-dasharray="2.5 2"/>` +
      `<ellipse cx="16" cy="18.5" rx="2.6" ry="1.4" stroke="${U}"/>`,
    'project-2pts': `<path d="M4 23l8-8h16l-8 8z" stroke="${S}"/>` +
      `<circle cx="9" cy="6" r="1.6" fill="${Y}" stroke="none"/><circle cx="23" cy="6" r="1.6" fill="${Y}" stroke="none"/>` +
      `<path d="M9 6l7 10.5M23 6l-7 10.5" stroke="${U}" stroke-dasharray="2.5 2"/>` +
      `<circle cx="16" cy="18" r="1.6" fill="${U}" stroke="none"/>`,
    // analysis family
    'analysis-zebra': `<path d="M5 16a11 8 0 1 1 22 0 11 8 0 1 1-22 0z" stroke="${S}"/>` +
      `<path d="M10 9.5c2 4 2 9 1 12M15 8c2 4 2 10 1 15M20 8.5c2 4 2 9 1 14M25 11c1 3 1 6 0 9" stroke="${U}"/>`,
    'analysis-curvature': `<path d="M5 16a11 8 0 1 1 22 0 11 8 0 1 1-22 0z" stroke="${S}"/>` +
      `<path d="M9 18c2-5 5-7 7-7s5 2 7 7" stroke="${R}"/>` +
      `<path d="M11 20c2-3 3-4 5-4s3 1 5 4" stroke="${G}" opacity=".8"/>`,
    'analysis-draft': `<path d="M5 16a11 8 0 1 1 22 0 11 8 0 1 1-22 0z" stroke="${S}"/>` +
      `<path d="M16 8v16" stroke="${Y}"/><path d="M16 8l6 4M16 8l-6 4" stroke="${Y}" opacity=".7"/>`,
    'analysis-options': `<path d="M5 16a11 8 0 1 1 22 0 11 8 0 1 1-22 0z" stroke="${S}"/>` +
      `<circle cx="16" cy="16" r="3.2" stroke="${U}"/>` +
      `<path d="M16 10.5v-2M16 23.5v-2M10 16h-2M24 16h-2" stroke="${U}"/>`,

    /* ---- the Mesh tab: the cube gridded into facets ---- */
    'mesh-box': `${CUBE}` +
      `<path d="M8.7 7.7l11 5.5M12.3 5.9l11 5.5M8.7 13.2v12M12.3 21.2v-9.8M19.7 21.2v-9.8M23.3 13.2v12" stroke="${Y}" opacity=".75"/>` +
      `<path d="M5 13.5l11 5.5 11-5.5M5 17.5l11 5.5 11-5.5" stroke="${Y}" opacity=".75"/>`,
    'mesh-cone': `<path d="M16 4L5 25a18 5 0 0 0 22 0z" stroke="${S}"/>` +
      `<path d="M16 4L12 26.8M16 4l4 22.8M8.5 18.3c4 2.5 11 2.5 15 0M11.2 13c2.8 1.8 6.8 1.8 9.6 0" stroke="${Y}" opacity=".7"/>`,
    'mesh-cylinder': `<ellipse cx="16" cy="7" rx="9" ry="3.4" stroke="${S}"/>` +
      `<path d="M7 7v18M25 7v18" stroke="${S}"/><path d="M7 25a9 3.4 0 0 0 18 0" stroke="${S}"/>` +
      `<path d="M11.5 9.9v18M20.5 9.9v-1.6M20.5 9.9v18" stroke="${Y}" opacity=".7"/>` +
      `<path d="M7 13a9 3.4 0 0 0 18 0M7 19a9 3.4 0 0 0 18 0" stroke="${Y}" opacity=".7"/>`,
    'mesh-pyramid': `<path d="M16 4L4 24l12 4 12-4z" stroke="${S}"/>` +
      `<path d="M16 4v24M16 4L10 26M16 4l6 22M8 20.7l8 2.6 8-2.6" stroke="${Y}" opacity=".7"/>`,
    'mesh-sphere': `<circle cx="16" cy="16" r="11" stroke="${S}"/>` +
      `<ellipse cx="16" cy="16" rx="11" ry="4" stroke="${Y}" opacity=".7"/>` +
      `<ellipse cx="16" cy="16" rx="4" ry="11" stroke="${Y}" opacity=".7"/>` +
      `<ellipse cx="16" cy="16" rx="11" ry="8.5" stroke="${Y}" opacity=".4"/>` +
      `<ellipse cx="16" cy="16" rx="8.5" ry="11" stroke="${Y}" opacity=".4"/>`,
    'mesh-wedge': `<path d="M4 24L28 8v16z" stroke="${S}"/>` +
      `<path d="M12 18.7V24M20 13.3V24M28 16l-16 8" stroke="${Y}" opacity=".7"/>`,
    'mesh-torus': `<path d="M5 16a11 6.5 0 1 1 22 0 11 6.5 0 1 1-22 0z" stroke="${S}"/>` +
      `<path d="M12 16a4 2.4 0 1 1 8 0 4 2.4 0 1 1-8 0z" stroke="${S}"/>` +
      `<path d="M8 10.9c-1 3-1 7.2 0 10.2M16 9.5v3.9M16 18.4v4.1M24 10.9c1 3 1 7.2 0 10.2" stroke="${Y}" opacity=".7"/>`,
    // mesh-smooth: the sharp body gone round
    'mesh-smooth': `<path d="M5 12l8-7 9 2 5 8-3 9-9 3-8-5z" stroke="${S}" opacity=".4"/>` +
      `<circle cx="15.5" cy="16.5" r="10" stroke="${U}"/>`,
    'smooth-more': `<path d="M5 24l6-9 5 3 6-8 5 4" stroke="${S}" opacity=".4"/>` +
      `<path d="M5 24c6-9 12-13 22-10" stroke="${U}"/>` +
      `<path d="M23 6h6M26 3v6" stroke="${G}"/>`,
    'smooth-less': `<path d="M5 24c6-9 12-13 22-10" stroke="${S}" opacity=".4"/>` +
      `<path d="M5 24l6-9 5 3 6-8 5 4" stroke="${U}"/>` +
      `<path d="M23 6h6" stroke="${R}"/>`,
    'mesh-refine': `<rect x="5" y="5" width="22" height="22" stroke="${S}"/>` +
      `<path d="M16 5v22M5 16h22" stroke="${S}" opacity=".6"/>` +
      `<path d="M10.5 16v11M5 21.5h11M16 10.5h11M21.5 5v11" stroke="${Y}" opacity=".8"/>`,
    'add-crease': `<path d="M4 24L16 10l12 14" stroke="${S}"/>` +
      `<path d="M16 10v14" stroke="${Y}"/>` +
      `<path d="M23 4h6M26 1v6" stroke="${G}"/>`,
    'remove-crease': `<path d="M4 24c8-10 16-10 24 0" stroke="${S}"/>` +
      `<path d="M16 12.5V24" stroke="${Y}" stroke-dasharray="2.5 2" opacity=".6"/>` +
      `<path d="M23 4h6" stroke="${R}"/>`,
    'mesh-extrude-face': `${CUBE}` +
      `<path d="M16 6.2l6.6 3.3-6.6 3.3-6.6-3.3z" stroke="${U}"/>` +
      `<path d="M16 9.5V1.5" stroke="${G}"/><path d="M13.5 3.5L16 .8l2.5 2.7" stroke="${G}"/>`,
    'split-face': `<path d="M5 10l11-5 11 5-11 5z" stroke="${S}"/>` +
      `<path d="M5 10v10l11 5v-10M27 10v10l-11 5" stroke="${S}" opacity=".45"/>` +
      `<path d="M10.5 7.5l11 5" stroke="${R}" stroke-dasharray="3 2"/>`,
    'merge-face': `<path d="M5 10l11-5 11 5-11 5z" stroke="${S}"/>` +
      `<path d="M5 10v10l11 5v-10M27 10v10l-11 5" stroke="${S}" opacity=".45"/>` +
      `<path d="M12 6l4 6.5L20 6" stroke="${G}"/>`,
    'close-hole': `<path d="M5 12l11-5.5L27 12l-11 5.5z" stroke="${S}"/>` +
      `<path d="M5 12v8l11 5.5V17.5M27 12v8l-11 5.5" stroke="${S}" opacity=".45"/>` +
      `<ellipse cx="16" cy="12" rx="4.5" ry="2.2" stroke="${R}" stroke-dasharray="2.5 2"/>` +
      `<path d="M12 4l4 4 6-6" stroke="${G}"/>`,
    // collapse-face: the face's corners drawn into its centre
    'collapse-face': `<path d="M5 12l11-5 11 5-11 5z" stroke="${S}" opacity=".5"/>` +
      `<path d="M5 12v9l11 5v-9M27 12v9l-11 5" stroke="${S}" opacity=".35"/>` +
      `<circle cx="16" cy="12" r="1.8" fill="${R}" stroke="none"/>` +
      `<path d="M8 10.6l5.2 1M24 10.6l-5.2 1M16 8.2v1.6M16 15.8v-1.6" stroke="${U}"/>` +
      `<path d="M8 10.6l2-.9M8 10.6l2.1.5M24 10.6l-2-.9M24 10.6l-2.1.5" stroke="${U}" opacity=".8"/>`,
    // spin-face: two triangles trading their shared edge
    'spin-face': `<path d="M5 22L16 6l11 16z" stroke="${S}" opacity=".5"/>` +
      `<path d="M16 6L5 22M16 6l11 16" stroke="${S}" opacity=".5"/>` +
      `<path d="M16 6v16" stroke="${Y}" stroke-dasharray="2.5 2" opacity=".7"/>` +
      `<path d="M5 22h22" stroke="${U}"/>` +
      `<path d="M23 12a9 9 0 0 1-2.5 6" stroke="${G}"/><path d="M20.5 18l-.4-2.8 2.9.6" stroke="${G}"/>`,
    'conv-solid': `<path d="M4 13.5c0-2 2.5-3.5 5.5-3.5s5.5 1.5 5.5 3.5-2.5 3.5-5.5 3.5S4 15.5 4 13.5z" stroke="${S}" opacity=".6"/>` +
      `<path d="M14 20h5" stroke="${G}"/><path d="M17 17.5l2.5 2.5-2.5 2.5" stroke="${G}"/>` +
      `<path d="M22 12l5 2.5v6L22 23l-5-2.5v-6z" stroke="${U}"/>` +
      `<path d="M17 14.5l5 2.5 5-2.5M22 17v6" stroke="${U}" opacity=".7"/>`,
    'conv-surface': `<path d="M4 12l5-2.5 5 2.5-5 2.5z" stroke="${S}" opacity=".6"/>` +
      `<path d="M14 20h5" stroke="${G}"/><path d="M17 17.5l2.5 2.5-2.5 2.5" stroke="${G}"/>` +
      `<path d="M17 25l5-6h6l-5 6z" stroke="${U}"/>`,
    'mesh-smooth-opt': `<path d="M5 24l5-12 6 4 6-10 5 6" stroke="${S}" opacity=".4"/>` +
      `<path d="M5 24c5-10 12-16 22-12" stroke="${U}"/>` +
      `<circle cx="27" cy="12" r="2" fill="${G}" stroke="none"/>`,

    /* ---- the UCS dialog's list rows ---- */
    // ucs-world: the axes standing on the globe
    'ucs-world': `<circle cx="11" cy="21" r="7" stroke="${U}"/>` +
      `<ellipse cx="11" cy="21" rx="7" ry="2.6" stroke="${U}" opacity=".6"/>` +
      `<path d="M11 21V6M11 21l14-4M11 21l9 8" stroke="${S}"/>` +
      `<path d="M9 8.5L11 6l2 2.5M22.5 15.2l2.5 1.8-3 .9" stroke="${S}"/>`,
    // extract-intersections: two sheets crossing, their meeting line lifted
    'extract-intersections': `<path d="M4 21l8-12h12l-8 12z" stroke="${S}" opacity=".55"/>` +
      `<path d="M9 6l7 10 7 10" stroke="${S}" opacity=".55"/><path d="M9 6h12M16 16h9l3 10H12z" stroke="${S}" opacity=".35"/>` +
      `<path d="M12 15.5L20 14" stroke="${R}"/>` +
      `<path d="M23 8l4-4M27 4l-3.6.4M27 4l-.4 3.6" stroke="${U}"/>`,
    // flatshot: the body pressed flat onto the plan below it
    'flatshot': `<path d="M16 3l8 4v7l-8 4-8-4V7z" stroke="${S}" opacity=".5"/>` +
      `<path d="M16 11l-6 8M16 11l6 8M8 12v3M24 12v3" stroke="${U}" stroke-dasharray="2.5 2" opacity=".7"/>` +
      `<path d="M4 25l6-5h12l6 5z" stroke="${Y}"/>` +
      `<path d="M10 22.5h12M8 24h16" stroke="${Y}" opacity=".55"/>`,
    // ucs-face-*: the cube, the named face tinted
    'ucs-face-top': `${CUBE}<path d="M16 6.2l6.6 3.3-6.6 3.3-6.6-3.3z" stroke="${U}" fill="${U}" fill-opacity=".25"/>`,
    'ucs-face-bottom': `${CUBE}<path d="M16 27l-8-4 8-4 8 4z" stroke="${U}" fill="${U}" fill-opacity=".25"/>`,
    'ucs-face-front': `${CUBE}<path d="M7 11.5v8l7 3.5v-8z" stroke="${U}" fill="${U}" fill-opacity=".25"/>`,
    'ucs-face-back': `${CUBE}<path d="M7 11.5v8l7 3.5v-8z" stroke="${U}" stroke-dasharray="2.5 2" fill="${U}" fill-opacity=".12"/>`,
    'ucs-face-right': `${CUBE}<path d="M25 11.5v8l-7 3.5v-8z" stroke="${U}" fill="${U}" fill-opacity=".25"/>`,
    'ucs-face-left': `${CUBE}<path d="M25 11.5v8l-7 3.5v-8z" stroke="${U}" stroke-dasharray="2.5 2" fill="${U}" fill-opacity=".12"/>`,
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
