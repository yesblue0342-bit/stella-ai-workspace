STATUS: DONE (코드) — 동작 전제: GITHUB_TOKEN(비공개용)·PROXY_SECRET(비공개 게이트)·ALLOWED_* env

# GitHub 차단망 우회 — Vercel serverless 프록시 (1-hop)

브라우저가 GitHub(api.github.com/raw.githubusercontent.com)를 **직접 호출하지 않고**,
내 Vercel 함수를 1단계 거쳐 접근한다. GitHub가 막힌 네트워크에서도 Stella Hub·앱이 동작.

## 작업 A — 프록시 함수 (STELLA_REPO)
| 파일 | 역할 |
|------|------|
| `lib/gh-proxy.mjs` | 공통: allowlist, CORS echo, public/private 판별(콜드스타트 캐시), 토큰(env), PROXY_SECRET 게이트, assertSafePath, 타임아웃 |
| `api/gh-list.js` | `?repo=owner/name&path=&ref=` → 디렉터리 목록 JSON |
| `api/gh-file.js` | `?repo=&path=&ref=&disp=` → 원본 바이트 스트리밍(RFC5987 한글 파일명). `?zip=1` → zipball 스트림 파이프(버퍼 안 함) |

- **allowlist(`ALLOWED_REPOS`)**: `yesblue0342-bit/stella-ai-workspace`, `yesblue0342-bit/Leehu`만 서빙(대소문자 무시). 그 외 **403**(오픈 프록시 차단). 0Program 등 비허용.
- **public/private**: `GET /repos/{owner}/{repo}`의 `private` 필드로 판별 후 메모리 캐시. private면 `GITHUB_TOKEN` + Contents raw, public도 동일 경로(토큰 있으면 사용). **토큰 클라이언트 노출 0**.
- **CORS**: 요청 Origin이 `ALLOWED_ORIGINS`(이후.com 유니코드+punycode, VERCEL_BASE)면 그 값 echo(`*` 금지). `OPTIONS`→204.
- **비공개 게이트**: private repo 요청에만 `PROXY_SECRET`(헤더 `x-proxy-secret` 또는 `?secret=`) 요구. public은 게이트 없음.
- 실패 시 GitHub status 전달 + JSON 에러, `AbortController` 타임아웃.

## 작업 B — Stella Hub 프론트(hub.html)
- 브라우저의 **GitHub 직접 호출 제거**: `ghApi()`(api.github.com) 함수 삭제.
  - 레포 목록 = `/api/github?action=repos`(서버)만 사용.
  - 디렉터리 폴백 = `/api/gh-list`(same-origin 프록시)로 교체.
  - 다운로드/미리보기 = `/api/gh-download`(same-origin) 사용(이전 작업).
- 결과: hub.html에 `api.github.com`/`raw.githubusercontent.com` **0건**. SW 캐시 bump.

## "모든 앱 1-hop via Vercel" 확인
- index.html(Stella GPT)·cc.html·abap.html·talk.html·db.html·gpt.html·cloud.html: 클라이언트의 GitHub 직접 호출 **0건**(grep 확인). 이들은 이미 `/api/chat`·`/api/github`·`/api/cc/*` 등 **서버사이드**로 GitHub 접근 → 브라우저→Vercel→GitHub = **이미 1-hop 우회**.
- 따라서 추가 변경이 필요한 클라이언트는 **Hub 하나뿐**이었고, 위에서 처리 완료.

## 작업 C — 이후.com(Leehu)
- Leehu `index.html`/worker에 **GitHub 런타임 호출·외부 fetch 0건**(정적 사이트, 자기 콘텐츠 직접 서빙) → 케이스 (1)/(2) **해당 없음**. 차단망에서 이미 정상 동작. (별도 PROGRESS는 Leehu repo에 기록)
- 향후 이후.com이 STELLA_REPO 파일을 받을 일이 생기면: `https://VERCEL_BASE/api/gh-file?repo=yesblue0342-bit/stella-ai-workspace&path=...`(CORS 허용됨) 사용.

## 엔드포인트 사용법
- 목록: `GET /api/gh-list?repo=yesblue0342-bit/stella-ai-workspace&path=lib&ref=main`
- 파일: `GET /api/gh-file?repo=...&path=README.md&disp=inline`  (다운로드는 `disp` 생략=attachment)
- 폴더 zip: `GET /api/gh-file?repo=...&zip=1`
- 비공개 repo(allowlist에 추가 시): 헤더 `x-proxy-secret: <PROXY_SECRET>` 필요.

## 차단망 다운로드 확인 절차
1. 브라우저 DevTools Network 열기.
2. Stella Hub에서 레포 열기 → 파일 다운로드.
3. 요청 호스트가 **Vercel 도메인만**(api.github.com/raw.githubusercontent.com 0건)인지 확인.
4. 파일이 실제로 열리는지(텍스트/이미지/바이너리) 확인.

## 가정 로그 / 한계
1. `node --check` 통과(gh-proxy.mjs, gh-list.js, gh-file.js), hub 인라인 JS `new Function` OK, allowlist/CORS 런타임 스모크 OK.
2. env 필요: `GITHUB_TOKEN`(비공개·레이트리밋 완화), `PROXY_SECRET`(비공개 게이트), 필요시 `ALLOWED_REPOS`/`ALLOWED_ORIGINS`/`VERCEL_BASE` override. 미설정 시 공개 repo는 동작, 비공개는 503/401.
3. ALLOWED_REPOS·ALLOWED_ORIGINS는 코드 기본값에 두 repo와 이후.com을 내장 → env 없이도 공개 동작.
4. 배포 보호(403)로 외부 URL 검증 불가 → 정적 검증 + 런타임 스모크로 대체.
5. `vercel.json` 미수정(요청대로). `api/` 자동 함수 인식.
