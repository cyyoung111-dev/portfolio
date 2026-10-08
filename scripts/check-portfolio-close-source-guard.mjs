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
const freshnessCall = closeSection.indexOf('_assessDailyKrxStockClose(items, krxPrev, requestedPrevDay)');
const firstPriceWrite = closeSection.indexOf('batchUpsertPriceHistory(ss, actualDate');
assert.ok(freshnessCall >= 0 && firstPriceWrite > freshnessCall,
  'KRX 거래일/coverage 검증은 가격이력 쓰기보다 먼저 해야 함');
assert.match(closeSection, /snapshotDate = closeVerification\.required\s*\? closeVerification\.date/,
  '펀드 NAV 가격행의 최근 날짜로 일반 종가 마감 성공 처리 금지');
assert.doesNotMatch(closeSection, /fetchedRowCount === 0 && !_getLatestPriceHistoryDate/,
  '기존 가격이력 존재를 신규 종가 조회 성공으로 오판하지 않아야 함');

// 거래원장 기준 실보유 코드만 종가 조회·검증. 마스터의 과거 매도 종목은 제외.
// helper와 snapshot 원장의 동일 보유수량 계산 로직을 실제로 재사용해 검증합니다.
assert.match(closeSection, /var items = _getDailyHeldCodeItems\(ss, requestedPrevDay, allItems\)/,
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
vm.runInContext([
  source.slice(holidayStart,holidayEnd+3),
  extract('_countBusinessWeekdaysBetween'),extract('_assessDailyKrxStockClose'),
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


const closeRunSource=extract('runDailyPortfolioClose1900');
assert.ok(closeRunSource.indexOf("_recordPortfolioCloseStage(props, runDate, startedAt, 'PRICE', runId, null, startedMs)")
  < closeRunSource.indexOf('saveDailyPriceHistory()'), '일반 종목 단계 실행 전에 시작 마커');
assert.ok(closeRunSource.indexOf("_recordPortfolioCloseStage(props, runDate, startedAt, 'FUND', runId, null, startedMs)")
  < closeRunSource.indexOf('runDailyFundValuations()'), '펀드 단계 실행 전에 단계 기록');
assert.match(closeRunSource, /_recordPortfolioCloseStage\(props, runDate, startedAt, errors\.length \? 'ERROR' : 'COMPLETE', runId, summary, startedMs\)/);
assert.match(closeRunSource, /if \(!_recordPortfolioCloseStage\(props, runDate, startedAt, 'PRICE', runId, null, startedMs\)\)/,
  '상태 소유권 확보 실패 시 중복 마감 실행 자체를 차단');
const runProps=new Map();
const statusVm=vm.createContext({
  CONFIG:{TIMEZONE:'Asia/Seoul'},
  Utilities:{formatDate:()=> '2026-10-07 19:15:00'},
  LockService:{getScriptLock:()=>({hasLock:()=>false,waitLock(){},releaseLock(){}})},
  _fundPropertyText:String,
});
vm.runInContext([extract('_recordPortfolioCloseStage'),extract('_portfolioCloseRunState')].join('\n'),statusVm);
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
