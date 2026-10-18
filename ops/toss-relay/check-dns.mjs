#!/usr/bin/env node
// Verify DNS PUBLIC A/AAAA answers; getent/getaddrinfo may read /etc/hosts
// and must not be trusted to validate the URL that Google Apps Script resolves.
import dns from 'node:dns/promises';
import {isIP} from 'node:net';
import {pathToFileURL} from 'node:url';

export async function verifyPublicRelayDns({domain,expected,resolveA=dns.resolve4,
  resolveAAAA=dns.resolve6}){
  if(typeof domain!=='string'||!domain.includes('.')||
      !/^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$/.test(domain)||
      domain.includes('..')||isIP(domain)!==0||isIP(expected)!==4)
    throw Error('DNS_TARGET_INPUT_INVALID');
  let a,aaaa;
  try{a=await resolveA(domain)}
  catch{throw Error('DNS_PUBLIC_QUERY_FAILED')}
  try{aaaa=await resolveAAAA(domain)}
  catch(e){
    // A DNS name with no AAAA RRset is expected for the IPv4-only relay.
    if(['ENODATA','ENOTFOUND','ENODOMAIN'].includes(e?.code))aaaa=[];
    else throw Error('DNS_PUBLIC_QUERY_FAILED');
  }
  // Never permit a second public destination or IPv6 route for GAS.
  if(!Array.isArray(a)||!a.length||a.some(v=>v!==expected)||
      !Array.isArray(aaaa)||aaaa.length)
    throw Error('DNS_MULTIPLE_OR_IPV6_TARGETS_REFUSED');
  return true;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    await verifyPublicRelayDns({
      domain:String(process.argv[2]||''),
      expected:String(process.argv[3]||'')
    });
    console.log('DNS_PUBLIC_TARGET_VERIFIED');
  }catch(e){
    const code=String(e?.message||'');
    console.error(/^(DNS_TARGET_INPUT_INVALID|DNS_PUBLIC_QUERY_FAILED|DNS_MULTIPLE_OR_IPV6_TARGETS_REFUSED)$/.test(code)
      ?code:'DNS_PUBLIC_QUERY_FAILED');
    process.exitCode=3;
  }
}
