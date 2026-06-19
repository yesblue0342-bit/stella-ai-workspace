STATUS: IN_PROGRESS

## CHECKLIST
- [x] 증상 재현/근본원인 검증 (코드 추적) — FINDINGS 기록
- [x] 동기화 엔진 코어: id 기준 upsert + LWW + tombstone + dedupe (`lib/sync-engine.js`)
- [x] 동기화 엔진 단위/통합 테스트 green (`test/sync-engine.test.js`, 12/12)
- [x] TEST_PLAN.md / TEST_RESULTS.md (코어 엔진 분) 작성
- [ ] index.html: 로드 시 Drive pull→merge(엔진)→render, 로컬은 캐시로만
- [ ] index.html: 삭제를 tombstone으로 전환 (deleteRoom/deleteProject/deletePost/노트삭제)
- [ ] index.html: syncToServer의 count-guard 제거(삭제 차단 버그) → 엔진 기반 push
- [ ] 동기화 트리거: load/focus/visibilitychange/polling + mutation 즉시 push + 재시도 큐
- [ ] 게시글/메모/프로젝트/채팅 모두 같은 엔진 통과(통일)
- [ ] 서버(api/workspace, hybrid-chat-*, note): tombstone 보존 + id upsert 반영
- [ ] 기존 중복 dedupe 마이그레이션 엔드포인트 (백업→정리→멱등) + Azure 재동기화
- [ ] 회귀: 재로그인 데이터 유실 0 확인(S5), 오프라인→온라인(S6)

## FINDINGS
- H3/H4 확정 — 삭제 부활/중복의 핵심:
  - `index.html:424 syncToServer()` 에 **count-guard**(로컬<서버 스냅샷이면 저장 차단)가 있어,
    어떤 항목을 삭제하면 로컬 개수가 줄어 **저장이 차단됨** → 삭제가 서버에 반영 안 됨
    → 다음 로드(`loadChatHistoryFromDrive` 등)에서 다시 추가 → **부활**.
  - 로드 병합(`index.html:896/927/968`)은 "id 없으면 추가"만 함 → **삭제 전파 불가**,
    **수정(LWW) 반영 불가**. tombstone 개념 없음.
- H5 확정 — 다중 저장소 분기:
  - 채팅이 `hybrid-chat-save`(Drive) + `workspace`(Azure) 양쪽에 저장되고,
    로드도 `loadChatHistoryFromDrive`와 `loadProjectsFromDrive(workspace.rooms)` 두 곳에서
    각각 add → 같은 항목이 서로 다른 경로로 들어오면 **중복 누적**.
- H1 부분확정 — 로컬 우선 렌더 후 Drive를 add-only로 덧붙임(merge가 upsert 아님).
- `uid()=Date.now()36+rand`(index.html:240) — 충돌은 적으나 결정적이지 않음 → 레거시 항목 마이그레이션엔 결정적 id 필요(`ensureIds`/`deterministicId`로 해결).

## DECISIONS
- 충돌 해결: 항목 단위 LWW(updatedAt). 삭제 동시각이면 삭제 우선(부활 방지), 그 외 동률은 id 사전순(결정적).
- tombstone 보존 30일 후 pruneTombstones.
- 동기화 엔진은 의존성 없는 단일 파일(`lib/sync-engine.js`)로, 브라우저(globalThis.StellaSync)와
  Node 테스트에서 공용. (중복 구현 방지)
- dedupe 동일성 키 = 정규화 제목 + 생성일(날짜) + 첫 user 메시지 40자(`chatKey`).

## NEXT
- index.html을 sync-engine 기반으로 전환: (1) <script src="/lib/sync-engine.js"> 로드,
  (2) 로드 시 Drive pull→mergeById→캐시갱신→render, (3) 삭제를 markDeleted(tombstone)로,
  (4) syncToServer의 count-guard 제거하고 tombstone 포함 전체를 push.
- 그 다음 서버 api/workspace가 tombstone을 보존/병합하도록 수정.

---

## [abap.html] Failed to fetch 수정 + 응답형식 유연화 + Mermaid (backup: backup-abap-20260619-021528)

### (a) "Failed to fetch" 원인·조치
- 진단: abap.html send()의 `fetch(API_URL=/api/chat)` 호출은 index.html(정상)과 **구조 동일**
  (POST, body={model,message,history,system,userId,images,...getSearchConfig()}).
- 인라인 JS 4블록 **문법 정상**(new Function 검증), send 참조 헬퍼(formatDriveSources/formatSearchReferences/
  getSearchConfig/isRefusalOrEmpty/addMessage) **모두 정의됨**.
- sw.js는 `/api/`를 이미 network 우회(`if(url.pathname.startsWith('/api/')) return;`) → SW 원인 아님.
- vercel.json `/abap`·`/api/chat`(api/chat.js) 라우트 존재 → 라우팅 원인 아님.
- 결론: 코드 경로상 결함 없음(샌드박스는 배포보호 403으로 실호출 검증 불가). 재발 시 진짜 원인 파악을 위해
  **catch 블록 개선**: err.name/err.message 콘솔 로깅 + TypeError('Failed to fetch')일 때 네트워크 실패
  안내문 표시(서버 미응답/오프라인/CORS/CSP 가능성). HTTP 에러는 기존대로 status+본문 노출.

### (b) [응답 형식] 교체
- 시스템 프롬프트(템플릿 리터럴) [응답 형식] 섹션을 ChatGPT/Claude식 서술형으로 교체
  (정해진 틀 강제 금지, 서술식 우선, 표·불릿은 도움될 때만, 클래식/모던 권장안).

### (c) Mermaid 적용
- head에 mermaid@11 CDN 추가. initMermaidOnce(startOnLoad:false, securityLevel:'loose',
  theme: 다크면 dark/아니면 neutral).
- renderMarkdownLite 코드블록 루프에서 language==='mermaid' 가로채 renderMermaidBlock 호출
  (응답 완료 후 1회 렌더). SVG를 overflow-x:auto·max-width:100% 래퍼에 삽입. try/catch 실패 시
  원본 코드(pre.codeblock) 폴백 → 앱 안 죽음.
- 시스템 프롬프트에 [다이어그램] 섹션 추가(상황별 타입 선택, 보조 수단).
- sw 캐시 stella-v21 → v22.

### 검증
- node --check(인라인 4블록) 통과 · npm test 54/54 · jsdom mermaid 4/4(렌더/폴백/일반코드/스크롤래퍼).

---

## [db.html] 목록 멈춤 + 업로드 잘림 + 미리보기 (backup: backup-db-20260619-025857)

공통: 토큰 만료(401) 처리 · 응답 파싱 방어(parseJsonSafe: text→JSON.parse try/catch) ·
타임아웃 fetch(fetchWithTimeout/AbortController) · 에러 surface 를 A·B·C에 일관 적용. db.html만 수정.

### (A) "로딩 중..." 무한 멈춤 — 원인·조치
- 원인: loadFolder가 `fetch` 타임아웃 없음 → 응답 지연 시 영원히 "로딩 중...". 실패해도 statusBar만 갱신하고
  fileList는 빈 채로 남아 멈춘 것처럼 보임. 에러 응답이 HTML/text면 `r.json()`이 터져 메시지도 불명확.
- 조치: AbortController 30초 타임아웃 + parseJsonSafe(HTML/text 방어) + 401→재로그인 안내 +
  실패 시 fileList를 **에러 메시지 + [재시도] 버튼**으로 교체(renderListError). 0download 폴더 ID 해석 실패도
  서버 ok:false/HTTP로 surface. (서버 drive-list는 단일 페이지 pageSize≤200 — 프런트 페이지네이션 루프 없음 → 무한루프 위험 없음. 대량 폴더 초과분은 서버 cap, 별도 사안.)

### (B) 업로드 에러 + 파일 잘림 — 원인·조치
- 구조는 이미 정상(서버는 upload-session으로 resumable 세션 URI만 발급, 브라우저가 청크를 Drive에 직접 PUT →
  Vercel 4.5MB 미경유). **잘림의 진짜 원인 = 청크 재시도/재개 부재**: 청크 한 번이라도 실패(일시 네트워크/타임아웃)하면
  throw 후 중단 → 부분 파일.
- 조치: uploadResumable로 분리 — 청크당 **3회 재시도**, 실패 시 `Content-Range: bytes */total`로 세션 수신
  바이트 재조회 후 그 지점부터 재개. **308(Resume Incomplete)=중간성공 처리**(Range 헤더로 다음 offset, 없으면 end 폴백),
  **200/201만 완료**. 청크=5MB(256KB 정수배). file.slice(Blob)로 잘라 메모리 절약(대용량 OOM 방지).
  실패 시 실패청크 offset+status+Drive 본문 표시(무음 부분파일 금지). 0바이트 파일 단일 PUT 처리. 완료 후 refresh.

### (C) 미리보기 빈 화면 — 원인·조치
- 원인: openFilePreview가 `drive.google.com/thumbnail|/preview|/uc` **공개 URL**에 의존 → 비공개 Drive 파일은
  로그인 페이지/실패 반환 → 빈 이미지/빈 iframe, 에러도 안 뜸.
- 조치: 콘텐츠를 **서버 OAuth 인증 스트림(/api/download?fileId=)** 으로 fetch → blob → `URL.createObjectURL`로 표시
  (모달 닫을 때 revokeObjectURL). mimeType(누락 시 확장자 폴백)로 image/pdf/video/audio/text 분기 렌더.
  401→재로그인, 실패→**빈 화면 대신 에러 + [다운로드] 폴백**. 다운로드도 same-origin /api/download 재사용.
- C5(바인딩): 동적 행은 renderFiles에서 생성 시 onclick 직접 바인딩(정상 동작) + 우클릭은 document 위임 — 변경 불필요.

### 검증
- 인라인 JS new Function 문법 통과(1블록 0 bad) · node --check sw.js OK · npm test 54/54 ·
  jsdom 7/7(A 에러+재시도 렌더·HTML응답 방어 / B 308→200 완료·단일청크·3회재시도후 실패사유 / C blob 이미지·실패폴백).
- sw 캐시 stella-v22 → v23. 새 API 라우트/키 0(기존 /api/drive-list·drive-manage·download 재사용).
