import {selectCurrentFuturesRows} from './closing-current-futures.mjs';
import {formatSemiconductorCompanyMetrics} from './briefing-semiconductor-company-views.mjs';
import {validClosingStockReference} from './closing-extra-daily-sources.mjs';
// Evidence-bounded AI value-chain commentary for the 17:00 closing briefing.
// Market-price proxies are NOT direct evidence of hyperscaler CAPEX or AI ROI.
// Keep unconnected operating indicators explicitly out of factual conclusions.
const valid=(row,date,source)=>row&&row.date===date&&row.source===source
  &&Number.isFinite(row.value)&&row.value>0
  &&Number.isFinite(row.changePercent);
const pct=x=>(x>=0?'+':'')+x.toFixed(2)+'%';
const point=x=>(x>=0?'+':'')+x.toFixed(2)+'%p';
// Compact daily commentary: facts and relative moves, not repeated investment
// principles. The detailed evaluator remains available to offline research.
export function formatCompactCloseLens({date,usDate,nh=[],domestic=[],secondary=[],stocks=[],futures=[],now=new Date(date+'T17:00:00+09:00')}={}){
 const single=(rows,predicate)=>{const a=rows.filter(predicate);return a.length===1?a[0]:null;};
 const kr=label=>single(domestic,x=>x?.label===label&&x.date===date
   &&['KRX_OFFICIAL','FDR_KRX_CACHE','YAHOO_SHINHAN_CROSSCHECKED_EOD'].includes(x.source)
   &&Number.isFinite(x.value)&&x.value>0&&Number.isFinite(x.changePercent));
 const us=symbol=>single(nh,x=>x?.symbol===symbol&&valid(x,usDate,'NH_INDEX_DAILY'));
 const ref=(label,sources)=>single(secondary,x=>x?.label===label&&x.role==='NON_NH_REFERENCE_ONLY'
   &&sources.includes(x.source)&&valid(x,usDate,x.source));
 const stock=id=>single(stocks,x=>x?.id===id&&validClosingStockReference(date,x)&&Number.isFinite(x.changePercent));
 const k=kr('KOSPI'),q=kr('KOSDAQ'),sp=us('^GSPC'),nd=us('^NDX');
 const sox=ref('SOX',['FRED_NASDAQSOX','YAHOO_SOX_DAILY_REFERENCE']);
 const vix=ref('VIX',['CBOE_VIX_DAILY']);
 const out=[];
 if(k&&q){const same=k.changePercent<0&&q.changePercent<0?'동반 하락':k.changePercent>0&&q.changePercent>0?'동반 상승':'혼조';
  const lead=k.changePercent-q.changePercent;
  out.push('• 국내 증시: 양 시장 '+same+(Math.abs(lead)>=0.5?' · '+(lead>0?'코스피':'코스닥')+' 상대강세 '+Math.abs(lead).toFixed(2)+'%p':'')+'.');}
 if(sp&&nd&&sox){const d=sox.changePercent-nd.changePercent;
  const tech=nd.changePercent-sp.changePercent;
  out.push('• 미국: 기술주 '+(tech<-0.15?'상대약세':tech>0.15?'상대강세':'시장과 유사')+' ('+point(tech)+') · 반도체 '+(d<-0.15?'상대약세':d>0.15?'상대강세':'시장과 유사')+' ('+point(d)+').');}
 else if(sp&&nd){out.push('• 미국: NASDAQ100의 S&P500 대비 '+point(nd.changePercent-sp.changePercent)+'.');}
 const s=stock('SAMSUNG'),h=stock('SKHYNIX'),n=stock('NVDA'),m=stock('MU');
 const pairs=[];
 if(s&&h&&Math.abs(s.changePercent-h.changePercent)>=0.5)pairs.push((s.changePercent>h.changePercent?'삼성전자':'SK하이닉스')+' 국내 반도체 상대강세 '+Math.abs(s.changePercent-h.changePercent).toFixed(2)+'%p');
 if(n&&m&&Math.abs(n.changePercent-m.changePercent)>=0.5)pairs.push((n.changePercent>m.changePercent?'엔비디아':'마이크론')+' 미국 반도체 상대강세 '+Math.abs(n.changePercent-m.changePercent).toFixed(2)+'%p');
 if(pairs.length)out.push('• 반도체: '+pairs.join(' · ')+'.');
 const fresh=selectCurrentFuturesRows(date,futures,now);
 const nq=fresh.find(x=>x.id==='NQ'),es=fresh.find(x=>x.id==='ES');
 if(nq&&es&&Number.isFinite(nq.changePercent)&&Number.isFinite(es.changePercent))
   out.push('• 17시 선물: S&P500 '+pct(es.changePercent)+' / NASDAQ100 '+pct(nq.changePercent)+' (Yahoo 비교 기준).');
 if(vix&&Math.abs(vix.changePercent)>=5)out.push('• 위험선호: VIX '+pct(vix.changePercent)+' · '+(vix.changePercent>0?'변동성 확대':'변동성 완화')+'.');
 return out.length?['■ 시장 해석',...out.slice(0,5)]:[];
}


export function formatAiIndustryCloseLens({date,usDate,nh=[],domestic=[],secondary=[],stocks=[],futures=[],financialEvidence=null,now=new Date(date+'T17:00:00+09:00')}={}){
 const spx=nh.find(x=>x?.symbol==='^GSPC'&&valid(x,usDate,'NH_INDEX_DAILY'));
 const ndx=nh.find(x=>x?.symbol==='^NDX'&&valid(x,usDate,'NH_INDEX_DAILY'));
 const soxMatches=secondary.filter(x=>x?.label==='SOX'&&x.role==='NON_NH_REFERENCE_ONLY'
   &&(valid(x,usDate,'FRED_NASDAQSOX')||valid(x,usDate,'YAHOO_SOX_DAILY_REFERENCE')));
 const sox=soxMatches.length===1?soxMatches[0]:null;
 const vixMatches=secondary.filter(x=>x?.label==='VIX'
  &&x.role==='NON_NH_REFERENCE_ONLY'
  &&['CBOE_VIX_DAILY','FRED_VIXCLS','YAHOO_VIX_DAILY_REFERENCE'].includes(x.source)
  &&valid(x,usDate,x.source));
 const vix=vixMatches.length===1?vixMatches[0]:null;
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
 // Keep exact-date DART BPS/PBR and dated prices, but omit repeated
 // five-investor narratives so cash market and macro rows remain visible.
 lines.push(...formatSemiconductorCompanyMetrics({
  date,period:'close',stocks,financialEvidence
 }));
 lines.push('■ 조건부 시나리오 · 다음 확인');
 lines.push('• 긍정: 빅테크 CAPEX 대비 AI 매출·FCF가 개선되고 HBM 수주·마진이 유지되면'
   +' 반도체 이익 지속성에 우호적.');
 lines.push('• 경계: 투자 회수 지연, 가격경쟁, 재고·증설 부담이 커지면'
   +' 높은 반도체 비중의 영구손실 위험을 재평가.');
 lines.push('• 실행 기준: 기업별 실적/가이던스·FCF·밸류에이션·반도체 비중이 확인되기 전에는'
   +' 단일 거래일 지수만으로 매수·매도 결론을 내리지 않습니다.');
 return lines;
}
