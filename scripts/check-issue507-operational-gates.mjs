#!/usr/bin/env node
// Issue #507: check the ACTUAL workflow YAML, never run authenticated GAS.
// Prevent feature-branch dispatch and push from reaching credentialed jobs.
// This is an offline CI contract; it must not access credentials or Sheets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';

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
assert.equal(protectedWorkflowNames.length,45,
  'migration inventory: all 45 GAS_ACCESS_TOKEN/CLASPRC_JSON consumer workflows must be gated');
assert.equal(protectedJobs,46,
  'migration inventory: all 46 secret-consuming jobs must be protected');
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
  assert.deepEqual(config.on.schedule,[{cron:'17 18 * * *'}]);
  assert.deepEqual(config.permissions,{contents:'read'});
  assert.equal(config.concurrency['cancel-in-progress'],false);
  const job=config.jobs['live-readonly'];
  assert.equal(job.if,"github.ref == 'refs/heads/main' && (github.event_name == 'schedule' || github.event_name == 'push' || github.event_name == 'workflow_dispatch')");
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
  ["github.ref == 'refs/heads/main' && ",''],["17 18 * * *","17 18 * * 1"]
]){
  const mutated=auditWorkflow.replace(before,after);
  assert.notEqual(mutated,auditWorkflow);
  assert.throws(()=>verifyMonitor(mutated));
}
