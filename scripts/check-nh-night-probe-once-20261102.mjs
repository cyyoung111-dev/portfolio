import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {TARGET_DAY,kstProbeTime,verifyTodayNhNight} from './nh-night-probe-once-20261102.mjs';
assert.equal(TARGET_DAY,'2026-11-02');
assert.deepEqual(kstProbeTime(new Date('2026-11-02T02:20:00Z')),
 {date:'2026-11-02',minute:680});
const when=()=>new Date('2026-11-02T11:20:00+09:00');
const ref={source:'NH',tradingDate:'2026-11-02',officialClose:false,
  contract:'KA016C000',contractMonth:'2026-12',value:900.05,
  sourceUpdatedAt:'2026-11-02T06:00:00+09:00',
  receivedAt:'2026-11-02T07:41:00+09:00'};
let calls=0;
const valid=await verifyTodayNhNight({now:when,probe:async(date,{onError})=>{
 calls++;assert.equal(date,TARGET_DAY);assert.equal(typeof onError,'function');return ref;
}});
assert.equal(valid.status,'NH_0600_READ_ONLY_VERIFIED');
assert.equal(valid.referenceValue,900.05);
assert.equal(valid.officialExchangeFinal,false);
assert.equal(calls,1);
const rejected=await verifyTodayNhNight({now:when,
 probe:async()=>({...ref,tradingDate:'2026-11-01'})});
assert.equal(rejected.verified,false);
const missing=await verifyTodayNhNight({now:when,
 probe:async(_d,{onError})=>{onError('NH_PROXY_0600_NOT_VERIFIED');return null;},
 diagnose:async()=>({diagnosticOnly:true,tokenIssued:false,bearerExposed:false,reference:null})});
assert.equal(missing.reason,'NH_PROXY_0600_NOT_VERIFIED');
assert.equal(missing.detail,'NH_PROBE_REFERENCE_EMPTY');
const privateFailure=await verifyTodayNhNight({now:when,
 probe:async()=>{throw Error('PRIVATE_AUTH_TOKEN');}});
assert.equal(privateFailure.reason,'NH_PROBE_CALL_FAILED');
assert.doesNotMatch(JSON.stringify(privateFailure),/PRIVATE_AUTH_TOKEN/);
for(const instant of ['2026-11-02T07:59:59+09:00',
 '2026-11-02T13:00:00+09:00','2026-11-03T11:20:00+09:00']){
 const r=await verifyTodayNhNight({now:()=>new Date(instant),
  probe:async()=>assert.fail('no query outside window')});
 assert.equal(r.status,'OUTSIDE_READ_ONLY_PROBE_WINDOW');
}
const wf=YAML.parse(fs.readFileSync('.github/workflows/nh-night-probe-once-20261102.yml','utf8'));
assert.deepEqual(wf.on.push.branches,['main']);
assert.equal(wf.jobs.probe.environment,'portfolio-production-gas');
assert.equal(wf.permissions.issues,'write');
assert.equal(wf.permissions.contents,'read');
assert.equal(wf.jobs.probe.steps.find(x=>x.id==='nh_probe').env.GAS_ACCESS_TOKEN,
 '$'+'{{ secrets.GAS_ACCESS_TOKEN }}');
assert.equal(wf.jobs.probe.steps.find(x=>x.id==='nh_probe').env.TELEGRAM_BOT_TOKEN,undefined);
const source=fs.readFileSync('scripts/nh-night-probe-once-20261102.mjs','utf8');
assert.doesNotMatch(source,/bootstrapNhToken|sendTelegram|savePriceHistory|saveSnapshot|NHPLUG_APP_KEY/);
console.log('ONEOFF_NH_READONLY_PROBE_TEST_PASS');
