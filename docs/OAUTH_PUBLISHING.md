# 개인용 OAuth 게시 준비 (2026-10-26)

현재 OAuth 인증은 작동하지만 Google Auth Platform의 게시 상태는 Testing이며 앱 게시 버튼은 비활성화다. 공개 안내 페이지 추가는 OAuth 게시·소유권 확인·7일 만료 해소 완료를 뜻하지 않는다.

## 공개 안내

기존 GitHub Pages의 프로젝트 경로에 oauth/index.html, oauth/privacy.html, oauth/terms.html을 제공한다. URL은 Pages 배포 결과에서 확인하며 커스텀 도메인이나 새 과금 리소스를 생성하지 않는다. OAuth 로그인·토큰 입력·프로젝트 ID·비공개 웹앱 URL·개인 금융 자료는 포함하지 않는다.

## 다음 순서

1. Pages에서 세 페이지와 CSS가 공개 200으로 응답하는지 확인한다.
2. 프로젝트 소유자와 같은 Google 계정으로 Search Console에 해당 프로젝트 사이트의 URL 접두어 속성을 추가한다. GitHub Pages 공유 도메인의 DNS를 통제할 수 없으므로 Domain 속성에 github.io를 입력하지 않는다.
3. Google이 실제로 발급한 HTML 인증파일(또는 meta 태그)을 받아 그 속성에 해당하는 위치에 반영한다. 인증값을 생성·추정하지 않는다. 이 값은 비밀번호/refresh token과 다르지만 해당 사이트의 소유권을 부여하는 절차이므로 계정·대상을 확인한다.
4. Search Console의 소유권 확인 성공과 OAuth 콘솔의 도메인 수용은 별개다. github.io는 Public Suffix List의 공유 suffix이므로 사용자별 호스트가 top private domain 후보지만 Google OAuth의 실제 수용 여부를 확인하기 전에는 성공으로 기록하지 않는다.
5. Google이 수용한 도메인과 실제 공개 페이지를 Branding에 입력한다. 게시 버튼 활성화와 In production 전환을 별도 확인한다. 권한·사용 대상·접근 기간 확대가 수반되는 최종 변경은 사용자와 확인한다.
6. Production 확인 후 기존 권한 범위를 유지해 사용자가 직접 새 인증을 수행하고, 보호된 portfolio-production-gas 환경의 CLASPRC_JSON만 갱신한다. 비밀값을 채팅·Issue에 붙이지 않는다. 기존 정상 토큰은 새 인증 검증 전 미리 폐기하지 않는다.
7. OAuth refresh와 Apps Script API GET의 읽기 전용 검증 후 완료 판정한다. Production 전환만으로 토큰이 영구 보장된다고 주장하지 않는다.

## 공식 근거

- https://support.google.com/cloud/answer/15549049?hl=en : 외부 production 앱의 링크·홈페이지·승인 도메인 요건
- https://support.google.com/cloud/answer/13464323?hl=en : 개인용 앱 검증 면제와 게시 상태 구분
- https://support.google.com/webmasters/answer/9008080?hl=en : URL 접두어 속성의 HTML 파일/태그 소유권 확인
- https://support.google.com/cloud/answer/13804266?hl=en : 프로젝트 소유자 계정과 도메인 소유권 일치
- https://publicsuffix.org/list/public_suffix_list.dat : github.io 공유 suffix

금융 계산·GAS 소스·트리거·실사용 인증정보 변경 없음.
