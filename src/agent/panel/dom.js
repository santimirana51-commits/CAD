/** src/agent/panel/dom.js — extracted from agent-panel.js:969 (DOM + composer + menu)
 *  Dynamic: no direct DOM work at import time; build() called on boot.
 *  All deps are explicit imports — no closure over legacy `st`.
 */
import { el } from '@shared/utils/helpers.js';
import { icon } from '@ui/icons/agent-icons.js';
import { MAX_ROWS } from '@shared/config/tunables.js';

let root = null;
let thread = null;
let input = null;
let chips = null;
let sendBtn = null;
let modelEl = null;
let fileEl = null;
let keysEl = null;
let creditEl = null;
let menuEl = null;

export function getRefs() {
  return { root, thread, input, chips, sendBtn, modelEl, fileEl, keysEl, creditEl, menuEl };
}

export function build({ st, API, openHistory, startPicker, openMenu, openModelMenu, toggleKeys, setModel, byokAPI, openKeys, renderEmpty, renderChips } = {}) {
  root = document.getElementById('agent-panel');
  if (!root) {
    root = el('aside', 'hidden');
    root.id = 'agent-panel';
    const ws = document.getElementById('workspace');
    if (ws) ws.appendChild(root);
    else document.body.appendChild(root);
  }
  root.innerHTML =
    '<header class="ag-head">' +
    '<span class="ag-head-sp"></span>' +
    '<button class="ag-ghost" id="ag-new" title="New chat">' + icon('ai-new') + '</button>' +
    '<button class="ag-ghost" id="ag-history" title="History">' + icon('ai-history') + '</button>' +
    '<button class="ag-ghost" id="ag-keys-btn" title="Agent settings — model and keys">' + icon('ai-gear') + '</button>' +
    '<button class="ag-ghost" id="ag-more" title="More">' + icon('ai-more') + '</button>' +
    '<button class="ag-ghost" id="ag-collapse" title="Collapse panel">' + icon('ai-collapse') + '</button>' +
    '</header>' +
    '<div class="ag-thread" id="ag-thread"></div>' +
    '<div class="ag-composer">' +
    '<div class="ag-chips" id="ag-chips"></div>' +
    '<div class="ag-box">' +
    '<textarea id="ag-input" rows="1" spellcheck="false" placeholder="Plan, describe a drawing, / for presets"></textarea>' +
    '<div class="ag-bar">' +
    '<button class="ag-pill" id="ag-mode" title="Mode">' + icon('ai-inf', 13) + '<span>Agent</span>' + icon('ai-chev', 12) + '</button>' +
    '<button class="ag-model" id="ag-model" title="Model — click to change"><span class="ag-model-ico" id="ag-model-ico">' + icon('ai-lock', 11) + '</span><span id="ag-model-name"></span>' + icon('ai-chev', 10) + '</button>' +
    '<button class="ag-model ag-credit hidden" id="ag-credit" title="Your balance — click to add credit">' + icon('ai-coin', 11) + '<span id="ag-credit-amt"></span></button>' +
    '<span class="ag-bar-sp"></span>' +
    '<button class="ag-ghost ag-sm" id="ag-pick" title="Pick an element to edit" aria-label="Pick an element to edit" aria-pressed="false">' + icon('ai-pick') + '</button>' +
    '<button class="ag-ghost ag-sm" id="ag-attach" title="Attach a reference — your own plan or sketch">' + icon('ai-attach') + '</button>' +
    '<input type="file" id="ag-file" accept="image/*" hidden>' +
    '<button class="ag-send" id="ag-send" title="Send (Enter)">' + icon('ai-send') + '</button>' +
    '</div></div></div><div class="ag-keys hidden" id="ag-keys"></div>';

  thread = root.querySelector('#ag-thread');
  input = root.querySelector('#ag-input');
  chips = root.querySelector('#ag-chips');
  sendBtn = root.querySelector('#ag-send');
  modelEl = root.querySelector('#ag-model-name');
  keysEl = root.querySelector('#ag-keys');
  creditEl = root.querySelector('#ag-credit');
  if (creditEl) creditEl.addEventListener('click', () => openSite(st?.account?.unlimitedAi ? '/account' : '/pricing#lifetime'));

  root.querySelector('#ag-new')?.addEventListener('click', () => API?.reset());
  root.querySelector('#ag-collapse')?.addEventListener('click', () => API?.close());
  root.querySelector('#ag-keys-btn')?.addEventListener('click', () => toggleKeys?.());
  fileEl = root.querySelector('#ag-file');
  root.querySelector('#ag-attach')?.addEventListener('click', () => {
    if (fileEl) {
      fileEl.value = '';
      fileEl.click();
    }
  });
  if (fileEl) fileEl.addEventListener('change', () => {
    const f = fileEl.files && fileEl.files[0];
    if (f) API?.attachImage(f);
  });
  root.querySelector('#ag-history')?.addEventListener('click', openHistory);
  root.querySelector('#ag-pick')?.addEventListener('click', startPicker);
  root.querySelector('#ag-more')?.addEventListener('click', (e) => openMenu?.(e.currentTarget, [
    { label: 'Clear conversation', run: () => API?.reset() },
    { label: 'Copy transcript', run: () => copyTranscript(st) },
    { label: 'Agent settings…', run: () => openKeys?.() }
  ]));
  root.querySelector('#ag-mode')?.addEventListener('click', (e) => openMenu?.(e.currentTarget, [{ label: 'Agent', checked: true }]));
  root.querySelector('#ag-model')?.addEventListener('click', (e) => openModelMenu?.(e.currentTarget));
  sendBtn?.addEventListener('click', () => {
    if (st?.running) API?.stop();
    else API?.send();
  });

  // input auto-grow + mentions + enter
  if (input) {
    input.addEventListener('input', () => {
      grow(input);
      // dynamic import to avoid cycle — mentions loaded on demand
      import('./mentions.js').then((m) => m.openMentionMenu?.()).catch(() => {});
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && chips?.children.length) {
        e.preventDefault();
        chips.lastElementChild?.querySelector('button')?.click();
      }
    });
    if (menuEl?.handleKey) input.addEventListener('keydown', (e) => menuEl.handleKey(e), true);
    else input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        API?.send();
      }
    });
  }

  setModel?.(null);
  const boot = byokAPI?.();
  if (boot) {
    boot.get().then((r) => {
      if (st) {
        st.byok = r || null;
        if (r?.provider) st.provider = r.provider;
        if (r?.model && !r.web) setModel?.(r.model);
      }
    }, () => {});
  }
  renderEmpty?.();
  renderChips?.();
  return getRefs();
}

export function grow(inputEl = input) {
  if (!inputEl) return;
  const line = parseFloat(getComputedStyle(inputEl).lineHeight) || 20;
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, Math.round(line * MAX_ROWS)) + 'px';
}

export function closeMenu() {
  if (input) {
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
}

export function openMenu(anchor, items) {
  closeMenu();
  const list = items?.length ? items : [{ label: 'Nothing yet', disabled: true }];
  const m = el('div', 'ag-menu');
  for (const it of list) {
    const b = el('button', 'ag-menu-item' + (it.checked ? ' on' : ''), it.label);
    if (it.disabled) b.disabled = true;
    else b.addEventListener('click', () => { closeMenu(); it.run?.(); });
    m.appendChild(b);
  }
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const box = m.getBoundingClientRect();
  const w = box.width, h = box.height;
  m.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8))) + 'px';
  const below = r.bottom + 4;
  const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, r.top - 4 - h);
  m.style.top = Math.round(top) + 'px';
  menuEl = m;
}

function copyTranscript(st) {
  const text = (st?.messages || []).map((m) => m.role.toUpperCase() + ': ' + m.text).join('\n\n');
  navigator.clipboard?.writeText(text).then(() => window.Nasj?.toast?.('Transcript copied.'), () => window.Nasj?.toast?.('The transcript could not be copied.'));
}

function openSite(path) {
  if (window.nasjAPI?.openExternal) window.nasjAPI.openExternal('https://nasji.com' + path);
  else window.open('https://nasji.com' + path, '_blank');
}

export default { build, getRefs, grow, openMenu, closeMenu };
