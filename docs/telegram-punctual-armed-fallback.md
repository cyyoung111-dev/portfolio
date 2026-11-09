# 장전 07:40 · 마감 17:00 보조 실행 보호 정책

정규 발송 `telegram-morning-briefing.yml`(07:40, 재시도) 및 `telegram-close-briefing.yml`(17:00, 재시도)이 **주체**입니다. 이 변경은 GitHub Actions의 `schedule` 실행 시작이 지연될 수 있다는 운영 위험을 낮추는, 독립된 **사전 대기형 보조 실행**입니다.

- 장전: `telegram-morning-punctual-arm.yml`이 **07:20 KST** 예약으로 실행되고 **07:40**까지 대기합니다.
- 마감: `telegram-close-punctual-arm.yml`이 **16:35 KST** 예약으로 실행되고 **17:00**까지 대기합니다.
- 대기 중에는 시장 데이터 조회, NH OAuth, GAS 쓰기, 텔레그램 전송을 실행하지 않습니다. 정해진 시간이 도달한 다음 **기존** `telegram-morning-workflow.mjs` 또는 `telegram-close-workflow.mjs`의 `prepare → Claim Artifact → send → SENT Artifact`를 그대로 실행합니다. 비정상 출처·일자·시간이면 기존 검증대로 차단합니다.
- 기존 워크플로와 **동일 concurrency group**을 사용하고 `cancel-in-progress: false`를 유지합니다. 날짜별 Claim은 동일한 이름으로 예약하고, 선점된 날짜에는 재발송하지 않습니다. 수동 재시도·workflow_dispatch·fork·다른 branch·둘째 시도는 사전 대기 워크플로에서 거부합니다.
- 준비 시각 이전 실행은 데이터 발송을 허용하지 않으며, 현재 운영 코드 기준 **장전 08:10 / 마감 18:00 KST부터** 신규 준비·전송하지 않습니다. 마감의 17:40·17:50 재시도 예약도 18:00 차단 규칙을 따릅니다. 날짜별 휴장도 거부합니다.
- **정시 보장은 아닙니다.** GitHub가 사전 예약 자체를 늦게 실행하면 보호된 정규 브리핑의 지연과 동일하게 실패할 수 있습니다. 또한 07:40·17:00은 작업 준비 **시작 목표 시각**이며, 네트워크 요청과 GitHub Artifact 저장 이후 Telegram API 성공 응답 시각은 그보다 늦을 수 있습니다.
- 비용·운영 위험: 평일마다 러너를 약 20분(장전), 약 25분(마감) **대기**시켜 GitHub Actions 소비시간이 증가합니다. 근본적인 정시 보장에는 독립 호스팅의 직접 전송 스케줄러, 비밀키 안전 관리, 서버측 단일 날짜 Claim, 장애 알림과 재시작 복구가 추가로 필요합니다.
- **운영 실증 기준:** schedule run 생성 시각 vs job 시작 시각(KST), `ARM_TARGET_REACHED`, `PREPARED`와 원천별 QC, 중복 Claim 차단, Telegram SEND와 단일 SENT 증빙을 날마다 대조합니다. 기존 오늘(11/2) 17:00 일회성 fallback은 이 PR에서 변경하지 않습니다.

이 PR은 코드·synthetic CI 검증용이며, 병합·운영 적용·실발송은 별도 사용자 승인을 받아야 합니다.

## 2026-11-09 실행 누락 및 독립 기동

- 2026-11-09 17:00,17:05,17:10,17:20,17:40,17:50 KST 정규 마감 예약, 16:35 early-arm 예약, 16:50 precompute 예약의 **당일 GitHub Actions run이 관찰되지 않음**. 마지막 확인된 close 스케줄은 2026-11-07 새벽 KST (11/06 UTC 스케줄의 매우 늦은 시작) 실패 실행. *GitHub 스케줄이 누락된 원인은 플랫폼 로그 접근 불가로 확정하지 않음.*
- 오전 스케줄도 11/09 일부 11시 이후 매우 늦게 실행된 전례가 있어, GitHub schedule만으로 17:00 발송을 보장하지 못함. 단일 Claim/SENT 증빙 없는 발송은 성공으로 집계하지 않는다.
- 독립 실행은 ChatGPT 자동화 **`장마감 브리핑 독립 기동`**, 2026-11-10 16:26 KST부터 평일 동작. 16:20~16:36 KST의 KRX OPEN을 확인한 후 `ops/telegram-close-arm-trigger.txt`의 `armed=` 한 줄만 변경하는 **main 단일 커밋**으로 보호된 early-arm push 경로를 작동시킨다. 이미 오늘 날짜이면 중복 커밋 불가. 독립 자동화가 활성화됐다는 사실만으로 실제 push/run/SENT 보장하지 않는다.
- Push runner는 `HEAD^` 대조와 단일 파일/단일 커밋/파일 모드뿐 아니라 **원래 날짜와 동일한 KST의 당일 `armed=` 형식·기존 나머지 텍스트 완전 동일**을 확인해야 prepare/Claim/Telegram 단계에 진입할 수 있다.
- 매 거래일 16:26 독립 작업 결과 → 16:35 runner 실제 `verify_sentinel` → 17:00 `ARM_TARGET_REACHED` → Claim Artifact 생성 → Telegram API OK → SENT Artifact 생성까지 구분한다. 18:00 이후 오늘자 예약을 소급 실행하지 않는다.
