import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {validateGasEndpoint,fetchNhNightFromGas,fetchNhNightProbeFromGas} from './nh-gas-proxy.mjs';
import {readbackOnce,centralProbeWindow} from './nh-central-probe-20261030.mjs';
import {runCentralNhDiagnostic,isSupportedNhCentralStatus} from './nh-central-diagnostic.mjs';
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
  ?{status:'ok',provider:'NH',readOnly:true,enabled:true,tokenCached:true,tokenIssued:false,gasVersion:'9.282'}
  :data.get('action')==='getNhNightProbe'
   ?{status:'ok',provider:'NH',readOnly:true,bearerExposed:false,diagnosticOnly:true,tokenIssued:false,reference:ref}
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
const leak=await fetchNhNightFromGas('2026-10-30',{now,url,token,request:async()=>({
 ok:true,json:async()=>({status:'ok',provider:'NH',readOnly:true,bearerExposed:false,
 reference:{...ref,access_token:'UNEXPECTED_BEARER'}})})});
assert.equal(leak,null,'unexpected auth fields must never be stored in GH artifacts');
const captureNow=()=>new Date('2026-10-30T06:50:00+09:00');
const capturedEarly={...result,receivedAt:'2026-10-30T06:49:59+09:00'};
const cap=await captureMorning({now:captureNow,fetchNight:async()=>capturedEarly});
assert.equal(cap.status,'CAPTURED');
// Capture failure diagnostics are fixed error codes only: never emit bearer,
// raw provider responses or invent missing 06:00 prices.
const errorCodes=[];
assert.equal(await fetchNhNightFromGas('2026-10-30',{now,url,token,
 request:async()=>{throw Error('PRIVATE_NETWORK_DETAILS');},
 onError:x=>errorCodes.push(x)}),null);
assert.deepEqual(errorCodes,['NH_PROXY_NETWORK_OR_RESPONSE']);
const missingSchema=[];
assert.equal(await fetchNhNightFromGas('2026-10-30',{now,url,token,
 request:async()=>({ok:true,json:async()=>({
   status:'ok',provider:'NH',readOnly:true,bearerExposed:false,
   reference:{...ref,unknown_private_field:'PRIVATE_VALUE'}
 })}),
 onError:x=>missingSchema.push(x)}),null);
assert.deepEqual(missingSchema,['NH_NIGHT_SCHEMA_INVALID']);
const miss=await captureMorning({now:captureNow,fetchNight:async(_date,{onError})=>{
 onError('NH_PROXY_0600_NOT_VERIFIED');return null;
}});
assert.equal(miss.status,'REFERENCE_UNAVAILABLE');
assert.equal(miss.reason,'NH_PROXY_0600_NOT_VERIFIED');
assert.ok(!JSON.stringify({errorCodes,missingSchema,miss}).includes('PRIVATE_'));
const accepted={status:'ok',provider:'NH',readOnly:true,enabled:true,
 tokenCached:true,tokenIssued:false,gasVersion:'9.282'};
assert.equal(isSupportedNhCentralStatus(accepted),true,'current live GAS is accepted');
assert.equal(isSupportedNhCentralStatus({...accepted,gasVersion:'9.282'}),true,'compatible minor release is accepted');
for(const bad of [{...accepted,gasVersion:'9.280'},{...accepted,gasVersion:'10.281'},
 {...accepted,tokenIssued:true},{...accepted,readOnly:false},{...accepted,enabled:false}]){
 assert.equal(isSupportedNhCentralStatus(bad),false,'unsupported or unsafe status is rejected');
}
await assert.rejects(runCentralNhDiagnostic({mode:'status',url,token,
 request:async()=>({ok:true,json:async()=>({...accepted,gasVersion:'9.280'})}),
 log:()=>{}}),/NH_PROXY_STATUS_INVALID/);
const headlessSource=fs.readFileSync('scripts/run-market-briefing-headless.mjs','utf8');
const morningSource=fs.readFileSync('scripts/telegram-morning-briefing.mjs','utf8');
assert.match(headlessSource,/import \{fetchNhNightFromGas\} from '\.\/nh-gas-proxy\.mjs'/);
assert.match(headlessSource,/result\.prekospiReference = await fetchNhNightFromGas\(args\.tradingDate\)/);
assert.match(morningSource,/return fetchNhNightFromGas\(date,options\)/);
for(const source of [headlessSource,morningSource]){
 assert.doesNotMatch(source,/NHPLUG_APP_KEY|NHPLUG_APP_SECRET|fetchNhNight\(/,
 'scheduled workers must not start a separate NH OAuth request');
}
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
assert.equal(centralProbeWindow(new Date('2026-10-30T10:50:00+09:00')).allowed,true);
assert.equal(centralProbeWindow(new Date('2026-10-31T10:50:00+09:00')).allowed,false);
assert.equal(centralProbeWindow(new Date('2026-10-30T07:50:00+09:00')).allowed,false);
const clock=()=>new Date('2026-10-30T10:50:00+09:00');
const probe=await fetchNhNightProbeFromGas('2026-10-30',{now:clock,url,token,request});
assert.equal(probe.value,351.5);
const failureCodes=[];
const noTick=await fetchNhNightProbeFromGas('2026-10-30',{now:clock,url,token,
 onError:x=>failureCodes.push(x),request:async()=>({
 ok:true,json:async()=>({status:'error',message:'NH_PROXY_0600_NOT_VERIFIED'})
 })});
assert.equal(noTick,null);
assert.deepEqual(failureCodes,['NH_PROXY_0600_NOT_VERIFIED']);
const lines=[];
const p=await readbackOnce({now:clock,url,token,request,report:x=>lines.push(x)});
assert.equal(p.ok,true);
assert.match(lines.join('\n'),/NH_CENTRAL_0600_REFERENCE_VERIFIED/);
assert.match(lines.join('\n'),/"issued":false/);
assert.doesNotMatch(lines.join('\n'),/TEST-GAS-ACCESS-TOKEN|Bearer|nh-key/);
let callsWithoutCache=[];
const booted=await readbackOnce({now:clock,url,token,report:x=>callsWithoutCache.push(x),
  request:async(_url,opts)=>{
    const act=new URLSearchParams(opts.body).get('action');
    callsWithoutCache.push(act);
    const body=act==='getNhAuthStatusProxy'
      ?{status:'ok',provider:'NH',readOnly:true,enabled:true,tokenCached:false,
        tokenIssued:false,gasVersion:'9.278'}
      :act==='bootstrapNhTokenOnce20261030'
        ?{status:'ok',provider:'NH',readOnly:true,tokenIssued:true,tokenCached:true}
        :{status:'ok',provider:'NH',readOnly:true,bearerExposed:false,
          diagnosticOnly:true,tokenIssued:false,reference:ref};
    return {ok:true,json:async()=>body};
  }});
assert.equal(booted.ok,true);
assert.deepEqual(callsWithoutCache.filter(x=>typeof x==='string'&&
  ['getNhAuthStatusProxy','bootstrapNhTokenOnce20261030','getNhNightProbe'].includes(x)),
  ['getNhAuthStatusProxy','bootstrapNhTokenOnce20261030','getNhNightProbe']);
assert.match(callsWithoutCache.join('\n'),/"issued":true/);
let rejects=0;
const denied=await readbackOnce({now:clock,url,token,report:()=>{},
  request:async(_url,opts)=>{
    rejects++;
    const act=new URLSearchParams(opts.body).get('action');
    if(act==='getNhAuthStatusProxy')return {ok:true,json:async()=>({
      status:'ok',provider:'NH',readOnly:true,enabled:true,tokenCached:false,
      tokenIssued:false,gasVersion:'9.278'})};
    return {ok:true,json:async()=>({status:'error',message:'NH_PROXY_BOOTSTRAP_ALREADY_ATTEMPTED'})};
  }});
assert.equal(denied.ok,false);
assert.equal(rejects,2,'denied one-time bootstrap must never reach NH price query');
const wf=YAML.parse(fs.readFileSync('.github/workflows/gas-deploy.yml','utf8'));
assert.ok(wf.jobs.deploy.steps.some(x=>x.name.includes('central NH 06:00 readback')
 && x.run==='node scripts/nh-central-probe-20261030.mjs'&&x['continue-on-error']===true));

console.log('Central NH GAS no-direct-OAuth, date, bearer isolation, workflows PASS');
