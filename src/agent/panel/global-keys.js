/** src/agent/panel/global-keys.js — REAL ESM migrated from agent-panel.js:4495-4538 */
import { st } from './state.js';
const N = () => window.Nasj || {};
let keysOpen=false; let menuEl=null;
const closeKeys=()=>{}; const closeMenu=()=>{};

// --- BEGIN MIGRATED SLICE ---
  /* ================================================================== *
   * Global keys + main-process pipeline progress
   * ================================================================== */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (keysOpen && st.open) {
      e.preventDefault();
      e.stopPropagation();
      closeKeys();
      return;
    }
    if (menuEl) { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
    if (!st.anim && !st.running) return;
    e.preventDefault();
    e.stopPropagation();
    API.stop();
  }, true);

  build();
  subscribe();

  /* the site account, if there is one: read now, and again whenever the tab
     comes back — a sign-in or a top-up happens in another tab */
  refreshAccount();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !st.running) refreshAccount();
  });

  if (window.nasjAPI && typeof window.nasjAPI.onAiProgress === 'function') {
    try { window.nasjAPI.onAiProgress((p) => API._progress(p)); }
    catch (err) { console.warn('[agent-panel] onAiProgress unavailable:', err); }
  }

  /* THE PANEL IS PART OF THE ROOM. It stands open from the first launch —
     the agent is the product's front door, not a drawer. QA runs keep the
     classic closed start so every measured canvas keeps its width.
     On a screen too narrow to hold it beside the drawing (app.css lays it
     OVER the drawing there) it waits for its button instead: a door that
     opens onto the whole room is a wall. */
  const roomBeside = !window.matchMedia || window.matchMedia('(min-width: 1001px)').matches;
  if (!/[?&]qa=1(&|$)/.test(location.search) && roomBeside) {
    /* after the current parse tick, so the ribbon and workspace exist */
    setTimeout(() => { try { API.open(); } catch (_) { /* never fatal */ } }, 0);
  }
// --- END MIGRATED SLICE ---

export const migrated=true;
export default {};
