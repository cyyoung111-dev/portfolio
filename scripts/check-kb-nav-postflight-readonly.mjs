import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import YAML from 'yaml';
import {assessNavScheduledAdmission} from './nav-schedule-admission.mjs';
import {assessKbNavPostflight,auditKbNavPostflight,auditHanwhaNavPostflight,auditBothNavPostflight,
 expectedKbOfficialReferenceDate,verifyKbOfficialNavPreview,readKbExactNavPreview,
 safeNavPostflightFailureReason}
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
// A 19:17 collector runs after today's CLOSE starts/finishes, but must
// independently verify the exact prior-day NAV, not infer today's missing
// publication equals successful collection. Normal daily-ops retains scope.
const currentClose={...close,runDate:today,expectedRunDate:today,
 expectedSnapshotDate:today,state:'COMPLETE',fundOk:true};
const evening={...mocks,now:new Date('2026-11-07T10:17:00Z'),
 statusReader:async()=>({close:currentClose}),
 valuationReader:async({from,to})=>{
  assert.equal(from,'2026-10-31');assert.equal(to,date);
  return proof;
 },
 previewReader:async({date:asked,nav})=>{
  assert.equal(asked,date);assert.equal(nav,2100.55);return exactPreview();
 }};
const priorAudit=await auditKbNavPostflight({...evening,completedDaysOnly:true});
assert.equal(priorAudit.closeDate,today);
assert.equal(priorAudit.navTargetDate,date);
assert.equal(priorAudit.officialReferenceDate,date);
assert.equal(priorAudit.navScope,'COMPLETED_DAYS_ONLY');
assert.equal(priorAudit.navWorkflowStatus,'NAV_DATA_VERIFIED');
assert.equal(priorAudit.navWorkflowPass,true);
assert.equal(priorAudit.verdict,'PRIOR_NAV_VERIFIED_CURRENT_CLOSE_COMPLETE');
assert.equal(priorAudit.pass,false,'prior NAV cannot prove current-day combined CLOSE');
const badPrior=await auditKbNavPostflight({...evening,completedDaysOnly:true,
 previewReader:async()=>exactPreview(2100.56)});
assert.equal(badPrior.navWorkflowPass,false,'wrong prior NAV cannot be hidden by today close');
const omittedPrior=await auditKbNavPostflight({...evening,completedDaysOnly:true,
 valuationReader:async()=>({status:'ok',fundResults:{F00002:{code:'F00002',dates:[]}}})});
assert.equal(omittedPrior.navWorkflowPass,false,'missing prior valuation cannot be hidden by today close');
for(const field of ['evaluationState','snapshotState']){
 const bad=assess({fundRow:{...verified,[field]:'NOT_REQUIRED'}});
 assert.equal(bad.navWorkflowPass,false,'required derived row cannot be NOT_REQUIRED');
}
const weekdayToday='2026-11-10',weekdayPrior='2026-11-09';
const weekdayOfficial={date:weekdayPrior,nav:2100.55};
const weekdayClose={...currentClose,runDate:weekdayToday,
 expectedRunDate:weekdayToday,expectedSnapshotDate:weekdayToday};
const weekdayMock={...evening,now:new Date(weekdayToday+'T19:17:00+09:00'),
 statusReader:async()=>({close:weekdayClose}),
 sourceReader:async()=>({writerInvoked:false,rows:[weekdayOfficial]}),
 valuationReader:async({to})=>{
  assert.equal(to,weekdayPrior);
  return {status:'ok',fundResults:{F00002:{code:'F00002',dates:[{...verified,date:weekdayPrior}]}}};
 },
 previewReader:async({date:asked,nav})=>{
  assert.equal(asked,weekdayPrior);assert.equal(nav,weekdayOfficial.nav);
  return {...exactPreview(),identical:[{date:weekdayPrior,existingNav:nav,uploadedNav:nav}]};
 }};
const weekdayAudit=await auditKbNavPostflight({...weekdayMock,completedDaysOnly:true});
assert.equal(weekdayAudit.navWorkflowStatus,'NAV_DATA_VERIFIED');
const dailyAudit=await auditKbNavPostflight({...weekdayMock,
 valuationReader:async({to})=>{
  assert.equal(to,weekdayToday);
  return {status:'ok',fundResults:{F00002:{code:'F00002',dates:[{...verified,date:weekdayPrior}]}}};
 },
 previewReader:async()=>assert.fail('unpublished today must not preview')});
assert.equal(dailyAudit.navScope,'CLOSE_SESSION');
assert.equal(dailyAudit.officialReferenceDate,weekdayToday);
assert.equal(dailyAudit.navWorkflowStatus,'OFFICIAL_NAV_AWAITING_PUBLICATION');
console.log('NAV_POSTFLIGHT_COMPLETED_DAY_SCOPE_PASS prior exact proof, missing/wrong prior rejected, current close independent, daily scope retained');
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
// NAV official NAV class/date has no dependency on KRX T+1 raw OHLC
// market-breadth collection. Removing its workflow_run wake must preserve
// independently scheduled NAV jobs, manual fallback and main-only guards.
assert.equal(workflow.on.workflow_run,undefined,
 'KRX52 source completion must never fan out to NAV collector');
assert.ok(Object.hasOwn(workflow.on,'workflow_dispatch'),
 'independent NAV fallback needs protected manual dispatch');
assert.deepEqual(workflow.on.push.paths,[
 '.github/workflows/kb-fund-nav-collect.yml',
 'scripts/collect-kb-fund-nav.mjs',
 'scripts/collect-hanwha-public-nav.mjs',
 'scripts/collect-fidelity-public-nav.mjs'
]);
for(const name of ['source-public','collect','hanwha-collect','postflight-readonly']){
 const guard=workflow.jobs[name].if;
 assert.match(guard,/github\.repository == 'cyyoung111-dev\/portfolio'/);
 assert.match(guard,/github\.ref == 'refs\/heads\/main'/);
 assert.match(guard,/github\.event_name == 'schedule'/);
 assert.match(guard,/github\.event_name == 'workflow_dispatch'/);
 assert.doesNotMatch(guard,/workflow_run/,
  'KRX market-breadth workflow must no longer wake NAV');
}
assert.match(workflow.jobs['source-public'].if,/github\.event_name == 'push'/);
for(const name of ['collect','hanwha-collect','postflight-readonly']){
 assert.doesNotMatch(workflow.jobs[name].if,/github\.event_name == 'push'/,
  'source-only main push must never authorize a financial NAV writer');
}
assert.doesNotMatch(workflow.jobs.collect.if,/github\.event_name == 'push'/,
 'source-only main push cannot launch protected financial writer');

assert.equal(workflow.concurrency.group,'kb-fund-nav-collect');
assert.equal(workflow.concurrency['cancel-in-progress'],false);
const candidate=workflow.jobs['source-kofia-candidate'];
assert.deepEqual(candidate.needs,['source-public']);
assert.equal(candidate.environment,undefined);
assert.match(candidate.if,/github\.ref == 'refs\/heads\/main'/);
assert.match(candidate.if,/needs\['source-public'\]\.result == 'failure'/);
assert.match(candidate.if,/needs\['source-public'\]\.outputs\.admitted == 'true'/);
const publicJob=workflow.jobs['source-public'];
assert.equal(publicJob.outputs.admitted,'
assert.match(candidate.steps.find(x=>x.id==='candidate').run,/--archive/);
assert.match(candidate.steps.at(-1).with.name,/public-nav-candidate-/);
assert.doesNotMatch(JSON.stringify(candidate),/GAS_ACCESS_TOKEN|portfolio-production-gas|--apply|secrets\./);
for(const name of ['collect','hanwha-collect','postflight-readonly'])
 assert.doesNotMatch(JSON.stringify(workflow.jobs[name]),/source-kofia-candidate|public-nav-candidate/);
const candidatePreview=workflow.jobs['candidate-preview-readonly'];
assert.deepEqual(candidatePreview.needs,['source-kofia-candidate','postflight-readonly']);
assert.equal(candidatePreview.environment,'portfolio-production-gas');
assert.match(candidatePreview.if,/github\.event_name == 'push'/);
assert.match(candidatePreview.if,/needs\['postflight-readonly'\]\.result == 'failure'/);
assert.match(candidatePreview.if,/github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/);
assert.match(candidatePreview.if,/!cancelled\(\)/);
assert.doesNotMatch(candidatePreview.if,/postflight-readonly'\]\.result == 'skipped'/);
assert.match(candidatePreview.if,/needs\['source-kofia-candidate'\]\.result == 'success'/);
assert.match(candidatePreview.steps.at(-1).run,/preview-crosschecked-nav-readonly[.]mjs/);
assert.doesNotMatch(JSON.stringify(candidatePreview),/--apply|collectKbFundNav|collectHanwhaFundNav/);
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
assert.match(post.if,/&& \(needs\.collect\.outputs\.admitted == 'true' \|\| needs\['hanwha-collect'\]\.outputs\.admitted == 'true'\)$/);
for(const name of ['collect','hanwha-collect']){
 const job=workflow.jobs[name];
 assert.equal(job.outputs.admitted,'$'+'{{ steps.nav_admission.outputs.admitted }}');
 assert.equal(job.steps.find(step=>step.id==='nav_admission').run,
   'node scripts/nav-schedule-admission.mjs');
}
assert.equal(post.steps.at(-1).run,'node scripts/audit-kb-nav-postflight-readonly.mjs --both');
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
// #734: the initial private collector has a bounded read-only preview retry;
// postflight must not emit a false failure for one transient 200/HTML response.
const readonlyOptions={url:'https://script.google.com/macros/s/EXAMPLE123/exec',
 token:'MOCK_TOKEN_1234',date,nav:2100.55};
let jsonCalls=0,delays=[];
const afterHtml=await readKbExactNavPreview({...readonlyOptions,
 retryDelay:async delay=>{delays.push(delay);},
 fetchImpl:async (_url,opts)=>{
   assert.equal(opts.body.get('action'),'previewFundNavImport');
   assert.equal(opts.body.get('accessToken'),'MOCK_TOKEN_1234');
   jsonCalls++;
   return jsonCalls===1
     ?{ok:true,headers:{get:()=> 'text/html'},json:async()=>{throw Error('HTML');}}
     :{ok:true,json:async()=>exactPreview()};
 }});
assert.equal(jsonCalls,2,'one invalid JSON read-only preview may retry once');
assert.deepEqual(delays,[1500]);
assert.equal(verifyKbOfficialNavPreview(date,2100.55,afterHtml),true);
let transientCalls=0;
await readKbExactNavPreview({...readonlyOptions,retryDelay:async()=>{},
 fetchImpl:async()=>{
   transientCalls++;
   return transientCalls===1?{ok:false,status:503}
     :{ok:true,json:async()=>exactPreview()};
 }});
assert.equal(transientCalls,2,'a single 503 is retryable on a read-only preview');
let networkCalls=0;
await readKbExactNavPreview({...readonlyOptions,retryDelay:async()=>{},
 fetchImpl:async()=>{
   networkCalls++;
   if(networkCalls===1)throw Error('transient network');
   return {ok:true,json:async()=>exactPreview()};
 }});
assert.equal(networkCalls,2,'a single network failure can retry only the preview');
let deniedCalls=0;
await assert.rejects(()=>readKbExactNavPreview({...readonlyOptions,
 retryDelay:async()=>assert.fail('401/403 must not be retried'),
 fetchImpl:async()=>{
   deniedCalls++;
   return {ok:false,status:403};
 }}),/KB_POSTFLIGHT_PREVIEW_HTTP_UNVERIFIED/);
assert.equal(deniedCalls,1);
let malformedCalls=0;
const malformed=await readKbExactNavPreview({...readonlyOptions,
 retryDelay:async()=>assert.fail('valid JSON schema mismatch must not retry'),
 fetchImpl:async()=>{
   malformedCalls++;
   return {ok:true,json:async()=>exactPreview(2100.56)};
 }});
assert.equal(malformedCalls,1);
assert.equal(verifyKbOfficialNavPreview(date,2100.55,malformed),false,
 'source vs persisted amount mismatch must fail closed');
let persistentBadCalls=0;
await assert.rejects(()=>readKbExactNavPreview({...readonlyOptions,
 retryDelay:async()=>{},
 fetchImpl:async()=>{
   persistentBadCalls++;
   return {ok:true,json:async()=>{throw Error('HTML');}};
 }}),/KB_POSTFLIGHT_PREVIEW_JSON_UNVERIFIED/);
assert.equal(persistentBadCalls,2,'transient retry is strictly bounded to one');
const readonlyPreviewCode=fs.readFileSync(
 'scripts/audit-kb-nav-postflight-readonly.mjs','utf8').split(
 'export async function readKbExactNavPreview(')[1].split(
 'export async function auditKbNavPostflight(')[0];
assert.doesNotMatch(readonlyPreviewCode,/collectKbFundNav|collectHanwhaFundNav|mode:'import'|mode:'refresh'/,
 'postflight must never call a financial writer');
// Both funds get independent exact-date source and derived checks. Share
// only the immutable close read, never a source or another fund's proof.
const hanwhaSource={writerInvoked:false,code:'F00001',
 provider:'HANWHA_2045_CRPE',classCode:'C-RPe',
 sourceUsed:'HANWHA_PRIMARY',lookupCode:'008942',rows:source};
const hProof={status:'ok',fundResults:{F00001:{code:'F00001',
 dates:[{...verified,code:'F00001'}]}}};
const hPreview={...exactPreview(),code:'F00001'};
const hOptions={...mocks,completedDaysOnly:true,
 sourceReader:async()=>hanwhaSource,
 valuationReader:async({code,to})=>{
  assert.equal(code,'F00001');assert.equal(to,date);return hProof;
 },
 previewReader:async({code,sourceUsed,nav,date:asked})=>{
  assert.equal(code,'F00001');assert.equal(sourceUsed,'HANWHA_PRIMARY');
  assert.equal(asked,date);assert.equal(nav,2100.55);return hPreview;
 }};
const hResult=await auditHanwhaNavPostflight(hOptions);
assert.equal(hResult.kind,'HANWHA_NAV_CLOSE_POSTFLIGHT_READ_ONLY');
assert.equal(hResult.navWorkflowStatus,'NAV_DATA_VERIFIED');
assert.equal(hResult.navWorkflowPass,true);
assert.equal(hResult.financialWrites,0);
for(const change of [
 {previewReader:async()=>exactPreview()},
 {previewReader:async()=>({...exactPreview(2100.56),code:'F00001'})},
 {valuationReader:async()=>({status:'ok',fundResults:{F00001:{code:'F00001',dates:[]}}})},
 {valuationReader:async()=>({status:'ok',fundResults:{F00001:{code:'F00001',dates:[
   {...verified,code:'F00001',snapshotState:'WRITE_REQUIRED'}]}}})}
]){
 const result=await auditHanwhaNavPostflight({...hOptions,...change});
 assert.equal(result.navWorkflowPass,false);
}
for(const change of [{code:'F00002'},{classCode:'C-Pe'},
 {lookupCode:'008943'},{provider:'KB_VALUE_ST'},{sourceUsed:'UNKNOWN'}]){
 await assert.rejects(()=>auditHanwhaNavPostflight({...hOptions,
  sourceReader:async()=>({...hanwhaSource,...change}),
  valuationReader:async()=>assert.fail('unverified class must not reach GAS valuation')
 }),/HANWHA_POSTFLIGHT_SOURCE_UNVERIFIED/);
}
for(const sourceUsed of ['HANWHA_PRIMARY','FUNETF_CRPE_SECONDARY']){
 await readKbExactNavPreview({...readonlyOptions,code:'F00001',sourceUsed,
  fetchImpl:async(_url,opts)=>{
   const body=Object.fromEntries(opts.body);
   assert.equal(body.action,'previewFundNavImport');
   const input=JSON.parse(body.data);
   assert.equal(input.code,'F00001');
   assert.equal(input.provider,'HANWHA_2045_CRPE');
   assert.equal(input.classCode,'C-RPe');
   assert.equal(input.ackWarnings,false);
   assert.match(input.sourceText,sourceUsed==='HANWHA_PRIMARY'?/^008942 /:/^K55213C50702 /);
   assert.deepEqual(input.rows,[{date,nav:2100.55}]);
   return {ok:true,json:async()=>hPreview};
  }});
}
let sharedReads=0;const results=[];
const bothOptions={now:mocks.now,statusReader:async()=>{sharedReads++;return {close};},
 kbReader:args=>auditKbNavPostflight({...mocks,...args,
  valuationReader:async()=>proof}),
 hanwhaReader:args=>auditHanwhaNavPostflight({...hOptions,...args}),
 emit:(code,result)=>results.push([code,result.navWorkflowPass])};
assert.equal(await auditBothNavPostflight(bothOptions),true);
assert.deepEqual(results,[['F00002',true],['F00001',true]]);
assert.equal(sharedReads,1);
results.length=0;sharedReads=0;
assert.equal(await auditBothNavPostflight({...bothOptions,
 kbReader:async()=>{throw Error('SENSITIVE');}}),false);
assert.deepEqual(results,[['F00002',false],['F00001',true]]);
assert.equal(sharedReads,1);
// Real 2026-11-27 runner failures must retain actionable *sanitized*
// source categories. No raw error body, token, NAV or holder data is logged.
const failures=[];
assert.equal(await auditBothNavPostflight({...bothOptions,
 kbReader:async()=>{throw Error('NAV_SOURCE_HTTP_403');},
 hanwhaReader:async()=>{throw Error('HANWHA_FUNETF_HTTP_UNVERIFIED');},
 emit:(code,row)=>failures.push({code,kind:row.kind,pass:row.navWorkflowPass,reason:row.reason,writes:row.financialWrites})
}),false);
assert.deepEqual(failures,[
 {code:'F00002',kind:'FUND_NAV_POSTFLIGHT_UNVERIFIED',pass:false,reason:'NAV_SOURCE_HTTP_403',writes:0},
 {code:'F00001',kind:'FUND_NAV_POSTFLIGHT_UNVERIFIED',pass:false,reason:'HANWHA_FUNETF_HTTP_UNVERIFIED',writes:0}
]);
for(const [code,message,expected] of [
 ['F00002','NAV_SOURCE_HTTP_429','NAV_SOURCE_HTTP_429'],
 ['F00002','NAV_SOURCE_HTTP_403 PRIVATE_TOKEN','FUND_NAV_POSTFLIGHT_UNVERIFIED'],
 ['F00002','HANWHA_FUNETF_HTTP_UNVERIFIED','FUND_NAV_POSTFLIGHT_UNVERIFIED'],
 ['F00001','NAV_SOURCE_HTTP_403','FUND_NAV_POSTFLIGHT_UNVERIFIED'],
 ['F00001','SENSITIVE PRIVATE_FINANCE_DETAIL','FUND_NAV_POSTFLIGHT_UNVERIFIED'],
 ['F00001','HANWHA_SOURCE_NETWORK_UNVERIFIED','HANWHA_SOURCE_NETWORK_UNVERIFIED']
])assert.equal(safeNavPostflightFailureReason(code,new Error(message)),expected);
assert.equal(safeNavPostflightFailureReason('F00002',new Error('KB_POSTFLIGHT_GAS_NETWORK_UNVERIFIED')),'KB_POSTFLIGHT_GAS_NETWORK_UNVERIFIED');
assert.ok(!JSON.stringify(failures).includes('PRIVATE_TOKEN'));
console.log('BOTH_NAV_POSTFLIGHT_SAFE_SOURCE_REASONS_PASS no data writes, source errors preserved, untrusted details redacted');
console.log('BOTH_NAV_POSTFLIGHT_EXACT_PASS same close read, exact fund/date/value proof, independent errors, no finance writer');
console.log('KB NAV postflight: published-vs-persisted, close marker, transient read-only preview and workflow PASS');

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
// Execute the real admission CLI with no GAS credentials. A retired cron
// must fail and export false; manual collection exports true. Downstream
// reconciliation uses either admitted job, not its final success/failure.
// Same-run continuation requires an actual earlier on-time start in the
// SAME slot/day. The recovery-period deadline and elapsed time are bounded.
const continuationCases=[
 ['30 0 * * 1-5','2026-11-16T00:59:00Z','2026-11-16T01:15:00Z',true],
 ['30 0 * * 1-5','2026-11-16T01:09:00Z','2026-11-16T02:59:00Z',true],
 ['30 0 * * 1-5','2026-11-16T01:09:59Z','2026-11-16T03:10:00Z',false],
 ['30 0 * * 1-5','2026-11-16T00:30:00Z','2026-11-16T02:30:00Z',true],
 ['30 0 * * 1-5','2026-11-16T00:30:00Z','2026-11-16T02:30:01Z',false],
 ['30 0 * * 1-5','2026-11-16T01:10:00Z','2026-11-16T01:15:00Z',false],
 ['30 0 * * 1-5','2026-11-15T00:59:00Z','2026-11-16T01:15:00Z',false],
 ['30 0 * * 1-5','2026-11-14T00:59:00Z','2026-11-14T01:15:00Z',false],
 ['30 0 * * 1-5','2026-11-16T01:09:00Z','2026-11-16T00:20:00Z',false],
 ['10 9 * * 1-5','2026-11-16T09:45:00Z','2026-11-16T10:20:00Z',true],
 ['10 9 * * 1-5','2026-11-16T10:16:00Z','2026-11-16T12:10:00Z',true],
 ['10 9 * * 1-5','2026-11-16T10:16:00Z','2026-11-16T12:11:00Z',false],
 ['17 10 * * 1-5','2026-11-16T10:59:00Z','2026-11-16T11:35:00Z',true],
 ['17 10 * * 1-5','2026-11-16T11:19:00Z','2026-11-16T12:10:00Z',true],
 ['17 10 * * 1-5','2026-11-16T11:19:00Z','2026-11-16T12:11:00Z',false]
];
for(const [cron,prior,instant,expected] of continuationCases){
 const o=assessNavScheduledAdmission({eventName:'schedule',cron,
  priorAdmittedAt:new Date(prior).toISOString(),now:new Date(instant)});
 assert.equal(o.admit,expected,cron+' '+prior+' -> '+instant);
 if(expected)assert.equal(o.status,'ADMITTED_SAME_RUN_CONTINUATION');
}
for(const priorAdmittedAt of ['',undefined,'invalid','2026-11-16T00:59:00Z']){
 assert.equal(assessNavScheduledAdmission({eventName:'schedule',
  cron:'30 0 * * 1-5',priorAdmittedAt,now:new Date('2026-11-16T01:15:00Z')}).admit,false);
}
const kbAdmission=workflow.jobs.collect.steps.find(x=>x.id==='nav_admission');
const hAdmission=workflow.jobs['hanwha-collect'].steps.find(x=>x.id==='nav_admission');
assert.equal(kbAdmission.env.NAV_PRIOR_ADMITTED_AT,undefined,
 'initial KB may never receive continuation evidence');
assert.equal(workflow.jobs.collect.outputs.admitted_at,'$'+'{{ steps.nav_admission.outputs.admitted_at }}');
assert.equal(hAdmission.env.NAV_PRIOR_ADMITTED_AT,'$'+'{{ needs.collect.outputs.admitted_at }}');
const admissionTmp=fs.mkdtempSync(join(tmpdir(),'nav-admission-'));
try{
 for(const [event,cron,expected,exit] of [
  ['schedule','10 0 * * 0,6',false,1],
  ['schedule','invalid',false,1],
  ['workflow_dispatch','',true,0]
 ]){
  const output=join(admissionTmp,'out');
  fs.writeFileSync(output,'');
  const r=spawnSync(process.execPath,['scripts/nav-schedule-admission.mjs'],{
   encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:event,
   NAV_SCHEDULE_CRON:cron,NAV_PRIOR_ADMITTED_AT:'',GITHUB_OUTPUT:output,GITHUB_STEP_SUMMARY:''}
  });
  assert.equal(r.status,exit,r.stderr);
  const proof=fs.readFileSync(output,'utf8').trimEnd().split('\n');
  assert.equal(proof[0],'admitted='+expected);
  if(expected)assert.match(proof[1],/^admitted_at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  else assert.equal(proof[1],'admitted_at=');
  assert.match(r.stdout,/"gasCalls":0,"financialWrites":0/);
 }
}finally{fs.rmSync(admissionTmp,{recursive:true,force:true});}
console.log('NAV_SCHEDULE_DELAYED_ADMISSION_PASS '+JSON.stringify({
 simulatedSaturday0910Started1505:true,slots:navSlots.length,
 staleScheduleCannotReachGas:true,postflightRequiresAdmittedCollector:true,sameRunContinuationCases:continuationCases.length,financialWrites:0
}));

 // Real adapter and GAS preview contract with a mock transport. No network.
const {selectCrosscheckedCandidate}=await import('./nav-crosschecked-candidate.mjs');
const {previewCrosscheckedNav}=await import('./preview-crosschecked-nav-readonly.mjs');
const candidateToday='2026-11-27',candidateDates=['2026-11-20','2026-11-23','2026-11-24','2026-11-25','2026-11-26'];
const exampleArchive={kind:'PUBLIC_NAV_CANDIDATE_ARCHIVE',asOfKst:candidateToday,importAuthorized:false,
 financialWrites:0,gasCalls:0,requestedDates:candidateDates,
 funds:[['F00002','KR5223AQ0185'],['F00001','K55213C50702']].map(([fund,standardCode])=>({
  fund,standardCode,source:'https://dis.kofia.or.kr/proframeWeb/XMLSERVICES/',anchorState:'MATCH',secondaryState:'RETRIEVED',
  rows:candidateDates.map((date,i)=>({date,nav:String(1000+i)})),
  crosscheck:{state:'CROSSCHECK_MATCHED',conflictDates:[],matchedDates:candidateDates.slice(0,4)}
 }))};
assert.equal(selectCrosscheckedCandidate(exampleArchive,'F00002',candidateToday).rows.length,4);
const missingPrimary=structuredClone(exampleArchive);missingPrimary.funds[0].rows.pop();
assert.deepEqual(selectCrosscheckedCandidate(missingPrimary,'F00002',candidateToday).unverifiedDates,['2026-11-26']);
const staleRange=structuredClone(exampleArchive);staleRange.requestedDates=['2026-11-19',...candidateDates.slice(0,4)];
assert.throws(()=>selectCrosscheckedCandidate(staleRange,'F00002',candidateToday),/NAV_CANDIDATE_RANGE_UNVERIFIED/);
assert.deepEqual(selectCrosscheckedCandidate(exampleArchive,'F00001',candidateToday).unverifiedDates,['2026-11-26']);
assert.throws(()=>selectCrosscheckedCandidate({...exampleArchive,asOfKst:'2026-11-26'},'F00002',candidateToday),/NAV_CANDIDATE_ARCHIVE_UNVERIFIED/);
for(const mutate of [a=>a.funds[0].standardCode='WRONG',a=>a.funds[0].crosscheck.conflictDates=['2026-11-23'],
 a=>a.funds[0].rows.push(a.funds[0].rows[0]),a=>a.funds[0].crosscheck.matchedDates=['2026-11-20']]){
 const invalid=structuredClone(exampleArchive);mutate(invalid);
 assert.throws(()=>selectCrosscheckedCandidate(invalid,'F00002',candidateToday),/NAV_CANDIDATE_/);
}
const candidateMock=({noOverlap=false,conflict=false}={})=>async(dest,opts)=>{
 const action=opts.body.get('action');
 assert.equal(new URL(dest).origin,'https://script.google.com');
 assert.ok(['getAutomationStatus','previewFundNavImport'].includes(action));
 if(action==='getAutomationStatus')return {ok:true,json:async()=>opts.body.get('accessToken')==='test-candidate-token'
  ?{status:'ok',gasVersion:'9.305',automation:{closeRun:{runDate:'2026-11-26'}}}
  :{status:'error',message:'인증 실패'}};
 const input=JSON.parse(opts.body.get('data'));
 assert.equal(input.appendOnly,true);assert.equal(input.ackWarnings,false);
 assert.equal(input.rows.length,4);assert(!input.rows.some(r=>r.date==='2026-11-26'));
 const identical=noOverlap?[]:[{date:input.rows[0].date,existingNav:input.rows[0].nav,uploadedNav:input.rows[0].nav}];
 return {ok:true,json:async()=>({status:'ok',code:input.code,
  candidates:input.rows.slice(noOverlap?0:1),identical,
  updates:conflict?[{}]:[],warnings:[],errors:[],duplicates:[],zeroUnits:[]})};
};
const candidateOptions={archive:exampleArchive,url:'https://script.google.com/macros/s/TEST_CANDIDATE/exec',token:'test-candidate-token',now:new Date('2026-11-27T01:00:00+09:00')};
const candidateResult=await previewCrosscheckedNav({...candidateOptions,fetchImpl:candidateMock()});
assert.equal(candidateResult.financialWrites,0);assert.equal(candidateResult.importAuthorized,false);
assert.equal(candidateResult.results.length,2);
assert.ok(candidateResult.results.every(r=>r.latestRequestedDateCrosschecked===false&&r.allRequestedDatesCrosschecked===false&&r.allCloseEligibleDatesPreviewed===false));
assert.deepEqual(candidateResult.results[0].identicalDates,['2026-11-20']);
assert.deepEqual(candidateResult.results[0].candidateDates,['2026-11-23','2026-11-24','2026-11-25']);
const completeArchive=structuredClone(exampleArchive);for(const f of completeArchive.funds)f.crosscheck.matchedDates=[...candidateDates];
const completeResult=await previewCrosscheckedNav({...candidateOptions,archive:completeArchive,fetchImpl:async(dest,opts)=>{
 if(opts.body.get('action')==='getAutomationStatus')return candidateMock()(dest,opts);
 assert.equal(opts.body.get('action'),'previewFundNavImport');
 const input=JSON.parse(opts.body.get('data'));assert.equal(input.rows.length,5);
 return {ok:true,json:async()=>({status:'ok',code:input.code,identical:[{date:input.rows[0].date,existingNav:input.rows[0].nav,uploadedNav:input.rows[0].nav}],candidates:input.rows.slice(1),updates:[],warnings:[],errors:[],duplicates:[],zeroUnits:[]})};
}});
assert.ok(completeResult.results.every(r=>r.latestRequestedDateCrosschecked===true&&r.allRequestedDatesCrosschecked===true&&r.allCloseEligibleDatesPreviewed===true));
assert.equal(completeResult.financialWrites,0);assert.equal(completeResult.importAuthorized,false);
await assert.rejects(()=>previewCrosscheckedNav({...candidateOptions,fetchImpl:candidateMock({noOverlap:true})}),/NAV_CANDIDATE_PERSISTED_OVERLAP_UNVERIFIED/);
await assert.rejects(()=>previewCrosscheckedNav({...candidateOptions,fetchImpl:candidateMock({conflict:true})}),/NAV_CANDIDATE_PREVIEW_BLOCKED/);
console.log('NAV crosschecked candidate exact-class and read-only GAS preview PASS');
+'{{ steps.public_admission.outputs.admitted }}');
const publicAdmission=publicJob.steps.find(s=>s.id==='public_admission');
assert.match(publicAdmission.run,/assessNavScheduledAdmission/);
for(const id of ['public-nav','hanwha-public','fidelity-public']){
 const step=publicJob.steps.find(x=>x.id===id);
 assert.ok(publicJob.steps.indexOf(publicAdmission)<publicJob.steps.indexOf(step));
 assert.equal(step.if,"steps.public_admission.outputs.admitted == 'true'");
}
assert.equal(publicJob.steps.at(-1).if,"always() && steps.public_admission.outputs.admitted == 'true'");
assert.equal(assessNavScheduledAdmission({eventName:'schedule',cron:'10 9 * * 1-5',now:new Date('2026-11-28T03:55:00+09:00')}).admit,false);
assert.equal(assessNavScheduledAdmission({eventName:'schedule',cron:'10 9 * * 1-5',now:new Date('2026-11-27T18:11:00+09:00')}).admit,true);

assert.match(candidate.steps.find(x=>x.id==='candidate').run,/--archive/);
assert.match(candidate.steps.at(-1).with.name,/public-nav-candidate-/);
assert.doesNotMatch(JSON.stringify(candidate),/GAS_ACCESS_TOKEN|portfolio-production-gas|--apply|secrets\./);
for(const name of ['collect','hanwha-collect','postflight-readonly'])
 assert.doesNotMatch(JSON.stringify(workflow.jobs[name]),/source-kofia-candidate|public-nav-candidate/);
const candidatePreview=workflow.jobs['candidate-preview-readonly'];
assert.deepEqual(candidatePreview.needs,['source-kofia-candidate','postflight-readonly']);
assert.equal(candidatePreview.environment,'portfolio-production-gas');
assert.match(candidatePreview.if,/github\.event_name == 'push'/);
assert.match(candidatePreview.if,/needs\['postflight-readonly'\]\.result == 'failure'/);
assert.match(candidatePreview.if,/github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/);
assert.match(candidatePreview.if,/!cancelled\(\)/);
assert.doesNotMatch(candidatePreview.if,/postflight-readonly'\]\.result == 'skipped'/);
assert.match(candidatePreview.if,/needs\['source-kofia-candidate'\]\.result == 'success'/);
assert.match(candidatePreview.steps.at(-1).run,/preview-crosschecked-nav-readonly[.]mjs/);
assert.doesNotMatch(JSON.stringify(candidatePreview),/--apply|collectKbFundNav|collectHanwhaFundNav/);
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
assert.match(post.if,/&& \(needs\.collect\.outputs\.admitted == 'true' \|\| needs\['hanwha-collect'\]\.outputs\.admitted == 'true'\)$/);
for(const name of ['collect','hanwha-collect']){
 const job=workflow.jobs[name];
 assert.equal(job.outputs.admitted,'$'+'{{ steps.nav_admission.outputs.admitted }}');
 assert.equal(job.steps.find(step=>step.id==='nav_admission').run,
   'node scripts/nav-schedule-admission.mjs');
}
assert.equal(post.steps.at(-1).run,'node scripts/audit-kb-nav-postflight-readonly.mjs --both');
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
// #734: the initial private collector has a bounded read-only preview retry;
// postflight must not emit a false failure for one transient 200/HTML response.
const readonlyOptions={url:'https://script.google.com/macros/s/EXAMPLE123/exec',
 token:'MOCK_TOKEN_1234',date,nav:2100.55};
let jsonCalls=0,delays=[];
const afterHtml=await readKbExactNavPreview({...readonlyOptions,
 retryDelay:async delay=>{delays.push(delay);},
 fetchImpl:async (_url,opts)=>{
   assert.equal(opts.body.get('action'),'previewFundNavImport');
   assert.equal(opts.body.get('accessToken'),'MOCK_TOKEN_1234');
   jsonCalls++;
   return jsonCalls===1
     ?{ok:true,headers:{get:()=> 'text/html'},json:async()=>{throw Error('HTML');}}
     :{ok:true,json:async()=>exactPreview()};
 }});
assert.equal(jsonCalls,2,'one invalid JSON read-only preview may retry once');
assert.deepEqual(delays,[1500]);
assert.equal(verifyKbOfficialNavPreview(date,2100.55,afterHtml),true);
let transientCalls=0;
await readKbExactNavPreview({...readonlyOptions,retryDelay:async()=>{},
 fetchImpl:async()=>{
   transientCalls++;
   return transientCalls===1?{ok:false,status:503}
     :{ok:true,json:async()=>exactPreview()};
 }});
assert.equal(transientCalls,2,'a single 503 is retryable on a read-only preview');
let networkCalls=0;
await readKbExactNavPreview({...readonlyOptions,retryDelay:async()=>{},
 fetchImpl:async()=>{
   networkCalls++;
   if(networkCalls===1)throw Error('transient network');
   return {ok:true,json:async()=>exactPreview()};
 }});
assert.equal(networkCalls,2,'a single network failure can retry only the preview');
let deniedCalls=0;
await assert.rejects(()=>readKbExactNavPreview({...readonlyOptions,
 retryDelay:async()=>assert.fail('401/403 must not be retried'),
 fetchImpl:async()=>{
   deniedCalls++;
   return {ok:false,status:403};
 }}),/KB_POSTFLIGHT_PREVIEW_HTTP_UNVERIFIED/);
assert.equal(deniedCalls,1);
let malformedCalls=0;
const malformed=await readKbExactNavPreview({...readonlyOptions,
 retryDelay:async()=>assert.fail('valid JSON schema mismatch must not retry'),
 fetchImpl:async()=>{
   malformedCalls++;
   return {ok:true,json:async()=>exactPreview(2100.56)};
 }});
assert.equal(malformedCalls,1);
assert.equal(verifyKbOfficialNavPreview(date,2100.55,malformed),false,
 'source vs persisted amount mismatch must fail closed');
let persistentBadCalls=0;
await assert.rejects(()=>readKbExactNavPreview({...readonlyOptions,
 retryDelay:async()=>{},
 fetchImpl:async()=>{
   persistentBadCalls++;
   return {ok:true,json:async()=>{throw Error('HTML');}};
 }}),/KB_POSTFLIGHT_PREVIEW_JSON_UNVERIFIED/);
assert.equal(persistentBadCalls,2,'transient retry is strictly bounded to one');
const readonlyPreviewCode=fs.readFileSync(
 'scripts/audit-kb-nav-postflight-readonly.mjs','utf8').split(
 'export async function readKbExactNavPreview(')[1].split(
 'export async function auditKbNavPostflight(')[0];
assert.doesNotMatch(readonlyPreviewCode,/collectKbFundNav|collectHanwhaFundNav|mode:'import'|mode:'refresh'/,
 'postflight must never call a financial writer');
// Both funds get independent exact-date source and derived checks. Share
// only the immutable close read, never a source or another fund's proof.
const hanwhaSource={writerInvoked:false,code:'F00001',
 provider:'HANWHA_2045_CRPE',classCode:'C-RPe',
 sourceUsed:'HANWHA_PRIMARY',lookupCode:'008942',rows:source};
const hProof={status:'ok',fundResults:{F00001:{code:'F00001',
 dates:[{...verified,code:'F00001'}]}}};
const hPreview={...exactPreview(),code:'F00001'};
const hOptions={...mocks,completedDaysOnly:true,
 sourceReader:async()=>hanwhaSource,
 valuationReader:async({code,to})=>{
  assert.equal(code,'F00001');assert.equal(to,date);return hProof;
 },
 previewReader:async({code,sourceUsed,nav,date:asked})=>{
  assert.equal(code,'F00001');assert.equal(sourceUsed,'HANWHA_PRIMARY');
  assert.equal(asked,date);assert.equal(nav,2100.55);return hPreview;
 }};
const hResult=await auditHanwhaNavPostflight(hOptions);
assert.equal(hResult.kind,'HANWHA_NAV_CLOSE_POSTFLIGHT_READ_ONLY');
assert.equal(hResult.navWorkflowStatus,'NAV_DATA_VERIFIED');
assert.equal(hResult.navWorkflowPass,true);
assert.equal(hResult.financialWrites,0);
for(const change of [
 {previewReader:async()=>exactPreview()},
 {previewReader:async()=>({...exactPreview(2100.56),code:'F00001'})},
 {valuationReader:async()=>({status:'ok',fundResults:{F00001:{code:'F00001',dates:[]}}})},
 {valuationReader:async()=>({status:'ok',fundResults:{F00001:{code:'F00001',dates:[
   {...verified,code:'F00001',snapshotState:'WRITE_REQUIRED'}]}}})}
]){
 const result=await auditHanwhaNavPostflight({...hOptions,...change});
 assert.equal(result.navWorkflowPass,false);
}
for(const change of [{code:'F00002'},{classCode:'C-Pe'},
 {lookupCode:'008943'},{provider:'KB_VALUE_ST'},{sourceUsed:'UNKNOWN'}]){
 await assert.rejects(()=>auditHanwhaNavPostflight({...hOptions,
  sourceReader:async()=>({...hanwhaSource,...change}),
  valuationReader:async()=>assert.fail('unverified class must not reach GAS valuation')
 }),/HANWHA_POSTFLIGHT_SOURCE_UNVERIFIED/);
}
for(const sourceUsed of ['HANWHA_PRIMARY','FUNETF_CRPE_SECONDARY']){
 await readKbExactNavPreview({...readonlyOptions,code:'F00001',sourceUsed,
  fetchImpl:async(_url,opts)=>{
   const body=Object.fromEntries(opts.body);
   assert.equal(body.action,'previewFundNavImport');
   const input=JSON.parse(body.data);
   assert.equal(input.code,'F00001');
   assert.equal(input.provider,'HANWHA_2045_CRPE');
   assert.equal(input.classCode,'C-RPe');
   assert.equal(input.ackWarnings,false);
   assert.match(input.sourceText,sourceUsed==='HANWHA_PRIMARY'?/^008942 /:/^K55213C50702 /);
   assert.deepEqual(input.rows,[{date,nav:2100.55}]);
   return {ok:true,json:async()=>hPreview};
  }});
}
let sharedReads=0;const results=[];
const bothOptions={now:mocks.now,statusReader:async()=>{sharedReads++;return {close};},
 kbReader:args=>auditKbNavPostflight({...mocks,...args,
  valuationReader:async()=>proof}),
 hanwhaReader:args=>auditHanwhaNavPostflight({...hOptions,...args}),
 emit:(code,result)=>results.push([code,result.navWorkflowPass])};
assert.equal(await auditBothNavPostflight(bothOptions),true);
assert.deepEqual(results,[['F00002',true],['F00001',true]]);
assert.equal(sharedReads,1);
results.length=0;sharedReads=0;
assert.equal(await auditBothNavPostflight({...bothOptions,
 kbReader:async()=>{throw Error('SENSITIVE');}}),false);
assert.deepEqual(results,[['F00002',false],['F00001',true]]);
assert.equal(sharedReads,1);
// Real 2026-11-27 runner failures must retain actionable *sanitized*
// source categories. No raw error body, token, NAV or holder data is logged.
const failures=[];
assert.equal(await auditBothNavPostflight({...bothOptions,
 kbReader:async()=>{throw Error('NAV_SOURCE_HTTP_403');},
 hanwhaReader:async()=>{throw Error('HANWHA_FUNETF_HTTP_UNVERIFIED');},
 emit:(code,row)=>failures.push({code,kind:row.kind,pass:row.navWorkflowPass,reason:row.reason,writes:row.financialWrites})
}),false);
assert.deepEqual(failures,[
 {code:'F00002',kind:'FUND_NAV_POSTFLIGHT_UNVERIFIED',pass:false,reason:'NAV_SOURCE_HTTP_403',writes:0},
 {code:'F00001',kind:'FUND_NAV_POSTFLIGHT_UNVERIFIED',pass:false,reason:'HANWHA_FUNETF_HTTP_UNVERIFIED',writes:0}
]);
for(const [code,message,expected] of [
 ['F00002','NAV_SOURCE_HTTP_429','NAV_SOURCE_HTTP_429'],
 ['F00002','NAV_SOURCE_HTTP_403 PRIVATE_TOKEN','FUND_NAV_POSTFLIGHT_UNVERIFIED'],
 ['F00002','HANWHA_FUNETF_HTTP_UNVERIFIED','FUND_NAV_POSTFLIGHT_UNVERIFIED'],
 ['F00001','NAV_SOURCE_HTTP_403','FUND_NAV_POSTFLIGHT_UNVERIFIED'],
 ['F00001','SENSITIVE PRIVATE_FINANCE_DETAIL','FUND_NAV_POSTFLIGHT_UNVERIFIED'],
 ['F00001','HANWHA_SOURCE_NETWORK_UNVERIFIED','HANWHA_SOURCE_NETWORK_UNVERIFIED']
])assert.equal(safeNavPostflightFailureReason(code,new Error(message)),expected);
assert.equal(safeNavPostflightFailureReason('F00002',new Error('KB_POSTFLIGHT_GAS_NETWORK_UNVERIFIED')),'KB_POSTFLIGHT_GAS_NETWORK_UNVERIFIED');
assert.ok(!JSON.stringify(failures).includes('PRIVATE_TOKEN'));
console.log('BOTH_NAV_POSTFLIGHT_SAFE_SOURCE_REASONS_PASS no data writes, source errors preserved, untrusted details redacted');
console.log('BOTH_NAV_POSTFLIGHT_EXACT_PASS same close read, exact fund/date/value proof, independent errors, no finance writer');
console.log('KB NAV postflight: published-vs-persisted, close marker, transient read-only preview and workflow PASS');

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
// Execute the real admission CLI with no GAS credentials. A retired cron
// must fail and export false; manual collection exports true. Downstream
// reconciliation uses either admitted job, not its final success/failure.
// Same-run continuation requires an actual earlier on-time start in the
// SAME slot/day. The recovery-period deadline and elapsed time are bounded.
const continuationCases=[
 ['30 0 * * 1-5','2026-11-16T00:59:00Z','2026-11-16T01:15:00Z',true],
 ['30 0 * * 1-5','2026-11-16T01:09:00Z','2026-11-16T02:59:00Z',true],
 ['30 0 * * 1-5','2026-11-16T01:09:59Z','2026-11-16T03:10:00Z',false],
 ['30 0 * * 1-5','2026-11-16T00:30:00Z','2026-11-16T02:30:00Z',true],
 ['30 0 * * 1-5','2026-11-16T00:30:00Z','2026-11-16T02:30:01Z',false],
 ['30 0 * * 1-5','2026-11-16T01:10:00Z','2026-11-16T01:15:00Z',false],
 ['30 0 * * 1-5','2026-11-15T00:59:00Z','2026-11-16T01:15:00Z',false],
 ['30 0 * * 1-5','2026-11-14T00:59:00Z','2026-11-14T01:15:00Z',false],
 ['30 0 * * 1-5','2026-11-16T01:09:00Z','2026-11-16T00:20:00Z',false],
 ['10 9 * * 1-5','2026-11-16T09:45:00Z','2026-11-16T10:20:00Z',true],
 ['10 9 * * 1-5','2026-11-16T10:16:00Z','2026-11-16T12:10:00Z',true],
 ['10 9 * * 1-5','2026-11-16T10:16:00Z','2026-11-16T12:11:00Z',false],
 ['17 10 * * 1-5','2026-11-16T10:59:00Z','2026-11-16T11:35:00Z',true],
 ['17 10 * * 1-5','2026-11-16T11:19:00Z','2026-11-16T12:10:00Z',true],
 ['17 10 * * 1-5','2026-11-16T11:19:00Z','2026-11-16T12:11:00Z',false]
];
for(const [cron,prior,instant,expected] of continuationCases){
 const o=assessNavScheduledAdmission({eventName:'schedule',cron,
  priorAdmittedAt:new Date(prior).toISOString(),now:new Date(instant)});
 assert.equal(o.admit,expected,cron+' '+prior+' -> '+instant);
 if(expected)assert.equal(o.status,'ADMITTED_SAME_RUN_CONTINUATION');
}
for(const priorAdmittedAt of ['',undefined,'invalid','2026-11-16T00:59:00Z']){
 assert.equal(assessNavScheduledAdmission({eventName:'schedule',
  cron:'30 0 * * 1-5',priorAdmittedAt,now:new Date('2026-11-16T01:15:00Z')}).admit,false);
}
const kbAdmission=workflow.jobs.collect.steps.find(x=>x.id==='nav_admission');
const hAdmission=workflow.jobs['hanwha-collect'].steps.find(x=>x.id==='nav_admission');
assert.equal(kbAdmission.env.NAV_PRIOR_ADMITTED_AT,undefined,
 'initial KB may never receive continuation evidence');
assert.equal(workflow.jobs.collect.outputs.admitted_at,'$'+'{{ steps.nav_admission.outputs.admitted_at }}');
assert.equal(hAdmission.env.NAV_PRIOR_ADMITTED_AT,'$'+'{{ needs.collect.outputs.admitted_at }}');
const admissionTmp=fs.mkdtempSync(join(tmpdir(),'nav-admission-'));
try{
 for(const [event,cron,expected,exit] of [
  ['schedule','10 0 * * 0,6',false,1],
  ['schedule','invalid',false,1],
  ['workflow_dispatch','',true,0]
 ]){
  const output=join(admissionTmp,'out');
  fs.writeFileSync(output,'');
  const r=spawnSync(process.execPath,['scripts/nav-schedule-admission.mjs'],{
   encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:event,
   NAV_SCHEDULE_CRON:cron,NAV_PRIOR_ADMITTED_AT:'',GITHUB_OUTPUT:output,GITHUB_STEP_SUMMARY:''}
  });
  assert.equal(r.status,exit,r.stderr);
  const proof=fs.readFileSync(output,'utf8').trimEnd().split('\n');
  assert.equal(proof[0],'admitted='+expected);
  if(expected)assert.match(proof[1],/^admitted_at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  else assert.equal(proof[1],'admitted_at=');
  assert.match(r.stdout,/"gasCalls":0,"financialWrites":0/);
 }
}finally{fs.rmSync(admissionTmp,{recursive:true,force:true});}
console.log('NAV_SCHEDULE_DELAYED_ADMISSION_PASS '+JSON.stringify({
 simulatedSaturday0910Started1505:true,slots:navSlots.length,
 staleScheduleCannotReachGas:true,postflightRequiresAdmittedCollector:true,sameRunContinuationCases:continuationCases.length,financialWrites:0
}));

 // Real adapter and GAS preview contract with a mock transport. No network.
const {selectCrosscheckedCandidate}=await import('./nav-crosschecked-candidate.mjs');
const {previewCrosscheckedNav}=await import('./preview-crosschecked-nav-readonly.mjs');
const candidateToday='2026-11-27',candidateDates=['2026-11-20','2026-11-23','2026-11-24','2026-11-25','2026-11-26'];
const exampleArchive={kind:'PUBLIC_NAV_CANDIDATE_ARCHIVE',asOfKst:candidateToday,importAuthorized:false,
 financialWrites:0,gasCalls:0,requestedDates:candidateDates,
 funds:[['F00002','KR5223AQ0185'],['F00001','K55213C50702']].map(([fund,standardCode])=>({
  fund,standardCode,source:'https://dis.kofia.or.kr/proframeWeb/XMLSERVICES/',anchorState:'MATCH',secondaryState:'RETRIEVED',
  rows:candidateDates.map((date,i)=>({date,nav:String(1000+i)})),
  crosscheck:{state:'CROSSCHECK_MATCHED',conflictDates:[],matchedDates:candidateDates.slice(0,4)}
 }))};
assert.equal(selectCrosscheckedCandidate(exampleArchive,'F00002',candidateToday).rows.length,4);
const missingPrimary=structuredClone(exampleArchive);missingPrimary.funds[0].rows.pop();
assert.deepEqual(selectCrosscheckedCandidate(missingPrimary,'F00002',candidateToday).unverifiedDates,['2026-11-26']);
const staleRange=structuredClone(exampleArchive);staleRange.requestedDates=['2026-11-19',...candidateDates.slice(0,4)];
assert.throws(()=>selectCrosscheckedCandidate(staleRange,'F00002',candidateToday),/NAV_CANDIDATE_RANGE_UNVERIFIED/);
assert.deepEqual(selectCrosscheckedCandidate(exampleArchive,'F00001',candidateToday).unverifiedDates,['2026-11-26']);
assert.throws(()=>selectCrosscheckedCandidate({...exampleArchive,asOfKst:'2026-11-26'},'F00002',candidateToday),/NAV_CANDIDATE_ARCHIVE_UNVERIFIED/);
for(const mutate of [a=>a.funds[0].standardCode='WRONG',a=>a.funds[0].crosscheck.conflictDates=['2026-11-23'],
 a=>a.funds[0].rows.push(a.funds[0].rows[0]),a=>a.funds[0].crosscheck.matchedDates=['2026-11-20']]){
 const invalid=structuredClone(exampleArchive);mutate(invalid);
 assert.throws(()=>selectCrosscheckedCandidate(invalid,'F00002',candidateToday),/NAV_CANDIDATE_/);
}
const candidateMock=({noOverlap=false,conflict=false}={})=>async(dest,opts)=>{
 const action=opts.body.get('action');
 assert.equal(new URL(dest).origin,'https://script.google.com');
 assert.ok(['getAutomationStatus','previewFundNavImport'].includes(action));
 if(action==='getAutomationStatus')return {ok:true,json:async()=>opts.body.get('accessToken')==='test-candidate-token'
  ?{status:'ok',gasVersion:'9.305',automation:{closeRun:{runDate:'2026-11-26'}}}
  :{status:'error',message:'인증 실패'}};
 const input=JSON.parse(opts.body.get('data'));
 assert.equal(input.appendOnly,true);assert.equal(input.ackWarnings,false);
 assert.equal(input.rows.length,4);assert(!input.rows.some(r=>r.date==='2026-11-26'));
 const identical=noOverlap?[]:[{date:input.rows[0].date,existingNav:input.rows[0].nav,uploadedNav:input.rows[0].nav}];
 return {ok:true,json:async()=>({status:'ok',code:input.code,
  candidates:input.rows.slice(noOverlap?0:1),identical,
  updates:conflict?[{}]:[],warnings:[],errors:[],duplicates:[],zeroUnits:[]})};
};
const candidateOptions={archive:exampleArchive,url:'https://script.google.com/macros/s/TEST_CANDIDATE/exec',token:'test-candidate-token',now:new Date('2026-11-27T01:00:00+09:00')};
const candidateResult=await previewCrosscheckedNav({...candidateOptions,fetchImpl:candidateMock()});
assert.equal(candidateResult.financialWrites,0);assert.equal(candidateResult.importAuthorized,false);
assert.equal(candidateResult.results.length,2);
assert.ok(candidateResult.results.every(r=>r.latestRequestedDateCrosschecked===false&&r.allRequestedDatesCrosschecked===false&&r.allCloseEligibleDatesPreviewed===false));
assert.deepEqual(candidateResult.results[0].identicalDates,['2026-11-20']);
assert.deepEqual(candidateResult.results[0].candidateDates,['2026-11-23','2026-11-24','2026-11-25']);
const completeArchive=structuredClone(exampleArchive);for(const f of completeArchive.funds)f.crosscheck.matchedDates=[...candidateDates];
const completeResult=await previewCrosscheckedNav({...candidateOptions,archive:completeArchive,fetchImpl:async(dest,opts)=>{
 if(opts.body.get('action')==='getAutomationStatus')return candidateMock()(dest,opts);
 assert.equal(opts.body.get('action'),'previewFundNavImport');
 const input=JSON.parse(opts.body.get('data'));assert.equal(input.rows.length,5);
 return {ok:true,json:async()=>({status:'ok',code:input.code,identical:[{date:input.rows[0].date,existingNav:input.rows[0].nav,uploadedNav:input.rows[0].nav}],candidates:input.rows.slice(1),updates:[],warnings:[],errors:[],duplicates:[],zeroUnits:[]})};
}});
assert.ok(completeResult.results.every(r=>r.latestRequestedDateCrosschecked===true&&r.allRequestedDatesCrosschecked===true&&r.allCloseEligibleDatesPreviewed===true));
assert.equal(completeResult.financialWrites,0);assert.equal(completeResult.importAuthorized,false);
await assert.rejects(()=>previewCrosscheckedNav({...candidateOptions,fetchImpl:candidateMock({noOverlap:true})}),/NAV_CANDIDATE_PERSISTED_OVERLAP_UNVERIFIED/);
await assert.rejects(()=>previewCrosscheckedNav({...candidateOptions,fetchImpl:candidateMock({conflict:true})}),/NAV_CANDIDATE_PREVIEW_BLOCKED/);
console.log('NAV crosschecked candidate exact-class and read-only GAS preview PASS');
