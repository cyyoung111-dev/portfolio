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
  const ctx=vm.createContext({console:{log:noop,warn:noop,error:noop},setTimeout:noop,clearTimeout:noop,setInterval:noop,clearInterval:noop,
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
console.log('✅ Bootstrap 실패 단계 보존·재시도·강제 읽기 보호·세대 경합·인증 요청 회귀 통과');
