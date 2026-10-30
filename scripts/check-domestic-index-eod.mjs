import assert from 'node:assert/strict';
import source from '../src/web/domain/market/domestic_index_eod.js';
import {loadMorningDomesticDailyIndexes,runTelegramMorning} from './telegram-morning-briefing.mjs';
import {mergeMorningSourceRows} from './telegram-morning-master.mjs';
const day='2026-10-30';
const csv='\uFEFFDate,Close,UpDown,Comp\n2026-10-28,6012.44,1,374.1\n2026-10-29,5937.66,2,-74.78\n2026-10-30,5668.26,2,-269.4\n';
assert.deepEqual(source.parseYearCsv(csv,2026).map(x=>x.date),
 ['2026-10-28','2026-10-29','2026-10-30']);
assert.equal(source.approvedRows(source.parseYearCsv(csv,2026),'2026-10-30T04:19:16Z',day).length,2,
 '13:19 KST update is intraday; current date must be rejected');
assert.equal(source.approvedRows(source.parseYearCsv(csv,2026),'2026-10-30T10:58:41Z',day).length,3);
assert.equal(source.approvedRows(source.parseYearCsv(csv,2026),'2026-10-30T06:39:59Z',day).length,2);
assert.equal(source.approvedRows(source.parseYearCsv(csv,2026),'2026-10-30T06:40:00Z',day).length,3);
assert.equal(source.approvedRows(source.parseYearCsv(csv,2026),'no-time',day).length,0);
for(const invalid of [
 csv+'2026-10-29,5888,1,20\n',csv.replace('5668.26','0'),
 csv.replace('2026-10-30','2026-02-30'),
 csv.replace('Date,Close','Day,Close')])
 assert.throws(()=>source.parseYearCsv(invalid,2026),/INDEX_CSV/);
const now=()=>new Date('2026-10-30T16:30:00+09:00');
const nowLate=()=>new Date('2026-10-30T20:10:00+09:00');
function stub(stamp,{broken=false}={}){
 const seen=[];
 const fetchImpl=async url=>{
  seen.push(url);
  if(url.includes('raw.githubusercontent.com'))return {
   ok:true,text:async()=>broken?'bad,fields\n':csv
  };
  if(url.startsWith('https://api.github.com/repos/FinanceData/fdr_krx_data_cache/commits'))
   return {ok:true,json:async()=>[{sha:'a'.repeat(40),commit:{committer:{date:stamp}}}]};
  throw Error('unapproved source');
 };
 return {seen,fetchImpl};
}
{
 const mock=stub('2026-10-30T04:19:16Z');
 const out=await source.loadSeries(['KOSPI'],'2026-10-28',day,{fetchImpl:mock.fetchImpl,now});
 assert.deepEqual(out.seriesMap.KOSPI.map(x=>x.date),['2026-10-28','2026-10-29']);
 assert.ok(out.seriesMap.KOSPI.every(x=>x.source==='FDR_KRX_CACHE'
   && x.role==='NON_NH_DAILY_INDEX'&&x.priceType==='PUBLISHED_EOD_REFERENCE'));
 assert.equal(mock.seen.length,2,'one pinned raw public CSV and one public provenance check');
 assert.ok(mock.seen[0].startsWith('https://api.github.com/'));
 assert.ok(mock.seen[1].includes('/'+'a'.repeat(40)+'/data/index/'),'CSV must be read at verified commit');
 assert.equal(mock.seen.filter(u=>u.includes('/oauth')||u.includes('nhplug')).length,0);
}
{
 const mock=stub('2026-10-30T10:58:41Z');
 const out=await source.loadSeries(['KOSPI'],'2026-10-28',day,{fetchImpl:mock.fetchImpl,now:nowLate});
 assert.deepEqual(out.seriesMap.KOSPI.map(x=>x.value),[6012.44,5937.66,5668.26]);
 assert.deepEqual((await source.loadSeries(['KOSPI'],'2026-10-28',day,
   {fetchImpl:mock.fetchImpl,now})).seriesMap.KOSPI,[],
   'a future metadata timestamp must never be approved at 16:30');
}
{
 const mock=stub('2026-10-30T10:58:41Z',{broken:true});
 const out=await source.loadSeries(['KOSPI200'],'2026-10-28',day,{fetchImpl:mock.fetchImpl,now});
 assert.deepEqual(out.seriesMap.KOSPI200,[]);
 assert.ok(out.errors.KOSPI200);
}
await assert.rejects(source.loadSeries(['KOSPI'],'2026-02-30',day,{now}),/INDEX_RANGE_INVALID/);
await assert.rejects(source.loadSeries(['KOSPI'],'2026-10-31','2026-10-31',{now}),/INDEX_RANGE_INVALID|INDEX_RANGE_TOO_WIDE/);
const monday='2026-11-02';
const mondayMorning=()=>new Date('2026-11-02T07:45:00+09:00');
const indexCalls=[];
const mondayFetch=async url=>{
 indexCalls.push(url);
 if(url.includes('raw.githubusercontent.com'))return {ok:true,text:async()=>csv};
 if(url.includes('api.github.com/repos/FinanceData/fdr_krx_data_cache/commits'))
  return {ok:true,json:async()=>[{sha:'b'.repeat(40),commit:{committer:{date:'2026-10-30T10:58:41Z'}}}]};
 return {ok:false,status:503};
};
const priorIndexes=await loadMorningDomesticDailyIndexes(monday,{fetchImpl:mondayFetch,now:mondayMorning});
assert.equal(priorIndexes.length,3);
assert.deepEqual(priorIndexes.map(x=>x.date),['2026-10-30','2026-10-30','2026-10-30']);
assert.ok(priorIndexes.every(x=>x.source==='FDR_KRX_CACHE'&&x.role==='NON_NH_DAILY_INDEX'));
const merged=mergeMorningSourceRows([
 {label:'KOSPI',symbol:'^KS11',date:'2026-10-30',value:9999,source:'Yahoo Finance 일봉'}
],[],[],priorIndexes);
assert.equal(merged.find(x=>x.symbol==='^KS11').value,5668.26);
assert.deepEqual(mergeMorningSourceRows([],[],[],[priorIndexes[0],priorIndexes[0]]),[]);
let delivered='',yahooIndexRequested=false;
const morning=await runTelegramMorning({event:'schedule',now:mondayMorning,attempt:1,
 token:'dummy',chatId:'dummy',referenceFetch:async()=>null,
 send:async(_token,_chat,body)=>{delivered=body;},
 fetchImpl:async(url,options)=>{
  if(String(url).includes('finance.yahoo.com/v8/finance/chart/')){
   const name=decodeURIComponent(new URL(url).pathname.split('/').at(-1));
   if(['^KS11','^KQ11','^KS200'].includes(name))yahooIndexRequested=true;
  }
  return mondayFetch(url,options);
 }});
assert.equal(morning.status,'SENT_SOURCE_MISSING');
assert.equal(yahooIndexRequested,false,'NH-missing domestic indexes must not query Yahoo');
assert.match(delivered,/KOSPI: 5,668.26.*FDR·KRX 참고 종가/);
assert.match(delivered,/KOSDAQ: 5,668.26.*FDR·KRX 참고 종가/);
assert.match(delivered,/KOSPI200: 5,668.26.*FDR·KRX 참고 종가/);
console.log('Domestic index EOD: date, post-close provenance, intraday exclusion, source labels PASS');
