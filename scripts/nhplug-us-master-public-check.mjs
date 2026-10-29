import {parseUSMaster} from './nhplug-readonly-diagnostic.mjs';
const base='https://www.nhplug.com/instruments/';
async function read(path,kind){
  try{
    const started=Date.now();
    const r=await fetch(base+path,{redirect:'error',signal:AbortSignal.timeout(75000)});
    console.log(kind+'_HTTP_'+r.status+' ELAPSED_MS_'+(Date.now()-started));
    if(!r.ok)return null;
    const size=Number(r.headers.get('content-length')||0);
    console.log(kind+'_DECLARED_BYTES_'+size);
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
  for(const line of h.split(/\r?\n/).filter(x=>/sGIC|sNationCode|sSymbol|@record/.test(x)).slice(0,8))console.log('PUBLIC_HEADER_LINE '+line.slice(0,220));
  console.log('HEADER_GIC_0_'+(/char\s+sGIC\[15\][^\n]*@0\b/.test(h)?'YES':'NO'));
  console.log('HEADER_NATION_95_'+(/char\s+sNationCode\[3\][^\n]*@95\b/.test(h)?'YES':'NO'));
  console.log('HEADER_SYMBOL_98_'+(/char\s+sSymbol\[12\][^\n]*@98\b/.test(h)?'YES':'NO'));
  let bad=0;for(let i=163;i<b.length;i+=164)if(b[i]!==10)bad++;
  console.log('RECORD_LF_BOUNDARY_BAD_'+bad);
  const tuples=[...h.matchAll(/^\s*\(["']([A-Za-z0-9_]+)["']\s*,\s*(\d+)\s*\)\s*,?\s*$/gm)];
  let offset=0;const offsets={};for(const m of tuples){if(offsets[m[1]]!==undefined){console.log('HEADER_DUPLICATE_'+m[1]);break;}offsets[m[1]]=offset;offset+=Number(m[2]);}
  console.log('PYTHON_FIELDS_COUNT_'+tuples.length+' TOTAL_'+offset);
  for(const name of ['sGIC','sNationCode','sSymbol'])console.log('PYTHON_OFFSET_'+name+'_'+(offsets[name]??'MISSING'));
  if(offset===164&&offsets.sGIC===0&&offsets.sNationCode===95&&offsets.sSymbol===98&&bad===0){
    for(const symbol of ['AAPL','QQQ']){
      let found=new Set();
      for(let i=0;i<b.length;i+=164){let country=Buffer.from(b.subarray(i+95,i+98)).toString('ascii').trim();let ticker=Buffer.from(b.subarray(i+98,i+110)).toString('ascii').trim();let code=Buffer.from(b.subarray(i,i+15)).toString('ascii').trim();if(country==='USA'&&ticker===symbol&&/^[A-Z0-9._-]{1,15}$/.test(code))found.add(code);}
      console.log(symbol+'_PYTHON_MASTER_MATCHES_'+found.size);
    }
  }
  const m=parseUSMaster(b,h,['AAPL','QQQ']);
  console.log('MASTER_PARSE_'+(m?'SCHEMA_VALID':'SCHEMA_INVALID'));
  if(m)for(const sym of ['AAPL','QQQ'])console.log(sym+'_MASTER_'+(m.has(sym)?'UNIQUE':'MISSING_OR_AMBIGUOUS'));
}else console.log('MASTER_PARSE_NOT_ATTEMPTED');
