// One-time readonly probe of the public Shinhan HTML endpoint, no credentials.
import {probeShinhanIndexEod} from './shinhan-korean-index-eod.mjs';
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
if(today!=='2026-10-30'){console.log(JSON.stringify({status:'SHINHAN_PROBE_DATE_EXPIRED'}));process.exit(0);}
const probe=await probeShinhanIndexEod(today);
const latest=probe.data;
console.log(JSON.stringify(latest
 ?{status:'SHINHAN_LIVE_POSTCLOSE_READBACK',decode:probe.status,
   source:latest.source,date:latest.date,publishedAt:latest.publishedAt,
   values:latest.values,readOnly:true}
 :{status:'SHINHAN_LIVE_UNAVAILABLE',reason:probe.status,date:today,readOnly:true}));
