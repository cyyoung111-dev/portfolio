// One-time readonly probe of the public Shinhan HTML endpoint, no credentials.
import {fetchShinhanIndexEod} from './shinhan-korean-index-eod.mjs';
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
if(today!=='2026-10-30'){console.log(JSON.stringify({status:'SHINHAN_PROBE_DATE_EXPIRED'}));process.exit(0);}
const latest=await fetchShinhanIndexEod(today);
console.log(JSON.stringify(latest
 ?{status:'SHINHAN_LIVE_POSTCLOSE_READBACK',source:latest.source,date:latest.date,
   publishedAt:latest.publishedAt,values:latest.values,readOnly:true}
 :{status:'SHINHAN_LIVE_UNAVAILABLE',date:today,readOnly:true}));
