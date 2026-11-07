import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {readonlyTransport,runReadOnly9282,safeIssue860ReleaseAudit} from './issue860-readonly-9282-dryrun.mjs';
import {assertFirstWriterGateCutoverSafe} from './deploy-gas.mjs';

const scriptId='TEST_SCRIPT_IDENTIFIER_12345',deploymentId='TEST_DEPLOYMENT_12345';
const root='https://script.googleapis.com/v1/projects/'+scriptId;
const legacy=fs.readFileSync('reference/gas-v9.281.gs','utf8');
const candidate=fs.readFileSync('src/gas/apps_script.gs','utf8');
assert.throws(()=>assertFirstWriterGateCutoverSafe(legacy,candidate),/GAS_FIRST_GATE_CUTOVER_UNVERIFIED/);
let forwarded=0;
const guard=readonlyTransport(scriptId,async(u,o)=>{forwarded++;assert.equal(o.redirect,'error');});
for(const [url,method] of [[root+'/content','PUT'],[root+'/versions','POST'],
  [root+'/deployments/'+deploymentId,'DELETE'],[root+':run','POST'],
  ['https://script.google.com/macros/s/'+deploymentId+'/exec','GET'],
  ['https://sheets.googleapis.com/v4/spreadsheets/test','GET'],
  ['https://api.telegram.org/botPRIVATE/sendMessage','POST'],
  [root.replace(scriptId,'OTHER_PROJECT_123')+'/content','GET'],
  ['https://oauth2.googleapis.com/token/extra','POST']]) {
  await assert.rejects(guard(url,{method}),/ISSUE860_NETWORK_OPERATION_BLOCKED/);
}
assert.equal(forwarded,0,'forbidden calls must fail before transport');
await guard(root+'/content',{method:'GET',redirect:'follow'});
assert.equal(forwarded,1);

const saved={...process.env},originalFetch=globalThis.fetch,originalLog=console.log;
Object.assign(process.env,{GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',
  GITHUB_REPOSITORY:'cyyoung111-dev/portfolio',GITHUB_SHA:'a'.repeat(40),
  GAS_SCRIPT_ID:scriptId,GAS_DEPLOYMENT_ID:deploymentId,GAS_SERVER_FILE_NAME:'Code',
  GAS_WEB_APP_URL:'https://script.google.com/macros/s/'+deploymentId+'/exec',
  GAS_DEPLOY_DRY_RUN:'true',GAS_9282_RELEASE_APPROVAL:'false',GAS_9283_RELEASE_APPROVAL:'false',
  GAS_9284_RELEASE_APPROVAL:'false',GAS_9285_RELEASE_APPROVAL:'false',
  GAS_ISSUE860_ONE_SHOT_DRYRUN:'false',
  CLASPRC_JSON:JSON.stringify({client_id:'FAKE_CLIENT',client_secret:'FAKE_SECRET',refresh_token:'FAKE_REFRESH'})});
const calls=[],logs=[];
let extra=true,stale=false,oauthFailure=false,reviewed=false,headMatches=false;
const item=(id,version=336)=>({deploymentId:id,deploymentConfig:version?{versionNumber:version}:{description:'GitHub 878709c0731d · GAS v9.280'},
  entryPoints:[{entryPointType:'WEB_APP',webApp:{entryPointConfig:{access:'MYSELF',executeAs:'USER_DEPLOYING'}}}]});
const mock=async(url,options)=>{
  calls.push({url,method:options.method||'GET'});
  const u=new URL(url);
  let value;
  if(u.hostname==='api.github.com')value={object:{sha:(stale?'b':'a').repeat(40)}};
  else if(u.hostname==='oauth2.googleapis.com'){
    if(oauthFailure)throw Error('PRIVATE_PROVIDER_ERROR');
    value={access_token:'PRIVATE_TEST_ACCESS_TOKEN_123456'};
  } else if(u.pathname.endsWith('/content'))value={scriptId,files:[
    {name:'appsscript',type:'JSON',source:'{}'},
    {name:'Code',type:'SERVER_JS',source:headMatches||(reviewed&&u.searchParams.has('versionNumber'))?candidate:legacy}]};
  else if(u.pathname.endsWith('/deployments'))value={deployments:extra?[item(deploymentId),item('ARCHIVED_UNKNOWN_123',0)]:[item(deploymentId)]};
  else if(u.pathname.endsWith('/'+deploymentId))value=item(deploymentId);
  else if(u.pathname.endsWith('/ARCHIVED_UNKNOWN_123'))value=item('ARCHIVED_UNKNOWN_123',0);
  else throw Error('UNEXPECTED_TEST_CALL');
  return {ok:true,status:200,text:async()=>JSON.stringify(value),json:async()=>value};
};
try {
  console.log=(...args)=>logs.push(args.join(' '));
  let result=await runReadOnly9282({fetchImpl:mock});
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.inventory.archivedV335DescriptionHintCount,1);
  assert.equal(result.inventory.archivedV335IdentityVerified,false);
  assert.equal(result.dryRun.dryRun,true,'blocked inventory must not suppress dry-run');
  assert.equal(result.dryRun.version,'9.285');
  assert.equal(result.releaseAuthorized,false);
  const safe=safeIssue860ReleaseAudit({...result,
    inventory:{...result.inventory,privateToken:'SECRET_INVENTORY',
      deploymentId:'PRIVATE_DEPLOYMENT',reason:result.inventory.reason}});
  assert.equal(safe.inventoryReason,result.inventory.reason);
  assert.equal(safe.deploymentCount,result.inventory.deploymentCount);
  assert.equal(safe.additionalRoutableDeploymentCount,result.inventory.additionalRoutableDeploymentCount);
  assert.equal(safe.sourceVersion,'9.285');
  assert.equal(safe.dryRun,true);
  assert.equal(safe.releaseAuthorized,false);
  assert.ok(!JSON.stringify(safe).includes('PRIVATE_DEPLOYMENT'));
  assert.ok(!JSON.stringify(safe).includes('SECRET_INVENTORY'));
  assert.equal(safeIssue860ReleaseAudit({inventory:{reason:'PRIVATE_RAW_ERROR'}}).inventoryReason,'UNVERIFIED');
  assert.deepEqual([result.gasWrites,result.financeWrites,result.telegramSends],[0,0,0]);
  assert.ok(calls.every(c=>c.method==='GET'||c.url==='https://oauth2.googleapis.com/token'));
  assert.doesNotMatch(JSON.stringify(result)+logs.join(' '),/PRIVATE_TEST_ACCESS_TOKEN|FAKE_SECRET|FAKE_REFRESH|ARCHIVED_UNKNOWN_123/);
  extra=false;
  assert.equal((await runReadOnly9282({fetchImpl:mock})).status,'BLOCKED','legacy source alone remains blocked');
  reviewed=true;
  result=await runReadOnly9282({fetchImpl:mock});
  assert.equal(result.status,'BLOCKED','9.283 cannot be mistaken for the reviewed live 9.282 source');
  assert.ok(result.inventory.sourceUnreviewedCount>=1,'published inventory must reject the unreviewed 9.283 source');
  assert.equal(result.releaseAuthorized,false);
  // Repeated dispatch executes reads again, with no persistent writes.
  assert.equal((await runReadOnly9282({fetchImpl:mock})).dryRun.deployed,false);
  headMatches=true;
  const realTimeout=globalThis.setTimeout;
  try {
    globalThis.setTimeout=fn=>{queueMicrotask(fn);return 0;};
    result=await runReadOnly9282({fetchImpl:mock});
  } finally { globalThis.setTimeout=realTimeout; }
  assert.equal(result.status,'BLOCKED','synthetic published 9.283 is not the verified live writer-gate v9.282');
  assert.equal(result.dryRun.dryRun,true);
  headMatches=false;
  stale=true;
  let before=calls.length;
  await assert.rejects(runReadOnly9282({fetchImpl:mock}),/GAS_RELEASE_STALE_COMMIT/);
  assert.equal(calls.length,before+1,'stale run stops before OAuth or GAS');
  stale=false;oauthFailure=true;
  result=await runReadOnly9282({fetchImpl:mock});
  assert.equal(result.status,'UNVERIFIED');
  assert.deepEqual(result.failures,['INVENTORY_UNVERIFIED','DRY_RUN_UNVERIFIED']);
  oauthFailure=false;
  // Protected one-shot is allowed only on the current main SHA and can
  // perform the same GET-only diagnostic as workflow_dispatch.
  process.env.GITHUB_EVENT_NAME='push';
  process.env.GAS_ISSUE860_ONE_SHOT_DRYRUN='true';
  const beforePush=calls.length;
  result=await runReadOnly9282({fetchImpl:mock});
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.sourceVersion,'9.285');
  assert.equal(result.dryRun.dryRun,true);
  assert.ok(calls.slice(beforePush).every(c=>c.method==='GET'
    ||c.url==='https://oauth2.googleapis.com/token'));
  process.env.GAS_ISSUE860_ONE_SHOT_DRYRUN='false';
  before=calls.length;
  await assert.rejects(runReadOnly9282({fetchImpl:mock}),/ISSUE860_MODE_INVALID/);
  assert.equal(calls.length,before,'unflagged push must stop before network');
  process.env.GITHUB_EVENT_NAME='workflow_dispatch';
  for(const [key,bad] of [['GAS_DEPLOY_DRY_RUN','false'],['GAS_9282_RELEASE_APPROVAL','true'],
    ['GAS_9283_RELEASE_APPROVAL','true'],['GAS_9284_RELEASE_APPROVAL','true'],
    ['GAS_9285_RELEASE_APPROVAL','true'],['GITHUB_REF','refs/heads/feature'],
    ['GITHUB_EVENT_NAME','push']]) {
    const previous=process.env[key];process.env[key]=bad;before=calls.length;
    await assert.rejects(runReadOnly9282({fetchImpl:mock}));
    assert.equal(calls.length,before,'invalid mode fails before network');
    process.env[key]=previous;
  }
  assert.equal(globalThis.fetch,originalFetch,'guard restored after success/failure');
} finally {
  console.log=originalLog;globalThis.fetch=originalFetch;
  for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];
  Object.assign(process.env,saved);
}

const workflow=YAML.parse(fs.readFileSync('.github/workflows/issue860-readonly-9282-dryrun.yml','utf8'));
assert.deepEqual(Object.keys(workflow.on),['workflow_dispatch','push']);
assert.deepEqual(workflow.on.push,{branches:['main'],paths:[
 '.github/workflows/issue860-readonly-9282-dryrun.yml',
 'scripts/issue860-first-cutover.mjs'
]});
assert.deepEqual(workflow.permissions,{contents:'read'});
assert.deepEqual(Object.keys(workflow.jobs),['audit-dryrun']);
const job=workflow.jobs['audit-dryrun'];
assert.match(job.if,/github.ref == 'refs\/heads\/main'/);
assert.match(job.if,/github.event_name == 'workflow_dispatch'/);
assert.equal(job.environment,'portfolio-production-gas');
assert.deepEqual(job.concurrency,{group:'gas-production-deploy','cancel-in-progress':false});
const live=job.steps.find(x=>x.name==='Re-audit and dry-run only (no runtime endpoint calls)');
assert.ok(live);
assert.equal(live.if,"github.event_name == 'workflow_dispatch' || github.event_name == 'push'");
assert.equal(live.env.GAS_ISSUE860_ONE_SHOT_DRYRUN,"${{ github.event_name == 'push' && 'true' || 'false' }}");
assert.equal(live.env.GAS_9284_RELEASE_APPROVAL,'false');
assert.equal(live.env.GAS_9285_RELEASE_APPROVAL,'false');
assert.equal(live.run,'node scripts/issue860-readonly-9282-dryrun.mjs');
assert.equal(live.env.GAS_DEPLOY_DRY_RUN,'true');
assert.equal(live.env.GAS_9282_RELEASE_APPROVAL,'false');
assert.equal(live.env.GAS_9283_RELEASE_APPROVAL,'false');
assert.ok(!('GAS_ACCESS_TOKEN' in live.env));
// The legacy 9.282 initial writer cutover is deliberately excluded from
// the promoted 9.285 audit: it only recognizes 9.281/9.282 source hashes.
assert.ok(!job.steps.some(x=>x.run==='node scripts/issue860-first-cutover.mjs'));
assert.ok(!job.steps.some(x=>x.env?.GAS_FIRST_GATE_PHASE));
assert.equal(live.env.GAS_ISSUE860_ONE_SHOT_DRYRUN,
  "${{ github.event_name == 'push' && 'true' || 'false' }}");
assert.ok(job.if.includes("github.ref == 'refs/heads/main'"));
assert.ok(job.if.includes("github.event_name == 'push'"));
assert.doesNotMatch(JSON.stringify(workflow),/TELEGRAM|NHPLUG|continue-on-error/);
console.log('Issue860 actual inventory + deploy dry-run, network deny, stale/approval/error/repeat contracts: PASS');
