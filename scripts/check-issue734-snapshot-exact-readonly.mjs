import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditSnapshotExact,classifySnapshotExact}
 from './issue734-snapshot-exact-readonly.mjs';

const date='2026-11-13';
const item=(code,amt)=>({code,qty:code.startsWith('F')?1:2,evalAmt:amt,source:code.startsWith('F')?'FUND_NAV':'KRX'});
const history={status:'ok',date,items:[item('005930',120000),item('F00001',30000000)]};
const d={date,status:'VALID',expectedRowCount:2,storedRowCount:2,
 expectedCodes:['005930','F00001'],storedCodes:['005930','F00001'],
 missingCodes:[],unexpectedCodes:[],qtyMismatches:[],costAmtMismatches:[],
 evalAmtMismatches:[],evalUnitMismatches:[],sourceMismatches:[],
 duplicateKeys:[],conflictKeys:[],sourceDataErrors:[]};
const envelope={status:'ok',checkedDates:[date],diagnostics:[d],
 integritySourceRevision:'rev-595',strictSourceDigest:'a'.repeat(64)};
const classify=(patch={})=>classifySnapshotExact({date,history,integrity:envelope,...patch});
const ok=classify();
assert.equal(ok.state,'VERIFIED');
assert.equal(ok.expectedRows,2);
assert.equal(ok.duplicateStoredCodes,0);
assert.equal(ok.internalRevaluationVerified,true);
assert.equal(ok.externalWriterExcludedVerified,false);
assert.equal(ok.exactWriterOwnerVerified,false);
assert.equal(ok.officialPriceSourceIndependentlyVerified,false);
assert.equal(ok.writeAuthorized,false);
assert.equal(ok.financialWrites,0);
assert.ok(!JSON.stringify(ok).includes('005930'));
assert.ok(!JSON.stringify(ok).includes('F00001'));
assert.ok(!JSON.stringify(ok).includes('30000000'));
const changeD=patch=>({...envelope,diagnostics:[{...d,...patch}]});
assert.equal(classify({integrity:changeD({status:'SOURCE_INCOMPLETE'})}).state,'INCOMPLETE_OR_MISMATCH');
assert.equal(classify({integrity:changeD({expectedRowCount:3})}).state,'INCOMPLETE_OR_MISMATCH');
assert.equal(classify({integrity:changeD({storedCodes:['005930','000660']})}).codeSetMatch,false);
assert.equal(classify({integrity:changeD({evalAmtMismatches:[{code:'PRIVATE',value:1}]})}).state,
 'INCOMPLETE_OR_MISMATCH');
assert.equal(classify({integrity:changeD({duplicateKeys:[{code:'PRIVATE'}]})}).state,
 'INCOMPLETE_OR_MISMATCH');
assert.equal(classify({history:{...history,items:[...history.items,history.items[0]]}}).duplicateStoredCodes,1);
for(const invalid of [
 {date:'2026-11-99'},
 {history:{...history,date:'2026-11-12'}},
 {history:{...history,items:[{code:'005930',evalAmt:1}]}},
 {integrity:{...envelope,checkedDates:['2026-11-12']}},
 {integrity:{...envelope,strictSourceDigest:'PRIVATE'}},
 {integrity:{...envelope,diagnostics:[]}},
 {integrity:changeD({expectedCodes:'PRIVATE'})}
])assert.throws(()=>classify(invalid),/ISSUE734_SNAPSHOT_EXACT_/);

const calls=[],secret='TEST_ONLY_PRIVATE_TOKEN';
const mock=async(url,opts)=>{
 const params=opts.body;const action=params.get('action');
 calls.push(action);
 assert.equal(new URL(url).hostname,'script.google.com');
 assert.equal(opts.method,'POST');
 assert.equal(opts.redirect,'follow');
 assert.equal(params.get('accessToken'),secret);
 assert.equal(params.get('strictReadonly'),action==='diagnoseSnapshotIntegrityRange'?'1':null);
 assert.equal(params.get('dates'),action==='diagnoseSnapshotIntegrityRange'?date:null);
 assert.equal(params.get('date'),action==='getHistoryDetail'?date:null);
 assert.ok(!params.has('write')&&!params.has('persist'));
 return {ok:true,json:async()=>action==='diagnoseSnapshotIntegrityRange'?envelope:history};
};
const result=await auditSnapshotExact({
 url:'https://script.google.com/macros/s/TEST_DEPLOYMENT/exec',
 token:secret,date,fetchImpl:mock});
assert.deepEqual(calls,['diagnoseSnapshotIntegrityRange','getHistoryDetail']);
assert.equal(result.state,'VERIFIED');
assert.equal(result.readOnlyRequests,2);
assert.ok(!JSON.stringify(result).includes(secret));
const reject=async(_u,opts)=>({ok:false,status:403,json:async()=>({status:'error',token:secret})});
await assert.rejects(()=>auditSnapshotExact({
 url:'https://script.google.com/macros/s/TEST_DEPLOYMENT/exec',token:secret,date,
 fetchImpl:reject}),/ISSUE734_SNAPSHOT_EXACT_HTTP_UNVERIFIED/);
const workflow=readFileSync('.github/workflows/portfolio-daily-ops-readonly.yml','utf8');
assert.match(workflow,/workflow_dispatch:/);
assert.doesNotMatch(workflow,/^  schedule:|^  push:/m);
assert.match(workflow,/portfolio-production-gas/);
const p=JSON.parse(readFileSync('package.json','utf8')).scripts;
assert.match(p['check:ci'],/check-issue734-snapshot-exact-readonly\.mjs/);
console.log('ISSUE734_SNAPSHOT_EXACT_SOURCE_PASS: strict full-date readback, counts, codes, negatives, zero financial writes');
