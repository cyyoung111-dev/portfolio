import assert from 'node:assert/strict';
import {
  auditNhCorporateEvidenceLedgerLinks,digestNhLedgerRow,digestNhLedgerRows
} from './nhplug-corporate-evidence-ledger-links.mjs';
import {auditNhCorporateActionLedger} from './nhplug-corporate-action-ledger-reconciliation.mjs';

const day='2026-10-29',old={code:'005930',securityId:'SEC-OLD'};
const newCode={code:'000001',securityId:'SEC-OLD'};
const accounts=['ACCT-A','ACCT-B'];
const clone=x=>JSON.parse(JSON.stringify(x));
const event=(type,more={})=>({
  type,eventId:'EVENT-001',effectiveDate:day,source:old,
  targets:type==='CODE_CHANGE'?[newCode]:[],...more
});
const raw=(date,type,account,code,quantity,ratio='')=>
  [date,type,account,'FIXTURE-NAME',code,quantity,'100','주식','',ratio,''];
const doc=(account)=>({source:'BROKER_ACTION_RECORD_CLAIM_UNVERIFIED',
  docId:'DOC-'+account,eventId:'EVENT-001',effectiveDate:day,accountId:account});
const authority=(evt)=>({source:'KRX_ACTION_RECORD_CLAIM_UNVERIFIED',
  recordId:'UNVERIFIED-RECORD',eventId:evt.eventId,effectiveDate:evt.effectiveDate,
  code:evt.source.code,securityId:evt.source.securityId});
function fixture(type,rows,roleAtIndex,eventOverrides={}){
 const evt=event(type,eventOverrides);
 const docs=accounts.map(doc);
 const links=rows.map((r,i)=>({eventId:evt.eventId,docId:'DOC-'+r[2],
  accountId:r[2],role:roleAtIndex[i],rowIndex:i,rowDigest:digestNhLedgerRow(r)}));
 return {event:evt,authorityRecord:authority(evt),
  ledger:{source:'GAS_TRADE_LEDGER_READONLY_UNVERIFIED',verified:false,
    asOfDate:day,rows,digest:digestNhLedgerRows(rows)},
  expectedAccounts:[...accounts],accountDocuments:docs,links,cashReceipts:[]};
}
const base=fixture('CODE_CHANGE',[
 raw(day,'sell','ACCT-A',old.code,'10.0000'),
 raw(day,'buy','ACCT-A',newCode.code,'10.0000'),
 raw(day,'sell','ACCT-B',old.code,'3.0000'),
 raw(day,'buy','ACCT-B',newCode.code,'3.0000')
],['OUT','IN','OUT','IN']);
function verify(params,reason,counts=null){
 const original=JSON.stringify(params);
 const out=auditNhCorporateEvidenceLedgerLinks(params);
 assert.equal(out.status,'BLOCKED');
 assert.equal(out.reason,reason);
 for(const key of ['sourceVerified','officialActionVerified','accountLineageVerified',
   'canPromoteCoverage','canWriteLedger','canWriteSnapshot','canSendTelegram'])
   assert.equal(out[key],false,key+' must remain false even on numeric match');
 assert.equal(JSON.stringify(params),original,'audit is read-only');
 assert.ok(Object.isFrozen(out));
 assert.ok(Object.isFrozen(out.checks));
 assert.doesNotMatch(JSON.stringify(out),/005930|000001|ACCT-A|ACCT-B|DOC-|FIXTURE-NAME|UNVERIFIED-RECORD/);
 if(counts)assert.deepEqual([
   out.reviewedAccountCount,out.linkedRowCount,out.cashReceiptCount
 ],counts);
 return out;
}
verify(base,'DOCUMENT_LEDGER_LINKAGE_ONLY_UNVERIFIED',[2,4,0]);
verify({...clone(base),authorityRecord:{...base.authorityRecord,effectiveDate:'2026-10-28'}},
 'AUTHORITY_RECORD_MISMATCH');
verify({...clone(base),authorityRecord:{...base.authorityRecord,eventId:'OTHER'}},
 'AUTHORITY_RECORD_MISMATCH');
verify({...clone(base),expectedAccounts:['ACCT-A','ACCT-A']},'AFFECTED_ACCOUNTS_UNVERIFIED');
verify({...clone(base),accountDocuments:[doc('ACCT-A')]},'ACCOUNT_DOCUMENTS_INCOMPLETE');
verify({...clone(base),accountDocuments:[doc('ACCT-A'),doc('ACCT-A')]},
 'ACCOUNT_DOCUMENT_DUPLICATE_OR_MISMATCH');

const missing=clone(base);
missing.links=missing.links.filter(x=>!(x.accountId==='ACCT-B'&&x.role==='IN'));
verify(missing,'LINK_ACCOUNT_MOVEMENTS_MISSING');
const repeated=clone(base);repeated.links.push(clone(repeated.links[0]));
verify(repeated,'LINK_DUPLICATE_LEDGER_ROW');
const staleDigest=clone(base);staleDigest.ledger.rows[0][5]='11.0000';
verify(staleDigest,'LEDGER_SOURCE_DIGEST_MISMATCH');
const staleLink=clone(staleDigest);staleLink.ledger.digest=digestNhLedgerRows(staleLink.ledger.rows);
verify(staleLink,'LINK_ROW_DIGEST_MISMATCH');
const wrongDate=clone(base);wrongDate.ledger.rows[0][0]='2026-10-28';
wrongDate.ledger.digest=digestNhLedgerRows(wrongDate.ledger.rows);
wrongDate.links[0].rowDigest=digestNhLedgerRow(wrongDate.ledger.rows[0]);
verify(wrongDate,'LINK_DATE_MISMATCH');
const accountSwap=clone(base);accountSwap.links[0].accountId='ACCT-B';
accountSwap.links[0].docId='DOC-ACCT-B';
verify(accountSwap,'LINK_ACCOUNT_MISMATCH');
const codeSwap=clone(base);codeSwap.ledger.rows[0][4]='035420';
codeSwap.ledger.digest=digestNhLedgerRows(codeSwap.ledger.rows);
codeSwap.links[0].rowDigest=digestNhLedgerRow(codeSwap.ledger.rows[0]);
verify(codeSwap,'LINK_SECURITY_CODE_MISMATCH');
const tradeSwap=clone(base);tradeSwap.ledger.rows[0][1]='buy';
tradeSwap.ledger.digest=digestNhLedgerRows(tradeSwap.ledger.rows);
tradeSwap.links[0].rowDigest=digestNhLedgerRow(tradeSwap.ledger.rows[0]);
verify(tradeSwap,'LINK_ROLE_OR_TRADE_TYPE_MISMATCH');
const qtyMismatch=clone(base);qtyMismatch.ledger.rows[1][5]='9.0000';
qtyMismatch.ledger.digest=digestNhLedgerRows(qtyMismatch.ledger.rows);
qtyMismatch.links[1].rowDigest=digestNhLedgerRow(qtyMismatch.ledger.rows[1]);
verify(qtyMismatch,'LINK_CODE_CHANGE_QUANTITY_MISMATCH');

const split=fixture('SPLIT',[
 raw(day,'split','ACCT-A',old.code,'0','2'),
 raw(day,'split','ACCT-B',old.code,'0','2')
],['SPLIT','SPLIT'],{ratioNumerator:2,ratioDenominator:1});
verify(split,'DOCUMENT_LEDGER_LINKAGE_ONLY_UNVERIFIED',[2,2,0]);
const splitWrong=clone(split);splitWrong.ledger.rows[0][9]='3';
splitWrong.ledger.digest=digestNhLedgerRows(splitWrong.ledger.rows);
splitWrong.links[0].rowDigest=digestNhLedgerRow(splitWrong.ledger.rows[0]);
verify(splitWrong,'LINK_SPLIT_RATIO_MISMATCH');
const rev=fixture('REVERSE_SPLIT',[
 raw(day,'reverse_split','ACCT-A',old.code,'0','10'),
 raw(day,'reverse_split','ACCT-B',old.code,'0','10')
],['REVERSE_SPLIT','REVERSE_SPLIT'],{ratioNumerator:1,ratioDenominator:10});
verify(rev,'DOCUMENT_LEDGER_LINKAGE_ONLY_UNVERIFIED');
const revWrong=clone(rev);revWrong.ledger.rows[0][9]='0.1';
revWrong.ledger.digest=digestNhLedgerRows(revWrong.ledger.rows);
revWrong.links[0].rowDigest=digestNhLedgerRow(revWrong.ledger.rows[0]);
verify(revWrong,'LINK_SPLIT_RATIO_MISMATCH');

const liquidate=fixture('ETF_LIQUIDATION',[
 raw(day,'sell','ACCT-A',old.code,'10'),
 raw(day,'sell','ACCT-B',old.code,'3')
],['OUT','OUT']);
const receipt=account=>({source:'BROKER_CASH_RECORD_CLAIM_UNVERIFIED',
 receiptId:'RECEIPT-'+account,eventId:'EVENT-001',
 accountId:account,postedDate:'2026-10-30',amountKrw:'100000'});
liquidate.cashReceipts=accounts.map(receipt);
verify(liquidate,'DOCUMENT_LEDGER_LINKAGE_ONLY_UNVERIFIED',[2,2,2]);
verify({...clone(liquidate),cashReceipts:[receipt('ACCT-A')]},
 'ETF_ACCOUNT_CASH_RECEIPT_MISSING');
verify({...clone(liquidate),cashReceipts:[receipt('ACCT-A'),receipt('ACCT-A')]},
 'CASH_RECEIPT_DUPLICATE_OR_MISMATCH');
verify({...clone(liquidate),cashReceipts:[
   {...receipt('ACCT-A'),postedDate:'2026-10-28'},receipt('ACCT-B')]},
 'CASH_RECEIPT_DUPLICATE_OR_MISMATCH');
verify({...clone(base),cashReceipts:[receipt('ACCT-A')]},
 'UNSUPPORTED_CASH_ALLOCATION');

verify({...clone(base),event:{...base.event,type:'MERGER'}},
 'EVENT_LEDGER_MAPPING_UNSUPPORTED');
verify({...clone(base),ledger:{...base.ledger,verified:true}},
 'LEDGER_INPUT_UNVERIFIED');
verify({...clone(base),ledger:{...base.ledger,asOfDate:'2026-10-28'}},
 'LEDGER_INPUT_UNVERIFIED');
const duplicateRaw=clone(base);duplicateRaw.ledger.rows.push(clone(duplicateRaw.ledger.rows[0]));
duplicateRaw.ledger.digest=digestNhLedgerRows(duplicateRaw.ledger.rows);
verify(duplicateRaw,'LEDGER_EVENT_ROWS_UNLINKED');

const reconciled= auditNhCorporateActionLedger({
  event:base.event,
  before:{source:'GAS_READONLY_ASOF_UNVERIFIED',verified:false,asOfDate:'2026-10-28',
    ledgerFingerprint:'UNVERIFIED',positions:[
      {...old,quantity:'10',costBasisKrw:'100000'},
      {...newCode,quantity:'0',costBasisKrw:'0'}]},
  after:{source:'GAS_READONLY_ASOF_UNVERIFIED',verified:false,asOfDate:day,
    ledgerFingerprint:'UNVERIFIED',positions:[
      {...old,quantity:'0',costBasisKrw:'0'},
      {...newCode,quantity:'10',costBasisKrw:'100000'}]}
});
assert.equal(reconciled.reason,'ARITHMETIC_MATCH_PROVENANCE_UNVERIFIED');
assert.equal(reconciled.readyForCoverage,false);
assert.equal(verify(base,'DOCUMENT_LEDGER_LINKAGE_ONLY_UNVERIFIED').canPromoteCoverage,false);
console.log('NH corporate-action evidence ↔ GAS row-hash/account/date linkage: synthetic fail-closed PASS');
