#!/usr/bin/env node
// #507: pure, non-mutating guard for a FUTURE approval-gated KRX source writer.
// Input MUST be all RAW source rows (including zero/invalid/duplicates) read
// directly under the eventual GAS ScriptLock. This does NOT query live Sheets.
// NEVER print codes, names, quantities, prices, credentials or source rows.
import assert from 'node:assert/strict';

export const TARGET_DATES=Object.freeze(['2025-12-30','2026-01-02','2026-01-05']);
const OFFICIAL=new Set(['KRX_OPENAPI','KRX_OTP']);
const iso=/^\d{4}-\d{2}-\d{2}$/;
function dateValid(s){
  return typeof s==='string'&&iso.test(s)
    &&Number.isFinite(Date.parse(s+'T00:00:00Z'))
    &&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
}
function identifier(v){return typeof v==='string'?v.trim().toUpperCase():'';}
function integer(n){return Number.isSafeInteger(n)&&n>=0&&n<=1000000;}
function requireGuard(ok,code){if(!ok)throw Error('ISSUE507_RAW_GUARD_'+code);}
function publicCount(n){requireGuard(integer(n),'UNSAFE_COUNT');return n;}

// Pure policy oracle only. Caller-provided evidence is NOT independently
// verified here and cannot authorize production writes.
export function inspectRawHistory({targetCode,aliases=[],rawRows,sheetLastRow,
  columnsRead=6,evidence,ledger}={}) {
  const target=identifier(targetCode);
  requireGuard(!!target&&target.length<=64,'TARGET');
  requireGuard(Array.isArray(aliases)&&aliases.length<=30
    &&aliases.every(x=>typeof x==='string'&&x.trim().length>0),'ALIASES');
  const keys=new Set([target,...aliases.map(identifier)]);
  requireGuard(keys.size<=31,'ALIASES');
  requireGuard(Array.isArray(rawRows)&&rawRows.length<=100000
    &&integer(sheetLastRow)&&sheetLastRow===rawRows.length+1
    &&Number.isInteger(columnsRead)&&columnsRead>=6,'RAW_SCAN_INCOMPLETE');
  requireGuard(rawRows.every(row=>Array.isArray(row)&&row.length>=6),'RAW_ROW_SCHEMA');
  requireGuard(Array.isArray(evidence)&&evidence.length===TARGET_DATES.length,'PROOF_SCHEMA');
  requireGuard(evidence.every((p,i)=>p&&p.date===TARGET_DATES[i]
    &&p.eligibleHeldDomestic===true
    &&typeof p.exactDateConfirmed==='boolean'
    &&typeof p.usedDate==='string'
    &&typeof p.providerClass==='string'),'PROOF_SCHEMA');
  requireGuard(ledger&&typeof ledger==='object'
    &&typeof ledger.heldBeforeYearEnd==='boolean'
    &&typeof ledger.ledgerFingerprintStable==='boolean'
    &&typeof ledger.corporateActionAcrossCarry==='boolean'
    &&integer(ledger.storedJan01TargetCount),'LEDGER_SCHEMA');

  // An alias in EITHER the raw code OR the raw name counts as an occupied row.
  // Unknown/invalid raw dates for this target prevent a safe append because
  // they might be malformed representations of the same intended session.
  const seen=TARGET_DATES.map(()=>[]);
  let unknownTargetDates=0;
  for(const row of rawRows){
    const code=identifier(row[1]),name=identifier(row[2]);
    if(!keys.has(code)&&!keys.has(name))continue;
    const d=row[0];
    if(!dateValid(d)){unknownTargetDates++;continue;}
    const idx=TARGET_DATES.indexOf(d);
    if(idx>=0)seen[idx].push(row);
  }
  publicCount(unknownTargetDates);
  const globalSafe=unknownTargetDates===0
    &&ledger.ledgerFingerprintStable===true
    &&ledger.heldBeforeYearEnd===true
    &&ledger.corporateActionAcrossCarry===false
    &&ledger.storedJan01TargetCount===0;
  const observations=TARGET_DATES.map((date,i)=>{
    const rows=seen[i],p=evidence[i];
    const manual=rows.filter(r=>identifier(r[5])==='MANUAL').length;
    const nonpositive=rows.filter(r=>!(Number(r[3])>0)
      ||!Number.isFinite(Number(r[3]))).length;
    const confirmed=p.exactDateConfirmed===true&&p.usedDate===date
      &&OFFICIAL.has(p.providerClass);
    const status=!globalSafe?'GLOBAL_PROTECTION_BLOCK'
      :!confirmed?'OFFICIAL_EXACT_DATE_NOT_CONFIRMED'
      :rows.length>1?'RAW_DUPLICATE_PROTECTED'
      :manual?'RAW_MANUAL_PROTECTED'
      :rows.length?'EXISTING_RAW_ROW_PROTECTED'
      :'EXACT_SOURCE_CANDIDATE';
    return {date,officialExact:confirmed,
      rawOccupiedRows:publicCount(rows.length),rawManualRows:publicCount(manual),
      rawNonpositiveOrInvalidRows:publicCount(nonpositive),
      decision:status,candidateForSeparateWriterApproval:status==='EXACT_SOURCE_CANDIDATE'};
  });
  return {
    mode:'SYNTHETIC_POLICY_ORACLE',readOnly:true,originalSheetWritten:false,
    priceNumbersExposed:false,writerInstalled:false,writePermitted:false,
    completeRawScanDeclared:true,scannedRows:publicCount(rawRows.length),
    unknownTargetDates:publicCount(unknownTargetDates),
    ledgerStable:ledger.ledgerFingerprintStable,
    allDatesCandidates:observations.every(x=>x.candidateForSeparateWriterApproval),
    observations,
    next:'Re-read all raw rows and verify exact official numerical closes INSIDE GAS ScriptLock; source backup/signature, post-append verification and user write approval are separate mandatory gates.'
  };
}
export function selfTest(){
  const base={
    targetCode:'SYNTHETIC01', aliases:['SYNTHETIC_ALIAS'],
    rawRows:[],sheetLastRow:1,columnsRead:6,
    evidence:TARGET_DATES.map(date=>({date,eligibleHeldDomestic:true,
      exactDateConfirmed:true,usedDate:date,providerClass:'KRX_OPENAPI'})),
    ledger:{heldBeforeYearEnd:true,ledgerFingerprintStable:true,
      corporateActionAcrossCarry:false,storedJan01TargetCount:0}
  };
  const inspect=x=>inspectRawHistory(x);
  const clean=inspect(base);
  assert.equal(clean.allDatesCandidates,true);
  assert.equal(clean.writePermitted,false);
  assert.equal(clean.observations.length,3);
  const row=(date,code='SYNTHETIC01',price=0,source='')=>[date,code,'SECRET_COMPANY',price,'',source];
  for(const price of [0,-5,'TEXT',NaN]) {
    const rows=[row('2025-12-30','SYNTHETIC01',price)];
    const result=inspect({...base,rawRows:rows,sheetLastRow:2});
    assert.equal(result.allDatesCandidates,false);
    assert.equal(result.observations[0].rawOccupiedRows,1);
    assert.equal(result.observations[0].rawNonpositiveOrInvalidRows,1);
    assert.equal(result.observations[0].decision,'EXISTING_RAW_ROW_PROTECTED');
  }
  const manual=inspect({...base,rawRows:[row('2026-01-02','SYNTHETIC_ALIAS',888,'MANUAL')],sheetLastRow:2});
  assert.equal(manual.observations[1].decision,'RAW_MANUAL_PROTECTED');
  const duplicate=inspect({...base,
    rawRows:[row('2025-12-30'),row('2025-12-30','SYNTHETIC_ALIAS',888,'MANUAL')],
    sheetLastRow:3});
  assert.equal(duplicate.observations[0].decision,'RAW_DUPLICATE_PROTECTED');
  const malformed=inspect({...base,rawRows:[row('2025-99-99')],sheetLastRow:2});
  assert.equal(malformed.unknownTargetDates,1);
  assert.equal(malformed.allDatesCandidates,false);
  const nonTarget=inspect({...base,rawRows:[row('2025-12-30','OTHER_CODE',999)],
    sheetLastRow:2});
  assert.equal(nonTarget.allDatesCandidates,true);
  const stale=structuredClone(base);stale.evidence[0].usedDate='2025-12-29';
  assert.equal(inspect(stale).allDatesCandidates,false);
  for(const override of [
    {heldBeforeYearEnd:false},{ledgerFingerprintStable:false},
    {corporateActionAcrossCarry:true},{storedJan01TargetCount:1}
  ]){
    const result=inspect({...base,ledger:{...base.ledger,...override}});
    assert.equal(result.allDatesCandidates,false);
  }
  for(const fields of [
    {sheetLastRow:2},{columnsRead:5},{rawRows:[['2025-12-30','SYNTHETIC01']]},
    {evidence:[]}
  ])assert.throws(()=>inspect({...base,...fields}),/ISSUE507_RAW_GUARD_/);
  assert.ok(!JSON.stringify(manual).includes('SECRET_COMPANY'));
  assert.ok(!JSON.stringify(manual).includes('SYNTHETIC01'));
  assert.ok(!JSON.stringify(manual).includes('888'));
  console.log('Issue #507 raw full-row historical SOURCE-ONLY policy oracle: PASS');
}
if(process.argv.includes('--self-test'))selfTest();
