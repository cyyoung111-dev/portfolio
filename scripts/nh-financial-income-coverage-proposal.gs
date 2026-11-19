// Invoked inside the existing authenticated, read-only handler.
// Coverage remains a first-page diagnostic, not a complete annual ledger.
function coverageSample(){
  var result={provider:'NH',gasVersion:'9.303',readOnly:true,diagnosticOnly:true,
    tokenIssued:false,bearerExposed:false,financialOriginalWritten:false,
    financialTaxClassificationVerified:false,accountTaxTypeVerified:false,fullYearCoverage:false,
    accountListVerified:true,ownLiveAccounts:ids.length,otherAccountsSkipped:out.otherAccountsSkipped,
    asOf:end,windows:[],stopped:'NONE',accountsStarted:0,accountsSampled:0};
  var year=Number(end.slice(0,4)),month=Number(end.slice(4,6)),maxCalls=16;
  function pad(n){return ('0'+n).slice(-2);}
  function windowFor(m){
    return {from:String(year)+pad(m)+'01',to:m===month?end:String(year)+pad(m)+pad(new Date(Date.UTC(year,m,0)).getUTCDate())};
  }
  function dated(s,w){
    if(typeof s!=='string'||!/^\d{8}$/.test(s)||s<w.from||s>w.to)return false;
    var y=Number(s.slice(0,4)),m=Number(s.slice(4,6)),d=Number(s.slice(6,8)),v=new Date(Date.UTC(y,m-1,d));
    return v.getUTCFullYear()===y&&v.getUTCMonth()===m-1&&v.getUTCDate()===d;
  }
  function scan(kind,index,w) {
    if(result.windows.length>=maxCalls){result.stopped='QUERY_LIMIT';return false;}
    Utilities.sleep(1000);
    var input={iqr_tp_cd:'2',act_no:ids[index],iqr_sta_dt:w.from,iqr_end_dt:w.to,
      act_trd_dtl_cd:kind==='TOTAL'?'00':'01'};
    if(kind==='TOTAL'){input.iqr_rge_cd='2';input.iem_llf_cd='00';}
    var page=read(kind==='TOTAL'?'/common/inquiry/v1/totalTransaction':'/common/inquiry/v1/depositWithdrawal',input);
    var item={accountOrdinal:index+1,route:kind,from:w.from,to:w.to,status:page.state,
      rows:0,validDatedRows:0,interestFieldRows:0,positiveInterestFieldRows:0,taxFieldRows:0,descriptionPresentRows:0,
      continuation:false,evidence:page.evidence||null};
    if(page.state==='OK'){
      item.continuation=page.continuation;
      item.status=page.rows.length?'ROWS_OBSERVED':page.continuation?'EMPTY_WITH_CONTINUATION':'EMPTY_ARRAY';
      for(var i=0;i<page.rows.length;i++){
        var row=page.rows[i]||{};item.rows++;
        if(dated(row.trd_dt,w))item.validDatedRows++;
        if(typeof row.sps_cd_krl_anm==='string'&&row.sps_cd_krl_anm.trim()||
           kind==='DEPOSIT'&&typeof row.act_trd_tp_nm==='string'&&row.act_trd_tp_nm.trim())item.descriptionPresentRows++;
        if(kind==='TOTAL'){
          if(validNumber(row.int_amt)){item.interestFieldRows++;if(Number(row.int_amt)>0)item.positiveInterestFieldRows++;}
          if(validNumber(row.tax_sum))item.taxFieldRows++;
        }
      }
    }
    result.windows.push(item);
    if(page.state!=='OK'&&page.state!=='NO_DATA_REPORTED'){result.stopped=page.state;return false;}
    return true;
  }
  // Calendar months, newest first. Distinct windows, never retry a rejected request.
  // One additional independent deposit inquiry if all total windows yielded no rows.
  // Do not add transaction amounts across routes, return amounts, or follow CTS.
  for(var a=0;a<ids.length;a++){
    if(result.windows.length>=maxCalls){result.stopped='QUERY_LIMIT';break;}
    result.accountsStarted++;
    var found=false,complete=true,continuationSeen=false;
    for(var m=month;m>=1;m--){
      if(!scan('TOTAL',a,windowFor(m))){complete=false;break;}
      var recent=result.windows[result.windows.length-1];
      if(recent.rows>0)found=true;
      if(recent.continuation)continuationSeen=true;
    }
    if(!complete)break;
    if(!found&&!continuationSeen){
      // Independent comparison of the same recent 30-day scope, never a sum.
      if(!scan('DEPOSIT',a,{from:start,to:end}))break;
    }
    result.accountsSampled++;
  }
  return jsonOk(result);
}
