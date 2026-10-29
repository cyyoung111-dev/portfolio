import {pathToFileURL} from 'node:url';

// Official *public* index-futures master only. Never use auth, accounts, or price endpoints.
const BASE='https://www.nhplug.com/instruments/m_future';
const SIZE=30, MAX=1_000_000;
const decoder=new TextDecoder('euc-kr',{fatal:true});
const CODE=/^K[A-Z0-9]{8}$/;
const K200=/(?:코스피\s*200|KOSPI\s*200|^선물\d{2}(?:03|06|09|12)월kp$)/i;

function decodeRecords(bytes) {
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX||bytes.length%SIZE!==0)
    throw Error('MASTER_SIZE_INVALID');
  const rows=[];
  for(let i=0;i<bytes.length;i+=SIZE) {
    const chunk=bytes.subarray(i,i+SIZE);
    if(chunk[SIZE-1]!==10)throw Error('MASTER_RECORD_INVALID');
    const code=Buffer.from(chunk.subarray(0,9)).toString('ascii').trim();
    if(!CODE.test(code))throw Error('MASTER_CODE_INVALID');
    const name=decoder.decode(chunk.subarray(9,29)).trim();
    if(!name||/[\x00-\x1f\uFFFD]/.test(name))throw Error('MASTER_NAME_INVALID');
    rows.push({code,name});
  }
  return rows;
}
export function parsePublicFutureMaster(bytes) {
  const rows=decodeRecords(bytes);
  if(rows[0].code!=='K10111111')throw Error('MASTER_HEADER_SENTINEL_CHANGED');
  const matches=rows.slice(1).filter(x=>K200.test(x.name)).map(x=>{
    const m=/^선물(\d{2})(03|06|09|12)월kp$/i.exec(x.name);
    return {...x,contractMonth:m?'20'+m[1]+'-'+m[2]:null};
  });
  // Some official master releases abbreviate the product name; keep public samples
  // for diagnosis, but never auto-select a front month from unverified names.
  if(!matches.length)return {totalRecords:rows.length,candidates:[],unclassified:rows.slice(1,25)};
  const codes=new Set();
  for(const row of matches) {
    if(codes.has(row.code))throw Error('MASTER_DUPLICATE_CODE');
    codes.add(row.code);
  }
  // Master contains candidate contracts, not necessarily the front month.
  return {totalRecords:rows.length,candidates:matches};
}
export async function inspectPublicFutureMaster({request=fetch,log=console.log}={}) {
  let stage='HEADER';
  try {
    const header=await request(BASE+'.h',{redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!header.ok){log('FUTURE_MASTER_HEADER HTTP_'+header.status);return false;}
    const headerText=await header.text();
    if(headerText.length>100_000||!/@record\s+30\b/.test(headerText)||
       !/char\s+sCode\[9\]/.test(headerText)||!/char\s+sName\[20\]/.test(headerText)||
       !/char\s+dummy\[1\]/.test(headerText)) {
      log('FUTURE_MASTER_STRUCTURE_UNVERIFIED');return false;
    }
    stage='DATA';
    const r=await request(BASE+'.mst',{redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!r.ok){log('FUTURE_MASTER_DATA HTTP_'+r.status);return false;}
    const declared=Number(r.headers?.get('content-length')||0);
    if(declared>MAX){log('FUTURE_MASTER_TOO_LARGE');return false;}
    const raw=Buffer.from(await r.arrayBuffer());
    stage='PARSE';
    const result=parsePublicFutureMaster(raw);
    log('FUTURE_MASTER_RECORDS '+result.totalRecords);
    log('KOSPI200_CONTRACT_CANDIDATES '+result.candidates.length);
    if(!result.candidates.length){
      for(const row of result.unclassified||[])log('UNCLASSIFIED_PUBLIC_FUTURE '+JSON.stringify(row));
      log('KOSPI200_CONTRACT_NAME_MATCH_MISSING');return false;
    }
    for(const row of result.candidates.slice(0,30)) log(JSON.stringify(row));
    log('KOSPI200_FRONT_MONTH UNVERIFIED');
    return true;
  } catch (error) {
    const allowed=new Set(['MASTER_SIZE_INVALID','MASTER_RECORD_INVALID','MASTER_CODE_INVALID','MASTER_NAME_INVALID','MASTER_HEADER_SENTINEL_CHANGED','K200_CONTRACT_NOT_IDENTIFIED','MASTER_DUPLICATE_CODE']);
    const reason=allowed.has(error?.message)?error.message:'UNAVAILABLE_OR_INVALID';
    log('FUTURE_MASTER '+stage+' '+reason);
    return false;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(!await inspectPublicFutureMaster())process.exitCode=1;
}
