// Token-free corporate-action lineage contract for PR #704.
// This is a defensive *classifier*, never an automatic rebalance, ratio
// calculator, code alias, write, tax-lot migration or NAV settlement engine.
// Source/evidence names and verified flags are caller claims, not live proof.
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const CODE=/^[A-Z0-9]{6}$/;
const TYPES=new Set(['CODE_CHANGE','MERGER','SPINOFF','SPLIT','REVERSE_SPLIT','ETF_LIQUIDATION','DELISTING']);
const reasons={
 CODE_CHANGE:'CODE_CHANGE_RECONCILIATION_REQUIRED',
 MERGER:'MERGER_RECONCILIATION_REQUIRED',
 SPINOFF:'SPINOFF_RECONCILIATION_REQUIRED',
 SPLIT:'SPLIT_RECONCILIATION_REQUIRED',
 REVERSE_SPLIT:'REVERSE_SPLIT_RECONCILIATION_REQUIRED',
 ETF_LIQUIDATION:'ETF_LIQUIDATION_SETTLEMENT_UNVERIFIED',
 DELISTING:'DELISTING_SETTLEMENT_UNVERIFIED'
};
function validDay(s){
 if(typeof s!=='string'||!DATE.test(s))return false;
 const n=Date.parse(s+'T00:00:00Z');
 return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===s;
}
function validId(s){
 return typeof s==='string'&&s.length>0&&s.length<=128
  &&/^[\w:.-]+$/.test(s);
}
function validParticipant(p){
 return p&&typeof p==='object'&&!Array.isArray(p)
  &&CODE.test(p.code||'')&&validId(p.securityId);
}
const blocked=(reason,type=null)=>Object.freeze({
 status:'BLOCKED',reason,eventType:type,automaticCodeMapping:false,
 ledgerMutationAllowed:false,priceCarryForwardAllowed:false
});
const clear=()=>Object.freeze({
 status:'NO_EFFECTIVE_ACTION',reason:null,eventType:null,
 automaticCodeMapping:false,ledgerMutationAllowed:false,priceCarryForwardAllowed:false
});
function validateEvent(e){
 if(!e||!TYPES.has(e.type)||!validId(e.eventId)||!validDay(e.effectiveDate)
  ||!validParticipant(e.source)||!Array.isArray(e.targets)||e.targets.length>8
  ||e.targets.some(p=>!validParticipant(p)))return false;
 const targets=e.targets;
 if(new Set(targets.map(p=>p.code+'|'+p.securityId)).size!==targets.length)return false;
 if(['SPLIT','REVERSE_SPLIT'].includes(e.type)){
  return targets.length===0&&Number.isSafeInteger(e.ratioNumerator)
   &&Number.isSafeInteger(e.ratioDenominator)
   &&e.ratioNumerator>0&&e.ratioDenominator>0
   &&e.ratioNumerator!==e.ratioDenominator;
 }
 if(Object.hasOwn(e,'ratioNumerator')||Object.hasOwn(e,'ratioDenominator'))return false;
 if(e.type==='CODE_CHANGE')
  return targets.length===1&&targets[0].code!==e.source.code
    &&targets[0].securityId===e.source.securityId;
 if(e.type==='MERGER')return targets.length===1&&targets[0].code!==e.source.code
   &&targets[0].securityId!==e.source.securityId;
 if(e.type==='SPINOFF')return targets.length>=1
   &&targets.every(p=>p.securityId!==e.source.securityId);
 if(e.type==='ETF_LIQUIDATION'||e.type==='DELISTING')return targets.length===0;
 return false;
}
export function assessNhCorporateActionAsOf(item,tradingDate){
 if(!validDay(tradingDate))return blocked('ACTION_DATE_INVALID');
 if(!item||!CODE.test(item.code||'')||!validId(item.securityId))
  return blocked('ACTION_SECURITY_IDENTITY_INVALID');
 const h=item.corporateActionEvidence;
 if(!h)return blocked('ACTION_EVIDENCE_MISSING');
 if(h.source!=='KRX_CORPORATE_ACTION_HISTORY'||h.verified!==true
  ||!validId(h.recordId)||h.securityId!==item.securityId||h.code!==item.code
  ||!validDay(h.coveredFrom)||!validDay(h.coveredThrough)
  ||h.coveredThrough<h.coveredFrom||!Array.isArray(h.events)
  ||h.events.length>128)return blocked('ACTION_EVIDENCE_INVALID');
 if(tradingDate<h.coveredFrom||tradingDate>h.coveredThrough)
  return blocked('ACTION_EVIDENCE_DATE_GAP');
 const seen=new Set(),effective=[];
 let previous=null;
 for(const e of h.events){
  if(!validateEvent(e))return blocked('ACTION_EVENT_INVALID');
  if(seen.has(e.eventId))return blocked('ACTION_EVENT_DUPLICATE');
  seen.add(e.eventId);
  if(previous!==null&&e.effectiveDate<previous)return blocked('ACTION_EVENT_UNORDERED');
  previous=e.effectiveDate;
  const participants=[e.source,...e.targets];
  const codeMatches=participants.filter(p=>p.code===item.code);
  if(!codeMatches.length)return blocked('ACTION_EVENT_NOT_FOR_SECURITY');
  if(codeMatches.some(p=>p.securityId!==item.securityId))
   return blocked('ACTION_SECURITY_IDENTITY_CONFLICT');
  // Reuse of the same code for a different issuer is never an alias.
  if(participants.filter(p=>p.code===item.code).some(p=>p.securityId!==item.securityId))
   return blocked('ACTION_SECURITY_IDENTITY_CONFLICT');
  if(e.effectiveDate<=tradingDate)effective.push(e);
 }
 if(effective.length>1){
  // A merger plus split on the same day needs a reconciled transaction graph,
  // not a guessed ordering / combined exchange ratio.
  const sameDay=effective.some((e,i)=>effective.findIndex(x=>x.effectiveDate===e.effectiveDate)!==i);
  if(sameDay)return blocked('ACTION_MULTIPLE_SAME_DATE');
 }
 if(effective.length) {
  // Even verified official event metadata DOES NOT prove that the GAS ledger,
  // predecessor/successor positions, cost basis or cash settlements were
  // correctly reconciled. Block until a separate independently validated
  // reconciliation contract exists; no automatic price substitution.
  const latest=effective[effective.length-1];
  return blocked(reasons[latest.type],latest.type);
 }
 return clear();
}
