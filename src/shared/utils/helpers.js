/** Extracted from agent-panel.js:109 — small helpers (pure, no DOM) */

export const num = (v) => typeof v === 'number' && isFinite(v);

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const errText = (e) => {
  if (e == null) return '';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message || String(e);
  return String(e.message != null ? e.message : e);
};

export const now = () => (window.performance || Date).now();

export const toast = (m) => {
  const N = window.Nasj;
  if (typeof N?.toast === 'function') N.toast(m);
};
