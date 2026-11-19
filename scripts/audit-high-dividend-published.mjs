// Read-only portfolio comparison using the already published KIND catalog.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {verifyCatalog} from './publish-high-dividend-catalog.mjs';
import {auditFromGas} from './audit-high-dividend-universe.mjs';
const fail=reason=>{throw Error('HIGH_DIVIDEND_PUBLISHED_AUDIT_'+reason);};
export function expectedBusinessYear(now=new Date()){
 const y=Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Asia/Seoul'}).format(now))-1;
 if(!Number.isInteger(y)||y<2025||y>2028)fail('YEAR');
 return y;
}
export function preparePublishedCandidate(catalog,now=new Date()){
 try{verifyCatalog(catalog);}catch{fail('CATALOG');}
 if(catalog.businessYear!==expectedBusinessYear(now))fail('YEAR');
 const ageMs=now.getTime()-Date.parse(catalog.retrievedAt);
 // Weekly catalog publication; allow one missed update but never treat old
 // company evidence as a current determination.
 if(!Number.isFinite(ageMs)||ageMs<0||ageMs>14*86400000)fail('STALE');
 const review=catalog.recheckCodes;
 if(!Array.isArray(review)||new Set(review).size!==review.length||
 !review.every(code=>typeof code==='string'&&/^(?:\d{6}|\d{4}[A-Z]\d)$/.test(code)))fail('REVIEW');
 return {candidateIndex:{classification:'CANDIDATE_ONLY',matched:catalog.rows,unresolved:catalog.unresolved},
  catalogBusinessYear:catalog.businessYear,catalogRetrievedAt:new Date(catalog.retrievedAt).toISOString(),correctionReviewCount:review.length};
}
export async function auditPublishedCatalog({catalog,now=new Date(),url,token,fetchImpl,delay,report}={}){
 const {candidateIndex,...meta}=preparePublishedCandidate(catalog,now);
 const proof=await auditFromGas({url,token,candidateIndex,fetchImpl,delay,report});
 if(proof.businessYear!==meta.catalogBusinessYear||proof.officialMatchedIssuerCodes!==candidateIndex.matched.length||
 proof.officialUnresolvedIssuers!==candidateIndex.unresolved.length||proof.taxEligibilityVerified!==false||
 proof.financialOriginalWritten!==false||proof.atomicSnapshot!==false)fail('RECONCILIATION');
 return {...proof,...meta,kind:'HIGH_DIVIDEND_PUBLISHED_AUDIT',candidateOnly:true,financeWrites:0,catalogWrites:0};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 try{
  if(process.env.GITHUB_REPOSITORY!=='cyyoung111-dev/portfolio'||process.env.GITHUB_REF!=='refs/heads/main')fail('MAIN_ONLY');
  const now=new Date(),year=expectedBusinessYear(now);
  const catalog=JSON.parse(fs.readFileSync('published-kind/companies/'+year+'.json','utf8'));
  const p=await auditPublishedCatalog({catalog,now,url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,report:r=>console.log(JSON.stringify(r))});
  console.log(JSON.stringify(p));
 }catch(e){
  console.error(/^HIGH_DIVIDEND_(?:PUBLISHED_)?AUDIT_[A-Z_0-9]+$/.test(e?.message||'')?e.message:'HIGH_DIVIDEND_PUBLISHED_AUDIT_FAILED');
  process.exitCode=1;
 }
}
