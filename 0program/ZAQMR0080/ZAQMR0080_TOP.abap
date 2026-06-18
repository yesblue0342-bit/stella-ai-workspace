*&---------------------------------------------------------------------*
*& Include          ZAQMR0080_TOP   (전역 선언)
*&---------------------------------------------------------------------*
TABLES: mapl, plko.
INCLUDE <icon>.                       " 아이콘 상수(icon_create/change/delete)

*--- 상수 ------------------------------------------------------------*
CONSTANTS:
  gc_plnty_q TYPE plko-plnty VALUE 'Q',   " 작업계획타입: 검사계획
  gc_true    TYPE abap_bool  VALUE abap_true,
  gc_space   TYPE plko-loekz VALUE space.

*--- 그룹카운터(PLNAL) ↔ 단위(PLNME) 규칙 ----------------------------*
*  1=KG, 2=G, 3=L, 4=EA, 5=Other(1~4 이외 단위)
TYPES: BEGIN OF ty_unit_rule,
         counter TYPE c LENGTH 1,        " 규칙 키(1~5)
         meins   TYPE meins,             " 기대 단위
       END OF ty_unit_rule.
DATA gt_unit_rule TYPE STANDARD TABLE OF ty_unit_rule WITH EMPTY KEY.

*--- 출력/편집 구조 -------------------------------------------------*
TYPES: BEGIN OF ty_out,
         sel     TYPE flag,              " 선택(체크박스)
         werks   TYPE mapl-werks,        " 플랜트
         matnr   TYPE mapl-matnr,        " 자재번호
         plnnr   TYPE plko-plnnr,        " Group (검사그룹)
         plnal   TYPE plko-plnal,        " Group Counter
         ktext   TYPE plko-ktext,        " Description
         plnme   TYPE plko-plnme,        " 단위(Task List Unit)
         plnty   TYPE plko-plnty,        " 작업계획타입
         unit_ok TYPE flag,              " 단위검증 OK 여부
         msg     TYPE string,            " 검증/처리 메시지
         celltab TYPE lvc_t_styl,        " 셀 편집 스타일
       END OF ty_out.

DATA: gt_out TYPE STANDARD TABLE OF ty_out,
      gs_out TYPE ty_out.

*--- 변경 이력 테이블(ZAQMT0080) 작업영역 ---------------------------*
*    (DDIC 정의는 0program/ZAQMR0080/ZAQMT0080.ddic.txt 참조)
DATA: gt_hist TYPE STANDARD TABLE OF zaqmt0080,
      gs_hist TYPE zaqmt0080.

*--- ALV(클래식, 참조 ZAQMR0040 패턴) ------------------------------*
DATA: go_container     TYPE REF TO cl_gui_docking_container,
      go_splitter      TYPE REF TO cl_gui_splitter_container,
      go_container_top TYPE REF TO cl_gui_container,
      go_container_bot TYPE REF TO cl_gui_container,
      go_grid          TYPE REF TO cl_gui_alv_grid,
      go_dyndoc        TYPE REF TO cl_dd_document.

DATA: gs_layout  TYPE lvc_s_layo,
      gs_variant TYPE disvariant,
      gt_fcat    TYPE lvc_t_fcat,
      gt_excl    TYPE ui_functions.

DATA gv_okcode TYPE sy-ucomm.

*--- 선택 화면 ------------------------------------------------------*
SELECTION-SCREEN BEGIN OF BLOCK b1 WITH FRAME TITLE TEXT-001.
PARAMETERS:     p_plnty TYPE plko-plnty DEFAULT gc_plnty_q OBLIGATORY.  " 작업계획타입(Q)
SELECT-OPTIONS: s_werks FOR mapl-werks,        " 플랜트
                s_matnr FOR mapl-matnr,        " 자재번호
                s_plnnr FOR plko-plnnr,        " Inspection Group
                s_plnal FOR plko-plnal,        " Inspection Group Counter
                s_plnme FOR plko-plnme.        " 단위
SELECTION-SCREEN END OF BLOCK b1.
PARAMETERS p_vari TYPE disvariant-variant.     " ALV 레이아웃 변형
