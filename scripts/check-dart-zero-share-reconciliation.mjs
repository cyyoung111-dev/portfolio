import assert from 'node:assert/strict';
import {extractDartDomesticBps,DART_SEMICONDUCTORS}
 from './briefing-dart-semiconductor-sources.mjs';
import {auditDartDomesticBps} from './audit-dart-semiconductor-readonly.mjs';

const item=DART_SEMICONDUCTORS[1],receipt='20260814000001';
const report={year:2026,code:'11012',period:'2026-06-30'};
const now=new Date('2026-11-07T11:00:00+09:00');
const fs={status:'000',list:[{
 rcept_no:receipt,corp_code:item.corpCode,bsns_year:'2026',reprt_code:'11012',
 sj_div:'BS',account_id:'ifrs-full_EquityAttributableToOwnersOfParent',
 currency:'KRW',thstrm_amount:'1,100,000,000,000'
}]};
const row=(se,issued,treasury,distb)=>({
 rcept_no:receipt,corp_code:item.corpCode,stlm_dt:report.period,se,
 istc_totqy:issued,tesstk_co:treasury,distb_stock_co:distb
});
const normal={status:'000',list:[
 row('보통주','100,000,000','-','100,000,000'),
 row('우선주','-','-','-'),
 row('합계','100,000,000','-','100,000,000')
]};
const valid=extractDartDomesticBps(fs,normal,item,report,{now});
assert.equal(valid.status,'VERIFIED_SINGLECLASS_BPS',
 'inactive preferred class must not become multistock BPS');
assert.equal(valid.snapshot.preferredShares,0);
assert.equal(valid.snapshot.commonShares,100000000);
assert.equal(valid.snapshot.totalOutstandingShares,100000000);
assert.equal(valid.snapshot.referenceBpsKrw,11000);

const multi=structuredClone(normal);
multi.list[1]=row('우선주','20,000,000','-','20,000,000');
multi.list[2]=row('합계','120,000,000','-','120,000,000');
const indicative=extractDartDomesticBps(fs,multi,item,report,{now});
assert.equal(indicative.status,'INDICATIVE_MULTICLASS_BPS');
assert.equal(indicative.snapshot.preferredShares,20000000);
assert.equal(indicative.snapshot.totalOutstandingShares,120000000);

const unknown=structuredClone(normal);
unknown.list[0].tesstk_co=null;
const failed=extractDartDomesticBps(fs,unknown,item,report,{now});
assert.equal(failed.status,'DART_SHARE_TOTAL_MISMATCH');
assert.equal(failed.detail,'COMMON_FIELD_NON_NUMERIC',
 'a truly missing field is not a DART literal dash');

const wrongMath=structuredClone(normal);
wrongMath.list[0].tesstk_co='-';
wrongMath.list[0].distb_stock_co='99,999,999';
assert.equal(extractDartDomesticBps(fs,wrongMath,item,report,{now}).detail,
 'COMMON_SHARE_ARITHMETIC_MISMATCH',
 'dash zero can only be accepted when issued == outstanding');

const totalWrong=structuredClone(multi);
totalWrong.list[2]=row('합계','120,000,000','-','119,999,999');
assert.equal(extractDartDomesticBps(fs,totalWrong,item,report,{now}).detail,
 'TOTAL_SHARE_ARITHMETIC_MISMATCH');

const classWrong=structuredClone(multi);
classWrong.list[1]=row('우선주','10,000,000','-','10,000,000');
assert.equal(extractDartDomesticBps(fs,classWrong,item,report,{now}).detail,
 'CLASS_TOTAL_OUTSTANDING_MISMATCH');

const invalidNumber=structuredClone(multi);
invalidNumber.list[1].istc_totqy='N/A';
assert.equal(extractDartDomesticBps(fs,invalidNumber,item,report,{now}).detail,
 'PREFERRED_FIELD_NON_NUMERIC');

const raw={total:2,statuses:[
 {symbol:'005930',status:'DART_SHARE_TOTAL_MISMATCH',
  detail:'CLASS_TOTAL_OUTSTANDING_MISMATCH',apiKey:'DART_PRIVATE_SECRET'},
 {symbol:'000660',status:'DART_SHARE_TOTAL_MISMATCH',
  detail:'UNKNOWN: real raw market price or token'}],rows:[]};
const audit=await auditDartDomesticBps({reader:async()=>raw});
assert.equal(audit.statuses[0].detail,'CLASS_TOTAL_OUTSTANDING_MISMATCH');
assert.equal(audit.statuses[1].detail,undefined);
for(const secret of ['DART_PRIVATE_SECRET','UNKNOWN: real','account','1,100,000,000,000',
 '100,000,000','referenceBpsKrw'])
 assert.equal(JSON.stringify(audit).includes(secret),false,
  'DART audit stdout must contain only fixed reason IDs and dates');
assert.equal(audit.portfolioWrites,0);
assert.equal(audit.telegramSends,0);
assert.equal(audit.gasDeployments,0);
console.log('DART_STOCK_ZERO_RECONCILIATION_PASS dash_zero inactive_preferred strict_math whitelist no_raw_values');
