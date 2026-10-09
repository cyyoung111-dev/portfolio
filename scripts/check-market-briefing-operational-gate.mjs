import assert from 'node:assert/strict';
import master from '../src/web/domain/market/market_briefing_master.js';
import storeApi from '../src/web/domain/market/market_briefing_snapshot_store.js';
import gate from '../src/web/domain/market/market_briefing_operational_gate.js';
const d='2026-09-18'; let rows=[];
const add=(id,status='FINAL',session='REGULAR',time='06:30:00',finality=null,market='TEST')=>{rows=master.upsertObservation(rows,{seriesId:id,tradingDate:d,value:1,market,session,source:'TEST',status,finality,observedAt:`${d}T${time}+09:00`,receivedAt:`${d}T${time}+09:00`});};
for(const id of gate.REQUIRED_BY_CHECKPOINT.MORNING.filter(x=>x!=='K200_NIGHT')) add(id,id==='NDX'?'DELAYED':'FINAL');
rows=rows.filter(row=>!['KOSPI','KOSDAQ','KOSPI200'].includes(row.seriesId));
for(const id of ['KOSPI','KOSDAQ','KOSPI200'])rows=master.upsertObservation(rows,{seriesId:id,tradingDate:'2026-09-17',sourceDate:'2026-09-17',value:1,market:'KRX',session:'REGULAR',source:'KRX_OFFICIAL',status:'FINAL',finality:'REGULAR_CLOSE',observedAt:'2026-09-17T15:30:00+09:00',receivedAt:`${d}T07:20:00+09:00`});
add('K200_NIGHT','FINAL','NIGHT','06:00:00','NIGHT_FINAL','KRX');
let decision=gate.releaseDecision(master,storeApi,rows,[],d,'MORNING');
assert.equal(decision.publishable,true); assert.equal(decision.status,'READY_WITH_CONTEXT_GAP');
let snapshots=storeApi.appendSnapshot([],{tradingDate:'2026-09-17',checkpoint:'EVENING',asOf:'2026-09-17T20:15:00+09:00',values:{}},{scenario:{next:'context'}});
decision=gate.releaseDecision(master,storeApi,rows,snapshots,d,'MORNING'); assert.equal(decision.status,'READY');
const unverifiedMorning=rows.map(row=>(row.seriesId==='KOSPI'||row.seriesId==='KOSDAQ')?{...row,source:'TOSS',status:'PARTIAL',finality:null}:row);
const unsafe=gate.releaseDecision(master,storeApi,unverifiedMorning,snapshots,d,'MORNING');
assert.equal(unsafe.publishable,false,'미확정 Toss 전일 지수는 정규장 종가 발행 금지');
assert.ok(unsafe.data.missing.includes('KOSPI') || unsafe.data.issues.includes('KOSPI:NOT_CONFIRMED_PREVIOUS_REGULAR_CLOSE'), '미확정 종가는 누락 또는 미확정 오류로 차단');
const staleMaster=rows.filter(row=>row.seriesId!=='KOSPI');
staleMaster.push(master.normalizeObservation({seriesId:'KOSPI',tradingDate:'2026-09-16',sourceDate:'2026-09-16',
 value:3390,market:'KRX',session:'REGULAR',source:'KRX_OFFICIAL',status:'FINAL',finality:'REGULAR_CLOSE',
 observedAt:'2026-09-16T15:30:00+09:00',receivedAt:'2026-09-18T07:00:00+09:00'}));
staleMaster.push(master.normalizeObservation({seriesId:'KOSPI',tradingDate:'2026-09-17',sourceDate:'2026-09-17',
 value:3400,market:'KRX',session:'REGULAR',source:'TOSS',status:'PARTIAL',finality:null,
 observedAt:'2026-09-17T15:30:00+09:00',receivedAt:'2026-09-18T07:05:00+09:00'}));
const staleDecision=gate.releaseDecision(master,storeApi,staleMaster,snapshots,d,'MORNING');
assert.equal(staleDecision.publishable,false,'Codex P1: newer Toss partial vs older KRX official must not publish');
assert.ok(staleDecision.data.issues.includes('KOSPI:STALE_OFFICIAL_CLOSE'),'기존 selectAt의 오래된 FINAL 선택 차단');
const unprovenGap=staleMaster.filter(row=>row.seriesId!=='KOSPI'||row.source!=='TOSS');
const gapDecision=gate.releaseDecision(master,storeApi,unprovenGap,snapshots,d,'MORNING');
assert.equal(gapDecision.publishable,false,'더 최신 관측 없어도 평일 날짜 공백이 미확인되면 NOT_READY');
assert.ok(gapDecision.data.issues.includes('KOSPI:UNVERIFIED_CLOSE_DATE_GAP'));
const legacyGap=unprovenGap.map(row=>row.seriesId==='KOSPI'?{...row,quality:'KRX_VERIFIED_EMPTY_OR_CLOSED_GAP'}:row);
const legacyDecision=gate.releaseDecision(master,storeApi,legacyGap,snapshots,d,'MORNING');
assert.equal(legacyDecision.publishable,false,'기존 범위 없는 quality 표시는 이후 거래일에 재사용 불가');
assert.ok(legacyDecision.data.issues.includes('KOSPI:UNVERIFIED_CLOSE_DATE_GAP'));

// Codex 2차 P1 재현: 금요일 공식값 + 월요일 장전 확인 후 화요일 API가 실패한 경우.
const fridayClose=master.normalizeObservation({seriesId:'KOSPI',tradingDate:'2026-09-18',sourceDate:'2026-09-18',
 value:3420,market:'KRX',session:'REGULAR',source:'KRX_OFFICIAL',status:'FINAL',finality:'REGULAR_CLOSE',
 observedAt:'2026-09-18T15:30:00+09:00',receivedAt:'2026-09-21T07:20:00+09:00',
 quality:'KRX_VERIFIED_EMPTY_OR_CLOSED_GAP'});
const mondayGate=gate.evaluate(master,[fridayClose],'2026-09-21','MORNING');
assert.ok(!mondayGate.issues.some(issue=>issue.startsWith('KOSPI:')&&issue.includes('GAP')),
 '월요일에는 금요일 공식 종가가 주말 때문에 차단되지 않아야 함');
const tuesdayGate=gate.evaluate(master,[fridayClose],'2026-09-22','MORNING');
assert.ok(tuesdayGate.issues.includes('KOSPI:UNVERIFIED_CLOSE_DATE_GAP'),
 'Codex 2차 P1: 월요일 검증 없는 금요일 공식 종가를 화요일에 재사용 금지');
// 10/09은 KRX 공식 휴장, 10/10-11은 주말. 10/12 장전의 마지막 공식 종가는 10/08.
const beforeHoliday=master.normalizeObservation({seriesId:'KOSPI',tradingDate:'2026-10-08',sourceDate:'2026-10-08',
 value:3500,market:'KRX',session:'REGULAR',source:'KRX_OFFICIAL',status:'FINAL',finality:'REGULAR_CLOSE',
 observedAt:'2026-10-08T15:30:00+09:00',receivedAt:'2026-10-12T07:20:00+09:00',
 quality:'KRX_CONFIRMED_CLOSED_GAP@2026-10-11|2026-10-11,2026-10-10,2026-10-09'});
const scoped=gate.evaluate(master,[beforeHoliday],'2026-10-12','MORNING');
assert.ok(!scoped.issues.some(issue=>issue.startsWith('KOSPI:')),
 '휴장일 및 주말 전체가 대상일 범위로 증명된 이전 종가는 허용');
const expired=gate.evaluate(master,[beforeHoliday],'2026-10-13','MORNING');
assert.ok(expired.issues.includes('KOSPI:UNVERIFIED_CLOSE_DATE_GAP'),
 '같은 휴장 검증 표시를 다음 거래일에 재사용할 수 없음');
const incomplete={...beforeHoliday,quality:'KRX_CONFIRMED_CLOSED_GAP@2026-10-11|2026-10-09,2026-10-10'};
assert.ok(gate.evaluate(master,[incomplete],'2026-10-12','MORNING').issues.includes('KOSPI:UNVERIFIED_CLOSE_DATE_GAP'),
 '검증 날짜 중 하루라도 빠지면 차단');
const unscoped={...beforeHoliday,quality:'KRX_VERIFIED_EMPTY_OR_CLOSED_GAP'};
assert.ok(gate.evaluate(master,[unscoped],'2026-10-12','MORNING').issues.includes('KOSPI:UNVERIFIED_CLOSE_DATE_GAP'),
 '옛 범위 없는 휴장 증거도 차단');
let lateBackfill=[];
for(const id of gate.REQUIRED_BY_CHECKPOINT.MORNING.filter(x=>x!=='K200_NIGHT'))lateBackfill=master.upsertObservation(lateBackfill,{seriesId:id,tradingDate:'2026-09-17',sourceDate:'2026-09-17',value:1,market:id==='USDKRW'?'FX':((id==='KOSPI'||id==='KOSDAQ')?'KRX':'TEST'),session:id==='USDKRW'?'FX':'REGULAR',source:(id==='KOSPI'||id==='KOSDAQ')?'KRX_OFFICIAL':'HISTORY',status:'FINAL',finality:id==='USDKRW'?'HISTORICAL_CLOSE':'REGULAR_CLOSE',observedAt:(id==='KOSPI'||id==='KOSDAQ')?'2026-09-17T15:30:00+09:00':undefined,receivedAt:`${d}T07:35:00+09:00`});
lateBackfill=master.upsertObservation(lateBackfill,{seriesId:'K200_NIGHT',tradingDate:d,sourceDate:d,value:1,market:'KRX',session:'NIGHT',source:'KIS',status:'FINAL',finality:'NIGHT_FINAL',observedAt:`${d}T06:00:00+09:00`,receivedAt:`${d}T06:00:00+09:00`});
decision=gate.releaseDecision(master,storeApi,lateBackfill,snapshots,d,'MORNING'); assert.equal(decision.publishable,true); assert.ok(!decision.data.issues.some(issue=>issue.endsWith(':LOOKAHEAD')));
rows=rows.filter(r=>r.seriesId!=='K200_NIGHT'); decision=gate.releaseDecision(master,storeApi,rows,snapshots,d,'MORNING'); assert.equal(decision.publishable,false); assert.ok(decision.data.missing.includes('K200_NIGHT'));
rows=[];
for(const id of gate.REQUIRED_BY_CHECKPOINT.KRX_FINAL) add(id,'FINAL','REGULAR','15:30:00',gate.KRX_FINAL_SERIES.includes(id)?'REGULAR_CLOSE':null,'KRX');
rows=rows.filter(row=>row.seriesId!=='KOSPI200'); add('KOSPI200','DELAYED','REGULAR','15:30:00',null,'KRX');
decision=gate.releaseDecision(master,storeApi,rows,[],d,'KRX_FINAL'); assert.equal(decision.publishable,true);
assert.ok(decision.data.warnings.includes('KOSPI200:DELAYED_AUXILIARY'));
for(const id of gate.OPTIONAL_BY_CHECKPOINT.KRX_FINAL.filter(id=>id!=='KOSPI200')) assert.ok(decision.data.warnings.includes(`${id}:MISSING_OPTIONAL`));
rows=rows.filter(row=>row.seriesId!=='SAMSUNG'); add('SAMSUNG','PARTIAL','REGULAR','15:30:00',null,'KRX');
decision=gate.releaseDecision(master,storeApi,rows,[],d,'KRX_FINAL'); assert.equal(decision.publishable,false); assert.ok(decision.data.issues.includes('SAMSUNG:NOT_REGULAR_FINAL'));
rows=rows.filter(row=>row.seriesId!=='SAMSUNG');
rows=master.upsertObservation(rows,{seriesId:'SAMSUNG',tradingDate:'2026-09-17',sourceDate:'2026-09-17',value:1,market:'KRX',session:'REGULAR',source:'KRX',status:'FINAL',finality:'REGULAR_CLOSE',observedAt:`${d}T15:29:00+09:00`,receivedAt:`${d}T15:29:00+09:00`});
decision=gate.releaseDecision(master,storeApi,rows,[],d,'KRX_FINAL'); assert.equal(decision.publishable,false); assert.ok(decision.data.issues.includes('SAMSUNG:TRADING_DATE_MISMATCH'));
rows=[];
for(const id of gate.REQUIRED_BY_CHECKPOINT.EVENING.filter(id=>id!=='K200_NIGHT')) add(id,'FINAL',id==='USDKRW'?'FX':'REGULAR','20:00:00',gate.KRX_FINAL_SERIES.includes(id)?'REGULAR_CLOSE':null,id==='USDKRW'?'FX':'KRX');
add('K200_NIGHT','LIVE','NIGHT','20:00:00',null,'KRX');
decision=gate.releaseDecision(master,storeApi,rows,[],d,'EVENING'); assert.equal(decision.publishable,true);
rows=[];for(const id of gate.REQUIRED_BY_CHECKPOINT.AFTER_FINAL)add(id,'FINAL','REGULAR','15:30:00','REGULAR_CLOSE','KRX');
decision=gate.releaseDecision(master,storeApi,rows,[],d,'AFTER_FINAL');assert.equal(decision.publishable,true);for(const id of gate.OPTIONAL_BY_CHECKPOINT.AFTER_FINAL)assert.ok(decision.data.warnings.includes(`${id}:MISSING_OPTIONAL`));
console.log('장전·마감 브리핑 운영 게이트 회귀검사 통과');
