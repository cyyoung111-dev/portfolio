#!/usr/bin/env node
// Post-backfill monitoring: consume ONLY the sanitized READ_ONLY output from
// diagnose-backfill-status.mjs. Never call a GAS write endpoint or log secrets.
import fs from 'node:fs';
import {krxSessionStatus} from './krx-session-calendar.mjs';

// The prior READ_ONLY sanitizer already classifies these values; never
// forward free-form GAS exception text or an unrecognized reason to logs.
const HISTORICAL_REASONS=new Set(['STARTED','COMPLETE','FAILED','NO_WORK',
  'FUND_ACTIVE','CLOSE_ACTIVE','BACKFILL_BUSY','LEASE_CONFLICT',
  'BLOCKED_PRECONDITION','EXCEPTION']);
const BACKFILL_FAILURE_CLASSES=new Set([
  'DETAIL_NOT_EXPOSED','SAVED_SNAPSHOT_DATE_INVALID',
  'SAVED_SNAPSHOT_INTEGRITY_FAILED','SAVED_KRX_OR_SNAPSHOT_PROOF_FAILED',
  'CLOSE_RECONCILIATION_FAILED','BACKUP_SAFETY_FAILED',
  'PRICE_WRITE_NOT_CONFIRMED','KRX_PRICE_SOURCE_OR_COVERAGE',
  'SNAPSHOT_SAVE_OR_PROOF','LEASE_OR_WRITER_CONFLICT',
  'FUND_OR_NAV_PRECONDITION','OTHER_UNCLASSIFIED']);
const safeBucket=(value,allowed)=>value==null?'NOT_REPORTED':
  allowed.has(value)?value:'UNVERIFIED';
const safeRunDate=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return '-';
  const parsed=new Date(value+'T00:00:00Z');
  return Number.isFinite(parsed.getTime())
    &&parsed.toISOString().slice(0,10)===value?value:'-';
};

function kstDay(now) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
function previousDay(date) {
  const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-1);
  return d.toISOString().slice(0,10);
}
// Only a single exact T-1 KRX-open date may be a known 08:00 publication wait.
// Unknown holidays, multiple backlogs and non-provider failures still alert.
function previousOpenKrxDate(date) {
  let cursor=date;
  for(let i=0;i<14;i++) {
    cursor=previousDay(cursor);
    const session=krxSessionStatus(cursor);
    if(session==='OPEN')return cursor;
    if(session!=='CLOSED')return null;
  }
  return null;
}
function isExpectedPublicationWait(data,{now,today,issues,slots}) {
  if(krxSessionStatus(today)!=='OPEN')return false;
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(now).map(p=>[p.type,p.value]));
  const minute=Number(parts.hour)*60+Number(parts.minute);
  if(!Number.isFinite(minute)||minute>=480)return false;
  const target=previousOpenKrxDate(today);
  if(!target||data.pendingCount!==1||data.pendingDates[0]!==target)return false;
  // The GAS producer marks exact KRX publication waiting as WARNING.
  // An ERROR/INCOMPLETE overall result can represent independent failures.
  if(data.overallStatus!=='WARNING')return false;
  // An ERROR automation can also represent a separate fund or ledger failure.
  // Only the sanitized, independently verified publication-wait state may
  // suppress the overnight incident exit status. Missing proof fails closed.
  const close=data.close;
  if(!close||close.state!=='ERROR'||close.stage!=='ERROR'||close.priceOk!==false
    ||close.runDate!==target||close.summaryPresent!==true||close.summaryRunDate!==target
    ||close.fundState!=='DONE'||close.fundOk!==true
    ||close.fundErrorPresent!==false||close.fundWarningPresent!==false
    // Production _krxClosePublicationState_ requires nonempty price-only
    // close.errors and validates EVERY entry against the exact T/T-1 dates.
    // A zero count is therefore incompatible with waiting=true.
    ||!Number.isSafeInteger(close.closeErrorCount)||close.closeErrorCount<1
    ||close.runStale===true||close.snapshotStale===true
    ||close.krxPublicationWaiting!==true||close.krxPublicationTradeDate!==target
    ||close.krxPublicationAvailableAfter!==today+'T08:00:00+09:00')return false;
  if(data.officialKrxPriceHistoryLastDate!==previousOpenKrxDate(target)
    ||data.snapshotLastDate<data.officialKrxPriceHistoryLastDate
    ||data.snapshotLastDate>target)return false;
  if(data.triggerReady!==true||data.tradeLedgerWriteUnverified===true
    ||(data.pendingTradeSnapshotRebuildFrom&&data.pendingTradeSnapshotRebuildFrom!=='-'))return false;
  if(data.latestBackfill?.attempted!==true||data.latestBackfill?.ok!==false
    ||data.latestBackfill?.failureClass!=='KRX_PRICE_SOURCE_OR_COVERAGE'
    ||data.latestHistoricalBackfill?.attempted!==true
    ||data.latestHistoricalBackfill?.ok!==false
    ||data.latestHistoricalBackfill?.failureClass!=='KRX_PRICE_SOURCE_OR_COVERAGE')return false;
  if(!['NO_WORK','SUCCEEDED'].includes(slots['2310'])||slots['0030']!=='FAILED')return false;
  const expected=['AUTOMATION_NOT_NORMAL','HISTORICAL_0030_FAILED','PENDING_KRX_DATES'];
  return issues.length===expected.length&&issues.every(issue=>expected.includes(issue));
}
export function assessKrxOvernightHealth(data,{now=new Date()}={}) {
  if (!data || data.mode !== 'READ_ONLY' || !Array.isArray(data.pendingDates)
      || !Number.isSafeInteger(data.pendingCount)
      || data.pendingCount !== data.pendingDates.length
      || typeof data.triggerReady !== 'boolean'
      || !['NORMAL','WARNING','ERROR','INCOMPLETE','NEVER_RUN'].includes(data.overallStatus)) {
    throw new Error('KRX_OVERNIGHT_BAD_DIAGNOSTIC');
  }
  // The pending queue is an all-asset Snapshot recovery queue, NOT a
  // KRX-open-only price backlog. A holiday entry can require a legitimate
  // foreign/fund Snapshot. Classify without clearing or treating it as READY.
  const pendingSessionCounts={open:0,closed:0,unknown:0};
  for (const date of data.pendingDates) {
    const session=krxSessionStatus(date);
    if (session==='OPEN') pendingSessionCounts.open++;
    else if (session==='CLOSED') pendingSessionCounts.closed++;
    else pendingSessionCounts.unknown++;
  }
  const issues=[];
  if (!data.triggerReady) issues.push('TRIGGERS_NOT_READY');
  if (data.pendingCount>0) issues.push('PENDING_KRX_DATES');
  if (pendingSessionCounts.unknown>0) issues.push('PENDING_KRX_SESSION_UNVERIFIED');
  if(data.tradeLedgerWriteUnverified===true)issues.push('TRADE_LEDGER_WRITE_UNVERIFIED');
  const ledgerPending=data.pendingTradeSnapshotRebuildFrom;
  if (ledgerPending!==undefined && ledgerPending!=='-' && ledgerPending!=='') {
    if(typeof ledgerPending!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(ledgerPending))
      throw new Error('KRX_OVERNIGHT_BAD_DIAGNOSTIC');
    issues.push('PENDING_TRADE_LEDGER_REBUILD');
  }
  if (data.overallStatus!=='NORMAL') issues.push('AUTOMATION_NOT_NORMAL');
  // At 02:30 KST the 23:10 run belongs to the prior calendar day,
  // while the 00:30 run must belong to the current KST date. Do not
  // promote a trigger's registration to proof of its execution.
  const version=String(data.gasVersion||'').split('.').map(Number);
  const checkpointRelease=version.length===2 && (
    version[0]>9 || version[0]===9&&version[1]>=236);
  const today=kstDay(now), prior=previousDay(today);
  const expectedSlots=[['2310',prior],['0030',today]];
  const slotStates={};
  const historicalSlotReasons={};
  const historicalSlotRunDates={};
  for(const [slot,date] of expectedSlots) {
    const record=data['historical'+slot];
    if(!checkpointRelease||!record){
      issues.push('HISTORICAL_'+slot+'_NOT_OBSERVED');
      slotStates[slot]='NOT_OBSERVED';
      historicalSlotReasons[slot]='NOT_OBSERVED';
      historicalSlotRunDates[slot]='-';
      continue;
    }
    historicalSlotReasons[slot]=safeBucket(record.reason,HISTORICAL_REASONS);
    historicalSlotRunDates[slot]=safeRunDate(record.runDate);
    const state=String(record.state||'');
    if(record.runDate!==date){
      issues.push('HISTORICAL_'+slot+'_STALE');
      slotStates[slot]='STALE';continue;
    }
    if(!['SUCCEEDED','NO_WORK','DEFERRED','FAILED','RUNNING'].includes(state))
      throw new Error('KRX_OVERNIGHT_BAD_DIAGNOSTIC');
    slotStates[slot]=state;
    if(state==='RUNNING')issues.push('HISTORICAL_'+slot+'_UNFINISHED');
    if(state==='FAILED')issues.push('HISTORICAL_'+slot+'_FAILED');
    if(state==='DEFERRED')issues.push('HISTORICAL_'+slot+'_DEFERRED');
  }
  // On Korean holidays US markets can advance the Snapshot after the
  // latest KRX session; that is healthy. Alert only when the persisted
  // Snapshot is strictly BEHIND an already-confirmed official KRX close.
  // Missing dates must never be silently carried forward.
  const official=data.officialKrxPriceHistoryLastDate;
  const snapshot=data.snapshotLastDate;
  if (official==='-' || snapshot==='-') issues.push('LAST_DATE_UNAVAILABLE');
  else if (snapshot < official) issues.push('KRX_SNAPSHOT_STALE');
  // The overnight 00:30 KRX producer cannot receive T-1 official bars
  // before the following KRX trading day's 08:00 publication. This is not
  // healthy/completed; keep the pending/failed evidence and never write data.
  const publicationWaiting=isExpectedPublicationWait(data,{now,today,issues,slots:slotStates});
  return {
    mode:'READ_ONLY',
    status:publicationWaiting?'AWAITING_PROVIDER_PUBLICATION':issues.length?'ACTION_REQUIRED':'HEALTHY',
    publicationWaitTargetDate:publicationWaiting?data.pendingDates[0]:null,
    gasVersion:String(data.gasVersion||''),
    issues,
    historicalSlotStates:slotStates,
    // Supplemental provenance of a checkpoint, not Apps Script Executions.
    historicalSlotReasons,
    historicalSlotRunDates,
    lastBackfillFailureClass:safeBucket(
      data.latestBackfill?.failureClass,BACKFILL_FAILURE_CLASSES),
    lastHistoricalFailureClass:safeBucket(
      data.latestHistoricalBackfill?.failureClass,BACKFILL_FAILURE_CLASSES),
    pendingCount:data.pendingCount,
    pendingDates:data.pendingDates,
    pendingSessionCounts,
    pendingTradeSnapshotRebuildFrom:ledgerPending||'-',
    tradeLedgerWriteUnverified:data.tradeLedgerWriteUnverified===true,
    officialKrxPriceHistoryLastDate:official,
    snapshotLastDate:snapshot,
    lastBackfillAttempted:data.latestBackfill?.attempted??null,
    lastBackfillOk:data.latestBackfill?.ok??null,
    lastHistoricalAttempted:data.latestHistoricalBackfill?.attempted??null,
    lastHistoricalOk:data.latestHistoricalBackfill?.ok??null
  };
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('KRX_OVERNIGHT_INVALID_ARGS');
    const payload=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    const result=assessKrxOvernightHealth(payload);
    console.log(JSON.stringify(result));
    if (process.env.GITHUB_STEP_SUMMARY) {
      const lines=[
        '### KRX 백필 후 자동 진단 (읽기 전용)',
        '',
        '| 항목 | 결과 |',
        '|---|---|',
        '| 운영 판정 | '+result.status+' |',
        '| 공식 게시 대기 대상일 | '+(result.publicationWaitTargetDate||'-')+' |',
        '| GAS 버전 | '+result.gasVersion.replace(/[^0-9.]/g,'')+' |',
        '| 잔여 큐 | '+result.pendingCount+'건 |',
        '| KRX 개장일 대기 | '+result.pendingSessionCounts.open+'건 |',
        '| KRX 휴장일 대기 (전체 Snapshot 검증 필요) | '+result.pendingSessionCounts.closed+'건 |',
        '| 거래일 확인 불가 대기 | '+result.pendingSessionCounts.unknown+'건 |',
        '| 공식 KRX 마지막 날 | '+result.officialKrxPriceHistoryLastDate+' |',
        '| Snapshot 마지막 날 | '+result.snapshotLastDate+' |',
        '| 점검 코드 | '+(result.issues.join(', ')||'없음')+' |',
        '| 23:10 결과 | '+result.historicalSlotStates['2310']+' |',
        '| 23:10 기록일·사유 | '+result.historicalSlotRunDates['2310']+
          ' / '+result.historicalSlotReasons['2310']+' |',
        '| 00:30 결과 | '+result.historicalSlotStates['0030']+' |',
        '| 00:30 기록일·사유 | '+result.historicalSlotRunDates['0030']+
          ' / '+result.historicalSlotReasons['0030']+' |',
        '| KRX 백필 장애 분류 | '+result.lastBackfillFailureClass+' |',
        '| 과거 재처리 장애 분류 | '+result.lastHistoricalFailureClass+' |',
        '',
        '기록일·사유는 비식별 저장 체크포인트 기준이며 실제 GAS 실행 로그나 원인 확정이 아닙니다.',
        '가격이력·Snapshot·ScriptProperties를 변경하지 않는 점검입니다.'
      ];
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
    }
    if(result.status==='ACTION_REQUIRED')process.exitCode=1;
  } catch(error) {
    const code=String(error?.message||'');
    console.error(/^KRX_OVERNIGHT_[A-Z_]+$/.test(code)?code:'KRX_OVERNIGHT_DIAGNOSTIC_FAILED');
    process.exitCode=1;
  }
}