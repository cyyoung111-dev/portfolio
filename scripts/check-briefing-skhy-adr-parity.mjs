import assert from 'node:assert/strict';
import {SKHY_ADS_PER_ORDINARY,verifiedSkhyQuote,calculateSkhyParity,
 formatSkhyParity} from './briefing-skhy-adr-parity.mjs';
import {formatFullMorningBriefing} from './telegram-morning-report.mjs';

const usDate='2026-11-11',date='2026-11-12';
const quote={symbol:'SKHY',label:'SK하이닉스 ADR',date:usDate,
 value:142.25,source:'YAHOO_DAILY_REFERENCE'};
const kr={symbol:'000660.KS',label:'SK하이닉스',date:usDate,
 value:1277000,source:'NH_REGULAR_CLOSE'};
const fx={symbol:'KRW=X',label:'원/달러',date:usDate,value:1333.6,
 source:'Yahoo Finance 일봉'};
const args={skhyQuote:quote,ordinaryClose:kr,fxClose:fx,
 usDate,ordinaryDate:usDate,fxDate:usDate};
assert.equal(SKHY_ADS_PER_ORDINARY,10);
assert.deepEqual(verifiedSkhyQuote([{...quote,unit:'USD'}],usDate),quote);
assert.equal(verifiedSkhyQuote([{...quote,date:'2026-11-10'}],usDate),null);
assert.equal(verifiedSkhyQuote([quote,quote],usDate),null);
const result=calculateSkhyParity(args);
assert.ok(result);
assert.equal(Math.round(result.equivalentKrw),1897046);
assert.ok(Math.abs(result.premiumPercent-(1897046/1277000-1)*100)<1e-8);
const lines=formatSkhyParity(result).join('\n');
assert.match(lines,/원주 약 1,897,046원/);
assert.match(lines,/비동시 종가/);
assert.match(lines,/국내 예상 등락률 아님/);
for(const bad of [
 {skhyQuote:{...quote,date:'2026-11-10'}},
 {skhyQuote:{...quote,source:'UNKNOWN'}},
 {skhyQuote:{...quote,value:0}},
 {ordinaryClose:{...kr,date:'2026-11-10'}},
 {ordinaryClose:{...kr,source:'MALFORMED'}},
 {fxClose:{...fx,date:'2026-11-10'}},
 {fxClose:{...fx,value:0}},
 {fxClose:{...fx,value:10000}},
 {ordinaryDate:'2026-11-12'}
]){
 assert.equal(calculateSkhyParity({...args,...bad}),null,JSON.stringify(bad));
}
assert.equal(formatSkhyParity(null).length,0);
const rows=[
 kr,fx,
 {label:'S&P 500',symbol:'^GSPC',date:usDate,value:7600,
  changePercent:1.1,source:'NH_INDEX_DAILY'},
 {label:'NASDAQ100',symbol:'^NDX',date:usDate,value:28400,
  changePercent:2.1,source:'NH_INDEX_DAILY'},
 {label:'SOX',symbol:'^SOX',date:usDate,value:10500,
  changePercent:5.3,source:'Yahoo Finance 일봉'},
 {label:'VIX',symbol:'^VIX',date:usDate,value:17,changePercent:-5,
  source:'Yahoo Finance 일봉'}
];
const now=new Date('2026-11-12T07:42:00+09:00');
const watchEvidence={expectedUsDate:usDate,events:[],skhyQuote:quote};
const msg=formatFullMorningBriefing(date,null,rows,{now,watchEvidence});
assert.match(msg,/SK하이닉스 ADR 환산 비교/);
assert.match(msg,/1,897,046원/);
assert.match(msg,/국내 예상 등락률 아님/);
assert.ok(msg.length<=3900);
const without=formatFullMorningBriefing(date,null,rows,{now});
assert.doesNotMatch(without,/SK하이닉스 ADR 환산 비교/);
const stale=formatFullMorningBriefing(date,null,rows,{now,
 watchEvidence:{...watchEvidence,skhyQuote:{...quote,date:'2026-11-10'}}});
assert.doesNotMatch(stale,/SK하이닉스 ADR 환산 비교/);
const fxMissing=formatFullMorningBriefing(date,null,rows.filter(x=>x.symbol!=='KRW=X'),
 {now,watchEvidence});
assert.doesNotMatch(fxMissing,/SK하이닉스 ADR 환산 비교/);
const unverifiedKr=formatFullMorningBriefing(date,null,
 rows.map(x=>x.symbol==='000660.KS'?{...x,source:'UNKNOWN'}:x),{now,watchEvidence});
assert.doesNotMatch(unverifiedKr,/SK하이닉스 ADR 환산 비교/);
console.log('SKHY ADR official ratio, FX/KRX dates, premium, and optional message: PASS');
