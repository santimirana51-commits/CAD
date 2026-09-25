/** src/agent/panel/Panel.js — orchestrator (dynamic)
 *  Replaces the 4539-line IIFE closure with explicit module wiring.
 *  Imported via entry.js -> dynamic import, so legacy agent-panel.js can coexist.
 */
import { st } from './state.js';
import * as Dom from './dom.js';
import { registerAgentIcons } from '@ui/icons/agent-icons.js';

export class Panel {
  constructor({ nasj = window.Nasj } = {}) {
    this.nasj = nasj;
    this.st = st;
    this.mounted = false;
  }

  mount() {
    if (this.mounted) return;
    registerAgentIcons();
    // Dom.build expects API + helpers — wire lazily to avoid cycles
    Dom.build({
      st: this.st,
      API: window.NasjAgent || this,
      openHistory: () => import('./mentions.js').then((m) => m.openHistory?.()),
      startPicker: () => import('./mentions.js').then((m) => m.createPicker({ st: this.st }).startPicker()),
      openMenu: Dom.openMenu,
      openModelMenu: () => {},
      toggleKeys: () => {},
      setModel: () => {},
      byokAPI: () => null,
      openKeys: () => {},
      renderEmpty: () => {},
      renderChips: () => {}
    });
    this.mounted = true;
  }

  open() {
    this.mount();
    const root = document.getElementById('agent-panel');
    if (root) root.classList.remove('hidden');
    this.st.open = true;
    window.dispatchEvent(new CustomEvent('nasj:agent', { detail: { open: true } }));
  }

  close() {
    const root = document.getElementById('agent-panel');
    if (root) root.classList.add('hidden');
    this.st.open = false;
    window.dispatchEvent(new CustomEvent('nasj:agent', { detail: { open: false } }));
  }

  toggle() {
    if (this.st.open) this.close();
    else this.open();
  }
}

export const panel = new Panel();
export default panel;
