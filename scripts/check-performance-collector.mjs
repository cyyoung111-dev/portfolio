import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

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
