import {pathToFileURL} from 'node:url';
import {createNhMarketDataProvider} from './nhplug-market-data-provider.mjs';
import {parseUSMaster} from './nhplug-readonly-diagnostic.mjs';

// Run only on trusted main with the existing market-data environment. This
// preflight never writes prices, GAS properties, Sheets, or Telegram messages.
export async function runProviderPreflight({key,secret,request=fetch,log=console.log,wait,now}={}) {
  const provider=createNhMarketDataProvider({key,secret,request,wait,now});
  const sample=[
    {code:'005930',market:'KR',currency:'KRW',type:'STOCK'},
    {code:'069500',market:'KR',currency:'KRW',type:'ETF'},
    {code:'AAPL',market:'US',currency:'USD',type:'STOCK'},
    {code:'QQQ',market:'US',currency:'USD',type:'ETF'},
  ];
  let master;
  try {
    const header=await request('https://www.nhplug.com/instruments/m_gtsstock.h',{redirect:'error',signal:AbortSignal.timeout(15000)});
    const data=await request('https://www.nhplug.com/instruments/m_gtsstock.mst',{redirect:'error',signal:AbortSignal.timeout(75000)});
    if(!header.ok||!data.ok)throw Error('MASTER_HTTP');
    const size=Number(data.headers?.get?.('content-length')||0);
    if(size>20*1024*1024)throw Error('MASTER_SIZE');
    master=parseUSMaster(new Uint8Array(await data.arrayBuffer()),await header.text(),['AAPL','QQQ']);
    if(!master||!master.has('AAPL')||!master.has('QQQ'))throw Error('MASTER_INVALID');
  } catch {log('NH_PROVIDER_MASTER_UNVERIFIED');return false;}
  for(const item of sample){
    try {
      const row=await provider.quote(item,{expectedId:master.get(item.code)});
      // Fixed public symbol allowlist only. No raw responses, tokens or keys.
      log(JSON.stringify({sample:item.code,status:'PRICE_PRESENT',source:row.source,
        price:row.price,marketDate:row.marketDate,fetchedAt:row.fetchedAt,
        exchangeTimeVerified:row.exchangeTimeVerified,finality:row.status}));
    } catch(error) {
      log(/^NH_[A-Z0-9_]+$/.test(error?.message||'')?error.message:'NH_PROVIDER_PREFLIGHT_FAILED');
      return false;
    }
  }
  log('NH_PROVIDER_PREFLIGHT_PASS WEB_GAS_NOT_CONNECTED CLOSE_FINALITY_UNVERIFIED');
  return true;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.env.GITHUB_REF!=='refs/heads/main')throw Error('NH_TRUSTED_MAIN_REQUIRED');
  if(!await runProviderPreflight({key:process.env.NHPLUG_APP_KEY,secret:process.env.NHPLUG_APP_SECRET}))process.exitCode=1;
}
