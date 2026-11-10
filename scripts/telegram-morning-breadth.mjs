// KRX official daily stock-breadth reference. Separate from portfolio closes.
// Uses an optional pre-existing KRX key; NEVER fetches NH credentials, GAS
// writers or historical 20-day data in the 07:40 delivery critical path.
import {expectedMorningDate} from './telegram-morning-report.mjs';
import {krxSessionStatus} from './krx-session-calendar.mjs';
const SOURCE='KRX_OFFICIAL_STOCK_DAILY';
const MARKETS=Object.freeze([
 Object.freeze({id:'KOSPI',path:'/svc/apis/sto/stk_bydd_trd',minRows:400}),
 Object.freeze({id:'KOSDAQ',path:'/svc/apis/sto/ksq_bydd_trd',minRows:600})
]);
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const strictDate=s=>typeof s==='string'&&DAY.test(s)
 &&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const signed=raw=>typeof raw==='string'
 &&/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw.replaceAll(',',''))
 &&Number.isFinite(Number(raw.replaceAll(',','')))
 ?Number(raw.replaceAll(',','')):null;
const price=raw=>typeof raw==='string'&&/^\d[\d,]*(?:\.\d+)?$/.test(raw)
 &&Number(raw.replaceAll(',',''))>0 ?Number(raw.replaceAll(',','')):null;
export function parseKrxBreadth(date,market,data){
 const spec=MARKETS.find(x=>x.id===market);
 if(!spec||!strictDate(date)||krxSessionStatus(date)!=='OPEN'
  ||!Array.isArray(data?.OutBlock_1)||data.OutBlock_1.length<spec.minRows
  ||data.OutBlock_1.length>4500)return null;
 let advances=0,declines=0,unchanged=0,excluded=0;
 const unique=new Set();
 for(const row of data.OutBlock_1){
  if(row?.BAS_DD!==date.replaceAll('-','')||typeof row.ISU_CD!=='string'
   ||!row.ISU_CD||unique.has(row.ISU_CD))return null;
  unique.add(row.ISU_CD);
  const p=price(row.TDD_CLSPRC),delta=signed(row.CMPPREVDD_PRC);
  if(p===null||delta===null){excluded++;continue;}
  if(delta>0)advances++;else if(delta<0)declines++;else unchanged++;
 }
 if(advances+declines+unchanged<spec.minRows)return null;
 return Object.freeze({id:market,date,source:SOURCE,
  advances,declines,unchanged,excluded,issues:unique.size,
  role:'NON_NH_REFERENCE_ONLY'});
}
export function verifyKrxBreadth(date,rows=[]){
 if(!strictDate(date)||!Array.isArray(rows)||rows.length>2)return [];
 return MARKETS.flatMap(spec=>{
  const found=rows.filter(x=>x?.id===spec.id);
  if(found.length!==1)return [];
  const x=found[0];
  if(x.date!==date||x.source!==SOURCE||x.role!=='NON_NH_REFERENCE_ONLY'
   ||![x.advances,x.declines,x.unchanged,x.excluded,x.issues]
    .every(Number.isSafeInteger)
   ||[x.advances,x.declines,x.unchanged,x.excluded].some(v=>v<0)
   ||x.issues!==x.advances+x.declines+x.unchanged+x.excluded
   ||x.advances+x.declines+x.unchanged<spec.minRows)return [];
  return [x];
 });
}
export async function readMorningBreadth(date,{authKey=process.env.KRX_AUTH_KEY,
 fetchImpl=fetch,now=()=>new Date()}={}){
 const expected=expectedMorningDate('KOSPI',date);
 if(!expected||!strictDate(expected)||!strictDate(date)
  ||typeof authKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(authKey)
  ||now().getTime()<Date.parse(date+'T06:30:00+09:00'))return [];
 // Two authenticated daily EOD endpoints, bounded. Missing KRX credentials
 // means exactly zero requests, not a public-site scraping fallback.
 const result=await Promise.all(MARKETS.map(async spec=>{
  const target=new URL('https://data-dbg.krx.co.kr'+spec.path);
  target.searchParams.set('basDd',expected.replaceAll('-',''));
  try{
   const resp=await fetchImpl(target.href,{
    headers:{AUTH_KEY:authKey,accept:'application/json'},
    redirect:'error',signal:AbortSignal.timeout(4500)});
   if(!resp?.ok||Number(resp.headers?.get?.('content-length')||0)>2500000)return null;
   return parseKrxBreadth(expected,spec.id,await resp.json());
  }catch{return null;}
 }));
 return verifyKrxBreadth(expected,result.filter(Boolean));
}
export function formatMorningBreadth(date,rows=[]){
 const expected=expectedMorningDate('KOSPI',date),valid=verifyKrxBreadth(expected,rows);
 const text=MARKETS.map(m=>{
  const x=valid.find(v=>v.id===m.id);
  return m.id+' '+(x?x.advances+'↑/'+x.declines+'↓/'+x.unchanged+'→':'미확보');
 }).join(' · ');
 // ADR20 needs a separate 20-session validated history. Never append a
 // static 'unconnected' warning to a valid current-session A/D report.
 return '시장폭 A/D: '+text+(valid.length?' ['+expected+' · KRX 참고]':' (공식 일봉 미검증)');
}
// ADR20 must be calculated only from 20 DISTINCT, verified completed sessions,
// never from a single day's A/D or a stale value carried forward.
export function calculateAdr20(rows,market){
 const series=rows.filter(r=>r?.id===market),unique=new Set(series.map(r=>r.date));
 if(series.length!==20||unique.size!==20||!series.every(x=>
   verifyKrxBreadth(x.date,[x]).length===1))return null;
 const sorted=[...unique].sort(),up=series.reduce((n,x)=>n+x.advances,0),
   down=series.reduce((n,x)=>n+x.declines,0);
 return down>0&&up>0?{market,from:sorted[0],to:sorted.at(-1),
   value:Math.round(up/down*10000)/100,source:SOURCE}:null;
}
