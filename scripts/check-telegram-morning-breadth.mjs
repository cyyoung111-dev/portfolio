import assert from 'node:assert/strict';
import {parseKrxBreadth,verifyKrxBreadth,readMorningBreadth,formatMorningBreadth,
 calculateAdr20} from './telegram-morning-breadth.mjs';
import {nightAuthStatus,captureMorning} from './nh-morning-capture.mjs';
import {formatFullMorningBriefing} from './telegram-morning-report.mjs';
const day='2026-11-05',prior='2026-11-04',now=()=>new Date(day+'T07:40:00+09:00');
const makeRows=(market,count)=>Array.from({length:count},(_,i)=>({
 BAS_DD:'20261104',ISU_CD:(market==='KOSPI'?'KR':'KQ')+String(i).padStart(8,'0'),
 TDD_CLSPRC:'1,230',CMPPREVDD_PRC:i%4===0?'-10':i%4===1?'0':'+12'
}));
const kospi={OutBlock_1:makeRows('KOSPI',440)},kosdaq={OutBlock_1:makeRows('KOSDAQ',660)};
const a=parseKrxBreadth(prior,'KOSPI',kospi),b=parseKrxBreadth(prior,'KOSDAQ',kosdaq);
assert.equal(a.issues,440);
assert.equal(a.advances,220);
assert.equal(a.declines,110);
assert.equal(a.unchanged,110);
assert.equal(b.issues,660);
assert.equal(verifyKrxBreadth(prior,[a,b]).length,2);
assert.equal(parseKrxBreadth(prior,'KOSPI',{OutBlock_1:kospi.OutBlock_1.slice(0,10)}),null);
assert.equal(parseKrxBreadth(prior,'KOSPI',{OutBlock_1:[...kospi.OutBlock_1.slice(0,-1),kospi.OutBlock_1[0]]}),null);
assert.equal(parseKrxBreadth(prior,'KOSPI',{OutBlock_1:[{...kospi.OutBlock_1[0],BAS_DD:'20261103'},...kospi.OutBlock_1.slice(1)]}),null);
assert.equal(verifyKrxBreadth(prior,[a,a]).length,0);
assert.match(formatMorningBreadth(day,[a,b]),/KOSPI 220↑\/110↓\/110→/);
assert.match(formatMorningBreadth(day,[a,b]),/KOSDAQ 330↑\/165↓\/165→/);
assert.match(formatMorningBreadth(day,[]),/공식 일봉 미검증/);
assert.match(formatMorningBreadth(day,[]),/ADR20: 20거래일 시계열 미연결/);
assert.equal(calculateAdr20([a,b],'KOSPI'),null);
const dates=Array.from({length:20},(_,i)=>
 new Date(Date.parse('2026-10-01T00:00:00Z')+i*86400000).toISOString().slice(0,10));
const history=dates.map(date=>({...a,date,advances:200,declines:100,unchanged:140,issues:440}));
assert.equal(calculateAdr20(history,'KOSPI')?.value,200);
assert.equal(calculateAdr20([...history.slice(1),history[1]],'KOSPI'),null);

let called=0;
const fetchImpl=async(url,{headers})=>{
 called++;
 assert.match(url,/data-dbg\.krx\.co\.kr/);
 assert.equal(headers.AUTH_KEY,'TEST_KRX_KEY_123456789');
 return {ok:true,headers:{get:()=>null},json:async()=>
  url.includes('/stk_bydd_trd')?kospi:kosdaq};
};
assert.equal((await readMorningBreadth(day,{
 authKey:'TEST_KRX_KEY_123456789',fetchImpl,now})).length,2);
assert.equal(called,2);
assert.deepEqual(await readMorningBreadth(day,{authKey:'',fetchImpl,now}),[]);
assert.equal(called,2,'no unauthorized KRX calls without a configured key');
assert.deepEqual(await readMorningBreadth(day,{authKey:'TEST_KRX_KEY_123456789',
 fetchImpl,now:()=>new Date(day+'T05:00:00+09:00')}),[]);
assert.equal(called,2);
const message=formatFullMorningBriefing(day,null,[],{
 now:now(),supplements:{breadth:formatMorningBreadth(day,[a,b])}});
assert.match(message,/시장폭 A\/D: KOSPI 220↑/);
assert.match(message,/외국인\/기관 수급: 미확보/);
assert.match(message,/■ QC: 기준 거래일과 일치한 일봉 0\/21/);

let statusCalls=0;
const auth=await nightAuthStatus({url:'https://script.google.com/macros/s/EXAMPLE/exec',
 token:'VALID_GAS_SECRET_ONLY',request:async(_url,{body})=>{
  statusCalls++;
  assert.equal(body.get('action'),'getNhAuthStatusProxy');
  return {ok:true,json:async()=>({status:'ok',provider:'NH',
    readOnly:true,enabled:true,tokenCached:false,tokenIssued:false})};
 }});
assert.equal(auth,'TOKEN_NOT_CACHED');
assert.equal(statusCalls,1);
assert.equal(await nightAuthStatus({url:'https://bad.example.com',token:'secret'}),'AUTH_STATUS_UNAVAILABLE');
let reasons=[];
const result=await captureMorning({
 now:()=>new Date('2026-11-05T07:33:00+09:00'),
 fetchNight:async(_date,{onError})=>{onError('NH_PROXY_WINDOW');return null;},
 readAuthStatus:async()=>{reasons.push('checked');return 'TOKEN_CACHED';}
});
assert.equal(result.status,'REFERENCE_UNAVAILABLE');
assert.equal(result.reason,'NH_PROXY_WINDOW');
assert.equal(result.authStatus,'TOKEN_CACHED');
assert.deepEqual(reasons,['checked']);
assert.ok(!JSON.stringify(result).includes('VALID_GAS_SECRET_ONLY'));
console.log('Morning KRX breadth and NH token-cache failure classification: PASS');
