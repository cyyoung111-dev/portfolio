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
    '운영 종가 기준: NH PLUG 당일 정규장 종가 · KRX/Yahoo 익거래일 사후 대조',''];
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
  lines.push('NH 운영 기준 종가는 거래소 공식 정산가격을 의미하지 않습니다. 본 메시지는 미발송 검증용 초안입니다.');
  const message=lines.join('\n');
  if(message.length>4096)throw Error('CLOSE_MESSAGE_TOO_LARGE');
  return Object.freeze({
    status:verifiedCount===expected.length?'SOURCE_ROWS_PRESENT_FINALITY_UNVERIFIED':'INCOMPLETE',
    tradingDate,total:expected.length,received:verifiedCount,missing:expected.length-verifiedCount,message,
  });
}

// Pure audit after independent, date-complete KRX / Yahoo candles arrive.
// This never changes NH source rows or retroactively edits any briefing,
// price-history cell or Snapshot. Any discrepancy is a separate report.
const nextKrxOpen = date => {
  let d=new Date(date+'T00:00:00Z');
  for(let i=0;i<16;i++){
    d=new Date(d.getTime()+86400000);
    const target=d.toISOString().slice(0,10);
    const status=krxSessionStatus(target);
    if(status==='OPEN')return target;
    if(status==='UNKNOWN')return null;
  }
  return null;
};
export function auditNhCloseNextDay({tradingDate,asOf,nhRows=[],krxRows=[],yahooRows=[]}={}) {
  if(!validDate(tradingDate)||typeof asOf!=='string'||!ISO_WITH_OFFSET.test(asOf)
    ||!Number.isFinite(Date.parse(asOf)))throw Error('NH_AUDIT_DATE_INVALID');
  // Korea and US have independent calendars. NH provides the dated regular
  // close. A US Friday bar may publish on Saturday KST before Korea reopens.
  const nextCalendarDay=new Date(Date.parse(tradingDate+'T00:00:00Z')+86400000)
    .toISOString().slice(0,10);
  const firstKrxOpen=nextKrxOpen(tradingDate);
  const firstKrxPublication=firstKrxOpen?Date.parse(firstKrxOpen+'T08:00:00+09:00'):NaN;
  const firstUsPublication=Date.parse(nextCalendarDay+'T00:00:00+09:00');
  if(!Array.isArray(nhRows)||!Array.isArray(krxRows)||!Array.isArray(yahooRows)
    ||nhRows.length>100||krxRows.length>100||yahooRows.length>100)
    throw Error('NH_AUDIT_INPUT_INVALID');
  const now=Date.parse(asOf),usWeekday=new Date(tradingDate+'T00:00:00Z').getUTCDay();
  const trustedNh=row=>row&&typeof row.code==='string'
    &&(row.currency==='KRW'
      ? /^[A-Z0-9]{6}$/.test(row.code)&&krxSessionStatus(tradingDate)==='OPEN'
      : row.currency==='USD'
        &&/^[A-Z][A-Z0-9.\-]{0,11}$/.test(row.code)
        &&usWeekday!==0&&usWeekday!==6)
    &&row.source==='NH_REGULAR_CLOSE'&&row.priceType==='REGULAR_CLOSE'
    &&row.status==='CONFIRMED'&&row.usedDate===tradingDate&&row.marketDate===tradingDate
    &&num(row.price)!==null;
  const trustedAudit=(row,source,currency,earliest)=>row&&row.source===source
    &&row.code&&row.date===tradingDate&&row.currency===currency&&num(row.price)!==null
    &&row.completed===true&&typeof row.publishedAt==='string'
    &&ISO_WITH_OFFSET.test(row.publishedAt)
    &&Date.parse(row.publishedAt)>=earliest
    &&Date.parse(row.publishedAt)<=now
    &&(source!=='YAHOO_DAILY_CLOSE'||row.adjusted===false);
  const priceMap=rows=>{
    const grouped=new Map();
    for(const row of rows){const key=String(row?.code||'');
      if(!grouped.has(key))grouped.set(key,[]);
      grouped.get(key).push(row);
    }
    return grouped;
  };
  const nh=priceMap(nhRows),krx=priceMap(krxRows),yahoo=priceMap(yahooRows);
  const allCodes=[...new Set(nhRows.map(row=>String(row?.code||'')))].sort();
  const results=allCodes.map(code=>{
    const rows=nh.get(code)||[],base=rows.length===1&&trustedNh(rows[0])?rows[0]:null;
    if(!base)return {code,status:'NH_INVALID_OR_DUPLICATE',krx:'NOT_CHECKED',yahoo:'NOT_CHECKED'};
    const earliest=base.currency==='KRW'?firstKrxPublication:firstUsPublication;
    if(!Number.isFinite(earliest)||now<earliest)
      return {code,status:'NEXT_DAY_NOT_PUBLISHED',krx:'NOT_CHECKED',yahoo:'NOT_CHECKED'};
    const compare=(map,source)=>{
      const evidence=map.get(code)||[];
      const published=source==='KRX_OFFICIAL'?firstKrxPublication:earliest;
      const valid=evidence.length===1
        &&trustedAudit(evidence[0],source,base.currency,published)?evidence[0]:null;
      if(!valid)return {status:'NOT_VERIFIED'};
      const delta=Number(valid.price)-Number(base.price);
      return {status:delta===0?'MATCH':'DIFFERENCE',delta,price:Number(valid.price)};
    };
    return {code,marketDate:tradingDate,nhPrice:Number(base.price),currency:base.currency,
      status:'NH_OPERATING_CLOSE',krx:base.currency==='KRW'?compare(krx,'KRX_OFFICIAL'):{status:'NOT_APPLICABLE'},
      yahoo:compare(yahoo,'YAHOO_DAILY_CLOSE')};
  });
  return Object.freeze({tradingDate,asOf,nhSource:'NH_REGULAR_CLOSE',
    purpose:'NEXT_DAY_READ_ONLY_AUDIT',originalNhPreserved:true,writesPerformed:0,results});
}
