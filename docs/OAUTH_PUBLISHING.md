# 개인용 OAuth 운영 복구 — Personal mode 우선 (2026-11-26)

## 현재 장애와 적용 범위

[11/23 GAS 실행 #45195772612](https://github.com/cyyoung111-dev/portfolio/actions/runs/45195772612)의 read-only release preflight에서 `GAS_OAUTH_REAUTH_REQUIRED (HTTP 400)`가 발생했다. 9.306 실제 배포 완료 증거가 없으며, 9.305가 마지막 확인된 운영 버전이다. 자동 GAS workflow의 validate 성공/deploy SKIPPED는 재인증 또는 배포 성공이 아니다.

Google의 [Personal mode 공식 설명](https://support.google.com/cloud/answer/15544987?hl=en#personal-mode)에 따라 본인 전용 OAuth 앱은 테스트 사용자 7일 만료 정책과 앱 검증의 적용 대상이 아니다. 기존 External/Internal 프로젝트를 Personal로 전환할 수 없으므로 별도의 OAuth 프로젝트/클라이언트를 사용한다. 토큰 자체가 영구 보장되는 것은 아니다. 기존 GAS script ID, deployment ID, Sheet, 공개 URL, GAS_ACCESS_TOKEN, Writer 정책은 바꾸지 않는다. 새로운 OAuth 프로젝트가 기존 GAS 프로젝트의 GCP 연결 변경을 뜻하지 않는다.

## 사용자 1회 승인 절차

1. 기존 Apps Script 소유자와 동일한 Google 계정으로 [Personal mode 시작](https://console.cloud.google.com/auth/overview/personal)을 연다.
2. Personal 프로젝트를 생성하고 Application type은 **Desktop app**으로 선택한다. 해당되는 경우 AI agent 옵션을 검토하고, 약관 확인 및 Continue는 계정 소유자가 수행한다.
3. Client JSON을 생성 시점에 안전한 로컬 폴더로 다운로드한다. 이 파일은 refresh token이 있는 clasp 인증 파일과 다르다. Git 저장소나 채팅에 올리지 않는다.
4. 새 OAuth GCP 프로젝트에서 [Apps Script API](https://console.cloud.google.com/apis/library/script.googleapis.com)를 활성화하고 기존 소유자 계정의 [Apps Script API 사용자 설정](https://script.google.com/home/usersettings)이 ON인지 확인한다. 필요한 권한 범위/API만 유지한다.
5. 저장소 밖의 전용 작업 폴더에서 최신 지원 clasp를 사용해 `clasp login --creds client_secret.json`을 실행하고, 동일 Google 계정으로 승인한다. 기본 사용자(default)로 로그인한다. 생성된 `.clasprc.json` 위치는 clasp 버전 및 설정에 따라 로컬 작업 폴더 또는 홈 폴더에서 확인한다. OAuth client JSON 대신 이 인증 JSON을 사용한다. 기존 인증 파일은 새 인증 검증 전에 폐기하지 않는다.
6. [GitHub production 환경](https://github.com/cyyoung111-dev/portfolio/settings/environments)에서 `portfolio-production-gas`의 **CLASPRC_JSON**만 교체한다. `scripts/deploy-gas.mjs`의 지원 형식은 clasp 기본 사용자 토큰 또는 기존 legacy 형식이다. 인증 JSON 전체를 비밀값으로 등록하고 로그에 출력하지 않는다. 다른 secrets/vars 변경 금지.

## 인증 후 운영 검증 순서

1. [gas-deploy](https://github.com/cyyoung111-dev/portfolio/actions/workflows/gas-deploy.yml) main에서 operation **진단만** 실행. 이 실행의 OAuth refresh, 기존 published GAS 버전 및 release 상태 read-only 검증, Writer idle, 원장 해시, dry-run 결과를 확인한다.
2. 인증 또는 preflight 실패 시 실제 배포 금지. 확인된 9.305에서 9.306으로 승인된 운영 배포를 별도 실행한다. 자동 배포나 반복 재시도, 이전 버전 강제 우회는 금지한다.
3. 실제 9.306 webApp readback 및 거래 해시 확인 후 공식 NAV 원천의 검증된 수집 → NAV 원본 → 가격이력 → Snapshot → CLOSE 대사를 수행한다. NAV 원천 HTTP 장애는 OAuth와 별개이며 기존 수집 실패를 숨기지 않는다.
4. 신규 NAV가 있는 실제 5거래일 결과를 운영 증빙으로 확인한다. 무쓰기 후보 0건 및 source-only 성공은 신규 반영 성공으로 집계하지 않는다.

공식 clasp: https://github.com/google/clasp 및 https://developers.google.com/apps-script/guides/clasp . 아래는 기존 External 게시 방식의 참고 이력이며, Personal mode가 적합한 경우 DNS/도메인 등록을 우선하지 않는다.

---

## 개인용 OAuth 게시 준비 (2026-10-26)

현재 OAuth 인증은 작동하지만 Google Auth Platform의 게시 상태는 Testing이며 앱 게시 버튼은 비활성화다. 공개 안내 페이지 추가는 OAuth 게시·소유권 확인·7일 만료 해소 완료를 뜻하지 않는다.

## 공개 안내

기존 GitHub Pages의 프로젝트 경로에 oauth/index.html, oauth/privacy.html, oauth/terms.html을 제공한다. URL은 Pages 배포 결과에서 확인하며 커스텀 도메인이나 새 과금 리소스를 생성하지 않는다. OAuth 로그인·토큰 입력·프로젝트 ID·비공개 웹앱 URL·개인 금융 자료는 포함하지 않는다.

## 다음 순서

1. Pages에서 세 페이지와 CSS가 공개 200으로 응답하는지 확인한다.
2. Google의 OAuth Domain Verification 안내는 프로젝트 소유자 계정으로 Search Console의 Domain property(DNS 수준)를 확인하도록 명시한다. URL-prefix/HTML 파일 소유권만으로 OAuth 도메인 확인을 대체하지 않는다. GitHub Pages 기본 호스트의 DNS TXT를 사용자가 통제할 수 없으므로 그 주소만으로 정상화됐다고 판단하지 않는다.
3. 무료 조건을 유지하려면 별도로 DNS TXT를 설정할 수 있고 OAuth가 수용하는 주소가 필요하다. 무료 서브도메인 서비스는 가입/등록 조건·공개 연락처·갱신·수용 여부를 확인한 뒤 별도 진행한다. is-a.dev 등 후보를 실제 승인됐다고 기록하지 않는다. 새 계정/공개 등록을 임의로 수행하거나 사용자의 이메일을 외부 공개하지 않는다.
4. 사용할 주소가 확보되면 같은 프로젝트 소유자 Google 계정에서 Domain property를 추가하고 Google이 발급한 실제 TXT를 해당 주소 DNS에 등록한다. 인증값을 생성·추정하지 않는다. 소유권 부여 절차이므로 계정과 대상을 확인한다.
5. 소유권 확인 뒤 공개 홈페이지·개인정보처리방침·약관을 해당 주소에서 제공한다. 기존 포트폴리오 사이트 전체의 도메인 변경은 별도 영향 검토 없이 수행하지 않는다. Google이 수용한 도메인과 실제 공개 페이지를 Branding에 입력하고 게시 버튼 활성화 및 In production 전환을 별도 확인한다. 권한·사용 대상·접근 기간 확대가 수반되는 최종 변경은 사용자와 확인한다.
6. Production 확인 후 기존 권한 범위를 유지해 사용자가 직접 새 인증을 수행하고, 보호된 portfolio-production-gas 환경의 CLASPRC_JSON만 갱신한다. 비밀값을 채팅·Issue에 붙이지 않는다. 기존 정상 토큰은 새 인증 검증 전 미리 폐기하지 않는다.
7. OAuth refresh와 Apps Script API GET의 읽기 전용 검증 후 완료 판정한다. Production 전환만으로 토큰이 영구 보장된다고 주장하지 않는다.

## 공식 근거

- https://support.google.com/cloud/answer/15549049?hl=en : 외부 production 앱의 링크·홈페이지·승인 도메인 요건
- https://support.google.com/cloud/answer/13464323?hl=en : 개인용 앱 검증 면제와 게시 상태 구분
- https://support.google.com/webmasters/answer/9008080?hl=en : 일반 사이트 소유권 확인 방법(OAuth의 DNS 요구와 구분)
- https://support.google.com/cloud/answer/13804266?hl=en : 프로젝트 소유자 계정과 도메인 소유권 일치
- https://publicsuffix.org/list/public_suffix_list.dat : github.io 공유 suffix

금융 계산·GAS 소스·트리거·실사용 인증정보 변경 없음.
