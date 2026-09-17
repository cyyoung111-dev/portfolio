import assert from 'node:assert/strict';
import master from '../src/web/domain/market/market_briefing_master.js';
import norm from '../src/web/domain/market/market_briefing_provider_normalizer.js';
const meta={tradingDate:'2026-09-18',receivedAt:'2026-09-18T07:00:00+09:00'};
const payload={KOSPI:{value:3400,source:'TOSS',timestamp:'2026-09-17T15:30:00+09:00'},KOSDAQ:{price:900,source:'TOSS'},KOSPI200:{close:500,source:'TOSS'},SP500:{value:6600,source:'YAHOO',timestamp:'2026-09-17T16:00:00-04:00'},NASDAQ100:{value:24000,source:'YAHOO',delayed:true},SOX:{value:6200,source:'YAHOO',delayed:true},VIX:{value:15,source:'CBOE'},USDKRW:{value:1380,source:'TOSS'}};
const rows=norm.normalizeMap(payload,meta); assert.equal(rows.length,8); assert.equal(rows.find(x=>x.seriesId==='SPX').source,'YAHOO'); assert.equal(rows.find(x=>x.seriesId==='NDX').status,'DELAYED'); assert.equal(rows.find(x=>x.seriesId==='KOSDAQ').observedAt,null);
const ingested=norm.ingest(master,[],payload,meta); assert.equal(ingested.length,8); assert.equal(ingested.find(x=>x.seriesId==='KOSDAQ').timestampQuality,'RECEIVE_ONLY');
const cutoff=master.buildBriefingSnapshot(ingested,'2026-09-18','MORNING',['KOSPI','SPX','NDX']); assert.equal(cutoff.values.KOSPI.value,3400); assert.equal(cutoff.values.NDX.status,'DELAYED');
console.log('브리핑 provider → MARKET MASTER 정규화 회귀검사 통과');
