// Issue #507: proof-only integration candidate assembler.
// It NEVER writes src/gas/apps_script.gs, changes a GAS version/endpoint,
// requests tokens, or deploys. Do not expose the assembled source via API/log.
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {PRIVATE_GAS_FUNCTION} from './issue507-oct30-private-percode-proof-proposal.mjs';
import {PRIVATE_LIVE_READONLY_FUNCTION}
 from './issue507-oct30-private-live-readonly-probe-proposal.mjs';
import {PRIVATE_RUN_GAS_FUNCTION}
 from './issue507-oct30-private-manual-execution-guard-proposal.mjs';

export const FROZEN_GAS_BLOB='9c1a5f31d1abc4b44f7da9af7a50fe3f15967134';
const names=[
 '_issue507Oct30PrivateQuoteProof_',
 '_issue507Oct30PrivateLiveReadOnlyProof_',
 '_issue507Oct30GuardedPrivateReadOnlyRun_'
];
const candidates=[PRIVATE_GAS_FUNCTION,PRIVATE_LIVE_READONLY_FUNCTION,PRIVATE_RUN_GAS_FUNCTION];
const forbid=/\b(?:setValues|setValue|appendRow|appendRows|setProperty|deleteProperty|deleteRow|deleteRows|insertSheet|deleteSheet|UrlFetchApp|ScriptApp|fetch|eval)\s*\(/;
function stop(s){throw Error('ISSUE507_OCT30_PACKAGING_'+s);}
export function assembleOct30ReadOnlyReleaseDryRun(production){
 if(typeof production!=='string'||!production.length)stop('PRODUCTION_SOURCE_MISSING');
 const buf=Buffer.from(production,'utf8');
 const sha=createHash('sha1').update('blob '+buf.length+'\0').update(buf).digest('hex');
 if(sha!==FROZEN_GAS_BLOB)stop('FROZEN_SOURCE_DRIFT');
 if(candidates.some((source,i)=>typeof source!=='string'
   ||source.indexOf('function '+names[i]+'(')<0
   ||forbid.test(source)))stop('UNSAFE_CANDIDATE_SOURCE');
 for(const fn of names){
   if(production.includes('function '+fn+'('))stop('ALREADY_RELEASED');
 }
 const source=candidates.join('\n');
 const joined=production+'\n'+source;
 try {new vm.Script(joined,{filename:'issue507-private-proof-candidate.gs'});}
 catch {stop('SYNTAX_INVALID');}
 const expectedFunctions=names.every(name=>
   joined.indexOf('function '+name+'(')>=0&&
   joined.indexOf('function '+name+'(')===joined.lastIndexOf('function '+name+'('));
 if(!expectedFunctions)stop('FUNCTION_COLLISION');
 const pre=production.slice(production.indexOf('function doPost('),
   production.indexOf('\n}',production.indexOf('function doPost('))+2);
 const get=production.slice(production.indexOf('function doGet('),
   production.indexOf('\n}',production.indexOf('function doGet('))+2);
 if(names.some(name=>pre.includes(name)||get.includes(name)))stop('PUBLIC_ROUTE_EXPOSED');
 return {
  candidateSource:source, // internal tests only: do not publish/log
  summary:Object.freeze({
   mode:'ISSUE507_OCT30_GAS_IN_MEMORY_RELEASE_CANDIDATE',
   status:'SOURCE_COMPOSED_TEST_ONLY',frozenSourceBlob:sha,
   privateFunctionCount:3, publicRouteAdded:false,
   productionGasFileModified:false,sourceWrittenToDisk:false,
   actualGasVersionCreated:false,gasDeployed:false,
   scriptPropertiesChanged:false,financialWrites:0,
   userApprovedDeploy:false,userApprovedFinanceWrite:false,
   authorizedToRunInProduction:false
  })
 };
}
