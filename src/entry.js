/**
 * Dynamic entry — replaces 41 blocking <script> tags.
 * - Registers agent icons early (needed before ribbon builds on DOMContentLoaded)
 * - Lazy-loads heavy features on demand
 * - Keeps legacy globals (window.Nasj) working via shims
 */

import { registerAgentIcons } from '@ui/icons/agent-icons.js';
import { getNasj } from '@shared/lib/nasj.js';
import { st } from './agent/panel/state.js';

// 0) Web stub for Electron bridge, File IO, and Web BYOK Agent
const triggerDownload = (filename, blobOrText, mimeType = 'application/octet-stream') => {
  const blob = typeof blobOrText === 'string' ? new Blob([blobOrText], { type: mimeType }) : blobOrText;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

// Event listeners for Agent stream
const agentListeners = new Set();
let abortController = null;

const emitAgentEvent = (ev) => {
  for (const fn of agentListeners) {
    try { fn(ev); } catch (e) { console.error('[agent-event]', e); }
  }
};

const sendToDirectLLM = async (payload) => {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    console.warn('[BYOK] API key is stored in localStorage without encryption — use only on HTTPS.');
  }
  const raw = localStorage.getItem('pixelbay.byok') || localStorage.getItem('nasjicad.byok');
  let config = {};
  try { config = raw ? JSON.parse(raw) : {}; } catch (_) {}
  
  const provider = config.provider || config.AGENT_PROVIDER || 'deepseek';
  const apiKey = config.DEEPSEEK_API_KEY || config.OPENROUTER_API_KEY || config.CUSTOM_API_KEY || config.key || '';
  
  if (!apiKey) {
    emitAgentEvent({ type: 'error', error: 'API Key belum diisi. Masukkan API Key di pengaturan Agent atau via localStorage.' });
    return;
  }

  let endpoint = 'https://api.deepseek.com/chat/completions';
  let model = config.AGENT_MODEL || config.DEEPSEEK_MODEL || 'deepseek-chat';
  
  if (provider === 'openrouter') {
    endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    model = config.OPENROUTER_MODEL || 'deepseek/deepseek-chat';
  } else if (provider === 'custom' && config.AGENT_BASE_URL) {
    endpoint = config.AGENT_BASE_URL.replace(/\/+$/, '') + '/chat/completions';
    model = config.CUSTOM_MODEL || config.AGENT_MODEL || 'gpt-4o-mini';
  }

  abortController = new AbortController();
  emitAgentEvent({ type: 'think', text: 'Menghubungkan ke ' + provider + ' (' + model + ')…' });

  const messages = [
    {
      role: 'system',
      content: `You are pixelbay CAD AI Assistant. You help users create, inspect, modify, and optimize 2D/3D CAD geometry and architectural floor plans. Keep responses professional and concise.`
    },
    {
      role: 'user',
      content: payload.text || ''
    }
  ];

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'pixelbay CAD'
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true
      }),
      signal: abortController.signal
    });

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = `HTTP ${res.status}`;
      try { const j = JSON.parse(errText); errMsg = (j.error && j.error.message) || errMsg; } catch (_) {}
      emitAgentEvent({ type: 'error', error: `Gagal memanggil AI: ${errMsg}` });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.replace(/^data:\s*/, '');
        if (dataStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
          if (delta && delta.content) {
            emitAgentEvent({ type: 'delta', text: delta.content });
          }
          if (delta && delta.reasoning_content) {
            emitAgentEvent({ type: 'think', text: delta.reasoning_content });
          }
        } catch (_) {}
      }
    }

    emitAgentEvent({ type: 'done', byok: true });
  } catch (err) {
    if (err.name === 'AbortError') {
      emitAgentEvent({ type: 'done', byok: true });
    } else {
      emitAgentEvent({ type: 'error', error: err.message || 'Koneksi AI terputus.' });
    }
  } finally {
    abortController = null;
  }
};

if (!window.nasjAPI) {
  window.nasjAPI = {
    openExternal: (u) => window.open(u, '_blank'),
    openSite: (p) => window.open(p, '_blank'),
    minimize: () => {},
    toggleMaximize: () => {},
    close: () => window.close(),
    onMenuCommand: () => {},
    onCloseRequest: () => {},
    forceClose: () => {},
    onMaximizedChange: () => {},
    accountGet: () => Promise.resolve({ ok: true, balanceMicro: 0, model: { label: 'BYOK (Direct Web)', byok: true } }),
    accountSignIn: () => Promise.resolve({ ok: false, code: 'cancelled' }),
    byokGet: () => {
      try {
        const raw = localStorage.getItem('pixelbay.byok') || localStorage.getItem('nasjicad.byok');
        return Promise.resolve(raw ? JSON.parse(raw) : { active: false, provider: 'deepseek' });
      } catch {
        return Promise.resolve({ active: false, provider: 'deepseek' });
      }
    },
    byokSet: (patch) => {
      try {
        const raw = localStorage.getItem('pixelbay.byok') || localStorage.getItem('nasjicad.byok');
        const curr = raw ? JSON.parse(raw) : {};
        const updated = Object.assign(curr, patch, { active: patch.BYOK_ACTIVE === '1' || (patch.BYOK_ACTIVE === undefined && curr.active) });
        localStorage.setItem('pixelbay.byok', JSON.stringify(updated));
        return Promise.resolve(updated);
      } catch (e) {
        return Promise.resolve(null);
      }
    },

    // Browser Direct Agent stream
    agentSend: (payload) => {
      sendToDirectLLM(payload);
    },
    agentStop: () => {
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
    },
    agentReset: () => {
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
    },
    onAgentEvent: (cb) => {
      agentListeners.add(cb);
      return () => agentListeners.delete(cb);
    },
    onAgentToolExec: () => () => {},

    // Save support in browser
    saveDrawing: async (payload) => {
      try {
        let name = payload.suggestedName || (payload.path ? payload.path.replace(/^.*[\\/]/, '') : 'Drawing1.dwg');
        const content = payload.dxf || payload.njc || payload.json || '';
        if (payload.dxf && !/\.dxf$/i.test(name)) {
          name = name.replace(/\.[^.]+$/, '') + '.dxf';
        } else if (!/\.(dxf|njc|dwg)$/i.test(name)) {
          name = name + '.njc';
        }
        triggerDownload(name, content, 'application/octet-stream');
        return { ok: true, name, path: name };
      } catch (err) {
        console.error('[web-save] failed:', err);
        return false;
      }
    },

    // Open support in browser
    openDrawing: () => {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.dxf,.njc,.json,.dwg';
        input.onchange = async (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return resolve(null);
          const text = await file.text();
          const ext = (file.name.match(/\.([^.]+)$/) || [])[1] || '';
          resolve({
            ok: true,
            name: file.name,
            path: file.name,
            format: ext.toLowerCase() === 'dxf' ? 'dxf' : 'njc',
            json: text,
            dxf: ext.toLowerCase() === 'dxf' ? text : undefined,
          });
        };
        input.click();
      });
    },

    // Export PDF support in browser
    exportPdf: async (payload) => {
      if (payload && payload.dataUrl) {
        triggerDownload(payload.suggestedName || 'drawing.pdf', payload.dataUrl, 'application/pdf');
        return { ok: true };
      }
      return { ok: true };
    },

    // Export PNG support in browser
    exportPng: async (payload) => {
      if (payload && payload.dataUrl) {
        const url = String(payload.dataUrl);
        if (!url.startsWith('data:image/')) {
          console.warn('[exportPng] rejected non-image dataUrl');
          return { ok: false, error: 'invalid dataUrl' };
        }
        const res = await fetch(url);
        const blob = await res.blob();
        triggerDownload(payload.suggestedName || 'drawing.png', blob, 'image/png');
        return { ok: true };
      }
      return { ok: true };
    }
  };
}

// 1) Icons must be registered at parse time (agent-panel.js:18)
registerAgentIcons();

// 2) Ensure Nasj namespace exists
getNasj();

// 3) Legacy boot shim — load legacy scripts in correct order but via dynamic import
//    so Vite can code-split them. Critical path is small; heavy chunks are deferred.

let bootDone = false;

async function bootLegacy() {
  if (bootDone) return;
  bootDone = true;

  // 1) Compat shims for legacy globals
  try {
    await import('./agent/panel/compat.js');
  } catch (e) {
    console.warn('[entry] compat not loaded', e);
  }

  // 2) Load CAD core in legacy.html order (icons 1-4 already via <script> in index.html)
  const seq = [
    () => import('./legacy/engine.js'),
    () => import('./legacy/entities.js'),
    () => import('./legacy/cad-document.js'),
    () => import('./legacy/cad-workspace.js'),
    () => import('./legacy/cad-library.js'),
    () => import('./legacy/cad-coordination.js'),
    () => import('./legacy/app.js'),
    () => import('../commands.js'),
    () => import('../tools.js'),
  ];
  for (const fn of seq) {
    try { await fn(); } catch (e) { console.warn('[entry] legacy chunk not loaded', e); }
  }

  // 3) Boot CAD shell — needs skeleton already in index.html
  if (typeof window.Nasj?.boot === 'function') {
    try { window.Nasj.boot(); } catch (e) { console.error('[entry] Nasj.boot failed', e); }
  }

  // 4) Agent panel: legacy agent-panel.js already mounted via <script>
  //    If legacy not present (future fully-ESM), fall back to new Panel.js
  if (!window.NasjAgent) {
    try {
      const { panel } = await import('./agent/panel/Panel.js');
      panel.mount();
    } catch (e) { console.warn('[entry] panel mount failed', e); }
  }

  window.dispatchEvent(new CustomEvent('nasj:boot:dynamic', { detail: { ts: Date.now() } }));
}

// Auto-boot on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLegacy, { once: true });
} else {
  bootLegacy();
}

// 4) Public dynamic API — the "jadi dinamic" part
export const NasjDynamic = {
  /** Lazy-load any feature chunk */
  loadFeature(name) {
    const map = {
      plan: () => import('@features/plan/run.js'),
      dxf: () => import('@features/dxf/loader.js').catch(() => import('./legacy/dxf.js')),
      threed: () => import('@features/threed/loader.js'),
      engine: () => import('@core/engine/engine.js'),
      app: () => import('@core/shell/app.js')
    };
    const fn = map[name];
    if (!fn) return Promise.reject(new Error(`Unknown feature: ${name}`));
    return fn();
  },
  /** Lazy-load any agent tool */
  loadTool(name) {
    return import('@agent/tools/registry.js').then((m) => m.loadTool(name));
  },
  /** Lazy-load any panel piece (thread, geometry, animation) */
  loadPanel(part) {
    const map = {
      state: () => import('./agent/panel/state.js'),
      dom: () => import('./agent/panel/dom.js'),
      thread: () => import('./agent/panel/thread.js'),
      mentions: () => import('./agent/panel/mentions.js'),
      byok: () => import('./agent/panel/byok.js'),
      bridge: () => import('./agent/bridge/nasj-api.js'),
      panel: () => import('./agent/panel/Panel.js'),
      geometry: () => import('./agent/panel/geometry.js'),
      animation: () => import('./agent/panel/animation.js')
    };
    const fn = map[part];
    if (!fn) return Promise.reject(new Error(`Unknown panel part: ${part}`));
    return fn();
  },
  /** Register a new tool at runtime — true plugin system */
  async registerTool(def) {
    const { TOOL_DEFS } = await import('@agent/tools/registry.js');
    const custom = (window.__nasjCustomTools = window.__nasjCustomTools || []);
    custom.push(def);
    return def;
  },
  /** Direct access to dynamic state (replaces legacy `st` closure) */
  getState: () => st
};

window.NasjDynamic = NasjDynamic;

export default NasjDynamic;
