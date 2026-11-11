// Read-only presentation audit. Distinguishes source unavailability from
// rows collected but not displayed in the 3,900-char Telegram payload.
// Never emit quotes, amounts, source credentials, raw message, or timestamps.
const CONF=Object.freeze({
 morning:Object.freeze({
  futures:{max:4,re:/^미국 선물 참고:/m},
  treasury:{max:3,re:/^미 국채 2Y /m},
  vkospi:{max:1,re:/^VKOSPI: [0-9]/m},
  turnover:{max:2,re:/^지수 구성종목 거래대금:/m},
  breadth:{max:2,re:/^시장폭 A\/D:/m},
  liquidity:{max:2,re:/^시장자금: (?:예탁금|신용융자)/m},
  investors:{max:2,re:/^시장 수급 \[/m}
 }),
 close:Object.freeze({
  futures:{max:4,re:/^(?:S&P500 선물|NASDAQ100 선물|다우 선물|러셀2000 선물): [0-9]/m},
  treasury:{max:3,re:/^미 국채 (?:2년|3년|10년): [0-9]/m},
  vkospi:{max:1,re:/^VKOSPI: [0-9]/m},
  turnover:{max:2,re:/^(?:KOSPI|KOSDAQ) 지수 구성종목 거래대금: [0-9]/m},
  liquidity:{max:2,re:/^시장자금: (?:예탁금|신용융자)/m},
  investors:{max:2,re:/^시장 수급 \[/m}
 })
});
export function summarizeOptionalDelivery(kind,counts,message){
 const defs=CONF[kind];
 if(!defs||typeof message!=='string'||message.length>4000)return null;
 const groups={};
 for(const [key,{max,re}] of Object.entries(defs)){
  const available=counts?.[key];
  if(!Number.isInteger(available)||available<0||available>max)return null;
  const present=re.test(message);
  groups[key]={
   sourced:available,total:max,
   status:available===0?'SOURCE_UNAVAILABLE'
    :!present?'NOT_DISPLAYED'
    :available===max?'DISPLAYED':'PARTIAL_DISPLAYED'
  };
 }
 return {kind:'OPTIONAL_DISPLAY_AUDIT',briefing:kind,groups,
  displayed:Object.values(groups).filter(x=>x.status.endsWith('DISPLAYED')
   &&x.status!=='NOT_DISPLAYED').length,
  sourced:Object.values(groups).filter(x=>x.sourced>0).length};
}
