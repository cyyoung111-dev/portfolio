import assert from 'node:assert/strict';
import {prepareNhCloseBriefing,auditNhCloseNextDay} from './nhplug-close-briefing-contract.mjs';

const tradingDate='2026-10-29';
const asOf='2026-10-29T16:00:00+09:00';
const expected=[
 {code:'005930',name:'삼성전자',kind:'STOCK',priorClose:70000,priorCloseVerified:true},
 {code:'069500',name:'KODEX 200',kind:'ETF',priorClose:30000,priorCloseVerified:false},
 {code:'0046Y0',name:'배당 ETF',kind:'ETF'},
];
const obs=(code,price,changes={})=>({
 code,price,source:'NH_PLUG',market:'KRX',session:'REGULAR',
 priceScope:'KRX_REGULAR',priceKind:'DAILY_REGULAR_CLOSE',tradingDate,sourceDate:tradingDate,
 receivedAt:'2026-10-29T15:40:00+09:00',officialFinal:false,...changes,
});
const prepared={tradingDate,expected,asOf,observations:[
 obs('005930','71300'),obs('069500',31000),obs('0046Y0',10010),
]};
const ok=prepareNhCloseBriefing(prepared);
assert.equal(ok.status,'SOURCE_ROWS_PRESENT_FINALITY_UNVERIFIED');
assert.equal(ok.received,3);assert.equal(ok.missing,0);
assert.match(ok.message,/종목 수집 3\/3 · 미확보 0/);
assert.match(ok.message,/삼성전자 \(005930\): 71,300원 \(\+1\.86%\)/);
assert.match(ok.message,/KODEX 200 \(069500\): 31,000원/);
assert.doesNotMatch(ok.message,/KODEX 200.*\([+-]?\d+\.\d+%\)/);
assert.match(ok.message,/배당 ETF \(0046Y0\): 10,010원/);
assert.match(ok.message,/NH PLUG 당일 정규장 종가 · KRX\/Yahoo 익거래일 사후 대조/);
assert.match(ok.message,/시장지수·계좌 평가손익: 별도 검증된 원천 연동 전/);
assert.ok(Object.isFrozen(ok));

const missing=prepareNhCloseBriefing({...prepared,observations:[
 obs('005930',71300),obs('069500',30000,{tradingDate:'2026-10-28'}),
]});
assert.equal(missing.status,'INCOMPLETE');assert.equal(missing.missing,2);
assert.match(missing.message,/종목 수집 1\/3/);
assert.match(missing.message,/KODEX 200 \(069500\): 미확보/);
assert.doesNotMatch(missing.message,/30,000원/);

for (const bad of [
 {source:'OTHER'}, {market:'NXT'}, {session:'AFTER'}, {priceScope:'NXT_AFTER'},
 {priceKind:'REALTIME'}, {officialFinal:true}, {price:0}, {price:-1},
 {price:'7,100'}, {price:'NaN'}, {receivedAt:'2026-10-29T15:29:59+09:00'},
 {receivedAt:'2026-10-29T16:00:01+09:00'}, {receivedAt:'2026-10-29T15:40:00'},
 {tradingDate:'2026-10-28'}, {sourceDate:'2026-10-28'},
 {officialFinal:undefined}, {code:'999999'},
]){
 const got=prepareNhCloseBriefing({...prepared,observations:[obs('005930',71300,bad)]});
 assert.equal(got.received,0,'reject wrong source/market/date/price/time/contract');
 assert.doesNotMatch(got.message,/71,300원/);
}
const duplicate=prepareNhCloseBriefing({...prepared,observations:[obs('005930',71300),obs('005930',72500)]});
assert.equal(duplicate.received,0);
assert.match(duplicate.message,/삼성전자 \(005930\): 미확보/);
assert.throws(()=>prepareNhCloseBriefing({...prepared,asOf:'2026-10-29T15:29:59+09:00'}),/CLOSE_OUTSIDE_DELIVERY_WINDOW/);
assert.throws(()=>prepareNhCloseBriefing({...prepared,asOf:'2026-10-29T16:10:01+09:00'}),/CLOSE_OUTSIDE_DELIVERY_WINDOW/);
assert.throws(()=>prepareNhCloseBriefing({...prepared,asOf:'2026-10-29T16:00:00'}),/CLOSE_AS_OF_INVALID/);
assert.throws(()=>prepareNhCloseBriefing({...prepared,asOf:'2026-10-30T16:00:00+09:00'}),/CLOSE_AS_OF_DATE_MISMATCH/);
assert.throws(()=>prepareNhCloseBriefing({...prepared,tradingDate:'2026-10-09'}),/CLOSE_TRADING_DATE_NOT_OPEN/);
assert.throws(()=>prepareNhCloseBriefing({...prepared,tradingDate:'2026-10-31'}),/CLOSE_TRADING_DATE_NOT_OPEN/);
assert.throws(()=>prepareNhCloseBriefing({...prepared,tradingDate:'2026-02-30'}),/CLOSE_TRADING_DATE_NOT_OPEN/);
assert.throws(()=>prepareNhCloseBriefing({...prepared,expected:[]}),/CLOSE_INPUT_INVALID/);
assert.throws(()=>prepareNhCloseBriefing({...prepared,expected:[expected[0],expected[0]]}),/CLOSE_EXPECTED_UNVERIFIED/);
assert.throws(()=>prepareNhCloseBriefing({...prepared,expected:[{...expected[0],name:'bad\nvalue'}]}),/CLOSE_EXPECTED_UNVERIFIED/);
assert.throws(()=>prepareNhCloseBriefing({...prepared,expected:[{...expected[0],code:'0695003'}]}),/CLOSE_EXPECTED_UNVERIFIED/);

const before=JSON.stringify(prepared);
prepareNhCloseBriefing(prepared);
assert.equal(JSON.stringify(prepared),before,'dry-run contract must not mutate input');

const closeDate='2026-10-29',auditAt='2026-10-30T08:10:00+09:00';
const baseNh=[
 {code:'005930',source:'NH_REGULAR_CLOSE',priceType:'REGULAR_CLOSE',status:'CONFIRMED',
  usedDate:closeDate,marketDate:closeDate,currency:'KRW',price:232000},
 {code:'AAPL',source:'NH_REGULAR_CLOSE',priceType:'REGULAR_CLOSE',status:'CONFIRMED',
  usedDate:closeDate,marketDate:closeDate,currency:'USD',price:348.91},
];
const verifiedKRX={code:'005930',source:'KRX_OFFICIAL',price:232000,date:closeDate,
 currency:'KRW',completed:true,publishedAt:auditAt};
const verifiedYahoo={code:'AAPL',source:'YAHOO_DAILY_CLOSE',price:349,date:closeDate,
 currency:'USD',completed:true,adjusted:false,publishedAt:auditAt};
const auditInput={tradingDate:closeDate,asOf:auditAt,nhRows:baseNh,
  krxRows:[verifiedKRX],yahooRows:[verifiedYahoo]};
const auditOriginal=JSON.stringify(auditInput);
const audited=auditNhCloseNextDay(auditInput);
assert.equal(audited.purpose,'NEXT_DAY_READ_ONLY_AUDIT');
assert.equal(audited.writesPerformed,0);
assert.equal(audited.originalNhPreserved,true);
assert.equal(audited.results.find(x=>x.code==='005930').krx.status,'MATCH');
assert.equal(audited.results.find(x=>x.code==='AAPL').yahoo.status,'DIFFERENCE');
assert.ok(Math.abs(audited.results.find(x=>x.code==='AAPL').yahoo.delta-.09)<1e-8);
assert.equal(audited.results.find(x=>x.code==='AAPL').nhPrice,348.91);
assert.equal(audited.results.find(x=>x.code==='AAPL').krx.status,'NOT_APPLICABLE');
assert.equal(JSON.stringify(auditInput),auditOriginal,'independent audit cannot alter NH or comparison evidence');
assert.throws(()=>auditNhCloseNextDay({...auditInput,asOf:'2026-10-30T07:59:59+09:00'}),
 /NH_AUDIT_BEFORE_NEXT_PUBLICATION/);
for(const invalid of [
 {...auditInput,krxRows:[{...verifiedKRX,date:'2026-10-28'}]},
 {...auditInput,krxRows:[{...verifiedKRX,completed:false}]},
 {...auditInput,krxRows:[{...verifiedKRX,publishedAt:'2026-10-29T16:00:00+09:00'}]},
 {...auditInput,krxRows:[verifiedKRX,verifiedKRX]},
])assert.equal(auditNhCloseNextDay(invalid).results.find(x=>x.code==='005930').krx.status,'NOT_VERIFIED');
for(const invalid of [
 {...auditInput,yahooRows:[{...verifiedYahoo,adjusted:true}]},
 {...auditInput,yahooRows:[{...verifiedYahoo,date:'2026-10-28'}]},
 {...auditInput,yahooRows:[{...verifiedYahoo,completed:false}]},
 {...auditInput,yahooRows:[verifiedYahoo,verifiedYahoo]},
])assert.equal(auditNhCloseNextDay(invalid).results.find(x=>x.code==='AAPL').yahoo.status,'NOT_VERIFIED');
assert.equal(auditNhCloseNextDay({...auditInput,nhRows:[baseNh[0],baseNh[0]]})
 .results[0].status,'NH_INVALID_OR_DUPLICATE');

console.log('NH 16:00 close briefing and next-day read-only audit contract tests passed');
