import {krxSessionStatus} from './krx-session-calendar.mjs';

// Pure dry-run renderer for a future 16:00 KST NH closing briefing.
// No API requests, GAS reads/writes, Telegram calls, or portfolio mutations.
// Normalized observations are *not* KRX-official finality evidence.
const KST = 'Asia/Seoul';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^[A-Z0-9]{6}$/;
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const num = v => (typeof v === 'number' || (typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v.trim())))
  && Number.isFinite(Number(v)) && Number(v)>0 ? Number(v) : null;
const validDate = v => DATE_RE.test(v||'') && Number.isFinite(Date.parse(v+'T00:00:00Z'))
  && new Date(Date.parse(v+'T00:00:00Z')).toISOString().slice(0,10) === v;
const kstDate = t => {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:KST,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(t).map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day;
};
const cleanName = v => typeof v==='string' && v.length>=1 && v.length<=50
  && !/[\x00-\x1f\x7f]/.test(v) && v.trim() ? v.trim() : null;
const won = v => Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2});
function validObservation(row,code,date,at,open) {
  if(!row || row.code!==code || row.source!=='NH_PLUG' || row.market!=='KRX'
    || row.session!=='REGULAR' || row.priceScope!=='KRX_REGULAR'
    || row.priceKind!=='DAILY_REGULAR_CLOSE' || row.tradingDate!==date || row.sourceDate!==date
    || row.officialFinal!==false || num(row.price)===null
    || !ISO_WITH_OFFSET.test(row.receivedAt||''))return false;
  const received=Date.parse(row.receivedAt);
  return Number.isFinite(received) && received>=open && received<=at;
}
function selectedClose(observations,code,date,at,open) {
  const matches=observations.filter(row=>row?.code===code);
  // Do not let a valid copy hide a conflicting or stale duplicate.
  if(matches.length!==1 || !validObservation(matches[0],code,date,at,open))return null;
  return matches[0];
}
export function prepareNhCloseBriefing({tradingDate,expected,observations=[],asOf}={}) {
  if(!validDate(tradingDate) || krxSessionStatus(tradingDate)!=='OPEN')throw Error('CLOSE_TRADING_DATE_NOT_OPEN');
  if(typeof asOf!=='string' || !ISO_WITH_OFFSET.test(asOf))throw Error('CLOSE_AS_OF_INVALID');
  const at=Date.parse(asOf);
  if(!Number.isFinite(at) || kstDate(new Date(at))!==tradingDate)throw Error('CLOSE_AS_OF_DATE_MISMATCH');
  const open=Date.parse(tradingDate+'T15:30:00+09:00');
  const limit=Date.parse(tradingDate+'T16:10:00+09:00');
  if(at<open || at>limit)throw Error('CLOSE_OUTSIDE_DELIVERY_WINDOW');
  if(!Array.isArray(expected)||!expected.length || expected.length>80 || !Array.isArray(observations))
    throw Error('CLOSE_INPUT_INVALID');
  const seen=new Set();
  for(const row of expected){
    if(!CODE_RE.test(row?.code||'') || !['STOCK','ETF'].includes(row?.kind)
      || !cleanName(row?.name) || seen.has(row.code))throw Error('CLOSE_EXPECTED_UNVERIFIED');
    seen.add(row.code);
  }
  const lines=['['+tradingDate+' 한국장 마감 브리핑]',
    'NH PLUG 제공 당일 KRX 정규장 종가 (KRX 공식 종가와 교차검증 전)',''];
  let verifiedCount=0;
  for(const row of expected){
    const found=selectedClose(observations,row.code,tradingDate,at,open);
    if(!found){lines.push(row.name+' ('+row.code+'): 미확보·검증 보류');continue;}
    verifiedCount++;
    const before=num(row.priorClose);
    const delta=(Number(found.price)/before-1)*100;
    const change=row.priorCloseVerified===true && before!==null
      ? ' ('+(delta>=0?'+':'')+delta.toFixed(2)+'%)' : '';
    lines.push(row.name+' ('+row.code+'): '+won(found.price)+'원'+change);
  }
  lines.splice(3,0,'종목 수집 '+verifiedCount+'/'+expected.length+' · 미확보 '+(expected.length-verifiedCount));
  lines.push('','시장지수·계좌 평가손익: 별도 검증된 원천 연동 전');
  lines.push('이 메시지는 미발송 검증용 초안입니다. 매매·계좌 데이터와 KRX 공식 확정가격으로 사용하지 마세요.');
  const message=lines.join('\n');
  if(message.length>4096)throw Error('CLOSE_MESSAGE_TOO_LARGE');
  return Object.freeze({
    status:verifiedCount===expected.length?'SOURCE_ROWS_PRESENT_FINALITY_UNVERIFIED':'INCOMPLETE',
    tradingDate,total:expected.length,received:verifiedCount,missing:expected.length-verifiedCount,message,
  });
}
