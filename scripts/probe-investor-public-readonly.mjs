// Read-only schema discovery for public Naver market investor statistics.
// No accounts, tokens, raw numbers, Telegram, GAS or financial writes.
const endpoint='https://m.stock.naver.com/api/domestic/market/trend/daily';
function shape(obj,depth=0){
 if(depth>5)return typeof obj;
 if(Array.isArray(obj))return {type:'array',length:obj.length,
   item:obj.length?shape(obj[0],depth+1):null};
 if(obj===null)return 'null';
 if(typeof obj!=='object')return typeof obj;
 return Object.fromEntries(Object.keys(obj).slice(0,38)
   .map(key=>[key,shape(obj[key],depth+1)]));
}
for(const host of ['m.stock.naver.com','stock.naver.com']){
 for(const day of ['20261109']){
 for(const market of (host==='stock.naver.com'?['ALL','KOSPI','KOSDAQ']:['ALL'])){
 const probeEndpoint=endpoint.replace('m.stock.naver.com',host);
 const url=new URL(probeEndpoint);
 for(const [key,value]of Object.entries({
   tradeType:'KRX',marketType:market,bizdate:day,startIdx:'0',pageSize:'20'
 }))url.searchParams.set(key,value);
 const info={kind:'INVESTOR_PUBLIC_SCHEMA_PROBE',bizdate:day,
   action:'READ_ONLY',urlHost:url.hostname,marketType:market};
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
     const rows=Array.isArray(json?.content)?json.content:[];
     info.sourceDates=[...new Set(rows.map(x=>x?.bizdate)
       .filter(x=>typeof x==='string'&&/^\d{8}$/.test(x)))].slice(0,7);
     info.sourceTimes=rows.length
       ?[rows[0]?.time,rows.at(-1)?.time].filter(x=>typeof x==='string').slice(0,2)
       :[];
     const completed=rows.find(x=>x?.bizdate===day);
     const groups=Array.isArray(completed?.netAmounts)?completed.netAmounts:[];
     info.investorCategories=groups.map(x=>x?.investorGubun)
       .filter(x=>typeof x==='string').slice(0,18);
     const n=x=>typeof x==='string'&&/^-?[0-9][0-9,]*(?:\\.[0-9]+)?$/.test(x)
       ?Number(x.replaceAll(',','')):null;
     const net=code=>groups.filter(x=>x.investorGubun===code)
       .reduce((sum,x)=>sum+(n(x.diffValue)||0),0);
     const groupsByType={
       foreign:['9000','9001'],
       institutions:['1000','2000','3000','3100','4000','5000','6000','7000'],
       individual:['8000'],otherCorporations:['7100']
     };
     info.aggregateSanity=Object.fromEntries(Object.entries(groupsByType)
       .map(([kind,codes])=>{
         const value=codes.reduce((sum,code)=>sum+net(code),0);
         return [kind,{sign:Math.sign(value),
           exponent:value===0?null:Math.floor(Math.log10(Math.abs(value)))}];
       }));
     const all=groups.reduce((sum,x)=>sum+(n(x.diffValue)||0),0);
     const gross=groups.reduce((sum,x)=>sum+Math.abs(n(x.diffValue)||0),0);
     info.marketBalanceRatio=gross>0?Math.round(Math.abs(all)/gross*1e6)/1e6:null;
     // Public aggregated KRX-market totals only; rounded to trillion KRW
     // to compare market data vendors, not confidential customer activity.
     info.aggregateReferenceTn=Object.fromEntries(Object.entries(groupsByType)
       .map(([kind,codes])=>[kind,Number(
         (codes.reduce((sum,code)=>sum+net(code),0)/1e12).toFixed(3))]));
     info.priceBalanceCheck={
       candidates:groups.filter(x=>[x.sellPrice,x.buyPrice,x.diffValue].every(
         v=>n(v)!==null)).length,
       matching:groups.filter(x=>{
         const sell=n(x.sellPrice),buy=n(x.buyPrice),diff=n(x.diffValue);
         return sell!==null&&buy!==null&&diff!==null
           &&Math.abs((buy-sell)-diff)<=Math.max(2,Math.abs(diff)*0.000001);
       }).length
     };
   }
 }catch(e){info.error=['TimeoutError','AbortError'].includes(e?.name)
    ?'TIMEOUT':'REQUEST_OR_SCHEMA_UNAVAILABLE';}
 console.log(JSON.stringify(info));
 }
 }
}
