// #734: derive an actionable close/NAV verdict from separate, sanitized READ-ONLY
// GAS close status and exact 32-day per-fund valuation evidence.
// Never overwrite the persisted GAS status or infer a published NAV.
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const FUNDS=Object.freeze(['F00001','F00002','F00003']);
const ISSUES=Object.freeze(['navMissingDates','evaluationPendingDates',
 'snapshotPendingDates','unitsNotAppliedDates','unreconciledDates','writerBlockedDates']);
const day=value=>typeof value==='string'&&DATE.test(value)
 &&!Number.isNaN(Date.parse(value+'T00:00:00Z'))
 &&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const age=(asOf,date)=>(Date.parse(asOf+'T00:00:00Z')
 -Date.parse(date+'T00:00:00Z'))/86400000;
function evidenceDateSet(value,from,to) {
 if(!Array.isArray(value)||value.length>32
  ||value.some(v=>!day(v)||v<from||v>to)||new Set(value).size!==value.length)
  throw Error('CLOSE_FUND_EVIDENCE_SCHEMA');
 return value;
}
export function assessCloseFundOperational({close,funds,asOf}) {
 if(!day(asOf)||!close||!Array.isArray(funds)||funds.length!==FUNDS.length)
  throw Error('CLOSE_FUND_EVIDENCE_SCHEMA');
 const byCode=new Map();
 for(const f of funds) {
  if(!FUNDS.includes(f?.code)||byCode.has(f.code)||!day(f.from)
    ||!day(f.to)||f.from>f.to||f.to!==asOf||age(asOf,f.from)!==31
    ||!Number.isInteger(f.activeDays)||f.activeDays<0||f.activeDays>32)
   throw Error('CLOSE_FUND_EVIDENCE_SCHEMA');
  for(const key of [...ISSUES,'unpublishedDates'])
   evidenceDateSet(f[key],f.from,f.to);
  byCode.set(f.code,f);
 }
 if(byCode.size!==FUNDS.length)throw Error('CLOSE_FUND_EVIDENCE_SCHEMA');
 const overdueFunds=[],awaitingPublication=[],publicationOverdue=[];
 for(const code of FUNDS) {
  const f=byCode.get(code);
  if(ISSUES.some(key=>f[key].some(d=>d<=asOf)))overdueFunds.push(code);
  for(const d of f.unpublishedDates) {
   const elapsed=age(asOf,d),weekday=new Date(d+'T00:00:00Z').getUTCDay();
   // Align with KB collector's conservative Friday/weekend grace.
   const maxLagDays=weekday===5?3:1;
   if(!Number.isSafeInteger(elapsed)||elapsed<0)throw Error('CLOSE_FUND_EVIDENCE_SCHEMA');
   if(elapsed<=maxLagDays)awaitingPublication.push(code);
   else publicationOverdue.push(code);
  }
 }
 const distinct=values=>[...new Set(values)].sort();
 const pending=distinct(awaitingPublication),late=distinct(publicationOverdue),
   needsRepair=distinct(overdueFunds);
 const date=close.closeRunDate,datesMatch=day(date)&&date<=asOf
  &&['storedPriceDate','snapshotLastDate','priceHistoryLastDate',
    'expectedSnapshotDate'].every(k=>close[k]===date)
  &&close.snapshotStale===false;
 const complete=close.closeComplete===true&&close.closeState==='COMPLETE'
  &&close.closeStage==='COMPLETE'&&close.priceCloseState==='COMPLETE'
  &&close.fundCloseState==='DONE'&&close.priceOk===true&&close.fundOk===true
  &&close.fundAttemptState==='DONE'&&close.fundAttemptDate===date
  &&close.fundFailureClass==='NONE'&&close.fundErrorPresent===false
  &&close.pendingKrxDatesCount===0&&datesMatch;
 const safeWarning=['NONE','NAV_PUBLICATION_OR_INPUT_PENDING',
  'PARTIAL_FUND_VALUATION'].includes(close.fundWarningClass);
 let health='CLOSE_DATA_VERIFIED',actionRequired=false;
 if(close.overallStatus==='ERROR'||close.overallStatus==='INCOMPLETE'
  ||!complete) {health='CLOSE_INCOMPLETE_OR_UNVERIFIED';actionRequired=true;}
 else if(needsRepair.length||late.length) {
  health='FUND_NAV_OR_DERIVED_OVERDUE';actionRequired=true;
 } else if(!safeWarning||!['NORMAL','WARNING'].includes(close.overallStatus)
   ||(close.fundWarningPresent===true&&!pending.length)
   ||(close.overallStatus==='WARNING'&&(!close.fundWarningPresent
     ||!pending.length))) {
  health='PERSISTED_WARNING_UNCLASSIFIED';actionRequired=true;
 } else if(pending.length) health='CLOSE_COMPLETE_NAV_PUBLICATION_PENDING';
 return {kind:'ISSUE734_CLOSE_FUND_OPERATIONAL_VERDICT',asOfKst:asOf,
  closeDate:day(date)?date:'UNVERIFIED',
  health,actionRequired,rawOverallStatus:close.overallStatus,
  rawFundWarningClass:close.fundWarningClass,
  overdueFunds:needsRepair,publicationOverdueFunds:late,
  publicationPendingFunds:pending,closePersistedComplete:complete,
  executionOwnerIndependentlyVerified:false,
  source:'PERSISTED_GAS_STATUS_AND_DATE_SCOPED_FUND_READONLY',
  financialWrites:0,gasDeployments:0,telegramSends:0};
}
