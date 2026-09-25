/** src/agent/panel/byok.js — extracted from agent-panel.js:1271 (BYOK slide-over)
 *  Dynamic: only loaded when user opens Agent settings.
 */
export const PROVIDER_LIST = Object.freeze([
  { id: 'deepseek', label: 'DeepSeek', vendor: 'DeepSeek', ph: 'sk-…', keyField: 'DEEPSEEK_API_KEY', modelField: 'DEEPSEEK_MODEL', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'gemini', label: 'Gemini', vendor: 'Google AI', ph: 'AIzaSy…', keyField: 'GEMINI_API_KEY', modelField: 'GEMINI_MODEL', models: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'] },
  { id: 'openrouter', label: 'OpenRouter', vendor: 'OpenRouter', ph: 'sk-or-…', keyField: 'OPENROUTER_API_KEY', modelField: 'OPENROUTER_MODEL', models: ['deepseek/deepseek-chat', 'google/gemini-2.0-flash-001'] },
  { id: 'custom', label: 'Custom', vendor: 'OpenAI-compatible', ph: 'sk-…', keyField: 'CUSTOM_API_KEY', modelField: 'CUSTOM_MODEL', models: [] }
]);

export const providerOf = (id) => PROVIDER_LIST.find((p) => p.id === id) || PROVIDER_LIST[0];

export function byokAPI(stub) {
  const a = stub && typeof stub.byokGet === 'function' ? stub : window.nasjAPI || {};
  return typeof a.byokGet === 'function' && typeof a.byokSet === 'function' ? { get: a.byokGet.bind(a), set: a.byokSet.bind(a) } : null;
}

export default { PROVIDER_LIST, providerOf, byokAPI };
