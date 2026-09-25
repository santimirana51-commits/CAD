/** Extracted from agent-panel.js:80 — Tunables (single source of truth) */

export const VIEW_FIT = 0.80;
export const FRAME_PAD = 0.06;
export const FRAME_MIN = 0.35;
export const FRAME_MS = 420;
export const BOUND_FIT = 0.90;
export const ANIM_MIN = 3000;
export const ANIM_MAX = 6000;
export const ANIM_PER_PT = 6;
export const ANIM_BASE = 1200;
export const INK = '#dbeeff';
export const PEN = '#8fd6ff';
export const MAX_ROWS = 8;
export const EPS = 1e-9;
export const MODEL_FALLBACK = 'deepseek-flash';

export const NEUTRAL = Object.freeze({
  image: 'the drawing could not be produced.',
  clean: 'the drawing could not be prepared.',
  trace: 'the drawing could not be converted into strokes.',
  plan: 'the plan could not be drawn.'
});

// image pipeline
export const CLEAN_SIZE = 2048;
export const EDIT_PX = 1400;
export const SITE_MARGIN = 0.03;

// plot frame
export const PLOT_COVER = 0.5;
export const PLOT_COVER_ALONE = 0.15;
export const PLOT_SQUARE = 0.02;

// selection
export const SEL_LAYER = 'A-AI-SEL';
export const SEL_COLOR = '#3fa9e0';

export const PLAN_LAYERS = Object.freeze(['A-WALL', 'A-DOOR', 'A-GLAZ', 'A-FLOR-STRS', 'A-FURN', 'A-ANNO-TEXT', 'A-SKETCH', 'A-AI-SEL']);
export const MAX_SITES = 6;
export const SITE_LOOP_MAX = 1500;
export const LAND_TYPES = Object.freeze({ line: 1, arc: 1, circle: 1, polyline: 1, rectangle: 1 });

export const RATIOS = Object.freeze([
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['3:2', 3 / 2],
  ['2:3', 2 / 3],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16]
]);

export const SITE_CLAUSE =
  '\n\nYOU ARE GIVEN A REFERENCE IMAGE showing, to scale and filling the ' +
  'image, exactly what is already drawn in the working area. Every line ' +
  'in it is real. APPLY THE REQUEST ABOVE TO THIS PICTURE and output the ' +
  'same view, same scale, edge to edge: whatever the request does not ' +
  'change stays exactly where it is, line for line, and whatever the ' +
  'request removes or replaces must not appear again. If the request is ' +
  'to build on the land whose closed outline the image shows, FILL THIS ' +
  'LAND: the boundary is the outer edge of the plan, the outer walls run ' +
  'on the boundary line itself, and the whole enclosed area is used - ' +
  'every room shaped by the boundary it touches, so the land itself is ' +
  'what gets filled, corner to corner, whatever its shape - and the ' +
  'boundary line stays exactly where it is. Where nothing is drawn and ' +
  'nothing is asked for, the paper stays blank white.';
