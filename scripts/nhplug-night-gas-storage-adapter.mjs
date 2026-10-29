import {buildNightReference, upsertNightReference, nightTelegramReference} from './nhplug-k200-night-contract.mjs';

// Standalone adapter contract; NOT wired to Apps Script or any production Sheet.
// The future GAS adapter must use one dedicated NH-only sheet, ScriptLock,
// appendRow/replaceRow by the verified exact row index, and read-after-write.
const MAX_ROWS=50_000;
function result(status, wrote=false) { return Object.freeze({status, wrote, committed: status.endsWith('_CONFIRMED')}); }
function validStore(store) {
  return store && typeof store.listRows==='function'
    && typeof store.appendRow==='function' && typeof store.replaceRow==='function';
}
function validLock(lock) {
  return lock && typeof lock.tryLock==='function' && typeof lock.releaseLock==='function';
}
function canonicalRow(row) {
  if (!row || typeof row!=='object') return null;
  try {
    const rebuilt=buildNightReference(row);
    const allowed=Object.keys(rebuilt);
    // Recompute every persisted field; reject even a plausible key with altered
    // sourceDate, status, timestamp, source or extra schema fields.
    if(Object.keys(row).length!==allowed.length || allowed.some(field=>row[field]!==rebuilt[field]))return null;
    return rebuilt;
  } catch { return null; }
}
function rowIsSame(actual, expected) {
  const canonical=canonicalRow(actual);
  return canonical!==null && JSON.stringify(canonical)===JSON.stringify(expected);
}
function safeRead(store) {
  const rows=store.listRows();
  if(!Array.isArray(rows) || rows.length>MAX_ROWS || rows.some(r=>!r || typeof r!=='object'))throw Error('INVALID_ROWS');
  return rows;
}

function withLock(lock, job, timeoutMs=5000) {
  if(!validLock(lock))return result('LOCK_UNAVAILABLE');
  let acquired=false;
  try { acquired=lock.tryLock(timeoutMs)===true; }
  catch { return result('LOCK_UNAVAILABLE'); }
  if(!acquired)return result('BUSY');
  let outcome;
  try { outcome=job(); }
  catch { outcome=result('UNEXPECTED_FAILURE'); }
  try { lock.releaseLock(); }
  catch { return result('LOCK_RELEASE_UNCONFIRMED'); }
  return outcome;
}

// GAS-equivalent read/write sequence with injectable synchronous Sheet/LockService
// adapters. No datastore APIs are called by this module itself.
export function persistNightReference({candidate,store,lock}={}) {
  if(!validStore(store))return result('STORE_UNAVAILABLE');
  let normalized;
  try { normalized=buildNightReference(candidate); }
  catch { return result('INPUT_REJECTED'); }
  return withLock(lock,()=>{
    let before;
    try { before=safeRead(store); }
    catch { return result('READ_FAILED'); }
    const key=normalized.storageKey;
    if(before.filter(row=>row.storageKey===key).length>1)return result('DUPLICATE_KEY_CONFLICT');
    if(before.some(row=>row.storageKey===key && !canonicalRow(row)))return result('STORED_ROW_INVALID');
    let change;
    try { change=upsertNightReference(before,normalized); }
    catch { return result('CONFLICT'); }
    const needsWrite=change.outcome==='INSERTED'||change.outcome==='UPDATED';
    if(needsWrite) {
      const next=change.rows.find(row=>row.storageKey===key);
      const at=before.findIndex(row=>row.storageKey===key);
      try {
        if(change.outcome==='INSERTED')store.appendRow(next);
        else if(at>=0)store.replaceRow(at,next);
        else return result('CONFLICT');
      } catch { return result('WRITE_UNCONFIRMED',true); } // May have committed; no blind second write.
    }
    let readback;
    try { readback=safeRead(store); }
    catch { return result('READBACK_UNCONFIRMED',needsWrite); }
    const got=readback.filter(row=>row.storageKey===key);
    const expected=change.rows.find(row=>row.storageKey===key);
    if(got.length!==1 || !rowIsSame(got[0],expected))
      return result('READBACK_MISMATCH',needsWrite);
    // Only return a confirmed outcome after readback proves exact idempotent state.
    const statuses={
      INSERTED:'INSERTED_CONFIRMED',UPDATED:'UPDATED_CONFIRMED',
      DUPLICATE_IGNORED:'UNCHANGED_CONFIRMED',STALE_IGNORED:'STALE_IGNORED_CONFIRMED'
    };
    return result(statuses[change.outcome]||'UNEXPECTED_FAILURE',needsWrite);
  });
}

// A separate locked read. Senders consume only this confirmed reference, not
// provisional write results or arbitrary rows from the master/snapshot sheet.
export function readNightForBriefing({tradingDate,asOf,store,lock}={}) {
  if(!validStore(store))return {status:'STORE_UNAVAILABLE',reference:null};
  // Never silently use the wall clock for a 07:30/08:00 briefing. The caller
  // must supply an explicit cutoff in the same KST night-closing date.
  const format=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if(typeof asOf!=='string'||!format.test(asOf))return {status:'DATE_OR_CUTOFF_INVALID',reference:null};
  const end=Date.parse(asOf);
  const earliest=Date.parse(tradingDate+'T06:00:00+09:00');
  const latest=Date.parse(tradingDate+'T08:10:00+09:00');
  if(!Number.isFinite(end)||!Number.isFinite(earliest)||end<earliest||end>=latest)
    return {status:'DATE_OR_CUTOFF_INVALID',reference:null};
  return withLock(lock,()=>{
    let rows;
    try { rows=safeRead(store); }
    catch { return {status:'READ_FAILED',reference:null}; }
    // Refuse to select one apparently valid contract if another row for the
    // same NH session is corrupt (including an invalid or future timestamp).
    const related=rows.filter(row=>row.source==='NH_PLUG' && row.tradingDate===tradingDate);
    if(related.some(row=>!canonicalRow(row)))return {status:'STORED_ROW_INVALID',reference:null};
    let reference;
    try { reference=nightTelegramReference(rows,tradingDate,asOf); }
    catch { return {status:'DATE_OR_CUTOFF_INVALID',reference:null}; }
    return reference
      ? {status:'REFERENCE_VERIFIED_NOT_OFFICIAL',reference}
      : {status:'REFERENCE_MISSING_OR_AMBIGUOUS',reference:null};
  });
}
