import {pathToFileURL} from 'node:url';

// Public NH OpenAPI metadata only. No bearer, app key, pricing calls or writes.
export const SPEC_URL='https://www.nhplug.com/openapi-docs/krstock/openapi.json';
const MAX_BYTES=5_000_000;
function propertiesOf(op,kind) {
  const schema=kind==='request'
    ? op?.requestBody?.content?.['application/json']?.schema
    : op?.responses?.['200']?.content?.['application/json']?.schema;
  return schema?.properties||{};
}
export function inspectNhDomesticIndexCatalog(spec) {
  if(!spec || typeof spec!=='object' || !spec.paths || typeof spec.paths!=='object'
    || !String(spec.openapi||'').startsWith('3.'))throw Error('NH_INDEX_SPEC_SCHEMA_INVALID');
  const domestic=Object.entries(spec.paths).filter(([path])=>path.startsWith('/krstock/quote/'));
  if(domestic.length===0)throw Error('NH_INDEX_SPEC_DOMESTIC_QUOTE_MISSING');
  const embedded=[],directCandidates=[];
  for(const [path,methods] of domestic) {
    const op=methods?.post;
    if(!op)continue;
    const response=propertiesOf(op,'response');
    const fields=response?.Output_4?.properties||{};
    const indexFields=['bstp_cls_code','bstp_kor_isnm','prpr_nmix','jisukpgubun'];
    if(path.endsWith('/etfCurrent') && indexFields.every(k=>Object.hasOwn(fields,k))) {
      embedded.push({path,operationId:String(op.operationId||''),
        classification:'ETF_EMBEDDED_INDEX_ONLY',tradingDateVerified:false,finalCloseVerified:false});
    }
    // A new dedicated index operation is only a schema-review candidate.
    // A generic stock/ETF operation containing index metadata is NOT sufficient.
    const title=String(op.summary||'');
    const req=JSON.stringify(propertiesOf(op,'request'));
    const out=JSON.stringify(response);
    const likelyDirect= /(?:업종|시장|종합|코스피|코스닥).{0,12}지수|지수.{0,12}(?:현재|일자|시세|조회)/.test(title)
      && /지수|업종/.test(req) && /지수/.test(out)
      && !/etf|etn|주식현재가|종목현재가/i.test(title);
    if(likelyDirect)directCandidates.push({path,summary:title,operationId:String(op.operationId||''),
      classification:'REQUIRES_OFFICIAL_IDENTITY_AND_LIVE_CHECK'});
  }
  return {
    status:directCandidates.length?'DIRECT_ENDPOINT_CANDIDATE_REVIEW_REQUIRED':'NO_DIRECT_ENDPOINT_DOCUMENTED',
    specVersion:String(spec.info?.version||''),quoteOperationCount:domestic.length,
    embedded,directCandidates,nhConfirmedDomesticSpotIndexCount:0,
  };
}
export async function inspectPublicNhSpec({request=fetch,log=console.log}={}) {
  const res=await request(SPEC_URL,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw Error('NH_INDEX_SPEC_HTTP_'+res.status);
  const raw=await res.text();
  if(!raw||Buffer.byteLength(raw,'utf8')>MAX_BYTES)throw Error('NH_INDEX_SPEC_SIZE_INVALID');
  const result=inspectNhDomesticIndexCatalog(JSON.parse(raw));
  log(JSON.stringify(result));
  return result;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  inspectPublicNhSpec().catch(e=>{console.error(/^NH_INDEX_SPEC_[A-Z0-9_]+$/.test(e?.message||'')?e.message:'NH_INDEX_SPEC_UNAVAILABLE');process.exitCode=1;});
}
