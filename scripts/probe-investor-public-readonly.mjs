// Read-only schema discovery for public Naver market investor statistics.
// No accounts, tokens, raw numbers, Telegram, GAS or financial writes.
const endpoint='https://m.stock.naver.com/api/domestic/market/trend/daily';
function shape(obj,depth=0){
 if(depth>2)return typeof obj;
 if(Array.isArray(obj))return {type:'array',length:obj.length,
   item:obj.length?shape(obj[0],depth+1):null};
 if(obj===null)return 'null';
 if(typeof obj!=='object')return typeof obj;
 return Object.fromEntries(Object.keys(obj).slice(0,38)
   .map(key=>[key,shape(obj[key],depth+1)]));
}
for(const host of ['m.stock.naver.com','stock.naver.com']){
 for(const day of ['20261109']){
 const probeEndpoint=endpoint.replace('m.stock.naver.com',host);
 const url=new URL(probeEndpoint);
 for(const [key,value]of Object.entries({
   tradeType:'KRX',marketType:'ALL',bizdate:day,startIdx:'0',pageSize:'20'
 }))url.searchParams.set(key,value);
 const info={kind:'INVESTOR_PUBLIC_SCHEMA_PROBE',bizdate:day,
   action:'READ_ONLY',urlHost:url.hostname};
 try{
   const reply=await fetch(url,{
     redirect:'error',headers:{accept:'application/json',
       referer:'https://m.stock.naver.com/'},signal:AbortSignal.timeout(8000)
   });
   info.httpStatus=reply.status;
   const type=reply.headers.get('content-type')||'';
   info.contentType=type.slice(0,40);
   if(reply.ok&&type.toLowerCase().includes('json')){
     const size=Number(reply.headers.get('content-length'));
     if(Number.isFinite(size)&&size>600000)throw Error('RESPONSE_TOO_LARGE');
     const json=await reply.json();
     info.schema=shape(json);
   }
 }catch(e){info.error=['TimeoutError','AbortError'].includes(e?.name)
    ?'TIMEOUT':'REQUEST_OR_SCHEMA_UNAVAILABLE';}
 console.log(JSON.stringify(info));
 }
}
