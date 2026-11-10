#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync('ops/issue860/preview-two-active-gate-v9289.gs','utf8');
new vm.Script(source,{filename:'preview-two-active-gate-v9289.gs'});
assert(!/\.setProperty\s*\(|\.deleteProperty\s*\(|\.setValues\s*\(|\.copyTo\s*\(/.test(source));
assert(!/UrlFetchApp\.|SpreadsheetApp\.|DriveApp\.|ScriptApp\./.test(source));
const now=Date.parse('2026-11-10T15:15:00Z');
const first=Date.parse('2026-11-10T10:33:00Z'),
 second=Date.parse('2026-11-10T11:37:00Z');
function test({version='9.289',entries=[
 ['session-A','runDailyPortfolioClose1900',first],
 ['session-B','runPortfolioCloseWatchdog2030',second]
],receipts=[],mode='OPEN'}={}) {
 const readings=[],writes=[];
 const values={
 issue507_writer_gate_v1:JSON.stringify({releaseId:'test',mode,active:Object.fromEntries(entries.map(([key,name,startedAt])=>[key,{name,startedAt}]))})
 };
 for(const key of receipts)values['issue507_writer_end_v1_'+key]='END_RECEIPT';
 const props={getProperty:k=>{readings.push(k);return values[k]??null;},
 setProperty:(...a)=>writes.push(a),deleteProperty:(...a)=>writes.push(a)};
 class FixedDate extends Date{static now(){return now;}}
 const logged=[];
 const ctx=vm.createContext({
  ISSUE507_GATE_API_VERSION:version,
  _issue507GateAtomic_:fn=>fn(props),
  _issue507GateRead_:p=>JSON.parse(p.getProperty('issue507_writer_gate_v1')),
  Utilities:{formatDate:d=>new Date(d).toISOString().slice(0,19).replace('T',' ')},
  Date:FixedDate,Logger:{log:x=>logged.push(x)},JSON,Object,String,Number,Math
 });
 vm.runInContext(source,ctx,{timeout:1000});
 let result,error;
 try{result=JSON.parse(JSON.stringify(ctx.issue860PreviewTwoActiveGateRecords()));}
 catch(e){error=String(e?.message);}
 return{result,error,writes,readings,logged};
}
const okay=test();
assert.equal(okay.result.kind,'ISSUE860_TWO_ACTIVE_GATE_PREVIEW_ONLY');
assert.equal(okay.result.activeCount,2);
assert.deepEqual(okay.result.records.map(x=>x.functionName),
 ['runDailyPortfolioClose1900','runPortfolioCloseWatchdog2030']);
assert.equal(okay.result.records[0].producerEndReceiptPresent,false);
assert.equal(okay.result.records[0].ageMinutes,282);
assert.equal(okay.result.activeCleanupAuthorized,false);
assert.equal(okay.result.approvedToDeploy9290,false);
assert.equal(okay.result.scriptPropertyWrites,0);
assert.equal(okay.writes.length,0);
assert(!JSON.stringify(okay.result).includes('session-A'));
assert(!JSON.stringify(okay.logged).includes('session-B'));
assert.equal(test({receipts:['session-B']}).result.records[1].producerEndReceiptPresent,true);
for(const scenario of [
 {version:'9.288'}, {version:'9.290'},
 {entries:[['session-A','runDailyPortfolioClose1900',first]]},
 {entries:[['A','runDailyPortfolioClose1900',first],['B','runPortfolioCloseWatchdog2030',second],['C','another',second]]},
 {entries:[['A','runDailyPortfolioClose1900',Date.parse('2026-11-09T00:00:00Z')],['B','runPortfolioCloseWatchdog2030',second]]},
 {entries:[['A','runDailyPortfolioClose1900',first],['B','runPortfolioCloseWatchdog2030',now+60000]]},
 {mode:'INVALID'}
]) {
 const res=test(scenario);
 assert.match(res.error||'',/ISSUE860_GATE_PREVIEW_/);
 assert.equal(res.writes.length,0);
}
const other=test({entries:[['A','unexpectedFunction',first],['B','runPortfolioCloseWatchdog2030',second]]});
assert.equal(other.result.records[0].functionName,'OTHER_UNRECOGNIZED');
assert.equal(other.writes.length,0);
console.log(JSON.stringify({kind:'ISSUE860_TWO_ACTIVE_GATE_OPERATOR_PREVIEW_OFFLINE_PASS',
 readOnly:true,maskedGateTokens:true,exactlyTwoRequired:true,
 staleRecordNotPruned:true,emptyReceiptsNotForged:true,
 noReleaseApproval:true,financialWrites:0,scriptPropertyWrites:0,
 gasDeployments:0,telegramSends:0}));
