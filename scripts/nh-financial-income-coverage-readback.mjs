// Validate coverage evidence independently; never aggregate monetary amounts.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
const fail=()=>{throw Error('NH_FINANCE_COVERAGE_UNVERIFIED');};
const integer=(n,max=1000000)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
const successes=new Set(['ROWS_OBSERVED','EMPTY_ARRAY','EMPTY_WITH_CONTINUATION','NO_DATA_REPORTED']);
const rejected=new Set(['TOKEN_EXPIRES','HTTP_401','HTTP_403','HTTP_429','HTTP_OTHER','NETWORK_UNVERIFIED','INVALID_JSON','SUCCESS_MESSAGE_UNVERIFIED','OUTPUT_MISSING','OUTPUT_INVALID']);
function date(s){
 if(typeof s!=='string'||!/^\d{8}$/.test(s))fail();
 const y=+s.slice(0,4),m=+s.slice(4,6),d=+s.slice(6,8),v=new Date(Date.UTC(y,m-1,d));
 if(v.getUTCFullYear()!==y||v.getUTCMonth()!==m-1||v.getUTCDate()!==d)fail();
 return v;
}
const fmt=v=>v.toISOString().slice(0,10).replace(/-/g,'');
export function assessNhFinancialCoverage(d,{expectedVersion='9.303',asOf}={}){
 if(d?.status!=='ok'||d.provider!=='NH'||d.gasVersion!==expectedVersion||!['9.303','9.304','9.305'].includes(expectedVersion)||
 d.readOnly!==true||d.diagnosticOnly!==true||d.accountListVerified!==true||
 (d.annualIncomeVerified!==undefined&&d.annualIncomeVerified!==false)||
 ['tokenIssued','bearerExposed','financialOriginalWritten','financialTaxClassificationVerified','accountTaxTypeVerified','fullYearCoverage'].some(k=>d[k]!==false))fail();
 const newer=expectedVersion==='9.304'||expectedVersion==='9.305';
 const rejectedForVersion=new Set([...rejected,...(newer?['CONTINUATION_UNVERIFIED']:[])]);
 const today=date(d.asOf);if(asOf!==undefined&&d.asOf!==asOf)fail();
 const month=today.getUTCMonth()+1,year=today.getUTCFullYear();
 if(!['NONE','QUERY_LIMIT',...rejectedForVersion].includes(d.stopped)||!Array.isArray(d.windows)||d.windows.length>16||
 !['ownLiveAccounts','otherAccountsSkipped','accountsStarted','accountsSampled'].every(k=>integer(d[k]))||
 d.accountsSampled>d.accountsStarted||d.accountsStarted>d.ownLiveAccounts||d.accountsStarted-d.accountsSampled>1)fail();
 const totals={rows:0,totalRows:0,depositRows:0,interestFieldRows:0,positiveInterestFieldRows:0,taxFieldRows:0,noDataWindows:0,continuationWindows:0,invalidDateWindows:0};
 let ordinal=1,m=month,found=false,cts=false,sampled=0,started=0,failed=false;
 const result=Array.from(d.windows,(w,i)=>{
  const keys=['accountOrdinal','route','from','to','status','rows','validDatedRows','interestFieldRows','positiveInterestFieldRows','taxFieldRows','descriptionPresentRows','continuation','evidence',...(newer?['pagination']:[])];
  if(!w||typeof w!=='object'||Array.isArray(w)||Object.keys(w).length!==keys.length||!keys.every(k=>Object.hasOwn(w,k)))fail();
  const counts=keys.slice(5,11);
  if(!counts.every(k=>integer(w[k]))||counts.slice(1).some(k=>w[k]>w.rows)||w.positiveInterestFieldRows>w.interestFieldRows||
    typeof w.continuation!=='boolean'||w.accountOrdinal!==ordinal||ordinal>d.ownLiveAccounts||failed)fail();
  started=ordinal;
  const kind=m>0?'TOTAL':'DEPOSIT';
  if(w.route!==kind||w.from!==(kind==='TOTAL'?fmt(new Date(Date.UTC(year,m-1,1))):fmt(new Date(today.getTime()-29*86400000)))||
    w.to!==(kind==='TOTAL'&&m!==month?fmt(new Date(Date.UTC(year,m,0))):d.asOf))fail();
  if(kind==='DEPOSIT'&&(w.interestFieldRows||w.positiveInterestFieldRows||w.taxFieldRows))fail();
  const e=w.evidence;
  if(e!==null&&(!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).sort().join(',')!=='code,envelope,messageClass,outputClass'||
    typeof e.code!=='string'||!/^(?:[0-9]{5}|IGW[0-9]{5}|ABSENT|UNRECOGNIZED|CONFLICT)$/.test(e.code)||
    !['TOP','NESTED','BOTH','ABSENT'].includes(e.envelope)||!['COMPLETE','NO_DATA_REPORTED','OTHER','ABSENT','CONFLICT'].includes(e.messageClass)||
    !['MISSING','INVALID','NONEMPTY_ARRAY','EMPTY_ARRAY'].includes(e.outputClass)))fail();
  if(newer){
   const p=w.pagination;
   if(!e){if(p!==null)fail();}
   else{
    if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='flagClass,keyClass,state'||
      !['HEADER','BODY','ABSENT'].includes(p.keyClass)||!['Y','N','OTHER','ABSENT'].includes(p.flagClass)||
      !['LAST','NEXT','UNVERIFIED'].includes(p.state))fail();
    if(p.state!=='UNVERIFIED'){
     const hasKey=p.keyClass!=='ABSENT',moreCode=['00165','00218','XA109'].includes(e.code);
     const expected=p.flagClass==='N'?'LAST':p.flagClass==='Y'||moreCode?hasKey?'NEXT':'UNVERIFIED':
       p.flagClass==='OTHER'?'UNVERIFIED':p.keyClass==='BODY'?'NEXT':'LAST';
     if(p.state!==expected)fail();
    }
    if(successes.has(w.status)&&(p.state==='UNVERIFIED'||w.continuation!==(p.state==='NEXT')))fail();
    if(w.status==='CONTINUATION_UNVERIFIED'&&!(p.state==='UNVERIFIED'||e.code==='13578'&&e.messageClass==='NO_DATA_REPORTED'&&e.outputClass==='EMPTY_ARRAY'&&p.state==='NEXT'))fail();
   }
  }
  if(successes.has(w.status)){
   if(!e)fail();
   if(w.status==='NO_DATA_REPORTED'){
    if(e.code!=='13578'||e.messageClass!=='NO_DATA_REPORTED'||e.outputClass!=='EMPTY_ARRAY'||w.rows||w.continuation)fail();
   }else{
    if(e.messageClass!=='COMPLETE'||!/^\d{5}$/.test(e.code)||['13578','11512','16935'].includes(e.code)||
      e.outputClass!==(w.rows?'NONEMPTY_ARRAY':'EMPTY_ARRAY')||
      w.status!==(w.rows?'ROWS_OBSERVED':w.continuation?'EMPTY_WITH_CONTINUATION':'EMPTY_ARRAY'))fail();
   }
   totals.rows+=w.rows;totals[kind==='TOTAL'?'totalRows':'depositRows']+=w.rows;
   for(const k of ['interestFieldRows','positiveInterestFieldRows','taxFieldRows'])totals[k]+=w[k];
   if(w.status==='NO_DATA_REPORTED')totals.noDataWindows++;
   if(w.continuation)totals.continuationWindows++;
   if(w.validDatedRows!==w.rows)totals.invalidDateWindows++;
   if(w.rows)found=true;if(w.continuation)cts=true;
   if(kind==='DEPOSIT'||(--m===0&&(found||cts))){sampled++;ordinal++;m=month;found=false;cts=false;}
  }else{
   if(!rejectedForVersion.has(w.status)||w.rows||w.continuation||i!==d.windows.length-1||d.stopped!==w.status)fail();
   if(['SUCCESS_MESSAGE_UNVERIFIED','OUTPUT_MISSING','OUTPUT_INVALID','CONTINUATION_UNVERIFIED'].includes(w.status)?!e:e!==null)fail();
   failed=true;
  }
  // Reconstruct explicit safe fields rather than echo caller objects.
  return Object.fromEntries(keys.map(k=>[k,k==='evidence'&&e?{code:e.code,envelope:e.envelope,messageClass:e.messageClass,outputClass:e.outputClass}:k==='pagination'&&w.pagination?{keyClass:w.pagination.keyClass,flagClass:w.pagination.flagClass,state:w.pagination.state}:w[k]]));
 });
 if(started!==d.accountsStarted||sampled!==d.accountsSampled||
   (d.stopped==='NONE'&&(sampled!==d.ownLiveAccounts||failed))||
   (d.stopped==='QUERY_LIMIT'&&(d.windows.length!==16||sampled===d.ownLiveAccounts||failed))||
   (rejectedForVersion.has(d.stopped)&&!failed))fail();
 const contractStatus=d.stopped!=='NONE'?'PARTIAL_COVERAGE_SAMPLE':!d.ownLiveAccounts?'NO_SELF_OWNED_ACCOUNTS':
 totals.invalidDateWindows?'FIELD_DATES_UNVERIFIED':totals.totalRows?'TOTAL_ROWS_OBSERVED':totals.depositRows?'DEPOSIT_ROWS_ONLY':
 totals.continuationWindows?'CONTINUATION_UNVERIFIED':'NO_ROWS_REPORTED_YEAR_TO_DATE';
 return {kind:'NH_FINANCIAL_COVERAGE_READONLY',gasVersion:expectedVersion,asOf:d.asOf,contractStatus,ownLiveAccounts:d.ownLiveAccounts,
 otherAccountsSkipped:d.otherAccountsSkipped,accountsSampled:sampled,accountsStarted:started,stopped:d.stopped,
 queryCount:result.length,...totals,windows:result,sampleOnly:true,annualIncomeVerified:false,fullYearCoverage:false,
 accountTaxTypeVerified:false,financialTaxClassificationVerified:false,financeWrites:0,tokenIssued:false};
}
// A complete read-only no-data *sample* is not a failed GAS deployment.
 // Never equate the sample with verified annual zero or tax eligibility.
export function assessNhFinancialCoverageStep(p){
 if(!p||p.kind!=='NH_FINANCIAL_COVERAGE_READONLY'||p.annualIncomeVerified!==false||
    p.fullYearCoverage!==false||p.financialTaxClassificationVerified!==false||
    p.accountTaxTypeVerified!==false||p.financeWrites!==0||p.tokenIssued!==false)fail();
 if(p.contractStatus==='TOTAL_ROWS_OBSERVED'&&p.totalRows>0&&p.stopped==='NONE')
  return {kind:'ROWS_OBSERVED_SAMPLE_ONLY',exitCode:0,annualIncomeVerified:false};
 if(p.contractStatus==='NO_ROWS_REPORTED_YEAR_TO_DATE'&&p.stopped==='NONE'&&
    p.ownLiveAccounts>0&&p.accountsSampled===p.ownLiveAccounts&&
    p.rows===0&&p.totalRows===0&&p.depositRows===0&&p.queryCount>0)
  return {kind:'NO_ROWS_REPORTED_WARNING',exitCode:0,annualIncomeVerified:false};
 return {kind:'COVERAGE_UNVERIFIED',exitCode:2,annualIncomeVerified:false};
}

export async function probeNhFinancialCoverage({url,token,fetchImpl=fetch,asOf,expectedVersion='9.305'}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)fail();
 let r;try{r=await fetchImpl(endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},redirect:'follow',
 signal:AbortSignal.timeout(180000),body:new URLSearchParams({action:'diagnoseNhFinancialIncome',mode:'coverage',accessToken:token})});}catch{fail();}
 if(r?.ok!==true)fail();let d;try{d=await r.json()}catch{fail();}
 return assessNhFinancialCoverage(d,{asOf,expectedVersion});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='cyyoung111-dev/portfolio')fail();
  const asOf=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replace(/-/g,'');
  const p=await probeNhFinancialCoverage({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,asOf,expectedVersion:process.env.NH_FINANCE_EXPECTED_VERSION||'9.305'});
  console.log(JSON.stringify(p));
  const verdict=assessNhFinancialCoverageStep(p);
  console.log(JSON.stringify({kind:'NH_FINANCIAL_COVERAGE_STEP',...verdict}));
  if(verdict.kind==='NO_ROWS_REPORTED_WARNING')
   console.warn('::warning::NH returned no rows in the bounded read-only sample. Annual financial income and tax classification remain UNVERIFIED; GAS deployment itself succeeded.');
  if(verdict.exitCode)process.exitCode=verdict.exitCode;
 }catch{console.error('NH_FINANCE_COVERAGE_UNVERIFIED');process.exitCode=2;}
}
