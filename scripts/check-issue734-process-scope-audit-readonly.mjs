#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {inspectGoogleProcessScope,inspectScopeResult}
 from './issue734-process-scope-audit-readonly.mjs';

const scope='https://www.googleapis.com/auth/script.processes';
const other='https://www.googleapis.com/auth/script.projects';
assert.deepEqual(inspectScopeResult({scope:other}).status,'PROCESS_SCOPE_MISSING');
assert.equal(inspectScopeResult({scope:other}).missingScopeRequiresUserAuthorization,true);
assert.equal(inspectScopeResult({scope:scope+' '+other}).hasProcessScope,true);
assert.equal(inspectScopeResult({scope:'https://fake.example/auth/script.processes'}).hasProcessScope,false);
assert.throws(()=>inspectScopeResult({scope:[]}),/ISSUE734_PROCESS_SCOPE_RESPONSE_SCHEMA/);
assert.throws(()=>inspectScopeResult({scope:''}),/ISSUE734_PROCESS_SCOPE_RESPONSE_SCHEMA/);

const token='private-test-token-123456789';
let calls=0;
const report=await inspectGoogleProcessScope({token,fetchImpl:async(url,request)=>{
 calls++;
 const u=new URL(url);
 assert.equal(u.origin,'https://oauth2.googleapis.com');
 assert.equal(u.pathname,'/tokeninfo');
 assert.equal(u.searchParams.get('access_token'),token);
 assert.equal(request.method,'GET');
 assert.equal(request.redirect,'error');
 assert.equal(request.body,undefined);
 return {ok:true,json:async()=>({scope:other,
   email:'DO_NOT_LOG@EXAMPLE.COM',aud:'PRIVATE_CLIENT_ID'})};
}});
assert.equal(calls,1);
assert.equal(report.status,'PROCESS_SCOPE_MISSING');
assert.equal(report.processExecutionStatusVerified,false);
assert.equal(report.executionUidAvailableInProcessApi,false);
assert.equal(report.triggerUidIsExecutionUid,false);
assert.equal(report.exactWriterGateOwnerVerified,false);
const granted=inspectScopeResult({scope:scope+' '+other});
assert.equal(granted.hasProcessScope,true);
assert.equal(granted.executionUidAvailableInProcessApi,false,
 'OAuth grant can expose execution status, never a unique execution UID');
assert.equal(report.approvedForWriterCleanup,false);
assert.equal(report.approvedForTradeMigration,false);
assert.equal(report.scriptPropertyWrites,0);
assert.equal(report.financeWrites,0);
assert(!JSON.stringify(report).includes('DO_NOT_LOG'));
assert(!JSON.stringify(report).includes(token));
assert(!JSON.stringify(report).includes(other));
await assert.rejects(()=>inspectGoogleProcessScope({token,
 fetchImpl:async()=>({ok:false,status:401})}),
 /ISSUE734_PROCESS_SCOPE_TOKEN_INVALID/);
await assert.rejects(()=>inspectGoogleProcessScope({token,
 fetchImpl:async()=>({ok:false,status:403})}),
 /ISSUE734_PROCESS_SCOPE_HTTP_UNVERIFIED/);
await assert.rejects(()=>inspectGoogleProcessScope({token,
 fetchImpl:async()=>{throw Error('DO_NOT_LOG');}}),
 /ISSUE734_PROCESS_SCOPE_NETWORK/);
await assert.rejects(()=>inspectGoogleProcessScope({token,
 fetchImpl:async()=>({ok:true,json:async()=>({email:'PRIVATE'})})}),
 /ISSUE734_PROCESS_SCOPE_RESPONSE_SCHEMA/);
// Test the actual workflow source. Automatic PR/push may run offline tests;
// only the main-branch manual workflow may call Google's tokeninfo endpoint.
const auditYaml=fs.readFileSync('.github/workflows/issue734-process-scope-audit-readonly.yml','utf8');
function enforceManualScopeAudit(source){
 const doc=YAML.parseDocument(source,{version:'1.2',uniqueKeys:true});
 assert.equal(doc.errors.length,0);
 const cfg=doc.toJS({maxAliasCount:0});
 assert.ok(Object.hasOwn(cfg.on,'workflow_dispatch'));
 assert.equal(cfg.on.schedule,undefined);
 assert.ok(cfg.on.push&&cfg.on.pull_request);
 assert.deepEqual(cfg.permissions,{contents:'read'});
 const job=cfg.jobs['scope-audit'];
 assert.equal(job.needs,'source-check');
 assert.equal(job.environment,'portfolio-production-gas');
 assert.equal(job.if,"github.repository == 'cyyoung111-dev/portfolio' && github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch' && github.run_attempt == 1");
 assert.ok(String(job.env.CLASPRC_JSON).includes('secrets.CLASPRC_JSON'));
 assert.equal(job.steps.at(-1).run,'node scripts/issue734-process-scope-audit-readonly.mjs');
}
enforceManualScopeAudit(auditYaml);
assert.throws(()=>enforceManualScopeAudit(auditYaml.replace(
 "github.event_name == 'workflow_dispatch' && github.run_attempt == 1",
 "github.event_name != 'pull_request' && github.run_attempt == 1")));
assert.throws(()=>enforceManualScopeAudit(auditYaml.replace(
 '  workflow_dispatch:',
 '  schedule:' + String.fromCharCode(10) + '    - cron: 0 0 * * *' + String.fromCharCode(10) + '  workflow_dispatch:')));
console.log(JSON.stringify({kind:'ISSUE734_PROCESS_SCOPE_SOURCE_PASS',
 negativeScenarios:8,diagnosticOnly:true,oauthCredentialChanges:0,
 gasWrites:0,financialWrites:0}));
