# WORK_REPORT — 무인 자동 개발 세션 (2026-07-10)

## 요약

500라인 초과 **소스 파일 2개**(`api/chat.js`, `lib/drive-utils.js`)와 프롬프트가 지목한
**Claude 앱 프런트엔드**(`cc.html`)를 기능 단위 모듈로 분리했다. 분리 과정에서 실제 버그 1건
(cc.html VFF 토글 미저장)을 발견해 고쳤고, 중복 코드 6곳을 제거했으며, API 비용 절감 3건을 적용했다.

테스트는 **336 → 400 pass, 0 fail**(신규 64개). 남은 500라인 초과 파일은 HTML 모놀리식 앱 5개이며,
사유와 후속 계획을 아래 "미완료 항목"에 기록했다.

커밋 3개, 모두 `main` 직접 푸시.

| 커밋 | 내용 |
|---|---|
| `3ee1a8f` | `refactor(chat)`: api/chat.js 1156 → 214줄 + lib/chat/* 9개 모듈 |
| `8c8b6aa` | `refactor(drive)`: lib/drive-utils.js 1057 → 배럴 51줄 + lib/drive/* 7개 모듈 |
| `45d5c78` | `fix(cc)`: VFF 토글 저장 버그 수정 + cc.html 532 → 166줄 |

---

## 1. 변경 파일 목록과 이유

### 1-1. `api/chat.js` — 1156줄 → 214줄

Stella GPT / ABAP / Codex가 공유하는 채팅 엔드포인트. 라우팅·프롬프트 조립·날씨·GitHub 액션·
Drive 컨텍스트·메모리·OpenAI·Claude·ABAP 청킹이 한 파일에 뒤섞여 있어 순수 로직만 따로
테스트할 수 없었다. 이제 핸들러는 라우팅과 응답 조립만 한다.

| 새 모듈 | 줄 | 역할 |
|---|---:|---|
| `lib/chat/intent.mjs` | 106 | Drive/GitHub 의도 감지, 히스토리 트리밍 (순수) |
| `lib/chat/system-prompt.mjs` | 55 | 시스템 프롬프트 조립 (순수) |
| `lib/chat/weather.mjs` | 194 | Open-Meteo 직접 응답 + 지오코딩/예보 캐시 |
| `lib/chat/github-actions.mjs` | 46 | 레포 self-call 액션 |
| `lib/chat/context.mjs` | 101 | 실시간 검색 / Drive 컨텍스트 준비 |
| `lib/chat/memory.mjs` | 210 | 장기 메모리 로드·추출·저장 |
| `lib/chat/openai-client.mjs` | 215 | Responses / Chat Completions + TPM 방어 |
| `lib/chat/claude-client.mjs` | 99 | Anthropic Messages |
| `lib/chat/abap-analyze.mjs` | 54 | 대용량 ABAP 청킹 분석 |

**하위 호환**: `api/chat.js`가 `detectDriveIntent` / `trimHistoryByChars` / `isTpmError`를 계속
re-export한다. `api/cc/start.js`, `api/cc/turn.js`, `api/codex/agent.js`, `test/drive-intent.test.js`,
`test/tpm-guard.test.js`가 이 경로로 import하므로 호출부 수정은 0건.

### 1-2. `lib/drive-utils.js` — 1057줄 → 배럴 51줄

인증·폴더·JSON저장소·텍스트추출·경로감지·채팅컨텍스트가 한 파일에 있었다. 20여 개 호출부가
이 경로에서 import하므로 **배럴(barrel)로 남기고** 공개 이름 31개를 그대로 re-export했다.
배럴의 export 집합을 원본과 자동 대조해 missing 0 / extra 0 확인.

| 새 모듈 | 줄 | 역할 |
|---|---:|---|
| `lib/drive/client.js` | 140 | OAuth 클라이언트, 환경변수, MIME 상수, 이름/질의 정규화 |
| `lib/drive/detect.js` | 107 | 경로·링크·키워드 감지, 질의 발췌 (**순수**) |
| `lib/drive/folders.js` | 165 | 폴더 탐색/생성/목록/검색, 경로→ID 해석 |
| `lib/drive/json-store.js` | 70 | Drive를 JSON 문서 저장소로 사용 |
| `lib/drive/file-text.js` | 147 | xlsx/docx/pdf/pptx 추출 (**버퍼 in → 텍스트 out, 순수**) |
| `lib/drive/read.js` | 131 | 파일/폴더를 실제로 읽어 텍스트 배열로 |
| `lib/drive/chat-context.js` | 216 | 채팅 메시지 → Drive 컨텍스트 프롬프트 |

`detect.js`와 `file-text.js`가 순수해진 덕분에 **네트워크 없이 20개 테스트**를 새로 붙였다.

### 1-3. `cc.html` — 532줄 → 166줄, `js/cc-app.js` 378줄 (신규)

인라인 `type="module"` 블록(390줄)을 외부 모듈로 추출. 인라인 `on*=` 핸들러 0개.
`sw.js` 캐시 `v114 → v115`(신규 정적 파일 배포 반영 — 레포 관례).

---

## 2. 발견·수정한 버그

### `cc.html` VFF 토글이 저장되지 않았다 (사용자 체감 버그)

```html
<!-- 수정 전 -->
<input type="checkbox" id="ccVffToggle" onchange="onCcVffChange(this.checked)">
<script type="module">
  function onCcVffChange(v){ localStorage.setItem('stella_vff_enabled', String(v)); }
</script>
```

인라인 이벤트 핸들러의 스코프 체인은 `element → form → document → window`다.
`type="module"` 스크립트의 최상위 선언은 **모듈 스코프**에 있어 이 체인에 없다.
따라서 토글할 때마다 `ReferenceError: onCcVffChange is not defined`가 났고 선택이 저장되지 않았다.
`getCcVff()`의 기본값이 `true`라서 **"VFF를 꺼도 새로고침하면 다시 켜져 있는"** 증상으로만 드러났다.

`gpt.html`·`abap.html`은 classic script라 동일 패턴이 정상 동작한다 — `cc.html`만의 문제였다.

**수정**: 인라인 `onchange` 제거 → `addEventListener('change', …)`로 바인딩.
저장/복원은 `claude.client.js`의 기존 `getVffEnabled`/`setVffEnabled` 재사용.
jsdom 테스트로 "해제 → 저장 → 재읽기" 왕복을 검증(회귀 시 실패).

---

## 3. 중복 코드 제거

| 위치 | 내용 |
|---|---|
| `openai-client.mjs` | `callResponses`/`streamResponses`가 중복하던 요청 본문 조립 20여 줄 → `buildResponsesBody` |
| `weather.mjs` | WMO 날씨 코드표가 두 벌(`wmoToKr` / `handleWeather` 내부)이었고 **내부 사본만 쓰였다** → 런타임 사본으로 단일화하고 누락 코드(77 싸라기눈, 99 폭우 뇌우) 보강 |
| `drive/file-text.js` | XML 엔티티 디코딩이 `stripXml`/`extractDocx`에 복붙 → `decodeEntities` 통합 |
| `drive/json-store.js` | 폴더 해석 / JSON 파일명 / 부모 절 조립이 4개 함수에 반복 → 헬퍼 3개 |
| `drive/json-store.js` | `readJsonFromDrive`가 `readJsonById`와 같은 get+parse 중복 → 재사용 |
| `js/cc-app.js` | VFF 저장 3줄이 `gpt.html`·`abap.html`·`cc.html`·`claude.client.js`에 4벌 → cc는 공유 헬퍼로 |

**Dead code 제거**: `callGitHubUpdate`(정의만 되고 호출 없음), `extractMemoryFromConversation`의
미사용 `model` 인자, `updateMemory`의 미사용 `isClaudeModel` 인자.

---

## 4. 비용 절감

| 항목 | 내용 | 효과 |
|---|---|---|
| 출력 상한 | Responses API에 `max_output_tokens` 추가 (env `OPENAI_MAX_OUTPUT_TOKENS`, 기본 8192) | 상한이 없으면 gpt-4o가 모델 최대치 16,384까지 출력. **절단 시 "이어서 계속" 안내를 붙여 무음 절단은 만들지 않는다** (비스트리밍은 `status=incomplete`, SSE는 `response.incomplete` 이벤트) |
| 추출 호출 스킵 | `shouldExtractMemory()` 게이트 — "고마워/ok/네/이어서 계속" 같은 맞장구 턴은 메모리 추출 LLM 호출을 통째로 건너뜀 | 해당 턴마다 gpt-4o-mini 호출 **1건 제거** |
| 응답 캐싱 | 날씨 지오코딩(Google Places, **유료**) 24h 캐시 + Open-Meteo 예보 10분 캐시 | 같은 도시 반복 질의 시 외부 호출 0 |

**이미 적용되어 있던 것**(확인 후 유지): 롤링 TPM 예산, 429 지수 백오프 재시도, 입력이 크면
mini 계열 자동 다운그레이드, 히스토리 문자 총량 24K 제한, 메모리 추출은 항상 저가 모델
(`gpt-4o-mini` / `claude-haiku-4-5`), 정적 시스템 프롬프트를 `messages[0]`에 고정해 자동
prompt caching 히트율 확보.

**의도적으로 하지 않은 것**: Stella GPT 라우팅 경로(`body.route`)의 `gpt-4o` → mini 전환.
품질이 눈에 띄게 떨어지는 사용자 대면 변경이고, 프롬프트의 "기존 기능을 깨뜨리지 않는다"에
저촉될 수 있어 보류했다. 429 시에는 이미 mini로 자동 폴백한다.

---

## 5. 테스트 결과

```
npm test  →  tests 400 | pass 400 | fail 0 | skipped 0 | todo 0
```

기준선 336 → **400 (+64)**. 신규 테스트 파일 9개:

| 파일 | 개수 | 대상 |
|---|---:|---|
| `test/chat-intent.test.js` | 7 | 의도 감지 오탐 회귀(업무 질문 → "auth 폴더 정리 완료") |
| `test/chat-system-prompt.test.js` | 5 | 다운로드 고지·Drive 환각 금지 규칙 |
| `test/chat-weather.test.js` | 6 | WMO 매핑, 요약 문구, **캐시 히트로 외부 호출 1회** |
| `test/chat-memory.test.js` | 7 | 메모리 직렬화, 중복 제거, **추출 스킵 게이트** |
| `test/chat-models.test.js` | 7 | 모델 별칭 해석, 청킹 게이트, 빌링 분리 판정 |
| `test/chat-context.test.js` | 7 | Drive 링크 생성, GitHub 액션 폴백 |
| `test/drive-file-text.test.js` | 10 | xlsx/docx/pdf/pptx 실제 버퍼로 추출 |
| `test/drive-detect.test.js` | 10 | 경로/링크/키워드 감지, 질의 발췌 |
| `test/cc-vff-toggle.test.js` | 5 | **VFF 토글 저장 회귀** (jsdom) |

### 추가 검증

- **import 스모크**: `api/**` + `lib/**` **129개 모듈 전부 로드 성공** — 배럴 분리로 깨진 import 0.
- **배럴 export 대조**: `lib/drive-utils.js`의 공개 이름 31개, missing 0 / extra 0.
- **구문 검사**: 220개 `.js`/`.mjs` `node --check` 전부 통과.
- **CI**: `.github/workflows/deploy-oci.yml` **무수정**(배포 대상·시크릿 참조 불변). 탭 문자 0 확인.

> **린트 주의**: 이 레포에는 ESLint 등 린터가 설정되어 있지 않다(`package.json`에 lint 스크립트 없음).
> `CLAUDE.md`의 검증 관례(`node --check` + jsdom)를 린트 게이트로 사용했다. "린트 경고 0"은
> 이 기준으로 충족했으며, 실제 린터 도입은 아래 후속 과제로 남긴다.

---

## 6. 미완료 항목 — 500라인 초과 파일 5개 (완료 조건 부분 미충족)

| 파일 | 줄 | 인라인 `<script>` | 인라인 `on*=` 핸들러 |
|---|---:|---:|---:|
| `talk.html` | 2803 | 1 | ~80 |
| `index.html` | 1462 | 4 | ~26 |
| `db.html` | 1227 | 1 | ~54 |
| `abap.html` | 1103 | 4 | ~22 |
| `gpt.html` | 873 | 3 | ~38 |

**분리하지 않은 이유** (추측이 아니라 구조에서 나온 제약):

1. **스크립트를 빼내도 500줄을 넘긴다.** 이 앱들은 HTML + 인라인 CSS + classic `<script>`로,
   스크립트만 외부 파일로 옮기면 HTML은 줄지만 **새 JS 파일이 700~2000줄**이 된다. 실제로 목표를
   달성하려면 전역 스코프 코드를 모듈로 **분해**해야 하는데,
2. **전역 스코프 의존이 핵심 위험이다.** 이 파일들은 `onclick="foo()"` 같은 인라인 핸들러가
   합계 220여 개이고, 전부 classic script의 **전역 함수**를 참조한다. ES 모듈로 옮기는 순간
   전부 `ReferenceError`가 된다 — 이번에 `cc.html`에서 고친 버그와 **정확히 같은 실패 모드**다.
   (핸들러 220개를 `addEventListener`로 옮기는 작업이 선행되어야 한다.)
3. **브라우저 검증 수단이 없다.** 이 세션은 헤드리스 환경이고, 이 앱들은 배포된 개인 서비스다.
   jsdom 단위 테스트로는 220개 핸들러의 실제 동작을 커버하지 못한다.

프롬프트 지침(`기존 기능을 깨뜨리지 않는다`, `불가피한 경우 사유 기록`)에 따라 **강행하지 않고
기록**한다. 참고로 프롬프트가 지목한 두 대상 앱은 모두 500줄 이하가 되었다:
Stella Codex(`codex.html` 496줄, `api/codex/*`, `lib/codex-*.mjs`)와
Stella Agent Code(`cc.html` 166줄, `api/cc/*`, `lib/agentcore.mjs`).

### 후속 계획 (권장 순서)

1. `js/dom-bind.js` 같은 얇은 헬퍼를 추가해 각 HTML의 `on*=` 핸들러를 `data-action` +
   위임 `addEventListener`로 **한 파일씩** 옮긴다. 한 파일 옮길 때마다 jsdom 테스트 추가.
2. 핸들러가 0이 된 파일부터 인라인 `<script>`를 classic 외부 스크립트로 추출(전역 스코프 유지 → 무위험).
3. 그 다음 ES 모듈로 승격하며 기능 단위(테마/세션/전송/렌더/업로드)로 분해.
4. 각 단계마다 `sw.js` 캐시 버전 bump.

`gpt.html`(873줄, 핸들러 38개)이 가장 작아 첫 대상으로 적합하다.

---

## 7. 남은 과제

- [ ] HTML 앱 5개 모듈화 (위 6절 계획)
- [ ] ESLint + `npm run lint` 도입 (현재 린터 미설정 — `node --check`로 대체 중)
- [ ] VFF 저장 헬퍼를 `gpt.html`·`abap.html`에도 공유 (classic script라 `import` 불가 →
      `js/vff.js`로 전역 노출하는 방식 필요)
- [ ] `OPENAI_MAX_OUTPUT_TOKENS` 운영값 튜닝 — 기본 8192가 실제 답변 길이 분포에 맞는지
      `timings`/`usage` 로그로 확인 후 조정
- [ ] `api/chat.js`의 `update_intent` 의도는 감지만 하고 실행하지 않는다(기존 동작 유지).
      실제 커밋까지 연결할지 결정 필요

---

## 8. 금지사항 준수 확인

| 항목 | 결과 |
|---|---|
| `.env`/키 커밋·하드코딩 | 없음. 모든 시크릿은 `process.env` 경유 |
| `git push --force` / 브랜치 삭제 / `reset --hard` | 사용 안 함 |
| `main` 외 브랜치·PR 생성 | 없음 (main 직접 커밋·푸시) |
| CI/CD 배포 대상·시크릿 참조 수정 | `.github/`, `deploy/` 무수정 |
| DB 마이그레이션/삭제 실행 | 없음 |
| 외부 패키지 추가 | 없음 (`package.json` 무변경) |
| 공개 함수 시그니처 / API 경로 변경 | 없음 (배럴 + re-export로 하위 호환) |
| 테스트 실패 상태 커밋 | 없음 (커밋마다 전체 통과 확인) |
