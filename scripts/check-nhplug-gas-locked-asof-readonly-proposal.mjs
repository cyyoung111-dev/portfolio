import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the exact proposed GAS handler and the actual, currently reviewed
// production v9.275 helpers together — no duplicated position reducer.
const proposal=fs.readFileSync('scripts/nhplug-gas-locked-asof-readonly-proposal.gs','utf8');
const production=fs.readFileSync('src/gas/apps_script.gs','utf8');
assert.ok(!production.includes('function nhplugHeldAsOfReadOnlyProposal('),
  'proposal has not been wired into production GAS');
assert.doesNotMatch(proposal,/\.(?:appendRow|setValue|setValues|clear|deleteRow|insertSheet|setProperty|deleteProperty)\s*\(/,
  'the proposed function must be purely read only');
assert.doesNotMatch(proposal,/(?:UrlFetchApp|SpreadsheetApp\.flush|MailApp|GmailApp|Telegram|fetch\s*\()/);
function extract(fn) {
 const start=production.indexOf('function '+fn+'('),end=production.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,fn+' is a real production function');
 return production.slice(start,end+2);
}
const helpers=['_isAuthorizedRequest','_tradeLedgerWriteUnverified_','_applyHoldingTrade','_snapshotHoldingState',
 'calcHoldingsAtDate','_calcCodeHoldingsAtDate','getCodeItems']
 .map(extract).join('\n');

const names=[
 ['005930','삼성전자','주식','KOSPI','KRW'],
 ['069500','KODEX 200','ETF','ETF','KRW'],
 ['AAPL','Apple','주식','US','USD'],
 ['F00001','펀드','펀드','KR','KRW']
];
const master=names.map(([code,name,type,market,currency])=>[code,name,type,'',currency,market]);
const trade=(date,type,name,code,qty,price=100,ratio=0)=>[date,type,'private-account',name,code,qty,price,'주식','',ratio,0];
const trades=[
 trade('2026-10-01','buy','삼성전자','005930',10),
 trade('2026-10-05','buy','삼성전자','005930',4),
 trade('2026-10-20','sell','삼성전자','005930',3),
 trade('2026-10-20','buy','KODEX 200','069500',5),
 trade('2026-10-21','split','KODEX 200','069500',0,0,2),
 trade('2026-10-23','reverse_split','KODEX 200','069500',0,0,2),
 trade('2026-10-01','buy','Apple','AAPL',1.5),
 trade('2026-10-01','buy','펀드','F00001',12.75),
 trade('2026-10-30','sell','삼성전자','005930',11)
];
const copy=v=>JSON.parse(JSON.stringify(v));
function harness({token='valid-admin-secret',provided='valid-admin-secret',busy=false,
  changeTrade=false,changeMaster=false,releaseFails=false,marketStatus='OPEN',
  initialTrades=trades,initialMaster=master,tradeReadError=false,
  journal=false,journalAtSecond=false,codeDeletePending=false,codeDeleteAtSecond=false}={}) {
 const state={locks:0,releases:0,masterReads:0,tradeReads:0,writes:0,token,
  tradeRows:copy(initialTrades),masterRows:copy(initialMaster),journalReads:0,deleteReads:0};
 const tradSheet={
  getLastRow:()=>state.tradeRows.length+1,
  getLastColumn:()=>11,
  getRange:(row,col,height,width)=>{
   assert.equal(row,2);assert.equal(col,1);assert.equal(width,11);
   assert.equal(height,state.tradeRows.length);
   return {getValues:()=>{
    state.tradeReads++;
    if(tradeReadError)throw Error('sensitive ledger read failure');
    const data=copy(state.tradeRows);
    if(changeTrade && state.tradeReads===2)data[0][5]=99;
    return data;
   }};
  }
 };
 const codeSheet={
  getLastRow:()=>state.masterRows.length+1,
  getLastColumn:()=>6,
  getRange:(row,col,height,width)=>{
   assert.equal(row,2);assert.equal(col,1);assert.equal(width,6);
   assert.equal(height,state.masterRows.length);
   return {getValues:()=>{
    state.masterReads++;
    const data=copy(state.masterRows);
    if(changeMaster && state.masterReads===2)data[0][1]='mutated';
    return data;
   }};
  }
 };
 const sheet={
  getSheetByName:n=>n==='거래이력'?tradSheet:n==='종목코드'?codeSheet:null
 };
 const lock={
  tryLock:ms=>{assert.equal(ms,5000);state.locks++;return !busy;},
  releaseLock:()=>{state.releases++;if(releaseFails)throw Error('sensitive lock error');}
 };
 const ctx=vm.createContext({
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>{
   if(k==='access_token')return token;
   if(k==='trade_ledger_write_unverified_v1'){
     state.journalReads++;return journal||(journalAtSecond&&state.journalReads===2)?'WRITING':'';
   }
   if(k==='PF_PENDING_CODE_DELETE_TXN_V1'){
     state.deleteReads++;return codeDeletePending||(codeDeleteAtSecond&&state.deleteReads===2)?'PENDING':'';
   }
   throw Error('unrecognized script property');
  }})},
  CODE_DELETE_TXN_KEY_:'PF_PENDING_CODE_DELETE_TXN_V1',
  TRADE_LEDGER_WRITE_JOURNAL_KEY:'trade_ledger_write_unverified_v1',
  LockService:{getScriptLock:()=>lock},getss:()=>sheet,
  CONFIG:{SHEET_TRADES:'거래이력',SHEET_CODES:'종목코드',TIMEZONE:'Asia/Seoul'},
  _krxCalendarStatus_:()=>marketStatus,
  _cleanCode:v=>String(v||'').trim().toUpperCase(),
  _normalizeDate:v=>String(v||'').trim().slice(0,10),
  today:()=> '2026-10-29',
  Utilities:{formatDate:()=>{throw Error('Date object fixture not used');}},
  Logger:{log:()=>{throw Error('sensitive logs forbidden')}},
  console:{log:()=>{throw Error('console logging forbidden')}}
 });
 new vm.Script(helpers+'\n'+proposal,{filename:'nhplug-proposal.gs'}).runInContext(ctx);
 const output=date=>JSON.parse(JSON.stringify(ctx.nhplugHeldAsOfReadOnlyProposal(date,provided)));
 return {output,state};
}
{
 const {output,state}=harness();
 const r=output('2026-10-29');
 assert.equal(r.status,'ok');
 assert.equal(r.mode,'READ_ONLY_PROPOSAL');
 assert.equal(r.readOnly,true);assert.equal(r.verified,false);
 assert.equal(r.ledgerSnapshot.verified,false);
 assert.equal(r.masterSnapshot.verified,false);
 assert.equal(r.listingStatusVerified,false);
 assert.deepEqual(r.ledgerSnapshot.positions,[
  {code:'005930',quantity:11},{code:'069500',quantity:5}
 ]);
 assert.deepEqual(r.masterSnapshot.items,[
  {code:'005930',kind:'STOCK',market:'KOSPI',currency:'KRW',listingState:'UNKNOWN',listingStateAsOf:null},
  {code:'069500',kind:'ETF',market:'ETF',currency:'KRW',listingState:'UNKNOWN',listingStateAsOf:null},
 ]);
 assert.deepEqual(r.blockers,['EXTERNAL_SHEETS_WRITERS_NOT_LOCKED',
  'HISTORICAL_LISTING_STATUS_UNKNOWN','REVIEWED_DEPLOYMENT_NOT_COMPLETE']);
 assert.equal(r.counts.heldDomesticCodes,2);
 assert.equal(r.counts.excludedOtherCodes,2);
 assert.equal(state.tradeReads,2);assert.equal(state.masterReads,2);
 assert.equal(state.locks,1);assert.equal(state.releases,1);assert.equal(state.writes,0);
 assert.doesNotMatch(JSON.stringify(r),/private-account|삼성전자|KODEX|Apple|valid-admin-secret|totalCost|100/);
}
for(const [opts,code] of [
 [{token:''},'AUTH_DISABLED'],
 [{provided:'wrong'},'AUTH_REQUIRED'],
 [{busy:true},'BUSY'],
 [{releaseFails:true},'LOCK_RELEASE_UNVERIFIED'],
 [{marketStatus:'CLOSED'},'MARKET_UNVERIFIED'],
 [{marketStatus:'UNKNOWN'},'MARKET_UNVERIFIED'],
 [{changeTrade:true},'SOURCE_CHANGED'],
 [{changeMaster:true},'SOURCE_CHANGED'],
 [{journal:true},'LEDGER_WRITE_UNVERIFIED'],
 [{journalAtSecond:true},'LEDGER_WRITE_UNVERIFIED'],
 [{codeDeletePending:true},'CODE_DELETE_PENDING'],
 [{codeDeleteAtSecond:true},'CODE_DELETE_PENDING'],
 [{initialMaster:[...master,copy(master[0])]},'MASTER_CONFLICT'],
 [{initialMaster:master.filter(x=>x[0]!=='005930')},'ORPHAN_HELD_CODE'],
 [{initialMaster:master.map(x=>x[0]==='005930'?[x[0],x[1],x[2],x[3],x[4],'']:x)},'MARKET_CLASSIFICATION_UNVERIFIED'],
 [{initialTrades:[trade('2026-10-01','buy','새이름','',1)]},'TRADE_CODE_UNVERIFIED'],
 [{initialTrades:[trade('2026-10-01','write','삼성전자','005930',1)]},'TRADE_TYPE_UNVERIFIED'],
 [{initialTrades:[trade('2026-10-01','buy','삼성전자','005930',-1)]},'TRADE_QTY_UNVERIFIED'],
 [{tradeReadError:true},'READ_FAILED']
]) {
 const {output,state}=harness(opts);
 const r=output('2026-10-29');
 assert.equal(r.status,'error',code);
 assert.equal(r.errorCode,'NH_HELD_'+code);
 assert.equal(state.writes,0);
 assert.doesNotMatch(JSON.stringify(r),/private|valid-admin|sensitive|삼성전자|005930/);
 if(['AUTH_DISABLED','AUTH_REQUIRED','MARKET_UNVERIFIED'].includes(code))
  assert.equal(state.locks,0,'invalid authorization/date must not acquire a lock');
 if(!['AUTH_DISABLED','AUTH_REQUIRED','MARKET_UNVERIFIED','BUSY'].includes(code))
  assert.equal(state.releases,1,'acquired lock must always be released');
}
for(const date of ['2026-02-30','2026-10-30','junk','2026-10-31']){
 const {output,state}=harness();
 const r=output(date);
 assert.equal(r.status,'error');
 assert.ok(['NH_HELD_DATE_INVALID','NH_HELD_MARKET_UNVERIFIED'].includes(r.errorCode));
 assert.equal(state.locks,0);
}
console.log('NH GAS atomic-proposal handler: locked double-read, real GAS reducer, all-failure tests passed');
