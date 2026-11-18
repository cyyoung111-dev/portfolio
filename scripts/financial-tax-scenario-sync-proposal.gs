// Private annual assumptions, not the financial ledger. Source preview only.
var FIN_TAX_SCENARIO_FIELDS_=['capitalExempt','etfTaxDifference','certificateSpecial','otherTaxBase','grossUpOrdinary','grossUpSpecial'];
function _financialTaxScenarioRevision_(value){
  return typeof value==='string'&&(value==='0'||/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value));
}
function _financialTaxScenarioNormalize_(value){
  if(value===null)return null;
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||!value.details||typeof value.details!=='object'||Array.isArray(value.details))
    throw Error('INVALID');
  var amount=function(v){if(v===null)return null;if(!Number.isSafeInteger(v)||v<0)throw Error('INVALID');return v;};
  if(Object.keys(value).some(function(k){return k!=='interest'&&k!=='details';})
    ||Object.keys(value.details).some(function(k){return FIN_TAX_SCENARIO_FIELDS_.indexOf(k)<0;}))throw Error('INVALID');
  var interest=amount(value.interest),details={};
  FIN_TAX_SCENARIO_FIELDS_.forEach(function(k){details[k]=amount(value.details[k]);});
  return interest===null&&FIN_TAX_SCENARIO_FIELDS_.every(function(k){return details[k]===null;})?null:{interest:interest,details:details};
}
function _financialTaxScenarioRead_(props,key){
  var raw=props.getProperty(key);
  if(raw===null)return {revision:'0',record:null};
  var item=JSON.parse(raw);
  if(!item||!_financialTaxScenarioRevision_(item.revision)||item.revision==='0')throw Error('STORED_INVALID');
  var record=_financialTaxScenarioNormalize_(item.record);
  return {revision:item.revision,record:record};
}
function handleFinancialTaxScenarioSync(params,write){
  var lock=null,locked=false;
  try{
    var props=PropertiesService.getScriptProperties();
    // The legacy app permits tokenless installations; private tax data does not.
    if(!String(props.getProperty('access_token')||'').trim()||!_isAuthorizedRequest(params))
      return jsonError('인증 필요',{errorCode:'TAX_SCENARIO_AUTH_REQUIRED'});
    var year=String(params.year||'');
    if(!/^\d{4}$/.test(year)||Number(year)<2000||Number(year)>2100)
      return jsonError('귀속연도 확인',{errorCode:'TAX_SCENARIO_INVALID'});
    var key='pf_fin_tax_scenario_v1_'+year;
    var result=function(item){return jsonOk({protocol:1,gasVersion:'9.300',year:Number(year),revision:item.revision,record:item.record});};
    if(!write)return result(_financialTaxScenarioRead_(props,key));
    var expected=params.expectedRevision;
    if(!_financialTaxScenarioRevision_(expected)||typeof params.data!=='string'||params.data.length>2048)
      return jsonError('저장 입력 확인',{errorCode:'TAX_SCENARIO_INVALID'});
    var record;
    try{record=_financialTaxScenarioNormalize_(JSON.parse(params.data));}
    catch(ignore){return jsonError('저장 입력 확인',{errorCode:'TAX_SCENARIO_INVALID'});}
    lock=LockService.getScriptLock();lock.waitLock(5000);locked=true;
    var old=_financialTaxScenarioRead_(props,key);
    if(old.revision!==expected)return jsonError('다른 기기에서 변경됨',{errorCode:'TAX_SCENARIO_CONFLICT'});
    // A null record with a real revision is an authoritative tombstone. Keep it
    // so another device cannot automatically resurrect pre-sync local values.
    if(old.revision!=='0'&&JSON.stringify(old.record)===JSON.stringify(record))return result(old);
    var next={revision:Utilities.getUuid().toLowerCase(),record:record};
    if(!_financialTaxScenarioRevision_(next.revision)||next.revision==='0'||next.revision===old.revision)throw Error('REVISION_INVALID');
    props.setProperty(key,JSON.stringify(next));
    var verified=_financialTaxScenarioRead_(props,key);
    if(JSON.stringify(verified)!==JSON.stringify(next))throw Error('READBACK_UNVERIFIED');
    return result(verified);
  }catch(ignore){
    // No raw data, token or underlying storage exception in the response.
    return jsonError('세제 가정 저장 또는 조회 미확인',{errorCode:'TAX_SCENARIO_UNVERIFIED'});
  }finally{if(locked)lock.releaseLock();}
}
