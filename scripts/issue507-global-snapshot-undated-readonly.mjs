#!/usr/bin/env node
// Issue #507: global Snapshot audit contract, using only offline supplied rows.
// READ ONLY: no API calls, writes, restore, deletion, or registry mutation.
// Report aggregate counts only; no codes, names, values, row indexes or secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS=30000;
const ACTIVE_LIMIT=30000;
const isPopulated=v=>v!==''&&v!==null&&v!==undefined;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
function fail(code){throw Error('ISSUE507_GLOBAL_SNAPSHOT_'+code);}
function iso(x) {
  if(typeof x!=='string'||!DATE.test(x))return '';
  const dt=new Date(x+'T00:00:00Z');
  return Number.isFinite(dt.getTime())&&dt.toISOString().slice(0,10)===x?x:'';
}
function date(x){
  if(!isPopulated(x))return '';
  if(typeof x==='number'&&Number.isInteger(x)&&x>=35000&&x<=75000)
    return new Date((x-25569)*86400000).toISOString().slice(0,10);
  if(x instanceof Date&&!Number.isNaN(x.getTime()))
    return x.toISOString().slice(0,10);
  return iso(x);
}
function key(v){
  let s=String(v??'').trim().toUpperCase();
  if(!s)return '';
  if(/^\d+$/.test(s))return s.padStart(6,'0');
  return /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(s)&&s.length<=30&&/[A-Z]/.test(s)?s:'';
}
const HEADER=['날짜','종목코드','종목명','수량','매수단가','매수원금'];
const header=row=>HEADER.every((x,i)=>String(row?.[i]??'').trim()===x);

export function auditGlobalSnapshot(rows,{withHeader=true}={}){
  if(!Array.isArray(rows)||rows.length<1||rows.length>MAX_ROWS+1)fail('ROW_COUNT');
  if(rows.some(row=>!Array.isArray(row)||row.length>26))fail('ROW_SCHEMA');
  if(withHeader&&!header(rows[0]))fail('HEADER_SCHEMA');
  const records=withHeader?rows.slice(1):rows;
  const keysByDay=new Map();
  const totals={
    inspectedPhysicalRows:records.length,materialRows:0,emptyRows:0,
    datedMaterialRows:0,undatedMaterialRows:0,undatedTradeLikeRows:0,
    undatedPartialRows:0,unparseableDateRows:0,repeatedHeaderRows:0,
    invalidIdentityRows:0,duplicateDateCodeGroups:0,duplicateExtraRows:0
  };
  for(const row of records){
    if(row.every(x=>!isPopulated(x))){totals.emptyRows++;continue;}
    totals.materialRows++;
    if(header(row)){totals.repeatedHeaderRows++;continue;}
    const raw=row[0],d=date(raw),code=key(row[1]);
    if(!code)totals.invalidIdentityRows++;
    if(!isPopulated(raw)){
      totals.undatedMaterialRows++;
      if(code&&finite(row[3])&&finite(row[5]))totals.undatedTradeLikeRows++;
      else totals.undatedPartialRows++;
      continue;
    }
    if(!d){totals.unparseableDateRows++;continue;}
    totals.datedMaterialRows++;
    if(code){
      let group=keysByDay.get(d);
      if(!group){group=new Map();keysByDay.set(d,group);}
      group.set(code,(group.get(code)||0)+1);
    }
  }
  for(const codes of keysByDay.values()){
    for(const n of codes.values()){
      if(n>1){totals.duplicateDateCodeGroups++;totals.duplicateExtraRows+=n-1;}
    }
  }
  if(totals.materialRows>ACTIVE_LIMIT||
    totals.materialRows+totals.emptyRows!==totals.inspectedPhysicalRows||
    totals.datedMaterialRows+totals.undatedMaterialRows+
      totals.unparseableDateRows+totals.repeatedHeaderRows!==totals.materialRows)
    fail('INTERNAL_COUNT_INVARIANT');
  return {
    mode:'ISSUE507_GLOBAL_SNAPSHOT_OFFLINE_READ_ONLY',
    ...totals,distinctParsedDates:keysByDay.size,
    missingDateRowsIgnoredByDailyDiagnostics:totals.undatedMaterialRows,
    globalIntegrityClear:totals.undatedMaterialRows===0&&
      totals.unparseableDateRows===0&&totals.repeatedHeaderRows===0&&
      totals.invalidIdentityRows===0&&totals.duplicateDateCodeGroups===0,
    ledgerSourceVerified:false,backupRegistryVerified:false,
    sourceSignatureVerified:false,fullSheetAtomicallyRead:false,
    restoreAllowed:false,deleteAllowed:false,writesPerformed:0,
    note:'Counts are from an offline bounded materialized input; no source revision lock or live completeness. Undated rows cannot be assigned from neighboring dates. Daily by-date diagnostics exclude them. Never repair automatically.'
  };
}
function getProd(names){
  const gas=fs.readFileSync(new URL('../src/gas/apps_script.gs',import.meta.url),'utf8');
  return names.map(name=>{
    const start=gas.indexOf('function '+name+'('),end=gas.indexOf('\n}',start);
    assert.ok(start>=0&&end>start,'MISSING_PRODUCTION_FUNCTION_'+name);
    return gas.slice(start,end+2);
  }).join('\n');
}
export async function selfTest(){
  const H=HEADER.concat(['평가단가','평가금액','손익','수익률(%)','평가단가소스','저장일시']);
  const row=(d,c,q=1,cost=10)=>[d,c,'SYNTH',q,10,cost,11,11,1,10,'SYNTH',''];
  const fixtures=[H,row('2026-09-15','000111'),row('2026-09-16','000222'),
    row('', '000333',2,20),row(null,'000444',3,30),
    row('2026-09-15','000111'),H,row('not-a-date','000555'),
    row('2026-09-15',''),[],row(46314,'000666')];
  const z=auditGlobalSnapshot(fixtures);
  assert.equal(z.undatedMaterialRows,2);
  assert.equal(z.undatedTradeLikeRows,2);
  assert.equal(z.undatedPartialRows,0);
  assert.equal(z.repeatedHeaderRows,1);
  assert.equal(z.unparseableDateRows,1);
  assert.equal(z.invalidIdentityRows,1);
  assert.equal(z.duplicateDateCodeGroups,1);
  assert.equal(z.duplicateExtraRows,1);
  assert.equal(z.emptyRows,1);
  assert.equal(z.globalIntegrityClear,false);
  assert.equal(z.restoreAllowed,false);
  assert.equal(z.writesPerformed,0);
  // Production GAS _readRawSnapshotRowsByDate excludes both undated rows:
  // a 23-day read-only audit cannot certify the global sheet.
  const production=getProd(['_normalizeDate','_cleanCode','_readRawSnapshotRowsByDate']);
  const snap={
    getLastRow:()=>fixtures.length,
    getLastColumn:()=>12,
    getRange:()=>({getValues:()=>fixtures.slice(1)})
  };
  const context=vm.createContext({
    CONFIG:{SHEET_SNAPSHOT:'스냅샷',TIMEZONE:'Asia/Seoul'},
    Utilities:{formatDate:()=>{throw Error('UNEXPECTED_DATE_OBJECT')}},
    Logger:{log:()=>{}},
    JSON,Date,Number,String,Object,Array,Math,
  });
  vm.runInContext(production,context,{timeout:3000});
  const prod=context._readRawSnapshotRowsByDate({
    getSheetByName:name=>name==='스냅샷'?snap:null
  },'2026-09-15');
  assert.equal(prod.length,3);
  assert.ok(prod.every(row=>row[0]==='2026-09-15'));
  assert.equal(context._normalizeDate(''),'');
  assert.equal(context._normalizeDate(null),'');
  assert.equal(context._cleanCode('000111'),'000111');
  // Real Sheets UNFORMATTED_VALUE date serial and ISO should be equivalent.
  const one=auditGlobalSnapshot([H,row('2026-09-15','1'),row(46280,'2')]);
  assert.equal(one.undatedMaterialRows,0);
  assert.equal(one.writesPerformed,0);
  const allClean=auditGlobalSnapshot([H,row('2026-09-15','1'),row('2026-09-16','2')]);
  assert.equal(allClean.globalIntegrityClear,true);
  assert.equal(allClean.restoreAllowed,false);
  const duplicateHeader=auditGlobalSnapshot([H,H]);
  assert.equal(duplicateHeader.repeatedHeaderRows,1);
  assert.throws(()=>auditGlobalSnapshot([row('2026-09-15','1')]),/HEADER_SCHEMA/);
  assert.throws(()=>auditGlobalSnapshot('invalid'),/ROW_COUNT/);
  assert.ok(!JSON.stringify(z).includes('000333'));
  assert.ok(!JSON.stringify(z).includes('SYNTH'));
  console.log('ISSUE507_GLOBAL_SNAPSHOT_READ_ONLY_CONTRACT_PASS');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    if(process.argv.includes('--self-test'))await selfTest();
    else{
      const pos=process.argv.indexOf('--input');
      if(pos<0||!process.argv[pos+1])fail('USE_SELF_TEST_OR_LOCAL_INPUT');
      const rows=JSON.parse(fs.readFileSync(process.argv[pos+1],'utf8'));
      console.log(JSON.stringify(auditGlobalSnapshot(rows)));
    }
  }catch(e){
    if(process.argv.includes('--self-test'))
      console.error(String(e?.stack||e).slice(0,1500));
    else console.error(/^ISSUE507_GLOBAL_SNAPSHOT_[A-Z_]+$/.test(String(e?.message||''))
      ?e.message:'ISSUE507_GLOBAL_SNAPSHOT_AUDIT_FAILED');
    process.exitCode=1;
  }
}
