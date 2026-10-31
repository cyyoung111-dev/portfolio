// Issue #507: source-only, no network or write APIs. The privatePlan must NEVER
// be logged, sent to Telegram, exposed via GAS web, or persisted without a
// separately reviewed GAS writer/release and fresh financial approval.
export const TARGET_DATE = '2026-10-30';
const OLD_SOURCE = 'KRX_CARRY@2026-10-29';
const FUNDS = new Set(['F00001','F00002']);
const EXCHANGES = new Set(['KRX','KRX_OTP']);
const NUMERIC = /^[0-9]+(?:\.[0-9]+)?$/;

function stop(reason){throw Error('ISSUE507_SCOPE_PLAN_'+reason);}
function str(x){return String(x??'').trim();}
function code(x){return str(x).toUpperCase();}
function num(x){
 const s=str(x).replace(/,/g,'');
 return NUMERIC.test(s)?Number(s):NaN;
}
function valid(x){return Number.isFinite(x)&&x>=0;}
const round2=n=>Number(n.toFixed(2));
const closeEnough=(a,b)=>Math.abs(a-b)<0.00011;
const dayOf=x=>str(x).slice(0,10);

export function planIssue507Oct30ScopedRevaluation({
 date, snapshotRows, historyRows, officialCloses, ledgerHoldings, sourceEvidence
}={}){
 if(date!==TARGET_DATE||sourceEvidence?.mode!=='ISSUE507_OCT30_PRIVATE_KRX_QUOTE_PROOF'
    ||sourceEvidence?.date!==TARGET_DATE
    ||sourceEvidence?.status!=='PER_CODE_SOURCE_AND_STORAGE_SCOPE_VERIFIED'
    ||sourceEvidence?.verifiedPrivateQuoteCount!==37
    ||sourceEvidence?.individualQuoteValuesDisclosed!==false
    ||sourceEvidence?.safeToWrite!==false)stop('ATTESTATION');
 if(!Array.isArray(snapshotRows)||snapshotRows.length!==39
    ||!Array.isArray(historyRows)||historyRows.length!==2
    ||!Array.isArray(ledgerHoldings)||ledgerHoldings.length!==37
    ||!officialCloses||typeof officialCloses!=='object'
    ||Array.isArray(officialCloses))stop('PHYSICAL_SCOPE');
 const uniqueSnapshot=new Set(),allHeld=new Map(),navRows=new Map();
 for(const h of ledgerHoldings){
   const c=code(h?.code),qty=num(h?.qty),costAmt=num(h?.costAmt);
   if(!/^[A-Z0-9]{6}$/.test(c)||FUNDS.has(c)||allHeld.has(c)
      ||!valid(qty)||!(qty>0)||!valid(costAmt))stop('LEDGER_SCOPE');
   allHeld.set(c,{qty,costAmt});
 }
 if(allHeld.size!==37||Object.keys(officialCloses).length!==37)
   stop('OFFICIAL_SCOPE');
 const funds=new Map(),domestic=[],privateInsert=[];
 for(let i=0;i<snapshotRows.length;i++){
   const row=snapshotRows[i],c=code(row?.[1]);
   if(!Array.isArray(row)||row.length!==12||dayOf(row[0])!==TARGET_DATE
      ||!c||uniqueSnapshot.has(c))stop('SNAPSHOT_SCOPE');
   uniqueSnapshot.add(c);
   const qty=num(row[3]),costUnit=num(row[4]),costAmt=num(row[5]),
     unit=num(row[6]),amount=num(row[7]),pnl=num(row[8]),pct=num(row[9]);
   if(!valid(qty)||!valid(costUnit)||!valid(costAmt)
     ||!valid(unit)||!valid(amount)||!Number.isFinite(pnl)
     ||!Number.isFinite(pct)
     ||!closeEnough(pnl,amount-costAmt)
     ||!closeEnough(pct,costAmt>0?round2(pnl/costAmt*100):0))
     stop('SNAPSHOT_ACCOUNTING');
   if(FUNDS.has(c)){
     if(str(row[10])!=='FUND_NAV'||!(amount>0))stop('FUND_PROTECTION');
     funds.set(c,{row:row.slice(),rowIndex:i});
     continue;
   }
   if(!allHeld.has(c)||str(row[10])!==OLD_SOURCE||!(qty>0)
     ||!closeEnough(qty,allHeld.get(c).qty)
     ||!closeEnough(costAmt,allHeld.get(c).costAmt)
     ||!closeEnough(costUnit,round2(costAmt/qty)))stop('DOMESTIC_SCOPE');
   const quote=officialCloses[c],source=code(quote?.source),price=num(quote?.price);
   if(!quote||dayOf(quote.usedDate)!==TARGET_DATE
     ||!EXCHANGES.has(source)||!valid(price)||!(price>0))
     stop('OFFICIAL_NOT_EXACT');
   // Match actual frozen GAS _buildSnapshotRowsFromTradeAndPriceHistory:
   // priceKrw=Math.round(price*1), evalAmt=Math.round(priceKrw*qty).
   const priceKrw=Math.round(price);
   const newAmount=Math.round(priceKrw*qty);
   const newUnit=round2(newAmount/qty),newPnl=newAmount-costAmt;
   const newPct=costAmt>0?round2(newPnl/costAmt*100):0;
   if(![priceKrw,newAmount,newUnit,newPnl,newPct].every(Number.isFinite))
     stop('REVALUATION_OVERFLOW');
   const next=row.slice();
   next[6]=newUnit;next[7]=newAmount;next[8]=newPnl;
   next[9]=newPct;next[10]=source;
   domestic.push({rowIndex:i,code:c,before:row.slice(),after:next});
   privateInsert.push([TARGET_DATE,c,str(row[2]),price,'',source]);
 }
 if(uniqueSnapshot.size!==39||funds.size!==2||domestic.length!==37)
   stop('ASSET_MISMATCH');
 const seenNav=new Set();
 for(const row of historyRows){
   const c=code(row?.[1]);
   if(!Array.isArray(row)||row.length!==6
     ||dayOf(row[0])!==TARGET_DATE||!FUNDS.has(c)
     ||seenNav.has(c)||str(row[5])!=='FUND_NAV'
     ||!valid(num(row[3]))||!(num(row[3])>0)
     ||!closeEnough(num(row[3]),num(funds.get(c)?.row?.[6])))
     stop('HISTORY_MUST_BE_FUNDS_ONLY');
   seenNav.add(c);
 }
 if(seenNav.size!==2||Array.from(allHeld.keys()).some(x=>!uniqueSnapshot.has(x))
    ||Object.keys(officialCloses).some(x=>!allHeld.has(code(x))))
   stop('CODE_SET_MISMATCH');
 const summary=Object.freeze({
   mode:'ISSUE507_OCT30_SCOPED_VALUATION_PLAN',date:TARGET_DATE,
   status:'PRIVATE_DRY_RUN_ONLY',storedSnapshotRows:39,
   domesticRowRevaluations:37,priceHistoryInserts:37,
   unchangedFundRows:2,unchangedExistingHistoryRows:2,
   sourceScope:'KRX_OR_KRX_OTP_EXACT_DATE',formula:'PRODUCTION_KRW_ROUNDING',
   actualPerCodePricesPublished:false,physicalBackupVerified:false,
   writerLockVerified:false,safeToApply:false,
   financialWrites:0,gasDeployed:false,nhTokenRequested:false
 });
 // This internal object contains prices and rows. It may NOT be serialized
 // into an Actions log, GAS response, issue, PR comment, or user reply.
 return {summary,privatePlan:{domestic,priceHistoryInserts:privateInsert,
   fundRows:funds}};
}
