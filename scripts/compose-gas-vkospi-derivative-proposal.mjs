// A reviewed, *source-only* GAS v9.284 proposal for the KRX VKOSPI endpoint.
// This module never deploys, writes Apps Script, fetches live provider data,
// or copies a credential. It only constructs a candidate string in memory.
import {createHash} from 'node:crypto';

export const REVIEWED_GAS_SOURCE_BLOB='b5b1c7fd5a27454419ddd6d12ecb20751c207c63';
export const CURRENT_INDEX_ENDPOINT='https://data-dbg.krx.co.kr/svc/apis/idx/kospi_dd_trd';
export const PROPOSED_DERIVATIVE_ENDPOINT='https://data-dbg.krx.co.kr/svc/apis/idx/drvprod_dd_trd';

export function gitBlobSha(text){
 const bytes=Buffer.from(text,'utf8');
 const preamble=Buffer.concat([Buffer.from('blob '+bytes.byteLength,'utf8'),Buffer.from([0])]);
 return createHash('sha1').update(preamble).update(bytes).digest('hex');
}
export function composeGASVkospiDerivativeProposal(source){
 if(typeof source!=='string'||gitBlobSha(source)!==REVIEWED_GAS_SOURCE_BLOB)
  throw Error('GAS_VKOSPI_REVIEWED_SOURCE_MISMATCH');
 const from=source.indexOf('function _readVkospiPointsFromKrx(');
 const end=source.indexOf(String.fromCharCode(10)+'}',from)+2;
 if(from<0||end<=from)throw Error('GAS_VKOSPI_HANDLER_NOT_FOUND');
 const original=source.slice(from,end);
 const oldEndpoint="var endpoint = '"+CURRENT_INDEX_ENDPOINT+"';";
 const newEndpoint="var endpoint = '"+PROPOSED_DERIVATIVE_ENDPOINT+"';";
 if(original.split(oldEndpoint).length!==2
   ||original.includes(PROPOSED_DERIVATIVE_ENDPOINT))
  throw Error('GAS_VKOSPI_ENDPOINT_ANCHOR_DRIFT');
 const patched=original.replace(oldEndpoint,newEndpoint);
 const candidate=source.slice(0,from)+patched+source.slice(end);
 if(candidate.replace(newEndpoint,oldEndpoint)!==source
   ||candidate.split(PROPOSED_DERIVATIVE_ENDPOINT).length!==2)
  throw Error('GAS_VKOSPI_DIFF_SCOPE_FAILURE');
 return {candidate,reviewedBlob:REVIEWED_GAS_SOURCE_BLOB,
  sourceChangeOnly:true,financialWrites:0,gasDeployments:0,
  externalRequests:0,telegramSends:0};
}
