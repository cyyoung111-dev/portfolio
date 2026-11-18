import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {composeGas9300TaxScenarioSyncPreview} from './compose-gas9300-tax-scenario-sync-preview.mjs';
const {parent,candidate,manifest}=composeGas9300TaxScenarioSyncPreview();
new vm.Script(candidate);
const block=(source,name)=>{const i=source.indexOf('function '+name+'(');assert(i>=0);return source.slice(i,source.indexOf('\n}',i)+2);};
const dispatch=block(candidate,'doPost');
assert(dispatch.indexOf('if (!_isAuthorizedRequest(params))')<dispatch.indexOf("params.action === 'getFinancialTaxScenario'"));
assert(dispatch.indexOf('if (!_isAuthorizedRequest(params))')<dispatch.indexOf("params.action === 'saveFinancialTaxScenario'"));
for(const name of ['_refreshFundValuations','handleSaveSettings','handleGetSettings','handleSaveDividendSettings','writeSnapshotRows','_issue507GateEnter_'])
 assert.equal(block(candidate,name).replaceAll('9.300','VERSION'),block(parent,name).replaceAll('9.299','VERSION'));
const props=new Map([['access_token','mock-authenticated-token']]);
let writes=0,serial=0,locked=false,lostReadback=false;
const gas=vm.createContext({
 _issue507GateInside_:true,
 _isAuthorizedRequest:p=>props.has('access_token')?p.accessToken===props.get('access_token'):true,
 jsonOk:r=>({status:'ok',...r}),jsonError:(message,extra)=>({status:'error',message,...extra}),
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>lostReadback&&k.startsWith('pf_fin_tax_scenario')&&writes===1?'bad-json':props.get(k)??null,setProperty:(k,v)=>{assert(locked);writes++;props.set(k,v);}})},
 LockService:{getScriptLock:()=>({waitLock:()=>{assert(!locked);locked=true;},releaseLock:()=>{assert(locked);locked=false;}})},
 Utilities:{getUuid:()=>('00000000-0000-0000-0000-'+String(++serial).padStart(12,'0'))}
});
vm.runInContext(fs.readFileSync('scripts/financial-tax-scenario-sync-proposal.gs','utf8')+'\n'+dispatch,gas);
const call=(action,params={},token='mock-authenticated-token')=>gas.doPost({postData:{contents:new URLSearchParams({action,accessToken:token,...params}).toString()}});
const details={capitalExempt:0,etfTaxDifference:null,certificateSpecial:null,otherTaxBase:50000000,grossUpOrdinary:null,grossUpSpecial:null};
const value={interest:0,details};
assert.equal(call('getFinancialTaxScenario',{year:2026},'bad').status,'error');
const token=props.get('access_token');props.delete('access_token');
assert.equal(call('getFinancialTaxScenario',{year:2026}).errorCode,'TAX_SCENARIO_AUTH_REQUIRED');props.set('access_token',token);
assert.equal(call('getFinancialTaxScenario',{year:2026}).revision,'0');
const save=(year,expectedRevision,record)=>call('saveFinancialTaxScenario',{year,expectedRevision,data:JSON.stringify(record)});
assert.equal(save(2026,'0',{...value,interest:-1}).errorCode,'TAX_SCENARIO_INVALID');
assert.equal(writes,0);
const first=save(2026,'0',value);assert.equal(first.status,'ok');assert.equal(first.record.interest,0);assert.equal(first.record.details.capitalExempt,0);
assert.equal(save(2026,'0',{...value,interest:1}).errorCode,'TAX_SCENARIO_CONFLICT');
assert.equal(save(2026,first.revision,value).revision,first.revision);assert.equal(writes,1);
const other=save(2027,'0',{...value,interest:99});assert.equal(other.status,'ok');
const cleared=save(2026,first.revision,null);assert.equal(cleared.record,null);assert.notEqual(cleared.revision,'0');
assert.equal(save(2026,'0',value).errorCode,'TAX_SCENARIO_CONFLICT');
assert.equal(call('getFinancialTaxScenario',{year:2027}).record.interest,99);
assert.equal(locked,false);
assert.equal([...props.keys()].filter(k=>!['access_token','pf_fin_tax_scenario_v1_2026','pf_fin_tax_scenario_v1_2027'].includes(k)).length,0);
const source=fs.readFileSync('src/web/views/views_div_asset.js','utf8');
let requests=[];
function device(version='9.300'){
 const disk=new Map([['pf_financial_tax_scenarios_v1',JSON.stringify({'2026':{interest:100,details,updatedAt:null},'2028':{interest:50,details,updatedAt:null}})]]);
 let gen=1;
 const ctx=vm.createContext({window:{_lastGasVersion:version},GSHEET_API_URL:'private-test',getGsheetAccessToken:()=>token,getGsheetConnectionGeneration:()=>gen,
  localStorage:{getItem:k=>disk.get(k)||null,setItem:(k,v)=>disk.set(k,v)},
  requestGsheetFormJson:async(action,p,opts)=>{assert.equal(opts.retry,0);requests.push(action);return call(action,p);},_kstYear:()=>2026});
 vm.runInContext(source,ctx);return {ctx,disk,changeConnection:()=>gen++};
}
const old=device('9.297');assert.equal(old.ctx._getDivOtherIncome(2026),100);assert.equal(await old.ctx._readDivTaxRemote(2026),false);
assert.equal(requests.length,0);
const pc=device(),mobile=device();
assert.equal(await pc.ctx._readDivTaxRemote(2026),true);assert.equal(pc.ctx._getDivOtherIncome(2026),null,'clear tombstone overrides local device draft');
assert.equal(await pc.ctx._readDivTaxRemote(2028),true);assert.equal(pc.ctx._getDivOtherIncome(2028),50,'unregistered server year retains local value');
assert.equal(await mobile.ctx._readDivTaxRemote(2028),true);
const ok=await pc.ctx._saveDivTaxRemote(2028,0,details,'0');assert.equal(ok.ok,true);
assert.equal(pc.ctx._getDivOtherIncome(2028),0);
const stale=await mobile.ctx._saveDivTaxRemote(2028,123,details,'0');assert.equal(stale.ok,false);assert.equal(stale.reason,'CONFLICT');
const before=requests.length;assert.equal((await mobile.ctx._saveDivTaxRemote(2028,123,details,'0')).ok,false);assert.equal(requests.length,before);
assert.equal(await mobile.ctx._readDivTaxRemote(2028,true),true);assert.equal(mobile.ctx._getDivOtherIncome(2028),0);
assert.equal(JSON.parse(mobile.disk.get('pf_financial_tax_scenarios_v1'))['2028'].interest,50,'private server record not copied into local store');
mobile.changeConnection();assert.equal(mobile.ctx._getDivOtherIncome(2028),50,'never expose prior connection cached record');
assert.equal((await mobile.ctx._saveDivTaxRemote(2028,1,details,'0')).ok,false);
assert.equal(manifest.productionDeploymentApproved,false);
console.log('GAS9300_TAX_SCENARIO_SYNC_PREVIEW '+JSON.stringify({...manifest,deviceCasVerified:true,financeWrites:0}));
