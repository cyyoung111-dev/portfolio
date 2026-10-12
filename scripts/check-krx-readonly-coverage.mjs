import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('src/gas/apps_script.gs','utf8');
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
  getss:()=>({getSheetByName:n=>sheet(n)}),
  getCodeItems:()=>[{code:'005930',type:'주식'},{code:'458730',type:'ETF'}],
  _getDailyHeldCodeItems:()=>[{code:'005930',type:'주식'},{code:'458730',type:'ETF'}],
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
for(const name of ['_krxReadOnlyStoredCoverage_','_krxReadOnlyResponseMeta_','handleGetKrxSourceDiagnostics'])
  vm.runInContext(extract(name),context,{filename:name+'.gs'});
const coverage=JSON.parse(JSON.stringify(context._krxReadOnlyStoredCoverage_('2026-10-08')));
assert.deepEqual(coverage,{
  status:'OK',expectedHeldCodes:2,expectedStock:1,expectedEtf:1,
  priceHistoryRows:3,officialExactDateCodes:1,nonOfficialHeldCodes:1,
  missingOfficialCodes:1,snapshotRows:1,snapshotHeldCodes:1,
  missingSnapshotCodes:1,queuedForBackfill:true
});
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
