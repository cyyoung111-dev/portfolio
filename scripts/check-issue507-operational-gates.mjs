#!/usr/bin/env node
// Issue #507: check the ACTUAL workflow YAML, never run authenticated GAS.
// Prevent feature-branch dispatch and push from reaching credentialed jobs.
// This is an offline CI contract; it must not access credentials or Sheets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';

const exact = "github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch'";
const workflows = [
  'issue-507-source-only-preflight-readonly.yml',
  'issue-507-price-history-row-audit-readonly.yml',
  'issue-507-target-krx-confirmation-readonly.yml',
  'issue-507-three-day-code-lineage-readonly.yml',
  'issue-507-june5-readonly.yml',
  'issue-507-supervised-repair-dryrun-readonly.yml',
  'issue-507-deferred-source-audit-readonly.yml',
  'issue-507-backup-registry-readonly.yml',
  'issue-507-complete-backup-candidates-readonly.yml',
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
