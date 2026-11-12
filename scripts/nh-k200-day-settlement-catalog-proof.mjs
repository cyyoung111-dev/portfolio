// Inspect the NH PLUG official PUBLIC domestic-futures OpenAPI catalog.
// No OAuth / account / order / market-price requests, GAS, Telegram or file writes.
// This establishes candidate endpoints and schema fields, NOT settlement finality.
import {pathToFileURL} from 'node:url';
const URL='https://www.nhplug.com/openapi-docs/krfuture/openapi.json';
const MAX=4_000_000;
const keywords=/(?:정산|전일|기준가|종가|결제|settle|settlement|preclose|close|prdy|sttl)/i;
const pathRule=/^\/krfuture\/(?:quote|inquiry)\/v\d+\/[a-zA-Z0-9_/-]+$/;
export function analyzeNhFutureCatalog(spec){
 if(!spec||typeof spec!=='object'||Array.isArray(spec)
  ||typeof spec.openapi!=='string'||!spec.openapi.startsWith('3.')
  ||!spec.paths||typeof spec.paths!=='object'
  ||Object.keys(spec.paths).length>1500)return null;
 const defs=spec.components?.schemas||{};
 const resolve=(node,seen=new Set())=>{
  if(!node||typeof node!=='object')return null;
  if(typeof node.$ref==='string'){
   const key=node.$ref.split('/').at(-1);
   if(!node.$ref.startsWith('#/components/schemas/')
    ||seen.has(key)||seen.size>8)return null;
   return resolve(defs[key],new Set([...seen,key]));
  }
  return node;
 };
 const collect=(node,depth=0,seen=new Set(),prefix='')=>{
  if(depth>7||seen.size>500)return [];
  const r=resolve(node);
  if(!r||typeof r!=='object')return [];
  const fields=[];
  if(r.properties&&typeof r.properties==='object'){
   for(const [key,field] of Object.entries(r.properties)){
    if(!/^[A-Za-z][A-Za-z0-9_]{0,64}$/.test(key))continue;
    const label=prefix?prefix+'.'+key:key;
    const hint=String(field?.description||field?.title||'');
    if(keywords.test(key)||keywords.test(hint))fields.push(label);
    if(depth<7 && typeof field==='object' && field && (field.properties||field.$ref||field.items||field.allOf))
     fields.push(...collect(field,depth+1,new Set([...seen,key]),label));
   }
  }
  if(r.items)fields.push(...collect(r.items,depth+1,seen,prefix+'[]'));
  if(Array.isArray(r.allOf))for(const item of r.allOf)fields.push(...collect(item,depth+1,seen,prefix));
  return fields;
 };
 const candidates=[];
 for(const [path,route] of Object.entries(spec.paths)){
  if(!pathRule.test(path)||!route||typeof route!=='object')continue;
  const op=route.post||route.get;
  if(!op||typeof op!=='object')continue;
  const text=[op.summary,op.description,op.operationId,path].filter(Boolean).join(' ');
  // Include only public quote/read endpoints likely relevant to dated
  // KOSPI200 day-session prices. Do not hit these authenticated endpoints.
  if(!/(?:주간|기간|일자|현재|선물|quote|period|daily|day)/i.test(text))continue;
  const responses=op.responses||{};
  const ok=responses['200']||responses['default'];
  const schemas=[];
  for(const content of Object.values(ok?.content||{})){
   if(content?.schema)schemas.push(content.schema);
  }
  const fields=[...new Set(schemas.flatMap(s=>collect(s)))].slice(0,70);
  candidates.push({
   path,method:route.post?'POST':'GET',
   hasExplicitSettlementField:fields.some(x=>/(?:settle|sttl|정산)/i.test(x)),
   potentialBaselineFields:fields.filter(x=>/(?:prdy|close|settle|sttl|cls|std|base)/i.test(x)).slice(0,20),
   // Exposing field names from the public schema is safe; never return values.
   fieldSignalCount:fields.length,
   responseSchemaPresent:schemas.length>0
  });
 }
 return {source:'NH_OFFICIAL_PUBLIC_KRFUTURE_CATALOG',
  scannedPaths:Object.keys(spec.paths).length,
  candidates:candidates.slice(0,35),count:candidates.length,
  actualPriceRetrieved:false,settlementFinalityVerified:false,
  activeNightContractVerified:false,pre0740AvailabilityVerified:false};
}
export async function inspectNhFutureCatalog({fetchImpl=fetch,log=console.log}={}){
 let status='FETCH_UNAVAILABLE';
 try{
  const res=await fetchImpl(URL,{method:'GET',redirect:'error',
   headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});
  if(!res?.ok){status='HTTP_'+String(res?.status||0);return {status};}
  const length=Number(res.headers?.get?.('content-length')||0);
  if(length>MAX)return {status:'DOC_TOO_LARGE'};
  const s=await res.text();
  if(s.length>MAX)return {status:'DOC_TOO_LARGE'};
  const r=analyzeNhFutureCatalog(JSON.parse(s));
  if(!r)return {status:'SCHEMA_UNVERIFIED'};
  return {status:'PUBLIC_CATALOG_PARSED',...r};
 }catch{return {status};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=await inspectNhFutureCatalog();
 console.log(JSON.stringify({kind:'NH_K200_DAY_SETTLEMENT_PUBLIC_CATALOG',...result}));
 if(result.status!=='PUBLIC_CATALOG_PARSED')process.exitCode=1;
}
