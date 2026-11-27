import assert from 'node:assert/strict';
import {QUOTE_CONTRACTS,inspectMarketSpec,auditMarketSpecs} from './nh-market-data-public-contract.mjs';
const fields=keys=>Object.fromEntries(keys.map(k=>[k,{type:'string'}]));
const specs={};
for(const [asset,route,inputs,outputs] of QUOTE_CONTRACTS){
 const spec=specs[asset]??={paths:{}};
 spec.paths['/'+asset+'/quote/v1/'+route]={post:{
  requestBody:{content:{'application/json':{schema:{properties:{Input_0:{required:inputs,properties:fields(inputs)}}}}}},
  responses:{200:{content:{'application/json':{schema:{properties:Object.fromEntries(Object.entries(outputs).map(([name,[type,...keys]])=>[name,type==='array'?{type,items:{properties:fields(keys)}}:{type,properties:fields(keys)}]))}}}}}
 }};
}
const requests=[];
const fake=async(url,opts)=>{
 requests.push({url,method:opts.method});
 const asset=new URL(url).pathname.split('/')[2];
 assert.equal(new URL(url).hostname,'www.nhplug.com');
 assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
 assert.equal(opts.headers,undefined);
 return {ok:true,json:async()=>specs[asset]};
};
const good=await auditMarketSpecs(fake);
assert.equal(requests.length,3);
assert.ok(good.groups.every(g=>g.status==='DOCUMENTED'));
assert.equal(good.groups.flatMap(g=>g.routes).length,8);
assert.equal(good.groups.flatMap(g=>g.routes).filter(r=>r.role==='CANDIDATE').length,2);
assert.equal(good.orders,0);assert.equal(good.accountQueries,0);
assert.equal(good.financialWrites,0);assert.equal(good.liveQuotesVerified,false);
const changed=structuredClone(specs.gbstock);
const period=changed.paths['/gbstock/quote/v1/period'].post;
period.requestBody.content['application/json'].schema.properties.Input_0.required.push('new_required');
delete period.responses[200].content['application/json'].schema.properties.Output_1.items.properties.close_prc;
const review=inspectMarketSpec('gbstock',changed).find(r=>r.path.endsWith('/period'));
assert.equal(review.status,'SCHEMA_REVIEW_REQUIRED');
assert.deepEqual(review.extraRequired,['new_required']);
assert.deepEqual(review.missingOutputs,['Output_1.close_prc']);
const swapped=structuredClone(specs.gbfuture);
swapped.paths['/gbfuture/quote/v1/current'].post.responses[200].content['application/json'].schema.properties.Output_0.type='array';
assert.equal(inspectMarketSpec('gbfuture',swapped)[0].status,'SCHEMA_REVIEW_REQUIRED');
const fail=await auditMarketSpecs(async()=>({ok:false,status:403}));
assert.ok(fail.groups.every(g=>g.status==='SPEC_UNAVAILABLE'));
const absent=await auditMarketSpecs(async()=>({ok:true,json:async()=>({})}));
assert.ok(absent.groups.every(g=>g.status==='SPEC_UNVERIFIED'));
console.log('NH_MARKET_DATA_PUBLIC_CONTRACT_PASS: 8 read-only quote contracts, missing fields/block changes/unavailable spec, no orders/accounts/token/financial writes');
