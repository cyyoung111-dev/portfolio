#!/usr/bin/env node
// Issue #507: production ledger replay and fingerprint contract.
// Synthetic data only; no GAS calls, no credential reads and no data writes.
// This proves date-bounded reducer behavior, NOT the cause of historic writes
// and NOT the existence of an actual per-writer source fingerprint record.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const source=fs.readFileSync('src/gas/apps_script.gs','utf8');
const names=[
  '_normalizeDate','_cleanCode','_applyHoldingTrade','_snapshotHoldingState',
  'calcHoldingsAtDate','_calcCodeHoldingsAtDate',
  '_buildHoldingsByRequestedDate','_tradeLedgerContentFingerprint_'
];
const extract=(name)=>{
  const at=source.indexOf('function '+name+'(');
  assert.ok(at>=0,'production function missing: '+name);
  const end=source.indexOf('\n}',at);
  assert.ok(end>at,'production closing brace missing: '+name);
  return source.slice(at,end+2);
};
const production=Object.fromEntries(names.map(n=>[n,extract(n)]));

function context(patches={}){
  const digests=[];
  let rangeReads=0;
  let propertiesMutated=0;
  const utils={
    formatDate:(d,tz,format)=>{
      assert.equal(tz,'Asia/Seoul');
      assert.equal(format,'yyyy-MM-dd');
      // Independent KST oracle. Do not derive the date from UTC ISO.
      const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
        timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
      }).formatToParts(new Date(d)).map(x=>[x.type,x.value]));
      return [parts.year,parts.month,parts.day].join('-');
    },
    DigestAlgorithm:{SHA_256:'SHA_256'},
    computeDigest:(alg,v)=>{
      assert.equal(alg,'SHA_256');
      const h=createHash('sha256').update(v).digest();
      digests.push(h.toString('hex'));
      return Array.from(h).map(x=>x>=128?x-256:x);
    }
  };
  let rows=[];
  const sheet={
    getLastRow:()=>rows.length+1,
    getLastColumn:()=>11,
    getRange:(row,col,height,width)=>{
      assert.equal(row,2);assert.equal(col,1);
      assert.equal(height,rows.length);assert.ok(width===10||width===11);
      rangeReads++;
      return{getValues:()=>rows.map(r=>r.slice(0,width))};
    }
  };
  const spreadsheet={getSheetByName:name=>{
    assert.equal(name,'거래이력');
    return sheet;
  }};
  const sandbox=vm.createContext({
    Date,JSON,Number,String,Array,Object,Math,parseFloat,isNaN,
    CONFIG:{TIMEZONE:'Asia/Seoul',SHEET_TRADES:'거래이력'},
    Utilities:utils,Logger:{log:()=>{}},
    PropertiesService:{getScriptProperties:()=>({
      setProperty:()=>{propertiesMutated++;throw Error('WRITE_FORBIDDEN');},
      deleteProperty:()=>{propertiesMutated++;throw Error('WRITE_FORBIDDEN');}
    })},
    SpreadsheetApp:{flush:()=>{throw Error('WRITE_FORBIDDEN');}}
  });
  const src=names.map(n=>patches[n]||production[n]).join('\n');
  vm.runInContext(src,sandbox,{filename:'production-ledger-replay-contract.js'});
  return{
    env:sandbox, spreadsheet,
    setRows:next=>{rows=next.map(x=>x.slice());},
    stats:()=>({rangeReads,propertiesMutated,digestCount:digests.length}),
    version:()=>source.match(/gasVersion:\s*'(\d+\.\d+)'/)?.[1]||''
  };
}
const trade=(date,action,name,code,qty,price,ratio='',fractionalCash='')=>
  [date,action,'TEST_ACCOUNT',name,code,qty,price,'주식','',ratio,fractionalCash];
const historical=[
  trade('2025-12-31','buy','OLD','1',10,100),
  trade('2026-01-01','buy','SECOND','2',2,200),
  trade('2026-01-07','buy','NEW','000001',3,150),
  trade('2026-01-08','sell','NEW','000001',4,0)
];
const future=[
  trade('2026-02-01','buy','NEW','000001',50,999),
  trade('2026-02-02','sell','SECOND','000002',2,0)
];
const c=context(),p=c.env;
// Synthetic replay runs against candidate GAS v9.273, not a deployed live instance.
const assertPinnedGasVersion=value=>assert.equal(value,'9.273',
  'GAS version drift: review test/production before relying on policy');
assertPinnedGasVersion(c.version());
// Negative control ensures the version gate actually rejects a wrong version.
assert.throws(()=>assertPinnedGasVersion('0.000'),/GAS version drift/);
assert.equal(p._cleanCode('1'),'000001');
const dates=['2025-12-31','2026-01-01','2026-01-07','2026-01-08'];
const oracle=[
  {day:'2025-12-31',q:10,cost:1000,beta:false},
  {day:'2026-01-01',q:10,cost:1000,beta:true},
  {day:'2026-01-07',q:13,cost:1450,beta:true},
  {day:'2026-01-08',q:9,cost:1004,beta:true}
];
const namesMap={OLD:'000001',NEW:'000001',SECOND:'000002'};
const output=p._buildHoldingsByRequestedDate([...historical,...future],dates.slice().reverse(),namesMap);
for(const o of oracle){
  const expected=p._calcCodeHoldingsAtDate([...historical,...future],o.day,namesMap,{});
  const indexed=output[o.day];
  assert.equal(expected['000001']?.qty,o.q,'single-date quantity');
  assert.equal(expected['000001']?.costAmt,o.cost,'single-date moving average');
  assert.equal(indexed['000001']?.qty,o.q,'indexed quantity');
  assert.equal(indexed['000001']?.costAmt,o.cost,'indexed cost');
  assert.equal(Boolean(indexed['000002']),o.beta,'pre-acquisition holding prevented');
  assert.deepEqual(JSON.parse(JSON.stringify(indexed)),JSON.parse(JSON.stringify(
    p._buildHoldingsByRequestedDate(historical,[o.day],namesMap)[o.day])),
  'future buys and sells must not change past ledger holdings');
}
// Code identity must survive an issuer display-name change.
const renamed=p._calcCodeHoldingsAtDate(historical,'2026-01-08',namesMap,
  {'000001':'CANONICAL_NAME'});
assert.equal(Object.keys(renamed).filter(k=>k==='000001').length,1);
assert.equal(renamed['000001'].name,'CANONICAL_NAME');
// Actual Google Sheets date cells are Date objects, potentially crossing
// midnight in Asia/Seoul while the UTC ISO date remains the previous day.
const kstDateTrades=[
  trade(new Date('2025-12-31T14:30:00Z'),'buy','EDGE','4',1,10), // 12/31 23:30 KST
  trade(new Date('2025-12-31T15:30:00Z'),'buy','EDGE','4',2,20), // 01/01 00:30 KST
  trade(new Date('2026-01-01T14:59:59Z'),'buy','EDGE','4',3,30), // 01/01 23:59 KST
  trade(new Date('2026-01-01T15:00:00Z'),'buy','EDGE','4',4,40)  // 01/02 00:00 KST
];
assert.deepEqual(kstDateTrades.map(r=>p._normalizeDate(r[0])),[
  '2025-12-31','2026-01-01','2026-01-01','2026-01-02']);
const kstCases=[
  ['2025-12-31',1,10],['2026-01-01',6,140],['2026-01-02',10,300]
];
const kstIndex=p._buildHoldingsByRequestedDate(kstDateTrades,
  kstCases.map(r=>r[0]).reverse(),{});
for(const [day,qty,cost] of kstCases){
  const single=p._calcCodeHoldingsAtDate(kstDateTrades,day,{},{});
  assert.equal(single['000004']?.qty,qty,'Date-cell single-date KST quantity');
  assert.equal(single['000004']?.costAmt,cost,'Date-cell single-date KST cost');
  assert.equal(kstIndex[day]['000004']?.qty,qty,'Date-cell indexed KST quantity');
  assert.equal(kstIndex[day]['000004']?.costAmt,cost,'Date-cell indexed KST cost');
}
const kc=context();
const timestampRows=kstDateTrades.map(r=>r.slice());
const explicitKstRows=kstDateTrades.map((r,i)=>[
  ['2025-12-31','2026-01-01','2026-01-01','2026-01-02'][i],...r.slice(1)]);
kc.setRows(timestampRows);
const dateCellFingerprint=kc.env._tradeLedgerContentFingerprint_(kc.spreadsheet);
kc.setRows(explicitKstRows);
const kstStringFingerprint=kc.env._tradeLedgerContentFingerprint_(kc.spreadsheet);
assert.equal(dateCellFingerprint,kstStringFingerprint,
  'date-cell and KST-normalized text fingerprint must be identical');
// Adversarial mutation: using UTC date instead of KST must break both
// holdings and the date-cell fingerprint equivalence.
const utcNormalize=production._normalizeDate.replace(
  "Utilities.formatDate(raw, CONFIG.TIMEZONE, 'yyyy-MM-dd')",
  "raw.toISOString().slice(0,10)");
assert.notEqual(utcNormalize,production._normalizeDate);
const um=context({_normalizeDate:utcNormalize});
const wrongIndex=um.env._buildHoldingsByRequestedDate(kstDateTrades,
  ['2025-12-31','2026-01-01','2026-01-02'],{});
assert.notEqual(wrongIndex['2025-12-31']['000004'].qty,1,
  'mutation oracle: UTC conversion leaks January 1 trade into December 31');
// Single-date reducer takes its Date branch in _applyHoldingTrade rather
// than in _normalizeDate. Mutate that independent production boundary too.
const utcApply=production._applyHoldingTrade.replace(
  "Utilities.formatDate(rawDate, CONFIG.TIMEZONE, 'yyyy-MM-dd')",
  "rawDate.toISOString().slice(0,10)");
assert.notEqual(utcApply,production._applyHoldingTrade);
const us=context({_applyHoldingTrade:utcApply});
assert.notEqual(us.env._calcCodeHoldingsAtDate(kstDateTrades,
  '2025-12-31',{},{} )['000004'].qty,1,
  'mutation oracle: UTC conversion leaks into single-date calculation');
um.setRows(timestampRows);
const wrongDigest=um.env._tradeLedgerContentFingerprint_(um.spreadsheet);
assert.notEqual(wrongDigest,kstStringFingerprint,
  'mutation oracle: UTC conversion invalidates source version fingerprint');
assert.equal(kc.stats().propertiesMutated,0);
assert.equal(um.stats().propertiesMutated,0);

// Same-day transaction order is materially relevant to average cost.
const sameDay=[
  trade('2026-01-08','buy','ALPHA','3',5,10),
  trade('2026-01-08','buy','ALPHA','3',5,20),
  trade('2026-01-08','sell','ALPHA','3',5,0)
];
const orderA=p.calcHoldingsAtDate(sameDay,'2026-01-08',{});
const orderB=p.calcHoldingsAtDate([sameDay[0],sameDay[2],sameDay[1]],'2026-01-08',{});
assert.equal(orderA['000003'].costAmt,75);
assert.equal(orderB['000003'].costAmt,100);
const batch=p._buildHoldingsByRequestedDate(sameDay,['2026-01-08'],{});
assert.equal(batch['2026-01-08']['000003'].costAmt,75);
// Year-boundary behavior: 2025-12-31 ledger holdings carry; a 2026-01-01
// ledger trade is effective immediately on 2026-01-01, not on 12/31.
assert.equal(output['2025-12-31']['000002'],undefined);
assert.equal(output['2026-01-01']['000002'].costAmt,400);
// Fingerprint: full row contents, physical order, and revisions are distinct.
// A fingerprint is not an audit event; a historical writer must capture it.
c.setRows(historical);
const fp0=p._tradeLedgerContentFingerprint_(c.spreadsheet);
assert.match(fp0,/^[0-9a-f]{64}$/);
c.setRows([...historical,...future]);
const fp1=p._tradeLedgerContentFingerprint_(c.spreadsheet);
assert.notEqual(fp0,fp1,'future ledger amendment changes current fingerprint');
c.setRows([historical[1],historical[0],...historical.slice(2)]);
const fp2=p._tradeLedgerContentFingerprint_(c.spreadsheet);
assert.notEqual(fp0,fp2,'physical row order changes source fingerprint');
const corrected=historical.map((r,i)=>i===0
  ?[r[0],r[1],r[2],r[3],r[4],12,r[6],r[7],r[8],r[9]]:r);
c.setRows(corrected);
const fp3=p._tradeLedgerContentFingerprint_(c.spreadsheet);
assert.notEqual(fp0,fp3,'past trade quantity amendment changes fingerprint');
// Column 11 is fractionalCash. The current production fingerprint must cover
// it even when holdings quantity and cost do not change.
const cashChanged=historical.map((r,i)=>i===0
  ?[...r.slice(0,10),'0.25']:r.slice());
c.setRows(cashChanged);
const fp4=p._tradeLedgerContentFingerprint_(c.spreadsheet);
assert.notEqual(fp0,fp4,'fractionalCash-only amendment changes fingerprint');
// Independently show that mutating production down to 10 columns silently
// misses the same amendment. This does not patch the deployed GAS.
const mutantFp=production._tradeLedgerContentFingerprint_.replace(
  'Math.min(11, sh.getLastColumn())','Math.min(10, sh.getLastColumn())');
assert.notEqual(mutantFp,production._tradeLedgerContentFingerprint);
const fm=context({_tradeLedgerContentFingerprint_:mutantFp});
fm.setRows(historical);
const missing11Before=fm.env._tradeLedgerContentFingerprint_(fm.spreadsheet);
fm.setRows(cashChanged);
const missing11After=fm.env._tradeLedgerContentFingerprint_(fm.spreadsheet);
assert.equal(missing11Before,missing11After,
  'mutation oracle: dropped 11th column conceals fractionalCash-only change');
assert.equal(c.stats().propertiesMutated,0);
assert.equal(c.stats().digestCount,5);
assert.equal(c.stats().rangeReads,5);
assert.equal(fm.stats().propertiesMutated,0);
// Real production function must FAIL this test when the future-date guard is
// removed. This is a mutation, never an edit to production GAS.
const mutantApply=production._applyHoldingTrade.replace(
  '(maxDate && date > maxDate)', 'false');
assert.notEqual(mutantApply,production._applyHoldingTrade);
const mc=context({_applyHoldingTrade:mutantApply});
const badSingle=mc.env.calcHoldingsAtDate([...historical,...future],
  '2026-01-01',namesMap);
assert.notEqual(badSingle['000001'].qty,oracle[1].q,
  'mutation oracle: future trade must leak when single-date guard is removed');
const mutantIndex=production._buildHoldingsByRequestedDate.replace(
  'sortedTrades[tradeIndex].date <= date','true');
assert.notEqual(mutantIndex,production._buildHoldingsByRequestedDate);
const mi=context({_buildHoldingsByRequestedDate:mutantIndex});
const badIndexed=mi.env._buildHoldingsByRequestedDate([...historical,...future],
  ['2026-01-01'],namesMap);
assert.notEqual(badIndexed['2026-01-01']['000001'].qty,oracle[1].q,
  'mutation oracle: future trade must leak when indexed guard is removed');
assert.equal(mc.stats().propertiesMutated,0);
assert.equal(mi.stats().propertiesMutated,0);
console.log('ISSUE507_WRITER_LEDGER_PROVENANCE_CONTRACT_OK');
