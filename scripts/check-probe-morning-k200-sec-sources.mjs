import assert from 'node:assert/strict';
import {probeAuthorized,previousKrxTradingDate,summarizeKrxDaySettlement,
 compareKrxNhIdentity,inspectKrxFuturesSchema,probePublicSources} from './probe-morning-k200-sec-sources.mjs';
const today='2026-11-12',prior='2026-11-11';
const env={GITHUB_REPOSITORY:'cyyoung111-dev/portfolio',
 GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'push',
 GITHUB_RUN_ATTEMPT:'1',MARKET_SOURCE_PROBE_APPROVED:'true',
 MARKET_SOURCE_PROBE_DATE:today,KRX_AUTH_KEY:'DUMMY_SECRET_VALUE',
 SEC_USER_AGENT:'Portfolio research research@example.com'};
const now=new Date('2026-11-12T12:10:00+09:00');
assert.equal(probeAuthorized({env,now})?.date,today);
assert.equal(previousKrxTradingDate(today),prior);
assert.equal(probeAuthorized({env:{...env,GITHUB_REF:'refs/heads/work'},now}),null);
assert.equal(probeAuthorized({env,now:new Date('2026-11-12T07:40:00+09:00')}),null);
assert.equal(probeAuthorized({env:{...env,MARKET_SOURCE_PROBE_DATE:'2026-11-11'},now}),null);
const krx={OutBlock_1:[{BAS_DD:'20261111',PROD_NM:'코스피200 선물',
 MKT_NM:'정규',ISU_CD:'KR4101SC0000',ISU_NM:'코스피200 선물 2612',SETL_PRC:'836.55'}]};
assert.equal(summarizeKrxDaySettlement(krx,prior),'KRX_DAY_SETTLEMENT_CANDIDATES_ONLY');

const stats=inspectKrxFuturesSchema(krx,prior);
assert.equal(stats.totalRows,1);
assert.equal(stats.exactDateRows,1);
assert.equal(stats.regularSessionRows,1);
assert.equal(stats.k200ProductRows,1);
assert.equal(stats.k200NameRows,1);
assert.equal(stats.inspectedRows,1);
assert.equal(stats.validCodeRows,1);
assert.equal(stats.validContractNameRows,1);
assert.equal(stats.validTickSettlementRows,1);
assert.equal(stats.fullyVerifiedRows,1);
assert.equal(stats.codeWidthCounts.twelve,1);
assert.equal(inspectKrxFuturesSchema(krx,'bad'),null);
const partialSchema=inspectKrxFuturesSchema({...krx,OutBlock_1:[
 {...krx.OutBlock_1[0],ISU_NM:'unknown-2612',SETL_PRC:'-',ISU_CD:'12345'}]},prior);
assert.equal(partialSchema.inspectedRows,1);
assert.equal(partialSchema.validCodeRows,0);
assert.equal(partialSchema.validContractNameRows,0);
assert.equal(partialSchema.nonemptySettlementRows,0);
assert.equal(partialSchema.fullyVerifiedRows,0);

assert.equal(summarizeKrxDaySettlement({...krx,OutBlock_1:[]},prior),'KRX_ROWS_EMPTY');
assert.equal(summarizeKrxDaySettlement({...krx,OutBlock_1:[
 {...krx.OutBlock_1[0],BAS_DD:'20261110'}]},prior),'KRX_K200_REGULAR_NOT_MATCHED');
assert.equal(summarizeKrxDaySettlement({...krx,OutBlock_1:[
 {...krx.OutBlock_1[0],SETL_PRC:'0'}]},prior),'KRX_SETTLEMENT_IDENTITY_UNVERIFIED');
assert.equal(summarizeKrxDaySettlement({...krx,OutBlock_1:[
 krx.OutBlock_1[0],krx.OutBlock_1[0]]},prior),'KRX_DUPLICATE_CONTRACT_CODE');
function record(code,nameBytes){
 const row=Buffer.alloc(30,32);
 Buffer.from(code,'ascii').copy(row,0);
 nameBytes.copy(row,9,0,20);
 row[29]=10;return row;
}
const header=record('K10111111',Buffer.from('KOSPI200'));
const name=Buffer.from([188,177,185,176,50,54,49,50,191,249,107,112]);
const master=Buffer.concat([header,record('KA016C000',name)]);
const comparison=compareKrxNhIdentity(krx,master,prior);
assert.equal(comparison.status,'PRODUCT_EXPIRY_CROSS_SOURCE_CANDIDATE');
assert.equal(comparison.contractMapped,false);
const latestSec={cik:723125,filings:{recent:{
 form:['8-K'],filingDate:[prior],
 accessionNumber:['0000723125-26-012345']
}}};
const fakeFetch=async (url,opts)=>{
 if(url.startsWith('https://data-dbg.krx.co.kr/'))
  return {ok:true,json:async()=>krx};
 if(url==='https://www.nhplug.com/instruments/m_future.mst')
  return {ok:true,arrayBuffer:async()=>master};
 if(url==='https://www.sec.gov/files/company_tickers.json')
  return {ok:true,json:async()=>({0:{ticker:'MU',cik_str:723125}})};
 if(url==='https://data.sec.gov/submissions/CIK0000723125.json')
  return {ok:true,json:async()=>latestSec};
 throw Error('unexpected '+url);
};
const probe=await probePublicSources({env,now,fetchImpl:fakeFetch});
assert.equal(probe.status,'READ_ONLY');
assert.equal(probe.krx,'KRX_DAY_SETTLEMENT_CANDIDATES_ONLY');
assert.equal(probe.krxSchema.fullyVerifiedRows,1);
assert.equal(probe.krxSchema.codeWidthCounts.twelve,1);
assert.equal(probe.nhMaster,'PRODUCT_EXPIRY_CROSS_SOURCE_CANDIDATE');
assert.equal(probe.contractMapped,false);
assert.equal(probe.sec,'HTTP_200');
assert.equal(probe.secFiling,'RECENT_VERIFIED');
assert.equal(probe.telegramSends,0);
assert.equal(probe.portfolioWrites,0);
assert.equal(probe.gasCalls,0);
assert.doesNotMatch(JSON.stringify(probe),/836\.55|DUMMY_SECRET_VALUE|research@example/);
const missing=await probePublicSources({env:{...env,KRX_AUTH_KEY:null,SEC_USER_AGENT:''},now,
 fetchImpl:async()=>{throw Error('must not call');}});
assert.equal(missing.krx,'KEY_MISSING');
assert.equal(missing.sec,'AGENT_MISSING');
console.log('K200/SEC source probe: auth, date, monthly mapping nonproof, safe output PASS');
