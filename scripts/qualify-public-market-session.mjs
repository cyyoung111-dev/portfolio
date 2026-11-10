// Qualification only: public Naver quotes are NOT KRX official EOD records.
// Never promotes a source to a production price, volume, or turnover provider.
const IDS=new Set(['KOSPI','KOSDAQ','KPI200','005930','000660']);
const INDEX=new Set(['KOSPI','KOSDAQ','KPI200']);
const datePattern=/^20\d{2}-\d{2}-\d{2}$/;
const isoKst=/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+09:00$/;

function fieldCode(x){
 if(typeof x==='string')return x.slice(0,35);
 if(x&&typeof x==='object'&&!Array.isArray(x)){
  const value=x.code??x.value??x.type;
  return typeof value==='string'?value.slice(0,35):null;
 }
 return null;
}
export function qualifyPublicMarketQuote(row,expectedKstDate){
 if(!row||typeof row!=='object'||Array.isArray(row)
  ||typeof expectedKstDate!=='string'||!datePattern.test(expectedKstDate))return null;
 const code=row.itemCode??row.cd;
 if(typeof code!=='string'||!IDS.has(code))return null;
 const isIndex=INDEX.has(code),exchange=fieldCode(row.stockExchangeType);
 const status=fieldCode(row.marketStatus);
 const at=typeof row.localTradedAt==='string'&&isoKst.test(row.localTradedAt)
  ?row.localTradedAt.slice(0,35):null;
 // A nested NXT overlay timestamp is not the KRX regular-session timestamp.
 const sameDay=Boolean(at&&at.slice(0,10)===expectedKstDate);
 const hasClosePrice=row.closePrice!==undefined&&row.closePrice!==null;
 const hasTradingValue=row.accumulatedTradingValue!==undefined
  ||row.accumulatedTradingValueRaw!==undefined||row.aa!==undefined;
 let qualification='NO_DIRECT_KST_QUOTE_TIMESTAMP';
 if(at&&!sameDay)qualification='QUOTE_DATE_MISMATCH';
 else if(sameDay&&isIndex&&hasClosePrice&&status==='CLOSE')
  qualification='INDEX_CLOSE_REFERENCE_NOT_KRX_RECONCILED';
 else if(sameDay)qualification='SESSION_OR_PRICE_UNVERIFIED';
 return {code,exchange,status,at,type:fieldCode(row.priceDataType),
  hasClosePrice,hasTradingValue,hasNxtOverlay:Boolean(row.nxtOverMarketPriceInfo),
  hasSameDayDirectQuote:sameDay,qualification,
  // Index accumulated trading value is not proven to equal whole-market turnover.
  tradingValueScope:!hasTradingValue?'NOT_EXPOSED':
   isIndex?'INDEX_COMPONENT_SCOPE_UNRECONCILED':'STOCK_SESSION_SCOPE_UNRECONCILED'};
}
const DAILY_STOCK_SOURCES=Object.freeze({
 NAVER_STOCK_DAILY_SAMSUNG:'005930',NAVER_STOCK_DAILY_HYNIX:'000660'
});
const validDailyPrice=value=>{
 const raw=String(value??'').replaceAll(',','');
 return /^\d+(?:\.\d{1,2})?$/.test(raw)&&Number(raw)>0&&Number(raw)<100000000;
};
// The endpoint itself pins the stock code. Date-only bars are reference data,
// not an exchange-labelled, officially reconciled regular-session close.
export function qualifyPublicStockDailyReference(payload,sourceId,expectedKstDate){
 const code=DAILY_STOCK_SOURCES[sourceId];
 if(!code||!datePattern.test(expectedKstDate))return null;
 const rows=Array.isArray(payload)?payload:
  Array.isArray(payload?.result)?payload.result:null;
 if(!rows||rows.length<1||rows.length>40)
  return {code,latestBarDate:null,hasExactDateBar:false,classification:'DAILY_BAR_SCHEMA_UNVERIFIED'};
 const dateRows=rows.filter(x=>x&&typeof x.localTradedAt==='string'
  &&datePattern.test(x.localTradedAt));
 const latestBarDate=dateRows.map(x=>x.localTradedAt).sort().at(-1)||null;
 const exact=dateRows.filter(x=>x.localTradedAt===expectedKstDate);
 const hasExactDateBar=exact.length===1&&validDailyPrice(exact[0].closePrice);
 return {code,latestBarDate,hasExactDateBar,
  classification:hasExactDateBar?'PUBLIC_DAILY_CLOSE_REFERENCE_NOT_KRX_RECONCILED'
   :'EXACT_DATE_DAILY_CLOSE_NOT_VERIFIED',
  scope:'STOCK_DAILY_REFERENCE_ONLY',sourcePublishedAt:null};
}
