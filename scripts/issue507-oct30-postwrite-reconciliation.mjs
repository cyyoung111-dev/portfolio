// Issue #507: post-state reconciliation ORACLE, not a writer or GAS endpoint.
// All inputs are canonical same-day row arrays, passed only inside a private,
// protected worker. No credentials, network, sheet mutation, or logs.
export const DAY='2026-10-30';
const HELD_SOURCE='KRX_CARRY@2026-10-29';
const FUNDS=new Set(['F00001','F00002']);
const SOURCES=new Set(['KRX','KRX_OTP']);
const CODE=/^[A-Z0-9]{6}$/;
const NUM=/^-?[0-9]+(?:\.[0-9]+)?$/;
const str=x=>String(x??'').trim();
const code=x=>str(x).toUpperCase();
const num=x=>{const s=str(x).replace(/,/g,'');return NUM.test(s)?Number(s):NaN;};
const ok=x=>Number.isFinite(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const round2=x=>Number(x.toFixed(2));
function reject(id){throw Error('ISSUE507_OCT30_POSTSTATE_'+id);}

function keyed(rows,width,kind){
 if(!Array.isArray(rows))reject(kind+'_SHAPE');
 const map=new Map();
 for(const row of rows){
   if(!Array.isArray(row)||row.length!==width||row[0]!==DAY)
     reject(kind+'_SHAPE');
   const c=code(row[1]);
   if(!c||map.has(c))reject(kind+'_DUPLICATE');
   map.set(c,row);
 }
 return map;
}

/**
 * Checks only exact-date rows AFTER a separate, authorized writer has run.
 * No source prices or physical row details are emitted; the private plan and
 * before/after observations must never leave a protected process.
 * A clean match does NOT prove writer-gate, backup, rollback, or other dates.
 */
export function verifyIssue507Oct30PostState({
 date,beforeSnapshot,afterSnapshot,beforeHistory,afterHistory,plan
}={}){
 if(date!==DAY||plan?.summary?.mode!=='ISSUE507_OCT30_SCOPED_VALUATION_PLAN'
   ||plan?.summary?.status!=='PRIVATE_DRY_RUN_ONLY'
   ||plan?.summary?.safeToApply!==false
   ||plan?.summary?.domesticRowRevaluations!==37
   ||plan?.summary?.priceHistoryInserts!==37
   ||plan?.summary?.unchangedFundRows!==2
   ||plan?.summary?.sourceScope!=='KRX_OR_KRX_OTP_EXACT_DATE')
   reject('PLAN_ATTESTATION');
 const privatePlan=plan.privatePlan;
 if(!privatePlan||!Array.isArray(privatePlan.domestic)
    ||privatePlan.domestic.length!==37
    ||!Array.isArray(privatePlan.priceHistoryInserts)
    ||privatePlan.priceHistoryInserts.length!==37)
   reject('PRIVATE_PLAN_SHAPE');
 if(beforeSnapshot?.length!==39||afterSnapshot?.length!==39
   ||beforeHistory?.length!==2||afterHistory?.length!==39)
   reject('ROW_SCOPE');
 const bS=keyed(beforeSnapshot,12,'BEFORE_SNAPSHOT');
 const aS=keyed(afterSnapshot,12,'AFTER_SNAPSHOT');
 const bH=keyed(beforeHistory,6,'BEFORE_HISTORY');
 const aH=keyed(afterHistory,6,'AFTER_HISTORY');
 if(bS.size!==39||aS.size!==39||bH.size!==2||aH.size!==39)
   reject('UNIQUE_COUNTS');
 for(const f of FUNDS){
   const orig=bS.get(f),later=aS.get(f),history=bH.get(f);
   if(!orig||!later||!history||str(orig[10])!=='FUND_NAV'
      ||str(history[5])!=='FUND_NAV'
      ||!same(orig,later)||!same(history,aH.get(f)))
     reject('FUND_PROTECTION');
 }
 const planCodes=new Set(),historyPlan=new Map();
 for(const h of privatePlan.priceHistoryInserts){
   const c=code(h?.[1]);
   if(!Array.isArray(h)||h.length!==6||h[0]!==DAY
      ||!CODE.test(c)||FUNDS.has(c)||historyPlan.has(c)
      ||!SOURCES.has(str(h[5]))||!(num(h[3])>0)||!ok(num(h[3])))
     reject('HISTORY_PLAN_SCOPE');
   historyPlan.set(c,h);
 }
 let verified=0;
 for(const change of privatePlan.domestic){
   const c=code(change?.code);
   if(!CODE.test(c)||FUNDS.has(c)||planCodes.has(c)
      ||!Number.isSafeInteger(change?.rowIndex)
      ||change.rowIndex<0||change.rowIndex>=39)
     reject('PATCH_PLAN_SCOPE');
   planCodes.add(c);
   const orig=bS.get(c),later=aS.get(c),insertion=historyPlan.get(c);
   if(code(beforeSnapshot[change.rowIndex]?.[1])!==c)
     reject('PATCH_INDEX_DRIFT');
   if(!orig||!later||!insertion||bH.has(c)
      ||!same(change.before,orig)||!same(change.after,later))
     reject('PATCH_READBACK_MISMATCH');
   if(str(orig[10])!==HELD_SOURCE
      ||!SOURCES.has(str(later[10]))
      ||str(later[10])!==str(insertion[5]))
     reject('SOURCE_DRIFT');
   // Preserve A:F and L exactly; only G:K may change for these 37 rows.
   for(const i of [0,1,2,3,4,5,11]){
     if(!same(orig[i],later[i]))reject('COST_QTY_OR_METADATA_CHANGED');
   }
   const px=num(insertion[3]),qty=num(orig[3]),cost=num(orig[5]);
   if(!ok(px)||!(px>=0.5)||!ok(qty)||!(qty>0)||!ok(cost)||cost<0
      ||!ok(num(orig[4]))
      ||Math.abs(num(orig[4])-round2(cost/qty))>=0.000001)
     reject('NONFINITE_SOURCE_OR_POSITION');
   const amt=Math.round(Math.round(px)*qty);
   const pnl=amt-cost,unit=round2(amt/qty);
   const pct=cost>0?round2(pnl/cost*100):0;
   if(![amt,pnl,unit,pct].every(ok)
      ||![unit,amt,pnl,pct].every((n,i)=>
        Math.abs(num(later[i+6])-n)<0.000001))
     reject('VALUATION_NOT_PRODUCTION_EQUIVALENT');
   const actualHistory=aH.get(c);
   if(!actualHistory||!same(actualHistory,insertion))
     reject('EXACT_PRICE_HISTORY_MISMATCH');
   verified++;
 }
 if(verified!==37||historyPlan.size!==37
    ||Array.from(bS.keys()).some(c=>!aS.has(c))
    ||Array.from(bS.keys()).some(c=>!FUNDS.has(c)&&!planCodes.has(c))
    ||Array.from(aH.keys()).some(c=>!FUNDS.has(c)&&!planCodes.has(c)))
   reject('UNEXPECTED_CODE_SET');
 return Object.freeze({
   mode:'ISSUE507_OCT30_POSTWRITE_READBACK_ORACLE',date:DAY,
   status:'SYNTHETIC_OR_PROTECTED_READBACK_MATCH',
   verifiedDomesticSnapshotRows:37,verifiedExactPriceHistoryRows:37,
   unchangedFundSnapshots:2,unchangedFundPriceHistory:2,
   unchangedDomesticCostQtyMetadata:37,
   otherDatesVerified:false,physicalBackupSignatureVerified:false,
   gateAndLockVerified:false,rollbackExecuted:false,
   safeToFinalize:false,financialWrites:0,gasDeployed:false,
   containsCodesOrPrices:false
 });
}
