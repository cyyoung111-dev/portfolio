import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);

export function validateTflNight(value, date, receivedAt) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || value?.date !== date || value?.clock !== '06:00:00'
      || !/^[A-Z0-9]{4,12}$/.test(value?.contract || '') || !Number.isFinite(value?.value)
      || value.value <= 0 || Math.abs(value.value * 20 - Math.round(value.value * 20)) > 1e-7
      || !Number.isFinite(Date.parse(receivedAt)) || Date.parse(receivedAt) < Date.parse(`${date}T06:00:00+09:00`)) return null;
  return {source:'TFL', kind:'REFERENCE', tradingDate:date, contract:value.contract, value:value.value,
    sourceUpdatedAt:`${date}T06:00:00+09:00`, receivedAt:new Date(receivedAt).toISOString(), officialClose:false};
}

export async function fetchTflNight(date, {now=()=>new Date(), run=exec}={}) {
  try {
    const result=await run('python3',[fileURLToPath(new URL('./tfl-night-reference.py',import.meta.url))],
      {timeout:45000,maxBuffer:65536,env:{PATH:process.env.PATH||'/usr/bin:/bin',HOME:process.env.HOME||'/tmp',LANG:'C.UTF-8'}});
    return validateTflNight(JSON.parse(result.stdout),date,now().toISOString());
  } catch { return null; }
}
