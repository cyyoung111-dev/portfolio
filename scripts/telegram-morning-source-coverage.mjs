// Safe operational telemetry for the *actual* prepared Telegram message.
// Log only IDs, expected dates and approved source categories. Never log
// prices, message bodies, NH/GAS/Telegram credentials, or account data.
import {MORNING_SERIES,expectedMorningDate} from './telegram-morning-report.mjs';

const SOURCE_LABELS=Object.freeze({
 'KRX 공식':'KRX_OFFICIAL',
 'GAS 원장':'MARKET_MASTER',
 'NH PLUG 일봉':'NH_INDEX_DAILY',
 'NH PLUG 확정 종가(저장 이력)':'NH_REGULAR_CLOSE',
 'FDR·KRX 참고 종가':'FDR_KRX_CACHE',
 'Yahoo 일봉':'YAHOO_DAILY_REFERENCE'
});
export function inspectMorningMessage(date,message,{now=new Date(date+'T07:40:00+09:00')}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||''))
  ||!(now instanceof Date)||!Number.isFinite(now.getTime())
  ||typeof message!=='string')return null;
 const lines=message.split('\n');
 const qcLine=lines.find(x=>x.startsWith('■ QC: 기준 거래일과 일치한 일봉 '));
 const qc=/^■ QC: 기준 거래일과 일치한 일봉 (\d+)\/(\d+) · NH 야선 (확보|미확보)$/.exec(qcLine||'');
 if(!qc||Number(qc[2])!==MORNING_SERIES.length)return null;
 const statuses=[],sourceCounts={};
 for(const item of MORNING_SERIES){
  const fields=lines.filter(line=>line.startsWith(item.label+': '));
  const expected=expectedMorningDate(item.id,date,now);
  if(fields.length!==1||!expected){
   statuses.push({id:item.id,status:'NO_VERIFIED_ROW',expectedDate:expected});continue;
  }
  const line=fields[0];
  const bracket=/\[([0-9]{4}-[0-9]{2}-[0-9]{2}) · (.+)\]$/.exec(line);
  const source=bracket?SOURCE_LABELS[bracket[2]]:null;
  if(line.includes('미확보')||!bracket||bracket[1]!==expected||!source){
   statuses.push({id:item.id,status:'NO_VERIFIED_ROW',expectedDate:expected});continue;
  }
  statuses.push({id:item.id,status:'VERIFIED',expectedDate:expected,source});
  sourceCounts[source]=(sourceCounts[source]||0)+1;
 }
 const actual=statuses.filter(x=>x.status==='VERIFIED').length;
 // Do not publish misleading telemetry if formatter's QC disagrees with the
 // displayed message (e.g. bad Treasury yield unit, malformed source/date).
 const consistent=Number(qc[1])===actual;
 return {
  schemaVersion:1,verified:actual,total:MORNING_SERIES.length,
  status:consistent?'MATCHED_FORMATTED_QC':'QC_MISMATCH',
  missing:statuses.filter(x=>x.status!=='VERIFIED').map(x=>({id:x.id,expectedDate:x.expectedDate,reason:x.status})),
  sourceCounts,nhNightReference:qc[3]==='확보'?'VERIFIED':'NOT_VERIFIED',
  // Never construe a later audit as on-time market availability.
  observedInActualPrepare:true
 };
}
