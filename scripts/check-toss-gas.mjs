import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync('src/gas/apps_script.gs', 'utf8');
assert.match(source, /TOSS_API_BASE\s*=\s*'https:\/\/openapi\.tossinvest\.com'/);
assert.match(source, /TOSS_CLIENT_ID/); assert.match(source, /TOSS_CLIENT_SECRET/);
assert.match(source, /grant_type:\s*'client_credentials'/);
assert.match(source, /Authorization:\s*'Bearer '\s*\+\s*token/);
assert.match(source, /\/api\/v1\/prices/); assert.match(source, /symbols\.join\(','\)/);
assert.match(source, /\/api\/v1\/candles/); assert.match(source, /interval:\s*'1d'/);
assert.match(source, /adjusted:\s*'false'/); assert.match(source, /nextBefore/);
assert.match(source, /Retry-After/); assert.match(source, /Math\.pow\(2, attempt\)/);
assert.match(source, /fetchHistoricalPricesToss\(items, dateStr\)/);
assert.match(source, /var val = \(tossPrices\[code\]/);
assert.ok(!/Logger\.log\([^\n]*(?:access_token|client_secret|TOSS_CLIENT_SECRET)/i.test(source));
console.log('Toss GAS integration contract checks passed');

