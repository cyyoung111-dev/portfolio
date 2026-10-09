import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const extract = name => {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' must exist');
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, name + ' must have closing brace');
  return source.slice(start, end + 2);
};
const closeSection = extract('saveDailyPriceHistory');
const freshnessCall = closeSection.indexOf('_assessDailyKrxStockClose(items, krxPrev, requestedCloseDate)');
const firstPriceWrite = closeSection.indexOf('batchUpsertPriceHistory(ss, actualDate');
assert.ok(freshnessCall >= 0 && firstPriceWrite > freshnessCall,
  'KRX 거래일/coverage 검증은 가격이력 쓰기보다 먼저 해야 함');
assert.match(closeSection, /snapshotDate = _selectPortfolioCloseSnapshotDate_\(requestedCloseDate, closeVerification\.date/,
  'KRX 정상거래일은 공식 확정일을 유지하고 휴장일에만 검증된 해외 정규장 날짜를 선택');
assert.doesNotMatch(closeSection, /fetchedRowCount === 0 && !_getLatestPriceHistoryDate/,
  '기존 가격이력 존재를 신규 종가 조회 성공으로 오판하지 않아야 함');

// 거래원장 기준 실보유 코드만 종가 조회·검증. 마스터의 과거 매도 종목은 제외.
// helper와 snapshot 원장의 동일 보유수량 계산 로직을 실제로 재사용해 검증합니다.
assert.match(closeSection, /var items = _getDailyHeldCodeItems\(ss, requestedCloseDate, allItems\)/,
  '일일 KRX fetch의 items는 마스터가 아닌 평가일 기준 실보유 목록이어야 함');
const holdingsVm = vm.createContext({
  _cleanCode:v=>String(v||'').trim().toUpperCase(),
  _isFundCode:v=>/^F\d{5}$/.test(String(v||'')),
  _normalizeDate:v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10),
  CONFIG:{SHEET_TRADES:'거래이력'},
  Utilities:{formatDate:d=>d.toISOString().slice(0,10)}
});
for (const name of ['_applyHoldingTrade','_snapshotHoldingState','calcHoldingsAtDate','_calcCodeHoldingsAtDate','_getDailyHeldCodeItems']) {
  vm.runInContext(extract(name),holdingsVm);
}
const masterItems=[
  {code:'005930',name:'삼성전자',currency:'KRW',type:'주식',market:'KOSPI'},
  {code:'000660',name:'개명 후 이름',currency:'KRW',type:'주식',market:'KOSPI'},
  {code:'091160',name:'보유 ETF',currency:'KRW',type:'ETF',market:'KR'},
  {code:'F00002',name:'KB 밸류포커스',currency:'KRW',type:'펀드'},
  {code:'AAPL',name:'미래 매수 미국주식',currency:'USD',type:'주식'}
];
const trade=(date,kind,name,code,qty)=>[date,kind,'',name,code,qty,1000,'주식'];
const tradeHistory=[
  trade('2026-09-25','buy','삼성전자','005930',5),
  trade('2026-09-25','buy','개명 전 이름','000660',2),
  trade('2026-09-30','sell','개명 후 이름','000660',2),
  trade('2026-10-02','buy','보유 ETF','091160',4),
  trade('2026-10-01','buy','KB 밸류포커스','F00002',1),
  trade('2026-10-07','sell','보유 ETF','091160',4),
  trade('2026-10-08','buy','미래 매수 미국주식','AAPL',2),
];
const ledgerSheet={getLastRow:()=>tradeHistory.length+1,
  getLastColumn:()=>11,getRange:()=>({getValues:()=>tradeHistory})};
const portfolioSheet={getSheetByName:n=>n==='거래이력'?ledgerSheet:null};
const heldAt=(date,catalog=masterItems)=>JSON.parse(JSON.stringify(holdingsVm._getDailyHeldCodeItems(portfolioSheet,date,catalog))).map(x=>x.code);
assert.deepEqual(heldAt('2026-10-06'),['005930','091160'],
  '종목명 변경 전 매수·변경 후 전량 매도를 동일 코드로 상계해 KRX 대상에서 제외');
// 중앙 reducer의 코드 기준 집계는 Snapshot 범위 진단과 소급채우기에서도 공유합니다.
vm.runInContext(extract('_buildHoldingsByRequestedDate'),holdingsVm);
const normalizedLedger=JSON.parse(JSON.stringify(holdingsVm.calcHoldingsAtDate(
  tradeHistory,'2026-10-06',{})));
assert.equal(Object.hasOwn(normalizedLedger,'000660'),false,
  '기존 calcHoldingsAtDate가 개명 전 매수·개명 후 매도 후 유령 종목을 남겨선 안 됨');
const indexedHoldings=JSON.parse(JSON.stringify(holdingsVm._buildHoldingsByRequestedDate(
  tradeHistory,['2026-09-29','2026-10-06'],{})));
assert.equal(indexedHoldings['2026-09-29']['000660'].qty,2,
  '과거 평가일에는 개명 전 실제 보유를 정확하게 유지');
assert.equal(Object.hasOwn(indexedHoldings['2026-10-06'],'000660'),false,
  '기간 진단/손익 원자료 인덱스에서도 전량 매도한 코드 제외');
const splitTrade=trade('2026-10-02','split','개명 후 삼성전자','005930',0);
splitTrade[9]=2;
const splitLedger=[
  trade('2026-09-25','buy','개명 전 삼성전자','005930',10),
  splitTrade,
  trade('2026-10-06','sell','개명 후 삼성전자','005930',5)
];
const splitCalc=JSON.parse(JSON.stringify(holdingsVm.calcHoldingsAtDate(splitLedger,'2026-10-06',{})));
assert.equal(splitCalc['005930'].qty,15,'개명·액면분할·매도를 코드 기준으로 합산');
assert.equal(splitCalc['005930'].costAmt,7500,'기존 이동평균원가/액면분할 계산 유지');

assert.deepEqual(heldAt('2026-09-29'),['005930','000660'],
  '과거 기준일에는 이후 매도한 종목도 당시 실제 보유이므로 포함');
assert.deepEqual(heldAt('2026-10-07'),['005930'],
  '평가일 당일 전량매도한 ETF는 즉시 분모에서 제외');
// Snapshot도 같은 코드별 잔고 계산을 사용해야 개명 전 매수 잔액이 유령 보유분으로 남지 않습니다.
const snapshotSection = extract('_buildSnapshotRowsFromTradeAndPriceHistory');
assert.match(snapshotSection,/_calcCodeHoldingsAtDate\(tradeData, dateStr, nameToCode, displayByCode\)/,
  'Snapshot 재구성은 일일 KRX 실보유 검증과 동일한 코드 기준 집계 사용');
const snapshotVm=vm.createContext({
  CONFIG:{SHEET_TRADES:'거래이력'},
  _cleanCode:v=>String(v||'').trim().toUpperCase(),
  _normalizeDate:v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10),
  _isFundCode:v=>/^F\d{5}$/.test(String(v||'')),
  Utilities:{formatDate:d=>d.toISOString().slice(0,10)},
  Logger:{log(){}},
  getCodeItems:()=>masterItems,
  _readFundUnits:()=>[],
  _applyFundUnitLifecycleToSnapshotHoldings:h=>h,
  _getFundEvaluationAtDate:(_ss,code)=>code==='F00002'?{evalAmt:100000,carried:false,sourceDate:'2026-10-06'}:null,
  getPriceHistoryRow:()=>({'005930':2000,'091160':3000,'F00002':100000}),
  _getPriceSourceByDate:()=>({'005930':{src:'KRX'},'091160':{src:'KRX'},'F00002':{src:'FUND_NAV'}}),
  getLatestPriceHistoryEntries:()=>({}),
  _getHistoricalExchangeRates:()=>({}),
  _dedupeSnapshotRows:rows=>rows
});
for(const name of ['_applyHoldingTrade','_snapshotHoldingState','calcHoldingsAtDate',
  '_calcCodeHoldingsAtDate','_buildSnapshotRowsFromTradeAndPriceHistory']) {
  vm.runInContext(extract(name),snapshotVm);
}
const savedSnapshot=JSON.parse(JSON.stringify(snapshotVm._buildSnapshotRowsFromTradeAndPriceHistory(
  portfolioSheet,'2026-10-06',true)));
assert.deepEqual(savedSnapshot.map(row=>row[1]).sort(),['005930','091160','F00002'],
  '개명 전 매수·후 전량매도 코드는 Snapshot 생성에도 포함 금지; 타 종목/펀드는 보존');
assert.equal(savedSnapshot.find(row=>row[1]==='005930')[7],10000,
  'Snapshot의 실제 보유종목 평가금액 유지');

const onlySoldMaster=masterItems.filter(x=>x.code==='000660');
assert.deepEqual(heldAt('2026-10-06',onlySoldMaster),[],
  '보유가 0인 마스터 종목만 남은 경우 종가 수집을 요구하지 않음');
const liveOnly=JSON.parse(JSON.stringify(holdingsVm._getDailyHeldCodeItems(portfolioSheet,'2026-10-06',masterItems)));
assert.equal(liveOnly.length,2);
assert.doesNotMatch(closeSection,/var items = getCodeItems\(ss\);/,
  '일일 마감에 전체 코드 마스터를 그대로 전달하면 안 됨');

// 운영 펀드기준가격 A/E열 DATE 서식: 쓰기 입력 문자열이 read-back Date로 반환돼도 동일 날짜로 검증.
const navVerifierContext = vm.createContext({
  SpreadsheetApp:{flush() {}},
  _normalizeDate:v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10)
});
vm.runInContext(extract('_verifyFundNavWrittenRange'), navVerifierContext);
const expectedNavRow = ['2026-09-22','F00002','KB 밸류포커스 (주식)',2658.2,'2026-09-22',
  37287386,99117394,'2026-10-07T03:35:00.000Z','KB_VALUE_ST'];
const actualNavRow = [new Date('2026-09-22T00:00:00Z'),...expectedNavRow.slice(1,4),
  new Date('2026-09-22T00:00:00Z'),...expectedNavRow.slice(5)];
const navSheet = row=>({getRange:()=>({getValues:()=>[row]})});
assert.doesNotThrow(()=>navVerifierContext._verifyFundNavWrittenRange(navSheet(actualNavRow),2,[expectedNavRow]),
  '정상 날짜 서식 Date와 YYYY-MM-DD 문자열을 동일 날짜로 판정');
const alteredNavRow=actualNavRow.slice();alteredNavRow[3]=2660;
assert.throws(()=>navVerifierContext._verifyFundNavWrittenRange(navSheet(alteredNavRow),2,[expectedNavRow]),
  /행 2 열 4/, '실제 NAV 금액 변경은 검증 통과 금지');
const alteredDateRow=actualNavRow.slice();alteredDateRow[4]=new Date('2026-09-23T00:00:00Z');
assert.throws(()=>navVerifierContext._verifyFundNavWrittenRange(navSheet(alteredDateRow),2,[expectedNavRow]),
  /행 2 열 5/, '공시일 변경은 검증 통과 금지');
const alteredProviderRow=actualNavRow.slice();alteredProviderRow[8]='OTHER';
assert.throws(()=>navVerifierContext._verifyFundNavWrittenRange(navSheet(alteredProviderRow),2,[expectedNavRow]),
  /행 2 열 9/, '클래스 불일치는 검증 통과 금지');
assert.match(source, /_verifyFundNavWrittenRange\(navSheet, 2, storedNav\)/,
  '펀드 NAV 저장 경로에 날짜 서식 정규화 검증 함수 연결');

const context = vm.createContext({
  _cleanCode: v => String(v || '').trim(),
  _isFundCode: v => /^F\d{5}$/.test(v),
  _normalizeDate: v => String(v || ''),
  _fundDateOffset: (v, days) => {
    const d = new Date(v + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0,10);
  },
  FUND_PROVIDERS: {
    KB_VALUE_ST: { source:'FUNETF' },
    HANWHA_2045_CRPE: { source:'HANWHA' }
  },
  FUND_NAV_FETCH_BATCH_DAYS: 14,
  FUND_NAV_FETCH_RETRIES: 1,
  _fundRecoveryDiagnosticStart() {},
  _fundRecoveryDiagnosticFinish() {},
});
const holidayStart = source.indexOf('var KRX_CONFIRMED_CLOSED_DATES_2026 =');
assert.ok(holidayStart >= 0, '공식 휴장일 판별 자료 누락');
const holidayEnd = source.indexOf('\n};',holidayStart);
assert.ok(holidayEnd > holidayStart, '공식 휴장일 자료 문법 오류');
const holiday2027Start = source.indexOf('var KRX_CONFIRMED_CLOSED_DATES_2027 =');
const holiday2027End = source.indexOf('\n};',holiday2027Start);
assert.ok(holiday2027Start >= 0 && holiday2027End > holiday2027Start,'2027 휴장일 목록 누락');
vm.runInContext([
  source.slice(holidayStart,holidayEnd+3), source.slice(holiday2027Start,holiday2027End+3),
  extract('_krxCalendarStatus_'),extract('_countBusinessWeekdaysBetween'),extract('_assessDailyKrxStockClose'),
  extract('_fetchMissingFundNavBatches')
].join('\n'), context);
const clone = obj => JSON.parse(JSON.stringify(obj));
const items = [
  {code:'005930',currency:'KRW'}, {code:'000660',currency:'KRW'},
  {code:'091160',currency:'KRW'}, {code:'133690',currency:'KRW'},
  {code:'F00002',currency:'KRW'}, {code:'AAPL',currency:'USD'}
];
const close = (date,source='KRX')=>({usedDate:date,source,price:1500});
const full = Object.fromEntries(items.slice(0,4).map(x=>[x.code,close('2026-10-06')]));
const good = clone(context._assessDailyKrxStockClose(items, full,'2026-10-06'));
assert.deepEqual(good,{required:true,date:'2026-10-06',confirmed:4,expected:4,lag:0});
const holiday = clone(context._assessDailyKrxStockClose(items,Object.fromEntries(items.slice(0,4).map(x=>[x.code,close('2026-10-02')])), '2026-10-05'));
assert.equal(holiday.date,'2026-10-02','월요일 대체공휴일은 직전 확정 KRX 거래일을 허용');
assert.equal(holiday.lag,0,'공식 휴장일은 거래일 시차에서 제외');
assert.equal(context._countBusinessWeekdaysBetween('2026-02-13','2026-02-19'),1,
  '설날 연휴 3평일(2/16~18)은 정상 휴장으로 간주');
assert.equal(context._countBusinessWeekdaysBetween('2026-09-29','2026-10-06'),4,
  '실제 거래일 9/30,10/1,10/2,10/6을 휴일로 잘못 처리하지 않음');
assert.throws(()=>context._assessDailyKrxStockClose(items, {},'2026-10-06'),/KRX 확정 종가 0건/,
  '기존 펀드 NAV/가격이력이 있어도 일반 KRX 조회 0건이면 실패');
assert.throws(()=>context._assessDailyKrxStockClose(items,Object.fromEntries(items.slice(0,4).map(x=>[x.code,close('2026-09-29')])), '2026-10-06'),/확정 종가 오래됨/,
  '휴장 일괄 처리로 오래된 KRX 종가 무기한 이월 금지');
assert.throws(()=>context._assessDailyKrxStockClose(items, {'005930':close('2026-10-06')},'2026-10-06'),/부분 누락/,
  '삼성전자 1개 종가만 확보해 4종목 전체를 성공 처리하면 안 됨');
assert.equal(context._assessDailyKrxStockClose([{code:'F00001'},{code:'AAPL',currency:'USD'}],{},'2026-10-06').required,false,
  '국내 상장종목이 없는 환경은 별도 처리');
assert.equal(context._assessDailyKrxStockClose(items,Object.fromEntries(items.slice(0,4).map(x=>[x.code,close('2026-10-06','KRX_OTP')])), '2026-10-06').confirmed,4,
  'KRX OTP의 실제 날짜 종가도 확정 소스로 허용');
const segmented = Array.from({length:10},(_,i)=>({code:String(100000+i),currency:'KRW',type:i>=8?'ETF':'주식',market:i>=8?'KR':'KOSPI'}));
const onlyStocks = Object.fromEntries(segmented.slice(0,8).map(x=>[x.code,close('2026-10-06')]));
assert.throws(()=>context._assessDailyKrxStockClose(segmented,onlyStocks,'2026-10-06'),/ETF/,
  'KOSPI 8개만 성공하고 ETF 2개가 전부 누락되면 전체 80% 성공이라도 실패');
const allSegmented = Object.fromEntries(segmented.map(x=>[x.code,close('2026-10-06')]));
allSegmented._krxMarketEvidence = {
  KOSPI:{count:200,date:'2026-10-06'}, KOSDAQ:{count:0,date:'2026-10-06'}, ETF:{count:300,date:'2026-10-06'}
};
assert.equal(context._assessDailyKrxStockClose(segmented,allSegmented,'2026-10-06').confirmed,10,
  '실보유 KOSDAQ 종목이 없으면 해당 시장 pack 0건 때문에 일일 마감 실패 금지');
allSegmented._krxMarketEvidence.ETF = {count:300,date:'2026-10-02'};
assert.throws(()=>context._assessDailyKrxStockClose(segmented,allSegmented,'2026-10-06'),/ETF/,
  '실보유 ETF 시장 pack 날짜가 다르면 마감 실패');
allSegmented._krxMarketEvidence.ETF = {count:300,date:'2026-10-06'};
assert.equal(context._assessDailyKrxStockClose(segmented,allSegmented,'2026-10-06').confirmed,10,
  '실보유 두 시장의 pack과 종가가 일치하면 통과');
// fetchPricesKrx 실제 함수에서 YYYYMMDD 시장별 evidence가 ISO로 변환되는지 끝까지 검증.
// 가공된 evidence만 직접 주입하는 테스트로는 \\d 이스케이프 오타를 찾을 수 없습니다.
const realKrxContext = vm.createContext({
  _getKrxApiConfig:()=>({apiKey:'test-key'}),
  _cleanCode:v=>String(v||'').trim(),
  _parseKrxNumber:v=>Number(v),
  _fetchKrxMarketsParallelWithFallback:()=>({
    KOSPI:{usedYmd:'20261006',rows:segmented.slice(0,8).map(x=>({ISU_SRT_CD:x.code,TDD_CLSPRC:'1500'}))},
    KOSDAQ:{usedYmd:'20261006',rows:[{ISU_SRT_CD:'039490',TDD_CLSPRC:'1000'}]},
    ETF:{usedYmd:'20261006',rows:segmented.slice(8).map(x=>({ISU_SRT_CD:x.code,TDD_CLSPRC:'1500'}))}
  }),
  fetchPricesKrxViaOtp:()=>{throw new Error('KRX OpenAPI 정상일 때 OTP fallback 불필요');},
  Logger:{log(){}}
});
vm.runInContext(extract('fetchPricesKrx'),realKrxContext);
const krxRaw = realKrxContext.fetchPricesKrx(segmented,'2026-10-06');
assert.equal(krxRaw._krxMarketEvidence.KOSPI.date,'2026-10-06','KRX pack 날짜 ISO 변환');
assert.equal(krxRaw._krxMarketEvidence.KOSDAQ.date,'2026-10-06');
assert.equal(krxRaw._krxMarketEvidence.ETF.date,'2026-10-06');
assert.equal(context._assessDailyKrxStockClose(segmented,krxRaw,'2026-10-06').confirmed,10,
  '실제 fetchPricesKrx 반환값이 정상 19시 마감 검증을 통과');
// 코드 마스터의 'KR'은 시장 정보가 아니므로 공식 KOSPI/KOSDAQ pack에서
// 보유 코드의 소속을 추출합니다. 누락/거래정지 종목도 pack에 코드가 있으면 분모에 포함.
const krMaster = Array.from({length:10},(_,i)=>({
  code:String(100000+i),currency:'KRW',type:'주식',market:'KR'
}));
const krPackRows=(items,price)=>items.map(item=>({ISU_SRT_CD:item.code,TDD_CLSPRC:String(price)}));
const withKrxPacks=(kosdaqRows,etfRows=[])=>({
  KOSPI:{usedYmd:'20261006',rows:krPackRows(krMaster.slice(0,8),1500)},
  KOSDAQ:{usedYmd:'20261006',rows:kosdaqRows},
  ETF:{usedYmd:'20261006',rows:etfRows}
});
realKrxContext._fetchKrxMarketsParallelWithFallback=()=>withKrxPacks(krPackRows(krMaster.slice(8),0));
let bySourceMarket=realKrxContext.fetchPricesKrx(krMaster,'2026-10-06');
assert.equal(bySourceMarket._krxMarketEvidence.codeMarkets['100008'],'KOSDAQ',
  '가격 0건도 KOSDAQ pack에 코드가 있으면 시장 소속을 추적');
assert.throws(()=>context._assessDailyKrxStockClose(krMaster,bySourceMarket,'2026-10-06'),/KOSDAQ/,
  'KR 10종목 중 KOSPI 8종목만 종가가 있고 KOSDAQ 2종목 누락이면 실패');
realKrxContext._fetchKrxMarketsParallelWithFallback=()=>withKrxPacks(
  [{ISU_SRT_CD:'039490',TDD_CLSPRC:'1000'}]);
bySourceMarket=realKrxContext.fetchPricesKrx(krMaster,'2026-10-06');
assert.throws(()=>context._assessDailyKrxStockClose(krMaster,bySourceMarket,'2026-10-06'),/UNCLASSIFIED_KR/,
  'KR 종목이 어떤 KRX pack에서도 확인되지 않으면 전체시장 80% 성공으로 위장 금지');
realKrxContext._fetchKrxMarketsParallelWithFallback=()=>withKrxPacks(krPackRows(krMaster.slice(8),1500));
bySourceMarket=realKrxContext.fetchPricesKrx(krMaster,'2026-10-06');
assert.equal(context._assessDailyKrxStockClose(krMaster,bySourceMarket,'2026-10-06').confirmed,10,
  'KOSPI 8 + KOSDAQ 2가 정상이고 미보유 ETF 시장 pack이 비어 있어도 정상 마감');


const calls = [];
context._fetchFundNav = (provider,from,to) => {
  calls.push({provider,from,to});
  return [
    {date:'2026-09-22',nav:2100},
    {date:'2026-09-23',nav:2101},
    {date:'2026-09-25',nav:2102},
    {date:'2026-09-28',nav:2103},
    {date:'2026-10-02',nav:2104},
  ];
};
const missing = ['2026-09-22','2026-09-23','2026-09-25','2026-09-28','2026-10-02'];
let recovered = clone(context._fetchMissingFundNavBatches('KB_VALUE_ST',missing,'2026-10-06',null,'F00002'));
assert.deepEqual(calls,[{provider:'KB_VALUE_ST',from:'2026-09-22',to:'2026-10-05'}],
  '주말·기존 공시값 사이의 누락은 연속 날짜 API 호출로 묶어야 함');
assert.equal(recovered.rows.length,5);
assert.deepEqual(recovered.errors,[]);
calls.length = 0;
recovered = clone(context._fetchMissingFundNavBatches('KB_VALUE_ST',['2026-09-22','2026-10-06'],'2026-10-06',null,'F00002'));
assert.equal(calls.length,2,'14일을 초과하는 누락은 범위별 분할');
assert.equal(calls[1].from,'2026-10-06');
assert.equal(calls[1].to,'2026-10-06');


// OTP CSV market 열이 KR 구형 시장 코드를 실제 시장으로 정규화하고 휴장일에는 직전일을 요청해야 합니다.
let queriedOtpDates=[], otpCsv='';
const otpVm=vm.createContext({
  _normalizeDate:v=>String(v||'').slice(0,10),
  _fundDateOffset:(v,n)=>{const d=new Date(v+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);},
  _cleanCode:v=>String(v||'').trim(),
  _parseKrxNumber:v=>Number(String(v||'').replaceAll(',','')),
  _findCsvIndex:(fields,names)=>names.reduce((idx,n)=>idx<0?fields.indexOf(n):idx,-1),
  KRX_CONFIRMED_CLOSED_DATES_2026:{'2026-10-05':1},
  _krxCalendarStatus_:(date)=>{const dow=new Date(date+'T00:00:00Z').getUTCDay();return dow===0||dow===6||date==='2026-10-05'||date==='2027-02-09'?'CLOSED':'OPEN';},
  Logger:{log(){}},
  Utilities:{parseCsv:txt=>txt.split('\n').map(line=>line.split(','))},
  UrlFetchApp:{fetch:(url,opts)=>{
    if(url.includes('GenerateOTP')) {
      queriedOtpDates.push(opts.payload.trdDd);
      return {getResponseCode:()=>200,getContentText:()=> 'TEST_OTP_20261002'};
    }
    return {getResponseCode:()=>200,getContentText:()=>otpCsv};
  }}
});
vm.runInContext(extract('fetchPricesKrxViaOtp'),otpVm);
otpCsv='단축코드,종가,시장구분\n005930,200000,KOSPI\n000660,210000,KOSDAQ';
let otp=otpVm.fetchPricesKrxViaOtp([
  {code:'005930',name:'삼성전자'}, {code:'000660',name:'하이닉스'}], '2026-10-05');
assert.deepEqual(queriedOtpDates,['20261002'],'월요일 휴장 10/05에 OTP로 직전 거래일 10/02를 조회');
assert.equal(otp['005930'].usedDate,'2026-10-02','직전 실제 거래일 기록');
assert.equal(otp._krxMarketEvidence.codeMarkets['005930'],'KOSPI');
assert.equal(otp._krxMarketEvidence.codeMarkets['000660'],'KOSDAQ');
assert.equal(otp._krxMarketEvidence.mode,'OTP');
assert.equal(context._assessDailyKrxStockClose([
  {code:'005930',type:'주식',market:'KR'}, {code:'000660',type:'주식',market:'KR'}
],otp,'2026-10-05').confirmed,2,'휴장일 OTP 시장별 종가 확인값 통과');
queriedOtpDates=[];
otpCsv='단축코드,종가,시장구분\n'
  +krMaster.slice(0,8).map(x=>x.code+',1000,KOSPI').join('\n')
  +'\n'+krMaster.slice(8).map(x=>x.code+',0,KOSDAQ').join('\n');
otp=otpVm.fetchPricesKrxViaOtp(krMaster,'2026-10-06');
assert.deepEqual(queriedOtpDates,['20261006'],'정상 거래일에는 과거 거래일로 임의 대체하지 않음');
assert.equal(otp._krxMarketEvidence.codeMarkets['100008'],'KOSDAQ',
  '가격 없는 KOSDAQ 종목도 OTP CSV 시장 분류 추적');
assert.throws(()=>context._assessDailyKrxStockClose(krMaster,otp,'2026-10-06'),/KOSDAQ/,
  'OTP fallback에서도 KOSPI 8건 성공·KOSDAQ 2건 실패를 차단');
otpCsv='단축코드,종가\n'+krMaster.slice(0,8).map(x=>x.code+',1000').join('\n');
otp=otpVm.fetchPricesKrxViaOtp(krMaster,'2026-10-06');
assert.throws(()=>context._assessDailyKrxStockClose(krMaster,otp,'2026-10-06'),/UNCLASSIFIED_KR/,
  'CSV 시장열 자체가 없어도 미확인 KR 보유종목을 성공 분모에 합치지 않음');


// Regression guards for delayed fund completion / stale recurring trigger lifecycle.
const atomicCloseSource=extract('_recordPortfolioCloseStage');
const deferredSource=extract('runDeferredFundAfterPortfolioCloseFailure');
const guardedFundSource=extract('_runPortfolioFundWithLease_');
const scheduleSource=extract('_scheduleFundAfterFailedPortfolioPrice_');
assert.match(scheduleSource, /old\.date === scheduleDate/,
  'KST 날짜가 바뀐 예약은 만료 전이라도 재사용하지 않음');
assert.match(scheduleSource, /activeAttempt/,
  '마지막 예약 시도의 실행 중 여부를 확인해 중복 예약을 방지');
assert.match(scheduleSource, /date:scheduleDate/,
  '신규 지연 펀드 예약에 결정 시점의 KST 날짜를 기록');

assert.match(scheduleSource, /return \{created:false, triggerId:String\(old\.triggerId \|\| ''\)\}/,
  '기존 예약의 UID는 최초 예약 판단 lock 안에서 반환');
assert.match(scheduleSource, /return \{created:true, triggerId:triggerId\}/,
  '신규 예약 UID도 lock 안에서 함께 반환');
assert.match(guardedFundSource, /busyToken:String\(old\.token \|\| ''\), reason:'FUND_ACTIVE'/,
  'FUND_BUSY 실제 경합 token은 실패 결정 시점에 캡처');
assert.match(guardedFundSource, /PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY/,
  '펀드 lease 획득 전에 공유 백필 lease를 동일 lock 안에서 검사');
assert.doesNotMatch(guardedFundSource, /var active = _portfolioFundAtomic_/,
  '첫 실패 이후 lease를 다시 읽는 TOCTOU 경합 금지');

assert.match(atomicCloseSource, /_portfolioFundState_\(props, PORTFOLIO_FUND_SUCCESS_KEY\)/,
  '마감 결과 저장 시 동일 잠금으로 펀드 완료 마커 재확인');
assert.match(atomicCloseSource, /summary\.fundBusyToken[\s\S]*fundSuccess\.token === summary\.fundBusyToken/,
  '이전 동일 날짜의 성공 토큰으로 새로운 FUND_BUSY를 성공 처리하지 않음');
assert.match(atomicCloseSource, /summary\.errors = summary\.errors\.filter[\s\S]*FUND_BUSY/,
  'FUND_BUSY 외 실제 KRX 오류는 최종 summary에 보존');
assert.match(atomicCloseSource, /summary\.priceOk && summary\.errors\.length === 0/,
  'KRX 가격 실패가 있으면 펀드 평가 성공에도 전체 COMPLETE 금지');
assert.match(guardedFundSource, /origin === 'DEFERRED'[\s\S]*PORTFOLIO_FUND_SUCCESS_KEY/,
  '펀드 완료 후 상태 마커를 독립 저장');
assert.match(deferredSource, /if \(!reservation\)[\s\S]*trigger\.getUniqueId\(\) === triggerId[\s\S]*NO_RESERVATION/,
  '교체된 트리거는 자기 UID만 삭제');
assert.match(extract('runDailyPortfolioClose1900'), /fundBusyTriggerId = String\(busyReservation/,
  'FUND_BUSY 경로가 원자 반환된 예약 UID를 반드시 summary에 연결');
const closeRunSource=extract('runDailyPortfolioClose1900');
assert.ok(closeRunSource.indexOf("_recordPortfolioCloseStage(props, runDate, startedAt, 'PRICE', runId, null, startedMs)")
  < closeRunSource.indexOf('saveDailyPriceHistory(undefined, {deferQueueCompletion:true})'), '일반 종목 단계 실행 전에 시작 마커');
assert.ok(closeRunSource.indexOf("_recordPortfolioCloseStage(props, runDate, startedAt, 'FUND', runId, null, startedMs)")
  < closeRunSource.indexOf("_runPortfolioFundWithLease_('CLOSE', runId, runDate)"), '펀드 단계 실행 전에 단계 기록');
assert.match(closeRunSource, /_recordPortfolioCloseStage\(props, runDate, startedAt,\s*errors\.length \? 'ERROR' : 'COMPLETE', runId, summary, startedMs\)/);
assert.match(closeRunSource, /if \(!_recordPortfolioCloseStage\(props, runDate, startedAt, 'PRICE', runId, null, startedMs\)\)/,
  '상태 소유권 확보 실패 시 중복 마감 실행 자체를 차단');
// Behavior regression for retry scheduling, not just source-pattern checks.
function inspectFundReservation(old, clockDate, owner, successMarker) {
  const propsBag=new Map();
  if (old) propsBag.set('portfolio_fund_deferred_schedule_v1', JSON.stringify(old));
  if (successMarker) propsBag.set('portfolio_fund_deferred_success_v1',JSON.stringify(successMarker));
  if (owner && owner.runId) {
    propsBag.set('portfolio_close_run_id',owner.runId);
    propsBag.set('portfolio_close_run_date',owner.date);
  }
  const props={
    getProperty:key=>propsBag.get(key)||null,
    setProperty:(key,value)=>propsBag.set(key,value),
    deleteProperty:key=>propsBag.delete(key)
  };
  let created=0;
  const mockTrigger={getUniqueId:()=> 'new-uid'};
  const schedulerVm=vm.createContext({
    PORTFOLIO_FUND_SCHEDULE_KEY:'portfolio_fund_deferred_schedule_v1',
    PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
    _portfolioFundAtomic_:cb=>cb(props),
    _portfolioFundState_:(p,k)=>JSON.parse(p.getProperty(k)||'null'),
    ScriptApp:{newTrigger:()=>({timeBased:()=>({everyMinutes:()=>({
      create:()=>{created++;return mockTrigger;}
    })})})},
    today:()=>clockDate,
    Date:{now:()=>10000}
  });
  vm.runInContext(scheduleSource, schedulerVm);
  const outcome=schedulerVm._scheduleFundAfterFailedPortfolioPrice_(owner);
  return {outcome:JSON.parse(JSON.stringify(outcome)),created,
    pending:JSON.parse(propsBag.get('portfolio_fund_deferred_schedule_v1'))};
}
const validSameDay=inspectFundReservation(
  {date:'2026-10-08',until:20000,attempts:2,triggerId:'existing-uid'},'2026-10-08');
assert.equal(validSameDay.created,0,'유효한 당일 예약을 중복 생성하지 않음');
assert.equal(validSameDay.outcome.triggerId,'existing-uid');
const maxedOut=inspectFundReservation(
  {date:'2026-10-08',until:20000,attempts:3,triggerId:'exhausted-uid'},'2026-10-08');
assert.equal(maxedOut.created,1,'시도 횟수 소진 예약은 만료 전이라도 새로 생성');
assert.equal(maxedOut.pending.attempts,0,'새 예약은 재시도 횟수를 초기화');
const lastAttemptRunning=inspectFundReservation(
  {date:'2026-10-08',until:20000,attempts:3,activeUntil:16000,
    attemptToken:'last-attempt',triggerId:'still-running-uid'},'2026-10-08');
assert.equal(lastAttemptRunning.created,0,'세 번째 펀드 평가가 진행 중이라면 새 반복 트리거 금지');
assert.equal(lastAttemptRunning.outcome.triggerId,'still-running-uid');
const afterMidnight=inspectFundReservation(
  {date:'2026-10-08',until:20000,attempts:0,triggerId:'old-day-uid'},'2026-10-09');
assert.equal(afterMidnight.created,1,'전날 예약은 만료 전이어도 새 날짜에 재사용하지 않음');
assert.equal(afterMidnight.pending.date,'2026-10-09');
assert.equal(afterMidnight.pending.additional[0].triggerId,'old-day-uid',
  '자정 전 예약은 다음날 새 예약 생성 후에도 UID와 날짜가 보존');
const ownerAfterMidnight=inspectFundReservation(null,'2026-10-09',{
  date:'2026-10-08',runId:'close-2359',startedAt:'2026-10-08 23:59:00',
  startedMs:9000,errors:['KRX FAILED']
});
assert.equal(ownerAfterMidnight.pending.date,'2026-10-08',
  '자정 이전 시작한 실패 마감의 NAV는 실제 실패처리가 자정 이후 끝나도 원 날짜에 예약');
assert.equal(ownerAfterMidnight.pending.owner.runId,'close-2359',
  '예약한 이전 날짜의 실행 소유권을 잃지 않음');
const completedPrevious={
  date:'2026-10-08',until:20000,attempts:3,activeUntil:18000,
  triggerId:'old-complete',owner:{date:'2026-10-08',runId:'close-1900',
    startedAt:'2026-10-08 19:00:00',startedMs:1000}
};
const newClose={date:'2026-10-08',runId:'close-2030',
  startedAt:'2026-10-08 20:30:00',startedMs:9000};
const completedMarker={date:'2026-10-08',triggerId:'old-complete',
  owner:completedPrevious.owner,at:8000};
const overlappingClose=inspectFundReservation(completedPrevious,'2026-10-08',
  newClose,completedMarker);
assert.equal(overlappingClose.created,1,
  '이전 NAV가 이미 성공했으면 activeUntil이 남아도 새 마감에 UID 재사용 금지');
assert.equal(overlappingClose.pending.owner.runId,'close-2030',
  '새 마감의 독립 UID는 반드시 새로운 실행 소유권 보유');
assert.equal(overlappingClose.pending.additional[0].triggerId,'old-complete',
  '이전 성공 UID는 자신의 후속 정합화에 사용하도록 보존');
assert.equal(overlappingClose.pending.additional[0].owner.runId,'close-1900',
  '이전 예약의 원 소유권을 덮어쓰면 안 됨');
const foreignActive=inspectFundReservation(completedPrevious,'2026-10-08',newClose);
assert.equal(foreignActive.created,1,
  '다른 실행의 활성 예약도 새 runId로 재사용하지 않음');
assert.equal(foreignActive.pending.additional[0].triggerId,'old-complete');
const threeOwners=inspectFundReservation({
  date:'2026-10-08',triggerId:'close-2030-uid',until:20000,attempts:0,
  owner:newClose,additional:[completedPrevious]
},'2026-10-08',{
  date:'2026-10-08',runId:'close-2100',
  startedAt:'2026-10-08 21:00:00',startedMs:9500
});
assert.equal(threeOwners.created,1,
  '같은 거래일 세 번째 마감도 다른 run ID 예약을 그대로 재사용하면 안 됨');
assert.deepEqual(threeOwners.pending.additional.map(x=>x.triggerId),
  ['close-2030-uid','old-complete'],
  '동일 날짜의 기존 두 UID는 후속 정합화/정리 전 모두 보존');
// Multi-byte Korean errors must be bounded before the Script Properties
// 9KB per-value cap. Never create an orphan recurring trigger at capacity.
{
  const noisyOwner={date:'2026-10-08',runId:'noisy-close',
    startedAt:'2026-10-08 19:00:00',startedMs:1000,
    errors:Array(4).fill('가'.repeat(3000))};
  const bounded=inspectFundReservation(null,'2026-10-08',noisyOwner);
  const serialized=JSON.stringify(bounded.pending);
  assert.ok(Buffer.byteLength(serialized,'utf8')<8000,'예약 원문은 8KB 이하여야 함');
  assert.ok(bounded.pending.owner.errors.every(x=>x.length<=100));
  let count=0;
  const bag=new Map([['portfolio_fund_deferred_schedule_v1',JSON.stringify({
    date:'2026-10-08',triggerId:'uid-0',until:20000,attempts:0,
    additional:Array.from({length:7},(_,i)=>({
      date:'2026-10-08',triggerId:'uid-'+(i+1),until:20000,attempts:0
    }))
  })]]);
  const p={getProperty:k=>bag.get(k)||null,
    setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  const vmCtx=vm.createContext({
    today:()=> '2026-10-08',Date:{now:()=>10000},
    PORTFOLIO_FUND_SCHEDULE_KEY:'portfolio_fund_deferred_schedule_v1',
    PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
    _portfolioFundAtomic_:cb=>cb(p),
    _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
    ScriptApp:{newTrigger:()=>{count++;throw Error('SHOULD_NOT_CREATE');}}
  });
  vm.runInContext(scheduleSource,vmCtx);
  assert.throws(()=>vmCtx._scheduleFundAfterFailedPortfolioPrice_({
    date:'2026-10-08',runId:'ninth-close',startedMs:5000
  }),/FUND_DEFERRED_CAPACITY/);
  assert.equal(count,0,'포화 예약일 때 반복 트리거 생성 이전에 거절');
  assert.equal(JSON.parse(p.getProperty('portfolio_fund_deferred_schedule_v1')).additional.length,7,
    '포화되어도 기존 8개 UID를 임의 삭제하면 안 됨');
}
// If persistence fails even after successful size preflight, never leave an
// unowned new GAS trigger behind or alter another run's reservation.
{
 const bag=new Map(), p={getProperty:k=>bag.get(k)||null,
   deleteProperty:k=>bag.delete(k),
   setProperty:(k,v)=>{
     if(k==='portfolio_fund_deferred_schedule_v1')
       throw new Error('injected-property-write-failure');
     bag.set(k,String(v));
   }};
 let deleted=0,created=0;
 const vmCtx=vm.createContext({
   today:()=> '2026-10-08',Date:{now:()=>10000},
   PORTFOLIO_FUND_SCHEDULE_KEY:'portfolio_fund_deferred_schedule_v1',
   PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
   _portfolioFundAtomic_:cb=>cb(p),
   _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
   ScriptApp:{
     newTrigger:()=>({timeBased:()=>({everyMinutes:()=>({
       create:()=>{created++;return {getUniqueId:()=> 'failed-new-uid'};}
     })})}),
     deleteTrigger:t=>{assert.equal(t.getUniqueId(),'failed-new-uid');deleted++;}
   }
 });
 vm.runInContext(scheduleSource,vmCtx);
 assert.throws(()=>vmCtx._scheduleFundAfterFailedPortfolioPrice_({
   date:'2026-10-08',runId:'fail-write',startedMs:1000
 }),/injected-property-write-failure/);
 assert.equal(created,1);
 assert.equal(deleted,1,'속성 저장 실패 시 방금 만든 신규 UID만 삭제');
 assert.equal(p.getProperty('portfolio_fund_deferred_schedule_v1'),null);
}
console.log('✅ Korean UTF-8 예약 용량·8개 유효 UID 보호·미등록 트리거 생성 차단');
assert.match(deferredSource,/cleanupTriggerId = triggerId \|\| String\(reservation\.triggerId \|\| ''\)/,
  '수동 호출에서 이벤트 UID가 없더라도 특정 예약 UID만 정리');
assert.match(deferredSource,/if \(!pending \|\| !cleanupTriggerId \|\| pending\.triggerId !== cleanupTriggerId\) return/,
  '공유 예약 삭제는 정확한 UID 일치 시에만 수행');
assert.match(deferredSource,/if \(cleanupTriggerId && trigger\.getHandlerFunction\(\) === 'runDeferredFundAfterPortfolioCloseFailure'/,
  '모든 반복 트리거를 무차별 삭제하지 않음');
assert.doesNotMatch(closeRunSource,/_runPendingKrxBackfillWithLease_\(/,
  '정규 19시/20:30 통합 마감이 과거 백필을 직접 시작하면 GAS 6분 한도를 초과할 수 있음');
assert.match(closeRunSource,/reason:'ISOLATED_NIGHTLY_BACKFILL'/,
  '이전 날짜 보류 건수와 독립 백필 사유를 마감 결과에 남김');

// Full executable lifecycle: a successful CLOSE cancels only same-day deferred
// reservation while leaving a different business day's reservation untouched.
function inspectCloseCompletion(reservationDate, clockDate='2026-10-08', reservedDate) {
  const initial=typeof reservationDate==='string'
    ? {date:reservationDate,triggerId:'nav-T1',attempts:0,until:20000}
    : reservationDate;
  const bag=new Map([['portfolio_fund_deferred_schedule_v1', JSON.stringify(initial)]]);
  let id=0, calledFundDate='';
  const props={
    getProperty:key=>bag.get(key)||null,
    setProperty:(key,value)=>bag.set(key,value),
    deleteProperty:key=>bag.delete(key)
  };
  const sandbox=vm.createContext({
    Utilities:{getUuid:()=> 'lease-'+(++id)},
    today:()=> clockDate, Date:{now:()=>10000},
    _portfolioFundAtomic_:cb=>cb(props),
    _portfolioFundState_:(p,key)=>JSON.parse(p.getProperty(key)||'null'),
    PORTFOLIO_FUND_LEASE_KEY:'portfolio_fund_run_lease_v1',
    PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'portfolio_close_backfill_lease_v1',
    PORTFOLIO_FUND_SCHEDULE_KEY:'portfolio_fund_deferred_schedule_v1',
    PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
    PORTFOLIO_FUND_CLOSE_SUCCESS_KEY:'portfolio_fund_close_success_v1',
    runDailyFundValuations:date=>{calledFundDate=date;return {lastDate:date};}
  });
  vm.runInContext(guardedFundSource,sandbox);
  sandbox._runPortfolioFundWithLease_('CLOSE','owner-run-id',reservedDate);
  return {pending:props.getProperty('portfolio_fund_deferred_schedule_v1'),
    lease:props.getProperty('portfolio_fund_run_lease_v1'),
    calledFundDate};
}
assert.equal(inspectCloseCompletion('2026-10-08').pending,null,
  '당일 정상 마감 NAV 성공은 기존 지연 NAV 예약을 취소');
assert.notEqual(inspectCloseCompletion('2026-10-07').pending,null,
  '이전 날짜 예약은 당일 마감 성공에 따라 무분별하게 삭제하지 않음');
assert.equal(inspectCloseCompletion('2026-10-08').lease,null,
  '정상 NAV 완료 후 정확한 lease 해제');
const preservedOtherDay=inspectCloseCompletion({
  date:'2026-10-08',triggerId:'nav-today',attempts:0,until:20000,
  additional:[{date:'2026-10-07',triggerId:'nav-yesterday',attempts:0,until:20000}]
});
assert.equal(JSON.parse(preservedOtherDay.pending).triggerId,'nav-yesterday',
  '오늘 CLOSE 성공은 전날의 별도 예약을 삭제하면 안 됨');
const midnightClose=inspectCloseCompletion('2026-10-08','2026-10-09','2026-10-08');
assert.equal(midnightClose.calledFundDate,'2026-10-08',
  '수동 CLOSE가 자정을 넘겨도 NAV 조회 기준일은 시작 시 거래일 유지');
assert.equal(midnightClose.pending,null,
  '다음날 완료된 CLOSE라도 원 실행 날짜의 유예 예약을 정확히 취소');
const deferredBag=new Map([['portfolio_fund_deferred_schedule_v1',
  JSON.stringify({date:'2026-10-08',triggerId:'T-final',until:20000,attempts:2})]]);
const deferredProps={
  getProperty:key=>deferredBag.get(key)||null,
  setProperty:(key,value)=>deferredBag.set(key,value),
  deleteProperty:key=>deferredBag.delete(key)
};
const deletedTriggers=[];
const deferredTrigger={getHandlerFunction:()=> 'runDeferredFundAfterPortfolioCloseFailure',
  getUniqueId:()=> 'T-final'};
const deferredVm=vm.createContext({
  today:()=> '2026-10-08',
  Date:{now:()=>10000},
  Utilities:{getUuid:()=> 'attempt-3'},
  PORTFOLIO_FUND_SCHEDULE_KEY:'portfolio_fund_deferred_schedule_v1',
  PORTFOLIO_FUND_LEASE_KEY:'portfolio_fund_run_lease_v1',
  PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'portfolio_close_backfill_lease_v1',
  _portfolioFundAtomic_:cb=>cb(deferredProps),
  _portfolioFundState_:(p,key)=>JSON.parse(p.getProperty(key)||'null'),
  ScriptApp:{getProjectTriggers:()=>[deferredTrigger],deleteTrigger:t=>deletedTriggers.push(t)},
  _appendPortfolioCloseSyncLog:()=>{},
  _reconcilePortfolioFundBusy_:()=>{},
  _runPortfolioFundWithLease_:()=>{
    const marked=JSON.parse(deferredProps.getProperty('portfolio_fund_deferred_schedule_v1'));
    assert.equal(marked.attempts,3,'마지막 예약 시도 횟수 기록');
    assert.equal(marked.attemptToken,'attempt-3','예약 즉시 실행 marker 저장');
    assert.equal(marked.activeUntil,430000,'실행 진입 전에 7분 시작 marker 설정');
    return {lastDate:'2026-10-08'};
  }
});
vm.runInContext(deferredSource,deferredVm);
deferredVm.runDeferredFundAfterPortfolioCloseFailure({triggerUid:'T-final'});
assert.equal(deferredProps.getProperty('portfolio_fund_deferred_schedule_v1'),null,
  '펀드 완료 후 정확한 UID의 예약 제거');
assert.equal(deletedTriggers.length,1,'완료된 반복 트리거 하나만 정리');
// A competing invocation must not delete the currently running final attempt.
deferredProps.setProperty('portfolio_fund_deferred_schedule_v1',
  JSON.stringify({date:'2026-10-08',triggerId:'T-final',until:20000,
    attempts:3,attemptToken:'running',activeUntil:30000}));
const busyResult=deferredVm.runDeferredFundAfterPortfolioCloseFailure({triggerUid:'T-final'});
assert.equal(busyResult.reason,'FUND_BUSY_RETRY_LATER',
  '실행 중인 세 번째 평가를 RETRY_EXHAUSTED로 잘못 정리하지 않음');
assert.notEqual(deferredProps.getProperty('portfolio_fund_deferred_schedule_v1'),null,
  '동시 호출이 실행 중인 예약을 삭제하지 않음');

// Backfill must have its own execution and shared cross-account lease.
const backfillWorker=extract('_runPendingKrxBackfillWithLease_');
const nightlyBackfill=extract('runPortfolioCloseBackfill2210');
const backfillTrigger=extract('_ensurePortfolioCloseBackfillTrigger');
assert.match(backfillTrigger,/everyDays\(1\)[\s\S]*atHour\(22\)\.nearMinute\(10\)/,
  '22:10 독립 백필 트리거');
assert.match(closeRunSource, /_ensurePortfolioCloseBackfillTrigger\(true\)/,
  '기존 정규 19시 실행으로 백필 트리거 설치');
assert.doesNotMatch(closeRunSource, /_runPendingKrxBackfillWithLease_\(props, runDate, true\)/,
  '19시 마감은 최종 결과 저장 전에 과거 백필을 실행하지 않음');
assert.match(nightlyBackfill,/_runPendingKrxBackfillWithLease_\(props, runDate, false\)/,
  '야간 실행은 통합 마감 없이 과거 날짜만 복구');
assert.doesNotMatch(closeRunSource,/_runPendingKrxBackfillWithLease_\(/,
  '가격·펀드 성공 여부와 관계없이 19시 마감에서 과거 Snapshot 백필 실행 금지');
assert.match(backfillWorker,/return 'FUND_ACTIVE'/,
  '야간·정규 백필 모두 원자적 lease 검사에서 활성 NAV 실행을 차단');
// Backfill and NAV both enter the same ScriptLock acquisition helper.
assert.doesNotMatch(nightlyBackfill,/var fundLease =/,
  '야간 백필에서 lease 획득 전 외부 검사로 인한 TOCTOU 금지');
assert.match(backfillWorker, /PORTFOLIO_FUND_LEASE_KEY/,
  '백필 lease 획득 내부에서 NAV lease를 동시에 확인');
assert.match(backfillWorker,/if \(acquired !== 'ACQUIRED'\)/,
  '백필 동시 실행 차단 사유를 반환');

function verifyBackfillLease(existing, fundLease) {
  const bag=new Map();
  if(existing)bag.set('portfolio_close_backfill_lease_v1',JSON.stringify(existing));
  if(fundLease)bag.set('portfolio_fund_run_lease_v1',JSON.stringify(fundLease));
  const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,v),
    deleteProperty:k=>bag.delete(k)};
  let runs=0;
  const ctx=vm.createContext({
    Utilities:{getUuid:()=> 'worker-1'},
    Date:{now:()=>10000},
    _portfolioFundAtomic_:cb=>cb(p),
    _portfolioFundState_:(props,key)=>JSON.parse(props.getProperty(key)||'null'),
    PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'portfolio_close_backfill_lease_v1',
    PORTFOLIO_FUND_LEASE_KEY:'portfolio_fund_run_lease_v1',
    _retryOnePendingKrxClose_:()=>{runs++;return {attempted:true,ok:true,date:'2026-10-07'};}
  });
  vm.runInContext(backfillWorker,ctx);
  return {result:JSON.parse(JSON.stringify(ctx._runPendingKrxBackfillWithLease_(p,'2026-10-08'))),
    lease:p.getProperty('portfolio_close_backfill_lease_v1'),runs};
}
const blockedBackfill=verifyBackfillLease({token:'other',until:20000});
assert.equal(blockedBackfill.runs,0,'동시 백필 lease 보유 시 KRX 요청 차단');
assert.equal(blockedBackfill.result.reason,'BACKFILL_BUSY');
assert.notEqual(blockedBackfill.lease,null,'다른 실행의 백필 lease를 삭제하지 않음');
const activeFundBlocked=verifyBackfillLease(null,{token:'nav-running',until:20000});
assert.equal(activeFundBlocked.runs,0,'동일 lock에서 NAV lease 확인 후 백필 쓰기 차단');
assert.equal(activeFundBlocked.result.reason,'FUND_ACTIVE');
assert.equal(activeFundBlocked.lease,null,'펀드 활성 상태에는 백필 lease 미획득');
const finishedBackfill=verifyBackfillLease(null);
assert.equal(finishedBackfill.runs,1,'야간 백필은 한 날짜만 처리');
assert.equal(finishedBackfill.lease,null,'자신의 백필 lease 정리');

// Bidirectional executable race guards: while one worker owns its lease,
// the opposite worker cannot start; after release it can safely proceed.
function runCrossLeaseScenario(backfillFirst) {
  const bag=new Map(), events=[];
  let nextId=0;
  const props={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,v),
    deleteProperty:k=>bag.delete(k)};
  const shared={
    Date:{now:()=>10000}, today:()=> '2026-10-08',
    Utilities:{getUuid:()=> 'lease-'+(++nextId)},
    PORTFOLIO_FUND_LEASE_KEY:'portfolio_fund_run_lease_v1',
    PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'portfolio_close_backfill_lease_v1',
    PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
    PORTFOLIO_FUND_CLOSE_SUCCESS_KEY:'portfolio_fund_close_success_v1',
    PORTFOLIO_FUND_SCHEDULE_KEY:'portfolio_fund_deferred_schedule_v1',
    _portfolioFundAtomic_:cb=>cb(props),
    _portfolioFundState_:(p,k)=>JSON.parse(p.getProperty(k)||'null'),
    _retryOnePendingKrxClose_:()=>{events.push('backfill');return {attempted:true,ok:true};},
    runDailyFundValuations:()=>{events.push('fund');return {lastDate:'2026-10-08'};}
  };
  const ctx=vm.createContext(shared);
  vm.runInContext(backfillWorker+'\n'+guardedFundSource,ctx);
  if(backfillFirst){
    ctx._retryOnePendingKrxClose_=()=>{
      let code='';
      try {ctx._runPortfolioFundWithLease_('DEFERRED','T');}catch(err){code=err.message;}
      assert.match(code,/FUND_BUSY/,'백필 진행 중 NAV 경합 차단');
      assert.equal(props.getProperty('portfolio_fund_run_lease_v1'),null);
      events.push('backfill');return {attempted:true,ok:true};
    };
    ctx._runPendingKrxBackfillWithLease_(props,'2026-10-08');
    ctx._runPortfolioFundWithLease_('CLOSE');
    assert.deepEqual(events,['backfill','fund']);
  }else{
    ctx.runDailyFundValuations=()=>{
      const result=ctx._runPendingKrxBackfillWithLease_(props,'2026-10-08');
      assert.equal(result.reason,'FUND_ACTIVE','활성 NAV 평가 중 과거 Snapshot 복구 차단');
      assert.equal(props.getProperty('portfolio_close_backfill_lease_v1'),null);
      events.push('fund');return {lastDate:'2026-10-08'};
    };
    ctx._runPortfolioFundWithLease_('CLOSE');
    ctx._runPendingKrxBackfillWithLease_(props,'2026-10-08');
    assert.deepEqual(events,['fund','backfill']);
  }
  assert.equal(props.getProperty('portfolio_close_backfill_lease_v1'),null);
  assert.equal(props.getProperty('portfolio_fund_run_lease_v1'),null);
}
runCrossLeaseScenario(true);
runCrossLeaseScenario(false);
const triggerSelfHeal=extract('_ensureDailyTriggersOncePerDay');
assert.match(triggerSelfHeal,/integrity-change-v6-close-watchdog-backfill/,
  '신규 백필 트리거 점검은 캐시 키 변경으로 반드시 재실행');
assert.match(triggerSelfHeal,/!before\.hasBackfill/,
  '일일 검사에서 누락된 백필 트리거 자동 복구');
assert.match(triggerSelfHeal,/before\.hasDuplicateBackfillTriggers/,
  '일일 검사에서 중복 백필 트리거 정리');
assert.match(triggerSelfHeal,/after\.hasBackfill/,
  '백필 트리거가 있어야 복구 정상으로 캐시');

// Cross-flow protection: old-backfill in progress blocks a new close PRICE
// state before saveDailyPriceHistory may touch the same Snapshot sheets.
const closeStageGuard=extract('_recordPortfolioCloseStage');
assert.match(closeStageGuard,/PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY/,
  '일일 가격 마감도 백필 lease와 원자적으로 충돌 검사');
assert.match(backfillWorker,/if \(!fromClose\)/,
  '야간 백필은 마감 상태를 검사하지만 정규 마감의 자체 백필은 허용');
assert.match(backfillWorker,/return 'CLOSE_ACTIVE'/,
  '야간 백필이 19시 가격 작업과 중복되면 새 백필 lease 미획득');
assert.doesNotMatch(backfillWorker,/portfolio_close_run_date[^\n]*runDate/,
  'KST 자정이 바뀌어도 활성 PRICE/FUND 실행을 놓치지 않음');
assert.match(closeStageGuard,/PORTFOLIO_FUND_LEASE_KEY/,
  '통합 PRICE 진입은 deferred NAV lease를 동일 lock에서 검사');
assert.match(guardedFundSource,/origin === 'DEFERRED'[\s\S]*reason:'CLOSE_ACTIVE'/,
  'deferred NAV는 활성 PRICE/FUND 단계를 동일 lock에서 검사');
function simulateCloseBackfillCollision(backfillExists, closeActive) {
  const bag=new Map(), now=10000;
  if(backfillExists)bag.set('portfolio_close_backfill_lease_v1',
    JSON.stringify({token:'replay-live',until:20000}));
  if(closeActive){
    bag.set('portfolio_close_stage','PRICE');
    bag.set('portfolio_close_run_date','2026-10-08');
    bag.set('portfolio_close_run_started_ms','9000');
  }
  const p={getProperty:key=>bag.get(key)||null,
    setProperty:(key,v)=>bag.set(key,String(v)),deleteProperty:key=>bag.delete(key),
    setProperties:obj=>Object.entries(obj).forEach(([k,v])=>bag.set(k,String(v)))};
  const ctx=vm.createContext({
    Date:class CloseTestDate extends Date {static now(){return now;}},
    Utilities:{getUuid:()=> 'collision-test',
      formatDate:()=> '2026-10-08 19:00:00'},
    CONFIG:{TIMEZONE:'Asia/Seoul'},
    LockService:{getScriptLock:()=>({hasLock:()=>false,waitLock(){},releaseLock(){}})},
    _portfolioFundAtomic_:callback=>callback(p),
    _portfolioFundState_:(props,key)=>JSON.parse(props.getProperty(key)||'null'),
    PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'portfolio_close_backfill_lease_v1',
    PORTFOLIO_FUND_LEASE_KEY:'portfolio_fund_run_lease_v1',
    PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
    PORTFOLIO_FUND_CLOSE_SUCCESS_KEY:'portfolio_fund_close_success_v1',
    _fundPropertyText:String, _retryOnePendingKrxClose_:()=>({attempted:true,ok:true})
  });
  vm.runInContext(backfillWorker+'\n'+closeStageGuard,ctx);
  const backfill=ctx._runPendingKrxBackfillWithLease_(p,'2026-10-08',false);
  const close=ctx._recordPortfolioCloseStage(p,'2026-10-08','2026-10-08 19:00:00',
    'PRICE','new-close',null,11000);
  return {backfill,close};
}
const closeInProgress=simulateCloseBackfillCollision(false,true);
assert.equal(closeInProgress.backfill.reason,'CLOSE_ACTIVE',
  '마감 PRICE 상태가 공유 잠금 안에서 독립 백필을 차단');
const replayInProgress=simulateCloseBackfillCollision(true,false);
assert.equal(replayInProgress.close,false,
  '백필 중에는 새 정규 가격 마감이 Snapshot 쓰기를 시작하지 못함');

// Executable bidirectional PRICE/NAV exclusion and KST-midnight replay.
function simulatePortfolioWriters(options={}) {
  const bag=new Map(), now=1000000;
  const closeStart=options.closeStarted ?? (now-60000);
  if(options.closeStage){
    bag.set('portfolio_close_stage',options.closeStage);
    bag.set('portfolio_close_run_date',options.closeDate||'2026-10-08');
    bag.set('portfolio_close_run_started_ms',String(closeStart));
    bag.set('portfolio_close_run_id','older-run');
  }
  if(options.navActive)
    bag.set('portfolio_fund_run_lease_v1',JSON.stringify({token:'nav-live',until:now+60000}));
  const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k),
    setProperties:obj=>Object.entries(obj).forEach(([k,v])=>bag.set(k,String(v)))};
  let navRuns=0, backfillRuns=0;
  const ctx=vm.createContext({
    Date:class MockNow extends Date {static now(){return now;}},
    today:()=> '2026-10-09',
    CONFIG:{TIMEZONE:'Asia/Seoul'},
    Utilities:{getUuid:()=> 'test-token',formatDate:()=> '2026-10-09 00:01:00'},
    LockService:{getScriptLock:()=>({hasLock:()=>false,waitLock(){},releaseLock(){}})},
    _portfolioFundAtomic_:callback=>callback(p),
    _portfolioFundState_:(pr,key)=>JSON.parse(pr.getProperty(key)||'null'),
    PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'portfolio_close_backfill_lease_v1',
    PORTFOLIO_FUND_LEASE_KEY:'portfolio_fund_run_lease_v1',
    PORTFOLIO_FUND_SCHEDULE_KEY:'portfolio_fund_deferred_schedule_v1',
    PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
    PORTFOLIO_FUND_CLOSE_SUCCESS_KEY:'portfolio_fund_close_success_v1',
    _retryOnePendingKrxClose_:()=>{backfillRuns++;return {attempted:true,ok:true};},
    runDailyFundValuations:()=>{navRuns++;return {lastDate:'2026-10-09'};}
  });
  vm.runInContext([closeStageGuard,guardedFundSource,backfillWorker].join('\n'),ctx);
  return {ctx,p,bag,get navRuns(){return navRuns;},get backfillRuns(){return backfillRuns;}};
}
const activeNav=simulatePortfolioWriters({navActive:true});
assert.equal(activeNav.ctx._recordPortfolioCloseStage(activeNav.p,'2026-10-09',
  '2026-10-09 00:01:00','PRICE','new-run',null,1000000),false,
  '활성 deferred NAV lease가 PRICE/Snapshot 진입을 차단');
assert.equal(activeNav.p.getProperty('portfolio_close_stage'),null,
  'PRICE 취득에 실패하면 통합 마감 상태를 변경하지 않음');
const activePrice=simulatePortfolioWriters({closeStage:'PRICE'});
assert.throws(()=>activePrice.ctx._runPortfolioFundWithLease_('DEFERRED','nav-trigger'),
  /FUND_BUSY: 통합 마감 PRICE\/FUND 실행 중/,
  'KST 자정 전에 시작한 활성 PRICE와 deferred NAV의 동시 실행 차단');
assert.equal(activePrice.navRuns,0,'PRICE 실행 중 NAV 외부 조회를 호출하지 않음');
const midnightReplay=activePrice.ctx._runPendingKrxBackfillWithLease_(
  activePrice.p,'2026-10-09',false);
assert.equal(midnightReplay.reason,'CLOSE_ACTIVE',
  '전날부터 진행 중인 PRICE가 자정 후 KRX 백필을 차단');
assert.equal(activePrice.backfillRuns,0,
  '자정 경계에서 백필 Snapshot 쓰기를 시작하지 않음');
const activeCloseFund=simulatePortfolioWriters({closeStage:'FUND'});
assert.throws(()=>activeCloseFund.ctx._runPortfolioFundWithLease_('DEFERRED','nav-trigger'),
  /FUND_BUSY: 통합 마감 PRICE\/FUND 실행 중/,
  '정규 FUND 상태 마커부터 실제 NAV lease 획득까지의 간격도 보호');
const stalePrice=simulatePortfolioWriters({closeStage:'PRICE',
  closeStarted:1000000-16*60*1000});
assert.doesNotThrow(()=>stalePrice.ctx._runPortfolioFundWithLease_('DEFERRED','nav-trigger'),
  '15분 넘은 중단 실행의 PRICE 마커 때문에 NAV 복구가 영구 차단되지 않음');
assert.equal(stalePrice.navRuns,1,'만료된 PRICE 이후 NAV가 실제 재실행됨');
const staleReplay=stalePrice.ctx._runPendingKrxBackfillWithLease_(
  stalePrice.p,'2026-10-09',false);
assert.equal(staleReplay.attempted,true,'만료된 PRICE 마커는 백필 복구를 막지 않음');
const runProps=new Map();
const statusVm=vm.createContext({
  CONFIG:{TIMEZONE:'Asia/Seoul'},
  Utilities:{formatDate:()=> '2026-10-07 19:15:00'},
  LockService:{getScriptLock:()=>({hasLock:()=>false,waitLock(){},releaseLock(){}})},
  _fundPropertyText:String,
  _portfolioFundState_:()=>null,
  PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'portfolio_close_backfill_lease_v1',
  PORTFOLIO_FUND_LEASE_KEY:'portfolio_fund_run_lease_v1',
  PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
    PORTFOLIO_FUND_CLOSE_SUCCESS_KEY:'portfolio_fund_close_success_v1',
});
vm.runInContext([extract('_recordPortfolioCloseStage'),extract('_portfolioCloseRunState')].join('\n'),statusVm);
// Behavioral regression: a prior same-day success must not satisfy a newer busy lease.
statusVm._portfolioFundState_ = (props,key) => {
  try { return JSON.parse(props.getProperty(key) || 'null'); } catch { return null; }
};
function verifyDeferredReconcile(summary, marker) {
  const bag = new Map();
  const props = {
    getProperty:k=>bag.get(k)||'',
    setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k),
    setProperties:v=>Object.entries(v).forEach(([k,val])=>bag.set(k,String(val)))
  };
  props.setProperty('portfolio_fund_deferred_success_v1', JSON.stringify(marker));
  const when='2026-10-08', startedAt='2026-10-08 19:33:00', startedMs=1000, id='run-verify';
  statusVm._recordPortfolioCloseStage(props,when,startedAt,'PRICE',id,null,startedMs);
  statusVm._recordPortfolioCloseStage(props,when,startedAt,'ERROR',id,summary,startedMs);
  return {summary:JSON.parse(props.getProperty('portfolio_close_last_result')), stage:props.getProperty('portfolio_close_stage')};
}
const staleBusy=verifyDeferredReconcile({
  priceOk:true, fundOk:false, fundBusyToken:'NEW', errors:['펀드: FUND_BUSY'], startedMs:1000
},{date:'2026-10-08', token:'OLD', at:2000});
assert.equal(staleBusy.summary.fundOk,false,'예전 성공 토큰으로 새 FUND_BUSY를 완료 처리 금지');
assert.equal(staleBusy.stage,'ERROR');
const currentBusy=verifyDeferredReconcile({
  priceOk:true, fundOk:false, fundBusyToken:'NEW', errors:['펀드: FUND_BUSY'], startedMs:1000
},{date:'2026-10-08', token:'NEW', at:2000});
assert.equal(currentBusy.summary.fundOk,true,'실제 경합한 실행의 성공만 적용');
assert.equal(currentBusy.stage,'COMPLETE');
const separateFunds=verifyDeferredReconcile({
  priceOk:false, fundOk:false, fundDeferred:true, fundDeferredTriggerId:'T2',
  errors:['일반 종목: KRX 응답 없음'], startedMs:1000
},{date:'2026-10-08', triggerId:'T2', token:'runT2', at:2000});
assert.equal(separateFunds.summary.fundOk,true,'가격 실패 후 독립 펀드 완료 표시');
assert.equal(separateFunds.stage,'ERROR','펀드 성공으로 가격 실패를 덮지 않음');
assert.match(separateFunds.summary.errors[0],/KRX/);
const retriedBusy=verifyDeferredReconcile({
  priceOk:true, fundOk:false, fundBusyToken:'failed-first-lease',fundBusyTriggerId:'retry-T1',
  errors:['펀드: FUND_BUSY'],startedMs:1000
},{date:'2026-10-08',token:'new-retry-lease',triggerId:'retry-T1',at:2200});
assert.equal(retriedBusy.summary.fundOk,true,'동일 예약 트리거의 새로운 lease 성공을 마감 결과에 반영');
assert.equal(retriedBusy.stage,'COMPLETE','펀드 재시도 성공 후 완료 상태 복구');
const unrelatedRetry=verifyDeferredReconcile({
  priceOk:true,fundOk:false,fundBusyToken:'old-lease',fundBusyTriggerId:'retry-T2',
  errors:['펀드: FUND_BUSY'],startedMs:1000
},{date:'2026-10-08',token:'different-lease',triggerId:'different-trigger',at:2200});
assert.equal(unrelatedRetry.summary.fundOk,false,'다른 예약의 재시도를 오인해 완료 처리하지 않음');
const staleFunds=verifyDeferredReconcile({
  priceOk:false, fundOk:false, fundDeferred:true, fundDeferredTriggerId:'T3',
  errors:['일반 종목: KRX 응답 없음'], startedMs:1000
},{date:'2026-10-08', triggerId:'T2', token:'runT2', at:2000});
assert.equal(staleFunds.summary.fundOk,false,'이전 예약 트리거 완료를 새 펀드 성공으로 처리 금지');

const propertyApi={getProperty:k=>runProps.get(k)||'',setProperty:(k,v)=>runProps.set(k,v),deleteProperty:k=>runProps.delete(k),setProperties:x=>Object.entries(x).forEach(([k,v])=>runProps.set(k,v))};
assert.equal(statusVm._portfolioCloseRunState(null,propertyApi).state,'NEVER_RUN',
  '한 번도 시작하지 않은 마감');
statusVm._recordPortfolioCloseStage(propertyApi,'2026-10-07','2026-10-07 19:10:00','PRICE','run-a',null,1000);
assert.equal(statusVm._portfolioCloseRunState(null,propertyApi).state,'INCOMPLETE',
  '시간초과 중단 마감을 NEVER_RUN으로 오판 금지');
statusVm._recordPortfolioCloseStage(propertyApi,'2026-10-07','2026-10-07 19:10:00','FUND','run-a',null,1000);
assert.equal(statusVm._portfolioCloseRunState(null,propertyApi).stage,'FUND');
assert.equal(statusVm._portfolioCloseRunState({startedAt:'2026-10-07 19:10:00'},propertyApi).state,
  'INCOMPLETE','같은 초의 진행 중 단계는 이전 완료값으로 오판하면 안 됨');
assert.equal(statusVm._recordPortfolioCloseStage(propertyApi,'2026-10-07','2026-10-07 19:10:01','PRICE','run-b',null,2000),false,
  'A가 FUND 진행 중이면 더 최신 B도 lease 안에서는 소유권을 탈취하지 못함');
assert.equal(propertyApi.getProperty('portfolio_close_run_id'),'run-a','진행 중 FUND run-id 유지');
statusVm._recordPortfolioCloseStage(propertyApi,'2026-10-07','2026-10-07 19:10:00','COMPLETE','run-a',{startedAt:'2026-10-07 19:10:00',priceOk:true,fundOk:true,errors:[]},1000);
assert.equal(statusVm._portfolioCloseRunState({startedAt:'2026-10-07 19:10:00',priceOk:true,fundOk:true,errors:[]},propertyApi).state,'COMPLETE');
assert.equal(statusVm._recordPortfolioCloseStage(propertyApi,'2026-10-07','2026-10-07 19:10:01','PRICE','run-b',null,2000),true,
  '이전 실행이 COMPLETE면 다음 실행 시작 허용');
assert.equal(statusVm._recordPortfolioCloseStage(propertyApi,'2026-10-07','2026-10-07 19:10:00','COMPLETE','run-a',{startedAt:'2026-10-07 19:10:00',priceOk:true,fundOk:true,errors:[]},1000),false,
  'A의 늦은 완료가 B의 시작 마커를 덮지 않음');
assert.equal(propertyApi.getProperty('portfolio_close_run_id'),'run-b');
statusVm._recordPortfolioCloseStage(propertyApi,'2026-10-07','2026-10-07 19:10:01','COMPLETE','run-b',{startedAt:'2026-10-07 19:10:01',priceOk:true,fundOk:true,errors:[]},2000);
assert.equal(statusVm._portfolioCloseRunState({startedAt:'2026-10-07 19:10:01',priceOk:true,fundOk:true,errors:[]},propertyApi).state,'COMPLETE');

// ERROR는 portfolioClose 완료기록 유무와 무관하게 INCOMPLETE보다 우선 표시해야 합니다.
const errorProps=new Map();
const errorApi={getProperty:k=>errorProps.get(k)||'',setProperty:(k,v)=>errorProps.set(k,v),deleteProperty:k=>errorProps.delete(k),setProperties:x=>Object.entries(x).forEach(([k,v])=>errorProps.set(k,v))};
statusVm._recordPortfolioCloseStage(errorApi,'2026-10-07','2026-10-07 19:20:00','PRICE','run-error',null,3000);
statusVm._recordPortfolioCloseStage(errorApi,'2026-10-07','2026-10-07 19:20:00','ERROR','run-error',{startedAt:'2026-10-07 19:20:00',errors:['forced']},3000);
assert.equal(statusVm._portfolioCloseRunState(null,errorApi).state,'ERROR','실패한 신규 마감을 INCOMPLETE로 숨기지 않음');
assert.equal(statusVm._portfolioCloseRunState({startedAt:'2026-10-07 19:10:00'},errorApi).state,'ERROR','이전 완료 기록이 있어도 최신 ERROR 우선');

// 같은 초·같은 millisecond 중복 실행은 최초 상태 소유자만 허용하고, 더 오래된 ms는 최신 실행을 덮지 못합니다.
const sameMsProps=new Map();
const sameMsApi={getProperty:k=>sameMsProps.get(k)||'',setProperty:(k,v)=>sameMsProps.set(k,v),deleteProperty:k=>sameMsProps.delete(k),setProperties:x=>Object.entries(x).forEach(([k,v])=>sameMsProps.set(k,v))};
assert.equal(statusVm._recordPortfolioCloseStage(sameMsApi,'2026-10-07','2026-10-07 19:10:00','PRICE','first',null,5000),true);
assert.equal(statusVm._recordPortfolioCloseStage(sameMsApi,'2026-10-07','2026-10-07 19:10:00','PRICE','same-ms-late',null,5000),false,
  '같은 millisecond 중복 실행이 최초 run-id를 교체하지 않음');
assert.equal(sameMsApi.getProperty('portfolio_close_run_id'),'first');
assert.equal(statusVm._recordPortfolioCloseStage(sameMsApi,'2026-10-07','2026-10-07 19:09:59','PRICE','older',null,4999),false,
  '더 오래된 실행의 늦은 PRICE 마커가 최신 상태를 덮지 않음');
assert.equal(statusVm._recordPortfolioCloseStage(sameMsApi,'2026-10-07','2026-10-07 19:10:00','PRICE','newer',null,5001),false,
  '활성 PRICE 실행도 lease 안에서는 더 늦은 실행이 소유권을 탈취하지 못함');
assert.equal(sameMsApi.getProperty('portfolio_close_run_id'),'first');
assert.equal(statusVm._recordPortfolioCloseStage(sameMsApi,'2026-10-07','2026-10-07 19:25:01','PRICE','stale-recovery',null,905001),true,
  '15분 lease가 지난 미완료 마커는 시간초과 복구를 위해 새 실행이 인계 가능');
assert.equal(sameMsApi.getProperty('portfolio_close_run_id'),'stale-recovery');
const officialVm=vm.createContext({
  _normalizeDate:String,
  _getKrxAuthKey:()=> 'secret-must-not-be-revealed',
  _getKrxEndpointByMarket:x=> 'https://example.test/'+x,
  UrlFetchApp:{fetchAll:()=>[
    {getResponseCode:()=>200,getContentText:()=>JSON.stringify({OutBlock_1:[{TDD_CLSPRC:'100'}]})},
    {getResponseCode:()=>403,getContentText:()=>JSON.stringify({secret:'must-not-be-revealed'})},
    {getResponseCode:()=>200,getContentText:()=>JSON.stringify({OutBlock_1:[]})}
  ]},
  jsonOk:x=>x,
  jsonError:x=>({error:x})
});
vm.runInContext(extract('handleGetKrxSourceDiagnostics'),officialVm);
const diagnostic=officialVm.handleGetKrxSourceDiagnostics('2026-10-06');
assert.equal(diagnostic.keyConfigured,true);
assert.deepEqual(JSON.parse(JSON.stringify(diagnostic.markets.map(x=>x.httpStatus))),[200,403,200]);
assert.deepEqual(JSON.parse(JSON.stringify(diagnostic.markets.map(x=>x.rows))),[1,0,0]);
assert.doesNotMatch(JSON.stringify(diagnostic),/secret-must-not-be-revealed|must-not-be-revealed/,
  '인증키/원문 누출 금지');
assert.deepEqual(officialVm.handleGetKrxSourceDiagnostics('invalid').error,
  '진단할 거래일 YYYY-MM-DD를 입력하세요.');
const officialDateVm=vm.createContext({_normalizeDate:String});
vm.runInContext(extract('_getOfficialKrxPriceHistoryLastDate'), officialDateVm);
const sourceRows=[
  ['2026-09-29','005930','','', '', 'KRX'],
  ['2026-10-05','F00001','','','','FUND_NAV_CARRY'],
  ['2026-10-06','005930','','','','YAHOO_KRX_BASELINE_VERIFIED_CLOSE'],
  ['2026-10-06','005930','','','','KRX_CARRY@2026-09-29']
];
const mockPriceSheet={getLastRow:()=>5,getRange:()=>({getValues:()=>sourceRows})};
assert.equal(officialDateVm._getOfficialKrxPriceHistoryLastDate(mockPriceSheet),'2026-09-29',
  '2차 Yahoo와 펀드 NAV 날짜를 KRX 공식 종가로 오인하지 말 것');
assert.match(source, /function handleGetKrxSourceDiagnostics/);
assert.match(source, /getKrxSourceDiagnostics'\) return handleGetKrxSourceDiagnostics/);

const historyViews=fs.readFileSync('src/web/views/views_history.js','utf8');
const automationUI=historyViews.slice(historyViews.indexOf('async function loadAutomationStatusFromGsheet()'),
  historyViews.indexOf('// ═', historyViews.indexOf('async function loadAutomationStatusFromGsheet()')+50));
assert.match(automationUI, /INCOMPLETE: \['실행 중단·미완료'/,
  '웹 카드에 INCOMPLETE 상태 번역이 있어야 함');
assert.match(automationUI, /closeRun\.startedAt/,
  '중단된 현재 마감의 실행 시간을 표시해야 함');
assert.match(automationUI, /closeRun\.state === 'INCOMPLETE'/,
  '트리거 오류와 독립적으로 실제 미완료 실행 상세를 표시');
assert.match(automationUI, /closeRun\.stage/,
  '중단된 현재 마감 단계를 표시해야 함');
assert.match(automationUI, /officialKrxPriceHistoryLastDate/,
  '공식 KRX 최근일을 전체 가격/NAV 최근일과 별도 표시해야 함');

console.log('✅ KRX 종가 검증·마감 단계 추적·공식 공급원 진단·KB NAV 회귀검사 통과');

assert.match(source, /if \(pack\.usedYmd === ymd\) officialRows = officialRows\.concat\(rows\.slice\(firstAdded\)\)/,
  '휴장일 KRX 대체 응답을 당일 공식 종가로 적재하면 안 됨');


// PR #470: 시장별 실제 완료 종가·KRX 누락일 큐 회귀검사.
const ctx = {NY:{date:'2026-10-08',hour:6},JP:{date:'2026-10-08',hour:19},HK:{date:'2026-10-08',hour:18},UK:{date:'2026-10-08',hour:11}};
const marketVm=vm.createContext({
  Utilities:{formatDate(d,tz,fmt){
    if(tz==='UTC')return d.toISOString().slice(0,10);
    const k=tz==='America/New_York'?'NY':tz==='Asia/Tokyo'?'JP':tz==='Asia/Hong_Kong'?'HK':'UK';
    return fmt==='H'?String(ctx[k].hour):ctx[k].date;
  }},
  Logger:{log(){}},
  fetchPricesKrx:()=>({}),
  _isConfirmedHistoryPrice_:(p,d)=>p.usedDate===d
});
vm.runInContext(extract('_foreignMarketTimeZone_'),marketVm);
vm.runInContext(extract('_foreignMarketRegularCloseCutoff_'),marketVm);
const deadline=(item)=>marketVm._foreignMarketRegularCloseCutoff_(item,new Date());
assert.equal(deadline({code:'AAPL',currency:'USD',market:'US'}),'2026-10-07','미국 전일 완료 세션');
assert.equal(deadline({code:'7203',currency:'JPY',market:'JP'}),'2026-10-08','일본 당일 완료 세션');
assert.equal(deadline({code:'0700',currency:'HKD',market:'HK'}),'2026-10-08','홍콩 당일 완료 세션');
assert.equal(deadline({code:'UK1',currency:'GBP',market:'UK'}),'2026-10-07','런던 장중에는 전일 확정값');
ctx.NY={date:'2026-10-12',hour:6};
assert.equal(deadline({code:'AAPL',currency:'USD',market:'US'}),'2026-10-09','월요일은 직전 금요일 종가');
let queried=[];
marketVm.fetchPricesYahooRegularClose=(items,d,latest)=>{
  queried.push({code:items[0].code,cutoff:d,latest});
  const sourceDate=items[0].code==='AAPL'?'2026-10-06':d; // 미국 시장 휴장/원천 누락 이전 확정일
  return {[items[0].code]:{price:200,usedDate:sourceDate,marketDate:sourceDate,status:'CONFIRMED',priceType:'REGULAR_CLOSE'}};
};
vm.runInContext(extract('fetchPricesGoogleFinance'),marketVm);
const evalRows=marketVm.fetchPricesGoogleFinance([
  {code:'AAPL',currency:'USD',market:'US'}, {code:'7203',currency:'JPY',market:'JP'},
  {code:'0700',currency:'HKD',market:'HK'}],'2026-10-08',null,{skipKrx:true,useMarketCloseCutoffs:true,asOf:new Date()});
assert.equal(queried.length,3,'해외 종목별 시장 일정에 따른 요청');
assert.equal(queried.find(x=>x.code==='AAPL').cutoff,'2026-10-09');
assert.equal(queried.find(x=>x.code==='7203').cutoff,'2026-10-08');
assert.equal(evalRows.AAPL.usedDate,'2026-10-06','Yahoo 원천 실제 거래일 보존');
assert.match(closeSection,/useMarketCloseCutoffs:\s*true, asOf: new Date\(requestedCloseDate/);

const yahooVm=vm.createContext({
  _yahooEquitySymbol_:(i)=>i.code,
  _yahooRequest_:()=>({payload:{}}),
  _parseYahooChart_:()=>({points:[{date:'2026-11-25',value:100},{date:'2026-11-27',value:110}]}),
  _foreignMarketTimeZone_:()=> 'America/New_York',
  Logger:{log(){}}
});
vm.runInContext(extract('fetchPricesYahooRegularClose'),yahooVm);
assert.equal(yahooVm.fetchPricesYahooRegularClose([{code:'AAPL',market:'US'}],'2026-11-26',true).AAPL.usedDate,
  '2026-11-25','미국 추수감사절 당일은 직전 실제 Yahoo 거래일 선택');

const queueMap=new Map();
const props={getProperty(k){return queueMap.has(k)?queueMap.get(k):null;},setProperty(k,v){queueMap.set(k,String(v));},deleteProperty(k){queueMap.delete(k);}};
const qvm=vm.createContext({
  _portfolioFundAtomic_:callback=>callback(props),
  _portfolioFundState_:(p,key)=>JSON.parse(p.getProperty(key)||'null'),
  PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:'portfolio_close_pending_krx_dates',
  PORTFOLIO_CLOSE_BACKFILL_RETRY_CURSOR_KEY:'portfolio_close_backfill_retry_cursor_v1',
  Logger:{log(){}},
  _krxCalendarStatus_:(d)=>d==='2026-10-09'?'CLOSED':'OPEN',
  _normalizeDate:(d)=>String(d||'').slice(0,10),
  _fundDateOffset:(d,n)=>{const z=new Date(d+'T00:00:00Z');z.setUTCDate(z.getUTCDate()+n);return z.toISOString().slice(0,10);},
  _getLatestLifecycleValidSnapshotDate:()=> '2026-10-06',
  _getDailyHeldCodeItems:(ss,date,catalog)=>catalog,
  getCodeItems:()=>[{code:'005930',currency:'KRW',market:'KOSPI'}],
  _appendPortfolioCloseSyncLog:()=>{}
});
for(const n of ['_readPendingKrxCloseDates_','_enqueuePendingKrxCloseDate_','_completePendingKrxCloseDate_','_hasKrxHoldingsForCloseDate_','_seedMissingKrxCloseDates_','_reconcileRecoveredPortfolioPrice_','_retryOnePendingKrxClose_']){
  vm.runInContext(extract(n),qvm);
}
qvm._seedMissingKrxCloseDates_(null,props,'2026-10-10');
assert.deepEqual(JSON.parse(JSON.stringify(qvm._readPendingKrxCloseDates_(props))),['2026-10-07','2026-10-08'],
  '장애 기간 거래일 큐 재구성, 10/09 휴장 제외');
props.setProperty('snapshot_last_success_date','2026-10-10');
qvm.saveDailyPriceHistory=(date)=>{assert.equal(date,'2026-10-07');props.setProperty('snapshot_last_success_date',date);return{rows:39};};
const backfill=qvm._retryOnePendingKrxClose_(props,'2026-10-10');
assert.equal(backfill.ok,true);
assert.equal(props.getProperty('snapshot_last_success_date'),'2026-10-10','과거 복구가 오늘 마지막 성공일을 덮지 않음');
assert.deepEqual(JSON.parse(JSON.stringify(qvm._readPendingKrxCloseDates_(props))),['2026-10-08'],'1건만 처리 후 나머지 보존');
props.setProperty('portfolio_close_pending_krx_dates','[]');
props.setProperty('snapshot_last_success_date','2026-10-06');
qvm._seedMissingKrxCloseDates_(null,props,'2026-10-10',[{code:'AAPL',currency:'USD',market:'US'}]);
assert.equal(qvm._readPendingKrxCloseDates_(props).length,0,'미국 전용 계좌의 세션일 차이는 KRX 누락일이 아님');
qvm._seedMissingKrxCloseDates_(null,props,'2026-10-10',[{code:'005930',currency:'KRW',market:'KOSPI'}]);
assert.deepEqual(JSON.parse(JSON.stringify(qvm._readPendingKrxCloseDates_(props))),['2026-10-07','2026-10-08'],
  'KRX 국내 보유 종목이 있으면 누락 거래일을 복구');
assert.match(extract('fetchPricesKrxViaOtp'), /_krxCalendarStatus_\(actualDate\) !== 'CLOSED'/,
  'OTP fallback도 2027 포함 단일 KRX 달력을 사용해야 함');
const calendar=vm.createContext({_normalizeDate:x=>String(x||''),KRX_CONFIRMED_CLOSED_DATES_2026:{'2026-10-09':1},KRX_CONFIRMED_CLOSED_DATES_2027:{'2027-02-09':1}});
vm.runInContext(extract('_krxCalendarStatus_'),calendar);
assert.equal(calendar._krxCalendarStatus_('2027-02-09'),'CLOSED');
assert.equal(calendar._krxCalendarStatus_('2027-02-10'),'OPEN');
assert.equal(calendar._krxCalendarStatus_('2028-03-01'),'UNKNOWN','알 수 없는 연도 휴장일을 거래일 확정으로 오인하지 않음');
console.log('✅ PR470 해외시장 세션·휴장일·KRX 누락일 큐 회귀검사 통과');


// 해외 전용 계좌는 실제 미국 이전 완료 세션의 마감을 성공으로 인정하고 watchdog 중복 평가를 막습니다.
const previousSession={runDate:'2026-10-08',priceDate:'2026-10-07',priceOk:true,fundOk:true,krxCloseRequired:false,errors:[]};
let calendarClosedInTest=false;
let heldMarketItems=[];
let watchdogReexecutions=0;
const wdVm=vm.createContext({
  today:()=> '2026-10-08', _krxCalendarStatus_:()=> calendarClosedInTest?'CLOSED':'OPEN',
  getss:()=>({}),getCodeItems:()=>heldMarketItems,
  _getDailyHeldCodeItems:()=>heldMarketItems,
  _normalizeDate:x=>String(x||''),
  _appendPortfolioCloseSyncLog:()=>{},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='portfolio_close_last_result'?JSON.stringify(previousSession):null})},
  _portfolioCloseRunState:()=>({state:'COMPLETE',runDate:previousSession.runDate}),
  runDailyPortfolioClose1900:()=>{watchdogReexecutions++;return{ok:true};}
});
vm.runInContext(extract('_hasForeignHeldItemsForCloseWatchdog_'),wdVm);
vm.runInContext(extract('runPortfolioCloseWatchdog2030'),wdVm);
const foreignOnly=wdVm.runPortfolioCloseWatchdog2030();
assert.equal(foreignOnly.skipped,true,'해외 전용 계좌의 이전 완료 세션 평가 정상');
assert.equal(watchdogReexecutions,0,'정상 해외 계좌 watchdog 중복 마감 방지');
previousSession.krxCloseRequired=true;
const krxMissing=wdVm.runPortfolioCloseWatchdog2030();
assert.equal(watchdogReexecutions,1,'국내 당일 확정 종가 누락 시 기존 watchdog 재시도 유지');
assert.equal(krxMissing.ok,true);

// 한국 휴장일: 당일 실패 마감이면 해외 원천/펀드 오류를 재시도해야 함.
calendarClosedInTest=true;
previousSession.errors=['fund failed'];
const holidayError=wdVm.runPortfolioCloseWatchdog2030();
assert.equal(holidayError.ok,true,'휴장일 당일 실패한 마감을 재실행');
assert.equal(watchdogReexecutions,2,'한국장 휴장일 실패를 사전에 SKIP하지 않음');
// 한국 휴장일: 정상 완료 마감은 직전 KRX 확정 종가를 인정하고 다시 실행하지 않음.
previousSession.errors=[];
const holidayDone=wdVm.runPortfolioCloseWatchdog2030();
assert.equal(holidayDone.skipped,true);
assert.equal(holidayDone.reason,'ALREADY_COMPLETE');
assert.equal(watchdogReexecutions,2,'휴장일 완료된 마감은 중복 재실행하지 않음');
// 당일 실행 자체가 없다면 국내 전용은 건너뛰고, 해외 보유 종목이 있으면 평가 시도.
previousSession.runDate='2026-10-07';
heldMarketItems=[{code:'005930',currency:'KRW',market:'KR'}];
const closedNoForeign=wdVm.runPortfolioCloseWatchdog2030();
assert.equal(closedNoForeign.reason,'NON_TRADING_DAY');
assert.equal(watchdogReexecutions,2,'국내 휴장일 국내 전용 계좌 불필요 재시도 차단');
heldMarketItems=[{code:'7203',currency:'JPY',market:'JP'}];
const closedForeign=wdVm.runPortfolioCloseWatchdog2030();
assert.equal(closedForeign.ok,true);
assert.equal(watchdogReexecutions,3,'KRX 휴장에도 일본 등 해외 보유 평가 시도');
console.log('✅ KRX 휴장일 watchdog 실패 재시도/국내 skip/해외 평가 회귀검사 통과');

// 한국 휴장일 + 해외 개장 혼합 계좌: 실제 해외 확정일로 Snapshot을 생성하고
// KRX 종가는 가격이력 이전 확정값을 CARRY로 사용해야 하며 미래값은 금지합니다.
const mixedCloseVm=vm.createContext({
  _normalizeDate:v=>String(v||'').slice(0,10),
  _krxCalendarStatus_:d=>d==='2026-10-09'?'CLOSED':'OPEN',
  _isConfirmedHistoryPrice_:(p,d)=>!!p && p.price>0 && p.status==='CONFIRMED'
    && p.priceType==='REGULAR_CLOSE' && p.marketDate===d
});
vm.runInContext(extract('_latestConfirmedForeignCloseDate_'),mixedCloseVm);
vm.runInContext(extract('_selectPortfolioCloseSnapshotDate_'),mixedCloseVm);
const confirmedClose=(date)=>({price:100,usedDate:date,marketDate:date,status:'CONFIRMED',priceType:'REGULAR_CLOSE'});
const mixedItems=[
  {code:'005930',currency:'KRW',market:'KR'},
  {code:'7203',currency:'JPY',market:'JP'},
  {code:'0700',currency:'HKD',market:'HK'},
  {code:'AAPL',currency:'USD',market:'US'}
];
const foreignVerified={
  '7203':confirmedClose('2026-10-09'),
  '0700':confirmedClose('2026-10-09'),
  AAPL:confirmedClose('2026-10-08')
};
const foreignAsOf=mixedCloseVm._latestConfirmedForeignCloseDate_(mixedItems,foreignVerified,'2026-10-09');
assert.equal(foreignAsOf,'2026-10-09','한국 휴장·일본/홍콩 당일 확정 종가 인정');
assert.equal(mixedCloseVm._selectPortfolioCloseSnapshotDate_('2026-10-09','2026-10-08',true,'',foreignAsOf),
  '2026-10-09','KRX 10/08 종가 CARRY와 JP/HK 10/09 확정가의 Snapshot 평가 기준일');
assert.equal(mixedCloseVm._selectPortfolioCloseSnapshotDate_('2026-10-08','2026-10-08',true,'','2026-10-09'),
  '2026-10-08','KRX 정상장에는 해외 미래종가로 날짜가 바뀌지 않음');
assert.equal(mixedCloseVm._selectPortfolioCloseSnapshotDate_('2026-10-09','2026-10-08',true,'','2026-10-08'),
  '2026-10-08','해외 최신 완료일이 직전 KRX와 같으면 기존 확정일 유지');
const futureForeign={'7203':confirmedClose('2026-10-12'),'0700':{price:100,usedDate:'2026-10-09',marketDate:'2026-10-09',status:'PARTIAL',priceType:'REGULAR_CLOSE'}};
assert.equal(mixedCloseVm._latestConfirmedForeignCloseDate_(mixedItems,futureForeign,'2026-10-09'),'',
  '미래/미확정 해외가격으로 한국 휴장일 Snapshot을 생성하지 않음');
assert.equal(mixedCloseVm._selectPortfolioCloseSnapshotDate_('2026-10-09','2026-10-08',true,'',''),
  '2026-10-08','해외 확정 종가가 없으면 KRX 직전일 평가를 임의로 앞당기지 않음');
assert.match(closeSection,/var latestForeignCloseDate = _latestConfirmedForeignCloseDate_\(items, gfPrev, requestedCloseDate\)/);
assert.match(closeSection,/_buildSnapshotRowsFromTradeAndPriceHistory\(ss, snapshotDate\)/,
  '휴장일 해외 기준일을 선택한 다음 기존 코드별 직전 확정종가·펀드 NAV 이월 빌더를 사용');
console.log('✅ 한국 휴장일 혼합 계좌 해외 확정일 Snapshot·미래가격 차단 계약 통과');

// 휴장일에 KRX API/OTP 장애가 나더라도 공식 저장 종가만 사용해 해외 개장
// 시장의 Snapshot을 구성할 수 있어야 합니다. 비공식/수동/미래 값은 제외.
const krxStoredRows=[
  ['2026-10-08','005930','삼성전자',80000,'','KRX'],
  ['2026-10-08','000660','SK하이닉스',205000,'','KRX_OTP'],
  ['2026-10-09','005930','삼성전자',90000,'','MANUAL'],
  ['2026-10-09','000660','SK하이닉스',220000,'','YAHOO_KRX_BASELINE_VERIFIED_CLOSE'],
  ['2026-10-10','005930','삼성전자',300000,'','KRX'],
  ['2026-09-29','005930','삼성전자',75000,'','KRX']
];
const krxStoredVm=vm.createContext({
  _krxCalendarStatus_:d=>d==='2026-10-09'?'CLOSED':'OPEN',
  _cleanCode:v=>String(v||'').trim(),
  _isFundCode:v=>/^F\d{5}$/.test(String(v||'')),
  _normalizeDate:v=>String(v||'').slice(0,10),
  _countBusinessWeekdaysBetween:(a,b)=>a==='2026-09-29'?5:0,
  CONFIG:{SHEET_PH:'가격이력'}
});
vm.runInContext(extract('_readStoredOfficialKrxClosesForHoliday_'),krxStoredVm);
vm.runInContext(extract('_assessDailyKrxStockClose'),krxStoredVm);
const krxOnly=[
  {code:'005930',name:'삼성전자',currency:'KRW',market:'KOSPI'},
  {code:'000660',name:'SK하이닉스',currency:'KRW',market:'KOSDAQ'}
];
const storedSh={getLastRow:()=>krxStoredRows.length+1,
  getRange:()=>({getValues:()=>krxStoredRows})};
const storedBook={getSheetByName:()=>storedSh};
const verifiedCarry=krxStoredVm._readStoredOfficialKrxClosesForHoliday_(storedBook,krxOnly,'2026-10-09');
assert.equal(verifiedCarry['005930'].price,80000,'휴장일 수동/미래 입력값은 공식 종가를 덮지 못함');
assert.equal(verifiedCarry['000660'].price,205000,'KRX OTP 직전 종가도 공식 확정 후보');
assert.equal(verifiedCarry['005930'].usedDate,'2026-10-08');
assert.deepEqual(JSON.parse(JSON.stringify(krxStoredVm._assessDailyKrxStockClose(krxOnly,verifiedCarry,'2026-10-09'))),
  {required:true,date:'2026-10-08',confirmed:2,expected:2,lag:0},
  '휴장일 저장 공식 종가도 시장별 coverage 검사 통과');
assert.deepEqual(JSON.parse(JSON.stringify(
  krxStoredVm._readStoredOfficialKrxClosesForHoliday_(storedBook,krxOnly,'2026-10-08'))),{},
  '정상 거래일에는 저장 가격으로 KRX 당일 조회 실패를 숨길 수 없음');
const onlyUnofficial={getSheetByName:()=>({getLastRow:()=>3,getRange:()=>({getValues:()=>krxStoredRows.slice(2,4)})})};
assert.deepEqual(JSON.parse(JSON.stringify(
  krxStoredVm._readStoredOfficialKrxClosesForHoliday_(onlyUnofficial,krxOnly,'2026-10-09'))),{},
  'YAHOO·MANUAL 값은 KRX로 승격되지 않음');
const oldOnly={getSheetByName:()=>({getLastRow:()=>2,getRange:()=>({getValues:()=>[krxStoredRows[5]]})})};
const oldPrices=krxStoredVm._readStoredOfficialKrxClosesForHoliday_(oldOnly,krxOnly,'2026-10-09');
assert.throws(()=>krxStoredVm._assessDailyKrxStockClose(krxOnly,oldPrices,'2026-10-09'),
  /확정 종가 오래됨/,'오래된 KRX 가격이력은 휴장일에도 정상확정 금지');
assert.match(closeSection,/_krxCalendarStatus_\(requestedCloseDate\) === 'CLOSED'/,
  '한국 휴장일에만 저장 공식 종가를 사용');
assert.match(closeSection,/if \(krxPrev\[code\] && Number\(krxPrev\[code\]\.price\) > 0\) return;/,
  '휴장일 새 공식 가격이 있으면 보존하고 누락 코드만 보충');
console.log('✅ 휴장일 KRX 공급원 장애·공식 가격 CARRY·원천 검증 회귀검사 통과');


// PR470 Codex P1: 실제 종목코드 마스터의 6자리 정규화가 JP/HK Yahoo 심볼을 망가뜨리지 않음.
const symbolVm=vm.createContext({
  CONFIG:{SHEET_CODES:'종목코드'},
  Logger:{log(){}}
});
vm.runInContext(extract('_cleanCode'),symbolVm);
vm.runInContext(extract('getCodeItems'),symbolVm);
vm.runInContext(extract('_yahooEquitySymbol_'),symbolVm);
const catalogSheet={
  getLastRow:()=>5,getLastColumn:()=>6,
  getRange:()=>({getValues:()=>[
    [7203,'Toyota','주식','','JPY','JP'],
    ['0700','Tencent','주식','','HKD','HK'],
    ['80011','HK Five Digit','주식','','HKD','HK'],
    ['AAPL','Apple','주식','','USD','US']
  ]})
};
const catalog=symbolVm.getCodeItems({getSheetByName:()=>catalogSheet});
assert.equal(catalog.length,4);
assert.equal(catalog[0].code,'007203','국내 원장 호환용 6자리 코드 유지');
assert.equal(symbolVm._yahooEquitySymbol_(catalog[0]),'7203.T','JP Yahoo 종목코드는 4자리로');
assert.equal(catalog[1].code,'000700');
assert.equal(symbolVm._yahooEquitySymbol_(catalog[1]),'0700.HK','HK Yahoo는 최소 4자리');
assert.equal(symbolVm._yahooEquitySymbol_(catalog[2]),'80011.HK','HK 5자리 코드는 원래 길이');
assert.equal(symbolVm._yahooEquitySymbol_(catalog[3]),'AAPL','미국 티커 보존');
assert.equal(symbolVm._yahooEquitySymbol_({code:'000700',market:'HK',yahooSymbol:'0700.HK'}),'0700.HK',
  '지정된 공급원 심볼 우선');

// PR470 Codex P2: KRX 휴장일 2개 시장 중 1개만 성공해도 저장 공식 종가로 누락 시장만 병합.
const holidayRows={
  '005930':{price:120000,source:'KRX',usedDate:'2026-10-08'},
  '000660':{price:300000,source:'KRX_OTP',usedDate:'2026-10-08'}
};
Object.defineProperty(holidayRows,'_krxMarketEvidence',{
  value:{
    KOSPI:{count:900,date:'2026-10-08'},
    KOSDAQ:{count:0,date:'2026-10-09'},
    ETF:{count:0,date:'2026-10-09'},
    codeMarkets:{'005930':'KOSPI','000660':'KOSDAQ'},
    holidayStoredCodes:{'000660':true}
  },enumerable:false
});
const holidayItems=[
  {code:'005930',name:'삼성전자',currency:'KRW',market:'KOSPI'},
  {code:'000660',name:'SK하이닉스',currency:'KRW',market:'KOSDAQ'}
];
const holidayPartial=clone(context._assessDailyKrxStockClose(holidayItems,holidayRows,'2026-10-09'));
assert.equal(holidayPartial.confirmed,2,'KRX 휴장일 일부 시장은 저장된 같은 공식 거래일로 보충');
const holidayNoProvenance={
  '005930':holidayRows['005930'],'000660':holidayRows['000660']
};
Object.defineProperty(holidayNoProvenance,'_krxMarketEvidence',{
  value:{...holidayRows._krxMarketEvidence,holidayStoredCodes:{}},enumerable:false
});
assert.throws(()=>context._assessDailyKrxStockClose(holidayItems,holidayNoProvenance,'2026-10-09'),
  /KRX 공식 시장별 확정 종가 누락/,
  '저장 공식 종가 보충의 출처 확인이 없다면 부분 API 장애를 정상 판정하지 않음');
assert.throws(()=>context._assessDailyKrxStockClose(holidayItems,holidayRows,'2026-10-08'),
  /KRX 공식 시장별 확정 종가 누락/,
  '정규 거래일에는 저장 종가로 실패한 공식 시장 API를 대체하지 않음');
const holidayFetchSection=extract('saveDailyPriceHistory');
assert.match(holidayFetchSection,/Object\.keys\(storedKrx\)\.forEach\(function\(code\)/,
  'KRX 응답 전체 0건에 한정하지 말고 누락 코드별 보충');
assert.match(holidayFetchSection,/holidayStoredCodes\[code\] = true/,
  '저장 공식 종가로 보충한 코드의 근거 기록');
console.log('✅ PR470 JP/HK 실제 마스터 심볼 및 KRX 휴장일 부분 원천 장애 회귀검사 통과');


// OpenAPI 실제 계약: _krxMarketEvidence는 configurable:false이므로 휴장일 partial merge가 재정의하면 예외.
vm.runInContext(extract('_markHolidayKrxStoredCodes_'),context);
const retainedMarketEvidence={KOSPI:{count:950,date:'2026-10-08'},KOSDAQ:{count:0,date:'2026-10-09'},
  codeMarkets:{'005930':'KOSPI','000660':'KOSDAQ'}};
const partialOpenApi={'005930':{price:120000,usedDate:'2026-10-08',source:'KRX'}};
Object.defineProperty(partialOpenApi,'_krxMarketEvidence',{value:retainedMarketEvidence,enumerable:false});
assert.equal(Object.getOwnPropertyDescriptor(partialOpenApi,'_krxMarketEvidence').configurable,false,
  '실제 OpenAPI evidence 속성은 재정의 불가');
assert.doesNotThrow(()=>context._markHolidayKrxStoredCodes_(partialOpenApi,{'000660':true}),
  '휴장일 partial OpenAPI + 저장 공식 종가 병합은 non-configurable evidence를 재정의하지 않아야 함');
assert.equal(partialOpenApi._krxMarketEvidence,retainedMarketEvidence,'원본 OpenAPI 시장 증거 그대로 유지');
assert.equal(partialOpenApi._krxMarketEvidence.KOSPI.count,950,'기존 market metadata 훼손 방지');
assert.equal(partialOpenApi._krxMarketEvidence.holidayStoredCodes['000660'],true,'저장 공식 종가 코드별 출처 남김');
const entirelyMissingOpenApi={};
context._markHolidayKrxStoredCodes_(entirelyMissingOpenApi,{'000660':true});
assert.equal(entirelyMissingOpenApi._krxMarketEvidence.holidayStoredCodes['000660'],true,
  'KRX 전체 실패 때는 신규 evidence 생성');
assert.equal(Object.keys(entirelyMissingOpenApi).includes('_krxMarketEvidence'),false,'evidence 내부 메타는 저장할 종목 행이 아님');
console.log('✅ non-configurable KRX source evidence 안전 병합 회귀검사 통과');

// PR472 quality gate: reproduce both latest Codex P2 findings BEFORE fixing source.
{
  const bag=new Map([['portfolio_fund_deferred_schedule_v1',
    JSON.stringify({date:'2026-10-08',triggerId:'P2-lease',until:2000000,attempts:2})],
    ['portfolio_close_stage','PRICE'],['portfolio_close_run_started_ms','9900']]);
  let fundCalls=0;
  const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  const ctx=vm.createContext({
    today:()=> '2026-10-08',Date:{now:()=>10000},
    Utilities:{getUuid:()=> 'attempt-last'},
    PORTFOLIO_FUND_SCHEDULE_KEY:'portfolio_fund_deferred_schedule_v1',
    PORTFOLIO_FUND_LEASE_KEY:'portfolio_fund_run_lease_v1',
    PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'portfolio_close_backfill_lease_v1',
    _portfolioFundAtomic_:callback=>callback(p),
    _portfolioFundState_:(props,key)=>JSON.parse(props.getProperty(key)||'null'),
    ScriptApp:{getProjectTriggers:()=>[],deleteTrigger:()=>{}},
    _appendPortfolioCloseSyncLog:()=>{},_reconcilePortfolioFundBusy_:()=>{},
    _runPortfolioFundWithLease_:()=>{fundCalls++;return {lastDate:'2026-10-08'};}
  });
  vm.runInContext(extract('runDeferredFundAfterPortfolioCloseFailure'),ctx);
  const blocked=ctx.runDeferredFundAfterPortfolioCloseFailure({triggerUid:'P2-lease'});
  assert.equal(blocked.reason,'FUND_BUSY_RETRY_LATER',
    '활성 PRICE와 충돌한 지연 NAV는 실제 작업을 시작하면 안 됨');
  assert.equal(fundCalls,0,'활성 PRICE 중 NAV 실행 진입 금지');
  assert.equal(JSON.parse(p.getProperty('portfolio_fund_deferred_schedule_v1')).attempts,2,
    'PRICE 충돌로 마지막 NAV 기회 소비 금지');
  bag.delete('portfolio_close_stage');
  // Race after reservation but before NAV lease: failed lease acquisition must roll back attempt.
  ctx._runPortfolioFundWithLease_=()=>{
    const e=new Error('FUND_BUSY: 통합 마감 PRICE/FUND 실행 중');
    e.fundBusyReason='CLOSE_ACTIVE';throw e;
  };
  const raced=ctx.runDeferredFundAfterPortfolioCloseFailure({triggerUid:'P2-lease'});
  assert.equal(raced.reason,'FUND_BUSY_RETRY_LATER',
    '예약 직후 경합에도 완료 시도 소모 없이 다음 트리거로 복구');
  assert.equal(JSON.parse(p.getProperty('portfolio_fund_deferred_schedule_v1')).attempts,2,
    'lease 취득 실패를 실제 시도 횟수에 포함하지 않음');
}
{
  const bag=new Map([['portfolio_close_last_result',
    JSON.stringify({runDate:'2026-10-08',priceOk:false,fundOk:true,
      priceDate:'',errors:['일반 종목: KRX 0건']})]]);
  const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  const ctx=vm.createContext({
    today:()=> '2026-10-08',_krxCalendarStatus_:()=> 'OPEN',
    PropertiesService:{getScriptProperties:()=>p},_normalizeDate:x=>String(x||''),
    _portfolioCloseRunState:()=>({state:'ERROR',runDate:'2026-10-08'}),
    _appendPortfolioCloseSyncLog:()=>{},_portfolioFundAtomic_:cb=>cb(p),
    _portfolioFundState_:(props,key)=>JSON.parse(props.getProperty(key)||'null'),
    PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:'portfolio_close_pending_krx_dates',
    PORTFOLIO_CLOSE_BACKFILL_RETRY_CURSOR_KEY:'portfolio_close_backfill_retry_cursor_v1',
    Logger:{log(){}},
    runDailyPortfolioClose1900:()=>({skipped:true,reason:'NEWER_OR_SAME_START_OWNS_STATE'})
  });
  for(const name of ['_readPendingKrxCloseDates_','_enqueuePendingKrxCloseDate_',
    'runPortfolioCloseWatchdog2030'])vm.runInContext(extract(name),ctx);
  const skipped=ctx.runPortfolioCloseWatchdog2030();
  assert.equal(skipped.skipped,true);
  assert.deepEqual(JSON.parse(p.getProperty('portfolio_close_pending_krx_dates')),['2026-10-08'],
    'watchdog 잠금 충돌로 누락된 PRICE는 독립 재시도 대기열에 영속 보관');
  // 22:10 worker must recover today's queued date; regular 19:00 may only retry older days.
  let writes=0;
  ctx._completePendingKrxCloseDate_=()=>p.deleteProperty('portfolio_close_pending_krx_dates');
  ctx._appendPortfolioCloseSyncLog=()=>{};
  ctx._portfolioFundState_=(props,key)=>JSON.parse(props.getProperty(key)||'null');
  ctx._fundPropertyText=String;
  ctx._portfolioFundAtomic_=cb=>cb(p);
  ctx.saveDailyPriceHistory=(date)=>{writes++;assert.equal(date,'2026-10-08');
    p.setProperty('snapshot_last_success_date',date);
    return {date,rows:9,krxCloseRequired:true};};
  vm.runInContext(extract('_reconcileRecoveredPortfolioPrice_'),ctx);
  vm.runInContext(extract('_retryOnePendingKrxClose_'),ctx);
  assert.equal(ctx._retryOnePendingKrxClose_(p,'2026-10-08',false).attempted,false,
    '정규 마감 내부의 과거 백필은 당일 PRICE 중복 수행 금지');
  const recovery=ctx._retryOnePendingKrxClose_(p,'2026-10-08',true);
  assert.equal(recovery.ok,true,'독립 22:10 복구는 당일 누락 PRICE를 실제 재시도');
  assert.equal(writes,1,'동일 날짜 가격 재시도는 한 번만 실행');
  assert.equal(p.getProperty('snapshot_last_success_date'),'2026-10-08',
    '당일 복구의 스냅샷 성공 상태를 과거 백필 로직이 되돌리면 안 됨');
  const summary=JSON.parse(p.getProperty('portfolio_close_last_result'));
  assert.equal(summary.priceOk,true,'복구 성공 뒤 마감 summary의 PRICE 오류 제거');
  assert.equal(summary.fundOk,true,'독립 NAV 성공 상태 보존');
  assert.deepEqual(summary.errors,[],'PRICE 오류가 해결되면 error summary 제거');
}

// Historical order inversion: same-day PRICE recovered before deferred NAV completes.
// Reconciliation must still mark both successful and not strand an ERROR state.
{
  const bag=new Map([
    ['portfolio_close_last_result',JSON.stringify({
      runDate:'2026-10-08',startedMs:1000,priceOk:true,priceDate:'2026-10-08',
      fundOk:false,fundDeferred:true,fundDeferredTriggerId:'same-nav-trigger',errors:[]
    })],
    ['portfolio_fund_deferred_success_v1',JSON.stringify({
      date:'2026-10-08',at:2000,token:'token-nav',triggerId:'same-nav-trigger'
    })],
    ['portfolio_close_run_date','2026-10-08'],['portfolio_close_stage','ERROR']
  ]);
  const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  const ctx=vm.createContext({
    _portfolioFundAtomic_:cb=>cb(p),
    _portfolioFundState_:(props,key)=>JSON.parse(props.getProperty(key)||'null'),
    PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
    PORTFOLIO_FUND_CLOSE_SUCCESS_KEY:'portfolio_fund_close_success_v1',
    _fundPropertyText:String
  });
  vm.runInContext(extract('_reconcilePortfolioFundBusy_'),ctx);
  ctx._reconcilePortfolioFundBusy_('2026-10-08');
  const outcome=JSON.parse(p.getProperty('portfolio_close_last_result'));
  assert.equal(outcome.priceOk,true,'이미 복구된 PRICE 성공 유지');
  assert.equal(outcome.fundOk,true,'PRICE 먼저 성공해도 deferred NAV의 늦은 성공 반영');
  assert.equal(p.getProperty('portfolio_close_stage'),'COMPLETE',
    '가격 재시도와 NAV 완료의 역순 경합도 최종 COMPLETE 기록');
}
// Mutation smoke: removing the new preflight PRICE check must change the
// deferred outcome. This confirms the new regression detects a real fault.
{
  const original=extract('runDeferredFundAfterPortfolioCloseFailure');
  const mutant=original.replace("(closeStage === 'PRICE' || closeStage === 'FUND')","false");
  assert.notEqual(mutant,original,'preflight 충돌 검사를 실제로 제거한 변이 생성');
  const bag=new Map([
    ['portfolio_fund_deferred_schedule_v1',
      JSON.stringify({date:'2026-10-08',triggerId:'mutation-nav',until:50000,attempts:2})],
    ['portfolio_close_stage','PRICE'],['portfolio_close_run_started_ms','9000']
  ]);
  const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  const ctx=vm.createContext({
    today:()=> '2026-10-08',Date:{now:()=>10000},
    Utilities:{getUuid:()=> 'mutation-attempt'},
    PORTFOLIO_FUND_SCHEDULE_KEY:'portfolio_fund_deferred_schedule_v1',
    PORTFOLIO_FUND_LEASE_KEY:'portfolio_fund_run_lease_v1',
    PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'portfolio_close_backfill_lease_v1',
    _portfolioFundAtomic_:cb=>cb(p),_portfolioFundState_:(props,key)=>JSON.parse(props.getProperty(key)||'null'),
    ScriptApp:{getProjectTriggers:()=>[],deleteTrigger:()=>{}},
    _appendPortfolioCloseSyncLog:()=>{},_reconcilePortfolioFundBusy_:()=>{},
    _runPortfolioFundWithLease_:()=>({lastDate:'2026-10-08'})
  });
  vm.runInContext(mutant,ctx);
  const changed=ctx.runDeferredFundAfterPortfolioCloseFailure({triggerUid:'mutation-nav'});
  assert.notEqual(changed.reason,'FUND_BUSY_RETRY_LATER',
    '차단 검사 제거 변이에서는 정상 코드와 달리 NAV 실행으로 빠져 테스트가 이를 탐지');
}

console.log('✅ PR472 품질 게이트: 예약 선차단·경합 롤백·watchdog 보류·당일 백필·결과 정합성');

// Manual Snapshot write must join the same writer-exclusion protocol as
// regular CLOSE, deferred NAV, and historical backfill.
{
  const guardedManual=extract('_runManualPriceSnapshotGuarded_');
  const manualEntry=extract('runDailyPriceSnapshotNow');
  const legacyEntry=extract('runEvalPriceUpdate1620');
  assert.match(manualEntry,/_runManualPriceSnapshotGuarded_\(\)/,
    '수동 가격 갱신 메뉴가 동일 writer lease 경로를 사용');
  assert.match(legacyEntry,/_runManualPriceSnapshotGuarded_\(\)/,
    '레거시 수동 호출이 공유 잠금 우회하지 않음');
  function simulateManual(busyType) {
    const now=1000000, bag=new Map(), events=[];
    const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
      deleteProperty:k=>bag.delete(k)};
    if(busyType==='FUND')bag.set('portfolio_fund_run_lease_v1',JSON.stringify({token:'nav',until:now+1000}));
    if(busyType==='BACKFILL')bag.set('portfolio_close_backfill_lease_v1',JSON.stringify({token:'replay',until:now+1000}));
    if(busyType==='CLOSE'){
      bag.set('portfolio_close_stage','PRICE');
      bag.set('portfolio_close_run_started_ms',String(now-1000));
    }
    const ctx=vm.createContext({
      Date:{now:()=>now},today:()=> '2026-10-08',Utilities:{getUuid:()=> 'manual-test'},
      _reconcileRecoveredPortfolioPrice_:()=>true,
      _completePendingKrxCloseDate_:()=>{},
      PORTFOLIO_FUND_LEASE_KEY:'portfolio_fund_run_lease_v1',
      PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'portfolio_close_backfill_lease_v1',
      _portfolioFundAtomic_:cb=>cb(p),
      _portfolioFundState_:(props,key)=>JSON.parse(props.getProperty(key)||'null'),
      saveDailyPriceHistory:()=>{
        events.push('price');
        assert.equal(JSON.parse(p.getProperty('portfolio_close_backfill_lease_v1')).token,'manual-test',
          '실제 시트 쓰기 동안 타 작성자를 차단하는 lease 유지');
        return {rows:7,date:'2026-10-08'};
      }
    });
    vm.runInContext(guardedManual,ctx);
    let result;
    try{result=ctx._runManualPriceSnapshotGuarded_();}
    catch(error){result={error:String(error.message)};}
    return {result,events,lease:p.getProperty('portfolio_close_backfill_lease_v1')};
  }
  for(const type of ['FUND','BACKFILL','CLOSE']){
    const blocked=simulateManual(type);
    assert.equal(blocked.events.length,0,type+' 활성 시 수동 PRICE 쓰기 금지');
    assert.match(blocked.result.error,/PRICE_BUSY/,type+' 경합을 사용자에게 명확히 알림');
  }
  const allowed=simulateManual('');
  assert.equal(allowed.events.length,1,'충돌이 해소된 수동 PRICE는 정상 실행');
  assert.equal(allowed.lease,null,'수동 PRICE 정상 완료 후 lease 정확히 정리');
}
console.log('✅ PR472 writer safety: 수동 가격 경로도 NAV·백필·통합 마감과 상호 배제');

// Latest Codex P2 + pre-review self-audit: a failed watchdog, a slow inline
// replay, or a state write failure must not silently lose the PRICE recovery.
{
  const bag=new Map([['portfolio_close_last_result',JSON.stringify({
    runDate:'2026-10-08',priceOk:false,fundOk:false,priceDate:'',
    errors:['일반 종목: failure']})]]);
  const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  let holiday=true;
  const ctx=vm.createContext({
    today:()=> '2026-10-08',_krxCalendarStatus_:()=> holiday?'CLOSED':'OPEN',
    PropertiesService:{getScriptProperties:()=>p},_normalizeDate:x=>String(x||''),
    _portfolioCloseRunState:()=>({state:'ERROR',runDate:'2026-10-08'}),
    _appendPortfolioCloseSyncLog:()=>{}, _portfolioFundAtomic_:cb=>cb(p),
    _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
    PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:'portfolio_close_pending_krx_dates',
    Logger:{log(){}},
    runDailyPortfolioClose1900:()=>{throw Error('holiday foreign market unavailable');}
  });
  for(const name of ['_readPendingKrxCloseDates_','_enqueuePendingKrxCloseDate_',
    'runPortfolioCloseWatchdog2030'])vm.runInContext(extract(name),ctx);
  assert.throws(()=>ctx.runPortfolioCloseWatchdog2030(),/holiday foreign market unavailable/,
    '휴장·해외 개장일 재시도 실패를 정상으로 숨기지 않음');
  assert.deepEqual(JSON.parse(p.getProperty('portfolio_close_pending_krx_dates')),['2026-10-08'],
    'watchdog 예외도 휴장일 당일 PRICE 보류 큐에 영속 저장');
  holiday=false;
  assert.throws(()=>ctx.runPortfolioCloseWatchdog2030(),/holiday foreign market unavailable/);
  assert.deepEqual(JSON.parse(p.getProperty('portfolio_close_pending_krx_dates')),['2026-10-08'],
    '동일 날짜의 반복 예외는 중복 큐 항목을 만들지 않음');
  bag.set('portfolio_close_last_result',JSON.stringify({
    runDate:'2026-10-08',priceOk:true,fundOk:false,priceDate:'2026-10-08',errors:['펀드: busy']}));
  bag.delete('portfolio_close_pending_krx_dates');
  assert.throws(()=>ctx.runPortfolioCloseWatchdog2030(),/holiday foreign market unavailable/);
  assert.equal(p.getProperty('portfolio_close_pending_krx_dates'),null,
    'PRICE 성공 상태에 대해 NAV 예외만으로 불필요한 가격 복구 예약 금지');
}
{
  const bag=new Map([['portfolio_close_pending_krx_dates',JSON.stringify(['2026-10-07'])]]);
  const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  const seen=[];
  const ctx=vm.createContext({
    PropertiesService:{getScriptProperties:()=>p},
    Date, Logger:{log(){}},today:()=> '2026-10-08',
    Utilities:{getUuid:()=> 'close-uid',formatDate:()=> '2026-10-08 19:01:00'},
    CONFIG:{TIMEZONE:'Asia/Seoul'},
    _ensurePortfolioCloseWatchdogTrigger:()=>{},_ensurePortfolioCloseBackfillTrigger:()=>{},
    _recordPortfolioCloseStage:(props,date,start,stage,token,summary)=>{
      seen.push('stage:'+stage);
      if(summary)props.setProperty('portfolio_close_last_result',JSON.stringify(summary));
      return true;
    },
    _appendPortfolioCloseSyncLog:()=>{},
    saveDailyPriceHistory:()=>{seen.push('price');return{date:'2026-10-08',rows:9};},
    _runPortfolioFundWithLease_:()=>{seen.push('fund');return{lastDate:'2026-10-08'};},
    _portfolioFundAtomic_:cb=>cb(p),
    _completePendingKrxCloseDate_:()=>{},
    _readPendingKrxCloseDates_:()=>['2026-10-07'],
    _runPendingKrxBackfillWithLease_:()=>{seen.push('inline-backfill');throw Error('slow replay');}
  });
  vm.runInContext(extract('runDailyPortfolioClose1900'),ctx);
  const summary=ctx.runDailyPortfolioClose1900();
  assert.equal(summary.priceOk,true);
  assert.equal(summary.fundOk,true);
  assert.equal(summary.backfill.reason,'ISOLATED_NIGHTLY_BACKFILL',
    '정규 마감은 과거 조회를 야간 전용 worker로 넘김');
  assert.equal(seen.includes('inline-backfill'),false,
    '시간 예산이 충분해 보여도 당일 최종 상태 전에 과거 백필 실행 금지');
  assert.equal(seen.at(-1),'stage:COMPLETE','과거 백필 이전에 당일 최종 상태 확정');
  assert.deepEqual(JSON.parse(p.getProperty('portfolio_close_pending_krx_dates')),['2026-10-07'],
    '기존 누락일 큐를 야간 worker용으로 보존');
}
{
  const bag=new Map([
    ['portfolio_close_pending_krx_dates',JSON.stringify(['2026-10-08'])],
    ['portfolio_close_last_result',JSON.stringify({
      runDate:'2026-10-08',runId:'price-proof',priceOk:false,fundOk:true,
      priceDate:'',errors:['일반 종목: price unavailable']})],
    ['portfolio_close_run_date','2026-10-08'],['portfolio_close_run_id','price-proof'],
    ['portfolio_close_stage','ERROR']
  ]);
  const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  let failWrite=true, saves=0;
  const ctx=vm.createContext({
    _portfolioFundAtomic_:cb=>{if(failWrite)throw Error('property lock failure');return cb(p);},
    _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
    PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:'portfolio_close_pending_krx_dates',
    PORTFOLIO_CLOSE_BACKFILL_RETRY_CURSOR_KEY:'portfolio_close_backfill_retry_cursor_v1',
    _fundPropertyText:String, _appendPortfolioCloseSyncLog:()=>{},
    saveDailyPriceHistory:()=>{saves++;p.setProperty('snapshot_last_success_date','2026-10-08');
      return {date:'2026-10-08',rows:4};}
  });
  for(const name of ['_readPendingKrxCloseDates_','_completePendingKrxCloseDate_',
    '_reconcileRecoveredPortfolioPrice_','_retryOnePendingKrxClose_'])vm.runInContext(extract(name),ctx);
  const failed=ctx._retryOnePendingKrxClose_(p,'2026-10-08',true);
  assert.equal(failed.ok,false,'상태 갱신 실패는 성공 백필로 오판하지 않음');
  assert.deepEqual(JSON.parse(p.getProperty('portfolio_close_pending_krx_dates')),['2026-10-08'],
    'PRICE 결과를 확정하지 못했다면 큐 항목을 삭제하지 않아 재복구 허용');
  failWrite=false;
  const retried=ctx._retryOnePendingKrxClose_(p,'2026-10-08',true);
  assert.equal(retried.ok,true);
  assert.equal(saves,2,'재실행 가능하고 멱등성은 기존 가격 upsert 계약으로 보장');
  assert.deepEqual(JSON.parse(p.getProperty('portfolio_close_pending_krx_dates')),[],
    'PRICE 결과가 성공적으로 확정된 후에만 대기열 완료');
  const last=JSON.parse(p.getProperty('portfolio_close_last_result'));
  assert.equal(last.priceOk,true);
  assert.equal(last.fundOk,true);
  assert.equal(p.getProperty('portfolio_close_stage'),'COMPLETE');
}
console.log('✅ PR471 P2 및 자체검토: watchdog 예외·야간 전용 백필·큐 삭제 트랜잭션 회귀');

// Self-review: a nightly replay that finishes after date rollover must not
// replace the newer day's summary, even if the replay successfully upserts.
{
  const nextDay={runDate:'2026-10-09',priceOk:true,fundOk:true,priceDate:'2026-10-09',errors:[]};
  const bag=new Map([
    ['portfolio_close_pending_krx_dates',JSON.stringify(['2026-10-08'])],
    ['portfolio_close_last_result',JSON.stringify(nextDay)],
    ['portfolio_close_run_date','2026-10-09'],['portfolio_close_stage','COMPLETE']
  ]);
  const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  const ctx=vm.createContext({
    PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:'portfolio_close_pending_krx_dates',
    PORTFOLIO_CLOSE_BACKFILL_RETRY_CURSOR_KEY:'portfolio_close_backfill_retry_cursor_v1',
    _portfolioFundAtomic_:cb=>cb(p),
    _portfolioFundState_:(pr,k)=>JSON.parse(pr.getProperty(k)||'null'),
    _appendPortfolioCloseSyncLog:()=>{},_fundPropertyText:String,
    saveDailyPriceHistory:()=>({date:'2026-10-08',rows:12})
  });
  for(const name of ['_readPendingKrxCloseDates_','_completePendingKrxCloseDate_',
    '_reconcileRecoveredPortfolioPrice_','_retryOnePendingKrxClose_'])vm.runInContext(extract(name),ctx);
  assert.equal(ctx._retryOnePendingKrxClose_(p,'2026-10-08',true).ok,true);
  assert.deepEqual(JSON.parse(p.getProperty('portfolio_close_last_result')),nextDay,
    '자정 경계를 건넌 완료 백필이 더 최신 날짜의 종가·NAV 마감 결과를 덮어쓰지 않음');
  assert.equal(p.getProperty('portfolio_close_stage'),'COMPLETE');
}
console.log('✅ PR471 날짜 경계: 과거 백필 뒤 새 날짜 마감 summary 보존');

// Quality gate: exercise the REAL production saveDailyPriceHistory, not a stub,
// to detect premature queue deletion inside the price writer itself.
{
  const bag=new Map([
    ['portfolio_close_pending_krx_dates',JSON.stringify(['2026-10-08'])],
    ['portfolio_close_last_result',JSON.stringify({runDate:'2026-10-08',
      runId:'price-real-run',priceOk:false,fundOk:true,errors:['일반 종목: API 실패']})],
    ['portfolio_close_run_date','2026-10-08'],['portfolio_close_run_id','price-real-run'],
    ['portfolio_close_stage','ERROR']
  ]);
  const p={getProperty:k=>bag.has(k)?bag.get(k):null,
    setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  const events=[];
  let reconciliationBlocked=true;
  const ctx=vm.createContext({
    _snapshotBackupOperationId:'',
    PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:'portfolio_close_pending_krx_dates',
    PORTFOLIO_CLOSE_BACKFILL_RETRY_CURSOR_KEY:'portfolio_close_backfill_retry_cursor_v1',
    CONFIG:{TIMEZONE:'Asia/Seoul'},
    today:()=> '2026-10-08',
    Date,Logger:{log:()=>{}},
    Utilities:{formatDate:()=> '2026-10-08 22:10:00',getUuid:()=> 'saving-real-code'},
    LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
    PropertiesService:{getScriptProperties:()=>p},
    SpreadsheetApp:{flush:()=>events.push('flush')},
    getss:()=>({}),getCodeItems:()=>[],_getDailyHeldCodeItems:()=>[],
    _normalizeDate:x=>String(x||''),
    fetchPricesKrx:()=>({}),
    _krxCalendarStatus_:()=> 'OPEN',
    _assessDailyKrxStockClose:()=>({required:false,date:'2026-10-08'}),
    _getLatestPriceHistoryDate:()=> '2026-10-08',
    _latestConfirmedForeignCloseDate_:()=> '',
    _selectPortfolioCloseSnapshotDate_:()=> '2026-10-08',
    _buildSnapshotRowsFromTradeAndPriceHistory:()=>[['snapshot-row']],
    _readSnapshotRowsByDate:()=>[],
    _snapshotRewritePlan:()=>({unsafe:[],needsRewrite:false}),
    diagnoseSnapshotIntegrity:()=>({status:'VALID'}),
    _settleSnapshotBackupOperation:()=>{},
    _appendPortfolioCloseSyncLog:()=>{},
    _portfolioFundAtomic_:cb=>{
      if(reconciliationBlocked)throw Error('post-save state lock unavailable');
      return cb(p);
    },
    _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
    _fundPropertyText:String
  });
  for(const name of ['_readPendingKrxCloseDates_','_completePendingKrxCloseDate_',
    '_enqueuePendingKrxCloseDate_','saveDailyPriceHistory','_reconcileRecoveredPortfolioPrice_','_retryOnePendingKrxClose_'])
    vm.runInContext(extract(name),ctx);
  // First check actual price-writer behavior with explicit deferred completion.
  const priceResult=ctx.saveDailyPriceHistory('2026-10-08',{deferQueueCompletion:true});
  assert.equal(priceResult.ok,true,'실제 가격 저장 함수 정상 완료');
  assert.deepEqual(JSON.parse(p.getProperty('portfolio_close_pending_krx_dates')),['2026-10-08'],
    '실제 가격 저장 함수를 실행해도 후속 상태 확인 전 큐는 반드시 유지');
  // Backfill must carry the same option all the way through production code.
  const failed=ctx._retryOnePendingKrxClose_(p,'2026-10-08',true);
  assert.equal(failed.ok,false);
  assert.deepEqual(JSON.parse(p.getProperty('portfolio_close_pending_krx_dates')),['2026-10-08'],
    '실제 saveDailyPriceHistory 내부에서도 최종 상태 저장 실패 시 큐를 보존');
  reconciliationBlocked=false;
  const recovered=ctx._retryOnePendingKrxClose_(p,'2026-10-08',true);
  assert.equal(recovered.ok,true);
  assert.deepEqual(JSON.parse(p.getProperty('portfolio_close_pending_krx_dates')),[],
    '마감 summary 성공 뒤에만 큐 삭제');
  assert.equal(JSON.parse(p.getProperty('portfolio_close_last_result')).priceOk,true);
  assert.equal(p.getProperty('portfolio_close_stage'),'COMPLETE');
  assert.ok(events.length>=3,'실제 생산 가격 함수가 반복 호출됨');
}

// Liveness: one permanently broken older trading day must not starve newer
// missing days. Preserve the failing date while rotating the retry cursor.
{
  const bag=new Map([['portfolio_close_pending_krx_dates',
    JSON.stringify(['2026-10-06','2026-10-07','2026-10-08'])]]);
  const p={getProperty:k=>bag.get(k)||null,
    setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  const visited=[];
  const ctx=vm.createContext({
    PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:'portfolio_close_pending_krx_dates',
    PORTFOLIO_CLOSE_BACKFILL_RETRY_CURSOR_KEY:'portfolio_close_backfill_retry_cursor_v1',
    _portfolioFundAtomic_:cb=>cb(p),_appendPortfolioCloseSyncLog:()=>{},
    _portfolioFundState_:(pr,k)=>JSON.parse(pr.getProperty(k)||'null'),
    saveDailyPriceHistory:date=>{
      visited.push(date);
      if(date==='2026-10-06')throw Error('unavailable historical KRX');
      return {ok:true,date,rows:2};
    }
  });
  for(const name of ['_readPendingKrxCloseDates_','_completePendingKrxCloseDate_',
    '_reconcileRecoveredPortfolioPrice_','_retryOnePendingKrxClose_'])vm.runInContext(extract(name),ctx);
  const first=ctx._retryOnePendingKrxClose_(p,'2026-10-09',true);
  const second=ctx._retryOnePendingKrxClose_(p,'2026-10-09',true);
  const third=ctx._retryOnePendingKrxClose_(p,'2026-10-09',true);
  assert.equal(first.ok,false);
  assert.equal(second.ok,true);
  assert.equal(third.ok,true);
  assert.deepEqual(visited,['2026-10-06','2026-10-07','2026-10-08'],
    '실패한 선행 누락일이 후행 날짜 자동 복구를 영원히 막지 않음');
  assert.deepEqual(JSON.parse(p.getProperty('portfolio_close_pending_krx_dates')),['2026-10-06'],
    '실패 날짜만 큐에 남아 다음 순환에서 재시도');
}
console.log('✅ Production writer + 복구 경로 통합·중복 삭제 차단·큐 공정성 회귀');

// Priority: a 20:30 failed current session must not wait behind the full
// historical queue, while the rotating cursor keeps old errors retryable.
{
  const bag=new Map([['portfolio_close_pending_krx_dates',
    JSON.stringify(['2026-09-28','2026-09-29','2026-10-08'])]]);
  const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  const observed=[];
  const ctx=vm.createContext({
    PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:'portfolio_close_pending_krx_dates',
    PORTFOLIO_CLOSE_BACKFILL_RETRY_CURSOR_KEY:'portfolio_close_backfill_retry_cursor_v1',
    _portfolioFundAtomic_:cb=>cb(p),
    _portfolioFundState_:(pr,k)=>JSON.parse(pr.getProperty(k)||'null'),
    _appendPortfolioCloseSyncLog:()=>{},_fundPropertyText:String,
    saveDailyPriceHistory:date=>{observed.push(date);return{ok:true,date,rows:1};}
  });
  for(const name of ['_readPendingKrxCloseDates_','_completePendingKrxCloseDate_',
    '_reconcileRecoveredPortfolioPrice_','_retryOnePendingKrxClose_'])vm.runInContext(extract(name),ctx);
  const first=ctx._retryOnePendingKrxClose_(p,'2026-10-08',true);
  assert.equal(first.date,'2026-10-08',
    '20:30 watchdog가 누락한 오늘 종가는 과거 미처리일보다 먼저 복구');
  assert.deepEqual(observed,['2026-10-08']);
  assert.deepEqual(JSON.parse(p.getProperty('portfolio_close_pending_krx_dates')),
    ['2026-09-28','2026-09-29'],'오늘 완료 후 과거 미처리 누락일 보존');
}
console.log('✅ 독립 백필의 오늘 누락 우선·과거 실패 공정성 회귀');

// Same reconciliation contract for the manual PRICE entrypoint and the
// following-night worker. No mock replacement for the production state helper.
{
  const bag=new Map([
    ['portfolio_close_pending_krx_dates',JSON.stringify(['2026-10-08'])],
    ['portfolio_close_last_result',JSON.stringify({runDate:'2026-10-08',
      runId:'manual-proof',priceOk:false,fundOk:true,priceDate:'',errors:['일반 종목: 가격 미확정']})],
    ['portfolio_close_run_date','2026-10-08'],['portfolio_close_run_id','manual-proof'],
    ['portfolio_close_stage','ERROR']
  ]);
  const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  const calls=[];
  const ctx=vm.createContext({
    today:()=> '2026-10-08',Date:{now:()=>10000},
    Utilities:{getUuid:()=> 'manual-run'},
    PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:'portfolio_close_pending_krx_dates',
    PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'portfolio_close_backfill_lease_v1',
    PORTFOLIO_FUND_LEASE_KEY:'portfolio_fund_run_lease_v1',
    _portfolioFundAtomic_:cb=>cb(p),
    _portfolioFundState_:(pr,k)=>JSON.parse(pr.getProperty(k)||'null'),
    _fundPropertyText:String,
    saveDailyPriceHistory:(date,options)=>{
      calls.push({date,options});
      assert.equal(p.getProperty('portfolio_close_pending_krx_dates'),
        JSON.stringify(['2026-10-08']),'수동 PRICE 저장이 summary 선행 큐 삭제를 하지 않음');
      return {ok:true,date:'2026-10-08',rows:11};
    }
  });
  for(const name of ['_readPendingKrxCloseDates_','_completePendingKrxCloseDate_',
    '_reconcileRecoveredPortfolioPrice_','_runManualPriceSnapshotGuarded_'])
    vm.runInContext(extract(name),ctx);
  const completed=ctx._runManualPriceSnapshotGuarded_();
  assert.equal(completed.ok,true);
  assert.equal(calls[0].options.deferQueueCompletion,true);
  assert.equal(JSON.parse(p.getProperty('portfolio_close_last_result')).priceOk,true,
    '수동 갱신으로 가격 실패 summary를 실제 정상 상태로 복구');
  assert.equal(p.getProperty('portfolio_close_stage'),'COMPLETE');
  assert.deepEqual(JSON.parse(p.getProperty('portfolio_close_pending_krx_dates')),[]);
  assert.equal(p.getProperty('portfolio_close_backfill_lease_v1'),null);
  // No authoritative close summary: the manual success must not invent NAV
  // completion or swallow the queued date needed for nightly reconciliation.
  bag.delete('portfolio_close_last_result');
  bag.set('portfolio_close_pending_krx_dates',JSON.stringify(['2026-10-08']));
  bag.delete('portfolio_close_stage');
  bag.delete('portfolio_close_run_date');
  ctx._runManualPriceSnapshotGuarded_();
  assert.deepEqual(JSON.parse(p.getProperty('portfolio_close_pending_krx_dates')),['2026-10-08'],
    '마감 summary 자체가 없으면 수동 가격 저장 뒤에도 야간 복구 큐 보존');
}
{
  const bag=new Map([
    ['portfolio_close_pending_krx_dates',JSON.stringify(['2026-10-08'])],
    ['portfolio_close_last_result',JSON.stringify({runDate:'2026-10-08',
      runId:'previous-valid-close',priceOk:false,fundOk:true,priceDate:'',errors:['일반 종목: API error']})],
    ['portfolio_close_run_date','2026-10-08'],['portfolio_close_run_id','previous-valid-close'],
    ['portfolio_close_stage','ERROR'],
    ['snapshot_last_success_date','2026-10-09']
  ]);
  const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  const ctx=vm.createContext({
    PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:'portfolio_close_pending_krx_dates',
    PORTFOLIO_CLOSE_BACKFILL_RETRY_CURSOR_KEY:'portfolio_close_backfill_retry_cursor_v1',
    _portfolioFundAtomic_:cb=>cb(p),
    _portfolioFundState_:(pr,k)=>JSON.parse(pr.getProperty(k)||'null'),
    _appendPortfolioCloseSyncLog:()=>{},_fundPropertyText:String,
    saveDailyPriceHistory:(date,opts)=>{assert.equal(date,'2026-10-08');assert.equal(opts.deferQueueCompletion,true);
      p.setProperty('snapshot_last_success_date',date);
      return {ok:true,date,rows:9};}
  });
  for(const name of ['_readPendingKrxCloseDates_','_completePendingKrxCloseDate_',
    '_reconcileRecoveredPortfolioPrice_','_retryOnePendingKrxClose_'])
    vm.runInContext(extract(name),ctx);
  assert.equal(ctx._retryOnePendingKrxClose_(p,'2026-10-09',true).ok,true);
  assert.equal(JSON.parse(p.getProperty('portfolio_close_last_result')).priceOk,true,
    '자정 후 남아 있는 직전 날짜 PRICE 실패 summary도 복구');
  assert.equal(p.getProperty('portfolio_close_stage'),'COMPLETE');
  assert.equal(p.getProperty('snapshot_last_success_date'),'2026-10-09',
    '어제 PRICE 복구가 오늘 스냅샷 최근 성공일을 덮지 않음');
}
console.log('✅ 수동 PRICE 실패 상태 정합화·summary 부재 큐 보존·자정 후 전날 결과 복구');

// Codex P2: a successful regular CLOSE NAV must remain provable even when
// its later close-summary write fails. Exercise the real lease/reconcile code.
{
  const bag=new Map([
    ['portfolio_close_last_result',JSON.stringify({runDate:'2026-10-08',
      runId:'close-R1',priceOk:true,priceDate:'2026-10-08',fundOk:false,errors:['펀드: FUND_BUSY']})],
    ['portfolio_close_run_date','2026-10-08'],['portfolio_close_run_id','close-R1'],
    ['portfolio_close_run_started_ms','1000'],['portfolio_close_stage','FUND']
  ]);
  const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  let navWrites=0;
  const ctx=vm.createContext({
    today:()=> '2026-10-08',Date:{now:()=>2000},
    Utilities:{getUuid:()=> 'lease-R1'},
    PORTFOLIO_FUND_LEASE_KEY:'portfolio_fund_run_lease_v1',
    PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'portfolio_close_backfill_lease_v1',
    PORTFOLIO_FUND_SCHEDULE_KEY:'portfolio_fund_deferred_schedule_v1',
    PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
    PORTFOLIO_FUND_CLOSE_SUCCESS_KEY:'portfolio_fund_close_success_v1',
    _portfolioFundAtomic_:cb=>cb(p),
    _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
    _fundPropertyText:String,
    runDailyFundValuations:()=>{navWrites++;return {lastDate:'2026-10-08'};}
  });
  for(const name of ['_runPortfolioFundWithLease_','_reconcilePortfolioCloseFundSuccess_'])
    vm.runInContext(extract(name),ctx);
  ctx._runPortfolioFundWithLease_('CLOSE','close-R1');
  const proof=JSON.parse(p.getProperty('portfolio_fund_close_success_v1'));
  assert.equal(proof.runId,'close-R1');
  assert.equal(navWrites,1,'정규 NAV는 실제 한 번만 수행');
  assert.equal(JSON.parse(p.getProperty('portfolio_close_last_result')).fundOk,false,
    '후속 상태 저장 전까지 기존 summary는 아직 실패로 남아 있음');
  assert.equal(ctx._reconcilePortfolioCloseFundSuccess_('2026-10-08'),true);
  assert.equal(JSON.parse(p.getProperty('portfolio_close_last_result')).fundOk,true,
    '후속 복구가 정확한 run-id의 NAV 성공 근거로 상태를 수정');
  assert.equal(p.getProperty('portfolio_close_stage'),'COMPLETE');
  bag.set('portfolio_close_last_result',JSON.stringify({runDate:'2026-10-08',
    priceOk:true,fundOk:false,errors:['펀드: FUND_BUSY']}));
  bag.set('portfolio_close_stage','ERROR');
  bag.set('portfolio_close_run_id','different-later-run');
  assert.equal(ctx._reconcilePortfolioCloseFundSuccess_('2026-10-08'),false,
    '이전 CLOSE NAV 마커로 다른 실행의 실패를 성공으로 승격시키면 안 됨');
  assert.equal(JSON.parse(p.getProperty('portfolio_close_last_result')).fundOk,false);
  let checked=0;
  ctx._reconcilePortfolioCloseFundSuccess_=()=>{checked++;return false;};
  ctx._runPendingKrxBackfillWithLease_=()=>({attempted:false,remaining:0});
  ctx.PropertiesService={getScriptProperties:()=>p};
  ctx.Logger={log:()=>{}};
  vm.runInContext(extract('runPortfolioCloseBackfill2210'),ctx);
  ctx.runPortfolioCloseBackfill2210();
  assert.equal(checked,1,'가격 큐가 0건이어도 22:10은 CLOSE NAV 마커 복구를 확인');
}

// Codex P2: 300 historical queued dates must not silently drop the latest
// watchdog failure. Capacity extension is reserved for urgent dates.
{
  const dates=Array.from({length:300},(_,i)=>
    new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10));
  const bag=new Map([['portfolio_close_pending_krx_dates',JSON.stringify(dates)]]);
  const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  const processed=[];
  const ctx=vm.createContext({
    PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:'portfolio_close_pending_krx_dates',
    PORTFOLIO_CLOSE_BACKFILL_RETRY_CURSOR_KEY:'portfolio_close_backfill_retry_cursor_v1',
    _krxCalendarStatus_:()=> 'OPEN',Logger:{log:()=>{}},
    _portfolioFundAtomic_:cb=>cb(p),_portfolioFundState_:(pr,k)=>JSON.parse(pr.getProperty(k)||'null'),
    _appendPortfolioCloseSyncLog:()=>{},_fundPropertyText:String,
    saveDailyPriceHistory:(date,opts)=>{
      processed.push(date);assert.equal(opts.deferQueueCompletion,true);
      return {ok:true,date,rows:8};
    }
  });
  for(const name of ['_readPendingKrxCloseDates_','_enqueuePendingKrxCloseDate_',
    '_completePendingKrxCloseDate_','_reconcileRecoveredPortfolioPrice_',
    '_retryOnePendingKrxClose_'])vm.runInContext(extract(name),ctx);
  assert.equal(ctx._enqueuePendingKrxCloseDate_(p,'2026-10-08',true,true),true,
    '300건 일반 큐에도 당일 watchdog 예약은 성공');
  assert.equal(JSON.parse(p.getProperty('portfolio_close_pending_krx_dates')).length,301);
  assert.equal(ctx._retryOnePendingKrxClose_(p,'2026-10-08',true).ok,true);
  assert.deepEqual(processed,['2026-10-08'],'300건 과거 대기열보다 오늘 PRICE 우선 복구');
  assert.equal(JSON.parse(p.getProperty('portfolio_close_pending_krx_dates')).length,300,
    '과거 300건은 버리지 않고 그대로 보존');
  const full=Array.from({length:600},(_,i)=>
    new Date(Date.UTC(2023,0,1+i)).toISOString().slice(0,10));
  bag.set('portfolio_close_pending_krx_dates',JSON.stringify(full));
  assert.throws(()=>ctx._enqueuePendingKrxCloseDate_(p,'2026-10-09',true,true),
    /당일 복구 예약 실패/,'한계 초과 시 기록된 척하지 않고 명시적 오류');
}
console.log('✅ 최신 Codex P2: CLOSE NAV 성공 원인 증거·300건 초과 watchdog 우선 보존');

// Self-review of an alternate completion order: the close summary may be
// entirely absent before night replay while the exact regular NAV proof exists.
{
  const bag=new Map([
    ['portfolio_fund_close_success_v1',JSON.stringify({
      date:'2026-10-08',runId:'interrupted-close',at:2000,token:'nav-ok'
    })],
    ['portfolio_close_run_id','interrupted-close'],
    ['portfolio_close_run_date','2026-10-08'],
    ['portfolio_close_run_started_ms','1000'],
    ['portfolio_close_stage','ERROR']
  ]);
  const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  let replayed=0;
  const ctx=vm.createContext({
    today:()=> '2026-10-08',
    PropertiesService:{getScriptProperties:()=>p},
    PORTFOLIO_FUND_CLOSE_SUCCESS_KEY:'portfolio_fund_close_success_v1',
    _portfolioFundAtomic_:cb=>cb(p),
    _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
    _fundPropertyText:String,Logger:{log:()=>{}},
    _runPendingKrxBackfillWithLease_:()=>{
      replayed++;
      assert.equal(p.getProperty('portfolio_close_last_result'),null,
        '야간 최초 진입 시에는 정상 마감 summary가 없을 수 있음');
      p.setProperty('portfolio_close_last_result',JSON.stringify({
        runDate:'2026-10-08',runId:'interrupted-close',priceOk:true,fundOk:false,
        priceDate:'2026-10-08',errors:['펀드: 마감 기록 없음']
      }));
      return {attempted:true,ok:true,date:'2026-10-08'};
    }
  });
  vm.runInContext(extract('_reconcilePortfolioCloseFundSuccess_'),ctx);
  vm.runInContext(extract('runPortfolioCloseBackfill2210'),ctx);
  ctx.runPortfolioCloseBackfill2210();
  assert.equal(replayed,1);
  const latest=JSON.parse(p.getProperty('portfolio_close_last_result'));
  assert.equal(latest.priceOk,true);
  assert.equal(latest.fundOk,true,
    '동일 22:10 작업에서 PRICE summary 생성 후 기존 NAV 성공 증거를 재정합');
  assert.deepEqual(latest.errors,[]);
  assert.equal(p.getProperty('portfolio_close_stage'),'COMPLETE');
}
console.log('✅ 22시10분 사후 PRICE 생성 → 동일 실행의 NAV 성공 마커 재정합');
// PR473 pre-review: real PRICE replay + regular NAV marker + persisted
// _portfolioCloseRunState_ must agree on COMPLETE after lost close summary.
{
  const startedAt='2026-10-08 20:30:00';
  const bag=new Map([
    ['portfolio_close_pending_krx_dates',JSON.stringify(['2026-10-08'])],
    ['portfolio_close_run_id','interrupted-run'],
    ['portfolio_close_run_date','2026-10-08'],
    ['portfolio_close_run_started_at',startedAt],
    ['portfolio_close_run_started_ms','1000'],
    ['portfolio_close_stage','ERROR'],
    ['portfolio_fund_close_success_v1',
      JSON.stringify({date:'2026-10-08',runId:'interrupted-run',at:2000,token:'nav-proof'})]
  ]);
  const p={getProperty:k=>bag.has(k)?bag.get(k):null,
    setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  let saveCalls=0;
  const ctx=vm.createContext({
    PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:'portfolio_close_pending_krx_dates',
    PORTFOLIO_CLOSE_BACKFILL_RETRY_CURSOR_KEY:'portfolio_close_backfill_retry_cursor_v1',
    PORTFOLIO_FUND_CLOSE_SUCCESS_KEY:'portfolio_fund_close_success_v1',
    _portfolioFundAtomic_:cb=>cb(p),
    _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
    _appendPortfolioCloseSyncLog:()=>{},_fundPropertyText:String,
    saveDailyPriceHistory:(d,opts)=>{
      saveCalls++;assert.equal(d,'2026-10-08');
      assert.equal(opts.deferQueueCompletion,true);
      return {ok:true,date:d,rows:6,krxCloseRequired:true};
    }
  });
  for (const n of ['_readPendingKrxCloseDates_','_completePendingKrxCloseDate_',
    '_reconcileRecoveredPortfolioPrice_','_retryOnePendingKrxClose_',
    '_reconcilePortfolioCloseFundSuccess_','_portfolioCloseRunState'])
    vm.runInContext(extract(n),ctx);
  const price=ctx._retryOnePendingKrxClose_(p,'2026-10-08',true);
  assert.equal(price.ok,true);
  const partiallyRecovered=JSON.parse(p.getProperty('portfolio_close_last_result'));
  assert.equal(partiallyRecovered.startedAt,startedAt,
    'PRICE 최초 summary 작성 시 영속된 실행 시작 시각 복구');
  assert.equal(partiallyRecovered.startedMs,1000,
    'PRICE 최초 summary 작성 시 정확한 실행 시작 ms 복구');
  assert.equal(ctx._portfolioCloseRunState(partiallyRecovered,p).state,'ERROR',
    'FUND 아직 미확인 시 UI가 COMPLETE로 오판하면 안 됨');
  assert.equal(ctx._reconcilePortfolioCloseFundSuccess_('2026-10-08'),true);
  const complete=JSON.parse(p.getProperty('portfolio_close_last_result'));
  assert.equal(complete.fundOk,true);
  assert.equal(p.getProperty('portfolio_close_stage'),'COMPLETE');
  assert.equal(ctx._portfolioCloseRunState(complete,p).state,'COMPLETE',
    'PRICE 재생→NAV 증거 후 운영 상태 UI 및 watchdog 모두 COMPLETE');
  assert.equal(saveCalls,1,'가격은 추가 중복 조회 없이 복구');
  assert.deepEqual(JSON.parse(p.getProperty('portfolio_close_pending_krx_dates')),[]);
}

// Alternate order and missing metadata: do not manufacture COMPLETE when
// there is no matching run identity / start time, even after PRICE recovery.
{
  const bag=new Map([['portfolio_close_pending_krx_dates',JSON.stringify(['2026-10-08'])]]);
  const p={getProperty:k=>bag.has(k)?bag.get(k):null,
    setProperty:(k,v)=>bag.set(k,String(v)),deleteProperty:k=>bag.delete(k)};
  const ctx=vm.createContext({
    PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:'portfolio_close_pending_krx_dates',
    PORTFOLIO_CLOSE_BACKFILL_RETRY_CURSOR_KEY:'portfolio_close_backfill_retry_cursor_v1',
    _portfolioFundAtomic_:cb=>cb(p),
    _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
    _appendPortfolioCloseSyncLog:()=>{},_fundPropertyText:String,
    saveDailyPriceHistory:d=>({ok:true,date:d,rows:3})
  });
  for(const n of ['_readPendingKrxCloseDates_','_completePendingKrxCloseDate_',
    '_reconcileRecoveredPortfolioPrice_','_retryOnePendingKrxClose_','_portfolioCloseRunState'])
    vm.runInContext(extract(n),ctx);
  ctx._retryOnePendingKrxClose_(p,'2026-10-08',true);
  const orphan=JSON.parse(p.getProperty('portfolio_close_last_result'));
  assert.equal(orphan.fundOk,false,'누락된 NAV 증거를 임의 성공으로 처리하지 않음');
  assert.notEqual(ctx._portfolioCloseRunState(orphan,p).state,'COMPLETE',
    '시작 기록 없는 PRICE 부분 복구를 완전 완료라고 표시하지 않음');
}
console.log('✅ 실제 PRICE 복구 후 summary 시작시각·UI 상태·NAV 증거 합류');
// PR473 cross-run safety audit: do not combine a previous same-day PRICE
// summary with an unrelated later run's normal FUND success proof.
{
  const bag=new Map([
    ['portfolio_close_run_id','later-2030'],
    ['portfolio_close_run_date','2026-10-08'],
    ['portfolio_close_run_started_at','2026-10-08 20:30:00'],
    ['portfolio_close_run_started_ms','3000'],
    ['portfolio_close_stage','ERROR'],
    ['portfolio_close_last_result',JSON.stringify({
      runDate:'2026-10-08',startedAt:'2026-10-08 19:00:00',
      startedMs:1000,priceOk:true,fundOk:false,
      errors:['펀드: FUND_BUSY']})],
    ['portfolio_fund_close_success_v1',JSON.stringify({
      date:'2026-10-08',runId:'later-2030',at:3100,token:'nav-later'})]
  ]);
  const p={getProperty:k=>bag.get(k)||null,
    setProperty:(k,v)=>bag.set(k,String(v)),deleteProperty:k=>bag.delete(k)};
  const ctx=vm.createContext({
    PORTFOLIO_FUND_CLOSE_SUCCESS_KEY:'portfolio_fund_close_success_v1',
    _portfolioFundAtomic_:cb=>cb(p),
    _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
    _fundPropertyText:String
  });
  vm.runInContext(extract('_reconcilePortfolioCloseFundSuccess_'),ctx);
  assert.equal(ctx._reconcilePortfolioCloseFundSuccess_('2026-10-08'),false,
    '오늘 날짜가 같더라도 이전 실행의 PRICE와 나중 실행의 NAV를 섞으면 안 됨');
  const last=JSON.parse(p.getProperty('portfolio_close_last_result'));
  assert.equal(last.fundOk,false);
  assert.equal(p.getProperty('portfolio_close_stage'),'ERROR');
}
// A previously persisted partial summary with missing startedAt can also be
// repaired by the matched original PRICE replay, not only by NAV reconciliation.
{
  const bag=new Map([
    ['portfolio_close_run_date','2026-10-08'],
    ['portfolio_close_run_id','today-run'],
    ['portfolio_close_run_started_at','2026-10-08 19:00:00'],
    ['portfolio_close_run_started_ms','1000'],
    ['portfolio_close_stage','ERROR'],
    ['portfolio_close_last_result',JSON.stringify({
      runDate:'2026-10-08',runId:'today-run',priceOk:false,fundOk:true,
      errors:['일반 종목: 이전 가격 실패']})]
  ]);
  const p={getProperty:k=>bag.get(k)||null,
    setProperty:(k,v)=>bag.set(k,String(v)),deleteProperty:k=>bag.delete(k)};
  const ctx=vm.createContext({
    _portfolioFundState_:(pr,k)=>JSON.parse(pr.getProperty(k)||'null'),
    _fundPropertyText:String
  });
  vm.runInContext(extract('_reconcileRecoveredPortfolioPrice_'),ctx);
  vm.runInContext(extract('_portfolioCloseRunState'),ctx);
  const confirmed=ctx._reconcileRecoveredPortfolioPrice_(p,'2026-10-08',
    {ok:true,date:'2026-10-08',rows:7},'CREATE');
  assert.equal(confirmed,true);
  const reconciled=JSON.parse(p.getProperty('portfolio_close_last_result'));
  assert.equal(reconciled.startedAt,'2026-10-08 19:00:00',
    '기존 summary라도 시각 누락 시 동일 마감 소유권에서 복원');
  assert.equal(reconciled.startedMs,1000);
  assert.equal(ctx._portfolioCloseRunState(reconciled,p).state,'COMPLETE');
}
console.log('✅ 같은 날짜 다른 run-id NAV/PRICE 결합 차단·기존 부분 summary 시작시각 복구');

// Latest Codex P2: a metadata-free legacy PRICE summary is not proof of
// ownership by a later CLOSE NAV run, even when the business date matches.
{
  const bag=new Map([
    ['portfolio_close_run_id','later-2030'],
    ['portfolio_close_run_date','2026-10-08'],
    ['portfolio_close_run_started_at','2026-10-08 20:30:00'],
    ['portfolio_close_run_started_ms','3000'],
    ['portfolio_close_stage','ERROR'],
    ['portfolio_close_last_result',JSON.stringify({runDate:'2026-10-08',
      priceOk:true,fundOk:false,errors:['펀드: FUND_BUSY']})],
    ['portfolio_fund_close_success_v1',JSON.stringify({
      date:'2026-10-08',runId:'later-2030',at:3100,token:'nav-later'})]
  ]);
  const p={getProperty:k=>bag.get(k)||null,
    setProperty:(k,v)=>bag.set(k,String(v)),deleteProperty:k=>bag.delete(k)};
  const ctx=vm.createContext({
    PORTFOLIO_FUND_CLOSE_SUCCESS_KEY:'portfolio_fund_close_success_v1',
    _portfolioFundAtomic_:cb=>cb(p),
    _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
    _fundPropertyText:String
  });
  vm.runInContext(extract('_reconcilePortfolioCloseFundSuccess_'),ctx);
  assert.equal(ctx._reconcilePortfolioCloseFundSuccess_('2026-10-08'),false,
    '기존 summary에 runId/시작시각 모두 없으면 나중 성공 NAV로 승격하면 안 됨');
  assert.equal(JSON.parse(p.getProperty('portfolio_close_last_result')).fundOk,false);
  assert.equal(p.getProperty('portfolio_close_stage'),'ERROR');
}
console.log('✅ 서로 다른 실행의 성공 근거 혼합 방지: summary 식별자 없는 경우');

// Proactive cross-path audit: the PRICE replay must not promote a legacy
// fundOk without provenance, and the UI must not mark another run COMPLETE.
{
  const bag=new Map([
    ['portfolio_close_run_date','2026-10-08'],
    ['portfolio_close_run_id','watchdog-run'],
    ['portfolio_close_run_started_at','2026-10-08 20:30:00'],
    ['portfolio_close_run_started_ms','3000'],
    ['portfolio_close_stage','ERROR'],
    ['portfolio_close_last_result',JSON.stringify({runDate:'2026-10-08',
      priceOk:false,fundOk:true,errors:['일반 종목: KRX 0건']})]
  ]);
  const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
    deleteProperty:k=>bag.delete(k)};
  const ctx=vm.createContext({
    _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
    _fundPropertyText:String
  });
  for(const n of ['_reconcileRecoveredPortfolioPrice_','_portfolioCloseRunState'])
    vm.runInContext(extract(n),ctx);
  ctx._reconcileRecoveredPortfolioPrice_(p,'2026-10-08',
    {ok:true,date:'2026-10-08',rows:3},'CREATE');
  const last=JSON.parse(p.getProperty('portfolio_close_last_result'));
  assert.equal(last.priceOk,true,'실제 복구된 PRICE 성공은 기록');
  assert.equal(last.fundOk,false,
    '실행 소유권 불명의 기존 NAV 성공을 후속 PRICE가 무단 결합해서는 안 됨');
  assert.notEqual(ctx._portfolioCloseRunState(last,p).state,'COMPLETE');
}
{
  const bag=new Map([
    ['portfolio_close_run_date','2026-10-08'],
    ['portfolio_close_run_id','new-2030'],
    ['portfolio_close_run_started_at','2026-10-08 20:30:00'],
    ['portfolio_close_run_started_ms','3000'],
    ['portfolio_close_stage','COMPLETE']
  ]);
  const p={getProperty:k=>bag.get(k)||null};
  const ctx=vm.createContext({});
  vm.runInContext(extract('_portfolioCloseRunState'),ctx);
  const mismatched={runDate:'2026-10-08',runId:'old-1900',
    startedAt:'2026-10-08 20:30:00',startedMs:3000,
    priceOk:true,fundOk:true,errors:[]};
  assert.notEqual(ctx._portfolioCloseRunState(mismatched,p).state,'COMPLETE',
    '마감 UI는 동일 시간이라도 다른 runId의 완료 summary를 현재 완료로 표시하지 않음');
}
console.log('✅ 선제 교차경로: 가격 복구와 마감 UI의 동일 실행 소유권 불변조건');

// Latest Codex P2: a deferred NAV scheduled just before midnight must execute
// using the reservation date, not cancel merely because today() changed.
{
 const m=new Map([['portfolio_fund_deferred_schedule_v1',JSON.stringify({
  date:'2026-10-09',triggerId:'today-uid',until:90000,attempts:0,
  additional:[{date:'2026-10-08',triggerId:'overnight-uid',until:90000,attempts:0,
    owner:{date:'2026-10-08',runId:'close-before-midnight',
      startedAt:'2026-10-08 23:58:00',startedMs:1200,
      errors:['일반 종목: KRX 조회 오류']}}]
 })]]);
 const p={getProperty:k=>m.get(k)||null,setProperty:(k,v)=>m.set(k,String(v)),
  deleteProperty:k=>m.delete(k)};
 let executed=0,executedDate='';
 const triggers=[{getHandlerFunction:()=> 'runDeferredFundAfterPortfolioCloseFailure',
  getUniqueId:()=> 'overnight-uid'}];
 const ctx=vm.createContext({
  today:()=> '2026-10-09',Date:{now:()=>10000},Utilities:{getUuid:()=> 'after-midnight-attempt'},
  PORTFOLIO_FUND_SCHEDULE_KEY:'portfolio_fund_deferred_schedule_v1',
  PORTFOLIO_FUND_LEASE_KEY:'portfolio_fund_run_lease_v1',
  PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'portfolio_close_backfill_lease_v1',
  PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
  _portfolioFundAtomic_:cb=>cb(p),
  _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
  ScriptApp:{getProjectTriggers:()=>triggers,deleteTrigger:()=>{}},
  _appendPortfolioCloseSyncLog:()=>{},
  _reconcilePortfolioFundBusy_:date=>{executedDate=date;},
  _runPortfolioFundWithLease_:(origin,id,date)=>{
    executed++;assert.equal(origin,'DEFERRED');assert.equal(id,'overnight-uid');
    assert.equal(date,'2026-10-08');return {lastDate:date};}
 });
 vm.runInContext(extract('runDeferredFundAfterPortfolioCloseFailure'),ctx);
 const result=ctx.runDeferredFundAfterPortfolioCloseFailure({triggerUid:'overnight-uid'});
 assert.equal(executed,1,'자정 뒤에도 만료 전 이전 날짜 NAV 한 번 실행');
 assert.equal(executedDate,'2026-10-08','NAV 결과는 생성한 10월 8일 마감에 정합화');
 const remaining=JSON.parse(p.getProperty('portfolio_fund_deferred_schedule_v1'));
 assert.equal(remaining.triggerId,'today-uid',
  '전날 UID 완료 뒤 당일 UID는 남아 있어야 함');
 assert.equal(remaining.additional,undefined,
  '완료된 전날 UID는 다른 예약과 함께 다시 저장되면 안 됨');
}

// Latest Codex P2: before a 6-minute hard kill the PRICE failure owner must
// already exist in the SAME durable reservation written under ScriptLock.
{
 const map=new Map(),p={getProperty:k=>map.get(k)||null,setProperty:(k,v)=>map.set(k,String(v))};
 const owner={date:'2026-10-08',runId:'close-before-hardkill',
  startedAt:'2026-10-08 19:00:00',startedMs:1000,
  errors:['일반 종목: KRX 응답 0건']};
 const ctx=vm.createContext({
  today:()=> '2026-10-08',Date:{now:()=>2000},
  PORTFOLIO_FUND_SCHEDULE_KEY:'portfolio_fund_deferred_schedule_v1',
  PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
  _portfolioFundAtomic_:cb=>cb(p),
  _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
  ScriptApp:{newTrigger:()=>({timeBased:()=>({everyMinutes:()=>({
   create:()=>({getUniqueId:()=> 'reserve-uid'})})})})}
 });
 vm.runInContext(extract('_scheduleFundAfterFailedPortfolioPrice_'),ctx);
 ctx._scheduleFundAfterFailedPortfolioPrice_(owner);
 const recorded=JSON.parse(p.getProperty('portfolio_fund_deferred_schedule_v1'));
 assert.equal(recorded.owner.runId,'close-before-hardkill',
  'summary 저장 전 GAS 강제 종료에도 예약 속 실행 소유권 증거 보존');
 assert.equal(recorded.owner.startedAt,owner.startedAt);
 assert.equal(recorded.owner.date,owner.date);
}
console.log('✅ PR471 리뷰 선실패: 자정 넘긴 NAV 예약·가격 실패 실행 소유권 보존');

// Real deferred completion reconciler: hard kill after reservation, before
// failed summary; do not join a marker with another run's price.
{
 const owner={date:'2026-10-08',runId:'price-failed-at-2359',
  startedAt:'2026-10-08 23:59:00',startedMs:1000,
  errors:['일반 종목: KRX 0건']};
 const m=new Map([
  ['portfolio_close_run_date',owner.date],['portfolio_close_run_id',owner.runId],
  ['portfolio_close_run_started_at',owner.startedAt],
  ['portfolio_close_run_started_ms','1000'],['portfolio_close_stage','ERROR'],
  ['portfolio_fund_deferred_success_v1',JSON.stringify({
   date:'2026-10-08',at:3500,token:'lease-after-midnight',
   triggerId:'uid-2359',owner
  })]
 ]);
 const p={getProperty:k=>m.get(k)||null,setProperty:(k,v)=>m.set(k,String(v)),
  deleteProperty:k=>m.delete(k)};
 const ctx=vm.createContext({
  PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
  _portfolioFundAtomic_:cb=>cb(p),
  _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
  _fundPropertyText:String
 });
 vm.runInContext(extract('_reconcilePortfolioFundBusy_'),ctx);
 ctx._reconcilePortfolioFundBusy_('2026-10-08');
 const restored=JSON.parse(p.getProperty('portfolio_close_last_result'));
 assert.equal(restored.runId,owner.runId,'강제종료 누락 summary는 UID/runID 근거로만 복원');
 assert.equal(restored.fundOk,true,'지연 NAV 성공은 복원하되');
 assert.equal(restored.priceOk,false,'누락된 PRICE를 성공으로 조작하지 않음');
 assert.deepEqual(restored.errors,['일반 종목: KRX 0건'],
  '원래 PRICE 실패 원인을 보존');
 m.delete('portfolio_close_last_result');
 m.set('portfolio_close_run_id','other-day-or-run');
 ctx._reconcilePortfolioFundBusy_('2026-10-08');
 assert.equal(p.getProperty('portfolio_close_last_result'),null,
  '다른 실행 소유권이면 완료 마커가 있어도 summary 재생성 금지');
 m.set('portfolio_close_run_id',owner.runId);
 m.set('portfolio_close_last_result',JSON.stringify({runDate:'2026-10-08',
  priceOk:true,fundOk:false,errors:[]}));
 ctx._reconcilePortfolioFundBusy_('2026-10-08');
 const noOwner=JSON.parse(p.getProperty('portfolio_close_last_result'));
 assert.equal(noOwner.fundOk,false,
  '실행 ID·시작시각 없는 이전 PRICE를 새 NAV 증거와 임의 결합하면 안 됨');
}
// DATE-bound production fund valuation must use the booked date, even when
// called on 2026-10-09 after midnight.
{
 const bag=new Map(),p={getProperty:k=>bag.get(k)||null,
  setProperty:(k,v)=>bag.set(k,String(v)),deleteProperty:k=>bag.delete(k)};
 const args=[];
 let nextAttempt=0;
 const ctx=vm.createContext({
  PropertiesService:{getScriptProperties:()=>p},
  _portfolioFundAtomic_:cb=>cb(p),
  _portfolioFundState_:(props,key)=>JSON.parse(props.getProperty(key)||'null'),
  Utilities:{getUuid:()=> 'attempt-'+(++nextAttempt)},
  today:()=> '2026-10-09', _normalizeDate:x=>String(x||''),
  getss:()=>({}),_fundDateOffset:()=> '2026-09-07',
  _refreshFundValuations:(ss,from,to)=>{
   args.push({from,to});return {fundResults:{},missingHoldings:[],snapshotWarnings:[]};},
  _compactFundDailyResultForProperty:(v,d)=>({runDate:d}),_fundPropertyText:String
 });
 vm.runInContext(extract('runDailyFundValuations'),ctx);
 ctx.runDailyFundValuations('2026-10-08');
 assert.equal(args[0].to,'2026-10-08','자정 이후 날짜가 당일로 잘못 이동하지 않음');
 assert.equal(JSON.parse(p.getProperty('fund_last_result')).runDate,'2026-10-08');
 // A previous-day trigger can finish after the current-day NAV. Historical
 // repair must not roll back current automation health/warning/error fields.
 ctx.runDailyFundValuations('2026-10-09');
 bag.set('fund_last_warning','current-day-warning');
 ctx.runDailyFundValuations('2026-10-08');
 assert.equal(JSON.parse(p.getProperty('fund_last_result')).runDate,'2026-10-09',
  '전날 NAV의 늦은 완료가 최신 펀드 운영 기준일을 과거로 되돌리면 안 됨');
 assert.equal(p.getProperty('fund_last_warning'),'current-day-warning',
  '과거 NAV 성공이 현재 날짜의 경고를 삭제하면 안 됨');
 ctx._refreshFundValuations=()=>{throw new Error('old-date-failure');};
 assert.throws(()=>ctx.runDailyFundValuations('2026-10-08'),/old-date-failure/);
 assert.equal(p.getProperty('fund_last_error'),null,
  '과거 NAV 실패는 최근 날짜의 운영 오류로 오표시하면 안 됨');
 // Latest-day failure has no latest success result. The attempt marker must
 // still prevent a backdated success from clearing its error or taking over.
 bag.clear();
 ctx._refreshFundValuations=()=>{throw new Error('newer-day-failed');};
 assert.throws(()=>ctx.runDailyFundValuations('2026-10-09'),/newer-day-failed/);
 assert.equal(p.getProperty('fund_last_attempt_date'),'2026-10-09',
  '성공 여부와 무관하게 최신 시도 날짜를 먼저 보존');
 assert.match(p.getProperty('fund_last_error'),/newer-day-failed/);
 ctx._refreshFundValuations=()=>({fundResults:{},missingHoldings:[],snapshotWarnings:[]});
 ctx.runDailyFundValuations('2026-10-08');
 assert.equal(p.getProperty('fund_last_result'),null,
  '전날 NAV 성공으로 더 최근 실패일의 운영 결과를 재게시하면 안 됨');
 assert.match(p.getProperty('fund_last_error'),/newer-day-failed/,
  '더 최근 시도일의 오류를 과거 NAV 성공이 제거하면 안 됨');
 // Same business date, overlapping manual or legacy invocations:
 // newer execution fails inside the older execution's data refresh.
 bag.clear();
 let overlapped=false;
 ctx._refreshFundValuations=()=>{
   if (!overlapped) {
     overlapped=true;
     const originalRefresh=ctx._refreshFundValuations;
     ctx._refreshFundValuations=()=>{throw new Error('same-date-new-owner-error');};
     assert.throws(()=>ctx.runDailyFundValuations('2026-10-09'),
       /same-date-new-owner-error/);
     ctx._refreshFundValuations=originalRefresh;
     return {fundResults:{},missingHoldings:[],snapshotWarnings:[]};
   }
   return {fundResults:{},missingHoldings:[],snapshotWarnings:[]};
 };
 ctx.runDailyFundValuations('2026-10-09');
 assert.match(p.getProperty('fund_last_error'),/same-date-new-owner-error/,
   '동일 날짜 먼저 시작한 성공이 나중 실행의 실패를 삭제하면 안 됨');
 assert.equal(p.getProperty('fund_last_result'),null,
   '같은 날짜라도 최신 소유자가 아닌 완료는 운영 결과를 게시할 수 없음');
 assert.equal(p.getProperty('fund_last_attempt_token'),'attempt-'+nextAttempt);
 // A later same-date retry can own and clear the error after succeeding.
 ctx._refreshFundValuations=()=>({fundResults:{},missingHoldings:[],snapshotWarnings:[]});
 ctx.runDailyFundValuations('2026-10-09');
 assert.equal(p.getProperty('fund_last_error'),null,
   '동일 날짜 새 실행이 실제로 성공한 경우만 오래된 오류를 해제');
 assert.equal(JSON.parse(p.getProperty('fund_last_result')).runDate,'2026-10-09');
 // Simulate a hard stop immediately after the canonical owner is committed
 // but before the mirrored legacy date/token properties can be updated.
 bag.clear();
 ctx.runDailyFundValuations('2026-10-08');
 const earlierToken=JSON.parse(p.getProperty('fund_last_attempt_owner_v1')).token;
 const originalSet=p.setProperty;
 let injected=false;
 p.setProperty=(k,v)=>{
   if (!injected && k==='fund_last_attempt_date' && String(v)==='2026-10-09') {
     injected=true;throw new Error('injected-after-atomic-owner-write');
   }
   return originalSet(k,v);
 };
 ctx._refreshFundValuations=()=>({fundResults:{},missingHoldings:[],snapshotWarnings:[]});
 assert.throws(()=>ctx.runDailyFundValuations('2026-10-09'),
   /injected-after-atomic-owner-write/);
 p.setProperty=originalSet;
 const ownerAfterPartial=JSON.parse(p.getProperty('fund_last_attempt_owner_v1'));
 assert.equal(ownerAfterPartial.date,'2026-10-09');
 assert.notEqual(ownerAfterPartial.token,earlierToken);
 assert.equal(p.getProperty('fund_last_attempt_date'),'2026-10-08',
   '보조 진단 필드가 과거 날짜에 남아도 단일 소유권 기록은 신날짜');
 bag.delete('fund_last_error');
 bag.delete('fund_last_result');
 ctx.runDailyFundValuations('2026-10-08');
 assert.equal(p.getProperty('fund_last_result'),null,
   '부분 속성 쓰기로 구 실행이 최신 날짜 상태를 덮어쓰면 안 됨');
 assert.equal(JSON.parse(p.getProperty('fund_last_attempt_owner_v1')).date,'2026-10-09');
}
console.log('✅ 소유권·자정 P2: 실제 deferred 정합화 및 지정 날짜 NAV 실행');

// The reservation and initial failed close summary become visible under one
// _portfolioFundAtomic_ lock, before the repeating trigger can run.
{
 const owner={date:'2026-10-08',runId:'close-1900',
  startedAt:'2026-10-08 19:00:00',startedMs:1000,
  errors:['일반 종목: KRX 원천 없음']};
 const m=new Map([['portfolio_close_run_date','2026-10-08'],
  ['portfolio_close_run_id','close-1900'],['portfolio_close_stage','PRICE']]);
 const p={getProperty:k=>m.get(k)||null,setProperty:(k,v)=>m.set(k,String(v))};
 const ctx=vm.createContext({
  today:()=> '2026-10-08',Date:{now:()=>1200},
  PORTFOLIO_FUND_SCHEDULE_KEY:'portfolio_fund_deferred_schedule_v1',
  PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
  _portfolioFundAtomic_:cb=>cb(p),
  _portfolioFundState_:(pr,k)=>JSON.parse(pr.getProperty(k)||'null'),
  ScriptApp:{newTrigger:()=>({timeBased:()=>({everyMinutes:()=>({
   create:()=>({getUniqueId:()=> 'reserve-for-close-1900'})
  })})})}
 });
 vm.runInContext(extract('_scheduleFundAfterFailedPortfolioPrice_'),ctx);
 ctx._scheduleFundAfterFailedPortfolioPrice_(owner);
 const summary=JSON.parse(p.getProperty('portfolio_close_last_result'));
 assert.equal(summary.runId,'close-1900');
 assert.equal(summary.fundDeferredTriggerId,'reserve-for-close-1900');
 assert.equal(summary.priceOk,false);
 assert.equal(p.getProperty('portfolio_close_stage'),'ERROR',
  '실패 summary가 최종 호출 전 동일 공유 임계구역에 기록');
 m.set('portfolio_close_run_id','newer-run');
 m.set('portfolio_close_stage','PRICE');
 m.delete('portfolio_close_last_result');
 ctx._scheduleFundAfterFailedPortfolioPrice_(owner);
 assert.equal(p.getProperty('portfolio_close_last_result'),null,
  '오래된 작업이 이후 다른 runId를 가진 상태를 덮지 못함');
}
console.log('✅ 선제 운영 충돌: NAV 예약과 PRICE 실패 summary 같은 실행 소유권');


// Codex P2: a later business day's deferred marker may not destroy yesterday's
// proof. These are production functions, not hand-written behavioral copies.
{
 const bag=new Map(),props={getProperty:k=>bag.get(k)||null,
   setProperty:(k,v)=>bag.set(k,String(v)),deleteProperty:k=>bag.delete(k)};
 let uid=0;
 const vmCtx=vm.createContext({
  Date:{now:()=>10000},today:()=> '2026-10-09',
  Utilities:{getUuid:()=> 'lease-'+(++uid)},
  _portfolioFundAtomic_:f=>f(props),
  _portfolioFundState_:(p,k)=>JSON.parse(p.getProperty(k)||'null'),
  _fundPropertyText:String,
  PORTFOLIO_FUND_LEASE_KEY:'portfolio_fund_run_lease_v1',
  PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
  PORTFOLIO_FUND_CLOSE_SUCCESS_KEY:'portfolio_fund_close_success_v1',
  PORTFOLIO_FUND_SCHEDULE_KEY:'portfolio_fund_deferred_schedule_v1',
  PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:'portfolio_close_backfill_lease_v1',
  runDailyFundValuations:date=>({lastDate:date})
 });
 vm.runInContext(guardedFundSource,vmCtx);
 const ownerA={date:'2026-10-08',runId:'A',startedAt:'2026-10-08 23:59:00',startedMs:1000,
  errors:['일반 종목: 가격 실패']};
 const ownerB={date:'2026-10-09',runId:'B',startedAt:'2026-10-09 00:01:00',startedMs:1100};
 vmCtx._runPortfolioFundWithLease_('DEFERRED','uid-A','2026-10-08',ownerA);
 vmCtx._runPortfolioFundWithLease_('DEFERRED','uid-B','2026-10-09',ownerB);
 const saved=JSON.parse(props.getProperty('portfolio_fund_deferred_success_v1'));
 assert.equal(saved.triggerId,'uid-B','최근 완료한 NAV의 UID 유지');
 assert.equal(saved.additional[0].triggerId,'uid-A',
   '다른 날짜 NAV의 성공 마커를 덮지 않고 유지');
 bag.set('portfolio_close_run_id','A');
 bag.set('portfolio_close_run_date','2026-10-08');
 bag.set('portfolio_close_run_started_ms','1000');
 bag.set('portfolio_close_run_started_at','2026-10-08 23:59:00');
 bag.set('portfolio_close_stage','ERROR');
 bag.set('portfolio_close_last_result',JSON.stringify({
  runId:'A',runDate:'2026-10-08',startedMs:1000,
  startedAt:'2026-10-08 23:59:00',priceOk:false,fundOk:false,
  fundDeferred:true,fundDeferredTriggerId:'uid-A',
  errors:['일반 종목: 가격 실패']
 }));
 vm.runInContext(extract('_reconcilePortfolioFundBusy_'),vmCtx);
 vmCtx._reconcilePortfolioFundBusy_('2026-10-08');
 const last=JSON.parse(props.getProperty('portfolio_close_last_result'));
 assert.equal(last.fundOk,true,'뒤늦은 A 정합화는 B 마커가 있어도 성공');
 assert.equal(last.priceOk,false,'실패한 PRICE를 성공으로 바꾸지 않음');
 assert.deepEqual(last.errors,['일반 종목: 가격 실패']);
 // All eight live reservation UIDs can have durable success proofs.
 // Never evict an older proof before hard-kill retry reconciliation.
 for(let i=0;i<8;i++) {
   vmCtx._runPortfolioFundWithLease_('DEFERRED','uid-long-'+i,
     '2026-10-09',{date:'2026-10-09',runId:'long-'+i,
       startedAt:'2026-10-09 19:00:00',startedMs:1200,
       errors:Array(4).fill('가'.repeat(3000))});
 }
 const proofsRaw=props.getProperty('portfolio_fund_deferred_success_v1');
 assert.ok(Buffer.byteLength(proofsRaw,'utf8')<8000,
   '8개 성공 증거의 한글 오류를 정리해 9KB GAS 속성 한도를 지킴');
 const journal=JSON.parse(proofsRaw);
 assert.equal(journal.additional.length,7,'서로 다른 성공 UID는 최대 8건 보존');
 assert.ok(journal.additional.every(x=>x.owner.errors.every(reason=>reason.length<=100)));
}

// Codex P2: a third attempt hard-killed after durable NAV success must
// reconcile before the next firing deletes its exhausted repeating UID.
{
 const key='portfolio_fund_deferred_schedule_v1';
 const bag=new Map([[key,JSON.stringify({date:'2026-10-08',triggerId:'uid-A',
   attempts:3,until:20000})],
 ['portfolio_fund_deferred_success_v1',JSON.stringify({
   date:'2026-10-09',triggerId:'uid-B',at:9000,
   additional:[{date:'2026-10-08',triggerId:'uid-A',at:9000}]
 })]]);
 const p={getProperty:k=>bag.get(k)||null,setProperty:(k,v)=>bag.set(k,String(v)),
   deleteProperty:k=>bag.delete(k)};
 let reconciles=0, navCalls=0, deletions=0, failReconcile=false;
 const vmCtx=vm.createContext({
  Date:{now:()=>10000}, today:()=> '2026-10-09',
  PORTFOLIO_FUND_SCHEDULE_KEY:key,
  PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
  _portfolioFundAtomic_:cb=>cb(p),
  _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
  ScriptApp:{getProjectTriggers:()=>[{
     getHandlerFunction:()=> 'runDeferredFundAfterPortfolioCloseFailure',
     getUniqueId:()=> 'uid-A'}],deleteTrigger:()=>{deletions++;}},
  _appendPortfolioCloseSyncLog:()=>{},
  _reconcilePortfolioFundBusy_:date=>{
    reconciles++;
    assert.equal(date,'2026-10-08');
    assert.ok(p.getProperty(key),'예약 제거 전에 성공 마커를 정합화');
    if(failReconcile)throw new Error('injected-reconcile-failure');
  },
  _runPortfolioFundWithLease_:()=>{navCalls++;throw new Error('should not rerun NAV');}
 });
 vm.runInContext(deferredSource,vmCtx);
 const res=vmCtx.runDeferredFundAfterPortfolioCloseFailure({triggerUid:'uid-A'});
 assert.equal(res.reason,'RETRY_EXHAUSTED');
 assert.equal(reconciles,1,'소진 예약도 성공 마커 재정합화를 수행');
 assert.equal(navCalls,0,'이미 성공한 NAV는 재조회하지 않음');
 assert.equal(p.getProperty(key),null,'성공 증거 확인 후 예약 삭제');
 assert.equal(deletions,1);
 bag.set(key,JSON.stringify({date:'2026-10-08',triggerId:'uid-A',attempts:3,until:20000}));
 failReconcile=true;
 assert.throws(()=>vmCtx.runDeferredFundAfterPortfolioCloseFailure({triggerUid:'uid-A'}),
   /injected-reconcile-failure/);
 assert.ok(p.getProperty(key),'정합화 실패 때는 강제 종료 이후 재시도 증거 유지');
}

// Cross-workflow review: a successful PRICE followed by FUND_BUSY must
// persist its exact run owner BEFORE the final close summary can hardkill.
{
 const bag=new Map([
  ['portfolio_close_run_date','2026-10-08'],
  ['portfolio_close_run_id','watchdog-B'],
  ['portfolio_close_run_started_ms','2500'],
  ['portfolio_close_run_started_at','2026-10-08 20:30:00'],
  ['portfolio_close_stage','FUND'],
  ['portfolio_close_last_result',JSON.stringify({
    runDate:'2026-10-08',runId:'failed-A',startedMs:1000,
    startedAt:'2026-10-08 19:00:00',priceOk:false,fundOk:false,
    errors:['일반 종목: KRX 0건']})]
 ]);
 const p={getProperty:k=>bag.get(k)||null,
  setProperty:(k,v)=>bag.set(k,String(v)),deleteProperty:k=>bag.delete(k)};
 const owner={date:'2026-10-08',runId:'watchdog-B',
   startedAt:'2026-10-08 20:30:00',startedMs:2500,
   priceOk:true,priceDate:'2026-10-08',priceRows:11,krxCloseRequired:true,
   fundBusyToken:'prior-lease',errors:['펀드: FUND_BUSY']};
 let uid='uid-watchdog-B';
 const ctx=vm.createContext({
   Date:{now:()=>3000},today:()=> '2026-10-08',
   PORTFOLIO_FUND_SCHEDULE_KEY:'portfolio_fund_deferred_schedule_v1',
   PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
   _portfolioFundAtomic_:cb=>cb(p),
   _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
   _fundPropertyText:String,
   ScriptApp:{newTrigger:()=>({timeBased:()=>({everyMinutes:()=>({
     create:()=>({getUniqueId:()=>uid})
   })})})}
 });
 vm.runInContext(scheduleSource,ctx);
 ctx._scheduleFundAfterFailedPortfolioPrice_(owner);
 const reservation=JSON.parse(p.getProperty('portfolio_fund_deferred_schedule_v1'));
 assert.equal(reservation.owner.runId,'watchdog-B');
 assert.equal(reservation.owner.priceOk,true,
   '완료된 KRX PRICE/Snapshot 근거를 예약에도 기록');
 assert.equal(reservation.owner.priceRows,11);
 assert.equal(reservation.owner.fundBusyToken,'prior-lease');
 const partial=JSON.parse(p.getProperty('portfolio_close_last_result'));
 assert.equal(partial.runId,'watchdog-B');
 assert.equal(partial.priceOk,true,'FUND_BUSY가 PRICE 성공을 실패로 되돌리면 안 됨');
 assert.equal(partial.fundOk,false);
 assert.equal(partial.fundBusyTriggerId,uid);
 assert.equal(partial.fundBusyToken,'prior-lease');
 assert.equal(p.getProperty('portfolio_close_stage'),'ERROR');
 // Simulate a crash between durable booking and summary write, restoring
 // A's previous summary and the unfinished FUND stage of B.
 bag.set('portfolio_close_stage','FUND');
 bag.set('portfolio_close_last_result',JSON.stringify({
   runDate:'2026-10-08',runId:'failed-A',startedMs:1000,
   priceOk:false,fundOk:false,errors:['일반 종목: KRX 0건']}));
 const savedOwner=reservation.owner;
 bag.set('portfolio_fund_deferred_success_v1',JSON.stringify({
   date:'2026-10-08',at:1000000,token:'nav-success',
   triggerId:uid,owner:savedOwner
 }));
 const ctx2=vm.createContext({
   PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
   _portfolioFundAtomic_:cb=>cb(p),
   _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
   _fundPropertyText:String
 });
 vm.runInContext(extract('_reconcilePortfolioFundBusy_'),ctx2);
 ctx2._reconcilePortfolioFundBusy_('2026-10-08');
 const rebuilt=JSON.parse(p.getProperty('portfolio_close_last_result'));
 assert.equal(rebuilt.runId,'watchdog-B','이전 A summary를 B의 PRICE로 합치지 않음');
 assert.equal(rebuilt.priceOk,true,'B의 원래 PRICE 성공 보존');
 assert.equal(rebuilt.priceRows,11);
 assert.equal(rebuilt.fundOk,true,'지연 NAV 성공 근거를 B만 복원');
 assert.equal(rebuilt.errors.length,0);
 assert.equal(p.getProperty('portfolio_close_stage'),'COMPLETE',
   '시간초과로 남은 FUND 단계도 7분 후 소유권 증거가 있으면 완료');
 assert.match(extract('runDailyPortfolioClose1900'),
   /var busyReservation = _scheduleFundAfterFailedPortfolioPrice_\(\{[\s\S]*?runId:runId,startedAt:startedAt,startedMs:startedMs,[\s\S]*?priceOk:true/,
   '실제 19:00/20:30 공통 경로가 반드시 현재 소유권과 PRICE 성공을 전달');
}
console.log('✅ FUND_BUSY+PRICE 성공·같은 날짜 A/B 소유권·7분 경과 FUND 강제종료 복구');

// 22:10 confirmed PRICE must construct B's latest owned summary rather than
// updating stale A, allowing exact B regular CLOSE NAV marker reconciliation.
{
 const bag=new Map([
  ['portfolio_close_run_date','2026-10-08'],
  ['portfolio_close_run_id','watchdog-B'],
  ['portfolio_close_run_started_ms','2500'],
  ['portfolio_close_run_started_at','2026-10-08 20:30:00'],
  ['portfolio_close_stage','ERROR'],
  ['portfolio_close_last_result',JSON.stringify({
    runDate:'2026-10-08',runId:'failed-A',
    startedAt:'2026-10-08 19:00:00',startedMs:1000,
    priceOk:false,fundOk:false,errors:['일반 종목: KRX 실패']})],
  ['portfolio_fund_close_success_v1',JSON.stringify({
    date:'2026-10-08',runId:'watchdog-B',at:4000,token:'B-NAV'})]
 ]);
 const p={getProperty:k=>bag.get(k)||null,
  setProperty:(k,v)=>bag.set(k,String(v)),deleteProperty:k=>bag.delete(k)};
 const ctx=vm.createContext({
  PORTFOLIO_FUND_CLOSE_SUCCESS_KEY:'portfolio_fund_close_success_v1',
  _portfolioFundAtomic_:cb=>cb(p),
  _portfolioFundState_:(props,k)=>JSON.parse(props.getProperty(k)||'null'),
  _fundPropertyText:String
 });
 for(const name of ['_reconcileRecoveredPortfolioPrice_',
   '_reconcilePortfolioCloseFundSuccess_'])
   vm.runInContext(extract(name),ctx);
 assert.equal(ctx._reconcileRecoveredPortfolioPrice_(p,'2026-10-08',
   {ok:true,date:'2026-10-08',rows:12,krxCloseRequired:true},'CREATE'),true);
 let recreated=JSON.parse(p.getProperty('portfolio_close_last_result'));
 assert.equal(recreated.runId,'watchdog-B');
 assert.equal(recreated.priceOk,true);
 assert.equal(recreated.fundOk,false,'B NAV는 marker 정합화 전까지 성공 처리 불가');
 assert.equal(recreated.priceRows,12);
 assert.equal(ctx._reconcilePortfolioCloseFundSuccess_('2026-10-08'),true);
 recreated=JSON.parse(p.getProperty('portfolio_close_last_result'));
 assert.equal(recreated.runId,'watchdog-B');
 assert.equal(recreated.priceOk,true);
 assert.equal(recreated.fundOk,true);
 assert.equal(recreated.errors.length,0);
 assert.equal(p.getProperty('portfolio_close_stage'),'COMPLETE');
}
console.log('✅ 22:10 B PRICE 재생·정규 CLOSE NAV 성공 마커 합류·이전 A 기록 분리');

console.log('✅ 다중 거래일 성공 마커·3회차 하드킬 정합화 회귀');
