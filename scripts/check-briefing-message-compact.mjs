import assert from 'node:assert/strict';
import {compactBriefingForDelivery} from './briefing-message-compact.mjs';
import {sendTelegram} from './telegram-morning-briefing.mjs';

const morning=[
 '[한국장 장전 종합 브리핑 | 2026-11-10]',
 '■ 2. 전일 한국장',
 'KOSPI: 5,000.00 [2026-11-09 · FDR 참고]',
 'KOSDAQ: 미확보',
 '■ 4. 코스피200 야간선물 (06:00)',
 '코스피200 야간선물: 당일 참고값 미확보',
 '■ 5. 환율 / 금리 / 변동성',
 '원/달러: 1,420.00 [2026-11-09 · Yahoo 참고]',
 '미 10년물: 미확보 (금리 단위 검증 필요)',
 '■ 6. 원자재 / 가상자산',
 'WTI: 미확보',
 'BTC: 미확보',
 '■ 8. AI 산업·반도체 종합평가 (전일 일봉 기반)',
 '• 실수요: 빅테크 CAPEX·GPU/HBM 주문·AI 수익화·재고 실측 미연결 → 업황 확정 불가.',
 '• 상대강도: SOX +1.00% / NASDAQ100 +0.50%',
 '■ QC: 기준 거래일과 일치한 일봉 2/21 · 야간선물 미확보'
].join('\n');
const mc=compactBriefingForDelivery(morning,{mode:'morning'});
assert.match(mc,/KOSPI: 5,000\.00/);
assert.match(mc,/원\/달러: 1,420\.00/);
assert.match(mc,/■ QC: 기준 거래일과 일치한 일봉 2\/21/);
assert.doesNotMatch(mc,/■ QC:[^\n]*야간선물 미확보/);
for(const text of ['KOSDAQ: 미확보','WTI: 미확보','BTC: 미확보',
 '미 10년물: 미확보','■ 6. 원자재','■ 4. 코스피200 야간선물','• 실수요:'])
 assert.ok(!mc.includes(text),'do not print unavailable market row: '+text);

// Pin the three source-labelled US closes to the top of either briefing.
// A material-move headline appears ONLY when an existing dated row changes
// by >= 2%, never for missing prices or ordinary daily fluctuations.
const headlineMessage=[
 '[한국장 장전 종합 브리핑 | 2026-11-16]',
 '기준: 07:30 KST · 기준일별 종가',
 '■ 1. 오늘의 결론 / 시장 국면',
 '위험선호 신호 우세',
 '■ 2. 밤사이 미국장 / 반도체',
 'NASDAQ100: 22,300 (+0.20%) [2026-11-13 · NH PLUG]',
 'SOX: 11,000 (+0.30%) [2026-11-13 · Yahoo 참고]',
 '다우존스: 48,200 (-2.10%) [2026-11-13 · Yahoo 참고]',
 'S&P 500: 6,800 (+2.50%) [2026-11-13 · NH PLUG]',
 '■ QC: 기준 거래일과 일치한 일봉 21/21 · 야간선물 미확보'
].join('\n');
for(const mode of ['morning','close']){
 const result=compactBriefingForDelivery(headlineMessage,{mode});
 const lines=result.split('\n');
 assert.ok(lines.indexOf('■ 미국 주요 3지수 (직전 완료장)')
   <lines.indexOf('■ 1. 오늘의 결론 / 시장 국면'));
 const indices=['S&P 500','다우존스','NASDAQ100'];
 const starts=indices.map(name=>lines.findIndex(row=>row.startsWith(name+': ')));
 assert.deepEqual(starts,[3,4,5]);
 for(const name of indices)
  assert.equal(lines.filter(row=>row.startsWith(name+': ')).length,1,
   'no duplicated US index quote '+name);
 assert.match(result,/S&P 500: 6,800 \(\+2\.50%\) \[2026-11-13 · NH PLUG\]/);
 assert.match(result,/다우존스: 48,200 \(-2\.10%\) \[2026-11-13 · Yahoo 참고\]/);
 assert.match(result,/주요 변동: S&P 500 \+2\.50% · 다우존스 -2\.10%/);
 assert.match(result,/SOX: 11,000/,'do not remove unrelated verified source');
}
const quiet=compactBriefingForDelivery(
 headlineMessage.replace('+2.50%','+1.99%').replace('-2.10%','-1.99%'),{mode:'morning'});
assert.doesNotMatch(quiet,/주요 변동:/,'no unconditional daily highlight');
const oneMissing=compactBriefingForDelivery(
 headlineMessage.replace('다우존스: 48,200 (-2.10%) [2026-11-13 · Yahoo 참고]',
 '다우존스: 미확보'),{mode:'morning'});
assert.match(oneMissing,/다우존스: 미확보/,
 'keep the fixed three-index slot without manufacturing a close');
assert.doesNotMatch(oneMissing,/주요 변동:.*다우존스/);
const noDate=compactBriefingForDelivery(
 headlineMessage.replace('S&P 500: 6,800 (+2.50%) [2026-11-13 · NH PLUG]',
 'S&P 500: 6,800 (+2.50%) [날짜 미확인]'),{mode:'morning'});
assert.doesNotMatch(noDate,/주요 변동: S&P 500 /,
 'do not highlight a percentage without a dated source label');

// Optional morning data that are normally unpublished or outside the source
// window must not produce static missing-value paragraphs every trading day.
// A partially verified market-breadth row must remain visible.
const supplementary=[morning,
 '미국 선물 ES/NQ/YM/RTY: 최근 검증된 시세 미확보',
 'VKOSPI: 확정 기준일 자료 미확보',
 'KOSPI·KOSDAQ 거래대금: 공식 기준일 자료 미확보',
 '시장폭 A/D: KOSPI 미확보 · KOSDAQ 미확보 (공식 일봉 미검증)',
 '시장폭 A/D: KOSPI 100↑/50↓/10→ · KOSDAQ 미확보 [2026-11-09 · KRX 참고]'
].join('\n');
const supple=compactBriefingForDelivery(supplementary,{mode:'morning'});
for(const missingRow of ['최근 검증된 시세 미확보','확정 기준일 자료 미확보',
 '공식 기준일 자료 미확보','KOSPI 미확보 · KOSDAQ 미확보'])
 assert.ok(!supple.includes(missingRow),'no repetitive optional unverified row');
assert.match(supple,/시장폭 A\/D: KOSPI 100↑\/50↓\/10→ · KOSDAQ 미확보/,
 'do not discard partial verified A/D readings');
assert.match(supple,/■ QC: 기준 거래일과 일치한 일봉 2\/21/,
 'never hide core coverage when optional providers are unavailable');

const close=[
 '[2026-11-10 장후 시장 브리핑]',
 '■ 국내 시장 (당일 종가)',
 'KOSPI: 5,030.50 [2026-11-10 · KRX]',
 'KOSDAQ: 검증된 당일 종가 미확보',
 'VKOSPI: 당일 확정치 미확보',
 'KOSPI 지수 구성종목 거래대금: 공식 당일 자료 미확보',
 'VKOSPI 직전 공표: 24.20 [2026-11-09 · KRX]',
 '■ 장후 글로벌 반응 — 미국 지수선물 (지연 시세)',
 '유효한 최근 거래값 미확보 — 직전 미국 현물 종가를 현재값으로 대체하지 않음',
 '확보 0/4 · 실시간 확정값이 아니며, 지수선물과 현물지수는 서로 다릅니다.',
 '■ 미국 국채금리 (FRED H.15 · 최근 발표 관측일)',
 '미 국채 2년: 최근 허용 관측일 자료 미확보',
 '미 국채 3년: 최근 허용 관측일 자료 미확보',
 '장단기금리차 (10Y–2Y): 동일 기준일 자료 미확보',
 '■ 원자재·BTC (Yahoo 완료 일봉 참고 · 실시간/공식 정산가 아님)',
 'WTI: 검증된 완료 일봉 미확보',
 'BTC: 70,000.00 USD [2026-11-09 · UTC 일봉]',
 '■ 데이터 확인: 핵심지수 3/6 (국내 1/3 · 미국 2/3) · 참고 0/3 · 주요 종목 0/4 · KRX 지수 구성 거래대금 0/2 · 수급 1/1 · 시장자금 0/2',
 '미확보: KOSDAQ · VKOSPI 외 17개',
 '미연결 참고지표: 3개'
].join('\n');
const cc=compactBriefingForDelivery(close,{mode:'close'});
assert.ok(cc.includes('VKOSPI 직전 공표: 24.20 [2026-11-09 · KRX]'));
assert.doesNotMatch(cc,/공식 당일 자료 미확보/);
assert.match(cc,/KOSPI: 5,030\.50/);
assert.match(cc,/BTC: 70,000\.00/);
assert.match(cc,/핵심지수 3\/6/);
assert.match(cc,/수급 1\/1/);
for(const text of ['KOSDAQ:','VKOSPI:','미 국채 2년:','장단기금리차',
 '유효한 최근 거래값 미확보','확보 0/4',
 '■ 장후 글로벌 반응','■ 미국 국채금리','미확보:','미연결 참고지표:',
 '참고 0/3','시장자금 0/2','KRX 지수 구성 거래대금 0/2'])
 assert.ok(!cc.includes(text),'no placeholder or zero-only section: '+text);
assert.match(cc,/■ 원자재·BTC/,'one valid item retains the section');
assert.throws(()=>compactBriefingForDelivery(123,{mode:'close'}),/COMPACT_INPUT_INVALID/);
assert.throws(()=>compactBriefingForDelivery('x',{mode:'bad'}),/COMPACT_INPUT_INVALID/);
// Only production Telegram transport should filter. Injected mock renderers
// retain their original data for existing regression and operational QC.
const outbound=[];
const sendOptions={fetchImpl:async(_url,opts)=>{
 outbound.push(JSON.parse(opts.body).text);
 return {ok:true,json:async()=>({ok:true})};
}};
await sendTelegram('123:abcdefghijklmnopqrstuvwxyz','12345',morning,sendOptions);
await sendTelegram('123:abcdefghijklmnopqrstuvwxyz','12345',close,sendOptions);
await sendTelegram('123:abcdefghijklmnopqrstuvwxyz','12345','시험',sendOptions);
assert.deepEqual(outbound,[mc,cc,'시험']);
// Regression: a real raw report can exceed 5k when many optional inputs are
// missing. The transport must compact rather than bypass and resend the raw
// repetitive diagnostics. The valid observations and core QC must remain.
const longMorning=morning+'\n'+Array.from({length:500},
  ()=>'KOSDAQ: 미확보').join('\n');
const longClose=close+'\n'+Array.from({length:500},
  ()=>'VKOSPI: 당일 확정치 미확보').join('\n');
assert.ok(longMorning.length>5000&&longClose.length>5000);
for(const [raw,mode,mustKeep] of [
 [longMorning,'morning',/■ QC: 기준 거래일/],
 [longClose,'close',/KOSPI: 5,030\.50/]
]){
 const compact=compactBriefingForDelivery(raw,{mode});
 assert.ok(compact.length<4000,'long raw diagnostics must fit Telegram after cleanup');
 assert.match(compact,mustKeep,'verified core data and QC cannot be dropped');
 assert.ok(!compact.includes('KOSDAQ: 미확보'));
 assert.ok(!compact.includes('VKOSPI: 당일 확정치 미확보'));
 await sendTelegram('123:abcdefghijklmnopqrstuvwxyz','12345',raw,sendOptions);
 assert.equal(outbound.at(-1),compact,'transport must send compacted payload');
}
assert.equal(outbound.length,5);

console.log('BRIEFING_MESSAGE_COMPACT_PASS preserve_verified_values_and_core_qc_no_empty_optional_sections');
