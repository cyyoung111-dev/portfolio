import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {composeGas9306NavRefreshPreview} from './compose-gas9306-nav-refresh-preview.mjs';
import {probeNhCmeQuoteContract,assessNhCmeQuoteContract} from './nh-cme-quote-proxy-proposal.mjs';

const extension=fs.readFileSync(new URL('./nh-cme-quote-readonly-proposal.gs',import.meta.url),'utf8');
const {candidate:parent,manifest}=composeGas9306NavRefreshPreview();
assert.equal(manifest.version,'9.306');
const route="  if (params.action === 'getNhAuthStatusProxy') return handleGetNhAuthStatusProxy(params);";
assert.equal(parent.split(route).length,2);
assert.doesNotMatch(parent,/handleGetNhCmeQuoteProbe/);
// Compile a local integration sandbox ONLY. This is not a release candidate
// and is deliberately absent from deploy-gas.mjs and the deployment workflow.
const preview=parent.replace(route,()=>route+"\n  if (params.action === 'getNhCmeQuoteProbe') return handleGetNhCmeQuoteProbe(params);")+'\n'+extension;
new vm.Script(preview);
assert.doesNotMatch(fs.readFileSync('scripts/deploy-gas.mjs','utf8'),/nh-cme-quote|handleGetNhCmeQuoteProbe/);
assert.doesNotMatch(fs.readFileSync('.github/workflows/gas-deploy.yml','utf8'),/nh-cme-quote|getNhCmeQuoteProbe/);

const instant=new Date('2026-11-27T17:00:00+09:00'),date='2026-11-27';
const master={source:'NH_PUBLIC_MASTER',quoteVerified:false,asOf:'20261127',
 rows:['ES','NQ','YM','RTY'].map(id=>({id,contract:id+'Z26',exchange:'FCME',expiry:'20261218',leadMonth:true,status:'MASTER_VERIFIED'}))};
const contracts=master.rows.map(({id,contract,exchange,expiry})=>({id,contract,exchange,expiry}));
const input={mode:'contract',date,masterDate:master.asOf,contracts:JSON.stringify(contracts)};
const fakeSecret='TEST_PRIVATE_BEARER_DO_NOT_RETURN';
function simulate({auth=true,cache=true,request=input,httpFailure,invalidIdentity=false,invalidClock=false,invalidDetail=false,network=false}={}){
 const calls=[],sleeps=[];
 class FixedDate extends Date{
  constructor(...args){super(...(args.length?args:[instant.getTime()]));}
  static now(){return instant.getTime();}
 }
 const ctx=vm.createContext({
  Date:FixedDate,_issue507GateInside_:true,_nhProxyAuthenticated_:()=>auth,
  _nhEnabled_:()=>true,_nhCredentials_:()=>({key:'k',secret:'s'}),
  _nhTokenScope_:()=> 'scope',_nhValidTokenRecord_:()=>cache?{token:fakeSecret,expiresAt:instant.getTime()+3600000}:null,
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>{assert.equal(key,'NHPLUG_AUTH_RECORD_V1');return 'cached';}})},
  Utilities:{formatDate:(_d,zone)=>zone==='Asia/Seoul'?date:master.asOf,sleep:ms=>sleeps.push(ms)},
  UrlFetchApp:{fetch:(url,opts)=>{
    const path=new URL(url).pathname,body=JSON.parse(opts.payload).Input_0;
    assert.equal(new URL(url).origin,'https://api.nhplug.com:8443');
    assert.ok(['/gbfuture/quote/v1/current','/gbfuture/quote/v1/symbolDetail'].includes(path));
    assert.deepEqual(Object.keys(body).sort(),['exnm','iem_cd']);
    assert.equal(body.exnm,'FCME');assert.equal(opts.headers.Authorization,'Bearer '+fakeSecret);
    assert.deepEqual(Object.keys(opts.headers),['Authorization']);assert.equal(opts.followRedirects,false);
    calls.push({path,code:body.iem_cd});
    if(network)throw Error('PRIVATE_UPSTREAM_TEXT');
    const code=httpFailure&&calls.length===httpFailure.at?httpFailure.status:200;
    const row=path.endsWith('/current')?
      {exnm:'FCME',iem_cd:invalidIdentity?'MESZ26':body.iem_cd,last:7010,pcls:7000,
       bday:'20261127',tdtm:invalidClock?'246000':'030000',cur:'USD',pind:'2',secret:fakeSecret}
      :{exnm:'FCME',iem_cd:body.iem_cd,cur1:'USD',zymd:invalidDetail?'20261219':'20261218',
        oymd:'20261126',cymd:'20261127',uymd:'20261127',uhms:'030000000000',
        frhm:'170000000000',tohm:'160000000000',adjv:1,secret:fakeSecret};
    return {getResponseCode:()=>code,getContentText:()=>JSON.stringify({Output_0:row,secret:fakeSecret})};
  }},jsonError:message=>({status:'error',message}),jsonOk:out=>({status:'ok',...out})
 });
 vm.runInContext(extension,ctx);
 const result=JSON.parse(JSON.stringify(ctx.handleGetNhCmeQuoteProbe(request)));
 assert.doesNotMatch(JSON.stringify(result),/TEST_PRIVATE|PRIVATE_UPSTREAM/);
 return {result,calls,sleeps};
}
const good=simulate();
assert.equal(good.calls.length,8);
assert.deepEqual(good.calls.map(x=>x.code),contracts.flatMap(x=>[x.contract,x.contract]));
assert.deepEqual(good.sleeps,Array(7).fill(1000));
assert.equal(good.result.liveQuotesVerified,false);
const report=assessNhCmeQuoteContract(good.result,master,date);
assert.equal(report.shapeVerified,4);assert.equal(report.financialWrites,0);
assert.equal(report.clockTimezoneVerified,false);assert.equal(report.priceScaleVerified,false);
for(const args of [{auth:false},{cache:false},{request:{...input,masterDate:'20261126'}},
 {request:{...input,contracts:JSON.stringify([{...contracts[0],contract:'MESZ26'},...contracts.slice(1)])}}]){
 const bad=simulate(args);assert.equal(bad.calls.length,0);assert.equal(bad.result.status,'error');
}
for(const status of [401,403,429]){
 const bad=simulate({httpFailure:{at:3,status}});
 assert.equal(bad.calls.length,3);assert.equal(bad.result.stopped,'HTTP_'+status);
 assert.equal(assessNhCmeQuoteContract(bad.result,master,date).shapeVerified,1);
}
const net=simulate({network:true});assert.equal(net.calls.length,1);assert.equal(net.result.stopped,'NETWORK_UNVERIFIED');
for(const args of [{invalidIdentity:true},{invalidClock:true},{invalidDetail:true}]){
 const bad=simulate(args);assert.equal(assessNhCmeQuoteContract(bad.result,master,date).shapeVerified,0);
}
for(const bad of [{...good.result,bearerExposed:true},{...good.result,liveQuotesVerified:true},
 {...good.result,secret:fakeSecret},{...good.result,date:'2026-11-26'},
 {...good.result,results:[{...good.result.results[0],contract:'MESZ26'},...good.result.results.slice(1)]}]){
 assert.throws(()=>assessNhCmeQuoteContract(bad,master,date),/NH_CME_PROBE_RESPONSE_UNVERIFIED/);
}
let posts=0;
const throughProxy=await probeNhCmeQuoteContract({url:'https://script.google.com/macros/s/EXAMPLE/exec',
 token:'TEST_GAS_ACCESS_TOKEN',now:instant,masterReader:async()=>master,fetchImpl:async(url,opts)=>{
  posts++;assert.equal(new URL(url).hostname,'script.google.com');
  assert.equal(opts.method,'POST');assert.equal(opts.body.get('action'),'getNhCmeQuoteProbe');
  assert.deepEqual(JSON.parse(opts.body.get('contracts')),contracts);
  assert.equal(opts.body.get('masterDate'),'20261127');
  return {ok:true,json:async()=>simulate({request:Object.fromEntries(opts.body)}).result};
 }});
assert.equal(posts,1);assert.equal(throughProxy.shapeVerified,4);assert.equal(throughProxy.liveQuotesVerified,false);
await assert.rejects(()=>probeNhCmeQuoteContract({url:'https://script.google.com/macros/s/EXAMPLE/exec',
 token:'TEST_GAS_ACCESS_TOKEN',now:instant,masterReader:async()=>({...master,rows:master.rows.slice(0,3)}),
 fetchImpl:async()=>assert.fail('incomplete master must not call GAS')}),/NH_CME_MASTER_UNVERIFIED/);
console.log('NH_CME_CENTRAL_SOURCE_PREVIEW_PASS master -> authenticated cached-token quote/detail -> validated contract; timezone/scale/live source NOT verified');
