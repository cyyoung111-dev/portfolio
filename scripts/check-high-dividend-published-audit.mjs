import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {expectedBusinessYear,preparePublishedCandidate,auditPublishedCatalog} from './audit-high-dividend-published.mjs';
const now=new Date('2026-11-19T13:30:00Z'),token='FAKE_PRIVATE_TOKEN';
const row={businessYear:2025,listedCode:'005930',issuerName:'FAKE_PRIVATE_NAME',market:'KOSPI',taxEligibility:'UNVERIFIED',identityState:'EXACT_LISTED_ISSUER'};
const catalog={schemaVersion:1,classification:'CANDIDATE_ONLY',source:'https://kind.krx.co.kr/valueup/dividend.do?method=valueupHighDividendMain',businessYear:2025,retrievedAt:'2026-11-18T23:41:14+09:00',sourceSha256:'a'.repeat(64),masterSha256:'b'.repeat(64),total:2,rows:[row],unresolved:[{issuerName:'unresolved'}],reviewChanges:[],recheckCodes:['005930']};
assert.equal(expectedBusinessYear(new Date('2026-12-31T15:00:00Z')),2026);
assert.equal(preparePublishedCandidate(catalog,now).correctionReviewCount,1);
assert.throws(()=>preparePublishedCandidate({...catalog,retrievedAt:'2026-11-01T00:00:00Z'},now),/STALE/);
assert.throws(()=>preparePublishedCandidate({...catalog,retrievedAt:'2026-11-20T00:00:00Z'},now),/STALE/);
assert.throws(()=>preparePublishedCandidate({...catalog,businessYear:2024},now),/CATALOG|YEAR/);
assert.throws(()=>preparePublishedCandidate({...catalog,total:1},now),/CATALOG/);
assert.throws(()=>preparePublishedCandidate({...catalog,recheckCodes:['005930','005930']},now),/REVIEW/);
const actions=[];
const fetchImpl=async(_url,opt)=>{
 const action=opt.body.get('action');actions.push(action);
 const denied=opt.body.get('accessToken')!==token;
 return {ok:true,json:async()=>denied?{status:'error',message:'인증 실패'}:action==='getCodeListReadOnly'?
 {status:'ok',readOnly:true,gasVersion:'9.302',codes:[{code:'005930',name:row.issuerName,market:'KOSPI',type:'주식',currency:'KRW'}]}:
 {status:'ok',trades:[{code:'005930',acct:'PRIVATE_ACCOUNT'}]}};
};
const result=await auditPublishedCatalog({catalog,now,url:'https://script.google.com/macros/s/TEST/exec',token,fetchImpl});
assert.deepEqual(actions,['getCodeListReadOnly','getCodeListReadOnly','getTrades']);
assert.equal(result.kind,'HIGH_DIVIDEND_PUBLISHED_AUDIT');assert.equal(result.candidateSymbols,1);
assert.equal(result.correctionReviewCount,1);assert.equal(result.taxEligibilityVerified,false);
assert.equal(result.financeWrites,0);assert.equal(result.catalogWrites,0);
assert.doesNotMatch(JSON.stringify(result),/FAKE_PRIVATE_NAME|PRIVATE_ACCOUNT|FAKE_PRIVATE_TOKEN|005930/);
let calls=0;await assert.rejects(()=>auditPublishedCatalog({catalog:{...catalog,total:99},now,fetchImpl:async()=>{calls++;}}),/CATALOG/);assert.equal(calls,0);
const wf=YAML.parse(fs.readFileSync(new URL('../.github/workflows/high-dividend-published-audit-readonly.yml',import.meta.url),'utf8'));
assert.deepEqual(Object.keys(wf.on).sort(),['push','workflow_dispatch']);
assert.deepEqual(wf.on.push.paths,['.github/workflows/high-dividend-published-audit-readonly.yml']);
assert.deepEqual(wf.permissions,{contents:'read'});
const job=wf.jobs.audit;assert.equal(job.environment,'portfolio-production-gas');assert.equal(job.concurrency.group,'gas-production-deploy');assert.equal(job.concurrency['cancel-in-progress'],false);
assert.match(job.if,/github.run_attempt == 1/);
assert.equal(job.steps.find(s=>s.with?.path==='published-kind').with.ref,'high-dividend-companies');
assert.equal(job.steps.at(-1).run,'node scripts/audit-high-dividend-published.mjs');
assert.equal(job.steps.filter(s=>JSON.stringify(s).includes('secrets.')).length,1);
console.log('PASS: validated published KIND catalog, exact historical-code audit without collection or publication, no eligibility inference');
