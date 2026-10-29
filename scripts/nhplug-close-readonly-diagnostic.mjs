import {pathToFileURL} from 'node:url';

// One-shot, read-only regular-session close probe. Never call orders, accounts, GAS or Telegram.
const ORIGIN = 'https://api.nhplug.com:8443';
const DAILY = '/krstock/quote/v1/currentDaily';
const ETF = '/krstock/quote/v1/etfCurrent';
const TARGETS = [
  ['KR_STOCK', '005930'],
  ['KR_ETF', '069500'],
];

function kstDate(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(now).map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day;
}
function numericPrice(v) {
  if (typeof v!=='number' && !(typeof v==='string' && /^\d+(?:\.\d+)?$/.test(v.trim()))) return null;
  const n=Number(v);
  return Number.isFinite(n) && n>0 ? n : null;
}
function dailyDate(value) {
  if(typeof value!=='string')return null;
  let d;
  if(/^\d{8}$/.test(value))d=value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8);
  else if(/^\d{2}\/\d{2}\/\d{2}$/.test(value))d='20'+value.slice(0,2)+'-'+value.slice(3,5)+'-'+value.slice(6,8);
  else return null;
  const parsed=Date.parse(d+'T00:00:00Z');
  return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===d ? d : null;
}
const status = (response) => Number.isInteger(response?.status)&&response.status>=100&&response.status<=599
  ? response.status : 0;
async function post(request, url, token, key, secret, input) {
  const res=await request(url,{method:'POST',headers:{
    'content-type':'application/json; charset=UTF-8',authorization:'Bearer '+token,
    'x-client-id':key,'x-client-secret':secret,
  },body:JSON.stringify({Input_0:input}),redirect:'error',signal:AbortSignal.timeout(12000)});
  return {res,json:await res.json()};
}

export async function diagnoseClose({key,secret,request=fetch,log=console.log,wait=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>new Date()}={}) {
  if(!key||!secret){log('CLOSE_AUTH CREDENTIALS_MISSING');return false;}
  const target=kstDate(now());
  // Test today's after-market state only. A historical success does not prove T+0 publication.
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now()).map(x=>[x.type,x.value]));
  if(Number(p.hour)*60+Number(p.minute)<15*60+30){
    log('CLOSE_TEST NOT_AFTER_REGULAR_CLOSE');return false;
  }
  let auth;
  try {
    const params=new URLSearchParams({appkey:key,appsecretkey:secret,grant_type:'client_credentials',scope:'oob'});
    const r=await request(ORIGIN+'/oauth2/token?'+params,{
      method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},redirect:'error',
      signal:AbortSignal.timeout(12000)
    });
    const json=await r.json();
    if(!r.ok||!json||typeof json.access_token!=='string'||!json.access_token) {
      log('CLOSE_AUTH HTTP_'+status(r));return false;
    }
    auth=json.access_token;
    log('CLOSE_AUTH TOKEN_PRESENT');
  } catch {log('CLOSE_AUTH RESPONSE_UNAVAILABLE');return false;}
  let passed=true;
  for(const [label,code] of TARGETS){
    await wait(1000);
    try{
      const {res,json}=await post(request,ORIGIN+DAILY,auth,key,secret,{
        market_cd:'KRX',iem_cd:code,array_cnt:'2',view_main_yn:'Y',
      });
      const rows=json?.Output_0;
      const day=Array.isArray(rows) ? rows.filter(x=>dailyDate(x?.bsop_date)===target) : [];
      const exact=day.length===1 && numericPrice(day[0].stck_clpr)!==null;
      log(label+'_DAILY HTTP_'+status(res)+' '+(res.ok&&exact?'EXACT_DATE_CLOSE_PRESENT':'EXACT_DATE_CLOSE_UNVERIFIED'));
      if(!res.ok||!exact)passed=false;
      if(res.status===401||res.status===429)break;
      if(label==='KR_ETF'){
        await wait(1000);
        const etf=await post(request,ORIGIN+ETF,auth,key,secret,{iem_cd:code});
        const output=etf.json?.Output_0;
        const valid=etf.res.ok && output?.iem_cd===code && numericPrice(output.stck_prpr)!==null;
        log('KR_ETF_CURRENT HTTP_'+status(etf.res)+' '+(valid?'CODE_AND_PRICE_PRESENT':'CODE_OR_PRICE_UNVERIFIED'));
        if(!valid)passed=false;
        if(etf.res.status===401||etf.res.status===429)break;
      }
    }catch{log(label+'_DAILY RESPONSE_UNAVAILABLE');passed=false;break;}
  }
  log('REGULAR_CLOSE_PREFLIGHT '+(passed?'PASS':'FAIL')+' LIVE_EXCHANGE_FINALITY_UNVERIFIED');
  return passed;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const ok=await diagnoseClose({key:process.env.NHPLUG_APP_KEY,secret:process.env.NHPLUG_APP_SECRET});
  if(!ok)process.exitCode=1;
}
