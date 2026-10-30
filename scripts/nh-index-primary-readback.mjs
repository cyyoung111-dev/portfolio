import {pathToFileURL} from 'node:url';
export function verifyNhIndexResponse(data){
 if(data?.status!=='ok'||!data.series||!data.seriesMeta)return {status:'NH_INDEX_READBACK_UNAVAILABLE'};
 const expected={SP500:{code:'SPX',price:7720.39},NASDAQ:{code:'COMP',price:26184.72},NASDAQ100:{code:'NDX',price:29402.51}};
 const result=[];
 for(const [type,e] of Object.entries(expected)){
   const rows=data.series[type]||[],last=rows.filter(r=>r.date==='2026-10-29').at(-1),meta=data.seriesMeta[type]||{};
   result.push({type,source:String(last?.source||meta.source||'UNKNOWN'),
     date:last?.date||null,value:Number(last?.value)||null,nhCode:meta.providerCode||'',
     matchesExpected:meta.source==='NH_INDEX_DAILY'&&meta.providerCode===e.code
       &&last?.source==='NH_INDEX_DAILY'&&last?.date==='2026-10-29'
       &&Math.abs(Number(last?.value)-e.price)<0.005});
 }
 return {status:'NH_INDEX_PRIMARY_READBACK',samples:result,confirmed:result.filter(r=>r.matchesExpected).length,
   allThreeConfirmed:result.every(r=>r.matchesExpected)};
}
async function main(){
 if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_EVENT_NAME!=='workflow_run')return;
 const uri=process.env.GAS_WEB_APP_URL,token=process.env.GAS_ACCESS_TOKEN;
 if(!uri||!token)throw Error('NH_INDEX_READBACK_AUTH');
 let u;try{u=new URL(uri);}catch{throw Error('NH_INDEX_READBACK_URL');}
 if(u.protocol!=='https:'||u.hostname!=='script.google.com'
  ||!/^\/macros\/s\/[^/]+\/exec$/.test(u.pathname)||u.search)throw Error('NH_INDEX_READBACK_URL');
 const response=await fetch(u.href,{method:'POST',
  headers:{'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({action:'getBenchmarks',accessToken:token,
   benchmarks:'SP500,NASDAQ,NASDAQ100',from:'2026-10-22',to:'2026-10-29',fresh:'1'}),
  redirect:'follow',signal:AbortSignal.timeout(90000)});
 if(!response.ok)throw Error('NH_INDEX_READBACK_HTTP');
 const data=await response.json();
 const summary=verifyNhIndexResponse(data);
 console.log(JSON.stringify(summary));
 if(!summary.allThreeConfirmed)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 main().catch(e=>{console.error(/^NH_INDEX_READBACK_[A-Z_]+$/.test(e.message||'')?e.message:'NH_INDEX_READBACK_FAILED');process.exitCode=1;});
