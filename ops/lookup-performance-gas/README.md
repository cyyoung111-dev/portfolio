> **운영 방향 변경(2026-11-03):** 이 문서는 기존 금융 GAS v9.282에 직접 통합하는 미배포 후보의 기록입니다. 실제 사용 예정 수집기는 PR #900에서 생성한 **별도 Google Apps Script 프로젝트**이며, 금융 GAS나 Google Sheets를 건드리지 않고 ScriptProperties만 사용합니다. 자세한 사용법은 [독립 성능 GAS](../performance-standalone-gas/README.md)를 참고하십시오. 이 구형 후보를 운영 GAS에 배포하지 마십시오.

# 기존 GAS·Google Sheets만 사용하는 조회시간 진단

Cloudflare Worker/D1을 사용하지 않습니다. 이 모듈은 **현재 금융 GAS v9.281의 운영 배포를 건드리지 않는 통합 후보**입니다. 새 계정은 필요 없으나, 기존 GAS 프로젝트에 안전하게 새 동작을 배포하는 과정은 여전히 필요합니다.

## 웹 동작
- `외부연동 → PC·모바일 조회시간 자동 진단`에서 **수집 시작·연결 확인**을 선택하면 기존 GAS 연결과 접근 토큰으로 `getPerformanceSummary` 지원을 검사합니다. 현재 GAS에 API가 없으면 활성화하지 않습니다.
- 지원 확인 후 기기별로 동의가 저장되고, 25초 후 최대 8개 샘플씩 **가장 낮은 우선순위**로 POST `appendPerformanceMetrics`를 호출합니다. 금융 데이터 조회 실패/지연/중단과 독립입니다.
- PC·모바일 비교 버튼을 누르면 최근 7일 각 구간의 건수·중앙값·p95·실패율이 표시됩니다.
- 전송 대기는 메모리 40건으로 제한하며 URL, 종목코드, 계좌·거래·평가액, 인증 토큰, 사용자를 식별할 키를 측정 데이터로 저장하지 않습니다. 전송 중지 시 대기 기록 삭제.
- 이전 Cloudflare URL/동의/대기열은 접속 시 로컬에서 삭제합니다. 외부 서비스 가입이나 GitHub Secrets 추가가 필요 없습니다.

## GAS 통합 계약 및 운영 안전

1. `collector.gs`는 성능 수집 전용 **검토 후보**입니다. `src/gas/apps_script.gs`의 v9.282 해시를 임의 변경하거나 운영에 배포하지 않습니다.
2. Issue [#860](https://github.com/cyyoung111-dev/portfolio/issues/860)의 GAS v9.281 → v9.282 안전 전환·writer gate·다중 배포 검증이 먼저 통과해야 합니다.
3. 승인된 후속 GAS 릴리스 PR에서 기존 `apps_script.gs`에 `collector.gs` 본문을 통합하고, 기존 `doPost` **`_isAuthorizedRequest(params)` 검사 직후** 두 동작을 추가합니다.

```js
if (params.action === 'appendPerformanceMetrics') return handleAppendPerformanceMetrics(params);
if (params.action === 'getPerformanceSummary') return handleGetPerformanceSummary(params);
```

4. 기존 `doGet`에도 다음 POST 전용 거부 규칙을 추가하여, 액세스 토큰이 URL에 기록되지 않도록 합니다.

```js
if (params.action === 'appendPerformanceMetrics' || params.action === 'getPerformanceSummary') return jsonError('POST_ONLY');
```

5. 테스트는 `node scripts/check-performance-collector.mjs` 입니다. **GAS 게시 코드에 위 두 라우팅이 실제 추가되기 전까지 웹 버튼은 미지원 상태**입니다.
6. `getPerformanceSummary`는 인증된 POST 요청만 받아 금융 자료 없이 통계만 반환합니다. `appendPerformanceMetrics`는 기존 GAS `access_token`의 길이 24자 이상·일치 조건을 요구하므로 익명 호환 모드에서는 기록하지 않습니다.
7. 별도 `PERFORMANCE_LOG` 시트만 새로 만들며, 기존 동일 이름의 시트 헤더가 다르면 즉시 중단합니다. 기록은 일 240개 제한, 최대 2,000행 및 접수 시 7일 초과 데이터 정리(접수가 없다면 미자동 삭제). 금전 원장/평가/Snapshot/NH/텔레그램 시트에는 쓰지 않습니다. 금융 writer가 lock 사용 중이면 **성능 로그를 포기**하고 요청을 지연시키지 않습니다.

## 주의할 점

- **이 PR의 웹 코드 병합은 자동 수집 가동 완료를 뜻하지 않습니다.** 신규 API가 실제 GAS에 안전 배포되고 기기별 수집 시작이 수행되어야 합니다.
- 이전 Cloudflare 기반 GitHub 집계 워크플로는 제거합니다. 별도 계정이나 비밀키 추가 요구를 없앤 대신, 집계는 포트폴리오의 외부연동 화면 또는 기존 Google Sheets에서 확인합니다. Assistant가 원장을 직접 읽으려면 해당 Google Sheet에 연결 권한이 있어야 합니다.
- 가용성 평가와 금전 데이터 무결성을 우선하며, 성능 측정을 이유로 GAS 자동 배포·writer gate 해제·Snapshot 변경을 시도하지 않습니다.
