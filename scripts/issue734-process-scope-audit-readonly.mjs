#!/usr/bin/env node
// #734: Diagnose whether the EXISTING clasp refresh token has
// Google's script.processes scope. Read-only one-shot: no OAuth
// reauthorization, credential change, GAS writes, or finance writes.
// Google tokeninfo is a diagnostic endpoint, not proof of execution status.
import {pathToFileURL} from 'node:url';
import {fetchGoogleAuditToken} from './audit-published-gas-gate-readonly.mjs';

const REQUIRED='https://www.googleapis.com/auth/script.processes';
const TOKENINFO='https://oauth2.googleapis.com/tokeninfo';
function fail(reason){throw Error('ISSUE734_PROCESS_SCOPE_'+reason);}
export function inspectScopeResult(response){
 if(!response||typeof response!=='object'||Array.isArray(response)||
    typeof response.scope!=='string'||response.scope.length>20000)
  fail('RESPONSE_SCHEMA');
 const scopes=response.scope.split(/\s+/).filter(Boolean);
 if(scopes.length===0)fail('RESPONSE_SCHEMA');
 const hasProcessScope=scopes.includes(REQUIRED);
 return {kind:'ISSUE734_PROCESS_SCOPE_AUDIT',
  status:hasProcessScope?'PROCESS_SCOPE_PRESENT':'PROCESS_SCOPE_MISSING',
  hasProcessScope,
  missingScopeRequiresUserAuthorization:!hasProcessScope,
  // Even with the scope, a 403 can mean project access or API configuration.
  processExecutionStatusVerified:false,
  scriptProjectPermissionVerified:false,
  activeWriterRecordsCleared:0,
  approvedForWriterCleanup:false,
  approvedForTradeMigration:false,
  googleReadOnlyRequests:1,
  scriptPropertyWrites:0,financeWrites:0,gasDeployments:0};
}
export async function inspectGoogleProcessScope({token,fetchImpl=fetch}={}){
 if(typeof token!=='string'||token.length<20)fail('TOKEN_INVALID');
 const url=new URL(TOKENINFO);
 url.searchParams.set('access_token',token);
 let response;
 try{response=await fetchImpl(url.toString(),{
  method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{Accept:'application/json'}
 });}catch{fail('NETWORK');}
 if(response?.ok!==true)fail(response?.status===401?'TOKEN_INVALID':'HTTP_UNVERIFIED');
 let body;
 try{body=await response.json();}catch{fail('JSON_UNVERIFIED');}
 return inspectScopeResult(body);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try {
  const token=await fetchGoogleAuditToken({clasprc:process.env.CLASPRC_JSON});
  console.log(JSON.stringify(await inspectGoogleProcessScope({token})));
 }catch(e){
  const message=String(e?.message||'');
  console.error(/^ISSUE734_PROCESS_SCOPE_[A-Z_]+$/.test(message)?
   message:'ISSUE734_PROCESS_SCOPE_UNVERIFIED');
  process.exitCode=2;
 }
}
