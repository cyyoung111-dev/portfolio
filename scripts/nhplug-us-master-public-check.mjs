import {parseUSMaster} from './nhplug-readonly-diagnostic.mjs';
const base='https://www.nhplug.com/instruments/';
async function read(path,kind){
  try{
    const started=Date.now();
    const r=await fetch(base+path,{redirect:'error',signal:AbortSignal.timeout(15000)});
    console.log(kind+'_HTTP_'+r.status+' ELAPSED_MS_'+(Date.now()-started));
    if(!r.ok)return null;
    const size=Number(r.headers.get('content-length')||0);
    if(size>20971520){console.log(kind+'_TOO_LARGE');return null;}
    if(kind==='HEADER'){const s=await r.text();console.log('HEADER_CHARS_'+s.length+' RECORD_164_'+(/@record\s+164\b/.test(s)?'YES':'NO'));return s.length<=100000?s:null;}
    const bytes=new Uint8Array(await r.arrayBuffer());console.log('DATA_BYTES_'+bytes.length+' MULTIPLE_164_'+(bytes.length%164===0?'YES':'NO'));return bytes.length<=20971520?bytes:null;
  }catch(e){
    let name=String(e?.name||'');
    console.log(kind+'_FAIL_'+(name==='TimeoutError'?'TIMEOUT':name==='AbortError'?'ABORT':'NETWORK_OR_REDIRECT'));
    return null;
  }
}
const [h,b]=await Promise.all([read('m_gtsstock.h','HEADER'),read('m_gtsstock.mst','DATA')]);
if(h&&b){
  const m=parseUSMaster(b,h,['AAPL','QQQ']);
  console.log('MASTER_PARSE_'+(m?'SCHEMA_VALID':'SCHEMA_INVALID'));
  if(m)for(const sym of ['AAPL','QQQ'])console.log(sym+'_MASTER_'+(m.has(sym)?'UNIQUE':'MISSING_OR_AMBIGUOUS'));
}else console.log('MASTER_PARSE_NOT_ATTEMPTED');
