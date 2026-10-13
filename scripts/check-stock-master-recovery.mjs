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

assert.match(html,/settings_sync\.js\?v=20261013-18/);

assert.ok(html.includes('domain/portfolio/data.js?v=20261013-9'));
assert.ok(sw.includes('domain/portfolio/data.js?v=20261013-9'));

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
assert.match(html,/mgmt_stock\.js\?v=20261013-6/);
assert.match(html,/mgmt_sector\.js\?v=20261012-2/);
assert.match(html,/sw\.js\?v=20261013-20/);
assert.match(sw,/portfolio-cache-20261013-20/);

assert.match(html,/views_history\.js\?v=20261012-2/);
assert.match(sw,/settings_sync\.js\?v=20261013-18/);
assert.match(sw,/views_history\.js\?v=20261012-2/);

const settings=fs.readFileSync('src/web/features/settings/settings.js','utf8');
assert.match(settings,/if \(_gsBootRestored && isGsheetConnectionCurrent\(bootTarget, bootGeneration\)/,
 'successful bootstrap must re-render disabled controls');
assert.match(html,/mgmt_stock\.js\?v=20261013-6/);
assert.match(html,/mgmt_sector\.js\?v=20261012-2/);
assert.match(html,/settings\.js\?v=20261013-8/);
assert.match(sw,/settings\.js\?v=20261013-8/);
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
    lsGet:(k,d)=>d, lsSave:()=>{}, lsRemove:()=>{},
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
        assert.equal(metadata.length,0,'metadata-only repair requires no identity transfer');
        return {status:'error',errorCode:'CODE_SYNC_SETTINGS_FAILED'};
      }
      if(calls.length===9){
        assert.equal(args.forceSettingsRebase,'1');
        assert.equal(metadata.length,0,'durable marker must not become replacement');
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
