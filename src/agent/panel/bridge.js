/** src/agent/panel/bridge.js — deprecated, use src/agent/bridge/nasj-api.js (dynamic) */
export * from '../bridge/nasj-api.js';
export { default } from '../bridge/nasj-api.js';
/*
/** Extracted from agent-panel.js:3557 — The bridge *\/

   * The bridge — stub first (QA), then window.nasjAPI
   * ================================================================== *\/
  const bridge = () => {
    const a = window.nasjAPI || {};
    const pick = (k) => (stub && typeof stub[k] === 'function') ? stub[k]
      : (typeof a[k] === 'function' ? a[k].bind(a) : null);
    return {
      agentSend: pick('agentSend'), agentStop: pick('agentStop'),
      agentHistory:pick('agentHistory'), agentLibrary:pick('agentLibrary'),
      agentReset: pick('agentReset'), agentToolResult: pick('agentToolResult'),
      onAgentEvent: pick('onAgentEvent'), onAgentToolExec: pick('onAgentToolExec'),
      aiImage: pick('aiImage'), aiRaster: pick('aiRaster'),
      onAiRasterChunk: pick('onAiRasterChunk')     /* PANEL-CONTRACT §2b, optional *\/
    };
  };

  let offEvent = null, offTool = null;
  const drop = (f) => { if (typeof f === 'function') { try { f(); } catch (_) { /* ignore *\/ } } };
  const subscribe = () => {
    drop(offEvent); offEvent = null;
    drop(offTool); offTool = null;
    const B = bridge();
    if (B.onAgentEvent) { try { offEvent = B.onAgentEvent(onAgentEvent); } catch (_) { offEvent = null; } }
    if (B.onAgentToolExec) { try { offTool = B.onAgentToolExec(onAgentToolExec); } catch (_) { offTool = null; } }
  };

  /* ================================================================== *

*/
