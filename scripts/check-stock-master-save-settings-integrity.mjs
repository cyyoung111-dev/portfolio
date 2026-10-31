import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the production GAS saveSettings handler, not a reimplementation.
// Only Settings may be written; a prior cross-browser code-only partial
// commit must not drop any stored targetWeight, notes, or unconnected keys.
const source=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
const start=source.indexOf('function handleSaveSettings(');
const end=source.indexOf('function handleGetSettings(',start);
assert.ok(start>=0&&end>start);
const A={name:'A',code:'1',type:'주식',sector:'기타',currency:'KRW',market:''};
const B={...A,name:'B',code:'2'};
const C={...A,name:'C',code:'3'};
const oldA={name:'A',code:'1',assetType:'주식',targetWeight:37,notes:'must preserve'};
const oldC={name:'C',code:'3',assetType:'주식',targetWeight:20,notes:'C notes'};
const fund={name:'TDF 직접',code:'',assetType:'TDF',targetWeight:25,notes:'fund'};
const fullPair=x=>JSON.stringify([x.name,x.code]);
function fixture(master, storedRows, otherSettings={}) {
  const state={master:structuredClone(master), settings:{
    EDITABLE_PRICES:structuredClone(storedRows),
    LOAN:{balance:357000000},REAL_ESTATE:{price:700000000},
    DIVDATA:{paid:10},APP_THEME:'light',...structuredClone(otherSettings)},
    writes:0,lock:false};
  const context={
    LockService:{getScriptLock:()=>({
      waitLock(){assert.equal(state.lock,false);state.lock=true;},
      releaseLock(){assert.equal(state.lock,true);state.lock=false;}
    })},
    getss:()=>({}),
    _settlePendingCodeDeleteLocked_:()=>({pending:false}),
    _parseJsonParam:s=>JSON.parse(s),
    _cleanCode:c=>String(c||'').trim(),
    _portfolioNormalizeCodeMasterSnapshot_:masterRows=>{
      if (!Array.isArray(masterRows)) return '';
      const ids=new Set(),names=new Set();
      for (const row of masterRows) {
        if (!row.name || !row.code || ids.has(row.code) || names.has(row.name)) return '';
        ids.add(row.code);names.add(row.name);
      }
      return JSON.stringify(masterRows.map(fullPair).sort());
    },
    getCodeItems:()=>structuredClone(state.master),
    _readSettingsMap:()=>structuredClone(state.settings),
    _writeSettingsMap:data=>{
      state.writes++;
      state.settings=structuredClone(data);
      return Object.keys(data).length;
    },
    jsonOk:v=>({status:'ok',...v}),
    jsonError:(message,v={})=>({status:'error',message,...v})
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  return {state, save:incoming=>context.handleSaveSettings(JSON.stringify(incoming))};
}
function shouldReject(master, stored, incoming, label, extras={}) {
  const f=fixture(master,stored,extras),before=structuredClone(f.state.settings);
  const result=f.save(incoming);
  assert.equal(result.errorCode,'SETTINGS_CODE_MASTER_MISMATCH',label);
  assert.equal(f.state.writes,0,label+' no settings write');
  assert.deepEqual(f.state.settings,before,label+' preserves settings + notes');
  assert.equal(f.state.lock,false,label+' releases lock');
}
const incoming={EDITABLE_PRICES:[{...B,targetWeight:0}],APP_THEME:'dark'};
shouldReject([B],[oldA],incoming,'other tab A->B code-only commit');
shouldReject([B,C],[oldA,oldC,fund],
  {EDITABLE_PRICES:[{...B},{...C}],APP_THEME:'dark'},
  'unrelated C theme/metadata save cannot drop orphan A');
shouldReject([A,C],[oldA,fund],
  {EDITABLE_PRICES:[oldA,oldC],APP_THEME:'dark'},
  'incoming client proof does not authorize a server-missing C');
shouldReject([A,C],[oldA,oldC,{...oldC,targetWeight:55}],
  {EDITABLE_PRICES:[oldA,oldC]},'duplicate coded Settings must block');
shouldReject([A,C],[oldA,oldC,{name:'orphan',code:'9',targetWeight:87}],
  {EDITABLE_PRICES:[oldA,oldC]},'unproven Settings orphan must block');
shouldReject([A],[oldA],{EDITABLE_PRICES:[oldA],APP_THEME:'dark'},
  'malformed persisted Settings must block',{EDITABLE_PRICES:{name:'A',code:'1'}});
shouldReject([A],[],{EDITABLE_PRICES:[oldA]},
  'initial missing stored coded pair is not license to default');
{
  const f=fixture([A,C],[oldA,oldC,fund]);
  const saved=f.save({EDITABLE_PRICES:[
    {...oldA,targetWeight:42,notes:'user edited'},
    {name:'orphan',code:'999',targetWeight:100},
    fund
  ],APP_THEME:'dark',LOAN:{balance:0},REAL_ESTATE:{price:0}});
  assert.equal(saved.status,'ok','valid master and stored exact pairs may save');
  assert.equal(f.state.writes,1);
  assert.deepEqual(f.state.settings.EDITABLE_PRICES.map(x=>x.name),['A','C','TDF 직접']);
  assert.equal(f.state.settings.EDITABLE_PRICES[0].targetWeight,42);
  assert.equal(f.state.settings.EDITABLE_PRICES[0].notes,'user edited');
  assert.equal(f.state.settings.EDITABLE_PRICES[1].targetWeight,20,
    'unsubmitted C retains authoritative old custom fields');
  assert.equal(f.state.settings.EDITABLE_PRICES[2].targetWeight,25);
  assert.equal(f.state.settings.APP_THEME,'dark');
  assert.equal(f.state.settings.LOAN.balance,357000000);
  assert.equal(f.state.settings.REAL_ESTATE.price,700000000);
  assert.equal(f.state.settings.DIVDATA.paid,10);
  assert.equal(f.state.lock,false);
}
{
  const f=fixture([A],[oldA]);
  const saved=f.save({APP_THEME:'dark'});
  assert.equal(saved.status,'ok','unrelated key-only Settings saves do not rebase coded rows');
  assert.equal(f.state.settings.EDITABLE_PRICES[0].targetWeight,37);
  assert.equal(f.state.settings.APP_THEME,'dark');
}
{
  // A has already been deleted server-side and converted to a new code-less
  // fund. Another tab sends the stale coded A while saving its theme. The
  // old canonicalizer silently erased this server-authoritative fund.
  const converted={...fund,name:'A',assetType:'펀드',notes:'서버 전환 메모',targetWeight:37};
  const f=fixture([C],[oldC,converted]);
  const before=structuredClone(f.state.settings);
  const rejected=f.save({EDITABLE_PRICES:[oldA,oldC],APP_THEME:'dark'});
  assert.equal(rejected.errorCode,'SETTINGS_CODELESS_FUND_PROOF_REQUIRED');
  assert.equal(f.state.writes,0,'stale tab must never erase the converted fund');
  assert.deepEqual(f.state.settings,before);
  assert.equal(f.state.lock,false);
}
{
  // Converted asset also changed its name. Source identity may no longer
  // equal the new destination name; reject an orphan code + omitted fund.
  const converted={...fund,name:'새 펀드',assetType:'펀드',notes:'전환 후 보존'};
  const f=fixture([C],[oldC,converted]);
  const rejected=f.save({EDITABLE_PRICES:[oldA,oldC],APP_THEME:'dark'});
  assert.equal(rejected.errorCode,'SETTINGS_CODELESS_FUND_PROOF_REQUIRED');
  assert.equal(f.state.settings.EDITABLE_PRICES[1].notes,'전환 후 보존');
  assert.equal(f.state.writes,0);
}
{
  // An intentional code-less fund removal from a CURRENT code master keeps
  // working. Only an unknown coded alias combined with omission is unsafe.
  const f=fixture([C],[oldC,fund]);
  const removed=f.save({EDITABLE_PRICES:[oldC],
    expectedCodelessFunds:[fund],APP_THEME:'dark'});
  assert.equal(removed.status,'ok');
  assert.deepEqual(f.state.settings.EDITABLE_PRICES.map(x=>x.name),['C']);
  assert.equal(f.state.settings.APP_THEME,'dark');
}
{
  // A stale coded entry without omission of any persisted fund is handled
  // by the existing canonicalizer, not broadly blocked by the new guard.
  const f=fixture([C],[oldC,fund]);
  const saved=f.save({EDITABLE_PRICES:[oldA,oldC,fund],APP_THEME:'dark'});
  assert.equal(saved.status,'ok');
  assert.deepEqual(f.state.settings.EDITABLE_PRICES.map(x=>x.name),['C','TDF 직접']);
}
{
  // Codex P2: the stale browser never saw either new coded A or the
  // converted (renamed) fund B, so its incoming array has NO orphan code.
  // Prior heuristic incorrectly permitted complete user-field deletion.
  const converted={...fund,name:'새 펀드 B',assetType:'펀드',
    targetWeight:37,notes:'서버 4,000자 저장'};
  const f=fixture([C],[oldC,converted]);
  const before=structuredClone(f.state.settings);
  const rejected=f.save({EDITABLE_PRICES:[oldC],APP_THEME:'dark'});
  assert.equal(rejected.errorCode,'SETTINGS_CODELESS_FUND_PROOF_REQUIRED');
  assert.equal(f.state.writes,0,'stale tab must not delete unseen B');
  assert.deepEqual(f.state.settings,before);
  assert.equal(f.state.lock,false);
}
{
  // Old tab can supply a perfectly valid but stale empty fund baseline:
  // the exact original fund snapshot CAS still refuses the deletion.
  const converted={...fund,name:'새 펀드 B',targetWeight:50,notes:'unseen'};
  const f=fixture([C],[oldC,converted]);
  const result=f.save({EDITABLE_PRICES:[oldC],expectedCodelessFunds:[]});
  assert.equal(result.errorCode,'SETTINGS_CODELESS_FUND_STALE');
  assert.equal(f.state.writes,0);
}
{
  // Exact bootstrapped original enables intentional deletion. Proof is a
  // transport-only field and must never persist to the Settings worksheet.
  const converted={...fund,name:'새 펀드 B',targetWeight:50,notes:'existing'};
  const f=fixture([C],[oldC,converted]);
  const result=f.save({EDITABLE_PRICES:[oldC],
    expectedCodelessFunds:[converted],APP_THEME:'dark'});
  assert.equal(result.status,'ok','CAS-proven intentional deletion allowed');
  assert.deepEqual(f.state.settings.EDITABLE_PRICES.map(x=>x.name),['C']);
  assert.equal(Object.hasOwn(f.state.settings,'expectedCodelessFunds'),false);
}
{
  const f=fixture([C],[oldC,fund]);
  const changed={...fund,targetWeight:43,notes:'user deliberately changed'};
  const result=f.save({EDITABLE_PRICES:[oldC,changed],
    expectedCodelessFunds:[fund]});
  assert.equal(result.status,'ok','fund edit with exact readback proof');
  assert.equal(f.state.settings.EDITABLE_PRICES[1].targetWeight,43);
  assert.equal(f.state.settings.EDITABLE_PRICES[1].notes,'user deliberately changed');
}
{
  const f=fixture([C],[oldC,fund]);
  const wrong={...fund,targetWeight:99};
  const rejected=f.save({EDITABLE_PRICES:[oldC,{...fund,notes:'stale edit'}],
    expectedCodelessFunds:[wrong]});
  assert.equal(rejected.errorCode,'SETTINGS_CODELESS_FUND_STALE');
  assert.equal(f.state.writes,0,'stale metadata must not overwrite server');
}
{
  // Historical clients without the new proof can save theme only when
  // persisted fund rows remain byte-for-byte equal.
  const f=fixture([C],[oldC,fund]);
  const result=f.save({EDITABLE_PRICES:[oldC,fund],APP_THEME:'dark'});
  assert.equal(result.status,'ok');
  assert.equal(f.state.settings.EDITABLE_PRICES[1].notes,'fund');
  const rejected=f.save({EDITABLE_PRICES:[oldC,{...fund,notes:'overwrite'}]});
  assert.equal(rejected.errorCode,'SETTINGS_CODELESS_FUND_PROOF_REQUIRED');
  assert.equal(f.state.settings.EDITABLE_PRICES[1].notes,'fund');
}
{
  // POST #1 commits, but the browser loses its response. Its automatic retry
  // carries the same ORIGINAL fund CAS proof and same requested edit.
  const f=fixture([C],[oldC,fund]);
  const requested={...fund,targetWeight:46,notes:'ack was lost'};
  const payload={EDITABLE_PRICES:[oldC,requested],
    expectedCodelessFunds:[fund],APP_THEME:'dark'};
  assert.equal(f.save(payload).status,'ok');
  assert.equal(f.save(payload).status,'ok',
    'a byte-identical fund retry after commit must be idempotent');
  assert.equal(f.state.settings.EDITABLE_PRICES[1].targetWeight,46);
  assert.equal(f.state.settings.EDITABLE_PRICES[1].notes,'ack was lost');
  assert.equal(Object.hasOwn(f.state.settings,'expectedCodelessFunds'),false);
  assert.equal(f.state.writes,1,'same fund retry must not rewrite full Settings');
}
{
  // Lost ACK: another tab changes non-fund fields after the first commit.
  // The stale retry must fail closed, without overwriting the newer values.
  const f=fixture([C],[oldC,fund],{ACCOUNTS_MASTER:[{name:'기존 계좌'}]});
  const requested={...fund,targetWeight:46,notes:'첫 요청'};
  const payload={EDITABLE_PRICES:[oldC,requested],
    expectedCodelessFunds:[fund],APP_THEME:'dark',
    ACCOUNTS_MASTER:[{name:'기존 계좌'}]};
  assert.equal(f.save(payload).status,'ok');
  f.state.settings.APP_THEME='blue';
  f.state.settings.ACCOUNTS_MASTER=[{name:'새 계좌'}];
  f.state.settings.EDITABLE_PRICES[0].notes='다른 탭 최신 메모';
  const result=f.save(payload);
  assert.equal(result.errorCode,'SETTINGS_CODELESS_FUND_STALE',
    'fund-only equality cannot acknowledge a retry after non-fund conflicts');
  assert.equal(result.alreadyApplied,undefined);
  assert.equal(f.state.writes,1,'stale retry must not rewrite Settings');
  assert.equal(f.state.settings.APP_THEME,'blue');
  assert.deepEqual(f.state.settings.ACCOUNTS_MASTER,[{name:'새 계좌'}]);
  assert.equal(f.state.settings.EDITABLE_PRICES[0].notes,'다른 탭 최신 메모');
  assert.equal(f.state.settings.EDITABLE_PRICES[1].targetWeight,46);
  assert.equal(f.state.lock,false);
}
{
  // Codex P2: a different tab independently writes the exact submitted
  // fund roster. This tab has NEVER committed its new theme/account change.
  // Matching funds are insufficient evidence of an applied Settings save.
  const requested={...fund,targetWeight:46,notes:'동일한 펀드'};
  const f=fixture([C],[oldC,requested],{
    ACCOUNTS_MASTER:[{name:'서버 기존 계좌'}]});
  const before=structuredClone(f.state.settings);
  const result=f.save({EDITABLE_PRICES:[oldC,requested],
    expectedCodelessFunds:[fund],APP_THEME:'dark',
    ACCOUNTS_MASTER:[{name:'이번 최초 요청 계좌'}]});
  assert.equal(result.errorCode,'SETTINGS_CODELESS_FUND_STALE',
    'never report success for an uncommitted first request');
  assert.equal(result.alreadyApplied,undefined);
  assert.equal(f.state.writes,0);
  assert.deepEqual(f.state.settings,before,'server theme and accounts remain untouched');
  assert.equal(f.state.lock,false);
}
{
  // The submitted fund list and theme are identical to the server, but
  // the coded security notes are newly changed in this request.
  const requested={...fund,targetWeight:46,notes:'동일한 펀드'};
  const f=fixture([C],[oldC,requested]);
  const before=structuredClone(f.state.settings);
  const result=f.save({EDITABLE_PRICES:[{...oldC,notes:'신규 변경'},requested],
    expectedCodelessFunds:[fund],APP_THEME:'light'});
  assert.equal(result.errorCode,'SETTINGS_CODELESS_FUND_STALE',
    'coded notes are part of the whole request');
  assert.equal(f.state.writes,0);
  assert.deepEqual(f.state.settings,before);
}
{
  // Deletion retry has the same property: stale old CAS, but the requested
  // empty fund roster is already exactly the durable server state.
  const f=fixture([C],[oldC,fund]);
  const payload={EDITABLE_PRICES:[oldC],expectedCodelessFunds:[fund]};
  assert.equal(f.save(payload).status,'ok');
  assert.equal(f.save(payload).status,'ok');
  assert.equal(f.state.writes,1,'deletion retry must not rewrite Settings');
  assert.deepEqual(f.state.settings.EDITABLE_PRICES.map(ep=>ep.name),['C']);
  assert.equal(f.state.settings.EDITABLE_PRICES[0].notes,'C notes');
  assert.equal(f.state.settings.EDITABLE_PRICES[0].targetWeight,20);
  assert.equal(f.state.settings.EDITABLE_PRICES[0].code,'3');
}
{
  // A tab really changed the same fund to DIFFERENT contents after our
  // first save: stale proof must still be rejected even with same name.
  const f=fixture([C],[oldC,fund]);
  const first={...fund,targetWeight:42};
  const competing={...fund,targetWeight:77};
  assert.equal(f.save({EDITABLE_PRICES:[oldC,first],
    expectedCodelessFunds:[fund]}).status,'ok');
  const stale=f.save({EDITABLE_PRICES:[oldC,competing],
    expectedCodelessFunds:[fund]});
  assert.equal(stale.errorCode,'SETTINGS_CODELESS_FUND_STALE');
  assert.equal(f.state.settings.EDITABLE_PRICES[1].targetWeight,42);
}
console.log('✅ 생산 GAS saveSettings: 교체 부분저장/타 탭/orphan·중복·누락 차단, 응답 유실 재시도·충돌 차단·비중/메모·펀드/보호키 유지');
