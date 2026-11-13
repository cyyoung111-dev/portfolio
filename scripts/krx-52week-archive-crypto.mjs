// Protect KRX daily raw OHLC in publicly readable Actions artifact storage.
// Reuses the already-protected KRX_AUTH_KEY only to derive a stable archive
// encryption key. KRX source authorization keys must remain private. A key
// rotation requires re-sealing the current archive before replacing the key;
// lost old keys cannot decrypt an old encrypted archive.
// No custom crypto: Node built-in HKDF + AES-256-GCM authenticated encryption.
import fs from 'node:fs';
import {randomBytes,hkdfSync,createCipheriv,createDecipheriv} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {verifyArchive} from './krx-52week-market.mjs';

const MAGIC=Buffer.from('K52E1','ascii');
const AAD=Buffer.from('KRX52_OFFICIAL_RAW_DAILY_OHLC_V1','utf8');
const SALT=Buffer.from('KRX52_PUBLIC_ACTIONS_ARTIFACT_ENVELOPE_V1','utf8');
const INFO=Buffer.from('KRX52_KEY_DERIVATION_V1','utf8');
const AUTH=/^[A-Za-z0-9_-]{16,128}$/;
const MAX_JSON=100_000_000,MAX_SEALED=40_000_000;

const keyFrom=auth=>{
 if(typeof auth!=='string'||!AUTH.test(auth))
  throw Error('KRX52_ARCHIVE_KEY_UNAVAILABLE');
 return Buffer.from(hkdfSync('sha256',Buffer.from(auth),SALT,INFO,32));
};
export function sealKrxArchive(archive,auth){
 const k=keyFrom(auth),nonce=randomBytes(12);
 // Checking schema before sealing avoids persisting a silently corrupted
 // source history. Source is never transformed into adjusted price data.
 const plain=Buffer.from(JSON.stringify(verifyArchive(archive)),'utf8');
 if(plain.length>MAX_JSON)throw Error('KRX52_ARCHIVE_SIZE_UNVERIFIED');
 const compressed=gzipSync(plain,{level:9});
 const cipher=createCipheriv('aes-256-gcm',k,nonce);
 cipher.setAAD(AAD);
 const body=Buffer.concat([cipher.update(compressed),cipher.final()]);
 return Buffer.concat([MAGIC,nonce,cipher.getAuthTag(),body]);
}
export function openKrxArchive(sealed,auth){
 const k=keyFrom(auth),value=Buffer.isBuffer(sealed)?sealed:Buffer.from(sealed);
 if(value.length<MAGIC.length+12+16+1||value.length>MAX_SEALED||
  !value.subarray(0,MAGIC.length).equals(MAGIC))
  throw Error('KRX52_ARCHIVE_ENVELOPE_UNVERIFIED');
 const nonce=value.subarray(5,17),tag=value.subarray(17,33),body=value.subarray(33);
 let decompressed;
 try{
  const decipher=createDecipheriv('aes-256-gcm',k,nonce);
  decipher.setAAD(AAD);decipher.setAuthTag(tag);
  const compressed=Buffer.concat([decipher.update(body),decipher.final()]);
  decompressed=gunzipSync(compressed,{maxOutputLength:MAX_JSON});
 }catch{
  throw Error('KRX52_ARCHIVE_AUTHENTICATION_FAILED');
 }
 try{
  return verifyArchive(JSON.parse(decompressed.toString('utf8')));
 }catch{
  throw Error('KRX52_ARCHIVE_SCHEMA_UNVERIFIED');
 }
}
export function runArchiveCryptoCli(args=process.argv.slice(2),auth=process.env.KRX_AUTH_KEY){
 const [mode,input,output,...other]=args;
 if(!['seal','open'].includes(mode)||!input||!output||other.length)
  throw Error('KRX52_ARCHIVE_ARGUMENT_UNVERIFIED');
 if(!fs.statSync(input).isFile()||fs.statSync(input).size>MAX_JSON)
  throw Error('KRX52_ARCHIVE_SIZE_UNVERIFIED');
 const result=mode==='seal'
  ?sealKrxArchive(JSON.parse(fs.readFileSync(input,'utf8')),auth)
  :Buffer.from(JSON.stringify(openKrxArchive(fs.readFileSync(input),auth)),'utf8');
 if(result.length>MAX_JSON)throw Error('KRX52_ARCHIVE_SIZE_UNVERIFIED');
 // Destination is a runner-local staging file; only sealed output is ever
 // uploaded to public Actions. Do not log source bodies, key or raw prices.
 fs.writeFileSync(output,result,{flag:'wx',mode:0o600});
 console.log(mode==='seal'?'KRX52_ARCHIVE_SEALED_AUTHENTICATED':'KRX52_ARCHIVE_OPEN_AUTHENTICATED');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{runArchiveCryptoCli()}catch(e){
  console.error(/^KRX52_[A-Z_0-9]+$/.test(e?.message||'')?e.message:
   'KRX52_ARCHIVE_CRYPTO_UNVERIFIED');
  process.exitCode=1;
 }
}
