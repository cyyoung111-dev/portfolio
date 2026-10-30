import {pathToFileURL} from 'node:url';
export function summarize(status,probe){
 if(status?.status!=='ok'||status.provider!=='NH'||status.tokenCached!==true||status.tokenIssued!==false)
   throw Error('NH_INDEX_CACHE_REQUIRED');
 if(probe?.status!=='ok'||probe.provider!=='NH'||probe.gasVersion!=='9.281'
   ||probe.readOnly!==true||probe.date!=='2026-10-29'||!Array.isArray(probe.results)||probe.results.length>6)
   throw Error('NH_INDEX_RESULT_INVALID');
 return {status:'NH_INDEX_EXPLORATORY_READBACK',date:probe.date,
   mappingsVerified:false,stopped:probe.stopped===true,
   samples:probe.results.map(row=>({
     type:String(row.type||'').slice(0,18),code:String(row.code||'').slice(0,20),
     status:String(row.status||'').slice(0,30),name:String(row.name||'').slice(0,50),
     date:row.status==='CANDIDATE_ONLY'?String(row.date||''):null,
     value:row.status==='CANDIDATE_ONLY'&&Number.isFinite(row.value)?row.value:null
   }))};
}
async function main(){
 if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_EVENT_NAME!=='workflow_run')return;
 const raw=process.env.GAS_WEB_APP_URL,token=process.env.GAS_ACCESS_TOKEN;
 if(!raw||!token)throw Error('NH_INDEX_GAS_MISSING');
 let u;try{u=new URL(raw);}catch{throw Error('NH_INDEX_GAS_URL');}
 if(u.protocol!=='https:'||u.hostname!=='script.google.com'
   ||!/^\/macros\/s\/[^/]+\/exec$/.test(u.pathname)||u.search||u.hash)throw Error('NH_INDEX_GAS_URL');
 const post=async(action)=>{
   const rsp=await fetch(u.href,{method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({action,accessToken:token,...(action==='getNhIndexProbe'?{date:'2026-10-29'}:{})}),
    redirect:'follow',signal:AbortSignal.timeout(90000)});
   if(!rsp.ok)throw Error('NH_INDEX_GAS_HTTP');
   try{return await rsp.json();}catch{throw Error('NH_INDEX_GAS_PARSE');}
 };
 const status=await post('getNhAuthStatusProxy');
 if(status?.gasVersion!=='9.281'||status.tokenCached!==true||status.tokenIssued!==false){
   console.log('NH_INDEX_PROBE_SKIPPED_NOT_READY');return;
 }
 const out=await post('getNhIndexProbe');
 console.log(JSON.stringify(summarize(status,out)));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 main().catch(err=>{console.error(/^NH_INDEX_[A-Z_]+$/.test(err?.message||'')?err.message:'NH_INDEX_FAILED');process.exitCode=1;});
