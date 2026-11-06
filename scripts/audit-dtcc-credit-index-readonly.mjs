import {pathToFileURL} from 'node:url';

// DTCC's public SEC credit swap index describes daily archives; it does NOT
// itself contain an executable 5Y market spread. This is source discovery,
// not the CDS pricing data collector.
const INDEX='https://kgc0418-tdw-data-0.s3.amazonaws.com/dashboard/Cumulative.json';
const MAX_BYTES=4000000;
export async function auditDtccCreditIndex({fetchImpl=fetch}={}){
 try{
  const response=await fetchImpl(INDEX,{
   method:'GET',redirect:'error',
   headers:{accept:'application/json'},
   signal:AbortSignal.timeout(15000)
  });
  if(!response?.ok)return {status:'DTCC_INDEX_HTTP_UNAVAILABLE',creditArchiveCount:null};
  const mime=String(response.headers?.get?.('content-type')||'').toLowerCase();
  // DTCC's S3-hosted JSON can be labelled as generic binary. The fixed
  // official archive index URL and strict JSON schema are required either way.
  if(!mime.includes('json')&&!mime.includes('octet-stream')
   &&!mime.includes('text/plain'))
   return {status:'DTCC_INDEX_CONTENT_TYPE_UNVERIFIED',
    observedMime:mime.slice(0,60),creditArchiveCount:null};
  const length=Number(response.headers?.get?.('content-length'));
  if(Number.isFinite(length)&&length>MAX_BYTES)
   return {status:'DTCC_INDEX_TOO_LARGE',creditArchiveCount:null};
  // Explicit cap even if Content-Length was missing or unreliable.
  const body=await response.text();
  if(body.length>MAX_BYTES)
   return {status:'DTCC_INDEX_TOO_LARGE',creditArchiveCount:null};
  const parsed=JSON.parse(body);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)
   ||!Array.isArray(parsed.SEC_CR))
   return {status:'DTCC_SEC_CREDIT_INDEX_SCHEMA_UNVERIFIED',creditArchiveCount:null,
    observedTopLevelFields:parsed&&typeof parsed==='object'
     ?Object.keys(parsed).length:null};
  const rows=parsed.SEC_CR;
  if(rows.length===0)return {status:'DTCC_CREDIT_INDEX_EMPTY',creditArchiveCount:0};
  if(rows.length>15000)return {status:'DTCC_INDEX_TOO_LARGE',creditArchiveCount:null};
  return {status:'DTCC_CREDIT_ARCHIVE_INDEX_AVAILABLE',
   creditArchiveCount:rows.length,
   latestIndexShape:rows.at(0)&&typeof rows.at(0)==='object'
    ?Object.keys(rows.at(0)).sort().slice(0,30):[],
   // A file index doesn't prove any one of the 11 issuers traded.
   companyCdsVerified:0,exact5ySpreadsVerified:0};
 }catch{return {status:'DTCC_INDEX_FETCH_OR_PARSE_FAILED',creditArchiveCount:null};}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 console.log(JSON.stringify({mode:'DTCC_SEC_CREDIT_INDEX_READ_ONLY',
  ...await auditDtccCreditIndex(),
  portfolioWrites:0,telegramSends:0,gasDeployments:0}));
}
