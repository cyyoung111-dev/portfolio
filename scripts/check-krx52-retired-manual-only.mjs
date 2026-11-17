// Lightweight required-CI guard for retired optional all-stock KRX 52-week job.
// Full 252-session simulation remains available on explicit manual audit only.
// No KRX API, GAS, network, financial writes, or actions are triggered here.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import YAML from 'yaml';

const archive=YAML.parseDocument(readFileSync(
 '.github/workflows/krx-52week-history.yml','utf8'),{
 version:'1.2',uniqueKeys:true});
assert.equal(archive.errors.length,0,'archive workflow invalid YAML');
const cfg=archive.toJS({maxAliasCount:0});
assert.deepEqual(Object.keys(cfg.on),['workflow_dispatch'],
 'optional all-stock 52-week source cannot run automatically');
assert.deepEqual(cfg.permissions,{contents:'read',actions:'read'});
assert.deepEqual(Object.keys(cfg.jobs),['source-only']);
const job=cfg.jobs['source-only'];
assert.equal(job.if,
 "github.repository == 'cyyoung111-dev/portfolio' && github.ref == 'refs/heads/main' && github.run_attempt == 1 && github.event_name == 'workflow_dispatch'",
 'manual-only source job must not execute for schedule/push/replay');
assert.equal(job.environment,'portfolio-production-gas');
assert.match(job.steps.map(step=>step.run||'').join('\n'),
 /node scripts\/collect-krx-52week-history\.mjs/,
 'manual-only backup source remains available');
const listing=YAML.parseDocument(readFileSync(
 '.github/workflows/krx-52week-listing-audit-readonly.yml','utf8'),{
 version:'1.2',uniqueKeys:true});
assert.equal(listing.errors.length,0,'listing audit invalid YAML');
assert.deepEqual(Object.keys(listing.toJS({maxAliasCount:0}).on),
 ['workflow_dispatch'],'listing audit also remains manual only');
const nav=readFileSync('.github/workflows/kb-fund-nav-collect.yml','utf8');
assert.doesNotMatch(nav,/^  workflow_run:/m,
 'retired KRX 52-week archive must not auto-wake private NAV');
console.log('KRX52_RETIRED_MANUAL_ONLY_CI_PASS cron=0 push=0 full_market_checks=manual');
