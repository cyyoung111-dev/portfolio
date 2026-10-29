# NH PLUG PR #699–#706 병합 전 통합 점검 (2026-10-29)

**범위:** GitHub PR 메타데이터·변경파일·각 HEAD의 Actions 상태·package.json 증분 비교. 운영 배포·NH 인증 및 시세 API 호출·GAS 데이터 변경·Codex 리뷰 요청은 하지 않음.

## 병합 대상·의존성

| PR | HEAD (짧은 SHA) | Base | 주요 책임 | 필수 선행 | 최신 Quality/Web/GAS |
|---|---|---|---|---|---|
| #699 | `5cc01e2` | main | 공개 야간선물 마스터·입력 명세 | #698은 이미 main에 반영 | 모두 성공 |
| #700 | `e698879` | `feat/nhplug-night-input-schema-evidence` (#699) | 야간선물 읽기 전용 사전진단 | #699 통합 및 별도 리뷰, 실조회는 선택 실행 | 모두 성공 |
| #701 | `009b2bc` | main | 16:00 KRX 종가 메시지 계약 | NH 종가 및 기준일 검증의 실연결은 별도 | 모두 성공 |
| #702 | `6ddfc6f` | main | 야간선물 GAS 저장·조회 안전 계약 | #700 실제 응답 검증 전 운영 연결 금지 | 모두 성공 |
| #703 | `d7774f9` | main | 07:30/16:00 예약·중복 전송 모의 검증 | 실제 GAS 선점 및 Telegram 수신 검증 별도 | 모두 성공 |
| #704 | `4cc4817` | main | 보유 주식·ETF 종가 커버리지·이력·기업행위 감사 | #705/#706의 미검증 후보는 여전히 차단 | 모두 성공 |
| #705 | `2fd018b` | main | 기존 GAS getTrades/getCodeListReadOnly 비원자적 브리지 | 인증 및 출처·이력 신뢰성 미확보 | 모두 성공 |
| #706 | `28c7955` | main | 신규 잠금·이중읽기 GAS 단일 API 제안 | 실제 GAS 라우터/배포/버전 승인 필요 | 모두 성공 |

*모든 PR의 현재 표시 상태는 mergeable=true. #699만 Ready, 나머지는 Draft. 병합 가능한 상태라는 뜻이지 리뷰 승인·실운영 검증 완료를 의미하지는 않음.*

## 겹치는 변경과 병합 충돌 예방

- **공통 변경 경로는 `package.json` 하나**: 8개 PR이 기존 `check:ci` 뒤에 각자 검사를 추가. 이후 먼저 병합된 항목을 후속 PR의 옛 `check:ci` 문자열로 되돌리면 통과 테스트가 사라짐.
- 다른 변경 경로는 PR 간 고유함. #699는 `.github/workflows/nhplug-night-public-schema.yml` 신규 추가, #700은 기존 `nhplug-readonly-diagnostic.yml` 수정.
- #700은 base 자체가 #699 브랜치이므로 #699의 파일·스크립트가 **상속된 내용**. #699가 병합되기 전에 #700을 main으로 재기준화하거나 상속된 코드를 두 번 추가하지 말 것.
- main의 `package.json`을 기준으로 PR별 스크립트 비교 결과, 서로 다른 이름의 신규 명령 **13개**이며 동일 이름의 상충된 정의 없음. #700 안의 #699 명령은 중복 집계하지 않음.
- 일괄 병합 승인 전 #704의 43개 커밋과 12개 새 스크립트(별도 문서 포함)에 대한 독립 검토를 우선. 서로 다른 source claim의 `verified:true`를 자동 승격시키지 말 것.

### 안전한 후속 순서 (미실행)

1. Codex 사용량 회복 이후 #699의 **최신 HEAD에 대한 실질 리뷰 결과** 확인. GitHub inline review thread 0개는 승인 증명이 아님. 봇의 사용량 초과 메시지는 통과/승인이 아님.
2. #699 리뷰·CI 확인 및 별도 승인 후 병합. #700의 base는 이후 main으로 조정하고, diff에 #699 변경이 다시 나타나지 않는지 재확인 후 리뷰.
3. 서로 독립적인 #701, #702, #703, #705, #706 중 우선순위를 정해 **한 PR씩** 변경 적용. 매번 직전 main 기준 `package.json` 신규 스크립트를 보존하고 전체 `check:ci` 재실행.
4. #704는 나머지 계층의 실제 상태 및 결합 테스트를 확인한 뒤 적용. #704의 #705/#706 연계 테스트는 **출력형식 모의 fixture**이므로 동시 checkout에서 실제 소스를 import한 E2E 확인으로 대체해야 함.
5. 신규 GAS API는 #706 제안 파일 그대로 배포 가능한 코드가 아님. 별도 라우터·인증·기존 GAS 버전 pin/해시 정책 검토 후 승인. NH 실조회·가용량·공식 KRX 구간·Telegram 발송·GAS readback은 모두 별도 승인 단계.

### 병합 후 반드시 보존할 신규 CI 명령 (13개)

- `check:nhplug-public-future-master` (#699; #700에도 상속)
- `check:nhplug-night-readonly` (#700)
- `check:nhplug-close-briefing` (#701)
- `check:nhplug-night-gas-adapter` (#702)
- `check:nhplug-briefing-schedule` (#703)
- `check:nhplug-held-close-coverage`, `check:nhplug-held-source-gate`, `check:nhplug-listing-asof`, `check:nhplug-corporate-actions`, `check:nhplug-corporate-ledger`, `check:nhplug-corporate-evidence-links` (#704)
- `check:nhplug-gas-held-universe` (#705)
- `check:nhplug-gas-locked-asof` (#706)

모든 PR은 현재 base/main 기준 품질 검증을 통과했으나 **여러 PR을 하나의 main으로 합쳤을 때의 품질 검증은 아직 실행하지 않았음**. GitHub 상태의 `mergeable=true`는 상호 병합 간 `package.json` 충돌과 CI 명령 유실을 보장하지 않음.

## 의도적으로 하지 않은 일

NH API 토큰 신규 발급 및 시세 조회 0건, Codex 리뷰 요청 0건, PR 병합 0건, 운영 GAS·거래원장·Snapshot·Telegram·TFL 수정 0건. 리뷰·실연동이 끝나기 전까지 합성 테스트만으로 정상 무인 운영이라고 판단하지 않음.
