Warning: truncated output (original token count: 94588)
Total output lines: 7414

// ════════════════════════════════════════════════════════════════════
//  📊 포트폴리오 대시보드 — Google Apps Script  v9.107
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
    requestAuthenticationEnabled: !!(PropertiesService.getScriptProperties().getProperty('access_token') || '').trim()
  };
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
  if (params.action === 'getFundUnits') return handleGetFundUnits();
  if (params.action === 'diagnoseEtfDividends') return handleDiagnoseEtfDividends(params.from || '', params.to || '', params.raw || '');
  if (params.action === 'name'           && params.code)  return handleNameLookup(params.code, _getPublicDataApiKey());
  if (params.action === 'getHistory')                     return handleGetHistory(params.from || '', params.to || '');
  if (params.action === 'getHistoryDetail')               return handleGetHistoryDetail(params.date || '');
  if (params.action === 'getSnapshotRepairStatus')        return handleGetSnapshotRepairStatus();
  if (params.action === 'getCodeList')                    return handleGetCodeList();
  if (params.action === 'getBootstrap')                   return handleGetBootstrap();
  if (params.action === 'getPriceHistory')                return handleGetPriceHistory(params.from || '', params.to || '', params.codes || '');
  if (params.action === 'getBenchmark')                   return handleGetBenchmark(params.benchmark || '', params.from || '', params.to || '');
  if (params.action === 'getBenchmarks')                  return handleGetBenchmarks(params.benchmarks || '', params.from || '', params.to || '');
  if (params.action === 'saveManualPrice')                return handleSaveManualPrice(params.date || '', params.name || '', params.price || '0', params.keepLatest || '');
  if (params.action === 'getPrices'      && params.codes) return handleGetPricesCompat(params.codes);
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
      params.action === 'repairSnapshots' || params.action === 'startSnapshotRepair' ||
      params.action === 'continueSnapshotRepair' || params.action === 'refreshEtfDividends' ||
      params.action === 'previewFundNavImport' || params.action === 'importFundNav') {
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
  var readActions = ['diagnoseEtfDividends', 'name', 'getHistory', 'getHistoryDetail', 'getSnapshotRepairStatus', 'getCodeList', 'getBootstrap', 'getPriceHistory', 'getBenchmark', 'getBenchmarks', 'getPrices', 'dividend', 'dividendPublic', 'getSettings', 'getDividendSettings', 'getRealEstateSettings', 'getTrades', 'getHoldings'];
  if (readActions.indexOf(params.action) !== -1) return doGet({ parameter: params });
  if (params.action === 'syncCodes'    && params.codes) return handleSyncCodes(params.codes);
  if (params.action === 'saveSnapshot')                 return handleSaveSnapshot(params.date || '', params.data || '');
  if (params.action === 'syncHoldings' && params.data)  return handleSyncHoldings(params.data);
  if (params.action === 'syncTrades'           && params.data) return handleSyncTrades(params.data);
  if (params.action === 'saveSettings'         && params.data) return handleSaveSettings(params.data);
  if (params.action === 'saveDividendSettings' && params.data) return handleSaveDividendSettings(params.data);
  if (params.action === 'refreshEtfDividends') return handleRefreshEtfDividends(params.force || '');
  if (params.action === 'saveRealEstateSettings' && params.data) return handleSaveRealEstateSettings(params.data);
  if (params.action === 'saveSyncIssues' && params.data) return handleSaveSyncIssues(params.source || '', params.data);
  if (params.action === 'savePublicDataApiKey') return handleSavePublicDataApiKey(params.key || '');
  if (params.action === 'startSnapshotRepair') return handleStartSnapshotRepair();
  if (params.action === 'continueSnapshotRepair') return handleContinueSnapshotRepair();
  if (params.action === 'saveKrxAuthKey') return handleSaveKrxAuthKey(params.key || '');
  if (params.action === 'repairSnapshots' && params.data) return handleRepairSnapshots(params.data);
  // ★ [최적화] 배치 수동가격 저장 — 건당 개별 요청 → 1회 일괄 처리
  if (params.action === 'batchSaveManualPrices' && params.data) return handleBatchSaveManualPrices(params.date || '', params.data);
  return jsonError('알 수 없는 action: ' + (params.action || '없음'));
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

function _tossAccessToken_() {
  var cached = CacheService.getScriptCache().get(TOSS_TOKEN_CACHE_KEY);
  if (cached) {
    try {
      var token = JSON.parse(cached);
      if (token.accessToken && Number(token.expiresAt) > Date.now() + TOSS_TOKEN_SKEW_SECONDS * 1000) return token.accessToken;
    } catch (e) {}
  }
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

function _tossSafeError_(body) {
  try { var parsed = JSON.parse(body); return String(parsed.error?.code || parsed.error || parsed.error_description || 'unknown'); } catch (e) { return 'invalid-response'; }
}

function _tossRequest_(path, query, group) {
  var token = _tossAccessToken_();
  if (!token) return null;
  var params = [];
  Object.keys(query || {}).forEach(function(key) { if (query[key] !== '' && query[key] != null) params.push(encodeURIComponent(key) + '=' + encodeURIComponent(query[key])); });
  var url = TOSS_API_BASE + path + (params.length ? '?' + params.join('&') : '');
  var maxAttempts = 4;
  for (var attempt = 0; attempt < maxAttempts; attempt++) {
    var response = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, muteHttpExceptions: true });
    var status = response.getResponseCode();
    if (status >= 200 && status < 300) return JSON.parse(response.getContentText() || '{}');
    var headers = response.getAllHeaders ? response.getAllHeaders() : {};
    var retryAfter = Number(headers['Retry-After'] || headers['retry-after'] || 0);
    if (status !== 429 && status < 500) throw new Error('Toss API 실패(' + status + '): ' + _tossSafeError_(response.getContentText() || ''));
    if (attempt === maxAttempts - 1) throw new Error('Toss API 재시도 초과(' + status + ')');
    var waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(4000, 250 * Math.pow(2, attempt)) + Math.floor(Math.random() * 250);
    Utilities.sleep(waitMs);
  }
  return null;
}

function _tossSymbol_(item) { return String(item.tossSymbol || item.code || '').trim(); }

function fetchPricesToss(items) {
  var symbols = (items || []).map(_tossSymbol_).filter(Boolean);
  if (!symbols.length || symbols.length > 200 || !_tossProperties_().id) return {};
  var payload = _tossRequest_('/api/v1/prices', { symbols: symbols.join(',') }, 'MARKET_DATA');
  var rows = payload && Array.isArray(payload.result) ? payload.result : [];
  var prices = {};
  rows.forEach(function(row) {
    var price = Number(row.lastPrice);
    if (!row.symbol || !Number.isFinite(price) || price <= 0 || !row.currency) return;
    prices[String(row.symbol)] = { price: price, currency: String(row.currency), timestamp: row.timestamp || null, source: 'TOSS', priceType: 'REGULAR_CLOSE', status: 'CONFIRMED', fetchedAt: new Date().toISOString() };
  });
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
        output[item.code] = { price: Number(found.closePrice), usedDate: targetDate, marketDate: targetDate, market: item.market || (String(found.currency) === 'USD' ? 'US' : 'KR'), currency: String(found.currency || item.currency || 'KRW'), source: 'TOSS', priceType: 'REGULAR_CLOSE', status: 'CONFIRMED', fetchedAt: new Date().toISOString() };
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
        if (code && price > 0) prices[code] = { price: price, na…64588 tokens truncated…═
function writeSnapshotRows(ss, dateStr, newRows, overwrite, manualKeys) {
  var writeLock = LockService.getScriptLock();
  var ownsWriteLock = false;
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

    if (!sh) {
      sh = ss.insertSheet(CONFIG.SHEET_SNAPSHOT);
      sh.getRange(1,1,1,colSize).setValues(header);
      sh.getRange(1,1,1,colSize).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
      if (newRows.length > 0) sh.getRange(2, 1, newRows.length, colSize).setValues(newRows);
      return;
    }

    if (sh.getLastRow() > 1) {
      var existing = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(12, sh.getLastColumn())).getValues().map(toNewSnapshotRow);
      var kept     = existing.filter(function(r){ return _normalizeDate(r[0]) !== normDate; });
      var sameDate = existing.filter(function(r){ return _normalizeDate(r[0]) === normDate; });
      if (!newRows.length) return;
      // ★ [버그수정] overwrite=false 시 판단 기준 변경
      //   기존: 해당 날짜 행이 하나라도 있으면 전체 skip → 일부 종목만 있어도 나머지 미기록
      //   수정: newRows 의 종목 중 이미 기록된 종목만 제외하고, 없는 종목은 추가
      if (!overwrite && kept.length < existing.length) {
        // 이미 해당 날짜 데이터가 일부라도 있는 경우:
        // newRows 중 아직 없는 종목(코드)만 걸러서 추가
        var existingKeys = {};
        existing.forEach(function(r) {
          var d = _normalizeDate(r[0]);
          if (d !== normDate) return;
          var k = _cleanCode(r[1]) || (r[2] || '').toString().trim();
          if (k) existingKeys[d + '|' + k] = true;
        });
        var toAdd = newRows.filter(function(r) {
          var k = _cleanCode(r[1]) || (r[2] || '').toString().trim();
          return k && !existingKeys[normDate + '|' + k];
        });
        if (toAdd.length === 0) return; // 추가할 신규 종목 없음 → skip
        newRows = toAdd; // 없는 종목만 추가
      }
      var mergedDate = _mergeSnapshotRowsSafely(sameDate, newRows, overwrite, manualKeys);
      if (_snapshotRowsSignature(mergedDate) === _snapshotRowsSignature(sameDate)) return;
      var combined = kept.concat(mergedDate);
      if (JSON.stringify(combined) === JSON.stringify(existing)) return;
      _backupSnapshotBeforeWrite(ss, sh);
      // 먼저 비우면 쓰기 실패 때 모든 날짜가 사라집니다. 한 번의 쓰기로 교체합니다.
      var output = header.concat(combined);
      while (output.length < sh.getLastRow()) output.push(Array(colSize).fill(''));
      if (sh.getMaxRows() < output.length) sh.insertRowsAfter(sh.getMaxRows(), output.length - sh.getMaxRows());
      sh.getRange(1, 1, output.length, colSize).setValues(output);
    } else {
      if (newRows.length > 0) sh.getRange(sh.getLastRow() + 1, 1, newRows.length, colSize).setValues(newRows);
    }
  } catch(err) {
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

var _snapshotBackupMade = false;
function _backupSnapshotBeforeWrite(ss, sheet) {
  if (_snapshotBackupMade) return;
  var name = '스냅샷_백업_' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss') + '_' + Utilities.getUuid().slice(0, 6);
  sheet.copyTo(ss).setName(name);
  _snapshotBackupMade = true;
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

  ph.clearContents();
  ph.getRange(1, 1, 1, 6).setValues(header);
  ph.getRange(1, 1, 1, 6).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
  if (deduped.length > 0) ph.getRange(2, 1, deduped.length, 6).setValues(deduped);
  try { SpreadsheetApp.getUi().alert('가격이력 중복 정리 완료: ' + removed + '행 삭제'); } catch(e) { Logger.log('가격이력 중복 정리 완료: ' + removed + '행 삭제'); }
}

function cleanupSnapshotDuplicates() {
  var ss = getss();
  var sh = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
  // ★ [버그수정] getUi()를 try/catch로 감싸 웹앱/트리거 환경에서의 crash 방지
  var _alert = function(msg) {
    try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log(msg); }
  };
  if (!sh || sh.getLastRow() < 2) {
    _alert('스냅샷 데이터가 없습니다.');
    return;
  }

  var colSize = 12;
  var header = [['날짜','종목코드','종목명','수량','매수단가','매수원금','평가단가','평가금액','손익','수익률(%)','평가단가소스','저장일시']];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(colSize, sh.getLastColumn())).getValues();
  var deduped = _dedupeSnapshotRows(rows);
  var removed = rows.length - deduped.length;

  if (removed <= 0) {
    _alert('중복 스냅샷이 없습니다.');
    return;
  }

  sh.clearContents();
  sh.getRange(1,1,1,colSize).setValues(header);
  sh.getRange(1,1,1,colSize).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
  sh.getRange(2, 1, deduped.length, colSize).setValues(deduped);
  _alert('중복 정리 완료: ' + removed + '행 삭제');
}

// ════════════════════════════════════════════════════════════════════
//  종목코드 정제
// ════════════════════════════════════════════════════════════════════
function _cleanCode(raw) {
  var s = (raw || '').toString().trim().toUpperCase();
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
    return jsonOk({ settings: settings, gasVersion: '9.107' });
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
      gasVersion: '9.107'
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
    if (!cs) {
      cs = ss.insertSheet(CONFIG.SHEET_CODES);
      cs.getRange(1,1,1,6).setValues([['종목코드','종목명','유형','섹터','통화','시장']]);
    } else if (cs.getLastColumn() < 4) {
      cs.getRange(1,1,1,6).setValues([['종목코드','종목명','유형','섹터','통화','시장']]);
    } else if (cs.getLastColumn() < 5) {
      cs.getRange(1,5,1,1).setValues([['통화']]);
    }
    if (cs.getLastColumn() < 6) cs.getRange(1,6,1,1).setValues([['시장']]);

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

    if (synced > 0 || updated > 0) SpreadsheetApp.flush();
    return jsonOk({ synced: synced, updated: updated, total: Object.keys(existingByCode).length });
  } catch(err) {
    return jsonError('syncCodes 실패: ' + err.message);
  }
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

  if (toDelete.length > 0) SpreadsheetApp.flush();

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
    [CONFIG.SHEET_TRADES, ['날짜','매수/매도','계좌','종목명','종목코드','수량','단가','자산유형','메모'], [100,80,100,180,90,70,100,90,200]],
    [CONFIG.SHEET_ETF_DIVIDENDS, ['종목코드','ISIN','종목명','기준일','지급일','주당분배금','수집일시','원본소스'], [90,130,200,100,100,100,170,100]],
    [CONFIG.SHEET_SYNC_LOG, ['기록시각','소스','거래일','종목코드','종목명','계좌','메시지'], [160,100,100,90,180,120,300]],
    [CONFIG.SHEET_SETTINGS, ['키','값'], [180,600]]
  ];
  var created = 0;
  specs.forEach(function(spec) {
    var sh = ss.getSheetByName(spec[0]);
    if (!sh) { sh = ss.insertSheet(spec[0]); created++; }
    sh.getRange(1, 1, 1, spec[1].length).setValues([spec[1]])
      .setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
    sh.setFrozenRows(1);
    spec[2].forEach(function(width, idx) { sh.setColumnWidth(idx + 1, width); });
  });
  SpreadsheetApp.flush();

  try {
    SpreadsheetApp.getUi().alert(
      '✅ 시트 구성 확인 완료\n\n' +
      '- 새로 생성한 시트: ' + created + '개\n' +
      '- 기존 데이터는 삭제하지 않았습니다.\n\n' +
      '다음 단계: [📊 포트폴리오] → [⚙️ 설정] → [자동 트리거 등록]'
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
    '제목행(1행)은 유지하고 2행 이하 데이터만 모두 삭제합니다.\n계속할까요?',
    ui.ButtonSet.YES_NO
  );
  if (ans !== ui.Button.YES) return;

  var deleted = 0;
  var ph = ss.getSheetByName(CONFIG.SHEET_PH) || ss.insertSheet(CONFIG.SHEET_PH);
  if (ph.getLastRow() === 0) ph.getRange(1,1,1,6).setValues([['날짜','종목코드','종목명','가격','입력일시','가격소스']]);
  if (ph.getLastRow() > 1) {
    deleted += ph.getLastRow() - 1;
    ph.getRange(2, 1, ph.getLastRow() - 1, Math.max(1, ph.getLastColumn())).clearContent();
  }

  var snap = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT) || ss.insertSheet(CONFIG.SHEET_SNAPSHOT);
  if (snap.getLastRow() === 0) snap.getRange(1,1,1,12).setValues([['날짜','종목코드','종목명','수량','매수단가','매수원금','평가단가','평가금액','손익','수익률(%)','평가단가소스','저장일시']]);
  if (snap.getLastRow() > 1) {
    deleted += snap.getLastRow() - 1;
    snap.getRange(2, 1, snap.getLastRow() - 1, Math.max(1, snap.getLastColumn())).clearContent();
  }
  var msg = '✅ 삭제 완료 (총 ' + deleted + '행)';
  Logger.log(msg);
  ui.alert(msg);
}
// ════════════════════════════════════════════════════════════════════
//  메뉴
// ════════════════════════════════════════════════════════════════════
function onInstall(e) {
  onOpen(e);
}

function _addFallbackMenu(ui) {
  ui.createMenu('📊 포트폴리오')
    .addItem('연결 스프레드시트 설정', 'configureSpreadsheetIdPrompt')
    .addItem('공공데이터 API 인증키 설정', 'configurePublicDataApiKeyPrompt')
    .addItem('KRX 인증키 설정', 'configureKrxAuthKeyPrompt')
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
    var manualKeepLabel = '🧷 수동가격 날짜별 이력 보존: ON';

    var priceSourceLabel = '⚙️ 가격소스: 현재 설정 확인';
    try { priceSourceLabel = _priceSourceModeLabel(); }
    catch(e2) { Logger.log('가격소스 메뉴 라벨 생성 실패: ' + e2.message); }

    // ── 서브메뉴: 초기 설정 ──
    var menuInit = ui.createMenu('⚙️ 설정')
      .addItem('🔗 연결 스프레드시트 설정', 'configureSpreadsheetIdPrompt')
      .addItem('시트 구성 확인·복구', 'initSheet')
      .addItem('자동 트리거 등록·복구', 'setupTrigger')
      .addSeparator()
      .addItem('🔑 공공데이터 API 인증키 설정', 'configurePublicDataApiKeyPrompt')
      .addItem('🔑 KRX 인증키 설정', 'configureKrxAuthKeyPrompt')
      .addItem('ℹ️ API 인증키 저장 상태', 'showApiKeyStatus')
      .addSeparator()
      .addItem('🛡️ 요청 접근 토큰 설정·해제', 'configureAccessTokenPrompt')
      .addItem('🔐 레거시 API 키 안전 이전', 'migrateLegacyApiKeysPrompt');

    // ── 서브메뉴: 종가 관리 ──
    var menuPrice = ui.createMenu('📈 종가 관리')
      .addItem('🔄 오늘 종가 갱신', 'updatePrices')
      .addItem('🗓️ KRX 기간 불러오기', 'importKrxClosesPrompt')
      .addSeparator()
      .addItem(priceSourceLabel, 'togglePriceSourceMode')
      .addItem(manualKeepLabel, 'toggleManualKeepLatestOption');

    // ── 서브메뉴: 소급채우기 ──
    var menuBackfill = ui.createMenu('📆 소급채우기')
      .addItem('▶️ 소급채우기 시작', 'backfillRangePrompt')
      .addItem('⏩ 이어서 실행', 'backfillResume')
      .addItem('📊 진행상황 확인', 'backfillStatus');

    // ── 서브메뉴: 유지보수 ──
    var menuMaint = ui.createMenu('🛠️ 유지보수')
      .addItem('🔎 자동화 상태 점검', 'checkDailyAutomationStatus')
      .addItem('▶️ 확정 평가단가·스냅샷 지금 갱신', 'runDailyPriceSnapshotNow')
      .addItem('📸 전체 가격이력·스냅샷 정합성 복구', 'runSnapshotConsistencyRepair')
      .addItem('📊 전체 스냅샷 복구 진행상황', 'showSnapshotConsistencyRepairStatus')
      .addItem('🧾 SEIBro ETF 읽기 전용 진단', 'runEtfDividendDiagnosis')
      .addItem('🧮 SEIBro ETF 2단계 드라이런', 'runEtfDividendDryRun')
      .addItem('💾 SEIBro ETF 3단계 운영 반영', 'runEtfDividendApply')
      .addItem('🩺 가격 이상치 점검 및 복구', 'detectPriceAnomalyPromptAndMaybeRepair')
      .addItem('🧹 데이터 정리 (코드·종목명·중복)', 'runDataCleanup')
      .addItem('🩺 메뉴 생성 오류 확인', 'showMenuBuildError')
      .addItem('🗑️ 가격이력·스냅샷 초기화', 'clearPriceAndSnapshotRows');

    // ── 메인 메뉴 조합 ──
    ui.createMenu('📊 포트폴리오')
      .addSubMenu(menuInit)
      .addSeparator()
      .addSubMenu(menuPrice)
      .addSeparator()
      .addSubMenu(menuBackfill)
      .addSeparator()
      .addSubMenu(menuMaint)
      .addToUi();

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

    // 4) 스냅샷 중복 정리
    cleanupSnapshotDuplicates();
    Logger.log('[runDataCleanup] 스냅샷 중복 정리 완료');

    // 5) 구버전 또는 만료된 조회용 임시 시트 정리
    _cleanupBenchmarkTempSheets();
    Logger.log('[runDataCleanup] 임시 시트 정리 완료');

    var msg = '✅ 데이터 정리 완료\n- 죽은 코드 정리\n- 가격이력 종목명 보정\n- 가격이력 중복 제거\n- 스냅샷 중복 제거\n- 임시 시트 정리';
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

