import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {execFileSync} from 'node:child_process';
const baseline=process.argv.includes('--baseline');
const read=p=>baseline?execFileSync('git',['show',`origin/main:${p}`],{encoding:'utf8',maxBuffer:4000000}):fs.readFileSync(p,'utf8');
const gas=read('src/gas/apps_script.gs'),web=read('src/web/features/dividend/mgmt_div.js');
function fixture(mode='normal') {
 let settings={DIVDATA:{'111111':{source:'SEIBRO',perShare:7,events:[]},'222222':{source:'MANUAL',perShare:99,events:[]},'333333':{source:'MANUAL',perShare:88}}},writes=0,backupCount=0,corruptOnce=true;
 let data=[['종목코드','ISIN','종목명','기준일','지급일','주당분배금','수집일시','원본소스'],['222222','KR2222222222','B','2025-01-01','2025-01-02',99,'old','MANUAL']];
 const marks=[];
 const range=(row,col,rows,cols)=>({getValues:()=>Array.from({length:rows},(_,i)=>Array.from({length:cols},(_,j)=>data[row+i-1]?.[col+j-1]??'')),setValues:vals=>{assert.equal(backupCount,2,'both backups must precede first history mutation');writes++;vals.forEach((r,i)=>{data[row+i-1]??=[];r.forEach((v,j)=>data[row+i-1][col+j-1]=v);});return range(row,col,rows,cols);},setBackground(){return this;},setFontColor(){return this;},setFontWeight(){return this;},setNumberFormat(){return this;}});
 const sheet={getLastRow:()=>data.length,getDataRange:()=>({getValues:()=>JSON.parse(JSON.stringify(data))}),getRange:range,clearContents:()=>{assert.equal(backupCount,2);writes++;data=[];},setFrozenRows:()=>{}};
 const ss={getSheetByName:name=>name==='ETF分配'?sheet:name==='ETF분배금이력'?sheet:name==='설정'?{}:null};
 const ctx=vm.createContext({Date,console,Logger:{log(){}},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},SpreadsheetApp:{flush(){}},Utilities:{formatDate:(d,t,p)=>p==='yyyy-MM-dd'?new Intl.DateTimeFormat('sv-SE',{timeZone:t,year:'numeric',month:'2-digit',day:'2-digit'}).format(d):'2026-10-25T12:00:00+09:00'}});
 vm.runInContext(gas,ctx);ctx.today=()=> '2026-10-25';ctx.getss=()=>ss;
 ctx.jsonOk=x=>({getContent:()=>JSON.stringify({status:'ok',...x})});ctx.jsonError=message=>({getContent:()=>JSON.stringify({status:'error',message})});
 ctx._readSettingsMap=()=>JSON.parse(JSON.stringify(settings));ctx._writeSettingsMap=x=>{writes++;settings=JSON.parse(JSON.stringify(x));if(mode==='readback-failure'&&corruptOnce){settings.DIVDATA['111111'].perShare=-999;corruptOnce=false;}};
 ctx._backupSheetBeforeWrite=()=>{backupCount++;return{name:'backup-'+backupCount};};ctx._markSnapshotBackupStatus=(r,s)=>marks.push(s);
 ctx._getEtfDividendDiagnosticTargets=()=>[{code:'111111',name:'A'},{code:'222222',name:'B'}];
 ctx.UrlFetchApp={fetchAll:requests=>requests.map(r=>{const search=r.payload.includes('searchEtfContentList'),a=r.payload.includes('111111');
 let xml=search?`<?xml version="1.0"?><vector result="1"><result><ISIN value="${a?'KR1111111111':'KR2222222222'}"/><KOR_SECN_NM value="${a?'A':'B'}"/></result></vector>`
 :!a?'<?xml version="1.0"?><vector result="0"></vector>'
 :`<?xml version="1.0"?><vector result="${mode==='duplicate'?2:1}">${Array.from({length:mode==='duplicate'?2:1},()=>'<result><ISIN value="KR1111111111"/><RGT_STD_DT value="20260930"/><TH1_PAY_TERM_BEGIN_DT value="20261005"/><ESTM_STDPRC value="12"/></result>').join('')}</vector>`;
 if(mode==='invalid-pay'&&!search&&a)xml=xml.replace('20261005','20269999');
 if(mode==='bad-zero'&&!search&&!a)xml='<html><vector result="0"></vector></html>';
 return{getResponseCode:()=>200,getContentText:()=>xml};})};
 return{ctx,ss,marks,run:()=>JSON.parse(ctx.handleApplyEtfDividends().getContent()),settings:()=>settings,data:()=>data,writes:()=>writes};
}
{
 const f=fixture(),r=f.run();assert.equal(r.status,'ok','one verified zero-window ETF must not block other validated distributions');
 assert.equal(r.partial,true);assert.equal(r.noEventCount,1);assert.equal(f.settings().DIVDATA['111111'].perShare,12);
 assert.equal(f.settings().DIVDATA['222222'].perShare,99);assert.equal(f.settings().DIVDATA['222222'].source,'MANUAL');
 assert.equal(f.settings().DIVDATA['222222'].providerCheckStatus,'NO_EVENTS');
 assert.ok(f.data().some(row=>row[0]==='222222'&&row[7]==='MANUAL'));assert.deepEqual(f.marks,['COMPLETED','COMPLETED']);
 const merged=f.ctx._preserveSeibroDivData(f.settings().DIVDATA,{'333333':{source:'PUBLIC_DATA',perShare:1}});
 assert.equal(merged['333333'].perShare,88);assert.equal(merged['111111'].perShare,12,'patch must preserve omitted rows');
 const manual=f.ctx._mergeSeibroDivData({'111111':{source:'MANUAL',perShare:77}},[{code:'111111',proposed:{perShare:1,events:[]}}],'2026-10-25');
 assert.equal(manual['111111'].perShare,77);
}
for(const mode of ['bad-zero','duplicate','invalid-pay']){const f=fixture(mode),r=f.run();assert.equal(r.status,'error');assert.equal(f.writes(),0,'provider contract errors fail before any backup/write');}
{const f=fixture('readback-failure'),r=f.run();assert.equal(r.status,'error');assert.ok(f.marks.every(x=>x==='WRITE_FAILED'));assert.equal(f.settings().DIVDATA['111111'].perShare,7,'readback error must restore original settings');assert.equal(f.settings().DIVDATA['222222'].perShare,99);}
function ui({etf=true,save=true,stocks=false,publicOk=true}={}) {
 const labels=[],ctx=vm.createContext({console:{warn(){}},Date,setTimeout:()=>0,clearTimeout(){}});ctx.window=ctx;
 vm.runInContext(web,ctx);ctx.GSHEET_API_URL='https://script.google.com/macros/s/test/exec';ctx.GAS_API_KEY_STATUS={publicDataApiKeyConfigured:true};ctx.currentView='div';ctx.DIVDATA={};
 ctx.EDITABLE_PRICES=stocks?[{code:'111111',name:'A',type:'주식'}]:[];ctx.rawHoldings=stocks?[{code:'111111',name:'A',qty:1}]:[];
 ctx.getDivKey=n=>n==='A'?'111111':n;ctx._refreshSeibroEtfDividends=async()=>etf;ctx.loadDividendSettings=async()=>true;
 ctx._setDividendLinkState=(state,message)=>labels.push({state,message});ctx.$el=()=>null;ctx.renderDivView=()=>{};ctx.showToast=()=>{};
 ctx._fetchDividendSource=async action=>{assert.equal(action,'dividendPublic','no GF fallback');return publicOk?{'111111':{perShare:12,source:'PUBLIC_DATA',events:[{date:'2026-09-30',amount:12}]}}:{};};ctx.persistDividendSettings=async()=>save;
 return{ctx,labels};
}
for(const opts of [{etf:false},{etf:false,stocks:true},{stocks:true,save:false},{stocks:true,publicOk:false}]) {
 const u=ui(opts);await u.ctx._autoFetchDiv({});assert.equal(u.labels.at(-1).state,'fail','auto must not report stale data as latest');
 const v=ui(opts);assert.equal(await v.ctx.startDivFetch(),false);assert.equal(v.labels.at(-1).state,'fail');
}
{const u=ui({stocks:true});await u.ctx._autoFetchDiv({});assert.equal(u.labels.at(-1).state,'ok');assert.equal(await u.ctx.startDivFetch(),true);}
{const u=ui();const old={source:'GOOGLEFINANCE',perShare:10,events:[],updatedAt:'old'};const v=u.ctx._normalizeDividendResponse({source:'PUBLIC_DATA',perShare:0},old);assert.equal(v.source,'GOOGLEFINANCE');assert.equal(v.updatedAt,'old');assert.equal(v.perShare,10);assert.equal(v.refreshState,'UNVERIFIED');}
console.log('PASS: actual mixed ETF refresh, verified zero-window skip, manual/history protection, backup/readback, no false success/GF fallback');

const {runDividendRefresh}=await import('./run-dividend-source-refresh.mjs');
async function collectorFixture(mode='ok') {
 const calls=[],cache={'111111':{source:'SEIBRO',updatedAt:'2026-10-25'},'333333':{source:'GOOGLEFINANCE',perShare:7},'444444':{source:'MANUAL',perShare:99}};
 let saved=false;
 const fetchImpl=async(_url,options)=>{
  const p=new URLSearchParams(options.body),action=p.get('action');calls.push(action);
  if(p.get('accessToken')==='DIVIDEND_BAD_AUTH_PROBE')return{ok:true,json:async()=>({status:mode==='auth-bad'?'ok':'error'})};
  let out={status:'ok'};
  if(action==='getAutomationStatus')out.gasVersion=mode==='version'?'9.265':'9.269';
  if(action==='refreshEtfDividends')Object.assign(out,mode==='no-targets'?{skipped:true,reason:'NO_TARGETS',targetCount:0,targetCodes:[]}:{saved:true,refreshed:true,targetCount:1,targetCodes:['111111'],noEventCount:0,historyRows:1});
  if(action==='getDividendSettings')out.divData=mode==='readback-bad'&&saved?{}:structuredClone(cache);
  if(action==='getCodeListReadOnly'){out.status=mode.startsWith('catalog-')?'error':'ok';out.message=mode==='catalog-private'?'PRIVATE_KEY':mode.replace('catalog-','');out.readOnly=true;out.gasVersion='9.269';out.publicDataApiKeyConfigured=true;out.codes=[{code:'111111',type:'ETF',name:'A'},{code:'999999',type:'ETF',name:'inactive'},{code:'333333',type:'주식',name:'B'},{code:'444444',type:'주식',name:'C'}];}
  assert.ok(!['getCodeList','getSettings'].includes(action),'source refresh must not enter unrelated settlement writers');
  if(action==='dividendPublic') {assert.equal(p.get('names'),'B|C');out.dividends={'333333':{source:'PUBLIC_DATA',perShare:12,events:[{date:'2026-09-30',amount:12}]}};out.diagnostics={dividend:{'333333':{status:mode==='partial-page'?'PARTIAL_PAGE':mode==='no-events'?'NO_ROWS':'OK'}},retry:{}};}
  if(action==='dividendPublic'&&mode==='no-events'){out.dividends={};out.diagnostics.dividend['333333'].returnedRows=0;out.diagnostics.normalized={'333333':{inputRows:0,acceptedEvents:0,rejected:{identity:0,date:0}}};}
  if(action==='saveDividendSettings'){const patch=JSON.parse(p.get('data'));assert.deepEqual(Object.keys(patch),['333333']);Object.assign(cache,patch);saved=true;out.saved=true;}
  return{ok:true,json:async()=>out};
 };
 const run=()=>runDividendRefresh({url:'https://script.google.com/macros/s/TEST/exec',token:'TEST',fetchImpl,asOf:new Date('2026-10-25T12:00:00Z')});
 return{run,calls,cache};
}
{const f=await collectorFixture(),r=await f.run();assert.equal(r.etfChecked,1);assert.equal(r.stockUpdated,1);assert.equal(r.stockUnverified,0);assert.equal(f.cache['444444'].perShare,99);}
{const f=await collectorFixture('partial-page'),r=await f.run();assert.equal(r.stockUpdated,0);assert.ok(!f.calls.includes('saveDividendSettings'));assert.equal(f.cache['333333'].perShare,7);}
for(const reason of ['CODE_LIST_READ_ONLY_BUSY','CODE_LIST_READ_ONLY_PENDING','CODE_LIST_READ_ONLY_FAILED']) {
 const f=await collectorFixture('catalog-'+reason);await assert.rejects(f.run(),new RegExp('^Error: DIVIDEND_MASTER_'+reason+'$'));assert.ok(!f.calls.includes('saveDividendSettings'));
}
{const f=await collectorFixture('catalog-private');await assert.rejects(f.run(),/^Error: DIVIDEND_MASTER_READ_FAILED$/);}
for(const mode of ['auth-bad','version','readback-bad']){const f=await collectorFixture(mode);await assert.rejects(f.run(),/DIVIDEND_/);if(mode!=='readback-bad')assert.ok(!f.calls.includes('refreshEtfDividends'));}
console.log('PASS: official-source collector auth/version/readback guards, exact patch, no manual/omitted-data overwrite');

for(const manual of [false,true]) {
 const u=ui({stocks:true});let current=true;u.ctx.getGsheetConnectionGeneration=()=>1;u.ctx.isGsheetConnectionCurrent=()=>current;u.ctx._fetchDividendSource=async()=>{current=false;return {'111111':{source:'PUBLIC_DATA',perShare:99}};};u.ctx.persistDividendSettings=async()=>{throw Error('stale connection must not save');};
 if(manual)assert.equal(await u.ctx.startDivFetch(),false);else await u.ctx._autoFetchDiv({});assert.deepEqual(u.ctx.DIVDATA,{});
}

{const f=await collectorFixture('no-targets'),r=await f.run();assert.equal(r.etfChecked,0);assert.equal(r.stockUpdated,1,'inactive master ETFs must not block stock refresh');}
{
 const u=ui();vm.runInContext(fs.readFileSync('src/web/features/settings/settings_persistence_utils.js','utf8'),u.ctx);
 u.ctx._applyDivData({'111111':{source:'SEIBRO',perShare:9,ttmPerShare:108,freq:'월배당',months:[1],events:[],providerCheckStatus:'NO_EVENTS',providerCheckedAt:'2026-10-25',updatedAt:'2026-09-04'}});
 assert.equal(u.ctx.DIVDATA['111111'].providerCheckStatus,'NO_EVENTS');assert.equal(u.ctx.DIVDATA['111111'].ttmPerShare,108);assert.equal(u.ctx.DIVDATA['111111'].source,'SEIBRO');
 u.ctx.rawHoldings=[{name:'A',qty:3,acct:'계좌'}];u.ctx.EDITABLE_PRICES=[{name:'A',code:'111111',assetType:'ETF'}];u.ctx.getEP=()=>u.ctx.EDITABLE_PRICES[0];u.ctx._escapeHtml=String;
 const body={innerHTML:''};u.ctx.$el=id=>id==='divMgmtBody'?body:null;
 u.ctx.buildDivMgmt();assert.match(body.innerHTML,/조회기간 내 0건/,'positive cached amount must still show the NO_EVENTS warning');
 u.ctx._applyDivData({'111111':{source:'MANUAL',perShare:9,months:[],updatedAt:'2026-10-25',events:[{date:'2026-09-30',payDate:'2026-10-05',amount:9,source:'MANUAL'}]}});
 assert.equal(u.ctx.DIVDATA['111111'].events[0].source,'MANUAL');
 u.ctx._kstYear=()=>2026;u.ctx.getQtyAtDate=()=>3;u.ctx.getDivRefDate=()=> '2026-01-01';
 vm.runInContext(fs.readFileSync('src/web/views/views_div_asset.js','utf8'),u.ctx);
 assert.equal(u.ctx.calcDividends()[0].actualDiv,27,'restored events must reach the actual dividend calculation');
}
console.log('PASS: actual normalizer→positive-amount warning→actual payout calculation; inactive/no-target ETF readback scope');

{const f=await collectorFixture('no-events'),r=await f.run();assert.equal(r.stockNoEvents,1);assert.equal(r.stockManual,1);assert.equal(r.stockUpdated,0);assert.equal(r.stockUnverified,0);assert.ok(!f.calls.includes('saveDividendSettings'));assert.equal(f.cache['333333'].perShare,7);}
