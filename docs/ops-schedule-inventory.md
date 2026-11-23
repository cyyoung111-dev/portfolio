# #734 운영 예약 정리 — 52주 전종목 자동수집 중단 (2026-11-17 KST)

## 현재 등록 현황 (main/.github/workflows 기준)

> **2026-11-17 적용:** 전 종목 52주 신고·신저가 개발은 보류합니다. `krx-52week-history.yml`의 평일 23:30 예약과 소스 변경 push 기동을 제거했습니다. 이력 아티팩트는 60일 만료 정책대로 유지·종료하며 추가 다운로드/재암호화/새 저장을 자동 실행하지 않습니다. 운영자 수동 점검과 CI 소스 안전성 테스트는 남깁니다. 이 변경은 보유 39종목의 52주 값·KRX 시장폭 A/D·가격/평가·NAV와는 무관합니다.

* 예약을 정의한 워크플로 **15개**, cron 표현식 **34개**. 52주 원시시세 자동 예약 1개를 제거했습니다. 이 수치는 매일 실행 건수가 아니며, 평일/월별 예약도 포함한다.
* 과거 Issue 기반 워크플로 45개(정기 cron 0개) 중 **7개 사용 종료**: 전체 워크플로 **100→93개**, Issue 기반 **45→38개**. **파일 수와 활성 cron 수는 별개**다. 활성 예약 워크플로 16개/cron 35개는 그대로 유지. 11/15 2차 정리에서 `issue-507-snapshot-date-scoped-safety.yml`, `issue-507-writer-ledger-provenance-contract.yml` 두 개의 **중복·합성 전용 Actions wrapper**만 추가 삭제. 해당 운영 함수 회귀 검증은 `check:ci`에서 이미 매 PR 실행 중이며, 삭제 후에도 필수 실행을 유지하도록 검증기를 강화한다. 최근 main Actions 800회에서 두 워크플로 실행은 0회였다. 11/15 3차 정리에서는 별도의 **유효기간 만료** `issue507-postmerge-actions-readonly.yml`을 종료했다. 이 도구는 10/31 두 병합 SHA를 조사하고 `windowFrom`부터 **14일이 지나면 `ISSUE507_AUDIT_WINDOW_TOO_OLD`로 무조건 실패**하는 일회성 조사다. 과거 확인된 운영 증거는 `ops/issue507/postmerge-actions-evidence.md`에 남기고, 합성 재실행 검사는 `check:ci`에서 계속 유지한다.
* ChatGPT 외부 독립 기동(NAV 오전/저녁, Telegram 장전/마감)은 GitHub cron 표현식 34개에 포함되지 않는다.
* GitHub cron은 약속된 시각에 실제 시작하지 않을 수 있다. 새 스케줄을 추가하는 것만으로 정시성을 보장할 수 없으며, `SENT`/공식 NAV 저장 증빙을 기준으로 판단한다.

| 예약 워크플로 | cron 수 | 현재 판단 |
| --- | ---: | --- |
| `telegram-morning-briefing.yml` | 5 | **유지** — 07:40~08:10 복구용 CLAIM/SENT 경로, 11/16 발송 실증 후 재평가 |
| `telegram-morning-punctual-arm.yml` | 1 | **유지** — 사전 준비·독립 sentinel 복구 경로 |
| `telegram-close-briefing.yml` | 6 | **유지** — 17:00~18:00 복구용 CLAIM/SENT 경로 |
| `telegram-close-punctual-arm.yml` | 1 | **유지** — [11/13 실제 SENT](https://github.com/cyyoung111-dev/portfolio/actions/runs/43385769532) 확인 |
| `telegram-close-precompute.yml` | 1 | **유지** — 발송 전 공식 시세 사전 준비 |
| `nh-night-capture.yml` | 4 | **유지** — 아침 NH 공표 자료 확보 시점의 복구 기능 |
| `nh-night-capture-health.yml` | 1 | **유지** — 실제 아티팩트 누락 감시 |
| `kb-fund-nav-collect.yml` | 3 | **유지** — 날짜별 저장·읽기 검증과 별도 fallback |
| `market-briefing-headless.yml` | 2 | **유지** — 16:30 및 20:15 체크포인트 별도 |
| `krx-nightly-health.yml` | 1 | **월요일 02:30 정기 실행 제외** — UTC 월~토 17:30 = KST 화~일 02:30. 금요일 미국장 이후 주말 Snapshot 확인 여지를 위해 일요일 유지, 수동 진단 유지 |
| `krx-52week-history.yml` | 0 | **자동 수집 종료** — schedule·push 제거. 원본 삭제 없이 운영자 `workflow_dispatch`만 남김 |
| `krx-tplus1-morning-readonly.yml` | 1 | **유지** — 공식 익영업일 발표 확인 |
| `dividend-source-refresh.yml` | 1 | **유지** — 매월 5·10일 2회, 1개 cron 표현식 |
| `ai-financial-evidence-prefetch.yml` | 1 | **유지** — 공시자료 보조 수집, Telegram 직접 발송 아님 |
| `briefing-public-source-timeliness-readonly.yml` | 5 | **실측 계속** — 16:52/17:08/17:35/07:30/08:15 시점별 공식 공표 지연 비교. 단순 중복 아님 |
| `probe-standalone-performance-gas-20261103.yml` | 1 | **주 1회로 축소** — 7일 성능 지표 진단만 수행, Writer/브리핑 선행조건 아님 |

현재 합계 **34개 cron 표현식** (11/16 이전 역사적 합계는 35개). 2026-11-15의 추가 축소는 `krx-nightly-health`의 월요일 02:30 KST 정기 실행 1회/주만 제거(기존 7회→6회). 토요일은 금요일 KRX 마감, 일요일은 금요일 미국장 마감 후 혼합자산 Snapshot 점검 가능성을 고려해 유지한다. 월요일 아침 최초 KRX 거래일 전 점검은 단순 반복 조회로 판정하지 않는다. `workflow_dispatch`는 그대로이며 금융 Writer/텔레그램/기타 예약은 변경하지 않는다. 7일 기준 독립 성능 진단은 기존 매일 7회에서 **월요일 09:05 KST 주 1회**로 감소(주 6회 절감). 공식 성능 자료 7일 이동창 유지, `workflow_dispatch` 수동 진단과 PR 자가검증 유지. [11/14 실조회 #43564712919](https://github.com/cyyoung111-dev/portfolio/actions/runs/43564712919): 7일 `sampleCount=0`; 해당 결과만으로 성능 문제가 없다고 주장할 수 없다.

## 필수 CI의 중복 실행 절감 (2026-11-15)

- `quality-check.yml`에서 **같은 PR의 구버전 CI만 취소**한다. 새 커밋이 올라오면 오래된 PR 분석에 러너를 중복 사용하지 않는다. **`main` push와 수동 CI는 각 run ID에 고유한 concurrency 그룹을 부여**하므로 이전 main 검사 취소·대기 교체·GAS 자동배포 증빙 누락을 발생시키지 않는다.
- 필수 `check:ci` 범위, 전체 검사 통과 조건, 브랜치 제한, GAS `workflow_run` 연결은 불변이다. 실행시간 절감 규모는 후속 PR 수정 사례의 실제 취소 런과 Actions 분 단위로 별도 검증한다. `cancelled` PR은 통과 증빙이 아니다.

## 외부 승인형 진단의 실행 정책 (2026-11-15)

- `issue734-process-scope-audit-readonly.yml`: **워크플로 전체를 main 운영자 수동 실행 전용으로 단순화**. 기존 PR/push에서 별도 Actions `source-check`를 반복 실행했으나, 동일 `scripts/check-issue734-process-scope-audit-readonly.mjs`가 `quality-check` 필수 `check:ci`에 이미 수록돼 있어 중복만 제거한다. 수동 선택 시에는 source-check→보호된 GAS 환경의 실제 OAuth scope audit 순서와 재실행 차단 정책을 유지하며 OAuth 권한 부재를 자동 오류로 만들지 않는다.
- `krx-52week-listing-audit-readonly.yml`: KRX 2개 종목기본정보 API HTTP 401 해결 전 자동 push 실조회 제거. 이후 2026-11-17에는 **KRX 전종목 OHLC 252일 수집 cron도 제거**, 52주 관련 두 워크플로 모두 수동 실행만 허용. 기존 승인/예외 검사 코드는 보존하되 자동 계산·배포는 중단합니다.
- Snapshot 동일일·동일종목에 외부 Sheets API가 동시에 쓰는 경합은 GAS ScriptLock만으로 해결되지 않는다. 운영 원본의 owner-only Drive 공유 메타데이터는 소유자 본인의 별도 API·수동 편집 부재를 증명하지 않는다. 그러므로 금융 운영 동시성 안전성 최종 승인은 별도 증거 전까지 보류한다.

## 범위 및 원칙

- 이번 변경은 **선택적 읽기 전용 성능 진단의 예약 주기만 변경**한다. 날짜별 펀드 NAV Writer, 손익/거래원장, Snapshot, GAS 배포, 텔레그램 전송, 크리티컬 백업 예약은 전혀 수정하지 않는다.
- 11/15 당시 예약 표현식은 35개였으나 **11/17 전종목 52주 예약 1개 중단 후 34개**입니다. 52주 cron·push와 무관한 금융 Writer, NAV, NH, KRX 가격, A/D, Telegram 예약은 유지합니다. 콘솔 성공/스킵이 금융 저장 성공을 뜻하지 않는다.
- **11/16(월) 운영 증빙 전에는** 장전 5 / 마감 6 / NH 4 / NAV 3을 임의로 줄이지 않는다. 장전·마감은 사전 기동 + Claim/SENT의 최종 결과가 정상이어야만 백업을 축소한다.
- 다음 정리 때는 각 후보의 **기준거래일, 실제 시작시간, 실패/스킵 원인, 당일 성공 아티팩트와 최초 성공한 슬롯**을 함께 비교한다. 독립 자동화 및 다른 `workflow_run` 복구 경로도 포함해야 한다.
- **4단계 완료 — NAV↔KRX 52주 `workflow_run` 연결 제거:** KRX 원시 OHLC는 T+1 시세 진단일 뿐 NAV 공표나 NAV 저장이 필요하다는 신호가 아니다. 실제 [11/14 05:58 KST NAV wake #43506362578](https://github.com/cyyoung111-dev/portfolio/actions/runs/43506362578)는 [KRX 23:30 예약의 지연 실행 #43506294072](https://github.com/cyyoung111-dev/portfolio/actions/runs/43506294072)에서 기동됐지만, KB imported=0, 한화 imported=0·writerInvoked=false, 공식 11/13 KB NAV 미공표, GAS CLOSE는 이미 COMPLETE였다. [11/14 KRX push에서 생성된 NAV #43590194264](https://github.com/cyyoung111-dev/portfolio/actions/runs/43590194264)는 4개 작업 모두 SKIPPED였다. 따라서 KRX↔NAV 연결만 제거하되, NAV 자체 **월~금 09:30/18:10/19:17** 예약, 독립 **10:20/20:30** fallback, 명시적 `workflow_dispatch`, 금융 CAS·원천공표 검증, Writer 간 직렬화는 유지한다. **11/16 실제 NAV 저장·재조회 성공 여부는 별도 운영검증 필요**.
- 5단계 워크플로 정리는 **2차 진행 중**: 지난 800회 Actions 실행 이력·종속성·필수 CI 수록을 확인하고 합성 전용 중복 wrapper 총 6개만 단계적으로 삭제. 수동 금융 복구·실제 조회·OAuth 감사·날짜별 검증이 필요한 워크플로는 보존한다.
- [단일 운영 결과표](operating-status-verdict.md)로 NAV·저장 CLOSE·SENT는 각각의 증빙 수준만 PASS로 기록한다.

## 다음 실증용 질문

1. 11/16 07:40과 17:00 Telegram 메시지의 **실제 CLAIM/SENT 최초 생성시각은 언제였는가?**
2. 정상 cron과 별도 외부 sentinel 중 **어느 경로가 먼저 완료했는가?**
3. 09:30/18:10/19:17 NAV 중 어떤 슬롯이 실제 저장·읽기 완료를 수행했는가?
4. NH 참조 07:31/07:39/07:47/07:55 중 첫 공표 데이터 취득에 성공한 것은 언제인가?
5. 후속 수집이 같은 날 다시 실행되지 않았다는 증거가 남았는가?

이 다섯 가지에 답할 수 있을 때만 다음 주의 슬롯 축소 PR을 작성한다.

## 2026-11-23 KST 운영 분류 및 확인 결과

`8306667`의 워크플로 파일은 89개이며, 정기 예약 16개에 cron 표현식 36개가 있습니다. 아래 분류는 주 용도 기준입니다. 한 워크플로 안에 운영 슬롯과 복구 슬롯이 함께 있는 경우가 있습니다.

| 분류 | 경로와 역할 |
| --- | --- |
| 운영 필수 | `kb-fund-nav-collect`의 원천·검증·정규 저장, `nh-night-capture`, `telegram-morning-briefing`, `telegram-close-briefing`, `telegram-close-precompute`, `market-briefing-headless`, `ai-financial-evidence-prefetch`, `dividend-source-refresh`, `high-dividend-kind-source`, 품질 검사·웹 배포·보호된 GAS 릴리스. GAS 내부의 일일 PRICE/FUND/CLOSE 및 Snapshot 트리거는 GitHub cron 개수 밖입니다. |
| 복구용 | NAV 독립 sentinel, Telegram 장전·마감 조기 기동 및 후속 예약, NH 자료 확보 보조 슬롯, `historical-checkpoint-reconcile`, `issue-507-*-finalize`·`*-reconcile`·`*-resume`·`*-maintenance`, `krx-targeted-recovery`, `krx-verified-pending-finalize`, 트리거 초기화 및 Runtime provisioning. 승인은 기존 운영 경로에 따릅니다. |
| 진단용 | `portfolio-daily-ops-readonly`, `issue734-current-close-status-readonly`, `krx-nightly-health`, `krx-tplus1-morning-readonly`, `nh-night-capture-health`, 원천 공표시간 probe, 성능 probe 및 나머지 read-only audit·smoke·source-contract 워크플로. 정기 감시와 수동 조사 경로를 포함합니다. |
| 퇴역 검토 | 52주 원시이력 수동 수집 및 날짜·릴리스가 고정된 과거 조사/복구. 특히 `issue734-nov19-fund-derived-once`는 9.304 전용이어서 9.305 이후에 실행 가능한 범용 복구 경로로 취급하지 않습니다. 실행 이력·의존관계·대체 경로를 확인한 뒤 종료 판단을 합니다. |

- **NAV** [#45094258344](https://github.com/cyyoung111-dev/portfolio/actions/runs/45094258344)의 KB와 한화 import ACK는 모두 8초 이내였습니다. 후속 조회에서 11/20 공표 NAV의 날짜·값 일치가 확인됐지만 평가/Snapshot은 확인되지 않았습니다. REFRESH 비정상 HTTP 응답은 각각 약 108초와 88초에 발생했고 HTTP 코드·서버 내부 종료 단계는 기록되지 않았습니다. 직렬 job 및 GAS lease는 유지합니다. [#45134980051](https://github.com/cyyoung111-dev/portfolio/actions/runs/45134980051)은 09:30 KST 예약이 16:58에 들어와 private GAS 호출 전에 차단된 별건입니다.
- **마감** 같은 실행의 읽기 전용 조회에서 11/22 달력일 CLOSE가 `ERROR`, `WRITE_VERIFICATION`, Snapshot stale로 기록됐습니다. 일요일의 미공표와 가격이력·Snapshot 저장 검증 오류를 따로 판정합니다. KRX 전용 휴장 판단을 미국 시장·채권·펀드 공표에 일괄 적용하지 않습니다.
- **브리핑** 11/23 장전 [#45078031151](https://github.com/cyyoung111-dev/portfolio/actions/runs/45078031151)은 필수 21/21 및 실제 SENT를 확인했습니다. 선택 선물 4개는 원천 미확보였습니다. 마감 [#45130802456](https://github.com/cyyoung111-dev/portfolio/actions/runs/45130802456)은 핵심 6/6, 선물 4/4 및 CLAIM/SENT를 확인했습니다. 당일 VKOSPI와 거래대금은 KRX T+1 정상 미공표로 분리됐습니다. 당일 여러 정규 예약의 지연 실행이 관측됐으므로 복구 슬롯을 유지합니다.
- **릴리스** [#44871790838](https://github.com/cyyoung111-dev/portfolio/actions/runs/44871790838)의 9.305 운영 배포 직후 거래 338행과 V2 해시 일치, Writer gate OPEN·active 0이 확인됐습니다. 신규 NAV 반영, 파생값, 정확한 Snapshot 일별 합계 및 화면은 각각 별도 근거가 필요합니다.
