/** Extracted from agent-panel.js:18 — AI_ICONS + NasjIcons monkey-patch (pure) */

const S = '#dfe3e7';
const U = '#3fa9e0';
const G = '#5fbf5f';

export const AI_ICONS = Object.freeze({
  'ai-assistant': `<path d="M5.5 4.5h14l7 7v16h-21z" stroke="${S}"/><path d="M19.5 4.5v7h7" stroke="${S}"/><path d="M9.5 22.5l9.6-9.6 2.6 2.6-9.6 9.6-3.4.8z" stroke="${U}"/><path d="M9.5 15.5h5M9.5 11.5h6" stroke="${S}" opacity=".55"/><path d="M23.8 8.2l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z" stroke="${G}"/>`,
  'ai-pick': `<path d="M7 4l19 14-9 1-4 9z" stroke="currentColor"/>`,
  'ai-new': `<path d="M16 7v18M7 16h18" stroke="currentColor"/>`,
  'ai-history': `<circle cx="16" cy="16" r="11" stroke="currentColor"/><path d="M16 9.5V16l4.6 2.8" stroke="currentColor"/>`,
  'ai-more': `<circle cx="8" cy="16" r="1.7" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.7" fill="currentColor" stroke="none"/><circle cx="24" cy="16" r="1.7" fill="currentColor" stroke="none"/>`,
  'ai-collapse': `<rect x="4.5" y="6.5" width="23" height="19" rx="2.5" stroke="currentColor"/><path d="M20 6.5v19" stroke="currentColor"/>`,
  'ai-close': `<path d="M8 8l16 16M24 8L8 24" stroke="currentColor"/>`,
  'ai-chev': `<path d="M12 10l8 6-8 6" stroke="currentColor"/>`,
  'ai-check': `<path d="M7.5 16.5l5.5 5.5 11.5-12" stroke="currentColor"/>`,
  'ai-lock': `<rect x="8.5" y="14.5" width="15" height="11" rx="2" stroke="currentColor"/><path d="M11.8 14.5v-3.2a4.2 4.2 0 0 1 8.4 0v3.2" stroke="currentColor"/>`,
  'ai-inf': `<path d="M16 16c2.2-3 3.6-4.5 6-4.5a4.5 4.5 0 0 1 0 9c-2.4 0-3.8-1.5-6-4.5s-3.6-4.5-6-4.5a4.5 4.5 0 0 0 0 9c2.4 0 3.8-1.5 6-4.5z" stroke="currentColor"/>`,
  'ai-attach': `<path d="M23 10.5l-9.9 9.9a3.6 3.6 0 0 0 5.1 5.1l10.4-10.4a6 6 0 0 0-8.5-8.5L9.2 17.5a8.4 8.4 0 0 0 11.9 11.9L29 21.5" stroke="currentColor"/>`,
  'ai-send': `<path d="M16 25V8M9 15l7-7 7 7" stroke="currentColor"/>`,
  'ai-stop': `<rect x="11" y="11" width="10" height="10" rx="1.5" stroke="currentColor"/>`,
  'ai-image': `<rect x="4.5" y="6.5" width="23" height="19" rx="2" stroke="currentColor"/><circle cx="11.5" cy="13" r="2" stroke="currentColor"/><path d="M5 21.5l6.5-6 5 4.5 4.5-4 6 5.5" stroke="currentColor"/>`,
  'ai-vector': `<path d="M6.5 22.5c4-1 6-4 7.5-8s3.5-7 7-8" stroke="currentColor"/><rect x="3.5" y="21.5" width="5" height="5" rx="1" stroke="currentColor"/><rect x="23.5" y="3.5" width="5" height="5" rx="1" stroke="currentColor"/>`,
  'ai-gear': `<circle cx="16" cy="16" r="4.2" stroke="currentColor"/><path d="M16 4.5v4M16 23.5v4M4.5 16h4M23.5 16h4M7.9 7.9l2.8 2.8M21.3 21.3l2.8 2.8M24.1 7.9l-2.8 2.8M10.7 21.3l-2.8 2.8" stroke="currentColor"/>`,
  'ai-back': `<path d="M19 8l-8 8 8 8" stroke="currentColor"/>`,
  'ai-key': `<circle cx="9.5" cy="16" r="4.5" stroke="currentColor"/><path d="M14 16h13M22.5 16v4M27 16v3" stroke="currentColor"/>`,
  'ai-spark': `<path d="M16 5l2.6 8.4L27 16l-8.4 2.6L16 27l-2.6-8.4L5 16l8.4-2.6z" stroke="currentColor"/><path d="M25 5.5l.8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8z" stroke="currentColor" opacity=".7"/>`,
  'ai-coin': `<circle cx="16" cy="16" r="10.5" stroke="currentColor"/><path d="M16 9.5v13M19.5 12.5h-5a2.2 2.2 0 0 0 0 4.4h3a2.2 2.2 0 0 1 0 4.4h-5.5" stroke="currentColor"/>`,
  'ai-user': `<circle cx="16" cy="11.5" r="5" stroke="currentColor"/><path d="M6.5 27c1.6-5.2 5.1-7.8 9.5-7.8s7.9 2.6 9.5 7.8" stroke="currentColor"/>`,
  'ai-target': `<circle cx="16" cy="16" r="8.5" stroke="currentColor"/><circle cx="16" cy="16" r="2.2" stroke="currentColor"/><path d="M16 3.5v4.5M16 24v4.5M3.5 16h4.5M24 16h4.5" stroke="currentColor"/>`
});

const S_FALLBACK = S;

function wrap(inner, size) {
  const sw = size <= 16 ? 2 : 1.7;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/** Call once at boot — reproduces agent-panel.js:58 prev-fallback pattern, but idempotent */
export function registerAgentIcons() {
  const NI =
    window.NasjIcons ||
    (window.NasjIcons = {
      get: (_n, size = 32) =>
        wrap(`<rect x="4.5" y="4.5" width="23" height="23" rx="2" stroke="${S_FALLBACK}" stroke-dasharray="3 3" opacity=".6"/>`, size),
      names: []
    });
  const prev = NI.get;
  NI.get = (name, size = 32) =>
    Object.prototype.hasOwnProperty.call(AI_ICONS, name) ? wrap(AI_ICONS[name], size) : prev(name, size);
  const names = Array.from(NI.names || []);
  for (const n of Object.keys(AI_ICONS)) if (!names.includes(n)) names.push(n);
  NI.names = Object.freeze(names);
}

export const icon = (name, size) => window.NasjIcons.get(name, size || 16);
