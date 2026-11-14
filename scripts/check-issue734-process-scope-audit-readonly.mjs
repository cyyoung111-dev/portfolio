#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
// Test the actual workflow source. Only manual dispatch launches this
// wrapper; the exact same offline test stays in mandatory check:ci.
const auditYaml=fs.readFileSync('.github/workflows/issue734-process-scope-audit-readonly.yml','utf8');
function enforceManualScopeAudit(source){
 assert.match(source,/^  workflow_dispatch:\s*$/m);
 assert.doesNotMatch(source,/^  schedule:\s*$/m);
 assert.doesNotMatch(source,/^  pull_request:\s*$/m);
 assert.doesNotMatch(source,/^  push:\s*$/m);
 assert.match(source,/^  scope-audit:\s*$/m);
 assert.match(source,/^    environment: portfolio-production-gas\s*$/m);
 assert.match(source,/^    needs: source-check\s*$/m);
 assert.match(source,/^      CLASPRC_JSON: .*secrets\.CLASPRC_JSON/m);
 assert.match(source,/^        run: node scripts\/issue734-process-scope-audit-readonly\.mjs$/m);
 const expected="    if: github.repository == 'cyyoung111-dev/portfolio' && github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch' && github.run_attempt == 1";
 assert.ok(source.split('\n').includes(expected),
  'live OAuth tokeninfo must be main-only manual dispatch');
}
enforceManualScopeAudit(auditYaml);
assert.throws(()=>enforceManualScopeAudit(auditYaml.replace(
 "github.event_name == 'workflow_dispatch' && github.run_attempt == 1",
 "github.event_name != 'pull_request' && github.run_attempt == 1")));
assert.throws(()=>enforceManualScopeAudit(auditYaml.replace(
 '  workflow_dispatch:',
 '  push:' + String.fromCharCode(10) + '    branches: [main]' + String.fromCharCode(10) + '  workflow_dispatch:')));
assert.throws(()=>enforceManualScopeAudit(auditYaml.replace(
 '  workflow_dispatch:',
 '  schedule:' + String.fromCharCode(10) + '    - cron: 0 0 * * *' + String.fromCharCode(10) + '  workflow_dispatch:')));
const packageScripts=JSON.parse(fs.readFileSync('package.json','utf8')).scripts;
assert.match(packageScripts['check:ci'],/node scripts\/check-issue734-process-scope-audit-readonly\.mjs/,
 'manual-only OAuth workflow must retain mandatory PR/main source check');
console.log(JSON.stringify({kind:'ISSUE734_PROCESS_SCOPE_SOURCE_PASS',
 negativeScenarios:8,diagnosticOnly:true,oauthCredentialChanges:0,
 gasWrites:0,financialWrites:0}));
