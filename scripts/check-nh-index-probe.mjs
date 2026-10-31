import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {summarize} from './nh-index-probe.mjs';
const code=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
const source=code.slice(code.indexOf('var NH_INDEX_PROBE_CODES_V1='));
const ctx={_nhCloseDate_:x=>String(x).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),
 _nhJson_:()=>({Output_0:{iem_cd:'SPX',iem_nm:'S&P 500 Index'},
 Output_1:[{bsop_date:'20261029',ovrs_prpr:'6931.22'}]})};
vm.createContext(ctx);vm.runInContext(source,ctx);
const a={type:'SP500',code:'SPX',name:'S&P|500'};
const x=ctx._nhIndexProbeOne_(a,'2026-10-29',{},'test-bearer');
assert.throws(()=>ctx._nhIndexProbeOne_(a,'2026-10-29',{},''),/NH_INDEX_NO_CACHED_BEARER/);
assert.equal(x.status,'CANDIDATE_ONLY');assert.equal(x.value,6931.22);
ctx._nhJson_=()=>({Output_0:{iem_cd:'WRONG',iem_nm:'S&P 500'},Output_1:[]});
assert.equal(ctx._nhIndexProbeOne_(a,'2026-10-29',{},'test-bearer').status,'CODE_UNVERIFIED');
ctx._nhJson_=()=>({Output_0:{iem_cd:'SPX',iem_nm:'Nasdaq'},Output_1:[]});
assert.equal(ctx._nhIndexProbeOne_(a,'2026-10-29',{},'test-bearer').status,'NAME_UNVERIFIED');
ctx._nhJson_=()=>({Output_0:{iem_cd:'SPX',iem_nm:'S&P 500'},Output_1:[{bsop_date:'20261028',ovrs_prpr:'6931.22'}]});
assert.equal(ctx._nhIndexProbeOne_(a,'2026-10-29',{},'test-bearer').status,'DATE_UNVERIFIED');
const z=summarize({status:'ok',provider:'NH',tokenCached:true,tokenIssued:false},{status:'ok',provider:'NH',
 gasVersion:'9.282',date:'2026-10-29',readOnly:true,results:[x]});
assert.equal(z.mappingsVerified,false);assert.equal(z.samples[0].value,6931.22);
assert.match(code,/NH_INDEX_CACHED_TOKEN_REQUIRED/);
assert.match(code,/if \(params.action === 'getNhIndexProbe'\)/);

const releaseWorkflow=fs.readFileSync('.github/workflows/gas-deploy.yml','utf8');
const readbackSource=fs.readFileSync('scripts/nh-index-primary-readback.mjs','utf8');
assert.doesNotMatch(releaseWorkflow,/run:\s*node scripts\/nh-index-probe\.mjs/,
 'historical six-code NH exploration must not repeat on every main release');
assert.match(releaseWorkflow,/run:\s*node scripts\/nh-index-primary-readback\.mjs/,
 'keep verified SPX, COMP and NDX post-release readback');
assert.match(readbackSource,/benchmarks:'SP500,NASDAQ,NASDAQ100',from:'2026-10-22',to:'2026-10-29',fresh:'0'/,
 'historical verified index readback must not bypass the shared GAS cache');
assert.doesNotMatch(readbackSource,/fresh:'1'/,
 'never force unneeded external API refetches for the immutable historical acceptance fixture');
console.log('NH index historical duplicate-call suppression and safety PASS');
