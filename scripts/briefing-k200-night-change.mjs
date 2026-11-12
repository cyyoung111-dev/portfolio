// K200 night delta must compare the same listed futures CONTRACT to the prior
// regular DAY-session SETTLEMENT. It MUST NOT compare against KOSPI200 spot,
// previous night last trade, another contract month or an indicative close.
// No provider is connected here. An absent verified baseline means no delta.
const day=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)
 &&Number.isFinite(Date.parse(d+'T00:00:00Z'))
 &&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const tick=x=>typeof x==='number'&&Number.isFinite(x)&&x>0
 &&Math.abs(x*20-Math.round(x*20))<1e-7;
export function verifiedK200NightChange(reference,baseline,{date}={}){
 if(!day(date)||reference?.source!=='NH'||reference.kind!=='REFERENCE'
  ||reference.tradingDate!==date||reference.officialClose!==false
  ||reference.sourceUpdatedAt!==date+'T06:00:00+09:00'
  ||!/^K[A-Z0-9]{8}$/.test(reference.contract||'')
  ||!/^20\d\d-(?:03|06|09|12)$/.test(reference.contractMonth||'')
  ||!tick(reference.value))return null;
 if(baseline?.source!=='KRX_OFFICIAL'||baseline?.status!=='FINAL'
  ||baseline?.priceType!=='SETTLEMENT'||baseline?.market!=='KRX'
  ||baseline?.session!=='DAY'||baseline?.instrument!=='KOSPI200_FUTURE'
  ||baseline.contract!==reference.contract
  ||baseline.contractMonth!==reference.contractMonth
  ||!day(baseline.tradingDate)||baseline.tradingDate>=date
  ||!tick(baseline.value))return null;
 const gapDays=(Date.parse(date+'T00:00:00Z')-Date.parse(baseline.tradingDate+'T00:00:00Z'))/86400000;
 if(gapDays<1||gapDays>4)return null;
 // Reject a 4-day gap when the last session is not verifiable in source;
 // holidays cannot be guessed by comparing dates alone. Only 1 day is
 // supported pending KRX trade-calendar validation for weekends/holidays.
 if(gapDays!==1)return null;
 const pt=Math.round((reference.value-baseline.value)*20)/20;
 const percent=pt/baseline.value*100;
 if(!Number.isFinite(percent)||Math.abs(percent)>30)return null;
 return Object.freeze({points:pt,percent,
  settlement:baseline.value,settlementDate:baseline.tradingDate,
  nightValue:reference.value,contract:reference.contract});
}
export function formatK200NightChange(delta){
 if(!delta)return null;
 const s=n=>(n>=0?'+':'')+n.toFixed(2);
 return '전일 동일 월물 정산가 '+delta.settlement.toFixed(2)
  +'pt ['+delta.settlementDate+' KRX] 대비 '
  +s(delta.points)+'pt ('+s(delta.percent)+'%)'
  +' · 야간 마지막 체결 기준';
}
