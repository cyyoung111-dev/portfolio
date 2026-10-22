import assert from 'node:assert/strict';
import fs from 'node:fs';
import {morningTarget,runMorning,runMorningWithBriefingSources} from './diagnose-krx-tplus1-morning.mjs';
import {summarizeHeldCoverage} from './diagnose-krx-held-coverage.mjs';
const at=x=>new Date(x);
assert.deepEqual(morningTarget(at('2026-10-18T23:45:00Z')),
  {action:'PROBE',today:'2026-10-19',targetDate:'2026-10-16'});
assert.deepEqual(morningTarget(at('2026-10-11T23:45:00Z')),
  {action:'PROBE',today:'2026-10-12',targetDate:'2026-10-08'},
  'October 9 KRX closed + Saturday/Sunday');
assert.equal(morningTarget(at('2026-10-16T23:45:00Z')).action,'SKIP_CLOSED');
assert.equal(morningTarget(at('2026-10-18T22:45:00Z')).action,'SKIP_BEFORE_PUBLICATION');
assert.throws(()=>morningTarget(at('2028-01-04T00:00:00Z')),
  /KRX_MORNING_CALENDAR_UNVERIFIED/,'unknown calendar must fail closed');
const token='sensitive-value-not-to-print',url='https://script.google.com/macros/s/fake/exec';
const ready=expected=>({mode:'READ_ONLY',coverageContract:'KRX_HELD_V1',ready:true,
  results:[{date:'2026-10-16',expected,exact:expected,missing:0,
    duplicateMaster:0,orphanLedger:0,ready:true,market:{STOCK:{expected:expected-4,confirmed:expected-4},ETF:{expected:4,confirmed:4}}}]
});
let calls=0;
for(const expected of [36,37,38]){
  const v=await runMorning({now:at('2026-10-18T23:45:00Z'),url,token,
    coverageFn:async args=>{
      calls++;
      assert.deepEqual({date:args.dates,url:args.url,token:args.token},
        {date:'2026-10-16',url,token});
      return ready(expected);
    }});
  assert.equal(v.providerReady,true);
  assert.equal(v.expected,expected);
  assert.equal(v.officialExact,expected);
  assert.doesNotMatch(JSON.stringify(v),/sensitive-value|script\.google\.com/);
}
const afterReady=await runMorning({now:at('2026-10-18T23:45:00Z'),
  coverageFn:async()=>({...ready(38),ready:false,
    results:[{...ready(38).results[0],exact:37,missing:1,ready:false}]})});
assert.equal(afterReady.providerReady,false);
assert.equal(afterReady.missing,1);
const weekend=await runMorning({now:at('2026-10-16T23:45:00Z'),
  coverageFn:async()=>{throw Error('should not call provider when KRX closed')}});
assert.equal(weekend.status,'SKIP_CLOSED');
const early=await runMorning({now:at('2026-10-18T22:45:00Z'),
  coverageFn:async()=>{throw Error('must not query before 08:30')}});
assert.equal(early.status,'SKIP_BEFORE_PUBLICATION');
await assert.rejects(()=>runMorning({now:at('2026-10-18T23:45:00Z'),
  coverageFn:async()=>({mode:'READ_ONLY',coverageContract:'KRX_HELD_V1',ready:true,
    results:[{date:'2026-10-15'}]})}),
  /KRX_MORNING_COVERAGE_CONTRACT_INVALID/);
// Extend the existing official held coverage, never introduce a second
// 09:45 GitHub cron with the same multi-hour schedule delay.
let sourceCalls=0;
const officialFn=async ({tradingDate})=>{
 sourceCalls++;
 assert.equal(tradingDate,'2026-10-16');
 return {sourceReadOnly:true,checkpoint:'KRX_FINAL',tradingDate,
  successful:true,officialIndexCount:2,officialStockCount:2,persistence:null};
};
const combined=await runMorningWithBriefingSources({
 now:at('2026-10-18T23:45:00Z'),
 coverageFn:async()=>ready(37),officialFn});
assert.equal(combined.providerReady,true);
assert.equal(combined.briefingOfficialReady,true);
assert.equal(combined.expected,37);
assert.equal(combined.officialIndexCount,2);
assert.equal(combined.officialStockCount,2);
assert.equal(combined.published,false);
assert.equal(combined.writesPerformed,0);
const noOfficial=await runMorningWithBriefingSources({
 now:at('2026-10-18T23:45:00Z'),
 coverageFn:async()=>ready(37),
 officialFn:async args=>({...await officialFn(args),
  successful:false,officialIndexCount:1})});
assert.equal(noOfficial.providerReady,false);
assert.equal(noOfficial.status,'BRIEFING_SOURCE_NOT_READY');
assert.equal(noOfficial.published,false);
const heldBlocked=await runMorningWithBriefingSources({
 now:at('2026-10-18T23:45:00Z'),
 coverageFn:async()=>({...ready(37),ready:false}),
 officialFn:async()=>{throw Error('no official reads after failed held coverage')}});
assert.equal(heldBlocked.providerReady,false);
assert.equal(heldBlocked.status,'PROVIDER_NOT_READY');
const closedCombined=await runMorningWithBriefingSources({
 now:at('2026-10-16T23:45:00Z'),
 coverageFn:async()=>{throw Error('closed-day GET forbidden')},
 officialFn:async()=>{throw Error('closed-day source GET forbidden')}});
assert.equal(closedCombined.status,'SKIP_CLOSED');
assert.equal(sourceCalls,2);
assert.match(fs.readFileSync('scripts/diagnose-krx-tplus1-morning.mjs','utf8'),
 /sourceReadOnlyT1:true/,'Source-only flag must be present on integrated 08:45 path');
assert.doesNotMatch(fs.readFileSync('.github/workflows/market-briefing-headless.yml','utf8'),
 /cron: '45 0 \\* \\* 1-5'/,'No duplicate 09:45 scheduled run');

const wf=fs.readFileSync('.github/workflows/krx-tplus1-morning-readonly.yml','utf8');
assert.match(wf,/cron: '45 23 \* \* 0-4'/);
assert.match(wf,/permissions:\s+contents: read/);
assert.match(wf,/node scripts\/diagnose-krx-tplus1-morning\.mjs/);
assert.doesNotMatch(wf,/apply=1|recoverPendingKrxClose|reconcileCompletedKrxPending|saveSnapshot|runPortfolioHistoricalBackfill/);
assert.equal(calls,3);
console.log('KRX T+1 08:45 KST previous trading date, holiday, 36/37/38 dynamic coverage, read-only fail-closed PASS');
