// Pair a dated Yahoo daily row returned by the existing GAS benchmark route
// with an independently published Shinhan securities post-close index page.
// These are non-NH reference indices, NOT KRX official API confirmed closes.
export const SOURCE='YAHOO_SHINHAN_CROSSCHECKED_EOD';
export const PRICE_TYPE='INDEPENDENT_CROSSCHECKED_EOD';
const labels=Object.freeze({KOSPI:'KOSPI',KOSDAQ:'KOSDAQ',KOSPI200:'KOSPI 200'});
export function verifyCrosscheckedYahooIndexes(date,gasPayload,shinhan,previousDate,seriesMap={}){
 if(!shinhan||shinhan.date!==date||shinhan.source!=='SHINHAN_PUBLIC_INDEX'
  ||gasPayload?.status!=='ok'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return [];
 const rows=[];
 for(const [type,label] of Object.entries(labels)){
  const meta=gasPayload.seriesMeta?.[type]||{};
  const daily=gasPayload.series?.[type];
  // KOSPI200 currently supplies a Yahoo-unverified row without a source
  // meta tag; refuse to infer KRX status from that missing tag.
  if(meta.confirmedClose===true||(!['YAHOO_FINANCE'].includes(meta.source)
     &&!(type==='KOSPI200'&&(!meta.source||meta.source==='NONE')))
    ||!Array.isArray(daily)||daily.length!==1)continue;
  const point=daily[0],matched=Number(shinhan.values?.[type]);
  if(point?.date!==date||point.source!=='YAHOO_UNVERIFIED_DAILY'
   ||(point.sourceDate&&point.sourceDate!==date)
   ||!Number.isFinite(point.value)||point.value<=0
   ||!Number.isFinite(matched)||matched<=0
   ||Math.abs(Math.round(point.value*100)-Math.round(matched*100))!==0)continue;
  const prior=Array.isArray(seriesMap[type])
    ?seriesMap[type].filter(r=>r?.date===previousDate&&r.source==='FDR_KRX_CACHE')
    :[];
  const changePercent=prior.length===1&&prior[0].value>0
    ?(matched/prior[0].value-1)*100:null;
  rows.push({type,label,date,value:Math.round(matched*100)/100,
   source:SOURCE,role:'NON_NH_DAILY_INDEX',priceType:PRICE_TYPE,
   comparisonSource:'SHINHAN_PUBLIC_INDEX',
   comparisonPublishedAt:shinhan.publishedAt,changePercent});
 }
 return rows;
}
