import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the real production GAS handler with in-memory code/Settings sheets.
// Rebase must not lose another browser's partially-committed A->B metadata.
const gas=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
const start=gas.indexOf('function handleSyncCodes(codesParam,');
const end=gas.indexOf('function _repairKnownCodeColumns(ss)',start);
assert.ok(start>=0&&end>start);
const program=gas.slice(start,end);
const asset=(name,code)=>({name,code,type:'주식',sector:'기타',currency:'KRW',market:''});
const fields=r=>[r.code,r.name,r.type,r.sector,r.currency==='KRW'?'':r.currency,r.market];
const fund={name:'코드없는 TDF',code:'',assetType:'TDF',targetWeight:25,notes:'keep fund'};
function create(master,settings) {
  const state={
    codes:master.map(x=>({...x})),settings:settings.map(x=>({...x})),
    codeWrites:0,settingsWrites:0,touches:0,loans:{principal:357},property:{address:'서울'}
  };
  const sheet={
    getLastRow:()=>state.codes.length+1,
    getLastColumn:()=>6,
    getRange:(r,c,n=1,w=1)=>({
      getValues:()=>Array.from({length:n},(_,i)=>
        fields(state.codes[r+i-2]||asset('','')).slice(c-1,c-1+w)),
      setValues:()=>{state.codeWrites++;throw Error('READONLY_REBASE_WROTE_CODE')}
    })
  };
  const context={
    CONFIG:{SHEET_CODES:'종목코드'},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    getss:()=>({getSheetByName:()=>sheet}),
    _settlePendingCodeDeleteLocked_:()=>{},
    _portfolioCodeMasterSourceIdentity_:()=> 'same-sheet',
    _parseArrayParam:s=>JSON.parse(s),
    _cleanCode:c=>String(c||'').trim(),
    _portfolioNormalizeCodeMasterSnapshot_:items=>JSON.stringify(
      items.map(fields).sort((a,b)=>a[0].localeCompare(b[0]))),
    getCodeItems:()=>state.codes.map(x=>({...x})),
    _setCodeColumnText:()=>{},
    _readSettingsMap:()=>({EDITABLE_PRICES:state.settings.map(x=>({...x})),
      LOAN:state.loans,REAL_ESTATE:state.property,DIVDATA:{total:1}}),
    _writeCodeSyncEditablesOnly_:(ss,expected,desired)=>{
      assert.equal(JSON.stringify(expected),JSON.stringify(state.settings));
      state.settingsWrites++;
      state.settings=desired.map(x=>({...x}));
      return true;
    },
    _repairKnownCodeColumns:()=>[],
    _touchSnapshotIntegritySourceRevision:()=>{state.touches++;},
    SpreadsheetApp:{flush(){}},
    jsonOk:v=>({status:'ok',...v}),
    jsonError:(message,v={})=>({status:'error',message,...v})
  };
  vm.createContext(context);
  vm.runInContext(program,context);
  return {state,rebase:proofs=>context.handleSyncCodes(
    JSON.stringify(Object.fromEntries(state.codes.map(row=>[
      row.name,{code:row.code,type:row.type,sector:row.sector,
        currency:row.currency,market:row.market}
    ]))),
    'same-sheet',JSON.stringify(state.codes),'[]','1',JSON.stringify(proofs)
  )};
}
const metadata=(name,code)=>({previousName:name,previousCode:code,name,code,metadataOnly:true});
const replacement={previousName:'A',previousCode:'1',name:'B',code:'2'};
const deleted={...replacement,retired:true};
function block(master,settings,proofs,why) {
  const test=create(master,settings),before=structuredClone(test.state.settings);
  const result=test.rebase(proofs);
  assert.equal(result.errorCode,'CODE_REBASE_SETTINGS_MASTER_MISMATCH',
    why+': '+JSON.stringify(result));
  assert.equal(test.state.codeWrites,0,why+' code write');
  assert.equal(test.state.settingsWrites,0,why+' settings write');
  assert.deepEqual(test.state.settings,before,why+' preserved metadata');
}
const A={name:'A',code:'1',targetWeight:37,notes:'user notes'};
const C={name:'C',code:'3',targetWeight:20,notes:'C notes'};
block([asset('B','2'),asset('C','3')],[A,C,fund],[metadata('C','3')],
  'unrelated A->B partial commit cannot be pruned by C metadata debt');
block([asset('B','2'),asset('C','3')],[A,C,fund],[],
  'unproven full rebase must not delete stale A');
block([asset('B','2'),asset('C','3')],[C,fund],[metadata('C','3')],
  'missing B Settings needs explicit B evidence');
block([asset('B','2'),asset('C','3')],[A,C,{...C,targetWeight:99}],[replacement],
  'duplicate other Settings identity cannot be overwritten');
block([asset('C','3'),asset('D','4')],[A,C,{name:'Z',code:'9',targetWeight:42}],
  [deleted,metadata('D','4')],'tombstone cannot discard unrelated Z');
{
  const test=create([asset('A','1'),asset('C','3')],[A,fund]);
  assert.equal(test.rebase([metadata('C','3')]).status,'ok');
  assert.equal(test.state.settings[0].targetWeight,37);
  assert.equal(test.state.settings[0].notes,'user notes');
  assert.equal(test.state.settings[1].name,'C');
  assert.equal(test.state.settings[2].name,fund.name);
  assert.equal(test.state.settings[2].targetWeight,25);
  assert.equal(test.state.settingsWrites,1);
  assert.equal(test.state.codeWrites,0);
}
{
  const test=create([asset('B','2'),asset('C','3')],[A,C,fund]);
  assert.equal(test.rebase([replacement,metadata('C','3')]).status,'ok');
  assert.equal(test.state.settings[0].name,'B');
  assert.equal(test.state.settings[0].targetWeight,37);
  assert.equal(test.state.settings[0].notes,'user notes');
  assert.equal(test.state.settings[1].targetWeight,20);
  assert.equal(test.state.settings[2].name,fund.name);
}
{
  const test=create([asset('C','3')],[A,C,fund]);
  assert.equal(test.rebase([deleted]).status,'ok');
  assert.equal(test.state.settings.some(x=>x.name==='A'||x.name==='B'),false);
  assert.equal(test.state.settings[0].targetWeight,20);
  assert.equal(test.state.settings[1].name,fund.name);
}
{
  const test=create([asset('C','3')],[C,fund]);
  assert.equal(test.rebase([metadata('A','1')]).status,'ok',
    'an old metadata debt whose exact source was deleted is safe when no orphan remains');
  assert.equal(test.state.settings[0].targetWeight,20);
}
console.log('✅ 생산 GAS forceSettingsRebase: 다른 탭 A→B 유실 차단, append/교체/후속삭제 증명만 허용');
