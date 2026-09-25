/** src/core/shell/app.js — ES module facade for legacy app.js (1.4M)
 *  Legacy app.js is plain script that attaches Nasj.boot(); this module
 *  re-exports it dynamically so new code can `import { boot } from '@core/shell/app.js'`
 *  without paying 1.4M at initial load.
 */

export async function loadApp() {
  if (window.Nasj?.boot) return window.Nasj;
  await import('../../legacy/app.js');
  return window.Nasj;
}

export async function boot(...args) {
  const N = await loadApp();
  if (typeof N.boot === 'function') return N.boot(...args);
  return null;
}

export default { loadApp, boot };
