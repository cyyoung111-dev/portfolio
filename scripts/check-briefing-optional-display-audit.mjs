import assert from 'node:assert/strict';
import {summarizeOptionalDelivery} from './briefing-optional-display-audit.mjs';
import {formatFullMorningBriefing} from './telegram-morning-report.mjs';

const zero={futures:0,treasury:0,vkospi:0,turnover:0,breadth:0,liquidity:0};
const absent=summarizeOptionalDelivery('morning',zero,'날짜 검증 21/21');
assert.equal(absent.sourced,0);
assert.equal(absent.displayed,0);
assert.equal(absent.groups.treasury.status,'SOURCE_UNAVAILABLE');
assert.equal(summarizeOptionalDelivery('invalid',zero,'text'),null);
assert.equal(summarizeOptionalDelivery('morning',{...zero,futures:5},'text'),null);
assert.equal(summarizeOptionalDelivery('morning',zero,'x'.repeat(4001)),null);
assert.equal(summarizeOptionalDelivery('morning',null,'text'),null);

const fixtures={
 futures:'미국 선물 참고: ES 7,000 (07:25) [KST · Yahoo 지연 시세, 1/4]',
 treasury:'미 국채 2Y 4.00% [2026-11-09] · 3Y 4.10% [2026-11-09]',
 vkospi:'VKOSPI: 24.20 [2026-11-09 · KRX 참고]',
 turnover:'지수 구성종목 거래대금: KOSPI 35.00조원 [2026-11-09 · KRX]',
 breadth:'시장폭 A/D: KOSPI 1024↑/1250↓/50→ [2026-11-09 · KRX 참고]',
 liquidity:'시장자금: 예탁금 90.33조(11-06) · 신용융자 28.39조(11-06) [금투협 FreeSIS · 기준일별]'
};
const counts={futures:1,treasury:2,vkospi:1,turnover:1,breadth:1,liquidity:2};
const date='2026-11-10';
const report=formatFullMorningBriefing(date,null,[],{
 now:new Date(date+'T07:40:00+09:00'),supplements:fixtures
});
assert.match(report,/미국 선물 참고:/);
assert.match(report,/VKOSPI: 24\.20/);
const summary=summarizeOptionalDelivery('morning',counts,report);
assert.equal(summary.sourced,6);
assert.equal(summary.groups.futures.status,'PARTIAL_DISPLAYED');
assert.equal(summary.groups.vkospi.status,'DISPLAYED');
assert.equal(summary.groups.liquidity.status,'DISPLAYED');
assert.equal(summary.displayed,6);
assert.ok(!JSON.stringify(summary).includes('90.33'));
assert.ok(!JSON.stringify(summary).includes('7,000'));
const without=report.replace(fixtures.futures,'');
const omitted=summarizeOptionalDelivery('morning',counts,without);
assert.equal(omitted.groups.futures.status,'NOT_DISPLAYED');
assert.equal(omitted.groups.liquidity.status,'DISPLAYED');
assert.equal(omitted.sourced,6);
const invalidQuote=summarizeOptionalDelivery('morning',
 {...zero,vkospi:1},'VKOSPI: 당일 확정치 미확보');
assert.equal(invalidQuote.groups.vkospi.status,'NOT_DISPLAYED');

const closeCounts={futures:2,treasury:3,vkospi:1,turnover:1,liquidity:1};
const closing='■ 장후 글로벌 반응 — 미국 지수선물 (지연 시세)\n'
 +'S&P500 선물: 7000pt [17:00 KST · Yahoo 참고]\n'
 +'미 국채 2년: 4.00% [2026-11-09]\n'
 +'VKOSPI: 26.05 [2026-11-10 · KRX]\n'
 +'KOSPI 거래대금: 31.20조원 [2026-11-10 · KRX]\n';
const close=summarizeOptionalDelivery('close',closeCounts,closing);
assert.equal(close.sourced,5);
assert.equal(close.groups.futures.status,'PARTIAL_DISPLAYED');
assert.equal(close.groups.treasury.status,'DISPLAYED');
assert.equal(close.groups.turnover.status,'PARTIAL_DISPLAYED');
assert.equal(close.groups.liquidity.status,'NOT_DISPLAYED');
assert.equal(close.displayed,4);
assert.equal(summarizeOptionalDelivery('close',{...closeCounts,treasury:-1},closing),null);
console.log('OPTIONAL_DISPLAY_AUDIT_PASS core_denom_separate source_vs_render partial_and_budget_omission privacy');
