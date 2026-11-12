// #860: diagnostic-only successor to reviewed, already-deployed GAS 9.291.
// CLOSE PRICE and NAV publication are independently visible. Read-only
// automation diagnostics bypass writer admission and expired execution leases
// are archived as UNCONFIRMED before retirement; no finance writers change.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {composeIssue860Gas9291Preview} from './compose-issue860-gas9291-preview.mjs';

const PARENT_SHA='e9311667d513c1e43a8ed1af326a3ecdb9d1ca70';
const hash=s=>{const b=Buffer.from(s,'utf8');
 return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
function once(s,a,b,label) {
 assert.equal(s.split(a).length,2,'ISSUE860_9292_SOURCE_DRIFT_'+label);
 return s.replace(a,b);
}
function editFunction(s,name,edit) {
 const i=s.indexOf('function '+name+'('),j=s.indexOf('\n}',i);
 assert(i>=0&&j>i,'ISSUE860_9292_HANDLER_MISSING_'+name);
 const before=s.slice(i,j+2),after=edit(before);
 assert.notEqual(before,after,'ISSUE860_9292_HANDLER_UNCHANGED_'+name);
 return s.slice(0,i)+after+s.slice(j+2);
}
export function composeIssue860Gas9292CloseStatePreview() {
 const previous=composeIssue860Gas9291Preview(),parent=previous.source;
 assert.equal(hash(parent),PARENT_SHA,'ISSUE860_9291_PARENT_DRIFT');
 let source=parent;
 source=once(source,
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.291',
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.292','VERSION_HEADER');
 source=once(source,
  '//  v9.291 마감과 펀드 비동기 상태 분리 (배포 전 검증 후보):',
  [
   '//  v9.292 종가 마감과 펀드 공시 대기의 읽기 전용 판정 분리 (검토 후보):',
   '//  • 정확한 종가 PRICE/Snapshot 완료는 NAV PENDING과 별도 표시',
   '//  • 소유권과 예약이 유효한 NAV PENDING만 WARNING (실제 오류는 ERROR)',
   '//  • 9.291 NAV 후속/Watchdog·원장·가격/펀드 Writer 모두 불변',
   '//',
   '//  v9.291 마감과 펀드 비동기 상태 분리 (배포 전 검증 후보):'
  ].join('\n'),'CHANGELOG');
 source=editFunction(source,'_getAutomationStatusData',f=>{
   f=once(f,
     '  var closeErrors = portfolioClose && Array.isArray(portfolioClose.errors) ? portfolioClose.errors : [];',
     `  var closeErrors = portfolioClose && Array.isArray(portfolioClose.errors) ? portfolioClose.errors : [];
  // PRICE confirmation is independent of the later fund NAV publication.
  // Only the matching CLOSE owner and a durable positive row count qualify.
  var priceCloseConfirmed = !!portfolioClose && portfolioClose.priceOk === true
    && Number(portfolioClose.priceRows) > 0 && !!_normalizeDate(portfolioClose.priceDate)
    && !!portfolioClose.runId
    && String(portfolioClose.runId) === String(props.getProperty('portfolio_close_run_id') || '')
    && String(portfolioClose.runDate) === String(props.getProperty('portfolio_close_run_date') || '')
    && String(portfolioClose.runDate) === String(closeRun.runDate || '');
  var navPendingVerified = false;
  if (priceCloseConfirmed && !portfolioCloseRunStale
      && closeRun.stage === 'FUND_PENDING' && portfolioClose.fundOk !== true
      && !!portfolioClose.fundBusyTriggerId && !fundLastError
      && !portfolioCloseLastError && closeErrors.length === 0) {
    // Never downgrade a missing, exhausted or wrong-owner NAV reservation.
    var navRoot = parseProperty(PORTFOLIO_FUND_SCHEDULE_KEY);
    var navReservations = navRoot
      ? [navRoot].concat(Array.isArray(navRoot.additional) ? navRoot.additional : []) : [];
    var navNow = Date.now();
    navPendingVerified = navReservations.some(function(item) {
      return item && item.date === portfolioClose.runDate
        && String(item.triggerId || '') === String(portfolioClose.fundBusyTriggerId)
        && item.owner && String(item.owner.runId || '') === String(portfolioClose.runId)
        && Number(item.owner.startedMs || 0) > 0
        && Number(item.owner.startedMs) === Number(portfolioClose.startedMs)
        && ((Number(item.until || 0) > navNow && Number(item.attempts || 0) < 3)
          || Number(item.activeUntil || 0) > navNow);
    });
  }`,
     'INDEPENDENT_PRICE_AND_PENDING_NAV');
   f=once(f,
     "  else if (closeRun.state === 'INCOMPLETE') overallStatus = 'INCOMPLETE';",
     "  else if (closeRun.state === 'INCOMPLETE') overallStatus = fundLastError ? 'ERROR' : navPendingVerified ? 'WARNING' : 'INCOMPLETE';\n  else if (closeRun.state === 'ERROR') overallStatus = 'ERROR';",
     'OVERALL_STATUS_NO_FALSE_FAILURE');
   f=once(f,
     '    portfolioClose: portfolioClose,\n    closeRun: closeRun,',
     `    portfolioClose: portfolioClose,
    closeRun: closeRun,
    priceCloseState: priceCloseConfirmed ? 'COMPLETE' : 'INCOMPLETE',
    fundCloseState: portfolioClose && portfolioClose.fundOk === true
      ? 'DONE' : navPendingVerified ? 'PENDING' : 'NOT_COMPLETE',
    fundReservationVerified: navPendingVerified,`,
     'READONLY_DIAGNOSTIC_FIELDS');
   return f;
 });
 // Prevent status probes from allocating Writer Gate tokens. These endpoints
 // are authenticated metadata reads, not financial writers.
 source=editFunction(source,'_issue507GateInvoke_',f=>
   once(f,
     "  if(_issue507GateInside_)return fn.apply(self,args);",
     `  if ((name==='doPost'||name==='doGet') && args[0]
      && args[0].parameter && args[0].parameter.action==='getAutomationStatus') {
    var wasInside=_issue507GateInside_;
    _issue507GateInside_=true;
    try { return fn.apply(self,args); }
    finally { _issue507GateInside_=wasInside; }
  }
  if(_issue507GateInside_)return fn.apply(self,args);`,
     'AUTHENTICATED_READ_NO_WRITER_TOKEN'));
 // Apps Script has a documented six-minute standard and up to 30-minute
 // runtime for some Workspace accounts. Keep a 45-minute upper bound before
 // retiring a stranded execution receipt, with durable UNCONFIRMED audit.
 // This is NOT proof that the business operation completed successfully.
 source=editFunction(source,'_issue507GateReconcile_',f=>
   once(f,
     '  if(ended.length)_issue507GateSave_(props,s);',
     `  if(ended.length)_issue507GateSave_(props,s);
  var now=Date.now(),maxProcessAgeMs=45*60*1000;
  var expired=[];
  Object.keys(s.active).forEach(function(token) {
    var owner=s.active[token];
    if(!owner || !Number.isFinite(owner.startedAt)
       || now-owner.startedAt<=maxProcessAgeMs) return;
    // A terminal producer receipt is handled above; never mask one.
    if(props.getProperty(_issue507GateEndKey_(token))) return;
    var key='issue507_writer_expired_unconfirmed_v1_'+token;
    var prior=props.getProperty(key);
    if(prior) {
      var saved=JSON.parse(prior);
      if(saved.releaseId!==s.releaseId||saved.token!==token
         ||saved.name!==owner.name||saved.startedAt!==owner.startedAt
         ||saved.state!=='EXPIRED_UNCONFIRMED')
        throw new Error('GATE_EXPIRED_AUDIT_CONFLICT');
    } else {
      var evidence=JSON.stringify({releaseId:s.releaseId,token:token,
        name:owner.name,startedAt:owner.startedAt,expiredAt:now,
        state:'EXPIRED_UNCONFIRMED',producerReceipt:false});
      props.setProperty(key,evidence);
      if(props.getProperty(key)!==evidence)
        throw new Error('GATE_EXPIRED_AUDIT_WRITE_UNVERIFIED');
    }
    // Expiry is a separate terminal *lease* state, not an ENDED receipt.
    // Leave financial journals, NAV markers and CLOSE statuses untouched.
    delete s.active[token];expired.push(token);
  });
  if(expired.length) {
    s.expiredUnconfirmedCount=Number(s.expiredUnconfirmedCount||0)+expired.length;
    _issue507GateSave_(props,s);
  }`,
     'ATOMIC_STALE_TOKEN_AUDIT_AND_RETIRE'));
 // Authenticated read-only Gate health should tell an operator WHAT is
 // occupying the Gate, not merely a count. Never expose owner tokens.
 source=editFunction(source,'_issue507GateStatusRequest_',f=>
   once(f,
     "      var s=_issue507GateRead_(props);",
     `      var s=_issue507GateRead_(props);
      var now=Date.now(),timeoutMs=45*60*1000;
      var owners=Object.keys(s.active).map(function(token) {
        var owner=s.active[token],ms=now-Number(owner.startedAt||0);
        var receiptPresent=!!props.getProperty(_issue507GateEndKey_(token));
        return {
          functionName:String(owner.name||'UNKNOWN').slice(0,100),
          startedKst:Utilities.formatDate(new Date(owner.startedAt),
            'Asia/Seoul','yyyy-MM-dd HH:mm:ss'),
          ageMinutes:Math.max(0,Math.floor(ms/60000)),
          terminalReceiptPresent:receiptPresent,
          retirementEligible:ms>timeoutMs&&!receiptPresent
        };
      });`,
     'GATE_OWNER_SAFE_DIAGNOSTIC'));
 source=editFunction(source,'_issue507GateStatusRequest_',f=>
   once(f,
     "        activeCount:Object.keys(s.active).length,finished:s.finished,",
     `        activeCount:Object.keys(s.active).length,finished:s.finished,
        activeOwners:owners,
        timeoutRetirementCandidates:owners.filter(function(e){
          return e.retirementEligible;
        }).length,
        expiredUnconfirmedCount:Number(s.expiredUnconfirmedCount||0),`,
     'GATE_STATUS_STRUCTURED_OWNERS'));
 const count=source.split("gasVersion: '9.291'").length-1;
 assert(count>=5&&count<=20,'ISSUE860_9292_VERSION_COUNT_'+count);
 source=source.replaceAll("gasVersion: '9.291'","gasVersion: '9.292'");
 source=once(source,"var ISSUE507_GATE_API_VERSION='9.291'",
   "var ISSUE507_GATE_API_VERSION='9.292'",'GATE_API_VERSION');
 return {parent,source,manifest:{
  parentVersion:'9.291',candidateVersion:'9.292',
  parentGitBlob:PARENT_SHA,candidateGitBlob:hash(source),
  changedFunctions:['_getAutomationStatusData','_issue507GateInvoke_',
    '_issue507GateReconcile_','_issue507GateStatusRequest_'],
  changedFinancialWriters:[],changedWatchdogFunctions:[],
  timeoutGateRetirementMinutes:45,expiredProducerReceiptFaked:false,
  readOnlyStatusDoesNotEnterGate:true,
  gateOwnerReadOnlyDiagnostics:true,
  navPublicationSeparate:true,existingCloseCompletePreserved:true,
  sourceOnly:true,deployable:false,
  financeWrites:0,gasRequests:0,gasDeployments:0
 }};
}
