import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {gasSourceBlobSha,assertGasReleaseReady,extractExpectedGasVersion} from './deploy-gas.mjs';
import {composeGas9283RecentGapSelfHealPreview}
  from './compose-gas9283-recent-gap-selfheal-preview.mjs';

const previous=fs.readFileSync('reference/gas-v9.282.gs','utf8');
const actual=fs.readFileSync('src/gas/apps_script.gs','utf8');
const generated=composeGas9283RecentGapSelfHealPreview().candidate;
const expectedSha='327f48785550a012eaf1ed533c24bf6289c01a71';
assert.equal(gasSourceBlobSha(previous),'9c1a5f31d1abc4b44f7da9af7a50fe3f15967134');
assert.equal(actual,generated,'actual v9.283 source MUST match entire reviewed stacked candidate byte-for-byte');
assert.equal(gasSourceBlobSha(actual),expectedSha);
assert.equal(extractExpectedGasVersion(actual),'9.283');
assert.equal(assertGasReleaseReady(actual),'9.283');
assert.equal([...actual.matchAll(/\bgasVersion:\s*['"]9\.283['"]/g)].length,9);
assert.doesNotMatch(actual,/\bgasVersion:\s*['"]9\.282['"]/);
assert.match(actual,/var ISSUE507_GATE_API_VERSION='9.283'/);
const gate=(source)=>source.match(/var ISSUE507_GATE_RELEASE_ID='([a-f0-9]{64})'/)?.[1]||'';
assert.equal(gate(previous),gate(actual));
assert.match(actual,/TARGET_EXACT_KRX_INCOMPLETE/);
assert.match(actual,/NH_CLOSE_BATCH_COVERAGE/);
assert.match(actual,/getKrxMarketTurnover/);
assert.match(actual,/portfolio_recent_gap_scan_date_v1/);
assert.match(actual,/kst\.minutes<405\|\|kst\.minutes>=480/);
assert.doesNotMatch(actual,/var existingRows = _readSnapshotRowsByDate\(ss, snapshotDate\);/);
const web=fs.readFileSync('src/web/features/settings/settings_fetch.js','utf8');
assert.match(web,/const EXPECTED_GAS_VERSION = '9\.283';/);
assert.match(web,/const COMPATIBLE_GAS_VERSIONS = Object\.freeze\(\['9\.281', '9\.282', EXPECTED_GAS_VERSION\]\);/);
const manifest=JSON.parse(fs.readFileSync('ops/issue860/release-gas9283.json','utf8'));
assert.equal(manifest.candidateSourceGitBlob,expectedSha);
assert.equal(manifest.parentSourceGitBlob,gasSourceBlobSha(previous));
assert.equal(manifest.approval.release,false);
assert.equal(manifest.approval.financeWrite,false);
new vm.Script(actual,{filename:'gas-v9.283-reviewed-full-source.gs'});
console.log('GAS9283_FULL_SOURCE_PROMOTION_OK '+JSON.stringify({
 candidateBlob:expectedSha,predecessorBlob:gasSourceBlobSha(previous),
 responseVersions:9,previewEqual:true,deployed:false,financeWrites:0
}));
