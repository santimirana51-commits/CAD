/** src/agent/panel/thread.js — REAL ESM migrated from agent-panel.js:1622-2088 */
import { st } from './state.js';
import { el, esc, now, clamp, errText } from '../../shared/utils/helpers.js';
import { icon } from '../../ui/icons/agent-icons.js';
import { MODEL_FALLBACK, VIEW_FIT, FRAME_PAD, FRAME_MIN, BOUND_FIT, INK, PEN, ANIM_MIN, ANIM_MAX, ANIM_PER_PT, ANIM_BASE, FRAME_MS, EPS } from '../../shared/config/tunables.js';
const N = () => window.Nasj || {};
// Provide globals that raw expects but are defined in other modules
let thread = null; const getThread = () => thread || (thread = document.getElementById('ag-thread'));
let input = null; const getInput = () => input || (input = document.getElementById('ag-input'));
let chips = null; let sendBtn=null; let modelEl=null; let creditEl=null; let root=null;
let stub=null; let updateGate=null;
const toast = (m) => window.Nasj?.toast?.(m);
const uiScrub = (s) => String(s||'').replace(/</g,'');
const grow = () => { const inp=getInput(); if(!inp) return; const line=parseFloat(getComputedStyle(inp).lineHeight)||20; inp.style.height='auto'; inp.style.height=Math.min(inp.scrollHeight, Math.round(line*8))+'px'; };
const API = window.NasjAgent || {};

// --- BEGIN MIGRATED SLICE ---
  /* ================================================================== *
   * Thread blocks
   * ================================================================== */
  const pinned = () => (thread.scrollHeight - thread.scrollTop - thread.clientHeight) < 24;
  const push = (node) => {
    const p = pinned();
    const e = thread.querySelector('.ag-empty');
    if (e) e.remove();
    thread.appendChild(node);
    if (p) thread.scrollTop = thread.scrollHeight;
    return node;
  };
  const keepPinned = () => { if (pinned()) thread.scrollTop = thread.scrollHeight; };

  // Token arrival must not trigger a full-text layout and scroll measurement
  // for every fragment. Coalesce paints and append only the new characters.
  const pendingStream = new Map();
  let streamPaintTimer = null;
  const flushStreamPaint = () => {
    if (streamPaintTimer !== null) clearTimeout(streamPaintTimer);
    streamPaintTimer = null;
    if (!pendingStream.size) return;
    const follow = pinned();
    for (const [node, text] of pendingStream) {
      if (!node.isConnected) continue;
      if (!node.firstChild) node.appendChild(document.createTextNode(text));
      else node.firstChild.appendData(text);
    }
    pendingStream.clear();
    if (follow) thread.scrollTop = thread.scrollHeight;
  };
  const queueStreamText = (node, text) => {
    pendingStream.set(node, (pendingStream.get(node) || '') + text);
    if (streamPaintTimer === null) streamPaintTimer = setTimeout(flushStreamPaint, 50);
  };

  /* what a first-time user can click instead of staring at a blank box */
  const PRESETS = [
    { label: 'Furnished villa plan',
      text: 'Draw the ground floor plan of a small villa, fully furnished.' },
    { label: 'Staircase section',
      text: 'Draw a cross-section through a two-storey staircase.' },
    { label: 'Street façade',
      text: 'Draw the front elevation of a three-bay, two-storey house.' },
    { label: 'Gate valve detail',
      text: 'Draw a sectional shop drawing of a gate valve.' }
  ];

  const renderEmpty = () => {
    thread.innerHTML = '';
    const hero = el('div', 'ag-empty',
      '<div class="ag-hero-ico"><img src="/logo.png" alt="pixelbay CAD" width="56" height="56"></div>' +
      '<p class="ag-empty-title">Draw it with words.</p>' +
      '<p class="ag-empty-sub">Describe what you need. Create a plan or detail, then ask for dimensions, furniture or edits in the same drawing.</p>' +
      '<div class="ag-presets"></div>');
    const box = hero.querySelector('.ag-presets');
    for (const p of PRESETS) {
      const b = el('button', 'ag-preset', esc(p.label));
      b.addEventListener('click', () => {
        if (!input) return;
        input.value = p.text;
        grow();
        input.focus();
      });
      box.appendChild(b);
    }
    thread.appendChild(hero);
  };

  const addMessage = (role, text, references=[]) => {
    st.messages.push({ role, text });
    const b = { type: role === 'user' ? 'user' : 'answer', text };
    b.node = push(renderSavedMessage({role,text,references}));
    st.blocks.push(b);
    return b;
  };

  /* ---- thinking, streamed ------------------------------------------ *
   * Dim monospace, collapsible, and auto-collapsed to a single
   * `Thought for Ns` line the moment the first answer fragment arrives —
   * the user watches it think and is not left scrolling past it after.  */
  const mkThink = () => {
    const t = {
      type: 'think', text: '', open: true, closed: false,
      startedAt: now(), ms: 0, label: 'Thinking'
    };
    const node = el('div', 'ag-think open');
    node.innerHTML =
      '<button class="ag-think-head">' +
        '<span class="ag-think-chev">' + icon('ai-chev', 12) + '</span>' +
        '<span class="ag-think-label">Thinking</span>' +
      '</button>' +
      '<div class="ag-think-body"></div>';
    t.node = node;
    t.labelEl = node.querySelector('.ag-think-label');
    t.bodyEl = node.querySelector('.ag-think-body');
    node.querySelector('.ag-think-head').addEventListener('click', () => setThinkOpen(t, !t.open));
    st.blocks.push(t);
    push(node);
    return t;
  };

  const setThinkOpen = (t, on) => {
    t.open = !!on;
    t.node.classList.toggle('open', t.open);
  };

  const closeThink = (t) => {
    if (!t || t.closed) return;
    flushStreamPaint();
    t.closed = true;
    t.ms = now() - t.startedAt;
    t.label = 'Thought for ' + Math.round(t.ms / 1000) + 's';
    t.labelEl.textContent = t.label;
    t.node.classList.add('done');
    setThinkOpen(t, false);
  };

  const appendReasoning = (text) => {
    if (!text) return;
    /* a second round of thinking (after an answer or a tool) opens its own
       block rather than reviving the one already summarised */
    let t = st.think;
    if (!t || t.closed) { t = st.think = mkThink(); st.answer = null; }
    t.text += text;
    queueStreamText(t.bodyEl, text);
  };

  const mkAnswer = () => {
    const a = { type: 'answer', text: '' };
    a.node = push(el('div', 'ag-answer'));
    st.blocks.push(a);
    return a;
  };

  const appendContent = (text) => {
    if (!text) return;
    if (st.think && !st.think.closed) closeThink(st.think);
    if (!st.answer) st.answer = mkAnswer();
    st.turnText += text;
    st.answer.text += text;
    queueStreamText(st.answer.node, text);
  };

  /* The site's pages, opened beside the drawing: the tab holds unsaved work
     and a sign-in or a top-up must not cost it. The session is a cookie, so
     what is done over there counts here on the next send. */
  const openSite = (path) => {
    const a = window.nasjAPI || {};
    /* the desktop has no tab to open the page in: the bridge hands the
       path to the default browser */
    if (typeof a.openSite === 'function') { a.openSite(path); return; }
    try { window.open(path, '_blank', 'noopener'); } catch (_) { /* blocked */ }
  };
  /* a usage event, through the tracker (nasj-track.js â–¸ Nasj.track): the
     same batches on the desktop and the web, queued offline, never thrown */
  const track = (kind, props, name) => {
    const t = N.track;
    if (!t || typeof t.event !== 'function') return;
    try { t.event(kind, name == null ? '' : name, props); } catch (_) { /* never */ }
  };
  /* the turn is over, well or badly: one agent_turn with how long it took
     and how many model rounds it ran (each drawing is one more). A bad end
     carries its reason — the server's code, or "stopped" for the person's
     own ESC — because a failure with no reason is a failure nobody can fix:
     two of them sat in the dashboard for a Thai account and said nothing. */
  const turnEnded = (ok, why) => {
    if (!st.turnT0) return;
    const props = { ok: !!ok, rounds: (st.turnRounds || 0) + 1, ms: Math.round(now() - st.turnT0) };
    if (!ok) props.code = why ? String(why).slice(0, 40) : 'unknown';
    track('agent_turn', props);
    st.turnT0 = 0;
  };
  /* the required update's way through: the notice's own Update now */
  const openUpdate = () => {
    if (N.updateNotice && typeof N.updateNotice.open === 'function') N.updateNotice.open();
  };

  /* Sign-in on the desktop is the device flow (nasj-account.js): the
     browser opens on the site, the person approves a short code there, and
     the bridge resolves when the account answers. The code is shown here
     meanwhile, for a browser that did not open. On the web the site's login
     page is the way in, and the cookie counts on the next send. */
  let signinCard = null;
  const signIn = () => {
    const a = window.nasjAPI || {};
    if (typeof a.accountSignIn !== 'function') { openSite('/login?next=/cad'); return; }
    if (signinCard) return;
    const card = el('div', 'ag-setup');
    card.innerHTML =
      '<div class="ag-setup-ico">' + icon('ai-user', 20) + '</div>' +
      '<div class="ag-setup-txt"><strong>Sign in in your browser.</strong> Opening the site…</div>';
    signinCard = card;
    push(card);
    a.accountSignIn().then((r) => {
      signinCard = null;
      if (r && r.ok) {
        card.innerHTML =
          '<div class="ag-setup-ico">' + icon('ai-user', 20) + '</div>' +
          '<div class="ag-setup-txt"><strong>Signed in' +
            (r.email ? ' as ' + esc(r.email) : '') + '.</strong> Send your message again.</div>';
        st.byok = null;          /* the signed-out status is stale now */
        refreshAccount();
      } else if (r && r.code !== 'cancelled') {
        card.innerHTML =
          '<div class="ag-setup-ico">' + icon('ai-user', 20) + '</div>' +
          '<div class="ag-setup-txt"><strong>Not signed in.</strong> ' +
            esc(uiScrub((r && r.error) || 'The sign-in did not finish.')) + '</div>' +
          '<button class="ag-setup-btn">Try again</button>';
        card.querySelector('.ag-setup-btn').addEventListener('click', () => { card.remove(); signIn(); });
      } else {
        card.remove();
      }
    }, () => { signinCard = null; card.remove(); });
  };
  /* the bridge's word on the code, while the poll runs */
  const paintSignin = (e) => {
    if (!signinCard || !e.userCode) return;
    const path = '/device?code=' + encodeURIComponent(e.userCode);
    signinCard.innerHTML =
      '<div class="ag-setup-ico">' + icon('ai-user', 20) + '</div>' +
      '<div class="ag-setup-txt"><strong>Approve this code in your browser:</strong> ' +
        '<span class="ag-signin-code">' + esc(e.userCode) + '</span><br>' +
        'The site opened at ' + esc(path) + '. Waiting for the approval…</div>' +
      '<button class="ag-setup-btn">Open again</button>';
    signinCard.querySelector('.ag-setup-btn').addEventListener('click', () => openSite(path));
  };

  /* A doorstep, not a failure: the card names the one thing standing
     between the user and the agent, and holds the way through it. */
  const SETUP = {
    key: { ico: 'ai-key', head: 'Bring your own key.',
      text: 'The agent runs on your accounts — paste your keys once and they stay on this machine.',
      btn: 'Add keys', run: () => openKeys() },
    login: { ico: 'ai-user', head: 'Sign in to use the agent.',
      text: 'The CAD is free; the agent runs on an account with a little credit. Sign in, then send again.',
      btn: 'Sign in', run: () => signIn() },
    balance: { ico: 'ai-coin', head: 'Add credit to keep drawing.',
      text: 'The agent and each drawing it makes are paid from your balance, and it has run out.',
      btn: 'Add credit', run: () => openSite('/pricing#packs') },
    update: { ico: 'ai-spark', head: 'Update pixelbay CAD to keep drafting.',
      text: 'Install the required update in pixelbay CAD, then send your message again.',
      btn: 'Update now', run: () => openUpdate() }
  };

  const setupCard = (which, message) => {
    const spec = SETUP[which];
    const card = el('div', 'ag-setup');
    card.innerHTML =
      '<div class="ag-setup-ico">' + icon(spec.ico, 20) + '</div>' +
      '<div class="ag-setup-txt"><strong>' + esc(spec.head) + '</strong> ' +
        esc(message && which !== 'key' ? uiScrub(message) : spec.text) + '</div>' +
      '<button class="ag-setup-btn">' + esc(spec.btn) + '</button>';
    card.querySelector('.ag-setup-btn').addEventListener('click', spec.run);
    return push(card);
  };

  const showError = (message, code) => {
    const b = { type: 'error', text: message };
    /* a missing key, a missing sign-in, an empty balance: none is a failure,
       each is the first-run doorstep and gets its card, not a red box */
    const which = code === 'login' || code === 'balance' || code === 'update' ? code
      : /needs an API key|needs its key/i.test(String(message || '')) ? 'key' : null;
    if (which) b.node = setupCard(which, message);
    else b.node = push(el('div', 'ag-error', esc(uiScrub(message))));
    st.blocks.push(b);
    st.lastError = message;
    if (st.think && !st.think.closed) closeThink(st.think);
    setRunning(false);
  };

  /* ---- the account (web only) ---------------------------------------- */
  /* micro-dollars, the site's unit; the site sends the text too, this is
     for the events that carry only the number */
  const fmtMicro = (m) => {
    const usd = m / 1e6;
    const abs = Math.abs(usd);
    const digits = abs === 0 ? 2 : abs < 0.01 ? 4 : abs < 1 ? 3 : 2;
    return (usd < 0 ? 'âˆ’' : '') + '$' +
      abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits });
  };

  const paintCredit = () => {
    if (!creditEl) return;
    const a = st.account;
    if (!a || typeof a.balanceMicro !== 'number') { creditEl.classList.add('hidden'); return; }
    creditEl.classList.remove('hidden');
    creditEl.classList.toggle('low', !a.unlimitedAi && a.balanceMicro <= 0);
    if(a.unlimitedAi){creditEl.querySelector('#ag-credit-amt').textContent='âˆž AI';creditEl.setAttribute('aria-label','Unlimited AI is active');creditEl.title='Unlimited AI is active — open your account';return;}
    creditEl.querySelector('#ag-credit-amt').textContent = (a.balance || fmtMicro(a.balanceMicro)) + ' +';
    creditEl.setAttribute('aria-label', 'Add AI credit. Balance ' + (a.balance || fmtMicro(a.balanceMicro)));
    creditEl.title = 'Your balance' +
      (a.drawCadPrice ? ' — visual detail generation: ' + a.drawCadPrice : '') + ' — native edits have no generation fee; model usage is charged separately — click to add credit';
  };

  const offerCredit = () => {
    const account=st.account,offer=account&&account.creditOffer,r=st.lastToolResult;
    if(!offer||account.unlimitedAi||!account.user?.id||account.balanceMicro>=500000||account.subscription||!r?.ok||(r.faults||[]).length||!/^\/pricing(?:[?#]|$)/.test(offer.href))return;
    const key='nasji.credit-offer.'+account.user.id;
    try{if(Date.now()-Number(localStorage.getItem(key)||0)<7*86400000)return;localStorage.setItem(key,String(Date.now()));}catch{return;}
    const card=el('div','ag-setup');
    card.innerHTML='<div class="ag-setup-txt"><strong>Your AI credit is running low.</strong><p>Unlimited AI for one payment. No credit top-ups or monthly renewal.</p><button class="ag-setup-btn" type="button">See Unlimited AI</button> <button class="ag-setup-btn" type="button" aria-label="Dismiss credit suggestion">Not now</button></div>';
    const buttons=card.querySelectorAll('button');buttons[0].onclick=()=>{track('offer_open',{src:'agent-success'},'unlimited-ai');openSite(offer.href);};buttons[1].onclick=()=>card.remove();push(card);
  };

  let accountKnown = false;
  const applyAccount = (a) => {
    accountKnown = true;
    if (!a || typeof a !== 'object') return;
    if(a.user?.id&&st.account?.user?.id&&a.user.id!==st.account.user.id)API.reset();
    st.account = Object.assign({}, st.account || {}, a);
    /* a bare number replaces the site's formatted text, or the chip lies */
    if (typeof a.balanceMicro === 'number' && typeof a.balance !== 'string') st.account.balance = null;
    /* the chip says what the menu says: the model bound on the account
       first, the one the agent runs on otherwise (the two fields can
       disagree for a moment while the dashboard changes the catalogue) */
    const chipLabel = (a.model && a.model.byok) ? a.model.label : (nasjiModelLabel(a) || (a.model && a.model.label));
    if (chipLabel) setModel(chipLabel);
    /* the chip says whose model it is: the lock is NASJI's, the key yours */
    if (a.model && root) {
      const ico = root.querySelector('#ag-model-ico');
      if (ico) ico.innerHTML = icon(a.model.byok ? 'ai-key' : 'ai-lock', 11);
    }
    paintCredit();
  };

  const refreshAccount = () => {
    const a = (stub && typeof stub.accountGet === 'function') ? stub : (window.nasjAPI || {});
    if (typeof a.accountGet !== 'function') return;
    a.accountGet().then((r) => {
      if (r && r.ok) applyAccount(r);
      else if (r && r.code === 'login') { accountKnown = true; st.account = null; paintCredit(); }
    }, () => {});
  };

  const setModel = (m) => {
    const next = m ? String(m) : null;
    if (next === st.model && (!modelEl || modelEl.textContent === (next || MODEL_FALLBACK))) return;
    st.model = next;
    if (modelEl) modelEl.textContent = st.model || MODEL_FALLBACK;
  };

  const setRunning = (on) => {
    if (!on) flushStreamPaint();
    st.running = !!on;
    if (!sendBtn) return;
    sendBtn.classList.toggle('stop', st.running);
    sendBtn.title = st.running ? 'Stop (Esc)' : 'Send (Enter)';
    sendBtn.innerHTML = icon(st.running ? 'ai-stop' : 'ai-send');
  };

  /* Two independent chips, and they compose: the REFERENCE says what to draw,
     the BOUNDARY says where to put it. "Redraw this sketch, inside that plot"
     is one sentence for an architect and two attachments here. */
  const addChip = (ic, label, title, clear) => {
    const c = el('div', 'ag-chip', icon(ic, 13) + '<span>' + esc(label) + '</span>');
    const x = el('button', 'ag-chip-x', '&#215;');
    x.title = title;
    x.addEventListener('click', () => { clear(); renderChips(); });
    c.appendChild(x);
    chips.appendChild(c);
  };

  const renderChips = () => {
    if(!chips)return;chips.innerHTML='';
    if(st.reference&&!st.reference.region)addChip('ai-image',st.reference.name,'Remove the reference image',()=>{st.reference=null;});
    if(st.picked)addChip('ai-pick',st.picked.label,'Remove element reference',clearTarget);
    else if(st.region?.aisel!=null)addChip('ai-vector',REFERENCE_LABELS.area+' '+st.region.aisel+(st.region.metres?' Â· '+st.region.metres:''),'Remove area reference',clearTarget);
    else if(st.attachment)addChip('ai-vector',st.attachment.label+(st.attachment.metres?' Â· '+st.attachment.metres:''),'Remove boundary reference',clearTarget);
    else if(st.reference?.region)addChip('ai-image',st.reference.name,'Remove reference',clearTarget);
    chips.classList.toggle('ag-chips-empty',!chips.children.length);
  };

  /* ------------------------------------------------------------------ *
   * The prompt that sits ON the selection, Cursor-style. It is anchored in
   * SCREEN space and re-anchored on every view change, because the drawing
   * it belongs to is in world space and the user will pan and zoom while
   * deciding what to type.
   * ------------------------------------------------------------------ */
  let regionBox = null, regionRaf = 0;

  const anchorRegionBox = () => {
    if (!regionBox || !st.region || !N.viewport) return;
    let b = st.region.bbox;
    if (st.region.selId != null) {
      const ent = (N.doc && N.doc.entities || []).find((e2) => e2.id === st.region.selId);
      const live = ent && selBounds(ent);
      if (live) { b = live; st.region.bbox = live; }
    }
    const a = N.viewport.worldToScreen({ x: b.minx, y: b.maxy });
    const c = N.viewport.worldToScreen({ x: b.maxx, y: b.miny });
    const ov = document.getElementById('overlay-canvas');
    const r = ov ? ov.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const left = r.left + Math.min(a.x, c.x);
    const top = r.top + Math.max(a.y, c.y) + 10;      /* just under the box */
    regionBox.style.left = Math.round(clamp(left, r.left + 4,
      r.left + Math.max(4, r.width - 340))) + 'px';
    regionBox.style.top = Math.round(clamp(top, r.top + 4,
      r.top + Math.max(4, r.height - 120))) + 'px';
  };

  const renderRegionBox = () => {
    /* a boundary attached by SELECTION is a site, not an inline edit: it
       carries a region so the red outline and the exact fit apply, but it
       must not pop a prompt box onto the drawing */
    if (!st.region || st.region.silent) {
      if (regionRaf) { cancelAnimationFrame(regionRaf); regionRaf = 0; }
      if (regionBox) { regionBox.remove(); regionBox = null; }
      return;
    }
    if (!regionBox) {
      regionBox = el('div', 'ag-region');
      document.body.appendChild(regionBox);
    }
    const r = st.region;
    regionBox.innerHTML =
      '<div class="ag-region-row">' +
        '<input id="ag-region-input" type="text" placeholder="Change this area to…" ' +
          'value="' + esc(r.text) + '">' +
        '<button class="ag-region-go" id="ag-region-go" title="Draw it">' +
          icon('ai-send', 14) + '</button>' +
        '<button class="ag-region-x" id="ag-region-x" title="Cancel">&#215;</button>' +
      '</div>' +
      '<div class="ag-region-row ag-region-acts">' +
        (r.ran ? '<button class="ag-region-btn" id="ag-region-again">Regenerate</button>' : '') +
        '<button class="ag-region-btn" id="ag-region-chat">Add to chat</button>' +
        '<span class="ag-region-note">' + esc(r.metres ? r.metres : r.ratio) + '</span>' +
      '</div>';
    const inp = regionBox.querySelector('#ag-region-input');
    const text = () => (inp ? inp.value : r.text);
    regionBox.querySelector('#ag-region-go')
      .addEventListener('click', () => API.runRegion(text(), false));
    regionBox.querySelector('#ag-region-x')
      .addEventListener('click', () => API.closeRegion());
    regionBox.querySelector('#ag-region-chat').addEventListener('click', () => {
      r.text = text();r.silent=true;renderRegionBox();renderChips();
      API.open();
      if (input) { input.value = r.text; grow(); input.focus(); }
    });
    const again = regionBox.querySelector('#ag-region-again');
    if (again) again.addEventListener('click', () => API.runRegion(text(), true));
    if (inp) {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); API.runRegion(inp.value, false); }
        if (e.key === 'Escape') { e.preventDefault(); API.closeRegion(); }
      });
      inp.focus();
    }
    anchorRegionBox();
  };

  const openRegionBox = () => { renderRegionBox(); if (!regionRaf) regionRaf = requestAnimationFrame(followRegion); };

  /* There is no view-changed event to listen to — pan and zoom just re-render
     — so while the box is open it re-anchors every frame. It costs two
     worldToScreen calls and it is the only thing that keeps the prompt on its
     rectangle when the user zooms in to look before typing. */
  /* The selection itself is a visible CAD object now, so the box only has
     to follow it around. */
  const followRegion = () => {
    regionRaf = 0;
    if (!regionBox) return;
    anchorRegionBox();
    regionRaf = window.requestAnimationFrame(followRegion);
  };
  window.addEventListener('resize', anchorRegionBox);

// --- END MIGRATED SLICE ---

try { thread = getThread(); } catch(e) {}
export const migrated = true;
export default {};
