// ════════════════════════════════════════════════════════════════
//  settings_sync.js — GAS 종목코드·보유현황·거래이력 동기화
//  의존: settings.js, data.js
// ════════════════════════════════════════════════════════════════
function _normalizeSyncCode(code) {
  if (typeof normalizeStockCode === 'function') return normalizeStockCode(code);
  return String(code || '').trim();
}

function _syncWarn(...args) {
  if (typeof logWarn === 'function') logWarn('SETTINGS_SYNC', ...args);
  else console.warn('[SETTINGS_SYNC]', ...args);
}

async function syncIssuesToGsheet(source, issues, options) {
  const targetUrl = String(options?.targetUrl || GSHEET_API_URL || '').trim();
  const generation = Number.isInteger(options?.generation) ? options.generation : null;
  if (!targetUrl || !Array.isArray(issues) || issues.length === 0) return null;
  if (!isGsheetPortfolioWriteReady({
    targetUrl,
    generation,
    allowDuringRestore: options?.allowDuringRestore === true
  })) return null;
  try {
    const data = await requestGsheetFormJson(
      'saveSyncIssues',
      { source: source || 'unknown', data: JSON.stringify(issues) },
      { timeoutMs: 15000, retry: 1, targetUrl }
    );
    if (!data) { _syncWarn('[saveSyncIssues] 네트워크 오류'); return null; }
    if (data.status !== 'ok') { _syncWarn('[saveSyncIssues] GAS 오류:', data); return null; }
    return data;
  } catch (e) {
    _syncWarn('[saveSyncIssues]', e.message);
    return null;
  }
}

// ── 구글시트 종목코드 목록 로드
let _gsheetCodeList = []; // [{code, name}]
let _gsheetCodeListSourceId = ''; // authoritative workbook scope

function applyGsheetCodeList(codes, sourceId) {
  if (!Array.isArray(codes)) return false;
  _gsheetCodeListSourceId = String(sourceId || '').trim();
  _gsheetCodeList = codes
    .map(item => ({
      code: _normalizeSyncCode(item?.code),
      name: String(item?.name || '').trim(),
      type: String(item?.type || '').trim(),
      sector: String(item?.sector || '').trim(),
      currency: String(item?.currency || '').trim().toUpperCase(),
      market: String(item?.market || '').trim().toUpperCase(),
    }))
    .filter(item => item.code && item.name);
  return true;
}

async function loadGsheetCodeList(options) {
  const targetUrl = String(options?.targetUrl || GSHEET_API_URL || '').trim();
  const generation = Number.isInteger(options?.generation)
    ? options.generation
    : (typeof getGsheetConnectionGeneration === 'function' ? getGsheetConnectionGeneration() : 0);
  if (!targetUrl) return false;
  if (typeof _gsPortfolioRestoreRequired !== 'undefined'
      && _gsPortfolioRestoreRequired
      && options?.allowDuringRestore !== true) return false;
  try {
    const data = await requestGsheetActionJson(
      'getCodeList',
      {},
      { timeoutMs: 10000, retry: 1, targetUrl }
    );
    if (typeof isGsheetConnectionCurrent === 'function'
        && !isGsheetConnectionCurrent(targetUrl, generation)) return false;
    if (data?.status === 'ok' && applyGsheetCodeList(data.codes, data.codeMasterSourceId)) {
      // ⚠️ STOCK_CODE는 건드리지 않음 — HTML 직접 입력이 항상 우선
      // GSheet 코드는 _gsheetCodeList에만 보관, lookupNameByCode()에서 3순위 참고용으로만 사용
      return true;
    }
  } catch(e) {
  }
  return false;
}

// Settings 저장이 과거 오류로 실패했어도 종목코드 시트 동기화가 성공했다면
// 코드·유형·섹터·통화 정보를 복구할 수 있도록 별도 시트 값을 기초정보에 병합합니다.
function reconcileEditablesFromGsheetCodeList() {
  if (!Array.isArray(_gsheetCodeList) || _gsheetCodeList.length === 0) return 0;
  const byCode = new Map();
  const byName = new Map();
  _gsheetCodeList.forEach(item => {
    if (item.code) byCode.set(_normalizeSyncCode(item.code), item);
    if (item.name) byName.set(item.name, item);
  });

  let changed = 0;
  EDITABLE_PRICES.forEach(ep => {
    const remote = byCode.get(_normalizeSyncCode(ep.code)) || byName.get(ep.name);
    if (!remote) return;
    const nextType = remote.type || '';
    const nextSector = remote.sector || '';
    const nextCurrency = (remote.currency || '').toUpperCase();
    const nextMarket = (remote.market || '').toUpperCase();
    if (nextType && nextType !== (ep.assetType || ep.type || '주식')) {
      ep.assetType = nextType;
      changed++;
    }
    if (nextSector && nextSector !== (ep.sector || '기타')) {
      ep.sector = nextSector;
      changed++;
    }
    if (nextCurrency && nextCurrency !== (ep.currency || 'KRW').toUpperCase()) {
      ep.currency = nextCurrency;
      changed++;
    }
    if (nextMarket && nextMarket !== (ep.market || '').toUpperCase()) { ep.market = nextMarket; changed++; }
  });
  const localCodes = new Set(EDITABLE_PRICES.map(ep => _normalizeSyncCode(ep.code)).filter(Boolean));
  const localNames = new Set(EDITABLE_PRICES.map(ep => ep.name).filter(Boolean));
  _gsheetCodeList.forEach(remote => {
    const code = _normalizeSyncCode(remote.code);
    if (!remote.name || !code || localCodes.has(code) || localNames.has(remote.name)) return;
    EDITABLE_PRICES.push({
      name: remote.name,
      code,
      assetType: remote.type || '주식',
      sector: remote.sector || '기타',
      ...(remote.currency && remote.currency !== 'KRW' ? { currency: remote.currency } : {}),
      ...(remote.market ? { market: remote.market } : {}),
    });
    if (typeof STOCK_CODE !== 'undefined') STOCK_CODE[remote.name] = code;
    localCodes.add(code);
    localNames.add(remote.name);
    changed++;
  });
  if (changed > 0) {
    if (typeof _invalidateEPIndex === 'function') _invalidateEPIndex();
    if (typeof lsSave === 'function' && typeof EDITABLES_KEY !== 'undefined') lsSave(EDITABLES_KEY, EDITABLE_PRICES);
  }
  return changed;
}


// Emergency READ-ONLY master recovery for a browser with zero EDITABLE_PRICES.
// This never authorizes writes or changes the trade/holdings ledger. When a
// connection switch requires authoritative portfolio restore, it deliberately
// does not mix a new master with the previous account's in-memory trades.
function isStockMasterWriteBlocked() {
  return !!GSHEET_API_URL && (!_gsBootRestored || _gsPortfolioRestoreRequired);
}
function captureStockMasterEditSession() {
  return {
    targetUrl: String(GSHEET_API_URL || '').trim(),
    generation: typeof getGsheetConnectionGeneration === 'function' ? getGsheetConnectionGeneration() : 0,
    sourceId: String(typeof _gsCodeMasterSourceIdentity !== 'undefined' ? _gsCodeMasterSourceIdentity || '' : '')
  };
}
function isStockMasterEditSessionCurrent(session) {
  const currentTarget=String(GSHEET_API_URL || '').trim();
  const currentSource=String(typeof _gsCodeMasterSourceIdentity !== 'undefined'
    ? _gsCodeMasterSourceIdentity || '' : '').trim();
  return !!session && !isStockMasterWriteBlocked()
    && session.targetUrl === currentTarget
    && session.generation === (typeof getGsheetConnectionGeneration === 'function' ? getGsheetConnectionGeneration() : 0)
    // Offline-only edits have no remote source identity. This never grants
    // permission to edit a connected workbook without its pinned source ID.
    && (currentTarget
      ? !!session.sourceId && session.sourceId === currentSource
      : !session.sourceId && !currentSource);
}
function preventUnsafeStockMasterEdit() {
  if (!isStockMasterWriteBlocked()) return false;
  if (typeof showToast === 'function') showToast('전체 설정 복원 완료 전에는 종목 관리 변경을 할 수 없습니다.', 'warn');
  return true;
}
let _stockMasterReadOnlyRecoveryPromise = null;
async function recoverMissingStockMasterReadOnly() {
  if (EDITABLE_PRICES.length > 0) return EDITABLE_PRICES.length;
  const targetUrl = String(GSHEET_API_URL || '').trim();
  if (!targetUrl) return 0;
  if (_stockMasterReadOnlyRecoveryPromise) return _stockMasterReadOnlyRecoveryPromise;
  const generation = getGsheetConnectionGeneration();
  const run = (async () => {
    // Avoid racing with the authoritative bootstrap that is already running.
    if (_gsBootPromise) {
      try { await _gsBootPromise; } catch(ignore) {}
    }
    if (EDITABLE_PRICES.length > 0) return EDITABLE_PRICES.length;
    if (!isGsheetConnectionCurrent(targetUrl, generation)
        || _gsPortfolioRestoreRequired) return 0;
    const loaded = await loadGsheetCodeList({
      targetUrl, generation, allowDuringRestore: true
    });
    if (!loaded || !isGsheetConnectionCurrent(targetUrl, generation)
        || _gsPortfolioRestoreRequired || EDITABLE_PRICES.length > 0) return 0;
    // Existing getCodeList source has code, name, type, sector, currency,
    // market, and is safe to merge only while the local master is empty.
    const restored = reconcileEditablesFromGsheetCodeList();
    return restored > 0 ? EDITABLE_PRICES.length : 0;
  })();
  _stockMasterReadOnlyRecoveryPromise = run;
  try { return await run; }
  finally { if (_stockMasterReadOnlyRecoveryPromise === run) _stockMasterReadOnlyRecoveryPromise = null; }
}

// Serialize browser writes of the stock master by target. The latest UI
// state is sampled INSIDE this queue, so an already queued syncCodes request
// cannot re-add a code removed by the user.
const _gsheetStockMasterWriteQueues = new Map();
function _queueGsheetStockMasterWrite(targetUrl, work) {
  const target = String(targetUrl || '').trim();
  if (!target) return Promise.resolve(null);
  const previous = _gsheetStockMasterWriteQueues.get(target) || Promise.resolve();
  const next = previous.catch(() => null).then(work);
  _gsheetStockMasterWriteQueues.set(target, next);
  return next.finally(() => {
    if (_gsheetStockMasterWriteQueues.get(target) === next) {
      _gsheetStockMasterWriteQueues.delete(target);
    }
  });
}

async function deleteStockMasterCodeAfterPendingWrites(item, session, options) {
  const targetUrl = String(session?.targetUrl || '').trim();
  const generation = session?.generation;
  const sourceId = String(session?.sourceId || '').trim();
  const code = _normalizeSyncCode(item?.code || '');
  const name = String(item?.name || '').trim();
  if (!targetUrl || !sourceId || !name || !code) return false;
  // Conversion is different from removal: the *same object* still carries
  // the old code until the queued server CAS has been verified. Never allow
  // a second/re-added object to inherit this permission.
  const conversionItem=options?.conversionItem || null;
  const conversion=options?.conversion || null;
  // A code-less conversion must be persisted by the SERVER transaction
  // before Codes can disappear. Ordinary smDelete omits this payload.
  if (conversionItem && (!conversion || !String(conversion.name||'').trim()
      || _normalizeSyncCode(conversion.code||'')
      || !['TDF','펀드','FUND'].includes(String(conversion.assetType||'').toUpperCase())))
    return false;
  const localIntentIsCurrent=()=>{
    const matches=EDITABLE_PRICES.filter(ep=>ep?.name===name
      && _normalizeSyncCode(ep?.code||'')===code);
    return conversionItem
      ? matches.length===1 && matches[0]===conversionItem
        && EDITABLE_PRICES.includes(conversionItem)
        && typeof isStockMasterEditSessionCurrent==='function'
        && isStockMasterEditSessionCurrent(session)
      : matches.length===0;
  };
  return _queueGsheetStockMasterWrite(targetUrl, async () => {
    if (!isGsheetConnectionCurrent(targetUrl, generation)
        || String(_gsCodeMasterSourceIdentity || '') !== sourceId) return false;
    // A new edit/re-add in the same session supersedes an earlier deletion.
    if (!localIntentIsCurrent()) return false;
    // Read the post-queue server master before deletion. A separate browser
    // may have edited the same code's metadata; do not remove that newer item
    // merely because its old name/code are still identical.
    const before = await requestGsheetActionJson('getCodeList', {}, {
      targetUrl, timeoutMs:15000, retry:1, preserveError:true
    });
    if (!isGsheetConnectionCurrent(targetUrl, generation)
        || String(_gsCodeMasterSourceIdentity || '') !== sourceId
        || before?.status !== 'ok' || before.codeMasterSourceId !== sourceId
        || !Array.isArray(before.codes)) return false;
    const matching = before.codes.filter(ep =>
      _normalizeSyncCode(ep?.code || '') === code
      || String(ep?.name || '').trim() === name);
    if (matching.length===0 && conversionItem) {
      // A pair that was previously observed on this workbook is NOT a
      // harmless local NEW entry: it may have been remotely converted in a
      // prior interrupted request. Require Bootstrap instead of a false ACK.
      if (_gsheetCodeListSourceId===sourceId && _gsheetCodeList.some(row=>
        _normalizeSyncCode(row?.code)===code || String(row?.name||'').trim()===name))
        return false;
      // A still-unposted NEW local pair may be converted to a code-less
      // fund without a server delete. Replacement edits cannot take this
      // shortcut while their true previous server identity still exists.
      const journal=typeof _getSameTargetLocalCodeAdditions==='function'
        ? _getSameTargetLocalCodeAdditions(targetUrl,sourceId) : [];
      if (journal.some(ep=>ep.name===name
          && _normalizeSyncCode(ep.code)===code && ep.replaces)) return false;
      if (!localIntentIsCurrent()) return false;
      applyGsheetCodeList(before.codes,sourceId);
      return true;
    }
    if (matching.length !== 1) return false;
    const remote = matching[0];
    const normalizeType = ep => String(ep?.assetType || ep?.type || '주식').trim();
    const normalizeSector = ep => String(ep?.sector || '기타').trim();
    const normalizeCurrency = ep => String(ep?.currency || 'KRW').trim().toUpperCase();
    const normalizeMarket = ep => String(ep?.market || '').trim().toUpperCase();
    // The user may have re-added the same asset while the GET was pending.
    if (!localIntentIsCurrent()) return false;
    if (_normalizeSyncCode(remote.code) !== code
        || String(remote.name || '').trim() !== name
        || normalizeType(remote) !== normalizeType(item)
        || normalizeSector(remote) !== normalizeSector(item)
        || normalizeCurrency(remote) !== normalizeCurrency(item)
        || normalizeMarket(remote) !== normalizeMarket(item)) return false;
    // The server performs a full compare-and-delete under its ScriptLock.
    // Changes by another tab between this GET and POST fail closed.
    const res = await requestGsheetFormJson('deleteUnreferencedCode', {
      data:JSON.stringify({
        name, code, expectedSourceId:sourceId, expectedCodes:before.codes,
        ...(conversionItem ? {conversion} : {})
      })
    }, {timeoutMs:20000,retry:0,targetUrl});
    if (res?.status !== 'ok' || !isGsheetConnectionCurrent(targetUrl, generation)
        || (conversionItem && !localIntentIsCurrent())) return false;
    const checked = await requestGsheetActionJson('getCodeList', {}, {
      targetUrl, timeoutMs:15000, retry:1, preserveError:true
    });
    const verified = isGsheetConnectionCurrent(targetUrl, generation)
      && checked?.status === 'ok' && checked.codeMasterSourceId === sourceId
      && Array.isArray(checked.codes)
      && !checked.codes.some(ep => _normalizeSyncCode(ep?.code || '') === code
        || String(ep?.name || '').trim() === name);
    if (!verified || !localIntentIsCurrent()) return false;
    if (conversionItem) {
      // Codes readback alone cannot prove preservation of user Settings.
      // Server's crash-safe conversion must already contain this code-less
      // destination before the local edit is reported as successful.
      const settings=await requestGsheetActionJson('getSettings',{},{
        targetUrl,timeoutMs:15000,retry:1,preserveError:true
      });
      const rows=settings?.settings?.EDITABLE_PRICES;
      const matches=Array.isArray(rows) ? rows.filter(ep=>
        String(ep?.name||'').trim()===String(conversion.name).trim()
        && !_normalizeSyncCode(ep?.code||'')
        && String(ep?.assetType||ep?.type||'').trim()===String(conversion.assetType)
      ) : [];
      if (!isGsheetConnectionCurrent(targetUrl,generation)
          || !localIntentIsCurrent() || settings?.status!=='ok'
          || matches.length!==1) return false;
      // A confirmed server conversion has created a new fund row. Replace
      // the pre-conversion CAS baseline with this exact verified readback,
      // otherwise the next legitimate local save would reject its own fund.
      if (typeof adoptVerifiedCodelessFundBaselineFromSettings==='function')
        adoptVerifiedCodelessFundBaselineFromSettings(settings.settings,targetUrl,generation,conversion.name);
      // Server Settings (not a stale other-tab browser copy) is the
      // authoritative source of allocation/notes and future custom fields.
      // Refresh ONLY non-master fields: smSave still owns name/type/currency
      // and the old code until the verified CAS promise returns.
      const masterKeys=new Set(['name','code','type','assetType','sector','currency','market']);
      for (const key of Object.keys(conversionItem))
        if (!masterKeys.has(key)) delete conversionItem[key];
      for (const [key,value] of Object.entries(matches[0]))
        if (!masterKeys.has(key)) conversionItem[key]=value;
    }
    // Subsequent local edits must use the confirmed post-delete revision.
    applyGsheetCodeList(checked.codes, sourceId);
    return true;
  });
}


// Track ONLY successful same-window code-master CAS readbacks. A fresh
// getCodeList is not permission to overwrite another tab's newer metadata.
let _gsheetStockMasterConfirmedSeq = 0;
const _gsheetStockMasterConfirmedTransitions = new Map();
function _stockMasterSyncFingerprint(items) {
  if (!Array.isArray(items)) return '';
  const rows = [], codes = new Set(), names = new Set();
  for (const item of items) {
    const code = _normalizeSyncCode(item?.code || '');
    const name = String(item?.name || '').trim();
    if (!code || !name || codes.has(code) || names.has(name)) return '';
    codes.add(code); names.add(name);
    rows.push([code,name,String(item.type || item.assetType || '주식').trim(),
      String(item.sector || '기타').trim(),String(item.currency || 'KRW').trim().toUpperCase(),
      String(item.market || '').trim().toUpperCase()]);
  }
  rows.sort((a,b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return JSON.stringify(rows);
}
function _stockMasterHasOnlyConfirmedQueueChanges(target, sourceId, seqAtCall, before, after) {
  if (!before || !after) return false;
  if (before === after) return true;
  let fingerprint = before;
  for (const step of _gsheetStockMasterConfirmedTransitions.get(target) || []) {
    if (step.seq <= seqAtCall || step.sourceId !== sourceId) continue;
    if (step.before !== fingerprint) return false;
    fingerprint = step.after;
    if (fingerprint === after) return true;
  }
  return false;
}
// A metadata-only partial commit must reference an actual changed row,
// never an unrelated first row that another tab could later delete.
// Confirmed code-sheet changes that can be rebased without a rename:
// - metadata-only edits of existing exact pairs;
// - appended exact pairs backed by this workbook's durable NEW-asset journal.
// Reject removals, pair renames, and unproven additions. A metadataOnly marker
// is a request for Settings-only master CAS, NOT a replacement identity.
function _stockMasterMetadataOnlyRepairProof(beforeCodes, afterCodes, authorizedAdditions) {
  if (!Array.isArray(beforeCodes) || !Array.isArray(afterCodes)
      || afterCodes.length < beforeCodes.length
      || !_stockMasterSyncFingerprint(beforeCodes)
      || !_stockMasterSyncFingerprint(afterCodes)) return null;
  const previous = new Map(beforeCodes.map(row => [
    JSON.stringify([String(row.name || '').trim(), _normalizeSyncCode(row.code)]),row
  ]));
  const authorized = new Set((authorizedAdditions || [])
    .filter(item => item && !item.replaces)
    .map(item => JSON.stringify([
      String(item.name || '').trim(),_normalizeSyncCode(item.code)
    ])));
  const metadata = item => JSON.stringify([
    String(item.type || item.assetType || '주식').trim(),
    String(item.sector || '기타').trim(),
    String(item.currency || 'KRW').trim().toUpperCase(),
    String(item.market || '').trim().toUpperCase()
  ]);
  const repairs=[];
  let matched=0;
  for (const row of afterCodes) {
    const name=String(row.name || '').trim(), code=_normalizeSyncCode(row.code);
    const pair=JSON.stringify([name,code]), original=previous.get(pair);
    if (!original) {
      if (!authorized.has(pair)) return null;
      const journal=(authorizedAdditions||[]).find(entry =>
        !entry?.replaces && String(entry.name||'').trim()===name
          && _normalizeSyncCode(entry.code)===code);
      repairs.push({previousName:name,previousCode:code,name,code,metadataOnly:true,
        ...(journal?.userFields ? {userFields:journal.userFields} : {})});
    } else {
      matched++;
      if (metadata(original)!==metadata(row))
        repairs.push({previousName:name,previousCode:code,name,code,metadataOnly:true});
    }
  }
  if (matched!==beforeCodes.length) return null; // never infer deletion
  return repairs.length ? repairs : null;
}
function _rememberConfirmedCodeMasterChange(target, sourceId, before, after) {
  if (!before || !after || before === after) return;
  const transitions = _gsheetStockMasterConfirmedTransitions.get(target) || [];
  transitions.push({seq:++_gsheetStockMasterConfirmedSeq,sourceId,before,after});
  _gsheetStockMasterConfirmedTransitions.set(target,transitions.slice(-64));
}

// A process can die after GAS flushes A->B but before its failed Settings
// response/readback. In that case ONLY the durable original A->B edit journal
// survives. Promote it to a Settings repair debt BEFORE Bootstrap applies the
// stale Settings A. Never reinterpret a committed rename as an append.
function stageConfirmedSameTargetCodeReplacementRepairs(targetUrl, sourceId, masterCodes) {
  if (!targetUrl || !sourceId || !_stockMasterSyncFingerprint(masterCodes)
      || typeof _getSameTargetLocalCodeAdditions !== 'function'
      || typeof _rememberSameTargetCodeSettingsRepairs !== 'function') return false;
  const entries=_getSameTargetLocalCodeAdditions(targetUrl,sourceId);
  const debt=[];
  for (const entry of entries) {
    const name=String(entry?.name || '').trim();
    const code=_normalizeSyncCode(entry?.code);
    if (!entry?.replaces) {
      // A previous process may have died after append flush but before
      // recording repair debt or receiving the server response. Its durable
      // same-source NEW-asset journal can prove a committed exact pair.
      if (name && code && masterCodes.some(row =>
          String(row.name || '').trim()===name
          && _normalizeSyncCode(row.code)===code))
        debt.push({previousName:name,previousCode:code,name,code,metadataOnly:true,
          ...(entry?.userFields ? {userFields:entry.userFields} : {})});
      continue;
    }
    const oldName=String(entry.replaces.name || '').trim();
    const oldCode=_normalizeSyncCode(entry.replaces.code);
    const confirmed=masterCodes.some(row => String(row.name || '').trim()===name
      && _normalizeSyncCode(row.code)===code);
    const oldAbsent=!masterCodes.some(row =>
      (oldName!==name && String(row.name || '').trim()===oldName)
      || (oldCode!==code && _normalizeSyncCode(row.code)===oldCode));
    // Uncommitted replacements still need their original provenance; a
    // server conflict must not be promoted to a migration or silently erased.
    if (name && code && oldName && oldCode
        && (name!==oldName || code!==oldCode)
        && confirmed && oldAbsent) {
      debt.push({previousName:oldName,previousCode:oldCode,name,code});
    }
  }
  return !debt.length || _rememberSameTargetCodeSettingsRepairs(targetUrl,sourceId,debt);
}

// A committed A->B replacement can later be deleted by ANOTHER tab. The
// full, source-pinned master CAS may then contain neither A nor B. There is
// no metadata left to transfer: a Settings-only rebase must prune stale A.
// Ambiguous aliases (reused old/new names or codes) still fail closed.
function _classifyPinnedCodeSettingsRepairDebt(debts, master) {
  if (!Array.isArray(debts) || !Array.isArray(master)
      || !_stockMasterSyncFingerprint(master)) return null;
  const proofs=[];
  for (const step of debts) {
    const oldName=String(step?.previousName || '').trim(),
      oldCode=_normalizeSyncCode(step?.previousCode),
      newName=String(step?.name || '').trim(),
      newCode=_normalizeSyncCode(step?.code);
    if (!oldName || !oldCode || !newName || !newCode) return null;
    const exact=master.some(row =>
      String(row.name || '').trim()===newName
      && _normalizeSyncCode(row.code)===newCode);
    if (step.metadataOnly === true) {
      if (oldName!==newName || oldCode!==newCode
          || (!exact && master.some(row =>
            String(row.name || '').trim()===newName
            || _normalizeSyncCode(row.code)===newCode))) return null;
      // Keep this exact proof for GAS. It authorizes only its OWN identity.
      proofs.push({...step,metadataOnly:true});
      continue;
    }
    if (oldName===newName && oldCode===newCode) return null;
    const oldAlias=master.some(row =>
      (oldName!==newName && String(row.name || '').trim()===oldName)
      || (oldCode!==newCode && _normalizeSyncCode(row.code)===oldCode));
    const targetAlias=master.some(row =>
      String(row.name || '').trim()===newName
      || _normalizeSyncCode(row.code)===newCode);
    if (exact && !oldAlias) proofs.push(step);
    else if (!exact && !oldAlias && !targetAlias) {
      // A->B commit was followed by B deletion; only its explicit pinned
      // tombstone can authorize pruning a stale original Settings row.
      proofs.push({...step,retired:true});
    } else return null;
  }
  return proofs;
}


// Bootstrap must settle a saved Settings migration BEFORE applying stale
// getBootstrap Settings to EDITABLE_PRICES or declaring the restore complete.
// This path uses only the pinned workbook's server master, never local state.
async function repairPinnedSameTargetCodeSettingsBeforeRestore(options) {
  const targetUrl=String(options?.targetUrl || '').trim();
  const sourceId=String(options?.sourceId || '').trim();
  const generation=options?.generation;
  const expectedFingerprint=_stockMasterSyncFingerprint(options?.masterCodes);
  if (!targetUrl || !sourceId || !expectedFingerprint
      || !isGsheetConnectionCurrent(targetUrl,generation)) return null;
  return _queueGsheetStockMasterWrite(targetUrl,async () => {
    if (!isGsheetConnectionCurrent(targetUrl,generation)) return null;
    const debts=typeof _getSameTargetCodeSettingsRepairs==='function'
      ? _getSameTargetCodeSettingsRepairs(targetUrl,sourceId) : [];
    if (!debts.length) return null;
    const now=await requestGsheetActionJson('getCodeList',{},{
      targetUrl,timeoutMs:15000,retry:1,preserveError:true
    });
    if (!isGsheetConnectionCurrent(targetUrl,generation)
        || now?.status!=='ok' || now.codeMasterSourceId!==sourceId
        || _stockMasterSyncFingerprint(now.codes)!==expectedFingerprint) return null;
    const transferable=_classifyPinnedCodeSettingsRepairDebt(debts,now.codes);
    if (!transferable) return null;
    const canonical=Object.fromEntries(now.codes.map(row => [
      String(row.name || '').trim(),{
        code:_normalizeSyncCode(row.code),type:row.type || '주식',
        sector:row.sector || '기타',currency:(row.currency || 'KRW').toUpperCase(),
        market:(row.market || '').toUpperCase()
      }
    ]));
    const repaired=await requestGsheetFormJson('syncCodes',{
      codes:JSON.stringify(canonical),expectedSourceId:sourceId,
      expectedCodes:JSON.stringify(now.codes),replacements:'[]',
      settingsReplacements:JSON.stringify(transferable),
      forceSettingsRebase:'1'
    },{timeoutMs:20000,retry:0,targetUrl});
    if (repaired?.status!=='ok' || !isGsheetConnectionCurrent(targetUrl,generation)) return null;
    const readback=await requestGsheetActionJson('getCodeList',{},{
      targetUrl,timeoutMs:15000,retry:1,preserveError:true
    });
    if (!isGsheetConnectionCurrent(targetUrl,generation)
        || readback?.status!=='ok' || readback.codeMasterSourceId!==sourceId
        || _stockMasterSyncFingerprint(readback.codes)!==expectedFingerprint) return null;
    if (typeof _rebaseConfirmedSameTargetCodeReplacements==='function'
        && !_rebaseConfirmedSameTargetCodeReplacements(targetUrl,sourceId,
          transferable.filter(step=>step.metadataOnly!==true && step.retired!==true)))
      return null;
    if (typeof _forgetSameTargetCodeSettingsRepairs==='function'
        && !_forgetSameTargetCodeSettingsRepairs(targetUrl,sourceId,debts))
      return null;
    if (typeof _forgetSameTargetLocalCodeAddition==='function'
        && typeof _getSameTargetLocalCodeAdditions==='function') {
      for (const step of debts) {
        if (_getSameTargetLocalCodeAdditions(targetUrl,sourceId).some(entry =>
            entry.name===step.name && _normalizeSyncCode(entry.code)===_normalizeSyncCode(step.code)))
          if (!_forgetSameTargetLocalCodeAddition(step.name,step.code,targetUrl,sourceId))
            return null;
      }
    }
    return {fingerprint:expectedFingerprint,codes:readback.codes};
  });
}

// ── 종목코드 GSheet 자동 등록
async function syncCodesToGsheet(options) {
  const targetUrl = String(options?.targetUrl || GSHEET_API_URL || '').trim();
  // Bind the queued operation to the exact originating connection. A missing
  // caller generation must NEVER mean an unrestricted stale write.
  const generation = Number.isInteger(options?.generation)
    ? options.generation : getGsheetConnectionGeneration();
  const sourceId = String(typeof _gsCodeMasterSourceIdentity !== 'undefined'
    ? _gsCodeMasterSourceIdentity || '' : '').trim();
  const duringRestore = options?.allowDuringRestore === true;
  if (!targetUrl || !isGsheetConnectionCurrent(targetUrl, generation)
      || (!duringRestore && !sourceId)
      || !isGsheetPortfolioWriteReady({
        targetUrl, generation, allowDuringRestore:duringRestore
      })) return null;
  // Snapshot the actual submitted code map before entering the per-target
  // queue. Never dereference the mutable master of a different GAS connection
  // after waiting behind another sync or deletion.
  const codeMap = {};
  const sourceItems = Array.isArray(options?.codeItemsOverride)
    ? options.codeItemsOverride : EDITABLE_PRICES;
  // Preserve fresh custom fields in durable exact-source NEW-asset journal
  // before any network request, including crashes after code-row flush.
  if (!Array.isArray(options?.codeItemsOverride)
      && typeof _refreshSameTargetPendingAppendFields==='function'
      && !_refreshSameTargetPendingAppendFields(targetUrl,sourceId,sourceItems)) {
    _syncWarn('[syncCodes] 신규 종목 저널 영속 확인 실패: 서버 쓰기 중단');
    return null;
  }
  sourceItems.forEach(i => {
    if (!i?.name) return;
    codeMap[i.name] = {
      code:     _normalizeSyncCode(i.code),
      type:     i.assetType || i.type || '주식',
      sector:   i.sector || '기타',
      currency: (i.currency || 'KRW').toUpperCase(),
      market:   (i.market || '').toUpperCase(),
      userFields:typeof _stockPendingAppendUserFields==='function'
        ? _stockPendingAppendUserFields(i) : {}
    };
  });
  if (Object.keys(codeMap).length === 0) {
    _syncWarn('[syncCodes] 전송할 코드 없음');
    return null;
  }
  // Pin the workbook identity now; the expected code master is acquired inside the queue.
  if (!sourceId || sourceId !== _gsheetCodeListSourceId) {
    _syncWarn('[syncCodes] 서버 종목 마스터 스냅샷 미확인');
    return null;
  }
  const fingerprintAtCall = _stockMasterSyncFingerprint(_gsheetCodeList);
  const seqAtCall = _gsheetStockMasterConfirmedSeq;
  if (!fingerprintAtCall) return null;
  return _queueGsheetStockMasterWrite(targetUrl, async () => {
    if (!isGsheetConnectionCurrent(targetUrl, generation)
        || (!duringRestore && sourceId !== String(_gsCodeMasterSourceIdentity || ''))
        || !isGsheetPortfolioWriteReady({
          targetUrl, generation, allowDuringRestore:duringRestore
        })) return null;
    try {
    // Serialize first, THEN acquire a current same-workbook master. An
    // earlier queued A->B confirmation may have rebased a later A->C journal
    // to B->C; pre-queue snapshots would reject every retry permanently.
    const fresh = await requestGsheetActionJson('getCodeList', {}, {
      targetUrl, timeoutMs:15000, retry:1, preserveError:true
    });
    if (!isGsheetConnectionCurrent(targetUrl, generation)
        || String(_gsCodeMasterSourceIdentity || '') !== sourceId
        || fresh?.status !== 'ok' || fresh.codeMasterSourceId !== sourceId
        || !Array.isArray(fresh.codes)) return null;
    const freshFingerprint = _stockMasterSyncFingerprint(fresh.codes);
    if (!_stockMasterHasOnlyConfirmedQueueChanges(
      targetUrl,sourceId,seqAtCall,fingerprintAtCall,freshFingerprint)) {
      _syncWarn('[syncCodes] 호출 이후 타 탭 마스터 변경: 오래된 payload 쓰기 차단');
      return null;
    }
    // A process can stop after append flush but before recording failed
    // Settings. Promote ONLY a same-source exact committed journal pair.
    if (typeof stageConfirmedSameTargetCodeReplacementRepairs==='function'
        && !stageConfirmedSameTargetCodeReplacementRepairs(targetUrl,sourceId,fresh.codes))
      return null;
    // Resolve an earlier fully committed code write whose Settings update
    // failed BEFORE allowing any later rename. Its provenance must survive
    // subsequent B->C edits and browser reloads as a separate durable debt.
    const repairDebt = typeof _getSameTargetCodeSettingsRepairs === 'function'
      ? _getSameTargetCodeSettingsRepairs(targetUrl, sourceId) : [];
    if (repairDebt.length) {
      const current = fresh.codes;
      const transferable=_classifyPinnedCodeSettingsRepairDebt(repairDebt,current);
      if (!transferable) {
        _syncWarn('[syncCodes] 미완료 Settings 이전 대상 변경: 재동기화 차단');
        return null;
      }
      const canonical=Object.fromEntries(current.map(row => [
        String(row.name || '').trim(), {
          code:_normalizeSyncCode(row.code),type:row.type || '주식',
          sector:row.sector || '기타',currency:(row.currency || 'KRW').toUpperCase(),
          market:(row.market || '').toUpperCase()
        }
      ]));
      const repair = await requestGsheetFormJson('syncCodes', {
        codes:JSON.stringify(canonical),expectedSourceId:sourceId,
        expectedCodes:JSON.stringify(current),replacements:'[]',
        settingsReplacements:JSON.stringify(transferable),
        forceSettingsRebase:'1'
      }, {timeoutMs:20000,retry:0,targetUrl});
      if (repair?.status !== 'ok' || !isGsheetConnectionCurrent(targetUrl,generation)
          || String(_gsCodeMasterSourceIdentity || '') !== sourceId) return null;
      const verified=await requestGsheetActionJson('getCodeList', {}, {
        targetUrl,timeoutMs:15000,retry:1,preserveError:true
      });
      if (verified?.status !== 'ok' || verified.codeMasterSourceId !== sourceId
          || !Array.isArray(verified.codes)
          || _stockMasterSyncFingerprint(verified.codes)!==freshFingerprint) return null;
      // A browser may have restarted AFTER the code commit and durable
      // Settings debt save but BEFORE the edit journal rebase was persisted.
      // Rebase any old A->C root now from independently verified B.
      if (typeof _rebaseConfirmedSameTargetCodeReplacements==='function'
          && !_rebaseConfirmedSameTargetCodeReplacements(targetUrl,sourceId,
            transferable.filter(step=>step.metadataOnly!==true && step.retired!==true)))
        return null;
      if (typeof _forgetSameTargetCodeSettingsRepairs === 'function'
          && !_forgetSameTargetCodeSettingsRepairs(targetUrl,sourceId,repairDebt))
        return null;
      // Only the identity that has already been verified on the server can
      // retire. Never discard a newer edited C while repairing prior A->B.
      if (typeof _forgetSameTargetLocalCodeAddition === 'function'
          && typeof _getSameTargetLocalCodeAdditions === 'function') {
        for (const step of repairDebt.filter(item => !item.metadataOnly)) {
          if (_getSameTargetLocalCodeAdditions(targetUrl,sourceId).some(entry =>
              entry.name===step.name && _normalizeSyncCode(entry.code)===_normalizeSyncCode(step.code)))
            if (!_forgetSameTargetLocalCodeAddition(step.name,step.code,targetUrl,sourceId))
            return null;
        }
      }
    }
    applyGsheetCodeList(fresh.codes, sourceId);
  const expectedCodes = _gsheetCodeList.map(item => ({...item}));
  const expectedByCode = new Set(expectedCodes.map(item => _normalizeSyncCode(item.code)));
  const expectedByName = new Set(expectedCodes.map(item => item.name));
  const localAdditions = typeof _getSameTargetLocalCodeAdditions === 'function'
    ? _getSameTargetLocalCodeAdditions(targetUrl, sourceId) : [];
  // Normal sync must not resurrect a code deleted in another tab. Newly
  // introduced name/code pairs require explicit same-workbook UI provenance.
  // A replacement journal is NEVER authorization to append. It must prove
  // the original pair exists in the same immutable pre-write master.
  const authorizedAdditions = new Set(localAdditions
    .filter(item => !item.replaces)
    .map(item => JSON.stringify([
      String(item.name || '').trim(), _normalizeSyncCode(item.code)
    ])));
  const replacements = [];
  const settingsReplacements = [];
  let needsSettingsRebase = false;
  for (const item of localAdditions) {
    if (!item.replaces || _normalizeSyncCode(codeMap[item.name]?.code) !== _normalizeSyncCode(item.code)) continue;
    const oldName = String(item.replaces.name || '').trim();
    const oldCode = _normalizeSyncCode(item.replaces.code || '');
    const originalMatches = oldName && oldCode && expectedCodes.some(prev =>
      prev.name === oldName && _normalizeSyncCode(prev.code) === oldCode);
    if (!originalMatches || (oldName === item.name && oldCode === _normalizeSyncCode(item.code))) {
      // A previous request may have committed its code row but failed while
      // writing Settings. A same-workbook readback proving the exact new pair
      // and absence of its old identity may repair Settings, never append.
      const confirmed = expectedCodes.some(prev =>
        prev.name === item.name && _normalizeSyncCode(prev.code) === _normalizeSyncCode(item.code));
      const oldAbsent = !expectedCodes.some(prev =>
        prev.name === oldName || _normalizeSyncCode(prev.code) === oldCode);
      if (confirmed && oldAbsent && !(oldName === item.name && oldCode === _normalizeSyncCode(item.code))) {
        needsSettingsRebase = true;
        settingsReplacements.push({
          previousName:oldName,previousCode:oldCode,
          name:String(item.name).trim(),code:_normalizeSyncCode(item.code)
        });
        continue;
      }
      _syncWarn('[syncCodes] 원본과 매칭되지 않는 교체 이력은 신규 추가로 전환하지 않음');
      return null;
    }
    replacements.push({
      previousName:oldName,
      previousCode:oldCode,
      name:String(item.name).trim(),
      code:_normalizeSyncCode(item.code)
    });
  }
  const authorizedReplacements = new Set(replacements.map(item =>
    JSON.stringify([item.name, item.code])));
  for (const [name, item] of Object.entries(codeMap)) {
    const code = _normalizeSyncCode(item.code);
    if (!code || expectedByCode.has(code) || expectedByName.has(name)) continue;
    const pair = JSON.stringify([name, code]);
    if (!authorizedAdditions.has(pair) && !authorizedReplacements.has(pair)) {
      _syncWarn('[syncCodes] 근거 없는 신규 코드 추가 차단:', name);
      return null;
    }
  }
    // A previous request may already have changed the code sheet while
    // leaving Settings stale. Repair Settings using the canonical SERVER
    // rows FIRST; never combine no-op recovery with a pending code mutation.
    let data = null;
    const submittedCoded=Object.entries(codeMap)
      .filter(([,item]) => _normalizeSyncCode(item.code))
      .map(([name,item]) => ({name,...item}));
    const hasPendingCodeChange = _stockMasterSyncFingerprint(submittedCoded)!==freshFingerprint;
    if (needsSettingsRebase) {
      const canonical = Object.fromEntries(expectedCodes.map(row => [
        String(row.name || '').trim(), {
          code:_normalizeSyncCode(row.code), type:row.type || '주식',
          sector:row.sector || '기타', currency:(row.currency || 'KRW').toUpperCase(),
          market:(row.market || '').toUpperCase()
        }
      ]));
      const repaired = await requestGsheetFormJson('syncCodes', {
        codes:JSON.stringify(canonical), expectedSourceId:sourceId,
        expectedCodes:JSON.stringify(expectedCodes), replacements:'[]',
        settingsReplacements:JSON.stringify(settingsReplacements),
        forceSettingsRebase:'1'
      }, {timeoutMs:20000,retry:0,targetUrl});
      if (repaired?.status !== 'ok') {
        // Already committed B cannot become an appendable A->B journal.
        // Save the verified Settings-only repair evidence for the next sync.
        if (typeof _rememberSameTargetCodeSettingsRepairs === 'function')
          _rememberSameTargetCodeSettingsRepairs(targetUrl,sourceId,settingsReplacements);
        return null;
      }
      if (!hasPendingCodeChange) data = repaired;
    }
    // Any new mutation is independent and still uses the same full-master CAS.
    if (!data) data = await requestGsheetFormJson(
      'syncCodes',
      { codes: JSON.stringify(codeMap), expectedSourceId:sourceId,
        expectedCodes:JSON.stringify(expectedCodes), replacements:JSON.stringify(replacements),
        forceSettingsRebase:'', settingsReplacements:'[]' },
      { timeoutMs: 20000, retry: 1, targetUrl }
    );
    let repairProof=[];
    if (data?.status !== 'ok') {
      // A failed or timed-out response could have completed the first sheet
      // write. Check exact same-workbook code/name pairs before a bounded
      // Settings-only repair, never reapply stale code payloads.
      const partial = await requestGsheetActionJson('getCodeList', {}, {
        targetUrl, timeoutMs:15000, retry:1, preserveError:true
      });
      if (!isGsheetConnectionCurrent(targetUrl, generation)
          || String(_gsCodeMasterSourceIdentity || '') !== sourceId
          || partial?.status !== 'ok' || partial.codeMasterSourceId !== sourceId
          || !Array.isArray(partial.codes)) return null;
      const currentByName = new Map(partial.codes.map(item =>
        [String(item.name || '').trim(), _normalizeSyncCode(item.code)]));
      const expectedByFullCode = Object.fromEntries(Object.entries(codeMap)
        .filter(([,item]) => _normalizeSyncCode(item.code)));
      const fullyApplied = _stockMasterSyncFingerprint(partial.codes)
        && partial.codes.length === Object.keys(expectedByFullCode).length
        && partial.codes.every(row => {
          const item = expectedByFullCode[String(row.name || '').trim()];
          return item && _normalizeSyncCode(item.code) === _normalizeSyncCode(row.code)
            && String(item.type || '주식') === String(row.type || '주식')
            && String(item.sector || '기타') === String(row.sector || '기타')
            && String(item.currency || 'KRW').toUpperCase() === String(row.currency || 'KRW').toUpperCase()
            && String(item.market || '').toUpperCase() === String(row.market || '').toUpperCase();
        })
        && [...replacements,...settingsReplacements].every(step => !partial.codes.some(row =>
          (step.previousCode !== step.code && _normalizeSyncCode(row.code) === step.previousCode)
          || (step.previousName !== step.name && String(row.name || '').trim() === step.previousName)));
      if (!fullyApplied) {
        _syncWarn('[syncCodes] 원격 부분 변경 또는 충돌: 자동 재전송 차단');
        return null;
      }
      // A successful code-row readback is authoritative EVEN IF the
      // follow-up Settings repair fails. Publish the confirmed transition
      // and rebase a queued A->C journal to B->C before any early return.
      const partialFingerprint=_stockMasterSyncFingerprint(partial.codes);
      if (partialFingerprint!==freshFingerprint) {
        // A later other-tab delete of an unrelated first row must not
        // permanently block restoring Settings after a metadata-only commit.
        repairProof=[...replacements,...settingsReplacements];
        if (!repairProof.length) {
          const changed=_stockMasterMetadataOnlyRepairProof(fresh.codes,partial.codes,localAdditions);
          if (!changed) {
            _syncWarn('[syncCodes] 메타데이터 전용 복구 근거 없는 구조 변경: 중단');
            return null;
          }
          repairProof.push(...changed);
        }
        if (repairProof.length && typeof _rememberSameTargetCodeSettingsRepairs === 'function'
            && !_rememberSameTargetCodeSettingsRepairs(targetUrl,sourceId,repairProof)) return null;
        _rememberConfirmedCodeMasterChange(targetUrl,sourceId,freshFingerprint,partialFingerprint);
        if (typeof _rebaseConfirmedSameTargetCodeReplacements==='function'
            && !_rebaseConfirmedSameTargetCodeReplacements(targetUrl,sourceId,replacements))
          return null;
        // Never erase newer pending C. The committed B is already tracked
        // separately as an unfinished Settings migration.
        if (typeof _getSameTargetLocalCodeAdditions === 'function'
            && typeof _forgetSameTargetLocalCodeAddition === 'function')
          for (const step of replacements) {
            if (_getSameTargetLocalCodeAdditions(targetUrl,sourceId).some(entry =>
                entry.name===step.name && _normalizeSyncCode(entry.code)===_normalizeSyncCode(step.code)))
              if (!_forgetSameTargetLocalCodeAddition(step.name,step.code,targetUrl,sourceId))
            return null;
          }
      }
      applyGsheetCodeList(partial.codes, sourceId);
      // Rebase Settings from the already confirmed SERVER master, not stale
      // local metadata. Server enforces full-master CAS and ScriptLock again.
      const canonical = Object.fromEntries(partial.codes.map(row => [
        String(row.name || '').trim(), {
          code:_normalizeSyncCode(row.code), type:row.type || '주식',
          sector:row.sector || '기타', currency:(row.currency || 'KRW').toUpperCase(),
          market:(row.market || '').toUpperCase()
        }
      ]).filter(([name,row]) => name && row.code));
      data = await requestGsheetFormJson('syncCodes', {
        codes:JSON.stringify(canonical), expectedSourceId:sourceId,
        expectedCodes:JSON.stringify(partial.codes), replacements:'[]',
        settingsReplacements:JSON.stringify(repairProof),
        forceSettingsRebase:'1'
      }, {timeoutMs:20000,retry:0,targetUrl});
      if (data?.status !== 'ok') {
        _syncWarn('[syncCodes] 코드 반영 후 Settings 복구 미완료: Settings 복구 증거 별도 보존', data);
        return null;
      }
      // A successful repair is not verified until the final authoritative
      // readback. Retire the entire durable evidence (including metadataOnly)
      // only AFTER the code-master CAS result is confirmed below.
    }
    // ACK alone is insufficient to retire additions or refresh the revision.
    // Read back the exact same workbook and verify every submitted coded row.
    const checked = await requestGsheetActionJson('getCodeList', {}, {
      timeoutMs:15000, retry:1, preserveError:true, targetUrl
    });
    if (!isGsheetConnectionCurrent(targetUrl, generation)
        || String(_gsCodeMasterSourceIdentity || '') !== sourceId
        || checked?.status !== 'ok' || checked.codeMasterSourceId !== sourceId
        || !Array.isArray(checked.codes)) return null;
    // A code/name-only ACK could hide a concurrent metadata rewrite and
    // incorrectly record it as an authorized in-window transition.
    const submittedRows=Object.entries(codeMap).filter(([,item]) => _normalizeSyncCode(item.code));
    const submittedByName=new Map(submittedRows);
    const consistent=checked.codes.length===submittedRows.length && checked.codes.every(remote => {
      const name=String(remote.name || '').trim(), item=submittedByName.get(name);
      return !!item && _normalizeSyncCode(remote.code)===_normalizeSyncCode(item.code)
        && String(remote.type || '주식')===String(item.type || '주식')
        && String(remote.sector || '기타')===String(item.sector || '기타')
        && String(remote.currency || 'KRW').toUpperCase()===String(item.currency || 'KRW').toUpperCase()
        && String(remote.market || '').toUpperCase()===String(item.market || '').toUpperCase();
    });
    if (!consistent || replacements.some(replacement => checked.codes.some(remote =>
          (replacement.previousCode !== replacement.code
            && _normalizeSyncCode(remote.code) === replacement.previousCode)
          || (replacement.previousName !== replacement.name
            && String(remote.name || '').trim() === replacement.previousName)))) {
      _syncWarn('[syncCodes] 서버 마스터/메타데이터 확인 실패');
      return null;
    }
    const checkedFingerprint = _stockMasterSyncFingerprint(checked.codes);
    if (!checkedFingerprint) return null;
    if (typeof _rebaseConfirmedSameTargetCodeReplacements==='function'
        && !_rebaseConfirmedSameTargetCodeReplacements(targetUrl,sourceId,replacements))
      return null;
    if (repairProof.length && typeof _forgetSameTargetCodeSettingsRepairs === 'function'
        && !_forgetSameTargetCodeSettingsRepairs(targetUrl,sourceId,repairProof))
      return null;
    applyGsheetCodeList(checked.codes, sourceId);
    _rememberConfirmedCodeMasterChange(targetUrl,sourceId,freshFingerprint,checkedFingerprint);
    // Verified normal code sync retires only matching registrations;
    // otherwise a stale registration could later resurrect a removed stock.
    if (!Array.isArray(options?.codeItemsOverride)
        && typeof _getSameTargetLocalCodeAdditions === 'function'
        && typeof _forgetSameTargetLocalCodeAddition === 'function') {
      const source = String(typeof _gsCodeMasterSourceIdentity !== 'undefined' ? _gsCodeMasterSourceIdentity || '' : '');
      for (const item of _getSameTargetLocalCodeAdditions(targetUrl, source)) {
        if (_normalizeSyncCode(codeMap[item.name]?.code) === _normalizeSyncCode(item.code)) {
          if (!_forgetSameTargetLocalCodeAddition(item.name, item.code, targetUrl, source))
            return null;
        }
      }
    }
    return data; // { synced, updated, removed, total }
  } catch(e) {
    _syncWarn('[GSheet 동기화] 예외:', e);
    return null;
    }
  });
}

// ★ v8.1 — 보유현황 GSheet 동기화 (트리거 자동 스냅샷을 위해 필요)
// rawHoldings(수량·원금)를 GSheet 보유현황 시트에 저장
async function syncHoldingsToGsheet(options) {
  const targetUrl = String(options?.targetUrl || GSHEET_API_URL || '').trim();
  if (!targetUrl) return null;
  const allowEmpty = options?.allowEmpty === true;
  const generation = Number.isInteger(options?.generation) ? options.generation : null;
  if (!isGsheetPortfolioWriteReady({
    targetUrl,
    generation,
    allowDuringRestore: options?.allowDuringRestore === true
  })) return null;
  try {
    // 재시도/복구 경로는 호출 시점의 보유현황 payload를 고정할 수 있습니다.
    // 강제 복원 중에는 이전 연결의 rawHoldings가 메모리에 남을 수 있으므로 override가 중요합니다.
    const sourceHoldings = Array.isArray(options?.holdingsOverride) ? options.holdingsOverride : rawHoldings;
    const hasFundDirectOverride = Object.prototype.hasOwnProperty.call(options || {}, 'fundDirectOverride');
    const sourceFundDirect = hasFundDirectOverride
      ? ((options.fundDirectOverride && typeof options.fundDirectOverride === 'object') ? options.fundDirectOverride : {})
      : fundDirect;
    // Do not use the prior connection's getEP/STOCK_CODE when a holding lacks
    // its own code during authoritative restoration. Use the SAME Bootstrap
    // master that passed full-payload preflight.
    const pinnedMaster = options?.allowDuringRestore === true
      && Array.isArray(options?.masterCodesOverride) ? options.masterCodesOverride : null;
    const pinnedByName = pinnedMaster ? new Map() : null;
    (pinnedMaster || []).forEach(item => {
      const name = String(item?.name || '').trim();
      if (name && !pinnedByName.has(name)) pinnedByName.set(name, item);
    });
    // rows에서 종목별 합산 데이터 추출 (계좌 합산 기준)
    const holdMap = {};
    sourceHoldings.forEach(h => {
      if (!h.name || h.qty <= 0) return;
      const ep = pinnedByName ? null : getEP(h.name);
      const pinned = pinnedByName ? pinnedByName.get(String(h.name || '').trim()) : null;
      // During restore, never backfill a missing code/type from stale local EP.
      // The complete restore preflight rejects mismatched holding names/codes.
      const code = _normalizeSyncCode(pinnedByName
        ? (h.code || pinned?.code || '')
        : (h.code || ep?.code || STOCK_CODE[h.name] || ''));
      const assetType = pinnedByName
        ? (pinned?.type || pinned?.assetType || h.assetType || h.type || '주식')
        : (h.assetType || h.type || getEPType(ep, '주식'));
      const key  = h.name;
      if (!holdMap[key]) holdMap[key] = { code, name: h.name, qty: 0, costAmt: 0, assetType, accts: [] };
      if (h.acct && !holdMap[key].accts.includes(h.acct)) holdMap[key].accts.push(h.acct);
      holdMap[key].qty     += h.qty;
      holdMap[key].costAmt += (h.qty * (h.cost || 0));
    });
    // ★ fundDirect(TDF/펀드) 항목 추가 — qty 개념 없으므로 qty=1, costAmt=cost로 저장
    Object.entries(sourceFundDirect).forEach(([name, fd]) => {
      if (!name || !fd || fd.cost <= 0) return;
      if (holdMap[name]) return; // rawHoldings에 이미 있으면 중복 스킵
      holdMap[name] = { code: '', name, qty: 1, costAmt: fd.cost || 0, assetType: fd.type || 'TDF' };
    });
    // accts 배열 → acct 문자열로 변환 (쉼표 연결)
    Object.values(holdMap).forEach(h => { h.acct = (h.accts||[]).join(','); delete h.accts; });
    const holdings = Object.values(holdMap).filter(h => h.qty > 0);
    // 확인된 마지막 거래 삭제에서 실제 보유도 0이 된 경우에만 원격 보유현황 [] 삭제를 허용합니다.
    // 초기 복원 실패 등 일반 빈 상태에서는 기존 원격 보유현황을 보존합니다.
    if (holdings.length === 0 && !allowEmpty) return;

    const data = await requestGsheetFormJson(
      'syncHoldings',
      { data: JSON.stringify(holdings) },
      { timeoutMs: options?.allowDuringRestore === true ? 60000 : 20000, retry: options?.allowDuringRestore === true ? 0 : 1, targetUrl, preserveError: true }
    );
    if (!data) { _syncWarn('[보유현황 동기화] 네트워크 오류'); return null; }
    if (data.status === 'ok') {
      _syncWarn('[보유현황 동기화] ✅', data.synced + '개');
      return data;
    }
    _syncWarn('[보유현황 동기화] 응답 오류', data);
    return data;
  } catch(e) {
    _syncWarn('[보유현황 동기화]', e.message);
    return null;
  }
}

// Pure preflight before a restore retry starts ANY remote holdings/trades
// writes. A partial or mismatched pinned ledger cannot be posted while the
// second concurrent request modifies holdings.
// Code-less TDF/direct-fund transactions are legal ledger entries but GAS
// getCodeItems returns only assets with a stock code. Never impose the coded
// stock-master invariant on those entries, and never use this exception when
// any code (including an unknown one) is supplied.
function isCodeLessDirectFundTrade(t) {
  const type = String(t?.assetType || t?.type || '').trim().toUpperCase();
  return !_normalizeSyncCode(t?.code || '') && (type === 'TDF' || type === '펀드' || type === 'FUND');
}

function isPinnedRestoreTradeMasterComplete(trades, codes) {
  if (!Array.isArray(trades) || !Array.isArray(codes)) return false;
  const serverByCode = new Map(), serverByName = new Map();
  // Every coded master row MUST have one unambiguous identity. A forEach
  // callback return cannot signal a conflict to its enclosing validator.
  for (const item of codes) {
    const code = _normalizeSyncCode(item?.code || '');
    const name = String(item?.name || '').trim();
    if (!code || !name) continue;
    if (serverByCode.has(code) || serverByName.has(name)) return false;
    serverByCode.set(code, name);
    serverByName.set(name, code);
  }
  return trades.every(t => {
    const name = String(t?.name || '').trim();
    if (!name || !t.tradeType || !t.date) return false;
    if (isCodeLessDirectFundTrade(t)) return true;
    const code = _normalizeSyncCode(t.code || '');
    return code ? serverByCode.get(code) === name : serverByName.has(name);
  });
}

/**
 * Validate ALL payloads against a master pinned to this Bootstrap response
 * before the first holdings, trades, or settings write on authoritative restore.
 */
function isPinnedRestorePortfolioMasterComplete(trades, holdings, directFunds, codes) {
  if (!Array.isArray(trades) || !Array.isArray(holdings) || !Array.isArray(codes)
      || !directFunds || typeof directFunds !== 'object' || Array.isArray(directFunds)) return false;
  if (!isPinnedRestoreTradeMasterComplete(trades, codes)) return false;
  const codedByCode = new Map(), codedNames = new Set(), codeLessFunds = new Set();
  const fundTypes = new Set(['TDF', '펀드', 'FUND']);
  codes.forEach(item => {
    const name = String(item?.name || '').trim();
    const code = _normalizeSyncCode(item?.code || '');
    if (!name) return;
    if (code) {
      codedByCode.set(code, name);
      codedNames.add(name);
    } else if (fundTypes.has(String(item?.type || item?.assetType || '').trim().toUpperCase())) {
      codeLessFunds.add(name);
    }
  });
  const validHolding = h => {
    if (!h || typeof h !== 'object') return false;
    const name = String(h.name || '').trim();
    const code = _normalizeSyncCode(h.code || '');
    if (!name) return false;
    if (code) return codedByCode.get(code) === name;
    const type = String(h.assetType || h.type || '').trim().toUpperCase();
    return fundTypes.has(type) ? codeLessFunds.has(name) : codedNames.has(name);
  };
  return trades.every(t => !isCodeLessDirectFundTrade(t)
      || codeLessFunds.has(String(t.name || '').trim()))
    && holdings.every(validHolding)
    && Object.entries(directFunds).every(([name, fd]) => {
      const type = String(fd?.type || '').trim().toUpperCase();
      return !!String(name).trim() && fd && typeof fd === 'object' && !Array.isArray(fd)
        && fundTypes.has(type) && codeLessFunds.has(String(name).trim());
    });
}


// Recovery of a new code whose normal syncCodes POST failed. Provenance must be
// supplied by the SAME remote Settings or by an explicit stock-management edit
// journal recorded while that target's bootstrap was previously successful.
// Never use unproven EDITABLE_PRICES as an authority to add codes to a sheet.
async function recoverPinnedMissingPortfolioCodes(options) {
  const targetUrl = String(options?.targetUrl || '').trim();
  const generation = options?.generation;
  const masterCodes = options?.masterCodes;
  const dirty = options?.dirty;
  if (!targetUrl || !Array.isArray(masterCodes) || !dirty
      || typeof isGsheetConnectionCurrent !== 'function'
      || !isGsheetConnectionCurrent(targetUrl, generation)) return masterCodes;
  const refs = [
    ...(Array.isArray(dirty.trades) ? dirty.trades : []),
    ...(Array.isArray(dirty.holdings) ? dirty.holdings : [])
  ].map(row => ({ name:String(row?.name || '').trim(), code:_normalizeSyncCode(row?.code || '') }))
    .filter(row => row.code);
  const existingByCode = new Map(), existingByName = new Map();
  for (const item of masterCodes) {
    const code = _normalizeSyncCode(item?.code || '');
    const name = String(item?.name || '').trim();
    if (!code || !name) continue;
    if (existingByCode.has(code) && existingByCode.get(code) !== name) return masterCodes;
    if (existingByName.has(name) && existingByName.get(name) !== code) return masterCodes;
    existingByCode.set(code, name);
    existingByName.set(name, code);
  }
  const remoteEntries = Array.isArray(options?.remoteSettings?.EDITABLE_PRICES)
    ? options.remoteSettings.EDITABLE_PRICES : [];
  const trustedLocal = typeof _getSameTargetLocalCodeAdditions === 'function'
    ? _getSameTargetLocalCodeAdditions(targetUrl, options?.expectedSourceId) : [];
  // Only an explicit local NEW registration may authorize append. A rename
  // journal is proof of a replacement, never authorization to resurrect a
  // deleted old identity or append an already committed new pair.
  const proven = [...remoteEntries, ...trustedLocal.filter(entry => !entry.replaces)];
  const additions = new Map();
  for (const row of refs) {
    if (!row.name) return masterCodes;
    if (existingByCode.has(row.code) || existingByName.has(row.name)) {
      // A known code with the wrong name (or vice versa) is not a new asset.
      if (existingByCode.get(row.code) !== row.name
          || existingByName.get(row.name) !== row.code) return masterCodes;
      continue;
    }
    const candidate = proven.find(ep =>
      String(ep?.name || '').trim() === row.name
      && _normalizeSyncCode(ep?.code || '') === row.code);
    if (!candidate) return masterCodes;
    if ([...additions.values()].some(e => e.name === row.name && e.code !== row.code
      || e.code === row.code && e.name !== row.name)) return masterCodes;
    additions.set(row.code, {
      name:row.name, code:row.code,
      type:String(candidate.assetType || candidate.type || '주식'),
      sector:String(candidate.sector || '기타'),
      currency:String(candidate.currency || 'KRW').toUpperCase(),
      market:String(candidate.market || '').toUpperCase()
    });
  }
  // A stock-management addition may not yet have any trades or holdings.
  // Its code still must be recoverable after reload if syncCodes failed.
  // Only explicit same-target registration evidence (not arbitrary browser
  // editable prices or unrelated server Settings) authorizes code-only repair.
  for (const entry of trustedLocal) {
    if (entry?.replaces) continue; // Always repair full-pair migration first.
    const code = _normalizeSyncCode(entry?.code || '');
    const name = String(entry?.name || '').trim();
    if (!name || !code) continue;
    if (existingByCode.get(code) === name) {
      // Code may be committed while its Settings write is still missing.
      // Bootstrap stages/settles the durable NEW-asset journal before retiring.
      continue;
    }
    // Any collision belongs to a human reconciliation, not auto-recovery.
    if (existingByCode.has(code) || existingByName.has(name)) continue;
    if (additions.has(code) && additions.get(code).name !== name) return masterCodes;
    if ([...additions.values()].some(e => e.name === name && e.code !== code)) return masterCodes;
    if (!additions.has(code)) additions.set(code, {
      name, code,
      type:String(entry.assetType || entry.type || '주식'),
      sector:String(entry.sector || '기타'),
      currency:String(entry.currency || 'KRW').toUpperCase(),
      market:String(entry.market || '').toUpperCase()
    });
  }
  if (!additions.size) return masterCodes;
  const proposed = [...masterCodes, ...additions.values()];
  if (!isPinnedRestorePortfolioMasterComplete(
      dirty.trades, dirty.holdings, dirty.fundDirect, proposed)) return masterCodes;
  if (!isGsheetConnectionCurrent(targetUrl, generation)) return null;
  // Atomic compare-and-append on GAS under the SAME ScriptLock used by
  // ordinary syncCodes. Unlike syncCodes, this action cannot rename an
  // existing code or overwrite an existing name, even if another tab writes
  // between getBootstrap and this request.
  const response = await requestGsheetFormJson('syncCodesAppendOnly', {
    codes:JSON.stringify(Object.fromEntries([...additions.values()].map(item => [
      item.name, { code:item.code, type:item.type, sector:item.sector,
        currency:item.currency, market:item.market }
    ]))),
    expectedCodes:JSON.stringify(masterCodes.filter(item => _normalizeSyncCode(item?.code || ''))),
    expectedSourceId:String(options?.expectedSourceId || '')
  }, {timeoutMs:20000,retry:0,targetUrl});
  if (response?.status !== 'ok' || !isGsheetConnectionCurrent(targetUrl, generation)) return null;
  // An ACK is insufficient: read the exact target again and prove identity.
  const checked = await requestGsheetActionJson('getCodeList', {}, {
    targetUrl, timeoutMs:15000, retry:1, preserveError:true
  });
  if (!isGsheetConnectionCurrent(targetUrl, generation)
      || checked?.status !== 'ok' || !Array.isArray(checked.codes)
      || !options?.expectedSourceId || checked.codeMasterSourceId !== options.expectedSourceId) return null;
  const actualByCode = new Map();
  for (const item of checked.codes) {
    const code = _normalizeSyncCode(item?.code || '');
    const name = String(item?.name || '').trim();
    if (code && name) {
      if (actualByCode.has(code) && actualByCode.get(code) !== name) return null;
      actualByCode.set(code, name);
    }
  }
  for (const [code,name] of existingByCode) {
    if (actualByCode.get(code) !== name) return null;
  }
  for (const item of additions.values()) {
    if (actualByCode.get(item.code) !== item.name) return null;
  }
  const verified = [
    ...checked.codes,
    ...masterCodes.filter(item => !_normalizeSyncCode(item?.code || ''))
  ];
  if (!isPinnedRestorePortfolioMasterComplete(
      dirty.trades, dirty.holdings, dirty.fundDirect, verified)) return null;
  // Append-only GAS writes only Codes, not EDITABLE_PRICES. Durably
  // stage same-source journal as Settings repair debt. Bootstrap must settle
  // Settings-only CAS and read back BOTH stores before clearing the journal.
  if (typeof stageConfirmedSameTargetCodeReplacementRepairs !== 'function'
      || !stageConfirmedSameTargetCodeReplacementRepairs(targetUrl,
        String(options?.expectedSourceId || ''),checked.codes)) return null;
  return verified;
}

// ★ v8.2 — 거래이력 GSheet 동기화 (backfillMonth 소급 계산용)
async function syncTradesToGsheet(options) {
  const targetUrl = String(options?.targetUrl || GSHEET_API_URL || '').trim();
  if (!targetUrl) return null;
  const allowEmpty = options?.allowEmpty === true;
  const generation = Number.isInteger(options?.generation) ? options.generation : null;
  if (!isGsheetPortfolioWriteReady({
    targetUrl,
    generation,
    allowDuringRestore: options?.allowDuringRestore === true
  })) return null;
  const rebuildFrom = allowEmpty ? String(options?.rebuildFrom || '').trim() : '';
  const hasTradesOverride = Array.isArray(options?.tradesOverride);
  // 재시도/복구 경로는 호출 직전에 캡처한 payload를 사용할 수 있습니다.
  // 빈 override는 아래 allowEmpty 가드 때문에 일반 동기화에서 원격 삭제 권한이 되지 않습니다.
  const sourceTrades = hasTradesOverride ? options.tradesOverride : rawTrades;
  // 초기 부트스트랩 실패/미완료로 거래가 비어 있는 상태에서는 원격 원장을 절대 비우지 않습니다.
  // 확인된 마지막 거래 삭제 경로가 전달한 1회성 allowEmpty만 예외입니다.
  if (sourceTrades.length === 0 && !allowEmpty) return;
  try {
    // Bootstrap's code list belongs to the same authenticated connection and
    // is available BEFORE EDITABLE_PRICES is restored. A pending trade retry
    // must not treat a complete server master as missing merely because the
    // browser's in-memory master has not yet been applied.
    const restoreMaster = options?.allowDuringRestore === true
      && Array.isArray(options?.masterCodesOverride) ? options.masterCodesOverride : null;
    const serverByCode = new Map(), serverByName = new Map();
    (restoreMaster || []).forEach(item => {
      const code = _normalizeSyncCode(item?.code || '');
      const name = String(item?.name || '').trim();
      const type = String(item?.type || item?.assetType || '').trim().toUpperCase();
      // Only code-less funds/TDFs from this same Bootstrap settings qualify.
      // Other code-less objects must never authorize trading-ledger rewrites.
      if (!name || (!code && !['TDF', '펀드', 'FUND'].includes(type))) return;
      if (code) serverByCode.set(code, item);
      if (!serverByName.has(name)) serverByName.set(name, item);
    });
    const unmatchedTrades = [];
    const trades = sourceTrades
      .filter(t => t.name && t.tradeType && t.date)
      .map(t => {
        const tCode = _normalizeSyncCode(t.code || '');
        const epByCode = tCode ? getEPByCode(tCode) : null;
        const epByName = getEP(t.name);
        const isDirectFund = !!restoreMaster && isCodeLessDirectFundTrade(t);
        // A known server code/name is a valid restoration match even if the
        // local master is still empty. Local canonical data wins when present.
        // A supplied but unknown code must never be silently reassigned by
        // a coincidentally matching name. Only code-less trades use name lookup.
        const remote = isDirectFund ? null
          : ((tCode ? serverByCode.get(tCode) : null)
            || (!tCode ? serverByName.get(String(t.name || '').trim()) : null));
        // During an authoritative retry the browser's local master may
        // belong to the previous connection. Never let that local value
        // override a code verified from this connection's Bootstrap result.
        const ep = restoreMaster ? null : (epByCode || epByName);
        if (!ep && !remote && !isDirectFund) {
          unmatchedTrades.push({ date: t.date || '', name: t.name || '', code: tCode || '' });
        }
        // Do not import a stale browser STOCK_CODE into legitimate code-less
        // fund trades, even when a code-bearing stock shares the same name.
        const baseCode = isDirectFund ? ''
          : (ep?.code || remote?.code || STOCK_CODE[ep?.name || t.name] || '');
        const code = isDirectFund ? '' : _normalizeSyncCode(baseCode || t.code || '');
        return {
          date:      t.date,
          tradeType: t.tradeType,
          acct:      t.acct      || '',
          name:      isDirectFund ? t.name : (ep?.name || remote?.name || t.name),
          code:      code,
          qty:       t.qty       || 0,
          price:     t.price     || 0,
          assetType: isDirectFund ? (t.assetType || t.type || '펀드')
            : getEPType(ep, remote?.type || t.assetType || '주식'),
          memo:      t.memo      || '',
        };
      });
    // Never persist a truncated dirty ledger during authoritative restore:
    // filtering even one malformed row would silently erase that transaction.
    if (restoreMaster && trades.length !== sourceTrades.length) {
      _syncWarn('[거래이력 동기화] 복원 원장 유효성 부족 · 서버 저장 보류');
      return { status:'error', errorCode:'RESTORE_TRADE_PAYLOAD_INCOMPLETE', saveState:'failed' };
    }
    // 유효한 원본 거래가 있는데 필터 결과만 0건인 경우와 권한 없는 빈 상태는 전체 삭제를 막습니다.
    if (trades.length === 0 && (sourceTrades.length > 0 || !allowEmpty)) return;
    // A master supplied by this very Bootstrap is authoritative for the retry.
    // Unknown transactions must not be silently committed to the server. Keep
    // the dirty payload for a later recovery; other callers preserve their
    // previous unmatched-warning behavior.
    if (restoreMaster && unmatchedTrades.length) {
      _syncWarn('[거래이력 동기화] 서버 기초정보 확인 실패 · 저장 보류:',
        unmatchedTrades.map(t => ({ name:t.name, code:t.code })));
      return { status:'error', errorCode:'RESTORE_MASTER_UNMATCHED', saveState:'failed' };
    }
    if (unmatchedTrades.length > 0) {
      const uniq = Array.from(new Set(unmatchedTrades.map(t => `${t.name}|${t.code}`)));
      _syncWarn('[거래이력 동기화] 기초정보 미매칭 거래 포함:', unmatchedTrades);
      if (typeof showToast === 'function') {
        showToast(`⚠️ 기초정보 미매칭 거래 ${uniq.length}건 포함 (동기화 전 기초정보 점검 권장)`, 'warn');
      }
      syncIssuesToGsheet('syncTradesToGsheet', unmatchedTrades, {
        targetUrl,
        generation,
        allowDuringRestore: options?.allowDuringRestore === true
      }).catch(()=>{});
    }

    const data = await requestGsheetFormJson(
      'syncTrades',
      {
        data: JSON.stringify(trades),
        explicitEmpty: allowEmpty ? '1' : '',
        rebuildFrom
      },
      { timeoutMs: 30000, retry: 1, targetUrl, preserveError: true }
    );
    if (!data) { _syncWarn('[거래이력 동기화] 네트워크 오류'); return; }
    if (data.status === 'ok') {
      _syncWarn('[거래이력 동기화] ✅', data.synced + '건');
      return data;
    }
    if (data.saveState === 'partial') {
      const range = data.affectedTo ? `${data.affectedFrom || '-'} ~ ${data.affectedTo}` : (data.affectedFrom || '-');
      const message = `일부 반영: 거래원장은 저장됐지만 과거 평가 재계산이 완료되지 않았습니다 · 영향기간 ${range}`;
      _syncWarn('[거래이력 동기화]', message, data);
      if (typeof showToast === 'function') showToast(message, 'warn', 7000);
      return data;
    }
    const message = data.message || '거래이력 저장 실패';
    _syncWarn('[거래이력 동기화]', message, data);
    if (typeof showToast === 'function') showToast(message, 'warn', 7000);
    return data;
  } catch(e) {
    _syncWarn('[거래이력 동기화]', e.message);
    return null;
  }
}

async function lookupOfficialStockByCode(code) {
  if (!code) return null;
  const trimCode = _normalizeSyncCode(code);
  if (!trimCode || !GSHEET_API_URL) return null;
  if (!window.GAS_API_KEY_STATUS?.publicDataApiKeyConfigured) return null;
  try {
    const data = await requestGsheetActionJson('name', { code: trimCode }, { timeoutMs: 8000, retry: 1 });
    if (!data || data.status === 'error') return null;
    const name = String(data.officialName || data.name || '').trim();
    if (!name) return null;
    return {
      code: trimCode,
      name,
      officialName: String(data.officialName || name).trim(),
      crno: String(data.crno || '').trim(),
      market: String(data.market || '').trim(),
      source: String(data.source || '').trim(),
    };
  } catch(e) { return null; }
}

function _renderTossConfigStatus(status) {
  const target = $el('tossConfigStatus');
  if (!target) return;
  const toss = status || {};
  const id = toss.clientIdConfigured ? (toss.clientIdMasked || '설정됨') : '미설정';
  const secret = toss.secretConfigured ? '설정됨' : '미설정';
  const diag = toss.lastDiagnosticAt
    ? `${toss.lastDiagnosticOk ? '성공' : '실패 · ' + (toss.lastDiagnosticCode || 'ERROR')} · ${toss.lastDiagnosticAt}`
    : '미실행';
  target.innerHTML = `Client ID: <b>${_escapeHtml(id)}</b> · Client Secret: <b>${secret}</b> · 최근 진단: <b>${_escapeHtml(diag)}</b>`;
}

async function saveTossConfigFromUI() {
  if (!GSHEET_API_URL) return;
  const clientId = String($el('tossClientIdInput')?.value || '').trim();
  const secret = String($el('tossClientSecretInput')?.value || '').trim();
  if (!clientId && !secret) {
    const status = $el('tossConfigStatus');
    if (status) status.textContent = '입력값이 없어 기존 설정을 유지했습니다.';
    return;
  }
  try {
    const data = await requestGsheetFormJson('saveTossConfig', { data: JSON.stringify({ clientId, secret }) }, { timeoutMs: 15000, retry: 0 });
    if (!data || data.status !== 'ok') throw new Error(data?.message || '응답 오류');
    if ($el('tossClientIdInput')) $el('tossClientIdInput').value = '';
    if ($el('tossClientSecretInput')) $el('tossClientSecretInput').value = '';
    _renderTossConfigStatus(data.toss);
    if (typeof showToast === 'function') showToast('✅ Toss 설정을 저장했습니다. 원문은 브라우저에 보관하지 않습니다.', 'success');
  } catch (error) {
    if ($el('tossConfigStatus')) $el('tossConfigStatus').textContent = '❌ Toss 설정 저장 실패: ' + (error.message || '응답 오류');
  }
}

// PC·모바일의 로컬 GAS 연결 설정을 비교하되 토큰·URL 쿼리·배포 ID 전체는 노출하지 않습니다.
function _tossConnectionSummary_(rawUrl, hasAccessToken) {
  let endpoint = 'URL 미설정';
  try {
    const url = new URL(String(rawUrl || '').trim());
    const match = url.pathname.match(/\/macros\/s\/([^/]+)\/(exec|dev)\/?$/);
    endpoint = match ? `${url.hostname} / 배포 …${match[1].slice(-8)} /${match[2]}`
      : `${url.hostname} / GAS 경로 확인 필요`;
  } catch (_) {}
  return `${endpoint} / GAS 접근토큰 ${hasAccessToken ? '설정됨' : '미설정'}`;
}

// 늦게 도착한 이전 GAS 응답이 새 연결 또는 새 진단을 덮어쓰지 않도록 구분합니다.
let _tossDiagnosisRunId = 0;
async function diagnoseTossFromUI() {
  const targetUrl = String(GSHEET_API_URL || '').trim();
  if (!targetUrl) return;
  const generation = getGsheetConnectionGeneration();
  const accessToken = getGsheetAccessToken();
  const runId = ++_tossDiagnosisRunId;
  const isCurrentConnection = () => isGsheetConnectionCurrent(targetUrl, generation)
    && getGsheetAccessToken() === accessToken;
  const target = $el('tossDiagnosticResult');
  if (target) target.textContent = '진단 중...';
  try {
    const data = await requestGsheetActionJson('diagnoseTossMarketData', {}, { timeoutMs: 30000, retry: 0, targetUrl });
    if (runId !== _tossDiagnosisRunId) return;
    if (!isCurrentConnection()) {
      if (target) target.textContent = 'GAS 연결/접근토큰이 변경되어 이전 진단 결과를 폐기했습니다. 다시 진단하세요.';
      return;
    }
    if (!data || data.status !== 'ok') throw new Error(data?.message || '응답 오류');
    const oauth = data.oauth || { ok: false, status: null, code: 'OAUTH_RESULT_MISSING', providerCode: '' };
    const egress = data.egressProbe || { ok: false, status: null, code: 'NOT_AVAILABLE', ip: '', provider: '' };
    const idSuffix = item => {
      const ids = [
        item?.requestId ? `requestId ${item.requestId}` : '',
        item?.referenceId ? `referenceId ${item.referenceId}` : '',
        item?.edgeRequestId ? `x-amz-cf-id ${item.edgeRequestId}` : '',
      ].filter(Boolean);
      return ids.length ? ` / ${ids.join(' / ')}` : '';
    };
    const sourceLabel = oauth.source === 'CACHE' ? '최초 기존 캐시 토큰 사용'
      : (oauth.source === 'NETWORK' ? '최초 신규 OAuth 요청' :
      (oauth.source === 'RELAY' ? 'OCI 중계 VM이 OAuth를 단독 관리' : '최초 토큰 출처 미확인'));
    const connectionInfo = _tossConnectionSummary_(targetUrl, !!accessToken);
    const lines = [`GAS 연결: ${connectionInfo} / 서버 v${String(data.gasVersion || '미확인')}`,
      `OAuth 실행 방식: ${sourceLabel}`,
      `${oauth.source === 'RELAY' ? '🔎' : (egress.ok ? '🔎' : '⚠️')} ${oauth.source === 'RELAY' ? '중계 VM 출구 IP는 VM에서 별도 검증' : 'GAS egress 관측'}: ${egress.status ?? '-'} / ${egress.code || 'ERROR'}${egress.ipFamily ? ` / ${egress.ipFamily}` : ''} / ${egress.ip || 'IP 없음'}${egress.provider ? ` / ${egress.provider}` : ''} / ${Number(egress.elapsedMs || 0)}ms`,
      `${oauth.ok ? '✅' : '❌'} OAuth: ${oauth.status ?? '-'} / ${oauth.code || 'ERROR'}${oauth.providerCode ? ` / ${oauth.providerCode}` : ''}${idSuffix(oauth)} / ${Number(oauth.elapsedMs || 0)}ms`];
    if (oauth.recovery?.attempted) {
      const recoveryLabel = oauth.recovery.code === 'RESOURCE_401_RECOVERED_PROBES_FAILED'
        ? '401 해소, 다른 API 진단 실패' : (oauth.recovery.ok ? '401 해소' : '401 복구 실패');
      const recoverySourceLabel = oauth.recovery.source === 'NETWORK' ? '신규 OAuth 발급'
        : (oauth.recovery.source === 'CACHE_UPDATED' ? '다른 실행의 갱신 토큰 재사용'
        : (oauth.recovery.source === 'NETWORK_ERROR' ? '신규 OAuth 시도 실패' : '토큰 교체 없음'));
      lines.push(`OAuth 캐시 401 복구: ${recoveryLabel} / ${oauth.recovery.code || 'UNKNOWN'} / ${recoverySourceLabel}`);
    }
    if (!egress.ok && Array.isArray(egress.attempts) && egress.attempts.length) {
      lines.push(...egress.attempts.map(item => '  ↳ ' + (item.provider || 'provider') + ': ' + (item.status ?? '-') + ' / ' + (item.code || 'ERROR') + ' / length ' + Number(item.bodyLength || 0) + (item.contentType ? ' / ' + item.contentType : '') + ' / ' + Number(item.elapsedMs || 0) + 'ms'));
    }
    lines.push(...(data.endpoints || []).map(item => `${item.ok ? '✅' : (item.code === 'SKIPPED_OAUTH_FAILED' ? '⏭️' : '❌')} ${item.name}: ${item.status ?? '-'} / ${item.code || 'ERROR'}${item.providerCode ? ` / Toss코드 ${item.providerCode}` : ''} / ${Number(item.count || 0)}건${idSuffix(item)} / ${Number(item.elapsedMs || 0)}ms`));
    const smoke = data.priceSmoke || {};
    lines.push(`${smoke.ok && smoke.validLastPrice && smoke.timestampPresent ? '✅' : (smoke.code === 'SKIPPED_OAUTH_FAILED' ? '⏭️' : '❌')} priceSmoke 005930: ${smoke.status ?? '-'} / ${smoke.code || 'ERROR'}${smoke.providerCode ? ` / Toss코드 ${smoke.providerCode}` : ''} / ${Number(smoke.resultCount || 0)}건 / ${smoke.symbol || '005930'} / 유효가격 ${smoke.validLastPrice ? '있음' : '없음'} / timestamp ${smoke.timestampPresent ? '있음' : '없음'}${idSuffix(smoke)} / ${Number(smoke.elapsedMs || 0)}ms`);
    const ipBlocked = oauth.ok && [...(data.endpoints || []), smoke].some(item => item.code === 'IP_NOT_ALLOWED_OR_FORBIDDEN');
    const oauthFailed = !oauth.ok && oauth.code !== 'CREDENTIALS_NOT_CONFIGURED';
    const oauthUnidentified = oauthFailed && oauth.status === 401 && String(oauth.providerCode || '').toLowerCase() === 'unidentified-client';
    const oauthAccessDenied = oauthFailed && oauth.status === 403 && String(oauth.providerCode || '').toLowerCase() === 'access_denied';
    const observedIpGuide = egress.ok && egress.ip ? ` 관측 ${egress.ipFamily || 'IP'} ${egress.ip}는 참고 관측값이며 Toss 요청의 실제 송신 IP로 검증되지 않았습니다. 이 주소를 근거 없이 Toss 허용 IP에 등록하지 마세요.` : '';
    const provider403Codes = [...(data.endpoints || []), smoke].filter(item => item?.status === 403).map(item => item.providerCode || 'UNKNOWN_403');
    const reason = provider403Codes.includes('ip-not-allowed') ? 'Toss 원문 ip-not-allowed 확인: 허용 IP 거부입니다.'
      : provider403Codes.includes('forbidden') ? 'Toss 원문 forbidden 확인: API 권한 부족입니다.'
      : provider403Codes.includes('edge-blocked') ? 'Toss 원문 edge-blocked 확인: 요청이 차단되었습니다.'
      : 'HTTP 403이지만 Toss 원문 코드는 확인되지 않았습니다. IP 거부로 단정하지 마세요.';
    const guide = ipBlocked ? `\n\n실제 Toss 리소스 403: ${reason} Toss 요청 ID를 공급사에 전달하여 발신 IP·권한을 대조하세요. Google 공유 IP 대역 전체를 근거 없이 허용하지 마세요.${observedIpGuide}`
      : (oauthAccessDenied ? `\n\nOAuth 403 access_denied · IP 허용 정책에 의해 차단됐을 가능성이 큽니다.${observedIpGuide}`
      : (oauthUnidentified ? '\n\nOAuth 401 unidentified-client · 위 request/reference/edge ID를 함께 기록해 Toss 측 인증 거부 원인을 확인하세요. Wi-Fi에서 동일 자격증명이 정상이라면 IP 허용 403과는 별도 문제입니다.'
      : (oauthFailed ? '\n\nOAuth 토큰 발급 단계 실패 · Client ID/Secret, 앱 권한/승인 상태, Toss Open API OAuth 설정을 확인하세요.' : '')));
    const caveat = '\n\n※ CACHE 출처는 최초 토큰 확보 방식이며, 최초 캐시 토큰에 대한 resource 401 복구에서는 별도의 신규 OAuth 요청이 발생할 수 있습니다. PC/모바일의 GAS 배포·접근토큰 유무를 비교하세요.\n※ GAS egress 관측값은 외부 IP 확인 서비스가 본 참고값입니다. Toss 요청의 실제 출구 IP와 동일하다고 보장되지 않습니다.';
    if (target) target.innerHTML = _escapeHtml(lines.join('\n') + guide + caveat);
    const diagnosticCode = typeof data.diagnosticCode === 'string' && data.diagnosticCode
      ? data.diagnosticCode : (data.ok ? 'OK' :
      (oauth.recovery?.attempted && !oauth.recovery.ok ? oauth.recovery.code :
      (!oauth.ok ? oauth.code : ((data.endpoints || []).find(item => !item.ok)?.code || smoke.code || 'ERROR'))));
    _renderTossConfigStatus({ ...(window.GAS_API_KEY_STATUS?.toss || {}), lastDiagnosticAt: data.generatedAt, lastDiagnosticOk: !!data.ok, lastDiagnosticCode: diagnosticCode });
  } catch (error) {
    if (runId !== _tossDiagnosisRunId) return;
    if (!isCurrentConnection()) {
      if (target) target.textContent = 'GAS 연결/접근토큰이 변경되어 이전 진단 결과를 폐기했습니다. 다시 진단하세요.';
      return;
    }
    if (target) target.textContent = '❌ Toss 진단 실패: ' + (error.message || '응답 오류') + '\nGAS 연결: ' + _tossConnectionSummary_(targetUrl, !!accessToken);
  }
}

async function clearTossConfigFromUI() {
  if (!GSHEET_API_URL) return;
  if (!window.confirm('Toss Client ID/Secret, 진단 상태와 token cache만 삭제합니다. 다른 API 설정과 Portfolio 데이터는 변경하지 않습니다. 계속하시겠습니까?')) return;
  try {
    const data = await requestGsheetFormJson('clearTossConfig', {}, { timeoutMs: 15000, retry: 0 });
    if (!data || data.status !== 'ok') throw new Error(data?.message || '응답 오류');
    _renderTossConfigStatus(data.toss);
    if (typeof showToast === 'function') showToast('✅ Toss 설정과 token cache만 삭제했습니다.', 'success');
  } catch (error) {
    if ($el('tossConfigStatus')) $el('tossConfigStatus').textContent = '❌ Toss 설정 삭제 실패: ' + (error.message || '응답 오류');
  }
}

async function lookupNameByCode(code) {
  if (!code) return '';
  const trimCode = _normalizeSyncCode(code);
  // 1. EDITABLE_PRICES 역방향 검색 (최우선)
  const epItem = getEPByCode(trimCode);
  if (epItem) return epItem.name;
  // 2. 로컬 STOCK_CODE 역방향 검색
  const localEntry = Object.entries(STOCK_CODE).find(([n,c]) => _normalizeSyncCode(c) === trimCode);
  if (localEntry) return localEntry[0];
  // 3. GSheet 캐시 검색
  const gItem = _gsheetCodeList.find(item => item.code === trimCode);
  if (gItem) return gItem.name;
  // 4. GSheet API 조회 (공공데이터 KRX상장종목정보 우선, GOOGLEFINANCE fallback)
  if (!GSHEET_API_URL) return '';
  try {
    const params = { code: trimCode };
    if (typeof getPublicDataApiKey === 'function') {
      const key = getPublicDataApiKey();
      if (key) params.serviceKey = key;
    }
    const data = await requestGsheetActionJson('name', params, { timeoutMs: 8000, retry: 1 });
    if (!data || data.status === 'error') return '';
    return data.name || data.officialName || '';
  } catch(e) { return ''; }
}

function getKrxAuthKey() {
  return '';
}

async function saveKrxAuthKeyFromUI() {
  const input = $el('krxAuthKeyInput');
  const key = String(input?.value || '').trim();
  const status = $el('krxAuthKeyStatus');
  const setStatus = (msg, ok) => {
    if (!status) return;
    status.style.color = ok ? 'var(--green-lt)' : 'var(--amber)';
    status.textContent = msg;
  };

  if (GSHEET_API_URL && typeof requestGsheetFormJson === 'function') {
    setStatus('KRX AUTH_KEY를 GAS에 저장 중...', true);
    const data = await requestGsheetFormJson(
      'saveKrxAuthKey',
      { key: key || '-' },
      { timeoutMs: 10000, retry: 1 }
    );
    if (data && data.status === 'ok') {
      if (input) input.value = '';
      if (typeof lsRemove === 'function') lsRemove('krx_auth_key');
      showToast(key ? 'KRX AUTH_KEY 저장 완료 (GAS 동기화)' : 'KRX AUTH_KEY 삭제 완료 (GAS 동기화)', key ? 'ok' : 'warn');
      setStatus(key ? 'KRX 우선 가격 조회에 사용할 수 있습니다. 다른 브라우저에서도 설정 복원됩니다.' : 'KRX AUTH_KEY가 비어 있습니다.', !!key);
      return;
    }
    showToast('KRX AUTH_KEY를 저장하지 못했습니다. 브라우저에는 키를 보관하지 않습니다', 'warn', 5000);
    setStatus('GAS 저장 실패 · 키 원문은 브라우저에 저장하지 않았습니다.', false);
    return;
  }

  showToast('GAS 연결 후 서버 측에 저장할 수 있습니다', 'warn');
  setStatus('보안을 위해 API 키를 브라우저에 저장하지 않습니다.', false);
}
