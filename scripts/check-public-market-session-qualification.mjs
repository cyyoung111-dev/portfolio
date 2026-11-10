import assert from 'node:assert/strict';
import {qualifyPublicMarketQuote as qualify} from './qualify-public-market-session.mjs';
const day='2026-11-10';
const index=qualify({itemCode:'KOSPI',stockExchangeType:{code:'KRX'},
 marketStatus:{code:'CLOSE'},localTradedAt:day+'T16:15:00+09:00',
 closePrice:'4,000.00',accumulatedTradingValueRaw:'12345'},day);
assert.equal(index.exchange,'KRX');
assert.equal(index.qualification,'INDEX_CLOSE_REFERENCE_NOT_KRX_RECONCILED');
assert.equal(index.hasSameDayDirectQuote,true);
assert.equal(index.tradingValueScope,'INDEX_COMPONENT_SCOPE_UNRECONCILED');
assert.notEqual(index.qualification,'KRX_OFFICIAL_FINAL');
const stock=qualify({itemCode:'005930',marketStatus:'OPEN',
 localTradedAt:day+'T18:12:22+09:00',closePrice:'100000',
 nxtOverMarketPriceInfo:{localTradedAt:day+'T18:13:00+09:00'}},day);
assert.equal(stock.qualification,'SESSION_OR_PRICE_UNVERIFIED');
assert.equal(stock.hasNxtOverlay,true);
assert.equal(stock.hasSameDayDirectQuote,true);
const nestedOnly=qualify({cd:'000660',aa:'100000000',
 nxtOverMarketPriceInfo:{localTradedAt:day+'T18:13:00+09:00'}},day);
assert.equal(nestedOnly.at,null);
assert.equal(nestedOnly.hasSameDayDirectQuote,false);
assert.equal(nestedOnly.qualification,'NO_DIRECT_KST_QUOTE_TIMESTAMP');
assert.equal(qualify({itemCode:'KOSDAQ',marketStatus:'CLOSE',
 localTradedAt:'2026-11-09T16:15:00+09:00',closePrice:'101'},day).qualification,
 'QUOTE_DATE_MISMATCH');
assert.equal(qualify({itemCode:'KPI200',marketStatus:'CLOSE',
 localTradedAt:day+'T16:15:00',closePrice:'101'},day).qualification,
 'NO_DIRECT_KST_QUOTE_TIMESTAMP');
assert.equal(qualify({localTradedAt:day+'T16:15:00+09:00',closePrice:'101'},day),null);
assert.equal(qualify({itemCode:'KOSPI',marketStatus:'OPEN',
 localTradedAt:day+'T16:15:00+09:00',closePrice:'101'},day).qualification,
 'SESSION_OR_PRICE_UNVERIFIED');
assert.equal(qualify({itemCode:'KOSPI',marketStatus:'CLOSE',
 localTradedAt:day+'T16:15:00+09:00'},day).qualification,
 'SESSION_OR_PRICE_UNVERIFIED');
console.log('PUBLIC_MARKET_SESSION_QUALIFICATION_PASS');
const {qualifyPublicStockDailyReference:daily}=await import('./qualify-public-market-session.mjs');
const old=[{localTradedAt:'2026-11-09',closePrice:'98,000'}];
const today=[{localTradedAt:day,closePrice:'99,000'},...old];
const valid=daily(today,'NAVER_STOCK_DAILY_SAMSUNG',day);
assert.equal(valid.code,'005930');
assert.equal(valid.latestBarDate,day);
assert.equal(valid.hasExactDateBar,true);
assert.equal(valid.classification,'PUBLIC_DAILY_CLOSE_REFERENCE_NOT_KRX_RECONCILED');
assert.equal(valid.sourcePublishedAt,null);
assert.equal(daily(old,'NAVER_STOCK_DAILY_SAMSUNG',day).hasExactDateBar,false);
assert.equal(daily([...today,today[0]],'NAVER_STOCK_DAILY_HYNIX',day).hasExactDateBar,false);
assert.equal(daily([{localTradedAt:day,closePrice:null}],'NAVER_STOCK_DAILY_HYNIX',day).hasExactDateBar,false);
assert.equal(daily(today,'UNKNOWN_SOURCE',day),null);
assert.equal(daily({bad:true},'NAVER_STOCK_DAILY_HYNIX',day).classification,'DAILY_BAR_SCHEMA_UNVERIFIED');
console.log('PUBLIC_STOCK_DAILY_REFERENCE_QUALIFICATION_PASS');
