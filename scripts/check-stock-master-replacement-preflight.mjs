import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Production function VM: remote A->B may commit the code row but fail
// Settings, leaving master B / Settings A. Another tab's B->C must fail closed.
const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
const begin=gas.indexOf('function handleSyncCodes(codesParam,');
const end=gas.indexOf('function _repairKnownCodeColumns(ss)',begin);
assert.ok(begin>=0 && end>begin);
const production=gas.slice(begin,end);
const asset=(name,code)=>({name,code,type:'주식',sector:'기타',currency:'KRW',market:''});
const values=r=>[r.code,r.name,r.type,r.sector,r.currency==='KRW'?'':r.currency,r.market];
function createScenario(current,settings) {
  const state={codes:[{...current}],settings:settings.map(x=>({...x})),
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
  return {state,replace:(name,code,oldName,oldCode)=>{
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
