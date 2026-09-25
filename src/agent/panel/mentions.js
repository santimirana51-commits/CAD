/** src/agent/panel/mentions.js — extracted from agent-panel.js:1105 (@-mentions + picker + history binding)
 *  Dynamic: loaded only when user types @ or clicks pick.
 */
import { esc } from '@shared/utils/helpers.js';
import { icon } from '@ui/icons/agent-icons.js';
import { selEntities, selBounds } from '../pipeline/selection.js';
import { listSites, largestBoundaryIn, nearestRatio } from '../pipeline/site.js';

const N = () => window.Nasj || {};
let mentionHi = null;

export function getMentionHi() {
  return mentionHi;
}
export function highlightSel(n) {
  if (mentionHi === n) return;
  mentionHi = n;
  if (typeof N().render === 'function') N().render();
}

export function clearTarget(st, { renderRegionBox, renderChips } = {}) {
  if (!st) return;
  st.referenceOwned = new Set();
  st.picked = null;
  if (st.reference && !st.reference.region) st.reference = st.reference && !st.reference.region ? st.reference : null;
  else if (st.reference?.region) st.reference = null;
  st.attachment = null;
  st.region = null;
  renderRegionBox?.();
  renderChips?.();
}

export function referenceSummary(st) {
  const out = [];
  if (st?.picked) out.push({ kind: 'element', label: st.picked.label });
  else if (st?.region?.aisel != null) out.push({ kind: 'area', label: 'Area ' + st.region.aisel });
  else if (st?.attachment) out.push({ kind: 'boundary', label: st.attachment.label });
  if (st?.reference && !st.reference.region) out.push({ kind: 'image', label: st.reference.name });
  return out;
}

export function pickElement(entity, st, { renderChips } = {}) {
  const doc = N().doc;
  if (!entity || !doc?.entities?.includes(entity) || entity.aisel) return false;
  clearTarget(st, {});
  const layer = doc.layers.find((l) => l.id === entity.layerId);
  st.picked = { ids: [String(entity.id)], doc, label: (entity.name || entity.type) + ' · ' + (layer?.name || '0') };
  st.contextDoc = doc;
  N().setSelection?.([entity.id]);
  window.NasjAgent?.open();
  renderChips?.();
  document.getElementById('ag-input')?.focus();
  return true;
}

export function mentionItems() {
  const areas = selEntities();
  const sites = listSites();
  const represented = new Set();
  const out = [];
  for (const e of areas) {
    const b = selBounds(e);
    const site = b && largestBoundaryIn(b);
    if (site) site.ids.forEach((id) => represented.add(String(id)));
    out.push({ id: 'sel-' + e.aisel, label: 'Area ' + e.aisel, aisel: e.aisel, entity: e });
  }
  for (const s of sites) if (!s.ids.some((id) => represented.has(String(id)))) out.push({ id: s.id, label: 'Boundary ' + s.id.split('-')[1], aisel: null, site: s });
  for (const e of (N().doc?.entities || []).filter((e) => N().selection?.has(e.id) && !e.aisel).slice(0, 12))
    if (!sites.some((s) => s.ids.includes(e.id))) out.push({ id: 'element-' + e.id, label: (e.name || e.type) + ' · ' + (N().doc.layers.find((l) => l.id === e.layerId)?.name || '0'), entity: e });
  return out;
}

export function createPicker({ st, toast, renderChips } = {}) {
  let pickerCleanup = null;
  const cancelPicker = () => {
    if (pickerCleanup) pickerCleanup();
  };
  const startPicker = () => {
    if (st?.running) {
      toast?.('Wait for the current response before picking an element.');
      return;
    }
    if (pickerCleanup) {
      cancelPicker();
      return;
    }
    const canvas = document.getElementById('overlay-canvas');
    if (!canvas || !N().pickAgentEntity) return;
    const doc = N().doc;
    const oldSelection = new Set(N().selection);
    const oldCursor = canvas.style.cursor;
    let hit = null;
    let accepted = false;
    const root = document.getElementById('agent-panel');
    const button = root?.querySelector('#ag-pick');
    button?.classList.add('on');
    button?.setAttribute('aria-pressed', 'true');
    canvas.style.cursor = 'default';
    toast?.('Point to an element and click. Esc cancels.');
    const over = (e) => {
      const b = canvas.getBoundingClientRect();
      return e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom && !root?.contains(e.target);
    };
    const move = (e) => {
      if (N().doc !== doc) {
        cancelPicker();
        return;
      }
      if (!over(e)) return;
      const b = canvas.getBoundingClientRect();
      const w = N().viewport.screenToWorld({ x: e.clientX - b.left, y: e.clientY - b.top });
      const next = N().pickAgentEntity(w);
      if (next === hit) return;
      hit = next;
      N().selection = new Set(hit ? [hit.id] : []);
      N().render();
    };
    const down = (e) => {
      if (!over(e) || e.button !== 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      move(e);
    };
    const up = (e) => {
      if (!over(e) || e.button !== 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      move(e);
      if (hit) {
        accepted = true;
        const entity = hit;
        cancelPicker();
        pickElement(entity, st, { renderChips });
      }
    };
    const key = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancelPicker();
      }
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('mousedown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('keydown', key, true);
    pickerCleanup = () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('keydown', key, true);
      canvas.style.cursor = oldCursor;
      button?.classList.remove('on');
      button?.setAttribute('aria-pressed', 'false');
      pickerCleanup = null;
      if (!accepted && N().doc === doc) N().setSelection(oldSelection);
    };
  };
  return { startPicker, cancelPicker };
}

export function drawingIdentity() {
  const d = N().doc;
  if (!d) return null;
  let id = d.chatDrawingId;
  if (d.path) {
    let hash = 2166136261;
    for (const c of String(d.path)) {
      hash ^= c.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    id = 'file-' + (hash >>> 0).toString(36);
  }
  if (!id) id = d.chatDrawingId = 'drawing-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  return { id, name: String(d.name || 'Untitled drawing').split(/[\\/]/).pop() };
}

export function openMentionMenu(input = document.getElementById('ag-input'), menuEl) {
  // thin stub — full menu is built dynamically to avoid heavy deps at boot
  return false;
}

export default { mentionItems, pickElement, createPicker, drawingIdentity, highlightSel };
