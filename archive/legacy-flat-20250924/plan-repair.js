/* Pure plan-revision checks, shared by the panel and regression tests. */
(function(root){
 const clone=x=>JSON.parse(JSON.stringify(x));
 const fingerprint=es=>{let h=2166136261;const s=JSON.stringify(es.map(e=>Object.fromEntries(Object.entries(e).filter(([k])=>!k.startsWith('ai')&&!k.startsWith('$')&&!['selected','id'].includes(k)))));for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);};
 const score=r=>(r.faults||[]).length*10+(r.unfurnished||[]).length;
 const patch=(layout,a)=>{if(!layout||!Array.isArray(layout.rooms))throw Error('This plan has no saved layout. Inspect its geometry instead.');
  const out=clone(layout),updates=a.rooms||[];
  if(!Array.isArray(updates)||updates.length>40)throw Error('Repair at most 40 existing rooms.');
  const seen=new Set();for(const r of updates){if(!r||seen.has(r.id)||!out.rooms.some(x=>x.id===r.id))throw Error('Repair must name unique existing room IDs.');seen.add(r.id);
   if(!['x','y','w','h'].every(k=>typeof r[k]==='number'&&Number.isFinite(r[k]))||r.w<=0||r.h<=0)throw Error('Repair needs finite coordinates and positive room sizes.');
   const old=out.rooms.find(x=>x.id===r.id);if(r.kind!==undefined&&r.kind!==old.kind)throw Error('Repair must preserve room functions; do not relabel a room to hide a finding.');for(const k of ['name','kind','x','y','w','h'])if(r[k]!==undefined)old[k]=r[k];}
  for(const k of ['doors','windows','stairs'])if(a[k]!==undefined){if(!Array.isArray(a[k])||a[k].length>100)throw Error('Invalid repair '+k);out[k]=clone(a[k]);}
  if(!updates.length&&!['doors','windows','stairs'].some(k=>a[k]!==undefined))throw Error('Supply room or opening corrections.');
  out.action='draw';out.mode='replace';return out;
 };
 root.NasjPlanRepair={fingerprint,score,patch};
})(typeof window!=='undefined'?window:globalThis);
