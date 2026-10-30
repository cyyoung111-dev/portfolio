// Shinhan securities' public market-index page is an independent publisher,
// NOT a KRX official API response and never a substitute for NH stock closes.
export const SOURCE='SHINHAN_PUBLIC_INDEX';
export const URL='https://open.shinhansec.com/goodicyber/stock_jisu.jsp';
export const TYPES=Object.freeze(['KOSPI','KOSDAQ','KOSPI200']);
const dateRE=/^\d{4}-\d{2}-\d{2}$/;
function plainText(html){
 if(typeof html!=='string'||html.length>160000||html.includes('\0'))throw Error('SHINHAN_HTML_INVALID');
 return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;|&#xA0;/gi,' ')
  .replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
}
export function parseShinhanIndexPage(html,{expectedDate,now=new Date()}={}){
 if(!dateRE.test(String(expectedDate||'')))return null;
 const text=plainText(html);
 const headers=[...text.matchAll(/종합지수\s*\/\s*(20\d{2})[.\-](\d{2})[.\-](\d{2})\s+(\d{1,2}):(\d{2})/g)];
 if(headers.length!==1)return null;
 const h=headers[0],date=h[1]+'-'+h[2]+'-'+h[3],minutes=Number(h[4])*60+Number(h[5]);
 if(date!==expectedDate||minutes<940||minutes>1439)return null;
 const publishedAt=new Date(date+'T'+String(h[4]).padStart(2,'0')+':'+h[5]+':00+09:00');
 if(!Number.isFinite(publishedAt.getTime())||publishedAt.getTime()>now.getTime())return null;
 // Bound parsing to the index table to avoid unrelated matches later on page.
 const block=text.slice(h.index+h[0].length,h.index+h[0].length+1200).split('신한금융지주회사')[0];
 const values={};
 for(const type of TYPES){
  const regex=new RegExp('(?:^|\\s)'+type+'\\s+([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]{1,3})?|[0-9]+(?:\\.[0-9]{1,3})?)\\s+[+\\-▲▼△▽]?[\\s]*[0-9.,]+(?:\\s|$)','g');
  const matches=[...block.matchAll(regex)];
  if(matches.length!==1)return null;
  const value=Number(matches[0][1].replaceAll(',',''));
  if(!Number.isFinite(value)||value<=0)return null;
  values[type]=value;
 }
 return {date,publishedAt:publishedAt.toISOString(),source:SOURCE,values};
}
export async function fetchShinhanIndexEod(date,{fetchImpl=fetch,now=()=>new Date()}={}){
 if(!dateRE.test(String(date||'')))return null;
 try{
  const r=await fetchImpl(URL,{method:'GET',redirect:'error',
   headers:{accept:'text/html'},signal:AbortSignal.timeout(8500)});
  if(!r?.ok)return null;
  const ct=r.headers?.get?.('content-type')||'text/html';
  if(!/text\/html/i.test(ct))return null;
  return parseShinhanIndexPage(await r.text(),{expectedDate:date,now:now()});
 }catch{return null;}
}
