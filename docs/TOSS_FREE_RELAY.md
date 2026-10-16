# Toss Open API: 무료 고정 발신 IP 파일럿 (아직 운영 미연결)

목표: 현재 GAS·KRX·Snapshot·포트폴리오 운영을 변경하지 않고, Oracle Cloud Always Free 서버에서 Toss 시세만 호출하는 경로를 먼저 검증.

## 배경 및 공식 근거
- 현재 운영 v9.228에서 실제 HTTP 403 원문 `ip-not-allowed` 확인.
- Google Apps Script UrlFetchApp은 고정 IP가 아닌 Google IP 주소 풀 사용.
- Oracle Cloud Always Free VM과 예약 IPv4(Reserved Public IP)를 검토할 수 있음. 예약 IP 기능은 Oracle 공식 발표 기준 자체 이용료 없음. 단 무료계정별 허용 한도 및 VM 리전·추가 리소스 과금 여부는 OCI 콘솔에서 확인.
- Oracle 무료 VM은 용량 부족으로 개설 실패 또는 장기간 저사용으로 회수될 수 있어 24시간 가용성 보장 아님. 공식 유휴 기준은 최근 7일 중 CPU·네트워크·(A1일 때) 메모리 사용률 조건이며, 불필요한 부하를 만들어 회수를 회피하지 않음.
- 계정 만들 때 본인/결제수단 확인을 요구할 수 있음. PAYG 임의 전환 및 유료 VM/NAT Gateway/Load Balancer 생성 금지.

출처:
https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/managingpublicIPs.htm
https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/assign-public-ip-instance-launch.htm
https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/reserved-public-ip-assign.htm
https://blogs.oracle.com/cloud-infrastructure/release-announcement-reserved-public-ips-are-now-available-on-oracle-cloud-infrastructure
https://developers.tossinvest.com/docs/auth

## 0원 경로
GAS → HTTPS(무료 DNS + Caddy 인증서) → Node 중계(127.0.0.1:18761) → Oracle VM 예약 IPv4 → Toss

1. 사용자가 https://www.oracle.com/cloud/free/ 에서 **Always Free 계정** 신규 가입. 가입 중 `Home Region`은 추후 바꿀 수 없으므로 먼저 선택하고, 완료 후 **그 홈 리전에서** `VM.Standard.E2.1.Micro`(AMD) 1대 또는 무료 범위 A1을 생성. 부트볼륨 50GB 및 추가 스토리지·네트워크 리소스가 무료 범위인지 확인.
2. VM 생성 시 Networking의 **Automatically assign a public IPv4 address** 기본 체크를 해제하고, **public subnet + internet gateway**를 구성. OCI 콘솔 Networking → IP management → Reserved Public IPs에서 예약 IPv4 1개를 생성하여 VM의 **primary private IP**에 할당. *이미 ephemeral public IP가 있으면 우선 제거해야 할당 가능하며 ephemeral IP 자체를 reserved IP로 변환할 수 없음.* 무료 한도/과금 표시를 확인하고 사용하지 않는 IP를 중복 예약하지 않음.
3. OCI/OS 방화벽에서 SSH 22는 관리 IP로 제한, HTTP 80(인증서), HTTPS 443 허용. **18761은 절대 외부에 개방하지 않음.**
4. 무료 서브도메인(예: DuckDNS)을 만들어 예약 IPv4로 A레코드 연결. Node와 Caddy 설치, Caddy의 자동 HTTPS를 이용함. 직접 IP 주소에 자체서명 인증서를 적용하거나 GAS의 TLS 검증을 해제하지 않음.
5. VM의 비공개 환경 파일에서 `TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET`, 32자 이상 난수 `TOSS_RELAY_SHARED_KEY` 설정. 권한 600·전용 서비스 계정·systemd 재시작 정책을 적용. 인증값을 GitHub, 시트, 웹에 저장하지 않음.
6. 중계 코드: `scripts/toss-free-relay.mjs`. 자체 보안·성공·실패 검증: `node scripts/check-toss-free-relay.mjs`. Caddy 설정 형식: `your-subdomain.duckdns.org { reverse_proxy 127.0.0.1:18761 }`.
7. 서비스 연결 API: 인증된 `POST /v1/fetch` 헤더 `x-relay-key`, 본문 예시 `{"action":"prices","params":{"symbols":"005930"}}`. 주문/계좌/임의 URL은 차단. 서버 토큰은 VM 내부에만 저장.
   - 허용 범위는 Toss 시세·일별 개별종목 캔들·환율·한미 시장 달력·시장지표 현재가/캔들이며, **기존 GAS가 사용하는 KOSPI/KOSDAQ 및 KR_BOND_2Y/3Y/5Y/10Y/20Y/30Y까지** 허용 목록을 제한적으로 정합시켰음. 지표 캔들은 최대 200건·`before` 페이지네이션 지원. 실제 GAS 연결용 클라이언트 변환은 별도 PR에서만 수행.
   - Toss의 HTTP 403·429·5xx가 HTML/빈 본문이더라도 응답 JSON에 원래 upstream status와 제한된 오류코드만 반환. 비JSON 403은 `UNKNOWN_403`; 429/5xx는 `RATE_LIMITED`/`UPSTREAM_UNAVAILABLE`로 구분하며 원문 응답/인증정보를 노출하지 않음.
8. 먼저 VM에서 실제 외부 IPv4 확인 → Toss WTS 허용 IP 등록 → VM 직접 Toss OAuth 200, 005930 가격 200을 다른 시점 3회 이상 확인.
9. 검증된 뒤 **별도 PR**로 GAS에 명시적 활성화 스위치를 넣어 Toss만 relay로 전환. 이 파일럿은 운영 GAS 연결을 변경하지 않음. Oracle relay에서 신규 OAuth를 발급하면 기존 GAS 캐시 토큰이 무효화될 수 있으므로 같은 클라이언트를 두 서버에서 동시에 발급하지 말 것.
10. 전환 실패 때 KRX 종가·기존 공급원 fallback 유지. GAS 새 버전/승인 Git blob/CI/Codex/운영 배포 실조회까지 완료 후에만 정상화 판정.

## 무료 운영의 제한
- OCI 무료 계산 자원 부족, 계정 승인 거부, 방화벽·TLS 설정 어려움, 유휴 인스턴스 회수 및 무료 정책 변경 위험.
- 가능하면 월 예산 경고 설정(예산 알림은 비용 차단이 아님), 사용량 주기적 확인.
- Oracle 예약 IP가 실제 VM의 Toss outbound IPv4인지 검증 필수. 공인 IP를 하나 받는 것만으로 해결 판정 불가.
- Vercel/Cloudflare Workers/GitHub Actions의 일반 무료 실행 인프라는 고정 outbound IP를 보장하지 않아 동일 해법이 아님.

**현재 상태: 실행 코드·모의 테스트만 준비. OCI 계정/무료 VM/예약 IPv4가 연결되지 않았고, Toss 차단은 아직 해소되지 않음.**


## 실제 서버 배포 키트 (2026-10-17)

OCI Always Free 서버 준비·Caddy HTTPS·예약 송신 IPv4·서비스 사용자·systemd 구성과 005930 실연결 테스트는 **[ops/toss-relay/README.md](../ops/toss-relay/README.md)** 참조.

- 배포 준비: `ops/toss-relay/install.sh prepare` (보안 preflight, 자격증명 노출/운영 연결 없음)
- Toss 비밀정보: VM 내 root 전용 `/etc/toss-relay/env` (권한 0600)에서만 입력
- 활성화: `ops/toss-relay/install.sh activate` (발신 예약 IP·도메인·Caddy TLS·비인증 401 검증)
- 실제 Toss 005930 시세: `ops/toss-relay/verify-live.mjs`, 비밀정보·가격·원문 미출력
- 정적/보안 테스트: `npm run check:toss-relay-vm`, CI 연동
- **현재 단계는 배포 스크립트 준비**로, OCI 계정/VM/Reserved IP 실제 프로비저닝과 Toss WTS 등록은 본인 인증 필요. 운영 GAS 시세 전환은 **별도 PR**로 분리.
