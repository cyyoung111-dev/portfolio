// Server-side NH adapter. Never import this module into the browser bundle.
// Quotes are indicative: receipt time is not an exchange timestamp or a close.
const ORIGIN = 'https://api.nhplug.com:8443';
const price = value => (typeof value === 'number' || typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) && Number.isFinite(Number(value)) && Number(value)>0 ? Number(value) : null;
export function nhDate(value) {
  if(typeof value!=='string')return null;
  const s=/^\d{8}$/.test(value)?value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6):/^\d{2}\/\d{2}\/\d{2}$/.test(value)?'20'+value.replaceAll('/','-'):value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
  const d=new Date(s+'T00:00:00Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s?s:null;
}
function instrument(item) {
  if(!item||!item.code)throw new Error('NH_INSTRUMENT_INVALID');
  const symbol=String(item.symbol||item.code).trim().toUpperCase();
  if(item.market==='KR'&&item.currency==='KRW'&&/^\d{6}$/.test(symbol)&&['STOCK','ETF'].includes(item.type))return {symbol,us:false};
  if(item.market==='US'&&item.currency==='USD'&&/^[A-Z][A-Z0-9.\-]{0,11}$/.test(symbol)&&['STOCK','ETF'].includes(item.type))return {symbol,us:true};
  throw new Error('NH_INSTRUMENT_UNSUPPORTED');
}
export function normalizeNhQuote(item, body, {receivedAt, expectedId}={}) {
  const {symbol,us}=instrument(item), row=body?.Output_0;
  // The caller supplies an exact identity from a validated current public master.
  // No suffix matching, prefix guesses, or ticker-to-GIC concatenation.
  if(!row||Array.isArray(row)||typeof row.iem_cd!=='string'||!(row.iem_cd===symbol||expectedId&&row.iem_cd===expectedId))throw new Error('NH_IDENTITY_MISMATCH');
  const value=price(us?row.trdprc:row.stck_prpr);
  if(value===null)throw new Error('NH_PRICE_INVALID');
  const date=us?nhDate(row.trade_date):null;
  if(us&&!date)throw new Error('NH_TRADE_DATE_INVALID');
  const instant=new Date(receivedAt);
  if(!Number.isFinite(instant.getTime()))throw new Error('NH_RECEIPT_TIME_INVALID');
  if(date&&date>instant.toISOString().slice(0,10))throw new Error('NH_FUTURE_TRADE_DATE');
  return {code:item.code,providerSymbol:symbol,price:value,currency:item.currency,market:item.market,
    marketDate:date,source:'NH',priceType:'REALTIME',status:'INDICATIVE',
    timestamp:null,fetchedAt:instant.toISOString(),exchangeTimeVerified:false};
}
export function normalizeNhKrDaily(item, body, targetDate, receivedAt) {
  const {us}=instrument(item);
  if(us||!nhDate(targetDate)||!Array.isArray(body?.Output_0))throw new Error('NH_DAILY_REQUEST_INVALID');
  const rows=body.Output_0.filter(row=>nhDate(row?.bsop_date)===targetDate);
  if(rows.length!==1||price(rows[0].stck_clpr)===null)throw new Error('NH_EXACT_DATE_CLOSE_MISSING');
  const instant=new Date(receivedAt);
  if(!Number.isFinite(instant.getTime()))throw new Error('NH_RECEIPT_TIME_INVALID');
  const kst=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(instant);
  if(targetDate>kst.slice(0,10)||targetDate===kst.slice(0,10)&&kst.slice(11,16)<'15:30')throw new Error('NH_REGULAR_SESSION_NOT_CLOSED');
  // Broker daily data remains provisional until the existing official KRX
  // reconciliation verifies it. Never pass the CONFIRMED history-write guard.
  return {code:item.code,price:price(rows[0].stck_clpr),currency:'KRW',market:'KR',
    marketDate:targetDate,usedDate:targetDate,source:'NH',priceType:'REGULAR_CLOSE',
    status:'PROVISIONAL',fetchedAt:instant.toISOString()};
}
export function createNhMarketDataProvider({key,secret,request=fetch,now=()=>new Date(),wait=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  let token=null,expiresAt=0,queue=Promise.resolve();
  const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  const json=async(url,options)=>{
    let response,body;
    try {response=await request(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});body=await response.json();}
    catch {throw new Error('NH_NETWORK_OR_RESPONSE_ERROR');}
    if(!response.ok){if(response.status===401){token=null;expiresAt=0;}throw new Error('NH_HTTP_'+(Number.isInteger(response.status)?response.status:0));}
    return body;
  };
  const auth=async()=>{
    if(!key||!secret)throw new Error('NH_CREDENTIALS_MISSING');
    if(token&&expiresAt>now().getTime()+60000)return token;
    const query=new URLSearchParams({appkey:key,appsecretkey:secret,grant_type:'client_credentials',scope:'oob'});
    const body=await json(ORIGIN+'/oauth2/token?'+query,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'}});
    if(typeof body?.access_token!=='string'||!body.access_token)throw new Error('NH_AUTH_INVALID');
    const lifetime=Number(body.expires_in);
    // Missing expiry must not silently become a long-lived cache.
    if(!Number.isFinite(lifetime)||lifetime<=60)throw new Error('NH_TOKEN_EXPIRY_UNVERIFIED');
    token=body.access_token;expiresAt=now().getTime()+lifetime*1000;
    return token;
  };
  const post=async(path,input)=>{
    const access=await auth();
    await wait(1000);
    return json(ORIGIN+path,{method:'POST',headers:{'content-type':'application/json; charset=UTF-8','x-client-id':key,'x-client-secret':secret,authorization:'Bearer '+access},body:JSON.stringify({Input_0:input})});
  };
  return {
    quote:(item,{expectedId}={})=>serial(async()=>{
      const {symbol,us}=instrument(item);
      const path=us?'/gbstock/quote/v1/current':item.type==='ETF'?'/krstock/quote/v1/etfCurrent':'/krstock/quote/v1/currentPrice';
      const input={iem_cd:symbol};if(!us&&item.type==='STOCK')input.market_cd='KRX';
      const body=await post(path,input);
      return normalizeNhQuote(item,body,{expectedId,receivedAt:now()});
    }),
    krDaily:(item,date)=>serial(async()=>{
      const {symbol,us}=instrument(item);if(us||!nhDate(date))throw new Error('NH_DAILY_REQUEST_INVALID');
      // currentDaily only exposes recent rows: never fabricate a historical hit.
      const body=await post('/krstock/quote/v1/currentDaily',{market_cd:'KRX',iem_cd:symbol,array_cnt:'2',view_main_yn:'Y'});
      return normalizeNhKrDaily(item,body,date,now());
    })
  };
}
