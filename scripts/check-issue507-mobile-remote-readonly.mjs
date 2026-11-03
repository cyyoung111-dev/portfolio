import assert from 'node:assert/strict';
import fs from 'node:fs';
import {probeMobileSources,summarizeMobileReads} from './issue507-mobile-remote-readonly.mjs';

const ok=summarizeMobileReads({status:'ok',trades:[{}]},{status:'ok',holdings:[{}]});
assert.equal(ok.remoteReadReady,true);
assert.equal(ok.browserFirstLoadVerified,false);
assert.equal(ok.mobileDeviceVerified,false);
assert.equal(ok.financialWrites,0);
for(const [t,h] of [
  [{status:'error',message:'PRIVATE_TOKEN'},{status:'ok',holdings:[{}]}],
  [{status:'ok',trades:[]},{status:'ok',holdings:[{}]}],
  [{status:'ok',trades:[{}]},{status:'ok',holdings:[]}],
  [{status:'ok',trades:[{}]},{status:'error',message:'PRIVATE_ACCOUNT'}],
]){
 const x=summarizeMobileReads(t,h);
 assert.equal(x.remoteReadReady,false);
 assert.ok(!JSON.stringify(x).includes('PRIVATE_'));
}
let actions=[];
const fake=async(_url,request)=>{
 const p=new URLSearchParams(request.body);
 const action=p.get('action'); actions.push(action);
 assert.ok(['getTrades','getHoldings'].includes(action));
 assert.equal(request.method,'POST');
 assert.equal(p.get('accessToken'),'TEST_AUTH_TOKEN_123456');
 return {ok:true,json:async()=>action==='getTrades'
   ?{status:'ok',trades:[{}]}:{status:'ok',holdings:[{}]}};
};
const result=await probeMobileSources({url:'https://script.google.com/macros/s/test/exec',
 token:'TEST_AUTH_TOKEN_123456',fetchImpl:fake});
assert.equal(result.remoteReadReady,true);
assert.deepEqual(actions,['getTrades','getHoldings']);
assert.equal(summarizeMobileReads({status:'ok',trades:null},{status:'ok',holdings:[{}]}).remoteReadReady,false);
await assert.rejects(()=>probeMobileSources({url:'https://example.invalid',token:'TEST_AUTH_TOKEN_123456',fetchImpl:fake}));
const src=fs.readFileSync('scripts/issue507-mobile-remote-readonly.mjs','utf8');
assert.ok(src.includes('browserFirstLoadVerified:false'));
assert.ok(src.includes('mobileDeviceVerified:false'));
assert.ok(src.includes("financialWrites:0"));
assert.ok(!/syncTrades|syncHoldings|appendRow|setValues|savePriceHistory|collectKbFundNav/.test(src));
const audit=fs.readFileSync('.github/workflows/issue-507-fund-snapshot-evidence-readonly.yml','utf8');
assert.ok(audit.includes('run: node scripts/issue507-mobile-remote-readonly.mjs'));
assert.ok(audit.includes('preview="$(node scripts/collect-kb-fund-nav.mjs)"'));
assert.ok(audit.includes("result?.mode!=='DRY_RUN'"),'deferred NAV is NOT verified');
assert.ok(audit.includes("result?.imported!==0"));
assert.ok(audit.includes('KB_NAV_PREVIEW_INCOMPLETE'));
assert.ok(!audit.includes('collect-kb-fund-nav.mjs --apply'));
console.log('Mobile remote read-only: strict source validation and no write paths PASS');
