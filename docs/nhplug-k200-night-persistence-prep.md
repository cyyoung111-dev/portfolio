# NH PLUG KOSPI200 야간선물 → GAS → 텔레그램 연동 준비 (검증 전)

**상태: 자료 계약·단위 테스트만 준비. 운영 호출·GAS 쓰기·텔레그램 발송은 연결하지 않음.**

## 기존 시스템에서 재사용할 것
- 실제 `portfolio-market-data` GitHub Environment에 이미 발급된 NHPLUG_APP_KEY / NHPLUG_APP_SECRET 사용. 어떤 키도 로그·이슈·CSV에 출력하지 않음.
- 기존 `MARKET_MASTER` / `MARKET_SNAPSHOTS` 및 `K200_NIGHT` 공식 KRX 게이트는 변경하지 않음.
- 텔레그램은 기존 `telegram-morning-briefing.yml` 07:40 KST 본 발송 / 08:00 보완 시도, 날짜별 claim 중복 방지, 08:10 이후 전송 금지 규칙 유지.
- 신규 NH 원천은 공식 KRX 원천을 대체·승격하지 않습니다. TFL은 **전환 검증 중에만 유지하는 임시 원천**입니다. NH 조회→GAS 저장→텔레그램 읽기의 실제 정상 증거가 확보되면 TFL 수집 예약·artifact·Python 스크래핑·참고값 fallback을 제거하고, NH 미확보 시 숫자를 임의 대체하지 않고 **미확보**로 표시합니다.

## 공식 기반과 아직 미확인된 부분
- KRX KOSPI200 선물 야간 거래시간은 18:00~다음날 06:00 KST; 목표 거래일은 새벽 종료일.
- NH PLUG 문서: 국내파생 야간 REST 시세·기간별 야간시세 및 KOSPI200 야간선물 실시간 체결가 WebSocket 제공. 국내 시세는 `wss://api.nhplug.com:7070/websocket` (API 인증 필요).
- **실제 REST 경로·필드, 계약코드·근월물 판정·야간 세션과 가격(체결/정산) 구별, 종가 확정 신호는 아직 검증하지 않음.** 공식 `krfuture/openapi.json` 정본으로 확인하기 전에는 경로나 필드명을 추정해서 호출하지 않음.
- 마지막 체결과 공식 야간 정산가격은 같다고 가정하지 않음. 본 계약은 `REFERENCE`만 반환하며 `KRX_OFFICIAL` / `NIGHT_FINAL`을 반환하지 않음.
- GitHub Actions는 단시간 실행이므로 야간 WebSocket을 12시간 내내 유지하는 구조를 사전 검증 없이 채택하지 않음. 가능하면 **06:05~06:20 REST 조회**에서 해당 야간 거래일/월물의 실제 최종 거래를 입증할 수 있는지 먼저 검증하고, 07:40/08:00 전송 전에 날짜가 검증된 저장값을 읽습니다. GitHub 예약이 지연되어 수집이 늦으면 늦은 수신값을 이전 시각에 확보한 것으로 간주하지 않습니다. 불가능하면 지속 수집용 인프라/비용을 별도 판단.

## 저장 설계
운영 GAS에 붙이기 전에는 변경과 쓰기 권한을 부여하지 않음. 안전한 후보 저장 구조:

| 필드 | 의미 |
|---|---|
| storageKey | NH_PLUG\|K200_NIGHT\|거래일\|계약코드 (멱등성) |
| tradingDate / sourceDate | 둘 다 새벽 종료일과 정확히 일치 |
| contract / contractMonth | NH 종목 마스터 검증을 거친 실제 계약코드·만기월 |
| value / priceType | 0.05포인트 호가단위의 양수 가격 / LAST_TRADE |
| observedAt / receivedAt | 마지막 체결 실제 발생시각 / NH 조회 수신시각 (KST 오프셋 포함) |
| source / status / finality | NH_PLUG / REFERENCE / null |
| officialClose | false — 거래소 공식 정산가를 주장하지 않음 |

**GAS 최종 쓰기 시**: 별도의 NH 참고값 시트(예: `NHPLUG_NIGHT_OBSERVATIONS`)에 LockService + storageKey 유일성 + 원자적 갱신 + readback. 기존 `MARKET_MASTER` 정본·가격이력·Snapshot 또는 거래원장에는 쓰지 않음. NH 수신 자료의 원본 응답과 인증키는 기록하지 않음. 정상적으로 저장·재조회된 행만 Telegram 후보로 사용.

## 안전 게이트
1. `tradingDate`는 야간이 종료된 당일(KST), KOSPI200 선물의 검증된 계약월만 선택. 롤오버로 복수 월물이 있으면 자동 발행 **보류**.
2. 체결 시각은 이전 날 18:00~당일 06:00, 조회 수신은 당일 06:00~08:10 이전. **07:40 본 발송과 08:00 보완 시도의 실행 시각 이후 수신 데이터는 사용하지 않으며**, 기준시각·수신시각 증거가 부족하면 **미확보**.
3. 동일 `storageKey` 재수신은 동일 시각·가격이면 중복 무시, 오래된 값이면 무시, 같은 시각 다른 가격이면 오류. GAS 구현은 재시도·동시실행 락으로 보호.
4. Telegram: 07:40·08:00 각각 기존 날짜별 claim 게이트를 통과한 경우에만 해당 날짜의 유효한 저장행을 읽고 *마지막 체결 참고값*으로 출력. 원천 없으면 **미확보**.
5. 기존 KRX 공식 장전 `NIGHT_FINAL` 게이트를 NH로 우회하지 않음. 공식종가로 승격하려면 별도 근거·코드 검증·리뷰 필요.

## 남은 선행조건
1. NH 공식 krfuture 명세 및 실제 권한으로 REST/WS read-only 수신 시험, 계약 마스터 검증.
2. `scripts/nhplug-k200-night-contract.mjs` 정상·오류·월물 전환·날짜 경계·멱등성 단위 테스트 통과.
3. GAS 저장 액션의 잠금/검증/원자성 및 비정상 재시도 방어 구현과 합성 테스트.
4. 저장→읽기→텔레그램 메시지 조합 통합 테스트. 특히 08:00 재시도·시각 역행·GitHub 지연과 일자별 중복 발송 claim을 시험. 정식 일정 연결은 CI·검토·사용자 승인 이후.
5. 배포 이후 다음 거래일 실제 관측 증거로 시세 출처·계약·가격·시각·메시지 확인.

공식 문서: https://www.nhplug.com/llms.txt · https://www.nhplug.com/openapi-docs/krfuture/openapi.json · https://global.krx.co.kr/contents/GLB/02/0201/0201040201/GLB0201040201.jsp

## TFL 퇴출 결정

장기 운영의 기준 데이터 공급원은 NH PLUG로 단일화합니다. **NH가 실운영에서 확인되기 전에는 기존 main의 TFL 작업을 변경하지 않으며**, 정상 수집·GAS readback·날짜별 Telegram 전송을 확인한 다음 별도 PR에서 TFL 스케줄과 의존 코드를 제거합니다. 새 NH API도 이용 해지(3개월 미거래), 시세 권한·비용, 호출 제한을 확인해야 합니다. 정상성을 입증하지 못하면 TFL 데이터를 NH 공식 원천으로 둔갑시키지 말고 당일 수치를 미확보로 표시합니다.
