import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {pathToFileURL} from 'node:url';

// Read-only production calls. Output deliberately contains counts, never holdings, codes, keys or raw responses.
export async function runStockDividendDiagnosis({url:rawUrl, token, fetchImpl=fetch}) {
  const url=validateWebAppUrl(rawUrl);
  if(!token) throw Error('DIVIDEND_DIAG_AUTH_REQUIRED');
  async function call(action,args={},access=token) {
    let r;
    try { r=await fetchImpl(url,{method:'POST',redirect:'follow',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({action,...args,accessToken:access}),signal:AbortSignal.timeout(240000)}); }
    catch { throw Error('DIVIDEND_DIAG_REQUEST_FAILED'); }
    if(!r.ok) throw Error('DIVIDEND_DIAG_HTTP_FAILED');
    try { return await r.json(); } catch { throw Error('DIVIDEND_DIAG_JSON_FAILED'); }
  }
  const denied=await call('getCodeListReadOnly',{},'DIVIDEND_BAD_AUTH_PROBE');
  if(denied.status==='ok') throw Error('DIVIDEND_DIAG_AUTH_NOT_ENFORCED');
  const catalog=await call('getCodeListReadOnly');
  if(catalog.status!=='ok'||!Array.isArray(catalog.codes)) {
    const reason=['CODE_LIST_READ_ONLY_BUSY','CODE_LIST_READ_ONLY_PENDING','CODE_LIST_READ_ONLY_FAILED'].includes(catalog.message)?catalog.message:'CATALOG';
    throw Error('DIVIDEND_DIAG_'+reason);
  }
  if(catalog.readOnly!==true||catalog.gasVersion!=='9.268') throw Error('DIVIDEND_DIAG_VERSION');
  const stocks=catalog.codes.filter(c=>/^\d{6}$/.test(String(c.code))&&
    !['ETF','TDF','펀드','FUND'].includes(String(c.assetType||c.type||'').toUpperCase()));
  const unique=[...new Map(stocks.map(c=>[String(c.code),c])).values()];
  if(!unique.length) return {mode:'READ_ONLY_STOCK_DIVIDEND_DIAGNOSIS',targets:0,originalDataWritten:false};
  const result=await call('dividendPublic',{codes:unique.map(c=>c.code).join(','),names:unique.map(c=>c.name||'').join('|')});
  if(result.status!=='ok'||!result.diagnostics||!result.dividends) throw Error('DIVIDEND_DIAG_RESPONSE');
  const stages={},normalized={inputRows:0,acceptedEvents:0,rejected:{identity:0,amount:0,date:0,beforeRange:0,duplicate:0}};
  const statuses=new Set(['NETWORK_ERROR','HTTP_ERROR','JSON_INVALID','API_ERROR','RESPONSE_INVALID','PARTIAL_PAGE','OK','NO_ROWS','IDENTITY_MISMATCH']);
  const errorNames=new Set(['SERVICE_ACCESS_DENIED_ERROR','SERVICE_KEY_IS_NOT_REGISTERED_ERROR','DEADLINE_HAS_EXPIRED_ERROR',
    'NO_OPENAPI_SERVICE_ERROR','SERVICE_KEY_IS_NULL','PERMISSION_DENIED','BLACKLIST_IP_ACCESS_ERROR',
    'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR','LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR']);
  let verified=0;
  for(const stage of ['listed','dividend','retry']) {
    const counts={},http={},provider={},errors={};let inspected=0;
    for(const c of unique) {
      const d=result.diagnostics[stage]?.[c.code];
      if(!d) {if(stage!=='retry') throw Error('DIVIDEND_DIAG_COVERAGE');continue;}
      if(!statuses.has(d.status)) throw Error('DIVIDEND_DIAG_STATUS');
      inspected++;counts[d.status]=(counts[d.status]||0)+1;
      if(Number.isInteger(d.httpStatus)&&d.httpStatus>=100&&d.httpStatus<=599) http[d.httpStatus]=(http[d.httpStatus]||0)+1;
      // Explicit allowlist; arbitrary provider text cannot leak into Actions logs.
      if(['00','0','01','02','03','04','05','10','11','12','20','21','22','23','29','30','31','32','99'].includes(d.providerCode))
        provider[d.providerCode]=(provider[d.providerCode]||0)+1;
      if(errorNames.has(d.providerError)) errors[d.providerError]=(errors[d.providerError]||0)+1;
    }
    stages[stage]={inspected,statuses:counts,httpStatuses:http,providerCodes:provider,providerErrors:errors};
  }
  for(const c of unique) {
    const n=result.diagnostics.normalized?.[c.code];
    if(!n||![n.inputRows,n.acceptedEvents,...Object.keys(normalized.rejected).map(k=>n.rejected?.[k])].every(v=>Number.isInteger(v)&&v>=0))
      throw Error('DIVIDEND_DIAG_NORMALIZATION');
    normalized.inputRows+=n.inputRows;normalized.acceptedEvents+=n.acceptedEvents;
    for(const k of Object.keys(normalized.rejected)) normalized.rejected[k]+=n.rejected[k];
    if(n.acceptedEvents>0) verified++;
  }
  return {mode:'READ_ONLY_STOCK_DIVIDEND_DIAGNOSIS',targets:unique.length,withAcceptedEvents:verified,withoutAcceptedEvents:unique.length-verified,
    stages,normalized,originalDataWritten:false};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href) {
  try { console.log(JSON.stringify(await runStockDividendDiagnosis({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN}))); }
  catch(e) { console.error(/^DIVIDEND_DIAG_[A-Z_]+$/.test(e?.message||'')?e.message:'DIVIDEND_DIAG_FAILED');process.exitCode=1; }
}
