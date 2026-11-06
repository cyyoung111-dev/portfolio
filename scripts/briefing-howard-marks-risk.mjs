// Shared philosophical application in 07:40 and 17:00 briefings.
// Not a quotation or a claim about Howard Marks's current market opinion.
// VIX is an equity-options volatility measure, not a corporate CDS spread.
export function formatHowardMarksView({vix=null,expectedDate=null}={}) {
 const valid=vix && typeof expectedDate==='string'
  && vix.date===expectedDate
  && Number.isFinite(vix.value) && vix.value>0
  && Number.isFinite(vix.changePercent);
 const movement=!valid
  ?'VIX 동일 거래일 확정치 미확보 → 변동성 국면 유보'
  : 'VIX '+vix.value.toFixed(2)+' (전일 '
    +(vix.changePercent>=0?'+':'')+vix.changePercent.toFixed(2)+'%, '
    +(vix.changePercent>0?'변동성 상승':vix.changePercent<0?'변동성 하락':'변동성 보합')+')';
 return '• 하워드 막스: '+movement
  +' → AI 낙관이 주가에 반영된 정도와 반대 시나리오의 손실 위험을 점검.'
  +' 회사별 5년 CDS·차입만기 미검증 → 신용사이클 판단 유보.';
}
