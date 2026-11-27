// Source-only transport for the proposed central NH CME quote probe.
// Do not schedule or invoke in production until the route is deployed,
// actual provider time/scale semantics are verified, and a release is approved.
import {loadNhCmeLeadContracts,NH_CME_ROOTS} from './nh-cme-lead-contracts.mjs';
import {validateGasEndpoint} from './nh-gas-proxy.mjs';
const fields=['id','contract','status','last','previousClose','tradeDate','tradeClock',
 'sessionOpenDate','sessionCloseDate','sessionOpenClock','sessionCloseClock','updateDate','updateClock',
 'priceIndicator','adjustValue'];
const statuses=new Set(['CONTRACT_AND_PRICE_SHAPE_VERIFIED','HTTP_401','HTTP_403','HTTP_429',
 'TOKEN_EXPIRES','NETWORK_UNVERIFIED','HTTP_UNVERIFIED','JSON_UNVERIFIED','IDENTITY_UNVERIFIED',
 'PRICE_OR_CLOCK_SHAPE_UNVERIFIED','DETAIL_OR_CLOCK_SHAPE_UNVERIFIED']);
const stops=new Set(['NONE','HTTP_401','HTTP_403','HTTP_429','TOKEN_EXPIRES','NETWORK_UNVERIFIED']);
const day=s=>typeof s==='string'&&/^\d{8}$/.test(s)&&
 (()=>{const x=s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8),d=new Date(x+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===x;})();
const clock=s=>typeof s==='string'&&/^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d(?:\d{1,6})?$/.test(s);
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
export function assessNhCmeQuoteContract(body,master,date){
 const fail=()=>{throw Error('NH_CME_PROBE_RESPONSE_UNVERIFIED');};
 const outer=['status','provider','mode','date','masterDate','readOnly','diagnosticOnly','tokenIssued',
  'bearerExposed','financialOriginalWritten','liveQuotesVerified','clockTimezoneVerified',
  'priceScaleVerified','requests','stopped','results'];
 if(!body||Object.keys(body).some(k=>!outer.includes(k))||body.status!=='ok'||body.provider!=='NH'
   ||body.mode!=='CME_QUOTE_CONTRACT_ONLY'||body.date!==date||body.masterDate!==master.asOf
   ||body.readOnly!==true||body.diagnosticOnly!==true
   ||['tokenIssued','bearerExposed','financialOriginalWritten','liveQuotesVerified','clockTimezoneVerified','priceScaleVerified']
    .some(k=>body[k]!==false)
   ||!Number.isInteger(body.requests)||body.requests<0||body.requests>8
   ||!stops.has(body.stopped)||!Array.isArray(body.results)||body.results.length>4
   ||(body.stopped==='NONE'&&body.results.length!==4))fail();
 const rows=body.results.map((r,i)=>{
  if(!r||Object.keys(r).some(k=>!fields.includes(k))||r.id!==master.rows[i]?.id
    ||r.contract!==master.rows[i]?.contract||!statuses.has(r.status))fail();
  if(r.status!=='CONTRACT_AND_PRICE_SHAPE_VERIFIED'){
   if(Object.keys(r).some(k=>!['id','contract','status'].includes(k)))fail();
   return {id:r.id,contract:r.contract,status:r.status};
  }
  if(!positive(r.last)||!(r.previousClose===null||positive(r.previousClose))
    ||!['tradeDate','sessionOpenDate','sessionCloseDate','updateDate'].every(k=>day(r[k]))
    ||r.sessionOpenDate>r.sessionCloseDate
    ||!['tradeClock','sessionOpenClock','sessionCloseClock','updateClock'].every(k=>clock(r[k]))
    ||!(r.priceIndicator===null||typeof r.priceIndicator==='string'&&/^[0-9A-L]$/.test(r.priceIndicator))
    ||!(r.adjustValue===null||positive(r.adjustValue)))fail();
  return Object.fromEntries(fields.map(k=>[k,r[k]]));
 });
 return {kind:'NH_CME_QUOTE_CONTRACT_READ_ONLY',date,masterDate:master.asOf,rows,
  shapeVerified:rows.filter(r=>r.status==='CONTRACT_AND_PRICE_SHAPE_VERIFIED').length,
  requests:body.requests,stopped:body.stopped,liveQuotesVerified:false,clockTimezoneVerified:false,
  priceScaleVerified:false,tokenIssued:false,financialWrites:0};
}
export async function probeNhCmeQuoteContract({url,token,now=new Date(),fetchImpl=fetch,
 masterReader=loadNhCmeLeadContracts}={}){
 if(typeof token!=='string'||token.length<12)throw Error('NH_CME_PROXY_CONFIG');
 const endpoint=validateGasEndpoint(url);
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('NH_CME_CLOCK_INVALID');
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 // No scheduled use. Fetch the current official master, never a guessed
 // or previously cached month supplied by a caller.
 const master=await masterReader({fetchImpl,now});
 if(master?.source!=='NH_PUBLIC_MASTER'||master.quoteVerified!==false
   ||!day(master.asOf)||!Array.isArray(master.rows)||master.rows.length!==4
   ||master.rows.some((r,i)=>r.id!==NH_CME_ROOTS[i]||r.status!=='MASTER_VERIFIED'
     ||r.exchange!=='FCME'||!day(r.expiry)||r.expiry<master.asOf||r.leadMonth!==true
     ||!new RegExp('^'+r.id+'[HMUZ]\\d{2}$').test(r.contract)))
   throw Error('NH_CME_MASTER_UNVERIFIED');
 const contracts=master.rows.map(({id,exchange,contract,expiry})=>({id,exchange,contract,expiry}));
 let response,body;
 try{
  response=await fetchImpl(endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   body:new URLSearchParams({action:'getNhCmeQuoteProbe',mode:'contract',date,masterDate:master.asOf,
    contracts:JSON.stringify(contracts),accessToken:token}),redirect:'follow',signal:AbortSignal.timeout(120000)});
  if(!response?.ok)throw Error('HTTP');
  body=await response.json();
 }catch{throw Error('NH_CME_PROXY_UNAVAILABLE');}
 return assessNhCmeQuoteContract(body,master,date);
}
