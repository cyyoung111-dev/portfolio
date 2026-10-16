#!/usr/bin/env node
// Post-backfill monitoring: consume ONLY the sanitized READ_ONLY output from
// diagnose-backfill-status.mjs. Never call a GAS write endpoint or log secrets.
import fs from 'node:fs';

export function assessKrxOvernightHealth(data) {
  if (!data || data.mode !== 'READ_ONLY' || !Array.isArray(data.pendingDates)
      || !Number.isSafeInteger(data.pendingCount)
      || data.pendingCount !== data.pendingDates.length
      || typeof data.triggerReady !== 'boolean'
      || !['NORMAL','WARNING','ERROR','INCOMPLETE','NEVER_RUN'].includes(data.overallStatus)) {
    throw new Error('KRX_OVERNIGHT_BAD_DIAGNOSTIC');
  }
  const issues=[];
  if (!data.triggerReady) issues.push('TRIGGERS_NOT_READY');
  if (data.pendingCount>0) issues.push('PENDING_KRX_DATES');
  if (data.overallStatus!=='NORMAL') issues.push('AUTOMATION_NOT_NORMAL');
  // Different confirmed KRX/Snapshot dates can indicate missing valuation.
  // Missing dates must be reported, never auto-filled from the prior session.
  const official=data.officialKrxPriceHistoryLastDate;
  const snapshot=data.snapshotLastDate;
  if (official==='-' || snapshot==='-') issues.push('LAST_DATE_UNAVAILABLE');
  else if (official!==snapshot) issues.push('KRX_SNAPSHOT_LAST_DATE_MISMATCH');
  return {
    mode:'READ_ONLY',
    status:issues.length?'ACTION_REQUIRED':'HEALTHY',
    gasVersion:String(data.gasVersion||''),
    issues,
    pendingCount:data.pendingCount,
    pendingDates:data.pendingDates,
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
        '| GAS 버전 | '+result.gasVersion.replace(/[^0-9.]/g,'')+' |',
        '| 잔여 큐 | '+result.pendingCount+'건 |',
        '| 공식 KRX 마지막 날 | '+result.officialKrxPriceHistoryLastDate+' |',
        '| Snapshot 마지막 날 | '+result.snapshotLastDate+' |',
        '| 점검 코드 | '+(result.issues.join(', ')||'없음')+' |',
        '',
        '가격이력·Snapshot·ScriptProperties를 변경하지 않는 점검입니다.'
      ];
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
    }
    if(result.status!=='HEALTHY')process.exitCode=1;
  } catch(error) {
    const code=String(error?.message||'');
    console.error(/^KRX_OVERNIGHT_[A-Z_]+$/.test(code)?code:'KRX_OVERNIGHT_DIAGNOSTIC_FAILED');
    process.exitCode=1;
  }
}
