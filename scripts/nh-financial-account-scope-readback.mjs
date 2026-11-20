// Local structural validation of the future 9.305 account-scope diagnostic.
// No NH requests, financial data import, or tax calculation.
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
