import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sync=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
const history=fs.readFileSync('src/web/views/views_history.js','utf8');
const html=fs.readFileSync('src/web/index.html','utf8');
const sw=fs.readFileSync('src/web/sw.js','utf8');
const program=sync.slice(0,sync.indexOf('// ── 종목코드 GSheet 자동 등록'));
assert.match(program,/async function recoverMissingStockMasterReadOnly/);
const samples=[
 {code:'005930',name:'삼성전자',type:'주식',sector:'반도체/IT',market:'KR'},
 {code:'F00001',name:'한화 LIFEPLUS TDF 2045',type:'TDF',sector:'인덱스',market:'OTHER'},
 {code:'0046Y0',name:'ACE 미국배당퀄리티',type:'ETF',sector:'배당',market:'KR'},
];
let pending=null,requestCount=0,writeCount=0,storageCount=0,generation=3;
const editable=[],stockCodes={};
const ctx={
  GSHEET_API_URL:'https://script.google.com/macros/s/test/exec',
  _gsPortfolioRestoreRequired:false,
  _gsBootPromise:null,
  EDITABLE_PRICES:editable,STOCK_CODE:stockCodes,EDITABLES_KEY:'editables',
  getGsheetConnectionGeneration:()=>generation,
  isGsheetConnectionCurrent:(url,g)=>g===generation&&url===ctx.GSHEET_API_URL,
  normalizeStockCode:code=>String(code||'').trim().toUpperCase(),
  _invalidateEPIndex:()=>{},
  lsSave:(k,value)=>{storageCount++;assert.equal(k,'editables');assert.equal(value,editable);},
  requestGsheetActionJson:async(action)=>{
    assert.equal(action,'getCodeList');
    requestCount++;
    if(pending) return pending;
    return {status:'ok',codes:samples};
  },
  requestGsheetFormJson:()=>{writeCount++;throw Error('READ ONLY MUST NEVER POST');},
  console
};
vm.createContext(ctx);
vm.runInContext(program,ctx);
const recover=()=>vm.runInContext('recoverMissingStockMasterReadOnly()',ctx);
let count=await recover();
assert.equal(count,3);
assert.equal(editable.length,3);
assert.equal(editable[0].sector,'반도체/IT');
assert.equal(editable[1].assetType,'TDF');
assert.equal(editable[2].market,'KR');
assert.equal(writeCount,0,'zero ledger writes');
assert.equal(storageCount,1,'one local cache repair');
assert.equal(requestCount,1);
assert.equal(await recover(),3,'idempotent recovery');
assert.equal(requestCount,1,'no second read once restored');

editable.length=0;
ctx._gsPortfolioRestoreRequired=true;
assert.equal(await recover(),0,'cross-connection authoritative restore blocks partial master');
assert.equal(editable.length,0);
assert.equal(requestCount,1);
ctx._gsPortfolioRestoreRequired=false;

let resolver;
pending=new Promise(resolve=>resolver=resolve);
const inFlight=recover();
generation=4;
resolver({status:'ok',codes:samples});
assert.equal(await inFlight,0,'stale connection responses must not change master');
assert.equal(editable.length,0);
assert.equal(requestCount,2);
pending=null;
count=await recover();
assert.equal(count,3,'retry can recover after stale response');
assert.equal(writeCount,0);

assert.match(history,/recoverMissingStockMasterReadOnly\(\)/);
assert.match(history,/buildStockMgmt\(\);\s*buildSectorMgmt\(\);/);
assert.match(history,/if \(typeof _mgmtRefresh === 'function'\) _mgmtRefresh\(\)/,
 'stock master recovery must recalculate derived portfolio rows');
assert.match(history,/fullRestoreDone = typeof _gsBootRestored !== 'undefined'/,
 'master read-only success must not imply full bootstrap success');
assert.match(history,/전체 설정 복원 미완료: 변경·저장하지 말고/,
 'read-only partial restore must warn that editing and saving are unsafe');

assert.match(html,/settings_sync\.js\?v=20261028-6/);

assert.ok(html.includes('domain/portfolio/data.js?v=20261028-6'));
assert.ok(sw.includes('domain/portfolio/data.js?v=20261028-6'));

// A partial master preview must not allow any mutation via the management
// entry points. Both UI disable and handler-level guards are required.
const stock=fs.readFileSync('src/web/features/master/stock/mgmt_stock.js','utf8');
const sector=fs.readFileSync('src/web/features/master/sector/mgmt_sector.js','utf8');
for(const [source,names] of [
  [stock,['smDelete','smCsvImport','smMgmtAddNew','smMgmtConfirm','smSave']],
  [sector,['secSave','secDelete','secMgmtAddNew','secMgmtConfirm','secCsvImport']],
]) {
  for(const name of names){
    assert.match(source,new RegExp('(?:async )?function '+name+
      '\\([^\\n]*\\) \\{\\s*if \\(typeof preventUnsafeStockMasterEdit'),
      name+' must gate edits prior to changing state');
  }
  assert.match(source,/container\.querySelectorAll\('input,button'\)/,
    'management controls must be disabled while bootstrap pending');
}
assert.match(html,/mgmt_stock\.js\?v=20261014-5/);
assert.match(html,/mgmt_sector\.js\?v=20261012-2/);
assert.match(html,/sw\.js\?v=20261101-8/);
assert.match(sw,/portfolio-cache-20261101-8/);
assert.match(html,/styles\/responsive\.css\?v=20261101-3/);
assert.match(sw,/styles\/responsive\.css\?v=20261101-3/);
assert.match(html,/id="quickFetchBtn"/);
assert.match(html,/id="quickPriceBtn"/);
const responsive=fs.readFileSync('src/web/styles/responsive.css','utf8');
assert.match(responsive,/@media\(max-width:480px\)/);
assert.match(responsive,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
  'mobile action buttons must share equal full-width columns');
assert.match(responsive,/\.action-update-card>\.action-date-input\{grid-column:1\/-1/,
  'date input must have a full-width row instead of squeezing action labels');
assert.match(responsive,/\.action-update-card>\.action-refresh-btn span\{[^}]*overflow:visible/,
  'mobile labels must not truncate Korean full update/price-only text');
assert.match(responsive,/@media\(max-width:300px\)/,
  'accessibility zoom must stack controls instead of clipping buttons');

assert.match(html,/views_history\.js\?v=20261101-4/);
assert.match(sw,/settings_sync\.js\?v=20261028-6/);
assert.match(sw,/views_history\.js\?v=20261101-4/);

const settings=fs.readFileSync('src/web/features/settings/settings.js','utf8');
assert.match(settings,/if \(_gsBootRestored && isGsheetConnectionCurrent\(bootTarget, bootGeneration\)/,
 'successful bootstrap must re-render disabled controls');
assert.match(html,/mgmt_stock\.js\?v=20261014-5/);
assert.match(html,/mgmt_sector\.js\?v=20261012-2/);
assert.match(html,/settings\.js\?v=20261101-7/);
assert.match(sw,/settings\.js\?v=20261101-7/);
const stockSource=fs.readFileSync('src/web/features/master/stock/mgmt_stock.js','utf8');
const sectorSource=fs.readFileSync('src/web/features/master/sector/mgmt_sector.js','utf8');
assert.ok(stockSource.includes('captureStockMasterEditSession()'));
assert.ok(stockSource.includes('isStockMasterEditSessionCurrent(editSession)'));
assert.ok(sectorSource.includes('isStockMasterEditSessionCurrent(editSession)'));
// Async cancellation must not claim the stock was saved.
assert.match(stockSource,/const saved = await smSave\(editIdx\)/);
assert.match(stockSource,/saved !== true/);
assert.match(stockSource,/async function smSave\(idx\)[\s\S]*return true;/);
const importStart=stockSource.indexOf('function smCsvImport(');
const importEnd=stockSource.indexOf('function smMgmtAddNew(',importStart);
const importCode=stockSource.slice(importStart,importEnd);
assert.ok(importCode.indexOf('await _smValidateListedCode') <
  importCode.indexOf('for (const item of validatedRows)'));
assert.ok(importCode.indexOf('validatedRows.push(') <
  importCode.indexOf('for (const item of validatedRows)'));
assert.ok(importCode.indexOf('EDITABLE_PRICES[existing].code = code') >
  importCode.indexOf('for (const item of validatedRows)'));
console.log('Read-only empty stock master rescue and safe stale generation test passed');


// Concurrent A -> B -> C remote master writes must preserve the latest
// user edit; the second request must rebase only after first server readback.
{
  const ledgerSource = fs.readFileSync('src/web/domain/portfolio/data.js','utf8');
  const first = ledgerSource.indexOf("const PORTFOLIO_PENDING_CODE_ADDITIONS_KEY");
  const last = ledgerSource.indexOf("function _normalizePendingExplicitEmptyTradeSync(",first);
  assert.ok(first >= 0 && last > first);
  const syncProgram=sync.slice(0,sync.indexOf('// ★ v8.1'));
  const remote=[{name:'A',code:'1',type:'주식',sector:'기타',currency:'KRW',market:'KR'}];
  const url='https://script.google.com/macros/s/race/exec', sourceId='sheet-1';
  const journalDisk={};
  let requests=0, posted, release;
  let postReached=new Promise(resolve=>{posted=resolve;});
  let postBlocked=new Promise(resolve=>{release=resolve;});
  const race={
    console, GSHEET_API_URL:url, _gsBootRestored:true,
    _gsPortfolioRestoreRequired:false, _gsCodeMasterSourceIdentity:sourceId,
    GSHEET_KEY:'gsheet-url', EDITABLE_PRICES:[],
    getGsheetConnectionGeneration:()=>3,
    _currentGsheetSyncTarget:()=>url,
    normalizeStockCode:c=>String(c||'').trim(),
    isGsheetConnectionCurrent:(u,g)=>u===url&&g===3,
    isGsheetPortfolioWriteReady:()=>true,
    lsGet:(k,d)=>k in journalDisk?structuredClone(journalDisk[k]):d,
    lsSave:(k,v)=>{journalDisk[k]=structuredClone(v)},
    lsRemove:k=>{delete journalDisk[k]},
    requestGsheetActionJson:async(action)=>{
      assert.equal(action,'getCodeList');
      return {status:'ok',codeMasterSourceId:sourceId,codes:remote.map(x=>({...x}))};
    },
    requestGsheetFormJson:async(action,args)=>{
      assert.equal(action,'syncCodes');
      requests++;
      const expected=JSON.parse(args.expectedCodes);
      const changes=JSON.parse(args.replacements);
      assert.equal(expected.length,1);
      assert.equal(expected[0].name,remote[0].name,'live CAS reads post-queue master');
      const incoming=JSON.parse(args.codes);
      if (requests===6) {
        assert.equal(changes.length,0,'confirmed partial write must not replay old replacement');
        assert.equal(args.forceSettingsRebase,'1');
        const metadata=JSON.parse(args.settingsReplacements);
        assert.equal(metadata.length,1,'full pair settings metadata provenance must survive failed first write');
        assert.equal(metadata[0].previousName,'C');
        assert.equal(metadata[0].previousCode,'3');
        assert.equal(metadata[0].name,'E');
        assert.equal(metadata[0].code,'5');
        assert.equal(incoming.E.code,'5');
        assert.equal(remote[0].name,'E');
        return {status:'ok',updated:0};
      }
      assert.equal(changes.length,1,'replacement must never silently append');
      assert.equal(changes[0].previousName,remote[0].name);
      assert.equal(changes[0].previousCode,remote[0].code);
      assert.equal(incoming[changes[0].name].code,changes[0].code);
      if(requests===1||requests===3) {
        posted();
        await postBlocked;
      }
      remote[0]={name:changes[0].name,code:changes[0].code,
        type:'주식',sector:'기타',currency:'KRW',market:'KR'};
      if (requests===5) return {status:'error',errorCode:'CODE_SYNC_SETTINGS_FAILED'};
      return {status:'ok',updated:1};
    }
  };
  vm.createContext(race);
  vm.runInContext(ledgerSource.slice(first,last),race);
  vm.runInContext(syncProgram,race);
  const session={targetUrl:url,generation:3,sourceId};
  race.session=session;
  const edit=(name,code,oldName,oldCode)=>{
    race.EDITABLE_PRICES=[{name,code,type:'주식',sector:'기타',
      currency:'KRW',market:'KR',replaces:{name:oldName,code:oldCode}}];
    assert.equal(vm.runInContext(
      '_recordSameTargetLocalCodeAddition(EDITABLE_PRICES[0],session)',race),true);
  };
  const attempt=()=>vm.runInContext('syncCodesToGsheet()',race);
  race.initialCodes=remote.map(item=>({...item}));
  vm.runInContext('applyGsheetCodeList(initialCodes, "sheet-1")',race);
  edit('B','2','A','1');
  const firstSync=attempt();
  await postReached;
  edit('C','3','B','2');
  const secondSync=attempt();
  release();
  assert.equal((await firstSync)?.status,'ok');
  assert.equal((await secondSync)?.status,'ok');
  assert.equal(remote[0].name,'C');
  assert.equal(remote[0].code,'3');
  assert.equal(requests,2);
  assert.equal(vm.runInContext(
    '_getSameTargetLocalCodeAdditions(GSHEET_API_URL,_gsCodeMasterSourceIdentity).length',race),0,
    'confirmed journal retired after second readback');

  // Reverting a pending change is not a noop if its earlier POST is in
  // flight: after D has been confirmed, C must be restored by new CAS.
  postReached=new Promise(resolve=>{posted=resolve;});
  postBlocked=new Promise(resolve=>{release=resolve;});
  edit('D','4','C','3');
  const thirdSync=attempt();
  await postReached;
  edit('C','3','D','4');
  const fourthSync=attempt();
  release();
  assert.equal((await thirdSync)?.status,'ok');
  assert.equal((await fourthSync)?.status,'ok');
  assert.equal(remote[0].name,'C');
  assert.equal(requests,4);
  assert.equal(vm.runInContext(
    '_getSameTargetLocalCodeAdditions(GSHEET_API_URL,_gsCodeMasterSourceIdentity).length',race),0);
  // The code row may be committed even when the Settings write fails.
  // Confirm same-workbook actual master, perform no-op Settings repair via CAS
  // and only then retire the original journal.
  edit('E','5','C','3');
  const partialRecovered=await attempt();
  assert.equal(partialRecovered?.status,'ok');
  assert.equal(requests,6);
  assert.equal(remote[0].name,'E');
  assert.equal(remote[0].code,'5');
  assert.equal(vm.runInContext(
    '_getSameTargetLocalCodeAdditions(GSHEET_API_URL,_gsCodeMasterSourceIdentity).length',race),0);
  // Another tab's metadata-only edit cannot be adopted as the precondition
  // for the already queued stale payload. Even code/name identity is equal.
  remote[0].sector='다른탭수정';
  edit('F','6','E','5');
  assert.equal(await attempt(),null,'foreign sector change must fail before POST');
  assert.equal(requests,6,'stale metadata must never be POSTed');
  assert.equal(remote[0].name,'E');
  assert.equal(remote[0].sector,'다른탭수정');
  assert.equal(vm.runInContext(
    '_getSameTargetLocalCodeAdditions(GSHEET_API_URL,_gsCodeMasterSourceIdentity).length',race),1,
    'blocked edit must remain recoverable rather than silently retired');
  remote[0].sector='기타';
  assert.equal((await attempt())?.status,'ok','unchanged authoritative master permits safe retry');
  assert.equal(requests,7);
  assert.equal(remote[0].name,'F');
  assert.equal(vm.runInContext(
    '_getSameTargetLocalCodeAdditions(GSHEET_API_URL,_gsCodeMasterSourceIdentity).length',race),0);
  console.log('✅ 동시 종목 교체, Settings 메타데이터 증거 및 타 탭 메타데이터 변경 차단 회귀 통과');
}


// A -> B code sheet flush, Settings failure, concurrent B -> C while the
// failed request is still reading B, and a *second* Settings recovery error.
// The queued B -> C must remain live, with A -> B Settings debt persisted
// independently and repaired BEFORE changing the code sheet to C.
{
  const ledgerSource=fs.readFileSync('src/web/domain/portfolio/data.js','utf8');
  const first=ledgerSource.indexOf('const PORTFOLIO_PENDING_CODE_ADDITIONS_KEY');
  const last=ledgerSource.indexOf('function _normalizePendingExplicitEmptyTradeSync(',first);
  const syncProgram=sync.slice(0,sync.indexOf('// ★ v8.1'));
  const url='https://script.google.com/macros/s/partial-race/exec',sourceId='sheet-1';
  const remote=[{name:'A',code:'1',type:'주식',sector:'기타',currency:'KRW',market:'KR'}];
  const disk={},calls=[];
  let reads=0,settingsMigrated=false,resumePartial,signalPartial;
  const partialReached=new Promise(resolve=>{signalPartial=resolve});
  const partialBlocked=new Promise(resolve=>{resumePartial=resolve});
  const race={
    console,GSHEET_API_URL:url,GSHEET_KEY:'test-gsheet-url',
    _gsBootRestored:true,_gsPortfolioRestoreRequired:false,
    _gsCodeMasterSourceIdentity:sourceId, EDITABLE_PRICES:[],
    getGsheetConnectionGeneration:()=>11,
    _currentGsheetSyncTarget:()=>url,
    normalizeStockCode:c=>String(c||'').trim(),
    isGsheetConnectionCurrent:(u,g)=>u===url && g===11,
    isGsheetPortfolioWriteReady:()=>true,
    lsGet:(k,d)=>k in disk?structuredClone(disk[k]):d,
    lsSave:(k,v)=>{disk[k]=structuredClone(v)},
    lsRemove:k=>{delete disk[k]},
    requestGsheetActionJson:async action=>{
      assert.equal(action,'getCodeList');
      if (++reads===2){signalPartial();await partialBlocked}
      return {status:'ok',codeMasterSourceId:sourceId,codes:remote.map(x=>({...x}))};
    },
    requestGsheetFormJson:async (action,args)=>{
      assert.equal(action,'syncCodes');
      const expected=JSON.parse(args.expectedCodes);
      const replacements=JSON.parse(args.replacements);
      const metadata=JSON.parse(args.settingsReplacements||'[]');
      calls.push({expected:expected.map(x=>x.name),replacements,metadata,
        force:args.forceSettingsRebase});
      if(calls.length===1){
        assert.equal(expected[0].name,'A');
        assert.equal(replacements[0].previousName,'A');
        remote[0]={...remote[0],name:'B',code:'2'};
        return {status:'error',errorCode:'CODE_SYNC_SETTINGS_FAILED'};
      }
      if(calls.length===2){
        assert.equal(args.forceSettingsRebase,'1');
        assert.equal(metadata[0].previousName,'A');
        assert.equal(metadata[0].name,'B');
        return {status:'error',errorCode:'CODE_SYNC_SETTINGS_FAILED'};
      }
      if(calls.length===3){
        assert.equal(args.forceSettingsRebase,'1');
        assert.equal(expected[0].name,'B');
        assert.equal(metadata.length,1);
        assert.equal(metadata[0].previousName,'A');
        assert.equal(metadata[0].name,'B');
        assert.equal(replacements.length,0);
        settingsMigrated=true;
        return {status:'ok',updated:0};
      }
      if(calls.length===4 || calls.length===6){
        assert.equal(settingsMigrated,true,
          'persisted Settings A->B must be repaired before B->C mutation');
        assert.equal(expected[0].name,'B');
        assert.equal(replacements[0].previousName,'B');
        assert.equal(replacements[0].name,'C');
        remote[0]={...remote[0],name:'C',code:'3'};
        return {status:'ok',updated:1};
      }
      if(calls.length===5){
        assert.equal(args.forceSettingsRebase,'1');
        assert.equal(expected[0].name,'B');
        assert.equal(metadata[0].previousName,'A');
        assert.equal(metadata[0].name,'B');
        assert.equal(replacements.length,0);
        settingsMigrated=true;
        return {status:'ok',updated:0};
      }
      if(calls.length===7){
        assert.equal(expected[0].sector,'기타');
        assert.equal(replacements.length,0);
        assert.equal(JSON.parse(args.codes).C.sector,'헬스케어');
        remote[0].sector='헬스케어';
        return {status:'error',errorCode:'CODE_SYNC_SETTINGS_FAILED'};
      }
      if(calls.length===8){
        assert.equal(args.forceSettingsRebase,'1');
        assert.equal(metadata.length,1,'metadata-only repair must pass exact identity evidence');
        assert.equal(metadata[0].metadataOnly,true);
        assert.equal(metadata[0].name,'C');
        return {status:'error',errorCode:'CODE_SYNC_SETTINGS_FAILED'};
      }
      if(calls.length===9){
        assert.equal(args.forceSettingsRebase,'1');
        assert.equal(metadata.length,1,'durable marker must remain scoped to its own pair');
        assert.equal(metadata[0].metadataOnly,true);
        assert.equal(metadata[0].name,'C');
        assert.equal(expected[0].sector,'헬스케어');
        return {status:'ok',updated:0};
      }
      if(calls.length===10){
        assert.equal(replacements.length,0);
        assert.equal(JSON.parse(args.codes).C.sector,'헬스케어');
        return {status:'ok',updated:0};
      }
      assert.fail('unexpected duplicate code write '+calls.length);
    }
  };
  vm.createContext(race);
  vm.runInContext(ledgerSource.slice(first,last),race);
  vm.runInContext(syncProgram,race);
  const session={targetUrl:url,generation:11,sourceId};
  race.session=session;
  race.initialCodes=remote.map(x=>({...x}));
  vm.runInContext('applyGsheetCodeList(initialCodes, "sheet-1")',race);
  const edit=(name,code,previousName,previousCode)=>{
    race.EDITABLE_PRICES=[{name,code,type:'주식',sector:'기타',currency:'KRW',
      market:'KR',replaces:{name:previousName,code:previousCode}}];
    assert.equal(vm.runInContext('_recordSameTargetLocalCodeAddition(EDITABLE_PRICES[0],session)',race),true);
  };
  edit('B','2','A','1');
  const firstAttempt=vm.runInContext('syncCodesToGsheet()',race);
  await partialReached; // remote B, but A is still the local cached baseline
  edit('C','3','B','2');
  const nextAttempt=vm.runInContext('syncCodesToGsheet()',race);
  resumePartial();
  assert.equal(await firstAttempt,null,'first attempted Settings repair fails without claiming success');
  const outstanding=vm.runInContext(
    '_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,_gsCodeMasterSourceIdentity)',race);
  // Queue may already have consumed this debt before the await above. The
  // actual order is asserted on every POST below instead of a racy count.
  assert.equal(remote[0].name==='B'||remote[0].name==='C',true);
  assert.equal((await nextAttempt)?.status,'ok','queued edit resumes after debt repair');
  assert.equal(remote[0].name,'C');
  assert.equal(settingsMigrated,true);
  assert.equal(calls.length,4,'no duplicate A->B / B->C write');
  assert.equal(vm.runInContext(
    '_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,_gsCodeMasterSourceIdentity).length',race),0);
  assert.equal(vm.runInContext(
    '_getSameTargetLocalCodeAdditions(GSHEET_API_URL,_gsCodeMasterSourceIdentity).length',race),0);
  assert.ok(Object.keys(disk).every(k => !k.includes('settings_repairs') || !disk[k] ||
    !Array.isArray(disk[k][url]) || disk[k][url].length===0),
    'successful repair retires durable debt');
  // Simulate a hard restart at the narrow gap where A->B repair evidence
  // was durably saved but old A->C journal rebase had not yet persisted.
  // There are no in-memory confirmed transitions after restart.
  remote[0]={...remote[0],name:'B',code:'2'};
  race.initialCodes=remote.map(x=>({...x}));
  vm.runInContext('applyGsheetCodeList(initialCodes, "sheet-1")',race);
  vm.runInContext('_gsheetStockMasterConfirmedTransitions.clear();_gsheetStockMasterConfirmedSeq=0',race);
  edit('C','3','A','1');
  vm.runInContext('_rememberSameTargetCodeSettingsRepairs(GSHEET_API_URL,_gsCodeMasterSourceIdentity,[{previousName:"A",previousCode:"1",name:"B",code:"2"}])',race);
  settingsMigrated=false;
  assert.equal((await vm.runInContext('syncCodesToGsheet()',race))?.status,'ok',
    'restart must repair Settings A->B then rebase old A->C root to B->C');
  assert.equal(remote[0].name,'C');
  assert.equal(calls.length,6);
  assert.equal(vm.runInContext(
    '_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,_gsCodeMasterSourceIdentity).length',race),0);
  assert.equal(vm.runInContext(
    '_getSameTargetLocalCodeAdditions(GSHEET_API_URL,_gsCodeMasterSourceIdentity).length',race),0);
  // Metadata-only change has no replacement lineage. Failed Settings writes
  // still need a durable marker tied to the confirmed post-write master.
  race.EDITABLE_PRICES=[{name:'C',code:'3',type:'주식',
    sector:'헬스케어',currency:'KRW',market:'KR'}];
  assert.equal(await vm.runInContext('syncCodesToGsheet()',race),null);
  const metadataDebt=vm.runInContext(
    '_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,_gsCodeMasterSourceIdentity)',race);
  assert.equal(metadataDebt.length,1);
  assert.equal(metadataDebt[0].metadataOnly,true);
  assert.equal(metadataDebt[0].name,'C');
  assert.equal(remote[0].sector,'헬스케어');
  assert.equal((await vm.runInContext('syncCodesToGsheet()',race))?.status,'ok',
    'confirmed metadata-only partial commit repairs Settings before normal retry');
  assert.equal(calls.length,10);
  assert.equal(vm.runInContext(
    '_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,_gsCodeMasterSourceIdentity).length',race),0);
  console.log('✅ Settings 연속 실패·재시작·메타데이터 단독 부분 커밋 영속 복구 VM 통과');
}

// Codex P2: metadata-only B changes while Settings fails, but arbitrary
// first row A later disappears in another tab. The marker MUST identify B,
// and Bootstrap must reconcile the CURRENT same-workbook master without A.
{
  const data=fs.readFileSync('src/web/domain/portfolio/data.js','utf8');
  const start=data.indexOf('const PORTFOLIO_PENDING_CODE_ADDITIONS_KEY');
  const end=data.indexOf('function _normalizePendingExplicitEmptyTradeSync(',start);
  const js=sync.slice(0,sync.indexOf('// ★ v8.1'));
  const targetUrl='https://script.google.com/macros/s/metadata-debt/exec';
  const sourceId='sheet-metadata';
  const remote=[
    {name:'A',code:'1',type:'주식',sector:'기타',currency:'KRW',market:'KR'},
    {name:'B',code:'2',type:'주식',sector:'기타',currency:'KRW',market:'KR'}
  ];
  const disk={};
  let postCount=0;
  const session={
    console,GSHEET_API_URL:targetUrl,GSHEET_KEY:'url',
    _gsBootRestored:true,_gsPortfolioRestoreRequired:false,
    _gsCodeMasterSourceIdentity:sourceId,EDITABLE_PRICES:[],
    normalizeStockCode:s=>String(s||'').trim(),
    getGsheetConnectionGeneration:()=>6,
    isGsheetConnectionCurrent:(t,g)=>t===targetUrl&&g===6,
    isGsheetPortfolioWriteReady:()=>true,
    _currentGsheetSyncTarget:()=>targetUrl,
    lsGet:(key,otherwise)=>key in disk?structuredClone(disk[key]):otherwise,
    lsSave:(key,value)=>{disk[key]=structuredClone(value)},
    lsRemove:key=>{delete disk[key]},
    requestGsheetActionJson:async action=>{
      assert.equal(action,'getCodeList');
      return {status:'ok',codeMasterSourceId:sourceId,codes:remote.map(x=>({...x}))};
    },
    requestGsheetFormJson:async (action,params)=>{
      assert.equal(action,'syncCodes');
      postCount++;
      if(postCount===1){
        assert.equal(params.forceSettingsRebase,'');
        remote[1].sector='헬스케어';
        return {status:'error',errorCode:'CODE_SYNC_SETTINGS_FAILED'};
      }
      assert.equal(params.forceSettingsRebase,'1');
      assert.equal(JSON.parse(params.settingsReplacements).length,1,
        'confirmed metadata-only debt must be passed as exact scoped proof');
      assert.equal(JSON.parse(params.settingsReplacements)[0].metadataOnly,true);
      if(postCount===2) return {status:'error',errorCode:'CODE_SYNC_SETTINGS_FAILED'};
      assert.equal(postCount,3);
      assert.deepEqual(JSON.parse(params.expectedCodes).map(x=>x.name),['B'],
        'read-only Settings repair CAS uses revised master after A is deleted');
      assert.deepEqual(Object.keys(JSON.parse(params.codes)),['B']);
      return {status:'ok',updated:0};
    }
  };
  vm.createContext(session);
  vm.runInContext(data.slice(start,end),session);
  vm.runInContext(js,session);
  session.codes=remote.map(x=>({...x}));
  vm.runInContext('applyGsheetCodeList(codes,_gsCodeMasterSourceIdentity)',session);
  session.EDITABLE_PRICES=[
    {name:'A',code:'1',type:'주식',sector:'기타',currency:'KRW',market:'KR'},
    {name:'B',code:'2',type:'주식',sector:'헬스케어',currency:'KRW',market:'KR'}
  ];
  assert.equal(await vm.runInContext('syncCodesToGsheet()',session),null,
    'code update confirmed but Settings write and repair failed');
  const debt=vm.runInContext(
    '_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,_gsCodeMasterSourceIdentity)',session);
  assert.equal(debt.length,1);
  assert.equal(debt[0].name,'B','only modified B is evidence, not unrelated first A');
  assert.equal(debt[0].metadataOnly,true);
  assert.equal(remote[0].name,'A');
  remote.shift(); // Other tab legitimately deletes unrelated A.
  session.latest=remote.map(x=>({...x}));
  const result=await vm.runInContext(
    'repairPinnedSameTargetCodeSettingsBeforeRestore({targetUrl:GSHEET_API_URL,sourceId:_gsCodeMasterSourceIdentity,generation:6,masterCodes:latest})',
    session);
  assert.ok(result,'metadata repair must not stall after unrelated row deletion');
  assert.equal(postCount,3);
  assert.equal(vm.runInContext(
    '_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,_gsCodeMasterSourceIdentity).length',session),0,
    'verified repair retires stale metadata-only debt');
  assert.equal(remote.length,1);
  assert.equal(remote[0].name,'B');
  assert.equal(remote[0].sector,'헬스케어');

  // Legacy persisted PR #493 debt may still point to the arbitrary first A.
  // Its metadataOnly=true flag is not rename proof and must not stall recovery.
  vm.runInContext('_rememberSameTargetCodeSettingsRepairs(GSHEET_API_URL,_gsCodeMasterSourceIdentity,[{previousName:"A",previousCode:"1",name:"A",code:"1",metadataOnly:true}])',session);
  const oldDebt=vm.runInContext(
    '_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,_gsCodeMasterSourceIdentity)',session);
  assert.equal(oldDebt.length,1);
  // The actual bootstrap handler route is covered separately below.
  assert.equal(oldDebt[0].metadataOnly,true);
  console.log('✅ 메타데이터 부분커밋 실제 변경 종목 추적 및 타 탭 무관 삭제 후 동일 원본 복구 VM 통과');
}

// Codex P2: an immediate, successful metadata-only recovery must retire
// its entire durable proof after authoritative master readback, not leave
// a stale debt that can later prevent a read-only Bootstrap.
{
  const source=fs.readFileSync('src/web/domain/portfolio/data.js','utf8');
  const start=source.indexOf('const PORTFOLIO_PENDING_CODE_ADDITIONS_KEY');
  const end=source.indexOf('function _normalizePendingExplicitEmptyTradeSync(',start);
  const syncProgram=sync.slice(0,sync.indexOf('// ★ v8.1'));
  const url='https://script.google.com/macros/s/metadata-immediate/exec',sourceId='master-1';
  const remote=[{name:'A',code:'1',type:'주식',sector:'기타',currency:'KRW',market:'KR'}];
  const disk={};
  let calls=0;
  const session={
    console,GSHEET_API_URL:url,GSHEET_KEY:'url',
    _gsBootRestored:true,_gsPortfolioRestoreRequired:false,
    _gsCodeMasterSourceIdentity:sourceId,EDITABLE_PRICES:[],
    normalizeStockCode:c=>String(c||'').trim(),
    getGsheetConnectionGeneration:()=>7,
    isGsheetConnectionCurrent:(u,g)=>u===url && g===7,
    isGsheetPortfolioWriteReady:()=>true,_currentGsheetSyncTarget:()=>url,
    lsGet:(k,d)=>k in disk?structuredClone(disk[k]):d,
    lsSave:(k,v)=>{disk[k]=structuredClone(v)},lsRemove:k=>{delete disk[k]},
    requestGsheetActionJson:async action=>{
      assert.equal(action,'getCodeList');
      return {status:'ok',codeMasterSourceId:sourceId,codes:remote.map(x=>({...x}))};
    },
    requestGsheetFormJson:async (action,params)=>{
      assert.equal(action,'syncCodes');calls++;
      if(calls===1){
        assert.equal(params.forceSettingsRebase,'');
        remote[0].sector='헬스케어';
        return {status:'error',errorCode:'CODE_SYNC_SETTINGS_FAILED'};
      }
      assert.equal(calls,2);
      assert.equal(params.forceSettingsRebase,'1');
      assert.equal(JSON.parse(params.settingsReplacements).length,1);
      assert.equal(JSON.parse(params.settingsReplacements)[0].metadataOnly,true);
      return {status:'ok',updated:0};
    }
  };
  vm.createContext(session);
  vm.runInContext(source.slice(start,end),session);
  vm.runInContext(syncProgram,session);
  session.original=remote.map(x=>({...x}));
  vm.runInContext('applyGsheetCodeList(original,_gsCodeMasterSourceIdentity)',session);
  session.EDITABLE_PRICES=[{name:'A',code:'1',type:'주식',
    sector:'헬스케어',currency:'KRW',market:'KR'}];
  assert.equal((await vm.runInContext('syncCodesToGsheet()',session))?.status,'ok');
  assert.equal(calls,2,'one code update and one Settings-only repair');
  assert.equal(vm.runInContext(
    '_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,_gsCodeMasterSourceIdentity).length',session),0,
    'successful repair MUST retire metadataOnly proof');
  assert.ok(!Object.values(disk).some(value =>
    JSON.stringify(value).includes('"metadataOnly":true')),
    'durable storage has no stale successful metadata debt');
  session.latest=remote.map(x=>({...x}));
  assert.equal(await vm.runInContext(
    'repairPinnedSameTargetCodeSettingsBeforeRestore({targetUrl:GSHEET_API_URL,sourceId:_gsCodeMasterSourceIdentity,generation:7,masterCodes:latest})',session),
    null,'subsequent bootstrap has no unnecessary Settings writer');
  assert.equal(calls,2);
  console.log('✅ 성공한 메타데이터 단독 부분 커밋 부채 즉시 정리·재부팅 불필요 쓰기 제거');
}


{
  // Two browser tabs loaded before either made a stock edit. A writes C and
  // B writes D; the old whole-object localStorage journal lost whichever
  // write happened first. Separate exact-pair keys must survive even if a
  // stale tab subsequently overwrites the legacy aggregate snapshot.
  const ledger=fs.readFileSync('src/web/domain/portfolio/data.js','utf8');
  const begin=ledger.indexOf('const PORTFOLIO_PENDING_CODE_ADDITIONS_KEY');
  const end=ledger.indexOf('function _normalizePendingExplicitEmptyTradeSync(',begin);
  const backing=new Map();
  const storage={
    getItem:key=>backing.has(key)?backing.get(key):null,
    setItem:(key,value)=>backing.set(key,String(value)),
    removeItem:key=>backing.delete(key),
    key:i=>[...backing.keys()][i]||null,
    get length(){return backing.size;}
  };
  const url='https://script.google.com/macros/s/multitab/exec',sourceId='sheet-multi';
  const startTab=()=>{
    const ctx={
      console,localStorage:storage,GSHEET_API_URL:url,GSHEET_KEY:'url',
      _currentGsheetSyncTarget:()=>url,
      isStockMasterEditSessionCurrent:()=>true,
      normalizeStockCode:value=>String(value||'').trim(),
      lsGet:(k,d)=>{const v=storage.getItem(k);return v===null?d:JSON.parse(v)},
      lsSave:(k,v)=>storage.setItem(k,JSON.stringify(v)),
      lsRemove:k=>storage.removeItem(k)
    };
    vm.createContext(ctx);
    vm.runInContext(ledger.slice(begin,end),ctx);
    return ctx;
  };
  const tabA=startTab(),tabB=startTab();
  const add=(ctx,name,code,weight)=>
    vm.runInContext('_recordSameTargetLocalCodeAddition({name:'+JSON.stringify(name)+
      ',code:'+JSON.stringify(code)+',targetWeight:'+weight+
      ',notes:'+JSON.stringify(name+' memo')+'},{sourceId:'+JSON.stringify(sourceId)+'})',ctx);
  const current=ctx=>vm.runInContext(
    '_getSameTargetLocalCodeAdditions(GSHEET_API_URL,'+JSON.stringify(sourceId)+')',ctx);
  assert.equal(add(tabA,'C','3',25),true);
  assert.equal(add(tabB,'D','4',42),true);
  assert.deepEqual(current(tabA).map(x=>x.name).sort(),['C','D'],
    'tab A must see both independently persisted registrations');
  assert.deepEqual(current(tabB).map(x=>x.name).sort(),['C','D'],
    'tab B must not lose tab A provenance');
  vm.runInContext('lsSave(PORTFOLIO_PENDING_CODE_ADDITIONS_KEY,{[GSHEET_API_URL]:[{sourceId:'+JSON.stringify(sourceId)+',name:"D",code:"4"}]})',tabB);
  assert.deepEqual(current(startTab()).map(x=>x.name).sort(),['C','D'],
    'outdated whole-map write cannot clobber per-pair C');
  const addDebt=(ctx,name,code,weight)=>
    vm.runInContext('_rememberSameTargetCodeSettingsRepairs(GSHEET_API_URL,'+
      JSON.stringify(sourceId)+',[{previousName:'+JSON.stringify(name)+
      ',previousCode:'+JSON.stringify(code)+',name:'+JSON.stringify(name)+
      ',code:'+JSON.stringify(code)+',metadataOnly:true,userFields:{targetWeight:'+weight+
      ',notes:'+JSON.stringify(name+' memo')+'}}])',ctx);
  assert.equal(addDebt(tabA,'C','3',25),true);
  assert.equal(addDebt(tabB,'D','4',42),true);
  const debts=ctx=>vm.runInContext('_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,'+
    JSON.stringify(sourceId)+')',ctx);
  assert.deepEqual(debts(startTab()).map(x=>x.name).sort(),['C','D'],
    'two tabs must retain both independent Settings repair proofs');
  vm.runInContext('_forgetSameTargetLocalCodeAddition("D","4",GSHEET_API_URL,'+JSON.stringify(sourceId)+')',tabB);
  assert.deepEqual(current(startTab()).map(x=>x.name),['C'],
    'D tombstone removes only D and preserves C');
  vm.runInContext('_forgetSameTargetCodeSettingsRepairs(GSHEET_API_URL,'+
    JSON.stringify(sourceId)+',[{previousName:"C",previousCode:"3",name:"C",code:"3",metadataOnly:true}])',tabA);
  assert.deepEqual(debts(startTab()).map(x=>x.name),['D'],
    'C repair completion preserves unrelated D debt');
  // A stale V1 writer cannot resurrect D after its scoped tombstone.
  vm.runInContext('lsSave(PORTFOLIO_PENDING_CODE_ADDITIONS_KEY,{[GSHEET_API_URL]:[{sourceId:'+
    JSON.stringify(sourceId)+',name:"D",code:"4"}]})',tabA);
  assert.deepEqual(current(startTab()).map(x=>x.name),['C'],
    'tombstone masks stale legacy aggregate on fresh reload');
  assert.equal(current(startTab()).find(x=>x.name==='C').userFields.targetWeight,25);
  assert.equal(debts(startTab()).find(x=>x.name==='D').userFields.targetWeight,42);
  console.log('✅ 멀티탭 C/D 신규 저널·Settings 부채 개별 영속화, stale map·tombstone 충돌 방지');
}


{
  // P2: URL can be repointed to a different workbook. A successful
  // source-B deletion MUST NOT tombstone source-A's identical pair.
  const source=fs.readFileSync('src/web/domain/portfolio/data.js','utf8');
  const start=source.indexOf('const PORTFOLIO_PENDING_CODE_ADDITIONS_KEY');
  const stop=source.indexOf('function _normalizePendingExplicitEmptyTradeSync(',start);
  const disk=new Map(),url='https://script.google.com/macros/s/same-url/exec';
  const local={
    getItem:k=>disk.has(k)?disk.get(k):null,
    setItem:(k,v)=>disk.set(k,v),
    removeItem:k=>disk.delete(k),
    key:i=>[...disk.keys()][i]??null,
    get length(){return disk.size;}
  };
  const create=(storage=local)=> {
    const ctx={console,localStorage:storage,GSHEET_API_URL:url,
      _currentGsheetSyncTarget:()=>url,isStockMasterEditSessionCurrent:()=>true,
      normalizeStockCode:x=>String(x||'').trim(),
      lsGet:(k,d)=>{try {const val=storage.getItem(k);return val===null?d:JSON.parse(val)}catch(e){return d}},
      lsSave:(k,v)=>{try {storage.setItem(k,JSON.stringify(v))}catch(e){}},
      lsRemove:k=>{try{storage.removeItem(k)}catch(e){}}
    };
    vm.createContext(ctx);
    vm.runInContext(source.slice(start,stop),ctx);
    return ctx;
  };
  const tab=create();
  for(const sourceId of ['sheet-A','sheet-B']) {
    const ok=vm.runInContext('_recordSameTargetLocalCodeAddition({name:"C",code:"3",targetWeight:25},{sourceId:'+JSON.stringify(sourceId)+'})',tab);
    assert.equal(ok,true);
  }
  const get=id=>vm.runInContext('_getSameTargetLocalCodeAdditions(GSHEET_API_URL,'+JSON.stringify(id)+')',tab);
  assert.equal(get('sheet-A').length,1);
  assert.equal(get('sheet-B').length,1);
  vm.runInContext('_forgetSameTargetLocalCodeAddition("C","3",GSHEET_API_URL,"sheet-B")',tab);
  assert.equal(get('sheet-B').length,0,'current workbook pair retired');
  assert.equal(get('sheet-A').length,1,'other workbook provenance survives exact-pair deletion');
  assert.equal(get('sheet-A')[0].userFields.targetWeight,25);
  const restored=create();
  assert.equal(vm.runInContext('_getSameTargetLocalCodeAdditions(GSHEET_API_URL,"sheet-A").length',restored),1);
  assert.equal(vm.runInContext('_getSameTargetLocalCodeAdditions(GSHEET_API_URL,"sheet-B").length',restored),0);

  // Read failures in Storage getter / length / key must NOT crash startup.
  const security=()=>{throw new Error('SecurityError')};
  const brokenLength={getItem:security,setItem:security,removeItem:security,key:security,
    get length(){return security()}};
  const blocked=create(brokenLength);
  assert.equal(vm.runInContext('_getSameTargetLocalCodeAdditions(GSHEET_API_URL,"sheet-A").length',blocked),0);
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"E",code:"5"},{sourceId:"sheet-A"})',blocked),
    false,'blocked storage cannot authorize remote Code append');
  const brokenKey={getItem:()=>null,setItem:()=>{},removeItem:()=>{},key:security,
    get length(){return 1;}};
  const blockedKey=create(brokenKey);
  assert.equal(vm.runInContext('_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,"sheet-A").length',blockedKey),0);
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"E",code:"5"},{sourceId:"sheet-A"})',blockedKey),false);

  // Storage quota: setItem silently fails (lsSave swallows) and the journal
  // must be confirmed BEFORE any caller is permitted to POST Codes.
  const quota={getItem:()=>null,setItem:()=>{throw Error('QuotaExceededError')},
    removeItem:()=>{},key:()=>null,get length(){return 0;}};
  const full=create(quota);
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"C",code:"3",targetWeight:25},{sourceId:"sheet-Q"})',full),
    false,'no successful readback means fail closed');
  assert.equal(vm.runInContext(
    '_rememberSameTargetCodeSettingsRepairs(GSHEET_API_URL,"sheet-Q",'+
      '[{previousName:"C",previousCode:"3",name:"C",code:"3",metadataOnly:true}])',full),
    false,'Settings repair debt cannot be acknowledged without durable storage');

  // Self-review: failure to persist a per-pair tombstone cannot be
  // treated as confirmed deletion or resurrect stale proof after reload.
  const tDisk=new Map();let refuseWrites=false;
  const flaky={
    getItem:k=>tDisk.has(k)?tDisk.get(k):null,
    setItem:(k,v)=>{if(refuseWrites)throw Error('QuotaExceededError');tDisk.set(k,v)},
    removeItem:k=>{if(refuseWrites)throw Error('QuotaExceededError');tDisk.delete(k)},
    key:i=>[...tDisk.keys()][i]??null,
    get length(){return tDisk.size}
  };
  const tabFlaky=create(flaky);
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"T",code:"8"},{sourceId:"sheet-A"})',tabFlaky),true);
  refuseWrites=true;
  assert.equal(vm.runInContext(
    '_forgetSameTargetLocalCodeAddition("T","8",GSHEET_API_URL,"sheet-A")',tabFlaky),false);
  assert.equal(vm.runInContext(
    '_getSameTargetLocalCodeAdditions(GSHEET_API_URL,"sheet-A").length',tabFlaky),1,
    'failed tombstone must keep T recovery proof');
  refuseWrites=false;
  assert.equal(vm.runInContext(
    '_forgetSameTargetLocalCodeAddition("T","8",GSHEET_API_URL,"sheet-A")',tabFlaky),true);
  assert.equal(vm.runInContext(
    '_getSameTargetLocalCodeAdditions(GSHEET_API_URL,"sheet-A").length',create(flaky)),0);

  // A completed Settings-only CAS must not discard its durable debt when
  // the local tombstone write itself fails.
  assert.equal(vm.runInContext(
    '_rememberSameTargetCodeSettingsRepairs(GSHEET_API_URL,"sheet-A",'+
      '[{previousName:"T",previousCode:"8",name:"T",code:"8",metadataOnly:true,userFields:{targetWeight:45}}])',
      tabFlaky),true);
  refuseWrites=true;
  assert.equal(vm.runInContext(
    '_forgetSameTargetCodeSettingsRepairs(GSHEET_API_URL,"sheet-A",'+
      '[{previousName:"T",previousCode:"8",name:"T",code:"8",metadataOnly:true}])',
      tabFlaky),false,'failed Settings tombstone must be reported');
  assert.equal(vm.runInContext(
    '_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,"sheet-A").length',create(flaky)),1);
  refuseWrites=false;
  assert.equal(vm.runInContext(
    '_forgetSameTargetCodeSettingsRepairs(GSHEET_API_URL,"sheet-A",'+
      '[{previousName:"T",previousCode:"8",name:"T",code:"8",metadataOnly:true}])',
      tabFlaky),true);
  assert.equal(vm.runInContext(
    '_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,"sheet-A").length',create(flaky)),0);

  // P2: A->B journal is durable, B->C is staged, but the preceding B
  // tombstone hits QuotaExceededError AFTER the new C key was saved.
  // The transition must return false and rollback C, not resurrect both
  // A->B and A->C in a restarted tab.
  const pairDisk=new Map();
  let rejectPriorTombstone=true;
  const pairStorage={
    getItem:k=>pairDisk.has(k)?pairDisk.get(k):null,
    setItem:(k,v)=>{
      const value=JSON.parse(v);
      if(rejectPriorTombstone && value?.removed===true
          && value?.entry?.name==='B') throw Error('QuotaExceededError');
      pairDisk.set(k,v);
    },
    removeItem:k=>pairDisk.delete(k),
    key:i=>[...pairDisk.keys()][i]??null,
    get length(){return pairDisk.size}
  };
  const pairTab=create(pairStorage);
  const viewPair=ctx=>vm.runInContext(
    '_getSameTargetLocalCodeAdditions(GSHEET_API_URL,"sheet-A")',ctx);
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"B",code:"2",replaces:{name:"A",code:"1"}},{sourceId:"sheet-A"})',
    pairTab),true);
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"C",code:"3",replaces:{name:"B",code:"2"}},{sourceId:"sheet-A"})',
    pairTab),false,'failed predecessor tombstone must reject chained edit');
  assert.deepEqual(viewPair(create(pairStorage)).map(x=>x.name),['B'],
    'partially staged C must be rolled back; predecessor B stays authorized');
  assert.deepEqual(viewPair(pairTab).map(x=>x.name),['B'],
    'failed write cannot publish an uncommitted edit in memory');
  rejectPriorTombstone=false;
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"C",code:"3",replaces:{name:"B",code:"2"}},{sourceId:"sheet-A"})',
    pairTab),true);
  assert.deepEqual(viewPair(create(pairStorage)).map(x=>x.name),['C'],
    'verified tombstone retires B after retry');
  assert.equal(viewPair(create(pairStorage))[0].replaces.name,'A',
    'replacement still proves original A, not intermediate B');
  // SecurityError can prevent rollback deletion as well as predecessor
  // tombstone. Durable C stays staged on disk, but cannot be authoritative
  // until B has a CONFIRMED durable tombstone. Never recover both.
  const interrupted=new Map();
  let rejectB=true, rejectRemoveC=true;
  const unsafeStorage={
    getItem:k=>interrupted.get(k)??null,
    setItem:(k,v)=>{
      const value=JSON.parse(v);
      if(rejectB && value?.removed===true && value?.entry?.name==='B')
        throw Error('QuotaExceededError');
      interrupted.set(k,v);
    },
    removeItem:k=>{
      if(rejectRemoveC && decodeURIComponent(k).includes('"C","3"'))
        throw Error('SecurityError');
      interrupted.delete(k);
    },
    key:i=>[...interrupted.keys()][i]??null,
    get length(){return interrupted.size}
  };
  const unsafeTab=create(unsafeStorage);
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"B",code:"2",replaces:{name:"A",code:"1"}},{sourceId:"sheet-A"})',
    unsafeTab),true);
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"C",code:"3",replaces:{name:"B",code:"2"}},{sourceId:"sheet-A"})',
    unsafeTab),false);
  assert.deepEqual(viewPair(create(unsafeStorage)).map(x=>x.name),['B'],
    'even failed rollback cannot expose an uncommitted C alongside B');
  assert.equal(interrupted.size>=2,true,'staged C remains physically durable');
  rejectB=false;rejectRemoveC=false;
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"C",code:"3",replaces:{name:"B",code:"2"}},{sourceId:"sheet-A"})',
    unsafeTab),true);
  assert.deepEqual(viewPair(create(unsafeStorage)).map(x=>x.name),['C'],
    'verified predecessor tombstone activates previously staged C');
  // NEW Codex P2: a failed C write must NOT be activated by a later,
  // unrelated in-flight A->B sync retiring B. The previous implementation
  // used the B tombstone alone as implicit consent to activate staged C.
  const delayed=new Map();let failB=true,failDeleteC=true;
  const delayedStore={
    getItem:k=>delayed.get(k)??null,
    setItem:(k,v)=>{
      const value=JSON.parse(v);
      if(failB && value?.removed===true && value?.entry?.name==='B')
        throw Error('QuotaExceededError');
      delayed.set(k,v);
    },
    removeItem:k=>{
      if(failDeleteC && decodeURIComponent(k).includes('"C","3"'))
        throw Error('SecurityError');
      delayed.delete(k);
    },
    key:i=>[...delayed.keys()][i]??null,
    get length(){return delayed.size}
  };
  const inFlight=create(delayedStore);
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"B",code:"2",replaces:{name:"A",code:"1"}},{sourceId:"sheet-A"})',
    inFlight),true);
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"C",code:"3",replaces:{name:"B",code:"2"}},{sourceId:"sheet-A"})',
    inFlight),false);
  assert.deepEqual(viewPair(create(delayedStore)).map(x=>x.name),['B']);
  const stagedRecord=[...delayed.values()].map(x=>JSON.parse(x))
    .find(x=>x?.entry?.name==='C');
  assert.equal(stagedRecord?.entry?.transitionCommitted,false,
    'failed C transition must remain uncommitted even if rollback also fails');
  failB=false;
  // The server confirmed A->B independently; retire B as a different
  // operation without explicitly authorizing the rejected B->C edit.
  assert.equal(vm.runInContext(
    '_forgetSameTargetLocalCodeAddition("B","2",GSHEET_API_URL,"sheet-A")',
    inFlight),true);
  assert.equal(viewPair(create(delayedStore)).length,0,
    'unrelated B tombstone MUST NOT resurrect rejected staged C');
  failDeleteC=false;
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"C",code:"3",replaces:{name:"B",code:"2"}},{sourceId:"sheet-A"})',
    inFlight),true,
    'only a NEW explicit user-authorized retry may activate C');
  assert.deepEqual(viewPair(create(delayedStore)).map(x=>x.name),['C']);
  assert.equal(viewPair(create(delayedStore))[0].replaces.name,'B');
  console.log('✅ 실패한 C는 무관한 B tombstone에 사후 활성화되지 않으며 명시적 재시도만 허용');

  console.log('✅ tombstone·롤백 동시 거부에도 준비 C 비활성 유지, 재시도 시 단일 C 활성');

  console.log('✅ 연속 A→B→C 선행 tombstone Quota 장애 실패·롤백·재시도 후 복구');

  // Fault matrix: inject each possible setItem failure in a chained
  // B->C transition (stage C, tombstone B, promote C, legacy mirror). A
  // failed operation must never expose C, even if B is retired separately.
  // Mirror failure is tolerated because the authoritative v2 pair is read back.
  for(const failAt of [0,1,2,3,4]) {
    for(const failRollback of [false,true]) {
      const diskMap=new Map();
      let writes=0,inject=false;
      const injectedStorage={
        getItem:k=>diskMap.has(k)?diskMap.get(k):null,
        setItem:(k,v)=>{
          if(inject && ++writes===failAt)throw Error('QuotaExceededError');
          diskMap.set(k,v);
        },
        removeItem:k=>{
          if(inject && failRollback && decodeURIComponent(k).includes('"C","3"'))
            throw Error('SecurityError');
          diskMap.delete(k);
        },
        key:i=>[...diskMap.keys()][i]??null,
        get length(){return diskMap.size}
      };
      const tab=create(injectedStorage);
      const makeB='_recordSameTargetLocalCodeAddition({name:"B",code:"2",replaces:{name:"A",code:"1"}},{sourceId:"sheet-A"})';
      const makeC='_recordSameTargetLocalCodeAddition({name:"C",code:"3",replaces:{name:"B",code:"2"}},{sourceId:"sheet-A"})';
      assert.equal(vm.runInContext(makeB,tab),true);
      inject=true;
      const accepted=vm.runInContext(makeC,tab);
      assert.equal(accepted,failAt===0 || failAt===4,
        'failAt='+failAt+', blocked rollback='+failRollback);
      const reboot=create(injectedStorage);
      const visible=viewPair(reboot);
      assert.equal(visible.some(x=>x.name==='C'),accepted,
        'never expose a failed C from durable journal');
      if(!accepted){
        inject=false;
        assert.equal(vm.runInContext(
          '_forgetSameTargetLocalCodeAddition("B","2",GSHEET_API_URL,"sheet-A")',
          reboot),true);
        assert.equal(viewPair(create(injectedStorage)).some(x=>x.name==='C'),false,
          'independent B retirement cannot activate a rejected staged C');
      }
    }
  }
  console.log('✅ 연속교체 영속 쓰기 4지점·롤백 거부 10개 장애 조합 안전성 회귀');

  // Codex P2: peer commits A->B just after C is written in prepared state.
  // A different tab has retired the predecessor and C's inherited A root is
  // stale. The local edit must fail closed instead of promoting stale A->C.
  const externalDisk=new Map();let peerDuringPrepare=true;
  const crossTabStorage={
    getItem:k=>externalDisk.get(k)??null,
    setItem:(k,v)=>{
      externalDisk.set(k,v);
      const payload=JSON.parse(v);
      if(peerDuringPrepare && payload?.entry?.name==='C'
          && payload?.entry?.transitionCommitted===false) {
        peerDuringPrepare=false;
        // Another tab's confirmed A->B write: its B journal was retired
        // while this tab had only staged C. Direct disk mutation models
        // the interleaving precisely between two localStorage API calls.
        for(const [priorKey,priorJson] of externalDisk) {
          const prior=JSON.parse(priorJson);
          if(prior?.entry?.name==='B' && prior?.entry?.sourceId==='sheet-A')
            externalDisk.set(priorKey,JSON.stringify({...prior,removed:true}));
        }
      }
    },
    removeItem:k=>externalDisk.delete(k),
    key:i=>[...externalDisk.keys()][i]??null,
    get length(){return externalDisk.size}
  };
  const raceTab=create(crossTabStorage);
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"B",code:"2",replaces:{name:"A",code:"1"}},{sourceId:"sheet-A"})',
    raceTab),true);
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"C",code:"3",replaces:{name:"B",code:"2"}},{sourceId:"sheet-A"})',
    raceTab),false,'peer B retirement during C preparation must reject stale-root edit');
  assert.equal(viewPair(create(crossTabStorage)).length,0,
    'rejected C is not promoted, and peer-retired B remains retired');
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"C",code:"3",replaces:{name:"B",code:"2"}},{sourceId:"sheet-A"})',
    raceTab),true,'explicit retry can register B->C using the new root');
  assert.equal(viewPair(create(crossTabStorage))[0].replaces.name,'B',
    'never retain stale A root after a confirmed external B retirement');

  // A competing B tombstone AFTER this edit committed cannot impersonate
  // its transition token. The now-orphaned C must fail closed on Bootstrap.
  const independent=new Map();
  const independentStore={
    getItem:k=>independent.get(k)??null,
    setItem:(k,v)=>independent.set(k,v),
    removeItem:k=>independent.delete(k),
    key:i=>[...independent.keys()][i]??null,
    get length(){return independent.size}
  };
  const independentTab=create(independentStore);
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"B",code:"2",replaces:{name:"A",code:"1"}},{sourceId:"sheet-A"})',
    independentTab),true);
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"C",code:"3",replaces:{name:"B",code:"2"}},{sourceId:"sheet-A"})',
    independentTab),true);
  assert.deepEqual(viewPair(create(independentStore)).map(x=>x.name),['C']);
  for(const [priorKey,priorJson] of independent) {
    const prior=JSON.parse(priorJson);
    if(prior?.entry?.name==='B') independent.set(priorKey,
      JSON.stringify({target:prior.target,entry:prior.entry,removed:true}));
  }
  assert.equal(viewPair(create(independentStore)).length,0,
    'peer tombstone lacking matching token must not authorize stale C');
  // Codex P2 at previous lines 843-851: between preflight read and the
  // attempted B retirement write, another tab commits A->B and tombstones
  // the SAME B key. V3 must never overwrite the peer's v2 tombstone.
  const racedDisk=new Map();let retireRace=true;
  const retirementStore={
    getItem:k=>racedDisk.get(k)??null,
    setItem:(k,v)=>{
      const data=JSON.parse(v);
      if(retireRace && data?.entry?.name==='B' && data?.removed===true
          && data?.retiredBy && k.startsWith('pf_code_retirement_v3:')){
        retireRace=false;
        for(const[pairKey,pairJson]of racedDisk){
          if(!pairKey.startsWith('pf_code_journal_pair_v2:'))continue;
          const record=JSON.parse(pairJson);
          if(record?.entry?.name==='B' && record.entry.sourceId==='sheet-A')
            racedDisk.set(pairKey,JSON.stringify({...record,removed:true}));
        }
      }
      racedDisk.set(k,v);
    },
    removeItem:k=>racedDisk.delete(k),
    key:i=>[...racedDisk.keys()][i]??null,
    get length(){return racedDisk.size}
  };
  const peer=create(retirementStore);
  const makeTransitionB='_recordSameTargetLocalCodeAddition({name:"B",code:"2",replaces:{name:"A",code:"1"}},{sourceId:"sheet-A"})';
  const makeTransitionC='_recordSameTargetLocalCodeAddition({name:"C",code:"3",replaces:{name:"B",code:"2"}},{sourceId:"sheet-A"})';
  assert.equal(vm.runInContext(makeTransitionB,peer),true);
  assert.equal(vm.runInContext(makeTransitionC,peer),false,
    'peer B commit during retirement write must abort C transition');
  assert.equal(retireRace,false,'race must be triggered at exact B claim save');
  assert.equal(viewPair(create(retirementStore)).some(x=>x.name==='C'),false,
    'reboot must never adopt stale A->C after independent A->B commit');
  const peerB=[...racedDisk].filter(([k])=>k.startsWith('pf_code_journal_pair_v2:'))
    .map(([k,v])=>JSON.parse(v)).find(x=>x.entry?.name==='B');
  assert.equal(peerB?.removed,true,'other tab B tombstone must never be overwritten');
  // A separate transition's claim also cannot change that pair's v2 bytes.
  assert.ok([...racedDisk.keys()].some(k=>k.startsWith('pf_code_retirement_v3:')),
    'write-ahead retirement claims are independently keyed');
  console.log('✅ P2 B 선행 검증 후 실제 tombstone 쓰기 경합에서 peer 완료 보호·C 차단');

  // Simultaneous independent C and D successor tokens cannot both retire B.
  const competing=new Map(),store={
    getItem:k=>competing.get(k)??null,
    setItem:(k,v)=>competing.set(k,v),
    removeItem:k=>competing.delete(k),
    key:i=>[...competing.keys()][i]??null,
    get length(){return competing.size}
  };
  const contestedTab=create(store);
  assert.equal(vm.runInContext(makeTransitionB,contestedTab),true);
  assert.equal(vm.runInContext(makeTransitionC,contestedTab),true);
  const activeC=viewPair(create(store))[0];
  const tokenC=activeC.transitionId;
  const retirementPrefix='pf_code_retirement_v3:';
  const original=[...competing].map(([k,v])=>({k,v:JSON.parse(v)}))
    .find(x=>x.k.startsWith(retirementPrefix) && x.v?.entry?.name==='B');
  assert.ok(original && tokenC);
  const competingToken='independent-D-claim';
  const candidateD={...activeC,name:'D',code:'4',transitionId:competingToken,
    requiresTombstones:[{name:'B',code:'2'}],transitionCommitted:true};
  const addKey='pf_code_journal_pair_v2:'+encodeURIComponent(
    JSON.stringify([original.v.target,'sheet-A','D','4']));
  competing.set(addKey,JSON.stringify({target:original.v.target,entry:candidateD,removed:false}));
  const claimKey=retirementPrefix+encodeURIComponent(
    JSON.stringify([original.v.target,'sheet-A','B','2',competingToken]));
  competing.set(claimKey,JSON.stringify({...original.v,retiredBy:competingToken}));
  assert.deepEqual(viewPair(create(store)).map(x=>x.name),['B'],
    'ambiguous successor claims fail closed and leave predecessor visible');
  // A->B remote commit/readback rebases an already accepted local C
  // from root A to B. Retiring the now-confirmed B journal must NOT erase C.
  const completedDisk=new Map(),completedStorage={
    getItem:k=>completedDisk.get(k)??null,
    setItem:(k,v)=>completedDisk.set(k,v),
    removeItem:k=>completedDisk.delete(k),
    key:i=>[...completedDisk.keys()][i]??null,
    get length(){return completedDisk.size}
  };
  const rebasedTab=create(completedStorage);
  assert.equal(vm.runInContext(makeTransitionB,rebasedTab),true);
  assert.equal(vm.runInContext(makeTransitionC,rebasedTab),true);
  assert.equal(viewPair(create(completedStorage))[0].replaces.name,'A');
  rebasedTab.confirmedServer=[{previousName:'A',previousCode:'1',name:'B',code:'2'}];
  assert.equal(vm.runInContext(
    '_rebaseConfirmedSameTargetCodeReplacements(GSHEET_API_URL,"sheet-A",confirmedServer)',
    rebasedTab),true);
  assert.equal(viewPair(create(completedStorage)).find(x=>x.name==='C')?.replaces.name,'B',
    'C uses the newly confirmed B root during the transient cleanup window');
  assert.equal(vm.runInContext(
    '_forgetSameTargetLocalCodeAddition("B","2",GSHEET_API_URL,"sheet-A")',
    rebasedTab),true);
  const afterRetire=viewPair(create(completedStorage));
  assert.equal(afterRetire.length,1,'server-rebased C survives B journal retirement');
  assert.equal(afterRetire[0].name,'C');
  assert.equal(afterRetire[0].replaces.name,'B',
    'future sync must use B as the verified server source, not obsolete A');
  assert.equal(afterRetire[0].transitionCommitted,undefined,
    'server-confirmed rebase must release obsolete pending transition guard');
  console.log('✅ 확정 A→B 원본 재기준화 후 B 저널 폐기에도 C→B 복구 근거 유지');

  // Codex P2: after server C is confirmed the syncer retires C's local
  // journal. Its completed immutable B claim must still suppress obsolete B.
  const completedAfterSync=new Map(),syncedStorage={
    getItem:k=>completedAfterSync.get(k)??null,
    setItem:(k,v)=>completedAfterSync.set(k,v),
    removeItem:k=>completedAfterSync.delete(k),
    key:i=>[...completedAfterSync.keys()][i]??null,
    get length(){return completedAfterSync.size}
  };
  const syncedTab=create(syncedStorage);
  assert.equal(vm.runInContext(makeTransitionB,syncedTab),true);
  assert.equal(vm.runInContext(makeTransitionC,syncedTab),true);
  assert.deepEqual(viewPair(create(syncedStorage)).map(x=>x.name),['C']);
  assert.equal(vm.runInContext(
    '_forgetSameTargetLocalCodeAddition("C","3",GSHEET_API_URL,"sheet-A")',
    syncedTab),true);
  assert.equal(viewPair(create(syncedStorage)).length,0,
    'confirmed C retirement must not resurrect an obsolete A->B journal');
  const retiredNames=[...completedAfterSync.values()].map(v=>JSON.parse(v))
    .filter(v=>v.entry?.name==='C' && v.removed===true);
  assert.equal(retiredNames.length,1,'completed C tombstone is durable');
  console.log('✅ 서버 확정 C 저널 tombstone 후에도 과거 B 복구 근거 비활성 유지');

  console.log('✅ 동시 C·D 전환 주장 시 원본 B 유지 및 두 후속 교체 모두 차단');

  console.log('✅ 준비 C 도중 별도 A→B 확정 경합 차단·재시도 루트 B·tombstone 출처 격리');

  // Legacy v1 journal must be migrated to per-pair storage before network sync.
  const old=create();
  const legacy={sourceId:'old-book',name:'M',code:'7',userFields:{targetWeight:35}};
  vm.runInContext('lsSave(PORTFOLIO_PENDING_CODE_ADDITIONS_KEY,{[GSHEET_API_URL]:[legacy]})',
    Object.assign(old,{legacy}));
  old.items=[{name:'M',code:'7',targetWeight:35}];
  assert.equal(vm.runInContext('_refreshSameTargetPendingAppendFields(GSHEET_API_URL,"old-book",items)',old),true);
  assert.equal(vm.runInContext(
    '_getSameTargetLocalCodeAdditions(GSHEET_API_URL,"old-book").length',create()),1);
  // Existing pre-upgrade A/1->N/8 replacement is equally crash-sensitive.
  // It must be migrated even though it is NOT an authorized new append.
  const replace={sourceId:'old-book',name:'N',code:'8',type:'주식',
    replaces:{name:'A',code:'1'}};
  old.legacyReplacements=[legacy,replace];
  vm.runInContext('lsSave(PORTFOLIO_PENDING_CODE_ADDITIONS_KEY,{[GSHEET_API_URL]:legacyReplacements})',old);
  old.items=[{name:'M',code:'7',targetWeight:35},{name:'N',code:'8'}];
  assert.equal(vm.runInContext(
    '_refreshSameTargetPendingAppendFields(GSHEET_API_URL,"old-book",items)',old),true,
    'legacy replacement must be made durable before any Codes POST');
  vm.runInContext('lsSave(PORTFOLIO_PENDING_CODE_ADDITIONS_KEY,{[GSHEET_API_URL]:[legacy]})',old);
  const newBrowser=create();
  const confirmed=vm.runInContext('_getSameTargetLocalCodeAdditions(GSHEET_API_URL,"old-book")',newBrowser);
  assert.equal(confirmed.length,2,'stale v1 whole-map overwrite cannot erase migrated A->N proof');
  assert.equal(confirmed.find(x=>x.name==='N').replaces.name,'A');
  assert.equal(confirmed.find(x=>x.name==='N').replaces.code,'1');
  // A->B remote commit may race with a newer A->C edit. A quota failure
  // during rebasing A->C to B->C must leave both in-memory and on-disk
  // provenance at A until a verified retry succeeds.
  const rebasing=create(flaky);
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition({name:"C",code:"3",replaces:{name:"A",code:"1"}},{sourceId:"sheet-A"})',rebasing),true);
  rebasing.confirmed=[{previousName:'A',previousCode:'1',name:'B',code:'2'}];
  refuseWrites=true;
  assert.equal(vm.runInContext(
    '_rebaseConfirmedSameTargetCodeReplacements(GSHEET_API_URL,"sheet-A",confirmed)',rebasing),false,
    'QuotaExceededError must be returned by confirmed-root rebase');
  const pending=ctx=>vm.runInContext(
    '_getSameTargetLocalCodeAdditions(GSHEET_API_URL,"sheet-A").find(x=>x.name==="C")?.replaces?.name',ctx);
  assert.equal(pending(rebasing),'A','failed rebase leaves in-memory journal unchanged');
  assert.equal(pending(create(flaky)),'A','failed rebase does not invent durable B->C proof');
  refuseWrites=false;
  assert.equal(vm.runInContext(
    '_rebaseConfirmedSameTargetCodeReplacements(GSHEET_API_URL,"sheet-A",confirmed)',rebasing),true);
  assert.equal(pending(create(flaky)),'B','retry stores verified B->C root for next Bootstrap');
  console.log('✅ 서버 A→B 확정 후 후속 A→C 저널 재기준화 Quota 실패·원본 보존·재시도');

  // Execute the real smSave guard, not an approximation: code->no-code
  // conversion must stop before mutating EDITABLE_PRICES or scheduling GAS.
  const management=fs.readFileSync('src/web/features/master/stock/mgmt_stock.js','utf8');
  const handlerStart=management.indexOf('async function smSave(idx) {');
  const handlerEnd=management.indexOf('\n}\n',handlerStart)+2;
  assert.ok(handlerStart>0 && handlerEnd>handlerStart);
  const displayed=[];
  const vmEditor={
    console,
    preventUnsafeStockMasterEdit:()=>false,
    captureStockMasterEditSession:()=>({targetUrl:'https://script.google.com/macros/s/test/exec',sourceId:'sheet-A'}),
    normalizeStockCode:c=>String(c||'').trim(),
    EDITABLE_PRICES:[{name:'C',code:'000003',assetType:'TDF',sector:'기타'}],
    document:{querySelector:selector=>{
      if(selector.includes('sm-name-inp'))return {value:'C'};
      if(selector.includes('sm-code-inp'))return {value:''};
      if(selector.includes('sm-type-sel'))return {value:'TDF'};
      if(selector.includes('sm-sec-sel'))return {value:'기타'};
      if(selector.includes('sm-cur-sel'))return {value:'KRW'};
      if(selector.includes('sm-market-sel'))return {value:''};
      return null;
    }},
    _smIsCustomCodeType:type=>type==='TDF',
    _smFindDuplicateCode:()=>null,
    _smValidateListedCode:async()=>({ok:true}),
    isStockMasterEditSessionCurrent:()=>true,
    _getSameTargetLocalCodeAdditions:()=>[],
    deleteStockMasterCodeAfterPendingWrites:async()=>true,
    _forgetSameTargetLocalCodeAddition:()=>false,
    showMgmtMsg:(...args)=>displayed.push(args),
    rawTrades:[{name:'C',code:'000003'}],
    STOCK_CODE:{C:'000003'}
  };
  vm.createContext(vmEditor);
  vm.runInContext(management.slice(handlerStart,handlerEnd),vmEditor);
  assert.equal(await vm.runInContext('smSave(0)',vmEditor),false);
  assert.equal(vmEditor.EDITABLE_PRICES[0].code,'000003');
  assert.equal(vmEditor.rawTrades[0].code,'000003');
  assert.equal(vmEditor.STOCK_CODE.C,'000003');
  assert.ok(displayed.some(args=>String(args[1]).includes('복구 이력')));
  console.log('✅ 생산 smSave 종목코드 제거 tombstone 실패 시 기초정보·거래원장 변경 0');

  console.log('✅ 원본별 tombstone 실패 차단·저장보안·Quota·v1 신규/교체 이관 검증');
}


{
  // Production smSave + production queued CAS delete. A fund/TDF conversion
  // must NOT pretend the old coded row vanished via append-only syncCodes.
  const stockCode=fs.readFileSync('src/web/features/master/stock/mgmt_stock.js','utf8');
  const syncCode=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
  const start=stockCode.indexOf('async function smSave(idx) {');
  const end=stockCode.indexOf('\n}\n',start)+2;
  const queueStart=syncCode.indexOf('const _gsheetStockMasterWriteQueues = new Map()');
  const queueEnd=syncCode.indexOf('// Track ONLY successful same-window',queueStart);
  assert.ok(start>=0&&end>start&&queueStart>=0&&queueEnd>queueStart);
  const make=(config={})=>{
    const remote=[{name:'펀드 전환',code:'001234',type:'주식',
      sector:'기타',currency:'KRW',market:'KR'}];
    if(config.noRemote)remote.splice(0);
    const remoteSettings=[{name:'펀드 전환',code:'001234',assetType:'주식',
      sector:'기타',currency:'KRW',market:'KR',targetWeight:37,notes:'original notes',
      customFlags:{serverOnly:true}}];
    let calls=[],saved=0,queued=0,notices=[];
    const item={name:'펀드 전환',code:'001234',assetType:'주식',
      sector:'기타',currency:'KRW',market:'KR',targetWeight:12,notes:'stale client note'};
    const fields={name:'펀드 전환',code:'',type:'펀드',sector:'기타',
      currency:'KRW',market:'KR'};
    const inputMap={
      'sm-name-inp':()=>fields.name,'sm-code-inp':()=>fields.code,
      'sm-type-sel':()=>fields.type,'sm-sec-sel':()=>fields.sector,
      'sm-cur-sel':()=>fields.currency,'sm-market-sel':()=>fields.market
    };
    let generation=5;
    const ctx={
      console,GSHEET_API_URL:config.localOnly ? '' : 'https://script.google.com/macros/s/codeless/exec',
      _gsCodeMasterSourceIdentity:config.localOnly ? '' : 'sheet-A',
      _gsheetCodeListSourceId:'sheet-A',
      _gsheetCodeList:config.noRemote?[]:remote.map(x=>({...x})),
      getGsheetConnectionGeneration:()=>generation,
      isGsheetConnectionCurrent:(url,gen)=>url===ctx.GSHEET_API_URL&&gen===generation,
      isStockMasterWriteBlocked:()=>false,
      captureStockMasterEditSession:()=>({targetUrl:ctx.GSHEET_API_URL,generation,
        sourceId:ctx._gsCodeMasterSourceIdentity}),
      preventUnsafeStockMasterEdit:()=>false,
      normalizeStockCode:x=>String(x||'').trim(),
      _normalizeSyncCode:x=>String(x||'').trim(),
      EDITABLE_PRICES:[item],rawTrades:[],rawHoldings:[],savedPrices:{},
      savedPriceDates:{},STOCK_CODE:{'펀드 전환':'001234'},
      document:{querySelector:sel=>{
        for(const [k,read] of Object.entries(inputMap))
          if(sel.includes(k))return {value:read()};
        return null;
      }},
      _smIsCustomCodeType:t=>t==='펀드'||t==='TDF',
      _smFindDuplicateCode:()=>null,
      _smValidateListedCode:async()=>({ok:true}),
      _getSameTargetLocalCodeAdditions:()=>config.pendingReplacement?
        [{name:'펀드 전환',code:'001234',replaces:{name:'A',code:'1'}}]
        : (config.pendingNew?[{name:'펀드 전환',code:'001234',userFields:{notes:'new'}}]:[]),
      _forgetSameTargetLocalCodeAddition:()=>true,
      showMgmtMsg:(...parts)=>notices.push(parts),
      syncHoldingsFromTrades:()=>{},
      saveHoldings:()=>{saved++},
      queueMgmtGsheetSync:()=>{queued++},
      $el:()=>null,_mgmtRefresh:()=>{},
      applyGsheetCodeList:()=>{},
      requestGsheetActionJson:async action=>{
        calls.push(action);
        if(action==='getSettings')return {status:'ok',settings:{
          EDITABLE_PRICES:remoteSettings.map(x=>({...x}))
        }};
        assert.equal(action,'getCodeList');
        return {status:'ok',codeMasterSourceId:'sheet-A',codes:remote.map(x=>({...x}))};
      },
      requestGsheetFormJson:async(action,params)=>{
        calls.push(action);
        assert.equal(action,'deleteUnreferencedCode');
        const payload=JSON.parse(params.data);
        assert.equal(payload.expectedSourceId,'sheet-A');
        assert.equal(payload.name,'펀드 전환');
        assert.equal(payload.code,'001234');
        assert.deepEqual(payload.expectedCodes.map(x=>x.code),['001234']);
        assert.equal(payload.conversion?.name,'펀드 전환');
        assert.equal(payload.conversion?.code,'');
        assert.equal(payload.conversion?.assetType,'펀드');
        if(config.referenced)return {status:'error',errorCode:'CODE_DELETE_REFERENCED'};
        remote.splice(0,remote.length);
        remoteSettings.splice(0,remoteSettings.length,{
          ...remoteSettings[0],name:payload.conversion.name,code:'',
          assetType:payload.conversion.assetType,sector:payload.conversion.sector,
          currency:payload.conversion.currency,market:payload.conversion.market
        });
        if(config.crashAfterRemoteCommit) return {status:'error',errorCode:'SIMULATED_RESPONSE_LOST'};
        return {status:'ok',deleted:1};
      }
    };
    vm.createContext(ctx);
    const currentStart=syncCode.indexOf('function isStockMasterEditSessionCurrent(session) {');
    const currentEnd=syncCode.indexOf('function preventUnsafeStockMasterEdit()',currentStart);
    assert.ok(currentStart>=0 && currentEnd>currentStart);
    vm.runInContext(syncCode.slice(currentStart,currentEnd),ctx);
    vm.runInContext(syncCode.slice(queueStart,queueEnd),ctx);
    vm.runInContext(stockCode.slice(start,end),ctx);
    return {ctx,remote,remoteSettings,item,fields,calls,notices,
      saved:()=>saved,queued:()=>queued,setGeneration:n=>generation=n,
      save:()=>vm.runInContext('smSave(0)',ctx)};
  };
  const ok=make();
  assert.equal(await ok.save(),true,'code-less conversion needs confirmed delete');
  assert.deepEqual(ok.calls,['getCodeList','deleteUnreferencedCode','getCodeList','getSettings']);
  assert.equal(ok.remote.length,0,'GAS coded row deleted by CAS');
  assert.equal(ok.remoteSettings[0].code,'','server retains new code-less fund');
  assert.equal(ok.remoteSettings[0].targetWeight,37,'server retains original targetWeight');
  assert.equal(ok.remoteSettings[0].notes,'original notes','server retains original notes');
  assert.equal(ok.item.code,'','local master switched to code-less fund after server');
  assert.equal(ok.item.assetType,'펀드');
  assert.equal(ok.item.targetWeight,37,'verified server targetWeight overrides stale client');
  assert.equal(ok.item.notes,'original notes','verified server notes overrides stale client');
  assert.deepEqual(ok.item.customFlags,{serverOnly:true});
  assert.equal(ok.queued(),1);
  assert.equal(ok.saved(),1);
  const responseLost=make({crashAfterRemoteCommit:true});
  assert.equal(await responseLost.save(),false,'lost remote ACK must not report local success');
  assert.equal(responseLost.item.code,'001234','local remains unchanged until proven');
  assert.equal(responseLost.remote.length,0,'server has committed the code deletion');
  assert.equal(responseLost.remoteSettings[0].code,'','server already contains recovered fund');
  assert.equal(responseLost.remoteSettings[0].notes,'original notes',
    'browser crash cannot destroy server-persisted user fields');
  const protectedRow=make({referenced:true});
  assert.equal(await protectedRow.save(),false,'referenced remote ledger prevents removal');
  assert.equal(protectedRow.item.code,'001234','failed CAS cannot mutate browser master');
  assert.equal(protectedRow.ctx.STOCK_CODE['펀드 전환'],'001234');
  assert.equal(protectedRow.queued(),0);
  assert.equal(protectedRow.saved(),0);
  const absent=make({noRemote:true});
  assert.equal(await absent.save(),true,'uncommitted local NEW pair can become a direct fund');
  assert.deepEqual(absent.calls,['getCodeList']);
  assert.equal(absent.item.code,'');
  const local=make({localOnly:true});
  assert.equal(await local.save(),true,'offline/local portfolios retain code-less fund editing');
  assert.equal(local.item.code,'');
  assert.equal(local.item.assetType,'펀드');
  assert.deepEqual(local.calls,[],'no remote GET/POST for a local-only portfolio');
  assert.equal(local.saved(),1);
  const oldReplacement=make({noRemote:true,pendingReplacement:true});
  assert.equal(await oldReplacement.save(),false,'uncommitted replacement cannot impersonate a NEW pair');
  assert.equal(oldReplacement.item.code,'001234');
  const unsyncedNew=make({noRemote:true,pendingNew:true});
  assert.equal(await unsyncedNew.save(),false,
    'pending NEW registration cannot be stranded by a failed post-delete journal write');
  assert.deepEqual(unsyncedNew.calls,[],'pending journal blocked before any server operation');
  assert.equal(unsyncedNew.item.code,'001234');
  const conflict=make();
  let release;
  const paused=new Promise(resolve=>{release=resolve});
  const preceding=vm.runInContext('_queueGsheetStockMasterWrite(GSHEET_API_URL,async()=>await blocker)',
    Object.assign(conflict.ctx,{blocker:paused}));
  const pending=conflict.save();
  for(let i=0;i<6;i++)await Promise.resolve();
  assert.deepEqual(conflict.calls,[],'delete cannot overtake an in-flight code-master write');
  assert.equal(conflict.item.code,'001234','queued conversion keeps local master unchanged');
  release();
  await preceding;
  assert.equal(await pending,true);
  assert.deepEqual(conflict.calls,['getCodeList','deleteUnreferencedCode','getCodeList','getSettings']);
  // Regression: while a code-removal CAS is queued, an unrelated row can
  // disappear. A stale smSave index must never delete the converted item.
  const shifted=make();
  shifted.ctx.EDITABLE_PRICES.unshift({name:'무관한 선행 펀드',code:'',assetType:'펀드'});
  let resumeShift;
  const waitForShift=new Promise(resolve=>{resumeShift=resolve});
  const beforeShift=vm.runInContext('_queueGsheetStockMasterWrite(GSHEET_API_URL,async()=>await blocker)',
    Object.assign(shifted.ctx,{blocker:waitForShift}));
  const savingShift=vm.runInContext('smSave(1)',shifted.ctx);
  for(let i=0;i<6;i++)await Promise.resolve();
  shifted.ctx.EDITABLE_PRICES.shift();
  resumeShift();
  await beforeShift;
  assert.equal(await savingShift,true,'reordered master conversion should succeed');
  assert.equal(shifted.ctx.EDITABLE_PRICES.length,1,
    'unrelated row deletion must not remove target during dedup');
  assert.equal(shifted.ctx.EDITABLE_PRICES[0],shifted.item,
    'dedup must resolve actual item reference after awaited CAS');
  assert.equal(shifted.item.code,'');
  assert.equal(shifted.remote.length,0);
  const switchDuringWait=make();
  let unlock;
  const block=new Promise(resolve=>{unlock=resolve});
  const prior=vm.runInContext('_queueGsheetStockMasterWrite(GSHEET_API_URL,async()=>await blocker)',
    Object.assign(switchDuringWait.ctx,{blocker:block}));
  const waiting=switchDuringWait.save();
  switchDuringWait.setGeneration(6);
  unlock();
  await prior;
  assert.equal(await waiting,false,'connection switch invalidates queued deletion');
  assert.deepEqual(switchDuringWait.calls,[]);
  assert.equal(switchDuringWait.item.code,'001234');
  console.log('✅ 실제 smSave 무코드 전환: 서버 CAS 삭제·원장 참조거부·미등록 NEW·대기열·원본 전환 검증');
}
