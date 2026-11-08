// Contract guard for the undeployed FX preview. No GAS or financial writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { composeGas9285TradeFxPreview } from './compose-gas9285-trade-fx-preview.mjs';

const generator = fs.readFileSync('scripts/compose-gas9285-trade-fx-preview.mjs', 'utf8');
const { base, candidate, manifest } = composeGas9285TradeFxPreview();
assert.equal(manifest.productionDeploymentApproved, false);
assert.equal(manifest.financeWrites, 0);
assert.equal(manifest.gasProjectWrites, 0);
assert.equal(manifest.status, 'SOURCE_PREVIEW_NOT_DEPLOYABLE');
assert.ok(base.includes("gasVersion: '9.284'"));
assert.ok(candidate.includes("gasVersion: '9.285'"));
assert.ok(generator.includes("if(!fxRowsFullyPreserved) return jsonError("));
assert.ok(generator.includes("errorCode:'TRADE_FX_METADATA_LOSS_RISK'"));
assert.ok(!generator.includes('var oldOrdinaryCounts={}'),
  'unsafe multiset/group deletion heuristic must not return');
const failClosed = candidate.indexOf('if(!fxRowsFullyPreserved) return jsonError(');
const write = candidate.indexOf('SpreadsheetApp.flush();', failClosed);
assert.ok(failClosed >= 0 && write > failClosed,
  'FX loss must be rejected before trade ledger flush');
console.log('TRADE_FX_PREVIEW_FAIL_CLOSED_CONTRACT_PASS');
