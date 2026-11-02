// Evidence-bounded AI value-chain commentary for the 17:00 closing briefing.
// Market-price proxies are NOT direct evidence of hyperscaler CAPEX or AI ROI.
// Keep unconnected operating indicators explicitly out of factual conclusions.
const valid=(row,date,source)=>row&&row.date===date&&row.source===source
  &&Number.isFinite(row.value)&&row.value>0
  &&Number.isFinite(row.changePercent);
const pct=x=>(x>=0?'+':'')+x.toFixed(2)+'%';
const point=x=>(x>=0?'+':'')+x.toFixed(2)+'%p';

export function formatAiIndustryCloseLens({date,usDate,nh=[],secondary=[],stocks=[]}={}){
 const spx=nh.find(x=>x?.symbol==='^GSPC'&&valid(x,usDate,'NH_INDEX_DAILY'));
 const ndx=nh.find(x=>x?.symbol==='^NDX'&&valid(x,usDate,'NH_INDEX_DAILY'));
 const sox=secondary.find(x=>x?.label==='SOX'&&x.role==='NON_NH_REFERENCE_ONLY'
   &&valid(x,usDate,'FRED_NASDAQSOX'));
 const stockDates={SAMSUNG:date,SKHYNIX:date,NVDA:usDate,MU:usDate};
 const goodStocks=stocks.filter(x=>Object.hasOwn(stockDates,x?.id)
   &&x.date===stockDates[x.id]&&x.source==='NH_REGULAR_CLOSE'
   &&Number.isFinite(x.value)&&x.value>0);
 const confirmed=new Set(goodStocks.map(x=>x.id));
 const lines=['■ 먼저 보는 시장 해석 — AI 산업 전체'];
 if(spx&&ndx){
   const spread=ndx.changePercent-spx.changePercent;
   const direction=spread>0.15?'기술주 상대강세':spread< -0.15?'기술주 상대약세':'기술주·시장 수익률 유사';
   lines.push('• 투자심리: NASDAQ100 '+pct(ndx.changePercent)+' / S&P500 '
     +pct(spx.changePercent)+' → '+direction+' ('+point(spread)+').'
     +' AI 실수요의 직접 지표는 아닙니다.');
 }else lines.push('• 투자심리: 동일 거래일의 NH 미국지수 수익률 부족 → 방향 판단 유보.');
 if(ndx&&sox){
   const spread=sox.changePercent-ndx.changePercent;
   lines.push('• 반도체 사이클: SOX '+pct(sox.changePercent)+' / NASDAQ100 대비 '
     +point(spread)+'. 반도체 가격 흐름과 AI 발주 증거는 구별해야 합니다.');
 }else lines.push('• 반도체 사이클: SOX·NASDAQ100 동시 검증값 부족 → 상대강도 판단 유보.');
 lines.push('• GPU·HBM·메모리: 주요 4종목 NH 확정 종가 '+confirmed.size+'/4.'
   +(confirmed.size<4?' 개별주 반응을 업황 확정 근거로 사용하지 않습니다.':' 기업별 실적·수주 확인은 별도 필요합니다.'));
 lines.push('• AI 투자 수요: 빅테크 CAPEX·클라우드 매출·GPU 주문 데이터 미연결.'
   +' 수요 증가나 투자 축소를 지수만으로 단정하지 않습니다.');
 lines.push('• 파급 산업: 네트워크·광통신, 데이터센터 전력·냉각, AI 소프트웨어'
   +' 수주·수익화는 별도 검증 대상입니다.');
 lines.push('• 포트폴리오 관점: 반도체 주가뿐 아니라 AI 설비투자 → HBM/GPU 수요'
   +' → 전력 인프라 → 서비스 수익화의 연결과 현금흐름을 함께 점검.');
 lines.push('• 조건부: CAPEX·실적 개선과 반도체 상대강도 회복은 긍정,'
   +' 투자 지연·수익화 둔화·밸류에이션 부담은 경계. (확률 판단 아님)');
 return lines;
}
