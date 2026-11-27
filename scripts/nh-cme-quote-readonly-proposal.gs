// NH CME live quote contract proposal. Not registered in the production
// router or release workflow. Raw exchange clocks are NOT a verified UTC
// trade timestamp until actual provider evidence establishes timezone/scale.
function handleGetNhCmeQuoteProbe(params) {
  if (typeof _issue507GateInside_ !== 'undefined' && !_issue507GateInside_)
    return _issue507GateInvoke_('handleGetNhCmeQuoteProbe',handleGetNhCmeQuoteProbe,this,arguments);
  if (!_nhProxyAuthenticated_(params)) return jsonError('NH_CME_AUTH_REQUIRED');
  if (String(params.mode||'')!=='contract') return jsonError('NH_CME_MODE_REQUIRED');
  function day(s) {
    if(typeof s!=='string'||!/^\d{8}$/.test(s))return false;
    var v=new Date(s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8)+'T00:00:00Z');
    return isFinite(v.getTime())&&v.toISOString().slice(0,10).replace(/-/g,'')===s;
  }
  function clock(s) {
    return typeof s==='string'&&/^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d(?:\d{1,6})?$/.test(s);
  }
  function positive(n) {
    return (typeof n==='number'||typeof n==='string'&&/^\d+(?:\.\d+)?$/.test(n.trim()))
      &&isFinite(Number(n))&&Number(n)>0;
  }
  var now=new Date(),today=Utilities.formatDate(now,'Asia/Seoul','yyyy-MM-dd'),
    chi=Utilities.formatDate(now,'America/Chicago','yyyyMMdd'),
    roots=['ES','NQ','YM','RTY'],month={H:'03',M:'06',U:'09',Z:'12'},rows;
  if(params.date!==today||params.masterDate!==chi)return jsonError('NH_CME_DATE_UNVERIFIED');
  try { rows=JSON.parse(String(params.contracts||'')); }catch(ignore){return jsonError('NH_CME_CONTRACTS_INVALID');}
  if(!Array.isArray(rows)||rows.length!==roots.length)return jsonError('NH_CME_CONTRACTS_INVALID');
  for(var i=0;i<roots.length;i++){
    var r=rows[i],m=r&&typeof r.contract==='string'?/^(ES|NQ|YM|RTY)([HMUZ])(\d{2})$/.exec(r.contract):null;
    if(!m||r.id!==roots[i]||m[1]!==r.id||r.exchange!=='FCME'||!day(r.expiry)
      ||r.expiry.slice(0,6)!=='20'+m[3]+month[m[2]]||r.expiry<chi)
      return jsonError('NH_CME_CONTRACTS_INVALID');
  }
  try {
    var c=_nhCredentials_();
    if(!_nhEnabled_()||!c.key||!c.secret)return jsonError('NH_CME_DISABLED');
    var cached=_nhValidTokenRecord_(PropertiesService.getScriptProperties().getProperty('NHPLUG_AUTH_RECORD_V1'),_nhTokenScope_(c));
    if(!cached)return jsonError('NH_CME_CACHED_TOKEN_REQUIRED');
    var calls=0,results=[],stopped='NONE';
    function read(path,r){
      if(path!=='/gbfuture/quote/v1/current'&&path!=='/gbfuture/quote/v1/symbolDetail')throw Error('NH_CME_PATH');
      if(Number(cached.expiresAt)<=Date.now()+60000)return {state:'TOKEN_EXPIRES'};
      if(calls)Utilities.sleep(1000);
      if(Number(cached.expiresAt)<=Date.now()+60000)return {state:'TOKEN_EXPIRES'};
      calls++;
      var response;
      try{
        response=UrlFetchApp.fetch('https://api.nhplug.com:8443'+path,{
          method:'post',contentType:'application/json; charset=UTF-8',
          headers:{Authorization:'Bearer '+cached.token},followRedirects:false,muteHttpExceptions:true,
          payload:JSON.stringify({Input_0:{exnm:'FCME',iem_cd:r.contract}})
        });
      }catch(ignore){return {state:'NETWORK_UNVERIFIED'};}
      var http=response.getResponseCode();
      if([401,403,429].indexOf(http)>=0)return {state:'HTTP_'+http};
      if(http<200||http>=300)return {state:'HTTP_UNVERIFIED'};
      var body;
      try{body=JSON.parse(response.getContentText());}catch(ignore){return {state:'JSON_UNVERIFIED'};}
      var out=body&&body.Output_0;
      if(!out||typeof out!=='object'||Array.isArray(out)
        ||String(out.exnm||'').trim()!=='FCME'||String(out.iem_cd||'').trim()!==r.contract)
        return {state:'IDENTITY_UNVERIFIED'};
      return {state:'OK',row:out};
    }
    function terminal(s){return ['HTTP_401','HTTP_403','HTTP_429','TOKEN_EXPIRES','NETWORK_UNVERIFIED'].indexOf(s)>=0;}
    for(var j=0;j<rows.length;j++){
      var item=rows[j],result={id:item.id,contract:item.contract,status:'UNVERIFIED'};
      var quote=read('/gbfuture/quote/v1/current',item);
      if(quote.state!=='OK'){
        result.status=quote.state;results.push(result);
        if(terminal(quote.state)){stopped=quote.state;break;}continue;
      }
      var q=quote.row;
      if(q.cur!=='USD'||!positive(q.last)||!day(q.bday)||!clock(q.tdtm)){
        result.status='PRICE_OR_CLOCK_SHAPE_UNVERIFIED';results.push(result);continue;
      }
      var detail=read('/gbfuture/quote/v1/symbolDetail',item);
      if(detail.state!=='OK'){
        result.status=detail.state;results.push(result);
        if(terminal(detail.state)){stopped=detail.state;break;}continue;
      }
      var d=detail.row;
      if(d.cur1!=='USD'||d.zymd!==item.expiry||!day(d.oymd)||!day(d.cymd)||d.oymd>d.cymd
        ||!day(d.uymd)||!clock(d.uhms)||!clock(d.frhm)||!clock(d.tohm)){
        result.status='DETAIL_OR_CLOCK_SHAPE_UNVERIFIED';results.push(result);continue;
      }
      // Only fixed public quote fields. No upstream error text or entire
      // payload, keys, account data, tokens or inferred UTC timestamps.
      result.status='CONTRACT_AND_PRICE_SHAPE_VERIFIED';
      result.last=Number(q.last);result.previousClose=positive(q.pcls)?Number(q.pcls):null;
      result.tradeDate=q.bday;result.tradeClock=q.tdtm;
      result.sessionOpenDate=d.oymd;result.sessionCloseDate=d.cymd;
      result.sessionOpenClock=d.frhm;result.sessionCloseClock=d.tohm;
      result.updateDate=d.uymd;result.updateClock=d.uhms;
      result.priceIndicator=typeof q.pind==='string'&&/^[0-9A-L]$/.test(q.pind)?q.pind:null;
      result.adjustValue=positive(d.adjv)?Number(d.adjv):null;
      results.push(result);
    }
    return jsonOk({provider:'NH',mode:'CME_QUOTE_CONTRACT_ONLY',date:today,masterDate:chi,
      readOnly:true,diagnosticOnly:true,tokenIssued:false,bearerExposed:false,
      financialOriginalWritten:false,liveQuotesVerified:false,clockTimezoneVerified:false,
      priceScaleVerified:false,requests:calls,stopped:stopped,results:results});
  }catch(ignore){return jsonError('NH_CME_QUOTE_CONTRACT_UNAVAILABLE');}
}
