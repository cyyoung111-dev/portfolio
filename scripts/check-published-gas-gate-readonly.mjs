import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gasSourceBlobSha} from './deploy-gas.mjs';
import {loadCutoverSources} from './issue860-bootstrap-source.mjs';
import {classifyPublishedGateSource,inspectPublishedGasReadOnly,
 fetchGoogleAuditToken} from './audit-published-gas-gate-readonly.mjs';

const wf=fs.readFileSync('.github/workflows/gas-published-gate-readonly-audit.yml','utf8');
assert.match(wf,/^on:\s*\n\s+workflow_dispatch:/m);
assert.match(wf,/if: github\.ref == 'refs\/heads\/main' && github\.event_name == 'workflow_dispatch'/);
assert.match(wf,/environment: portfolio-production-gas/);
// Regression for P2: GitHub Actions concurrency is repository-wide, so the
// source check and the runtime GET must exclude production deployment writes.
// A distinct audit concurrency key permits the deployment to swap /exec
// after a valid v9.282 source readback but before getWriterGateStatus.
const auditJob=wf.split('\n  verify-published-gas:\n')[1];
assert.ok(auditJob,'read-only audit job must exist');
assert.match(auditJob,/concurrency:\s*\n\s+group: gas-production-deploy\s*\n\s+cancel-in-progress: false/);
const auditGroup=auditJob.match(/group: ([a-z-]+)\s*\n\s+cancel-in-progress:/)?.[1];
assert.equal(auditGroup,'gas-production-deploy');
const deployWorkflow=fs.readFileSync('.github/workflows/gas-deploy.yml','utf8');
const deployJob=deployWorkflow.split('\n  deploy:\n')[1];
assert.ok(deployJob,'production deploy job must exist');
assert.match(deployJob,/environment: portfolio-production-gas/);
assert.match(deployJob,/concurrency:\s*\n\s+group: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.dry_run && 'gas-deploy-dry-run' \|\| 'gas-production-deploy' \}\}\s*\n\s+cancel-in-progress: false/);
for(const scenario of [
 {event:'workflow_dispatch',dryRun:false},
 {event:'workflow_run',dryRun:false},
]){
 // The production branch of the real deploy expression must hold the same
 // lock as the audit; otherwise the tested v9.282 blob can become stale.
 const deployGroup=scenario.event==='workflow_dispatch' && scenario.dryRun
  ? 'gas-deploy-dry-run' : 'gas-production-deploy';
 assert.equal(auditGroup,deployGroup,
  'audit must not overlap a production deployment between source verification and runtime GET');
}
assert.match(wf,/node scripts\/audit-published-gas-gate-readonly\.mjs/);
assert.doesNotMatch(wf,/deploy-gas\.mjs|GAS_DEPLOY_DRY_RUN|workflow_run:|push:|schedule:/);
const real=fs.readFileSync('reference/gas-v9.282.gs','utf8');
assert.equal(gasSourceBlobSha(real),'9c1a5f31d1abc4b44f7da9af7a50fe3f15967134');
assert.equal(classifyPublishedGateSource(real).gateReadAllowed,true);
assert.equal(classifyPublishedGateSource(real+'\n').gateReadAllowed,false);
const newer=real.replaceAll('9.282','9.283');
assert.equal(classifyPublishedGateSource(newer).gateReadAllowed,false);
const older=real.replaceAll('9.282','9.281');
assert.equal(classifyPublishedGateSource(older).gateReadAllowed,false);
const url='https://script.google.com/macros/s/TEST_DEPLOYMENT/exec';
const secret='GAS_ACCESS_TOKEN_LONG_AND_PRIVATE_2026';
const oauth='GOOGLE_OAUTH_ACCESS_TOKEN_SAMPLE_LONG';
const scriptId='TEST_SCRIPT_ID';
const files=source=>[
 {name:'appsscript',type:'JSON',source:'{"timeZone":"Asia/Seoul"}'},
 {name:'apps_script',type:'SERVER_JS',source}];
const dep={deploymentConfig:{versionNumber:335,manifestFileName:'appsscript'},
 entryPoints:[{entryPointType:'WEB_APP',webApp:{url}}]};
let requests=[];
let pub=real,head=real;
let gate={status:'ok',gasVersion:'9.282',writerGate:{
 mode:'OPEN',activeCount:0,finished:2,repairAuthorized:false,
 approvalPresent:false}};
let projectFiles=()=>files(pub);
let response=val=>({ok:true,text:async()=>JSON.stringify(val)});
const fake=async (u,opts)=>{
 requests.push({url:u,method:opts.method});
 if(u.startsWith('https://script.googleapis.com/')){
  assert.equal(opts.method,'GET');
  assert.equal(opts.headers.Authorization,'Bearer '+oauth);
  if(u.includes('/deployments/TEST_DEPLOYMENT'))return response(dep);
  if(u.includes('?versionNumber=335'))return response({files:projectFiles()});
  if(u.endsWith('/content'))return response({files:files(head)});
  throw Error('unexpected Google endpoint');
 }
 assert.equal(new URL(u).origin,'https://script.google.com');
 assert.equal(opts.method,'GET');
 assert.equal(new URL(u).searchParams.get('action'),'getWriterGateStatus');
 assert.equal(new URL(u).searchParams.get('accessToken'),secret);
 return response(gate);
};
const args=()=>({scriptId,deploymentId:'TEST_DEPLOYMENT',
 webAppUrl:url,googleAccessToken:oauth,gasAccessToken:secret,fetchImpl:fake});
let r=await inspectPublishedGasReadOnly(args());
assert.equal(r.status,'LIVE_V9282_GATE_OPEN_CONFIRMED');
assert.equal(r.gateMode,'OPEN');
assert.equal(r.publishedVersion,'9.282');
assert.equal(r.publishedSourceApproved,true);
assert.equal(r.headEqualsPublished,true);
assert.equal(r.releaseAuthorized,false);
assert.equal(r.financeWrites,0);
assert.equal(requests.length,4);
assert.ok(!JSON.stringify(r).includes(secret));
assert.ok(!JSON.stringify(r).includes(oauth));
// The final cutover profile adds only an editor resume alias. Its exact pin
// allows the same metadata-only gate GET; bootstrap still cannot pass here.
requests=[];pub=head=loadCutoverSources().finalSource;
r=await inspectPublishedGasReadOnly(args());
assert.equal(r.status,'LIVE_V9282_GATE_OPEN_CONFIRMED');
assert.equal(requests.length,4);assert.equal(r.financeWrites,0);
assert.equal(classifyPublishedGateSource(pub+'\n').gateReadAllowed,false);
assert.equal(classifyPublishedGateSource(loadCutoverSources().bootstrapSource).gateReadAllowed,false);
pub=head=real;
// Published 9.281 and proposed 9.283 are unknown route contracts: NO runtime GET.
for(const source of [older,newer,real+'\n']){
 requests=[];pub=source;head=source;
 r=await inspectPublishedGasReadOnly(args());
 assert.equal(r.status,'BLOCKED');
 assert.equal(r.publishedSourceApproved,false);
 assert.equal(requests.length,3,'unreviewed published code must NOT invoke GAS');
}
// Real observed production baseline (audit run 41442800080): deployment
// versionNumber 336 contains exact v9.281 source. This is a recognized
// historical baseline, NOT an authorized writer gate runtime.
const legacy=fs.readFileSync('reference/gas-v9.281.gs','utf8');
assert.equal(gasSourceBlobSha(legacy),'ebe697563e94cf49e514037353260fce70ae1d57');
assert.equal(classifyPublishedGateSource(legacy).knownLegacyBaseline,true);
assert.equal(classifyPublishedGateSource(legacy).gateReadAllowed,false);
requests=[];pub=legacy;head=legacy;
r=await inspectPublishedGasReadOnly(args());
assert.equal(r.status,'BLOCKED');
assert.equal(r.baselineClassification,'APPROVED_LEGACY_V9281_NO_GATE_AUDIT');
assert.equal(r.historicalBaselineExactMatch,true);
assert.equal(r.publishedSourceApproved,false);
assert.equal(r.gateMode,'NOT_QUERIED');
assert.equal(r.releaseAuthorized,false);
assert.equal(requests.length,3,'legacy baseline must not call unreviewed GAS runtime');
requests=[];head=real; // Simulate source HEAD drift on the same old deployment.
r=await inspectPublishedGasReadOnly(args());
assert.equal(r.status,'BLOCKED');
assert.equal(r.baselineClassification,'APPROVED_LEGACY_V9281_NO_GATE_AUDIT');
assert.equal(r.historicalBaselineExactMatch,false);
assert.equal(r.headEqualsPublished,false);
assert.equal(requests.length,3);
pub=real;head=real+'\n';
requests=[];r=await inspectPublishedGasReadOnly(args());
assert.equal(r.status,'LIVE_V9282_GATE_OPEN_CONFIRMED');
assert.equal(r.headEqualsPublished,false,'report project HEAD drift separately');
assert.equal(requests.length,4);
head=real;
// Extra SERVER_JS could override doGet; no runtime request is safe.
projectFiles=()=>[...files(real),{name:'override',type:'SERVER_JS',source:'function doGet() {}'}];
requests=[];
await assert.rejects(()=>inspectPublishedGasReadOnly(args()),/PROJECT_FILES_INVALID/);
assert.equal(requests.length,3);
projectFiles=()=>files(pub);
// A stored approval or DRAINING gate must NEVER produce ready state.
for(const item of [
 {mode:'DRAINING',activeCount:0,approvalPresent:false},
 {mode:'OPEN',activeCount:0,approvalPresent:true},
 {mode:'OPEN',activeCount:1,approvalPresent:false}
]){
 requests=[];gate={status:'ok',gasVersion:'9.282',writerGate:{...item,repairAuthorized:false}};
 r=await inspectPublishedGasReadOnly(args());
 if(item.mode==='OPEN' && !item.approvalPresent)
  assert.equal(r.status,'LIVE_V9282_GATE_OPEN_CONFIRMED','ordinary active count does not imply drain');
 else assert.equal(r.status,'BLOCKED');
 assert.equal(requests.length,4);
}
// Missing approval field must NOT be interpreted as absence of approval.
requests=[];gate={status:'ok',gasVersion:'9.282',writerGate:{
 mode:'OPEN',activeCount:0,repairAuthorized:false}};
await assert.rejects(()=>inspectPublishedGasReadOnly(args()),/GATE_UNVERIFIED/);
assert.equal(requests.length,4);
requests=[];gate={status:'ok',gasVersion:'9.282',writerGate:{
 mode:'OPEN',activeCount:0,repairAuthorized:false,approvalPresent:false}};
await assert.rejects(()=>inspectPublishedGasReadOnly({
 ...args(),webAppUrl:'https://evil.example/exec'}),/WEBAPP_MISMATCH/);
assert.equal(requests.length,0);
await assert.rejects(()=>inspectPublishedGasReadOnly({
 ...args(),gasAccessToken:''}),/GAS_TOKEN_MISSING/);
assert.equal(requests.length,3,'credential failure must occur before runtime action');
// OAuth is a single POST, not an NH OAuth mint or any Script API write.
const clasp=JSON.stringify({tokens:{default:{client_id:'ID',client_secret:'SECRET',
 refresh_token:'REFRESH'}}});
const calls=[];
const access=await fetchGoogleAuditToken({clasprc:clasp,fetchImpl:async(u,opts)=>{
 calls.push({url:u,method:opts.method,body:new URLSearchParams(opts.body)});
 return response({access_token:oauth});
}});
assert.equal(access,oauth);
assert.equal(calls.length,1);
assert.equal(calls[0].url,'https://oauth2.googleapis.com/token');
assert.equal(calls[0].method,'POST');
assert.equal(calls[0].body.get('grant_type'),'refresh_token');
assert.equal(calls[0].body.get('refresh_token'),'REFRESH');
assert.ok(!JSON.stringify(r).includes('SECRET') && !JSON.stringify(r).includes('REFRESH'));

console.log('GAS_PUBLISHED_READONLY_CONTRACT_PASS: exact 9.281 legacy BLOCKED, v9.282 gate allowlist, HEAD drift, no unknown runtime, approval state, no writes');
