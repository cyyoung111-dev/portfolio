# 독립 브리핑 실행 시계 — Cloudflare Workers

**상태: 저장소 코드 및 CI 검증용. 실제 Cloudflare 운영 배포·토큰 등록 전, 발송 미가동.**

GitHub Actions 자체 `schedule`이 누락되더라도 별도의 Cloudflare Cron Trigger에서 GitHub의 이미 검증된 early-arm `workflow_dispatch`를 호출합니다. 이 Worker는 Telegram, NH, GAS, 스프레드시트로 요청하지 않습니다.

## 예약 시간 (KST)

| Cloudflare UTC | 한국시간 | 대상 |
| --- | --- | --- |
| 일~목 22:20 | 월~금 07:20 | `telegram-morning-punctual-arm.yml` → 07:40 장전 |
| 월~금 07:35 | 월~금 16:35 | `telegram-close-punctual-arm.yml` → 17:00 마감 |

Cloudflare UTC cron 요일은 `SUN-THU` / `MON-FRI`처럼 문자로 표기하여 숫자 요일 규칙의 혼동을 피합니다. **한국 공휴일에는 GitHub early-arm의 거래일 검사에서 중단**합니다.

## 보안·운영 계약

- 외부 HTTP `fetch()`는 항상 404. 승인된 두 Cron 문자열만 처리.
- `DISPATCH_ENABLED=true` 전까지 모든 스케줄은 비활성 상태. 기본값은 안전 차단.
- 발생 예정시각 대비 10분 이상 늦게 시작하거나 한국 날짜/평일/시각이 일치하지 않으면 dispatch하지 않음.
- GitHub 목적지와 workflow 이름은 코드에 고정, `ref: main`만 허용. 사용자 입력/브랜치 지정 없음.
- GitHub fine-grained token: 저장소 **`cyyoung111-dev/portfolio`에만** 접근, 권한 **Actions: Read and write**. 다른 저장소/Contents 쓰기 권한 금지.
- Cloudflare Secret **`GITHUB_DISPATCH_TOKEN`**에만 저장. GitHub Repository secrets, 소스, Wrangler vars, `.env`, 로그에 저장하지 않음.
- Cloudflare Cron 성공은 **GitHub 요청이 수락됨**만 의미합니다. 실제 07:40/17:00 발송은 GitHub `-sent` Artifact와 Telegram API `SENT`로 따로 확인해야 합니다.
- 중복 dispatch가 발생해도 GitHub 공통 concurrency group 및 날짜별 claim이 발송을 제한. 오래된 날의 큐 실행은 GitHub의 장전/마감 cutoff에서 차단됩니다.
- 장애 발생 시 보조 Worker 비활성화: Cloudflare Worker Secret `DISPATCH_ENABLED` 값을 `false`로 변경하거나 Cron Triggers를 비활성화. 금융 원본 및 GAS 서비스와 독립.

## 사용자가 Cloudflare를 연결한 뒤 진행할 단계

1. Cloudflare 계정에서 Workers 권한을 구성하고 Cloudflare Wrangler에 로그인합니다.
2. `cd ops/briefing-external-scheduler` 후 `npx wrangler deploy --dry-run`으로 빌드/구성을 검증합니다.
3. `npx wrangler deploy`를 실행하되, Secret이 없는 기본 비활성 상태를 유지합니다.
4. `npx wrangler secret put GITHUB_DISPATCH_TOKEN`에 GitHub의 최소권한 토큰을 등록합니다. 채팅이나 PR에 토큰을 붙여넣지 마세요.
5. `npx wrangler secret put DISPATCH_ENABLED` 값 `true`를 설정합니다. 이는 **실운영 가동 승인 시에만** 수행합니다.
6. 다음 거래일 07:20/16:35 Cloudflare Cron 실행 기록 → GitHub `workflow_dispatch` run → 원래 prepare/claim/send/-sent를 순서대로 확인합니다.
7. 연속 거래일의 정시성·중복 0건·야간선물·주요종목 확보율을 확인한 뒤 독립 스케줄러 운영 성공으로 판정합니다.

`npm`을 통한 로컬 synthetic 검증은 `node scripts/check-briefing-external-scheduler.mjs`입니다.

### 제한

Cloudflare의 Cron 자체도 지연될 수 있어 **시간을 절대 보장하는 것은 아닙니다.** 예약 이벤트가 늦으면 실패가 명시적으로 기록되며 당일이 아닌 데이터로 소급 발송하지 않습니다. GAS v9.281/v9.282 전환과 NVDA/MU 가격 저장은 별도 과제입니다.
