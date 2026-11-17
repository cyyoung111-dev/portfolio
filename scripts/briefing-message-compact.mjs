// Delivery-only cleanup. Source diagnostics and coverage counters stay intact.
// Missing optional market observations are useful in operational logs, not in
// a daily Telegram message. Never manufacture or carry forward a market value.
const OPTIONAL_SECTIONS = [
 /^■ 2\. 전일 한국장$/,
 /^■ 3\. 밤사이 미국장 \/ 반도체$/,
 /^■ 4\. 코스피200 야간선물/,
 /^■ 5\. 환율 \/ 금리 \/ 변동성$/,
 /^■ 6\. 원자재 \/ 가상자산$/,
 /^■ 주요 종목 \(/,
 /^■ 환율·금리 \(/,
 /^■ 미국 국채금리 \(/,
 /^■ 원자재·BTC \(/,
 /^■ 장후 글로벌 반응/,
 /^■ 글로벌 참고 지표$/
];

function missingMarketRow(line) {
 const colon=line.indexOf(': ');
 if(colon<1||colon>65||line.startsWith('■')||line.startsWith('•'))return false;
 const value=line.slice(colon+2);
 return /^(?:미확보(?:$|\s|\()|종가 미확보|완료 종가 미확보|검증값 미확보|검증된 .*미확보|당일 확정치 미확보|당일 참고값 미확보|최근 검증된 시세 미확보|확정 기준일 자료 미확보|공식 기준일 자료 미확보|공식 당일 자료 미확보|최근 허용 관측일 자료 미확보|동일 기준일 자료 미확보)/.test(value);
}
function cleanRow(line,mode) {
 if(missingMarketRow(line))return null;
 if(/^미확보: /u.test(line)||/^미연결 참고지표: /u.test(line))return null;
 if(/^유효한 최근 거래값 미확보/u.test(line)
  ||/^확보 0\/4(?:$| ·)/u.test(line))return null;
 if(/^시장폭 A\/D: KOSPI 미확보 · KOSDAQ 미확보 \(공식 일봉 미검증\)$/u.test(line))return null;
 if(/^• 실수요: .*미연결/u.test(line))return null;
 if(mode==='morning'&&line.startsWith('■ QC: 기준 거래일과 일치한 일봉 ')){
   // Do not repeat optional night-future nonpublication as a daily warning.
   // The exact QC denominator and original diagnostics remain unchanged.
   return line.replace(/ · 야간선물 미확보$/u,'');
 }
 if(mode==='close'&&line.startsWith('■ 데이터 확인: ')){
   // Preserve the core 6-series score, but hide groups with zero usable data.
   return line.replace(/ · (?:참고|주요 종목|환율·금리|원자재\/BTC|국채금리·스프레드|VKOSPI|KRX (?:지수 구성 )?거래대금|수급|시장자금) 0\/\d+/gu,'');
 }
 return line;
}
// These three rows belong at the top in BOTH morning and closing briefings.
// Move already-produced, dated source lines only; never infer a missing price.
const US_HEADLINES=Object.freeze(['S&P 500','다우존스','NASDAQ100']);
function pinUsHeadlines(raw,compact){
 const original=raw.split('\n');
 const byName=US_HEADLINES.map(name=>{
  const rows=original.filter(line=>line.startsWith(name+': '));
  return rows.length===1?rows[0]:null;
 });
 // Keep short diagnostic/test messages and non-market Telegram texts unchanged.
 if(!byName.some(Boolean))return compact;
 const existing=compact.split('\n').filter(line=>!US_HEADLINES.some(
  name=>line.startsWith(name+': ')));
 const firstSection=existing.findIndex(line=>line.startsWith('■ '));
 if(firstSection<0)return compact;
 const heading='■ 미국 주요 3지수 (직전 완료장)';
 const values=byName.map((line,i)=>line||US_HEADLINES[i]+': 미확보');
 // A material-move note is strictly conditional on a valid numerical return
 // already printed on a sourced market row, not a prediction or a new quote.
 const alerts=[];
 for(let i=0;i<values.length;i++){
  const line=values[i];
  if(!/\[\d{4}-\d{2}-\d{2}(?:\s*·|\])/.test(line))continue;
  const pct=line.match(/\(([+-]?\d{1,3}(?:\.\d{1,2})?)%\)/);
  const change=pct?Number(pct[1]):NaN;
  if(Number.isFinite(change)&&Math.abs(change)>=2)
   alerts.push(US_HEADLINES[i]+' '+(change>=0?'+':'')+change.toFixed(2)+'%');
 }
 const headline=[heading,...values,...(alerts.length?['주요 변동: '+alerts.join(' · ')]:[]),''];
 existing.splice(firstSection,0,...headline);
 return existing.join('\n');
}
export function compactBriefingForDelivery(message,{mode}={}){
 if(typeof message!=='string'||!['morning','close'].includes(mode))
   throw Error('BRIEFING_COMPACT_INPUT_INVALID');
 // Long raw reports can exceed 5,000 chars precisely because many optional
 // indicators are unavailable. Always compact before Telegram delivery;
 // returning the raw text here resurrects repetitive missing-value warnings.
 // No verified value, section title or QC row is truncated by this pass.
 const lines=message.split('\n').map(line=>cleanRow(line,mode)).filter(line=>line!==null);
 const kept=[];
 for(let i=0;i<lines.length;){
   if(!lines[i].startsWith('■ ')){kept.push(lines[i]);i++;continue;}
   let end=i+1;
   while(end<lines.length&&!lines[end].startsWith('■ '))end++;
   const section=lines.slice(i,end);
   const optional=OPTIONAL_SECTIONS.some(re=>re.test(section[0]));
   if(!optional||section.slice(1).some(s=>s.trim()!==''))kept.push(...section);
   i=end;
 }
 // Preserve single blank separators, without changing the values or provenance.
 const output=[];
 for(const line of kept){
   if(line===''&&(output.length===0||output.at(-1)===''))continue;
   output.push(line);
 }
 while(output.at(-1)==='')output.pop();
 return pinUsHeadlines(message,output.join('\n'));
}
