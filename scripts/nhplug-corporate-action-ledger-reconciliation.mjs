// Token-free, read-only synthetic arithmetic checks for the corporate-action
// boundary. No source label, verified flag or matching arithmetic can confer
// official entitlement, account-level ledger provenance or close readiness.
// Existing GAS/Snapshot rows must NOT be changed by this module.
const CODE=/^[A-Z0-9]{6}$/;
const ID=/^[A-Za-z0-9_.:-]{1,128}$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const TYPES=new Set(['CODE_CHANGE','MERGER','SPINOFF','SPLIT','REVERSE_SPLIT','ETF_LIQUIDATION','DELISTING']);
const MAX_ROWS=20000;
function day(s) {
  if(typeof s!=='string'||!DAY.test(s))return false;
  const d=Date.parse(s+'T00:00:00Z');
  return Number.isFinite(d)&&new Date(d).toISOString().slice(0,10)===s;
}
function participant(p){
  return p&&CODE.test(p.code||'')&&ID.test(p.securityId||'');
}
// Fixed 4-decimal shares/units and integer KRW avoid floating point errors,
// while preserving GAS's 4-decimal reported quantity precision.
function qty(x){
  if(typeof x!=='string'||!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,4})?$/.test(x))return null;
  const [whole,fract='']=x.split('.');
  return BigInt(whole)*10000n+BigInt(fract.padEnd(4,'0')||'0');
}
function won(x){
  if(typeof x!=='string'||!/^(?:0|[1-9]\d{0,17})$/.test(x))return null;
  return BigInt(x);
}
const blocked=(reason,checks=[])=>Object.freeze({
  status:'BLOCKED',reason,arithmeticChecks:Object.freeze([...checks]),
  ledgerVerified:false,accountLineageVerified:false,
  readyForCoverage:false,officialEntitlementVerified:false,
  canWriteLedger:false,canWriteSnapshot:false,canSendTelegram:false
});
const pair=p=>p.code+'|'+p.securityId;
function parseSnapshot(s,eventDate,side){
  if(!s||s.source!=='GAS_READONLY_ASOF_UNVERIFIED'||s.verified!==false
    ||!day(s.asOfDate)||!ID.test(s.ledgerFingerprint||'')
    ||!Array.isArray(s.positions)||s.positions.length>MAX_ROWS
    ||(side==='before'?s.asOfDate>=eventDate:s.asOfDate<eventDate))return null;
  const map=new Map();
  for(const row of s.positions){
    if(!participant(row)||qty(row.quantity)===null
      ||won(row.costBasisKrw)===null||map.has(pair(row)))return null;
    map.set(pair(row),{quantity:qty(row.quantity),costBasisKrw:won(row.costBasisKrw)});
  }
  return map;
}
function validEvent(e){
  if(!e||!ID.test(e.eventId||'')||!TYPES.has(e.type)||!day(e.effectiveDate)
    ||!participant(e.source)||!Array.isArray(e.targets)||e.targets.length>8
    ||e.targets.some(p=>!participant(p)))return false;
  if(new Set([pair(e.source),...e.targets.map(pair)]).size!==e.targets.length+1)return false;
  if(['SPLIT','REVERSE_SPLIT'].includes(e.type))
    return e.targets.length===0&&Number.isSafeInteger(e.ratioNumerator)
      &&Number.isSafeInteger(e.ratioDenominator)&&e.ratioNumerator>0
      &&e.ratioDenominator>0&&e.ratioNumerator!==e.ratioDenominator;
  if('ratioNumerator' in e||'ratioDenominator' in e)return false;
  if(e.type==='CODE_CHANGE')return e.targets.length===1
    &&e.targets[0].code!==e.source.code
    &&e.targets[0].securityId===e.source.securityId;
  if(e.type==='MERGER')return e.targets.length===1
    &&e.targets[0].securityId!==e.source.securityId
    &&e.targets[0].code!==e.source.code;
  if(e.type==='SPINOFF')return e.targets.length>=1
    &&e.targets.every(p=>p.securityId!==e.source.securityId);
  return e.targets.length===0;
}
export function auditNhCorporateActionLedger({event,before,after,cashEntries=[],settlementEvidence=null}={}){
  if(!validEvent(event))return blocked('EVENT_INVALID');
  const prior=parseSnapshot(before,event.effectiveDate,'before');
  const later=parseSnapshot(after,event.effectiveDate,'after');
  if(!prior||!later)return blocked('SNAPSHOT_INPUT_INVALID');
  if(!Array.isArray(cashEntries)||cashEntries.length>128)return blocked('CASH_ENTRIES_INVALID');
  const involved=[event.source,...event.targets];
  const a=involved.map(p=>prior.get(pair(p))), b=involved.map(p=>later.get(pair(p)));
  if(a.some(x=>!x)||b.some(x=>!x))return blocked('PARTICIPANT_LEDGER_ROW_MISSING');
  if(a[0].quantity<=0n||a[0].costBasisKrw<0n)return blocked('SOURCE_POSITION_INVALID');
  // Require unchanged cost on zero-position rows to be zero; prevent hidden
  // residual basis and apparently matched aggregate quantities.
  for(const x of [...a,...b])
    if(x.quantity===0n&&x.costBasisKrw!==0n)return blocked('ZERO_POSITION_COST_REMAINS');

  const cash=[];
  const cashIds=new Set();
  for(const row of cashEntries){
    if(!row||row.eventId!==event.eventId||!ID.test(row.cashEntryId||'')
      ||cashIds.has(row.cashEntryId)||!day(row.postedDate)
      ||row.postedDate<event.effectiveDate||won(row.amountKrw)===null)
      return blocked('CASH_ENTRIES_INVALID');
    cashIds.add(row.cashEntryId);
    cash.push(won(row.amountKrw));
  }
  const cashTotal=cash.reduce((sum,v)=>sum+v,0n);
  const noCash=cash.length===0;
  if(event.type==='CODE_CHANGE'){
    if(a[1].quantity!==0n||b[0].quantity!==0n||b[0].costBasisKrw!==0n)
      return blocked('CODE_CHANGE_RESIDUAL_OR_PREEXISTING');
    if(b[1].quantity!==a[0].quantity)
      return blocked('QUANTITY_MISMATCH',['ONE_TO_ONE_CODE_CHANGE']);
    if(b[1].costBasisKrw!==a[0].costBasisKrw)
      return blocked('BASIS_MISMATCH',['ONE_TO_ONE_CODE_CHANGE']);
    if(!noCash)return blocked('CASH_ALLOCATION_NOT_PROVEN');
    return blocked('ARITHMETIC_MATCH_PROVENANCE_UNVERIFIED',
      ['ONE_TO_ONE_CODE_CHANGE','QUANTITY_MATCH','BASIS_MATCH','NO_CASH_ENTRIES']);
  }
  if(event.type==='SPLIT'||event.type==='REVERSE_SPLIT'){
    const n=BigInt(event.ratioNumerator),d=BigInt(event.ratioDenominator);
    const exact=a[0].quantity*n;
    if(exact%d!==0n)return blocked('FRACTIONAL_UNIT_SETTLEMENT_REQUIRED');
    if(b[0].quantity!==exact/d)return blocked('QUANTITY_MISMATCH',['SPLIT_RATIO']);
    if(b[0].costBasisKrw!==a[0].costBasisKrw)
      return blocked('BASIS_MISMATCH',['SPLIT_RATIO']);
    if(!noCash)return blocked('FRACTIONAL_CASH_BASIS_UNVERIFIED');
    return blocked('ARITHMETIC_MATCH_PROVENANCE_UNVERIFIED',
      ['SPLIT_RATIO','QUANTITY_MATCH','BASIS_MATCH','NO_CASH_ENTRIES']);
  }
  if(event.type==='MERGER'){
    if(b[0].quantity!==0n||b[0].costBasisKrw!==0n)
      return blocked('PREDECESSOR_RESIDUAL_HOLDING');
    if(a[1].quantity!==0n)return blocked('PREEXISTING_SUCCESSOR_HOLDING');
    if(b[1].quantity===0n)return blocked('SUCCESSOR_HOLDING_MISSING');
    // Exchange ratios, cash-in-lieu and basis allocation must be corroborated
    // externally; two compatible totals alone are not conclusive.
    return blocked('MERGER_EXCHANGE_TERMS_UNVERIFIED',['PREDECESSOR_CLEARED']);
  }
  if(event.type==='SPINOFF'){
    if(b.slice(1).some(x=>x.quantity===0n))
      return blocked('SPINOFF_SUCCESSOR_MISSING');
    if(a.slice(1).some(x=>x.quantity!==0n))
      return blocked('SPINOFF_PREEXISTING_SUCCESSOR');
    return blocked('SPINOFF_BASIS_ALLOCATION_UNVERIFIED');
  }
  if(b[0].quantity!==0n||b[0].costBasisKrw!==0n)
    return blocked('UNSETTLED_RESIDUAL_UNITS');
  if(event.type==='DELISTING')
    return blocked('DELISTING_SETTLEMENT_METHOD_UNVERIFIED');
  // Even a bank-confirmed-looking cash entry could be an unrelated transfer,
  // and a claimed final NAV is not proof of actual entitlement. Compare the
  // arithmetic but do not approve the settlement or overwrite cost basis.
  if(!settlementEvidence||settlementEvidence.source!=='ETF_SETTLEMENT_CLAIM_UNVERIFIED'
    ||settlementEvidence.eventId!==event.eventId
    ||!ID.test(settlementEvidence.recordId||'')
    ||won(settlementEvidence.amountKrw)===null)
    return blocked('ETF_SETTLEMENT_EVIDENCE_MISSING');
  if(cash.length===0)return blocked('ETF_CASH_RECEIPT_MISSING');
  if(cashTotal!==won(settlementEvidence.amountKrw))
    return blocked('ETF_CASH_RECEIPT_MISMATCH');
  return blocked('ETF_CASH_MATCH_ENTITLEMENT_UNVERIFIED',['CASH_LEDGER_AMOUNT_MATCH']);
}
