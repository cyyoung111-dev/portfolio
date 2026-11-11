// #826: source-only proposal for reviewed, *currently published* GAS v9.291.
// This is not a release. In particular, it does not update the GAS version,
// create a release pin, call Apps Script, read credentials or write any data.
// The future guarded v9.292 release must separately integrate this patch.
import {gitBlobSha,CURRENT_INDEX_ENDPOINT,PROPOSED_DERIVATIVE_ENDPOINT}
 from './compose-gas-vkospi-derivative-proposal.mjs';

export const ISSUE826_REVIEWED_GAS_9291_BLOB='954fd4aeae767ddac0cb161d3a81003b5b699d1c';
export function composeIssue826Gas9291VkospiSourceOnly(source){
 if(typeof source!=='string'||gitBlobSha(source)!==ISSUE826_REVIEWED_GAS_9291_BLOB)
  throw Error('ISSUE826_GAS_9291_SOURCE_DRIFT');
 const start=source.indexOf('function _readVkospiPointsFromKrx(');
 const end=source.indexOf('\n}',start)+2;
 if(start<0||end<=start)throw Error('ISSUE826_VKOSPI_HANDLER_NOT_FOUND');
 const original=source.slice(start,end);
 const old="var endpoint = '"+CURRENT_INDEX_ENDPOINT+"';";
 const replacement="var endpoint = '"+PROPOSED_DERIVATIVE_ENDPOINT+"';";
 if(original.split(old).length!==2)throw Error('ISSUE826_VKOSPI_ENDPOINT_DRIFT');
 if(original.split("vkospi_v2_").length!==2
   ||original.split("vkospi_day_v2_").length!==4)
  throw Error('ISSUE826_VKOSPI_OLD_CACHE_NAMESPACE_DRIFT');
 // An earlier invalid provider response must not remain under the old
 // date/whole-range caches after the derivative API endpoint changes.
 const patched=original.replace(old,replacement)
  .replace("vkospi_v2_","vkospi_v3_")
  .replaceAll("vkospi_day_v2_","vkospi_day_v3_");
 const candidate=source.slice(0,start)+patched+source.slice(end);
 if(candidate.replace(replacement,old).replace("vkospi_v3_","vkospi_v2_")
   .replaceAll("vkospi_day_v3_","vkospi_day_v2_")!==source)
  throw Error('ISSUE826_VKOSPI_DIFF_SCOPE_VIOLATION');
 return Object.freeze({
  parentGitBlob:ISSUE826_REVIEWED_GAS_9291_BLOB,
  candidateGitBlob:gitBlobSha(candidate),
  parentSource:source,candidate,
  originalHandler:original,patchedHandler:patched,
  changedFunction:'_readVkospiPointsFromKrx',
  changedEndpointOnly:true,cacheNamespaceRenewed:true,
  sourceOnly:true,deployable:false,
  financialWrites:0,gasRequests:0,gasDeployments:0,telegramSends:0
 });
}
