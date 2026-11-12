import assert from 'node:assert/strict';
import {analyzeNhFutureCatalog,inspectNhFutureCatalog} from './nh-k200-day-settlement-catalog-proof.mjs';
const spec={openapi:'3.0.3',paths:{
 '/krfuture/quote/v1/dayPeriod':{post:{
  operationId:'krfutureQuoteDayPeriod',summary:'국내_파생_시세_기간별주간',
  responses:{'200':{content:{'application/json':{schema:{
   $ref:'#/components/schemas/DayResponse'}}}}}}},
 '/krfuture/quote/v1/nightPeriod':{post:{
  summary:'국내_파생_시세_기간별야간',
  responses:{'200':{content:{'application/json':{schema:{
   properties:{Output_1:{items:{$ref:'#/components/schemas/NightRow'}}}}}}}}}},
 '/krfuture/order/v1/cashBuy':{post:{summary:'주문',responses:{'200':{}}}}
 },components:{schemas:{
 DayResponse:{properties:{Output_1:{items:{$ref:'#/components/schemas/DayRow'}}}},
 DayRow:{properties:{bsop_date:{type:'string',description:'거래일자'},
   sttl_prc:{type:'string',description:'주간 정산가'},prpr:{type:'string',description:'현재가'}}},
 NightRow:{properties:{prdy_clpr:{type:'string',description:'전일 종가'}}}
 }}};
const result=analyzeNhFutureCatalog(spec);
assert.equal(result.count,2);
assert.equal(result.actualPriceRetrieved,false);
assert.equal(result.settlementFinalityVerified,false);
assert.equal(result.pre0740AvailabilityVerified,false);
const d=result.candidates.find(x=>x.path.endsWith('/dayPeriod'));
assert.equal(d.hasExplicitSettlementField,true);
assert.ok(d.potentialBaselineFields.some(x=>x.includes('sttl_prc')));
assert.ok(result.candidates.every(x=>!x.path.includes('/order/')));
assert.equal(analyzeNhFutureCatalog({openapi:'2.0',paths:{}}),null);
assert.equal(analyzeNhFutureCatalog({openapi:'3.0.0',paths:[]}),null);
const checked=await inspectNhFutureCatalog({fetchImpl:async(url,opts)=>{
 assert.equal(url,'https://www.nhplug.com/openapi-docs/krfuture/openapi.json');
 assert.equal(opts.method,'GET');
 assert.ok(!JSON.stringify(opts).includes('Authorization'));
 return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify(spec)};
}});
assert.equal(checked.status,'PUBLIC_CATALOG_PARSED');
assert.equal(checked.candidates.length,2);
const unavailable=await inspectNhFutureCatalog({fetchImpl:async()=>({ok:false,status:404})});
assert.equal(unavailable.status,'HTTP_404');
const malformed=await inspectNhFutureCatalog({fetchImpl:async()=>({ok:true,
 headers:{get:()=>null},text:async()=>'{bad'})});
assert.equal(malformed.status,'FETCH_UNAVAILABLE');
assert.ok(JSON.stringify(result).length<10000);
console.log('NH public futures catalog proof and no-price side-effect contract: PASS');
