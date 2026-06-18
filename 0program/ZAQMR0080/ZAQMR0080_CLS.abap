*&---------------------------------------------------------------------*
*& Include          ZAQMR0080_CLS   (ALV 이벤트 핸들러)
*&  참조 ZAQMR0040_CLS 패턴 — toolbar/user_command/data_changed/
*&  double_click/hotspot_click/top_of_page
*&---------------------------------------------------------------------*
CLASS lcl_event_handler DEFINITION FINAL.
  PUBLIC SECTION.
    CLASS-METHODS:
      handler_toolbar      FOR EVENT toolbar      OF cl_gui_alv_grid
        IMPORTING e_object,
      handler_user_command FOR EVENT user_command OF cl_gui_alv_grid
        IMPORTING e_ucomm,
      handler_data_changed FOR EVENT data_changed OF cl_gui_alv_grid
        IMPORTING er_data_changed,
      handler_double_click FOR EVENT double_click OF cl_gui_alv_grid
        IMPORTING e_row e_column,
      handler_top_of_page  FOR EVENT top_of_page  OF cl_gui_alv_grid
        IMPORTING e_dyndoc_id.
ENDCLASS.

CLASS lcl_event_handler IMPLEMENTATION.

  METHOD handler_toolbar.
    " 사용자 정의 툴바: Assign / Change / Delete (Mass)
    APPEND VALUE #( butn_type = 3 ) TO e_object->mt_toolbar.            " separator
    APPEND VALUE #( function  = 'ASSIGN'
                    icon      = icon_create
                    quickinfo = 'Mass Assignment'
                    text      = 'Assign' ) TO e_object->mt_toolbar.
    APPEND VALUE #( function  = 'CHANGE'
                    icon      = icon_change
                    quickinfo = 'Mass Change'
                    text      = 'Change' ) TO e_object->mt_toolbar.
    APPEND VALUE #( function  = 'DELETE'
                    icon      = icon_delete
                    quickinfo = 'Mass Delete'
                    text      = 'Delete' ) TO e_object->mt_toolbar.
  ENDMETHOD.

  METHOD handler_user_command.
    CASE e_ucomm.
      WHEN 'ASSIGN'. PERFORM mass_assign.
      WHEN 'CHANGE'. PERFORM mass_change.
      WHEN 'DELETE'. PERFORM mass_delete.
    ENDCASE.
  ENDMETHOD.

  METHOD handler_data_changed.
    " 그룹카운터/단위 인라인 변경 시 단위 규칙 재검증
    PERFORM on_data_changed USING er_data_changed.
  ENDMETHOD.

  METHOD handler_double_click.
    " 더블클릭 → 해당 자재의 검사계획(QP03) 표시
    READ TABLE gt_out INTO gs_out INDEX e_row-index.
    IF sy-subrc = 0.
      PERFORM show_inspection_plan USING gs_out.
    ENDIF.
  ENDMETHOD.

  METHOD handler_top_of_page.
    PERFORM build_top_of_page USING e_dyndoc_id.
  ENDMETHOD.

ENDCLASS.
