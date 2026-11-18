// NH account/interest contract probe. Candidate only. No source writes or token issuance.
function handleDiagnoseNhFinancialIncome(params) {
  if (typeof _issue507GateInside_ !== 'undefined' && !_issue507GateInside_) return _issue507GateInvoke_('handleDiagnoseNhFinancialIncome', handleDiagnoseNhFinancialIncome, this, arguments);
  if (!_nhProxyAuthenticated_(params)) return jsonError('NH_FINANCE_AUTH_REQUIRED');
  if (String(params.mode||'')!=='contract') return jsonError('NH_FINANCE_MODE_REQUIRED');
  try {
    var c=_nhCredentials_();
    if(!_nhEnabled_()||!c.key||!c.secret)return jsonError('NH_FINANCE_DISABLED');
    // Deliberately use the existing persisted credential-scoped bearer only.
    // Do not call _nhAccessToken_ or _nhForgetToken_, even following 401.
    var cached=_nhValidTokenRecord_(PropertiesService.getScriptProperties().getProperty('NHPLUG_AUTH_RECORD_V1'),_nhTokenScope_(c));
    if(!cached)return jsonError('NH_FINANCE_CACHED_TOKEN_REQUIRED');
    var now=new Date(),end=Utilities.formatDate(now,'Asia/Seoul','yyyyMMdd');
    var start=Utilities.formatDate(new Date(now.getTime()-29*86400000),'Asia/Seoul','yyyyMMdd');
    var out={provider:'NH',gasVersion: '9.298',readOnly:true,diagnosticOnly:true,tokenIssued:false,
      bearerExposed:false,financialOriginalWritten:false,financialTaxClassificationVerified:false,
      accountTaxTypeVerified:false,fullYearCoverage:false,dates:{from:start,to:end},
      accountListVerified:false,ownLiveAccounts:0,otherAccountsSkipped:0,
      accountsProbed:0,accountsSucceeded:0,accountsRejected:0,rows:0,continuationPresent:0,
      validDatedRows:0,interestFieldRows:0,positiveInterestFieldRows:0,taxFieldRows:0,
      krwRows:0,nonKrwOrMissingCurrencyRows:0,descriptionPresentRows:0,stopped:'NONE'};
    // Fixed read-only routes. Never accept a URL, account number, path or
    // request payload from the caller, and never serialize upstream bodies.
    function read(path,input){
      if(path!=='/n2/acctinfo'&&path!=='/common/inquiry/v1/totalTransaction')throw Error('NH_FINANCE_PATH');
      if(Number(cached.expiresAt)<=Date.now()+60000)return {state:'TOKEN_EXPIRES'};
      var res=UrlFetchApp.fetch('https://api.nhplug.com:8443'+path,{method:'post',
        contentType:'application/json; charset=UTF-8',followRedirects:false,muteHttpExceptions:true,
        headers:{Authorization:'Bearer '+cached.token},payload:JSON.stringify({Input_0:input})});
      var code=res.getResponseCode();
      if(code===401||code===429||code===403)return {state:'HTTP_'+code};
      if(code<200||code>=300)return {state:'HTTP_OTHER'};
      var body;
      try{body=JSON.parse(res.getContentText());}catch(ignore){return {state:'INVALID_JSON'};}
      // A response code alone is insufficient. Require an explicit successful
      // query message and an actual array (omitted block remains unverified).
      var msg=String(body&&body.rsp_msg||body&&body.message&&body.message.rsp_msg||'').trim();
      if(!/조회가 완료되었습니다[.]?$/.test(msg)||!Array.isArray(body.Output_0))return {state:'RESPONSE_UNVERIFIED'};
      var headers=res.getAllHeaders(),continuation=false;
      Object.keys(headers||{}).forEach(function(k){if(k.toLowerCase()==='cts'&&String(headers[k]||'').trim())continuation=true;});
      return {state:'OK',rows:body.Output_0,continuation:continuation};
    }
    var account=read('/n2/acctinfo',{});
    if(account.state!=='OK')return jsonError('NH_FINANCE_ACCOUNT_'+account.state);
    // The API's acct_type 01 means the user's live account, NOT tax type.
    // Skip delegated and simulated accounts; never reveal numbers or names.
    var seen={},ids=[];
    for(var i=0;i<account.rows.length;i++){
      var a=account.rows[i];
      if(!a||typeof a.acct_type!=='string'||!['01','02','03'].includes(a.acct_type))return jsonError('NH_FINANCE_ACCOUNT_SHAPE');
      if(a.acct_type!=='01'){out.otherAccountsSkipped++;continue;}
      if(typeof a.acct_no!=='string'||!/^\d{11}$/.test(a.acct_no)||seen[a.acct_no])return jsonError('NH_FINANCE_ACCOUNT_IDENTITY');
      seen[a.acct_no]=true;ids.push(a.acct_no);
    }
    out.accountListVerified=true;
    out.ownLiveAccounts=ids.length;
    // Diagnostic only: one page per self-owned live account, at most 12.
    // Even zero results never establish an annual zero interest balance.
    function validNumber(n){return (typeof n==='number'||typeof n==='string'&&/^-?\d+(?:\.\d+)?$/.test(n.trim()))&&isFinite(Number(n));}
    function validDate(s){
      if(typeof s!=='string'||!/^\d{8}$/.test(s)||s<start||s>end)return false;
      var y=Number(s.slice(0,4)),m=Number(s.slice(4,6)),d=Number(s.slice(6,8)),v=new Date(Date.UTC(y,m-1,d));
      return v.getUTCFullYear()===y&&v.getUTCMonth()===m-1&&v.getUTCDate()===d;
    }
    for(var j=0;j<Math.min(ids.length,12);j++){
      Utilities.sleep(1000);
      out.accountsProbed++;
      var page=read('/common/inquiry/v1/totalTransaction',{
        iqr_tp_cd:'2',iqr_rge_cd:'2',act_no:ids[j],iqr_sta_dt:start,iqr_end_dt:end,iem_llf_cd:'00',act_trd_dtl_cd:'00'
      });
      if(page.state!=='OK'){
        out.accountsRejected++;
        if(['HTTP_401','HTTP_403','HTTP_429','TOKEN_EXPIRES'].includes(page.state)){out.stopped=page.state;break;}
        continue;
      }
      out.accountsSucceeded++;
      if(page.continuation)out.continuationPresent++;
      for(var k=0;k<page.rows.length;k++){
        var row=page.rows[k]||{};out.rows++;
        if(validDate(row.trd_dt))out.validDatedRows++;
        if(validNumber(row.int_amt)){out.interestFieldRows++;if(Number(row.int_amt)>0)out.positiveInterestFieldRows++;}
        if(validNumber(row.tax_sum))out.taxFieldRows++;
        if(row.cur_cd==='KRW')out.krwRows++;else out.nonKrwOrMissingCurrencyRows++;
        if(typeof row.sps_cd_krl_anm==='string'&&row.sps_cd_krl_anm.trim())out.descriptionPresentRows++;
      }
    }
    if(out.stopped==='NONE'&&ids.length>12)out.stopped='ACCOUNT_LIMIT';
    return jsonOk(out);
  }catch(ignore){return jsonError('NH_FINANCE_CONTRACT_UNAVAILABLE');}
}
