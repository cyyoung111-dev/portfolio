#!/usr/bin/env node
import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
// Issue #507: execute actual GAS saveSnapshot handler against synthetic ledger.
// No network, production Sheets, historical user data or GAS deployment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
const names=[
  '_normalizeDate','_cleanCode','_applyHoldingTrade','_snapshotHoldingState',
  'calcHoldingsAtDate','_calcCodeHoldingsAtDate','_fundUnitsAtDate',
  '_applyFundUnitLifecycleToSnapshotHoldings','handleSaveSnapshot'
];
if(source.includes('function _validateClientSnapshotAgainstLedger_('))
  names.splice(names.length-1,0,'_validateClientSnapshotAgainstLedger_');
const production=names.map(name=>{
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,'missing production GAS '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'unclosed GAS function '+name);
  return source.slice(start,end+2);
}).join('\n');

const buy=(day,name,code,qty,price)=>[day,'buy','SYNTHETIC',name,code,qty,price,'주식','','',''];
const trades=[
  buy('2026-03-10','Alpha Old','000001',10,100),
  buy('2026-03-10','Beta','000002',5,200),
  buy('2026-03-11','Fund','F00001',10,100),
  buy('2026-04-10','Alpha New','000001',5,120),
  ['2026-05-01','sell','SYNTHETIC','Alpha New','000001',3,250,'주식','','','']
];
const make=(code,name,qty,costAmt,evalAmt=costAmt)=>({
  code,name,qty,costAmt,evalAmt,pnl:evalAmt-costAmt,pct:0,source:'MANUAL'
});
const standard=make('000001','Alpha New',10,1000,1350);
const complete=[standard,make('000002','Beta',5,1000),
  make('F00001','Fund',1,1000)];

function fixture({ledger=trades,units=[],ledgerReadError=false,unsafe=false}={}){
  let locked=false,planCalls=0,writes=0,readCalls=0,lockWaits=0,lockReleases=0,savedRows=null;
  const tradeSheet={
    getLastRow:()=>ledger.length+1,
    getLastColumn:()=>11,
    getRange:(row,col,n,width)=>{
      assert.equal(row,2);assert.equal(col,1);assert.equal(width,11);
      assert.equal(n,ledger.length);
      return {getValues:()=>{
        readCalls++;
        if(ledgerReadError) throw Error('SYNTHETIC_LEDGER_READ_FAILED');
        assert.equal(locked,true,'ledger must be read under writer lock');
        return ledger.map(r=>r.slice());
      }};
    }
  };
  const ss={getSheetByName:name=>name==='거래이력'?tradeSheet:null};
  const lock={
    hasLock:()=>locked,
    waitLock:()=>{lockWaits++;locked=true;},
    releaseLock:()=>{lockReleases++;locked=false;}
  };
  const ctx=vm.createContext({
    Date,Math,JSON,Array,Number,Object,String,parseFloat,isFinite,isNaN,decodeURIComponent,
    CONFIG:{TIMEZONE:'Asia/Seoul',SHEET_TRADES:'거래이력'},
    Logger:{log:()=>{}},
    Utilities:{formatDate:d=>d.toISOString().slice(0,10)},
    LockService:{getScriptLock:()=>lock},
    getss:()=>ss,
    getCodeItems:()=>[
      {code:'000001',name:'Alpha New'},{code:'000002',name:'Beta'},
      {code:'F00001',name:'Fund'}
    ],
    _readFundUnits:()=>units.map(x=>({...x})),
    _isFundCode:code=>/^F\d{5}$/.test(String(code)),
    _snapshotRewritePlan:()=>{planCalls++;assert.equal(locked,true);return {unsafe:unsafe?[{classification:'SYNTHETIC',reason:'PROTECTED'}]:[]};},
    writeSnapshotRows:(sheet,day,rows)=>{assert.equal(locked,true,'writer must share guard lock');savedRows=JSON.parse(JSON.stringify(rows));writes++;},
    jsonOk:value=>({status:'ok',...value}),
    jsonError:message=>({status:'error',message:String(message)})
  });
  vm.runInContext(production,ctx,{filename:'actual-gas-save-snapshot.js'});
  const send=(day,rows)=>ctx.handleSaveSnapshot(day,encodeURIComponent(JSON.stringify(rows)));
  return {send,stats:()=>({locked,planCalls,writes,readCalls,lockWaits,lockReleases}),savedRows:()=>savedRows};
}
function expectBlocked(label,day,rows,opts){
  const e=fixture(opts),result=e.send(day,rows),stats=e.stats();
  assert.equal(result.status,'error',label+': invalid payload must fail closed');
  assert.equal(stats.planCalls,0,label+': no rewrite plan on invalid payload');
  assert.equal(stats.writes,0,label+': do not write original Snapshot');
  assert.equal(stats.locked,false,label+': release lock after error');
  if (['not a number qty','not a date'].includes(label))
    assert.equal(stats.readCalls,0,label+': malformed payload blocks before ledger read');
  else assert.ok(stats.readCalls>=1,label+': consult source ledger');
}

expectBlocked('future position before first buy','2026-03-01',[standard]);
expectBlocked('qty drift','2026-03-11',[make('000001','Alpha New',11,1000)]);
expectBlocked('cost drift','2026-03-11',[make('000001','Alpha New',10,1001)]);
expectBlocked('different-date position','2026-03-11',[make('000001','Alpha New',15,1600)]);
expectBlocked('unknown holding','2026-03-11',[make('000999','Unknown',1,10)]);
expectBlocked('code and name alias conflict','2026-03-11',[make('000002','Alpha New',5,1000)]);
expectBlocked('partial payload omits Beta and Fund','2026-03-11',[standard]);
expectBlocked('partial payload omits active Fund','2026-03-11',[
  standard,make('000002','Beta',5,1000)]);
expectBlocked('atomic mixed payload','2026-03-11',[
  standard,make('000002','Beta',999,1000)]);
expectBlocked('not a number qty','2026-03-11',[make('000001','Alpha New','NaN',1000)]);
expectBlocked('not a date','2026-02-30',[standard]);
expectBlocked('fund after zero units','2026-04-15',[make('F00001','Fund',1,1000)],{
  units:[{code:'F00001',startDate:'2026-04-01',units:0}]
});
expectBlocked('source ledger failure','2026-03-11',[standard],{ledgerReadError:true});
expectBlocked('ledger cost revised after stale client read','2026-03-11',[standard],{
  ledger:[buy('2026-03-10','Alpha Old','000001',10,200)]
});

{
  const e=fixture(),r=e.send('2026-03-11',complete);
  assert.equal(r.status,'ok','legitimate manual evaluation is allowed when ledger qty/cost match');
  assert.equal(e.stats().writes,1);
  assert.equal(e.stats().planCalls,1);
  assert.equal(e.stats().readCalls,1);
  assert.equal(e.stats().locked,false);
  assert.equal(e.stats().lockWaits,1);
  assert.equal(e.stats().lockReleases,1);
  assert.equal(e.savedRows()?.[0]?.[7],1350,'MANUAL valuation must stay editable');
  assert.equal(e.savedRows()?.[0]?.[10],'MANUAL','MANUAL source must be preserved');
}
{
  const e=fixture({unsafe:true}),r=e.send('2026-03-11',complete);
  assert.equal(r.status,'error','existing Snapshot protection collision remains blocking');
  assert.equal(e.stats().writes,0);
  assert.equal(e.stats().planCalls,1);
  assert.equal(e.stats().locked,false,'collision must release lock');
}
{
  const e=fixture(),r=e.send('2026-03-11',complete);
  assert.equal(r.status,'ok','multiple ledger-valid rows may be saved together');
  assert.equal(e.stats().writes,1);
}
{
  const e=fixture({ledger:[trades[2]]}),r=e.send('2026-03-11',[make('F00001','Fund',1,1000)]);
  assert.equal(r.status,'ok','fund lifecycle permits synthetic active fund snapshot');
  assert.equal(e.stats().writes,1);
}
console.log('Issue #507 saveSnapshot ledger-asof guard synthetic regression: PASS');
