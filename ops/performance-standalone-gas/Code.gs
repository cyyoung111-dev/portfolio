// Dedicated Apps Script performance reporter. No access to financial sources, Google Sheets, or other services.
// Published source is installed in a NEW standalone script project, not existing GAS.
var PERF_ACCESS_KEY = '__PERF_BEARER_SHA256__';
var PERF_ALLOWED = [
 'load.initial-restore','load.initial-prices','load.full-update',
 'price.poll-network','price.poll-render','price.poll-total',
 'network.getBootstrap','network.getSettings','network.getPrices','network.getPriceHistory'
];
function perfReply(extra) {
 return ContentService.createTextOutput(JSON.stringify(extra))
  .setMimeType(ContentService.MimeType.JSON);
}
function perfAuthorized(p) {
 var sent=String((p||{}).accessToken||'');
 if(!/^[a-f0-9]{64}$/.test(PERF_ACCESS_KEY) || sent.length!==64) return false;
 var difference=0;
 for(var i=0;i<64;i++) difference|=sent.charCodeAt(i)^PERF_ACCESS_KEY.charCodeAt(i);
 return difference===0;
}
function perfToday() {
 return Utilities.formatDate(new Date(),'Asia/Seoul','yyyyMMdd');
}
function perfDayKeys() {
 var days=[];
 for(var d=0;d<7;d++){
   days.push(Utilities.formatDate(new Date(Date.now()-d*86400000),'Asia/Seoul','yyyyMMdd'));
 }
 return days;
}
function perfAppend(p) {
 var raw=String(p.data||'');
 if(raw.length>1500)return perfReply({status:'error',message:'SIZE_LIMIT'});
 var body;try{body=JSON.parse(raw);}catch(e){return perfReply({status:'error',message:'PAYLOAD_INVALID'})}
 if(!body||body.version!==1||['mobile','desktop','unknown'].indexOf(body.device)<0||
    !Array.isArray(body.samples)||body.samples.length<1||body.samples.length>8||
    !body.samples.every(function(s){return s&&Object.keys(s).length===3&&
      PERF_ALLOWED.indexOf(s.stage)>=0&&typeof s.ms==='number'&&isFinite(s.ms)&&
      Math.floor(s.ms)===s.ms&&s.ms>=0&&s.ms<=120000&&
      (s.result==='ok'||s.result==='error');}))
   return perfReply({status:'error',message:'PAYLOAD_INVALID'});
 var lock=LockService.getScriptLock();
 if(!lock.tryLock(250))return perfReply({status:'error',message:'LOW_PRIORITY_BUSY'});
 try{
   var props=PropertiesService.getScriptProperties();
   var key='pfv1_'+perfToday()+'_'+body.device;
   var saved=props.getProperty(key);
   var list=saved?JSON.parse(saved):[];
   if(!Array.isArray(list)||list.length>120)return perfReply({status:'error',message:'STORE_INVALID'});
   var free=Math.max(0,100-list.length);
   if(free<body.samples.length)return perfReply({status:'error',message:'DAILY_CAP'});
   var more=body.samples.map(function(s){return [s.stage,s.ms,s.result]});
   list=list.concat(more);
   var next=JSON.stringify(list);
   if(next.length>7600)return perfReply({status:'error',message:'STORAGE_CAP'});
   props.setProperty(key,next);
   // Keep seven KST dates. Only this dedicated script's properties are touched.
   var keep=perfDayKeys(),all=props.getProperties();
   Object.keys(all).filter(function(k){return /^pfv1_\d{8}_(mobile|desktop|unknown)$/.test(k)})
     .forEach(function(k){if(keep.indexOf(k.slice(5,13))<0)props.deleteProperty(k)});
   return perfReply({status:'ok',accepted:more.length});
 }catch(e){return perfReply({status:'error',message:'STORAGE_UNAVAILABLE'})}
 finally{lock.releaseLock()}
}
function perfSummary() {
 try{
   var props=PropertiesService.getScriptProperties().getProperties();
   var keep=perfDayKeys();
   var grouped={},total=0;
   Object.keys(props).filter(function(k){
     return /^pfv1_\d{8}_(mobile|desktop|unknown)$/.test(k)&&keep.indexOf(k.slice(5,13))>=0;
   }).forEach(function(key){
     var dev=key.slice(14);
     var entries=JSON.parse(props[key]);
     if(!Array.isArray(entries)||entries.length>100)return;
     entries.forEach(function(e){
       if(!Array.isArray(e)||e.length!==3||PERF_ALLOWED.indexOf(e[0])<0||
          !Number.isFinite(e[1])||e[1]<0||e[1]>120000||
          ['ok','error'].indexOf(e[2])<0)return;
       var id=dev+'|'+e[0];
       if(!grouped[id])grouped[id]={device:dev,stage:e[0],values:[],failed:0};
       grouped[id].values.push(e[1]);if(e[2]==='error')grouped[id].failed++;
       total++;
     });
   });
   var groups=Object.keys(grouped).sort().map(function(id){
     var g=grouped[id],v=g.values.sort(function(a,b){return a-b}),n=v.length;
     return {device:g.device,stage:g.stage,count:n,failed:g.failed,
       medianMs:v[Math.floor((n-1)/2)],p95Ms:v[Math.ceil(n*.95)-1],
       failureRatePct:Math.round(g.failed/n*1000)/10};
   });
   return perfReply({status:'ok',enabled:true,windowDays:7,sampleCount:total,groups:groups});
 }catch(e){return perfReply({status:'error',message:'SUMMARY_UNAVAILABLE'})}
}
function doPost(e) {
 var p=(e&&e.parameter)||{};
 if(!perfAuthorized(p))return perfReply({status:'error',message:'AUTH_REQUIRED'});
 if(p.action==='appendPerformanceMetrics')return perfAppend(p);
 if(p.action==='getPerformanceSummary')return perfSummary();
 return perfReply({status:'error',message:'UNKNOWN_ACTION'});
}
function doGet(e) {
 return perfReply({status:'error',message:'POST_ONLY'});
}
