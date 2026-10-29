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
    const output={};
    for(const name of ['Output_0','Output_1','Output_2']){
      const block=response[name];const fields=block?.type==='array'?block.items?.properties:block?.properties;
      if(fields&&typeof fields==='object')output[name]=Object.keys(fields).filter(x=>/^[a-z0-9_]+$/.test(x)).sort();
    }
    rows.push({path,input:Object.keys(request.properties).filter(x=>/^[a-z0-9_]+$/.test(x)).sort(),required:(request.required||[]).filter(x=>/^[a-z0-9_]+$/.test(x)).sort(),output});
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
