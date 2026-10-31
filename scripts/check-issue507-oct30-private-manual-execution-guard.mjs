import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {PRIVATE_RUN_GAS_FUNCTION}
  from './issue507-oct30-private-manual-execution-guard-proposal.mjs';
import {FROZEN_GAS_BLOB}
  from './issue507-oct30-private-live-readonly-probe-proposal.mjs';

const bytes=fs.readFileSync('src/gas/apps_script.gs');
const blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
assert.equal(blob,FROZEN_GAS_BLOB);
const gas=bytes.toString('utf8');
function production(name){
 const i=gas.indexOf('function '+name+'('),j=gas.indexOf('\n}',i);
 assert.ok(i>=0&&j>i);
 return gas.slice(i,j+2);
}
const commonAuth=production('_isAuthorizedRequest');
const doPost=production('doPost'),doGet=production('doGet');
const gate=production('_issue507GateInvoke_');
// The proposed route is not on the live web application and is not a GAS
// deployment. Explicitly prevent accidental endpoint exposure.
for(const text of [gas,doPost,doGet,gate]){
 assert.ok(!text.includes('_issue507Oct30GuardedPrivateReadOnlyRun_'));
 assert.ok(!text.includes('_issue507Oct30PrivateLiveReadOnlyProof_'));
}
assert.doesNotMatch(PRIVATE_RUN_GAS_FUNCTION,
 /setValues\s*\(|appendRow\s*\(|setProperty\s*\(|deleteRow\s*\(|insertSheet\s*\(|UrlFetchApp/);
assert.ok(!PRIVATE_RUN_GAS_FUNCTION.includes('console.log'));
const now=1793440200000;
const key='q'.repeat(48),legacy='LEGACY_AUTH_NONEMPTY',name='ISSUE507_OCT30_PRIVATE_SOURCE_ONLY';
const opt=proofKey=>({targetDate:'2026-10-30',purpose:name,proofKey});
const validProperties=()=>({
 access_token:legacy,
 issue507_oct30_private_probe_enabled:'true',
 issue507_oct30_private_probe_secret:key,
 issue507_oct30_private_probe_expires_at_ms:String(now+120000)
});
const proofOk=()=>({
 status:'SOURCE_ONLY_PRIVATE_PROOF',date:'2026-10-30',
 officialExactDatePerCodeVerified:37,
 noIndividualQuoteOrCodeDisclosed:true,
 writeAuthorized:false,financialWrites:0,
 // This deliberately tests that only allowlisted summary fields survive.
 fakePrivatePrice:123456789,fakePrivateCode:'000001',secret:key
});
function execute(properties,options,reply=proofOk,clock=now){
 let priceFetchCalls=0,propertiesWritten=0;
 const props={getProperty:k=>properties[k]??'',setProperty:()=>{propertiesWritten++;throw Error('NEVER_WRITE');}};
 const ctx=vm.createContext({
 PropertiesService:{getScriptProperties:()=>props},
 Date:{now:()=>clock},
 _issue507Oct30PrivateLiveReadOnlyProof_:()=>{priceFetchCalls++;return reply();}
 });
 vm.runInContext(commonAuth+'\n'+PRIVATE_RUN_GAS_FUNCTION,ctx,{timeout:1500});
 const out=()=>ctx._issue507Oct30GuardedPrivateReadOnlyRun_(options);
 const oldAuth=token=>ctx._isAuthorizedRequest({accessToken:token});
 return {out,oldAuth,calls:()=>priceFetchCalls,writes:()=>propertiesWritten};
}
// Execute the ACTUAL production common auth behavior to prove the legacy
// absent-token exception is real, and NEVER inherit it for private access.
let a=execute({},opt(key));
assert.equal(a.oldAuth('anything'),true,'frozen production auth accepts absent configured access token');
assert.throws(()=>a.out(),/ISSUE507_OCT30_PRIVATE_EXECUTION_DENIED/);
assert.equal(a.calls(),0);
a=execute(validProperties(),opt(key));
assert.equal(a.oldAuth(legacy),true);
assert.equal(a.oldAuth('WRONG'),false);
const good=a.out();
assert.equal(good.mode,'ISSUE507_OCT30_PRIVATE_MANUAL_ATTESTATION');
assert.equal(good.authenticatedPrivateInvocation,true);
assert.equal(good.officialExactDateProof,true);
assert.equal(good.writeAuthorized,false);
assert.equal(good.releaseAuthorized,false);
assert.equal(good.userApprovedLiveDeployment,false);
assert.equal(a.calls(),1);
assert.equal(a.writes(),0);
const published=JSON.stringify(good);
for(const protectedText of ['000001','123456789',key,legacy,'fakePrivate'])
 assert.ok(!published.includes(protectedText));
let failures=0;
function deny(edit,options=opt(key),body=proofOk,clock=now){
 const props=validProperties();
 edit(props);
 const x=execute(props,options,body,clock);
 assert.throws(()=>x.out(),/ISSUE507_OCT30_PRIVATE_EXECUTION_DENIED/);
 assert.equal(x.writes(),0);
 // None of the auth/activation failures may reach an official KRX call.
 failures++;
 return x.calls();
}
assert.equal(deny(x=>delete x.access_token),0);
assert.equal(deny(x=>x.access_token=''),0);
assert.equal(deny(x=>x.issue507_oct30_private_probe_enabled='false'),0);
assert.equal(deny(x=>x.issue507_oct30_private_probe_enabled='TRUE'),0);
assert.equal(deny(x=>delete x.issue507_oct30_private_probe_secret),0);
assert.equal(deny(x=>x.issue507_oct30_private_probe_secret='short'),0);
assert.equal(deny(x=>x.issue507_oct30_private_probe_secret='z'.repeat(257)),0);
assert.equal(deny(x=>x.issue507_oct30_private_probe_expires_at_ms=''),0);
assert.equal(deny(x=>x.issue507_oct30_private_probe_expires_at_ms='not-a-number'),0);
assert.equal(deny(x=>x.issue507_oct30_private_probe_expires_at_ms=String(now-1)),0);
assert.equal(deny(x=>x.issue507_oct30_private_probe_expires_at_ms=String(now+600001)),0);
assert.equal(deny(x=>{},opt('WRONG')),0);
assert.equal(deny(x=>{},opt(key.slice(0,46))),0);
assert.equal(deny(x=>{},{...opt(key),apply:'1'}),0);
assert.equal(deny(x=>{},{...opt(key),code:'000001'}),0);
assert.equal(deny(x=>{},{...opt(key),targetDate:'2026-10-29'}),0);
assert.equal(deny(x=>{},{...opt(key),purpose:'WRITE_SNAPSHOT'}),0);
assert.equal(deny(x=>{},null),0);
assert.equal(deny(x=>{},[]),0);
assert.equal(deny(x=>{},opt(key),proofOk,now+120001),0);
assert.equal(deny(x=>{x.issue507_oct30_private_probe_expires_at_ms=String(now+120001)},opt(key),proofOk,now+120001),0);
// A valid authenticated execution does not authorize writing, and must
// reject a malformed private proof without returning any private fields.
assert.equal(deny(x=>{},opt(key),()=>({...proofOk(),financialWrites:1})),1);
assert.equal(deny(x=>{},opt(key),()=>({...proofOk(),writeAuthorized:true})),1);
assert.equal(deny(x=>{},opt(key),()=>({...proofOk(),officialExactDatePerCodeVerified:36})),1);
assert.equal(deny(x=>{},opt(key),()=>({...proofOk(),noIndividualQuoteOrCodeDisclosed:false})),1);
assert.equal(deny(x=>{},opt(key),()=>({...proofOk(),status:'BAD'})),1);
assert.equal(deny(x=>{},opt(key),()=>({...proofOk(),date:'2026-10-29'})),1);
console.log(JSON.stringify({
 mode:'ISSUE507_OCT30_PRIVATE_MANUAL_EXECUTION_SECURITY',
 result:'PASS',actualFrozenCommonAuthExecuted:true,
 legacyEmptyTokenVulnerabilityExplicitlyBlocked:true,
 negativeCases:failures,protectedPrivateCallsOnBadCredentials:0,
 noWebRouteInstalled:true,noProductionGasChange:true,
 financialWrites:0,gasDeployed:false,nhTokens:0
}));
