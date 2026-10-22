#!/usr/bin/env node
// #507: pure, non-mutating guard for a FUTURE approval-gated KRX source writer.
// Input MUST be all RAW source rows (including zero/invalid/duplicates) read
// directly under the eventual GAS ScriptLock. This does NOT query live Sheets.
// NEVER print codes, names, quantities, prices, credentials or source rows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import YAML from 'yaml';

export const TARGET_DATES=Object.freeze(['2025-12-30','2026-01-02','2026-01-05']);
const OFFICIAL=new Set(['KRX_OPENAPI','KRX_OTP']);
const iso=/^\d{4}-\d{2}-\d{2}$/;
const KST_DATE_PARTS=new Intl.DateTimeFormat('en-US',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
});
function dateValid(s){
  return typeof s==='string'&&iso.test(s)
    &&Number.isFinite(Date.parse(s+'T00:00:00Z'))
    &&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
}
function kstDate(instant){
  if(!(instant instanceof Date)||!Number.isFinite(instant.getTime()))return '';
  const p=Object.fromEntries(KST_DATE_PARTS.formatToParts(instant).map(x=>[x.type,x.value]));
  return [p.year,p.month,p.day].join('-');
}
// Google Sheets getValues() emits native Dates. Do not classify valid,
// unrelated post-boundary rows as unknown just because they are not strings.
// Explicit offset ISO timestamps are instant-based, while date-only/plain
// Sheets local strings carry a local calendar date. Ambiguity fails closed.
export function normalizeRawPriceDate(value){
  if(value instanceof Date)return kstDate(value);
  if(typeof value!=='string')return '';
  const s=value.trim();
  if(dateValid(s))return s;
  if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)){
    const d=s.slice(0,10);return dateValid(d)?d:'';
  }
  if(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(s)){
    const parsed=new Date(s);return kstDate(parsed);
  }
  return '';
}
// Match production _cleanCode() for numeric domestic codes, including cells
// whose old number format dropped leading zeros (5930 -> 005930).
function identifier(v){
  const s=(v===null||v===undefined?'':String(v)).trim().toUpperCase();
  if(/^\d+$/.test(s))return s.padStart(6,'0');
  return s;
}
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
    const d=normalizeRawPriceDate(row[0]);
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
// Validate quote SHAPE without exposing the numerical prices. Production
// fetchPricesKrx returns source=KRX (OpenAPI) or KRX_OTP (OTP/CSV), whereas
// getKrxHeldCloseCoverage exposes only sanitized providerClass evidence.
// Caller-controlled fields are NOT proof of an authenticated provider result.
// This oracle NEVER reads GAS, acquires locks, or authorizes any append.
// Inspect the ACTUAL keyed fetchPricesKrx result (key=code, value has
// {price,usedDate,source}) plus the separately supplied request date.
// This is NOT an authenticated KRX call: callers can forge these objects.
// Never authorize a write based on this synthetic shape contract.
export function inspectOfficialNumericCloses({targetCode,scan,quotes}={}){
  const target=identifier(targetCode);
  requireGuard(!!target&&target.length<=64,'QUOTE_TARGET');
  requireGuard(scan?.mode==='SYNTHETIC_POLICY_ORACLE'
    &&scan.readOnly===true&&scan.writePermitted===false
    &&Array.isArray(scan.observations)
    &&scan.observations.length===TARGET_DATES.length,'QUOTE_SCAN');
  requireGuard(Array.isArray(quotes)&&quotes.length===TARGET_DATES.length,
    'QUOTE_SCOPE');
  const observations=TARGET_DATES.map((date,index)=>{
    const raw=scan.observations[index],q=quotes[index];
    const slot=scan.allDatesCandidates===true&&raw?.date===date
      &&raw.decision==='EXACT_SOURCE_CANDIDATE'
      &&raw.rawOccupiedRows===0;
    const map=q?.pricesByCode;
    const keys=map&&typeof map==='object'&&!Array.isArray(map)
      ?Object.keys(map):[];
    const row=keys.length===1&&identifier(keys[0])===target?map[keys[0]]:null;
    const exact=q?.requestedDate===date&&!!row
      &&row.usedDate===date&&['KRX','KRX_OTP'].includes(row.source)
      &&typeof row.price==='number'&&Number.isFinite(row.price)
      &&row.price>0;
    return {date,rawSlotCandidate:slot,numericQuoteShapeValid:!!exact,
      decision:!slot?'RAW_PROTECTION_BLOCK'
        :!exact?'QUOTE_NOT_EXACT_OR_NOT_NUMERIC':'FORMAT_CANDIDATE_ONLY'};
  });
  return {mode:'SYNTHETIC_NUMERIC_FORMAT_ORACLE',readOnly:true,
    numericValuesExposed:false,privateIdentifiersExposed:false,
    officialProviderAuthenticated:false,sourceAtCopyVerified:false,
    ledgerUnderLockVerified:false,externalWriterExclusive:false,
    writerInstalled:false,writePermitted:false,
    formattedQuoteCandidates:publicCount(observations.filter(
      x=>x.decision==='FORMAT_CANDIDATE_ONLY').length),
    allFormatCandidates:observations.every(
      x=>x.decision==='FORMAT_CANDIDATE_ONLY'),observations,
    next:'Re-fetch provider numbers under GAS ScriptLock and validate exact source date, source history/backup signature, external-writer control, then require separate user authorization.'};
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
  // Google Sheets native Date and serialized ISO timestamps use KST. A
  // perfectly valid later price must not globally block the 3 missing dates.
  assert.equal(normalizeRawPriceDate(new Date('2025-12-29T15:00:00Z')),'2025-12-30');
  assert.equal(normalizeRawPriceDate('2025-12-29T15:00:00.000Z'),'2025-12-30');
  assert.equal(normalizeRawPriceDate('2026-01-06 15:30:00'),'2026-01-06');
  assert.equal(normalizeRawPriceDate(new Date('bad')),'');
  for(const rowDate of [new Date('2026-01-06T00:00:00+09:00'),
    '2026-01-05T15:00:00.000Z','2026-01-06 12:00:00']){
    const r=inspect({...base,rawRows:[row(rowDate)],sheetLastRow:2});
    assert.equal(r.allDatesCandidates,true);
    assert.equal(r.unknownTargetDates,0);
  }
  const nativeProtected=inspect({...base,rawRows:[
    row(new Date('2025-12-29T15:00:00Z'),'SYNTHETIC01',888,'MANUAL')],sheetLastRow:2});
  assert.equal(nativeProtected.observations[0].decision,'RAW_MANUAL_PROTECTED');
  const malformed=inspect({...base,rawRows:[row('2025-99-99')],sheetLastRow:2});
  assert.equal(malformed.unknownTargetDates,1);
  assert.equal(malformed.allDatesCandidates,false);
  const nonTarget=inspect({...base,rawRows:[row('2025-12-30','OTHER_CODE',999)],
    sheetLastRow:2});
  assert.equal(nonTarget.allDatesCandidates,true);
  // Legacy Sheets cells can be numeric even when the canonical code has
  // leading zeros. An occupied 005930 row must not be treated as missing.
  const domestic=inspect({...base,targetCode:'005930',aliases:[],
    rawRows:[row('2025-12-30',5930,888,'MANUAL')],sheetLastRow:2});
  assert.equal(domestic.observations[0].decision,'RAW_MANUAL_PROTECTED');
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
  // Execute the ACTUAL production fetchPricesKrx body under synthetic
  // provider mocks. Its return value is a keyed map, NOT [{code,date,price}].
  const gas=fs.readFileSync(new URL('../src/gas/apps_script.gs',import.meta.url),'utf8');
  const fnStart=gas.indexOf('function fetchPricesKrx(');
  const fnEnd=gas.indexOf('\n}',fnStart);
  assert.ok(fnStart>=0&&fnEnd>fnStart,'production KRX function must be present');
  let viaOtp=false;
  const context=vm.createContext({
    Logger:{log(){}},Object,Number,String,
    _getKrxApiConfig:()=>({apiKey:viaOtp?'':'SYNTHETIC_KEY'}),
    _getKrxAuthKeySlots_:()=>({alternative:null}),
    _fetchKrxMarketsParallelWithFallback:(_markets,ymd)=>({
      KOSPI:{rows:[{ISU_CD:'SYNTHETIC01',TDD_CLSPRC:'101'}],usedYmd:ymd},
      KOSDAQ:{rows:[],usedYmd:ymd},ETF:{rows:[],usedYmd:ymd}
    }),
    _parseKrxNumber:v=>Number(v),
    _cleanCode:v=>String(v||'').trim().toUpperCase(),
    _krxCalendarStatus_:()=> 'OPEN',
    _normalizeDate:v=>String(v||'').slice(0,10),
    fetchPricesKrxViaOtp:(_items,date)=>({
      SYNTHETIC01:{price:101,source:'KRX_OTP',usedDate:date,name:'TEST'}
    })
  });
  vm.runInContext(gas.slice(fnStart,fnEnd+2),context);
  const sampleQuotes=TARGET_DATES.map(date=>({
    requestedDate:date,
    pricesByCode:context.fetchPricesKrx([{code:'SYNTHETIC01',
      name:'SYNTHETIC',market:'KOSPI',currency:'KRW'}],date)
  }));
  assert.deepEqual(Object.keys(sampleQuotes[0].pricesByCode),['SYNTHETIC01']);
  assert.equal(sampleQuotes[0].pricesByCode.SYNTHETIC01.source,'KRX');
  assert.equal(sampleQuotes[0].pricesByCode.SYNTHETIC01.usedDate,'2025-12-30');
  assert.equal(Object.hasOwn(sampleQuotes[0].pricesByCode.SYNTHETIC01,'code'),false);
  assert.equal(Object.hasOwn(sampleQuotes[0].pricesByCode.SYNTHETIC01,'date'),false);
  const checked=inspectOfficialNumericCloses({
    targetCode:base.targetCode,scan:clean,quotes:sampleQuotes});
  assert.equal(checked.allFormatCandidates,true);
  assert.equal(checked.formattedQuoteCandidates,3);
  assert.equal(checked.writePermitted,false);
  assert.equal(checked.officialProviderAuthenticated,false);
  assert.equal(checked.sourceAtCopyVerified,false);
  assert.equal(checked.externalWriterExclusive,false);
  viaOtp=true;
  const otpQuotes=TARGET_DATES.map(date=>({
    requestedDate:date,
    pricesByCode:context.fetchPricesKrx([{code:'SYNTHETIC01',
      name:'SYNTHETIC',market:'KOSPI',currency:'KRW'}],date)
  }));
  assert.equal(otpQuotes[0].pricesByCode.SYNTHETIC01.source,'KRX_OTP');
  assert.equal(inspectOfficialNumericCloses({
    targetCode:base.targetCode,scan:clean,quotes:otpQuotes}).allFormatCandidates,true);
  function mutatedRow(field,value){
    const quotes=structuredClone(sampleQuotes);
    quotes[1].pricesByCode.SYNTHETIC01[field]=value;
    const result=inspectOfficialNumericCloses({
      targetCode:base.targetCode,scan:clean,quotes});
    assert.equal(result.allFormatCandidates,false,'unsafe '+field+' must fail closed');
    assert.equal(result.formattedQuoteCandidates,2);
    assert.equal(result.observations[1].decision,'QUOTE_NOT_EXACT_OR_NOT_NUMERIC');
    assert.equal(result.writePermitted,false);
  }
  for(const price of [0,-1,NaN,Infinity,-Infinity,'100',null,undefined])
    mutatedRow('price',price);
  for(const value of ['2026-01-01','2026-01-06',''])
    mutatedRow('usedDate',value);
  for(const value of ['GOOGLEFINANCE','FUND_NAV','KRX_OPENAPI','MANUAL','KRX_CARRY',''])
    mutatedRow('source',value);
  const shifted=structuredClone(sampleQuotes);
  shifted[1].requestedDate='2026-01-03';
  assert.equal(inspectOfficialNumericCloses({
    targetCode:base.targetCode,scan:clean,quotes:shifted}).allFormatCandidates,false);
  const extraCode=structuredClone(sampleQuotes);
  extraCode[1].pricesByCode.UNRELATED={price:101,source:'KRX',usedDate:'2026-01-02'};
  assert.equal(inspectOfficialNumericCloses({
    targetCode:base.targetCode,scan:clean,quotes:extraCode}).allFormatCandidates,false);
  const wrongCode=structuredClone(sampleQuotes);
  wrongCode[1].pricesByCode={UNRELATED:{price:101,source:'KRX',usedDate:'2026-01-02'}};
  assert.equal(inspectOfficialNumericCloses({
    targetCode:base.targetCode,scan:clean,quotes:wrongCode}).allFormatCandidates,false);
  for(const unsafe of [[],sampleQuotes.slice(0,2),
    [...sampleQuotes,sampleQuotes[0]]]){
    assert.throws(()=>inspectOfficialNumericCloses({
      targetCode:base.targetCode,scan:clean,quotes:unsafe}),
    /ISSUE507_RAW_GUARD_QUOTE_SCOPE/);
  }
  const occupiedScan=inspect({...base,
    rawRows:[row('2025-12-30','SYNTHETIC01',99,'MANUAL')],
    sheetLastRow:2});
  const blocked=inspectOfficialNumericCloses({
    targetCode:base.targetCode,scan:occupiedScan,quotes:sampleQuotes});
  assert.equal(blocked.allFormatCandidates,false);
  assert.equal(blocked.observations[0].decision,'RAW_PROTECTION_BLOCK');
  assert.ok(!JSON.stringify(checked).includes('SYNTHETIC01'));
  assert.ok(!JSON.stringify(checked).includes('"price":101'));
  assert.ok(!JSON.stringify(blocked).includes('SECRET_COMPANY'));
  // This test executes the actual production fetchPricesKrx function.
  // GAS-only PRs MUST trigger the synthetic contract on both PR and main push.
  const workflow=fs.readFileSync(new URL(
    '../.github/workflows/issue-507-source-only-raw-guard.yml',import.meta.url),'utf8');
  function gasChangeTriggers(source,event){
    const doc=YAML.parseDocument(source,{uniqueKeys:true,version:'1.2'});
    assert.equal(doc.errors.length,0,'actual workflow YAML must parse');
    const cfg=doc.toJS({maxAliasCount:0});
    const trigger=cfg?.on?.[event];
    // Only the POSITIVE paths list schedules workflows on changed GAS source.
    // Matching a string elsewhere or in paths-ignore does NOT suffice.
    return Array.isArray(trigger?.paths)
      &&trigger.paths.includes('src/gas/apps_script.gs')
      &&!trigger.paths.some(v=>typeof v==='string'
        &&v.startsWith('!src/gas/apps_script.gs'))
      &&(event!=='push'||(Array.isArray(trigger.branches)
        &&trigger.branches.includes('main')));
  }
  for(const event of ['pull_request','push']){
    assert.equal(gasChangeTriggers(workflow,event),true,
      'GAS-only '+event+' changes must run production numeric contract');
    const withoutGas=workflow.replaceAll(
      "      - 'src/gas/apps_script.gs'", "      - 'unrelated/no-source.js'");
    assert.equal(gasChangeTriggers(withoutGas,event),false,
      'negative GAS trigger mutation must be rejected');
    const wrongEvent=workflow.replace(
      '  '+event+':\n    '+(event==='push'?'branches: [main]\n    ':'')+'paths:',
      '  '+event+':\n    '+(event==='push'?'branches: [main]\n    ':'')+'paths-ignore:');
    assert.notEqual(wrongEvent,workflow,'negative paths-ignore mutation must apply');
    assert.equal(gasChangeTriggers(wrongEvent,event),false,
      'paths-ignore must never count as a positive source trigger');
    const withoutEventPaths=workflow.replace(
      '  '+event+':\n    '+(event==='push'?'branches: [main]\n    ':'')+'paths:',
      '  '+event+':\n    '+(event==='push'?'branches: [main]\n    ':'')+'ignored-only:');
    assert.equal(gasChangeTriggers(withoutEventPaths,event),false,
      'missing positive paths must fail closed');
  }
  console.log('Issue #507 raw full-row historical SOURCE-ONLY policy oracle: PASS');
}
if(process.argv.includes('--self-test'))selfTest();
