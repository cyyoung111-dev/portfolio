import {closingStockSessions} from './closing-extra-daily-sources.mjs';

// Contract-only proposal. The v9.281 production GAS does NOT expose this
// action; do not call it until an independent, approved GAS release implements
// the action. No changes to src/gas/apps_script.gs or financial master/sheets.
export const GAS_WATCH_ACTION='getBriefingWatchCloses';
export const WATCH_CODES=Object.freeze(['NVDA','MU']);

// GAS review candidate, NOT a deployable release. A future reviewed GAS
// version must pin a new full-source hash, all writer-gate entrypoints and
// explicitly dispatch this action within doPost behind strict auth.
export const PROPOSED_GAS_HANDLER=String.raw`function handleGetBriefingWatchCloses(params) {
  if (typeof _issue507GateInside_ !== 'undefined' && !_issue507GateInside_)
    return _issue507GateInvoke_('handleGetBriefingWatchCloses', handleGetBriefingWatchCloses, this, arguments);
  if (!_nhProxyAuthenticated_(params)) return jsonError('NH_WATCH_AUTH_REQUIRED');
  var now=new Date(),kst=_nhProxyKst_(now),minute=kst.minutes;
  if (!params || params.date!==kst.date || !/^20\\d{2}-\\d{2}-\\d{2}$/.test(params.date||'')
      || !((minute>=450&&minute<490)||(minute>=1010&&minute<1080)))
    return jsonError('NH_WATCH_WINDOW');
  var items=[{code:'NVDA',currency:'USD',market:'NASDAQ',type:'주식'},
             {code:'MU',currency:'USD',market:'NASDAQ',type:'주식'}];
  try {
    // Uses NH central GAS credentials and existing strict completed-close
    // source/date checks. Never add these watches to financial code master.
    var rows=fetchNhRegularCloses(items,params.date,{useMarketCloseCutoffs:true})||{};
    var out={};
    items.forEach(function(item){
      var expected=_foreignMarketRegularCloseCutoff_(item,now),row=rows[item.code];
      if (!row||row.source!=='NH_REGULAR_CLOSE'||row.priceType!=='REGULAR_CLOSE'
          ||row.status!=='CONFIRMED'||row.currency!=='USD'
          ||row.usedDate!==expected||row.marketDate!==expected
          ||typeof row.price!=='number'||!isFinite(row.price)||row.price<=0) return;
      out[item.code]={price:row.price,date:expected,source:'NH_REGULAR_CLOSE'};
    });
    return jsonOk({provider:'NH',readOnly:true,accountIndependent:true,
                   requestedDay:params.date,closes:out});
  }catch(ignore){return jsonError('NH_WATCH_UNAVAILABLE');}
}`;

export function normalizeWatchOnlyCloses(day,payload){
 const session=closingStockSessions(day);
 if(!session||payload?.status!=='ok'||payload.provider!=='NH'
  ||payload.readOnly!==true||payload.accountIndependent!==true
  ||payload.requestedDay!==day||!payload.closes
  ||typeof payload.closes!=='object'||Array.isArray(payload.closes))return [];
 if(Object.keys(payload.closes).some(code=>!WATCH_CODES.includes(code)))return [];
 const rows=[];
 for(const code of WATCH_CODES){
   const value=payload.closes[code];
   if(!value)continue;
   if(value.date!==session.us||value.source!=='NH_REGULAR_CLOSE'
     ||typeof value.price!=='number'||!Number.isFinite(value.price)||value.price<=0)
     continue;
   rows.push({id:code,label:code==='NVDA'?'엔비디아':'마이크론',
     symbol:code,date:session.us,value:value.price,
     changePercent:null,source:'NH_REGULAR_CLOSE',role:'BRIEFING_WATCH_ONLY'});
 }
 return rows;
}
