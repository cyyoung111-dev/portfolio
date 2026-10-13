import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sync=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
const ledger=fs.readFileSync('src/web/domain/portfolio/data.js','utf8');
const begin=ledger.indexOf('const PORTFOLIO_PENDING_CODE_ADDITIONS_KEY');
const end=ledger.indexOf('function _normalizePendingExplicitEmptyTradeSync(',begin);
assert.ok(begin>=0&&end>begin);
const program=sync.slice(0,sync.indexOf('// ★ v8.1'));
const A={name:'A',code:'1',type:'주식',sector:'기타',currency:'KRW',market:''};
const C={name:'C',code:'3',type:'주식',sector:'기타',currency:'KRW',market:''};
function scenario({failInitial=true}={}) {
  const url='https://script.google.com/macros/s/append-repair/exec',source='sheet-append';
  const remote=[{...A}],settings=[{...A,targetWeight:37,notes:'preserve A'}];
  let posts=0,writes=0;
  const disk={};
  const ctx={
    console,GSHEET_API_URL:url,GSHEET_KEY:'url',
    _gsBootRestored:true,_gsPortfolioRestoreRequired:false,
    _gsCodeMasterSourceIdentity:source,
    EDITABLE_PRICES:[{...A,targetWeight:37},{...C,targetWeight:25,notes:'C user memo'}],
    normalizeStockCode:x=>String(x||'').trim(),
    getGsheetConnectionGeneration:()=>5,
    isGsheetConnectionCurrent:(value,g)=>value===url && g===5,
    isGsheetPortfolioWriteReady:()=>true,
    isStockMasterEditSessionCurrent:()=>true,
    _currentGsheetSyncTarget:()=>url,
    lsGet:(k,d)=>k in disk?structuredClone(disk[k]):d,
    lsSave:(k,v)=>{disk[k]=structuredClone(v)},
    lsRemove:k=>{delete disk[k]},
    requestGsheetActionJson:async action=>{
      assert.equal(action,'getCodeList');
      return {status:'ok',codeMasterSourceId:source,codes:remote.map(x=>({...x}))};
    },
    requestGsheetFormJson:async (action,payload)=>{
      assert.equal(action,'syncCodes');
      posts++;
      if(payload.forceSettingsRebase==='') {
        const next=JSON.parse(payload.codes);
        const currentPairs=new Set(remote.map(row=>row.name+'/'+row.code));
        for(const [name,item] of Object.entries(next)) {
          if(item.code && !currentPairs.has(name+'/'+item.code))
            remote.push({name,code:item.code,type:item.type,sector:item.sector,
              currency:item.currency,market:item.market});
        }
        // First GAS response represents code flush success, Settings failed.
        if(posts===1 && failInitial)
          return {status:'error',errorCode:'CODE_SYNC_SETTINGS_FAILED'};
        if(!settings.some(x=>x.name==='C')) settings.push({...C,...(next.C?.userFields||{})});
        return {status:'ok',synced:0,updated:0};
      }
      assert.equal(payload.forceSettingsRebase,'1');
      assert.equal(JSON.parse(payload.settingsReplacements).length,1);
      assert.equal(JSON.parse(payload.settingsReplacements)[0].metadataOnly,true,
        'appended C is a scoped metadataOnly proof, NEVER a code rename');
      assert.equal(JSON.parse(payload.settingsReplacements)[0].name,'C');
      const fields=JSON.parse(payload.settingsReplacements)[0].userFields;
      assert.equal(fields?.targetWeight,25);
      assert.equal(fields?.notes,'C user memo');
      if(posts===2 && failInitial)
        return {status:'error',errorCode:'CODE_SYNC_SETTINGS_FAILED'};
      if(!settings.some(x=>x.name==='C'))
        settings.push({...C,...fields});
      writes++;
      return {status:'ok',synced:0,updated:0};
    }
  };
  vm.createContext(ctx);
  vm.runInContext(ledger.slice(begin,end),ctx);
  vm.runInContext(program,ctx);
  ctx.initialMaster=[{...A}];
  vm.runInContext('applyGsheetCodeList(initialMaster,_gsCodeMasterSourceIdentity)',ctx);
  assert.equal(vm.runInContext(
    '_recordSameTargetLocalCodeAddition(EDITABLE_PRICES[1],captureStockMasterEditSession())',ctx),true);
  const debts=()=>vm.runInContext(
    '_getSameTargetCodeSettingsRepairs(GSHEET_API_URL,_gsCodeMasterSourceIdentity)',ctx);
  const journals=()=>vm.runInContext(
    '_getSameTargetLocalCodeAdditions(GSHEET_API_URL,_gsCodeMasterSourceIdentity)',ctx);
  return {ctx,remote,settings,disk,debts,journals,
    calls:()=>({posts,writes}),sync:()=>vm.runInContext('syncCodesToGsheet()',ctx)};
}
{
  const t=scenario();
  assert.equal(await t.sync(),null,'append code committed, Settings repair failed');
  assert.equal(t.remote.length,2);
  assert.equal(t.settings.length,1,'Settings is still missing C');
  assert.equal(t.debts().length,1,'confirmed partial append persists Settings debt');
  assert.equal(t.debts()[0].name,'C');
  assert.equal(t.debts()[0].metadataOnly,true);
  assert.equal(t.debts()[0].userFields?.targetWeight,25);
  assert.equal(t.debts()[0].userFields?.notes,'C user memo');
  assert.equal(t.journals().length,1,'journal retained until Settings repair verified');
  assert.equal((await t.sync())?.status,'ok','retry repairs C before accepting no-op');
  assert.equal(t.settings.length,2);
  assert.equal(t.settings[1].targetWeight,25);
  assert.equal(t.settings[1].notes,'C user memo');
  assert.equal(t.debts().length,0);
  assert.equal(t.journals().length,0);
  assert.equal(t.remote.length,2,'no duplicate append');
}
{
  // Hard crash after C is committed but before an HTTP response or
  // in-memory repair debt: the pinned durable local journal must stage C.
  const t=scenario();
  t.remote.push({...C});
  assert.equal(vm.runInContext(
    'stageConfirmedSameTargetCodeReplacementRepairs(GSHEET_API_URL,_gsCodeMasterSourceIdentity,remoteCodes)',Object.assign(t.ctx,{remoteCodes:t.remote})),true);
  assert.equal(t.debts().length,1);
  assert.equal(t.debts()[0].metadataOnly,true);
  assert.equal(t.debts()[0].userFields?.targetWeight,25);
  assert.equal(t.debts()[0].userFields?.notes,'C user memo');
  const response=await vm.runInContext(
    'repairPinnedSameTargetCodeSettingsBeforeRestore({targetUrl:GSHEET_API_URL,sourceId:_gsCodeMasterSourceIdentity,generation:5,masterCodes:remoteCodes})',t.ctx);
  assert.ok(response,'Bootstrap fixes a committed append without replaying it');
  assert.equal(t.settings.length,2);
  assert.equal(t.settings[1].targetWeight,25);
  assert.equal(t.settings[1].notes,'C user memo');
  assert.equal(t.debts().length,0);
  assert.equal(t.journals().length,0,'recovered append journal retired');
  assert.equal(t.remote.length,2);
}
{
  const t=scenario();
  const prove=(before,after,authorized)=>t.ctx._stockMasterMetadataOnlyRepairProof(before,after,authorized);
  assert.equal(prove([A],[A,C],[]),null,'unproven new asset rejected');
  assert.equal(prove([A,C],[C],[{name:'C',code:'3'}]),null,'deletion cannot be append proof');
  assert.equal(prove([A],[{...A,name:'B',code:'2'}],[{name:'B',code:'2'}]),null,
    'replacement cannot impersonate authorized append');
  const proof=prove([A],[A,C],[{name:'C',code:'3'}]);
  assert.equal(proof.length,1);
  assert.equal(proof[0].metadataOnly,true);
  assert.equal(proof[0].name,'C');
}
console.log('✅ 실제 웹 동기화/Bootstrap VM: 신규 append 부분 커밋 부채 보존·재시도·하드 크래시 복구');

{
  const t=scenario({failInitial:false});
  const response=await t.sync();
  assert.equal(response?.status,'ok');
  assert.equal(t.settings[1].targetWeight,25);
  assert.equal(t.settings[1].notes,'C user memo');
  assert.equal(t.debts().length,0);
  assert.equal(t.journals().length,0);
}
console.log('✅ 신규 C append 최초 저장/부분 커밋/하드 크래시 복구에서 비중25·메모 유지');
