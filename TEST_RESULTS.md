# TEST RESULTS — Stella Hub 비공개 레포 표시

실행 시각: 2026-06-18 16:09:44 UTC · node v22.22.2

## 변경
- api/github.js: action=repos(토큰 있으면 /user/repos 공개+비공개, 없으면 /users/{owner} 공개),
  action=contents(토큰 있으면 비공개 디렉터리/파일 읽기). 토큰은 서버 env에만(클라이언트 비노출).
- hub.html: 프록시 경유 목록 + 🔒비공개/🌐공개 배지, 비공개 레포 탐색·미리보기(base64),
  프록시 실패 시 비인증 공개 폴백.
- sw stella-v16 → v17.

## 정적 검증
- api/github.js node --check 통과 · hub.html 인라인 JS 문법 통과(bad=0).

## 동작 검증 — tests/test_hub.mjs (fetch 모킹, 무과금)
```
PASS  repos: ok + repos 배열(2)
PASS  repos: private 플래그 매핑(공개/비공개 구분)
PASS  repos: authenticated 필드 존재
PASS  contents dir → type=dir + items
PASS  contents file → type=file + base64 content
PASS  contents owner/repo 누락 → 400

총 6건: 6 PASS / 0 FAIL
```

## 회귀 (영향 없음)
- cc_ui: 총 7건: 7 PASS / 0 FAIL
- memory smoke: 총 16건: 16 PASS / 0 FAIL

## 배포 후 실제 동작(토큰 필요 — 외부 의존)
- Vercel env GITHUB_TOKEN(또는 GH_TOKEN/STELLA_GITHUB_TOKEN) 설정 시 → /hub 에 비공개 레포가 🔒 배지로 표시되고 탐색·미리보기 가능.
- 토큰 없으면 → 공개 레포만(🌐), 기존과 동일.

## 보안
- GitHub 토큰은 서버 프록시(api/github.js)에서만 사용. 클라이언트 코드/응답에 토큰 비노출. 시크릿 스캔 0.

---

# CSP 헤더 — Stella Hub unsafe-eval 허용

`npm test` → **# tests 54  # pass 54  # fail 0** (csp 6 신규).

## 변경
- vercel.json `headers[/(.*)]`에 Content-Security-Policy 추가.
  - **script-src에 'unsafe-eval' 포함**(작업 목표) + **'unsafe-inline'**(인라인 script/onclick 151개 보존).
  - style-src 'unsafe-inline'(인라인 style), img/media/connect/font: https:·data:·blob: 허용(Drive/GitHub/CDN/업로드 보존).
- sw.js stella-v19 → v20.

## 안전성(중요)
- 프롬프트 예시 CSP는 script-src에 'unsafe-inline'이 없어 그대로 적용 시 전 앱(인라인 스크립트+onclick) 마비.
  → 작업 목표('unsafe-eval')는 충족하되, 사이트가 깨지지 않도록 'unsafe-inline' + https/data/blob 호스트를 포함한 안전한 상위집합으로 적용.
- 기존 CSP 없음(신규 추가). rewrites/functions 전부 보존.

## 검증
- vercel.json JSON.parse 통과 · CSP에 unsafe-eval/unsafe-inline 단언 6/6.
- node --check sw.js 통과.
- 배포 후: /hub 콘솔 CSP eval 에러 사라짐 + 비공개 레포(api/github.js 프록시) 표시 + 미리보기는 실환경(Vercel 헤더)에서 확인.

---

# Stella Hub eval 제거 + CSP 보안 강화

`npm test` → **# tests 54  # pass 54  # fail 0** + jsdom 렌더 5/5.

## 진단
- hub.html에 **eval() 0건**(이미 esc()/textContent로 안전). 제거할 eval 없음 → 안전 렌더 강화 + CSP 하드닝으로 목표 달성.

## 변경
- hub.html: renderText(name,content) 추가 — JSON(JSON.parse+stringify pretty), 코드(highlight.js, 출력 이스케이프됨→XSS 안전), 폴백 textContent(평문). 미리보기 2곳(공개/비공개)을 renderText 경유로 통일.
- highlight.js CDN + 자체 토큰 CSS(테마 무관, 외부 CSS 불필요).
- vercel.json CSP: **script-src에서 'unsafe-eval' 제거**('unsafe-inline'은 유지 — 인라인 script/onclick/style 보존).
- sw stella-v20 → v21.

## 검증
- grep "eval(" hub.html = 0 · hub 인라인 JS new Function 검증 통과.
- csp.test.js: unsafe-eval 없음 + unsafe-inline 있음 단언.
- jsdom 5/5: JSON pretty, 코드 highlight, <script> 미실행(이스케이프), eval 미사용.
