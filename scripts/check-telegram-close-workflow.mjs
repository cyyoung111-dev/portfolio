import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {closeWindow,verifiedNhCloseRows,formatClose,prepareClose,deliverClose}
 from './telegram-close-workflow.mjs';
const day='2026-10-30',now=()=>new Date(day+'T16:30:00+09:00');
assert.equal(closeWindow(new Date(day+'T16:29:59+09:00')).allowed,false);
assert.equal(closeWindow(now()).allowed,true);
assert.equal(closeWindow(new Date(day+'T17:10:00+09:00')).allowed,false);
const rows=[
 {label:'S&P 500',symbol:'^GSPC',date:'2026-10-29',value:7720.39,changePercent:0.5,source:'NH_INDEX_DAILY'},
 {label:'NASDAQ',symbol:'^IXIC',date:'2026-10-29',value:26184.72,changePercent:1.2,source:'NH_INDEX_DAILY'},
 {label:'NASDAQ100',symbol:'^NDX',date:'2026-10-29',value:29402.51,changePercent:1.1,source:'NH_INDEX_DAILY'}
];
assert.equal(verifiedNhCloseRows(day,rows).length,3);
assert.equal(verifiedNhCloseRows(day,[{...rows[0],source:'YAHOO_FINANCE'}]).length,0);
assert.equal(verifiedNhCloseRows(day,[{...rows[0],date:'2026-10-28'}]).length,0);
assert.equal(verifiedNhCloseRows(day,[rows[0],rows[0]]).length,0);
assert.equal(verifiedNhCloseRows(day,[{...rows[0],value:0}]).length,0);
assert.equal(verifiedNhCloseRows(day,[{...rows[0],label:'S&P 100'}]).length,0);
const msg=formatClose(day,rows);
assert.match(msg,/NH PLUG 완료 정규장 일봉/);
assert.match(msg,/S&P 500: 7,720.39.*2026-10-29.*NH/);
assert.match(msg,/NASDAQ: 26,184.72.*NH/);
assert.match(msg,/NASDAQ100: 29,402.51.*NH/);
assert.match(msg,/KOSPI: NH 지수 종가 코드 미검증/);
assert.match(msg,/SOX: NH 지수 코드 미검증/);
assert.match(msg,/NH 지수 확인 3\/3/);
assert.doesNotMatch(msg,/Yahoo Finance 일봉 기준/);
let fetched=0,sent=0;
const options={now,githubToken:'dummy',repository:'cyyoung111-dev/portfolio',
 fetchImpl:async(target)=>{
  assert.ok(target.includes('api.github.com'),'never call Yahoo or KRX');
  return {ok:true,json:async()=>({total_count:0,artifacts:[]})};
 },
 gasUrl:'https://script.google.com/macros/s/EXAMPLE123/exec',gasToken:'TEST-GAS-TOKEN',
 fetchNh:async(date,opts)=>{
  fetched++;assert.equal(date,day);assert.equal(opts.token,'TEST-GAS-TOKEN');
  assert.equal(opts.url,'https://script.google.com/macros/s/EXAMPLE123/exec');return rows;
 }};
const prepared=await prepareClose(options);
assert.equal(prepared.ready,true);assert.equal(fetched,1);assert.equal(prepared.nhConfirmed,3);
assert.match(prepared.message,/NH PLUG/);
assert.equal((await deliverClose(prepared,{now,send:async()=>{sent++;}})).status,'SENT');
assert.equal(sent,1);
await assert.rejects(deliverClose(prepared,{now,attempt:2,send:async()=>{sent++;}}),/PAYLOAD_INVALID/);
await assert.rejects(deliverClose({...prepared,date:'2026-10-29'},{now,send:async()=>{sent++;}}),/PAYLOAD_INVALID/);
await assert.rejects(deliverClose({...prepared,nhConfirmed:0},{now,send:async()=>{sent++;}}),/PAYLOAD_INVALID/);
await assert.rejects(deliverClose(prepared,{now:()=>new Date(day+'T17:10:00+09:00'),
 send:async()=>{sent++;}}),/PAYLOAD_INVALID/);
assert.equal(sent,1);
const empty=await prepareClose({...options,fetchNh:async()=>[{...rows[0],source:'KRX_OFFICIAL'}]});
assert.equal(empty.ready,false);assert.equal(empty.status,'NH_INDEX_CLOSE_NOT_READY');
const claimed=await prepareClose({...options,fetchImpl:async()=>({ok:true,
 json:async()=>({total_count:1,artifacts:[{name:'telegram-close-claim-'+day}]})})});
assert.equal(claimed.ready,false);
await assert.rejects(prepareClose({...options,fetchImpl:async()=>{throw Error('private');}}),/CLAIM_FAILED/);
await assert.rejects(prepareClose({...options,attempt:2}),/CONFIG/);
assert.equal((await prepareClose({...options,now:()=>new Date('2026-10-31T16:30:00+09:00')})).status,'MARKET_CLOSED');
const workflow=YAML.parse(fs.readFileSync('.github/workflows/telegram-close-briefing.yml','utf8'));
assert.equal(workflow.jobs.briefing.environment,'portfolio-production-gas');
const step=workflow.jobs.briefing.steps.find(s=>s.id==='prepare');
assert.match(step.env.GAS_ACCESS_TOKEN,/secrets[.]GAS_ACCESS_TOKEN/);
assert.match(step.env.GAS_WEB_APP_URL,/vars[.]GAS_WEB_APP_URL/);
const send=workflow.jobs.briefing.steps.find(s=>s.name==='Send claimed closing briefing once');
assert.equal(send.env.GAS_ACCESS_TOKEN,undefined);
assert.match(JSON.stringify(workflow.on.schedule),/30 7/);
assert.match(JSON.stringify(workflow.on.schedule),/50 7/);
assert.doesNotMatch(fs.readFileSync('scripts/telegram-close-workflow.mjs','utf8'),/query1[.]finance[.]yahoo[.]com/);
console.log('NH-only closing Telegram: strict dated source, no KRX/Yahoo fallback, protected GAS and duplicate guard PASS');
