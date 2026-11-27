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

const {parseNhCmeLeadContracts,loadNhCmeLeadContracts,chicagoDate}=await import('./nh-cme-lead-contracts.mjs');
const layout=[['Symbol',32],['InnerSymbol',32],['CoreSymbol',12],['inrt',32],['ExchName',8],['EngName',80],['ExchId',3],['SymbolType',1],['Section',2],['Pind',1],['Tradable',1],['Onoff',1],['TickSize',17],['AdjustValue',17],['Leadmonth',1],['MonthYear',8],['PrevLast',17],['TickValue',17],['dummy',1]];
let offset=0;
const header='@record 283\n'+layout.map(([k,n])=>{const text='char '+k+'['+n+']; /* @'+offset+' */';offset+=n;return text;}).join('\n');
const pythonHeader='@record 283\n'+layout.map(([k,n])=>"('"+k+"', "+n+"),").join('\n');
const row=(contract,lead='1',expiry='20261218',exchange='FCME')=>{
 const b=Buffer.alloc(283,32);
 for(const [o,v] of [[32,contract],[108,exchange],[196,'E01'],[199,'F'],[200,'30'],[239,lead],[240,expiry]])b.write(v,o,'ascii');
 b[282]=10;return b;
};
const raw=Buffer.concat([row('ESZ26'),row('NQZ26'),row('YMZ26'),row('RTYZ26'),row('MESZ26'),row('ESH27','0','20270319')]);
const parsed=parseNhCmeLeadContracts(raw,header,'20261127');
assert.deepEqual(parsed.map(x=>x.contract),['ESZ26','NQZ26','YMZ26','RTYZ26']);
assert.deepEqual(parseNhCmeLeadContracts(raw,pythonHeader,'20261127'),parsed);
assert.equal(parseNhCmeLeadContracts(Buffer.concat([raw,row('ESZ26')]),header,'20261127')[0].status,'AMBIGUOUS_LEAD');
assert.equal(parseNhCmeLeadContracts(row('NQZ26'),header,'20261127')[0].status,'NO_LEAD');
assert.throws(()=>parseNhCmeLeadContracts(raw,header.replace('InnerSymbol[32]','InnerSymbol[31]'),'20261127'));
assert.throws(()=>parseNhCmeLeadContracts(raw,header,'20261219'));
assert.throws(()=>parseNhCmeLeadContracts(row('ESZ26','1','20261218','WRONG'),header,'20261127'));
assert.throws(()=>parseNhCmeLeadContracts(row('ESZ26','1','20260230'),header,'20261127'));
const corrupt=Buffer.from(raw);corrupt[282]=0;
assert.throws(()=>parseNhCmeLeadContracts(corrupt,header,'20261127'));
assert.equal(chicagoDate(new Date('2026-11-28T06:44:00+09:00')),'20261127');
const reads=[];
const master=await loadNhCmeLeadContracts({now:new Date('2026-11-28T06:44:00+09:00'),fetchImpl:async(url,opts)=>{
 reads.push(url);assert.equal(opts.method,'GET');assert.equal(opts.headers,undefined);assert.equal(opts.redirect,'error');
 return url.endsWith('.h')?{ok:true,text:async()=>header}:{ok:true,arrayBuffer:async()=>raw};
}});
assert.deepEqual(master.rows,parsed);assert.equal(master.quoteVerified,false);assert.equal(master.tokenIssued,false);
assert.equal(master.financialWrites,0);assert.deepEqual(reads,['https://www.nhplug.com/instruments/fucode_h.h','https://www.nhplug.com/instruments/fucode_h.mst']);
console.log('NH_CME_LEAD_MASTER_PASS exact identity, lead flag, expiry, record layout; no quote or credential claims');
