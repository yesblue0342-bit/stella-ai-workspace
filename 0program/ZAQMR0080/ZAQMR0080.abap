*&---------------------------------------------------------------------*
*& Report  ZAQMR0080
*&---------------------------------------------------------------------*
*& [QM] Material Assignment Program for Inspection Group
*&
*& Spec     : 25._4520 Functional Specification QM005 (ZAQMR0080)
*& Dev Class: ZCQMD            T-Code: ZAQMR0080
*& Designer : KYUNGHUN KIM     Developer: DQMB10
*&
*& 기능 개요
*&  - 플랜트/자재/검사그룹(PLNNR)/그룹카운터(PLNAL) 기준으로 MAPL ⋈ PLKO 조회
*&    (작업계획타입 PLNTY = 'Q' 만 — 검사계획. 라우팅 PLNTY='N' 에 영향 없음)
*&  - 그룹카운터 ↔ 단위 규칙 검증(1=KG, 2=G, 3=L, 4=EA, 5=Other) → 불일치 시 경고
*&  - 편집형 ALV(cl_gui_alv_grid) 에서 Mass Assignment / Change / Delete
*&  - 변경 이력 테이블 ZAQMT0080 에 생성/변경 이력 기록(소프트 삭제 LOEKZ)
*&
*& 코딩 방식 : S/4HANA 모던 ABAP (ABAP SQL 신문법, 인라인 선언, DB 푸시다운).
*&             ALV/화면 처리는 참조 프로그램 ZAQMR0040 의 클래식 패턴을 따른다.
*&---------------------------------------------------------------------*
REPORT zaqmr0080.

INCLUDE zaqmr0080_top.   " 전역 선언(TYPES/DATA/상수/선택화면)
INCLUDE zaqmr0080_cls.   " ALV 이벤트 핸들러 로컬 클래스
INCLUDE zaqmr0080_o01.   " PBO 모듈
INCLUDE zaqmr0080_i01.   " PAI 모듈
INCLUDE zaqmr0080_f01.   " FORM 루틴(조회/검증/표시/Mass/저장)

*&---------------------------------------------------------------------*
*& INITIALIZATION
*&---------------------------------------------------------------------*
INITIALIZATION.
  p_plnty = gc_plnty_q.            " 작업계획타입 기본값 'Q'

*&---------------------------------------------------------------------*
*& AT SELECTION-SCREEN
*&---------------------------------------------------------------------*
AT SELECTION-SCREEN.
  IF p_plnty <> gc_plnty_q.
    " 본 프로그램은 검사계획(Q) 전용. 라우팅(N) 데이터는 다루지 않는다.
    MESSAGE TEXT-e01 TYPE 'E'.     " 작업계획타입은 'Q' 만 허용됩니다.
  ENDIF.

*&---------------------------------------------------------------------*
*& START-OF-SELECTION
*&---------------------------------------------------------------------*
START-OF-SELECTION.
  PERFORM select_data.            " MAPL ⋈ PLKO 조회 + 단위검증
  IF gt_out IS INITIAL.
    MESSAGE TEXT-i01 TYPE 'S' DISPLAY LIKE 'I'.  " 조회된 데이터가 없습니다.
    RETURN.
  ENDIF.

*&---------------------------------------------------------------------*
*& END-OF-SELECTION  → 편집형 ALV 화면 호출
*&---------------------------------------------------------------------*
END-OF-SELECTION.
  CALL SCREEN 0100.
