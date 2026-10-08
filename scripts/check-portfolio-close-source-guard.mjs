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
assert.match(scheduleSource, /return \{created:false, triggerId:String\(old\.triggerId \|\| ''\)\}/,
  '기존 예약의 UID는 최초 예약 판단 lock 안에서 반환');
assert.match(scheduleSource, /return \{created:true, triggerId:triggerId\}/,
  '신규 예약 UID도 lock 안에서 함께 반환');
assert.match(guardedFundSource, /return \{acquired:false, busyToken:String\(old\.token \|\| ''\)\}/,
  'FUND_BUSY 실제 경합 token은 실패 결정 시점에 캡처');
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
const closeRunSource=extract('runDailyPortfolioClose1900');
assert.ok(closeRunSource.indexOf("_recordPortfolioCloseStage(props, runDate, startedAt, 'PRICE', runId, null, startedMs)")
  < closeRunSource.indexOf('saveDailyPriceHistory()'), '일반 종목 단계 실행 전에 시작 마커');
assert.ok(closeRunSource.indexOf("_recordPortfolioCloseStage(props, runDate, startedAt, 'FUND', runId, null, startedMs)")
  < closeRunSource.indexOf("_runPortfolioFundWithLease_('CLOSE')"), '펀드 단계 실행 전에 단계 기록');
assert.match(closeRunSource, /_recordPortfolioCloseStage\(props, runDate, startedAt, errors\.length \? 'ERROR' : 'COMPLETE', runId, summary, startedMs\)/);
assert.match(closeRunSource, /if \(!_recordPortfolioCloseStage\(props, runDate, startedAt, 'PRICE', runId, null, startedMs\)\)/,
  '상태 소유권 확보 실패 시 중복 마감 실행 자체를 차단');
const runProps=new Map();
const statusVm=vm.createContext({
  CONFIG:{TIMEZONE:'Asia/Seoul'},
  Utilities:{formatDate:()=> '2026-10-07 19:15:00'},
  LockService:{getScriptLock:()=>({hasLock:()=>false,waitLock(){},releaseLock(){}})},
  _fundPropertyText:String,
  _portfolioFundState_:()=>null,
  PORTFOLIO_FUND_SUCCESS_KEY:'portfolio_fund_deferred_success_v1',
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
statusVm._recordPortfolioCloseStage(propertyApi,'2026-10-07','2026-10-07 19:10:00','COMPLETE','run-a',{startedAt:'2026-10-07 19:10:00',errors:[]},1000);
assert.equal(statusVm._portfolioCloseRunState({startedAt:'2026-10-07 19:10:00'},propertyApi).state,'COMPLETE');
assert.equal(statusVm._recordPortfolioCloseStage(propertyApi,'2026-10-07','2026-10-07 19:10:01','PRICE','run-b',null,2000),true,
  '이전 실행이 COMPLETE면 다음 실행 시작 허용');
assert.equal(statusVm._recordPortfolioCloseStage(propertyApi,'2026-10-07','2026-10-07 19:10:00','COMPLETE','run-a',{startedAt:'2026-10-07 19:10:00',errors:[]},1000),false,
  'A의 늦은 완료가 B의 시작 마커를 덮지 않음');
assert.equal(propertyApi.getProperty('portfolio_close_run_id'),'run-b');
statusVm._recordPortfolioCloseStage(propertyApi,'2026-10-07','2026-10-07 19:10:01','COMPLETE','run-b',{startedAt:'2026-10-07 19:10:01',errors:[]},2000);
assert.equal(statusVm._portfolioCloseRunState({startedAt:'2026-10-07 19:10:01'},propertyApi).state,'COMPLETE');

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
  PORTFOLIO_CLOSE_PENDING_KRX_DATES_KEY:'portfolio_close_pending_krx_dates',
  Logger:{log(){}},
  _krxCalendarStatus_:(d)=>d==='2026-10-09'?'CLOSED':'OPEN',
  _normalizeDate:(d)=>String(d||'').slice(0,10),
  _fundDateOffset:(d,n)=>{const z=new Date(d+'T00:00:00Z');z.setUTCDate(z.getUTCDate()+n);return z.toISOString().slice(0,10);},
  _getLatestLifecycleValidSnapshotDate:()=> '2026-10-06',
  _getDailyHeldCodeItems:(ss,date,catalog)=>catalog,
  getCodeItems:()=>[{code:'005930',currency:'KRW',market:'KOSPI'}],
  _appendPortfolioCloseSyncLog:()=>{}
});
for(const n of ['_readPendingKrxCloseDates_','_enqueuePendingKrxCloseDate_','_completePendingKrxCloseDate_','_hasKrxHoldingsForCloseDate_','_seedMissingKrxCloseDates_','_retryOnePendingKrxClose_']){
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
