import assert from 'node:assert/strict';
import {formatAiIndustryCloseLens} from './briefing-ai-industry-lens.mjs';
import {formatClose} from './telegram-close-workflow.mjs';

const date='2026-11-02',usDate='2026-10-30';
const nh=[
 {label:'S&P 500',symbol:'^GSPC',source:'NH_INDEX_DAILY',date:usDate,value:7580.07,changePercent:-1.82},
 {label:'NASDAQ',symbol:'^IXIC',source:'NH_INDEX_DAILY',date:usDate,value:25437,changePercent:-2.86},
 {label:'NASDAQ100',symbol:'^NDX',source:'NH_INDEX_DAILY',date:usDate,value:28384.85,changePercent:-3.46}
];
const secondary=[
 {label:'SOX',source:'FRED_NASDAQSOX',role:'NON_NH_REFERENCE_ONLY',date:usDate,value:8000,changePercent:-7.2},
 {label:'VIX',source:'CBOE_VIX_DAILY',role:'NON_NH_REFERENCE_ONLY',date:usDate,value:19.42,changePercent:5},
 {label:'다우존스',source:'FRED_DJIA',role:'NON_NH_REFERENCE_ONLY',date:usDate,value:51770.31,changePercent:-1}
];
const stockDates={SAMSUNG:date,SKHYNIX:date,NVDA:usDate,MU:usDate};
const stocks=Object.entries(stockDates).map(([id,d],i)=>({
 id,label:({SAMSUNG:'삼성전자',SKHYNIX:'SK하이닉스',NVDA:'엔비디아',MU:'마이크론'})[id],
 symbol:({SAMSUNG:'005930.KS',SKHYNIX:'000660.KS',NVDA:'NVDA',MU:'MU'})[id],
 date:d,value:100+i,source:'NH_REGULAR_CLOSE',changePercent:0
}));
const result=formatAiIndustryCloseLens({date,usDate,nh,secondary,stocks}).join('\n');
assert.match(result,/AI 산업 전체/);
assert.match(result,/기술주 상대약세 \(-1\.64%p\)/);
assert.match(result,/SOX -7\.20% \/ NASDAQ100 대비 -3\.74%p/);
assert.match(result,/주요 4종목 NH 확정 종가 4\/4/);
assert.match(result,/CAPEX.*클라우드 매출.*미연결/);
assert.match(result,/네트워크·광통신.*전력·냉각.*AI 소프트웨어/);
assert.match(result,/AI 설비투자 → HBM\/GPU 수요/);
assert.doesNotMatch(result,/AI 수요 급증|실제 주문 증가|AI 버블 확정/);

const missing=formatAiIndustryCloseLens({date,usDate,nh:nh.slice(0,1),
 secondary:secondary.slice(1),stocks:[]}).join('\n');
assert.match(missing,/방향 판단 유보/);
assert.match(missing,/상대강도 판단 유보/);
assert.match(missing,/0\/4/);
const wrongDates=formatAiIndustryCloseLens({date,usDate,nh:nh.map(x=>({...x,date:'2026-10-29'})),
 secondary:secondary.map(x=>({...x,date:'2026-10-29'})),stocks:stocks.map(x=>({...x,source:'YAHOO'}))}).join('\n');
assert.match(wrongDates,/방향 판단 유보/);
assert.match(wrongDates,/상대강도 판단 유보/);
assert.match(wrongDates,/0\/4/);

const domestic=[
 {type:'KOSPI',label:'KOSPI',date,value:5859.08,source:'FDR_KRX_CACHE',
 role:'NON_NH_DAILY_INDEX',priceType:'PUBLISHED_EOD_REFERENCE',changePercent:2.24},
 {type:'KOSDAQ',label:'KOSDAQ',date,value:734.36,source:'FDR_KRX_CACHE',
 role:'NON_NH_DAILY_INDEX',priceType:'PUBLISHED_EOD_REFERENCE',changePercent:1.38},
 {type:'KOSPI200',label:'KOSPI 200',date,value:920.63,source:'FDR_KRX_CACHE',
 role:'NON_NH_DAILY_INDEX',priceType:'PUBLISHED_EOD_REFERENCE',changePercent:2.32}
];
const macros=[
 {id:'USDKRW',label:'원/달러',symbol:'KRW=X',date:usDate,value:1337.98,
 changePercent:-0.18,source:'YAHOO_DAILY_REFERENCE'},
 {id:'DXY',label:'DXY',symbol:'DX-Y.NYB',date:usDate,value:101.88,
 changePercent:-0.16,source:'YAHOO_DAILY_REFERENCE'},
 {id:'UST10Y',label:'미 10년물',symbol:'^TNX',date:usDate,value:4.929,
 changePercent:-1.2,source:'YAHOO_DAILY_REFERENCE'}
];
const msg=formatClose(date,nh,secondary,domestic,stocks,macros,[]);
assert.ok(msg.startsWith('['+date+' 장후 시장 브리핑]'));
assert.ok(msg.indexOf('■ 먼저 보는 시장 해석')<msg.indexOf('■ 국내 시장'));
assert.match(msg,/■ 데이터 QC/);
assert.ok(msg.length<4000, 'AI commentary must not exceed Telegram 4000-char payload gate');
console.log('AI_BRIEFING_LENS_PASS verified/absent dates, value-chain, Telegram length');
