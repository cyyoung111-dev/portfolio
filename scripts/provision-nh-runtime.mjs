import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,randomBytes,publicEncrypt,privateDecrypt,createCipheriv,createDecipheriv,constants} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {activateNhRuntime} from './activate-nh-gas-runtime.mjs';
const REPO='cyyoung111-dev/portfolio';
function validContext(c){return c?.repository===REPO&&/^[1-9]\d{0,19}$/.test(c.runId||'')&&c.attempt==='1'&&/^[a-f0-9]{40}$/.test(c.sha||'');}
const aad=c=>Buffer.from(JSON.stringify({repository:c.repository,runId:c.runId,attempt:c.attempt,sha:c.sha}));
export function makePublicBundle(context){
  if(!validContext(context))throw Error('NH_PROVISION_CONTEXT_INVALID');
  const pair=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  return {publicBundle:{...context,publicKey:pair.publicKey},privateKey:pair.privateKey};
}
export function sealCredentials(bundle,context,{key,secret}){
  if(!validContext(context)||!aad(context).equals(aad(bundle))||!key||!secret||key.length>2048||secret.length>2048)throw Error('NH_PROVISION_INPUT_INVALID');
  try{
    const aes=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',aes,iv);cipher.setAAD(aad(context));
    const ciphertext=Buffer.concat([cipher.update(JSON.stringify({key,secret}),'utf8'),cipher.final()]);
    return {...context,wrappedKey:publicEncrypt({key:bundle.publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},aes).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
  }catch{throw Error('NH_PROVISION_SEAL_FAILED');}
}
export function openCredentials(envelope,context,privateKey){
  if(!validContext(context)||!aad(context).equals(aad(envelope)))throw Error('NH_PROVISION_CONTEXT_MISMATCH');
  try{
    for(const name of ['wrappedKey','iv','tag','ciphertext'])if(typeof envelope[name]!=='string'||envelope[name].length>16000||!/^[A-Za-z0-9+/]+={0,2}$/.test(envelope[name]))throw Error();
    const aes=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope.wrappedKey,'base64'));
    const decipher=createDecipheriv('aes-256-gcm',aes,Buffer.from(envelope.iv,'base64'));decipher.setAAD(aad(context));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
    const data=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString('utf8'));
    if(typeof data.key!=='string'||!data.key||data.key.length>2048||typeof data.secret!=='string'||!data.secret||data.secret.length>2048)throw Error();
    return data;
  }catch{throw Error('NH_PROVISION_DECRYPT_FAILED');}
}
export async function readRunArtifact(name,file,context,{token,request=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>Date.now()}={}){
  if(!validContext(context)||!token||!['public.json','envelope.json'].includes(file)||!['nh-public-','nh-sealed-'].some(prefix=>name===prefix+context.runId+'-'+context.attempt))throw Error('NH_PROVISION_ARTIFACT_INPUT_INVALID');
  const deadline=now()+180000;
  while(now()<deadline){
    try{
      const headers={authorization:'Bearer '+token,accept:'application/vnd.github+json'};
      const response=await request(`https://api.github.com/repos/${REPO}/actions/runs/${context.runId}/artifacts?per_page=100`,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error();
      const data=await response.json();if(!Array.isArray(data.artifacts)||!Number.isSafeInteger(data.total_count)||data.total_count>100)throw Error();
      const candidates=data.artifacts.filter(a=>a.name===name&&!a.expired);
      if(candidates.length>1)throw Error();
      if(candidates.length===1){
        const found=candidates[0];if(!Number.isSafeInteger(found.id)||found.id<1||!Number.isFinite(found.size_in_bytes)||found.size_in_bytes<1||found.size_in_bytes>65536)throw Error();
        const download=await request(`https://api.github.com/repos/${REPO}/actions/artifacts/${found.id}/zip`,{headers,redirect:'follow',signal:AbortSignal.timeout(20000)});
        if(!download.ok)throw Error();
        const bytes=Buffer.from(await download.arrayBuffer());if(!bytes.length||bytes.length>65536)throw Error();
        const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nh-sealed-'));
        try{const zip=path.join(dir,'artifact.zip');fs.writeFileSync(zip,bytes,{mode:0o600});return JSON.parse(execFileSync('unzip',['-p',zip,file],{maxBuffer:65536,stdio:['ignore','pipe','pipe']}).toString('utf8'));}
        finally{fs.rmSync(dir,{recursive:true,force:true});}
      }
    }catch{throw Error('NH_PROVISION_ARTIFACT_INVALID');}
    await wait(5000);
  }
  throw Error('NH_PROVISION_ARTIFACT_TIMEOUT');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const context={repository:process.env.GITHUB_REPOSITORY,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,sha:process.env.GITHUB_SHA};
  const dir='.nh-runtime-provision';
  try{
    if(process.env.GITHUB_REF!=='refs/heads/main'||!validContext(context))throw Error('NH_PROVISION_MAIN_REQUIRED');
    if(process.argv[2]==='prepare'){
      const bundle=makePublicBundle(context);fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(dir+'/private.pem',bundle.privateKey,{mode:0o600});fs.writeFileSync(dir+'/public.json',JSON.stringify(bundle.publicBundle));
      console.log('NH_PROVISION_PUBLIC_KEY_READY');
    }else if(process.argv[2]==='seal'){
      const bundle=await readRunArtifact('nh-public-'+context.runId+'-'+context.attempt,'public.json',context,{token:process.env.GITHUB_TOKEN});
      const envelope=sealCredentials(bundle,context,{key:process.env.NHPLUG_APP_KEY,secret:process.env.NHPLUG_APP_SECRET});fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/envelope.json',JSON.stringify(envelope));console.log('NH_PROVISION_SEALED');
    }else if(process.argv[2]==='activate'){
      try{
        const envelope=await readRunArtifact('nh-sealed-'+context.runId+'-'+context.attempt,'envelope.json',context,{token:process.env.GITHUB_TOKEN});
        const credentials=openCredentials(envelope,context,fs.readFileSync(dir+'/private.pem','utf8'));
        // Keep plaintext only inside this protected production job's process.
        console.log(JSON.stringify(await activateNhRuntime({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,...credentials})));
      }finally{fs.rmSync(dir,{recursive:true,force:true});}
    }else throw Error('NH_PROVISION_MODE_INVALID');
  }catch(error){console.error(/^NH_(?:PROVISION|RUNTIME)_[A-Z_]+$/.test(error?.message||'')?error.message:'NH_PROVISION_FAILED');process.exitCode=1;}
}
