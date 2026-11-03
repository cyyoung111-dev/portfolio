import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {composePerformanceGasCandidate,sourceSha,APPROVED_GAS_V9282_BLOB} from './compose-gas-performance-proposal.mjs';

const gasCandidate=fs.readFileSync('ops/lookup-performance-gas/collector.gs','utf8');
const web=fs.readFileSync('src/web/features/settings/settings_perf_monitor.js','utf8');
const html=fs.readFileSync('src/web/index.html','utf8');
const net=fs.readFileSync('src/web/features/settings/settings_net.js','utf8');
assert.match(gasCandidate,/function handleAppendPerformanceMetrics\(params\)/);
assert.match(gasCandidate,/function handleGetPerformanceSummary\(params\)/);
assert.match(web,/requestGsheetFormJson\('appendPerformanceMetrics'/);
assert.match(web,/requestGsheetFormJson\('getPerformanceSummary'/);
assert.match(net,/window\.PortfolioPerfTelemetry\?\.record\(entry\)/);
assert.match(html,/settings_perf_monitor\.js\?v=/);
assert.doesNotMatch(web,/Cloudflare Worker|PERF_COLLECTOR_URL|https:\/\/.*\/ingest/);

// Minimal spreadsheet mock: writes restricted to dedicated diagnostics sheet.
const sheets=new Map();let inserted=[],locked=false,canLock=true;
function createSheet(name) {
 const rows=[];
 return {
  name,rows,
  getLastRow(){return rows.length;},
  getRange(r,c,n=1,k=1){return {
   setValues(vals){for(let a=0;a<n;a++){const row=rows[r-1+a]||[];for(let b=0;b<k;b++)row[c-1+b]=vals[a][b];rows[r-1+a]=row;}return this;},
   getValues(){return Array.from({length:n},(_,a)=>Array.from({length:k},(_,b)=>rows[r-1+a]?.[c-1+b]??''));}
  };},
  hideSheet(){},
  deleteRows(r,n){rows.splice(r-1,n);}
 };
}
const props={access_token:'a_secure_test_token_abcdefghijklmnopqrstuvwxyz'};
const ss={
 getSheetByName:name=>sheets.get(name)||null,
 insertSheet:name=>{inserted.push(name);const s=createSheet(name);sheets.set(name,s);return s;}
};
const lock={tryLock(){locked=canLock;return canLock;},releaseLock(){locked=false;}};
const context=vm.createContext({
 console,Math,Date,JSON,Object,Array,String,Number,isFinite,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||''})},
 _isAuthorizedRequest:p=>p.accessToken===props.access_token,
 jsonError:m=>({status:'error',message:m}),
 jsonOk:e=>({status:'ok',...e}),
 LockService:{getScriptLock:()=>lock},
 getss:()=>ss,
 Utilities:{formatDate:(date,tz,fmt)=>{
   assert.equal(tz,'Asia/Seoul');
   const kr=new Date(date.getTime()+9*3600000).toISOString();
   return kr.slice(0,10)+' '+kr.slice(11,19);
 }}
});
vm.runInContext(gasCandidate,context);
const call=(name,params)=>vm.runInContext(name+'(__params)',Object.assign(context,{__params:params}));
const valid={accessToken:props.access_token,data:JSON.stringify({version:1,device:'mobile',
 samples:[{stage:'price.poll-total',ms:1000,result:'ok'},
 {stage:'price.poll-total',ms:2000,result:'ok'},
 {stage:'price.poll-total',ms:3000,result:'error'}]})};
assert.equal(call('handleAppendPerformanceMetrics',{...valid,accessToken:'wrong'}).message,'PERF_AUTH_REQUIRED');
delete props.access_token;
assert.equal(call('handleAppendPerformanceMetrics',valid).message,'PERF_AUTH_REQUIRED','legacy unauthenticated GAS must fail closed');
props.access_token='a_secure_test_token_abcdefghijklmnopqrstuvwxyz';
assert.equal(inserted.length,0);
const invalid={...valid,data:JSON.stringify({version:1,device:'mobile',samples:[{stage:'price.poll-total',ms:10,result:'ok',account:'secret'}]})};
assert.equal(call('handleAppendPerformanceMetrics',invalid).message,'PERF_INVALID_PAYLOAD');
assert.equal(inserted.length,0);
canLock=false;
assert.equal(call('handleAppendPerformanceMetrics',valid).message,'PERF_LOW_PRIORITY_BUSY');
canLock=true;
assert.deepEqual(call('handleAppendPerformanceMetrics',valid),{status:'ok',accepted:3});
assert.deepEqual(inserted,['PERFORMANCE_LOG']);
const sheet=sheets.get('PERFORMANCE_LOG');
assert.deepEqual(sheet.rows[0],['observed_at_kst','device','stage','elapsed_ms','result']);
assert.equal(sheet.rows.length,4);
const result=call('handleGetPerformanceSummary',{accessToken:props.access_token});
assert.equal(result.status,'ok');
assert.equal(result.enabled,true);
assert.equal(result.sampleCount,3);
assert.equal(result.groups[0].medianMs,2000);
assert.equal(result.groups[0].p95Ms,3000);
assert.equal(result.groups[0].failureRatePct,33.3);
assert.equal(Object.keys(result.groups[0]).includes('account'),false);
// Native Sheets can coerce timestamp cells to Date objects.
const originalStamp=sheet.rows[1][0];
sheet.rows[1][0]=new Date();
assert.equal(call('handleGetPerformanceSummary',{accessToken:props.access_token}).sampleCount,3);
sheet.rows[1][0]=originalStamp;
// Existing sheet with unexpected header must be rejected, never overwritten.
const before=sheet.rows[0][0];sheet.rows[0][0]='foreign';
assert.equal(call('handleAppendPerformanceMetrics',valid).message,'PERF_COLLECTOR_UNAVAILABLE');
assert.equal(sheet.rows[0][0],'foreign');sheet.rows[0][0]=before;
assert.equal(sheets.size,1,'must never access or mutate holdings, ledger or snapshot');

// Client mock: no remote reporting without opt-in and GAS support check.
let consent=new Map(),generation=1,connected='https://script.google.com/macros/s/test/exec',callCount=0;
let resolveDelayed=null, delayProbe=false, resolveProbe=null;
const pending=[],requests=[];
const storage={
 getItem:k=>consent.get(k)??null,
 setItem:(k,v)=>{consent.set(k,String(v));},
 removeItem:k=>{consent.delete(k);}
};
const elements={
 perfGasStatus:{textContent:''},
 perfGasSummaryBody:{textContent:'',replaceChildren(){}}
};
const handlers={};
const window={
 matchMedia:()=>({matches:true}),addEventListener:(n,fn)=>handlers[n]=fn,
 PortfolioPerfTelemetry:null
};
const document={
 getElementById:id=>elements[id]||null,
 addEventListener:(n,fn)=>handlers[n]=fn,
 createElement:tag=>({textContent:'',style:{},appendChild(){},replaceChildren(){}})
};
const webCtx=vm.createContext({
 window,document,localStorage:storage, navigator:{userAgentData:{mobile:true}},
 GSHEET_API_URL:connected,
 getGsheetAccessToken:()=>props.access_token,
 getGsheetConnectionGeneration:()=>generation,
 requestGsheetFormJson:async(action,data,opts)=>{
  callCount++;
  requests.push({action,data,opts});
  assert.equal(opts.targetUrl,connected);
  if(action==='getPerformanceSummary'){
    if(delayProbe) await new Promise(resolve=>{resolveProbe=resolve;});
    return {status:'ok',enabled:true,groups:[],sampleCount:0};
  }
  if(resolveDelayed){return await new Promise(resolve=>{pending.push(resolve)})}
  return {status:'ok',accepted:JSON.parse(data.data).samples.length};
 },
 setTimeout:()=>1234,clearTimeout:()=>{},Date,Math,Set,Object,JSON,
 String,Number,Array
});
vm.runInContext(web,webCtx);
assert.equal(consent.has('pf_perf_gas_consent_v1'),false);
window.PortfolioPerfTelemetry.record({stage:'price.poll-total',ms:1234,result:'ok'});
assert.equal(callCount,0,'disabled client never sends');
await handlers.click({target:{closest:()=>({id:'perfGasEnable'})}});
assert.equal(consent.get('pf_perf_gas_consent_v1'),'1');
for(let i=0;i<10;i++)window.PortfolioPerfTelemetry.record({stage:'price.poll-total',ms:100+i,result:'ok'});
const first=await window.PortfolioPerfTelemetry.flush();
assert.equal(first,true);
const second=await window.PortfolioPerfTelemetry.flush();
assert.equal(second,true);
assert.equal(callCount,3,'one probe plus 2 batches');
await handlers.click({target:{closest:()=>({id:'perfGasStop'})}});
assert.equal(consent.get('pf_perf_gas_consent_v1'),'0');
assert.equal(window.PortfolioPerfTelemetry.enabled(),false);
// If the user revokes consent before the GAS support probe completes,
// the delayed success must NEVER silently re-enable collection.
delayProbe=true;
const probing=handlers.click({target:{closest:()=>({id:'perfGasEnable'})}});
await Promise.resolve();
assert.equal(typeof resolveProbe,'function');
await handlers.click({target:{closest:()=>({id:'perfGasStop'})}});
resolveProbe();
await probing;
assert.equal(window.PortfolioPerfTelemetry.enabled(),false,'stopped probe must not resurrect consent');
delayProbe=false;
// Re-enable and queue one old-GAS sample, then change connection before flush.
await handlers.click({target:{closest:()=>({id:'perfGasEnable'})}});
window.PortfolioPerfTelemetry.record({stage:'price.poll-total',ms:111,result:'ok'});
const callsBeforeSwitch=callCount;
connected='https://script.google.com/macros/s/another/exec';
webCtx.GSHEET_API_URL=connected;
generation++;
assert.equal(await window.PortfolioPerfTelemetry.flush(),false,
 'switching GAS must drop queued samples instead of sending them to new workbook');
assert.equal(callCount,callsBeforeSwitch);
assert.equal(window.PortfolioPerfTelemetry.enabled(),false,
 'changed workbook must require fresh per-device opt-in');
await handlers.click({target:{closest:()=>({id:'perfGasEnable'})}});
window.PortfolioPerfTelemetry.record({stage:'price.poll-total',ms:222,result:'ok'});
assert.equal(await window.PortfolioPerfTelemetry.flush(),true);
const uploaded=JSON.parse(requests.at(-1).data.data);
assert.equal(uploaded.samples.length,1);
assert.equal(uploaded.samples[0].ms,222,'only newly consented workbook sample may be sent');
assert.doesNotMatch(web,/PERFORMANCE_LOG\W+(?:getRange|appendRow)/,
 'client must not write Sheet directly');
console.log('PASS: GAS token fail-closed, separate sheet, cap/schema, aggregate p50/p95, opt-in and 8-row batching');


// Execute the ACTUAL v9.282 doGet/doPost and authentication with the
// proposed collector, but without changing production source or remote GAS.
{
  const approved=fs.readFileSync('src/gas/apps_script.gs','utf8');
  assert.equal(sourceSha(approved),APPROVED_GAS_V9282_BLOB);
  const proposal=composePerformanceGasCandidate(approved,gasCandidate);
  assert.equal(proposal.deployable,false);
  assert.equal(proposal.financialWriteApproved,false);
  assert.equal(proposal.productionSourceChanged,false);
  assert.equal(sourceSha(approved),APPROVED_GAS_V9282_BLOB,
    'source-only preparation cannot alter approved GAS blob');
  assert.throws(()=>composePerformanceGasCandidate(approved+' ',gasCandidate),
    /PERF_COMPOSE_BASE_UNAPPROVED/);
  assert.throws(()=>composePerformanceGasCandidate(approved,gasCandidate.replace(
    'function handleAppendPerformanceMetrics(params)','function changedMetrics(params)')),
    /PERF_COMPOSE_COLLECTOR_INVALID/);
  function extract(name){
    const start=proposal.source.indexOf('function '+name+'(');
    assert.ok(start>=0,'missing production function: '+name);
    const end=proposal.source.indexOf('\n}',start);
    assert.ok(end>start,'missing closing declaration: '+name);
    return proposal.source.slice(start,end+2);
  }
  const routes=[
    '_isAuthorizedRequest','doGet','doPost','jsonOk','jsonError'
  ].map(extract).join('\n\n');
  const testToken='valid_gas_telemetry_access_token_20261103';
  const properties={access_token:testToken};
  const created=[];
  const routeSheets=new Map();
  const spreadsheet={
    getSheetByName:n=>routeSheets.get(n)||null,
    insertSheet:n=>{
      created.push(n);const sh=createSheet(n);routeSheets.set(n,sh);return sh;
    }
  };
  const routeCtx=vm.createContext({
    console,Math,Date,JSON,Object,Array,String,Number,isFinite,
    _issue507GateInside_:true, // approved gate's inner routing; never live calls
    PropertiesService:{getScriptProperties:()=>({
      getProperty:k=>properties[k]||null,
      setProperty:()=>{throw Error('PROPERTIES_WRITE_DENIED');}
    })},
    ContentService:{MimeType:{JSON:'application/json'},
      createTextOutput:text=>({getContent:()=>text,setMimeType(){return this;}})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
    getss:()=>spreadsheet,
    Utilities:{formatDate:(d,tz)=>{
      assert.equal(tz,'Asia/Seoul');
      const x=new Date(d.getTime()+9*3600000).toISOString();
      return x.slice(0,10)+' '+x.slice(11,19);
    }}
  });
  new vm.Script(routes+'\n'+gasCandidate,{
    filename:'approved-v9282-real-routes-with-perf-module.gs'
  }).runInContext(routeCtx);
  const request=(action,token,data,method='POST')=>{
    const fields={action};
    if(token!==null)fields.accessToken=token;
    if(data!==undefined)fields.data=JSON.stringify(data);
    const event=method==='GET'?{parameter:fields}
      :{postData:{contents:new URLSearchParams(fields).toString()}};
    const response=method==='GET'?routeCtx.doGet(event):routeCtx.doPost(event);
    return JSON.parse(response.getContent());
  };
  const metrics={version:1,device:'desktop',samples:[
    {stage:'price.poll-total',ms:1191,result:'ok'},
    {stage:'price.poll-render',ms:165,result:'ok'}
  ]};
  assert.equal(request('appendPerformanceMetrics',null,metrics).status,'error');
  assert.equal(request('appendPerformanceMetrics','wrong',metrics).status,'error');
  assert.equal(request('appendPerformanceMetrics',testToken,metrics,'GET').message,'POST_ONLY');
  assert.equal(request('getPerformanceSummary',testToken,undefined,'GET').message,'POST_ONLY');
  assert.deepEqual(created,[],'GET and unauthenticated calls must not create sheet');
  assert.equal(request('appendPerformanceMetrics',testToken,metrics).status,'ok');
  assert.deepEqual(created,['PERFORMANCE_LOG'],
    'real POST must write only the dedicated diagnostic sheet');
  const summary=request('getPerformanceSummary',testToken);
  assert.equal(summary.status,'ok');
  assert.equal(summary.sampleCount,2);
  assert.ok(summary.groups.some(x=>x.stage==='price.poll-total'&&x.medianMs===1191));
  const before=routeSheets.get('PERFORMANCE_LOG').rows.length;
  delete properties.access_token;
  const noToken=request('appendPerformanceMetrics',null,metrics);
  assert.equal(noToken.message,'PERF_AUTH_REQUIRED',
    'legacy anonymous GAS compatibility must still deny telemetry writes');
  assert.equal(routeSheets.get('PERFORMANCE_LOG').rows.length,before);

  // Exercise the FULL v9.282 source candidate and actual writer gate.
  const protectedProperties=new Map([['access_token',testToken]]);
  const propertiesApi={
    getProperty:k=>protectedProperties.get(k)||null,
    getProperties:()=>Object.fromEntries(protectedProperties),
    setProperty:(k,v)=>{protectedProperties.set(k,v);},
    deleteProperty:k=>{protectedProperties.delete(k);}
  };
  let held=false,seq=0;
  const scriptLock={
    hasLock:()=>held,
    waitLock:()=>{if(held)throw Error('SYNTHETIC_LOCK_BUSY');held=true;},
    tryLock:()=>{if(held)return false;held=true;return true;},
    releaseLock:()=>{held=false;}
  };
  const protectedSheets=new Map(),protectedWrites=[];
  const protectedWorkbook={
    getSheetByName:n=>protectedSheets.get(n)||null,
    insertSheet:n=>{protectedWrites.push('insert:'+n);
      const sh=createSheet(n);protectedSheets.set(n,sh);return sh;}
  };
  const fullCtx=vm.createContext({
    console,Date,Math,JSON,Object,Array,String,Number,isFinite,
    PropertiesService:{getScriptProperties:()=>propertiesApi},
    LockService:{getScriptLock:()=>scriptLock},
    SpreadsheetApp:{getActiveSpreadsheet:()=>protectedWorkbook},
    Utilities:{
      getUuid:()=> 'perf-gate-'+(++seq),
      formatDate:(date,tz)=>{
        assert.equal(tz,'Asia/Seoul');
        const d=new Date(date.getTime()+9*3600000).toISOString();
        return d.slice(0,10)+' '+d.slice(11,19);
      }
    },
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:t=>({
      getContent:()=>t,setMimeType(){return this;}
    })}
  });
  vm.runInContext(proposal.source,fullCtx,{
    filename:'approved-gas-v9282-with-performance-proposal.gs'
  });
  assert.equal(fullCtx._issue507GateInside_,false);
  const positive={accessToken:testToken,data:JSON.stringify(metrics)};
  const direct=fullCtx.handleAppendPerformanceMetrics(positive);
  assert.equal(JSON.parse(direct.getContent()).accepted,2);
  assert.deepEqual(protectedWrites,['insert:PERFORMANCE_LOG']);
  let gateState=JSON.parse(protectedProperties.get('issue507_writer_gate_v1'));
  assert.equal(gateState.mode,'OPEN');
  assert.equal(gateState.finished,1,'direct entrypoint has exactly one completion receipt');
  assert.equal(Object.keys(gateState.active).length,0);
  assert.equal(gateState.completed.at(-1).name,'handleAppendPerformanceMetrics');
  assert.equal(fullCtx._issue507GateInside_,false);
  const protectedPost=fullCtx.doPost({postData:{contents:new URLSearchParams({
    action:'appendPerformanceMetrics',accessToken:testToken,
    data:JSON.stringify(metrics)
  }).toString()}});
  assert.equal(JSON.parse(protectedPost.getContent()).accepted,2);
  gateState=JSON.parse(protectedProperties.get('issue507_writer_gate_v1'));
  assert.equal(gateState.finished,2,'doPost wraps nested collector in one gate owner');
  assert.equal(gateState.completed.at(-1).name,'doPost');
  assert.equal(Object.keys(gateState.active).length,0);
  // Maintenance: every new function must reject before touching even PERF.
  const rowsBefore=protectedSheets.get('PERFORMANCE_LOG').rows.length;
  protectedProperties.set('issue507_writer_gate_v1',JSON.stringify({
    ...gateState,mode:'DRAINING',barrierAt:Date.now()
  }));
  const rejected=[
    ['handleAppendPerformanceMetrics',[positive]],
    ['handleGetPerformanceSummary',[{accessToken:testToken}]],
    ['_perfMonitorSheet_',[true]],
    ['_perfMonitorAuthorized_',[positive]],
    ['_perfMonitorValidate_',[JSON.stringify(metrics)]],
    ['_perfMonitorTimestamp_',[new Date()]]
  ];
  for(const [name,args] of rejected){
    assert.throws(()=>fullCtx[name](...args),/GATE_MAINTENANCE/,
      'writer gate must block direct '+name+' during DRAINING');
  }
  assert.throws(()=>fullCtx.doPost({postData:{contents:new URLSearchParams({
    action:'appendPerformanceMetrics',accessToken:testToken,
    data:JSON.stringify(metrics)
  }).toString()}}),/GATE_MAINTENANCE/);
  assert.equal(protectedSheets.get('PERFORMANCE_LOG').rows.length,rowsBefore);
  assert.deepEqual(protectedWrites,['insert:PERFORMANCE_LOG']);
  assert.equal(fullCtx._issue507GateInside_,false);
  console.log('PASS full v9.282 writer gate: direct/POST admission, terminal receipts and DRAINING denial (no sheet writes)');

  console.log('PASS source-only v9.282 composition + production doGet/doPost auth and POST-only routes');
}
