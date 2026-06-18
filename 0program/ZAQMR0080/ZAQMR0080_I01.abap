*&---------------------------------------------------------------------*
*& Include          ZAQMR0080_I01   (PAI)   참조 ZAQMR0040_I01 패턴
*&---------------------------------------------------------------------*
MODULE user_command_0100 INPUT.
  DATA(lv_ucomm) = gv_okcode.
  CLEAR gv_okcode.

  " 그리드의 사용자 편집내용을 내부테이블로 반영
  IF go_grid IS BOUND.
    go_grid->check_changed_data( ).
  ENDIF.

  CASE lv_ucomm.
    WHEN 'SAVE'.   PERFORM save_data.       " ZAQMT0080 이력 저장
    WHEN 'ASSIGN'. PERFORM mass_assign.
    WHEN 'CHANGE'. PERFORM mass_change.
    WHEN 'DELETE'. PERFORM mass_delete.
  ENDCASE.
ENDMODULE.

MODULE exit_0100 INPUT.
  CASE gv_okcode.
    WHEN 'BACK' OR 'CANC'.
      CLEAR gv_okcode.
      LEAVE TO SCREEN 0.
    WHEN 'EXIT'.
      CLEAR gv_okcode.
      LEAVE PROGRAM.
  ENDCASE.
ENDMODULE.
