// Test-only fetch shim injected with node --import. The production runner is
// executed as a separate process without changing its runtime/auth contract.
const mode = process.env.BRIEFING_TEST_FAILURE || '';
globalThis.fetch = async (_url, options = {}) => {
  const data = new URLSearchParams(String(options.body || ''));
  const action = data.get('action');
  if (action === 'getBenchmarks' && (mode === 'FOREIGN' || mode === 'BOTH'))
    throw new Error('TEST_FOREIGN_PROVIDER_DOWN');
  if (action === 'getExchangeRateHistory' && (mode === 'FX' || mode === 'BOTH'))
    throw new Error('TEST_FX_PROVIDER_DOWN');

  let payload = { status: 'ok' };
  switch (action) {
    case 'getMarketBriefingMaster':
      payload = { status: 'ok', observations: [] }; break;
    case 'getMarketBriefingSnapshots':
      payload = { status: 'ok', snapshots: [] }; break;
    case 'getBenchmarks':
      payload = { status: 'ok', series: Object.fromEntries(
        ['SP500','NASDAQ100','SOX','VIX'].map(type => [
          type, [{ date:'2026-10-08', value: 1200, source:'TEST_PROVIDER' }]
        ])) }; break;
    case 'getExchangeRateHistory':
      payload = { status:'ok', history:[{date:'2026-10-08',value:1380}] }; break;
    case 'getPrices':
      payload = { status:'ok', prices:{} }; break;
    case 'getPriceHistory':
      payload = { status:'ok', prices:{} }; break;
    case 'appendMarketBriefingObservations': {
      const submitted = JSON.parse(data.get('data') || '[]');
      payload = { status:'ok', saved:submitted.length,duplicates:0,rejected:0 }; break;
    }
    default:
      payload = { status:'ok' };
  }
  return {ok:true,status:200,json:async()=>payload};
};
