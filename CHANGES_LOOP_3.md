# Loop 3 — 변경사항 (2026-07-02, 사용자 보고 버그 2건 즉시 수정)

사용자가 스크린샷으로 직접 제보한 2건의 "고질적인" 버그를 진단 후 즉시 수정.

## 1. gpt.html: 다운로드 버튼이 실제로 없는데 AI가 "다운로드하세요"라고 답함
**증상**: 사용자가 "MS Word 파일로 다운받게 해줘"라고 요청 → AI가 "이제 작성된 내용을
Word 파일로 다운로드할 수 있습니다"라고 답하지만 실제 버튼이 어디에도 없음.

**근본 원인**: `api/chat.js`의 `buildSystemPrompt()`가 모든 요청에 "이 앱은 모든 답변에
Excel·Word·PDF·PPT·TXT·Markdown 다운로드 버튼을 자동으로 붙여준다"고 무조건 안내하고
"파일을 준비하겠습니다" 같은 거짓 약속을 금지한다. `index.html`은 실제로 `renderAnswer()`가
매 답변에 다운로드 툴바를 붙이지만, **gpt.html은 이 기능이 아예 존재하지 않았다**(복사
버튼만 있었음). 백엔드가 모든 앱에 동일하게 약속하는데 gpt.html 프런트엔드만 그 약속을
지킬 방법이 없어 AI가 매번 빈 약속을 반복하던 구조적 버그.

**수정**: `index.html`의 다운로드 기능을 gpt.html의 렌더 구조(문자열 템플릿 + 메시지
인덱스 기반 onclick)에 맞춰 이식.
- `mdTableRows`/`splitTableRow`: 마크다운 표 파싱
- `mdExportHtml`: 표·헤더·코드펜스를 포함한 마크다운→HTML 변환(Word/PPT/PDF 생성용,
  화면표시용 `md()`와 별개)
- `downloadDocFromText`/`downloadPptFromText`: HTML-blob 트릭으로 Word(.doc)/PPT(.ppt) 생성
- `downloadPdfFromText`: html2canvas+jsPDF로 PDF 생성
- `xlsxUrlFromText`: 표 있으면 XLSX, 없으면 CSV
- 각 AI 메시지에 TXT/Word/PDF/PPT/Markdown 버튼 상시 부착 + 표가 있으면 Excel 버튼 추가
- 필요 라이브러리(xlsx/html2canvas/jspdf) CDN 스크립트 3개 추가, `.download-tools`/
  `.download-btn` CSS 추가

## 2. gpt.html: 자연어로 Drive 중첩 폴더를 물으면 "정확한 폴더명으로 다시 시도" 반복
**증상**: "구글 드라이브 폴더 내 StellaGpt 폴더 하위의 Chatgpt 폴더 하위에 보면 파일
리스트를 표로 정리해줘"처럼 자연스럽게 물으면 → "구글 드라이브의 특정 폴더 내용을 직접
조회할 수 없습니다. 정확한 폴더명으로 다시 시도하시거나…"만 반복.

**근본 원인**: `lib/drive-utils.js`의 `detectDrivePathText()`가 경로를 인식하는 조건이
`#`으로 시작하는 줄이거나, 메시지에 리터럴 "내 드라이브"/"My Drive" 문구가 있을 때뿐이었다.
"구글 드라이브"라는 표현이나 자연어 중첩 폴더 설명("A 폴더 하위의 B 폴더")은 전혀 인식하지
못해 `buildDriveContextForChat()`이 `null`을 반환 → 체념성 안내 메시지만 반복.

**수정**: `detectDrivePathText()`에 자연어 중첩 폴더 인식 분기 추가. 메시지에 Drive 신호
(드라이브/my·google drive/gdrive)와 "폴더"가 함께 있으면, 문장에 등장하는 "&lt;이름&gt; 폴더"
토큰을 등장 순서대로 이어붙여 경로로 재구성(하위/안/속/아래 등 연결어는 무시). "구글
드라이브 폴더" 자체의 "드라이브"는 경로가 아니므로 별도 필터로 제외. "폴더" 단어 없이
드라이브만 언급하는 일반 대화("구글 드라이브 정리하는 법 알려줘")는 오탐 없이 빈 문자열
유지.

## 테스트
- `test/gpt-download-tools.test.js` (신규, 8종): gpt.html의 실제 인라인 스크립트를
  jsdom에 그대로 실행해 `mdTableRows`/`mdExportHtml`/`render()`가 옳게 동작하는지,
  그리고 `downloadWordMsg(idx)` 클릭 시 실제로 다운로드 앵커가 생성·클릭되는지(Blob URL
  생성 포함)까지 end-to-end로 검증.
- `test/drive-link.test.js`: 자연어 중첩 폴더 경로 인식 4종 추가(양성 2 + 오탐 방지 1 +
  기존 형식 회귀 없음 1).
- 전체 회귀: **254/254 PASS**(기존 242 + 신규 12).
