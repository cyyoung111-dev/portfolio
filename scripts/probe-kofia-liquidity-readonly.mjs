// One-time read-only network smoke for the exact producer endpoint used in
// market briefings. Logs only availability and source dates; never raw quotes.
import {readKofiaLiquidity} from './briefing-kofia-liquidity.mjs';
const now=new Date();
const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',
 year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const started=Date.now();
const result=await readKofiaLiquidity(date);
console.log(JSON.stringify({kind:'KOFIA_LIVE_READONLY_PROBE',date,
 status:result?'PARTIAL_OR_VERIFIED':'SOURCE_UNAVAILABLE',
 deposits:result?.deposits?'VERIFIED':'UNAVAILABLE',
 credit:result?.margin?'VERIFIED':'UNAVAILABLE',
 dates:{deposits:result?.deposits?.date||null,credit:result?.margin?.date||null},
 elapsedMs:Date.now()-started,financeWrites:0,telegramSends:0,gasDeployments:0}));
