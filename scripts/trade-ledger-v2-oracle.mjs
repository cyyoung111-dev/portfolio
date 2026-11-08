// Offline design oracle for #734 trade-ledger identity v2. NOT production GAS.
// No network, Sheets, deployment or financial writes. The real GAS handler
// must later be tested against these SAME cases before release.
import {createHash} from 'node:crypto';

const FIELDS=['date','tradeType','acct','name','code','qty','price','assetType',
 'memo','ratio','fractionalCash','priceRaw','fxRateAtBuy'];
const NUMBERS=new Set(['qty','price','ratio','fractionalCash','priceRaw','fxRateAtBuy']);
const fail=(errorCode)=>({ok:false,errorCode});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function tradeV2Canonical(row) {
 return [String(row?.id??''),
  ...FIELDS.map(key=>{
   const value=row?.[key];
   if(value===undefined||value===null||value==='')return '';
   if(NUMBERS.has(key)){
    const n=Number(value);
    if(!Number.isFinite(n))throw Error('TRADE_NUMBER_INVALID');
    return n;
   }
   return String(value);
  })];
}
export function tradeV2RowHash(row){return digest(tradeV2Canonical(row));}
export function tradeV2Revision(rows){
 if(!Array.isArray(rows))throw Error('TRADE_ROWS_INVALID');
 return digest(rows.map(tradeV2Canonical));
}
function uniqueById(rows){
 const map=new Map();
 for(const row of rows){
  const id=String(row?.id??'');
  if(!/^(tr|srv)_[A-Za-z0-9_-]{6,128}$/.test(id))
   return fail('TRADE_ID_MISSING_OR_INVALID');
  if(map.has(id))return fail('TRADE_ID_DUPLICATE');
  map.set(id,row);
 }
 return {ok:true,map};
}
function validateFx(row){
 const r=row?.priceRaw,f=row?.fxRateAtBuy;
 const hasR=r!==undefined&&r!==null&&r!=='';
 const hasF=f!==undefined&&f!==null&&f!=='';
 if(hasR!==hasF)return fail('TRADE_FX_METADATA_INCOMPLETE');
 if(!hasR)return {ok:true};
 const amount=Number(r),rate=Number(f),price=Number(row?.price);
 if(!Number.isFinite(amount)||!Number.isFinite(rate)||!Number.isFinite(price)
    ||amount<=0||rate<=0||price<=0||Math.round(amount*rate)!==price)
  return fail('TRADE_FX_METADATA_PRICE_MISMATCH');
 return {ok:true};
}
/**
 * Validates an immutable-ID full-ledger proposal. This is a design oracle;
 * production GAS must implement its own under-lock CAS/readback and receipt.
 * intents: [{type:'create'|'update'|'delete',id,beforeHash?}]
 */
export function inspectTradeV2Proposal({before,after,intents,expectedRevision}){
 if(!Array.isArray(before)||!Array.isArray(after)||!Array.isArray(intents))
  return fail('TRADE_ROWS_INVALID');
 const knownRevision=tradeV2Revision(before);
 if(!expectedRevision||expectedRevision!==knownRevision)
  return fail('TRADE_LEDGER_REVISION_CONFLICT');
 const old=uniqueById(before),next=uniqueById(after);
 if(!old.ok)return old;
 if(!next.ok)return next;
 const wishes=new Map();
 for(const it of intents){
  const id=String(it?.id??''),type=it?.type;
  if(!['create','update','delete'].includes(type)||!id
      ||wishes.has(id))return fail('TRADE_INTENT_INVALID');
  wishes.set(id,it);
 }
 for(const [id,row] of old.map){
  const nextRow=next.map.get(id);
  const intent=wishes.get(id);
  if(!nextRow){
   if(intent?.type!=='delete')return fail('TRADE_DELETE_INTENT_REQUIRED');
   if(intent.beforeHash!==tradeV2RowHash(row))return fail('TRADE_PREIMAGE_MISMATCH');
   continue;
  }
  if(intent?.type==='delete'||intent?.type==='create')
   return fail('TRADE_INTENT_CONFLICT');
  const oldFx=row.priceRaw!==undefined&&row.priceRaw!==null&&row.priceRaw!=='';
  const nextFx=nextRow.priceRaw!==undefined&&nextRow.priceRaw!==null&&nextRow.priceRaw!=='';
  const nextRate=nextRow.fxRateAtBuy!==undefined
   &&nextRow.fxRateAtBuy!==null&&nextRow.fxRateAtBuy!=='';
  if(oldFx&&(!nextFx||!nextRate))
   return fail('TRADE_FX_METADATA_LOSS_RISK');
  if(tradeV2RowHash(row)!==tradeV2RowHash(nextRow)&&intent?.type!=='update')
   return fail('TRADE_UPDATE_INTENT_REQUIRED');
  if(intent?.type==='update'&&intent.beforeHash!==tradeV2RowHash(row))
   return fail('TRADE_PREIMAGE_MISMATCH');
 }
 for(const [id,row] of next.map){
  const check=validateFx(row);
  if(!check.ok)return check;
  if(!old.map.has(id)&&wishes.get(id)?.type!=='create')
   return fail('TRADE_CREATE_INTENT_REQUIRED');
 }
 for(const [id,intent] of wishes){
  if(intent.type==='create'){
   if(old.map.has(id)||!next.map.has(id))return fail('TRADE_INTENT_CONFLICT');
  }else if(!old.map.has(id))return fail('TRADE_INTENT_CONFLICT');
 }
 return {ok:true,newRevision:tradeV2Revision(after),
  counts:{before:before.length,after:after.length,changes:intents.length}};
}
