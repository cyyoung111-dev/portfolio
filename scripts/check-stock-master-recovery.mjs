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

assert.match(html,/settings_sync\.js\?v=20261013-25/);

assert.ok(html.includes('domain/portfolio/data.js?v=20261013-14'));
assert.ok(sw.includes('domain/portfolio/data.js?v=20261013-14'));

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
assert.match(html,/mgmt_stock\.js\?v=20261013-8/);
assert.match(html,/mgmt_sector\.js\?v=20261012-2/);
assert.match(html,/sw\.js\?v=20261013-38/);
assert.match(sw,/portfolio-cache-20261013-38/);

assert.match(html,/views_history\.js\?v=20261012-2/);
assert.match(sw,/settings_sync\.js\?v=20261013-25/);
assert.match(sw,/views_history\.js\?v=20261012-2/);

const settings=fs.readFileSync('src/web/features/settings/settings.js','utf8');
assert.match(settings,/if \(_gsBootRestored && isGsheetConnectionCurrent\(bootTarget, bootGeneration\)/,
 'successful bootstrap must re-render disabled controls');
assert.match(html,/mgmt_stock\.js\?v=20261013-8/);
assert.match(html,/mgmt_sector\.js\?v=20261012-2/);
assert.match(html,/settings\.js\?v=20261013-9/);
assert.match(sw,/settings\.js\?v=20261013-9/);
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

  // Legacy v1 journal must be migrated to per-pair storage before network sync.
  const old=create();
  const legacy={sourceId:'old-book',name:'M',code:'7',userFields:{targetWeight:35}};
  vm.runInContext('lsSave(PORTFOLIO_PENDING_CODE_ADDITIONS_KEY,{[GSHEET_API_URL]:[legacy]})',
    Object.assign(old,{legacy}));
  old.items=[{name:'M',code:'7',targetWeight:35}];
  assert.equal(vm.runInContext('_refreshSameTargetPendingAppendFields(GSHEET_API_URL,"old-book",items)',old),true);
  assert.equal(vm.runInContext(
    '_getSameTargetLocalCodeAdditions(GSHEET_API_URL,"old-book").length',create()),1);
  console.log('✅ 원본별 journal 삭제 격리, Storage 보안·Quota 실패 fail-closed, v1 영속 이관');
}
