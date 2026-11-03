import assert from 'node:assert/strict';
import {prepareMorning} from './telegram-morning-workflow.mjs';
import {fetchNhNightFromGas} from './nh-gas-proxy.mjs';
import {loadPrefetchedNight,collectMorningPrefetch,prefetchAdmission} from './telegram-morning-prefetch.mjs';

const DATE='2026-10-30';
const REPO='cyyoung111-dev/portfolio';
const ref={source:'NH',kind:'REFERENCE',tradingDate:DATE,
 contract:'KA016C000',contractMonth:'2026-12',value:900.05,
 clock:'06:00:00',sourceUpdatedAt:DATE+'T06:00:00+09:00',
 receivedAt:DATE+'T07:45:00+09:00',officialClose:false};
const payload='[한국장 장전 종합 브리핑 | '+DATE+']\n'+
 '■ QC: 기준 거래일과 일치한 일봉 1/21 · 야간선물 미확보';
const stamp=x=>()=>new Date(DATE+'T'+x+'+09:00');
function simulated({clock='07:50:00',artifact=null,prefetch=null,reference=ref,
  token='GAS_READONLY_TOKEN',gasUrl='https://script.google.com/macros/s/TEST/exec',
  claimExists=false,late=false,recoveryClock=null}={}){
 let claims=0,archives=0,recoveryCalls=0,sent=0,referenceSeen=null;
 const recoveryDiagnostics=[];
 const result=prepareMorning({
  now:stamp(clock),
  githubToken:'TEST_GITHUB_READ_TOKEN',repository:REPO,
  mode:late?'late_test':'rescue',
  fetchImpl:async url=>{
    claims++;
    assert.ok(String(url).includes('api.github.com/repos/'));
    return {ok:true,json:async()=>claimExists?
      {total_count:1,artifacts:[{name:'telegram-morning-claim-'+DATE}]}:
      {total_count:0,artifacts:[]}};
  },
  loadReference:async()=>{archives++;return artifact;},
  loadPrefetch:async()=>prefetch,
  gasUrl,gasToken:token,
  onRecoveryDiagnostic:result=>recoveryDiagnostics.push(result),
  recoverReference:async (_date,options)=>{
    recoveryCalls++;
    assert.equal(_date,DATE);
    assert.equal(options.url,gasUrl);
    assert.equal(options.token,token);
    assert.equal(typeof options.request,'function');
    if(reference===null){options.onError('NH_NIGHT_SOURCE_UNAVAILABLE');return null;}
    if(recoveryClock)return {...reference,receivedAt:DATE+'T'+recoveryClock+'+09:00'};
    return reference;
  },
  run:async({referenceFetch,send})=>{
    referenceSeen=await referenceFetch(DATE);
    sent++;
    await send(null,null,payload);
    return {status:referenceSeen?'SENT_REFERENCE':'SENT_SOURCE_MISSING',
      referenceSource:referenceSeen?.source||'NONE'};
  }
 });
 return {result,observed:()=>({claims,archives,recoveryCalls,sent,referenceSeen}),
  diagnostics:()=>recoveryDiagnostics};
}
const recovered=simulated();
const a=await recovered.result;
assert.equal(a.ready,true);
assert.equal(a.referenceSource,'NH');
assert.equal(a.referenceOrigin,'GAS_RECOVERY');
assert.equal(recovered.observed().recoveryCalls,1);
assert.equal(recovered.observed().referenceSeen.value,900.05);
assert.equal(recovered.observed().sent,1);
assert.deepEqual(recovered.diagnostics(),[{status:'VERIFIED',reason:null}]);
// Existing verified prewarm takes precedence over a second GAS recovery.
const prewarmed=simulated({artifact:null,prefetch:ref});
const fromPrefetch=await prewarmed.result;
assert.equal(fromPrefetch.referenceSource,'NH');
assert.equal(fromPrefetch.referenceOrigin,'GAS_PREFETCH_0730');
assert.equal(prewarmed.observed().recoveryCalls,0);
assert.equal(prewarmed.observed().referenceSeen.value,ref.value);
assert.equal((await simulated({artifact:ref,prefetch:{...ref,value:950}}).result).referenceOrigin,
 'CAPTURE_ARTIFACT','earlier verified capture remains primary');

// Reproduce early-arm's 07:20 -> 07:30:15 run without network, token,
// Telegram or financial writes.
const prefectDate='2026-11-03';
const morningEvent={schedule:'20 22 * * 0-4',
 repository:{full_name:'cyyoung111-dev/portfolio'}};
const warmEnv={GITHUB_EVENT_NAME:'schedule',
 GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'cyyoung111-dev/portfolio',
 GITHUB_RUN_ATTEMPT:'1',
 GAS_WEB_APP_URL:'https://script.google.com/macros/s/TEST/exec',
 GAS_ACCESS_TOKEN:'SYNTHETIC_GAS_TOKEN'};
const clockAt=stamp=>new Date(prefectDate+'T'+stamp+'+09:00');
assert.equal(prefetchAdmission({now:clockAt('07:20:00'),env:warmEnv,event:morningEvent}).allowed,true);
assert.equal(prefetchAdmission({now:clockAt('07:39:00'),env:warmEnv,event:morningEvent}).allowed,false);
assert.equal(prefetchAdmission({now:clockAt('07:20:00'),env:{...warmEnv,GITHUB_REF:'refs/heads/test'},event:morningEvent}).allowed,false);
let warmNow=clockAt('07:20:00').getTime(),readRequests=0,fileWritten=null;
const warmReference={...ref,tradingDate:prefectDate,
 sourceUpdatedAt:prefectDate+'T06:00:00+09:00',
 receivedAt:prefectDate+'T07:30:16+09:00'};
const warming=await collectMorningPrefetch({
 now:()=>new Date(warmNow),sleep:async ms=>{warmNow+=ms;},
 env:warmEnv,event:morningEvent,
 requestNight:async(day,opts)=>{
  readRequests++;assert.equal(day,prefectDate);
  assert.equal(opts.token,warmEnv.GAS_ACCESS_TOKEN);
  assert.equal(opts.url,warmEnv.GAS_WEB_APP_URL);
  // Simulate a valid GAS server reception no later than current client clock.
  warmNow=clockAt('07:30:17').getTime();
  return warmReference;
 },
 mkdir:()=>{},writeFile:(path,contents,options)=>{
  assert.equal(path,'.telegram-runtime/nh-night-prefetch.json');
  assert.equal(options.flag,'wx');
  fileWritten=contents;
 }
});
assert.equal(warming.status,'PREFETCH_VERIFIED');
assert.equal(readRequests,1);
assert.ok(fileWritten.length<1600);
const kept=loadPrefetchedNight(prefectDate,{
 now:()=>clockAt('07:40:00'),readFile:()=>fileWritten});
assert.equal(kept.value,ref.value);
for(const bad of [
 {...warmReference,sourceUpdatedAt:prefectDate+'T05:59:00+09:00'},
 {...warmReference,tradingDate:'2026-11-02'},
 {...warmReference,receivedAt:prefectDate+'T07:29:59+09:00'},
 {...warmReference,receivedAt:prefectDate+'T07:40:01+09:00'},
 {...warmReference,unknownPrivateField:'SHOULD_REJECT'}
])assert.equal(loadPrefetchedNight(prefectDate,{
 now:()=>clockAt('07:40:00'),readFile:()=>JSON.stringify(bad)}),null);
assert.equal(loadPrefetchedNight(prefectDate,{
 now:()=>clockAt('08:00:00'),readFile:()=>fileWritten}),null);
assert.equal((await collectMorningPrefetch({
 now:()=>clockAt('07:39:00'),env:warmEnv,event:morningEvent,
 requestNight:async()=>assert.fail('no late warmup')
})).status,'PREFETCH_TOO_LATE_OR_EARLY');
assert.ok(!JSON.stringify(warming).includes('SYNTHETIC_GAS_TOKEN'));

const withArtifact=simulated({artifact:ref});
const art=await withArtifact.result;
assert.equal(art.referenceOrigin,'CAPTURE_ARTIFACT');
assert.equal(withArtifact.observed().recoveryCalls,0);
assert.equal(withArtifact.observed().referenceSeen.value,900.05);
const already=simulated({claimExists:true});
assert.equal((await already.result).status,'ALREADY_CLAIMED');
assert.deepEqual(already.observed(),{claims:1,archives:0,recoveryCalls:0,sent:0,referenceSeen:null});
for(const options of [
 {clock:'08:00:00'},{clock:'08:09:59'},
 {clock:'11:00:00',late:true},
 {gasUrl:''},{token:''},
 {reference:null},
 {reference:{...ref,tradingDate:'2026-10-29'}},
 {reference:{...ref,sourceUpdatedAt:'2026-10-29T06:00:00+09:00'}},
 {reference:{...ref,receivedAt:DATE+'T08:00:00+09:00'}},
 {reference:{...ref,receivedAt:DATE+'T07:29:59+09:00'}}
]){
 const x=simulated(options);
 const y=await x.result;
 if(options.reference===null){
   assert.deepEqual(x.diagnostics(),[{
     status:'NOT_VERIFIED',reason:'NH_NIGHT_SOURCE_UNAVAILABLE'
   }],'recovery source failure is an enum only');
 }
 if(options.reference?.tradingDate==='2026-10-29'){
   assert.deepEqual(x.diagnostics(),[{
     status:'NOT_VERIFIED',reason:'RECOVERY_METADATA_REJECTED'
   }],'wrong date remains rejected and is observable');
 }
 assert.equal(y.referenceSource,'NONE',JSON.stringify(options));
 assert.equal(y.referenceOrigin,'NONE');
 if(options.late)assert.equal(y.mode,'late_test');
 if(options.clock==='08:00:00'||options.clock==='08:09:59'||options.late||options.gasUrl===''||options.token==='')
   assert.equal(x.observed().recoveryCalls,0,'no late/unauthorized GAS recovery');
}
// Verify the real GAS boundary is a single protected read-only POST and never
// requests new NH OAuth or exposes a bearer through the prepared payload.
let gasCalls=0,method='',action='';
const protectedRead=simulated({reference:ref});
const proxy=await fetchNhNightFromGas(DATE,{
  now:stamp('07:50:00'),url:'https://script.google.com/macros/s/TEST/exec',
  token:'GAS_READONLY_TOKEN',request:async (_url,options)=>{
    gasCalls++;
    method=options.method;
    action=options.body.get('action');
    assert.equal(options.body.get('accessToken'),'GAS_READONLY_TOKEN');
    assert.equal(options.body.has('NHPLUG_APP_KEY'),false);
    return {ok:true,json:async()=>({status:'ok',provider:'NH',readOnly:true,
      bearerExposed:false,reference:ref})};
  }
});
assert.equal(proxy.value,900.05);
assert.equal(gasCalls,1);
assert.equal(method,'POST');
assert.equal(action,'getNhNightProxy');
assert.equal((await protectedRead.result).referenceOrigin,'GAS_RECOVERY');
assert.ok(!JSON.stringify(await recovered.result).includes('GAS_READONLY_TOKEN'));
assert.ok(!JSON.stringify(recovered.diagnostics()).includes('900.05'),
 'privacy: recovery diagnostics never print NH quote values');
console.log('NH morning recovery: verified 06:00 GAS fallback, time/date/claim guard, no direct OAuth PASS');
