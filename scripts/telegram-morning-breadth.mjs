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
// KRX stock daily OHLC is conservatively release-eligible on the NEXT
// KRX open day at 08:15 KST. The 07:40 morning briefing must not ask for
// yesterday's not-yet-release-eligible date and mislabel it "missing".
// This only chooses a date: source rows still require exact official proof.
export function morningBreadthPublishedDate(date,instant=new Date()){
 if(!strictDate(date)||krxSessionStatus(date)!=='OPEN'
  ||!(instant instanceof Date)||!Number.isFinite(instant.getTime()))return null;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(instant).map(p=>[p.type,p.value]));
 if(parts.year+'-'+parts.month+'-'+parts.day!==date)return null;
 const prior=expectedMorningDate('KOSPI',date);
 if(!strictDate(prior)||krxSessionStatus(prior)!=='OPEN')return null;
 const mins=Number(parts.hour)*60+Number(parts.minute);
 const eligible=mins>=8*60+15?prior:expectedMorningDate('KOSPI',prior);
 return strictDate(eligible)&&krxSessionStatus(eligible)==='OPEN'?eligible:null;
}
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
 fetchImpl=fetch,now=()=>new Date(),onDiagnostic=()=>{}}={}){
 const emit=(status,market=null)=>{try{onDiagnostic({source:'BREADTH',status,
  ...(market?{market}:{})});}catch{}};
 const instant=now(),expected=morningBreadthPublishedDate(date,instant);
 if(!expected||instant.getTime()<Date.parse(date+'T06:30:00+09:00')){
  emit('SESSION_UNVERIFIED');return [];
 }
 if(typeof authKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(authKey)){
  emit('KEY_UNAVAILABLE');return [];
 }
 // Both authenticated daily EOD endpoints; no additional call introduced.
 const result=await Promise.all(MARKETS.map(async spec=>{
  const target=new URL('https://data-dbg.krx.co.kr'+spec.path);
  target.searchParams.set('basDd',expected.replaceAll('-',''));
  for(let attempt=0;attempt<2;attempt++){
   try{
    const resp=await fetchImpl(target.href,{
     headers:{AUTH_KEY:authKey,accept:'application/json'},
     redirect:'error',signal:AbortSignal.timeout(6000)});
    if(!resp?.ok){
     if(attempt===0&&[429,502,503,504].includes(resp?.status))continue;
     emit([401,403].includes(resp?.status)
      ?'KRX_DIRECT_ACCESS_DENIED':'KRX_DIRECT_HTTP_UNAVAILABLE',spec.id);
     return null;
    }
    if(Number(resp.headers?.get?.('content-length')||0)>2500000){
     emit('PAYLOAD_UNVERIFIED',spec.id);return null;
    }
    const row=parseKrxBreadth(expected,spec.id,await resp.json());
    emit(row?'VERIFIED':'NO_EXACT_ROW',spec.id);
    return row;
   }catch{
    if(attempt===1){emit('NETWORK_OR_PARSE_FAILED',spec.id);return null;}
   }
  }
  return null;
 }));
 return verifyKrxBreadth(expected,result.filter(Boolean));
}
export function formatMorningBreadth(date,rows=[],
 now=new Date(date+'T07:40:00+09:00')){
 const expected=morningBreadthPublishedDate(date,now);
 const valid=expected?verifyKrxBreadth(expected,rows):[];
 const text=MARKETS.map(m=>{
  const x=valid.find(v=>v.id===m.id);
  return m.id+' '+(x?x.advances+'↑/'+x.declines+'↓/'+x.unchanged+'→':'미확보');
 }).join(' · ');
 // ADR20 needs a separate 20-session validated history. Never append a
 // static 'unconnected' warning to a valid current-session A/D report.
 const prior=expectedMorningDate('KOSPI',date);
 const releaseLag=valid.length&&expected!==prior?' · 최신 공표가능 거래일':'';
 return '시장폭 A/D: '+text+(valid.length?' ['+expected+' · KRX 참고'+releaseLag+']':' (공식 일봉 미검증)');
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
