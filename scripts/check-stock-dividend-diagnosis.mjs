import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import YAML from 'yaml';
import {runStockDividendDiagnosis} from './run-stock-dividend-diagnosis.mjs';
const ctx=vm.createContext({console,Logger:{log(){throw Error('raw provider logging forbidden');}}});
vm.runInContext(fs.readFileSync('src/gas/apps_script.gs','utf8'),ctx);
const response=(http,body)=>({getResponseCode:()=>http,getContentText:()=>typeof body==='string'?body:JSON.stringify(body)});
const envelope=(items=[],totalCount=items.length,code='00')=>({response:{header:{resultCode:code,resultMsg:'PRIVATE_KEY_OR_RAW_TEXT'},body:{totalCount,items:{item:items}}}});
for(const [http,body,status] of [
  [403,'PRIVATE_HTTP','HTTP_ERROR'],[200,'<xml>PRIVATE</xml>','JSON_INVALID'],
  [200,'<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>PRIVATE_KEY</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>','API_ERROR'],
  [200,envelope([],0,'30'),'API_ERROR'],[200,{response:{}},'RESPONSE_INVALID'],
  [200,envelope(), 'NO_ROWS'],[200,envelope([{x:1}],300),'PARTIAL_PAGE'],[200,envelope([{x:1}]),'OK']
]) {
  const inspected=ctx._inspectPublicDividendResponse(response(http,body));assert.equal(inspected.status,status);
  const diagnostic=JSON.stringify(ctx._publicDividendDiagnostic(inspected));assert.ok(!diagnostic.includes('PRIVATE'));assert.ok(!diagnostic.includes('rows"'));
}
for(const [body,code,name] of [
  ['<OpenAPI_ServiceResponse><returnAuthMsg>SERVICE_ACCESS_DENIED_ERROR PRIVATE_KEY</returnAuthMsg><returnReasonCode>20</returnReasonCode></OpenAPI_ServiceResponse>','20','SERVICE_ACCESS_DENIED_ERROR'],
  [envelope([],0,'30'),'30',''],[envelope([{amount:999}],1,'00'),'00','']
]) {
  const inspected=ctx._inspectPublicDividendResponse(response(403,body));assert.equal(inspected.status,'HTTP_ERROR');
  assert.equal(inspected.providerCode,code);assert.equal(inspected.providerError,name);assert.equal(inspected.rows.length,0);
  assert.ok(!JSON.stringify(ctx._publicDividendDiagnostic(inspected)).includes('PRIVATE_KEY'));
}
const valid={stckIssuCmpyNm:'A',crno:'123',stckGenrDvdnAmt:'100',dvdnBasDt:'20260930',cashDvdnPayDt:'20261020'};
{
  const n={};const result=ctx._normalizePublicDividendRows([valid,valid,{...valid,stckIssuCmpyNm:'B',crno:'456'},
    {...valid,stckGenrDvdnAmt:'0'},{...valid,dvdnBasDt:'',cashDvdnPayDt:''},{...valid,dvdnBasDt:'20251231'}],'111111','A',{crno:'123'},n);
  assert.equal(result.events.length,1);assert.equal(result.perShare,100);
  assert.deepEqual(JSON.parse(JSON.stringify(n)),{inputRows:6,acceptedEvents:1,rejected:{identity:1,amount:1,date:1,beforeRange:1,duplicate:1}});
}
ctx.jsonOk=x=>({status:'ok',...x});ctx.jsonError=message=>({status:'error',message});
{
  const requests=[];ctx.UrlFetchApp={fetchAll:rs=>{requests.push(...rs);return rs.map(r=>
    r.url.includes('getItemInfo')?response(200,envelope([{srtnCd:'111111',itmsNm:'A',crno:'123'}])):response(200,envelope([valid])));}};
  const r=ctx.handleDividendPublicFetch(['111111'],['A'],'PRIVATE_KEY');assert.equal(r.status,'ok');
  assert.equal(r.diagnostics.listed['111111'].status,'OK');assert.equal(r.diagnostics.dividend['111111'].status,'OK');
  assert.equal(r.diagnostics.normalized['111111'].acceptedEvents,1);assert.equal(r.dividends['111111'].perShare,100);
  assert.ok(!JSON.stringify(r.diagnostics).includes('PRIVATE_KEY'));assert.equal(requests.length,2);
  const listedUrl=new URL(requests[0].url);assert.equal(listedUrl.pathname,'/1160100/GetKrxListedInfoService_V2/getItemInfo_V2');
  assert.equal(listedUrl.searchParams.get('likeSrtnCd'),'111111');assert.equal(listedUrl.searchParams.has('srtnCd'),false);
  ctx.UrlFetchApp.fetch=url=>{assert.equal(new URL(url).pathname,listedUrl.pathname);return response(200,envelope([{srtnCd:'111111',itmsNm:'A',crno:'123'}]));};
  assert.equal(ctx._fetchPublicListedInfoByCode('111111','PRIVATE_KEY').name,'A');
}
{
  ctx.UrlFetchApp={fetchAll(){throw Error('PRIVATE_KEY');}};
  const d={};ctx._fetchPublicDividendRowsBatch([{code:'111111',name:'A'}],'PRIVATE_KEY',d);assert.equal(d['111111'].status,'NETWORK_ERROR');
}
const base={status:'ok',dividends:{'111111':{perShare:0,events:[]}},diagnostics:{
  listed:{'111111':{status:'OK',httpStatus:200,providerCode:'00'}},
  dividend:{'111111':{status:'API_ERROR',httpStatus:200,providerCode:'30'}},retry:{},
  normalized:{'111111':{inputRows:0,acceptedEvents:0,rejected:{identity:0,amount:0,date:0,beforeRange:0,duplicate:0}}}}};
async function run(mode='ok') {
  const calls=[];const fetchImpl=async(_u,o)=>{
    const p=new URLSearchParams(o.body),action=p.get('action');calls.push(action);
    assert.ok(['getCodeListReadOnly','dividendPublic'].includes(action),'read-only allowlist');
    let r={status:'ok'};
    if(p.get('accessToken')==='DIVIDEND_BAD_AUTH_PROBE')r.status=mode==='auth'?'ok':'error';
    else if(action==='getCodeListReadOnly') {r.status=mode==='unsupported'||mode.startsWith('catalog-')?'error':'ok';r.message=mode==='catalog-private'?'PRIVATE_KEY':mode.replace('catalog-','');r.gasVersion=mode==='version'?'9.266':'9.269';r.readOnly=mode!=='write-path';r.codes=[{code:'111111',name:'PRIVATE_NAME',assetType:'주식'},{code:'222222',assetType:'ETF'}, {code:'111111',assetType:'주식'}];}
    else if(action==='dividendPublic') {r=structuredClone(base);if(mode==='coverage')delete r.diagnostics.dividend['111111'];if(mode==='status')r.diagnostics.dividend['111111'].status='PRIVATE_KEY';}
    return {ok:true,json:async()=>r};
  };
  return {result:await runStockDividendDiagnosis({url:'https://script.google.com/macros/s/TEST/exec',token:'PRIVATE_KEY',fetchImpl}),calls};
}
const {result,calls}=await run();assert.equal(result.targets,1);assert.equal(result.withoutAcceptedEvents,1);
assert.equal(result.stages.dividend.providerCodes['30'],1);assert.equal(result.originalDataWritten,false);
assert.ok(!/PRIVATE|111111|222222/.test(JSON.stringify(result)));assert.equal(calls.length,3);
for(const mode of ['auth','version','write-path','unsupported','coverage','status']) await assert.rejects(run(mode),/DIVIDEND_DIAG_/);
for(const reason of ['CODE_LIST_READ_ONLY_BUSY','CODE_LIST_READ_ONLY_PENDING','CODE_LIST_READ_ONLY_FAILED'])
  await assert.rejects(run('catalog-'+reason),new RegExp('^Error: DIVIDEND_DIAG_'+reason+'$'));
await assert.rejects(run('catalog-private'),/^Error: DIVIDEND_DIAG_CATALOG$/);
// Execute the actual catalog handler with pending, corrupt, absent and lock-busy states.
// No settlement/identity helpers or financial writers are stubbed into a false read-only success.
for(const mode of ['pending','corrupt','ok','busy','read-failed']) {
  let reads=0,releases=0,writes=0;
  const failWrite=()=>{writes++;throw Error('financial write forbidden');};
  ctx._settlePendingCodeDeleteForRead_=failWrite;ctx._writeCodeDeleteEditablesOnly_=failWrite;ctx._writeSettingsMap=failWrite;
  const rows=[['111111','A','주식','','KRW','KOSPI']];
  ctx.PropertiesService={getScriptProperties:()=>({getProperty:()=>mode==='pending'?'{}':mode==='corrupt'?'not-json':'',setProperty:failWrite,deleteProperty:failWrite})};
  ctx.LockService={getScriptLock:()=>({tryLock:()=>mode!=='busy',releaseLock:()=>releases++})};
  ctx.getss=()=>({getSheetByName:()=>({getLastRow:()=>2,getLastColumn:()=>6,getRange:()=>({getValues:()=>{reads++;if(mode==='read-failed')throw Error('read failed');return rows;},setValues:failWrite}),clearContents:failWrite}),insertSheet:failWrite});
  ctx.Logger={log(){}};
  ctx._isAuthorizedRequest=()=>true;
  const r=ctx.doPost({postData:{contents:'action=getCodeListReadOnly'}});assert.equal(writes,0);assert.equal(releases,mode==='busy'?0:1);
  if(mode==='ok') {assert.equal(r.status,'ok');assert.equal(r.readOnly,true);assert.equal(r.codes.length,1);}
  else {assert.equal(r.status,'error');if(mode!=='read-failed')assert.equal(reads,0);}
}
assert.match(fs.readFileSync('src/gas/apps_script.gs','utf8'),/params\.action === 'getCodeListReadOnly'\)\s+return handleGetCodeListReadOnly\(\)/);
const workflow=YAML.parse(fs.readFileSync('.github/workflows/stock-dividend-diagnosis.yml','utf8'));
assert.equal(workflow.on.schedule,undefined);assert.deepEqual(workflow.permissions,{contents:'read'});
assert.equal(workflow.jobs.diagnose.environment,'portfolio-production-gas');
const steps=workflow.jobs.diagnose.steps;const gate=steps.find(s=>s.id==='gate');
assert.equal(gate.env.APPROVED_PARENT,'406700afe5d0f808e3643b1f94d70ecb94884045');
assert.match(gate.run,/git rev-parse HEAD\^/);assert.match(gate.run,/\|\| exit 0/);
assert.equal(steps.at(-1).run,'node scripts/run-stock-dividend-diagnosis.mjs');
assert.equal(steps.at(-1).if,"steps.gate.outputs.apply == 'true'");
console.log('PASS: actual public provider HTTP/JSON/API/zero/pagination/network classification, filter counts, read-only handler and private-safe operational diagnosis');

// Exercise actual production pagination, not a duplicated implementation.
{
 const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
 function execute(mode='ok',single=false){
  const calls=[];const c=vm.createContext({console,Logger:{log(){throw Error('private log');}}});vm.runInContext(gas,c);
  c.UrlFetchApp={fetchAll:rs=>rs.map(r=>{
   const u=new URL(r.url),page=Number(u.searchParams.get('pageNo'));calls.push(page);
   assert.equal(u.searchParams.get('crno'),'123');assert.equal(u.searchParams.get('serviceKey'),'PRIVATE_KEY');
   if(mode==='network'&&page===2)throw Error('PRIVATE_KEY');
   if(mode==='http'&&page===2)return response(403,'SERVICE_KEY_IS_NOT_REGISTERED_ERROR PRIVATE_KEY');
   if(mode==='invalid'&&page===2)return response(200,'PRIVATE_KEY');
   const rows=page===1||mode==='repeat'?[{...valid,dvdnBasDt:'20260331'},{...valid,dvdnBasDt:'20260630'}]:mode==='empty'?[]:[valid];
   return response(200,envelope(mode==='limit'?[{...valid,dvdnBasDt:String(page)}]:rows,mode==='limit'?100:mode==='changed'&&page===2?4:3));
  })};
  const d={};let rows;
  if(single)rows=c._fetchPublicDividendRows('A','PRIVATE_KEY','123');
  else rows=c._fetchPublicDividendRowsBatch([{code:'111111',name:'A',crno:'123'}],'PRIVATE_KEY',d)['111111'];
  return{rows,d,calls};
 }
 const r=execute();assert.deepEqual(r.calls,[1,2]);assert.equal(r.rows.length,3);assert.equal(r.d['111111'].status,'OK');assert.equal(r.d['111111'].returnedRows,3);
 assert.equal(execute('ok',true).rows.length,3);
 for(const mode of ['network','http','invalid','repeat','empty','changed','limit']){
  const r=execute(mode);assert.equal(r.rows.length,0,mode+' must never produce a financial patch');
  assert.notEqual(r.d['111111'].status,'OK');assert.ok(r.calls.length<=20);assert.ok(!JSON.stringify(r.d).includes('PRIVATE_KEY'));
  assert.throws(()=>execute(mode,true),/PUBLIC_DATA_INCOMPLETE/);
 }
}
console.log('PASS: actual paginated dividend batch/single complete history, failures/repeated/changing/empty pages and bounded requests preserve original data');
