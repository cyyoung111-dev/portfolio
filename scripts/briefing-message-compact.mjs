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
 return /^(?:미확보(?:$|\s|\()|종가 미확보|완료 종가 미확보|검증값 미확보|검증된 .*미확보|당일 확정치 미확보|당일 참고값 미확보|최근 허용 관측일 자료 미확보|동일 기준일 자료 미확보)/.test(value);
}
function cleanRow(line,mode) {
 if(missingMarketRow(line))return null;
 if(/^미확보: /u.test(line)||/^미연결 참고지표: /u.test(line))return null;
 if(/^유효한 최근 거래값 미확보/u.test(line)
  ||/^확보 0\/4 · 실시간 확정값/u.test(line))return null;
 if(/^• 실수요: .*미연결/u.test(line))return null;
 if(mode==='close'&&line.startsWith('■ 데이터 확인: ')){
   // Preserve the core 6-series score, but hide groups with zero usable data.
   return line.replace(/ · (?:참고|주요 종목|환율·금리|원자재\/BTC|국채금리·스프레드|VKOSPI|KRX (?:지수 구성 )?거래대금|수급|시장자금) 0\/\d+/gu,'');
 }
 return line;
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
 return output.join('\n');
}
