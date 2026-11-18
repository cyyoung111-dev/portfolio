import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
export const SPEC_URL='https://www.nhplug.com/openapi-docs/common/openapi.json';
const checks=[
 ['/common/inquiry/v1/totalTransaction',['iqr_tp_cd','iqr_rge_cd','act_no','iqr_sta_dt','iqr_end_dt','iem_llf_cd','act_trd_dtl_cd'],['cur_cd','trd_dt','iem_cd','trd_amt','sps_cd_krl_anm']],
 ['/common/inquiry/v1/depositWithdrawal',['iqr_tp_cd','act_no','iqr_sta_dt','iqr_end_dt','act_trd_dtl_cd'],['trd_dt','trd_amt','sps_cd_krl_anm','act_trd_tp_nm']]
];
export function inspectFinancialIncomeContract(spec){
 const out=[];
 for(const [endpoint,inputs,outputs] of checks){
   const p=spec?.paths?.[endpoint]?.post;
   assert.ok(p,'documented inquiry missing');
   const req=p.requestBody?.content?.['application/json']?.schema?.properties?.Input_0;
   const response=p.responses?.['200']?.content?.['application/json']?.schema?.properties?.Output_0;
   assert.ok(inputs.every(k=>req?.required?.includes(k)&&req?.properties?.[k]),'request schema changed');
   assert.equal(response?.type,'array');
   const fields=response?.items?.properties||{};
   assert.ok(outputs.every(k=>fields[k]),'response schema changed');
   const taxTotal=Object.entries(fields).find(([,v])=>/세금합계/.test(v.description||''));
   out.push({endpoint,requestFields:inputs.length,outputFields:Object.keys(fields).length,taxTotalDocumented:!!taxTotal,continuationDocumented:p.parameters?.some(x=>x.$ref==='#/components/parameters/CtsHeader')===true});
 }
 assert.equal(spec?.components?.parameters?.CtsHeader?.name,'cts');
 assert.equal(out[0].taxTotalDocumented,true);
 assert.ok(out.every(x=>x.continuationDocumented));
 return {mode:'PUBLIC_SPEC_ONLY',accountsAccessed:false,tokenIssued:false,financialTaxClassificationVerified:false,endpoints:out};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const r=await fetch(SPEC_URL,{redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('source unavailable');
  console.log(JSON.stringify(inspectFinancialIncomeContract(await r.json())));
 }catch{console.error('NH_FINANCIAL_INCOME_PUBLIC_SCHEMA_UNAVAILABLE_OR_CHANGED');process.exitCode=1;}
}
