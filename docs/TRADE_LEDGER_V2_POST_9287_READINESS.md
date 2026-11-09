# 거래원장 v2 — GAS v9.287 이후 독립 준비·전환 경계

> #734 · 2026-11-09 KST. **준비 전용**: 이 문서는 GAS/Google Sheets 운영 원본을 변경하거나
> 14열 거래원장을 운영 배포하지 않는다. 종가·펀드·Snapshot 자동 Writer는 기존 v9.287을 유지한다.

## 1. 확정된 현재 상태

- 실제 운영 GAS HEAD와 게시본은 **v9.287 / Apps Script 버전 344**.
  2026-11-09 수동 [검증 #42583135395](https://github.com/cyyoung111-dev/portfolio/actions/runs/42583135395)는
  기존 9.287 소스와 같아 신규 게시를 생략했고, NH 가격 샘플을 확인했다.
  **펀드 19시 마감 COMPLETE와는 별도**다.
- 거래원장 v2 개발 후보는 `scripts/compose-gas9286-integrated-preview.mjs`의
  **과거 v9.286 source-only**이다. v9.284를 부모로 삼는다.
  14열·CAS·영구 ID·FX를 테스트했어도 **v9.287 운영판에 그대로 게시하면 안 된다**.
- 운영 GAS v9.287은 거래원장 14열·CAS·`syncTradesV2`가 없다.
  운영 웹 클라이언트는 정식 v2 서버 계약 없이는 FX 필드 손실·구형 원장 덮어쓰기를 차단한다.
- 구 Draft PR #1012는 main에서 충돌·구형 배포 경로를 포함해
  **not planned로 닫혔다**. 코드와 리뷰 이력은 보존되고 남은 일은 #734에 유지한다.

## 2. 실재 원장과 별도 Shadow 복제본 읽기 전용 대사

2026-11-09 실제 Google Sheets 커넥터를 사용한 **읽기 전용** 자료 대조:

| 검사 | 확인 |
| --- | --- |
| 운영 원장 | `portfolio_gsheet_template` / `거래이력` |
| 격리 복제본 | `TRADE_V2_SHADOW_거래이력_20261107_원본불변` / `거래이력_이관검증` |
| 운영 기록 수 | 338행 (헤더 제외) |
| Shadow 기록 수 | 338행 (헤더 제외) |
| A:K 원본 행별 비교 | **338/338 일치, 불일치 0** |
| Shadow N열 거래 ID | **338/338 존재, 중복 0, 포맷 오류 0** |
| Shadow L/M 외화단가·매입환율 | 한쪽만 기입한 행 0 |
| 운영 시트 원본 값 변경 | 0건 (조회 전용) |

**주의:** 이 검사는 표시·비표시 셀의 **값**과 ID 무결성만 대조했으며,
공식 스크립트 `SS_ID` 연결, 수식·서식·데이터 검증, 편집 동시성/트리거 Writer
종료를 증명하지 않는다. 따라서 실제 운영 11→14열 이관의 최종 승인 근거가 아니다.

## 3. 다음 릴리스는 운영 v9.287을 부모로 삼아야 함

1. 후속 거래원장 후보의 **임시 명칭만 v9.288**로 한다. 소스/해시 검토 전까지
   배포 whitelist, GAS 자동배포 승인 flag 및 published GAS를 수정하지 않는다.
2. 리뷰된 실배포 전체 원본의 Git blob
   `e2f5239746598754305eb603bc33651f5c36d914`가 **정확한 부모**인지
   독립 재조회한다. GitHub의 `src/gas/apps_script.gs` 파일은
   현재 운영 9.287 전체 소스가 아닌 과거 staged 부모일 수 있다.
3. v9.286 미배포 개발 후보에서 **14열 거래원장 ID/CAS/FX/receipt 관련 변경만**
   정확한 기준과 diff로 추출·이식한다. 펀드
   `_refreshFundValuations`, `_backupSheetBeforeWrite`,
   `writeSnapshotRows`, writer gate, Snapshot timing, 복구 경로,
   Bootstrap의 기존 기타 API는 **v9.287 byte-exact** 보존을 필수 확인한다.
4. 11/13/14열 이행, 다중 계좌 이동, 외화단가·매입환율 L/M 보존,
   N 거래 영구 ID, 수정·삭제·계정 이동·분할, PC/모바일 재연결,
   과거 응답 유실 시 재조회 영수증, CAS stale write 차단,
   338행 Shadow 이관 재현성을 CI와 실복제본에서 검증한다.
5. 실제 이관 전 원본 338행 A:K 전체 백업·행수/합계·sha256
   대사, 운영 Writer·레거시 deployment/trigger 격리, 승인된 ScriptLock,
   원본 14열 적용 후 row-by-row 보존/고유 ID/FX 읽기 검증,
   원복 경로 증명을 별도로 요구한다.
6. 원본 이관과 GAS/웹 기능 활성화의 순서를 승인된 하나의 실행계획으로
   확정한다. 확정 전 **운영 Sheet 이관, GAS 재게시, 백업 삭제, 텔레그램 발송을 하지 않는다.**

## 4. 이번 준비 PR의 범위

- `scripts/check-trade-v2-post9287-release-boundary.mjs`: 운영 9.287 리뷰
  SHA를 정확히 검증, 구형 9.286과 이름만 바꾼 9.288 배포를 **거부**,
  중요한 세 펀드/Snapshot 함수 byte-exact 대조, 기존 14열 ID/CAS 보유를 확인.
- 위 검사를 기존 `npm run check:gas` / 전체 `check:ci`에 추가.
- **source-only 검증 1회, financeWrites=0, gasWrites=0**.
  실운영 v2 출시와 기능 완료 판정은 별개다.
