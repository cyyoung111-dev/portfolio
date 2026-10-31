// Issue #507 -- deterministic read-only inventory of version-bound consumers.
// This is not a release approval, migration script, or external API call.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareIssue507ProposedRelease} from './prepare-issue507-proposed-release.mjs';
import {assertGasReleaseReady} from './deploy-gas.mjs';

export const BASE_VERSION='9.281';
export const PROPOSED_VERSION='9.282';
export const REQUIRED_OPERATING_CONSUMERS=Object.freeze([
 'src/web/features/settings/settings_fetch.js',
 'scripts/collect-kb-fund-nav.mjs',
 'scripts/run-issue507-backlog.mjs',
 'scripts/run-incomplete-close-resume.mjs',
 'scripts/run-historical-checkpoint-reconcile.mjs',
 'scripts/run-dividend-source-refresh.mjs',
 'scripts/nh-index-probe.mjs',
 'scripts/nhplug-gas-held-universe-readonly-bridge.mjs',
]);

const include=file=>/\.(?:js|mjs|cjs)$/.test(file);
const norm=file=>file.split(path.sep).join('/');
function filesWithin(root,relative){
 const dir=path.join(root,relative);
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>{
  const filename=norm(path.join(relative,item.name));
  if(item.isDirectory())return filesWithin(root,filename);
  return item.isFile() && include(filename)?[filename]:[];
 });
}
export function auditIssue507VersionConsumers({
 root=process.cwd(),
 files=null,
 readText=file=>fs.readFileSync(path.join(root,file),'utf8'),
}={}){
 const source=readText('src/gas/apps_script.gs');
 if(assertGasReleaseReady(source)!==BASE_VERSION)
   throw Error('ISSUE507_BASE_GAS_SOURCE_UNAPPROVED');
 const proposed=prepareIssue507ProposedRelease({source});
 if(proposed.manifest.proposedVersion!==PROPOSED_VERSION
    || proposed.manifest.deployable!==false || proposed.manifest.webVersionChanged!==false)
   throw Error('ISSUE507_CANDIDATE_MUST_STAY_STAGED');
 const webFile='src/web/features/settings/settings_fetch.js';
 const web=readText(webFile);
 const declared=[...web.matchAll(/\bconst\s+EXPECTED_GAS_VERSION\s*=\s*['"]([^'"]+)['"]/g)];
 if(declared.length!==1||declared[0][1]!==BASE_VERSION)
   throw Error('ISSUE507_EXPECTED_WEB_VERSION_CHANGED');

 const sources=(files??[
  ...filesWithin(root,'src/web'),
  ...filesWithin(root,'scripts'),
 ]).filter(include).map(norm).sort();
 const refs=[];
 for(const file of sources){
   const text=readText(file);
   const lines=text.split(/\r?\n/);
   for(let i=0;i<lines.length;i++){
     const line=lines[i];
     // An observable consumer pin, not an arbitrary date or historical note.
     // Report location and class, never source contents or endpoint credentials.
     const direct=/\b(?:gasVersion|EXPECTED_GAS_VERSION)\b[^\n]{0,220}['"]9\.281['"]|['"]9\.281['"][^\n]{0,220}\b(?:gasVersion|EXPECTED_GAS_VERSION)\b/.test(line);
     if(!direct)continue;
     const kind=file.startsWith('src/web/')?'web':
       path.basename(file).startsWith('check-')?'test':'operational_or_support';
     refs.push({file,line:i+1,kind});
   }
 }
 const required=REQUIRED_OPERATING_CONSUMERS.map(file=>{
   const found=refs.filter(x=>x.file===file);
   if(!found.length)throw Error('ISSUE507_REQUIRED_CONSUMER_PIN_MISSING:'+file);
   return {file,lines:found.map(x=>x.line)};
 });
 const productionPins=refs.filter(x=>x.kind!=='test');
 if(productionPins.length<required.length)
   throw Error('ISSUE507_RUNTIME_CONSUMERS_UNDERCOUNTED');
 return Object.freeze({
   status:'BLOCKED_LIVE_RELEASE',
   baseVersion:BASE_VERSION,
   proposedVersion:PROPOSED_VERSION,
   requiredConsumers:required,
   productionPinCount:productionPins.length,
   testPinCount:refs.length-productionPins.length,
   allVersionPins:refs,
   scannedFileCount:sources.length,
   versionMigrationPerformed:false,
   productionGasChanged:false,
   financeMutationPerformed:false,
   readyForDeployment:false,
 });
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const r=auditIssue507VersionConsumers();
 console.log(JSON.stringify({
  status:r.status,baseVersion:r.baseVersion,proposedVersion:r.proposedVersion,
  scannedFileCount:r.scannedFileCount,productionPinCount:r.productionPinCount,
  testPinCount:r.testPinCount,requiredConsumers:r.requiredConsumers,
  readyForDeployment:r.readyForDeployment,financeMutationPerformed:r.financeMutationPerformed,
 }));
}
