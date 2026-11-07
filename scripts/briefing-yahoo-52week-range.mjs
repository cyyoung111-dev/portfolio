// Optional 52-week high/low for independently dated Yahoo daily OHLC.
// No new hosts, secrets, portfolio data, GAS, or Telegram actions.
// A close-only series or an incomplete 52-week observation cannot qualify.
const RANGE_IDS=new Set(['SOX','VIX','USDKRW','WTI','GOLD','COPPER','BTC']);
const MS_DAY=86400000;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const isDay=s=>typeof s==='string'&&DAY.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const format=n=>n.toLocaleString('en-US',{maximumFractionDigits:2});
export function yahoo52WeekRequested(id){return RANGE_IDS.has(id);}
export function verifiedYahoo52WeekRange(rows,expectedDate){
 if(!Array.isArray(rows)||!isDay(expectedDate))return null;
 const end=Date.parse(expectedDate+'T00:00:00Z');
 const begin=new Date(end-364*MS_DAY).toISOString().slice(0,10);
 const sufficientlyOld=new Date(end-340*MS_DAY).toISOString().slice(0,10);
 const seen=new Set(),eligible=[];
 for(const x of rows){
  if(!isDay(x?.date)||x.date<begin||x.date>expectedDate)continue;
  if(seen.has(x.date))return null; // duplicate candles are ambiguous
  seen.add(x.date);
  if(!positive(x.close)||!positive(x.high)||!positive(x.low)
    ||x.high<x.low||x.close>x.high||x.close<x.low)return null;
  eligible.push(x);
 }
 eligible.sort((a,b)=>a.date.localeCompare(b.date));
 if(eligible.length<150||eligible[0]?.date>sufficientlyOld
    ||eligible.at(-1)?.date!==expectedDate)return null;
 let high=-Infinity,low=Infinity,highDate=null,lowDate=null;
 for(const p of eligible){
  if(p.high>high){high=p.high;highDate=p.date;}
  if(p.low<low){low=p.low;lowDate=p.date;}
 }
 if(!positive(high)||!positive(low)||high<low)return null;
 return {kind:'YAHOO_OHLC_52W_REFERENCE',source:'YAHOO_DAILY_OHLC',
  asOf:expectedDate,from:begin,high,low,highDate,lowDate,
  observations:eligible.length};
}
function validatedRow(id,row,date,expected){
 if(!RANGE_IDS.has(id)||!isDay(expected)||row?.source!=='Yahoo Finance 일봉'
   ||row?.date!==expected||!positive(row.value))return null;
 const r=row.range52w;
 if(!r||r.kind!=='YAHOO_OHLC_52W_REFERENCE'
   ||r.source!=='YAHOO_DAILY_OHLC'||r.asOf!==expected
   ||r.from!==new Date(Date.parse(expected+'T00:00:00Z')-364*MS_DAY).toISOString().slice(0,10)
   ||!positive(r.high)||!positive(r.low)||r.high<r.low
   ||!isDay(r.highDate)||!isDay(r.lowDate)
   ||r.highDate<r.from||r.highDate>r.asOf
   ||r.lowDate<r.from||r.lowDate>r.asOf
   ||!Number.isInteger(r.observations)||r.observations<150||r.observations>367
   ||row.value<r.low||row.value>r.high)return null;
 return r;
}
export function formatMorningYahoo52WeekRanges(map,date,expectedDate,{maxLines=4}={}){
 if(!(map instanceof Map)||!isDay(date)||!Number.isInteger(maxLines)
   ||maxLines<1||maxLines>7||typeof expectedDate!=='function')return [];
 const labels={SOX:'SOX',VIX:'VIX',USDKRW:'원/달러',WTI:'WTI',
  GOLD:'금',COPPER:'구리',BTC:'BTC'};
 const codes={SOX:'^SOX',VIX:'^VIX',USDKRW:'KRW=X',WTI:'CL=F',
  GOLD:'GC=F',COPPER:'HG=F',BTC:'BTC-USD'};
 const verified=[];
 for(const id of ['SOX','VIX','USDKRW','WTI','GOLD','COPPER','BTC']){
  const expected=expectedDate(id,date);
  const row=map.get(codes[id]),r=validatedRow(id,row,date,expected);
  if(!r)continue;
  const position=r.high>r.low?100*(row.value-r.low)/(r.high-r.low):null;
  verified.push('• '+labels[id]+' 52주 고 '+format(r.high)+'/저 '+format(r.low)
   +' · 범위 위치 '+(position===null?'미산정':position.toFixed(0)+'%')
   +' ['+expected+' · Yahoo OHLC 참고]');
  if(verified.length>=maxLines)break;
 }
 return verified.length?['■ 52주 최고·최저 / 범위 내 종가 위치',...verified]:[];
}
