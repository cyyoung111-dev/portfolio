import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {assembleOct30ReadOnlyReleaseDryRun,FROZEN_GAS_BLOB}
 from './issue507-oct30-private-gas-release-dryrun.mjs';

const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
const bundle=assembleOct30ReadOnlyReleaseDryRun(gas);
assert.equal(bundle.summary.frozenSourceBlob,FROZEN_GAS_BLOB);
assert.equal(bundle.summary.publicRouteAdded,false);
assert.equal(bundle.summary.authorizedToRunInProduction,false);
assert.equal(bundle.summary.gasDeployed,false);
const required=['_cleanCode','_normalizeDate','_isFundCode','_applyHoldingTrade',
 '_snapshotHoldingState','calcHoldingsAtDate','_calcCodeHoldingsAtDate',
 '_getDailyHeldCodeItems','_isKrxDailyCloseTarget_','getCodeItems',
 '_parseKrxNumber','fetchPricesKrx'];
function actual(name){
 const i=gas.indexOf('function '+name+'('),end=gas.indexOf('\n}',i);
 assert.ok(i>=0&&end>i, 'missing frozen production function '+name);
 return gas.slice(i,end+2);
}
const src=required.map(actual).join('\n')+'\n'+bundle.candidateSource;
new vm.Script(src);
const date='2026-10-30';
const codes=Array.from({length:37},(_,i)=>String(i+1).padStart(6,'0'));
const token='SYNTHETIC_LEGACY_TOKEN';
const secret='x'.repeat(48);
const now=1793442000000;
const Clock=class extends Date{static now(){return now;}};
function fixtures(){
 const master=codes.map((code,i)=>[code,'SYNTHETIC_NAME',i<16?'주식':'ETF',
  'SYNTHETIC_SECTOR','KRW',i<16?'KR':'ETF']);
 const trades=codes.map(code=>[date,'buy','','SYNTHETIC_NAME',
   code,1,100,'주식','','','']);
 const snapshot=codes.map(code=>[date,code,'SYNTHETIC_NAME',1,100,
  100,110,110,10,10,'KRX_CARRY@2026-10-29','']);
 snapshot.push(...['F00001','F00002'].map((code,i)=>{
  const nav=1250+i*200;
  return [date,code,'SYNTHETIC_FUND',1,1000,1000,nav,nav,
    nav-1000,(nav-1000)/10,'FUND_NAV',''];
 }));
 const history=['F00001','F00002'].map((code,i)=>[
  date,code,'SYNTHETIC_FUND',1250+i*200,'','FUND_NAV'
 ]);
 const packs={KOSPI:{rows:[],usedYmd:'20261030'},
  KOSDAQ:{rows:[],usedYmd:'20261030'},
  ETF:{rows:[],usedYmd:'20261030'}};
 codes.forEach((code,i)=>packs[i<16?'KOSPI':'ETF'].rows.push({
  ISU_SRT_CD:code,ISU_NM:'SYNTHETIC_NAME',TDD_CLSPRC:String(1000+i)
 }));
 return {master,trades,snapshot,history,packs,settings:{
  access_token:token,issue507_oct30_private_probe_enabled:'true',
  issue507_oct30_private_probe_secret:secret,
  issue507_oct30_private_probe_expires_at_ms:String(now+120000)
 }};
}
function execute(modify=()=>{}){
 const d=fixtures();let official=0,otp=0,write=0;
 modify(d);
 function sheet(rows){
  return {getLastRow:()=>rows.length+1,
   getLastColumn:()=>rows[0]?.length||6,
   getRange:(row,col,height,width)=>({
    getValues:()=>rows.slice(row-2,row-2+height).map(x=>x.slice(0,width)),
    setValues:()=>{write++;throw Error('NEVER_WRITE');}
   })};
 }
 const ss={getSheetByName:n=>({
  '종목코드':sheet(d.master),'거래이력':sheet(d.trades),
  '스냅샷':sheet(d.snapshot),'가격이력':sheet(d.history)
 })[n]||null};
 const props={getProperty:k=>d.settings[k]||'',
  setProperty:()=>{write++;throw Error('NEVER_WRITE');}};
 const env={
  _issue507GateInside_:true,Date:Clock,CONFIG:{
   SHEET_CODES:'종목코드',SHEET_TRADES:'거래이력',
   SHEET_SNAPSHOT:'스냅샷',SHEET_PH:'가격이력',TIMEZONE:'Asia/Seoul'
  },
  PropertiesService:{getScriptProperties:()=>props},
  getss:()=>ss,
  _getKrxApiConfig:()=>({apiKey:'SYNTHETIC_KRX_KEY'}),
  _getKrxAuthKeySlots_:()=>({alternative:''}),
  _krxCalendarStatus_:()=> 'OPEN',
  _fetchKrxMarketsParallelWithFallback:()=>{
   official++;const p=d.packs;return p;
  },
  fetchPricesKrxViaOtp:()=>{otp++;return {};},
  Logger:{log:()=>{}},
  Object,Array,JSON,Math,Number,String,Error,RegExp,
  isFinite,isNaN,parseFloat,parseInt,
  Utilities:{formatDate:()=>date}
 };
 const ctx=vm.createContext(env);
 vm.runInContext(src,ctx,{timeout:3000});
 const opts={purpose:'ISSUE507_OCT30_PRIVATE_SOURCE_ONLY',
  targetDate:date,proofKey:secret};
 function run(){
  return ctx._issue507Oct30GuardedPrivateReadOnlyRun_(opts);
 }
 return {run,d,getCounts:()=>({official,otp,write})};
}
const ok=execute();
const receipt=ok.run();
assert.equal(receipt.mode,'ISSUE507_OCT30_PRIVATE_MANUAL_ATTESTATION');
assert.equal(receipt.verifiedHeldCodes,37);
assert.equal(receipt.originalFinancialWrites,0);
assert.equal(receipt.writeAuthorized,false);
assert.equal(receipt.releaseAuthorized,false);
assert.equal(ok.getCounts().official,1,'one call to KRX helper from GAS');
assert.equal(ok.getCounts().otp,0,'no OTP fallback for exact KRX packs');
assert.equal(ok.getCounts().write,0);
for(const sensitive of ['000001','SYNTHETIC_NAME','SYNTHETIC_FUND',
 '1000','1036',secret,token,'SYNTHETIC_KRX_KEY']){
 assert.ok(!JSON.stringify(receipt).includes(sensitive));
}
let failed=0;
function reject(mutator,{expected,officialCalls}={}){
 const r=execute(mutator);
 assert.throws(()=>r.run(),expected||/ISSUE507_/);
 assert.equal(r.getCounts().write,0);
 if(officialCalls!==undefined)assert.equal(r.getCounts().official,officialCalls);
 failed++;
}
reject(d=>{d.settings.issue507_oct30_private_probe_enabled='false'},
 {expected:/PRIVATE_EXECUTION_DENIED/,officialCalls:0});
reject(d=>{d.settings.access_token=''},
 {expected:/PRIVATE_EXECUTION_DENIED/,officialCalls:0});
reject(d=>{d.settings.issue507_oct30_private_probe_secret='short'},
 {expected:/PRIVATE_EXECUTION_DENIED/,officialCalls:0});
reject(d=>{d.trades[0][1]='BUY'},
 {expected:/LIVE_PROOF_HELD_SCOPE/,officialCalls:0});
reject(d=>{d.trades.push([date,'sell','','RENAMED',
  '000001',1,100,'주식','','',''])},
 {expected:/LIVE_PROOF_HELD_SCOPE/,officialCalls:0});
reject(d=>{d.snapshot[0][10]='KRX'},
 {expected:/QUOTE_PROOF_SNAPSHOT_CARRY_CHANGED/,officialCalls:1});
reject(d=>{d.history[0][3]=999},
 {expected:/QUOTE_PROOF_FUND_NAV_MISMATCH/,officialCalls:1});
reject(d=>{d.packs.ETF.rows.pop()},
 {expected:/QUOTE_PROOF_SOURCE_COUNT/,officialCalls:1});
reject(d=>{d.packs.ETF.usedYmd='20261029'},
 {expected:/QUOTE_PROOF_SOURCE_NOT_EXACT/,officialCalls:1});
// Prevent quote-only success claims if a writer changed the target sheet
// while the private provider was being queried.
reject(d=>{
 const before=d.packs;
 Object.defineProperty(d,'packs',{get(){
  d.snapshot[0][10]='SYNTHETIC_EXTERNAL_WRITER';
  return before;
 }});
},{expected:/LIVE_PROOF_TARGET_CHANGED_DURING_READ/,officialCalls:1});
assert.equal(bundle.summary.financialWrites,0);
console.log(JSON.stringify({
 mode:'ISSUE507_OCT30_GAS_PRIVATE_RELEASE_COMPOSITION',
 result:'PASS',realFrozenGasFunctionsExecuted:required.length,
 privateCandidateFunctions:bundle.summary.privateFunctionCount,
 endToEndSimulatedSuccess:true,negativeCases:failed,
 officialKrxHelperCallsOnSuccess:1,financialWrites:0,
 deploys:0,authorizedToRunProduction:false
}));
