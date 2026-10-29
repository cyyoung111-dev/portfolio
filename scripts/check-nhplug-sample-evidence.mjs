import assert from 'node:assert/strict';
import {evidenceRequest} from './nhplug-sample-evidence.mjs';

const out=[];
let payload;
const request=evidenceRequest(async()=>({ok:true,status:200,json:async()=>payload}),out);
const invoke=async (path,code,value)=>{payload=value;const r=await request('https://api.nhplug.com:8443'+path,{body:JSON.stringify({Input_0:{iem_cd:code}})});await r.json();};
await invoke('/krstock/quote/v1/currentDaily','005930',{Output_0:[{bsop_date:'20261029',stck_clpr:'71300',secret:'sensitive'}]});
await invoke('/gbstock/quote/v1/current','AAPL',{Output_0:{trade_date:'20261028',trdprc:'231.50',secret:'sensitive'}});
await invoke('/gbstock/quote/v1/current','QQQ',{Output_0:{trade_date:'bad',trdprc:'1'}});
await invoke('/krstock/quote/v1/currentDaily','UNLISTED',{Output_0:[{bsop_date:'20261029',stck_clpr:'99'}]});
assert.deepEqual(out,[{type:'KR_DAILY',symbol:'005930',date:'20261029',price:'71300'},{type:'US_QUOTE',symbol:'AAPL',date:'20261028',price:'231.50',time:'UNVERIFIED'}]);
assert.doesNotMatch(JSON.stringify(out),/sensitive/);
console.log('NH sample evidence allowlist checks passed');
