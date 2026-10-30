(function(global){
'use strict';
// Third-party published KRX index cache (FinanceDataReader); never an NH quote.
// A current-day CSV row is NOT a close until a post-15:40 KST publication is evidenced.
const SYMBOLS=Object.freeze({KOSPI:'ks11',KOSDAQ:'kq11',KOSPI200:'ks200'});
const BASE='https://raw.githubusercontent.com/FinanceData/fdr_krx_data_cache/refs/heads/master/data/index/';
const META='https://api.github.com/repos/FinanceData/fdr_krx_data_cache/commits';
const SOURCE='FDR_KRX_CACHE';
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MAX_CSV=250000;
function validDate(s){
 if(typeof s!=='string'||!DATE.test(s))return false;
 const n=Date.parse(s+'T00:00:00Z');
 return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===s;
}
function kstDate(instant){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant).map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
}
function parseYearCsv(csv,year){
 if(typeof csv!=='string'||csv.length>MAX_CSV||csv.includes('\0'))throw Error('INDEX_CSV_INVALID');
 const lines=csv.replace(/^\uFEFF/,'').trim().split(/\r?\n/),headers=lines.shift()?.split(',').map(x=>x.trim());
 if(!headers||headers[0]!=='Date'||headers[1]!=='Close'||lines.length>400||!lines.length)throw Error('INDEX_CSV_SCHEMA');
 const rows=[],seen=new Set();
 for(const line of lines){
  const cols=line.split(','),day=String(cols[0]||''),raw=String(cols[1]||'').trim();
  if(!validDate(day)||day.slice(0,4)!==String(year)||seen.has(day))throw Error('INDEX_CSV_DATE');
  seen.add(day);
  if(!/^\d+(?:\.\d+)?$/.test(raw)||!Number.isFinite(Number(raw))||Number(raw)<=0)throw Error('INDEX_CSV_PRICE');
  rows.push({date:day,value:Number(raw)});
 }
 return rows.sort((a,b)=>a.date.localeCompare(b.date));
}
function approvedRows(rows,publishedAt,asOf){
 const stamp=Date.parse(publishedAt||'');
 if(!Number.isFinite(stamp))return [];
 return rows.filter(row=>row.date<=asOf && stamp>=Date.parse(row.date+'T15:40:00+09:00'));
}
async function fetchChecked(url,fetchImpl,kind){
 const res=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(9000)});
 if(!res?.ok)throw Error('INDEX_'+kind+'_HTTP_'+(res?.status||'UNKNOWN'));
 return res;
}
async function loadSeries(types,from,to,{fetchImpl=fetch,now=()=>new Date()}={}){
 if(!validDate(from)||!validDate(to)||from>to)throw Error('INDEX_RANGE_INVALID');
 const today=kstDate(now());if(from>today)throw Error('INDEX_RANGE_INVALID');if(to>today)to=today;
 const out={seriesMap:{},errors:{},source:SOURCE};
 const requested=[...new Set(types)].filter(t=>Object.hasOwn(SYMBOLS,t));
 if(!requested.length)return out;
 const years=Number(to.slice(0,4))-Number(from.slice(0,4))+1;
 if(years<1||years>31)throw Error('INDEX_RANGE_TOO_WIDE');
 await Promise.all(requested.map(async type=>{
  const symbol=SYMBOLS[type],found=[],failures=[];
  for(let year=Number(from.slice(0,4));year<=Number(to.slice(0,4));year++){
   try {
    const filename='year_'+symbol+'/'+year+'.csv';
    let csvUrl=BASE+filename;
    let stamp=null;
    if(year===Number(today.slice(0,4))){
     // Resolve immutable revision BEFORE reading the CSV. Never validate a
     // mutable master CSV with an unrelated later commit's timestamp.
     const u=new URL(META);u.searchParams.set('path','data/index/'+filename);u.searchParams.set('per_page','1');
     const response=await fetchChecked(u.href,fetchImpl,'PROVENANCE');
     const records=await response.json();
     if(!Array.isArray(records)||records.length!==1)throw Error('INDEX_PUBLICATION_UNKNOWN');
     const commit=records[0],hash=commit?.sha;
     stamp=commit?.commit?.committer?.date;
     const publishedMs=Date.parse(stamp||'');
     if(!/^[0-9a-f]{40}$/.test(String(hash||''))||!Number.isFinite(publishedMs)
       ||publishedMs>now().getTime())throw Error('INDEX_PUBLICATION_UNKNOWN');
     csvUrl='https://raw.githubusercontent.com/FinanceData/fdr_krx_data_cache/'+hash+'/data/index/'+filename;
    }
    const csv=await (await fetchChecked(csvUrl,fetchImpl,'DATA')).text();
    const rows=parseYearCsv(csv,year);
    let released=rows;
    if(stamp!==null){
     released=approvedRows(rows,stamp,today);
     if(!released.length)failures.push('NO_POST_CLOSE_PUBLICATION');
    }
    found.push(...released.filter(row=>row.date>=from&&row.date<=to).map(row=>({
     ...row,source:SOURCE,sourceDate:row.date,role:'NON_NH_DAILY_INDEX',
     priceType:'PUBLISHED_EOD_REFERENCE'
    })));
   }catch(e){failures.push(String(e.message||'INDEX_SOURCE_UNAVAILABLE').slice(0,90));}
  }
  out.seriesMap[type]=found.sort((a,b)=>a.date.localeCompare(b.date));
  if(!found.length)out.errors[type]=failures.join(';')||'INDEX_DATE_UNAVAILABLE';
 }));
 return out;
}
const api={SYMBOLS,SOURCE,validDate,parseYearCsv,approvedRows,loadSeries};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
global.DomesticIndexEod=api;
})(typeof globalThis!=='undefined'?globalThis:this);
