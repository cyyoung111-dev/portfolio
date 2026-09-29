import assert from 'node:assert/strict';
import master from '../src/web/domain/market/market_briefing_master.js';

const date = '2026-09-18';
let rows = [];
rows = master.upsertObservation(rows, { seriesId:'K200_NIGHT', tradingDate:date, value:550, market:'KRX', session:'NIGHT', source:'KIS', status:'FINAL', observedAt:`${date}T06:00:00+09:00`, receivedAt:`${date}T06:00:02+09:00` });
rows = master.upsertObservation(rows, { seriesId:'USDKRW', tradingDate:date, value:1390, market:'FX', session:'CONTINUOUS', source:'PRIMARY', status:'LIVE', observedAt:`${date}T07:29:50+09:00`, receivedAt:`${date}T07:29:51+09:00` });
rows = master.upsertObservation(rows, { seriesId:'USDKRW', tradingDate:date, value:1395, market:'FX', session:'CONTINUOUS', source:'PRIMARY', status:'LIVE', observedAt:`${date}T20:14:50+09:00`, receivedAt:`${date}T20:14:51+09:00` });
rows = master.upsertObservation(rows, { seriesId:'NQ', tradingDate:date, value:25000, market:'CME', session:'GLOBEX', source:'FREE_DELAYED', status:'DELAYED', observedAt:`${date}T20:05:00+09:00`, receivedAt:`${date}T20:15:00+09:00` });
rows = master.upsertObservation(rows, { seriesId:'RECEIVE_ONLY', tradingDate:date, value:1, receivedAt:`${date}T07:20:00+09:00` });

assert.equal(master.normalizeObservation({ seriesId:'X', tradingDate:date, value:1, receivedAt:`${date}T07:00:00+09:00` }).timestampQuality, 'RECEIVE_ONLY');
const metadata=master.normalizeObservation({seriesId:'X',tradingDate:date,value:1,currency:'KRW',sourceDate:'2026-09-17',fallback:true,receivedAt:`${date}T07:00:00+09:00`});
assert.equal(metadata.currency,'KRW'); assert.equal(metadata.sourceDate,'2026-09-17'); assert.equal(metadata.fallback,true);
assert.equal(master.checkpointForTime('07:29:59'),'NIGHT_FINAL'); assert.equal(master.checkpointForTime('07:30:00'),'MORNING');
assert.equal(master.checkpointForTime('15:30:00'),'KRX_FINAL'); assert.equal(master.checkpointForTime('20:00:00'),'AFTER_FINAL'); assert.equal(master.checkpointForTime('20:15:00'),'EVENING');
assert.throws(() => master.normalizeObservation({ seriesId:'X', tradingDate:date, value:1, observedAt:`${date}T07:00:01+09:00`, receivedAt:`${date}T07:00:00+09:00` }), /observedAt must not be after receivedAt/);
assert.equal(master.normalizeObservation({ seriesId:'X', tradingDate:date, value:1, observedAt:`${date}T07:00:00+09:00`, receivedAt:`${date}T07:00:01+09:00`, timestampQuality:'RECEIVE_ONLY', lagSeconds:999 }).lagSeconds, 1);
assert.equal(master.selectAt(rows, 'USDKRW', `${date}T07:30:00+09:00`).value, 1390, '07:30 must not look ahead to evening');
assert.equal(master.selectAt(rows, 'USDKRW', `${date}T20:15:00+09:00`).value, 1395);
assert.equal(master.selectAt(rows, 'NQ', `${date}T20:15:00+09:00`).status, 'DELAYED');
assert.equal(master.selectAt(rows, 'NQ', `${date}T20:15:00+09:00`).lagSeconds, 600);

let backfill=[];
for(const id of ['SPX','NDX','SOX','VIX','KOSPI','KOSDAQ','KOSPI200','USDKRW'])backfill=master.upsertObservation(backfill,{seriesId:id,tradingDate:'2026-09-17',sourceDate:'2026-09-17',value:1,market:id==='USDKRW'?'FX':'TEST',session:id==='USDKRW'?'FX':'REGULAR',source:'HISTORY',status:'FINAL',finality:id==='USDKRW'?'HISTORICAL_CLOSE':'REGULAR_CLOSE',receivedAt:`${date}T07:35:00+09:00`});
const morningBackfill=master.buildBriefingSnapshot(backfill,date,'MORNING',['SPX','NDX','SOX','VIX','KOSPI','KOSDAQ','KOSPI200','USDKRW']);
for(const id of Object.keys(morningBackfill.values)){assert.equal(morningBackfill.values[id].value,1);assert.equal(morningBackfill.values[id].observedAt,null);assert.equal(morningBackfill.values[id].receivedAt,'2026-09-17T22:35:00.000Z');}
backfill=master.upsertObservation(backfill,{seriesId:'SPX',tradingDate:date,sourceDate:date,value:2,status:'FINAL',finality:'REGULAR_CLOSE',observedAt:`${date}T07:29:00+09:00`,receivedAt:`${date}T07:35:00+09:00`});
assert.equal(master.buildBriefingSnapshot(backfill,date,'MORNING',['SPX']).values.SPX.value,2,'same-day cutoff row must beat historical fallback');
backfill=master.upsertObservation(backfill,{seriesId:'LATE_ONLY',tradingDate:date,sourceDate:date,value:3,status:'PARTIAL',receivedAt:`${date}T07:35:00+09:00`});
assert.equal(master.buildBriefingSnapshot(backfill,date,'MORNING',['LATE_ONLY']).values.LATE_ONLY,null,'late same-day PARTIAL must not bypass cutoff');
assert.equal(master.validateSnapshot(morningBackfill).ok,true);
backfill=master.upsertObservation(backfill,{seriesId:'VIX',tradingDate:'2026-09-16',sourceDate:'2026-09-16',value:0.5,status:'FINAL',finality:'REGULAR_CLOSE',receivedAt:`${date}T07:00:00+09:00`});
assert.equal(master.buildBriefingSnapshot(backfill,date,'MORNING',['VIX']).values.VIX.value,1,'latest sourceDate historical row must beat older cutoff row');
for(const id of ['KOSPI','KOSDAQ','KOSPI200'])backfill=master.upsertObservation(backfill,{seriesId:id,tradingDate:date,sourceDate:date,value:9,status:id==='KOSPI200'?'DELAYED':'PARTIAL',receivedAt:`${date}T07:20:00+09:00`});
const priorKrx=master.buildBriefingSnapshot(backfill,date,'MORNING',['KOSPI','KOSDAQ','KOSPI200']);
for(const id of Object.keys(priorKrx.values))assert.equal(priorKrx.values[id].sourceDate,'2026-09-17',`${id} MORNING must use PRIOR_FINAL`);
assert.equal(master.buildBriefingSnapshot(backfill,date,'KRX_FINAL',['KOSPI']).values.KOSPI.value,9,'same-day row is eligible outside MORNING');
let fxTiming=[];
fxTiming=master.upsertObservation(fxTiming,{seriesId:'USDKRW',tradingDate:'2026-09-17',sourceDate:'2026-09-17',value:1380,status:'FINAL',finality:'HISTORICAL_CLOSE',receivedAt:`${date}T07:00:00+09:00`});
fxTiming=master.upsertObservation(fxTiming,{seriesId:'USDKRW',tradingDate:date,sourceDate:date,value:1390,status:'PARTIAL',observedAt:`${date}T07:29:30+09:00`,receivedAt:`${date}T07:31:00+09:00`});
assert.equal(master.buildBriefingSnapshot(fxTiming,date,'MORNING',['USDKRW']).values.USDKRW.value,1390,'provider observedAt before cutoff must select same-day FX');
fxTiming=master.upsertObservation([], {seriesId:'USDKRW',tradingDate:date,sourceDate:date,value:1391,status:'PARTIAL',observedAt:`${date}T07:31:00+09:00`,receivedAt:`${date}T07:31:01+09:00`});
assert.equal(master.buildBriefingSnapshot(fxTiming,date,'MORNING',['USDKRW']).values.USDKRW,null,'observedAt after cutoff must remain strict');
fxTiming=master.upsertObservation([], {seriesId:'USDKRW',tradingDate:date,sourceDate:date,value:1392,status:'PARTIAL',quality:'SCHEDULED_DELAY_TOLERANCE_300S',receivedAt:`${date}T07:31:00+09:00`});
assert.equal(master.buildBriefingSnapshot(fxTiming,date,'MORNING',['USDKRW']).values.USDKRW.value,1392,'scheduled receive-only FX gets narrow tolerance');
fxTiming=master.upsertObservation([], {seriesId:'USDKRW',tradingDate:date,sourceDate:date,value:1392,status:'PARTIAL',quality:'SCHEDULED_DELAY_TOLERANCE_300S',receivedAt:`${date}T07:36:00+09:00`});
assert.equal(master.buildBriefingSnapshot(fxTiming,date,'MORNING',['USDKRW']).values.USDKRW,null,'scheduled tolerance must not exceed 300 seconds');
fxTiming=master.upsertObservation([], {seriesId:'USDKRW',tradingDate:date,sourceDate:date,value:1392,status:'PARTIAL',receivedAt:`${date}T07:31:00+09:00`});
assert.equal(master.buildBriefingSnapshot(fxTiming,date,'MORNING',['USDKRW']).values.USDKRW,null,'ordinary receive-only FX remains strict');
fxTiming=master.upsertObservation([], {seriesId:'USDKRW',tradingDate:date,sourceDate:date,value:1393,status:'PARTIAL',quality:'SCHEDULED_DELAY_TOLERANCE_300S',receivedAt:`${date}T20:16:00+09:00`});
assert.equal(master.buildBriefingSnapshot(fxTiming,date,'EVENING',['USDKRW']).values.USDKRW.value,1393,'EVENING scheduled FX gets same narrow tolerance');
let closePriority=[];
const addClose=(seriesId,value,status,observedAt,checkpoint='KRX_FINAL')=>{closePriority=master.upsertObservation(closePriority,{seriesId,tradingDate:date,sourceDate:date,value,market:'KRX',session:'REGULAR',source:status==='FINAL'?'KRX_OFFICIAL':'TOSS',status,finality:status==='FINAL'?'REGULAR_CLOSE':null,observedAt,receivedAt:observedAt});return master.buildBriefingSnapshot(closePriority,date,checkpoint,[seriesId]).values[seriesId];};
addClose('SAMSUNG',80000,'FINAL',`${date}T15:29:00+09:00`);assert.equal(addClose('SAMSUNG',81000,'PARTIAL',`${date}T15:30:00+09:00`).value,80000,'SAMSUNG FINAL must beat later PARTIAL');
closePriority=[];addClose('SKHYNIX',180000,'FINAL',`${date}T15:30:00+09:00`,'EVENING');assert.equal(addClose('SKHYNIX',181000,'PARTIAL',`${date}T20:00:00+09:00`,'EVENING').value,180000,'SKHYNIX FINAL must beat later PARTIAL');
closePriority=[];addClose('KOSPI',3400,'FINAL',`${date}T15:29:00+09:00`);assert.equal(addClose('KOSPI',3410,'PARTIAL',`${date}T15:30:00+09:00`).value,3400,'KOSPI official FINAL must beat later PARTIAL');
closePriority=[];assert.equal(addClose('SAMSUNG',81000,'PARTIAL',`${date}T15:30:00+09:00`).status,'PARTIAL','PARTIAL-only candidate must not be promoted');
closePriority=[];addClose('SAMSUNG',80000,'FINAL',`${date}T15:29:00+09:00`);assert.equal(addClose('SAMSUNG',80500,'FINAL',`${date}T15:30:00+09:00`).value,80500,'latest FINAL wins within FINAL tier');

const bridge = master.bridgeBriefings(rows, date, ['K200_NIGHT','USDKRW','NQ']);
assert.equal(bridge.morning.values.USDKRW.value, 1390);
assert.equal(bridge.evening.values.USDKRW.value, 1395);
assert.equal(bridge.morning.values.NQ, null, 'morning cannot use evening observation');
assert.equal(master.validateSnapshot(bridge.evening).ok, true);
assert.deepEqual(master.SERIES_POLICY.US_FUTURES_FREE, { morning:'DELAYED', evening:'DELAYED' });
assert.deepEqual(master.SERIES_POLICY.K200_NIGHT, { morning:'FINAL', evening:'LIVE' });

console.log('시장 브리핑 공통 MASTER 시점·지연·look-ahead 회귀검사 통과');
