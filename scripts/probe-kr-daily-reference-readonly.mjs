#!/usr/bin/env node
// #826: exact-date Korean Yahoo daily reference live proof.
// Public GET only. No account values, quote prices, credentials, GAS,
// finance writes, claims, or Telegram. A missing source is not a verified close.
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {readYahooClosingKrStocks} from './closing-extra-daily-sources.mjs';

const now=new Date();
const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
 timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
 hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
}).formatToParts(now).map(x=>[x.type,x.value]));
const date=parts.year+'-'+parts.month+'-'+parts.day;
const minute=Number(parts.hour)*60+Number(parts.minute);
const open=krxSessionStatus(date)==='OPEN';
const enabled=open&&minute>=970;
const diagnostics=[];
const rows=enabled?await readYahooClosingKrStocks(date,{
 now:()=>now,onDiagnostic:x=>diagnostics.push(x)
}):[];
const ids=rows.map(x=>x.id).sort();
const verified=ids.length===2&&ids.join(',')==='SAMSUNG,SKHYNIX'
 &&rows.every(x=>x.source==='YAHOO_KR_DAILY_REFERENCE'&&x.date===date);
console.log(JSON.stringify({
 kind:'KR_DAILY_REFERENCE_LIVE_READONLY',
 observedKst:date+' '+parts.hour+':'+parts.minute+':'+parts.second,
 source:'YAHOO_KR_DAILY_REFERENCE',notOfficialClose:true,
 status:!enabled?'OUTSIDE_OFFICIAL_REFERENCE_WINDOW'
  :verified?'BOTH_EXACT_DATE_VERIFIED'
  :ids.length?'PARTIAL':'NO_EXACT_DATE_ROW',
 sourceStatus:diagnostics[0]?.status||'NOT_PROBED',
 verifiedIds:ids,expected:2,financialWrites:0,
 gasRequests:0,telegramSends:0,priceValuesLogged:0
}));
