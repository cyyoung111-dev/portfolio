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
const legacyContext={
  getss:()=>({getSheetByName:()=>({
    getLastRow:()=>cacheRows.length+1,
    getRange:()=>({getValues:()=>cacheRows}),
  })}),
  today:()=>currentDate,
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
const cacheLine=(savedAt)=>[['005930',120000,'삼성전자',savedAt]];
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
if(fallbackCount!==4)throw Error('fallback count mismatch');


// Automated fund evaluation must leave a durable same-owner completion marker;
// hard GAS timeouts skip catch/finally and otherwise produce no ERROR/DONE log.
const fundFn = gas.match(/function runDailyFundValuations\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
const fundDiagnosticFn = gas.match(/function _fundAttemptDiagnosticState_\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
if (!fundFn || !fundDiagnosticFn
    || !/fund_last_attempt_completion_v1/.test(fundFn)
    || !/publishIfOwner\(function\(p\)/.test(fundFn))
  throw new Error('fund run completion must be published by matching owner only');
const clockMs = Date.parse('2026-10-10T00:00:00Z');
const context={};
vm.runInNewContext(fundDiagnosticFn, context, {filename:'fund-attempt-diagnostic.gs'});
const owner={date:'2026-10-09',token:'owner-A',startedAt:clockMs-8*60*1000};
const attempt = (completed)=>context._fundAttemptDiagnosticState_(owner,completed,clockMs);
if(attempt(null).state!=='TIMEOUT_SUSPECTED')
  throw new Error('hard-killed NAV must surface a timeout suspect after 7 minutes');
if(attempt({date:owner.date,token:'owner-B',state:'DONE',at:clockMs}).state!=='TIMEOUT_SUSPECTED')
  throw new Error('another attempt may not complete an orphaned NAV owner');
if(attempt({date:owner.date,token:'owner-A',state:'DONE',at:clockMs}).state!=='DONE')
  throw new Error('same owner DONE marker must reconcile');
if(attempt({date:owner.date,token:'owner-A',state:'ERROR',at:clockMs}).state!=='ERROR')
  throw new Error('same owner ERROR marker must reconcile');
if(context._fundAttemptDiagnosticState_(null,null,clockMs)!==null)
  throw new Error('no owner should not imply a running fund');
if(context._fundAttemptDiagnosticState_({date:owner.date,token:owner.token},null,clockMs).state!=='UNKNOWN_LEGACY')
  throw new Error('legacy NAV without start timestamp must not appear permanently in progress');
if(context._fundAttemptDiagnosticState_({...owner,startedAt:clockMs-10*1000},null,clockMs).state!=='IN_PROGRESS')
  throw new Error('fresh NAV attempt must not be labelled a hard timeout');
for(const state of [attempt(null),attempt({date:owner.date,token:'owner-A',state:'DONE',at:clockMs})]){
  if(JSON.stringify(state).includes('owner-A'))throw new Error('fund owner token leaked through diagnostics');
}

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
krxVm._fetchKrxMarketsParallelWithFallback=(_m,_date,key)=>{
 krxFallbackCalls.push(key);
 return {KOSPI:{rows:[{ISU_CD:'005930',TDD_CLSPRC:'100000'}],usedYmd:'20261008'},
 KOSDAQ:{rows:[],usedYmd:'20261008',authHttpStatus:401},ETF:{rows:[],usedYmd:'20261008',authHttpStatus:403}};
};
krxVm.fetchPricesKrx([{code:'005930',name:'삼성전자'}],'2026-10-08');
if(krxFallbackCalls.length!==1)
 throw Error('partial authorized KRX response must not switch credentials');
if(extractKrx('configureKrxAuthKeyPrompt').indexOf("props.deleteProperty('krx_api_key')")<0)
 throw Error('manual clear of primary KRX key must remove legacy key too');
