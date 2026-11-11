#!/usr/bin/env node
// Exercise actual read-only secondary-source logic without network/writer.
import assert from 'node:assert/strict';
import {HANWHA_CRPE_CLASS_ID,probeHanwhaFunetf} from './probe-hanwha-funetf-public.mjs';
const now=new Date('2026-11-11T02:00:00Z');
let calls=0;
const mock=async(url,opts)=>{
 calls++;
 const endpoint=new URL(url);
 assert.equal(endpoint.hostname,'www.funetf.co.kr');
 assert.equal(endpoint.pathname,'/api/public/product/view/fundnav');
 assert.equal(endpoint.searchParams.get('fundCd'),HANWHA_CRPE_CLASS_ID);
 assert.equal(endpoint.searchParams.get('schNavStDt'),'20261028');
 assert.equal(endpoint.searchParams.get('schNavEdDt'),'20261111');
 assert.equal(opts.method,'GET');
 assert.equal(opts.headers.Referer,'https://www.funetf.co.kr/product/fund/view/K55213C50702');
 return {ok:true,json:async()=>[
  {gijunYmd:'20261110',gijunGa:2001.23},
  {gijunYmd:'20261111',gijunGa:2002.34}
 ]};
};
const ok=await probeHanwhaFunetf({now,fetchImpl:mock});
assert.equal(ok.eligibleRows,1);
assert.equal(ok.latestEligibleDate,'2026-11-10');
assert.equal(ok.sameDayExcluded,1);
assert.equal(ok.importAuthorized,false);
assert.equal(ok.matchToPersistedOfficialNavVerified,false);
assert.equal(ok.financialWrites,0);
assert.equal(ok.gasCalls,0);
assert.equal(calls,1);
assert(!JSON.stringify(ok).includes('2001.23'));
for(const bad of [
 {ok:true,json:async()=>[{gijunYmd:'20261110',gijunGa:0}]},
 {ok:true,json:async()=>[{gijunYmd:'20261110',gijunGa:'2001.23'}]},
 {ok:true,json:async()=>[{gijunYmd:'20261111',gijunGa:2002.34}]},
]){
 await assert.rejects(()=>probeHanwhaFunetf({now,fetchImpl:async()=>bad}),
  /HANWHA_FUNETF_(?:SCHEMA_OR_RANGE_UNVERIFIED|PRIOR_PUBLICATION_MISSING)/);
}
await assert.rejects(()=>probeHanwhaFunetf({now,fetchImpl:async()=>{throw Error('offline');}}),
 /HANWHA_FUNETF_NETWORK_UNVERIFIED/);
assert.equal(HANWHA_CRPE_CLASS_ID,'K55213C50702');
console.log('PASS: Hanwha C-RPe FUNETF secondary-source probe strict class, prior-day, schema, no NAV values or writes');
