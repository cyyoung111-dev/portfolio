import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {deploy, assertGasReleaseReady, deploymentIdFromWebAppUrl} from './deploy-gas.mjs';
import {selectGasRelease, assertCurrentMainRelease} from './gas-release-gate.mjs';
import {fetchGoogleAuditToken} from './audit-published-gas-gate-readonly.mjs';
import {inspectGasDeploymentsReadOnly} from './issue507-deployment-inventory-readonly.mjs';
import {loadTrackedRuntimeSources} from './issue507-deployment-reference-analysis.mjs';

// A second boundary around the existing dry-run: even a regression in deploy()
// cannot invoke a web app, Sheets, Telegram, scripts.run or a GAS mutation.
export function readonlyTransport(scriptId, fetchImpl) {
  if(!/^[-A-Za-z0-9_]{8,160}$/.test(scriptId||''))throw Error('ISSUE860_CONFIG_INVALID');
  const root='/v1/projects/'+scriptId;
  return async (url, options={})=>{
    const u=new URL(url), method=(options.method||'GET').toUpperCase();
    const safeOrigin=u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash;
    const oauth=safeOrigin&&u.origin==='https://oauth2.googleapis.com'&&u.pathname==='/token'&&!u.search&&method==='POST';
    const metadata=safeOrigin&&u.origin==='https://script.googleapis.com'&&method==='GET'&&(
      u.pathname===root+'/content'||u.pathname===root+'/deployments'||
      new RegExp('^'+root+'/deployments/[-A-Za-z0-9_]{8,160}$').test(u.pathname));
    const main=safeOrigin&&u.origin==='https://api.github.com'&&method==='GET'&&
      u.pathname==='/repos/cyyoung111-dev/portfolio/git/ref/heads/main'&&!u.search;
    if(!oauth&&!metadata&&!main)throw Error('ISSUE860_NETWORK_OPERATION_BLOCKED');
    return fetchImpl(url,{...options,redirect:'error'});
  };
}

export async function runReadOnly9282({fetchImpl=globalThis.fetch}={}) {
  selectGasRelease({eventName:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,
    repository:process.env.GITHUB_REPOSITORY,sha:process.env.GITHUB_SHA});
  if(process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'||
     process.env.GAS_DEPLOY_DRY_RUN!=='true'||process.env.GAS_9282_RELEASE_APPROVAL!=='false'||
     process.env.GAS_9283_RELEASE_APPROVAL!=='false')throw Error('ISSUE860_MODE_INVALID');
  const sourceVersion=assertGasReleaseReady(fs.readFileSync('src/gas/apps_script.gs','utf8'));
  if(!['9.282','9.283'].includes(sourceVersion))throw Error('ISSUE860_CANDIDATE_INVALID');
  const guarded=readonlyTransport(process.env.GAS_SCRIPT_ID,fetchImpl);
  const originalFetch=globalThis.fetch;
  const originalExpected=process.env.GAS_EXPECTED_MAIN_SHA;
  const originalDiagnostic=process.env.GAS_DEPLOY_DIAGNOSTIC_ONLY;
  let inventory, dryRun;
  const failures=[];
  // deploy() uses global fetch. Install the guard before any authenticated call.
  globalThis.fetch=guarded;
  process.env.GAS_EXPECTED_MAIN_SHA=process.env.GITHUB_SHA;
  // The existing diagnostic return precedes alreadyDeployed's web-app probes.
  // Keep dryRun=true as an independent no-write boundary, even on this path.
  process.env.GAS_DEPLOY_DIAGNOSTIC_ONLY='true';
  try {
    await assertCurrentMainRelease({sha:process.env.GITHUB_SHA,
      repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN,fetchImpl:guarded});
    try {
      const token=await fetchGoogleAuditToken({clasprc:process.env.CLASPRC_JSON,fetchImpl:guarded});
      inventory=await inspectGasDeploymentsReadOnly({scriptId:process.env.GAS_SCRIPT_ID,
        expectedDeploymentId:process.env.GAS_DEPLOYMENT_ID||deploymentIdFromWebAppUrl(process.env.GAS_WEB_APP_URL||''),
        googleAccessToken:token,verifyDetails:true,verifySource:true,
        referenceFiles:loadTrackedRuntimeSources(),fetchImpl:guarded});
    } catch { failures.push('INVENTORY_UNVERIFIED'); }
    // A BLOCKED inventory must remain visible, but must not hide dry-run evidence.
    try {
      const releaseState=await deploy();
      if(releaseState?.mode!=='READ_ONLY_GAS_RELEASE_STATE')throw Error('ISSUE860_STATE_INVALID');
      dryRun={deployed:false,dryRun:true,version:sourceVersion,releaseState};
    } catch { failures.push('DRY_RUN_UNVERIFIED'); }
    await assertCurrentMainRelease({sha:process.env.GITHUB_SHA,
      repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN,fetchImpl:guarded});
    return {mode:'ISSUE860_READONLY_GAS_RELEASE',sourceVersion,sha:process.env.GITHUB_SHA,
      status:failures.length?'UNVERIFIED':inventory?.status==='BLOCKED'?'BLOCKED':'READ_ONLY_CHECKS_PASSED',
      inventory:inventory||null,dryRun:dryRun?.dryRun===true?dryRun:null,failures,
      releaseAuthorized:false,firstWriterGateCutoverVerified:false,
      gasWrites:0,financeWrites:0,telegramSends:0};
  } finally {
    globalThis.fetch=originalFetch;
    for(const [key,value] of [['GAS_EXPECTED_MAIN_SHA',originalExpected],['GAS_DEPLOY_DIAGNOSTIC_ONLY',originalDiagnostic]])
      if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const result=await runReadOnly9282();
    console.log(JSON.stringify(result));
    if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '## Issue #860 읽기 전용 재감사 + v9.282 dry-run\n```json\n'+JSON.stringify(result,null,2)+'\n```\n'+
      '배포 승인이 아닙니다. 최초 writer gate 차단은 유지됩니다.\n');
    if(result.status!=='READ_ONLY_CHECKS_PASSED')process.exitCode=2;
  } catch {
    console.error('ISSUE860_READONLY_UNVERIFIED');process.exitCode=2;
  }
}
