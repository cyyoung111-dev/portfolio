import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/features/settings/settings_fetch.js', 'utf8');
const portfolioSource = fs.readFileSync('src/web/domain/portfolio/portfolio_service.js', 'utf8');
const resolver = source.match(/function _resolvePriceDateLabel\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
const polling = source.match(/async function pollCurrentPrices\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
const recompute = portfolioSource.match(/function recomputeRows\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
if (!polling || !recompute || !resolver
    || !/document\.hidden/.test(polling[1])
    || !/persist:\s*false/.test(polling[1])
    || !/저장 이력\/Snapshot 미변경/.test(polling[1])
    || !/마지막 정상값 유지/.test(polling[1])
    || !/setInterval\(pollCurrentPrices,\s*60\s*\*\s*1000\)/.test(source)
    || !/visibilitychange/.test(source)
    || !/startPricePolling\(\)/.test(source)) {
  console.error('❌ 현재가 polling의 비영속·hidden 중단·실패시 캐시 보존 경로가 없습니다.');
  process.exit(1);
}
if (!/async function fetchFromGsheet\(dateStr, options\)/.test(source)
    || !/const requestKey = targetUrl \+ '\\|' \+ generation \+ '\\|' \+ dateStr/.test(source)
    || !/_fetchFromGsheetInner\(dateStr, \{ \.\.\.\(options \|\| \{\}\), targetUrl, generation \}\)/.test(source)) {
  console.error('❌ polling/수동조회 옵션과 GAS 연결 식별자가 실제 요청에 전달되지 않습니다.');
  process.exit(1);
}

// Extract actual production functions; the mocked portfolio computation has
// explicit price * quantity semantics, not just a counter for recomputeRows.
const pollSource = 'async function pollCurrentPrices() {' + polling[1] + '\n}';
const recomputeSource = 'function recomputeRows() {' + recompute[1] + '\n}';
const resolverSource = 'function _resolvePriceDateLabel(baseLabel, key, responseMeta) {' + resolver[1] + '\n}';
const testPoll = async ({ view = 'gsheet', hidden = false, response = { '005930': 12345 }, fail = false,
  meta = { '005930':{ sourceDate:'2026-10-13', isFallback:false } }, resolvedDate = '2026-10-13', disconnect = false, hideAfterFetch = false,
  embeddedMeta = null, embeddedDate = null } = {}) => {
  let networkCount = 0, repaintCount = 0, summaryCount = 0, cacheInvalidations = 0;
  let persistedCount = 0, badge = null, status = null, connected = true;
  const cache = { '005930': 1000 };
  const rows = [], savedPriceDates = {};
  const rawHoldings = [{ code:'005930', qty:2, costAmt:12000 }];
  const context = vm.createContext({
    document:{ hidden }, GSHEET_API_URL:'https://script.google.com/macros/s/test/exec',
    window:{ _gsheetPriceMeta:meta, _gsheetResolvedPriceDate:resolvedDate },
    getGsheetConnectionGeneration:()=>1, isGsheetConnectionCurrent:()=>connected,
    savedPriceDates, lastUpdated:'2026.10.08',
    currentView:view, savedPrices:cache, rows, rawHoldings,
    fetchFromGsheet:async (date, opts) => {
      networkCount++;
      assert.equal(opts.persist, false);
      assert.equal(opts.polling, true);
      if (fail) throw Error('network failure');
      if (disconnect) connected = false;
      if (hideAfterFetch) context.document.hidden = true;
      if (response && embeddedMeta) Object.defineProperty(response, '__gsheetPriceMeta', {value:embeddedMeta});
      if (response && embeddedDate !== null) Object.defineProperty(response, '__gsheetResolvedPriceDate', {value:embeddedDate});
      return response;
    },
    getDateStr:()=> '2026-10-13', updateDateBadge:(...args)=>{badge=args;},
    _priceLookupSummary:()=> 'test', _priceStatusLayout:(head,detail,note)=>head+' '+note,
    setStatusLabel:(...args)=>{status=args;},
    computeRows:holdings => holdings.map(h => ({
      evalAmt:cache[h.code] * h.qty, costAmt:h.costAmt, pnl:cache[h.code] * h.qty - h.costAmt
    })),
    invalidateViewCache:()=>{ cacheInvalidations++; },
    renderSummary:()=>{ summaryCount++; },
    // Other views keep the existing refreshAll contract. A Settings view must
    // never call it because that remounts the automation-status panel.
    refreshAll:()=> {
      repaintCount++;
      vm.runInContext('recomputeRows()', context);
      cacheInvalidations++;
      summaryCount++;
    },
    savePriceCache:()=>{ persistedCount++; },
    console:{ warn:()=>{} }
  });
  vm.runInContext(recomputeSource + '\n' + resolverSource + '\n' + pollSource, context);
  await vm.runInContext('pollCurrentPrices()', context);
  return {networkCount,repaintCount,summaryCount,cacheInvalidations,persistedCount,cache,rows,
    dates:savedPriceDates, updated:context.lastUpdated, badge,status};
};

const settings = await testPoll({view:'gsheet'});
assert.equal(settings.networkCount,1,'설정 화면에서도 현재가 조회');
assert.equal(settings.repaintCount,0,'설정 패널 자동화 상태 DOM 보존');
assert.equal(settings.summaryCount,1,'설정 중에도 공통 상단 평가금액 갱신');
assert.equal(settings.cacheInvalidations,1,'설정 중에도 탭/차트 캐시 무효화');
assert.equal(settings.rows[0].evalAmt,24690,'설정→계좌/섹터 이동 전 rows 평가금액 갱신');
assert.equal(settings.rows[0].pnl,12690,'평가손익도 새로운 가격으로 갱신');
assert.equal(settings.cache['005930'],12345);
assert.equal(settings.dates['005930'],'2026.10.13 조회값');
assert.equal(settings.updated,'2026.10.13');
assert.equal(settings.badge[1],true);
assert.equal(settings.persistedCount,0,'polling에서 localStorage/GAS 가격이력 저장 금지');

const account = await testPoll({view:'acct'});
assert.equal(account.networkCount,1);
assert.equal(account.repaintCount,1,'계좌 화면에서는 전체 새로 그리기');
assert.equal(account.rows[0].evalAmt,24690);
assert.equal(account.cacheInvalidations,1);
assert.equal(account.summaryCount,1);

const hidden = await testPoll({view:'gsheet',hidden:true});
assert.equal(hidden.networkCount,0,'숨겨진 브라우저 탭에서는 polling 요청 차단');
assert.equal(hidden.repaintCount,0);
assert.equal(hidden.summaryCount,0);
assert.equal(hidden.cacheInvalidations,0);
assert.equal(hidden.cache['005930'],1000);

for (const options of [{view:'gsheet',response:null},{view:'gsheet',fail:true}]) {
  const unsuccessful = await testPoll(options);
  assert.equal(unsuccessful.rows.length,0,'조회 실패 시 새 파생 계산을 하지 않음');
  assert.equal(unsuccessful.cache['005930'],1000,'조회 실패 시 마지막 정상가격 유지');
  assert.equal(unsuccessful.summaryCount,0);
  assert.equal(unsuccessful.cacheInvalidations,0);
  assert.equal(unsuccessful.repaintCount,0);
}

const fallback = await testPoll({view:'gsheet',
  meta:{ '005930':{sourceDate:'2026-10-09',savedAt:'2026-10-13T18:30',isFallback:true} },
  resolvedDate:'2026-10-09'});
assert.equal(fallback.rows[0].evalAmt,24690,'휴장일에도 실제 확정가격으로 평가');
assert.equal(fallback.dates['005930'],'2026.10.09 기준일 이전값',
  '저장 시각이 오늘이어도 과거 종가 기준일 우선');
assert.equal(fallback.updated,'2026.10.09','조회일을 가격일로 오인하지 않음');
assert.equal(fallback.badge[1],false,'과거 종가를 실시간으로 표시하지 않음');


const pinned = await testPoll({view:'gsheet',
  meta:{'005930':{sourceDate:'2026-10-13',isFallback:false}},
  embeddedMeta:{'005930':{sourceDate:'2026-10-09',isFallback:true}},
  embeddedDate:'2026-10-09',resolvedDate:'2026-10-13'});
assert.equal(pinned.updated,'2026.10.09','다른 조회가 전역 메타데이터를 덮어도 응답 자체의 기준일 사용');
assert.equal(pinned.dates['005930'],'2026.10.09 기준일 이전값');

const mixed = await testPoll({view:'gsheet',response:{'005930':12345,'000660':180000},
  meta:{'005930':{sourceDate:'2026-10-13',isFallback:false},
    '000660':{sourceDate:'2026-10-09',isFallback:true}}});
assert.equal(mixed.updated,'2026.10.13','혼합 기준일 상단 최신일');
assert.equal(mixed.dates['000660'],'2026.10.09 기준일 이전값',
  '개별 종목은 오래된 가격을 식별');
const undated = await testPoll({view:'gsheet',meta:{},resolvedDate:''});
assert.equal(undated.updated,'2026.10.08','기준일 증거가 없으면 당일로 승격하지 않음');
assert.equal(undated.dates['005930'],'기준일 미확인');
assert.equal(undated.badge[1],false);
for (const options of [{view:'gsheet',disconnect:true},{view:'gsheet',hideAfterFetch:true}]) {
  const stale = await testPoll(options);
  assert.equal(stale.cache['005930'],1000,'응답 전 연결 변경/숨김 시 가격 적용 금지');
  assert.equal(stale.summaryCount,0);
}
console.log('✅ 현재가 polling 설정 탭 rows·손익·캐시 갱신, DOM 보존, 비영속성, 실패/hidden 회귀 통과');

// Actual price loader: fund history must start before the stock request finishes.
// Deferred responses verify concurrency without a wall-clock performance threshold.
const innerLoader = source.match(/async function _fetchFromGsheetInner\(dateStr, options\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(innerLoader);
async function checkParallelHistory({fundFailure=false, stale=false, stocks=true, funds=true, usdQuote=false, missingFx=false}={}) {
  let finishStock, finishFund, connected=true;
  const calls=[];
  const stockResponse=new Promise(resolve=>{finishStock=resolve;});
  const fundResponse=new Promise((resolve,reject)=>{finishFund=fundFailure?reject:resolve;});
  const ctx=vm.createContext({
    GSHEET_API_URL:'test-gas',window:{},exchangeRates:{},console:{warn(){},info(){}},
    getGsheetConnectionGeneration:()=>1,isGsheetConnectionCurrent:()=>connected,
    normName:x=>x,normalizeStockCode:x=>x,
    rawHoldings:stocks?[{name:'Stock',code:'005930',qty:1}]:[],
    fundDirect:funds?{Fund:1}:{},STOCK_CODE:{Stock:'005930'},_gsheetCodeList:[],
    EDITABLE_PRICES:funds?[{name:'Fund',code:''}]:[],
    getEPWithCode:()=>stocks?[{name:'Stock',code:'005930'}]:[],
    _kstDateOffset:()=> '2026-07-28',getDateStr:()=> '2026-10-26',
    requestGsheetActionJson:(action,params,opts)=>{
      calls.push({action,params,opts});
      return action==='getPrices'?stockResponse:params.codes==='005930'?Promise.resolve({status:'ok',prices:{}}):fundResponse;
    },
    MarketDataProvider:null,
  });
  ctx.window.MarketDataProvider={normalizeMarketPrice:({closePrice,marketDate})=>({
    status:closePrice>0?'OK':'NEEDS_REVIEW',closePrice,sourceDate:marketDate,fallback:false
  })};
  const targetPredicate=source.match(/function _isCurrentPriceTarget\(item\) \{[\s\S]*?\n\}/)[0];
  const currencyNormalizer=source.match(/function _normalizeFetchedPriceCurrency\([^]*?\n\}/)[0];
  vm.runInContext(currencyNormalizer+'\n'+targetPredicate+'\n'+innerLoader,ctx);
  const pending=vm.runInContext("_fetchFromGsheetInner('2026-10-26',{persist:true,targetUrl:'test-gas',generation:1})",ctx);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls.length,Number(stocks)+Number(funds),'both independent reads start before either finishes');
  if(funds) {
    const fundCall=calls.find(x=>x.action==='getPriceHistory');
    assert.equal(fundCall.params.codes,'Fund');
    assert.equal(fundCall.params.to,'2026-10-26');
    assert.equal(fundCall.opts.targetUrl,'test-gas');
    if(fundFailure)finishFund(Error('fund offline'));
    else finishFund({status:'ok',prices:{Fund:[
      {date:'2026-10-23',price:90},{date:'2026-10-26',price:100}
    ]}});
  }
  if(stale) connected=false;
  if(stocks)finishStock({status:'ok',prices:{'005930':usdQuote?350:200},priceDates:{'005930':'2026-10-26'},...(usdQuote?{priceCurrencies:{'005930':'USD'},exchangeRates:missingFx?{}:{USD:1400}}:{})});
  const result=await pending;
  if(stale){assert.equal(result,null);assert.equal(ctx.window._gsheetPriceMeta,undefined);return;}
  assert.equal(result?.['005930'],stocks?(usdQuote?(missingFx?undefined:490000):200):undefined);
  assert.equal(result?.Fund,funds&&!fundFailure?100:undefined);
  if(funds&&!fundFailure)assert.equal(result.__gsheetPriceMeta.Fund.sourceDate,'2026-10-26');
}
await checkParallelHistory();
await checkParallelHistory({fundFailure:true});
await checkParallelHistory({stale:true});
await checkParallelHistory({stocks:false});
await checkParallelHistory({funds:false});
console.log('PASS: independent stock/fund reads overlap; failure isolation and stale-connection guard preserved');

await checkParallelHistory({usdQuote:true,funds:false});
await checkParallelHistory({usdQuote:true,missingFx:true,funds:false});
