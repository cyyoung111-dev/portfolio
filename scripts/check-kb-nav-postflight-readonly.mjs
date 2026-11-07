import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {assessKbNavPostflight,auditKbNavPostflight}
 from './audit-kb-nav-postflight-readonly.mjs';

const today='2026-11-07',date='2026-11-06';
const source=[{date:'2026-11-05',nav:2169.72},{date,nav:2100.55}];
const close={state:'INCOMPLETE',runDate:date,priceOk:true,fundOk:false};
const verified={code:'F00002',date,navState:'EXISTING_CONFIRMED',
 valuationRequired:true,unitsApplied:true,reconciled:true,
 evaluationState:'EXISTING_VALID',snapshotState:'EXISTING_VALID',
 publicationExpected:true};
const assess=(change={})=>assessKbNavPostflight({
 today,close,officialRows:source,fundRow:verified,...change
});
const notPublished=assess({officialRows:source.slice(0,1),fundRow:null});
assert.equal(notPublished.verdict,'OFFICIAL_NAV_NOT_YET_PUBLISHED');
assert.equal(notPublished.pass,true);
assert.equal(notPublished.closeComplete,false);
assert.equal(assess({fundRow:{...verified,navState:'NAV_MISSING'}}).verdict,
 'OFFICIAL_NAV_NOT_IMPORTED');
assert.equal(assess({fundRow:null}).pass,false);
assert.equal(assess({fundRow:{...verified,snapshotState:'WRITE_REQUIRED'}}).verdict,
 'PUBLISHED_NAV_DERIVED_UNVERIFIED');
assert.equal(assess({fundRow:{...verified,unitsApplied:false}}).pass,false);
assert.equal(assess().verdict,'NAV_VERIFIED_CLOSE_INCOMPLETE');
assert.equal(assess().pass,false);
const healthy=assess({close:{...close,state:'COMPLETE',fundOk:true}});
assert.equal(healthy.verdict,'NAV_AND_CLOSE_VERIFIED');
assert.equal(healthy.pass,true);
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

let publicCalls=0,statusCalls=0,gasCalls=0;
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
 }
};
const result=await auditKbNavPostflight(mocks);
assert.equal(result.verdict,'NAV_VERIFIED_CLOSE_INCOMPLETE');
assert.deepEqual([statusCalls,publicCalls,gasCalls],[1,1,1]);
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
console.log('KB NAV postflight: published-vs-persisted, close marker, safety and workflow PASS');
