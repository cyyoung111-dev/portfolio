import assert from 'node:assert/strict';
import {parsePublicFutureMaster,inspectPublicFutureMaster} from './nhplug-public-future-master.mjs';
const mk=(code,name,invalidTail=false)=>{
  const b=Buffer.alloc(30,0x20);
  Buffer.from(code,'ascii').copy(b,0,0,9);
  Buffer.from(name,'ascii').copy(b,9,0,20);
  b[29]=invalidTail?13:10;
  return b;
};
const underlying=mk('K10111111','KOSPI 200');
const a=mk('KA016C000','KOSPI200 FUT DEC');
const b=mk('KA0169000','KOSPI 200 FUT SEP');
const fixture=Buffer.concat([underlying,a,b]);
const parse=parsePublicFutureMaster(fixture);
assert.deepEqual(parse,{totalRecords:3,candidates:[
  {code:'KA016C000',name:'KOSPI200 FUT DEC',contractMonth:null},
  {code:'KA0169000',name:'KOSPI 200 FUT SEP',contractMonth:null},
]});
// CP949 source bytes for the official abbreviated name "선물2612월kp".
const abbreviated=Buffer.alloc(30,0x20);
Buffer.from('KA016C000','ascii').copy(abbreviated,0);
Buffer.from([188,177,185,176,50,54,49,50,191,249,107,112]).copy(abbreviated,9);
abbreviated[29]=10;
assert.deepEqual(parsePublicFutureMaster(Buffer.concat([underlying,abbreviated])).candidates,[
  {code:'KA016C000',name:'선물2612월kp',contractMonth:'2026-12'},
]);
assert.throws(()=>parsePublicFutureMaster(Buffer.alloc(1)),/MASTER_SIZE_INVALID/);
assert.throws(()=>parsePublicFutureMaster(Buffer.concat([underlying,a,Buffer.from('x')])),/MASTER_SIZE_INVALID/);
assert.throws(()=>parsePublicFutureMaster(Buffer.concat([underlying,mk('KA016C000','KOSPI200 FUT',true)])),/MASTER_RECORD_INVALID/);
assert.throws(()=>parsePublicFutureMaster(Buffer.concat([mk('KA016C000','KOSPI200 FUT'),a])),/MASTER_HEADER_SENTINEL_CHANGED/);
assert.deepEqual(parsePublicFutureMaster(Buffer.concat([underlying,mk('KA016C000','OTHER FUT')])),{totalRecords:2,candidates:[],unclassified:[{code:'KA016C000',name:'OTHER FUT'}]});
assert.throws(()=>parsePublicFutureMaster(Buffer.concat([underlying,a,a])),/MASTER_DUPLICATE_CODE/);
assert.throws(()=>parsePublicFutureMaster(Buffer.concat([underlying,mk('not-code!','KOSPI200 FUT')])),/MASTER_CODE_INVALID/);
const header='/* @record 30 / char sCode[9]; char sName[20]; char dummy[1] */';
const get=(badHeader=false)=>async(url,options)=>{
  assert.equal(options.redirect,'error');
  assert.equal(options.headers,undefined);
  if(url.endsWith('.h'))return {ok:true,text:async()=>badHeader?'/* invalid */':header};
  assert.equal(url,'https://www.nhplug.com/instruments/m_future.mst');
  return {ok:true,headers:{get:()=>String(fixture.length)},arrayBuffer:async()=>fixture};
};
const messages=[];
assert.equal(await inspectPublicFutureMaster({request:get(),log:x=>messages.push(x)}),true);
assert.match(messages.join('\n'),/FUTURE_MASTER_RECORDS 3/);
assert.match(messages.join('\n'),/KOSPI200_CONTRACT_CANDIDATES 2/);
assert.match(messages.join('\n'),/KOSPI200_FRONT_MONTH UNVERIFIED/);
assert.equal(await inspectPublicFutureMaster({request:get(true),log:x=>messages.push(x)}),false);
const logs=[];
assert.equal(await inspectPublicFutureMaster({request:async()=>{throw Error('test-secret-token')},log:x=>logs.push(x)}),false);
assert.doesNotMatch(logs.join('\n'),/test-secret-token/);
console.log('NH public index-future master contract synthetic checks passed');
