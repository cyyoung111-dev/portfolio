import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {composeGas9296TradeUtf8Preview} from './compose-gas9296-trade-utf8-preview.mjs';
import {assertGasReleaseReady,assertIssue507ManualReleasePermission,
 assertIssue7349296Prerequisites} from './deploy-gas.mjs';
import {assertPublishedReleaseFundNavSupport} from './issue860-fund-nav-release-compat.mjs';
import {verifyGas9296WithRetry} from './issue734-gas9296-release-readonly.mjs';
const {parent,candidate,manifest}=composeGas9296TradeUtf8Preview();
assert.equal(manifest.candidateGitBlob,'e7dfcc8a1ad194e4a0ef586b83b7df66a83dd2c6');
assert.equal(assertGasReleaseReady(candidate),'9.296');
const functions=s=>{
 const matches=[...s.matchAll(/^function ([\w$]+)\s*\(/gm)];
 return new Map(matches.map((m,i)=>[m[1],s.slice(m.index,matches[i+1]?.index??s.length)
  .replaceAll("'9.296'","'9.295'")]));
};
const old=functions(parent),next=functions(candidate);
assert.deepEqual([...old].filter(([n,s])=>next.get(n)!==s).map(([n])=>n),
 ['_tradeV2RowHash_','_tradeV2Revision_']);
assert.deepEqual([...next.keys()].filter(n=>!old.has(n)),['_tradeV2Utf8Digest_']);
const extract=(s,n)=>{const i=s.indexOf('function '+n+'('),j=s.indexOf('\n}',i);return s.slice(i,j+2)};
function runtime(source){
 const ctx=vm.createContext({Date,JSON,String,Number,Math,Array,isFinite,
  _issue507GateInside_:true,_normalizeDate:v=>String(v).slice(0,10),
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'UTF_8'},
   computeDigest:(alg,value,charset)=>{
    assert.equal(alg,'sha256');
    // Observed production behaviour: the unspecified charset replaces
    // non-ASCII with '?'. Earlier unit doubles incorrectly assumed UTF-8.
    const bytes=charset==='UTF_8'?Buffer.from(value,'utf8'):
     Buffer.from(value.replace(/[^\x00-\x7f]/gu,'?'),'ascii');
    return [...createHash('sha256').update(bytes).digest()].map(n=>n>127?n-256:n);
   }}
 });
 for(const name of ['_cleanCode','_portfolioSyncDigest_',
  ...(source.includes('function _tradeV2Utf8Digest_(')?['_tradeV2Utf8Digest_']:[]),
  '_tradeV2CanonicalRow_'])vm.runInContext(extract(source,name),ctx);
 const i=source.indexOf('function _tradeV2RowHash_('),j=source.indexOf('function _tradeV2ValidateMutation_(',i);
 vm.runInContext(source.slice(i,j),ctx);
 return ctx;
}
const prior=runtime(parent),fixed=runtime(candidate);
const raw=[['2026-11-16','buy','연금','한국 ETF','005930',7,12345,'ETF','메모','','','','','srv_abcdef123456']];
const unicodeChange=raw.map(r=>r.map((v,i)=>i===3?'미국 ETF':v));
const expected=createHash('sha256').update(JSON.stringify(fixed._tradeV2CanonicalRow_(raw[0]))).digest('hex');
assert.notEqual(prior._tradeV2RowHash_(raw[0]),expected,'original live failure reproduced');
assert.equal(prior._tradeV2RowHash_(raw[0]),prior._tradeV2RowHash_(unicodeChange[0]),
 'ASCII replacement loses different Korean text');
assert.equal(fixed._tradeV2RowHash_(raw[0]),expected);
assert.notEqual(fixed._tradeV2RowHash_(raw[0]),fixed._tradeV2RowHash_(unicodeChange[0]),
 'Korean edits must change the CAS preimage');
assert.equal(fixed._portfolioSyncDigest_('한국'),prior._portfolioSyncDigest_('한국'),
 'legacy receipt and migration-ID signatures must not be rotated');
const web=readFileSync('src/web/features/settings/settings_sync.js','utf8');
const pc=vm.createContext({String,Number,Math,JSON});
for(const name of ['_tradeV2NormalizeCode','_tradeV2BrowserCanonical'])vm.runInContext(extract(web,name),pc);
const trades=[{date:'2026-11-16',tradeType:'buy',acct:'연금',name:'한국 ETF',code:'005930',
 qty:7,price:12345,assetType:'ETF',memo:'메모',id:'srv_abcdef123456',ratio:0,fractionalCash:0}];
assert.equal(fixed._tradeV2Revision_(raw),createHash('sha256')
 .update(JSON.stringify(trades.map(pc._tradeV2BrowserCanonical))).digest('hex'));
for(const fixture of ['한글','é e\u0301','😀','日本語']){
 const row=raw[0].slice();row[8]=fixture;
 assert.equal(fixed._tradeV2RowHash_(row),createHash('sha256')
  .update(JSON.stringify(fixed._tradeV2CanonicalRow_(row)),'utf8').digest('hex'));
}
assert.throws(()=>assertIssue507ManualReleasePermission({version:'9.296',eventName:'push',approved9296:true}),
 /GAS_9296_EXPLICIT_MANUAL_RELEASE_REQUIRED/);
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({version:'9.296',eventName:'workflow_dispatch',approved9296:true}));
assert.throws(()=>assertIssue7349296Prerequisites({version:'9.296',publishedVersion:'9.295'}),/GAS_9296_/);
assert.doesNotThrow(()=>assertIssue7349296Prerequisites({version:'9.296',publishedVersion:'9.295',liveIdleVerified:true}));
assertPublishedReleaseFundNavSupport('9.296');
let calls=0;
const retry=await verifyGas9296WithRetry({verify:async()=>{
 if(++calls===1)throw Error('GAS9296_READONLY_HASH_MISMATCH');
 return {status:'VERIFIED',version:'9.296',financeWrites:0,pcAndPhysicalRevisionMatch:true};
},delay:async()=>{}});
assert.equal(retry.readbackAttempts,2);
await assert.rejects(verifyGas9296WithRetry({verify:async()=>({status:'VERIFIED',version:'9.296'})}),/GAS9296_POSTDEPLOY_PROOF_INVALID/);
console.log('PASS GAS 9.296 UTF-8 revision/CAS, Unicode collision regression and unchanged legacy signatures');
