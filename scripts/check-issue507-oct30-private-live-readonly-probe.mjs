import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {DAY,FROZEN_GAS_BLOB,PRIVATE_LIVE_READONLY_FUNCTION}
 from './issue507-oct30-private-live-readonly-probe-proposal.mjs';
import {PRIVATE_GAS_FUNCTION}
 from './issue507-oct30-private-percode-proof-proposal.mjs';

// Execute the ACTUAL production code for deriving 10/30 held names/codes,
// selecting domestic markets, and the existing official aggregate endpoint.
// Substitute only network and financial sheet access with synthetic adapters.
// No run uses GAS credentials, external HTTP, a token, or physical writes.
const bytes=fs.readFileSync('src/gas/apps_script.gs');
const sha=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
assert.equal(sha,FROZEN_GAS_BLOB);
const gas=bytes.toString('utf8');
function actual(name){
 const start=gas.indexOf('function '+name+'('),end=gas.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,name+' must exist in production GAS');
 return gas.slice(start,end+2);
}
const realHeld=actual('_getDailyHeldCodeItems');
const realKrxFilter=actual('_isKrxDailyCloseTarget_');
const realAggregate=actual('handleGetKrxHeldCloseCoverage');
const realTarget=actual('_krxHeldTargetCloseEvidence_');
assert.doesNotMatch(PRIVATE_LIVE_READONLY_FUNCTION,
 /setValues\s*\(|appendRow\s*\(|setProperty\s*\(|deleteRow\s*\(|insertSheet\s*\(|UrlFetchApp|_nhPost_\s*\(/);
assert.equal(gas.includes('function _issue507Oct30PrivateLiveReadOnlyProof_('),false,
 'candidate cannot exist in live frozen GAS');
assert.equal(gas.includes('function _issue507Oct30PrivateQuoteProof_('),false);
assert.match(PRIVATE_LIVE_READONLY_FUNCTION,/fetchPricesKrx\(held,date\)/);
assert.match(PRIVATE_LIVE_READONLY_FUNCTION,/JSON\.stringify\(snapBefore\)/);
assert.match(PRIVATE_LIVE_READONLY_FUNCTION,/financialWrites:0/);

const names=Array.from({length:37},(_,i)=>String(i+1).padStart(6,'0'));
function initial(){
 const catalog=names.map((code,i)=>({
   code,name:'PRIVATE_STOCK',currency:'KRW',
   market:i<16?'KR':'ETF',type:i<16?'주식':'ETF'
 }));
 const trades=names.map(code=>[DAY,'BUY','','PRIVATE_STOCK',code,1,100,'KR','','','']);
 const snapshot=names.map(code=>[DAY,code,'PRIVATE_STOCK',1,100,100,110,110,
    10,10,'KRX_CARRY@2026-10-29','PRIVATE_STAMP']);
 for(const [code,nav] of [['F00001',1200],['F00002',1450]]){
   snapshot.push([DAY,code,'PRIVATE_FUND',1,1000,1000,nav,nav,
     nav-1000,(nav-1000)/10,'FUND_NAV','PRIVATE_STAMP']);
 }
 const history=[['F00001',1200],['F00002',1450]]
   .map(([c,v])=>[DAY,c,'PRIVATE_FUND',v,'PRIVATE_STAMP','FUND_NAV']);
 const quotes=Object.fromEntries(names.map((code,i)=>[code,{
   price:1000+i,usedDate:DAY,source:i%2?'KRX_OTP':'KRX'
 }]));
 return {catalog,trades,snapshot,history,quotes};
}
const exact=()=>initial();
let runs=0,failed=0,realSourceRuns=0;
function vmTest(data,afterFetch){
 let fetchCalls=0,sheetWriteCount=0;
 function sheet(rows,width){
   return {
     getLastRow:()=>rows.length+1,
     getLastColumn:()=>width,
     getRange:(row,col,height,w)=>({
       getValues:()=>rows.slice(row-2,row-2+height).map(x=>x.slice(0,w))
     }),
     setValues:()=>{sheetWriteCount++;throw Error('NEVER_WRITE');}
   };
 }
 const current={
  TRADES:sheet(data.trades,11),
  SNAPSHOT:sheet(data.snapshot,12),
  PRICE_HISTORY:sheet(data.history,6)
 };
 const ss={getSheetByName:name=>current[name]||null};
 const ledger=()=>Object.fromEntries(names.map(code=>[
   code,{code,name:'PRIVATE_STOCK',qty:1,costAmt:100}
 ]));
 const context={
   _issue507GateInside_:true,CONFIG:{
     SHEET_TRADES:'TRADES',SHEET_SNAPSHOT:'SNAPSHOT',SHEET_PH:'PRICE_HISTORY'
   },
   getss:()=>ss,getCodeItems:()=>data.catalog,
   _cleanCode:x=>String(x||'').trim().toUpperCase(),
   _normalizeDate:x=>String(x||'').slice(0,10),
   _isFundCode:x=>/^F\d{5}$/.test(x),
   _calcCodeHoldingsAtDate:ledger,
   today:()=> '2026-10-31',
   fetchPricesKrx:(held,date)=>{
     fetchCalls++;
     assert.equal(date,DAY);
     assert.equal(held.length,37);
     if(afterFetch)afterFetch(data);
     return data.quotes;
   },
   jsonOk:o=>({status:'ok',...o}),jsonError:message=>({status:'error',message})
 };
 const src=[
  realKrxFilter,realHeld,realTarget,realAggregate,
  PRIVATE_GAS_FUNCTION,PRIVATE_LIVE_READONLY_FUNCTION
 ].join('\n');
 const ctx=vm.createContext(context);
 vm.runInContext(src,ctx,{timeout:3000});
 const live=()=>{
   let out;
   try {out=ctx._issue507Oct30PrivateLiveReadOnlyProof_();}
   finally {assert.equal(sheetWriteCount,0);assert.equal(fetchCalls,1);}
   return out;
 };
 return {live,ctx};
}
const run=vmTest(exact());
const result=run.live();
assert.equal(result.mode,'ISSUE507_OCT30_PRIVATE_SINGLE_PASS_KRX_SOURCE');
assert.equal(result.officialExactDatePerCodeVerified,37);
assert.equal(result.stockConfirmed,16);
assert.equal(result.etfConfirmed,21);
assert.equal(result.targetRowsStableWithinRead,true);
assert.equal(result.financialWrites,0);
assert.equal(result.writeAuthorized,false);
assert.equal(result.deploymentAuthorized,undefined);
assert.equal(result.deployAuthorized,false);
const json=JSON.stringify(result);
for(const sensitive of ['000001','F00001','PRIVATE_STOCK','PRIVATE_FUND',
  'PRIVATE_STAMP','1000','1035']){
 assert.ok(!json.includes(sensitive),'Private code/price/holding in response');
}
runs++;realSourceRuns++;
// Independent production aggregate handler must also see 37 exact-day
// distinct sources with a single mock KRX read. Its targetEvidence is null,
// and the returned response cannot contain individual prices or codes.
{
 const state=exact();let calls=0;
 const direct=vmTest(state);
 // Execute actual aggregate handler in its own fake GAS session.
 const proof=direct.ctx.handleGetKrxHeldCloseCoverage(DAY,'');
 assert.equal(proof.status,'ok');
 assert.equal(proof.coverage.expectedHeldCodes,37);
 assert.equal(proof.coverage.officialExactDateCodes,37);
 assert.equal(proof.coverage.market.STOCK.confirmed,16);
 assert.equal(proof.coverage.market.ETF.confirmed,21);
 assert.equal(proof.targetEvidence,null);
 assert.ok(!JSON.stringify(proof).includes('000001'));
 realSourceRuns++;runs++;
}
function bad(edit,expected,afterFetch){
 const input=exact();edit(input);
 const test=vmTest(input,afterFetch);
 assert.throws(()=>test.live(),expected);
 failed++;runs++;
}
bad(x=>{x.quotes['000001'].usedDate='2026-10-29'},
 /ISSUE507_QUOTE_PROOF_SOURCE_NOT_EXACT/);
bad(x=>{x.quotes['000001'].source='YAHOO'},
 /ISSUE507_QUOTE_PROOF_SOURCE_NOT_EXACT/);
bad(x=>{x.quotes['000001'].price=0},
 /ISSUE507_QUOTE_PROOF_SOURCE_NOT_EXACT/);
bad(x=>{x.quotes['000001'].price=Infinity},
 /ISSUE507_QUOTE_PROOF_SOURCE_NOT_EXACT/);
bad(x=>{delete x.quotes['000001']},
 /ISSUE507_QUOTE_PROOF_SOURCE_COUNT/);
bad(x=>{x.quotes['999999']=x.quotes['000001'];delete x.quotes['000001']},
 /ISSUE507_QUOTE_PROOF_SOURCE_UNEXPECTED_CODE/);
bad(x=>{x.snapshot[0][10]='KRX'},
 /ISSUE507_QUOTE_PROOF_SNAPSHOT_CARRY_CHANGED/);
bad(x=>{x.snapshot[37][10]='FUND_NAV_CARRY'},
 /ISSUE507_QUOTE_PROOF_FUND_SNAPSHOT_CHANGED/);
bad(x=>{x.history[0][3]=1201},
 /ISSUE507_QUOTE_PROOF_FUND_NAV_MISMATCH/);
bad(x=>{x.snapshot.pop()},/ISSUE507_OCT30_LIVE_PROOF_TARGET_SCOPE/);
bad(x=>{x.history.pop()},/ISSUE507_OCT30_LIVE_PROOF_TARGET_SCOPE/);
bad(x=>{x.trades.pop()},/ISSUE507_OCT30_LIVE_PROOF_HELD_SCOPE/);
bad(x=>{x.catalog[0].market='NASDAQ'},/ISSUE507_OCT30_LIVE_PROOF_HELD_SCOPE/);
bad(x=>{x.catalog[0].type='ETF';x.catalog[0].market='ETF'},
 /ISSUE507_QUOTE_PROOF_MARKET_SCOPE_DRIFT/);
bad(x=>{},/ISSUE507_OCT30_LIVE_PROOF_TARGET_CHANGED_DURING_READ/,
 x=>{x.snapshot[0][10]='EXTERNAL_WRITER';});
bad(x=>{},/ISSUE507_OCT30_LIVE_PROOF_TARGET_CHANGED_DURING_READ/,
 x=>{x.history[0][3]=1400;});
bad(x=>{},/ISSUE507_OCT30_LIVE_PROOF_TARGET_CHANGED_DURING_READ/,
 x=>{x.snapshot[37][7]=1300;});
console.log(JSON.stringify({
 mode:'ISSUE507_OCT30_PRIVATE_SINGLE_PASS_SOURCE_TEST',
 result:'PASS',syntheticValidProofs:1,negativeCases:failed,
 actualProductionFunctionsExecuted:4,realSourceTestRuns:realSourceRuns,
 officialKRXFetchPerProof:1,verifiedHeldCodes:37,financialWrites:0,
 nhTokenRequests:0,gasDeployed:false,
 productionSourceBlob:sha.slice(0,12)
}));
