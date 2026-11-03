// Independent Cloudflare Worker + D1 telemetry collector; disabled until activated.
// No raw URL, token, IP, user agent, stock, position, or account data in D1.
const ALLOWED=new Set(['load.initial-restore','load.initial-prices','load.full-update','price.poll-network','price.poll-render','price.poll-total','network.getBootstrap','network.getSettings','network.getPrices','network.getPriceHistory']);
const json=(v,status=200,headers={})=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
function cors(origin,env){
 const allowed=String(env.ALLOWED_ORIGIN||'').split(',').map(x=>x.trim()).filter(Boolean);
 return allowed.includes(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'}:null;
}
function auth(req,env){
 const expected=String(env.REPORT_TOKEN||''),actual=String(req.headers.get('Authorization')||'').replace(/^Bearer /,'');
 if(expected.length<24||expected.length!==actual.length)return false;
 let d=0;for(let i=0;i<expected.length;i++)d|=expected.charCodeAt(i)^actual.charCodeAt(i);
 return d===0;
}
function stats(rows){
 const groups=new Map();
 for(const r of rows){const key=r.device+'|'+r.stage;if(!groups.has(key))groups.set(key,{device:r.device,stage:r.stage,values:[],failed:0});
 const g=groups.get(key);g.values.push(Number(r.ms));if(r.result!=='ok')g.failed++;}
 return [...groups.values()].map(g=>{const vals=g.values.sort((a,b)=>a-b),n=vals.length;
  return {device:g.device,stage:g.stage,count:n,failed:g.failed,failureRatePct:Math.round(g.failed/n*1000)/10,medianMs:vals[Math.floor((n-1)/2)],p95Ms:vals[Math.ceil(n*.95)-1]};
 }).sort((a,b)=>a.stage.localeCompare(b.stage)||a.device.localeCompare(b.device));
}
export default {
 async fetch(req,env){
  const url=new URL(req.url),origin=req.headers.get('Origin')||'';
  if(url.pathname==='/report'&&req.method==='GET'){
   if(!auth(req,env))return json({error:'unauthorized'},401);
   if(!env.DB)return json({error:'storage_not_configured'},503);
   const q=await env.DB.prepare('SELECT device,stage,ms,result FROM perf_samples WHERE created_at >= ? ORDER BY id DESC LIMIT 5001')
    .bind(Date.now()-7*86400000).all();
   const rows=q.results||[];
   return json({windowDays:7,sampleCount:Math.min(rows.length,5000),truncated:rows.length>5000,groups:stats(rows.slice(0,5000))});
  }
  if(url.pathname!=='/ingest')return json({error:'not_found'},404);
  const headers=cors(origin,env);
  if(!headers)return json({error:'origin_rejected'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return json({error:'method_not_allowed'},405,headers);
  if(env.INGEST_ENABLED!=='true'||!env.DB)return json({error:'collector_disabled'},503,headers);
  if(Number(req.headers.get('Content-Length')||0)>4096)return json({error:'too_large'},413,headers);
  let body;
  try{const raw=await req.text();if(raw.length>4096)return json({error:'too_large'},413,headers);body=JSON.parse(raw);}
  catch(_){return json({error:'bad_payload'},400,headers)}
  if(body?.version!==1||!['mobile','desktop','unknown'].includes(body.device)||!Array.isArray(body.samples)||body.samples.length<1||body.samples.length>8||
   !body.samples.every(s=>s&&ALLOWED.has(s.stage)&&Number.isInteger(s.ms)&&s.ms>=0&&s.ms<=120000&&['ok','error'].includes(s.result)&&Object.keys(s).length===3))
   return json({error:'invalid_sample'},400,headers);
  const now=Date.now(),day=new Date(now+9*3600000).toISOString().slice(0,10);
  // Operational safeguard, not a substitute for Cloudflare's rate limiting.
  const n=await env.DB.prepare('SELECT COUNT(*) AS n FROM perf_samples WHERE day=?').bind(day).first();
  if(Number(n?.n||0)>=2000)return json({error:'daily_limit'},429,headers);
  await env.DB.batch(body.samples.map(s=>env.DB.prepare('INSERT INTO perf_samples(day,device,stage,ms,result,created_at) VALUES(?,?,?,?,?,?)').bind(day,body.device,s.stage,s.ms,s.result,now)));
  return json({ok:true,accepted:body.samples.length},202,headers);
 },
 async scheduled(event,env){
  if(env.DB)await env.DB.prepare('DELETE FROM perf_samples WHERE created_at < ?').bind(Date.now()-7*86400000).run();
 }
};