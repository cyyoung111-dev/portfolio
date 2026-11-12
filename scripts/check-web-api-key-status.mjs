import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const krxSource=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
const publicSource=fs.readFileSync('src/web/features/dividend/mgmt_div.js','utf8');
const viewSource=fs.readFileSync('src/web/views/views_history.js','utf8');
const eventSource=fs.readFileSync('src/web/app/event_delegation.js','utf8');
const gasSource=fs.readFileSync('src/gas/apps_script.gs','utf8');

function section(source,from,to){
 const start=source.indexOf(from),end=source.indexOf(to,start+from.length);
 assert.ok(start>=0&&end>start,from+' production section exists');
 return source.slice(start,end);
}
const functions=section(krxSource,'function getKrxAuthKey()','async function saveNhConfigFromUI()')
 +'\n'+section(publicSource,'async function savePublicDataApiKeyFromUI()',
 'async function _fetchDividendSource(');
const elements={};
for(const id of ['krxAuthKeyInput','publicDataKeyInput','krxAuthKeyStatus',
 'publicDataKeyStatus','krxConfiguredBadge','publicDataConfiguredBadge',
 'krxProbeDate','krxSourceStatus']){
 elements[id]={value:'',textContent:'',style:{}};
}
elements.krxProbeDate.value='2026-11-11';
const writes=[],reads=[],removed=[];
let confirmed=false,readReply=null,writeReply=null;
const ctx=vm.createContext({
 console,URL,URLSearchParams,
 $el:id=>elements[id]||null,
 lsRemove:key=>removed.push(key),
 showToast:()=>{},
 getGsheetConnectionGeneration:()=>1,
 requestGsheetFormJson:async (action,payload)=>{
   writes.push({action,payload});
   if(writeReply)return writeReply;
   return payload.key==='-'
     ?{status:'ok',cleared:true,saved:false}
     :{status:'ok',cleared:false,saved:true};
 },
 requestGsheetActionJson:async (action,params)=>{
   reads.push({action,params});
   return readReply;
 }
});
ctx.window=ctx;
ctx.confirm=()=>confirmed;
ctx.GAS_API_KEY_STATUS={krxAuthKeyConfigured:true,
 publicDataApiKeyConfigured:true,nh:{enabled:true}};
vm.runInContext("var GSHEET_API_URL='https://script.google.com/macros/s/one/exec';",ctx);
vm.runInContext(functions,ctx);

// No empty input and no typed '-' can clear or even call the legacy GAS API.
assert.equal(await ctx.saveKrxAuthKeyFromUI(),false);
assert.equal(await ctx.savePublicDataApiKeyFromUI(),false);
elements.krxAuthKeyInput.value='-';
elements.publicDataKeyInput.value='-';
assert.equal(await ctx.saveKrxAuthKeyFromUI(),false);
assert.equal(await ctx.savePublicDataApiKeyFromUI(),false);
assert.equal(writes.length,0,'empty/magic value never sends an API mutation');
assert.equal(ctx.GAS_API_KEY_STATUS.krxAuthKeyConfigured,true);
assert.equal(ctx.GAS_API_KEY_STATUS.publicDataApiKeyConfigured,true);

// Explicit non-empty saves and verified success flags.
elements.krxAuthKeyInput.value='NEW_KRX_TEST_CREDENTIAL';
assert.equal(await ctx.saveKrxAuthKeyFromUI(),true);
assert.equal(writes.at(-1).action,'saveKrxAuthKey');
assert.equal(writes.at(-1).payload.key,'NEW_KRX_TEST_CREDENTIAL');
assert.equal(elements.krxAuthKeyInput.value,'');
assert.match(elements.krxConfiguredBadge.textContent,/저장됨/);
elements.publicDataKeyInput.value='NEW_PUBLIC_TEST_CREDENTIAL';
assert.equal(await ctx.savePublicDataApiKeyFromUI(),true);
assert.equal(writes.at(-1).action,'savePublicDataApiKey');
assert.equal(elements.publicDataKeyInput.value,'');
assert.equal(ctx.GAS_API_KEY_STATUS.publicDataApiKeyConfigured,true);
assert.ok(removed.includes('krx_auth_key'));
assert.ok(removed.includes('public_data_api_key'));

// A changed server response is not treated as save success.
writeReply={status:'ok'};
elements.krxAuthKeyInput.value='UNCONFIRMED_NEW_KEY';
assert.equal(await ctx.saveKrxAuthKeyFromUI(),false);
assert.equal(elements.krxAuthKeyInput.value,'UNCONFIRMED_NEW_KEY');
writeReply=null;

// Actual KRX API status and storage status are separate.
readReply={status:'ok',keyConfigured:true,requestedDate:'2026-11-11',
 markets:['KOSPI','KOSDAQ','ETF'].map(market=>({
  market,httpStatus:200,parseStatus:'ROWS',rows:100,exactDateRows:100
 }))};
const proof=await ctx.diagnoseKrxSourceFromUI();
assert.equal(proof.verified,true);
assert.equal(proof.sourceDate,'2026-11-11');
assert.equal(reads.at(-1).action,'getKrxSourceDiagnostics');
assert.equal(reads.at(-1).params.date,'2026-11-11');
assert.match(elements.krxSourceStatus.textContent,/3\/3/);
assert.match(elements.krxSourceStatus.textContent,/KST/);
readReply.markets[2]={market:'ETF',httpStatus:403,parseStatus:'NOT_PARSED',rows:0,exactDateRows:0};
assert.equal((await ctx.diagnoseKrxSourceFromUI()).verified,false);
elements.krxProbeDate.value='2026-99-99';
assert.equal(await ctx.diagnoseKrxSourceFromUI(),null,'invalid calendar date fails safely');

// Clear requires a separate confirmation; never affects the other provider.
const beforeClear=writes.length;
assert.equal(await ctx.clearKrxAuthKeyFromUI(),false);
assert.equal(await ctx.clearPublicDataApiKeyFromUI(),false);
assert.equal(writes.length,beforeClear);
confirmed=true;
assert.equal(await ctx.clearKrxAuthKeyFromUI(),true);
assert.equal(writes.at(-1).payload.key,'-');
assert.equal(ctx.GAS_API_KEY_STATUS.krxAuthKeyConfigured,false);
assert.equal(ctx.GAS_API_KEY_STATUS.publicDataApiKeyConfigured,true);
assert.equal(await ctx.clearPublicDataApiKeyFromUI(),true);
assert.equal(writes.at(-1).payload.key,'-');
assert.equal(ctx.GAS_API_KEY_STATUS.publicDataApiKeyConfigured,false);

// The financial GAS release is pinned independently. We deliberately leave
// its legacy API behavior unchanged and prove browser controls never forward
// blank values or delete markers without a confirmed, separate clear action.
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\\0'.replace('\\0','\0')).update(s).digest('hex');
assert.equal(blob(gasSource),'954fd4aeae767ddac0cb161d3a81003b5b699d1c',
 'release-pinned GAS 9.285 must not change in an unrelated web UI patch');

// Verify exact UI controls and accessible paths, without creating a new secret store.
for(const id of ['krxConfiguredBadge','publicDataConfiguredBadge','krxProbeDate',
 'krxSourceStatus','btn-clear-krx-auth-key','btn-clear-public-data-key',
 'btn-diagnose-krx']){
 assert.ok(viewSource.includes('id="'+id+'"'),id+' present in rendered HTML');
}
for(const id of ['btn-clear-krx-auth-key','btn-clear-public-data-key','btn-diagnose-krx']){
 assert.ok(eventSource.includes("'"+id+"':"),id+' wired');
}
assert.ok(!viewSource.includes('공공데이터 키가 없으면 GOOGLEFINANCE fallback'));
assert.ok(!viewSource.includes('KRX AUTH_KEY가 없으면 GOOGLEFINANCE'));
assert.ok(viewSource.includes('GitHub Secrets와 분리 관리'));
console.log('Web/GAS key retention, confirmed delete, KRX live source status and UI wiring: PASS');
