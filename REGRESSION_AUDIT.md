# Stella GPT 회귀 전수 감사 (baseline c28a928 .. HEAD)

> 직전 2개 auto 커밋 검사: 1c238e1(라우팅+표 온디맨드), b4f2009(마크다운 렌더 교체).
> index.html 실제 diff는 +7/-2(3줄). 복사/내보내기 함수 코드는 **삭제되지 않았고**(renderMarkdownLite·stellaCopyText·xlsxUrlFromText·downloadDocFromText 전부 잔존), 렌더 경로 전환으로 일부 기능이 **호출되지 않게** 됨.

| 기능 | 제거/변경 위치 | 판정 | 근거·조치 |
|------|----------------|------|-----------|
| 코드블록 인라인 복사 버튼 | b4f2009: marked 성공 시 renderMarkdownLite 미호출 → 그 안의 copy-btn 미생성 | **RESTORE** | js/stella-md.js가 marked 렌더 후 `<pre>`에 복사 버튼 부착(addCopyButtons). 기존 stellaCopyText/토스트 재사용 |
| 표 복사(TSV, 엑셀 붙여넣기) | 동상 | **RESTORE** | stella-md.js가 `<table>` 위에 "표 복사"(TSV) 툴바 추가 |
| Excel 다운로드(.xlsx) | renderAnswer의 메시지 레벨 도구는 유지됨(xlsxUrlFromText=SheetJS 실파일) | **KEEP(이미 정상)** | 이미 진짜 .xlsx. lib/exporters.mjs(TSV/CSV/AOA/파일명) 추가로 테스트 가드 |
| Word/MD/TXT 다운로드 | renderAnswer 유지 | KEEP | 변경 없음 |
| 검색 동작(맛집·장소·실시간) | 1c238e1: needsWebSearch 게이트가 맛집/장소 미포함 → 검색 안 함 → 환각 | **RESTORE+개선** | needsWebSearch 게이트 삭제, web_search 상시 제공·모델이 결정(gpt-4o) |
| Google Drive 검색(#구글드라이브/#폴더) | 서버 needsDrive 분기 유지(aiMessage 주입) | KEEP+우선분기 | 라우팅에서 needsDrive면 web_search 미제공(Drive 우선) |
| 날씨(Open-Meteo/스마트) | 서버 weather 조기반환 유지(라우팅 이전) | KEEP | 변경 없음 |
| 메모리 노드(kh_memory) 주입 | routeSystemPrompt extra로 보존 | KEEP | memoryPrompt를 extra에 합침 |
| 이미지 첨부/OCR | callResponses input_image + 프론트 OCR 폴백 유지 | KEEP | 변경 없음 |
| 강제 표 출력 / "엑셀용 마크다운 덤프" | 표 온디맨드로 전환 | **KEEP-CHANGED(의도)** | 복원 안 함. 실제 다운로드 버튼이 대체 |

## 요약: RESTORE 3건(코드복사·표복사·검색) / KEEP 6건 / KEEP-CHANGED 1건(강제표). 신규 손실 없음(함수 코드 잔존, 렌더경로만 보강).
