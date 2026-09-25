/** Shared Nasj accessor — replaces direct window.Nasj globals.
 *  Keeps backward compat: getNasj() === window.Nasj
 */

export function getNasj() {
  return (window.Nasj = window.Nasj || {});
}

export function emit(name, detail) {
  const N = getNasj();
  if (typeof N.emit === 'function') {
    try {
      N.emit(name, detail);
      return;
    } catch (_) {}
  }
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on(name, handler) {
  window.addEventListener(name, handler);
  return () => window.removeEventListener(name, handler);
}
