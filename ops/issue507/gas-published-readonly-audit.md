# 운영 GAS 게시 버전·writer gate 읽기 전용 증빙

상태: **실행 전, 배포 승인 아님**. GAS v9.283 릴리스 준비 PR #837 및 #851~#858와 별도입니다.

## 안전한 검증 경로

- `gas-published-gate-readonly-audit.yml`은 `workflow_dispatch`만 수용합니다. schedule/push/workflow_run과 GAS 배포 단계가 없습니다.
- GitHub Environment `portfolio-production-gas`의 기존 `GAS_SCRIPT_ID`, `GAS_WEB_APP_URL`, `GAS_DEPLOYMENT_ID`, `GAS_SERVER_FILE_NAME`, `CLASPRC_JSON`, `GAS_ACCESS_TOKEN`만 사용합니다. 신규 KRX/NH 키 또는 금융 데이터 접근 권한을 만들지 않습니다.
- Google OAuth는 Apps Script REST 메타데이터 조회용입니다. Google Apps Script API에 프로젝트 배포 조회(읽기), 게시된 정확한 버전의 전체 소스 조회(읽기), 현재 HEAD 소스 조회(읽기)만 실행합니다. JSON 본문, 소스, 키, URL은 로그에 출력하지 않습니다.
- **게시된 서버 코드가 승인된 정확한 v9.282 전체 소스 SHA `9c1a5f31d1abc4b44f7da9af7a50fe3f15967134`이고, 배포 프로젝트가 검토된 단일 서버 파일+manifest 구조일 때만** 실제 `getWriterGateStatus` GET을 호출합니다. 해당 액션은 코드상 `_issue507GateStatusRequest_`로 바로 분기되어 인증·ScriptLock 아래 Script Properties 읽기만 합니다.
- 게시 코드가 v9.281, 검토 전 v9.283, 변조 또는 예기치 않은 추가 실행 파일을 포함하는 경우 **런타임 GET을 보내지 않습니다.** 당시 공개된 `getWriterGateStatus` 계약이 없다면 일반 GAS fallback이 실행될 위험을 제거합니다.
- 출력은 게시 버전/전체 소스 SHA/HEAD 드리프트/writer gate의 열림·초기화·드레인 상태, 진행 중 count, 승인 존재 여부와 차단 사유만 포함합니다. 금융 원장, 토큰, Script URL, 원문 payload 없음.

## 상태 해석

| 상태 | 의미 | 운영 승인 |
| --- | --- | --- |
| `LIVE_V9282_GATE_OPEN_CONFIRMED` | 승인 전체 소스 + 실제 OPEN + 승인 미설정 확인 | **아니요**. 단지 기초 증빙 |
| `BLOCKED` | 미검토 버전·소스 불일치·DRAINING·승인 존재 | 불가 |
| `UNVERIFIED` | 인증 누락·API 오류·런타임 메타데이터 불일치 | 불가 |

이 workflow는 성공해도 v9.283 배포 또는 06:45 NH·17:00 KRX 실조회가 완료된 것을 뜻하지 않습니다. 운영 버전 확인 후에도 writer gate/구버전 실행 종료/배포 롤백 안전성, 웹·스크립트 버전 소비자, 정확한 승인 해시 및 사용자 별도 수동 배포 승인이 필요합니다.

## 실행 순서

1. 이 검증 PR 자체의 Quality/GAS CI 및 Codex 리뷰를 완료합니다.
2. 별도 사용자 승인 뒤 안전성 PR 체인을 검토·병합하고, `main`에 있는 이 workflow를 GitHub Actions에서 **수동 실행**합니다.
3. 반환된 안정적인 요약 필드로 운영 상태를 판단합니다. 소스 정보만 확인되거나 결괏값이 `BLOCKED/UNVERIFIED`면 다음 단계 배포를 중단합니다.

**이 PR은 읽기 전용 실행 경로를 준비할 뿐 현재 운영 GAS를 조회·변경하거나 텔레그램을 발송하지 않습니다.**
