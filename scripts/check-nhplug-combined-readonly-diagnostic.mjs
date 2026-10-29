import assert from 'node:assert/strict';
import {diagnoseCombined} from './nhplug-combined-readonly-diagnostic.mjs';
const key='example-key',secret='example-secret',token='example-token';
const res=(status,payload)=>({status,ok:status>=200&&status<300,json:async()=>payload});
function fake({failStock=false}={}) {
  const calls=[];
  const request=async (url,opts)=>{
    calls.push({url,opts});
    if(url.endsWith('/m_gtsstock.h'))return {status:404,ok:false};
    if(url.includes('/oauth2/token'))return res(200,{access_token:token});
    const input=JSON.parse(opts.body).Input_0;
    if(failStock && input.iem_cd==='005930')return res(401,{});
    if(url.endsWith('/currentDaily'))return res(200,{Output_0:[{bsop_date:'20261029',stck_clpr:'71300'}]});
    const isUS=input.iem_cd==='AAPL'||input.iem_cd==='QQQ';
    return res(200,{Output_0:{iem_cd:input.iem_cd,...(isUS?{trdprc:'42.1',trade_date:'20261028'}:{stck_prpr:'71300'})}});
  };
  return {calls,request};
}
const now=()=>new Date('2026-10-29T07:00:00Z');
{
  const x=fake(),logs=[];
  assert.equal(await diagnoseCombined({key,secret,request:x.request,log:s=>logs.push(s),wait:async()=>{},now}),true);
  assert.equal(x.calls.filter(c=>c.url.includes('/oauth2/token')).length,1);
  const api=x.calls.filter(c=>c.opts.method==='POST'&&!c.url.includes('/oauth2/token'));
  assert.equal(api.length,7);
  for(const call of api)assert.equal(call.opts.headers.authorization,'Bearer '+token);
  assert.doesNotMatch(logs.join('\n'),/example-(key|secret|token)|71300|42\.1/);
  assert.match(logs.join('\n'),/COMBINED PASS NIGHT_FUTURE_UNVERIFIED/);
}
{
  const x=fake({failStock:true}),logs=[];
  assert.equal(await diagnoseCombined({key,secret,request:x.request,log:s=>logs.push(s),wait:async()=>{},now}),false);
  assert.equal(x.calls.filter(c=>c.url.includes('/oauth2/token')).length,1);
  assert.equal(x.calls.some(c=>c.url.endsWith('/currentDaily')),false);
  assert.match(logs.join('\n'),/CLOSE_SKIPPED_AUTH_OR_RATE_LIMIT/);
}
{
  const x=fake(),logs=[];
  assert.equal(await diagnoseCombined({key,secret,request:x.request,log:s=>logs.push(s),now:()=>new Date('2026-10-29T06:00:00Z')}),false);
  assert.equal(x.calls.length,0);
}
console.log('NH PLUG combined read-only checks passed');
