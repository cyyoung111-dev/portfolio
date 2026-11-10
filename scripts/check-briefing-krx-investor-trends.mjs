import assert from 'node:assert/strict';
import {verifyInvestorTrendMarket,verifyInvestorTrendCrossMarket,
 readInvestorTrends,formatInvestorTrends} from './briefing-krx-investor-trends.mjs';
import {formatFullMorningBriefing} from './telegram-morning-report.mjs';
import {formatClose} from './telegram-close-workflow.mjs';
import {summarizeOptionalDelivery} from './briefing-optional-display-audit.mjs';

const DAY='2026-11-09',TODAY='2026-11-10';
const CODES=['1000','2000','3000','3100','4000','5000','6000',
 '7000','7100','8000','9000','9001'];
const source={1000:30000000000,7100:20000000000,8000:50000000000,
 9000:-100000000000};
const mkAmounts=(factor=1)=>CODES.map(investorGubun=>{
 const value=(source[investorGubun]||0)*factor;
 return {investorGubun,diffValue:String(value),
  buyPrice:String(Math.max(0,value)),sellPrice:String(Math.max(0,-value)),
  buyQuant:'0',sellQuant:'0'};
});
const response=(date,factor=1)=>({content:[
 {bizdate:date.replaceAll('-',''),time:'',netAmounts:mkAmounts(factor)}],
 pageable:{pageNumber:0}});
const kospi=verifyInvestorTrendMarket(DAY,'KOSPI',response(DAY));
const kosdaq=verifyInvestorTrendMarket(DAY,'KOSDAQ',response(DAY,0.1));
const all=verifyInvestorTrendMarket(DAY,'ALL',response(DAY,1.1));
assert.ok(kospi&&kosdaq&&all,'12 codes and exact market arithmetic');
assert.equal(kospi.foreignKrw,-100000000000);
assert.equal(kospi.institutionKrw,30000000000);
const joined=verifyInvestorTrendCrossMarket(DAY,[kospi,kosdaq,all]);
assert.equal(joined?.markets.length,2);
assert.deepEqual(joined?.all,all);
const tested={...joined,mode:'morning',provisional:false};
const formatted=formatInvestorTrends(tested);
assert.match(formatted,/시장 수급 \[11-09 · KRX 거래 · 네이버 참고\]/);
assert.match(formatted,/KOSPI 외 −1,000억\/기관 \+300억/);
assert.doesNotMatch(formatted,/잠정|KRX 공식 확정/);
assert.equal(formatInvestorTrends({...tested,all:null}),'');
assert.equal(formatInvestorTrends({...tested,markets:[{
 ...kospi,foreignKrw:12345},kosdaq]}),'',
 'send-time formatting must revalidate market cross-check');

const wrongDate=response(TODAY);
assert.equal(verifyInvestorTrendMarket(DAY,'KOSPI',wrongDate),null);
const dup=response(DAY);dup.content.push(dup.content[0]);
assert.equal(verifyInvestorTrendMarket(DAY,'KOSPI',dup),null);
const badCode=response(DAY);badCode.content[0].netAmounts[0].investorGubun='9999';
assert.equal(verifyInvestorTrendMarket(DAY,'KOSPI',badCode),null);
const badDiff=response(DAY);badDiff.content[0].netAmounts[0].diffValue='900000000000';
assert.equal(verifyInvestorTrendMarket(DAY,'KOSPI',badDiff),null);
const broken=response(DAY);broken.content[0].netAmounts[0].buyPrice='invalid';
assert.equal(verifyInvestorTrendMarket(DAY,'KOSPI',broken),null);
const brokenMarket={...all,amounts:{...all.amounts,'1000':all.amounts['1000']+20000000}};
assert.equal(verifyInvestorTrendCrossMarket(DAY,[kospi,kosdaq,brokenMarket]),null);
assert.equal(verifyInvestorTrendCrossMarket(DAY,[kospi,kosdaq,kosdaq]),null);

const prices={KOSPI:response(DAY),KOSDAQ:response(DAY,0.1),
 ALL:response(DAY,1.1)};
const calls=[];
const fetchImpl=async url=>{
 const u=new URL(url),market=u.searchParams.get('marketType');
 assert.equal(u.hostname,'stock.naver.com');
 assert.equal(u.searchParams.get('tradeType'),'KRX');
 assert.equal(u.searchParams.get('bizdate'),'20261109');
 calls.push(market);
 return {ok:true,headers:{get:()=> 'application/json'},
  json:async()=>prices[market]};
};
const actual=await readInvestorTrends(TODAY,{mode:'morning',
 now:()=>new Date('2026-11-10T07:40:00+09:00'),fetchImpl});
assert.equal(actual?.date,DAY);
assert.equal(actual.mode,'morning');
assert.equal(actual.provisional,false);
assert.deepEqual(calls.sort(),['ALL','KOSDAQ','KOSPI']);
const msg=formatFullMorningBriefing(TODAY,null,[],{
 now:new Date('2026-11-10T07:40:00+09:00'),
 supplements:{investors:formatInvestorTrends(actual)}});
assert.match(msg,/시장 수급 \[11-09 · KRX 거래 · 네이버 참고\]/);
assert.ok(msg.length<=3900);
const absent=formatFullMorningBriefing(TODAY,null,[]);
assert.doesNotMatch(absent,/시장 수급 \[/);
const z={futures:0,treasury:0,vkospi:0,turnover:0,
 breadth:0,liquidity:0,investors:2};
assert.equal(summarizeOptionalDelivery('morning',z,msg).groups.investors.status,'DISPLAYED');
assert.equal(summarizeOptionalDelivery('morning',z,absent).groups.investors.status,'NOT_DISPLAYED');
assert.equal(await readInvestorTrends(TODAY,{mode:'morning',
 now:()=>new Date('2026-11-10T07:40:00+09:00'),
 fetchImpl:async()=>{throw Error('provider unavailable');}}),null);
assert.equal(await readInvestorTrends(TODAY,{mode:'morning',
 now:()=>new Date('2026-11-10T09:00:00+09:00'),fetchImpl:async()=>assert.fail()}),null);
assert.equal(await readInvestorTrends('2026-11-08',{mode:'morning',
 now:()=>new Date('2026-11-08T07:40:00+09:00'),fetchImpl:async()=>assert.fail()}),null);
const close=verifyInvestorTrendCrossMarket(TODAY,[
 verifyInvestorTrendMarket(TODAY,'KOSPI',response(TODAY)),
 verifyInvestorTrendMarket(TODAY,'KOSDAQ',response(TODAY,0.1)),
 verifyInvestorTrendMarket(TODAY,'ALL',response(TODAY,1.1))]);
const provisional={...close,mode:'close',provisional:true};
assert.match(formatInvestorTrends(provisional),/네이버 참고 잠정/);
const closeReport=formatClose(TODAY,[],[],[],[],[],[],[],
 new Date('2026-11-10T17:00:00+09:00'),[],[],null,null,[],null,provisional);
assert.match(closeReport,/시장 수급 \[11-10 · KRX 거래 · 네이버 참고 잠정\]/);
assert.match(closeReport,/수급 1\/1 · 시장자금 0\/2/,
 'verified cross-market investor data must count in closing QC');
assert.ok(closeReport.length<=4000);
console.log('KRX_INVESTOR_NAVER_REFERENCE_PASS cross-market/date/units/foreign-institution/partial/close-provisional/no-writes');
