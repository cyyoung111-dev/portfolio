import {createHash} from 'node:crypto';

// Read-only, token-free evidence-to-ledger cross-check. The existing GAS
// trade schema has NO corporate event id; bindings here are annotations only.
// Caller-supplied fingerprints and "official" claims are NOT authenticated.
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const CODE=/^[0-9A-Z]{6}$/;
const ID=/^[A-Za-z0-9_.:-]{1,128}$/;
const HEX=/^[a-f0-9]{64}$/;
const TYPES=new Set(['CODE_CHANGE','SPLIT','REVERSE_SPLIT','ETF_LIQUIDATION']);
const ROLE_BY_TYPE={
  CODE_CHANGE:{OUT:'sell',IN:'buy'},
  SPLIT:{SPLIT:'split'},
  REVERSE_SPLIT:{REVERSE_SPLIT:'reverse_split'},
  ETF_LIQUIDATION:{OUT:'sell'}
};
function validDate(s){
  if(typeof s!=='string'||!DATE.test(s))return false;
  const t=Date.parse(s+'T00:00:00Z');
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s;
}
function hash(v){return createHash('sha256').update(JSON.stringify(v)).digest('hex');}
export function digestNhLedgerRow(row){return hash(row);}
export function digestNhLedgerRows(rows){return hash(rows);}
function blocked(reason,checks=[],counts={}){
  return Object.freeze({
    status:'BLOCKED',reason,checks:Object.freeze(checks),
    reviewedAccountCount:counts.accounts??0,linkedRowCount:counts.links??0,
    cashReceiptCount:counts.cash??0,sourceVerified:false,
    officialActionVerified:false,accountLineageVerified:false,
    canPromoteCoverage:false,canWriteLedger:false,
    canWriteSnapshot:false,canSendTelegram:false
  });
}
function validEvent(e){
  if(!e||!ID.test(e.eventId||'')||!validDate(e.effectiveDate)||
    !e.source||!CODE.test(e.source.code||'')||!ID.test(e.source.securityId||'')||
    !Array.isArray(e.targets)||e.targets.length>8)return false;
  if(e.type==='CODE_CHANGE')
    return e.targets.length===1&&CODE.test(e.targets[0].code||'')
      &&e.targets[0].code!==e.source.code
      &&e.targets[0].securityId===e.source.securityId;
  if(e.type==='SPLIT'||e.type==='REVERSE_SPLIT')
    return e.targets.length===0&&Number.isSafeInteger(e.ratioNumerator)
      &&Number.isSafeInteger(e.ratioDenominator)
      &&e.ratioNumerator>0&&e.ratioDenominator>0;
  if(e.type==='ETF_LIQUIDATION')return e.targets.length===0;
  return false;
}
function parseQty(value){
  if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,4})?$/.test(value))
    return null;
  const [a,b='']=value.split('.');
  return BigInt(a)*10000n+BigInt(b.padEnd(4,'0')||'0');
}
function positiveAmount(v){
  return typeof v==='string'&&/^(?:0|[1-9]\d{0,17})$/.test(v);
}
function sameDayOrAfter(day,origin){
  return validDate(day)&&day>=origin;
}
export function auditNhCorporateEvidenceLedgerLinks({
 event,authorityRecord,ledger,expectedAccounts,accountDocuments,links,cashReceipts=[]
}={}){
 const validId=x=>typeof x==='string'&&ID.test(x);
 if(!event||!validDate(event.effectiveDate)||!validId(event.eventId))
   return blocked('EVENT_INVALID');
 if(!TYPES.has(event.type))return blocked('EVENT_LEDGER_MAPPING_UNSUPPORTED');
 if(!validEvent(event))return blocked('EVENT_INVALID');
 if(!authorityRecord||authorityRecord.source!=='KRX_ACTION_RECORD_CLAIM_UNVERIFIED'
   ||!validId(authorityRecord.recordId)
   ||authorityRecord.eventId!==event.eventId
   ||authorityRecord.effectiveDate!==event.effectiveDate
   ||authorityRecord.code!==event.source.code
   ||authorityRecord.securityId!==event.source.securityId)
   return blocked('AUTHORITY_RECORD_MISMATCH');
 if(!ledger||ledger.source!=='GAS_TRADE_LEDGER_READONLY_UNVERIFIED'
   ||ledger.verified!==false||!sameDayOrAfter(ledger.asOfDate,event.effectiveDate)
   ||!Array.isArray(ledger.rows)||ledger.rows.length>20000
   ||!HEX.test(ledger.digest||''))
   return blocked('LEDGER_INPUT_UNVERIFIED');
 if(ledger.digest!==digestNhLedgerRows(ledger.rows))
   return blocked('LEDGER_SOURCE_DIGEST_MISMATCH');
 for(const row of ledger.rows){
   if(!Array.isArray(row)||row.length!==11
     ||!validDate(row[0])||typeof row[1]!=='string'
     ||!validId(row[2])||typeof row[3]!=='string'
     ||typeof row[4]!=='string'||!CODE.test(row[4])
     ||parseQty(row[5])===null)
     return blocked('LEDGER_ROW_INVALID');
 }
 if(!Array.isArray(expectedAccounts)||!expectedAccounts.length
   ||expectedAccounts.length>128
   ||expectedAccounts.some(x=>!validId(x))
   ||new Set(expectedAccounts).size!==expectedAccounts.length)
   return blocked('AFFECTED_ACCOUNTS_UNVERIFIED');
 if(!Array.isArray(accountDocuments)||accountDocuments.length!==expectedAccounts.length
   ||accountDocuments.length>128)
   return blocked('ACCOUNT_DOCUMENTS_INCOMPLETE');
 const accounts=new Set(expectedAccounts),docsByAccount=new Map(),docIds=new Set();
 for(const d of accountDocuments){
   if(!d||d.source!=='BROKER_ACTION_RECORD_CLAIM_UNVERIFIED'
     ||!validId(d.docId)||docIds.has(d.docId)
     ||!accounts.has(d.accountId)||docsByAccount.has(d.accountId)
     ||d.eventId!==event.eventId||d.effectiveDate!==event.effectiveDate)
     return blocked('ACCOUNT_DOCUMENT_DUPLICATE_OR_MISMATCH');
   docsByAccount.set(d.accountId,d);docIds.add(d.docId);
 }
 if(!Array.isArray(links)||!links.length||links.length>300
   ||!Array.isArray(cashReceipts)||cashReceipts.length>128)
   return blocked('LINK_INPUT_INVALID');
 const rowRefs=new Set(),roles=new Map(),records=new Map();
 for(const a of expectedAccounts){roles.set(a,new Map());records.set(a,new Map());}
 for(const l of links){
   if(!l||l.eventId!==event.eventId||!accounts.has(l.accountId)
     ||!docIds.has(l.docId)||docsByAccount.get(l.accountId)?.docId!==l.docId
     ||!Number.isSafeInteger(l.rowIndex)||l.rowIndex<0
     ||l.rowIndex>=ledger.rows.length||!HEX.test(l.rowDigest||''))
     return blocked('LINK_INVALID');
   const row=ledger.rows[l.rowIndex];
   if(l.rowDigest!==digestNhLedgerRow(row))
     return blocked('LINK_ROW_DIGEST_MISMATCH');
   if(row[2]!==l.accountId)return blocked('LINK_ACCOUNT_MISMATCH');
   if(row[0]!==event.effectiveDate)return blocked('LINK_DATE_MISMATCH');
   const mapping=ROLE_BY_TYPE[event.type];
   if(row[1]!==mapping[l.role])return blocked('LINK_ROLE_OR_TRADE_TYPE_MISMATCH');
   const code=l.role==='IN'?event.targets[0]?.code:event.source.code;
   if(row[4]!==code)return blocked('LINK_SECURITY_CODE_MISMATCH');
   if(rowRefs.has(l.rowIndex))return blocked('LINK_DUPLICATE_LEDGER_ROW');
   rowRefs.add(l.rowIndex);
   const roleMap=roles.get(l.accountId);
   if(roleMap.has(l.role))return blocked('LINK_DUPLICATE_ACCOUNT_ROLE');
   roleMap.set(l.role,l.rowIndex);
   records.get(l.accountId).set(l.role,row);
 }
 const required=Object.keys(ROLE_BY_TYPE[event.type]);
 for(const account of expectedAccounts){
   if(required.some(x=>!roles.get(account).has(x)))
     return blocked('LINK_ACCOUNT_MOVEMENTS_MISSING');
   const rows=records.get(account);
   if(event.type==='CODE_CHANGE'){
     const out=parseQty(rows.get('OUT')[5]),inn=parseQty(rows.get('IN')[5]);
     if(out===0n||inn!==out)return blocked('LINK_CODE_CHANGE_QUANTITY_MISMATCH');
   }
   if(event.type==='SPLIT'||event.type==='REVERSE_SPLIT'){
     const row=rows.get(event.type);
     const ratio=row[9];
     if(typeof ratio!=='string'||!(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,8})?$/.test(ratio)))
       return blocked('LINK_SPLIT_RATIO_INVALID');
     const [whole,fraction='']=ratio.split('.');
     const left=(BigInt(whole)*100000000n+BigInt(fraction.padEnd(8,'0')||'0'));
     const n=BigInt(event.ratioNumerator),d=BigInt(event.ratioDenominator);
     if(left===0n)return blocked('LINK_SPLIT_RATIO_INVALID');
     const expectedN=event.type==='SPLIT'?n:d;
     const expectedD=event.type==='SPLIT'?d:n;
     if(left*expectedD!==expectedN*100000000n)
       return blocked('LINK_SPLIT_RATIO_MISMATCH');
   }
   if(event.type==='ETF_LIQUIDATION'&&parseQty(rows.get('OUT')[5])===0n)
     return blocked('LINK_LIQUIDATION_QUANTITY_INVALID');
 }
 // Additional same-day movements for an affected account and one of the
 // event securities might represent a duplicate execution or an ordinary
 // trade. The current GAS schema cannot distinguish them, so refuse to
 // claim that we have exhaustively linked the corporate action.
 const relevantCodes=new Set([event.source.code,...event.targets.map(x=>x.code)]);
 const relevantTypes=new Set(Object.values(ROLE_BY_TYPE[event.type]));
 for(let i=0;i<ledger.rows.length;i++){
   const row=ledger.rows[i];
   if(row[0]===event.effectiveDate&&accounts.has(row[2])
     &&relevantCodes.has(row[4])&&relevantTypes.has(row[1])
     &&!rowRefs.has(i))return blocked('LEDGER_EVENT_ROWS_UNLINKED');
 }
 const receipts=new Map(),receiptIds=new Set();
 for(const r of cashReceipts){
   if(!r||r.source!=='BROKER_CASH_RECORD_CLAIM_UNVERIFIED'
     ||!validId(r.receiptId)||receiptIds.has(r.receiptId)
     ||!accounts.has(r.accountId)||receipts.has(r.accountId)
     ||r.eventId!==event.eventId||!sameDayOrAfter(r.postedDate,event.effectiveDate)
     ||!positiveAmount(r.amountKrw))
     return blocked('CASH_RECEIPT_DUPLICATE_OR_MISMATCH');
   receiptIds.add(r.receiptId);receipts.set(r.accountId,r);
 }
 if(event.type==='ETF_LIQUIDATION'){
   if(expectedAccounts.some(a=>!receipts.has(a)))
     return blocked('ETF_ACCOUNT_CASH_RECEIPT_MISSING');
 }else if(cashReceipts.length)
   return blocked('UNSUPPORTED_CASH_ALLOCATION');
 return blocked('DOCUMENT_LEDGER_LINKAGE_ONLY_UNVERIFIED',
   ['ACCOUNT_DOCUMENT_IDS_MATCH','LEDGER_DIGEST_MATCH','TRADE_ROW_LINKS_MATCH'],
   {accounts:expectedAccounts.length,links:links.length,cash:cashReceipts.length});
}
