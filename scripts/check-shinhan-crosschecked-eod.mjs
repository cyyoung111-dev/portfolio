import assert from 'node:assert/strict';
import {parseShinhanIndexPage,fetchShinhanIndexEod} from './shinhan-korean-index-eod.mjs';
import {verifyCrosscheckedYahooIndexes} from './yahoo-shinhan-crosschecked-close.mjs';
import {fetchDomesticCloseIndexes,verifiedDomesticCloseRows,formatClose} from './telegram-close-workflow.mjs';
const date='2026-10-30',now=()=>new Date('2026-10-30T16:35:00+09:00');
const html='<html><head><title>종합주가지수</title></head><body><div>종합지수 / 2026.10.30 15:44</div>'
 +'<table><tr><td>KOSPI</td><td>5730.74</td><td>206.92</td></tr>'
 +'<tr><td>KOSDAQ</td><td>724.38</td><td>28.85</td></tr>'
 +'<tr><td>KOSPI200</td><td>899.78</td><td>36.09</td></tr>'
 +'<tr><td>KOSDAQ50</td><td>0.00</td><td>0.00</td></tr></table>'
 +'<div>신한금융지주회사 주가정보</div></body></html>';
const shinhan=parseShinhanIndexPage(html,{expectedDate:date,now:now()});
assert.deepEqual(shinhan.values,{KOSPI:5730.74,KOSDAQ:724.38,KOSPI200:899.78});
assert.equal(shinhan.publishedAt,'2026-10-30T06:44:00.000Z');
for(const bad of [html.replace('15:44','15:39'),html.replace('2026.10.30','2026.10.29'),
 html.replace('899.78','0.00'),html.replace('</table>','<tr><td>KOSPI200</td><td>899.78</td><td>36.09</td></tr></table>'),
 html.replace('종합지수 / 2026.10.30 15:44','종합지수 / 2026.10.30 15:44 종합지수 / 2026.10.30 15:44')])
 assert.equal(parseShinhanIndexPage(bad,{expectedDate:date,now:now()}),null);
assert.equal(parseShinhanIndexPage(html,{expectedDate:date,now:new Date('2026-10-30T15:42:00+09:00')}),null);
let calls=0;
const s=await fetchShinhanIndexEod(date,{now,fetchImpl:async(u,init)=>{
 calls++;assert.equal(u,'https://open.shinhansec.com/goodicyber/stock_jisu.jsp');
 assert.equal(init.method,'GET');return {ok:true,headers:{get:()=> 'text/html;charset=utf-8'},text:async()=>html};
}});
assert.equal(calls,1);assert.equal(s.values.KOSPI200,899.78);
const gas={status:'ok',seriesMeta:{
 KOSPI:{source:'YAHOO_FINANCE',confirmedClose:false},KOSDAQ:{source:'YAHOO_FINANCE',confirmedClose:false},
 KOSPI200:{confirmedClose:false}},series:{
 KOSPI:[{date,source:'YAHOO_UNVERIFIED_DAILY',value:5730.740234375}],
 KOSDAQ:[{date,source:'YAHOO_UNVERIFIED_DAILY',value:724.3800048828125}],
 KOSPI200:[{date,source:'YAHOO_UNVERIFIED_DAILY',value:899.780029296875}]
}};
const prev={KOSPI:[{date:'2026-10-29',value:5937.66,source:'FDR_KRX_CACHE'}],
 KOSDAQ:[{date:'2026-10-29',value:753.23,source:'FDR_KRX_CACHE'}],
 KOSPI200:[{date:'2026-10-29',value:935.87,source:'FDR_KRX_CACHE'}]};
const verified=verifyCrosscheckedYahooIndexes(date,gas,shinhan,'2026-10-29',prev);
assert.deepEqual(verified.map(r=>r.value),[5730.74,724.38,899.78]);
assert.ok(verified.every(r=>r.source==='YAHOO_SHINHAN_CROSSCHECKED_EOD'
 &&r.priceType==='INDEPENDENT_CROSSCHECKED_EOD'&&Number.isFinite(r.changePercent)));
assert.equal(verifiedDomesticCloseRows(date,verified).length,3);
assert.match(formatClose(date,[],[],verified),/KOSPI200|KOSPI 200: 899.78.*Yahoo·신한 일치 참고 종가/);
assert.equal(verifiedDomesticCloseRows(date,[{...verified[0],source:'KRX_OFFICIAL'}]).length,0);
const changed=structuredClone(gas);changed.series.KOSPI[0].value=5668.26;
assert.deepEqual(verifyCrosscheckedYahooIndexes(date,changed,shinhan,'2026-10-29',prev).map(r=>r.type),
 ['KOSDAQ','KOSPI200'],'mismatching index must be rejected alone');
const stale=structuredClone(gas);stale.series.KOSPI[0].date='2026-10-29';
assert.deepEqual(verifyCrosscheckedYahooIndexes(date,stale,shinhan,'2026-10-29',prev).map(r=>r.type),
 ['KOSDAQ','KOSPI200']);
const duplicated=structuredClone(gas);duplicated.series.KOSDAQ.push({...duplicated.series.KOSDAQ[0]});
assert.deepEqual(verifyCrosscheckedYahooIndexes(date,duplicated,shinhan,'2026-10-29',prev).map(r=>r.type),
 ['KOSPI','KOSPI200']);
const official=structuredClone(gas);official.seriesMeta.KOSPI.source='KRX_OFFICIAL';
assert.deepEqual(verifyCrosscheckedYahooIndexes(date,official,shinhan,'2026-10-29',prev).map(r=>r.type),
 ['KOSDAQ','KOSPI200']);
const rawCsv='Date,Close,UpDown\\n2026-10-29,5937.66,2\\n2026-10-30,5668.26,2\\n'.replaceAll('\\n','\n');
let gasCalls=0,shinCalls=0;
const payload=await fetchDomesticCloseIndexes(date,{now,gasUrl:'https://script.google.com/macros/s/X/exec',gasToken:'TEST',
 fetchOfficial:async(_date,{onResponse})=>{gasCalls++;onResponse(gas);return [];},
 fetchShinhan:async()=>{shinCalls++;return shinhan;},
 fetchImpl:async url=>url.startsWith('https://api.github.com')
  ?{ok:true,json:async()=>[{sha:'a'.repeat(40),commit:{committer:{date:'2026-10-30T04:19:16Z'}}}]}
  :{ok:true,text:async()=>rawCsv}});
assert.equal(gasCalls,1);assert.equal(shinCalls,1);
assert.deepEqual(payload.map(x=>x.value),[5730.74,724.38,899.78]);
assert.ok(payload.every(x=>x.source==='YAHOO_SHINHAN_CROSSCHECKED_EOD'));
const krx=await fetchDomesticCloseIndexes(date,{now,
 fetchOfficial:async(_,opts)=>[{type:'KOSPI',label:'KOSPI',date,source:'KRX_OFFICIAL',
   role:'NON_NH_DAILY_INDEX',priceType:'CONFIRMED_REGULAR_CLOSE',value:5730.74,changePercent:-3.48}],
 fetchShinhan:async()=>shinhan,
 fetchImpl:async url=>url.startsWith('https://api.github.com')
  ?{ok:true,json:async()=>[{sha:'a'.repeat(40),commit:{committer:{date:'2026-10-30T04:19:16Z'}}}]}
  :{ok:true,text:async()=>rawCsv}});
assert.equal(krx[0].source,'KRX_OFFICIAL','actual official wins over independent pair');
console.log('Korean index EOD: Shinhan date/15:40/duplicate and exact Yahoo crosscheck PASS');
