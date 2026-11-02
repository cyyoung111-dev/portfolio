import assert from 'node:assert/strict';
import {prepareMorning} from './telegram-morning-workflow.mjs';
import {fetchNhNightFromGas} from './nh-gas-proxy.mjs';

const DATE='2026-10-30';
const REPO='cyyoung111-dev/portfolio';
const ref={source:'NH',kind:'REFERENCE',tradingDate:DATE,
 contract:'KA016C000',contractMonth:'2026-12',value:900.05,
 clock:'06:00:00',sourceUpdatedAt:DATE+'T06:00:00+09:00',
 receivedAt:DATE+'T07:45:00+09:00',officialClose:false};
const payload='[한국장 장전 종합 브리핑 | '+DATE+']\n'+
 '■ QC: 기준 거래일과 일치한 일봉 1/21 · NH 야선 미확보';
const stamp=x=>()=>new Date(DATE+'T'+x+'+09:00');
function simulated({clock='07:50:00',artifact=null,reference=ref,
  token='GAS_READONLY_TOKEN',gasUrl='https://script.google.com/macros/s/TEST/exec',
  claimExists=false,late=false,recoveryClock=null}={}){
 let claims=0,archives=0,recoveryCalls=0,sent=0,referenceSeen=null;
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
  gasUrl,gasToken:token,
  recoverReference:async (_date,options)=>{
    recoveryCalls++;
    assert.equal(_date,DATE);
    assert.equal(options.url,gasUrl);
    assert.equal(options.token,token);
    assert.equal(typeof options.request,'function');
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
 return {result,observed:()=>({claims,archives,recoveryCalls,sent,referenceSeen})};
}
const recovered=simulated();
const a=await recovered.result;
assert.equal(a.ready,true);
assert.equal(a.referenceSource,'NH');
assert.equal(a.referenceOrigin,'GAS_RECOVERY');
assert.equal(recovered.observed().recoveryCalls,1);
assert.equal(recovered.observed().referenceSeen.value,900.05);
assert.equal(recovered.observed().sent,1);
const earlyValid=simulated({reference:{...ref,receivedAt:DATE+'T06:50:00+09:00'}});
assert.equal((await earlyValid.result).referenceOrigin,'GAS_RECOVERY',
  'a valid 06:45 capture must remain acceptable to 07:40 briefing fallback');
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
 {reference:{...ref,receivedAt:DATE+'T06:44:59+09:00'}}
]){
 const x=simulated(options);
 const y=await x.result;
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
console.log('NH morning recovery: verified 06:00 GAS fallback, time/date/claim guard, no direct OAuth PASS');
