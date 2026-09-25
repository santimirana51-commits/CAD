/** src/agent/panel/pipeline.js — REAL ESM migrated from agent-panel.js:3583-3815 */
import { st } from './state.js';
import { cleanForVectorizer } from '../pipeline/clean.js';
import { NEUTRAL } from '../../shared/config/tunables.js';
import { errText, now } from '../../shared/utils/helpers.js';
const N = () => window.Nasj || {};

// --- BEGIN MIGRATED SLICE ---
  /* ================================================================== *
   * The pipeline, behind the one tool (PANEL-CONTRACT §3, unchanged)
   * ================================================================== */
  /* contract shape: strokes:[{pts:[[x,y],…], width}] */
  const toPts = (s) => {
    const raw = Array.isArray(s) ? s : (s && Array.isArray(s.pts) ? s.pts : null);
    if (!raw) return null;
    const out = [];
    for (const p of raw) {
      const x = Array.isArray(p) ? p[0] : (p && p.x);
      const y = Array.isArray(p) ? p[1] : (p && p.y);
      if (num(x) && num(y)) out.push({ x, y });
    }
    return out.length >= 2 ? out : null;
  };

  const visionImage = async (dataUrl) => {
    const img = new Image(); img.src = dataUrl; await img.decode();
    const scale=Math.min(1,1536/Math.max(img.width,img.height)), cv=document.createElement('canvas');
    cv.width=Math.max(1,Math.round(img.width*scale));cv.height=Math.max(1,Math.round(img.height*scale));
    const c=cv.getContext('2d');c.fillStyle='#ffffff';c.fillRect(0,0,cv.width,cv.height);c.drawImage(img,0,0,cv.width,cv.height);
    return cv.toDataURL('image/jpeg',0.85);
  };
  const pickedScope = () => st.running ? st.turnPicked : st.picked?.ids;
  const selectionScope = () => st.running && st.turnScope !== undefined ? st.turnScope : st.region && st.region.aisel != null ? Object.assign({},st.region.bbox) : null;
  const nativeContext = () => ({scopeBounds:pickedScope()!=null?null:selectionScope(),scopeIds:pickedScope(),referenceSelection:pickedScope()==null&&!!selectionScope(),allowedIds:[...(st.referenceOwned||[])]});
  const snapshotDrawing = async (a) => {
    let box=a.scope==='drawing'?null:selectionScope();
    if(!box && a.scope==='selection') throw Error('Mark an AI selection first.');
    if(!box){const es=(N.doc.entities||[]).filter(e=>!e.aisel);for(const e of es){const b=N.geom.entityBounds(e);if(!b)continue;box=box?{minx:Math.min(box.minx,b.minx),miny:Math.min(box.miny,b.miny),maxx:Math.max(box.maxx,b.maxx),maxy:Math.max(box.maxy,b.maxy)}:{...b};}}
    if(!box)return null;
    const pad=Math.max(box.maxx-box.minx,box.maxy-box.miny,1)*.03;
    const frame={minx:box.minx-pad,miny:box.miny-pad,maxx:box.maxx+pad,maxy:box.maxy+pad};
    const r=buildWindowReference(frame,true);if(!r)return null;
    return {image:await visionImage(r.dataUrl),bounds:frame,units:N.units.get().insunits,
      note:'Color CAD plot on white paper. '+(a.scope==='drawing'?'Complete drawing bounds. ':'Cropped to the marked area when selected. ')+'World X right, Y up. Outside/crossing entities may be omitted by scoped inspection, not deleted. Use inspected coordinates/colors as authoritative; pixels are not dimensions.'};
  };

  const runPipeline = async (brief, row, args = {}) => {
    const sourceDoc=N.doc, sourceGeneration=N.docGen(sourceDoc);
    const changed=()=>N.doc!==sourceDoc||N.docGen(sourceDoc)!==sourceGeneration;
    const changedResult=()=>toolFail(row,'The drawing changed while the detail was being prepared. Your drawings were kept; resend the request.','The drawing changed while the detail was being prepared. Your drawings were kept; resend the request.');
    const targetLayer=typeof args.layer==='string'?args.layer:'A-SKETCH';
    if(!/^[A-Z][A-Za-z0-9 _-]{1,79}$/.test(targetLayer))throw Error('Choose a named discipline layer for this detail.');
    if(N.doc.layers.some(l=>l.name===targetLayer&&l.locked))throw Error('The destination layer is locked.');
    const B = bridge();
    const at = st.attachment;
    const boundary = at && Array.isArray(at.plot) && at.plot.length >= 3
      ? at.plot.map(at.frame && at.frame.turned ? unturn(at.frame) : p => ({ x: p.x, y: p.y })) : null;
    const siteKey = boundary && at.landKey != null ? String(at.landKey) : null;
    const t0 = now();
    const secs = () => Math.round((now() - t0) / 100) / 10;
    /* the head is on station while the model works: the 30-50s image wait
       was a dead screen, now it is a machine spooling up */
    st.warmup = { startedAt: now(), pct: 0 };
    startFx();
    repaint();

    /* --- 1. image ------------------------------------------------- */
    /* 1:1 because the vectorizer's canvas IS a square: anything else is fitted
       into it and the rest of the square becomes white padding that the model
       still pays for. */
    const ask = { prompt: brief, imageSize: '4K', aspectRatio: '1:1' };
    /* The architect's own plan or sketch, if they attached one: the image step
       then works FROM it instead of inventing a layout. The reference is the
       human's, so it is never scrubbed or reduced — but the agent still never
       sees it; it goes straight from this panel to the image service. */
    if (st.reference && st.reference.dataUrl) {
      ask.refDataUrl = st.reference.dataUrl;
      row.reference = st.reference.name;
    }
    /* A REGION EDIT is a different request from a fresh drawing: the output
       has the shape of the rectangle the user dragged, and it must be told
       what the red ring in the reference means. Both belong here rather than
       in the brief — the agent describes the drawing, the panel describes
       the sheet. */
    if (st.region && st.reference && st.reference.region) {
      /* a SITE fill and a region EDIT are different requests: the site
         reference IS the land, so the model completes the picture; the edit
         reference is a drawing with a red ring, so the model replaces the
         ringed part. Each gets its own clause and never the other's. */
      ask.prompt = brief + SITE_CLAUSE;
      ask.aspectRatio = st.region.ratio;
    }
    /* NOTHING about the request lands on the card. What the human reads is
       drafting language; how the draft is produced is the product's business
       (the same secrecy the model's context already gets). */
    toolProgress(row, 'laying out…');
    if (!B.aiImage) return toolFail(row, 'the drafting engine is not available in this build.', NEUTRAL.image);
    const tImg = now();
    let r1;
    try { r1 = await B.aiImage(ask); }
    catch (e) { return toolFail(row, errText(e), NEUTRAL.image); }
    if(changed())return changedResult();
    if (!r1 || !r1.ok) {
      /* the site refused for want of credit or a sign-in: the card with the
         way in goes on the thread, and the model is told plainly that the
         account is the obstacle so it stops asking for drawings */
      if (r1 && (r1.code === 'balance' || r1.code === 'login')) {
        setupCard(r1.code, r1.error);
        /* the sentence the model repeats to the person has to be one they
           can act on: a woman who asked for a four-bedroom plan was told
           "add credit and I'll draw it", with no price and nowhere to go,
           and left — so the fee and the page go in the sentence itself */
        const fee = st.account && st.account.drawCadPrice;
        const feeText = typeof fee === 'number' ? ' (each costs ' + fmtMicro(fee) + ')'
          : (typeof fee === 'string' && fee) ? ' (each costs ' + fee + ')' : '';
        return toolFail(row, errText(r1.error), r1.code === 'balance'
          ? 'the account has no credit left for drawings' + feeText + '; tell the user to add credit at https://nasji.com/account and stop drawing.'
          : 'the user is not signed in; tell them to sign in at https://nasji.com/login and stop drawing.');
      }
      return toolFail(row, errText(r1 && r1.error) || 'the drafting engine returned no result.', NEUTRAL.image);
    }
    row.timings.compose = Math.round(now() - tImg);
    toolProgress(row, 'refining…');
    paintTool(row);

    /* --- 2. clean — the tracing pass never sees the raw draft --- */
    const tCl = now();
    let clean = null;
    try { clean = await cleanForVectorizer(r1.dataUrl); }
    catch (e) {
      return toolFail(row, 'the draft could not be prepared: ' + errText(e), NEUTRAL.clean);
    }
    row.timings.refine = Math.round(now() - tCl);
    if(changed())return changedResult();
    st.clean = clean;
    toolProgress(row, 'drafting…');
    paintTool(row);

    /* --- 3. trace + pen ------------------------------------------- */
    const run = { place: null, taken: 0, drew: 0, round: 0, rounds: 0, settled: false, abandoned: false, failed: null };
    const tTr = now();
    const anim = startAnim();

    /* image px -> world, placed ONCE (see sizeBox) and queued for the pen */
    const feed = (list, size) => {
      const raw = Array.isArray(list) ? list : [];
      run.taken += raw.length;
      const good = raw.map(toPts).filter(Boolean);
      if (!good.length) return 0;
      if (!run.place) {
        run.place = computePlacement(frameBox(size, clean) || bboxOf(good));
        st.placement = run.place;
      }
      const placed = good.map((s) => s.map(run.place.map));
      const fitted = boundary && window.NasjPlan && window.NasjPlan.clipStrokes
        ? window.NasjPlan.clipStrokes(placed, boundary) : placed;
      const n = anim.push(fitted);
      run.drew += n;
      return n;
    };

    let off = null;
    const unsub = () => { const f = off; off = null; drop(f); };
    if (B.onAiRasterChunk) {
      try {
        off = B.onAiRasterChunk((ch) => {
          if (!ch || !anim.running || run.abandoned) return;
          feed(ch.strokes, ch.size);
          if (num(ch.rounds) && ch.rounds > 0) run.rounds = ch.rounds;
          if (num(ch.round)) run.round = ch.round;
          toolProgress(row, (run.rounds ? 'round ' + run.round + '/' + run.rounds + ' · ' : '') +
            run.drew + ' stroke' + (run.drew === 1 ? '' : 's'));
        });
      } catch (_) { off = null; }
    }

    /* The pen owns the run from here: the vectorizer's own resolution just
       feeds and closes the queue, so ESC lands the moment it is pressed. */
    let traced = null;
    Promise.resolve()
      .then(() => B.aiRaster ? B.aiRaster({ dataUrl: clean.dataUrl })
        : Promise.reject(new Error('the draughting pass is not available in this build.')))
      .then((r) => ({ r }), (e) => ({ e }))
      .then(({ r, e }) => {
        run.settled = true;
        row.timings.draft = Math.round(now() - tTr);
        unsub();
        if (run.abandoned) return;
        if (e || !r || !r.ok) {
          const notes = (r && Array.isArray(r.notes) && r.notes.length) ? r.notes.join('; ') : null;
          run.failed = errText(e) || errText(r && r.error) || 'the draughting pass returned no result.';
          toolFail(row, run.failed, NEUTRAL.trace,
            notes ? { notes: uiScrub(notes) } : null);
          anim.fail();
          return;
        }
        traced = r;
        const all = Array.isArray(r.strokes) ? r.strokes : [];
        feed(all.slice(run.taken), r.size);
        anim.close();
      });

    const res = await anim.promise;
    row.timings.draw = Math.round(res.ms);
    if (!run.settled) {
      /* stopped while the vectorizer was still working — the row would spin
         for the rest of the session otherwise */
      run.abandoned = true;
      unsub();
      row.info.stopped = 'the drawing was still being prepared when the pen was stopped';
    }
    st.stopped = res.stopped;
    st.lastRunMs = res.ms;
    if (res.failed) return { ok: false, error: NEUTRAL.trace };   /* applies nothing */
    if(changed())return changedResult();
    if(sourceDoc.layers.some(l=>l.name===targetLayer&&l.locked))return toolFail(row,'The destination layer is locked.','The destination layer is locked.');

    if (!res.strokes.length) return toolFail(row, 'No usable geometry landed inside the selected boundary. Your existing drawing has been kept.', 'No usable geometry landed inside the selected boundary. Your existing drawing has been kept.');
    const n = applyStrokes(res.strokes,
      (!boundary && st.region && st.region.replace) ? st.region.bbox : null, siteKey, targetLayer);
    st.applied = n;
    const points = res.strokes.reduce((k, s) => k + s.length, 0);
    /* the result names counts, never the machinery: what the card shows is
       the drawing itself (the strokes, small) and the job numbers */
    const result = { strokes: n, points: points };
    if (traced && Array.isArray(traced.notes) && traced.notes.length) {
      result.notes = uiScrub(traced.notes.join('; '));
    }
    if (res.stopped) result.stopped = 'stopped by the user';
    row.pv = res.strokes;
    row.stats = { strokes: n, points: points, secs: secs(),
      stopped: !!res.stopped };
    toolOk(row, n + ' stroke' + (n === 1 ? '' : 's') + ', ' + points + ' points' +
      (res.stopped ? ' (stopped)' : ''), result);
    /* THE ARCHITECT MUST SEE IT (see FRAMING). Only a finished draw that
       actually put geometry in the document: a stop was the human saying
       enough, and a failure has nothing to look at. */
    if (!res.stopped && n > 0) frameDrawn(row, bboxOf(res.strokes), st.appliedIds);
    return { ok: true, strokes: n, points: points, seconds: secs(), ...(boundary ? { notes: 'Generated strokes were clipped to the actual site polygon. Verify room dimensions and completeness before using the plan.' } : {}) };
  };

// --- END MIGRATED SLICE ---

export const migrated=true;
export default {};
