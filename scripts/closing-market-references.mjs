import {expectedMorningDate} from './telegram-morning-report.mjs';
import {fetchDatedDaily} from './telegram-morning-briefing.mjs';
import {closingStockSessions} from './closing-extra-daily-sources.mjs';

// These are Yahoo *completed daily candles*, not live prices or official
// commodity-futures settlement prices; BTC is a completed UTC calendar day.
export const CLOSE_MARKET_REFERENCES=Object.freeze([
 Object.freeze({id:'WTI',label:'WTI',symbol:'CL=F',unit:' USD/bbl'}),
 Object.freeze({id:'BRENT',label:'Brent',symbol:'BZ=F',unit:' USD/bbl'}),
 Object.freeze({id:'GOLD',label:'금',symbol:'GC=F',unit:' USD/oz'}),
 Object.freeze({id:'COPPER',label:'구리',symbol:'HG=F',unit:' USD/lb'}),
 Object.freeze({id:'BTC',label:'BTC',symbol:'BTC-USD',unit:' USD'})
]);
export function expectedClosingMarketDate(id,date){
 if(!CLOSE_MARKET_REFERENCES.some(x=>x.id===id)||!closingStockSessions(date))return null;
 // At 17:00 KST the prior UTC daily BTC candle has completed (09:00 KST).
 return expectedMorningDate(id,date,new Date(date+'T17:00:00+09:00'));
}
export function validateClosingMarketReference(date,id,row){
 const item=CLOSE_MARKET_REFERENCES.find(x=>x.id===id);
 const expected=expectedClosingMarketDate(id,date);
 if(!item||!expected||row?.label!==item.label||row.symbol!==item.symbol
   ||!['Yahoo Finance 일봉','YAHOO_DAILY_REFERENCE'].includes(row.source)
   ||row.date!==expected||!Number.isFinite(row.value)||row.value<=0
   ||!(row.changePercent==null||Number.isFinite(row.changePercent)))return null;
 return {id,label:item.label,symbol:item.symbol,date:expected,value:row.value,
  changePercent:row.changePercent??null,source:'YAHOO_DAILY_REFERENCE'};
}
export async function readClosingMarketReferences(date,{fetchImpl=fetch,now=()=>new Date(),
 fetchDaily=fetchDatedDaily}={}){
 if(!closingStockSessions(date))return [];
 const fetched=await Promise.all(CLOSE_MARKET_REFERENCES.map(async item=>{
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
   try{
    const row=await fetchDaily(item.label,item.symbol,date,{fetchImpl,now:now(),host});
    const verified=validateClosingMarketReference(date,item.id,row);
    if(verified)return verified;
   }catch{/* no unverified prices */}
  }
  return null;
 }));
 return fetched.filter(Boolean);
}
export function formatClosingMarketReferences(date,rows=[]){
 const lines=['■ 원자재·BTC (Yahoo 완료 일봉 참고 · 실시간/공식 정산가 아님)'];
 for(const item of CLOSE_MARKET_REFERENCES){
  const valid=Array.isArray(rows)?rows.filter(x=>x?.id===item.id)
   .map(x=>validateClosingMarketReference(date,item.id,x)).filter(Boolean):[];
  if(valid.length!==1){lines.push(item.label+': 검증된 완료 일봉 미확보');continue;}
  const x=valid[0];
  const amount=x.value.toLocaleString('en-US',{maximumFractionDigits:2});
  const change=Number.isFinite(x.changePercent)
   ?' ('+(x.changePercent>=0?'+':'')+x.changePercent.toFixed(2)+'%)':'';
  const period=item.id==='BTC'?'UTC 일봉':'완료 거래일 일봉';
  lines.push(item.label+': '+amount+item.unit+change+' ['+x.date+' · '+period+']');
 }
 return lines.join('\n');
}
