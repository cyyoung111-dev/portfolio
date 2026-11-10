import assert from 'node:assert/strict';
import {readKofiaLiquidity,verifyKofiaLiquidity,formatKofiaLiquidity}
 from './briefing-kofia-liquidity.mjs';
import {formatFullMorningBriefing} from './telegram-morning-report.mjs';
import {formatClose} from './telegram-close-workflow.mjs';

const date='2026-11-10',reported='20261106';
const dep={TMPV1:reported,TMPV2:'90334244',TMPV3:'32820000'};
const loan={TMPV1:reported,TMPV2:'28385643',TMPV3:'22000000',TMPV4:'6385643'};
const funds={ds1:[{...dep,TMPV1:'20261105',TMPV2:'88000000'},dep]};
const loans={ds1:[loan]};
const direct=verifyKofiaLiquidity(date,funds,loans);
assert.equal(direct.source,'KOFIA_FREESIS_PUBLIC');
assert.equal(direct.deposits.date,'2026-11-06');
assert.equal(direct.margin.date,'2026-11-06');
assert.equal(direct.margin.kospiMillion+direct.margin.kosdaqMillion,
 direct.margin.balanceMillion);
const text=formatKofiaLiquidity(direct);
assert.match(text,/예탁금 90\.33조\(11-06\)/);
assert.match(text,/신용융자 28\.39조\(11-06\)/);
assert.match(text,/금투협 FreeSIS/);
assert.ok(text.length<=140);
assert.equal(verifyKofiaLiquidity(date,{ds1:[dep,dep]},loans).deposits,null,
 'duplicate latest settlement row must be rejected');
assert.equal(verifyKofiaLiquidity(date,funds,{ds1:[{...loan,TMPV4:'6000000'}]}).margin,null,
 'credit component totals must reconcile');
assert.equal(verifyKofiaLiquidity(date,{ds1:[{...dep,TMPV1:'20261112'}]},null),null,
 'future publication date must not appear as past verified');
assert.equal(verifyKofiaLiquidity(date,{ds1:[{...dep,TMPV1:'20261020'}]},null),null,
 'old settlement record must not look fresh');
assert.equal(formatKofiaLiquidity({...direct,asOfKst:'2026-11-01'}),'',
 'future-dated financial observations must be rejected at rendering');
const calls=[];
const mock=async(url,options)=>{
 assert.equal(url,'https://freesis.kofia.or.kr/meta/getMetaDataList.do');
 assert.equal(options.method,'POST');
 assert.equal(options.redirect,'error');
 const req=JSON.parse(options.body).dmSearch;
 assert.equal(req.tmpV1,'RD');
 assert.equal(req.tmpV40,'1000000');
 assert.equal(req.tmpV46,'20261110');
 assert.ok(!JSON.stringify(options).includes('SECRET'));
 calls.push(req.OBJ_NM);
 return {ok:true,headers:{get:()=>null},json:async()=>req.OBJ_NM.includes('0060')?funds:loans};
};
const retrieved=await readKofiaLiquidity(date,{fetchImpl:mock});
assert.deepEqual(retrieved,direct);
assert.deepEqual(calls.sort(),['STATSCU0100000060BO','STATSCU0100000070BO']);
const failed=await readKofiaLiquidity(date,{fetchImpl:async()=>{throw Error('BLOCKED');}});
assert.equal(failed,null,'provider block must not become a fabricated number');
const output=formatFullMorningBriefing(date,null,[],{
 now:new Date('2026-11-10T07:40:00+09:00'),
 supplements:{liquidity:formatKofiaLiquidity(retrieved)}
});
assert.match(output,/시장자금.*예탁금 90\.33조.*신용융자 28\.39조/);
assert.match(output,/■ QC: 기준 거래일과 일치한 일봉 0\/21/);
assert.doesNotMatch(output,/고객예탁금·신용잔고: 최신 확정치 미연결|FedWatch·Finviz|외국인\/기관 수급: 미확보/);
const empty=formatFullMorningBriefing(date,null,[]);
assert.doesNotMatch(empty,/■ 7\. 시장자금|FedWatch|Finviz|신용잔고: 최신 확정치 미연결/);
const close=formatClose(date,[],[],[],[],[],[],[],
 new Date('2026-11-10T17:00:00+09:00'),[],[],null,null,[],retrieved);
assert.match(close,/시장자금.*예탁금 90\.33조.*신용융자 28\.39조/);
const closeEmpty=formatClose(date,[]);
assert.doesNotMatch(closeEmpty,/시장자금:|금투협 FreeSIS/);
assert.ok(close.length<=4000);
console.log('KOFIA_LIQUIDITY_BRIEFING_PASS sourceUnits=KRW_millions, exactDate, duplicate, components, zeroWrites, optionalOutput, morningAndClose');
