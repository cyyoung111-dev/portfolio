// Offline status/date contract only. The source labels and verified:true flag
// are CALLER CLAIMS, not proof of KRX provenance. A future trusted adapter
// must authenticate the underlying official records before constructing these.
// Never infer past listing status from the present-day master value.
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const STATES=new Set(['ACTIVE','SUSPENDED','DELISTED']);
function validDay(s){
  if(typeof s!=='string'||!DAY.test(s))return false;
  const n=Date.parse(s+'T00:00:00Z');
  return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===s;
}
function bad(reason){return Object.freeze({status:'BLOCKED',reason});}
export function assessNhListingAsOf(item,tradingDate){
  if(!validDay(tradingDate))return bad('LISTING_DATE_INVALID');
  const h=item?.listingEvidence;
  if(!h)return bad('LISTING_EVIDENCE_MISSING');
  if(h.source!=='KRX_OFFICIAL_HISTORY'||h.verified!==true||
    typeof h.recordId!=='string'||!h.recordId.trim()||h.recordId.length>128||
    typeof item.securityId!=='string'||!item.securityId.trim()||
    h.securityId!==item.securityId||h.code!==item.code||
    typeof item.code!=='string'||!validDay(h.codeValidFrom)||
    (h.codeValidUntilExclusive!==null&&!validDay(h.codeValidUntilExclusive))||
    (h.codeValidUntilExclusive!==null&&h.codeValidUntilExclusive<=h.codeValidFrom)||
    !Array.isArray(h.periods)||!h.periods.length||h.periods.length>128)
    return bad('LISTING_EVIDENCE_INVALID');
  // Validate *all* supplied intervals, including later intervals: an invalid
  // or overlapping chronology cannot be hidden by one otherwise valid row.
  let previousUntil=null;
  for(let i=0;i<h.periods.length;i++){
    const p=h.periods[i];
    if(!p||!STATES.has(p.state)||!validDay(p.from)||
      (p.untilExclusive!==null&&!validDay(p.untilExclusive))||
      (p.untilExclusive!==null&&p.untilExclusive<=p.from))
      return bad('LISTING_EVIDENCE_INVALID');
    if(previousUntil===null&&i>0)return bad('LISTING_EVIDENCE_CONFLICT');
    if(previousUntil!==null&&p.from<previousUntil)return bad('LISTING_EVIDENCE_CONFLICT');
    previousUntil=p.untilExclusive;
  }
  if(tradingDate<h.codeValidFrom)return bad('CODE_NOT_YET_EFFECTIVE');
  if(h.codeValidUntilExclusive!==null&&tradingDate>=h.codeValidUntilExclusive)
    return bad('CODE_EXPIRED');
  const active=h.periods.filter(p=>p.from<=tradingDate &&
    (p.untilExclusive===null||tradingDate<p.untilExclusive));
  if(active.length!==1)return bad(active.length>1?'LISTING_EVIDENCE_CONFLICT':'LISTING_PERIOD_UNVERIFIED');
  const state=active[0].state;
  if(item.listingStateAsOf!==tradingDate||item.listingState!==state)
    return bad('LISTING_STATUS_CONFLICT');
  if(state==='SUSPENDED')return bad('SUSPENDED_HELD_CODES');
  if(state==='DELISTED')return bad('DELISTED_HELD_CODES');
  return Object.freeze({status:'ACTIVE_PERIOD_MATCH',reason:null});
}
