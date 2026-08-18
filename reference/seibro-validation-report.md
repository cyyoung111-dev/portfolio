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
