import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {assessNavScheduledAdmission} from './nav-schedule-admission.mjs';
import {assessKbNavPostflight,auditKbNavPostflight,
 expectedKbOfficialReferenceDate,verifyKbOfficialNavPreview,readKbExactNavPreview}
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
assert.equal(assess().navWorkflowPass,true,
 'official exact NAV must not fail merely because separate GAS CLOSE is incomplete');
assert.equal(assess().navWorkflowStatus,'NAV_DATA_VERIFIED');
assert.equal(notPublished.navWorkflowPass,true,
 'not-yet-published NAV should be a bounded warning, never a false red import');
assert.equal(notPublished.navWorkflowStatus,'OFFICIAL_NAV_AWAITING_PUBLICATION');
assert.equal(assess({officialRows:[],fundRow:null}).navWorkflowPass,false,
 'zero official source rows is not proof of expected nonpublication');
assert.equal(assess({officialRows:[{date:'2026-10-25',nav:1}],
 fundRow:null}).navWorkflowPass,false,
 'stale public provider cannot defer import indefinitely');
const staleAsOf=assess({
 today:'2026-11-07',
 close:{...close,runDate:'2026-10-27',runStale:true,
  expectedRunDate:'2026-10-27',expectedSnapshotDate:'2026-10-27'},
 officialRows:[{date:'2026-10-27',nav:100}],
 fundRow:{...verified,date:'2026-10-27'},officialNavMatched:true
});
assert.equal(staleAsOf.navWorkflowPass,false,
 'old exact but abandoned NAV date cannot produce a green current preflight');
assert.equal(staleAsOf.navWorkflowStatus,'NAV_REFERENCE_STALE');
assert.equal(assess({fundRow:{...verified,snapshotState:'WRITE_REQUIRED'}}).navWorkflowPass,false,
 'unverified derived Snapshot remains blocking even when close is pending');
assert.equal(assess({officialNavMatched:false}).navWorkflowPass,false,
 'mismatched official NAV must fail the protected import audit');
assert.equal(assess({close:{...close,runStale:true}}).navWorkflowPass,true,
 'independent NAV proof survives an unrelated stale close marker');
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
assert.equal(staleProof.navWorkflowPass,false,
 'stale close pointing to older NAV must not hide newer published official NAV');
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
// Reproduce live run #42387302439: Sunday 2026-11-08 00:50 KST,
// GAS calendar close = Saturday 11/07, and official KB latest is Fri 11/06.
// The old postflight falsely reported 'NOT_YET_PUBLISHED' despite the
// protected collector importing Friday's exact official NAV.
const saturday='2026-11-07',sunday='2026-11-08';
assert.equal(expectedKbOfficialReferenceDate(saturday,source),date);
assert.equal(expectedKbOfficialReferenceDate(sunday,source),date);
assert.equal(expectedKbOfficialReferenceDate(date,source),date,
 'weekdays still require their own exact official NAV');
assert.equal(expectedKbOfficialReferenceDate(saturday,source.slice(0,1)),date,
 'missing Friday publication must remain unpublished, not reuse Thursday');
assert.equal(expectedKbOfficialReferenceDate(saturday,[...source,{date:saturday,nav:2101.55}]),saturday,
 'a genuine newer Saturday official publication wins');
const weekendClose={...close,runDate:saturday,
 expectedRunDate:saturday,expectedSnapshotDate:saturday};
const weekendAssessment=assess({today:sunday,close:weekendClose,
 officialRows:source,fundRow:verified});
assert.equal(weekendAssessment.closeDate,saturday);
assert.equal(weekendAssessment.officialReferenceDate,date);
assert.equal(weekendAssessment.officiallyPublished,true);
assert.equal(weekendAssessment.storedNavConfirmed,true);
assert.equal(weekendAssessment.derivedConfirmed,true);
assert.equal(weekendAssessment.verdict,'NAV_VERIFIED_CLOSE_INCOMPLETE');
assert.equal(weekendAssessment.pass,false,
 'fix must NEVER turn an incomplete GAS close green');
const carriedWeekendRow={...verified,date:saturday,navState:'EXISTING_CONFIRMED'};
assert.equal(assess({today:sunday,close:weekendClose,officialRows:source,
 fundRow:carriedWeekendRow}).verdict,'OFFICIAL_NAV_NOT_IMPORTED',
 'Saturday carried row is not Friday exact NAV readback');
const missingWeekend=assess({today:sunday,close:weekendClose,
 officialRows:source.slice(0,1),fundRow:null});
assert.equal(missingWeekend.verdict,'OFFICIAL_NAV_NOT_YET_PUBLISHED_CLOSE_INCOMPLETE');
const weekendAudit=await auditKbNavPostflight({...mocks,
 now:new Date('2026-11-07T16:00:00Z'),
 statusReader:async()=>({close:weekendClose}),
 valuationReader:async({from,to})=>{
   assert.equal(from,'2026-11-02');assert.equal(to,sunday);
   return proof;
 },
 previewReader:async ({date:asked,nav})=>{
   assert.equal(asked,date,'must preview published Friday, not Saturday');
   assert.equal(nav,2100.55);
   return exactPreview();
 }});
assert.equal(weekendAudit.officialReferenceDate,date);
assert.equal(weekendAudit.verdict,'NAV_VERIFIED_CLOSE_INCOMPLETE');
assert.equal(weekendAudit.pass,false);
// Real postflight must explain a failed GAS FUND stage without exposing
// request IDs, account information, raw exceptions, or changing pass/fail.
const stagedAudit=await auditKbNavPostflight({...mocks,
 statusReader:async()=>({
   close:{...close,stage:'FUND_PENDING',fundState:'TIMEOUT_SUSPECTED',
     fundErrorCode:'TIMEOUT'},
   fundResumeCheckpoint:{lastWorkStage:'snapshotWrite',
     requestId:'private-request-id',rawError:'PRIVATE_FINANCE_DETAIL'}
 })
});
assert.deepEqual(stagedAudit.fundCloseCheckpointEvidence,{
 level:'GAS_SAVED_CHECKPOINT_ONLY',processApiExecutionVerified:false,
 closeState:'INCOMPLETE',closeStage:'FUND_PENDING',closeRunDate:date,
 priceOk:true,fundOk:false,fundAttemptState:'TIMEOUT_SUSPECTED',
 fundFailureClass:'TIMEOUT',fundWorkStage:'snapshotWrite',
 fundResumeCheckpointPresent:true
});
assert.equal(stagedAudit.pass,false);
assert.equal(stagedAudit.verdict,'NAV_VERIFIED_CLOSE_INCOMPLETE');
assert.ok(!JSON.stringify(stagedAudit).includes('PRIVATE_FINANCE_DETAIL'));
assert.ok(!JSON.stringify(stagedAudit).includes('private-request-id'));

assert.ok(!JSON.stringify(weekendAudit).includes('2100.55'));

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
assert.ok(!cron.includes('10 0 * * 0,6'),'weekend NAV wake-ups disabled');
assert.ok(cron.includes('10 9 * * 1-5'),'18:10 KST weekday primary must remain');
assert.ok(cron.includes('17 10 * * 1-5'),'19:17 KST weekday fallback must remain');
assert.equal(new Set(cron).size,cron.length,'duplicate cron wakes are wasteful');
assert.deepEqual(workflow.on.workflow_run.workflows,
 ['KRX 252-session 52-week market breadth archive (source only)']);
assert.deepEqual(workflow.on.workflow_run.types,['completed']);
assert.deepEqual(workflow.on.workflow_run.branches,['main']);
for(const name of ['source-public','collect','hanwha-collect','postflight-readonly']){
 const guard=workflow.jobs[name].if;
 assert.match(guard,/github\.repository == 'cyyoung111-dev\/portfolio'/);
 assert.match(guard,/github\.ref == 'refs\/heads\/main'/);
 assert.match(guard,/github\.event_name == 'workflow_run'/);
 assert.match(guard,/github\.event\.workflow_run\.event == 'schedule'/);
 assert.match(guard,/github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
 assert.match(guard,/github\.event\.workflow_run\.head_branch == 'main'/);
 assert.match(guard,/github\.event\.workflow_run\.path == '\.github\/workflows\/krx-52week-history\.yml'/);
 assert.match(guard,/github\.event\.workflow_run\.run_attempt == 1/);
 assert.match(guard,/github\.run_attempt == 1/);
}
assert.doesNotMatch(workflow.jobs.collect.if,/github\.event_name == 'push'/,
 'source-only main push cannot launch protected financial writer');

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
const publicStatus=workflow.jobs['source-public'].steps.find(s=>
 s.name==='Record public source coverage without blocking private writer');
assert.ok(publicStatus,'mandatory public NAV status audit must remain');
assert.match(publicStatus.run,/PUBLIC_KB_NAV_UNAVAILABLE/);
assert.match(publicStatus.run,/PUBLIC_HANWHA_NAV_UNAVAILABLE/);
assert.match(publicStatus.run,/PUBLIC_FIDELITY_OPTIONAL_UNAVAILABLE/);
assert.doesNotMatch(publicStatus.run,/PUBLIC_FIDELITY_NAV_UNAVAILABLE/,
 'optional Fidelity archive must not fail KB/Hanwha operations');
const afterFidelity=publicStatus.run.split('PUBLIC_FIDELITY_OPTIONAL_UNAVAILABLE')[1]||'';
assert.doesNotMatch(afterFidelity.split('fi')[0],/incomplete=1/,
 'optional source warning cannot flip mandatory held-fund result');
assert.equal(post.steps.at(-1).env.GAS_ACCESS_TOKEN.includes('secrets.GAS_ACCESS_TOKEN'),true);
const script=fs.readFileSync('scripts/audit-kb-nav-postflight-readonly.mjs','utf8');
assert.doesNotMatch(script,/action:['"](?:collectKbFundNav|collectHanwhaFundNav|resumeIncompletePortfolioClose)['"]/);
assert.match(script,/action:'getFundValuationStatus'/);
assert.match(script,/action:'previewFundNavImport'/);
assert.match(script,/if\(!result\.navWorkflowPass\)process\.exitCode=1/,
 'postflight exit must reflect NAV-only integrity, not unrelated CLOSE finality');
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

 // 2026-11-14: weekend 09:10 scheduled GitHub action actually started
 // 15:05 KST, timed out on two GAS STATUS reads, while postflight proved
 // already-complete NAV. A stale cron must never enter protected GAS.
const navSlots=[
 ['2026-11-14T00:10:00Z','10 0 * * 0,6',false],
 ['2026-11-14T01:09:59Z','10 0 * * 0,6',false],
 ['2026-11-16T00:30:00Z','30 0 * * 1-5',true],
 ['2026-11-16T01:09:00Z','30 0 * * 1-5',true],
 ['2026-11-14T00:30:00Z','30 0 * * 1-5',false],
 ['2026-11-14T09:10:00Z','10 9 * * 1-5',false],
 ['2026-11-16T09:10:00Z','10 9 * * 1-5',true],
 ['2026-11-16T10:17:00Z','17 10 * * 1-5',true],
 ['2026-11-14T10:17:00Z','17 10 * * 1-5',false]
];
for(const [instant,cron,admit] of navSlots){
 const outcome=assessNavScheduledAdmission({
  eventName:'schedule',cron,now:new Date(instant)
 });
 assert.equal(outcome.admit,admit,'schedule slot '+cron+' / '+instant);
}
assert.equal(assessNavScheduledAdmission({
 eventName:'schedule',cron:'unknown',now:new Date('2026-11-14T00:10:00Z')
}).admit,false,'unsupported NAV cron fails closed');
assert.equal(assessNavScheduledAdmission({
 eventName:'workflow_dispatch',now:new Date('2026-11-14T06:05:57Z')
}).admit,true,'explicit manual run keeps existing GAS/lease safety checks');
assert.equal(assessNavScheduledAdmission({
 eventName:'workflow_run',now:new Date('2026-11-14T06:05:57Z')
}).admit,true,'existing upstream-KRX workflow_run behavior is unchanged');
assert.throws(()=>assessNavScheduledAdmission({
 eventName:'schedule',cron:'10 0 * * 0,6',now:new Date(NaN)
}),/NAV_ADMISSION_CLOCK_INVALID/);
for(const [label,jobName,writerName] of [
 ['KB','collect','Collect exact KB S-T published NAV and verify import'],
 ['HANWHA','hanwha-collect','Import exact Hanwha C-RPe NAV through shared GAS FUND/backfill lease']
]){
 const steps=workflow.jobs[jobName].steps;
 const admission=steps.findIndex(x=>x.name==='Block stale scheduled NAV starts before private GAS');
 const privateStep=steps.findIndex(x=>x.name===writerName);
 assert.ok(admission>=0&&privateStep>admission,
  label+' must check stale schedule before private GAS credentials/writer');
 assert.equal(steps[admission].run,'node scripts/nav-schedule-admission.mjs');
 assert.match(String(steps[admission].env.NAV_SCHEDULE_CRON),/github\.event\.schedule/);
}
console.log('NAV_SCHEDULE_DELAYED_ADMISSION_PASS '+JSON.stringify({
 simulatedSaturday0910Started1505:true,slots:navSlots.length,
 staleScheduleCannotReachGas:true,financialWrites:0
}));
