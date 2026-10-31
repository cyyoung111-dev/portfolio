import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the actual production functions; never test a reimplementation.
const gas=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
function extract(name){
  const start=gas.indexOf('function '+name+'(');
  assert.ok(start>=0,'missing production function '+name);
  const end=gas.indexOf('\n}',start);
  assert.ok(end>start,'unterminated '+name);
  return gas.slice(start,end+2);
}
const DATE='2026-10-08',F1='F00001',F2='F00002',STOCK='005930';
const baseHoldings={
  [F1]:{code:F1,name:'펀드1',qty:1,costAmt:10000},
  [F2]:{code:F2,name:'펀드2',qty:1,costAmt:9000},
  [STOCK]:{code:STOCK,name:'주식',qty:2,costAmt:3000}
};
function copy(x){return JSON.parse(JSON.stringify(x));}
function scenario({nav1='2026-10-07',nav2='2026-10-06',withHistory=true}={}){
  const navDates={[F1]:nav1,[F2]:nav2};
  const navValues={[F1]:12100,[F2]:8800};
  const fundRows={};
  for(const code of [F1,F2]){
    const sourceDate=navDates[code];
    fundRows[code]=sourceDate?[{sourceDate,valueDate:sourceDate,provider:'NAV',nav:navValues[code]}]:[];
  }
  const stockRow={date:DATE,price:2100,source:'KRX',savedAt:''};
  const hist1={date:DATE,price:8888,source:'PRICE_HISTORY',savedAt:''};
  const hist2={date:DATE,price:7777,source:'PRICE_HISTORY',savedAt:''};
  const histories={
    [F1]:withHistory?[hist1]:[],
    [F2]:withHistory?[hist2]:[],
    [STOCK]:[stockRow]
  };
  const getFund=(code,date)=>{
    const row=(fundRows[code]||[]).find(x=>x.sourceDate<=date);
    return row?{evalAmt:row.nav,sourceDate:row.sourceDate,carried:row.sourceDate<date}:null;
  };
  const ctx={
    holdingsByRequestedDate:{[DATE]:copy(baseHoldings)},fundConfigs:[],
    positivePriceSeriesByCode:histories,
    priceExactByDateCode:Object.fromEntries(Object.entries(histories)
      .filter(([,rows])=>rows.length).map(([code,rows])=>[DATE+'|'+code,rows[0]])),
    manualPriceSeriesByCode:{},fundNavSeriesByCode:fundRows,
    fundNavConflictsByCode:{},currencyByCode:{},fxSeriesByCurrency:{},
    metrics:{fxLookupCount:0,fundNavLookupCount:0}
  };
  const sandbox={
    Date,Math,Number,String,Object,Array,JSON,isFinite,parseFloat,
    _cleanCode:x=>String(x||'').trim(),
    _isFundCode:code=>/^F\d{5}$/.test(code),
    _dedupeSnapshotRows:rows=>rows,
    _applyFundUnitLifecycleToSnapshotHoldings:()=>{},
    _fundUnitsAtDate:()=>({units:1000,provider:'NAV'}),
    _calcCodeHoldingsAtDate:()=>copy(baseHoldings),
    _readFundUnits:()=>[],
    _getFundEvaluationAtDate:(_,code,date)=>getFund(code,date),
    _getHistoricalExchangeRates:()=>({}),
    getPriceHistoryRow:()=>{
      const out={};for(const [code,rows] of Object.entries(histories))
        if(rows.length)out[code]=rows[0].price;
      return out;
    },
    _getPriceSourceByDate:()=>{
      const out={};for(const [code,rows] of Object.entries(histories))
        if(rows.length)out[code]={src:rows[0].source,savedAt:rows[0].savedAt};
      return out;
    },
    getLatestPriceHistoryEntries:()=>({}),
    getEarliestPriceHistory:()=>({}),
    getCodeItems:()=>Object.values(baseHoldings).map(x=>({name:x.name,code:x.code,currency:'KRW'})),
    CONFIG:{SHEET_TRADES:'거래원장'},
    Logger:{log:()=>{}}
  };
  const tradeSheet={
    getLastRow:()=>2,getLastColumn:()=>11,
    getRange:()=>({getValues:()=>[[DATE,'buy','','주식',STOCK,1,1000]]})
  };
  const ss={getSheetByName:name=>name==='거래원장'?tradeSheet:null};
  const vmCtx=vm.createContext(sandbox);
  for(const fn of ['_indexedLatest','_indexedFundEvaluation',
    '_buildIndexedSnapshotRows','_buildSnapshotRowsFromTradeAndPriceHistory'])
    vm.runInContext(extract(fn),vmCtx);
  const indexed=copy(vmCtx._buildIndexedSnapshotRows(ctx,DATE));
  const single=copy(vmCtx._buildSnapshotRowsFromTradeAndPriceHistory(ss,DATE,true));
  assert.deepEqual(indexed,single,
    'range and single-date Snapshot must match all 12 columns');
  return {indexed,single,metrics:ctx.metrics};
}
const carried=scenario();
assert.equal(carried.indexed.length,3);
assert.equal(carried.indexed.find(r=>r[1]===F1)[10],'FUND_NAV_CARRY@2026-10-07');
assert.equal(carried.indexed.find(r=>r[1]===F2)[10],'FUND_NAV_CARRY@2026-10-06');
assert.equal(carried.indexed.find(r=>r[1]===F1)[7],12100,
  'fund NAV overrides stale positive price history');
assert.equal(carried.indexed.find(r=>r[1]===F2)[7],8800);
assert.equal(carried.indexed.find(r=>r[1]===STOCK)[10],'KRX');
assert.equal(carried.metrics.fundNavLookupCount,2);
const exact=scenario({nav1:DATE,nav2:DATE,withHistory:false});
assert.deepEqual(exact.indexed.filter(r=>/^F/.test(r[1])).map(r=>r[10]),['FUND_NAV','FUND_NAV']);
const fallback=scenario({nav1:null,nav2:null});
assert.deepEqual(fallback.indexed.filter(r=>/^F/.test(r[1])).map(r=>r[10]),
  ['PRICE_HISTORY','PRICE_HISTORY']);
assert.equal(fallback.indexed.find(r=>r[1]===F1)[7],8888);
console.log('KRX indexed fund NAV parity: actual single/range production functions, carried source date, NAV precedence, exact, fallback, numeric/savedAt invariants PASS');
