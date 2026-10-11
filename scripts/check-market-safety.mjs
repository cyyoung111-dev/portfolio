import fs from 'node:fs';
import vm from 'node:vm';

const gas = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const web = fs.readFileSync('src/web/features/settings/settings_fetch.js', 'utf8');
const trade = fs.readFileSync('src/web/features/trade/editor/mgmt_trade.js', 'utf8');

const priceFn = gas.match(/function\s+fetchPricesGoogleFinance\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
if (!priceFn || /GOOGLEFINANCE\s*\(/.test(priceFn[1])) {
  console.error('❌ 주식·ETF 가격 provider 함수에 GOOGLEFINANCE 호출이 남아 있습니다.');
  process.exit(1);
}
if (!/fetchPricesYahooRegularClose/.test(priceFn[1]) || !/fetchPricesKrx/.test(priceFn[1]) || !/return prices/.test(priceFn[1])) {
  console.error('❌ 가격 fallback이 Toss → KRX → 저장값 보존 구조가 아닙니다.');
  process.exit(1);
}
if (!/persist:\s*false/.test(web) || !/visibilitychange/.test(web)) {
  console.error('❌ polling 저장 분리 또는 hidden 처리 계약이 없습니다.');
  process.exit(1);
}
if (!/te-action-wrap/.test(trade) || !/trade\.ratio\s*=\s*ratio/.test(trade)
    || !/trade\.fractionalCash/.test(trade) || !/tradeType === 'split'/.test(trade)) {
  console.error('❌ SPLIT/REVERSE_SPLIT 입력·검증·단주정산 경로가 없습니다.');
  process.exit(1);
}
if (!/비율.*단주정산/.test(gas) || !/row\[9\]/.test(gas) || !/fractionalCash/.test(gas)) {
  console.error('❌ 거래 원장의 Corporate Action 확장 컬럼 또는 읽기 경로가 없습니다.');
  process.exit(1);
}

const forbidden = /(TOSS_CLIENT_SECRET|TOSS_CLIENT_ID)\s*[:=]\s*['"][^'"]{12,}['"]/;
if (forbidden.test(gas) || forbidden.test(web)) {
  console.error('❌ Toss 인증정보가 소스에 하드코딩되어 있습니다.');
  process.exit(1);
}
// The production legacy GET handler used to return nonempty 2026-05-26
// cache as a current price even in October. Exercise the real handler.
const legacyFetch = gas.match(/function handlePriceFetch\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
if (!legacyFetch) throw new Error('legacy price fetch production handler missing');
let currentDate='2026-10-08', clock='1630', cacheRows=[], fallbackCount=0;
let codeMaster=[{code:'005930',currency:'KRW',market:'KR'}], requestedFetches=[], foreignCutoff='2026-10-07';
const legacyContext={
  getss:()=>({getSheetByName:()=>({
    getLastRow:()=>cacheRows.length+1,
    getRange:()=>({getValues:()=>cacheRows}),
  })}),
  today:()=>currentDate,
  getCodeItems:()=>codeMaster,
  _foreignMarketRegularCloseCutoff_:()=>foreignCutoff,
  fetchPricesGoogleFinance:items=>{
    requestedFetches.push(items.map(item=>item.code));
    return Object.fromEntries(items.filter(item=>item.code==='005930').map(item=>[
      item.code,{price:121000,usedDate:currentDate,status:'CONFIRMED',priceType:'REGULAR_CLOSE'}
    ]));
  },
  CONFIG:{SHEET_PRICES:'종가',TIMEZONE:'Asia/Seoul'},
  _normalizeDate:v=>String(v||'').slice(0,10),
  _krxCalendarStatus_:date=>date==='2026-10-09'?'CLOSED':'OPEN',
  _countBusinessWeekdaysBetween:(from,to)=>{
    if(from===to)return 0;
    if(from==='2026-10-08'&&to==='2026-10-09')return 0;
    if(from==='2026-10-07'&&to==='2026-10-09')return 1;
    if(from==='2026-10-07'&&to==='2026-10-08')return 1;
    return 90;
  },
  Utilities:{formatDate:()=>clock},
  jsonOk:x=>x,jsonError:message=>{throw Error(message)},
  calcMissing:()=>[],
  handleHistoricalPriceFetch:date=>{fallbackCount++;return {source:'historical',date}},
  Logger:{log:()=>{}},
};
vm.runInNewContext(legacyFetch,legacyContext,{filename:'legacy-price-fetch.gs'});
const cacheLine=(savedAt,sourceDate=savedAt.slice(0,10))=>[['005930',120000,'삼성전자',savedAt,sourceDate]];
cacheRows=cacheLine('2026-05-26 18:47');
if(legacyContext.handlePriceFetch().source!=='historical')
 throw Error('legacy May cache must never be current in October');
clock='1630';cacheRows=cacheLine('2026-10-07 18:47');
if(legacyContext.handlePriceFetch().source!=='historical')
 throw Error('after 16:00 KRX OPEN requires same-day cache');
clock='0730';
if(legacyContext.handlePriceFetch().source!=='cache')
 throw Error('morning KRX OPEN may use the preceding session close as indicative legacy cache');
clock='1630';cacheRows=cacheLine('2026-10-08 16:22');
if(legacyContext.handlePriceFetch().source!=='cache')
 throw Error('today updated cache should be available to legacy clients');
currentDate='2026-10-09';
if(legacyContext.handlePriceFetch().source!=='cache')
 throw Error('KRX holiday may use the last official-session cache');
cacheRows=cacheLine('2026-10-07 16:22');
if(legacyContext.handlePriceFetch().source!=='historical')
 throw Error('KRX holiday must reject cache predating its latest official session');
cacheRows=cacheLine('');
if(legacyContext.handlePriceFetch().source!=='historical')
 throw Error('cache with missing lastUpdated must not be treated as current');
currentDate='2026-10-08';clock='1630';
cacheRows=cacheLine('2026-10-08 16:22','2026-10-07');
if(legacyContext.handlePriceFetch().source!=='historical')
 throw Error('today update timestamp must not mask yesterday official source date');
cacheRows=[['005930',120000,'삼성전자','2026-10-08 16:22']];
if(legacyContext.handlePriceFetch().source!=='historical')
 throw Error('old four-column cache cannot assert source date');
if(fallbackCount!==6)throw Error('fallback count mismatch');

// A mixed KR+US portfolio must not reject a valid NY close just because the
// calendar date differs from the KRX session. Preserve valid overseas closes
// while re-querying only stale domestic rows.
currentDate='2026-10-08';clock='1630';foreignCutoff='2026-10-07';
codeMaster=[
  {code:'005930',currency:'KRW',market:'KR'},
  {code:'AAPL',currency:'USD',market:'US'},
];
cacheRows=[
  ['005930',120000,'삼성전자','2026-10-07 16:22','2026-10-07'],
  ['AAPL',260,'Apple','2026-10-08 15:20','2026-10-07'],
];
const mixed=legacyContext.handlePriceFetch();
if(mixed.source!=='confirmed-close+validated-cache' || mixed.prices.AAPL.price!==260
  || mixed.prices['005930'].price!==121000)
  throw Error('valid prior NY close must survive stale KRX row refresh');
if(requestedFetches.at(-1).join(',')!=='005930')
  throw Error('valid overseas cache must not trigger a needless re-fetch');
foreignCutoff='2026-10-09';
const future=legacyContext.handlePriceFetch();
if(future.source==='cache' || 'AAPL' in (future.prices||{}))
  throw Error('stale foreign closes must not be treated as current');
foreignCutoff='2026-10-07';
cacheRows=[
  ['005930',120000,'삼성전자','2026-10-08 16:22','2026-10-08'],
  ['AAPL',260,'Apple','2026-10-08 15:20','2026-10-08'],
];
const futureUs=legacyContext.handlePriceFetch();
if('AAPL' in (futureUs.prices||{}))
  throw Error('foreign market close dated after last completed session is invalid');


console.log('✅ 가격 provider·polling·Corporate Action·Secret 노출 안전성 검사 통과');
