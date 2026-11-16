import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {verifyGas9295ReleaseReadOnly} from './issue734-gas9295-release-readonly.mjs';
import {probeTradeHash} from './issue734-trade-v2-hash-readonly.mjs';
export async function verifyGas9296PostDeploy({url,token,fetchImpl=fetch}){
 const state=await verifyGas9295ReleaseReadOnly({url,token,fetchImpl,expectedVersion:'9.296'});
 const proof=await probeTradeHash({url,token,fetchImpl,includeMigrationPreview:true});
 if(proof.status!=='CONSISTENT'||proof.rows!==state.tradeRows
  ||proof.uniqueIds!==state.tradeRows||proof.migrationPreview?.status!=='VERIFIED'
  ||proof.migrationPreview.physicalRevisionMatchesGasGetTrades!==true
  ||proof.migrationPreview.physicalRevisionMatchesPcCanonical!==true)
  throw Error('GAS9296_READONLY_HASH_MISMATCH');
 return {...state,kind:'GAS9296_UTF8_READBACK_VERIFIED',
  pcAndPhysicalRevisionMatch:true,financeWrites:0};
}
export async function verifyGas9296WithRetry({verify,
 delay=ms=>new Promise(r=>setTimeout(r,ms))}){
 for(let attempt=1;attempt<=3;attempt++){
  try{const result=await verify();
   if(result?.status!=='VERIFIED'||result.version!=='9.296'||result.financeWrites!==0
    ||result.pcAndPhysicalRevisionMatch!==true)throw Error('GAS9296_POSTDEPLOY_PROOF_INVALID');
   return {...result,readbackAttempts:attempt};}
  catch(e){if(!['GAS9295_READONLY_VERSION_MISMATCH','GAS9296_READONLY_HASH_MISMATCH']
   .includes(e?.message)||attempt===3)throw e;
   await delay(3000*attempt);
  }
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const mode=process.argv[2],cfg={url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN};
  if(!['pre','post'].includes(mode))throw Error('GAS9296_CLI_MODE_INVALID');
  const result=mode==='pre'?await verifyGas9295ReleaseReadOnly({...cfg,expectedVersion:'9.295'}):
   await verifyGas9296WithRetry({verify:()=>verifyGas9296PostDeploy(cfg)});
  console.log(JSON.stringify(result));
  if(mode==='pre'&&process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'verified=true\n');
 }catch(e){const code=String(e?.message||'');
  console.error(/^GAS(?:9295|9296)_[A-Z_]+$/.test(code)?code:'GAS9296_READONLY_UNVERIFIED');
  process.exitCode=2;
 }
}
