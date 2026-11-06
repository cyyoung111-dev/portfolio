import {krxSessionStatus} from './krx-session-calendar.mjs';
import {formatHowardMarksView} from './briefing-howard-marks-risk.mjs';

// Original multi-asset morning briefing structure, rendered in one Telegram message.
// Numbers are sourced from dated observations only. Missing inputs remain missing.
import {formatFearGreed} from './briefing-fear-greed.mjs';

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
function entry(map,id,options={}){
  const info=MORNING_SERIES.find(x=>x.id===id), r=info?map.get(info.symbol):null;
  if(!r || r.date==null || !Number.isFinite(Number(r.value)) || Number(r.value)<=0){
  // A separate completed Yahoo daily reference is not an NH operating close.
  const refs=options?.supplements?.usReferences||[];
  const dated=refs.filter(x=>x?.symbol===info?.symbol&&x?.label===info?.label
    &&x?.date===expectedMorningDate(id,options?.reportDate||'',options?.now||null)
    &&x?.source==='Yahoo Finance 일봉'&&x?.referenceOnly===true
    &&Number.isFinite(x.value)&&x.value>0);
  if(['SPX','NASDAQ','NDX'].includes(id)&&dated.length===1){
    const x=dated[0],change=Number.isFinite(x.changePercent)
      ?' ('+(x.changePercent>=0?'+':'')+x.changePercent.toFixed(2)+'%)':'';
    return info.label+': '+x.value.toLocaleString('en-US',{maximumFractionDigits:2})
      +change+' ['+x.date+' · Yahoo 일봉 참고 / NH 미확보]';
  }
  return info?.label+': 미확보';
 }
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
  const reference=r.source==='NH_INDEX_DAILY'||r.source==='NH_REGULAR_CLOSE'?'':
    r.source==='KRX_OFFICIAL'?' · KRX':r.source==='MARKET_MASTER'?' · 자료원장 참고':
    r.source==='FDR_KRX_CACHE'?' · FDR 참고':' · Yahoo 참고';
  return info.label+': '+v+unit+change+' ['+r.date+reference+']';
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
// AI value-chain and five-investor frameworks applied to verified previous-session
// market prices. This is our scenario analysis, never a claim that the investors
// commented on today's market. CAPEX/orders/valuations are not in this feed.
function morningAiInvestorLens(map,reportDate,now=null) {
  const ndx=evidence(map,'NDX'), sox=evidence(map,'SOX'), vix=evidence(map,'VIX');
  const pct=x=>(x>=0?'+':'')+x.toFixed(2)+'%';
  let relative='SOX·NASDAQ100 동시 확정 일봉 부족 → 반도체 상대강도 판단 보류';
  if(sox&&ndx) {
    const spread=sox.changePercent-ndx.changePercent;
    relative='SOX '+pct(sox.changePercent)+' / NASDAQ100 '+pct(ndx.changePercent)
      +' (격차 '+(spread>=0?'+':'')+spread.toFixed(2)+'%p)';
  }
  const trend=sox&&ndx&&vix
    ?sox.changePercent>0&&ndx.changePercent>0&&vix.changePercent<0
      ?'가격·변동성은 위험선호에 우호적(실제 AI 수요 확증 아님)'
      :sox.changePercent<0&&ndx.changePercent<0&&vix.changePercent>0
        ?'가격·변동성은 위험회피 경계(실적 악화 확정 아님)'
        :'가격·변동성 혼조, 단일 방향 판단 유보'
    :'미국 반도체·기술주·VIX 중 검증값 부족 → 종합판단 유보';
  return [
    '■ 8. AI 산업·반도체 종합평가 (전일 일봉 기반)',
    '• 상대강도: '+relative,
    '• 종합: '+trend,
    '• 실수요: 빅테크 CAPEX·GPU/HBM 주문·AI 수익화·재고 실측 미연결 → 업황 확정 불가.',
    '',
    '■ 9. 5인 투자 철학 적용 (당일 실제 발언 아님)',
    '• 버핏: 해자·ROIC·유지 CAPEX 차감 소유주 FCF로 이익의 질 확인.',
    '• 애크먼: 반복 FCF·재무건전성 확인 전 집중·영구손실 위험 경계.',
    '• 피터 린치: 이익성장 대비 PER 점검; 반도체 최고점 EPS 착시 주의.',
    '• 다모다란: AI 성장·마진·재투자·할인율로 내재가치와 가격의 기대치 비교.',
    formatHowardMarksView({vix,expectedDate:expectedMorningDate('VIX',reportDate,now)}),
    ''
  ];
}
export function formatFullMorningBriefing(date,reference,rows=[],options={}) {
  options={...options,reportDate:date};
  const map=new Map(rows.filter(x=>{const item=MORNING_SERIES.find(i=>i.symbol===x?.symbol);return item&&hasExpectedMorningDate(item,date,x,options?.now||null);}).map(x=>[x.symbol,x]));
  const verifiedDisplayed=MORNING_SERIES.filter(item=>{
   const r=map.get(item.symbol);
   return r&&(item.id!=='UST10Y'||(r.value>0&&r.value<20));
  }).length;
  const lines=['[한국장 장전 종합 브리핑 | '+date+']','기준: 07:30 KST · 기준일별 종가 / 외부 참고값만 출처 표시','',
  '■ 1. 오늘의 결론 / 시장 국면',regime(map),'',
  '■ 2. 전일 한국장',...['KOSPI','KOSDAQ','KOSPI200','SAMSUNG','SKHYNIX'].map(id=>entry(map,id,options)),
  (options.supplements?.turnover||'거래대금: 미확보'),
  (options.supplements?.breadth||'시장폭 A/D: 미확보 · ADR20: 20거래일 시계열 미연결'),
  '외국인/기관 수급: 미확보 (공식 확정 원천 미연결)','',
  '■ 3. 밤사이 미국장 / 반도체',
  ...['SPX','DOW','NDX','NASDAQ','SOX','NVDA','MU','VIX'].map(id=>entry(map,id,options)),'',
  '■ 4. 코스피200 야간선물 (06:00)',
  reference && Number.isFinite(reference.value) && reference.value>0
    ?'코스피200 야간선물: '+reference.value.toFixed(2)+'pt [06:00 확인 · '+reference.tradingDate+'] · 마지막 체결값, 거래소 정산가 아님'
    :'코스피200 야간선물: 당일 참고값 미확보',
  (options.supplements?.futures||'미국 선물 ES/NQ/YM/RTY: 장전 실시간 검증값 미확보'),'',
  '■ 5. 환율 / 금리 / 변동성',
  ...['USDKRW','DXY','UST10Y'].map(id=>entry(map,id,options)),
  (options.supplements?.treasury||'미 2·3년물 / 장단기 스프레드: 미확보'),
  (options.supplements?.vkospi||'VKOSPI: 미확보'),'',
  '■ 6. 원자재 / 가상자산',
  ...['WTI','BRENT','GOLD','COPPER','BTC'].map(id=>entry(map,id,options)),'',
  '■ 7. 수급·유동성 / 체크포인트',
  '고객예탁금·신용잔고: 최신 확정치 미연결 (거래대금은 2항 참조)',
  'FedWatch·Finviz 히트맵·주요 이벤트: 별도 검증 필요','',
  ...morningAiInvestorLens(map,date,options?.now||null),
  '■ 10. 오늘의 시나리오 (조건부, 확률 미산정)',
  ...outlook(map),'',
  '■ QC: 기준 거래일과 일치한 일봉 '+verifiedDisplayed+'/'+MORNING_SERIES.length
   +' · 야간선물 '+(reference?'확보':'미확보'),
  '일봉은 각 항목 [날짜] 기준이며 현재가·KRX 공식 정산가와 다릅니다.',
  '미확보 항목은 원천 갱신 지연 또는 거래일 미검증으로 표기합니다.'];
  // Keep sentiment optional: the original market report and 07:40 gate take priority.
  const sentiment=formatFearGreed(options?.fearGreed,{now:options?.now||new Date()});
  const insertAt=lines.indexOf('■ 6. 원자재 / 가상자산');
  const baseline=lines.join('\n');
  if(insertAt>=0&&baseline.length+sentiment.length+1<=3900)
    lines.splice(insertAt,0,sentiment);
  // Extra read-only indicators must never cancel the 07:40 briefing when
  // all 21 dated core rows and the investment commentary are present.
  // Remove optional supplemental lines only; never truncate a verified close,
  // the session date, the delivery QC, or the 06:00 NH reference.
  let message=lines.join('\n');
  const optional=[
    /^시장폭 A\/D:/,/^미국 선물 참고:/,/^미 국채 2Y /,
    /^지수 구성종목 거래대금:/,/^VKOSPI:/
  ];
  for(const pattern of optional){
    if(message.length<=3900)break;
    const i=lines.findIndex(line=>pattern.test(line));
    if(i>=0)lines.splice(i,1);
    message=lines.join('\n');
  }
  if(message.length>3900)throw Error('TELEGRAM_FULL_BRIEFING_TOO_LONG');
  return message;
}
