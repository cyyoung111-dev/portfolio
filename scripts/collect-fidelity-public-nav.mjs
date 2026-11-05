// Public, GET-only NAV source for Fidelity World Big4 Class S (AP399).
// Does not require GAS credentials or touch the portfolio workbook.
import {pathToFileURL} from 'node:url';
import {parseNav,sourceUrl} from './collect-kb-fund-nav.mjs';

export const FUND_CD='KR5235AP3996';
export const CLASS_CODE='AP399';

export async function runPublicFidelitySource({now=new Date(),fetchImpl=fetch}={}) {
  const today=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(now);
  const from=new Date(Date.parse(today+'T00:00:00Z')-31*86400000)
    .toISOString().slice(0,10);
  const url=new URL(sourceUrl);
  url.search=new URLSearchParams({
    fundCd:FUND_CD,gijunYmd:today.replaceAll('-',''),schNavMode:'',
    schNavStDt:from.replaceAll('-',''),schNavEdDt:today.replaceAll('-','')
  });
  let response;
  try {
    response=await fetchImpl(url,{
      method:'GET',
      headers:{'User-Agent':'Mozilla/5.0',
        Referer:'https://www.funetf.co.kr/product/fund/view/'+FUND_CD},
      signal:AbortSignal.timeout(60000)
    });
  } catch {throw Error('FIDELITY_SOURCE_NETWORK_UNVERIFIED');}
  if(!response?.ok)throw Error('FIDELITY_SOURCE_HTTP_UNVERIFIED');
  let payload;
  try {payload=await response.json();}
  catch {throw Error('FIDELITY_SOURCE_JSON_UNVERIFIED');}
  let allRows;
  try {allRows=parseNav(payload,from,today);}
  catch {throw Error('FIDELITY_SOURCE_SCHEMA_UNVERIFIED');}
  // The source may expose today's provisional NAV. It is never historical.
  const rows=allRows.filter(row=>row.date<today);
  if(!rows.length)throw Error('FIDELITY_SOURCE_NO_PRIOR_DAY_ROWS');
  return {mode:'SOURCE_ONLY',writerInvoked:false,code:'F00003',
    lookupCode:FUND_CD,classCode:CLASS_CODE,provider:'FIDELITY_BIG4_S',
    sourceRows:rows.length,sameDayExcluded:allRows.length-rows.length,
    from,to:today,historicalCutoffExclusive:today,
    latestDate:rows.at(-1).date,rows};
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href) {
  try {console.log(JSON.stringify(await runPublicFidelitySource()));}
  catch(e) {
    console.error(/^FIDELITY_SOURCE_[A-Z_]+$/.test(e?.message||'')
      ?e.message:'FIDELITY_SOURCE_UNVERIFIED');
    process.exitCode=1;
  }
}
