*&---------------------------------------------------------------------*
*& Include          ZAQMR0080_O01   (PBO)   참조 ZAQMR0040_O01 패턴
*&---------------------------------------------------------------------*
MODULE status_0100 OUTPUT.
  SET PF-STATUS '0100'.
  SET TITLEBAR  '0100' WITH TEXT-m01.   " [QM] Material Assignment for Inspection Group
ENDMODULE.

MODULE create_alv OUTPUT.
  IF go_container IS NOT BOUND.
    PERFORM set_fcat_layout.
    PERFORM create_grid_container.
    PERFORM set_event.
    PERFORM set_top_of_page.
    PERFORM display_alv.
  ELSE.
    PERFORM refresh_grid.
  ENDIF.
ENDMODULE.
