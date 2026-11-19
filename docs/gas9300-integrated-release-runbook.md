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
