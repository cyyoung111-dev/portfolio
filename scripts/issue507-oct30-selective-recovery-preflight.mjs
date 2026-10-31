// Issue #507: 2026-10-30 non-empty Snapshot selective-backfill preflight.
// This is evidence aggregation ONLY. It cannot fetch raw KRX prices or write data.
// A successful KRX aggregate count does not authorize a financial repair.
export const DATE='2026-10-30';
const DOMESTIC=/^[A-Z0-9]{6}$/;
const FUNDS=new Set(['F00001','F00002']);
const CARRY='KRX_CARRY@2026-10-29';

function fail(reason){throw Error('ISSUE507_OCT30_SCOPE_'+reason);}
function nonnegative(v){return Number.isSafeInteger(v)&&v>=0;}

export function evaluateOct30SelectiveRecovery({history,prices,krx,runtime}){
 if(runtime?.gasVersionVerified!=='9.281'||runtime?.sourceStableWithinRun!==true
    ||runtime?.nhTokenIssuanceRequested!==false)
   fail('PRODUCTION_PROVENANCE');
 if(history?.status!=='ok'||history.date!==DATE||!Array.isArray(history.items))
   fail('SNAPSHOT_INVALID');
 if(prices?.status!=='ok'||!prices.prices||typeof prices.prices!=='object'
    ||Array.isArray(prices.prices))fail('PRICE_HISTORY_INVALID');
 if(krx?.status!=='ok'||krx.coverage?.mode!=='READ_ONLY'
    ||krx.coverage.requestedDate!==DATE)fail('KRX_EVIDENCE_INVALID');
 const c=krx.coverage;
 const counts=['expectedHeldCodes','officialExactDateCodes','missingCodes','staleCodes',
   'duplicateMasterCodes','orphanLedgerCodes'];
 if(counts.some(key=>!nonnegative(c[key])))fail('KRX_COUNTS_INVALID');
 const stock=c.market?.STOCK,etf=c.market?.ETF;
 if(!stock||!etf||['expected','confirmed'].some(key=>
   !nonnegative(stock[key])||!nonnegative(etf[key]))
   ||stock.confirmed>stock.expected||etf.confirmed>etf.expected
   ||stock.expected+etf.expected!==c.expectedHeldCodes
   ||stock.confirmed+etf.confirmed!==c.officialExactDateCodes
   ||c.missingCodes!==c.expectedHeldCodes-c.officialExactDateCodes
   ||c.staleCodes>c.missingCodes)fail('KRX_MARKET_INCONSISTENT');
 const codeSet=new Set();
 let domestic=0,carry=0,funds=0,confirmedFunds=0,storedDomestic=0;
 if(history.items.length!==39)fail('SNAPSHOT_NOT_39');
 for(const row of history.items){
   const code=String(row?.code||'').trim().toUpperCase();
   if(!code||codeSet.has(code))fail('DUPLICATE_OR_EMPTY_CODE');
   codeSet.add(code);
   if(FUNDS.has(code)){
     funds++;
     if(row?.source!=='FUND_NAV')fail('FUND_SNAPSHOT_NOT_VERIFIED');
   }else if(DOMESTIC.test(code)){
     domestic++;
     if(row?.source!==CARRY)fail('DOMESTIC_NOT_CARRY');
     carry++;
   }else fail('UNEXPECTED_ASSET_SCOPE');
   const codePrices=prices.prices[code]||[];
   if(!Array.isArray(codePrices)||codePrices.length>1)fail('HISTORY_DUPLICATE');
   if(FUNDS.has(code)){
     if(codePrices.length!==1||codePrices[0]?.date!==DATE
       ||codePrices[0]?.source!=='FUND_NAV'
       ||!(Number(codePrices[0]?.price)>0))fail('FUND_HISTORY_NOT_VERIFIED');
     confirmedFunds++;
   }else if(codePrices.length)storedDomestic++;
 }
 if(Object.keys(prices.prices).some(code=>!codeSet.has(code)))
   fail('UNEXPECTED_STORED_PRICE');
 if(domestic!==37||carry!==37||funds!==2||confirmedFunds!==2||storedDomestic!==0)
   fail('HISTORICAL_SCOPE_DRIFT');
 if(c.expectedHeldCodes!==37||c.officialExactDateCodes!==37
   ||stock.expected!==16||stock.confirmed!==16
   ||etf.expected!==21||etf.confirmed!==21
   ||c.missingCodes!==0||c.staleCodes!==0
   ||c.duplicateMasterCodes!==0||c.orphanLedgerCodes!==0
   ||c.ready!==true)fail('KRX_SOURCE_NOT_COMPLETE');

 return {
   mode:'ISSUE507_OCT30_SELECTIVE_RECOVERY_PREFLIGHT',date:DATE,
   status:'OFFICIAL_SOURCE_READY_STORAGE_MISSING',
   logicalSnapshotRows:39,domesticCarried:37,domesticStoredExact:0,
   fundNavPreserved:2,krxOfficialExact:37,
   stockConfirmed:16,etfConfirmed:21,
   targetPriceHistoryInsertions:37,targetDomesticSnapshotRevalues:37,
   targetFundChanges:0,
   perCodeExactClosePriceEvidence:false,
   physicalSheetRowsAndDuplicatesVerifiedByThisCheck:false,
   standaloneExistingTargetedWriterSafe:false,
   safeToApply:false,requiresReviewedNewWriterAndApproval:true,
   financialWrites:0,gasDeployed:false,nhTokenRequested:false
 };
}
