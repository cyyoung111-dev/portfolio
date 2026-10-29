import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildGasHeldUniverseCandidate,fetchGasHeldUniverseCandidate}
  from './nhplug-gas-held-universe-readonly-bridge.mjs';

const date='2026-10-29';
const master=[
 {code:'005930',name:'삼성전자',type:'주식',market:'KOSPI',currency:'KRW'},
 {code:'069500',name:'KODEX 200',type:'ETF',market:'ETF',currency:'KRW'},
 {code:'AAPL',name:'Apple',type:'주식',market:'US',currency:'USD'},
 {code:'F00001',name:'펀드',type:'펀드',market:'KR',currency:'KRW'}
];
const trades=[
 {date:'2026-10-01',tradeType:'buy',acct:'private-fixture-account',name:'삼성전자',code:'005930',qty:10,price:100,ratio:0},
 {date:'2026-10-05',tradeType:'buy',acct:'private-fixture-account-2',name:'삼성전자',code:'005930',qty:4,price:110,ratio:0},
 {date:'2026-10-20',tradeType:'sell',acct:'private-fixture-account',name:'삼성전자',code:'005930',qty:3,price:120,ratio:0},
 {date:'2026-10-20',tradeType:'buy',acct:'private-fixture-account',name:'KODEX 200',code:'069500',qty:5,price:100,ratio:0},
 {date:'2026-10-21',tradeType:'split',acct:'private-fixture-account',name:'KODEX 200',code:'069500',qty:0,price:0,ratio:2},
 {date:'2026-10-23',tradeType:'reverse_split',acct:'private-fixture-account',name:'KODEX 200',code:'069500',qty:0,price:0,ratio:2},
 {date:'2026-10-05',tradeType:'buy',acct:'private-fixture-account',name:'Apple',code:'AAPL',qty:1.5,price:130,ratio:0},
 {date:'2026-10-05',tradeType:'buy',acct:'private-fixture-account',name:'펀드',code:'F00001',qty:12.75,price:5,ratio:0},
 {date:'2026-10-30',tradeType:'sell',acct:'private-fixture-account',name:'삼성전자',code:'005930',qty:11,price:120,ratio:0}
];
const f=x=>JSON.parse(JSON.stringify(x));
const result=buildGasHeldUniverseCandidate({date,codeList:master,trades});
assert.equal(result.status,'CANDIDATE_NON_ATOMIC_UNVERIFIED');
assert.equal(result.verified,false);
assert.equal(result.readOnly,true);
assert.equal(result.counts.heldCodes,4);
assert.deepEqual(result.ledgerSnapshot.positions,[
 {code:'005930',quantity:11},{code:'069500',quantity:5},{code:'AAPL',quantity:1.5},{code:'F00001',quantity:12.75}
]);
assert.deepEqual(result.blockers,['NON_ATOMIC_GAS_READ','LISTING_STATUS_UNVERIFIED','SOURCE_PROVENANCE_UNVERIFIED']);
assert.equal(result.ledgerSnapshot.verified,false);
assert.equal(result.masterSnapshot.verified,false);
assert.ok(result.masterSnapshot.items.every(x=>x.listingState==='UNKNOWN'&&x.listingStateAsOf===null));
assert.doesNotMatch(JSON.stringify(result),/private-fixture-account|삼성전자|Apple|KODEX 200|price|totalCost|token/i);
assert.equal(result.ledgerSnapshot.verified,false,'downstream PR #704 must not treat this as a verified ledger');
assert.equal(result.masterSnapshot.verified,false,'listing state is not proven by legacy GAS endpoints');

// Compare transaction replay to production GAS reducer, using actual source
// rather than a second copy of the stock/split/sell algorithm in test code.
const source=fs.readFileSync('src/gas/apps_script.gs','utf8');
const configDeclaration=source.match(/var CONFIG\s*=\s*\{[\s\S]*?\n\};/);
assert.ok(configDeclaration,'production CONFIG exists');
const productionConfig=vm.runInNewContext(configDeclaration[0]+'\nCONFIG');
assert.equal(productionConfig.TIMEZONE,'Asia/Seoul','the date boundary contract requires KST');
function extract(name) {
 const start=source.indexOf('function '+name+'(');
 const end=source.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,name+' present in production GAS');
 return source.slice(start,end+2);
}
const context=vm.createContext({
 _normalizeDate:v=>String(v||'').trim().slice(0,10),
 Utilities:{formatDate:()=>{throw Error('unused GAS Date branch');}},
 CONFIG:productionConfig
});
for(const name of ['_cleanCode','_applyHoldingTrade','_snapshotHoldingState','calcHoldingsAtDate','_calcCodeHoldingsAtDate']){
 vm.runInContext(extract(name),context);
}
const nameToCode=Object.fromEntries(master.map(x=>[x.name,x.code]));
const rows=trades.map(x=>[x.date,x.tradeType,x.acct,x.name,x.code,x.qty,x.price,'주식','',x.ratio,0]);
const computed=context._calcCodeHoldingsAtDate(rows,date,nameToCode);
const actual=Object.values(computed).map(x=>({code:x.code,quantity:x.qty})).sort((a,b)=>a.code.localeCompare(b.code));
assert.deepEqual(JSON.parse(JSON.stringify(actual)),result.ledgerSnapshot.positions,
 'bridge parity against production GAS as-of trade replay');
const numericTrade={...trades[0],code:'5930'};
const numericResult=buildGasHeldUniverseCandidate({date,codeList:master,trades:[numericTrade]});
const numericGas=context._calcCodeHoldingsAtDate([[numericTrade.date,numericTrade.tradeType,numericTrade.acct,numericTrade.name,numericTrade.code,numericTrade.qty,numericTrade.price,'주식','',0,0]],date,nameToCode);
assert.equal(numericResult.ledgerSnapshot.positions[0].code,'005930');
assert.equal(numericResult.ledgerSnapshot.positions[0].quantity,numericGas['005930'].qty);

function bad(patch,expectedError){
 assert.throws(()=>buildGasHeldUniverseCandidate({date,codeList:master,trades:patch}),expectedError);
}
bad([{...trades[0],code:'000001'}],/NH_GAS_UNIVERSE_TRADE_CODE_NOT_IN_MASTER/);
bad([{...trades[0],code:'',name:'not in master'}],/NH_GAS_UNIVERSE_UNCODED_TRADE_AMBIGUOUS/);
bad([{...trades[0],qty:-1}],/NH_GAS_UNIVERSE_TRADE_BAD_ROW/);
bad([{...trades[0],ratio:-1,tradeType:'split'}],/NH_GAS_UNIVERSE_SPLIT_RATIO_INVALID/);
bad([{...trades[0],tradeType:'REPAIR'}],/NH_GAS_UNIVERSE_TRADE_BAD_ROW/);
assert.throws(()=>buildGasHeldUniverseCandidate({date,codeList:[...master,master[0]],trades}),/NH_GAS_UNIVERSE_MASTER_DUPLICATE_CODE/);
assert.throws(()=>buildGasHeldUniverseCandidate({date:'2026-10-31',codeList:master,trades}),/NH_GAS_UNIVERSE_DATE_UNVERIFIED/);
assert.throws(()=>buildGasHeldUniverseCandidate({date,codeList:master,trades,codeListVersion:'9.279'}),/NH_GAS_UNIVERSE_UNREVIEWED_GAS_VERSION/);

const endpoint='https://script.google.com/macros/s/TEST_DEPLOY_ID/exec';
const token='PRIVATE_TEST_26';
const makeMock=({allowProbe=false,mutateSecond=false,brokenMaster=false}={})=>{
 const actions=[],calls=[];
 const fetchImpl=async(url,opt)=>{
  assert.equal(url,endpoint);assert.equal(opt.method,'POST');assert.equal(opt.redirect,'follow');
  assert.ok(!url.includes(token),'auth token must not be URL query');
  const action=opt.body.get('action'),accessToken=opt.body.get('accessToken');
  actions.push(action);calls.push({action,accessToken});
  if(accessToken!==token)return {ok:true,json:async()=>allowProbe
    ?{status:'ok',codes:master,readOnly:true,gasVersion:'9.278'}
    :{status:'error',message:'인증 실패'}};
  if(action==='getCodeListReadOnly')return {ok:true,json:async()=>brokenMaster
    ?{status:'ok',codes:master,readOnly:false,gasVersion:'9.278'}
    :{status:'ok',codes:master,readOnly:true,gasVersion:'9.278'}};
  assert.equal(action,'getTrades');
  const count=actions.filter(x=>x==='getTrades').length;
  return {ok:true,json:async()=>({status:'ok',trades:mutateSecond&&count===2
    ?[...trades,{...trades[0],qty:11}]:trades})};
 };
 return {fetchImpl,actions,calls};
};
const safe=makeMock();
const fetched=await fetchGasHeldUniverseCandidate({date,url:endpoint,token,fetchImpl:safe.fetchImpl});
assert.deepEqual(fetched,result);
assert.deepEqual(safe.actions,['getCodeListReadOnly','getTrades','getCodeListReadOnly','getTrades']);
assert.equal(safe.calls[0].accessToken,'NH_BRIDGE_INVALID_PROBE');
assert.ok(safe.calls.slice(1).every(x=>x.accessToken===token));

const insecure=makeMock({allowProbe:true});
await assert.rejects(()=>fetchGasHeldUniverseCandidate({date,url:endpoint,token,fetchImpl:insecure.fetchImpl}),
 /NH_GAS_UNIVERSE_AUTH_GUARD_NOT_PROVEN/);
assert.deepEqual(insecure.actions,['getCodeListReadOnly'],'do not fetch ledger if endpoint allows anonymous access');

const changed=makeMock({mutateSecond:true});
await assert.rejects(()=>fetchGasHeldUniverseCandidate({date,url:endpoint,token,fetchImpl:changed.fetchImpl}),
 /NH_GAS_UNIVERSE_CONCURRENT_LEDGER_CHANGE/);
const badMaster=makeMock({brokenMaster:true});
await assert.rejects(()=>fetchGasHeldUniverseCandidate({date,url:endpoint,token,fetchImpl:badMaster.fetchImpl}),
 /NH_GAS_UNIVERSE_MASTER_UNAVAILABLE/);
await assert.rejects(()=>fetchGasHeldUniverseCandidate({date,url:'https://example.com/bad',token,fetchImpl:safe.fetchImpl}),
 /NH_GAS_UNIVERSE_URL_INVALID/);
await assert.rejects(()=>fetchGasHeldUniverseCandidate({date,url:endpoint,token:'',fetchImpl:safe.fetchImpl}),
 /NH_GAS_UNIVERSE_AUTH_REQUIRED/);
let sent=0;
await assert.rejects(()=>fetchGasHeldUniverseCandidate({date,url:endpoint,token,fetchImpl:async()=>{sent++;throw Error('private-secret '+token);}}),
 /NH_GAS_UNIVERSE_TRANSPORT_FAILED/);
assert.equal(sent,1,'never retry a network error with private data');
console.log('NH GAS existing read-only endpoints, source parity, auth, non-atomic fail-closed checks passed');

