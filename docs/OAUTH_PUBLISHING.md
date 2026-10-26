# 개인용 OAuth 게시 준비 (2026-10-26)

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
