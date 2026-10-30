import assert from 'node:assert/strict';
import {summarizeKrxDomesticCloseReadback,runReadback}
 from './krx-domestic-close-readback-20261030.mjs';
const date='2026-10-30';
const response={
 status:'ok',seriesMeta:{
  KOSPI:{source:'KRX_OFFICIAL',officialDate:date,confirmedClose:true},
  KOSDAQ:{source:'KRX_OFFICIAL',officialDate:date,confirmedClose:true},
  KOSPI200:{source:'YAHOO_UNVERIFIED_DAILY',officialDate:date,confirmedClose:false}
 },series:{
  KOSPI:[{date,value:5730.74,source:'KRX_OFFICIAL'}],
  KOSDAQ:[{date,value:724.38,source:'KRX_OFFICIAL'}],
  KOSPI200:[{date,value:905,source:'YAHOO_UNVERIFIED_DAILY'}]
 }
};
const sample=summarizeKrxDomesticCloseReadback(response);
assert.equal(sample.responseStatus,'ok');
assert.equal(sample.verifiedOfficialCount,2);
assert.equal(sample.independentlyMatchedCount,2);
assert.equal(sample.completeVerifiedAndMatched,false);
assert.deepEqual(sample.checkedTypes.map(x=>x.state),[
 'OFFICIAL_REFERENCE_MATCH','OFFICIAL_REFERENCE_MATCH','OFFICIAL_NOT_VERIFIED']);
assert.equal(sample.checkedTypes[2].validatedOfficialClose,null,'Yahoo must not become KRX official');
assert.equal(sample.checkedTypes[2].returnedSource,'YAHOO_UNVERIFIED_DAILY');
assert.equal(sample.checkedTypes[2].unverifiedDatedValue,905);
assert.equal(sample.checkedTypes[2].validatedOfficialClose,null);
assert.equal(sample.checkedTypes[2].unverifiedReferenceMatch,null);
const yahooOnKrxFailure=structuredClone(response);
yahooOnKrxFailure.series.KOSPI[0].source='YAHOO_UNVERIFIED_DAILY';
yahooOnKrxFailure.series.KOSDAQ[0].source='YAHOO_UNVERIFIED_DAILY';
yahooOnKrxFailure.seriesMeta.KOSPI={source:'YAHOO_FINANCE',confirmedClose:false};
yahooOnKrxFailure.seriesMeta.KOSDAQ={source:'YAHOO_FINANCE',confirmedClose:false};
yahooOnKrxFailure.errors={KRX_OFFICIAL:
  'KOSPI:2026-10-30:EMPTY_TRADING_DATE, KOSDAQ:2026-10-30:HTTP_403'};
const unverified=summarizeKrxDomesticCloseReadback(yahooOnKrxFailure);
assert.equal(unverified.verifiedOfficialCount,0);
assert.equal(unverified.checkedTypes[0].unverifiedDatedValue,5730.74);
assert.equal(unverified.checkedTypes[0].unverifiedReferenceMatch,true);
assert.equal(unverified.checkedTypes[1].unverifiedReferenceMatch,true);
assert.equal(unverified.krxSourceFailureCode,'EMPTY_TRADING_DATE|HTTP_403');
const hidden=summarizeKrxDomesticCloseReadback({...yahooOnKrxFailure,
 errors:{KRX_OFFICIAL:'private-protected-token-example-1234'}});
assert.equal(hidden.krxSourceFailureCode,'OTHER_REDACTED');
assert.ok(!JSON.stringify(hidden).includes('private-protected-token-example-1234'));
assert.equal(sample.writesPerformed,0);
const incorrect=structuredClone(response);
incorrect.series.KOSPI[0].value=5668.26;
assert.equal(summarizeKrxDomesticCloseReadback(incorrect).checkedTypes[0].state,
 'OFFICIAL_REFERENCE_MISMATCH');
const duplicated=structuredClone(response);
duplicated.series.KOSPI.push(duplicated.series.KOSPI[0]);
assert.equal(summarizeKrxDomesticCloseReadback(duplicated).checkedTypes[0].state,
 'OFFICIAL_NOT_VERIFIED');
const stale=structuredClone(response);
stale.seriesMeta.KOSDAQ.officialDate='2026-10-29';
assert.equal(summarizeKrxDomesticCloseReadback(stale).checkedTypes[1].state,
 'OFFICIAL_NOT_VERIFIED');
const now=()=>new Date('2026-10-30T17:35:00+09:00');
let called=0;
const mock=async(_url,options)=>{
 called++;
 assert.equal(options.method,'POST');
 assert.equal(new URLSearchParams(options.body).get('benchmarks'),'KOSPI,KOSDAQ,KOSPI200');
 assert.equal(new URLSearchParams(options.body).get('from'),date);
 assert.equal(new URLSearchParams(options.body).get('to'),date);
 assert.equal(new URLSearchParams(options.body).get('fresh'),'1');
 return {ok:true,json:async()=>response};
};
const input={fetchImpl:mock,url:'https://script.google.com/macros/s/EXAMPLE123/exec',
 token:'PROTECTED_TEST',now};
const live=await runReadback(input);
assert.equal(live.verifiedOfficialCount,2);
assert.equal(called,1);
assert.ok(!JSON.stringify(live).includes('PROTECTED_TEST'),'token must not appear in logs');
await runReadback({...input,now:()=>new Date('2026-10-30T15:59:00+09:00')});
assert.equal(called,1,'no premature official close check');
await runReadback({...input,now:()=>new Date('2026-11-02T17:35:00+09:00')});
assert.equal(called,1,'one-day probe cannot become recurring');
const error=await runReadback({...input,url:'http://unsafe.com'});
assert.equal(error.status,'KRX_DOMESTIC_GAS_ENDPOINT_REJECTED');
assert.equal(called,1);
const http=await runReadback({...input,fetchImpl:async()=>({ok:false,status:403})});
assert.equal(http.status,'KRX_DOMESTIC_GAS_HTTP_FAILURE');
console.log('KRX 2026-10-30 live readback contract: source/date/value/finality, no writes or NH token PASS');
