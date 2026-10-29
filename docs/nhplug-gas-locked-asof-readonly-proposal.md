# NH PLUG: 날짜별 국내 보유코드 단일 잠금 read-only API 제안 (미배포)

## 범위

- `scripts/nhplug-gas-locked-asof-readonly-proposal.gs`는 **GAS 배포 소스가 아닌 독립 제안 코드**입니다. 운영 `src/gas/apps_script.gs`, `doGet`, `doPost`, 스프레드시트 및 예약에는 연결하지 않았습니다.
- 기존 GAS v9.275의 `getCodeItems`, `_calcCodeHoldingsAtDate`, `LockService.getScriptLock`을 그대로 사용합니다.
- 출처는 실제 `거래이력`과 코드마스터 하나의 `getss()`에서 읽고, 협력하는 GAS 작성자와 동일한 ScriptLock 안에서 각 소스를 **2회 읽어** 양측 일치를 검증합니다.
- 사용자가 등록한 GAS 인증 토큰 자체가 비어 있다면, 기존 호환 모드의 익명 읽기를 **새 엔드포인트에서는 차단**합니다. 미인증 입력, 휴장/미확인일, 미래 날짜, 잠금 실패, 원장/마스터 손상 또는 readback 불일치 시 자료를 반환하지 않습니다.
- 결과는 인증이 성립한 호출자에게 **코드·보유수량·주식/ETF 종류·시장·통화**의 최소치만 반환합니다. 거래별 계좌번호·원가·종목명·거래내역을 포함하지 않으며 외부 콘솔 로그/테스트 로그에도 노출하지 않습니다.
- 실제 GAS v9.275의 리듀서와 제안 함수를 함께 실행하는 합성 테스트를 포함합니다. 코드마스터/원장 변형, 코드 누락, 인증 비설정, 잠금 충돌·해제 오류, 거래정지 상태 불명, 비정상 거래 및 날짜를 차단합니다.

## 완전한 '원자성'으로 분류할 수 없는 이유

1. **ScriptLock은 같은 스크립트에서 잠금을 사용하는 작성자만 제어**합니다. 브라우저나 외부 Sheets API의 직접 업데이트는 막지 못합니다.
2. 두 번의 readback이 동일해도 두 읽기 사이에 변경 후 원복된 ABA 경쟁까지 배제하지 못합니다.
3. 기존 종목마스터에는 상장·거래정지 상태와 과거 적용 날짜가 없으므로 `listingState=UNKNOWN`, `listingStateAsOf=null`을 유지합니다.
4. 거래원장은 날짜만 있고 장중 체결시각이 없으므로, 현재 날짜의 16:00 시점과 그 이후 수정된 원장을 구분하는 완전한 시점 증거가 아닙니다.
5. 따라서 `verified:false`, `sourceConsistency:GAS_SCRIPT_LOCK_DOUBLE_READ_MATCH_NOT_ATOMIC`으로 고정하며 #704의 `readyForProvisionalMessage`를 true로 승격하지 않습니다.

## 실배포 이전에 필요한 승인·검증

- 새로운 GAS read-only action의 `doGet/doPost` 인증 경로와 GAS 버전 계약을 **별도 변경 PR**에서 검토
- 기존 v9.275 대형 GAS 소스의 전체 변경·관련 gasVersion/웹 EXPECTED_GAS_VERSION·배포 승인 blob SHA를 모두 검토
- 동일 ScriptLock을 사용하지 않는 현행 작성자·외부 Sheets API 경로 목록을 분석하고 운영 시점의 변경 감지 보완
- 종목의 상장·거래정지 상태 및 유효월물·당일 시세를 신뢰 가능한 외부 원천에서 검증
- 독립 Codex 리뷰, 전체 CI, 사용자 승인 후에만 병합·배포
- 지금은 실제 NH/GAS 인증 조회, 원장/스냅샷 변경, GAS 배포, 텔레그램 전송 및 TFL 제거 **모두 미실행**

## 2026-10-29 운영 GAS v9.275 작성·조회 경합 점검

| 운영 경로 | 읽기/쓰기 | 잠금 | 영향·조치 |
|---|---|---|---|
| `handlePortfolioSyncWithReceipt` | 거래·보유 동기화 오케스트레이션 | `waitLock(30000)` | 이미 잡은 ScriptLock을 `handleSyncTrades`/Holdings에 전달 |
| `handleSyncTrades` | 거래원장 전면 교체 후 Snapshot 재계산 | `waitLock(30000)` 또는 인수한 잠금 | 쓰기 전에 `TRADE_LEDGER_WRITE_JOURNAL_KEY` 설정, 확인 후 제거. 하드 타임아웃 이후 잠금은 풀려도 저널이 남을 수 있음 |
| `handleSyncHoldings` | 보유현황 전면 교체 | 동일 ScriptLock 사용 | 날짜별 보유집계의 기준은 보유시트가 아니라 거래원장 리듀서 |
| `handleSyncCodes`, AppendOnly, Delete | 종목마스터 수정 | 동일 ScriptLock 사용 | 코드 삭제 미완료 `CODE_DELETE_TXN_KEY_`가 남을 수 있음 |
| `handleSaveSettings` | Settings·기초정보 저장 | 동일 ScriptLock 사용 | 종목코드 정합성/Settings 불일치 검사 필요 |
| `handleGetTrades` | 전체 거래원장 반환 | 없음 | 기존 #705의 개별 호출은 쓰기와 겹칠 수 있어 원자적이라는 주장 불가 |
| `handleGetCodeListReadOnly` | 종목마스터 반환 | `tryLock(1000)` | 코드 삭제 미완료를 체크하나 **별도의 거래원장 쓰기 저널 검증은 없음** |
| `runPendingTradeSnapshotRebuild` | 재계산·원천 변경 탐지 | ScriptLock 사용 | `_tradeLedgerWriteUnverified_` 시 재계산 차단. 이 상태를 조회 API도 반드시 참고 |
| 시트 UI 수동 편집 / 외부 Sheets API | 원장·마스터 직접 수정 가능 | **ScriptLock 보장 안 됨** | 두 번 읽어서 같은지 확인해도 ABA·읽은 직후 변경 가능성 남음 |

### 발견한 차단 누락과 보완

PR #706의 최초 제안은 ScriptLock 및 원본 이중 재조회만 시행했기 때문에,
`syncTrades` 쓰기 중단 뒤 남는 **원장 미검증 저널** 또는 **종목코드 삭제 대기표시**를
무시할 수 있었습니다. 이 경우 동일한 불완전 원본을 두 번 읽고 성공으로 반환할 위험이 있습니다.

이번 수정은 **잠금 획득 직후와 이중 읽기 완료 직후** 다음 두 표식을 조회하고
존재 시 금융 데이터 자체를 반환하지 않습니다.

- `_tradeLedgerWriteUnverified_()` → `NH_HELD_LEDGER_WRITE_UNVERIFIED`
- `CODE_DELETE_TXN_KEY_` 존재 → `NH_HELD_CODE_DELETE_PENDING`

운영 GAS의 실제 읽기 함수와 잠금 사용 상태를 확인해 동일한 이름으로 테스트하며,
마커가 첫 번째·두 번째 확인 시점에 존재하는 모든 경우를 합성 검증합니다.
새 API는 읽기 전용 제안으로 유지하고 실제 운영 GAS/원장은 변경하지 않습니다.

**잔여 한계:** GAS 상태의 표식은 외부 Sheets API 수정이나 직접 시트 편집으로
자동 설정되지 않을 수 있으며, source fingerprint 비교가 통과해도 외부 편집이 없었다는
완전한 보증은 아닙니다. 조회 결과는 계속 `verified:false`입니다.
