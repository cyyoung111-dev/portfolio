# GAS 9.298 NH 금융소득 읽기 전용 릴리스

- 9.297 운영을 부모로 고정. 9.298 전체 조합 소스 Git blob: `0674f15661314131e4bd16ea4c161d03227839bf` (PR #1379 CI #44322677085).
- 기존 승인된 수동 배포 경로만 사용. 먼저 GAS inventory 및 idle Writer Gate/거래원장 PC·물리 해시 대사, 이후 dry-run. 동일한 검증을 실제 배포에서도 수행.
- 실제 배포 후 9.298 운영 버전/원장/Writer Gate 재대사. 코드는 기존 롤백 경로를 사용. NH 실조회는 배포 검증과 별도 단계로 단 한 번 호출하며 기존 유효 토큰만 사용한다.
- NH 실조회가 미완료되더라도 이를 배포 실패로 오인하거나 쓰기 재시도를 하지 않는다. 기존 NH 자동 활성화는 이 버전에서 호출하지 않는다.
- 계좌별 샘플 첫 페이지/최근 30일만 확인. 연간 이자·세제 유형·세전/세후·분리과세 확정 자료가 아니다. 결과 0건은 연간 0원이 아니다.
- 금융 원본/토큰/식별정보를 기록하거나 변경하지 않는다.

- 수동 dispatch 연결 제한을 해소하기 위해 기존 inventory workflow의 자체 파일이 main에 변경된 최초 push에서만 동일한 읽기 전용 preflight와 9.298 dry-run을 실행. 실제 배포 승인값은 false 고정, 기존 수동 실배포 절차는 그대로 유지. 스케줄 추가 없음. 기존 inventory workflow 수동 실행은 inventory만 수행.

- 11/18 23:41 KST, 읽기 전용 자동 실행 44326887105은 GAS REST 인벤토리 단계에서 NETWORK_UNVERIFIED로 중단. 배포 0, 금융 쓰기 0, dry-run 미실행. 모든 인벤토리 GET에서 공유하는 통신 오류 재시도 1회만 추가하며 HTTP·인증·JSON·스키마 실패는 기존처럼 차단. 이 변경 자체의 main 최초 push에서만 읽기 전용 재검증.

- 11/18 23:53 KST run 44328928086: 배포 inventory 전체 검증 성공(추가 경로 0, 운영 exact reviewed source 1), 활성 Writer 감지 `GAS9295_READONLY_WRITER_ACTIVE`로 사전검증 종료. 활성 Writer를 해제하거나 원장 재수집하지 않음. 이 단계의 금융데이터 오류는 확인되지 않음.
- 후속 운영 개선: 이 기존 읽기 전용 workflow는 최초 main push 및 명시적 실패 job 재실행(총 3회 한도)에 한해 전체 사전검증을 수행. 매 실행 현재 main SHA를 먼저 확인하고 동일 실행에서 inventory 및 Writer Gate/원장 해시 증명 요구. 별도 `verify_9298` 수동 입력 기본 false(기존 inventory 동작 유지). 활성 Writer 실패는 내부 자동 재시도하지 않으며 운영 배포 승인 false 고정. 스케줄 및 자동 실배포 없음.

- 11/19 00:01~00:04 KST run 44330574170 attempts 1/2: inventory와 Writer idle 검사 통과 후 자동화 상태 검사 `AUTOMATION_NOT_STABLE`에서 중단. 원인 자체는 아직 미확정. 추가 GAS 요청 없이 기존 상태 응답에서 마감 단계·기대/실제 날짜·펀드 오류 분류·백필 오류 분류만 allowlist 형태로 기록. 배포 차단 조건은 변경하지 않음. 기존 deploy-gas.mjs의 9.298 post-readback 재대사가 이미 실행 경로에 포함되어 있으므로 별도 중복 호출하지 않는다.
