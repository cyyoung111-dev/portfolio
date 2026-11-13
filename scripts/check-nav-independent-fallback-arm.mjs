#!/usr/bin/env node
// Pure contract check. No network, dispatch, financial writes, or secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';

const name='.github/workflows/nav-independent-fallback-arm.yml';
const wf=YAML.parse(fs.readFileSync(name,'utf8'));
const path='ops/nav-independent-arm-trigger.txt';
const sentinel=fs.readFileSync(path,'utf8');
assert.equal(wf.name,'NAV independent source fallback arm');
assert.deepEqual(wf.on.push.branches,['main']);
assert.deepEqual(wf.on.push.paths,[path]);
assert.equal(wf.on.schedule,undefined,'never depend on the failed GitHub cron');
assert.equal(wf.on.workflow_dispatch,undefined,'user can dispatch the existing collector directly');
assert.equal(wf.permissions.contents,'read');
assert.equal(wf.permissions.actions,'write');
assert.equal(wf.concurrency['cancel-in-progress'],false);
const job=wf.jobs['guard-and-dispatch'];
assert.match(job.if,/github\.repository == 'cyyoung111-dev\/portfolio'/);
assert.match(job.if,/github\.ref == 'refs\/heads\/main'/);
assert.match(job.if,/github\.run_attempt == 1/);
assert.match(job.if,/startsWith\(github\.event\.head_commit\.message, 'ops: arm NAV fallback '\)/);
assert.equal(job['runs-on'],'ubuntu-latest');
assert.equal(job.steps[0].with['persist-credentials'],false);
assert.equal(job.steps[0].with['fetch-depth'],2);
assert.equal(job.steps.length,4);
const guard=job.steps[1].run, check=job.steps[2].run;
const dispatch=job.steps[3]?.run || '';
assert.match(guard,/git diff --name-only HEAD\^ HEAD/);
assert.match(guard,/NAV_FALLBACK_WRONG_PATHS/);
assert.match(guard,/NAV_FALLBACK_OTHER_FIELDS_CHANGED/);
assert.match(guard,/NAV_FALLBACK_WRONG_KST_DAY/);
assert.match(guard,/NAV_FALLBACK_OUTSIDE_KST_1010_1210/);
assert.match(guard,/lag_s > 7200/);
assert.match(check,/workflow_dispatch/);
assert.match(check,/NAV_FALLBACK_TRUSTED_COLLECTION_ALREADY_ACTIVE_OR_DONE/);
assert.match(dispatch,/gh workflow run kb-fund-nav-collect\.yml/);
assert.match(dispatch,/NOT_NAV_COMMITTED/);
for(const [label,script] of [['guard',guard],['dedupe',check],['dispatch',dispatch]]) {
 const result=spawnSync('bash',['-n'],{input:script,encoding:'utf8'});
 assert.equal(result.status,0,label+' invalid shell syntax: '+result.stderr);
}
assert.match(sentinel,/^kind=portfolio-nav-fallback-v1\narmed=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00\n$/);
assert.equal(sentinel.split('\n').length,3);
assert(!wf.jobs['guard-and-dispatch'].steps.some(x=>
 JSON.stringify(x).includes('GAS_ACCESS_TOKEN')||
 JSON.stringify(x).includes('collectHanwhaFundNav')||
 JSON.stringify(x).includes('collectKbFundNav')));
console.log(JSON.stringify({kind:'NAV_INDEPENDENT_ARM_OFFLINE_PASS',
 privateWrites:0,realDispatches:0,sentinelPath:path}));
