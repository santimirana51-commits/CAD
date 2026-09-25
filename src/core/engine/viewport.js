/** Re-export shim: engine viewport logic lives in legacy engine.js until fully ported.
 *  This module is the import point for new code — dynamic import will split it.
 *  When engine.js is ported, move logic here and legacy becomes wrapper.
 */
export async function loadEngine() {
  // legacy is already loaded via entry shim — just re-export window.Nasj.viewport
  if (window.Nasj?.viewport) return window.Nasj.viewport;
  // lazy load if not yet present
  await import('../engine-loader.js').catch(() => {});
  return window.Nasj?.viewport || null;
}
export default { loadEngine };
