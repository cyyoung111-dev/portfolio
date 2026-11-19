# 9.300 통합 릴리스 및 펀드 운영 재설계

## 외부 운영 원칙
- Google Apps Script Best Practices (https://developers.google.com/apps-script/guides/support/best-practices), Quotas (https://developers.google.com/apps-script/guides/services/quotas): 서비스 호출 최소화, 배치 처리, 제한된 실행시간.
- GitHub Actions troubleshooting (https://docs.github.com/en/actions/how-tos/troubleshoot-workflows): 예약 실행 지연/누락 가능. 기존 독립 기동 유지, 신규 cron 및 무조건 재시도 금지.
- Apache Airflow (https://airflow.apache.org/docs/apache-airflow/3.1.7/best-practices.html): 특정 날짜 처리, 중복 방지. Google Cloud retry strategy (https://docs.cloud.google.com/storage/docs/retry-strategy): 읽기 재시도와 불확정 쓰기 ACK 구분.
- 금융 NAV 운영 사례 (https://intrinio.com/blog/mutual-fund-nav-api-historical-nav-data): 근시일 공식 NAV 재확인. 우리 펀드별 공표일/시간을 단정하지 않음.

## 운영 및 배포
1. 기존 두 수집기가 공식 NAV 취득, 클래스/일자 검증 및 날짜별 후속 대사를 담당한다. 일일 GAS CLOSE는 저장된 NAV로 평가한다. 32일 로컬 검사·carry 경고·수동 복구 유지. 최근 8일 이전 공식 NAV 누락의 별도 자동 수집은 미구현.
2. 시간 초과 시 저장 상태 확인 후 해당 날짜·단계만 복구. 불확정 쓰기의 무조건 재시도 금지. 기존 gate/backup 유지.
3. 9.297→9.300 단일 후보(984f8e6db408b8803827205682610b457f1e82ca). 별도 9.298/9.299 배포 없음. 9.299 미승인 차단 유지. 다른 출발 버전은 별도 검토.
4. 기존 protected inventory workflow main push에서 dry-run만 1회, 같은 inventory/원장 v2/idle gate 재사용. 실배포: gas-deploy, main, candidate_version=9.300, dry_run=false, approve_9300=true, 나머지 승인 false. 같은 실행 사전검증 및 9.300 원장 hash 후속 대사. NH 표본은 연간 집계 증거가 아님.
5. CI/승인/dry-run/실배포/실운영 대사를 구분. 실제 마감 및 원본 NAV·평가 일치 증빙 필요. 신규 예약 없음, 금융 원본 변경 없음.

## 11/19 10:12 KST 통합 사전검증 실패 원인
- Run 44434983652: inventory pass, strict state check 및 기존 9.297 원장 proof(physical/API/PC hash 및 행수/ID) 통과 이후 추가 `GAS9298_LEDGER_INTEGRITY_UNVERIFIED`. 실제 getTrades v2 소스의 14열 응답은 gasVersion이 없고 jsonOk도 이를 삽입하지 않는다. 실제 로그에는 실패 조건별 값이 없으므로 다른 추가 조건 실패 여부까지 단정하지 않는다.
- 원장/API/PC 해시, 행수, ID, pending/active 검증은 그대로. getTrades 버전 미제공 시 별도 인증된 versioned Writer Gate를 hash 대사 뒤 한 번 더 조회하여 정확한 expected version과 OPEN/idle/timeout retirement 0/recovery unauthorized를 확인한다. 명시 버전 불일치, hash 불일치, 누락 ID는 기존대로 차단. 후보 소스 pin/승인 불변; 기존 inventory one-shot 재사용. 실운영 dry-run으로 검증 필요.

## 11/19 11:25 KST 실제 배포 및 NH 표본 실패
- Run [44443624597](https://github.com/cyyoung111-dev/portfolio/actions/runs/44443624597): 9.300 (Apps Script 356) 웹앱 검증 성공, 원장 338건 physical/API/PC hash 일치, active/pending/deferred=0. 배포 단계 성공. 후속 NH 표본만 exit 2: 본인 운영계좌 1, 제외 3, 조회 성공 0/실패 1, stopped=NONE. 연간 0원 또는 배포 실패로 해석하지 않는다. 실제 거절 원인은 기존 코드가 HTTP_OTHER/INVALID_JSON/RESPONSE_UNVERIFIED를 반환하지 않아 미확정.
- NH 공식 공통 명세의 종합거래내역 요청 7필드는 기존 값과 일치. 계좌 조회 후 오류 종류를 구분하는 9.301 미승인 소스 후보를 준비한다. 원본 9.300 pin/운영 배포/스케줄/토큰 정책 불변. HTTP, 통신, JSON, 응답메시지, 블록 누락/타입을 고정 집계로 구분하되 원문/계좌번호/금액 미출력, 재조회 없음. 누락 블록은 0건으로 해석하지 않음. 실제 9.301 배포 및 실조회는 별도 승인/검증 대상.

## 수동 배포 UI 정리
- 실제 9.300 운영 전환 이후 9.294~9.298 후보/승인 입력 및 전용 배포 단계를 퇴역. 직전 9.300 정상 운영 소스, 역사적 원본 해시, 코드 수준 승인·복구/회귀 검사 유지. 현재 폼의 9.300은 기존 릴리스 경로이며 이미 배포된 운영을 반복 실행하지 않는다. 9.301은 CI에서 전체 후보 해시를 확인하고 별도 승인 게이트를 구성하기 전까지 선택 불가. 신규 예약/실배포 없음.

## 후속 9.301 릴리스 준비
- CI에서 확인한 전체 후보 Git blob `d82ddb8fdf5893c61129ee533217de3c7637717a`을 명시적으로 등록. 운영 9.300이 정확한 선행 버전이며 동일 실행의 쓰기 없는 ledger/idle gate 검증 필수. 9.300 이하 버전은 수동 배포 선택에서 제거하되 소스 핀과 이전 회귀 검증은 유지.
- 기존 KB/한화 NAV, 마감, 배당 조회, 마스터 조회, 웹/세제 동기화 호환성 등록. 보호 환경, dry-run 기본, 명시 승인 유지. 별도 inventory workflow는 9.301 dry-run만 운영 쓰기 없이 한 번 기동하고 중복 schedule 없음.
- 이 변경은 NH 금융소득 실패의 세부 유형 확인을 위한 릴리스 준비이며 실제 조회 성공·연간 집계 증빙이 아님. 실배포와 운영 검증은 별도.
