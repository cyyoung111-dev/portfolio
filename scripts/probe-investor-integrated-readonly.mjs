// Live GET-only contract check against the public market-wide investor feed.
// The fixed KST clock only selects the last completed KRX date; not a real-time
// execution claim. No Telegram, GAS, trading data, credentials or other writes.
import {readInvestorTrends,formatInvestorTrends} from './briefing-krx-investor-trends.mjs';
const date='2026-11-10';
const result=await readInvestorTrends(date,{
 mode:'morning',now:()=>new Date('2026-11-10T07:40:00+09:00')});
const text=result?formatInvestorTrends(result):'';
const ok=result?.date==='2026-11-09'&&result.mode==='morning'
 &&result.markets.length===2&&text.includes('네이버 참고')
 &&result.provisional===false;
console.log(JSON.stringify({kind:'INVESTOR_REFERENCE_LIVE_READONLY',
 observedAtKst:date,expectedCompletedKrxDate:'2026-11-09',
 status:ok?'VERIFIED':'UNAVAILABLE_OR_SCHEMA_CHANGED',
 sourceDate:result?.date||null,marketCount:result?.markets?.length||0,
 exactPriceBalanceValidation:ok,mode:'morning_synthetic_clock_to_query_live_completed_date',
 financialWrites:0,gasWrites:0,telegramSends:0}));
if(!ok)process.exitCode=1;
