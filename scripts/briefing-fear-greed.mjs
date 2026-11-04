// CNN US equity Fear & Greed (not the cryptocurrency index).
// Public, undocumented CNN page-data endpoint. This is an optional, read-only
// reference: failed/blocked/old data must never delay or falsify a briefing.
export const CNN_FEAR_GREED_URL='https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
const MAX_AGE_MS=5*86400000;
const LABELS=Object.freeze({
  'extreme fear':'극단적 공포',fear:'공포',neutral:'중립',
  greed:'탐욕','extreme greed':'극단적 탐욕'
});
const validScore=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=100;
const timeValue=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(x)
  ?Date.parse(x):NaN;

// Used again at SEND time; stale PREPARE payloads cannot be called current.
export function verifyFearGreed(row,{now=new Date()}={}){
  const at=now instanceof Date?now.getTime():NaN;
  if(!row||typeof row!=='object'||Array.isArray(row)||!Number.isFinite(at))return null;
  const score=row.score,rating=row.rating,stamp=timeValue(row.observedAt);
  if(!validScore(score)||!Object.hasOwn(LABELS,rating)
    ||!Number.isFinite(stamp)||stamp>at+120000||at-stamp>MAX_AGE_MS)return null;
  const weekAgo=validScore(row.weekAgo)?row.weekAgo:null;
  return {score:Math.round(score*10)/10,rating,observedAt:new Date(stamp).toISOString(),
    weekAgo:weekAgo===null?null:Math.round(weekAgo*10)/10,source:'CNN_FEAR_GREED'};
}
export function parseFearGreed(data,{now=new Date()}={}){
  const current=data?.fear_and_greed;
  if(!current||typeof current!=='object')return null;
  return verifyFearGreed({
    score:current.score,rating:current.rating,observedAt:current.timestamp,
    weekAgo:current.previous_1_week
  },{now});
}
export async function readFearGreed({fetchImpl=fetch,now=()=>new Date()}={}){
  try{
    const response=await fetchImpl(CNN_FEAR_GREED_URL,{
      headers:{accept:'application/json',
        referer:'https://www.cnn.com/markets/fear-and-greed',
        'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'},
      redirect:'error',signal:AbortSignal.timeout(4500)
    });
    if(!response?.ok)return null;
    const length=Number(response.headers?.get?.('content-length')||0);
    if(length>4000000)return null;
    const data=await response.json();
    return parseFearGreed(data,{now:now()});
  }catch{return null;}
}
function kstStamp(iso){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',
    minute:'2-digit',hourCycle:'h23'
  }).formatToParts(new Date(iso)).map(p=>[p.type,p.value]));
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}
export function formatFearGreed(input,{now=new Date()}={}){
  const row=verifyFearGreed(input,{now});
  if(!row)return 'CNN 미국주식 공포·탐욕: 미확보 (원천·시각 미검증)';
  const week=row.weekAgo===null?'':` · 1주 ${row.score-row.weekAgo>=0?'+':''}${(row.score-row.weekAgo).toFixed(1)}p`;
  return `CNN 미국주식 공포·탐욕: ${row.score.toFixed(1)}/100 (${LABELS[row.rating]})${week} [${kstStamp(row.observedAt)} KST]`;
}
