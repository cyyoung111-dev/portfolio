import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
let held = false;
const lock = { hasLock: () => held, waitLock: () => { held = true; }, releaseLock: () => { held = false; } };
const context = vm.createContext({ console, Logger: { log() {} }, LockService: { getScriptLock: () => lock },
  SpreadsheetApp: { flush() {} }, Utilities: { formatDate: d => d.toISOString().slice(0,10), getUuid: () => 'test-id' } });
vm.runInContext(source, context);
context.today = () => '2026-09-09';

// 한화 공식 API는 요청 범위의 C-RPe만 반환하고 미확정 클래스는 외부 조회하지 않습니다.
const fundFetchCalls=[];
context.UrlFetchApp={fetch(url, options){
  fundFetchCalls.push({url,options});
  return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({list:[
    {wktdate:'2025-12-31',price:'900.25'}, {wktdate:'2026-01-02',price:'1000.25'},
    {wktdate:'2026-01-03',price:'1001.25'}
  ]})};
}};
assert.deepEqual(clone(context._fetchFundNav('HANWHA_2045_CRPE','2026-01-01','2026-01-02')),[
  {date:'2025-12-31',nav:900.25},{date:'2026-01-02',nav:1000.25}
]);
assert.equal(fundFetchCalls[0].options.method,'get');
assert.match(fundFetchCalls[0].url,/hanwhafund\.co\.kr\/api\/fund\/dailyPrice\?fundCd=008942&period=&startDate=2025-11-22&endDate=2026-01-02/);
assert.throws(()=>context._fetchFundNav('KB_VALUE_ST','2026-01-01','2026-01-02'),/AQ018.*미확인/);
assert.throws(()=>context._fetchFundNav('FIDELITY_BIG4_S','2026-01-01','2026-01-02'),/AP399.*미확인/);
assert.equal(fundFetchCalls.length,1,'미확정 클래스는 FunETF를 포함한 외부 요청을 하지 않음');
context.UrlFetchApp={fetch:()=>({getResponseCode:()=>403,getContentText:()=>'<html>forbidden</html>'})};
assert.throws(()=>context._fetchFundNav('HANWHA_2045_CRPE','2026-01-01','2026-01-02'),/HTTP 403/);
context.UrlFetchApp={fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({list:[]})})};
assert.throws(()=>context._fetchFundNav('HANWHA_2045_CRPE','2026-01-01','2026-01-02'),/조회 결과 없음/,'빈 응답은 정상 조회로 처리하지 않음');

class Sheet {
  constructor(rows = []) { this.rows = clone(rows); this.writes = 0; this.copies = 0; this.failWrite = false; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return Math.max(0, ...this.rows.map(r => r.length)); }
  getMaxRows() { return 10000; }
  copyTo() { this.copies++; this.backup = clone(this.rows); return { setName() {} }; }
  appendRow(row) { this.rows.push(clone(row)); }
  getRange(row, col, nr, nc) {
    return { getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => this.rows[row-1+i]?.[col-1+j] ?? '')),
      setValues: values => {
        if (this.failWrite) throw new Error('write failed');
        assert.equal(values.length, nr);
        this.writes++;
        values.forEach((v,i) => { assert.equal(v.length,nc); this.rows[row-1+i] ||= []; v.forEach((cell,j) => { this.rows[row-1+i][col-1+j] = cell; }); });
      }, setBackground() { return this; }, setFontColor() { return this; }, setFontWeight() { return this; } };
  }
}
const snap = (date, code, value, src='PRICE_HISTORY') => [date, code, code, 1, 50, 50, value, value, value-50, 0, src, src === 'MANUAL' ? '2026-01-02 12:00:00' : ''];
const header = Array(12).fill('header');
const ssFor = sheets => ({ getSheetByName: name => sheets[name] || null, insertSheet: name => (sheets[name] = new Sheet()) });

const storedFallback=clone(context._storedFundNavRows([
  ['2026-01-01','F00002','KB',1111,'2026-01-01',1000,1111,'','KB_VALUE_ST'],
  ['2026-01-02','F00002','KB',1112,'2026-01-02',1000,1112,'','WRONG_CLASS'],
  ['2026-01-02','F00003','피델리티',2222,'2026-01-02',1000,2222,'','FIDELITY_BIG4_S']
],'F00002','KB_VALUE_ST','2026-01-01','2026-01-02'));
assert.deepEqual(storedFallback,[{date:'2026-01-01',nav:1111}],'기존 NAV fallback도 같은 코드·클래스만 사용');
assert.deepEqual(clone(context._storedFundNavRows([
  ['2026-01-03','F00002','KB',1111,'2026-01-02',1000,1111,'','KB_VALUE_ST'],
  ['2026-01-04','F00002','KB',1111,'2026-01-02',1000,1111,'','KB_VALUE_ST']
],'F00002','KB_VALUE_ST','2026-01-01','2026-01-04')),[{date:'2026-01-02',nav:1111}],'휴일 평가행은 가격공시일 NAV 하나로 복원');

// 실제 저장 경로에서 같은 날짜·다른 날짜·수동값 보존을 검증합니다.
const a = snap('2026-01-02','000001',100,'MANUAL');
const b = snap('2026-01-02','000002',200);
const other = snap('2026-01-01','000003',300);
const sheet = new Sheet([header,a,b,other]);
const ss = ssFor({ '스냅샷': sheet });
context.writeSnapshotRows(ss,'2026-01-02',[snap('2026-01-02','000004',400)],false);
assert.equal(sheet.rows.length,5);
assert(sheet.rows.some(r => r[1]==='000001' && r[7]===100));
assert(sheet.rows.some(r => r[0]==='2026-01-01' && r[7]===300));
assert.equal(sheet.copies,1);
assert.deepEqual(sheet.backup,[header,a,b,other]);
context.writeSnapshotRows(ss,'2026-01-02',[snap('2026-01-02','000001',1)],true);
assert.equal(sheet.rows.find(r=>r[1]==='000001')[7],100);
const beforeEmpty=clone(sheet.rows);
context.writeSnapshotRows(ss,'2026-01-02',[],true);
assert.deepEqual(sheet.rows,beforeEmpty);
context.writeSnapshotRows(ss,'2026-01-02',[snap('2026-01-02','000001',120,'MANUAL')],true,['000001']);
assert.equal(sheet.rows.find(r=>r[1]==='000001')[7],120);
const beforeFailure=clone(sheet.rows);
sheet.failWrite=true;
assert.throws(()=>context.writeSnapshotRows(ss,'2026-01-02',[snap('2026-01-02','000002',250)],true),/write failed/);
assert.deepEqual(sheet.rows,beforeFailure,'쓰기 실패 전 전체 시트를 비우면 안 됩니다.');
sheet.failWrite=false;
assert.equal(held,false);
assert.throws(()=>context._readSnapshotRowsByDate({getSheetByName(){throw new Error('read failed');}},'2026-01-02'),/read failed/);
assert.equal((source.match(/function getEarliestPriceHistory\(/g)||[]).length,1);
assert.throws(()=>context.getEarliestPriceHistory({getSheetByName(){throw new Error('read failed');}},['000001'],'2026-01-02',true),/read failed/);

const configs = [
  {code:'F00001',name:'테스트 펀드',provider:'HANWHA_2045_CRPE',startDate:'2026-01-01',units:1000},
  {code:'F00001',name:'테스트 펀드',provider:'HANWHA_2045_CRPE',startDate:'2026-01-04',units:2000},
  {code:'F00001',name:'테스트 펀드',provider:'HANWHA_2045_CRPE',startDate:'2026-01-06',units:0},
];
const nav=[{date:'2025-12-31',nav:1000.25},{date:'2026-01-02',nav:1100.25},{date:'2026-01-07',nav:1200.25}];
const daily=clone(context._fundDailyValues(configs,'F00001',nav,'2025-12-30','2026-01-08'));
assert.equal(daily.length,5);
assert.deepEqual(daily.map(row=>row.date),['2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05']);
assert.equal(daily[0].evalAmt,1000);
assert.equal(daily[2].sourceDate,'2026-01-02');
assert.equal(daily[3].evalAmt,2201);
assert.equal(daily[0].units,1000);
assert.equal(daily[3].units,2000,'추가매수 좌수는 변경일부터만 적용');
assert.equal(daily.some(row=>row.date>='2026-01-06'),false,'0좌 적용일 이후에는 평가금액을 생성하지 않음');
assert.throws(()=>context._fundDate('2026-02-30'));
assert.equal(context._fundDailyValues(configs,'F00001',[],'2026-01-01','2026-01-02').length,0);
assert.deepEqual(clone(context._fundDailyValues(configs,'F00001',[
  {date:'2026-01-03',nav:999}
],'2026-01-01','2026-01-02')),[],'미래 NAV를 과거 평가일에 사용하지 않음');

// F00003은 2026-08-25 0좌 적용일부터 평가하지 않습니다.
const fidelity2026=[
  {code:'F00003',name:'피델리티 월드Big4 S',provider:'FIDELITY_BIG4_S',startDate:'2026-01-01',units:15933.037},
  {code:'F00003',name:'피델리티 월드Big4 S',provider:'FIDELITY_BIG4_S',startDate:'2026-08-25',units:0}
];
const fidelityBoundary=clone(context._fundDailyValues(fidelity2026,'F00003',[
  {date:'2026-08-24',nav:1234.56},{date:'2026-08-25',nav:1235.67}
],'2026-08-24','2026-08-26'));
assert.deepEqual(fidelityBoundary.map(row=>row.date),['2026-08-24']);
assert.equal(fidelityBoundary[0].evalAmt,Math.round(15933.037*1234.56/1000));

// 과거 보유 후 전량 매도한 F코드도 이력 계산은 가능하지만 0좌 이후에는 다시 생성하지 않습니다.
const retiredConfigs=[
  {code:'F00003',name:'과거 펀드',provider:'FIDELITY_BIG4_S',startDate:'2024-01-01',units:10000},
  {code:'F00003',name:'과거 펀드',provider:'FIDELITY_BIG4_S',startDate:'2024-01-03',units:12500},
  {code:'F00003',name:'과거 펀드',provider:'FIDELITY_BIG4_S',startDate:'2024-01-05',units:8000},
  {code:'F00003',name:'과거 펀드',provider:'FIDELITY_BIG4_S',startDate:'2024-01-07',units:0},
];
const retiredDaily=clone(context._fundDailyValues(retiredConfigs,'F00003',[
  {date:'2024-01-01',nav:1000},{date:'2024-01-04',nav:1200},{date:'2024-01-08',nav:1500}
],'2024-01-01','2024-01-09'));
assert.deepEqual(retiredDaily.map(row=>[row.date,row.units,row.evalAmt]),[
  ['2024-01-01',10000,10000],['2024-01-02',10000,10000],['2024-01-03',12500,12500],
  ['2024-01-04',12500,15000],['2024-01-05',8000,9600],['2024-01-06',8000,9600]
]);

// NAV → 가격이력 → 전체 스냅샷 연결 및 재시도/수동값 보호.
const fundConfig = new Sheet([['code','name','provider','start','units','at'],['F00001','테스트 펀드','HANWHA_2045_CRPE','2026-01-01',1000,'']]);
const prices = new Sheet([['date','code','name','price','at','source'],['2026-01-02','F00001','테스트 펀드',999,'2026-01-02 12:00:00','MANUAL']]);
const trades = new Sheet([Array(8).fill('header'),['2026-01-01','buy','계좌','테스트 펀드','F00001',1,800,'펀드'],['2026-01-01','buy','계좌','주식','000001',2,100,'주식'],['2024-01-01','buy','계좌','과거 펀드','F00003',10,900,'펀드'],['2025-08-25','sell','계좌','과거 펀드','F00003',10,1000,'펀드']]);
const snapshots = new Sheet([header,snap('2026-01-02','000001',300)]);
const sheets={'펀드좌수':fundConfig,'가격이력':prices,'거래이력':trades,'스냅샷':snapshots};
context._fetchFundNav=()=>[{date:'2026-01-01',nav:1000},{date:'2026-01-02',nav:1100}];
const realBuild=context._buildSnapshotRowsFromTradeAndPriceHistory;
context._buildSnapshotRowsFromTradeAndPriceHistory=(_ss,date)=>[snap(date,'000001',300)];
const result=context._refreshFundValuations(ssFor(sheets),'2026-01-01','2026-01-02');
assert.equal(result.saved,1);
assert.equal(prices.rows.find(r=>r[0]==='2026-01-02')[3],999);
assert.equal(snapshots.rows.filter(r=>r[0]==='2026-01-01').length,2,'펀드만으로 신규 전체자산 스냅샷을 만들면 안 됩니다.');
const count=prices.rows.length;
context._fetchFundNav=()=>{ throw new Error('이미 저장된 정확한 클래스 NAV가 충분하면 조회하면 안 됩니다.'); };
assert.equal(context._refreshFundValuations(ssFor(sheets),'2026-01-01','2026-01-02').saved,0);
assert.equal(prices.rows.length,count);
context._buildSnapshotRowsFromTradeAndPriceHistory=()=>[];
delete sheets['스냅샷'];
const incomplete=context._refreshFundValuations(ssFor(sheets),'2026-01-01','2026-01-02');
assert(incomplete.missingHoldings.length>0);
assert.equal(sheets['스냅샷'],undefined);
context._buildSnapshotRowsFromTradeAndPriceHistory=realBuild;

// 일부 누락일은 첫 누락일부터만 조회하고, 시작일이 휴일이면 lookback NAV를 이월합니다.
const partialFund = new Sheet([['code','name','provider','start','units','at'],['F00001','테스트 펀드','HANWHA_2045_CRPE','2026-01-01',1000,'']]);
const partialNav = new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],
  ['2026-01-01','F00001','테스트 펀드',900,'2025-12-31',1000,900,'','HANWHA_2045_CRPE']]);
const partialPrices = new Sheet([['date','code','name','price','at','source']]);
const partialTrades = new Sheet([Array(8).fill('header'),['2026-01-01','buy','계좌','테스트 펀드','F00001',1,800,'펀드']]);
const partialSheets = {'펀드좌수':partialFund,'펀드기준가격':partialNav,'가격이력':partialPrices,'거래이력':partialTrades};
let partialArgs;
context._fetchFundNav=(provider,from,to)=>{ partialArgs={provider,from,to}; return [{date:'2026-01-02',nav:1000}]; };
context._buildSnapshotRowsFromTradeAndPriceHistory=()=>[];
const partialResult=context._refreshFundValuations(ssFor(partialSheets),'2026-01-01','2026-01-04');
assert.deepEqual(partialArgs,{provider:'HANWHA_2045_CRPE',from:'2026-01-02',to:'2026-01-04'});
assert.equal(partialResult.navSaved,1,'공식 API가 실제 반환한 날짜만 확정 NAV로 저장');
assert.deepEqual(partialNav.rows.slice(1).map(row=>[row[0],row[4]]),[
  ['2026-01-01','2025-12-31'],['2026-01-02','2026-01-02']
]);
context._fetchFundNav=()=>[{date:'2026-01-05',nav:1100}];
assert.throws(()=>context._refreshFundValuations(ssFor({'펀드좌수':partialFund}),'2026-01-01','2026-01-02'),/이전의 기준가격.*기존 데이터는 변경하지 않았습니다/);
context._buildSnapshotRowsFromTradeAndPriceHistory=realBuild;

// 과거 전량 매도 F코드는 보유 기간의 가격이력·스냅샷만 채우고 매도/0좌 이후에는 새 행을 만들지 않습니다.
const retiredFundSheet = new Sheet([['code','name','provider','start','units','at'],
  ['F00003','과거 펀드','FIDELITY_BIG4_S','2024-01-01',10000,''],
  ['F00003','과거 펀드','FIDELITY_BIG4_S','2024-01-03',0,'']]);
const retiredPricesSheet = new Sheet([['date','code','name','price','at','source']]);
const retiredTradesSheet = new Sheet([Array(8).fill('header'),
  ['2024-01-01','buy','계좌','과거 펀드','F00003',10,900,'펀드'],
  ['2024-01-03','sell','계좌','과거 펀드','F00003',10,1000,'펀드'],
  ['2024-01-01','buy','계좌','주식','000001',2,100,'주식']]);
const retiredSnapshotsSheet = new Sheet([header]);
const retiredSheets={'펀드좌수':retiredFundSheet,'가격이력':retiredPricesSheet,'거래이력':retiredTradesSheet,'스냅샷':retiredSnapshotsSheet};
context._fetchFundNav=()=>[{date:'2024-01-01',nav:1000},{date:'2024-01-02',nav:1100},{date:'2024-01-03',nav:1200},{date:'2024-01-04',nav:1300}];
context._buildSnapshotRowsFromTradeAndPriceHistory=(_ss,date)=>[snap(date,'000001',300)];
const retiredResult=context._refreshFundValuations(ssFor(retiredSheets),'2024-01-01','2024-01-04');
assert.equal(retiredResult.saved,2);
assert.deepEqual(retiredPricesSheet.rows.slice(1).map(row=>[row[0],row[1],row[3]]),[['2024-01-01','F00003',10000],['2024-01-02','F00003',11000]]);
assert.equal(retiredSnapshotsSheet.rows.some(row=>row[0]>='2024-01-03' && row[1]==='F00003'),false);
assert.equal(Object.keys(context.calcHoldingsAtDate(retiredTradesSheet.rows.slice(1),'2024-01-04',{'과거 펀드':'F00003'})).some(name=>name==='과거 펀드'),false);
context._buildSnapshotRowsFromTradeAndPriceHistory=realBuild;
const zeroOnlySheets={'펀드좌수':new Sheet([['code','name','provider','start','units','at'],['F00003','과거 펀드','FIDELITY_BIG4_S','2024-01-01',0,'']])};
context._fetchFundNav=()=>{ throw new Error('0좌만 남은 F코드는 조회하면 안 됩니다.'); };
assert.equal(context._refreshFundValuations(ssFor(zeroOnlySheets),'2026-01-01','2026-01-02').saved,0);

// 세 펀드 import는 GAS에서 좌수·클래스·기존 NAV를 다시 검증합니다.
const importUnits = new Sheet([['code','name','provider','start','units','at'],
  ['F00001','한화 LIFEPLUS 적격 TDF 2045 C-RPe','HANWHA_2045_CRPE','2025-01-01',2000,''],
  ['F00002','KB 밸류포커스 소득공제 S-T','KB_VALUE_ST','2025-01-01',1000,''],
  ['F00003','피델리티 월드Big4 S','FIDELITY_BIG4_S','2026-01-01',15933.037,''],
  ['F00003','피델리티 월드Big4 S','FIDELITY_BIG4_S','2026-08-25',0,'']]);
const importNav = new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],
  ['2025-01-02','F00002','KB 밸류포커스 소득공제 S-T',1000,'2025-01-02',1000,1000,'','KB_VALUE_ST']]);
const importSs = ssFor({'펀드좌수':importUnits,'펀드기준가격':importNav});
const importPayload = (code,provider,classCode,rows,sourceText='',ackWarnings=false) => JSON.stringify({code,provider,classCode,rows,sourceText,ackWarnings});
assert.equal(context._inspectFundNavImport(importSs,importPayload('F00001','HANWHA_2045_CRPE','C-RPe',[
  {date:'2025-01-02',nav:1100}
])).candidates.length,1,'F00001도 공식 API 장애 시 검증 NAV import 지원');
const kbInspect=clone(context._inspectFundNavImport(importSs,importPayload('F00002','KB_VALUE_ST','AQ018',[
  {rowNumber:2,date:'2025-01-02',nav:1000},{rowNumber:3,date:'2025-01-03',nav:1001},{rowNumber:4,date:'2025-01-03',nav:1001}
],'AQ018 KR5223AQ0185')));
assert.equal(kbInspect.candidates.length,1);
assert.equal(kbInspect.identical.length,1);
assert.equal(kbInspect.duplicates.length,1);
assert.equal(context._inspectFundNavImport(importSs,importPayload('F00002','KB_VALUE_ST','AQ018',[
  {rowNumber:2,date:'2025-01-03',nav:1001},{rowNumber:3,date:'2025-01-03',nav:1002}
])).errors.length,1,'동일 서로 다른 NAV는 충돌로 저장 차단');
const fidelityInspect=clone(context._inspectFundNavImport(importSs,importPayload('F00003','FIDELITY_BIG4_S','AP399',[
  {rowNumber:2,date:'2026-08-24',nav:1234},{rowNumber:3,date:'2026-08-25',nav:1235},{rowNumber:4,date:'2026-08-26',nav:1236}
],'AP399 KR5235AP3996')));
assert.equal(fidelityInspect.candidates.length,1);
assert.equal(fidelityInspect.zeroUnits.length,2,'F00003 0좌 전환일 이후 NAV는 평가로 다시 나타나지 않음');
assert.throws(()=>context._inspectFundNavImport(importSs,importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-03',nav:1000}],'2K04')),/다른 클래스/);
assert.throws(()=>context._inspectFundNavImport(importSs,importPayload('F00003','FIDELITY_BIG4_S','AP399',[{date:'2025-01-03',nav:1000}],'AQ018')),/다른 클래스/);
for (const row of [{date:'2026-09-10',nav:1000},{date:'2025-01-03',nav:0},{date:'2025-01-03',nav:-1},{date:'bad',nav:1000}]) {
  assert.equal(context._inspectFundNavImport(importSs,importPayload('F00002','KB_VALUE_ST','AQ018',[row])).errors.length,1);
}
const conflict=clone(context._inspectFundNavImport(importSs,importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-02',nav:999}])));
assert.equal(conflict.updates.length,1);
assert.deepEqual([conflict.updates[0].existingNav,conflict.updates[0].uploadedNav],[1000,999]);
assert.equal(conflict.canSave,true);
assert.equal(conflict.warnings.some(row=>/기존 NAV/.test(row.reason)),true);
assert.equal(importNav.rows[1][3],1000,'미리보기 충돌은 기존 NAV를 변경하지 않음');
const samePrevious=clone(context._inspectFundNavImport(importSs,importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-03',nav:1000}])));
assert.equal(samePrevious.warnings.some(row=>/직전 확정 NAV와 동일/.test(row.reason)),true,'사용자 NAV의 전일 동일값은 WARNING');
const todayWarning=clone(context._inspectFundNavImport(importSs,importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2026-09-09',nav:1000}])));
assert.equal(todayWarning.warnings.some(row=>/오늘 NAV/.test(row.reason)),true,'오늘 수동 NAV는 확정 확인 WARNING');
const importWriteNav = new Sheet([['date','code','name','nav','sourceDate','units','eval','at','provider'],
  ['2025-01-02','F00002','KB 밸류포커스 소득공제 S-T',900,'2025-01-02',1000,900,'','KB_VALUE_ST'],
  ['2025-01-03','F00002','KB 밸류포커스 소득공제 S-T',900,'2025-01-02',1000,900,'','KB_VALUE_ST'],
  ['2025-01-05','F00002','KB 밸류포커스 소득공제 S-T',1100,'2025-01-05',1000,1100,'','KB_VALUE_ST']]);
const importWritePrices = new Sheet([['date','code','name','price','at','source'],
  ['2025-01-03','F00002','KB 밸류포커스 소득공제 S-T',900,'','MANUAL'],
  ['2025-01-02','000001','일반주식',777,'','MANUAL']]);
const importWriteTrades = new Sheet([Array(8).fill('header'),
  ['2025-01-01','buy','계좌','KB 밸류포커스 소득공제 S-T','F00002',1,800,'펀드']]);
const fxSnapshot = ['2025-01-02','US0001','해외자산',1,100,100,123,123,23,23,'FX_HISTORY',''];
const importWriteSnapshots = new Sheet([header,snap('2025-01-03','F00002',900,'MANUAL'),fxSnapshot]);
const importWriteSs = ssFor({'펀드좌수':importUnits,'펀드기준가격':importWriteNav,'가격이력':importWritePrices,'거래이력':importWriteTrades,'스냅샷':importWriteSnapshots});
context.getss=()=>importWriteSs;
context.jsonOk=extra=>({status:'ok',...extra}); context.jsonError=message=>({status:'error',message});
const imported=context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-03',nav:1000}]));
assert.equal(imported.status,'ok'); assert.equal(imported.importResult.saved,1); assert.deepEqual(clone(imported.evaluation.ranges),[{from:'2025-01-03',to:'2025-01-03'}]);
assert.deepEqual(importWriteNav.rows.slice(1,4).map(row=>[row[0],row[3],row[4],row[6]]),[
  ['2025-01-02',900,'2025-01-02',900],['2025-01-03',1000,'2025-01-03',1000],['2025-01-05',1100,'2025-01-05',1100]
]);
assert.equal(importWriteNav.rows.some(row=>row[0]==='2025-01-04'),false,'직전 NAV를 미공시 날짜의 확정 NAV로 복제하지 않음');
assert.equal(importWritePrices.rows.find(row=>row[0]==='2025-01-03'&&row[1]==='F00002')[3],1000,'펀드 MANUAL 평가보다 검증 NAV×좌수 우선');
assert.equal(importWritePrices.rows.find(row=>row[1]==='000001')[3],777,'관련 없는 일반주식 가격이력 보존');
assert.equal(importWriteSnapshots.rows.find(row=>row[1]==='F00002')[7],1000);
assert.deepEqual(importWriteSnapshots.rows.find(row=>row[1]==='US0001'),fxSnapshot,'해외자산 과거 FX 스냅샷 보존');
const repeated=context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-03',nav:1000}]));
assert.equal(repeated.importResult.saved,undefined);
const beforeConflict=clone(importWriteNav.rows);
assert.equal(context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-03',nav:1002}])).status,'error','WARNING 미확인은 저장 차단');
assert.deepEqual(importWriteNav.rows,beforeConflict,'WARNING 확인 전에는 기존 NAV를 변경하지 않음');
const updated=context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-03',nav:1002}],'',true));
assert.equal(updated.status,'ok'); assert.equal(updated.importResult.updated,1);
assert.equal(importWriteNav.rows.find(row=>row[0]==='2025-01-03')[3],1002,'사용자 확인 후 동일 날짜 확정 NAV 갱신');
const beforeImportFailure=clone(importWriteNav.rows); importWriteNav.failWrite=true;
assert.equal(context.handleImportFundNav(importPayload('F00002','KB_VALUE_ST','AQ018',[{date:'2025-01-04',nav:1002}],'',true)).status,'error');
assert.deepEqual(importWriteNav.rows,beforeImportFailure,'부분 쓰기 실패 시 기존 NAV 보존');
importWriteNav.failWrite=false;

// 설정 저장은 같은 적용일 수정·과거 소급 변경을 거부하고 미래 변경만 추가합니다.
context.jsonOk=extra=>({status:'ok',...extra});
context.jsonError=message=>({status:'error',message});
context.getss=()=>ssFor(sheets);
context._ensureFundDailyTrigger=()=>{};
context._readSettingsMap=()=>({EDITABLE_PRICES:[{code:'F00001',name:'테스트 펀드',fund:true}]});
const saveConfig=(startDate,units,provider='HANWHA_2045_CRPE')=>context.handleSaveFundUnits(JSON.stringify({code:'F00001',provider,startDate,units}));
assert.equal(saveConfig('2026-01-01',1000).status,'ok');
assert.equal(saveConfig('2026-01-01',2000).status,'error');
assert.equal(saveConfig('2025-12-31',2000).status,'ok','다음 설정 이전의 미작성 날짜는 별도 좌수를 등록할 수 있습니다.');
assert.equal(saveConfig('2026-01-02',2000).status,'error','이미 작성한 날짜에 다른 좌수를 소급 적용할 수 없습니다.');
assert.equal(saveConfig('2026-01-03',2000).status,'ok');
assert.equal(saveConfig('2026-01-04',0).status,'ok');
assert.equal(saveConfig('2026-01-05','').status,'error');
assert.equal(saveConfig('2026-01-05',1000,'__proto__').status,'error');
assert.equal(saveConfig('2026-01-05',1e30).status,'error');
const catalog=context._getFundCodeCatalog(ssFor(sheets),context._readFundUnits(ssFor(sheets)));
assert.equal(catalog.find(item=>item.code==='F00001').currentHolding,true,'현재 보유 F코드는 현재 보유로 분류');
assert.equal(catalog.find(item=>item.code==='F00003').currentHolding,false,'전량 매도 F코드는 과거 보유로 분류');
assert.equal(catalog.find(item=>item.code==='F00003').name,'과거 펀드');
const fundUnitsResponse=context.handleGetFundUnits();
assert.equal(fundUnitsResponse.funds.find(item=>item.code==='F00003').currentHolding,false,'조회 API도 과거 F코드를 반환');
const saveRetired=(startDate,units)=>context.handleSaveFundUnits(JSON.stringify({code:'F00003',provider:'FIDELITY_BIG4_S',startDate,units}));
assert.equal(saveRetired('2024-01-01',10000).status,'ok','거래이력에만 있는 과거 F코드도 좌수 이력을 등록');
assert.equal(saveRetired('2024-01-01',12000).status,'error','같은 적용일의 다른 좌수는 덮어쓰지 않음');
assert.equal(context._readFundUnits(ssFor(sheets)).some(c=>c.code==='F00003' && c.units===10000),true);

// 실수량을 가진 펀드도 가격이력 총액을 다시 수량으로 곱하지 않습니다.
const realSheets={'거래이력':new Sheet([Array(8).fill('header'),['2026-01-01','buy','계좌','테스트 펀드','F00001',10,100,'펀드']]),
  '가격이력':new Sheet([Array(6).fill('header'),['2026-01-02','F00001','테스트 펀드',1200,'','FUND_NAV']])};
const built=clone(realBuild(ssFor(realSheets),'2026-01-02',true));
assert.equal(built.length,1);
assert.equal(built[0][3],1);
assert.equal(built[0][5],1000);
assert.equal(built[0][7],1200);
assert.equal(realBuild(ssFor(realSheets),'2026-01-01',true).length,0,'미래 가격을 과거에 소급하지 않습니다.');
const legacy=snap('2026-01-02','',777,'MANUAL'); legacy[2]='테스트 펀드';
const canonical=snap('2026-01-02','F00001',888); canonical[2]='테스트 펀드';
const mergedLegacy=clone(context._mergeSnapshotRowsSafely([legacy],[canonical],true));
assert.equal(mergedLegacy.length,1);
assert.equal(mergedLegacy[0][7],777);

// 전체 함수 선언이 중복돼 엄격 오류 옵션을 덮어쓰는 회귀 차단.
const declarations=[...source.matchAll(/^function\s+(\w+)\s*\(/gm)].map(m=>m[1]);
assert.equal(new Set(declarations).size,declarations.length,'GAS 함수 중복 선언');
console.log('✅ 펀드 좌수·날짜·이월·중복실행·스냅샷/수동값 보존·쓰기 실패 회귀 검사 통과');
