import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const gasSource=fs.readFileSync('src/gas/apps_script.gs','utf8');
const webSource=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
function server(){
 const store=new Map();let locked=false,busy=false,writes=0,pending=false,rows=[];
 const ctx=vm.createContext({console,Date,JSON,PropertiesService:{getScriptProperties:()=>({getProperty:k=>store.get(k)||null,setProperty:(k,v)=>store.set(k,v),getProperties:()=>Object.fromEntries(store),deleteProperty:k=>store.delete(k)})},
 Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,s)=>[...createHash('sha256').update(s).digest()]},LockService:{getScriptLock:()=>({waitLock(){assert.equal(locked,false);if(busy)throw Error('busy');locked=true;},tryLock(){if(locked||busy)return false;locked=true;return true;},releaseLock(){locked=false;}})}});
 vm.runInContext(gasSource,ctx);
 const output=x=>({getContent:()=>JSON.stringify(x)});
 ctx.jsonOk=x=>output({status:'ok',...x});ctx.jsonError=(message,x)=>output({status:'error',message,...x});
 ctx.getss=()=>({getId:()=> 'fixture-workbook'});
 ctx._normalizeDate=x=>String(x).slice(0,10);ctx._tradeLedgerWriteUnverified_=()=>false;ctx._readPendingTradeSnapshotRebuild=()=>pending;
 ctx.handleGetHoldings=()=>output({status:'ok',holdings:rows});ctx.handleGetTrades=()=>output({status:'ok',trades:rows});
 ctx.handleSyncHoldings=(data,held)=>{assert.equal(held,true);assert.equal(locked,true);writes++;rows=JSON.parse(data);return output({status:'ok',synced:rows.length});};
 ctx.handleSyncTrades=(data,from,empty,held)=>{assert.equal(held,true);assert.equal(locked,true);writes++;rows=JSON.parse(data);return output({status:'ok',saveState:'success'});};
 return {ctx,store,write:p=>JSON.parse(ctx.handlePortfolioSyncWithReceipt(p).getContent()),read:p=>JSON.parse(ctx.handleGetPortfolioSyncReceipt({...p,kind:p.action}).getContent()),get writes(){return writes;},busy:x=>busy=x,pending:x=>{pending=x;if(x)store.set(ctx.TRADE_SNAPSHOT_REBUILD_PENDING_KEY,JSON.stringify({from:'2026-10-28'}));else store.delete(ctx.TRADE_SNAPSHOT_REBUILD_PENDING_KEY);},rows:x=>rows=x};
}
const params={action:'syncHoldings',operationId:'receipt_test_000001',data:JSON.stringify([{code:'005930',name:'test-private-security',qty:1,costAmt:100,assetType:'주식',acct:'A'}])};
{
 const s=server();assert.equal(s.read(params).receiptState,'NOT_FOUND');assert.equal(s.writes,0);
 assert.equal(s.write(params).receiptState,'COMPLETE');assert.equal(s.writes,1);
 assert.equal(s.read(params).receiptState,'COMPLETE');assert.equal(s.write(params).replayed,true);assert.equal(s.writes,1,'lost ACK must not duplicate write');
 assert.equal(s.write({...params,data:params.data.replace('100','101')}).receiptState,'CONFLICT');assert.equal(s.writes,1);
 s.rows([]);assert.equal(s.read(params).receiptState,'CHANGED');assert.equal(s.write(params).receiptState,'CHANGED');assert.equal(s.writes,1);
 assert.ok(![...s.store.values()].join('').includes('test-private-security'),'receipt excludes original financial rows');
 s.busy(true);assert.equal(s.read(params).receiptState,'BUSY');s.busy(false);
}
{
 const s=server(),p={...params,action:'syncTrades',data:JSON.stringify([{date:'2026-10-28',name:'test-private-security',tradeType:'buy',code:'005930',acct:'A',qty:1,price:100,assetType:'주식'}])};
 assert.equal(s.write(p).receiptState,'COMPLETE');s.pending(true);assert.equal(s.read(p).receiptState,'PARTIAL');assert.equal(s.write(p).receiptState,'PARTIAL');assert.equal(s.writes,1);
}
{
 const s=server();s.ctx.handleSyncHoldings=()=>{throw Error('simulated abrupt exit');};s.write(params);assert.equal(s.read(params).receiptState,'UNKNOWN');assert.notEqual(s.write(params).status,'ok');
}
function browser(existingStorage){
 const storage=existingStorage || new Map();let calls=[],current=true,receiptState='NOT_FOUND',writeAck='lost';
 const ctx=vm.createContext({console,Date,Math});ctx.window=ctx;ctx.lsGet=(k,d)=>storage.has(k)?structuredClone(storage.get(k)):d;ctx.lsSave=(k,v)=>storage.set(k,structuredClone(v));ctx.isGsheetConnectionCurrent=()=>current;
 vm.runInContext(webSource,ctx);
 ctx.requestGsheetFormJson=async(action,p)=>{calls.push(action);if(action==='getPortfolioSyncReceipt')return {status:'ok',receiptState,operationId:p.operationId,kind:p.kind};receiptState='COMPLETE';return writeAck==='lost'?{status:'error',errorCode:'CLIENT_TIMEOUT'}:{status:'ok',receiptState:'COMPLETE',operationId:p.operationId};};
 return{ctx,storage,calls,state:x=>receiptState=x,current:x=>current=x};
}
{
 const b=browser(),opts={targetUrl:'https://fixture.invalid/exec',generation:1},p={data:params.data};
 const r=await b.ctx._requestPortfolioRecoveryWrite('syncHoldings',p,opts);assert.equal(r.status,'ok');assert.equal(b.calls.filter(x=>x==='syncHoldings').length,1);
 await b.ctx._requestPortfolioRecoveryWrite('syncHoldings',p,opts);assert.equal(b.calls.filter(x=>x==='syncHoldings').length,1);
 for(const state of ['BUSY','UNKNOWN','PARTIAL','CHANGED','NOT_FOUND']){b.state(state);const r=await b.ctx._requestPortfolioRecoveryWrite('syncHoldings',p,opts);assert.equal(r.status,'error');assert.equal(b.calls.filter(x=>x==='syncHoldings').length,1,'uncertain state must not retransmit');}
 b.current(false);assert.equal((await b.ctx._requestPortfolioRecoveryWrite('syncHoldings',p,opts)).status,'error');
}
console.log('PASS: 저장 영수증 잠금·응답 유실·중복·불일치·부분 완료·중단·읽기 실패·로컬 보존');

{
 const first=browser(),opts={targetUrl:'https://fixture.invalid/exec',generation:1},p={data:params.data};
 await first.ctx._requestPortfolioRecoveryWrite('syncHoldings',p,opts);
 const reopened=browser(first.storage);reopened.state('COMPLETE');
 assert.equal((await reopened.ctx._requestPortfolioRecoveryWrite('syncHoldings',p,opts)).status,'ok');
 assert.equal(reopened.calls.filter(x=>x==='syncHoldings').length,0,'browser restart reuses durable operation ID');
 const broken=browser();broken.ctx.lsSave=()=>{};
 assert.equal((await broken.ctx._requestPortfolioRecoveryWrite('syncHoldings',p,opts)).errorCode,'SYNC_RECEIPT_LOCAL_BACKUP_FAILED');
 assert.deepEqual(broken.calls,[],'no request before local intent is durable');
 const wrong=browser();wrong.ctx.requestGsheetFormJson=async()=>({status:'ok',receiptState:'COMPLETE',operationId:'another-operation',kind:'syncHoldings'});
 assert.equal((await wrong.ctx._requestPortfolioRecoveryWrite('syncHoldings',p,opts)).errorCode,'SYNC_RECEIPT_UNAVAILABLE');
}
{
 const s=server();s.write(params);s.ctx.getss=()=>({getId:()=> 'other-workbook'});
 assert.equal(s.read(params).receiptState,'CONFLICT');assert.equal(s.writes,1);
}
console.log('PASS: 브라우저 재시작·저장소 실패·잘못된 응답·원본 시트 변경 보호');
