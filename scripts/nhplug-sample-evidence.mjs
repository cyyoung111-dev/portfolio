import { pathToFileURL } from 'node:url';
import { diagnoseCombined } from './nhplug-combined-readonly-diagnostic.mjs';

// Only public sample instruments and explicitly allowlisted scalar values may be logged.
const symbols=new Set(['005930','069500','AAPL','QQQ']);
const safePrice=v=>{const s=String(v??'');return /^\d{1,12}(?:\.\d{1,6})?$/.test(s)&&Number(s)>0?s:null;};
const safeDate=v=>typeof v==='string' && /^(?:\d{8}|\d{2}\/\d{2}\/\d{2})$/.test(v)?v:null;
export function evidenceRequest(request, evidence) {
  return async (url, options={}) => {
    const response=await request(url,options);
    let input;
    try { input=JSON.parse(options.body)?.Input_0; } catch { return response; }
    const code=input?.iem_cd;
    let path;
    try {path=new URL(url).pathname;} catch {return response;}
    if(!symbols.has(code)||!['/krstock/quote/v1/currentDaily','/gbstock/quote/v1/current'].includes(path))return response;
    return {ok:response.ok,status:response.status,json:async()=>{
      const body=await response.json();
      if(response.ok && path.endsWith('/currentDaily') && Array.isArray(body?.Output_0)) {
        for(const row of body.Output_0) {const date=safeDate(row?.bsop_date),price=safePrice(row?.stck_clpr);if(date&&price)evidence.push({type:'KR_DAILY',symbol:code,date,price});}
      } else if(response.ok && path.endsWith('/current')) {
        const date=safeDate(body?.Output_0?.trade_date),price=safePrice(body?.Output_0?.trdprc);
        if(date&&price)evidence.push({type:'US_QUOTE',symbol:code,date,price,time:'UNVERIFIED'});
      }
      return body;
    }};
  };
}
export async function runSampleEvidence({key,secret,request=fetch,log=console.log,wait,now}={}) {
  const evidence=[];
  const ok=await diagnoseCombined({key,secret,request:evidenceRequest(request,evidence),log,wait,now});
  // Records are observations only. The original diagnostic separately checks identity.
  for(const record of evidence)log('PUBLIC_SAMPLE '+JSON.stringify(record));
  log('PUBLIC_SAMPLE LIMITATIONS=IDENTITY_AND_FINALITY_REQUIRE_SEPARATE_VERIFICATION TIME=UNVERIFIED');
  return ok;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const ok=await runSampleEvidence({key:process.env.NHPLUG_APP_KEY,secret:process.env.NHPLUG_APP_SECRET});
  if(!ok)process.exitCode=1;
}
