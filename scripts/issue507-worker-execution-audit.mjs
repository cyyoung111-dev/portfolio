#!/usr/bin/env node
// #507: Apps Script processes.listScriptProcesses READ ONLY, independently
// testing whether the time-driven GAS worker has ever run. No script.execute,
// ScriptProperties changes, Sheet writes or deployment API mutations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseClaspCredentials} from './deploy-gas.mjs';

const FUNCTION='runPendingTradeSnapshotRebuild';
const STATES=new Set(['PROCESS_STATUS_UNSPECIFIED','RUNNING','PAUSED','COMPLETED',
  'CANCELED','FAILED','TIMED_OUT','UNKNOWN','DELAYED']);
const TIME=/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/;
// Hourly trigger: allow scheduling jitter, but never equate a visible process
// with successful business work. This is a bounded sample, not a full audit.
export function assessProcessHealth(payload,{now=Date.now()}={}){
  summarizeProcesses(payload); // validate before consuming timestamps/statuses
  if(!Number.isFinite(now)||now<0)throw Error('ISSUE507_OBSERVATION_TIME');
  const rows=payload.processes.filter(x=>x.functionName===FUNCTION
    &&x.processType==='TIME_DRIVEN').sort((a,b)=>Date.parse(b.startTime)-Date.parse(a.startTime));
  const issues=[];
  const latest=rows[0];
  if(!latest)issues.push('NO_VISIBLE_TIME_DRIVEN_PROCESS');
  else if(Date.parse(latest.startTime)>now)issues.push('FUTURE_PROCESS_TIME');
  else if(now-Date.parse(latest.startTime)>3*60*60*1000)issues.push('HOURLY_WORKER_STALE');
  const recent=rows.filter(x=>Date.parse(x.startTime)<=now
    &&now-Date.parse(x.startTime)<=24*60*60*1000);
  const failed=recent.filter(x=>['FAILED','TIMED_OUT','CANCELED'].includes(x.processStatus)).length;
  if(failed)issues.push('RECENT_WORKER_FAILURE');
  if(recent.some(x=>['RUNNING','PAUSED','DELAYED'].includes(x.processStatus)
    &&now-Date.parse(x.startTime)>10*60*1000))issues.push('WORKER_UNFINISHED');
  if(recent.some(x=>['UNKNOWN','PROCESS_STATUS_UNSPECIFIED'].includes(x.processStatus)))
    issues.push('PROCESS_STATUS_UNVERIFIED');
  return {status:issues.length?'ACTION_REQUIRED':'PROCESS_HEALTHY',issues,
    sampledTimeDrivenCount:rows.length,recentFailureCount:failed,
    snapshotIntegrityVerified:false};
}
// Retry only authentication exchange / read-only process listing. Never retry
// scripts.run, deployment, or finance writes. Permanent 4xx fails immediately.
export async function fetchAuditWithRetry(url,options,{fetchImpl=fetch,
  pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(30000)});
      if(response.status!==429&&response.status<500)return response;
      if(attempt===2)return response;
    }catch{if(attempt===2)throw Error('ISSUE507_REQUEST_NETWORK');}
    await pause(1000*2**attempt);
  }
}
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
export async function audit({credentials,scriptId,fetchImpl=fetch,pause,now,clock=Date.now}){
  if(!scriptId||!/^[a-zA-Z0-9_-]{15,}$/.test(scriptId))
    throw Error('ISSUE507_CONFIG_MISSING');
  const {clientId,clientSecret,refreshToken}=parseAuditClaspCredentials(credentials);
  let response;
  try {
    response=await fetchAuditWithRetry('https://oauth2.googleapis.com/token',{
      method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,
        refresh_token:refreshToken,grant_type:'refresh_token'}),
      redirect:'error'},{fetchImpl,pause});
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
  try{processResponse=await fetchAuditWithRetry(url.toString(),{
    headers:{authorization:'Bearer '+token},redirect:'error',
    },{fetchImpl,pause});}catch{throw Error('ISSUE507_PROCESS_NETWORK');}
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
    // Requests/retries can span a new hourly invocation. Observe only after
    // the process response arrives, otherwise a normal new run looks future.
    health:assessProcessHealth(raw,{now:now??clock()}),
    workerExecutionVerified:summary.processCount>0,
    mayHaveMorePages:typeof raw.nextPageToken==='string'&&!!raw.nextPageToken};
}
export async function selfTest(){
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
  const now=Date.parse('2026-10-19T09:30:00Z');
  const health=p=>assessProcessHealth(p,{now});
  assert.equal(health(sample).status,'ACTION_REQUIRED');
  assert.equal(health({processes:[sample.processes[0]]}).status,'PROCESS_HEALTHY');
  assert.deepEqual(health({processes:[]}).issues,['NO_VISIBLE_TIME_DRIVEN_PROCESS']);
  const record=(status,time,type='TIME_DRIVEN')=>({...sample.processes[0],
    processStatus:status,startTime:time,processType:type});
  assert.ok(health({processes:[record('COMPLETED','2026-10-19T05:00:00Z')]}).issues.includes('HOURLY_WORKER_STALE'));
  assert.ok(health({processes:[record('COMPLETED','2026-10-19T09:31:00Z')]}).issues.includes('FUTURE_PROCESS_TIME'));
  assert.ok(health({processes:[record('RUNNING','2026-10-19T09:00:00Z')]}).issues.includes('WORKER_UNFINISHED'));
  assert.equal(health({processes:[record('RUNNING','2026-10-19T09:25:00Z')]}).status,'PROCESS_HEALTHY');
  assert.ok(health({processes:[record('UNKNOWN','2026-10-19T09:00:00Z')]}).issues.includes('PROCESS_STATUS_UNVERIFIED'));
  assert.equal(health({processes:[record('COMPLETED','2026-10-19T09:00:00Z','EDITOR')]}).status,'ACTION_REQUIRED');
  assert.equal(health({processes:[sample.processes[0],record('TIMED_OUT','2026-10-17T09:00:00Z')]}).status,'PROCESS_HEALTHY');
  assert.equal(health({processes:[record('TIMED_OUT','2026-10-19T09:00:00Z')]}).recentFailureCount,1);
  assert.equal(health(sample).snapshotIntegrityVerified,false);
  for(const status of [400,401,403]){
    let calls=0;
    await fetchAuditWithRetry('https://example.invalid',{},
      {fetchImpl:async()=>{calls++;return {status};},pause:async()=>assert.fail('permanent failure retry')});
    assert.equal(calls,1);
  }
  for(const first of [429,500,'network']){
    let calls=0;const waits=[];
    const response=await fetchAuditWithRetry('https://example.invalid',{},
      {fetchImpl:async()=>{calls++;if(calls<3){if(first==='network')throw Error('PRIVATE');
        return {status:first};}return {status:200};},pause:async ms=>waits.push(ms)});
    assert.equal(response.status,200);assert.equal(calls,3);assert.deepEqual(waits,[1000,2000]);
  }
  let exhausted=0;
  await assert.rejects(()=>fetchAuditWithRetry('https://example.invalid',{},
    {fetchImpl:async()=>{exhausted++;throw Error('PRIVATE');},pause:async()=>{}}),
    /^Error: ISSUE507_REQUEST_NETWORK$/);
  assert.equal(exhausted,3);
  const urls=[];
  const live=await audit({credentials:JSON.stringify(c),scriptId:'synthetic_script_id',now,
    fetchImpl:async url=>{urls.push(String(url));return {ok:true,status:200,
      json:async()=>urls.length===1?{access_token:'SYNTHETIC_ACCESS'}:sample};}});
  assert.equal(live.health.status,'ACTION_REQUIRED');
  assert.equal(urls.length,2);assert.match(urls[1],/processes:listScriptProcesses/);
  assert.doesNotMatch(JSON.stringify(live),/SYNTHETIC_ACCESS|FAKE_SECRET|PRIVATE/);
  let responseRead=false,clockCalls=0,requests=0;
  const afterNetwork=await audit({credentials:JSON.stringify(c),scriptId:'synthetic_script_id',
    clock:()=>{clockCalls++;assert.equal(responseRead,true);return now;},
    fetchImpl:async()=>({ok:true,status:200,json:async()=>{
      if(++requests===1)return {access_token:'SYNTHETIC_ACCESS'};
      responseRead=true;return {processes:[sample.processes[0]]};
    }})});
  assert.equal(clockCalls,1);
  assert.equal(afterNetwork.health.status,'PROCESS_HEALTHY');
  return{mode:'LOCAL_CONTRACT_TEST',result:'PASS'};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try {
    const result=process.argv.includes('--self-test')?await selfTest():
      await audit({credentials:process.env.CLASPRC_JSON,scriptId:process.env.GAS_SCRIPT_ID});
    console.log(JSON.stringify(result));
    if(process.argv.includes('--health-check')){
      const status=result.health?.status||'ACTION_REQUIRED';
      const issues=result.health?.issues||[result.result];
      if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        '### GAS hourly worker process health (READ ONLY)\n\n'+status+'\n\n'+
        'Checks: '+(issues.join(', ')||'none')+'\n\n'+
        'Latest 50 visible processes only; Snapshot integrity is not verified.\n');
      if(status!=='PROCESS_HEALTHY')process.exitCode=1;
    }
  } catch(error) {
    const msg=String(error?.message||'');
    console.error(/^ISSUE507_[A-Z0-9_]+$/.test(msg)?msg:'ISSUE507_AUDIT_UNKNOWN_ERROR');
    process.exitCode=1;
  }
}
