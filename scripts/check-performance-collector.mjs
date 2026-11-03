import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from '../ops/lookup-performance-collector/worker.mjs';

// Synthetic isolated D1: no Cloudflare/financial network access.
const rows=[];
const db={
  prepare(sql){return {bind(...args){
    return {
      async first(){assert.match(sql,/COUNT\(\*\)/);return {n:rows.length};},
      async all(){assert.match(sql,/SELECT device/);return {results:rows.slice().reverse().map(x=>({device:x[1],stage:x[2],ms:x[3],result:x[4]}))};},
      async run(){
        if(sql.startsWith('INSERT'))rows.push(args);
        else if(sql.startsWith('DELETE'))rows.splice(0,rows.length,...rows.filter(r=>r[5]>=args[0]));
        return {success:true};
      }
    };
  }};},
  async batch(items){for(const item of items)await item.run();return [];}
};
const env={DB:db,INGEST_ENABLED:'false',ALLOWED_ORIGIN:'https://portfolio.example.test',REPORT_TOKEN:'TEST_ONLY_SECRET_LONG_TOKEN_1234'};
const payload={version:1,device:'mobile',samples:[
  {stage:'price.poll-total',ms:2000,result:'ok'},
  {stage:'price.poll-total',ms:3000,result:'ok'},
  {stage:'price.poll-total',ms:4000,result:'error'}
]};
const request=(body,origin='https://portfolio.example.test')=>new Request('https://telemetry.example.test/ingest',{
  method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)
});
assert.equal((await worker.fetch(request(payload),env)).status,503,'disabled collector must write nothing');
assert.equal(rows.length,0);
env.INGEST_ENABLED='true';
assert.equal((await worker.fetch(request(payload,'https://attacker.example.test'),env)).status,403);
assert.equal((await worker.fetch(request({...payload,extra:'ignored',samples:[{...payload.samples[0],code:'SECRET'}]}),env)).status,400);
assert.equal((await worker.fetch(request(payload),env)).status,202);
assert.equal(rows.length,3);
const authReq=token=>new Request('https://telemetry.example.test/report',{headers:{Authorization:'Bearer '+token}});
assert.equal((await worker.fetch(authReq('wrong'),env)).status,401);
const report=await (await worker.fetch(authReq(env.REPORT_TOKEN),env)).json();
assert.equal(report.windowDays,7);
assert.equal(report.sampleCount,3);
assert.equal(report.groups.length,1);
assert.equal(report.groups[0].medianMs,3000);
assert.equal(report.groups[0].p95Ms,4000);
assert.equal(report.groups[0].failureRatePct,33.3);
await worker.scheduled({},env);
assert.equal(rows.length,3);

const source=fs.readFileSync('src/web/features/settings/settings_perf_monitor.js','utf8');
const net=fs.readFileSync('src/web/features/settings/settings_net.js','utf8');
const view=fs.readFileSync('src/web/views/views_history.js','utf8');
const html=fs.readFileSync('src/web/index.html','utf8');
const sw=fs.readFileSync('src/web/sw.js','utf8');
assert.match(net,/window\.PortfolioPerfTelemetry\?\.record\(entry\)/);
assert.match(view,/window\.PortfolioPerfTelemetry\?\.renderSettingsHtml\?\.\(\)/);
assert.match(html,/settings_perf_monitor\.js\?v=20261103-1/);
assert.match(sw,/settings_perf_monitor\.js\?v=20261103-1/);
const expected=new Map();
const storage={
  getItem:k=>expected.get(k)||null,
  setItem:(k,v)=>{expected.set(k,String(v));},
  removeItem:k=>{expected.delete(k);}
};
const sent=[];
const window={
  localStorage:storage,matchMedia:()=>({matches:true}),addEventListener:()=>{},
  fetch:async(url,opts)=>{sent.push({url,opts});return {ok:true};},
  setTimeout:()=>1,clearTimeout:()=>{}
};
const listeners={};
const document={
  addEventListener:(event,handler)=>{listeners[event]=handler;},
  getElementById:()=>null
};
const ctx=vm.createContext({window,document,localStorage:storage,URL,setTimeout:()=>1,clearTimeout:()=>{},fetch:window.fetch,Set,Object,JSON,Number,String,Array});
vm.runInContext(source,ctx);
window.PortfolioPerfTelemetry.record({stage:'price.poll-total',ms:999,result:'ok'});
assert.equal(expected.has('pf_perf_remote_queue_v1'),false,'no user opt-in = no storage/upload');
expected.set('pf_perf_remote_endpoint_v1','https://telemetry.example.test/ingest');
expected.set('pf_perf_remote_consent_v1','1');
window.PortfolioPerfTelemetry.record({stage:'price.poll-total',ms:999,result:'ok'});
window.PortfolioPerfTelemetry.record({stage:'symbol.005930',ms:25,result:'ok'});
assert.equal(await window.PortfolioPerfTelemetry.flush(),true);
assert.equal(sent.length,1);
const body=JSON.parse(sent[0].opts.body);
assert.equal(body.device,'mobile');
assert.equal(body.samples.length,1,'unknown/financial-symbol stage must be filtered');
assert.deepEqual(Object.keys(body.samples[0]).sort(),['ms','result','stage']);
assert.equal(sent[0].opts.credentials,'omit');
assert.equal(expected.get('pf_perf_remote_queue_v1'),'[]');
assert.doesNotMatch(source,/getGsheetAccessToken|GSHEET_API_URL|savedPrices|rawTrades/);
console.log('PASS isolated collector + no-consent fail-closed + p50/p95/error + bounded sanitized client upload');
