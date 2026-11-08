// Read-only v9.285 candidate: avoid unnecessary fund writer lock on a
// fully reconciled period. The reviewed 9.284 production source stays pinned.
// Produces source in memory only. NEVER publishes, writes Sheets or sends.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const BASE_BLOB='b5b1c7fd5a27454419ddd6d12ecb20751c207c63';
const blob=s=>{
 const bytes=Buffer.from(s,'utf8');
 return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
};
function replaceOne(src,a,b,label){
 if(src.split(a).length!==2)throw Error('GAS9285_SOURCE_ANCHOR_DRIFT:'+label);
 return src.replace(a,b);
}
export function composeGas9285FundNoopPreview(){
 const worktree=fs.readFileSync('src/gas/apps_script.gs','utf8');
 let base=worktree;
 if(blob(base)!==BASE_BLOB){
  // PR merge refs may carry newer main GAS. Never use it as a source for
  // this 9.284-based preview; resolve only the reviewed historical blob.
  try{
   base=execFileSync('git',['cat-file','blob',BASE_BLOB],
    {encoding:'utf8',maxBuffer:32*1024*1024});
  }catch{
   try{
    execFileSync('git',['fetch','--no-tags','--depth=1','origin',
     'refs/heads/fix/734-foreign-trade-fx-server-roundtrip-20261107'],
     {stdio:'pipe',timeout:30000,maxBuffer:1024*1024});
    base=execFileSync('git',['cat-file','blob',BASE_BLOB],
     {encoding:'utf8',maxBuffer:32*1024*1024});
   }catch{
    throw Error('GAS9285_FUND_APPROVED_BLOB_UNAVAILABLE expected='+BASE_BLOB+
     ' worktree='+blob(worktree));
   }
  }
 }
 if(blob(base)!==BASE_BLOB)throw Error('GAS9285_UNREVIEWED_BASE expected='+BASE_BLOB+' actual='+blob(base));
 let src=base;
 const old=`  // 검증과 외부 조회를 모두 마친 뒤 누락만 추가합니다. 재시도는 기존 저장값을 사용합니다.
  // 외부 HTTP·NAV 파싱·평가 계산은 lock 밖에서 완료합니다.
  // 동시 실행에서 중복 추가를 막기 위해 쓰기 직전 최신 상태를 다시 읽습니다.
  var writeLock = LockService.getScriptLock();`;
 const change=`  // No derived row needs processing: a repeated 19:00/20:30 close must not
  // acquire the global writer lock or reread NAV/price/Snapshot merely to
  // confirm that the already-verifiable fund rows are unchanged.
  // Missing official publication and partial statuses are still retained.
  if (values.length === 0) {
    _fundRecoveryDiagnosticStart(diagnostic, onlyCode, 'resultAggregate', '_refreshFundValuations');
    var unchanged = {
      continuation:false, deferredSnapshotDates:0,
      completionStatus:Object.keys(fundResults).some(function(code) {
        return fundResults[code].status !== 'ok';
      }) ? 'partial' : 'ok',
      saved:0, navSaved:0, snapshots:0,
      processing:{
        nav:{processed:0,pending:Object.keys(fundResults).reduce(function(sum,code) {
          return sum + Number(fundResults[code].navMissing || 0);
        },0)},
        priceHistory:{processed:0,pending:0},
        snapshots:{processed:0,pending:0,reasons:[]}
      },
      missingHoldings:[],snapshotWarnings:[],lastDate:'',fundResults:fundResults
    };
    _fundRecoveryDiagnosticFinish(diagnostic,'end');
    return unchanged;
  }
`+old;
 src=replaceOne(src,old,change,'NOOP_FUND_WRITER');
 src=replaceOne(src,'//  📊 포트폴리오 대시보드 — Google Apps Script  v9.284',
   '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.285','VERSION_HEADER');
 src=replaceOne(src,'//  v9.284 변경사항 (2026.11.06):',
   `//  v9.285 변경사항 (2026.11.07):
//  • 펀드 재검산에서 변경 대상 0건이면 글로벌 writer 잠금·전체 NAV 재조회 생략
//  • NAV 미공표·partial 경고 보존, 실제 금융변경 경로의 잠금·백업·검증 유지
//  • 후보 검증 전 운영 GAS v9.284 유지; 별도 승인 없이 배포 금지
//
//  v9.284 변경사항 (2026.11.06):`, 'VERSION_CHANGELOG');
 if(src.split("gasVersion: '9.284'").length!==10)
   throw Error('GAS9285_EXPECTED_VERSION_FIELDS_CHANGED');
 src=src.replaceAll("gasVersion: '9.284'","gasVersion: '9.285'");
 src=replaceOne(src,"var ISSUE507_GATE_API_VERSION='9.284'",
   "var ISSUE507_GATE_API_VERSION='9.285'",'GATE_API_VERSION');
 return {base,candidate:src,manifest:{
   parentVersion:'9.284',proposedVersion:'9.285',
   baseSourceGitBlob:BASE_BLOB,candidateSourceGitBlob:blob(src),
   status:'SOURCE_PREVIEW_NOT_DEPLOYABLE',
   financeWrites:0,gasProjectWrites:0,productionDeploymentApproved:false,
   requiresSeparateFullReleaseReview:true
 }};
}
