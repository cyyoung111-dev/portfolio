import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {summarize} from './nh-index-probe.mjs';
const code=fs.readFileSync('src/gas/apps_script.gs','utf8');
const source=code.slice(code.indexOf('var NH_INDEX_PROBE_CODES_V1='));
const ctx={_nhCloseDate_:x=>String(x).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),
 _nhPost_:()=>({Output_0:{iem_cd:'SPX',iem_nm:'S&P 500 Index'},
 Output_1:[{bsop_date:'20261029',ovrs_prpr:'6931.22'}]})};
vm.createContext(ctx);vm.runInContext(source,ctx);
const a={type:'SP500',code:'SPX',name:'S&P|500'};
const x=ctx._nhIndexProbeOne_(a,'2026-10-29',{});
assert.equal(x.status,'CANDIDATE_ONLY');assert.equal(x.value,6931.22);
ctx._nhPost_=()=>({Output_0:{iem_cd:'WRONG',iem_nm:'S&P 500'},Output_1:[]});
assert.equal(ctx._nhIndexProbeOne_(a,'2026-10-29',{}).status,'CODE_UNVERIFIED');
ctx._nhPost_=()=>({Output_0:{iem_cd:'SPX',iem_nm:'Nasdaq'},Output_1:[]});
assert.equal(ctx._nhIndexProbeOne_(a,'2026-10-29',{}).status,'NAME_UNVERIFIED');
ctx._nhPost_=()=>({Output_0:{iem_cd:'SPX',iem_nm:'S&P 500'},Output_1:[{bsop_date:'20261028',ovrs_prpr:'6931.22'}]});
assert.equal(ctx._nhIndexProbeOne_(a,'2026-10-29',{}).status,'DATE_UNVERIFIED');
const z=summarize({status:'ok',provider:'NH',tokenCached:true,tokenIssued:false},{status:'ok',provider:'NH',
 gasVersion:'9.280',date:'2026-10-29',readOnly:true,results:[x]});
assert.equal(z.mappingsVerified,false);assert.equal(z.samples[0].value,6931.22);
assert.match(code,/NH_INDEX_CACHED_TOKEN_REQUIRED/);
assert.match(code,/if \(params.action === 'getNhIndexProbe'\)/);
console.log('NH index code candidate discovery: production parser and safety PASS');
