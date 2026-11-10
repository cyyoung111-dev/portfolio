import {qualifyPublicMarketQuote,qualifyPublicStockDailyReference} from './qualify-public-market-session.mjs';
// Public market reference reconnaissance only. Never writes finance data or
// claims a quote is KRX confirmed. All output is schema/date/status metadata.
const stamp=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',
 year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
 second:'2-digit',hourCycle:'h23'}).format(new Date());
const session=stamp().slice(0,10);
const queries=[
 ['NAVER_POLL_INDEX','https://polling.finance.naver.com/api/realtime?query=SERVICE_INDEX%3AKOSPI%2CKOSDAQ%2CKPI200'],
 ['NAVER_POLL_STOCK','https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM%3A005930%2C000660'],
 ['NAVER_PC_SUMMARY','https://finance.naver.com/main/mainSummary.naver'],
 ['NAVER_V1_KOSPI_BREADTH','https://stock.naver.com/api/securityService/integration/v1/indicators?domesticIndexCodes=KOSPI&includeBreadth=true&includeTrend=true'],
 ['NAVER_V1_KOSDAQ_BREADTH','https://stock.naver.com/api/securityService/integration/v1/indicators?domesticIndexCodes=KOSDAQ&includeBreadth=true&includeTrend=true'],
 ['NAVER_INDEX_POLL_V2','https://stock.naver.com/api/polling/domestic/index?itemCodes=KOSPI,KOSDAQ,KPI200'],
 ['NAVER_INDEX_MAJOR','https://stock.naver.com/api/securityFe/api/index/majors'],
 ['NAVER_MOBILE_KOSPI','https://m.stock.naver.com/front-api/stock/domestic/basic?code=KOSPI&endType=index'],
 ['NAVER_MOBILE_KOSDAQ','https://m.stock.naver.com/front-api/stock/domestic/basic?code=KOSDAQ&endType=index'],
 ['NAVER_MOBILE_SAMSUNG','https://m.stock.naver.com/front-api/stock/domestic/basic?code=005930&endType=stock'],
 ['NAVER_MOBILE_HYNIX','https://m.stock.naver.com/front-api/stock/domestic/basic?code=000660&endType=stock'],
 ['NAVER_STOCK_DAILY_SAMSUNG','https://m.stock.naver.com/api/stock/005930/price?pageSize=5&page=1'],
 ['NAVER_STOCK_DAILY_HYNIX','https://m.stock.naver.com/api/stock/000660/price?pageSize=5&page=1'],
 ['NAVER_KOSPI_DAILY','https://m.stock.naver.com/front-api/stock/domestic/index/price/list?code=KOSPI&page=1&pageSize=5'],
 ];
const safeKeys=o=>o&&typeof o==='object'&&!Array.isArray(o)
 ?Object.keys(o).filter(k=>/^[a-zA-Z][a-zA-Z0-9_]{0,44}$/.test(k)).slice(0,26):[];
const marketRe=/^(?:KOSPI|KOSDAQ|KPI200|005930|000660)$/;
function inspect(data){
 const rootKeys=safeKeys(data);
 const dates=[],ids=new Set(),valueFields=new Set(),keys=new Set(),quotes=[];
 const stack=[{value:data,path:'root',depth:0}],seen=new Set();
 let visited=0;
 while(stack.length&&visited<1200){
  let {value,path,depth}=stack.pop();visited++;
  if(!value||typeof value!=='object'||seen.has(value)||depth>7)continue;
  seen.add(value);
  const qualified=qualifyPublicMarketQuote(value,session);
  if(qualified&&quotes.length<12)quotes.push(qualified);
  const entries=Array.isArray(value)?value.slice(0,18).map((v,i)=>[String(i),v])
    :Object.entries(value).slice(0,55);
  for(const [key,v] of entries){
   if(/^[a-zA-Z][a-zA-Z0-9_]{0,44}$/.test(key))keys.add(key);
   if(typeof v==='string'){
    if(marketRe.test(v))ids.add(v);
    if(/(?:date|time|at|session|updated|bizdate|traded)/i.test(key)
      &&(/^20\d{2}[-/.]?\d{2}[-/.]?\d{2}/.test(v)
      ||/^\d{1,2}:\d{2}/.test(v)))
      dates.push({field:key,value:v.slice(0,32)});
   }else if((typeof v==='number'||typeof v==='string')
    &&/(?:accTrd|tradeValue|tradingValue|volume|closePrice|currentPrice|tradedAt|nv|aa|aq|bs|cd)/i.test(key))
     valueFields.add(key);
   if(depth<7&&v&&typeof v==='object')stack.push({value:v,path:path+'.'+key,depth:depth+1});
  }
 }
 const uniqDates=[...new Map(dates.map(d=>[d.field+':'+d.value,d])).values()].slice(0,22);
 // Date markers elsewhere in a payload cannot establish a direct, current
 // market quote. Especially reject timestamps from nested NXT overlays.
 const sameDayQuote=quotes.some(x=>x.hasSameDayDirectQuote);
 return {rootKeys,foundMarketIds:[...ids],availableFields:[...valueFields].slice(0,28),
  dateMarkers:uniqDates,hasSameDayTimestamp:sameDayQuote,
  hasSameDayDirectQuote:sameDayQuote,
  indexCloseReferenceCount:quotes.filter(x=>x.qualification===
    'INDEX_CLOSE_REFERENCE_NOT_KRX_RECONCILED').length,
  sampleFieldNames:[...keys].slice(0,34),quoteSessionEvidence:quotes,inspectedNodes:visited};
}
async function probe([id,url]){
 const began=Date.now(),atKst=stamp();
 try{
  const response=await fetch(url,{method:'GET',headers:{accept:'application/json,text/plain,*/*',
    'user-agent':'Mozilla/5.0',referer:'https://stock.naver.com/'},
    redirect:'follow',signal:AbortSignal.timeout(8500)});
  const type=String(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
  const host=new URL(response.url).hostname;
  const finalHost=['stock.naver.com','polling.finance.naver.com','finance.naver.com',
    'm.stock.naver.com'].includes(host)?host:'OTHER';
  if(!response.ok)return {id,atKst,http:response.status,type,finalHost,
    result:'HTTP_REJECTED',durationMs:Date.now()-began};
  const size=Number(response.headers.get('content-length')||0);
  if(size>1500000)return {id,atKst,http:response.status,type,finalHost,
    result:'OVERSIZE',durationMs:Date.now()-began};
  const raw=await response.text();
  let obj;
  try{obj=JSON.parse(raw);}catch{return {id,atKst,http:response.status,type,
    finalHost,result:raw.trimStart().startsWith('<')?'HTML_NOT_JSON':'NOT_JSON',
    durationMs:Date.now()-began};}
  return {id,atKst,http:response.status,type,finalHost,result:'JSON_PARSED',
    durationMs:Date.now()-began,...inspect(obj),
    stockDailyReference:qualifyPublicStockDailyReference(obj,id,session)};
 }catch(err){return {id,atKst,result:
   ['TimeoutError','AbortError'].includes(err?.name)?'TIMEOUT':'NETWORK_FAILURE',
   durationMs:Date.now()-began};}
}
const results=[];
for(let i=0;i<queries.length;i+=4){
 const rows=await Promise.all(queries.slice(i,i+4).map(probe));
 for(const r of rows){results.push(r);console.log(JSON.stringify({kind:'TIMELINESS_SOURCE_CANDIDATE',...r}));}
}
console.log(JSON.stringify({kind:'TIMELINESS_CANDIDATES_FINISHED',observedAtKst:stamp(),
 sameDayDirectQuoteSources:results.filter(x=>x.result==='JSON_PARSED'&&x.hasSameDayDirectQuote).length,
 indexCloseReferenceSources:results.filter(x=>x.result==='JSON_PARSED'&&x.indexCloseReferenceCount>0).length,
 sameDayDailyStockBarSources:results.filter(x=>x.result==='JSON_PARSED'&&x.stockDailyReference?.hasExactDateBar).length,
 jsonCount:results.filter(x=>x.result==='JSON_PARSED').length,
 tested:results.length,priceWrites:0,telegramSends:0,gasWrites:0}));
