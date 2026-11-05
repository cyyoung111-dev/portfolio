// Source-only candidate; do NOT alter the pinned v9.282 GAS runtime.
import {createHash} from 'node:crypto';
export const APPROVED_GAS_BLOB='9c1a5f31d1abc4b44f7da9af7a50fe3f15967134';
const TARGET=`function fetchDomesticRegularCloses(items,date) {
  if (typeof _issue507GateInside_ !== 'undefined' && !_issue507GateInside_) return _issue507GateInvoke_('fetchDomesticRegularCloses', fetchDomesticRegularCloses, this, arguments);
  var nh={};
  try {nh=fetchNhRegularCloses(items,date)||{};} catch(ignoreNh) {}
  var missing=(items||[]).filter(function(item){return !nh[item.code];});
  if(!missing.length)return nh;
  var fallback={};
  try {fallback=fetchPricesKrx(missing,date)||{};}catch(error){if(!Object.keys(nh).length)throw error;}
  Object.keys(nh).forEach(function(code){fallback[code]=nh[code];});
  return fallback;
}`;
const REPLACEMENT=`function fetchDomesticRegularCloses(items,date) {
  if (typeof _issue507GateInside_ !== 'undefined' && !_issue507GateInside_) return _issue507GateInvoke_('fetchDomesticRegularCloses', fetchDomesticRegularCloses, this, arguments);
  // Keep the vendor's one-second pacing and each collector's 55s deadline.
  // A 37-code flat request can silently lose the tail; smaller calls reset
  // the per-call budget without weakening close-date/source validation.
  var all=Array.isArray(items)?items:[],nh={},started=Date.now(),chunks=0;
  for(var offset=0;offset<all.length;offset+=12){
    if(Date.now()-started>150000)break;
    try {
      var observed=fetchNhRegularCloses(all.slice(offset,offset+12),date)||{};
      Object.keys(observed).forEach(function(code){nh[code]=observed[code];});
    }catch(ignoreNh){}
    chunks++;
  }
  try {
    if(typeof Logger!=='undefined'&&Logger&&typeof Logger.log==='function')
      Logger.log('[NH_CLOSE_BATCH_COVERAGE] '+JSON.stringify({
        date:date,expected:all.length,verified:Object.keys(nh).length,
        batches:chunks,elapsedSeconds:Math.floor((Date.now()-started)/1000)
      }));
  }catch(ignoreDiagnostic){}
  var missing=all.filter(function(item){return !nh[item.code];});
  if(!missing.length)return nh;
  var fallback={};
  try {fallback=fetchPricesKrx(missing,date)||{};}catch(error){if(!Object.keys(nh).length)throw error;}
  Object.keys(nh).forEach(function(code){fallback[code]=nh[code];});
  return fallback;
}`;
function gitBlobSha(source){
 return createHash('sha1').update('blob '+Buffer.byteLength(source,'utf8')+'\\0')
   .update(source,'utf8').digest('hex');
}
export function proposeNhDomesticCloseBatching(source){
 if(typeof source!=='string'||gitBlobSha(source)!==APPROVED_GAS_BLOB)
  throw Error('NH_BATCH_BASE_GAS_BLOB_MISMATCH');
 if(source.split(TARGET).length!==2||source.includes('[NH_CLOSE_BATCH_COVERAGE]'))
  throw Error('NH_BATCH_TARGET_NOT_EXACT');
 const candidate=source.replace(TARGET,REPLACEMENT);
 return {candidate,baseSha:APPROVED_GAS_BLOB,
  candidateSha:gitBlobSha(candidate),
  changedFunction:'fetchDomesticRegularCloses',
  financialWritesAdded:false,gasDeployed:false};
}
