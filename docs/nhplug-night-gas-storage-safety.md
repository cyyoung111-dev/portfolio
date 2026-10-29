# NH PLUG 야간선물 GAS 저장 안전성 사전 계약

**상태: 모의 GAS Sheet/LockService 어댑터에서 실행하는 테스트. 운영 GAS 코드에 연결되지 않음.**

## 검증 목표

- 기존 buildNightReference의 거래일·야간세션·월물·가격 및 비공식 참고값 검증을 재사용
- 별도 NH 전용 저장소에서 ScriptLock tryLock(5000) 성공 시에만 쓰기 수행
- 동일 storageKey를 기준으로 1행 append 또는 1행 replace, 이전 데이터 역행·중복 방지
- 저장 결과는 listRows() readback에서 정확한 값과 유일성을 확인한 후에만 *_CONFIRMED 표시
- 쓰기 성공 후 응답 유실, 중복 재시도, readback 실패, 잠금 충돌 및 해제 실패, 불량 행·복수 월물 검증
- Telegram용 읽기는 날짜·기준시각을 확인한 단일 계약만 참고값으로 반환. 공식 KRX 정산가로 승격하지 않음

## 실 GAS에 연결하기 위한 미완료 조건

1. NHPLUG_NIGHT_OBSERVATIONS 전용 시트 스키마·헤더를 고정하고 해당 시트 이외의 금융 데이터 쓰기 금지
2. GAS LockService.getScriptLock() 및 시트의 1부터 시작하는 행 번호를 정확하게 매핑하는 어댑터 구현
3. 전용 시트의 append/replace/재조회 성능과 GAS 타임아웃, 50,000행 상한을 점검
4. 쓰기 이후 readback 불명확 시 중복 재시도하지 않고 보류하며 후속 실행에서 storageKey를 먼저 재검증
5. 06:30 NH 실제 야간시세 응답의 근월물·날짜·마지막체결 신뢰성과 07:30 Telegram cutoff를 검증
6. 최신 Codex 독립 리뷰, 사용자 승인 후에만 GAS 및 예약 워크플로로 연결하고 운영 실증

**주의:** 이 계약의 *_CONFIRMED는 오직 합성 모의 저장소의 읽기 검증을 의미합니다. GAS 실저장이나 NH 실제 가격 조회가 완료되었다는 뜻이 아닙니다.
