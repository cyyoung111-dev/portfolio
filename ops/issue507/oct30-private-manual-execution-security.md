# Issue #507 — 관리자 내부 종가검증의 fail-closed 인증 경계

## 운영 소스에서 확인한 취약한 호환 조건
생산 GAS blob `9c1a5f31d1abc4b44f7da9af7a50fe3f15967134`의 실제 `_isAuthorizedRequest(params)`는 Script Properties의 `access_token`이 비어 있으면 **인증을 통과 처리**합니다. 기존 서비스 호환용 동작이며, 이 사실만으로 현재 서비스 설정에 토큰이 실제로 누락되었다고 주장해서는 안 됩니다. 그러나 신규 비공개 증빙 endpoint가 이 함수만 신뢰하면 **무토큰 설정 시 인증되지 않은 호출이 허용될 위험**이 있습니다.

따라서 신규 `_issue507Oct30PrivateLiveReadOnlyProof_` 및 관리용 `_issue507Oct30GuardedPrivateReadOnlyRun_`은 **doGet/doPost 및 public 웹 API에 추가하지 않습니다.** 승인된 운영 보안 담당자가 Apps Script 프로젝트 내부의 별도 인증된 환경에서만 호출할 수 있는 *소스 전용 후보*로 유지합니다.

## 신규 엄격 인증 후보
`scripts/issue507-oct30-private-manual-execution-guard-proposal.mjs`는 실제 GAS에 아직 미삽입인 `String.raw` 함수를 정의합니다.

- 실행의 **전제**: Script Properties에서 기존 `access_token`이 비어 있지 않아야 하고, 별도의 `issue507_oct30_private_probe_enabled=true`, `issue507_oct30_private_probe_secret` (32~256자), `issue507_oct30_private_probe_expires_at_ms` (13자리 정수 유효기간 10분 이내)가 모두 유효해야 합니다.
- 호출 인수는 `purpose=ISSUE507_OCT30_PRIVATE_SOURCE_ONLY`, `targetDate=2026-10-30`, `proofKey` 세 필드만 허용합니다. `apply`, `code`, 기간·다른 날짜·임의 action 값은 거부합니다.
- 설정된 추가 secret과 전달된 `proofKey` 길이 및 바이트를 비교하며 일치하지 않으면 보호된 공식 KRX 조회에 진입하기 전에 동일한 오류코드로 종료합니다.
- 하위 비공개 함수의 정확일 37/37 건수만 승인 대상으로 확인하고, 새 요약에서 코드·가격·수량·계좌·실제 quote 응답·인증키를 모두 제외합니다. `financialWrites=0`, `writeAuthorized=false`, `releaseAuthorized=false` 고정.
- 만료값 및 `enabled`는 관리자가 **별도 명시적 운영 승인 후에만** 설정해야 합니다. 이 PR에서는 설정/토큰 생성/보안 변수 읽기·변경/런타임 호출이 **0건**입니다.
- 만료된 secret은 재사용하면 안 되며, 이 후보는 Secret을 자동 삭제/소모하지 않으므로 **재사용 가능한 만료시간 제한 키**입니다. ‘1회성 키’, 완전한 상호배타 lock, 운영 사용자 신원 증명으로 과장 금지.
- 실제 스크립트 편집자/Execution API/인증 관리자 권한, 555 writer gate, 운영 배포 통제, GAS timeout 및 외부 Sheets API writer 배제는 **별도** 심사 항목입니다. 이 전용 키 검증을 추가한다고 그 항목이 자동으로 충족되지는 않습니다.

## 소스/CI 검증
`scripts/check-issue507-oct30-private-manual-execution-guard.mjs`는 **실제 생산** `_isAuthorizedRequest`를 VM에서 실행해 빈 token 속성의 호환 허용을 재현합니다. 그런 다음 신규 private 함수를 모의 실행하며 만료·범위·무토큰·잘못된 암호·금융 쓰기 플래그·민감 정보의 응답 누출을 차단하는지 검증합니다. 외부 GAS/Sheets/KRX/토큰 요청은 하지 않고 합성 증빙만 사용합니다.

## 릴리스 승인 경계
[PR #801](https://github.com/cyyoung111-dev/portfolio/pull/801) 안의 새 함수들은 `src/gas/apps_script.gs`에 없는 **문자열 소스 후보**입니다. 이 PR 병합은 GAS 운영 배포·실제 종목별 KRX 조회·금융 원본 쓰기를 허용하지 않습니다. 별도 사용자 승인과 운영 보안 심사 후 소스 통합·배포 테스트를 계획할 수 있습니다.
