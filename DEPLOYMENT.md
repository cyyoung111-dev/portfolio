# Deployment Notes

## Canonical web root

- 운영/로컬 정적 서버의 canonical web root는 `src/web`입니다.
- 실제 앱 엔트리포인트는 `src/web/index.html`입니다.
- 루트 `index.html`은 과거 배포/북마크 호환용 포워딩 파일로만 유지합니다.

## 로컬 실행

```bash
npm run serve:web
```

기본 주소: `http://localhost:4173`

## 배포 전 검증

```bash
git diff --check
npm run check:web:ci
cp src/gas/apps_script.gs /tmp/apps_script.js && node --check /tmp/apps_script.js
```

`npm run check:web:ci`는 구조, manifest, JS syntax, 전역 함수명, DOM 계약, inline handler, 생성 HTML inline handler 검사를 한 번에 실행합니다.

## 운영 반영 체크리스트

### Web

- [ ] 정적 서버 document root가 `src/web`인지 확인
- [ ] `/` 요청이 `src/web/index.html`을 반환하는지 확인
- [ ] 배포 후 JS/CSS/icon/manifest 404가 없는지 확인
- [ ] 캐시 이슈가 있으면 브라우저 새로고침 또는 서비스워커 업데이트 확인

### Google Apps Script

`src/gas/apps_script.gs`가 바뀐 경우에는 저장소 커밋만으로 운영 GAS가 자동 갱신되지 않습니다.

- [ ] GAS 상단 버전/변경사항, `handleGetSettings()`의 `gasVersion`, 프론트 `EXPECTED_GAS_VERSION`을 함께 업데이트
- [ ] Apps Script 편집기에 `src/gas/apps_script.gs` 최신 내용을 반영
- [ ] 웹앱 새 버전 배포 또는 기존 배포 업데이트
- [ ] 앱의 구글시트 연동 화면에서 연결 상태 확인
- [ ] 현재가 업데이트, 현재가 편집 저장, 배당 조회 중 최소 1개 흐름을 확인

## 공공데이터포털 배당 연동

한국 주식 배당 자동 조회는 무료 공공데이터포털 API를 우선 사용하고, 조회 실패/누락 시 기존 `GOOGLEFINANCE` fallback을 사용합니다.

필요한 활용신청:

1. 금융위원회_KRX상장종목정보
2. 금융위원회_주식배당정보

앱에서 필요한 값:

- 공공데이터포털 인증키 1개
- 배당 탭의 `공공데이터포털 배당 API` 입력칸에 저장
- 앱에서 저장하면 GAS에도 동기화되어 다른 브라우저에서 설정을 복원할 수 있습니다.
- 스프레드시트 메뉴 `📊 포트폴리오 > 🔑 공공데이터 API 인증키 설정`에서 바로 저장할 수 있고, `🌐 공공데이터 API` 서브메뉴에서도 확인할 수 있습니다.
- Encoding 키/Decoding 키 모두 처리되도록 GAS에서 보정하지만, 포털에서 제공하는 Encoding 키 사용을 권장

동작 방식:

1. 종목코드로 KRX상장종목정보를 조회해 공식 종목명/법인번호를 찾습니다.
2. 법인번호 또는 공식 종목명으로 주식배당정보를 조회합니다.
3. 결과가 없으면 앱에 등록된 종목명으로 한 번 더 조회합니다.
4. 그래도 누락된 종목은 `GOOGLEFINANCE` 배당 조회로 fallback합니다.

## KRX 가격 API 연동

- KRX Open API AUTH_KEY는 구글시트 연동 탭에서 저장하면 GAS에도 동기화됩니다.
- 스프레드시트 메뉴 `📊 포트폴리오 > 📈 종가 관리 > 🔑 KRX 인증키 설정`에서도 입력할 수 있습니다.
- 이 키는 공공데이터포털 키와 별개이며, 가격소스를 KRX 우선으로 사용할 때 종가 조회에 사용됩니다.

## 종목코드/공식명 관리

- 신규 종목 추가 시 종목코드만 입력해도 공공데이터포털 키가 저장되어 있으면 공식 종목명 조회를 시도합니다.
- 이미 등록된 종목은 기초정보의 `KRX 공식명 반영` 버튼으로 기존 종목코드들을 공식명 기준으로 보정할 수 있습니다.
- 공식명 보정 시 거래이력, 보유현황, 배당 설정 키도 함께 이동되도록 처리되어 있습니다.

## 보존 중인 문서 정책

- 오래된 리뷰/임시 체크리스트 문서는 저장소에서 제거했습니다.
- 현재는 운영에 필요한 이 파일(`DEPLOYMENT.md`)만 Markdown 문서로 유지합니다.
- 배포 절차, GAS 반영 절차, 공공데이터 API 사용 방식이 바뀌면 이 파일을 같이 업데이트합니다.
