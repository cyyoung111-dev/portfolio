import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Production function VM: remote A->B may commit the code row but fail
// Settings, leaving master B / Settings A. Another tab's B->C must fail closed.
const gas=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
const begin=gas.indexOf('function handleSyncCodes(codesParam,');
const end=gas.indexOf('function _repairKnownCodeColumns(ss)',begin);
assert.ok(begin>=0 && end>begin);
const production=gas.slice(begin,end);
const asset=(name,code)=>({name,code,type:'주식',sector:'기타',currency:'KRW',market:''});
const values=r=>[r.code,r.name,r.type,r.sector,r.currency==='KRW'?'':r.currency,r.market];
function createScenario(current,settings) {
  const state={codes:(Array.isArray(current)?current:[current]).map(x=>({...x})),settings:settings.map(x=>({...x})),
    codeWrites:0,settingsWrites:0,touches:0};
  const codesheet={
    getLastRow:()=>state.codes.length+1,
    getLastColumn:()=>6,
    getRange:(r,c,n=1,w=1)=>({
      getValues:()=>Array.from({length:n},(_,i)=>
        values(state.codes[r+i-2]||asset('','')).slice(c-1,c-1+w)),
      setValues:rows=>{
        state.codeWrites++;
        rows.forEach((cols,i)=>cols.forEach((v,j)=>{
          const name=['code','name','type','sector','currency','market'][c+j-1];
          if(!state.codes[r+i-2]) state.codes[r+i-2]=asset('','');
          state.codes[r+i-2][name]=name==='currency'&&!v?'KRW':v;
        }));
      }
    })
  };
  const ctx={
    CONFIG:{SHEET_CODES:'종목코드'},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    getss:()=>({getSheetByName:()=>codesheet}),
    _settlePendingCodeDeleteLocked_:()=>{},
    _portfolioCodeMasterSourceIdentity_:()=> 'same-workbook',
    _parseArrayParam:text=>JSON.parse(text),
    _cleanCode:x=>String(x||'').trim(),
    _portfolioNormalizeCodeMasterSnapshot_:a=>JSON.stringify(a.map(values).sort((a,b)=>a[0].localeCompare(b[0]))),
    getCodeItems:()=>state.codes.map(x=>({...x})),
    _setCodeColumnText:()=>{},
    _readSettingsMap:()=>({
      EDITABLE_PRICES:state.settings.map(x=>({...x})),
      LOAN:{principal:100},REAL_ESTATE:{address:'unchanged'}
    }),
    _writeCodeSyncEditablesOnly_:(ss,prior,next)=>{
      state.settingsWrites++;
      assert.equal(JSON.stringify(prior),JSON.stringify(state.settings));
      state.settings=next.map(x=>({...x}));
      return true;
    },
    _writeSettingsMap:map=>{
      state.settingsWrites++;
      assert.equal(map.LOAN.principal,100);
      assert.equal(map.REAL_ESTATE.address,'unchanged');
      state.settings=map.EDITABLE_PRICES.map(x=>({...x}));
      return true;
    },
    _repairKnownCodeColumns:()=>[],
    _touchSnapshotIntegritySourceRevision:()=>{state.touches++;},
    SpreadsheetApp:{flush(){}},
    jsonError:(message,meta={})=>({status:'error',message,...meta}),
    jsonOk:result=>({status:'ok',...result})
  };
  vm.createContext(ctx);
  vm.runInContext(production,ctx);
  return {state,sync:rows=>{
    const wanted={};
    for(const row of rows)wanted[row.name]={code:row.code,type:row.type,
      sector:row.sector,currency:row.currency,market:row.market,
      userFields:row.userFields||{
        ...(row.targetWeight!==undefined?{targetWeight:row.targetWeight}:{}),
        ...(row.notes!==undefined?{notes:row.notes}:{})
      }};
    return ctx.handleSyncCodes(JSON.stringify(wanted),'same-workbook',
      JSON.stringify(state.codes),'[]','','[]');
  },replace:(name,code,oldName,oldCode)=>{
    const next=asset(name,code);
    return ctx.handleSyncCodes(
      JSON.stringify({[name]:{code:next.code,type:next.type,sector:next.sector,
        currency:next.currency,market:next.market}}),
      'same-workbook',JSON.stringify(state.codes),
      JSON.stringify([{previousName:oldName,previousCode:oldCode,name,code}]),'','[]');
  }};
}
{
  const test=createScenario(asset('B','2'),[{
    name:'A',code:'1',targetWeight:37,notes:'must survive'
  }]);
  assert.equal(test.replace('C','3','B','2').errorCode,
    'CODE_SYNC_REPLACEMENT_SETTINGS_CONFLICT');
  assert.deepEqual(test.state.codes,[asset('B','2')]);
  assert.equal(test.state.settings[0].targetWeight,37);
  assert.equal(test.state.settings[0].notes,'must survive');
  assert.equal(test.state.codeWrites,0);
  assert.equal(test.state.settingsWrites,0);
  assert.equal(test.state.touches,0);
}
{
  const test=createScenario(asset('B','2'),[]);
  assert.equal(test.replace('C','3','B','2').errorCode,
    'CODE_SYNC_REPLACEMENT_SETTINGS_CONFLICT');
  assert.equal(test.state.codeWrites,0);
  assert.equal(test.state.settingsWrites,0);
}
{
  const duplicate=createScenario(asset('B','2'),[
    {name:'B',code:'2',targetWeight:12},{name:'B',code:'2',targetWeight:20}]);
  assert.equal(duplicate.replace('C','3','B','2').errorCode,
    'CODE_SYNC_REPLACEMENT_SETTINGS_CONFLICT');
  assert.equal(duplicate.state.codeWrites,0);
  const conflict=createScenario(asset('B','2'),[
    {name:'B',code:'2',targetWeight:37},{name:'C',code:'99',notes:'collision'}]);
  assert.equal(conflict.replace('C','3','B','2').errorCode,
    'CODE_SYNC_REPLACEMENT_SETTINGS_CONFLICT');
  assert.equal(conflict.state.codeWrites,0);
}
for(const [a,b,c,d] of [
  ['B','2','C','3'],['B','2','C','2'],['B','2','B','3']
]){
  const test=createScenario(asset(a,b),[
    {name:a,code:b,targetWeight:37,notes:'preserve',customFlag:true}]);
  const result=test.replace(c,d,a,b);
  assert.equal(result.status,'ok',JSON.stringify(result));
  assert.deepEqual(test.state.codes,[asset(c,d)]);
  assert.equal(test.state.settings.length,1);
  assert.equal(test.state.settings[0].name,c);
  assert.equal(test.state.settings[0].code,d);
  assert.equal(test.state.settings[0].targetWeight,37);
  assert.equal(test.state.settings[0].notes,'preserve');
  assert.equal(test.state.settings[0].customFlag,true);
  assert.ok(test.state.codeWrites>0);
  assert.equal(test.state.settingsWrites,1);
}
console.log('✅ GAS 생산함수 VM: Settings 원본 미존재/중복/별칭 차단 및 사용자 필드 보존');


// All ordinary code writes require a unique Settings identity for EVERY
// previously committed code-master entry, not just explicit replacements.
const staleA={name:'A',code:'1',targetWeight:37,notes:'preserve'};
const goodB={name:'B',code:'2',targetWeight:37,notes:'preserve'};
const fundOnly={name:'코드없는 TDF',code:'',assetType:'TDF',targetWeight:25};
for(const requested of [
  [{...asset('B','2'),sector:'헬스케어'}],
  [asset('B','2'),asset('C','3')]
]){
  const test=createScenario(asset('B','2'),[staleA,fundOnly]);
  assert.equal(test.sync(requested).errorCode,'CODE_SYNC_SETTINGS_MASTER_MISMATCH');
  assert.equal(test.state.codeWrites,0);
  assert.equal(test.state.settingsWrites,0);
  assert.equal(test.state.touches,0);
  assert.equal(test.state.settings[0].targetWeight,37);
  assert.equal(test.state.settings[0].notes,'preserve');
}
{
  const test=createScenario([asset('B','2'),asset('D','4')],[
    staleA,{name:'D',code:'4',targetWeight:12}]);
  assert.equal(test.sync([asset('B','2'),{...asset('D','4'),sector:'헬스케어'}])
    .errorCode,'CODE_SYNC_SETTINGS_MASTER_MISMATCH');
  assert.equal(test.state.codeWrites,0);
  assert.equal(test.state.settingsWrites,0);
}
for(const settings of [
  [goodB,goodB],
  [goodB,{name:'A',code:'1',targetWeight:37}],
  [goodB,{name:'B',code:'999999',notes:'alias'}],
  []
]){
  const test=createScenario(asset('B','2'),settings);
  assert.equal(test.sync([{...asset('B','2'),sector:'헬스케어'}])
    .errorCode,'CODE_SYNC_SETTINGS_MASTER_MISMATCH');
  assert.equal(test.state.codeWrites,0);
  assert.equal(test.state.settingsWrites,0);
}
{
  const test=createScenario(asset('B','2'),[staleA]);
  assert.equal(test.sync([asset('B','2')]).status,'ok');
  assert.equal(test.state.settingsWrites,0);
  assert.equal(test.state.codeWrites,0);
}
{
  const test=createScenario(asset('B','2'),[goodB,fundOnly]);
  assert.equal(test.sync([{...asset('B','2'),sector:'헬스케어'}]).status,'ok');
  assert.equal(test.state.codes[0].sector,'헬스케어');
  assert.equal(test.state.settings[0].targetWeight,37);
  assert.equal(test.state.settings[0].notes,'preserve');
  assert.equal(test.state.settings[1].name,fundOnly.name);
  assert.equal(test.state.settings[1].targetWeight,25);
  assert.equal(test.state.settingsWrites,1);
}
{
  const test=createScenario(asset('B','2'),[goodB,fundOnly]);
  const result=test.sync([asset('B','2'),asset('C','3')]);
  assert.equal(result.status,'ok',JSON.stringify(result));
  assert.equal(test.state.codes.length,2);
  assert.equal(test.state.codes[1].name,'C');
  assert.equal(test.state.settings[0].targetWeight,37);
  assert.equal(test.state.settings[0].notes,'preserve');
  assert.equal(test.state.settings[1].name,'C');
  assert.equal(test.state.settings[2].name,fundOnly.name);
  assert.equal(test.state.settings[2].targetWeight,25);
  assert.equal(test.state.settingsWrites,1);
}
console.log('✅ 전체 Settings 정합성 보호: 코드 메타데이터·추가 회귀 테스트');

{
  // Actual production handleSyncCodes must commit a NEW pair's user-entered
  // allocation and memo in the SAME Settings write as the code-row append.
  // This cannot be delegated to the earlier saveSettings, which rejects
  // uncommitted codes from its authoritative server master.
  const current={...asset('A','1')};
  const test=createScenario(current,[{
    name:'A',code:'1',targetWeight:37,notes:'keep A'
  }]);
  const wanted=[
    {...current,targetWeight:99,notes:'stale browser must not replace A'},
    {...asset('C','3'),targetWeight:25,notes:'신규 종목 개인 메모'}
  ];
  const response=test.sync(wanted);
  assert.equal(response.status,'ok',JSON.stringify(response));
  const first=test.state.settings.find(row=>row.name==='A');
  const appended=test.state.settings.find(row=>row.name==='C');
  assert.equal(first.targetWeight,37);
  assert.equal(first.notes,'keep A');
  assert.equal(appended.targetWeight,25);
  assert.equal(appended.notes,'신규 종목 개인 메모');
  assert.equal(appended.code,'3');
  assert.equal(test.state.codeWrites,1);
  assert.equal(test.state.settingsWrites,1);
}
{
  // Existing pair metadata-only changes still cannot receive spoofed NEW
  // user fields from codeMap; persisted Settings is the source of truth.
  const test=createScenario(asset('A','1'),[{
    name:'A',code:'1',targetWeight:37,notes:'server data'
  }]);
  const changed={...asset('A','1'),sector:'기술',targetWeight:99,notes:'spoofed'};
  assert.equal(test.sync([changed]).status,'ok');
  assert.equal(test.state.settings[0].targetWeight,37);
  assert.equal(test.state.settings[0].notes,'server data');
}
console.log('✅ 생산 GAS 신규 코드 append 대상의 비중·메모 최초 저장/기존 Settings 침범 방지');
