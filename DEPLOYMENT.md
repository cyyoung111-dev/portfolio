# Deployment Notes

## 목표
정적 서버의 웹 루트를 `src/web`로 직접 서빙하도록 전환한다.

## 로컬 검증
아래 명령으로 루트 리다이렉트 없이 `src/web`를 직접 서비스할 수 있다.

```bash
npm run serve:web
# 또는
npm run serve:web:py
```

기본 주소: `http://localhost:4173`

## 운영 반영 체크리스트
- [ ] 정적 서버 document root를 `src/web`로 지정
- [ ] `/` 요청이 `src/web/index.html`을 반환하는지 확인
- [ ] 기존 루트 `index.html` 리다이렉트 유지/삭제 정책 확정
- [ ] 캐시 무효화 후 JS/CSS 404 여부 확인

## 참고
루트 `index.html`은 현재 하위호환을 위해 `./src/web/index.html`로 전달한다.
서버 루트를 `src/web`로 직접 지정하면 리다이렉트 없이 즉시 앱이 열린다.
