// ════════════════════════════════════════════════════════════════════
//  📊 포트폴리오 대시보드 — Google Apps Script  v9.180
//
//  v9.180 변경사항 (2026.10.07):
//   19시 통합 마감 시작·단계·오류를 선행 기록하여 미완료/시간초과를 NEVER_RUN과 구분
//   KRX 시장별 HTTP/응답행 수 진단(인증키 비노출) 및 국내 공식 종가 최신 날짜 분리
//
//  v9.179 변경사항 (2026.10.07):
//   일일 마감 KRX 종가 조회·검증을 평가일 거래원장의 실제 보유 종목으로 제한
//   매도 완료·폐지 종목이 마스터에 남아도 신규 종가 부족으로 잘못 실패하지 않음
//
//  v9.178 변경사항 (2026.10.07):
//   신규 KRX 종가 0건·오래됨·시장 부분 누락 시 펀드 NAV 날짜를 마감 성공으로 오인하지 않음
//   KRX 실제 거래일 기준 스냅샷 확정 및 KB S-T FunETF 누락 공시일 기간 조회 최적화
//   한화 펀드의 기존 startDate 조회 경계는 유지
//
//  v9.177 변경사항 (2026.10.07):
//   손익 그래프 원자료(거래·확정가격·펀드 NAV·환율) read-only 계산으로 전환
//   펀드 비공시/원천 누락일에 직전 공시 NAV와 해당일 좌수로 재계산, 미래 NAV 사용 차단
//   Snapshot 오류와 독립적으로 손익 조회, 미확인 가격은 원가 대체 없이 건너뛰고 진단
//
//  v9.176 변경사항 (2026.10.07):
//   손익 Snapshot 충돌 분류 요약과 Toss/KRX 현재가 provider 실행 상태 노출
//
//  v9.175 변경사항 (2026.10.07):
//   통합 마감 트리거의 레거시/중복 잔존까지 일일 자동 점검에서 복구
//   Snapshot 최근일을 0좌 lifecycle 제외 후 유효 행 기준으로 계산
//   Snapshot stale 기준을 달력상 전 평일이 아닌 실제 확정 가격일 기준으로 판정
//
//  v9.174 변경사항 (2026.10.07):
//   통합 마감 미실행 시 NEVER_RUN을 우선 표시하고 과거 펀드 오류는 참고 정보로만 노출
//
//  v9.173 변경사항 (2026.10.06):
//   웹에서 자동화 상태를 read-only 조회하는 getAutomationStatus API 추가
//   통합 마감 트리거·최근 실행·Snapshot/가격이력·펀드 결과를 단일 상태 객체로 제공
//
//  v9.172 변경사항 (2026.10.06):
//   19시 통합 마감에서 일반 종목 확정가·Snapshot → 펀드 NAV/평가를 순차 자동 실행
//   기존 16:20 일반 종목/19시 펀드 분리 트리거를 통합 마감 트리거 1개로 마이그레이션
//   일반 종목 단계 실패 시에도 펀드 단계를 계속 시도하고 통합 결과·오류를 Script Properties에 기록
//   v9.172 테스트 스텁 보정 후 GAS 배포 validation 재실행
//
//  v9.171 변경사항 (2026.10.06):
//   F00002 exact standard-code NAV 자동조회 및 19시 펀드 트리거 공통 자동복구
//   펀드 자동실행 partial 결과를 경고로 보존하고 hard error만 실패 처리
//   펀드좌수 0 전환일 이후 F코드를 정상/기간 Snapshot 계산에서 제외
//   Snapshot 날짜 유실 행·0좌 펀드 잔존 행을 안전정리 경로에서 제거
//   자동화 상태 점검에 펀드 최근 처리일·warning·error 표시
//   펀드 갱신 Snapshot 병합·완전성 검사에도 0좌 lifecycle 적용
//   일일 펀드 결과는 Script Properties 한도에 맞게 날짜 상세를 제외한 compact summary 저장
//   0좌 펀드는 MANUAL Snapshot 보호보다 lifecycle 제거를 우선 적용
//   신규/헤더-only Snapshot에도 write 전 0좌 lifecycle 적용, no-op 일일 실행도 처리 기준일 보존
//   lifecycle로 제거된 원장 행은 signature 동일 여부와 무관하게 rewrite 사유로 처리
//   수동 NAV import 완전성 검사도 0좌 fund lifecycle을 동일하게 적용
//   빈 기대 결과의 일일 재작성·전체 정합성 복구에서도 0좌 Snapshot 제거를 수행
//   수동 복구·소급채우기 0좌-only 날짜도 빈 Snapshot으로 정리하고 NO_SNAPSHOT(0/0)을 정상으로 인정
//   손익 히스토리/상세 조회도 0좌 Snapshot을 즉시 제외해 정리 전 과대평가 방지
//   0좌 행만 남은 날짜는 Snapshot 존재로 보지 않고 정상 재생성 시도
//   기존 Snapshot이 있는 수동 import도 날짜 전체를 lifecycle 기준으로 재작성
//   전체 트리거 재등록 시 기존 19시 펀드 트리거를 삭제 후 1개로 재생성
//   보호된 Snapshot 충돌은 hard failure가 아니라 fund_last_warning으로 기록
//   수동 복구·소급채우기·펀드 보유현황에도 동일한 0좌 lifecycle 적용
//
//  v9.170 변경사항 (2026.10.06):
//   검증된 v2 성공백업이 생성되면 더 오래된 legacy COMPLETED 백업을 schema/formula 검증 후 정리
//   성공한 system backup의 steady state 0개 정책은 유지
//
//  v9.169 변경사항 (2026.10.06):
//   백업 원본/실제 backup signature 분리 저장으로 copyTo 재계산 mismatch 재발 방지
//   Toss OAuth token single-flight 및 resource 401 1회 자동복구
//
//  v9.168 변경사항 (2026.10.06):
//   백업 진단의 포괄적 '안전 조건 불충족'을 signature/registry 상태 등으로 세분화
//
//  v9.167 변경사항 (2026.10.06):
//   Toss egress 진단 IPv4/IPv6 식별 및 address family 표시
//   백업 진단 팝업에 보존 사유 집계·대표 시트명 표시
//
//  v9.166 변경사항 (2026.10.06):
//   Toss egress IPv4 관측 provider fallback·비민감 실패 메타데이터 보강
//
//  v9.165 변경사항 (2026.10.06):
//   백업 진단 서명 중복 읽기 제거·백업 대상 수식 스캔 및 source 헤더 재사용
//
//  v9.164 변경사항 (2026.10.06):
//   Toss egress IPv4 probe 응답을 plain-text/JSON 모두 허용하도록 보강
//
//  v9.163 변경사항 (2026.10.06):
//   Toss read-only 진단에 외부 관측 GAS egress IPv4 probe 추가
//
//  v9.162 변경사항 (2026.10.06):
//   Toss OAuth/market 진단에 비민감 요청 식별자(request/reference/edge ID) 표시 보강
//
//  v9.161 변경사항 (2026.10.06):
//   메뉴 진단/실행 분리·버전업 안내·초기화 이중 확인 및 위험 구역 분리
//
//  v9.160 변경사항 (2026.10.03):
//   current COMPLETED backup 검증 선행·stale rollback 보호 강화
//
//  v9.159 변경사항 (2026.10.03):
//   Snapshot 중복 기준·Toss OAuth/smoke 의미 진단·성공 후 stale system backup 정리
//
//  v9.158 변경사항 (2026.10.02):
//   backfill 연관 write 후 최종 Snapshot VALID 검증
//
//  v9.157 변경사항 (2026.10.02):
//   Snapshot 최종 검증 lifecycle·거래 rebuild 부분 실패·MANUAL exact duplicate 보강
//
//  v9.156 변경사항 (2026.10.02):
//   operation backup cleanup 직전 content signature 재검증
//
//  v9.155 변경사항 (2026.10.02):
//   expected 없는 exact duplicate 축약·operation backup signature 검증
//
//  v9.154 변경사항 (2026.10.02):
//   validated cleanup operation 범위·capacity cleanup signature 보호
//
//  v9.153 변경사항 (2026.10.02):
//   Snapshot duplicate cleanup read-back 유효행 기준 대칭화
//
//  v9.152 변경사항 (2026.10.02):
//   validated recovery cleanup을 Snapshot source로 격리
//
//  v9.151 변경사항 (2026.10.02):
//   Snapshot backup provenance·validated recovery·caller 보호 상태 보강
//
//  v9.150 변경사항 (2026.10.02):
//   multi-date Snapshot operation backup을 최종 성공 시에만 완료·정리
//
//  v9.149 변경사항 (2026.10.01):
//   raw Snapshot 충돌 공통 판정·재검증 및 성공한 system backup 즉시 정리
//
//  v9.148 변경사항 (2026.10.01):
//   history summary cache·retry 실패 화면 폐기·대표행 tie-break 보강
//
//  v9.147 변경사항 (2026.10.01):
//   history 진단 revision 일치 보장·펀드 대표 source 순위 통일
//
//  v9.146 변경사항 (2026.10.01):
//   tracked source 구조 변경·trigger lifecycle 보호 보강
//
//  v9.145 변경사항 (2026.10.01):
//   Snapshot integrity migration revision 정수 보장
//
//  v9.144 변경사항 (2026.10.01):
//   시트 구조 변경 invalidation·초기 cache 보호·좌수 editor session 초기화
//
//  v9.143 변경사항 (2026.10.01):
//   revision property 크기·legacy migration·onEdit old/new·펀드 legacy 코드 보강
//
//  v9.142 변경사항 (2026.10.01):
//   정합성 cache 날짜·영향범위 invalidation 및 write 후 revision 확정
//
//  v9.141 변경사항 (2026.09.30):
//   Snapshot cache 무효화·가격 이상 보호·펀드 복구 상태/UI 보강
//
//  v9.140 변경사항 (2026.09.30):
//   Snapshot 정합성 원자료 revision으로 브라우저 진단 캐시 무효화 보강
//
//  v9.139 변경사항 (2026.09.30):
//   손익 정합성 상태 분리·증분 검증 캐시 및 펀드 좌수 초기 조회 경량화
//
//  v9.138 변경사항 (2026.09.29):
//   브리핑용 삼성전자·SK하이닉스 exact-date KRX 공식 종가 read-only 조회
//
//  v9.137 변경사항 (2026.09.29):
//   KRX 실제 ISU_NM 형식의 KOSPI200 야간선물 일별 종가 조회 및 headless 브리핑 연결
//
//  v9.136 변경사항 (2026.09.29):
//   KRX 공식 대표지수 조회 실패를 보조 provider 결과와 격리
//
//  v9.135 변경사항 (2026.09.29):
//   16시 이후 KRX 공식 exact-date KOSPI/KOSDAQ 종가 연결
//
//  v9.134 변경사항 (2026.09.29):
//   Toss 지수 fresh와 미검증 종가를 분리하고 provider timestamp 보존
//
//  v9.133 변경사항 (2026.09.29):
//   마감 브리핑 국내지수 fresh close 조회와 cache 분리
//
//  v9.132 변경사항 (2026.09.29):
//   MARKET_MASTER에 currency/source_date/fallback metadata를 호환 확장
//
//  v9.131 변경사항 (2026.09.28):
//   기간 Snapshot 진단의 원장 index·증분 holdings와 단계별 오류 관측성 추가
//
//  v9.130 변경사항 (2026.09.28):
//   가격이력 독립 정합성 진단·preview/apply 복구와 단일 read 기간 Snapshot 진단 추가
//
//  v9.129 변경사항 (2026.09.28):
//   기간 Snapshot 정합성 진단·웹 안전 복구 및 전체 시스템 백업 dry-run/apply 유지보수 추가
//
//  v9.128 변경사항 (2026.09.28):
//   Snapshot 원자료 정합성 진단·안전 재작성 및 재사용/유실 백업 수명주기 보강
//
//  v9.127 변경사항 (2026.09.28):
//   펀드 복구 timeout 저장상태 재검증 및 정상 비공시일 API 오류 격리
//
//  v9.126 변경사항 (2026.09.23):
//   해외 확정 종가·INDICATIVE 저장 차단·백업 재사용·NAV 중복 판정 보강
//
//  v9.125 변경사항 (2026.09.23):
//   운영 원본별 백업 보호·종목코드 텍스트 보존·확정 NAV 경고 정합성 보강
//
//  v9.124 변경사항 (2026.09.23):
//   작업 단위 Snapshot 백업·과거 거래 영향 재계산·확정 종가 출처 보강
//
//  v9.123 변경사항 (2026.09.23):
//   검증된 시스템 백업 자동 보존·정리 및 펀드 날짜별 처리 결과 추가
//
//  v9.122 변경사항 (2026.09.23):
//   스냅샷 백업 중복 방지·셀 점유 진단·승인 전 백업 보관 준비 기능 추가
//
//  v9.121 변경사항 (2026.09.22):
//   펀드 NAV 행 확장 전 빈 초과 열 회수 및 실제 저장 단계별 결과 반환
//
//  v9.120 변경사항 (2026.09.22):
//   펀드 NAV import의 반복 백업 시트·전체 범위 재쓰기를 증분 저장으로 교체
//
//  v9.119 변경사항 (2026.09.22):
//   펀드 NAV import 값 백업 및 부분 저장 재실행 진단 보강
//
//  v9.118 변경사항 (2026.09.21):
//   펀드 NAV 증분 처리·누락 현황 조회·완료 날짜 재계산 생략
//
//  v9.117 변경사항 (2026.09.21):
//   한화 NAV 조회 시작일 경계 보정 및 스냅샷 값 백업 호환성 개선
//
//  v9.116 변경사항 (2026.09.21):
//   MARKET_MASTER timestamp 신뢰경계 보강 및 MARKET_SNAPSHOTS 불변 저장·조회 추가
//
//  v9.115 변경사항 (2026.09.18):
//   MARKET_MASTER 관측 원장을 GAS 시트에 append-only 저장/조회하는 인증 API 추가
//
//  v9.114 변경사항 (2026.09.18):
//   KOSPI200 Yahoo ^KS200 보조 EOD provider 연결
//
//  v9.113 변경사항 (2026.09.18):
//   기존 환율이력 시트의 USD/KRW 실제 날짜별 조회 API 추가
//
//  v9.112 변경사항 (2026.09.18):
//   SOX/VIX를 benchmark 허용 map에 추가해 getBenchmarks 실제 요청 경로 연결
//
//  v9.111 변경사항 (2026.09.18):
//   장전 브리핑 SOX/VIX Yahoo 확정 일봉 provider mapping 추가
//
//  v9.110 변경사항 (2026.09.17):
//   getPrices 단계별 저비용 timing metadata·최근 확정 이력 fallback 종목 상세 추가
//
//  v9.109 변경사항 (2026.09.17):
//   원자료 기반 일별 Snapshot 재생성 날짜집합·펀드 NAV carry-forward·거래 Corporate Action 보강
//
//  v9.107 변경사항 (2026.09.16):
//   Toss Open API OAuth 토큰 캐시·429 재시도·현재가 batch·adjusted=false 일봉 우선 연결

//  v9.106 변경사항 (2026.09.16):
//   F00001 월·목 비공시일 제외, 직전 NAV 임시 스냅샷·NAV 입력 필요 표시, 펀드별 복구
//
//  v9.105 변경사항 (2026.09.15):
//   펀드 복구 요청의 단계별 시간·예외 위치를 선택적 진단 로그로 계측
//
//  v9.104 변경사항 (2026.09.15):
//   동일 NAV 재실행 파생 복구, 공시일 정정 carry-forward 영향구간 재계산, 오류 상태 보존
//
//  v9.102 변경사항 (2026.09.14):
//   한화 dailyPrice 실제 응답의 wkdate/price 필드로 확정 NAV 파싱
//
//  v9.101 변경사항 (2026.09.14):
//   한화 dailyPrice 응답 필드 확인 및 복구 요청 크기 보정
//
//  v9.100 변경사항 (2026.09.14):
//   한화 NAV 조회·파싱·계산 중 ScriptLock 제거, 시트 쓰기 구간만 잠금
//   한화 wktdate를 전용 parser로 정규화하고 잘못된 원문 값을 오류에 표시
//
//  v9.99 변경사항 (2026.09.14):
//   이전 평가일 carry-forward 행을 확정 NAV 공시일로 오인하지 않도록 누락 판정 보정
//
//  v9.98 변경사항 (2026.09.14):
//   저장된 평일 NAV가 충분하면 주말 누락으로 한화 API를 다시 호출하지 않음
//
//  v9.97 변경사항 (2026.09.14):
//   F00001 누락 NAV를 14일 batch·1회 재시도로 조회하고 40일 lookback 제거
//   복구 API를 F코드별로 분리해 F00001 hard timeout에도 F00002/F00003 선처리
//
//  v9.96 변경사항 (2026.09.14):
//   펀드별 실패 격리와 F00002/F00003 저장 NAV 전용 복구 결과 추가
//
//  v9.95 변경사항 (2026.09.11):
//   실제 공시된 NAV 날짜만 확정 가격이력·스냅샷으로 backfill
//   F00001 공통 import 지원과 수동 NAV 동일값·급변·기존값 변경 warning 추가
//
//  v9.94 변경사항 (2026.09.11):
//   웹 표의 '기준가' 열 붙여넣기와 YY.MM.DD 파싱 지원
//   기존 NAV와 다른 수동 기준가는 충돌로 차단하고 기존 데이터 보존
//
//  v9.93 변경사항 (2026.09.11):
//   검증된 import NAV로 기존값을 갱신하고 다음 공시일 전까지 평가를 재계산
//   펀드 가격이력·스냅샷만 NAV×좌수 기준으로 안전하게 갱신
//
//  v9.92 변경사항 (2026.09.11):
//   AQ018/AP399 기간 NAV 파일을 기존 펀드기준가격에 누락분만 안전하게 import
//   GAS 재검증 후 기존 평가·가격이력·스냅샷 경로를 재사용
//
//  v9.91 변경사항 (2026.09.11):
//   기존 정확한 클래스 NAV를 먼저 재사용하고 누락 구간만 lookback 조회
//   평가일 NAV가 없으면 미래 값 없이 직전 NAV를 사용하며 0좌 이후 조회 중단
//
//  v9.90 변경사항 (2026.09.10):
//   한화 C-RPe 공식 NAV만 조회하고 미확정 클래스의 FunETF 대체 조회 제거
//   외부 조회 실패 시 기존 펀드기준가격을 우선 보존·재사용
//
//  v9.89 변경사항 (2026.09.09):
//   펀드 기간 기준가격 조회의 공급자 WAF 403 대응 헤더·원인 메시지 추가
//
//  v9.88 변경사항 (2026.09.09):
//   모든 근거 있는 F코드의 좌수 변경 이력 조회·등록 및 과거 전량매도 종목 평가 지원
//
//  v9.87 변경사항 (2026.09.09):
//   코드별 적용일·좌수로 펀드 평가 자동 저장, 스냅샷 보존 및 쓰기 전 백업
//
//  v9.86 변경사항 (2026.09.08):
//   ✅ [정확성] 과거 환율 이력이 없는 외화 스냅샷 행은 전체 강제 재작성에서 기존 값 보존
//   ✅ [오류]   가격·종목·소스 내부 조회 실패를 강제 재작성 날짜 실패로 전파
//
//  v9.85 변경사항 (2026.09.07):
//   ✅ [속도]   손익 그래프가 열린 동안 웹 요청으로 다음 재작성 배치를 즉시 연속 처리
//   ✅ [정확성] 강제 재작성 시 스냅샷 생성 오류를 빈 보유내역과 구분해 기존 행 오삭제 방지
//
//  v9.84 변경사항 (2026.09.07):
//   ✅ [사용성] 전체 재작성 실행 중 재요청은 잠금 대기 대신 기존 작업 상태를 반환
//
//  v9.83 변경사항 (2026.09.07):
//   ✅ [정합성] 강제 재작성 중 보유자료가 없는 날짜는 기존 스냅샷 행도 삭제
//   ✅ [동시성] 복구 상태 초기화를 Script Lock으로 보호하고 진행 중 중복 시작 거부
//   ✅ [진단]   날짜별 오류는 해당 날짜 재처리 성공 전까지 보존
//
//  v9.82 변경사항 (2026.09.07):
//   ✅ [동시성] 전체 스냅샷 배치 실행 중 트리거를 지워 상태조회가 중복 트리거를 만드는 경쟁상태 제거
//   ✅ [상태]   재시도 성공 후 과거 배치 오류 문구를 정리해 진행 중 오류로 오인하지 않도록 개선
//
//  v9.81 변경사항 (2026.09.07):
//   ✅ [사용성] 손익 그래프에서 전체 가격이력 스냅샷 재작성 시작·진행상황 조회 API 제공
//
//  v9.80 변경사항 (2026.09.04):
//   ✅ [복구]   전체 스냅샷 복구 후속 트리거 유실 시 진행상황 확인 메뉴에서 자동 재예약
//   ✅ [안정성] 배치 자체 오류도 상태에 저장하고 후속 실행을 예약해 점검 완료 정체 방지
//
//  v9.79 변경사항 (2026.09.04):
//   ✅ [정확성] 스냅샷 기준일 가격이 비었고 이전 이력도 없으면 가장 가까운 이후 가격을 사용
//   ✅ [가시성] 손익 MDD가 평가금액 최고일이 아닌 현금흐름 보정 수익률의 고점→저점임을 명시
//
//  v9.78 변경사항 (2026.08.31):
//   ✅ [주담대] 현재월 납입 후 잔액 반영 시 잔여기간은 다음 달 이후 스케줄만 계산
//
//  v9.77 변경사항 (2026.08.28):
//   ✅ [세금] 종목코드 시트에 명시적 시장(KR/US/OTHER) 필드를 저장·복원
//
//  v9.76 변경사항 (2026.08.28):
//   ✅ [사용성] 스프레드시트 메뉴에서 요청 접근 토큰 설정·해제 및 레거시 키 마이그레이션 지원
//   ✅ [진단]   웹 연결 진단도 접근 토큰을 포함한 공용 요청 경로 사용
//
//  v9.75 변경사항 (2026.08.28):
//   ✅ [보안]   API 키 원문을 설정·부트스트랩 응답에서 제거하고 Script Properties 상태만 반환
//   ✅ [보안]   Script Properties의 access_token 설정 시 모든 웹 요청에 opt-in 인증 적용
//   ✅ [마이그레이션] 설정 시트의 레거시 API 키를 Script Properties로 옮기는 관리자 함수 추가
//
//  v9.74 변경사항 (2026.08.27):
//   ✅ [상세조회] 특정일 손익 스냅샷의 종목코드·수량·매입/평가단가·손익·수익률·가격소스 제공
//
//  v9.73 변경사항 (2026.08.25):
//   ✅ [자동화] 웹 평가가격 조회 시 16:20 스냅샷 트리거를 일 1회 점검하고 누락 시 자동 복구
//   ✅ [복구]   60초 가격 캐시 응답에서도 최신 가격이력 날짜의 누락 스냅샷 생성 보장
//
//  v9.72 변경사항 (2026.08.25):
//   ✅ [정확성] KRX가 이전 거래일을 반환해도 더 최신 가격이력이 있으면 웹 평가단가에 최신 이력을 적용
//   ✅ [자동화] 평가가격 갱신과 16:20 자동화가 최신 가격이력 날짜의 누락 스냅샷을 즉시 생성·교정
//   ✅ [성능]   국내 종목만 있는 스냅샷 계산에서는 불필요한 환율 GOOGLEFINANCE 조회 생략
//
//  v9.71 변경사항 (2026.08.24):
//   ✅ [가시성] 평가가격 응답에 KRX·GOOGLEFINANCE 실행/생략·최근이력 보완·GAS 소요시간 포함
//   ✅ [확인]   화면 상태 문구에서 GOOGLEFINANCE 생략 여부와 실제 서버 처리시간 확인 지원
//
//  v9.70 변경사항 (2026.08.24):
//   ✅ [성능]   USD 종목이 없으면 평가가격 갱신의 GOOGLEFINANCE 임시 시트 계산을 생략
//   ✅ [성능]   KRX 조회 직후 GF fallback에서 동일 KRX 시장 조회를 다시 실행하지 않도록 중복 제거
//   ✅ [정확성] 국내 종목은 KRX 결과를 우선 사용하고 누락분은 저장된 최근 가격이력으로 보완
//
//  v9.69 변경사항 (2026.08.20):
//   ✅ [성능]   앱 초기 복원 데이터를 getBootstrap 단일 요청으로 묶어 GAS 왕복과 설정 시트 중복 읽기 제거
//   ✅ [호환]   기존 개별 getSettings/getTrades/getHoldings/getCodeList API는 그대로 유지
//
//  v9.68 변경사항 (2026.08.20):
//   ✅ [성능]   16:20 자동화는 확정 거래일(T-1) 가격을 한 번만 조회하고 해당 스냅샷만 검증
//   ✅ [안정성] 당일 가격 중복조회·최근 2일 반복 재작성을 전체 이력 복구로 분리해 자동 실행 타임아웃 완화
//   ✅ [상태]   자동 생성 성공 시 이전 실패 표시를 정리하고 동일 경로 수동 점검 메뉴 제공
//
//  v9.67 변경사항 (2026.08.20):
//   ✅ [검증]   수동 정합성 복구 대상을 최근 2일이 아닌 전체 가격이력 날짜로 확대
//   ✅ [안정성] 전체 날짜를 소량 배치·시간 트리거로 이어서 처리해 Spreadsheet 타임아웃 방지
//   ✅ [가시성] 전체 복구 진행상황·재작성·일치·자료없음·실패 건수 확인 메뉴 추가
//
//  v9.66 변경사항 (2026.08.20):
//   ✅ [성능]   수동 스냅샷 정합성 복구에서 KRX·GOOGLEFINANCE 재조회와 당일 종가 갱신을 제외
//   ✅ [안정성] 기존 가격이력만으로 최근 2거래일을 재작성해 Spreadsheet 서비스 타임아웃 완화
//
//  v9.65 변경사항 (2026.08.20):
//   ✅ [정확성] 스냅샷 날짜를 실행일이 아닌 실제 확정 종가 거래일(T-1)에 맞춰 저장
//   ✅ [복구]   최근 2개 확정 거래일 스냅샷을 함께 검증해 하루 밀린 기존 자료와 누락일 자동 보완
//   ✅ [정확성] 과거 GOOGLEFINANCE 범위 조회에서 첫 행이 아닌 요청일까지의 마지막 종가 선택
//
//  v9.64 변경사항 (2026.08.19):
//   ✅ [성능]   손익 그래프 비교지수 5개를 단일 GAS 요청·단일 임시 시트로 일괄 조회
//
//  v9.63 변경사항 (2026.08.18):
//   ✅ [자동화] 배당 탭 요청으로 SEIBro ETF를 일 1회 검증·증분 갱신하고 최신 데이터 반환
//
//  v9.62 변경사항 (2026.08.18):
//   ✅ [보호]   구버전 웹의 공공데이터/GF 저장이 SEIBro ETF DIVDATA를 덮어쓰지 않도록 서버 병합
//
//  v9.61 변경사항 (2026.08.18):
//   ✅ [저장]   전체 검증 성공 후 ETF분배금이력과 DIVDATA를 잠금 안에서 함께 증분 갱신
//   ✅ [보존]   기존 이력과 MANUAL 배당 이벤트를 보존하고 실패 시 저장 전 상태로 복구
//
//  v9.60 변경사항 (2026.08.18):
//   ✅ [사용성] 2단계 드라이런 결과를 동적 대상 종목 수에 맞춰 여러 창으로 나누어 모두 표시
//
//  v9.59 변경사항 (2026.08.18):
//   ✅ [드라이런] SEIBro 전체 분배금 행의 TTM 합계와 DIVDATA 증분 병합안을 저장 없이 비교
//   ✅ [사용성]   스프레드시트 메뉴에서 2단계 드라이런을 실행하고 신규·정정·유지 건수 표시
//
//  v9.58 변경사항 (2026.08.18):
//   ✅ [사용성] 스프레드시트 메뉴에서 SEIBro ETF 읽기 전용 진단을 한 번에 실행하고 결과 요약 표시
//
//  v9.57 변경사항 (2026.08.18):
//   ✅ [진단]   보유현황·TTM 거래이력에서 ETF를 동적 선정해 SEIBro 검색·분배금 XML을 읽기 전용 검증
//   ✅ [안전]   diagnoseEtfDividends는 시트와 DIVDATA를 수정하지 않고 종목별 오류 상태와 원문만 반환
//
//  v9.56 변경사항 (2026.08.18):
//   ✅ [복구]   Settings 저장 실패 시 종목코드 시트의 유형·섹터·통화로 기초정보 복원 지원
//
//  v9.55 변경사항 (2026.08.14):
//   ✅ [안정성] 사용 중인 임시 시트를 정리 작업이 삭제하지 않도록 생성시각 기반 만료 정리 적용
//
//  v9.54 변경사항 (2026.08.14):
//   ✅ [버그수정] Settings 저장 시 모든 비고정 행 삭제 오류를 피하도록 내용만 초기화
//
//  v9.53 변경사항 (2026.08.14):
//   ✅ [정리]   응답 지연을 유발하던 SOX 비교지수 및 SOXX 대체 조회 제거
//
//  v9.52 변경사항 (2026.08.14):
//   ✅ [정리]   지수·배당 GOOGLEFINANCE 임시 시트를 요청 종료 시 자동 삭제
//   ✅ [복구]   자동 트리거 등록 시 이전 배포에서 남은 임시 시트를 일괄 삭제
//
//  v9.51 변경사항 (2026.08.14):
//   ✅ [복원력] SOX 지수 조회 실패 시 SOXX ETF 가격으로 자동 대체
//
//  v9.50 변경사항 (2026.08.12):
//   ✅ [지표]   손익 그래프 비교지수에 필라델피아 반도체지수(SOX)를 추가
//
//  v9.49 변경사항 (2026.08.12):
//   ✅ [지표]   손익 그래프 비교지수에 다우존스 산업평균지수(DOW)를 추가
//
//  v9.48 변경사항 (2026.08.03):
//   ✅ [정확성] 실제 데이터 제공 여부를 검증하지 못한 VKOSPI 비교지수 기능 제거
//
//  v9.45 변경사항 (2026.07.31):
//   ✅ [정합성] 일반 설정 저장이 트리거가 갱신한 배당·주담대·부동산 전용 데이터를 덮어쓰지 않도록 병합 저장
//   ✅ [정확성] 소급채우기도 기준일 이하 최근 MANUAL 펀드·TDF 가격을 반영하고 미래 가격 참조 차단
//   ✅ [초기화] GAS 설정 복원 완료 후 현재가를 조회해 최신 조회값이 오래된 설정 캐시에 덮이는 경쟁상태 제거
//   ✅ [최적화] 소급채우기 환율도 실제 보유 외화만 계산
//
//  v9.44 변경사항 (2026.07.31):
//   ✅ [성능]   KOSPI·KOSDAQ·ETF와 최대 7일 fallback KRX 요청을 fetchAll 병렬 처리
//   ✅ [캐시]   동일 종목 현재가 응답을 60초간 GAS CacheService에서 재사용해 중복 조회 제거
//   ✅ [최적화] 요청 종목에 필요한 외화 환율만 GOOGLEFINANCE로 조회
//
//  v9.43 변경사항 (2026.07.31):
//   ✅ [버그수정] getPrices가 정의되지 않은 _updateTodaySnapshotSource()를 호출해 응답이 실패하던 문제 수정
//   ✅ [보호]   오늘 스냅샷의 MANUAL 소스·저장시각은 유지하고 자동조회 종목의 소스만 일괄 갱신
//   ✅ [검증]   GAS의 정의되지 않은 내부 헬퍼 호출을 CI에서 탐지하는 check:gas 추가
//
//  v9.42 변경사항 (2026.07.31):
//   ✅ [안정성] 자동 스냅샷 생성에 Script Lock·성공/실패 상태 기록을 추가하고 실패를 트리거 실행기록에 전파
//   ✅ [정확성] 종목코드 시트가 비어도 펀드·TDF 거래와 수동가격만으로 오늘 스냅샷 생성
//   ✅ [점검]   자동화 상태 메뉴가 시트 마지막 행이 아닌 실제 최신 날짜와 최근 실행결과를 표시
//   ✅ [버그수정] 삭제된 _repairRecentNonKrxHistory() 호출로 16:20 자동 실행이 중단되던 오류 제거
//
//  v9.41 변경사항 (2026.07.31):
//   ✅ [정확성] 펀드·TDF는 스냅샷 기준일 이전의 가장 최근 수동가격만 이월하고 미래 입력값 참조 차단
//   ✅ [복구]   누락 스냅샷 복구도 공통 스냅샷 생성기를 사용해 펀드·TDF 수동가격을 동일하게 반영
//   ✅ [보존]   과거 스냅샷 재현에 필요한 수동가격 이력을 삭제하던 최신값만 유지 옵션 비활성화
//
//  v9.40 변경사항 (2026.07.31):
//   ✅ [복구]   마지막 스냅샷 이후부터 오늘까지의 누락 주간·월간 스냅샷도 보완 대상에 포함
//   ✅ [자동화] 스냅샷 보완 시 16:20 평가단가 자동 트리거를 함께 점검하고 누락 시 자동 복구
//
//  v9.39 변경사항 (2026.07.30):
//   ✅ [복구]   웹 손익 그래프에서 누락된 주간·월간 스냅샷을 날짜별로 일괄 보완하는 POST 기능 추가
//   ✅ [정확성] 금요일 자료가 없어도 주간 마지막 스냅샷을 사용하고 월간 연속성도 함께 진단
//   ✅ [지표]   거래기준 수익률 지수로 계산한 나의 손익 MDD 표시
//
//  v9.38 변경사항 (2026.07.28):
//   ✅ [동시성] 설정·배당·부동산 저장에 Script Lock을 적용해 자동 트리거와 웹 저장 충돌 방지
//   ✅ [안정성] 프론트 저장 debounce 대기 Promise가 취소 후 남는 문제 수정
//
//  v9.37 변경사항 (2026.07.27):
//   ✅ [자동화] syncMortgageFromSchedule — 현재월 상환스케줄 기준 잔액·이자·잔여기간을 GAS에서 매일 갱신
//   ✅ [트리거] 주담대 자동 갱신 트리거 추가 및 자동화 상태 점검에 포함
//
//  v9.36 변경사항 (2026.07.27):
//   ✅ [버그수정] onOpen(e) — 현재 문서 ID를 ScriptProperties에 저장해 복사된 GAS가 이전 문서를 열지 않도록 수정
//   ✅ [안내]   initSheet — 문서 접근 실패를 사용자용 안내창으로 표시하고 권한/연결 확인 경로 제공
//
//  v9.35 변경사항 (2026.07.27):
//   ✅ [정리]   onOpen — 중복 API/상태/점검 메뉴와 중복 실행되던 설치형 onOpen 트리거 제거
//   ✅ [안전]   initSheet — 기존 데이터를 지우지 않는 시트 구성 확인/복구 방식으로 변경
//              운영 시트 8종의 제목행·열 너비·고정행을 한 번에 일관되게 정리
//
//  v9.34 변경사항 (2026.07.24):
//   ✅ [버그수정] _normalizePublicDividendRows() — 법인번호(crno)로 조회한 배당 행은
//              공식 종목명 표기(SK ↔ 에스케이 등)가 달라도 같은 법인으로 보고 포함
//              → SK하이닉스처럼 공공데이터 상장명/배당명 표기가 달라 배당 없음으로 분류되던 문제 완화
//
//  v9.33 변경사항 (2026.07.24):
//   ✅ [성능개선] handleDividendPublicFetch — 종목별 순차 호출(2회×N종목) → UrlFetchApp.fetchAll()
//              일괄 병렬 요청으로 변경. 종목 30개 이상일 때 전체 소요시간이 100초 이상 걸려
//              프론트엔드 타임아웃으로 중간에 끊기던 문제 해결 (수 초 수준으로 단축)
//   ✅ [신규]   _fetchPublicListedInfoBatch() / _fetchPublicDividendRowsBatch() — 병렬 배치 조회 헬퍼
//
//  v9.32 변경사항 (2026.07.24):
//   ✅ [버그수정] _fetchPublicDividendRows() — 공공데이터 배당정보 엔드포인트 주소 오류
//              원인: GetStocDiviInfoService/getDiviInfo (구버전 경로, 404)
//              수정: GetStocDiviInfoService_V2/getDiviInfo_V2 (실제 서비스 주소로 교체, 실 응답으로 검증완료)
//   ✅ [버그수정] _normalizePublicDividendRows() — 배당일자 필드 우선순위 오류
//              원인: row.basDt(조회 당일 날짜, 매번 오늘 날짜로 찍힘)를 1순위로 사용
//                   → 모든 배당 이벤트 날짜가 실제 배당기준일 대신 "오늘 날짜"로 잘못 기록됨
//              수정: row.dvdnBasDt(실제 배당기준일)를 1순위로 사용, basDt는 후보에서 제외
//   ✅ [신규]   PUBLIC_DIVIDEND_MIN_DATE 설정 — 2026-01-01 이전 배당 이벤트는 결과에서 제외
//              → 대시보드가 2026년부터 관리 중이므로 오래된 배당 이력은 노이즈로 제외
//
//  v9.31 변경사항 (2026.07.23):
//   ✅ [개선]   onOpen — 이모지/서브메뉴와 무관한 일반 텍스트 빠른 설정 메뉴 추가
//              → 코드가 실제 실행되는지 스프레드시트 상단에서 즉시 판별 가능
//   ✅ [신규]   _addApiQuickMenu() — 공공데이터/KRX 인증키 전용 최소 메뉴 생성
//
//  v9.30 변경사항 (2026.07.23):
//   ✅ [개선]   setupTrigger — 설치형 onOpen 메뉴 트리거도 함께 등록
//              → 단순 onOpen이 스프레드시트에서 실행되지 않는 환경에서도 메뉴 재생성 보조
//   ✅ [신규]   _ensureOpenMenuTrigger() — 메뉴용 열기 트리거 중복 방지/상태 확인
//
//  v9.29 변경사항 (2026.07.23):
//   ✅ [개선]   onOpen — 메뉴 생성 로직을 전체 try/catch로 보호하고 최소 메뉴 fallback 추가
//              → 보조 라벨/트리거 오류가 나도 API 인증키 메뉴는 반드시 노출
//   ✅ [신규]   showMenuBuildError() — 스프레드시트에서 최근 메뉴 생성 오류 확인
//
//  v9.28 변경사항 (2026.07.23):
//   ✅ [개선]   onOpen — 기존에 보이던 초기 설정/종가 관리 메뉴에도 API 키 설정 항목 중복 배치
//              → 새 서브메뉴가 캐시/권한 문제로 늦게 보일 때도 기존 메뉴 경로에서 접근 가능
//   ✅ [개선]   KRX AUTH_KEY — 배당 탭/구글시트 연동 탭 모두에서 앱 입력 가능하도록 프론트와 연동
//
//  v9.27 변경사항 (2026.07.23):
//   ✅ [신규]   saveKrxAuthKey POST 액션 추가
//              → 웹앱 구글시트 연동 탭에서 KRX Open API AUTH_KEY를 GAS에 저장
//   ✅ [개선]   handleGetSettings — 저장된 krx_auth_key를 프론트 설정 복원에 포함
//   ✅ [개선]   onInstall(e) — 설치/권한 승인 후 메뉴 재생성 보조
//
//  v9.26 변경사항 (2026.07.23):
//   ✅ [신규]   savePublicDataApiKey POST 액션 추가
//              → 웹앱 배당 탭에서 저장한 공공데이터 API 키도 GAS ScriptProperties에 저장
//   ✅ [개선]   공공데이터 키 저장 흐름 — 로컬 전용이 아니라 다른 브라우저에서도 getSettings로 복원 가능
//
//  v9.25 변경사항 (2026.07.23):
//   ✅ [개선]   onOpen — 포트폴리오 최상위 메뉴에 공공데이터 API 인증키/상태 항목 직접 노출
//              → 사용자가 메뉴를 열자마자 상장종목정보·배당정보 API 설정을 찾을 수 있게 개선
//
//  v9.24 변경사항 (2026.07.23):
//   ✅ [개선]   onOpen — 공공데이터 API 전용 서브메뉴 추가
//              → KRX상장종목정보(종목코드)/주식배당정보 인증키 설정 위치 명확화
//   ✅ [신규]   showPublicDataApiKeyStatus() — 스프레드시트 메뉴에서 저장 상태 확인
//
//  v9.23 변경사항 (2026.07.23):
//   ✅ [신규]   configurePublicDataApiKeyPrompt() — 스프레드시트 메뉴에서 공공데이터포털 인증키 입력
//              → KRX상장종목정보/주식배당정보 API 키를 GAS ScriptProperties에 저장
//   ✅ [개선]   dividendPublic/name — 요청 serviceKey가 없으면 GAS 저장 키를 fallback 사용
//              → 브라우저별 키 입력 없이도 배당 조회·공식명 조회 가능
//
//  v9.22 변경사항 (2026.07.23):
//   ✅ [신규]   dividendPublic — 공공데이터포털 주식배당정보/KRX상장종목정보 연동
//              → 종목코드 기준 공식명·법인번호 조회 후 배당 이벤트 정규화
//   ✅ [신규]   handleNameLookup(serviceKey) — KRX상장종목정보 기반 공식 종목명 조회
//              → 프론트 종목 추가/기존 종목 공식명 반영 기능에서 사용
//   ✅ [개선]   _publicServiceKeyParam() — Encoding/Decoding 인증키 모두 안전 처리
//              → serviceKey 쿼리에서 +, / 문자가 깨질 가능성 완화
//   ✅ [개선]   batchSaveManualPrices — 현재가 편집 저장을 배치 처리하고 스냅샷 재작성 최소화
//
//  v9.21 변경사항 (2026.05.12):
//   ✅ [버그수정] handleGetTrades() — fund 필드 항상 false 버그
//              원인: 거래이력 시트는 9컬럼(날짜~메모)까지만 저장되므로 r[9]는 항상 undefined
//              수정: assetType('펀드'|'TDF') 으로 fund 여부 추론
//   ✅ [버그수정] cleanupSnapshotDuplicates() — getUi() 직접 호출
//              원인: 웹앱/트리거 컨텍스트에서 getUi()가 예외를 던져 crash 발생
//              수정: 모든 alert을 try/catch + Logger.log fallback으로 교체
//   ✅ [개선]   fixPriceHistoryNames() — 루프 내 개별 setValue() → 배치 setValues()
//              원인: 종목 수만큼 시트 API 호출 → 대량 데이터 시 느림
//              수정: 연속 행 묶음 setValues() 배치 처리로 API 호출 최소화
//   ✅ [개선]   handleGetSettings() — gasVersion 필드 추가
//              프론트에서 GAS 버전 불일치를 감지해 재배포 필요 여부 안내
//
//  v9.20 변경사항 (2026.04.23):
//   ✅ [버그수정] handleGetTrades() — 거래 레코드 fund 필드 누락
//              → 펀드/TDF 종목이 프론트에서 fund=false로 잘못 인식되던 문제
//   ✅ [버그수정] handleGetPricesCompat() — stillMissing 수집하고도 응답에 미포함
//              → { prices, missing } 으로 응답 통일
//   ✅ [개선]   handleGetPriceHistory() — source 컬럼(6번째) 포함 (readCols 4→6)
//              → pricesByCode 각 entry에 source 필드 추가
//   ✅ [버그수정] mgmt_editor.js _saveManualPriceWithRetry() — keepLatest=0 하드코딩
//              → 파라미터 제거해 GAS의 _isManualKeepLatestEnabled() 설정값 사용
//
//  v9.19 변경사항 (2026.04.22):
//   ✅ [버그수정] _getPriceSourceByDate() — 당일 소스 없을 때 MANUAL fallback 누락
//              원인: KRX fallback으로 전일 날짜에 MANUAL 가격 저장 시
//                   당일 sourceMap 비어있어 소스가 PRICE_HISTORY로 잘못 표시
//                   → 스냅샷 평가단가소스 = PRICE_HISTORY, 저장일시 = 빈칸
//              수정: 1단계 당일 소스 수집 후
//                   2단계 당일 소스 없는 종목 → dateStr 이하 최근 MANUAL 소스로 fallback
//                   → 스냅샷 소스 = MANUAL, 저장일시 정상 표시
//
//  v9.18 변경사항 (2026.04.22):
//   ✅ [버그수정] _buildSnapshotRowsFromTradeAndPriceHistory() — 해당 날짜 가격 없을 때 evalAmt 오류
//              원인: KRX fallback으로 전일 날짜에 가격 저장 시 오늘 prices 맵에 해당 종목 없음
//                   → evalAmt = h.costAmt(매수원금) 으로 계산되어 평가금액 = 매수원금이 됨
//              수정: 해당 날짜 가격 없는 종목에 대해 getLatestPriceHistory()로 최근 가격 fallback
//                   → 전일 종가라도 있으면 정상 평가금액 계산
//
//  v9.17 변경사항 (2026.04.22):
//   ✅ [버그수정] fetchPricesKrxViaOtp() — usedDate 필드 누락
//              → fetchPricesKrx()와 반환 구조 통일 (OTP는 fallback 없으므로 usedDate=요청날짜)
//   ✅ [버그수정] fetchPricesGoogleFinance() — new Date(dateStr.replace(/-/g,"/")) UTC 파싱
//              → _ymdToDate() 사용으로 시간대 명확화
//   ✅ [버그수정] handleDividendFetch() — _gf_tmp 시트 충돌 위험
//              → 배당 전용 _div_tmp 시트 사용으로 분리
//   ✅ [개선]   _cleanupBenchmarkTempSheets() — _div_tmp 도 정리 대상에 포함
//
//  v9.16 변경사항 (2026.04.22):
//   ✅ [버그수정] handleGetHistory() — date 읽기 시 _normalizeDate() 미적용
//              → 스냅샷 시트 날짜가 Date 객체인 경우 'Mon Apr 21 2026...' 형태로 읽혀
//                 from/to 필터 비교 실패 및 dateItemMap 키 불일치 문제
//   ✅ [버그수정] handleGetPricesCompat() — KRX fallback 시 usedDate 무시하고 todayStr 저장
//              → saveDailyPriceHistory와 동일한 날짜 오기입 버그
//              → usedDate 기준으로 날짜 분리 저장하도록 수정
//
//  v9.15 변경사항 (2026.04.22):
//   ✅ [버그수정] handleGetHistory() — 빈 결과 반환 키 불일치
//              { history: [] } → { snapshots: [] } (프론트 data.snapshots 키와 일치)
//   ✅ [버그수정] handleGetHistory() — 스냅샷 읽기 컬럼 Math.max(8→12)
//              12컬럼 확장 이후 저장일시 컬럼이 읽히지 않던 문제
//
//  v9.14 변경사항 (2026.04.22):
//   ✅ [버그수정] 가격이력 날짜 오기입 — KRX fallback 시 전일 데이터가 당일 날짜로 저장되는 문제
//              원인: fetchPricesKrx()가 당일 데이터 없으면 자동으로 직전 거래일 데이터 반환하는데
//                   saveDailyPriceHistory()는 실제 날짜 무관하게 todayStr로 저장
//              수정: fetchPricesKrx() 반환값에 usedDate(실제 데이터 날짜) 포함
//                   saveDailyPriceHistory()에서 usedDate별로 분리하여 실제 날짜에 저장
//              효과: 4/22 16:20 실행 → KRX 4/22 데이터 없음 → 4/21 종가 → 4/21에 저장
//                   (4/22 스냅샷은 가장 최근 가격인 4/21 종가를 참조해서 생성)
//
//  v9.13 변경사항 (2026.04.21):
//   ✅ [정리]   데드코드 7개 함수 삭제 (117 → 111개)
//              configureKrxApiPrompt / _extractKrxRows / _pickKrxCode / _pickKrxClose
//              importKrxClosesFromSettings / _readKrxImportRequestFromSettings / migratePriceHistory
//   ✅ [최적화] upsertPriceHistory() — 3번 setValue → 1번 setValues 배치화
//   ✅ [최적화] batchUpsertPriceHistory() — savedAt+source 업데이트를 연속행 묶음 setValues
//
//  v9.12 변경사항 (2026.04.21):
//   ✅ [버그수정] _readBenchmarkPoints() — _bm_* 전용 시트 미적용 수정 (이전 패치 누락)
//   ✅ [버그수정] cleanupSnapshotDuplicates() — SpreadsheetApp.getActiveSpreadsheet()
//              → getss() 로 교체 (웹앱/트리거 환경에서 null 반환 방지)
//   ✅ [개선]   KOSDAQ 심볼 — GOOGLEFINANCE 미지원 확인
//              → KRX:229200 (KODEX코스닥150 ETF) fallback 추가로 근사값 표시
//   ✅ [신규]   _cleanupBenchmarkTempSheets() — _bm_*, _gf_tmp 임시 시트 일괄 삭제
//   ✅ [개선]   runDataCleanup() — 임시 시트 정리 단계 추가
//
//  v9.11 변경사항 (2026.04.20):
//   ✅ [버그수정] batchUpsertPriceHistory() — MANUAL 보호 + 날짜 정규화
//              → existingMap 키 생성 시 _normalizeDate() 미적용으로 중복 감지 실패 수정
//              → MANUAL 소스 행은 자동조회(KRX/GF)로 덮어쓰지 않도록 manualSet 보호
//              → toUpdate 시 savedAt도 함께 업데이트 (MANUAL인 경우만)
//   ✅ [버그수정] _repairRecentNonKrxHistory() — MANUAL 소스도 skip 대상에 추가
//              → 매일 트리거 실행 시 최근 7일 MANUAL 가격이 KRX로 덮어씌워지던 문제 수정
//
//  v9.10 변경사항 (2026.04.20):
//   ✅ [버그수정] _dedupeSnapshotRows() — slice(0,11)로 savedAt 잘리던 문제
//              → slice(0,12) + 부족 시 빈 문자열 채움으로 컬럼 불일치 에러 방지
//   ✅ [버그수정] writeSnapshotRows() overwrite=false 판단 로직
//              → 기존: 날짜 행 하나라도 있으면 전체 skip (일부 종목 누락 발생)
//              → 수정: 이미 있는 종목만 제외하고 없는 종목만 추가
//   ✅ [버그수정] cleanupSnapshotDuplicates() — 11컬럼 하드코딩 → 12컬럼으로 통일
//
//  v9.9 변경사항 (2026.04.17):
//   ✅ [버그수정] _backfillExecute() — existingDates 읽기 시 _normalizeDate() 미적용 버그
//              → 스냅샷 날짜가 Date 객체로 저장된 경우 'Mon Apr 13 2026...' 형태로 읽혀
//                 이미 채워진 날짜도 없는 것으로 판단하거나 덮어쓰기가 정상 작동하지 않던 문제
//   ✅ [수정]   _backfillExecute() snapRows → 12컬럼 일치 (savedAt 빈 문자열 추가)
//
//  v9.8 변경사항 (2026.04.16):
//   ✅ [개선]   onOpen 메뉴 서브메뉴 구조로 재편 (4개 서브메뉴)
//              ⚙️ 초기 설정 / 📈 종가 관리 / 📆 소급채우기 / 🛠️ 유지보수
//   ✅ [삭제]   '📅 오늘 가격이력 저장' 메뉴 제거 (종가 갱신에 포함됨, 중복)
//   ✅ [통합]   죽은 코드 정리 + 종목명 보정 + 스냅샷 중복 → runDataCleanup() 하나로
//   ✅ [통합]   최근 이상치 점검 + 기간 지정 복구 → detectPriceAnomalyPromptAndMaybeRepair() 하나로
//   ✅ [문구]   메뉴 항목 문구 전반 간소화·통일
//
//  v9.7 변경사항 (2026.04.14):
//   ✅ [신규]   스냅샷 시트 12컬럼으로 확장 — 12번째 컬럼 '저장일시' 추가
//              → MANUAL 수동입력 시 가격이력의 savedAt(저장날짜시간)이 스냅샷에도 기록
//   ✅ [수정]   _getPriceSourceByDate() → { src, savedAt } 객체 반환으로 변경
//   ✅ [수정]   _buildSnapshotRowsFromTradeAndPriceHistory() → 12컬럼 생성
//              MANUAL 소스일 때 savedAt 자동 채움, 그 외 빈 문자열
//   ✅ [수정]   _readSnapshotRowsByDate() → 12컬럼 읽기
//   ✅ [수정]   writeSnapshotRows() → 12컬럼 헤더/데이터 처리
//   ✅ [보호]   _updateTodaySnapshotSource() → 이미 MANUAL인 항목은 자동조회로 덮어쓰기 방지
//   ✅ [수정]   handleSaveSnapshot() / repairPriceAndSnapshotForDate() → 12컬럼 호환
//   ✅ [수정]   트리거 시간대 inTimezone('Asia/Seoul') 명시
//   ✅ [수정]   비교지수 멀티선택 시 _gf_tmp 충돌 방지 → 지수별 전용 시트(_bm_*)
//
//  v9.6 변경사항 (2026.03.24):
//   ✅ [버그수정] _parseArrayParam() 함수 누락 추가
//              → syncTrades / syncHoldings POST 시 ReferenceError 발생하던 문제 해결
//
//  v9.5 변경사항 (2026.03.13):
//   ✅ [신규]   save/getDividendSettings, save/getRealEstateSettings 액션 추가
//   ✅ [개선]   설정 부분 저장 유틸(_readSettingsMap/_writeSettingsMap)로 기존 키 보존 저장
//
//  v9.4 변경사항 (2026.03.12):
//   ✅ [버그수정] _backfillExecute() — 스냅샷만 저장하고 가격이력(SHEET_PH) 미저장 수정
//              → batchUpsertPriceHistory() 동시 호출로 과거 날짜 조회 정상화
//   ✅ [개선]   BACKFILL_CONFIG.toYear/toMonth 기본값 2026-03으로 업데이트
//   ✅ [정리]   backfillMonth() 삭제 (backfillRange로 완전 대체)
//   ✅ [정리]   BACKFILL_CONFIG 레거시 year/month 필드 제거
//   ✅ [정리]   onOpen 메뉴 순서 재편 (초기설정→종가→소급→유지보수)
//
//  v9.3 변경사항 (2026.03.11):
//   ✅ [버그수정] handleSyncTrades() — 날짜 정규화 누락
//      'Fri Dec 26 2025' 형식으로 저장되던 문제 수정
//      _normalizeDate() 헬퍼 추가 → 어떤 형식이든 YYYY-MM-DD 변환
//   ✅ [방어] handleSaveSnapshot() — dateStr도 동일 헬퍼로 정규화
//
//  v9.2 변경사항 (2026.03.11):
//   ✅ [버그수정] cleanDeadCodes() — new Set() → 객체 방식으로 변경
//      (GAS는 ES5 기반 — Set/Map 미지원)
//   ✅ [최적화] handleSyncCodes() — existingRowData 이중 getValues 읽기 제거
//      (동일 범위를 2회 읽던 중복 제거, 1차 읽기 결과 재활용)
//
//  v9.1 변경사항 (2026.03.11):
//   ✅ [신규] '설정' 시트 추가 — 브라우저 독립 설정 복원
//   ✅ [신규] handleSaveSettings / handleGetSettings — 설정 저장/조회
//   ✅ [신규] handleGetTrades / handleGetHoldings — 거래이력/보유현황 읽기
//   ✅ [버그수정] migratePriceHistory() — 신버전 감지 후 불필요한 재변환 방지
//   ✅ [버그수정] handleGetTrades() — Date 객체 날짜 포맷 정규화
//   ✅ [최적화] handleSyncCodes — 루프 내 단건 setValue → 배치 setValues
//   ✅ [최적화] handleSaveSettings — clearContent + 1회 setValues 재작성
//   ✅ [최적화] batchUpsertPriceHistory — 연속 행 묶음 setValues
//
//  v9.0 변경사항 (2026.03.08):
//   ✅ [버그수정] getss() — 웹앱 배포 시 getActiveSpreadsheet() null 방지
//   ✅ [신규] backfillRange() — 연도 범위 소급채우기
//   ✅ [신규] backfillResume() / backfillStatus()
//   ✅ [최적화] writeSnapshotRows() — 날짜별 upsert → 전체 재구성 1회
//   ✅ [최적화] fetchPricesGoogleFinance() — tmp 시트 삭제 실패 시 clearContents fallback
//   ✅ [최적화] handleGetPriceHistory() — 중복 순회 제거
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
//  ★ 스프레드시트 ID 설정 (필수)
// ════════════════════════════════════════════════════════════════════
var SS_ID = (function(){
  try {
    return PropertiesService.getScriptProperties().getProperty('SS_ID') || '';
  } catch(e) {
    return '';
  }
})();

// ════════════════════════════════════════════════════════════════════
//  소급채우기 설정
// ════════════════════════════════════════════════════════════════════
var BACKFILL_CONFIG = {
  fromYear:  2024, fromMonth: 1,   // 소급채우기 시작 연월
  toYear:    new Date().getFullYear(), toMonth: new Date().getMonth() + 1,
  overwrite: false,
};

// ════════════════════════════════════════════════════════════════════
//  공공데이터 배당정보 설정
//  ★ v9.32: 대시보드가 2026년부터 관리 중이므로 이 날짜 이전 배당 이벤트는 제외
//     필요시 이 값만 바꾸면 필터 기준이 바뀝니다.
// ════════════════════════════════════════════════════════════════════
var PUBLIC_DIVIDEND_MIN_DATE = '2026-01-01';

// ════════════════════════════════════════════════════════════════════
//  시트 이름 설정
// ════════════════════════════════════════════════════════════════════
var CONFIG = {
  SHEET_CODES:    '종목코드',
  SHEET_PRICES:   '종가',
  SHEET_SNAPSHOT: '스냅샷',
  SHEET_PH:       '가격이력',
  SHEET_HOLD:     '보유현황',
  SHEET_TRADES:   '거래이력',
  SHEET_ETF_DIVIDENDS: 'ETF분배금이력',
  SHEET_SYNC_LOG: '동기화로그',
  SHEET_TMP:      '_gf_tmp',
  SHEET_SETTINGS: '설정',
  TIMEZONE:       'Asia/Seoul',
};

// 임시 시트 이름에 생성시각을 넣어 정리 작업이 현재 실행 중인 요청의 시트를 삭제하지 않도록 합니다.
// 형식: <prefix><base36 timestamp>_<uuid>
var TEMP_SHEET_MAX_AGE_MS = 10 * 60 * 1000;
function _tempSheetName(prefix) {
  return prefix + Date.now().toString(36) + '_' + Utilities.getUuid().slice(0, 8);
}

function _isExpiredTempSheet(name, nowMs) {
  var match = (name || '').match(/^_(?:bm|div_tmp|gf_tmp|fx_tmp|name_tmp|bffx_tmp)_([0-9a-z]+)_[0-9a-f-]+$/i);
  if (!match) return false;
  var createdAt = parseInt(match[1], 36);
  return isFinite(createdAt) && nowMs - createdAt >= TEMP_SHEET_MAX_AGE_MS;
}

// ════════════════════════════════════════════════════════════════════
//  스프레드시트 핸들러 — 웹앱 배포 시 null 방지
// ════════════════════════════════════════════════════════════════════
function getss() {
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch(e) { Logger.log('⚠️ getActiveSpreadsheet 실패, openById로 fallback: ' + e.message); }
  var configuredId = '';
  try { configuredId = PropertiesService.getScriptProperties().getProperty('SS_ID') || SS_ID || ''; } catch(e2) { configuredId = SS_ID || ''; }
  if (!configuredId) throw new Error('연결된 스프레드시트 ID가 없습니다. 스프레드시트를 새로고침한 뒤 다시 실행해주세요.');
  try {
    return SpreadsheetApp.openById(configuredId);
  } catch(e3) {
    throw new Error('저장된 스프레드시트에 접근할 수 없습니다. 현재 문서를 새로고침하거나 GAS 실행 계정의 권한을 확인해주세요. (' + e3.message + ')');
  }
}

// ════════════════════════════════════════════════════════════════════
function _isAuthorizedRequest(params) {
  var expected = (PropertiesService.getScriptProperties().getProperty('access_token') || '').trim();
  if (!expected) return true; // 기존 배포 호환: 관리자가 토큰을 설정한 뒤부터 보호 활성화
  var provided = String(params && params.accessToken || '');
  if (provided.length !== expected.length) return false;
  var mismatch = 0;
  for (var i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return mismatch === 0;
}

function _removeSecretsFromSettings(settings) {
  ['public_data_api_key', 'public_listed_api_key', 'public_dividend_api_key', 'krx_auth_key', 'krx_api_key', 'access_token'].forEach(function(key) { delete settings[key]; });
  return settings;
}

function _getApiKeyStatus() {
  return {
    publicDataApiKeyConfigured: !!_getPublicDataApiKey(),
    krxAuthKeyConfigured: !!_getKrxAuthKey(),
    requestAuthenticationEnabled: !!(PropertiesService.getScriptProperties().getProperty('access_token') || '').trim(),
    toss: _getTossConfigStatus_()
  };
}

function _maskTossClientId_(value) {
  var id = String(value || '').trim();
  if (!id) return '';
  if (id.length <= 4) return '****';
  return id.slice(0, 2) + '••••' + id.slice(-2);
}

function _getTossConfigStatus_() {
  var props = PropertiesService.getScriptProperties();
  var clientId = String(props.getProperty('TOSS_CLIENT_ID') || '').trim();
  var secret = String(props.getProperty('TOSS_CLIENT_SECRET') || '').trim();
  return {
    clientIdConfigured: !!clientId,
    clientIdMasked: _maskTossClientId_(clientId),
    secretConfigured: !!secret,
    lastDiagnosticAt: String(props.getProperty('TOSS_LAST_DIAGNOSTIC_AT') || ''),
    lastDiagnosticOk: props.getProperty('TOSS_LAST_DIAGNOSTIC_OK') === 'true',
    lastDiagnosticCode: String(props.getProperty('TOSS_LAST_DIAGNOSTIC_CODE') || '')
  };
}

function handleSaveTossConfig(dataJson) {
  try {
    var data;
    try { data = JSON.parse(String(dataJson || '{}')); }
    catch(parseError) { data = _parseJsonParam(dataJson || '{}', 'Toss 설정'); }
    return _tossWithTokenLock_(function() {
      var props = PropertiesService.getScriptProperties();
      var changed = [];
      var clientId = String(data.clientId == null ? '' : data.clientId).trim();
      var secret = String(data.secret == null ? '' : data.secret).trim();
      var previousClientId = String(props.getProperty('TOSS_CLIENT_ID') || '').trim();
      var previousSecret = String(props.getProperty('TOSS_CLIENT_SECRET') || '').trim();
      // 설정 변경과 token cache 무효화를 같은 lock 안에서 처리해 발급 경쟁을 막습니다.
      if (Object.prototype.hasOwnProperty.call(data, 'clientId') && clientId) {
        props.setProperty('TOSS_CLIENT_ID', clientId); changed.push('clientId');
      }
      if (Object.prototype.hasOwnProperty.call(data, 'secret') && secret) {
        props.setProperty('TOSS_CLIENT_SECRET', secret); changed.push('secret');
      }
      if ((clientId && clientId !== previousClientId) || (secret && secret !== previousSecret)) CacheService.getScriptCache().remove(TOSS_TOKEN_CACHE_KEY);
      return jsonOk({ saved: true, changed: changed, toss: _getTossConfigStatus_() });
    });
  } catch(err) {
    return jsonError('Toss 설정 저장 실패: ' + err.message);
  }
}

function handleClearTossConfig() {
  try {
    return _tossWithTokenLock_(function() {
      var props = PropertiesService.getScriptProperties();
      props.deleteProperty('TOSS_CLIENT_ID');
      props.deleteProperty('TOSS_CLIENT_SECRET');
      props.deleteProperty('TOSS_LAST_DIAGNOSTIC_AT');
      props.deleteProperty('TOSS_LAST_DIAGNOSTIC_OK');
      props.deleteProperty('TOSS_LAST_DIAGNOSTIC_CODE');
      CacheService.getScriptCache().remove(TOSS_TOKEN_CACHE_KEY);
      return jsonOk({ cleared: true, toss: _getTossConfigStatus_() });
    });
  } catch(err) {
    return jsonError('Toss 설정 삭제 실패: ' + err.message);
  }
}

function configureAccessTokenPrompt() {
  var ui = SpreadsheetApp.getUi();
  var enabled = !!(PropertiesService.getScriptProperties().getProperty('access_token') || '').trim();
  var response = ui.prompt(
    'GAS 요청 접근 토큰 설정',
    '개인 비밀번호 관리자에서 24자 이상의 임의 문자열을 만들어 입력하세요.\n' +
    '웹앱의 구글시트 연동 화면에도 같은 값을 입력해야 합니다.\n' +
    '해제하려면 - 를 입력하세요.\n\n현재 상태: ' + (enabled ? '인증 사용 중' : '호환 모드(인증 꺼짐)'),
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var token = String(response.getResponseText() || '').trim();
  var props = PropertiesService.getScriptProperties();
  if (token === '-') {
    if (!_confirmPortfolioMenuAction('요청 인증 해제', '접근 토큰을 삭제하면 GAS URL만으로 접근 가능한 호환 모드가 됩니다. 인증 해제가 필요할 때만 실행하세요.')) return;
    props.deleteProperty('access_token');
    ui.alert('✅ 요청 인증을 해제했습니다. GAS URL만으로 접근 가능한 호환 모드입니다.');
    return;
  }
  if (token.length < 24) {
    ui.alert('⚠️ 토큰을 저장하지 않았습니다. 24자 이상으로 입력하세요.');
    return;
  }
  props.setProperty('access_token', token);
  ui.alert('✅ 요청 인증을 활성화했습니다.\n\n이제 웹앱의 구글시트 연동 화면에서 같은 토큰을 저장·검증하세요. 다른 브라우저에도 각각 입력해야 합니다.');
}

//  doGet
// ════════════════════════════════════════════════════════════════════
function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  if (!_isAuthorizedRequest(params)) return jsonError('인증 실패');
  if (params.action === 'getAutomationStatus') return handleGetAutomationStatus();
  if (params.action === 'getKrxSourceDiagnostics') return handleGetKrxSourceDiagnostics(params.date || '');
  if (params.action === 'getFundUnits') return handleGetFundUnits();
  if (params.action === 'getFundValuationStatus') return handleGetFundValuationStatus(params.from || '', params.to || '', params.code || '');
  if (params.action === 'diagnoseWorkbookCells') return handleDiagnoseWorkbookCells();
  if (params.action === 'diagnoseSnapshotIntegrity') return handleDiagnoseSnapshotIntegrity(params.date || '', params.dates || '');
  if (params.action === 'diagnoseSnapshotIntegrityRange') return handleDiagnoseSnapshotIntegrityRange(params.from || '', params.to || '', params.candidates || '', params.dates || '');
  if (params.action === 'diagnosePriceHistoryIntegrity') return handleDiagnosePriceHistoryIntegrity(params.date || '', params.dates || '', params.codes || '');
  if (params.action === 'previewPriceHistoryRepair') return handlePreviewPriceHistoryRepair(params.data || '{}');
  if (params.action === 'diagnoseEtfDividends') return handleDiagnoseEtfDividends(params.from || '', params.to || '', params.raw || '');
  if (params.action === 'name'           && params.code)  return handleNameLookup(params.code, _getPublicDataApiKey());
  if (params.action === 'getHistorySource')               return handleGetHistorySource(params.from || '', params.to || '');
  if (params.action === 'getHistorySourceDetail')         return handleGetHistorySourceDetail(params.date || '');
  if (params.action === 'getHistory')                     return handleGetHistory(params.from || '', params.to || '');
  if (params.action === 'getHistoryDetail')               return handleGetHistoryDetail(params.date || '');
  if (params.action === 'getSnapshotRepairStatus')        return handleGetSnapshotRepairStatus();
  if (params.action === 'getCodeList')                    return handleGetCodeList();
  if (params.action === 'getBootstrap')                   return handleGetBootstrap();
  if (params.action === 'getPriceHistory')                return handleGetPriceHistory(params.from || '', params.to || '', params.codes || '');
  if (params.action === 'getKrxOfficialStockCloses')      return handleGetKrxOfficialStockCloses(params.date || '', params.codes || '');
  if (params.action === 'getBenchmark')                   return handleGetBenchmark(params.benchmark || '', params.from || '', params.to || '');
  if (params.action === 'getBenchmarks')                  return handleGetBenchmarks(params.benchmarks || '', params.from || '', params.to || '', params.fresh === '1');
  if (params.action === 'getKrxK200NightClose')           return handleGetKrxK200NightClose(params.date || '');
  if (params.action === 'getExchangeRateHistory')         return handleGetExchangeRateHistory(params.from || '', params.to || '', params.currencies || 'USD');
  if (params.action === 'getMarketBriefingMaster')        return handleGetMarketBriefingMaster(params.from || '', params.to || '', params.seriesIds || '');
  if (params.action === 'getMarketBriefingSnapshots')     return handleGetMarketBriefingSnapshots(params.from || '', params.to || '');
  if (params.action === 'saveManualPrice')                return handleSaveManualPrice(params.date || '', params.name || '', params.price || '0', params.keepLatest || '');
  if (params.action === 'getPrices'      && params.codes) return handleGetPricesCompat(params.codes, params.persist === '1');
  if (params.action === 'diagnoseTossMarketData') return handleDiagnoseTossMarketData();
  if (params.action === 'dividend') {
    var codes = params.codes ? params.codes.split(',') : (params.code ? [params.code] : []);
    return handleDividendFetch(codes);
  }
  if (params.action === 'dividendPublic') {
    var publicCodes = params.codes ? params.codes.split(',') : (params.code ? [params.code] : []);
    var publicNames = params.names ? params.names.split('|') : [];
    return handleDividendPublicFetch(publicCodes, publicNames, _getPublicDataApiKey());
  }
  if (params.action === 'getSettings')          return handleGetSettings();
  if (params.action === 'getDividendSettings')  return handleGetDividendSettings();
  if (params.action === 'getRealEstateSettings')return handleGetRealEstateSettings();
  if (params.action === 'getTrades')            return handleGetTrades();
  if (params.action === 'getHoldings')          return handleGetHoldings();
  if (params.action === 'saveSnapshot' || params.action === 'syncCodes' ||
      params.action === 'syncHoldings' || params.action === 'syncTrades' ||
      params.action === 'saveSettings' || params.action === 'saveDividendSettings' ||
      params.action === 'saveRealEstateSettings' || params.action === 'saveSyncIssues' ||
      params.action === 'savePublicDataApiKey' || params.action === 'saveKrxAuthKey' ||
      params.action === 'saveTossConfig' || params.action === 'clearTossConfig' ||
      params.action === 'repairSnapshots' || params.action === 'startSnapshotRepair' ||
      params.action === 'continueSnapshotRepair' || params.action === 'refreshEtfDividends' ||
      params.action === 'rebuildDailySnapshots' || params.action === 'rewriteSnapshotDate' ||
      params.action === 'previewFundNavImport' || params.action === 'importFundNav' ||
      params.action === 'prepareBackupCleanup' || params.action === 'maintainSystemBackups' || params.action === 'applyPriceHistoryRepair') {
    return jsonError(params.action + ' 은 POST 전용입니다');
  }
  return handlePriceFetch(params.date || '', params.allCodes || '');
}

// ════════════════════════════════════════════════════════════════════
//  doPost
// ════════════════════════════════════════════════════════════════════
function doPost(e) {
  var params = {};
  try {
    if (e && e.postData && e.postData.contents) {
      e.postData.contents.split('&').forEach(function(pair) {
        var idx = pair.indexOf('=');
        if (idx === -1) return;
        var k = decodeURIComponent(pair.slice(0, idx).replace(/\+/g, ' '));
        var v = decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
        params[k] = v;
      });
    }
  } catch(err) {
    return jsonError('POST 파싱 실패: ' + err.message);
  }
  if (!_isAuthorizedRequest(params)) return jsonError('인증 실패');
  if (params.action === 'getFundUnits') return handleGetFundUnits();
  if (params.action === 'previewFundNavImport') return handlePreviewFundNavImport(params.data || '{}');
  if (params.action === 'importFundNav') return handleImportFundNav(params.data || '{}');
  if (params.action === 'saveFundUnits') return handleSaveFundUnits(params.data || '{}');
  if (params.action === 'refreshFundValuations') return handleRefreshFundValuations(params.from, params.to, params.code || '', params.diagnostic || '');
  if (params.action === 'prepareBackupCleanup') return handlePrepareBackupCleanup(params.data || '{}');
  if (params.action === 'maintainSystemBackups') return handleMaintainSystemBackups(params.data || '{}');
  if (params.action === 'applyPriceHistoryRepair') return handleApplyPriceHistoryRepair(params.data || '{}');
  var readActions = ['diagnoseWorkbookCells', 'diagnoseSnapshotIntegrity', 'diagnoseSnapshotIntegrityRange', 'diagnosePriceHistoryIntegrity', 'previewPriceHistoryRepair', 'diagnoseEtfDividends', 'diagnoseTossMarketData', 'name', 'getHistorySource', 'getHistorySourceDetail', 'getHistory', 'getHistoryDetail', 'getSnapshotRepairStatus', 'getCodeList', 'getBootstrap', 'getPriceHistory', 'getKrxOfficialStockCloses', 'getBenchmark', 'getBenchmarks', 'getKrxK200NightClose', 'getExchangeRateHistory', 'getMarketBriefingMaster', 'getMarketBriefingSnapshots', 'getPrices', 'dividend', 'dividendPublic', 'getSettings', 'getDividendSettings', 'getRealEstateSettings', 'getTrades', 'getHoldings', 'getFundValuationStatus', 'getAutomationStatus', 'getKrxSourceDiagnostics'];
  if (readActions.indexOf(params.action) !== -1) return doGet({ parameter: params });
  if (params.action === 'syncCodes'    && params.codes) return handleSyncCodes(params.codes);
  if (params.action === 'saveSnapshot')                 return handleSaveSnapshot(params.date || '', params.data || '');
  if (params.action === 'appendMarketBriefingObservations') return handleAppendMarketBriefingObservations(params.data || '[]');
  if (params.action === 'appendMarketBriefingSnapshot') return handleAppendMarketBriefingSnapshot(params.data || '{}');
  if (params.action === 'syncHoldings' && params.data)  return handleSyncHoldings(params.data);
  if (params.action === 'syncTrades'           && params.data) return handleSyncTrades(params.data);
  if (params.action === 'saveSettings'         && params.data) return handleSaveSettings(params.data);
  if (params.action === 'saveDividendSettings' && params.data) return handleSaveDividendSettings(params.data);
  if (params.action === 'refreshEtfDividends') return handleRefreshEtfDividends(params.force || '');
  if (params.action === 'saveRealEstateSettings' && params.data) return handleSaveRealEstateSettings(params.data);
  if (params.action === 'saveSyncIssues' && params.data) return handleSaveSyncIssues(params.source || '', params.data);
  if (params.action === 'savePublicDataApiKey') return handleSavePublicDataApiKey(params.key || '');
  if (params.action === 'saveTossConfig') return handleSaveTossConfig(params.data || '{}');
  if (params.action === 'clearTossConfig') return handleClearTossConfig();
  if (params.action === 'startSnapshotRepair') return handleStartSnapshotRepair();
  if (params.action === 'continueSnapshotRepair') return handleContinueSnapshotRepair();
  if (params.action === 'saveKrxAuthKey') return handleSaveKrxAuthKey(params.key || '');
  if (params.action === 'repairSnapshots' && params.data) return handleRepairSnapshots(params.data);
  if (params.action === 'rewriteSnapshotDate') return handleRewriteSnapshotDate(params.date || '', params.operationId || '', params.finalize || '');
  if (params.action === 'rebuildDailySnapshots') {
    try { return jsonOk(rebuildDailySnapshots(params.from || '', params.to || '')); }
    catch (error) { return jsonError('rebuildDailySnapshots 실패: ' + error.message); }
  }
  // ★ [최적화] 배치 수동가격 저장 — 건당 개별 요청 → 1회 일괄 처리
  if (params.action === 'batchSaveManualPrices' && params.data) return handleBatchSaveManualPrices(params.date || '', params.data);
  return jsonError('알 수 없는 action: ' + (params.action || '없음'));
}

var MARKET_BRIEFING_MASTER_SHEET = 'MARKET_MASTER';
var MARKET_BRIEFING_MASTER_HEADERS = ['series_id','trading_date','value','market','session','source','status','finality','observed_at','received_at','timestamp_quality','lag_seconds','revision','quality','currency','source_date','fallback'];
var MARKET_BRIEFING_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function _marketBriefingIsoTimestamp_(value) {
  if (value instanceof Date) {
    var dateMs = value.getTime();
    return isFinite(dateMs) ? new Date(dateMs).toISOString() : '';
  }
  var text = String(value || '').trim();
  if (!MARKET_BRIEFING_TIMESTAMP_RE.test(text)) return '';
  var ms = Date.parse(text);
  return isFinite(ms) ? new Date(ms).toISOString() : '';
}

function _marketBriefingMasterSheet_(ss) {
  var sh = ss.getSheetByName(MARKET_BRIEFING_MASTER_SHEET);
  if (!sh) {
    sh = ss.insertSheet(MARKET_BRIEFING_MASTER_SHEET);
    sh.getRange(1,1,1,MARKET_BRIEFING_MASTER_HEADERS.length).setValues([MARKET_BRIEFING_MASTER_HEADERS]);
  } else {
    var headers = sh.getRange(1,1,1,MARKET_BRIEFING_MASTER_HEADERS.length).getValues()[0];
    MARKET_BRIEFING_MASTER_HEADERS.forEach(function(header,index) {
      if (!String(headers[index] || '').trim()) sh.getRange(1,index+1).setValue(header);
    });
  }
  return sh;
}

function handleAppendMarketBriefingObservations(dataJson) {
  try {
    var rows = JSON.parse(dataJson || '[]');
    if (!Array.isArray(rows)) return jsonError('MARKET_MASTER 배열 형식 필요');
    if (!rows.length) return jsonOk({ saved: 0, duplicates: 0, rejected: 0, rejectionReasons: {} });
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    var ss = getss(), sh = _marketBriefingMasterSheet_(ss);
    var existing = {};
    if (sh.getLastRow() > 1) sh.getRange(2,1,sh.getLastRow()-1,14).getValues().forEach(function(r) {
      var existingObservedAt = r[8] ? (_marketBriefingIsoTimestamp_(r[8]) || String(r[8])) : '';
      var existingReceivedAt = r[9] ? (_marketBriefingIsoTimestamp_(r[9]) || String(r[9])) : '';
      existing[[String(r[0]),_normalizeDate(r[1])||'',String(r[4]||'UNKNOWN'),existingObservedAt,existingReceivedAt].join('|')] = true;
    });
    var values=[], duplicates=0, rejected=0, rejectionReasons={};
    function reject(reason) { rejected++; rejectionReasons[reason]=(rejectionReasons[reason]||0)+1; }
    rows.forEach(function(r) {
      var seriesId=String(r.seriesId||'').trim(), tradingDate=_normalizeDate(r.tradingDate||''), value=Number(r.value);
      var rawReceivedAt=String(r.receivedAt||'').trim(), rawObservedAt=String(r.observedAt||'').trim();
      var receivedAt=_marketBriefingIsoTimestamp_(rawReceivedAt), observedAt=rawObservedAt ? _marketBriefingIsoTimestamp_(rawObservedAt) : '';
      if (!seriesId || !tradingDate || !isFinite(value)) { reject('INVALID_REQUIRED_VALUE'); return; }
      if (!receivedAt) { reject('INVALID_RECEIVED_AT'); return; }
      if (rawObservedAt && !observedAt) { reject('INVALID_OBSERVED_AT'); return; }
      var receivedMs=Date.parse(receivedAt), observedMs=observedAt ? Date.parse(observedAt) : NaN;
      if (observedAt && observedMs > receivedMs) { reject('OBSERVED_AFTER_RECEIVED'); return; }
      var timestampQuality=observedAt ? 'OBSERVED' : 'RECEIVE_ONLY';
      var lagSeconds=observedAt ? Math.round((receivedMs-observedMs)/1000) : null;
      var key=[seriesId,tradingDate,String(r.session||'UNKNOWN'),observedAt,receivedAt].join('|');
      if (existing[key]) { duplicates++; return; }
      existing[key]=true;
      var sourceDate=_normalizeDate(r.sourceDate||'');
      values.push([seriesId,tradingDate,value,String(r.market||'UNKNOWN'),String(r.session||'UNKNOWN'),String(r.source||'UNKNOWN'),String(r.status||'PARTIAL'),r.finality==null?'':String(r.finality),observedAt,receivedAt,timestampQuality,lagSeconds==null?'':lagSeconds,Number.isInteger(r.revision)?r.revision:0,r.quality==null?'':String(r.quality),r.currency==null?'':String(r.currency),sourceDate,r.fallback===true]);
    });
    if (values.length) sh.getRange(sh.getLastRow()+1,1,values.length,MARKET_BRIEFING_MASTER_HEADERS.length).setValues(values);
    lock.releaseLock();
    return jsonOk({ saved: values.length, duplicates: duplicates, rejected: rejected, rejectionReasons: rejectionReasons });
  } catch(err) { try { if (lock) lock.releaseLock(); } catch(e) {} return jsonError('MARKET_MASTER 저장 실패: '+err.message); }
}

function handleGetMarketBriefingMaster(fromStr, toStr, seriesIdsInput) {
  try {
    var ss=getss(), sh=ss.getSheetByName(MARKET_BRIEFING_MASTER_SHEET);
    if (!sh || sh.getLastRow()<2) return jsonOk({ observations: [], invalid: 0, source: MARKET_BRIEFING_MASTER_SHEET });
    sh=_marketBriefingMasterSheet_(ss);
    var fromDate=_normalizeDate(fromStr||'')||'0000-01-01', toDate=_normalizeDate(toStr||'')||'9999-12-31';
    var ids=String(seriesIdsInput||'').split(',').map(function(v){return v.trim();}).filter(Boolean);
    var observations=[], invalid=0;
    sh.getRange(2,1,sh.getLastRow()-1,MARKET_BRIEFING_MASTER_HEADERS.length).getValues().forEach(function(r){
      var d=_normalizeDate(r[1]); if(!d||d<fromDate||d>toDate||(ids.length&&ids.indexOf(String(r[0]))===-1))return;
      var rawObservedAt=r[8] ? String(r[8]).trim() : '', observedAt=rawObservedAt ? _marketBriefingIsoTimestamp_(r[8]) : '';
      var receivedAt=_marketBriefingIsoTimestamp_(r[9]);
      if (!receivedAt || (rawObservedAt && !observedAt) || (observedAt && Date.parse(observedAt)>Date.parse(receivedAt))) { invalid++; return; }
      observations.push({seriesId:String(r[0]),tradingDate:d,value:Number(r[2]),market:String(r[3]),session:String(r[4]),source:String(r[5]),status:String(r[6]),finality:r[7]||null,observedAt:observedAt||null,receivedAt:receivedAt,timestampQuality:observedAt?'OBSERVED':'RECEIVE_ONLY',lagSeconds:observedAt?Math.round((Date.parse(receivedAt)-Date.parse(observedAt))/1000):null,revision:Number(r[12])||0,quality:r[13]||null,currency:r[14]||null,sourceDate:_normalizeDate(r[15]||'')||null,fallback:r[16]===true||String(r[16]).toUpperCase()==='TRUE'});
    });
    return jsonOk({ observations: observations, invalid: invalid, source: MARKET_BRIEFING_MASTER_SHEET });
  } catch(err) { return jsonError('MARKET_MASTER 조회 실패: '+err.message); }
}

var MARKET_BRIEFING_SNAPSHOT_SHEET = 'MARKET_SNAPSHOTS';
var MARKET_BRIEFING_CHECKPOINT_TIMES = { NIGHT_FINAL:'06:00:00', MORNING:'07:30:00', KRX_FINAL:'15:30:00', AFTER_FINAL:'20:00:00', EVENING:'20:15:00' };

function _marketBriefingSnapshotSheet_(ss) {
  var sh=ss.getSheetByName(MARKET_BRIEFING_SNAPSHOT_SHEET);
  if(!sh){sh=ss.insertSheet(MARKET_BRIEFING_SNAPSHOT_SHEET);sh.getRange(1,1,1,5).setValues([['trading_date','checkpoint','as_of','values_json','scenario_json']]);}
  return sh;
}

function _marketBriefingSnapshotAsOf_(tradingDate, checkpoint) {
  var time=MARKET_BRIEFING_CHECKPOINT_TIMES[checkpoint];
  return time ? _marketBriefingIsoTimestamp_(tradingDate+'T'+time+'+09:00') : '';
}

function _marketBriefingPlainObject_(value) {
  return value!==null && typeof value==='object' && !Array.isArray(value);
}

function handleAppendMarketBriefingSnapshot(dataJson) {
  var lock;
  try {
    var item=JSON.parse(dataJson||'{}'), d=_normalizeDate(item.tradingDate||''), cp=String(item.checkpoint||'');
    var asOf=_marketBriefingIsoTimestamp_(item.asOf), expectedAsOf=d ? _marketBriefingSnapshotAsOf_(d,cp) : '';
    if(!d||!MARKET_BRIEFING_CHECKPOINT_TIMES[cp]||!asOf||asOf!==expectedAsOf||!_marketBriefingPlainObject_(item.values)||!(item.scenario==null||_marketBriefingPlainObject_(item.scenario))) return jsonError('MARKET_SNAPSHOTS 필수값 오류');
    lock=LockService.getScriptLock();lock.waitLock(30000);
    var sh=_marketBriefingSnapshotSheet_(getss()), found=false;
    if(sh.getLastRow()>1) sh.getRange(2,1,sh.getLastRow()-1,2).getValues().some(function(r){if((_normalizeDate(r[0])||'')===d&&String(r[1])===cp){found=true;return true;}return false;});
    if(found){lock.releaseLock();return jsonOk({saved:0,immutable:true});}
    sh.appendRow([d,cp,asOf,JSON.stringify(item.values),item.scenario==null?'':JSON.stringify(item.scenario)]);
    lock.releaseLock();return jsonOk({saved:1,immutable:true});
  } catch(err){try{if(lock)lock.releaseLock();}catch(e){}return jsonError('MARKET_SNAPSHOTS 저장 실패: '+err.message);}
}

function handleGetMarketBriefingSnapshots(fromStr,toStr) {
  try {
    var sh=getss().getSheetByName(MARKET_BRIEFING_SNAPSHOT_SHEET);
    if(!sh||sh.getLastRow()<2)return jsonOk({snapshots:[],invalid:0,source:MARKET_BRIEFING_SNAPSHOT_SHEET});
    var from=_normalizeDate(fromStr||'')||'0000-01-01',to=_normalizeDate(toStr||'')||'9999-12-31',out=[],invalid=0;
    sh.getRange(2,1,sh.getLastRow()-1,5).getValues().forEach(function(r){
      var d=_normalizeDate(r[0]),cp=String(r[1]),asOf=_marketBriefingIsoTimestamp_(r[2]);
      if(!d||d<from||d>to)return;
      if(!MARKET_BRIEFING_CHECKPOINT_TIMES[cp]||!asOf||asOf!==_marketBriefingSnapshotAsOf_(d,cp)){invalid++;return;}
      var values,scenario=null;
      try{values=JSON.parse(String(r[3]||''));if(!_marketBriefingPlainObject_(values))throw new Error('invalid values');}catch(e){invalid++;return;}
      try{if(r[4]!==''&&r[4]!=null){scenario=JSON.parse(String(r[4]));if(!_marketBriefingPlainObject_(scenario))throw new Error('invalid scenario');}}catch(e2){invalid++;return;}
      out.push({tradingDate:d,checkpoint:cp,asOf:asOf,values:values,scenario:scenario});
    });
    return jsonOk({snapshots:out,invalid:invalid,source:MARKET_BRIEFING_SNAPSHOT_SHEET});
  } catch(err){return jsonError('MARKET_SNAPSHOTS 조회 실패: '+err.message);}
}

function handleSaveSyncIssues(source, dataJson) {
  try {
    var rows;
    try { rows = _parseArrayParam(dataJson, 'syncIssues'); } catch(e) { return jsonError(e.message); }
    if (!Array.isArray(rows)) return jsonError('배열 형식 필요');
    if (rows.length === 0) return jsonOk({ saved: 0 });

    var ss = getss();
    var sh = ss.getSheetByName(CONFIG.SHEET_SYNC_LOG);
    if (!sh) {
      sh = ss.insertSheet(CONFIG.SHEET_SYNC_LOG);
      sh.getRange(1,1,1,7).setValues([['기록시각','소스','거래일','종목코드','종목명','계좌','메시지']]);
    }

    var now = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    var values = rows.map(function(r) {
      return [
        now,
        (source || 'unknown').toString(),
        (r.date || '').toString(),
        _cleanCode(r.code || ''),
        (r.name || '').toString(),
        (r.acct || '').toString(),
        (r.message || '기초정보 미매칭').toString()
      ];
    });
    sh.getRange(sh.getLastRow() + 1, 1, values.length, 7).setValues(values);
    return jsonOk({ saved: values.length });
  } catch(err) {
    return jsonError('saveSyncIssues 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  Toss Securities Open API 시장데이터 provider
//  공식 사양: https://openapi.tossinvest.com/openapi-docs/latest/openapi.json
//  Client ID/Secret은 Script Properties에만 저장하며 로그·응답에 포함하지 않습니다.
// ════════════════════════════════════════════════════════════════════
var TOSS_API_BASE = 'https://openapi.tossinvest.com';
var TOSS_TOKEN_CACHE_KEY = 'toss_oauth_token_v1';
var TOSS_TOKEN_SKEW_SECONDS = 60;

function _tossProperties_() {
  var props = PropertiesService.getScriptProperties();
  return { id: String(props.getProperty('TOSS_CLIENT_ID') || '').trim(), secret: String(props.getProperty('TOSS_CLIENT_SECRET') || '').trim() };
}

function _tossCachedTokenRecord_() {
  var cached = CacheService.getScriptCache().get(TOSS_TOKEN_CACHE_KEY);
  if (!cached) return null;
  try {
    var token = JSON.parse(cached);
    return token && token.accessToken ? token : null;
  } catch (e) { return null; }
}

function _tossCachedAccessToken_() {
  var token = _tossCachedTokenRecord_();
  return token && Number(token.expiresAt) > Date.now() + TOSS_TOKEN_SKEW_SECONDS * 1000 ? token.accessToken : '';
}

function _tossIssueAccessTokenUnlocked_() {
  var credentials = _tossProperties_();
  if (!credentials.id || !credentials.secret) return '';
  var response = UrlFetchApp.fetch(TOSS_API_BASE + '/oauth2/token', {
    method: 'post', contentType: 'application/x-www-form-urlencoded', muteHttpExceptions: true,
    payload: { grant_type: 'client_credentials', client_id: credentials.id, client_secret: credentials.secret }
  });
  var status = response.getResponseCode();
  var body = response.getContentText() || '{}';
  if (status < 200 || status >= 300) throw new Error('Toss OAuth 실패(' + status + '): ' + _tossSafeError_(body));
  var data = JSON.parse(body);
  if (data.token_type !== 'Bearer' || !data.access_token || !Number(data.expires_in)) throw new Error('Toss OAuth 응답 필드 불일치');
  var expiresAt = Date.now() + Number(data.expires_in) * 1000;
  CacheService.getScriptCache().put(TOSS_TOKEN_CACHE_KEY, JSON.stringify({ accessToken: data.access_token, expiresAt: expiresAt }), Math.max(1, Math.min(21600, Number(data.expires_in) - TOSS_TOKEN_SKEW_SECONDS)));
  return data.access_token;
}

function _tossWithTokenLock_(callback) {
  var lock = typeof LockService !== 'undefined' && LockService.getScriptLock ? LockService.getScriptLock() : null;
  var acquiredHere = false;
  try {
    if (lock && (!lock.hasLock || !lock.hasLock())) {
      lock.waitLock(10000);
      acquiredHere = true;
    }
    return callback();
  } finally {
    if (acquiredHere && lock && lock.releaseLock) lock.releaseLock();
  }
}

function _tossAccessToken_() {
  var cachedToken = _tossCachedAccessToken_();
  if (cachedToken) return cachedToken;

  // Toss는 새 client_credentials token 발급 시 기존 token이 무효화될 수 있으므로,
  // cache miss 동시 실행을 single-flight로 직렬화합니다.
  return _tossWithTokenLock_(function() {
    // 다른 실행이 lock 대기 중 token을 발급했을 수 있으므로 반드시 재확인합니다.
    var tokenAfterLock = _tossCachedAccessToken_();
    return tokenAfterLock || _tossIssueAccessTokenUnlocked_();
  });
}

function _refreshTossAccessTokenAfter401_(rejectedToken) {
  return _tossWithTokenLock_(function() {
    var cache = CacheService.getScriptCache();
    var current = _tossCachedTokenRecord_();
    var currentValid = current && Number(current.expiresAt) > Date.now() + TOSS_TOKEN_SKEW_SECONDS * 1000;

    // lock 대기 중 다른 실행이 이미 새 token으로 교체했다면 그 token을 그대로 사용합니다.
    if (currentValid && current.accessToken !== rejectedToken) return current.accessToken;

    // 현재 cache가 실제 rejected token이거나 만료/손상 상태일 때만 제거합니다.
    if (!current || !currentValid || current.accessToken === rejectedToken) cache.remove(TOSS_TOKEN_CACHE_KEY);
    return _tossIssueAccessTokenUnlocked_();
  });
}

function _tossSafeError_(body) {
  try { var parsed = JSON.parse(body); return String(parsed.error?.code || parsed.error || parsed.error_description || 'unknown'); } catch (e) { return 'invalid-response'; }
}

function _tossDiagnosticIdValue_(value) {
  var text = String(value == null ? '' : value).replace(/[\r\n\t]/g, '').trim();
  return text.length > 256 ? text.slice(0, 256) : text;
}

function _tossDiagnosticHeader_(headers, name) {
  var target = String(name || '').toLowerCase(), keys = Object.keys(headers || {});
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i]).toLowerCase() !== target) continue;
    var value = headers[keys[i]];
    if (Array.isArray(value)) value = value[0];
    return _tossDiagnosticIdValue_(value);
  }
  return '';
}

function _tossDiagnosticIdentifiers_(response, parsed) {
  var headers = {};
  try { headers = response && response.getAllHeaders ? (response.getAllHeaders() || {}) : {}; } catch (ignore) {}
  var body = parsed && typeof parsed === 'object' ? parsed : {};
  var error = body.error && typeof body.error === 'object' ? body.error : {};
  return {
    requestId: _tossDiagnosticIdValue_(error.requestId || error.request_id || body.requestId || body.request_id ||
      _tossDiagnosticHeader_(headers, 'x-request-id') || _tossDiagnosticHeader_(headers, 'x-amzn-requestid')),
    referenceId: _tossDiagnosticIdValue_(error.referenceId || error.reference_id || body.referenceId || body.reference_id ||
      _tossDiagnosticHeader_(headers, 'x-reference-id')),
    edgeRequestId: _tossDiagnosticIdValue_(_tossDiagnosticHeader_(headers, 'x-amz-cf-id'))
  };
}

function _isValidIpv4_(value) {
  var text = String(value || '').trim();
  var parts = text.split('.');
  return parts.length === 4 && parts.every(function(part) {
    return /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255;
  });
}

function _isValidIpv6_(value) {
  var text = String(value || '').trim().toLowerCase();
  if (!text || text.indexOf(':') === -1 || text.indexOf('%') !== -1) return false;

  // IPv4-mapped IPv6처럼 마지막 32bit가 dotted-decimal인 형태도 허용합니다.
  var lastColon = text.lastIndexOf(':');
  var tail = lastColon >= 0 ? text.slice(lastColon + 1) : '';
  if (tail.indexOf('.') !== -1) {
    if (!_isValidIpv4_(tail)) return false;
    text = text.slice(0, lastColon + 1) + '0:0';
  }

  var compressedAt = text.indexOf('::');
  if (compressedAt !== -1 && text.indexOf('::', compressedAt + 2) !== -1) return false;

  var parts;
  if (compressedAt !== -1) {
    var sides = text.split('::');
    if (sides.length !== 2) return false;
    var left = sides[0] ? sides[0].split(':') : [];
    var right = sides[1] ? sides[1].split(':') : [];
    parts = left.concat(right);
    if (parts.length >= 8) return false; // :: 는 최소 1개 hextet을 압축해야 합니다.
  } else {
    parts = text.split(':');
    if (parts.length !== 8) return false;
  }
  return parts.every(function(part) { return /^[0-9a-f]{1,4}$/.test(part); });
}

function _diagnosticIpFamily_(value) {
  return _isValidIpv4_(value) ? 'IPv4' : (_isValidIpv6_(value) ? 'IPv6' : '');
}

// 진단 전용: 외부 서비스가 관측한 UrlFetchApp 출구 IP를 참고값으로 반환합니다.
// Toss 요청도 반드시 같은 NAT/egress IP를 사용한다고 보장되지는 않습니다.
function _probeTossDiagnosticEgressIp_() {
  var startedAt = Date.now(), attempts = [];
  var providers = [
    { name: 'checkip.amazonaws.com', url: 'https://checkip.amazonaws.com/' },
    { name: 'api.ipify.org', url: 'https://api.ipify.org' }
  ];
  for (var i = 0; i < providers.length; i++) {
    var providerStartedAt = Date.now(), provider = providers[i];
    try {
      var response = UrlFetchApp.fetch(provider.url, { method: 'get', muteHttpExceptions: true });
      var status = response.getResponseCode();
      var body = String(response.getContentText() || '').trim();
      var headers = {};
      try { headers = response.getAllHeaders ? (response.getAllHeaders() || {}) : {}; } catch (ignoreHeaders) {}
      var contentType = _tossDiagnosticIdValue_(_tossDiagnosticHeader_(headers, 'content-type'));
      var candidate = body;
      var ipFamily = _diagnosticIpFamily_(candidate);
      if (!ipFamily) {
        try {
          var parsed = JSON.parse(body || '{}');
          candidate = parsed && parsed.ip ? String(parsed.ip).trim() : '';
          ipFamily = _diagnosticIpFamily_(candidate);
        } catch (ignoreJson) {
          candidate = '';
          ipFamily = '';
        }
      }
      var ip = ipFamily ? candidate : '';
      var attemptCode = status >= 200 && status < 300 ? (ip ? 'OK' : 'INVALID_IP_RESPONSE') : 'HTTP_ERROR';
      attempts.push({
        provider: provider.name, status: status, code: attemptCode, ipFamily: ipFamily || '',
        bodyLength: body.length, contentType: contentType, elapsedMs: Date.now() - providerStartedAt
      });
      if (status >= 200 && status < 300 && ip) return {
        ok: true, status: status, ip: ip, ipFamily: ipFamily, provider: provider.name, code: 'OK',
        observedOnly: true, attempts: attempts, elapsedMs: Date.now() - startedAt
      };
    } catch (err) {
      attempts.push({
        provider: provider.name, status: null, code: 'REQUEST_ERROR',
        bodyLength: 0, contentType: '', elapsedMs: Date.now() - providerStartedAt
      });
    }
  }
  var last = attempts.length ? attempts[attempts.length - 1] : {};
  return {
    ok: false, status: last.status == null ? null : last.status, ip: '', ipFamily: '',
    provider: last.provider || '', code: last.code || 'REQUEST_ERROR',
    observedOnly: true, attempts: attempts, elapsedMs: Date.now() - startedAt
  };
}

// 연결 진단은 cache hit을 HTTP 200으로 오표시하지 않도록 OAuth endpoint를 매번 한 번 검증합니다.
function _tossDiagnosticAccessToken_() {
  var startedAt = Date.now();
  return _tossWithTokenLock_(function() {
  // lock 대기 중 설정이 바뀔 수 있으므로 자격증명은 반드시 lock 획득 후 다시 읽습니다.
  var credentials = _tossProperties_();
  if (!credentials.id || !credentials.secret) return { ok: false, status: null, code: 'CREDENTIALS_NOT_CONFIGURED', providerCode: '', source: 'NONE', token: '', requestId: '', referenceId: '', edgeRequestId: '', elapsedMs: Date.now() - startedAt };
  var response = UrlFetchApp.fetch(TOSS_API_BASE + '/oauth2/token', {
    method: 'post', contentType: 'application/x-www-form-urlencoded', muteHttpExceptions: true,
    payload: { grant_type: 'client_credentials', client_id: credentials.id, client_secret: credentials.secret }
  });
  var status = response.getResponseCode(), body = response.getContentText() || '{}', data = {};
  try { data = JSON.parse(body); } catch (ignore) {}
  var ids = _tossDiagnosticIdentifiers_(response, data);
  if (status < 200 || status >= 300) return {
    ok: false, status: status, code: 'OAUTH_FAILED', providerCode: _tossSafeError_(body), source: 'NETWORK', token: '',
    requestId: ids.requestId, referenceId: ids.referenceId, edgeRequestId: ids.edgeRequestId, elapsedMs: Date.now() - startedAt
  };
  if (data.token_type !== 'Bearer' || !data.access_token || !Number(data.expires_in)) return {
    ok: false, status: status, code: 'OAUTH_RESPONSE_INVALID', providerCode: '', source: 'NETWORK', token: '',
    requestId: ids.requestId, referenceId: ids.referenceId, edgeRequestId: ids.edgeRequestId, elapsedMs: Date.now() - startedAt
  };
  var expiresAt = Date.now() + Number(data.expires_in) * 1000;
  CacheService.getScriptCache().put(TOSS_TOKEN_CACHE_KEY, JSON.stringify({ accessToken: data.access_token, expiresAt: expiresAt }), Math.max(1, Math.min(21600, Number(data.expires_in) - TOSS_TOKEN_SKEW_SECONDS)));
  return {
    ok: true, status: status, code: 'OK', providerCode: '', source: 'NETWORK', token: data.access_token,
    requestId: ids.requestId, referenceId: ids.referenceId, edgeRequestId: ids.edgeRequestId, elapsedMs: Date.now() - startedAt
  };
  });
}
function _priceTimingAdd_(timings, key, startedMs) {
  if (!timings || !key || !Number.isFinite(Number(startedMs))) return;
  timings[key] = Math.max(0, Number(timings[key] || 0) + Math.max(0, Date.now() - startedMs));
}

function _newPriceLookupTimings_() {
  return {
    setup: 0, codeItems: 0, initialPriceHistory: 0, tossToken: 0,
    tossPricesHttp: 0, krx: 0, recentHistory: 0, snapshot: 0,
    other: 0, finalize: 0
  };
}

function _tossRequest_(path, query, group, timings) {
  var tokenStartedMs = Date.now();
  var token = _tossAccessToken_();
  _priceTimingAdd_(timings, 'tossToken', tokenStartedMs);
  if (!token) return null;
  var params = [];
  Object.keys(query || {}).forEach(function(key) { if (query[key] !== '' && query[key] != null) params.push(encodeURIComponent(key) + '=' + encodeURIComponent(query[key])); });
  var url = TOSS_API_BASE + path + (params.length ? '?' + params.join('&') : '');
  var maxAttempts = 4;
  var oauthRecoveryUsed = false;
  var httpStartedMs = Date.now();
  for (var attempt = 0; attempt < maxAttempts; attempt++) {
    var response;
    try {
      response = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, muteHttpExceptions: true });
    } catch (fetchErr) {
      _priceTimingAdd_(timings, 'tossPricesHttp', httpStartedMs);
      throw fetchErr;
    }
    var status = response.getResponseCode();
    if (status >= 200 && status < 300) {
      try {
        var parsed = JSON.parse(response.getContentText() || '{}');
        _priceTimingAdd_(timings, 'tossPricesHttp', httpStartedMs);
        return parsed;
      } catch (parseErr) {
        _priceTimingAdd_(timings, 'tossPricesHttp', httpStartedMs);
        throw parseErr;
      }
    }
    if (status === 401 && !oauthRecoveryUsed) {
      oauthRecoveryUsed = true;
      var refreshStartedMs = Date.now();
      token = _refreshTossAccessTokenAfter401_(token);
      _priceTimingAdd_(timings, 'tossToken', refreshStartedMs);
      if (!token) {
        _priceTimingAdd_(timings, 'tossPricesHttp', httpStartedMs);
        throw new Error('Toss OAuth 재발급 결과 없음');
      }
      // 401 recovery는 429/5xx retry budget을 소비하지 않습니다.
      attempt--;
      continue;
    }
    var headers = response.getAllHeaders ? response.getAllHeaders() : {};
    var retryAfter = Number(headers['Retry-After'] || headers['retry-after'] || 0);
    var rateReset = Number(headers['X-RateLimit-Reset'] || headers['x-ratelimit-reset'] || 0);
    if (status !== 429 && status < 500) {
      _priceTimingAdd_(timings, 'tossPricesHttp', httpStartedMs);
      throw new Error('Toss API 실패(' + status + '): ' + _tossSafeError_(response.getContentText() || ''));
    }
    if (attempt === maxAttempts - 1) {
      _priceTimingAdd_(timings, 'tossPricesHttp', httpStartedMs);
      throw new Error('Toss API 재시도 초과(' + status + ')');
    }
    var waitMs = retryAfter > 0
      ? retryAfter * 1000
      : (rateReset > 0 ? rateReset * 1000 : Math.min(4000, 250 * Math.pow(2, attempt)) + Math.floor(Math.random() * 250));
    Utilities.sleep(waitMs);
  }
  return null;
}

function _tossSymbol_(item) { return String(item.tossSymbol || item.code || '').trim(); }

function _normalizeTossSymbol_(value) {
  var symbol = String(value == null ? '' : value).trim().toUpperCase();
  return symbol.replace(/^A(?=\d{6}$)/, '');
}

function fetchPricesToss(items, timings, providerMeta) {
  var requestedBySymbol = {};
  var symbols = (items || []).map(function(item) {
    var requested = _tossSymbol_(item);
    var normalized = _normalizeTossSymbol_(requested);
    if (normalized) requestedBySymbol[normalized] = requested || normalized;
    return normalized;
  }).filter(Boolean);
  var credentials = _tossProperties_();
  if (!symbols.length || symbols.length > 200 || !credentials.id || !credentials.secret) {
    if (providerMeta) {
      providerMeta.attempted = false;
      providerMeta.status = 'NOT_RUN';
      providerMeta.reason = !symbols.length ? 'NO_SYMBOLS' : (symbols.length > 200 ? 'TOO_MANY_SYMBOLS' : 'CREDENTIALS_NOT_CONFIGURED');
    }
    return {};
  }
  if (providerMeta) {
    providerMeta.attempted = true;
    providerMeta.status = 'REQUESTING';
    providerMeta.reason = '';
  }
  var payload = _tossRequest_('/api/v1/prices', { symbols: symbols.join(',') }, 'MARKET_DATA', timings);
  var rows = payload && Array.isArray(payload.result) ? payload.result : [];
  var prices = {};
  rows.forEach(function(row) {
    var price = Number(row.lastPrice);
    var symbol = _normalizeTossSymbol_(row.symbol);
    if (!symbol || !Number.isFinite(price) || price <= 0 || !row.currency) return;
    var requestedCode = requestedBySymbol[symbol] || symbol;
    prices[requestedCode] = { price: price, currency: String(row.currency), timestamp: row.timestamp || null, source: 'TOSS', priceType: 'REALTIME', status: 'INDICATIVE', fetchedAt: new Date().toISOString() };
  });
  if (providerMeta) providerMeta.status = Object.keys(prices).length > 0 ? 'SUCCESS' : 'EMPTY';
  return prices;
}

function fetchHistoricalPricesToss(items, targetDate) {
  var output = {};
  (items || []).forEach(function(item) {
    var symbol = _tossSymbol_(item);
    if (!symbol || !_tossProperties_().id) return;
    var before = '';
    var guard = 0;
    while (guard++ < 100) {
      var payload = _tossRequest_('/api/v1/candles', { symbol: symbol, interval: '1d', count: 200, before: before, adjusted: 'false' }, 'MARKET_DATA_CHART');
      var page = payload && payload.result;
      if (!page || !Array.isArray(page.candles)) break;
      var found = page.candles.filter(function(c) { return String(c.timestamp || '').slice(0, 10) === targetDate; })[0];
      if (found && Number(found.closePrice) > 0) {
        output[item.code] = { price: Number(found.closePrice), usedDate: targetDate, marketDate: targetDate, market: item.market || (String(found.currency) === 'USD' ? 'US' : 'KR'), currency: String(found.currency || item.currency || 'KRW'), source: 'TOSS', priceType: 'DAILY_CANDLE', status: 'UNVERIFIED_CLOSE', fetchedAt: new Date().toISOString() };
        break;
      }
      var next = page.nextBefore;
      if (!next || (page.candles.length && String(page.candles[page.candles.length - 1].timestamp).slice(0, 10) < targetDate)) break;
      if (next === before) break;
      before = next;
    }
  });
  return output;
}

// 운영 점검용 read-only 호출. 자격증명·토큰·원문 응답은 반환하거나 로그에 남기지 않습니다.
function _tossDiagnosticRequest_(path, query, token) {
  var startedAt = Date.now();
  try {
    if (!token) return { ok: false, status: null, code: 'CREDENTIALS_NOT_CONFIGURED', elapsedMs: Date.now() - startedAt };
    var params = [];
    Object.keys(query || {}).forEach(function(key) {
      if (query[key] !== '' && query[key] != null) params.push(encodeURIComponent(key) + '=' + encodeURIComponent(query[key]));
    });
    var response = UrlFetchApp.fetch(TOSS_API_BASE + path + (params.length ? '?' + params.join('&') : ''), {
      method: 'get', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, muteHttpExceptions: true
    });
    var status = response.getResponseCode();
    var body = response.getContentText() || '{}';
    var parsed = {};
    try { parsed = JSON.parse(body); } catch (e) {}
    var error = parsed && parsed.error ? parsed.error : {};
    var ids = _tossDiagnosticIdentifiers_(response, parsed);
    var result = parsed && parsed.result;
    var count = Array.isArray(result) ? result.length : (result && typeof result === 'object' ? Object.keys(result).length : 0);
    return {
      ok: status >= 200 && status < 300,
      status: status,
      code: status === 403 ? 'IP_NOT_ALLOWED_OR_FORBIDDEN' : (status >= 200 && status < 300 ? 'OK' : String(error.code || 'HTTP_ERROR')),
      requestId: ids.requestId, referenceId: ids.referenceId, edgeRequestId: ids.edgeRequestId, count: count,
      elapsedMs: Date.now() - startedAt
    };
  } catch (err) {
    var message = String(err && err.message || '');
    return { ok: false, status: message.indexOf('(403)') !== -1 ? 403 : null, code: message.indexOf('(403)') !== -1 ? 'IP_NOT_ALLOWED_OR_FORBIDDEN' : 'REQUEST_ERROR', elapsedMs: Date.now() - startedAt };
  }
}

function _tossPriceSmoke_(token) {
  var startedAt = Date.now();
  try {
    if (!token) return { ok: false, status: null, resultCount: 0, symbol: '005930', validLastPrice: false, timestampPresent: false, elapsedMs: Date.now() - startedAt };
    var response = UrlFetchApp.fetch(TOSS_API_BASE + '/api/v1/prices?symbols=005930', {
      method: 'get', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, muteHttpExceptions: true
    });
    var status = response.getResponseCode();
    var parsed = {};
    try { parsed = JSON.parse(response.getContentText() || '{}'); } catch (ignore) {}
    var ids = _tossDiagnosticIdentifiers_(response, parsed);
    var rows = parsed && Array.isArray(parsed.result) ? parsed.result : [];
    var row = rows.filter(function(item) { return _normalizeTossSymbol_(item && item.symbol) === '005930'; })[0] || null;
    var price = row ? Number(row.lastPrice) : 0;
    var transportOk = status >= 200 && status < 300;
    var validLastPrice = Number.isFinite(price) && price > 0;
    var timestampPresent = !!(row && row.timestamp);
    var code = status === 403 ? 'IP_NOT_ALLOWED_OR_FORBIDDEN' : (!transportOk ? 'HTTP_ERROR' :
      (!rows.length ? 'PRICE_SMOKE_EMPTY' : (!row ? 'PRICE_SMOKE_SYMBOL_MISSING' :
      (!validLastPrice ? 'PRICE_SMOKE_INVALID_PRICE' : (!timestampPresent ? 'PRICE_SMOKE_TIMESTAMP_MISSING' : 'OK')))));
    return {
      ok: transportOk && code === 'OK',
      status: status,
      code: code,
      resultCount: rows.length,
      symbol: row ? _normalizeTossSymbol_(row.symbol) : '',
      validLastPrice: validLastPrice,
      timestampPresent: timestampPresent,
      requestId: ids.requestId,
      referenceId: ids.referenceId,
      edgeRequestId: ids.edgeRequestId,
      elapsedMs: Date.now() - startedAt
    };
  } catch (err) {
    return { ok: false, status: null, code: 'REQUEST_ERROR', resultCount: 0, symbol: '005930', validLastPrice: false, timestampPresent: false, elapsedMs: Date.now() - startedAt };
  }
}

function handleDiagnoseTossMarketData() {
  var token = '', oauth;
  var egressProbe = _probeTossDiagnosticEgressIp_();
  try {
    var oauthResult = _tossDiagnosticAccessToken_();
    token = oauthResult.token || '';
    oauth = { stage: 'oauth', ok: oauthResult.ok, status: oauthResult.status, code: oauthResult.code,
      providerCode: oauthResult.providerCode, source: oauthResult.source, requestId: oauthResult.requestId || '',
      referenceId: oauthResult.referenceId || '', edgeRequestId: oauthResult.edgeRequestId || '', elapsedMs: oauthResult.elapsedMs };
  } catch (oauthError) {
    oauth = { stage: 'oauth', ok: false, status: null, code: 'OAUTH_REQUEST_ERROR', providerCode: '', source: 'NETWORK', elapsedMs: 0 };
  }
  var checks = [];
  var run = function(name, path, query) {
    if (!oauth.ok) {
      checks.push({ name: name, endpoint: path, ok: false, status: null, code: 'SKIPPED_OAUTH_FAILED', requestId: '', referenceId: '', edgeRequestId: '', count: 0, elapsedMs: 0 });
      return;
    }
    var item = _tossDiagnosticRequest_(path, query, token);
    checks.push({ name: name, endpoint: path, ok: !!item.ok, status: item.status, code: item.code,
      requestId: item.requestId || '', referenceId: item.referenceId || '', edgeRequestId: item.edgeRequestId || '',
      count: item.count || 0, elapsedMs: item.elapsedMs });
  };
  run('exchangeRate', '/api/v1/exchange-rate', { baseCurrency: 'USD', quoteCurrency: 'KRW' });
  run('marketCalendarKR', '/api/v1/market-calendar/KR', { date: today() });
  run('marketCalendarUS', '/api/v1/market-calendar/US', { date: Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd') });
  run('marketIndicatorPrices', '/api/v1/market-indicators/prices', { symbols: 'KOSPI,KOSDAQ' });
  run('marketIndicatorCandles', '/api/v1/market-indicators/KOSPI/candles', { interval: '1d', count: 1 });
  var smoke = oauth.ok ? _tossPriceSmoke_(token) : { ok: false, status: null, code: 'SKIPPED_OAUTH_FAILED', resultCount: 0, symbol: '005930', validLastPrice: false, timestampPresent: false, elapsedMs: 0 };
  var overallOk = oauth.ok && checks.every(function(item) { return item.ok; }) && smoke.ok && smoke.validLastPrice && smoke.timestampPresent;
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty('TOSS_LAST_DIAGNOSTIC_AT', new Date().toISOString());
    props.setProperty('TOSS_LAST_DIAGNOSTIC_OK', overallOk ? 'true' : 'false');
    props.setProperty('TOSS_LAST_DIAGNOSTIC_CODE', overallOk ? 'OK' : (!oauth.ok ? oauth.code : ((checks.find(function(item) { return !item.ok; }) || {}).code || smoke.code || 'ERROR')));
  } catch(ignore) {}
  return jsonOk({ diagnostic: 'toss-market-data', generatedAt: new Date().toISOString(), ok: overallOk, egressProbe: egressProbe, oauth: oauth, endpoints: checks, priceSmoke: smoke });
}

// ════════════════════════════════════════════════════════════════════
//  종가 조회 — Toss 우선, 기존 정상 공급원 fallback
// ════════════════════════════════════════════════════════════════════
function handlePriceFetch(dateParam, allCodesParam) {
  try {
    var ss       = getss();
    var todayStr = today();
    var reqDate  = dateParam || todayStr;
    if (reqDate !== todayStr) return handleHistoricalPriceFetch(reqDate, allCodesParam, ss);

    var priceSheet = ss.getSheetByName(CONFIG.SHEET_PRICES);
    if (priceSheet && priceSheet.getLastRow() >= 2) {
      var data   = priceSheet.getRange(2, 1, priceSheet.getLastRow() - 1, 4).getValues();
      var prices = {};
      data.forEach(function(row) {
        var code  = (row[0] || '').toString().trim();
        var price = parseFloat(row[1]) || 0;
        var name  = (row[2] || '').toString().trim();
        if (code && price > 0) prices[code] = { price: price, name: name, officialName: name };
      });
      if (Object.keys(prices).length > 0) {
        return jsonOk({ date: reqDate, count: Object.keys(prices).length, prices: prices, source: 'cache',
          missingCodes: calcMissing(allCodesParam, Object.keys(prices)) });
      }
    }
    return handleHistoricalPriceFetch(todayStr, allCodesParam, ss);
  } catch(err) {
    return jsonError(err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  특정일 종가 — GOOGLEFINANCE close
// ════════════════════════════════════════════════════════════════════
function handleHistoricalPriceFetch(dateStr, allCodesParam, ss) {
  try {
    var items = getCodeItems(ss);
    if (items.length === 0) return jsonError('종목코드 없음. initSheet() 먼저 실행하세요.');
    // Toss 일봉은 정규장 종가 검증 상태가 아니므로 확정 과거가격 응답에서 제외합니다.
    var prices = fetchPricesGoogleFinance(items, dateStr, ss);
    return jsonOk({ date: dateStr, count: Object.keys(prices).length, prices: prices,
      source: 'confirmed-close', tossCount: 0,
      missingCodes: calcMissing(allCodesParam, Object.keys(prices)) });
  } catch(err) {
    return jsonError('특정일 조회 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  GOOGLEFINANCE 가격 조회 핵심
// ════════════════════════════════════════════════════════════════════
function _yahooEquitySymbol_(item) {
  var code = _cleanCode(item && item.code);
  if (!code) return '';
  var market = String(item.market || '').toUpperCase();
  // 내부 식별자는 그대로 보존하고 공급자별 접미사는 조회 시점에만 적용합니다.
  if (market === 'US' || String(item.currency || '').toUpperCase() === 'USD') return String(item.yahooSymbol || code);
  if (market === 'JP' || market === 'TSE') return String(item.yahooSymbol || (code + '.T'));
  if (market === 'HK' || market === 'HKEX') return String(item.yahooSymbol || (code + '.HK'));
  return String(item.yahooSymbol || '');
}

function fetchPricesYahooRegularClose(items, dateStr) {
  var output = {};
  (items || []).forEach(function(item) {
    var symbol = _yahooEquitySymbol_(item);
    if (!symbol) return;
    var start = Math.floor(new Date(dateStr + 'T00:00:00Z').getTime() / 1000);
    var response = _yahooRequest_(symbol, { period1: start, period2: start + 172800, interval: '1d', events: 'history', includeAdjustedClose: 'false' });
    if (!response.payload) { Logger.log('⚠️ Yahoo 확정 종가 조회 실패(' + item.code + '): ' + (response.error || response.status)); return; }
    var parsed = _parseYahooChart_(response.payload, item.market === 'US' ? 'America/New_York' : CONFIG.TIMEZONE);
    var point = parsed && parsed.points.filter(function(row) { return row.date === dateStr; })[0];
    if (!point || !(point.value > 0)) return; // 다른 거래일·현재가로 대체하지 않습니다.
    output[item.code] = { price: point.value, usedDate: dateStr, marketDate: dateStr,
      market: item.market || '', currency: item.currency || '', providerSymbol: symbol,
      source: 'YAHOO_REGULAR_CLOSE', priceType: 'REGULAR_CLOSE', status: 'CONFIRMED', fetchedAt: new Date().toISOString() };
  });
  return output;
}

function _isConfirmedHistoryPrice_(value, dateStr) {
  return !!value && Number(value.price) > 0 && value.status === 'CONFIRMED' && value.priceType === 'REGULAR_CLOSE'
    && _normalizeDate(value.marketDate || value.usedDate) === _normalizeDate(dateStr);
}

function fetchPricesGoogleFinance(items, dateStr, ss, options) {
  // 주식·ETF 가격에는 GOOGLEFINANCE를 사용하지 않습니다. 함수명은 하위 호출 호환용입니다.
  var prices = {};
  var gfItems = items.slice();

  // 확정 Snapshot은 국내 자산의 KRX TDD_CLSPRC를 우선합니다. Toss lastPrice와
  // 검증되지 않은 일봉 closePrice는 현재가 화면에는 쓸 수 있지만 확정 종가로 저장하지 않습니다.
  if (gfItems.length > 0) {
    try {
      var krxItems = gfItems.filter(function(item) { return String(item.currency || 'KRW').toUpperCase() === 'KRW' || String(item.market || '').toUpperCase() === 'KR'; });
      var krxPrices = fetchPricesKrx(krxItems, dateStr);
      Object.keys(krxPrices).forEach(function(code) { prices[code] = krxPrices[code]; });
      gfItems = items.filter(function(item) { return !(prices[item.code] && prices[item.code].price > 0); });
      Logger.log('[price-source] 확정 KRX ' + Object.keys(krxPrices).length + '건, 저장된 확정 이력 fallback 대상 ' + gfItems.length + '건');
    } catch (e) {
      Logger.log('⚠️ 기존 비-GOOGLE 가격 조회 실패: ' + e.message);
      gfItems = items.slice();
    }
  }

  // 국내 공식 종가가 없는 해외 자산은 기존 Yahoo 일봉 공급 경로에서 요청일의
  // regular-session close가 정확히 존재하는 경우에만 확정값으로 채웁니다.
  var overseasItems = gfItems.filter(function(item) {
    return String(item.currency || 'KRW').toUpperCase() !== 'KRW' && String(item.market || '').toUpperCase() !== 'KR';
  });
  var overseasPrices = fetchPricesYahooRegularClose(overseasItems, dateStr);
  Object.keys(overseasPrices).forEach(function(code) {
    if (_isConfirmedHistoryPrice_(overseasPrices[code], dateStr)) prices[code] = overseasPrices[code];
  });

  // 실패·누락은 저장 확정값 보존을 위해 빈 결과로 반환합니다.
  return prices;

}

function fetchPricesKrx(items, dateStr) {
  if (!items || items.length === 0) return {};
  var cfg = _getKrxApiConfig();
  var ymd = (dateStr || '').replace(/-/g, '');
  if (!/^\d{8}$/.test(ymd)) return {};

  if (!cfg.apiKey) {
    Logger.log('ℹ️ KRX AUTH_KEY 미설정: KRX OTP/CSV 조회 시도');
    return fetchPricesKrxViaOtp(items, dateStr);
  }

  var wanted = {};
  items.forEach(function(item) { wanted[item.code] = item; });
  var out = {};
  var codeMarkets = {};
  var markets = ['KOSPI', 'KOSDAQ', 'ETF'];
  var packs = _fetchKrxMarketsParallelWithFallback(markets, ymd, cfg.apiKey, 7);
  markets.forEach(function(market) {
    try {
      var pack = packs[market] || { rows: [], usedYmd: ymd };
      var rows = pack.rows;
      // ★ fallback 발생 시 로그 및 실제 날짜 기록
      var usedDate = pack.usedYmd.slice(0,4) + '-' + pack.usedYmd.slice(4,6) + '-' + pack.usedYmd.slice(6,8);
      if (pack.usedYmd !== ymd) Logger.log('ℹ️ ' + market + ' ' + ymd + ' 당일 데이터 없음 → 직전 거래일 ' + pack.usedYmd + ' 사용');
      (rows || []).forEach(function(r) {
        var code = _cleanCode(r.ISU_CD || r.ISU_SRT_CD || '');
        if (!wanted[code]) return;
        // 종목코드 마스터에 market='KR'만 있어도 실제 응답 시장을 알아야 합니다.
        // 가격이 0이거나 누락돼도 pack에 코드가 존재한다면 해당 시장으로 분류합니다.
        codeMarkets[code] = market;
        var p = _parseKrxNumber(r.TDD_CLSPRC);
        if (!(p > 0)) return;
        out[code] = {
          price: p,
          name: wanted[code].name,
          officialName: (r.ISU_NM || wanted[code].name || code),
          source: 'KRX',
          usedDate: usedDate  // ★ 실제 데이터 날짜 포함
        };
      });
    } catch (e) {
      Logger.log('⚠️ KRX OpenAPI 조회 실패(' + market + '): ' + e.message);
    }
  });
  if (Object.keys(out).length === 0) {
    Logger.log('ℹ️ KRX OpenAPI 결과 없음: OTP/CSV fallback 시도');
    return fetchPricesKrxViaOtp(items, dateStr);
  }
  var evidence = {};
  markets.forEach(function(market) {
    var pack = packs[market] || { rows:[], usedYmd:ymd };
    evidence[market] = { count:(pack.rows || []).length,
      date:String(pack.usedYmd || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') };
  });
  evidence.codeMarkets = codeMarkets;
  Object.defineProperty(out, '_krxMarketEvidence', { value:evidence, enumerable:false });
  return out;
}

function handleGetKrxOfficialStockCloses(dateStr, codesInput) {
  try {
    var requestedDate = _normalizeDate(dateStr || '');
    if (!requestedDate) return jsonError('유효한 거래일이 필요합니다.');
    var allowed = { '005930':'삼성전자', '000660':'SK하이닉스' };
    var codes = String(codesInput || '005930,000660').split(',').map(function(code) { return _cleanCode(code); })
      .filter(function(code, index, all) { return !!allowed[code] && all.indexOf(code) === index; });
    var items = codes.map(function(code) { return { code:code, name:allowed[code], market:'KR', currency:'KRW' }; });
    var fetched = fetchPricesKrx(items, requestedDate), closes = {};
    codes.forEach(function(code) {
      var row = fetched[code], usedDate = _normalizeDate(row && row.usedDate || '');
      var source = String(row && row.source || '').toUpperCase();
      if (!row || usedDate !== requestedDate || !(Number(row.price) > 0) || (source !== 'KRX' && source !== 'KRX_OTP')) return;
      closes[code] = { code:code, price:Number(row.price), requestedDate:requestedDate, usedDate:usedDate,
        source:'KRX_OFFICIAL', providerSource:source, receivedAt:new Date().toISOString() };
    });
    return jsonOk({ requestedDate:requestedDate, closes:closes });
  } catch(error) {
    return jsonOk({ requestedDate:_normalizeDate(dateStr || ''), closes:{}, error:error.message || 'KRX_OFFICIAL_STOCK_CLOSE_ERROR' });
  }
}

function _fetchKrxMarketsParallelWithFallback(markets, ymd, authKey, maxLookback) {
  var result = {};
  var fetchPairs = function(pairs) {
    if (pairs.length === 0) return;
    var requests = pairs.map(function(info) {
      return {
        url: _getKrxEndpointByMarket(info.market) + '?basDd=' + encodeURIComponent(info.ymd),
        method: 'get', headers: { AUTH_KEY: authKey }, muteHttpExceptions: true
      };
    });
    UrlFetchApp.fetchAll(requests).forEach(function(resp, index) {
      var info = pairs[index];
      if (result[info.market] && result[info.market].rows.length > 0) return;
      if (resp.getResponseCode() >= 400) return;
      try {
        var json = JSON.parse(resp.getContentText() || '{}');
        var rows = Array.isArray(json.OutBlock_1) ? json.OutBlock_1 : [];
        if (rows.length > 0) result[info.market] = { rows: rows, usedYmd: info.ymd };
      } catch(e) {}
    });
  };

  // 정상 거래일에는 시장별 오늘 요청 3개만 병렬 실행합니다.
  fetchPairs(markets.map(function(market){ return { market: market, ymd: ymd }; }));
  var missingMarkets = markets.filter(function(market){ return !result[market]; });
  if (missingMarkets.length > 0) {
    var fallbackPairs = [];
    var cur = ymd;
    for (var i = 0; i < (maxLookback || 7); i++) {
      cur = _prevYmd(cur);
      missingMarkets.forEach(function(market){ fallbackPairs.push({ market: market, ymd: cur }); });
    }
    fetchPairs(fallbackPairs);
  }
  markets.forEach(function(market) {
    if (!result[market]) result[market] = { rows: [], usedYmd: ymd };
  });
  return result;
}

function fetchPricesKrxViaOtp(items, dateStr) {
  var actualDate = _normalizeDate(dateStr || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(actualDate)) return {};
  // 인증키 없는 OTP 경로도 KRX 공식 휴장일/주말에는 직전 거래일의 CSV를 요청합니다.
  // 정상 거래일 0건은 소스 장애이므로 이전 종가로 조용히 덮어쓰지 않습니다.
  for (var back = 0; back < 10; back++) {
    var day = new Date(actualDate + 'T00:00:00Z').getUTCDay();
    if (day !== 0 && day !== 6 && !KRX_CONFIRMED_CLOSED_DATES_2026[actualDate]) break;
    actualDate = _fundDateOffset(actualDate, -1);
  }
  var ymd = actualDate.replace(/-/g, '');
  var wanted = {};
  items.forEach(function(item) { wanted[item.code] = item; });
  if (Object.keys(wanted).length === 0) return {};

  var headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; AppsScript)',
    'Referer': 'https://data.krx.co.kr/contents/MDC/MDI/mdiLoader'
  };
  var otpResp = UrlFetchApp.fetch('https://data.krx.co.kr/comm/fileDn/GenerateOTP/generate.cmd', {
    method: 'post',
    payload: {
      locale: 'ko_KR',
      mktId: 'ALL',
      trdDd: ymd,
      share: '1',
      money: '1',
      csvxls_isNo: 'false',
      name: 'fileDown',
      url: 'dbms/MDC/STAT/standard/MDCSTAT01501'
    },
    headers: headers,
    muteHttpExceptions: true
  });
  if (otpResp.getResponseCode() >= 400) {
    Logger.log('⚠️ KRX OTP 발급 실패 HTTP ' + otpResp.getResponseCode());
    return {};
  }
  var otp = (otpResp.getContentText() || '').trim();
  if (!otp || otp.length < 8) {
    Logger.log('⚠️ KRX OTP 응답 비정상');
    return {};
  }

  var csvResp = UrlFetchApp.fetch('https://data.krx.co.kr/comm/fileDn/download_csv/download.cmd', {
    method: 'post',
    payload: { code: otp },
    headers: headers,
    muteHttpExceptions: true
  });
  if (csvResp.getResponseCode() >= 400) {
    Logger.log('⚠️ KRX CSV 다운로드 실패 HTTP ' + csvResp.getResponseCode());
    return {};
  }
  var text = csvResp.getContentText('EUC-KR');
  var rows = Utilities.parseCsv(text);
  if (!rows || rows.length < 2) return {};

  var header = rows[0];
  var idxCode = _findCsvIndex(header, ['단축코드', '종목코드', 'ISU_SRT_CD']);
  var idxName = _findCsvIndex(header, ['한글 종목약명', '종목명', 'ISU_ABBRV']);
  var idxClose = _findCsvIndex(header, ['종가', 'TDD_CLSPRC', '종가(원)']);
  var idxMarket = _findCsvIndex(header, ['시장구분', '시장구분명', '시장명', '시장', 'MKT_NM', 'MKT_ID']);
  if (idxCode < 0 || idxClose < 0) {
    Logger.log('⚠️ KRX CSV 컬럼 해석 실패: ' + header.join('|'));
    return {};
  }

  var out = {}, codeMarkets = {};
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i] || [];
    var code = _cleanCode(r[idxCode]);
    if (!wanted[code]) continue;
    var rawMarket = idxMarket >= 0 ? String(r[idxMarket] || '').toUpperCase() : '';
    var verifiedMarket = /KOSDAQ|코스닥/.test(rawMarket) ? 'KOSDAQ'
      : (/KOSPI|유가증권|코스피/.test(rawMarket) ? 'KOSPI'
      : (/ETF|ETP/.test(rawMarket) ? 'ETF' : ''));
    // 시장 열이 없다면 확인되지 않은 상태로 남겨 나중에 누락 전용 그룹으로 차단합니다.
    if (verifiedMarket) codeMarkets[code] = verifiedMarket;
    var p = _parseKrxNumber(r[idxClose]);
    if (!(p > 0)) continue;
    out[code] = {
      price: p,
      name: wanted[code].name,
      officialName: idxName >= 0 ? (r[idxName] || wanted[code].name || code) : (wanted[code].name || code),
      source: 'KRX_OTP',
      // 정상 휴장일에는 실제 조회한 직전 KRX 거래일을 유지합니다.
      usedDate: actualDate
    };
  }
  Object.defineProperty(out, '_krxMarketEvidence', {
    value: { mode:'OTP', codeMarkets:codeMarkets }, enumerable:false
  });
  Logger.log('[price-source] KRX OTP/CSV 조회 결과 ' + Object.keys(out).length
    + '건 (실제 공시일 ' + actualDate + ')');
  return out;
}

// 종목코드 시트의 통화가 USD인 항목이 있을 때만 미국주식 조회 필요가 있다고 판정합니다.
// 통화 정보가 없던 구버전 행은 getCodeItems()에서 KRW로 정규화됩니다.
function _hasUsdPriceItems(items) {
  return (items || []).some(function(item) {
    return String(item && item.currency || 'KRW').toUpperCase() === 'USD';
  });
}

function _parseKrxNumber(v) {
  var s = (v || '').toString().replace(/[,\s]/g, '').trim();
  if (!s || s === '-' || s === '0') return 0;
  var n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n);
}

function _findCsvIndex(header, candidates) {
  if (!Array.isArray(header)) return -1;
  for (var i = 0; i < candidates.length; i++) {
    var target = candidates[i];
    for (var j = 0; j < header.length; j++) {
      if ((header[j] || '').toString().trim() === target) return j;
    }
  }
  return -1;
}

function _getKrxApiConfig() {
  var props = PropertiesService.getScriptProperties();
  var endpoint = (props.getProperty('krx_api_endpoint') || '').trim();
  var bld = (props.getProperty('krx_api_bld') || 'dbms/MDC/STAT/standard/MDCSTAT01501').trim();
  var apiKey = _getKrxAuthKey();
  return { endpoint: endpoint, bld: bld, apiKey: apiKey };
}

function _getKrxAuthKey() {
  var props = PropertiesService.getScriptProperties();
  return (props.getProperty('krx_auth_key') || props.getProperty('krx_api_key') || '').trim();
}

function configureKrxAuthKeyPrompt() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
  if (!ui) throw new Error('스프레드시트 UI 환경에서 실행하세요.');

  var current = _getKrxAuthKey();
  var resp = ui.prompt(
    'KRX AUTH_KEY 설정',
    'KRX Open API AUTH_KEY를 입력하세요.\n삭제하려면 "-" 입력',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var input = (resp.getResponseText() || '').trim();
  var props = PropertiesService.getScriptProperties();
  if (input === '-') {
    props.deleteProperty('krx_auth_key');
    ui.alert('✅ krx_auth_key 삭제 완료');
    return;
  }
  if (!input) {
    ui.alert(current ? '변경 없음' : '⚠️ AUTH_KEY가 비어 있습니다.');
    return;
  }
  props.setProperty('krx_auth_key', input);
  ui.alert('✅ krx_auth_key 저장 완료');
}


function _getPublicDataApiKey() {
  var props = PropertiesService.getScriptProperties();
  return (props.getProperty('public_data_api_key') ||
          props.getProperty('public_listed_api_key') ||
          props.getProperty('public_dividend_api_key') || '').trim();
}

function handleSaveKrxAuthKey(rawKey) {
  try {
    var key = (rawKey || '').toString().trim();
    var props = PropertiesService.getScriptProperties();
    if (!key || key === '-') {
      props.deleteProperty('krx_auth_key');
      props.deleteProperty('krx_api_key');
      return jsonOk({ saved: false, cleared: true });
    }
    props.setProperty('krx_auth_key', key);
    return jsonOk({ saved: true, cleared: false });
  } catch(err) {
    return jsonError('KRX AUTH_KEY 저장 실패: ' + err.message);
  }
}

function configurePublicDataApiKeyPrompt() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
  if (!ui) throw new Error('스프레드시트 UI 환경에서 실행하세요.');

  var current = _getPublicDataApiKey();
  var resp = ui.prompt(
    '공공데이터 API 인증키 설정',
    '금융위원회_KRX상장종목정보(종목코드) / 금융위원회_주식배당정보에 사용할 인증키를 입력하세요.\n' +
    'Encoding 키 권장, Decoding 키도 자동 보정됩니다.\n' +
    '삭제하려면 "-" 입력' + (current ? '\n\n현재: 저장됨' : '\n\n현재: 미설정'),
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var input = (resp.getResponseText() || '').trim();
  var props = PropertiesService.getScriptProperties();
  if (input === '-') {
    props.deleteProperty('public_data_api_key');
    props.deleteProperty('public_listed_api_key');
    props.deleteProperty('public_dividend_api_key');
    ui.alert('✅ 공공데이터포털 인증키 삭제 완료');
    return;
  }
  if (!input) {
    ui.alert(current ? '변경 없음' : '⚠️ 공공데이터포털 인증키가 비어 있습니다.');
    return;
  }
  props.setProperty('public_data_api_key', input);
  ui.alert('✅ 공공데이터포털 인증키 저장 완료\n배당 조회와 KRX 공식명 조회에서 사용됩니다.');
}

function handleSavePublicDataApiKey(rawKey) {
  try {
    var key = (rawKey || '').toString().trim();
    var props = PropertiesService.getScriptProperties();
    if (!key || key === '-') {
      props.deleteProperty('public_data_api_key');
      props.deleteProperty('public_listed_api_key');
      props.deleteProperty('public_dividend_api_key');
      return jsonOk({ saved: false, cleared: true });
    }
    props.setProperty('public_data_api_key', key);
    return jsonOk({ saved: true, cleared: false });
  } catch(err) {
    return jsonError('공공데이터 API 키 저장 실패: ' + err.message);
  }
}

function showPublicDataApiKeyStatus() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
  if (!ui) throw new Error('스프레드시트 UI 환경에서 실행하세요.');
  var key = _getPublicDataApiKey();
  ui.alert(key
    ? '✅ 공공데이터 API 인증키가 저장되어 있습니다.\nKRX상장종목정보(종목코드)와 주식배당정보 조회에 사용됩니다.'
    : '⚠️ 공공데이터 API 인증키가 없습니다.\n📊 포트폴리오 > ⚙️ 설정 > 🔑 공공데이터 API 인증키 설정에서 입력하세요.');
}

function showApiKeyStatus() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
  if (!ui) throw new Error('스프레드시트 UI 환경에서 실행하세요.');
  var publicSaved = !!_getPublicDataApiKey();
  var krxSaved = !!_getKrxAuthKey();
  var requestAuthEnabled = !!(PropertiesService.getScriptProperties().getProperty('access_token') || '').trim();
  ui.alert(
    'API 인증키 저장 상태\n\n' +
    (publicSaved ? '✅' : '⚠️') + ' 공공데이터포털: ' + (publicSaved ? '저장됨' : '미설정') + '\n' +
    (krxSaved ? '✅' : '⚠️') + ' KRX Open API: ' + (krxSaved ? '저장됨' : '미설정') + '\n' +
    (requestAuthEnabled ? '✅' : '⚠️') + ' GAS 요청 인증: ' + (requestAuthEnabled ? '사용 중' : '호환 모드')
  );
}

function configureSpreadsheetIdPrompt() {
  var ui = SpreadsheetApp.getUi();
  var current = '';
  try { current = PropertiesService.getScriptProperties().getProperty('SS_ID') || ''; } catch(e) {}
  var response = ui.prompt(
    '연결 스프레드시트 설정',
    '현재 스프레드시트의 URL 또는 문서 ID를 입력하세요.\n현재 저장값: ' + (current || '없음'),
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var raw = (response.getResponseText() || '').trim();
  var match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  var id = match ? match[1] : raw;
  if (!/^[a-zA-Z0-9-_]{20,}$/.test(id)) {
    ui.alert('⚠️ 스프레드시트 URL 또는 문서 ID 형식을 확인해주세요.');
    return;
  }
  if (!_confirmPortfolioMenuAction('연결 스프레드시트 변경', '웹앱과 자동 트리거가 사용할 문서 연결을 변경합니다. 기존 운영 문서가 맞는지 확인하세요.')) return;
  try {
    var target = SpreadsheetApp.openById(id);
    PropertiesService.getScriptProperties().setProperty('SS_ID', id);
    SS_ID = id;
    ui.alert('✅ 연결 완료\n' + target.getName());
  } catch(err) {
    ui.alert('❌ 연결 실패\n\n문서 ID와 GAS 실행 계정의 접근 권한을 확인해주세요.\n' + err.message);
  }
}

function importKrxClosesPrompt() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
  if (!ui) throw new Error('스프레드시트 UI 환경에서 실행하세요.');
  var ss = getss();
  var wantedByMarket = _buildWantedByMarketFromCodeSheet(ss);
  var seedStart = Utilities.formatDate(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), CONFIG.TIMEZONE, 'yyyyMMdd');
  var seedEnd = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd');
  var rangeResp = ui.prompt(
    'KRX 기간 불러오기',
    '기간을 입력하세요. (예: 20260401~20260408)\n빈값이면 최근 7일(' + seedStart + '~' + seedEnd + ')',
    ui.ButtonSet.OK_CANCEL
  );
  if (rangeResp.getSelectedButton() !== ui.Button.OK) return;
  var rangeText = (rangeResp.getResponseText() || '').trim();
  var startYmd = seedStart;
  var endYmd = seedEnd;
  if (rangeText) {
    var m = rangeText.match(/^(\d{8})\s*~\s*(\d{8})$/);
    if (!m) throw new Error('형식 오류: YYYYMMDD~YYYYMMDD');
    startYmd = m[1]; endYmd = m[2];
  }
  var answer = ui.alert(
    'KRX 기간 종가 조회·저장',
    startYmd + '~' + endYmd + '\n종가데이터 시트의 기존 조회 결과를 교체합니다.\n예: 가격이력의 해당 기간/종목도 갱신\n아니요: 종가데이터 시트만 갱신\n취소/창 닫기: 실행 안 함\n스냅샷은 이 메뉴에서 재작성하지 않습니다.',
    ui.ButtonSet.YES_NO_CANCEL
  );
  if (answer !== ui.Button.YES && answer !== ui.Button.NO) return;
  return _runKrxImport(startYmd, endYmd, wantedByMarket, answer === ui.Button.YES);
}

function _runKrxImport(startYmd, endYmd, wantedByMarket, overwriteHistory) {
  var ss = getss();
  var authKey = _getKrxAuthKey();
  if (!authKey) throw new Error('krx_auth_key가 비어 있습니다. 메뉴에서 AUTH_KEY를 먼저 설정하세요.');
  if (startYmd > endYmd) throw new Error('시작일이 종료일보다 늦습니다.');

  var outSheet = ss.getSheetByName('종가데이터') || ss.insertSheet('종가데이터');
  _clearKrxCloseOutputSheet(outSheet);
  var rows = [];
  var dayList = _buildDateRangeYmd(startYmd, endYmd);
  var fallbackCount = 0;

  dayList.forEach(function(ymd) {
    ['KOSPI', 'KOSDAQ', 'ETF'].forEach(function(market) {
      var wanted = wantedByMarket[market];
      if (!wanted || Object.keys(wanted).length === 0) return;
      try {
        var pack = _fetchKrxDailyOutBlockWithFallback(market, ymd, authKey, 7);
        if (!pack.rows || pack.rows.length === 0) return;
        if (pack.usedYmd !== ymd) fallbackCount++;
        var added = _collectFilteredKrxRows(rows, pack.rows, wanted, ymd, market);
        Logger.log('[KRX-IMPORT] ' + ymd + ' ' + market + ' 매칭 ' + added + '건' + (pack.usedYmd !== ymd ? (' (기준 ' + pack.usedYmd + ')') : ''));
      } catch (e) {
        Logger.log('⚠️ [KRX-IMPORT] ' + ymd + ' ' + market + ' 실패: ' + e.message);
      }
    });
  });
  if (rows.length > 0) {
    outSheet.getRange(2, 1, rows.length, 5).setValues(rows);
    outSheet.getRange(2, 5, rows.length, 1).setNumberFormat('#,##0');
  }
  if (overwriteHistory) _overwritePriceHistoryFromKrxRows(ss, rows);
  var msg = '✅ KRX 불러오기 완료\n기간: ' + startYmd + ' ~ ' + endYmd + '\n저장 행수: ' + rows.length +
    '\n휴일 대체(전일 종가) 적용: ' + fallbackCount + '회' +
    (overwriteHistory ? '\n가격이력 덮어쓰기: 적용' : '\n가격이력 덮어쓰기: 미적용');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}

function _overwritePriceHistoryFromKrxRows(ss, rows) {
  if (!rows || rows.length === 0) return;
  var byDate = {};
  rows.forEach(function(r) {
    var ymd = (r[0] || '').toString();
    if (!/^\d{8}$/.test(ymd)) return;
    var dateStr = ymd.slice(0,4) + '-' + ymd.slice(4,6) + '-' + ymd.slice(6,8);
    if (!byDate[dateStr]) byDate[dateStr] = [];
    byDate[dateStr].push({ code: r[1], name: r[2], price: r[4], source: 'KRX' });
  });
  Object.keys(byDate).forEach(function(dateStr) {
    batchUpsertPriceHistory(ss, dateStr, byDate[dateStr]);
  });
}

function _buildWantedByMarketFromCodeSheet(ss) {
  var items = getCodeItems(ss);
  if (!items || items.length === 0) throw new Error('종목코드 시트에 유효 종목이 없습니다.');
  var wantedByMarket = { KOSPI: {}, KOSDAQ: {}, ETF: {} };
  items.forEach(function(item) {
    var t = (item.type || '').toString();
    if (/펀드|TDF/i.test(t)) return;
    // 시장 정보가 없는 경우를 위해 3개 시장 모두 조회 대상으로 넣고,
    // 실제 응답에서 일치하는 시장의 코드만 매칭/적재한다.
    wantedByMarket.KOSPI[item.code] = true;
    wantedByMarket.KOSDAQ[item.code] = true;
    wantedByMarket.ETF[item.code] = true;
  });
  return wantedByMarket;
}

function _normalizeMarketType(v) {
  var raw = (v || '').toString().trim().toUpperCase();
  if (!raw) return '';
  if (raw === 'KOSPI' || raw === '코스피' || raw === '유가증권') return 'KOSPI';
  if (raw === 'KOSDAQ' || raw === '코스닥' || raw === 'KOSDAQ시장') return 'KOSDAQ';
  if (raw === 'ETF' || raw === 'ETP') return 'ETF';
  return '';
}

function _buildDateRangeYmd(startYmd, endYmd) {
  var out = [];
  var d = _ymdToDate(startYmd);
  var e = _ymdToDate(endYmd);
  while (d.getTime() <= e.getTime()) {
    out.push(Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyyMMdd'));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function _ymdToDate(ymd) {
  var y = parseInt(ymd.slice(0, 4), 10);
  var m = parseInt(ymd.slice(4, 6), 10) - 1;
  var d = parseInt(ymd.slice(6, 8), 10);
  return new Date(y, m, d);
}

function _normalizeYmd(v) {
  var s = (v || '').toString().replace(/[^0-9]/g, '');
  if (!/^\d{8}$/.test(s)) return '';
  return s;
}

function _getKrxEndpointByMarket(market) {
  if (market === 'KOSPI') return 'https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd';
  if (market === 'KOSDAQ') return 'https://data-dbg.krx.co.kr/svc/apis/sto/ksq_bydd_trd';
  if (market === 'ETF') return 'https://data-dbg.krx.co.kr/svc/apis/etp/etf_bydd_trd';
  throw new Error('지원하지 않는 시장구분: ' + market);
}

function _fetchKrxDailyOutBlock(market, ymd, authKey) {
  var endpoint = _getKrxEndpointByMarket(market);
  var url = endpoint + '?basDd=' + encodeURIComponent(ymd);
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { AUTH_KEY: authKey },
    muteHttpExceptions: true
  });
  var status = resp.getResponseCode();
  if (status >= 400) throw new Error('HTTP ' + status + ' (' + market + ')');
  var raw = resp.getContentText() || '{}';
  var json = JSON.parse(raw);
  var list = json.OutBlock_1;
  if (!Array.isArray(list)) return [];
  return list;
}

function _fetchKrxDailyOutBlockWithFallback(market, ymd, authKey, maxLookback) {
  var days = maxLookback || 7;
  var cur = ymd;
  for (var i = 0; i <= days; i++) {
    var rows = _fetchKrxDailyOutBlock(market, cur, authKey);
    if (rows && rows.length > 0) return { rows: rows, usedYmd: cur };
    cur = _prevYmd(cur);
  }
  return { rows: [], usedYmd: ymd };
}

function _prevYmd(ymd) {
  var d = _ymdToDate(ymd);
  d.setDate(d.getDate() - 1);
  return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyyMMdd');
}

function _collectFilteredKrxRows(accRows, apiRows, wantedMap, ymd, market) {
  var added = 0;
  apiRows.forEach(function(r) {
    var code = _cleanCode(r.ISU_CD || r.ISU_SRT_CD || '');
    if (!code || !wantedMap[code]) return;
    var close = _parseKrxNumber(r.TDD_CLSPRC);
    if (!(close > 0)) return;
    accRows.push([ymd, code, (r.ISU_NM || '').toString().trim(), market, close]);
    added++;
  });
  return added;
}

function _clearKrxCloseOutputSheet(sh) {
  sh.clearContents();
  sh.getRange(1, 1, 1, 5).setValues([['날짜', '종목코드', '종목명', '시장구분', '종가']]);
  sh.getRange(1, 1, 1, 5).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
}

// ════════════════════════════════════════════════════════════════════
//  종가 갱신 (수동 실행 / 트리거)
// ════════════════════════════════════════════════════════════════════
function updatePrices() {
  var ss = getss();
  if (!ss) { Logger.log('ERROR: 구글 시트에서 실행하세요'); return; }

  var items = getCodeItems(ss);
  if (items.length === 0) { Logger.log('유효한 종목코드 없음'); return; }

  var prices = fetchPricesGoogleFinance(items, today(), ss);
  var now    = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm');

  var results = items.map(function(item) {
    var p = prices[item.code];
    return [item.code, p ? p.price : '', item.name, now];
  });

  var ps = ss.getSheetByName(CONFIG.SHEET_PRICES) || ss.insertSheet(CONFIG.SHEET_PRICES);
  ps.clearContents(); ps.clearFormats();
  var allRows = [['종목코드','종가','종목명','갱신일시']].concat(results);
  ps.getRange(1, 1, allRows.length, 4).setValues(allRows);
  ps.getRange(1, 1, 1, 4).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
  ps.setColumnWidth(1, 90); ps.setColumnWidth(2, 90);
  ps.setColumnWidth(3, 200); ps.setColumnWidth(4, 160);
  SpreadsheetApp.flush();

  var todayStr = today();
  var phItems  = [];
  items.forEach(function(item) {
    var p = prices[item.code];
    if (p && p.price > 0) phItems.push({ code: item.code, name: item.name, price: p.price, source: (p.source || 'GOOGLEFINANCE') });
  });
  if (phItems.length > 0) batchUpsertPriceHistory(ss, todayStr, phItems);

  var ok = results.filter(function(r) { return r[1] !== ''; }).length;
  try {
    SpreadsheetApp.getUi().alert(
      '✅ 종가 갱신 완료!\n\n' + ok + '/' + items.length + '개 성공\n' +
      (ok < items.length ? '⚠️ 실패 종목: 코드 확인 또는 장 마감 후 재시도' : '모두 성공!')
    );
  } catch(e) { Logger.log('종가 갱신 완료: ' + ok + '/' + items.length); }
}

// ════════════════════════════════════════════════════════════════════
//  종목명 조회
// ════════════════════════════════════════════════════════════════════
function handleNameLookup(code, serviceKey) {
  var cleanCode = (code || '').toString().trim().replace(/^A(?=\d{6}$)/, '');
  var key = (serviceKey || _getPublicDataApiKey()).toString().trim();
  if (key) {
    var listed = _fetchPublicListedInfoByCode(cleanCode, key);
    if (listed && listed.name) {
      return jsonOk({
        name: listed.name,
        officialName: listed.name,
        crno: listed.crno || '',
        market: listed.market || '',
        source: 'PUBLIC_LISTED_INFO'
      });
    }
  }

  var ss  = getss();
  // ★ [버그수정] 공유 임시 시트 대신 고유 임시 시트 사용 (동시 요청 충돌 방지)
  var tmp = ss.insertSheet(_tempSheetName('_name_tmp_'));
  try {
    tmp.getRange(1, 1).setFormula(
      '=IFERROR(GOOGLEFINANCE("KRX:'    + cleanCode + '","name"),' +
      'IFERROR(GOOGLEFINANCE("KOSDAQ:' + cleanCode + '","name"),"-"))'
    );
    SpreadsheetApp.flush();
    Utilities.sleep(1500);
    var val  = tmp.getRange(1, 1).getValue();
    var name = (val && val !== '-' && !String(val).startsWith('#')) ? val.toString().trim() : '';
    return jsonOk({ name: name, officialName: name, source: 'GOOGLEFINANCE' });
  } catch(err) {
    return jsonError('종목명 조회 실패: ' + err.message);
  } finally {
    try { ss.deleteSheet(tmp); } catch(e) {}
  }
}

// ════════════════════════════════════════════════════════════════════
//  스냅샷 저장
// ════════════════════════════════════════════════════════════════════
function handleSaveSnapshot(dateStr, dataJson) {
  try {
    if (!dateStr || !dataJson) return jsonError('date, data 필요');
    var rows = JSON.parse(decodeURIComponent(dataJson));
    if (!Array.isArray(rows) || rows.length === 0) return jsonError('빈 데이터');

    var ss        = getss();
    var normDate  = _normalizeDate(dateStr);
    var newRows = rows.map(function(r) {
      var qty = parseFloat(r.qty) || 0;
      var costAmt = parseFloat(r.costAmt) || 0;
      var evalAmt = parseFloat(r.evalAmt) || 0;
      var costUnit = qty > 0 ? parseFloat((costAmt / qty).toFixed(2)) : 0;
      var evalUnit = qty > 0 ? parseFloat((evalAmt / qty).toFixed(2)) : 0;
      // ★ 12콸럼: 소스는 프론트가 전달한 값 사용, savedAt은 프론트 전달값 인정
      return [normDate, r.code||'', r.name||'', qty,
              costUnit, costAmt, evalUnit, evalAmt, r.pnl||0,
              r.pct ? parseFloat(r.pct.toFixed(2)) : 0,
              r.source || '', r.savedAt || ''];
    });
    var savePlan = _snapshotRewritePlan(ss, normDate, newRows);
    if (savePlan.unsafe.length) return jsonError('Snapshot 보호 충돌: ' + savePlan.unsafe.map(function(item) { return item.classification + ': ' + item.reason; }).join('; '));
    writeSnapshotRows(ss, normDate, newRows, true);
    return jsonOk({ saved: newRows.length, date: normDate });
  } catch(err) {
    return jsonError('스냅샷 저장 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  손익 히스토리 조회
// ════════════════════════════════════════════════════════════════════
// 손익 그래프는 Snapshot 시트의 중복/충돌에서 독립적으로 평가일 원자료를 재구성합니다.
// 거래원장+확정 가격이력+펀드 NAV/좌수+환율만 읽으며 어떠한 시트에도 쓰지 않습니다.
function _historySourceRows(index, date) {
  var stored = index.holdingsByRequestedDate[date] || {}, holdings = {}, out = [];
  Object.keys(stored).forEach(function(name) { holdings[name] = Object.assign({}, stored[name]); });
  _applyFundUnitLifecycleToSnapshotHoldings(holdings, index.fundConfigs || [], date);
  Object.keys(holdings).forEach(function(name) {
    var h = holdings[name], code = _cleanCode(h.code) || String(h.code || '').trim();
    if (!h || !(Number(h.qty) > 0)) return;
    if (!code) throw new Error('종목코드 누락: ' + (h.name || name));
    var price = 0, source = '', sourceDate = date, savedAt = '';
    if (_isFundCode(code)) {
      var fund = _indexedFundEvaluation(index, code, date);
      if (fund) {
        price = fund.evalAmt;
        sourceDate = fund.sourceDate;
        source = fund.carried ? 'FUND_NAV_CARRY@' + sourceDate : 'FUND_NAV';
      } else {
        // 확인 가능한 NAV가 전혀 없는 예외에만 평가일 당일 MANUAL을 허용합니다.
        var fundManual = (index.historyPriceSeriesByCode[code] || []).filter(function(item) {
          return item.date === date && String(item.source || '').toUpperCase() === 'MANUAL';
        })[0];
        if (fundManual) { price = fundManual.price; source = 'MANUAL'; savedAt = fundManual.savedAt || ''; }
      }
    } else {
      var series = index.historyPriceSeriesByCode[code] || [];
      var entry = _indexedLatest(series, date);
      if (entry) {
        var age = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(entry.date + 'T00:00:00Z')) / 86400000);
        // 확정 종가가 장기간 비어 있으면 과거 가격을 무기한 이월해 가짜 손익을 만들지 않습니다.
        if (age > 10 || (age > 0 && String(entry.source || '').toUpperCase() === 'MANUAL')) {
          throw new Error('확정 종가 원자료 없음: ' + code + ' ' + date + ' (최근 ' + entry.date + ')');
        }
        // 분할·역분할 이후에는 수량이 조정되므로 조정 전 종가 이월을 금지합니다.
        // 해당일 또는 분할 이후 날짜의 확정 종가가 확보될 때만 다시 평가합니다.
        if (age > 0) {
          var actionDates = (index.historyCorporateActionDatesByCode || {})[code] || [];
          if (actionDates.some(function(actionDate) { return actionDate > entry.date && actionDate <= date; })) {
            throw new Error('주식분할 이후 종가 미확정: ' + code + ' ' + date + ' (최근 ' + entry.date + ')');
          }
        }
        price = entry.price; sourceDate = entry.date; savedAt = entry.savedAt || '';
        source = entry.date === date ? entry.source : (entry.source + '_CARRY@' + entry.date);
      }
    }
    if (!(price > 0)) throw new Error('확정 평가가격 없음: ' + code + ' ' + date);
    var currency = _isFundCode(code) ? 'KRW' : String((index.historyCurrencyByCode || {})[code] || '');
    if (!currency) throw new Error('종목 통화 원자료 누락·확인 필요: ' + code + ' ' + date);
    var fxRate = 1;
    if (currency !== 'KRW') {
      var fx = _indexedLatest(index.fxSeriesByCurrency[currency] || [], date);
      if (!fx || !(fx.rate > 0)) throw new Error('확정 환율 없음: ' + code + ' ' + currency + ' ' + date);
      var fxAge = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(fx.date + 'T00:00:00Z')) / 86400000);
      if (fxAge > 10) throw new Error('확정 환율 오래됨: ' + code + ' ' + currency + ' ' + date);
      fxRate = fx.rate;
    }
    var priceKrw = Math.round(price * fxRate);
    var evalAmt = Math.round(priceKrw * h.qty), costAmt = Number(h.costAmt) || 0, pnl = evalAmt - costAmt;
    if (!Number.isSafeInteger(evalAmt) || evalAmt < 0) throw new Error('평가금액 계산 범위 초과: ' + code);
    out.push([date, code, h.name, h.qty, h.qty > 0 ? Number((costAmt / h.qty).toFixed(2)) : 0,
      costAmt, h.qty > 0 ? Number((evalAmt / h.qty).toFixed(2)) : 0, evalAmt, pnl,
      costAmt > 0 ? Number(((pnl / costAmt) * 100).toFixed(2)) : 0, source, source === 'MANUAL' ? savedAt : '']);
  });
  return _dedupeSnapshotRows(out);
}

function _historySourceSummary(rows, date) {
  var evalAmt = Math.round(rows.reduce(function(sum, row) { return sum + Number(row[7] || 0); }, 0));
  var costAmt = Math.round(rows.reduce(function(sum, row) { return sum + Number(row[5] || 0); }, 0));
  var qty = rows.reduce(function(sum, row) { return sum + Number(row[3] || 0); }, 0);
  var carriedFunds = rows.filter(function(row) { return /^FUND_NAV_CARRY@/.test(String(row[10] || '')); })
    .map(function(row) { return { code: row[1], sourceDate: String(row[10]).split('@')[1] }; });
  var carriedPrices = rows.filter(function(row) {
    return !_isFundCode(String(row[1] || '')) && /_CARRY@\d{4}-\d{2}-\d{2}$/.test(String(row[10] || ''));
  }).map(function(row) { return { code: row[1], sourceDate: String(row[10]).split('@')[1] }; });
  return { date: date, evalAmt: evalAmt, costAmt: costAmt, qty: qty,
    evalUnit: qty > 0 ? Number((evalAmt / qty).toFixed(2)) : 0,
    costUnit: qty > 0 ? Number((costAmt / qty).toFixed(2)) : 0,
    pnl: evalAmt - costAmt, pct: costAmt > 0 ? Number(((evalAmt - costAmt) / costAmt * 100).toFixed(2)) : 0,
    navInputRequired: false, navInputRequiredCodes: [], carriedFunds: carriedFunds, carriedPrices: carriedPrices };
}

function _historySourceDates(values, fromStr, toStr) {
  var end = _normalizeDate(toStr || '') || _dateOffset(today(), -1);
  if (end >= today()) end = _dateOffset(today(), -1);
  var start = _normalizeDate(fromStr || '');
  if (!start) {
    var first = [];
    [CONFIG.SHEET_TRADES, CONFIG.SHEET_PH].forEach(function(sheetName) {
      (values[sheetName] || []).slice(1).forEach(function(row) {
        var date = _normalizeDate(row[0]);
        if (date && date <= end) first.push(date);
      });
    });
    start = first.length ? first.sort()[0] : end;
  }
  if (start > end) return [];
  var dates = [];
  for (var date = start; date <= end; date = _dateOffset(date, 1)) {
    var day = new Date(date + 'T00:00:00Z').getUTCDay();
    if (day !== 0 && day !== 6) dates.push(date);
    // 원본 없는 지나치게 긴 조회를 GAS 단일 요청에서 방치하지 않습니다.
    if (dates.length > 3000) throw new Error('손익 원자료 조회 범위가 3000영업일을 초과합니다. 시작연도를 선택해 주세요.');
  }
  return dates;
}

function _historySourceBuild(fromStr, toStr) {
  var started = Date.now(), read = _buildSnapshotRangeReadContext(getss(), { historyOnly: true });
  var dates = _historySourceDates(read.valuesByName, fromStr, toStr);
  if (!dates.length) return { snapshots: [], sourceMode: 'SOURCE_RECOMPUTED',
    sourceSummary: { candidateDates: 0, completeDates: 0, unavailableDates: 0, carriedFundDates: 0, unavailableSamples: [] } };
  var indexed = _buildSnapshotRangeIndexes(read, dates, { historyOnly: true });
  var snapshots = [], unavailable = 0, samples = [], carriedFundDates = 0, carriedFundItems = 0, carriedPriceDates = 0, carriedPriceItems = 0;
  dates.forEach(function(date) {
    try {
      var rows = _historySourceRows(indexed, date);
      if (!rows.length) return;
      var snapshot = _historySourceSummary(rows, date);
      if (snapshot.carriedFunds.length) { carriedFundDates++; carriedFundItems += snapshot.carriedFunds.length; }
      if (snapshot.carriedPrices.length) { carriedPriceDates++; carriedPriceItems += snapshot.carriedPrices.length; }
      snapshots.push(snapshot);
    } catch (err) {
      unavailable++;
      if (samples.length < 20) samples.push({ date: date, reason: String(err.message || err).slice(0, 150) });
    }
  });
  return { snapshots: snapshots, sourceMode: 'SOURCE_RECOMPUTED',
    sourceSummary: { candidateDates: dates.length, completeDates: snapshots.length,
      unavailableDates: unavailable, carriedFundDates: carriedFundDates, carriedFundItems: carriedFundItems,
      carriedPriceDates: carriedPriceDates, carriedPriceItems: carriedPriceItems, unavailableSamples: samples,
      readMs: read.readMs, calculationMs: Date.now() - started - read.readMs } };
}

function handleGetHistorySource(fromStr, toStr) {
  try {
    var revision = String(_getSnapshotIntegritySourceRevision() || '');
    var key = 'history_src_9177_' + String(fromStr || 'all') + '_' + String(toStr || 'prev') + '_' + revision;
    var cache = typeof CacheService !== 'undefined' ? CacheService.getScriptCache() : null;
    if (cache && key.length <= 240) {
      var hit = cache.get(key);
      if (hit) { try { return jsonOk(JSON.parse(hit)); } catch(ignore) {} }
    }
    var result = _historySourceBuild(fromStr, toStr);
    var serialized = JSON.stringify(result);
    if (cache && key.length <= 240 && serialized.length < 90000) {
      try { cache.put(key, serialized, 600); } catch(ignore) {}
    }
    return jsonOk(result);
  } catch (err) { return jsonError('원자료 손익 조회 실패: ' + String(err.message || err)); }
}

function handleGetHistorySourceDetail(dateStr) {
  try {
    var date = _normalizeDate(dateStr || '');
    if (!date || date >= today()) throw new Error('전일 이전 날짜를 선택해 주세요.');
    var read = _buildSnapshotRangeReadContext(getss(), { historyOnly: true });
    var index = _buildSnapshotRangeIndexes(read, [date], { historyOnly: true });
    var rows = _historySourceRows(index, date);
    var items = rows.map(function(row) {
      var evalAmt = Number(row[7] || 0), costAmt = Number(row[5] || 0);
      return { code: row[1], name: row[2], qty: row[3], costUnit: row[4], costAmt: costAmt,
        evalUnit: row[6], evalAmt: evalAmt, pnl: evalAmt - costAmt,
        pct: costAmt > 0 ? (evalAmt - costAmt) / costAmt * 100 : 0,
        source: row[10] };
    }).sort(function(a, b) { return b.evalAmt - a.evalAmt; });
    return jsonOk({ date: date, items: items, sourceMode: 'SOURCE_RECOMPUTED' });
  } catch(err) { return jsonError('원자료 기준 특정일 상세 조회 실패: ' + String(err.message || err)); }
}

function handleGetHistory(fromStr, toStr) {
  try {
    var ss = getss();
    var sh = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
    // ★ [버그수정] 빈 결과 반환 키 통일 — 기존 { history: [] } → { snapshots: [] }
    //   프론트 views_history.js 가 data.snapshots 키를 읽으므로 일치시킴
    if (!sh || sh.getLastRow() < 2) return jsonOk({ snapshots: [] });

    // ★ [버그수정] 스냅샷 12컬럼으로 확장됐으므로 Math.max(8→12)
    var snapLastCol = Math.max(12, sh.getLastColumn());
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, snapLastCol).getValues();
    var historyFundConfigs = _readFundUnits(ss);
    var confirmedFundValues = {};
    var navSheet = ss.getSheetByName(FUND_NAV_SHEET);
    if (navSheet && navSheet.getLastRow() > 1) {
      navSheet.getRange(2, 1, navSheet.getLastRow() - 1, Math.min(9, navSheet.getLastColumn())).getValues().forEach(function(navRow) {
        var navDate = _normalizeDate(navRow[0]), sourceDate = _normalizeDate(navRow[4]);
        var navCode = _cleanCode(navRow[1]), evalAmt = Number(navRow[6]);
        if (navDate && navDate === sourceDate && navCode && evalAmt > 0) {
          var confirmedKey = navDate + '|' + navCode;
          if (!confirmedFundValues[confirmedKey]) confirmedFundValues[confirmedKey] = [];
          confirmedFundValues[confirmedKey].push(Math.round(evalAmt));
        }
      });
    }
    var dateItemMap = {};
    data.forEach(function(row) {
      // ★ [버그수정] _normalizeDate() 적용 — Date 객체가 'Mon Apr 21 2026...' 형태로
      //   읽혀 날짜 비교/필터가 실패하던 문제 수정
      var date = _normalizeDate(row[0]);
      var code = _cleanCode(row[1]) || (row[1] || '').toString().trim();
      var name = (row[2] || '').toString().trim();
      var qty  = parseFloat(row[3]) || 0;
      // 컬럼 구조: [날짜,코드,명,수량,매수단가,매수원금,평가단가,평가금액,손익,수익률,소스,저장일시]
      // 매수원금=col5(idx5), 평가금액=col8(idx7) — 10컬럼 이상이면 신포맷
      var isNewFormat = row.length >= 10;
      var cost = parseFloat(isNewFormat ? row[5] : row[4]) || 0;
      var evalAmt = parseFloat(isNewFormat ? row[7] : row[5]) || 0;
      var source = String(row[10] || '');
      if (date && _isFundCode(code)) {
        var historyFundConfig = _fundUnitsAtDate(historyFundConfigs, code, date);
        if (historyFundConfig && historyFundConfig.units === 0) return;
      }
      var confirmedFundMatches = confirmedFundValues[date + '|' + code] || [];
      if (source === 'FUND_NAV_CARRY_INPUT_REQUIRED' && confirmedFundMatches.indexOf(Math.round(evalAmt)) !== -1) source = 'FUND_NAV';
      if (!date) return;
      if (fromStr && date < fromStr) return;
      if (toStr   && date > toStr)   return;
      // ★ 같은 날짜/같은 종목(코드 우선) 중복 행 방어: 마지막/더 큰 수량 행을 대표값으로 사용
      //    일부 동기화 이슈로 같은 종목이 중복 저장되면 단순합산 시 평가금액이 2배로 튈 수 있음
      var itemKey = code ? ('C:' + code) : ('N:' + name);
      if (!itemKey || itemKey === 'N:') return;
      if (!dateItemMap[date]) dateItemMap[date] = {};
      var prev = dateItemMap[date][itemKey];
      if (!prev) {
        dateItemMap[date][itemKey] = { code: code, qty: qty, costAmt: cost, evalAmt: evalAmt, source: source };
      } else {
        var pickNew = _preferFundRepresentativeValues(prev.source, source, prev.qty, qty, prev.evalAmt, evalAmt);
        if (pickNew) dateItemMap[date][itemKey] = { code: code, qty: qty, costAmt: cost, evalAmt: evalAmt, source: source };
      }
    });

    var history = Object.keys(dateItemMap).sort().map(function(date) {
      var rows = Object.keys(dateItemMap[date]).map(function(k){ return dateItemMap[date][k]; });
      var ev = Math.round(rows.reduce(function(s, r){ return s + (parseFloat(r.evalAmt) || 0); }, 0));
      var co = Math.round(rows.reduce(function(s, r){ return s + (parseFloat(r.costAmt) || 0); }, 0));
      var qt = rows.reduce(function(s, r){ return s + (parseFloat(r.qty) || 0); }, 0);
      var pnl = ev - co;
      var pct = co > 0 ? parseFloat(((pnl / co) * 100).toFixed(2)) : 0;
      var evalUnit = qt > 0 ? parseFloat((ev / qt).toFixed(2)) : 0;
      var costUnit = qt > 0 ? parseFloat((co / qt).toFixed(2)) : 0;
      var inputRequiredCodes = rows.filter(function(row) { return row.source === 'FUND_NAV_CARRY_INPUT_REQUIRED'; }).map(function(row) { return row.code; });
      return { date: date, evalAmt: ev, costAmt: co, qty: qt, evalUnit: evalUnit, costUnit: costUnit, pnl: pnl, pct: pct,
        navInputRequired: inputRequiredCodes.length > 0, navInputRequiredCodes: inputRequiredCodes };
    });
    return jsonOk({ snapshots: history, integritySourceRevision: _getSnapshotIntegritySourceRevision(),
      integrityDateRevisions: _snapshotIntegrityDateRevisions(history.map(function(item) { return item.date; })) });
  } catch(err) {
    return jsonError('히스토리 조회 실패: ' + err.message);
  }
}

// 특정일 스냅샷의 종목별 원본 행을 반환합니다. 합계 조회와 분리해 장기간 조회 응답이
// 불필요하게 커지지 않도록 하고, 같은 종목의 중복 행은 합계 조회와 동일한 기준으로 제거합니다.
function handleGetHistoryDetail(dateStr) {
  try {
    var date = _normalizeDate(dateStr);
    if (!date) return jsonError('조회 날짜가 필요합니다.');
    var ss = getss();
    var sh = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
    if (!sh || sh.getLastRow() < 2) return jsonOk({ date: date, items: [] });
    var lastCol = Math.max(12, sh.getLastColumn());
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, lastCol).getValues();
    rows = _filterSnapshotRowsByFundLifecycle(rows, _readFundUnits(ss), date);
    var itemMap = {};
    rows.forEach(function(row) {
      if (_normalizeDate(row[0]) !== date) return;
      var code = _cleanCode(row[1]) || (row[1] || '').toString().trim();
      var name = (row[2] || '').toString().trim();
      if (!code && !name) return;
      var qty = parseFloat(row[3]) || 0;
      var costUnit = parseFloat(row[4]) || 0;
      var costAmt = parseFloat(row[5]) || 0;
      var evalUnit = parseFloat(row[6]) || 0;
      var evalAmt = parseFloat(row[7]) || 0;
      var pnl = evalAmt - costAmt;
      var pct = costAmt > 0 ? pnl / costAmt * 100 : 0;
      var key = code ? ('C:' + code) : ('N:' + name);
      var item = { code: code, name: name, qty: qty, costUnit: costUnit, costAmt: costAmt,
        evalUnit: evalUnit, evalAmt: evalAmt, pnl: pnl, pct: pct,
        source: (row[10] || '').toString().trim() };
      var prev = itemMap[key];
      if (!prev || qty > prev.qty || (qty === prev.qty && evalAmt >= prev.evalAmt)) itemMap[key] = item;
    });
    var items = Object.keys(itemMap).map(function(key) { return itemMap[key]; });
    items.sort(function(a, b) { return (b.evalAmt || 0) - (a.evalAmt || 0); });
    return jsonOk({ date: date, items: items });
  } catch(err) {
    return jsonError('특정일 손익 상세 조회 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════

//  공공데이터포털 주식배당정보 조회 (무료 API)
//  - 서비스키는 브라우저가 전달합니다. 공공데이터포털 "Encoding" 인증키 사용 권장.
//  - 회사명 기준 조회 후 현재 앱의 events 형식으로 정규화합니다.
//  ★ v9.32: 엔드포인트를 GetStocDiviInfoService_V2/getDiviInfo_V2 로 교체 (실 응답으로 검증완료)
//  ★ v9.33: 종목별 순차 호출(2회×N, 예: 36종목=72회 순차) → UrlFetchApp.fetchAll()로
//           일괄 병렬 요청으로 변경. 종목이 많을 때(30개 이상) 전체 소요시간이
//           140초 안팎까지 걸려 프론트엔드 타임아웃(45~150초)으로 중간에 끊기던 문제 해결.
//  ★ v9.34: 법인번호(crno)가 일치하는 배당 행은 종목명 표기가 달라도 포함.
// ════════════════════════════════════════════════════════════════════
function handleDividendPublicFetch(codes, names, serviceKey) {
  try {
    var key = (serviceKey || _getPublicDataApiKey()).toString().trim();
    if (!key) return jsonError('공공데이터포털 API 키가 없습니다.');
    var namesArr = Array.isArray(names) ? names : [];
    var cleanCodes = [];
    var companyNameByCode = {};
    codes.forEach(function(rawCode, i) {
      var code = (rawCode || '').toString().trim();
      if (!code || companyNameByCode[code] !== undefined) return; // 중복 코드 제거
      cleanCodes.push(code);
      companyNameByCode[code] = (namesArr[i] || '').toString().trim() || code;
    });
    if (cleanCodes.length === 0) return jsonOk({ dividends: {}, source: 'PUBLIC_DATA' });

    // ── 1단계: 상장종목정보 일괄 병렬 조회 (종목코드 → 공식명/법인번호)
    var listedMap = _fetchPublicListedInfoBatch(cleanCodes, key);

    // ── 2단계: 법인번호(crno) 기준 배당정보 일괄 병렬 조회
    var divQueries = cleanCodes.map(function(code) {
      var listed = listedMap[code] || null;
      var lookupName = (listed && listed.name) || companyNameByCode[code];
      return { code: code, crno: (listed && listed.crno) || '', name: lookupName };
    });
    var divRowsMap = _fetchPublicDividendRowsBatch(divQueries, key);

    // ── 3단계: crno 조회 결과가 0건인 종목만 회사명 기준으로 한 번 더 재시도 (역시 일괄 병렬)
    var retryQueries = [];
    cleanCodes.forEach(function(code) {
      var listed = listedMap[code];
      var rows = divRowsMap[code] || [];
      if (rows.length === 0 && listed && listed.crno && listed.name !== companyNameByCode[code]) {
        retryQueries.push({ code: code, crno: '', name: companyNameByCode[code] });
      }
    });
    if (retryQueries.length > 0) {
      var retryMap = _fetchPublicDividendRowsBatch(retryQueries, key);
      retryQueries.forEach(function(q) {
        if (retryMap[q.code] && retryMap[q.code].length > 0) divRowsMap[q.code] = retryMap[q.code];
      });
    }

    var results = {};
    cleanCodes.forEach(function(code) {
      var listed = listedMap[code] || {};
      var lookupName = listed.name || companyNameByCode[code];
      results[code] = _normalizePublicDividendRows(divRowsMap[code] || [], code, lookupName, listed);
    });
    return jsonOk({ dividends: results, source: 'PUBLIC_DATA' });
  } catch(err) {
    return jsonError('공공데이터 배당 조회 실패: ' + err.message);
  }
}

// ★ [v9.33 신규] 여러 종목코드의 상장종목정보를 UrlFetchApp.fetchAll()로 한 번에 병렬 조회
function _fetchPublicListedInfoBatch(codes, serviceKey) {
  var base = 'https://apis.data.go.kr/1160100/service/GetKrxListedInfoService/getItemInfo';
  var out = {};
  var validCodes = [];
  var requests = [];
  codes.forEach(function(code) {
    var normCode = (code || '').toString().trim().replace(/^A(?=\d{6}$)/, '');
    if (!/^\d{6}$/.test(normCode)) return;
    validCodes.push(code);
    var url = base
      + '?serviceKey=' + _publicServiceKeyParam(serviceKey)
      + '&pageNo=1&numOfRows=10&resultType=json'
      + '&likeSrtnCd=' + encodeURIComponent(normCode)
      + '&srtnCd=' + encodeURIComponent(normCode);
    requests.push({ url: url, muteHttpExceptions: true, followRedirects: true });
  });
  if (requests.length === 0) return out;

  var responses;
  try {
    responses = UrlFetchApp.fetchAll(requests);
  } catch(e) {
    Logger.log('⚠️ KRX상장종목정보 일괄 조회 실패: ' + e.message);
    return out;
  }

  validCodes.forEach(function(code, i) {
    var normCode = (code || '').toString().trim().replace(/^A(?=\d{6}$)/, '');
    try {
      var res = responses[i];
      if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) return;
      var json = JSON.parse(res.getContentText() || '{}');
      var body = json && json.response && json.response.body ? json.response.body : null;
      var items = body && body.items ? body.items.item : null;
      if (!items) return;
      var list = Array.isArray(items) ? items : [items];
      for (var j = 0; j < list.length; j++) {
        var row = list[j] || {};
        var srtnCd = (row.srtnCd || row.shortCode || '').toString().trim().replace(/^A(?=\d{6}$)/, '');
        if (srtnCd && srtnCd !== normCode) continue;
        out[code] = {
          code: normCode,
          name: (row.itmsNm || row.stckIssuCmpyNm || row.corpNm || '').toString().trim(),
          corpName: (row.corpNm || '').toString().trim(),
          crno: (row.crno || '').toString().trim(),
          market: (row.mrktCtg || row.mrktCls || '').toString().trim(),
          source: 'PUBLIC_LISTED_INFO'
        };
        break;
      }
    } catch(e) {
      Logger.log('KRX상장종목정보 파싱 실패(' + code + '): ' + e.message);
    }
  });
  return out;
}

// ★ [v9.33 신규] 여러 종목의 배당정보를 UrlFetchApp.fetchAll()로 한 번에 병렬 조회
//   queries: [{ code, crno, name }, ...] — crno가 있으면 crno 우선, 없으면 회사명으로 조회
function _fetchPublicDividendRowsBatch(queries, serviceKey) {
  var base = 'https://apis.data.go.kr/1160100/GetStocDiviInfoService_V2/getDiviInfo_V2';
  var out = {};
  if (!queries || queries.length === 0) return out;
  var requests = queries.map(function(q) {
    var url = base
      + '?serviceKey=' + _publicServiceKeyParam(serviceKey)
      + '&pageNo=1&numOfRows=100&resultType=json'
      + (q.crno ? '&crno=' + encodeURIComponent(q.crno) : '&stckIssuCmpyNm=' + encodeURIComponent(q.name || ''));
    return { url: url, muteHttpExceptions: true, followRedirects: true };
  });

  var responses;
  try {
    responses = UrlFetchApp.fetchAll(requests);
  } catch(e) {
    Logger.log('⚠️ 주식배당정보 일괄 조회 실패: ' + e.message);
    return out;
  }

  queries.forEach(function(q, i) {
    try {
      var res = responses[i];
      var code = res.getResponseCode();
      if (code < 200 || code >= 300) { out[q.code] = out[q.code] || []; return; }
      var json = JSON.parse(res.getContentText() || '{}');
      var body = json && json.response && json.response.body ? json.response.body : null;
      var items = body && body.items ? body.items.item : null;
      out[q.code] = !items ? [] : (Array.isArray(items) ? items : [items]);
    } catch(e) {
      Logger.log('주식배당정보 파싱 실패(' + q.code + '): ' + e.message);
      out[q.code] = out[q.code] || [];
    }
  });
  return out;
}


function _publicServiceKeyParam(serviceKey) {
  var key = (serviceKey || '').toString().trim();
  if (!key) return '';
  // data.go.kr에서 제공하는 Encoding 키는 %2B/%2F처럼 이미 인코딩돼 있습니다.
  // Decoding 키를 붙여넣은 경우에는 URL 쿼리에서 +가 공백으로 해석되지 않도록 인코딩합니다.
  return /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
}

function _fetchPublicListedInfoByCode(code, serviceKey) {
  var normCode = (code || '').toString().trim().replace(/^A(?=\d{6}$)/, '');
  if (!/^\d{6}$/.test(normCode)) return null;
  var base = 'https://apis.data.go.kr/1160100/service/GetKrxListedInfoService/getItemInfo';
  var url = base
    + '?serviceKey=' + _publicServiceKeyParam(serviceKey)
    + '&pageNo=1&numOfRows=10&resultType=json'
    + '&likeSrtnCd=' + encodeURIComponent(normCode)
    + '&srtnCd=' + encodeURIComponent(normCode);
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) return null;
    var json = JSON.parse(res.getContentText() || '{}');
    var body = json && json.response && json.response.body ? json.response.body : null;
    var items = body && body.items ? body.items.item : null;
    if (!items) return null;
    var list = Array.isArray(items) ? items : [items];
    for (var i = 0; i < list.length; i++) {
      var row = list[i] || {};
      var srtnCd = (row.srtnCd || row.shortCode || '').toString().trim().replace(/^A(?=\d{6}$)/, '');
      if (srtnCd && srtnCd !== normCode) continue;
      return {
        code: normCode,
        name: (row.itmsNm || row.stckIssuCmpyNm || row.corpNm || '').toString().trim(),
        corpName: (row.corpNm || '').toString().trim(),
        crno: (row.crno || '').toString().trim(),
        market: (row.mrktCtg || row.mrktCls || '').toString().trim(),
        source: 'PUBLIC_LISTED_INFO'
      };
    }
  } catch(e) {
    Logger.log('KRX상장종목정보 조회 실패(' + normCode + '): ' + e.message);
  }
  return null;
}

function _fetchPublicDividendRows(companyName, serviceKey, crno) {
  // ★ [v9.32 버그수정] 구버전 경로(/service/GetStocDiviInfoService/getDiviInfo, 404)를
  //   실제 서비스 주소(GetStocDiviInfoService_V2/getDiviInfo_V2)로 교체. 실 응답으로 검증완료.
  var base = 'https://apis.data.go.kr/1160100/GetStocDiviInfoService_V2/getDiviInfo_V2';
  var url = base
    + '?serviceKey=' + _publicServiceKeyParam(serviceKey)
    + '&pageNo=1&numOfRows=100&resultType=json'
    + (crno ? '&crno=' + encodeURIComponent(crno) : '&stckIssuCmpyNm=' + encodeURIComponent(companyName));
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  var code = res.getResponseCode();
  var text = res.getContentText() || '';
  if (code < 200 || code >= 300) throw new Error('PUBLIC_DATA HTTP ' + code);
  var json;
  try { json = JSON.parse(text); }
  catch(e) { throw new Error('PUBLIC_DATA JSON 파싱 실패'); }
  var body = json && json.response && json.response.body ? json.response.body : null;
  var items = body && body.items ? body.items.item : null;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

function _normalizePublicDividendRows(rows, code, companyName, listedInfo) {
  var events = [];
  (rows || []).forEach(function(row) {
    if (!row) return;
    var name = (row.stckIssuCmpyNm || row.isuNm || row.corpNm || '').toString().trim();
    var rowCrno = (row.crno || '').toString().trim();
    var listedCrno = (listedInfo && listedInfo.crno ? listedInfo.crno : '').toString().trim();
    var sameCrno = !!(rowCrno && listedCrno && rowCrno === listedCrno);
    // 공공데이터 배당정보의 종목명은 상장종목정보와 표기가 다를 수 있습니다.
    // 예: 상장종목정보 itmsNm="SK하이닉스", 배당정보 stckIssuCmpyNm="에스케이하이닉스".
    // crno로 조회해 같은 법인번호가 확인된 행은 이름 불일치만으로 제외하지 않습니다.
    if (!sameCrno && name && companyName && name.indexOf(companyName) === -1 && companyName.indexOf(name) === -1) return;
    var amount = _publicDividendAmount(row);
    if (!(amount > 0)) return;
    // ★ [v9.32 버그수정] row.basDt는 "조회 당일 날짜"라 배당기준일이 아님(매번 오늘 날짜로 찍힘).
    //   실제 배당기준일 필드인 dvdnBasDt를 1순위로 사용, basDt는 후보에서 제외.
    var baseDate = _publicDividendDate(row.dvdnBasDt || row.recordDate || row.stckBasDt);
    var payDate = _publicDividendDate(row.cashDvdnPayDt || row.dvdnPayDt || row.payDt || row.pymntDt);
    var eventDate = baseDate || payDate;
    if (!eventDate) return;
    // ★ [v9.32 신규] 대시보드 관리 시작일(PUBLIC_DIVIDEND_MIN_DATE) 이전 배당 이벤트는 제외
    if (eventDate < PUBLIC_DIVIDEND_MIN_DATE) return;
    var monthDate = payDate || eventDate;
    events.push({
      date: eventDate,
      payDate: payDate || '',
      month: parseInt(monthDate.substring(5, 7), 10),
      amount: amount,
      source: 'PUBLIC_DATA'
    });
  });
  events.sort(function(a,b){ return (a.date || '').localeCompare(b.date || ''); });
  var seen = {};
  events = events.filter(function(ev) {
    var key = [ev.date, ev.payDate, ev.amount].join('|');
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
  var meta = listedInfo || {};
  if (!events.length) return { perShare: 0, freq: '-', months: [], count: 0, events: [], source: 'PUBLIC_DATA', listedName: meta.name || companyName || '', crno: meta.crno || '' };
  var months = events.map(function(ev){ return ev.month; }).filter(function(m){ return m >= 1 && m <= 12; });
  var uniqM = months.filter(function(v,i,a){ return a.indexOf(v) === i; }).sort(function(a,b){ return a-b; });
  var count = events.length;
  var freq = count >= 10 ? '월배당' : count >= 4 ? '분기' : count >= 2 ? '반기' : '연간';
  var perShare = parseFloat((events.reduce(function(s, ev){ return s + ev.amount; }, 0) / count).toFixed(4));
  return { perShare: perShare, freq: freq, months: uniqM, count: count, events: events, source: 'PUBLIC_DATA', listedName: meta.name || companyName || '', crno: meta.crno || '' };
}

function _publicDividendAmount(row) {
  var candidates = [
    row.stckGenrDvdnAmt, row.stckGrdnDvdnAmt, row.cashDvdnAmt, row.dvdnAmt,
    row.dividend, row.perShare, row.amount
  ];
  for (var i = 0; i < candidates.length; i++) {
    var n = parseFloat(String(candidates[i] || '').replace(/,/g, ''));
    if (n > 0) return n;
  }
  return 0;
}

function _publicDividendDate(value) {
  var s = (value || '').toString().trim();
  if (!s) return '';
  var m = s.match(/^(\d{4})[-.]?(\d{2})[-.]?(\d{2})/);
  if (!m) return '';
  return m[1] + '-' + m[2] + '-' + m[3];
}

//  배당 조회
// ════════════════════════════════════════════════════════════════════
function handleDividendFetch(codes) {
  var ss = null;
  var tmp = null;
  try {
    ss = getss();
    // 요청별 고유 시트를 사용해 동시 배당 조회 충돌을 막고 finally에서 즉시 삭제합니다.
    tmp = ss.insertSheet(_tempSheetName('_div_tmp_'));

    var toDate   = new Date();
    var fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - 13);
    var fmt = function(d) { return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd'); };

    codes.forEach(function(rawCode, i) {
      var code = rawCode.toString().trim();
      if (!code) return;
      tmp.getRange(i * 20 + 1, 1).setFormula(
        '=IFERROR(GOOGLEFINANCE("KRX:'    + code + '","dividends","' + fmt(fromDate) + '","' + fmt(toDate) + '"),' +
        'IFERROR(GOOGLEFINANCE("KOSDAQ:' + code + '","dividends","' + fmt(fromDate) + '","' + fmt(toDate) + '"),"NO_DATA"))'
      );
    });
    SpreadsheetApp.flush();
    Utilities.sleep(Math.min(8000 + codes.length * 500, 55000)); // 종목수 × 300ms, 최대 45초

    var results = {};
    codes.forEach(function(rawCode, i) {
      var code     = rawCode.toString().trim();
      if (!code) return;
      var startRow = i * 20 + 1;
      var cellVal  = tmp.getRange(startRow, 1).getValue();
      if (!cellVal || cellVal === 'NO_DATA' || String(cellVal).startsWith('#')) {
         results[code] = { perShare: 0, freq: '-', months: [], count: 0, source: 'GOOGLEFINANCE' }; return;
      }
// GOOGLEFINANCE dividends: 첫 행은 헤더("Date","Amount"), 데이터는 2번째 행부터
     var divRows  = [];
     var headerVal = String(cellVal).toLowerCase();
     var dataStartOffset = (headerVal === 'date' || headerVal.includes('date')) ? 1 : 0;
     var divBlock = tmp.getRange(startRow + 1 + dataStartOffset, 1, 18, 2).getValues();
      for (var ri = 0; ri < divBlock.length; ri++) {
        var dv = divBlock[ri][0];
        var av = divBlock[ri][1];
        if (!dv || !av) break;
        var d = new Date(dv);
        if (isNaN(d.getTime())) break;
        var divDateStr = Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
        divRows.push({
          date: divDateStr,
          month: parseInt(divDateStr.substring(5, 7), 10),
          amount: parseFloat(av) || 0
        });
      }
      if (divRows.length === 0) { results[code] = { perShare: 0, freq: '-', months: [], count: 0, source: 'GOOGLEFINANCE' }; return; }
      var months   = divRows.map(function(r) { return r.month; });
      var uniqM    = months.filter(function(v,i,a){ return a.indexOf(v)===i; }).sort(function(a,b){return a-b;});
      var count    = divRows.length;
      var freq     = count >= 10 ? '월배당' : count >= 4 ? '분기' : count >= 2 ? '반기' : '연간';
      var perShare = parseFloat((divRows.reduce(function(s,r){return s+r.amount;},0)/count).toFixed(4));
      results[code] = { perShare: perShare, freq: freq, months: uniqM, count: count, events: divRows, source: 'GOOGLEFINANCE' };
    });

    return jsonOk({ dividends: results });
  } catch(err) {
    return jsonError('배당 조회 실패: ' + err.message);
  } finally {
    if (ss && tmp) {
      try { ss.deleteSheet(tmp); } catch(e) { Logger.log('⚠️ 배당 임시 시트 삭제 실패: ' + e.message); }
    }
  }
}

// ════════════════════════════════════════════════════════════════════
//  SEIBro ETF 분배금 읽기 전용 진단
//  HAR에서 확인한 실제 요청만 사용하며 시트/DIVDATA를 변경하지 않습니다.
// ════════════════════════════════════════════════════════════════════
var SEIBRO_ETF_ENDPOINT = 'https://seibro.or.kr/websquare/engine/proworks/callServletService.jsp';

function _seibroXmlEscape(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/\x22/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _seibroXmlValue(xml, tag) {
  var match = String(xml || '').match(new RegExp('<' + tag + '\\s+value="([^"]*)"\\s*\\/>'));
  return match ? match[1] : '';
}

function _seibroVectorCount(xml) {
  var match = String(xml || '').match(new RegExp('<vector\\b[^>]*\\bresult="(\\d+)"'));
  return match ? parseInt(match[1], 10) : null;
}

function _seibroPaymentEvents(xml) {
  var events = [];
  var resultPattern = /<result>([\s\S]*?)<\/result>/g;
  var match;
  while ((match = resultPattern.exec(String(xml || ''))) !== null) {
    var block = match[1];
    var dateRaw = _seibroXmlValue(block, 'RGT_STD_DT');
    var payDateRaw = _seibroXmlValue(block, 'TH1_PAY_TERM_BEGIN_DT');
    var amountRaw = _seibroXmlValue(block, 'ESTM_STDPRC');
    var date = dateRaw && dateRaw.length === 8 ? dateRaw.slice(0, 4) + '-' + dateRaw.slice(4, 6) + '-' + dateRaw.slice(6, 8) : '';
    var payDate = payDateRaw && payDateRaw.length === 8 ? payDateRaw.slice(0, 4) + '-' + payDateRaw.slice(4, 6) + '-' + payDateRaw.slice(6, 8) : '';
    var amount = parseFloat(amountRaw);
    if (!date || !isFinite(amount) || amount <= 0) continue;
    events.push({ date: date, payDate: payDate, amount: amount, source: 'SEIBRO' });
  }
  events.sort(function(a, b) { return a.date.localeCompare(b.date) || a.payDate.localeCompare(b.payDate); });
  return events;
}

function _seibroDateParam(value, fallbackDate) {
  var normalized = _normalizeDate(value || fallbackDate);
  if (!normalized) return '';
  return normalized.replace(/-/g, '');
}

function _seibroTtmStartDate(toDate) {
  var parts = String(toDate || '').split('-').map(function(v) { return parseInt(v, 10); });
  if (parts.length !== 3 || parts.some(function(v) { return !isFinite(v); })) return '';
  var date = new Date(Date.UTC(parts[0] - 1, parts[1] - 1, parts[2]));
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

function _getEtfDividendDiagnosticTargets(ss, fromDate, toDate) {
  var targets = {};
  var add = function(rawCode, name, reason) {
    var code = _cleanCode(rawCode);
    if (!code) return;
    if (!targets[code]) targets[code] = { code: code, name: String(name || ''), reasons: [] };
    if (name && !targets[code].name) targets[code].name = String(name);
    if (targets[code].reasons.indexOf(reason) === -1) targets[code].reasons.push(reason);
  };

  var holdings = ss.getSheetByName(CONFIG.SHEET_HOLD);
  if (holdings && holdings.getLastRow() >= 2) {
    var holdCols = Math.max(holdings.getLastColumn(), 7);
    var holdRows = holdings.getRange(2, 1, holdings.getLastRow() - 1, holdCols).getValues();
    var qtyByCode = {};
    var holdMeta = {};
    holdRows.forEach(function(row) {
      var isNew = row.length >= 7;
      var assetType = String(isNew ? row[5] : row[4] || '').trim().toUpperCase();
      var code = _cleanCode(row[0]);
      if (assetType !== 'ETF' || !code) return;
      qtyByCode[code] = (qtyByCode[code] || 0) + (parseFloat(row[2]) || 0);
      holdMeta[code] = { name: String(row[1] || '') };
    });
    Object.keys(qtyByCode).forEach(function(code) {
      if (qtyByCode[code] > 0) add(code, holdMeta[code].name, 'CURRENT_HOLDING');
    });
  }

  var trades = ss.getSheetByName(CONFIG.SHEET_TRADES);
  if (trades && trades.getLastRow() >= 2) {
    var tradeCols = Math.max(trades.getLastColumn(), 9);
    trades.getRange(2, 1, trades.getLastRow() - 1, tradeCols).getValues().forEach(function(row) {
      var assetType = String(row[7] || '').trim().toUpperCase();
      if (assetType !== 'ETF') return;
      var date = _normalizeDate(row[0]);
      if (!date || date < fromDate || date > toDate) return;
      add(row[4], row[3], 'TTM_TRADE');
    });
  }
  return Object.keys(targets).sort().map(function(code) { return targets[code]; });
}

function _seibroSearchRequest(target) {
  return {
    url: SEIBRO_ETF_ENDPOINT,
    method: 'post',
    contentType: 'application/xml; charset=UTF-8',
    headers: {
      Origin: 'https://seibro.or.kr',
      Referer: 'https://seibro.or.kr/websquare/control.jsp?w2xPath=/IPORTAL/user/etc/BIP_CMUC01039P.xml&ret_code_nm=INPUT_SN2&ret_code=INPUT_SN1',
      submissionid: 'submission_contentList'
    },
    payload: '<reqParam action="searchEtfContentList" task="ksd.safe.bip.cmuc.User.process.SearchPTask"><search_string value="' + _seibroXmlEscape(target.code) + '"/></reqParam>',
    muteHttpExceptions: true
  };
}

function _seibroPaymentRequest(isin, fromParam, toParam) {
  var body = '<reqParam action="exerInfoDtramtPayStatPlist" task="ksd.safe.bip.cnts.etf.process.EtfExerInfoPTask">' +
    '<MENU_NO value="179"/><CMM_BTN_ABBR_NM value="total_search,openall,print,hwp,word,pdf,searchIcon,searchIcon,seach,searchIcon,seach,"/>' +
    '<W2XPATH value="/IPORTAL/user/etf/BIP_CNTS06030V.xml"/><etf_sort_level_cd value="0"/><etf_big_sort_cd value=""/>' +
    '<START_PAGE value="1"/><END_PAGE value="30"/><etf_sort_cd value=""/><isin value="' + _seibroXmlEscape(isin) + '"/>' +
    '<mngco_custno value=""/><RGT_RSN_DTAIL_SORT_CD value=""/><fromRGT_STD_DT value="' + fromParam + '"/><toRGT_STD_DT value="' + toParam + '"/></reqParam>';
  return {
    url: SEIBRO_ETF_ENDPOINT,
    method: 'post',
    contentType: 'application/xml; charset=UTF-8',
    headers: {
      Origin: 'https://seibro.or.kr',
      Referer: 'https://seibro.or.kr/websquare/control.jsp?w2xPath=/IPORTAL/user/etf/BIP_CNTS06030V.xml&menuNo=179',
      submissionid: 'submission_exerInfoDtramtPayStatPlist'
    },
    payload: body,
    muteHttpExceptions: true
  };
}

function handleDiagnoseEtfDividends(fromInput, toInput, rawInput) {
  try {
    var toDate = _normalizeDate(toInput) || today();
    var fromDate = _normalizeDate(fromInput) || _seibroTtmStartDate(toDate);
    if (!fromDate || !toDate || fromDate > toDate) return jsonError('SEIBro 진단 날짜 범위를 확인해주세요.');
    var targets = _getEtfDividendDiagnosticTargets(getss(), fromDate, toDate);
    if (!targets.length) return jsonOk({ readOnly: true, from: fromDate, to: toDate, targetCount: 0, results: [] });
    var includeRaw = String(rawInput || '') === '1';
    var searchResponses = UrlFetchApp.fetchAll(targets.map(_seibroSearchRequest));
    var results = targets.map(function(target, index) {
      var response = searchResponses[index];
      var xml = response.getContentText('UTF-8');
      var row = { code: target.code, portfolioName: target.name, reasons: target.reasons, status: 'OK' };
      if (includeRaw) row.searchXml = xml;
      if (response.getResponseCode() !== 200) {
        row.status = 'REQUEST_ERROR'; row.error = 'search HTTP ' + response.getResponseCode(); return row;
      }
      if (xml.indexOf('<?xml') !== 0 && xml.trim().indexOf('<?xml') !== 0) {
        row.status = 'PARSE_ERROR'; row.error = 'search XML 선언 없음'; return row;
      }
      row.isin = _seibroXmlValue(xml, 'ISIN');
      row.seibroName = _seibroXmlValue(xml, 'KOR_SECN_NM');
      if (!row.isin || !row.seibroName) {
        row.status = 'NOT_FOUND'; row.error = '검색 결과 없음'; return row;
      }
      if (!/^KR[A-Z0-9]{10}$/.test(row.isin)) {
        row.status = 'MAPPING_ERROR'; row.error = 'ISIN 형식 오류'; return row;
      }
      return row;
    });

    var payable = results.filter(function(row) { return row.status === 'OK'; });
    if (payable.length) {
      var fromParam = _seibroDateParam(fromDate, fromDate);
      var toParam = _seibroDateParam(toDate, toDate);
      var paymentResponses = UrlFetchApp.fetchAll(payable.map(function(row) { return _seibroPaymentRequest(row.isin, fromParam, toParam); }));
      payable.forEach(function(row, index) {
        var response = paymentResponses[index];
        var xml = response.getContentText('UTF-8');
        if (includeRaw) row.paymentXml = xml;
        if (response.getResponseCode() !== 200) {
          row.status = 'REQUEST_ERROR'; row.error = 'payment HTTP ' + response.getResponseCode(); return;
        }
        var count = _seibroVectorCount(xml);
        if (count === null) {
          row.status = 'PARSE_ERROR'; row.error = '분배금 건수 파싱 실패'; return;
        }
        if (count === 0) {
          row.status = 'NOT_FOUND'; row.error = '분배금 내역 없음'; return;
        }
        var paymentIsin = _seibroXmlValue(xml, 'ISIN');
        if (paymentIsin !== row.isin) {
          row.status = 'MAPPING_ERROR'; row.error = '검색/분배금 ISIN 불일치'; return;
        }
        row.paymentCount = count;
        row.firstRecordDate = _seibroXmlValue(xml, 'RGT_STD_DT');
        row.firstPayDate = _seibroXmlValue(xml, 'TH1_PAY_TERM_BEGIN_DT');
        row.firstEstmStdprc = _seibroXmlValue(xml, 'ESTM_STDPRC');
        row.events = _seibroPaymentEvents(xml);
        row.ttmPerShare = row.events.reduce(function(sum, event) { return sum + event.amount; }, 0);
        row.months = row.events.map(function(event) { return parseInt((event.payDate || event.date).slice(5, 7), 10); })
          .filter(function(month, pos, all) { return month >= 1 && month <= 12 && all.indexOf(month) === pos; })
          .sort(function(a, b) { return a - b; });
        row.freq = row.events.length >= 10 ? '월배당' : row.events.length >= 4 ? '분기' : row.events.length >= 2 ? '반기' : '연간';
        if (!row.firstRecordDate || !row.firstEstmStdprc || row.events.length !== count) {
          row.status = 'PARSE_ERROR'; row.error = '분배금 필수 필드 없음';
        }
      });
    }
    var counts = { OK: 0, NOT_FOUND: 0, REQUEST_ERROR: 0, PARSE_ERROR: 0, MAPPING_ERROR: 0 };
    results.forEach(function(row) { counts[row.status] = (counts[row.status] || 0) + 1; });
    return jsonOk({ readOnly: true, wroteSheets: false, wroteDivData: false, from: fromDate, to: toDate, targetCount: targets.length, counts: counts, results: results });
  } catch(err) {
    return jsonError('SEIBro ETF 읽기 전용 진단 실패: ' + err.message);
  }
}

function _seibroEventKey(event) {
  return String(event.date || '').slice(0, 10) + '|' + String(event.payDate || '').slice(0, 10);
}

function _buildEtfDividendDryRun(diagnostic, divData) {
  var summary = { targets: diagnostic.targetCount || 0, events: 0, newEvents: 0, correctedEvents: 0, unchangedEvents: 0, changedDivData: 0 };
  var comparisons = [];
  (diagnostic.results || []).forEach(function(row) {
    if (row.status !== 'OK') return;
    var previous = divData[row.code] || {};
    var previousByKey = {};
    (Array.isArray(previous.events) ? previous.events : []).forEach(function(event) { previousByKey[_seibroEventKey(event)] = event; });
    var proposedEvents = (row.events || []).map(function(event) {
      var old = previousByKey[_seibroEventKey(event)];
      summary.events++;
      if (!old) summary.newEvents++;
      else if (Number(old.amount || 0) !== Number(event.amount || 0)) summary.correctedEvents++;
      else summary.unchangedEvents++;
      return event;
    });
    var proposed = {
      perShare: proposedEvents.length ? Number((row.ttmPerShare / proposedEvents.length).toFixed(4)) : 0,
      ttmPerShare: Number(Number(row.ttmPerShare || 0).toFixed(4)),
      freq: row.freq,
      months: row.months,
      count: proposedEvents.length,
      events: proposedEvents,
      source: 'SEIBRO',
      listedName: row.seibroName,
      isin: row.isin
    };
    var changed = JSON.stringify({ perShare: Number(previous.perShare || 0), freq: previous.freq || '-', months: previous.months || [], events: previous.events || [] }) !==
      JSON.stringify({ perShare: proposed.perShare, freq: proposed.freq, months: proposed.months, events: proposed.events });
    if (changed) summary.changedDivData++;
    comparisons.push({
      code: row.code,
      name: row.portfolioName,
      isin: row.isin,
      status: row.status,
      existingPerShare: Number(previous.perShare || 0),
      proposedPerShare: proposed.perShare,
      ttmPerShare: proposed.ttmPerShare,
      eventCount: proposed.count,
      changed: changed,
      proposed: proposed
    });
  });
  return { readOnly: true, wroteSheets: false, wroteDivData: false, summary: summary, comparisons: comparisons };
}

function handleDryRunEtfDividends(fromInput, toInput) {
  try {
    var output = handleDiagnoseEtfDividends(fromInput || '', toInput || '', '');
    var diagnostic = JSON.parse(output.getContent());
    if (diagnostic.status !== 'ok') return jsonError(diagnostic.message || 'SEIBro 진단 실패');
    var failed = (diagnostic.results || []).filter(function(row) { return row.status !== 'OK'; });
    if (failed.length) return jsonOk({ readOnly: true, wroteSheets: false, wroteDivData: false, blocked: true, counts: diagnostic.counts, results: diagnostic.results });
    var settings = _readSettingsMap();
    var dryRun = _buildEtfDividendDryRun(diagnostic, settings.DIVDATA || {});
    return jsonOk(Object.assign({ blocked: false, from: diagnostic.from, to: diagnostic.to }, dryRun));
  } catch(err) {
    return jsonError('SEIBro ETF 2단계 드라이런 실패: ' + err.message);
  }
}

function runEtfDividendDryRun() {
  var ui = SpreadsheetApp.getUi();
  try {
    ui.alert('SEIBro ETF 2단계 드라이런', '분배금 전체 행과 TTM 계산안을 기존 DIVDATA와 비교합니다.\n시트와 배당 데이터는 수정하지 않습니다.', ui.ButtonSet.OK);
    var data = JSON.parse(handleDryRunEtfDividends('', '').getContent());
    if (data.status !== 'ok') throw new Error(data.message || '드라이런 응답 오류');
    if (data.blocked) throw new Error('1단계 오류가 있어 드라이런이 중단됐습니다: ' + JSON.stringify(data.counts || {}));
    var summary = data.summary || {};
    var comparisons = data.comparisons || [];
    var lines = [
      '대상 ETF: ' + (summary.targets || 0) + '개',
      '분배금 행: ' + (summary.events || 0) + '건',
      '신규: ' + (summary.newEvents || 0) + '건',
      '정정: ' + (summary.correctedEvents || 0) + '건',
      '기존 일치: ' + (summary.unchangedEvents || 0) + '건',
      'DIVDATA 변경 예상: ' + (summary.changedDivData || 0) + '종목',
      '', '시트 수정: 없음', 'DIVDATA 수정: 없음'
    ];
    Logger.log('[SEIBro ETF 2단계 드라이런] ' + JSON.stringify(data));
    ui.alert('✅ SEIBro ETF 2단계 드라이런 완료', lines.join('\n'), ui.ButtonSet.OK);
    var pageSize = 10;
    var pageCount = Math.ceil(comparisons.length / pageSize);
    for (var page = 0; page < pageCount; page++) {
      var start = page * pageSize;
      var detailLines = comparisons.slice(start, start + pageSize).map(function(row) {
        return '- ' + row.code + ' ' + row.name + ': TTM ' + row.ttmPerShare + '원 / ' + row.eventCount + '건 / ' +
          (row.changed ? '변경 예상' : '기존 일치');
      });
      ui.alert(
        'TTM 전체 종목 확인 (' + (page + 1) + '/' + pageCount + ')',
        '전체 ' + comparisons.length + '종목 중 ' + (start + 1) + '~' + (start + detailLines.length) + '번째\n\n' + detailLines.join('\n'),
        ui.ButtonSet.OK
      );
    }
    return data;
  } catch(err) {
    Logger.log('[SEIBro ETF 2단계 드라이런 실패] ' + err.message);
    ui.alert('❌ SEIBro ETF 2단계 드라이런 실패', err.message + '\n\n시트와 배당 데이터는 수정되지 않았습니다.', ui.ButtonSet.OK);
    return { status: 'error', message: err.message, readOnly: true };
  }
}

function _etfDividendHistoryKey(row) {
  return _cleanCode(row.code) + '|' + String(row.isin || '') + '|' + String(row.date || '').slice(0, 10) + '|' + String(row.payDate || '').slice(0, 10);
}

function _readEtfDividendHistory(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues().map(function(row) {
    return {
      code: _cleanCode(row[0]), isin: String(row[1] || ''), name: String(row[2] || ''),
      date: _normalizeDate(row[3]), payDate: _normalizeDate(row[4]), amount: Number(row[5] || 0),
      collectedAt: row[6], source: String(row[7] || '')
    };
  }).filter(function(row) { return row.code && row.isin && row.date && row.amount > 0; });
}

function _mergeEtfDividendHistory(existing, comparisons, collectedAt) {
  var byKey = {};
  (existing || []).forEach(function(row) { byKey[_etfDividendHistoryKey(row)] = row; });
  var summary = { added: 0, corrected: 0, unchanged: 0 };
  (comparisons || []).forEach(function(comparison) {
    (comparison.proposed.events || []).forEach(function(event) {
      var incoming = {
        code: _cleanCode(comparison.code), isin: comparison.isin, name: comparison.name,
        date: event.date, payDate: event.payDate, amount: Number(event.amount),
        collectedAt: collectedAt, source: 'SEIBRO'
      };
      var key = _etfDividendHistoryKey(incoming);
      var previous = byKey[key];
      if (!previous) summary.added++;
      else if (Number(previous.amount) !== incoming.amount) summary.corrected++;
      else summary.unchanged++;
      byKey[key] = incoming;
    });
  });
  var rows = Object.keys(byKey).map(function(key) { return byKey[key]; });
  rows.sort(function(a, b) { return a.code.localeCompare(b.code) || a.date.localeCompare(b.date) || a.payDate.localeCompare(b.payDate); });
  return { rows: rows, summary: summary };
}

function _mergeSeibroDivData(existingDivData, comparisons, updatedAt) {
  var merged = JSON.parse(JSON.stringify(existingDivData || {}));
  (comparisons || []).forEach(function(comparison) {
    var previous = merged[comparison.code] || {};
    var manualByKey = {};
    (Array.isArray(previous.events) ? previous.events : []).forEach(function(event) {
      if (String(event.source || '').toUpperCase() === 'MANUAL') manualByKey[_seibroEventKey(event)] = event;
    });
    var events = (comparison.proposed.events || []).filter(function(event) {
      return !manualByKey[_seibroEventKey(event)];
    });
    Object.keys(manualByKey).forEach(function(key) { events.push(manualByKey[key]); });
    events.sort(function(a, b) { return String(a.date).localeCompare(String(b.date)) || String(a.payDate).localeCompare(String(b.payDate)); });
    var seibroEvents = events.filter(function(event) { return String(event.source || '').toUpperCase() !== 'MANUAL'; });
    merged[comparison.code] = Object.assign({}, previous, comparison.proposed, {
      events: events,
      ttmPerShare: Number(seibroEvents.reduce(function(sum, event) { return sum + Number(event.amount || 0); }, 0).toFixed(4)),
      updatedAt: updatedAt,
      note: 'SEIBro ETF 분배금 이력 기준'
    });
  });
  return merged;
}

function _writeEtfDividendHistory(sheet, rows) {
  var header = ['종목코드','ISIN','종목명','기준일','지급일','주당분배금','수집일시','원본소스'];
  sheet.clearContents();
  sheet.getRange(1, 1, 1, header.length).setValues([header])
    .setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
  sheet.setFrozenRows(1);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, 8).setValues(rows.map(function(row) {
      return [row.code, row.isin, row.name, row.date, row.payDate, row.amount, row.collectedAt, row.source];
    }));
    sheet.getRange(2, 1, rows.length, 1).setNumberFormat('@');
  }
}

function handleApplyEtfDividends() {
  var diagnosticOutput = handleDiagnoseEtfDividends('', '', '');
  var diagnostic = JSON.parse(diagnosticOutput.getContent());
  if (diagnostic.status !== 'ok') return jsonError(diagnostic.message || 'SEIBro 진단 실패');
  var failed = (diagnostic.results || []).filter(function(row) { return row.status !== 'OK'; });
  if (failed.length) return jsonError('전체 검증 실패로 저장하지 않았습니다: ' + JSON.stringify(diagnostic.counts || {}));

  var lock = LockService.getScriptLock();
  var locked = false;
  var ss = getss();
  var sheet = null;
  var createdSheet = false;
  var oldSheetValues = null;
  var oldSettings = null;
  try {
    lock.waitLock(30000); locked = true;
    oldSettings = _readSettingsMap();
    var dryRun = _buildEtfDividendDryRun(diagnostic, oldSettings.DIVDATA || {});
    if ((dryRun.comparisons || []).length !== diagnostic.targetCount) throw new Error('저장 대상 종목 수 불일치');

    sheet = ss.getSheetByName(CONFIG.SHEET_ETF_DIVIDENDS);
    if (sheet) {
      oldSheetValues = sheet.getDataRange().getValues();
    } else {
      sheet = ss.insertSheet(CONFIG.SHEET_ETF_DIVIDENDS);
      createdSheet = true;
    }
    var existingHistory = _readEtfDividendHistory(sheet);
    var updatedAt = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
    var history = _mergeEtfDividendHistory(existingHistory, dryRun.comparisons, updatedAt);
    var nextSettings = JSON.parse(JSON.stringify(oldSettings));
    nextSettings.DIVDATA = _mergeSeibroDivData(oldSettings.DIVDATA || {}, dryRun.comparisons, updatedAt);

    _writeEtfDividendHistory(sheet, history.rows);
    _writeSettingsMap(nextSettings);
    SpreadsheetApp.flush();
    return jsonOk({
      saved: true, targetCount: diagnostic.targetCount, historyRows: history.rows.length,
      added: history.summary.added, corrected: history.summary.corrected, unchanged: history.summary.unchanged,
      wroteSheets: true, wroteDivData: true, updatedAt: updatedAt
    });
  } catch(err) {
    try {
      if (oldSettings) _writeSettingsMap(oldSettings);
      if (createdSheet && sheet) ss.deleteSheet(sheet);
      else if (sheet && oldSheetValues) {
        sheet.clearContents();
        if (oldSheetValues.length && oldSheetValues[0].length) sheet.getRange(1, 1, oldSheetValues.length, oldSheetValues[0].length).setValues(oldSheetValues);
      }
      SpreadsheetApp.flush();
    } catch(rollbackError) {
      return jsonError('3단계 저장 실패 및 복구 실패: ' + err.message + ' / ' + rollbackError.message);
    }
    return jsonError('3단계 저장 실패, 저장 전 상태로 복구했습니다: ' + err.message);
  } finally {
    if (locked) lock.releaseLock();
  }
}

function _isEtfDividendRefreshCurrent(settings, targets, dateStr) {
  var divData = (settings && settings.DIVDATA && typeof settings.DIVDATA === 'object') ? settings.DIVDATA : {};
  return targets.length > 0 && targets.every(function(target) {
    var row = divData[target.code];
    return row
      && String(row.source || '').toUpperCase() === 'SEIBRO'
      && Array.isArray(row.events) && row.events.length > 0
      && String(row.updatedAt || '').slice(0, 10) === dateStr;
  });
}

function handleRefreshEtfDividends(forceInput) {
  try {
    var toDate = today();
    var fromDate = _seibroTtmStartDate(toDate);
    var targets = _getEtfDividendDiagnosticTargets(getss(), fromDate, toDate);
    var settings = _readSettingsMap();
    if (!targets.length) return jsonOk({ refreshed: false, skipped: true, reason: 'NO_TARGETS', targetCount: 0, divData: settings.DIVDATA || {} });
    var force = String(forceInput || '') === '1';
    if (!force && _isEtfDividendRefreshCurrent(settings, targets, toDate)) {
      return jsonOk({
        refreshed: false, skipped: true, reason: 'TODAY_ALREADY_UPDATED',
        targetCount: targets.length, divData: settings.DIVDATA || {}
      });
    }
    var output = handleApplyEtfDividends();
    var result = JSON.parse(output.getContent());
    if (result.status !== 'ok') return jsonError(result.message || 'SEIBro ETF 자동 갱신 실패');
    var refreshedSettings = _readSettingsMap();
    return jsonOk(Object.assign({}, result, {
      refreshed: true, skipped: false, divData: refreshedSettings.DIVDATA || {}
    }));
  } catch(err) {
    return jsonError('SEIBro ETF 자동 갱신 실패: ' + err.message);
  }
}

function runEtfDividendApply() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert(
    'SEIBro ETF 3단계 운영 반영',
    '전체 SEIBro 검증을 다시 실행한 뒤 오류가 0건일 때만 ETF분배금이력 시트와 DIVDATA를 갱신합니다.\n기존 이력과 MANUAL 이벤트는 보존됩니다.\n\n계속하시겠습니까?',
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return { status: 'cancelled' };
  var data = JSON.parse(handleApplyEtfDividends().getContent());
  if (data.status !== 'ok') {
    ui.alert('❌ SEIBro ETF 3단계 반영 실패', data.message || '알 수 없는 오류', ui.ButtonSet.OK);
    return data;
  }
  ui.alert('✅ SEIBro ETF 3단계 반영 완료', [
    '대상 ETF: ' + data.targetCount + '개',
    '이력 전체: ' + data.historyRows + '건',
    '신규: ' + data.added + '건',
    '정정: ' + data.corrected + '건',
    '기존 일치: ' + data.unchanged + '건',
    '', 'ETF분배금이력 수정: 완료', 'DIVDATA 수정: 완료'
  ].join('\n'), ui.ButtonSet.OK);
  return data;
}

function runEtfDividendDiagnosis() {
  var ui = SpreadsheetApp.getUi();
  try {
    ui.alert('SEIBro ETF 읽기 전용 진단', '현재 보유현황과 최근 1년 거래이력의 ETF를 조회합니다.\n시트와 배당 데이터는 수정하지 않습니다.\n\n조회에 잠시 시간이 걸릴 수 있습니다.', ui.ButtonSet.OK);
    var output = handleDiagnoseEtfDividends('', '', '');
    var data = JSON.parse(output.getContent());
    if (data.status !== 'ok') throw new Error(data.message || '진단 응답 오류');
    var counts = data.counts || {};
    var failures = (data.results || []).filter(function(row) { return row.status !== 'OK'; });
    var lines = [
      '조회 대상: ' + (data.targetCount || 0) + '개',
      '정상: ' + (counts.OK || 0) + '개',
      'NOT_FOUND: ' + (counts.NOT_FOUND || 0),
      'REQUEST_ERROR: ' + (counts.REQUEST_ERROR || 0),
      'PARSE_ERROR: ' + (counts.PARSE_ERROR || 0),
      'MAPPING_ERROR: ' + (counts.MAPPING_ERROR || 0),
      '',
      '시트 수정: 없음',
      'DIVDATA 수정: 없음'
    ];
    if (failures.length) {
      lines.push('', '확인이 필요한 종목:');
      failures.slice(0, 15).forEach(function(row) {
        lines.push('- ' + row.code + ' ' + (row.portfolioName || '') + ': ' + row.status + (row.error ? ' (' + row.error + ')' : ''));
      });
      if (failures.length > 15) lines.push('- 외 ' + (failures.length - 15) + '개');
    }
    Logger.log('[SEIBro ETF 진단] ' + JSON.stringify(data));
    ui.alert(failures.length ? '⚠️ SEIBro ETF 진단 확인 필요' : '✅ SEIBro ETF 진단 성공', lines.join('\n'), ui.ButtonSet.OK);
    return data;
  } catch(err) {
    Logger.log('[SEIBro ETF 진단 실패] ' + err.message);
    ui.alert('❌ SEIBro ETF 진단 실패', err.message + '\n\n시트와 배당 데이터는 수정되지 않았습니다.', ui.ButtonSet.OK);
    return { status: 'error', message: err.message, readOnly: true };
  }
}

// ════════════════════════════════════════════════════════════════════
//  getPrices — Toss → KRX → 기존 확정 가격이력
// ════════════════════════════════════════════════════════════════════
function handleGetPricesCompat(codesParam, persist) {
  try {
    var requestStartedMs = Date.now();
    var timings = _newPriceLookupTimings_();
    var setupStartedMs = Date.now();
    var ss       = getss();
    var todayStr = today();
    var triggerState = _ensureDailyTriggersOncePerDay(todayStr);
    var reqCodes = codesParam.split(',').map(function(c){ return c.trim(); }).filter(Boolean);
    var cache = CacheService.getScriptCache();
    var cacheRaw = todayStr + '|p=' + (persist ? '1' : '0') + '|' + reqCodes.slice().sort().join(',');
    var cacheHash = Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, cacheRaw)
    ).replace(/=+$/g, '').slice(0, 40);
    var cacheKey = 'prices_v9176_p' + (persist ? '1' : '0') + '_' + cacheHash;
    var cached = cache.get(cacheKey);
    _priceTimingAdd_(timings, 'setup', setupStartedMs);
    if (cached) {
      try {
        var cachedPayload = JSON.parse(cached);
        cachedPayload.cached = true;
        cachedPayload.priceLookup = cachedPayload.priceLookup || {};
        cachedPayload.priceLookup.cacheHit = true;
        cachedPayload.priceLookup.serverElapsedMs = Date.now() - requestStartedMs;
        cachedPayload.priceLookup.triggerAutoFixed = !!triggerState.autoFixed;
        cachedPayload.priceLookup.timings = timings;
        cachedPayload.priceLookup.recentHistoryFallbackItems = Array.isArray(cachedPayload.priceLookup.recentHistoryFallbackItems)
          ? cachedPayload.priceLookup.recentHistoryFallbackItems : [];
        var cachedLatestDate = _normalizeDate(cachedPayload.priceLookup.confirmedSnapshotDate || '');
        cachedPayload.priceLookup.snapshotDate = cachedLatestDate;
        var cachedSnapshotStartedMs = Date.now();
        cachedPayload.priceLookup.snapshotCreated = persist && cachedLatestDate
          ? _ensureSnapshotExistsForDate(ss, cachedLatestDate)
          : false;
        _priceTimingAdd_(timings, 'snapshot', cachedSnapshotStartedMs);
        var cachedFinalizeStartedMs = Date.now();
        cachedPayload.priceLookup.serverElapsedMs = Date.now() - requestStartedMs;
        _priceTimingAdd_(timings, 'finalize', cachedFinalizeStartedMs);
        return jsonOk(cachedPayload);
      } catch(cacheErr) {}
    }

    var initialPriceHistoryStartedMs = Date.now();
    var phPrices = getPriceHistoryRow(ss, todayStr);
    _priceTimingAdd_(timings, 'initialPriceHistory', initialPriceHistoryStartedMs);
    var prices   = {};
    var priceDates = {};
    var missing  = [];
    var stillMissing = [];
    var recentHistoryFallbackCount = 0;
    var lookupMeta = {
      requestedCount: reqCodes.length,
      usdItemPresent: false,
      tossResultCount: 0,
      tossAttempted: false,
      tossStatus: 'NOT_RUN',
      tossReason: '',
      krxExecuted: false,
      krxResultCount: 0,
      krxElapsedMs: 0,
      googleFinanceCandidateCount: 0,
      googleFinanceExecuted: false,
      googleFinanceSkipped: false,
      googleFinanceSkipReason: '',
      googleFinanceResultCount: 0,
      recentHistoryFallbackCount: 0,
      recentHistoryFallbackItems: [],
      cacheHit: false
    };

    reqCodes.forEach(function(code) {
      if (phPrices[code] && phPrices[code] > 0) {
        prices[code] = phPrices[code];
        priceDates[code] = todayStr;
      }
      else missing.push(code);
    });

    // ★ 오늘 가격이력 값이 있어도 KRX 우선으로 재검증/갱신
    //    (가능하면 KRX 값으로 확정, 실패분만 GF fallback)
    if (reqCodes.length > 0) {
      var codeNameMap = {};
      var codeItemMap = {};
      var codeItemsStartedMs = Date.now();
      getCodeItems(ss).forEach(function(item) {
        codeNameMap[item.code] = item.name;
        codeItemMap[item.code] = item;
      });
      _priceTimingAdd_(timings, 'codeItems', codeItemsStartedMs);
      var targetItems = reqCodes.map(function(c){
        return codeItemMap[c] || { code: c, name: codeNameMap[c] || c, currency: 'KRW' };
      });
      lookupMeta.usdItemPresent = _hasUsdPriceItems(targetItems);
      var tossPrices = {};
      var tossProviderMeta = { attempted: false, status: 'NOT_RUN', reason: '' };
      try {
        tossPrices = fetchPricesToss(targetItems, timings, tossProviderMeta);
        lookupMeta.tossAttempted = !!tossProviderMeta.attempted;
        lookupMeta.tossStatus = tossProviderMeta.status || 'NOT_RUN';
        lookupMeta.tossReason = tossProviderMeta.reason || '';
      } catch(e) {
        lookupMeta.tossAttempted = !!tossProviderMeta.attempted;
        lookupMeta.tossStatus = 'ERROR';
        lookupMeta.tossReason = 'REQUEST_ERROR';
        Logger.log('⚠️ Toss 현재가 실패: ' + e.message);
      }
      var krxItems = targetItems.filter(function(it){ return !(tossPrices[it.code] && tossPrices[it.code].price > 0); });
      var krxPrices = {};
      var krxStartedMs = Date.now();
      try { krxPrices = fetchPricesKrx(krxItems, todayStr); } catch(e) { Logger.log('⚠️ handleGetPricesCompat KRX 실패: ' + e.message); }
      _priceTimingAdd_(timings, 'krx', krxStartedMs);
      lookupMeta.tossResultCount = Object.keys(tossPrices).length;
      lookupMeta.krxExecuted = krxItems.length > 0;
      lookupMeta.krxResultCount = Object.keys(krxPrices).length;
      lookupMeta.krxElapsedMs = timings.krx;
      lookupMeta.googleFinanceCandidateCount = 0;
      lookupMeta.googleFinanceExecuted = false;
      lookupMeta.googleFinanceSkipped = true;
      lookupMeta.googleFinanceSkipReason = '현재가 경로에서 사용하지 않음';
      lookupMeta.googleFinanceResultCount = 0;
      var sourceByCode = {};
      // ★ [버그수정] KRX fallback usedDate 기준으로 날짜 분리 저장
      //   usedDate != todayStr 인 경우 전일 종가를 todayStr로 저장하는 문제 방지
      var newItemsByDate = {};  // saveDate → items[]
      reqCodes.forEach(function(code) {
        var val = (tossPrices[code] && tossPrices[code].price > 0) ? tossPrices[code]
                 : ((krxPrices[code] && krxPrices[code].price > 0) ? krxPrices[code] : null);
        if (val && val.price > 0) {
          var nextPrice = val.price;
          prices[code] = nextPrice;
          sourceByCode[code] = val.source || 'UNKNOWN';
          var saveDate = (val.usedDate && val.usedDate !== todayStr) ? val.usedDate : todayStr;
          priceDates[code] = saveDate;
          var existingForDate = (saveDate === todayStr) ? phPrices : getPriceHistoryRow(ss, saveDate);
          var canPersistConfirmed = _isConfirmedHistoryPrice_(val, saveDate) || String(val.source || '').toUpperCase() === 'KRX';
          if (canPersistConfirmed && (!existingForDate[code] || Number(existingForDate[code]) !== Number(nextPrice))) {
            if (!newItemsByDate[saveDate]) newItemsByDate[saveDate] = [];
            newItemsByDate[saveDate].push({ code: code, name: codeNameMap[code] || code, price: nextPrice, source: (val.source || 'UNKNOWN') });
          }
          if (!canPersistConfirmed) delete sourceByCode[code];
        } else {
          if (!prices[code]) stillMissing.push(code);
        }
      });
      var snapshotStartedMs = Date.now();
      if (persist) Object.keys(newItemsByDate).forEach(function(saveDate) {
        if (newItemsByDate[saveDate].length > 0) batchUpsertPriceHistory(ss, saveDate, newItemsByDate[saveDate]);
      });
      _priceTimingAdd_(timings, 'snapshot', snapshotStartedMs);

      // KRX가 휴일/지연으로 더 과거 usedDate를 반환해도 가격이력에 더 최신 날짜가
      // 있으면 최신 이력을 화면 값으로 사용합니다. 조회 성공 여부만으로 최신값을 덮지 않습니다.
      var recentHistoryStartedMs = Date.now();
      var latestEntries = getLatestPriceHistoryEntries(ss, reqCodes, todayStr);
      reqCodes.forEach(function(code) {
        var latestEntry = latestEntries[code];
        if (!latestEntry || !(latestEntry.price > 0)) return;
        if (!priceDates[code] || latestEntry.date > priceDates[code]) {
          prices[code] = latestEntry.price;
          priceDates[code] = latestEntry.date;
          recentHistoryFallbackCount++;
          lookupMeta.recentHistoryFallbackItems.push({
            code: code,
            name: codeNameMap[code] || code,
            priceDate: latestEntry.date
          });
          delete sourceByCode[code];
        }
      });
      _priceTimingAdd_(timings, 'recentHistory', recentHistoryStartedMs);
      stillMissing = reqCodes.filter(function(code) { return !(prices[code] > 0); });
      lookupMeta.recentHistoryFallbackCount = recentHistoryFallbackCount;
      var snapshotUpdateStartedMs = Date.now();
      if (persist) _updateTodaySnapshotSource(ss, todayStr, sourceByCode);

      // 웹에서 평가가격을 갱신할 때도 최신 가격이력 날짜의 스냅샷을 즉시 맞춥니다.
      // 16:20 트리거가 누락됐더라도 다음 웹 갱신에서 자동 복구됩니다.
      var latestDisplayDate = _latestDateFromPriceDates(priceDates);
      var confirmedPersistDates = Object.keys(newItemsByDate);
      if (persist && confirmedPersistDates.length) _rebuildSnapshotForDateFromHistory(ss, confirmedPersistDates.sort().slice(-1)[0]);
      lookupMeta.confirmedSnapshotDate = confirmedPersistDates.length ? confirmedPersistDates.sort().slice(-1)[0] : '';
      _priceTimingAdd_(timings, 'snapshot', snapshotUpdateStartedMs);
      lookupMeta.snapshotDate = latestDisplayDate;
      lookupMeta.snapshotCreated = false;
      lookupMeta.triggerAutoFixed = !!triggerState.autoFixed;
    }
    // 요청 종목에서 실제 사용하는 외화만 조회합니다.
    var requestedSet = {};
    var otherStartedMs = Date.now();
    reqCodes.forEach(function(code){ requestedSet[code] = true; });
    var neededCurrencies = [];
    getCodeItems(ss).forEach(function(item) {
      if (!requestedSet[item.code] || !item.currency || item.currency === 'KRW') return;
      if (neededCurrencies.indexOf(item.currency) === -1) neededCurrencies.push(item.currency);
    });
    var exchangeRates = neededCurrencies.length > 0 ? fetchExchangeRates(ss, neededCurrencies) : {};
    _priceTimingAdd_(timings, 'other', otherStartedMs);
    var finalizeStartedMs = Date.now();
    lookupMeta.timings = timings;
    lookupMeta.serverElapsedMs = Date.now() - requestStartedMs;
    Logger.log('[price-lookup] ' + JSON.stringify(lookupMeta));
    var payload = { prices: prices, priceDates: priceDates, missing: stillMissing, exchangeRates: exchangeRates, priceLookup: lookupMeta };
    try { cache.put(cacheKey, JSON.stringify(payload), 60); } catch(cacheWriteErr) {}
    _priceTimingAdd_(timings, 'finalize', finalizeStartedMs);
    return jsonOk(payload);
  } catch(err) {
    return jsonError('getPrices 실패: ' + err.message);
  }
}

function _latestDateFromPriceDates(priceDates) {
  var latest = '';
  Object.keys(priceDates || {}).forEach(function(code) {
    var date = _normalizeDate(priceDates[code]);
    if (date && date > latest) latest = date;
  });
  return latest;
}

// 캐시 응답은 가격 재조회는 생략하되 스냅샷 누락 여부는 확인합니다.
// 이미 해당 날짜 행이 있으면 재계산하지 않아 캐시 응답의 장점을 유지합니다.
function _ensureSnapshotExistsForDate(ss, dateStr) {
  if (!dateStr) return false;
  var configs = _readFundUnits(ss);
  var existing = _filterSnapshotRowsByFundLifecycle(_readSnapshotRowsByDate(ss, dateStr), configs, dateStr);
  if (existing.length > 0) return false;
  _rebuildSnapshotForDateFromHistory(ss, dateStr);
  return _filterSnapshotRowsByFundLifecycle(_readSnapshotRowsByDate(ss, dateStr), configs, dateStr).length > 0;
}

// ── 환율 조회 (GOOGLEFINANCE 기반)
// 지원 통화: USD, JPY, EUR, CNY, HKD
// 임시 시트에 수식 삽입 후 읽는 방식 (GAS에서 GOOGLEFINANCE 직접 호출 불가)
// ── 환율 인메모리 캐시 (GAS 인스턴스 내 재사용 — 반복 flush 방지)
var _fxRatesCache = null;
var _fxRatesCacheDate = '';

function fetchExchangeRates(ss, requestedCurrencies) {
  var supported = ['USD', 'JPY', 'EUR', 'CNY', 'HKD'];
  var CURRENCIES = Array.isArray(requestedCurrencies) && requestedCurrencies.length > 0
    ? requestedCurrencies.filter(function(cur, index, arr) { return supported.indexOf(cur) >= 0 && arr.indexOf(cur) === index; })
    : supported;
  var rates = {};
  if (CURRENCIES.length === 0) return rates;
  // ★ 당일 캐시 재사용 — getPrices 호출마다 flush하면 2~5초 추가되므로
  var todayStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  if (_fxRatesCache && _fxRatesCacheDate === todayStr) {
    var cachedRates = {};
    CURRENCIES.forEach(function(cur){ if (_fxRatesCache[cur] > 0) cachedRates[cur] = _fxRatesCache[cur]; });
    if (Object.keys(cachedRates).length === CURRENCIES.length) return cachedRates;
  }

  // ★ [버그수정] 공유 임시 시트 대신 요청마다 고유한 임시 시트 사용 (동시 요청 충돌 방지)
  // ★ [안전장치] try/finally로 감싸 중간에 오류가 나도 임시 시트가 반드시 정리되도록 함
  var tmp = ss.insertSheet(_tempSheetName('_fx_tmp_'));
  try {
    var formulas = CURRENCIES.map(function(cur) {
      return ['=IFERROR(GOOGLEFINANCE("CURRENCY:' + cur + 'KRW"), 0)'];
    });
    tmp.getRange(1, 1, formulas.length, 1).setFormulas(formulas);
    SpreadsheetApp.flush();
    var values = tmp.getRange(1, 1, formulas.length, 1).getValues();
    CURRENCIES.forEach(function(cur, i) {
      var v = Number(values[i][0]);
      if (v > 0) rates[cur] = Math.round(v * 10) / 10;
    });
    _fxRatesCache = Object.assign({}, _fxRatesCache || {}, rates);
    _fxRatesCacheDate = todayStr;
  } catch(e) {
    Logger.log('⚠️ fetchExchangeRates 실패: ' + e.message);
  } finally {
    try { ss.deleteSheet(tmp); } catch(delErr) {}
  }
  return rates;
}

// ════════════════════════════════════════════════════════════════════
//  getPriceHistory — 날짜 범위별 가격이력 조회
// ════════════════════════════════════════════════════════════════════
function handleGetPriceHistory(fromStr, toStr, codesParam) {
  try {
    var ss = getss();
    var ph = ss.getSheetByName(CONFIG.SHEET_PH);
    if (!ph || ph.getLastRow() < 2) return jsonOk({ dates: [], prices: {} });

    // ★ source(6번째) 컬럼도 포함해 읽기 — MANUAL/KRX 구분 가능
    var readCols = ph.getLastColumn() >= 6 ? 6 : (ph.getLastColumn() >= 5 ? 5 : 4);
    var data     = ph.getRange(2, 1, ph.getLastRow() - 1, readCols).getValues();
    var reqCodes = codesParam ? codesParam.split(',').map(function(c){ return c.trim(); }).filter(Boolean) : null;
    var reqAliasToCanonical = reqCodes ? _buildCodeAliasMap(reqCodes) : null;
    var dateMap  = {};

    data.forEach(function(row) {
      var date   = _normalizeDate(row[0]);
      var code   = _cleanCode(row[1]) || (row[1] || '').toString().trim();
      var name   = (row[2] || '').toString().trim();
      var price  = parseFloat(row[3]) || 0;
      var savedAt = _normalizeDatetime(row[4]);
      var source = readCols >= 6 ? (row[5] || '').toString().trim() : '';
      var key    = code || name;
      if (!date || !key || price <= 0) return;
      if (fromStr && date < fromStr) return;
      if (toStr   && date > toStr)   return;
      if (reqAliasToCanonical && !reqAliasToCanonical[key]) return;
      var outKey = reqAliasToCanonical ? (reqAliasToCanonical[key] || key) : key;
      if (!dateMap[date]) dateMap[date] = {};
      var prev = dateMap[date][outKey];
      if (!prev) {
        dateMap[date][outKey] = { price: price, savedAt: savedAt, source: source };
      } else {
        // 같은 날짜/키 중 MANUAL(savedAt 있음) 값 우선
        if (prev.savedAt && !savedAt) return;
        if (!prev.savedAt && savedAt) {
          dateMap[date][outKey] = { price: price, savedAt: savedAt, source: source };
          return;
        }
        dateMap[date][outKey] = { price: price, savedAt: savedAt, source: source };
      }
    });

    // dateMap 키에서 직접 추출 — O(n), 중복 없음
    var allDates = Object.keys(dateMap).sort();

    var pricesByCode = {};
    allDates.forEach(function(date) {
      Object.keys(dateMap[date]).forEach(function(key) {
        if (!pricesByCode[key]) pricesByCode[key] = [];
        var entry = dateMap[date][key];
        pricesByCode[key].push({ date: date, price: entry.price, savedAt: entry.savedAt || '', source: entry.source || '' });
      });
    });

    return jsonOk({ dates: allDates, prices: pricesByCode });
  } catch(err) {
    return jsonError('getPriceHistory 실패: ' + err.message);
  }
}

function _benchmarkSymbolMap() {
  return {
    KOSPI: ['KOSPI'],
    KOSDAQ: ['KOSDAQ'],
    SP500: ['^GSPC'],
    DOW: ['^DJI'],
    NASDAQ: ['^IXIC'],
    NASDAQ100: ['^NDX'],
    KOSPI200: ['^KS200'],
    SOX: ['^SOX'],
    VIX: ['^VIX'],
    VKOSPI: []
  };
}

var TOSS_MARKET_INDICATOR_SYMBOLS = { KOSPI: true, KOSDAQ: true, KR_BOND_2Y: true, KR_BOND_3Y: true, KR_BOND_5Y: true, KR_BOND_10Y: true, KR_BOND_20Y: true, KR_BOND_30Y: true };
var YAHOO_INDEX_SYMBOLS = { SP500: '^GSPC', NASDAQ: '^IXIC', NASDAQ100: '^NDX', DOW: '^DJI', KOSPI200: '^KS200', SOX: '^SOX', VIX: '^VIX' };
var KRX_OFFICIAL_INDEX_CONFIG = {
  KOSPI: { endpoint: 'https://data-dbg.krx.co.kr/svc/apis/idx/kospi_dd_trd', idxName: '코스피' },
  KOSDAQ: { endpoint: 'https://data-dbg.krx.co.kr/svc/apis/idx/kosdaq_dd_trd', idxName: '코스닥' }
};

function _isKrxOfficialCloseAvailableTime_(now) {
  return Utilities.formatDate(now || new Date(), CONFIG.TIMEZONE, 'HHmm') >= '1600';
}

function fetchKrxOfficialIndexCloses(symbols, tradingDate) {
  var authKey = _getKrxAuthKey(), date = _normalizeDate(tradingDate || ''), ymd = date.replace(/-/g, '');
  if (!authKey || !/^\d{8}$/.test(ymd)) return {};
  var requested = (symbols || []).filter(function(symbol) { return !!KRX_OFFICIAL_INDEX_CONFIG[symbol]; });
  var requests = requested.map(function(symbol) {
    var cfg = KRX_OFFICIAL_INDEX_CONFIG[symbol];
    return { url: cfg.endpoint + '?basDd=' + encodeURIComponent(ymd), method: 'get', headers: { AUTH_KEY: authKey }, muteHttpExceptions: true };
  });
  var output = {};
  if (!requests.length) return output;
  UrlFetchApp.fetchAll(requests).forEach(function(response, index) {
    if (response.getResponseCode() >= 400) return;
    var json; try { json = JSON.parse(response.getContentText() || '{}'); } catch(ignore) { return; }
    var symbol = requested[index], cfg = KRX_OFFICIAL_INDEX_CONFIG[symbol];
    var row = (Array.isArray(json.OutBlock_1) ? json.OutBlock_1 : []).filter(function(item) {
      return _normalizeYmd(item.BAS_DD || item.basDd || '') === ymd && String(item.IDX_NM || item.idxNm || '').trim() === cfg.idxName;
    })[0];
    var value = row ? parseFloat(String(row.CLSPRC_IDX || row.clsprcIdx || '').replace(/,/g, '')) : 0;
    if (value > 0) output[symbol] = { date: date, value: value, observedAt: date + 'T15:30:00+09:00', source: 'KRX_OFFICIAL', confirmedClose: true };
  });
  return output;
}

function _fetchKrxOfficialIndexClosesSafe_(symbols, tradingDate) {
  try { return { data: fetchKrxOfficialIndexCloses(symbols, tradingDate), error: '' }; }
  catch(error) { return { data: {}, error: error.message || 'KRX_OFFICIAL_ERROR' }; }
}

function _parseKrxK200NightExpiry_(isuName) {
  var name = String(isuName || '').replace(/\s/g, '');
  var match = name.match(/^코스피200F(20\d{2})(0[1-9]|1[0-2])\(야간\)$/);
  return match ? match[1] + match[2] : '';
}

function _selectKrxK200NightClose_(rows, tradingDate) {
  var date = _normalizeDate(tradingDate || ''), ymd = date.replace(/-/g, ''), month = ymd.slice(0, 6);
  if (!/^\d{8}$/.test(ymd)) return null;
  var candidates = (Array.isArray(rows) ? rows : []).map(function(row) {
    var market = String(row && (row.MKT_NM || row.mktNm) || '').trim();
    var product = String(row && (row.PROD_NM || row.prodNm) || '').trim();
    var issue = String(row && (row.ISU_NM || row.isuNm) || '').trim();
    var expiry = _parseKrxK200NightExpiry_(issue);
    var close = parseFloat(String(row && (row.TDD_CLSPRC || row.tddClsprc) || '').replace(/,/g, ''));
    var exactDate = _normalizeYmd(row && (row.BAS_DD || row.basDd) || '') === ymd;
    if (!exactDate || market.replace(/\s/g, '') !== '야간' || product.replace(/\s/g, '') !== '코스피200선물' || !expiry || expiry < month || !(close > 0)) return null;
    return { expiry: expiry, close: close, issue: issue };
  }).filter(function(row) { return !!row; }).sort(function(a, b) { return a.expiry.localeCompare(b.expiry); });
  if (!candidates.length) return null;
  var nearest = candidates.filter(function(row) { return row.expiry === candidates[0].expiry; });
  if (nearest.length !== 1) return null;
  return nearest[0];
}

function fetchKrxK200NightClose(tradingDate, now) {
  var date = _normalizeDate(tradingDate || ''), ymd = date.replace(/-/g, ''), authKey = _getKrxAuthKey();
  if (!authKey || !/^\d{8}$/.test(ymd)) return null;
  if (Utilities.formatDate(now || new Date(), CONFIG.TIMEZONE, 'HHmm') < '0600') return null;
  var response = UrlFetchApp.fetch('https://data-dbg.krx.co.kr/svc/apis/drv/fut_bydd_trd?basDd=' + encodeURIComponent(ymd), {
    method: 'get', headers: { AUTH_KEY: authKey }, muteHttpExceptions: true
  });
  if (response.getResponseCode() >= 400) throw new Error('KRX_K200_NIGHT_HTTP_' + response.getResponseCode());
  var json = JSON.parse(response.getContentText() || '{}');
  var selected = _selectKrxK200NightClose_(json.OutBlock_1, date);
  if (!selected) return null;
  return { seriesId:'K200_NIGHT', value:selected.close, tradingDate:date, sourceDate:date, market:'KRX', session:'NIGHT', source:'KRX_OFFICIAL', status:'FINAL', finality:'NIGHT_FINAL', observedAt:date + 'T06:00:00+09:00', receivedAt:new Date().toISOString(), currency:'KRW', fallback:false, quality:'OFFICIAL_DAILY_CLOSE', contract:selected.issue };
}

function handleGetKrxK200NightClose(tradingDate) {
  try {
    var observation = fetchKrxK200NightClose(tradingDate, new Date());
    return jsonOk({ observation: observation, error: observation ? '' : 'KRX_K200_NIGHT_NOT_READY' });
  } catch(error) {
    return jsonOk({ observation:null, error:error.message || 'KRX_K200_NIGHT_ERROR' });
  }
}

function _indicatorRows_(payload) {
  var result = payload && payload.result;
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.prices)) return result.prices;
  if (Array.isArray(payload && payload.prices)) return payload.prices;
  return [];
}

function fetchMarketIndicatorPricesToss(symbols) {
  var requested = (symbols || []).map(function(symbol) { return String(symbol || '').trim().toUpperCase(); })
    .filter(function(symbol, index, all) { return TOSS_MARKET_INDICATOR_SYMBOLS[symbol] && all.indexOf(symbol) === index; });
  if (!requested.length) return {};
  var payload = _tossRequest_('/api/v1/market-indicators/prices', { symbols: requested.join(',') }, 'MARKET_INDICATOR');
  var output = {};
  _indicatorRows_(payload).forEach(function(row) {
    var symbol = String(row && row.symbol || '').trim().toUpperCase();
    var value = Number(row && (row.lastPrice != null ? row.lastPrice : row.closePrice));
    if (TOSS_MARKET_INDICATOR_SYMBOLS[symbol] && isFinite(value) && value > 0) output[symbol] = { value: value, timestamp: row.timestamp || '', source: 'TOSS', status: 'CONFIRMED' };
  });
  return output;
}

function _indicatorCandleRows_(payload) {
  var result = payload && payload.result;
  if (result && Array.isArray(result.candles)) return result.candles;
  if (Array.isArray(result)) return result;
  if (Array.isArray(payload && payload.candles)) return payload.candles;
  return [];
}

function fetchMarketIndicatorCandlesToss(symbol, fromDate, toDate, forceRefresh) {
  var normalized = String(symbol || '').trim().toUpperCase();
  if (!TOSS_MARKET_INDICATOR_SYMBOLS[normalized]) return [];
  var cache = CacheService.getScriptCache();
  var cacheKey = 'toss_indicator_' + normalized + '_' + fromDate.replace(/-/g, '') + '_' + toDate.replace(/-/g, '');
  var cached = forceRefresh ? null : cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch(ignore) {} }
  var pointsByDate = {};
  var before = '';
  for (var page = 0; page < 100; page++) {
    var query = { interval: '1d', count: 200 };
    if (before) query.before = before;
    var payload = _tossRequest_('/api/v1/market-indicators/' + encodeURIComponent(normalized) + '/candles', query, 'MARKET_INDICATOR_CHART');
    var rows = _indicatorCandleRows_(payload);
    rows.forEach(function(row) {
      var date = _normalizeDate(row && (row.timestamp || row.marketDate || row.date));
      var value = Number(row && (row.closePrice != null ? row.closePrice : row.lastPrice));
      var observedAt = _marketBriefingIsoTimestamp_(row && row.timestamp);
      if (date >= fromDate && date <= toDate && isFinite(value) && value > 0) pointsByDate[date] = { value: value, observedAt: observedAt || null };
    });
    var nextBefore = payload && payload.nextBefore || (payload && payload.result && payload.result.nextBefore) || '';
    if (!rows.length || !nextBefore || nextBefore === before) break;
    var oldest = rows.map(function(row) { return _normalizeDate(row && (row.timestamp || row.marketDate || row.date)); }).filter(Boolean).sort()[0];
    if (oldest && oldest < fromDate) break;
    before = nextBefore;
  }
  var points = Object.keys(pointsByDate).sort().map(function(date) { return { date: date, value: pointsByDate[date].value, observedAt: pointsByDate[date].observedAt }; });
  if (points.length) { try { cache.put(cacheKey, JSON.stringify(points), 21600); } catch(ignoreCache) {} }
  return points;
}

// Yahoo Finance chart is an unofficial endpoint and may change without notice; it is only for US index series.
function _parseYahooChart_(payload, timezone) {
  var chart = payload && payload.chart;
  var result = chart && Array.isArray(chart.result) ? chart.result[0] : null;
  if (!result) return null;
  var quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
  var timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  var closes = quote && Array.isArray(quote.close) ? quote.close : [];
  var points = [];
  timestamps.forEach(function(timestamp, index) {
    var value = Number(closes[index]);
    if (!isFinite(value) || value <= 0) return;
    points.push({ date: Utilities.formatDate(new Date(Number(timestamp) * 1000), timezone || CONFIG.TIMEZONE, 'yyyy-MM-dd'), value: value });
  });
  var meta = result.meta || {};
  var current = Number(meta.regularMarketPrice);
  var previousClose = Number(meta.previousClose != null ? meta.previousClose : meta.chartPreviousClose);
  return { symbol: meta.symbol || '', points: points,
    current: isFinite(current) && current > 0 ? current : (points.length ? points[points.length - 1].value : null),
    previousClose: isFinite(previousClose) && previousClose > 0 ? previousClose : null,
    timestamp: meta.regularMarketTime || (timestamps.length ? timestamps[timestamps.length - 1] : '') };
}

function _yahooRequest_(symbol, params) {
  var query = Object.keys(params || {}).map(function(key) { return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]); }).join('&');
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + (query ? '?' + query : '');
  var lastStatus = 0;
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      var response = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
      lastStatus = response.getResponseCode();
      if (lastStatus === 429 || lastStatus >= 500) {
        var retryAfter = Number(response.getHeaders()['Retry-After'] || 0);
        Utilities.sleep(Math.min(5000, (retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, attempt) * 300) + Math.floor(Math.random() * 200)));
        continue;
      }
      if (lastStatus >= 400) return { status: lastStatus, error: 'HTTP_' + lastStatus };
      return { status: lastStatus, payload: JSON.parse(response.getContentText() || '{}') };
    } catch(error) {
      if (attempt === 2) return { status: 0, error: 'TIMEOUT_OR_NETWORK_ERROR' };
      Utilities.sleep(Math.pow(2, attempt) * 300 + Math.floor(Math.random() * 200));
    }
  }
  return { status: lastStatus || 429, error: 'RATE_LIMITED' };
}

function fetchYahooIndexSeries(benchmark, fromDate, toDate) {
  var symbol = YAHOO_INDEX_SYMBOLS[benchmark];
  if (!symbol) return { points: [], symbol: '', error: 'UNSUPPORTED_INDEX' };
  var response = _yahooRequest_(symbol, { period1: Math.floor(new Date(fromDate + 'T00:00:00Z').getTime() / 1000), period2: Math.floor(new Date(toDate + 'T00:00:00Z').getTime() / 1000) + 86400, interval: '1d', events: 'history', includeAdjustedClose: 'false' });
  if (!response.payload) return { points: [], symbol: symbol, error: response.error || ('HTTP_' + response.status) };
  var parsed = _parseYahooChart_(response.payload, CONFIG.TIMEZONE);
  if (!parsed || !parsed.points.length) return { points: [], symbol: symbol, error: 'EMPTY_OR_INVALID_RESPONSE' };
  return { points: parsed.points, symbol: symbol, current: parsed.current, previousClose: parsed.previousClose, timestamp: parsed.timestamp };
}

function fetchYahooIndexCurrent(benchmark) {
  var symbol = YAHOO_INDEX_SYMBOLS[benchmark];
  if (!symbol) return null;
  var cache = CacheService.getScriptCache();
  var cacheKey = 'yahoo_index_current_' + benchmark;
  var cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch(ignore) {} }
  var response = _yahooRequest_(symbol, { range: '5d', interval: '1d', events: 'history' });
  if (!response.payload) return null;
  var parsed = _parseYahooChart_(response.payload, CONFIG.TIMEZONE);
  if (!parsed || !isFinite(parsed.current) || !isFinite(parsed.previousClose) || parsed.previousClose <= 0) return null;
  var output = { symbol: symbol, price: parsed.current, previousClose: parsed.previousClose, change: parsed.current - parsed.previousClose, changePct: (parsed.current - parsed.previousClose) / parsed.previousClose * 100, timestamp: parsed.timestamp, source: 'YAHOO_FINANCE', status: 'CONFIRMED' };
  try { cache.put(cacheKey, JSON.stringify(output), 60); } catch(ignoreCache) {}
  return output;
}

function handleGetBenchmark(benchmark, fromStr, toStr) {
  try {
    var fromDate = _normalizeDate(fromStr || '') || '2024-01-01';
    var toDate = _normalizeDate(toStr || '') || today();
    if (fromDate > toDate) {
      var t = fromDate; fromDate = toDate; toDate = t;
    }

    var map = _benchmarkSymbolMap();
    var key = (benchmark || '').toString().trim().toUpperCase();
    var symbols = map[key];
    if (!symbols) return jsonError('지원하지 않는 비교지수: ' + benchmark);

    var points = [];
    var usedSymbol = '';
    if (key === 'VKOSPI') {
      points = _readVkospiPointsFromKrx(fromDate, toDate);
      if (points.length > 0) usedSymbol = 'KRX_OPEN_API:VKOSPI';
    } else if (key === 'KOSPI' || key === 'KOSDAQ') {
      points = fetchMarketIndicatorCandlesToss(key, fromDate, toDate);
      if (points.length) usedSymbol = key;
    } else {
      var yahoo = fetchYahooIndexSeries(key, fromDate, toDate);
      points = yahoo.points;
      usedSymbol = yahoo.symbol;
    }
    if (points.length === 0) {
      return jsonError('선택 기간의 ' + key + ' 데이터를 조회하지 못했습니다.');
    }
    var current = null;
    try { current = (key === 'KOSPI' || key === 'KOSDAQ') ? (fetchMarketIndicatorPricesToss([key])[key] || null) : fetchYahooIndexCurrent(key); } catch(ignoreCurrent) { /* 현재값 실패 시 확정 일봉은 보존 */ }
    return jsonOk({ benchmark: key, symbol: usedSymbol, points: points, current: current });
  } catch(err) {
    return jsonError('getBenchmark 실패: ' + err.message);
  }
}

function handleGetBenchmarks(benchmarksInput, fromStr, toStr, forceRefresh) {
  try {
    var map = _benchmarkSymbolMap();
    var requested = String(benchmarksInput || '').split(',').map(function(value) {
      return value.trim().toUpperCase();
    }).filter(function(value, index, all) {
      return value && value !== 'VKOSPI' && map[value] && all.indexOf(value) === index;
    });
    if (!requested.length) return jsonError('조회할 비교지수가 없습니다.');

    var fromDate = _normalizeDate(fromStr || '') || '2024-01-01';
    var toDate = _normalizeDate(toStr || '') || today();
    if (fromDate > toDate) { var swap = fromDate; fromDate = toDate; toDate = swap; }

    var cache = CacheService.getScriptCache();
    var cacheKey = 'benchmarks_' + requested.slice().sort().join('_') + '_' + fromDate.replace(/-/g, '') + '_' + toDate.replace(/-/g, '');
    var cached = forceRefresh ? null : cache.get(cacheKey);
    if (cached) return jsonOk(JSON.parse(cached));

    var series = {};
    var symbols = {};
    var current = {};
    var seriesMeta = {};
    var providerErrors = {};
    requested.forEach(function(type) { series[type] = []; symbols[type] = ''; });
    requested.forEach(function(type) {
      if (type === 'KOSPI' || type === 'KOSDAQ') {
        try { series[type] = fetchMarketIndicatorCandlesToss(type, fromDate, toDate, !!forceRefresh); } catch(error) { series[type] = []; providerErrors[type] = error.message || 'TOSS_INDICATOR_ERROR'; }
        if (series[type].length) {
          seriesMeta[type] = { fresh: !!forceRefresh, confirmedClose: false, confirmation: 'UNVERIFIED_DAILY_CANDLE', source: 'TOSS' };
          try { symbols[type] = type; current[type] = fetchMarketIndicatorPricesToss([type])[type] || null; } catch(error) { providerErrors[type] = error.message || 'TOSS_INDICATOR_PRICE_ERROR'; }
        }
      } else {
        try {
          var yahoo = fetchYahooIndexSeries(type, fromDate, toDate);
          series[type] = yahoo.points;
          symbols[type] = yahoo.symbol;
          current[type] = fetchYahooIndexCurrent(type);
          if (yahoo.error) providerErrors[type] = yahoo.error;
        } catch(error) { series[type] = []; providerErrors[type] = error.message || 'YAHOO_ERROR'; }
      }
    });

    if (forceRefresh && _isKrxOfficialCloseAvailableTime_()) {
      var officialResult = _fetchKrxOfficialIndexClosesSafe_(requested, toDate);
      var official = officialResult.data;
      if (officialResult.error) providerErrors.KRX_OFFICIAL = officialResult.error;
      ['KOSPI','KOSDAQ'].forEach(function(type) {
        if (!official[type]) return;
        series[type] = (series[type] || []).filter(function(point) { return point.date !== toDate; }).concat([official[type]]).sort(function(a,b) { return a.date.localeCompare(b.date); });
        symbols[type] = type;
        seriesMeta[type] = { fresh: true, confirmedClose: true, confirmation: 'KRX_EXACT_DATE_CLOSE', source: 'KRX_OFFICIAL' };
      });
    }

    var errors = {};
    requested.forEach(function(type) {
      if (!series[type].length) errors[type] = providerErrors[type] || '선택 기간의 데이터를 찾지 못했습니다.';
    });
    if (providerErrors.KRX_OFFICIAL) errors.KRX_OFFICIAL = providerErrors.KRX_OFFICIAL;
    var result = { benchmarks: requested, series: series, symbols: symbols, current: current, seriesMeta: seriesMeta, errors: errors };
    try { cache.put(cacheKey, JSON.stringify(result), 21600); } catch(cacheError) { /* 캐시 용량 초과는 무시 */ }
    return jsonOk(result);
  } catch(err) {
    return jsonError('getBenchmarks 실패: ' + err.message);
  }
}

function _readVkospiPointsFromKrx(fromDate, toDate) {
  var authKey = _getKrxAuthKey();
  if (!authKey) throw new Error('VKOSPI 조회에는 KRX AUTH_KEY가 필요합니다. 설정에서 KRX 인증키를 등록하세요.');

  var cache = CacheService.getScriptCache();
  var cacheKey = 'vkospi_' + fromDate.replace(/-/g, '') + '_' + toDate.replace(/-/g, '');
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch(e) { /* 손상된 캐시는 다시 조회 */ }
  }

  var ymDates = _buildDateRangeYmd(fromDate.replace(/-/g, ''), toDate.replace(/-/g, ''))
    .filter(function(ymd) {
      var day = _ymdToDate(ymd).getDay();
      return day !== 0 && day !== 6;
    });
  var endpoint = 'https://data-dbg.krx.co.kr/svc/apis/idx/kospi_dd_trd';
  var pointsByDate = {};
  var batchSize = 50;
  var authFailed = false;

  for (var start = 0; start < ymDates.length; start += batchSize) {
    var batch = ymDates.slice(start, start + batchSize);
    var requests = batch.map(function(ymd) {
      return {
        url: endpoint + '?basDd=' + encodeURIComponent(ymd),
        method: 'get',
        headers: { AUTH_KEY: authKey },
        muteHttpExceptions: true
      };
    });
    var responses = UrlFetchApp.fetchAll(requests);
    responses.forEach(function(resp, idx) {
      var status = resp.getResponseCode();
      if (status === 401 || status === 403) authFailed = true;
      if (status >= 400) return;
      var json;
      try { json = JSON.parse(resp.getContentText() || '{}'); } catch(e) { return; }
      var rows = Array.isArray(json.OutBlock_1) ? json.OutBlock_1 : [];
      var row = rows.find(function(item) {
        var name = (item.IDX_NM || item.idxNm || '').toString();
        return /VKOSPI|코스피\s*200\s*변동성|변동성지수/i.test(name);
      });
      if (!row) return;
      var date = _normalizeDate(row.BAS_DD || row.basDd || batch[idx]);
      var value = parseFloat((row.CLSPRC_IDX || row.clsprcIdx || '').toString().replace(/,/g, '')) || 0;
      if (date && value > 0) pointsByDate[date] = value;
    });
  }

  if (authFailed) throw new Error('KRX AUTH_KEY가 유효하지 않거나 지수 API 이용 권한이 없습니다.');

  var points = Object.keys(pointsByDate).sort().map(function(date) {
    return { date: date, value: pointsByDate[date] };
  });
  if (points.length > 0) {
    try { cache.put(cacheKey, JSON.stringify(points), 21600); } catch(e) { /* 캐시 용량 초과는 무시 */ }
  }
  return points;
}

// ════════════════════════════════════════════════════════════════════
//  saveManualPrice — 펀드·TDF NAV 수동 입력
// ════════════════════════════════════════════════════════════════════
// 가격이력의 기존 펀드 가격은 총 평가금액입니다. NAV와 좌수는 별도 시트에
// 보관하고 총액으로 변환한 값만 가격이력에 넣어 기존 거래·화면과 호환합니다.
var FUND_PROVIDERS = {
  HANWHA_2045_CRPE: { id: '008942', classCode: 'C-RPe', name: '한화 LIFEPLUS 적격 TDF 2045 C-RPe', source: 'HANWHA' },
  KB_VALUE_ST: { id: 'AQ018', standardCode: 'KR5223AQ0185', classCode: 'AQ018', name: 'KB 밸류포커스 소득공제 S-T', source: 'FUNETF' },
  FIDELITY_BIG4_S: { id: 'AP399', standardCode: 'KR5235AP3996', classCode: 'AP399', fundCode: '69083', name: '피델리티 월드Big4 S', source: null }
};
var FUND_UNITS_SHEET = '펀드좌수';
var FUND_NAV_SHEET = '펀드기준가격';
var SNAPSHOT_INTEGRITY_SOURCE_REVISION_KEY = 'snapshot_integrity_source_revision_v1';
var SNAPSHOT_INTEGRITY_STATE_MAX_CHARS = 7000;

function _getSnapshotIntegritySourceRevision() {
  var state = _getSnapshotIntegrityRevisionState();
  return String(state.revision || 0);
}

function _isSnapshotIntegrityRevision(value) {
  var revision = Number(value);
  return isFinite(revision) && revision >= 0 && Math.floor(revision) === revision && revision <= Number.MAX_SAFE_INTEGER;
}

function _getSnapshotIntegrityRevisionState() {
  var props = PropertiesService.getScriptProperties(), raw = props.getProperty(SNAPSHOT_INTEGRITY_SOURCE_REVISION_KEY);
  try {
    var parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && _isSnapshotIntegrityRevision(parsed.revision) && _isSnapshotIntegrityRevision(parsed.all)
        && parsed.dates && typeof parsed.dates === 'object' && !Array.isArray(parsed.dates) && Array.isArray(parsed.ranges)
        && Object.keys(parsed.dates).every(function(date) { return !!_normalizeDate(date) && _isSnapshotIntegrityRevision(parsed.dates[date]); })
        && parsed.ranges.every(function(item) { return item && !!_normalizeDate(item.from) && _isSnapshotIntegrityRevision(item.revision); })) {
      var valid = { revision: Number(parsed.revision), all: Number(parsed.all), dates: parsed.dates, ranges: parsed.ranges };
      if (String(raw || '').length > SNAPSHOT_INTEGRITY_STATE_MAX_CHARS) {
        try { return _saveSnapshotIntegrityRevisionState(valid); }
        catch (compactError) { try { props.deleteProperty(SNAPSHOT_INTEGRITY_SOURCE_REVISION_KEY); } catch (ignoreCompactDelete) {} }
      } else return valid;
    }
  } catch (ignore) {}
  // scalar(v9.140/9.141), partial/malformed, missing 값은 기존 cache와 절대 매칭되지 않는 전체 revision으로 이관합니다.
  var migrationRevision = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  var migrated = { revision: migrationRevision, all: migrationRevision, dates: {}, ranges: [] };
  try { props.setProperty(SNAPSHOT_INTEGRITY_SOURCE_REVISION_KEY, JSON.stringify(migrated)); }
  catch (migrationError) {
    try { props.deleteProperty(SNAPSHOT_INTEGRITY_SOURCE_REVISION_KEY); } catch (ignoreDelete) {}
  }
  return migrated;
}

function _compactSnapshotIntegrityRevisionState(state) {
  var redundantDates = Object.keys(state.dates).filter(function(date) { return Number(state.dates[date] || 0) <= Number(state.all || 0); });
  redundantDates.forEach(function(date) { delete state.dates[date]; });
  state.ranges = state.ranges.filter(function(item) { return item && _normalizeDate(item.from) && Number(item.revision || 0) > Number(state.all || 0); });
  while (JSON.stringify(state).length > SNAPSHOT_INTEGRITY_STATE_MAX_CHARS) {
    var dateKeys = Object.keys(state.dates);
    var oldestDate = dateKeys.sort(function(a, b) { return Number(state.dates[a]) - Number(state.dates[b]); })[0];
    var oldestRangeIndex = -1;
    state.ranges.forEach(function(item, index) {
      if (oldestRangeIndex === -1 || Number(item.revision) < Number(state.ranges[oldestRangeIndex].revision)) oldestRangeIndex = index;
    });
    var dateRevision = oldestDate ? Number(state.dates[oldestDate] || 0) : Infinity;
    var rangeRevision = oldestRangeIndex >= 0 ? Number(state.ranges[oldestRangeIndex].revision || 0) : Infinity;
    if (!isFinite(dateRevision) && !isFinite(rangeRevision)) break;
    if (dateRevision <= rangeRevision) { state.all = Math.max(Number(state.all || 0), dateRevision); delete state.dates[oldestDate]; }
    else { state.all = Math.max(Number(state.all || 0), rangeRevision); state.ranges.splice(oldestRangeIndex, 1); }
    Object.keys(state.dates).forEach(function(date) { if (Number(state.dates[date] || 0) <= state.all) delete state.dates[date]; });
    state.ranges = state.ranges.filter(function(item) { return Number(item.revision || 0) > state.all; });
  }
  return state;
}

function _saveSnapshotIntegrityRevisionState(state) {
  state = _compactSnapshotIntegrityRevisionState(state);
  if (!_isSnapshotIntegrityRevision(state.revision) || !_isSnapshotIntegrityRevision(state.all)
      || !Object.keys(state.dates || {}).every(function(date) { return _isSnapshotIntegrityRevision(state.dates[date]); })
      || !(state.ranges || []).every(function(item) { return _isSnapshotIntegrityRevision(item.revision); })) {
    throw new Error('Snapshot integrity revision은 안전한 정수여야 합니다.');
  }
  var serialized = JSON.stringify(state), props = PropertiesService.getScriptProperties();
  if (serialized.length > SNAPSHOT_INTEGRITY_STATE_MAX_CHARS) throw new Error('Snapshot integrity revision state 크기 제한 초과');
  try { props.setProperty(SNAPSHOT_INTEGRITY_SOURCE_REVISION_KEY, serialized); }
  catch (error) {
    // 이전 revision을 남기면 stale cache가 재사용될 수 있으므로 삭제해 다음 read가 전체 migration하도록 합니다.
    try { props.deleteProperty(SNAPSHOT_INTEGRITY_SOURCE_REVISION_KEY); } catch (ignore) {}
    throw error;
  }
  return state;
}

function _touchSnapshotIntegritySourceRevision(impact) {
  var lock = LockService.getScriptLock(), ownsLock = false;
  try {
    if (!lock.hasLock()) { lock.waitLock(30000); ownsLock = true; }
    var state = _getSnapshotIntegrityRevisionState();
    var revision = Math.max(Math.floor(Number(state.revision || 0)) + 1, Date.now());
    state.revision = revision;
    impact = impact || { all: true };
    var dates = (impact.dates || (impact.date ? [impact.date] : [])).map(_normalizeDate).filter(Boolean);
    if (impact.all || (!dates.length && !impact.from)) state.all = revision;
    dates.forEach(function(date) { state.dates[date] = revision; });
    var from = _normalizeDate(impact.from || '');
    if (from) state.ranges.push({ from: from, revision: revision });
    _saveSnapshotIntegrityRevisionState(state);
    return String(revision);
  } finally { if (ownsLock) lock.releaseLock(); }
}

function _snapshotIntegrityDateRevisions(dates) {
  var state = _getSnapshotIntegrityRevisionState(), out = {};
  (dates || []).forEach(function(date) {
    var revision = Math.max(Number(state.all || 0), Number(state.dates[date] || 0));
    state.ranges.forEach(function(item) { if (date >= item.from) revision = Math.max(revision, Number(item.revision || 0)); });
    out[date] = String(revision);
  });
  return out;
}

function _isSnapshotIntegritySourceSheet(name) {
  return [CONFIG.SHEET_SNAPSHOT, CONFIG.SHEET_TRADES, CONFIG.SHEET_PH, CONFIG.SHEET_CODES, FUND_NAV_SHEET, FUND_UNITS_SHEET, '환율이력'].indexOf(String(name || '')) !== -1;
}

function _snapshotIntegrityImpactForRows(sheetName, rows) {
  rows = rows || [];
  if (sheetName === CONFIG.SHEET_CODES) return { all: true };
  var dateIndex = sheetName === FUND_UNITS_SHEET ? 3 : 0;
  var dates = rows.map(function(row) { return _normalizeDate(row && row[dateIndex]); }).filter(Boolean).sort();
  if (!dates.length) return { all: true };
  if (sheetName === CONFIG.SHEET_TRADES || sheetName === CONFIG.SHEET_PH || sheetName === '환율이력'
      || sheetName === FUND_NAV_SHEET || sheetName === FUND_UNITS_SHEET) return { from: dates[0] };
  return { dates: dates.filter(function(date, index, all) { return all.indexOf(date) === index; }) };
}

function _snapshotIntegrityImpactForEdit(e) {
  var sheet = e && e.range && e.range.getSheet ? e.range.getSheet() : null;
  if (!sheet || !_isSnapshotIntegritySourceSheet(sheet.getName())) return null;
  var name = sheet.getName();
  if (name === CONFIG.SHEET_CODES) return { all: true };
  var range = e.range, row = range.getRow(), rows = range.getNumRows ? range.getNumRows() : 1;
  var column = range.getColumn ? range.getColumn() : 1, columns = range.getNumColumns ? range.getNumColumns() : 1;
  var dateColumn = name === FUND_UNITS_SHEET ? 4 : 1;
  if (row <= 1) return { all: true };
  var overlapsDateColumn = column <= dateColumn && column + columns - 1 >= dateColumn;
  var dates = [];
  if (overlapsDateColumn) {
    if (rows !== 1 || columns !== 1) return { all: true }; // paste의 old 날짜 전체를 복원할 수 없으므로 안전 fallback
    dates = [_normalizeDate(e.oldValue || ''), _normalizeDate(range.getValue())].filter(Boolean);
  } else {
    dates = sheet.getRange(row, dateColumn, rows, 1).getValues().map(function(value) { return _normalizeDate(value[0]); }).filter(Boolean);
  }
  dates = dates.filter(function(date, index, all) { return all.indexOf(date) === index; }).sort();
  if (!dates.length) return { all: true };
  if (name === CONFIG.SHEET_SNAPSHOT) return { dates: dates };
  return { from: dates[0] };
}

// 사용자가 정합성 원자료 시트를 직접 수정한 경우도 내부 저장 경로와 동일하게 cache를 무효화합니다.
function onEdit(e) {
  var impact = _snapshotIntegrityImpactForEdit(e);
  if (impact) _touchSnapshotIntegritySourceRevision(impact);
}

function handleSnapshotIntegritySheetChange(e) {
  var changeType = String(e && e.changeType || '').toUpperCase();
  if (changeType === 'EDIT' || changeType === 'FORMAT') return;
  if (changeType === 'REMOVE_GRID' || changeType === 'OTHER') {
    _touchSnapshotIntegritySourceRevision({ all: true });
    return;
  }
  if (['INSERT_GRID', 'INSERT_ROW', 'REMOVE_ROW', 'INSERT_COLUMN', 'REMOVE_COLUMN'].indexOf(changeType) === -1) return;
  var ss = e && e.source;
  var sheet = ss && typeof ss.getActiveSheet === 'function' ? ss.getActiveSheet() : null;
  if (!sheet || _isSnapshotIntegritySourceSheet(sheet.getName())) _touchSnapshotIntegritySourceRevision({ all: true });
}

function _ensureSnapshotIntegrityChangeTrigger(autoFix) {
  var ss = getss(), sourceId = typeof ss.getId === 'function' ? ss.getId() : '';
  function matchingTriggers() {
    return ScriptApp.getProjectTriggers().filter(function(trigger) {
      if (trigger.getHandlerFunction() !== 'handleSnapshotIntegritySheetChange') return false;
      return !sourceId || (typeof trigger.getTriggerSourceId === 'function' && trigger.getTriggerSourceId() === sourceId);
    });
  }
  var matches = matchingTriggers();
  if (!autoFix) return matches.length > 0;
  var lock = LockService.getScriptLock(), ownsLock = false;
  try {
    if (!lock.hasLock()) { lock.waitLock(30000); ownsLock = true; }
    matches = matchingTriggers();
    if (!matches.length) {
      ScriptApp.newTrigger('handleSnapshotIntegritySheetChange').forSpreadsheet(ss).onChange().create();
      matches = matchingTriggers();
    }
    matches.slice(1).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
    return matches.length > 0;
  } finally { if (ownsLock) lock.releaseLock(); }
}
var FUND_NAV_IMPORT_SPECS = {
  F00001: { provider: 'HANWHA_2045_CRPE', classCode: 'C-RPe', standardCode: '', className: 'C-RPe', forbidden: ['AQ018','KR5223AQ0185','AP399','KR5235AP3996','2K04','2K09'] },
  F00002: { provider: 'KB_VALUE_ST', classCode: 'AQ018', standardCode: 'KR5223AQ0185', className: 'S-T', forbidden: ['AP399','KR5235AP3996','2K04','2K09','피델리티 월드BIG4'] },
  F00003: { provider: 'FIDELITY_BIG4_S', classCode: 'AP399', standardCode: 'KR5235AP3996', className: 'S', forbidden: ['AQ018','KR5223AQ0185','2K04','2K09','PRS-E','KB 밸류포커스 소득공제'] }
};

function _fundDate(value) {
  var date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.');
  var parsed = new Date(date + 'T00:00:00Z');
  if (!isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('유효하지 않은 날짜');
  return date;
}

function _fundDateOffset(date, days) {
  var parsed = new Date(_fundDate(date) + 'T00:00:00Z');
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function _readFundUnits(ss) {
  var sh = ss.getSheetByName(FUND_UNITS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().map(function(row) {
    var entry = { code: String(row[0]), name: String(row[1]), provider: String(row[2]), startDate: _normalizeDate(row[3]), units: Number(row[4]) };
    if (!entry.code || !Object.prototype.hasOwnProperty.call(FUND_PROVIDERS, entry.provider) || !isFinite(entry.units) || entry.units < 0 || entry.units > Number.MAX_SAFE_INTEGER) throw new Error('펀드좌수 설정 오류');
    _fundDate(entry.startDate);
    return entry;
  });
}

function _fundUnitsAtDate(configs, code, date) {
  var found = null;
  configs.forEach(function(config) {
    if (config.code === code && config.startDate <= date && (!found || config.startDate > found.startDate)) found = config;
  });
  return found;
}

function _fundHasActiveUnitsInRange(configs, code, from, to) {
  for (var date = from; date <= to; date = _fundDateOffset(date, 1)) {
    var config = _fundUnitsAtDate(configs, code, date);
    if (config && config.units > 0) return true;
  }
  return false;
}

// F코드의 가격이력은 NAV 단가가 아니라 전체 평가금액이므로 Snapshot 수량은 1로 표현합니다.
// 단, 펀드좌수 이력에서 해당 날짜가 0좌로 확정되면 거래원장에 과거 보유가 남아 있어도 제외합니다.
function _applyFundUnitLifecycleToSnapshotHoldings(holdings, configs, date) {
  Object.keys(holdings || {}).forEach(function(key) {
    var holding = holdings[key];
    var code = _cleanCode(holding && holding.code) || String(holding && holding.code || '').trim().toUpperCase();
    if (!_isFundCode(code)) return;
    var config = _fundUnitsAtDate(configs || [], code, date);
    if (config && config.units === 0) { delete holdings[key]; return; }
    if (holding) holding.qty = 1;
  });
  return holdings;
}

function _filterSnapshotRowsByFundLifecycle(rows, configs, date) {
  return (rows || []).filter(function(row) {
    var code = _cleanCode(row && row[1]) || String(row && row[1] || '').trim().toUpperCase();
    if (!_isFundCode(code)) return true;
    var config = _fundUnitsAtDate(configs || [], code, date);
    return !(config && config.units === 0);
  });
}

function _isFundCode(code) {
  return /^F\d{5}$/.test(String(code || '').trim().toUpperCase());
}

// 기초정보·거래이력·기존 좌수 설정 중 하나라도 근거가 있는 F코드만 관리 대상에 포함합니다.
// 현재 보유 여부는 거래이력으로 계산해 UI가 과거 전량매도 종목을 별도 표시할 수 있게 합니다.
function _getFundCodeCatalog(ss, configs) {
  var byCode = {};
  function add(code, name, source) {
    code = String(code || '').trim().toUpperCase();
    name = String(name || '').trim();
    if (!_isFundCode(code) || !name) return;
    if (!byCode[code]) byCode[code] = { code: code, name: name, sources: {} };
    if (!byCode[code].name) byCode[code].name = name;
    byCode[code].sources[source] = true;
  }
  var settings = _readSettingsMap(ss);
  var editablePrices = Array.isArray(settings.EDITABLE_PRICES) ? settings.EDITABLE_PRICES : [];
  editablePrices.forEach(function(item) {
    var code = String(item && item.code || '').trim().toUpperCase();
    if (_isFundCode(code)) add(code, item.name, 'settings');
  });
  (configs || []).forEach(function(config) { add(config.code, config.name, 'units'); });
  var tradeSheet = ss.getSheetByName(CONFIG.SHEET_TRADES);
  var trades = tradeSheet && tradeSheet.getLastRow() > 1
    ? tradeSheet.getRange(2, 1, tradeSheet.getLastRow() - 1, Math.min(11, tradeSheet.getLastColumn())).getValues() : [];
  trades.forEach(function(row) { add(row[4], row[3], 'trades'); });
  var nameToCode = {};
  Object.keys(byCode).forEach(function(code) { nameToCode[byCode[code].name] = code; });
  var holdings = calcHoldingsAtDate(trades, today(), nameToCode);
  _applyFundUnitLifecycleToSnapshotHoldings(holdings, configs || [], today());
  var holdingCodes = {};
  Object.keys(holdings).forEach(function(name) {
    var code = String(holdings[name].code || '').trim().toUpperCase();
    if (_isFundCode(code)) holdingCodes[code] = true;
  });
  return Object.keys(byCode).map(function(code) {
    var current = _fundUnitsAtDate(configs || [], code, today());
    return {
      code: code,
      name: byCode[code].name,
      currentHolding: !!holdingCodes[code],
      currentConfigStartDate: current ? current.startDate : '',
      sources: Object.keys(byCode[code].sources).sort()
    };
  }).sort(function(a, b) {
    if (a.currentHolding !== b.currentHolding) return a.currentHolding ? -1 : 1;
    return a.name.localeCompare(b.name) || a.code.localeCompare(b.code);
  });
}

function handleGetFundUnits() {
  try {
    var totalStarted = Date.now(), readStarted = Date.now();
    var ss = getss();
    var configs = _readFundUnits(ss);
    var funds = _getFundCodeCatalog(ss, configs), readMs = Date.now() - readStarted, navStarted = Date.now();
    var navResult = _getFundNavStatus(ss, configs), navStatusMs = Date.now() - navStarted;
    return jsonOk({ configs: configs, funds: funds, providers: FUND_PROVIDERS,
      navStatus: navResult, performance: { totalMs: Date.now() - totalStarted, readMs: readMs, navStatusMs: navStatusMs,
        priceHistoryRows: navResult.priceHistoryRows, snapshotRows: 0 },
      capabilities: { fundDailyResults: true, selectiveFundRetry: true, gasVersion: '9.180' } });
  }
  catch (err) { return jsonError(err.message); }
}

function _ensurePortfolioCloseDailyTrigger(autoFix) {
  var triggers = ScriptApp.getProjectTriggers();
  var closeTriggers = triggers.filter(function(t) { return t.getHandlerFunction() === 'runDailyPortfolioClose1900'; });
  var hasClose = closeTriggers.length > 0;
  if (!autoFix) return hasClose;
  if (!hasClose) {
    ScriptApp.newTrigger('runDailyPortfolioClose1900').timeBased().everyDays(1).inTimezone(CONFIG.TIMEZONE).atHour(19).create();
    closeTriggers = ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'runDailyPortfolioClose1900'; });
    hasClose = closeTriggers.length > 0;
  }
  // 통합 트리거는 정확히 1개만 유지하고 v9.172 이전 분리 트리거만 제거합니다.
  closeTriggers.slice(1).forEach(function(t) { ScriptApp.deleteTrigger(t); });
  triggers.forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'runEvalPriceUpdate1620' || fn === 'runDailyFundValuations') ScriptApp.deleteTrigger(t);
  });
  return hasClose;
}

function handleSaveFundUnits(dataJson) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var input = JSON.parse(dataJson);
    var code = String(input.code || '').trim().toUpperCase();
    var provider = String(input.provider || '');
    var startDate = _fundDate(input.startDate);
    var units = Number(input.units);
    if (!/^F\d{5}$/.test(code) || !Object.prototype.hasOwnProperty.call(FUND_PROVIDERS, provider) || input.units === '' || input.units == null || !isFinite(units) || units < 0 || units > Number.MAX_SAFE_INTEGER) throw new Error('펀드 종목코드·정확한 클래스·좌수를 확인하세요.');
    var ss = getss();
    var configs = _readFundUnits(ss);
    var old = configs.find(function(c) { return c.code === code && c.startDate === startDate; });
    if (old && (old.units !== units || old.provider !== provider)) throw new Error('같은 적용일의 좌수가 이미 저장돼 있습니다. 변경일부터 새 좌수를 등록하세요.');
    if (configs.some(function(c) { return c.code === code && c.provider !== provider; })) throw new Error('동일 코드의 펀드 클래스를 바꿀 수 없습니다.');
    // 이미 계산된 과거 구간을 새 설정이 소급 변경하지 않도록 차단합니다.
    var navSh = ss.getSheetByName(FUND_NAV_SHEET);
    if (!old && navSh && navSh.getLastRow() > 1) {
      var next = configs.filter(function(c) { return c.code === code && c.startDate > startDate; }).map(function(c) { return c.startDate; }).sort()[0];
      var conflict = navSh.getRange(2, 1, navSh.getLastRow() - 1, 9).getValues().some(function(r) {
        var d = _normalizeDate(r[0]);
        return String(r[1]) === code && d >= startDate && (!next || d < next) && Number(r[5]) !== units;
      });
      if (conflict) throw new Error('이미 평가금액이 작성된 날짜와 좌수 설정이 충돌합니다. 미작성 적용일부터 등록하세요.');
    }
    if (!old) {
      var item = _getFundCodeCatalog(ss, configs).find(function(fund) { return fund.code === code; });
      if (!item) throw new Error('기초정보·거래이력·기존 좌수 설정에 있는 F코드만 등록할 수 있습니다.');
      var sh = ss.getSheetByName(FUND_UNITS_SHEET);
      if (!sh) { sh = ss.insertSheet(FUND_UNITS_SHEET); sh.appendRow(['종목코드','종목명','클래스','적용시작일','좌수','등록일시']); }
      _setCodeColumnText(sh, 1);
      sh.appendRow([code, String(item.name), provider, startDate, units, new Date().toISOString()]);
      _touchSnapshotIntegritySourceRevision({ from: startDate });
    }
    _ensurePortfolioCloseDailyTrigger(true);
    var savedConfigs = _readFundUnits(ss);
    return jsonOk({ configs: savedConfigs, funds: _getFundCodeCatalog(ss, savedConfigs), automaticHour: 19 });
  } catch (err) { return jsonError('좌수 저장 실패: ' + err.message); }
  finally { lock.releaseLock(); }
}

function _fundNavFetchOptions(provider, spec) {
  var headers = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'ko-KR,ko;q=0.9'
  };
  if (spec && spec.source === 'FUNETF') {
    headers['Referer'] = 'https://www.funetf.co.kr/product/fund/view/' + encodeURIComponent(spec.standardCode || '');
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
  }
  return { method: 'get', muteHttpExceptions: true, followRedirects: true, headers: headers };
}

function _fundNavHttpError(provider, status) {
  var spec = FUND_PROVIDERS[provider] || {};
  var providerName = spec.source === 'HANWHA' ? '한화자산운용' : (spec.source === 'FUNETF' ? 'FunETF' : '확인된 공식 제공처');
  if (status === 401 || status === 403) {
    return new Error('펀드 기간 기준가격 조회가 ' + providerName + ' 서버에서 거부되었습니다 (HTTP ' + status + '). 기존 확정 NAV는 보존하며 수동 import로 대체할 수 있습니다.');
  }
  return new Error('펀드 기간 기준가격 조회 실패: ' + providerName + ' HTTP ' + status + '. 기존 데이터는 변경하지 않았습니다.');
}

function _parseHanwhaNavDate(value) {
  var raw = String(value == null ? '' : value).trim();
  var match = raw.match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})$/);
  if (!match) throw new Error('한화 NAV 공시일 형식 오류: "' + raw + '"');
  return _fundDate(match[1] + '-' + match[2] + '-' + match[3]);
}

function _fetchFundNav(provider, from, to) {
  var spec = FUND_PROVIDERS[provider];
  if (!Object.prototype.hasOwnProperty.call(FUND_PROVIDERS, provider)) throw new Error('지원하지 않는 펀드 클래스');
  var start = _fundDate(from);
  var end = _fundDate(to);
  var url = '';
  if (spec.source === 'HANWHA') {
    url = 'https://www.hanwhafund.co.kr/api/fund/dailyPrice?fundCd=' + encodeURIComponent(spec.id)
      + '&period=&startDate=' + encodeURIComponent(start) + '&endDate=' + encodeURIComponent(end);
  } else if (spec.source === 'FUNETF') {
    if (!/^KR[0-9A-Z]{10}$/.test(String(spec.standardCode || ''))) throw new Error(spec.name + ': 표준코드 설정 오류');
    url = 'https://www.funetf.co.kr/api/public/product/view/fundnav?fundCd=' + encodeURIComponent(spec.standardCode)
      + '&gijunYmd=' + end.replace(/-/g, '') + '&schNavMode=&schNavStDt=' + start.replace(/-/g, '')
      + '&schNavEdDt=' + end.replace(/-/g, '');
  } else {
    throw new Error(spec.name + ' (' + spec.classCode + '): 정확한 클래스의 자동 일별 기준가격 제공처 미확인');
  }
  var response = UrlFetchApp.fetch(url, _fundNavFetchOptions(provider, spec));
  if (response.getResponseCode() !== 200) throw _fundNavHttpError(provider, response.getResponseCode());
  var payload;
  try { payload = JSON.parse(response.getContentText()); }
  catch (err) { throw new Error('펀드 기간 기준가격 응답 형식이 JSON이 아닙니다: ' + (spec.source === 'HANWHA' ? '한화자산운용' : 'FunETF')); }
  var data = spec.source === 'HANWHA' ? payload.list : payload;
  if (!Array.isArray(data) || !data.length) throw new Error('기준가격 조회 결과 없음');
  if (spec.source === 'HANWHA' && (!Object.prototype.hasOwnProperty.call(data[0], 'wkdate') || !Object.prototype.hasOwnProperty.call(data[0], 'price'))) {
    throw new Error('한화 NAV 응답 필드 불일치: ' + Object.keys(data[0]).sort().join(','));
  }
  if (spec.source === 'FUNETF' && (!Object.prototype.hasOwnProperty.call(data[0], 'gijunYmd') || !Object.prototype.hasOwnProperty.call(data[0], 'gijunGa'))) {
    throw new Error('FunETF NAV 응답 필드 불일치: ' + Object.keys(data[0]).sort().join(','));
  }
  var seen = {};
  data.forEach(function(row) {
    var date, nav;
    if (spec.source === 'HANWHA') {
      date = _parseHanwhaNavDate(row.wkdate);
      nav = Number(String(row.price).replace(/,/g, ''));
    } else {
      var rawDate = String(row.gijunYmd == null ? '' : row.gijunYmd).replace(/[^0-9]/g, '');
      if (!/^\d{8}$/.test(rawDate)) throw new Error('FunETF NAV 공시일 형식 오류: "' + String(row.gijunYmd) + '"');
      date = _fundDate(rawDate.slice(0,4) + '-' + rawDate.slice(4,6) + '-' + rawDate.slice(6,8));
      nav = Number(String(row.gijunGa).replace(/,/g, ''));
    }
    if (!isFinite(nav) || nav <= 0) throw new Error('유효하지 않은 기준가격');
    if (seen[date] && seen[date] !== nav) throw new Error('같은 날짜의 기준가격 충돌');
    if (date >= start && date <= end) seen[date] = nav;
  });
  var dates = Object.keys(seen).sort();
  if (!dates.length) throw new Error('요청한 기간의 기준가격 조회 결과 없음');
  return dates.map(function(date) { return { date: date, nav: seen[date] }; });
}

var FUND_NAV_FETCH_BATCH_DAYS = 14;
var FUND_NAV_FETCH_RETRIES = 1;

function _fetchMissingFundNavBatches(provider, missingDates, activeTo, diagnostic, fundCode) {
  var pending = missingDates.slice().sort(), rows = [], batches = [], errors = [];
  while (pending.length) {
    var from = pending[0];
    // 한화 API는 startDate 당일이 아니라 다음 공시일부터 반환하므로 하루 앞을 포함합니다.
    // FunETF exact standard-code 조회는 누락일 자체부터 요청합니다.
    var queryFrom = FUND_PROVIDERS[provider] && FUND_PROVIDERS[provider].source === 'HANWHA'
      ? _fundDateOffset(from, -1) : from;
    var to = _fundDateOffset(from, FUND_NAV_FETCH_BATCH_DAYS - 1);
    if (to > activeTo) to = activeTo;
    var providerSource = FUND_PROVIDERS[provider] && FUND_PROVIDERS[provider].source;
    if (providerSource === 'FUNETF') {
      // FunETF는 기간조회이므로 누락일 사이의 주말·공휴일·기존 저장일을 하나의 범위로 묶습니다.
      // 1일 단위 요청·재시도 폭증을 줄이되 반환된 실제 공시일만 후속 검증에서 채택합니다.
      var consumed = 0;
      while (consumed < pending.length && pending[consumed] <= to) consumed++;
      pending = pending.slice(consumed);
    } else {
      // 한화는 startDate 경계/공시 예정일 계약이 달라 기존 연속 누락일 범위를 그대로 유지합니다.
      var previous = from, count = 1;
      while (count < pending.length && count < FUND_NAV_FETCH_BATCH_DAYS && pending[count] === _fundDateOffset(previous, 1)) {
        previous = pending[count++];
      }
      to = previous;
      pending = pending.slice(count);
    }
    var fetched = null, lastError = null;
    for (var attempt = 0; attempt <= FUND_NAV_FETCH_RETRIES; attempt++) {
      try {
        _fundRecoveryDiagnosticStart(diagnostic, fundCode, 'externalNavFetch', '_fetchFundNav');
        fetched = _fetchFundNav(provider, queryFrom, to);
        _fundRecoveryDiagnosticFinish(diagnostic, 'end', null, { from: from, to: to, queryFrom: queryFrom, attempt: attempt + 1 });
        lastError = null; break;
      }
      catch (err) { _fundRecoveryDiagnosticFinish(diagnostic, 'error', err, { from: from, to: to, queryFrom: queryFrom, attempt: attempt + 1 }); lastError = err; }
    }
    if (lastError) errors.push({ from: from, to: to, message: lastError.message });
    else {
      var accepted = fetched.filter(function(row) { return row.date >= from && row.date <= to; });
      if (!accepted.length) errors.push({ from: from, to: to, message: '요청한 기간의 기준가격 조회 결과 없음' });
      else {
        rows = rows.concat(accepted);
        batches.push({ from: from, to: to, returned: accepted.length });
      }
    }
  }
  return { rows: rows, batches: batches, errors: errors };
}

function _fundNavExpectedPublicationDate(date, code) {
  var day = new Date(_fundDate(date) + 'T00:00:00Z').getUTCDay();
  if (code === 'F00001') return day !== 0 && day !== 1 && day !== 4 && day !== 6;
  return day !== 0 && day !== 6;
}

function _fundDailyValues(configs, code, navRows, from, to) {
  var result = [];
  var latest = null;
  var index = 0;
  for (var date = from; date <= to; date = _fundDateOffset(date, 1)) {
    while (index < navRows.length && navRows[index].date <= date) latest = navRows[index++];
    var config = _fundUnitsAtDate(configs, code, date);
    if (!config || config.units === 0) continue;
    if (!latest) continue;
    var evalAmt = Math.round(latest.nav * config.units / 1000);
    if (!Number.isSafeInteger(evalAmt) || evalAmt < 0) throw new Error('평가금액 계산 범위 초과');
    result.push({ date: date, code: code, name: config.name, nav: latest.nav, sourceDate: latest.date, units: config.units, evalAmt: evalAmt, provider: config.provider });
  }
  return result;
}

function _storedFundNavRows(storedNav, code, provider, from, to) {
  var seen = {};
  storedNav.forEach(function(row) {
    var date = _normalizeDate(row[0]);
    var sourceDate = _normalizeDate(row[4]);
    var nav = Number(row[3]);
    if (String(row[1]) !== code || String(row[8]) !== provider || !date || !sourceDate || sourceDate > to) return;
    if (!sourceDate || sourceDate > date || !(nav > 0)) throw new Error('저장된 펀드 기준가격 검증 실패: ' + date);
    if (seen[sourceDate] && seen[sourceDate] !== nav) throw new Error('저장된 펀드 기준가격 충돌: ' + sourceDate);
    seen[sourceDate] = nav;
  });
  return Object.keys(seen).sort().map(function(date) { return { date: date, nav: seen[date] }; });
}

function _fundPriceSourceRank(source) {
  source = String(source || '').toUpperCase();
  return source === 'MANUAL' ? 3 : (source === 'FUND_NAV' ? 2 : (source === 'FUND_NAV_CARRY_INPUT_REQUIRED' ? 0 : 1));
}

function _preferFundRepresentativeValues(currentSource, candidateSource, currentQty, candidateQty, currentValue, candidateValue) {
  var currentRank = _fundPriceSourceRank(currentSource), candidateRank = _fundPriceSourceRank(candidateSource);
  if (candidateRank !== currentRank) return candidateRank > currentRank;
  currentQty = Number(currentQty || 0); candidateQty = Number(candidateQty || 0);
  return candidateQty > currentQty || (candidateQty === currentQty && Number(candidateValue || 0) >= Number(currentValue || 0));
}

function _preferFundRepresentativeRow(current, candidate, sourceIndex, valueIndex, qtyIndex) {
  if (!current) return true;
  return _preferFundRepresentativeValues(current[sourceIndex], candidate[sourceIndex],
    qtyIndex == null ? 0 : current[qtyIndex], qtyIndex == null ? 0 : candidate[qtyIndex], current[valueIndex], candidate[valueIndex]);
}

function _fundConfiguredCodeForPriceRow(row, configs) {
  var configuredCodes = {}, nameCandidates = {};
  (configs || []).forEach(function(config) {
    configuredCodes[config.code] = true;
    var name = String(config.name || '').trim();
    if (name) (nameCandidates[name] || (nameCandidates[name] = {}))[config.code] = true;
  });
  var code = _cleanCode(row && row[1]);
  if (/^F\d{5}$/.test(code) && configuredCodes[code]) return code;
  var candidates = Object.keys(nameCandidates[String(row && row[2] || '').trim()] || {});
  return candidates.length === 1 ? candidates[0] : '';
}

function _fundDerivedState(ss, configs) {
  var ph = ss.getSheetByName(CONFIG.SHEET_PH);
  var prices = ph && ph.getLastRow() > 1 ? ph.getRange(2, 1, ph.getLastRow() - 1, 6).getValues() : [];
  var priceKeys = {};
  prices.forEach(function(row) {
    var code = _fundConfiguredCodeForPriceRow(row, configs);
    if (!code) return;
    var key = _normalizeDate(row[0]) + '|' + code;
    if (_preferFundRepresentativeRow(priceKeys[key], row, 5, 3, null)) priceKeys[key] = row;
  });
  var snapshotSheet = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
  var snapshots = snapshotSheet && snapshotSheet.getLastRow() > 1
    ? snapshotSheet.getRange(2, 1, snapshotSheet.getLastRow() - 1, Math.max(12, snapshotSheet.getLastColumn())).getValues() : [];
  var snapshotKeys = {};
  snapshots.forEach(function(row) {
    var key = _normalizeDate(row[0]) + '|' + (_cleanCode(row[1]) || String(row[2] || '').trim());
    if (_preferFundRepresentativeRow(snapshotKeys[key], row, 10, 7, 3)) snapshotKeys[key] = row;
  });
  return { sheet: ph, prices: prices, priceKeys: priceKeys, snapshots: snapshots, snapshotKeys: snapshotKeys };
}

function _fundValueNeedsProcessing(value, storedRow, priceRow, snapshotRow) {
  var confirmed = value.date === value.sourceDate;
  var navComplete = !confirmed || (storedRow
    && _normalizeDate(storedRow[4]) === value.sourceDate
    && Number(storedRow[3]) === value.nav
    && Number(storedRow[5]) === value.units
    && Number(storedRow[6]) === value.evalAmt);
  var expectedSource = value.inputRequired ? 'FUND_NAV_CARRY_INPUT_REQUIRED' : (value.carried ? 'FUND_NAV_CARRY' : 'FUND_NAV');
  var priceSource = String(priceRow && priceRow[5] || '').toUpperCase();
  var priceComplete = !!priceRow && (priceSource === 'MANUAL'
    || (Number(priceRow[3]) === value.evalAmt && priceSource === expectedSource));
  var expectedSnapshotValue = priceComplete ? Number(priceRow[3]) : value.evalAmt;
  var snapshotSource = String(snapshotRow && snapshotRow[10] || '').toUpperCase();
  var snapshotComplete = !!snapshotRow && (snapshotSource === 'MANUAL'
    || (Number(snapshotRow[7]) === expectedSnapshotValue && snapshotSource === (priceSource || expectedSource)));
  return !(navComplete && priceComplete && snapshotComplete);
}

// 외부 NAV 조회나 쓰기 없이 현재 저장 자료만으로 날짜별 완료 상태를 판정합니다.
function _getFundValuationStatus(ss, from, to, code) {
  _fundDate(from); _fundDate(to);
  code = String(code || '').trim().toUpperCase();
  if (from > to || to > today() || to > _fundDateOffset(from, 31)) throw new Error('한 번에 과거 32일 이내를 조회하세요.');
  if (['F00001','F00002','F00003'].indexOf(code) === -1) throw new Error('지원하지 않는 펀드 코드');
  var configs = _readFundUnits(ss);
  var config = configs.find(function(item) { return item.code === code; });
  if (!config) throw new Error('저장된 펀드 좌수 설정 없음: ' + code);
  var navSheet = ss.getSheetByName(FUND_NAV_SHEET);
  var stored = navSheet && navSheet.getLastRow() > 1 ? navSheet.getRange(2, 1, navSheet.getLastRow() - 1, 9).getValues() : [];
  var storedKeys = {};
  stored.forEach(function(row) {
    if (String(row[1]) === code && String(row[8]) === config.provider) storedKeys[_normalizeDate(row[0]) + '|' + code] = row;
  });
  var navRows = _storedFundNavRows(stored, code, config.provider, from, to);
  var confirmed = {};
  navRows.forEach(function(row) { confirmed[row.date] = true; });
  var valueByDate = {};
  _fundDailyValues(configs, code, navRows, from, to).forEach(function(value) {
    value.carried = value.date !== value.sourceDate;
    value.inputRequired = value.carried && _fundNavExpectedPublicationDate(value.date, code) && !confirmed[value.date];
    valueByDate[value.date] = value;
  });
  var derived = _fundDerivedState(ss, configs);
  var dates = [];
  for (var date = from; date <= to; date = _fundDateOffset(date, 1)) {
    var datedConfig = _fundUnitsAtDate(configs, code, date);
    if (!datedConfig || datedConfig.units <= 0) continue;
    var expected = _fundNavExpectedPublicationDate(date, code);
    var value = valueByDate[date];
    var price = derived.priceKeys[date + '|' + code];
    var snapshot = derived.snapshotKeys[date + '|' + code];
    var valuationRequired = !!value;
    var navState = confirmed[date] ? 'EXISTING_CONFIRMED' : (!expected ? 'NON_PUBLICATION_CARRY' : (date === today() ? 'UNPUBLISHED' : 'NAV_MISSING'));
    var expectedSource = value && (value.inputRequired ? 'FUND_NAV_CARRY_INPUT_REQUIRED' : (value.carried ? 'FUND_NAV_CARRY' : 'FUND_NAV'));
    var priceSource = String(price && price[5] || '').toUpperCase();
    var evaluationValid = !!value && !!price && (priceSource === 'MANUAL' || (Number(price[3]) === value.evalAmt && priceSource === expectedSource));
    var snapshotSource = String(snapshot && snapshot[10] || '').toUpperCase();
    var snapshotValid = !!value && evaluationValid && !!snapshot && (snapshotSource === 'MANUAL' || (Number(snapshot[7]) === Number(price[3]) && snapshotSource === priceSource));
    dates.push({ code: code, date: date, publicationExpected: expected, navState: navState, unitsApplied: !!value, valuationRequired: valuationRequired,
      evaluationState: !valuationRequired ? 'NOT_REQUIRED' : (evaluationValid ? 'EXISTING_VALID' : (value ? 'WRITE_REQUIRED' : 'NOT_CREATED')),
      snapshotState: !valuationRequired ? 'NOT_REQUIRED' : (snapshotValid ? 'EXISTING_VALID' : (value ? 'WRITE_REQUIRED' : 'NOT_CREATED')), reconciled: true });
  }
  return { code: code, dates: dates };
}

function handleGetFundValuationStatus(from, to, code) {
  try {
    var status = _getFundValuationStatus(getss(), from, to, code);
    var fundResults = {}; fundResults[status.code] = status;
    return jsonOk({ fundResults: fundResults });
  } catch (err) { return jsonError('펀드 평가 저장상태 확인 실패: ' + err.message); }
}

function _getFundNavStatus(ss, configs) {
  var navSheet = ss.getSheetByName(FUND_NAV_SHEET);
  var stored = navSheet && navSheet.getLastRow() > 1 ? navSheet.getRange(2, 1, navSheet.getLastRow() - 1, 9).getValues() : [];
  var ph = ss.getSheetByName(CONFIG.SHEET_PH);
  var prices = ph && ph.getLastRow() > 1 ? ph.getRange(2, 1, ph.getLastRow() - 1, 6).getValues() : [];
  var representativePrices = {};
  prices.forEach(function(row) {
    var code = _fundConfiguredCodeForPriceRow(row, configs);
    if (!code) return;
    var key = _normalizeDate(row[0]) + '|' + code;
    if (_preferFundRepresentativeRow(representativePrices[key], row, 5, 3, null)) representativePrices[key] = row;
  });
  var codes = configs.map(function(config) { return config.code; }).filter(function(code, index, all) { return all.indexOf(code) === index; });
  var statuses = codes.map(function(code) {
    var config = configs.find(function(item) { return item.code === code; });
    var starts = configs.filter(function(item) { return item.code === code; }).map(function(item) { return item.startDate; }).sort();
    var from = starts[0] || '', to = today();
    var navRows = _storedFundNavRows(stored, code, config.provider, from, to);
    var confirmed = {}; navRows.forEach(function(row) { confirmed[row.date] = row.nav; });
    var missing = [], temporary = [], completedCount = 0, nonPublicationExcluded = 0, zeroUnitsExcluded = 0, noUnits = 0;
    for (var date = from; date && date <= to; date = _fundDateOffset(date, 1)) {
      var datedConfig = _fundUnitsAtDate(configs, code, date);
      if (!datedConfig) { noUnits++; continue; }
      if (datedConfig.units === 0) { zeroUnitsExcluded++; continue; }
      if (confirmed[date]) { completedCount++; continue; }
      if (!_fundNavExpectedPublicationDate(date, code)) { nonPublicationExcluded++; continue; }
      if (date < today()) missing.push(date);
      var representative = representativePrices[date + '|' + code];
      if (representative && String(representative[5] || '').toUpperCase() === 'FUND_NAV_CARRY_INPUT_REQUIRED') temporary.push(date);
    }
    var latest = navRows.length ? navRows[navRows.length - 1] : null;
    return { code: code, provider: config.provider, from: from, to: to,
      latestNav: latest ? latest.nav : null, latestNavDate: latest ? latest.date : '',
      inputRequiredCount: missing.length, inputRequiredDates: missing,
      temporaryDates: temporary, completedCount: completedCount,
      nonPublicationExcluded: nonPublicationExcluded, zeroUnitsExcluded: zeroUnitsExcluded, noUnits: noUnits };
  });
  statuses.priceHistoryRows = prices.length;
  return statuses;
}

function _createFundRecoveryDiagnostic(enabled, from, to, code) {
  return enabled ? { fundCode: code || '', from: from, to: to, startedAt: Date.now(), current: null, events: [] } : null;
}

function _fundRecoveryDiagnosticStart(diagnostic, fundCode, stage, functionName) {
  if (!diagnostic) return 0;
  var startedAt = Date.now();
  diagnostic.current = { fundCode: fundCode || diagnostic.fundCode || '', stage: stage, functionName: functionName, startedAt: startedAt };
  _fundRecoveryDiagnosticFinish(diagnostic, 'start', null, null, true);
  return startedAt;
}

function _fundRecoveryDiagnosticFinish(diagnostic, status, error, detail, keepCurrent) {
  if (!diagnostic || !diagnostic.current) return;
  var current = diagnostic.current;
  var event = { fundCode: current.fundCode, range: diagnostic.from + '~' + diagnostic.to, stage: current.stage, functionName: current.functionName,
    status: status, elapsedMs: Date.now() - diagnostic.startedAt, stageElapsedMs: Date.now() - current.startedAt };
  if (error) { event.error = String(error.message || error); if (error.stack) event.stack = String(error.stack); }
  if (detail) event.detail = detail;
  diagnostic.events.push(event);
  Logger.log('[FUND_NAV_DIAGNOSTIC] ' + JSON.stringify(event));
  if (!keepCurrent) diagnostic.current = null;
}

function _refreshFundValuations(ss, from, to, onlyCode, skipExternal, diagnostic) {
  _fundDate(from); _fundDate(to);
  if (from > to || to > today() || to > _fundDateOffset(from, 31)) throw new Error('한 번에 과거 32일 이내를 조회하세요.');
  _fundRecoveryDiagnosticStart(diagnostic, onlyCode, 'fundUnitsRead', '_readFundUnits');
  var configs = _readFundUnits(ss);
  _fundRecoveryDiagnosticFinish(diagnostic, 'end');
  var codes = configs.map(function(c) { return c.code; }).filter(function(c, i, all) {
    return all.indexOf(c) === i && (!onlyCode || c === onlyCode);
  });
  _fundRecoveryDiagnosticStart(diagnostic, onlyCode, 'storedNavRead', '_refreshFundValuations');
  var navSheet = ss.getSheetByName(FUND_NAV_SHEET);
  var storedNav = navSheet && navSheet.getLastRow() > 1 ? navSheet.getRange(2, 1, navSheet.getLastRow() - 1, 9).getValues() : [];
  _fundRecoveryDiagnosticFinish(diagnostic, 'end');
  var storedKeys = {};
  var providerByCode = {};
  configs.forEach(function(config) { providerByCode[config.code] = config.provider; });
  storedNav.forEach(function(row) {
    if (String(row[8]) === providerByCode[String(row[1])]) storedKeys[_normalizeDate(row[0]) + '|' + row[1]] = row;
  });
  _fundRecoveryDiagnosticStart(diagnostic, onlyCode, 'priceHistoryRead', '_fundDerivedState');
  var derived = _fundDerivedState(ss, configs);
  var ph = derived.sheet;
  var prices = derived.prices;
  var priceKeys = derived.priceKeys;
  var snapshotKeys = derived.snapshotKeys;
  _fundRecoveryDiagnosticFinish(diagnostic, 'end');
  var values = [], fundResults = {};
  codes.forEach(function(code) {
    var fundResult = fundResults[code] = { code: code, status: 'ok', storedNav: 0, apiRequested: 0, apiSuccess: 0, apiFailed: 0, apiErrors: [], valuations: 0, completedSkipped: 0, carried: 0, inputRequiredDates: [], prices: 0, pricesExisting: 0, snapshots: 0, navMissing: 0, noUnits: 0, zeroUnitsExcluded: 0, dates: [] };
    try {
      var config = configs.find(function(c) { return c.code === code; });
      _fundRecoveryDiagnosticStart(diagnostic, code, 'fundUnitsResolve', '_fundUnitsAtDate');
      var activeDates = [];
      for (var date = from; date <= to; date = _fundDateOffset(date, 1)) {
        var datedConfig = _fundUnitsAtDate(configs, code, date);
        if (datedConfig && datedConfig.units > 0) activeDates.push(date);
        else if (datedConfig && datedConfig.units === 0) fundResult.zeroUnitsExcluded++;
        else fundResult.noUnits++;
      }
      _fundRecoveryDiagnosticFinish(diagnostic, 'end');
      if (!activeDates.length) return;
      var activeTo = activeDates[activeDates.length - 1];
      // 주말은 새 NAV 공시 대상이 아니므로 저장 행이 없어도 API 누락으로 보지 않습니다.
      // 국내 공휴일은 별도 달력을 추측하지 않고 평일 누락으로 조회하되, 응답된 실제 공시일만 저장합니다.
      _fundRecoveryDiagnosticStart(diagnostic, code, 'storedNavResolve', '_storedFundNavRows');
      var navRows = _storedFundNavRows(storedNav, code, config.provider, from, activeTo);
      _fundRecoveryDiagnosticFinish(diagnostic, 'end');
      fundResult.storedNav = navRows.filter(function(row) { return row.date >= from && row.date <= activeTo; }).length;
      // carry-forward 평가행의 '일자'가 아니라 실제 '가격공시일'로만 확정 NAV 누락을 판정합니다.
      var storedPublicationDates = {};
      navRows.forEach(function(row) { storedPublicationDates[row.date] = true; });
      var missingDates = activeDates.filter(function(date) {
        return _fundNavExpectedPublicationDate(date, code) && !storedPublicationDates[date];
      });
      // F00001은 한화 공식 API, F00002는 exact standard-code FunETF 공개 NAV를 사용합니다.
      // F00003은 source 미설정이며 0좌 전환 후 외부조회하지 않습니다.
      var providerSource = FUND_PROVIDERS[config.provider].source;
      if (missingDates.length && !skipExternal && (providerSource === 'HANWHA' || providerSource === 'FUNETF')) {
        var fetchedResult = _fetchMissingFundNavBatches(config.provider, missingDates, activeTo, diagnostic, code);
        _fundRecoveryDiagnosticStart(diagnostic, code, 'externalNavFetch', '_fetchMissingFundNavBatches');
        _fundRecoveryDiagnosticFinish(diagnostic, fetchedResult.errors.length ? 'partial' : 'end', null, { batches: fetchedResult.batches, errors: fetchedResult.errors });
        fundResult.apiRequested = fetchedResult.batches.length + fetchedResult.errors.length;
        fundResult.apiSuccess = fetchedResult.rows.length;
        fundResult.apiFailed = fetchedResult.errors.length;
        fundResult.apiErrors = fetchedResult.errors;
        if (fetchedResult.errors.length) fundResult.status = 'partial';
        var bySourceDate = {};
        navRows.forEach(function(row) { bySourceDate[row.date] = row.nav; });
        fetchedResult.rows.forEach(function(row) {
          if (Object.prototype.hasOwnProperty.call(bySourceDate, row.date) && bySourceDate[row.date] !== row.nav) {
            fundResult.status = 'partial';
            fundResult.apiErrors.push({ from: row.date, to: row.date, message: '저장 NAV와 공식 API NAV 충돌' });
            return;
          }
          bySourceDate[row.date] = row.nav;
        });
        navRows = Object.keys(bySourceDate).sort().map(function(sourceDate) { return { date: sourceDate, nav: bySourceDate[sourceDate] }; });
      }
      if (!navRows.length) {
        fundResult.status = 'partial';
        fundResult.apiErrors.push({ from: from, to: activeTo, message: (providerSource === 'HANWHA' || providerSource === 'FUNETF') ? '확정 NAV를 확보하지 못함' : '저장된 확정 NAV 없음 (외부조회 금지)' });
      }
      _fundRecoveryDiagnosticStart(diagnostic, code, 'navConfirm', '_refreshFundValuations');
      var confirmedNavDates = {};
      navRows.forEach(function(row) { confirmedNavDates[row.date] = true; });
      fundResult.latestUnpublished = activeDates.some(function(date) { return date === today() && _fundNavExpectedPublicationDate(date, code) && !confirmedNavDates[date]; }) ? 1 : 0;
      fundResult.inputRequiredDates = activeDates.filter(function(date) {
        return date < today() && _fundNavExpectedPublicationDate(date, code) && !confirmedNavDates[date];
      });
      fundResult.navMissing = fundResult.inputRequiredDates.length;
      if (fundResult.navMissing > 0 && fundResult.status === 'ok') fundResult.status = 'partial';
      _fundRecoveryDiagnosticFinish(diagnostic, 'end');
      // 확정 NAV는 공시일 행으로만 저장하고, 누락일은 직전 NAV×해당일 좌수로 임시 평가합니다.
      _fundRecoveryDiagnosticStart(diagnostic, code, 'valuationCalculate', '_fundDailyValues');
      var codeValues = _fundDailyValues(configs, code, navRows, from, to).map(function(value) {
        value.carried = value.date !== value.sourceDate;
        value.inputRequired = value.carried && _fundNavExpectedPublicationDate(value.date, code) && !confirmedNavDates[value.date];
        return value;
      });
      _fundRecoveryDiagnosticFinish(diagnostic, 'end');
      var targetValues = codeValues.filter(function(value) {
        return _fundValueNeedsProcessing(value, storedKeys[value.date + '|' + value.code], priceKeys[value.date + '|' + value.code], snapshotKeys[value.date + '|' + value.code]);
      });
      fundResult.valuations = targetValues.length;
      fundResult.completedSkipped = codeValues.length - targetValues.length;
      fundResult.carried = targetValues.filter(function(value) { return value.carried; }).length;
      fundResult.dates = activeDates.map(function(activeDate) {
        var value = codeValues.find(function(item) { return item.date === activeDate; });
        var target = targetValues.some(function(item) { return item.date === activeDate; });
        var valuationRequired = !!value;
        var expected = _fundNavExpectedPublicationDate(activeDate, code);
        var navState = storedPublicationDates[activeDate] ? 'EXISTING_CONFIRMED' :
          (confirmedNavDates[activeDate] ? 'FETCHED_CONFIRMED' :
          (!expected ? 'NON_PUBLICATION_CARRY' : (activeDate === today() ? 'UNPUBLISHED' : 'NAV_MISSING')));
        var error = fundResult.apiErrors.find(function(item) { return activeDate >= item.from && activeDate <= item.to; });
        // 광범위한 오류 구간이어도 공시 대상이 아니거나 이미 확정된 날짜는 실패로 오염시키지 않습니다.
        if (error && expected && !confirmedNavDates[activeDate]) navState = 'API_FAILED';
        else if (!expected || confirmedNavDates[activeDate]) error = null;
        return { date: activeDate, publicationExpected: expected, navState: navState,
          unitsApplied: !!value, valuationRequired: valuationRequired,
          evaluationState: !valuationRequired ? 'NOT_REQUIRED' : (value ? (target ? 'WRITE_REQUIRED' : 'EXISTING_VALID') : 'NOT_CREATED'),
          snapshotState: !valuationRequired ? 'NOT_REQUIRED' : (snapshotKeys[activeDate + '|' + code] ? 'EXISTING_VALID' : (value ? 'WRITE_REQUIRED' : 'NOT_CREATED')),
          failureStage: error ? 'externalNavFetch' : '', failureReason: error ? error.message : '' };
      });
      values = values.concat(targetValues);
    } catch (err) {
      _fundRecoveryDiagnosticFinish(diagnostic, 'error', err);
      fundResult.status = 'error';
      fundResult.apiErrors.push({ from: from, to: to, message: err.message });
      if (!fundResult.dates.length) {
        for (var failedDate = from; failedDate <= to; failedDate = _fundDateOffset(failedDate, 1)) {
          fundResult.dates.push({ date: failedDate, navState: 'FAILED', unitsApplied: false,
            evaluationState: 'NOT_PROCESSED', snapshotState: 'NOT_PROCESSED', failureStage: diagnostic && diagnostic.current ? diagnostic.current.stage : 'fundProcessing', failureReason: err.message });
        }
      }
    }
  });
  // 검증과 외부 조회를 모두 마친 뒤 누락만 추가합니다. 재시도는 기존 저장값을 사용합니다.
  // 외부 HTTP·NAV 파싱·평가 계산은 lock 밖에서 완료합니다.
  // 동시 실행에서 중복 추가를 막기 위해 쓰기 직전 최신 상태를 다시 읽습니다.
  var writeLock = LockService.getScriptLock();
  var writeLocked = false;
  try {
    _fundRecoveryDiagnosticStart(diagnostic, onlyCode, 'writeLockWait', 'Lock.waitLock');
    writeLock.waitLock(30000); writeLocked = true;
    _fundRecoveryDiagnosticFinish(diagnostic, 'end');
    _fundRecoveryDiagnosticStart(diagnostic, onlyCode, 'navWrite', '_refreshFundValuations');
    navSheet = ss.getSheetByName(FUND_NAV_SHEET);
    storedNav = navSheet && navSheet.getLastRow() > 1 ? navSheet.getRange(2, 1, navSheet.getLastRow() - 1, 9).getValues() : [];
    storedKeys = {};
    var storedIndexes = {};
    storedNav.forEach(function(row) {
      if (String(row[8]) === providerByCode[String(row[1])]) {
        var key = _normalizeDate(row[0]) + '|' + row[1];
        storedKeys[key] = row;
        storedIndexes[key] = storedNav.indexOf(row);
      }
    });
  var now = new Date().toISOString();
  var newNav = [];
  var navChanged = false;
  values = values.map(function(value) {
    var key = value.date + '|' + value.code;
    var stored = storedKeys[key];
    if (stored) {
      var storedSourceDate = _normalizeDate(stored[4]);
      if (!(Number(stored[3]) > 0) || storedSourceDate > value.date) throw new Error('저장된 펀드 기준가격 검증 실패: ' + value.date);
      if (value.date === value.sourceDate) {
        if (storedSourceDate === value.date && Number(stored[3]) !== value.nav) throw new Error('기존 확정 NAV와 신규값 불일치: ' + value.date);
        if (storedSourceDate !== value.sourceDate || Number(stored[3]) !== value.nav || Number(stored[5]) !== value.units || Number(stored[6]) !== value.evalAmt) {
          var replacement = [value.date, value.code, value.name, value.nav, value.sourceDate, value.units, value.evalAmt, now, value.provider];
          storedNav[storedIndexes[key]] = replacement;
          storedKeys[key] = replacement;
          navChanged = true;
          fundResults[value.code].navSaved = Number(fundResults[value.code].navSaved || 0) + 1;
        }
      }
      return value;
    }
    if (value.date !== value.sourceDate) return value;
    newNav.push([value.date, value.code, value.name, value.nav, value.sourceDate, value.units, value.evalAmt, now, value.provider]);
    fundResults[value.code].navSaved = Number(fundResults[value.code].navSaved || 0) + 1;
    return value;
  });
  if (newNav.length) {
    if (!navSheet) { navSheet = ss.insertSheet(FUND_NAV_SHEET); navSheet.appendRow(['일자','종목코드','종목명','기준가격(1000좌)','가격공시일','좌수','평가금액','조회일시','클래스']); }
    storedNav = storedNav.concat(newNav);
    navChanged = true;
  }
  var navBackup = navChanged && navSheet && navSheet.getLastRow() > 1 ? _backupSheetBeforeWrite(ss, navSheet, FUND_NAV_SHEET) : null;
  if (navChanged && storedNav.length) {
    try {
      _setCodeColumnText(navSheet, 2);
      storedNav = _normalizeCodeRows(storedNav, 1);
      navSheet.getRange(2, 1, storedNav.length, 9).setValues(storedNav);
      _verifyFundNavWrittenRange(navSheet, 2, storedNav);
      _markSnapshotBackupStatus(navBackup, 'COMPLETED');
      if (navBackup) _cleanupCurrentSystemBackup(ss, navBackup);
    } catch (navWriteError) { _markSnapshotBackupStatus(navBackup, 'WRITE_FAILED', navWriteError.message); throw navWriteError; }
  }
  _fundRecoveryDiagnosticFinish(diagnostic, 'end');
  _fundRecoveryDiagnosticStart(diagnostic, onlyCode, 'priceHistoryWrite', '_refreshFundValuations');
  var append = [];
  var pricesChanged = false;
  values.forEach(function(value) {
    var key = value.date + '|' + value.code;
    // MANUAL은 항상 보존하되, 임시 이월행은 같은 날짜의 확정 NAV가 도착하면 교체합니다.
    if (!priceKeys[key]) {
      var rowSource = value.inputRequired ? 'FUND_NAV_CARRY_INPUT_REQUIRED' : (value.carried ? 'FUND_NAV_CARRY' : 'FUND_NAV');
      var row = [value.date, value.code, value.name, value.evalAmt, '', rowSource];
      append.push(row); priceKeys[key] = row; fundResults[value.code].prices++;
    } else {
      var existing = priceKeys[key];
      var existingSource = String(existing[5] || '').toUpperCase();
      var expectedSource = value.inputRequired ? 'FUND_NAV_CARRY_INPUT_REQUIRED' : (value.carried ? 'FUND_NAV_CARRY' : 'FUND_NAV');
      if (existingSource !== 'MANUAL' && (Number(existing[3]) !== value.evalAmt || existingSource !== expectedSource)) {
        existing[2] = value.name;
        existing[3] = value.evalAmt;
        existing[4] = now;
        existing[5] = expectedSource;
        pricesChanged = true;
        fundResults[value.code].prices++;
      } else fundResults[value.code].pricesExisting++;
    }
  });
  var priceBackup = pricesChanged && ph && ph.getLastRow() > 1 ? _backupSheetBeforeWrite(ss, ph, CONFIG.SHEET_PH) : null;
  if (pricesChanged) {
    try {
      _setCodeColumnText(ph, 2); prices = _normalizeCodeRows(prices, 1); ph.getRange(2, 1, prices.length, 6).setValues(prices);
      _verifyWrittenRange(ph, 2, 1, prices, '펀드 가격이력 쓰기 후 검증 실패');
      _markSnapshotBackupStatus(priceBackup, 'COMPLETED');
      if (priceBackup) _cleanupCurrentSystemBackup(ss, priceBackup);
    } catch (priceWriteError) { _markSnapshotBackupStatus(priceBackup, 'WRITE_FAILED', priceWriteError.message); throw priceWriteError; }
  }
  if (append.length) {
    if (!ph) { ph = ss.insertSheet(CONFIG.SHEET_PH); ph.appendRow(['날짜','종목코드','종목명','가격','입력일시','가격소스']); }
    _setCodeColumnText(ph, 2);
    ph.getRange(ph.getLastRow() + 1, 1, append.length, 6).setValues(_normalizeCodeRows(append, 1));
  }
  if (navChanged || pricesChanged || append.length) _touchSnapshotIntegritySourceRevision({ from: from });
  _fundRecoveryDiagnosticFinish(diagnostic, 'end');
  } finally {
    if (writeLocked) writeLock.releaseLock();
  }
  _fundRecoveryDiagnosticStart(diagnostic, onlyCode, 'snapshotTargetCalculate', '_buildSnapshotRowsFromTradeAndPriceHistory');
  var tradeSheet = ss.getSheetByName(CONFIG.SHEET_TRADES);
  var trades = tradeSheet && tradeSheet.getLastRow() > 1 ? tradeSheet.getRange(2,1,tradeSheet.getLastRow()-1,8).getValues() : [];
  var nameCodes = {};
  configs.forEach(function(c) { nameCodes[c.name] = c.code; });
  var byDate = {};
  var missingHoldings = [];
  var snapshotWarnings = [];
  values.forEach(function(value) {
    var holdings = calcHoldingsAtDate(trades, value.date, nameCodes);
    _applyFundUnitLifecycleToSnapshotHoldings(holdings, configs, value.date);
    var h = Object.keys(holdings).map(function(k) { return holdings[k]; }).find(function(item) { return item.code === value.code; });
    if (!h) { missingHoldings.push(value.date + ':' + value.code); return; }
    var entry = priceKeys[value.date + '|' + value.code];
    var evalAmt = Number(entry[3]);
    var pnl = evalAmt - h.costAmt;
    if (!byDate[value.date]) byDate[value.date] = [];
    byDate[value.date].push([value.date, value.code, value.name, 1, h.costAmt, h.costAmt, evalAmt, evalAmt, pnl, h.costAmt > 0 ? Math.round(pnl / h.costAmt * 10000)/100 : 0, entry[5] || 'PRICE_HISTORY', entry[4] || '']);
  });
  _fundRecoveryDiagnosticFinish(diagnostic, 'end');
  _fundRecoveryDiagnosticStart(diagnostic, onlyCode, 'snapshotWrite', 'writeSnapshotRows');
  var snapshotCount = 0, snapshotOperationUnsafe = false;
  var previousSnapshotOperationId = _snapshotBackupOperationId;
  var fundSnapshotOperationId = 'refreshFundValuations|' + (onlyCode || 'ALL') + '|' + from + '|' + to + '|' + Utilities.getUuid();
  _snapshotBackupOperationId = fundSnapshotOperationId;
  try { Object.keys(byDate).sort().forEach(function(date) {
    var existing = _filterSnapshotRowsByFundLifecycle(_readSnapshotRowsByDate(ss, date), configs, date);
    var rebuilt = _buildSnapshotRowsFromTradeAndPriceHistory(ss, date, true);
    var combined = _mergeSnapshotRowsSafely(rebuilt, byDate[date], true);
    combined = _mergeSnapshotRowsSafely(existing, combined, true);
    var holdings = calcHoldingsAtDate(trades, date, nameCodes);
    _applyFundUnitLifecycleToSnapshotHoldings(holdings, configs, date);
    var incomplete = Object.keys(holdings).some(function(k) {
      var h = holdings[k];
      return !combined.some(function(row) { return (h.code && row[1] === h.code) || row[2] === h.name; });
    });
    // 펀드만 존재하는 불완전한 신규 스냅샷으로 전체 자산이 급락해 보이지 않게 합니다.
    if (incomplete) { missingHoldings.push(date + ':다른 보유종목의 평가자료 부족'); return; }
    var fundRewritePlan = _snapshotRewritePlan(ss, date, combined, configs);
    if (fundRewritePlan.unsafe.length) {
      snapshotOperationUnsafe = true;
      var protectedReason = date + ':' + fundRewritePlan.unsafe.map(function(item) { return item.classification + ': ' + item.reason; }).join('; ');
      missingHoldings.push(protectedReason);
      snapshotWarnings.push(protectedReason);
      byDate[date].forEach(function(value) { if (fundResults[value[1]]) fundResults[value[1]].status = 'partial'; });
      return;
    }
    writeSnapshotRows(ss, date, combined, true, null, configs);
    snapshotCount++;
    byDate[date].forEach(function(value) {
      if (!fundResults[value[1]]) return;
      fundResults[value[1]].snapshots++;
      var day = (fundResults[value[1]].dates || []).find(function(item) { return item.date === date; });
      if (day) { day.evaluationState = 'SAVED_OR_UPDATED'; day.snapshotState = 'SAVED_OR_UPDATED'; }
    });
  });
  SpreadsheetApp.flush();
  _settleSnapshotBackupOperation(ss, fundSnapshotOperationId, !snapshotOperationUnsafe, snapshotOperationUnsafe ? '보호된 Snapshot 충돌' : '');
  } catch (snapshotOperationError) {
    _settleSnapshotBackupOperation(ss, fundSnapshotOperationId, false, snapshotOperationError.message);
    throw snapshotOperationError;
  } finally { _snapshotBackupOperationId = previousSnapshotOperationId; }
  _fundRecoveryDiagnosticFinish(diagnostic, 'end');
  _fundRecoveryDiagnosticStart(diagnostic, onlyCode, 'resultAggregate', '_refreshFundValuations');
  var result = {
    completionStatus: Object.keys(fundResults).some(function(code) { return fundResults[code].status !== 'ok'; }) ? 'partial' : 'ok',
    saved: append.length, navSaved: newNav.length, snapshots: snapshotCount,
    processing: {
      nav: { processed: values.length, pending: Object.keys(fundResults).reduce(function(sum, code) { return sum + Number(fundResults[code].navMissing || 0); }, 0) },
      priceHistory: { processed: values.length, pending: 0 },
      snapshots: { processed: snapshotCount, pending: Math.max(0, Object.keys(byDate).length - snapshotCount), reasons: missingHoldings.slice() }
    },
    missingHoldings: missingHoldings, snapshotWarnings: snapshotWarnings,
    lastDate: values.map(function(v) { return v.date; }).sort().pop() || '', fundResults: fundResults
  };
  _fundRecoveryDiagnosticFinish(diagnostic, 'end');
  return result;
}

function handleRefreshFundValuations(from, to, code, diagnosticFlag) {
  code = String(code || '').trim().toUpperCase();
  var diagnostic = _createFundRecoveryDiagnostic(String(diagnosticFlag || '').toLowerCase() === 'true', from, to, code);
  try {
    _fundRecoveryDiagnosticStart(diagnostic, code, 'request', 'handleRefreshFundValuations');
    if (code && ['F00001','F00002','F00003'].indexOf(code) === -1) throw new Error('지원하지 않는 펀드 코드');
    var result = _refreshFundValuations(getss(), from, to, code || undefined, false, diagnostic);
    _fundRecoveryDiagnosticStart(diagnostic, code, 'request', 'handleRefreshFundValuations');
    _fundRecoveryDiagnosticFinish(diagnostic, 'end');
    if (diagnostic) result.diagnostic = diagnostic;
    return jsonOk(result);
  }
  catch (err) {
    var failedStage = diagnostic && diagnostic.current ? { stage: diagnostic.current.stage, functionName: diagnostic.current.functionName } : null;
    _fundRecoveryDiagnosticFinish(diagnostic, 'error', err);
    _fundRecoveryDiagnosticStart(diagnostic, code, 'request', 'handleRefreshFundValuations');
    _fundRecoveryDiagnosticFinish(diagnostic, 'error', err, failedStage);
    return jsonError('펀드 평가 반영 실패: ' + err.message, diagnostic ? { diagnostic: diagnostic } : null);
  }
}

function _inspectFundNavImport(ss, dataJson) {
  var input;
  try { input = JSON.parse(dataJson); } catch (err) { throw new Error('NAV import JSON 형식을 확인하세요.'); }
  var code = String(input.code || '').trim().toUpperCase();
  var spec = FUND_NAV_IMPORT_SPECS[code];
  if (!Object.prototype.hasOwnProperty.call(FUND_NAV_IMPORT_SPECS, code)) throw new Error('수동 NAV import는 F00001/F00002/F00003만 지원합니다.');
  if (String(input.provider || '') !== spec.provider || String(input.classCode || '') !== spec.classCode) throw new Error('선택한 펀드의 provider/클래스가 일치하지 않습니다.');
  var sourceText = String(input.sourceText || '').toUpperCase();
  if (sourceText.length > 500000) throw new Error('파일 식별 정보가 너무 큽니다.');
  var wrongIdentifier = spec.forbidden.find(function(identifier) { return sourceText.indexOf(identifier) !== -1; });
  if (wrongIdentifier) throw new Error('다른 클래스 식별자가 발견됐습니다: ' + wrongIdentifier);
  var rows = Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length || rows.length > 5000) throw new Error('NAV 행은 1~5,000건이어야 합니다.');
  var configs = _readFundUnits(ss);
  var fundConfig = configs.find(function(config) { return config.code === code && config.provider === spec.provider; });
  if (!fundConfig) throw new Error('선택한 펀드의 좌수 이력을 먼저 등록하세요.');
  var navSheet = ss.getSheetByName(FUND_NAV_SHEET);
  var stored = navSheet && navSheet.getLastRow() > 1 ? navSheet.getRange(2, 1, navSheet.getLastRow() - 1, 9).getValues() : [];
  var existing = {};
  stored.forEach(function(row, index) {
    if (String(row[1]) !== code || String(row[8]) !== spec.provider) return;
    var storedDate = _normalizeDate(row[0]);
    var sourceDate = _normalizeDate(row[4]);
    if (storedDate !== sourceDate) return;
    var storedNav = Number(row[3]);
    if (Object.prototype.hasOwnProperty.call(existing, storedDate) && existing[storedDate] !== storedNav) throw new Error('기존 펀드기준가격 충돌: ' + storedDate);
    existing[storedDate] = { nav: storedNav, rowIndex: index };
  });
  var candidates = [], errors = [], duplicates = [], identical = [], updates = [], warnings = [], zeroUnits = [], seen = {};
  rows.forEach(function(row, index) {
    var rowNumber = Number(row && row.rowNumber) || index + 2;
    var date, nav;
    try { date = _fundDate(row && row.date); } catch (err) { errors.push({ rowNumber: rowNumber, reason: '잘못된 날짜' }); return; }
    nav = Number(row && row.nav);
    if (!isFinite(nav) || nav <= 0) { errors.push({ rowNumber: rowNumber, reason: '기준가격은 0보다 큰 숫자여야 합니다.' }); return; }
    if (date > today()) { errors.push({ rowNumber: rowNumber, reason: '미래 날짜' }); return; }
    if (Object.prototype.hasOwnProperty.call(seen, date)) {
      duplicates.push({ rowNumber: rowNumber, date: date, nav: nav });
      if (seen[date] !== nav) errors.push({ rowNumber: rowNumber, reason: '파일 내 동일 날짜 NAV 충돌' });
      return;
    }
    seen[date] = nav;
    var config = _fundUnitsAtDate(configs, code, date);
    if (!config) { errors.push({ rowNumber: rowNumber, reason: '해당 날짜의 좌수 이력 없음' }); return; }
    if (config.provider !== spec.provider) { errors.push({ rowNumber: rowNumber, reason: '좌수 이력의 클래스 불일치' }); return; }
    if (config.units === 0) { zeroUnits.push({ rowNumber: rowNumber, date: date, nav: nav }); return; }
    if (Object.prototype.hasOwnProperty.call(existing, date)) {
      var detail = { rowNumber: rowNumber, date: date, existingNav: existing[date].nav, uploadedNav: nav, existingRowIndex: existing[date].rowIndex };
      if (existing[date].nav === nav) identical.push(detail);
      else { updates.push(detail); warnings.push({ rowNumber: rowNumber, date: date, reason: '기존 NAV와 다른 값', previousNav: existing[date].nav, nav: nav }); }
      return;
    }
    var evalAmt = Math.round(nav * config.units / 1000);
    if (!Number.isSafeInteger(evalAmt) || evalAmt < 0) { errors.push({ rowNumber: rowNumber, reason: '평가금액 계산 범위 초과' }); return; }
    candidates.push({ rowNumber: rowNumber, date: date, nav: nav, units: config.units, evalAmt: evalAmt, name: config.name });
  });
  candidates.sort(function(a, b) { return a.date.localeCompare(b.date); });
  var changed = candidates.concat(updates).sort(function(a, b) { return a.date.localeCompare(b.date); });
  var known = {};
  Object.keys(existing).forEach(function(date) { known[date] = existing[date].nav; });
  changed.forEach(function(row) { known[row.date] = row.uploadedNav || row.nav; });
  var knownDates = Object.keys(known).sort();
  changed.forEach(function(row) {
    var previousDate = knownDates.filter(function(date) { return date < row.date; }).pop();
    if (!previousDate) return;
    var nav = row.uploadedNav || row.nav, previousNav = known[previousDate];
    if (nav === previousNav) warnings.push({ rowNumber: row.rowNumber, date: row.date, reason: '직전 확정 NAV와 동일', previousDate: previousDate, previousNav: previousNav, nav: nav });
    else if (Math.abs(nav / previousNav - 1) >= 0.20) warnings.push({ rowNumber: row.rowNumber, date: row.date, reason: '직전 확정 NAV 대비 20% 이상 변동', previousDate: previousDate, previousNav: previousNav, nav: nav });
  });
  if (changed.some(function(row) { return row.date === today(); })) warnings.push({ date: today(), reason: '오늘 NAV는 공식 확정값인지 확인 필요' });
  return { code: code, fundName: fundConfig.name, spec: spec, total: rows.length, recognized: rows.length - errors.length, candidates: candidates, updates: updates, warnings: warnings, errors: errors, duplicates: duplicates, identical: identical, zeroUnits: zeroUnits, canSave: errors.length === 0 && (changed.length > 0 || identical.length > 0), from: changed.length ? changed[0].date : '', to: changed.length ? changed[changed.length - 1].date : '', firstDate: Object.keys(seen).sort()[0] || '', lastDate: Object.keys(seen).sort().pop() || '' };
}

function handlePreviewFundNavImport(dataJson) {
  try { return jsonOk(_inspectFundNavImport(getss(), dataJson)); }
  catch (err) { return jsonError('NAV import 검증 실패: ' + err.message); }
}

var GOOGLE_SHEETS_CELL_LIMIT = 10000000;

function _fundSheetCapacity(ss) {
  if (!ss || typeof ss.getSheets !== 'function') return null;
  var targetNames = {};
  targetNames[FUND_NAV_SHEET] = true;
  targetNames[CONFIG.SHEET_PH] = true;
  targetNames[CONFIG.SHEET_SNAPSHOT] = true;
  var totalCells = 0, backupSheets = 0, targets = {};
  ss.getSheets().forEach(function(sheet) {
    var name = typeof sheet.getName === 'function' ? String(sheet.getName()) : '';
    var maxRows = typeof sheet.getMaxRows === 'function' ? Number(sheet.getMaxRows()) || 0 : 0;
    var maxColumns = typeof sheet.getMaxColumns === 'function' ? Number(sheet.getMaxColumns()) || 0 : 0;
    var allocatedCells = maxRows * maxColumns;
    totalCells += allocatedCells;
    if (name.indexOf('_백업_') !== -1) backupSheets++;
    if (targetNames[name]) targets[name] = {
      lastRow: Number(sheet.getLastRow()) || 0,
      lastColumn: Number(sheet.getLastColumn()) || 0,
      maxRows: maxRows,
      maxColumns: maxColumns,
      allocatedCells: allocatedCells
    };
  });
  return {
    totalCells: totalCells,
    limit: GOOGLE_SHEETS_CELL_LIMIT,
    remainingCells: Math.max(0, GOOGLE_SHEETS_CELL_LIMIT - totalCells),
    backupSheets: backupSheets,
    targets: targets
  };
}

function _sheetRole(name) {
  if (/_백업_/.test(name)) return 'BACKUP';
  if (/LEGACY/i.test(name)) return 'LEGACY';
  if (name === CONFIG.SHEET_SNAPSHOT) return 'SNAPSHOT';
  if (name === CONFIG.SHEET_PH) return 'PRICE_HISTORY';
  if (name === FUND_NAV_SHEET) return 'FUND_NAV';
  return 'OPERATIONAL_OR_AUXILIARY';
}

var SYSTEM_BACKUP_REGISTRY_KEY = 'system_backup_registry_v1';
var SYSTEM_BACKUP_SIGNATURE_VERSION = 'backup-content-v2';
// 성공한 system backup은 rollback 용도가 종료되므로 steady state에서 보존하지 않습니다.
var SYSTEM_BACKUP_KEEP_BY_SOURCE = { '스냅샷': 0, '거래이력': 0, '가격이력': 0, '펀드기준가격': 0, '펀드좌수': 0, '종목코드': 0 };

function _readSystemBackupRegistry() {
  try {
    var parsed = JSON.parse(PropertiesService.getScriptProperties().getProperty(SYSTEM_BACKUP_REGISTRY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (ignore) { return []; }
}

function _writeSystemBackupRegistry(items) {
  PropertiesService.getScriptProperties().setProperty(SYSTEM_BACKUP_REGISTRY_KEY, JSON.stringify(items || []));
}

// 최신 성공 증거가 사라지기 전에 같은 source의 안전한 stale rollback을 먼저 지웁니다.
// registry에 stale candidate가 없으면 기존 fast path대로 workbook/formula scan을 하지 않습니다.
function _cleanupCurrentSystemBackup(ss, record) {
  if (!record) return null;
  var items = _readSystemBackupRegistry();
  var registered = items.filter(function(item) {
    return item.name === record.name && item.source === record.source && item.operationId === record.operationId &&
      item.systemGenerated === true && item.status === 'COMPLETED';
  })[0];
  if (!registered) return { deleted: false, reason: '검증된 현재 operation backup record 없음' };
  if (!registered.source || !Object.prototype.hasOwnProperty.call(SYSTEM_BACKUP_KEEP_BY_SOURCE, registered.source) || !ss.getSheetByName(registered.source)) {
    return { deleted: false, name: registered.name, reason: '원본 source sheet 없음 · backup 보호' };
  }

  // 현재 COMPLETED backup 자체가 실제로 유효한지 먼저 확인해야 과거 rollback을 안전하게 정리할 수 있습니다.
  var sourceSheet = ss.getSheetByName(registered.source);
  var sheet = ss.getSheetByName(registered.name);
  if (!sheet) {
    _writeSystemBackupRegistry(items.filter(function(item) { return item.name !== registered.name; }));
    return { deleted: false, name: registered.name, reason: 'backup sheet 없음·registry record 정리', staleDeleted: [], staleProtected: [], missingRecords: [registered.name], legacyMigratedDeleted: [] };
  }
  if (!registered.signature) return { deleted: false, name: registered.name, reason: 'registry backup signature 없음' };
  if (_sheetContentSignature(sheet) !== registered.signature) {
    return { deleted: false, name: registered.name, reason: 'registry/실제 backup signature 불일치 보호' };
  }

  // legacy signature mismatch는 자체 서명을 다시 쓰지 않습니다.
  // 다만 실제 backup content로 검증된 최신 v2 COMPLETED backup이 생긴 뒤에는,
  // 그보다 오래된 동일 source의 system-generated COMPLETED backup을 schema/formula 검증 후 stale rollback으로 정리할 수 있습니다.
  // 같은 operationId에 CREATED sibling이 남아 있으면 부분 완료 상태일 수 있으므로 current/stale 모두 cleanup 근거로 쓰지 않습니다.
  var operationsWithCreatedBackup = {};
  items.forEach(function(item) {
    if (item && item.status === 'CREATED' && item.operationId) operationsWithCreatedBackup[item.operationId] = true;
  });
  var sourceHeaderSignature = sourceSheet ? _sheetHeaderSignature(sourceSheet) : '';
  var currentCompletedAt = _backupTimeMillis(registered.completedAt || registered.updatedAt || registered.createdAt);
  var staleCandidates = items.filter(function(item) {
    if (item.name === registered.name || item.source !== registered.source || item.systemGenerated !== true) return false;
    if (item.status !== 'COMPLETED') return false;
    return currentCompletedAt && _backupTimeMillis(item.completedAt || item.updatedAt || item.createdAt) < currentCompletedAt;
  });
  var staleDeleted = [], missingRecords = [], legacyMigratedDeleted = [];
  var staleProtected = items.filter(function(item) {
    return item.name !== registered.name && item.source === registered.source && item.systemGenerated === true && ['CREATED', 'WRITE_FAILED'].indexOf(item.status) !== -1 &&
      currentCompletedAt && _backupTimeMillis(item.updatedAt || item.createdAt) < currentCompletedAt;
  }).map(function(item) { return { name: item.name, reason: item.status === 'CREATED' ? 'CREATED 상태 · active 여부 확인 불가' : 'WRITE_FAILED · 복구 검증 없음' }; });
  // stale 후보가 있을 때만 workbook formula scan을 1회 수행하며, migration 근거가 되는 current v2도 함께 검사합니다.
  var formulaReferenceTargets = staleCandidates.map(function(item) { return item.name; });
  if (staleCandidates.length) formulaReferenceTargets.unshift(registered.name);
  var staleFormulaCounts = staleCandidates.length ? _sheetFormulaReferenceCounts(ss, formulaReferenceTargets) : {};
  var currentSchemaMatch = !!(sourceHeaderSignature && _sheetHeaderSignature(sheet) === sourceHeaderSignature);
  var currentTrustedV2 = registered.signatureVersion === SYSTEM_BACKUP_SIGNATURE_VERSION &&
    !operationsWithCreatedBackup[registered.operationId] && currentSchemaMatch &&
    Number(staleFormulaCounts[registered.name] || 0) === 0;
  if (staleCandidates.length) staleCandidates.forEach(function(item) {
    var staleSheet = ss.getSheetByName(item.name);
    if (!staleSheet) { missingRecords.push(item.name); return; }
    if (Number(staleFormulaCounts[item.name] || 0) !== 0) { staleProtected.push({ name: item.name, reason: '수식 참조 존재' }); return; }
    var staleSignatureMatch = !!(item.signature && _sheetContentSignature(staleSheet) === item.signature);
    var legacySupersededByTrustedV2 = !!(currentTrustedV2 &&
      item.signatureVersion !== SYSTEM_BACKUP_SIGNATURE_VERSION &&
      !!item.signature &&
      !operationsWithCreatedBackup[item.operationId] &&
      sourceHeaderSignature && _sheetHeaderSignature(staleSheet) === sourceHeaderSignature);
    if (!staleSignatureMatch && !legacySupersededByTrustedV2) {
      staleProtected.push({ name: item.name, reason: item.signature ? 'registry/실제 backup signature 불일치 보호' : 'registry backup signature 없음' });
      return;
    }
    try {
      ss.deleteSheet(staleSheet);
      staleDeleted.push(item.name);
      if (legacySupersededByTrustedV2 && !staleSignatureMatch) legacyMigratedDeleted.push(item.name);
    } catch (staleError) { staleProtected.push({ name: item.name, reason: '삭제 실패: ' + staleError.message }); }
  });
  var removedRecords = {};
  staleDeleted.concat(missingRecords).forEach(function(name) { removedRecords[name] = true; });
  if (Object.keys(removedRecords).length) {
    items = items.filter(function(item) { return !removedRecords[item.name]; });
    _writeSystemBackupRegistry(items);
  }
  try {
    ss.deleteSheet(sheet);
    _writeSystemBackupRegistry(items.filter(function(item) { return item.name !== registered.name; }));
    return { deleted: true, name: registered.name, staleDeleted: staleDeleted, staleProtected: staleProtected, missingRecords: missingRecords, legacyMigratedDeleted: legacyMigratedDeleted };
  } catch (error) { return { deleted: false, name: registered.name, reason: '삭제 실패: ' + error.message, staleDeleted: staleDeleted, staleProtected: staleProtected, missingRecords: missingRecords, legacyMigratedDeleted: legacyMigratedDeleted }; }
}
function _cleanupCompletedOperationBackups(ss, sourceName, operationId) {
  return _readSystemBackupRegistry().filter(function(item) {
    return item.source === sourceName && item.operationId === operationId && item.systemGenerated === true && item.status === 'COMPLETED';
  }).map(function(item) { return _cleanupCurrentSystemBackup(ss, item); });
}

function _settleSnapshotBackupOperation(ss, operationId, succeeded, message) {
  if (!operationId) return [];
  var records = _readSystemBackupRegistry().filter(function(item) {
    return item.source === CONFIG.SHEET_SNAPSHOT && item.operationId === operationId && item.systemGenerated === true;
  });
  records.forEach(function(item) { _markSnapshotBackupStatus(item, succeeded ? 'COMPLETED' : 'WRITE_FAILED', message); });
  return succeeded ? _cleanupCompletedOperationBackups(ss, CONFIG.SHEET_SNAPSHOT, operationId) : [];
}

function _verifyWrittenRange(sheet, row, column, values, message) {
  SpreadsheetApp.flush();
  if (!values || !values.length) return;
  var actual = sheet.getRange(row, column, values.length, values[0].length).getValues();
  if (JSON.stringify(actual) !== JSON.stringify(values)) throw new Error(message || '쓰기 후 read-back 검증 실패');
}

// 펀드 NAV 시트의 A/E열은 DATE 서식입니다. 저장 입력은 'YYYY-MM-DD' 문자열이어도
// getValues()는 Date 객체를 반환하므로 원시 JSON 비교는 정상 쓰기를 실패로 오판합니다.
// 다른 열은 기존의 엄격한 read-back 규칙을 유지합니다.
function _verifyFundNavWrittenRange(sheet, row, values) {
  SpreadsheetApp.flush();
  if (!values || !values.length) return;
  var actual = sheet.getRange(row, 1, values.length, 9).getValues();
  if (actual.length !== values.length) throw new Error('펀드기준가격 쓰기 후 검증 실패: 행 수 불일치');
  for (var i = 0; i < values.length; i++) {
    for (var j = 0; j < 9; j++) {
      var expected = values[i][j], found = actual[i] && actual[i][j], same = false;
      if (j === 0 || j === 4) {
        same = !!_normalizeDate(expected) && _normalizeDate(found) === _normalizeDate(expected);
      } else if (j === 3 || j === 5 || j === 6) {
        same = isFinite(Number(expected)) && Number(found) === Number(expected);
      } else {
        same = String(found == null ? '' : found) === String(expected == null ? '' : expected);
      }
      if (!same) throw new Error('펀드기준가격 쓰기 후 검증 실패: 시트 행 ' + (row + i) + ' 열 ' + (j + 1));
    }
  }
}

function _registerSystemBackup(record) {
  var items = _readSystemBackupRegistry().filter(function(item) { return item.name !== record.name; });
  items.push(record);
  _writeSystemBackupRegistry(items);
}

function _backupSourceFromSystemName(name) {
  var match = String(name || '').match(/^(.+)_백업_(\d{8})_(\d{6})_[A-Za-z0-9-]{6}$/);
  return match && Object.prototype.hasOwnProperty.call(SYSTEM_BACKUP_KEEP_BY_SOURCE, match[1]) ? match[1] : '';
}

function _systemBackupTimestampFromName(name) {
  var match = String(name || '').match(/_백업_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/);
  if (!match) return '';
  var localText = match[1] + '-' + match[2] + '-' + match[3] + ' ' + match[4] + ':' + match[5] + ':' + match[6];
  try { return Utilities.parseDate(localText, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss').toISOString(); }
  catch (ignore) { return localText; }
}

function _backupTimeMillis(value) { var parsed = Date.parse(String(value || '')); return isNaN(parsed) ? 0 : parsed; }

function _sheetHeaderSignature(sheet) {
  if (!sheet || !sheet.getLastRow() || !sheet.getLastColumn()) return '';
  return JSON.stringify(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
}

// 이름만으로는 채택하지 않고 naming·원본 schema·formula·signature를 모두 확인합니다.
function _reconcileSystemBackups(ss) {
  var items = _readSystemBackupRegistry(), byName = {}, reconciled = [], unresolved = [];
  items.forEach(function(item) { byName[item.name] = item; });
  ss.getSheets().forEach(function(sheet) {
    var name = String(sheet.getName()), source = _backupSourceFromSystemName(name);
    if (byName[name] || name.indexOf('_백업_') === -1) return;
    if (!source) { unresolved.push({ name: name, classification: 'USER_MANAGED_BACKUP', reason: '시스템 naming convention 불일치' }); return; }
    var sourceSheet = ss.getSheetByName(source), formulaCount = -1, signature = '';
    try { formulaCount = _sheetFormulaReferenceCount(ss, name); signature = _sheetContentSignature(sheet); }
    catch (error) { unresolved.push({ name: name, classification: 'UNKNOWN', reason: error.message }); return; }
    if (!sourceSheet || _isGasReferencedSheet(name) || formulaCount !== 0 || !signature ||
        _sheetHeaderSignature(sheet) !== _sheetHeaderSignature(sourceSheet)) {
      unresolved.push({ name: name, classification: 'UNKNOWN', reason: '원본/schema/formula/signature 안전 검증 불충족' }); return;
    }
    var record = { name: name, source: source, signature: signature, sourceSignature: '', signatureVersion: SYSTEM_BACKUP_SIGNATURE_VERSION,
      operationId: 'reconciled-orphan', status: 'COMPLETED', systemGenerated: true, orphanAdopted: true,
      createdAt: _systemBackupTimestampFromName(name), completedAt: _systemBackupTimestampFromName(name), updatedAt: new Date().toISOString() };
    items.push(record); byName[name] = record; reconciled.push({ name: name, classification: 'ORPHAN_LIKELY_SYSTEM' });
  });
  if (reconciled.length) _writeSystemBackupRegistry(items);
  return { reconciled: reconciled, unresolved: unresolved };
}

// 레지스트리에 생성 기록이 있고 최신 검증본이 따로 남는 시스템 백업만 삭제합니다.
function _cleanupSystemBackups(ss, sourceName, reconcileOrphans) {
  var reconciliation = reconcileOrphans === false ? { reconciled: [], unresolved: [] } : _reconcileSystemBackups(ss);
  var items = _readSystemBackupRegistry(), keep = Number(SYSTEM_BACKUP_KEEP_BY_SOURCE[sourceName] || 0);
  var sourceItems = items.filter(function(item) { return item.source === sourceName && item.systemGenerated === true; });
  var signatureMatches = function(item) {
    var sheet = item && ss.getSheetByName(item.name);
    return !!(sheet && item.signature && _sheetContentSignature(sheet) === item.signature);
  };
  var candidates = sourceItems.filter(function(item) { return item.status === 'COMPLETED' && signatureMatches(item); })
    .sort(function(a, b) { return String(b.completedAt || b.createdAt).localeCompare(String(a.completedAt || a.createdAt)); });
  var protectedNames = {};
  candidates.slice(0, keep).forEach(function(item) { protectedNames[item.name] = true; });
  var deleted = [], failures = [], releasedCells = 0;
  var deletable = candidates.slice(keep);
  deletable.forEach(function(item) {
    var sheet = ss.getSheetByName(item.name);
    if (!sheet || protectedNames[item.name] || item.source !== sourceName || item.systemGenerated !== true) return;
    try {
      if (!signatureMatches(item) || _sheetFormulaReferenceCount(ss, item.name) !== 0) return;
      var cells = sheet.getMaxRows() * sheet.getMaxColumns();
      ss.deleteSheet(sheet);
      deleted.push(item.name); releasedCells += cells;
    } catch (err) { failures.push({ name: item.name, message: err.message }); }
  });
  var deletedMap = {}; deleted.forEach(function(name) { deletedMap[name] = true; });
  _writeSystemBackupRegistry(items.filter(function(item) { return !deletedMap[item.name]; }));
  var unresolved = sourceItems.filter(function(item) { return deleted.indexOf(item.name) === -1; }).map(function(item) {
    return { name: item.name, status: item.status, reason: !signatureMatches(item) ? 'registry/실제 backup signature 불일치 보호' :
      (item.status === 'WRITE_FAILED' ? '쓰기 실패 복구본 보호' : (item.status === 'COMPLETED' ? '완료 backup 보호' : '완료 검증 전 백업 보호')) };
  });
  return { source: sourceName, beforeCount: sourceItems.length, afterCount: sourceItems.length - deleted.length,
    total: sourceItems.length, deleted: deleted, deletedCount: deleted.length,
    kept: sourceItems.filter(function(item) { return deleted.indexOf(item.name) === -1; }).map(function(item) { return item.name; }),
    reconciled: reconciliation.reconciled, releasedCells: releasedCells, failures: failures,
    unresolved: unresolved.concat(reconciliation.unresolved) };
}

function _isGasReferencedSheet(name) {
  var known = [CONFIG.SHEET_SNAPSHOT, CONFIG.SHEET_PH, FUND_NAV_SHEET,
    CONFIG.SHEET_TRADES, CONFIG.SHEET_HOLD, CONFIG.SHEET_CODES];
  return known.indexOf(name) !== -1;
}

function _sheetFormulaReferenceCount(ss, targetName) {
  var escaped = String(targetName).replace(/'/g, "''");
  var patterns = ["'" + escaped + "'!", targetName + '!'];
  var count = 0;
  ss.getSheets().forEach(function(sheet) {
    if (!sheet.getLastRow() || !sheet.getLastColumn()) return;
    var formulas = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getFormulas();
    formulas.forEach(function(row) { row.forEach(function(formula) {
      if (formula && patterns.some(function(pattern) { return formula.indexOf(pattern) !== -1; })) count++;
    }); });
  });
  return count;
}

function _sheetFormulaReferenceCounts(ss, targetNames) {
  var counts = {}, patterns = (targetNames || []).map(function(name) {
    counts[name] = 0;
    return { name: name, quoted: "'" + String(name).replace(/'/g, "''") + "'!", plain: String(name) + '!' };
  });
  if (!patterns.length) return counts;
  ss.getSheets().forEach(function(sheet) {
    if (!sheet.getLastRow() || !sheet.getLastColumn()) return;
    sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getFormulas().forEach(function(row) {
      row.forEach(function(formula) {
        if (!formula) return;
        patterns.forEach(function(pattern) { if (formula.indexOf(pattern.quoted) !== -1 || formula.indexOf(pattern.plain) !== -1) counts[pattern.name]++; });
      });
    });
  });
  return counts;
}

function _diagnoseWorkbookCells(ss, includeFormulaReferences, backupReferencesOnly) {
  var allSheets = ss.getSheets();
  var registered = {};
  _readSystemBackupRegistry().forEach(function(item) { registered[item.name] = item; });
  var formulaTargets = allSheets.map(function(sheet) { return String(sheet.getName()); }).filter(function(name) {
    return !backupReferencesOnly || _sheetRole(name) === 'BACKUP';
  });
  var formulaCounts = includeFormulaReferences ? _sheetFormulaReferenceCounts(ss, formulaTargets) : {};
  var sheets = [], totalCells = 0, backupCells = 0, backupUsedCells = 0;
  allSheets.forEach(function(sheet) {
    var name = String(sheet.getName()), maxRows = Number(sheet.getMaxRows()) || 0;
    var maxColumns = Number(sheet.getMaxColumns()) || 0, lastRow = Number(sheet.getLastRow()) || 0;
    var lastColumn = Number(sheet.getLastColumn()) || 0, allocatedCells = maxRows * maxColumns;
    var usedRangeCells = lastRow * lastColumn, role = _sheetRole(name);
    totalCells += allocatedCells;
    if (role === 'BACKUP') { backupCells += allocatedCells; backupUsedCells += usedRangeCells; }
    var backupRecord = registered[name] || null;
    var inferredSource = backupRecord ? backupRecord.source : _backupSourceFromSystemName(name);
    var classification = backupRecord ? (backupRecord.status === 'COMPLETED' ? 'REGISTERED_COMPLETED' :
      (backupRecord.status === 'WRITE_FAILED' ? 'REGISTERED_WRITE_FAILED' : 'REGISTERED_INCOMPLETE')) :
      (role === 'BACKUP' ? (inferredSource ? 'ORPHAN_LIKELY_SYSTEM' : 'USER_MANAGED_BACKUP') : 'UNKNOWN');
    var formulaReferenceCount = includeFormulaReferences && Object.prototype.hasOwnProperty.call(formulaCounts, name) ? formulaCounts[name] : null;
    var registeredSourceExists = !backupRecord || (!!inferredSource && Object.prototype.hasOwnProperty.call(SYSTEM_BACKUP_KEEP_BY_SOURCE, inferredSource) && !!ss.getSheetByName(inferredSource));
    var eligible = classification === 'REGISTERED_COMPLETED' && registeredSourceExists && formulaReferenceCount === 0;
    sheets.push({ name: name, role: role, maxRows: maxRows, maxColumns: maxColumns,
      lastRow: lastRow, lastColumn: lastColumn, allocatedCells: allocatedCells,
      usedRangeCells: usedRangeCells, unusedCells: allocatedCells - usedRangeCells,
      gasReferenced: _isGasReferencedSheet(name), formulaReferenceCount: formulaReferenceCount,
      backup: role === 'BACKUP', legacy: role === 'LEGACY', systemGeneratedBackup: !!registered[name],
      backupSource: inferredSource || '', backupStatus: backupRecord ? backupRecord.status : '', backupClassification: classification,
      createdAt: backupRecord ? backupRecord.createdAt || '' : '', completedAt: backupRecord ? backupRecord.completedAt || '' : '',
      updatedAt: backupRecord ? backupRecord.updatedAt || '' : '', operationId: backupRecord ? backupRecord.operationId || '' : '',
      signatureMatch: backupRecord ? _sheetContentSignature(sheet) === backupRecord.signature : null,
      sourceSheetExists: registeredSourceExists, autoCleanupEligible: eligible, protectionReason: eligible ? '' :
        (!registeredSourceExists ? '원본 source sheet 없음 · backup 보호' : (classification === 'USER_MANAGED_BACKUP' ? '사용자 보관 백업' : '자동 정리 안전성 미확정')) });
  });
  sheets.forEach(function(item) { item.workbookOccupancyPercent = totalCells ? Number((item.allocatedCells * 100 / totalCells).toFixed(4)) : 0; });
  var backupsBySource = {};
  _readSystemBackupRegistry().forEach(function(item) {
    var source = item.source || 'UNKNOWN';
    if (!backupsBySource[source]) backupsBySource[source] = { total: 0, completed: 0, created: 0, writeFailed: 0, orphan: 0, userOrUnknown: 0, autoCleanupEligible: 0, protected: 0, expectedReleasedCells: 0 };
    backupsBySource[source].total++;
    if (item.status === 'COMPLETED') backupsBySource[source].completed++;
    else if (item.status === 'CREATED') backupsBySource[source].created++;
    else if (item.status === 'WRITE_FAILED') backupsBySource[source].writeFailed++;
    else backupsBySource[source].userOrUnknown++;
  });
  sheets.filter(function(item) { return item.backup; }).forEach(function(item) {
    var source = item.backupSource || 'UNKNOWN';
    if (!backupsBySource[source]) backupsBySource[source] = { total: 0, completed: 0, created: 0, writeFailed: 0, orphan: 0, userOrUnknown: 0, autoCleanupEligible: 0, protected: 0, expectedReleasedCells: 0 };
    if (!item.systemGeneratedBackup) { if (item.backupClassification === 'ORPHAN_LIKELY_SYSTEM') backupsBySource[source].orphan++; else backupsBySource[source].userOrUnknown++; }
    if (item.autoCleanupEligible) backupsBySource[source].autoCleanupEligible++;
    else backupsBySource[source].protected++;
  });
  return { generatedAt: new Date().toISOString(), limit: GOOGLE_SHEETS_CELL_LIMIT, totalCells: totalCells,
    remainingCells: Math.max(0, GOOGLE_SHEETS_CELL_LIMIT - totalCells), occupancyPercent: Number((totalCells * 100 / GOOGLE_SHEETS_CELL_LIMIT).toFixed(4)),
    backupSummary: { sheetCount: sheets.filter(function(item) { return item.backup; }).length,
      allocatedCells: backupCells, usedRangeCells: backupUsedCells, reclaimableAfterVerifiedDeletion: backupCells,
      bySource: backupsBySource }, sheets: sheets };
}

function handleDiagnoseWorkbookCells() {
  try { return jsonOk({ workbook: _diagnoseWorkbookCells(getss(), true) }); }
  catch (err) { return jsonError('통합문서 셀 진단 실패: ' + err.message); }
}

// 전체 백업을 한 번에 분류합니다. apply=false 경로는 registry 기록도 바꾸지 않습니다.
function _systemBackupProtectionReason_(item, context) {
  context = context || {};
  if (!context.registeredSourceExists) return '원본 source sheet 없음 · backup 보호';
  if (item.formulaReferenceCount) return '수식 참조 존재';
  if (!context.safeClass) return 'USER_MANAGED/UNKNOWN 보호';
  if (context.registeredFailed) return 'WRITE_FAILED · 복구 검증 없음';
  if (!item.signatureMatch) return item.signatureVersion === SYSTEM_BACKUP_SIGNATURE_VERSION
    ? 'content signature 불일치'
    : 'legacy signature 불일치 · 자동 재서명 금지';
  if (item.classification === 'REGISTERED_INCOMPLETE') {
    return '미완료 registry 상태 · ' + String(item.status || 'UNKNOWN');
  }
  if (item.operationHasCreatedBackup) return '동일 operation에 미완료 CREATED 백업 존재';
  if (item.classification === 'ORPHAN_LIKELY_SYSTEM' && !item.schemaMatch) return 'schema 불일치';
  return '기타 안전 조건 불충족';
}

function _planSystemBackupMaintenance(ss, options) {
  var validatedOperationIds = {}, requestedValidatedIds = options && options.validatedOperationIds;
  (Array.isArray(requestedValidatedIds) ? requestedValidatedIds : []).forEach(function(operationId) { if (operationId) validatedOperationIds[String(operationId)] = true; });
  var before = _diagnoseWorkbookCells(ss, true, true), registry = _readSystemBackupRegistry(), records = {}, sourceHeaders = {};
  registry.forEach(function(item) { records[item.name] = item; });
  var operationsWithCreatedBackup = {};
  registry.forEach(function(item) { if (item.status === 'CREATED' && item.operationId) operationsWithCreatedBackup[item.operationId] = true; });
  var backups = before.sheets.filter(function(item) { return item.backup; }).map(function(item) {
    var record = records[item.name] || null, source = record ? record.source : _backupSourceFromSystemName(item.name);
    var sourceSheet = source ? ss.getSheetByName(source) : null;
    if (sourceSheet && !Object.prototype.hasOwnProperty.call(sourceHeaders, source)) sourceHeaders[source] = _sheetHeaderSignature(sourceSheet);
    var schemaMatch = !!(sourceSheet && _sheetHeaderSignature(ss.getSheetByName(item.name)) === sourceHeaders[source]);
    var namingMatch = !!_backupSourceFromSystemName(item.name);
    // 같은 실행의 진단에서 검증한 결과만 재사용합니다. apply는 lock 획득 후 새로 진단합니다.
    var signatureMatch = record ? !!(record.signature && item.signatureMatch) : !!_sheetContentSignature(ss.getSheetByName(item.name));
    var registeredSystem = !!(record && record.systemGenerated === true && source && Object.prototype.hasOwnProperty.call(SYSTEM_BACKUP_KEEP_BY_SOURCE, source));
    var classification = registeredSystem ? (record.status === 'COMPLETED' ? 'REGISTERED_COMPLETED' : (record.status === 'WRITE_FAILED' ? 'REGISTERED_WRITE_FAILED' : 'REGISTERED_INCOMPLETE')) :
      (namingMatch && source && schemaMatch && item.formulaReferenceCount === 0 && !_isGasReferencedSheet(item.name) ? 'ORPHAN_LIKELY_SYSTEM' : (namingMatch ? 'UNKNOWN' : 'USER_MANAGED'));
    var operationHasCreatedBackup = !!(record && operationsWithCreatedBackup[record.operationId]);
    return { name: item.name, sheetName: item.name, registryRecordExists: !!record, source: source || '', classification: classification,
      status: record ? record.status : '', signatureMatch: signatureMatch, schemaMatch: schemaMatch,
      sourceSheetExists: !!sourceSheet,
      formulaReferenceCount: Number(item.formulaReferenceCount || 0), allocatedCells: item.allocatedCells,
      operationId: record ? record.operationId || '' : '', operationHasCreatedBackup: operationHasCreatedBackup,
      signatureVersion: record ? record.signatureVersion || '' : '', copySignatureDrift: !!(record && record.copySignatureDrift),
      createdAt: record ? record.createdAt || '' : '', completedAt: record ? record.completedAt || '' : '',
      autoCleanupEligible: false, protectionReason: '' };
  });
  var bySource = {};
  backups.forEach(function(item) { if (item.source) (bySource[item.source] || (bySource[item.source] = [])).push(item); });
  var sourceSummary = {};
  Object.keys(bySource).forEach(function(source) {
    var list = bySource[source];
    var trustedV2CompletedAt = list.reduce(function(latest, item) {
      if (item.classification !== 'REGISTERED_COMPLETED' || item.signatureVersion !== SYSTEM_BACKUP_SIGNATURE_VERSION ||
          !item.signatureMatch || !item.schemaMatch || !item.sourceSheetExists || item.formulaReferenceCount !== 0 ||
          item.operationHasCreatedBackup) return latest;
      return Math.max(latest, _backupTimeMillis(item.completedAt || item.createdAt));
    }, 0);
    list.forEach(function(item) {
      var safeClass = ['REGISTERED_COMPLETED', 'REGISTERED_WRITE_FAILED', 'REGISTERED_INCOMPLETE', 'ORPHAN_LIKELY_SYSTEM'].indexOf(item.classification) !== -1;
      var registeredCompleted = item.classification === 'REGISTERED_COMPLETED';
      var registeredFailed = item.classification === 'REGISTERED_WRITE_FAILED';
      var registeredSourceExists = item.classification.indexOf('REGISTERED_') !== 0 || item.sourceSheetExists;
      var itemCompletedAt = _backupTimeMillis(item.completedAt || item.createdAt);
      var legacySupersededByTrustedV2 = !!(registeredCompleted && item.signatureVersion !== SYSTEM_BACKUP_SIGNATURE_VERSION &&
        !!records[item.name] && !!records[item.name].signature && !item.signatureMatch && item.schemaMatch && registeredSourceExists &&
        trustedV2CompletedAt && itemCompletedAt && itemCompletedAt < trustedV2CompletedAt &&
        !item.operationHasCreatedBackup && item.formulaReferenceCount === 0);
      item.legacySupersededByTrustedV2 = legacySupersededByTrustedV2;
      // validated recovery는 전체 Snapshot 복구가 증명한 Snapshot rollback에만 적용합니다.
      // 다른 source의 실패/미완료 CREATED backup까지 광범위하게 정리하지 않습니다.
      var validatedStale = !!validatedOperationIds[item.operationId] && item.source === CONFIG.SHEET_SNAPSHOT &&
        (registeredFailed || (item.classification === 'REGISTERED_INCOMPLETE' && item.status === 'CREATED'));
      item.autoCleanupEligible = !!(safeClass && registeredSourceExists && (item.signatureMatch || legacySupersededByTrustedV2) &&
        (registeredCompleted || validatedStale || (item.classification === 'ORPHAN_LIKELY_SYSTEM' && item.schemaMatch)) &&
        (!item.operationHasCreatedBackup || validatedStale) && item.formulaReferenceCount === 0);
      if (!item.autoCleanupEligible) item.protectionReason = _systemBackupProtectionReason_(item, {
        safeClass: safeClass,
        registeredFailed: registeredFailed,
        registeredSourceExists: registeredSourceExists
      });
    });
    var deletions = list.filter(function(item) { return item.autoCleanupEligible; });
    sourceSummary[source] = { total: list.length, beforeCount: list.length, keepCount: list.length - deletions.length,
      completed: list.filter(function(item) { return item.classification === 'REGISTERED_COMPLETED'; }).length,
      created: list.filter(function(item) { return item.status === 'CREATED'; }).length,
      writeFailedCount: list.filter(function(item) { return item.classification === 'REGISTERED_WRITE_FAILED'; }).length,
      unknownUser: list.filter(function(item) { return item.classification === 'UNKNOWN' || item.classification === 'USER_MANAGED'; }).length,
      deletionCandidates: deletions.map(function(item) { return item.name; }),
      protected: list.filter(function(item) { return !item.autoCleanupEligible; }).map(function(item) { return { name: item.name, reason: item.protectionReason }; }),
      orphan: list.filter(function(item) { return item.classification === 'ORPHAN_LIKELY_SYSTEM'; }).map(function(item) { return item.name; }),
      writeFailed: list.filter(function(item) { return item.classification === 'REGISTERED_WRITE_FAILED'; }).map(function(item) { return item.name; }),
      expectedReleasedCells: deletions.reduce(function(sum, item) { return sum + item.allocatedCells; }, 0) };
  });
  var expectedReleasedCells = backups.filter(function(item) { return item.autoCleanupEligible; }).reduce(function(sum, item) { return sum + item.allocatedCells; }, 0);
  return { generatedAt: new Date().toISOString(), apply: false, backupSheets: backups, bySource: sourceSummary,
    beforeCount: backups.length, totalCellsBefore: before.totalCells, remainingCellsBefore: before.remainingCells,
    expectedReleasedCells: expectedReleasedCells };
}

function maintainSystemBackups(options) {
  var apply = !!(options && options.apply), ss = getss();
  if (!apply) return _planSystemBackupMaintenance(ss, options);
  var lock = LockService.getScriptLock(), ownsLock = false;
  try {
  if (!lock.hasLock()) { lock.waitLock(30000); ownsLock = true; }
  // lock 획득 후 계획을 다시 계산해 생성 중 backup과의 race를 막습니다.
  var plan = _planSystemBackupMaintenance(ss, options);
  var deleted = [], failures = [], releasedCells = 0;
  plan.backupSheets.filter(function(item) { return item.autoCleanupEligible; }).forEach(function(item) {
    try { var sheet = ss.getSheetByName(item.name); if (!sheet) throw new Error('시트를 찾을 수 없습니다.'); ss.deleteSheet(sheet); deleted.push(item.name); releasedCells += item.allocatedCells; }
    catch (error) { failures.push({ name: item.name, message: error.message }); }
  });
  var deletedMap = {}; deleted.forEach(function(name) { deletedMap[name] = true; });
  var missingRegistryRecords = [];
  _writeSystemBackupRegistry(_readSystemBackupRegistry().filter(function(item) {
    if (deletedMap[item.name]) return false;
    if (item.systemGenerated === true && item.source && Object.prototype.hasOwnProperty.call(SYSTEM_BACKUP_KEEP_BY_SOURCE, item.source) && !ss.getSheetByName(item.name)) {
      missingRegistryRecords.push(item.name); return false;
    }
    return true;
  }));
  var after = _diagnoseWorkbookCells(ss, true);
  plan.apply = true; plan.deletedSheetNames = deleted; plan.protectedSheets = plan.backupSheets.filter(function(item) { return !item.autoCleanupEligible; }).map(function(item) { return { name: item.name, reason: item.protectionReason }; });
  plan.releasedCells = releasedCells; plan.failures = failures; plan.afterCount = after.backupSummary.sheetCount;
  plan.removedMissingRegistryRecords = missingRegistryRecords;
  plan.totalCellsAfter = after.totalCells; plan.remainingCellsAfter = after.remainingCells;
  return plan;
  } finally { if (ownsLock) lock.releaseLock(); }
}

function handleMaintainSystemBackups(dataJson) {
  try { return jsonOk({ maintenance: maintainSystemBackups(JSON.parse(dataJson || '{}')) }); }
  catch (error) { return jsonError('시스템 백업 유지보수 실패: ' + error.message); }
}

function _systemBackupProtectionSummaryLines(source, item) {
  var protectedItems = Array.isArray(item && item.protected) ? item.protected : [];
  if (!protectedItems.length) return [];
  var grouped = {};
  protectedItems.forEach(function(entry) {
    var reason = String(entry && entry.reason || '보존 사유 미상');
    if (!grouped[reason]) grouped[reason] = { count: 0, names: [] };
    grouped[reason].count++;
    if (grouped[reason].names.length < 3 && entry && entry.name) grouped[reason].names.push(String(entry.name));
  });
  return Object.keys(grouped).sort(function(a, b) {
    return grouped[b].count - grouped[a].count || a.localeCompare(b);
  }).map(function(reason) {
    var group = grouped[reason];
    var extra = group.count > group.names.length ? ' 외 ' + (group.count - group.names.length) + '개' : '';
    var examples = group.names.length ? ' · 예: ' + group.names.join(', ') + extra : '';
    return '  - ' + reason + ': ' + group.count + '개' + examples;
  });
}

function showSystemBackupDiagnosis() {
  var result = maintainSystemBackups({ apply: false }), lines = [];
  Object.keys(result.bySource).sort().forEach(function(source) {
    var item = result.bySource[source];
    lines.push(source + ': 전체 ' + item.beforeCount + ' / 보존 ' + item.keepCount + ' / 정리 후보 ' + item.deletionCandidates.length + ' / 예상 확보 ' + item.expectedReleasedCells + '셀');
    var protectionLines = _systemBackupProtectionSummaryLines(source, item);
    if (protectionLines.length) {
      lines.push('  보존 사유');
      lines = lines.concat(protectionLines);
    }
  });
  SpreadsheetApp.getUi().alert('백업 진단 (삭제 없음)\n\n현재 백업 ' + result.beforeCount + '개\n전체 셀 ' + result.totalCellsBefore + ' / 잔여 셀 ' + result.remainingCellsBefore + '\n\n' + lines.join('\n'));
}

function applySystemBackupMaintenancePrompt() {
  var ui = SpreadsheetApp.getUi(), dryRun = maintainSystemBackups({ apply: false });
  var candidates = dryRun.backupSheets.filter(function(item) { return item.autoCleanupEligible; });
  if (!candidates.length) { ui.alert('안전하게 정리할 시스템 백업이 없습니다.'); return; }
  if (ui.alert('안전한 시스템 백업 정리', '검증 완료된 시스템 생성 백업 ' + candidates.length + '개를 정리합니다. active/미복구 실패/수식 참조/사용자·UNKNOWN 백업은 보존됩니다. 계속하시겠습니까?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var result = maintainSystemBackups({ apply: true });
  ui.alert('백업 정리 결과\n\n삭제 전/후: ' + result.beforeCount + ' / ' + result.afterCount + '\n삭제: ' + (result.deletedSheetNames.join(', ') || '없음') + '\n보호: ' + result.protectedSheets.map(function(item) { return item.name + '(' + item.reason + ')'; }).join(', ') + '\n확보 셀: ' + result.releasedCells + '\ntotalCells: ' + result.totalCellsBefore + ' → ' + result.totalCellsAfter + '\nremainingCells: ' + result.remainingCellsBefore + ' → ' + result.remainingCellsAfter + '\n실패: ' + (result.failures.map(function(item) { return item.name + ': ' + item.message; }).join(', ') || '없음'));
}

function _sheetContentSignature(sheet) {
  var rows = Number(sheet.getLastRow()) || 0, columns = Number(sheet.getLastColumn()) || 0;
  if (!rows || !columns) return '0x0';
  var range = sheet.getRange(1, 1, rows, columns);
  var payload = JSON.stringify([range.getValues(), typeof range.getFormulas === 'function' ? range.getFormulas() : []]);
  if (typeof Utilities.computeDigest !== 'function') return rows + 'x' + columns + ':' + payload;
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, payload).map(function(byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

// 백업을 외부 통합문서에 복사하고 검증 결과만 반환합니다. 운영 시트 삭제는 의도적으로 제공하지 않습니다.
function handlePrepareBackupCleanup(dataJson) {
  try {
    var request = JSON.parse(dataJson), names = Array.isArray(request.sheetNames) ? request.sheetNames : [];
    var archiveIds = Array.isArray(request.archiveSpreadsheetIds) ? request.archiveSpreadsheetIds.filter(String) : [];
    if (!names.length) throw new Error('정리 후보 백업 시트명을 지정하세요.');
    if (!archiveIds.length) throw new Error('백업용 통합문서 ID를 하나 이상 지정하세요.');
    var source = getss();
    if (archiveIds.some(function(id) { return String(id) === String(source.getId()); })) throw new Error('운영 통합문서는 백업 대상으로 지정할 수 없습니다.');
    var archives = archiveIds.map(function(id) { return SpreadsheetApp.openById(String(id)); });
    var results = [], archiveIndex = 0;
    names.forEach(function(name) {
      var sheet = source.getSheetByName(String(name));
      if (!sheet || _sheetRole(sheet.getName()) !== 'BACKUP') throw new Error('백업 시트가 아닙니다: ' + name);
      var formulaReferences = _sheetFormulaReferenceCount(source, sheet.getName());
      var registryRecord = _readSystemBackupRegistry().find(function(item) { return item.name === sheet.getName(); });
      var sourceSignature = _sheetContentSignature(sheet), requiredCells = sheet.getMaxRows() * sheet.getMaxColumns();
      var target = null;
      for (var checked = 0; checked < archives.length; checked++) {
        var candidate = archives[(archiveIndex + checked) % archives.length];
        if (_fundSheetCapacity(candidate).remainingCells >= requiredCells) { target = candidate; archiveIndex = (archiveIndex + checked + 1) % archives.length; break; }
      }
      if (!target) throw new Error(name + ' 보관에 필요한 ' + requiredCells + '셀을 수용할 백업 통합문서가 없습니다.');
      var archivedName = sheet.getName();
      if (target.getSheetByName(archivedName)) archivedName += '_보관_' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss');
      var copied = sheet.copyTo(target).setName(archivedName);
      var verified = copied.getMaxRows() === sheet.getMaxRows() && copied.getMaxColumns() === sheet.getMaxColumns() &&
        copied.getLastRow() === sheet.getLastRow() && copied.getLastColumn() === sheet.getLastColumn() && _sheetContentSignature(copied) === sourceSignature;
      results.push({ sourceSheet: sheet.getName(), archiveSpreadsheetId: target.getId(), archiveSheet: archivedName,
        allocatedCells: requiredCells, formulaReferenceCount: formulaReferences, gasReferenced: _isGasReferencedSheet(sheet.getName()),
        rollbackApprovalRequired: true, copyVerified: verified,
        deletionCandidate: verified && formulaReferences === 0 && !!registryRecord && registryRecord.status === 'COMPLETED',
        unresolvedReason: !registryRecord ? '생성 주체·원본 관계 미확인' : (registryRecord.status !== 'COMPLETED' ? '정상 완료 미검증: ' + registryRecord.status : (formulaReferences ? '수식 참조 존재' : '')) });
    });
    return jsonOk({ archived: results, deleted: [], approvalRequired: true,
      message: '복사 검증 완료 항목도 운영 통합문서에서는 삭제하지 않았습니다. 롤백 필요성 확인과 사용자 승인이 필요합니다.', workbook: _diagnoseWorkbookCells(source, false) });
  } catch (err) { return jsonError('백업 정리 준비 실패: ' + err.message); }
}

function _ensureFundImportRowCapacity(ss, sheet, appendCount) {
  if (!sheet || appendCount <= 0 || typeof sheet.getMaxRows !== 'function') return;
  var requiredRows = sheet.getLastRow() + appendCount;
  var maxRows = Number(sheet.getMaxRows()) || 0;
  if (requiredRows <= maxRows) return;
  var addRows = requiredRows - maxRows;
  var maxColumns = typeof sheet.getMaxColumns === 'function'
    ? Number(sheet.getMaxColumns()) || Math.max(1, sheet.getLastColumn())
    : Math.max(1, sheet.getLastColumn());
  var capacity = _fundSheetCapacity(ss);
  var requiredCells = addRows * maxColumns;
  if (capacity && capacity.remainingCells < requiredCells) {
    _compactFundImportTargetColumns(ss);
    maxRows = Number(sheet.getMaxRows()) || 0;
    maxColumns = typeof sheet.getMaxColumns === 'function'
      ? Number(sheet.getMaxColumns()) || Math.max(1, sheet.getLastColumn())
      : Math.max(1, sheet.getLastColumn());
    addRows = Math.max(0, requiredRows - maxRows);
    capacity = _fundSheetCapacity(ss);
    requiredCells = addRows * maxColumns;
  }
  if (capacity && capacity.remainingCells < requiredCells) {
    throw new Error('시트 행 확장에 필요한 셀 ' + requiredCells + '개가 남은 셀 ' + capacity.remainingCells + '개를 초과합니다. 이번 단계에서 저장된 행은 없습니다.');
  }
  if (addRows > 0) sheet.insertRowsAfter(maxRows, addRows);
}

function _compactFundImportTargetColumns(ss) {
  if (!ss || typeof ss.getSheetByName !== 'function') return 0;
  var specs = [
    { name: FUND_NAV_SHEET, columns: 9 },
    { name: CONFIG.SHEET_PH, columns: 6 },
    { name: CONFIG.SHEET_SNAPSHOT, columns: 12 }
  ];
  var releasedCells = 0;
  specs.forEach(function(spec) {
    var sheet = ss.getSheetByName(spec.name);
    if (!sheet || typeof sheet.getMaxColumns !== 'function' || typeof sheet.deleteColumns !== 'function') return;
    var maxColumns = Number(sheet.getMaxColumns()) || 0;
    var keepColumns = Math.max(spec.columns, Number(sheet.getLastColumn()) || 0);
    if (maxColumns <= keepColumns) return;
    var removeColumns = maxColumns - keepColumns;
    sheet.deleteColumns(keepColumns + 1, removeColumns);
    releasedCells += removeColumns * (Number(sheet.getMaxRows()) || 0);
  });
  return releasedCells;
}

function _writeFundImportRows(ss, sheet, updates, appends, colCount) {
  var written = { updatedRows: 0, appendedRows: 0 };
  updates = (updates || []).slice().sort(function(a, b) { return a.index - b.index; });
  try {
    for (var offset = 0; offset < updates.length;) {
      var batch = [updates[offset].row], startIndex = updates[offset].index;
      offset++;
      while (offset < updates.length && updates[offset].index === startIndex + batch.length) {
        batch.push(updates[offset].row); offset++;
      }
      sheet.getRange(startIndex + 2, 1, batch.length, colCount).setValues(batch);
      written.updatedRows += batch.length;
    }
    if (appends && appends.length) {
      _ensureFundImportRowCapacity(ss, sheet, appends.length);
      sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, colCount).setValues(appends);
      written.appendedRows += appends.length;
    }
  } catch (err) {
    err.fundWriteResult = written;
    throw err;
  }
  if ((written.updatedRows || written.appendedRows) && _isSnapshotIntegritySourceSheet(sheet.getName())) {
    _touchSnapshotIntegritySourceRevision(_snapshotIntegrityImpactForRows(sheet.getName(), updates.map(function(item) { return item.row; }).concat(appends || [])));
  }
  return written;
}

function _appendFundImportSnapshotRows(ss, sheet, rows) {
  rows = _dedupeSnapshotRows(rows || []);
  if (!rows.length) return 0;
  _ensureFundImportRowCapacity(ss, sheet, rows.length);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 12).setValues(rows);
  _touchSnapshotIntegritySourceRevision(_snapshotIntegrityImpactForRows(CONFIG.SHEET_SNAPSHOT, rows));
  return rows.length;
}

function _upsertFundImportSnapshotRow(ss, sheet, value, fundRow) {
  if (!sheet || sheet.getLastRow() < 2) return _appendFundImportSnapshotRows(ss, sheet, [fundRow]);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(12, sheet.getLastColumn())).getValues();
  var matchIndexes = [];
  for (var i = 0; i < rows.length; i++) {
    if (_normalizeDate(rows[i][0]) !== value.date) continue;
    var rowCode = _cleanCode(rows[i][1]);
    if (rowCode === value.code || (!rowCode && String(rows[i][2]) === value.name)) matchIndexes.push(i);
  }
  var matchIndex = matchIndexes.length ? matchIndexes[0] : -1;
  if (matchIndex === -1) return _appendFundImportSnapshotRows(ss, sheet, [fundRow]);
  if (matchIndexes.length > 1) {
    var expectedRows = _buildSnapshotRowsFromTradeAndPriceHistory(ss, value.date, true);
    var rewritePlan = _snapshotRewritePlan(ss, value.date, expectedRows);
    if (rewritePlan.unsafe.length) throw new Error('펀드 Snapshot 보호 충돌: ' + rewritePlan.unsafe.map(function(item) { return item.classification + ': ' + item.reason; }).join('; '));
    writeSnapshotRows(ss, value.date, expectedRows, true);
    return 1;
  }
  if (String(rows[matchIndex][10] || '').toUpperCase() === 'MANUAL') return 0;
  var existing = rows[matchIndex].slice(0, 12);
  while (existing.length < 12) existing.push('');
  if (JSON.stringify(existing) === JSON.stringify(fundRow)) return 0;
  sheet.getRange(matchIndex + 2, 1, 1, 12).setValues([fundRow]);
  _touchSnapshotIntegritySourceRevision({ date: value.date });
  return 1;
}

function _runFundImportStage(diagnostic, code, stage, functionName, callback) {
  _fundRecoveryDiagnosticStart(diagnostic, code, stage, functionName);
  try {
    var result = callback();
    _fundRecoveryDiagnosticFinish(diagnostic, 'end');
    return result;
  } catch (err) {
    if (diagnostic && err.fundWriteResult) diagnostic.persisted[stage] = err.fundWriteResult;
    // Import 응답/로그에는 실패 단계와 메시지만 남기고 stack 등 환경 정보는 노출하지 않습니다.
    _fundRecoveryDiagnosticFinish(diagnostic, 'error', { message: String(err.message || err) });
    throw err;
  }
}

function _applyFundNavImport(ss, inspected, diagnostic) {
  diagnostic.persisted = { navWrite: { updatedRows: 0, appendedRows: 0 }, priceHistoryWrite: { updatedRows: 0, appendedRows: 0 }, snapshotWrite: { updatedRows: 0, appendedRows: 0 } };
  var capacityBefore = _fundSheetCapacity(ss);
  var configs = _readFundUnits(ss);
  var navSheet = ss.getSheetByName(FUND_NAV_SHEET);
  var stored = navSheet && navSheet.getLastRow() > 1 ? navSheet.getRange(2, 1, navSheet.getLastRow() - 1, 9).getValues() : [];
  var imported = {};
  var changedNav = {};
  inspected.candidates.concat(inspected.updates).concat(inspected.identical).forEach(function(row) { imported[row.date] = row.uploadedNav || row.nav || row.existingNav; });
  inspected.candidates.concat(inspected.updates).forEach(function(row) { changedNav[row.date] = row.uploadedNav || row.nav; });
  var published = {};
  stored.forEach(function(row) {
    if (String(row[1]) !== inspected.code || String(row[8]) !== inspected.spec.provider) return;
    var sourceDate = _normalizeDate(row[4]);
    var nav = Number(row[3]);
    if (sourceDate && nav > 0 && !Object.prototype.hasOwnProperty.call(published, sourceDate)) published[sourceDate] = nav;
  });
  Object.keys(changedNav).forEach(function(date) { published[date] = changedNav[date]; });
  var navRows = Object.keys(published).sort().map(function(date) { return { date: date, nav: published[date] }; });
  var affectedDates = {}, navWriteDates = {};
  var publishedDates = Object.keys(published).sort();
  var derived = _fundDerivedState(ss, configs);
  function impactEnd(date) {
    var nextDate = publishedDates.filter(function(item) { return item > date; })[0] || '';
    return nextDate ? _fundDateOffset(nextDate, -1) : today();
  }
  function includeImpact(date) {
    var end = impactEnd(date);
    affectedDates[date] = true;
    stored.forEach(function(row) {
      if (String(row[1]) !== inspected.code || String(row[8]) !== inspected.spec.provider) return;
      var evaluationDate = _normalizeDate(row[0]);
      if (evaluationDate >= date && evaluationDate <= end) affectedDates[evaluationDate] = true;
    });
    [derived.priceKeys, derived.snapshotKeys].forEach(function(index) {
      Object.keys(index).forEach(function(key) {
        if (key.slice(-inspected.code.length - 1) !== '|' + inspected.code) return;
        var evaluationDate = key.slice(0, 10);
        if (evaluationDate >= date && evaluationDate <= end) affectedDates[evaluationDate] = true;
      });
    });
  }
  function includeNavWriteImpact(date) {
    navWriteDates[date] = true;
    var end = impactEnd(date);
    stored.forEach(function(row) {
      if (String(row[1]) !== inspected.code || String(row[8]) !== inspected.spec.provider) return;
      var evaluationDate = _normalizeDate(row[0]);
      if (evaluationDate >= date && evaluationDate <= end) navWriteDates[evaluationDate] = true;
    });
  }
  // 신규 공시일 삽입과 기존 공시일 정정 모두 해당일부터 다음 공시일 직전까지만 재계산합니다.
  Object.keys(imported).forEach(includeImpact);
  Object.keys(changedNav).forEach(includeNavWriteImpact);
  var affected = Object.keys(affectedDates).sort();
  var ranges = [];
  affected.forEach(function(date) {
    var last = ranges[ranges.length - 1];
    if (last && date === _fundDateOffset(last.to, 1)) last.to = date;
    else ranges.push({ from: date, to: date });
  });
  var daily = [];
  affected.forEach(function(date) { daily = daily.concat(_fundDailyValues(configs, inspected.code, navRows, date, date)); });
  var existingByDate = {};
  stored.forEach(function(row) {
    if (String(row[1]) === inspected.code && String(row[8]) === inspected.spec.provider) existingByDate[_normalizeDate(row[0])] = row;
  });
  daily = daily.map(function(value) {
    value.carried = value.date !== value.sourceDate;
    value.inputRequired = value.carried && _fundNavExpectedPublicationDate(value.date, inspected.code) && !published[value.date];
    return value;
  }).filter(function(value) {
    return _fundValueNeedsProcessing(value, existingByDate[value.date], derived.priceKeys[value.date + '|' + inspected.code], derived.snapshotKeys[value.date + '|' + inspected.code]);
  });
  var existingNavIndexes = {};
  stored.forEach(function(row, index) {
    if (String(row[1]) === inspected.code && String(row[8]) === inspected.spec.provider) existingNavIndexes[_normalizeDate(row[0])] = index;
  });
  var now = new Date().toISOString();
  var navUpdates = [], navAppends = [];
  daily.forEach(function(value) {
    if (!navWriteDates[value.date]) return;
    var replacement = [value.date, value.code, value.name, value.nav, value.sourceDate, value.units, value.evalAmt, now, value.provider];
    if (Object.prototype.hasOwnProperty.call(existingNavIndexes, value.date)) {
      var navIndex = existingNavIndexes[value.date];
      stored[navIndex] = replacement;
      navUpdates.push({ index: navIndex, row: replacement });
    }
    else {
      existingNavIndexes[value.date] = stored.length;
      stored.push(replacement);
      navAppends.push(replacement);
    }
  });
  if (Object.keys(changedNav).length) {
    if (!navSheet) { navSheet = ss.insertSheet(FUND_NAV_SHEET); navSheet.appendRow(['일자','종목코드','종목명','기준가격(1000좌)','가격공시일','좌수','평가금액','조회일시','클래스']); }
    diagnostic.persisted.navWrite = _runFundImportStage(diagnostic, inspected.code, 'navWrite', '_writeFundImportRows', function() {
      return _writeFundImportRows(ss, navSheet, navUpdates, navAppends, 9);
    });
  }

  var ph = ss.getSheetByName(CONFIG.SHEET_PH);
  var prices = ph && ph.getLastRow() > 1 ? ph.getRange(2, 1, ph.getLastRow() - 1, 6).getValues() : [];
  var priceIndexes = {};
  prices.forEach(function(row, index) {
    var rowCode = _cleanCode(row[1]);
    if (rowCode === inspected.code || (!rowCode && daily.some(function(value) { return value.name === String(row[2]); }))) {
      var priceDate = _normalizeDate(row[0]);
      if (!priceIndexes[priceDate]) priceIndexes[priceDate] = [];
      priceIndexes[priceDate].push(index);
    }
  });
  var priceChanges = 0, priceUpdates = [], priceAppends = [];
  daily.forEach(function(value) {
    var replacement = [value.date, value.code, value.name, value.evalAmt, now, 'FUND_NAV'];
    if (Object.prototype.hasOwnProperty.call(priceIndexes, value.date)) {
      priceIndexes[value.date].forEach(function(index) {
        if (String(prices[index][5]).toUpperCase() === 'MANUAL') return;
        if (Number(prices[index][3]) !== value.evalAmt || String(prices[index][5]) !== 'FUND_NAV') {
          prices[index] = replacement.slice();
          priceUpdates.push({ index: index, row: replacement.slice() });
          priceChanges++;
        }
      });
    } else {
      priceIndexes[value.date] = [prices.length];
      prices.push(replacement);
      priceAppends.push(replacement);
      priceChanges++;
    }
  });
  if (priceChanges) {
    if (!ph) { ph = ss.insertSheet(CONFIG.SHEET_PH); ph.appendRow(['날짜','종목코드','종목명','가격','입력일시','가격소스']); }
    diagnostic.persisted.priceHistoryWrite = _runFundImportStage(diagnostic, inspected.code, 'priceHistoryWrite', '_writeFundImportRows', function() {
      return _writeFundImportRows(ss, ph, priceUpdates, priceAppends, 6);
    });
  }

  var tradeSheet = ss.getSheetByName(CONFIG.SHEET_TRADES);
  var trades = tradeSheet && tradeSheet.getLastRow() > 1 ? tradeSheet.getRange(2, 1, tradeSheet.getLastRow() - 1, Math.min(11, tradeSheet.getLastColumn())).getValues() : [];
  var names = {}; configs.forEach(function(config) { names[config.name] = config.code; });
  var snapshotChanges = 0, missingHoldings = [];
  daily.forEach(function(value) {
    var holdings = calcHoldingsAtDate(trades, value.date, names);
    // 수동 NAV import도 자동 갱신과 동일하게 해당 날짜의 0좌 펀드를 보유목록에서 제외합니다.
    _applyFundUnitLifecycleToSnapshotHoldings(holdings, configs, value.date);
    var holding = Object.keys(holdings).map(function(key) { return holdings[key]; }).find(function(item) { return item.code === inspected.code; });
    if (!holding) { missingHoldings.push(value.date + ':' + inspected.code); return; }
    var pnl = value.evalAmt - holding.costAmt;
    var fundRow = [value.date, value.code, value.name, 1, holding.costAmt, holding.costAmt, value.evalAmt, value.evalAmt, pnl, holding.costAmt > 0 ? Math.round(pnl / holding.costAmt * 10000) / 100 : 0, 'FUND_NAV', now];

    var rawExisting = _readSnapshotRowsByDate(ss, value.date);
    var existing = _filterSnapshotRowsByFundLifecycle(rawExisting, configs, value.date);
    var rebuilt = _buildSnapshotRowsFromTradeAndPriceHistory(ss, value.date, true);
    var combined = _mergeSnapshotRowsSafely(rebuilt, [fundRow], true);
    combined = _mergeSnapshotRowsSafely(existing, combined, true);

    var complete = Object.keys(holdings).every(function(key) {
      var item = holdings[key];
      return combined.some(function(row) { return (item.code && row[1] === item.code) || row[2] === item.name; });
    });
    if (!complete || !combined.length) {
      missingHoldings.push(value.date + ':다른 보유종목의 평가자료 부족');
      return;
    }

    var rewritePlan = _snapshotRewritePlan(ss, value.date, combined, configs);
    if (rewritePlan.unsafe.length) {
      missingHoldings.push(value.date + ':Snapshot 보호 충돌: ' + rewritePlan.unsafe.map(function(item) { return item.classification + ': ' + item.reason; }).join('; '));
      return;
    }
    if (!rewritePlan.needsRewrite) return;

    _runFundImportStage(diagnostic, inspected.code, 'snapshotWrite', 'writeSnapshotRows', function() {
      writeSnapshotRows(ss, value.date, combined, true, null, configs);
      return 1;
    });
    snapshotChanges++;
    if (rawExisting.length) diagnostic.persisted.snapshotWrite.updatedRows++;
    else diagnostic.persisted.snapshotWrite.appendedRows++;
  });
  return {
    from: daily.length ? daily[0].date : '', to: daily.length ? daily[daily.length - 1].date : '',
    processed: daily.length, total: Object.keys(imported).length,
    currentDate: daily.length ? daily[daily.length - 1].date : '', navCount: Object.keys(imported).length,
    valuations: daily.length, prices: priceChanges, snapshots: snapshotChanges,
    processing: {
      nav: { processed: daily.length, pending: Math.max(0, Object.keys(imported).length - daily.length) },
      priceHistory: { processed: daily.length, pending: 0 },
      snapshots: { processed: snapshotChanges, pending: Math.max(0, daily.length - snapshotChanges), reasons: missingHoldings.slice() }
    },
    errorCount: missingHoldings.length, missingHoldings: missingHoldings, ranges: ranges,
    persisted: diagnostic.persisted,
    capacity: { before: capacityBefore, after: _fundSheetCapacity(ss) }
  };
}

function handleImportFundNav(dataJson) {
  var lock = LockService.getScriptLock();
  var diagnostic = null, inspected = null;
  try {
    lock.waitLock(30000);
    var ss = getss();
    inspected = _inspectFundNavImport(ss, dataJson);
    diagnostic = _createFundRecoveryDiagnostic(true, inspected.firstDate || '', inspected.lastDate || '', inspected.code);
    if (inspected.errors.length) throw new Error('오류 행 ' + inspected.errors.length + '건을 먼저 수정하세요.');
    if (inspected.warnings.length && !JSON.parse(dataJson).ackWarnings) throw new Error('WARNING ' + inspected.warnings.length + '건을 확인한 후 반영하세요.');
    if (!inspected.candidates.length && !inspected.updates.length && !inspected.identical.length) return jsonOk({ importResult: inspected, evaluation: { from: '', to: '', prices: 0, snapshots: 0, missingHoldings: [], ranges: [] } });
    var evaluation = _applyFundNavImport(ss, inspected, diagnostic);
    inspected.saved = inspected.candidates.length;
    inspected.updated = inspected.updates.length;
    return jsonOk({ saveState: 'success', importResult: inspected, evaluation: evaluation, persisted: evaluation.persisted, diagnostic: diagnostic });
  } catch (err) {
    var persisted = diagnostic && diagnostic.persisted ? diagnostic.persisted : { navWrite: { updatedRows: 0, appendedRows: 0 }, priceHistoryWrite: { updatedRows: 0, appendedRows: 0 }, snapshotWrite: { updatedRows: 0, appendedRows: 0 } };
    var writtenRows = Object.keys(persisted).reduce(function(total, stage) {
      return total + Number(persisted[stage].updatedRows || 0) + Number(persisted[stage].appendedRows || 0);
    }, 0);
    var saveState = writtenRows > 0 ? 'partial' : 'failed';
    var prefix = saveState === 'partial' ? 'NAV import 일부 저장 후 실패' : 'NAV import 저장 실패';
    return jsonError(prefix + ': ' + err.message, {
      saveState: saveState,
      importResult: inspected ? {
        code: inspected.code, fundName: inspected.fundName, firstDate: inspected.firstDate, lastDate: inspected.lastDate,
        requestedNew: inspected.candidates.length, requestedUpdates: inspected.updates.length,
        identicalCount: inspected.identical.length, duplicateCount: inspected.duplicates.length
      } : null,
      persisted: persisted,
      diagnostic: diagnostic
    });
  }
  finally { lock.releaseLock(); }
}

function _compactFundDailyResultForProperty(result, fallbackDate) {
  result = result || {};
  var compactFunds = {};
  Object.keys(result.fundResults || {}).sort().forEach(function(code) {
    var fund = result.fundResults[code] || {};
    compactFunds[code] = {
      status: fund.status || '',
      storedNav: Number(fund.storedNav || 0),
      apiRequested: Number(fund.apiRequested || 0),
      apiSuccess: Number(fund.apiSuccess || 0),
      apiFailed: Number(fund.apiFailed || 0),
      navMissing: Number(fund.navMissing || 0),
      latestUnpublished: Number(fund.latestUnpublished || 0),
      carried: Number(fund.carried || 0),
      zeroUnitsExcluded: Number(fund.zeroUnitsExcluded || 0),
      inputRequiredCount: Array.isArray(fund.inputRequiredDates) ? fund.inputRequiredDates.length : 0,
      snapshots: Number(fund.snapshots || 0)
    };
  });
  return {
    completionStatus: result.completionStatus || '',
    saved: Number(result.saved || 0),
    navSaved: Number(result.navSaved || 0),
    snapshots: Number(result.snapshots || 0),
    lastDate: result.lastDate || _normalizeDate(fallbackDate || '') || '',
    missingHoldingsCount: Array.isArray(result.missingHoldings) ? result.missingHoldings.length : 0,
    snapshotWarningCount: Array.isArray(result.snapshotWarnings) ? result.snapshotWarnings.length : 0,
    funds: compactFunds
  };
}

function _fundPropertyText(value, maxChars) {
  var text = String(value == null ? '' : value);
  maxChars = Math.max(100, Number(maxChars || 1000));
  return text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
}

function runDailyFundValuations() {
  var props = PropertiesService.getScriptProperties();
  try {
    // 공시 지연·휴일 이월을 회복하기 위해 최근 한 달의 누락만 매일 확인합니다.
    var runDate = today();
    var result = _refreshFundValuations(getss(), _fundDateOffset(runDate, -31), runDate);
    // Script Properties는 값당 크기 제한이 있으므로 날짜별 상세 배열을 제외한 운영 상태만 저장합니다.
    // 변경할 행이 없는 정상 재실행도 runDate를 최근 처리 기준일로 남깁니다.
    props.setProperty('fund_last_result', JSON.stringify(_compactFundDailyResultForProperty(result, runDate)));
    var snapshotWarnings = Array.isArray(result.snapshotWarnings) ? result.snapshotWarnings : [];
    var hardMissingHoldings = (result.missingHoldings || []).filter(function(reason) {
      return snapshotWarnings.indexOf(reason) === -1;
    });
    if (hardMissingHoldings.length) throw new Error('펀드 가격 저장됨, 거래이력 없는 스냅샷 ' + hardMissingHoldings.length + '건');
    var hardErrors = Object.keys(result.fundResults || {}).filter(function(code) {
      return result.fundResults[code] && result.fundResults[code].status === 'error';
    });
    if (hardErrors.length) throw new Error('펀드 평가 오류: ' + hardErrors.join(','));
    var warnings = [];
    if (snapshotWarnings.length) warnings.push('Snapshot 보호 충돌 ' + snapshotWarnings.length + '건');
    Object.keys(result.fundResults || {}).forEach(function(code) {
      var fund = result.fundResults[code];
      if (!fund || fund.status === 'ok') return;
      warnings.push(code + ' ' + ((fund.inputRequiredDates || []).length ? 'NAV 미확보 ' + fund.inputRequiredDates.length + '일' : '부분 완료'));
    });
    if (warnings.length) props.setProperty('fund_last_warning', _fundPropertyText(warnings.join(' | '), 2000));
    else props.deleteProperty('fund_last_warning');
    props.deleteProperty('fund_last_error');
    return result;
  } catch (err) {
    props.setProperty('fund_last_error', _fundPropertyText(err && err.message ? err.message : err, 2000));
    throw err;
  }
}

function handleSaveManualPrice(dateStr, name, priceStr, keepLatestParam) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    if (!dateStr || !name || !priceStr) return jsonError('date, name, price 필요');
    var price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) return jsonError('유효하지 않은 가격: ' + priceStr);
    var ss = getss();

    // ★ 버그수정: name 파라미터가 종목코드 형식이면
    //   code 자리에 넣고 name은 종목코드 시트에서 찾아서 저장
    //   (프론트 applyPrices에서 코드 있는 종목은 key=code로 넘기기 때문)
    // ★ 영문+숫자 혼합 코드(0046Y0, 0080G0, F00001 등)도 코드로 인식
    var isCodeLike = /^[A-Z0-9]{5,8}$/.test((name || '').trim().toUpperCase()) &&
                    !/^[가-힣a-z\s]+$/.test((name || '').trim());
    var saveCode, saveName;
    if (isCodeLike) {
      saveCode = name.trim();
      // ★ 종목명: 종목코드 시트 → 설정 시트 EDITABLE_PRICES 순으로 찾기
      // 펀드·TDF는 종목코드 시트에 없고 설정에만 있으므로 두 곳 모두 확인
      var codeItems = getCodeItems(ss);
      saveName = '';
      for (var ci = 0; ci < codeItems.length; ci++) {
        if (codeItems[ci].code === saveCode) { saveName = codeItems[ci].name; break; }
      }
      if (!saveName) {
        // 종목코드 시트에 없으면 설정 시트 EDITABLE_PRICES에서 찾기
        try {
          var settingsMap = _readSettingsMap();
          var epList = settingsMap.EDITABLE_PRICES;
          if (Array.isArray(epList)) {
            for (var ei = 0; ei < epList.length; ei++) {
              var epCode = epList[ei].code ? epList[ei].code.toString().trim().toUpperCase() : '';
              if (epCode === saveCode.toUpperCase()) { saveName = epList[ei].name || ''; break; }
            }
          }
        } catch(e) { /* 찾기 실패해도 빈 문자열로 진행 */ }
      }
    } else {
      saveCode = '';
      saveName = name;
    }

    var savedAt = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    upsertPriceHistory(ss, dateStr, saveCode, saveName, price, savedAt, 'MANUAL');

    // 과거 스냅샷 재현을 위해 날짜별 수동가격은 항상 보존합니다.
    // 기존 manual_keep_latest 속성이 켜져 있어도 더 이상 과거 행을 삭제하지 않습니다.
    var keepLatest = false;
    var pruned = 0;

    // ★ 수동 현재가 저장 직후, 해당 기준일 스냅샷도 즉시 재작성
    //   → 다른 기기에서도 동일 평가단가/평가금액이 보이도록 맞춤
    var snapshotWarning = _rebuildSnapshotForDateFromHistory(ss, dateStr, saveCode, saveName) || '';

    return jsonOk({ saved: true, date: dateStr, name: name, price: price, keepLatest: keepLatest, pruned: pruned, snapshotWarning: snapshotWarning });
  } catch(err) {
    return jsonError('saveManualPrice 실패: ' + err.message);
  } finally {
    lock.releaseLock();
  }
}

// ════════════════════════════════════════════════════════════════════
//  배치 수동가격 저장 — 건당 GAS 왕복 → 1회 일괄 처리
//  요청: { date, data: JSON.stringify([{key, price}, ...]) }
//  효과: 종목 N개 → GAS 왕복 1회 + 스냅샷 재작성 1회
// ════════════════════════════════════════════════════════════════════
function handleBatchSaveManualPrices(dateStr, dataJson) {
  var lock = LockService.getScriptLock();
  var snapshotWarning = '';
  try {
    lock.waitLock(30000);
    if (!dateStr || !dataJson) return jsonError('date, data 필요');
    var items;
    try { items = JSON.parse(dataJson); } catch(e) { return jsonError('data JSON 파싱 실패: ' + e.message); }
    if (!Array.isArray(items) || items.length === 0) return jsonError('items 배열 필요');

    var ss      = getss();
    var savedAt = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    var keepLatest = false;

    // ── Step 1: 전체 종목 일괄 upsert (batchUpsertPriceHistory 재사용)
    // 코드→종목명 매핑은 한 번만 읽는다. 기존처럼 map() 내부에서 getCodeItems()를 반복 호출하면
    // 수동 입력 종목 수만큼 시트 read가 발생해 저장 시간이 길어진다.
    var codeNameMap = {};
    getCodeItems(ss).forEach(function(codeItem) {
      if (codeItem.code && codeItem.name) codeNameMap[codeItem.code] = codeItem.name;
    });

    var batchItems = items.map(function(item) {
      var rawKey = (item.key || '').toString().trim();
      // key가 코드 형식이면 code로, 아니면 name으로
      var isCodeLike = /^[A-Z0-9]{5,8}$/.test(rawKey.toUpperCase()) && !/^[가-힣a-z\s]+$/.test(rawKey);
      var saveCode = isCodeLike ? rawKey : '';
      var saveName = isCodeLike ? (codeNameMap[rawKey] || '') : rawKey;
      return {
        code:    saveCode,
        name:    saveName,
        price:   parseFloat(item.price) || 0,
        savedAt: savedAt,
        source:  'MANUAL',
      };
    }).filter(function(i) { return i.price > 0 && (i.code || i.name); });

    if (batchItems.length === 0) return jsonError('유효한 가격 데이터 없음');

    batchUpsertPriceHistory(ss, dateStr, batchItems);

    // ── Step 2: 스냅샷 재작성 — 모든 종목 저장 완료 후 1회만 실행
    try {
      var normDate   = _normalizeDate(dateStr);
      if (normDate) {
        var expectedRows = _buildSnapshotRowsFromTradeAndPriceHistory(ss, normDate, true);
        var rewritePlan = _snapshotRewritePlan(ss, normDate, expectedRows);
        if (rewritePlan.unsafe.length) {
          snapshotWarning = rewritePlan.unsafe.map(function(item) { return item.classification + ': ' + item.reason; }).join('; ');
        } else if (rewritePlan.needsRewrite) {
          writeSnapshotRows(ss, normDate, expectedRows, true, batchItems.map(function(item) { return item.code || item.name; }));
        }
      }
    } catch(snapErr) {
      snapshotWarning = String(snapErr.message || snapErr);
      Logger.log('⚠️ 배치저장 후 스냅샷 재작성 실패: ' + snapErr.message);
    }

    return jsonOk({ saved: batchItems.length, date: dateStr, keepLatest: keepLatest, snapshotWarning: snapshotWarning });
  } catch(err) {
    return jsonError('batchSaveManualPrices 실패: ' + err.message);
  } finally {
    lock.releaseLock();
  }
}

function _rebuildSnapshotForDateFromHistory(ss, dateStr, targetCode, targetName) {
  try {
    var normDate = _normalizeDate(dateStr);
    if (!normDate) return;
    var expectedRows = _buildSnapshotRowsFromTradeAndPriceHistory(ss, normDate, true);
    var rewritePlan = _snapshotRewritePlan(ss, normDate, expectedRows);
    if (rewritePlan.unsafe.length) return rewritePlan.unsafe.map(function(item) { return item.classification + ': ' + item.reason; }).join('; ');
    if (rewritePlan.needsRewrite) {
      writeSnapshotRows(ss, normDate, expectedRows, true, [targetCode || targetName]);
    }
  } catch (e) {
    Logger.log('⚠️ 수동저장 후 스냅샷 재작성 실패(' + dateStr + '): ' + e.message);
    return String(e.message || e);
  }
}

// 원자료만 읽어 대상 날짜의 Snapshot을 재생성합니다. 기존 Snapshot은 비교용으로만 읽습니다.
function rebuildDailySnapshots(fromStr, toStr) {
  var lock = LockService.getScriptLock(), ownsLock = false;
  try { if (!lock.hasLock()) { lock.waitLock(30000); ownsLock = true; } return _rebuildDailySnapshotsLocked(fromStr, toStr); }
  finally { if (ownsLock) lock.releaseLock(); }
}

function _rebuildDailySnapshotsLocked(fromStr, toStr) {
  var ss = getss();
  var fromDate = _normalizeDate(fromStr || '') || '1900-01-01';
  var toDate = _normalizeDate(toStr || '') || today();
  if (fromDate > toDate) { var swap = fromDate; fromDate = toDate; toDate = swap; }
  var dates = _collectDailySnapshotDates(ss, fromDate, toDate);
  var rebuilt = 0, unchanged = 0, empty = 0, skipped = 0, changes = [], errors = [];
  var previousOperationId = _snapshotBackupOperationId;
  var rebuildOperationId = 'rebuildDailySnapshots|' + fromDate + '|' + toDate + '|' + Utilities.getUuid();
  _snapshotBackupOperationId = rebuildOperationId;
  var rebuildFundConfigs = _readFundUnits(ss);
  try { Object.keys(dates).sort().forEach(function(date) {
    try {
      var rows = _buildSnapshotRowsFromTradeAndPriceHistory(ss, date, true);
      var existing = _readSnapshotRowsByDate(ss, date);
      var rewritePlan = _snapshotRewritePlan(ss, date, rows, rebuildFundConfigs);
      if (!rows.length) {
        // 기대 결과가 비어도 기존 원장에 0좌 펀드가 남아 있으면 lifecycle 제거 자체는 수행합니다.
        // 이때 다른 기존 행은 rewritePlan.raw로 보존하여 source 부족으로 전체 날짜를 지우지 않습니다.
        if (rewritePlan.lifecycleRemovedRows > 0 && !rewritePlan.unsafe.length) {
          writeSnapshotRows(ss, date, rewritePlan.raw, true, null, rebuildFundConfigs);
          rebuilt++;
          if (changes.length < 20) changes.push({ date: date, beforeRows: existing.length, afterRows: rewritePlan.raw.length, lifecycleRemovedRows: rewritePlan.lifecycleRemovedRows });
        } else empty++;
        return;
      }
      if (rewritePlan.unsafe.length) {
        skipped++;
        if (errors.length < 20) errors.push({ date: date, message: rewritePlan.unsafe.map(function(item) { return item.classification + ': ' + item.reason; }).join('; ') });
      } else if (!rewritePlan.needsRewrite) unchanged++;
      else {
        writeSnapshotRows(ss, date, rows, true, null, rebuildFundConfigs);
        rebuilt++;
        if (changes.length < 20) changes.push({ date: date, beforeRows: existing.length, afterRows: rows.length });
      }
    } catch (error) {
      // 원자료 부족/과거 환율 부재는 해당 날짜만 건너뛰고 기존 Snapshot을 그대로 보존합니다.
      skipped++;
      if (errors.length < 20) errors.push({ date: date, message: String(error.message || error) });
    }
  });
  var backupCleanup = errors.length ? _settleSnapshotBackupOperation(ss, rebuildOperationId, false, errors[0].message) : _settleSnapshotBackupOperation(ss, rebuildOperationId, true);
  return { ok: true, from: fromDate, to: toDate, candidateDates: Object.keys(dates).sort().length,
    rebuilt: rebuilt, unchanged: unchanged, empty: empty, skipped: skipped, changes: changes, errors: errors, backupCleanup: backupCleanup };
  } catch (operationError) {
    _settleSnapshotBackupOperation(ss, rebuildOperationId, false, operationError.message);
    throw operationError;
  } finally { _snapshotBackupOperationId = previousOperationId; }
}

function _collectDailySnapshotDates(ss, fromDate, toDate) {
  var dates = {};
  var add = function(value) {
    var date = _normalizeDate(value);
    if (date && date >= fromDate && date <= toDate && date < today()) dates[date] = true;
  };
  var addSheetDates = function(sheetName, indexes) {
    var sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) return;
    var width = Math.min(Math.max.apply(null, indexes) + 1, sh.getLastColumn());
    sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues().forEach(function(row) {
      indexes.forEach(function(index) { if (index < row.length) add(row[index]); });
    });
  };
  addSheetDates(CONFIG.SHEET_PH, [0]);
  // 기존 행이 있어도 과거 거래/NAV 변경이 반영되지 않은 B·C 유형을 비교 대상으로 포함합니다.
  addSheetDates(CONFIG.SHEET_SNAPSHOT, [0]);
  addSheetDates(FUND_NAV_SHEET, [0, 4]);
  addSheetDates(CONFIG.SHEET_ETF_DIVIDENDS, [3, 4]);
  addSheetDates('환율이력', [0]);
  var tradeSh = ss.getSheetByName(CONFIG.SHEET_TRADES);
  if (tradeSh && tradeSh.getLastRow() > 1) {
    tradeSh.getRange(2, 1, tradeSh.getLastRow() - 1, 1).getValues().forEach(function(row) { add(row[0]); });
  }
  var settings = _readSettingsMap(ss);
  var divData = settings && settings.DIVDATA && typeof settings.DIVDATA === 'object' ? settings.DIVDATA : {};
  Object.keys(divData).forEach(function(code) {
    (Array.isArray(divData[code] && divData[code].events) ? divData[code].events : []).forEach(function(event) {
      add(event && event.date); add(event && event.payDate);
    });
  });
  // 원자료 범위의 평일을 후보로 추가하여 거래소 휴장일도 직전 확정 종가를 이월할 수 있게 합니다.
  var sourceDates = Object.keys(dates).sort();
  if (sourceDates.length) {
    var cursor = fromDate > sourceDates[0] ? fromDate : sourceDates[0];
    var end = toDate < today() ? toDate : _dateOffset(today(), -1);
    while (cursor <= end) {
      var day = new Date(cursor + 'T00:00:00Z').getUTCDay();
      if (day !== 0 && day !== 6) dates[cursor] = true;
      cursor = _dateOffset(cursor, 1);
    }
  }
  return dates;
}

function _dateOffset(dateStr, days) {
  var date = new Date(_normalizeDate(dateStr) + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function _buildSnapshotRowsFromTradeAndPriceHistory(ss, dateStr, throwOnError) {
  throwOnError = throwOnError !== false;
  var out = [];
  try {
    var tradeSh = ss.getSheetByName(CONFIG.SHEET_TRADES);
    if (!tradeSh || tradeSh.getLastRow() < 2) return out;
    var tradeData = tradeSh.getRange(2, 1, tradeSh.getLastRow() - 1, Math.min(11, tradeSh.getLastColumn())).getValues();

    var nameToCode = {};
    var codeItems = getCodeItems(ss, throwOnError);
    codeItems.forEach(function(item){ if (item.name && item.code) nameToCode[item.name] = item.code; });
    tradeData.forEach(function(row) {
      var name = (row[3] || '').toString().trim();
      var code = _cleanCode(row[4]) || (row[4] || '').toString().trim();
      if (name && code && !nameToCode[name]) nameToCode[name] = code;
    });

    var displayByCode = {};
    codeItems.forEach(function(item) {
      if (item.code && item.name) displayByCode[_cleanCode(item.code)] = item.name;
    });
    // 일일 종가 수집과 같은 코드 기준으로 매수·매도·분할을 집계합니다.
    var holdAtDate = _calcCodeHoldingsAtDate(tradeData, dateStr, nameToCode, displayByCode);
    _applyFundUnitLifecycleToSnapshotHoldings(holdAtDate, _readFundUnits(ss), dateStr);
    var prices = getPriceHistoryRow(ss, dateStr, throwOnError);
    // ★ sourceMap 이제 { src, savedAt } 객체 반환
    var sourceMap = _getPriceSourceByDate(ss, dateStr, throwOnError);
    Object.keys(holdAtDate).forEach(function(k) {
      var holding = holdAtDate[k];
      var fundCode = _cleanCode(holding && holding.code) || (holding && holding.code || '');
      if (!_isFundCode(fundCode)) return;
      var fundValue = _getFundEvaluationAtDate(ss, fundCode, dateStr);
      if (fundValue && fundValue.evalAmt > 0) {
        prices[fundCode] = fundValue.evalAmt;
        sourceMap[fundCode] = { src: fundValue.carried ? 'FUND_NAV_CARRY@' + fundValue.sourceDate : 'FUND_NAV', savedAt: '', sourceDate: fundValue.sourceDate };
      }
    });

    // ★ 해당 날짜 가격이 없으면 직전 가격을 우선 사용합니다. 직전 이력도 없는
    // 최초 구간만 가장 가까운 이후 가격을 사용해 빈 가격을 매입원가로 오인하지 않습니다.
    //   KRX fallback으로 전일 날짜에 저장된 경우 오늘 prices 맵에 없어
    //   evalAmt = h.costAmt(매수원금)으로 잘못 계산되는 문제 방지
    var missingCodes = [];
    Object.keys(holdAtDate).forEach(function(k) {
      var h = holdAtDate[k];
      if (!h || h.qty <= 0) return;
      var key = _cleanCode(h.code) || h.code || h.name;
      if (!prices[key]) missingCodes.push(key);
    });
    if (missingCodes.length > 0) {
      var latestEntries = getLatestPriceHistoryEntries(ss, missingCodes, dateStr, throwOnError);
      Object.keys(latestEntries).forEach(function(k) {
        var entry = latestEntries[k];
        if (!prices[k] && entry.price > 0) prices[k] = entry.price;
        if (!sourceMap[k]) sourceMap[k] = { src: (entry.source || 'PRICE_HISTORY') + (entry.date < dateStr ? '_CARRY@' + entry.date : ''), savedAt: entry.savedAt || '', sourceDate: entry.date };
      });
      var stillMissingCodes = missingCodes.filter(function(k) { return !(prices[k] > 0); });
      if (stillMissingCodes.length > 0 && !throwOnError) {
        var nearestFuturePrices = getEarliestPriceHistory(ss, stillMissingCodes, dateStr, throwOnError);
        Object.keys(nearestFuturePrices).forEach(function(k) {
          if (!prices[k] && nearestFuturePrices[k] > 0) prices[k] = nearestFuturePrices[k];
        });
      }
    }

    // ★ 종목코드→통화 맵 (종목코드 시트에서 currency 컬럼 읽기)
    var codeToCurrency = {};
    codeItems.forEach(function(item) {
      var code = _cleanCode(item.code) || (item.code || '').toString().trim();
      var cur = (item.currency || '').toString().trim().toUpperCase();
      if (code && cur && cur !== 'KRW') codeToCurrency[code] = cur;
    });

    // 실제 보유 종목에 필요한 외화만 조회합니다. 국내 종목만 있으면 환율용
    // GOOGLEFINANCE 임시 시트를 만들지 않습니다.
    var neededCurrencies = [];
    Object.keys(holdAtDate).forEach(function(k) {
      var holding = holdAtDate[k];
      var holdingCode = _cleanCode(holding && holding.code) || (holding && holding.code || '').toString().trim();
      var currency = holdingCode && codeToCurrency[holdingCode] ? codeToCurrency[holdingCode] : 'KRW';
      if (currency !== 'KRW' && neededCurrencies.indexOf(currency) === -1) neededCurrencies.push(currency);
    });
    var fxRates = _getHistoricalExchangeRates(ss, neededCurrencies, dateStr);
    if (throwOnError) {
      var invalid = [];
      Object.keys(holdAtDate).forEach(function(k) {
        var holding = holdAtDate[k];
        var code = _cleanCode(holding && holding.code) || (holding && holding.code || '');
        var currency = code && codeToCurrency[code] ? codeToCurrency[code] : 'KRW';
        if (!(prices[code] > 0)) invalid.push(code || k + ':PRICE');
        else if (currency !== 'KRW' && !(fxRates[currency] > 0)) invalid.push(code + ':FX_' + currency);
      });
      if (invalid.some(function(value) { return String(value).indexOf(':FX_') !== -1; })) {
        throw new Error('확정 원자료 부족으로 기존 Snapshot 보존: ' + invalid.slice(0, 10).join(', '));
      }
      if (invalid.length) return [];
    }

    Object.keys(holdAtDate).forEach(function(k) {
      var h = holdAtDate[k];
      if (!h || h.qty <= 0) return;
      var code = _cleanCode(h.code) || (h.code || '').toString().trim();
      var name = (h.name || '').toString().trim();
      var key = code || name;
      var price = key && prices[key] ? prices[key] : 0;
      // F코드의 가격이력은 NAV 단가가 아니라 전체 좌수의 평가금액입니다.
      if (/^F\d{5}$/.test(code)) h.qty = 1;
      // ★ [환율 연동] 외화 종목이면 원화로 환산
      var currency = (code && codeToCurrency[code]) ? codeToCurrency[code] : 'KRW';
      if (throwOnError && !(price > 0)) throw new Error('확정 평가자료 부족: ' + (code || name));
      var fxRate   = (currency !== 'KRW' && fxRates[currency] > 0) ? fxRates[currency] : 1;
      var priceKrw = price > 0 ? Math.round(price * fxRate) : 0;
      var evalAmt  = priceKrw > 0 ? Math.round(priceKrw * h.qty) : h.costAmt;
      var pnl = evalAmt - h.costAmt;
      var pct = h.costAmt > 0 ? parseFloat(((pnl / h.costAmt) * 100).toFixed(2)) : 0;
      var costUnit = h.qty > 0 ? parseFloat((h.costAmt / h.qty).toFixed(2)) : 0;
      var evalUnit = h.qty > 0 ? parseFloat((evalAmt / h.qty).toFixed(2)) : 0;
      // ★ sourceMap[key] 는 { src, savedAt } 객체
      var srcObj = (key && sourceMap[key]) ? sourceMap[key] : null;
      var src = srcObj ? srcObj.src : (price > 0 ? 'PRICE_HISTORY' : 'COST_FALLBACK');
      // ★ MANUAL인 경우에만 savedAt 저장, 그 외 빈 문자열
      var savedAt = (srcObj && srcObj.src === 'MANUAL' && srcObj.savedAt) ? srcObj.savedAt : '';
      // 콸럼: 날짜, 코드, 명, 수량, 매수단가, 매수원금, 평가단가, 평가금액, 손익, 수익률, 소스, 저장일시
      out.push([dateStr, code, name, h.qty, costUnit, h.costAmt, evalUnit, evalAmt, pnl, pct, src, savedAt]);
    });
  } catch (e) {
    Logger.log('\u26a0\ufe0f \uc2a4\ub0c5\uc0f7 \uc7ac\uacc4\uc0f0\uc6a9 \ub370\uc774\ud130 \uc0dd\uc131 \uc2e4\ud328(' + dateStr + '): ' + e.message);
    if (throwOnError) throw e;
  }
  return _dedupeSnapshotRows(out);
}

function _fundNavEvaluationFromRows(rows, configs, code, dateStr) {
  var active = _fundUnitsAtDate(configs || [], code, dateStr);
  if (!active || !(Number(active.units) > 0)) return null;
  var best = null, seenBySourceDate = {};
  (rows || []).forEach(function(row) {
    var valueDate = _normalizeDate(row[0]), sourceDate = _normalizeDate(row[4]);
    var nav = Number(row[3]), provider = String(row[8] || '');
    if ((_cleanCode(row[1]) || String(row[1] || '').trim()) !== code ||
        !valueDate || valueDate > dateStr || !sourceDate || sourceDate > dateStr ||
        sourceDate > valueDate || !(nav > 0) || (provider && provider !== active.provider)) return;
    if (seenBySourceDate[sourceDate] && seenBySourceDate[sourceDate] !== nav) {
      throw new Error('펀드 확정 NAV 충돌: ' + code + ' ' + sourceDate);
    }
    seenBySourceDate[sourceDate] = nav;
    if (!best || sourceDate > best.sourceDate ||
        (sourceDate === best.sourceDate && valueDate > best.valueDate)) {
      best = { nav: nav, sourceDate: sourceDate, valueDate: valueDate };
    }
  });
  if (!best) return null;
  var evalAmt = Math.round(best.nav * Number(active.units) / 1000);
  if (!Number.isSafeInteger(evalAmt) || evalAmt < 0) throw new Error('펀드 평가금액 계산 범위 초과: ' + code);
  return { evalAmt: evalAmt, nav: best.nav, units: Number(active.units), sourceDate: best.sourceDate,
    valueDate: best.valueDate, carried: best.sourceDate < dateStr };
}

function _getFundEvaluationAtDate(ss, code, dateStr) {
  var sh = ss.getSheetByName(FUND_NAV_SHEET);
  if (!sh || sh.getLastRow() < 2 || !_isFundCode(code)) return null;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, Math.min(9, sh.getLastColumn())).getValues();
  return _fundNavEvaluationFromRows(rows, _readFundUnits(ss), code, dateStr);
}

var PRICE_HISTORY_UNVERIFIED_SOURCES = /REALTIME|INDICATIVE|DAILY_CANDLE|UNVERIFIED_CLOSE/i;
var PRICE_HISTORY_TRUSTED_REPAIR_SOURCES = /^(KRX_CONFIRMED_CLOSE|TOSS_CONFIRMED_DAILY_CLOSE|STORED_CONFIRMED_CLOSE|FUND_NAV)$/;

function _readPriceIntegrityContext(ss) {
  function rows(name, columns) {
    var sheet = ss.getSheetByName(name);
    return sheet && sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.min(columns, sheet.getLastColumn())).getValues() : [];
  }
  var codes = getCodeItems(ss, true), byCode = {};
  codes.forEach(function(item) { byCode[item.code] = item; });
  return { priceRows: rows(CONFIG.SHEET_PH, 6), tradeRows: rows(CONFIG.SHEET_TRADES, 11),
    fxRows: rows('환율이력', 3), navRows: rows(FUND_NAV_SHEET, 9), codeItems: codes, byCode: byCode };
}

function _priceIntegrityRows(context, dates, codes) {
  var wantedDates = {}, wantedCodes = {}, series = {}, trades = {}, fxSeries = {};
  (dates || []).forEach(function(value) { wantedDates[value] = true; });
  (codes || []).forEach(function(value) { wantedCodes[_cleanCode(value) || String(value)] = true; });
  context.tradeRows.forEach(function(row) {
    var date = _normalizeDate(row[0]), code = _cleanCode(row[4]) || String(row[4] || '').trim();
    if (date && code) trades[date + '|' + code] = true;
  });
  context.fxRows.forEach(function(row) {
    var date = _normalizeDate(row[0]), currency = String(row[1] || '').toUpperCase(), rate = Number(row[2]);
    if (date && currency && rate > 0) (fxSeries[currency] || (fxSeries[currency] = [])).push({ date: date, rate: rate });
  });
  Object.keys(fxSeries).forEach(function(currency) { fxSeries[currency].sort(function(a,b) { return a.date.localeCompare(b.date); }); });
  context.priceRows.forEach(function(row, index) {
    var date = _normalizeDate(row[0]), code = _cleanCode(row[1]) || String(row[1] || '').trim(), price = Number(row[3]);
    if (!date || !code) return;
    (series[code] || (series[code] = [])).push({ date: date, code: code, name: String(row[2] || ''), price: price,
      savedAt: _normalizeDatetime(row[4]), source: String(row[5] || ''), rowNumber: index + 2 });
  });
  Object.keys(series).forEach(function(code) { series[code].sort(function(a, b) { return a.date.localeCompare(b.date); }); });
  var output = [];
  Object.keys(series).forEach(function(code) {
    if (Object.keys(wantedCodes).length && !wantedCodes[code]) return;
    series[code].forEach(function(cur, index) {
      if (Object.keys(wantedDates).length && !wantedDates[cur.date]) return;
      var previous = index ? series[code][index - 1] : null, next = index + 1 < series[code].length ? series[code][index + 1] : null;
      var prevChange = previous && previous.price > 0 ? (cur.price / previous.price - 1) * 100 : null;
      var nextChange = next && cur.price > 0 ? (next.price / cur.price - 1) * 100 : null;
      var rebound = previous && next && previous.price > 0 && next.price > 0 && Math.abs(next.price / previous.price - 1) <= 0.15;
      var oneDayDrop = rebound && cur.price > 0 && cur.price / previous.price <= 0.2;
      var oneDaySpike = rebound && cur.price / previous.price >= 5;
      var codeItem = context.byCode[code] || {}, currency = String(codeItem.currency || 'KRW').toUpperCase();
      var fx = null;
      if (currency !== 'KRW') {
        var rows = fxSeries[currency] || [], low = 0, high = rows.length - 1;
        while (low <= high) { var mid = (low + high) >> 1; if (rows[mid].date <= cur.date) { fx = rows[mid]; low = mid + 1; } else high = mid - 1; }
      }
      var corporateActionPossible = !!trades[cur.date + '|' + code] || (previous && next && !rebound && (Math.abs(prevChange || 0) >= 40 || Math.abs(nextChange || 0) >= 40));
      var status = 'VALID', reason = '인접 가격과 저장 provenance가 정상 범위입니다.';
      if (String(cur.source).toUpperCase() === 'MANUAL') { status = 'MANUAL_PROTECTED'; reason = 'MANUAL 가격은 자동 오류 확정·수정하지 않습니다.'; }
      else if (PRICE_HISTORY_UNVERIFIED_SOURCES.test(cur.source)) { status = 'SOURCE_INVALID'; reason = '과거 확정 Snapshot에 사용할 수 없는 미검증 Toss 가격 source입니다.'; }
      else if (!(cur.price > 0)) { status = 'SOURCE_INVALID'; reason = '저장 가격이 0 이하이거나 숫자가 아닙니다.'; }
      else if (currency !== 'KRW' && (!fx || !(fx.rate > 0) || fx.rate < 10 || fx.rate > 10000)) { status = 'FX_MISSING'; reason = '해당 날짜 이전의 정상 환율을 확인할 수 없습니다.'; }
      else if ((oneDayDrop || oneDaySpike) && corporateActionPossible) { status = 'CORPORATE_ACTION_REVIEW'; reason = '급변이 있으나 거래/기업행위 가능성이 있어 자동 오류 확정하지 않습니다.'; }
      else if (oneDayDrop) { status = 'SUSPICIOUS_DROP'; reason = '인접일 수준으로 즉시 복귀한 1/5 이하 단일일 급락입니다.'; }
      else if (oneDaySpike) { status = 'SUSPICIOUS_SPIKE'; reason = '인접일 수준으로 즉시 복귀한 5배 이상 단일일 급등입니다.'; }
      else if (!cur.source) { status = 'UNVERIFIED'; reason = '가격 source provenance가 없습니다.'; }
      output.push({ date: cur.date, code: code, name: cur.name || codeItem.name || '', storedPrice: cur.price,
        source: cur.source, savedAt: cur.savedAt, sourceDate: cur.date,
        previousPrice: previous ? previous.price : null, previousDate: previous ? previous.date : '',
        nextPrice: next ? next.price : null, nextDate: next ? next.date : '', prevChangePct: prevChange, nextChangePct: nextChange,
        currency: currency, fxRate: fx ? fx.rate : (currency === 'KRW' ? 1 : 0), fxSourceDate: fx ? fx.date : '',
        corporateActionPossible: corporateActionPossible, tradeExists: !!trades[cur.date + '|' + code], status: status, reason: reason,
        rowNumber: cur.rowNumber });
    });
  });
  return output.sort(function(a, b) { return a.date === b.date ? a.code.localeCompare(b.code) : a.date.localeCompare(b.date); });
}

function diagnosePriceHistoryIntegrity(ss, dates, codes, context) {
  context = context || _readPriceIntegrityContext(ss);
  var rows = _priceIntegrityRows(context, dates || [], codes || []), counts = {};
  rows.forEach(function(row) { counts[row.status] = (counts[row.status] || 0) + 1; });
  return { rows: rows, counts: counts, checkedRows: rows.length };
}

function handleDiagnosePriceHistoryIntegrity(dateStr, datesStr, codesStr) {
  try {
    var dates = String(datesStr || dateStr || '').split(',').map(function(value) { return _normalizeDate(value.trim()); }).filter(Boolean);
    if (!dates.length) throw new Error('date 또는 dates가 필요합니다.');
    var codes = String(codesStr || '').split(',').map(function(value) { return value.trim(); }).filter(Boolean);
    return jsonOk({ priceIntegrity: diagnosePriceHistoryIntegrity(getss(), dates, codes) });
  } catch (error) { return jsonError('가격이력 정합성 진단 실패: ' + error.message); }
}

function _inspectPriceHistoryRepair(ss, dataJson) {
  var request = JSON.parse(dataJson || '{}'), date = _normalizeDate(request.date), code = _cleanCode(request.code) || String(request.code || '').trim();
  var referencePrice = Number(request.referencePrice), referenceSource = String(request.referenceSource || '').trim().toUpperCase();
  if (!date || !code || !(referencePrice > 0)) throw new Error('date/code/referencePrice가 필요합니다.');
  if (!PRICE_HISTORY_TRUSTED_REPAIR_SOURCES.test(referenceSource)) throw new Error('확정 기준 source가 아닙니다.');
  var context = _readPriceIntegrityContext(ss), diagnostic = diagnosePriceHistoryIntegrity(ss, [date], [code], context).rows[0];
  if (!diagnostic) throw new Error('대상 가격이력 행이 없습니다.');
  if (diagnostic.status === 'MANUAL_PROTECTED' || String(diagnostic.source).toUpperCase() === 'MANUAL') throw new Error('MANUAL 가격은 자동 교정할 수 없습니다.');
  var snapshots = [], nextDate = diagnostic.nextDate;
  var snapshotSheet = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
  if (snapshotSheet && snapshotSheet.getLastRow() > 1) snapshotSheet.getRange(2, 1, snapshotSheet.getLastRow() - 1, 8).getValues().forEach(function(row) {
    var rowDate = _normalizeDate(row[0]), rowCode = _cleanCode(row[1]);
    if (rowCode === code && rowDate >= date && (!nextDate || rowDate < nextDate)) snapshots.push({ date: rowDate, qty: Number(row[3]) || 0, storedEvalAmt: Number(row[7]) || 0 });
  });
  return { date: date, code: code, name: diagnostic.name, existingPrice: diagnostic.storedPrice, existingSource: diagnostic.source,
    referencePrice: referencePrice, referenceSource: referenceSource, difference: referencePrice - diagnostic.storedPrice,
    differencePct: diagnostic.storedPrice > 0 ? (referencePrice / diagnostic.storedPrice - 1) * 100 : null,
    reason: String(request.reason || diagnostic.reason), snapshotImpactDates: snapshots.map(function(item) { return item.date; }),
    expectedEvaluationImpact: snapshots.reduce(function(sum, item) { return sum + Math.round((referencePrice - diagnostic.storedPrice) * item.qty); }, 0),
    diagnostic: diagnostic, canApply: true };
}

function handlePreviewPriceHistoryRepair(dataJson) {
  try { return jsonOk({ preview: _inspectPriceHistoryRepair(getss(), dataJson), applied: false }); }
  catch (error) { return jsonError('가격이력 교정 preview 실패: ' + error.message); }
}

function handleApplyPriceHistoryRepair(dataJson) {
  var lock = LockService.getScriptLock(), backup = null;
  try {
    lock.waitLock(30000);
    var ss = getss(), preview = _inspectPriceHistoryRepair(ss, dataJson), sheet = ss.getSheetByName(CONFIG.SHEET_PH);
    _snapshotBackupOperationId = 'priceHistoryRepair|' + (JSON.parse(dataJson || '{}').operationId || Utilities.getUuid());
    backup = _backupSheetBeforeWrite(ss, sheet, CONFIG.SHEET_PH);
    sheet.getRange(preview.diagnostic.rowNumber, 4, 1, 3).setValues([[preview.referencePrice, new Date().toISOString(), preview.referenceSource]]);
    SpreadsheetApp.flush();
    _touchSnapshotIntegritySourceRevision({ from: preview.date });
    var after = diagnosePriceHistoryIntegrity(ss, [preview.date], [preview.code]).rows[0];
    if (!after || after.status !== 'VALID') throw new Error('가격이력 쓰기 후 검증 실패: ' + (after ? after.status : 'NO_RESULT'));
    _markSnapshotBackupStatus(backup, 'COMPLETED');
    _cleanupCurrentSystemBackup(ss, backup);
    return jsonOk({ applied: true, preview: preview, after: after, nextStep: 'diagnoseSnapshotIntegrity → rewriteSnapshotDate → VALID 재진단' });
  } catch (error) { if (backup) _markSnapshotBackupStatus(backup, 'WRITE_FAILED', error.message); return jsonError('가격이력 교정 apply 실패: ' + error.message); }
  finally { _snapshotBackupOperationId = ''; try { lock.releaseLock(); } catch (ignore) {} }
}

// Snapshot은 materialized view이므로 원자료 계산값을 정답으로 비교합니다.
// 이 경로는 시트를 수정하지 않으며, 중복 충돌을 dedupe 전 원본 행에서 판정합니다.
function _readRawSnapshotRowsByDate(ss, dateStr) {
  var sh = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT), out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(12, sh.getLastColumn())).getValues().forEach(function(row) {
    if (_normalizeDate(row[0]) !== dateStr) return;
    var copy = row.slice(0, 12); while (copy.length < 12) copy.push('');
    copy[0] = dateStr; copy[1] = _cleanCode(copy[1]) || String(copy[1] || '').trim();
    [3,4,5,6,7,8,9].forEach(function(index) { copy[index] = Number(copy[index]) || 0; });
    out.push(copy);
  });
  return out;
}

function _snapshotIntegrityKey(row) { return _cleanCode(row && row[1]) || String(row && row[2] || '').trim(); }
function _snapshotStoredNumber(value, decimals) {
  var factor = Math.pow(10, Number(decimals) || 0);
  return Math.round((Number(value) || 0) * factor) / factor;
}

function diagnoseSnapshotIntegrity(ss, dateStr, priceContext, rangeContext) {
  var date = _normalizeDate(dateStr || ''), raw = rangeContext ? (rangeContext.snapshotRowsByDate[date] || []) : _readRawSnapshotRowsByDate(ss, date);
  if (!date) throw new Error('유효한 date가 필요합니다.');
  var grouped = {}, duplicateKeys = [], conflictKeys = [];
  raw.forEach(function(row) { var key = date + '|' + _snapshotIntegrityKey(row); (grouped[key] || (grouped[key] = [])).push(row); });
  Object.keys(grouped).forEach(function(key) {
    if (grouped[key].length < 2) return;
    duplicateKeys.push(key);
  });
  var result = { date: date, status: 'VALID', expectedRowCount: 0, storedRowCount: raw.length,
    expectedCodes: [], storedCodes: [], missingCodes: [], unexpectedCodes: [], duplicateKeys: duplicateKeys,
    conflictKeys: conflictKeys, qtyMismatches: [], costAmtMismatches: [], evalUnitMismatches: [],
    evalAmtMismatches: [], sourceMismatches: [], totalExpectedEvalAmt: 0, totalStoredEvalAmt: 0,
    totalEvalDifference: 0, totalExpectedCostAmt: 0, totalStoredCostAmt: 0, sourceDataErrors: [],
    fundNavStates: [], foreignFxStates: [], priceIntegrity: [], itemComparisons: [], expectedRows: [], storedRows: raw };
  var expected = [];
  try { expected = rangeContext ? _buildIndexedSnapshotRows(rangeContext, date) : _buildSnapshotRowsFromTradeAndPriceHistory(ss, date, true); }
  catch (error) { result.sourceDataErrors.push(String(error.message || error)); result.status = 'SOURCE_INCOMPLETE'; }
  result.expectedRows = expected;
  var duplicateDecisions = _classifyRawSnapshotDuplicateGroups(date, raw, expected,
    result.status === 'SOURCE_INCOMPLETE' ? result.sourceDataErrors.join('; ') : '');
  result.duplicateSummary = {
    groups: duplicateDecisions.length,
    exactDuplicate: duplicateDecisions.filter(function(item) { return item.classification === 'EXACT_DUPLICATE'; }).length,
    singleExpectedMatch: duplicateDecisions.filter(function(item) { return item.classification === 'SINGLE_EXPECTED_MATCH'; }).length,
    manualProtected: duplicateDecisions.filter(function(item) { return item.classification === 'MANUAL_PROTECTED'; }).length,
    unresolvedConflict: duplicateDecisions.filter(function(item) { return item.classification === 'UNRESOLVED_CONFLICT'; }).length,
    sourceIncomplete: duplicateDecisions.filter(function(item) { return item.classification === 'SOURCE_INCOMPLETE'; }).length
  };
  conflictKeys = duplicateDecisions.filter(function(item) {
    return item.classification === 'MANUAL_PROTECTED' || item.classification === 'UNRESOLVED_CONFLICT';
  }).map(function(item) { return date + '|' + item.key; });
  result.conflictKeys = conflictKeys;
  var expectedMap = {}, storedMap = {};
  expected.forEach(function(row) { expectedMap[_snapshotIntegrityKey(row)] = row; });
  raw.forEach(function(row) { var key = _snapshotIntegrityKey(row); if (!storedMap[key]) storedMap[key] = row; });
  result.expectedCodes = Object.keys(expectedMap).sort(); result.storedCodes = Object.keys(storedMap).sort();
  result.expectedRowCount = expected.length;
  result.missingCodes = result.expectedCodes.filter(function(code) { return !storedMap[code]; });
  result.unexpectedCodes = result.storedCodes.filter(function(code) { return !expectedMap[code]; });
  function compare(field, index, decimals) {
    result[field] = result.expectedCodes.filter(function(code) {
      return storedMap[code] && _snapshotStoredNumber(expectedMap[code][index], decimals) !== _snapshotStoredNumber(storedMap[code][index], decimals);
    }).map(function(code) { return { code: code, expected: expectedMap[code][index], stored: storedMap[code][index] }; });
  }
  compare('qtyMismatches', 3, 8); compare('costAmtMismatches', 5, 0);
  compare('evalUnitMismatches', 6, 2); compare('evalAmtMismatches', 7, 0);
  result.sourceMismatches = result.expectedCodes.filter(function(code) {
    return storedMap[code] && String(expectedMap[code][10] || '') !== String(storedMap[code][10] || '');
  }).map(function(code) { return { code: code, expected: expectedMap[code][10] || '', stored: storedMap[code][10] || '' }; });
  expected.forEach(function(row) {
    result.totalExpectedEvalAmt += _snapshotStoredNumber(row[7], 0); result.totalExpectedCostAmt += _snapshotStoredNumber(row[5], 0);
    if (_isFundCode(row[1])) {
      var fundEvaluation = rangeContext ? _indexedFundEvaluation(rangeContext, row[1], date) : _getFundEvaluationAtDate(ss, row[1], date);
      result.fundNavStates.push({ code: row[1], source: row[10], sourceDate: fundEvaluation ? fundEvaluation.sourceDate : '',
        valueDate: fundEvaluation ? fundEvaluation.valueDate : '', temporary: /CARRY|INPUT_REQUIRED/.test(String(row[10])) });
    }
  });
  try {
    var currencies = {}, codeCurrencies = {};
    (rangeContext ? rangeContext.codeItems : getCodeItems(ss, true)).forEach(function(item) {
      var code = _cleanCode(item.code) || String(item.code || '').trim(), currency = String(item.currency || 'KRW').toUpperCase();
      if (code && currency !== 'KRW') { codeCurrencies[code] = currency; currencies[currency] = true; }
    });
    var fxSheet = rangeContext ? null : ss.getSheetByName('환율이력'), latestFx = {};
    if (rangeContext) Object.keys(currencies).forEach(function(currency) { var found = _indexedLatest(rangeContext.fxSeriesByCurrency[currency] || [], date); if (found) latestFx[currency] = { sourceDate: found.date, rate: found.rate }; });
    else if (fxSheet && fxSheet.getLastRow() > 1) fxSheet.getRange(2, 1, fxSheet.getLastRow() - 1, 3).getValues().forEach(function(fxRow) {
      var fxDate = _normalizeDate(fxRow[0]), currency = String(fxRow[1] || '').toUpperCase(), rate = Number(fxRow[2]);
      if (fxDate && fxDate <= date && currencies[currency] && rate > 0 && (!latestFx[currency] || fxDate > latestFx[currency].sourceDate)) latestFx[currency] = { sourceDate: fxDate, rate: rate };
    });
    result.expectedCodes.forEach(function(code) {
      var currency = codeCurrencies[code], state = currency ? latestFx[currency] : null;
      if (currency) result.foreignFxStates.push({ code: code, currency: currency, sourceDate: state ? state.sourceDate : '', rate: state ? state.rate : 0 });
    });
  } catch (fxStateError) { result.sourceDataErrors.push('환율 상태 조회 실패: ' + fxStateError.message); }
  raw.forEach(function(row) { result.totalStoredEvalAmt += _snapshotStoredNumber(row[7], 0); result.totalStoredCostAmt += _snapshotStoredNumber(row[5], 0); });
  result.totalEvalDifference = result.totalStoredEvalAmt - result.totalExpectedEvalAmt;
  if (result.status !== 'SOURCE_INCOMPLETE') {
    var mismatched = result.qtyMismatches.length + result.costAmtMismatches.length + result.evalUnitMismatches.length + result.evalAmtMismatches.length + result.sourceMismatches.length;
    if (conflictKeys.length) result.status = 'CONFLICT';
    else if (!raw.length) result.status = 'NO_SNAPSHOT';
    else if (result.missingCodes.length || result.unexpectedCodes.length || raw.length !== expected.length) result.status = 'PARTIAL';
    else if (mismatched) result.status = 'MISMATCH';
  }
  try {
    result.priceIntegrity = (rangeContext ? (rangeContext.priceIntegrityByDate[date] || []) : diagnosePriceHistoryIntegrity(ss, [date], [], priceContext).rows).filter(function(row) {
      return result.expectedCodes.indexOf(row.code) !== -1 || result.storedCodes.indexOf(row.code) !== -1;
    });
    var priceByCode = {}; result.priceIntegrity.forEach(function(row) { priceByCode[row.code] = row; });
    result.itemComparisons = Array.from ? result.expectedCodes.concat(result.storedCodes).filter(function(code, index, all) { return all.indexOf(code) === index; }).map(function(code) {
      var stored = storedMap[code] || [], expected = expectedMap[code] || [], price = priceByCode[code] || {};
      return { code: code, name: stored[2] || expected[2] || price.name || '', qty: stored[3] || expected[3] || 0,
        costUnit: stored[4] || 0, costAmt: stored[5] || 0, evalUnit: stored[6] || 0, evalAmt: stored[7] || 0,
        pnl: stored[8] || 0, source: stored[10] || '', sourceDate: price.sourceDate || '', expectedEvalUnit: expected[6] || 0,
        expectedEvalAmt: expected[7] || 0, storedPrice: price.storedPrice || 0, previousPrice: price.previousPrice,
        previousDate: price.previousDate || '', nextPrice: price.nextPrice, nextDate: price.nextDate || '',
        referencePrice: null, currency: price.currency || 'KRW', fxRate: price.fxRate || 0, fxSourceDate: price.fxSourceDate || '',
        mismatchReason: price.status && price.status !== 'VALID' ? price.reason : (stored[7] !== expected[7] ? 'Snapshot 평가금액 불일치' : '') };
    }) : [];
    if (result.status === 'VALID' && result.priceIntegrity.some(function(row) { return ['VALID', 'MANUAL_PROTECTED'].indexOf(row.status) === -1; })) result.status = 'PRICE_SUSPICIOUS';
  } catch (priceError) {
    result.sourceDataErrors.push('가격이력 진단 실패: ' + priceError.message);
    if (result.status === 'VALID') result.status = 'SOURCE_INCOMPLETE';
  }
  return result;
}

function handleDiagnoseSnapshotIntegrity(dateStr, datesStr) {
  try {
    var dates = String(datesStr || dateStr || '').split(',').map(function(value) { return _normalizeDate(value.trim()); }).filter(Boolean);
    if (!dates.length) return jsonError('date 또는 dates가 필요합니다.');
    var ss = getss(), diagnostics = dates.map(function(date) { return diagnoseSnapshotIntegrity(ss, date); });
    return jsonOk({ diagnostics: diagnostics, diagnostic: diagnostics.length === 1 ? diagnostics[0] : null });
  } catch (error) { return jsonError('Snapshot 정합성 진단 실패: ' + error.message); }
}

// 기간 진단 전용 read-through context입니다. 필요한 원장을 각각 한 번만 읽고 기존
// 단일일 계산기에 Sheet 호환 read-only view를 전달하여 계산 계약을 공유합니다.
function _buildSnapshotRangeReadContext(ss, options) {
  var historyOnly = !!(options && options.historyOnly);
  var started = Date.now(), names = historyOnly
    ? [CONFIG.SHEET_TRADES, CONFIG.SHEET_PH, CONFIG.SHEET_CODES, FUND_NAV_SHEET, FUND_UNITS_SHEET, '환율이력']
    : [CONFIG.SHEET_SNAPSHOT, CONFIG.SHEET_TRADES, CONFIG.SHEET_PH,
       CONFIG.SHEET_CODES, FUND_NAV_SHEET, FUND_UNITS_SHEET, '환율이력'], valuesByName = {}, counts = {};
  names.forEach(function(name) {
    var sheet = ss.getSheetByName(name), values = [];
    if (sheet && sheet.getLastRow() && sheet.getLastColumn()) values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
    valuesByName[name] = values; counts[name] = Math.max(0, values.length - 1);
  });
  function sheetView(name) {
    var values = valuesByName[name];
    if (!values) return null;
    return { getLastRow: function() { return values.length; }, getLastColumn: function() { return values.reduce(function(max, row) { return Math.max(max, row.length); }, 0); },
      getRange: function(row, column, rowCount, columnCount) { return { getValues: function() {
        var out = [];
        for (var r = 0; r < rowCount; r++) { var line = []; for (var c = 0; c < columnCount; c++) line.push((values[row - 1 + r] || [])[column - 1 + c] === undefined ? '' : values[row - 1 + r][column - 1 + c]); out.push(line); }
        return out;
      } }; } };
  }
  return { ss: { getSheetByName: sheetView }, valuesByName: valuesByName, readMs: Date.now() - started,
    metrics: { snapshotRows: counts[CONFIG.SHEET_SNAPSHOT], tradeRows: counts[CONFIG.SHEET_TRADES], priceHistoryRows: counts[CONFIG.SHEET_PH],
      fundNavRows: counts[FUND_NAV_SHEET], fundUnitRows: counts[FUND_UNITS_SHEET], fxRows: counts['환율이력'], sheetReads: names.length } };
}

function _indexedLatest(series, date) {
  var low = 0, high = series.length - 1, found = null;
  while (low <= high) {
    var mid = (low + high) >> 1;
    if (series[mid].date <= date) { found = series[mid]; low = mid + 1; } else high = mid - 1;
  }
  return found;
}

function _indexedFundEvaluation(context, code, date) {
  context.metrics.fundNavLookupCount++;
  var active = _fundUnitsAtDate(context.fundConfigs || [], code, date);
  if (!active || !(Number(active.units) > 0)) return null;
  // 같은 공시일의 상충 NAV는 정렬상 마지막 값을 선택하지 않고 조회를 실패시킵니다.
  // 두 행의 입력일이 모두 평가일까지 도달했고 해당 기관에 적용되는 충돌만 검사합니다.
  (context.fundNavConflictsByCode[code] || []).forEach(function(conflict) {
    if (conflict.sourceDate > date || conflict.detectedAt > date) return;
    if ((conflict.providerA && conflict.providerA !== active.provider) ||
        (conflict.providerB && conflict.providerB !== active.provider)) return;
    throw new Error('펀드 확정 NAV 충돌: ' + code + ' ' + conflict.sourceDate);
  });
  var series = context.fundNavSeriesByCode[code] || [], best = null;
  var low = 0, high = series.length - 1, index = -1;
  while (low <= high) {
    var mid = (low + high) >> 1;
    if (series[mid].sourceDate <= date) { index = mid; low = mid + 1; } else high = mid - 1;
  }
  while (index >= 0) {
    var candidate = series[index--];
    if (candidate.valueDate > date || (candidate.provider && candidate.provider !== active.provider)) continue;
    best = candidate; break;
  }
  if (!best) return null;
  var evalAmt = Math.round(best.nav * Number(active.units) / 1000);
  if (!Number.isSafeInteger(evalAmt) || evalAmt < 0) throw new Error('펀드 평가금액 계산 범위 초과: ' + code);
  return { evalAmt: evalAmt, nav: best.nav, units: Number(active.units),
    sourceDate: best.sourceDate, carried: best.sourceDate < date };
}

function _buildSnapshotRangeIndexes(readContext, dates, options) {
  var started = Date.now(), values = readContext.valuesByName, metrics = readContext.metrics;
  var context = { snapshotRowsByDate: {}, priceSeriesByCode: {}, positivePriceSeriesByCode: {}, priceExactByDateCode: {}, manualPriceSeriesByCode: {}, fundNavSeriesByCode: {}, fxSeriesByCurrency: {},
    priceIntegrityByDate: {}, codeItems: getCodeItems(readContext.ss, true), fundConfigs: _readFundUnits(readContext.ss), metrics: metrics };
  context.codeByCode = {}; context.nameToCode = {}; context.currencyByCode = {};
  context.codeItems.forEach(function(item) {
    var code = _cleanCode(item.code) || String(item.code || '').trim();
    if (!code) return;
    context.codeByCode[code] = item;
    if (item.name) context.nameToCode[item.name] = code;
    context.currencyByCode[code] = String(item.currency || 'KRW').toUpperCase();
  });
  // getCodeItems()는 빈 통화 셀을 KRW로 기본 설정합니다. 손익 원자료 조회에서는
  // 누락된 해외 종목 통화가 KRW로 오인되지 않도록 시트 원본 통화 셀을 직접 확인합니다.
  context.historyCurrencyByCode = {};
  (values[CONFIG.SHEET_CODES] || []).slice(1).forEach(function(row) {
    var code = _cleanCode(row[0]) || String(row[0] || '').trim();
    if (!code) return;
    var currency = String(row[4] || '').trim().toUpperCase();
    var market = String(row[5] || '').trim().toUpperCase();
    var foreignCode = /^[A-Z]{1,5}(\.[A-Z])?$/.test(code);
    var foreignMarket = /(^|[^A-Z])(NASDAQ|NYSE|AMEX|US|JP|TSE|HK|HKEX|TOKYO|JAPAN|HONGKONG)([^A-Z]|$)/.test(market);
    if (currency === 'KRW' && (foreignCode || foreignMarket)) return;
    if (/^[A-Z]{3}$/.test(currency)) context.historyCurrencyByCode[code] = currency;
    else if (!currency && /^[0-9][0-9A-Z]{5}$/.test(code)) context.historyCurrencyByCode[code] = 'KRW';
  });
  (values[CONFIG.SHEET_TRADES] || []).slice(1).forEach(function(row) {
    var name = String(row[3] || '').trim(), code = _cleanCode(row[4]) || String(row[4] || '').trim();
    if (name && code && !context.nameToCode[name]) context.nameToCode[name] = code;
  });
  // 평가일 사이의 split/reverse_split 이력은 종가 carry 허용 여부를 판단하는 원자료입니다.
  context.historyCorporateActionDatesByCode = {};
  (values[CONFIG.SHEET_TRADES] || []).slice(1).forEach(function(row) {
    var action = String(row[1] || '').trim().toLowerCase();
    if (action !== 'split' && action !== 'reverse_split') return;
    var actionDate = _normalizeDate(row[0]), name = String(row[3] || '').trim();
    var code = _cleanCode(row[4]) || String(row[4] || '').trim() || context.nameToCode[name];
    if (!actionDate || !code) return;
    (context.historyCorporateActionDatesByCode[code] ||
      (context.historyCorporateActionDatesByCode[code] = [])).push(actionDate);
  });
  Object.keys(context.historyCorporateActionDatesByCode).forEach(function(code) {
    context.historyCorporateActionDatesByCode[code].sort();
  });
  (values[CONFIG.SHEET_SNAPSHOT] || []).slice(1).forEach(function(row) {
    var date = _normalizeDate(row[0]); if (!date) return;
    var copy = row.slice(0, 12); while (copy.length < 12) copy.push('');
    copy[0] = date; copy[1] = _cleanCode(copy[1]) || String(copy[1] || '').trim();
    [3,4,5,6,7,8,9].forEach(function(index) { copy[index] = Number(copy[index]) || 0; });
    (context.snapshotRowsByDate[date] || (context.snapshotRowsByDate[date] = [])).push(copy);
  });
  (values[CONFIG.SHEET_PH] || []).slice(1).forEach(function(row, index) {
    var date = _normalizeDate(row[0]), code = _cleanCode(row[1]) || String(row[1] || '').trim(), price = Number(row[3]);
    if (!date || !code) return;
    (context.priceSeriesByCode[code] || (context.priceSeriesByCode[code] = [])).push({ date: date, code: code,
      name: String(row[2] || ''), price: price, savedAt: _normalizeDatetime(row[4]), source: String(row[5] || ''), rowNumber: index + 2 });
  });
  Object.keys(context.priceSeriesByCode).forEach(function(code) { context.priceSeriesByCode[code].sort(function(a,b) {
    return a.date === b.date ? a.rowNumber - b.rowNumber : a.date.localeCompare(b.date);
  }); context.priceSeriesByCode[code].forEach(function(entry) {
    if (!(entry.price > 0)) return;
    var key = entry.date + '|' + code, existing = context.priceExactByDateCode[key];
    if (!existing || (!existing.savedAt && entry.savedAt)) context.priceExactByDateCode[key] = entry;
    if (String(entry.source).toUpperCase() === 'MANUAL' && entry.savedAt) (context.manualPriceSeriesByCode[code] || (context.manualPriceSeriesByCode[code] = [])).push(entry);
  }); });
  Object.keys(context.priceSeriesByCode).forEach(function(code) {
    var seenDates = {};
    context.priceSeriesByCode[code].forEach(function(entry) { seenDates[entry.date] = true; });
    context.positivePriceSeriesByCode[code] = Object.keys(seenDates).sort().map(function(date) { return context.priceExactByDateCode[date + '|' + code]; }).filter(Boolean);
  });
  // 손익 원자료 전용 가격 인덱스: 같은 날에는 검증된 자동 가격이 MANUAL보다 우선합니다.
  // 실시간/미검증 Toss 가격과 GOOGLEFINANCE 값은 과거 확정 평가에 사용하지 않습니다.
  context.historyPriceSeriesByCode = {};
  Object.keys(context.priceSeriesByCode).forEach(function(code) {
    var byDate = {};
    context.priceSeriesByCode[code].forEach(function(entry) {
      var src = String(entry.source || '').toUpperCase();
      if (!(entry.price > 0) || !src || PRICE_HISTORY_UNVERIFIED_SOURCES.test(src) ||
          src.indexOf('GOOGLEFINANCE') !== -1 || src === 'TOSS') return;
      var previous = byDate[entry.date];
      var rank = src === 'MANUAL' ? 1 : 2;
      var prevRank = previous && String(previous.source || '').toUpperCase() === 'MANUAL' ? 1 : 2;
      if (!previous || rank > prevRank || (rank === prevRank && entry.rowNumber > previous.rowNumber)) byDate[entry.date] = entry;
    });
    context.historyPriceSeriesByCode[code] = Object.keys(byDate).sort().map(function(date) { return byDate[date]; });
  });
  (values[FUND_NAV_SHEET] || []).slice(1).forEach(function(row) {
    var code = _cleanCode(row[1]) || String(row[1] || '').trim();
    var valueDate = _normalizeDate(row[0]), sourceDate = _normalizeDate(row[4]), nav = Number(row[3]);
    if (!_isFundCode(code) || !valueDate || !sourceDate || sourceDate > valueDate || !(nav > 0)) return;
    (context.fundNavSeriesByCode[code] || (context.fundNavSeriesByCode[code] = [])).push({
      nav: nav, valueDate: valueDate, sourceDate: sourceDate, provider: String(row[8] || ''), date: sourceDate
    });
  });
  // NAV 충돌을 인덱스 생성 시 한 번만 선계산하여 일별 조회마다 원본 행 전체를 스캔하지 않습니다.
  // 공시기관 미기재 행은 기존 단건 평가 경로와 동일하게 어느 기관에도 적용됩니다.
  context.fundNavConflictsByCode = {};
  Object.keys(context.fundNavSeriesByCode).forEach(function(code) {
    var series = context.fundNavSeriesByCode[code];
    series.sort(function(a,b) {
      return a.sourceDate === b.sourceDate ? a.valueDate.localeCompare(b.valueDate) : a.sourceDate.localeCompare(b.sourceDate);
    });
    var sameDay = [], lastSourceDate = '';
    series.forEach(function(item) {
      if (item.sourceDate !== lastSourceDate) { sameDay = []; lastSourceDate = item.sourceDate; }
      sameDay.forEach(function(previous) {
        if (previous.nav === item.nav || (previous.provider && item.provider && previous.provider !== item.provider)) return;
        (context.fundNavConflictsByCode[code] || (context.fundNavConflictsByCode[code] = [])).push({
          sourceDate: item.sourceDate,
          detectedAt: previous.valueDate > item.valueDate ? previous.valueDate : item.valueDate,
          providerA: previous.provider, providerB: item.provider
        });
      });
      sameDay.push(item);
    });
  });
  (values['환율이력'] || []).slice(1).forEach(function(row) {
    var date = _normalizeDate(row[0]), currency = String(row[1] || '').toUpperCase(), rate = Number(row[2]);
    if (date && currency && rate > 0) (context.fxSeriesByCurrency[currency] || (context.fxSeriesByCurrency[currency] = [])).push({ date: date, rate: rate });
  });
  Object.keys(context.fxSeriesByCurrency).forEach(function(currency) { context.fxSeriesByCurrency[currency].sort(function(a,b) { return a.date.localeCompare(b.date); }); });
  context.holdingsByRequestedDate = _buildHoldingsByRequestedDate((values[CONFIG.SHEET_TRADES] || []).slice(1), dates, context.nameToCode);
  var priceContext = { priceRows: (values[CONFIG.SHEET_PH] || []).slice(1), tradeRows: (values[CONFIG.SHEET_TRADES] || []).slice(1),
    fxRows: (values['환율이력'] || []).slice(1), navRows: (values[FUND_NAV_SHEET] || []).slice(1), codeItems: context.codeItems, byCode: context.codeByCode };
  if (!(options && options.historyOnly)) {
    _priceIntegrityRows(priceContext, dates, []).forEach(function(row) {
      (context.priceIntegrityByDate[row.date] || (context.priceIntegrityByDate[row.date] = [])).push(row);
    });
  }
  metrics.holdingsBuildCount = 1; metrics.priceSeriesBuildCount = 1; metrics.priceIntegrityBuildCount = options && options.historyOnly ? 0 : 1;
  metrics.snapshotDateLookupCount = 0; metrics.fundNavLookupCount = 0; metrics.fxLookupCount = 0;
  context.indexBuildMs = Date.now() - started;
  return context;
}

function _buildIndexedSnapshotRows(context, date) {
  var sourceHoldings = context.holdingsByRequestedDate[date] || {}, holdings = {}, out = [];
  Object.keys(sourceHoldings).forEach(function(name) { holdings[name] = Object.assign({}, sourceHoldings[name]); });
  _applyFundUnitLifecycleToSnapshotHoldings(holdings, context.fundConfigs || [], date);
  Object.keys(holdings).forEach(function(name) {
    var h = holdings[name], code = _cleanCode(h.code) || String(h.code || '').trim(), series = context.positivePriceSeriesByCode[code] || [];
    var exact = context.priceExactByDateCode[date + '|' + code] || null, latest = _indexedLatest(series, date);
    var entry = exact || latest, price = entry && entry.price > 0 ? entry.price : 0, source = entry ? entry.source : '';
    if (!exact) { var latestManual = _indexedLatest(context.manualPriceSeriesByCode[code] || [], date); if (latestManual) source = 'MANUAL'; }
    if (_isFundCode(code) && !(price > 0)) {
      var fund = _indexedFundEvaluation(context, code, date);
      if (fund) { price = fund.evalAmt; source = fund.carried ? 'FUND_NAV_CARRY' : 'FUND_NAV'; entry = { date: fund.sourceDate, savedAt: '' }; }
    }
    var currency = context.currencyByCode[code] || 'KRW', fxRate = 1;
    if (currency !== 'KRW') { context.metrics.fxLookupCount++; var fx = _indexedLatest(context.fxSeriesByCurrency[currency] || [], date); fxRate = fx ? fx.rate : 0; }
    if (!(price > 0) || !(fxRate > 0)) throw new Error('확정 원자료 부족으로 기존 Snapshot 보존: ' + (code || name) + (!(fxRate > 0) ? ':FX_' + currency : ''));
    var priceKrw = Math.round(price * fxRate), evalAmt = Math.round(priceKrw * h.qty), pnl = evalAmt - h.costAmt;
    var src = source || 'PRICE_HISTORY';
    if (!exact && entry && entry.date < date && src !== 'MANUAL' && src.indexOf('FUND_NAV') !== 0) src += '_CARRY@' + entry.date;
    out.push([date, code, h.name, h.qty, h.qty > 0 ? parseFloat((h.costAmt / h.qty).toFixed(2)) : 0, h.costAmt,
      h.qty > 0 ? parseFloat((evalAmt / h.qty).toFixed(2)) : 0, evalAmt, pnl,
      h.costAmt > 0 ? parseFloat(((pnl / h.costAmt) * 100).toFixed(2)) : 0, src, src === 'MANUAL' && entry ? entry.savedAt : '']);
  });
  return _dedupeSnapshotRows(out);
}

function handleDiagnoseSnapshotIntegrityRange(fromStr, toStr, candidatesStr, datesStr) {
  var totalStarted = Date.now(), dates = [], processedDates = 0, lastCompletedDate = '', failedDate = '', phase = 'request_validation';
  try {
    var from = _normalizeDate(fromStr), to = _normalizeDate(toStr);
    dates = String(datesStr || '').split(',').map(function(value) { return _normalizeDate(value.trim()); }).filter(Boolean);
    dates = dates.filter(function(date, index, all) { return all.indexOf(date) === index; }).sort();
    if (!dates.length) {
      if (!from || !to || from > to) throw new Error('유효한 dates 또는 from/to가 필요합니다.');
      var cursor = new Date(from + 'T00:00:00Z'), end = new Date(to + 'T00:00:00Z');
      while (cursor <= end) {
        var day = cursor.getUTCDay();
        if (day !== 0 && day !== 6) dates.push(Utilities.formatDate(cursor, 'UTC', 'yyyy-MM-dd'));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        if (dates.length > 400) { var rangeError = new Error('진단 범위는 400일 이하여야 합니다.'); rangeError.errorCode = 'RANGE_TOO_LARGE'; throw rangeError; }
      }
    }
    if (dates.length > 400) { var datesError = new Error('진단 날짜는 400일 이하여야 합니다.'); datesError.errorCode = 'RANGE_TOO_LARGE'; throw datesError; }
    phase = 'sheet_read';
    var context = _buildSnapshotRangeReadContext(getss());
    phase = 'index_build';
    var indexed = _buildSnapshotRangeIndexes(context, dates), calculationStarted = Date.now();
    var priceRowsAll = []; Object.keys(indexed.priceIntegrityByDate).forEach(function(date) { priceRowsAll = priceRowsAll.concat(indexed.priceIntegrityByDate[date]); });
    var priceIntegrity = { rows: priceRowsAll, counts: {}, checkedRows: priceRowsAll.length };
    priceRowsAll.forEach(function(row) { priceIntegrity.counts[row.status] = (priceIntegrity.counts[row.status] || 0) + 1; });
    var suspiciousByDate = {};
    priceIntegrity.rows.forEach(function(row) {
      if (['VALID', 'MANUAL_PROTECTED'].indexOf(row.status) === -1) (suspiciousByDate[row.date] || (suspiciousByDate[row.date] = [])).push(row);
    });
    phase = 'snapshot_integrity';
    var diagnostics = dates.map(function(date) {
      failedDate = date; indexed.metrics.snapshotDateLookupCount++;
      var diagnostic = diagnoseSnapshotIntegrity(context.ss, date, null, indexed), priceRows = suspiciousByDate[date] || [];
      if (diagnostic.status === 'PRICE_SUSPICIOUS' && priceRows.some(function(row) { return row.status === 'FX_MISSING' || row.status === 'SOURCE_INCOMPLETE'; })) diagnostic.status = 'SOURCE_INCOMPLETE';
      processedDates++; lastCompletedDate = date; failedDate = '';
      return diagnostic;
    });
    var groups = { VALID: [], PARTIAL: [], MISMATCH: [], CONFLICT: [], SOURCE_INCOMPLETE: [], NO_SNAPSHOT: [] };
    diagnostics.forEach(function(item) { (groups[item.status] || (groups[item.status] = [])).push(item.date); });
    var requestedCandidates = String(candidatesStr || '').split(',').map(function(value) { return _normalizeDate(value.trim()); }).filter(Boolean);
    var calculationMs = Date.now() - calculationStarted;
    return jsonOk({ checkedDates: dates, validDates: groups.VALID, partialDates: groups.PARTIAL,
      mismatchDates: groups.MISMATCH, conflictDates: groups.CONFLICT,
      sourceIncompleteDates: groups.SOURCE_INCOMPLETE, noSnapshotDates: groups.NO_SNAPSHOT,
      priceSuspiciousDates: groups.PRICE_SUSPICIOUS || [], abnormalCandidates: requestedCandidates, diagnostics: diagnostics,
      priceIntegrity: { counts: priceIntegrity.counts, checkedRows: priceIntegrity.checkedRows }, integritySourceRevision: _getSnapshotIntegritySourceRevision(),
      performance: { totalMs: Date.now() - totalStarted, readMs: context.readMs, indexBuildMs: indexed.indexBuildMs, calculationMs: calculationMs,
        checkedDates: dates.length, priceHistoryRows: context.metrics.priceHistoryRows, snapshotRows: context.metrics.snapshotRows,
        tradeRows: context.metrics.tradeRows, fundNavRows: context.metrics.fundNavRows, fxRows: context.metrics.fxRows,
        sheetReads: context.metrics.sheetReads, holdingsBuildCount: indexed.metrics.holdingsBuildCount,
        priceSeriesBuildCount: indexed.metrics.priceSeriesBuildCount, priceIntegrityBuildCount: indexed.metrics.priceIntegrityBuildCount,
        snapshotDateLookupCount: indexed.metrics.snapshotDateLookupCount, fundNavLookupCount: indexed.metrics.fundNavLookupCount,
        fxLookupCount: indexed.metrics.fxLookupCount } });
  } catch (error) {
    var safeMessage = String(error && error.message || error || '원인 미확인').replace(/(token|secret|apikey|api_key)\s*[=:]\s*[^\s,;]+/ig, '$1=[REDACTED]');
    return jsonOk({ status: 'error', errorCode: error.errorCode || (phase === 'sheet_read' || phase === 'index_build' ? 'SOURCE_DATA_ERROR' : 'RUNTIME_ERROR'),
      phase: phase, message: safeMessage, failedDate: failedDate, processedDates: processedDates, totalDates: dates.length,
      lastCompletedDate: lastCompletedDate, performanceSoFar: { totalMs: Date.now() - totalStarted } });
  }
}

function handleRewriteSnapshotDate(dateStr, operationId, finalize) {
  var lock = LockService.getScriptLock(), ownsLock = false;
  var rewriteOperationId = '';
  try {
    if (!lock.hasLock()) { lock.waitLock(30000); ownsLock = true; }
    var ss = getss();
    rewriteOperationId = operationId ? 'rewriteSnapshotDate|' + String(operationId) : 'rewriteSnapshotDate|' + (_normalizeDate(dateStr) || 'invalid') + '|' + Utilities.getUuid();
    var before = diagnoseSnapshotIntegrity(ss, dateStr);
    if (['PARTIAL','MISMATCH','NO_SNAPSHOT'].indexOf(before.status) === -1) throw new Error('재작성 불가 상태: ' + before.status);
    if (before.sourceDataErrors.length || before.conflictKeys.length) throw new Error('원자료 부족 또는 충돌으로 기존 Snapshot을 보존합니다.');
    var protectedManual = before.storedRows.filter(function(row) { return before.unexpectedCodes.indexOf(_snapshotIntegrityKey(row)) !== -1 && String(row[10] || '').toUpperCase() === 'MANUAL'; });
    if (protectedManual.length) throw new Error('MANUAL 행 보호로 자동 재작성하지 않습니다: ' + protectedManual.map(_snapshotIntegrityKey).join(', '));
    var previousOperationId = _snapshotBackupOperationId;
    var failedExisting = _readSystemBackupRegistry().some(function(item) { return item.operationId === rewriteOperationId && item.status === 'WRITE_FAILED'; });
    if (failedExisting) throw new Error('실패한 Snapshot operationId는 재사용할 수 없습니다.');
    _snapshotBackupOperationId = rewriteOperationId;
    try { writeSnapshotRows(ss, before.date, before.expectedRows, true); }
    finally { _snapshotBackupOperationId = previousOperationId; }
    SpreadsheetApp.flush();
    var after = diagnoseSnapshotIntegrity(ss, before.date);
    if (after.status !== 'VALID') throw new Error('재작성 후 재진단 실패: ' + after.status);
    var shouldFinalize = !operationId || String(finalize) === '1';
    var cleanup = shouldFinalize ? _settleSnapshotBackupOperation(ss, rewriteOperationId, true) : null;
    return jsonOk({ before: before, after: after, rewritten: true, backupCleanup: cleanup });
  } catch (error) {
    if (rewriteOperationId) _settleSnapshotBackupOperation(getss(), rewriteOperationId, false, error.message);
    return jsonError('Snapshot 안전 재작성 실패: ' + error.message);
  } finally { if (ownsLock) lock.releaseLock(); }
}

function _readSnapshotRowsByDate(ss, dateStr) {
  var out = [];
  try {
    var sh = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
    if (!sh || sh.getLastRow() < 2) return out;
    // ★ 12콸럼으로 확장 읽기 (11=소스, 12=저장일시)
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(12, sh.getLastColumn())).getValues();
    data.forEach(function(r) {
      if (_normalizeDate(r[0]) !== dateStr) return;
      out.push([
        dateStr,
        _cleanCode(r[1]) || (r[1] || '').toString().trim(),
        (r[2] || '').toString().trim(),
        parseFloat(r[3]) || 0,
        parseFloat(r[4]) || 0,
        parseFloat(r[5]) || 0,
        parseFloat(r[6]) || 0,
        parseFloat(r[7]) || 0,
        parseFloat(r[8]) || 0,
        parseFloat(r[9]) || 0,
        (r[10] || '').toString().trim(),
        (r[11] || '').toString().trim()  // ★ savedAt
      ]);
    });
  } catch (e) {
    Logger.log('⚠️ 스냅샷 기존 데이터 조회 실패(' + dateStr + '): ' + e.message);
    throw e;
  }
  return _dedupeSnapshotRows(out);
}

function _snapshotRowsSignature(rows) {
  var norm = _dedupeSnapshotRows(rows || []).slice();
  norm.sort(function(a, b) {
    var ak = (_normalizeDate(a[0]) || '') + '|' + (_cleanCode(a[1]) || (a[2] || '').toString().trim());
    var bk = (_normalizeDate(b[0]) || '') + '|' + (_cleanCode(b[1]) || (b[2] || '').toString().trim());
    return ak.localeCompare(bk);
  });
  return JSON.stringify(norm);
}

// 가격이력에는 외화 종목 가격만 있고 날짜별 환율 이력은 없으므로, 과거 날짜를
// 현재 환율로 다시 계산하지 않습니다. 전체 강제 재작성에서는 국내 행만 새로 만들고
// 기존 외화 행은 그대로 합칩니다.
function _preserveExistingForeignSnapshotRows(ss, existingRows, expectedRows) {
  var foreignCodes = {};
  getCodeItems(ss, true).forEach(function(item) {
    if (item.code && item.currency && item.currency !== 'KRW') foreignCodes[_cleanCode(item.code) || item.code] = true;
  });
  var isForeign = function(row) {
    var code = _cleanCode(row && row[1]) || ((row && row[1]) || '').toString().trim();
    return !!foreignCodes[code];
  };
  return _dedupeSnapshotRows(
    (expectedRows || []).filter(function(row) { return !isForeign(row); })
      .concat((existingRows || []).filter(isForeign))
  );
}

function _getPriceSourceByDate(ss, dateStr, throwOnError) {
  var out = {};
  try {
    var ph = ss.getSheetByName(CONFIG.SHEET_PH);
    if (!ph || ph.getLastRow() < 2) return out;
    var data = ph.getRange(2, 1, ph.getLastRow() - 1, Math.max(6, ph.getLastColumn())).getValues();

    // ★ [버그수정] 두 단계로 처리:
    //   1단계: dateStr 당일 소스 수집
    //   2단계: 당일 소스 없는 종목 → 가장 최근 MANUAL 소스 fallback
    //   이유: KRX fallback으로 전일 날짜에 저장된 경우 당일 sourceMap이 비어있어
    //         MANUAL 가격임에도 소스가 PRICE_HISTORY로 잘못 표시됨
    var meta = {};       // 당일 소스
    var latestManual = {}; // 종목별 가장 최근 MANUAL { src, savedAt, date }

    data.forEach(function(r) {
      var d = _normalizeDate(r[0]);
      var code = _cleanCode(r[1]) || (r[1] || '').toString().trim();
      var name = (r[2] || '').toString().trim();
      var src = (r[5] || '').toString().trim();
      if (!src) return;
      var savedAt = _normalizeDatetime(r[4]);
      var key = code || name;
      if (!key) return;

      // 당일 소스 수집
      if (d === dateStr) {
        if (!meta[key] || (savedAt && !meta[key].savedAt)) {
          meta[key] = { src: src, savedAt: savedAt };
        }
      }
      // MANUAL 최근값 추적 (날짜 무관, dateStr 이하만)
      if (src === 'MANUAL' && savedAt && d <= dateStr) {
        if (!latestManual[key] || d > latestManual[key].date ||
            (d === latestManual[key].date && savedAt > latestManual[key].savedAt)) {
          latestManual[key] = { src: 'MANUAL', savedAt: savedAt, date: d };
        }
      }
    });

    // 당일 소스 우선, 없으면 최근 MANUAL fallback
    var allKeys = {};
    Object.keys(meta).forEach(function(k){ allKeys[k] = true; });
    Object.keys(latestManual).forEach(function(k){ allKeys[k] = true; });
    Object.keys(allKeys).forEach(function(k) {
      if (meta[k]) {
        out[k] = meta[k];
      } else if (latestManual[k]) {
        // 당일 소스 없고 최근 MANUAL 있으면 MANUAL로 표시
        out[k] = { src: 'MANUAL', savedAt: latestManual[k].savedAt };
      }
    });
  } catch (e) {
    Logger.log('⚠️ 가격소스 조회 실패(' + dateStr + '): ' + e.message);
    if (throwOnError) throw e;
  }
  return out;
}

function _updateTodaySnapshotSource(ss, dateStr, sourceByCode) {
  if (!sourceByCode || Object.keys(sourceByCode).length === 0) return 0;
  var sh = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
  if (!sh || sh.getLastRow() < 2) return 0;
  var rowCount = sh.getLastRow() - 1;
  var data = sh.getRange(2, 1, rowCount, Math.max(12, sh.getLastColumn())).getValues();
  var sourceCells = data.map(function(row) { return [(row[10] || '').toString().trim(), (row[11] || '').toString().trim()]; });
  var changed = 0;
  data.forEach(function(row, index) {
    if (_normalizeDate(row[0]) !== dateStr) return;
    var code = _cleanCode(row[1]) || (row[1] || '').toString().trim();
    var nextSource = code ? (sourceByCode[code] || '') : '';
    var currentSource = (row[10] || '').toString().trim();
    if (!nextSource || currentSource === 'MANUAL' || currentSource === nextSource) return;
    sourceCells[index] = [nextSource, ''];
    changed++;
  });
  if (changed > 0) {
    sh.getRange(2, 11, rowCount, 2).setValues(sourceCells);
    _touchSnapshotIntegritySourceRevision({ date: dateStr });
  }
  return changed;
}

function _isManualKeepLatestEnabled() {
  return false;
}

function _getPriceSourceMode() {
  // 주식·ETF 가격에는 GOOGLEFINANCE를 사용하지 않습니다.
  return 'toss_first';
}

function _priceSourceModeLabel() {
  return '📡 가격소스: Toss 우선 → KRX/공공데이터 → 저장이력';
}

function togglePriceSourceMode() {
  var msg = '⚙️ 주식·ETF 가격소스는 Toss 우선 → KRX/공공데이터 → 저장이력으로 고정됩니다.';
  Logger.log(msg);
  try {
    SpreadsheetApp.getUi().alert(
      msg +
      '\n※ 조회 실패·누락 시 기존 확정 가격과 갱신시각을 보존합니다.'
    );
  } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}

function toggleManualKeepLatestOption() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('manual_keep_latest', 'false');
  var msg = '⚙️ 수동가격 날짜별 이력 보존: ON\n과거 스냅샷 재현을 위해 최신값만 유지 옵션은 사용하지 않습니다.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}

function _pruneManualPriceHistoryKeepLatest(ss, code, name) {
  var ph = ss.getSheetByName(CONFIG.SHEET_PH);
  if (!ph || ph.getLastRow() < 2) return 0;

  var readCols = ph.getLastColumn() >= 5 ? 5 : 4;
  var data = ph.getRange(2, 1, ph.getLastRow() - 1, readCols).getValues();
  var key = _cleanCode(code) || (name || '').toString().trim();
  if (!key) return 0;

  var matches = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var rowCode = _cleanCode(row[1]) || (row[1] || '').toString().trim();
    var rowName = (row[2] || '').toString().trim();
    var rowKey = rowCode || rowName;
    if (rowKey !== key) continue;

    var savedAt = _normalizeDatetime(row[4]);
    if (!savedAt) continue; // 수동입력(savedAt 있음)만 정리
    var date = _normalizeDate(row[0]);
    matches.push({ rowNo: i + 2, savedAt: savedAt, date: date });
  }
  if (matches.length <= 1) return 0;

  matches.sort(function(a, b) {
    var ak = (a.savedAt || a.date || '') + '#' + _pad(a.rowNo);
    var bk = (b.savedAt || b.date || '') + '#' + _pad(b.rowNo);
    return ak.localeCompare(bk);
  });

  var keepRow = matches[matches.length - 1].rowNo;
  var toDelete = matches
    .filter(function(m){ return m.rowNo !== keepRow; })
    .map(function(m){ return m.rowNo; })
    .sort(function(a,b){ return b-a; }); // 아래서부터 삭제

  toDelete.forEach(function(rowNo){ ph.deleteRow(rowNo); });
  if (toDelete.length) _touchSnapshotIntegritySourceRevision({ all: true });
  SpreadsheetApp.flush();
  return toDelete.length;
}

// ════════════════════════════════════════════════════════════════════
//  내부 — 가격이력 시트 특정 날짜 행 읽기
// ════════════════════════════════════════════════════════════════════
function getPriceHistoryRow(ss, dateStr, throwOnError) {
  try {
    var ph = ss.getSheetByName(CONFIG.SHEET_PH);
    if (!ph || ph.getLastRow() < 2) return {};
    var readCols = ph.getLastColumn() >= 5 ? 5 : 4;
    var data   = ph.getRange(2, 1, ph.getLastRow() - 1, readCols).getValues();
    var result = {};
    var legacyToCanonical = {};
    getCodeItems(ss, throwOnError).forEach(function(item) {
      var canonical = item.code;
      var legacy = _legacyDigitsCode(item.code);
      if (legacy && canonical && legacy !== canonical) legacyToCanonical[legacy] = canonical;
    });
    data.forEach(function(row) {
      if (_normalizeDate(row[0]) !== dateStr) return;
      var code  = _cleanCode(row[1]) || (row[1] || '').toString().trim();
      var name  = (row[2] || '').toString().trim();
      var price = parseFloat(row[3]) || 0;
      var key   = code || name;
      if (key && price > 0) {
        var existing = result[key];
        // 같은 날짜에서 수동입력 행(savedAt 있음) 우선
        if (!(existing && existing._savedAt && !(_normalizeDatetime(row[4])))) {
          var savedAt = _normalizeDatetime(row[4]);
          result[key] = { _price: price, _savedAt: savedAt };
          if (code && legacyToCanonical[code]) result[legacyToCanonical[code]] = { _price: price, _savedAt: savedAt };
        }
      }
    });
    Object.keys(result).forEach(function(k) { result[k] = result[k]._price; });
    return result;
  } catch(err) {
    Logger.log('❌ getPriceHistoryRow 실패: ' + err.message);
    if (throwOnError) throw err;
    return {};
  }
}

// ════════════════════════════════════════════════════════════════════
//  내부 — 가격이력 시트에서 지정 코드들의 가장 최근 날짜 가격 조회
// ════════════════════════════════════════════════════════════════════
function getLatestPriceHistory(ss, codes, maxDate, throwOnError) {
  var entries = getLatestPriceHistoryEntries(ss, codes, maxDate, throwOnError);
  var result = {};
  Object.keys(entries).forEach(function(key) { result[key] = entries[key].price; });
  return result;
}

// 최신 가격뿐 아니라 실제 가격이력 날짜도 함께 반환합니다.
// KRX fallback 날짜보다 저장 이력이 최신인지 비교할 때 사용합니다.
function getLatestPriceHistoryEntries(ss, codes, maxDate, throwOnError) {
  try {
    var ph = ss.getSheetByName(CONFIG.SHEET_PH);
    if (!ph || ph.getLastRow() < 2) return {};
    var readCols = ph.getLastColumn() >= 6 ? 6 : (ph.getLastColumn() >= 5 ? 5 : 4);
    var data   = ph.getRange(2, 1, ph.getLastRow() - 1, readCols).getValues();
    var codeAliasToCanonical = _buildCodeAliasMap(codes);
    // code → { date, price } 최신값 유지
    var latest = {};
    data.forEach(function(row) {
      var date  = _normalizeDate(row[0]);
      var code  = _cleanCode(row[1]) || (row[1] || '').toString().trim();
      var name  = (row[2] || '').toString().trim();
      var price = parseFloat(row[3]) || 0;
      var key   = code || name;
      if (!date || !key || price <= 0 || (maxDate && date > maxDate)) return;
      var outKey = codeAliasToCanonical[key];
      if (!outKey) return;
      var savedAt = _normalizeDatetime(row[4]);
      if (!latest[outKey] || date > latest[outKey].date) {
        latest[outKey] = { date: date, price: price, savedAt: savedAt, source: String(row[5] || '') };
      } else if (date === latest[outKey].date) {
        // 같은 날짜라면 수동입력(savedAt 있음) 값 우선
        if (!latest[outKey].savedAt && savedAt) {
          latest[outKey] = { date: date, price: price, savedAt: savedAt, source: String(row[5] || '') };
        }
      }
    });
    return latest;
  } catch(err) {
    Logger.log('❌ getLatestPriceHistoryEntries 실패: ' + err.message);
    if (throwOnError) throw err;
    return {};
  }
}

// 기준일 이전 가격이 전혀 없는 최초 구간에서만 사용할 가장 가까운 이후 가격입니다.
// 일반적인 누락일은 getLatestPriceHistory()의 직전값을 우선하므로 미래 가격이 덮어쓰지 않습니다.
function getEarliestPriceHistory(ss, codes, minDate, throwOnError) {
  try {
    var ph = ss.getSheetByName(CONFIG.SHEET_PH);
    if (!ph || ph.getLastRow() < 2) return {};
    var data = ph.getRange(2, 1, ph.getLastRow() - 1, 4).getValues();
    var codeAliasToCanonical = _buildCodeAliasMap(codes);
    var earliest = {};
    data.forEach(function(row) {
      var date = _normalizeDate(row[0]);
      var code = _cleanCode(row[1]) || (row[1] || '').toString().trim();
      var name = (row[2] || '').toString().trim();
      var price = parseFloat(row[3]) || 0;
      var outKey = codeAliasToCanonical[code || name];
      if (!date || !outKey || price <= 0 || (minDate && date < minDate)) return;
      if (!earliest[outKey] || date < earliest[outKey].date) earliest[outKey] = { date: date, price: price };
    });
    var result = {};
    Object.keys(earliest).forEach(function(key) { result[key] = earliest[key].price; });
    return result;
  } catch(err) {
    Logger.log('❌ getEarliestPriceHistory 실패: ' + err.message);
    if (throwOnError) throw err;
    return {};
  }
}

// 기준일 이전 가격이 전혀 없는 최초 구간에서만 사용할 가장 가까운 이후 가격입니다.
// 일반적인 누락일은 getLatestPriceHistory()의 직전값을 우선하므로 미래 가격이 덮어쓰지 않습니다.

function _getLatestPriceHistoryDate(ss, maxDate) {
  try {
    var ph = ss.getSheetByName(CONFIG.SHEET_PH);
    if (!ph || ph.getLastRow() < 2) return '';
    var values = ph.getRange(2, 1, ph.getLastRow() - 1, 1).getValues();
    var latest = '';
    values.forEach(function(row) {
      var date = _normalizeDate(row[0]);
      if (!date || (maxDate && date > maxDate)) return;
      if (date > latest) latest = date;
    });
    return latest;
  } catch(err) {
    Logger.log('❌ _getLatestPriceHistoryDate 실패: ' + err.message);
    return '';
  }
}


function batchUpsertPriceHistory(ss, dateStr, items) {
  if (!items || items.length === 0) return;
  try {
    var ph = ss.getSheetByName(CONFIG.SHEET_PH);
    if (!ph) {
      ph = ss.insertSheet(CONFIG.SHEET_PH);
      ph.getRange(1,1,1,6).setValues([['날짜','종목코드','종목명','가격','입력일시','가격소스']]);
      ph.getRange(1,1,1,6).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
      ph.setColumnWidth(1,100); ph.setColumnWidth(2,100);
      ph.setColumnWidth(3,200); ph.setColumnWidth(4,100); ph.setColumnWidth(6,140);
    }
    _setCodeColumnText(ph, 2);

    var lastRow     = ph.getLastRow();
    var existingMap = {};   // key → 행번호
    var manualSet   = {};   // key → true (MANUAL 보호 대상)
    if (lastRow > 1) {
      // ★ [버그수정] 날짜 _normalizeDate() 적용 — Date 객체가 'Mon Apr 13...' 형태로
      //   읽혀 중복 감지 실패하던 문제 수정. 6컬럼(소스)까지 읽어 MANUAL 여부 판단
      var readCols = Math.min(6, ph.getLastColumn());
      var data = ph.getRange(2, 1, lastRow - 1, readCols).getValues();
      data.forEach(function(row, i) {
        var d = _normalizeDate(row[0]);
        var c = _cleanCode(row[1]) || (row[2]||'').toString().trim();
        if (!d || !c) return;
        var mapKey = d + '|' + c;
        existingMap[mapKey] = i + 2;
        // ★ MANUAL 소스인 행은 보호 대상으로 표시
        var src = (row[5] || '').toString().trim().toUpperCase();
        if (src === 'MANUAL') manualSet[mapKey] = true;
      });
    }

    var toAppend = [];
    var toUpdate = [];
    items.forEach(function(item) {
      var cleanedCode = _cleanCode(item.code);
      var rawName     = (item.name || '').toString().trim();
      var cleanedName = (rawName && isNaN(Number(rawName))) ? rawName : '';
      var normDateStr = _normalizeDate(dateStr) || dateStr;
      var key         = normDateStr + '|' + (cleanedCode || cleanedName);

      if (existingMap[key]) {
        // ★ [버그수정] 이미 MANUAL로 저장된 행은 자동조회(KRX/GF)로 덮어쓰지 않음
        var incomingSrc = (item.source || '').toString().trim().toUpperCase();
        var isIncomingManual = (incomingSrc === 'MANUAL');
        if (manualSet[key] && !isIncomingManual) return; // MANUAL 보호
        toUpdate.push({ row: existingMap[key], price: item.price, source: (item.source || ''),
                        savedAt: (item.savedAt || ''), isManual: isIncomingManual });
      } else {
        toAppend.push([normDateStr, cleanedCode, cleanedName, item.price, (item.savedAt || ''), (item.source || '')]);
      }
    });

    if (toUpdate.length > 0) {
      toUpdate.sort(function(a, b) { return a.row - b.row; });
      var i = 0;
      while (i < toUpdate.length) {
        var startRow = toUpdate[i].row;
        var prices   = [toUpdate[i].price];
        while (i + 1 < toUpdate.length && toUpdate[i + 1].row === toUpdate[i].row + 1) {
          i++;
          prices.push(toUpdate[i].price);
        }
        ph.getRange(startRow, 4, prices.length, 1).setValues(prices.map(function(p){ return [p]; }));
        i++;
      }
      // ★ savedAt + source 배치 업데이트 — 행마다 2번 setValue → 연속행 묶음 setValues
      toUpdate.sort(function(a, b) { return a.row - b.row; });
      var j = 0;
      while (j < toUpdate.length) {
        var sr = toUpdate[j].row;
        var batch = [[toUpdate[j].isManual ? (toUpdate[j].savedAt || '') : '', toUpdate[j].source || '']];
        while (j + 1 < toUpdate.length && toUpdate[j + 1].row === toUpdate[j].row + 1) {
          j++;
          batch.push([toUpdate[j].isManual ? (toUpdate[j].savedAt || '') : '', toUpdate[j].source || '']);
        }
        ph.getRange(sr, 5, batch.length, 2).setValues(batch);
        j++;
      }
    }
    if (toAppend.length > 0) {
      ph.getRange(ph.getLastRow() + 1, 1, toAppend.length, 6).setValues(_normalizeCodeRows(toAppend, 1));
    }
    if (toUpdate.length || toAppend.length) _touchSnapshotIntegritySourceRevision({ from: dateStr });
    SpreadsheetApp.flush();
  } catch(err) {
    Logger.log('❌ batchUpsertPriceHistory 실패: ' + err.message);
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════
//  내부 — 가격이력 시트 upsert (단건)
// ════════════════════════════════════════════════════════════════════
function upsertPriceHistory(ss, dateStr, code, name, price, savedAt, source) {
  try {
    var ph = ss.getSheetByName(CONFIG.SHEET_PH);
    if (!ph) {
      ph = ss.insertSheet(CONFIG.SHEET_PH);
      ph.getRange(1,1,1,6).setValues([['날짜','종목코드','종목명','가격','입력일시','가격소스']]);
      ph.getRange(1,1,1,6).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
      ph.setColumnWidth(1,100); ph.setColumnWidth(2,100);
      ph.setColumnWidth(3,200); ph.setColumnWidth(4,100); ph.setColumnWidth(6,140);
    }
    _setCodeColumnText(ph, 2);
    var cleanedCode = _cleanCode(code);
    var rawName     = (name || '').toString().trim();
    var cleanedName = (rawName && isNaN(Number(rawName))) ? rawName : '';
    var matchKey    = cleanedCode || cleanedName;
    var lastRow     = ph.getLastRow();
    if (lastRow > 1) {
      var data = ph.getRange(2, 1, lastRow - 1, Math.max(6, ph.getLastColumn())).getValues();
      for (var i = 0; i < data.length; i++) {
        var rowDate = _normalizeDate(data[i][0]);
        var rowCode = data[i][1].toString().trim();
        var rowName = data[i][2].toString().trim();
        var rowKey  = rowCode || rowName;
        if (rowDate === dateStr && rowKey === matchKey) {
          // ★ 수동저장(savedAt 있음)이면 항상 덮어씌움
          // ★ 기존 행이 자동조회(savedAt 없음)였어도 수동저장으로 업그레이드
          // ★ 3번 setValue → 1번 setValues로 최적화
          ph.getRange(i + 2, 4, 1, 3).setValues([[price, (savedAt || ''), (source || '')]]);
          _touchSnapshotIntegritySourceRevision({ from: dateStr });
          SpreadsheetApp.flush();
          return;
        }
      }
    }
    ph.getRange(ph.getLastRow() + 1, 1, 1, 6).setValues([[dateStr, String(cleanedCode), cleanedName, price, (savedAt || ''), (source || '')]]);
    _touchSnapshotIntegritySourceRevision({ from: dateStr });
    SpreadsheetApp.flush();
  } catch(err) {
    Logger.log('❌ upsertPriceHistory 실패: ' + err.message);
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════
//  보유현황 동기화
// ════════════════════════════════════════════════════════════════════
function handleSyncHoldings(dataJson) {
  try {
    var holdings;
    try { holdings = _parseArrayParam(dataJson, 'holdings'); } catch(e) { return jsonError(e.message); }
    if (!Array.isArray(holdings)) return jsonError('배열 형식 필요');

    var ss = getss();
    var sh = ss.getSheetByName(CONFIG.SHEET_HOLD);
    if (!sh) {
      sh = ss.insertSheet(CONFIG.SHEET_HOLD);
      sh.setColumnWidth(1,90); sh.setColumnWidth(2,180);
      sh.setColumnWidth(3,70); sh.setColumnWidth(4,110); sh.setColumnWidth(5,100);
      sh.setColumnWidth(6,100); sh.setColumnWidth(7,120);
    }
    sh.clearContents();
    _setCodeColumnText(sh, 1);
    sh.getRange(1,1,1,7).setValues([['종목코드','종목명','수량','매수단가','매수원금','자산유형','계좌']]);
    sh.getRange(1,1,1,7).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
    if (holdings.length > 0) {
      var rows = holdings.map(function(h) {
        var qty = parseFloat(h.qty) || 0;
        var costAmt = parseFloat(h.costAmt) || 0;
        var costUnit = qty > 0 ? parseFloat((costAmt / qty).toFixed(2)) : 0;
        return [h.code||'', h.name||'', qty, costUnit, costAmt, h.assetType||'주식', h.acct||''];
      });
      sh.getRange(2, 1, rows.length, 7).setValues(_normalizeCodeRows(rows, 0));
    }
    SpreadsheetApp.flush();
    return jsonOk({ synced: holdings.length });
  } catch(err) {
    return jsonError('syncHoldings 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  거래이력 동기화
// ════════════════════════════════════════════════════════════════════
function handleSyncTrades(dataJson) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    lock.waitLock(30000); locked = true;
    var trades;
    try { trades = _parseArrayParam(dataJson, 'trades'); } catch(e) { return jsonError(e.message); }
    if (!Array.isArray(trades)) return jsonError('배열 형식 필요');

    var ss = getss();
    var sh = ss.getSheetByName(CONFIG.SHEET_TRADES);
    var createdTradeSheet = !sh;
    var previousRows = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, Math.min(11, sh.getLastColumn())).getValues() : [];
    if (!sh) {
      sh = ss.insertSheet(CONFIG.SHEET_TRADES);
      sh.setColumnWidth(1,100); sh.setColumnWidth(2,70);  sh.setColumnWidth(3,100);
      sh.setColumnWidth(4,180); sh.setColumnWidth(5,90);  sh.setColumnWidth(6,70);
      sh.setColumnWidth(7,90);  sh.setColumnWidth(8,80);  sh.setColumnWidth(9,200);
    }
    var tradeBackup = previousRows.length ? _backupSheetBeforeWrite(ss, sh, CONFIG.SHEET_TRADES) : null;
    sh.clearContents();
    _setCodeColumnText(sh, 5);
    sh.getRange(1,1,1,11).setValues([['날짜','매수/매도','계좌','종목명','종목코드','수량','단가','자산유형','메모','비율','단주정산']]);
    sh.getRange(1,1,1,11).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
    if (trades.length > 0) {
      trades.sort(function(a,b){ return (a.date||'').localeCompare(b.date||''); });
      var rows = trades.map(function(t) {
        return [_normalizeDate(t.date), t.tradeType||'', t.acct||'', t.name||'',
                t.code||'', t.qty||0, t.price||0, t.assetType||'주식', t.memo||'',
                t.ratio || '', t.fractionalCash || ''];
      });
      sh.getRange(2, 1, rows.length, 11).setValues(_normalizeCodeRows(rows, 4));
    }
    SpreadsheetApp.flush();
    var currentRows = trades.map(function(t) { return [_normalizeDate(t.date), t.tradeType||'', t.acct||'', t.name||'', t.code||'', t.qty||0, t.price||0, t.assetType||'주식', t.memo||'', t.ratio || '', t.fractionalCash || '']; });
    if (currentRows.length) _verifyWrittenRange(sh, 2, 1, _normalizeCodeRows(currentRows, 4), '거래이력 쓰기 후 검증 실패');
    else if (sh.getLastRow() !== 1) throw new Error('빈 거래이력 쓰기 후 검증 실패');
    var affectedFrom = _earliestChangedTradeDate(previousRows, currentRows);
    if (affectedFrom) _touchSnapshotIntegritySourceRevision({ from: affectedFrom });
    else if (createdTradeSheet) _touchSnapshotIntegritySourceRevision({ all: true });
    var snapshotRebuild = null;
    var affectedTo = _latestConfirmedSnapshotDate(ss);
    if (affectedFrom && affectedTo && affectedFrom <= affectedTo) snapshotRebuild = rebuildDailySnapshots(affectedFrom, affectedTo);
    if (snapshotRebuild && snapshotRebuild.errors && snapshotRebuild.errors.length) {
      throw new Error('Snapshot rebuild 부분 실패: ' + snapshotRebuild.errors.map(function(item) { return item.date + ': ' + item.message; }).join('; '));
    }
    _markSnapshotBackupStatus(tradeBackup, 'COMPLETED');
    var tradeBackupCleanup = tradeBackup ? _cleanupCurrentSystemBackup(ss, tradeBackup) : null;
    return jsonOk({ synced: trades.length, affectedFrom: affectedFrom, affectedTo: affectedTo, snapshotRebuild: snapshotRebuild, backupCleanup: tradeBackupCleanup });
  } catch(err) {
    if (typeof tradeBackup !== 'undefined' && tradeBackup) _markSnapshotBackupStatus(tradeBackup, 'WRITE_FAILED', err.message);
    return jsonError('syncTrades 실패: ' + err.message);
  } finally {
    if (locked) lock.releaseLock();
  }
}

function _earliestChangedTradeDate(beforeRows, afterRows) {
  var counts = {}, dates = {};
  var add = function(row, delta) {
    var normalized = (row || []).slice(0, 11);
    normalized[0] = _normalizeDate(normalized[0]);
    var key = JSON.stringify(normalized);
    counts[key] = (counts[key] || 0) + delta;
    if (normalized[0]) dates[key] = normalized[0];
  };
  (beforeRows || []).forEach(function(row) { add(row, 1); });
  (afterRows || []).forEach(function(row) { add(row, -1); });
  return Object.keys(counts).filter(function(key) { return counts[key] !== 0 && dates[key]; })
    .map(function(key) { return dates[key]; }).sort()[0] || '';
}

function _latestConfirmedSnapshotDate(ss) {
  var sh = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
  if (!sh || sh.getLastRow() < 2) return '';
  var latest = '';
  sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function(row) {
    var date = _normalizeDate(row[0]);
    if (date && date < today() && date > latest) latest = date;
  });
  return latest;
}

function _getPrevTradingDay(fromDateStr, maxDaysBack) {
  var max = maxDaysBack || 7;
  var dt  = new Date(fromDateStr + 'T00:00:00');
  for (var i = 1; i <= max; i++) {
    dt.setDate(dt.getDate() - 1);
    var dow = dt.getDay();
    if (dow === 0 || dow === 6) continue; // 주말 건너뜀
    return Utilities.formatDate(dt, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════
//  가격이력·스냅샷 일치 보장 — 전일(T-1) 확정 종가 기준 정합성 유지
//
//  [기존 문제]
//  - 16:20 트리거에서 "당일" 종가를 저장하는데, 장 마감(15:30) 직후라
//    KRX가 전일 종가를 반환하는 경우가 있음
//  - 가격이력만 이후에 보정되고 스냅샷은 재작성되지 않으면
//    가격이력·스냅샷 단가 불일치가 발생
//
//  [해결]
//  - 전일(T-1) KRX 확정 종가를 명시적으로 가져와 가격이력에 저장
//  - 전일 가격이력과 전일 스냅샷을 비교 → 불일치 시 스냅샷 재작성
//  - 실행일(T) 행을 만들지 않고 확정 종가 거래일(T-1) 스냅샷만 작성
// ════════════════════════════════════════════════════════════════════
// 정규 KRX 가격을 얻지 못했는데 FUND_NAV 행 날짜로 마감이 성공하는 오류 방지.
// 2026 KRX 공시 휴장일(거래소 증시일정 기준). 다른 연도·임시 휴장은 임의 추정하지 않고 보수적으로 판정합니다.
// 신규 연도 휴장일 등록은 별도 정합성 검증 대상으로 취급합니다.
var KRX_CONFIRMED_CLOSED_DATES_2026 = {
  '2026-01-01':1, '2026-02-16':1, '2026-02-17':1, '2026-02-18':1,
  '2026-03-02':1, '2026-05-01':1, '2026-05-05':1, '2026-05-25':1,
  '2026-06-03':1, '2026-07-17':1, '2026-08-17':1, '2026-09-24':1,
  '2026-09-25':1, '2026-10-05':1, '2026-10-09':1, '2026-12-25':1, '2026-12-31':1
};
function _countBusinessWeekdaysBetween(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return Infinity;
  var count = 0;
  for (var date = _fundDateOffset(from, 1); date <= to; date = _fundDateOffset(date, 1)) {
    var day = new Date(date + 'T00:00:00Z').getUTCDay();
    if (day !== 0 && day !== 6 && !KRX_CONFIRMED_CLOSED_DATES_2026[date]) count++;
  }
  return count;
}

function _assessDailyKrxStockClose(items, prices, requestedDate) {
  var listed = (items || []).filter(function(item) {
    var code = _cleanCode(item && item.code) || String(item && item.code || '').trim();
    return code && !_isFundCode(code) && String(item && item.currency || 'KRW').toUpperCase() === 'KRW';
  });
  if (!listed.length) return { required:false, date:'', confirmed:0, expected:0 };
  var evidence = prices && prices._krxMarketEvidence;
  var codeMarkets = evidence && evidence.codeMarkets || {};
  var byMarket = {}, records = [];
  listed.forEach(function(item) {
    var code = _cleanCode(item.code) || String(item.code || '').trim();
    var market = String(item.market || '').toUpperCase();
    var type = String(item.type || '').toUpperCase();
    var row = prices && prices[code];
    var source = String(row && row.source || '').toUpperCase();
    var date = _normalizeDate(row && row.usedDate || '');
    // KRX 시장 pack에서 실제로 확인한 종목코드→시장 분류가 코드 마스터의 'KR'보다 우선합니다.
    // OpenAPI pack에서도 코드를 못 찾은 KR 종목은 별도 미확인 그룹으로 묶어,
    // KOSPI 8/10 + KOSDAQ 0/2 같은 시장 누락이 70% 전체 평균에 가려지지 않게 합니다.
    var confirmedMarket = String(codeMarkets[code] || '').toUpperCase();
    var isValidClose = !!row && Number(row.price) > 0
      && (source === 'KRX' || source === 'KRX_OTP') && !!date && date <= requestedDate;
    var group = type === 'ETF' || market === 'ETF' ? 'ETF'
      : (confirmedMarket === 'KOSPI' || confirmedMarket === 'KOSDAQ' ? confirmedMarket
      : (market === 'KOSDAQ' || market === 'KOSPI' ? market
      : (isValidClose ? 'STOCK' : 'UNCLASSIFIED_KR')));
    var record = byMarket[group] || (byMarket[group] = { expected:0, dates:[] });
    record.expected++;
    if (!isValidClose) return;
    record.dates.push(date);
    records.push(date);
  });
  if (!records.length) throw new Error('일반 종목 KRX 확정 종가 0건: ' + requestedDate
    + ' · KRX AUTH_KEY/OTP·네트워크/응답을 확인하세요. 펀드 NAV 날짜로 대체할 수 없습니다.');
  var newestDate = records.slice().sort().pop();
  var newestCount = records.filter(function(date) { return date === newestDate; }).length;
  var lag = _countBusinessWeekdaysBetween(newestDate, requestedDate);
  if (lag > 2) throw new Error('일반 종목 확정 종가 오래됨: 요청 ' + requestedDate + ', 최근 KRX ' + newestDate
    + ' (KRX 거래일 ' + lag + '일 차이) · 가격 수집 경로 점검이 필요합니다.');
  Object.keys(byMarket).forEach(function(group) {
    var stat = byMarket[group];
    var matched = stat.dates.filter(function(date) { return date === newestDate; }).length;
    if (matched < Math.ceil(stat.expected * 0.7)) {
      throw new Error('일반 종목 KRX 확정 종가 시장별 부분 누락: ' + group + ' '
        + newestDate + ' (' + matched + '/' + stat.expected + '종목)');
    }
  });
  // OpenAPI는 실제 보유한 시장별 pack만 검증합니다. 보유하지 않은 시장의
  // 데이터 제공 장애가 정상 보유 종목의 마감까지 막아서는 안 됩니다.
  if (evidence && evidence.mode !== 'OTP') {
    ['KOSPI','KOSDAQ','ETF'].filter(function(market) {
      return !!byMarket[market];
    }).forEach(function(market) {
      var entry = evidence[market] || {};
      if (!(entry.count > 0) || entry.date !== newestDate) {
        throw new Error('KRX 공식 시장별 확정 종가 누락: ' + market
          + ' (기준 ' + newestDate + ', 수집 ' + (entry.date || '없음') + ')');
      }
    });
  }
  return { required:true, date:newestDate, confirmed:newestCount, expected:listed.length, lag:lag };
}

// 종목코드 마스터는 과거 매도·상장폐지 코드도 보존합니다.
// 확정 종가 검증과 수집은 요청 거래일에 실보유수량이 있는 코드만 사용합니다.
// Snapshot과 일일 KRX 보유판정에 같은 코드 기반 거래원장 계산을 사용합니다.
// 회사명/상품명 변경은 표시명만 바꾸며 보유수량·원가를 분리하지 않습니다.
function _calcCodeHoldingsAtDate(tradeRows, dateStr, nameToCode, displayByCode) {
  var recentNames = {};
  var canonicalTrades = (tradeRows || []).map(function(row) {
    var name = String(row[3] || '').trim();
    var code = _cleanCode(row[4]) || _cleanCode((nameToCode || {})[name]);
    if (!code) return row;
    var date = _normalizeDate(row[0]);
    if (name && date && date <= dateStr &&
        (!recentNames[code] || date >= recentNames[code].date)) {
      recentNames[code] = { date:date, name:name };
    }
    var clone = row.slice();
    clone[3] = code;
    clone[4] = code;
    return clone;
  });
  var holdings = calcHoldingsAtDate(canonicalTrades, dateStr, {});
  Object.keys(holdings).forEach(function(key) {
    var holding = holdings[key];
    var code = _cleanCode(holding && holding.code);
    if (!code) return;
    holding.name = String((displayByCode || {})[code] ||
      (recentNames[code] && recentNames[code].name) || code);
  });
  return holdings;
}

function _getDailyHeldCodeItems(ss, dateStr, catalog) {
  if (!dateStr) return [];
  var tradeSheet = ss.getSheetByName(CONFIG.SHEET_TRADES);
  if (!tradeSheet || tradeSheet.getLastRow() < 2) return [];
  var tradeRows = tradeSheet.getRange(2, 1, tradeSheet.getLastRow() - 1,
    Math.min(11, tradeSheet.getLastColumn())).getValues();
  var nameToCode = {};
  (catalog || []).forEach(function(item) {
    if (item.name && item.code) nameToCode[item.name] = item.code;
  });
  tradeRows.forEach(function(row) {
    var name = String(row[3] || '').trim();
    var code = _cleanCode(row[4]) || String(row[4] || '').trim();
    if (name && code && !nameToCode[name]) nameToCode[name] = code;
  });
  var holdings = _calcCodeHoldingsAtDate(tradeRows, dateStr, nameToCode);
  var heldCodes = {};
  Object.keys(holdings).forEach(function(name) {
    var holding = holdings[name];
    var code = _cleanCode(holding && holding.code);
    if (code && holding.qty > 0.0001 && !_isFundCode(code)) heldCodes[code] = true;
  });
  return (catalog || []).filter(function(item) {
    return !!heldCodes[_cleanCode(item && item.code)];
  });
}

function saveDailyPriceHistory() {
  var lock = LockService.getScriptLock();
  var locked = false;
  var props = PropertiesService.getScriptProperties();
  var startedAt = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  var snapshotOperationId = '', previousSnapshotOperationId = _snapshotBackupOperationId;
  try {
    lock.waitLock(30000);
    locked = true;
    var ss       = getss();
    var todayStr = today();
    var requestedPrevDay = _getPrevTradingDay(todayStr, 7);
    var snapshotDate = '';
    var confirmedSnapshotRows = [];

    var allItems = getCodeItems(ss);
    var items = _getDailyHeldCodeItems(ss, requestedPrevDay, allItems);
    // 마스터에 남은 전량매도·폐지 종목은 KRX 종가 확보율의 분모에서 제외합니다.
    Logger.log('[saveDailyPriceHistory] 종목코드 마스터 ' + allItems.length
      + '건, 해당 거래일 실보유 종목 ' + items.length + '건');
    // 펀드·TDF만 보유한 경우에도 아래 공통 생성기로 스냅샷을 평가합니다.
    if (items.length === 0) Logger.log('확정 종가 조회 대상 실보유 종목 없음 — 펀드·TDF 스냅샷 생성 계속');

    // ── Step 1: 전일(T-1) KRX 확정 종가 조회 및 가격이력 저장
    var prevPrices = {};
    if (requestedPrevDay) {
      Logger.log('[saveDailyPriceHistory] 전일 후보(' + requestedPrevDay + ') 확정 종가 조회 시작');
      try {
        var krxPrev = {};
        try {
          krxPrev = fetchPricesKrx(items, requestedPrevDay);
        } catch(krxError) {
          Logger.log('⚠️ 확정 거래일 KRX 조회 실패, GOOGLEFINANCE fallback 계속: ' + krxError.message);
        }
        var gfPrevItems = items.filter(function(item) {
          return !(krxPrev[item.code] && krxPrev[item.code].price > 0);
        });
        var gfPrev = gfPrevItems.length > 0 && _hasUsdPriceItems(items)
          ? fetchPricesGoogleFinance(gfPrevItems, requestedPrevDay, ss, { skipKrx: true })
          : {};
        // 공식 실제 종가 날짜·시장별 커버리지를 먼저 검증해 오래된 데이터 저장을 차단합니다.
        var closeVerification = _assessDailyKrxStockClose(items, krxPrev, requestedPrevDay);
        var prevSavedAt = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');

        // 확정 거래일 KRX 데이터와 필요한 GF fallback만 가격이력에 저장 (MANUAL 보호)
        var prevRowsByDate = {};
        items.forEach(function(item) {
          var p = krxPrev[item.code] || gfPrev[item.code];
          if (!p || !(p.price > 0)) return;
          prevPrices[item.code] = p.price;
          var actualPriceDate = p.usedDate || requestedPrevDay;
          if (!prevRowsByDate[actualPriceDate]) prevRowsByDate[actualPriceDate] = [];
          prevRowsByDate[actualPriceDate].push({ code: item.code, name: item.name, price: p.price,
                                                 savedAt: prevSavedAt, source: (p.source || 'GOOGLEFINANCE') });
        });
        var fetchedRowCount = 0;
        Object.keys(prevRowsByDate).forEach(function(actualDate) {
          var rowsForDate = prevRowsByDate[actualDate];
          batchUpsertPriceHistory(ss, actualDate, rowsForDate);
          fetchedRowCount += rowsForDate.length;
          Logger.log('[saveDailyPriceHistory] 실제 거래일(' + actualDate + ') 가격이력 저장: ' + rowsForDate.length + '건');
        });
        if (items.length > 0 && fetchedRowCount === 0) {
          throw new Error('상장 종목 확정 종가를 한 건도 가져오지 못했습니다.');
        }
      } catch(e) {
        Logger.log('⚠️ 확정 거래일 가격 조회·저장 실패: ' + e.message);
        throw e;
      }

      // ── Step 2: 이번 확정 거래일 스냅샷만 검증
      // 전체 과거 검증은 별도 배치 복구가 담당해 일일 자동화의 시트 접근량을 제한합니다.
      // 단순 평일 계산값이 아니라 가격이력에 실제 존재하는 최신 날짜를 기준으로 합니다.
      // 예: 24일 가격이력이 이미 있으면 KRX가 21일 fallback을 반환해도 24일 스냅샷을 생성합니다.
      // 펀드 NAV/이월 행이 더 최신이어도 일반 종목의 공식 마감 기준일로 오인하지 않습니다.
      snapshotDate = closeVerification.required
        ? closeVerification.date : _getLatestPriceHistoryDate(ss, requestedPrevDay);
      if (!snapshotDate) throw new Error('스냅샷 기준 확정 종가 날짜를 확인할 수 없습니다.');
      Logger.log('[saveDailyPriceHistory] 확정 거래일(' + snapshotDate + ') 스냅샷 정합성 검증');
      var expected = _buildSnapshotRowsFromTradeAndPriceHistory(ss, snapshotDate);
      var existingRows = _readSnapshotRowsByDate(ss, snapshotDate);
      var dailyRewritePlan = _snapshotRewritePlan(ss, snapshotDate, expected);
      if (dailyRewritePlan.unsafe.length) throw new Error('Snapshot 보호 충돌: ' + dailyRewritePlan.unsafe.map(function(item) { return item.classification + ': ' + item.reason; }).join('; '));
      if (dailyRewritePlan.needsRewrite) {
        snapshotOperationId = 'saveDailyPriceHistory|' + snapshotDate + '|' + Utilities.getUuid();
        _snapshotBackupOperationId = snapshotOperationId;
        writeSnapshotRows(ss, snapshotDate, expected, true);
        SpreadsheetApp.flush();
        Logger.log('✅ 확정 거래일(' + snapshotDate + ') 스냅샷 불일치·누락 → 재작성 완료');
      } else {
        Logger.log('ℹ️ 확정 거래일(' + snapshotDate + ') 스냅샷 이미 일치');
      }
      var savedIntegrity = diagnoseSnapshotIntegrity(ss, snapshotDate);
      if (savedIntegrity.status !== 'VALID') throw new Error('확정 거래일 Snapshot 재진단 실패: ' + savedIntegrity.status);
      confirmedSnapshotRows = expected;
    }

    // ── Step 3: 실행일(T) 스냅샷은 생성하지 않음
    // 확정 종가의 실제 거래일은 snapshotDate이므로 Step 2에서 그 날짜로만 저장합니다.
    if (!snapshotDate || confirmedSnapshotRows.length === 0) {
      throw new Error('확정 거래일 스냅샷 저장 대상 없음: 거래이력과 가격이력을 확인하세요');
    }

    SpreadsheetApp.flush();
    props.setProperty('snapshot_last_success_at', Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'));
    props.setProperty('snapshot_last_success_date', snapshotDate);
    props.deleteProperty('snapshot_last_failure_at');
    props.deleteProperty('snapshot_last_error');
    if (snapshotOperationId) _settleSnapshotBackupOperation(ss, snapshotOperationId, true);
    Logger.log('✅ saveDailyPriceHistory 완료: 확정 거래일(' + snapshotDate + '), 실행일(' + todayStr + ')');
    return { ok: true, date: snapshotDate, runDate: todayStr, rows: confirmedSnapshotRows.length, startedAt: startedAt };
  } catch(err) {
    if (snapshotOperationId) _settleSnapshotBackupOperation(typeof ss !== 'undefined' ? ss : getss(), snapshotOperationId, false, err.message);
    props.setProperty('snapshot_last_failure_at', Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'));
    props.setProperty('snapshot_last_error', ((err && err.message) ? err.message : String(err)).slice(0, 1000));
    Logger.log('❌ saveDailyPriceHistory 실패: ' + err.message);
    throw err;
  } finally {
    _snapshotBackupOperationId = previousSnapshotOperationId;
    if (locked) lock.releaseLock();
  }
}

var SNAPSHOT_REPAIR_STATE_KEY = 'snapshot_consistency_repair_state';
var SNAPSHOT_REPAIR_BATCH_SIZE = 3;

function _getAllPriceHistoryDates(ss, maxDate) {
  var ph = ss.getSheetByName(CONFIG.SHEET_PH);
  if (!ph || ph.getLastRow() < 2) return [];
  var found = {};
  ph.getRange(2, 1, ph.getLastRow() - 1, 1).getValues().forEach(function(row) {
    var date = _normalizeDate(row[0]);
    if (date && (!maxDate || date <= maxDate)) found[date] = true;
  });
  return Object.keys(found).sort();
}

function _clearSnapshotRepairContinuationTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'continueSnapshotConsistencyRepair') ScriptApp.deleteTrigger(trigger);
  });
}

function _hasSnapshotRepairContinuationTrigger() {
  return ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === 'continueSnapshotConsistencyRepair';
  });
}

function _scheduleSnapshotRepairContinuation() {
  _clearSnapshotRepairContinuationTriggers();
  ScriptApp.newTrigger('continueSnapshotConsistencyRepair').timeBased().after(60 * 1000).create();
}

function _snapshotRepairStatusMessage(state) {
  if (!state) return '전체 가격이력·스냅샷 정합성 복구 기록이 없습니다.';
  return '📸 전체 가격이력·스냅샷 정합성 복구\n\n' +
    '상태: ' + (state.done ? '완료' : '진행 중') + '\n' +
    '전체 날짜: ' + state.total + '개\n' +
    '점검 완료: ' + state.checked + '개\n' +
    '남은 날짜: ' + Math.max(0, state.total - state.checked) + '개\n' +
    '재작성: ' + state.repaired + '개\n' +
    '이미 일치: ' + state.unchanged + '개\n' +
    '가격이력/보유자료 없음: ' + state.skipped + '개\n' +
    '실패: ' + state.failed + '개\n' +
    '마지막 점검일: ' + (state.lastDate || '-') +
    (state.lastError ? '\n최근 오류: ' + state.lastError : '');
}

function _startSnapshotConsistencyRepair(forceRewrite) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    lock.waitLock(30000);
    locked = true;
    var ss = getss();
    var maxDate = _getPrevTradingDay(today(), 7) || today();
    var dates = _getAllPriceHistoryDates(ss, maxDate);
    if (dates.length === 0) throw new Error('확정 거래일까지의 가격이력이 없습니다.');
    var props = PropertiesService.getScriptProperties();
    var currentRaw = props.getProperty(SNAPSHOT_REPAIR_STATE_KEY);
    var current = currentRaw ? JSON.parse(currentRaw) : null;
    if (current && !current.done) throw new Error('이미 전체 스냅샷 재작성이 진행 중입니다. 진행상황을 확인해주세요.');
    var state = {
      startedAt: Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
      maxDate: maxDate, total: dates.length, nextIndex: 0,
      checked: 0, repaired: 0, unchanged: 0, skipped: 0, failed: 0,
      failedDateErrors: {}, batchError: '', lastDate: '', lastError: '', done: false, forceRewrite: !!forceRewrite
    };
    props.setProperty(SNAPSHOT_REPAIR_STATE_KEY, JSON.stringify(state));
    _clearSnapshotRepairContinuationTriggers();
  } finally {
    if (locked) lock.releaseLock();
  }
  return continueSnapshotConsistencyRepair();
}

function runSnapshotConsistencyRepair() {
  if (!_confirmPortfolioMenuAction('전체 스냅샷 정합성 복구', '저장된 전체 가격이력 날짜의 스냅샷을 검사하고 불일치·누락 자료를 재작성합니다. 후속 트리거로 계속 실행됩니다. 가격이력을 새로 조회하지 않습니다. 과거 평가 결과가 바뀔 수 있습니다. 버전업의 필수 절차가 아닙니다.')) return;
  try {
    var result = _startSnapshotConsistencyRepair(false);
    SpreadsheetApp.getUi().alert(_snapshotRepairStatusMessage(result) +
      (result.done ? '' : '\n\n남은 날짜는 1분 간격의 후속 실행으로 계속 처리합니다.'));
    return result;
  } catch (e) {
    try { SpreadsheetApp.getUi().alert('❌ 전체 가격이력·스냅샷 정합성 복구 시작 실패\n\n' + e.message); } catch (_) {}
    throw e;
  }
}

function handleStartSnapshotRepair() {
  try {
    var props = PropertiesService.getScriptProperties();
    var currentRaw = props.getProperty(SNAPSHOT_REPAIR_STATE_KEY);
    var current = currentRaw ? JSON.parse(currentRaw) : null;
    if (current && !current.done) {
      if (!_hasSnapshotRepairContinuationTrigger()) _scheduleSnapshotRepairContinuation();
      return jsonOk({ repairState: current, alreadyRunning: true });
    }
    return jsonOk({ repairState: _startSnapshotConsistencyRepair(true) });
  } catch (err) {
    var retryRaw = PropertiesService.getScriptProperties().getProperty(SNAPSHOT_REPAIR_STATE_KEY);
    var retryState = retryRaw ? JSON.parse(retryRaw) : null;
    if (retryState && !retryState.done) return jsonOk({ repairState: retryState, alreadyRunning: true });
    return jsonError('전체 스냅샷 재작성 시작 실패: ' + err.message);
  }
}

function handleGetSnapshotRepairStatus() {
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty(SNAPSHOT_REPAIR_STATE_KEY);
    var state = raw ? JSON.parse(raw) : null;
    var resumed = false;
    if (state && !state.done && !_hasSnapshotRepairContinuationTrigger()) {
      _scheduleSnapshotRepairContinuation();
      resumed = true;
    }
    return jsonOk({ repairState: state, resumed: resumed });
  } catch (err) {
    return jsonError('전체 스냅샷 재작성 상태 조회 실패: ' + err.message);
  }
}

function handleContinueSnapshotRepair() {
  try {
    return jsonOk({ repairState: continueSnapshotConsistencyRepair() });
  } catch (err) {
    var raw = PropertiesService.getScriptProperties().getProperty(SNAPSHOT_REPAIR_STATE_KEY);
    var state = raw ? JSON.parse(raw) : null;
    if (state && !state.done) return jsonOk({ repairState: state, busy: true, message: err.message || String(err) });
    return jsonError('전체 스냅샷 재작성 계속 처리 실패: ' + err.message);
  }
}

function continueSnapshotConsistencyRepair() {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    lock.waitLock(30000);
    locked = true;
    var props = PropertiesService.getScriptProperties();
    var rawState = props.getProperty(SNAPSHOT_REPAIR_STATE_KEY);
    if (!rawState) throw new Error('진행 중인 전체 정합성 복구가 없습니다.');
    var state = JSON.parse(rawState);
    state.failedDateErrors = state.failedDateErrors || {};
    state.validatedOperationIds = state.validatedOperationIds || [];
    state.batchError = '';
    var ss = getss();
    var repairFundConfigs = _readFundUnits(ss);
    var allDates = _getAllPriceHistoryDates(ss, state.maxDate);
    state.total = allDates.length;
    var dates = allDates.slice(state.nextIndex, state.nextIndex + SNAPSHOT_REPAIR_BATCH_SIZE);
    var batchHadDateError = false;
    dates.forEach(function(snapshotDate) {
      var previousOperationId = _snapshotBackupOperationId;
      var repairOperationId = 'snapshotConsistencyRepair|' + String(state.startedAt || 'repair') + '|' + snapshotDate;
      try {
        var rawRows = _readRawSnapshotRowsByDate(ss, snapshotDate);
        var lifecycleRows = _filterSnapshotRowsByFundLifecycle(rawRows, repairFundConfigs, snapshotDate);
        var lifecycleRemovedRows = rawRows.length - lifecycleRows.length;
        var expected = [], sourceError = '';
        try { expected = _buildSnapshotRowsFromTradeAndPriceHistory(ss, snapshotDate, !!state.forceRewrite); }
        catch (expectedError) { sourceError = expectedError.message || String(expectedError); }
        var duplicateDecisions = _classifyRawSnapshotDuplicateGroups(snapshotDate, lifecycleRows, expected, sourceError);
        var unsafeGroups = duplicateDecisions.filter(function(item) { return !item.autoResolvable; });
        if (unsafeGroups.length) throw new Error(unsafeGroups.map(function(item) { return item.classification + ': ' + item.reason; }).join('; '));
        var existing = _dedupeSnapshotRows(lifecycleRows);
        if (state.forceRewrite) expected = _preserveExistingForeignSnapshotRows(ss, existing, expected);
        if (sourceError) {
          state.skipped++;
          state.failedDateErrors[snapshotDate] = 'SOURCE_INCOMPLETE: ' + sourceError;
        } else if (expected.length === 0) {
          var exactOnlyGroups = duplicateDecisions.filter(function(item) { return item.classification === 'EXACT_DUPLICATE'; });
          if (!exactOnlyGroups.length && lifecycleRemovedRows === 0) state.skipped++;
          else {
            _snapshotBackupOperationId = repairOperationId;
            writeSnapshotRows(ss, snapshotDate, existing, true, null, repairFundConfigs);
            SpreadsheetApp.flush();
            var afterDuplicateCleanup = diagnoseSnapshotIntegrity(ss, snapshotDate);
            if (afterDuplicateCleanup.duplicateKeys.length || afterDuplicateCleanup.conflictKeys.length) throw new Error('expected 없는 raw/lifecycle 정리 후 재진단 실패: ' + afterDuplicateCleanup.status);
            _settleSnapshotBackupOperation(ss, repairOperationId, true);
            state.repaired++;
          }
        } else {
          if (!duplicateDecisions.length && lifecycleRemovedRows === 0 && !state.forceRewrite && _snapshotRowsSignature(existing) === _snapshotRowsSignature(expected)) {
            state.unchanged++;
          } else {
            _snapshotBackupOperationId = repairOperationId;
            writeSnapshotRows(ss, snapshotDate, expected, true, null, repairFundConfigs);
            SpreadsheetApp.flush();
            var afterIntegrity = diagnoseSnapshotIntegrity(ss, snapshotDate);
            if (afterIntegrity.status !== 'VALID') throw new Error('raw 재진단 실패: ' + afterIntegrity.status);
            if (state.validatedOperationIds.indexOf(repairOperationId) === -1) state.validatedOperationIds.push(repairOperationId);
            _settleSnapshotBackupOperation(ss, repairOperationId, true);
            state.repaired++;
          }
        }
        if (!sourceError) delete state.failedDateErrors[snapshotDate];
      } catch (dateError) {
        _settleSnapshotBackupOperation(ss, repairOperationId, false, dateError.message || String(dateError));
        state.failedDateErrors[snapshotDate] = dateError.message || String(dateError);
      } finally {
        _snapshotBackupOperationId = previousOperationId;
      }
      state.checked++;
      state.nextIndex++;
      state.lastDate = snapshotDate;
    });
    SpreadsheetApp.flush();
    var failedDates = Object.keys(state.failedDateErrors);
    state.failed = failedDates.length;
    state.lastError = failedDates.length
      ? failedDates[failedDates.length - 1] + ': ' + state.failedDateErrors[failedDates[failedDates.length - 1]]
      : '';
    state.done = state.nextIndex >= allDates.length;
    state.updatedAt = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    props.setProperty(SNAPSHOT_REPAIR_STATE_KEY, JSON.stringify(state));
    if (!state.done) _scheduleSnapshotRepairContinuation();
    else if (state.failed === 0) state.backupCleanup = maintainSystemBackups({ apply: true, validatedOperationIds: state.validatedOperationIds });
    return state;
  } catch (batchError) {
    var errorProps = PropertiesService.getScriptProperties();
    var savedRaw = errorProps.getProperty(SNAPSHOT_REPAIR_STATE_KEY);
    var errorState = savedRaw ? JSON.parse(savedRaw) : null;
    if (errorState && !errorState.done) {
      errorState.batchError = '배치 실행 오류: ' + batchError.message;
      errorState.lastError = errorState.batchError;
      errorState.updatedAt = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
      errorProps.setProperty(SNAPSHOT_REPAIR_STATE_KEY, JSON.stringify(errorState));
      try { _scheduleSnapshotRepairContinuation(); } catch (scheduleError) {
        errorState.lastError += ' / 후속 실행 예약 실패: ' + scheduleError.message;
        errorProps.setProperty(SNAPSHOT_REPAIR_STATE_KEY, JSON.stringify(errorState));
      }
    }
    throw batchError;
  } finally {
    if (locked) lock.releaseLock();
  }
}

function showSnapshotConsistencyRepairStatus() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(SNAPSHOT_REPAIR_STATE_KEY);
  var state = raw ? JSON.parse(raw) : null;
  var resumeMessage = '';
  if (state && !state.done && !_hasSnapshotRepairContinuationTrigger()) {
    try {
      _scheduleSnapshotRepairContinuation();
      state.lastError = '';
      state.updatedAt = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
      props.setProperty(SNAPSHOT_REPAIR_STATE_KEY, JSON.stringify(state));
      resumeMessage = '\n\n⚠️ 후속 실행 트리거가 없어 자동으로 다시 예약했습니다.';
    } catch (resumeError) {
      state.lastError = '후속 실행 자동 재예약 실패: ' + resumeError.message;
      props.setProperty(SNAPSHOT_REPAIR_STATE_KEY, JSON.stringify(state));
      resumeMessage = '\n\n❌ 후속 실행 자동 재예약에 실패했습니다.';
    }
  }
  SpreadsheetApp.getUi().alert(_snapshotRepairStatusMessage(state) + resumeMessage);
  return state;
}

//  예: repairPriceAndSnapshotForDate('2026-04-08')
// ════════════════════════════════════════════════════════════════════
function repairPriceAndSnapshotForDate(dateStr) {
  var snapshotOperationId = '', previousSnapshotOperationId = _snapshotBackupOperationId, ss = null;
  try {
    var normDate = _normalizeDate(dateStr);
    if (!normDate) throw new Error('유효한 날짜가 아닙니다: ' + dateStr);
    ss = getss();

    var tradeSh = ss.getSheetByName(CONFIG.SHEET_TRADES);
    if (!tradeSh || tradeSh.getLastRow() < 2) throw new Error('거래이력 시트가 없습니다');
    var tradeData = tradeSh.getRange(2, 1, tradeSh.getLastRow() - 1, Math.min(11, tradeSh.getLastColumn())).getValues();

    var nameToCode = {};
    getCodeItems(ss).forEach(function(item){ nameToCode[item.name] = item.code; });
    tradeData.forEach(function(row) {
      var name = (row[3]||'').toString().trim();
      var code = (row[4]||'').toString().trim();
      if (name && code && !nameToCode[name]) nameToCode[name] = code;
    });

    var holdAtDate = calcHoldingsAtDate(tradeData, normDate, nameToCode);
    var repairFundConfigs = _readFundUnits(ss);
    var holdingCountBeforeLifecycle = Object.keys(holdAtDate).length;
    _applyFundUnitLifecycleToSnapshotHoldings(holdAtDate, repairFundConfigs, normDate);
    var lifecycleRemovedHoldings = holdingCountBeforeLifecycle - Object.keys(holdAtDate).length;
    if (Object.keys(holdAtDate).length === 0 && lifecycleRemovedHoldings === 0) {
      Logger.log('[repair] 보유 종목 없음: ' + normDate);
      return { date: normDate, priceCount: 0, snapshotCount: 0, lifecycleRemovedRows: 0 };
    }

    var codeItems = Object.keys(holdAtDate)
      .map(function(k){ return holdAtDate[k]; })
      .filter(function(h){ return h.code && h.qty > 0; })
      .map(function(h){ return { code: h.code, name: h.name }; });

    var gfResult = codeItems.length ? fetchPricesGoogleFinance(codeItems, normDate, ss) : {};
    var prices = {};
    var priceSources = {};
    Object.keys(gfResult).forEach(function(code) {
      var val = gfResult[code];
      prices[code] = val.price || val;
      priceSources[code] = val.source || 'GOOGLEFINANCE';
    });

    var phItems = Object.keys(holdAtDate)
      .map(function(k){ return holdAtDate[k]; })
      .filter(function(h){ return h.code && h.qty > 0 && prices[h.code] > 0; })
      .map(function(h){ return { code: h.code, name: h.name, price: prices[h.code], source: (priceSources[h.code] || 'UNKNOWN') }; });
    if (phItems.length > 0) batchUpsertPriceHistory(ss, normDate, phItems);

    // 공통 생성기를 사용해야 펀드·TDF도 기준일 이전 최근 MANUAL 가격을
    // 동일하게 이월하고, 해당 기준일보다 미래의 수동가격은 참조하지 않습니다.
    var snapRows = _buildSnapshotRowsFromTradeAndPriceHistory(ss, normDate);
    var repairPlan = _snapshotRewritePlan(ss, normDate, snapRows, repairFundConfigs);
    if (repairPlan.unsafe.length) return { date: normDate, priceCount: phItems.length, snapshotCount: 0,
      lifecycleRemovedRows: 0,
      protectedReason: repairPlan.unsafe.map(function(item) { return item.classification + ': ' + item.reason; }).join('; ') };
    if (repairPlan.needsRewrite) {
      snapshotOperationId = 'repairPriceAndSnapshotForDate|' + normDate + '|' + Utilities.getUuid();
      _snapshotBackupOperationId = snapshotOperationId;
      writeSnapshotRows(ss, normDate, snapRows, true, null, repairFundConfigs);
      SpreadsheetApp.flush();
    }
    var repairIntegrity = diagnoseSnapshotIntegrity(ss, normDate);
    var repairIntegrityOk = _snapshotIntegritySatisfied(repairIntegrity);
    var verifiedSnapshotCount = repairIntegrityOk ? snapRows.length : 0;
    if (!repairIntegrityOk) throw new Error('Snapshot 재진단 실패: ' + repairIntegrity.status);
    if (snapshotOperationId) _settleSnapshotBackupOperation(ss, snapshotOperationId, true);

    Logger.log('[repair] 완료: ' + normDate + ' · 가격 ' + phItems.length + '건 · 스냅샷 ' + verifiedSnapshotCount + '건 · lifecycle 제거 ' + Number(repairPlan.lifecycleRemovedRows || 0) + '건');
    return { date: normDate, priceCount: phItems.length, snapshotCount: verifiedSnapshotCount,
      lifecycleRemovedRows: Number(repairPlan.lifecycleRemovedRows || 0),
      protectedReason: '' };
  } catch (err) {
    if (snapshotOperationId && ss) _settleSnapshotBackupOperation(ss, snapshotOperationId, false, err.message);
    Logger.log('❌ repairPriceAndSnapshotForDate 실패: ' + err.message);
    throw err;
  } finally { _snapshotBackupOperationId = previousSnapshotOperationId; }
}

function handleRepairSnapshots(dataJson) {
  try {
    var payload = JSON.parse(dataJson || '{}');
    var dates = Array.isArray(payload.dates) ? payload.dates : [];
    var unique = [];
    var seen = {};
    dates.forEach(function(value) {
      var date = _normalizeDate(value);
      if (!date || seen[date]) return;
      seen[date] = true;
      unique.push(date);
    });
    if (unique.length === 0) return jsonError('복구할 날짜가 없습니다');
    if (unique.length > 8) return jsonError('한 번에 최대 8개 날짜만 복구할 수 있습니다');

    var beforeTriggers = _ensureDailyTriggers(false);
    var repaired = [];
    var failed = [];
    unique.forEach(function(date) {
      try {
        var result = repairPriceAndSnapshotForDate(date);
        if (result && (result.snapshotCount > 0 || result.lifecycleRemovedRows > 0)) repaired.push(result);
        else failed.push({ date: date, message: result && result.protectedReason ? result.protectedReason : '해당 날짜의 보유 종목이 없습니다' });
      } catch (err) {
        failed.push({ date: date, message: err.message || String(err) });
      }
    });
    var afterTriggers = beforeTriggers;
    var automationRestored = false;
    try {
      afterTriggers = _ensureDailyTriggers(true);
      automationRestored = !beforeTriggers.hasSave && afterTriggers.hasSave;
    } catch (triggerErr) {
      failed.push({ date: '', message: '자동 트리거 점검 실패: ' + triggerErr.message });
    }
    return jsonOk({
      repaired: repaired,
      failed: failed,
      automationRestored: automationRestored,
      automation: afterTriggers
    });
  } catch (err) {
    return jsonError('스냅샷 복구 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  최근 날짜 가격 이상치 점검 (GF 대비)
//  예: detectPriceAnomalyDates(7, 8) // 최근 7일, 8% 이상 차이
// ════════════════════════════════════════════════════════════════════
function detectPriceAnomalyDates(days, thresholdPct) {
  var maxDays = Math.max(1, parseInt(days || 7, 10));
  var threshold = Math.max(1, parseFloat(thresholdPct || 8));
  var ss = getss();
  var ph = ss.getSheetByName(CONFIG.SHEET_PH);
  if (!ph || ph.getLastRow() < 2) {
    Logger.log('[anomaly] 가격이력 시트 데이터 없음');
    return [];
  }

  var rows = ph.getRange(2, 1, ph.getLastRow() - 1, 4).getValues();
  var byDate = {};
  rows.forEach(function(r) {
    var d = _normalizeDate(r[0]);
    var code = _cleanCode(r[1]) || (r[1] || '').toString().trim();
    var name = (r[2] || '').toString().trim();
    var price = parseFloat(r[3]) || 0;
    var key = code || name;
    if (!d || !key || price <= 0) return;
    if (!byDate[d]) byDate[d] = {};
    byDate[d][key] = { code: code, name: name || key, price: price };
  });

  var dates = Object.keys(byDate).sort().reverse().slice(0, maxDays);
  var anomalies = [];

  dates.forEach(function(d) {
    var map = byDate[d];
    var items = Object.keys(map)
      .map(function(k){ return map[k]; })
      .filter(function(i){ return i.code; })
      .map(function(i){ return { code: i.code, name: i.name }; });
    if (items.length === 0) return;

    var gf = fetchPricesGoogleFinance(items, d, ss);
    Object.keys(map).forEach(function(k) {
      var row = map[k];
      if (!row.code || !(gf[row.code] && gf[row.code].price > 0)) return;
      var gfPrice = parseFloat(gf[row.code].price) || 0;
      if (gfPrice <= 0) return;
      var diffPct = Math.abs((row.price - gfPrice) / gfPrice * 100);
      if (diffPct >= threshold) {
        anomalies.push({
          date: d,
          code: row.code,
          name: row.name,
          hist: row.price,
          gf: gfPrice,
          diffPct: +diffPct.toFixed(2)
        });
      }
    });
  });

  var summary = '[anomaly] 최근 ' + dates.length + '일 점검, 이상치 ' + anomalies.length + '건';
  Logger.log(summary);
  anomalies.slice(0, 30).forEach(function(a) {
    Logger.log(a.date + ' ' + a.code + ' ' + a.name + ' hist=' + a.hist + ' gf=' + a.gf + ' diff=' + a.diffPct + '%');
  });
  try {
    var logGuide = '\n실행 로그: 확장 프로그램 > Apps Script > 실행(Executions) > detectPriceAnomalyDates';
    SpreadsheetApp.getUi().alert(summary + (anomalies.length ? logGuide : ''));
  } catch(e) {}
  return anomalies;
}

// ════════════════════════════════════════════════════════════════════
//  특정 일자 가격 이상치 점검 + 복구 여부 확인
//  예: detectPriceAnomalyForDate('2026-04-08', 8)
// ════════════════════════════════════════════════════════════════════
function detectPriceAnomalyForDate(dateStr, thresholdPct) {
  var targetDate = _normalizeDate(dateStr || '');
  if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error('유효한 일자를 입력하세요. 예) 2026-04-08');
  }
  var threshold = Math.max(1, parseFloat(thresholdPct || 8));
  var ss = getss();
  var ph = ss.getSheetByName(CONFIG.SHEET_PH);
  if (!ph || ph.getLastRow() < 2) {
    Logger.log('[anomaly/date] 가격이력 시트 데이터 없음');
    return { date: targetDate, threshold: threshold, anomalies: [], summary: '[anomaly/date] 가격이력 시트 데이터 없음' };
  }

  var rows = ph.getRange(2, 1, ph.getLastRow() - 1, 4).getValues();
  var map = {};
  rows.forEach(function(r) {
    var d = _normalizeDate(r[0]);
    if (d !== targetDate) return;
    var code = _cleanCode(r[1]) || (r[1] || '').toString().trim();
    var name = (r[2] || '').toString().trim();
    var price = parseFloat(r[3]) || 0;
    var key = code || name;
    if (!key || price <= 0) return;
    map[key] = { code: code, name: name || key, price: price };
  });

  var items = Object.keys(map)
    .map(function(k){ return map[k]; })
    .filter(function(i){ return i.code; })
    .map(function(i){ return { code: i.code, name: i.name }; });

  if (items.length === 0) {
    var noDataSummary = '[anomaly/date] ' + targetDate + ' 가격이력 데이터 없음';
    Logger.log(noDataSummary);
    return { date: targetDate, threshold: threshold, anomalies: [], summary: noDataSummary };
  }

  var gf = fetchPricesGoogleFinance(items, targetDate, ss);
  var anomalies = [];
  Object.keys(map).forEach(function(k) {
    var row = map[k];
    if (!row.code || !(gf[row.code] && gf[row.code].price > 0)) return;
    var gfPrice = parseFloat(gf[row.code].price) || 0;
    if (gfPrice <= 0) return;
    var diffPct = Math.abs((row.price - gfPrice) / gfPrice * 100);
    if (diffPct >= threshold) {
      anomalies.push({
        date: targetDate,
        code: row.code,
        name: row.name,
        hist: row.price,
        gf: gfPrice,
        diffPct: +diffPct.toFixed(2)
      });
    }
  });

  var summary = '[anomaly/date] ' + targetDate + ' 점검, 이상치 ' + anomalies.length + '건 (기준 ' + threshold + '%)';
  Logger.log(summary);
  anomalies.slice(0, 50).forEach(function(a) {
    Logger.log(a.date + ' ' + a.code + ' ' + a.name + ' hist=' + a.hist + ' gf=' + a.gf + ' diff=' + a.diffPct + '%');
  });
  return { date: targetDate, threshold: threshold, anomalies: anomalies, summary: summary };
}

function detectPriceAnomalyPromptAndMaybeRepair(readOnly) {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
  if (!ui) throw new Error('스프레드시트 UI 환경에서 실행하세요.');

  var rangeResp = ui.prompt(
    '기간 지정 이상치 점검',
    '조회 기간을 입력하세요. 예: 2026-04-01~2026-04-08 (하루만 점검 시 같은 날짜 입력)',
    ui.ButtonSet.OK_CANCEL
  );
  if (rangeResp.getSelectedButton() !== ui.Button.OK) return;

  var rawRange = (rangeResp.getResponseText() || '').trim();
  if (!rawRange) {
    ui.alert('조회 기간을 입력해 주세요. 예: 2026-04-01~2026-04-08');
    return;
  }
  var rangeParts = rawRange.split('~');
  var fromDate = _normalizeDate((rangeParts[0] || '').trim());
  var toDate = _normalizeDate((rangeParts[1] || rangeParts[0] || '').trim());
  if (!fromDate || !toDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    ui.alert('유효한 기간 형식이 아닙니다. 예: 2026-04-01~2026-04-08');
    return;
  }
  if (fromDate > toDate) {
    var tmp = fromDate;
    fromDate = toDate;
    toDate = tmp;
  }

  var thresholdResp = ui.prompt(
    '이상치 기준(%)',
    '차이율 임계값을 입력하세요. (기본 8)',
    ui.ButtonSet.OK_CANCEL
  );
  if (thresholdResp.getSelectedButton() !== ui.Button.OK) return;
  var threshold = parseFloat((thresholdResp.getResponseText() || '').trim());
  if (!(threshold > 0)) threshold = 8;

  var ss = getss();
  var targetDates = _listPriceHistoryDatesInRange(ss, fromDate, toDate);
  var allAnomalies = [];
  targetDates.forEach(function(d) {
    var one = detectPriceAnomalyForDate(d, threshold);
    if (one.anomalies && one.anomalies.length) {
      allAnomalies = allAnomalies.concat(one.anomalies);
    }
  });

  var summary = '[anomaly/range] ' + fromDate + '~' + toDate + ' 점검일 ' + targetDates.length + '일, 이상치 ' + allAnomalies.length + '건';
  Logger.log(summary);

  var logGuide = '\n실행 로그: 확장 프로그램 > Apps Script > 실행(Executions) > detectPriceAnomalyPromptAndMaybeRepair';
  if (!allAnomalies.length) {
    ui.alert(summary + '\n이상치가 없어 업데이트를 건너뜁니다.' + logGuide);
    return;
  }

  if (readOnly === true) { ui.alert(summary + '\n가격이력·스냅샷 변경 없음. 복구가 필요하면 [복구·정리 실행]의 가격 이상치 복구를 선택하세요.' + logGuide); return; }

  var ask = ui.alert(
    '이상치 발견',
    summary + '\n비교 조회된 종가로 해당 날짜·종목의 가격이력을 변경합니다. 기존 값과 출처를 먼저 확인하세요. 스냅샷 재생성은 다음 단계에서 별도 확인합니다.\n가격이력을 변경할까요?' + logGuide,
    ui.ButtonSet.YES_NO
  );
  if (ask !== ui.Button.YES) {
    ui.alert('업데이트를 취소했습니다. 필요 시 메뉴에서 다시 실행해 주세요.');
    return;
  }

  var byDate = {};
  allAnomalies.forEach(function(a) {
    if (!byDate[a.date]) byDate[a.date] = [];
    byDate[a.date].push({
      code: a.code,
      name: a.name,
      price: a.gf,
      savedAt: Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
      source: 'GOOGLEFINANCE'
    });
  });

  var updatedRows = 0;
  Object.keys(byDate).sort().forEach(function(d) {
    batchUpsertPriceHistory(ss, d, byDate[d]);
    updatedRows += byDate[d].length;
  });

  var syncAsk = ui.alert(
    '가격이력 업데이트 완료',
    '총 ' + updatedRows + '건 반영했습니다.\n해당 일자 스냅샷도 재생성할까요?',
    ui.ButtonSet.YES_NO
  );
  if (syncAsk === ui.Button.YES) {
    Object.keys(byDate).sort().forEach(function(d) { repairPriceAndSnapshotForDate(d); });
    ui.alert('✅ 스냅샷 재생성 완료\n점검 기간: ' + fromDate + '~' + toDate);
    return;
  }
  ui.alert('✅ 가격이력 업데이트 완료\n점검 기간: ' + fromDate + '~' + toDate + '\n(스냅샷 재생성은 건너뜀)');
}

function _listPriceHistoryDatesInRange(ss, fromDate, toDate) {
  var ph = ss.getSheetByName(CONFIG.SHEET_PH);
  if (!ph || ph.getLastRow() < 2) return [];
  var rows = ph.getRange(2, 1, ph.getLastRow() - 1, 1).getValues();
  var seen = {};
  rows.forEach(function(r) {
    var d = _normalizeDate(r[0]);
    if (!d || d < fromDate || d > toDate) return;
    seen[d] = true;
  });
  return Object.keys(seen).sort();
}

// ════════════════════════════════════════════════════════════════════
//  트리거 등록
// ════════════════════════════════════════════════════════════════════
function setupTrigger() {
  // 구버전 고정 이름 및 만료된 요청별 임시 시트를 안전하게 정리합니다.
  try { _cleanupBenchmarkTempSheets(); } catch(cleanupErr) { Logger.log('기존 임시 시트 정리 실패: ' + cleanupErr.message); }
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (
      fn === 'saveDailyPriceHistory' || fn === 'cleanDeadCodes' ||
      fn === 'runCodeNormalize1550' || fn === 'runEvalPriceUpdate1620' ||
      fn === 'syncMortgageFromSchedule' || fn === 'runDailyFundValuations' ||
      fn === 'runDailyPortfolioClose1900' || fn === 'onOpen'
    ) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runCodeNormalize1550').timeBased().everyDays(1).inTimezone(CONFIG.TIMEZONE).atHour(15).nearMinute(50).create();
  ScriptApp.newTrigger('syncMortgageFromSchedule').timeBased().everyDays(1).inTimezone(CONFIG.TIMEZONE).atHour(1).nearMinute(10).create();
  _ensurePortfolioCloseDailyTrigger(true);
  _ensureSnapshotIntegrityChangeTrigger(true);
  try { onOpen(); } catch(e0) { Logger.log('메뉴 즉시 재생성 실패: ' + e0.message); }
  Logger.log('트리거 등록 완료: 01:10 주담대 → 15:50 종목코드 → 19시 일반 종목+펀드 통합 마감');
  try { SpreadsheetApp.getUi().alert('✅ 자동 트리거 등록 완료!\n01:10 주담대 잔액 갱신\n15:50 종목코드 보정\n19시 일반 종목 확정가·Snapshot + 펀드 NAV/평가 통합 마감'); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}

function _ensureDailyTriggers(autoFix) {
  var hasClean = false;
  var hasMortgage = false;
  var hasClose = false;
  var hasIntegrityChange = false;
  var closeCount = 0;
  var legacyPriceCount = 0;
  var legacyFundCount = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'runCodeNormalize1550') hasClean = true;
    if (fn === 'syncMortgageFromSchedule') hasMortgage = true;
    if (fn === 'runDailyPortfolioClose1900') { hasClose = true; closeCount++; }
    if (fn === 'runEvalPriceUpdate1620') legacyPriceCount++;
    if (fn === 'runDailyFundValuations') legacyFundCount++;
  });
  hasIntegrityChange = _ensureSnapshotIntegrityChangeTrigger(false);

  var hasLegacySplitTriggers = legacyPriceCount > 0 || legacyFundCount > 0;
  var hasDuplicateCloseTriggers = closeCount > 1;

  if (autoFix) {
    if (!hasClean) {
      ScriptApp.newTrigger('runCodeNormalize1550').timeBased().everyDays(1).inTimezone(CONFIG.TIMEZONE).atHour(15).nearMinute(50).create();
      hasClean = true;
    }
    if (!hasMortgage) {
      ScriptApp.newTrigger('syncMortgageFromSchedule').timeBased().everyDays(1).inTimezone(CONFIG.TIMEZONE).atHour(1).nearMinute(10).create();
      hasMortgage = true;
    }
    if (!hasClose || hasLegacySplitTriggers || hasDuplicateCloseTriggers) {
      hasClose = _ensurePortfolioCloseDailyTrigger(true);
      var refreshed = ScriptApp.getProjectTriggers().map(function(t) { return t.getHandlerFunction(); });
      closeCount = refreshed.filter(function(fn) { return fn === 'runDailyPortfolioClose1900'; }).length;
      legacyPriceCount = refreshed.filter(function(fn) { return fn === 'runEvalPriceUpdate1620'; }).length;
      legacyFundCount = refreshed.filter(function(fn) { return fn === 'runDailyFundValuations'; }).length;
      hasLegacySplitTriggers = legacyPriceCount > 0 || legacyFundCount > 0;
      hasDuplicateCloseTriggers = closeCount > 1;
    }
    if (!hasIntegrityChange) hasIntegrityChange = _ensureSnapshotIntegrityChangeTrigger(true);
  }
  // hasSave/hasFund는 기존 호출부 호환용 alias입니다. 둘 다 통합 마감 트리거 상태를 뜻합니다.
  return {
    hasClean: hasClean,
    hasSave: hasClose,
    hasMortgage: hasMortgage,
    hasFund: hasClose,
    hasClose: hasClose,
    hasIntegrityChange: hasIntegrityChange,
    closeCount: closeCount,
    legacyPriceCount: legacyPriceCount,
    legacyFundCount: legacyFundCount,
    hasLegacySplitTriggers: hasLegacySplitTriggers,
    hasDuplicateCloseTriggers: hasDuplicateCloseTriggers
  };
}
function _ensureDailyTriggersOncePerDay(dateStr) {
  var props = PropertiesService.getScriptProperties();
  var checkedDate = props.getProperty('daily_triggers_checked_date') || '';
  var checkToken = dateStr + '|integrity-change-v4-portfolio-close-dedup';
  if (checkedDate === checkToken) return { checked: false, autoFixed: false };
  try {
    var before = _ensureDailyTriggers(false);
    var needsRepair = !before.hasClean || !before.hasSave || !before.hasMortgage || !before.hasFund || !before.hasIntegrityChange
      || before.hasLegacySplitTriggers || before.hasDuplicateCloseTriggers;
    var after = needsRepair ? _ensureDailyTriggers(true) : before;
    var healthy = after.hasClean && after.hasSave && after.hasMortgage && after.hasFund && after.hasIntegrityChange
      && !after.hasLegacySplitTriggers && !after.hasDuplicateCloseTriggers;
    if (healthy) props.setProperty('daily_triggers_checked_date', checkToken);
    if (needsRepair) Logger.log('✅ 웹 평가가격 조회에서 누락·레거시·중복 자동 트리거 복구 완료');
    return { checked: true, autoFixed: needsRepair };
  } catch(err) {
    Logger.log('⚠️ 웹 평가가격 조회의 자동 트리거 점검 실패: ' + err.message);
    return { checked: true, autoFixed: false, error: err.message };
  }
}

function _getLatestDateInColumn(sheet, column) {
  if (!sheet || sheet.getLastRow() < 2) return '-';
  var values = sheet.getRange(2, column || 1, sheet.getLastRow() - 1, 1).getValues();
  var latest = '';
  values.forEach(function(row) {
    var date = _normalizeDate(row[0]);
    if (date && date > latest) latest = date;
  });
  return latest || '-';
}
function _getLatestLifecycleValidSnapshotDate(ss) {
  var sh = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
  if (!sh || sh.getLastRow() < 2) return '-';
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(12, sh.getLastColumn())).getValues();
  var configs = _readFundUnits(ss);
  var latest = '';
  rows.forEach(function(row) {
    var date = _normalizeDate(row[0]);
    if (!date) return;
    if (!_filterSnapshotRowsByFundLifecycle([row], configs, date).length) return;
    if (date > latest) latest = date;
  });
  return latest || '-';
}

function _expectedConfirmedSnapshotDate(priceHistoryLastDate, portfolioClose) {
  var closeDate = portfolioClose && _normalizeDate(portfolioClose.priceDate);
  var historyDate = _normalizeDate(priceHistoryLastDate);
  if (closeDate && historyDate) return closeDate > historyDate ? closeDate : historyDate;
  if (closeDate) return closeDate;
  if (historyDate) return historyDate;
  return _getPrevTradingDay(today(), 7) || today();
}

function _expectedPortfolioCloseRunDate() {
  var now = new Date();
  var todayStr = Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  var hour = Number(Utilities.formatDate(now, CONFIG.TIMEZONE, 'HH'));
  // atHour(19)는 19시대 어느 시점에 실행될 수 있으므로 21시 전에는 전일 실행까지만 요구합니다.
  return hour >= 21 ? todayStr : _fundDateOffset(todayStr, -1);
}

function _isPortfolioCloseRunStale(portfolioClose) {
  if (!portfolioClose) return false;
  var runDate = _normalizeDate(portfolioClose.runDate)
    || _normalizeDate(String(portfolioClose.finishedAt || portfolioClose.startedAt || '').slice(0, 10));
  if (!runDate) return true;
  return runDate < _expectedPortfolioCloseRunDate();
}


function _getAutomationStatusData() {
  var ss = getss();
  var trig = _ensureDailyTriggers(false);
  var snapSh = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
  var phSh = ss.getSheetByName(CONFIG.SHEET_PH);
  var snapshotLastDate = _getLatestLifecycleValidSnapshotDate(ss);
  var priceHistoryLastDate = _getLatestDateInColumn(phSh, 1);
  var officialKrxPriceHistoryLastDate = _getOfficialKrxPriceHistoryLastDate(phSh);
  var props = PropertiesService.getScriptProperties();

  function parseProperty(name) {
    var raw = props.getProperty(name) || '';
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(ignore) { return null; }
  }

  var portfolioClose = parseProperty('portfolio_close_last_result');
  var closeRun = _portfolioCloseRunState(portfolioClose, props);
  var portfolioCloseLastError = props.getProperty('portfolio_close_last_error') || '';
  var fundLastResult = parseProperty('fund_last_result');
  var fundLastWarning = props.getProperty('fund_last_warning') || '';
  var fundLastError = props.getProperty('fund_last_error') || '';
  var expectedSnapshotDate = _expectedConfirmedSnapshotDate(priceHistoryLastDate, portfolioClose);
  var snapshotStale = snapshotLastDate === '-' || snapshotLastDate < expectedSnapshotDate;
  var expectedPortfolioCloseRunDate = _expectedPortfolioCloseRunDate();
  var portfolioCloseRunStale = _isPortfolioCloseRunStale(portfolioClose);
  var missingTrigger = !trig.hasClean || !trig.hasMortgage || !trig.hasClose || !trig.hasIntegrityChange;
  var hasLegacySplitTriggers = !!trig.hasLegacySplitTriggers;
  var hasDuplicateCloseTriggers = !!trig.hasDuplicateCloseTriggers;
  var closeErrors = portfolioClose && Array.isArray(portfolioClose.errors) ? portfolioClose.errors : [];
  var overallStatus = 'NORMAL';

  if (missingTrigger || hasLegacySplitTriggers || hasDuplicateCloseTriggers) overallStatus = 'ERROR';
  else if (!portfolioClose) overallStatus = closeRun.state === 'INCOMPLETE' ? 'INCOMPLETE' : 'NEVER_RUN';
  else if (closeRun.state === 'INCOMPLETE') overallStatus = 'INCOMPLETE';
  else if (portfolioCloseLastError || fundLastError || closeErrors.length) overallStatus = 'ERROR';
  else if (portfolioCloseRunStale || snapshotStale || fundLastWarning) overallStatus = 'WARNING';

  return {
    gasVersion: '9.180',
    checkedAt: Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
    overallStatus: overallStatus,
    trigger: {
      hasClose: !!trig.hasClose,
      hasClean: !!trig.hasClean,
      hasMortgage: !!trig.hasMortgage,
      hasIntegrityChange: !!trig.hasIntegrityChange,
      hasLegacyPriceTrigger: trig.legacyPriceCount > 0,
      hasLegacyFundTrigger: trig.legacyFundCount > 0,
      hasLegacySplitTriggers: hasLegacySplitTriggers,
      hasDuplicateCloseTriggers: hasDuplicateCloseTriggers,
      closeCount: trig.closeCount
    },
    portfolioClose: portfolioClose,
    closeRun: closeRun,
    officialKrxPriceHistoryLastDate: officialKrxPriceHistoryLastDate,
    portfolioCloseRunStale: portfolioCloseRunStale,
    expectedPortfolioCloseRunDate: expectedPortfolioCloseRunDate,
    portfolioCloseLastError: portfolioCloseLastError,
    snapshotLastDate: snapshotLastDate,
    priceHistoryLastDate: priceHistoryLastDate,
    expectedSnapshotDate: expectedSnapshotDate,
    snapshotStale: snapshotStale,
    fundLastDate: fundLastResult && fundLastResult.lastDate ? fundLastResult.lastDate : '',
    fundLastWarning: fundLastWarning,
    fundLastError: fundLastError
  };
}

function handleGetAutomationStatus() {
  try { return jsonOk({ automation: _getAutomationStatusData(), gasVersion: '9.180' }); }
  catch (err) { return jsonError('자동화 상태 조회 실패: ' + err.message); }
}

function checkDailyAutomationStatus() {
  var ss = getss();
  var trig = _ensureDailyTriggers(false);
  var snapLast = '-';
  var phLast = '-';

  var snapSh = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
  var phSh = ss.getSheetByName(CONFIG.SHEET_PH);
  snapLast = _getLatestLifecycleValidSnapshotDate(ss);
  phLast = _getLatestDateInColumn(phSh, 1);

  var props = PropertiesService.getScriptProperties();
  var lastSuccessAt = props.getProperty('snapshot_last_success_at') || '-';
  var lastSuccessDate = props.getProperty('snapshot_last_success_date') || '-';
  var lastFailureAt = props.getProperty('snapshot_last_failure_at') || '-';
  var lastError = props.getProperty('snapshot_last_error') || '-';
  var fundLastWarning = props.getProperty('fund_last_warning') || '-';
  var fundLastError = props.getProperty('fund_last_error') || '-';
  var fundLastResultRaw = props.getProperty('fund_last_result') || '';
  var fundLastResult = null;
  try { fundLastResult = fundLastResultRaw ? JSON.parse(fundLastResultRaw) : null; } catch(ignoreFundResult) {}
  var fundLastDate = fundLastResult && fundLastResult.lastDate ? fundLastResult.lastDate : '-';
  var portfolioCloseRaw = props.getProperty('portfolio_close_last_result') || '';
  var portfolioClose = null;
  try { portfolioClose = portfolioCloseRaw ? JSON.parse(portfolioCloseRaw) : null; } catch(ignorePortfolioClose) {}
  var expectedSnapshotDate = _expectedConfirmedSnapshotDate(phLast, portfolioClose);
  var isSnapshotStale = snapLast === '-' || snapLast < expectedSnapshotDate;
  var isPortfolioCloseRunStale = _isPortfolioCloseRunStale(portfolioClose);
  var expectedPortfolioCloseRunDate = _expectedPortfolioCloseRunDate();

  var msg = '⏰ 자동화 상태 점검\n\n'
    + 'runCodeNormalize1550(15:50) 트리거: ' + (trig.hasClean ? '정상' : '없음') + '\n'
    + 'syncMortgageFromSchedule(01:10) 트리거: ' + (trig.hasMortgage ? '정상' : '없음') + '\n'
    + 'runDailyPortfolioClose1900(19시) 통합 마감 트리거: ' + (trig.hasDuplicateCloseTriggers ? ('중복 ' + trig.closeCount + '개') : (trig.hasClose ? '정상' : '없음')) + '\n'
    + '기존 분리 트리거(runEvalPriceUpdate1620/runDailyFundValuations): ' + (trig.hasLegacySplitTriggers ? ('남아 있음 · 가격 ' + trig.legacyPriceCount + '개 / 펀드 ' + trig.legacyFundCount + '개') : '없음') + '\n\n'
    + 'Snapshot integrity 구조 변경 트리거: ' + (trig.hasIntegrityChange ? '정상' : '없음') + '\n\n'
    + '스냅샷 마지막 날짜: ' + snapLast + '\n'
    + '가격이력 마지막 날짜: ' + phLast + '\n'
    + '자동 생성 최근 성공: ' + lastSuccessAt + ' (기준일 ' + lastSuccessDate + ')\n'
    + '자동 생성 최근 실패: ' + lastFailureAt + '\n'
    + (lastError !== '-' ? '최근 오류: ' + lastError + '\n' : '')
    + '펀드 최근 처리 기준일: ' + fundLastDate + '\n'
    + (fundLastWarning !== '-' ? '펀드 경고: ' + fundLastWarning + '\n' : '')
    + (fundLastError !== '-' ? '펀드 오류: ' + fundLastError + '\n' : '')
    + (isSnapshotStale ? '⚠️ 최근 확정 거래일(' + expectedSnapshotDate + ') 스냅샷이 없습니다. 실행 기록과 가격 조회 상태를 확인하세요.\n' : '')
    + (isPortfolioCloseRunStale ? '⚠️ 통합 마감 최근 실행일이 기대 실행일(' + expectedPortfolioCloseRunDate + ')보다 오래되었습니다.\n' : '')
    + '\n'
    + (!trig.hasClean || !trig.hasMortgage || !trig.hasClose || !trig.hasIntegrityChange || trig.hasLegacySplitTriggers || trig.hasDuplicateCloseTriggers
      ? '⚠️ 트리거 상태 이상: [복구·정리 실행] → [자동 트리거 복구·정리]를 실행하세요.'
      : '✅ 트리거는 정상 집합입니다. 데이터 누락은 정합성 진단으로 확인하세요.')
    + '\n이 점검은 트리거와 데이터를 변경하지 않습니다. 버전업마다 실행할 필요는 없습니다.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}

function runCodeNormalize1550() {
  cleanDeadCodes();
}

function runEvalPriceUpdate1620() {
  saveDailyPriceHistory();
}

// 하나의 통합 트리거가 제한시간에 중단되어도 마지막으로 진입한 단계는 남깁니다.
function _recordPortfolioCloseStage(props, runDate, startedAt, stage) {
  props.setProperties({
    portfolio_close_run_started_at: startedAt,
    portfolio_close_run_date: runDate,
    portfolio_close_stage: stage,
    portfolio_close_stage_at: Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss')
  });
}
function _portfolioCloseRunState(portfolioClose, props) {
  var startedAt = props.getProperty('portfolio_close_run_started_at') || '';
  var runDate = props.getProperty('portfolio_close_run_date') || '';
  var stage = props.getProperty('portfolio_close_stage') || '';
  var stageAt = props.getProperty('portfolio_close_stage_at') || '';
  var completedAt = String(portfolioClose && portfolioClose.startedAt || '');
  var pending = !!startedAt && (!portfolioClose || startedAt > completedAt);
  var state = !startedAt ? (portfolioClose ? 'COMPLETE' : 'NEVER_RUN')
    : pending ? 'INCOMPLETE' : (stage === 'ERROR' ? 'ERROR' : 'COMPLETE');
  return { state:state, startedAt:startedAt, runDate:runDate, stage:stage, stageAt:stageAt };
}
function _getOfficialKrxPriceHistoryLastDate(phSh) {
  if (!phSh || phSh.getLastRow() < 2) return '-';
  var rows = phSh.getRange(2, 1, phSh.getLastRow() - 1, 6).getValues(), latest = '';
  rows.forEach(function(row) {
    // 실제 공식 KRX 응답일만 인정하며 이전 날짜 이월(KRX_CARRY)은 공식 당일 종가가 아닙니다.
    if (!/^(?:KRX|KRX_OTP)$/i.test(String(row[5] || '').trim())) return;
    if (/^F\d{5}$/.test(String(row[1] || ''))) return;
    var date = _normalizeDate(row[0]);
    if (date && date > latest) latest = date;
  });
  return latest || '-';
}

// 공개 KRX 시장별 데이터 제공 상태: 자격증명·원문 API 응답을 절대로 반환하지 않습니다.
function handleGetKrxSourceDiagnostics(dateStr) {
  try {
    var date = _normalizeDate(dateStr || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonError('진단할 거래일 YYYY-MM-DD를 입력하세요.');
    var authKey = _getKrxAuthKey();
    if (!authKey) return jsonOk({ requestedDate:date, keyConfigured:false, markets:[] });
    var markets = ['KOSPI','KOSDAQ','ETF'];
    var inputs = markets.map(function(market) {
      return { url:_getKrxEndpointByMarket(market) + '?basDd=' + date.replace(/-/g,''),
        method:'get', headers:{AUTH_KEY:authKey}, muteHttpExceptions:true };
    });
    var output = [];
    try {
      var res = UrlFetchApp.fetchAll(inputs);
      res.forEach(function(resp, index) {
        var status = resp.getResponseCode(), rows = 0, parseStatus = 'NOT_PARSED';
        if (status === 200) {
          try {
            var payload = JSON.parse(resp.getContentText() || '{}');
            rows = Array.isArray(payload.OutBlock_1) ? payload.OutBlock_1.length : 0;
            parseStatus = Array.isArray(payload.OutBlock_1) ? (rows ? 'ROWS' : 'EMPTY') : 'UNEXPECTED_SCHEMA';
          } catch(ignore) { parseStatus = 'NON_JSON'; }
        }
        output.push({market:markets[index], httpStatus:status, rows:rows, parseStatus:parseStatus});
      });
    } catch(error) { return jsonOk({ requestedDate:date, keyConfigured:true,
      markets:output, networkStatus:'FETCH_FAILED', message:'KRX 네트워크 요청 실패' }); }
    return jsonOk({ requestedDate:date, keyConfigured:true, markets:output, networkStatus:'RECEIVED' });
  } catch(err) { return jsonError('KRX 진단 실패: ' + String(err.message || 'unknown').slice(0,140)); }
}

function runDailyPortfolioClose1900() {
  var props = PropertiesService.getScriptProperties();
  var runDate = today();
  var startedAt = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  var priceResult = null;
  var fundResult = null;
  var errors = [];
  _recordPortfolioCloseStage(props, runDate, startedAt, 'PRICE');

  try {
    priceResult = saveDailyPriceHistory();
  } catch (priceErr) {
    errors.push('일반 종목: ' + (priceErr && priceErr.message ? priceErr.message : String(priceErr)));
    Logger.log('⚠️ 통합 마감 일반 종목 단계 실패 — 펀드 단계 계속: ' + errors[errors.length - 1]);
  }

  _recordPortfolioCloseStage(props, runDate, startedAt, 'FUND');
  try {
    fundResult = runDailyFundValuations();
  } catch (fundErr) {
    errors.push('펀드: ' + (fundErr && fundErr.message ? fundErr.message : String(fundErr)));
    Logger.log('⚠️ 통합 마감 펀드 단계 실패: ' + errors[errors.length - 1]);
  }

  var summary = {
    runDate: runDate,
    startedAt: startedAt,
    finishedAt: Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
    priceOk: !!priceResult,
    priceDate: priceResult && priceResult.date ? priceResult.date : '',
    priceRows: priceResult && isFinite(Number(priceResult.rows)) ? Number(priceResult.rows) : 0,
    fundOk: !!fundResult,
    fundLastDate: fundResult && fundResult.lastDate ? fundResult.lastDate : runDate,
    errors: errors.slice(0, 4)
  };
  props.setProperty('portfolio_close_last_result', JSON.stringify(summary));
  _recordPortfolioCloseStage(props, runDate, startedAt, errors.length ? 'ERROR' : 'COMPLETE');

  if (errors.length) {
    props.setProperty('portfolio_close_last_error', _fundPropertyText(errors.join(' | '), 2000));
    throw new Error('통합 마감 부분 실패: ' + errors.join(' | '));
  }
  props.deleteProperty('portfolio_close_last_error');
  Logger.log('✅ 19시 통합 마감 완료: 일반 종목 확정가·Snapshot + 펀드 NAV/평가');
  return summary;
}

function runDailyPriceSnapshotNow() {
  if (!_confirmPortfolioMenuAction('확정 평가단가·스냅샷 수동 갱신', '19시 통합 마감의 일반 종목 단계와 같은 경로로 확정 거래일 가격이력과 스냅샷을 저장합니다. 자동 실행 실패 또는 즉시 갱신이 필요할 때만 실행하세요.')) return;
  var ui = SpreadsheetApp.getUi();
  try {
    var result = saveDailyPriceHistory();
    ui.alert('✅ 확정 평가단가·스냅샷 갱신 완료\n\n'
      + '기준일: ' + result.date + '\n'
      + '스냅샷: ' + result.rows + '행\n\n'
      + '이 메뉴는 19시 통합 마감의 일반 종목 단계와 동일한 경로를 실행합니다.');
  } catch(err) {
    ui.alert('❌ 확정 평가단가·스냅샷 갱신 실패\n\n' + (err.message || String(err)));
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════
//  전일(T-1) 거래일 계산 — 주말/공휴일 건너뜀 (최대 7일 전까지)
// ════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════
//  소급채우기 — 팝업 입력창
// ════════════════════════════════════════════════════════════════════
function backfillRangePrompt() {
  var ui = SpreadsheetApp.getUi();

  var r1 = ui.prompt('소급채우기 — 시작 연월', '시작 연월을 입력하세요\n예) 2024-01', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var fromStr = r1.getResponseText().trim();

  var r2 = ui.prompt('소급채우기 — 종료 연월', '종료 연월을 입력하세요\n예) 2026-03', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var toStr = r2.getResponseText().trim();

  var fromMatch = fromStr.match(/^(\d{4})-(\d{1,2})$/);
  var toMatch   = toStr.match(/^(\d{4})-(\d{1,2})$/);
  if (!fromMatch || !toMatch) {
    ui.alert('❌ 형식 오류: YYYY-MM 형식으로 입력해주세요.\n예) 2024-01');
    return;
  }

  BACKFILL_CONFIG.fromYear  = parseInt(fromMatch[1]);
  BACKFILL_CONFIG.fromMonth = parseInt(fromMatch[2]);
  BACKFILL_CONFIG.toYear    = parseInt(toMatch[1]);
  BACKFILL_CONFIG.toMonth   = parseInt(toMatch[2]);

  if (BACKFILL_CONFIG.fromMonth < 1 || BACKFILL_CONFIG.fromMonth > 12 || BACKFILL_CONFIG.toMonth < 1 || BACKFILL_CONFIG.toMonth > 12 || BACKFILL_CONFIG.fromYear * 12 + BACKFILL_CONFIG.fromMonth > BACKFILL_CONFIG.toYear * 12 + BACKFILL_CONFIG.toMonth) { ui.alert('❌ 시작·종료 연월을 확인하세요. 월은 1~12여야 합니다.'); return; }
  if (!_confirmPortfolioMenuAction('기간 소급채우기 시작', fromStr + ' ~ ' + toStr + '\n가격이력·스냅샷을 저장합니다. 기존 자료 ' + (BACKFILL_CONFIG.overwrite ? '덮어쓰기: 켜짐' : '덮어쓰기: 꺼짐') + '. 새 작업은 기존 소급채우기 진행 위치를 대체합니다. 실제 누락 기간이 있을 때만 실행하세요.')) return;
  backfillRange();
}

function backfillRange() {
  var from = BACKFILL_CONFIG.fromYear * 100 + BACKFILL_CONFIG.fromMonth;
  var to   = BACKFILL_CONFIG.toYear   * 100 + BACKFILL_CONFIG.toMonth;
  if (BACKFILL_CONFIG.fromMonth < 1 || BACKFILL_CONFIG.fromMonth > 12 ||
      BACKFILL_CONFIG.toMonth   < 1 || BACKFILL_CONFIG.toMonth   > 12) {
    try { SpreadsheetApp.getUi().alert('❌ BACKFILL_CONFIG 오류: fromMonth/toMonth 는 1~12 사이여야 합니다.'); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
    Logger.log('backfillRange 중단: 월 범위 오류'); return;
  }
  if (from > to) {
    try { SpreadsheetApp.getUi().alert('❌ BACKFILL_CONFIG 오류: 시작 연월이 종료 연월보다 늦습니다.'); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
    Logger.log('backfillRange 중단: 시작 연월 > 종료 연월'); return;
  }

  var props = PropertiesService.getScriptProperties();
  props.setProperty('bf_fromYear',  String(BACKFILL_CONFIG.fromYear));
  props.setProperty('bf_fromMonth', String(BACKFILL_CONFIG.fromMonth));
  props.setProperty('bf_toYear',    String(BACKFILL_CONFIG.toYear));
  props.setProperty('bf_toMonth',   String(BACKFILL_CONFIG.toMonth));
  props.setProperty('bf_overwrite', String(BACKFILL_CONFIG.overwrite));
  props.setProperty('bf_curYear',   String(BACKFILL_CONFIG.fromYear));
  props.setProperty('bf_curMonth',  String(BACKFILL_CONFIG.fromMonth));
  props.setProperty('bf_done',      'false');

  Logger.log('소급채우기 시작: ' + BACKFILL_CONFIG.fromYear + '-' + _pad(BACKFILL_CONFIG.fromMonth) +
             ' ~ ' + BACKFILL_CONFIG.toYear + '-' + _pad(BACKFILL_CONFIG.toMonth));
  _backfillExecute();
}

function backfillResume() {
  var props = PropertiesService.getScriptProperties();
  var done  = props.getProperty('bf_done');
  if (done === 'true') {
    try { SpreadsheetApp.getUi().alert('✅ 이미 소급채우기가 완료된 상태입니다.\n새로 실행하려면 backfillRange()를 사용하세요.'); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
    return;
  }
  if (!props.getProperty('bf_curYear')) {
    try { SpreadsheetApp.getUi().alert('⚠️ 이어받을 진행상황이 없습니다.\nbackfillRange()를 먼저 실행하세요.'); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
    return;
  }
  Logger.log('소급채우기 재개: ' + props.getProperty('bf_curYear') + '-' + _pad(parseInt(props.getProperty('bf_curMonth'))));
  _backfillExecute();
}

function backfillStatus() {
  var props    = PropertiesService.getScriptProperties();
  var curYear  = props.getProperty('bf_curYear');
  var curMonth = props.getProperty('bf_curMonth');
  var toYear   = props.getProperty('bf_toYear');
  var toMonth  = props.getProperty('bf_toMonth');
  var done     = props.getProperty('bf_done');

  var msg;
  if (!curYear) {
    msg = '소급채우기를 시작한 기록이 없습니다.';
  } else if (done === 'true') {
    msg = '✅ 소급채우기 완료!\n종료 시점: ' + toYear + '-' + _pad(parseInt(toMonth));
  } else {
    msg = '⏳ 진행 중\n현재 위치: ' + curYear + '-' + _pad(parseInt(curMonth)) +
          '\n목표: ' + toYear + '-' + _pad(parseInt(toMonth)) +
          '\n\nbackfillResume() 을 실행하면 이어서 진행합니다.';
  }
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}

function _backfillExecute() {
  var props     = PropertiesService.getScriptProperties();
  var fromYear  = parseInt(props.getProperty('bf_fromYear'));
  var fromMonth = parseInt(props.getProperty('bf_fromMonth'));
  var toYear    = parseInt(props.getProperty('bf_toYear'));
  var toMonth   = parseInt(props.getProperty('bf_toMonth'));
  var overwrite = props.getProperty('bf_overwrite') === 'true';
  var curYear   = parseInt(props.getProperty('bf_curYear'));
  var curMonth  = parseInt(props.getProperty('bf_curMonth'));

  var ss = getss();

  var tradeSh = ss.getSheetByName(CONFIG.SHEET_TRADES);
  if (!tradeSh || tradeSh.getLastRow() < 2) {
    var errMsg = '⚠️ 거래이력 시트가 없습니다.\nHTML 대시보드를 열면 거래이력이 자동으로 동기화됩니다.';
    Logger.log(errMsg);
    try { SpreadsheetApp.getUi().alert(errMsg); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
    return;
  }
  var tradeData = tradeSh.getRange(2, 1, tradeSh.getLastRow() - 1, Math.min(11, tradeSh.getLastColumn())).getValues();

  var nameToCode = {};
  getCodeItems(ss).forEach(function(item){ nameToCode[item.name] = item.code; });
  tradeData.forEach(function(row) {
    var name = (row[3]||'').toString().trim();
    var code = (row[4]||'').toString().trim();
    if (name && code && !nameToCode[name]) nameToCode[name] = code;
  });
  var fundConfigsBf = _readFundUnits(ss);

  // ★ [환율 연동] 종목코드→통화 맵 (소급 스냅샷 환율 환산용)
  var codeToCurrencyBf = {};
  try {
    var codeSh2 = ss.getSheetByName(CONFIG.SHEET_CODES);
    if (codeSh2 && codeSh2.getLastRow() > 1) {
      var codeData2 = codeSh2.getRange(2, 1, codeSh2.getLastRow() - 1, Math.min(5, codeSh2.getLastColumn())).getValues();
      codeData2.forEach(function(row) {
        var code = _cleanCode(row[0]) || (row[0] || '').toString().trim();
        var cur  = (row[4] || '').toString().trim().toUpperCase();
        if (code && cur && cur !== 'KRW') codeToCurrencyBf[code] = cur;
      });
    }
  } catch(e) {}

  var existingDates = {};
  var existingPhDates = {};
  if (!overwrite) {
    var snapSh = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
    if (snapSh && snapSh.getLastRow() > 1) {
      snapSh.getRange(2, 1, snapSh.getLastRow() - 1, 1).getValues().forEach(function(r) {
        // ★ [버그수정] _normalizeDate() 적용 — Date 객체/문자열 모두 YYYY-MM-DD 로 정규화
        //   미적용 시 Date 객체가 'Mon Apr 13 2026...' 형태로 읽혀 날짜 비교 실패
        var d = _normalizeDate(r[0]);
        if (d) existingDates[d] = true;
      });
    }
    var phSh = ss.getSheetByName(CONFIG.SHEET_PH);
    if (phSh && phSh.getLastRow() > 1) {
      phSh.getRange(2, 1, phSh.getLastRow() - 1, 1).getValues().forEach(function(r) {
        var d = _normalizeDate(r[0]);
        if (d) existingPhDates[d] = true;
      });
    }
  }

  var startTime    = new Date().getTime();
  var TIME_LIMIT   = 5 * 60 * 1000;
  var totalSuccess = 0, totalFail = 0;
  var interrupted  = false;
  var lastYear     = curYear, lastMonth = curMonth;

  outer:
  while (true) {
    if (curYear > toYear || (curYear === toYear && curMonth > toMonth)) break;

    var tradingDays = getTradingDays(curYear, curMonth);
    var toFetch     = overwrite
      ? tradingDays
      : tradingDays.filter(function(d){ return !existingDates[d] || !existingPhDates[d]; });

    Logger.log(curYear + '-' + _pad(curMonth) + ' 처리 시작: ' + toFetch.length + '일');

    for (var i = 0; i < toFetch.length; i++) {
      if (new Date().getTime() - startTime > TIME_LIMIT) {
        interrupted = true;
        lastYear    = curYear;
        lastMonth   = curMonth;
        break outer;
      }

      var dateStr = toFetch[i];
      var backfillOperationId = '', previousBackfillOperationId = _snapshotBackupOperationId;
      try {
        var holdAtDate = calcHoldingsAtDate(tradeData, dateStr, nameToCode);
        var holdingCountBeforeLifecycle = Object.keys(holdAtDate).length;
        _applyFundUnitLifecycleToSnapshotHoldings(holdAtDate, fundConfigsBf, dateStr);
        if (Object.keys(holdAtDate).length === 0) {
          if (holdingCountBeforeLifecycle > 0) {
            var emptyBackfillPlan = _snapshotRewritePlan(ss, dateStr, [], fundConfigsBf);
            if (emptyBackfillPlan.unsafe.length) throw new Error('Snapshot 보호 충돌: ' + emptyBackfillPlan.unsafe.map(function(item) { return item.classification + ': ' + item.reason; }).join('; '));
            if (emptyBackfillPlan.lifecycleRemovedRows > 0 && emptyBackfillPlan.needsRewrite) {
              backfillOperationId = 'backfill|' + dateStr + '|' + Utilities.getUuid();
              _snapshotBackupOperationId = backfillOperationId;
              writeSnapshotRows(ss, dateStr, emptyBackfillPlan.raw, true, null, fundConfigsBf);
              _finalizeBackfillSnapshotOperation(ss, dateStr, backfillOperationId);
              totalSuccess++;
            }
          }
          continue;
        }

        var codeItems = Object.keys(holdAtDate)
          .map(function(k){ return holdAtDate[k]; })
          .filter(function(h){ return h.code; })
          .map(function(h){ return { code: h.code, name: h.name }; });

        var prices = {};
        var priceSources = {};
        if (codeItems.length > 0) {
          var gfResult = {};
          try {
            gfResult = fetchPricesGoogleFinance(codeItems, dateStr, ss);
          } catch(gfErr) {
            Logger.log(dateStr + ' GF 실패, 재시도: ' + gfErr.message);
            Utilities.sleep(3000);
            try { gfResult = fetchPricesGoogleFinance(codeItems, dateStr, ss); } catch(e2) {}
          }
          Object.keys(gfResult).forEach(function(code) {
            var val = gfResult[code];
            prices[code] = val.price || val;
            priceSources[code] = val.source || 'GOOGLEFINANCE';
          });
        }

        // 수동 펀드·TDF와 수동 보정가격은 기준일 이하 가격이력에서 복원합니다.
        // 같은 날짜 MANUAL은 자동조회보다 우선하며, 이후 날짜의 가격은 조회하지 않습니다.
        var historyKeys = Object.keys(holdAtDate).map(function(k) {
          var h = holdAtDate[k];
          return _cleanCode(h.code) || h.code || h.name;
        }).filter(Boolean);
        var exactHistory = getPriceHistoryRow(ss, dateStr);
        var latestHistory = getLatestPriceHistory(ss, historyKeys, dateStr);
        var historySources = _getPriceSourceByDate(ss, dateStr);
        Object.keys(holdAtDate).forEach(function(k) {
          var h = holdAtDate[k];
          var key = _cleanCode(h.code) || h.code || h.name;
          if (!key) return;
          var sourceMeta = historySources[key];
          var historyPrice = exactHistory[key] || latestHistory[key] || 0;
          if (historyPrice > 0 && ((sourceMeta && sourceMeta.src === 'MANUAL') || !prices[key])) {
            prices[key] = historyPrice;
            priceSources[key] = sourceMeta ? sourceMeta.src : 'PRICE_HISTORY';
          }
        });

        var snapRows = [];
        // ★ [환율 연동] 소급 스냅샷에서도 외화 종목 원화 환산
        // 해당 날짜의 환율을 GOOGLEFINANCE로 조회 (과거 환율)
        var bfFxRates = {};
        try {
          var fxCurrencies = [];
          Object.keys(holdAtDate).forEach(function(k) {
            var cur = codeToCurrencyBf[holdAtDate[k].code || ''];
            if (cur && fxCurrencies.indexOf(cur) === -1) fxCurrencies.push(cur);
          });
          if (fxCurrencies.length > 0) {
            // ★ [버그수정] 공유 임시 시트 대신 고유 임시 시트 사용 (동시 요청 충돌 방지)
            // ★ [안전장치] try/finally로 감싸 중간에 오류가 나도 임시 시트가 반드시 정리되도록 함
            var fxSheet = ss.insertSheet(_tempSheetName('_bffx_tmp_'));
            try {
              var fxFormulas = fxCurrencies.map(function(cur) {
                return ['=IFERROR(GOOGLEFINANCE("CURRENCY:' + cur + 'KRW","price","' + dateStr + '"),0)'];
              });
              fxSheet.getRange(1, 1, fxFormulas.length, 1).setFormulas(fxFormulas);
              SpreadsheetApp.flush();
              var fxVals = fxSheet.getRange(1, 1, fxFormulas.length, 1).getValues();
              fxCurrencies.forEach(function(cur, i) {
                var v = Number(fxVals[i][0]);
                if (v > 0) bfFxRates[cur] = Math.round(v * 10) / 10;
              });
            } finally {
              try { ss.deleteSheet(fxSheet); } catch(delErr) {}
            }
          }
        } catch(fxErr) {
          Logger.log('소급 환율 조회 실패 ' + dateStr + ': ' + fxErr.message);
        }

        Object.keys(holdAtDate).forEach(function(k) {
          var h = holdAtDate[k];
          if (h.qty <= 0) return;
          var priceKey = _cleanCode(h.code) || h.code || h.name;
          var price   = priceKey && prices[priceKey] ? prices[priceKey] : 0;
          // ★ [환율 연동] 외화 종목 원화 환산
          var hCurrency = (h.code && codeToCurrencyBf[h.code]) ? codeToCurrencyBf[h.code] : 'KRW';
          var hFxRate   = (hCurrency !== 'KRW' && bfFxRates[hCurrency] > 0) ? bfFxRates[hCurrency] : 1;
          var priceKrw  = price > 0 ? Math.round(price * hFxRate) : 0;
          var evalAmt   = priceKrw > 0 ? Math.round(priceKrw * h.qty) : h.costAmt;
          var pnl     = evalAmt - h.costAmt;
          var pct     = h.costAmt > 0 ? parseFloat(((pnl / h.costAmt) * 100).toFixed(2)) : 0;
          var costUnit = h.qty > 0 ? parseFloat((h.costAmt / h.qty).toFixed(2)) : 0;
          var evalUnit = h.qty > 0 ? parseFloat((evalAmt / h.qty).toFixed(2)) : 0;
          var sourceMeta = priceKey ? historySources[priceKey] : null;
          var rowSource = priceSources[priceKey] || (price > 0 ? 'PRICE_HISTORY' : 'COST_FALLBACK');
          var rowSavedAt = rowSource === 'MANUAL' && sourceMeta ? (sourceMeta.savedAt || '') : '';
          snapRows.push([dateStr, h.code, h.name, h.qty, costUnit, h.costAmt, evalUnit, evalAmt, pnl, pct, rowSource, rowSavedAt]);
        });

        if (snapRows.length > 0) {
          var backfillPlan = _snapshotRewritePlan(ss, dateStr, snapRows, fundConfigsBf);
          if (backfillPlan.unsafe.length) throw new Error('Snapshot 보호 충돌: ' + backfillPlan.unsafe.map(function(item) { return item.classification + ': ' + item.reason; }).join('; '));
          backfillOperationId = 'backfill|' + dateStr + '|' + Utilities.getUuid();
          _snapshotBackupOperationId = backfillOperationId;
          writeSnapshotRows(ss, dateStr, snapRows, overwrite, null, fundConfigsBf);
          // ★ 가격이력 시트도 함께 저장 — 프론트 과거 날짜 조회용
          var phItems = Object.keys(holdAtDate)
            .map(function(k){ return holdAtDate[k]; })
            .filter(function(h){
              var key = _cleanCode(h.code) || h.code || h.name;
              var src = key ? priceSources[key] : '';
              return h.code && h.qty > 0 && prices[key] > 0 && src !== 'MANUAL' && src !== 'PRICE_HISTORY';
            })
            .map(function(h){
              var key = _cleanCode(h.code) || h.code || h.name;
              return { code: h.code, name: h.name, price: prices[key], source: (priceSources[key] || 'UNKNOWN') };
            });
          if (phItems.length > 0) batchUpsertPriceHistory(ss, dateStr, phItems);
          _finalizeBackfillSnapshotOperation(ss, dateStr, backfillOperationId);
          totalSuccess++;
        }
      } catch(e) {
        if (backfillOperationId) _settleSnapshotBackupOperation(ss, backfillOperationId, false, e.message);
        Logger.log('❌ ' + dateStr + ' 실패: ' + e.message);
        totalFail++;
      } finally { _snapshotBackupOperationId = previousBackfillOperationId; }
    }

    lastYear  = curYear;
    lastMonth = curMonth;
    if (curMonth === 12) { curYear++; curMonth = 1; }
    else { curMonth++; }
  }

  SpreadsheetApp.flush();

  if (interrupted) {
    props.setProperty('bf_curYear',  String(lastYear));
    props.setProperty('bf_curMonth', String(lastMonth));
    var msg = '⏱ 시간 초과로 잠시 중단\n\n' +
              '완료: ' + totalSuccess + '일 성공 / ' + totalFail + '일 실패\n' +
              '중단 위치: ' + lastYear + '-' + _pad(lastMonth) + '\n\n' +
              '📌 [📆 소급채우기 이어서] 메뉴를 눌러 계속 진행하세요.';
    Logger.log(msg);
    try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
  } else {
    props.setProperty('bf_curYear',  String(toYear));
    props.setProperty('bf_curMonth', String(toMonth));
    props.setProperty('bf_done', 'true');
    var doneMsg = '✅ 소급채우기 완료!\n\n' +
                  fromYear + '-' + _pad(fromMonth) + ' ~ ' + toYear + '-' + _pad(toMonth) + '\n' +
                  '성공: ' + totalSuccess + '일 / 실패: ' + totalFail + '일';
    Logger.log(doneMsg);
    try { SpreadsheetApp.getUi().alert(doneMsg); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
  }
}

function _snapshotIntegritySatisfied(integrity) {
  return !!(integrity && (integrity.status === 'VALID' ||
    (integrity.status === 'NO_SNAPSHOT' && Number(integrity.expectedRowCount || 0) === 0 && Number(integrity.storedRowCount || 0) === 0)));
}

function _finalizeBackfillSnapshotOperation(ss, dateStr, operationId) {
  SpreadsheetApp.flush();
  var integrity = diagnoseSnapshotIntegrity(ss, dateStr);
  if (!_snapshotIntegritySatisfied(integrity)) throw new Error('backfill Snapshot 재진단 실패: ' + (integrity ? integrity.status : 'NO_RESULT'));
  return _settleSnapshotBackupOperation(ss, operationId, true);
}


// 환율 과거 원천은 현재 운영 코드에서 생성하지 않습니다. 운영자가 이미 만든
// '환율이력' 시트가 있고 헤더가 확인된 경우에만 읽으며, 없으면 현재 환율로 대체하지 않습니다.
function handleGetExchangeRateHistory(fromStr, toStr, currenciesInput) {
  try {
    var fromDate = _normalizeDate(fromStr || '') || '2024-01-01';
    var toDate = _normalizeDate(toStr || '') || today();
    if (fromDate > toDate) { var swap = fromDate; fromDate = toDate; toDate = swap; }
    var requested = String(currenciesInput || 'USD').split(',').map(function(value) {
      return String(value || '').trim().toUpperCase();
    }).filter(function(value, index, all) { return value && all.indexOf(value) === index; });
    var ss = getss();
    var sh = ss.getSheetByName('환율이력');
    if (!sh || sh.getLastRow() < 2) return jsonOk({ history: [], source: '환율이력', status: 'MISSING_SOURCE' });
    var header = sh.getRange(1, 1, 1, Math.min(3, sh.getLastColumn())).getValues()[0].map(function(value) { return String(value || '').trim(); });
    if (header[0] !== '날짜' || header[1] !== '통화' || header[2] !== '환율') return jsonOk({ history: [], source: '환율이력', status: 'INVALID_SCHEMA' });
    var history = [];
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function(row) {
      var date = _normalizeDate(row[0]);
      var currency = String(row[1] || '').trim().toUpperCase();
      var rate = Number(row[2]);
      if (!date || date < fromDate || date > toDate || requested.indexOf(currency) === -1 || !(rate > 0)) return;
      history.push({ date: date, currency: currency, rate: rate });
    });
    history.sort(function(a,b) { return a.date === b.date ? a.currency.localeCompare(b.currency) : a.date.localeCompare(b.date); });
    return jsonOk({ history: history, source: '환율이력', status: history.length ? 'CONFIRMED' : 'NO_DATA' });
  } catch(err) {
    return jsonError('getExchangeRateHistory 실패: ' + err.message);
  }
}

function _getHistoricalExchangeRates(ss, currencies, dateStr) {
  var requested = (currencies || []).map(function(value) { return String(value || '').trim().toUpperCase(); }).filter(Boolean);
  var sh = ss.getSheetByName('환율이력');
  if (!sh || sh.getLastRow() < 2 || !requested.length) return {};
  var header = sh.getRange(1, 1, 1, Math.min(3, sh.getLastColumn())).getValues()[0].map(function(value) { return String(value || '').trim(); });
  if (header[0] !== '날짜' || header[1] !== '통화' || header[2] !== '환율') return {};
  var latest = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function(row) {
    var date = _normalizeDate(row[0]);
    var currency = String(row[1] || '').trim().toUpperCase();
    var rate = Number(row[2]);
    if (!date || date > dateStr || requested.indexOf(currency) === -1 || !(rate > 0)) return;
    if (!latest[currency] || date > latest[currency].date) latest[currency] = { date: date, rate: rate };
  });
  var result = {};
  Object.keys(latest).forEach(function(currency) { result[currency] = latest[currency].rate; });
  return result;
}

// ════════════════════════════════════════════════════════════════════
//  거래이력 누적 계산 — dateStr 시점의 보유현황 반환
// ════════════════════════════════════════════════════════════════════
function _applyHoldingTrade(map, row, nameToCode, maxDate) {
  var rawDate = row[0];
  var date = (rawDate instanceof Date)
    ? Utilities.formatDate(rawDate, CONFIG.TIMEZONE, 'yyyy-MM-dd')
    : (rawDate || '').toString().trim().slice(0, 10);
  var tradeType = (row[1] || '').toString().trim();
  var name = (row[3] || '').toString().trim();
  var rawCode = (row[4] || '').toString().trim() || ((nameToCode || {})[name] || '');
  var code = _cleanCode(rawCode) || rawCode;
  var qty = parseFloat(row[5]) || 0;
  var price = parseFloat(row[6]) || 0;
  var assetType = (row[7] || '주식').toString().trim();
  if (!date || !name || !tradeType || (maxDate && date > maxDate)) return;

  // 전체 보유·기간 진단·소급채우기·펀드 Snapshot은 이 동일 reducer를 사용합니다.
  // 회사명 변경 전 매수 + 변경 후 전량매도를 코드로 합산해 유령 보유분을 차단합니다.
  // 코드가 없는 거래만 기존 종목명 기준으로 취급합니다.
  var identity = code || name;
  var holding = map[identity];
  if (!holding) {
    holding = map[identity] = { name:name, code:code, qty:0, totalCost:0, assetType:assetType };
  }
  if (!holding.code && code) holding.code = code;
  // 표시명은 사용 가능한 마지막 거래 종목명을 유지하되 수량 집계 기준과 분리합니다.
  if (name) holding.name = name;

  if (tradeType === 'buy') {
    holding.qty += qty;
    holding.totalCost += qty * price;
  } else if (tradeType === 'sell') {
    var avgCost = holding.qty > 0 ? holding.totalCost / holding.qty : 0;
    var sellQty = Math.min(qty, holding.qty);
    holding.qty -= sellQty;
    holding.totalCost -= sellQty * avgCost;
    if (holding.qty < 0.0001) { holding.qty = 0; holding.totalCost = 0; }
  } else if (tradeType === 'split' || tradeType === 'reverse_split') {
    var ratio = parseFloat(row[9]) || 0;
    if (ratio > 0 && holding.qty > 0) {
      holding.qty = tradeType === 'split' ? holding.qty * ratio : holding.qty / ratio;
    }
  }
}

function _snapshotHoldingState(map) {
  var result = {};
  Object.keys(map).forEach(function(name) {
    var h = map[name];
    if (h.qty > 0.0001) {
      result[name] = { name: h.name, code: h.code,
        qty:     Math.round(h.qty * 10000) / 10000,
        costAmt: Math.round(h.totalCost), assetType: h.assetType };
    }
  });
  return result;
}

function calcHoldingsAtDate(tradeData, dateStr, nameToCode) {
  var map = {};
  tradeData.forEach(function(row) { _applyHoldingTrade(map, row, nameToCode || {}, dateStr); });
  return _snapshotHoldingState(map);
}

// 기간 진단은 같은 거래를 날짜마다 처음부터 재생하지 않고 날짜순으로 한 번만 적용합니다.
function _buildHoldingsByRequestedDate(tradeData, dates, nameToCode) {
  var sortedTrades = (tradeData || []).map(function(row, index) {
    return { row: row, index: index, date: _normalizeDate(row[0]) };
  }).filter(function(item) { return !!item.date; }).sort(function(a, b) {
    return a.date === b.date ? a.index - b.index : a.date.localeCompare(b.date);
  });
  var state = {}, output = {}, tradeIndex = 0;
  (dates || []).slice().sort().forEach(function(date) {
    while (tradeIndex < sortedTrades.length && sortedTrades[tradeIndex].date <= date) {
      _applyHoldingTrade(state, sortedTrades[tradeIndex].row, nameToCode || {}, null);
      tradeIndex++;
    }
    output[date] = _snapshotHoldingState(state);
  });
  return output;
}

// ════════════════════════════════════════════════════════════════════
//  영업일 목록 (토·일 제외)
// ════════════════════════════════════════════════════════════════════
function getTradingDays(year, month) {
  var days     = [];
  var last     = new Date(year, month, 0).getDate();
  var todayStr = today();
  for (var d = 1; d <= last; d++) {
    var dt  = new Date(year, month - 1, d);
    var dow = dt.getDay();
    if (dow === 0 || dow === 6) continue;
    var ds = Utilities.formatDate(dt, CONFIG.TIMEZONE, 'yyyy-MM-dd');
    if (ds >= todayStr) continue;
    days.push(ds);
  }
  return days;
}

// ════════════════════════════════════════════════════════════════════
//  스냅샷 시트 upsert
// ════════════════════════════════════════════════════════════════════
function writeSnapshotRows(ss, dateStr, newRows, overwrite, manualKeys, lifecycleConfigs) {
  var writeLock = LockService.getScriptLock();
  var ownsWriteLock = false;
  var snapshotBackupRecord = null;
  try {
    if (!writeLock.hasLock()) { writeLock.waitLock(30000); ownsWriteLock = true; }
    var sh     = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
    // ★ 12콸럼으로 확장: 11=평가단가소스, 12=저장일시(MANUAL일 때만 체우고 나머지 빈문자열)
    var header = [['\ub0a0\uc9dc','\uc885\ubaa9\ucf54\ub4dc','\uc885\ubaa9\uba85','\uc218\ub7c9','\ub9e4\uc218\ub2e8\uac00','\ub9e4\uc218\uc6d0\uae08','\ud3c9\uac00\ub2e8\uac00','\ud3c9\uac00\uae08\uc561','\uc190\uc775','\uc218\uc775\ub960(%)','\ud3c9\uac00\ub2e8\uac00\uc18c\uc2a4','\uc800\uc7a5\uc77c\uc2dc']];
    var colSize = header[0].length; // 12
    var toNewSnapshotRow = function(r) {
      if (!Array.isArray(r)) return ['', '', '', 0, 0, 0, 0, 0, 0, 0, '', ''];
      // 길이 12 이상: 앞 12콸만 사용
      if (r.length >= 12) return r.slice(0, 12);
      // 길이 11(기존 데이터): savedAt 빈문자열 추가
      if (r.length === 11) return r.concat(['']);
      if (r.length === 10) return r.concat(['', '']);
      var qty = parseFloat(r[3]) || 0;
      var costAmt = parseFloat(r[4]) || 0;
      var evalAmt = parseFloat(r[5]) || 0;
      var pnl = parseFloat(r[6]) || (evalAmt - costAmt);
      var pct = parseFloat(r[7]) || (costAmt > 0 ? parseFloat(((pnl / costAmt) * 100).toFixed(2)) : 0);
      var costUnit = qty > 0 ? parseFloat((costAmt / qty).toFixed(2)) : 0;
      var evalUnit = qty > 0 ? parseFloat((evalAmt / qty).toFixed(2)) : 0;
      return [r[0] || '', r[1] || '', r[2] || '', qty, costUnit, costAmt, evalUnit, evalAmt, pnl, pct, (r[10] || ''), (r[11] || '')];
    };
    var normDate = _normalizeDate(dateStr || '');
    newRows = (newRows || []).map(toNewSnapshotRow).map(function(r) {
      r[0] = _normalizeDate(r[0]) || normDate;
      return r;
    });
    newRows = _dedupeSnapshotRows(newRows);
    var configsForWrite = Array.isArray(lifecycleConfigs) ? lifecycleConfigs : null;
    var incomingHasFundRows = newRows.some(function(row) {
      return _isFundCode(_cleanCode(row && row[1]) || String(row && row[1] || '').trim().toUpperCase());
    });
    if (incomingHasFundRows) {
      if (!configsForWrite) configsForWrite = _readFundUnits(ss);
      newRows = _filterSnapshotRowsByFundLifecycle(newRows, configsForWrite, normDate);
    }

    if (!sh) {
      if (!newRows.length) return;
      sh = ss.insertSheet(CONFIG.SHEET_SNAPSHOT);
      _setCodeColumnText(sh, 2);
      sh.getRange(1,1,1,colSize).setValues(header);
      sh.getRange(1,1,1,colSize).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
      if (newRows.length > 0) sh.getRange(2, 1, newRows.length, colSize).setValues(_normalizeCodeRows(newRows, 1));
      if (newRows.length > 0) _touchSnapshotIntegritySourceRevision({ date: normDate });
      return;
    }

    if (sh.getLastRow() > 1) {
      var existing = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(12, sh.getLastColumn())).getValues().map(toNewSnapshotRow);
      var kept     = existing.filter(function(r){ return _normalizeDate(r[0]) !== normDate; });
      var sameDate = existing.filter(function(r){ return _normalizeDate(r[0]) === normDate; });
      var originalSameDateCount = sameDate.length;
      var existingHasFundRows = sameDate.some(function(row) {
        return _isFundCode(_cleanCode(row && row[1]) || String(row && row[1] || '').trim().toUpperCase());
      });
      if (existingHasFundRows) {
        if (!configsForWrite) configsForWrite = _readFundUnits(ss);
        sameDate = _filterSnapshotRowsByFundLifecycle(sameDate, configsForWrite, normDate);
        newRows = _filterSnapshotRowsByFundLifecycle(newRows, configsForWrite, normDate);
      }
      var lifecycleRemovedRows = originalSameDateCount - sameDate.length;
      if (!newRows.length && !lifecycleRemovedRows) return;
      var rawDuplicateDecisions = _classifyRawSnapshotDuplicateGroups(normDate, sameDate, newRows, '');
      var autoResolutionByKey = {};
      rawDuplicateDecisions.filter(function(item) { return item.autoResolvable; }).forEach(function(item) {
        autoResolutionByKey[item.key] = item.keepRow;
      });
      if (Object.keys(autoResolutionByKey).length) {
        var emittedResolutionKeys = {};
        sameDate = sameDate.reduce(function(out, row) {
          var key = _snapshotIntegrityKey(row), replacement = autoResolutionByKey[key];
          if (!replacement) { out.push(row); return out; }
          if (!emittedResolutionKeys[key]) { out.push(replacement); emittedResolutionKeys[key] = true; }
          return out;
        }, []);
      }
      // ★ [버그수정] overwrite=false 시 판단 기준 변경
      //   기존: 해당 날짜 행이 하나라도 있으면 전체 skip → 일부 종목만 있어도 나머지 미기록
      //   수정: newRows 의 종목 중 이미 기록된 종목만 제외하고, 없는 종목은 추가
      if (!overwrite && kept.length < existing.length) {
        // 이미 해당 날짜 데이터가 일부라도 있는 경우:
        // newRows 중 아직 없는 종목(코드)만 걸러서 추가
        var existingKeys = {};
        sameDate.forEach(function(r) {
          var d = _normalizeDate(r[0]);
          if (d !== normDate) return;
          var k = _cleanCode(r[1]) || (r[2] || '').toString().trim();
          if (k) existingKeys[d + '|' + k] = true;
        });
        var toAdd = newRows.filter(function(r) {
          var k = _cleanCode(r[1]) || (r[2] || '').toString().trim();
          return k && !existingKeys[normDate + '|' + k];
        });
        if (toAdd.length === 0 && !Object.keys(autoResolutionByKey).length && !lifecycleRemovedRows) return; // 추가/정리할 행 없음 → skip
        newRows = toAdd; // 없는 종목만 추가
      }
      var protectedDuplicateKeys = {};
      rawDuplicateDecisions.filter(function(item) { return !item.autoResolvable; }).forEach(function(item) { protectedDuplicateKeys[item.key] = true; });
      var mergeIncomingRows = newRows.filter(function(row) { return !protectedDuplicateKeys[_snapshotIntegrityKey(row)]; });
      var mergedDate = _mergeSnapshotRowsSafely(sameDate, mergeIncomingRows, overwrite, manualKeys);
      if (overwrite) {
        var expectedKeys = {};
        newRows.forEach(function(row) { expectedKeys[_cleanCode(row[1]) || String(row[2] || '').trim()] = true; });
        mergedDate = mergedDate.filter(function(row) {
          var key = _cleanCode(row[1]) || String(row[2] || '').trim();
          return expectedKeys[key] || protectedDuplicateKeys[key] || String(row[10] || '').toUpperCase() === 'MANUAL';
        });
      }
      // dedupe된 signature가 같아도 raw 원장에 중복이 있으면 반드시 rewrite합니다.
      if (_snapshotRowsSignature(mergedDate) === _snapshotRowsSignature(sameDate) && !rawDuplicateDecisions.length && !lifecycleRemovedRows) return;
      var combined = kept.concat(mergedDate);
      if (JSON.stringify(combined) === JSON.stringify(existing)) return;
      snapshotBackupRecord = _backupSnapshotBeforeWrite(ss, sh);
      // 먼저 비우면 쓰기 실패 때 모든 날짜가 사라집니다. 한 번의 쓰기로 교체합니다.
      var output = header.concat(combined);
      while (output.length < sh.getLastRow()) output.push(Array(colSize).fill(''));
      if (sh.getMaxRows() < output.length) sh.insertRowsAfter(sh.getMaxRows(), output.length - sh.getMaxRows());
      _setCodeColumnText(sh, 2);
      output = [output[0]].concat(_normalizeCodeRows(output.slice(1), 1));
      sh.getRange(1, 1, output.length, colSize).setValues(output);
      SpreadsheetApp.flush();
      var writtenDateRows = _readRawSnapshotRowsByDate(ss, normDate);
      var intendedSignature = mergedDate.map(_snapshotComparableSignature).sort().join('\n');
      var writtenSignature = writtenDateRows.map(_snapshotComparableSignature).sort().join('\n');
      if (writtenDateRows.length !== mergedDate.length || writtenSignature !== intendedSignature) throw new Error('Snapshot 쓰기 후 raw 검증 실패: ' + normDate);
      _touchSnapshotIntegritySourceRevision({ date: normDate });
      if (!_snapshotBackupOperationId) _markSnapshotBackupStatus(snapshotBackupRecord, 'COMPLETED');
      if (snapshotBackupRecord) {
        snapshotBackupRecord.cleanup = _snapshotBackupOperationId ? null : _cleanupCurrentSystemBackup(ss, snapshotBackupRecord);
        PropertiesService.getScriptProperties().setProperty('snapshot_backup_last_status', JSON.stringify(snapshotBackupRecord));
      }
    } else {
      if (newRows.length > 0) { _setCodeColumnText(sh, 2); sh.getRange(sh.getLastRow() + 1, 1, newRows.length, colSize).setValues(_normalizeCodeRows(newRows, 1)); _touchSnapshotIntegritySourceRevision({ date: normDate }); }
    }
  } catch(err) {
    _markSnapshotBackupStatus(snapshotBackupRecord, 'WRITE_FAILED', err.message);
    Logger.log('❌ writeSnapshotRows 실패: ' + err.message);
    throw err;
  } finally {
    if (ownsWriteLock) writeLock.releaseLock();
  }
}

function _mergeSnapshotRowsSafely(existing, incoming, overwrite, manualKeys) {
  var result = existing.slice();
  var indexes = {};
  var nameIndexes = {};
  var keyOf = function(row) { return _cleanCode(row[1]) || String(row[2] || '').trim(); };
  result.forEach(function(row, index) { indexes[keyOf(row)] = index; if (row[2]) nameIndexes[String(row[2])] = index; });
  incoming.forEach(function(row) {
    var key = keyOf(row);
    if (!key) throw new Error('스냅샷 종목 식별자 없음');
    if (!Object.prototype.hasOwnProperty.call(indexes, key) && Object.prototype.hasOwnProperty.call(nameIndexes, String(row[2]))) {
      var aliasIndex = nameIndexes[String(row[2])];
      if (!result[aliasIndex][1] || !row[1]) indexes[key] = aliasIndex;
    }
    if (!Object.prototype.hasOwnProperty.call(indexes, key)) {
      indexes[key] = result.length;
      if (row[2]) nameIndexes[String(row[2])] = result.length;
      result.push(row);
      return;
    }
    var old = result[indexes[key]];
    if (!overwrite) return;
    if (String(old[10]).toUpperCase() === 'MANUAL' && (manualKeys || []).indexOf(key) === -1) return;
    if (String(row[10]).toUpperCase() === 'COST_FALLBACK' && Number(old[7]) > 0) return;
    result[indexes[key]] = row;
  });
  return result;
}

var _snapshotBackupOperationId = '';
function _backupSheetBeforeWrite(ss, sheet, sourceName) {
  sourceName = String(sourceName || sheet.getName());
  var props = PropertiesService.getScriptProperties();
  var signatureKey = 'sheet_backup_signature|' + sourceName;
  var stateKey = 'sheet_backup_operation|' + sourceName;
  var repairState = null;
  try { repairState = JSON.parse(props.getProperty(SNAPSHOT_REPAIR_STATE_KEY) || 'null'); } catch (ignore) {}
  var activeRepairId = sourceName === CONFIG.SHEET_SNAPSHOT && repairState && !repairState.done ? String(repairState.startedAt || repairState.from || 'active') : '';
  var operationId = _snapshotBackupOperationId || activeRepairId;
  var registry = _readSystemBackupRegistry();
  var verifiedOperationBackup = function(record) {
    if (!record || record.systemGenerated !== true || record.source !== sourceName || record.operationId !== operationId || !record.signature) return null;
    var candidate = ss.getSheetByName(record.name);
    return candidate && _sheetContentSignature(candidate) === record.signature ? candidate : null;
  };
  if (operationId) {
    var operationRecord = registry.filter(function(record) {
      return !!verifiedOperationBackup(record);
    })[0];
    if (operationRecord) return Object.assign({}, operationRecord, { reused: true });
  }
  var sourceSignature = _sheetContentSignature(sheet);
  // v2부터 registry.signature은 실제 backup sheet 내용, sourceSignature은 복사 직전 원본 내용을 뜻합니다.
  // legacy record는 sourceSignature이 없으므로 과거 signature을 원본 힌트로만 사용합니다.
  var reusableRecord = registry.filter(function(record) {
    if (!record || record.systemGenerated !== true || record.source !== sourceName) return false;
    var expectedSourceSignature = String(record.sourceSignature || record.signature || '');
    if (expectedSourceSignature !== sourceSignature && (!operationId || record.operationId !== operationId)) return false;
    if (record.status !== 'CREATED' && record.status !== 'COMPLETED' && record.status !== 'WRITE_FAILED') return false;
    var candidate = ss.getSheetByName(record.name);
    var expectedBackupSignature = String(record.signature || '');
    // 같은 실행 안의 operationId는 서버 내부에서만 설정되며, 첫 쓰기 뒤 원본 signature가
    // 달라져도 논리 작업 전체의 쓰기 전 복구본 하나를 재사용합니다.
    if (candidate && operationId && record.operationId === operationId && candidate.getName().indexOf(sourceName + '_백업_') === 0 &&
        expectedBackupSignature && _sheetContentSignature(candidate) === expectedBackupSignature) return true;
    return !!candidate && candidate.getName().indexOf(sourceName + '_백업_') === 0 && expectedBackupSignature &&
      _sheetContentSignature(candidate) === expectedBackupSignature && expectedSourceSignature === sourceSignature;
  })[0];
  if (reusableRecord) {
    props.setProperty(signatureKey, sourceSignature);
    if (operationId) props.setProperty(stateKey, operationId);
    return Object.assign({}, reusableRecord, { reused: true, operationId: reusableRecord.operationId || operationId });
  }
  // stale Properties는 실제 복구본을 증명하지 못하므로 제거합니다.
  if (props.getProperty(signatureKey) === sourceSignature) props.deleteProperty(signatureKey);
  if (operationId && props.getProperty(stateKey) === operationId) props.deleteProperty(stateKey);
  var name = sourceName + '_백업_' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss') + '_' + Utilities.getUuid().slice(0, 6);
  var rowCount = sheet.getLastRow();
  var colCount = sheet.getLastColumn();
  var values = rowCount > 0 && colCount > 0 ? sheet.getRange(1, 1, rowCount, colCount).getValues() : [];
  var capacity = _fundSheetCapacity(ss);
  // insertSheet 기본 격자(통상 1,000×26) 생성 자체가 실패하지 않도록 사전에 차단합니다.
  var minimumCreationCells = Math.max(26000, Math.max(1, rowCount) * Math.max(1, colCount));
  if (capacity && capacity.remainingCells < minimumCreationCells) {
    // 원본 write 전에만, 안전하게 완료된 동일 source backup을 정리하고 용량을 다시 계산합니다.
    _cleanupSystemBackups(ss, sourceName, false);
    capacity = _fundSheetCapacity(ss);
  }
  if (capacity && capacity.remainingCells < minimumCreationCells) {
    throw new Error('스냅샷 백업 생성에 필요한 셀 ' + minimumCreationCells + '개가 남은 셀 ' + capacity.remainingCells + '개를 초과합니다. 원본은 변경하지 않았습니다. diagnoseWorkbookCells로 백업 점유량을 확인하세요.');
  }
  var backup = ss.insertSheet(name);
  // 기본 26열을 먼저 줄여 tall/narrow source의 행 확장 중 transient peak를 최소화합니다.
  if (typeof backup.deleteColumns === 'function' && backup.getMaxColumns() > Math.max(1, colCount)) backup.deleteColumns(Math.max(1, colCount) + 1, backup.getMaxColumns() - Math.max(1, colCount));
  if (values.length) {
    if (backup.getMaxRows() < values.length) backup.insertRowsAfter(backup.getMaxRows(), values.length - backup.getMaxRows());
    var sourceRange = sheet.getRange(1, 1, values.length, colCount);
    var backupRange = backup.getRange(1, 1, values.length, colCount);
    if (typeof sourceRange.copyTo === 'function') sourceRange.copyTo(backupRange);
    else backupRange.setValues(values);
  }
  // 백업 내용은 유지하되 기본 생성된 미사용 격자는 즉시 회수합니다.
  if (typeof backup.deleteRows === 'function' && backup.getMaxRows() > Math.max(1, rowCount)) backup.deleteRows(Math.max(1, rowCount) + 1, backup.getMaxRows() - Math.max(1, rowCount));
  props.setProperty(signatureKey, sourceSignature);
  if (operationId) props.setProperty(stateKey, operationId);
  var codeColumn = _codeColumnForSheet(sourceName);
  if (codeColumn) _setCodeColumnText(backup, codeColumn);
  // copyTo/서식 변경을 서버에 반영한 뒤 실제 backup을 읽어야 생성 직후 비동기 반영 차이를 signature로 오인하지 않습니다.
  if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) SpreadsheetApp.flush();
  // copyTo 이후 수식 재계산 등으로 source getValues()와 backup getValues()가 달라질 수 있으므로
  // 실제 backup 내용을 다시 서명합니다. sourceSignature은 같은 원본 상태 재사용 판정에만 사용합니다.
  var backupSignature = _sheetContentSignature(backup);
  var record = { name: name, source: sourceName, signature: backupSignature, sourceSignature: sourceSignature,
    signatureVersion: SYSTEM_BACKUP_SIGNATURE_VERSION, copySignatureDrift: backupSignature !== sourceSignature, operationId: operationId,
    status: 'CREATED', systemGenerated: true, createdAt: new Date().toISOString() };
  _registerSystemBackup(record);
  props.setProperty('snapshot_backup_last_status', JSON.stringify(record));
  return record;
}

function _backupSnapshotBeforeWrite(ss, sheet) {
  return _backupSheetBeforeWrite(ss, sheet, CONFIG.SHEET_SNAPSHOT);
}

function _markSnapshotBackupStatus(record, status, message) {
  if (!record) return;
  var existing = _readSystemBackupRegistry().filter(function(item) { return item.name === record.name; })[0] || {};
  var complete = Object.assign({}, existing, record);
  var previousStatus = existing.status || complete.status || '';
  complete.history = (existing.history || complete.history || []).slice(-19);
  complete.history.push({ status: previousStatus, transitionedTo: status, at: new Date().toISOString(),
    reused: !!complete.reused, message: message ? String(message).slice(0, 500) : '' });
  complete.previousStatus = previousStatus;
  complete.status = status;
  complete.updatedAt = new Date().toISOString();
  if (status === 'COMPLETED') complete.completedAt = complete.updatedAt;
  if (message) complete.message = String(message).slice(0, 500);
  PropertiesService.getScriptProperties().setProperty('snapshot_backup_last_status', JSON.stringify(complete));
  _registerSystemBackup(complete);
}

function _snapshotComparableSignature(row) {
  row = row || [];
  var code = _cleanCode(row[1]) || String(row[2] || '').trim();
  return JSON.stringify([_normalizeDate(row[0]), code, String(row[2] || '').trim(),
    Number(row[3]) || 0, Number(row[4]) || 0, Number(row[5]) || 0, Number(row[6]) || 0,
    Number(row[7]) || 0, Number(row[8]) || 0, Number(row[9]) || 0, String(row[10] || '').trim().toUpperCase()]);
}

function _snapshotDateNeedsRewrite(ss, date, expectedRows) {
  return _snapshotRewritePlan(ss, date, expectedRows).needsRewrite;
}

function _snapshotRewritePlan(ss, date, expectedRows, lifecycleConfigs) {
  var raw = _readRawSnapshotRowsByDate(ss, date);
  var originalRawCount = raw.length;
  expectedRows = (expectedRows || []).slice();
  var hasFundRows = raw.concat(expectedRows).some(function(row) {
    return _isFundCode(_cleanCode(row && row[1]) || String(row && row[1] || '').trim().toUpperCase());
  });
  if (hasFundRows) {
    var configs = Array.isArray(lifecycleConfigs) ? lifecycleConfigs : _readFundUnits(ss);
    raw = _filterSnapshotRowsByFundLifecycle(raw, configs, date);
    expectedRows = _filterSnapshotRowsByFundLifecycle(expectedRows, configs, date);
  }
  var lifecycleRemovedRows = originalRawCount - raw.length;
  var duplicateGroups = _classifyRawSnapshotDuplicateGroups(date, raw, expectedRows, '');
  var unsafe = duplicateGroups.filter(function(item) { return !item.autoResolvable; });
  return { raw: raw, duplicateGroups: duplicateGroups, unsafe: unsafe, lifecycleRemovedRows: lifecycleRemovedRows,
    needsRewrite: unsafe.length === 0 && (lifecycleRemovedRows > 0 ||
      duplicateGroups.some(function(item) { return item.autoResolvable; }) ||
      _snapshotRowsSignature(_dedupeSnapshotRows(raw)) !== _snapshotRowsSignature(expectedRows)) };
}

// raw 원장의 동일 date+canonical code/name 그룹을 cleanup과 full repair가 함께 판정합니다.
function _classifyRawSnapshotDuplicateGroups(dateStr, rawRows, expectedRows, sourceIncompleteReason) {
  var date = _normalizeDate(dateStr || ''), groups = {}, expectedByKey = {};
  (expectedRows || []).forEach(function(row) { expectedByKey[_snapshotIntegrityKey(row)] = row; });
  (rawRows || []).forEach(function(row) {
    var key = _snapshotIntegrityKey(row);
    if (!key) return;
    (groups[key] || (groups[key] = [])).push(row);
  });
  return Object.keys(groups).sort().filter(function(key) { return groups[key].length > 1; }).map(function(key) {
    var rows = groups[key], uniqueBySignature = {};
    rows.forEach(function(row) { uniqueBySignature[_snapshotComparableSignature(row)] = row; });
    var uniqueRows = Object.keys(uniqueBySignature).map(function(signature) { return uniqueBySignature[signature]; });
    var manualCount = rows.filter(function(row) { return String(row[10] || '').toUpperCase() === 'MANUAL'; }).length;
    var expected = expectedByKey[key], expectedMatchCount = expected ? uniqueRows.filter(function(row) {
      return _snapshotComparableSignature(row) === _snapshotComparableSignature(expected);
    }).length : 0;
    var classification = 'UNRESOLVED_CONFLICT', reason = 'expected와 일치하는 row를 하나로 확정할 수 없음';
    if (sourceIncompleteReason) { classification = 'SOURCE_INCOMPLETE'; reason = sourceIncompleteReason; }
    else if (uniqueRows.length === 1) { classification = 'EXACT_DUPLICATE'; reason = '동일 row 중복'; }
    else if (manualCount) { classification = 'MANUAL_PROTECTED'; reason = 'MANUAL 행 보호'; }
    else if (expectedMatchCount === 1) { classification = 'SINGLE_EXPECTED_MATCH'; reason = 'expected와 유일하게 일치'; }
    return { date: date, key: key, code: key, rawRowCount: rows.length, uniqueRowCount: uniqueRows.length,
      classification: classification, expectedMatchCount: expectedMatchCount, manualCount: manualCount,
      autoResolvable: classification === 'EXACT_DUPLICATE' || classification === 'SINGLE_EXPECTED_MATCH',
      reason: reason, rows: rows, keepRow: classification === 'EXACT_DUPLICATE' ? uniqueRows[0] :
        (classification === 'SINGLE_EXPECTED_MATCH' ? uniqueRows.filter(function(row) { return _snapshotComparableSignature(row) === _snapshotComparableSignature(expected); })[0] : null) };
  });
}

function _dedupeSnapshotRows(rows) {
  var seen = {};
  var out = [];
  (rows || []).forEach(function(r) {
    if (!Array.isArray(r)) return;
    var date = _normalizeDate(r[0]);
    if (!date) return;
    var code = _cleanCode(r[1]) || (r[2] || '').toString().trim();
    var key = date + '|' + code;
    if (seen[key]) return;
    seen[key] = true;
    // ★ [버그수정] 12컬럼 유지 — 기존 slice(0,11)은 savedAt(12번째)을 잘라버려
    //   writeSnapshotRows의 colSize=12와 불일치 발생
    var row = r.slice(0, 12);
    // 12번째 컬럼(savedAt)이 없는 구형 데이터는 빈 문자열로 채움
    while (row.length < 12) row.push('');
    row[0] = date;
    out.push(row);
  });
  return out;
}


function cleanupPriceHistoryDuplicates() {
  var lock = LockService.getScriptLock(), ownsLock = false;
  try { if (!lock.hasLock()) { lock.waitLock(30000); ownsLock = true; } return _cleanupPriceHistoryDuplicatesLocked(); }
  finally { if (ownsLock) lock.releaseLock(); }
}

function _cleanupPriceHistoryDuplicatesLocked() {
  var ss = getss();
  var ph = ss.getSheetByName(CONFIG.SHEET_PH);
  if (!ph || ph.getLastRow() < 2) {
    try { SpreadsheetApp.getUi().alert('가격이력 데이터가 없습니다.'); } catch(e) { Logger.log('가격이력 데이터가 없습니다.'); }
    return;
  }

  var colSize = Math.max(6, ph.getLastColumn());
  var header = [['날짜','종목코드','종목명','가격','입력일시','가격소스']];
  var rows = ph.getRange(2, 1, ph.getLastRow() - 1, colSize).getValues();

  var bestByKey = {};
  rows.forEach(function(r, idx) {
    var date = _normalizeDate(r[0]);
    if (!date) return;
    var code = _cleanCode(r[1]) || '';
    var name = (r[2] || '').toString().trim();
    var keyId = code || name;
    if (!keyId) return;
    var key = date + '|' + keyId;

    var savedAt = _normalizeDatetime(r[4]);
    var src = (r[5] || '').toString().trim().toUpperCase();
    var isManual = (src === 'MANUAL') || !!savedAt;

    var rowOut = [date, code, name, Number(r[3] || 0), savedAt || '', (r[5] || '')];
    var cand = { row: rowOut, idx: idx, isManual: isManual, savedAt: savedAt };
    var prev = bestByKey[key];
    if (!prev) { bestByKey[key] = cand; return; }

    // 우선순위: MANUAL > savedAt 최신 > 뒤에 나온 행
    if (cand.isManual && !prev.isManual) { bestByKey[key] = cand; return; }
    if (!cand.isManual && prev.isManual) return;
    if (cand.savedAt && prev.savedAt && cand.savedAt > prev.savedAt) { bestByKey[key] = cand; return; }
    if (!prev.savedAt && cand.savedAt) { bestByKey[key] = cand; return; }
    if (cand.idx > prev.idx) bestByKey[key] = cand;
  });

  var deduped = Object.keys(bestByKey)
    .map(function(k){ return bestByKey[k]; })
    .sort(function(a,b){
      var d = (a.row[0] || '').localeCompare(b.row[0] || '');
      if (d !== 0) return d;
      var ca = _cleanCode(a.row[1]) || (a.row[2] || '');
      var cb = _cleanCode(b.row[1]) || (b.row[2] || '');
      return String(ca).localeCompare(String(cb));
    })
    .map(function(v){ return v.row; });

  var removed = rows.length - deduped.length;
  if (removed <= 0) {
    try { SpreadsheetApp.getUi().alert('가격이력 중복이 없습니다.'); } catch(e) { Logger.log('가격이력 중복이 없습니다.'); }
    return;
  }

  var backup = _backupSheetBeforeWrite(ss, ph, CONFIG.SHEET_PH);
  try {
    ph.clearContents();
    _setCodeColumnText(ph, 2);
    ph.getRange(1, 1, 1, 6).setValues(header);
    ph.getRange(1, 1, 1, 6).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
    if (deduped.length > 0) ph.getRange(2, 1, deduped.length, 6).setValues(_normalizeCodeRows(deduped, 1));
    SpreadsheetApp.flush();
    var verifiedRows = ph.getLastRow() > 1 ? ph.getRange(2, 1, ph.getLastRow() - 1, 6).getValues() : [];
    var priceSignature = function(row) { return JSON.stringify([_normalizeDate(row[0]), _cleanCode(row[1]) || String(row[2] || '').trim(), String(row[2] || '').trim(), Number(row[3]) || 0, _normalizeDatetime(row[4]) || '', String(row[5] || '').trim().toUpperCase()]); };
    if (verifiedRows.length !== deduped.length || verifiedRows.map(priceSignature).sort().join('\n') !== deduped.map(priceSignature).sort().join('\n')) throw new Error('가격이력 중복 정리 후 전체 read-back 검증 실패');
    var verifiedKeys = {};
    verifiedRows.forEach(function(row) {
      var date = _normalizeDate(row[0]), code = _cleanCode(row[1]) || String(row[2] || '').trim(), key = date + '|' + code;
      if (date && code && verifiedKeys[key]) throw new Error('가격이력 중복 정리 후 검증 실패: ' + key);
      if (date && code) verifiedKeys[key] = true;
    });
    _touchSnapshotIntegritySourceRevision({ all: true });
    _markSnapshotBackupStatus(backup, 'COMPLETED');
    _cleanupCurrentSystemBackup(ss, backup);
  } catch (error) { _markSnapshotBackupStatus(backup, 'WRITE_FAILED', error.message); throw error; }
  try { SpreadsheetApp.getUi().alert('가격이력 중복 정리 완료: ' + removed + '행 삭제'); } catch(e) { Logger.log('가격이력 중복 정리 완료: ' + removed + '행 삭제'); }
}

function cleanupSnapshotDuplicates() {
  var lock = LockService.getScriptLock(), ownsLock = false;
  try { if (!lock.hasLock()) { lock.waitLock(30000); ownsLock = true; } return _cleanupSnapshotDuplicatesLocked(); }
  finally { if (ownsLock) lock.releaseLock(); }
}

function _cleanupSnapshotDuplicatesLocked() {
  var ss = getss(), sh = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
  var alertResult = function(message) { try { SpreadsheetApp.getUi().alert(message); } catch (ignore) { Logger.log(message); } };
  if (!sh || sh.getLastRow() < 2) {
    alertResult('스냅샷 데이터가 없습니다.');
    return { removedRows: 0, invalidDateRowsRemoved: 0, zeroUnitFundRowsRemoved: 0, duplicateRowsRemoved: 0 };
  }

  var colSize = 12;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(colSize, sh.getLastColumn())).getValues();
  var fundConfigs = _readFundUnits(ss);
  var rowsByDate = {}, duplicateDates = {}, keyCounts = {}, decisions = [], expectedByDate = {}, sourceErrorByDate = {};
  var invalidDateRows = 0, zeroUnitFundRows = 0;

  var rowHasPayload = function(row) {
    return (row || []).slice(0, colSize).some(function(value) { return value !== '' && value != null; });
  };
  var isZeroUnitFundRow = function(row) {
    var date = _normalizeDate(row && row[0]);
    var code = _cleanCode(row && row[1]) || String(row && row[1] || '').trim().toUpperCase();
    if (!date || !_isFundCode(code)) return false;
    var config = _fundUnitsAtDate(fundConfigs, code, date);
    return !!(config && config.units === 0);
  };

  rows.forEach(function(row) {
    var date = _normalizeDate(row[0]), key = _snapshotIntegrityKey(row);
    if (!date) {
      if (rowHasPayload(row)) invalidDateRows++;
      return;
    }
    if (isZeroUnitFundRow(row)) {
      zeroUnitFundRows++;
      return;
    }
    if (!key) return;
    (rowsByDate[date] || (rowsByDate[date] = [])).push(row);
    var groupKey = date + '|' + key;
    keyCounts[groupKey] = Number(keyCounts[groupKey] || 0) + 1;
    if (keyCounts[groupKey] > 1) duplicateDates[date] = true;
  });

  Object.keys(duplicateDates).sort().forEach(function(date) {
    var raw = rowsByDate[date], expected = [], error = '';
    try { expected = _buildSnapshotRowsFromTradeAndPriceHistory(ss, date, true); }
    catch (sourceError) { error = '원자료 계산 불가: ' + (sourceError.message || sourceError); }
    expectedByDate[date] = expected;
    sourceErrorByDate[date] = error;
    decisions = decisions.concat(_classifyRawSnapshotDuplicateGroups(date, raw, expected, error));
  });

  var replacementByKey = {}, duplicateRowsRemoved = 0, affectedDates = {};
  decisions.filter(function(item) { return item.autoResolvable; }).forEach(function(item) {
    replacementByKey[item.date + '|' + item.key] = item.keepRow;
    duplicateRowsRemoved += item.rawRowCount - 1;
    affectedDates[item.date] = true;
  });

  var emitted = {}, outputRows = [];
  rows.forEach(function(row) {
    var date = _normalizeDate(row[0]);
    if (!date) return;
    if (isZeroUnitFundRow(row)) {
      affectedDates[date] = true;
      return;
    }
    var key = _snapshotIntegrityKey(row), groupKey = date + '|' + key;
    if (!replacementByKey[groupKey]) {
      outputRows.push(row.slice(0, colSize));
      return;
    }
    if (!emitted[groupKey]) {
      outputRows.push(replacementByKey[groupKey]);
      emitted[groupKey] = true;
    }
  });

  var removedRows = invalidDateRows + zeroUnitFundRows + duplicateRowsRemoved;
  var counts = function(classification) { return decisions.filter(function(item) { return item.classification === classification; }).length; };
  var unresolvedDates = {}, beforeConflictDates = {};
  decisions.forEach(function(item) {
    beforeConflictDates[item.date] = true;
    if (!item.autoResolvable) unresolvedDates[item.date] = true;
  });

  var actualByDate = {};
  if (removedRows) {
    var backup = _backupSnapshotBeforeWrite(ss, sh);
    try {
      var header = [['날짜','종목코드','종목명','수량','매수단가','매수원금','평가단가','평가금액','손익','수익률(%)','평가단가소스','저장일시']];
      var output = header.concat(outputRows);
      while (output.length < sh.getLastRow()) output.push(Array(colSize).fill(''));
      sh.getRange(1, 1, output.length, colSize).setValues(output);
      SpreadsheetApp.flush();

      var actualAll = sh.getLastRow() > 1
        ? sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(colSize, sh.getLastColumn())).getValues()
        : [];
      var remainingInvalid = actualAll.filter(function(row) { return !_normalizeDate(row[0]) && rowHasPayload(row); });
      var remainingZeroUnit = actualAll.filter(isZeroUnitFundRow);
      if (remainingInvalid.length || remainingZeroUnit.length) {
        throw new Error('Snapshot 정리 후 검증 실패: 날짜유실=' + remainingInvalid.length + ', 0좌펀드=' + remainingZeroUnit.length);
      }

      var isValidSnapshotRow = function(row) { return !!_normalizeDate(row[0]) && !!_snapshotIntegrityKey(row); };
      var intendedRows = outputRows.filter(isValidSnapshotRow);
      var actualRows = actualAll.filter(isValidSnapshotRow);
      var intendedSignature = intendedRows.map(_snapshotComparableSignature).sort().join('\n');
      var actualSignature = actualRows.map(_snapshotComparableSignature).sort().join('\n');
      if (actualRows.length !== intendedRows.length || actualSignature !== intendedSignature) {
        throw new Error('Snapshot 전체 정리 후 read-back 검증 실패');
      }

      actualRows.forEach(function(row) {
        var date = _normalizeDate(row[0]);
        if (date) (actualByDate[date] || (actualByDate[date] = [])).push(row);
      });
      Object.keys(affectedDates).forEach(function(date) {
        var remaining = _classifyRawSnapshotDuplicateGroups(date, actualByDate[date] || [], expectedByDate[date] || [], sourceErrorByDate[date] || '');
        var targetKeys = {};
        decisions.filter(function(item) { return item.date === date && item.autoResolvable; }).forEach(function(item) { targetKeys[item.key] = true; });
        var failed = remaining.filter(function(item) { return targetKeys[item.key]; });
        if (failed.length) throw new Error('Snapshot 중복 정리 후 raw 검증 실패: ' + failed.map(function(item) { return item.key; }).join(', '));
      });

      var revisionImpact = Object.keys(affectedDates).length ? { dates: Object.keys(affectedDates) } : { all: true };
      _touchSnapshotIntegritySourceRevision(revisionImpact);
      _markSnapshotBackupStatus(backup, 'COMPLETED');
      _cleanupCurrentSystemBackup(ss, backup);
    } catch (error) {
      _markSnapshotBackupStatus(backup, 'WRITE_FAILED', error.message);
      throw error;
    }
  }

  var afterConflictDates = {};
  var verifyDates = {};
  Object.keys(affectedDates).concat(Object.keys(unresolvedDates)).forEach(function(date) { verifyDates[date] = true; });
  Object.keys(verifyDates).forEach(function(date) {
    var sourceRows = removedRows ? (actualByDate[date] || []) : (rowsByDate[date] || []);
    if (_classifyRawSnapshotDuplicateGroups(date, sourceRows, expectedByDate[date] || [], sourceErrorByDate[date] || '').some(function(item) {
      return item.uniqueRowCount > 1;
    })) afterConflictDates[date] = true;
  });

  var result = {
    duplicateGroups: decisions.length,
    exactDuplicateGroups: counts('EXACT_DUPLICATE'),
    singleExpectedMatchGroups: counts('SINGLE_EXPECTED_MATCH'),
    manualProtectedGroups: counts('MANUAL_PROTECTED'),
    unresolvedConflictGroups: counts('UNRESOLVED_CONFLICT'),
    sourceIncompleteGroups: counts('SOURCE_INCOMPLETE'),
    invalidDateRowsRemoved: invalidDateRows,
    zeroUnitFundRowsRemoved: zeroUnitFundRows,
    duplicateRowsRemoved: duplicateRowsRemoved,
    removedRows: removedRows,
    affectedDates: Object.keys(affectedDates).sort(),
    unresolvedDates: Object.keys(unresolvedDates).sort(),
    beforeConflictDates: Object.keys(beforeConflictDates).sort(),
    afterConflictDates: Object.keys(afterConflictDates).sort(),
    groups: decisions
  };
  alertResult('스냅샷 정리 완료: ' + removedRows + '행 삭제'
    + '\n- 날짜 유실: ' + invalidDateRows
    + '\n- 0좌 펀드 잔존: ' + zeroUnitFundRows
    + '\n- 중복 자동해결: ' + duplicateRowsRemoved
    + '\n- 미해결 보호: ' + result.unresolvedDates.length + '일');
  return result;
}

// ════════════════════════════════════════════════════════════════════
//  종목코드 정제
// ════════════════════════════════════════════════════════════════════
function _codeColumnForSheet(sheetName) {
  if ([CONFIG.SHEET_CODES, CONFIG.SHEET_HOLD].indexOf(sheetName) !== -1) return 1;
  if ([CONFIG.SHEET_TRADES].indexOf(sheetName) !== -1) return 5;
  if ([CONFIG.SHEET_PH, CONFIG.SHEET_SNAPSHOT, FUND_NAV_SHEET, FUND_UNITS_SHEET].indexOf(sheetName) !== -1) return 2;
  return 0;
}

function _setCodeColumnText(sheet, column) {
  if (!sheet || !column || typeof sheet.getRange !== 'function') return;
  var range = sheet.getRange(1, column, Math.max(1, sheet.getMaxRows()), 1);
  if (range && typeof range.setNumberFormat === 'function') range.setNumberFormat('@');
}

function _normalizeCodeRows(rows, codeIndex) {
  return (rows || []).map(function(row) {
    var output = row.slice();
    if (output[codeIndex] !== '' && output[codeIndex] != null) output[codeIndex] = _cleanCode(output[codeIndex]);
    return output;
  });
}

function _cleanCode(raw) {
  var s = (raw || '').toString().trim().toUpperCase();
  if (!s) return '';

  // 숫자 국내 코드는 6자리 0패딩을 유지합니다.
  if (/^\d+$/.test(s)) {
    while (s.length < 6) s = '0' + s;
    return s;
  }

  // 영숫자 혼합 코드와 유효한 해외 ticker 구분자(. / -)를 보존합니다.
  // 구분자를 제거해 BRK.B와 BRK-B를 같은 내부 키로 합치지 않습니다.
  if (/^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(s) && s.length <= 30 && /[A-Z]/.test(s)) return s;
  return '';
}

// 과거 버전 호환: 영문 제거 후 숫자만 6자리로 저장되던 키 복원용
function _legacyDigitsCode(raw) {
  var s = (raw || '').toString().trim();
  if (!s) return '';

  // 허용 문자만 남김 (숫자/영문)
  var alnum = s.replace(/[^A-Z0-9]/g, '');
  if (!alnum) return '';

  // 숫자 코드: 기존 동작 유지(6자리 0패딩)
  if (/^\d+$/.test(alnum)) {
    while (alnum.length < 6) alnum = '0' + alnum;
    return alnum;
  }

  // 영문+숫자 혼합 코드(예: 0046Y0, F00001): 6자리 유효코드만 허용
  if (/^[A-Z0-9]{6}$/.test(alnum)) return alnum;
  return '';
}

function _buildCodeAliasMap(codes) {
  var map = {};
  (codes || []).forEach(function(rawCode) {
    var canonical = _cleanCode(rawCode) || (rawCode || '').toString().trim();
    if (!canonical) return;
    map[canonical] = canonical;
    var legacy = _legacyDigitsCode(rawCode);
    if (legacy && legacy !== canonical) map[legacy] = canonical;
  });
  return map;
}

function _pad(n) { return n < 10 ? '0' + n : '' + n; }

// ════════════════════════════════════════════════════════════════════
//  종목코드 목록 로드
// ════════════════════════════════════════════════════════════════════
function getCodeItems(ss, throwOnError) {
  try {
    var cs = ss.getSheetByName(CONFIG.SHEET_CODES);
    if (!cs || cs.getLastRow() < 2) return [];
    var numCols = Math.max(cs.getLastColumn(), 6);
    return cs.getRange(2, 1, cs.getLastRow() - 1, numCols).getValues()
      .map(function(row) {
        return {
          code: _cleanCode(row[0]),
          name: (row[1]||'').toString().trim(),
          type: (row[2]||'주식').toString().trim(),
          // 빈 구버전 섹터를 '기타'로 강제하면 Settings의 정상 섹터를 덮을 수 있으므로 원문 유지
          sector: (row[3]||'').toString().trim(),
          currency: (row[4]||'KRW').toString().trim().toUpperCase() || 'KRW',
          market: (row[5]||'').toString().trim().toUpperCase(),
        };
      })
      .filter(function(item){ return item.code && item.code !== '000000'; });
  } catch(err) {
    Logger.log('❌ getCodeItems 실패: ' + err.message);
    if (throwOnError) throw err;
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════
//  종목코드 목록 반환
// ════════════════════════════════════════════════════════════════════
function handleGetCodeList() {
  try {
    return jsonOk({ codes: getCodeItems(getss()) });
  } catch(err) {
    return jsonError('getCodeList 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  거래이력 / 보유현황 읽기
// ════════════════════════════════════════════════════════════════════
function handleGetTrades(existingSs) {
  try {
    var ss = existingSs || getss();
    var sh = ss.getSheetByName(CONFIG.SHEET_TRADES);
    if (!sh || sh.getLastRow() < 2) return jsonOk({ trades: [] });
    var numCols = sh.getLastColumn();
    var data    = sh.getRange(2, 1, sh.getLastRow() - 1, numCols).getValues();
    var trades  = data
      .filter(function(r){ return r[0] || r[3]; })
      .map(function(r) {
        var assetType = (r[7] || '주식').toString();
        return {
          date:      (r[0] instanceof Date)
                       ? Utilities.formatDate(r[0], CONFIG.TIMEZONE, 'yyyy-MM-dd')
                       : (r[0] || '').toString().trim().slice(0, 10),
          tradeType: (r[1] || '').toString(),
          acct:      (r[2] || '').toString(),
          name:      (r[3] || '').toString(),
          code:      (r[4] || '').toString(),
          qty:       parseFloat(r[5]) || 0,
          price:     parseFloat(r[6]) || 0,
          assetType: assetType,
          memo:      (r[8] || '').toString(),
          ratio:     parseFloat(r[9]) || 0,
          fractionalCash: parseFloat(r[10]) || 0,
          // ★ [버그수정] fund 필드: 거래이력 시트는 9컬럼(날짜~메모)까지만 저장
          //   r[9]는 항상 undefined → fund 항상 false 버그 수정
          //   assetType으로 펀드/TDF 여부를 추론하도록 변경
          fund:      (assetType === '펀드' || assetType === 'TDF'),
        };
      });
    return jsonOk({ trades: trades });
  } catch(err) {
    return jsonError('getTrades 실패: ' + err.message);
  }
}

function handleGetHoldings(existingSs) {
  try {
    var ss      = existingSs || getss();
    var sh      = ss.getSheetByName(CONFIG.SHEET_HOLD);
    if (!sh || sh.getLastRow() < 2) return jsonOk({ holdings: [] });
    var numCols  = Math.max(sh.getLastColumn(), 6);
    var data     = sh.getRange(2, 1, sh.getLastRow() - 1, numCols).getValues();
    var holdings = data
      .filter(function(r){ return r[1]; })
      .map(function(r) {
        var isNewFormat = r.length >= 7;
        return {
          code:      (r[0] || '').toString(),
          name:      (r[1] || '').toString(),
          qty:       parseFloat(r[2]) || 0,
          costAmt:   parseFloat(isNewFormat ? r[4] : r[3]) || 0,
          assetType: (isNewFormat ? r[5] : r[4] || '주식').toString(),
          acct:      (isNewFormat ? r[6] : r[5] || '').toString(),
        };
      });
    return jsonOk({ holdings: holdings });
  } catch(err) {
    return jsonError('getHoldings 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  설정 저장 / 불러오기
// ════════════════════════════════════════════════════════════════════
// ★ _parseArrayParam: JSON 파싱 후 배열인지 검증
function _parseJsonParam(dataJson, label) {
  var parsed;
  try { parsed = JSON.parse(decodeURIComponent(dataJson)); } catch(e) {
    try { parsed = JSON.parse(dataJson); } catch(e2) { throw new Error(label + ' 파싱 실패'); }
  }
  if (!parsed || Object.prototype.toString.call(parsed) !== '[object Object]') throw new Error(label + ' 객체 형식 필요');
  return parsed;
}

function _parseArrayParam(dataJson, label) {
  var parsed;
  try { parsed = JSON.parse(decodeURIComponent(dataJson)); } catch(e) {
    try { parsed = JSON.parse(dataJson); } catch(e2) { throw new Error(label + ' 파싱 실패'); }
  }
  if (!Array.isArray(parsed)) throw new Error(label + ' 배열 형식 필요');
  return parsed;
}

function _readSettingsMap(existingSs) {
  var ss = existingSs || getss();
  var sh = ss.getSheetByName(CONFIG.SHEET_SETTINGS);
  if (!sh || sh.getLastRow() < 2) return {};

  var data = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  var settings = {};
  data.forEach(function(row) {
    var key = (row[0] || '').toString().trim();
    var val = (row[1] || '').toString().trim();
    if (!key || !val) return;
    try { settings[key] = JSON.parse(val); } catch(e) { settings[key] = val; }
  });
  return settings;
}

function _writeSettingsMap(settings) {
  if (typeof settings !== 'object' || settings === null) throw new Error('객체 형식 필요');

  var ss = getss();
  var sh = ss.getSheetByName(CONFIG.SHEET_SETTINGS);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEET_SETTINGS);
    sh.getRange(1,1,1,2).setValues([['키','값']]);
    sh.getRange(1,1,1,2).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
    sh.setColumnWidth(1, 180); sh.setColumnWidth(2, 600);
  }

  var keyOrder = [];
  var lastRow  = sh.getLastRow();
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function(r) {
      var k = (r[0] || '').toString().trim();
      if (k) keyOrder.push(k);
    });
  }
  Object.keys(settings).forEach(function(k) {
    if (keyOrder.indexOf(k) === -1) keyOrder.push(k);
  });

  var rows = keyOrder
    .filter(function(k) { return k in settings; })
    .map(function(k) { return [k, JSON.stringify(settings[k])]; });

  // 데이터 행 자체를 모두 삭제하면 헤더만 고정된 시트에서
  // "고정되지 않은 행을 모두 삭제할 수 없습니다" 오류가 발생합니다.
  // 행은 유지하고 기존 내용만 비운 뒤 한 번에 다시 기록합니다.
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, Math.max(2, sh.getLastColumn())).clearContent();
  }
  if (rows.length > 0) {
    var requiredRows = rows.length + 1;
    if (sh.getMaxRows() < requiredRows) {
      sh.insertRowsAfter(sh.getMaxRows(), requiredRows - sh.getMaxRows());
    }
    sh.getRange(2, 1, rows.length, 2).setValues(rows);
  }
  SpreadsheetApp.flush();
  return rows.length;
}

// 스프레드시트 소유자가 Apps Script 편집기에서 명시적으로 한 번 실행합니다.
// 설정 시트의 레거시 키를 Script Properties로 옮긴 뒤 설정 시트 원문을 제거합니다.
function migrateLegacyApiKeysToScriptProperties() {
  var settings = _readSettingsMap();
  var props = PropertiesService.getScriptProperties();
  var publicKey = String(settings.public_data_api_key || settings.public_listed_api_key || settings.public_dividend_api_key || '').trim();
  var krxKey = String(settings.krx_auth_key || settings.krx_api_key || '').trim();
  if (publicKey && !_getPublicDataApiKey()) props.setProperty('public_data_api_key', publicKey);
  if (krxKey && !_getKrxAuthKey()) props.setProperty('krx_auth_key', krxKey);
  _removeSecretsFromSettings(settings);
  _writeSettingsMap(settings);
  return { publicDataApiKeyMigrated: !!publicKey, krxAuthKeyMigrated: !!krxKey };
}

function migrateLegacyApiKeysPrompt() {
  var ui = SpreadsheetApp.getUi();
  if (!_confirmPortfolioMenuAction('레거시 API 키 안전 이전', '설정 시트의 기존 API 키를 Script Properties로 이전하고 설정 시트의 키 원문을 제거합니다. 레거시 키가 남아 있는 경우에만 실행하세요.')) return;
  var result = migrateLegacyApiKeysToScriptProperties();
  ui.alert(
    '레거시 API 키 마이그레이션 완료\n\n' +
    '공공데이터 키: ' + (result.publicDataApiKeyMigrated ? '이전 또는 기존 서버 키 유지' : '설정 시트 원문 없음') + '\n' +
    'KRX 키: ' + (result.krxAuthKeyMigrated ? '이전 또는 기존 서버 키 유지' : '설정 시트 원문 없음') + '\n\n' +
    '설정 시트의 키 원문 필드는 제거했습니다.'
  );
}

// 상환스케줄의 현재월 행을 기준으로 주담대 상태를 자동 갱신합니다.
// 매일 실행하지만 값이 달라질 때만 설정 시트를 다시 씁니다.
function syncMortgageFromSchedule() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var settings = _readSettingsMap();
    var loan = settings.LOAN;
    var schedule = settings.LOAN_SCHEDULE;
    if (!loan || typeof loan !== 'object' || !Array.isArray(schedule) || schedule.length === 0) {
      return { updated: false, reason: '상환스케줄 없음' };
    }
    var month = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM');
    var valid = schedule.filter(function(row) {
      return row && /^\d{4}-\d{2}$/.test(String(row.date || '').slice(0, 7));
    }).sort(function(a, b) { return String(a.date).localeCompare(String(b.date)); });
    var current = null;
    valid.forEach(function(row) {
      var rowMonth = String(row.date).slice(0, 7);
      if (rowMonth <= month) current = row;
    });
    if (!current) return { updated: false, reason: '현재월 이전 스케줄 없음' };

    // 현재월 행의 납입 후 잔액·이자를 반영하므로 다음 달 이후만 잔여 개월이다.
    var remaining = valid.filter(function(row) { return String(row.date).slice(0, 7) > month; }).length;
    var interestPaid = valid.filter(function(row) { return String(row.date).slice(0, 7) <= month; })
      .reduce(function(sum, row) { return sum + (Number(row.interest) || 0); }, 0);
    var nextBalance = Number(current.balance) || 0;
    var nextInterest = Number(current.interest) || 0;
    var changed = Number(loan.balance || 0) !== nextBalance
      || Number(loan.monthlyInterestPaid || 0) !== nextInterest
      || Number(loan.totalMonths || 0) !== valid.length
      || Number(loan.remainingMonths || 0) !== remaining
      || Number(loan.totalInterestPaid || 0) !== interestPaid;
    if (!changed) return { updated: false, month: month, balance: nextBalance };

    loan.balance = nextBalance;
    loan.monthlyInterestPaid = nextInterest;
    loan.totalMonths = valid.length;
    loan.remainingMonths = remaining;
    loan.totalInterestPaid = interestPaid;
    loan.scheduleUpdatedMonth = month;
    settings.LOAN = loan;
    _writeSettingsMap(settings);
    Logger.log('[syncMortgageFromSchedule] ' + month + ' 잔액 ' + nextBalance + '원으로 갱신');
    return { updated: true, month: month, balance: nextBalance };
  } finally {
    lock.releaseLock();
  }
}
function handleSaveSettings(dataJson) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    lock.waitLock(30000); locked = true;
    var incoming = _parseJsonParam(dataJson, 'settings');
    delete incoming.public_data_api_key;
    delete incoming.krx_auth_key;
    delete incoming.krx_api_key;
    var settings = _readSettingsMap();
    var protectedKeys = ['DIVDATA', 'LOAN', 'REAL_ESTATE', 'LOAN_SCHEDULE', 'RE_VALUE_HIST'];
    var protectedValues = {};
    protectedKeys.forEach(function(key) {
      if (Object.prototype.hasOwnProperty.call(settings, key)) protectedValues[key] = settings[key];
    });
    Object.keys(incoming).forEach(function(key) { settings[key] = incoming[key]; });
    // 전용 저장 API·자동 트리거가 관리하는 기존 값은 일반 설정 저장보다 우선합니다.
    Object.keys(protectedValues).forEach(function(key) { settings[key] = protectedValues[key]; });
    var saved = _writeSettingsMap(settings);
    return jsonOk({ saved: saved });
  } catch(err) {
    return jsonError('saveSettings 실패: ' + err.message);
  } finally {
    if (locked) lock.releaseLock();
  }
}

function handleGetSettings() {
  try {
    var settings = _readSettingsMap();
    _removeSecretsFromSettings(settings);
    settings.apiKeyStatus = _getApiKeyStatus();
    return jsonOk({ settings: settings, gasVersion: '9.180' });
  } catch(err) {
    return jsonError('getSettings 실패: ' + err.message);
  }
}

// 앱 시작에 필요한 읽기 전용 데이터를 한 번에 반환합니다. 각 데이터를 별도 웹앱
// 실행으로 요청할 때 발생하는 왕복 지연과 설정 시트의 반복 읽기를 줄입니다.
function handleGetBootstrap() {
  try {
    var ss = getss();
    var settings = _readSettingsMap(ss);
    _removeSecretsFromSettings(settings);
    settings.apiKeyStatus = _getApiKeyStatus();

    var tradesResponse = JSON.parse(handleGetTrades(ss).getContent());
    var holdingsResponse = JSON.parse(handleGetHoldings(ss).getContent());
    return jsonOk({
      settings: settings,
      trades: tradesResponse.status === 'ok' ? tradesResponse.trades : [],
      holdings: holdingsResponse.status === 'ok' ? holdingsResponse.holdings : [],
      codes: getCodeItems(ss),
      gasVersion: '9.180'
    });
  } catch(err) {
    return jsonError('getBootstrap 실패: ' + err.message);
  }
}

function _preserveSeibroDivData(existingDivData, incomingDivData) {
  var merged = incomingDivData;
  Object.keys(existingDivData || {}).forEach(function(key) {
    var existing = existingDivData[key];
    var incoming = merged[key];
    if (!existing || String(existing.source || '').toUpperCase() !== 'SEIBRO') return;
    var incomingSource = String(incoming && incoming.source || '').toUpperCase();
    // 명시적인 SEIBro 갱신이나 사용자의 MANUAL 편집만 기존 SEIBro 값을 교체할 수 있습니다.
    if (incomingSource !== 'SEIBRO' && incomingSource !== 'MANUAL') merged[key] = existing;
  });
  return merged;
}

function handleSaveDividendSettings(dataJson) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    lock.waitLock(30000); locked = true;
    var divData = _parseJsonParam(dataJson, 'dividend data');
    var settings = _readSettingsMap();
    var existingDivData = (settings.DIVDATA && typeof settings.DIVDATA === 'object') ? settings.DIVDATA : {};
    // SEIBro 운영 반영 이후에도 구버전 웹이 탭 진입 자동조회 결과(PUBLIC_DATA/GF)를
    // 다시 저장할 수 있으므로 서버에서도 기존 SEIBro 값을 보호합니다.
    settings.DIVDATA = _preserveSeibroDivData(existingDivData, divData);
    _writeSettingsMap(settings);
    return jsonOk({ saved: true, key: 'DIVDATA' });
  } catch(err) {
    return jsonError('saveDividendSettings 실패: ' + err.message);
  } finally {
    if (locked) lock.releaseLock();
  }
}

function handleGetDividendSettings() {
  try {
    var settings = _readSettingsMap();
    return jsonOk({ divData: (settings.DIVDATA && typeof settings.DIVDATA === 'object') ? settings.DIVDATA : {} });
  } catch(err) {
    return jsonError('getDividendSettings 실패: ' + err.message);
  }
}

function handleSaveRealEstateSettings(dataJson) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    lock.waitLock(30000); locked = true;
    var payload = _parseJsonParam(dataJson, 'realEstate data');
    var settings = _readSettingsMap();
    settings.LOAN = payload.LOAN || {};
    settings.REAL_ESTATE = payload.REAL_ESTATE || {};
    settings.LOAN_SCHEDULE = Array.isArray(payload.LOAN_SCHEDULE) ? payload.LOAN_SCHEDULE : [];
    settings.RE_VALUE_HIST = Array.isArray(payload.RE_VALUE_HIST) ? payload.RE_VALUE_HIST : [];
    _writeSettingsMap(settings);
    return jsonOk({ saved: true, keys: ['LOAN','REAL_ESTATE','LOAN_SCHEDULE','RE_VALUE_HIST'] });
  } catch(err) {
    return jsonError('saveRealEstateSettings 실패: ' + err.message);
  } finally {
    if (locked) lock.releaseLock();
  }
}

function handleGetRealEstateSettings() {
  try {
    var settings = _readSettingsMap();
    return jsonOk({
      settings: {
        LOAN: settings.LOAN || {},
        REAL_ESTATE: settings.REAL_ESTATE || {},
        LOAN_SCHEDULE: Array.isArray(settings.LOAN_SCHEDULE) ? settings.LOAN_SCHEDULE : [],
        RE_VALUE_HIST: Array.isArray(settings.RE_VALUE_HIST) ? settings.RE_VALUE_HIST : [],
      }
    });
  } catch(err) {
    return jsonError('getRealEstateSettings 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  종목코드 동기화
// ════════════════════════════════════════════════════════════════════
function handleSyncCodes(codesParam) {
  try {
    var incoming;
    try { incoming = JSON.parse(decodeURIComponent(codesParam)); } catch(e) {
      try { incoming = JSON.parse(codesParam); } catch(e2) { return jsonError('codes 파싱 실패'); }
    }
    var ss = getss();
    var cs = ss.getSheetByName(CONFIG.SHEET_CODES);
    var createdCodeSheet = !cs;
    if (!cs) {
      cs = ss.insertSheet(CONFIG.SHEET_CODES);
      cs.getRange(1,1,1,6).setValues([['종목코드','종목명','유형','섹터','통화','시장']]);
    } else if (cs.getLastColumn() < 4) {
      cs.getRange(1,1,1,6).setValues([['종목코드','종목명','유형','섹터','통화','시장']]);
    } else if (cs.getLastColumn() < 5) {
      cs.getRange(1,5,1,1).setValues([['통화']]);
    }
    if (cs.getLastColumn() < 6) cs.getRange(1,6,1,1).setValues([['시장']]);
    _setCodeColumnText(cs, 1);

    // 구버전·신버전 모두 처리 (taxType 포함)
    var incomingNorm = {};
    Object.keys(incoming).forEach(function(name) {
      var val = incoming[name];
      if (typeof val === 'string') {
        incomingNorm[name] = { code: val, type: '주식', sector: '기타', currency: 'KRW', market: '' };
      } else {
        incomingNorm[name] = {
          code:     (val.code     || '').toString().trim(),
          type:     (val.type     || '주식').toString().trim(),
          sector:   (val.sector   || '기타').toString().trim(),
          currency: (val.currency || 'KRW').toString().trim().toUpperCase(),
          market:   (val.market || '').toString().trim().toUpperCase(),
          // ★ [taxType 분리] 구분 컬럼
        };
      }
    });

    // ── 기존 시트 데이터 1회 로드 (중복 읽기 제거)
    var existingByCode     = {};
    var existingByName     = {};
    var existingTypeByCode = {};
    var existingRowData    = {};
    var lastRow = cs.getLastRow();
    if (lastRow > 1) {
      var numCols = Math.max(cs.getLastColumn(), 6);
      var sheetData = cs.getRange(2, 1, lastRow - 1, numCols).getValues();
      sheetData.forEach(function(r, i) {
        var c = _cleanCode(r[0]);
        var n = (r[1] || '').toString().trim();
        var t = (r[2] || '').toString().trim();
        var rowIdx = i + 2;
        if (c && c !== '000000') {
          existingByCode[c]     = rowIdx;
          existingTypeByCode[c] = t;
          if (n) existingByName[n] = c;
        }
        var sec = (r[3] || '').toString().trim();
        var cur = (r[4] || '').toString().trim().toUpperCase();
        var market = (r[5] || '').toString().trim().toUpperCase();
        existingRowData[rowIdx] = { name: n, type: t, sector: sec, currency: cur, market: market };
      });
    }

    var synced         = 0;
    var updated        = 0;
    var pendingUpdates = [];
    var toAppend       = [];

    Object.keys(incomingNorm).forEach(function(name) {
      var obj  = incomingNorm[name];
      var code = _cleanCode(obj.code);
      if (!code || code === '000000' || !name) return;

      var normalName = name;
      var newType    = obj.type || '주식';
      var newSector  = obj.sector || '기타';

      if (existingByCode[code]) {
        var rowIdx   = existingByCode[code];
        var existing = existingRowData[rowIdx] || { name: '', type: '', sector: '', currency: '' };
        var nameChanged     = existing.name !== normalName;
        var typeChanged     = newType && existing.type !== newType;
        var sectorChanged   = newSector && existing.sector !== newSector;
        var newCurrencyVal  = obj.currency || 'KRW';
        var existingCur     = (existing.currency || '').toUpperCase();
        var curChanged      = newCurrencyVal !== 'KRW'
          ? existingCur !== newCurrencyVal
          : existingCur !== '' && existingCur !== 'KRW';
        var newMarketVal = obj.market || '';
        var marketChanged = (existing.market || '') !== newMarketVal;
        if (nameChanged)   pendingUpdates.push({ row: rowIdx, col: 2, val: normalName });
        if (typeChanged)   pendingUpdates.push({ row: rowIdx, col: 3, val: newType });
        if (sectorChanged) pendingUpdates.push({ row: rowIdx, col: 4, val: newSector });
        if (curChanged)    pendingUpdates.push({ row: rowIdx, col: 5, val: newCurrencyVal !== 'KRW' ? newCurrencyVal : '' });
        if (marketChanged) pendingUpdates.push({ row: rowIdx, col: 6, val: newMarketVal });
        if (nameChanged || typeChanged || sectorChanged || curChanged || marketChanged) updated++;
        return;
      }

      if (existingByName[normalName]) {
        var oldCode   = existingByName[normalName];
        var oldRowIdx = existingByCode[oldCode];
        if (oldRowIdx) {
          pendingUpdates.push({ row: oldRowIdx, col: 1, val: code });
          if (newType)   pendingUpdates.push({ row: oldRowIdx, col: 3, val: newType });
          if (newSector) pendingUpdates.push({ row: oldRowIdx, col: 4, val: newSector });
          var newCurVal = obj.currency || 'KRW';
          pendingUpdates.push({ row: oldRowIdx, col: 5, val: newCurVal !== 'KRW' ? newCurVal : '' });
          pendingUpdates.push({ row: oldRowIdx, col: 6, val: obj.market || '' });
          delete existingByCode[oldCode];
          existingByCode[code]       = oldRowIdx;
          existingByName[normalName] = code;
          updated++;
          return;
        }
      }

      var inheritedType = existingTypeByCode[code] || newType || '주식';
      var newCurrency = obj.currency || 'KRW';
      toAppend.push([code, normalName, inheritedType, newSector || '기타', newCurrency !== 'KRW' ? newCurrency : '', obj.market || '']);
      synced++;
    });

    // 배치 실행: col별 묶음 setValues
    if (pendingUpdates.length > 0) {
      var byCol = {};
      pendingUpdates.forEach(function(u) {
        if (!byCol[u.col]) byCol[u.col] = [];
        byCol[u.col].push(u);
      });
      Object.keys(byCol).forEach(function(col) {
        var updates = byCol[col].sort(function(a, b) { return a.row - b.row; });
        var i = 0;
        while (i < updates.length) {
          var start = updates[i].row;
          var vals  = [updates[i].val];
          while (i + 1 < updates.length && updates[i + 1].row === updates[i].row + 1) {
            i++;
            vals.push(updates[i].val);
          }
          cs.getRange(start, parseInt(col), vals.length, 1).setValues(vals.map(function(v){ return [v]; }));
          i++;
        }
      });
    }
    if (toAppend.length > 0) {
      cs.getRange(cs.getLastRow() + 1, 1, toAppend.length, 6).setValues(toAppend);
    }

    if (synced > 0 || updated > 0 || createdCodeSheet) {
      _touchSnapshotIntegritySourceRevision();
      SpreadsheetApp.flush();
    }
    var codeRepair = _repairKnownCodeColumns(ss);
    return jsonOk({ synced: synced, updated: updated, total: Object.keys(existingByCode).length, codeRepair: codeRepair });
  } catch(err) {
    return jsonError('syncCodes 실패: ' + err.message);
  }
}

function _repairKnownCodeColumns(ss) {
  var canonical = {};
  getCodeItems(ss, true).forEach(function(item) { canonical[item.code] = true; });
  var targets = [CONFIG.SHEET_CODES, CONFIG.SHEET_TRADES, CONFIG.SHEET_PH, CONFIG.SHEET_SNAPSHOT, FUND_NAV_SHEET, FUND_UNITS_SHEET];
  var results = [];
  targets.forEach(function(name) {
    var sheet = ss.getSheetByName(name), column = _codeColumnForSheet(name);
    if (!sheet || !column) return;
    _setCodeColumnText(sheet, column);
    if (sheet.getLastRow() < 2) { results.push({ sheet: name, repaired: 0 }); return; }
    var range = sheet.getRange(2, column, sheet.getLastRow() - 1, 1);
    var values = range.getValues(), repaired = 0;
    values.forEach(function(row) {
      var raw = row[0];
      if (raw === '' || raw == null) return;
      var text = String(raw).trim();
      var candidate = _cleanCode(text);
      // 숫자로 손상된 코드도 종목 마스터의 정확한 정규 코드와 일치할 때만 복구합니다.
      if (candidate && canonical[candidate] && text !== candidate) { row[0] = candidate; repaired++; }
      else row[0] = text;
    });
    if (repaired) {
      var backup = _backupSheetBeforeWrite(ss, sheet, name);
      try {
        range.setValues(values);
        _touchSnapshotIntegritySourceRevision({ all: true });
        _verifyWrittenRange(sheet, 2, column, values, '종목코드 열 쓰기 후 검증 실패: ' + name);
        _markSnapshotBackupStatus(backup, 'COMPLETED');
        results.push({ sheet: name, repaired: repaired, backupCleanup: _cleanupCurrentSystemBackup(ss, backup) });
      } catch (error) { _markSnapshotBackupStatus(backup, 'WRITE_FAILED', error.message); throw error; }
    } else results.push({ sheet: name, repaired: 0 });
  });
  return results;
}

// ════════════════════════════════════════════════════════════════════
//  죽은 코드 정리 — 보유현황에 없는 종목코드 제거
//  ✅ v9.2: new Set() → 객체 방식으로 변경 (GAS ES5 호환)
// ════════════════════════════════════════════════════════════════════
function cleanDeadCodes() {
  var ss = getss();
  var cs = ss.getSheetByName(CONFIG.SHEET_CODES);
  var hs = ss.getSheetByName(CONFIG.SHEET_HOLD);
  if (!cs) { Logger.log('종목코드 시트 없음'); return; }

  // 보유현황 시트의 현재 코드 목록 (객체로 관리 — GAS ES5 Set 미지원)
  var activeCodes = {};
  if (hs && hs.getLastRow() > 1) {
    hs.getRange(2, 1, hs.getLastRow() - 1, 1).getValues().forEach(function(r) {
      var c = _cleanCode(r[0]);
      if (c && c !== '000000') activeCodes[c] = true;
    });
  }

  if (Object.keys(activeCodes).length === 0) {
    Logger.log('⚠️ 보유현황 데이터 없음 — HTML에서 한 번 접속 후 재실행하세요');
    return;
  }

  var lastRow = cs.getLastRow();
  if (lastRow < 2) { Logger.log('종목코드 시트 데이터 없음'); return; }

  var rows     = cs.getRange(2, 1, lastRow - 1, 3).getValues();
  var toDelete = [];
  var removed  = [];

  rows.forEach(function(r, i) {
    var c = _cleanCode(r[0]);
    var n = (r[1] || '').toString().trim();
    if (c && c !== '000000' && !activeCodes[c]) {
      toDelete.push(i + 2);
      removed.push(c + ' ' + n);
    }
  });

  // 역순 삭제 (행 번호 밀림 방지)
  toDelete.reverse().forEach(function(rowIdx) {
    cs.deleteRow(rowIdx);
  });

  if (toDelete.length > 0) {
    SpreadsheetApp.flush();
    _touchSnapshotIntegritySourceRevision({ all: true });
  }

  var msg = '✅ 죽은 코드 정리 완료 — 제거: ' + toDelete.length + '개' +
            (removed.length > 0 ? ' / ' + removed.join(', ') : '');
  Logger.log(msg);
}

// ════════════════════════════════════════════════════════════════════
//  가격이력 종목명 오류 수정
// ════════════════════════════════════════════════════════════════════
function fixPriceHistoryNames() {
  var ss = getss();
  var ph = ss.getSheetByName(CONFIG.SHEET_PH);
  if (!ph || ph.getLastRow() < 2) { Logger.log('가격이력 시트 데이터 없음'); return; }

  var codeToName = {};
  var cs = ss.getSheetByName(CONFIG.SHEET_CODES);
  if (cs && cs.getLastRow() > 1) {
    cs.getRange(2, 1, cs.getLastRow() - 1, 2).getValues().forEach(function(r) {
      var c = _cleanCode(r[0]);
      var n = (r[1] || '').toString().trim();
      if (c && n) codeToName[c] = n;
    });
  }

  var lastRow = ph.getLastRow();
  var data    = ph.getRange(2, 1, lastRow - 1, 3).getValues();

  // ★ [개선] 루프 내 개별 setValue() → 배치 setValues()로 변경
  //   종목 수만큼 시트 API 호출하던 문제 → 연속 행 묶음으로 일괄 처리
  var pending = [];
  data.forEach(function(r, i) {
    var code    = _cleanCode(r[1]);
    var nameVal = (r[2] || '').toString().trim();
    if (!nameVal || !isNaN(Number(nameVal))) {
      var correctName = codeToName[code] || '';
      if (correctName) pending.push({ rowNo: i + 2, name: correctName });
    }
  });

  if (pending.length === 0) {
    Logger.log('가격이력 종목명 보정: 수정 대상 없음');
    try { SpreadsheetApp.getUi().alert('✅ 가격이력 종목명 보정 완료: 수정 대상 없음'); } catch(e) { Logger.log('UI 알림 실패'); }
    return;
  }

  pending.sort(function(a, b) { return a.rowNo - b.rowNo; });
  var i = 0;
  while (i < pending.length) {
    var startRow = pending[i].rowNo;
    var batch = [pending[i].name];
    while (i + 1 < pending.length && pending[i + 1].rowNo === pending[i].rowNo + 1) {
      i++;
      batch.push(pending[i].name);
    }
    ph.getRange(startRow, 3, batch.length, 1).setValues(batch.map(function(n){ return [n]; }));
    i++;
  }

  SpreadsheetApp.flush();
  var earliestFixedDate = pending.map(function(item) { return _normalizeDate(data[item.rowNo - 2][0]); }).filter(Boolean).sort()[0];
  _touchSnapshotIntegritySourceRevision(earliestFixedDate ? { from: earliestFixedDate } : { all: true });
  var msg = '✅ 가격이력 종목명 보정 완료: ' + pending.length + '건 수정';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log('UI 알림 실패'); }
}

// ════════════════════════════════════════════════════════════════════
//  가격이력 시트 마이그레이션 (구버전 → 신버전, 1회 실행)
// ════════════════════════════════════════════════════════════════════
function initSheet() {
  var ss;
  try {
    ss = getss();
  } catch(openError) {
    var openMsg = '❌ 시트 구성 확인 실패\n\n' + openError.message + '\n\n현재 스프레드시트를 새로고침한 뒤 다시 시도해주세요.';
    Logger.log(openMsg);
    try { SpreadsheetApp.getUi().alert(openMsg); } catch(uiError) {}
    return;
  }

  var specs = [
    [CONFIG.SHEET_CODES, ['종목코드','종목명','유형','섹터','통화','시장'], [90,200,100,120,80,80]],
    [CONFIG.SHEET_PRICES, ['종목코드','종가','종목명','갱신일시'], [90,90,200,160]],
    [CONFIG.SHEET_SNAPSHOT, ['날짜','종목코드','종목명','수량','매수단가','매수원금','평가단가','평가금액','손익','수익률(%)','평가단가소스','저장일시'], [100,90,180,70,100,110,100,110,100,90,120,160]],
    [CONFIG.SHEET_PH, ['날짜','종목코드','종목명','가격','입력일시','가격소스'], [100,90,180,100,160,120]],
    [CONFIG.SHEET_HOLD, ['종목코드','종목명','수량','매수단가','매수원금','자산유형','계좌'], [90,180,70,110,110,100,120]],
    [CONFIG.SHEET_TRADES, ['날짜','매수/매도','계좌','종목명','종목코드','수량','단가','자산유형','메모','비율','단주정산'], [100,80,100,180,90,70,100,90,200,80,100]],
    [CONFIG.SHEET_ETF_DIVIDENDS, ['종목코드','ISIN','종목명','기준일','지급일','주당분배금','수집일시','원본소스'], [90,130,200,100,100,100,170,100]],
    [CONFIG.SHEET_SYNC_LOG, ['기록시각','소스','거래일','종목코드','종목명','계좌','메시지'], [160,100,100,90,180,120,300]],
    [CONFIG.SHEET_SETTINGS, ['키','값'], [180,600]]
  ];
  var created = 0;
  var integritySourceCreated = false;
  specs.forEach(function(spec) {
    var sh = ss.getSheetByName(spec[0]);
    if (!sh) {
      sh = ss.insertSheet(spec[0]); created++;
      if (_isSnapshotIntegritySourceSheet(spec[0])) integritySourceCreated = true;
    }
    sh.getRange(1, 1, 1, spec[1].length).setValues([spec[1]])
      .setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
    sh.setFrozenRows(1);
    spec[2].forEach(function(width, idx) { sh.setColumnWidth(idx + 1, width); });
  });
  SpreadsheetApp.flush();
  if (integritySourceCreated) _touchSnapshotIntegritySourceRevision({ all: true });

  try {
    SpreadsheetApp.getUi().alert(
      '✅ 시트 구성 확인 완료\n\n' +
      '- 새로 생성한 시트: ' + created + '개\n' +
      '- 기존 데이터는 삭제하지 않았습니다.\n\n' +
      '버전업마다 실행할 필요는 없습니다. [진단·조회]의 자동화 상태를 확인하고, 트리거가 누락된 경우에만 [복구·정리 실행]에서 복구하세요.'
    );
  } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}

function clearPriceAndSnapshotRows() {
  var ss = getss();
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
  if (!ui) throw new Error('스프레드시트 UI 환경에서 실행하세요.');

  var ans = ui.alert(
    '가격이력/스냅샷 데이터 삭제',
    '가격이력·스냅샷의 전체 기간 데이터를 삭제합니다. 과거 손익 조회와 복구 근거를 잃을 수 있습니다. 버전업이나 일반 오류 복구용이 아닙니다.\n별도 백업을 확보했습니까?',
    ui.ButtonSet.YES_NO
  );
  if (ans !== ui.Button.YES) return;
  var confirmation = ui.prompt('전체 삭제 최종 확인', '가격이력과 스냅샷의 모든 데이터 행이 삭제됩니다. 자동 복원되지 않습니다. 별도 백업을 확보한 뒤 정확히 가격이력·스냅샷 삭제 를 입력하세요.', ui.ButtonSet.OK_CANCEL);
  if (confirmation.getSelectedButton() !== ui.Button.OK || confirmation.getResponseText() !== '가격이력·스냅샷 삭제') return;

  var deleted = 0;
  var ph = ss.getSheetByName(CONFIG.SHEET_PH);
  var integritySourceCreated = !ph;
  if (!ph) ph = ss.insertSheet(CONFIG.SHEET_PH);
  if (ph.getLastRow() === 0) ph.getRange(1,1,1,6).setValues([['날짜','종목코드','종목명','가격','입력일시','가격소스']]);
  if (ph.getLastRow() > 1) {
    deleted += ph.getLastRow() - 1;
    ph.getRange(2, 1, ph.getLastRow() - 1, Math.max(1, ph.getLastColumn())).clearContent();
  }

  var snap = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
  if (!snap) { snap = ss.insertSheet(CONFIG.SHEET_SNAPSHOT); integritySourceCreated = true; }
  if (snap.getLastRow() === 0) snap.getRange(1,1,1,12).setValues([['날짜','종목코드','종목명','수량','매수단가','매수원금','평가단가','평가금액','손익','수익률(%)','평가단가소스','저장일시']]);
  if (snap.getLastRow() > 1) {
    deleted += snap.getLastRow() - 1;
    snap.getRange(2, 1, snap.getLastRow() - 1, Math.max(1, snap.getLastColumn())).clearContent();
  }
  if (deleted > 0 || integritySourceCreated) _touchSnapshotIntegritySourceRevision({ all: true });
  var msg = '✅ 삭제 완료 (총 ' + deleted + '행)';
  Logger.log(msg);
  ui.alert(msg);
}
// ════════════════════════════════════════════════════════════════════
//  메뉴
// ════════════════════════════════════════════════════════════════════
function configureTossClientIdPrompt() {
  var ui = SpreadsheetApp.getUi();
  var current = _getTossConfigStatus_();
  var response = ui.prompt('Toss Open API Client ID 설정', 'Client ID를 입력하세요.\n빈 입력은 기존 값을 유지합니다.\n현재: ' + (current.clientIdConfigured ? current.clientIdMasked : '미설정'), ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var input = String(response.getResponseText() || '').trim();
  if (!input) { ui.alert(current.clientIdConfigured ? '변경 없음' : '⚠️ Client ID가 미설정 상태입니다.'); return; }
  handleSaveTossConfig(JSON.stringify({ clientId: input }));
  ui.alert('✅ Toss Client ID 저장 완료\n표시값: ' + _getTossConfigStatus_().clientIdMasked);
}

function configureTossClientSecretPrompt() {
  var ui = SpreadsheetApp.getUi();
  var current = _getTossConfigStatus_();
  var response = ui.prompt('Toss Open API Client Secret 설정', '재발급한 Client Secret을 입력하세요.\n빈 입력은 기존 값을 유지합니다.\n현재: ' + (current.secretConfigured ? '설정됨' : '미설정'), ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var input = String(response.getResponseText() || '').trim();
  if (!input) { ui.alert(current.secretConfigured ? '변경 없음' : '⚠️ Client Secret이 미설정 상태입니다.'); return; }
  handleSaveTossConfig(JSON.stringify({ secret: input }));
  ui.alert('✅ Toss Client Secret 저장 완료\nSecret 원문은 저장 상태 외에는 표시하지 않습니다.');
}

function showTossOpenApiStatus() {
  var ui = SpreadsheetApp.getUi();
  var status = _getTossConfigStatus_();
  ui.alert('Toss Open API 설정 상태\n\n' +
    (status.clientIdConfigured ? '✅' : '⚠️') + ' Client ID: ' + (status.clientIdConfigured ? status.clientIdMasked : '미설정') + '\n' +
    (status.secretConfigured ? '✅' : '⚠️') + ' Client Secret: ' + (status.secretConfigured ? '설정됨' : '미설정') + '\n' +
    '최근 진단: ' + (status.lastDiagnosticAt || '없음') + '\n' +
    '진단 결과: ' + (status.lastDiagnosticAt ? (status.lastDiagnosticOk ? '성공' : '실패 · ' + (status.lastDiagnosticCode || 'ERROR')) : '미실행'));
}

function runTossMarketDataDiagnosis() {
  var ui = SpreadsheetApp.getUi();
  var result = JSON.parse(handleDiagnoseTossMarketData().getContent());
  if (result.status !== 'ok') { ui.alert('❌ Toss 진단 실패\n' + String(result.message || '응답 오류')); return; }

  var idSuffix = function(item) {
    var ids = [];
    if (item && item.requestId) ids.push('requestId ' + item.requestId);
    if (item && item.referenceId) ids.push('referenceId ' + item.referenceId);
    if (item && item.edgeRequestId) ids.push('x-amz-cf-id ' + item.edgeRequestId);
    return ids.length ? ' / ' + ids.join(' / ') : '';
  };
  var egress = result.egressProbe || {};
  var oauth = result.oauth || {};
  var lines = [
    (egress.ok ? '🔎' : '⚠️') + ' GAS egress 관측: ' + (egress.status == null ? '-' : egress.status) + ' / ' + (egress.code || 'ERROR') +
      (egress.ipFamily ? ' / ' + egress.ipFamily : '') + ' / ' + (egress.ip || 'IP 없음') +
      (egress.provider ? ' / ' + egress.provider : '') + ' / ' + (egress.elapsedMs || 0) + 'ms',
    (oauth.ok ? '✅' : '❌') + ' OAuth: ' + (oauth.status == null ? '-' : oauth.status) + ' / ' + (oauth.code || 'ERROR') +
      (oauth.providerCode ? ' / ' + oauth.providerCode : '') + idSuffix(oauth) + ' / ' + (oauth.elapsedMs || 0) + 'ms'
  ];
  if (!egress.ok && Array.isArray(egress.attempts)) egress.attempts.forEach(function(item) {
    lines.push('  ↳ ' + (item.provider || 'provider') + ': ' + (item.status == null ? '-' : item.status) + ' / ' +
      (item.code || 'ERROR') + ' / length ' + Number(item.bodyLength || 0) +
      (item.contentType ? ' / ' + item.contentType : '') + ' / ' + Number(item.elapsedMs || 0) + 'ms');
  });
  (result.endpoints || []).forEach(function(item) {
    lines.push((item.ok ? '✅' : (item.code === 'SKIPPED_OAUTH_FAILED' ? '⏭️' : '❌')) + ' ' + item.name + ': ' +
      (item.status == null ? '-' : item.status) + ' / ' + (item.code || 'ERROR') + ' / ' + (item.count || 0) + '건' +
      idSuffix(item) + ' / ' + (item.elapsedMs || 0) + 'ms');
  });
  var smoke = result.priceSmoke || {};
  lines.push((smoke.ok && smoke.validLastPrice && smoke.timestampPresent ? '✅' : (smoke.code === 'SKIPPED_OAUTH_FAILED' ? '⏭️' : '❌')) +
    ' priceSmoke 005930: ' + (smoke.status == null ? '-' : smoke.status) + ' / ' + (smoke.code || 'ERROR') + ' / ' +
    (smoke.resultCount || 0) + '건 / ' + (smoke.symbol || '005930') + ' / 유효가격 ' + (smoke.validLastPrice ? '있음' : '없음') +
    ' / timestamp ' + (smoke.timestampPresent ? '있음' : '없음') + idSuffix(smoke) + ' / ' + (smoke.elapsedMs || 0) + 'ms');

  var endpointIpBlocked = oauth.ok && (result.endpoints || []).concat([smoke]).some(function(item) {
    return item.code === 'IP_NOT_ALLOWED_OR_FORBIDDEN';
  });
  var oauthAccessDenied = !oauth.ok && oauth.status === 403 && String(oauth.providerCode || '').toLowerCase() === 'access_denied';
  var observedIpHint = egress.ok && egress.ip
    ? ' 관측 ' + (egress.ipFamily || 'IP') + ' ' + egress.ip + '를 Toss 허용 IP에 임시 등록해 재진단할 수 있습니다. 단, Toss 콘솔이 해당 address family를 지원하는지 확인해야 하며 이 IP가 Toss OAuth 요청에도 동일하게 사용됐다고 보장되지는 않습니다.'
    : '';
  var guide = endpointIpBlocked
    ? '\n\n실제 Toss market endpoint 403: Toss WTS Open API에서 GAS UrlFetchApp의 Google IP range pool 허용 IP 등록을 확인하세요.' + observedIpHint
    : (oauthAccessDenied
      ? '\n\nOAuth 403 access_denied · IP 허용 정책에 의해 차단됐을 가능성이 큽니다.' + observedIpHint
      : '');
  var caveat = '\n\n※ GAS egress 관측값은 외부 IP 확인 서비스가 본 참고값입니다. Toss 요청의 실제 출구 IP와 동일하다고 보장되지 않습니다.';
  ui.alert('Toss Open API read-only 진단\n\n' + lines.join('\n') + guide + caveat);
}

function clearTossOpenApiConfigPrompt() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert('Toss 설정 삭제', 'Toss Client ID/Secret, 진단 상태와 Toss token cache만 삭제합니다.\n가격이력·Snapshot·펀드·배당·거래 및 다른 API 설정은 변경하지 않습니다.\n계속하시겠습니까?', ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  handleClearTossConfig();
  ui.alert('✅ Toss 설정과 token cache만 삭제했습니다.');
}

function _confirmPortfolioMenuAction(title, message) {
  var ui = SpreadsheetApp.getUi();
  return ui.alert(title, message + '\n\n실행하시겠습니까?', ui.ButtonSet.YES_NO) === ui.Button.YES;
}

function showPortfolioMenuGuide() {
  SpreadsheetApp.getUi().alert('포트폴리오 메뉴 사용 안내\n\n버전업마다 메뉴를 실행할 필요는 없습니다. 해당 릴리스에 별도 안내가 있을 때만 필요한 작업을 실행하세요.\n설정: 최초 연결·인증 변경 시\n진단·조회: 문제 확인용. 운영자료 저장·삭제 없음 (외부 진단의 임시 계산/인증 캐시는 사용할 수 있음)\n종가 갱신: 자동 실행 실패·즉시 갱신 시\n소급채우기: 실제 누락 기간만\n복구·정리: 진단 후 필요할 때만\n위험 작업: 별도 백업 확보 후 실행');
}

function showManualPriceHistoryPolicy() {
  SpreadsheetApp.getUi().alert('수동가격은 날짜별 이력을 보존합니다. 고정 정책이며 변경 옵션이 아닙니다.');
}

function repairMissingDailyTriggersPrompt() {
  if (!_confirmPortfolioMenuAction('자동 트리거 복구·정리', '누락된 일일 자동화·구조 변경 트리거를 추가하고, 레거시 분리 트리거와 중복 통합 마감 트리거가 있으면 정상 집합으로 정리합니다. 현재 정상인 필수 트리거는 유지합니다.')) return;
  _ensureDailyTriggers(true);
  checkDailyAutomationStatus();
}

function resetDailyTriggersPrompt() {
  if (!_confirmPortfolioMenuAction('자동 트리거 전체 재등록', '기존 일일/레거시 자동화 트리거를 삭제하고 기본 일정으로 다시 등록하며 만료 임시 시트를 정리합니다. 사용자 지정 실행 시간이 바뀔 수 있습니다. 일반 누락·레거시·중복 정리는 자동 트리거 복구·정리를 사용하세요.')) return;
  setupTrigger();
}

function repairSheetStructurePrompt() {
  if (!_confirmPortfolioMenuAction('시트 구성 생성·헤더 복구', '누락 시트를 만들고 기존 시트의 제목행·표시 형식을 다시 설정합니다. 사용자 지정 제목행이 바뀔 수 있습니다. 데이터 행은 삭제하지 않습니다. 버전업 필수 작업이 아닙니다.')) return;
  initSheet();
}

function showSnapshotRepairProgress() {
  var raw = PropertiesService.getScriptProperties().getProperty(SNAPSHOT_REPAIR_STATE_KEY);
  var state = raw ? JSON.parse(raw) : null;
  var missing = state && !state.done && !_hasSnapshotRepairContinuationTrigger();
  SpreadsheetApp.getUi().alert(_snapshotRepairStatusMessage(state) + (missing ? '\n후속 트리거 누락: 복구·정리 실행에서 재예약하세요.' : ''));
  return state;
}

function resumeSnapshotRepairPrompt() {
  if (!_confirmPortfolioMenuAction('스냅샷 복구 후속 트리거 재예약', '진행 중인 전체 스냅샷 복구의 후속 트리거가 누락되었으면 다시 예약합니다. 남은 날짜의 스냅샷 저장이 재개됩니다.')) return;
  return showSnapshotConsistencyRepairStatus();
}

function resumeBackfillPrompt() {
  if (!_confirmPortfolioMenuAction('소급채우기 재개', '저장된 진행 위치와 덮어쓰기 설정으로 가격이력·스냅샷 저장을 이어갑니다. 진행상황을 먼저 확인하세요.')) return;
  backfillResume();
}

function runPriceAnomalyDiagnosis() {
  return detectPriceAnomalyPromptAndMaybeRepair(true);
}

function showPortfolioIntegrityDiagnosisPrompt() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt('기간 정합성 진단 (저장 없음)', '기간을 YYYY-MM-DD~YYYY-MM-DD 형식으로 입력하세요. 최대 400 평일. 가격이력과 스냅샷을 함께 점검합니다.', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var parts = String(response.getResponseText() || '').trim().split('~');
  if (parts.length !== 2 || !parts.every(function(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) && !isNaN(new Date(value.trim() + 'T00:00:00Z').getTime()) && new Date(value.trim() + 'T00:00:00Z').toISOString().slice(0, 10) === value.trim(); }) || parts[0].trim() > parts[1].trim()) { ui.alert('유효한 시작·종료 날짜를 입력하세요.'); return; }
  var result = JSON.parse(handleDiagnoseSnapshotIntegrityRange(parts[0].trim(), parts[1].trim(), '', '').getContent());
  if (result.status !== 'ok') { ui.alert('정합성 진단 실패: ' + result.message); return; }
  var counts = {};
  result.diagnostics.forEach(function(item) { counts[item.status] = (counts[item.status] || 0) + 1; });
  var labels = { VALID: '정상', PARTIAL: '일부 자료 누락', MISMATCH: '계산 결과 불일치', CONFLICT: '중복·충돌', SOURCE_INCOMPLETE: '원자료 부족', NO_SNAPSHOT: '스냅샷 없음', PRICE_SUSPICIOUS: '가격 확인 필요', FX_MISSING: '환율 누락', MANUAL_PROTECTED: '수동가격 보호' };
  function summary(values) { return Object.keys(values).map(function(key) { return (labels[key] || key) + ': ' + values[key]; }).join(', ') || '점검 자료 없음'; }
  ui.alert('정합성 진단 (저장 없음)\n점검 날짜: ' + result.checkedDates.length + '\n스냅샷 상태: ' + summary(counts) + '\n가격이력 상태: ' + summary(result.priceIntegrity.counts) + '\n정상이 아닌 결과는 원자료를 먼저 확인하세요. 전체 복구는 별도 실행 메뉴입니다.');
}

function onInstall(e) {
  onOpen(e);
}

function _addFallbackMenu(ui) {
  ui.createMenu('📊 포트폴리오')
    .addItem('사용 안내 (버전업 필수 작업 아님)', 'showPortfolioMenuGuide')
    .addItem('연결 스프레드시트 설정', 'configureSpreadsheetIdPrompt')
    .addItem('공공데이터 API 인증키 설정', 'configurePublicDataApiKeyPrompt')
    .addItem('KRX 인증키 설정', 'configureKrxAuthKeyPrompt')
    .addItem('Toss Client ID 설정', 'configureTossClientIdPrompt')
    .addItem('Toss Client Secret 설정', 'configureTossClientSecretPrompt')
    .addItem('Toss 설정 상태', 'showTossOpenApiStatus')
    .addItem('Toss API read-only 진단', 'runTossMarketDataDiagnosis')
    .addSubMenu(ui.createMenu('⚠️ 위험 작업').addItem('Toss 인증 설정 삭제', 'clearTossOpenApiConfigPrompt'))
    .addItem('요청 접근 토큰 설정·해제', 'configureAccessTokenPrompt')
    .addItem('메뉴 생성 오류 확인', 'showMenuBuildError')
    .addToUi();
}

function onOpen(e) {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
  if (!ui) return;

  // 컨테이너에 복사된 스크립트가 과거 기본 문서 ID를 계속 사용하지 않도록
  // 열기 이벤트의 실제 문서를 웹앱/트리거용 연결 대상으로 기억합니다.
  try {
    var source = e && e.source ? e.source : SpreadsheetApp.getActiveSpreadsheet();
    if (source && source.getId()) {
      PropertiesService.getScriptProperties().setProperty('SS_ID', source.getId());
      SS_ID = source.getId();
    }
  } catch(idError) {
    Logger.log('현재 스프레드시트 ID 저장 실패: ' + idError.message);
  }

  try {
    var menuInit = ui.createMenu('⚙️ 설정 (최초·변경 시)')
      .addItem('🔗 연결 스프레드시트 변경', 'configureSpreadsheetIdPrompt')
      .addItem('🔑 공공데이터 API 인증키 설정', 'configurePublicDataApiKeyPrompt')
      .addItem('🔑 KRX 인증키 설정', 'configureKrxAuthKeyPrompt')
      .addItem('🔑 Toss Client ID 설정', 'configureTossClientIdPrompt')
      .addItem('🔐 Toss Client Secret 설정', 'configureTossClientSecretPrompt')
      .addItem('🛡️ 요청 접근 토큰 설정·해제', 'configureAccessTokenPrompt')
      .addItem('🔐 레거시 API 키 안전 이전 (필요 시 1회)', 'migrateLegacyApiKeysPrompt');
    var menuPrice = ui.createMenu('📈 확정 종가·평가 갱신')
      .addItem('▶️ 확정 평가단가·스냅샷 수동 갱신', 'runDailyPriceSnapshotNow')
      .addItem('🗓️ KRX 기간 종가 조회·저장', 'importKrxClosesPrompt')
      .addSeparator()
      .addItem('ℹ️ 고정 가격소스 정책 확인', 'togglePriceSourceMode')
      .addItem('ℹ️ 수동가격 이력 보존 정책 확인', 'showManualPriceHistoryPolicy');
    var menuBackfill = ui.createMenu('📆 소급채우기 (누락 기간만)')
      .addItem('📊 진행상황 조회 (변경 없음)', 'backfillStatus')
      .addItem('▶️ 기간 지정·저장 시작', 'backfillRangePrompt')
      .addItem('⏩ 중단된 소급채우기 재개', 'resumeBackfillPrompt');
    var menuDiagnosis = ui.createMenu('🔎 진단·조회 (운영자료 변경 없음)')
      .addItem('자동화 상태 점검 (트리거 변경 없음)', 'checkDailyAutomationStatus')
      .addItem('기간 가격이력·스냅샷 정합성 진단', 'showPortfolioIntegrityDiagnosisPrompt')
      .addItem('전체 스냅샷 복구 진행상황 조회', 'showSnapshotRepairProgress')
      .addItem('백업 진단·정리 후보 조회 (삭제 없음)', 'showSystemBackupDiagnosis')
      .addItem('가격 이상치 진단 (가격 저장 없음)', 'runPriceAnomalyDiagnosis')
      .addItem('SEIBro ETF 분배금 진단', 'runEtfDividendDiagnosis')
      .addItem('SEIBro ETF 분배금 반영 미리보기', 'runEtfDividendDryRun')
      .addItem('API 인증키 저장 상태', 'showApiKeyStatus')
      .addItem('Toss 설정 상태', 'showTossOpenApiStatus')
      .addItem('Toss API 연결 진단 (운영자료 변경 없음)', 'runTossMarketDataDiagnosis')
      .addItem('메뉴 생성 오류 확인', 'showMenuBuildError');
    var menuRepair = ui.createMenu('🛠️ 복구·정리 실행 (필요 시만)')
      .addItem('자동 트리거 복구·정리', 'repairMissingDailyTriggersPrompt')
      .addItem('시트 구성 생성·헤더 복구', 'repairSheetStructurePrompt')
      .addItem('전체 스냅샷 정합성 복구 시작', 'runSnapshotConsistencyRepair')
      .addItem('스냅샷 복구 후속 트리거 재예약', 'resumeSnapshotRepairPrompt')
      .addItem('검증된 시스템 백업 정리 (삭제)', 'applySystemBackupMaintenancePrompt')
      .addItem('가격 이상치 진단 후 복구 (확인 필요)', 'detectPriceAnomalyPromptAndMaybeRepair')
      .addItem('코드·종목명·중복 데이터 정리', 'runDataCleanup')
      .addItem('SEIBro ETF 분배금 운영 반영', 'runEtfDividendApply');
    var menuDanger = ui.createMenu('⚠️ 위험 작업 (삭제·재등록)')
      .addItem('🗑️ 가격이력·스냅샷 전체 삭제', 'clearPriceAndSnapshotRows')
      .addItem('🗑️ Toss 인증 설정 삭제', 'clearTossOpenApiConfigPrompt')
      .addItem('자동 트리거 전체 재등록', 'resetDailyTriggersPrompt');
    ui.createMenu('📊 포트폴리오')
      .addItem('ℹ️ 사용 안내 (버전업 필수 작업 아님)', 'showPortfolioMenuGuide')
      .addSubMenu(menuInit).addSubMenu(menuPrice).addSubMenu(menuBackfill)
      .addSeparator().addSubMenu(menuDiagnosis).addSubMenu(menuRepair)
      .addSeparator().addSubMenu(menuDanger).addToUi();

    try { PropertiesService.getScriptProperties().deleteProperty('last_menu_build_error'); } catch(e3) {}
  } catch(err) {
    try { PropertiesService.getScriptProperties().setProperty('last_menu_build_error', err.message || String(err)); } catch(e4) {}
    Logger.log('포트폴리오 메뉴 생성 실패: ' + (err.message || err));
    try { _addFallbackMenu(ui); } catch(eFallback) { Logger.log('fallback 메뉴 생성 실패: ' + eFallback.message); }
  }

}

function showMenuBuildError() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
  var msg = '';
  try { msg = PropertiesService.getScriptProperties().getProperty('last_menu_build_error') || ''; } catch(e2) {}
  if (!ui) {
    Logger.log(msg || '최근 메뉴 생성 오류가 없습니다.');
    return;
  }
  ui.alert(msg ? ('최근 메뉴 생성 오류:\n' + msg) : '최근 메뉴 생성 오류가 없습니다.');
}

// ════════════════════════════════════════════════════════════════════
//  데이터 정리 통합 실행 — 죽은 코드 + 종목명 보정 + 스냅샷 중복 한 번에
// ════════════════════════════════════════════════════════════════════
function runDataCleanup() {
  if (!_confirmPortfolioMenuAction('데이터 정리 실행', '죽은 종목코드 삭제·가격이력 종목명 보정·가격이력 중복 정리와 함께 Snapshot의 날짜 유실 행·0좌 펀드 잔존 행·안전 판정된 중복을 정리하고 만료 임시 시트를 삭제합니다. Snapshot 변경 전 시스템 백업과 read-back 검증을 수행하지만, 정리된 행은 자동 복원되지 않습니다. 실제 문제가 있을 때만 실행하세요.')) return;
  try {
    var ui;
    try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
    Logger.log('[runDataCleanup] 시작');

    // 1) 죽은 코드 정리
    cleanDeadCodes();
    Logger.log('[runDataCleanup] 죽은 코드 정리 완료');

    // 2) 가격이력 종목명 보정
    fixPriceHistoryNames();
    Logger.log('[runDataCleanup] 가격이력 종목명 보정 완료');

    // 3) 가격이력 중복 정리
    cleanupPriceHistoryDuplicates();
    Logger.log('[runDataCleanup] 가격이력 중복 정리 완료');

    // 4) 스냅샷 날짜 유실·0좌 펀드 잔존·안전 중복 정리
    var snapshotCleanup = cleanupSnapshotDuplicates();
    Logger.log('[runDataCleanup] 스냅샷 정리 완료: ' + JSON.stringify(snapshotCleanup || {}));

    // 5) 구버전 또는 만료된 조회용 임시 시트 정리
    _cleanupBenchmarkTempSheets();
    Logger.log('[runDataCleanup] 임시 시트 정리 완료');

    var msg = '✅ 데이터 정리 완료\n- 죽은 코드 정리\n- 가격이력 종목명 보정\n- 가격이력 중복 제거\n- Snapshot 날짜 유실·0좌 펀드 잔존·안전 중복 정리\n- 임시 시트 정리';
    Logger.log(msg);
    if (ui) ui.alert(msg);
  } catch(err) {
    Logger.log('❌ runDataCleanup 실패: ' + err.message);
    try { SpreadsheetApp.getUi().alert('❌ 데이터 정리 중 오류 발생:\n' + err.message); } catch(e) {}
  }
}

// ★ 구버전 고정 이름과 만료된 요청별 임시 시트 정리
function _cleanupBenchmarkTempSheets() {
  var ss = getss();
  var sheets = ss.getSheets();
  var removed = 0;
  var nowMs = Date.now();
  sheets.forEach(function(sh) {
    var name = sh.getName();
    // 고정 이름을 쓰던 구버전 임시 시트는 즉시 삭제합니다.
    // 요청별 시트는 10분 이상 지난 경우만 삭제해 현재 계산 중인 요청과 충돌하지 않게 합니다.
    var isLegacyBenchmark = name.indexOf('_bm_') === 0
      && /^(?:INDEX|NASDAQ|SP|KRX)/i.test(name.slice(4));
    var isLegacy = name === CONFIG.SHEET_TMP || name === '_div_tmp' || isLegacyBenchmark;
    if (isLegacy || _isExpiredTempSheet(name, nowMs)) {
      try { ss.deleteSheet(sh); removed++; } catch(e) {
        Logger.log('⚠️ 임시 시트 삭제 실패(' + name + '): ' + e.message);
      }
    }
  });
  if (removed > 0) Logger.log('[_cleanupBenchmarkTempSheets] ' + removed + '개 임시 시트 삭제');
}
// ════════════════════════════════════════════════════════════════════
//  유틸
// ════════════════════════════════════════════════════════════════════
function calcMissing(allCodesParam, returnedCodes) {
  if (!allCodesParam) return [];
  return allCodesParam.split(',').map(function(c){ return c.trim(); })
    .filter(function(c){ return c && returnedCodes.indexOf(c) === -1; });
}
function today() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}
// ── 날짜 정규화: 어떤 형식이든 YYYY-MM-DD 문자열로 변환
// 'Fri Dec 26 2025', Date 객체, '2025-12-26' 모두 처리
function _normalizeDate(raw) {
  if (!raw) return '';
  if (raw instanceof Date) return Utilities.formatDate(raw, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  var s = raw.toString().trim();
  // 이미 YYYY-MM-DD 형식
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // 'Fri Dec 26 2025 ...' 형식 → new Date() 파싱
  try {
    var d = new Date(s);
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
  return s.slice(0, 10); // 최후 fallback
}

// ★ savedAt(날짜+시간) 정규화 — Date 객체 또는 임의 문자열 → 'yyyy-MM-dd HH:mm:ss'
function _normalizeDatetime(raw) {
  if (!raw) return '';
  if (raw instanceof Date) return Utilities.formatDate(raw, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  var s = raw.toString().trim();
  // 이미 yyyy-MM-dd HH:mm:ss 형식
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  // 'Thu Apr 02 2026 04:31:48 GMT+0900 ...' 형식 등 → new Date() 파싱
  try {
    var d = new Date(s);
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  } catch(e) {}
  return s; // 최후 fallback — 원본 반환
}
function jsonOk(extra) {
  return ContentService.createTextOutput(JSON.stringify(Object.assign({ status: 'ok' }, extra || {})))
    .setMimeType(ContentService.MimeType.JSON);
}
function jsonError(msg, extra) {
  return ContentService.createTextOutput(JSON.stringify(Object.assign({ status: 'error', message: msg }, extra || {})))
    .setMimeType(ContentService.MimeType.JSON);
}
// 네이버 증권에서 배당 데이터 스크래핑
// 사용법: =GET_KR_DIVIDEND("005930", 0) → 가장 최근 연도 배당금
//         =GET_KR_DIVIDEND("005930", 1) → 1년 전 배당금

function GET_KR_DIVIDEND(code, yearOffset) {
  try {
    var url = 'https://finance.naver.com/item/main.naver?code=' + code;
    var options = {
      method: 'get',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://finance.naver.com',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      },
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(url, options);
    var html = response.getContentText('euc-kr');

    var divIdx = html.indexOf('주당배당금');
    if (divIdx === -1) return 'N/A';

    var section = html.substring(divIdx, divIdx + 1000);

    var matches = [];
    var re = /<td[^>]*class="[^"]*num[^"]*"[^>]*>\s*([\d,]+|-)\s*<\/td>/g;
    var m;
    while ((m = re.exec(section)) !== null) {
      var val = m[1].replace(/,/g, '');
      matches.push(val === '-' ? 0 : parseInt(val) || 0);
    }

    if (matches.length === 0) {
      var re2 = />\s*([\d,]+)\s*</g;
      var section2 = html.substring(divIdx, divIdx + 500);
      while ((m = re2.exec(section2)) !== null) {
        var v = m[1].replace(/,/g, '');
        if (v.length > 0 && v.length <= 6) {
          matches.push(parseInt(v) || 0);
        }
      }
    }

    if (matches.length === 0) return 'N/A';

    var offset = yearOffset || 0;
    if (offset >= matches.length) return 'N/A';
    return matches[offset];

  } catch(e) {
    return 'N/A';
  }
}
