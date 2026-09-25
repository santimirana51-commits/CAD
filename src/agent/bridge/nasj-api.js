/** src/agent/bridge/nasj-api.js — extracted from agent-panel.js:3557 (The bridge)
 *  Stub-first then window.nasjAPI; dynamic so heavy IPC not in initial chunk.
 */

export function bridge(stub = null) {
  if (stub && typeof stub.agentSend === 'function') return stub;
  return window.nasjAPI || {};
}

export function hasAgentAPI(stub = null) {
  const b = bridge(stub);
  return typeof b.agentSend === 'function';
}

export async function agentSend(payload, stub = null) {
  const b = bridge(stub);
  if (typeof b.agentSend !== 'function') throw new Error('window.nasjAPI.agentSend is not available in this build.');
  return b.agentSend(payload);
}

export async function agentToolResult(id, result, stub = null) {
  const b = bridge(stub);
  if (typeof b.agentToolResult === 'function') return b.agentToolResult(id, result);
  return null;
}

export default { bridge, hasAgentAPI, agentSend, agentToolResult };
