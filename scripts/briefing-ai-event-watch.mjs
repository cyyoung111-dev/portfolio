// US AI value-chain watchlist: observations only, never a synthetic "AI index".
// This list is separate from the 21-series punctual market-briefing gate.
export const AI_EVENT_WATCH = Object.freeze([
  ['MU','마이크론','MEMORY','large'],['SKHY','SK하이닉스 ADR','MEMORY','medium'],
  ['TSM','TSMC','FOUNDRY','large'],['SNDK','샌디스크','NAND','medium'],
  ['CRWV','코어위브','NEOCLOUD','volatile'],['IREN','아이렌','NEOCLOUD','volatile'],
  ['MSFT','마이크로소프트','HYPERSCALER','large'],['AMZN','아마존','HYPERSCALER','large'],
  ['GOOGL','알파벳','HYPERSCALER','large'],['META','메타','HYPERSCALER','large'],
  ['SPCX','스페이스X','SPACE','volatile'],
  ['AMD','AMD','CPU','medium'],['INTC','인텔','CPU','medium'],
  ['ARM','ARM','CPU','medium'],['QCOM','퀄컴','CPU','large'],
  ['ANET','아리스타네트웍스','NETWORK','medium'],
  ['AAPL','애플','PLATFORM','large'],['TSLA','테슬라','PLATFORM','medium'],
  ['PLTR','팔란티어','SOFTWARE','medium'],['BE','블룸에너지','POWER','volatile'],
  ['GEV','GE버노바','POWER','medium'],['ORCL','오라클','CLOUD','medium'],
  ['ASML','ASML','EQUIPMENT','large'],
  // Existing briefing core companies retained, not removed from original coverage.
  ['NVDA','엔비디아','GPU','large'],['AVGO','브로드컴','NETWORK','medium']
].map(([symbol,label,sector,tier])=>Object.freeze({symbol,label,sector,tier})));

const THRESHOLD=Object.freeze({large:4,medium:6,volatile:10});
const validDay=date=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)
  &&Number.isFinite(Date.parse(date+'T00:00:00Z'))
  &&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
const pct=value=>(value>=0?'+':'')+value.toFixed(2)+'%';
const SECTOR_LABEL=Object.freeze({
 MEMORY:'메모리',FOUNDRY:'파운드리',NAND:'낸드',NEOCLOUD:'네오클라우드',
 HYPERSCALER:'하이퍼스케일러',SPACE:'우주·AI인프라',CPU:'CPU·설계',
 NETWORK:'네트워크',PLATFORM:'플랫폼',SOFTWARE:'소프트웨어',
 POWER:'전력',CLOUD:'클라우드',EQUIPMENT:'반도체 장비',GPU:'AI 반도체'
});

// Pure selector: a large stock move is an OBSERVATION, not proof of earnings
// news, contracts or improving AI demand. No stale, missing or duplicate rows.
export function selectAiEventHighlights({expectedUsDate,prices=[],marketChangePercent=null,limit=3}={}){
 if(!validDay(expectedUsDate)||!Array.isArray(prices))return [];
 const ndx=Number.isFinite(marketChangePercent)?Number(marketChangePercent):null;
 const ranked=[];
 for(const item of AI_EVENT_WATCH){
  const found=prices.filter(row=>row?.symbol===item.symbol&&row?.label===item.label
   &&row?.date===expectedUsDate&&row?.source==='YAHOO_DAILY_REFERENCE'
   &&row?.unit==='USD'&&Number.isFinite(row.value)&&row.value>0
   &&Number.isFinite(row.changePercent)&&Math.abs(row.changePercent)<=300);
  if(found.length!==1)continue;
  const move=found[0].changePercent,threshold=THRESHOLD[item.tier];
  if(Math.abs(move)<threshold)continue;
  const relative=ndx===null?null:move-ndx;
  ranked.push({...item,date:expectedUsDate,value:found[0].value,changePercent:move,
   relativeToNdxPp:relative,score:Math.abs(move)/threshold});
 }
 ranked.sort((a,b)=>b.score-a.score||Math.abs(b.changePercent)-Math.abs(a.changePercent)
   ||a.symbol.localeCompare(b.symbol));
 // Avoid three near-identical headlines from a single group.
 const selection=[],selectedSectors=new Set(),max=Math.min(3,Math.max(0,Number(limit)||0));
 for(const row of ranked){
  if(selection.length>=max)break;
  if(selectedSectors.has(row.sector))continue;
  selection.push(row);selectedSectors.add(row.sector);
 }
 for(const row of ranked){
  if(selection.length>=max)break;
  if(!selection.includes(row))selection.push(row);
 }
 return selection;
}

// Items must still match the completed, expected NY session when formatted.
// Do not add this optional section when no material movement was verified.
export function formatAiEventHighlights({expectedUsDate,events=[]}={}){
 if(!validDay(expectedUsDate)||!Array.isArray(events))return [];
 const allowed=new Set(AI_EVENT_WATCH.map(x=>x.symbol));
 const verified=events.filter(x=>x?.date===expectedUsDate&&allowed.has(x.symbol)
  &&Number.isFinite(x.value)&&x.value>0&&Number.isFinite(x.changePercent)
  &&Math.abs(x.changePercent)<=300).slice(0,3);
 if(!verified.length)return [];
 return ['■ AI 밸류체인 주요 변동 ('+expectedUsDate+' 미국 정규장)',
  ...verified.map(x=>'• '+x.label+' ('+x.symbol+') '+pct(x.changePercent)
   +' / USD '+x.value.toLocaleString('en-US',{maximumFractionDigits:2})
   +' — '+(SECTOR_LABEL[x.sector]||'AI 관련주')+' 변동'
   +(Number.isFinite(x.relativeToNdxPp)?' · 나스닥100 대비 '
     +(x.relativeToNdxPp>=0?'+':'')+x.relativeToNdxPp.toFixed(2)+'%p':'') ),
  '※ 주가 변동만 검증됨. 실적·계약·공시 원인은 별도 확인 전 단정하지 않습니다.'];
}
