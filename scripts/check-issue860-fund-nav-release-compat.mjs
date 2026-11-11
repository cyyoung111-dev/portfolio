#!/usr/bin/env node
import assert from 'node:assert/strict';
import {assertPublishedReleaseFundNavSupport,
 supportsPublishedFundNavGasVersion} from './issue860-fund-nav-release-compat.mjs';
import {composeIssue860Gas9291Preview} from './compose-issue860-gas9291-preview.mjs';
import {assertGasReleaseReady} from './deploy-gas.mjs';
for(const kind of ['KB','HANWHA']){
 for(const v of ['9.285','9.289','9.291'])
  assert.equal(supportsPublishedFundNavGasVersion(kind,v),true,
   kind+' reviewed release '+v);
 for(const v of ['9.290','9.292','9.300','9.999',null,''])
  assert.equal(supportsPublishedFundNavGasVersion(kind,v),false,
   kind+' must reject unknown release '+v);
}
assert.equal(supportsPublishedFundNavGasVersion('NOT_A_FUND','9.291'),false);
assert.deepEqual(assertPublishedReleaseFundNavSupport('9.291'),{
 version:'9.291',kb:true,hanwha:true,financialWrites:0});
for(const v of ['9.290','9.292','9.999']){
 assert.throws(()=>assertPublishedReleaseFundNavSupport(v),
 /GAS_RELEASE_NAV_COLLECTOR_VERSION_UNREVIEWED/);
}
const candidate=composeIssue860Gas9291Preview();
assert.equal(candidate.manifest.candidateVersion,'9.291');
assert.equal(assertGasReleaseReady(candidate.source),'9.291');
assert.equal(candidate.manifest.sourceGitBlob,
 'e9311667d513c1e43a8ed1af326a3ecdb9d1ca70');
assert.equal(candidate.manifest.financeWrites,0);
assert.equal(candidate.manifest.gasDeployments,0);
console.log('PASS #860 GAS 9.291 NAV support: exact-class KB/Hanwha versions reviewed, unreviewed 9.292+ blocked, approved source immutable, finance writes 0');
