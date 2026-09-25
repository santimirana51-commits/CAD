/** src/agent/panel/tool-row.js — REAL ESM migrated from agent-panel.js:2089-2295 */
import { st } from './state.js';
import { el, esc, now, errText } from '../../shared/utils/helpers.js';
import { icon } from '../../ui/icons/agent-icons.js';
import { EPS, MAX_ROWS } from '../../shared/config/tunables.js';
const N = () => window.Nasj || {};
let thread = null; const getThread = () => thread || (thread = document.getElementById('ag-thread'));
const toast = (m) => window.Nasj?.toast?.(m);

// --- BEGIN MIGRATED SLICE ---
  /* ================================================================== *
   * Tool row — compact, expands to the brief, the pictures, the timings.
   * §1's isolation binds the MODEL's context, not this screen.
   * ================================================================== */
  /* THE CARDS NARRATE, THEY DO NOT TESTIFY. The vendor isolation contract
     shields the agent's context; the architect asked for the same secrecy on
     screen — the pipeline is the product's business. Every string that lands
     on a card passes through here. Nothing on screen may say or hint that a
     picture exists anywhere in the process. */
  const uiScrub = (v) => String(v == null ? '' : v)
    .replace(/gemini[-\w.]*/gi, 'the drafting engine')
    .replace(/vtracer|visioncortex/gi, 'the draughting pass')
    .replace(/deepseek[-\w.]*/gi, 'the agent')
    .replace(/(meta\/)?muse[-\s]?spark[-\w.]*/gi, 'the agent')
    .replace(/openrouter/gi, 'the agent')
    .replace(/\b(image|application)\/[a-z0-9.+-]+\b/gi, '')
    .replace(/\b(png|jpe?g|svg|wasm|bitmap|base64)\b/gi, '')
    .replace(/request\s+(an?\s+)?(image|picture|photo|render)/gi, 'draft')
    .replace(/\bvectori[sz]\w*\b/gi, 'draft')
    .replace(/\braster\w*\b/gi, 'draft')
    .replace(/\bimages?\b/gi, 'draft')
    .replace(/\bphotos?\b/gi, 'draft')
    .replace(/\bpixels?\b/gi, 'units')
    .replace(/\b[0-9]K\b/gi, '')
    .replace(/\b1\s*:\s*1\b/g, '')
    .replace(/  +/g, ' ');

  const mkTool = (id, name, args) => {
    const m = {
      type: 'tool', id: id == null ? ('t' + st.tools.length) : id,
      name: name || 'draw_cad', nativeAction: args && args.action, status: 'running', summary: 'preparing…',
      brief: (args && args.brief != null) ? String(args.brief) : '',
      info: {}, timings: {}, result: null, error: null, expanded: false,
      pv: null, stats: null,
      /* where this drawing went: the extents it filled and the entities it
         became, so the row can take the view back to it later */
      shot: null, framed: null, note: null
    };
    const node = el('div', 'ag-tool running');
    node.innerHTML =
      '<div class="ag-tool-head" role="button" tabindex="0" aria-expanded="false">' +
        '<span class="ag-tool-ico"><span class="ag-spin"></span></span>' +
        '<span class="ag-tool-name"></span>' +
        '<span class="ag-tool-sum"></span>' +
        '<button class="ag-show hidden" type="button" aria-label="Show it" ' +
          'title="Show it — take the view to this drawing">' +
          icon('ai-target', 12) + '<span>Show it</span></button>' +
        '<span class="ag-tool-chev">' + icon('ai-chev', 12) + '</span>' +
      '</div>' +
      '<div class="ag-tool-track"><i></i></div>' +
      '<div class="ag-tool-note hidden"></div>' +
      '<div class="ag-tool-body"></div>';
    m.node = node;
    m.icoEl = node.querySelector('.ag-tool-ico');
    m.sumEl = node.querySelector('.ag-tool-sum');
    m.bodyEl = node.querySelector('.ag-tool-body');
    m.noteEl = node.querySelector('.ag-tool-note');
    m.showEl = node.querySelector('.ag-show');
    node.querySelector('.ag-tool-name').textContent = m.name;
    node.querySelector('.ag-tool-head').addEventListener('click', () => setToolOpen(m, !m.expanded));
    node.querySelector('.ag-tool-head').addEventListener('keydown', ev => { if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); setToolOpen(m, !m.expanded); } });
    /* the head opens the row; the target does not — it only moves the view */
    m.showEl.addEventListener('click', (ev) => { ev.stopPropagation(); showAgain(m); });
    st.tools.push(m);
    st.blocks.push(m);
    st.answer = null;                 /* prose after a tool starts a new block */
    push(node);
    paintTool(m);
    return m;
  };

  const findTool = (id) => (id == null ? null : st.tools.find((t) => t.id === id) || null);
  const ensureTool = (id, name, args) => {
    const found = findTool(id);
    if (!found) return mkTool(id, name, args);
    if (args && args.brief != null && !found.brief) { found.brief = String(args.brief); paintTool(found); }
    return found;
  };

  const setToolOpen = (m, on) => {
    m.expanded = !!on;
    m.node.classList.toggle('open', m.expanded);
    m.node.querySelector('.ag-tool-head').setAttribute('aria-expanded', String(m.expanded));
    if (m.expanded && m.node) {
      const pv = m.node.querySelector('.ag-pv-wrap') || m.node.querySelector('.ag-pv');
      if (pv && typeof pv.scrollIntoView === 'function') {
        pv.scrollIntoView({ block: 'nearest' });
      }
    }
  };

  /* THE CARD'S PROOF OF WORK IS THE DRAWING ITSELF — the finished strokes,
     drawn small, ink on the panel's own paper. No stage of the pipeline is
     ever pictured; the strokes are CAD geometry and the only exhibit. */
  const drawCardPreview = (canvas, strokes) => {
    if (!canvas || !strokes || !strokes.length) return;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, pts = 0;
    for (const s of strokes) for (const p of s) {
      if (p.x < minx) minx = p.x;
      if (p.y < miny) miny = p.y;
      if (p.x > maxx) maxx = p.x;
      if (p.y > maxy) maxy = p.y;
      pts++;
    }
    const bw = maxx - minx, bh = maxy - miny;
    if (!(bw > 0) || !(bh > 0)) return;
    const W = 640;
    const H = Math.min(1800, Math.max(220, Math.round(W * (bh / bw))));
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    const pad = 18;
    const sc = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
    const ox = (W - bw * sc) / 2, oy = (H - bh * sc) / 2;
    const X = (p) => ox + (p.x - minx) * sc;
    const Y = (p) => H - oy - (p.y - miny) * sc;
    g.lineWidth = 1.1;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(219,238,255,.92)';
    const step = pts > 40000 ? 2 : 1;             /* huge plans still land fast */
    for (const s of strokes) {
      if (s.length < 2) continue;
      g.beginPath();
      g.moveTo(X(s[0]), Y(s[0]));
      for (let i = step; i < s.length; i += step) g.lineTo(X(s[i]), Y(s[i]));
      if (step > 1) g.lineTo(X(s[s.length - 1]), Y(s[s.length - 1]));
      g.stroke();
    }
  };

  const fmtN = (n) => Number(n || 0).toLocaleString('en-US');

  const paintTool = (m) => {
    m.node.querySelector('.ag-tool-name').textContent = m.name === 'review_design' ? 'Design critique' : m.name === 'cad_library' ? 'CAD library' : m.name === 'cad_workspace' ? (WORKSPACE_LABELS[(m.result&&m.result.action)||m.nativeAction]||'Drawing workspace') : m.name === 'cad_document' ? ((m.result && m.result.action || m.nativeAction) === 'inspect' ? 'Inspect drawing' : 'Edit drawing') : m.name === 'draw_plan' ? (PLAN_STAGE_LABELS[(m.result&&m.result.action)||m.nativeAction]||'Plan layout') : 'Generate detail';
    m.sumEl.textContent = m.name === 'cad_workspace' && m.result ? (WORKSPACE_SUMMARY_LABELS[m.result.action] || m.summary) : m.name === 'cad_document' && m.result && m.result.ok
      ? (m.result.action === 'inspect' ? `Inspected ${m.result.total} entities; no changes.` : `Added ${m.result.added}, changed ${m.result.changed}, removed ${m.result.removed}. Undo reverses this edit.`)
      : m.summary;
    /* the view moved on purpose, and there is a way back to the drawing */
    if (m.noteEl) {
      m.noteEl.textContent = m.framed === 'moved' ? 'Framed the new geometry' : m.note || '';
      m.noteEl.classList.toggle('hidden', !m.note);
    }
    if (m.showEl) m.showEl.classList.toggle('hidden', !(m.shot && m.status === 'ok'));
    m.node.classList.toggle('running', m.status === 'running');
    m.node.classList.toggle('failed', m.status === 'error');
    m.node.classList.toggle('done', m.status === 'ok');
    m.icoEl.innerHTML = m.status === 'running' ? '<span class="ag-spin"></span>'
      : (m.status === 'error' ? icon('ai-close', 13) : icon('ai-check', 13));
    let html = '';
    if (m.pv && m.pv.length) {
      html += '<div class="ag-pv-wrap"><canvas class="ag-pv" aria-label="the finished draft"></canvas></div>';
    }
    if (m.brief) html += '<div class="ag-kvhead">' + (m.name === 'draw_plan' ? 'the layout' : 'the brief') + '</div><div class="ag-brief">' + esc(m.brief) + '</div>';
    if (m.drafting) html += '<div class="ag-kvhead">composing</div>' +
      '<div class="ag-brief ag-drafting">' + esc(m.draftText || '…') + '</div>';
    if (m.stats) {
      html += '<div class="ag-tool-stats">' +
        '<span class="ag-stat">' + fmtN(m.stats.strokes) + ' strokes</span>' +
        '<span class="ag-stat">' + fmtN(m.stats.points) + ' points</span>' +
        '<span class="ag-stat">' + esc(m.stats.secs) + 's</span>' +
        (m.stats.stopped ? '<span class="ag-stat ag-stat-warn">stopped</span>' : '') +
      '</div>';
    }
    if (m.planStats) {
      const s = m.planStats, notes = m.planNotes || [];
      html += '<div class="ag-tool-stats">' +
        ['rooms', 'doors', 'windows', 'stairs'].map((k) => '<span class="ag-stat">' + fmtN(s[k]) + ' ' + k + '</span>').join('') +
        (notes.length ? '<span class="ag-stat ag-stat-warn">' + fmtN(notes.length) + ' note' + (notes.length === 1 ? '' : 's') + '</span>' : '') +
      '</div>';
      if (notes.length) html += '<div class="ag-brief">' + notes.map(esc).join('<br>') + '</div>';
    }
    /* the state keeps the verbatim error for diagnostics; the SCREEN gets
       the scrubbed one — same words, no vendor, no library, no codec */
    if (m.error != null) html += '<div class="ag-err">' + esc(uiScrub(m.error)) + '</div>';
    m.bodyEl.innerHTML = html;
    const cv = m.bodyEl.querySelector('.ag-pv');
    if (cv) drawCardPreview(cv, m.pv);
  };

  const toolProgress = (m, text) => {
    if (!m || m.status !== 'running') return;
    m.summary = text;
    m.sumEl.textContent = text;
  };

  const toolOk = (m, summary, result) => {
    m.status = 'ok';
    m.summary = summary;
    if (result) m.result = result;
    paintTool(m);
  };

  /* verbatim on the row, neutral to the model */
  const toolFail = (m, verbatim, neutral, result) => {
    st.warmup = null;
    repaint();
    m.status = 'error';
    m.summary = 'failed';
    m.error = verbatim;
    if (result) m.result = result;
    st.lastError = verbatim;
    paintTool(m);
    setToolOpen(m, true);            /* a failure is never hidden behind a click */
    return { ok: false, error: neutral };
  };

// --- END MIGRATED SLICE ---

export const migrated = true;
export default {};
