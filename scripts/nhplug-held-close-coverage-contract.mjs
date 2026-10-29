import {krxSessionStatus} from './krx-session-calendar.mjs';
import {assessNhListingAsOf} from './nhplug-listing-asof-contract.mjs';
import {assessNhCorporateActionAsOf} from './nhplug-corporate-action-asof-contract.mjs';

// Standalone, read-only NH T+0 KRX stock/ETF coverage audit.
// Input snapshots must be independently derived from GAS as-of ledger and code
// master; never infer held instruments from NH quote response or fixed 37 codes.
// This module makes NO API calls and cannot write GAS, KRX, ledger or Telegram.
const DOMESTIC=new Set(['KR','KRX','KOSPI','KOSDAQ','ETF']);
const FOREIGN=new Set(['US','USA','NYSE','NASDAQ','AMEX','JP','TSE','TYO','HK','HKG','LSE','UK','EU']);
const KINDS=new Set(['STOCK','ETF','FUND','CASH']);
const STATES=new Set(['ACTIVE','SUSPENDED','DELISTED','UNKNOWN']);
const SOURCE='NH_PLUG', MAX=20000;
const dateRe=/^\d{4}-\d{2}-\d{2}$/;
const instantRe=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const codeRe=/^[A-Z0-9._-]{1,18}$/;
const domesticCode=/^[0-9A-Z]{6}$/;

function fail(reason){throw Error('NH_HELD_'+reason);}
function validDate(s){
  if(typeof s!=='string'||!dateRe.test(s))return false;
  const t=Date.parse(s+'T00:00:00Z');
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s;
}
function validInstant(s){
  if(typeof s!=='string'||!instantRe.test(s)||!validDate(s.slice(0,10)))return false;
  const t=Date.parse(s);
  return Number.isFinite(t)&&new Date(t).toISOString()===new Date(t).toISOString();
}
function kstDate(ms){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',
    year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms)).map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day;
}
function positivePrice(v){
  if(typeof v!=='number'&&!(typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v.trim())))return false;
  return Number.isFinite(Number(v))&&Number(v)>0;
}
function coverageShape(name){
  return {kind:name,expected:0,covered:0,missing:0,blocked:0};
}
function issue(issues,key){issues[key]=(issues[key]||0)+1;}
function snapshotInput({tradingDate,asOf,ledgerSnapshot,masterSnapshot,observations}){
  if(!validDate(tradingDate)||krxSessionStatus(tradingDate)!=='OPEN')fail('MARKET_DAY_UNVERIFIED');
  if(!validInstant(asOf))fail('CUTOFF_INVALID');
  const cutoff=Date.parse(asOf);
  if(kstDate(cutoff)!==tradingDate||cutoff<Date.parse(tradingDate+'T15:30:00+09:00')
    ||cutoff>Date.parse(tradingDate+'T16:10:00+09:00'))fail('CUTOFF_OUT_OF_WINDOW');
  if(ledgerSnapshot?.source!=='GAS_VERIFIED_ASOF_LEDGER'||ledgerSnapshot.asOfDate!==tradingDate
    ||ledgerSnapshot.verified!==true||!Array.isArray(ledgerSnapshot.positions)
    ||ledgerSnapshot.positions.length>MAX)fail('LEDGER_NOT_VERIFIED');
  if(masterSnapshot?.source!=='GAS_VERIFIED_CODE_MASTER'||masterSnapshot.asOfDate!==tradingDate
    ||masterSnapshot.verified!==true||!Array.isArray(masterSnapshot.items)
    ||masterSnapshot.items.length>MAX)fail('MASTER_NOT_VERIFIED');
  if(!Array.isArray(observations)||observations.length>MAX)fail('OBSERVATIONS_INVALID');
  return cutoff;
}
function catalogIndex(items){
  const index=new Map();
  for(const item of items){
    if(!item||typeof item.code!=='string'||!codeRe.test(item.code)
      ||!KINDS.has(item.kind)||typeof item.market!=='string'
      ||typeof item.currency!=='string'||!STATES.has(item.listingState))
      fail('MASTER_SCHEMA_INVALID');
    if(!index.has(item.code))index.set(item.code,[]);
    index.get(item.code).push(item);
  }
  return index;
}
function isDomestic(item){
  // Never override an explicit foreign exchange just because currency is KRW.
  if(FOREIGN.has(item.market))return false;
  return DOMESTIC.has(item.market)&&item.currency==='KRW'
    &&(item.kind==='STOCK'||item.kind==='ETF');
}
function validQuote(row,code,date,cutoff){
  if(!row||row.code!==code||row.source!==SOURCE||row.market!=='KRX'
    ||row.session!=='REGULAR'||row.priceScope!=='KRX_REGULAR'
    ||row.priceKind!=='DAILY_REGULAR_CLOSE'||row.tradingDate!==date
    ||row.sourceDate!==date||row.officialFinal!==false
    ||!positivePrice(row.price)||!validInstant(row.receivedAt))return false;
  const at=Date.parse(row.receivedAt);
  return at>=Date.parse(date+'T15:30:00+09:00')&&at<=cutoff;
}
function summarizeError(issues){
  return Object.fromEntries(Object.entries(issues).sort((a,b)=>a[0].localeCompare(b[0])));
}
export function auditNhHeldCloseCoverage({
  tradingDate,asOf,ledgerSnapshot,masterSnapshot,observations=[]
}={}){
  const cutoff=snapshotInput({tradingDate,asOf,ledgerSnapshot,masterSnapshot,observations});
  const issues={}, master=catalogIndex(masterSnapshot.items);
  const positions=new Map(),aggregated=new Map();
  let excludedPositions=0,zeroPositions=0;
  for(const p of ledgerSnapshot.positions){
    if(!p||typeof p.code!=='string'||!codeRe.test(p.code)
      ||!Number.isFinite(p.quantity)||p.quantity<0)fail('POSITION_INVALID');
    if(p.quantity===0){zeroPositions++;continue;}
    const prev=aggregated.get(p.code)||{quantity:0,positionCount:0};
    aggregated.set(p.code,{quantity:prev.quantity+p.quantity,positionCount:prev.positionCount+1});
  }
  // All coverage and error-code counters are *distinct held instruments*,
  // not account rows. This makes a two-account holding one missing code.
  for(const [code,amount] of aggregated){
    const entries=master.get(code);
    if(!entries){issue(issues,'ORPHAN_LEDGER_CODES');continue;}
    if(entries.length!==1){
      issue(issues,'DUPLICATE_MASTER_CODES');
      issue(issues,'AMBIGUOUS_HELD_MASTER');continue;
    }
    const info=entries[0];
    if(!isDomestic(info)){
      if((DOMESTIC.has(info.market)&&info.currency!=='KRW'&&['STOCK','ETF'].includes(info.kind))
        ||(FOREIGN.has(info.market)&&info.currency==='KRW')
        ||(!FOREIGN.has(info.market)&&!DOMESTIC.has(info.market)&&!['FUND','CASH'].includes(info.kind)))
        issue(issues,'MARKET_CURRENCY_UNVERIFIED');
      else excludedPositions+=amount.positionCount;
      continue;
    }
    if(!domesticCode.test(info.code)||!Number.isSafeInteger(amount.quantity)
      ||amount.quantity<=0){issue(issues,'DOMESTIC_IDENTITY_UNVERIFIED');continue;}
    positions.set(code,amount.quantity);
  }
  const byCode=new Map();
  for(const row of observations){
    if(typeof row?.code!=='string'||!codeRe.test(row.code)){
      issue(issues,'UNIDENTIFIED_QUOTE_ROWS');continue;
    }
    if(!byCode.has(row.code))byCode.set(row.code,[]);
    byCode.get(row.code).push(row);
  }
  const market={STOCK:coverageShape('STOCK'),ETF:coverageShape('ETF')};
  let missing=0,blocked=0,covered=0;
  for(const [code,quantity] of positions){
    if(!Number.isSafeInteger(quantity)){issue(issues,'AGGREGATE_QUANTITY_INVALID');blocked++;continue;}
    const entry=master.get(code)[0],bucket=market[entry.kind];
    bucket.expected++;
    const listing=assessNhListingAsOf(entry,tradingDate);
    if(listing.status!=='ACTIVE_PERIOD_MATCH'){
      issue(issues,listing.reason);
      bucket.blocked++;blocked++;continue;
    }
    const action=assessNhCorporateActionAsOf(entry,tradingDate);
    if(action.status!=='NO_EFFECTIVE_ACTION'){
      // Treat an unresolved corporate action as a ledger/identity blocker,
      // not a missing NH price; prohibit prior-code price carry-forward.
      issue(issues,action.reason);
      bucket.blocked++;blocked++;continue;
    }
    const quotes=byCode.get(code)||[];
    if(quotes.length===0){issue(issues,'NH_CLOSE_MISSING');bucket.missing++;missing++;continue;}
    if(quotes.length>1){issue(issues,'DUPLICATE_QUOTE_ROWS');bucket.blocked++;blocked++;continue;}
    if(!validQuote(quotes[0],code,tradingDate,cutoff)){
      issue(issues,'NH_CLOSE_INVALID_OR_STALE');bucket.blocked++;blocked++;continue;
    }
    bucket.covered++;covered++;
  }
  for(const [code,quotes] of byCode){
    if(!positions.has(code)){
      // Orphan/excluded quote responses are never allowed to increase the held
      // denominator or pass an accidental full-coverage check.
      issue(issues,'UNEXPECTED_QUOTE_CODES');
    }
  }
  const expected=market.STOCK.expected+market.ETF.expected;
  const issueCount=Object.values(issues).reduce((n,v)=>n+v,0);
  const ready=expected>0&&covered===expected&&issueCount===0
    &&ledgerSnapshot.positions.length>0;
  const report={
    mode:'DRY_RUN',source:SOURCE,tradingDate,
    status:ready?'SOURCE_COVERAGE_COMPLETE_OFFICIAL_FINALITY_UNVERIFIED':'INCOMPLETE_OR_UNVERIFIED',
    readyForProvisionalMessage:ready,
    expectedHeldCodes:expected,receivedValidCodes:covered,missingCodes:missing,
    blockedCodes:blocked,excludedNonDomesticPositions:excludedPositions,
    ignoredZeroPositions:zeroPositions,market,issues:summarizeError(issues),
    officialKrxFinal:false,updatedFinancialData:false
  };
  // Aggregate-only: do not print user positions, account identifiers, shares,
  // securities, actual quotes or money amounts in CI/diagnostic logs.
  return Object.freeze(report);
}
