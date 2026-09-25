/** RAW extract DOM + mentions + history + BYOK — to be modularized
 * ================================================================== */
  let root = null, thread = null, input = null, chips = null;
  let sendBtn = null, modelEl = null, fileEl = null, keysEl = null, creditEl = null;

  const build = () => {
    root = document.getElementById('agent-panel');
    if (!root) {
      root = el('aside', 'hidden');
      root.id = 'agent-panel';
      const ws = document.getElementById('workspace');
      if (ws) ws.appendChild(root); else document.body.appendChild(root);
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
          '<textarea id="ag-input" rows="1" spellcheck="false" ' +
            'placeholder="Plan, describe a drawing, / for presets"></textarea>' +
          '<div class="ag-bar">' +
            '<button class="ag-pill" id="ag-mode" title="Mode">' +
              icon('ai-inf', 13) + '<span>Agent</span>' + icon('ai-chev', 12) +
            '</button>' +
            '<button class="ag-model" id="ag-model" title="Model — click to change">' +
              '<span class="ag-model-ico" id="ag-model-ico">' + icon('ai-lock', 11) + '</span>' +
              '<span id="ag-model-name"></span>' + icon('ai-chev', 10) + '</button>' +
            '<button class="ag-model ag-credit hidden" id="ag-credit" title="Your balance — click to add credit">' +
              icon('ai-coin', 11) + '<span id="ag-credit-amt"></span></button>' +
            '<span class="ag-bar-sp"></span>' +
            '<button class="ag-ghost ag-sm" id="ag-pick" title="Pick an element to edit" aria-label="Pick an element to edit" aria-pressed="false">'+icon('ai-pick')+'</button>' +
            '<button class="ag-ghost ag-sm" id="ag-attach" title="Attach a reference — your own plan or sketch">' +
              icon('ai-attach') + '</button>' +
            '<input type="file" id="ag-file" accept="image/*" hidden>' +
            '<button class="ag-send" id="ag-send" title="Send (Enter)">' + icon('ai-send') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ag-keys hidden" id="ag-keys"></div>';

    thread = root.querySelector('#ag-thread');
    input = root.querySelector('#ag-input');
    chips = root.querySelector('#ag-chips');
    sendBtn = root.querySelector('#ag-send');
    modelEl = root.querySelector('#ag-model-name');
    keysEl = root.querySelector('#ag-keys');
    creditEl = root.querySelector('#ag-credit');
    creditEl.addEventListener('click', () => openSite(st.account?.unlimitedAi ? '/account' : '/pricing#lifetime'));

    root.querySelector('#ag-new').addEventListener('click', () => API.reset());
    root.querySelector('#ag-collapse').addEventListener('click', () => API.close());
    root.querySelector('#ag-keys-btn').addEventListener('click', () => toggleKeys());
    fileEl = root.querySelector('#ag-file');
    root.querySelector('#ag-attach').addEventListener('click', () => {
      if (fileEl) { fileEl.value = ''; fileEl.click(); }
    });
    if (fileEl) fileEl.addEventListener('change', () => {
      const f = fileEl.files && fileEl.files[0];
      if (f) API.attachImage(f);
    });
    root.querySelector('#ag-history').addEventListener('click', openHistory);
    root.querySelector('#ag-pick').addEventListener('click',startPicker);
    root.querySelector('#ag-more').addEventListener('click', (e) => openMenu(e.currentTarget, [
      { label: 'Clear conversation', run: () => API.reset() },
      { label: 'Copy transcript', run: () => copyTranscript() },
      { label: 'Agent settings…', run: () => openKeys() }
    ]));
    root.querySelector('#ag-mode').addEventListener('click', (e) =>
      openMenu(e.currentTarget, [{ label: 'Agent', checked: true }]));
    root.querySelector('#ag-model').addEventListener('click', (e) => openModelMenu(e.currentTarget));
    sendBtn.addEventListener('click', () => { if (st.running) API.stop(); else API.send(); });

    input.addEventListener('input',()=>{grow();openMentionMenu();});
    input.addEventListener('keydown',e=>{if(e.key==='Backspace'&&!input.value&&chips.children.length){e.preventDefault();chips.lastElementChild.querySelector('button')?.click();}});
    input.addEventListener('keydown',e=>{if(menuEl?.handleKey)menuEl.handleKey(e);},true);
    input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();API.send();}});

    setModel(null);
    const boot = byokAPI();
    if (boot) {
      boot.get().then((r) => {
        st.byok = r || null;
        if (r && r.provider) st.provider = r.provider;
        /* on the site the composer's model is the account's word */
        if (r && r.model && !r.web) setModel(r.model);
      }, () => {});
    }
    renderEmpty();
    renderChips();
  };

  /* ---- composer auto-grow (1 -> 8 rows) ---- */
  const grow = () => {
    if (!input) return;
    const line = parseFloat(getComputedStyle(input).lineHeight) || 20;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, Math.round(line * MAX_ROWS)) + 'px';
  };

  /* ---- one small menu, three users: history, overflow, mode ---- */
  let menuEl = null;
  const closeMenu = () => { input?.setAttribute('aria-expanded','false');input?.removeAttribute('aria-activedescendant');highlightSel(null); if (menuEl) { menuEl.remove(); menuEl = null; } };
  const openMenu = (anchor, items) => {
    closeMenu();
    const list = (items && items.length) ? items : [{ label: 'Nothing yet', disabled: true }];
    const m = el('div', 'ag-menu');
    for (const it of list) {
      const b = el('button', 'ag-menu-item' + (it.checked ? ' on' : ''), esc(it.label));
      if (it.disabled) b.disabled = true;
      else b.addEventListener('click', () => { closeMenu(); if (it.run) it.run(); });
      m.appendChild(b);
    }
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    const box = m.getBoundingClientRect();
    const w = box.width, h = box.height;
    m.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8))) + 'px';
    /* below the anchor when it fits, above it when the anchor sits at the
       bottom of the window (the composer's chips do) — a menu clipped by
       the window's edge is a menu nobody can pick from */
    const below = r.bottom + 4;
    const top = (below + h <= window.innerHeight - 8) ? below : Math.max(8, r.top - 4 - h);
    m.style.top = Math.round(top) + 'px';
    menuEl = m;
  };
  document.addEventListener('pointerdown', (e) => {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  }, true);

  /* ================================================================ *
   * @-MENTIONS — type @ in the composer and pick a selection.
   * The menu lists every sel-N (and every closed boundary as site-N);
   * hovering an entry LIGHTS THAT SELECTION UP on the canvas, so with
   * three anonymous rectangles on screen you can see which is which
   * before you commit to a name. Picking inserts the id into the text;
   * the agent already knows what to do with it.
   * ================================================================ */
  const REFERENCE_LABELS={area:'Area',boundary:'Boundary'};
  const PLAN_STAGE_LABELS={analyze:'Site analysis',program:'Room program',preview:'Layout preview',commit:'Place checked plan',review:'Review plan',repair:'Repair plan'};
  const HISTORY_TOOL_LABELS={review_design:'Design critique',cad_library:'CAD library',cad_document:'Drawing operation',cad_workspace:'Drawing workspace',draw_plan:'Plan layout',draw_cad:'Generate detail',complete:'Completed',incomplete:'Incomplete'};
  let mentionHi = null;      /* aisel currently highlighted from the menu */

  const highlightSel = (n) => {
    if (mentionHi === n) return;
    mentionHi = n;
    if (typeof N.render === 'function') N.render();
  };

  const clearTarget = () => {st.referenceOwned=new Set();st.picked=null;st.reference=st.reference&&!st.reference.region?st.reference:null;st.attachment=null;st.region=null;renderRegionBox();renderChips();};
  const referenceSummary = () => {
    const out=[];
    if(st.picked)out.push({kind:'element',label:st.picked.label});
    else if(st.region?.aisel!=null)out.push({kind:'area',label:REFERENCE_LABELS.area+' '+st.region.aisel});
    else if(st.attachment)out.push({kind:'boundary',label:st.attachment.label});
    if(st.reference&&!st.reference.region)out.push({kind:'image',label:st.reference.name});
    return out;
  };
  const pickElement = entity => {
    if(!entity||!N.doc.entities.includes(entity)||entity.aisel)return false;
    clearTarget();const layer=N.doc.layers.find(l=>l.id===entity.layerId);
    st.picked={ids:[String(entity.id)],doc:N.doc,label:(entity.name||entity.type)+' · '+(layer?.name||'0')};
    st.contextDoc=N.doc;N.setSelection([entity.id]);API.open();renderChips();input.focus();return true;
  };
  let pickerCleanup=null;
  const cancelPicker=()=>{if(pickerCleanup)pickerCleanup();};
  const startPicker=()=>{
    if(st.running){toast('Wait for the current response before picking an element.');return;}
    if(pickerCleanup){cancelPicker();return;}
    const canvas=document.getElementById('overlay-canvas');if(!canvas||!N.pickAgentEntity)return;
    const doc=N.doc,oldSelection=new Set(N.selection),oldCursor=canvas.style.cursor;let hit=null,accepted=false;
    const button=root.querySelector('#ag-pick');button.classList.add('on');button.setAttribute('aria-pressed','true');canvas.style.cursor='default';
    toast('Point to an element and click. Esc cancels.');
    const over=e=>{const b=canvas.getBoundingClientRect();return e.clientX>=b.left&&e.clientX<=b.right&&e.clientY>=b.top&&e.clientY<=b.bottom&&!root.contains(e.target);};
    const move=e=>{if(N.doc!==doc){cancelPicker();return;}if(!over(e))return;
      const b=canvas.getBoundingClientRect(),w=N.viewport.screenToWorld({x:e.clientX-b.left,y:e.clientY-b.top});const next=N.pickAgentEntity(w);
      if(next===hit)return;hit=next;N.selection=new Set(hit?[hit.id]:[]);N.render();
    };
    const down=e=>{if(!over(e)||e.button!==0)return;e.preventDefault();e.stopImmediatePropagation();move(e);};
    const up=e=>{if(!over(e)||e.button!==0)return;e.preventDefault();e.stopImmediatePropagation();move(e);if(hit){accepted=true;const entity=hit;cancelPicker();pickElement(entity);}};
    const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancelPicker();}};
    document.addEventListener('pointermove',move,true);document.addEventListener('pointerdown',down,true);document.addEventListener('mousedown',down,true);document.addEventListener('pointerup',up,true);document.addEventListener('keydown',key,true);
    pickerCleanup=()=>{document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerdown',down,true);document.removeEventListener('mousedown',down,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('keydown',key,true);canvas.style.cursor=oldCursor;button.classList.remove('on');button.setAttribute('aria-pressed','false');pickerCleanup=null;if(!accepted&&N.doc===doc){N.setSelection(oldSelection);}};
  };
  const mentionItems = () => {
    const areas=selEntities(), sites=listSites(), represented=new Set(),out=[];
    for(const e of areas){const b=selBounds(e),site=b&&largestBoundaryIn(b);if(site)site.ids.forEach(id=>represented.add(String(id)));out.push({id:'sel-'+e.aisel,label:REFERENCE_LABELS.area+' '+e.aisel,aisel:e.aisel,entity:e});}
    for(const s of sites)if(!s.ids.some(id=>represented.has(String(id))))out.push({id:s.id,label:REFERENCE_LABELS.boundary+' '+s.id.split('-')[1],aisel:null,site:s});
    for(const e of (N.doc?.entities||[]).filter(e=>N.selection?.has(e.id)&&!e.aisel).slice(0,12))if(!sites.some(s=>s.ids.includes(e.id)))out.push({id:'element-'+e.id,label:(e.name||e.type)+' · '+(N.doc.layers.find(l=>l.id===e.layerId)?.name||'0'),entity:e});
    return out;
  };
  const mentionToken = () => {const pos=input.selectionStart??input.value.length;const match=/@([^@\s]*)$/.exec(input.value.slice(0,pos));return match?{start:pos-match[0].length,end:pos,query:match[1]}:null;};
  const insertMention = item => {
    if(!input)return;const token=mentionToken(),v=input.value;
    if(item.aisel!=null){clearTarget();const e=item.entity,b=selBounds(e);const site=largestBoundaryIn(b);st.region={selId:e.id,aisel:e.aisel,bbox:{...b},silent:true,site:true,replace:true,pts:site?.pts||null,landKey:site?.ids[0]||e.id,ratio:nearestRatio(b.maxx-b.minx,b.maxy-b.miny),text:'',ran:false};st.contextDoc=N.doc;}
    else if(item.site){clearTarget();N.setSelection(item.site.ids);API.attachSelection();if(st.attachment)st.attachment.label=item.label;}
    else pickElement(item.entity);
    // The reference is a removable pill, not an ambiguous word in the prompt.
    if(token){input.value=v.slice(0,token.start)+v.slice(token.end);input.setSelectionRange(token.start,token.start);}
    renderChips();grow();input.focus();
  };
  const openMentionMenu = () => {
    const token=mentionToken();if(!token){if(menuEl?.classList.contains('ag-mentions'))closeMenu();return false;}
    const items=mentionItems().filter(it=>(it.label+' '+it.id).toLowerCase().includes(token.query.toLowerCase()));
    closeMenu();const m=el('div','ag-menu ag-mentions');m.setAttribute('role','listbox');m.id='ag-mention-options';input.setAttribute('aria-controls',m.id);input.setAttribute('aria-expanded','true');
    let active=0;
    const buttons=items.map((it,i)=>{const b=el('button','ag-menu-item',icon(it.id.startsWith('element-')?'ai-pick':'ai-vector',14)+'<span>'+esc(it.label)+'</span>');b.id='ag-mention-'+i;b.setAttribute('role','option');b.addEventListener('pointerdown',e=>e.preventDefault());b.addEventListener('mouseenter',()=>{active=i;paint();highlightSel(it.aisel);});b.addEventListener('click',()=>{highlightSel(null);closeMenu();insertMention(it);});m.appendChild(b);return b;});
    const paint=()=>{buttons.forEach((b,i)=>{b.classList.toggle('on',i===active);b.setAttribute('aria-selected',String(i===active));});if(buttons[active])input.setAttribute('aria-activedescendant',buttons[active].id);};
    if(!items.length)m.appendChild(el('div','ag-history-note','Mark an area or pick an element to reference it.'));
    m.handleKey=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeMenu();return;}if(['ArrowDown','ArrowUp'].includes(e.key)&&items.length){e.preventDefault();e.stopImmediatePropagation();active=(active+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;paint();highlightSel(items[active].aisel);}if((e.key==='Enter'||e.key==='Tab')&&items.length){e.preventDefault();e.stopImmediatePropagation();buttons[active].click();}};
    document.body.appendChild(m);const r=input.getBoundingClientRect();m.style.left=Math.max(8,Math.min(r.left,innerWidth-m.offsetWidth-8))+'px';m.style.top=Math.max(8,r.top-m.offsetHeight-6)+'px';menuEl=m;paint();return true;
  };

  // Conversation content is account-owned on the server. Opening it never
  // executes stored tool calls or imports geometry into the active drawing.
  const drawingIdentity = () => {
    const d=N.doc;if(!d)return null;
    // Stable for saved desktop files, without transmitting a local path.
    let id=d.chatDrawingId;
    if(d.path){let hash=2166136261;for(const c of String(d.path)){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}id='file-'+(hash>>>0).toString(36);}
    if(!id)id=d.chatDrawingId='drawing-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
    return {id,name:String(d.name||'Untitled drawing').split(/[\\/]/).pop()};
  };
  let historyPane=null, historyEpoch=0, historySearchTimer=null, historyBinding=null;
  const closeHistory = () => {historyEpoch++;clearTimeout(historySearchTimer);if(historyPane)historyPane.remove();historyPane=null;root?.querySelector('#ag-history')?.focus();};
  const paintHistoryBinding = () => {
    if(historyBinding)historyBinding.remove();historyBinding=null;
    if(!st.convId)return;
    const current=drawingIdentity();
    const same=st.boundDocument===N.doc || st.conversationDrawing && current && st.conversationDrawing.id===current.id;
    if(same){st.boundDocument=N.doc;st.conversationDrawing=current;}
    st.historyReadOnly=!same;
    const bar=el('div','ag-chat-context');
    const title=el('span','',esc(st.conversationTitle||'Conversation'));bar.appendChild(title);
    const detail=el('small','',esc(same ? current.name : st.conversationDrawing?.name || 'Earlier conversation'));bar.appendChild(detail);
    if(!same){
      const note=el('p','','Open the original drawing, or choose the current drawing to continue.');bar.appendChild(note);
      const b=el('button','ag-setup-btn','Continue in current drawing');b.disabled=!current;
      b.addEventListener('click',()=>{API.closeRegion();st.picked=null;st.reference=null;st.conversationDrawing=drawingIdentity();st.boundDocument=N.doc;st.rebound=true;renderChips();paintHistoryBinding();input.focus();});bar.appendChild(b);
    }
    root.querySelector('.ag-head').after(bar);historyBinding=bar;
  };
  const renderSavedMessage = m => {
    if(m.role==='tool'){const parts=m.text.split(' · '),name=parts[0].replace(/ /g,'_');return el('div','ag-history-tool',icon(parts[1]==='Incomplete'?'ai-close':'ai-check',12)+'<span>'+esc((HISTORY_TOOL_LABELS[name]||parts[0])+' · '+(parts[1]==='Incomplete'?HISTORY_TOOL_LABELS.incomplete:HISTORY_TOOL_LABELS.complete))+'</span>');}
    const node=el('div',m.role==='user'?'ag-user':'ag-answer',esc(m.text));
    if(m.references?.length){const refs=el('div','ag-message-refs');for(const ref of m.references)refs.appendChild(el('span','ag-ref-pill',icon(ref.kind==='element'?'ai-pick':ref.kind==='image'?'ai-image':'ai-vector',12)+esc(ref.label)));node.prepend(refs);}
    return node;
  };
  const loadConversation = async id => {
    if(st.running){toast('Stop the current response before opening another conversation.');return false;}
    const epoch=++historyEpoch;
    try{
      const get=bridge().agentHistory;if(!get)throw Error('Update the application to browse saved conversations.');
      const page=await get({id});if(epoch!==historyEpoch)return false;
      API.reset();st.convId=page.id;st.conversationTitle=page.title;st.conversationDrawing=page.drawing;st.boundDocument=null;thread.innerHTML='';
      const append=items=>{for(const m of items){thread.appendChild(renderSavedMessage(m));if(m.role!=='tool')st.messages.push({role:m.role,text:m.text});}};append(page.messages);
      let before=page.before;
      if(before!=null){
        const older=el('button','ag-history-older','Load earlier messages');thread.prepend(older);
        older.addEventListener('click',async()=>{older.disabled=true;const target=st.convId;try{const more=await get({id:target,before});if(st.convId!==target)return;
          const fragment=document.createDocumentFragment();for(const m of more.messages)fragment.appendChild(renderSavedMessage(m));older.after(fragment);
          st.messages.unshift(...more.messages.filter(m=>m.role!=='tool').map(m=>({role:m.role,text:m.text})));before=more.before;if(before==null)older.remove();
        }catch(e){toast(errText(e));}finally{older.disabled=false;}});
      }
      closeHistory();paintHistoryBinding();thread.scrollTop=thread.scrollHeight;input.focus();return true;
    }catch(e){if(epoch===historyEpoch)toast(errText(e));return false;}
  };
  const openHistory = () => {
    closeHistory();closeMenu();
    historyPane=el('section','ag-history-pane');historyPane.setAttribute('aria-label','Chat history');
    historyPane.innerHTML='<div class="ag-history-head"><strong>Chat history</strong><button class="ag-ghost" title="Close history">'+icon('ai-close')+'</button></div><input class="ag-history-search" type="search" placeholder="Search conversations" aria-label="Search conversations"><div class="ag-history-list" aria-live="polite"></div>';
    root.appendChild(historyPane);const pane=historyPane,search=pane.querySelector('input'),list=pane.querySelector('.ag-history-list');
    pane.querySelector('button').addEventListener('click',closeHistory);pane.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();closeHistory();}});
    let cursor=null;
    const load=async more=>{const epoch=++historyEpoch;if(!more)list.innerHTML='<p class="ag-history-note">Loading conversations…</p>';
      try{const get=bridge().agentHistory;if(!get)throw Error('Update the application to browse saved conversations.');
        const result=await get({q:search.value,cursor:more?cursor:null});if(epoch!==historyEpoch||historyPane!==pane)return;
        if(!more)list.innerHTML='';list.querySelector('.ag-history-more')?.remove();cursor=result.cursor;
        for(const row of result.items){const b=el('button','ag-history-item');const title=el('strong','',esc(row.title));b.appendChild(title);b.appendChild(el('small','',esc((row.drawing?.name?row.drawing.name+' · ':'')+new Date(row.updatedAt).toLocaleString())));if(row.id===st.convId)b.setAttribute('aria-current','true');b.addEventListener('click',()=>loadConversation(row.id));list.appendChild(b);}
        if(!list.children.length)list.appendChild(el('p','ag-history-note',search.value?'No matching conversations.':'Your saved conversations will appear here.'));
        if(cursor){const b=el('button','ag-history-more','Load more conversations');b.addEventListener('click',()=>{b.disabled=true;load(true);});list.appendChild(b);}
      }catch(e){if(epoch!==historyEpoch)return;if(!more)list.innerHTML='';list.appendChild(el('p','ag-error',esc(errText(e))));const retry=el('button','ag-history-more','Retry');retry.addEventListener('click',()=>load(false));list.appendChild(retry);}
    };
    search.addEventListener('input',()=>{historyEpoch++;clearTimeout(historySearchTimer);historySearchTimer=setTimeout(()=>load(false),220);});load(false);search.focus();
  };

  window.addEventListener('nasj:doc',()=>{if(st.contextDoc&&st.contextDoc!==N.doc){if(st.running)API.stop();cancelPicker();clearTarget();st.contextDoc=N.doc;}if(st.convId)paintHistoryBinding();});

  const copyTranscript = () => {
    const text = st.messages.map((m) => m.role.toUpperCase() + ': ' + m.text).join('\n\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('Transcript copied.'),
        () => toast('The transcript could not be copied.'));
    }
  };

  /* ================================================================ *
   * BYOK — the user's own keys, edited in a slide-over. Only STATUS
   * ever comes back from the main process ({set, source, tail}); the
   * stored key itself never crosses into the renderer.
   * ================================================================ */
  const WORKSPACE_LABELS = {working_copy:'Working drawing base',symbols:'Drafting symbols',design_context:'Inspect plan function',drawing_review:'Review drawing quality',coordination_review:'Review sheet coordination',symbol_register:'Register drawing symbol',symbol_legend:'Generate symbol legend',service_network:'Draw service network',symbol_catalog:'Symbol catalogue',skill:'Engineering guide',skills:'Engineering guides',snapshot:'Inspect drawing image',quantities:'Measure drawing',building_read:'Building model',building_set:'Building model',building_from_plan:'Building model',elevation:'Derived elevation',section:'Derived section'};
  const WORKSPACE_SUMMARY_LABELS = {working_copy:'Created a separate working base; original preserved.',symbols:'Added editable symbols on discipline layers.',design_context:'Inspect plan function',drawing_review:'Review drawing quality',coordination_review:'Review sheet coordination',symbol_register:'Register drawing symbol',symbol_legend:'Generate symbol legend',service_network:'Draw service network',symbol_catalog:'Available native drafting symbols.',skill:'Guide loaded for this task.',skills:'Available engineering guides.',snapshot:'Captured the current drawing for visual review.',quantities:'Geometric quantities grouped by layer.',building_read:'Checked the model and its source geometry.',building_set:'Saved the shared building model.',building_from_plan:'Saved the shared building model.',elevation:'Created an elevation from the shared model.',section:'Created a section from the shared model.'};
  const PROVIDER_LIST = [
    {id:'deepseek',label:'DeepSeek',vendor:'DeepSeek',ph:'sk-…',keyField:'DEEPSEEK_API_KEY',modelField:'DEEPSEEK_MODEL',models:['deepseek-flash']},
    { id: 'openrouter', label: 'OpenRouter', vendor: 'OpenRouter', ph: 'sk-or-…',
      keyField: 'OPENROUTER_API_KEY', modelField: 'OPENROUTER_MODEL',
      models: ['meta/muse-spark-1.3-contributor'] },
    { id: 'custom', label: 'Custom', vendor: 'OpenAI-compatible', ph: 'sk-…',
      keyField: 'CUSTOM_API_KEY', modelField: 'CUSTOM_MODEL',
      models: [] },
  ];
  let keysOpen = false;
  /* the read behind the last open: an answer older than what the user did
     since (signed out, saved) would paint a stale layout, so it is dropped */
  let keysRead = 0;

  const providerOf = (id) => PROVIDER_LIST.find((p) => p.id === id) || PROVIDER_LIST[0];

  /* the store behind the slide-over — the QA stub first, then the bridge */
  const byokAPI = () => {
    const a = (stub && typeof stub.byokGet === 'function') ? stub : (window.nasjAPI || {});
    return (typeof a.byokGet === 'function' && typeof a.byokSet === 'function')
      ? { get: a.byokGet.bind(a), set: a.byokSet.bind(a) } : null;
  };

  /* the NASJI model on the account: the one bound from the dashboard, or
     the one the agent runs on while no key of the user's is in charge */
  const nasjiModelLabel = (acct) => {
    if (!acct) return '';
    if (acct.boundModel && acct.boundModel.label) return acct.boundModel.label;
    if (acct.model && acct.model.label && !acct.model.byok) return acct.model.label;
    return '';
  };

  const openModelMenu = (anchor) => {
    /* on the site the choice is the account's: the NASJI model on the
       balance, or the user's own key — the settings hold the switch, the
       menu names where it stands and steps back to NASJI in one click */
    const acct = st.account;
    if (acct && acct.model) {
      const own = !!acct.model.byok;
      const nasji = nasjiModelLabel(acct);
      openMenu(anchor, [
        { label: 'NASJI model' + (nasji ? ' · ' + nasji : ''), checked: !own,
          run: () => { if (own) byokSave({ BYOK_ACTIVE: '0' }, null, 'The NASJI model runs now.'); } },
        { label: own ? 'Your own key · ' + (acct.model.label || '') : 'Your own key…', checked: own,
          run: () => openKeys() }
      ]);
      return;
    }
    const spec = providerOf(st.provider);
    const cur = st.model || spec.models[0] || MODEL_FALLBACK;
    const items = spec.models.map((m) => ({
      label: m,
      checked: m === cur,
      run: () => {
        setModel(m);
        const B = byokAPI();
        if (B) B.set({ AGENT_MODEL: m, [spec.modelField]: m }).catch(() => {});
      }
    }));
    openMenu(anchor, items.concat([{ label: 'Agent settings…', run: () => openKeys() }]));
  };

  /* Saving goes through the store; its answer is the fresh status, which
     repaints the slide-over while it is open. On the site what the agent
     runs on is the account's word, so the account is read again after. */
  const byokSave = (patch, btn, okMsg) => {
    const B = byokAPI();
    if (!B) { toast('Key storage is not available in this build.'); return Promise.resolve(null); }
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    return B.set(patch).then((r) => {
      keysRead++;
      if (r) st.byok = r;
      if (r) track('byok_set', { provider: String(r.provider || ''), web: !!r.web }, r.provider);
      if (r && r.provider) st.provider = r.provider;
      if (r && r.model && !r.web) setModel(r.model);
      if (okMsg) toast(okMsg);
      if (keysOpen) renderKeys(r);
      if (r && r.web) refreshAccount();
      return r;
    }, (e) => {
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
      const why = errText(e);
      toast(why && why.length < 80 ? why : 'That could not be saved.');
      return null;
    });
  };

  const keyStatusHtml = (s2, kName) => {
    if (!s2 || !s2.set) return '<span class="ag-key-dot off"></span>Not set';
    const who = s2.source === 'you' ? 'your key' : 'built-in';
    return '<span class="ag-key-dot on"></span>Active — ' + esc(who) +
      (s2.tail ? ' · ends in ' + esc(s2.tail) : '') +
      (s2.source === 'you' && kName
        ? '<button type="button" class="ag-key-x" data-k="' + kName + '">Remove</button>' : '');
  };

  const renderKeys = (status) => {
    if (!keysEl) return;
    const s2 = status || {};
    const provider = s2.provider || st.provider || 'openrouter';
    st.provider = provider;
    const spec = providerOf(provider);
    const keySt = s2[provider] || s2.agent || s2.openrouter;
    const keySet = !!(keySt && keySt.set);
    /* on the site an empty model means the provider's default, which is
       the first chip; the composer's st.model is the account's word there
       and says nothing about the key's model */
    const curModel = s2.model || (s2.web ? '' : st.model) || spec.models[0] || MODEL_FALLBACK;
    const inputVal = s2.model || (s2.web ? '' : st.model || '');
    const acct = st.account;
    const fee = acct && acct.drawCadPrice ? acct.drawCadPrice : null;
    /* the desktop signs in as a device: the account it holds is named
       here, with the way out */
    const desktopAcct = typeof (window.nasjAPI || {}).accountSignOut === 'function';
    const email = acct && acct.user && acct.user.email ? String(acct.user.email) : '';
    /* THE ONE CHOICE on the site: the user's key runs while it is saved and
       switched on; before a key is saved "your own key" is only a wish,
       kept here until one is pasted. Off the site the keys are all there is. */
    const own = !s2.web || (keySet ? s2.active !== false : !!st.wantOwn);

    const field = (id, name, vendor, ph, kName, stt, type) =>
      '<div class="ag-field">' +
        '<div class="ag-field-top"><span class="ag-field-name">' + esc(name) + '</span>' +
          '<span class="ag-field-vendor">' + esc(vendor) + '</span></div>' +
        '<div class="ag-key-row">' +
          '<input type="' + (type || 'password') + '" id="' + id + '" placeholder="' + esc(ph) + '" ' +
            'autocomplete="off" spellcheck="false" data-k="' + kName + '">' +
          '<button class="ag-key-save" data-for="' + id + '">Save</button>' +
        '</div>' +
        '<div class="ag-field-status">' + keyStatusHtml(stt, kName) + '</div>' +
      '</div>';
    const chips = spec.models.map((m) =>
      '<button type="button" class="ag-model-chip' + (m === curModel ? ' on' : '') +
        '" data-m="' + esc(m) + '">' + esc(m) + '</button>').join('');
    const choice = (id, on, ico, head, sub) =>
      '<button type="button" class="ag-choice-btn' + (on ? ' on' : '') + '" data-c="' + id + '">' +
        '<span class="ag-choice-ico">' + ico + '</span>' +
        '<span class="ag-choice-txt"><strong>' + esc(head) + '</strong><small>' + sub + '</small></span>' +
        '<span class="ag-choice-dot"></span>' +
      '</button>';
    /* the key, its model and its host — the same four fields on both hosts;
       the desktop's own store adds the drafting key */
    const ownFields =
      '<div class="ag-field">' +
        '<div class="ag-field-top"><span class="ag-field-name">Provider</span></div>' +
        '<div class="ag-seg ag-seg-wide" id="ag-seg-provider">' +
          PROVIDER_LIST.map((p) => '<button type="button" class="ag-seg-btn' +
            (p.id === provider ? ' on' : '') + '" data-p="' + p.id + '">' +
            esc(p.label) + '</button>').join('') +
        '</div>' +
      '</div>' +
      field('ag-key-ds', 'Reasoning key', spec.vendor, spec.ph, spec.keyField, keySt) +
      '<div class="ag-field">' +
        '<div class="ag-field-top"><span class="ag-field-name">Model</span>' +
          '<span class="ag-field-vendor">any name the account accepts</span></div>' +
        '<div class="ag-key-row">' +
          '<input type="text" id="ag-model-input" placeholder="' + esc(spec.models[0] || 'model-id') + '" ' +
            'autocomplete="off" spellcheck="false" value="' + esc(inputVal) + '">' +
          '<button class="ag-key-save" data-for="ag-model-input">Save</button>' +
        '</div>' +
        (chips ? '<div class="ag-model-chips">' + chips + '</div>' : '') +
      '</div>' +
      '<div class="ag-field">' +
        '<div class="ag-field-top"><span class="ag-field-name">Base URL</span>' +
          '<span class="ag-field-vendor">' +
            (provider === 'custom' ? 'required' : 'optional override') +
          '</span></div>' +
        '<div class="ag-key-row">' +
          '<input type="text" id="ag-base-url" placeholder="https://api.example.com/v1" ' +
            'autocomplete="off" spellcheck="false" value="' + esc(s2.baseUrl || '') + '">' +
          '<button class="ag-key-save" data-for="ag-base-url">Save</button>' +
        '</div>' +
        '<div class="ag-field-status">OpenAI-compatible hosts, a local server, ' +
          'or a full …/chat/completions URL.</div>' +
      '</div>' +
      (s2.web ? '' : field('ag-key-gm', 'Drafting key', 'your draughting account', 'AIza…',
        'GEMINI_API_KEY', s2.gemini));

    let body;
    if (s2.loading) {
      body = '<div class="ag-keys-hero">' + icon('ai-gear', 22) + '<p>Reading your settings…</p></div>';
    } else if (s2.signedOut) {
      body =
        '<div class="ag-keys-hero">' + icon('ai-user', 22) +
          '<p>Sign in to ' + (desktopAcct ? 'use the agent and ' : '') + 'choose what it runs on: ' +
          'the NASJI model on your balance, or a key of your own.</p></div>' +
        '<button class="ag-setup-btn ag-keys-signin" type="button">Sign in</button>';
    } else if (s2.web) {
      const nasji = nasjiModelLabel(acct);
      const bal = acct && typeof acct.balanceMicro === 'number'
        ? (acct.balance || fmtMicro(acct.balanceMicro)) : '';
      const ownSub = acct?.unlimitedAi ? 'Your provider bills usage on your own key; NASJI visual generation is included' : keySet
        ? esc(spec.label) + ' · ends in ' + esc(keySt.tail || '') +
          (s2.active === false ? ' · saved, off' : ' · no token charge')
        : 'Use your key for reasoning; visual detail generation is billed separately';
      const nasjiNote = acct?.unlimitedAi ? 'Unlimited AI is active. NASJI model usage and visual generation are included. No credit top-ups.' : acct && acct.model && acct.model.error && !nasji
        ? esc(acct.model.error)
        : '<strong>' + esc(nasji || 'The NASJI model') + '</strong> runs on your balance' +
          (bal ? ' — <strong>' + esc(bal) + '</strong>' : '') + '. Tokens are charged at the ' +
          'model\'s price' + (fee ? ', and visual detail generation costs ' + esc(fee) : '') + '.';
      body =
        (desktopAcct && email
          ? '<div class="ag-keys-who">' + icon('ai-user', 14) +
              '<span class="ag-keys-mail">' + esc(email) + '</span>' +
              '<button class="ag-keys-signout" type="button">Sign out</button></div>'
          : '') +
        '<div class="ag-field">' +
          '<div class="ag-field-top"><span class="ag-field-name">The agent runs on</span></div>' +
          '<div class="ag-choice" id="ag-choice">' +
            choice('nasji', !own, '<img src="../logo.png" alt="" width="24" height="24">',
              'NASJI model', esc(nasji || 'the site\'s model') + (acct?.unlimitedAi ? ' · included with Unlimited AI' : ' · tokens from your balance')) +
            choice('own', own, icon('ai-key', 18), 'Your own key', ownSub) +
          '</div>' +
        '</div>' +
        (own
          ? '<div class="ag-keys-hero">' + icon('ai-key', 22) +
              (acct?.unlimitedAi ? '<p>Your provider bills usage on your own key. NASJI visual generation is included. The key is stored ' : '<p>The reasoning runs on your key — no token charge here. Visual detail generation still ' +
              'costs the generation fee' + (fee ? ' (' + esc(fee) + ')' : '') + '. The key is stored ') +
              'encrypted on your account and never shown again once saved.</p></div>' +
            ownFields
          : '<div class="ag-keys-hero">' + icon('ai-coin', 22) +
              '<div><p>' + nasjiNote + '</p>' +
              (acct?.unlimitedAi ? '' : '<button class="ag-setup-btn ag-keys-credit" type="button">Get Unlimited AI</button>') + '</div>' +
            '</div>');
    } else {
      body =
        '<div class="ag-keys-hero">' + icon('ai-key', 22) +
          '<p>The agent runs on your own accounts. Keys are stored on this machine only ' +
          'and never shown again once saved.</p></div>' +
        ownFields;
    }
    keysEl.innerHTML =
      '<div class="ag-keys-head">' +
        '<button class="ag-ghost" id="ag-keys-back" title="Back">' + icon('ai-back') + '</button>' +
        '<span class="ag-keys-title">Agent settings</span>' +
      '</div>' +
      '<div class="ag-keys-body">' + body + '</div>';

    keysEl.querySelector('#ag-keys-back').addEventListener('click', () => closeKeys());
    const signin = keysEl.querySelector('.ag-keys-signin');
    if (signin) signin.addEventListener('click', () => {
      const a = window.nasjAPI || {};
      if (typeof a.accountSignIn !== 'function') { openSite('/login?next=/cad'); return; }
      /* the code card lives in the thread; the slide-over gives way to it */
      closeKeys();
      signIn();
    });
    const signout = keysEl.querySelector('.ag-keys-signout');
    if (signout) signout.addEventListener('click', () => {
      signout.disabled = true;
      window.nasjAPI.accountSignOut().then(() => {
        API.reset();
        keysRead++;
        st.account = null;
        st.byok = null;
        st.wantOwn = false;
        paintCredit();
        renderKeys({ signedOut: true, web: true });
        toast('Signed out.');
      }, (e) => {
        signout.disabled = false;
        toast(errText(e) || 'That did not work.');
      });
    });
    const credit = keysEl.querySelector('.ag-keys-credit');
    if (credit) credit.addEventListener('click', () => openSite('/pricing#lifetime'));
    for (const btn of keysEl.querySelectorAll('.ag-choice-btn')) {
      btn.addEventListener('click', () => {
        const toOwn = btn.dataset.c === 'own';
        if (toOwn === own) return;
        /* with a key saved the switch is the account's; without one it is
           only which fields are up */
        if (keySet) {
          byokSave({ BYOK_ACTIVE: toOwn ? '1' : '0' }, null,
            toOwn ? 'Your key runs now.' : 'The NASJI model runs now.');
          return;
        }
        st.wantOwn = toOwn;
        renderKeys(s2);
        const k = keysEl.querySelector('#ag-key-ds');
        if (toOwn && k) k.focus();
      });
    }
    for (const btn of keysEl.querySelectorAll('.ag-key-x')) {
      btn.addEventListener('click', () => byokSave({ [btn.dataset.k]: '' }, null, 'Key removed.'));
    }
    for (const btn of keysEl.querySelectorAll('.ag-key-save')) {
      btn.addEventListener('click', () => {
        const inp = keysEl.querySelector('#' + btn.dataset.for);
        const v = inp ? inp.value.trim() : '';
        if (btn.dataset.for === 'ag-model-input') {
          if (!v) { toast('Type a model name first.'); return; }
          byokSave({ AGENT_MODEL: v, [spec.modelField]: v }, btn, 'Model saved.');
          return;
        }
        if (btn.dataset.for === 'ag-base-url') {
          byokSave({ AGENT_BASE_URL: v }, btn, v ? 'Base URL saved.' : 'Base URL cleared.');
          return;
        }
        if (!v) { toast('Paste a key first.'); return; }
        byokSave({ [inp.dataset.k]: v }, btn, 'Key saved.');
      });
    }
    for (const btn of keysEl.querySelectorAll('#ag-seg-provider .ag-seg-btn')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.p;
        if (!id || id === provider) return;
        st.provider = id;
        byokSave({ AGENT_PROVIDER: id }, null, 'Provider set to ' + providerOf(id).label + '.');
      });
    }
    for (const btn of keysEl.querySelectorAll('.ag-model-chip')) {
      btn.addEventListener('click', () => {
        const m = btn.dataset.m;
        byokSave({ AGENT_MODEL: m, [spec.modelField]: m }, null, 'Model saved.');
      });
    }
  };

  /* Opens on the last status at once — no flash of the wrong layout —
     and reads the store again behind it. */
  const openKeys = () => {
    if (!keysEl) return;
    keysOpen = true;
    const B = byokAPI();
    renderKeys(st.byok || (B ? { loading: true } : null));
    keysEl.classList.remove('hidden');
    const read = ++keysRead;
    if (B) B.get().then((r) => {
      if (read !== keysRead || !keysOpen) return;
      if (r) st.byok = r;
      renderKeys(r);
    }, () => {});
  };

  const closeKeys = () => {
    if (!keysEl) return;
    keysOpen = false;
    keysEl.classList.add('hidden');
    if (input) input.focus();
  };

  const toggleKeys = () => { if (keysOpen) closeKeys(); else openKeys(); };
