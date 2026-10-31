import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
function extract(name){
  const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,'production GAS function exists');
  return source.slice(start,end+2);
}
const helper=extract('_krxHeldTargetCloseEvidence_');
const fn=extract('handleGetKrxHeldCloseCoverage');
assert.doesNotMatch(fn,/\.setValues\(|\.appendRow\(|\.setProperty\(|\.deleteProperty\(|\.setValue\(/);
assert.match(source,/params.action === 'getKrxHeldCloseCoverage'/);
assert.match(source,/'getKrxHeldCloseCoverage'/);

const catalog=[
 {code:'005930',name:'삼성전자',type:'주식',market:'KOSPI'},
 {code:'069500',name:'ETF',type:'ETF',market:'ETF'}
];
const trades=[
 ['2026-10-01','buy','','삼성전자','005930',1,100,'주식'],
 ['2026-10-01','buy','','ETF','069500',1,100,'ETF']
];
const sheet={getLastRow:()=>trades.length+1,getLastColumn:()=>11,
 getRange:()=>({getValues:()=>trades})};
let data={
 '005930':{price:200,usedDate:'2026-10-12',source:'KRX'},
 '069500':{price:300,usedDate:'2026-10-12',source:'KRX'},
};
let holdings={'005930':{code:'005930',qty:1},'069500':{code:'069500',qty:1}};
let fetchCalls=0;
const ctx=vm.createContext({
  _normalizeDate:v=>String(v||'').trim(),today:()=> '2026-10-14',
  getss:()=>({getSheetByName:n=>n==='거래이력'?sheet:null}),
  getCodeItems:()=>catalog,_getDailyHeldCodeItems:()=>catalog,
  _isKrxDailyCloseTarget_:()=>true,
  CONFIG:{SHEET_TRADES:'거래이력'},
  _cleanCode:v=>String(v||'').trim(),
  _calcCodeHoldingsAtDate:()=>holdings,_isFundCode:x=>/^F\d{5}$/.test(x),
  fetchPricesKrx:(items,date)=>{fetchCalls++;return data;},
  jsonOk:v=>({status:'ok',...v}),jsonError:message=>({status:'error',message})
});
vm.runInContext(helper+'\n'+fn,ctx);
const run=d=>JSON.parse(JSON.stringify(ctx.handleGetKrxHeldCloseCoverage(d)));
let x=run('2026-10-12');assert.equal(x.status,'ok');
assert.deepEqual(x.coverage.market,{STOCK:{expected:1,confirmed:1},ETF:{expected:1,confirmed:1}});
assert.equal(x.coverage.ready,true);
assert.equal(x.coverage.officialExactDateCodes,2);
assert.equal(x.coverage.missingCodes,0);
assert.doesNotMatch(JSON.stringify(x),/005930|069500|삼성전자|source/);
assert.equal(fetchCalls,1);
data['069500'].usedDate='2026-10-11';
x=run('2026-10-12');
assert.equal(x.coverage.ready,false);
assert.equal(x.coverage.staleCodes,1);
assert.equal(x.coverage.officialExactDateCodes,1);
assert.equal(x.coverage.missingCodes,1);
data['069500'].usedDate='2026-10-12';
catalog.push({...catalog[1]});
x=run('2026-10-12');
assert.equal(x.coverage.ready,false);
assert.equal(x.coverage.duplicateMasterCodes,1);
catalog.pop();
holdings['035420']={code:'035420',qty:3};
x=run('2026-10-12');
assert.equal(x.coverage.ready,false);
assert.equal(x.coverage.orphanLedgerCodes,1);
delete holdings['035420'];
data['005930'].source='YAHOO';
x=run('2026-10-12');
assert.equal(x.coverage.ready,false);
assert.equal(x.coverage.officialExactDateCodes,1);
data['005930'].source='KRX';
assert.equal(run('2026-02-30').status,'error');
assert.equal(run('2026-10-15').status,'error');
assert.equal(run('malformed').status,'error');
console.log('KRX held-code exact-date source coverage and privacy regressions passed');
