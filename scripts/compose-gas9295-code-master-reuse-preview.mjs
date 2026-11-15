// #734/#860: source-only v9.295 GAS price-master read proposal.
// Derives ONLY from the exact reviewed v9.294 producer; no deployment path.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {composeIssue734Gas9294OwnerNavPreview}
  from './compose-issue734-gas9294-owner-nav-preview.mjs';

const PUBLISHED_9294_BLOB='f5e31eeb2255539a021546d8b90a71d5cc7ca33d';
const blob = source => {
  const bytes=Buffer.from(source,'utf8');
  return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
};
function once(source,before,after,label) {
  assert.equal(source.split(before).length,2,'GAS9295_SOURCE_DRIFT_'+label);
  return source.replace(before,after);
}
function extract(source,name) {
  const i=source.indexOf('function '+name+'(');
  const j=source.indexOf('\n}',i);
  assert(i>=0 && j>i,'GAS9295_FUNCTION_BOUNDARY_'+name);
  return source.slice(i,j+2);
}
export function composeGas9295CodeMasterReusePreview() {
  const prior=composeIssue734Gas9294OwnerNavPreview();
  assert.equal(prior.manifest.candidateVersion,'9.294');
  assert.equal(prior.manifest.candidateGitBlob,PUBLISHED_9294_BLOB,
    'GAS9295_PARENT_NOT_EXACT_9294');
  const parent=prior.source;
  assert.equal(blob(parent),PUBLISHED_9294_BLOB);
  const oldFn=extract(parent,'handleGetPricesCompat');
  const read='getCodeItems(ss).forEach(function(item) {';
  assert.equal(oldFn.split(read).length,3,
    'GAS9295_EXPECT_TWO_DIRECT_MASTER_READS');
  let nextFn=once(oldFn,
    '    if (reqCodes.length > 0) {\n      var codeNameMap = {};',
    '    var codeItemsForLookup = [];\n    if (reqCodes.length > 0) {\n      var codeNameMap = {};',
    'ALLOCATE_PER_REQUEST');
  nextFn=once(nextFn,
    '      getCodeItems(ss).forEach(function(item) {',
    '      codeItemsForLookup = getCodeItems(ss);\n      codeItemsForLookup.forEach(function(item) {',
    'FIRST_MASTER_READ');
  nextFn=once(nextFn,
    '    getCodeItems(ss).forEach(function(item) {',
    '    codeItemsForLookup.forEach(function(item) {',
    'REUSE_FOR_FX');
  assert.equal((nextFn.match(/getCodeItems\(ss\)/g)||[]).length,1);
  assert.equal((oldFn.match(/getCodeItems\(ss\)/g)||[]).length,2);
  let candidate=once(parent,oldFn,nextFn,'PRICE_FUNCTION_ONLY');
  candidate=once(candidate,
    '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.294',
    '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.295',
    'VERSION_BANNER');
  const n=candidate.split("gasVersion: '9.294'").length-1;
  assert(n>=5 && n<=24,'GAS9295_VERSION_FIELD_COUNT_'+n);
  candidate=candidate.replaceAll("gasVersion: '9.294'","gasVersion: '9.295'");
  candidate=once(candidate,
    "var ISSUE507_GATE_API_VERSION='9.294'",
    "var ISSUE507_GATE_API_VERSION='9.295'",
    'GATE_VERSION');
  return {parent,candidate,oldFn,nextFn,manifest:{
    parentVersion:'9.294',proposedVersion:'9.295',
    parentGitBlob:PUBLISHED_9294_BLOB,candidateGitBlob:blob(candidate),
    changedBusinessFunctions:['handleGetPricesCompat'],
    directCodeMasterReadsOnCacheMiss:{before:2,after:1},
    cachedRequestCodeMasterReads:{before:0,after:0},
    quoteSourcesAndDateLogicUnchanged:true,
    sourceOnly:true,deployable:false,approved:false,
    manualReleaseRequired:true,financialWrites:0,gasDeployments:0
  }};
}
