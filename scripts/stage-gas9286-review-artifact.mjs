// Prepare a reviewable, immutable GAS 9.286 source artifact. NEVER deploy or write Sheets.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {composeGas9286IntegratedPreview} from './compose-gas9286-integrated-preview.mjs';
const {candidate,manifest}=composeGas9286IntegratedPreview();
if(manifest.proposedVersion!=='9.286'||manifest.status!=='SOURCE_PREVIEW_NOT_DEPLOYABLE'||
   manifest.productionDeploymentApproved!==false||manifest.gasProjectWrites!==0||
   manifest.financeWrites!==0||!manifest.requiresProductionMigration)
 throw Error('GAS9286_RELEASE_GATE_NOT_READY');
const bytes=Buffer.from(candidate,'utf8');
const sha1=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
if(sha1!==manifest.candidateSourceGitBlob)throw Error('GAS9286_SOURCE_HASH_MISMATCH');
const out=path.resolve(process.env.GAS9286_ARTIFACT_DIR||'artifacts/gas9286-review');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'gas-v9.286.preview.gs'),candidate,'utf8');
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({
 ...manifest,sourceSha256:createHash('sha256').update(bytes).digest('hex'),
 generatedFromCommit:process.env.GITHUB_SHA||'LOCAL_UNPINNED',
 releaseDecision:'BLOCKED_PENDING_AUTHENTICATED_MIGRATION_AND_WRITER_GATE',
 productionDeploymentApproved:false
},null,2)+'\n');
console.log('GAS9286_REVIEW_ARTIFACT_READY sourceBlob='+sha1+' deploy=BLOCKED');
