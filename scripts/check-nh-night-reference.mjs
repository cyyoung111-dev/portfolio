import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import YAML from 'yaml';
import {validateNhNight} from './nh-night-reference.mjs';
import {captureMorning,captureWindow} from './nh-morning-capture.mjs';
import {loadCapturedNight} from './nh-capture-artifact.mjs';
const date='2026-10-28',row={value:900.05,contract:'KA016C000',contractMonth:'2026-12',date,clock:'06:00:00'};
const captureAt='2026-10-28T06:45:30+09:00', captured=validateNhNight(row,date,captureAt);
assert.equal(captureWindow(new Date('2026-10-28T06:44:59+09:00')).allowed,false);
assert.equal(captureWindow(new Date(captureAt)).allowed,true);
assert.equal(captureWindow(new Date('2026-10-28T07:34:59+09:00')).allowed,true);
assert.equal(captureWindow(new Date('2026-10-28T07:35:00+09:00')).allowed,false);
assert.equal((await captureMorning({now:()=>new Date(captureAt),fetchNight:async()=>captured})).status,'CAPTURED');
assert.equal((await captureMorning({now:()=>new Date(captureAt),fetchNight:async()=>({...captured,receivedAt:'bad'})})).ready,false);
assert.equal((await captureMorning({now:()=>new Date('2026-10-28T07:35:00+09:00'),fetchNight:async()=>captured})).ready,false);
const artifact={id:10,name:`nh-night-reference-${date}`,expired:false,size_in_bytes:100,workflow_run:{id:20}};
const run={id:20,name:'NH night reference capture',path:'.github/workflows/nh-night-capture.yml',event:'schedule',head_branch:'main',head_repository:{full_name:'cyyoung111-dev/portfolio'},status:'completed',conclusion:'success',run_attempt:1,created_at:'2026-10-27T21:45:00Z'};
const makeFetch=(a=artifact,w=run)=>async url=>url.includes('/runs/')?{ok:true,json:async()=>w}:url.includes('/zip')?{ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}:{ok:true,json:async()=>({total_count:1,artifacts:[a]})};
const options={token:'private',repository:'cyyoung111-dev/portfolio',fetchImpl:makeFetch(),now:()=>new Date('2026-10-28T08:01:00+09:00'),decode:async()=>captured};
assert.equal((await loadCapturedNight(date,options))?.value,900.05);
assert.equal(await loadCapturedNight(date,{...options,fetchImpl:makeFetch(artifact,{...run,event:'pull_request'})}),null);
assert.equal(await loadCapturedNight(date,{...options,fetchImpl:makeFetch(artifact,{...run,conclusion:'failure'})}),null);
assert.equal(await loadCapturedNight(date,{...options,decode:async()=>({...captured,receivedAt:'2026-10-28T07:35:00+09:00'})}),null);
assert.equal(await loadCapturedNight(date,{...options,decode:async()=>({...captured,tradingDate:'2026-10-27'})}),null);
const zipScript="import io,sys,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,'w') as z:z.writestr('reference.json',sys.argv[1])\nsys.stdout.buffer.write(b.getvalue())";
const zipped=spawnSync('python3',['-c',zipScript,JSON.stringify(captured)]);
assert.equal(zipped.status,0);
const realZipFetch=async url=>url.includes('/runs/')?{ok:true,json:async()=>run}:url.includes('/zip')?{ok:true,arrayBuffer:async()=>zipped.stdout}:{ok:true,json:async()=>({total_count:1,artifacts:[artifact]})};
assert.equal((await loadCapturedNight(date,{...options,fetchImpl:realZipFetch,decode:undefined}))?.value,900.05,'real ZIP decoder and artifact path');
const traversalZipScript="import io,sys,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,'w') as z:z.writestr('../reference.json',sys.argv[1])\nsys.stdout.buffer.write(b.getvalue())";
const malicious=spawnSync('python3',['-c',traversalZipScript,JSON.stringify(captured)]).stdout;
const maliciousFetch=async url=>url.includes('/runs/')?{ok:true,json:async()=>run}:url.includes('/zip')?{ok:true,arrayBuffer:async()=>malicious}:{ok:true,json:async()=>({total_count:1,artifacts:[artifact]})};
assert.equal(await loadCapturedNight(date,{...options,fetchImpl:maliciousFetch,decode:undefined}),null,'archive traversal rejected');
// Every cron is UTC Sun–Thu and maps to the planned Mon–Fri KST buffer.
const captureYaml=YAML.parse(fs.readFileSync('.github/workflows/nh-night-capture.yml','utf8'));
assert.deepEqual(captureYaml.on.schedule.map(x=>x.cron),[
 '45 21 * * 0-4','55 21 * * 0-4','5 22 * * 0-4',
 '15 22 * * 0-4','25 22 * * 0-4'
]);
const morningYaml=YAML.parse(fs.readFileSync('.github/workflows/telegram-morning-briefing.yml','utf8'));
assert.equal(morningYaml.on.schedule[0].cron,'40 22 * * 0-4',
 '07:40 KST briefing must stay unchanged');
assert.equal(captureYaml.jobs.capture.timeoutMinutes,undefined);
console.log('NH reference: date, time, contract, tick, duplicate and unavailable checks PASS');
