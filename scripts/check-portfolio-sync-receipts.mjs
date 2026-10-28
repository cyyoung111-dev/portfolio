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
 const production={writeHoldings:ctx.handleSyncHoldings,readHoldings:ctx.handleGetHoldings,writeTrades:ctx.handleSyncTrades};
 const output=x=>({getContent:()=>JSON.stringify(x)});
 ctx.jsonOk=x=>output({status:'ok',...x});ctx.jsonError=(message,x)=>output({status:'error',message,...x});
 ctx.getss=()=>({getId:()=> 'fixture-workbook'});
 ctx._normalizeDate=x=>String(x).slice(0,10);ctx._tradeLedgerWriteUnverified_=()=>false;ctx._readPendingTradeSnapshotRebuild=()=>pending;
 ctx.handleGetHoldings=()=>output({status:'ok',holdings:rows});ctx.handleGetTrades=()=>output({status:'ok',trades:rows});
 ctx.handleSyncHoldings=(data,held)=>{assert.equal(held,true);assert.equal(locked,true);writes++;rows=JSON.parse(data);return output({status:'ok',synced:rows.length});};
 ctx.handleSyncTrades=(data,from,empty,held)=>{assert.equal(held,true);assert.equal(locked,true);writes++;rows=JSON.parse(data);return output({status:'ok',saveState:'success'});};
 return {ctx,store,production,write:p=>JSON.parse(ctx.handlePortfolioSyncWithReceipt(p).getContent()),read:p=>JSON.parse(ctx.handleGetPortfolioSyncReceipt({...p,kind:p.action}).getContent()),get writes(){return writes;},busy:x=>busy=x,pending:x=>{pending=x;if(x)store.set(ctx.TRADE_SNAPSHOT_REBUILD_PENDING_KEY,JSON.stringify({from:'2026-10-28'}));else store.delete(ctx.TRADE_SNAPSHOT_REBUILD_PENDING_KEY);},rows:x=>rows=x};
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
// 완료된 이전 작업은 정상적인 삭제/새 거래 작업을 막지 않는다.
{
 const s=server(),b=browser(),p={data:params.data},opts={targetUrl:'https://fixture.invalid/exec',generation:1};
 b.ctx.requestGsheetFormJson=async(action,input)=>action==='getPortfolioSyncReceipt'
   ? s.read({...input,action:input.kind}) : s.write({action,...input});
 assert.equal((await b.ctx._requestPortfolioRecoveryWrite('syncHoldings',p,{...opts,recoveryScope:'first-task'})).status,'ok');
 s.rows([]); // 명시적 마지막 거래 삭제는 기존 원장을 정상적으로 비울 수 있다.
 assert.equal((await b.ctx._requestPortfolioRecoveryWrite('syncHoldings',p,{...opts,recoveryScope:'new-task'})).status,'ok');
 assert.equal(s.writes,2,'새 작업은 과거의 CHANGED 기록으로 영구 차단하지 않는다');
 assert.equal((await b.ctx._requestPortfolioRecoveryWrite('syncHoldings',p,{...opts,recoveryScope:'new-task'})).status,'ok');
 assert.equal(s.writes,2,'같은 작업의 재시도는 여전히 중복 저장하지 않는다');
}

const {verifyPortfolioReceiptReadOnly}=await import('./deploy-gas.mjs');
const probeCalls=[];
const probe=await verifyPortfolioReceiptReadOnly('https://fixture.invalid/exec','fixture-token',async(url,options)=>{
 const p=new URLSearchParams(options.body);probeCalls.push(p.get('action'));
 assert.equal(p.get('data'),'[]');
 return {ok:true,json:async()=>({status:'ok',kind:p.get('kind'),operationId:p.get('operationId'),receiptState:'NOT_FOUND'})};
});
assert.equal(probe.dataWrites,0);assert.deepEqual(probeCalls,['getPortfolioSyncReceipt']);
await assert.rejects(()=>verifyPortfolioReceiptReadOnly('https://fixture.invalid/exec','',async()=>({ok:true,json:async()=>({status:'ok',receiptState:'COMPLETE'})})),/SYNC_RECEIPT_READONLY_VERIFY_FAILED/);
console.log('PASS: 배포 후 확인은 빈 가상 요청의 읽기 전용 기록 조회만 실행');

// 원문 JSON 해시→실제 보유 저장→실제 읽기 경로에서 퍼센트 문자열을 보존한다.
{
 const s=server();let rows=[];
 const range=(r,c,n=1,m=1)=>({setValues:values=>{values.forEach((line,i)=>{rows[r+i-1]||=[];line.forEach((v,j)=>rows[r+i-1][c+j-1]=v)});return range(r,c,n,m);},getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>rows[r+i-1]?.[c+j-1]??'')),setBackground(){return this},setFontColor(){return this},setFontWeight(){return this}});
 const sheet={clearContents:()=>{rows=[]},getRange:range,getLastRow:()=>rows.length,getLastColumn:()=>7};
 s.ctx.getss=()=>({getId:()=> 'fixture-workbook',getSheetByName:()=>sheet});
 s.ctx.SpreadsheetApp={flush(){}};s.ctx._portfolioLedgerMasterConflict_=()=>'';s.ctx.getCodeItems=()=>[];s.ctx._setCodeColumnText=()=>{};
 s.ctx.handleSyncHoldings=s.production.writeHoldings;s.ctx.handleGetHoldings=s.production.readHoldings;
 const p={...params,operationId:'percent_fixture_0001',data:JSON.stringify([{code:'005930',name:'test%20fund',acct:'account%2Fname',qty:1,costAmt:100,assetType:'주식'}])};
 assert.equal(s.write(p).receiptState,'COMPLETE');assert.equal(rows[1][1],'test%20fund');assert.equal(rows[1][6],'account%2Fname');
 assert.equal(s.read(p).receiptState,'COMPLETE');
 s.write(p);assert.equal(rows.length,2,'실제 함수 경로에서도 동일 요청이 중복 행을 만들지 않는다');
}
console.log('PASS: 실제 보유 저장/읽기 함수의 퍼센트 문자열 원문 보존');

{
 const s=server();let captured;
 s.ctx.handleSyncTrades=s.production.writeTrades;s.ctx.getCodeItems=()=>[];
 s.ctx._portfolioLedgerMasterConflict_=items=>{captured=items;return 'FIXTURE_NO_WRITE'};
 const p={...params,action:'syncTrades',operationId:'percent_trade_0001',data:JSON.stringify([{date:'2026-10-28',name:'test%20fund',memo:'memo%2Ftext',qty:1,price:100,code:'005930',tradeType:'buy',assetType:'주식'}])};
 s.write(p);assert.equal(captured[0].memo,'memo%2Ftext');assert.equal(captured[0].name,'test%20fund');
}

// 상태 모델: PARTIAL은 worker 복구 증거가 모두 갖춰져야 읽기만으로 COMPLETE가 된다.
{
 const s=server();let calls=0;
 const p={...params,action:'syncTrades',operationId:'partial_recovery_01',data:JSON.stringify([{date:'2026-10-28',name:'test-private-security',qty:1,price:100,code:'005930',tradeType:'buy',assetType:'주식'}])};
 s.ctx.handleSyncTrades=data=>{calls++;s.rows(JSON.parse(data));return {getContent:()=>JSON.stringify({status:'error',saveState:'partial',affectedFrom:'2026-10-01',affectedTo:'2026-10-28'})}};
 assert.equal(s.write(p).receiptState,'PARTIAL');
 const key=[...s.store.keys()].find(k=>k.startsWith('portfolio_sync_receipt_v1_'));
 const record=JSON.parse(s.store.get(key));record.at='2026-10-28T00:00:00.000Z';s.store.set(key,JSON.stringify(record));
 assert.equal(s.read(p).receiptState,'PARTIAL','pending만 지워졌다고 완료가 아님');
 s.ctx._tradeLedgerContentFingerprint_=()=> 'current-ledger-hash';
 s.store.set(s.ctx.TRADE_LEDGER_FINGERPRINT_KEY,'current-ledger-hash');
 s.ctx._markTradeSnapshotWorkerResult_({status:'COMPLETED',processed:1});
 s.pending(true);assert.equal(s.read(p).receiptState,'PARTIAL');s.pending(false);
 s.store.set(s.ctx.TRADE_SNAPSHOT_DEFERRED_DATES_KEY,JSON.stringify({dates:['2026-10-15'],cursor:''}));
 assert.equal(s.read(p).receiptState,'PARTIAL','영향 날짜의 deferred는 완료 아님');
 s.store.delete(s.ctx.TRADE_SNAPSHOT_DEFERRED_DATES_KEY);
 s.store.set(s.ctx.TRADE_LEDGER_FINGERPRINT_KEY,'stale-ledger-hash');assert.equal(s.read(p).receiptState,'PARTIAL');
 s.store.set(s.ctx.TRADE_LEDGER_FINGERPRINT_KEY,'current-ledger-hash');
 const before=[...s.store];assert.equal(s.read(p).receiptState,'COMPLETE');assert.deepEqual([...s.store],before,'복구 확인 API는 Properties와 원장을 쓰지 않음');
 assert.equal(s.write(p).replayed,true);assert.equal(calls,1,'worker 복구 후 원장을 재저장하지 않음');
 s.rows([]);assert.equal(s.read(p).receiptState,'CHANGED');
}
console.log('PASS: 실제 worker 완료 기록·fingerprint·pending/deferred 기반 PARTIAL 복구');
