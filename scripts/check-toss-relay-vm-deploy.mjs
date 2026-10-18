import {EventEmitter} from 'node:events';
import {createServer as createTcpServer,connect as tcpConnect} from 'node:net';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const install=fs.readFileSync('ops/toss-relay/install.sh','utf8');
const verify=fs.readFileSync('ops/toss-relay/verify-live.mjs','utf8');
const guide=fs.readFileSync('ops/toss-relay/README.md','utf8');
const source=fs.readFileSync('scripts/toss-free-relay.mjs','utf8');
const checked=spawnSync('bash',['-n','ops/toss-relay/install.sh'],{encoding:'utf8'});
assert.equal(checked.status,0,checked.stderr);
assert.match(install,/ROOT_REQUIRED/);
assert.match(install,/UBUNTU_REQUIRED/);
assert.match(install,/NODE_22_OR_NEWER_REQUIRED/);
assert.match(install,/OUTBOUND_RESERVED_IP_MISMATCH/);
assert.match(install,/DNS_GUARD_MISSING/);
assert.match(install,/curl -4 -fsS --connect-timeout 7 --max-time 15 https:\/\/api\.ipify\.org/);
assert.match(install,/check-dns\.mjs/);
assert.doesNotMatch(install,/getent ahostsv4|socket\.getaddrinfo/,
  'local NSS/hosts must not be trusted as evidence of public relay DNS');
assert.match(install,/PRIVATE_ENV_OWNER_INVALID/);
assert.match(install,/PRIVATE_ENV_FILE_MISSING_OR_SYMLINK/);
assert.match(install,/stat -c '%u:%g'/);
assert.match(install,/EXISTING_CADDY_CONFIG_REFUSED/);
assert.match(install,/RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6/);
assert.match(install,/ProtectSystem=strict/);
assert.match(install,/NoNewPrivileges=true/);
assert.match(install,/PrivateDevices=true/);
assert.match(install,/User=tossrelay/);
assert.match(install,/EnvironmentFile=\/etc\/toss-relay\/env/);
assert.match(install,/server\.listen|relay\.mjs/);
assert.match(source,/server\.listen\(port,'127\.0\.0\.1'/);
assert.match(install,/reverse_proxy 127\.0\.0\.1:18761/);
assert.match(install,/install -o root -g root -m 0600 \/dev\/null \/etc\/toss-relay\/env/);
assert.ok(install.includes('if [[ "$mode" == prepare ]]; then'));
assert.ok(install.includes('if [[ "$mode" == activate ]]; then'));
assert.match(install,/RELAY_PREPARED_NO_SECRETS_IN_GIT/);
assert.match(install,/RELAY_ACTIVATED_HTTPS_AUTH_PROTECTED/);
assert.match(install,/HTTPS_AUTH_GATE_FAILED/);
assert.doesNotMatch(install,/insecure|skip-tls-verify|:18761 \{|0\.0\.0\.0:18761/i);
assert.match(verify,/PRIVATE_SHARED_KEY_INVALID/);
assert.match(verify,/PUBLIC_RELAY_AUTH_BYPASS/);
assert.match(verify,/NO_T_FINAL_CLOSE|NOT_A_FINAL_CLOSE_PROOF/);
assert.match(verify,/TOSS_OAUTH_IP_NOT_ALLOWED/);
assert.doesNotMatch(verify,/console\.log\((?:key|contents|row|data)\)/);
assert.match(guide,/Always Free/);
assert.match(guide,/Reserved Public IP/);
assert.match(guide,/sudoedit \/etc\/toss-relay\/env/);
assert.match(guide,/TOSS_RELAY_SHARED_KEY/);
assert.match(guide,/TOSS_RELAY_DOMAIN/);
assert.match(guide,/TOSS_RESERVED_IP/);
assert.match(guide,/18761/);
assert.match(guide,/PAYG/);
assert.match(guide,/Toss WTS/);
assert.match(guide,/GAS.*PR #540/);
assert.match(guide,/TOSS_RELAY_MODE=OFF/);
assert.match(guide,/TOSS_RELAY_MODE=ON.*마지막에/);
assert.match(guide,/롤백 순서 고정: VM에서 먼저.*stop toss-relay.*TOSS_RELAY_MODE=OFF/,
  'relay VM must stop issuing OAuth before GAS direct mode is enabled');
// Regression: /etc/hosts may tell NSS the expected IP even when the public
// DNS A RRset is different. The installer MUST query dns.resolve4/6 directly.
const dnsGuard=fs.readFileSync('ops/toss-relay/check-dns.mjs','utf8');
assert.match(dnsGuard,/node:dns\/promises/);
assert.doesNotMatch(dnsGuard,/socket\.getaddrinfo\(|getent ahostsv4/);
const {verifyPublicRelayDns}=await import('../ops/toss-relay/check-dns.mjs');
const officialIp='8.8.8.8',officialDomain='relay.example.com';
const checkDns=(a,aaaa=[])=>verifyPublicRelayDns({
  domain:officialDomain,expected:officialIp,
  resolveA:async()=>a,resolveAAAA:async()=>aaaa
});
assert.equal(await checkDns([officialIp]),true);
for(const a of [[officialIp,'8.8.4.4'], ['8.8.4.4',officialIp],
  ['8.8.4.4'],[]]){
  await assert.rejects(()=>checkDns(a),/DNS_MULTIPLE_OR_IPV6_TARGETS_REFUSED/);
}
await assert.rejects(()=>checkDns([officialIp],['2606:4700:4700::1111']),
  /DNS_MULTIPLE_OR_IPV6_TARGETS_REFUSED/);
await assert.rejects(()=>verifyPublicRelayDns({domain:officialDomain,expected:officialIp,
  resolveA:async()=>{throw Error('sensitive resolver detail')},
  resolveAAAA:async()=>[]
}),/DNS_PUBLIC_QUERY_FAILED/);
await assert.rejects(()=>verifyPublicRelayDns({domain:officialDomain,expected:officialIp,
  resolveA:async()=>[officialIp],
  resolveAAAA:async()=>{throw Object.assign(Error('no AAAA'),{code:'SERVFAIL'})}
}),/DNS_PUBLIC_QUERY_FAILED/);
assert.equal(await verifyPublicRelayDns({domain:officialDomain,expected:officialIp,
  resolveA:async()=>[officialIp],
  resolveAAAA:async()=>{throw Object.assign(Error('no AAAA'),{code:'ENODATA'})}
}),true);
await assert.rejects(()=>verifyPublicRelayDns({domain:'localhost',expected:officialIp,
  resolveA:async()=>[officialIp],resolveAAAA:async()=>[]}),/DNS_TARGET_INPUT_INVALID/);
// The live check must pin the actual TLS connection destination, not merely
// compare DNS before a second unrestricted fetch that could rebind.
const {verifyLive,pinnedPost,pinnedLookup}=await import('../ops/toss-relay/verify-live.mjs');
const expectedIp='8.8.8.8',host='relay.example.com',key='z'.repeat(64);
const calls=[];
const result=await verifyLive({host,ip:expectedIp,key,
  lookupDns:async()=>[expectedIp],
  lookupDns6:async()=>[],
  post:async args=>{
    calls.push(args);
    return args.sharedKey
      ? {status:200,data:{ok:true,status:200,data:{result:[{
        symbol:'005930',lastPrice:'12345',timestamp:'2026-10-16T15:30:00+09:00'
      }]}}}
      : {status:401,data:{ok:false,code:'UNAUTHORIZED'}};
  }
});
assert.equal(result.result,'PASS');
assert.deepEqual(calls.map(x=>x.ip),[expectedIp,expectedIp]);
assert.deepEqual(calls.map(x=>x.sharedKey),['',key]);
assert.doesNotMatch(JSON.stringify(result),/12345|zzzz|2026-10-16/);
const denied=[];
await assert.rejects(()=>verifyLive({host,ip:expectedIp,key,
  lookupDns:async()=>['8.8.4.4'],lookupDns6:async()=>[],post:async x=>denied.push(x)}),
  /DNS_TARGET_MISMATCH/);
assert.equal(denied.length,0,'DNS divergence must block before key transmission');
// GAS resolves host independently: even when one A is pinned correctly,
// an extra A or an AAAA can route the shared key to another machine.
for(const dnsA of [[expectedIp,'8.8.4.4'], ['8.8.4.4',expectedIp], []]){
  const emitted=[];
  await assert.rejects(()=>verifyLive({host,ip:expectedIp,key,
    lookupDns:async()=>dnsA,lookupDns6:async()=>[],post:async a=>emitted.push(a)
  }),/DNS_TARGET_MISMATCH/);
  assert.equal(emitted.length,0,'mixed/missing DNS A blocks any public request');
}
for(const ipv6 of [['2606:4700:4700::1111'],['::1']]){
  const emitted=[];
  await assert.rejects(()=>verifyLive({host,ip:expectedIp,key,
    lookupDns:async()=>[expectedIp],
    lookupDns6:async()=>ipv6,post:async a=>emitted.push(a)
  }),/DNS_TARGET_MISMATCH/);
  assert.equal(emitted.length,0,'AAAA blocks transmission of relay shared key');
}
await assert.rejects(()=>verifyLive({host,ip:expectedIp,key,
  lookupDns:async()=>[expectedIp],
  lookupDns6:async()=>{throw Error('sensitive resolver failure');},
  post:async()=>{throw Error('must not send')}
}),/DNS_LOOKUP_FAILED/);
let httpsOptions={};
const fakeHttps={request:(options,done)=>{
  httpsOptions=options;
  const emitter=new EventEmitter();
  emitter.setTimeout=()=>{};
  emitter.end=()=>{
    queueMicrotask(()=>{
      const res=new EventEmitter();res.statusCode=401;
      done(res);
      res.emit('data',Buffer.from('{"ok":false,"code":"UNAUTHORIZED"}'));
      res.emit('end');
    });
  };
  return emitter;
}};
const pinned=await pinnedPost({host,ip:expectedIp,sharedKey:key,transport:fakeHttps});
assert.equal(pinned.status,401);
assert.equal(httpsOptions.hostname,host);
assert.equal(httpsOptions.servername,host);
assert.equal(httpsOptions.rejectUnauthorized,true);
assert.equal(httpsOptions.agent,false);
assert.equal(httpsOptions.family,4);
assert.equal(httpsOptions.autoSelectFamily,false);
assert.equal(httpsOptions.headers['x-relay-key'],key);
await new Promise(resolve=>httpsOptions.lookup(host,{},(err,address,family)=>{
  assert.equal(err,null);assert.equal(address,expectedIp);assert.equal(family,4);resolve();
}));
await new Promise(resolve=>httpsOptions.lookup(host,{all:true},(err,records)=>{
  assert.equal(err,null);
  assert.deepEqual(records,[{address:expectedIp,family:4}]);
  resolve();
}));
// Use a real Node TCP socket (not only a fake HTTP transport) so Node's
// address-family/dns lookup contract is exercised in the same runtime as CI.
const tcpServer=createTcpServer(socket=>socket.end('ok'));
await new Promise((resolve,reject)=>{
  tcpServer.once('error',reject);
  tcpServer.listen(0,'127.0.0.1',resolve);
});
try{
  await new Promise((resolve,reject)=>{
    const client=tcpConnect({
      host:'relay.example.com',
      port:tcpServer.address().port,
      family:4,
      autoSelectFamily:false,
      lookup:pinnedLookup('127.0.0.1')
    });
    client.once('connect',()=>assert.equal(client.remoteAddress,'127.0.0.1'));
    client.once('error',reject);
    client.once('end',resolve);
    client.resume(); // Consume remote FIN normally; do not reset the server TCP socket.
  });
}finally{
  await new Promise(resolve=>tcpServer.close(resolve));
}
console.log('OCI Toss free static egress IP VM deploy: shell syntax, secrets, scope, TLS, HTTPS and IP guards PASS');
