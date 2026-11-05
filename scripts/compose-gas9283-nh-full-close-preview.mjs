// Source-only GAS v9.283 combined candidate: NH early window, KRX turnover,
// NH batched close, and strict 37-code domestic close acceptance.
// No real API, Apps Script, financial-sheet or deployment writes.
import fs from 'node:fs';
import {gasSourceBlobSha,extractExpectedGasVersion} from './deploy-gas.mjs';
import {prepareGasNh9283WithKrxTurnoverPreview} from './compose-gas9283-turnover-preview.mjs';
import {proposeNhDomesticCloseFullCoverage} from './nh-domestic-close-full-coverage-proposal.mjs';

export const EXACT_V9282_BASE_BLOB='9c1a5f31d1abc4b44f7da9af7a50fe3f15967134';
export const EXACT_9283_PRIOR_PREVIEW_BLOB='60aa5665f218728c09888215bbe37e8aa1dea5ec';
export const CLOSE_MODIFIED_FUNCTIONS=Object.freeze([
  'fetchDomesticRegularCloses','saveDailyPriceHistory'
]);

function extractOne(source,name){
  const token='function '+name+'(';
  const start=source.indexOf(token);
  if(start<0 || source.indexOf(token,start+token.length)!==-1)
    throw Error('GAS_9283_CLOSE_FUNCTION_IDENTITY:'+name);
  const end=source.indexOf('\n}',start);
  if(end<start)throw Error('GAS_9283_CLOSE_FUNCTION_END:'+name);
  return source.slice(start,end+2);
}
function replaceOne(source,original,replacement,name){
  if(source.split(original).length!==2)throw Error('GAS_9283_CLOSE_ANCHOR_DRIFT:'+name);
  return source.replace(original,replacement);
}

export function composeGas9283NhFullClosePreview({
 baseline=fs.readFileSync('src/gas/apps_script.gs','utf8')
}={}){
  if(typeof baseline!=='string'||gasSourceBlobSha(baseline)!==EXACT_V9282_BASE_BLOB)
    throw Error('GAS_9283_CLOSE_V9282_BASE_DRIFT');
  const strict=proposeNhDomesticCloseFullCoverage(baseline);
  const existing=prepareGasNh9283WithKrxTurnoverPreview();
  if(gasSourceBlobSha(existing.candidate)!==EXACT_9283_PRIOR_PREVIEW_BLOB)
    throw Error('GAS_9283_CLOSE_PRIOR_PREVIEW_DRIFT');
  let candidate=existing.candidate;
  for(const name of CLOSE_MODIFIED_FUNCTIONS){
    const oldFunction=extractOne(baseline,name);
    const changedFunction=extractOne(strict.candidate,name);
    if(changedFunction===oldFunction)throw Error('GAS_9283_CLOSE_PATCH_MISSING:'+name);
    if(extractOne(candidate,name)!==oldFunction)
      throw Error('GAS_9283_CLOSE_CONFLICT:'+name);
    candidate=replaceOne(candidate,oldFunction,changedFunction,name);
  }
  if(extractExpectedGasVersion(candidate)!=='9.283')
    throw Error('GAS_9283_CLOSE_RESPONSE_VERSION_DRIFT');
  const versionCount=[...candidate.matchAll(/\bgasVersion:\s*['"]9\.283['"]/g)].length;
  if(versionCount!==9)throw Error('GAS_9283_CLOSE_VERSION_COUNT_DRIFT');
  const gate=baseline.match(/var ISSUE507_GATE_RELEASE_ID='([a-f0-9]{64})'/)?.[0];
  if(!gate||!candidate.includes(gate))
    throw Error('GAS_9283_CLOSE_WRITER_GATE_CHANGED');
  if(!candidate.includes('kst.minutes<405||kst.minutes>=480'))
    throw Error('GAS_9283_CLOSE_NH_MORNING_WINDOW_CHANGED');
  const blob=gasSourceBlobSha(candidate);
  if(blob===EXACT_9283_PRIOR_PREVIEW_BLOB)
    throw Error('GAS_9283_CLOSE_NO_CHANGE');
  return {candidate,manifest:{
    status:'SOURCE_PREVIEW_NOT_DEPLOYABLE',
    proposedVersion:'9.283',
    predecessorBlob:EXACT_V9282_BASE_BLOB,
    nhKrxBasePreviewBlob:EXACT_9283_PRIOR_PREVIEW_BLOB,
    candidateSourceBlob:blob,
    changedFunctions:[...CLOSE_MODIFIED_FUNCTIONS],
    expectedDomesticCloseCodes:37,
    nhBatchSize:12,
    preservesExistingBackfill:true,
    preservesFundAndLedgerSource:true,
    productionSourceChanged:false,
    releaseAllowlistApproved:false,
    deploymentApproved:false,
    financeWriteAuthorized:false
  }};
}
