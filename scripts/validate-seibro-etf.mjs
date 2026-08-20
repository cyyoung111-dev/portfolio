#!/usr/bin/env node

import fs from 'node:fs';

const HAR_PATH = 'reference/seibro.or.kr.har.txt';
const ENDPOINT = 'https://seibro.or.kr/websquare/engine/proworks/callServletService.jsp';
const SEARCH_ACTION = 'searchEtfContentList';
const PAYMENT_ACTION = 'exerInfoDtramtPayStatPlist';

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function xmlValue(xml, tag) {
  const match = String(xml).match(new RegExp(`<${tag}\\s+value="([^"]*)"\\s*\\/>`));
  return match ? match[1] : '';
}

function vectorCount(xml) {
  const match = String(xml).match(/<vector\b[^>]*\bresult="(\d+)"/);
  return match ? Number(match[1]) : null;
}

function assertXmlResponse(xml, action) {
  if (!String(xml).trim().startsWith('<?xml')) {
    throw Object.assign(new Error(`${action}: XML 선언이 없습니다`), { validationStatus: 'PARSE_ERROR' });
  }
  if (!/<(?:vector|result)\b/.test(xml)) {
    throw Object.assign(new Error(`${action}: 결과 루트가 없습니다`), { validationStatus: 'PARSE_ERROR' });
  }
}

function loadHarRequests() {
  if (!fs.existsSync(HAR_PATH)) throw new Error(`${HAR_PATH} 파일이 없습니다`);
  const har = JSON.parse(fs.readFileSync(HAR_PATH, 'utf8'));
  const entries = har?.log?.entries || [];
  const find = action => entries.find(entry =>
    entry?.request?.postData?.text?.includes(`action="${action}"`)
  );
  const search = find(SEARCH_ACTION);
  const payment = find(PAYMENT_ACTION);
  if (!search || !payment) throw new Error('HAR에서 필수 요청 2개를 찾지 못했습니다');
  if (search.request.url !== ENDPOINT || payment.request.url !== ENDPOINT) {
    throw new Error('HAR endpoint가 예상 값과 다릅니다');
  }
  return { search, payment };
}

function requestHeaders(entry) {
  const allowed = new Set(['content-type', 'origin', 'referer', 'submissionid']);
  return Object.fromEntries(entry.request.headers
    .filter(header => allowed.has(header.name.toLowerCase()))
    .map(header => [header.name, header.value]));
}

async function postXml(entry, body) {
  let response;
  try {
    response = await fetch(entry.request.url, {
      method: 'POST',
      headers: requestHeaders(entry),
      body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw Object.assign(new Error(error.message), { validationStatus: 'REQUEST_ERROR' });
  }
  const text = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error(`HTTP ${response.status}`), { validationStatus: 'REQUEST_ERROR' });
  }
  return text;
}

function searchBody(code) {
  return `<reqParam action="${SEARCH_ACTION}" task="ksd.safe.bip.cmuc.User.process.SearchPTask"><search_string value="${xmlEscape(code)}"/></reqParam>`;
}

function paymentBody(template, isin) {
  return template.replace(/<isin value="[^"]*"\/>/, `<isin value="${xmlEscape(isin)}"/>`);
}

function validateSearch(xml, code) {
  assertXmlResponse(xml, SEARCH_ACTION);
  const isin = xmlValue(xml, 'ISIN');
  const name = xmlValue(xml, 'KOR_SECN_NM');
  if (!isin || !name) {
    throw Object.assign(new Error(`${code}: 검색 결과가 없습니다`), { validationStatus: 'NOT_FOUND' });
  }
  if (!/^KR[A-Z0-9]{10}$/.test(isin)) {
    throw Object.assign(new Error(`${code}: ISIN 형식이 올바르지 않습니다`), { validationStatus: 'MAPPING_ERROR' });
  }
  return { isin, name };
}

function validatePayments(xml, code, expectedIsin) {
  assertXmlResponse(xml, PAYMENT_ACTION);
  const count = vectorCount(xml);
  if (count === null) {
    throw Object.assign(new Error(`${code}: 분배금 건수를 파싱하지 못했습니다`), { validationStatus: 'PARSE_ERROR' });
  }
  if (count === 0) {
    throw Object.assign(new Error(`${code}: 분배금 내역이 없습니다`), { validationStatus: 'NOT_FOUND' });
  }
  const isin = xmlValue(xml, 'ISIN');
  if (isin !== expectedIsin) {
    throw Object.assign(new Error(`${code}: 검색 ISIN과 분배금 ISIN이 다릅니다`), { validationStatus: 'MAPPING_ERROR' });
  }
  const amount = xmlValue(xml, 'ESTM_STDPRC');
  const recordDate = xmlValue(xml, 'RGT_STD_DT');
  if (!amount || !recordDate) {
    throw Object.assign(new Error(`${code}: 필수 분배금 필드가 없습니다`), { validationStatus: 'PARSE_ERROR' });
  }
  return { count, latestRecordDate: recordDate, latestAmount: amount };
}

function readCodes() {
  const raw = argValue('--codes') || '458730';
  return raw.split(',').map(code => String(code).trim().toUpperCase()).filter(Boolean);
}

async function validateHarFixture(search, payment) {
  const code = '458730';
  const mapped = validateSearch(search.response.content.text, code);
  const payments = validatePayments(payment.response.content.text, code, mapped.isin);
  return { code, status: 'OK', ...mapped, ...payments, source: 'HAR' };
}

async function validateLive(code, search, payment) {
  try {
    const searchXml = await postXml(search, searchBody(code));
    const mapped = validateSearch(searchXml, code);
    const paymentXml = await postXml(payment, paymentBody(payment.request.postData.text, mapped.isin));
    const payments = validatePayments(paymentXml, code, mapped.isin);
    return { code, status: 'OK', ...mapped, ...payments, source: 'LIVE' };
  } catch (error) {
    return { code, status: error.validationStatus || 'PARSE_ERROR', error: error.message, source: 'LIVE' };
  }
}

const { search, payment } = loadHarRequests();
const harResult = await validateHarFixture(search, payment);
const results = process.argv.includes('--har-only')
  ? [harResult]
  : await Promise.all(readCodes().map(code => validateLive(code, search, payment)));

console.table(results);
const failed = results.some(result => result.status !== 'OK');
if (failed) process.exitCode = 1;

