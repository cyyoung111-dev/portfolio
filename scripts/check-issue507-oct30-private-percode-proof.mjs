import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {DAY,APPROVED_GAS_BLOB,PRIVATE_GAS_FUNCTION}
  from './issue507-oct30-private-percode-proof-proposal.mjs';

// Verify the ACTUAL production GAS blob and actual aggregate KRX proof handler.
// No GAS deployment, token issuance, network, or financial data writes.
const bytes=fs.readFileSync('src/gas/apps_script.gs');
const sha=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
assert.equal(sha,APPROVED_GAS_BLOB);
const gas=bytes.toString('utf8');
function extractProductionFunction(name){
 const anchor='function '+name+'(';
 const begin=gas.indexOf(anchor),end=gas.indexOf('\n}',begin);
 assert.ok(begin>=0&&end>begin,'missing production function: '+name);
 return gas.slice(begin,end+2);
}
const realHandler=extractProductionFunction('handleGetKrxHeldCloseCoverage');
const realTargetHelper=extractProductionFunction('_krxHeldTargetCloseEvidence_');
assert.match(realHandler,/fetchPricesKrx\(expected,date\)/);
assert.match(realHandler,/source==='KRX'\|\|source==='KRX_OTP'/);
assert.match(realHandler,/used===date/);
assert.doesNotMatch(realHandler,/\.setValues\(|\.appendRow\(|\.setProperty\(/);
assert.equal(gas.includes('function _issue507Oct30PrivateQuoteProof_('),false,
 'new scoped proof must not appear in frozen production GAS');
assert.ok(!/\.setValues\(|\.appendRow\(|\.setProperty\(|UrlFetchApp|_nhPost_/.test(PRIVATE_GAS_FUNCTION));

const held=Array.from({length:37},(_,i)=>({
 code:String(i+1).padStart(6,'0'),name:'PRIVATE_NAME',
 type:i<16?'주식':'ETF',market:i<16?'KR':'ETF',currency:'KRW'
}));
const snapshot=held.map(item=>[
 DAY,item.code,item.name,1,100,100,105,105,5,5,'KRX_CARRY@2026-10-29','STAMP_PRIVATE'
]).concat(['F00001','F00002'].map((code,i)=>[
 DAY,code,'PRIVATE_FUND',100,100,10000,i?1450:1250,15000,0,0,'FUND_NAV','STAMP_PRIVATE'
]));
const history=['F00001','F00002'].map((code,i)=>[
 DAY,code,'PRIVATE_FUND',i?1450:1250,'STAMP_PRIVATE','FUND_NAV'
]);
const quotes=Object.fromEntries(held.map((x,i)=>[x.code,{
 price:1000+i,usedDate:DAY,source:i%2?'KRX_OTP':'KRX'
}]));
const copy=()=>structuredClone({held,snapshot,history,quotes});
const clean=v=>String(v||'').trim().toUpperCase();
const normalize=v=>typeof v==='string'?v.slice(0,10):'';
const baseCtx={
 _issue507GateInside_:true,
 _cleanCode:clean,_normalizeDate:normalize,
 _isKrxDailyCloseTarget_:x=>x?.currency==='KRW'&&x?.code.length===6
};
const run=(a)=>vm.runInNewContext(
 PRIVATE_GAS_FUNCTION+'\n_issue507Oct30PrivateQuoteProof_(date,held,snapshot,history,quotes)',
 {...baseCtx,date:DAY,held:a.held,snapshot:a.snapshot,
  history:a.history,quotes:a.quotes},{timeout:3000});
const result=run(copy());
assert.equal(result.verifiedPrivateQuoteCount,37);
assert.equal(result.safeToWrite,false);
assert.equal(result.individualQuoteValuesDisclosed,false);
assert.equal(result.financialWrites,0);
for(const privateValue of ['000001','1000','PRIVATE_NAME','STAMP_PRIVATE','F00001'])
 assert.ok(!JSON.stringify(result).includes(privateValue),'private data in summary');
let count=0;
function expectBad(edit,reason){
 const a=copy();edit(a);
 assert.throws(()=>run(a),new RegExp('ISSUE507_QUOTE_PROOF_'+reason));
 count++;
}
expectBad(a=>a.quotes['000001'].usedDate='2026-10-29','SOURCE_NOT_EXACT');
expectBad(a=>a.quotes['000001'].source='KRX_CARRY','SOURCE_NOT_EXACT');
expectBad(a=>a.quotes['000001'].source='YAHOO','SOURCE_NOT_EXACT');
expectBad(a=>a.quotes['000001'].price=0,'SOURCE_NOT_EXACT');
expectBad(a=>a.quotes['000001'].price='Infinity','SOURCE_NOT_EXACT');
expectBad(a=>delete a.quotes['000001'],'SOURCE_COUNT');
expectBad(a=>{a.quotes['999999']=a.quotes['000001'];delete a.quotes['000001']},'SOURCE_UNEXPECTED_CODE');
expectBad(a=>a.snapshot[0][1]=a.snapshot[1][1],'SNAPSHOT_DUPLICATE');
expectBad(a=>a.snapshot[0][10]='KRX','SNAPSHOT_CARRY_CHANGED');
expectBad(a=>a.snapshot[0][3]=0,'SNAPSHOT_CARRY_CHANGED');
expectBad(a=>a.snapshot[37][10]='FUND_NAV_CARRY','FUND_SNAPSHOT_CHANGED');
expectBad(a=>a.history[0][0]='2026-10-29','HISTORY_DATE');
expectBad(a=>a.history[0][3]=0,'HISTORY_NOT_FUND_ONLY');
expectBad(a=>a.history[0][3]=1251,'FUND_NAV_MISMATCH');
expectBad(a=>{a.history[0][1]='F00002';a.history[0][3]=1450},'HISTORY_NOT_FUND_ONLY');
expectBad(a=>a.snapshot.push([...a.snapshot[0]]),'INVALID_SCOPE');
expectBad(a=>a.held.pop(),'INVALID_SCOPE');
expectBad(a=>{a.held[0].type='ETF';a.held[0].market='ETF'},'MARKET_SCOPE_DRIFT');
expectBad(a=>a.snapshot[0][0]='2026-10-29','SNAPSHOT_DATE');

const realCtx={
 ...baseCtx,
 today:()=> '2026-10-31',getss:()=>({getSheetByName:()=>({
  getLastRow:()=>2,getLastColumn:()=>11,getRange:()=>({getValues:()=>[]})})}),
 getCodeItems:()=>held,
 _getDailyHeldCodeItems:()=>held,
 _calcCodeHoldingsAtDate:()=>({}),
 _isFundCode:x=>/^F\d{5}$/.test(x),
 fetchPricesKrx:()=>quotes,
 CONFIG:{SHEET_TRADES:'거래이력'},
 jsonOk:x=>({status:'ok',...x}),
 jsonError:message=>({status:'error',message})
};
const real=vm.runInNewContext(realTargetHelper+'\n'+realHandler+'\nhandleGetKrxHeldCloseCoverage("2026-10-30","")',
 realCtx,{timeout:3000});
assert.equal(real.status,'ok');
assert.equal(real.coverage.expectedHeldCodes,37);
assert.equal(real.coverage.officialExactDateCodes,37);
assert.equal(real.coverage.market.STOCK.confirmed,16);
assert.equal(real.coverage.market.ETF.confirmed,21);
assert.equal(real.coverage.ready,true);
assert.equal(real.targetEvidence,null);
assert.ok(!JSON.stringify(real).includes('1000')&&!JSON.stringify(real).includes('PRIVATE_NAME'));
console.log(JSON.stringify({mode:'ISSUE507_PRIVATE_KRX_PER_CODE_SOURCE_CONTRACT',
 result:'PASS',negativeCases:count,actualGASAggregateHandlerExecuted:true,
 privatePerCodeSyntheticQuotes:37,financialWrites:0,nhTokenRequests:0,
 gasDeploy:false,sourceBlob:sha.slice(0,12)}));
