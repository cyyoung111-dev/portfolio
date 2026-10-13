import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/features/settings/settings_fetch.js', 'utf8');
const portfolioSource = fs.readFileSync('src/web/domain/portfolio/portfolio_service.js', 'utf8');
const polling = source.match(/async function pollCurrentPrices\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
const recompute = portfolioSource.match(/function recomputeRows\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
if (!polling || !recompute
    || !/document\.hidden/.test(polling[1])
    || !/persist:\s*false/.test(polling[1])
    || !/저장 이력\/Snapshot 미변경/.test(polling[1])
    || !/마지막 정상값 유지/.test(polling[1])
    || !/setInterval\(pollCurrentPrices,\s*60\s*\*\s*1000\)/.test(source)
    || !/visibilitychange/.test(source)
    || !/startPricePolling\(\)/.test(source)) {
  console.error('❌ 현재가 polling의 비영속·hidden 중단·실패시 캐시 보존 경로가 없습니다.');
  process.exit(1);
}
if (!/async function fetchFromGsheet\(dateStr, options\)/.test(source)
    || !/const requestKey = targetUrl \+ '\\|' \+ generation \+ '\\|' \+ dateStr/.test(source)
    || !/_fetchFromGsheetInner\(dateStr, \{ \.\.\.\(options \|\| \{\}\), targetUrl, generation \}\)/.test(source)) {
  console.error('❌ polling/수동조회 옵션과 GAS 연결 식별자가 실제 요청에 전달되지 않습니다.');
  process.exit(1);
}

// Extract actual production functions; the mocked portfolio computation has
// explicit price * quantity semantics, not just a counter for recomputeRows.
const pollSource = 'async function pollCurrentPrices() {' + polling[1] + '\n}';
const recomputeSource = 'function recomputeRows() {' + recompute[1] + '\n}';
const testPoll = async ({ view = 'gsheet', hidden = false, response = { '005930': 12345 }, fail = false } = {}) => {
  let networkCount = 0, repaintCount = 0, summaryCount = 0, cacheInvalidations = 0;
  let persistedCount = 0;
  const cache = { '005930': 1000 };
  const rows = [];
  const rawHoldings = [{ code:'005930', qty:2, costAmt:12000 }];
  const context = vm.createContext({
    document:{ hidden }, GSHEET_API_URL:'https://script.google.com/macros/s/test/exec',
    currentView:view, savedPrices:cache, rows, rawHoldings,
    fetchFromGsheet:async (date, opts) => {
      networkCount++;
      assert.equal(opts.persist, false);
      assert.equal(opts.polling, true);
      if (fail) throw Error('network failure');
      return response;
    },
    getDateStr:()=> '2026-10-12', updateDateBadge:()=>{},
    _priceLookupSummary:()=> 'test', _priceStatusLayout:(head)=>head,
    setStatusLabel:()=>{},
    computeRows:holdings => holdings.map(h => ({
      evalAmt:cache[h.code] * h.qty, costAmt:h.costAmt, pnl:cache[h.code] * h.qty - h.costAmt
    })),
    invalidateViewCache:()=>{ cacheInvalidations++; },
    renderSummary:()=>{ summaryCount++; },
    // Other views keep the existing refreshAll contract. A Settings view must
    // never call it because that remounts the automation-status panel.
    refreshAll:()=> {
      repaintCount++;
      vm.runInContext('recomputeRows()', context);
      cacheInvalidations++;
      summaryCount++;
    },
    savePriceCache:()=>{ persistedCount++; },
    console:{ warn:()=>{} }
  });
  vm.runInContext(recomputeSource + '\n' + pollSource, context);
  await vm.runInContext('pollCurrentPrices()', context);
  return {networkCount,repaintCount,summaryCount,cacheInvalidations,persistedCount,cache,rows};
};

const settings = await testPoll({view:'gsheet'});
assert.equal(settings.networkCount,1,'설정 화면에서도 현재가 조회');
assert.equal(settings.repaintCount,0,'설정 패널 자동화 상태 DOM 보존');
assert.equal(settings.summaryCount,1,'설정 중에도 공통 상단 평가금액 갱신');
assert.equal(settings.cacheInvalidations,1,'설정 중에도 탭/차트 캐시 무효화');
assert.equal(settings.rows[0].evalAmt,24690,'설정→계좌/섹터 이동 전 rows 평가금액 갱신');
assert.equal(settings.rows[0].pnl,12690,'평가손익도 새로운 가격으로 갱신');
assert.equal(settings.cache['005930'],12345);
assert.equal(settings.persistedCount,0,'polling에서 localStorage/GAS 가격이력 저장 금지');

const account = await testPoll({view:'acct'});
assert.equal(account.networkCount,1);
assert.equal(account.repaintCount,1,'계좌 화면에서는 전체 새로 그리기');
assert.equal(account.rows[0].evalAmt,24690);
assert.equal(account.cacheInvalidations,1);
assert.equal(account.summaryCount,1);

const hidden = await testPoll({view:'gsheet',hidden:true});
assert.equal(hidden.networkCount,0,'숨겨진 브라우저 탭에서는 polling 요청 차단');
assert.equal(hidden.repaintCount,0);
assert.equal(hidden.summaryCount,0);
assert.equal(hidden.cacheInvalidations,0);
assert.equal(hidden.cache['005930'],1000);

for (const options of [{view:'gsheet',response:null},{view:'gsheet',fail:true}]) {
  const unsuccessful = await testPoll(options);
  assert.equal(unsuccessful.rows.length,0,'조회 실패 시 새 파생 계산을 하지 않음');
  assert.equal(unsuccessful.cache['005930'],1000,'조회 실패 시 마지막 정상가격 유지');
  assert.equal(unsuccessful.summaryCount,0);
  assert.equal(unsuccessful.cacheInvalidations,0);
  assert.equal(unsuccessful.repaintCount,0);
}
console.log('✅ 현재가 polling 설정 탭 rows·손익·캐시 갱신, DOM 보존, 비영속성, 실패/hidden 회귀 통과');
