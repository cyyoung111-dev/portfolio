# PC·모바일 조회시간 자동 수집

**현재 상태: 코드 준비 단계, 실수집 비활성화.** 금융 GAS v9.281 및 v9.282 전환, 원장, Snapshot, NH, 텔레그램과 독립된 Cloudflare Worker+D1 수집기입니다.

## 개인정보 최소화
웹 클라이언트가 보내는 정보는 version=1, device(mobile/desktop/unknown), 허용된 조회 단계(stage), 밀리초(ms), 성공 여부(result)뿐입니다. 원장, 보유 종목, 평가금액, 계좌, 사용자의 URL, 인증정보, IP와 User-Agent는 애플리케이션 DB에 저장하지 않습니다. 다만 Cloudflare의 인프라 자체에 표준 네트워크 접근 로그가 남을 가능성은 별개입니다. device는 768px 화면 폭 기준이라 태블릿/축소된 PC에서 오분류될 수 있습니다.

각 기기에서 수집기 URL과 동의를 별도로 저장하며 동의 없이는 전송하지 않습니다. 전송 실패가 금융 조회를 중단하지 않으며 브라우저 대기열은 최대 60건입니다. 원격 D1 데이터는 7일 뒤 정기 삭제합니다. 보고서는 개별 조회 로그가 아니라 기기·단계별 건수/중앙값/p95/실패율만 노출합니다.

## 별도 Cloudflare 운영 준비
1. Cloudflare Workers와 D1 사용 가능 여부, 과금/한도 및 WAF/rate limit을 확인합니다.
2. ops/lookup-performance-collector에서 npx wrangler d1 create portfolio-lookup-performance로 D1을 만들고 wrangler.toml의 REPLACE_WITH_YOUR_D1_DATABASE_ID를 반환된 실제 ID로 바꿉니다.
3. npx wrangler d1 execute portfolio-lookup-performance --remote --file=./schema.sql 명령으로 테이블을 생성합니다.
4. npx wrangler secret put REPORT_TOKEN을 이용해 24자 이상 강력한 독립 읽기 비밀번호를 등록합니다. 절대 저장소/브라우저/URL에 공개하지 않습니다.
5. wrangler.toml의 ALLOWED_ORIGIN은 실제 포트폴리오 사이트의 https Origin과 정확히 일치시킵니다. 포트폴리오 연동 GAS URL을 지정하지 않습니다.
6. npx wrangler deploy 후 먼저 INGEST_ENABLED=false 상태임을 확인합니다. Origin만으로는 공격자에 대한 강력한 인증이 아니므로 WAF/rate limit 및 과금 방어가 필수입니다.
7. 별도 승인과 실제 준비가 완료된 뒤 INGEST_ENABLED=true로 활성화합니다. 웹앱 외부연동 탭에서 각 기기의 /ingest URL과 동의 체크를 설정하면 이후 조회는 자동 수집합니다.

## GitHub 자동 보고
Actions Secrets PERF_COLLECTOR_URL(https Worker host, /report 없이), PERF_REPORT_TOKEN(Worker REPORT_TOKEN과 동일), Actions Variable PERF_MONITOR_ENABLED=true가 있어야 스케줄 또는 수동 실행이 진행됩니다. 기본값은 불가동입니다. GitHub Actions 워크플로 lookup-performance-report는 매일 08:10 KST를 요청하지만 schedule 누락/지연될 수 있으며, 7일간의 집계 artifact를 남깁니다. 공개 저장소의 Actions artifact 공개 범위를 반드시 확인한 뒤 활성화하세요.

## 원격 보고
서버 전용 비밀번호로 HTTPS GET /report에 Authorization: Bearer 헤더를 지정하여 중앙값·p95·실패율을 비교할 수 있습니다. 브라우저에는 보고서 비밀번호가 절대 들어가지 않습니다. ChatGPT는 GitHub Actions의 성공 실행과 집계 artifact가 접근 가능하면 별도 스크린샷 없이 읽고 비교할 수 있습니다.

## 미완료 경계
저장소 PR 병합만으로 Cloudflare 배포, D1 생성, Secrets 등록, 실제 기기 동의 또는 실수집이 자동으로 실행되지는 않습니다. 이 작업들은 별도 외부 환경 준비와 실증이 필요합니다. 안전 게이트가 충족되지 않으면 수집은 기본 중지됩니다.
