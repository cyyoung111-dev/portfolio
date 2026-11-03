// Privacy-safe static references for the KNOWN GAS project deployments.
// This is NOT access logging, service activity, external writer isolation or
// permission to delete an old deployment. Never return IDs, URLs or source.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

const PATH_ALLOW=/^(?:src\/web\/|scripts\/|\.github\/workflows\/)/;
const FILE_ALLOW=/\.(?:mjs|js|gs|html|json|ya?ml)$/i;
const TEST_EXCLUDE=/(?:^|\/)(?:test|tests|fixtures|__tests__)(?:\/|$)|(?:^|\/)(?:check-|test-)/;
const MAX_FILES=1500;
const MAX_FILE_BYTES=1200000;

export function scanDeploymentReferences({entries,expectedDeploymentId,files}) {
  if(!Array.isArray(entries)||entries.length>200||typeof expectedDeploymentId!=='string'||
      !Array.isArray(files)||files.length>MAX_FILES)
    throw Error('ISSUE507_REFERENCE_INPUT_UNVERIFIED');
  const ids=entries.filter(e=>!e.head).map(e=>e.id);
  if(ids.length>100||ids.some(id=>typeof id!=='string'||!/^[-A-Za-z0-9_]{8,160}$/.test(id)))
    throw Error('ISSUE507_REFERENCE_IDS_UNVERIFIED');
  const seen=new Set();
  let runtimeFiles=0,expectedFiles=0,additionalFiles=0,additionalMatched=0;
  let workflowEnvGASRefs=0,clientStoredEndpointFiles=0;
  const matchedAdditional=new Set();
  for(const item of files){
    const path=item?.path,source=item?.content;
    if(typeof path!=='string'||!PATH_ALLOW.test(path)||!FILE_ALLOW.test(path)
      ||TEST_EXCLUDE.test(path)||typeof source!=='string'||source.length>MAX_FILE_BYTES)
      throw Error('ISSUE507_REFERENCE_FILES_UNVERIFIED');
    if(seen.has(path))throw Error('ISSUE507_REFERENCE_DUPLICATE_FILE');
    seen.add(path);runtimeFiles++;
    if(path.startsWith('.github/workflows/')&&
      /\b(?:GAS_WEB_APP_URL|GAS_DEPLOYMENT_ID)\b/.test(source))workflowEnvGASRefs++;
    if(path.startsWith('src/web/')&&
      /\b(?:gsheet_api_url|saveGsheetUrl|GSHEET_API_URL)\b/.test(source))clientStoredEndpointFiles++;
    if(source.includes(expectedDeploymentId))expectedFiles++;
    let hits=0;
    for(const id of ids){
      if(id===expectedDeploymentId)continue;
      if(source.includes(id)){hits++;matchedAdditional.add(id);}
    }
    if(hits){additionalFiles++;additionalMatched+=hits;}
  }
  return {
    runtimeSourceFilesScanned:runtimeFiles,
    expectedLiteralReferenceFiles:expectedFiles,
    additionalLiteralReferenceFiles:additionalFiles,
    additionalMatchedDeploymentCount:matchedAdditional.size,
    additionalLiteralReferencePairs:additionalMatched,
    dynamicWorkflowConfigFiles:workflowEnvGASRefs,
    browserConfigurableEndpointFiles:clientStoredEndpointFiles,
    // Static absence is never evidence of actual inactivity.
    oldDeploymentUnusedVerified:false,
    externalClientUsageVerified:false,
    externalSheetWritersExcludedVerified:false,
    deploymentRemovalAuthorized:false
  };
}
export function loadTrackedRuntimeSources(){
  let output;
  try {
    output=execFileSync('git',['ls-files','-z','--','src/web','.github/workflows','scripts'],
      {encoding:'utf8',maxBuffer:2_000_000,timeout:10000});
  } catch { throw Error('ISSUE507_REFERENCE_GIT_UNVERIFIED'); }
  if(typeof output!=='string')throw Error('ISSUE507_REFERENCE_GIT_UNVERIFIED');
  const names=output.split('\0').filter(Boolean).filter(p=>PATH_ALLOW.test(p)&&
    FILE_ALLOW.test(p)&&!TEST_EXCLUDE.test(p));
  if(!names.length||names.length>MAX_FILES)
    throw Error('ISSUE507_REFERENCE_FILE_COUNT_UNVERIFIED');
  return names.map(path=>{
    let data;
    try {
      const stat=fs.lstatSync(path);
      if(!stat.isFile()||stat.size>MAX_FILE_BYTES)throw Error('invalid');
      data=fs.readFileSync(path,'utf8');
    } catch {throw Error('ISSUE507_REFERENCE_READ_UNVERIFIED');}
    return {path,content:data};
  });
}
