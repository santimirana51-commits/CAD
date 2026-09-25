/** src/core/engine/engine.js — ES module facade for legacy engine.js (566k) */
export async function loadEngine() {
  if (window.Nasj?.viewport && window.Nasj?.settings) return window.Nasj;
  await import('../../legacy/engine.js');
  return window.Nasj;
}

export async function getViewport() {
  const N = await loadEngine();
  return N.viewport;
}

export async function getSettings() {
  const N = await loadEngine();
  return N.settings;
}

export default { loadEngine, getViewport, getSettings };
