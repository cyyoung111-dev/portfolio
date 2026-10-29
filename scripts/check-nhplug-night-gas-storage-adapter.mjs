import assert from 'node:assert/strict';
import {buildNightReference} from './nhplug-k200-night-contract.mjs';
import {persistNightReference,readNightForBriefing} from './nhplug-night-gas-storage-adapter.mjs';

const base={
  source:'NH_PLUG',market:'KRX',session:'NIGHT',instrument:'KOSPI200_FUTURE',
  tradingDate:'2026-10-29',contract:'KA016C000',contractMonth:'2026-12',
  contractVerified:true,priceType:'LAST_TRADE',officialClose:false,
  value:350.25,observedAt:'2026-10-29T05:59:50+09:00',
  receivedAt:'2026-10-29T06:05:00+09:00'
};
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(initial=[]){
  const state={rows:copy(initial),writes:0,replaces:0,reads:0,releases:0,locks:0,
    busy:false,readFailAt:0,writeAckLost:false,readbackCorrupt:false,releaseFails:false};
  const lock={
    tryLock:ms=>{assert.equal(ms,5000);state.locks++;return !state.busy;},
    releaseLock:()=>{state.releases++;if(state.releaseFails)throw Error('release loss');}
  };
  const store={
    listRows:()=>{
      state.reads++;
      if(state.readFailAt===state.reads)throw Error('read lost');
      const rows=copy(state.rows);
      if(state.readbackCorrupt && state.reads>=2 && rows.length)rows.at(-1).value=1;
      return rows;
    },
    appendRow:row=>{
      state.writes++;state.rows.push(copy(row));
      if(state.writeAckLost)throw Error('ack lost after successful write');
    },
    replaceRow:(index,row)=>{
      state.replaces++;assert.ok(index>=0);state.rows[index]=copy(row);
      if(state.writeAckLost)throw Error('ack lost after successful write');
    }
  };
  return {state,lock,store};
}
const args=(f,candidate=base)=>({candidate,store:f.store,lock:f.lock});
{
 const f=fixture([{storageKey:'LEGACY',value:123}]);
 const result=persistNightReference(args(f));
 assert.deepEqual(result,{status:'INSERTED_CONFIRMED',wrote:true,committed:true});
 assert.equal(f.state.writes,1);assert.equal(f.state.replaces,0);
 assert.equal(f.state.rows[0].storageKey,'LEGACY','unrelated rows untouched');
 assert.equal(f.state.releases,1);
 const next=persistNightReference(args(f));
 assert.deepEqual(next,{status:'UNCHANGED_CONFIRMED',wrote:false,committed:true});
 assert.equal(f.state.writes,1,'repeat must not append');
 const older={...base,observedAt:'2026-10-29T05:58:00+09:00',receivedAt:'2026-10-29T06:03:00+09:00'};
 assert.equal(persistNightReference(args(f,older)).status,'STALE_IGNORED_CONFIRMED');
 assert.equal(f.state.writes,1);
 const newer={...base,value:350.30,observedAt:'2026-10-29T05:59:59+09:00',receivedAt:'2026-10-29T06:06:00+09:00'};
 assert.equal(persistNightReference(args(f,newer)).status,'UPDATED_CONFIRMED');
 assert.equal(f.state.replaces,1);assert.equal(f.state.rows.length,2);
 assert.equal(f.state.rows[1].value,350.30);
 const before=JSON.stringify(f.state.rows);
 const conflict={...base,value:350.35,receivedAt:'2026-10-29T06:06:00+09:00'};
 assert.equal(persistNightReference(args(f,conflict)).status,'CONFLICT');
 assert.equal(JSON.stringify(f.state.rows),before,'conflict must not write');
 const read=readNightForBriefing({tradingDate:base.tradingDate,asOf:'2026-10-29T07:30:00+09:00',store:f.store,lock:f.lock});
 assert.equal(read.status,'REFERENCE_VERIFIED_NOT_OFFICIAL');
 assert.equal(read.reference.officialClose,false);
 assert.equal(read.reference.value,350.30);
 assert.equal(read.reference.storageKey,'NH_PLUG|K200_NIGHT|2026-10-29|KA016C000');
 const early=readNightForBriefing({tradingDate:base.tradingDate,asOf:'2026-10-29T06:04:00+09:00',store:f.store,lock:f.lock});
 assert.equal(early.status,'REFERENCE_MISSING_OR_AMBIGUOUS');
 assert.equal(early.reference,null);
 assert.equal(readNightForBriefing({tradingDate:base.tradingDate,store:f.store,lock:f.lock}).status,'DATE_OR_CUTOFF_INVALID');
 assert.equal(readNightForBriefing({tradingDate:base.tradingDate,asOf:'2026-10-29T05:59:59+09:00',store:f.store,lock:f.lock}).status,'DATE_OR_CUTOFF_INVALID');
 assert.equal(readNightForBriefing({tradingDate:base.tradingDate,asOf:'2026-10-29T08:10:00+09:00',store:f.store,lock:f.lock}).status,'DATE_OR_CUTOFF_INVALID');
 assert.equal(readNightForBriefing({tradingDate:base.tradingDate,asOf:'2026-10-29T07:30:00',store:f.store,lock:f.lock}).status,'DATE_OR_CUTOFF_INVALID');
}
{
 const bad=fixture();
 assert.equal(persistNightReference(args(bad,{...base,officialClose:true})).status,'INPUT_REJECTED');
 assert.equal(bad.state.locks,0);
 assert.equal(bad.state.writes,0);
}
{
 const busy=fixture();busy.state.busy=true;
 assert.equal(persistNightReference(args(busy)).status,'BUSY');
 assert.equal(busy.state.writes,0);
 assert.equal(busy.state.releases,0);
 const read=readNightForBriefing({tradingDate:base.tradingDate,asOf:'2026-10-29T07:30:00+09:00',store:busy.store,lock:busy.lock});
 assert.equal(read.status,'BUSY');
}
{
 const f=fixture();f.state.readFailAt=1;
 assert.equal(persistNightReference(args(f)).status,'READ_FAILED');
 assert.equal(f.state.writes,0);assert.equal(f.state.releases,1);
}
{
 const f=fixture();f.state.writeAckLost=true;
 const first=persistNightReference(args(f));
 assert.deepEqual(first,{status:'WRITE_UNCONFIRMED',wrote:true,committed:false});
 assert.equal(f.state.rows.length,1,'write can commit when API ack fails');
 f.state.writeAckLost=false;
 assert.equal(persistNightReference(args(f)).status,'UNCHANGED_CONFIRMED','retry uses key and readback; no duplicate');
 assert.equal(f.state.rows.length,1);assert.equal(f.state.writes,1);
}
{
 const f=fixture();f.state.readFailAt=2;
 assert.equal(persistNightReference(args(f)).status,'READBACK_UNCONFIRMED');
 assert.equal(f.state.rows.length,1);
}
{
 const f=fixture();f.state.readbackCorrupt=true;
 assert.equal(persistNightReference(args(f)).status,'READBACK_MISMATCH');
 assert.equal(f.state.releases,1);
}
{
 const prior=buildNightReference(base);
 const f=fixture([prior,prior]);
 assert.equal(persistNightReference(args(f)).status,'DUPLICATE_KEY_CONFLICT');
 assert.equal(f.state.writes,0);assert.equal(f.state.replaces,0);
 assert.equal(readNightForBriefing({tradingDate:base.tradingDate,asOf:'2026-10-29T07:30:00+09:00',store:f.store,lock:f.lock}).status,'REFERENCE_MISSING_OR_AMBIGUOUS');
}
{
 const prior=buildNightReference(base);
 const f=fixture([{...prior,sourceDate:'2026-10-28'}]);
 assert.equal(persistNightReference(args(f)).status,'STORED_ROW_INVALID');
 assert.equal(f.state.writes,0);
}
{
 const good=buildNightReference(base);
 const corrupted={...good,receivedAt:'not-a-timestamp'};
 const f=fixture([good,corrupted]);
 const read=readNightForBriefing({tradingDate:base.tradingDate,asOf:'2026-10-29T07:30:00+09:00',store:f.store,lock:f.lock});
 assert.equal(read.status,'STORED_ROW_INVALID','a malformed peer cannot be silently filtered');
 assert.equal(read.reference,null);
}
{
 const f=fixture();
 const second={...base,contract:'KA0173000',contractMonth:'2027-03'};
 assert.equal(persistNightReference(args(f)).status,'INSERTED_CONFIRMED');
 assert.equal(persistNightReference(args(f,second)).status,'INSERTED_CONFIRMED');
 assert.equal(readNightForBriefing({tradingDate:base.tradingDate,asOf:'2026-10-29T07:30:00+09:00',store:f.store,lock:f.lock}).status,'REFERENCE_MISSING_OR_AMBIGUOUS','rollover ambiguity');
}
{
 const f=fixture();f.state.releaseFails=true;
 assert.equal(persistNightReference(args(f)).status,'LOCK_RELEASE_UNCONFIRMED');
 assert.equal(f.state.rows.length,1,'do not claim confirmed when release fails');
}
console.log('NH GAS night reference isolated lock, readback, failure and recovery tests passed');
{
 const prior=buildNightReference(base);
 const reversed=Object.fromEntries(Object.entries(prior).reverse());
 const f=fixture([reversed]);
 assert.equal(persistNightReference(args(f)).status,'UNCHANGED_CONFIRMED');
 assert.equal(f.state.writes,0);
}
{
 const prior=buildNightReference(base);
 const filler=Array.from({length:49999},(_,i)=>({storageKey:'other'+i}));
 const f=fixture([...filler,prior]);
 const next={...base,contract:'KA0173000',contractMonth:'2027-03'};
 assert.equal(persistNightReference(args(f,next)).status,'CAPACITY_REACHED');
 assert.equal(f.state.writes,0);
 assert.equal(persistNightReference(args(f)).status,'UNCHANGED_CONFIRMED');
}

