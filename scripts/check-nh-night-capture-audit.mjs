import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {auditNhNightSchedule} from './nh-night-capture-audit.mjs';

const date='2026-11-02',when=()=>new Date(date+'T08:14:00+09:00');
const repo='cyyoung111-dev/portfolio';
const run={id:41300000001,name:'NH night reference capture',
 path:'.github/workflows/nh-night-capture.yml',event:'schedule',
 head_branch:'main',head_repository:{full_name:repo},run_attempt:1,
 created_at:'2026-11-01T21:45:00Z',status:'completed',conclusion:'success'};
const artifact={id:13100000001,name:'nh-night-reference-'+date,expired:false,
 workflow_run:{id:run.id}};
function mock({runs=[run],artifacts=[artifact],fail=false,badSchema=false}={}){
 const paths=[];
 const fetchImpl=async(url,opts)=>{
   const u=new URL(url);paths.push(u.pathname);
   assert.equal(u.host,'api.github.com');
   assert.match(opts.headers.authorization,/^Bearer GH_READ_TOKEN$/);
   assert.equal(opts.redirect,'error');
   if(fail)return {ok:false};
   if(u.pathname.endsWith('/runs')){
     assert.equal(u.searchParams.get('event'),'schedule');
     assert.equal(u.searchParams.get('branch'),'main');
     assert.match(u.searchParams.get('created'),/2026-11-01T21:45:00.000Z[.][.]2026-11-01T22:34:59.999Z/);
     return {ok:true,json:async()=>badSchema?{total_count:'1',workflow_runs:runs}:
       {total_count:runs.length,workflow_runs:runs}};
   }
   if(u.pathname.endsWith('/artifacts')){
     assert.equal(u.searchParams.get('name'),'nh-night-reference-'+date);
     return {ok:true,json:async()=>({total_count:artifacts.length,artifacts})};
   }
   assert.fail('unexpected GH REST endpoint');
 };
 return {fetchImpl,paths};
}
async function audit(input){
 const f=mock(input);
 const result=await auditNhNightSchedule({now:when,repository:repo,token:'GH_READ_TOKEN',fetchImpl:f.fetchImpl});
 assert.equal(f.paths.length,2,'one read for runs and one for artifacts, zero NH API calls');
 return result;
}
assert.deepEqual(await audit(),{date,status:'CAPTURE_CONFIRMED',ok:true,runs:1,artifacts:1});
assert.equal((await audit({runs:[],artifacts:[]})).status,'SCHEDULE_NOT_TRIGGERED');
assert.equal((await audit({runs:[{...run,conclusion:'failure'}],artifacts:[]})).status,'CAPTURE_RUN_FAILED');
assert.equal((await audit({runs:[{...run,status:'in_progress',conclusion:null}],artifacts:[]})).status,'CAPTURE_RUN_INCOMPLETE');
assert.equal((await audit({artifacts:[]})).status,'CAPTURE_RUN_NO_REFERENCE');
assert.equal((await audit({artifacts:[{...artifact,workflow_run:{id:999}}]})).status,'ARTIFACT_PROVENANCE_UNVERIFIED');
assert.equal((await audit({runs:[{...run,event:'workflow_dispatch'}],artifacts:[]})).status,'SCHEDULE_NOT_TRIGGERED');
assert.equal((await audit({runs:[{...run,created_at:'2026-11-01T23:05:00Z'}],artifacts:[]})).status,'SCHEDULE_NOT_TRIGGERED');
await assert.rejects(audit({fail:true}),/NH_AUDIT_API_UNAVAILABLE/);
await assert.rejects(audit({badSchema:true}),/NH_AUDIT_API_SCHEMA/);
await assert.rejects(auditNhNightSchedule({now:()=>new Date(date+'T07:37:59+09:00'),
 repository:repo,token:'GH_READ_TOKEN',fetchImpl:async()=>assert.fail('too early')}),/NH_AUDIT_TOO_EARLY/);
assert.deepEqual(await auditNhNightSchedule({
 now:()=>new Date('2026-11-01T08:14:00+09:00'),
 repository:repo,token:'GH_READ_TOKEN',fetchImpl:async()=>assert.fail('closed day')
}),{date:'2026-11-01',status:'MARKET_CLOSED',ok:true,runs:0,artifacts:0});
const workflow=YAML.parse(fs.readFileSync('.github/workflows/nh-night-capture-health.yml','utf8'));
assert.equal(workflow.jobs.audit['if'],
 "github.repository == 'cyyoung111-dev/portfolio' && github.ref == 'refs/heads/main' && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')");
assert.deepEqual(workflow.on.schedule.map(x=>x.cron),['38 22 * * 0-4']);
assert.equal(workflow.permissions.actions,'read');
assert.equal(workflow.permissions.contents,'read');
assert.equal(workflow.jobs.audit.environment,undefined,'no privileged GAS environment');
assert.equal(workflow.jobs.audit.steps.at(-1).env.GH_TOKEN,'$'+'{{ github.token }}');
assert.equal(workflow.jobs.audit.steps.at(-1).env.GAS_ACCESS_TOKEN,undefined);
const source=fs.readFileSync('scripts/nh-night-capture-audit.mjs','utf8');
assert.doesNotMatch(source,/api[.]nh|GAS_WEB_APP_URL|NHPLUG_APP_KEY|TELEGRAM_BOT_TOKEN|sendMessage|fetchNhNightFromGas/);
console.log('NH capture health: scheduled run, missing/late, failure, artifact provenance, no NH secret PASS');
