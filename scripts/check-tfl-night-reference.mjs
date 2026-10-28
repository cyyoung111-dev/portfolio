import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {validateTflNight,fetchTflNight} from './tfl-night-reference.mjs';

const date='2026-10-28', at='2026-10-28T08:40:00+09:00';
const row={value:900.05,contract:'A01612',date,clock:'06:00:00'};
assert.equal(validateTflNight(row,date,at)?.officialClose,false);
for (const bad of [{...row,date:'2026-10-27'}, {...row,clock:'05:00:00'}, {...row,value:900.03}, {...row,contract:''}])
  assert.equal(validateTflNight(bad,date,at),null);
assert.equal(validateTflNight(row,date,'2026-10-28T05:59:00+09:00'),null);
const fake=async()=>({stdout:JSON.stringify(row)});
assert.equal((await fetchTflNight(date,{now:()=>new Date(at),run:fake}))?.source,'TFL');
assert.equal(await fetchTflNight(date,{run:async()=>{throw Error('network');}}),null);
const html='<div>코스피200 야간선물</div><div>장 마감</div><b>900.05</b><p>상승 +17.60 (+1.99%)</p><p>주간 종가 대비 · 계약 A01612</p><p>장 마감 · 마지막 시세 2026-10-28 06:00:00</p>';
const py=`import sys,json\nsys.path.insert(0,'scripts')\nimport importlib.util\ns=importlib.util.spec_from_file_location('tfl','scripts/tfl-night-reference.py')\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nprint(json.dumps(m.parse(sys.stdin.read())))`;
const parse=(x)=>{const p=spawnSync('python3',['-c',py],{input:x,encoding:'utf8'});assert.equal(p.status,0);return JSON.parse(p.stdout);};
assert.deepEqual(parse(html),row);
assert.equal(parse(html+html),null);
assert.equal(parse(html.replace('장 마감','장중')),null);
console.log('TFL reference: date, time, contract, tick, duplicate and unavailable checks PASS');
