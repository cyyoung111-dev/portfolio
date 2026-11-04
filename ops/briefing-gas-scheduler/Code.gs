// Standalone Apps Script project only. Do NOT append to the portfolio production GAS.
// A separate 5-minute clock dispatches existing guarded GitHub early-arm workflows.
// It does NOT read/write sheets, mint NH tokens or call Telegram directly.
var BC_ZONE_ = 'Asia/Seoul';
var BC_API_ = 'https://api.github.com/repos/cyyoung111-dev/portfolio/';
var BC_SLOTS_ = [
  {id:'morning_primary',kind:'morning',from:440,until:459},
  {id:'morning_recovery',kind:'morning',from:465,until:479},
  {id:'morning_last',kind:'morning',from:480,until:486},
  {id:'close_primary',kind:'close',from:995,until:1015},
  {id:'close_recovery',kind:'close',from:1025,until:1045},
  {id:'close_last',kind:'close',from:1055,until:1070}
];
var BC_KIND_ = {
  morning:{workflow:'telegram-morning-punctual-arm.yml',claim:'telegram-morning-claim-',monitorFrom:492,monitorUntil:510},
  close:{workflow:'telegram-close-punctual-arm.yml',claim:'telegram-close-claim-',monitorFrom:1082,monitorUntil:1100}
};

// Extracted from src/gas/apps_script.gs KRX_CONFIRMED_CLOSED_DATES_*.
// The CI test requires exact parity; UNKNOWN years fail closed until reviewed.
var BC_KRX_CLOSED_DATES_ = {
  "2026": [
    "2026-01-01",
    "2026-02-16",
    "2026-02-17",
    "2026-02-18",
    "2026-03-02",
    "2026-05-01",
    "2026-05-05",
    "2026-05-25",
    "2026-06-03",
    "2026-07-17",
    "2026-08-17",
    "2026-09-24",
    "2026-09-25",
    "2026-10-05",
    "2026-10-09",
    "2026-12-25",
    "2026-12-31"
  ],
  "2027": [
    "2027-01-01",
    "2027-02-08",
    "2027-02-09",
    "2027-03-01",
    "2027-05-03",
    "2027-05-05",
    "2027-05-13",
    "2027-07-19",
    "2027-08-16",
    "2027-09-14",
    "2027-09-15",
    "2027-09-16",
    "2027-10-04",
    "2027-10-11",
    "2027-12-27",
    "2027-12-31"
  ]
};
function bcMarketSession_(date) {
  var year=date.slice(0,4);
  if(!Object.prototype.hasOwnProperty.call(BC_KRX_CLOSED_DATES_,year))return 'UNKNOWN';
  return BC_KRX_CLOSED_DATES_[year].indexOf(date)>=0?'CLOSED':'OPEN';
}
function bcClock_(now) {
  var stamp=Utilities.formatDate(now,BC_ZONE_,'yyyy-MM-dd HH:mm');
  if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(stamp))throw Error('BC_CLOCK_INVALID');
  var date=stamp.slice(0,10),minute=Number(stamp.slice(11,13))*60+Number(stamp.slice(14,16));
  // Noon KST is on the same UTC date. Avoid a midnight UTC weekday shift.
  var weekday=new Date(date+'T12:00:00+09:00').getUTCDay();
  return {date:date,minute:minute,weekday:weekday};
}
function bcToken_(props) {
  var token=props.getProperty('BRIEFING_CLOCK_GH_TOKEN');
  if(typeof token!=='string'||token.length<30||/\s/.test(token))
    throw Error('BC_TOKEN_NOT_CONFIGURED');
  return token;
}
function bcRequest_(url,token,method,body) {
  var opt={method:method,muteHttpExceptions:true,followRedirects:false,headers:{
    Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28'
  }};
  if(method==='post'){opt.contentType='application/json';opt.payload=JSON.stringify(body);}
  try{return UrlFetchApp.fetch(url,opt);}catch(e){throw Error('BC_GITHUB_NETWORK_UNVERIFIED');}
}
function bcArtifact_(kind,date,suffix,token) {
  var name=BC_KIND_[kind].claim+date+suffix;
  var response=bcRequest_(BC_API_+'actions/artifacts?name='+encodeURIComponent(name)+'&per_page=100',token,'get');
  if(response.getResponseCode()!==200)throw Error('BC_ARTIFACT_QUERY_FAILED');
  var payload;
  try{payload=JSON.parse(response.getContentText());}catch(e){throw Error('BC_ARTIFACT_RESPONSE_INVALID');}
  if(!payload||!Number.isSafeInteger(payload.total_count)||!Array.isArray(payload.artifacts)||
      payload.total_count>payload.artifacts.length)
    throw Error('BC_ARTIFACT_RESPONSE_INVALID');
  return payload.artifacts.some(function(a){return a.name===name && a.expired===false;});
}
function bcDispatch_(kind,token) {
  var workflow=BC_KIND_[kind].workflow;
  var response=bcRequest_(BC_API_+'actions/workflows/'+workflow+'/dispatches',
    token,'post',{ref:'main'});
  if(response.getResponseCode()!==204 && response.getResponseCode()!==200)
    throw Error('BC_GITHUB_DISPATCH_REJECTED');
}
function bcSlot_(slot,clock,props,token) {
  var key='BC_SLOT_'+slot.id.toUpperCase();
  if(props.getProperty(key)===clock.date)return 'ALREADY_DISPATCHED';
  // Verify both proof and claim. A claim without SENT is ambiguous:
  // never try a second Telegram send after a potentially accepted request.
  if(bcArtifact_(slot.kind,clock.date,'-sent',token)){
    props.setProperty(key,clock.date);return 'ALREADY_SENT';
  }
  if(bcArtifact_(slot.kind,clock.date,'',token)){
    props.setProperty(key,clock.date);return 'CLAIM_WITHOUT_SENT';
  }
  bcDispatch_(slot.kind,token);
  // A GitHub 204 confirms dispatch acceptance, NOT Telegram delivery.
  props.setProperty(key,clock.date);
  return 'DISPATCH_ACCEPTED';
}
function bcVerify_(kind,clock,props,token) {
  var key='BC_MONITOR_'+kind.toUpperCase();
  if(props.getProperty(key)===clock.date)return 'MONITORED';
  if(bcArtifact_(kind,clock.date,'-sent',token)){
    props.setProperty(key,clock.date);return 'SENT_CONFIRMED';
  }
  // Set first to prevent repeated daily alert storms; trigger failure email is
  // controlled by Google Apps Script notification settings.
  props.setProperty(key,clock.date);
  throw Error('BC_'+kind.toUpperCase()+'_SENT_NOT_CONFIRMED');
}
function bcTick_(now) {
  var clock=bcClock_(now);
  if(clock.weekday===0||clock.weekday===6)return 'WEEKEND';
  var slot=BC_SLOTS_.find(function(s){return clock.minute>=s.from&&clock.minute<s.until;});
  var monitor=null;
  if(!slot){
    Object.keys(BC_KIND_).forEach(function(kind){
      if(clock.minute>=BC_KIND_[kind].monitorFrom&&clock.minute<BC_KIND_[kind].monitorUntil)
        monitor=kind;
    });
  }
  if(!slot&&!monitor)return 'OUTSIDE_WINDOW';
  var session=bcMarketSession_(clock.date);
  if(session==='CLOSED')return 'MARKET_CLOSED';
  if(session!=='OPEN')throw Error('BC_MARKET_CALENDAR_UNVERIFIED');
  var props=PropertiesService.getScriptProperties();
  if(props.getProperty('BRIEFING_CLOCK_ENABLED')!=='true')return 'DISABLED';
  var token=bcToken_(props),lock=LockService.getScriptLock();
  if(!lock.tryLock(1000))return 'BUSY';
  try{
    var result=slot?bcSlot_(slot,clock,props,token):bcVerify_(monitor,clock,props,token);
    Logger.log(JSON.stringify({date:clock.date,kind:slot?slot.kind:monitor,
      slot:slot?slot.id:'proof',status:result}));
    return result;
  }finally{lock.releaseLock();}
}
// Install ONCE in a separate Apps Script project under the existing Google account.
// Re-running is idempotent. It only manages this project's named handler.
function briefingClockInstall() {
  var props=PropertiesService.getScriptProperties();
  bcToken_(props);
  if(props.getProperty('BRIEFING_CLOCK_ENABLED')!=='true')throw Error('BC_ENABLE_REQUIRED');
  var triggers=ScriptApp.getProjectTriggers().filter(function(t){
    return t.getHandlerFunction()==='briefingClockTick';
  });
  if(triggers.length>1)throw Error('BC_DUPLICATE_TRIGGERS');
  if(!triggers.length)
    ScriptApp.newTrigger('briefingClockTick').timeBased().everyMinutes(5).create();
  return {triggerCount:1,enabled:true};
}
function briefingClockTick() {return bcTick_(new Date());}
function briefingClockStatus() {
  var p=PropertiesService.getScriptProperties(),result={enabled:p.getProperty('BRIEFING_CLOCK_ENABLED')==='true',
    hasToken:!!p.getProperty('BRIEFING_CLOCK_GH_TOKEN'),
    triggerCount:ScriptApp.getProjectTriggers().filter(function(t){
      return t.getHandlerFunction()==='briefingClockTick';
    }).length,slots:{}};
  BC_SLOTS_.forEach(function(s){result.slots[s.id]=p.getProperty('BC_SLOT_'+s.id.toUpperCase())||null;});
  result.morningProofDate=p.getProperty('BC_MONITOR_MORNING')||null;
  result.closeProofDate=p.getProperty('BC_MONITOR_CLOSE')||null;
  return result;
}
function briefingClockDisable() {
  PropertiesService.getScriptProperties().setProperty('BRIEFING_CLOCK_ENABLED','false');
  ScriptApp.getProjectTriggers().filter(function(t){
    return t.getHandlerFunction()==='briefingClockTick';
  }).forEach(function(t){ScriptApp.deleteTrigger(t);});
  return {enabled:false};
}
