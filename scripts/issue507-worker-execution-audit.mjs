#!/usr/bin/env node
// #507: Apps Script processes.listScriptProcesses READ ONLY, independently
// testing whether the time-driven GAS worker has ever run. No script.execute,
// ScriptProperties changes, Sheet writes or deployment API mutations.
import assert from 'node:assert/strict';
import {parseClaspCredentials} from './deploy-gas.mjs';

const FUNCTION='runPendingTradeSnapshotRebuild';
const STATES=new Set(['PROCESS_STATUS_UNSPECIFIED','RUNNING','PAUSED','COMPLETED',
  'CANCELED','FAILED','TIMED_OUT','UNKNOWN','DELAYED']);
const TIME=/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/;
export function summarizeProcesses(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload)
    ||!Array.isArray(payload.processes)||payload.processes.length>50)
    throw Error('ISSUE507_PROCESS_SCHEMA');
  const rows=payload.processes.filter(x=>x?.functionName===FUNCTION).map(x=>{
    if(!STATES.has(x.processStatus)||typeof x.startTime!=='string'
      ||!TIME.test(x.startTime)||!Number.isFinite(Date.parse(x.startTime))
      ||!['TIME_DRIVEN','TRIGGER','EDITOR','EXECUTION_API'].includes(x.processType))
      throw Error('ISSUE507_PROCESS_RECORD');
    return {at:new Date(x.startTime).toISOString(),
      status:x.processStatus,type:x.processType};
  }).sort((a,b)=>b.at.localeCompare(a.at));
  return {mode:'GOOGLE_APPS_SCRIPT_PROCESS_AUDIT_READ_ONLY',
    function:FUNCTION,processCount:rows.length,
    latest:rows[0]||null,states:Object.fromEntries([...STATES].filter(state=>
      rows.some(x=>x.status===state)).map(state=>[state,rows.filter(x=>x.status===state).length])),
    // Execution results are independently proven by the API, but the mere
    // absence of results is NOT evidence a time trigger was never invoked:
    // the OAuth account may not have visibility of the trigger owner's runs.
    absenceProvesNoExecution:false};
}
// Decode credentials locally and return *only static classifications*.
// Never include the JSON, parser error text, OAuth tokens, or secret fragments
// in public Actions logs. Keep the parser in deploy-gas.mjs authoritative.
export function parseAuditClaspCredentials(value){
  if(typeof value!=='string'||!value.trim())
    throw Error('ISSUE507_CLASP_SECRET_MISSING');
  let decoded;
  try{decoded=JSON.parse(value);}
  catch{throw Error('ISSUE507_CLASP_JSON_INVALID');}
  if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))
    throw Error('ISSUE507_CLASP_FIELDS_MISSING');
  try{return parseClaspCredentials(value);}
  catch(error){
    // This parser message is a controlled constant, not user text.
    // Never forward any other parser message; it could expose secrets.
    if(error?.message==='CLASPRC_JSON에 여러 clasp 사용자 토큰이 있습니다. default 사용자로 clasp login하거나 default 항목만 포함해 저장하세요.')
      throw Error('ISSUE507_CLASP_ACCOUNT_AMBIGUOUS');
    throw Error('ISSUE507_CLASP_FIELDS_MISSING');
  }
}
export async function audit({credentials,scriptId,fetchImpl=fetch}){
  if(!scriptId||!/^[a-zA-Z0-9_-]{15,}$/.test(scriptId))
    throw Error('ISSUE507_CONFIG_MISSING');
  const {clientId,clientSecret,refreshToken}=parseAuditClaspCredentials(credentials);
  let response;
  try {
    response=await fetchImpl('https://oauth2.googleapis.com/token',{
      method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,
        refresh_token:refreshToken,grant_type:'refresh_token'}),
      signal:AbortSignal.timeout(30000)});
  }catch{throw Error('ISSUE507_OAUTH_NETWORK');}
  if(!response.ok)throw Error('ISSUE507_OAUTH_REJECTED');
  let token;
  try{token=(await response.json()).access_token;}catch{throw Error('ISSUE507_OAUTH_JSON');}
  if(typeof token!=='string'||!token)throw Error('ISSUE507_OAUTH_TOKEN_MISSING');
  const url=new URL('https://script.googleapis.com/v1/processes:listScriptProcesses');
  url.searchParams.set('scriptId',scriptId);
  url.searchParams.set('scriptProcessFilter.functionName',FUNCTION);
  url.searchParams.set('pageSize','50');
  let processResponse;
  try{processResponse=await fetchImpl(url.toString(),{
    headers:{authorization:'Bearer '+token},redirect:'error',
    signal:AbortSignal.timeout(60000)});}catch{throw Error('ISSUE507_PROCESS_NETWORK');}
  if(processResponse.status===403)return{mode:'GOOGLE_APPS_SCRIPT_PROCESS_AUDIT_READ_ONLY',
    function:FUNCTION,result:'PROCESS_API_ACCESS_DENIED',
    requiredScope:'https://www.googleapis.com/auth/script.processes',
    workerExecutionVerified:false};
  if(processResponse.status===401)return{mode:'GOOGLE_APPS_SCRIPT_PROCESS_AUDIT_READ_ONLY',
    function:FUNCTION,result:'PROCESS_API_AUTH_REJECTED',workerExecutionVerified:false};
  if(!processResponse.ok)throw Error('ISSUE507_PROCESS_HTTP_'+processResponse.status);
  let raw;
  try{raw=await processResponse.json();}catch{throw Error('ISSUE507_PROCESS_JSON');}
  if(!Array.isArray(raw?.processes))raw={...raw,processes:raw?.processes??[]};
  const summary=summarizeProcesses(raw);
  return {...summary,result:summary.processCount?'PROCESS_EXECUTION_FOUND':'NO_VISIBLE_PROCESS',
    workerExecutionVerified:summary.processCount>0,
    mayHaveMorePages:typeof raw.nextPageToken==='string'&&!!raw.nextPageToken};
}
export function selfTest(){
  const sample={processes:[
    {functionName:FUNCTION,processStatus:'COMPLETED',
      startTime:'2026-10-19T09:00:12Z',processType:'TIME_DRIVEN',
      projectName:'SECRET_INTERNAL_NAME'},
    {functionName:FUNCTION,processStatus:'FAILED',
      startTime:'2026-10-19T08:00:12Z',processType:'TIME_DRIVEN'},
    {functionName:'otherFunction',processStatus:'FAILED',
      startTime:'2026-10-19T08:00:12Z',processType:'TIME_DRIVEN'}
  ]};
  const x=summarizeProcesses(sample);
  assert.equal(x.processCount,2);
  assert.equal(x.latest.status,'COMPLETED');
  assert.equal(x.states.FAILED,1);
  assert.doesNotMatch(JSON.stringify(x),/SECRET_INTERNAL_NAME/);
  assert.deepEqual(summarizeProcesses({processes:[]}).latest,null);
  assert.equal(summarizeProcesses({processes:[]}).absenceProvesNoExecution,false);
  assert.throws(()=>summarizeProcesses({processes:[{...sample.processes[0],processStatus:'SECRET'}]}),/ISSUE507_PROCESS_RECORD/);
  // These are synthetic placeholders, never a real token or account.
  const c={client_id:'FAKE_CLIENT',client_secret:'FAKE_SECRET',refresh_token:'FAKE_REFRESH'};
  assert.deepEqual(parseAuditClaspCredentials(JSON.stringify(c)),{
    clientId:c.client_id,clientSecret:c.client_secret,refreshToken:c.refresh_token});
  assert.deepEqual(parseAuditClaspCredentials(JSON.stringify({tokens:{default:c}})),{
    clientId:c.client_id,clientSecret:c.client_secret,refreshToken:c.refresh_token});
  assert.deepEqual(parseAuditClaspCredentials(JSON.stringify({tokens:{profile:c}})),{
    clientId:c.client_id,clientSecret:c.client_secret,refreshToken:c.refresh_token});
  assert.deepEqual(parseAuditClaspCredentials(JSON.stringify({
    token:{refresh_token:c.refresh_token},
    oauth2ClientSettings:{clientId:c.client_id,clientSecret:c.client_secret}
  })),{clientId:c.client_id,clientSecret:c.client_secret,refreshToken:c.refresh_token});
  assert.throws(()=>parseAuditClaspCredentials(''),/ISSUE507_CLASP_SECRET_MISSING/);
  assert.throws(()=>parseAuditClaspCredentials(undefined),/ISSUE507_CLASP_SECRET_MISSING/);
  assert.throws(()=>parseAuditClaspCredentials('C:\\\\Users\\\\PRIVATE\\\\.clasprc.json'),
    /ISSUE507_CLASP_JSON_INVALID/);
  assert.throws(()=>parseAuditClaspCredentials('{private-refresh-token-should-never-leak'),
    /ISSUE507_CLASP_JSON_INVALID/);
  assert.throws(()=>parseAuditClaspCredentials('null'),/ISSUE507_CLASP_FIELDS_MISSING/);
  assert.throws(()=>parseAuditClaspCredentials('[]'),/ISSUE507_CLASP_FIELDS_MISSING/);
  assert.throws(()=>parseAuditClaspCredentials(JSON.stringify({tokens:{default:{client_id:'fake'}}})),
    /ISSUE507_CLASP_FIELDS_MISSING/);
  assert.throws(()=>parseAuditClaspCredentials(JSON.stringify({
    tokens:{first:c,second:c}})),/ISSUE507_CLASP_ACCOUNT_AMBIGUOUS/);
  const unknown='PRIVATE_DYNAMIC_VALUE_MUST_NOT_BE_PRINTED';
  assert.throws(()=>parseAuditClaspCredentials(JSON.stringify({tokens:{default:{
    client_id:unknown}}})),/ISSUE507_CLASP_FIELDS_MISSING/);
  return{mode:'LOCAL_CONTRACT_TEST',result:'PASS',cases:20};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try {
    const result=process.argv.includes('--self-test')?selfTest():
      await audit({credentials:process.env.CLASPRC_JSON,scriptId:process.env.GAS_SCRIPT_ID});
    console.log(JSON.stringify(result));
  } catch(error) {
    const msg=String(error?.message||'');
    console.error(/^ISSUE507_[A-Z0-9_]+$/.test(msg)?msg:'ISSUE507_AUDIT_UNKNOWN_ERROR');
    process.exitCode=1;
  }
}
