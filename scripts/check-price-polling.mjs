import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const source = fs.readFileSync('src/web/features/settings/settings_fetch.js', 'utf8');
const polling = source.match(/async function pollCurrentPrices\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
if (!polling
    || !/document\.hidden/.test(polling[1])
    || !/persist:\s*false/.test(polling[1])
    || !/저장 이력\/Snapshot 미변경/.test(polling[1])
    || !/마지막 정상값 유지/.test(polling[1])
    || !/setInterval\(pollCurrentPrices,\s*60\s*\*\s*1000\)/.test(source)
    || !/visibilitychange/.test(source)
    || !/startPricePolling\(\)/.test(source)) {
  console.error('❌ 현재가 polling의 hidden 중단·persist=false·실패 시 마지막 정상값 유지 경로가 없습니다.');
  process.exit(1);
}

if (!/async function fetchFromGsheet\(dateStr, options\)/.test(source)
    || !/const requestKey = targetUrl \+ '\\|' \+ generation \+ '\\|' \+ dateStr/.test(source)
    || !/_fetchFromGsheetInner\(dateStr, \{ \.\.\.\(options \|\| \{\}\), targetUrl, generation \}\)/.test(source)) {
  console.error('❌ polling/수동조회 옵션과 연결 target/generation이 실제 GAS 요청 경로로 함께 전달되지 않습니다.');
  process.exit(1);
}


const pollSource = 'async function pollCurrentPrices() {' + polling[1] + '\n}';
const testPoll = async (view, hidden = false) => {
  let networkCount = 0, repaintCount = 0;
  const cache = {};
  const context = vm.createContext({
    document: { hidden }, GSHEET_API_URL:'https://script.google.com/macros/s/test/exec',
    currentView:view, savedPrices:cache,
    fetchFromGsheet:async (date, opts) => {
      networkCount++;
      assert.equal(opts.persist, false);
      assert.equal(opts.polling, true);
      return { '005930': 12345 };
    },
    getDateStr:()=> '2026-10-12', updateDateBadge:()=>{},
    _priceLookupSummary:()=> 'test', _priceStatusLayout:(head)=>head,
    setStatusLabel:()=>{}, refreshAll:()=>{ repaintCount++; },
    console:{ warn:()=>{} }
  });
  await vm.runInContext(pollSource + '\npollCurrentPrices()', context);
  return {networkCount,repaintCount,cache};
};
const settingsView = await testPoll('gsheet');
assert.equal(settingsView.networkCount, 1,'Settings view still receives nonpersistent prices');
assert.equal(settingsView.repaintCount, 0,'Settings DOM must survive 60-second polling');
assert.equal(settingsView.cache['005930'],12345);
const portfolioView = await testPoll('acct');
assert.equal(portfolioView.networkCount,1);
assert.equal(portfolioView.repaintCount,1,'Portfolio views must still repaint updated prices');
const hiddenView = await testPoll('gsheet',true);
assert.equal(hiddenView.networkCount,0,'Hidden tabs must not poll');
assert.equal(hiddenView.repaintCount,0);
console.log('✅ 현재가 polling 저장 분리·hidden 완화·설정 자동화 상태 화면 보존 검사 통과');
