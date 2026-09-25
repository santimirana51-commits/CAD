/** src/agent/panel/events.js — REAL ESM migrated from agent-panel.js:3816-4050 */
import { st } from './state.js';
import { MODEL_FALLBACK, NEUTRAL } from '../../shared/config/tunables.js';
import { errText } from '../../shared/utils/helpers.js';
const N = () => window.Nasj || {};

// --- BEGIN MIGRATED SLICE ---
  /* ================================================================== *
   * Agent events
   * ================================================================== */
  const onAgentEvent = (e) => {
    if (!e || typeof e !== 'object') return;
    if (typeof e.model === 'string' && e.model) setModel(e.model);
    switch (e.kind) {
      case 'conv': st.convId=e.convId; if(!st.conversationDrawing)st.conversationDrawing=drawingIdentity();break;
      case 'reasoning':
        appendReasoning(e.text == null ? '' : String(e.text));
        break;
      case 'content':
        appendContent(e.text == null ? '' : String(e.text));
        break;
      case 'tool-stream': {
        /* the brief is watched being WRITTEN, the way the thinking already
           is — the arguments stream in as JSON fragments and the "brief"
           value is lifted out of the partial text as it grows */
        // Only a short brief preview is needed here. Native tools may stream
        // hundreds of geometry IDs; never rescan an unbounded JSON buffer.
        if ((st.draftRaw || '').length >= 32768) break;
        st.draftRaw = (st.draftRaw || '') + String(e.text == null ? '' : e.text).slice(0,32768-(st.draftRaw || '').length);
        const mBrief = /"brief"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(st.draftRaw);
        if (!mBrief) break;
        let text = mBrief[1];
        try { text = JSON.parse('"' + text.replace(/\\$/, '') + '"'); }
        catch (_) { /* mid-escape: show it raw for a frame */ }
        let row = findTool('__draft__');
        if (!row) {
          row = mkTool('__draft__', 'draw_cad', {});
          row.drafting = true;
          row.summary = 'writing the brief…';
          setToolOpen(row, true);
        }
        row.draftText = text;
        const node = row.node && row.node.querySelector('.ag-drafting');
        if (node) {
          node.textContent = text;
          node.scrollTop = node.scrollHeight;
        } else {
          paintTool(row);
          const n2 = row.node && row.node.querySelector('.ag-drafting');
          if (n2) n2.scrollTop = n2.scrollHeight;
        }
        break;
      }
      case 'tool-start': {
        /* the drafting card becomes THE tool card — same node, no jump */
        const draft = findTool('__draft__');
        st.draftRaw = '';
        if (draft) {
          draft.id = e.id;
          draft.name = e.name || draft.name;
          draft.drafting = false;
          draft.draftText = null;
          if (e.args && e.args.brief != null) draft.brief = String(e.args.brief);
          draft.summary = 'running…';
          paintTool(draft);
          break;
        }
        ensureTool(e.id, e.name, e.args);
        break;
      }
      case 'tool-progress': {
        const m = findTool(e.id);
        const pct = num(e.pct) ? ' ' + Math.round(e.pct) + '%' : '';
        if (m) toolProgress(m, String(e.text || e.stage || 'working') + pct);
        break;
      }
      case 'tool-done': {
        const m = findTool(e.id);
        if (m && m.status === 'running') {
          if (e.ok === false) toolFail(m, String(e.summary || 'the tool failed.'), NEUTRAL.image);
          else toolOk(m, String(e.summary || 'done'));
        }
        break;
      }
      case 'done':
        st.usage = e.usage || null;
        if (st.think && !st.think.closed) closeThink(st.think);
        if (st.turnText) st.messages.push({ role: 'assistant', text: st.turnText });
        st.turnText = '';
        st.answer = null;
        /* on the site the turn has a price, and it is said at the foot of
           the answer — the token charge and the drawings together, as the
           ledger has them, never a guess */
        if (num(e.turnMicro) && st.account) {
          const turn = e.turn || {};
          const draws = num(turn.draws) ? turn.draws : 0;
          push(el('div', 'ag-cost',
            (e.byok ? 'Your key · ' : '') + (st.account.unlimitedAi ? 'Included with Unlimited AI' : esc(fmtMicro(e.turnMicro)) + ' this turn') +
            (draws ? ' · ' + draws + ' drawing' + (draws === 1 ? '' : 's') : '') +
            (!st.account.unlimitedAi && num(e.balanceMicro) ? ' · ' + esc(fmtMicro(e.balanceMicro)) + ' left' : '')));
        }
        if (num(e.balanceMicro)) applyAccount({ balanceMicro: e.balanceMicro });
        setRunning(false);
        turnEnded(true);
        offerCredit();
        break;
      case 'account':
        /* the device sign-in's code is for the card, not the account */
        if (e.signingIn) paintSignin(e);
        else applyAccount(e);
        break;
      case 'error':
        showError(e.message == null ? '' : String(e.message), e.code);
        turnEnded(false, e.code || 'error');
        if (e.code === 'login') {
          accountKnown = true; st.account = null; paintCredit();
          if (input && !input.value && st.sentText) { input.value = st.sentText; grow(); }
        }
        else if (e.code === 'balance') refreshAccount();   /* the chip goes red */
        break;
      default:
        break;
    }
  };

  const onAgentToolExec = (req) => {
    const id = req && req.id;
    const name = (req && req.name) || 'draw_cad';
    const args = (req && req.args) || {};
    const row = ensureTool(id, name, args);
    if(st.running && st.turnDoc && st.turnDoc!==N.doc){
      const out=toolFail(row,'The active drawing changed. Return to the original drawing and resend.','The active drawing changed. Return to the original drawing and resend.');
      const B=bridge();if(B.agentToolResult)B.agentToolResult(id,out);return Promise.resolve(out);
    }
    st.turnRounds = (st.turnRounds || 0) + 1;
    const tTool = now(), toolEpoch=st.sendEpoch;
    /* THE AGENT ATTACHED A BOUNDARY. It hands over an id rather than a
       description, so the outline that reaches the drawing step is the one
       measured off the drawing, corner for corner — and the agent, having
       attached it, has no reason left to describe a shape it cannot see.
       An id it invents simply finds nothing and the drawing is placed the
       ordinary way. */
    const forPlan = name === 'draw_plan';
    /* a plan asked for in the prompt box on a selection goes in that
       selection even when the model forgot to name it */
    const siteId = args.site || (forPlan && st.region && !st.region.silent && st.region.selId != null && st.region.aisel != null ? 'sel-' + st.region.aisel : '');
    const chosenSel = siteId ? selById(siteId) : null;
    if (chosenSel) {
      const sb = selBounds(chosenSel);
      const site = sb && largestBoundaryIn(sb);
      /* a plan of rooms goes in the land the area holds, however loosely the
         area was dragged; with nothing closed inside, the area is the land */
      const fr = site ? plotFrame(site.pts, sb, forPlan, site.alone) : (forPlan && sb ? rectFrame(sb) : null);
      const sref = sb && (fr ? buildSiteReference(fr.pts, fr.obb) : buildWindowReference(sb));
      if (sref) {
        st.region = { selId: chosenSel.id, aisel: chosenSel.aisel,
          bbox: Object.assign({}, sb),
          ratio: fr ? nearestRatio(fr.obb.maxx - fr.obb.minx, fr.obb.maxy - fr.obb.miny)
            : nearestRatio(sb.maxx - sb.minx, sb.maxy - sb.miny),
          text: '', ran: true, site: true, replace: true, silent: true, pts: site ? site.pts : null,
          landKey: site ? site.ids[0] : chosenSel.id };
        if (!fr && sref.ratioHint) st.region.ratio = sref.ratioHint;
        if (!st.reference || st.reference.region) st.reference = { name: 'sel-' + chosenSel.aisel, dataUrl: sref.dataUrl,
          bytes: Math.round(sref.dataUrl.length * 3 / 4), region: true };
        st.attachment = { ids: [chosenSel.id], label: 'sel-' + chosenSel.aisel,
          exact: true, bbox: Object.assign({}, fr ? fr.obb : sb),
          frame: fr && fr.turned ? { theta: fr.theta, c: fr.c, turned: true } : null,
          plot: fr ? fr.pts : null, landKey: site ? site.ids[0] : chosenSel.id,
          metres: fr ? metresLabel(plotMetres(site ? site.pts : rectPts(sb), sb, true, site ? site.ids[0] : chosenSel.id)) : '' };
        st.region.metres = st.attachment.metres;
        row.info.site = 'sel-' + chosenSel.aisel;
        if (st.attachment.metres) row.info.land = st.attachment.metres + (site ? '' : ' (the marked area)');
        renderChips();
      }
    }
    const picked = (siteId && !chosenSel) ? findSite(siteId) : null;
    if (picked) {
      const pf = plotFrame(picked.pts, picked.bbox) || { pts: picked.pts, obb: picked.bbox, turned: false };
      const ref = buildSiteReference(pf.pts, pf.obb);
      if (ref) {
        st.region = { bbox: Object.assign({}, picked.bbox),
          ratio: nearestRatio(pf.obb.maxx - pf.obb.minx, pf.obb.maxy - pf.obb.miny),
          text: '', ran: false, silent: true, site: true, pts: picked.pts };
        if (!st.reference || st.reference.region) st.reference = { name: picked.id, dataUrl: ref.dataUrl,
          bytes: Math.round(ref.dataUrl.length * 3 / 4), region: true };
        st.attachment = { ids: picked.ids || [picked.ent], label: picked.id, exact: true,
          bbox: Object.assign({}, pf.obb),
          frame: pf.turned ? { theta: pf.theta, c: pf.c, turned: true } : null,
          plot: pf.pts, landKey: picked.ent, metres: metresLabel(plotMetres(picked.pts, picked.bbox, true, picked.ent)) };
        st.region.metres = st.attachment.metres;
        row.info.site = picked.id;
        row.info.land = st.attachment.metres;
        renderChips();
      }
    }
    st.applied = 0;
    st.stopped = false;
    st.placement = null;
    st.clean = null;
    const p = (async () => {
      let out;
      try {
        if(pickedScope()!=null && name!=='cad_document' && !(name==='cad_library'&&['search','inspect'].includes(args.action)) && !(name==='cad_workspace'&&['skills','skill','symbol_catalog','snapshot','building_read','quantities','coordination_review','drawing_review','design_context'].includes(args.action))){
          out=toolFail(row,'Only the picked element may be edited. Use cad_document with its exact ID; clear the element reference or mark an area for wider changes.','Only the picked element may be edited.');
        } else if (siteId && !chosenSel && !picked) {
          // Reject invented IDs without pretending a real boundary was deleted.
          // A boundary present at send time disappearing must never become an unbounded draw.
          const neverHadSite = st.turnHadSite === false && !listSites().length && !selEntities().length && !st.attachment && !st.region;
          const why = neverHadSite
            ? 'No site is available in the current drawing; omit site for a new standalone concept, or request the intended boundary if this task requires a specific plot.'
            : 'The selected boundary is unavailable; select the current boundary again before drawing inside it.';
          out = toolFail(row, why, why);
        } else if (name === 'cad_document') {
          out = window.NasjCadDocument ? window.NasjCadDocument.run(N, args, nativeContext()) : {ok:false,error:'Native CAD tools are unavailable. Update the application.'};
          if (out.ok) {
            if(st.turnPicked && args.action==='apply' && args.erase){st.turnPicked=out.ids||[];if(st.picked){st.picked.ids=st.turnPicked.slice();if(!st.picked.ids.length)st.picked=null;renderChips();}}
            toolOk(row, out.summary, out);
            if (out.bounds && out.action === 'apply') frameDrawn(row, out.bounds, out.ids || []);
            if (args.transform) planRuns.delete(N.doc);
          } else toolFail(row, out.error, out.error);
        } else if (name === 'cad_workspace') {
          out = window.NasjWorkspace ? await window.NasjWorkspace.run(N,args,{...nativeContext(),snapshot:snapshotDrawing}) : {ok:false,error:'Update the application to use workspace tools.'};
          if(out.ok){toolOk(row,out.summary,out);if(out.bounds && ['elevation','section','working_copy','symbols','symbol_register','symbol_legend','service_network'].includes(args.action))frameDrawn(row,out.bounds,out.ids||[]);}else toolFail(row,out.error,out.error);
        } else if (name === 'cad_library') {
          out=await window.NasjCadLibrary.run(N,args,{...nativeContext(),fetch:bridge().agentLibrary,cancelled:()=>st.sendEpoch!==toolEpoch||st.stopped});
          if(out.ok)toolOk(row,out.summary||'Library operation completed.',out);else toolFail(row,out.error,out.error);
        } else if (name === 'draw_plan') out = await runPlan(args, row);
        else if (name === 'draw_cad') out = await runPipeline(String(args.brief == null ? '' : args.brief), row, args);
        else out = toolFail(row, 'Unsupported tool. Update the application.', 'Unsupported tool. Update the application.');
      }
      catch (err) { out = toolFail(row, errText(err), name === 'draw_plan' ? NEUTRAL.plan : NEUTRAL.image); }
      if(out?.ok && nativeContext().referenceSelection){if(!st.referenceOwned)st.referenceOwned=new Set();for(const id of [...(out.ids||[]),...(out.changedIds||[])])st.referenceOwned.add(String(id));}
      st.lastToolResult = out;
      track('draw_cad', { ok: !!(out && out.ok), ms: Math.round(now() - tTool), tool: name, action: args.action || 'draw', error: out && !out.ok ? String(out.error || '').slice(0,160) : undefined }, name);
      const B = bridge();
      if (B.agentToolResult && st.sendEpoch===toolEpoch) { try { B.agentToolResult(id, out); } catch (_) { /* ignore */ } }
      return out;
    })();
    st.toolRun = p;
    return p;
  };

// --- END MIGRATED SLICE ---

export const migrated=true;
export default {};
