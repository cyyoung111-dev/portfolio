// SKHY official Nasdaq ADR: ten ADSs represent one KRX 000660 ordinary share.
// SEC final prospectus (July 2026): https://www.sec.gov/Archives/edgar/data/2120882/000119312526299963/d32785d424b4.htm
// Informational cross-market comparison only. Intraday prices, time mismatches,
// currency translations and fees make this unsuitable as a predicted KRX return.
export const SKHY_ADS_PER_ORDINARY = 10;
const US_SOURCES=new Set(['YAHOO_DAILY_REFERENCE','NASDAQ_DAILY_REFERENCE']);
const STOCK_SOURCES=new Set(['NH_REGULAR_CLOSE','KRX_OFFICIAL','Yahoo Finance 일봉']);
const FX_SOURCES=new Set(['Yahoo Finance 일봉','MARKET_MASTER']);
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)
 &&!Number.isNaN(Date.parse(s+'T00:00:00Z'))
 &&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function validRow(row,{date,symbol,label,sources,min,max}){
 return validDate(date)&&row?.date===date&&row?.symbol===symbol
  &&(!label||row?.label===label)&&sources.has(row?.source)
  &&Number.isFinite(row?.value)&&row.value>=min&&row.value<=max;
}
export function verifiedSkhyQuote(rows=[],expectedUsDate){
 if(!Array.isArray(rows)||!validDate(expectedUsDate))return null;
 const found=rows.filter(r=>validRow(r,{
  date:expectedUsDate,symbol:'SKHY',label:'SK하이닉스 ADR',
  sources:US_SOURCES,min:0.01,max:100000
 }));
 if(found.length!==1)return null;
 return Object.freeze({symbol:'SKHY',label:'SK하이닉스 ADR',date:expectedUsDate,
  value:found[0].value,source:found[0].source});
}
export function calculateSkhyParity({skhyQuote,ordinaryClose,fxClose,
 usDate,ordinaryDate,fxDate}={}){
 if(!validRow(skhyQuote,{date:usDate,symbol:'SKHY',
  label:'SK하이닉스 ADR',sources:US_SOURCES,min:0.01,max:100000})
  ||!validRow(ordinaryClose,{date:ordinaryDate,symbol:'000660.KS',
    label:'SK하이닉스',sources:STOCK_SOURCES,min:100,max:10000000})
  ||!validRow(fxClose,{date:fxDate,symbol:'KRW=X',label:'원/달러',
    sources:FX_SOURCES,min:500,max:3000}))
  return null;
 // All three dates are independently verified and must not be presented
 // as synchronized closing prices. A later Korean quote is not allowed here.
 if(!validDate(usDate)||!validDate(ordinaryDate)||!validDate(fxDate)
  ||ordinaryDate>usDate||fxDate>usDate)return null;
 const equivalent=skhyQuote.value*SKHY_ADS_PER_ORDINARY*fxClose.value;
 const premiumPercent=(equivalent/ordinaryClose.value-1)*100;
 if(!Number.isFinite(equivalent)||!Number.isFinite(premiumPercent)
  ||equivalent<=0||Math.abs(premiumPercent)>300)return null;
 return Object.freeze({equivalentKrw:equivalent,premiumPercent,
  usDate,ordinaryDate,fxDate,adrUsd:skhyQuote.value,
  ordinaryKrw:ordinaryClose.value,fxKrw:fxClose.value,
  adrSource:skhyQuote.source,ordinarySource:ordinaryClose.source,
  fxSource:fxClose.source});
}
export function formatSkhyParity(result){
 if(!result)return [];
 const won=x=>Math.round(x).toLocaleString('en-US');
 const usd=x=>x.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const pct=(result.premiumPercent>=0?'+':'')+result.premiumPercent.toFixed(2)+'%';
 const usSource=result.adrSource==='NASDAQ_DAILY_REFERENCE'?'Nasdaq':'Yahoo';
 const krSource=result.ordinarySource==='NH_REGULAR_CLOSE'?'NH':
  result.ordinarySource==='KRX_OFFICIAL'?'KRX':'Yahoo';
 const fxSource=result.fxSource==='MARKET_MASTER'?'자료원장':'Yahoo';
 return [
  '■ SK하이닉스 ADR 환산 비교 (비동시 종가)',
  'SKHY $'+usd(result.adrUsd)+' ['+result.usDate+' '+usSource+'] ×10 × 원/달러 '
   +usd(result.fxKrw)+' ['+result.fxDate+' '+fxSource+'] = 원주 약 '+won(result.equivalentKrw)+'원',
  '국내 '+won(result.ordinaryKrw)+'원 ['+result.ordinaryDate+' '+krSource+'] 대비 참고 괴리 '
   +pct+' · 시차 존재, 국내 예상 등락률 아님'
 ];
}
