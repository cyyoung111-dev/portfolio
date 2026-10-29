import {createHash} from 'node:crypto';
import {krxSessionStatus} from './krx-session-calendar.mjs';

// Existing GAS 9.276 read-only endpoints; this is NOT an atomic as-of view.
// Never claim a verified financial position, and never write GAS or Telegram.
const CODE=/^[A-Z0-9._-]{1,18}$/;
const MAX_TRADES=20000, MAX_CODES=20000;
function fail(reason){throw Error('NH_GAS_UNIVERSE_'+reason);}
function day(s){
  if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
  const t=Date.parse(s+'T00:00:00Z');
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s;
}
function cleanCode(v){
  if(typeof v!=='string')return '';
  const s=v.trim().toUpperCase();
  if(/^\d+$/.test(s))return s.padStart(6,'0');
  return CODE.test(s)?s:'';
}
function number(v){
  return typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
}
function identity(codes){
  const result=new Map();
  for(const row of codes){
    if(!row||!cleanCode(row.code)||typeof row.name!=='string'||!row.name.trim()
      ||typeof row.market!=='string'||typeof row.currency!=='string'
      ||typeof row.type!=='string')fail('MASTER_BAD_ROW');
    const code=cleanCode(row.code);
    if(result.has(code))fail('MASTER_DUPLICATE_CODE');
    result.set(code,row);
  }
  return result;
}
function classify(row){
  const type=String(row.type||'').trim().toUpperCase();
  const market=String(row.market||'').trim().toUpperCase();
  const currency=String(row.currency||'').trim().toUpperCase();
  const kind=(type==='ETF'||market==='ETF')?'ETF':
    ['펀드','TDF','FUND'].includes(type)?'FUND':
    ['주식','STOCK'].includes(type)?'STOCK':'UNKNOWN';
  return {
    code:cleanCode(row.code),kind,market,currency,
    // Code master does not provide listing state/date. NEVER guess ACTIVE.
    listingState:'UNKNOWN',listingStateAsOf:null
  };
}
function calculateHoldings(trades,asOf,codeMaster){
  const names=new Map();
  for(const row of codeMaster.values()){
    const key=row.name.trim();
    if(!names.has(key))names.set(key,new Set());
    names.get(key).add(cleanCode(row.code));
  }
  const state=new Map();
  for(const trade of trades){
    if(!trade||!day(trade.date)||typeof trade.tradeType!=='string'
      ||typeof trade.name!=='string'||!trade.name.trim()
      ||!['buy','sell','split','reverse_split'].includes(trade.tradeType)
      ||number(trade.qty)===null||number(trade.price)===null)fail('TRADE_BAD_ROW');
    if(trade.date>asOf)continue;
    let code=cleanCode(trade.code);
    if(trade.code && !code)fail('TRADE_CODE_INVALID');
    if(!code){
      const matches=names.get(trade.name.trim());
      if(!matches||matches.size!==1)fail('UNCODED_TRADE_AMBIGUOUS');
      code=[...matches][0];
    }
    if(!codeMaster.has(code))fail('TRADE_CODE_NOT_IN_MASTER');
    const row=state.get(code)||{code,qty:0,totalCost:0};
    if(trade.tradeType==='buy'){
      if(!(trade.qty>0))fail('BUY_QTY_INVALID');
      row.qty+=trade.qty;row.totalCost+=trade.qty*trade.price;
    }else if(trade.tradeType==='sell'){
      if(!(trade.qty>0))fail('SELL_QTY_INVALID');
      const avg=row.qty>0?row.totalCost/row.qty:0;
      const qty=Math.min(trade.qty,row.qty);
      row.qty-=qty;row.totalCost-=qty*avg;
      if(row.qty<0.0001){row.qty=0;row.totalCost=0;}
    }else {
      if(!(trade.ratio>0)||!Number.isFinite(trade.ratio))fail('SPLIT_RATIO_INVALID');
      if(row.qty>0)row.qty=trade.tradeType==='split'?row.qty*trade.ratio:row.qty/trade.ratio;
    }
    if(!Number.isFinite(row.qty)||row.qty<0||!Number.isFinite(row.totalCost))fail('TRADE_ARITHMETIC');
    state.set(code,row);
  }
  const positions=[];
  for(const row of state.values()){
    if(row.qty<=0.0001)continue;
    const quantity=Math.round(row.qty*10000)/10000;
    if(!(quantity>0)||!Number.isFinite(quantity))fail('QUANTITY_INVALID');
    positions.push({code:row.code,quantity});
  }
  return positions.sort((a,b)=>a.code.localeCompare(b.code));
}
export function buildGasHeldUniverseCandidate({date,codeList,trades,codeListVersion='9.276'}={}){
  if(!day(date)||krxSessionStatus(date)!=='OPEN')fail('DATE_UNVERIFIED');
  if(!Array.isArray(codeList)||!codeList.length||codeList.length>MAX_CODES
    ||!Array.isArray(trades)||trades.length>MAX_TRADES)fail('SOURCE_MISSING');
  if(codeListVersion!=='9.276')fail('UNREVIEWED_GAS_VERSION');
  const catalog=identity(codeList);
  const positions=calculateHoldings(trades,date,catalog);
  const items=[...catalog.values()].map(classify).sort((a,b)=>a.code.localeCompare(b.code));
  // A posthoc double read is not a transaction, and the GAS master cannot
  // verify historical listing status. Downstream audits require verified:true.
  return {
    status:'CANDIDATE_NON_ATOMIC_UNVERIFIED',
    asOfDate:date,readOnly:true,verified:false,
    ledgerSnapshot:{source:'GAS_VERIFIED_ASOF_LEDGER',asOfDate:date,verified:false,positions},
    masterSnapshot:{source:'GAS_VERIFIED_CODE_MASTER',asOfDate:date,verified:false,items},
    counts:{tradeRows:trades.length,masterRows:codeList.length,heldCodes:positions.length},
    blockers:['NON_ATOMIC_GAS_READ','LISTING_STATUS_UNVERIFIED','SOURCE_PROVENANCE_UNVERIFIED']
  };
}

function validateUrl(value){
  let u;try{u=new URL(value);}catch{fail('URL_INVALID');}
  if(u.protocol!=='https:'||u.hostname!=='script.google.com'
    ||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname)
    ||u.search||u.hash||u.username||u.password)fail('URL_INVALID');
  return u.toString();
}
async function readAction(url,token,action,fetchImpl){
  let res;
  try{
    res=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action,accessToken:token}),redirect:'follow',signal:AbortSignal.timeout(30000)});
    if(!res?.ok)fail('TRANSPORT_FAILED');
    const d=await res.json();
    if(!d||typeof d!=='object')fail('RESPONSE_INVALID');
    return d;
  }catch(e){
    if(String(e?.message||'').startsWith('NH_GAS_UNIVERSE_'))throw e;
    fail('TRANSPORT_FAILED');
  }
}
export async function fetchGasHeldUniverseCandidate({date,url,token,fetchImpl=fetch}={}){
  if(!day(date)||krxSessionStatus(date)!=='OPEN')fail('DATE_UNVERIFIED');
  if(typeof token!=='string'||token.length<8)fail('AUTH_REQUIRED');
  const endpoint=validateUrl(url);
  // Fail closed when GAS compatibility mode accidentally permits anonymous
  // requests. The intentionally invalid token must be rejected.
  const denied=await readAction(endpoint,
    token==='NH_BRIDGE_INVALID_PROBE'?'NH_BRIDGE_INVALID_PROBE_X':'NH_BRIDGE_INVALID_PROBE',
    'getCodeListReadOnly',fetchImpl);
  if(denied.status!=='error'||denied.message!=='인증 실패')fail('AUTH_GUARD_NOT_PROVEN');
  // Read transactions twice around the master response. This detects common
  // changes, but DOES NOT confer transactional/atomic verified provenance.
  const first=await readAction(endpoint,token,'getTrades',fetchImpl);
  if(first.status!=='ok'||!Array.isArray(first.trades))fail('TRADES_UNAVAILABLE');
  const master=await readAction(endpoint,token,'getCodeListReadOnly',fetchImpl);
  if(master.status!=='ok'||master.readOnly!==true||master.gasVersion!=='9.276'
    ||!Array.isArray(master.codes))fail('MASTER_UNAVAILABLE');
  const second=await readAction(endpoint,token,'getTrades',fetchImpl);
  if(second.status!=='ok'||!Array.isArray(second.trades))fail('TRADES_UNAVAILABLE');
  const fingerprint=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
  if(fingerprint(first.trades)!==fingerprint(second.trades))fail('CONCURRENT_LEDGER_CHANGE');
  return buildGasHeldUniverseCandidate({
    date,codeList:master.codes,trades:second.trades,codeListVersion:master.gasVersion
  });
}

