# PC 이미지 캡쳐 붙여넣기(paste) 회귀 수정 — Stella GPT / Stella ABAP

## 증상
PC에서 화면 캡쳐 후 채팅 입력창에 **붙여넣기(Ctrl+V)가 갑자기 안 됨**(이미지 첨부 안 됨).

## 근본 원인 (진단)
최근 `vercel.json`에 추가된 **CSP(Content-Security-Policy)** 의 `script-src 'self' 'unsafe-inline' https:` 에
**`'wasm-unsafe-eval'` 누락**.
→ 붙여넣은 이미지를 처리하는 `extractFile()`이 **Tesseract.js OCR(WebAssembly)** 를 호출하는데,
WASM 인스턴스화가 CSP에 막혀 `recognize()`가 **실패/지연(hang)** → `processFiles`의 `await`가 끝나지 않아
**칩(첨부) 렌더가 안 됨** = "붙여넣기 안 됨"으로 보임. (CSP 도입 시점과 회귀 시점 일치)

## 수정
### 1) `vercel.json` — CSP에 WASM 허용
`script-src 'self' 'unsafe-inline' https:` → **`'self' 'unsafe-inline' 'wasm-unsafe-eval' https:`**
→ Tesseract OCR(WASM) 정상화. (Clover 등 다른 앱의 WASM/OCR도 함께 복구)

### 2) `index.html`(Stella GPT) + `abap.html`(Stella ABAP) — OCR 비차단(timeout)
`extractFile()`의 OCR 호출을 `Promise.race([Tesseract.recognize(...), 20s timeout])` 으로 감쌈.
→ **OCR이 실패/지연돼도 이미지 첨부는 항상 완료**(최대 20초). OCR 결과는 있으면 텍스트로 부가, 없으면 "[OCR 오류]" 표기(기존 try/catch 유지).

### 3) 두 앱 — paste 핸들러 견고화
`clipboardData.items`(kind==='file')만 보던 것을 → **`clipboardData.files` 폴백** + `kind==='file'` 확인 추가.
→ 브라우저/OS별 클립보드 차이(일부는 items 비고 files만 채움)에도 캡쳐 이미지 인식.

### 4) Service Worker 캐시 bump (프론트 변경 반영)
`stella-v27 → v28`

## 테스트 결과
| # | 테스트 | 결과 |
|---|--------|------|
| 1 | `vercel.json` `JSON.parse` 유효 | ✅ |
| 2 | CSP `script-src`에 `'wasm-unsafe-eval'` 포함 | ✅ |
| 3 | index.html 인라인 JS `new Function` 파싱 | bad=0 ✅ |
| 4 | abap.html 인라인 JS `new Function` 파싱 | bad=0 ✅ |
| 5 | paste 핸들러 `clipboardData.files` 폴백 (양쪽) | ✅ |
| 6 | paste 핸들러 `kind==='file'` 확인 (양쪽) | ✅ |
| 7 | OCR `Promise.race` 타임아웃 적용 (양쪽) | ✅ |
| 8 | OCR 실패 시 `[OCR 오류]` 폴백 유지(첨부 보존) | ✅ |
| 9 | SW 캐시 v27→v28 | ✅ |

## 한계 (정직)
- 배포 보호(403)로 라이브 브라우저 검증 불가 → 정적 검증(JSON.parse·new Function)·grep으로 대체.
- 실제 확인: 배포 후 PC 브라우저에서 캡쳐→Ctrl+V 시 ① 즉시 이미지 칩 첨부 ② (잠시 후) OCR 텍스트 부가 ③ DevTools 콘솔에 CSP 'wasm-unsafe-eval' 위반 0건 인지 확인 권장.

## 가정 로그
- 근본 원인을 CSP-WASM으로 판단(회귀 타이밍·OCR 의존). 단일 원인이 아닐 가능성에 대비해 paste 핸들러 견고화 + OCR 비차단까지 **삼중 방어**로 처리(어느 경로든 이미지 첨부는 보장).
- CSP에 `'unsafe-eval'`(전체) 대신 **`'wasm-unsafe-eval'`(WASM 한정)** 만 추가 — 보안 영향 최소화.
