# #734 운영 예약 정리 — 기준점 및 1차 축소 (2026-11-14 KST)

## 현재 등록 현황 (main/.github/workflows 기준)

* 예약을 정의한 워크플로 **16개**, cron 표현식 **35개**. 이 수치는 매일 실행 건수가 아니며, 평일/월별 예약도 포함한다.
* 과거 Issue 기반 워크플로 45개(정기 cron 0개) 중 **7개 사용 종료**: 전체 워크플로 **100→93개**, Issue 기반 **45→38개**. **파일 수와 활성 cron 수는 별개**다. 활성 예약 워크플로 16개/cron 35개는 그대로 유지. 11/15 2차 정리에서 `issue-507-snapshot-date-scoped-safety.yml`, `issue-507-writer-ledger-provenance-contract.yml` 두 개의 **중복·합성 전용 Actions wrapper**만 추가 삭제. 해당 운영 함수 회귀 검증은 `check:ci`에서 이미 매 PR 실행 중이며, 삭제 후에도 필수 실행을 유지하도록 검증기를 강화한다. 최근 main Actions 800회에서 두 워크플로 실행은 0회였다. 11/15 3차 정리에서는 별도의 **유효기간 만료** `issue507-postmerge-actions-readonly.yml`을 종료했다. 이 도구는 10/31 두 병합 SHA를 조사하고 `windowFrom`부터 **14일이 지나면 `ISSUE507_AUDIT_WINDOW_TOO_OLD`로 무조건 실패**하는 일회성 조사다. 과거 확인된 운영 증거는 `ops/issue507/postmerge-actions-evidence.md`에 남기고, 합성 재실행 검사는 `check:ci`에서 계속 유지한다.
* ChatGPT 외부 독립 기동(NAV 오전/저녁, Telegram 장전/마감)은 GitHub cron 표현식 35개에 포함되지 않는다.
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
| `krx-52week-history.yml` | 1 | **유지** — T+1 252일 archive 수집 |
| `krx-tplus1-morning-readonly.yml` | 1 | **유지** — 공식 익영업일 발표 확인 |
| `dividend-source-refresh.yml` | 1 | **유지** — 매월 5·10일 2회, 1개 cron 표현식 |
| `ai-financial-evidence-prefetch.yml` | 1 | **유지** — 공시자료 보조 수집, Telegram 직접 발송 아님 |
| `briefing-public-source-timeliness-readonly.yml` | 5 | **실측 계속** — 16:52/17:08/17:35/07:30/08:15 시점별 공식 공표 지연 비교. 단순 중복 아님 |
| `probe-standalone-performance-gas-20261103.yml` | 1 | **주 1회로 축소** — 7일 성능 지표 진단만 수행, Writer/브리핑 선행조건 아님 |

합계 **35개 cron 표현식**. 2026-11-15의 추가 축소는 `krx-nightly-health`의 월요일 02:30 KST 정기 실행 1회/주만 제거(기존 7회→6회). 토요일은 금요일 KRX 마감, 일요일은 금요일 미국장 마감 후 혼합자산 Snapshot 점검 가능성을 고려해 유지한다. 월요일 아침 최초 KRX 거래일 전 점검은 단순 반복 조회로 판정하지 않는다. `workflow_dispatch`는 그대로이며 금융 Writer/텔레그램/기타 예약은 변경하지 않는다. 7일 기준 독립 성능 진단은 기존 매일 7회에서 **월요일 09:05 KST 주 1회**로 감소(주 6회 절감). 공식 성능 자료 7일 이동창 유지, `workflow_dispatch` 수동 진단과 PR 자가검증 유지. [11/14 실조회 #43564712919](https://github.com/cyyoung111-dev/portfolio/actions/runs/43564712919): 7일 `sampleCount=0`; 해당 결과만으로 성능 문제가 없다고 주장할 수 없다.

## 외부 승인형 진단의 실행 정책 (2026-11-15)

- `issue734-process-scope-audit-readonly.yml`: OAuth `script.processes` 권한을 실제 조회하는 단계는 main 수동 실행 전용. PR/main 소스 변경은 비밀정보 없는 오프라인 계약 검사만 수행하며 OAuth 권한 부재를 자동 오류로 만들지 않는다.
- `krx-52week-listing-audit-readonly.yml`: KRX 2개 종목기본정보 API HTTP 401 해결 전 자동 push 실조회 제거. 서비스별 이용승인 후 main 수동 실행 1회로 확인. 다른 정규 KRX OHLC 252일 수집 cron은 그대로 유지.
- Snapshot 동일일·동일종목에 외부 Sheets API가 동시에 쓰는 경합은 GAS ScriptLock만으로 해결되지 않는다. 운영 원본의 owner-only Drive 공유 메타데이터는 소유자 본인의 별도 API·수동 편집 부재를 증명하지 않는다. 그러므로 금융 운영 동시성 안전성 최종 승인은 별도 증거 전까지 보류한다.

## 범위 및 원칙

- 이번 변경은 **선택적 읽기 전용 성능 진단의 예약 주기만 변경**한다. 날짜별 펀드 NAV Writer, 손익/거래원장, Snapshot, GAS 배포, 텔레그램 전송, 크리티컬 백업 예약은 전혀 수정하지 않는다.
- 예약 표현식 개수는 35개 그대로이며, 실제 주간 실행 시도 횟수만 줄인다. 콘솔 성공/스킵이 금융 저장 성공을 뜻하지 않는다.
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
