import {selectCurrentFuturesRows} from './closing-current-futures.mjs';
import {validClosingStockReference} from './closing-extra-daily-sources.mjs';
// Evidence-bounded AI value-chain commentary for the 17:00 closing briefing.
// Market-price proxies are NOT direct evidence of hyperscaler CAPEX or AI ROI.
// Keep unconnected operating indicators explicitly out of factual conclusions.
const valid=(row,date,source)=>row&&row.date===date&&row.source===source
  &&Number.isFinite(row.value)&&row.value>0
  &&Number.isFinite(row.changePercent);
const pct=x=>(x>=0?'+':'')+x.toFixed(2)+'%';
const point=x=>(x>=0?'+':'')+x.toFixed(2)+'%p';

export function formatAiIndustryCloseLens({date,usDate,nh=[],domestic=[],secondary=[],stocks=[],futures=[],now=new Date(date+'T17:00:00+09:00')}={}){
 const spx=nh.find(x=>x?.symbol==='^GSPC'&&valid(x,usDate,'NH_INDEX_DAILY'));
 const ndx=nh.find(x=>x?.symbol==='^NDX'&&valid(x,usDate,'NH_INDEX_DAILY'));
 const soxMatches=secondary.filter(x=>x?.label==='SOX'&&x.role==='NON_NH_REFERENCE_ONLY'
   &&(valid(x,usDate,'FRED_NASDAQSOX')||valid(x,usDate,'YAHOO_SOX_DAILY_REFERENCE')));
 const sox=soxMatches.length===1?soxMatches[0]:null;
 const contracts=[
  ['SAMSUNG',date,'삼성전자','005930.KS'],
  ['SKHYNIX',date,'SK하이닉스','000660.KS'],
  ['NVDA',usDate,'엔비디아','NVDA'],
  ['MU',usDate,'마이크론','MU']
 ];
 const confirmed=contracts.filter(([id,expected,label,symbol])=>{
  const rows=stocks.filter(x=>x?.id===id);
  return rows.length===1&&rows[0].date===expected
   &&rows[0].label===label&&rows[0].symbol===symbol
   &&validClosingStockReference(date,rows[0]);
 });
 const fresh=selectCurrentFuturesRows(date,futures,now);
 const kospi=domestic.filter(x=>x?.label==='KOSPI'&&x.date===date
    &&['KRX_OFFICIAL','FDR_KRX_CACHE','YAHOO_SHINHAN_CROSSCHECKED_EOD'].includes(x.source)
    &&Number.isFinite(x.changePercent)&&Number.isFinite(x.value)&&x.value>0);
 const kosdaq=domestic.filter(x=>x?.label==='KOSDAQ'&&x.date===date
    &&['KRX_OFFICIAL','FDR_KRX_CACHE','YAHOO_SHINHAN_CROSSCHECKED_EOD'].includes(x.source)
    &&Number.isFinite(x.changePercent)&&Number.isFinite(x.value)&&x.value>0);
 const kr=kospi.length===1&&kosdaq.length===1?{kospi:kospi[0],kosdaq:kosdaq[0]}:null;
 const lines=['■ 먼저 보는 시장 해석 — AI 산업 전체'];
 if(kr)lines.push('• 한국장: KOSPI '+pct(kr.kospi.changePercent)
  +' / KOSDAQ '+pct(kr.kosdaq.changePercent)
  +(kr.kospi.changePercent>0&&kr.kosdaq.changePercent>0
    ?' → 양 시장 상승. 다만 상승 종목 수·수급 확인 전에는 확산 여부를 단정하지 않습니다.'
    :kr.kospi.changePercent<0&&kr.kosdaq.changePercent<0
      ?' → 양 시장 하락. 반도체 실적 악화로 단정하지 않습니다.'
      :' → 대형주·중소형주 신호가 혼재합니다.'));
 else lines.push('• 한국장: 당일 양 시장 지수 검증이 불완전하여 상승 확산 여부는 유보.');
 const markets=fresh.map(x=>x.id);
 if(markets.includes('NQ')&&markets.includes('ES')){
  lines.push('• 17시 시장: 미국 NASDAQ100·S&P500 선물의 최근 거래값 확인.'
   +' 방향성 판단에는 비교 가능한 기준 가격이 추가로 필요합니다.');
 }else lines.push('• 17시 시장: 미국 지수선물 최신값 일부 미확보. 방향성 판단 보류.');
 if(spx&&ndx){
   const spread=ndx.changePercent-spx.changePercent;
   const direction=spread>0.15?'기술주 상대강세':spread< -0.15?'기술주 상대약세':'기술주·시장 수익률 유사';
   lines.push('• 직전 미국장: NASDAQ100 '+pct(ndx.changePercent)+' / S&P500 '
     +pct(spx.changePercent)+' → '+direction+' ('+point(spread)+').'
     +' AI 실수요의 직접 지표는 아닙니다.');
 }else lines.push('• 직전 미국장: 동일 거래일 지수 수익률 부족 → 판단 보류.');
 if(ndx&&sox){
   const spread=sox.changePercent-ndx.changePercent;
   lines.push('• 반도체 사이클: SOX '+pct(sox.changePercent)+' / NASDAQ100 대비 '
     +point(spread)+'. 반도체 가격 흐름과 AI 발주 증거는 구별해야 합니다.');
 }else lines.push('• 반도체 사이클: SOX·NASDAQ100 동시 검증값 부족 → 상대강도 판단 유보.');
 lines.push('• GPU·HBM·메모리: 주요 4종목 종가 '+confirmed.length+'/4.'
   +(confirmed.length<4?' 개별주 반응을 업황 확정 근거로 사용하지 않습니다.':' 기업별 실적·수주 확인은 별도 필요합니다.'));
 lines.push('• AI 수요 검증: 빅테크 CAPEX·클라우드 매출·GPU 주문 데이터 미연결.'
   +' AI 설비투자 → HBM/GPU 수요 → 네트워크·광통신·전력·냉각 → AI 소프트웨어 수익화의 연결이 핵심.');
 lines.push('■ 투자 판단 — 4가지 원칙 적용 (인물의 당일 의견이 아님)');
 lines.push('• 버핏: GPU/HBM의 점유율보다 경쟁우위·투하자본수익률(ROIC)·유지 CAPEX 차감 후 소유주 현금흐름을 확인.');
 lines.push('• 다모다란: AI 매출 성장률과 재투자·영업마진을 현금흐름으로 환산해 할인율로 평가.'
   +' 시장가격이 요구하는 성장 가정과 비교.');
 lines.push('• 애크먼: 해자·반복 FCF·재무안정성이 확인된 기업만 높은 집중 위험을 감수할 근거가 됩니다.'
   +' 실제 계좌별 중복 노출은 별도 검산.');
 lines.push('• 피터 린치: 수요·이익 성장과 지불하는 PER을 함께 비교.'
   +' 메모리 업황 최고점의 일시적 EPS로 PEG·저평가를 단정하지 않음.');
 lines.push('■ 조건부 시나리오 · 다음 확인');
 lines.push('• 긍정: 빅테크 CAPEX 대비 AI 매출·FCF가 개선되고 HBM 수주·마진이 유지되면'
   +' 반도체 이익 지속성에 우호적.');
 lines.push('• 경계: 투자 회수 지연, 가격경쟁, 재고·증설 부담이 커지면'
   +' 높은 반도체 비중의 영구손실 위험을 재평가.');
 lines.push('• 실행 기준: 기업별 실적/가이던스·FCF·밸류에이션·반도체 비중이 확인되기 전에는'
   +' 단일 거래일 지수만으로 매수·매도 결론을 내리지 않습니다.');
 return lines;
}
