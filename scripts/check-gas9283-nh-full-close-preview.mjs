import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {gasSourceBlobSha,extractExpectedGasVersion,assertGasReleaseReady}
  from './deploy-gas.mjs';
import {prepareGasNh9283WithKrxTurnoverPreview}
  from './compose-gas9283-turnover-preview.mjs';
import {composeGas9283NhFullClosePreview,EXACT_V9282_BASE_BLOB,
  EXACT_9283_PRIOR_PREVIEW_BLOB,CLOSE_MODIFIED_FUNCTIONS}
  from './compose-gas9283-nh-full-close-preview.mjs';
import {proposeNhDomesticCloseFullCoverage}
  from './nh-domestic-close-full-coverage-proposal.mjs';

function extractOne(source,name){
  const token='function '+name+'(';
  const start=source.indexOf(token),end=source.indexOf('\n}',start);
  assert.ok(start>=0&&end>start, 'real GAS function exists: '+name);
  assert.equal(source.indexOf(token,start+token.length),-1,'function unique '+name);
  return source.slice(start,end+2);
}
const baseline=fs.readFileSync('src/gas/apps_script.gs','utf8');
assert.equal(gasSourceBlobSha(baseline),EXACT_V9282_BASE_BLOB);
const prior=prepareGasNh9283WithKrxTurnoverPreview().candidate;
assert.equal(gasSourceBlobSha(prior),EXACT_9283_PRIOR_PREVIEW_BLOB);
const strict=proposeNhDomesticCloseFullCoverage(baseline).candidate;
const {candidate,manifest}=composeGas9283NhFullClosePreview();
assert.equal(gasSourceBlobSha(candidate),manifest.candidateSourceBlob);
assert.equal(extractExpectedGasVersion(candidate),'9.283');
assert.equal(manifest.status,'SOURCE_PREVIEW_NOT_DEPLOYABLE');
assert.equal(manifest.productionSourceChanged,false);
assert.equal(manifest.releaseAllowlistApproved,false);
assert.equal(manifest.deploymentApproved,false);
assert.equal(manifest.financeWriteAuthorized,false);
assert.deepEqual(manifest.changedFunctions,
  ['fetchDomesticRegularCloses','saveDailyPriceHistory']);
assert.throws(()=>assertGasReleaseReady(candidate),/GAS_RELEASE_UNREVIEWED_VERSION/);
assert.throws(()=>composeGas9283NhFullClosePreview({
 baseline:baseline+'\n// modified'
}),/GAS_9283_CLOSE_V9282_BASE_DRIFT/);
new vm.Script(candidate,{filename:'source-only-gas9283-nh-full-close.gs'});
let reconstructed=candidate;
for(const name of CLOSE_MODIFIED_FUNCTIONS){
  const before=extractOne(baseline,name);
  const after=extractOne(strict,name);
  assert.equal(extractOne(candidate,name),after,'actual reviewed change '+name);
  assert.notEqual(after,before,'patch must alter real function');
  assert.equal(reconstructed.split(after).length,2,'new function must be unique');
  reconstructed=reconstructed.replace(after,before);
}
assert.equal(reconstructed,prior,'everything outside the two reviewed functions remains immutable');
assert.equal(fs.readFileSync('src/gas/apps_script.gs','utf8'),baseline);
assert.match(candidate,/var ISSUE507_GATE_API_VERSION='9.283'/);
assert.match(candidate,/kst\.minutes<405\|\|kst\.minutes>=480/);
assert.match(candidate,/TARGET_EXACT_KRX_INCOMPLETE/);

// Run the combined 9.283 batch function as real GAS code in a synthetic VM.
// A missing NH bar must be delegated only once to KRX; complete NH requires
// four bounded calls for the live 37-code holding universe.
function fetchAll(missingCount){
  const batches=[],fallbacks=[],items=Array.from({length:37},(_,i)=>({
    code:String(i+900000),type:'ETF',currency:'KRW',market:'KRX'
  }));
  const ctx=vm.createContext({Date,Logger:{log(){}},
    fetchNhRegularCloses:(chunk,day)=>{
      batches.push(chunk.length);
      return Object.fromEntries(chunk.filter(item=>
        Number(item.code)<900000+37-missingCount).map(item=>[item.code,{
          price:100,usedDate:day,source:'NH_REGULAR_CLOSE',
          marketDate:day,status:'CONFIRMED',priceType:'REGULAR_CLOSE'
        }]));
    },
    fetchPricesKrx:(rest,day)=>{
      fallbacks.push(rest.map(x=>x.code));
      return Object.fromEntries(rest.map(item=>[item.code,{
        price:101,usedDate:day,source:'KRX_OTP'
      }]));
    }});
  vm.runInContext(extractOne(candidate,'fetchDomesticRegularCloses'),ctx);
  const results=ctx.fetchDomesticRegularCloses(items,'2026-11-05');
  return {results,batches,fallbacks};
}
const complete=fetchAll(0);
assert.equal(Object.keys(complete.results).length,37);
assert.deepEqual(complete.batches,[12,12,12,1]);
assert.equal(complete.fallbacks.length,0);
const partial=fetchAll(1);
assert.equal(Object.keys(partial.results).length,37);
assert.deepEqual(partial.batches,[12,12,12,1]);
assert.deepEqual(JSON.parse(JSON.stringify(partial.fallbacks)),[['900036']]);
assert.equal(partial.results['900036'].source,'KRX_OTP');
console.log('GAS9283_NH_FULL_CLOSE_PREVIEW_OK '+JSON.stringify({
 sourceBlob:manifest.candidateSourceBlob,base:manifest.predecessorBlob,
 functionsChanged:manifest.changedFunctions,
 syntheticHeldCodes:37,nhBatches:4,financialWrites:0,
 deployed:false
}));
