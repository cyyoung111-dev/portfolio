import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {composeGas9299FundPriceScopedPreview} from './compose-gas9299-fund-price-scoped-preview.mjs';
const PIN='da92037048eb3b3eac0e50b32694a812c6e49adc';
const blob=s=>{const b=Buffer.from(s,'utf8');return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
function once(s,a,b){assert.equal(s.split(a).length,2,'TAX_SCENARIO_SYNC_SOURCE_DRIFT');return s.replace(a,b);}
export function composeGas9300TaxScenarioSyncPreview(){
 const parent=composeGas9299FundPriceScopedPreview().candidate;
 assert.equal(blob(parent),PIN,'TAX_SCENARIO_SYNC_UNREVIEWED_PARENT');
 let candidate=once(parent,"  if (params.action === 'diagnoseNhFinancialIncome') return handleDiagnoseNhFinancialIncome(params);",
  "  if (params.action === 'diagnoseNhFinancialIncome') return handleDiagnoseNhFinancialIncome(params);\n  if (params.action === 'getFinancialTaxScenario') return handleFinancialTaxScenarioSync(params,false);\n  if (params.action === 'saveFinancialTaxScenario') return handleFinancialTaxScenarioSync(params,true);");
 // Change only the existing call; keep the 9.290 stage instrumentation.
 candidate=once(candidate,
  '    var result = _refreshFundValuations(getss(), _fundDateOffset(runDate, -31), runDate, undefined, false, recoveryDiagnostic || null, 1, {FUNETF:true});',
  '    var result = _refreshFundValuations(getss(), _fundDateOffset(runDate, -31), runDate, undefined, false, recoveryDiagnostic || null, 1, {FUNETF:true,HANWHA:true});');
 candidate=once(candidate,
  '    // KB NAV is collected by the bounded GitHub worker; do not repeat its HTTP fetch in GAS.',
  '    // Both exact-class NAV collectors own external fetching; CLOSE uses stored NAV only.');
 candidate=once(candidate,'//  📊 포트폴리오 대시보드 — Google Apps Script  v9.299','//  📊 포트폴리오 대시보드 — Google Apps Script  v9.300');
 assert(candidate.split("gasVersion: '9.299'").length>=6);
 candidate=candidate.replaceAll("gasVersion: '9.299'","gasVersion: '9.300'");
 candidate=once(candidate,"var ISSUE507_GATE_API_VERSION='9.299'","var ISSUE507_GATE_API_VERSION='9.300'");
 candidate+='\n'+fs.readFileSync(new URL('./financial-tax-scenario-sync-proposal.gs',import.meta.url),'utf8');
 return {parent,candidate,manifest:{version:'9.300',parentVersion:'9.299',parentGitBlob:PIN,candidateGitBlob:blob(candidate),
  mode:'SOURCE_PREVIEW_ONLY',productionDeploymentApproved:false,gasProjectWrites:0,financialWrites:0,
  changedBusinessFunctions:['doPost','handleFinancialTaxScenarioSync','runDailyFundValuations'],privateScenarioOnly:true,dailyNavExternalFetchDisabled:true,localLookbackDays:32}};
}
