// Source-only liveness candidate for v9.283. Does not edit the deployed GAS,
// modify Script Properties, touch financial sheets or call an external API.
import {createHash} from 'node:crypto';
import {composeGas9283NhFullClosePreview} from './compose-gas9283-nh-full-close-preview.mjs';

const NAME='_runPendingKrxBackfillWithLease_';
const ANCHOR=`  if (acquired !== 'ACQUIRED') return {attempted:false, deferred:true, reason:acquired};
  try {
    if (targetDate) {`;
const PATCH=`  if (acquired !== 'ACQUIRED') return {attempted:false, deferred:true, reason:acquired};
  try {
    // A missed 19:00 Writer may leave yesterday missing and pending empty.
    // Seed inside the already acquired backfill lease AND ScriptLock before
    // selecting one pending date. A targeted manual recovery never seeds
    // unrelated days; fromClose uses the existing main Writer's seed.
    if (!fromClose && !targetDate) {
      _portfolioFundAtomic_(function(sharedProps) {
        var ss = getss();
        _seedMissingKrxCloseDates_(ss, sharedProps, runDate, getCodeItems(ss));
      });
    }
    if (targetDate) {`;

function blobSha(source){
  const data=Buffer.from(source,'utf8');
  return createHash('sha1').update('blob '+data.length + String.fromCharCode(0)).update(data).digest('hex');
}
function extractOne(source,name){
  const target='function '+name+'(';
  const i=source.indexOf(target),end=source.indexOf(String.fromCharCode(10)+'}',i);
  if(i<0||end<=i||source.indexOf(target,i+target.length)>=0)
    throw Error('BACKFILL_QUEUE_FUNCTION_NOT_UNIQUE:'+name);
  return source.slice(i,end+2);
}
export function composeGas9283BackfillQueueSelfSeedPreview(){
  const former=composeGas9283NhFullClosePreview();
  const source=former.candidate;
  const prior=extractOne(source,NAME);
  if(prior.split(ANCHOR).length!==2)
    throw Error('BACKFILL_QUEUE_ANCHOR_CHANGED');
  const replacement=prior.replace(ANCHOR,PATCH);
  if(replacement===prior || source.split(prior).length!==2)
    throw Error('BACKFILL_QUEUE_PATCH_NOT_ISOLATED');
  const candidate=source.replace(prior,replacement);
  return {candidate,baseCandidate:source,manifest:{
    status:'SOURCE_PREVIEW_NOT_DEPLOYABLE',
    proposedVersion:'9.283',
    baseCandidateBlob:blobSha(source),
    candidateBlob:blobSha(candidate),
    appendedFunction:NAME,
    regularWriterUntouched:true,
    nightlySeedRequiresLeaseAndScriptLock:true,
    skipsTargetedRepair:true,
    skipsFromClose:true,
    productionGasChanged:false,
    financeSheetsChanged:false,
    deploymentApproved:false
  }};
}
