import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import fs from 'node:fs';
import vm from 'node:vm';

const gas = isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs', 'utf8'));
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
  handleCurrentConfirmedPriceFetch:date=>{fallbackCount++;return {source:'current-confirmed-fixture',date}},
  Logger:{log:()=>{}},
};
vm.runInNewContext(legacyFetch,legacyContext,{filename:'legacy-price-fetch.gs'});
const cacheLine=(savedAt,sourceDate=savedAt.slice(0,10))=>[['005930',120000,'삼성전자',savedAt,sourceDate]];
cacheRows=cacheLine('2026-05-26 18:47');
if(legacyContext.handlePriceFetch().source!=='current-confirmed-fixture')
 throw Error('legacy May cache must never be current in October');
clock='1630';cacheRows=cacheLine('2026-10-07 18:47');
if(legacyContext.handlePriceFetch().source!=='current-confirmed-fixture')
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
if(legacyContext.handlePriceFetch().source!=='current-confirmed-fixture')
 throw Error('KRX holiday must reject cache predating its latest official session');
cacheRows=cacheLine('');
if(legacyContext.handlePriceFetch().source!=='current-confirmed-fixture')
 throw Error('cache with missing lastUpdated must not be treated as current');
currentDate='2026-10-08';clock='1630';
cacheRows=cacheLine('2026-10-08 16:22','2026-10-07');
if(legacyContext.handlePriceFetch().source!=='current-confirmed-fixture')
 throw Error('today update timestamp must not mask yesterday official source date');
cacheRows=[['005930',120000,'삼성전자','2026-10-08 16:22']];
if(legacyContext.handlePriceFetch().source!=='current-confirmed-fixture')
 throw Error('old four-column cache cannot assert source date');
if(fallbackCount!==6)throw Error('fallback count mismatch');

const latestCloseFn = gas.match(/function handleCurrentConfirmedPriceFetch\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
if (!latestCloseFn) throw Error('real cache-miss current close verifier missing');
let providerRows={}, providerOptions=[], domesticClock='1630';
const verifiedCurrentVm=vm.createContext({
  getCodeItems:()=>[
    {code:'005930',currency:'KRW',market:'KR'},
    {code:'AAPL',currency:'USD',market:'US'},
  ],
  CONFIG:{TIMEZONE:'Asia/Seoul'},
  Utilities:{formatDate:()=>domesticClock},
  _krxCalendarStatus_:()=> 'OPEN',
  _foreignMarketRegularCloseCutoff_:()=> '2026-10-07',
  _normalizeDate:v=>String(v||'').slice(0,10),
  _countBusinessWeekdaysBetween:(a,b)=>a===b?0:1,
  fetchPricesGoogleFinance:(_items,_date,_ss,options)=>{
    providerOptions.push(options);
    return providerRows;
  },
  jsonOk:x=>x,
  jsonError:message=>{throw Error(message)},
  calcMissing:(_codes,present)=>['005930','AAPL'].filter(code=>!present.includes(code)),
});
vm.runInContext(latestCloseFn,verifiedCurrentVm);
providerRows={
  '005930':{price:121000,usedDate:'2026-10-07',source:'KRX'},
  'AAPL':{price:260,usedDate:'2026-10-07',status:'CONFIRMED',priceType:'REGULAR_CLOSE'},
};
const emptyCacheResult=verifiedCurrentVm.handleCurrentConfirmedPriceFetch('2026-10-08',null,{});
if(emptyCacheResult.prices.AAPL?.price!==260 || '005930' in emptyCacheResult.prices)
  throw Error('empty cache path must preserve last NY close and reject stale KRX after close');

verifiedCurrentVm._foreignMarketRegularCloseCutoff_=()=> '2026-10-08';
const oneDayStale=verifiedCurrentVm.handleCurrentConfirmedPriceFetch('2026-10-08',null,{});
if('AAPL' in oneDayStale.prices)
  throw Error('empty cache cannot approve Yahoo T-1 when T regular close is complete');
verifiedCurrentVm._foreignMarketRegularCloseCutoff_=()=> '2026-10-07';

if(!providerOptions.at(-1)?.useMarketCloseCutoffs)
  throw Error('cache miss must request provider at completed market cutoffs');
domesticClock='0730';
providerRows={
  '005930':{price:121000,usedDate:'2026-10-08',source:'KRX'},
  'AAPL':{price:262,usedDate:'2026-10-08',status:'CONFIRMED',priceType:'REGULAR_CLOSE'},
};
const beforeCloseResult=verifiedCurrentVm.handleCurrentConfirmedPriceFetch('2026-10-08',null,{});
if(Object.keys(beforeCloseResult.prices).length!==0)
  throw Error('intraday KR quote and future US close must not be promoted to confirmed');
providerRows={
  '005930':{price:121000,usedDate:'2026-10-07',source:'KRX'},
  'AAPL':{price:260,usedDate:'2026-10-07',status:'CONFIRMED',priceType:'REGULAR_CLOSE'},
};
const morningResult=verifiedCurrentVm.handleCurrentConfirmedPriceFetch('2026-10-08',null,{});
if(morningResult.prices['005930']?.price!==121000 || morningResult.prices.AAPL?.price!==260)
  throw Error('pre-open read must preserve latest completed KRX and NY closes');


// Execute the real production provider, not a copy, to prevent the current-day
// KRX intraday TDD_CLSPRC from suppressing the previous completed close.
const providerProduction = gas.match(/function fetchPricesGoogleFinance\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
if(!providerProduction)throw Error('real fetchPricesGoogleFinance function not found');
let providerClock='1030', krxDates=[], providerOverride=null;
const providerVm=vm.createContext({
 CONFIG:{TIMEZONE:'Asia/Seoul'},
 Utilities:{formatDate:(instant,tz,fmt)=>{
   if(fmt==='HHmm')return providerClock;
   if(fmt==='yyyy-MM-dd')return instant.toISOString().slice(0,10);
   throw Error('unexpected format: '+fmt);
 }},
 _krxCalendarStatus_:date=>{
   if(date==='2026-10-05'||date==='2026-10-09'||[0,6].includes(new Date(date+'T12:00:00Z').getUTCDay()))
     return 'CLOSED';
   return date.startsWith('2028-')?'UNKNOWN':'OPEN';
 },
 _normalizeDate:v=>String(v||'').slice(0,10),
 _cleanCode:v=>String(v||'').trim(),
 _isFundCode:v=>/^F\d{5}$/.test(String(v||'')),
 fetchPricesKrx:(_items,date)=>{
   krxDates.push(date);
   const usedDate=providerOverride || date;
   return {'005930':{price:date==='2026-10-08'?125000:100000,usedDate,source:'KRX'}};
 },
 fetchPricesYahooRegularClose:()=>({}),
 Logger:{log:()=>{}}
});
const targetProduction=gas.match(/function _isKrxDailyCloseTarget_\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
if(!targetProduction)throw Error('production KRX target predicate not found');
vm.runInContext(targetProduction,providerVm);
vm.runInContext(providerProduction,providerVm);
const domestic=[{code:'005930',name:'삼성전자',currency:'KRW',market:'KR'}];
const queriedClose=(date,asOf)=>providerVm.fetchPricesGoogleFinance(domestic,date,null,
 {useMarketCloseCutoffs:true,asOf:new Date(asOf)});
let premarket=queriedClose('2026-10-08','2026-10-08T01:30:00Z');
if(krxDates.at(-1)!=='2026-10-07'||premarket['005930']?.usedDate!=='2026-10-07')
 throw Error('intraday cache miss must query exact previous completed official KRX session');
const afterHoliday=queriedClose('2026-10-06','2026-10-06T01:30:00Z');
if(krxDates.at(-1)!=='2026-10-02'||afterHoliday['005930']?.usedDate!=='2026-10-02')
 throw Error('previous KRX completed session must skip known holiday and weekend');
providerClock='1630';
let afterClose=queriedClose('2026-10-08','2026-10-08T08:30:00Z');
if(krxDates.at(-1)!=='2026-10-08'||afterClose['005930']?.price!==125000)
 throw Error('after 16:00, requested-date KRX path must remain intact');
providerClock='1030';
const unknownSession=queriedClose('2028-10-10','2028-10-10T01:30:00Z');
if(krxDates.at(-1)!=='2028-10-09'||unknownSession['005930']?.usedDate!=='2028-10-09')
 throw Error('UNKNOWN future calendar must not treat an intraday KRX quote as confirmed');
providerOverride='2026-10-01';
const carriedStale=queriedClose('2026-10-08','2026-10-08T01:30:00Z');
if('005930' in carriedStale)
 throw Error('KRX previous-session retry must reject an even older provider fallback');
providerOverride=null;
const holiday=queriedClose('2026-10-09','2026-10-09T01:30:00Z');
if(krxDates.at(-1)!=='2026-10-09'||holiday['005930']?.usedDate!=='2026-10-09')
 throw Error('CLOSED holiday read path must not be remapped to an intraday previous-day request');

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
const mixedLegacy=legacyContext.handlePriceFetch();
if(mixedLegacy.source!=='confirmed-close+validated-cache' || mixedLegacy.prices.AAPL.price!==260
  || mixedLegacy.prices['005930'].price!==121000)
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

foreignCutoff='2026-10-08';
cacheRows=[
  ['005930',120000,'삼성전자','2026-10-08 16:22','2026-10-08'],
  ['AAPL',260,'Apple','2026-10-08 15:20','2026-10-07'],
];
const staleTuesdayCache=legacyContext.handlePriceFetch();
if('AAPL' in (staleTuesdayCache.prices||{}))
  throw Error('one weekday behind expected US session cannot be accepted without holiday proof');
foreignCutoff='2026-10-07';



console.log('✅ 가격 provider·polling·펀드 timeout 소유권·Secret 노출 안전성 검사 통과');


const extractKrx=name=>{
 const re=new RegExp('function '+name+'\\([^)]*\\) \\{[\\s\\S]*?\\n\\}');
 const match=gas.match(re);
 if(!match)throw Error('KRX production function missing: '+name);
 return match[0];
};
const krxSlots=new Map([['krx_auth_key','stale-primary'],['krx_api_key','approved-legacy']]);
const krxVm=vm.createContext({
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>krxSlots.get(k)||''})},
 Logger:{log:()=>{}},
 _getKrxApiConfig:()=>({apiKey:'stale-primary'}),
 _getKrxEndpointByMarket:m=>'https://data-dbg.krx.co.kr/svc/apis/'+m,
 _cleanCode:v=>String(v||'').trim(), _parseKrxNumber:Number,
 _normalizeDate:v=>String(v||'').slice(0,10),
 _krxCalendarStatus_:d=>d==='2026-10-09'?'CLOSED':d.startsWith('2028-')?'UNKNOWN':'OPEN',
 fetchPricesKrxViaOtp:()=>({source:'OTP_FALLBACK'}),
});
for(const fn of ['_getKrxAuthKeySlots_','_getKrxAuthKey','fetchPricesKrx'])
 vm.runInContext(extractKrx(fn),krxVm);
if(krxVm._getKrxAuthKey()!=='stale-primary')
 throw Error('primary KRX credential precedence must be explicit');
if(krxVm._getKrxAuthKeySlots_().alternative!=='approved-legacy')
 throw Error('distinct approved legacy credential not visible for safe fallback');
krxSlots.delete('krx_auth_key');
if(krxVm._getKrxAuthKeySlots_().source!=='krx_api_key')
 throw Error('missing primary key must select legacy without requiring mutation');
krxSlots.set('krx_auth_key','stale-primary');
let krxFallbackCalls=[];
const deniedMarkets={
 KOSPI:{rows:[],usedYmd:'20261008',authHttpStatus:401},
 KOSDAQ:{rows:[],usedYmd:'20261008',authHttpStatus:403},
 ETF:{rows:[],usedYmd:'20261008',authHttpStatus:401},
};
krxVm._fetchKrxMarketsParallelWithFallback=(_m,_date,key)=>{
 krxFallbackCalls.push(key);
 return key==='stale-primary'?deniedMarkets:{
 KOSPI:{rows:[{ISU_CD:'005930',TDD_CLSPRC:'100000'}],usedYmd:'20261008'},
 KOSDAQ:{rows:[],usedYmd:'20261008'},
 ETF:{rows:[],usedYmd:'20261008'}};
};
const stock=krxVm.fetchPricesKrx([{code:'005930',name:'삼성전자'}],'2026-10-08');
if(stock['005930']?.price!==100000 || stock['005930']?.source!=='KRX')
 throw Error('approved alternate KRX credential must recover exact-date official close');
if(krxFallbackCalls.join('|')!=='stale-primary|approved-legacy')
 throw Error('alternate credential must be tried only after all markets auth-denied');
krxFallbackCalls=[];
krxVm._fetchKrxMarketsParallelWithFallback=(_markets,_date,key)=>{
 krxFallbackCalls.push({key,markets:_markets.slice()});
 return key==='stale-primary'
 ? {KOSPI:{rows:[{ISU_CD:'005930',TDD_CLSPRC:'100000'}],usedYmd:'20261008'},
    KOSDAQ:{rows:[],usedYmd:'20261008',authHttpStatus:401},
    ETF:{rows:[],usedYmd:'20261008',authHttpStatus:403}}
 : {KOSDAQ:{rows:[{ISU_CD:'000660',TDD_CLSPRC:'90000'}],usedYmd:'20261008'},
    ETF:{rows:[],usedYmd:'20261008',authHttpStatus:403}};
};
const mixed=krxVm.fetchPricesKrx([{code:'005930',name:'삼성전자'},{code:'000660',name:'SK하이닉스'}],'2026-10-08');
if(mixed['005930']?.price!==100000||mixed['000660']?.price!==90000)
 throw Error('primary successful KOSPI must survive alternate KOSDAQ key repair');
if(krxFallbackCalls.length!==2 ||
 krxFallbackCalls[0].markets.join(',')!=='KOSPI,KOSDAQ,ETF' ||
 krxFallbackCalls[1].markets.join(',')!=='KOSDAQ,ETF')
 throw Error('retry only individually auth-rejected KRX markets, not healthy markets');
krxFallbackCalls=[];
krxVm._fetchKrxMarketsParallelWithFallback=(_markets,_date,key)=>{
 krxFallbackCalls.push({key,markets:_markets.slice()});
 return {KOSPI:{rows:[{ISU_CD:'005930',TDD_CLSPRC:'100000'}],usedYmd:'20261008'},
 KOSDAQ:{rows:[],usedYmd:'20261008'},ETF:{rows:[],usedYmd:'20261008'}};
};
krxVm.fetchPricesKrx([{code:'005930',name:'삼성전자'}],'2026-10-08');
if(krxFallbackCalls.length!==1)
 throw Error('missing rows without HTTP 401/403 must never trigger credential switch');

krxVm.fetchPricesKrxViaOtp=missing=>Object.fromEntries(missing.map(item=>
 [item.code,{price:item.code==='000660'?91000:110000,name:item.name,
  source:'KRX_OTP',usedDate:'2026-10-08'}]));
krxVm._fetchKrxMarketsParallelWithFallback=(_markets,_date,key)=>
 key==='stale-primary'
  ? {KOSPI:{rows:[],usedYmd:'20261008',authHttpStatus:401},
     KOSDAQ:{rows:[],usedYmd:'20261008',authHttpStatus:403},
     ETF:{rows:[],usedYmd:'20261008',authHttpStatus:401}}
  : {KOSPI:{rows:[{ISU_CD:'005930',TDD_CLSPRC:'100000'}],usedYmd:'20261008'},
     KOSDAQ:{rows:[],usedYmd:'20261008',authHttpStatus:403},
     ETF:{rows:[],usedYmd:'20261008',authHttpStatus:403}};
const mixedOtp=krxVm.fetchPricesKrx([{code:'005930',name:'삼성전자'},
  {code:'000660',name:'SK하이닉스'}],'2026-10-08');
if(mixedOtp['005930']?.source!=='KRX'||mixedOtp['000660']?.source!=='KRX_OTP')
 throw Error('partially authorized alternate key must fill missing market from OTP without clobbering healthy market');
krxVm._fetchKrxMarketsParallelWithFallback=(_markets,_date,key)=>{
 if(key==='approved-legacy')throw new Error('SIMULATED_NETWORK_FAILURE');
 return {KOSPI:{rows:[{ISU_CD:'005930',TDD_CLSPRC:'100000'}],usedYmd:'20261008'},
  KOSDAQ:{rows:[],usedYmd:'20261008',authHttpStatus:403},
  ETF:{rows:[],usedYmd:'20261008',authHttpStatus:403}};
};
const preserved=krxVm.fetchPricesKrx([{code:'005930',name:'삼성전자'}],'2026-10-08');
if(preserved['005930']?.price!==100000)
 throw Error('alternate network failure must preserve primary KOSPI prices');

let otpRequeryCodes=[];
krxVm._fetchKrxMarketsParallelWithFallback=()=>({
 KOSPI:{rows:[{ISU_CD:'005930',TDD_CLSPRC:'90000'}],usedYmd:'20261007'},
 KOSDAQ:{rows:[],usedYmd:'20261008'},ETF:{rows:[],usedYmd:'20261008'}
});
krxVm.fetchPricesKrxViaOtp=items=>{
 otpRequeryCodes.push(items.map(item=>item.code));
 return {'005930':{price:100000,source:'KRX_OTP',usedDate:'2026-10-08'}};
};
const repairedStale=krxVm.fetchPricesKrx([{code:'005930',name:'삼성전자'}],'2026-10-08');
if(repairedStale['005930']?.price!==100000
 || repairedStale['005930']?.source!=='KRX_OTP'
 || otpRequeryCodes.at(-1).join(',')!=='005930')
 throw Error('T-1 OpenAPI close must re-query and accept exact-day OTP close');
krxVm.fetchPricesKrxViaOtp=items=>{
 otpRequeryCodes.push(items.map(item=>item.code));
 return {'005930':{price:100000,source:'KRX_OTP',usedDate:'2026-10-07'}};
};
const rejectedStaleOtp=krxVm.fetchPricesKrx([{code:'005930',name:'삼성전자'}],'2026-10-08');
if(rejectedStaleOtp['005930']?.price!==90000
 || rejectedStaleOtp['005930']?.usedDate!=='2026-10-07')
 throw Error('OTP carry must not replace stale KRX with another stale date');
krxVm._fetchKrxMarketsParallelWithFallback=()=>({
 KOSPI:{rows:[{ISU_CD:'005930',TDD_CLSPRC:'100000'}],usedYmd:'20261008'},
 KOSDAQ:{rows:[],usedYmd:'20261008'},ETF:{rows:[],usedYmd:'20261008'}
});
const callsBeforeExact=otpRequeryCodes.length;
const alreadyExact=krxVm.fetchPricesKrx([{code:'005930',name:'삼성전자'}],'2026-10-08');
if(alreadyExact['005930']?.price!==100000 || otpRequeryCodes.length!==callsBeforeExact)
 throw Error('exact OpenAPI close must not be needlessly re-queried via OTP');

krxVm._fetchKrxMarketsParallelWithFallback=()=>({
 KOSPI:{rows:[{ISU_CD:'005930',TDD_CLSPRC:'99000'}],usedYmd:'20281009'},
 KOSDAQ:{rows:[],usedYmd:'20281010'},ETF:{rows:[],usedYmd:'20281010'}
});
krxVm.fetchPricesKrxViaOtp=items=>{
 otpRequeryCodes.push(items.map(item=>item.code));
 return {'005930':{price:102000,source:'KRX_OTP',usedDate:'2028-10-10'}};
};
const unknownYearRecovered=krxVm.fetchPricesKrx([{code:'005930',name:'삼성전자'}],'2028-10-10');
if(unknownYearRecovered['005930']?.price!==102000
 || unknownYearRecovered['005930']?.usedDate!=='2028-10-10'
 || otpRequeryCodes.at(-1).join(',')!=='005930')
 throw Error('UNKNOWN calendar year must re-query T-1 close and accept exact-date official OTP');
krxVm._fetchKrxMarketsParallelWithFallback=()=>({
 KOSPI:{rows:[{ISU_CD:'005930',TDD_CLSPRC:'90000'}],usedYmd:'20261008'},
 KOSDAQ:{rows:[],usedYmd:'20261009'},ETF:{rows:[],usedYmd:'20261009'}
});
const beforeClosed=otpRequeryCodes.length;
const holidayCarry=krxVm.fetchPricesKrx([{code:'005930',name:'삼성전자'}],'2026-10-09');
if(holidayCarry['005930']?.usedDate!=='2026-10-08'
 || otpRequeryCodes.length!==beforeClosed)
 throw Error('verified CLOSED session must preserve T-1 official close without exact-date OTP retry');



if(extractKrx('configureKrxAuthKeyPrompt').indexOf("props.deleteProperty('krx_api_key')")<0)
 throw Error('manual clear of primary KRX key must remove legacy key too');
