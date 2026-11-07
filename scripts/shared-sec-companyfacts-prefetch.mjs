// Bounded in-memory SEC companyfacts reuse during ONE isolated 06:20 prefetch.
// TTM and FY value readers require the same public document, but must never
// send 18 duplicate SEC requests or reuse a failed/unverified response.
// No disk, token/URL logs, GAS, Sheets or Telegram access.
import {AI_NINE} from './briefing-ai-nine-sources.mjs';

const approved=new Map(AI_NINE.map(item=>[
 'https://data.sec.gov/api/xbrl/companyfacts/CIK'+item.cik+'.json',Number(item.cik)
]));
const userAgent=init=>{
 const headers=init?.headers;
 return typeof headers?.get==='function'
  ?headers.get('user-agent')
  :headers?.['user-agent']??null;
};
const shouldCache=(url,init)=>{
 if(!approved.has(url)||init?.method!=='GET'||init?.redirect!=='error')return false;
 const ua=userAgent(init);
 return typeof ua==='string'&&ua.length>=12&&ua.length<=160;
};
const accepted=(doc,cik)=>doc&&typeof doc==='object'&&!Array.isArray(doc)
 &&Number(doc.cik)===cik&&typeof doc.entityName==='string'
 &&doc.entityName.length>=2&&doc.facts&&typeof doc.facts==='object'
 &&!Array.isArray(doc.facts);

// This wrapper is never global. Instantiate once inside collectAiFinancialEvidence,
// so one run's filings cannot leak to a later trading day or a changed credential.
export function sharedSecCompanyFactsFetch(fetchImpl=fetch){
 if(typeof fetchImpl!=='function')throw Error('SEC_SHARED_FETCH_CONFIG');
 const verified=new Map();
 return async (url,init={})=>{
  if(!shouldCache(url,init))return fetchImpl(url,init);
  const ua=userAgent(init),hit=verified.get(url);
  if(hit&&hit.userAgent===ua){
   return {ok:true,status:200,headers:hit.headers,
    json:async()=>structuredClone(hit.doc)};
  }
  const response=await fetchImpl(url,init);
  if(!response?.ok||!response.headers||typeof response.json!=='function')
   return response;
  const type=String(response.headers.get?.('content-type')||'').toLowerCase();
  const size=Number(response.headers.get?.('content-length'));
  // Do not parse or retain invalid, oversized or unspecified formats that
  // the production SEC readers themselves would reject.
  if(!type.includes('json')||(Number.isFinite(size)&&size>12000000))
   return response;
  return {ok:response.ok,status:response.status,headers:response.headers,
   json:async()=>{
    const doc=await response.json();
    if(accepted(doc,approved.get(url)))
     verified.set(url,{doc:structuredClone(doc),headers:response.headers,userAgent:ua});
    return doc;
   }};
 };
}
