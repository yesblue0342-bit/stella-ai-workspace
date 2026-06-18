*&---------------------------------------------------------------------*
*& Include          ZAQMR0080_F01   (FORM 루틴)
*&  조회 / 단위검증 / ALV 구성(참조 ZAQMR0040_F01 패턴) / Mass / 저장
*&---------------------------------------------------------------------*

*&---------------------------------------------------------------------*
*& Form select_data — MAPL ⋈ PLKO (PLNTY='Q') 조회 후 단위검증
*&  S/4HANA ABAP SQL 신문법: JOIN을 DB로 푸시다운, 호스트변수 @, INTO @gt_out
*&---------------------------------------------------------------------*
FORM select_data.
  CLEAR gt_out.

  SELECT a~werks,
         a~matnr,
         k~plnnr,
         k~plnal,
         k~ktext,
         k~plnme,
         k~plnty
    FROM mapl AS a
   INNER JOIN plko AS k
      ON  k~plnty = a~plnty
      AND k~plnnr = a~plnnr
      AND k~plnal = a~plnal
   WHERE a~plnty  = @p_plnty          " 검사계획(Q) 만 — 라우팅(N) 비대상
     AND a~werks IN @s_werks
     AND a~matnr IN @s_matnr
     AND k~plnnr IN @s_plnnr
     AND k~plnal IN @s_plnal
     AND k~plnme IN @s_plnme
     AND a~loekz  = @gc_space          " 자재할당 삭제표시 제외
     AND k~loekz  = @gc_space          " 작업계획 삭제표시 제외
    INTO CORRESPONDING FIELDS OF TABLE @gt_out.

  " 그룹카운터 ↔ 단위 규칙 검증
  PERFORM build_unit_rule.
  LOOP AT gt_out ASSIGNING FIELD-SYMBOL(<o>).
    PERFORM check_unit_rule CHANGING <o>.
  ENDLOOP.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form build_unit_rule — 1=KG, 2=G, 3=L, 4=EA, 5=Other
*&---------------------------------------------------------------------*
FORM build_unit_rule.
  IF gt_unit_rule IS NOT INITIAL. RETURN. ENDIF.
  gt_unit_rule = VALUE #(
    ( counter = '1' meins = 'KG' )
    ( counter = '2' meins = 'G'  )
    ( counter = '3' meins = 'L'  )
    ( counter = '4' meins = 'EA' ) ).
  " '5' 이상은 Other(임의 단위 허용) → 규칙 테이블에 두지 않는다.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form check_unit_rule — 단일 행 단위검증 (CHANGING)
*&---------------------------------------------------------------------*
FORM check_unit_rule CHANGING cs_out TYPE ty_out.
  DATA(lv_key) = condense( cs_out-plnal ).
  " 그룹카운터의 마지막 숫자를 규칙 키로 사용 (예: '01'→1, '4'→4)
  SHIFT lv_key LEFT DELETING LEADING '0 '.
  IF strlen( lv_key ) > 1. lv_key = lv_key+0(1). ENDIF.

  CLEAR: cs_out-unit_ok, cs_out-msg.
  READ TABLE gt_unit_rule INTO DATA(ls_rule)
       WITH KEY counter = lv_key.
  IF sy-subrc <> 0.
    " 5=Other: 규칙 외 → 검증 통과(정보)
    cs_out-unit_ok = gc_true.
    RETURN.
  ENDIF.

  IF to_upper( condense( cs_out-plnme ) ) = to_upper( condense( ls_rule-meins ) ).
    cs_out-unit_ok = gc_true.
  ELSE.
    cs_out-unit_ok = space.
    cs_out-msg = |{ TEXT-w01 } GC={ cs_out-plnal } | &&
                 |단위={ cs_out-plnme }(기대 { ls_rule-meins })|.
    " TEXT-w01 : 'Group Counter와 단위 규칙을 점검하세요(1=KG,2=G,3=L,4=EA,5=Other).'
  ENDIF.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form set_fcat_layout — 레이아웃 + 필드카탈로그 (편집형)
*&---------------------------------------------------------------------*
FORM set_fcat_layout.
  gs_layout = VALUE #( zebra      = 'X'
                       cwidth_opt = 'A'
                       sel_mode   = 'A'      " 셀 선택
                       box_fname  = 'SEL' ).
  gs_variant-variant = p_vari.

  gt_fcat = VALUE #(
    ( fieldname = 'WERKS' ref_table = 'MAPL' coltext = '플랜트'        outputlen = 6 )
    ( fieldname = 'MATNR' ref_table = 'MAPL' coltext = '자재번호'      outputlen = 18 )
    ( fieldname = 'PLNNR' ref_table = 'PLKO' coltext = 'Group'         outputlen = 10 edit = 'X' )
    ( fieldname = 'PLNAL' ref_table = 'PLKO' coltext = 'Group Counter' outputlen = 8  edit = 'X' )
    ( fieldname = 'KTEXT' ref_table = 'PLKO' coltext = 'Description'    outputlen = 30 )
    ( fieldname = 'PLNME' ref_table = 'PLKO' coltext = '단위'          outputlen = 6  edit = 'X' )
    ( fieldname = 'PLNTY' ref_table = 'PLKO' coltext = '작업계획타입'  outputlen = 4 )
    ( fieldname = 'UNIT_OK' coltext = '단위검증' checkbox = 'X' outputlen = 6 )
    ( fieldname = 'MSG'   coltext = '메시지'      outputlen = 40 ) ).

  " 편집 불가 표준 툴바 일부 제외(필요 최소)
  gt_excl = VALUE #( ( cl_gui_alv_grid=>mc_fc_loc_copy_row )
                     ( cl_gui_alv_grid=>mc_fc_loc_insert_row )
                     ( cl_gui_alv_grid=>mc_fc_loc_append_row ) ).
ENDFORM.

*&---------------------------------------------------------------------*
*& Form create_grid_container — 도킹 컨테이너 + 스플리터 + 그리드
*&  (참조 ZAQMR0040_F01 의 create_grid_container 동일 패턴)
*&---------------------------------------------------------------------*
FORM create_grid_container.
  go_container = NEW cl_gui_docking_container(
                   side      = cl_gui_docking_container=>dock_at_left
                   extension = 5000 ).
  go_splitter  = NEW cl_gui_splitter_container(
                   parent  = go_container
                   rows    = 2
                   columns = 1 ).
  go_container_top = go_splitter->get_container( row = 1 column = 1 ).
  go_container_bot = go_splitter->get_container( row = 2 column = 1 ).
  go_splitter->set_row_height( id = 1 height = 12 ).

  go_grid = NEW cl_gui_alv_grid( i_parent = go_container_bot ).
ENDFORM.

*&---------------------------------------------------------------------*
*& Form set_event — 이벤트 핸들러 등록
*&---------------------------------------------------------------------*
FORM set_event.
  SET HANDLER:
    lcl_event_handler=>handler_toolbar      FOR go_grid,
    lcl_event_handler=>handler_user_command FOR go_grid,
    lcl_event_handler=>handler_data_changed FOR go_grid,
    lcl_event_handler=>handler_double_click FOR go_grid,
    lcl_event_handler=>handler_top_of_page  FOR go_grid.
  " 인라인 편집 변경 즉시 감지(ENTER/셀이동 시 data_changed)
  go_grid->register_edit_event( cl_gui_alv_grid=>mc_evt_modified ).
  go_grid->register_edit_event( cl_gui_alv_grid=>mc_evt_enter ).
ENDFORM.

*&---------------------------------------------------------------------*
*& Form set_top_of_page — top-of-page 영역 객체 생성
*&---------------------------------------------------------------------*
FORM set_top_of_page.
  go_dyndoc = NEW cl_dd_document( ).
ENDFORM.

*&---------------------------------------------------------------------*
*& Form build_top_of_page — 헤더(건수/경고수) 출력
*&---------------------------------------------------------------------*
FORM build_top_of_page USING io_dyndoc TYPE REF TO cl_dd_document.
  DATA(lv_tot)  = lines( gt_out ).
  DATA(lv_warn) = REDUCE i( INIT x = 0 FOR <w> IN gt_out
                            NEXT x = COND #( WHEN <w>-unit_ok = space THEN x + 1 ELSE x ) ).
  io_dyndoc->add_text(
    text         = |[QM] Material Assignment / Inspection Group  · 총 { lv_tot } 건 · 단위경고 { lv_warn } 건|
    sap_emphasis = cl_dd_document=>strong ).
  io_dyndoc->merge_document( ).
  io_dyndoc->display_document( parent = go_container_top ).
ENDFORM.

*&---------------------------------------------------------------------*
*& Form display_alv — 최초 표시
*&---------------------------------------------------------------------*
FORM display_alv.
  go_grid->set_table_for_first_display(
    EXPORTING
      is_layout            = gs_layout
      is_variant           = gs_variant
      i_save               = 'A'
      it_toolbar_excluding = gt_excl
    CHANGING
      it_outtab            = gt_out
      it_fieldcatalog      = gt_fcat ).
  PERFORM build_top_of_page USING go_dyndoc.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form refresh_grid — 갱신(편집 후/Mass 후)
*&---------------------------------------------------------------------*
FORM refresh_grid.
  DATA ls_stbl TYPE lvc_s_stbl.
  ls_stbl-row = 'X'. ls_stbl-col = 'X'.
  go_grid->refresh_table_display( is_stable = ls_stbl i_soft_refresh = 'X' ).
ENDFORM.

*&---------------------------------------------------------------------*
*& Form on_data_changed — 인라인 편집 후 단위 재검증
*&---------------------------------------------------------------------*
FORM on_data_changed USING ir_dc TYPE REF TO cl_alv_changed_data_protocol.
  LOOP AT ir_dc->mt_good_cells INTO DATA(ls_good).
    READ TABLE gt_out ASSIGNING FIELD-SYMBOL(<o>) INDEX ls_good-row_id.
    IF sy-subrc = 0.
      PERFORM check_unit_rule CHANGING <o>.
    ENDIF.
  ENDLOOP.
  PERFORM refresh_grid.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form mass_assign / mass_change / mass_delete (선택 행 대상)
*&---------------------------------------------------------------------*
FORM mass_assign.
  PERFORM mark_selected USING 'A'.   " A=Assign
ENDFORM.
FORM mass_change.
  PERFORM mark_selected USING 'C'.   " C=Change
ENDFORM.
FORM mass_delete.
  PERFORM mark_selected USING 'D'.   " D=Delete(소프트)
ENDFORM.

FORM mark_selected USING iv_mode TYPE c.
  DATA(lv_cnt) = 0.
  LOOP AT gt_out ASSIGNING FIELD-SYMBOL(<o>) WHERE sel = gc_true.
    " 단위 불일치 행은 경고 후 건너뜀(데이터 무결성 우선)
    IF <o>-unit_ok = space AND iv_mode <> 'D'.
      <o>-msg = TEXT-w01.   " 단위 규칙 점검 필요 → 처리 보류
      CONTINUE.
    ENDIF.
    <o>-msg = SWITCH #( iv_mode
                        WHEN 'A' THEN 'Assign 대기'
                        WHEN 'C' THEN 'Change 대기'
                        WHEN 'D' THEN 'Delete 대기' ).
    lv_cnt += 1.
  ENDLOOP.
  IF lv_cnt = 0.
    MESSAGE TEXT-i02 TYPE 'S' DISPLAY LIKE 'W'.   " 처리할 항목을 선택하세요.
  ELSE.
    MESSAGE |{ lv_cnt } 건 표시되었습니다. 저장(SAVE) 시 반영됩니다.| TYPE 'S'.
  ENDIF.
  PERFORM refresh_grid.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form save_data — 선택 행을 변경이력 테이블 ZAQMT0080 에 반영
*&  생성: ERNAM/ERDAT/ERZET, 변경: AENAM/AEDAT/AEZET, 삭제: LOEKZ='X'
*&---------------------------------------------------------------------*
FORM save_data.
  DATA lt_upd TYPE STANDARD TABLE OF zaqmt0080.
  DATA(lv_now_d) = sy-datum.
  DATA(lv_now_t) = sy-uzeit.

  LOOP AT gt_out INTO gs_out WHERE sel = gc_true.
    IF gs_out-unit_ok = space.
      CONTINUE.   " 단위 불일치는 저장 제외
    ENDIF.

    " 기존 이력 존재 여부 → 생성/변경 구분
    SELECT SINGLE * FROM zaqmt0080 INTO @DATA(ls_exist)
      WHERE werks = @gs_out-werks
        AND matnr = @gs_out-matnr
        AND plnnr = @gs_out-plnnr
        AND plnal = @gs_out-plnal.

    CLEAR gs_hist.
    gs_hist-werks  = gs_out-werks.
    gs_hist-matnr  = gs_out-matnr.
    gs_hist-plnnr  = gs_out-plnnr.
    gs_hist-plnal  = gs_out-plnal.
    gs_hist-plnme  = gs_out-plnme.        " Task List Unit
    gs_hist-zernam = sy-uname.

    IF sy-subrc = 0.
      " 변경 이력
      gs_hist-ernam = ls_exist-ernam.
      gs_hist-erdat = ls_exist-erdat.
      gs_hist-erzet = ls_exist-erzet.
      gs_hist-aenam = sy-uname.
      gs_hist-aedat = lv_now_d.
      gs_hist-aezet = lv_now_t.
      gs_hist-loekz = space.
    ELSE.
      " 신규 생성
      gs_hist-ernam = sy-uname.
      gs_hist-erdat = lv_now_d.
      gs_hist-erzet = lv_now_t.
      gs_hist-loekz = space.
    ENDIF.

    " 삭제 표시(소프트) — Mass Delete 로 표시된 건
    IF gs_out-msg CS 'Delete'.
      gs_hist-loekz = 'X'.
      gs_hist-aenam = sy-uname.
      gs_hist-aedat = lv_now_d.
      gs_hist-aezet = lv_now_t.
    ENDIF.

    APPEND gs_hist TO lt_upd.
  ENDLOOP.

  IF lt_upd IS INITIAL.
    MESSAGE TEXT-i02 TYPE 'S' DISPLAY LIKE 'W'.   " 처리할 항목을 선택하세요.
    RETURN.
  ENDIF.

  MODIFY zaqmt0080 FROM TABLE lt_upd.
  IF sy-subrc = 0.
    COMMIT WORK AND WAIT.
    MESSAGE |{ lines( lt_upd ) } 건 저장(이력 반영) 완료.| TYPE 'S'.
  ELSE.
    ROLLBACK WORK.
    MESSAGE TEXT-e02 TYPE 'E'.   " 저장 중 오류가 발생했습니다.
  ENDIF.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form show_inspection_plan — 더블클릭 시 QP03 호출(검사계획 표시)
*&---------------------------------------------------------------------*
FORM show_inspection_plan USING is_out TYPE ty_out.
  SET PARAMETER ID 'PETP' FIELD is_out-plnty.   " Task list type
  SET PARAMETER ID 'PLN'  FIELD is_out-plnnr.   " Group
  SET PARAMETER ID 'PAL'  FIELD is_out-plnal.   " Group Counter
  SET PARAMETER ID 'WRK'  FIELD is_out-werks.   " Plant
  CALL TRANSACTION 'QP03' AND SKIP FIRST SCREEN.
ENDFORM.
