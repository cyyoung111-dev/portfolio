# Toss Open API — Oracle Always Free 고정 IP 중계 실서버 설치

**범위:** 운영 GAS/KRX/NAV/Snapshot/시트/거래원장 무변경. 기존 `scripts/toss-free-relay.mjs`는 주문·자산·계좌 API를 열지 않는 시세 전용. 유료 플랜/PAYG 전환·NAT Gateway·Load Balancer·비공개 인증서 사용 금지.

## 1. Oracle Cloud 계정/무료 VM 준비 (사용자 본인만 가능)
- 공식 가입: https://signup.oraclecloud.com . 실명, 본인 이메일·전화·결제수단 검증이 요구될 수 있으나 인증정보를 ChatGPT/GitHub에 공유하지 않음. 무료 계정은 1인당 1개, 중복 생성 금지.
- **Home Region**은 국내 접속과 Toss 지연을 감안하여 **South Korea Central (Seoul)**을 우선 고려하되, 실제 가입 화면의 Always Free 수용량을 확인. 가입 후 Home Region 변경 불가. A1이 부족하면 AMD E2 Micro 검토.
- Compute → Instances → Create Instance, `VM.Standard.E2.1.Micro` **Always Free Eligible** 1대, Ubuntu 24.04 LTS Always Free image, 부트볼륨 기본 50GB, **public subnet + Internet Gateway**. 인스턴스 생성 시 자동 Ephemeral IP를 할당하지 않는 구성이 간단함.
- Networking → IP management → Reserved public IPs에서 공인 IP **1개** 생성, 해당 VM VNIC primary private IP에 연결. 이미 임시 공인 IP가 있으면 먼저 해제(연결이 끊길 수 있으므로 SSH 접근 경로를 확인). NAT Gateway나 Public Load Balancer는 만들지 않음.
- 실제 생성 전에 콘솔에서 **Always Free** 라벨, VM·스토리지·IP 비용을 모두 검산. 유료 shape, 추가볼륨, PAYG 플랜 선택 금지. Free Trial 한도나 계정 정책은 변경될 수 있음.
- OCI Security List 또는 Network Security Group: TCP 22는 개인이 사용하는 고정 관리 주소만 허용, TCP 80/443은 TLS 발급 및 HTTPS 접근을 위해 개방. **TCP 18761은 절대 외부 허용 금지.** Ubuntu 내부 방화벽도 동일하게 설정.
- VM 외부 송신 IPv4는 VM에서 `curl -4fsS https://api.ipify.org` 실행해 확인. **Reserved Public IPv4와 정확히 일치하는지 확인**하기 전에는 Toss WTS에 허용 IP 등록하지 않음.
- 무료 DNS(예: DuckDNS)의 본인 서브도메인을 생성해 A 레코드를 해당 Reserved IPv4로 지정, DNS 전파 확인.
- 무료 인스턴스는 용량 부족/장기 저사용으로 회수될 수 있음. E2 Micro는 1GB RAM 제약. CPU 부하를 인위적으로 올려 회수 조건을 우회하지 않음.

공식 참고:
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/managingpublicIPs.htm
- https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/reserved-public-ip-assign.htm
- https://caddyserver.com/docs/install

## 2. Ubuntu VM 기본 프로그램 설치

SSH로 VM 접속 후 **VM 안에서** 진행. GitHub private repo를 `git clone` 또는 기존 PC에서 `scp`로 **사용자 본인 권한으로** `~/portfolio`에 가져와야 함. VM에 GitHub 토큰 저장을 권장하지 않으며, GitHub 로그인·비밀번호·SSH 개인키 등을 대화창에 보내지 않음.

Node.js **22 이상** LTS와 Caddy 설치 후 `node --version && caddy version` 확인. NodeSource의 서명된 APT 저장소 예시(새 VM에서만 실행):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git python3
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main' | sudo tee /etc/apt/sources.list.d/nodesource.list
sudo apt-get update
sudo apt-get install -y nodejs
```

Caddy는 https://caddyserver.com/docs/install 의 Ubuntu APT 설치 절차를 사용. 배포 스크립트는 Caddy가 존재하지 않으면 실패하며 임의 외부 스크립트를 root로 실행하지 않음.

## 3. 준비 (비밀키 없이 실행)

아래 `relay-example.duckdns.org`와 `203.0.113.5`는 **예시**이고 실제 등록한 DNS/Reserved Public IPv4로 바꿔야 함. 준비 전 OCI outbound IP와 DNS A가 일치해야 함. 신규 전용 VM의 기본 Caddyfile을 덮어쓰는 데만 명시적 동의를 부여하며, 기존 Caddy 서비스가 있으면 실행하면 안 됨.

```bash
cd ~/portfolio
sudo env TOSS_RELAY_DOMAIN=relay-example.duckdns.org \
  TOSS_RESERVED_IP=203.0.113.5 TOSS_RELAY_REPLACE_CADDY=1 \
  bash ops/toss-relay/install.sh prepare
```

성공 메시지: `RELAY_PREPARED_NO_SECRETS_IN_GIT`. 프로세스는 아직 시작되지 않음. `/etc/toss-relay/env`는 root 소유 0600. 서비스 사용자는 `tossrelay`, Node 포트 18761은 127.0.0.1에만 바인딩됨.

## 4. Toss 자격증명을 VM 내부에서만 입력

```bash
openssl rand -hex 32
sudoedit /etc/toss-relay/env
```

`openssl`이 출력한 64자리 난수는 복사해 **VM 내부 env 파일에만** 입력. 기존 파일의 세 줄을 채움:

```text
TOSS_CLIENT_ID=<Toss WTS Client ID>
TOSS_CLIENT_SECRET=<Toss WTS Client Secret>
TOSS_RELAY_SHARED_KEY=<위에서 생성한 64자리 랜덤 문자열>
```

위 표기는 값의 위치 설명이며 **리터럴 꺾쇠 괄호를 입력하지 말 것**. 입력 내용은 GitHub·브라우저·ChatGPT에 올리지 않음. 기존 GAS가 같은 Toss Client로 토큰을 발급 중이라면 OAuth 토큰 충돌 가능성을 확인하고 중복 실행을 막아야 함.

## 5. 실제 활성화

```bash
cd ~/portfolio
sudo env TOSS_RELAY_DOMAIN=relay-example.duckdns.org \
  TOSS_RESERVED_IP=203.0.113.5 \
  bash ops/toss-relay/install.sh activate
```

성공하면 `RELAY_ACTIVATED_HTTPS_AUTH_PROTECTED`. IP/DNS 일치, HTTPS TLS, 외부 비인증 API 401, 루프백 서버 상태가 검증됨. Caddy 공개 경로는 `POST /v1/fetch`만 허용하며, API 호출은 `x-relay-key`가 없으면 401.

## 6. Toss WTS 허용 IP 등록·실제 시장 시세 테스트

1. Toss WTS 개발자 설정에서 **VM의 실제 outbound Reserved Public IPv4 한 개만** 등록. `0.0.0.0/0`나 Google 공유 IP 범위를 등록하지 않음.
2. VM에서 다음을 실행. **가격·비밀키·계좌정보는 출력하지 않음**.

```bash
cd ~/portfolio
sudo env TOSS_RELAY_DOMAIN=relay-example.duckdns.org \
  TOSS_RESERVED_IP=203.0.113.5 node ops/toss-relay/verify-live.mjs
```

`result:PASS`면 005930 현재가 HTTP 200, 유효한 가격·시각 존재, 비인증 요청 401 검증 완료. 단 현재가 성공은 **2026-10-16 공식 종가 확정이나 전체 37종목 커버리지의 증거가 아님**. Toss 403 `ip-not-allowed`면 실제 outgoing IP/Toss 설정값/적용 시간을 재확인하며, 비밀번호·토큰 원문 출력 금지.

## 7. 서비스 확인·최종 전환

```bash
sudo systemctl is-active toss-relay caddy
sudo systemctl status toss-relay --no-pager
sudo systemctl status caddy --no-pager
```

초기 상태는 **GAS와 미연결**. VM의 시세 200 성공을 여러 시점에서 확인한 후, **GAS 시세 호출만 HTTPS relay로 바꾸는 별도 PR**을 만들고 CI·Codex 리뷰·운영 배포 검증을 거침. 기존 KRX 공식 종가·펀드 NAV·Snapshot·거래원장과는 별도이며, 롤백 스위치/원천출처 구분 유지.

다음 사람이 진행해 줄 수 있는 작업은 무료 계정 생성과 VM/IP/도메인 준비. 그 외 본문에 나열한 배포 스크립트와 검증기는 저장소에 포함되어 있으므로 컴퓨터에서 그대로 실행 가능함.
