// Official KRX derivative index daily VKOSPI: one exact-name, exact-date row.
// Read only. This source is never used for GAS/portfolio financial writes.
import {krxSessionStatus} from './krx-session-calendar.mjs';
const URL='https://data-dbg.krx.co.kr/svc/apis/idx/drvprod_dd_trd';
const isDate=date=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)
 &&Number.isFinite(Date.parse(date+'T00:00:00Z'))
 &&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
const mainIndex=/^(?:VKOSPI|코스피\s*200\s*변동성지수(?:\s*\(VKOSPI\))?)$/i;
function kst(now){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'})
  .formatToParts(now).map(x=>[x.type,x.value]));
 return {date:p.year+'-'+p.month+'-'+p.day,minute:Number(p.hour)*60+Number(p.minute)};
}
export function selectOfficialKrxVkospiDaily(date,payload){
 if(!isDate(date)||!Array.isArray(payload?.OutBlock_1)
  ||payload.OutBlock_1.length<1||payload.OutBlock_1.length>5000)return [];
 const rows=payload.OutBlock_1,ymd=date.replaceAll('-','');
 if(!rows.every(x=>String(x?.BAS_DD||'')===ymd))return [];
 const selected=rows.filter(x=>mainIndex.test(String(x?.IDX_NM||'').trim()));
 if(selected.length!==1)return [];
 const raw=String(selected[0]?.CLSPRC_IDX??'').trim().replaceAll(',','');
 const value=raw!==''?Number(raw):NaN;
 if(!Number.isFinite(value)||value<=0||value>=200)return [];
 return [{id:'VKOSPI',label:'VKOSPI',date,value,
  source:'KRX_OFFICIAL',role:'NON_NH_REFERENCE_ONLY'}];
}
export async function readOfficialKrxVkospiDaily(date,{
 authKey=process.env.KRX_AUTH_KEY,fetchImpl=fetch,now=()=>new Date()
}={}){
 if(!isDate(date)||krxSessionStatus(date)!=='OPEN'
  ||typeof authKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(authKey))return [];
 const when=now();
 if(!(when instanceof Date)||!Number.isFinite(when.getTime()))return [];
 const local=kst(when);
 // Only an already completed KRX session is eligible.
 if(local.date<date||(local.date===date&&local.minute<960))return [];
 const endpoint=new URL(URL);
 endpoint.searchParams.set('basDd',date.replaceAll('-',''));
 try{
  const response=await fetchImpl(endpoint.href,{
   method:'GET',headers:{AUTH_KEY:authKey,accept:'application/json'},
   redirect:'error',signal:AbortSignal.timeout(8500)
  });
  if(!response?.ok||Number(response.status)!==200)return [];
  return selectOfficialKrxVkospiDaily(date,await response.json());
 }catch{return [];}
}
