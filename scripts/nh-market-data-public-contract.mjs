// Public specification audit only. No broker API, account inquiry, token,
// order, GAS or ledger access. Existing quote readers remain authoritative.
import {pathToFileURL} from 'node:url';
const DOC='https://www.nhplug.com/openapi-docs/';
export const QUOTE_CONTRACTS=[
 ['krstock','currentPrice',['iem_cd','market_cd'],{Output_0:['object','stck_prpr']}],
 ['krstock','etfCurrent',['iem_cd'],{Output_0:['object','stck_prpr']}],
 ['krstock','currentDaily',['iem_cd','market_cd','array_cnt','view_main_yn'],{Output_0:['array','bsop_date','stck_clpr']}],
 ['gbstock','current',['iem_cd'],{Output_0:['object','iem_cd','trdprc','trade_date']}],
 ['gbstock','period',['iem_cd','end_dt','count','maxavg','gubun','xtick','today_cls','market_cls'],{Output_1:['array','trade_date','bsop_date','close_prc']}],
 ['gbstock','symbolIndexFxPeriod',['iem_cd','end_dt','array_cnt','maxavg','gubun','xtick','today_cls'],{Output_0:['object','iem_cd'],Output_1:['array','bsop_date','ovrs_prpr']}],
 ['gbfuture','current',['exnm','iem_cd'],{Output_0:['object','exnm','iem_cd','last','bday','tdtm','pcls','cur']}],
 ['gbfuture','symbolDetail',['exnm','iem_cd'],{Output_0:['object','exnm','iem_cd','zymd','oymd','cymd','frhm','tohm','uymd','uhms','cur1']}]
];
export function inspectMarketSpec(asset,spec){
 return QUOTE_CONTRACTS.filter(x=>x[0]===asset).map(([group,route,inputs,outputs])=>{
  const path='/'+group+'/quote/v1/'+route;
  const op=spec?.paths?.[path]?.post;
  const req=op?.requestBody?.content?.['application/json']?.schema?.properties?.Input_0;
  const resp=op?.responses?.['200']?.content?.['application/json']?.schema?.properties;
  const missingInputs=inputs.filter(k=>!Object.hasOwn(req?.properties??{},k));
  const extraRequired=(Array.isArray(req?.required)?req.required:[]).filter(k=>!inputs.includes(k));
  const missingOutputs=[];
  for(const [block,[type,...fields]] of Object.entries(outputs)){
   const b=resp?.[block];
   if(b?.type!==type){missingOutputs.push(block+':'+type);continue;}
   const props=type==='array'?b.items?.properties:b.properties;
   for(const field of fields)if(!Object.hasOwn(props??{},field))missingOutputs.push(block+'.'+field);
  }
  // Required fields not sent by the documented caller need review. The
  // report never auto-edits readers or promotes a schema into live data.
  return {path,role:group==='gbfuture'?'CANDIDATE':'EXISTING',
   status:op&&req&&resp&&!missingInputs.length&&!extraRequired.length&&!missingOutputs.length?'DOCUMENTED':'SCHEMA_REVIEW_REQUIRED',
   missingInputs,extraRequired,missingOutputs};
 });
}
export async function auditMarketSpecs(fetchImpl=fetch){
 const groups=['krstock','gbstock','gbfuture'];
 const rows=await Promise.all(groups.map(async asset=>{
  try{
   const response=await fetchImpl(DOC+asset+'/openapi.json',{method:'GET',redirect:'error',signal:AbortSignal.timeout(25000)});
   if(!response?.ok)return {asset,status:'SPEC_UNAVAILABLE',http:response?.status??null};
   const spec=await response.json();
   if(!spec?.paths||typeof spec.paths!=='object')return {asset,status:'SPEC_UNVERIFIED'};
   const routes=inspectMarketSpec(asset,spec);
   return {asset,status:routes.every(r=>r.status==='DOCUMENTED')?'DOCUMENTED':'SCHEMA_REVIEW_REQUIRED',routes};
  }catch{return {asset,status:'SPEC_UNAVAILABLE'};}
 }));
 return {kind:'NH_MARKET_DATA_PUBLIC_CONTRACT',scope:'MARKET_DATA_ONLY',orders:0,accountQueries:0,tokenIssued:false,financialWrites:0,liveQuotesVerified:false,groups:rows};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=await auditMarketSpecs();
 console.log(JSON.stringify(result));
 if(result.groups.some(g=>g.status!=='DOCUMENTED'))process.exitCode=1;
}
