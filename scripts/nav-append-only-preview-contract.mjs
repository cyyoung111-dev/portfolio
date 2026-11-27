// Exact shared preview contract for the existing GAS append-only NAV import.
// Every official source row must appear once in a classified response.
// KB's historical zero-unit rows remain explicitly excluded from writes.
export function validateAppendOnlyNavPreview(preview,code,rows,{allowZeroUnits=false,readback=false}={}){
 const categories=['candidates','identical','updates','warnings','errors','duplicates','zeroUnits'];
 if(preview?.status!=='ok'||preview.code!==code||!categories.every(k=>Array.isArray(preview[k]))
   ||['updates','warnings','errors','duplicates'].some(k=>preview[k].length)
   ||(!allowZeroUnits&&preview.zeroUnits.length)||readback&&preview.candidates.length)
  return {ok:false,reason:'BLOCKED'};
 if(!Array.isArray(rows)||!rows.length)return {ok:false,reason:'MISMATCH'};
 const expected=new Map(rows.map(r=>[r?.date,r?.nav]));
 if(expected.size!==rows.length||rows.some(r=>typeof r?.date!=='string'||!Number.isFinite(r.nav)||r.nav<=0))
  return {ok:false,reason:'MISMATCH'};
 const covered=new Set();
 for(const key of ['candidates','identical','zeroUnits']){
  for(const r of preview[key]){
   const nav=expected.get(r?.date);
   if(nav===undefined||covered.has(r.date)||
      (key==='identical'?(r.existingNav!==nav||r.uploadedNav!==nav):r.nav!==nav))
    return {ok:false,reason:'MISMATCH'};
   covered.add(r.date);
  }
 }
 if(covered.size!==expected.size)return {ok:false,reason:'MISMATCH'};
 return {ok:true,candidates:preview.candidates.map(({date,nav})=>({date,nav}))};
}

// getFundValuationStatus only emits dates with positive configured units.
// An emitted row with no calculated valuation is an unresolved active
// position, not a successful "not required" row.
export function hasCompleteFundDerivedProof(row){
 return row?.valuationRequired===true&&row.unitsApplied===true&&row.reconciled===true
  &&['EXISTING_CONFIRMED','NON_PUBLICATION_CARRY'].includes(row.navState)
  &&row.evaluationState==='EXISTING_VALID'&&row.snapshotState==='EXISTING_VALID';
}
