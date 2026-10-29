import {krxSessionStatus} from './krx-session-calendar.mjs';

// PR #705 (multi-request legacy GAS bridge) and PR #706 (separate ScriptLock
// proposal) BOTH lack an atomic, historical, exchange-verified source.
// The only job of this pure gate is to block premature promotion of their
// candidate universes to PR #704's verified input or a Telegram-ready state.
// No network, secrets, GAS, or portfolio writes.
const ISO=/^\d{4}-\d{2}-\d{2}$/;
const REASONS=Object.freeze({
  NON_ATOMIC:'NON_ATOMIC_GAS_SNAPSHOT',
  HISTORICAL:'HISTORICAL_LISTING_EVIDENCE_MISSING',
  SOURCE:'SOURCE_INTEGRITY_NOT_PROVEN',
  INTEGRITY:'INPUT_CONTRACT_MISMATCH',
  REVIEW:'DEPLOYMENT_NOT_REVIEWED'
});
const MAX=20000;
function validDay(v){
  if(typeof v!=='string'||!ISO.test(v))return false;
  const d=new Date(v+'T00:00:00Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;
}
function summary(reason,kind,counts={}){
  return Object.freeze({
    status:'BLOCKED_SOURCE_UNVERIFIED',kind,canAuditAsVerified:false,
    canSendTelegram:false,canWriteFinancialData:false,officialClose:false,
    heldCodeCount:counts.heldCodeCount??null,
    masterItemCount:counts.masterItemCount??null,
    blockers:Object.freeze([...new Set(reason)].sort())
  });
}
export function assessNhHeldSourceIntegration({candidate,tradingDate}={}){
  const blocked=[REASONS.NON_ATOMIC,REASONS.HISTORICAL,REASONS.SOURCE,REASONS.REVIEW];
  const empty=()=>summary([...blocked,REASONS.INTEGRITY],'INVALID');
  if(!validDay(tradingDate)||krxSessionStatus(tradingDate)!=='OPEN')return empty();
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))return empty();
  let kind;
  if(candidate.status==='CANDIDATE_NON_ATOMIC_UNVERIFIED' && candidate.readOnly===true)
    kind='PR705_NON_ATOMIC_BRIDGE';
  else if(candidate.status==='ok' && candidate.mode==='READ_ONLY_PROPOSAL'
    && candidate.sourceConsistency==='GAS_SCRIPT_LOCK_DOUBLE_READ_MATCH_NOT_ATOMIC'
    && candidate.readOnly===true)
    kind='PR706_LOCKED_PROPOSAL';
  else return empty();
  const ledger=candidate.ledgerSnapshot,master=candidate.masterSnapshot;
  if(candidate.verified!==false||ledger?.source!=='GAS_VERIFIED_ASOF_LEDGER'
    ||master?.source!=='GAS_VERIFIED_CODE_MASTER'
    ||ledger?.verified!==false||master?.verified!==false
    ||candidate.asOfDate!==tradingDate||ledger?.asOfDate!==tradingDate
    ||master?.asOfDate!==tradingDate
    ||!Array.isArray(ledger?.positions)||ledger.positions.length>MAX
    ||!Array.isArray(master?.items)||master.items.length>MAX)
    return summary([...blocked,REASONS.INTEGRITY],kind);
  // Even if a future caller sets top-level "verified:true", or supplies
  // artificial "ACTIVE" states, this bridge NEVER upgrades evidence.
  if(ledger.positions.some(row=>!row||typeof row.code!=='string'
    ||!Number.isFinite(row.quantity)||row.quantity<=0)
    ||master.items.some(row=>!row||typeof row.code!=='string'
    ||!['STOCK','ETF','FUND','CASH','UNKNOWN'].includes(row.kind)
    ||row.listingState!=='UNKNOWN'||row.listingStateAsOf!==null))
    return summary([...blocked,REASONS.INTEGRITY],kind);
  return summary(blocked,kind,{
    heldCodeCount:new Set(ledger.positions.map(x=>x.code)).size,
    masterItemCount:master.items.length
  });
}
