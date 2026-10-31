import assert from 'node:assert/strict';
import fs from 'node:fs';
import {auditIssue507VersionConsumers,REQUIRED_OPERATING_CONSUMERS,REQUIRED_VERSION_ALLOWLISTS} from './audit-issue507-version-consumers.mjs';

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
assert.equal(report.requiredAllowlists.length,REQUIRED_VERSION_ALLOWLISTS.length);
const known='scripts/issue507-deferred-source-audit-readonly.mjs';
assert.ok(report.allVersionPins.some(x=>x.file===known&&x.line===14&&
 x.pinType==='version_allowlist'&&x.symbol==='SUPPORTED_GAS_VERSION'));
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

// Mutate the actual production version allowlist rather than the distant
// assertion on gasVersion; a missing allowlist is not masked by later tests.
const deferredSource=fs.readFileSync(known,'utf8');
const changedDeferred=deferredSource.replace(
 /(?<=const SUPPORTED_GAS_VERSION=new Set\(\[)([^\]]*)/, 
 list=>list.replace("'9.281'","'9.282'")
);
assert.notEqual(changedDeferred,deferredSource);
assert.throws(()=>auditIssue507VersionConsumers({
 readText:file=>file===known?changedDeferred:fs.readFileSync(file,'utf8'),
}),/ISSUE507_REQUIRED_ALLOWLIST_PIN_MISSING/);

// Other variable-name and multiline list formats must be classified without
// requiring gasVersion on the same line.
const alternate='scripts/run-synthetic-multiline-client.mjs';
const multiline=auditIssue507VersionConsumers({
 files:[...new Set([...report.allVersionPins.map(x=>x.file),alternate])],
 readText:file=>file===alternate?
  "const VALID_GAS_VERSIONS=new Set([\n  '9.279',\n  '9.281'\n]);\nif (!VALID_GAS_VERSIONS.has(payload.gasVersion)) throw Error('BAD');":
  fs.readFileSync(file,'utf8'),
});
assert.ok(multiline.allVersionPins.some(x=>x.file===alternate&&x.line===3
 &&x.pinType==='version_allowlist'&&x.symbol==='VALID_GAS_VERSIONS'));

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
assert.ok(report.allVersionPins.every(x=>x.file&&Number.isInteger(x.line)&&
 ['direct','version_constant','version_allowlist'].includes(x.pinType)));
// CLI must publish every location, not just the aggregate.
const cli=fs.readFileSync('scripts/audit-issue507-version-consumers.mjs','utf8');
assert.match(cli,/allVersionPins:r\.allVersionPins/);

console.log(JSON.stringify({
 state:'BLOCKED_LIVE_RELEASE',
 scanned:report.scannedFileCount,
 productionPins:report.productionPinCount,
 testPins:report.testPinCount,
 requiredConsumers:report.requiredConsumers.length,
 versionAllowlists:report.requiredAllowlists.length,
 surpriseConsumerDetected:true,
 mutationTestsPassed:true,
 writes:0,
}));
