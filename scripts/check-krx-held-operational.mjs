import assert from 'node:assert/strict';
import {runCoverage,summarizeHeldCoverage} from './diagnose-krx-held-coverage.mjs';

const dates=['2026-10-12','2026-10-13'],token='secret-do-not-print';
const sample=d=>({status:'ok',coverage:{
  requestedDate:d,mode:'READ_ONLY',expectedHeldCodes:37,
  officialExactDateCodes:37,missingCodes:0,staleCodes:0,
  duplicateMasterCodes:0,orphanLedgerCodes:0,
  market:{STOCK:{expected:16,confirmed:16},ETF:{expected:21,confirmed:21}},
  ready:true,rawSecret:'should-not-appear'
}});
assert.equal(summarizeHeldCoverage(sample(dates[0]),dates[0]).ready,true);
assert.throws(()=>summarizeHeldCoverage(sample(dates[0]),dates[1]),/BAD_RESPONSE/);
assert.throws(()=>summarizeHeldCoverage({...sample(dates[0]),coverage:{
 ...sample(dates[0]).coverage,missingCodes:1
}},dates[0]),/INCONSISTENT/);
let queries=[];
const fetchImpl=async(_url,options)=>{
  const a=options.body.get('action'),t=options.body.get('accessToken'),d=options.body.get('date');
  assert.equal(a,'getKrxHeldCloseCoverage');assert.equal(options.method,'POST');
  assert.equal(options.body.has('apply'),false); queries.push({a,d});
  return {ok:true,json:async()=>t===token?sample(d):{status:'error',message:'인증 실패'}};
};
const x=await runCoverage({
  url:'https://script.google.com/macros/s/fake/exec',
  dates:dates.join(','),token,fetchImpl
});
assert.equal(x.ready,true);
assert.deepEqual(x.results.map(r=>r.exact),[37,37]);
assert.equal(queries.length,3);
assert.doesNotMatch(JSON.stringify(x),/secret-do-not-print|should-not-appear/);
const failure=await runCoverage({
 url:'https://script.google.com/macros/s/fake/exec',dates:dates.join(','),token,
 fetchImpl:async(url,opts)=>{
  if(opts.body.get('accessToken')!==token)
   return {ok:true,json:async()=>({status:'error',message:'인증 실패'})};
  if(opts.body.get('date')===dates[0])throw Error('secret provider failure');
  return {ok:true,json:async()=>sample(dates[1])};
 }
});
assert.equal(failure.ready,false);
assert.equal(failure.results[0].errorCode,'KRX_HELD_DIAG_DATE_FAILED');
assert.equal(failure.results[1].ready,true);
await assert.rejects(()=>runCoverage({
 url:'https://script.google.com/macros/s/fake/exec',dates:dates[0],token,
 fetchImpl:async()=>({ok:true,json:async()=>sample(dates[0])})
}),/AUTH_DISABLED/);
console.log('KRX 37-code aggregate operational read-only and auth contract passed');
