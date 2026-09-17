import assert from 'node:assert/strict';
import master from '../src/web/domain/market/market_briefing_master.js';
import readiness from '../src/web/domain/market/morning_briefing_readiness.js';

const date='2026-09-18';
let rows=[];
const add=(seriesId,value,status='FINAL',session='REGULAR',time='06:30:00')=>{ rows=master.upsertObservation(rows,{seriesId,tradingDate:date,value,market:'TEST',session,source:'TEST',status,observedAt:`${date}T${time}+09:00`,receivedAt:`${date}T${time}+09:00`}); };
for(const id of readiness.REQUIRED.filter((id)=>id!=='K200_NIGHT')) add(id,1,id==='NDX'?'DELAYED':'FINAL');
add('K200_NIGHT',550,'FINAL','NIGHT','06:00:00');
let result=readiness.assess(master,rows,date);
assert.equal(result.ready,true);
assert.equal(readiness.qcLabel(result),'PARTIAL');
assert.ok(result.delayed.includes('NDX'));
assert.ok(result.missingImportant.length>0);

rows=rows.filter((row)=>row.seriesId!=='K200_NIGHT');
result=readiness.assess(master,rows,date);
assert.equal(result.ready,false);
assert.equal(result.k200Final,false);
assert.ok(result.missingRequired.includes('K200_NIGHT'));
assert.equal(readiness.qcLabel(result),'NOT_READY');

console.log('07:30 장전 브리핑 필수 데이터 준비도 게이트 회귀검사 통과');
