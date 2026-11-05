import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {loadCutoverSources,BASE_BLOB,FINAL_BLOB,LEGACY_BLOB,RELEASE} from './issue860-bootstrap-source.mjs';
import {gasSourceBlobSha,selectServerFile,assertGasProjectFileSet,buildUpdatedFiles,
 deploymentIdFromWebAppUrl,verifyDeploymentVersionWithRetry} from './deploy-gas.mjs';
import {fetchGoogleAuditToken} from './audit-published-gas-gate-readonly.mjs';
import {assertCurrentMainRelease} from './gas-release-gate.mjs';

export const BOOTSTRAP_BLOB='5ba7f40aa5ee9236a69a2c4077874bc19f3a9156';
export const PREVIOUS_BOOTSTRAP_BLOB='0b2778afae5b1ffdeceb342c6d6e708ba919cc88';
export const INPUT_BOOTSTRAP_BLOB='a88919ab3fe15c9624b2096fc4dfe52041f7d6d2';
const BOOTSTRAP_PROFILES=[BOOTSTRAP_BLOB,PREVIOUS_BOOTSTRAP_BLOB,INPUT_BOOTSTRAP_BLOB];
// Bound to the operator-observed /dev ID of this project; never exempt an
// arbitrary unversioned or public entry by its missing version/description.
const UI_HEAD_SHA256='4c41d2a953884746fe00f1cdbdb1782f57d36353a3a529d3c82c1370426888d3';
const ROOT='https://script.googleapis.com/v1/projects/';
const error=code=>{throw Error('ISSUE860_CUTOVER_'+code);};
const hash=s=>createHash('sha256').update(s).digest('hex');
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
 ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const canonical=files=>JSON.stringify(files.map(f=>({name:f.name,type:f.type,
 source:String(f.source).replace(/\r\n/g,'\n')})).sort((a,b)=>a.name.localeCompare(b.name)));

export async function runFirstCutover({phase,approved=false,dryRun=true,sources,rpc,checkMain,gate}){
 if(!['bootstrap','finalize','abort','inspect'].includes(phase)||typeof dryRun!=='boolean'||typeof approved!=='boolean')error('INPUT');
 if(phase==='inspect'&&!dryRun)error('INSPECT_READ_ONLY');
 if(!dryRun&&!approved)error('APPROVAL');
 if(gasSourceBlobSha(sources.finalSource)!==FINAL_BLOB||gasSourceBlobSha(sources.bootstrapSource)!==BOOTSTRAP_BLOB)
  error('SOURCE');
 // Read-only inspection must survive an advancing main branch. The checked
 // source/published blobs and deployment inventory are verified independently.
 // Mutating bootstrap/finalize/abort still require the CURRENT main release.
 if(phase!=='inspect')await checkMain();
 const initial=await rpc.readState();
 const target=selectServerFile(initial.head.files);
 assertGasProjectFileSet(initial.head.files,target.name,initial.published.files);
 const headBlob=gasSourceBlobSha(target.source.replace(/\r\n/g,'\n'));
 const publishedBlob=gasSourceBlobSha(selectServerFile(initial.published.files,target.name).source.replace(/\r\n/g,'\n'));
 if(phase==='inspect'){
  if(![...BOOTSTRAP_PROFILES,BASE_BLOB,FINAL_BLOB].includes(headBlob)||![...BOOTSTRAP_PROFILES,BASE_BLOB,FINAL_BLOB].includes(publishedBlob))error('BEFORE_SOURCE');
  await rpc.inventory(initial);const status=await gate();
  return {phase,readOnly:true,deployed:false,gateMode:status.mode,
   firstCutoverReady:status.firstCutoverReady===true,firstCutoverAbortReady:status.firstCutoverAbortReady===true,
   financeWrites:0,telegramSends:0};
 }
 if(phase==='abort'){
  // Only before the stateful gate AND before any trigger deletion. Once a
  // journal is PAUSING or a gate exists, forward recovery is mandatory.
  if(![LEGACY_BLOB,...BOOTSTRAP_PROFILES].includes(headBlob)||!BOOTSTRAP_PROFILES.includes(publishedBlob))error('ABORT_SOURCE');
  let status=await gate();
  if(status.mode!=='UNINITIALIZED'||status.firstCutoverAbortReady!==true)error('ABORT_NOT_SAFE');
  const legacy=await rpc.readVersion(336);
  assertGasProjectFileSet(legacy.files,target.name,initial.published.files);
  if(gasSourceBlobSha(selectServerFile(legacy.files,target.name).source.replace(/\r\n/g,'\n'))!==LEGACY_BLOB)error('ABORT_LEGACY_SOURCE');
  await rpc.inventory(initial);
  if(dryRun)return {phase,dryRun:true,deployed:false,financeWrites:0,telegramSends:0};
  const again=await rpc.readState();
  if(canonical(again.head.files)!==canonical(initial.head.files)||canonical(again.published.files)!==canonical(initial.published.files)||
   again.deployment.deploymentConfig.versionNumber!==initial.deployment.deploymentConfig.versionNumber)error('CONCURRENT_CHANGE');
  await checkMain();status=await gate();
  if(status.mode!=='UNINITIALIZED'||status.firstCutoverAbortReady!==true)error('ABORT_NOT_SAFE');
  try{
   if(headBlob!==LEGACY_BLOB)await rpc.writeContent(legacy.files);
   await rpc.publish({...initial.deployment.deploymentConfig,versionNumber:336,
    description:'Issue860 pre-gate abort GAS v9.281'});
   await verifyDeploymentVersionWithRetry({readDeployment:rpc.readDeployment,expectedVersion:336,pause:rpc.pause||undefined});
   const after=await rpc.readState();
   if(canonical(after.head.files)!==canonical(legacy.files)||canonical(after.published.files)!==canonical(legacy.files))error('ABORT_READBACK');
   return {phase,abortedBeforeGate:true,version:'9.281',deploymentVersion:336,financeWrites:0,telegramSends:0};
  }catch{error('ABORT_RECOVERY_REQUIRED');}
 }
 const wanted=phase==='bootstrap'?BOOTSTRAP_BLOB:FINAL_BLOB;
 const allowed=phase==='bootstrap'?[LEGACY_BLOB,...BOOTSTRAP_PROFILES,BASE_BLOB,FINAL_BLOB]:[BOOTSTRAP_BLOB,BASE_BLOB,FINAL_BLOB];
 if(!allowed.includes(headBlob)||!allowed.includes(publishedBlob))error('BEFORE_SOURCE');
 if(publishedBlob===LEGACY_BLOB&&[BASE_BLOB,FINAL_BLOB].includes(headBlob))error('BEFORE_SOURCE');
 // Reinstalling the maintenance profile is the forward recovery path if a
 // partial finalization removed editor helpers from HEAD. Never reenter from
 // an OPEN final deployment or discard active receipts/repair capabilities.
 if(phase==='bootstrap'&&[BASE_BLOB,FINAL_BLOB].includes(publishedBlob)){
  const before=await gate();
  if(before.mode!=='DRAINING'||before.activeCount!==0||before.approvalPresent!==false||before.repairAuthorized!==false)
   error('DRAIN');
 }
 // A forward retry can repair HEAD written before an interrupted version/publish.
 if(phase==='finalize'){
  const before=await gate();
  if(before.mode!=='DRAINING'||before.activeCount!==0||before.repairAuthorized!==false||before.approvalPresent!==false)
   error('DRAIN');
  if(publishedBlob===BOOTSTRAP_BLOB&&(before.releaseId!==RELEASE||before.firstCutoverReady!==true))error('BOOTSTRAP_NOT_READY');
  if(publishedBlob===BOOTSTRAP_BLOB&&before.preservedTriggers&&
    (before.preservedTriggers.productionBindingSha256!==hash(initial.deployment.deploymentId||'')||
     before.preservedTriggers.inventoryUnchanged!==true))error('PRESERVED_BINDING');
 }
 await rpc.inventory(initial);
 if(dryRun)return {phase,dryRun:true,deployed:false,financeWrites:0,telegramSends:0};
 if(headBlob===wanted&&publishedBlob===wanted)return {phase,deployed:false,alreadyDeployed:true,
  maintenance:true,financeWrites:0,telegramSends:0};
 const source=phase==='bootstrap'?sources.bootstrapSource:sources.finalSource;
 const files=buildUpdatedFiles(initial.head.files,target.name,source);
 // Recheck metadata, both whole file sets and main immediately before mutation.
 const again=await rpc.readState();
 if(canonical(again.head.files)!==canonical(initial.head.files)||
  canonical(again.published.files)!==canonical(initial.published.files)||
  again.deployment.deploymentConfig.versionNumber!==initial.deployment.deploymentConfig.versionNumber)
  error('CONCURRENT_CHANGE');
 await rpc.inventory(again);await checkMain();
 let stage='CONTENT_WRITE',createdVersion=null;
 try{
  if(headBlob!==wanted)await rpc.writeContent(files);
  stage='VERSION_CREATE';
  const v=await rpc.createVersion(phase);
  if(!Number.isSafeInteger(v)||v<1)error('VERSION');
  createdVersion=v;stage='VERSION_READBACK';
  const created=await rpc.readVersion(v);
  assertGasProjectFileSet(created.files,target.name,initial.published.files);
  if(canonical(created.files)!==canonical(files))error('CREATED_SOURCE');
  const current=await rpc.readState();
  if(canonical(current.head.files)!==canonical(files)||
   canonical(current.published.files)!==canonical(initial.published.files)||
   current.deployment.deploymentConfig.versionNumber!==initial.deployment.deploymentConfig.versionNumber)
   error('CONCURRENT_CHANGE');
  await rpc.inventory(current);await checkMain();
  // Read readiness again at the last bootstrap-visible point. Version creation
  // and readback may have consumed the remaining attestation/barrier lifetime.
  if(phase==='finalize'){
   const latest=await gate();
   if(latest.mode!=='DRAINING'||latest.activeCount!==0||latest.repairAuthorized!==false||latest.approvalPresent!==false)
    error('DRAIN');
   if(publishedBlob===BOOTSTRAP_BLOB&&(latest.releaseId!==RELEASE||latest.firstCutoverReady!==true))
    error('BOOTSTRAP_NOT_READY');
   if(publishedBlob===BOOTSTRAP_BLOB&&latest.preservedTriggers&&
     (latest.preservedTriggers.productionBindingSha256!==hash(initial.deployment.deploymentId||'')||
      latest.preservedTriggers.inventoryUnchanged!==true))error('PRESERVED_BINDING');
  }
  if(phase==='bootstrap'&&[BASE_BLOB,FINAL_BLOB].includes(publishedBlob)){
   const latest=await gate();
   if(latest.mode!=='DRAINING'||latest.activeCount!==0||latest.approvalPresent!==false||latest.repairAuthorized!==false)
    error('DRAIN');
  }
  stage='DEPLOYMENT_WRITE';
  await rpc.publish({...initial.deployment.deploymentConfig,versionNumber:v,
   description:'Issue860 '+phase+' GAS v9.282'});
  stage='DEPLOYMENT_READBACK';
  await verifyDeploymentVersionWithRetry({readDeployment:rpc.readDeployment,
   expectedVersion:v,pause:rpc.pause||undefined});
  const after=await rpc.readState();
  if(canonical(after.head.files)!==canonical(files)||canonical(after.published.files)!==canonical(files))error('READBACK');
  stage='GATE_READBACK';const status=await gate();
  if(phase==='bootstrap'&&!['UNINITIALIZED','DRAINING'].includes(status.mode))error('BOOTSTRAP_GATE');
  if(phase==='finalize'&&(status.mode!=='DRAINING'||status.activeCount!==0||status.approvalPresent!==false))error('FINAL_GATE');
  return {phase,deployed:true,version:'9.282',deploymentVersion:v,maintenance:true,
   writersResumed:false,financeWrites:0,telegramSends:0};
 }catch(cause){
  // Never roll back to ungated legacy after a stateful installation. Re-run
  // the SAME phase from exact approved HEAD/published combinations instead.
  // Unknown created/published versions are not overwritten on a retry.
  const failure=new Error('ISSUE860_CUTOVER_FORWARD_RECOVERY_REQUIRED');
  failure.stage=stage;failure.createdVersion=createdVersion;
  failure.causeCode=/^ISSUE860_CUTOVER_[A-Z_]+$/.test(cause?.message||'')?cause.message:'ISSUE860_CUTOVER_UNVERIFIED';
  throw failure;
 }
}

// Existing manual first-cutover commands stay manual-only. This one-shot
// main-push exception allows ONLY authenticated GET-based inspection, never a
// bootstrap/finalize/abort or any deployment mutation.
export function assertFirstCutoverCliContext(env){
 const main=env.GITHUB_REF==='refs/heads/main'&&env.GITHUB_REPOSITORY==='cyyoung111-dev/portfolio';
 const manual=env.GITHUB_EVENT_NAME==='workflow_dispatch';
 const oneShot=env.GITHUB_EVENT_NAME==='push'&&env.GAS_ISSUE860_ONE_SHOT_INSPECT==='true'&&
  env.GAS_FIRST_GATE_PHASE==='inspect'&&env.GAS_DEPLOY_DRY_RUN==='true'&&
  env.GAS_9282_RELEASE_APPROVAL==='false'&&env.GAS_9283_RELEASE_APPROVAL==='false'&&
  env.GAS_EXPECTED_MAIN_SHA===env.GITHUB_SHA&&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'');
 if(!main||(!manual&&!oneShot))error('MAIN_MANUAL_ONLY');
 return oneShot?'one-shot-readonly-inspect':'manual';
}

async function cli(){
 const phase=process.env.GAS_FIRST_GATE_PHASE;
 const dryRun=process.env.GAS_DEPLOY_DRY_RUN==='true';
 assertFirstCutoverCliContext(process.env);
 if(!['true','false'].includes(process.env.GAS_DEPLOY_DRY_RUN))error('INPUT');
 if(!dryRun&&process.env.GAS_9282_RELEASE_APPROVAL!=='true')error('APPROVAL');
 const scriptId=process.env.GAS_SCRIPT_ID;
 const url=process.env.GAS_WEB_APP_URL;
 const expected=process.env.GAS_DEPLOYMENT_ID||deploymentIdFromWebAppUrl(url);
 if(!/^[-\w]{20,160}$/.test(scriptId||'')||!/^[-\w]{20,160}$/.test(expected||''))error('CONFIG');
 if(url!=='https://script.google.com/macros/s/'+expected+'/exec')error('CONFIG_URL');
 const google=await fetchGoogleAuditToken({clasprc:process.env.CLASPRC_JSON});
 const base=ROOT+encodeURIComponent(scriptId);
 async function request(path,method='GET',body){
  const res=await fetch(base+path,{method,headers:{Authorization:'Bearer '+google,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!res.ok)error('HTTP');
  try{return await res.json();}catch{error('JSON');}
 }
 const readDeployment=()=>request('/deployments/'+encodeURIComponent(expected));
 const rpc={readDeployment,
  async readState(){
   const head=await request('/content'),deployment=await readDeployment();
   const v=deployment?.deploymentConfig?.versionNumber;
   if(!Number.isSafeInteger(v)||v<1)error('DEPLOYMENT_VERSION');
   return {head,deployment,published:await request('/content?versionNumber='+v)};
  },
  async inventory(){
   const payload=await request('/deployments?pageSize=50');
   if(payload.nextPageToken||!Array.isArray(payload.deployments)||payload.deployments.length!==2)error('INVENTORY');
   const actual=payload.deployments.filter(d=>d.deploymentId===expected);
   const head=payload.deployments.filter(d=>hash(d.deploymentId||'')===UI_HEAD_SHA256);
   if(actual.length!==1||head.length!==1||actual[0]===head[0]||head[0].deploymentConfig?.versionNumber!==undefined)
    error('INVENTORY_IDENTITY');
   for(const row of [actual[0],head[0]]){
    const detail=await request('/deployments/'+encodeURIComponent(row.deploymentId));
    if(detail.deploymentId!==row.deploymentId||stable(detail.deploymentConfig)!==stable(row.deploymentConfig)||
     stable(detail.entryPoints)!==stable(row.entryPoints))error('INVENTORY_DETAIL');
    if(!Array.isArray(row.entryPoints)||row.entryPoints.length!==1||row.entryPoints[0].entryPointType!=='WEB_APP')error('INVENTORY_ENTRY');
    const endpoint=row.entryPoints[0].webApp?.url;
    const prefix='https://script.google.com/macros/s/'+row.deploymentId;
    if(row===head[0]?![prefix+'/dev',prefix+'/exec'].includes(endpoint):endpoint!==prefix+'/exec')error('INVENTORY_URL');
   }
  },
  writeContent:files=>request('/content','PUT',{files}),
  createVersion:async phase=>(await request('/versions','POST',{description:'Issue860 '+phase+' GAS v9.282'})).versionNumber,
  readVersion:v=>request('/content?versionNumber='+v),
  publish:deploymentConfig=>request('/deployments/'+encodeURIComponent(expected),'PUT',{deploymentConfig})
 };
 const gate=async()=>{
  const token=process.env.GAS_ACCESS_TOKEN;
  if(!token)error('GATE_AUTH');
  const denied=new URL(url);denied.search=new URLSearchParams({action:'getWriterGateStatus',accessToken:'ISSUE860_INVALID_TOKEN'}).toString();
  const deniedRes=await fetch(denied,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(30000)});
  const deniedData=await deniedRes.json();
  if(deniedData.status!=='error'||deniedData.message!=='인증 실패')error('GATE_AUTH_NOT_ENFORCED');
  const probe=new URL(url);probe.search=new URLSearchParams({action:'getWriterGateStatus',accessToken:token}).toString();
  const res=await fetch(probe,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(30000)});
  const d=await res.json();
  if(d.status==='error'&&d.message==='인증 실패')error('GATE_AUTH_REJECTED');
  if(d.status==='ok'&&d.gasVersion!=='9.282')error('GATE_VERSION_UNVERIFIED');
  if(!res.ok||d.status!=='ok'||d.gasVersion!=='9.282'||!d.writerGate)error('GATE_READBACK');
  if(!['UNINITIALIZED','DRAINING','OPEN'].includes(d.writerGate.mode))error('GATE_READBACK');
  console.log(JSON.stringify({mode:'ISSUE860_CUTOVER_GATE',state:d.writerGate.mode,
   firstCutoverReady:d.writerGate.firstCutoverReady===true,firstCutoverAbortReady:d.writerGate.firstCutoverAbortReady===true,
   journalPresent:d.writerGate.journalPresent===true,
   preservedTriggers:d.writerGate.preservedTriggers?{
    count:[11,12].includes(d.writerGate.preservedTriggers.count)?d.writerGate.preservedTriggers.count:null,
    productionVersion:Number.isSafeInteger(d.writerGate.preservedTriggers.productionVersion)?d.writerGate.preservedTriggers.productionVersion:null,
    productionBindingSha256:/^[a-f0-9]{64}$/.test(d.writerGate.preservedTriggers.productionBindingSha256||'')?d.writerGate.preservedTriggers.productionBindingSha256:null,
    inventoryUnchanged:d.writerGate.preservedTriggers.inventoryUnchanged===true}:null,
   activeCount:Number.isSafeInteger(d.writerGate.activeCount)?d.writerGate.activeCount:null}));
  return d.writerGate;
 };
 const checkMain=()=>assertCurrentMainRelease({sha:process.env.GAS_EXPECTED_MAIN_SHA,
  repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN});
 const result=await runFirstCutover({phase,dryRun,approved:process.env.GAS_9282_RELEASE_APPROVAL==='true',
  sources:loadCutoverSources(),rpc,gate,checkMain});
 console.log(JSON.stringify(result));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 cli().catch(e=>{console.log(JSON.stringify({status:'BLOCKED',reason:/^ISSUE860_CUTOVER_[A-Z_]+$/.test(e?.message)?e.message:
  'ISSUE860_CUTOVER_UNVERIFIED',stage:['CONTENT_WRITE','VERSION_CREATE','VERSION_READBACK','DEPLOYMENT_WRITE','DEPLOYMENT_READBACK','GATE_READBACK'].includes(e?.stage)?e.stage:'PREFLIGHT',
  causeCode:/^ISSUE860_CUTOVER_[A-Z_]+$/.test(e?.causeCode||'')?e.causeCode:null,
  createdVersion:Number.isSafeInteger(e?.createdVersion)?e.createdVersion:null,writersResumed:false}));process.exitCode=2;});
}
