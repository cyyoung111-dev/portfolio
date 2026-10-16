import assert from 'node:assert/strict';
import {assertSourceOnlyMismatch,assertBaselineValid,assertBackupCapacity,
  runSourceOnlyRepair} from './repair-krx-holiday-baseline-source.mjs';

const D='2026-10-08',token='DO_NOT_ECHO_THIS_TOKEN';
const dateCodes=[...Array.from({length:37},(_,i)=>'X'+String(i).padStart(5,'0')),
  'F00001','F00002'];
const expectedRows=dateCodes.map((code,i)=>[D,code,'상품'+code,code.startsWith('F')?1:10,
  100,code.startsWith('F')?1000:1000,code.startsWith('F')?3000:200,
  code.startsWith('F')?3000:2000,code.startsWith('F')?2000:1000,100,
  code.startsWith('F')?'FUND_NAV':'KRX','']);
const storedRows=expectedRows.map(x=>x.slice());
storedRows[37][10]='FUND_NAV_CARRY@2026-10-07';
storedRows[38][10]='FUND_NAV_CARRY@2026-10-06';
const empty=()=>[];
const before={date:D,status:'MISMATCH',expectedRowCount:39,storedRowCount:39,
  expectedRows,storedRows,sourceMismatches:[
    {code:'F00001',expected:'FUND_NAV',stored:storedRows[37][10]},
    {code:'F00002',expected:'FUND_NAV',stored:storedRows[38][10]}],
  duplicateKeys:[],conflictKeys:[],missingCodes:[],unexpectedCodes:[],
  qtyMismatches:[],costAmtMismatches:[],evalUnitMismatches:[],
  evalAmtMismatches:[],sourceDataErrors:[]};
const after={...before,status:'VALID',storedRows:expectedRows,sourceMismatches:[]};
assert.equal(assertSourceOnlyMismatch(before).protectedFundCodes.length,2);
assert.equal(assertBaselineValid(after).storedRows,39);
assert.throws(()=>assertSourceOnlyMismatch({...before,
  qtyMismatches:[{code:'X00001'}]}),/SOURCE_ONLY_PREFLIGHT_NOT_EXACT/);
assert.throws(()=>assertSourceOnlyMismatch({...before,
  sourceMismatches:[{code:'F00001'}]}),/SOURCE_ONLY_PREFLIGHT_NOT_EXACT/);
const wrongNumeric=storedRows.map(x=>x.slice());wrongNumeric[1][7]+=1;
assert.throws(()=>assertSourceOnlyMismatch({...before,storedRows:wrongNumeric}),
  /SOURCE_ONLY_NUMERIC_CHANGE/);
const manual=storedRows.map(x=>x.slice());manual[37][10]='MANUAL';
assert.throws(()=>assertSourceOnlyMismatch({...before,storedRows:manual}),
  /SOURCE_ONLY_FUND_SOURCE/);
const cap={status:'ok',workbook:{remainingCells:250000,
  sheets:[{name:'스냅샷',lastRow:10445,lastColumn:12}]}};
assert.ok(assertBackupCapacity(cap).minimumSafeCells>125000);
assert.throws(()=>assertBackupCapacity({...cap,workbook:{
  ...cap.workbook,remainingCells:1000}}),/SOURCE_ONLY_BACKUP_CAPACITY_LOW/);
const url='https://script.google.com/macros/s/example/exec';
let diagCount=0,actions=[],writeCount=0;
const fake=async(_url,options)=>{
  const params=options.body,action=params.get('action');
  actions.push(action);
  assert.ok(['diagnoseSnapshotIntegrity','diagnoseWorkbookCells',
    'rewriteSnapshotDate'].includes(action));
  assert.equal(options.method,'POST');
  if(params.get('accessToken')!==token)return{ok:true,json:async()=>({
    status:'error',message:'인증 실패'})};
  if(action==='diagnoseSnapshotIntegrity'){
    diagCount++;
    return{ok:true,json:async()=>({status:'ok',
      diagnostic:writeCount?after:before})};
  }
  if(action==='diagnoseWorkbookCells')return{ok:true,json:async()=>cap};
  assert.equal(params.get('date'),D);
  assert.equal(params.get('finalize'),'1');
  writeCount++;
  return{ok:true,json:async()=>({status:'ok',rewritten:true,before,after})};
};
const dry=await runSourceOnlyRepair({url,token,fetchImpl:fake});
assert.equal(dry.mode,'DRY_RUN');
assert.equal(writeCount,0);
assert.deepEqual(actions,['diagnoseSnapshotIntegrity',
  'diagnoseSnapshotIntegrity','diagnoseWorkbookCells']);
actions=[];diagCount=0;
const applied=await runSourceOnlyRepair({url,token,apply:true,fetchImpl:fake});
assert.equal(applied.mode,'APPLIED');
assert.equal(writeCount,1);
assert.deepEqual(actions,['diagnoseSnapshotIntegrity',
  'diagnoseSnapshotIntegrity','diagnoseWorkbookCells',
  'rewriteSnapshotDate','diagnoseSnapshotIntegrity']);
assert.equal((await runSourceOnlyRepair({url,token,apply:true,fetchImpl:fake})).mode,'ALREADY_VALID');
assert.equal(writeCount,1,'repeat must not rewrite a valid date');
assert.doesNotMatch(JSON.stringify(applied),/DO_NOT_ECHO_THIS_TOKEN/);
console.log('KRX Oct08 fund source-only guarded rewrite: authorization, numeric/data protection, backup capacity, idempotence PASS');
