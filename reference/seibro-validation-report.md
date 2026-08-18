# SEIBro ETF 분배금 요청 검증 보고서

- 검증일: 2026-08-18 (UTC)
- 기준 브랜치/커밋: `main` / `afd5ee5041f5b67183a70b9b3a74e987bf3b391c`
- HAR: `reference/seibro.or.kr.har.txt` (현재 작업환경에서 존재 확인)

## 최신 `main` 동기화 결과

`origin`을 `https://github.com/cyyoung111-dev/portfolio.git`로 설정하고 `git fetch origin main`을 실행했으나, 실행환경의 CONNECT 프록시가 HTTP 403을 반환했다. 따라서 GitHub 원격 상태를 새로 조회하지 못했다. 작업환경의 `.git/FETCH_HEAD`가 가리키는 `main` 커밋과 현재 `HEAD`는 모두 `afd5ee5041f5b67183a70b9b3a74e987bf3b391c`로 일치한다.

## HAR에서 확인한 실제 요청

두 요청 모두 아래 URL을 사용한다.

```text
POST https://seibro.or.kr/websquare/engine/proworks/callServletService.jsp
Content-Type: application/xml; charset="UTF-8"
```

### 1. `searchEtfContentList`

```xml
<reqParam action="searchEtfContentList" task="ksd.safe.bip.cmuc.User.process.SearchPTask"><search_string value="458730"/></reqParam>
```

HAR에 저장된 HTTP 200 XML 응답은 `458730`을 다음 값으로 매핑한다.

| 종목코드 | ISIN | 발행회사 고객번호 | 종목명 | HAR XML 검증 |
|---|---|---|---|---|
| `458730` | `KR7458730009` | `255479` | `미래에셋TIGER미국배당다우존스증권상장지수투자신탁(주식)` | 성공 (`vector result="1"`, `result` 1건) |

### 2. `exerInfoDtramtPayStatPlist`

```xml
<reqParam action="exerInfoDtramtPayStatPlist" task="ksd.safe.bip.cnts.etf.process.EtfExerInfoPTask"><MENU_NO value="179"/><CMM_BTN_ABBR_NM value="total_search,openall,print,hwp,word,pdf,searchIcon,searchIcon,seach,searchIcon,seach,"/><W2XPATH value="/IPORTAL/user/etf/BIP_CNTS06030V.xml"/><etf_sort_level_cd value="0"/><etf_big_sort_cd value=""/><START_PAGE value="1"/><END_PAGE value="30"/><etf_sort_cd value=""/><isin value="KR7458730009"/><mngco_custno value=""/><RGT_RSN_DTAIL_SORT_CD value=""/><fromRGT_STD_DT value="20250815"/><toRGT_STD_DT value="20260814"/></reqParam>
```

HAR에 저장된 HTTP 200 XML 응답은 `vector result="12"`이며, 별도의 `exerInfoDtramtPayStatPlistCnt` 응답도 `LIST_CNT value="12"`로 일치한다. 첫 행은 기준일 `20260731`, 지급개시일 `20260804`, 주당분배금에 해당하는 `ESTM_STDPRC value="37"`를 포함한다.

## 단일 종목 재현 결과

| 종목코드 | 검색 매핑 | 분배금 요청 | 최종 상태 | 원인 |
|---|---|---|---|---|
| `458730` | HAR 응답 검증 성공 | HAR 응답 검증 성공 | `REQUEST_ERROR` | 동일 URL에 HAR의 method, headers, XML body를 사용해 `curl`로 재요청했으나 CONNECT 프록시가 HTTP 403을 반환하여 SEIBro 서버의 현재 XML 응답까지 도달하지 못함 |

실행한 재현 명령의 오류 원문은 다음과 같다.

```text
curl: (56) CONNECT tunnel failed, response 403
HTTP/1.1 403 Forbidden
server: envoy
```

이 결과는 SEIBro 애플리케이션이 반환한 HTTP 상태가 아니라, 실행환경의 외부 연결 프록시가 반환한 상태다. 따라서 HAR에 저장된 응답의 구조는 검증했지만 현재 시점의 실제 요청 재현은 성공으로 판정할 수 없다.

## 18개 ETF 전체 검증 및 운영 반영 판단

선행 조건인 `458730` 실제 요청 재현에서 `REQUEST_ERROR`가 발생했으므로 18개 ETF 전체 검증은 진행하지 않았다. 또한 현재 저장소와 HAR만으로는 검증 대상 18개 종목코드 목록도 확인할 수 없다. 확인되지 않은 목록을 추측해 표를 만들지 않는다.

요청된 중단 조건에 따라 다음 운영 변경은 **반영하지 않았다**.

- `ETF분배금이력` 시트 생성 및 저장
- 증분 업데이트
- TTM 계산
- 배당 탭 연동

외부 연결이 허용된 환경에서 `458730` 재현을 먼저 통과시키고, 실제 18개 ETF 종목코드 목록을 확인한 뒤 전체 결과표에서 `NOT_FOUND`, `REQUEST_ERROR`, `PARSE_ERROR`, `MAPPING_ERROR`가 모두 0건일 때만 구현을 진행해야 한다. 종목코드는 검증과 후속 구현 전 과정에서 문자열로 유지해 `0046Y0`, `0080G0`의 영문과 leading zero를 보존해야 한다.

## 재검증 명령

HAR에 저장된 `458730` 응답의 파싱·매핑 검증은 다음 명령으로 반복할 수 있다.

```bash
npm run check:seibro-har
```

외부 연결이 허용된 환경에서는 다음 명령으로 HAR에서 추출한 실제 endpoint와 요청 형식을 사용해 단일 종목을 재현한다.

```bash
node scripts/validate-seibro-etf.mjs --codes 458730
```

검증 대상 18개 종목코드를 확인한 뒤에는 문자열을 쉼표로 구분해 전체 결과표를 출력할 수 있다. `OK` 이외의 상태가 하나라도 있으면 명령은 종료 코드 1을 반환한다.

```bash
node scripts/validate-seibro-etf.mjs --codes '458730,0046Y0,0080G0,...'
```

## 운영 반영 전 확인 체크리스트

현재 확인된 자료만으로 운영 반영 완료를 판정하려면 다음 항목이 더 필요하다.

1. **실제 통신 성공**: 외부 연결이 가능한 환경에서 `458730`의 검색 요청과 분배금 요청이 모두 HTTP 200 XML을 반환해야 한다. 현재 실행환경에서는 `REQUEST_ERROR`이므로 미확인 상태다.
2. **대상 코드 동적 확정**: 사용자가 제공한 운영 화면에서는 ETF 코드 18개를 확인했다. 그러나 18이라는 수를 설정에 고정하지 않고 GAS `보유현황` 시트에서 `자산유형 === 'ETF'`, 유효 코드, 보유수량 조건으로 실행 시점마다 추출하고 코드로 중복 제거해야 한다. 따라서 현재 보유 ETF만 대상으로 한다면 사용자가 목록을 별도로 계속 제공할 필요가 없다.
3. **동적 대상 전체 결과 성공**: 실행 시점에 GAS에서 추출한 문자열 코드 전체에 대해 검색 코드→ISIN 매핑과 ISIN→분배금 응답을 검증해야 한다. 현재는 18개지만 종목이 추가되면 자동으로 검증 대상도 늘어나야 하며, `NOT_FOUND`, `REQUEST_ERROR`, `PARSE_ERROR`, `MAPPING_ERROR`가 모두 0건이어야 한다.
4. **SEIBro 필드 의미 확인**: HAR에서 `RGT_STD_DT`, `TH1_PAY_TERM_BEGIN_DT`, `ESTM_STDPRC` 값은 확인했지만, 운영 계산에서 각각 기준일·지급일·주당분배금으로 사용할 수 있다는 공식 필드 정의는 현재 자료에서 확인되지 않았다. SEIBro 화면 표제 또는 공식 설명과 대조가 필요하다.
5. **TTM 계산 기준 확정**: TTM 포함 범위를 어느 날짜 필드로 판단할지, 시작일/종료일을 포함할지, 같은 날 정정·중복 행을 어떻게 처리할지 결정해야 한다. 현재 웹 배당 계산은 `events[].date`를 보유수량 기준일로 사용하고 `payDate`가 있으면 현금흐름 월로 사용하므로 새 이력도 이 계약과 일치해야 한다.
6. **증분 갱신 키와 정정 정책 확정**: 최소한 종목코드·ISIN·기준일·지급일을 이용한 행 식별 규칙, 이미 저장된 금액이 SEIBro에서 정정됐을 때 갱신할지, 조회 기간을 얼마나 겹쳐 재조회할지 결정해야 한다.
7. **시트 스키마와 보존 정책 확정**: `ETF분배금이력`의 열 순서, 날짜/금액 형식, 원문 필드 보존 범위, 최초 소급 기간, 삭제·정정 이력 보존 여부가 필요하다. 현재 GAS `CONFIG`에는 이 시트가 정의되어 있지 않고 배당 데이터는 `설정` 시트의 `DIVDATA` 객체로 저장된다.
8. **배당 탭 연결 규칙 확정**: 이력에서 만들 `events`는 최소 `date`, `payDate`, `amount`, `source`를 제공해야 한다. 종목코드를 `DIVDATA` 키로 사용할 때 `EDITABLE_PRICES`의 코드→이름 역매핑이 성공하는지도 18개 전부 확인해야 한다.
9. **실패 시 무변경 보장**: 동적으로 추출한 대상 중 하나라도 실패하면 시트와 `DIVDATA`를 부분 갱신하지 않도록 검증 완료 후 한 번에 쓰는 흐름과 Script Lock 적용 여부를 확인해야 한다. 기존 수동 입력(`source === 'MANUAL'`)과 이전 정상값은 덮어쓰지 않아야 한다.
10. **운영 배포 확인**: GAS 변경 시 버전 네 곳, 당일 변경 이력, `DEPLOYMENT.md`를 함께 갱신하고 새 웹앱 배포 후 `getSettings().gasVersion`과 프론트의 `EXPECTED_GAS_VERSION` 일치를 확인해야 한다.

위 항목 중 1~4는 데이터 자체의 정확성을 확인하기 위한 선행 조건이다. 5~10은 정확한 데이터를 운영 시트와 현재 배당 계산 계약에 안전하게 연결하기 위한 구현 조건이다.

### 운영 화면에서 확인한 현재 ETF 코드

사용자가 제공한 운영 화면의 ETF 행을 종목코드 기준으로 중복 제거하면 다음 18개다.

```text
379810, 091160, 091170, 292150, 441800, 091180,
133690, 487240, 157500, 139220, 458730, 0046Y0,
305720, 466920, 0080G0, 228790, 307520, 232080
```

이 목록은 초기 검증 대상 스냅샷일 뿐 운영 상수가 아니다. 기존 GAS의 `보유현황`은 종목코드, 종목명, 수량, 자산유형, 계좌를 반환하므로 현재 보유 ETF 목록을 GAS 내부에서 만들 수 있다. 계좌별로 같은 ETF가 반복되므로 코드 기준 중복 제거가 필요하며, `0046Y0`, `0080G0`는 숫자로 변환하지 않고 문자열로 유지해야 한다.

현재 보유수량이 0이 된 과거 ETF도 TTM 이력에 포함하는 것으로 운영 정책을 확정했다. 따라서 대상 코드는 다음 두 집합의 합집합으로 만든다.

1. `보유현황`에서 자산유형이 ETF이고 코드별 합산수량이 0보다 큰 종목
2. `거래이력`에서 TTM 조회 시작일 이후 거래가 존재하고 자산유형이 ETF인 종목

두 집합은 정제한 문자열 종목코드를 키로 중복 제거한다. 이 방식이면 현재 보유수량이 0인 전량 매도 ETF도 TTM 기간에 거래가 있으면 이력 관리 대상에 남고, 새 ETF가 추가되면 별도 목록 수정 없이 자동으로 대상에 포함된다. TTM 조회 시작일보다 이전에 마지막 거래가 있고 기간 내 보유 또는 배당이 이어진 종목을 놓치지 않으려면 거래 행만 날짜로 자르지 말고 TTM 시작일의 보유수량을 거래이력으로 재구성해 시작일 보유 종목도 포함해야 한다.

## 적용 순서 결정

문제 발견 속도를 높이기 위해 구현 자체는 검증과 병행할 수 있지만, 검증되지 않은 결과를 운영 데이터에 쓰는 방식으로 먼저 적용하지는 않는다. 다음 단계로 나눈다.

1. **읽기 전용 진단 단계**: GAS에서 보유현황과 거래이력으로 동적 ETF 대상을 만들고, SEIBro 원문 XML·매핑·파싱 결과·오류 상태를 반환하되 `ETF분배금이력`과 `DIVDATA`에는 쓰지 않는다.
2. **드라이런 단계**: 증분 병합 결과와 TTM 계산 결과를 메모리에서 만들고 기존 배당 탭 결과와 비교표를 반환하되 시트 저장은 하지 않는다.
3. **원자적 저장 단계**: 동적 대상 전체가 `OK`일 때만 Script Lock 안에서 `ETF분배금이력`과 `DIVDATA`를 함께 갱신한다. 한 종목이라도 실패하면 둘 다 변경하지 않는다.
4. **운영 활성화 단계**: 실제 응답 필드 의미와 전체 결과표를 확인한 뒤 자동 트리거와 배당 탭 기본 소스로 활성화한다.

이 순서라면 코드·파싱·TTM 연결 문제는 일찍 찾을 수 있으면서도 현재 운영 배당 데이터가 부분 결과나 잘못 해석한 필드로 오염되는 것을 막을 수 있다. 현재 확인된 `REQUEST_ERROR`가 해소되기 전에는 1~2단계까지만 실행할 수 있고, 3~4단계 운영 쓰기는 활성화하지 않는다.

### 1단계 실행 방법

GAS v9.58을 새 버전으로 배포하고 스프레드시트를 새로고침한 뒤 다음 메뉴만 누르면 된다.

```text
📊 포트폴리오 → 🛠️ 유지보수 → 🧾 SEIBro ETF 읽기 전용 진단
```

첫 안내창에서 `확인`을 누르고 조회가 끝난 뒤 나타나는 결과창을 확인한다. 결과창의 `조회 대상`, `정상`, 네 오류 상태 숫자와 `확인이 필요한 종목` 목록을 전달하면 된다. 실행 전후로 시트와 `DIVDATA`는 수정되지 않는다.

아래 URL 방식은 원문 XML이 필요한 상세 조사 때만 사용한다.

GAS 배포 URL에 다음 query를 붙여 실행한다.

```text
?action=diagnoseEtfDividends&raw=1
```

날짜 범위를 고정해서 재검증하려면 `from`, `to`를 `YYYY-MM-DD`로 지정한다.

```text
?action=diagnoseEtfDividends&from=2025-08-18&to=2026-08-18&raw=1
```

응답의 `readOnly`, `wroteSheets`, `wroteDivData`는 각각 `true`, `false`, `false`여야 한다. 사용자가 확인해 전달할 값은 다음과 같다.

1. 최상위 `status`, `targetCount`, `counts`
2. 각 `results[]`의 `code`, `portfolioName`, `reasons`, `status`, `isin`, `seibroName`, `paymentCount`
3. 오류 행이 있으면 해당 행의 `error`, `searchXml`, `paymentXml`
4. 성공 행 `458730`의 `firstRecordDate`, `firstPayDate`, `firstEstmStdprc`

이 진단은 `보유현황`과 `거래이력`을 읽고 SEIBro에 요청하지만 시트 생성·수정, `DIVDATA` 저장, 트리거 등록을 실행하지 않는다.

### 1단계 운영 실행 결과

2026-08-18 사용자가 GAS v9.58 스프레드시트 메뉴에서 읽기 전용 진단을 실행한 결과는 다음과 같다.

| 항목 | 결과 |
|---|---:|
| 조회 대상 | 18개 |
| 정상 | 18개 |
| `NOT_FOUND` | 0개 |
| `REQUEST_ERROR` | 0개 |
| `PARSE_ERROR` | 0개 |
| `MAPPING_ERROR` | 0개 |
| 시트 수정 | 없음 |
| `DIVDATA` 수정 | 없음 |

따라서 동적으로 선정된 현재 18개 ETF에 대한 실제 GAS→SEIBro 통신, 코드→ISIN 검색, 분배금 XML 파싱 및 검색/분배금 ISIN 매핑 검증은 모두 성공했다. 1단계 중단 조건에 해당하는 오류는 0건이다. 다음 단계는 운영 데이터를 쓰지 않는 2단계 드라이런으로, 전체 분배금 행의 증분 병합안과 TTM 계산안을 생성해 기존 `DIVDATA`와 비교하는 것이다.
