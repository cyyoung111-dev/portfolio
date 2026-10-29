import assert from 'node:assert/strict';
import {inspectNightTickResult,diagnoseNight} from './nhplug-night-readonly-diagnostic.mjs';
const key='dummy-key',secret='dummy-secret',token='dummy-token';
const today=()=>new Date('2026-10-29T05:30:00Z'); // 14:30 KST, for deterministic test only.
const before=()=>new Date('2026-10-28T20:45:00Z'); // 05:45 KST
const code='KA016C000';
const record=(c,n)=>{const b=Buffer.alloc(30,0x20);Buffer.from(c,'ascii').copy(b,0);Buffer.from(n,'ascii').copy(b,9);b[29]=10;return b;};
const master=Buffer.concat([record('K10111111','KOSPI 200'),record(code,'선물2612월kp')]);
// Canned CP949; label is not a claim about a live quote.
const cp=Buffer.from([188,177,185,176,50,54,49,50,191,249,107,112]);
master.fill(0x20,39,59);cp.copy(master,39);
const daily={Output_0:{iem_cd:code},Output_1:[{work_bsop_date:'20261029',bsop_time:'055959',prpr:'350.25'}]};
const result=inspectNightTickResult(daily,code,'20261029');
assert.deepEqual(result,{
 status:'DATED_TICK_REFERENCE_PRESENT',countClass:'1_TO_19',
 closeWindow:'LATE_TICK_PRESENT',sessionEnd:'END_UNVERIFIED'
});
assert.deepEqual(inspectNightTickResult({
 Output_0:{iem_cd:code,end_time_n:'060000'},
 Output_1:[{work_bsop_date:'20261029',bsop_time:'190001',prpr:'350.25'}]
},code,'20261029'),{
 status:'DATED_TICK_REFERENCE_PRESENT',countClass:'1_TO_19',
 closeWindow:'NO_LATE_TICK',sessionEnd:'END_0600'
});
assert.equal(inspectNightTickResult({
 Output_0:{iem_cd:code,end_time_n:'173000'},Output_1:daily.Output_1
},code,'20261029').status,'SESSION_END_CONFLICT');
assert.equal(inspectNightTickResult({...daily,Output_0:{iem_cd:'OTHER'}},code,'20261029').status,'INSTRUMENT_UNVERIFIED');
assert.equal(inspectNightTickResult({...daily,Output_1:null},code,'20261029').status,'TICK_ROWS_UNAVAILABLE');
for(const row of [
 {work_bsop_date:'20261028',bsop_time:'055959',prpr:'350.25'},
 {work_bsop_date:'20260230',bsop_time:'055959',prpr:'350.25'},
 {work_bsop_date:'20261029',bsop_time:'175959',prpr:'350.25'},
 {work_bsop_date:'20261029',bsop_time:'060001',prpr:'350.25'},
 {work_bsop_date:'20261029',bsop_time:'235999',prpr:'350.25'},
 {work_bsop_date:'20261029',bsop_time:'055959',prpr:0},
 {work_bsop_date:'20261029',bsop_time:'055959',prpr:'350.27'}
])assert.equal(inspectNightTickResult({...daily,Output_1:[row]},code,'20261029').status,'DATED_TICK_UNVERIFIED');
const good=(overrides={})=>{
 const calls=[];
 const request=async(url,options)=>{
   calls.push({url,options});
   if(url.endsWith('/m_future.h'))return {ok:true,text:async()=>'/* @record 30 */ char sCode[9]; char sName[20];'};
   if(url.endsWith('/m_future.mst'))return {ok:true,headers:{get:()=>String(master.length)},arrayBuffer:async()=>master};
   if(!url.endsWith('/krfuture/quote/v1/nightPeriod'))throw Error('UNEXPECTED');
   return {ok:overrides.ok??true,status:overrides.status??200,json:async()=>overrides.data??daily};
 };
 return {calls,request};
};
const run=async (mock,options={})=>{
 const messages=[];
 let tokenIssues=0;
 const ok=await diagnoseNight({key,secret,request:mock.request,log:x=>messages.push(x),now:today,getToken:async()=>{tokenIssues++;return token;},...options});
 const logs=messages.join('\n');
 assert.doesNotMatch(logs,/dummy-key|dummy-secret|dummy-token|https?:|350\.25|Output_0/);
 return {ok,logs,tokenIssues};
};
{
 const mock=good();
 const {ok,logs,tokenIssues}=await run(mock);
 assert.equal(ok,true);assert.equal(tokenIssues,1);assert.equal(mock.calls.length,3);
 const options=mock.calls[2].options;
 assert.equal(options.method,'POST');
 assert.equal(options.headers.authorization,'Bearer '+token);
 assert.equal(options.headers['x-client-id'],key);
 assert.equal(options.headers['x-client-secret'],secret);
 assert.deepEqual(JSON.parse(options.body).Input_0,{
  iem_cd:code,mrkt_div_cls_code:'F',gubun:'7',out1_scale_change:'0',out2_scale_change:'0',
  today_cls_code:'0',edate:'20261029',array_cnt:'20',xtick:'001'
 });
 assert.match(logs,/NIGHT_READONLY_PREFLIGHT PASS_REFERENCE_ONLY OFFICIAL_CLOSE_UNVERIFIED LAST_TRADE_COMPLETENESS_UNVERIFIED/);
 assert.match(logs,/NIGHT_CLOSE_WINDOW LATE_TICK_PRESENT/);
 assert.match(logs,/NIGHT_SESSION_END END_UNVERIFIED/);
}
for(const [payload,reason] of [
 [{...daily,Output_0:{iem_cd:'OTHER'}},/INSTRUMENT_UNVERIFIED/],
 [{...daily,Output_1:[]},/DATED_TICK_UNVERIFIED/],
 [{...daily,Output_0:{iem_cd:code,end_time_n:'160000'}},/SESSION_END_CONFLICT/]
]){
 const {ok,logs}=await run(good({data:payload}));
 assert.equal(ok,false);assert.match(logs,reason);
}
{
 const mock=good();
 const {ok,logs,tokenIssues}=await run(mock,{now:before});
 assert.equal(ok,false);assert.equal(mock.calls.length,0);assert.equal(tokenIssues,0);
 assert.match(logs,/OUTSIDE_POST_NIGHT_WINDOW/);
}
{
 const mock=good({status:429,ok:false});
 const {ok,logs}=await run(mock);
 assert.equal(ok,false);assert.match(logs,/HTTP_429/);
}
{
 const messages=[];
 assert.equal(await diagnoseNight({key,secret,now:today,request:async()=>{throw Error(secret);},log:x=>messages.push(x)}),false);
 assert.doesNotMatch(messages.join('\n'),/dummy-secret/);
}
console.log('NH futures night-period read-only diagnostic synthetic checks passed');

const {latestNightReference,compareNightReferences}=await import('./nhplug-night-tfl-compare.mjs');
const candidate=[{code,contractMonth:'2026-12'}];
const last=latestNightReference({...daily,Output_1:[...daily.Output_1,{work_bsop_date:'20261029',bsop_time:'060000',prpr:'351.50'}]},candidate,'2026-10-29');
assert.equal(last.value,351.5);assert.equal(last.clock,'06:00:00');assert.equal(last.officialClose,false);
assert.equal(latestNightReference(daily,candidate,'2026-10-30'),null);
assert.equal(latestNightReference(daily,[...candidate,...candidate],'2026-10-29'),null);
assert.equal(latestNightReference({...daily,Output_1:[...daily.Output_1,{...daily.Output_1[0],prpr:'350.30'}]},candidate,'2026-10-29'),null);
const tfl={source:'TFL',kind:'REFERENCE',tradingDate:'2026-10-29',contract:'A01612',value:351.5};
assert.equal(compareNightReferences(last,tfl).status,'MATCH_REFERENCE_ONLY');
assert.equal(compareNightReferences(last,{...tfl,value:351.45}).differencePt,0.05);
assert.equal(compareNightReferences(last,{...tfl,contract:'A01609'}).status,'DATE_OR_CONTRACT_MISMATCH');
assert.equal(compareNightReferences(last,{...tfl,tradingDate:'2026-10-28'}).status,'DATE_OR_CONTRACT_MISMATCH');
assert.equal(compareNightReferences(last,null).status,'TFL_SAME_DATE_CLOSED_REFERENCE_MISSING');
console.log('NH/TFL public reference comparison: latest valid tick, conflict/date/month guards and difference passed');

const {spawnSync}=await import('node:child_process');
const cli=spawnSync(process.execPath,['scripts/nhplug-night-tfl-compare.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH||'/usr/bin:/bin'}});
assert.equal(cli.status,1);assert.match(cli.stdout,/NH_DIAGNOSTIC_FAILED/);
