// Production GAS source-only probe: no account data, financial writes,
// new tokens, Telegram sends, version deploy, raw prices or raw GAS response.
import {readClosingVkospi} from './closing-vkospi-reference.mjs';
import {readClosingKrxTurnoverFromGas} from './closing-krx-turnover.mjs';
const at=date=>()=>new Date(date+'T17:08:00+09:00');
async function inspectDate(date){
 const diagnostics=[];
 const [vkospi,turnover]=await Promise.all([
  readClosingVkospi(date,{now:at(date),onDiagnostic:d=>diagnostics.push(d)})
   .catch(()=>[]),
  readClosingKrxTurnoverFromGas(date,{now:at(date),
    onDiagnostic:d=>diagnostics.push(d)}).catch(()=>[])
 ]);
 return {date,
  vkospi:vkospi.length===1?'VERIFIED':'UNVERIFIED',
  turnover:turnover.length===2?'BOTH_VERIFIED'
   :turnover.length===1?'PARTIAL':'UNVERIFIED',
  reasons:diagnostics.filter(x=>['VKOSPI_READ','KRX_TURNOVER_READ'].includes(x?.kind))
   .map(x=>({kind:x.kind,status:x.status})),
  financialWrites:0,gasWrites:0,gasDeployments:0,telegramSends:0};
}
const configured=Boolean(process.env.GAS_WEB_APP_URL)
 &&typeof process.env.GAS_ACCESS_TOKEN==='string'
 &&process.env.GAS_ACCESS_TOKEN.length>=12;
console.log(JSON.stringify({kind:'GAS_OPTIONAL_KRX_READONLY_CONFIG',
 configured,financialWrites:0,telegramSends:0}));
if(configured){
 const first=await inspectDate('2026-11-09');
 console.log(JSON.stringify({kind:'GAS_OPTIONAL_KRX_READONLY',...first,
  clock:'SYNTHETIC_17H_FOR_HISTORIC_SOURCE_CHECK'}));
 if(first.vkospi!=='VERIFIED'||first.turnover!=='BOTH_VERIFIED'){
  const prior=await inspectDate('2026-11-06');
  console.log(JSON.stringify({kind:'GAS_OPTIONAL_KRX_READONLY_PRIOR',...prior,
    clock:'SYNTHETIC_17H_FOR_HISTORIC_SOURCE_CHECK'}));
 }
}
