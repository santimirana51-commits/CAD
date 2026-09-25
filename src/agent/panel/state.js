/** src/agent/panel/state.js — extracted from agent-panel.js:921 (dynamic) */
import { MODEL_FALLBACK } from '@shared/config/tunables.js';

export const initialState = {
  open: false,
  running: false,
  model: null,
  provider: 'deepseek',
  attachment: null,
  reference: null,
  region: null,
  warmup: null,
  outro: null,
  messages: [],
  convId: null,
  conversationDrawing: null,
  conversationTitle: '',
  historyReadOnly: false,
  picked: null,
  history: [],
  blocks: [],
  think: null,
  answer: null,
  turnText: '',
  tools: [],
  anim: null,
  clean: null,
  placement: null,
  applied: 0,
  appliedIds: [],
  stopped: false,
  lastRunMs: 0,
  lastError: null,
  lastToolResult: null,
  toolRun: null,
  usage: null,
  account: null,
  byok: null,
  wantOwn: false,
  // transient
  draftRaw: '',
  turnT0: 0,
  turnRounds: 0,
  turnDoc: null,
  turnPicked: null,
  turnScope: null,
  turnHadSite: false,
  sendEpoch: 0,
  contextDoc: null,
  referenceOwned: new Set(),
  rebound: false,
  boundDocument: null,
  sentText: ''
};

export let stub = null;
export let updateGate = null;

export function setStub(v) {
  stub = v;
}
export function setUpdateGate(v) {
  updateGate = v;
}
export function getUpdateGate() {
  return updateGate;
}
export function getStub() {
  return stub;
}

// Shared singleton (backward compat with legacy closure)
export const st = { ...initialState, referenceOwned: new Set() };

// re-export fallback for panel logic that still reads st directly
export default st;
export { MODEL_FALLBACK };
