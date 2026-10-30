import assert from 'node:assert/strict';
import {SPEC_URL,inspectNhDomesticIndexCatalog,inspectPublicNhSpec} from './nh-domestic-index-catalog-probe.mjs';

const op=(summary,req={},out={})=>({
 summary,operationId:'example',
 requestBody:{content:{'application/json':{schema:{properties:{Input_0:{properties:req}}}}}},
 responses:{'200':{content:{'application/json':{schema:{properties:out}}}}}
});
const etf=op('ETF/ETN 현재가',{iem_cd:{description:'종목코드'}},{
 Output_0:{properties:{iem_cd:{},stck_prpr:{}}},
 Output_4:{properties:Object.fromEntries(['bstp_cls_code','bstp_kor_isnm','prpr_nmix','jisukpgubun'].map(k=>[k,{}]))}
});
const spec={openapi:'3.0.3',info:{version:'v1'},paths:{
 '/krstock/quote/v1/currentPrice':{post:op('주식현재가 시세',{iem_cd:{}},{Output_0:{properties:{bstp_cls_code:{}}}})},
 '/krstock/quote/v1/etfCurrent':{post:etf},
 '/krstock/order/v1/cashBuy':{post:op('현금 매수주문',{iem_cd:{}})}
}};
const result=inspectNhDomesticIndexCatalog(spec);
assert.equal(result.status,'NO_DIRECT_ENDPOINT_DOCUMENTED');
assert.equal(result.quoteOperationCount,2);
assert.equal(result.nhConfirmedDomesticSpotIndexCount,0);
assert.deepEqual(result.directCandidates,[]);
assert.equal(result.embedded.length,1);
assert.equal(result.embedded[0].classification,'ETF_EMBEDDED_INDEX_ONLY');
assert.equal(result.embedded[0].tradingDateVerified,false);
assert.equal(result.embedded[0].finalCloseVerified,false);
const expanded=structuredClone(spec);
expanded.paths['/krstock/quote/v1/sectorIndex']={post:op('업종 현재지수 조회',{
 index_cd:{description:'업종 지수코드'}
},{Output_0:{properties:{prpr_nmix:{description:'지수'}}}})};
const proposed=inspectNhDomesticIndexCatalog(expanded);
assert.equal(proposed.status,'DIRECT_ENDPOINT_CANDIDATE_REVIEW_REQUIRED');
assert.equal(proposed.directCandidates.length,1);
assert.equal(proposed.directCandidates[0].classification,'REQUIRES_OFFICIAL_IDENTITY_AND_LIVE_CHECK');
assert.equal(proposed.nhConfirmedDomesticSpotIndexCount,0,'catalogue cannot prove a real close');
const missingOutput=structuredClone(spec);
delete missingOutput.paths['/krstock/quote/v1/etfCurrent'].post.responses['200'].content['application/json'].schema.properties.Output_4;
assert.equal(inspectNhDomesticIndexCatalog(missingOutput).embedded.length,0);
assert.throws(()=>inspectNhDomesticIndexCatalog({openapi:'3.0.3',paths:{}}),/NH_INDEX_SPEC_DOMESTIC_QUOTE_MISSING/);
assert.throws(()=>inspectNhDomesticIndexCatalog({paths:{}}),/NH_INDEX_SPEC_SCHEMA_INVALID/);
let calls=0;
const mocked=await inspectPublicNhSpec({request:async(url,opts)=>{
 calls++;assert.equal(url,SPEC_URL);assert.equal(opts.method,'GET');
 assert.equal(opts.redirect,'error');assert.equal(opts.headers,undefined);
 return {ok:true,text:async()=>JSON.stringify(spec)};
},log:()=>{}});
assert.equal(calls,1);
assert.equal(mocked.status,'NO_DIRECT_ENDPOINT_DOCUMENTED');
await assert.rejects(inspectPublicNhSpec({request:async()=>({ok:false,status:503})}),/NH_INDEX_SPEC_HTTP_503/);
console.log('NH public index catalogue: embedded vs direct endpoint contract, no token, fail closed PASS');
