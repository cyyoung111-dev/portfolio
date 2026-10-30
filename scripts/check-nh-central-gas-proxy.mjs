import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {validateGasEndpoint,fetchNhNightFromGas} from './nh-gas-proxy.mjs';
import {runCentralNhDiagnostic} from './nh-central-diagnostic.mjs';
import {captureMorning} from './nh-morning-capture.mjs';
const url='https://script.google.com/macros/s/EXAMPLE123456/exec', token='TEST-GAS-ACCESS-TOKEN';
for(const bad of ['http://script.google.com/macros/s/TEST/exec',
 'https://evil.example.com/macros/s/TEST/exec',
 'https://script.google.com/macros/s/TEST/exec?token=abc'])
 assert.throws(()=>validateGasEndpoint(bad),/NH_PROXY_CONFIG/);
assert.equal(validateGasEndpoint(url),url);
const now=()=>new Date('2026-10-30T07:35:00+09:00');
const ref={source:'NH',kind:'REFERENCE',tradingDate:'2026-10-30',
 contract:'KA016C000',contractMonth:'2026-12',value:351.5,
 clock:'06:00:00',sourceUpdatedAt:'2026-10-30T06:00:00+09:00',
 receivedAt:'2026-10-30T07:34:59+09:00',officialClose:false};
let calls=0;
const request=async(target,options)=>{
 calls++;
 assert.equal(target,url);assert.equal(options.method,'POST');
 const data=new URLSearchParams(options.body);
 assert.equal(data.get('accessToken'),token);
 assert.ok(!data.has('appkey')&&!data.has('appsecretkey'));
 return {ok:true,json:async()=>data.get('action')==='getNhAuthStatusProxy'
  ?{status:'ok',provider:'NH',readOnly:true,enabled:true,tokenCached:true,tokenIssued:false,gasVersion:'9.278'}
  :{status:'ok',provider:'NH',readOnly:true,bearerExposed:false,reference:ref}};
};
const result=await fetchNhNightFromGas('2026-10-30',{now,url,token,request});
assert.equal(result.value,351.5);assert.equal(result.officialClose,false);
assert.equal(await fetchNhNightFromGas('2026-10-29',{now,url,token,request}),null);
assert.equal(calls,1);
const invalid=await fetchNhNightFromGas('2026-10-30',{now,url,token,request:async()=>({
 ok:true,json:async()=>({status:'ok',provider:'NH',readOnly:true,bearerExposed:false,
 reference:{...ref,clock:'05:59:59'}})})});
assert.equal(invalid,null);
const cap=await captureMorning({now,fetchNight:async()=>result});
assert.equal(cap.status,'CAPTURED');
const logs=[];
assert.equal(await runCentralNhDiagnostic({mode:'status',now,url,token,request,
 log:x=>logs.push(x)}),true);
assert.match(logs.join('\n'),/NO_NH_OAUTH_REQUEST/);
assert.doesNotMatch(logs.join('\n'),/TEST-GAS-ACCESS-TOKEN|Bearer|351/);
assert.equal(await runCentralNhDiagnostic({mode:'night',now,url,token,request,
 log:x=>logs.push(x)}),true);
await assert.rejects(runCentralNhDiagnostic({mode:'combined',url,token,request}),
 /NH_PROXY_MODE_NOT_SUPPORTED/);
await assert.rejects(runCentralNhDiagnostic({mode:'night',now:()=>new Date('2026-10-30T09:00:00+09:00'),
 url,token,request}),/NH_PROXY_NIGHT_WINDOW/);
const captureWorkflow=YAML.parse(fs.readFileSync('.github/workflows/nh-night-capture.yml','utf8'));
assert.equal(captureWorkflow.jobs.capture.environment,'portfolio-production-gas');
const step=captureWorkflow.jobs.capture.steps.find(x=>x.id==='capture');
assert.equal(step.env.GAS_WEB_APP_URL,'$'+'{{ vars.GAS_WEB_APP_URL }}');
assert.equal(step.env.GAS_ACCESS_TOKEN,'$'+'{{ secrets.GAS_ACCESS_TOKEN }}');
assert.equal(step.env.NHPLUG_APP_KEY,undefined);
assert.equal(step.env.NHPLUG_APP_SECRET,undefined);
const diag=YAML.parse(fs.readFileSync('.github/workflows/nhplug-readonly-diagnostic.yml','utf8'));
assert.equal(diag.jobs.readonly.environment,'portfolio-production-gas');
assert.ok(!JSON.stringify(diag).includes('NHPLUG_APP_KEY'));
assert.ok(!JSON.stringify(diag).includes('NHPLUG_APP_SECRET'));
assert.ok(fs.readFileSync('scripts/nh-morning-capture.mjs','utf8')
 .includes('fetchNight=fetchNhNightFromGas'));
console.log('Central NH GAS no-direct-OAuth, date, bearer isolation, workflows PASS');
