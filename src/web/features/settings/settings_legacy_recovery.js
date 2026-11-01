// Read-only mobile legacy-journal reconciliation. Never overwrite a GAS ledger.
let _legacyReviewProof = null;
let _legacyReviewStatus = '';

function _pendingLegacyJournal() {
  const dirty = typeof _getPortfolioRemoteDirty === 'function' ? _getPortfolioRemoteDirty() : null;
  return dirty && (dirty.receiptProtocol !== 1 || dirty.legacyUntracked === true) ? dirty : null;
}
function _legacyStatus(text) {
  _legacyReviewStatus = String(text || '');
  const el = typeof $el === 'function' ? $el('legacyJournalStatus') : null;
  if (el) el.textContent = _legacyReviewStatus;
}
function _legacyTradeTuple(t) {
  if (!t || typeof t !== 'object') return null;
  const allowed = new Set(['id','date','tradeType','acct','name','code','qty','price','assetType','type','memo']);
  if (Object.keys(t).some(k => !allowed.has(k))) return null;
  const s = k => String(t[k] || '').trim();
  const qty=Number(t.qty), price=Number(t.price);
  if (!s('date') || !s('tradeType') || !s('name') || !Number.isFinite(qty) || !Number.isFinite(price)) return null;
  return [s('date'),s('tradeType'),s('acct'),s('name'),s('code'),qty,price,s('assetType')||s('type')||'주식',s('memo')];
}
function _legacyHoldingTuple(h) {
  if (!h || typeof h!=='object') return null;
  const allowed = new Set(['code','name','qty','costAmt','assetType','acct']);
  if (Object.keys(h).some(k=>!allowed.has(k))) return null;
  const qty=Number(h.qty),costAmt=Number(h.costAmt);
  if (!h.name || !(qty>0) || !Number.isFinite(costAmt)) return null;
  return [String(h.code||''),String(h.name||''),qty,costAmt,
    String(h.assetType||''),String(h.acct||'')];
}
function _legacyExactLedgerMatch(dirty,server) {
  if (!dirty || !server || server.status!=='ok' || !server.settings
      || !Array.isArray(server.codes) || !String(server.codeMasterSourceId||'')
      || server.portfolioReadStatus?.tradesOk!==true
      || server.portfolioReadStatus?.holdingsOk!==true
      || !Array.isArray(server.trades) || !Array.isArray(server.holdings)) return false;
  if (_getPendingExplicitEmptyTradeSync(dirty.target)) return false;
  const a=(dirty.trades||[]).map(_legacyTradeTuple);
  const b=server.trades.map(_legacyTradeTuple);
  if (!a.length || a.some(x=>!x) || b.some(x=>!x) || JSON.stringify(a)!==JSON.stringify(b)) return false;
  // GAS groups holdings by stock name. Auto-reconciliation is only permitted
  // for a lossless one-row-per-name local ledger; other cases remain blocked.
  const expected=[],seen=new Set();
  for (const h of dirty.holdings||[]) {
    if (!h?.name || !(Number(h.qty)>0) || !Number.isFinite(Number(h.cost))
        || seen.has(h.name)) return false;
    seen.add(h.name);
    expected.push({code:h.code||'',name:h.name,qty:Number(h.qty),
      costAmt:Number(h.qty)*Number(h.cost),assetType:h.assetType||h.type||'주식',acct:h.acct||''});
  }
  const funds=dirty.fundDirect||{};
  for (const [name,fd] of Object.entries(funds)) {
    if (!fd || !Number.isFinite(Number(fd.cost))) return false;
    if (Number(fd.cost)<=0) continue;
    if (seen.has(name)) return false;
    expected.push({code:'',name,qty:1,costAmt:Number(fd.cost),assetType:fd.type||'TDF',acct:''});
    seen.add(name);
  }
  if (expected.length!==server.holdings.length) return false;
  const sorted=rows=>rows.map(_legacyHoldingTuple).sort((x,y)=>
    JSON.stringify(x).localeCompare(JSON.stringify(y)));
  const lh=sorted(expected),rh=sorted(server.holdings);
  if (lh.some(x=>!x)||rh.some(x=>!x)||JSON.stringify(lh)!==JSON.stringify(rh)) return false;
  const canon=obj=>JSON.stringify(Object.fromEntries(Object.entries(obj||{}).sort(([a],[b])=>a.localeCompare(b))));
  return canon(funds)===canon(server.settings.fundDirect||{});
}
function exportLegacyJournalBackup() {
  const dirty=_pendingLegacyJournal();
  if (!dirty) { _legacyStatus('현재 연결에 미확인 기록이 없습니다.');return false; }
  try {
    const blob=new Blob([JSON.stringify({format:'legacy-journal-backup-v1',
      exportedAt:new Date().toISOString(),journal:dirty},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='portfolio-mobile-unconfirmed.json';a.click();URL.revokeObjectURL(url);
    _legacyStatus('백업 다운로드를 요청했습니다. 다운로드된 파일을 직접 확인하세요.');
    return true;
  } catch(_) { _legacyStatus('백업 다운로드 실패. 모바일 기록은 유지했습니다.');return false; }
}
async function diagnoseLegacyJournal() {
  const dirty=_pendingLegacyJournal(),target=String(GSHEET_API_URL||'').trim();
  const generation=getGsheetConnectionGeneration();_legacyReviewProof=null;
  if (!dirty || dirty.target!==target) { _legacyStatus('현재 연결의 미확인 기록 없음');return false; }
  _legacyStatus('서버 거래·보유를 읽기 전용으로 확인하는 중...');
  let response=null;
  try { response=await requestGsheetActionJson('getBootstrap',{},{
    targetUrl:target,timeoutMs:15000,retry:0,preserveError:true}); } catch(_){}
  if (!isGsheetConnectionCurrent(target,generation) || _pendingLegacyJournal()?.epoch!==dirty.epoch) {
    _legacyStatus('연결 또는 기록이 변경됐습니다. 다시 진단하세요.');return false;
  }
  const local='로컬 거래 '+dirty.trades.length+'건, 보유 '+dirty.holdings.length+'건';
  const remote=Array.isArray(response?.trades)&&Array.isArray(response?.holdings)
    ? '서버 거래 '+response.trades.length+'건, 보유 '+response.holdings.length+'건' : '서버 원장 확인 불가';
  if (!_legacyExactLedgerMatch(dirty,response)) {
    _legacyStatus(local+' / '+remote+' · 완전 일치 미확인: 자동 재전송·보류 해제 금지. 백업 후 원장 대조 필요.');
    return false;
  }
  _legacyReviewProof={target,generation,epoch:dirty.epoch,
    signature:_portfolioDirtySignature(dirty),sourceId:response.codeMasterSourceId};
  _legacyStatus(local+' / '+remote+' · 원장 전 항목 일치. 백업 후 명시적 확인으로만 보류 기록 해제 가능.');
  return true;
}
async function archiveMatchedLegacyJournal() {
  const proof=_legacyReviewProof,dirty=_pendingLegacyJournal();
  if (!proof||!dirty||dirty.target!==proof.target||dirty.epoch!==proof.epoch
    || _portfolioDirtySignature(dirty)!==proof.signature
    || !isGsheetConnectionCurrent(proof.target,proof.generation)
    || _saveHoldingsGasTimer || _portfolioRemoteSyncQueuesByTarget.has(proof.target)
    || _getPendingExplicitEmptyTradeSync(proof.target)) {
    _legacyStatus('로컬 데이터가 변경되어 보류 해제를 차단했습니다.');return false;
  }
  if (!confirm('서버와 모바일 금융 원장이 완전 일치합니다. 보류 기록을 별도로 보관하고 해제할까요? 서버에는 아무것도 저장하지 않습니다.')) return false;
  let response=null;
  try { response=await requestGsheetActionJson('getBootstrap',{},{
    targetUrl:proof.target,timeoutMs:15000,retry:0,preserveError:true}); } catch(_){}
  if (!isGsheetConnectionCurrent(proof.target,proof.generation)
      || _pendingLegacyJournal()?.epoch!==proof.epoch
      || _portfolioDirtySignature(_pendingLegacyJournal())!==proof.signature
      || String(response?.codeMasterSourceId||'')!==proof.sourceId
      || !_legacyExactLedgerMatch(dirty,response)
      || _saveHoldingsGasTimer || _portfolioRemoteSyncQueuesByTarget.has(proof.target)) {
    _legacyReviewProof=null;_legacyStatus('재검증 결과가 달라졌습니다. 원본 기록 유지.');return false;
  }
  try {
    const key='portfolio_verified_legacy_journal_archive_v1';
    const previous=lsGet(key,{});
    const archive={...(previous&&typeof previous==='object'&&!Array.isArray(previous)?previous:{}),
      [proof.target]:{journal:JSON.parse(JSON.stringify(dirty)),
        sourceId:proof.sourceId,verifiedAt:new Date().toISOString()}};
    lsSave(key,archive);
    const stored=lsGet(key,{})?.[proof.target];
    if (!stored || stored.sourceId!==proof.sourceId
        || _portfolioDirtySignature(stored.journal)!==proof.signature) throw Error('BACKUP_UNVERIFIED');
    if (!_clearPortfolioRemoteDirty(proof.epoch,proof.target)) throw Error('JOURNAL_CHANGED');
    _gsBootRestored=false;_gsPortfolioRestoreRequired=true;_legacyReviewProof=null;
    _legacyStatus('미확인 기록을 별도 보관했습니다. 상단 업데이트로 서버 원장을 다시 복원하세요.');
    return true;
  } catch(_) { _legacyStatus('로컬 보관 실패: 원본 기록을 유지했습니다.');return false; }
}
