// NH official CME master: resolve the broker-designated lead contract, not
// an estimated front month. Public GET only; no credentials or quote claims.
// Layout: https://github.com/plug-openapi/nhplug-sdk/blob/main/instruments/headers/fucode_h.h
import {pathToFileURL} from 'node:url';
const BASE='https://www.nhplug.com/instruments/fucode_h';
const SIZE=283,MAX=20*1024*1024;
const FIELDS=Object.freeze([['Symbol',32],['InnerSymbol',32],['CoreSymbol',12],
 ['inrt',32],['ExchName',8],['EngName',80],['ExchId',3],['SymbolType',1],
 ['Section',2],['Pind',1],['Tradable',1],['Onoff',1],['TickSize',17],
 ['AdjustValue',17],['Leadmonth',1],['MonthYear',8],['PrevLast',17],['TickValue',17],['dummy',1]]);
export const NH_CME_ROOTS=Object.freeze(['ES','NQ','YM','RTY']);
function layout(header){
 if(typeof header!=='string'||header.length>100000||!/@record\s+283\b/.test(header))return false;
 let offset=0;
 const c=FIELDS.every(([name,width])=>{
  const matched=new RegExp('char\\s+'+name+'\\['+width+'\\][^\\n]*@'+offset+'\\b').test(header);
  offset+=width;return matched;
 });
 if(c&&offset===SIZE)return true;
 const fields=[...header.matchAll(/^\s*\(["']([A-Za-z0-9_]+)["']\s*,\s*(\d+)\s*\)\s*,?\s*$/gm)];
 return fields.length===FIELDS.length&&fields.every((m,i)=>m[1]===FIELDS[i][0]&&Number(m[2])===FIELDS[i][1]);
}
function day(value){
 if(!/^\d{8}$/.test(value))return false;
 const text=value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8);
 const d=new Date(text+'T00:00:00Z');
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===text;
}
const month={H:'03',M:'06',U:'09',Z:'12'};
export function chicagoDate(now=new Date()){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('NH_CME_CLOCK_INVALID');
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Chicago',
  year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(x=>[x.type,x.value]));
 return p.year+p.month+p.day;
}
export function parseNhCmeLeadContracts(bytes,header,asOf){
 if(!day(asOf)||!layout(header)||!(bytes instanceof Uint8Array)||!bytes.length||
    bytes.length>MAX||bytes.length%SIZE!==0)throw Error('NH_CME_MASTER_SCHEMA_UNVERIFIED');
 const selected=new Map(NH_CME_ROOTS.map(id=>[id,[]]));
 const ascii=(start,end)=>Buffer.from(bytes.subarray(start,end)).toString('latin1').trim();
 for(let i=0;i<bytes.length;i+=SIZE){
  if(bytes[i+282]!==10)throw Error('NH_CME_MASTER_RECORD_UNVERIFIED');
  const contract=ascii(i+32,i+64),match=/^(ES|NQ|YM|RTY)([HMUZ])(\d{2})$/.exec(contract);
  if(!match||ascii(i+239,i+240)!=='1')continue;
  const [,id,m,yr]=match,expiry=ascii(i+240,i+248);
  // Exact full-size quarterly index contracts only: no micro, spreads,
  // options, expired contracts, conflicting exchange or malformed expiry.
  if(ascii(i+108,i+116)!=='FCME'||ascii(i+196,i+199)!=='E01'||
     ascii(i+199,i+200)!=='F'||ascii(i+200,i+202)!=='30'||
     !day(expiry)||expiry<'20'+yr+month[m]+'01'||expiry.slice(0,6)!=='20'+yr+month[m]||expiry<asOf)
   throw Error('NH_CME_LEAD_IDENTITY_UNVERIFIED');
  selected.get(id).push({id,exchange:'FCME',contract,expiry,leadMonth:true});
 }
 // A missing or duplicate leading contract must not silently choose another.
 return NH_CME_ROOTS.map(id=>selected.get(id).length===1
  ?{...selected.get(id)[0],status:'MASTER_VERIFIED'}
  :{id,status:selected.get(id).length?'AMBIGUOUS_LEAD':'NO_LEAD'});
}
export async function loadNhCmeLeadContracts({fetchImpl=fetch,now=new Date()}={}){
 const asOf=chicagoDate(now);
 const opts={method:'GET',redirect:'error',signal:AbortSignal.timeout(25000)};
 const h=await fetchImpl(BASE+'.h',opts);
 if(!h?.ok)throw Error('NH_CME_MASTER_HEADER_UNAVAILABLE');
 const header=await h.text();
 if(!layout(header))throw Error('NH_CME_MASTER_SCHEMA_UNVERIFIED');
 const r=await fetchImpl(BASE+'.mst',{...opts,signal:AbortSignal.timeout(75000)});
 if(!r?.ok||Number(r.headers?.get?.('content-length')||0)>MAX)throw Error('NH_CME_MASTER_DATA_UNAVAILABLE');
 const rows=parseNhCmeLeadContracts(new Uint8Array(await r.arrayBuffer()),header,asOf);
 return {kind:'NH_CME_LEAD_CONTRACTS',asOf,source:'NH_PUBLIC_MASTER',rows,
  quoteVerified:false,orders:0,tokenIssued:false,financialWrites:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const result=await loadNhCmeLeadContracts();
  console.log(JSON.stringify(result));
  if(result.rows.some(r=>r.status!=='MASTER_VERIFIED'))process.exitCode=1;
 }catch(e){console.error(/^NH_CME_[A-Z_]+$/.test(e?.message||'')?e.message:'NH_CME_MASTER_UNAVAILABLE');process.exitCode=1;}
}
