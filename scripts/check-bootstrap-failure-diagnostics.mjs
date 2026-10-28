import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

const baseline=process.argv.includes('--baseline');
const read=file=>baseline && ['features/settings/settings.js','features/settings/settings_fetch.js','domain/portfolio/data.js','features/management/mgmt_editor.js'].includes(file)
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
    codes:[],trades:[],holdings:[],portfolioReadStatus:{tradesOk:true,holdingsOk:true},codeMasterSourceId:'TEST_SOURCE',gasVersion:'9.195'};
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
assert.equal(await h.ctx._diagnoseGsheetGetSettings(),'미동기화 거래·보유 확인 · TRADES_SAVE_FAILED · PORTFOLIO_SYNC_FAILED');
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
assert.equal(h.ctx.getGsheetSettingsLoadFailure(),'미동기화 거래·보유 확인 · MASTER_VALIDATION_FAILED · PORTFOLIO_SYNC_FAILED');
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

// A hard browser termination between code sheet A->B flush and failed
// Settings response leaves ONLY the local replacement journal, not a separate
// repair debt. Bootstrap must promote the confirmed pair before restoring A.
h=setup();
h.response.codes=[{name:'B',code:'222222',type:'주식',sector:'기타',currency:'KRW',market:'KR'}];
h.response.settings.EDITABLE_PRICES=[{name:'A',code:'111111',assetType:'주식',sector:'기타',targetWeight:37}];
vm.runInContext(`_pendingSameTargetCodeAdditions[GSHEET_API_URL]=[
  {sourceId:'TEST_SOURCE',name:'B',code:'222222',replaces:{name:'A',code:'111111'}}];
  lsSave(PORTFOLIO_PENDING_CODE_ADDITIONS_KEY,_pendingSameTargetCodeAdditions);`,h.ctx);
assert.equal(vm.runInContext("_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,'TEST_SOURCE').length",h.ctx),0,
  'journal-only crash scenario begins without explicit Settings debt');
const crashActions=[];
h.ctx.requestGsheetActionJson=async action=>
  action==='getCodeList' ? {status:'ok',codes:h.response.codes,codeMasterSourceId:'TEST_SOURCE'} : h.response;
h.ctx.requestGsheetFormJson=async (action,params)=>{
  crashActions.push(action);
  assert.equal(action,'syncCodes');
  assert.equal(params.forceSettingsRebase,'1');
  assert.equal(JSON.parse(params.settingsReplacements)[0].previousName,'A');
  h.response.settings.EDITABLE_PRICES=[{name:'B',code:'222222',assetType:'주식',
    sector:'기타',currency:'KRW',market:'KR',targetWeight:37}];
  return {status:'ok',updated:0};
};
assert.equal(await h.ctx.loadSettings(),true,'crash journal must repair Settings before stale Bootstrap');
assert.deepEqual(crashActions,['syncCodes'],'no append or normal mutation after journal promotion');
assert.equal(vm.runInContext("EDITABLE_PRICES.some(ep=>ep.name==='B'&&ep.targetWeight===37)",h.ctx),true);
assert.equal(vm.runInContext("EDITABLE_PRICES.some(ep=>ep.name==='A')",h.ctx),false);
assert.equal(vm.runInContext("_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,'TEST_SOURCE').length",h.ctx),0);
assert.equal(vm.runInContext("_getSameTargetLocalCodeAdditions(GSHEET_API_URL,'TEST_SOURCE').length",h.ctx),0);
h=setup();
h.response.codes=[{name:'B',code:'222222',type:'주식',sector:'기타',currency:'KRW',market:'KR'}];
h.response.settings.EDITABLE_PRICES=[{name:'A',code:'111111',assetType:'주식',targetWeight:37}];
vm.runInContext(`_pendingSameTargetCodeAdditions[GSHEET_API_URL]=[
  {sourceId:'TEST_SOURCE',name:'B',code:'222222',replaces:{name:'A',code:'111111'}}];`,h.ctx);
h.ctx.requestGsheetActionJson=async action=>
  action==='getCodeList' ? {status:'ok',codes:h.response.codes,codeMasterSourceId:'TEST_SOURCE'} : h.response;
h.ctx.requestGsheetFormJson=async()=>({status:'error',errorCode:'CODE_SYNC_SETTINGS_FAILED'});
assert.equal(await h.ctx.loadSettings(),false,'failed repair must block stale Settings bootstrap');
assert.equal(vm.runInContext("_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,'TEST_SOURCE').length",h.ctx),1,
  'newly promoted proof survives failed repair');
assert.equal(vm.runInContext("_getSameTargetLocalCodeAdditions(GSHEET_API_URL,'TEST_SOURCE').length",h.ctx),1,
  'original journal survives until verified Settings readback');
console.log('✅ 브라우저 강제 종료 후 교체 journal 단독 보유 시 Settings 선복구·실패 보존 VM 통과');

// Legacy metadataOnly debt from an earlier browser used arbitrary first A.
// B's metadata was committed, Settings write failed, then a different tab
// deleted unrelated A from Codes AND Settings. Bootstrap must use the CURRENT full master B under CAS
// and may not insist that A is still present.
h=setup();
h.response.codes=[{name:'B',code:'222222',type:'주식',sector:'헬스케어',currency:'KRW',market:'KR'}];
h.response.settings.EDITABLE_PRICES=[
  {name:'B',code:'222222',assetType:'주식',sector:'기타',targetWeight:37}
];
vm.runInContext(`_rememberSameTargetCodeSettingsRepairs(GSHEET_API_URL,'TEST_SOURCE',[
  {previousName:'A',previousCode:'111111',name:'A',code:'111111',metadataOnly:true}])`,h.ctx);
const metadataPosts=[];
h.ctx.requestGsheetActionJson=async action=>
  action==='getCodeList' ? {status:'ok',codes:h.response.codes,codeMasterSourceId:'TEST_SOURCE'} : h.response;
h.ctx.requestGsheetFormJson=async (action,params)=>{
  metadataPosts.push(action);
  assert.equal(action,'syncCodes');
  assert.equal(params.forceSettingsRebase,'1');
  assert.equal(JSON.parse(params.settingsReplacements).length,1,
    'stale unrelated A metadata marker is forwarded with its own identity');
  assert.equal(JSON.parse(params.settingsReplacements)[0].metadataOnly,true);
  assert.deepEqual(Object.keys(JSON.parse(params.codes)),['B'],
    'canonical CAS excludes deleted A');
  h.response.settings.EDITABLE_PRICES=[
    {name:'B',code:'222222',assetType:'주식',sector:'헬스케어',
      currency:'KRW',market:'KR',targetWeight:37}
  ];
  return {status:'ok',updated:0};
};
assert.equal(await h.ctx.loadSettings(),true,
  'Bootstrap recovers previous metadataOnly debt despite unrelated A deletion');
assert.deepEqual(metadataPosts,['syncCodes']);
assert.equal(vm.runInContext("EDITABLE_PRICES.some(ep=>ep.name==='B'&&ep.sector==='헬스케어'&&ep.targetWeight===37)",h.ctx),true);
assert.equal(vm.runInContext("EDITABLE_PRICES.some(ep=>ep.name==='A'&&ep.code==='111111')",h.ctx),false);
assert.equal(vm.runInContext("_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,'TEST_SOURCE').length",h.ctx),0);
console.log('✅ 오래된 무관 첫 행 metadataOnly 복구 부채가 삭제된 후에도 Bootstrap 수리 정상 통과');

// Codex P2: A->B was committed, but another tab legitimately deleted B
// before Settings migrated A. The pinned full master now has neither pair.
// Recover using current authoritative master (no phantom B replacement),
// prune stale A while retaining unrelated funds and LOAN, and clear debt.
h=setup();
h.response.codes=[{name:'C',code:'333333',type:'주식',sector:'기타',currency:'KRW',market:'KR'}];
h.response.settings.EDITABLE_PRICES=[
  {name:'A',code:'111111',assetType:'주식',sector:'기타',targetWeight:37},
  {name:'C',code:'333333',assetType:'주식',sector:'기타',targetWeight:20},
  {name:'펀드 미코드',code:'',assetType:'펀드',targetWeight:43}
];
h.response.settings.LOAN={balance:357000000};
vm.runInContext(`_rememberSameTargetCodeSettingsRepairs(GSHEET_API_URL,'TEST_SOURCE',[
  {previousName:'A',previousCode:'111111',name:'B',code:'222222'}])`,h.ctx);
const deletedTargetPosts=[];
h.ctx.requestGsheetActionJson=async action=>
  action==='getCodeList' ? {status:'ok',codes:h.response.codes,codeMasterSourceId:'TEST_SOURCE'} : h.response;
h.ctx.requestGsheetFormJson=async (action,params)=>{
  deletedTargetPosts.push(action);
  assert.equal(action,'syncCodes');
  assert.equal(params.forceSettingsRebase,'1');
  assert.deepEqual(Object.keys(JSON.parse(params.codes)),['C'],
    'authoritative current master cannot resurrect deleted B');
  assert.equal(JSON.parse(params.settingsReplacements).length,1);
  assert.equal(JSON.parse(params.settingsReplacements)[0].retired,true,
    'A->B target deletion must carry explicit tombstone, not blank provenance');
  h.response.settings.EDITABLE_PRICES=[
    {name:'C',code:'333333',assetType:'주식',sector:'기타',targetWeight:20},
    {name:'펀드 미코드',code:'',assetType:'펀드',targetWeight:43}
  ];
  return {status:'ok',updated:0};
};
assert.equal(await h.ctx.loadSettings(),true,
  'legitimate later deletion of B must not deadlock bootstrap forever');
assert.deepEqual(deletedTargetPosts,['syncCodes']);
assert.equal(vm.runInContext("EDITABLE_PRICES.some(ep=>ep.name==='A'||ep.name==='B')",h.ctx),false);
assert.equal(vm.runInContext("EDITABLE_PRICES.some(ep=>ep.name==='C'&&ep.targetWeight===20)",h.ctx),true);
assert.equal(h.response.settings.LOAN.balance,357000000);
assert.equal(vm.runInContext("_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,'TEST_SOURCE').length",h.ctx),0);
console.log('✅ 교체 대상 B 후속 삭제 시 stale A 제거·현재 C/대출/펀드 보호 및 Bootstrap 부채 해제');

// The same absence must NEVER license an arbitrary colliding successor:
// if any old/new name or code survives with a DIFFERENT pair, refuse.
h=setup();
h.response.codes=[{name:'B',code:'999999',type:'주식',sector:'기타',currency:'KRW',market:'KR'}];
h.response.settings.EDITABLE_PRICES=[{name:'A',code:'111111',targetWeight:37}];
vm.runInContext(`_rememberSameTargetCodeSettingsRepairs(GSHEET_API_URL,'TEST_SOURCE',[
  {previousName:'A',previousCode:'111111',name:'B',code:'222222'}])`,h.ctx);
let aliasWrites=0;
h.ctx.requestGsheetActionJson=async action=>
  action==='getCodeList' ? {status:'ok',codes:h.response.codes,codeMasterSourceId:'TEST_SOURCE'} : h.response;
h.ctx.requestGsheetFormJson=async()=>{aliasWrites++;return {status:'ok'}};
assert.equal(await h.ctx.loadSettings(),false,'ambiguous reused target alias must fail closed');
assert.equal(aliasWrites,0,'do not overwrite Settings with ambiguous collision');
assert.equal(vm.runInContext("_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,'TEST_SOURCE').length",h.ctx),1);

// Name-only and code-only successful replacement must remain recoverable.
h=setup();
const classify=(debts,codes)=>vm.runInContext(
  '_classifyPinnedCodeSettingsRepairDebt('+JSON.stringify(debts)+','+JSON.stringify(codes)+')',h.ctx);
const nameOnly={previousName:'A',previousCode:'111111',name:'B',code:'111111'};
const codeOnly={previousName:'A',previousCode:'111111',name:'A',code:'222222'};
assert.equal(classify([nameOnly],[{name:'B',code:'111111'}]).length,1);
assert.equal(classify([codeOnly],[{name:'A',code:'222222'}]).length,1);
assert.equal(classify([codeOnly],[{name:'X',code:'111111'}]),null);
assert.equal(classify([nameOnly],[{name:'A',code:'111111'}]),null);
console.log('✅ 이름만·코드만 변경/별칭 충돌 원본 CAS 분류 회귀 통과');

// Settings-only repair debt must run on a clean Bootstrap with NO trades,
// holdings or pending code additions, before stale Settings can restore A.
h=setup();
h.response.codes=[{name:'B',code:'222222',type:'주식',sector:'기타',currency:'KRW',market:'KR'}];
h.response.settings.EDITABLE_PRICES=[{name:'A',code:'111111',assetType:'주식',sector:'기타',targetWeight:37}];
vm.runInContext(`_rememberSameTargetCodeSettingsRepairs(GSHEET_API_URL,'TEST_SOURCE',[
  {previousName:'A',previousCode:'111111',name:'B',code:'222222'}])`,h.ctx);
const settingsRepairActions=[];
h.ctx.requestGsheetActionJson=async action=>
  action==='getCodeList' ? {status:'ok',codes:h.response.codes,codeMasterSourceId:'TEST_SOURCE'} : h.response;
h.ctx.requestGsheetFormJson=async (action,params)=>{
  settingsRepairActions.push(action);
  assert.equal(action,'syncCodes','clean Bootstrap must perform Settings-only repair');
  assert.equal(params.forceSettingsRebase,'1');
  assert.equal(JSON.parse(params.replacements).length,0);
  assert.equal(JSON.parse(params.settingsReplacements)[0].previousName,'A');
  h.response.settings.EDITABLE_PRICES=[{name:'B',code:'222222',assetType:'주식',
    sector:'기타',currency:'KRW',market:'KR',targetWeight:37}];
  return {status:'ok',updated:0};
};
assert.equal(await h.ctx.loadSettings(),true,'clean Bootstrap retries saved Settings debt');
assert.deepEqual(settingsRepairActions,['syncCodes']);
assert.equal(vm.runInContext("EDITABLE_PRICES.some(ep=>ep.name==='B'&&ep.code==='222222'&&ep.targetWeight===37)",h.ctx),true,
  'Bootstrap must apply re-fetched Settings B, not the stale A payload');
assert.equal(vm.runInContext("EDITABLE_PRICES.some(ep=>ep.name==='A')",h.ctx),false);
assert.equal(vm.runInContext("_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,'TEST_SOURCE').length",h.ctx),0);

h=setup();
h.response.codes=[{name:'B',code:'222222',type:'주식',sector:'기타',currency:'KRW',market:'KR'}];
h.response.settings.EDITABLE_PRICES=[{name:'A',code:'111111',assetType:'주식',sector:'기타',targetWeight:37}];
vm.runInContext(`_rememberSameTargetCodeSettingsRepairs(GSHEET_API_URL,'TEST_SOURCE',[
  {previousName:'A',previousCode:'111111',name:'B',code:'222222'}])`,h.ctx);
h.ctx.requestGsheetActionJson=async action=>
  action==='getCodeList' ? {status:'ok',codes:h.response.codes,codeMasterSourceId:'TEST_SOURCE'} : h.response;
h.ctx.requestGsheetFormJson=async()=>({status:'error',errorCode:'CODE_SYNC_SETTINGS_FAILED'});
assert.equal(await h.ctx.loadSettings(),false,
  'failed debt repair must block applying stale A / claiming Bootstrap success');
assert.equal(vm.runInContext("_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,'TEST_SOURCE').length",h.ctx),1,
  'failed repair evidence survives reloading');
console.log('✅ 일반 Bootstrap의 Settings 복구 선처리·최신 설정 재조회·실패 차단 VM 통과');

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
  action==='getCodeList' ? {status:'ok',codes:h.response.codes,codeMasterSourceId:'TEST_SOURCE'} : h.response;
h.ctx.requestGsheetFormJson=async (action,params)=>{
  addedActions.push(action);
  if(action==='syncCodesAppendOnly') {
    const posted=JSON.parse(params.codes);
    assert.deepEqual(Object.keys(posted),['신규 종목'],'recovery uploads only proven missing code');
    assert.equal(posted['신규 종목'].code,'005930');
    h.response.codes.push({name:'신규 종목',code:'005930',type:'주식'});
  }
  return {status:'ok',saveState:'success',synced:1};
};
assert.equal(await h.ctx.loadSettings(null,{forcePortfolioRestore:true}),true,
  'proven same-target missing code must be read back before dirty write');
assert.equal(addedActions[0],'syncCodesAppendOnly','code master recovery must precede holdings/trades');
assert.ok(addedActions.includes('syncTrades'),'verified new trade must recover');
assert.equal(h.ctx._getPortfolioRemoteDirty(),null,'dirty source clears only on success');


// Codex P2: Code-only append does not persist Settings. A committed C row
// with failed HTTP acknowledgment must retain durable journal until CAS.
for (const fault of ['none','lost-ack','failed-settings']) {
  h=setup();
  h.response.codes=[{name:'A',code:'000660',type:'주식',sector:'기타',currency:'KRW',market:''}];
  h.response.settings.EDITABLE_PRICES=[{name:'A',code:'000660',assetType:'주식',sector:'기타',targetWeight:37,notes:'A memo'}];
  assert.equal(await h.ctx.loadSettings(),true);
  vm.runInContext(`const newC={name:'C',code:'005930',assetType:'주식',
    sector:'반도체',targetWeight:25,notes:'C memo'};
    EDITABLE_PRICES.push(newC);_invalidateEPIndex();
    if(!_recordSameTargetLocalCodeAddition(newC,captureStockMasterEditSession())) throw Error('journal failed');`,h.ctx);
  const actions=[];
  let failCAS=fault==='failed-settings';
  h.ctx.requestGsheetActionJson=async action=>action==='getCodeList'
    ? {status:'ok',codes:h.response.codes.map(x=>({...x})),codeMasterSourceId:'TEST_SOURCE'}
    : h.response;
  h.ctx.requestGsheetFormJson=async(action,p)=>{
    actions.push(action);
    if(action==='syncCodesAppendOnly'){
      assert.equal(JSON.parse(p.codes).C.code,'005930');
      h.response.codes.push({name:'C',code:'005930',type:'주식',sector:'반도체',currency:'KRW',market:''});
      return fault==='lost-ack'?null:{status:'ok',appended:true};
    }
    if(action==='syncCodes'){
      assert.equal(p.forceSettingsRebase,'1','must use Settings-only CAS');
      const proof=JSON.parse(p.settingsReplacements);
      assert.equal(proof.length,1);
      assert.equal(proof[0].metadataOnly,true);
      assert.equal(proof[0].name,'C');
      assert.equal(proof[0].userFields.targetWeight,25);
      assert.equal(proof[0].userFields.notes,'C memo');
      if(failCAS)return {status:'error',errorCode:'CODE_SYNC_SETTINGS_FAILED'};
      h.response.settings.EDITABLE_PRICES.push({name:'C',code:'005930',assetType:'주식',
        sector:'반도체',targetWeight:25,notes:'C memo'});
      return {status:'ok',updated:0};
    }
    throw Error('unexpected Bootstrap mutation '+action);
  };
  const first=await h.ctx.loadSettings();
  if(fault==='none')assert.equal(first,true,'first Bootstrap must settle Settings after append');
  else {
    assert.equal(first,false,'partial Codes/Settings write cannot finish Bootstrap');
    assert.equal(vm.runInContext("_getSameTargetLocalCodeAdditions(GSHEET_API_URL,'TEST_SOURCE').length",h.ctx),1,
      'journal retained on failed or interrupted append');
    failCAS=false;
    assert.equal(await h.ctx.loadSettings(),true,'subsequent Bootstrap recovers exact committed C');
  }
  assert.equal(actions.filter(x=>x==='syncCodesAppendOnly').length,1,'never append C twice');
  assert.equal(h.response.codes.filter(x=>x.name==='C').length,1);
  assert.equal(h.response.settings.EDITABLE_PRICES.find(x=>x.name==='A').targetWeight,37);
  assert.equal(h.response.settings.EDITABLE_PRICES.find(x=>x.name==='C')?.targetWeight,25);
  assert.equal(vm.runInContext("EDITABLE_PRICES.some(x=>x.name==='C'&&x.targetWeight===25&&x.notes==='C memo')",h.ctx),true);
  assert.equal(vm.runInContext("_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,'TEST_SOURCE').length",h.ctx),0);
  assert.equal(vm.runInContext("_getSameTargetLocalCodeAdditions(GSHEET_API_URL,'TEST_SOURCE').length",h.ctx),0);
}
console.log('✅ 신규 append-only Codes 성공 후 Settings CAS와 readback, ACK 유실 및 장애 재시도');

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
  action==='getCodeList' ? {status:'ok',codes:h.response.codes,codeMasterSourceId:'TEST_SOURCE'} : h.response;
h.ctx.requestGsheetFormJson=async (action,params)=>{
  sameTargetPosts.push(action);
  if(action==='syncCodesAppendOnly')h.response.codes.push({name:'서버 설정 신규',code:'005930',type:'주식'});
  return {status:'ok',saveState:'success',synced:1};
};
assert.equal(await h.ctx.loadSettings(),true,'same-server Settings supports code repair');
assert.equal(sameTargetPosts[0],'syncCodesAppendOnly');
assert.ok(sameTargetPosts.includes('syncTrades'));


// Self-review: a newly registered, as-yet untraded code must be durable.
h=setup();
h.response.codes=[{name:'기존 종목',code:'000660',type:'주식'}];
h.response.settings.EDITABLE_PRICES=[{name:'기존 종목',code:'000660',assetType:'주식'}];
assert.equal(await h.ctx.loadSettings(),true);
vm.runInContext("EDITABLE_PRICES.push({name:'미거래 신규',code:'005930',assetType:'주식',targetWeight:26,notes:'미거래 보존'}); _recordSameTargetLocalCodeAddition(EDITABLE_PRICES[EDITABLE_PRICES.length-1],captureStockMasterEditSession()); _markPortfolioRemoteDirty();",h.ctx);
const noTradeWrites=[];
h.ctx.requestGsheetActionJson=async action =>
  action==='getCodeList' ? {status:'ok',codes:h.response.codes,codeMasterSourceId:'TEST_SOURCE'} : h.response;
h.ctx.requestGsheetFormJson=async (action,params)=>{
  noTradeWrites.push(action);
  if (action==='syncCodesAppendOnly') {
    assert.deepEqual(Object.keys(JSON.parse(params.codes)),['미거래 신규']);
    h.response.codes.push({name:'미거래 신규',code:'005930',type:'주식'});
  } else if (action==='syncCodes') {
    const proof=JSON.parse(params.settingsReplacements);
    assert.equal(params.forceSettingsRebase,'1');
    assert.equal(proof[0].name,'미거래 신규');
    assert.equal(proof[0].userFields.targetWeight,26);
    h.response.settings.EDITABLE_PRICES.push({name:'미거래 신규',code:'005930',
      assetType:'주식',targetWeight:26,notes:'미거래 보존'});
  }
  return {status:'ok',saveState:'success',synced:1};
};
assert.equal(await h.ctx.loadSettings(null,{forcePortfolioRestore:true}),true);
assert.equal(noTradeWrites[0],'syncCodesAppendOnly','code-only journal must repair before other writes');
assert.equal(vm.runInContext("EDITABLE_PRICES.some(x=>x.name==='미거래 신규'&&x.code==='005930'&&x.targetWeight===26&&x.notes==='미거래 보존')",h.ctx),true,
  'untraded stock and user fields must remain in UI master');
assert.deepEqual(noTradeWrites.slice(0,2),['syncCodesAppendOnly','syncCodes'],
  'append-only Codes requires separate Settings CAS');
assert.equal(h.ctx._getPortfolioRemoteDirty(),null);
assert.equal(vm.runInContext("_getSameTargetLocalCodeAdditions(GSHEET_API_URL, _gsCodeMasterSourceIdentity).length",h.ctx),0,'verified journal cleared');

// Registration without a dirty ledger still needs replay.
h=setup();
h.response.codes=[{name:'기존 종목',code:'000660',type:'주식'}];
h.response.settings.EDITABLE_PRICES=[{name:'기존 종목',code:'000660',assetType:'주식'}];
assert.equal(await h.ctx.loadSettings(),true);
vm.runInContext("_recordSameTargetLocalCodeAddition({name:'독립 신규',code:'005930',assetType:'ETF'},captureStockMasterEditSession())",h.ctx);
const codeOnlyWrites=[];
h.ctx.requestGsheetActionJson=async action =>
  action==='getCodeList' ? {status:'ok',codes:h.response.codes,codeMasterSourceId:'TEST_SOURCE'} : h.response;
h.ctx.requestGsheetFormJson=async(action,params)=>{
  codeOnlyWrites.push(action);
  if(action==='syncCodesAppendOnly')h.response.codes.push({name:'독립 신규',code:'005930',type:'ETF'});
  if(action==='syncCodes') {
    assert.equal(params.forceSettingsRebase,'1');
    assert.equal(JSON.parse(params.settingsReplacements)[0].name,'독립 신규');
    h.response.settings.EDITABLE_PRICES.push({name:'독립 신규',code:'005930',assetType:'ETF'});
  }
  return {status:'ok',saveState:'success',synced:1};
};
assert.equal(await h.ctx.loadSettings(),true);
assert.deepEqual(codeOnlyWrites,['syncCodesAppendOnly','syncCodes'],
  'journal-only recovery must write Settings but not unrelated ledger');
assert.equal(vm.runInContext("EDITABLE_PRICES.some(x=>x.name==='독립 신규'&&x.code==='005930')",h.ctx),true);

// Explicit deletion never re-adds the removed stock.
h=setup();
assert.equal(await h.ctx.loadSettings(),true);
vm.runInContext("_recordSameTargetLocalCodeAddition({name:'삭제 종목',code:'005930',assetType:'주식'},captureStockMasterEditSession()); _forgetSameTargetLocalCodeAddition('삭제 종목','005930');",h.ctx);
assert.equal(vm.runInContext("_getSameTargetLocalCodeAdditions(GSHEET_API_URL, _gsCodeMasterSourceIdentity).length",h.ctx),0);
assert.match(fs.readFileSync('src/web/features/master/stock/mgmt_stock.js','utf8'),
  /_forgetSameTargetLocalCodeAddition\(\s*snapItem\.name\s*,\s*snapItem\.code\s*,\s*undefined\s*,\s*editSession\?\.sourceId\s*\)/,
  'real stock delete handler must clear ONLY the originating workbook journal');

// Confirmation is mandatory: syncCodes success followed by read error must
// retain the registration journal and prevent any portfolio write.
h=setup();
assert.equal(await h.ctx.loadSettings(),true);
vm.runInContext("_recordSameTargetLocalCodeAddition({name:'미확인 신규',code:'005930',assetType:'주식'},captureStockMasterEditSession()); _markPortfolioRemoteDirty();",h.ctx);
const unverifiedWrites=[];
h.ctx.requestGsheetActionJson=async action=>action==='getCodeList'
  ? {status:'error',error:'read failed'} : h.response;
h.ctx.requestGsheetFormJson=async action=>{
  unverifiedWrites.push(action);
  return {status:'ok',saveState:'success',synced:1};
};
assert.equal(await h.ctx.loadSettings(),false);
assert.deepEqual(unverifiedWrites,['syncCodesAppendOnly'],'failed readback must stop ledger mutations');
assert.equal(vm.runInContext("_getSameTargetLocalCodeAdditions(GSHEET_API_URL, _gsCodeMasterSourceIdentity).length",h.ctx),1);
assert.ok(h.ctx._getPortfolioRemoteDirty());



// A GAS URL can be rebound to another spreadsheet without changing its /exec
// URL. Old local stock registration MUST NOT authorize a write to the new SS_ID.
h=setup();
assert.equal(await h.ctx.loadSettings(),true);
vm.runInContext("EDITABLE_PRICES.push({name:'이전 워크북 신규',code:'000660',assetType:'주식'}); _recordSameTargetLocalCodeAddition({name:'이전 워크북 신규',code:'000660',assetType:'주식'},captureStockMasterEditSession()); rawTrades.push({date:'2026-10-07',tradeType:'buy',name:'이전 워크북 신규',code:'000660',qty:1,price:100}); _markPortfolioRemoteDirty();",h.ctx);
h.response.codeMasterSourceId='OTHER_WORKBOOK';
let changedWorkbookWrites=0;
h.ctx.requestGsheetFormJson=async ()=>{changedWorkbookWrites++;return {status:'ok'};};
assert.equal(await h.ctx.loadSettings(null,{forcePortfolioRestore:true}),false,
  'SS_ID change on the same GAS URL must refuse stale journal');
assert.equal(changedWorkbookWrites,0);
assert.equal(vm.runInContext("_getSameTargetLocalCodeAdditions(GSHEET_API_URL, 'TEST_SOURCE').length",h.ctx),1,'old source record stays isolated');

// Once normal syncCodes is ACKed and read back from the SAME source, retire
// only the exact confirmed same-workbook local registration.
h=setup();
h.response.codes=[{name:'테스트',code:'005930',type:'주식',sector:'기타'}];
assert.equal(await h.ctx.loadSettings(),true);
vm.runInContext("EDITABLE_PRICES.push({name:'정상 동기화',code:'000660',assetType:'주식'}); _recordSameTargetLocalCodeAddition({name:'정상 동기화',code:'000660',assetType:'주식'},captureStockMasterEditSession())",h.ctx);
h.ctx.requestGsheetFormJson=async (action,params)=>{
  if(action==='syncCodes'){
    const req=JSON.parse(params.codes);
    assert.equal(params.expectedSourceId,'TEST_SOURCE');
    assert.deepEqual(JSON.parse(params.expectedCodes).map(x=>x.name),['테스트']);
    h.response.codes.push({name:'정상 동기화',code:req['정상 동기화'].code,type:'주식'});
  }
  return {status:'ok',synced:1};
};
assert.equal((await h.ctx.syncCodesToGsheet())?.status,'ok');
assert.equal(vm.runInContext("_getSameTargetLocalCodeAdditions(GSHEET_API_URL, _gsCodeMasterSourceIdentity).length",h.ctx),0,'ordinary sync ACK should clear same-target journal');

// Codex P2: two edits within the 1200 ms debounce must compose all the way
// to the authoritative original A/1, never append C/3 beside old A/1.
h=setup();
h.response.codes=[{name:'원본A',code:'111111',type:'주식',sector:'기타'}];
h.response.settings.EDITABLE_PRICES=[{name:'원본A',code:'111111',assetType:'주식',sector:'기타'}];
assert.equal(await h.ctx.loadSettings(),true);
assert.equal(vm.runInContext(`
  EDITABLE_PRICES[0].name='중간B';EDITABLE_PRICES[0].code='222222';
  _recordSameTargetLocalCodeAddition({name:'중간B',code:'222222',
    assetType:'주식',replaces:{name:'원본A',code:'111111'}},captureStockMasterEditSession())
`,h.ctx),true);
assert.equal(vm.runInContext(`
  EDITABLE_PRICES[0].name='최종C';EDITABLE_PRICES[0].code='333333';
  _recordSameTargetLocalCodeAddition({name:'최종C',code:'333333',
    assetType:'주식',replaces:{name:'중간B',code:'222222'}},captureStockMasterEditSession())
`,h.ctx),true);
assert.equal(vm.runInContext("_getSameTargetLocalCodeAdditions(GSHEET_API_URL, _gsCodeMasterSourceIdentity).length",h.ctx),1);
assert.equal(vm.runInContext("_getSameTargetLocalCodeAdditions(GSHEET_API_URL, _gsCodeMasterSourceIdentity)[0].replaces.name",h.ctx),'원본A');
let chainedPosts=0;
h.ctx.requestGsheetFormJson=async (action,params)=>{
  assert.equal(action,'syncCodes');
  chainedPosts++;
  const before=JSON.parse(params.expectedCodes);
  const repl=JSON.parse(params.replacements);
  assert.equal(before.length,1);
  assert.equal(before[0].name,'원본A');
  assert.deepEqual(repl,[{previousName:'원본A',previousCode:'111111',name:'최종C',code:'333333'}]);
  h.response.codes=[{name:'최종C',code:'333333',type:'주식',sector:'기타'}];
  return {status:'ok',updated:1};
};
assert.equal((await h.ctx.syncCodesToGsheet())?.status,'ok');
assert.equal(chainedPosts,1);
assert.equal(vm.runInContext("_getSameTargetLocalCodeAdditions(GSHEET_API_URL, _gsCodeMasterSourceIdentity).length",h.ctx),0,
  'composed replacement cleared only after verified code master readback');

// A tampered or stranded replacement cannot be reclassified as a new asset.
h=setup();
h.response.codes=[{name:'원본A',code:'111111',type:'주식',sector:'기타'}];
h.response.settings.EDITABLE_PRICES=[{name:'원본A',code:'111111',assetType:'주식',sector:'기타'}];
assert.equal(await h.ctx.loadSettings(),true);
vm.runInContext(`
  EDITABLE_PRICES[0].name='유령C';EDITABLE_PRICES[0].code='333333';
  _recordSameTargetLocalCodeAddition({name:'유령C',code:'333333',
    assetType:'주식',replaces:{name:'없는B',code:'222222'}},captureStockMasterEditSession())
`,h.ctx);
let invalidReplacementPosts=0;
h.ctx.requestGsheetFormJson=async ()=>{invalidReplacementPosts++;return {status:'ok'};};
assert.equal(await h.ctx.syncCodesToGsheet(),null,
  'missing original source row is fail-closed and cannot append as a new asset');
assert.equal(invalidReplacementPosts,0);

// Reversing an uncommitted rename back to the authoritative original clears
// its provenance journal; no obsolete intermediate pair is left authorized.
h=setup();
h.response.codes=[{name:'원본A',code:'111111',type:'주식',sector:'기타'}];
h.response.settings.EDITABLE_PRICES=[{name:'원본A',code:'111111',assetType:'주식'}];
assert.equal(await h.ctx.loadSettings(),true);
assert.equal(vm.runInContext(`
  _recordSameTargetLocalCodeAddition({name:'중간B',code:'222222',
    replaces:{name:'원본A',code:'111111'}},captureStockMasterEditSession());
  _recordSameTargetLocalCodeAddition({name:'원본A',code:'111111',
    replaces:{name:'중간B',code:'222222'}},captureStockMasterEditSession())
`,h.ctx),true);
assert.equal(vm.runInContext("_getSameTargetLocalCodeAdditions(GSHEET_API_URL, _gsCodeMasterSourceIdentity).length",h.ctx),0);

// Codex P1: duplicate names/codes in one server master cannot be validated,
// even if the transaction itself refers to one of the duplicate entries.
h=setup();
const sampleTrade={date:'2026-10-07',tradeType:'buy',name:'A',code:'222222',qty:1,price:100};
assert.equal(h.ctx.isPinnedRestoreTradeMasterComplete([sampleTrade],[
  {name:'A',code:'111111'},{name:'A',code:'222222'}]),false,
  'same name with two server codes is ambiguous');
assert.equal(h.ctx.isPinnedRestoreTradeMasterComplete([sampleTrade],[
  {name:'A',code:'222222'},{name:'B',code:'222222'}]),false,
  'same code with two server names is ambiguous');

// Execute the ACTUAL GAS CAS handler under a mock script lock, not only a
// browser stub. Another browser's conflicting update must be detected before
// any append or existing-row mutation.
const gasSrc=fs.readFileSync('src/gas/apps_script.gs','utf8');
const normStart=gasSrc.indexOf('function _portfolioNormalizeCodeMasterSnapshot_(');
const appendStart=gasSrc.indexOf('function handleSyncCodesAppendOnly(');
const appendEnd=gasSrc.indexOf('function handleSyncCodes(',appendStart);
assert.ok(normStart>=0 && appendStart>normStart && appendEnd>appendStart);
let serverCodes=[{name:'A',code:'111111',type:'주식',sector:'',currency:'KRW',market:''}];
const gasWrites=[];
const mockSheet={
  getLastRow:()=>serverCodes.length+1,getLastColumn:()=>6,
  getRange:(r,c,n,m)=>({setValues:rows=>{
    assert.equal(c,1);assert.equal(m,6);
    assert.equal(r,serverCodes.length+2,'CAS must append rather than update existing');
    for(const v of rows){
      serverCodes.push({code:v[0],name:v[1],type:v[2],
        sector:v[3],currency:v[4]||'KRW',market:v[5]});
      gasWrites.push(v);
    }
  }})
};
let lockDepth=0;
const gasCtx=vm.createContext({
  JSON,Object,Array,String,LockService:{getScriptLock:()=>({
    waitLock:()=>{lockDepth++;},releaseLock:()=>{lockDepth--;}
  })},getss:()=>({getSheetByName:()=>mockSheet}),
  _portfolioCodeMasterSourceIdentity_:()=> 'TEST_SOURCE',
  // Narrow CAS-only VM has no pending delete; preserve that precondition.
  _settlePendingCodeDeleteLocked_:()=>({pending:false}),
  _cleanCode:code=>String(code||'').trim(),
  _parseJsonParam:value=>JSON.parse(value),
  _parseArrayParam:value=>{const v=JSON.parse(value);if(!Array.isArray(v))throw Error('array expected');return v;},
  getCodeItems:()=>serverCodes.map(x=>({...x})),
  CONFIG:{SHEET_CODES:'종목코드'},_setCodeColumnText:()=>{},
  _touchSnapshotIntegritySourceRevision:()=>{},
  SpreadsheetApp:{flush:()=>{}},
  jsonOk:payload=>({status:'ok',...payload}),
  jsonError:(message,payload)=>({status:'error',message,...payload})
});
vm.runInContext(
  gasSrc.slice(normStart,gasSrc.indexOf('/**',normStart))+
  '\n'+gasSrc.slice(appendStart,appendEnd),gasCtx);
const casRequest=JSON.stringify({'신규':{code:'005930',type:'주식'}});
const casExpected=encodeURIComponent(JSON.stringify(serverCodes));
let casResult=gasCtx.handleSyncCodesAppendOnly(casRequest,casExpected,'OTHER_WORKBOOK');
assert.equal(casResult.errorCode,'CODE_MASTER_SOURCE_CHANGED');
assert.equal(gasWrites.length,0);
serverCodes.push({name:'신규',code:'005930',type:'주식',sector:'',currency:'KRW',market:''});
casResult=gasCtx.handleSyncCodesAppendOnly(casRequest,casExpected,'TEST_SOURCE');
assert.equal(casResult.errorCode,'CODE_MASTER_CHANGED','concurrent insert must invalidate CAS');
assert.equal(gasWrites.length,0,'never rewrite another writer’s row');
serverCodes.pop();
casResult=gasCtx.handleSyncCodesAppendOnly(casRequest,casExpected,'TEST_SOURCE');
assert.equal(casResult.status,'ok','unchanged source and master permit append');
assert.equal(gasWrites.length,1);
assert.equal(serverCodes[0].name,'A','existing mapping unchanged');
assert.equal(serverCodes[1].name,'신규');
assert.equal(lockDepth,0,'script lock must be released on all paths');
const serializedCodeWriterStart=gasSrc.indexOf('function handleSyncCodes(codesParam, expectedSourceId, expectedCodesParam, replacementsParam, forceSettingsRebase, settingsReplacementsParam) {');
assert.ok(serializedCodeWriterStart>=0 && gasSrc.slice(serializedCodeWriterStart,serializedCodeWriterStart+1700)
  .includes('var lock = LockService.getScriptLock(), locked = false;'),
  'normal code edits must continue to serialize with append-only CAS even with scoped helper');



// Codex P1: A's delayed sync may not read B's master or POST to old target A.
h=setup();
h.response.codes=[{name:'A 종목',code:'000660',type:'주식'}];
h.response.settings.EDITABLE_PRICES=[{name:'A 종목',code:'000660',assetType:'주식'}];
assert.equal(await h.ctx.loadSettings(),true);
let releaseFirstSync;
const firstSyncPending=new Promise(resolve=>{releaseFirstSync=resolve;});
const generationPosts=[];
h.ctx.requestGsheetFormJson=async (action,params,opts)=>{
  if(action!=='syncCodes') throw Error('unexpected queued action: '+action);
  generationPosts.push({url:opts.targetUrl,codes:JSON.parse(params.codes)});
  if(generationPosts.length===1) await firstSyncPending;
  return {status:'ok',synced:1};
};
const firstCodeSync=h.ctx.syncCodesToGsheet();
for(let tick=0;tick<12&&!generationPosts.length;tick++) await Promise.resolve();
assert.equal(generationPosts.length,1,'first POST must have started on A');
const staleCodeSync=h.ctx.syncCodesToGsheet();
vm.runInContext("saveGsheetUrl('https://script.google.com/macros/s/another-sheet/exec')",h.ctx);
h.response.codes=[{name:'B 종목',code:'005930',type:'주식'}];
h.response.settings.EDITABLE_PRICES=[{name:'B 종목',code:'005930',assetType:'주식'}];
assert.equal(await h.ctx.loadSettings(null,{forcePortfolioRestore:true}),true,
  'B bootstrap must finish before queued A sync is released');
releaseFirstSync();
assert.equal(await firstCodeSync,null,'in-flight old A write cannot confirm B master readback');
assert.equal(await staleCodeSync,null,'queued operation from earlier generation canceled');
assert.equal(generationPosts.length,1,'no B master may be POSTed to old target A');
assert.deepEqual(Object.keys(generationPosts[0].codes),['A 종목'],
  'in-flight operation uses frozen A payload');


// Independent defense: even if a GAS URL is repointed to another spreadsheet
// without changing URL/generation, normal syncCodes must reject the workbook
// fingerprint before touching any cell.
const normalStart=gasSrc.indexOf('function handleSyncCodes(codesParam, expectedSourceId, expectedCodesParam, replacementsParam, forceSettingsRebase, settingsReplacementsParam)');
const normalEnd=gasSrc.indexOf('function _repairKnownCodeColumns(',normalStart);
assert.ok(normalStart>appendStart && normalEnd>normalStart);
vm.runInContext(gasSrc.slice(normalStart,normalEnd),gasCtx);
let unexpectedNormalCodeMutation=0;
const originalGetss=gasCtx.getss;
gasCtx.getss=()=>({getSheetByName:()=>{
  unexpectedNormalCodeMutation++;
  throw Error('no code sheet should be opened for mismatched workbook');
}});
const staleNormal=gasCtx.handleSyncCodes(JSON.stringify({
  '이전 종목':{code:'123456',type:'주식'}
}),'OTHER_WORKBOOK');
assert.equal(staleNormal.errorCode,'CODE_SYNC_SOURCE_CHANGED');
assert.equal(unexpectedNormalCodeMutation,0);
assert.equal(lockDepth,0,'normal sync lock released after source rejection');
gasCtx.getss=originalGetss;

// Revision proof must be supplied for EVERY normal sync, including legacy
// clients and same-workbook stale tabs. None may open/mutate the code sheet.
const legacyNormal=gasCtx.handleSyncCodes(JSON.stringify({'A':{code:'123456'}}),'TEST_SOURCE');
assert.equal(legacyNormal.errorCode,'CODE_SYNC_REVISION_REQUIRED');
const snapshotBeforeDelete=serverCodes.map(item=>({...item}));
serverCodes.pop(); // Another tab has deleted '신규' after the old tab captured it.
const staleRevisionNormal=gasCtx.handleSyncCodes(JSON.stringify({
  '신규':{code:'005930',type:'주식'}
}),'TEST_SOURCE',JSON.stringify(snapshotBeforeDelete));
assert.equal(staleRevisionNormal.errorCode,'CODE_SYNC_MASTER_CHANGED',
  'stale master cannot resurrect remotely deleted code');
assert.equal(serverCodes.length,1);
serverCodes.push(snapshotBeforeDelete[1]);
assert.equal(unexpectedNormalCodeMutation,0,'CAS-rejected normal sync cannot touch code sheet');

// Review P2: a normal syncCodes POST already in flight must settle BEFORE
// the explicit server-side removal, even if the user deletes the local master
// row while the first POST is still waiting for the network.
h=setup();
h.response.settings.EDITABLE_PRICES=[];
assert.equal(await h.ctx.loadSettings(),true);
vm.runInContext("EDITABLE_PRICES.push({name:'경합 신규',code:'000660',assetType:'주식'}); _recordSameTargetLocalCodeAddition({name:'경합 신규',code:'000660',assetType:'주식'},captureStockMasterEditSession())",h.ctx);
let completeFirstPost;
const slowFirstPost=new Promise(resolve=>{completeFirstPost=resolve;});
const deletionActions=[];
h.ctx.requestGsheetFormJson=async (action,params)=>{
  deletionActions.push(action);
  if (action==='syncCodes') {
    await slowFirstPost;
    h.response.codes.push({name:'경합 신규',code:'000660',type:'주식'});
    return {status:'ok',synced:1};
  }
  if (action==='deleteUnreferencedCode') {
    const deleteRequest=JSON.parse(params.data);
    assert.equal(deleteRequest.expectedSourceId,'TEST_SOURCE');
    assert.deepEqual(deleteRequest.expectedCodes.map(item=>item.name),['경합 신규']);
    h.response.codes=h.response.codes.filter(ep=>ep.name!=='경합 신규');
    return {status:'ok',deleted:1};
  }
  throw Error('unexpected action '+action);
};
h.ctx.requestGsheetActionJson=async action=>action==='getCodeList'
  ? {status:'ok',codes:h.response.codes,codeMasterSourceId:'TEST_SOURCE'} : h.response;
const normalInFlight=h.ctx.syncCodesToGsheet();
// Drain the two queue microtasks so the first fetch has ACTUALLY started;
// deleting before a queued task starts is a different (easier) scenario.
for (let step=0; step<12 && !deletionActions.length; step++) await Promise.resolve();
assert.equal(deletionActions[0],'syncCodes','the prior code POST must be in flight');
vm.runInContext("EDITABLE_PRICES.splice(EDITABLE_PRICES.findIndex(x=>x.name==='경합 신규'),1); _forgetSameTargetLocalCodeAddition('경합 신규','000660');",h.ctx);
const deleteAfterPost=h.ctx.deleteStockMasterCodeAfterPendingWrites(
  {name:'경합 신규',code:'000660'},h.ctx.captureStockMasterEditSession());
assert.deepEqual(deletionActions,['syncCodes'],'delete must not overtake in-flight code write');
completeFirstPost();
assert.equal((await normalInFlight)?.status,'ok');
assert.equal(await deleteAfterPost,true);
assert.deepEqual(deletionActions,['syncCodes','deleteUnreferencedCode']);
assert.equal(vm.runInContext("_gsheetCodeList.length",h.ctx),0,
  'verified server delete must rebase local code-master revision');
vm.runInContext("EDITABLE_PRICES.push({name:'경합 신규',code:'000660',assetType:'주식'})",h.ctx);
const staleResend=await h.ctx.syncCodesToGsheet();
assert.equal(staleResend,null,'deleted code cannot reappear without newly verified UI provenance');
assert.deepEqual(deletionActions,['syncCodes','deleteUnreferencedCode']);
vm.runInContext("EDITABLE_PRICES.splice(EDITABLE_PRICES.findIndex(x=>x.name==='경합 신규'),1); EDITABLE_PRICES.push({name:'후속 신규',code:'005930',assetType:'주식'}); _recordSameTargetLocalCodeAddition({name:'후속 신규',code:'005930',assetType:'주식'},captureStockMasterEditSession())",h.ctx);
h.ctx.requestGsheetFormJson=async (action,params)=>{
  assert.equal(action,'syncCodes');
  assert.deepEqual(JSON.parse(params.expectedCodes),[],
    'newly verified post-delete empty master is the next valid CAS base');
  const rows=JSON.parse(params.codes);
  h.response.codes.push({name:'후속 신규',code:rows['후속 신규'].code,type:'주식'});
  return {status:'ok',synced:1};
};
assert.equal((await h.ctx.syncCodesToGsheet())?.status,'ok',
  'intentional new code can sync against fresh post-delete revision');
assert.ok(fs.readFileSync('src/web/features/master/stock/mgmt_stock.js','utf8').includes(
  'deleteStockMasterCodeAfterPendingWrites(snapItem, editSession)'),
  'actual stock delete handler must queue remote deletion');

// Execute the real GAS deletion guard with and without a referenced ledger.
// This handler shares the exact lock with append-only and regular syncCodes.
const deleteStart=gasSrc.indexOf('function handleDeleteUnreferencedCode(');
assert.ok(deleteStart>appendStart && deleteStart<appendEnd);
let serverTradeRows=[];
let deletedServerSettings={EDITABLE_PRICES:[{name:'신규',code:'005930'}]};
gasCtx.handleGetTrades=()=>({getContent:()=>JSON.stringify({status:'ok',trades:serverTradeRows})});
gasCtx.handleGetHoldings=()=>({getContent:()=>JSON.stringify({status:'ok',holdings:[]})});
gasCtx._readSettingsMap=()=>deletedServerSettings;
// A stock deletion must touch only EDITABLE_PRICES' single value cell:
 // the all-key writer is forbidden here (LOAN/fund data may be enormous).
gasCtx._writeSettingsMap=()=>{throw Error('global Settings rewrite forbidden in deletion');};
const isolatedSettingsSheet={
  getLastRow:()=>2,
  getRange:(row,col,length,width)=>({
    getValues:()=>[['EDITABLE_PRICES']],
    getValue:()=>JSON.stringify(deletedServerSettings.EDITABLE_PRICES),
    setValue:value=>{deletedServerSettings.EDITABLE_PRICES=JSON.parse(value)},
    clearContent:()=>{throw Error('global clear forbidden');}
  })
};
gasCtx.CONFIG.SHEET_SETTINGS='settings';
gasCtx.getss=()=>({getSheetByName:name=>name==='settings'?isolatedSettingsSheet:mockSheet});
mockSheet.getRange=(row,col,length,width)=>({
  getValues:()=>width===2 && length===serverCodes.length
    ? serverCodes.map(x=>[x.code,x.name])
    : [serverCodes[row-2] ? [
        serverCodes[row-2].code,serverCodes[row-2].name,
        serverCodes[row-2].type,serverCodes[row-2].sector,
        serverCodes[row-2].currency,serverCodes[row-2].market
      ] : []],
  setValues:()=>{throw Error('delete must never re-upsert')}
});
const pendingDeleteProps={};
gasCtx.PropertiesService={getScriptProperties:()=>({
  getProperty:key=>pendingDeleteProps[key]||null,
  setProperty:(key,value)=>{pendingDeleteProps[key]=String(value)},
  deleteProperty:key=>{delete pendingDeleteProps[key]}
})};
const editOnlyHelperStart=gasSrc.indexOf('function _writeCodeDeleteEditablesOnly_(');
const editOnlyHelperEnd=gasSrc.indexOf('// Crash-safe transaction marker.',editOnlyHelperStart);
assert.ok(editOnlyHelperStart>0&&editOnlyHelperEnd>editOnlyHelperStart);
vm.runInContext(gasSrc.slice(editOnlyHelperStart,editOnlyHelperEnd),gasCtx);
const deletionHelperStart=gasSrc.indexOf('var CODE_DELETE_TXN_KEY_');
const deletionHelperEnd=gasSrc.indexOf('// 스프레드시트 소유자가',deletionHelperStart);
assert.ok(deletionHelperStart>0 && deletionHelperEnd>deletionHelperStart);
vm.runInContext(gasSrc.slice(deletionHelperStart,deletionHelperEnd),gasCtx);
mockSheet.deleteRow=row=>{assert.equal(row,3);serverCodes.splice(row-2,1);};
vm.runInContext(gasSrc.slice(deleteStart,gasSrc.indexOf('function handleSyncCodes(',deleteStart)),gasCtx);
let serverDelete=gasCtx.handleDeleteUnreferencedCode(JSON.stringify({
  name:'신규',code:'005930',expectedSourceId:'OTHER_WORKBOOK',expectedCodes:serverCodes}));
assert.equal(serverDelete.errorCode,'CODE_DELETE_SOURCE_CHANGED');
assert.equal(serverCodes.length,2);
serverTradeRows=[{name:'신규',code:'005930',date:'2026-10-07'}];
serverDelete=gasCtx.handleDeleteUnreferencedCode(JSON.stringify({
  name:'신규',code:'005930',expectedSourceId:'TEST_SOURCE',expectedCodes:serverCodes}));
assert.equal(serverDelete.errorCode,'CODE_DELETE_REFERENCED');
assert.equal(serverCodes.length,2);
serverTradeRows=[];

// Full-master deletion CAS rejects an edit of sector/currency with unchanged identity.
const originalServerCodes=serverCodes.map(x=>({...x}));
const staleExpected=serverCodes.map(x=>({...x}));
serverCodes[1].sector='신규 수정 섹터';
const beforeStaleDelete=serverCodes.length;
let staleDelete=gasCtx.handleDeleteUnreferencedCode(JSON.stringify({
  name:'신규',code:'005930',expectedSourceId:'TEST_SOURCE',expectedCodes:staleExpected
}));
assert.equal(staleDelete.errorCode,'CODE_DELETE_MASTER_CHANGED');
assert.equal(serverCodes.length,beforeStaleDelete,'metadata change must block stale deletion');
serverCodes[1].sector=originalServerCodes[1].sector;

serverDelete=gasCtx.handleDeleteUnreferencedCode(JSON.stringify({
  name:'신규',code:'005930',expectedSourceId:'TEST_SOURCE',expectedCodes:serverCodes}));
assert.equal(serverDelete.status,'ok');
assert.equal(serverCodes.length,1,'safe delete must remove only exact code row');
assert.equal(deletedServerSettings.EDITABLE_PRICES.length,0,'authoritative Settings also pruned');
assert.equal(lockDepth,0);


// Actual GAS holdings handler and deletion share ScriptLock. A stale other
// browser must not recreate a coded holding after code-master deletion.
const holdingsStart=gasSrc.indexOf('function handleSyncHoldings(');
const holdingsEnd=gasSrc.indexOf('function handleSyncTrades(',holdingsStart);
assert.ok(holdingsStart>0 && holdingsEnd>holdingsStart);
const ledgerGuardStart=gasSrc.indexOf('function _portfolioLedgerMasterConflict_(');
assert.ok(ledgerGuardStart>0 && ledgerGuardStart<holdingsStart);
vm.runInContext(gasSrc.slice(ledgerGuardStart,holdingsEnd),gasCtx);
let holdRowWrites=0;
const holdMock={
  clearContents:()=>{holdRowWrites++;},
  setColumnWidth:()=>{},
  getRange:()=>({setValues:()=>{holdRowWrites++;},
    setBackground:()=>({setFontColor:()=>({setFontWeight:()=>{}})})})
};
const restoreGetss=gasCtx.getss;
gasCtx.CONFIG.SHEET_HOLD='보유현황';
gasCtx.getss=()=>({getSheetByName:name=>name==='보유현황'?holdMock:mockSheet});
gasCtx._normalizeCodeRows=rows=>rows;
const orphanHolding=gasCtx.handleSyncHoldings(JSON.stringify([{
  name:'신규',code:'005930',qty:1,costAmt:100,assetType:'주식'
}]));
assert.equal(orphanHolding.errorCode,'HOLDINGS_CODE_MASTER_CONFLICT',
  'other browser cannot re-create holdings of removed code');
assert.equal(holdRowWrites,0,'orphan guard must precede all holdings writes');
const uncodedStock=gasCtx.handleSyncHoldings(JSON.stringify([{
  name:'A',code:'',qty:1,costAmt:100,assetType:'주식'
}]));
assert.equal(uncodedStock.errorCode,'HOLDINGS_CODE_MASTER_CONFLICT',
  'code-less stock may NEVER use the direct-fund exemption');
assert.equal(holdRowWrites,0,'uncoded stock must fail before clearing holdings');
assert.equal(gasCtx._portfolioLedgerMasterConflict_([
  {name:'신규',code:'005930',assetType:'주식'}
],serverCodes), 'CODE_MASTER_MISMATCH',
  'a stale trade inserted after deletion must not be persisted');
assert.equal(gasCtx._portfolioLedgerMasterConflict_([
  {name:'무코드',code:'',assetType:'주식'}
],serverCodes), 'UNCODED_NONFUND');
assert.equal(gasCtx._portfolioLedgerMasterConflict_([
  {name:'직접 펀드',code:'',assetType:'TDF'}
],serverCodes), '', 'code-less direct fund transactions remain permitted');
assert.ok(gasSrc.includes("var masterConflict = _portfolioLedgerMasterConflict_(trades, getCodeItems(ss, true));"),
  'real transaction handler must validate current master under the script lock');
const cleanHoldings=gasCtx.handleSyncHoldings(JSON.stringify([{
  name:'A',code:'111111',qty:2,costAmt:200,assetType:'주식'
}]));
assert.equal(cleanHoldings.status,'ok');
assert.ok(holdRowWrites>0,'valid holding still syncs');
assert.equal(lockDepth,0,'holdings lock released on both conflict/success');
gasCtx.getss=restoreGetss;
// The prior deletion completed: mock its confirmed surviving master A with
// an EXACT stored Settings A. The stale browser below still submits removed
// 신규/005930, which the save must drop without resurrecting it.
deletedServerSettings.EDITABLE_PRICES=[{name:'A',code:'111111',assetType:'주식',targetWeight:37}];
// The normal Settings API intentionally uses the generic writer. The
// destructive-writer guard belongs ONLY to the deletion transaction; restore
// the general API fixture after isolated delete safety checks.
gasCtx._writeSettingsMap=settings=>{deletedServerSettings=settings;return true;};


// Stale Settings may not reinsert a code removed by a different tab, even
// though both writers use the same lock: coded entries derive from the sheet.
const settingStart=gasSrc.indexOf('function handleSaveSettings(');
const settingEnd=gasSrc.indexOf('function handleGetSettings(',settingStart);
assert.ok(settingStart>0 && settingEnd>settingStart);
vm.runInContext(gasSrc.slice(settingStart,settingEnd),gasCtx);
const staleSettings=gasCtx.handleSaveSettings(JSON.stringify({
  EDITABLE_PRICES:[
    {name:'A',code:'111111',assetType:'주식'},
    {name:'신규',code:'005930',assetType:'주식'}
  ],
  APP_THEME:'dark'
}));
assert.equal(staleSettings.status,'ok');
assert.equal(deletedServerSettings.EDITABLE_PRICES.length,1,
  'stale Settings must not resurrect a deleted coded item');
assert.equal(deletedServerSettings.EDITABLE_PRICES[0].code,'111111');
assert.equal(deletedServerSettings.APP_THEME,'dark','unrelated settings still save');
assert.equal(lockDepth,0,'Settings code projection shares and releases master lock');

// Exercise a real atomic simultaneous name+code edit against a single mocked
// sheet. It must update the ORIGINAL row, not append another server identity,
// and mirror the new code/name into Settings for subsequent Bootstrap loads.
const renameRows=[['111111','옛이름','주식','기타','','']];
let renameAppends=0, renameSettings={
  EDITABLE_PRICES:[{name:'옛이름',code:'111111',assetType:'주식',sector:'기타'}]
};
const renameSheet={
  getLastRow:()=>renameRows.length+1,
  getLastColumn:()=>6,
  getRange:(row,col,length,width)=>({
    getValues:()=>renameRows.map(x=>x.slice()),
    setValues:values=>{
      if (row===renameRows.length+2 && col===1) {
        renameAppends++;
        values.forEach(v=>renameRows.push(v.slice()));
        return;
      }
      values.forEach((v,i)=>{renameRows[row+i-2][col-1]=v[0];});
    }
  })
};
const renameCtx=vm.createContext({
  JSON,Object,Array,String,
  LockService:{getScriptLock:()=>({waitLock:()=>{lockDepth++},releaseLock:()=>{lockDepth--}})},
  // This test slices only the normal code-master writer, with no pending
  // deletion marker in its isolated workbook fixture.
  _settlePendingCodeDeleteLocked_:()=>({pending:false}),
  getss:()=>({getSheetByName:()=>renameSheet}),
  _portfolioCodeMasterSourceIdentity_:()=> 'TEST_SOURCE',
  _cleanCode:code=>String(code||'').trim(),
  _parseArrayParam:val=>{const x=JSON.parse(val);if(!Array.isArray(x))throw Error('invalid');return x},
  _readSettingsMap:()=>renameSettings,
  _writeCodeSyncEditablesOnly_:(ss,previous,desired)=>{
    assert.equal(JSON.stringify(previous),JSON.stringify(renameSettings.EDITABLE_PRICES));
    renameSettings.EDITABLE_PRICES=desired.map(row=>({...row}));
    return true;
  },
  getCodeItems:()=>renameRows.map(x=>({code:x[0],name:x[1],type:x[2],sector:x[3],currency:x[4]||'KRW',market:x[5]})),
  _setCodeColumnText:()=>{},_touchSnapshotIntegritySourceRevision:()=>{},
  _repairKnownCodeColumns:()=>[],CONFIG:{SHEET_CODES:'종목코드'},
  SpreadsheetApp:{flush:()=>{}},
  jsonOk:payload=>({status:'ok',...payload}),
  jsonError:(message,payload)=>({status:'error',message,...payload})
});
vm.runInContext(
  gasSrc.slice(normStart,gasSrc.indexOf('/**',normStart))+
  '\n'+gasSrc.slice(normalStart,normalEnd),renameCtx);
const replaceOld=renameCtx.getCodeItems();
const renameResult=renameCtx.handleSyncCodes(JSON.stringify({
  '새이름':{code:'222222',type:'ETF',sector:'해외',currency:'USD',market:'US'}
}),'TEST_SOURCE',JSON.stringify(replaceOld),JSON.stringify([{
  previousName:'옛이름',previousCode:'111111',name:'새이름',code:'222222'
}]));
assert.equal(renameResult.status,'ok','explicit full-pair rename succeeds');
assert.equal(renameAppends,0,'old row must be replaced, never appended');
assert.equal(renameRows.length,1);
assert.deepEqual(renameRows[0],['222222','새이름','ETF','해외','USD','US']);
assert.equal(renameSettings.EDITABLE_PRICES[0].name,'새이름');
assert.equal(renameSettings.EDITABLE_PRICES[0].code,'222222');
assert.equal(lockDepth,0);
// One-field edits are also atomic replacements and can form a chain before
// the next client debounce; the retained name/code is not a collision.
let oneFieldOld=renameCtx.getCodeItems();
let onlyNameResult=renameCtx.handleSyncCodes(JSON.stringify({
  '이름만변경':{code:'222222',type:'ETF',sector:'해외',currency:'USD',market:'US'}
}),'TEST_SOURCE',JSON.stringify(oneFieldOld),JSON.stringify([{
  previousName:'새이름',previousCode:'222222',name:'이름만변경',code:'222222'
}]));
assert.equal(onlyNameResult.status,'ok');
assert.equal(renameRows.length,1);
assert.equal(renameSettings.EDITABLE_PRICES[0].name,'이름만변경');
oneFieldOld=renameCtx.getCodeItems();
let onlyCodeResult=renameCtx.handleSyncCodes(JSON.stringify({
  '이름만변경':{code:'333333',type:'ETF',sector:'해외',currency:'USD',market:'US'}
}),'TEST_SOURCE',JSON.stringify(oneFieldOld),JSON.stringify([{
  previousName:'이름만변경',previousCode:'222222',name:'이름만변경',code:'333333'
}]));
assert.equal(onlyCodeResult.status,'ok');
assert.equal(renameRows.length,1);
assert.equal(renameSettings.EDITABLE_PRICES[0].code,'333333');
assert.equal(renameAppends,0);
assert.equal(lockDepth,0);

// Ensure actual UI edit handler captures a source-pinned replacement and
// normal sync submits the expected explicit replacement to the server.
assert.match(fs.readFileSync('src/web/features/master/stock/mgmt_stock.js','utf8'),
  /_recordSameTargetLocalCodeAddition\(\{[\s\S]*?name:newName,code:newCode[\s\S]*?replaces:originalMasterIdentity/,
  'stock editor must durably journal source-pinned replacement BEFORE any local mutations');
assert.ok(fs.readFileSync('src/web/features/settings/settings_sync.js','utf8').includes(
  'replacements:JSON.stringify(replacements)'));

console.log('✅ 복원 전 서버 기초정보 매칭·불일치 전송 차단·dirty 재시도 계약 통과');
console.log('✅ Bootstrap 실패 단계 보존·재시도·강제 읽기 보호·세대 경합·인증 요청 회귀 통과');

// The actual Update button must reach the journal-aware restore, not strand
// empty memory while a recoverable pending payload lives in localStorage.
function quickFixture(f) {
  const status=[],seen=[],date={value:'2026-10-25'},label={textContent:'업데이트'};
  const button={disabled:false,setAttribute(){},removeAttribute(){},querySelector:()=>label};
  f.ctx.document.getElementById=id=>id==='quickDateInput'?date:id==='quickFetchBtn'?button:null;
  f.ctx.setStatusLabel=(message,state)=>status.push({message,state});
  f.ctx.refreshAll=()=>{};f.ctx.getDateStr=()=> '2026-10-25';
  f.ctx.fetchFromGsheet=async()=>{seen.push(vm.runInContext('rawTrades.map(t=>t.qty)',f.ctx));return {'테스트':150};};
  for(const name of ['updateDateBadge','savePriceCache'])f.ctx[name]=()=>{};
  for(const name of ['_pricePortfolioSummary','_priceDiagSummary','_priceLookupSummary'])f.ctx[name]=()=>'';
  f.ctx._priceStatusLayout=(primary,meta)=>primary+meta;
  return{status,seen,button};
}
{
 h=setup();h.response.codes=[{name:'테스트',code:'005930',type:'주식'}];
 vm.runInContext("rawTrades.push({date:'2026-10-07',tradeType:'buy',acct:'계좌',name:'테스트',code:'005930',qty:3,price:100}); _markPortfolioRemoteDirty(); rawTrades.length=0; rawHoldings.length=0;",h.ctx);
 const posted=[];
 h.ctx.requestGsheetFormJson=async(action,data)=>{posted.push({action,data});return{status:'ok',saveState:'success'};};
 const q=quickFixture(h);await h.ctx.quickFetchByDate();
 assert.equal(h.ctx._getPortfolioRemoteDirty(),null,'Update must actually retry pending sync');
 assert.equal(vm.runInContext('rawTrades[0].qty',h.ctx),3,'latest local edit survives authoritative pull');
 assert.ok(posted.some(p=>p.action==='syncTrades'&&JSON.parse(p.data.data)[0].qty===3));
 assert.equal(q.seen.length,1);assert.equal(q.button.disabled,false);
}
for(const mode of ['ok','read-failed','backup-failed']) {
 h=setup();h.response.codes=[{name:'테스트',code:'005930',type:'주식'}];
 h.response.trades=[{date:'2026-10-07',tradeType:'buy',acct:'계좌',name:'테스트',code:'005930',qty:2,price:100}];
 h.response.holdings=[{acct:'계좌',name:'테스트',code:'005930',qty:2,costAmt:200,assetType:'주식'}];
 h.response.settings.ACCOUNTS_MASTER=[{name:'계좌'}];
 vm.runInContext('_markPortfolioRemoteDirty()',h.ctx);
 const dirty=JSON.stringify(h.ctx._getPortfolioRemoteDirty());
 if(mode==='read-failed')h.response.portfolioReadStatus.holdingsOk=false;
 if(mode==='backup-failed')h.ctx.localStorage.setItem=(k,v)=>{if(k==='portfolio_empty_dirty_restore_archive_v1')throw Error('quota');h.storage.set(k,v);};
 const q=quickFixture(h);await h.ctx.quickFetchByDate();
 assert.equal(h.writes,0,'empty generic dirty must never delete remote ledger, holdings or fundDirect');
 if(mode==='ok') {
  assert.equal(vm.runInContext('rawTrades.length',h.ctx),1);assert.equal(vm.runInContext('rawHoldings.length',h.ctx),1);
  assert.equal(vm.runInContext('rawHoldings[0].acct',h.ctx),'계좌');
  assert.equal(vm.runInContext('rawHoldings.reduce((sum,h)=>sum+h.qty*h.cost,0)',h.ctx),200,'restored acquisition basis must match server source');
  assert.equal(h.ctx._getPortfolioRemoteDirty(),null);assert.equal(q.seen.length,1);
  const backup=JSON.parse(h.storage.get('portfolio_empty_dirty_restore_archive_v1'));
  const entry=Object.values(backup)[0];assert.equal(entry.epoch,JSON.parse(dirty).epoch);
 } else {
  assert.equal(JSON.stringify(h.ctx._getPortfolioRemoteDirty()),dirty,'failure retains original pending record');
  assert.equal(q.seen.length,0,'restore failure must not masquerade as missing market prices');
  assert.match(q.status.at(-1).message,/로컬 미전송 자료 보존/);
  assert.doesNotMatch(q.status.at(-1).message,/주말\/공휴일/);
  assert.equal(vm.runInContext('rawTrades.length',h.ctx),0,'read/backup preflight fails before portfolio application');
  if(mode==='backup-failed') {
   h.ctx.localStorage.setItem=(k,v)=>h.storage.set(k,v);
   await h.ctx.quickFetchByDate();
   assert.equal(h.ctx._getPortfolioRemoteDirty(),null,'retry after backup space recovers must succeed');
   assert.equal(q.seen.length,1);
  }
 }
 assert.equal(q.button.disabled,false);
}
{
 h=setup();h.response.codes=[{name:'테스트',code:'005930',type:'주식'}];
 vm.runInContext("rawTrades.push({date:'2026-10-07',tradeType:'buy',name:'테스트',code:'005930',qty:3,price:100}); _markPortfolioRemoteDirty(); rawTrades.length=0;",h.ctx);
 h.ctx.requestGsheetFormJson=async()=>({status:'error',saveState:'failed'});
 const before=JSON.stringify(h.ctx._getPortfolioRemoteDirty()),q=quickFixture(h);
 await h.ctx.quickFetchByDate();assert.equal(q.seen.length,0);
 assert.equal(JSON.stringify(h.ctx._getPortfolioRemoteDirty()),before);
 assert.equal(vm.runInContext('rawTrades[0].qty',h.ctx),3);
 assert.match(q.status.at(-1).message,/PORTFOLIO_SYNC_FAILED/);
}
{
 h=setup();vm.runInContext("_markPortfolioRemoteDirty(); _setPendingExplicitEmptyTradeSync({from:'2026-10-07',target:GSHEET_API_URL})",h.ctx);
 assert.equal(h.ctx._canRestoreEmptyPortfolioDirty(h.ctx._getPortfolioRemoteDirty()),false,'explicit deletion intent is never archived as an empty marker');
 assert.ok(h.ctx._getPendingExplicitEmptyTradeSync());
}
console.log('✅ 실제 업데이트: pending 재시도·빈 기록 백업 후 원격 복원·읽기/백업/쓰기 실패 보호·명시 삭제 보존');

// API status belongs to the authoritative Settings response, not the real-estate subset.
for (const configured of [true, false]) {
  const f=setup();
  f.response.settings.apiKeyStatus={publicDataApiKeyConfigured:configured,krxAuthKeyConfigured:configured,
    requestAuthenticationEnabled:true,toss:{clientIdConfigured:configured,secretConfigured:configured,clientIdMasked:'te••st'}};
  assert.equal(await f.ctx.loadSettings(),true);
  assert.equal(f.ctx.GAS_API_KEY_STATUS?.publicDataApiKeyConfigured,configured,'Bootstrap restores API status');
  assert.equal(f.ctx.GAS_API_KEY_STATUS?.toss.secretConfigured,configured);
  const status=f.ctx.GAS_API_KEY_STATUS;
  f.ctx.requestGsheetActionJson=async()=>({status:'ok',settings:{LOAN:{},REAL_ESTATE:{},LOAN_SCHEDULE:[],RE_VALUE_HIST:[]}});
  assert.equal(await f.ctx.loadRealEstateSettings(),true);
  assert.equal(f.ctx.GAS_API_KEY_STATUS,status,'real-estate subset cannot erase authoritative API status');
  assert.equal(f.writes,0);
  assert.ok(![...f.storage.keys()].some(k=>k.includes('api_key') || k.includes('auth_key')),'no API secrets persisted');
}
{
  const f=setup();
  f.ctx.requestGsheetActionJson=async action=>action==='getBootstrap'?{status:'error'}:
    {status:'ok',settings:{...f.response.settings,apiKeyStatus:{publicDataApiKeyConfigured:true,krxAuthKeyConfigured:true}},gasVersion:'9.274'};
  assert.equal(await f.ctx.loadSettings(),true);
  assert.equal(f.ctx.GAS_API_KEY_STATUS.publicDataApiKeyConfigured,true,'legacy getSettings also restores status');
}
console.log('✅ 실제 Settings/Bootstrap API 키 상태 복원·부동산 부분조회 보존·비밀키 비저장 회귀 통과');

// Transport failures must be actionable without exposing URLs or token-bearing errors.
{
  const transport=setup();
  transport.ctx.fetch=async()=>{throw new Error('private_token_value');};
  const failed=await transport.ctx.requestJsonWithPolicy('https://example.invalid',{
    preserveError:true,retry:0,action:'getAutomationStatus'
  });
  assert.equal(failed.errorCode,'SERVER_ERROR');
  assert.ok(!JSON.stringify(failed).includes('private_token_value'));
  transport.ctx.fetch=async()=>({ok:true,json:async()=>{throw new SyntaxError('private_token_value');}});
  const invalid=await transport.ctx.requestJsonWithPolicy('https://example.invalid',{preserveError:true});
  assert.equal(invalid.errorCode,'INVALID_RESPONSE');
  transport.ctx.fetch=async()=>{const e=new Error('private_token_value');e.name='AbortError';throw e;};
  const timeout=await transport.ctx.requestJsonWithPolicy('https://example.invalid',{preserveError:true});
  assert.equal(timeout.errorCode,'CLIENT_TIMEOUT');
}

// 복원 중 보유 저장 확인 전 거래 저장을 시작하지 않고, 실패 시 로컬 journal을 보존한다.
for (const outcome of ['ok','error']) {
  const x=setup();
  x.response.codes=[{name:'테스트',code:'005930',type:'주식'}];
  vm.runInContext(`EDITABLE_PRICES.push({name:'테스트',code:'005930',assetType:'주식'}); _invalidateEPIndex(); rawTrades.push({date:'2026-10-07',tradeType:'buy',acct:'계좌',name:'테스트',code:'005930',qty:1,price:100}); rawHoldings.push({name:'테스트',code:'005930',acct:'계좌',qty:1,cost:100}); _markPortfolioRemoteDirty();`,x.ctx);
  let release;const calls=[];
  x.ctx.requestGsheetFormJson=async(action,params,options)=>{
    calls.push(action);
    if(action==='syncHoldings') { assert.equal(options.timeoutMs,60000);assert.equal(options.retry,0);return await new Promise(resolve=>{release=resolve}); }
    return {status:'ok',saveState:'success'};
  };
  const task=x.ctx.loadSettings(null,{forcePortfolioRestore:true});
  for(let n=0;n<100&&!release;n++) await new Promise(resolve=>setImmediate(resolve));
  assert.ok(release,'holdings request must start');
  assert.ok(!calls.includes('syncTrades'),'거래 저장은 보유 저장 응답보다 먼저 시작하면 안 됨');
  release(outcome==='ok'?{status:'ok'}:{status:'error'});
  const result=await task;
  if(outcome==='error') { assert.equal(result,false);assert.ok(!calls.includes('syncTrades'));assert.ok(x.ctx._getPortfolioRemoteDirty()); }
  else assert.ok(calls.includes('syncTrades'),'보유 저장 성공 후 거래 저장을 진행해야 함');
}
console.log('보유·거래 복구 순서 및 실패 시 journal 보존 검증 통과');

// 응답 시간 초과는 서버 저장 실패로 확정하지 않고 단계별 미확인 상태로 보존한다.
for (const failedAction of ['syncHoldings','syncTrades']) {
 const x=setup();x.response.codes=[{name:'테스트',code:'005930',type:'주식'}];
 vm.runInContext(`EDITABLE_PRICES.push({name:'테스트',code:'005930',assetType:'주식'}); _invalidateEPIndex(); rawTrades.push({date:'2026-10-07',tradeType:'buy',acct:'계좌',name:'테스트',code:'005930',qty:1,price:100}); rawHoldings.push({name:'테스트',code:'005930',acct:'계좌',qty:1,cost:100}); _markPortfolioRemoteDirty();`,x.ctx);
 const calls=[];x.ctx.requestGsheetFormJson=async(action,_params,options)=>{calls.push(action);if(action==='syncHoldings'||action==='syncTrades'){assert.equal(options.timeoutMs,60000);assert.equal(options.retry,0);}return action===failedAction?{status:'error',errorCode:'CLIENT_TIMEOUT'}:{status:'ok',saveState:'success'};};
 assert.equal(await x.ctx.loadSettings(null,{forcePortfolioRestore:true}),false);
 assert.match(x.ctx.getGsheetSettingsLoadFailure(),failedAction==='syncHoldings'?/HOLDINGS_SAVE_TIMEOUT/:/TRADES_SAVE_TIMEOUT/);
 assert.ok(x.ctx._getPortfolioRemoteDirty(),'응답 미확인 시 미전송 자료 유지');
 if(failedAction==='syncHoldings')assert.ok(!calls.includes('syncTrades'));
}
console.log('거래·보유 응답 시간 초과 구분 및 미전송 자료 보존 검증 통과');
