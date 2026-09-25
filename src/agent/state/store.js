/** Minimal reactive store to replace monolithic `st` object in agent-panel.js:924
 *  Subscribers get notified; persistence is opt-in.
 */
export function createStore(initial = {}) {
  let state = { ...initial };
  const subs = new Set();
  return {
    get() {
      return state;
    },
    set(patch) {
      state = { ...state, ...patch };
      subs.forEach((fn) => fn(state));
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    }
  };
}

// Default agent store shape (mirrors agent-panel.js:924)
export const agentStore = createStore({
  open: false,
  running: false,
  model: null,
  provider: 'deepseek',
  attachment: null,
  reference: null,
  region: null,
  messages: [],
  blocks: [],
  tools: []
});
