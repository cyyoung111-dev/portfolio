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
// Snapshot read paths use two known cost-label variants. Validate all A:K
// semantic positions before interpreting valuation or provenance columns.
// L (savedAt) is optional historical metadata and never a classified value.
const HEADER=['날짜','종목코드','종목명','수량','매수단가','매수원금',
  '평가단가','평가금액','손익','수익률(%)','평가단가소스'];
// Production _reconcileFundUnitDerivedRows creates a separate legacy
// Snapshot header, including J/K labels. Never mix the two variants.
const LEGACY_FUND_HEADER=['날짜','종목코드','종목명','수량','매입단가','매입원금',
  '평가단가','평가금액','손익','수익률','소스'];
const header=row=>[HEADER,LEGACY_FUND_HEADER].some(expected=>
  expected.every((x,i)=>String(row?.[i]??'').trim()===x));

// Classification is only an offline comparison of displayed Snapshot fields.
// L (savedAt) is not comparable finance/source data; historical row provenance
// and the correct ledger-based row cannot be inferred from duplicate frequency.
const FINANCIAL_COLUMNS=[3,4,5,6,7,8,9];
const QTY_COST_COLUMNS=[3,4,5];
const VALUATION_COLUMNS=[6,7,8,9];
// Do not coerce booleans, arrays, dates, hexadecimal, Infinity or arbitrary
// strings into financial figures. Permit primitive finite numbers, canonical
// decimal strings and strictly grouped thousands separators only.
const DECIMAL=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const GROUPED_DECIMAL=/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?(?:[eE][+-]?\d+)?$/;
function financialNumber(row,index){
  const raw=row?.[index];
  if(typeof raw==='number')return Number.isFinite(raw)?raw:null;
  if(typeof raw!=='string')return null;
  const value=raw.trim();
  if(!DECIMAL.test(value)&&!GROUPED_DECIMAL.test(value))return null;
  const number=Number(value.replaceAll(',',''));
  return Number.isFinite(number)?number:null;
}
function columnSignature(row,columns){
  return JSON.stringify(columns.map(index=>financialNumber(row,index)));
}
function duplicateClass(rows){
  if(rows.some(row=>FINANCIAL_COLUMNS.some(index=>financialNumber(row,index)===null)))
    return 'NUMERIC_UNVERIFIED';
  if(new Set(rows.map(row=>columnSignature(row,QTY_COST_COLUMNS))).size>1)
    return 'QTY_COST_CONFLICT';
  if(new Set(rows.map(row=>columnSignature(row,VALUATION_COLUMNS))).size>1)
    return 'VALUATION_CONFLICT';
  if(new Set(rows.map(row=>JSON.stringify([
    String(row[2]??'').trim(),String(row[10]??'').trim().toUpperCase()
  ]))).size>1)return 'PROVENANCE_ONLY';
  return 'SAME_COMPARABLE';
}

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
    invalidIdentityRows:0,duplicateDateCodeGroups:0,duplicateExtraRows:0,
    duplicateSameComparableGroups:0,duplicateProvenanceOnlyGroups:0,
    duplicateValuationConflictGroups:0,duplicateQtyCostConflictGroups:0,
    duplicateNumericUnverifiedGroups:0
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
      if(!group.has(code))group.set(code,[]);
      group.get(code).push(row);
    }
  }
  for(const codes of keysByDay.values()){
    for(const rows of codes.values()){
      if(rows.length<=1)continue;
      totals.duplicateDateCodeGroups++;
      totals.duplicateExtraRows+=rows.length-1;
      const category=duplicateClass(rows);
      if(category==='SAME_COMPARABLE')totals.duplicateSameComparableGroups++;
      else if(category==='PROVENANCE_ONLY')totals.duplicateProvenanceOnlyGroups++;
      else if(category==='VALUATION_CONFLICT')totals.duplicateValuationConflictGroups++;
      else if(category==='QTY_COST_CONFLICT')totals.duplicateQtyCostConflictGroups++;
      else totals.duplicateNumericUnverifiedGroups++;
    }
  }
  if(totals.materialRows>ACTIVE_LIMIT||
    totals.materialRows+totals.emptyRows!==totals.inspectedPhysicalRows||
    totals.datedMaterialRows+totals.undatedMaterialRows+
      totals.unparseableDateRows+totals.repeatedHeaderRows!==totals.materialRows||
    totals.duplicateSameComparableGroups+totals.duplicateProvenanceOnlyGroups+
      totals.duplicateValuationConflictGroups+totals.duplicateQtyCostConflictGroups+
      totals.duplicateNumericUnverifiedGroups!==totals.duplicateDateCodeGroups)
    fail('INTERNAL_COUNT_INVARIANT');
  return {
    mode:'ISSUE507_GLOBAL_SNAPSHOT_OFFLINE_READ_ONLY',
    ...totals,distinctParsedDates:keysByDay.size,
    missingDateRowsIgnoredByDailyDiagnostics:totals.undatedMaterialRows,
    globalIntegrityClear:totals.undatedMaterialRows===0&&
      totals.unparseableDateRows===0&&totals.repeatedHeaderRows===0&&
      totals.invalidIdentityRows===0&&totals.duplicateDateCodeGroups===0,
    // C:K comparable values only. Same values are not a restore/delete proof.
    duplicateClassificationScope:'OFFLINE_C_TO_K_NO_EXPECTED_LEDGER',
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
  const H=HEADER.concat(['저장일시']);
  const row=(d,c,q=1,cost=10)=>[d,c,'SYNTH',q,10,cost,11,11,1,10,'SYNTH',''];
  const fixtures=[H,row('2026-09-15','000111'),row('2026-09-16','000222'),
    row('', '000333',2,20),row(null,'000444',3,30),
    row('2026-09-15','000111'),H,row('not-a-date','000555'),
    row('2026-09-15',''),[],row(46314,'000666')];
  const legacy=LEGACY_FUND_HEADER.concat(['저장일시']);
  const legacyCheck=auditGlobalSnapshot([legacy,row('2026-09-15','1'),legacy]);
  assert.equal(legacyCheck.writesPerformed,0);
  const legacyPair=auditGlobalSnapshot([legacy,
    row('2026-09-16','1'),row('2026-09-16','1')]);
  assert.equal(legacyPair.duplicateSameComparableGroups,1);
  // Mixed modern/legacy labels are not genuine producer schemas.
  const mixedCost=H.slice();mixedCost[4]='매입단가';mixedCost[5]='매입원금';
  assert.throws(()=>auditGlobalSnapshot([mixedCost,row('2026-09-15','1')]),
    /HEADER_SCHEMA/);
  const mixedTail=legacy.slice();mixedTail[9]=H[9];mixedTail[10]=H[10];
  assert.throws(()=>auditGlobalSnapshot([mixedTail,row('2026-09-15','1')]),
    /HEADER_SCHEMA/);
  // Keep this allowlist tied to actual producer literals; unknown source
  // schema changes must fail the contract rather than silently misclassify.
  const gasSource=fs.readFileSync(new URL('../src/gas/apps_script.gs',import.meta.url),'utf8');
  // Test oracle: compare this allowlist with BOTH real production sheet creators.
  // No generated test header is allowed to silently differ from its producer.
  const actualHeader=expression=>{
    const match=gasSource.match(expression);
    assert.ok(match,'GAS Snapshot producer header must be found');
    return JSON.parse(match[1].replaceAll("'",'"'));
  };
  const actualFund=actualHeader(/snap\.appendRow\((\['날짜'[^\]\n]*\])\)/);
  const actualNormal=actualHeader(/snap\.getRange\(1,1,1,12\)\.setValues\(\[(\['날짜'[^\]\n]*\])\]\)/);
  assert.deepEqual(actualFund,legacy,'actual fund Snapshot creator schema drift');
  assert.deepEqual(actualNormal,H,'actual regular Snapshot creator schema drift');
  assert.equal(legacyCheck.datedMaterialRows,1);
  assert.equal(legacyCheck.repeatedHeaderRows,1);
  assert.equal(legacyCheck.globalIntegrityClear,false);
  const invalidPair=H.slice();invalidPair[4]='매입단가';
  assert.throws(()=>auditGlobalSnapshot([invalidPair,row('2026-09-15','1')]),
    /HEADER_SCHEMA/);
  // Each G:K semantic position is required, including legacy cost labels.
  for(let col=6;col<=10;col++){
    const tampered=H.slice();tampered[col]=H[col+1]||'ALTERED';
    assert.throws(()=>auditGlobalSnapshot([tampered,
      row('2026-09-15','000001'),row('2026-09-15','000001')]),
      /HEADER_SCHEMA/);
    const legacyTampered=legacy.slice();legacyTampered[col]='BAD';
    assert.throws(()=>auditGlobalSnapshot([legacyTampered,row('2026-09-15','1')]),
      /HEADER_SCHEMA/);
  }
  const shuffled=H.slice();[shuffled[6],shuffled[7]]=[shuffled[7],shuffled[6]];
  assert.throws(()=>auditGlobalSnapshot([shuffled,row('2026-09-15','1')]),
    /HEADER_SCHEMA/);
  assert.throws(()=>auditGlobalSnapshot([H.slice(0,6),row('2026-09-15','1')]),
    /HEADER_SCHEMA/);
  const z=auditGlobalSnapshot(fixtures);
  assert.equal(z.undatedMaterialRows,2);
  assert.equal(z.undatedTradeLikeRows,2);
  assert.equal(z.undatedPartialRows,0);
  assert.equal(z.repeatedHeaderRows,1);
  assert.equal(z.unparseableDateRows,1);
  assert.equal(z.invalidIdentityRows,1);
  assert.equal(z.duplicateDateCodeGroups,1);
  assert.equal(z.duplicateExtraRows,1);
  assert.equal(z.duplicateSameComparableGroups,1);
  assert.equal(z.duplicateQtyCostConflictGroups,0);
  // Five mutually exclusive duplicate classes from synthetic rows only.
  const pair=(code,edit)=>{
    const first=row('2026-09-17',code);
    const second=first.slice();
    if(edit)edit(second);
    return [first,second];
  };
  const classified=auditGlobalSnapshot([H,
    ...pair('000101'),
    ...pair('000102',r=>{r[10]='NAV';}),
    ...pair('000103',r=>{r[6]=12;r[7]=12;r[8]=2;r[9]=20;}),
    ...pair('000104',r=>{r[3]=2;r[5]=20;}),
    ...pair('000105',r=>{r[3]='';})
  ]);
  assert.equal(classified.duplicateDateCodeGroups,5);
  assert.equal(classified.duplicateSameComparableGroups,1);
  assert.equal(classified.duplicateProvenanceOnlyGroups,1);
  assert.equal(classified.duplicateValuationConflictGroups,1);
  assert.equal(classified.duplicateQtyCostConflictGroups,1);
  assert.equal(classified.duplicateNumericUnverifiedGroups,1);
  assert.equal(classified.duplicateExtraRows,5);
  // Old Number(raw) silently turned booleans and hex into valid figures.
  // Each invalid cell must fail closed even when its counterpart is numeric.
  const malformed=[true,false,'0x10','0b10','Infinity','NaN','1_000',
    '12,34','1e999',{},[],null,'   ','1 2','1.2.3'];
  for(const [index,value] of malformed.entries()){
    const first=row('2026-09-19','099991');
    const second=first.slice();first[3]=index===0?1:16;second[3]=value;
    const result=auditGlobalSnapshot([H,first,second]);
    assert.equal(result.duplicateNumericUnverifiedGroups,1);
    assert.equal(result.duplicateSameComparableGroups,0);
    assert.equal(result.restoreAllowed,false);
  }
  const validNumberCases=[
    ['-2.5',-2.5],['0',0],['+0.50',0.5],['1.25e3',1250],
    ['1,234.50',1234.5],['0.000001',0.000001],['-1,000',-1000]
  ];
  for(const [formatted,number] of validNumberCases){
    const first=row('2026-09-19','099992');
    const second=first.slice();first[3]=number;second[3]=formatted;
    const result=auditGlobalSnapshot([H,first,second]);
    assert.equal(result.duplicateSameComparableGroups,1);
    assert.equal(result.duplicateNumericUnverifiedGroups,0);
  }
  assert.equal(classified.restoreAllowed,false);
  assert.equal(classified.deleteAllowed,false);
  assert.equal(classified.fullSheetAtomicallyRead,false);
  assert.ok(!JSON.stringify(classified).includes('000101'));
  assert.ok(!JSON.stringify(classified).includes('000105'));
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