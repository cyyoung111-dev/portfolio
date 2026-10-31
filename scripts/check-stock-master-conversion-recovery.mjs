import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the real GAS handler, single-cell writer and persisted recovery
// function. A successful Codes deletion must NEVER destroy the converted
// fund's original targetWeight/notes on a crash or lost HTTP response.
const gas=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
const helperStart=gas.indexOf('function _writeCodeDeleteEditablesOnly_(');
const helperEnd=gas.indexOf('// 스프레드시트 소유자가',helperStart);
const handlerStart=gas.indexOf('function handleDeleteUnreferencedCode(');
const handlerEnd=gas.indexOf('\nfunction handleSyncCodes(',handlerStart);
assert.ok(helperStart>=0&&helperEnd>helperStart&&handlerStart>helperEnd&&handlerEnd>handlerStart);
const prod=gas.slice(helperStart,helperEnd)+'\n'+gas.slice(handlerStart,handlerEnd);
const base={name:'원종목',code:'001234',assetType:'주식',sector:'기타',
  currency:'KRW',market:'KR',targetWeight:37,notes:'original memo',
  customFlags:{locked:true}};
const other={name:'무관한 TDF',code:'',assetType:'TDF',targetWeight:25,notes:'other'};
const dest={name:'원종목',code:'',assetType:'펀드',sector:'기타',currency:'KRW',market:'KR'};
const metadata={name:'원종목',code:'001234',type:'주식',sector:'기타',currency:'KRW',market:'KR'};
const clone=x=>structuredClone(x);
function fixture(opts={}) {
  const state={
    codes:[clone(metadata)],
    cells:[['키','값'],['LOAN',JSON.stringify({balance:357000000})],
      ['EDITABLE_PRICES',JSON.stringify([base,other])],
      ['DIVDATA',JSON.stringify({amount:777})]],
    props:new Map(),settingsWrites:0,codeDeletes:0,revision:0,
    throwCodeBefore:!!opts.codeBefore,throwCodeAfter:!!opts.codeAfter,
    throwSettings:!!opts.settingsOnce,throwClear:!!opts.clearOnce,
    throwRevisionOnce:!!opts.revisionOnce,
    failChunkOnce:!!opts.failChunkOnce,
    failChunkAt:Number(opts.failChunkAt||0),chunkWrites:0,
    locked:false,wholeClear:0
  };
  if(opts.longNotes)state.cells[2][1]=JSON.stringify([{...base,notes:'한'.repeat(
    opts.extremeNotes ? 4000 : 1800)},other]);
  if(opts.duplicateName)state.cells[2][1]=JSON.stringify([base,other,{name:'새펀드',code:'',assetType:'TDF'}]);
  if(opts.noOriginal)state.cells[2][1]=JSON.stringify([other]);
  const codeRows=()=>state.codes.map(x=>[x.code,x.name,x.type,x.sector,x.currency,x.market]);
  const sheetSettings={
    getLastRow:()=>state.cells.length,
    getRange(r,c,n=1,w=1){return {
      getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>state.cells[r+i-1]?.[c+j-1]??'')),
      getValue:()=>state.cells[r-1]?.[c-1]??'',
      setValue(v){if(state.throwSettings){state.throwSettings=false;throw Error('INJECTED_SETTINGS_WRITE');}
        state.settingsWrites++;state.cells[r-1][c-1]=v;},
      clearContent(){state.wholeClear++;throw Error('WHOLE_SETTINGS_CLEAR_FORBIDDEN');}
    }}
  };
  const sheetCodes={
    getLastRow:()=>state.codes.length+1,getLastColumn:()=>6,
    getRange(r,c,n=1,w=1){return {
      getValues:()=>Array.from({length:n},(_,i)=>codeRows()[r+i-2]?.slice(c-1,c-1+w)||Array(w).fill('')),
      setValues:rows=>rows.forEach((row,i)=>{const cols=codeRows()[r+i-2]||Array(6).fill('');
        row.forEach((v,j)=>{cols[c-1+j]=v;});
        state.codes[r+i-2]={code:cols[0],name:cols[1],type:cols[2],
          sector:cols[3],currency:cols[4],market:cols[5]};})
    }},
    deleteRow(r){
      state.codeDeletes++;
      if(state.throwCodeBefore){state.throwCodeBefore=false;throw Error('CRASH_BEFORE_ROW_DELETE');}
      state.codes.splice(r-2,1);
      if(state.throwCodeAfter){state.throwCodeAfter=false;throw Error('CRASH_AFTER_ROW_DELETE');}
    },
    insertRowBefore(r){state.codes.splice(r-2,0,{})}
  };
  const ss={getSheetByName:key=>key==='Codes'?sheetCodes:key==='Settings'?sheetSettings:null};
  const properties={
    getProperty:k=>state.props.get(k)||null,
    setProperty:(k,v)=>{
      if(Buffer.byteLength(v,'utf8')>9000)throw Error('SCRIPT_PROPERTY_VALUE_TOO_LARGE');
      if(k.includes('_PART_')) {
        state.chunkWrites++;
        if(state.failChunkOnce || (state.failChunkAt && state.chunkWrites===state.failChunkAt)) {
          state.failChunkOnce=false;
          throw Error('INJECTED_CHUNK_WRITE_FAILURE');
        }
      }
      state.props.set(k,v);
    },
    getProperties:()=>Object.fromEntries(state.props),
    deleteProperty:k=>{
      if(k==='PF_PENDING_CODE_DELETE_TXN_V1' && state.codes.length===0
          && state.revision===0)
        throw Error('PREMATURE_MARKER_RETIRE_BEFORE_HISTORY_REVISION');
      if(state.throwClear){state.throwClear=false;throw Error('CRASH_AFTER_SETTINGS_SAVE');}
      state.props.delete(k);
    }
  };
  const ctx={
    CONFIG:{SHEET_SETTINGS:'Settings',SHEET_CODES:'Codes'},
    SpreadsheetApp:{flush(){}},PropertiesService:{getScriptProperties:()=>properties},
    LockService:{getScriptLock:()=>({
      waitLock(){assert.equal(state.locked,false);state.locked=true;},
      releaseLock(){assert.equal(state.locked,true);state.locked=false;}
    })},
    getss:()=>ss,
    getCodeItems:()=>clone(state.codes),
    _cleanCode:x=>String(x||'').trim().toUpperCase(),
    _portfolioCodeMasterSourceIdentity_:()=>opts.wrongSource?'sheet-B':'sheet-A',
    _portfolioNormalizeCodeMasterSnapshot_:rows=>{
      if(!Array.isArray(rows))return '';
      const names=new Set(),codes=new Set();
      for(const x of rows){if(!x.name||!x.code||names.has(x.name)||codes.has(x.code))return '';
        names.add(x.name);codes.add(x.code);}
      return JSON.stringify(rows.map(x=>[x.name,x.code,x.type,x.sector,x.currency,x.market]).sort());
    },
    handleGetTrades:()=>({getContent:()=>JSON.stringify({status:'ok',trades:opts.referenced?[{name:'원종목',code:'001234'}]:[]})}),
    handleGetHoldings:()=>({getContent:()=>JSON.stringify({status:'ok',holdings:[]})}),
    _readSettingsMap:()=>Object.fromEntries(state.cells.slice(1).map(([k,v])=>[k,JSON.parse(v)])),
    _parseJsonParam:x=>JSON.parse(x),
    jsonError:(message,extra={})=>({status:'error',message,...extra}),
    jsonOk:extra=>({status:'ok',...extra}),
    _touchSnapshotIntegritySourceRevision:()=>{
      if(state.throwRevisionOnce){
        state.throwRevisionOnce=false;
        throw Error('INJECTED_HISTORY_REVISION_WRITE_FAILED');
      }
      state.revision++;
    }
  };
  vm.createContext(ctx);
  vm.runInContext(prod,ctx);
  const submit=(conversion=dest)=>ctx.handleDeleteUnreferencedCode(JSON.stringify({
    name:'원종목',code:'001234',expectedSourceId:'sheet-A',
    expectedCodes:[metadata],...(conversion?{conversion}: {})
  }));
  return {state,ctx,submit,settle:()=>ctx._settlePendingCodeDeleteLocked_(ss),
    settings:()=>ctx._readSettingsMap(),marker:()=>state.props.get('PF_PENDING_CODE_DELETE_TXN_V1'),
    parts:()=>[...state.props].filter(([k])=>k.includes('_PART_'))};
}
function checkConverted(t,name='원종목',expectedNotes='original memo') {
  const all=t.settings().EDITABLE_PRICES;
  const item=all.find(x=>x.name===name);
  assert.ok(item,'converted fund exists');
  assert.equal(item.code,'');
  assert.equal(item.assetType,'펀드');
  assert.equal(item.targetWeight,37);
  assert.equal(item.notes,expectedNotes);
  assert.deepEqual(item.customFlags,{locked:true});
  assert.deepEqual(all.find(x=>x.name==='무관한 TDF'),other);
  assert.deepEqual(t.settings().LOAN,{balance:357000000});
  assert.deepEqual(t.settings().DIVDATA,{amount:777});
  assert.equal(t.state.wholeClear,0);
}
{
  const t=fixture();
  assert.equal(t.submit().status,'ok');
  assert.equal(t.state.codes.length,0);
  checkConverted(t);
  assert.equal(t.marker(),undefined);
  assert.equal(t.state.settingsWrites,1);
  assert.equal(t.state.revision,1,'history revision must be committed before marker retirement');
  assert.equal(t.state.locked,false);
}
{
  const t=fixture({codeAfter:true});
  assert.equal(t.submit().status,'error');
  assert.equal(t.state.codes.length,0,'row was deleted before execution died');
  assert.ok(t.marker(),'durable transaction survived crash');
  assert.equal(t.settings().EDITABLE_PRICES[0].code,'001234','Settings still old at crash');
  assert.equal(t.settle().resolution,'completed');
  checkConverted(t);
  assert.equal(t.state.revision,1,'restart settles snapshot/history revision before marker');
  assert.equal(t.marker(),undefined);
  assert.equal(t.settle().pending,false,'recovery is idempotent');
}
{
  const t=fixture({codeAfter:true,longNotes:true});
  assert.equal(t.submit().status,'error');
  assert.ok(t.marker(),'long Korean notes still fit compact pre-delete marker');
  assert.ok(Buffer.byteLength(t.marker(),'utf8')<9000,'duplicated user fields would breach 9KB property limit');
  assert.equal(t.settle().resolution,'completed');
  assert.equal(t.settings().EDITABLE_PRICES.find(x=>x.name==='원종목').notes,'한'.repeat(1800));
  assert.deepEqual(t.settings().LOAN,{balance:357000000});
}
{
  const t=fixture({codeAfter:true,longNotes:true,extremeNotes:true});
  assert.equal(t.submit().status,'error','4000 Korean characters must not block staging');
  const pointer=JSON.parse(t.marker());
  assert.ok(pointer.settingsParts?.count>1,'oversize Settings evidence is chunked');
  assert.equal(pointer.settingsEntry,null,'no duplicate monolithic entry');
  assert.ok(Buffer.byteLength(t.marker(),'utf8')<9000);
  assert.ok(t.parts().every(([,val])=>Buffer.byteLength(val,'utf8')<9000));
  assert.equal(t.settle().resolution,'completed','restart reassembles exact original');
  checkConverted(t,'원종목','한'.repeat(4000));
  assert.equal(t.marker(),undefined);
  assert.equal(t.parts().length,0,'verified retirement cleans split keys');
}
{
  const t=fixture({codeAfter:true,longNotes:true,extremeNotes:true});
  assert.equal(t.submit().status,'error');
  const partKey=t.parts()[0][0];
  t.state.props.delete(partKey);
  assert.throws(()=>t.settle(),/CODE_DELETE_TXN_PART_MISSING/);
  assert.ok(t.marker(),'missing recovery fragment must preserve pointer');
  assert.equal(t.state.settingsWrites,0,'never commit incomplete user metadata');
  assert.equal(t.state.codes.length,0,'partial server commit is not faked as rolled back');
}
{
  const t=fixture({codeAfter:true,longNotes:true,extremeNotes:true});
  assert.equal(t.submit().status,'error');
  const [partKey,bytes]=t.parts()[0];
  t.state.props.set(partKey,bytes.slice(1));
  assert.throws(()=>t.settle(),/CODE_DELETE_TXN_PARTS_LENGTH_MISMATCH/);
  assert.ok(t.marker());
  assert.equal(t.state.settingsWrites,0);
}
{
  const t=fixture({codeAfter:true,longNotes:true,extremeNotes:true});
  assert.equal(t.submit().status,'error');
  const [partKey,bytes]=t.parts()[0];
  t.state.props.set(partKey,bytes.replace('한','가'));
  assert.equal(t.state.props.get(partKey).length,bytes.length);
  assert.throws(()=>t.settle(),/CODE_DELETE_TXN_PARTS_HASH_MISMATCH/,
    'same-length but different metadata bytes are never accepted');
  assert.ok(t.marker(),'corruption cannot retire the recovery pointer');
  assert.equal(t.state.settingsWrites,0);
}
{
  const t=fixture({longNotes:true,extremeNotes:true,failChunkAt:2});
  assert.equal(t.submit().status,'error','partial multi-key write aborts before code delete');
  assert.equal(t.state.codeDeletes,0);
  assert.equal(t.marker(),undefined);
  assert.equal(t.parts().length,0,'already written chunks must roll back');
}
{
  const t=fixture({longNotes:true,extremeNotes:true});
  t.state.props.set('PF_PENDING_CODE_DELETE_TXN_V1_PART_orphan_0','old-crash');
  assert.equal(t.submit().status,'ok');
  assert.equal(t.parts().length,0,'next locked request reclaims pre-pointer crash orphans');
  checkConverted(t,'원종목','한'.repeat(4000));
}
{
  const t=fixture({longNotes:true,extremeNotes:true,failChunkOnce:true});
  assert.equal(t.submit().status,'error','failed journal fragment blocks delete');
  assert.equal(t.state.codeDeletes,0,'no server mutation before durable marker');
  assert.equal(t.marker(),undefined);
  assert.equal(t.parts().length,0,'partial marker fragments cleaned');
  assert.equal(t.submit().status,'ok','retry with full evidence succeeds');
  checkConverted(t,'원종목','한'.repeat(4000));
}
{
  const t=fixture({codeBefore:true,longNotes:true,extremeNotes:true});
  assert.equal(t.submit().status,'error');
  assert.ok(t.parts().length>1);
  assert.equal(t.settle().resolution,'rolled_back','before row delete preserves original long note');
  assert.equal(t.state.codes.length,1);
  assert.equal(t.settings().EDITABLE_PRICES[0].notes,'한'.repeat(4000));
  assert.equal(t.parts().length,0);
}
{
  const t=fixture({codeBefore:true});
  assert.equal(t.submit().status,'error');
  assert.equal(t.state.codes.length,1);
  assert.equal(t.settle().resolution,'rolled_back','no deletion means original preserved');
  assert.deepEqual(t.settings().EDITABLE_PRICES[0],base);
  assert.equal(t.state.settingsWrites,0);
}
{
  const t=fixture({clearOnce:true});
  assert.equal(t.submit().status,'error','cleanup exception emulates process ending after Settings save');
  assert.equal(t.state.codes.length,0);
  checkConverted(t);
  assert.ok(t.marker());
  assert.equal(t.settle().resolution,'completed','restart recognizes already converted entry');
  assert.equal(t.state.settingsWrites,1,'idempotent replay never rewrites converted entry');
}
{
  const t=fixture({revisionOnce:true});
  assert.equal(t.submit().status,'error',
    'history revision failure must not retire committed Codes/Settings evidence');
  assert.equal(t.state.codes.length,0);
  assert.equal(t.state.revision,0);
  assert.ok(t.marker(),'pending marker survives revision write failure');
  checkConverted(t);
  assert.equal(t.settle().resolution,'completed',
    'retry writes history revision then clears marker');
  assert.equal(t.state.revision,1);
  assert.equal(t.marker(),undefined);
}
{
  const t=fixture({clearOnce:true});
  assert.equal(t.submit().status,'error');
  assert.ok(t.marker(),'forced stop at pointer removal leaves marker');
  assert.equal(t.state.revision,1,
    'history revision must already be written before interrupted marker cleanup');
  assert.equal(t.settle().resolution,'completed');
  assert.ok(t.state.revision>=1,'post-crash history remains invalidated');
}
{
  const t=fixture({settingsOnce:true});
  assert.equal(t.submit().status,'error','Settings write failure must compensate');
  assert.equal(t.state.codes.length,1,'compensate code row');
  assert.deepEqual(t.settings().EDITABLE_PRICES[0],base,'compensate custom metadata');
  assert.equal(t.marker(),undefined,'successful compensation retires marker');
}
{
  const t=fixture({duplicateName:true});
  const result=t.submit({...dest,name:'새펀드'});
  assert.equal(result.errorCode,'CODE_CONVERT_NAME_CONFLICT');
  assert.equal(t.state.codeDeletes,0);
  assert.equal(t.state.settingsWrites,0);
}
{
  const t=fixture({noOriginal:true});
  assert.equal(t.submit().errorCode,'CODE_CONVERT_INVALID');
  assert.equal(t.state.codeDeletes,0,'missing source metadata refuses conversion');
}
{
  const t=fixture({referenced:true});
  assert.equal(t.submit().errorCode,'CODE_DELETE_REFERENCED');
  assert.equal(t.state.codeDeletes,0);
}
{
  const t=fixture();
  assert.equal(t.submit(null).status,'ok','legacy ordinary deletion remains supported');
  assert.equal(t.state.codes.length,0);
  assert.deepEqual(t.settings().EDITABLE_PRICES,[other],'ordinary deletion must not add a fund');
}
console.log('✅ 실제 GAS 무코드 전환: history revision 선확정·강제종료/실패 재개·4000자 분할·원본 보존');
