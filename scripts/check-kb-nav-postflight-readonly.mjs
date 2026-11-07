import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {assessKbNavPostflight,auditKbNavPostflight,
 verifyKbOfficialNavPreview,readKbExactNavPreview}
 from './audit-kb-nav-postflight-readonly.mjs';

const today='2026-11-07',date='2026-11-06';
const source=[{date:'2026-11-05',nav:2169.72},{date,nav:2100.55}];
const close={state:'INCOMPLETE',runDate:date,priceOk:true,fundOk:false,
 runStale:false,snapshotStale:false,expectedRunDate:date,expectedSnapshotDate:date};
const verified={code:'F00002',date,navState:'EXISTING_CONFIRMED',
 valuationRequired:true,unitsApplied:true,reconciled:true,
 evaluationState:'EXISTING_VALID',snapshotState:'EXISTING_VALID',
 publicationExpected:true};
const assess=(change={})=>assessKbNavPostflight({
 today,close,officialRows:source,fundRow:verified,officialNavMatched:true,...change
});
const notPublished=assess({officialRows:source.slice(0,1),fundRow:null});
assert.equal(notPublished.verdict,'OFFICIAL_NAV_NOT_YET_PUBLISHED_CLOSE_INCOMPLETE');
assert.equal(notPublished.pass,false);
const unpublishedHealthy=assess({officialRows:source.slice(0,1),fundRow:null,
 close:{...close,state:'COMPLETE',fundOk:true}});
assert.equal(unpublishedHealthy.verdict,'OFFICIAL_NAV_NOT_YET_PUBLISHED');
assert.equal(unpublishedHealthy.pass,true);
assert.equal(notPublished.closeComplete,false);
assert.equal(assess({fundRow:{...verified,navState:'NAV_MISSING'}}).verdict,
 'OFFICIAL_NAV_NOT_IMPORTED');
assert.equal(assess({fundRow:null}).pass,false);
assert.equal(assess({officialNavMatched:false}).verdict,
 'OFFICIAL_NAV_VALUE_MISMATCH_OR_UNVERIFIED');
assert.equal(assess({officialNavMatched:undefined}).pass,false,
 'an unverified public-vs-stored NAV may never pass');
assert.equal(assess({fundRow:{...verified,snapshotState:'WRITE_REQUIRED'}}).verdict,
 'PUBLISHED_NAV_DERIVED_UNVERIFIED');
assert.equal(assess({fundRow:{...verified,unitsApplied:false}}).pass,false);
assert.equal(assess().verdict,'NAV_VERIFIED_CLOSE_INCOMPLETE');
assert.equal(assess().pass,false);
const healthy=assess({close:{...close,state:'COMPLETE',fundOk:true}});
assert.equal(healthy.verdict,'NAV_AND_CLOSE_VERIFIED');
assert.equal(healthy.pass,true);
// Never count a previously completed run as today's close when the newer KRX
// session is expected or GAS has already marked the old result as stale.
const oldDate='2026-11-04',priorRow={...verified,date:oldDate};
const oldClose={...close,state:'COMPLETE',fundOk:true,runDate:oldDate,runStale:true};
const staleProof=assess({close:oldClose,fundRow:priorRow,
 officialRows:[{date:oldDate,nav:1},...source]});
assert.equal(staleProof.verdict,'CLOSE_DATE_STALE_OR_UNVERIFIED');
assert.equal(staleProof.pass,false);
assert.equal(staleProof.closeComplete,false);
assert.equal(assess({close:{...oldClose,runStale:false},fundRow:priorRow,
 officialRows:[{date:oldDate,nav:1},...source]}).pass,false,
 'expected newest session must reject an older COMPLETED close');
assert.equal(assess({close:{...close,state:'COMPLETE',fundOk:true,
 snapshotStale:true}}).pass,false,
 'snapshot stale status must fail closed');
// Before 21:00 KST the GAS expected session may still be yesterday.
 // A newer, independently verified completed close is valid.
assert.equal(assess({close:{...close,state:'COMPLETE',fundOk:true,
 expectedRunDate:'2026-11-05',expectedSnapshotDate:'2026-11-05'}}).pass,true,
 'newer completed close must be accepted against yesterday minimum');
assert.equal(assess({close:{...close,state:'COMPLETE',fundOk:true,
 expectedSnapshotDate:'2026-11-07'}}).pass,false,
 'an expected snapshot date newer than saved close cannot be verified');
assert.equal(assess({close:{...close,state:'COMPLETE',fundOk:true,
 expectedRunDate:'2026-11-07'}}).pass,false,
 'an expected close date newer than saved run must be rejected');
assert.deepEqual({financialWrites:healthy.financialWrites,
 gasDeployments:healthy.gasDeployments,telegramSends:healthy.telegramSends},
 {financialWrites:0,gasDeployments:0,telegramSends:0});
assert.ok(!JSON.stringify(healthy).includes('2100.55'),'NAV must never enter log');
assert.throws(()=>assess({officialRows:[...source,{date:today}]}),
 /KB_POSTFLIGHT_SCHEMA_UNVERIFIED/);
assert.throws(()=>assess({officialRows:[source[0],source[0]]}),
 /KB_POSTFLIGHT_SCHEMA_UNVERIFIED/);
assert.throws(()=>assess({close:{...close,runDate:'2026-11-99'}}),
 /KB_POSTFLIGHT_SCHEMA_UNVERIFIED/);

let publicCalls=0,statusCalls=0,gasCalls=0,previewCalls=0;
const exactPreview=(value=2100.55)=>({status:'ok',code:'F00002',
 candidates:[],updates:[],warnings:[],errors:[],duplicates:[],zeroUnits:[],
 identical:[{date,existingNav:value,uploadedNav:value}]});
assert.equal(verifyKbOfficialNavPreview(date,2100.55,exactPreview()),true);
assert.equal(verifyKbOfficialNavPreview(date,2100.55,exactPreview(2100.56)),false,
 'source revision must not be reported verified from internally consistent derived rows');
for(const fault of [{...exactPreview(),candidates:[{date}]},
 {...exactPreview(),updates:[{date}]},
 {...exactPreview(),identical:[...exactPreview().identical,...exactPreview().identical]},
 {...exactPreview(),code:'F00001'},
 {...exactPreview(),warnings:[{date}]}])
 assert.equal(verifyKbOfficialNavPreview(date,2100.55,fault),false);
assert.equal(verifyKbOfficialNavPreview(date,2100.55,null),false);
const proof={status:'ok',fundResults:{F00002:{code:'F00002',
 dates:[verified]}}};
const mocks={
 now:new Date('2026-11-07T02:30:00Z'),
 statusReader:async()=>{statusCalls++;return {close}},
 sourceReader:async()=>{publicCalls++;return {
   writerInvoked:false,rows:source,latestDate:date
 }},
 valuationReader:async ({from,to})=>{
   gasCalls++;assert.equal(from,'2026-11-01');assert.equal(to,today);
   return proof;
 },
 previewReader:async ({date:requestedDate,nav})=>{
   previewCalls++;assert.equal(requestedDate,date);assert.equal(nav,2100.55);
   return exactPreview();
 }
};
const result=await auditKbNavPostflight(mocks);
assert.equal(result.verdict,'NAV_VERIFIED_CLOSE_INCOMPLETE');
assert.deepEqual([statusCalls,publicCalls,gasCalls,previewCalls],[1,1,1,1]);
const mismatch=await auditKbNavPostflight({...mocks,
 previewReader:async()=>exactPreview(2100.56)});
assert.equal(mismatch.verdict,'OFFICIAL_NAV_VALUE_MISMATCH_OR_UNVERIFIED');
assert.equal(mismatch.pass,false);
assert.ok(!JSON.stringify(mismatch).includes('2100.55')
 &&!JSON.stringify(mismatch).includes('2100.56'),
 'public NAV values must not appear in status-only outputs');
const missing=await auditKbNavPostflight({...mocks,
 sourceReader:async()=>({writerInvoked:false,rows:source.slice(0,1)}),
 previewReader:async()=>{throw Error('UNPUBLISHED_DID_NOT_SKIP_PREVIEW');}});
assert.equal(missing.verdict,'OFFICIAL_NAV_NOT_YET_PUBLISHED_CLOSE_INCOMPLETE');
await assert.rejects(()=>auditKbNavPostflight({
 ...mocks,sourceReader:async()=>({writerInvoked:true,rows:source})
}),/KB_POSTFLIGHT_SOURCE_UNVERIFIED/);
await assert.rejects(()=>auditKbNavPostflight({
 ...mocks,statusReader:async()=>({close:{...close,runDate:'2026-10-30'}})
}),/KB_POSTFLIGHT_CLOSE_DATE_UNVERIFIED/);
await assert.rejects(()=>auditKbNavPostflight({
 ...mocks,valuationReader:async()=>({status:'ok',fundResults:{F00002:{
  code:'F00002',dates:[{...verified,navState:'UNTRUSTED'}]
 }}})
}),/FUND_AUDIT_BAD_RESPONSE/);

const workflow=YAML.parse(fs.readFileSync('.github/workflows/kb-fund-nav-collect.yml','utf8'));
// The private collector must have at least two independently scheduled
// opportunities after the official NAV publication, because GitHub's cron
// scheduling can be delayed or silently skipped. This is a WAKING fallback,
// not a second writer: workflow concurrency and GAS idempotency must remain.
const cron=workflow.on?.schedule?.map(v=>v.cron);
assert.ok(Array.isArray(cron));
assert.ok(cron.includes('30 0 * * 1-5'),'09:30 KST weekday must remain');
assert.ok(cron.includes('10 0 * * 0,6'),'09:10 KST weekend official NAV catch-up');
assert.ok(cron.includes('10 9 * * *'),'18:10 KST primary must remain');
assert.ok(cron.includes('17 10 * * *'),'19:17 KST fallback must remain');
assert.equal(new Set(cron).size,cron.length,'duplicate cron wakes are wasteful');
assert.equal(workflow.concurrency.group,'kb-fund-nav-collect');
assert.equal(workflow.concurrency['cancel-in-progress'],false);
const privateCollector=workflow.jobs.collect;
assert.equal(privateCollector.environment,'portfolio-production-gas');
assert.match(privateCollector.if,/refs\/heads\/main/);
assert.match(privateCollector.if,/schedule/);
assert.match(privateCollector.steps.at(-1).run,/collect-kb-fund-nav[.]mjs --apply/);
const hanwhaCollector=workflow.jobs['hanwha-collect'];
assert.deepEqual(hanwhaCollector.needs,['collect']);
assert.equal(hanwhaCollector.environment,'portfolio-production-gas');
assert.match(hanwhaCollector.if,/always\(\)/);
assert.match(hanwhaCollector.steps.at(-1).run,/collect-hanwha-fund-nav[.]mjs --apply/);
const kbCollectorCode=fs.readFileSync('scripts/collect-kb-fund-nav.mjs','utf8');
assert.match(kbCollectorCode,/previewFundNavImport/);
assert.match(kbCollectorCode,/NAV_READBACK_FAILED/);
assert.match(kbCollectorCode,/if\s*\(candidates\.length\)/);
assert.match(kbCollectorCode,/sameDayExcluded|row\.date<today/);
const post=workflow.jobs['postflight-readonly'];
assert.ok(post,'protected postflight must exist');
assert.deepEqual(post.needs,['collect','hanwha-collect']);
assert.equal(post.environment,'portfolio-production-gas');
assert.match(post.if,/always\(\)/);
assert.match(post.steps.at(-1).run,/audit-kb-nav-postflight-readonly[.]mjs/);
assert.equal(post.steps.at(-1).env.GAS_ACCESS_TOKEN.includes('secrets.GAS_ACCESS_TOKEN'),true);
const script=fs.readFileSync('scripts/audit-kb-nav-postflight-readonly.mjs','utf8');
assert.doesNotMatch(script,/action:['"](?:collectKbFundNav|collectHanwhaFundNav|resumeIncompletePortfolioClose)['"]/);
assert.match(script,/action:'getFundValuationStatus'/);
assert.match(script,/action:'previewFundNavImport'/);
// The public source may be submitted only to read-only GAS preview.
let requestAction='';
const preview=await readKbExactNavPreview({
 url:'https://script.google.com/macros/s/EXAMPLE123/exec',token:'MOCK_TOKEN_1234',date,
 nav:2100.55,fetchImpl:async (_url,opts)=>{
   const body=Object.fromEntries(opts.body);
   requestAction=body.action;
   const input=JSON.parse(body.data);
   assert.equal(input.code,'F00002');assert.equal(input.provider,'KB_VALUE_ST');
   assert.equal(input.classCode,'AQ018');
   assert.deepEqual(input.rows,[{date,nav:2100.55}]);
   assert.equal(body.accessToken,'MOCK_TOKEN_1234');
   return {ok:true,json:async()=>exactPreview()};
 }});
assert.equal(requestAction,'previewFundNavImport');
assert.equal(verifyKbOfficialNavPreview(date,2100.55,preview),true);
console.log('KB NAV postflight: published-vs-persisted, close marker, safety and workflow PASS');
