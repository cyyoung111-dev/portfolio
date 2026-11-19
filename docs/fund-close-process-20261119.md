# 2026-11-19 펀드 마감 프로세스 실운영 재점검

- 11/18 19:35 주식 PRICE 39행 완료. 19:43·19:53·20:03 독립 FUND 시작 후 완료 미기록. 11/19 00:27 BACKFILL_OK 39행, 00:32 FUND 시작, 00:34 FUND_DEFERRED_DONE(운영 동기화로그 조회). 실제 9.297 야간 상태 08:30 KST [44421174949](https://github.com/cyyoung111-dev/portfolio/actions/runs/44421174949) CLOSE COMPLETE / FUND DONE / 가격·Snapshot 11/18 일치 / pending 0. 내부 타임아웃 발생 지점 미확정, 9.299 범위 저장 후보는 미배포.
- 20:35 독립 fallback [44295983517](https://github.com/cyyoung111-dev/portfolio/actions/runs/44295983517) 정상 기동 및 [44296005939](https://github.com/cyyoung111-dev/portfolio/actions/runs/44296005939) 양 펀드 11/17 확정 NAV·파생 readback 일치. 11/18 당일 공표는 확인 대상에서 제외됨(COMPLETED_DAYS_ONLY); 이 결과로 11/18 확정 NAV를 저장했다고 판정하지 않음.
- 정규 18:10·19:17 일정의 실제 익일 03:00·03:51 기동 [44364879592](https://github.com/cyyoung111-dev/portfolio/actions/runs/44364879592) / [44374237114](https://github.com/cyyoung111-dev/portfolio/actions/runs/44374237114): STALE_OR_WRONG_DAY_SCHEDULE, private GAS 호출 0. fallback 정상 완료를 확인했으므로 지연 회차를 재시도하거나 시간창을 넓히지 않음.
- 09:25 KST 원본 확인: 최신 확정 NAV는 양 펀드 11/17. 11/18 확정 NAV 및 파생행은 당일 오전 정규 수집 및 10:20 독립 보완 결과로 별도 검증. 23:10 역사 백필 RUNNING 미종결 기록은 00:30 SUCCEEDED와 구분하여 보존; 실제 process 종료 증거 없이 삭제·성공 승격하지 않음.
- 발견된 진단 결함: 기존 read-only resumeClose는 실제 운영 9.297에서 RESUME_VERSION으로 중단. exact 9.294~9.298 읽기 전용만 허용하고 완료 marker와 NAV 경고를 분리; 기존 replay/apply 금지, 금융 원본 쓰기 0, 신규 스케줄/워크플로 없음. CI와 운영 진단 결과는 별도 확인 필요.

## 재발 방지: 일일 CLOSE 외부 NAV 조회 이중 경로 정리

- 실제 기준 소스의 `runDailyFundValuations`는 32일 범위에서 KB(FUNETF)는 저장 자료만, 한화(HANWHA)는 별도 HTTP 배치 조회·재시도를 수행한다. 한화의 독립 GitHub collector는 이미 exact C-RPe primary/secondary, 검증·import·날짜별 refresh 계약을 운영 중이다(11/18 fallback 증거 위 참조). 이중 경로 및 writer lease 내부 외부 네트워크 의존은 제거할 수 있는 구조적 위험이다. 실제 과거 hard-timeout의 내부 단계까지 확정한 것은 아니다.
- 승인되지 않은 9.300 후보를 통합 개선: 기존 9.299 가격이력 변경행 저장, 9.300 세제 동기화에 일일 CLOSE의 두 자동 NAV source(FUNETF/HANWHA)를 stored-only로 통일. 새로운 버전이나 예약 추가 없이 기존 9.300 후보만 개정한다. 수동 NAV 조회·수집기 정확 클래스/서버 검증·32일 local scan·가격/스냅샷 검증·1회 snapshot 제한·실패 및 continuation 처리 유지. 공식값 미확보를 0/확정값으로 대체하지 않는다.
- 운영상 차이: 한화 자동 수집은 기존 collector의 최근 8일 범위, 그 이전 누락은 여전히 32일 로컬 검사에서 경고되고 명시적인 기존 수동 복구 경로로 처리한다(과거 누락 자동 외부 조회는 일일 CLOSE에서 제거). 오래된 누락까지 독립 자동 복구하려면 별도 날짜별 검증·실행이 필요하므로 이번 변경으로 자동 복구 전체를 보장하지 않는다. 공표일 달력 추측 변경 없음.
- 9.300 후보는 아직 배포 allowlist에 없으며 실제 collector 소비자 호환성 및 통합 릴리스 gate, dry-run, 명시적 운영 승인 이후 배포·사후 대사가 필요하다. 기존 9.298 승인 소스 해시는 그대로 유지.
