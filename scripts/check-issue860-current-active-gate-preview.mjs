#!/usr/bin/env node
// VM proof: real source is read-only even if 3 Active -> 4 while investigating.
// This is a static/operator preview, not a remote ScriptProperties mutation.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const file='ops/issue860/preview-current-active-gate-v9289.gs';
const source=fs.readFileSync(file,'utf8');
new vm.Script(source,{filename:file});
for(const unsafe of [
 /\.setProperty\s*\(/,/\.deleteProperty\s*\(/,/\.setValues\s*\(/,
 /ScriptApp\./,/UrlFetchApp\./,/DriveApp\./,/SpreadsheetApp\./,
 /\.setProperty\s*\(/,/\.setProperties\s*\(/
])assert.equal(unsafe.test(source),false,'read-only source contract');

const NOW=Date.parse('2026-11-11T00:15:00Z');
const times=[
 Date.parse('2026-11-10T10:33:17Z'),
 Date.parse('2026-11-10T11:37:03Z'),
 Date.parse('2026-11-10T23:01:00Z'),
 Date.parse('2026-11-10T23:38:00Z')
];
const makeEntries=()=>[
 ['t1','runDailyPortfolioClose1900',times[0]],
 ['t2','runPortfolioCloseWatchdog2030',times[1]],
 ['t3','runPendingTradeSnapshotRebuild',times[2]],
 ['t4','anotherNonFinancialWriter',times[3]]
];
function run({entries=makeEntries().slice(0,3),receipts={},version='9.289',
 mode='OPEN',finished=15}={}){
 const read=[],writes=[],logs=[];
 const active=Object.fromEntries(entries.map(([key,name,startedAt])=>[key,{name,startedAt}]));
 const state={releaseId:'test-release',mode,active,completed:[],finished,barrierAt:NOW};
 const values={'issue507_writer_gate_v1':JSON.stringify(state)};
 for(const [key,value] of Object.entries(receipts))
   values['issue507_writer_end_v1_'+key]=value;
 const properties={
  getProperty:key=>{read.push(key);return values[key]??null;},
  setProperty:(...args)=>writes.push(args),
  deleteProperty:(...args)=>writes.push(args)
 };
 class Clock extends Date{static now(){return NOW;}}
 const context=vm.createContext({
  ISSUE507_GATE_API_VERSION:version,
  _issue507GateAtomic_:fn=>fn(properties),
  _issue507GateRead_:props=>JSON.parse(props.getProperty('issue507_writer_gate_v1')),
  Date:Clock,Utilities:{formatDate:d=>new Date(d).toISOString().slice(0,19).replace('T',' ')},
  Logger:{log:x=>logs.push(x)},JSON,Object,Number,Math
 });
 vm.runInContext(source,context,{timeout:500});
 let output=null,error=null;
 try{output=JSON.parse(JSON.stringify(context.issue860PreviewCurrentActiveGateRecords()));}
 catch(e){error=String(e?.message||'UNKNOWN');}
 return{output,error,read,writes,logs};
}
const ok=run();assert.equal(ok.error,null);assert.equal(ok.output.recordedActive,3);
assert.deepEqual(ok.output.records.map(x=>x.functionName),[
 'runDailyPortfolioClose1900','runPortfolioCloseWatchdog2030',
 'runPendingTradeSnapshotRebuild'
]);
assert(ok.output.records.every(x=>x.producerReceipt==='ABSENT'));
assert.equal(ok.output.financialWrites,0);
assert.equal(ok.output.scriptPropertyWrites,0);
assert.equal(ok.output.activeCleanupAuthorized,false);
assert.equal(ok.output.processTerminalVerified,false);
assert.equal(ok.output.deployAuthorized,false);
assert.equal(ok.writes.length,0);
assert(!JSON.stringify(ok.output).includes('t1'));
assert(!JSON.stringify(ok.logs).includes('t3'));
const expanded=run({entries:makeEntries()});
assert.equal(expanded.output.recordedActive,4);
assert.equal(expanded.output.records[3].functionName,'OTHER_UNRECOGNIZED');
assert.equal(expanded.writes.length,0);
const empty=run({entries:[]});
assert.equal(empty.output.recordedActive,0);
assert.equal(empty.output.deployAuthorized,false); // zero alone is not authorization

const goodReceipt=JSON.stringify({releaseId:'test-release',token:'t1',
 name:'runDailyPortfolioClose1900',startedAt:times[0],
 endedAt:times[0]+350000,state:'ENDED',acknowledged:false});
const acknowledged=run({receipts:{t1:goodReceipt}});
assert.equal(acknowledged.output.records[0].producerReceipt,'VALID_ENDED');
assert.equal(acknowledged.writes.length,0);
assert.equal(run({receipts:{t1:'not json'}}).output.records[0].producerReceipt,'INVALID_JSON');
assert.equal(run({receipts:{t1:JSON.stringify({...JSON.parse(goodReceipt),token:'another'})}}).output.records[0].producerReceipt,'MISMATCH');
for(const scenario of [
 {version:'9.288'},{version:'9.290'},{mode:'CLOSED'},
 {entries:[['old','runDailyPortfolioClose1900',Date.parse('2026-10-01T00:00:00Z')]]},
 {entries:[['future','runDailyPortfolioClose1900',NOW+10000]]},
 {entries:Array.from({length:25},(_,i)=>['id'+i,'writer',times[0]])}
]){
 const res=run(scenario);
 assert.match(res.error||'',/ISSUE860_GATE_PREVIEW_/);
 assert.equal(res.writes.length,0);
}
console.log(JSON.stringify({kind:'ISSUE860_CURRENT_GATE_PREVIEW_SOURCE_ONLY_PASS',
 observedThreeAndGrowing:true,handlesLiveChangeWithoutCleanup:true,
 masksTokens:true,strictReceiptValidation:true,zeroActiveNotDeployApproval:true,
 protectedSourceFunctions:0,financialWrites:0,scriptPropertyWrites:0,
 gasDeployments:0,telegramSends:0}));
