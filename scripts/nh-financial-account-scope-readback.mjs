// Local structural validation of the future 9.305 account-scope diagnostic.
// No NH requests, financial data import, or tax calculation.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
const fail=()=>{throw Error('NH_ACCOUNT_SCOPE_UNVERIFIED');};
const keys=[
 'status','provider','gasVersion','mode','readOnly','diagnosticOnly',
 'accountListVerified','accountOwnershipVerified','accountTaxTypeVerified',
 'annualIncomeVerified','fullYearCoverage','financialTaxClassificationVerified',
 'financialOriginalWritten','tokenIssued','bearerExposed','transactionQueries',
 'accountCounts','totalAccounts'
];
const exactKeys=(x,list)=>x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).sort().join('|')===list.slice().sort().join('|');
const validCount=n=>Number.isSafeInteger(n)&&n>=0&&n<=10000;
export function assessNhAccountScope(data){
 if(!exactKeys(data,keys)||data.status!=='ok'||data.provider!=='NH'||
 data.gasVersion!=='9.305'||data.mode!=='ACCOUNT_SCOPE_ONLY'||
 data.readOnly!==true||data.diagnosticOnly!==true||data.accountListVerified!==true||
 data.accountOwnershipVerified!==false||data.accountTaxTypeVerified!==false||
 data.annualIncomeVerified!==false||data.fullYearCoverage!==false||
 data.financialTaxClassificationVerified!==false||data.financialOriginalWritten!==false||
 data.tokenIssued!==false||data.bearerExposed!==false||data.transactionQueries!==0)fail();
 const c=data.accountCounts;
 if(!exactKeys(c,['operating01','operating02','simulation03'])||
 ![c.operating01,c.operating02,c.simulation03,data.totalAccounts].every(validCount)||
 c.operating01+c.operating02+c.simulation03!==data.totalAccounts)fail();
 const state=c.operating02>0?'OPERATING_02_REQUIRES_OWNERSHIP_REVIEW':
   c.operating01>0?'ONLY_OPERATING_01_VISIBLE':'NO_OPERATING_01_OR_02_VISIBLE';
 // Reconstruct safe counters only. Never expose accounts or raw payload.
 return {kind:'NH_ACCOUNT_SCOPE_READONLY',state,gasVersion:'9.305',
  operating01:c.operating01,operating02:c.operating02,simulation03:c.simulation03,
  totalAccounts:data.totalAccounts,transactionQueries:0,accountOwnershipVerified:false,
  accountTaxTypeVerified:false,annualIncomeVerified:false,financialWrites:0,tokenIssued:false};
}

export async function probeNhFinancialAccountScope({url,token,fetchImpl=fetch}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)fail();
 let response;
 try{
  response=await fetchImpl(endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   redirect:'follow',signal:AbortSignal.timeout(60000),
   body:new URLSearchParams({action:'diagnoseNhFinancialIncome',mode:'accountScope',accessToken:token})});
 }catch{fail();}
 if(response?.ok!==true)fail();
 let data;try{data=await response.json();}catch{fail();}
 return assessNhAccountScope(data);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='cyyoung111-dev/portfolio')fail();
  const proof=await probeNhFinancialAccountScope({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN});
  console.log(JSON.stringify(proof));
  if(proof.operating02>0)console.warn('::warning::NH operational type 02 exists. Ownership and tax attribution remain unverified; do not include in personal income.');
 }catch{
  console.error('NH_ACCOUNT_SCOPE_UNVERIFIED');
  process.exitCode=2;
 }
}
