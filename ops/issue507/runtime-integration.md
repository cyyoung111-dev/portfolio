# 운영 통합 준비 — main 453423ef / Issue #507 / PR #782

현재는 **후보 생성·합성 검증만** 한다. `src/gas/apps_script.gs`, 운영 버전·승인 해시,
HTTP·메뉴·트리거·실제 Properties·금융 원본을 변경하지 않는다. 신규 배포/병합/원본 쓰기는 별도 승인 사항이다.

## 진입·종료의 단일 경계

`prepareIssue507Runtime()`은 고정 SHA-256의 생산 소스에만 작동하며, 555개 전체 최상위 함수
(HTTP, 수동 refresh, 메뉴, CLOCK/onEdit, 직접 helper 호출 포함)를 각각 wrapper로 보존한다.
각 실행의 가장 바깥 wrapper가 ScriptLock 안에서 고유 실행 receipt를 먼저 영속 기록한 뒤
생산 본문을 호출한다. 수동 refresh의 외부 NAV 조회도 receipt 등록 이후에만 시작한다.
중첩 함수는 실행 내 플래그로 동일 소유권을 유지하고, 가장 바깥 finally만 종료 receipt를 남긴다. 최근 8개 token/함수/시작·종료시각/ENDED receipt와 누적 종료 개수를 보존한다. ENDED는 업무 성공 판정이 아니다.
실제 생산 HTTP/refresh 본문을 실행하는 VM 테스트로 두 진입 경로 모두 확인한다.

운영 통합 승인 시 생성 후보는 **한 SERVER_JS 안에** 생산 소스·gate·단건 복구를 묶는다.
원래 함수의 private 구현 alias를 직접 실행하는 것은 금지하며 편집기 접근은 차단 대상으로 취급한다.
후보는 순수 함수 반환값으로만 생성되며 파일 저장/네트워크/배포 기능이 없다.
현재 배포기는 승인 해시가 다른 이 후보와 추가 SERVER_JS를 거부한다.
실제 통합 릴리스에는 버전/모든 API 버전/웹 EXPECTED_GAS_VERSION/배포 문서/승인해시를
별도로 갱신하고 그 최종 소스를 리뷰해야 한다. 이번 PR은 그 릴리스가 아니다.

## 승인된 후의 운영 순서 (현재 미실행)

1. 전 계정·버전·배포를 확인한다. 기존 비계측 웹앱 배포/실행 API 배포를 비활성화하고,
   직접 편집기 실행 및 외부 Sheets API/수동 시트 편집도 차단한다. gate 없는 과거 배포가
   남거나 접근 가능한 구현 alias가 있으면 전체 writer 배제를 주장할 수 없다.
2. 기존 비계측 실행의 종료는 **Apps Script Executions 화면에서 모든 프로젝트 실행자·버전을
   포함해 독립 확인**한다. RUNNING/PAUSED/DELAYED/판정불가/범위 불충분은 차단이다.
   마지막 종료/미확인 실행, 확인자·시각·비공개 증빙 참조를 운영 기록에 남긴다.
   보이지 않는 실행자는 해당 계정의 기록까지 확보하거나 중단한다. 403/빈 목록/대기시간으로 대체하지 않는다.
3. 후보 통합 릴리스에 대한 별도 승인·검증 후, `releaseId`에 묶인
   `issue507_writer_gate_rollout_v1`을 운영자가 설정한다. 필드:
   `oldDeploymentsDisabled`, `externalWritersBlocked`, `editorsBlocked` 모두 true,
   `verifiedAt`은 확인 epoch ms, `legacyDrainEvidence`는
   `{kind:"EXECUTIONS_UI",scope:"ALL_PROJECT_ACTORS_AND_VERSIONS",terminalOnly:true,reference:"비공개 증빙 ID"}`.
   이는 운영자 증빙 확인이며 코드가 Executions 화면을 자동 조회했다는 뜻이 아니다.
4. `issue507BeginWriterDrain_()`은 metadata만 기록하고 DRAINING으로 신규 진입을 차단한다.
   **최초 진입 및 OPEN에서 시작하는 모든 새 drain 주기**는 5분 이내의 새 rollout 확인만 받는다.
   재개 후 이전 주기의 확인서를 재사용할 수 없고, 반복 호출로 시작시각/활성 receipt를 지우지 않는다.
   미초기화 gate는 기본 거부이므로 신규 후보를 먼저 공개 서비스로 전환하지 않는다.
5. `issue507WriterDrainStatus_()`로 7분 연속 차단 관찰과 active receipt 0개를 확인한다.
   관찰 시간은 추가 조건일 뿐 기존 비계측 실행의 독립 종료 증빙을 대체하지 않는다.
   [Google 공식 할당량](https://developers.google.com/apps-script/guides/services/quotas)의
   script runtime 안내(2026-10-31 확인: 6분/실행)를 참고하되 시간 경과만으로 종료 판정하지 않는다.
6. gate 검증과 PR #782의 fresh quiescence 확인을 모두 통과해야 최신 39행 dry-run이 가능하다.
   금융 쓰기 승인은 별도 원본·원천·수정안 binding으로만 받는다. 적용 직전 다시 drain을 검사한다.
   전체 ScriptLock을 유지한 승인된 복구만 내부 계산기를 호출할 수 있고 외부 일반 진입은 계속 거부된다.
7. F00001 기존 단일 행 G:K만 수정하고 전체 백업/readback, 타 38행·다른 날짜·원천,
   F00002 입력대기 경고 보존을 확인한다. 금융 쓰기는 이번 PR에서 실행하지 않는다.
8. 승인 capability를 모두 소비/폐기한 후 `issue507ResumeWriters_()`로 OPEN 복귀한다.
   실패 때에도 gate를 자동 OPEN으로 바꾸지 않는다. 복구/재개 승인은 결과를 보고 결정한다.

종료 증빙의 UNACKED/ACKED 소유권·삭제 순서는 [completion-protocol.md](completion-protocol.md)를 따른다.

## Process API 403 대안과 실패 처리

- 기존 Process API audit의 `PROCESS_API_ACCESS_DENIED`/`workerExecutionVerified=false`를 바꾸지 않는다.
- 신규 계측 실행은 공유 receipt와 finally 종료 증거로 판정하므로 `script.processes` 권한이 없어도
  정상 drain을 증명할 수 있다. 증빙 범위는 계측 소스만이며 기존 worker 성공 여부와 별개다.
- 종료 receipt는 실행별 단일 소유 key에 ScriptLock 없이 먼저 저장하고 readback한다. 장시간 금융 잠금과 분리되며 cleanup이 1초 내 잠금을 얻지 못해도 이미 검증된 종료 증빙과 생산 반환값을 보존한다. 다음 admission/begin/drain이 잠금 안에서 token/release/name/start/end 일치를 확인해 active를 정리한 뒤 capacity/drain을 판정한다. 증빙 없는 실행은 정리하지 않는다.
- 일반 진입·제어는 30초 잠금 대기다. cleanup write 실패는 종료 증빙을 보존하고 재조정하며, 완료 본문은 재실행하지 않는다. invalid proof/실제 종료 증빙 저장 실패는 차단한다.
- 강제종료/쓰기실패/receipt readback 오류는 active 기록을 남겨 적용을 차단한다. 만료만으로 지우지 않는다.
  Process API 오류를 근거로 성공/종료 처리하지 않는다. 누락된 finally의 종료 증거를 별도로 확보하지
  못하면 적용 불가/운영 재개 보류로 보고한다. 별도 승인·증빙을 갖춘 복구 전에는 활성 기록을 삭제하지 않는다.
- 승인 전에는 metadata 설정·native 백업·운영 진단조차 실제 실행하지 않는다.

## 검증 범위

원본 555개 함수의 wrapper 거부를 전수 실행, 생산 doPost/handleRefreshFundValuations 진입,
외부조회 중 다른 실행의 drain 전환, 종료 receipt, hardkill 무만료, 중첩 잠금, 반복 begin,
비계측 증빙 누락/403/비종료, 승인 잔존 시 재개 차단을 검사한다.
생성 후보의 실제 계산기·복구 함수와 합성 Sheet adapter를 연결해 단건 수정/타 38행/F00002 경고
보존을 검증한다. 실제 운영 설치·권한·배포·원본 재검산·복구 성공은 미검증이다.
