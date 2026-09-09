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
assert.equal(daily[0].evalAmt,1000);
assert.equal(daily[2].sourceDate,'2026-01-02');
assert.equal(daily[3].evalAmt,2201);
assert.equal(daily[0].units,1000);
assert.throws(()=>context._fundDate('2026-02-30'));
assert.equal(context._fundDailyValues(configs,'F00001',[],'2026-01-01','2026-01-02').length,0);

// NAV → 가격이력 → 전체 스냅샷 연결 및 재시도/수동값 보호.
const fundConfig = new Sheet([['code','name','provider','start','units','at'],['F00001','테스트 펀드','HANWHA_2045_CRPE','2026-01-01',1000,'']]);
const prices = new Sheet([['date','code','name','price','at','source'],['2026-01-02','F00001','테스트 펀드',999,'2026-01-02 12:00:00','MANUAL']]);
const trades = new Sheet([Array(8).fill('header'),['2026-01-01','buy','계좌','테스트 펀드','F00001',1,800,'펀드'],['2026-01-01','buy','계좌','주식','000001',2,100,'주식']]);
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
assert.equal(context._refreshFundValuations(ssFor(sheets),'2026-01-01','2026-01-02').saved,0);
assert.equal(prices.rows.length,count);
context._buildSnapshotRowsFromTradeAndPriceHistory=()=>[];
delete sheets['스냅샷'];
const incomplete=context._refreshFundValuations(ssFor(sheets),'2026-01-01','2026-01-02');
assert(incomplete.missingHoldings.length>0);
assert.equal(sheets['스냅샷'],undefined);
context._buildSnapshotRowsFromTradeAndPriceHistory=realBuild;

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
