import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
const extract = name => {
  const start = source.indexOf('function '+name+'(');
  assert.ok(start >= 0, name+' missing');
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, name+' end missing');
  return source.slice(start,end+2);
};
const readRows={
  가격이력:[
    ['2026-10-07','005930','삼성전자','100','','KRX'],
    ['2026-10-08','F00001','펀드','2','','FUND_NAV'],
    ['2026-10-08','005930','삼성전자','102','','KRX'],
    ['2026-10-08','458730','ETF','33','','YAHOO']
  ],
  스냅샷:[['2026-10-08','005930']]
};
const reads=[],writes=[];
const sheet=name=>({
  getLastRow(){return 1+(readRows[name]||[]).length;},
  getRange(row,col,n,colCount){
    reads.push({name,row,col,n,colCount});
    return { getDisplayValues(){return (readRows[name]||[]).slice(row-2,row-2+n)
      .map(r=>r.slice(col-1,col-1+colCount));},
      getValues(){throw Error('forbidden date-object read');},
      setValues(){writes.push('setValues');throw Error('READ_ONLY_VIOLATION');}
    };
  },
  appendRow(){writes.push('appendRow');throw Error('READ_ONLY_VIOLATION');},
  clearContents(){writes.push('clear');throw Error('READ_ONLY_VIOLATION');}
});
const props={getProperty:key=>key==='portfolio_close_pending_krx_dates'
  ?'["2026-10-08"]':'',setProperty(){writes.push('property');throw Error('READ_ONLY_VIOLATION');}};
let requestCount=0;
const responses = (statuses, date='20261008') => statuses.map((status,index)=>({
  getResponseCode:()=>status,
  getContentText:()=> status===200
    ? JSON.stringify({OutBlock_1:[{BAS_DD:date,TDD_CLSPRC:String(100+index)}]})
    : 'SECRET_MUST_NOT_LOG'
}));
const context=vm.createContext({
  CONFIG:{SHEET_PH:'가격이력',SHEET_SNAPSHOT:'스냅샷'},
  _normalizeDate:x=>String(x||''),_cleanCode:x=>String(x||'').trim(),
  _isFundCode:x=>/^F\d{5}$/.test(String(x||'')),
  getss:()=>({getSheetByName:n=>sheet(n)}),
  getCodeItems:()=>[{code:'005930',type:'주식',currency:'KRW',market:'KR'},
    {code:'458730',type:'ETF',currency:'KRW',market:'ETF'},
    {code:'AAPL',type:'주식',currency:'USD',market:'US'},
    {code:'7203',type:'주식',currency:'JPY',market:'JP'},
    {code:'USKRW',type:'주식',currency:'KRW',market:'US'}],
  _getDailyHeldCodeItems:()=>[{code:'005930',type:'주식',currency:'KRW',market:'KR'},
    {code:'458730',type:'ETF',currency:'KRW',market:'ETF'},
    {code:'AAPL',type:'주식',currency:'USD',market:'US'},
    {code:'7203',type:'주식',currency:'JPY',market:'JP'},
    {code:'USKRW',type:'주식',currency:'KRW',market:'US'}],
  _readPendingKrxCloseDates_:p=>JSON.parse(p.getProperty('portfolio_close_pending_krx_dates')||'[]'),
  PropertiesService:{getScriptProperties:()=>props},
  _getKrxAuthKeySlots_:()=>({key:'SECRET_PRIMARY',source:'krx_auth_key',
    alternative:'SECRET_ALTERNATE',alternativeConfigured:true}),
  _getKrxEndpointByMarket:market=>'https://api.test/'+market,
  UrlFetchApp:{fetchAll:requests=>{
    requestCount++;
    assert.equal(requests.every(r=>r.url.endsWith('basDd=20261008')),true,
      'diagnostic must never substitute an earlier session');
    if(requestCount===1) {
      assert.equal(requests.length,3);
      assert.equal(requests.every(r=>r.headers.AUTH_KEY==='SECRET_PRIMARY'),true);
      return responses([401,403,200]);
    }
    assert.equal(requests.length,2,'alternate must retry exactly denied markets');
    assert.equal(requests.every(r=>r.headers.AUTH_KEY==='SECRET_ALTERNATE'),true);
    return responses([200,403]);
  }},
  jsonOk:x=>x,jsonError:x=>({status:'error',message:x})
});
for(const name of ['_isKrxDailyCloseTarget_','_krxReadOnlyStoredCoverage_','_krxReadOnlyResponseMeta_','handleGetKrxSourceDiagnostics'])
  vm.runInContext(extract(name),context,{filename:name+'.gs'});
// Market has higher priority than legacy KRW default: UK/LSE/EU must never be a KRX target.
for (const market of ['US','USA','NYSE','NASDAQ','AMEX','OTC','JP','TSE','TYO',
  'HK','HKG','HKEX','UK','LSE','EU']) {
  assert.equal(context._isKrxDailyCloseTarget_({code:'TEST',market,currency:'KRW'}),false,
    market+' explicit foreign exchange must not be a KRX close');
}
for (const market of ['','KR','KOSPI','KOSDAQ','ETF']) {
  assert.equal(context._isKrxDailyCloseTarget_({code:'005930',market,currency:'KRW'}),true,
    market+' domestic market must count as KRX');
}
assert.equal(context._isKrxDailyCloseTarget_({code:'AAPL',market:'US',currency:''}),false);
assert.equal(context._isKrxDailyCloseTarget_({code:'005930',market:'KR',currency:'USD'}),false);
assert.equal(context._isKrxDailyCloseTarget_({code:'F00001',market:'KR',currency:'KRW'}),false);
const coverage=JSON.parse(JSON.stringify(context._krxReadOnlyStoredCoverage_('2026-10-08')));
assert.deepEqual(coverage,{
  status:'OK',expectedHeldCodes:2,expectedStock:1,expectedEtf:1,
  priceHistoryRows:3,officialExactDateCodes:1,nonOfficialHeldCodes:1,
  missingOfficialCodes:1,snapshotRows:1,snapshotHeldCodes:1,
  missingSnapshotCodes:1,queuedForBackfill:true
});
// Codex P2: 해외 보유·비국내 market/통화는 KRX 공식 마감 보유수에서 제외.
readRows.가격이력.push(['2026-10-08','AAPL','Apple','130','','KRX']);
readRows.스냅샷.push(['2026-10-08','AAPL']);
const withForeignRows=JSON.parse(JSON.stringify(context._krxReadOnlyStoredCoverage_('2026-10-08')));
assert.equal(withForeignRows.expectedHeldCodes,2,'USD/US, JPY/JP, KRW/US false-positive 금지');
assert.equal(withForeignRows.officialExactDateCodes,1,'해외 행의 KRX 원천 표시가 한국 공식 종가를 오염시키면 안 됨');
assert.equal(withForeignRows.snapshotHeldCodes,1);
assert.equal(withForeignRows.priceHistoryRows,4,'전체 날짜 기록 건수는 읽기 진단에서 보존');
assert.equal(withForeignRows.snapshotRows,2,'전체 날짜 스냅샷 행 수는 보존');
readRows.가격이력.pop();
readRows.스냅샷.pop();

// Codex P2: 0·공란·NaN·음수·Infinity는 유효한 공식 종가가 아닙니다.
const cleanPrice=readRows.가격이력[2][3];
for(const badPrice of ['',0,'0','-100','NaN','Infinity','1,wrong']) {
  readRows.가격이력[2][3]=badPrice;
  const bad=JSON.parse(JSON.stringify(context._krxReadOnlyStoredCoverage_('2026-10-08')));
  assert.equal(bad.officialExactDateCodes,0,'invalid official price must not count: '+badPrice);
  assert.equal(bad.missingOfficialCodes,2);
}
readRows.가격이력[2][3]='1,234';
const commaPrice=JSON.parse(JSON.stringify(context._krxReadOnlyStoredCoverage_('2026-10-08')));
assert.equal(commaPrice.officialExactDateCodes,1,'valid positive display price with commas counts');
readRows.가격이력[2][3]=cleanPrice;
const originalCatalog=context.getCodeItems;
context.getCodeItems=()=>[];
assert.equal(context._krxReadOnlyStoredCoverage_('2026-10-08').status,'MASTER_EMPTY',
  'empty master must not report a false zero-holding success');
context.getCodeItems=originalCatalog;
const actual=JSON.parse(JSON.stringify(context.handleGetKrxSourceDiagnostics('2026-10-08')));
assert.deepEqual(actual.markets.map(x=>x.httpStatus),[401,403,200]);
assert.deepEqual(actual.alternateProbes.map(x=>x.market),['KOSPI','KOSDAQ']);
assert.deepEqual(actual.alternateProbes.map(x=>x.httpStatus),[200,403]);
assert.deepEqual(actual.alternateProbes.map(x=>x.exactDateRows),[1,0]);
assert.deepEqual(actual.alternateProbe,actual.alternateProbes[0],'legacy consumer field retained');
assert.deepEqual(actual.storedCoverage,coverage);
assert.equal(requestCount,2);
assert.equal(writes.length,0,'KRX diagnosis must not modify sheets or properties');
assert.ok(reads.every(x=>['가격이력','스냅샷'].includes(x.name)));
assert.doesNotMatch(JSON.stringify(actual),/SECRET_PRIMARY|SECRET_ALTERNATE|SECRET_MUST_NOT_LOG/);
const before=requestCount;
const invalid=JSON.parse(JSON.stringify(context.handleGetKrxSourceDiagnostics('bad-date')));
assert.equal(invalid.status,'error');
assert.equal(requestCount,before,'invalid day must not call KRX');
const meta=context._krxReadOnlyResponseMeta_(responses([200],'20261007')[0],'20261008');
assert.equal(meta.rows,1);
assert.equal(meta.exactDateRows,0,'non-target KRX rows must never prove the close date');
assert.equal(meta.parseStatus,'ROWS');
console.log('✅ 인증키 시장별 조회·exact-date·가격/Snapshot/백필 큐 읽기전용 검증 통과');
