// Source-only integration proof; no Apps Script, Sheets or network writes.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {composeGas9286IntegratedPreview} from './compose-gas9286-integrated-preview.mjs';
const blob=s=>{const b=Buffer.from(s,'utf8');return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
const {base,candidate,manifest}=composeGas9286IntegratedPreview();
assert.equal(blob(base),'b5b1c7fd5a27454419ddd6d12ecb20751c207c63');
assert.equal(blob(candidate),manifest.candidateSourceGitBlob);
assert.equal(manifest.proposedVersion,'9.286');
assert.equal(manifest.columns,14);
assert.equal(manifest.tradeLedgerProtocolVersion,2);
assert.equal(manifest.productionDeploymentApproved,false);
assert.equal(manifest.status,'SOURCE_PREVIEW_NOT_DEPLOYABLE');
assert.equal(manifest.financeWrites,0);
assert.equal(manifest.gasProjectWrites,0);
assert.equal(candidate.split("gasVersion: '9.286'").length-1,9);
assert.ok(candidate.includes("var ISSUE507_GATE_API_VERSION='9.286'"));
assert.ok(candidate.includes('function _tradeV2ValidateMutation_('));
assert.ok(candidate.includes('function handleSyncTrades('));
assert.ok(candidate.includes('if (values.length === 0)'));
assert.ok(candidate.includes('intendedRows.length, 14)'));
for(const unsafe of ['previousFxGroups','oldOrdinaryCounts','TRADE_FX_GROUP_'])
 assert.ok(!candidate.includes(unsafe),'unsafe legacy group heuristic: '+unsafe);
new vm.Script(candidate,{filename:'gas-9286-integrated-preview.gs'});
console.log('GAS9286_INTEGRATED_PREVIEW_PASS '+JSON.stringify(manifest));
