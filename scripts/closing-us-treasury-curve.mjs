// Supplemental, read-only US Treasury constant-maturity daily H.15 series.
// No yield is presented as a live 17:00 price. No stale-day substitution.
import {expectedMorningDate} from './telegram-morning-report.mjs';
import {readOfficialTreasuryPar} from './closing-us-treasury-par.mjs';

const RATES=Object.freeze([
 Object.freeze({id:'UST2Y',code:'DGS2',label:'미 국채 2년'}),
 Object.freeze({id:'UST3Y',code:'DGS3',label:'미 국채 3년'}),
 Object.freeze({id:'UST10Y_FRED',code:'DGS10',label:'미 국채 10년'})
]);
export function parseTreasuryFredCsv(id,expected,source){
 const rate=RATES.find(x=>x.id===id);
 if(!rate||!Number.isFinite(Date.parse(expected+'T00:00:00Z'))
   ||! /^\d{4}-\d{2}-\d{2}$/.test(expected)
   ||typeof source!=='string'||source.length>50000||source.includes('\0'))return null;
 const lines=source.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
 if(lines.length<2||lines.length>400)return null;
 const columns=lines.shift().trim().toUpperCase().split(',').map(x=>x.trim());
 if(columns.length!==2||columns[0]!=='OBSERVATION_DATE'||columns[1]!==rate.code)return null;
 let found=null,matching=0;
 for(const line of lines){
  const cells=line.split(',');
  if(cells[0].trim()!==expected)continue;
  matching++;
  if(cells.length!==2)return null;
  const raw=cells[1].trim();
  if(!/^\d+(?:\.\d{1,3})?$/.test(raw))return null;
  const value=Number(raw);
  if(!Number.isFinite(value)||value<=0||value>=30)return null;
  found={id:rate.id,label:rate.label,date:expected,value,
   source:'FRED_H15_DAILY'};
 }
 return matching===1?found:null;
}
// H.15 rates are published one US business day after their observation.
// Accept only the requested completed session or its immediately preceding
// US weekday; retain the observed date and never call the older row current.
export function treasuryPublishedDates(date){
 const expected=expectedMorningDate('SPX',date);
 if(!expected)return [];
 const prior=expectedMorningDate('SPX',expected);
 return prior?[expected,prior]:[expected];
}
export function verifyTreasuryCurve(date,rows=[]){
 const allowed=treasuryPublishedDates(date);
 if(!allowed.length||!Array.isArray(rows)||rows.length>3)return [];
 const safe=RATES.flatMap(entry=>{
  const matching=rows.filter(r=>r?.id===entry.id);
  if(matching.length!==1)return [];
  const x=matching[0];
  if(x.label!==entry.label||!allowed.includes(x.date)||!['FRED_H15_DAILY','US_TREASURY_PAR_DAILY'].includes(x.source)
    ||!Number.isFinite(x.value)||x.value<=0||x.value>=30)return [];
  return [{id:x.id,label:x.label,date:x.date,value:x.value,source:x.source}];
 });
 // H.15 constant-maturity and Treasury PAR are different yield measures.
 // Treat caller-supplied mixed-source rates as unverified, not arithmetic inputs.
 return new Set(safe.map(x=>x.source)).size>1?[]:safe;
}
export async function readTreasuryCurve(date,{fetchImpl=fetch,onDiagnostic=()=>{}}={}){
 const permitted=treasuryPublishedDates(date),expected=permitted[0];
 const emit=(id,status)=>{try{onDiagnostic({kind:'FRED_TREASURY_READ',id,status});}catch{}};
 if(!expected){
  for(const rate of RATES)emit(rate.id,'SESSION_UNVERIFIED');
  return [];
 }
 const from=new Date(Date.parse(expected+'T00:00:00Z')-21*86400000).toISOString().slice(0,10);
 const found=await Promise.all(RATES.map(async entry=>{
  const url=new URL('https://fred.stlouisfed.org/graph/fredgraph.csv');
  url.searchParams.set('id',entry.code);
  url.searchParams.set('cosd',from);
  url.searchParams.set('coed',expected);
  try{
   const response=await fetchImpl(url.href,{redirect:'error',
    headers:{accept:'text/csv'},signal:AbortSignal.timeout(6500)});
   if(!response?.ok){emit(entry.id,'HTTP_UNAVAILABLE');return null;}
   const type=response.headers?.get?.('content-type')||'';
   if(type&&!/csv|plain|octet-stream/i.test(type)){
    emit(entry.id,'CONTENT_TYPE_INVALID');return null;
   }
   const csv=await response.text();
   const row=permitted.map(day=>parseTreasuryFredCsv(entry.id,day,csv))
    .find(Boolean)||null;
   emit(entry.id,!row?'NO_EXACT_VALID_ROW'
    :row.date===expected?'VERIFIED':'PUBLISHED_PRIOR_SESSION');
   return row;
  }catch{emit(entry.id,'NETWORK_OR_PARSE_FAILED');return null;}
 }));
 const fred=found.filter(Boolean);
 if(fred.length===3)return fred;
 // Treasury PAR is a distinct official measure. Never mix data sources in
 // a displayed 10Y–2Y spread: choose the more complete whole-source set.
 const par=await readOfficialTreasuryPar(permitted,{fetchImpl,onDiagnostic});
 return par.length===3?par:(fred.length>=par.length?fred:par);
}
export function formatTreasuryCurve(date,rows=[]){
 const safe=verifyTreasuryCurve(date,rows);
 const expected=treasuryPublishedDates(date)[0];
 const lines=['■ 미국 국채금리 (FRED H.15 / 미 재무부 Par · 최근 발표 관측일)'];
 for(const entry of RATES){
  const x=safe.find(r=>r.id===entry.id);
  lines.push(entry.label+': '+(x?x.value.toFixed(2)+'% ['+x.date
    +(x.date===expected?'':' · 발표 지연 자료')+']'
    +(x.source==='US_TREASURY_PAR_DAILY'?' (미 재무부 Par)':'')
    :'최근 허용 관측일 자료 미확보'));
 }
 const d2=safe.find(x=>x.id==='UST2Y'),d10=safe.find(x=>x.id==='UST10Y_FRED');
 if(d2&&d10&&d2.date===d10.date&&d2.source===d10.source){
  const bp=Math.round((d10.value-d2.value)*100);
  lines.push('장단기금리차 (10Y–2Y): '+(bp>=0?'+':'')+bp+'bp ['+d2.date+']');
 }else lines.push('장단기금리차 (10Y–2Y): 동일 기준일 자료 미확보');
 return lines.join('\n');
}
