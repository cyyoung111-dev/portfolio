import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

const baseline=process.argv.includes('--baseline');
const read=file=>baseline && ['features/settings/settings.js','features/management/mgmt_editor.js'].includes(file)
  ? execFileSync('git',['show',`origin/main:src/web/${file}`],{encoding:'utf8'})
  : fs.readFileSync('src/web/'+file,'utf8');
const manifest=JSON.parse(fs.readFileSync('src/web/script-manifest.json','utf8'));
function setup() {
  const noop=()=>{};
  const element={style:{setProperty:noop},dataset:{},classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},
    addEventListener:noop,querySelector:()=>null,querySelectorAll:()=>[],setAttribute:noop,getAttribute:()=>null,appendChild:noop};
  const storage=new Map();
  let writes=0,requests=0;
  const ctx=vm.createContext({console:{log:noop,warn:noop,error:noop},alert:noop,setTimeout:noop,clearTimeout:noop,setInterval:noop,clearInterval:noop,
    URL,URLSearchParams,AbortController,requestAnimationFrame:noop,
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    document:{getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>element,
      documentElement:element,body:element,addEventListener:noop},
    navigator:{},location:{search:'',hostname:'localhost'},getComputedStyle:()=>({getPropertyValue:()=>''}),
    matchMedia:()=>({matches:false,addEventListener:noop}),addEventListener:noop,
    fetch:()=>{throw Error('live network forbidden');}});
  ctx.window=ctx;
  // Load the actual classic-script dependency order, excluding automatic page startup.
  for(const file of manifest.localDeferredScripts.filter(f=>f!=='app/bootstrap.js')) {
    vm.runInContext(read(file),ctx,{filename:file});
  }
  const response={status:'ok',settings:{ACCT_COLORS:{},ACCT_ORDER:['전체'],SECTOR_COLORS:{},
    fundDirect:{},EDITABLE_PRICES:[{name:'테스트',code:'005930',sector:'기타',assetType:'주식'}],
    DIVDATA:{},LOAN:{},REAL_ESTATE:{},LOAN_SCHEDULE:[],RE_VALUE_HIST:[],SAVED_PRICES:{'005930':100},
    SAVED_PRICE_DATES:{'005930':'2026-10-07'},ACCT_TAX_TYPES:{},APP_FONT:'system',ACCOUNTS_MASTER:[]},
    codes:[],trades:[],holdings:[],portfolioReadStatus:{tradesOk:true,holdingsOk:true},gasVersion:'9.195'};
  ctx.requestGsheetActionJson=async()=>{requests++;return response;};
  ctx.requestGsheetFormJson=async()=>{writes++;throw Error('mutation forbidden');};
  vm.runInContext("GSHEET_API_URL='https://script.google.com/macros/s/test/exec'",ctx);
  return {ctx,response,storage,get requests(){return requests;},get writes(){return writes;}};
}
let h=setup();
h.ctx.applyFont=()=>{throw new ReferenceError('private_token_value is not defined');};
assert.equal(await h.ctx.loadSettings(),false);
const requestsBeforeDiagnosis=h.requests;
assert.equal(await h.ctx._diagnoseGsheetGetSettings(),'테마·계좌 설정 적용 · ReferenceError',
  'a successful getSettings retry must not erase the real restore exception');
assert.equal(h.requests,requestsBeforeDiagnosis,'diagnosis reuses the actual failure without a new request');
assert.equal(h.writes,0);
assert.equal(vm.runInContext('_gsBootRestored',h.ctx),false);
assert.ok(!h.ctx.getGsheetSettingsLoadFailure().includes('private_token_value'));
h.ctx.applyFont=()=>{};
assert.equal(await h.ctx.loadSettings(),true,'retry after local exception must recover');
assert.equal(h.ctx.getGsheetSettingsLoadFailure(),'');
assert.equal(h.writes,0);
assert.equal(vm.runInContext("STOCK_CODE['테스트']",h.ctx),'005930','leading zeros preserved');

for(const failed of ['tradesOk','holdingsOk']) {
  h=setup();h.response.portfolioReadStatus[failed]=false;
  const before=[...h.storage];
  assert.equal(await h.ctx.loadSettings(null,{forcePortfolioRestore:true}),false);
  assert.match(h.ctx.getGsheetSettingsLoadFailure(),new RegExp(failed==='tradesOk'?'TRADES_READ_FAILED':'HOLDINGS_READ_FAILED'));
  assert.deepEqual([...h.storage],before,'forced read failure must precede local settings application');
  assert.equal(h.writes,0);
  assert.equal(vm.runInContext('_gsPortfolioRestoreRequired',h.ctx),true);
}
h=setup();
h.ctx.requestGsheetActionJson=async(action,params,options)=>{
  assert.equal(options.preserveError,true);
  return {status:'error',errorCode:'CLIENT_TIMEOUT',message:'private response body'};
};
assert.equal(await h.ctx.loadSettings(),false);
assert.equal(await h.ctx._diagnoseGsheetGetSettings(),'설정 응답 · CLIENT_TIMEOUT');
assert.equal(h.writes,0);

h=setup();
let finish;
h.ctx.requestGsheetActionJson=()=>new Promise(resolve=>{finish=resolve;});
const oldLoad=h.ctx.loadSettings();
h.ctx.saveGsheetUrl('https://script.google.com/macros/s/other/exec');
h.ctx.requestGsheetActionJson=async()=>h.response;
assert.equal(await h.ctx.loadSettings(),true);
finish({status:'error',message:'old failure'});
assert.equal(await oldLoad,false);
assert.equal(h.ctx.getGsheetSettingsLoadFailure(),'','stale completion cannot overwrite a newer success');
assert.equal(h.writes,0);

// Exercise actual request transport: token reads use POST without invoking a write action.
h=setup();
h.response.codes=[{name:'테스트',code:'005930',type:'주식'}];
vm.runInContext(`EDITABLE_PRICES.push({name:'테스트',code:'005930',assetType:'주식'});
  _invalidateEPIndex();
  rawTrades.push({date:'2026-10-07',tradeType:'buy',acct:'계좌',name:'테스트',code:'005930',qty:1,price:100});
  _markPortfolioRemoteDirty();`,h.ctx);
let syncFailed=true;
h.ctx.requestGsheetFormJson=async(action)=>action==='syncTrades' && syncFailed
  ? {status:'error',saveState:'failed',message:'syncTrades 실패: 거래이력 쓰기 후 검증 실패'}
  : {status:'ok',saveState:'success'};
assert.equal(await h.ctx.loadSettings(),false,'dirty ledger verification failure blocks Bootstrap completion');
assert.equal(await h.ctx._diagnoseGsheetGetSettings(),'미동기화 거래·보유 확인 · PORTFOLIO_SYNC_FAILED');
assert.ok(h.ctx._getPortfolioRemoteDirty(),'failed pending payload must remain retryable');
assert.equal(vm.runInContext('_gsBootRestored',h.ctx),false);
assert.equal(vm.runInContext("rawTrades[0].code",h.ctx),'005930');
syncFailed=false;
assert.equal(await h.ctx.loadSettings(),true,'successful source verification permits Bootstrap retry');
assert.equal(h.ctx._getPortfolioRemoteDirty(),null);
assert.equal(h.ctx.getGsheetSettingsLoadFailure(),'');

// Exercise actual request transport: token reads use POST without invoking a write action.
h=setup();
h.ctx.setTimeout=()=>0;
h.ctx.fetch=async(url,options)=>{
  assert.equal(options.method,'POST');
  const body=new URLSearchParams(options.body);
  assert.equal(body.get('action'),'getSettings');
  assert.equal(body.get('accessToken'),'fixture-token');
  return {ok:true,json:async()=>h.response};
};
h.ctx.saveGsheetAccessToken('fixture-token');
const net=fs.readFileSync('src/web/features/settings/settings_net.js','utf8');
vm.runInContext(net,h.ctx);
assert.equal((await h.ctx.requestGsheetActionJson('getSettings',{},{})).status,'ok');
assert.equal(h.writes,0);


// Production bootstrap: remote code master is available before local master
// application, so a pinned dirty payload should not create false unmatched logs.
h=setup();
h.response.codes=[{code:'005930',name:'테스트',type:'주식',sector:'기타'}];
vm.runInContext(`EDITABLE_PRICES.length=0; _invalidateEPIndex();
  rawTrades.push({date:'2026-10-07',tradeType:'buy',acct:'계좌',name:'테스트',code:'005930',qty:1,price:100});
  _markPortfolioRemoteDirty();`,h.ctx);
let remoteTrades=[],issueWrites=0;
h.ctx.requestGsheetFormJson=async(action,params)=>{
  if(action==='syncTrades')remoteTrades=JSON.parse(params.data);
  if(action==='saveSyncIssues')issueWrites++;
  return {status:'ok',saveState:'success'};
};
assert.equal(await h.ctx.loadSettings(),true,'same Bootstrap response master validates early trade retry');
assert.equal(remoteTrades.length,1,'complete trade list submitted');
assert.equal(remoteTrades[0].code,'005930','canonical server code with leading zero');
assert.equal(issueWrites,0,'known trade should not create spurious unmatched issue logs');
assert.equal(h.ctx._getPortfolioRemoteDirty(),null,'verified retry clears its dirty marker');

// Cross-connection master conflict: the exact same server code must win
// over the stale, differently coded local name while retrying this target.
h=setup();
h.response.codes=[{code:'005930',name:'테스트',type:'주식'}];
vm.runInContext(`EDITABLE_PRICES.push({name:'테스트',code:'000660',assetType:'주식'});
  _invalidateEPIndex();
  rawTrades.push({date:'2026-10-07',tradeType:'buy',acct:'계좌',name:'테스트',code:'005930',qty:1,price:100});
  _markPortfolioRemoteDirty();`,h.ctx);
let conflictPayload=null;
h.ctx.requestGsheetFormJson=async(action,params)=>{
  if(action==='syncTrades')conflictPayload=JSON.parse(params.data);
  return {status:'ok',saveState:'success'};
};
assert.equal(await h.ctx.loadSettings(),true);
assert.equal(conflictPayload?.[0]?.code,'005930','stale local stock master cannot rewrite server-confirmed code');

// Server master disagrees with the local un-restored ledger: fail closed before
// overwriting any source trades, while preserving the retryable dirty payload.
h=setup();
h.response.codes=[{code:'005930',name:'테스트',type:'주식'}];
vm.runInContext(`EDITABLE_PRICES.length=0; _invalidateEPIndex();
  rawTrades.push({date:'2026-10-07',tradeType:'buy',acct:'계좌',name:'미등록',code:'999999',qty:1,price:100});
  rawHoldings.push({name:'미등록',code:'999999',qty:1,cost:100,acct:'계좌'});
  _markPortfolioRemoteDirty();`,h.ctx);
let unsafeTradePosts=0,unsafeHoldingsPosts=0;
h.ctx.requestGsheetFormJson=async(action)=>{
  if(action==='syncTrades')unsafeTradePosts++;
  if(action==='syncHoldings')unsafeHoldingsPosts++;
  return {status:'ok',saveState:'success'};
};
assert.equal(await h.ctx.loadSettings(),false,'unmatched trade blocks authoritative retry');
assert.equal(unsafeTradePosts,0,'unknown trade may not overwrite server ledger');
assert.equal(unsafeHoldingsPosts,0,'failed master preflight must also block parallel holdings write');
assert.ok(h.ctx._getPortfolioRemoteDirty(),'failed master validation retains dirty source');
assert.equal(h.ctx.getGsheetSettingsLoadFailure(),'미동기화 거래·보유 확인 · PORTFOLIO_SYNC_FAILED');
// Same-name-but-different-code is NOT proof of identity: block a silent
// reassignment when the original trade code is unknown to the server master.
h=setup();
h.response.codes=[{code:'005930',name:'테스트',type:'주식'}];
vm.runInContext(`EDITABLE_PRICES.length=0; _invalidateEPIndex();
  rawTrades.push({date:'2026-10-07',tradeType:'buy',acct:'계좌',name:'테스트',code:'999999',qty:1,price:100});
  _markPortfolioRemoteDirty();`,h.ctx);
let mismatchedCodePosts=0;
h.ctx.requestGsheetFormJson=async(action)=>{
  if(action==='syncTrades')mismatchedCodePosts++;
  return {status:'ok',saveState:'success'};
};
assert.equal(await h.ctx.loadSettings(),false,'same-name mismatched code cannot be silently replaced');
assert.equal(mismatchedCodePosts,0);
assert.ok(h.ctx._getPortfolioRemoteDirty(),'unknown-code trade remains retryable');

// A malformed pinned source row must not be dropped while the rest of the
// dirty ledger is saved as if it were complete.
h=setup();
h.response.codes=[{code:'005930',name:'테스트',type:'주식'}];
vm.runInContext(`EDITABLE_PRICES.length=0; _invalidateEPIndex();
  rawTrades.push({date:'2026-10-07',tradeType:'buy',acct:'계좌',name:'테스트',code:'005930',qty:1,price:100},
    {date:'',tradeType:'buy',acct:'계좌',name:'테스트',code:'005930',qty:1,price:100});
  rawHoldings.push({name:'테스트',code:'005930',qty:1,cost:100,acct:'계좌'});
  _markPortfolioRemoteDirty();`,h.ctx);
let filteredLedgerPosts=0,filteredHoldingsPosts=0;
h.ctx.requestGsheetFormJson=async(action)=>{
  if(action==='syncTrades')filteredLedgerPosts++;
  if(action==='syncHoldings')filteredHoldingsPosts++;
  return {status:'ok',saveState:'success'};
};
assert.equal(await h.ctx.loadSettings(),false,'malformed dirty source fails closed');
assert.equal(filteredLedgerPosts,0,'filtered dirty source must never overwrite remote');
assert.equal(filteredHoldingsPosts,0,'malformed trade blocks parallel holdings write');
assert.ok(h.ctx._getPortfolioRemoteDirty(),'incomplete retry retains exact original dirty source');

// Codeless funds/TDFs are represented in same-connection Settings, not
// getCodeItems(). They must remain retryable without authorizing other stocks.
for (const fundSource of ['EDITABLE_PRICES','fundDirect']) {
  h=setup();
  h.response.codes=[{code:'005930',name:'테스트',type:'주식'}];
  if (fundSource === 'EDITABLE_PRICES') {
    h.response.settings.EDITABLE_PRICES.push({name:'코드없는 펀드',code:'',assetType:'펀드'});
  } else {
    h.response.settings.fundDirect={'코드없는 펀드':{type:'TDF',cost:1000}};
  }
  vm.runInContext(`EDITABLE_PRICES.length=0; _invalidateEPIndex();
    rawTrades.push({date:'2026-10-07',tradeType:'buy',acct:'연금',name:'코드없는 펀드',code:'',assetType:'펀드',qty:1,price:1000});
    _markPortfolioRemoteDirty();`,h.ctx);
  let fundSaved=null, fundIssueCount=0;
  h.ctx.requestGsheetFormJson=async(action,params)=>{
    if(action==='syncTrades')fundSaved=JSON.parse(params.data);
    if(action==='saveSyncIssues')fundIssueCount++;
    return {status:'ok',saveState:'success'};
  };
  let restoredException='';
  h.ctx.console.warn=(...args)=>{for(const part of args)if(part?.message)restoredException=String(part.message);};
  const codelessResult = await h.ctx.loadSettings();
  assert.equal(codelessResult,true,`${fundSource}: codeless fund must not deadlock restore · ${h.ctx.getGsheetSettingsLoadFailure()} · ${restoredException}`);
  assert.equal(fundSaved?.length,1);
  assert.equal(fundSaved?.[0]?.code,'','codeless fund remains codeless');
  assert.equal(fundSaved?.[0]?.name,'코드없는 펀드');
  assert.equal(fundIssueCount,0,'validated same-server codeless fund creates no unmatched logs');
  assert.equal(h.ctx._getPortfolioRemoteDirty(),null,'verified codeless fund clears dirty state');
}

// getCodeItems intentionally excludes no-code TDF/direct-fund master entries.
// They must remain restorable without a fabricated KRX stock code.
h=setup();
h.response.codes=[];
h.response.settings.EDITABLE_PRICES=[{name:'직접 TDF',code:'',assetType:'TDF'},{name:'직접 펀드',code:'',assetType:'펀드'}];
vm.runInContext(`EDITABLE_PRICES.length=0; _invalidateEPIndex();
  STOCK_CODE['직접 TDF']='005930';
  rawTrades.push(
    {date:'2026-10-07',tradeType:'buy',acct:'연금',name:'직접 TDF',code:'',assetType:'TDF',qty:1,price:100},
    {date:'2026-10-07',tradeType:'buy',acct:'연금',name:'직접 펀드',code:'',assetType:'펀드',qty:1,price:100});
  _markPortfolioRemoteDirty();`,h.ctx);
let fundOnlyTradePosts=0,fundOnlyIssues=0,fundOnlyRows=null;
h.ctx.requestGsheetFormJson=async(action,params)=>{
  if(action==='syncTrades'){fundOnlyTradePosts++;fundOnlyRows=JSON.parse(params.data);}
  if(action==='saveSyncIssues')fundOnlyIssues++;
  return {status:'ok',saveState:'success'};
};
assert.equal(await h.ctx.loadSettings(),true,'code-less fund/TDF dirty trades must remain restorable');
assert.equal(fundOnlyTradePosts,1,'funds restored through one sync');
assert.deepEqual(fundOnlyRows.map(r=>r.code),['',''],'stale local stock code cannot leak into direct fund');
assert.deepEqual(fundOnlyRows.map(r=>r.assetType),['TDF','펀드']);
assert.equal(fundOnlyIssues,0,'valid code-less fund/TDF must not create unmatched issues');
assert.equal(h.ctx._getPortfolioRemoteDirty(),null,'fund restore clears dirty after success');

// A code-bearing trade cannot claim the direct-fund exemption, even if its
// assetType says TDF; neither holdings nor trades should be posted.
h=setup();
h.response.codes=[];
vm.runInContext(`EDITABLE_PRICES.length=0; _invalidateEPIndex();
  rawTrades.push({date:'2026-10-07',tradeType:'buy',acct:'연금',name:'위장 펀드',code:'999999',assetType:'TDF',qty:1,price:100});
  rawHoldings.push({name:'위장 펀드',code:'999999',qty:1,cost:100,acct:'연금'});
  _markPortfolioRemoteDirty();`,h.ctx);
let forgedPosts=[];
h.ctx.requestGsheetFormJson=async(action)=>{forgedPosts.push(action);return {status:'ok',saveState:'success'};};
assert.equal(await h.ctx.loadSettings(),false,'unknown coded asset fails master preflight');
assert.ok(!forgedPosts.includes('syncTrades')&&!forgedPosts.includes('syncHoldings'));
assert.ok(h.ctx._getPortfolioRemoteDirty(),'coded trade remains retryable');

// Codex PR #493 P1: legacy GAS getBootstrap fallback cannot authorize dirty
// trades against this connection's master, even if stale local names match.
h=setup();
vm.runInContext(`EDITABLE_PRICES.push({name:'테스트',code:'005930',assetType:'주식'});
  _invalidateEPIndex();
  rawTrades.push({date:'2026-10-07',tradeType:'buy',acct:'계좌',name:'테스트',code:'005930',qty:1,price:100});
  rawHoldings.push({name:'테스트',code:'005930',qty:1,cost:100,acct:'계좌'});
  _markPortfolioRemoteDirty();`,h.ctx);
const seenLegacyActions=[];
h.ctx.requestGsheetActionJson=async action=>{
  seenLegacyActions.push(action);
  return action==='getBootstrap'
    ?{status:'error',errorCode:'UNKNOWN_ACTION'}:{...h.response,codes:undefined};
};
let legacyWrites=0;
h.ctx.requestGsheetFormJson=async action=>{
  if(action==='syncTrades'||action==='syncHoldings')legacyWrites++;
  return {status:'ok',saveState:'success'};
};
assert.equal(await h.ctx.loadSettings(),false,
  'legacy GAS must not write source dirty ledger before authenticated master proof');
assert.deepEqual(seenLegacyActions,['getBootstrap','getSettings']);
assert.equal(legacyWrites,0,'legacy fallback must block both trade and holdings writes');
assert.match(h.ctx.getGsheetSettingsLoadFailure(),/RESTORE_MASTER_UNAVAILABLE/);
assert.ok(h.ctx._getPortfolioRemoteDirty(),'legacy block preserves dirty payload for upgraded GAS retry');
assert.equal(vm.runInContext('_gsBootRestored',h.ctx),false);
const restoreSource = read('features/settings/settings.js');
const loopStart = restoreSource.indexOf('for (let lateAttempt = 0; lateAttempt < 6; lateAttempt++)');
const lateMasterGuard = restoreSource.indexOf('if ((latePending || lateDirty) && !Array.isArray(bootstrapMasterForRetry))',loopStart);
const pendingWriterCall = restoreSource.indexOf('const latePendingResult = await _retryPendingExplicitEmptyTradeSync(',loopStart);
assert.ok(loopStart > 0 && lateMasterGuard > loopStart && pendingWriterCall > lateMasterGuard,
  'late pending + dirty master guard must precede any retry writer');

// Regression: pending + dirty created AFTER getBootstrap starts but BEFORE
// legacy getSettings resolves must not execute the pending writer first.
// The writer would otherwise POST syncHoldings/syncTrades/saveSettings using
// stale browser master before late-dirty guard rejects the restore.
h=setup();
let releaseBootstrap;
const legacyLateActions=[];
h.ctx.requestGsheetActionJson=async action=>{
  if(action==='getBootstrap')return new Promise(resolve=>{releaseBootstrap=resolve;});
  legacyLateActions.push(action);
  if(action==='getSettings')return {...h.response,codes:undefined};
  if(action==='getTrades')return {status:'ok',trades:[]};
  if(action==='getHoldings')return {status:'ok',holdings:[]};
  return {status:'error',errorCode:'UNKNOWN_ACTION'};
};
h.ctx.requestGsheetFormJson=async action=>{
  legacyLateActions.push(action);
  return {status:'ok',saveState:'success'};
};
const inFlightLegacyRestore=h.ctx.loadSettings(null,{forcePortfolioRestore:true});
assert.equal(typeof releaseBootstrap,'function');
vm.runInContext(`
  EDITABLE_PRICES.push({name:'테스트',code:'005930',assetType:'주식'});
  _invalidateEPIndex();
  rawTrades.push({date:'2026-10-07',tradeType:'buy',acct:'계좌',
    name:'테스트',code:'005930',qty:1,price:100});
  rawHoldings.push({name:'테스트',code:'005930',qty:1,cost:100,acct:'계좌'});
  _setPendingExplicitEmptyTradeSync({target:GSHEET_API_URL,from:'user-delete'});
  _markPortfolioRemoteDirty();
`,h.ctx);
assert.ok(h.ctx._getPendingExplicitEmptyTradeSync(),'late pending setup');
assert.ok(h.ctx._getPortfolioRemoteDirty(),'late dirty setup');
releaseBootstrap({status:'error',errorCode:'UNKNOWN_ACTION'});
assert.equal(await inFlightLegacyRestore,false,
  'legacy getSettings with late pending/dirty must fail closed');
for(const action of ['syncHoldings','syncTrades','saveSettings'])
  assert.ok(!legacyLateActions.includes(action),
    'late pending must not perform '+action+' before pinned master check');
assert.match(h.ctx.getGsheetSettingsLoadFailure(),/RESTORE_MASTER_UNAVAILABLE/);
assert.ok(h.ctx._getPendingExplicitEmptyTradeSync(),'retryable late pending retained');
assert.ok(h.ctx._getPortfolioRemoteDirty(),'retryable late dirty retained');
assert.equal(vm.runInContext('rawTrades.length',h.ctx),1,
  'local new trade survives refused legacy pull');
assert.equal(vm.runInContext('_gsBootRestored',h.ctx),false);

// A pending deletion at load start also cannot sync its holdings/trades
// before an upgraded Bootstrap proves the active connection's master.
h=setup();
vm.runInContext(`_setPendingExplicitEmptyTradeSync({target:GSHEET_API_URL,from:'user-delete'});`,h.ctx);
const noMasterWrites=[];
h.ctx.requestGsheetActionJson=async action=>action==='getBootstrap'
  ?{status:'error',errorCode:'UNKNOWN_ACTION'}:{...h.response,codes:undefined};
h.ctx.requestGsheetFormJson=async action=>{
  noMasterWrites.push(action);
  return {status:'ok',saveState:'success'};
};
assert.equal(await h.ctx.loadSettings(null,{forcePortfolioRestore:true}),false);
assert.equal(noMasterWrites.length,0,'initial pending on legacy must not write');
assert.ok(h.ctx._getPendingExplicitEmptyTradeSync(),'initial pending preserved');
assert.match(h.ctx.getGsheetSettingsLoadFailure(),/RESTORE_MASTER_UNAVAILABLE/);



// Full-payload preflight: empty trades must not authorize unrelated holdings or funds.
for (const scenario of [
  {name:'holdings only, unknown code',payload:"rawHoldings.push({name:'이전 종목',code:'999999',qty:1,cost:100,acct:'일반'});"},
  {name:'holdings code/name mismatch',payload:"rawHoldings.push({name:'이전 종목',code:'005930',qty:1,cost:100,acct:'일반'});"},
  {name:'valid trade but unrelated holding',payload:"rawTrades.push({date:'2026-10-07',tradeType:'buy',name:'테스트',code:'005930',qty:1,price:100}); rawHoldings.push({name:'이전 종목',code:'999999',qty:1,cost:100,acct:'일반'});"},
  {name:'fundDirect only, not on server',payload:"fundDirect['이전 TDF']={type:'TDF',cost:1000};"},
  {name:'valid trade but unrelated direct fund',payload:"rawTrades.push({date:'2026-10-07',tradeType:'buy',name:'테스트',code:'005930',qty:1,price:100}); fundDirect['이전 TDF']={type:'TDF',cost:1000};"},
  {name:'forged code-less TDF holding',payload:"rawHoldings.push({name:'이전 TDF',code:'',assetType:'TDF',qty:1,cost:100,acct:'연금'});"},
]) {
  h=setup(); h.response.codes=[{name:'테스트',code:'005930',type:'주식'}];
  vm.runInContext(scenario.payload+" _markPortfolioRemoteDirty();",h.ctx);
  const posted=[];
  h.ctx.requestGsheetFormJson=async action=>{posted.push(action);return {status:'ok',saveState:'success'};};
  assert.equal(await h.ctx.loadSettings(),false,scenario.name+' must fail closed');
  assert.ok(!posted.some(action=>['syncHoldings','syncTrades','saveSettings'].includes(action)),
    scenario.name+' must not write either remote payload');
  assert.ok(h.ctx._getPortfolioRemoteDirty(),scenario.name+' must preserve dirty source');
}
for (const scenario of [
  {name:'known stock holdings, no trades',payload:"rawHoldings.push({name:'테스트',code:'005930',qty:1,cost:100,acct:'일반'});"},
  {name:'known direct fund',serverFund:{'직접 TDF':{type:'TDF',cost:1000}},
    payload:"fundDirect['직접 TDF']={type:'TDF',cost:1200};"},
  {name:'known code-less fund holding',serverEP:{name:'직접 펀드',code:'',assetType:'펀드'},
    payload:"rawHoldings.push({name:'직접 펀드',code:'',assetType:'펀드',qty:1,cost:100,acct:'연금'});"},
]) {
  h=setup(); h.response.codes=[{name:'테스트',code:'005930',type:'주식'}];
  if (scenario.serverFund) h.response.settings.fundDirect=scenario.serverFund;
  if (scenario.serverEP) h.response.settings.EDITABLE_PRICES.push(scenario.serverEP);
  vm.runInContext(scenario.payload+" _markPortfolioRemoteDirty();",h.ctx);
  const posted=[];
  h.ctx.requestGsheetFormJson=async action=>{posted.push(action);return {status:'ok',saveState:'success',synced:1};};
  assert.equal(await h.ctx.loadSettings(),true,scenario.name+' should recover');
  assert.ok(posted.includes('syncHoldings'),scenario.name+' must write verified holdings');
  assert.ok(posted.includes('saveSettings'),scenario.name+' must write verified settings');
  assert.equal(h.ctx._getPortfolioRemoteDirty(),null);
}
// Pending recovery uses a separate writer; direct-fund validation must precede it.
h=setup();
vm.runInContext("rawTrades.push({date:'2026-10-07',tradeType:'buy',name:'테스트',code:'005930',qty:1,price:100}); fundDirect['이전 TDF']={type:'TDF',cost:1000}; _setPendingExplicitEmptyTradeSync({from:'2026-10-07',target:GSHEET_API_URL});",h.ctx);
const preflightPendingPosts=[];
h.ctx.requestGsheetFormJson=async action=>{preflightPendingPosts.push(action);return {status:'ok',saveState:'success'};};
assert.equal(await h.ctx._retryPendingExplicitEmptyTradeSync({
  targetUrl:'https://script.google.com/macros/s/test/exec',allowDuringRestore:true,
  preferCurrentPortfolio:true,masterCodesOverride:[{code:'005930',name:'테스트',type:'주식'}]
}),false,'pending current recovery must block stale fundDirect');
assert.equal(preflightPendingPosts.length,0,'pending preflight blocks all writes');
assert.ok(h.ctx._getPendingExplicitEmptyTradeSync(),'pending source is retained on failure');



// P1 self-review: missing holding code must come from pinned server master,
// not a previous connection's EDITABLE_PRICES/STOCK_CODE before settings apply.
h=setup();
h.response.codes=[{name:'테스트',code:'005930',type:'ETF'}];
vm.runInContext("EDITABLE_PRICES.length=0; EDITABLE_PRICES.push({name:'테스트',code:'999999',assetType:'주식'}); _invalidateEPIndex(); STOCK_CODE['테스트']='999999'; rawHoldings.push({name:'테스트',code:'',qty:1,cost:100,acct:'일반'}); _markPortfolioRemoteDirty();",h.ctx);
let pinnedHoldingPayload=null;
h.ctx.requestGsheetFormJson=async (action,params)=>{
  if(action==='syncHoldings') pinnedHoldingPayload=JSON.parse(params.data);
  return {status:'ok',saveState:'success',synced:1};
};
assert.equal(await h.ctx.loadSettings(),true,'same-Bootstrap holding code must recover');
assert.equal(pinnedHoldingPayload?.[0]?.code,'005930','do not import prior-connection stock code');
assert.equal(pinnedHoldingPayload?.[0]?.assetType,'ETF','do not import prior-connection stock type');


// Codex P1: one valid code and an unrelated name MUST NOT authorize a trade.
// This was previously re-labeled by syncTradesToGsheet after preflight.
h=setup();
h.response.codes=[{name:'새 연결 종목',code:'005930',type:'주식'}];
vm.runInContext("rawTrades.push({date:'2026-10-07',tradeType:'buy',name:'이전 연결 종목',code:'005930',qty:1,price:100}); _markPortfolioRemoteDirty();",h.ctx);
const mismatchPosts=[];
h.ctx.requestGsheetFormJson=async action=>{mismatchPosts.push(action);return {status:'ok',saveState:'success'};};
assert.equal(await h.ctx.loadSettings(),false,'same code with a different stock name must fail');
assert.ok(!mismatchPosts.some(action=>['syncHoldings','syncTrades','saveSettings','syncCodes'].includes(action)),
  'mismatched code-name pair cannot trigger any remote write');
assert.ok(h.ctx._getPortfolioRemoteDirty(),'mismatched transaction retained');

// Codex P1: a code added through an authorized stock-edit session on the
// SAME target survives reload even if the original syncCodes POST failed.
h=setup();
h.response.codes=[{name:'기존 종목',code:'000660',type:'주식'}];
h.response.settings.EDITABLE_PRICES=[{name:'기존 종목',code:'000660',assetType:'주식'}];
assert.equal(await h.ctx.loadSettings(),true,'first Bootstrap establishes provenance');
vm.runInContext(`EDITABLE_PRICES.push({name:'신규 종목',code:'005930',assetType:'주식',sector:'반도체'});
  _invalidateEPIndex();
  rawTrades.push({date:'2026-10-07',tradeType:'buy',name:'신규 종목',code:'005930',qty:1,price:100,acct:'일반'});
  rawHoldings.push({name:'신규 종목',code:'005930',qty:1,cost:100,acct:'일반'});
  if (!_recordSameTargetLocalCodeAddition({name:'신규 종목',code:'005930',assetType:'주식',sector:'반도체'},captureStockMasterEditSession())) throw Error('record rejected');
  _markPortfolioRemoteDirty();`,h.ctx);
const addedActions=[];
h.ctx.requestGsheetActionJson=async action=>
  action==='getCodeList' ? {status:'ok',codes:h.response.codes} : h.response;
h.ctx.requestGsheetFormJson=async (action,params)=>{
  addedActions.push(action);
  if(action==='syncCodes') {
    const posted=JSON.parse(params.codes);
    assert.deepEqual(Object.keys(posted),['신규 종목'],'recovery uploads only proven missing code');
    assert.equal(posted['신규 종목'].code,'005930');
    h.response.codes.push({name:'신규 종목',code:'005930',type:'주식'});
  }
  return {status:'ok',saveState:'success',synced:1};
};
assert.equal(await h.ctx.loadSettings(null,{forcePortfolioRestore:true}),true,
  'proven same-target missing code must be read back before dirty write');
assert.equal(addedActions[0],'syncCodes','code master recovery must precede holdings/trades');
assert.ok(addedActions.includes('syncTrades'),'verified new trade must recover');
assert.equal(h.ctx._getPortfolioRemoteDirty(),null,'dirty source clears only on success');

// A code registered on sheet A must not authorize any mutation on sheet B.
h=setup();
assert.equal(await h.ctx.loadSettings(),true);
vm.runInContext(`_recordSameTargetLocalCodeAddition({name:'신규 종목',code:'005930',assetType:'주식'},captureStockMasterEditSession());
  saveGsheetUrl('https://script.google.com/macros/s/other/exec');
  rawTrades.push({date:'2026-10-07',tradeType:'buy',name:'신규 종목',code:'005930',qty:1,price:100});
  _markPortfolioRemoteDirty();`,h.ctx);
let crossWrites=0;
h.ctx.requestGsheetFormJson=async ()=>{crossWrites++;return {status:'ok',saveState:'success'};};
assert.equal(await h.ctx.loadSettings(),false,'sheet A journal cannot authorize sheet B');
assert.equal(crossWrites,0,'no cross-target code or ledger mutation');
assert.ok(h.ctx._getPortfolioRemoteDirty(),'cross-target dirty source preserved');

// A remote Settings master on the SAME target can also prove a code whose
// code-sheet update failed after the Settings update was acknowledged.
h=setup();
h.response.codes=[{name:'기존 종목',code:'000660',type:'주식'}];
h.response.settings.EDITABLE_PRICES=[{name:'기존 종목',code:'000660',assetType:'주식'},
  {name:'서버 설정 신규',code:'005930',assetType:'주식',sector:'반도체'}];
vm.runInContext("rawTrades.push({date:'2026-10-07',tradeType:'buy',name:'서버 설정 신규',code:'005930',qty:1,price:100}); _markPortfolioRemoteDirty();",h.ctx);
const sameTargetPosts=[];
h.ctx.requestGsheetActionJson=async action=>
  action==='getCodeList' ? {status:'ok',codes:h.response.codes} : h.response;
h.ctx.requestGsheetFormJson=async (action,params)=>{
  sameTargetPosts.push(action);
  if(action==='syncCodes')h.response.codes.push({name:'서버 설정 신규',code:'005930',type:'주식'});
  return {status:'ok',saveState:'success',synced:1};
};
assert.equal(await h.ctx.loadSettings(),true,'same-server Settings supports code repair');
assert.equal(sameTargetPosts[0],'syncCodes');
assert.ok(sameTargetPosts.includes('syncTrades'));

console.log('✅ 복원 전 서버 기초정보 매칭·불일치 전송 차단·dirty 재시도 계약 통과');
console.log('✅ Bootstrap 실패 단계 보존·재시도·강제 읽기 보호·세대 경합·인증 요청 회귀 통과');
