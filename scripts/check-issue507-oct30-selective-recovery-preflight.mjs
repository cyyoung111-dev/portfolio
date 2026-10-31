import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {evaluateOct30SelectiveRecovery,DATE} from './issue507-oct30-selective-recovery-preflight.mjs';

const source=fs.readFileSync('src/gas/apps_script.gs');
const blobHash=createHash('sha1').update('blob '+source.length+'\\0').update(source).digest('hex');
assert.equal(blobHash,'9c1a5f31d1abc4b44f7da9af7a50fe3f15967134',
  'v9.281/v9.282 frozen GAS source must remain immutable');
const gas=source.toString('utf8');
function productionFunction(name){
 const start=gas.indexOf('function '+name+'(');
 assert.ok(start>=0,'production function missing: '+name);
 const next=gas.indexOf('\\nfunction ',start+10);
 return gas.slice(start,next<0?undefined:next);
}
const oldTargeted=productionFunction('_targetedKrxRecoveryPreflight_');
const oldHandler=productionFunction('handleRecoverPendingKrxClose');
const exactEvidence=productionFunction('handleGetKrxHeldCloseCoverage');
assert.match(oldTargeted,/stored\\.snapshotRows\\s*!==\\s*0/,
 'existing targeted recovery accepts only empty Snapshot target dates');
assert.match(oldTargeted,/stored\\.officialExactDateCodes\\s*!==\\s*0/);
assert.match(oldTargeted,/stored\\.queuedForBackfill/);
assert.match(oldHandler,/if\\s*\\(apply\\s*!==\\s*'1'\\)\\s*return jsonOk\\(\\{mode:'DRY_RUN'/);
assert.match(exactEvidence,/var result=fetchPricesKrx\\(expected,date\\)/);
assert.match(exactEvidence,/officialExactDateCodes:confirmed/);
const snap=Array.from({length:37},(_,i)=>({
 code:String(i+1).padStart(6,'0'),source:'KRX_CARRY@2026-10-29',
 qty:2,costAmt:300,evalAmt:350
})).concat(['F00001','F00002'].map(code=>({code,source:'FUND_NAV',
 qty:1000,costAmt:120000,evalAmt:130000})));
const history={status:'ok',date:DATE,items:snap};
const prices={status:'ok',prices:{
 F00001:[{date:DATE,source:'FUND_NAV',price:1250}],
 F00002:[{date:DATE,source:'FUND_NAV',price:1450}]
}};
const coverage={status:'ok',coverage:{
 requestedDate:DATE,mode:'READ_ONLY',
 expectedHeldCodes:37,officialExactDateCodes:37,missingCodes:0,staleCodes:0,
 duplicateMasterCodes:0,orphanLedgerCodes:0,ready:true,
 market:{STOCK:{expected:16,confirmed:16},ETF:{expected:21,confirmed:21}}
}};
const runtime={gasVersionVerified:'9.281',
 sourceStableWithinRun:true,nhTokenIssuanceRequested:false};
const args={history,prices,krx:coverage,runtime};
const result=evaluateOct30SelectiveRecovery(args);
assert.equal(result.status,'OFFICIAL_SOURCE_READY_STORAGE_MISSING');
assert.equal(result.targetPriceHistoryInsertions,37);
assert.equal(result.targetDomesticSnapshotRevalues,37);
assert.equal(result.targetFundChanges,0);
assert.equal(result.safeToApply,false,'37/37 KRX aggregate alone never authorizes writer');
assert.equal(result.perCodeExactClosePriceEvidence,false);
assert.equal(result.standaloneExistingTargetedWriterSafe,false);
assert.equal(result.financialWrites,0);
const clone=()=>structuredClone(args);
let candidate=clone();candidate.history.items[0].code=candidate.history.items[1].code;
assert.throws(()=>evaluateOct30SelectiveRecovery(candidate),/DUPLICATE_OR_EMPTY_CODE/);
candidate=clone();candidate.history.items[0].source='KRX';
assert.throws(()=>evaluateOct30SelectiveRecovery(candidate),/DOMESTIC_NOT_CARRY/);
candidate=clone();candidate.history.items[37].source='FUND_NAV_CARRY@2026-10-29';
assert.throws(()=>evaluateOct30SelectiveRecovery(candidate),/FUND_SNAPSHOT_NOT_VERIFIED/);
candidate=clone();candidate.prices.prices.F00002[0].date='2026-10-29';
assert.throws(()=>evaluateOct30SelectiveRecovery(candidate),/FUND_HISTORY_NOT_VERIFIED/);
candidate=clone();candidate.prices.prices['000001']=[{date:DATE,source:'KRX',price:150}];
assert.throws(()=>evaluateOct30SelectiveRecovery(candidate),/HISTORICAL_SCOPE_DRIFT/);
candidate=clone();candidate.prices.prices['999999']=[{date:DATE,source:'KRX',price:150}];
assert.throws(()=>evaluateOct30SelectiveRecovery(candidate),/UNEXPECTED_STORED_PRICE/);
candidate=clone();candidate.krx.coverage.officialExactDateCodes=36;
candidate.krx.coverage.missingCodes=1;candidate.krx.coverage.market.ETF.confirmed=20;
candidate.krx.coverage.ready=false;
assert.throws(()=>evaluateOct30SelectiveRecovery(candidate),/KRX_SOURCE_NOT_COMPLETE/);
candidate=clone();candidate.krx.coverage.requestedDate='2026-10-29';
assert.throws(()=>evaluateOct30SelectiveRecovery(candidate),/KRX_EVIDENCE_INVALID/);
candidate=clone();candidate.runtime.sourceStableWithinRun=false;
assert.throws(()=>evaluateOct30SelectiveRecovery(candidate),/PRODUCTION_PROVENANCE/);
candidate=clone();candidate.history.items.push({code:'US_NQ',source:'YAHOO'});
assert.throws(()=>evaluateOct30SelectiveRecovery(candidate),/SNAPSHOT_NOT_39/);
assert.ok(!JSON.stringify(result).includes('000001') &&
 !JSON.stringify(result).includes('F00001') &&
 !JSON.stringify(result).includes('1250'),
 'no raw holdings, account or values in report');
console.log(JSON.stringify({mode:'ISSUE507_OCT30_REPAIR_PREFLIGHT_TEST',
 result:'PASS',cases:11,sourceBlob:blobHash.slice(0,12),
 financeWrites:0,gasDeploy:false,nhTokens:0}));
