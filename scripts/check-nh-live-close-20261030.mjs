import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inspectNhCloses} from './nh-live-close-20261030.mjs';
const p={status:'ok',provider:'NH',enabled:true,tokenCached:true,tokenIssued:false};
const closes={'005930':{price:232000,usedDate:'2026-10-29',marketDate:'2026-10-29',currency:'KRW',source:'NH_REGULAR_CLOSE',status:'CONFIRMED',priceType:'REGULAR_CLOSE'},
  AAPL:{price:250.25,usedDate:'2026-10-29',marketDate:'2026-10-29',currency:'USD',source:'NH_REGULAR_CLOSE',status:'CONFIRMED',priceType:'REGULAR_CLOSE'}};
const d={status:'ok',provider:'NH',gasVersion:'9.279',readOnly:true,quotesConnected:true,closes};
const emitted=[];
const result=inspectNhCloses(p,d,x=>emitted.push(x));
assert.equal(result.confirmed,2);assert.equal(result.fullHoldingsVerified,false);
assert.deepEqual(emitted.map(x=>[x.code,x.price,x.marketDate,x.source]),
  [['005930',232000,'2026-10-29','NH_REGULAR_CLOSE'],['AAPL',250.25,'2026-10-29','NH_REGULAR_CLOSE']]);
for(const patch of [{source:'YAHOO_REGULAR_CLOSE'},{priceType:'INDICATIVE'},{status:'PARTIAL'},{marketDate:'2026-10-28'},{price:0},{currency:'USD'}]){
 const missing=inspectNhCloses(p,{...d,closes:{...closes,'005930':{...closes['005930'],...patch}}});
 assert.equal(missing.confirmed,1);
}
assert.throws(()=>inspectNhCloses({...p,tokenCached:false},d),/CACHED_TOKEN/);
assert.throws(()=>inspectNhCloses(p,{...d,readOnly:false}),/DIAGNOSTIC_INVALID/);
const workflow=fs.readFileSync('.github/workflows/nh-live-close-20261030.yml','utf8');
assert.match(workflow,/environment: portfolio-production-gas/);
assert.match(workflow,/github\.run_attempt == 1/);
assert.doesNotMatch(workflow,/NHPLUG_APP_KEY|NHPLUG_APP_SECRET|workflow_dispatch|schedule:/);
console.log('NH close one-off read-only, cached-token and numeric provenance contract PASS');
