import {krxSessionStatus} from './krx-session-calendar.mjs';

// Original multi-asset morning briefing structure, rendered in one Telegram message.
// Numbers are sourced from dated observations only. Missing inputs remain missing.
export const MORNING_SERIES = Object.freeze([
  {id:'KOSPI',label:'KOSPI',symbol:'^KS11'},
  {id:'KOSDAQ',label:'KOSDAQ',symbol:'^KQ11'},
  {id:'KOSPI200',label:'KOSPI200',symbol:'^KS200'},
  {id:'SAMSUNG',label:'삼성전자',symbol:'005930.KS'},
  {id:'SKHYNIX',label:'SK하이닉스',symbol:'000660.KS'},
  {id:'SPX',label:'S&P 500',symbol:'^GSPC'},
  {id:'DOW',label:'다우존스',symbol:'^DJI'},
  {id:'NDX',label:'NASDAQ100',symbol:'^NDX'},
  {id:'NASDAQ',label:'NASDAQ',symbol:'^IXIC'},
  {id:'SOX',label:'SOX',symbol:'^SOX'},
  {id:'NVDA',label:'엔비디아',symbol:'NVDA'},
  {id:'MU',label:'마이크론',symbol:'MU'},
  {id:'VIX',label:'VIX',symbol:'^VIX'},
  {id:'USDKRW',label:'원/달러',symbol:'KRW=X'},
  {id:'DXY',label:'DXY',symbol:'DX-Y.NYB'},
  {id:'UST10Y',label:'미 10년물',symbol:'^TNX'},
  {id:'WTI',label:'WTI',symbol:'CL=F'},
  {id:'BRENT',label:'Brent',symbol:'BZ=F'},
  {id:'GOLD',label:'금',symbol:'GC=F'},
  {id:'COPPER',label:'구리',symbol:'HG=F'},
  {id:'BTC',label:'BTC',symbol:'BTC-USD'},
]);

// The 07:30 KST briefing must not quietly mix October 28 closes with
// October 29 US session closes. Missing an expected candle is NOT permission
// to roll back to an older valid number. US market holidays need separate
// confirmation; until confirmed, show unavailable rather than invent a close.
const KR_IDS = new Set(['KOSPI','KOSDAQ','KOSPI200','SAMSUNG','SKHYNIX']);
export function expectedMorningDate(id,date,now=null){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return null;
  const cursor=new Date(date+'T00:00:00Z');
  if(!Number.isFinite(cursor.getTime())||cursor.toISOString().slice(0,10)!==date)return null;
  for(let i=0;i<12;i++){
    cursor.setUTCDate(cursor.getUTCDate()-1);
    const candidate=cursor.toISOString().slice(0,10);
    if(id==='BTC'){
      // The UTC day cannot be FINAL before its midnight boundary.
      // At 07:40 KST the prior KST date is still the CURRENT UTC day.
      if(now instanceof Date&&Number.isFinite(now.getTime())
        &&candidate>=now.toISOString().slice(0,10)){
        cursor.setUTCDate(cursor.getUTCDate()-1);
        return cursor.toISOString().slice(0,10);
      }
      return candidate;
    }
    if(KR_IDS.has(id)){
      const state=krxSessionStatus(candidate);
      if(state==='OPEN')return candidate;
      if(state==='UNKNOWN')return null;
      continue;
    }
    if(![0,6].includes(cursor.getUTCDay()))return candidate; // US/FX prior weekday
  }
  return null;
}
export function hasExpectedMorningDate(item,date,row,now=null){
  return !!row && row.symbol===item.symbol && row.label===item.label
    && typeof row.date==='string' && row.date===expectedMorningDate(item.id,date,now)
    && Number.isFinite(row.value) && row.value>0;
}
export async function collectMorningSeries(date,{fetchDaily,now=new Date(),fetchImpl=fetch,concurrency=4,skipSymbols=new Set()}={}) {
  if(typeof fetchDaily!=='function')throw Error('MORNING_FETCHER_REQUIRED');
  const list=Array(MORNING_SERIES.length).fill(null);
  let index=0;
  async function worker(){
    while(index<MORNING_SERIES.length) {
      const i=index++;
      const item=MORNING_SERIES[i];
      if(skipSymbols.has(item.symbol))continue;
      try {
        const row=await fetchDaily(item.label,item.symbol,date,{now,fetchImpl});
        if(hasExpectedMorningDate(item,date,row,now)){list[i]={...row};continue;}
        // Retry once using Yahoo's alternate host on a missing response or
        // an outdated candle. Accept only the expected COMPLETED session;
        // do not broaden date gates or backfill with a stale close.
        if(row==null || (row?.date && row.date<date
          && !hasExpectedMorningDate(item,date,row,now)
          && row.source==='Yahoo Finance 일봉')){
          const retry=await fetchDaily(item.label,item.symbol,date,{now,fetchImpl,host:'query2.finance.yahoo.com'});
          if(hasExpectedMorningDate(item,date,retry,now))list[i]={...retry};
        }
      } catch { /* failed source is explicitly reported as unavailable */ }
    }
  }
  await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),4)},()=>worker()));
  return list.filter(Boolean);
}

function signal(row){return Number.isFinite(row?.changePercent)?Number(row.changePercent):null;}
function entry(map,id){
  const info=MORNING_SERIES.find(x=>x.id===id), r=info?map.get(info.symbol):null;
  if(!r || r.date==null || !Number.isFinite(Number(r.value)) || Number(r.value)<=0)return info?.label+': 미확보';
  let amount=Number(r.value);
  let unit='';
  // Yahoo chart ^TNX now delivers percent yields directly (e.g. 4.929).
  // Do not divide by ten. A 10x-scaled index-level observation is ambiguous
  // and must fail closed rather than silently printing an incorrect yield.
  if(id==='UST10Y'){
    if(!(amount>0&&amount<20))return info.label+': 미확보 (금리 단위 검증 필요)';
    unit='% (Yahoo ^TNX 직접 표기)';
  }
  else if(id==='WTI'||id==='BRENT'||id==='GOLD')unit=' USD';
  else if(id==='COPPER')unit=' USD/lb';
  else if(id==='BTC')unit=' USD';
  const v=amount.toLocaleString('en-US',{maximumFractionDigits:id==='UST10Y'?3:2});
  const change=Number.isFinite(r.changePercent)?' ('+(r.changePercent>=0?'+':'')+r.changePercent.toFixed(2)+'%)':'';
  const proof=r.source==='KRX_OFFICIAL'?'KRX 공식':r.source==='MARKET_MASTER'?'GAS 원장':r.source==='NH_INDEX_DAILY'?'NH PLUG 일봉':r.source==='FDR_KRX_CACHE'?'FDR·KRX 참고 종가':'Yahoo 일봉';
  return info.label+': '+v+unit+change+' ['+r.date+' · '+proof+']';
}
function evidence(map,id){
  const symbol=MORNING_SERIES.find(x=>x.id===id)?.symbol;
  const r=symbol?map.get(symbol):null;
  return r && Number.isFinite(r.changePercent)?r:null;
}
function regime(map) {
  const spx=evidence(map,'SPX'),sox=evidence(map,'SOX'),vix=evidence(map,'VIX');
  const fx=evidence(map,'USDKRW');
  if(!spx||!sox||!vix)return '판단 보류 — 미국지수·반도체·변동성 중 필수 데이터 부족';
  const up=spx.changePercent>0 && sox.changePercent>0 && vix.changePercent<0;
  const down=spx.changePercent<0 && sox.changePercent<0 && vix.changePercent>0;
  const word=up?'위험선호 신호 우세':down?'위험회피 신호 우세':'혼조 — 방향성 확인 필요';
  return word+(fx && Math.abs(fx.changePercent)>=0.5?' / 원·달러 변동 유의':'')+' (전일 일봉 기준)';
}
function outlook(map) {
  const spx=signal(evidence(map,'SPX')),sox=signal(evidence(map,'SOX')),vix=signal(evidence(map,'VIX'));
  if(spx===null||sox===null||vix===null)return [
    'Base: 방향 판단 유보(필수 해외지표 미확보)',
    'Bull: 미국지수·SOX 동반 상승과 VIX 하락 확인',
    'Bear: 미국지수·SOX 동반 하락과 VIX 상승 확인'
  ];
  const base=spx>0&&sox>0&&vix<0?'강세 신호 동행':spx<0&&sox<0&&vix>0?'약세 신호 동행':'상충 신호·보수적 접근';
  return ['Base: '+base+' (전일 데이터 기반)',
    'Bull: 한국 장초반 상승 확산·외국인 수급 동반 시',
    'Bear: VIX 반등·원화 약세·반도체 상대약세 시'];
}
export function formatFullMorningBriefing(date,reference,rows=[],options={}) {
  const map=new Map(rows.filter(x=>{const item=MORNING_SERIES.find(i=>i.symbol===x?.symbol);return item&&hasExpectedMorningDate(item,date,x,options?.now||null);}).map(x=>[x.symbol,x]));
  const lines=['[한국장 장전 종합 브리핑 | '+date+']','기준: 07:30 KST / 원천은 개별 날짜·출처 표시 (NH 야선 포함)','',
  '■ 1. 오늘의 결론 / 시장 국면',regime(map),'',
  '■ 2. 전일 한국장',...['KOSPI','KOSDAQ','KOSPI200','SAMSUNG','SKHYNIX'].map(id=>entry(map,id)),
  '거래대금·외국인/기관·시장폭(A/D·ADR20): 미확보','',
  '■ 3. 밤사이 미국장 / 반도체',
  ...['SPX','DOW','NDX','NASDAQ','SOX','NVDA','MU','VIX'].map(id=>entry(map,id)),'',
  '■ 4. 코스피200 야간선물 (06:00)',
  reference && Number.isFinite(reference.value) && reference.value>0
    ?'코스피200 야간선물: '+reference.value.toFixed(2)+'pt · NH PLUG 06:00 운영 확정 기준 ('+reference.tradingDate+') · 마지막 체결값, 거래소 공식 정산가 아님'
    :'코스피200 야간선물: 당일 참고값 미확보',
  '미국 선물 ES/NQ/YM/RTY: 장전 실시간 검증값 미확보','',
  '■ 5. 환율 / 금리 / 변동성',
  ...['USDKRW','DXY','UST10Y'].map(id=>entry(map,id)),
  '미 2·3년물 / 장단기 스프레드 / VKOSPI: 미확보','',
  '■ 6. 원자재 / 가상자산',
  ...['WTI','BRENT','GOLD','COPPER','BTC'].map(id=>entry(map,id)),'',
  '■ 7. 수급·유동성 / 체크포인트',
  'KOSPI·KOSDAQ 거래대금, 고객예탁금, 신용잔고: 미확보',
  'FedWatch·Finviz 히트맵·주요 이벤트: 별도 검증 필요','',
  '■ 8. 오늘의 시나리오 (조건부, 확률 미산정)',
  ...outlook(map),'',
  '■ QC: 기준 거래일과 일치한 일봉 '+map.size+'/'+MORNING_SERIES.length
   +' · NH 야선 '+(reference?'확보':'미확보'),
  '일봉은 각 항목 [날짜] 기준이며 현재가·KRX 공식 정산가와 다릅니다.',
  '미확보 항목은 원천 갱신 지연 또는 거래일 미검증으로 표기합니다.'];
  const message=lines.join('\n');
  if(message.length>3900)throw Error('TELEGRAM_FULL_BRIEFING_TOO_LONG');
  return message;
}
