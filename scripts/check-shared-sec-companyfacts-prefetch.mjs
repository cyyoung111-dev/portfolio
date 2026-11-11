import assert from 'node:assert/strict';
import {AI_NINE} from './briefing-ai-nine-sources.mjs';
import {sharedSecCompanyFactsFetch} from './shared-sec-companyfacts-prefetch.mjs';
import {collectAiFinancialEvidence} from './collect-ai-financial-evidence-readonly.mjs';
import {readAiNineAnnualValueSnapshots} from './briefing-ai-nine-sec-values.mjs';

const url=item=>'https://data.sec.gov/api/xbrl/companyfacts/CIK'+item.cik+'.json';
const now=()=>new Date('2026-11-09T06:20:00+09:00');
const ua='Portfolio Audit qa@example.com';
const headers={accept:'application/json','user-agent':ua};
const opts={method:'GET',redirect:'error',headers};
const facts=item=>({
 cik:Number(item.cik),entityName:item.label,
 facts:{'us-gaap':{Assets:{units:{USD:[{
  form:'10-K',fp:'FY',end:'2025-12-31',filed:'2026-02-15',
  accn:'0000123456-26-000001',val:1000000000
 }]}}}}
});
const makeResponse=(doc,overrides={})=>({
 ok:true,status:200,
 headers:{get:k=>k==='content-type'?'application/json':
  k==='content-length'?'1000':null},
 json:async()=>doc,
 ...overrides
});
const direct=[];
const shared=sharedSecCompanyFactsFetch(async (address,init)=>{
 direct.push({address,init});
 const item=AI_NINE.find(x=>url(x)===address);
 if(!item)throw Error('UNEXPECTED_NETWORK_DESTINATION');
 assert.equal(init.headers['user-agent'],ua);
 return makeResponse(facts(item));
});
for(const item of AI_NINE){
 const one=await (await shared(url(item),opts)).json();
 assert.equal(one.cik,Number(item.cik));
 one.entityName='MUTATED_OUTSIDE_CACHE';
 const two=await (await shared(url(item),opts)).json();
 assert.equal(two.entityName,item.label,'caller mutation cannot corrupt shared facts');
}
assert.equal(direct.length,9,'verified SEC companyfacts must be fetched at most once per company');

// The actual 06:20 collector injects the same fetch implementation into
// both actual readers. DART remains independently read-only; Yahoo quote
// helper is isolated here to avoid public traffic in CI.
let counts=0,sourceStatus=null,secFetches=[];
const readNetwork=async (address,init)=>{
 counts++;
 secFetches.push(address);
 if(!AI_NINE.some(x=>url(x)===address))
  throw Error('PRODUCTION_SHOULD_ONLY_READ_APPROVED_SEC_HOST');
 assert.equal(init.headers['user-agent'],ua);
 return makeResponse(facts(AI_NINE.find(x=>url(x)===address)));
};
const evidence=await collectAiFinancialEvidence({
 now,usSessionDate:'2026-11-06',fetchImpl:readNetwork,
 readDart:async()=>({statuses:[],rows:[]}),
 readTtm:async params=>{
  const {readAiNineTtmSecFacts}=await import('./briefing-ai-nine-sec-ttm.mjs');
  return readAiNineTtmSecFacts({...params,userAgent:ua});
 },
 readValues:async params=>readAiNineAnnualValueSnapshots({
  ...params,userAgent:ua,readPrices:async()=>({
   expectedUsDate:'2026-11-06',prices:[],total:9,verified:0,statuses:[]
  })
 }),
 onSourceStatus:status=>{sourceStatus=status;}
});
assert.equal(counts,9,'TTM and FY actual readers must not fetch the same SEC document twice');
assert.equal(new Set(secFetches).size,9);
assert.equal(evidence.kind,'AI_FINANCIAL_EVIDENCE_READ_ONLY');
assert.equal(evidence.items.length,9);
assert.equal(evidence.coverage.ttm,0);
assert.equal(evidence.coverage.fyOnly,0,'missing annual FCF never invented');
assert.ok(sourceStatus?.ttm?.every(x=>x.status==='FY_ONLY'));
assert.ok(sourceStatus?.fyPbr?.every(x=>x.status==='PARTIAL_FY_VALUE'));
assert.equal(evidence.portfolioWrites,0);
assert.equal(evidence.telegramSends,0);
assert.equal(evidence.gasDeployments,0);

// 11/11 operational regression: 07:23 SEC FY PBR 8/9, 10:18 late
// schedule FY PBR 0/9 while TTM 7/9 and DART 2/2 remained available.
// Retry only a transient completed US quote/split proof, keep the entire
// stronger source; never merge partial rows or retry missing FY share facts.
const baseStatuses=AI_NINE.map(x=>({symbol:x.symbol,
 status:x.symbol==='MSFT'?'PARTIAL_FY_VALUE':'NO_REPORTED_FY'}));
const basePart={total:9,verified:0,statuses:baseStatuses,
 snapshots:[{symbol:'MSFT',pbrUnavailableReason:'QUOTE_UNVERIFIED'}]};
const validMsft={
 symbol:'MSFT',source:'SEC_10K_US_GAAP',asOf:'2025-12-31',
 reportedAt:'2026-02-15',priceDate:'2026-11-06',
 priceSource:'YAHOO_DAILY_REFERENCE',priceUsd:200,
 bpsUsd:50,splitAdjustedBpsUsd:50,splitSharesPerOldShare:1,pbrTimes:4
};
const fullPart={total:9,verified:1,
 statuses:baseStatuses.map(x=>x.symbol==='MSFT'
  ?{symbol:x.symbol,status:'VERIFIED_FY_BPS_PBR'}:x),
 snapshots:[validMsft]};
const emptyReads=async()=>({statuses:[],reports:[],rows:[]});
const recoveryFixture=async (reads,options={})=>{
 let fyCalls=0,waits=[],dartCalls=0,ttmCalls=0,diagnostics=null;
 const result=await collectAiFinancialEvidence({
  now,usSessionDate:'2026-11-06',fetchImpl:async()=>{throw Error('no SEC network in fixture')},
  readDart:async()=>{dartCalls++;return {statuses:[],rows:[]};},
  readTtm:async()=>{ttmCalls++;return {statuses:[],reports:[]};},
  readValues:async()=>reads[Math.min(fyCalls++,reads.length-1)],
  retryDelay:async ms=>{waits.push(ms);},
  onSourceStatus:x=>{diagnostics=x;},
  ...options
 });
 return {result,fyCalls,waits,dartCalls,ttmCalls,diagnostics};
};
const healed=await recoveryFixture([basePart,fullPart]);
assert.equal(healed.fyCalls,2);
assert.deepEqual(healed.waits,[2000]);
assert.equal(healed.dartCalls,1);
assert.equal(healed.ttmCalls,1);
assert.equal(healed.result.coverage.referencePbr,1);
assert.equal(healed.diagnostics.fyPbr[0].status,'VERIFIED_FY_BPS_PBR');
const noRegression=await recoveryFixture([
 {...fullPart,snapshots:[validMsft,
  {symbol:'AAPL',pbrUnavailableReason:'SPLIT_HISTORY_UNVERIFIED'}]},
 basePart
]);
assert.equal(noRegression.fyCalls,2);
assert.equal(noRegression.result.coverage.referencePbr,1,
 'a failed retry must not erase an already verified company');
const duplicatedRetry=await recoveryFixture([basePart,{
 ...fullPart,snapshots:[validMsft,{...validMsft}],
 verified:2
}]);
assert.equal(duplicatedRetry.fyCalls,2);
assert.equal(duplicatedRetry.result.coverage.referencePbr,0,
 'ambiguous duplicate SEC reference rows must not be promoted as recovered');
const duplicateCannotRegress=await recoveryFixture([
 {...fullPart,snapshots:[validMsft,{
  symbol:'AAPL',pbrUnavailableReason:'QUOTE_UNVERIFIED'}]},
 {...fullPart,snapshots:[validMsft,{...validMsft},
  {symbol:'AAPL',pbrUnavailableReason:'QUOTE_UNVERIFIED'}],
  verified:2}
]);
assert.equal(duplicateCannotRegress.result.coverage.referencePbr,1,
 'an apparent two-row recovery must not replace one unique verified value');
const structural=await recoveryFixture([{
 ...basePart,snapshots:[{symbol:'MSFT',
  pbrUnavailableReason:'FISCAL_END_OUTSTANDING_SHARES_UNVERIFIED'}]
}]);
assert.equal(structural.fyCalls,1,'missing FY shares are not a transient quote failure');
assert.deepEqual(structural.waits,[]);
const noSource=await recoveryFixture([{
 ...basePart,snapshots:[],statuses:baseStatuses
}]);
assert.equal(noSource.fyCalls,1,'missing filing/unknown source must not trigger retries');
const thrown=await recoveryFixture([basePart],{
 readValues:(()=>{let c=0;return async()=>{if(++c===1)return basePart;
  throw Error('SIMULATED_PROVIDER_OUTAGE');};})()
});
assert.equal(thrown.fyCalls,0,'overridden reader owns its own invocation');
assert.equal(thrown.result.coverage.referencePbr,0);
assert.ok(!JSON.stringify(thrown).includes('SIMULATED_PROVIDER_OUTAGE'),
 'provider errors are not part of protected public artifact');
const full=await recoveryFixture([fullPart]);
assert.equal(full.fyCalls,1);
assert.deepEqual(full.waits,[]);

// Invalid SEC bodies, missing credentials and HTTP failures are NEVER cached.
let failed=0;
const notAccepted=sharedSecCompanyFactsFetch(async()=>{
 failed++;return makeResponse({...facts(AI_NINE[0]),cik:1});
});
await (await notAccepted(url(AI_NINE[0]),opts)).json();
await (await notAccepted(url(AI_NINE[0]),opts)).json();
assert.equal(failed,2);
let httpErrors=0;
const failing=sharedSecCompanyFactsFetch(async()=>{
 httpErrors++;return makeResponse(null,{ok:false,status:429});
});
await failing(url(AI_NINE[0]),opts);
await failing(url(AI_NINE[0]),opts);
assert.equal(httpErrors,2,'429 response must be independently retriable');
let contentErrors=0;
const badType=sharedSecCompanyFactsFetch(async()=>{
 contentErrors++;return makeResponse(facts(AI_NINE[0]),{
  headers:{get:k=>k==='content-type'?'text/html':null}});
});
await badType(url(AI_NINE[0]),opts);
await badType(url(AI_NINE[0]),opts);
assert.equal(contentErrors,2,'non-JSON response must not be reused');
let invalidParse=0;
const parseFails=sharedSecCompanyFactsFetch(async()=>{
 invalidParse++;return makeResponse(null,{
  json:async()=>{throw Error('SYNTHETIC_PARSE_FAILURE');}});
});
await assert.rejects((await parseFails(url(AI_NINE[0]),opts)).json(),
 /SYNTHETIC_PARSE_FAILURE/);
await assert.rejects((await parseFails(url(AI_NINE[0]),opts)).json(),
 /SYNTHETIC_PARSE_FAILURE/);
assert.equal(invalidParse,2,'failed JSON must never become cached facts');
let accidental=0;
const other=sharedSecCompanyFactsFetch(async()=>{accidental++;return makeResponse({ok:1});});
await other('https://query1.finance.yahoo.com/chart/SNDK',opts);
await other(url(AI_NINE[0]),{...opts,method:'POST'});
await other(url(AI_NINE[0]),{...opts,headers:{accept:'application/json'}});
assert.equal(accidental,3,'unapproved URLs/methods/non-identifying UA cannot be cached');
let shifted=0;
const uaVar=sharedSecCompanyFactsFetch(async()=>{
 shifted++;return makeResponse(facts(AI_NINE[0]));
});
await (await uaVar(url(AI_NINE[0]),opts)).json();
await (await uaVar(url(AI_NINE[0]),{
 ...opts,headers:{...headers,'user-agent':'Other Operator ops@example.net'}
})).json();
assert.equal(shifted,2,'changed User-Agent must not reuse previous request credentials');
assert.throws(()=>sharedSecCompanyFactsFetch({}),/SEC_SHARED_FETCH_CONFIG/);
console.log('SEC_COMPANYFACTS_SHARED_PREFETCH_PASS actual_sec_readers=2 issuers=9 network_calls=9 malformed_no_cache=true');
