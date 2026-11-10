// Existing KRX/GAS credentials only. Read-only production source diagnosis.
// Do not print tokens, endpoint URLs, quotes, private financial records or
// raw API bodies. Fixed completed 2026-11-09 KRX date; no Telegram sends.
import {readClosingVkospi} from './closing-vkospi-reference.mjs';
import {readClosingKrxTurnoverFromGas} from './closing-krx-turnover.mjs';
import {readMorningBreadth,parseKrxBreadth} from './telegram-morning-breadth.mjs';
const TARGET='2026-11-09',AT=()=>new Date('2026-11-09T17:10:00+09:00');
const details=[];
const [vk,turn,breadth]=await Promise.all([
 readClosingVkospi(TARGET,{now:AT,onDiagnostic:d=>details.push(d)})
   .catch(()=>[]),
 readClosingKrxTurnoverFromGas(TARGET,{now:AT,onDiagnostic:d=>details.push(d)})
   .catch(()=>[]),
 readMorningBreadth('2026-11-10',{
   now:()=>new Date('2026-11-10T07:40:00+09:00')
 }).catch(()=>[])
]);
console.log(JSON.stringify({kind:'KRX_GAS_OPTIONAL_SOURCE_PROBE',
 targetDate:TARGET,gasUrlConfigured:Boolean(process.env.GAS_WEB_APP_URL),
 gasTokenConfigured:Boolean(process.env.GAS_ACCESS_TOKEN),
 krxKeyConfigured:Boolean(process.env.KRX_AUTH_KEY),
 vkospiCount:vk.length,turnoverCount:turn.length,breadthCount:breadth.length,
 diagnostics:details.filter(x=>['VKOSPI_READ','KRX_TURNOVER_READ'].includes(x?.kind))
  .map(x=>({kind:x.kind,status:x.status})),writes:0,telegramSends:0}));
const key=process.env.KRX_AUTH_KEY;
if(typeof key==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(key)){
 for(const [market,path] of [
  ['KOSPI','/svc/apis/sto/stk_bydd_trd'],
  ['KOSDAQ','/svc/apis/sto/ksq_bydd_trd']
 ]){
  const info={kind:'KRX_STOCK_BREADTH_CONTRACT',market,date:TARGET};
  try{
   const url=new URL('https://data-dbg.krx.co.kr'+path);
   url.searchParams.set('basDd','20261109');
   const response=await fetch(url.href,{headers:{AUTH_KEY:key,accept:'application/json'},
     redirect:'error',signal:AbortSignal.timeout(8000)});
   info.httpStatus=response.status;
   if(response.ok){
    const obj=await response.json(),rows=obj?.OutBlock_1;
    info.topKeys=Object.keys(obj||{}).slice(0,6);
    info.rowCount=Array.isArray(rows)?rows.length:0;
    info.parserAccepted=Boolean(parseKrxBreadth(TARGET,market,obj));
    info.firstSchemaKeys=Array.isArray(rows)&&rows.length
      ?Object.keys(rows[0]).filter(x=>['BAS_DD','ISU_CD','TDD_CLSPRC','CMPPREVDD_PRC'].includes(x)):[];
    info.invalidDateCount=Array.isArray(rows)?rows.filter(x=>x.BAS_DD!=='20261109').length:null;
    info.blankCodeCount=Array.isArray(rows)?rows.filter(x=>!x.ISU_CD).length:null;
    info.duplicateCodeCount=Array.isArray(rows)?rows.length-new Set(rows.map(x=>x.ISU_CD)).size:null;
   }
  }catch(e){info.error=['AbortError','TimeoutError'].includes(e?.name)
    ?'TIMEOUT':'NETWORK_OR_RESPONSE';}
  console.log(JSON.stringify(info));
 }
}
