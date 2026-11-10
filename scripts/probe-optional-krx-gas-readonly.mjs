// Existing optional GitHub KRX_AUTH_KEY only. Read-only direct KRX OpenAPI.
// No GAS credentials, portfolio writes, Telegram, prices or raw API bodies.
import {parseKrxBreadth} from './telegram-morning-breadth.mjs';
const DAY='2026-11-09';
const key=process.env.KRX_AUTH_KEY;
const configured=typeof key==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(key);
console.log(JSON.stringify({kind:'KRX_OPTIONAL_AUTH_PROBE',targetDate:DAY,
 configured,financialWrites:0,gasCalls:0,telegramSends:0}));
if(configured){
 const endpoints=[
  ['STOCK_KOSPI','/svc/apis/sto/stk_bydd_trd'],
  ['STOCK_KOSDAQ','/svc/apis/sto/ksq_bydd_trd'],
  ['INDEX_KOSPI','/svc/apis/idx/kospi_dd_trd'],
  ['INDEX_KOSDAQ','/svc/apis/idx/kosdaq_dd_trd'],
  ['INDEX_KRX','/svc/apis/idx/krx_dd_trd']
 ];
 await Promise.all(endpoints.map(async ([id,path])=>{
  const info={kind:'KRX_OPTIONAL_DIRECT_CONTRACT',id};
  const url=new URL('https://data-dbg.krx.co.kr'+path);
  url.searchParams.set('basDd','20261109');
  try{
   const response=await fetch(url.href,{headers:{AUTH_KEY:key,accept:'application/json'},
    redirect:'error',signal:AbortSignal.timeout(7500)});
   info.http=response.status;
   if(response.ok){
    const payload=await response.json(),rows=payload?.OutBlock_1;
    info.topKeys=Object.keys(payload||{}).slice(0,5);
    info.rowCount=Array.isArray(rows)?rows.length:0;
    info.allExactDate=Array.isArray(rows)&&rows.length>0
      &&rows.every(x=>x.BAS_DD==='20261109');
    if(id.startsWith('STOCK_')){
      const market=id.slice(6);
      info.breadthParsed=Boolean(parseKrxBreadth(DAY,market,payload));
      info.duplicateCodes=Array.isArray(rows)
        ?rows.length-new Set(rows.map(x=>x.ISU_CD)).size:null;
      info.missingColumns=Array.isArray(rows)&&rows.length
        ?['ISU_CD','TDD_CLSPRC','CMPPREVDD_PRC'].filter(k=>!(k in rows[0])):[];
    }else{
      info.vkospiLabels=Array.isArray(rows)
        ?rows.filter(x=>/VKOSPI|코스피 ?200 ?변동성/i.test(String(x.IDX_NM||'')))
          .length:0;
      info.hasTurnoverColumn=Array.isArray(rows)&&rows.length
        ?'ACC_TRDVAL' in rows[0]:false;
    }
   }
  }catch(e){info.error=['AbortError','TimeoutError'].includes(e?.name)
    ?'TIMEOUT':'NETWORK_OR_RESPONSE';}
  console.log(JSON.stringify(info));
 }));
}
