# #734 운영 예약 정리 — 기준점 및 1차 축소 (2026-11-14 KST)

## 현재 등록 현황 (main/.github/workflows 기준)

* 예약을 정의한 워크플로 **16개**, cron 표현식 **35개**. 이 수치는 매일 실행 건수가 아니며, 평일/월별 예약도 포함한다.
* 전체 워크플로 **100개** 중 다수는 과거 날짜 전용 읽기/복구 작업. **파일 수와 활성 cron 수는 별개**다.
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
| `krx-nightly-health.yml` | 1 | **유지** — 야간 소스/저장 상태 판정. 일요일 불필요 여부는 관측 후 점검 |
| `krx-52week-history.yml` | 1 | **유지** — T+1 252일 archive 수집 |
| `krx-tplus1-morning-readonly.yml` | 1 | **유지** — 공식 익영업일 발표 확인 |
| `dividend-source-refresh.yml` | 1 | **유지** — 매월 5·10일 2회, 1개 cron 표현식 |
| `ai-financial-evidence-prefetch.yml` | 1 | **유지** — 공시자료 보조 수집, Telegram 직접 발송 아님 |
| `briefing-public-source-timeliness-readonly.yml` | 5 | **실측 계속** — 16:52/17:08/17:35/07:30/08:15 시점별 공식 공표 지연 비교. 단순 중복 아님 |
| `probe-standalone-performance-gas-20261103.yml` | 1 | **주 1회로 축소** — 7일 성능 지표 진단만 수행, Writer/브리핑 선행조건 아님 |

합계 **35개 cron 표현식**. 7일 기준 독립 성능 진단은 기존 매일 7회에서 **월요일 09:05 KST 주 1회**로 감소(주 6회 절감). 공식 성능 자료 7일 이동창 유지, `workflow_dispatch` 수동 진단과 PR 자가검증 유지. [11/14 실조회 #43564712919](https://github.com/cyyoung111-dev/portfolio/actions/runs/43564712919): 7일 `sampleCount=0`; 해당 결과만으로 성능 문제가 없다고 주장할 수 없다.

## 범위 및 원칙

- 이번 변경은 **선택적 읽기 전용 성능 진단의 예약 주기만 변경**한다. 날짜별 펀드 NAV Writer, 손익/거래원장, Snapshot, GAS 배포, 텔레그램 전송, 크리티컬 백업 예약은 전혀 수정하지 않는다.
- 예약 표현식 개수는 35개 그대로이며, 실제 주간 실행 시도 횟수만 줄인다. 콘솔 성공/스킵이 금융 저장 성공을 뜻하지 않는다.
- **11/16(월) 운영 증빙 전에는** 장전 5 / 마감 6 / NH 4 / NAV 3을 임의로 줄이지 않는다. 장전·마감은 사전 기동 + Claim/SENT의 최종 결과가 정상이어야만 백업을 축소한다.
- 다음 정리 때는 각 후보의 **기준거래일, 실제 시작시간, 실패/스킵 원인, 당일 성공 아티팩트와 최초 성공한 슬롯**을 함께 비교한다. 독립 자동화 및 다른 `workflow_run` 복구 경로도 포함해야 한다.
- **4단계 완료 — NAV↔KRX 52주 `workflow_run` 연결 제거:** KRX 원시 OHLC는 T+1 시세 진단일 뿐 NAV 공표나 NAV 저장이 필요하다는 신호가 아니다. 실제 [11/14 05:58 KST NAV wake #43506362578](https://github.com/cyyoung111-dev/portfolio/actions/runs/43506362578)는 [KRX 23:30 예약의 지연 실행 #43506294072](https://github.com/cyyoung111-dev/portfolio/actions/runs/43506294072)에서 기동됐지만, KB imported=0, 한화 imported=0·writerInvoked=false, 공식 11/13 KB NAV 미공표, GAS CLOSE는 이미 COMPLETE였다. [11/14 KRX push에서 생성된 NAV #43590194264](https://github.com/cyyoung111-dev/portfolio/actions/runs/43590194264)는 4개 작업 모두 SKIPPED였다. 따라서 KRX↔NAV 연결만 제거하되, NAV 자체 **월~금 09:30/18:10/19:17** 예약, 독립 **10:20/20:30** fallback, 명시적 `workflow_dispatch`, 금융 CAS·원천공표 검증, Writer 간 직렬화는 유지한다. **11/16 실제 NAV 저장·재조회 성공 여부는 별도 운영검증 필요**.
- 전체 워크플로 파일 정리는 **별도 5단계**로 보류: 최종 호출 여부, 수동 응급 복구 기능, 날짜 제한과 안전 검증을 각 파일별로 확인한 후 삭제.
- [단일 운영 결과표](operating-status-verdict.md)로 NAV·저장 CLOSE·SENT는 각각의 증빙 수준만 PASS로 기록한다.

## 다음 실증용 질문

1. 11/16 07:40과 17:00 Telegram 메시지의 **실제 CLAIM/SENT 최초 생성시각은 언제였는가?**
2. 정상 cron과 별도 외부 sentinel 중 **어느 경로가 먼저 완료했는가?**
3. 09:30/18:10/19:17 NAV 중 어떤 슬롯이 실제 저장·읽기 완료를 수행했는가?
4. NH 참조 07:31/07:39/07:47/07:55 중 첫 공표 데이터 취득에 성공한 것은 언제인가?
5. 후속 수집이 같은 날 다시 실행되지 않았다는 증거가 남았는가?

이 다섯 가지에 답할 수 있을 때만 다음 주의 슬롯 축소 PR을 작성한다.
