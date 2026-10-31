# 종료 증빙 프로토콜 설계 재검토

장기 ScriptLock과 receipt 90초 재시도만으로는 정상 완료가 active에 누적됐다(P1).
잠금과 분리한 ENDED 증빙도 collector가 producer readback 이전에 지우면 정상 반환값이 유실됐다(P2).
두 번의 같은 계열 지적에 따라 국소 재시도 패치를 멈추고 ownership·단계·테스트 오라클을 아래처럼 재정의했다.

| 단계 | 작성자 | collector 권한 | 삭제 조건 |
|---|---|---|---|
| ACTIVE | admission의 ScriptLock | active 보존 | 시간 경과로 삭제 금지 |
| ENDED/UNACKED | 해당 실행만 단일 소유 key에 저장 | 정확한 release/token/name/start/end 검증 후 active 완료 가능 | **삭제 금지**, producer가 아직 readback 중일 수 있음 |
| ENDED/ACKED | producer가 자기 증빙의 정확한 readback을 완료한 뒤 기록 | active가 없는 동일 release의 증빙만 GC | ACKED일 때만 삭제; producer는 ACK write 후 다시 readback하지 않음 |

producer가 종료 증빙을 저장하는 시점은 실제 본문과 내부 finally가 끝난 이후다. ENDED는 업무 성공 표식이 아니다.
collector는 active 제거를 먼저 persist/readback하고 이후 ACKED 증빙만 지운다.
완료 history 8건을 벗어난 ACKED orphan도 Properties의 해당 전용 prefix만 검사해 정리한다.
다른 실행이 producer의 UNACKED 증빙을 삭제하지 않으므로 set/readback 사이 경합에서도 원래 반환값을 보존한다.
ACK write 직후 다른 실행이 GC하더라도 producer는 ACK를 재조회하지 않으므로 이를 실패로 오인하지 않는다.

종료 증빙 자체 저장/readback 실패는 차단한다. ACK 실패는 증빙을 UNACKED로 보존하고 경보한다.
UNACKED hardkill orphan은 자동 만료하지 않으며, 별도 종료 증빙 검증/운영 정리 전까지 보존한다.
ACKED GC/cleanup 실패는 다음 admission/begin/drain에서 재조정한다. 이미 완료된 금융 본문은 재실행하지 않는다.
Properties 전체 값은 prefix 필터에만 사용하고 반환/로그/외부 전송하지 않는다.

테스트는 두 LIVE VM이 공유 Properties를 사용하고, producer set/readback 사이에 다른 VM의 40회 완료를 끼워 넣어 8건 history 경계를 넘긴다.
그 후 ACK set 직후에도 collector가 증빙을 삭제하게 하여 두 interleaving 모두 정상 today() 반환과 active/end 잔존 0을 검증한다.
UNACKED GC를 허용하는 변이 소스는 동일 interleaving에서 readback 오류가 발생해야 한다.
장기 금융 잠금 cleanup 경합 30회, invalid proof, metadata 실패, 강제종료 미만료 및 39행/F00002 보존 검증도 유지한다.
