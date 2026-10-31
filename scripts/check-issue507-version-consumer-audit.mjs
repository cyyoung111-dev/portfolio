import assert from 'node:assert/strict';
import fs from 'node:fs';
import {auditIssue507VersionConsumers,REQUIRED_OPERATING_CONSUMERS} from './audit-issue507-version-consumers.mjs';

const report=auditIssue507VersionConsumers();
assert.equal(report.status,'BLOCKED_LIVE_RELEASE');
assert.equal(report.baseVersion,'9.281');
assert.equal(report.proposedVersion,'9.282');
assert.equal(report.readyForDeployment,false);
assert.equal(report.productionGasChanged,false);
assert.equal(report.versionMigrationPerformed,false);
assert.equal(report.financeMutationPerformed,false);
assert.ok(report.scannedFileCount>=20);
assert.equal(report.requiredConsumers.length,REQUIRED_OPERATING_CONSUMERS.length);
assert.ok(report.productionPinCount>=REQUIRED_OPERATING_CONSUMERS.length);
for(const r of report.requiredConsumers){
 assert.ok(r.lines.length>0,r.file);
 assert.ok(r.lines.every(n=>Number.isInteger(n)&&n>0),r.file);
}
// An intentional version change in web without the coordinated release is
// rejected. A loss of a previously known operational consumer is rejected.
const web='src/web/features/settings/settings_fetch.js';
const real=fs.readFileSync(web,'utf8');
assert.throws(()=>auditIssue507VersionConsumers({
 readText:file=>file===web?real.replace(
  /(\bconst\s+EXPECTED_GAS_VERSION\s*=\s*['"])9\.281(?=['"])/,
  (_whole,prefix)=>prefix+'9.282'
 ):fs.readFileSync(file,'utf8'),
}),/ISSUE507_EXPECTED_WEB_VERSION_CHANGED/);

const first=REQUIRED_OPERATING_CONSUMERS[1];
const original=fs.readFileSync(first,'utf8');
assert.throws(()=>auditIssue507VersionConsumers({
 readText:file=>file===first?original.replaceAll("'9.281'","'9.282'")
  .replaceAll('"9.281"','"9.282"'):fs.readFileSync(file,'utf8'),
}),/ISSUE507_REQUIRED_CONSUMER_PIN_MISSING/);

// Synthetic new runtime client must be caught by recursive scanning.
const synthetic='scripts/run-synthetic-issue507-client.mjs';
const augmented=auditIssue507VersionConsumers({
 files:[...new Set([...report.allVersionPins.map(x=>x.file),synthetic])],
 readText:file=>file===synthetic?
  "if (reply.gasVersion !== '9.281') throw Error('OLD_VERSION');":
  fs.readFileSync(file,'utf8'),
});
assert.ok(augmented.allVersionPins.some(x=>x.file===synthetic&&x.kind==='operational_or_support'));
assert.equal(augmented.productionPinCount,report.productionPinCount+1);

console.log(JSON.stringify({
 state:'BLOCKED_LIVE_RELEASE',
 scanned:report.scannedFileCount,
 productionPins:report.productionPinCount,
 testPins:report.testPinCount,
 requiredConsumers:report.requiredConsumers.length,
 surpriseConsumerDetected:true,
 mutationTestsPassed:true,
 writes:0,
}));
