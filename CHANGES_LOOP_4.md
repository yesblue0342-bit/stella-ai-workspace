# Loop 4 — 진짜 원인 수정 (2026-07-02, 다운로드 버튼 고질 버그의 실제 진범)

## 배경: 앞선 수정(Loop 3)이 엉뚱한 파일이었음
사용자 스크린샷의 모델 표시가 **"GPT-4.1 Mini 빠른 응답"**인데, 이 라벨(`빠른 응답`
접미사 + `모델` 라벨 + `<select>`)은 **index.html**(메인 Stella GPT, `/`로 서빙)의 UI다.
gpt.html은 커스텀 `modelBtn` 버튼에 "GPT-4.1 Mini"(접미사 없음)로만 표시한다. 즉
사용자는 gpt.html이 아니라 **index.html**을 쓰고 있었고, Loop 3의 gpt.html 이식은
필요는 했으나 사용자가 겪던 그 화면은 아니었다.

## 진짜 원인: renderAnswer의 렌더 순서 버그 (index.html)
`index.html`은 이미 `renderAnswer()`에 다운로드 툴바 생성 코드가 있었다. 그런데 순서가:
1. `el.appendChild(tools)` — 버블에 다운로드 버튼 툴바를 붙임
2. `stellaRenderMarkdown(el, text)` — 이 함수는 `el.innerHTML = ...`(js/stella-md.js:139)로
   **el 내용을 통째로 교체** → 방금 붙인 툴바가 지워짐

marked+DOMPurify가 로드되는 정상 환경(index.html은 둘 다 CDN 로드)에서는 항상 innerHTML
경로를 타서 **버튼이 매번 삭제**됐다. CDN이 안 뜨는 폴백(`renderMarkdownLite`, appendChild
방식)에서만 우연히 살아남아, "어떤 땐 되고 어떤 땐 안 되는" 고질 증상으로 나타났다.

시스템 프롬프트(api/chat.js)는 "모든 답변에 다운로드 버튼이 자동으로 붙는다"고 모델에
안내하므로, AI는 "복사하면 Word로 저장할 수 있습니다"라고 (프롬프트 지시대로) 답하지만
정작 버튼은 innerHTML 덮어쓰기로 사라져 있어 사용자에겐 빈 약속만 남았다.

## 수정
`renderAnswer()`의 순서를 뒤집었다: **마크다운을 먼저 렌더한 뒤 툴바를 append**.
- innerHTML 교체가 먼저 일어나고, 그 다음 툴바가 붙으므로 버튼이 항상 살아남는다.
- 툴바가 답변 "아래"에 위치 → 사용자 기대(답변 밑 다운로드 버튼)와도 일치(UX 개선).

## 캐시
- `sw.js` CACHE 버전 v113 → **v114**로 올려 옛 캐시 전부 무효화(activate 시 삭제).
  ※ sw.js는 원래 HTML을 네트워크 우선(no-store)으로 서빙하므로 index.html 인라인 수정은
    새로고침 시 즉시 반영되지만, 재발 의심을 확실히 없애기 위해 버전 범프.

## 다른 앱 점검
- abap.html renderAnswer(line 1132)은 `renderMarkdownLite`(appendChild=additive)를 직접
  호출 → innerHTML 덮어쓰기 없음 → 버그 없음(버튼 정상).
- gpt.html(Loop 3)은 툴바를 innerHTML 템플릿 문자열에 직접 넣어 렌더 → 덮어쓰기 없음 → 정상.
- codex.html/cloud.html 등은 해당 툴바 기능 없음(대상 아님).

## 테스트
- `test/index-download-survive.test.js`(신규, 4종): marked+DOMPurify를 스텁해 실제
  프로덕션 조건(innerHTML 경로)을 재현하고, 렌더 후에도 `.download-tools` 툴바가
  버블에 남아 있는지 검증. 버그 버전으로 되돌리면 3/4 실패, 수정본에서 4/4 통과함을
  실제로 확인(테스트가 진짜 버그를 잡음을 검증).
- 전체 회귀: **258/258 PASS**(기존 254 + 신규 4).
