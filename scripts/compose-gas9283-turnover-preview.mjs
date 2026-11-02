// Combined preview of PR #837 (NH 06:45 window) and PR #855 (KRX turnover).
// No GAS release, deployment, financial write, credential read or live request.
import {gasSourceBlobSha} from './deploy-gas.mjs';
import {prepareNh0645Gas9283} from './prepare-nh-0645-gas-release-9283.mjs';
import {composeGasTurnoverProposal,TURNOVER_GAS_FUNCTIONS}
 from './compose-gas-krx-turnover-proposal.mjs';

export const REVIEWED_NH_PREVIEW_BLOB='22a5e37d48ca3b39c71dfa32d6afae5401ed4d5b';
const GET_ORIGINAL="  if (params.action === 'getBenchmark')                   return handleGetBenchmark(params.benchmark || '', params.from || '', params.to || '');";
const GET_NEW="  if (params.action === 'getKrxMarketTurnover')            return handleGetKrxMarketTurnover(params.date || '');";
const POST_ORIGINAL="'getKrxOfficialStockCloses', 'getBenchmark', 'getBenchmarks',";
const POST_NEW="'getKrxOfficialStockCloses', 'getBenchmark', 'getKrxMarketTurnover', 'getBenchmarks',";
const FN_ANCHOR="function handleGetBenchmarks(benchmarksInput, fromStr, toStr, forceRefresh) {";
function exactlyOnce(source,from,to){
 if(source.split(from).length!==2)throw Error('GAS_COMBINED_PREVIEW_ANCHOR_DRIFT');
 return source.replace(from,to);
}
export function prepareGasNh9283WithKrxTurnoverPreview(){
 const {candidate:nh,manifest:nhManifest}=prepareNh0645Gas9283();
 if(gasSourceBlobSha(nh)!==REVIEWED_NH_PREVIEW_BLOB)
  throw Error('GAS_COMBINED_PREVIEW_NH_SOURCE_CHANGED');
 // Use the same reviewed KRX source additions as #855, not a parallel
 // independently maintained implementation. Validate against the baseline.
 const base=nh.replace('Google Apps Script  v9.283','Google Apps Script  v9.282');
 if(!nh.includes('Google Apps Script  v9.283')||!base.includes('Google Apps Script  v9.282'))
  throw Error('GAS_COMBINED_PREVIEW_UNEXPECTED_VERSION');
 let combined=exactlyOnce(nh,GET_ORIGINAL,GET_ORIGINAL+'\n'+GET_NEW);
 combined=exactlyOnce(combined,POST_ORIGINAL,POST_NEW);
 combined=exactlyOnce(combined,FN_ANCHOR,TURNOVER_GAS_FUNCTIONS+FN_ANCHOR);
 const combinedBlob=gasSourceBlobSha(combined);
 if(combinedBlob===nhManifest.candidateBlob||!combined.includes("gasVersion: '9.283'"))
  throw Error('GAS_COMBINED_PREVIEW_NOT_INTEGRATED');
 return {candidate:combined,manifest:{
  status:'COMBINED_PREVIEW_NOT_DEPLOYABLE',
  predecessorSourceBlob:nhManifest.predecessorBlob,
  nhReviewedPreviewBlob:REVIEWED_NH_PREVIEW_BLOB,
  combinedPreviewBlob:combinedBlob,
  versionDisplayOnly:'9.283',
  releaseVersionApproved:false,
  fullSourceApproved:false,
  productionSourceChanged:false,
  deploymentApproved:false,
  financeWriteAuthorized:false,
  requiresProductionRelease:true,
  requiresNhLiveVerification:true,
  requiresKrxLiveVerification:true
 }};
}
