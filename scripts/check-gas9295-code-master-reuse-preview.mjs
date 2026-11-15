// #734/#860: synthetic, read-only parity for a NEXT GAS 9.295 proposal.
// Never call real Apps Script/NH/Sheets; exercise exact old/new GAS function.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {gasSourceBlobSha} from './deploy-gas.mjs';
import {composeGas9295CodeMasterReusePreview}
  from './compose-gas9295-code-master-reuse-preview.mjs';

const {parent,candidate,oldFn,nextFn,manifest}=composeGas9295CodeMasterReusePreview();
assert.equal(gasSourceBlobSha(parent),manifest.parentGitBlob);
assert.equal(gasSourceBlobSha(candidate),manifest.candidateGitBlob);
assert.equal(manifest.parentGitBlob,'f5e31eeb2255539a021546d8b90a71d5cc7ca33d');
assert.equal(manifest.parentVersion,'9.294');
assert.equal(manifest.proposedVersion,'9.295');
assert.equal(manifest.sourceOnly,true);
assert.equal(manifest.approved,false);
assert.equal(manifest.deployable,false);
assert.equal(manifest.manualReleaseRequired,true);
assert.equal(manifest.financialWrites,0);
assert.equal(manifest.gasDeployments,0);
assert.deepEqual(manifest.changedBusinessFunctions,['handleGetPricesCompat']);
assert.equal(parent.includes(nextFn),false);
const bannerNew='//  📊 포트폴리오 대시보드 — Google Apps Script  v9.295';
const bannerOld='//  📊 포트폴리오 대시보드 — Google Apps Script  v9.294';
const undone=candidate.replace(nextFn,oldFn)
  .replace(bannerNew,bannerOld)
  .replaceAll("gasVersion: '9.295'","gasVersion: '9.294'")
  .replace("var ISSUE507_GATE_API_VERSION='9.295'",
           "var ISSUE507_GATE_API_VERSION='9.294'");
assert.equal(undone,parent,'only one price function and exact version tags may change');
assert.equal((oldFn.match(/getCodeItems\(ss\)/g)||[]).length,2);
assert.equal((nextFn.match(/getCodeItems\(ss\)/g)||[]).length,1);
const deploy=fs.readFileSync('scripts/deploy-gas.mjs','utf8');
assert.doesNotMatch(deploy,/'9\.295'\s*:/,'unreviewed candidate cannot join production allowlist');
new vm.Script(nextFn,{filename:'gas9295-preview-only.gs'});

const DAY='2026-11-13',PREV='2026-11-12';
const catalog=[
  {code:'005930',name:'Korean A',type:'주식',currency:'KRW',market:'KR'},
  {code:'AAPL',name:'Overseas B',type:'주식',currency:'USD',market:'US'}
];
function run(fn,{persist=false,cacheHit=false,codes='005930,AAPL',caseType='full'}={}) {
  let masterReads=0;
  const effects=[],saved=[];
  const cacheValue=JSON.stringify({
    prices:{'005930':110},priceDates:{'005930':DAY},missing:[],
    exchangeRates:{USD:1400},
    priceLookup:{confirmedSnapshotDate:DAY,recentHistoryFallbackItems:[]}
  });
  const cache={
    get:key=>{effects.push(['cache.get',key]);return cacheHit?cacheValue:null;},
    put:(key,payload,ttl)=>{
      effects.push(['cache.put',key,ttl]);
      saved.push(JSON.parse(payload));
    }
  };
  const rawPrices=caseType==='history'
    ? {'005930':{price:110,usedDate:PREV,source:'NH',currency:'KRW'}}
    : {
        '005930':{price:110,usedDate:DAY,source:'NH',currency:'KRW'},
        AAPL:{price:201,usedDate:DAY,source:'NH',currency:'USD'}
      };
  const status=(body)=>({status:'ok',...body});
  const ctx=vm.createContext({
    Date,JSON,Number,String,Math,Object,Array,
    Logger:{log(){}},
    getss:()=>({}),
    today:()=>DAY,
    _ensureDailyTriggersOncePerDay:()=>({checked:false,autoFixed:false}),
    CacheService:{getScriptCache:()=>cache},
    Utilities:{DigestAlgorithm:{SHA_256:1},computeDigest:()=>[1,2,3],
      base64EncodeWebSafe:()=> 'hash_for_synthetic_lookup'},
    _newPriceLookupTimings_:()=>({}),
    _priceTimingAdd_:(t,key)=>{t[key]=0;},
    _normalizeDate:date=>String(date||''),
    getPriceHistoryRow:(_ss,date)=>{
      effects.push(['history.row',date]);
      return date===DAY?{'005930':100,AAPL:198}: {'005930':99};
    },
    getCodeItems:()=>{masterReads++;return catalog;},
    fetchPricesToss:(items,_timings,meta)=>{
      effects.push(['nh',items.map(x=>x.code)]);
      meta.attempted=true;meta.status='SUCCESS';meta.provider='NH';
      return rawPrices;
    },
    fetchPricesKrx:(items,date)=>{
      effects.push(['krx',items.map(x=>x.code),date]);
      return {};
    },
    _hasUsdPriceItems:items=>items.some(x=>x.currency==='USD'),
    _isConfirmedHistoryPrice_:()=>true,
    getLatestPriceHistoryEntries:(_ss,keys,day)=>{
      effects.push(['history.latest',keys,day]);
      return caseType==='history'
        ? {AAPL:{date:PREV,price:190}} : {};
    },
    batchUpsertPriceHistory:(_ss,date,rows)=>effects.push(['PRICE_WRITE_STUB',date,rows]),
    _updateTodaySnapshotSource:(_ss,date,map)=>effects.push(['SNAPSHOT_SOURCE_STUB',date,map]),
    _rebuildSnapshotForDateFromHistory:(_ss,date)=>effects.push(['SNAPSHOT_REBUILD_STUB',date]),
    _ensureSnapshotExistsForDate:(_ss,date)=>{effects.push(['SNAPSHOT_CHECK_STUB',date]);return true;},
    fetchExchangeRates:(_ss,curs)=>{
      effects.push(['fx',curs]);
      return curs.includes('USD') ? {USD:1400} : {};
    },
    _latestDateFromPriceDates:dates=>Object.values(dates||{}).sort().at(-1)||'',
    jsonOk:status,
    jsonError:reason=>({status:'error',error:'SANITIZED_'+String(reason).split(':')[0]})
  });
  vm.runInContext(fn,ctx);
  const result=JSON.parse(JSON.stringify(ctx.handleGetPricesCompat(codes,persist)));
  function stripDynamic(value){
    const copy=JSON.parse(JSON.stringify(value));
    if(copy.priceLookup)delete copy.priceLookup.serverElapsedMs;
    return copy;
  }
  return {value:stripDynamic(result),effects,masterReads,saved:saved.map(stripDynamic)};
}
for (const scenario of [
  {name:'current-read',persist:false},
  {name:'persistent-update',persist:true},
  {name:'history-carry',persist:false,caseType:'history'},
  {name:'persistent-history-carry',persist:true,caseType:'history'},
  {name:'cached-read',persist:false,cacheHit:true},
  {name:'cached-persistent',persist:true,cacheHit:true},
  {name:'empty-request',persist:false,codes:''}
]) {
  const before=run(oldFn,scenario);
  const after=run(nextFn,scenario);
  assert.equal(before.value.status,'ok',scenario.name+' old status');
  assert.deepEqual(after.value,before.value,scenario.name+' price/asof/FX/provider parity');
  assert.deepEqual(after.effects,before.effects.filter(e=>e[0]!=='none'),scenario.name+' side effects parity');
  assert.deepEqual(after.saved,before.saved,scenario.name+' cache payload parity');
  const expected= scenario.cacheHit
    ?[0,0] : scenario.codes===''?[1,0]:[2,1];
  assert.deepEqual([before.masterReads,after.masterReads],expected,
    scenario.name+' master reads');
  if(!scenario.persist){
    assert.equal(after.effects.some(e=>e[0].includes('WRITE_STUB')||
      e[0].includes('REBUILD_STUB')||e[0].includes('SOURCE_STUB')),false,
      scenario.name+' read-only quote must not write to finance');
  }
  if(scenario.persist&&!scenario.cacheHit&&scenario.codes!==''){
    assert(after.effects.some(e=>e[0]==='PRICE_WRITE_STUB'));
    assert(after.effects.some(e=>e[0]==='SNAPSHOT_SOURCE_STUB'));
    assert(after.effects.some(e=>e[0]==='SNAPSHOT_REBUILD_STUB'));
  }
}
console.log('GAS9295_PRICE_MASTER_REUSE_PARITY_OK '+JSON.stringify({
  productionGASChanged:false,parentVersion:'9.294',proposedVersion:'9.295',
  cases:7,readsBefore:2,readsAfter:1,realFinancialWrites:0,
  sourceOnly:true,manualGateRequired:true,candidateBlob:manifest.candidateGitBlob
}));
