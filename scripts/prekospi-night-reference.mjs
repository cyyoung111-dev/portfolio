// PreKOSPI is a third-party last collected price, not a KRX confirmed close.
const URL = 'https://www.prekospi.com/kospi200-night';

export function parsePrekospiNight(html, tradingDate, receivedAt) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDate) || !Number.isFinite(Date.parse(receivedAt))) return null;
  const blocks = [...String(html).matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi)]
    .map(match => match[1]).filter(block => /<h1\b[^>]*>[\s\S]*?코스피200 야간선물[\s\S]*?마지막 야간 기록[\s\S]*?<\/h1>/i.test(block));
  if (blocks.length !== 1 || !/장 마감[\s\S]*?마지막 세션/.test(String(html).slice(0, String(html).indexOf(blocks[0])))) return null;
  const block = blocks[0].replace(/<!--[\s\S]*?-->/g, '');
  const price = block.match(/<span\b[^>]*class="[^"]*text-\[44px\][^"]*"[^>]*>\s*([\d,]+\.\d{2})\s*<\/span>/i);
  const timing = block.match(/(\d{4}-\d{2}-\d{2})\s+18:00\s*~\s*익일\s+06:00[\s\S]*?(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*06:00:00\s*KST\s*업데이트/);
  if (!price || !timing) return null;
  const start = new Date(`${timing[1]}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== timing[1]) return null;
  start.setUTCDate(start.getUTCDate() + 1);
  const date = start.toISOString().slice(0, 10);
  const updatedDate = `${timing[2]}-${timing[3].padStart(2, '0')}-${timing[4].padStart(2, '0')}`;
  const value = Number(price[1].replace(/,/g, ''));
  const asOf = `${date}T06:00:00+09:00`;
  if (date !== tradingDate || updatedDate !== date || Date.parse(receivedAt) < Date.parse(asOf)
      || !Number.isFinite(value) || value <= 0 || Math.abs(value * 20 - Math.round(value * 20)) > 1e-7) return null;
  return { source:'PREKOSPI', kind:'REFERENCE', tradingDate:date, value, sourceUpdatedAt:asOf,
    receivedAt:new Date(receivedAt).toISOString(), officialClose:false };
}

export async function fetchPrekospiNight(tradingDate, { fetchImpl=fetch, now=()=>new Date() }={}) {
  try {
    const response = await fetchImpl(URL, { redirect:'error', signal:AbortSignal.timeout(10000) });
    if (!response.ok || !String(response.headers.get('content-type') || '').includes('text/html')) return null;
    const html = await response.text();
    if (html.length > 2_000_000) return null;
    return parsePrekospiNight(html, tradingDate, now().toISOString());
  } catch { return null; }
}
