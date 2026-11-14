#!/usr/bin/env node
// Issue #507: check the ACTUAL workflow YAML, never run authenticated GAS.
// Prevent feature-branch dispatch and push from reaching credentialed jobs.
// This is an offline CI contract; it must not access credentials or Sheets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const exact = "github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch'";
const workflows = [
  'krx-feb23-readonly.yml',
  'issue-507-source-only-preflight-readonly.yml',
  'issue-507-price-history-row-audit-readonly.yml',
  'issue-507-target-krx-confirmation-readonly.yml',
  'issue-507-three-day-code-lineage-readonly.yml',
  'issue-507-june5-readonly.yml',
  'issue-507-supervised-repair-dryrun-readonly.yml',
  'issue-507-deferred-source-audit-readonly.yml',
  'issue-507-backup-registry-readonly.yml',
  'issue-507-complete-backup-candidates-readonly.yml',
  'issue-507-23day-expected-signature-readonly.yml',
];

function validate(name, source) {
  const doc = YAML.parseDocument(source, { uniqueKeys: true, version: '1.2' });
  assert.equal(doc.errors.length, 0, name + ': YAML must parse without duplicate keys');
  const workflow = doc.toJS({ maxAliasCount: 0 });
  assert.ok(workflow && workflow.on
    && Object.hasOwn(workflow.on, 'workflow_dispatch'),
    name + ': manual dispatch must be explicit');
  assert.equal(workflow.permissions?.contents, 'read', name + ': read-only repository rights');

  let credentialed = 0;
  for (const [jobName, job] of Object.entries(workflow.jobs || {})) {
    for (const step of job.steps || []) {
      const env = { ...(job.env || {}), ...(step.env || {}) };
      if (!String(env.GAS_ACCESS_TOKEN || '').includes('secrets.GAS_ACCESS_TOKEN'))
        continue;
      credentialed++;
      // A job or an individual credentialed step may be gated; either
      // must EXACTLY exclude both untrusted branches and automatic events.
      const branchGate = step.if === undefined ? job.if : step.if;
      assert.equal(branchGate, exact,
        name + '/' + jobName + ': credentialed step must be manual main-only');
      assert.equal(env.GAS_WEB_APP_URL,
        '$' + '{{ vars.GAS_WEB_APP_URL }}',
        name + '/' + jobName + ': use the configured GAS endpoint');
      assert.equal(env.GAS_ACCESS_TOKEN,
        '$' + '{{ secrets.GAS_ACCESS_TOKEN }}',
        name + '/' + jobName + ': secret must come from GitHub secret');
    }
  }
  assert.equal(credentialed, 1,
    name + ': expected one audited GAS credentialed execution step');
  return true;
}

for (const name of workflows) {
  const path = new URL('../.github/workflows/' + name, import.meta.url);
  const source = fs.readFileSync(path, 'utf8');
  validate(name, source);
  const weaker = source.replace(exact, "github.event_name == 'workflow_dispatch'");
  assert.notEqual(weaker, source, name + ': test mutation did not alter the YAML');
  assert.throws(() => validate(name, weaker), /manual main-only/,
    name + ': weakening the main guard must FAIL CLOSED');
  const automatic = source.replace(exact, "github.ref == 'refs/heads/main'");
  assert.throws(() => validate(name, automatic), /manual main-only/,
    name + ': push-only bypass must FAIL CLOSED');
}
console.log('Issue #507 credentialed GAS workflow gates: PASS (' + workflows.length + ' workflows)');

// A workflow-level if guard is NOT sufficient against older or modified
// feature branches. The GitHub *settings*-enforced protected environment
// must be selected on every job that can read the operational GAS secret.
// This is a source-code preflight only: it cannot certify that the GitHub
// environment branch policy and environment secret were installed.
const productionEnvironment='portfolio-production-gas';
// Both credentials can access production GAS, including Apps Script deployment.
const protectedSecrets=['secrets.GAS_ACCESS_TOKEN','secrets.CLASPRC_JSON'];
const dir=new URL('../.github/workflows/',import.meta.url);
const workflowFiles=fs.readdirSync(dir).filter(file=>/\.ya?ml$/.test(file)).sort();
function auditEnvironmentGuard(name,source){
  const document=YAML.parseDocument(source,{version:'1.2',uniqueKeys:true});
  assert.equal(document.errors.length,0,name+': workflow YAML must parse');
  const config=document.toJS({maxAliasCount:0});
  const credentialedJobs=[];
  for(const [jobName,job] of Object.entries(config.jobs||{})){
    if(!protectedSecrets.some(secret=>JSON.stringify(job).includes(secret)))continue;
    credentialedJobs.push(jobName);
    assert.equal(job.environment,productionEnvironment,
      name+'/'+jobName+': secret-consuming job must use selected-branches protected Environment');
  }
  return credentialedJobs;
}
const protectedWorkflowNames=[];
let protectedJobs=0;
for(const name of workflowFiles){
  const yaml=fs.readFileSync(new URL(name,dir),'utf8');
  const jobs=auditEnvironmentGuard(name,yaml);
  if(jobs.length){protectedWorkflowNames.push(name);protectedJobs+=jobs.length;}
}
assert.ok(protectedWorkflowNames.length>=50, 'current production protected jobs must remain covered');
assert.ok(protectedJobs>=50, 'current credentialed job protections must remain covered');
assert.ok(protectedWorkflowNames.includes('issue734-postmigration-live-readonly.yml'),
  'new postmigration v2/holdings read-only audit must use protected GAS Environment');
assert.ok(protectedWorkflowNames.includes('issue860-postmigration-readiness-readonly.yml'),
  'postmigration readonly editor-cleanup audit must be Environment-protected');
assert.ok(fs.readFileSync(new URL('kb-fund-nav-collect.yml',dir),'utf8').includes('hanwha-collect:'),
  'Hanwha F00001 collector must be present and environment-gated');
// Historical Nov 10 process audit workflow retired. A current protected
// OAuth scope audit remains, and the reusable script.processes job is manual.
assert.ok(!protectedWorkflowNames.includes('issue860-close-processes-readonly.yml'),
  'obsolete dated Nov 10 GAS process workflow must not remain registered');
assert.ok(protectedWorkflowNames.includes('issue734-process-scope-audit-readonly.yml'),
  'current manual process scope diagnosis remains Environment-protected');
assert.ok(protectedWorkflowNames.includes('issue860-hanwha-secondary-nav-crosscheck.yml'),
  'new Hanwha private NAV read-only crosscheck must retain protected production Environment');
assert.ok(protectedWorkflowNames.includes('issue860-once-close-status-readonly.yml'),
  'one-shot close status must use protected GAS Environment');
assert.ok(protectedWorkflowNames.includes('issue734-process-scope-audit-readonly.yml'),
  'process scope audit must require protected GAS Environment');
assert.ok(protectedWorkflowNames.includes('issue734-writer-terminal-evidence-readonly.yml'),
  'writer process evidence must require protected Environment');
assert.ok(protectedWorkflowNames.includes('issue860-recent-snapshot-backup-readonly.yml'),
  'one-time recent backup owner inventory must use protected GAS Environment');
assert.ok(protectedWorkflowNames.includes('nh-master-registered-readonly.yml'),
  'new domestic registered NH sample workflow must require protected production Environment');
assert.ok(protectedWorkflowNames.includes('issue860-readonly-9282-dryrun.yml'),
  'integrated v9.282 read-only dry-run must retain protected production Environment');
assert.ok(protectedWorkflowNames.includes('probe-standalone-performance-gas-20261103.yml'),
  'isolated GAS live probe must require protected Environment');
const weeklyTelemetry=YAML.parse(fs.readFileSync(new URL(
  'probe-standalone-performance-gas-20261103.yml',dir),'utf8'));
assert.deepEqual(weeklyTelemetry.on.schedule,[{cron:'5 0 * * 1'}],
  'optional seven-day performance readback must not run every day');
assert.ok(Object.hasOwn(weeklyTelemetry.on,'workflow_dispatch'),
  'performance readback must retain direct manual access');
assert.ok(Object.hasOwn(weeklyTelemetry.on,'pull_request'),
  'performance self-test must retain pull-request CI');
assert.equal(weeklyTelemetry.jobs['live-readonly'].environment,productionEnvironment);
assert.equal(weeklyTelemetry.jobs['live-readonly'].if.includes("github.event_name != 'pull_request'"),true,
  'pull requests cannot read production performance credentials');
assert.ok(protectedWorkflowNames.includes('provision-standalone-performance-gas-20261103.yml'),
  'independent GAS provisioning must run only in protected production Environment');
assert.ok(protectedWorkflowNames.includes('gas-deployment-usage-metrics-readonly.yml'),
  'new read-only usage audit must use the protected production Environment');
assert.ok(protectedWorkflowNames.includes('issue507-deployment-inventory-readonly.yml'),
  'manual GAS deployment inventory must retain protected production Environment');
assert.ok(protectedWorkflowNames.includes('gas-published-gate-readonly-audit.yml'),
  'manual published-GAS source audit must retain protected production Environment');
assert.ok(protectedWorkflowNames.includes('nh-close-20261102-diagnostic-readonly.yml'),
  'one-off NH stored close diagnostic must retain protected GAS environment');
assert.ok(protectedWorkflowNames.includes('telegram-morning-punctual-arm.yml'),
  'morning early-arm must use protected GAS environment');
assert.ok(protectedWorkflowNames.includes('telegram-close-punctual-arm.yml'),
  'closing early-arm must use protected GAS environment');
assert.ok(protectedWorkflowNames.includes('telegram-close-precompute.yml'),
  '16:50 precompute must use protected GAS environment');
assert.ok(protectedWorkflowNames.includes('issue507-oct30-domestic-close-readonly.yml'),
  'new domestic-close readonly workflow must retain the protected GAS environment');
assert.ok(protectedWorkflowNames.includes('issue-507-fund-snapshot-evidence-readonly.yml'),
  'one-date fund evidence workflow must retain the protected GAS environment');
assert.ok(protectedWorkflowNames.includes('issue-507-fund-status-readonly.yml'),
  'new fund status workflow must retain the protected GAS environment');
const sample='issue-507-three-day-code-lineage-readonly.yml';
const sampleSource=fs.readFileSync(new URL(sample,dir),'utf8');
const removed=sampleSource.replace('    environment: '+productionEnvironment+'\n','');
assert.notEqual(removed,sampleSource,'negative mutation must actually remove guard');
assert.throws(()=>auditEnvironmentGuard(sample,removed),/protected Environment/);
const switched=sampleSource.replace(
  '    environment: '+productionEnvironment,
  '    environment: unrestricted-environment');
assert.throws(()=>auditEnvironmentGuard(sample,switched),/protected Environment/);
const oauthWorkflow='issue-507-worker-execution-audit.yml';
const oauthSource=fs.readFileSync(new URL(oauthWorkflow,dir),'utf8');
const oauthWithoutGuard=oauthSource.replace('    environment: '+productionEnvironment+'\n','');
assert.notEqual(oauthWithoutGuard,oauthSource,'Apps Script OAuth worker guard mutation must apply');
assert.throws(()=>auditEnvironmentGuard(oauthWorkflow,oauthWithoutGuard),/protected Environment/);
console.log('Issue #507 GAS environment source-contract: '+protectedWorkflowNames.length
 +' workflow files / '+protectedJobs+' secret-consuming jobs. GitHub Settings policy NOT VERIFIED.');


// Daily worker monitor uses the existing protected credential boundary.
const auditWorkflow=fs.readFileSync('.github/workflows/issue-507-worker-execution-audit.yml','utf8');
function verifyMonitor(source){
  const document=YAML.parseDocument(source,{uniqueKeys:true});
  assert.equal(document.errors.length,0);
  const config=document.toJS();
  assert.equal(config.on.schedule,undefined, 'missing OAuth process scope disables failing 03:17 schedule');
  assert.equal(config.on.push,undefined, 'read-only process audit must not auto-run on every main push');
  assert.equal(config.on.workflow_dispatch,null, 'after OAuth reauthorization operator may run it manually');
  assert.deepEqual(config.permissions,{contents:'read'});
  assert.equal(config.concurrency['cancel-in-progress'],false);
  const job=config.jobs['live-readonly'];
  assert.equal(job.if,"github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch'");
  assert.equal(job.environment,'portfolio-production-gas');
  assert.equal(job.needs,'contract');
  assert.equal(job['timeout-minutes'],4);
  assert.equal(job.steps.at(-1).run,'node scripts/issue507-worker-execution-audit.mjs --health-check');
  assert.equal(job.steps.at(-1)['continue-on-error'],undefined);
  assert.equal(job.steps.at(-1).env.CLASPRC_JSON,'$'+'{{ secrets.CLASPRC_JSON }}');
  const contract=JSON.stringify(config.jobs.contract);
  assert.ok(!contract.includes('secrets.'));
  assert.match(contract,/--self-test/);
}
verifyMonitor(auditWorkflow);
for(const [before,after] of [
  ['--health-check',''],['portfolio-production-gas','unprotected'],
  ["github.ref == 'refs/heads/main' && ",''],["github.event_name == 'workflow_dispatch'","github.event_name == 'schedule'"],
  ["  pull_request:\n","  schedule:\n    - cron: '17 18 * * *'\n  pull_request:\n"]
]){
  const mutated=auditWorkflow.replace(before,after);
  assert.notEqual(mutated,auditWorkflow);
  assert.throws(()=>verifyMonitor(mutated));
}
// Retired 2026-11-03 single-day GAS preflight is no longer in Actions.
function executeActualJointGate(command,event,stubDate){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'issue507-readonly-gate-'));
 try{
  // Run the ACTUAL YAML bash step; only the current KST date CLI is stubbed.
  const fakeDate=path.join(dir,'date'),out=path.join(dir,'github-output.txt');
  fs.writeFileSync(fakeDate,'#!/bin/sh\nprintf "%s\\n" "$STUB_KST_DATE"\n',{mode:0o755});
  const run=spawnSync('bash',['-e'],{
   input:command,encoding:'utf8',timeout:2500,
   env:{...process.env,
    PATH:dir+path.delimiter+(process.env.PATH||''),
    STUB_KST_DATE:stubDate,
    GITHUB_EVENT_NAME:event,
    GITHUB_OUTPUT:out}
  });
  assert.equal(run.status,0,'KST read-only gate script must exit successfully');
  return fs.readFileSync(out,'utf8').trim();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}

function verifyJointIssue507NhReadOnlyWorkflow(source){
 const doc=YAML.parseDocument(source,{version:'1.2',uniqueKeys:true});
 assert.equal(doc.errors.length,0);
 const flow=doc.toJS({maxAliasCount:0});
 assert.deepEqual(Object.keys(flow.on),['workflow_dispatch','push']);
 assert.deepEqual(flow.on.push.branches,['main']);
 assert.deepEqual(flow.on.push.paths,['.github/workflows/issue-507-fund-snapshot-evidence-readonly.yml']);
 assert.deepEqual(flow.permissions,{contents:'read'});
 assert.equal(flow.concurrency['cancel-in-progress'],false);
 const job=flow.jobs.inspect;
 assert.equal(job.environment,'portfolio-production-gas');
 assert.equal(job['timeout-minutes'],30);
 assert.ok(job.if.includes("github.ref == 'refs/heads/main'"));
 assert.ok(job.if.includes("github.event_name == 'workflow_dispatch'"));
 assert.ok(job.if.includes("github.event_name == 'push' && github.run_attempt == 1"));
 const steps=job.steps;
 const date=steps.find(s=>s.id==='window');
 assert.ok(date.run.includes('TZ=Asia/Seoul date +%F'));
 assert.ok(date.run.includes('2026-11-03'));
 assert.equal(executeActualJointGate(date.run,'push','2026-11-03'),'ready=true');
 assert.equal(executeActualJointGate(date.run,'push','2026-11-04'),'ready=false');
 assert.equal(executeActualJointGate(date.run,'workflow_dispatch','2026-11-04'),'ready=true');
 assert.equal(executeActualJointGate(date.run,'workflow_dispatch','2026-11-03'),'ready=true');
 const ones=[
 ['funds','node scripts/diagnose-fund-snapshot-evidence-readonly.mjs'],
 ['closes','node scripts/issue507-oct30-domestic-close-readonly.mjs'],
 ['historical','node scripts/issue507-deferred-source-audit-readonly.mjs'],
 ['nav','node scripts/diagnose-fund-valuation-readonly.mjs']];
 for(const [id,cmd] of ones){
  const s=steps.find(v=>v.id===id);
  assert.equal(s.run,cmd);
  assert.equal(s['continue-on-error'],true,
    'one failed read may not prevent independent cross-source evidence');
  assert.equal(s.if,"steps.window.outputs.ready == 'true'");
  assert.equal(s.env.GAS_WEB_APP_URL,'$'+'{{ vars.GAS_WEB_APP_URL }}');
  assert.equal(s.env.GAS_ACCESS_TOKEN,'$'+'{{ secrets.GAS_ACCESS_TOKEN }}');
 }
 const last=steps.at(-1);
 assert.equal(last.if,'always()');
 assert.ok(last.run.includes('JOINT_READONLY_FINANCE_WRITES=0'));
 assert.ok(last.run.includes('JOINT_READONLY_HISTORICAL_STATUS=$HISTORICAL'));
 assert.ok(last.run.includes('JOINT_READONLY_NAV_STATUS=$NAV'));
 assert.ok(last.run.includes('|| [ "$HISTORICAL" != \'success\' ] || [ "$NAV" != \'success\' ]'));
 assert.ok(last.run.includes('exit 2'));
 const commands=steps.map(s=>s.run||'').join('\n');
 assert.ok(!commands.includes('scripts/deploy-gas.mjs'));
 assert.ok(!commands.includes('rewriteSnapshotDate'));
 assert.ok(!commands.includes('savePriceHistory'));
 assert.ok(!commands.includes('NHPLUG_APP_KEY'));
}
const jointAuditFile=fs.readFileSync(
 '.github/workflows/issue-507-fund-snapshot-evidence-readonly.yml','utf8');
verifyJointIssue507NhReadOnlyWorkflow(jointAuditFile);
for(const [before,after] of [
 ['2026-11-03','2026-11-04'],
 ['  contents: read','  contents: write'],
 ['    environment: portfolio-production-gas','    environment: unprotected'],
 ['node scripts/issue507-oct30-domestic-close-readonly.mjs','echo bypassed'],
 ["github.event_name == 'push' && github.run_attempt == 1","github.event_name == 'push'"],
 ['[ "$(TZ=Asia/Seoul date +%F)" = "2026-11-03" ]; then',
  '[ "$(TZ=Asia/Seoul date +%F)" = "2026-11-03" ] || true; then']
]){
 const alternate=before==='2026-11-03'?jointAuditFile.replaceAll(before,after)
  :jointAuditFile.replace(before,after);
 if(alternate!==jointAuditFile)
  assert.throws(()=>verifyJointIssue507NhReadOnlyWorkflow(alternate));
}
