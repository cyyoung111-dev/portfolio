#!/usr/bin/env node
// Read-only 9.298 NH response contract. No new OAuth token and no financial writes.
// Never print full upstream responses or infer annual income from this sample.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const fail=code=>{throw Error('NH_FINANCE_READBACK_'+code)};
const counts=['ownLiveAccounts','otherAccountsSkipped','accountsProbed','accountsSucceeded',
 'accountsRejected','rows','continuationPresent','validDatedRows','interestFieldRows',
 'positiveInterestFieldRows','taxFieldRows','krwRows','nonKrwOrMissingCurrencyRows','descriptionPresentRows'];
const goodInt=(n,max=1000000)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
const stopCodes=new Set(['NONE','ACCOUNT_LIMIT','TOKEN_EXPIRES','HTTP_401','HTTP_403','HTTP_429']);
export function assessNhFinancialIncomeReadback(data){
 if(data?.status!=='ok')fail('PROVIDER_UNVERIFIED');
 if(data.gasVersion!=='9.298'||data.provider!=='NH')fail('VERSION_OR_PROVIDER');
 if(data.readOnly!==true||data.diagnosticOnly!==true||data.tokenIssued!==false
    ||data.bearerExposed!==false||data.financialOriginalWritten!==false
    ||data.financialTaxClassificationVerified!==false||data.accountTaxTypeVerified!==false
    ||data.fullYearCoverage!==false||data.accountListVerified!==true)fail('CONTRACT');
 if(!counts.every(k=>goodInt(data[k]))||!stopCodes.has(data.stopped))fail('COUNTS');
 const d=data;
 if(d.accountsProbed>Math.min(d.ownLiveAccounts,12)
    ||d.accountsSucceeded+d.accountsRejected!==d.accountsProbed
    ||d.continuationPresent>d.accountsSucceeded
    ||d.positiveInterestFieldRows>d.interestFieldRows
    ||['validDatedRows','interestFieldRows','taxFieldRows','descriptionPresentRows'].some(k=>d[k]>d.rows)
    ||d.krwRows+d.nonKrwOrMissingCurrencyRows!==d.rows
    ||(!d.accountsSucceeded&&d.rows)
    ||(d.stopped==='NONE'&&d.accountsProbed!==d.ownLiveAccounts)
    ||(d.stopped==='ACCOUNT_LIMIT'&&(d.ownLiveAccounts<=12||d.accountsProbed!==12)))fail('INCONSISTENT');
 const contractStatus=d.stopped!=='NONE'||d.accountsRejected>0?'PARTIAL_ACCOUNT_SAMPLE'
   :!d.ownLiveAccounts?'NO_SELF_OWNED_ACCOUNTS'
   :!d.rows?'NO_SAMPLE_ROWS'
   :d.validDatedRows!==d.rows||!d.interestFieldRows||!d.taxFieldRows?'FIELDS_UNVERIFIED'
   :!d.positiveInterestFieldRows?'NO_POSITIVE_INTEREST_OBSERVED'
   :'FIELDS_OBSERVED';
 return {kind:'NH_FINANCIAL_INCOME_READONLY',gasVersion:'9.298',contractStatus,
   ...Object.fromEntries(counts.map(k=>[k,d[k]])),stopped:d.stopped,
   sampleHasContinuation:d.continuationPresent>0,fullYearCoverage:false,
   financialTaxClassificationVerified:false,accountTaxTypeVerified:false,
   annualIncomeVerified:false,financeWrites:0,tokenIssued:false};
}
export async function probeNhFinancialIncome({url,token,fetchImpl=fetch}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)fail('AUTH_MISSING');
 let response;
 try{response=await fetchImpl(endpoint,{method:'POST',
   headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   redirect:'follow',signal:AbortSignal.timeout(90000),
   body:new URLSearchParams({action:'diagnoseNhFinancialIncome',mode:'contract',accessToken:token})});}
 catch{fail('NETWORK_UNVERIFIED');}
 if(response?.ok!==true)fail('HTTP_UNVERIFIED');
 let data;
 try{data=await response.json();}catch{fail('JSON_UNVERIFIED');}
 return assessNhFinancialIncomeReadback(data);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='cyyoung111-dev/portfolio')fail('MAIN_ONLY');
  const proof=await probeNhFinancialIncome({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN});
  console.log(JSON.stringify(proof));
  if(proof.contractStatus!=='FIELDS_OBSERVED')process.exitCode=2;
 }catch(e){
  const msg=String(e?.message||'');
  console.error(/^NH_FINANCE_READBACK_[A-Z_]+$/.test(msg)?msg:'NH_FINANCE_READBACK_UNVERIFIED');
  process.exitCode=2;
 }
}
