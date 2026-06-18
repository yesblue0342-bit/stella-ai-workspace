# ZAQMR0080 — [QM] Material Assignment Program for Inspection Group

SAP S/4HANA(HANA) 용 ABAP 프로그램. 스펙 `25._4520 Functional Specification QM005` 기준,
참조 프로그램 **ZAQMR0040**(검사결과 ALV)의 코딩 스타일·패턴을 따른다.

| 항목 | 값 |
|---|---|
| Program ID | **ZAQMR0080** |
| Program Name | [QM] Material Assignment Program for Inspection Group |
| Type | 실행형 리포트(Executable Report) + 편집형 ALV(화면 0100) |
| Dev Class | ZCQMD |
| T-Code | ZAQMR0080 |
| Designer / Developer | KYUNGHUN KIM / DQMB10 |
| 신규 DDIC | ZAQMT0080 (자재-검사그룹 할당 이력) |

## 구성 (참조 ZAQMR0040 의 인클루드 분리 패턴)
| 파일 | 내용 |
|---|---|
| `ZAQMR0080.abap` | 메인 리포트(INCLUDE, 선택화면 이벤트, START/END-OF-SELECTION, CALL SCREEN 0100) |
| `ZAQMR0080_TOP.abap` | 전역 TYPES/DATA/상수/선택화면, 단위규칙 |
| `ZAQMR0080_CLS.abap` | `lcl_event_handler` (toolbar/user_command/data_changed/double_click/top_of_page) |
| `ZAQMR0080_O01.abap` | PBO(status_0100, create_alv) |
| `ZAQMR0080_I01.abap` | PAI(user_command_0100, exit_0100) |
| `ZAQMR0080_F01.abap` | FORM(select_data, 단위검증, ALV 구성, Mass Assign/Change/Delete, save_data) |
| `ZAQMT0080.ddic.txt` | 이력 테이블 DDIC 정의 |
| `ZAQMR0080.txt` | 텍스트 심볼/선택텍스트/GUI 상태 |

## 스펙 ↔ 구현 매핑
- **조회**: `MAPL ⋈ PLKO` (ABAP SQL 신문법, JOIN을 DB로 푸시다운) — `WHERE a~plnty='Q'`
  로 **검사계획만** 필터(라우팅 PLNTY='N' 비대상). `loekz=space` 로 삭제건 제외.
- **출력**: WERKS, MATNR, PLNNR(Group), PLNAL(Group Counter), KTEXT(Description), PLNME(단위), PLNTY.
- **단위 검증**: 그룹카운터 ↔ 단위 규칙 `1=KG, 2=G, 3=L, 4=EA, 5=Other`.
  불일치 시 경고 메시지(`w01`) 표시, 처리(저장)에서 제외(데이터 무결성 우선).
- **User Function**: 편집형 ALV 툴바 **Assign / Change / Delete (Mass)** + **SAVE**.
  선택 행을 이력테이블 `ZAQMT0080` 에 생성/변경/소프트삭제(LOEKZ) 로 반영.
- **변경 이력/복원**: ERNAM/ERDAT/ERZET(생성), AENAM/AEDAT/AEZET(변경), LOEKZ(소프트삭제).
- **더블클릭**: 해당 자재의 검사계획 표시(`CALL TRANSACTION 'QP03'`).

## S/4HANA 모던 ABAP 적용
- ABAP SQL 신문법(`@` 호스트변수, 콤마 필드리스트, `INTO CORRESPONDING FIELDS OF TABLE @gt_out`).
- 인라인 선언(`DATA(...)`, `FIELD-SYMBOL`), `VALUE #( )`/`REDUCE`/`SWITCH`/`COND`, 문자열 템플릿.
- 로직의 JOIN/필터는 DB 푸시다운. 구 statement(헤더라인 등) 회피.
- 표준 테이블 MAPL/PLKO 는 변경하지 않고 조회만, 이력은 별도 Z 테이블.

## 배포 메모
- ADT/SE38 에 인클루드 6종 + 텍스트요소, SE11 에 ZAQMT0080, SE51/SE41 에 화면 0100 + PF-STATUS '0100' 등록 후 활성화.
- 단위 규칙 매핑값(KG/G/L/EA)은 시스템 단위 코드에 맞게 `build_unit_rule` 에서 조정.
