# Issue #860 읽기 전용 재감사 + v9.282 dry-run

이 절차는 배포 승인이 아니다. #826 17:00 발송, #734 금융 원본,
GAS 운영 코드·트리거·보관 배포를 변경하지 않는다.

## 사용자 실행

PR이 main에 병합된 뒤 다음 화면을 연다.

https://github.com/cyyoung111-dev/portfolio/actions/workflows/issue860-readonly-9282-dryrun.yml

1. **Run workflow**를 누른다.
2. **Use workflow from: main**을 선택한다.
3. 입력란은 없다. `dry_run=true`, `approve_9282=false`, `approve_9283=false`가 고정된다.
4. **Run workflow**를 한 번 누른다. 보호 환경 승인이 표시되면 이 읽기 전용 실행의 승인인지 확인한다.
5. 실행의 **Summary**와 마지막 단계의 JSON 결과를 확인한다.

과거 실행의 Re-run은 사용하지 않는다. main이 바뀌면 `GAS_RELEASE_STALE_COMMIT`
검사로 차단되므로 위 화면에서 새로운 실행을 만든다.
반복 클릭은 금융 중복 쓰기를 만들지 않는다. 다만 GitHub 동일 concurrency 그룹은
대기 실행을 교체할 수 있으므로 한 번만 실행하고 완료를 기다린다.

## 판정

- `BLOCKED`: 감사는 차단 사유를 유지한다. `dryRun.dryRun=true`이면 dry-run은 별도로 완료됐다.
  보관 v335 설명 힌트는 신원 확인이 아니며, v9.281 소스도 writer 격리 증명이 아니다.
- `UNVERIFIED` 또는 단계 실패: 인증·조회·main 일치 등 검증 미완료. 실패를 운영 변경으로 해결하지 않는다.
- `READ_ONLY_CHECKS_PASSED`: 조회와 dry-run 검사만 통과. 배포·writer 전환 승인이나 운영 정상화 증거가 아니다.

`BLOCKED`/`UNVERIFIED`는 실행을 실패 상태로 끝낸다. Summary의 감사 결과와
dry-run 결과를 각각 확인한다. 인증 등으로 Summary가 없으면 고정 오류 코드와 단계 실패를 확인한다.
어느 결과에서도 `releaseAuthorized=false`, `firstWriterGateCutoverVerified=false`를 유지한다.

## 안전 경계와 검증 범위

- main의 수동 실행만 허용하며 실행 SHA를 고정하고 시작·종료 시 최신 main과 대조한다.
- 기존 배포/감사의 `gas-production-deploy` 잠금을 공유한다. 이미 실행 중인 작업을 취소하지 않는다.
  이 잠금은 GAS 내부 트리거나 외부 writer 종료를 증명하지 않는다.
- 기존 인벤토리와 `deploy()` dry-run을 재사용한다. 기존 운영 스크립트와 GAS 소스는 변경하지 않는다.
- 별도 통신 제한으로 해당 프로젝트의 content/deployments GET, GitHub main ref GET,
  OAuth 토큰 갱신 POST만 허용한다. 리디렉션은 거부한다.
- GAS content PUT/버전 POST/배포 PUT·DELETE, scripts.run, 웹앱 호출, Sheets,
  Telegram은 전송 전에 거부된다. 원본 데이터·소스 응답·인증정보를 결과에 저장하지 않는다.
- 웹앱 토큰과 Telegram 자격증명은 전달하지 않는다. 인증·소스·배포 대상 메타데이터를
  검증하며 실제 웹앱 인증/E2E·실행 중 writer 종료·v335 ID 동일성은 별도 미검증이다.
- 최초 writer gate 차단(`GAS_FIRST_GATE_CUTOVER_UNVERIFIED`)은 변경하지 않는다.
  운영 배포와 Issue 종료에는 별도 증거·승인이 필요하다.
