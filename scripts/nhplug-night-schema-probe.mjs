import {pathToFileURL} from 'node:url';

// Public documentation only: never send API keys, tokens, or requests to a trading endpoint.
const SPEC_URL='https://www.nhplug.com/openapi-docs/krfuture/openapi.json';
const MAX_BYTES=3_000_000;
export function inspectNightSchema(spec) {
  const paths=spec?.paths;
  if(!paths||typeof paths!=='object'||Array.isArray(paths))throw Error('SPEC_INVALID');
  const rows=[];
  for(const [path,definition] of Object.entries(paths)) {
    if(!/^\/krfuture\/quote\/v1\/[A-Za-z0-9]+$/.test(path))continue;
    const op=definition?.post;
    if(!op||!/(야간|night)/i.test(String(op.summary||'')+' '+path))continue;
    const request=op.requestBody?.content?.['application/json']?.schema?.properties?.Input_0;
    const response=op.responses?.['200']?.content?.['application/json']?.schema?.properties;
    if(!request?.properties||!response)continue;
    const output={}, evidence={};
    for(const name of ['Output_0','Output_1','Output_2']){
      const block=response[name];const fields=block?.type==='array'?block.items?.properties:block?.properties;
      if(fields&&typeof fields==='object') {
        output[name]=Object.keys(fields).filter(x=>/^[a-z0-9_]+$/.test(x)).sort();
        const selected=['iem_cd','last_tr_date','lstn_date','prpr','bsop_date','bsop_time','work_bsop_date','qry_date','qry_time','end_time_n'];
        const desc=Object.fromEntries(selected.filter(x=>typeof fields[x]?.description==='string').map(x=>[x,fields[x].description.slice(0,250)]));
        if(Object.keys(desc).length)evidence[name]=desc;
      }
    }
    // Capture documented *input meanings*, not just names. Do not infer enum values.
    const names=Object.keys(request.properties).filter(x=>/^[a-z0-9_]+$/.test(x)).sort();
    const inputEvidence={};
    for(const name of names){
      const field=request.properties[name];
      if(!field||typeof field!=='object')continue;
      const entry={};
      if(typeof field.description==='string')entry.description=field.description.slice(0,300);
      if(['string','integer','number','boolean'].includes(field.type))entry.type=field.type;
      if(Array.isArray(field.enum))entry.enum=field.enum.filter(v=>typeof v==='string'&&v.length<=32||Number.isSafeInteger(v)).slice(0,20);
      if(typeof field.default==='string'&&field.default.length<=32||Number.isSafeInteger(field.default))entry.default=field.default;
      if(Object.keys(entry).length)inputEvidence[name]=entry;
    }
    rows.push({path,input:names,required:(request.required||[]).filter(x=>/^[a-z0-9_]+$/.test(x)).sort(),inputEvidence,output,evidence});
  }
  return rows.sort((a,b)=>a.path.localeCompare(b.path));
}
export async function main({request=fetch,log=console.log}={}) {
  try {
    const res=await request(SPEC_URL,{redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!res.ok){log('PUBLIC_NIGHT_SPEC HTTP_'+res.status);return false;}
    const size=Number(res.headers.get('content-length')||0);if(size>MAX_BYTES){log('PUBLIC_NIGHT_SPEC TOO_LARGE');return false;}
    const text=await res.text();if(Buffer.byteLength(text)>MAX_BYTES){log('PUBLIC_NIGHT_SPEC TOO_LARGE');return false;}
    const rows=inspectNightSchema(JSON.parse(text));
    if(!rows.length){log('PUBLIC_NIGHT_SPEC NO_QUOTE_SCHEMA');return false;}
    for(const row of rows)log(JSON.stringify(row));
    log('PUBLIC_NIGHT_SPEC FOUND_'+rows.length);return true;
  } catch {log('PUBLIC_NIGHT_SPEC UNAVAILABLE_OR_INVALID');return false;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(!await main())process.exitCode=1;}
