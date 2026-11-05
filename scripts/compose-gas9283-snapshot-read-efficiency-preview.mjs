import {gasSourceBlobSha} from './deploy-gas.mjs';
import {composeGas9283BackfillQueueSelfSeedPreview} from './compose-gas9283-backfill-queue-selfseed-preview.mjs';
export function composeGas9283SnapshotReadEfficiencyPreview(){
 const old=composeGas9283BackfillQueueSelfSeedPreview().candidate;
 const token='function saveDailyPriceHistory(';
 const begin=old.indexOf(token),end=old.indexOf(String.fromCharCode(10)+'}',begin);
 if(begin<0||end<=begin||old.indexOf(token,begin+token.length)>=0)throw Error('SOURCE_DRIFT');
 const fn=old.slice(begin,end+2),unused='      var existingRows = _readSnapshotRowsByDate(ss, snapshotDate);'+String.fromCharCode(10);
 if(fn.split(unused).length!==2||fn.replace(unused,'').includes('existingRows'))throw Error('DEAD_READ_DRIFT');
 const replacement=fn.replace(unused,'');
 if(old.split(fn).length!==2)throw Error('FUNCTION_NOT_UNIQUE');
 const candidate=old.replace(fn,replacement);
 return {candidate,baseCandidate:old,manifest:{
  status:'SOURCE_PREVIEW_NOT_DEPLOYABLE',proposedVersion:'9.283',
  baseBlob:gasSourceBlobSha(old),candidateBlob:gasSourceBlobSha(candidate),
  changedFunctions:['saveDailyPriceHistory'],deployed:false,approved:false}};
}
