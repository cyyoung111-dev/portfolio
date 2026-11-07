# 거래원장 v2 저장·복구 책임 경계 (미배포 운영 검토)

> 범위: PR #1012 / Issue #734, #860. 기준: 2026-11-07 KST. **현재 GAS v9.284/341 운영 원장과 Snapshot·Telegram에 변경 없음.**

## 1. 단일 권위와 로컬 역할

| 대상 | 유일한 권위 | 보존 항목 | 허용하지 않는 일 |
| --- | --- | --- | --- |
| GAS 거래원장 14열 | 서버 거래 데이터 | ID N, 기존 A:K, FX L/M | 무ID 구형 전체 덮어쓰기 |
| GAS 원장 CAS/영수증 | 서버 응답 및 ScriptProperties 기록 | operationId, requestHash, 기존/목표 revision, Snapshot 검증 증거 | receipt 상태 추측, 중복 실행 |
| 웹 dirty journal | **미전송 로컬 의도** | 원래 서버 baseline, 임시 편집·명시적 삭제 ID, 복구 필요 표시 | 서버 원장의 새로운 권위 선언 |
| 웹 pinned baseline | GET/Bootstrap **전체 행** 대사 후 갱신 | 동일 target/generation, 원장 revision, canonical 행 | 다른 기기 최신 데이터를 임의 rebase·덮어쓰기 |

Web/Google Sheets의 금액·거래 ID·FX L/M 대사는 성공했더라도 **GAS 실배포, 운영 활성 Sheet 바인딩, 실운영 Snapshot 재구축**을 대신하지 않는다.

## 2. 저장 상태 기계와 우선순위

| 이전 operation 상태 | 조치 | 후속 보유/거래 쓰기 |
| --- | --- | --- |
| 영수증 없음 | 검증된 서버 baseline만 사용해 새 계약 구성 | 정상 진행 |
| attempted + 서버 `NOT_FOUND` | 같은 operationId, 같은 이전 CAS·payload를 **1회** 재개하고 영수증 다시 조회 | 과거 원장 완료 후 진행 |
| `BUSY`, `PARTIAL`, `UNKNOWN`, `FAILED` 또는 연결 바뀜 | 원래 기록 보존, 새 쓰기 차단 | 금지 |
| `COMPLETE` but GET 미확정 | `getTrades` 전체 canonical·revision/hash 대사, 필요한 경우 dirty ACK 영속화 | 검증 성공 시에만 진행 |
| GET + journal ACK 영속 완료, terminal marker만 실패 | 기존 journal의 동일 target/revision/전체 행 hash/삭제 소비 증명으로 **과거 영수증만** terminal 처리 | 최신 다른 기기 원장은 변경 금지 |
| terminal readbackConfirmed | 복구 대상에서 제외 | 현재 서버 baseline 증거 있을 때만 진행 |

저장 순서는 **기존 v2 영수증 선행검사 → 보유현황 → 거래 → 펀드 Settings**. 같은 target의 기존 직렬 큐와 GAS ScriptLock을 사용한다. 서로 다른 writer 큐를 중복 설치하지 않는다.

### 13열 구형 FX 후보 격리

- `scripts/compose-gas9285-trade-fx-preview.mjs`의 standalone 13열 후보는 계좌 이동 시 FX L/M 유실 P2가 **실제로 남아 있다**. 이 빌드는 `SOURCE_PREVIEW_NOT_DEPLOYABLE`·`productionDeploymentApproved:false`로 제한한다.
- 14열 최종 후보(`compose-gas9285-trade-v2-preview.mjs`)는 구형 그룹·multiset 휴리스틱을 제거한 뒤, N열 불변 ID, 이전 행 hash, 명시적 수정/삭제, 서버 CAS 및 금융 원장 검증으로 대체한다. 합성 시 구 휴리스틱 또는 ID/CAS 불변식이 사라지면 **예외로 실패**한다.
- 구형 FX 후보의 문제를 그룹 비교 조건문으로 반복 보정하지 않으며, **단독 배포 불가**를 그대로 유지한다.

## 3. 검증과 릴리스 구분

- 실제 함수 테스트: `check-web-trade-v2-cross-action-recovery.mjs`, `check-web-trade-v2-terminal-recovery.mjs`, `check-web-trade-v2-ack-chain.mjs`, `check-gas9285-trade-v2-preview.mjs`.
- 338행 실제 Google Sheets 데이터는 별도 **검증용 사본**의 A:K·ID·14열 구조만 대사. 운영 GAS가 어느 Sheet ID에 바인딩되었는지는 아직 **미확정**.
- 운영 전환에 필요한 근거: (1) 활성 `getss()`/Script Properties `SS_ID` 실제 소스 확인, (2) 운영 writer·GAS 배포 인벤토리, (3) 별도 이관의 A:K 보존 및 L/M 무추정·N ID 영구성, (4) 39종 원가·Snapshot·배당·PC/Android 재접속, (5) 최신 미해결 실제 P0/P1/P2 0건, (6) 명시적 배포 승인.
- **PR은 Draft·미병합**. 코덱스 리뷰는 검증된 결함만 수용하고, 불필요한 방어 로직·반복 지적은 근거로 반박/보류한다.