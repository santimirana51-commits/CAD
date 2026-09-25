/**
 * Dynamic tool registry — the core of "jadi dinamis".
 * Each tool is lazy-loaded via dynamic import() -> separate chunk.
 * Adding a new tool = 1 line here + 1 file, no edit to agent-panel.js.
 *
 * Usage:
 *   const { run } = await loadTool('cad_document');
 *   const out = await run(N, args, ctx);
 */

export const TOOL_DEFS = Object.freeze([
  { name: 'draw_cad', chunk: 'pipeline:draw', loader: () => import('../pipeline/draw.js') },
  { name: 'draw_plan', chunk: 'feature-plan', loader: () => import('@features/plan/run.js') },
  { name: 'cad_document', chunk: 'tool-cad-doc', loader: () => import('./cad-document.js') },
  { name: 'cad_workspace', chunk: 'tool-workspace', loader: () => import('./cad-workspace.js') },
  { name: 'cad_library', chunk: 'tool-library', loader: () => import('./cad-library.js') },
  { name: 'cad_coordinator', chunk: 'tool-coord', loader: () => import('./cad-coordinator.js') }
]);

const cache = new Map();

export async function loadTool(name) {
  const def = TOOL_DEFS.find((t) => t.name === name);
  if (!def) throw new Error(`Unknown tool: ${name}`);
  if (cache.has(name)) return cache.get(name);
  const mod = await def.loader();
  cache.set(name, mod);
  return mod;
}

export function hasTool(name) {
  return TOOL_DEFS.some((t) => t.name === name);
}

export function listTools() {
  return TOOL_DEFS.map((t) => t.name);
}
