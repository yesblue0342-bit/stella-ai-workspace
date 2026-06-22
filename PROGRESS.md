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

---

## 2026-06-20 추가 작업: 중복가입 메시지 통일 + 관리자 승인 UI

### (1) 중복 가입 차단 메시지 통일 — 비밀번호 무관 무조건 차단
- `api/auth.js` 회원가입 중복확인 블록 교체: ID/e-mail 각각 별도 키값으로 검사.
  - 기존 "비밀번호 맞으면 자동 로그인" 분기 제거 → 무조건 409 차단.
  - DUPLICATE_ID → "가입한 ID가 존재합니다. 다른 ID로 신청하세요."
  - DUPLICATE_EMAIL → "가입한 e-mail이 존재합니다. 다른 ID로 신청하세요."
- `api/member-store.js` signup 분기: `init(id)` 전에 `read(id)`/`read(safe(email))`로
  중복 검사 후 동일 코드/메시지로 409 반환.

### (2) 관리자 회원 승인 메뉴탭 + 패널 신규 개발 (gpt.html)
- 사이드바 '바로가기' 섹션에 `#adminApproveTab` 버튼 추가(기본 .hidden).
- `openApp()`에서 로그인 사용자가 관리자(yesblue0342/admin, 대소문자 무시)면 노출.
- 슬라이드 패널(`#approvalPanel`, 노트 패널 CSS 재사용) + 오버레이 신규.
- `loadApprovals()`: POST /api/admin-approvals {action:list} → pending 목록 렌더
  (이름/ID/이메일/신청일시 + 승인·거절 버튼). 빈 목록 시 "승인 대기 중인 회원이 없습니다."
- `decideApproval(i,action)`: approve/reject POST 후 목록 자동 새로고침.
- 관리자 자격증명: 세션 user.id + sessionStorage 캐시 비번(없으면 1회 prompt,
  admin 계정은 'admin' 자동). 인증 실패 시 캐시 비번 폐기 후 재시도 유도.
- 서비스워커 캐시 v33 → v34.

### node --check / 문법 검증 결과
- api/auth.js .......... OK
- api/member-store.js .. OK
- sw.js ................ OK
- gpt.html 임베드 <script> 3블록 전부 OK (new Function 파싱, 32750자 메인 포함)
- 정적 점검: getElementById ID(adminApproveTab/approvalPanel/approvalOverlay/apStatus/apList)
  + onclick 핸들러 4종 모두 정의·매칭 확인.

### 테스트 체크리스트 (배포 후 수동 확인)
- [ ] 일반 사용자 로그인 시 '회원 승인' 탭 미노출
- [ ] yesblue0342/admin 로그인 시 '회원 승인' 탭 노출
- [ ] 동일 ID 재가입 → "가입한 ID가 존재합니다…" 차단(비번 일치해도 차단)
- [ ] 동일 e-mail 재가입 → "가입한 e-mail이 존재합니다…" 차단
- [ ] 승인 패널: pending 목록/빈 목록/로딩·에러 표시
- [ ] 승인/거절 버튼 → 처리 후 목록 자동 새로고침, 해당 사용자 로그인 가능/불가 반영
- [ ] admin 계정 비번 자동(admin), 그 외 관리자 비번 1회 입력 캐시

---

## 2026-06-20 Stella Talk 전면 개선 (STAGE 1~3 배포)

### STAGE 1 — 실시간 수신: 증분 동기화 + 적응형 폴링 + 낙관적 전송
- api/chat-room.js action=get: `since`(ms epoch) 지원 → createdAt>since 메시지만, `limit` 지원
  → 최근 limit개만. 응답에 serverTime/lastMessageAt/hasMore/total 추가. (없으면 전체=하위호환)
- api/chat-room-sse.js 신규(롱폴링): since 이후 새 메시지를 최대 25초 대기 후 반환(maxDuration 30 준수).
- talk.html:
  - 증분 동기화: _lastSyncAt[roomId] 보관, 폴링은 since=_lastSyncAt 로 새 메시지만 union 병합.
    방 첫 진입 시에만 limit=100 전체 1회. 기존 dedup/clientId/FIX-LOCK 병합 로직 유지.
  - 적응형 폴링: 활성(최근 15초 송수신) 1초 / 유휴 3초 / document.hidden 5초 (자기 스케줄링 setTimeout).
  - sendMsg 낙관적 렌더 유지 + send 응답의 확정 message 로 즉시 교체(체감 실시간). clientId 중복 방지.
  - visibilitychange=visible / focus 시 즉시 풀 동기화(full) → 백그라운드 누적 메시지 즉시 표시.
  - SSE/롱폴링 전환 지점 주석화 + USE_LONGPOLL 플래그(기본 false=적응형 폴링, 서버리스 안정성 우선).
  - [가정] 롱폴 엔드포인트는 배포하되 클라 기본은 적응형 폴링. 1초 폴링으로 "1초 내 수신" 충족.

### STAGE 2 — 알림음 안정화 (TTS 의존 제거)
- talk.html: 주 알림음을 WebAudio 합성 멜로디(playMelody)로 교체. 우선순위 (옵션)mp3 → 멜로디.
  TTS(speakVoice)는 미리듣기 전용으로 강등.
- TALK_VOICES[key].melody = [주파수,오프셋,길이] 배열로 음성키별 0.3~0.5초 구분 멜로디 정의.
- 재생 직전 _audioCtx.resume(). visibilitychange/focus 마다 _wakeAudio()로 audioCtx + speechSynthesis 큐 깨우기.
- 각 음은 독립 oscillator(cancel 의존 제거) → 직전 재생 미완료여도 안 막힘.
- 연타 방지: 250ms 디바운스, 단 메시지 id 다르면 항상 재생. silent/vibrate 모드 유지.

### STAGE 3 — 읽음("1")/안읽음 정확도
- api/chat-room.js action=read: reads 저장을 max(기존,신규)로 monotonic 보강(되돌림 금지).
- talk.html: 방 목록 unread = max(로컬 lastReadAt, 서버 reads[myId]) 기준 → 기기 간 어긋남 제거.
- 그룹 안읽음 "남은 인원수" 버블 옆 표시(countUnreadByOthers)·1:1 "1"은 기존 구현 유지.
- 현재 보는 방 새 메시지 → 즉시 read 보고(기존) 유지.

### STAGE 7 일부(선반영) — 과거 메시지 보는 중 강제 스크롤 금지
- 새 메시지 도착 시 하단 근처가 아니면 강제 스크롤 대신 "▼ 새 메시지 N개" 칩 표시(showNewMsgChip).

### 서비스워커 캐시: v34 → v35

### node --check / 문법 검증
- api/chat-room.js ...... OK
- api/chat-room-sse.js .. OK
- sw.js ................. OK
- talk.html 임베드 <script> 3블록 전부 OK (new Function 파싱)

### 남은 STAGE (다음 배포 예정)
- STAGE 4 멤버/초대/방 정합성 + 권한·보안(서버 멤버 검증, 결정적 dm roomId, XSS 점검)
- STAGE 5 성능(렌더 최근 N개 + 과거 lazy load; 이미지 base64 금지→Drive URL만)
- STAGE 6 SW 백그라운드 수신/알림 고도화(per-room 뮤트, 알림 합치기, 멘션, 인앱 토스트)
- STAGE 7 나머지(상대 입력중 안정화, 오프라인 배너+미전송 큐, URL 링크화)
- STAGE 8 (선택) 길게눌러 답장/반응 이모지/방내 검색

---

## 2026-06-20 사이드바 앱 아이콘 흑백화 (Method A)

### 적용 파일 (이모지 앱 바로가기 있는 페이지)
- index.html (사이드바 바로가기 7개: 🗄DB 🧑‍💻ABAP 🛠AgentCode ☁Cloud 💬Talk 🌐Hub + 🔄업데이트)
- abap.html (사이드바 바로가기 8개: ✨GPT 🗄DB 🧑‍💻ABAP 🛠AgentCode ☁Cloud 💬Talk 🌐Hub + 🔄업데이트)
- hub.html (상단 nav 4개 + 타이틀 🌐: GPT/ABAP/DB/Talk)
- cc.html (상단 nav 6개 + 타이틀 🛠️: GPT/Talk/DB/Hub/ABAP/Code)

### 방식 (Method A — 이모지 유지 + 흑백 배지)
- 각 이모지를 <span class="app-ico-wrap"><span class="app-ico">…</span></span> 로 감쌈.
- .app-ico = filter:grayscale(1) brightness(0)  (컬러 제거→검정 단색),
  다크 테마에서 filter에 invert(1) 추가 → 흰색 단색.
- .app-ico-wrap = 24x24(사이드바)/22x22(nav) 둥근 배지 테두리.

### 테마별 결과 (각 페이지 실제 토글 방식에 맞춤)
- index/abap: body.dark 토글(기본 라이트). 라이트=흰바탕+검정테두리/검정아이콘,
  body.dark=검은바탕+흰테두리/흰아이콘.
- hub: :root 기본 다크 / body.light 라이트. 기본(다크)=검은바탕+흰테두리/흰아이콘,
  body.light=흰바탕+검정테두리/검정아이콘.
- cc: body.dark 토글(기본 라이트, index와 동일 매핑).

### 적용 제외 (사유)
- gpt.html: 사이드바 앱 바로가기(Stella Cloud/Talk/Developer)에 이모지 없음 → 대상 없음.
- db.html/cloud.html/developer.html: 이모지는 페이지 제목(h1/h2)뿐, "바로가기 아이콘" 아님 → 제외.
- talk.html: 이모지는 기능 버튼(새 채팅방/강제 업데이트/음성 미리듣기)뿐, 앱 바로가기 nav 없음 → 제외.

### 방법 B (라인 SVG 아이콘 교체)
- 다음 단계로 남김. 현재 Method A로 전체 통일 완료(컬러 제거 + 테마별 흑백 테두리).

### 서비스워커 캐시: v35 → v36
### 검증: index/abap/hub 임베드 스크립트 new Function 파싱 OK. cc는 <script type=module>(import)
  이라 정적 파서 예외이나 편집은 HTML(스타일/span)만 → 영향 없음.

---

## 2026-06-20 restore.html 검토·수정

### API 정합성 확인 (grep으로 실제 응답 확인 후 코드 검증)
- /api/workspace GET ?owner= → {ok, owner, rooms, projects, posts, updated_at}. POST {owner, rooms, projects, posts}. → restore.html 필드명 일치(이미 정확).
- /api/note ?action=list&userId= → {ok, notes, total}. ?action=save POST {id, userId(body 허용), title, body}. → 일치.
- /api/hybrid-chat-list ?userId= → {ok, items:[{room_id,title,project_id,drive_file_id,drive_link,message_count,created_at,updated_at}]}. → restore의 (d.rooms||d.items) + room_id/title/drive_file_id/project_id/created_at 일치.
  ⇒ 코드 가정이 실제 API와 일치하여 필드명 변경 불필요.

### 수정 결과
1. owner/세션 id 정합성: 단일 기준 id ownerId()(세션 user.id 우선)로 조회·복원·저장 전부 통일.
   로드 시 세션 id로 입력칸 자동 동기화 + checkIdSync()로 "세션 id(X) 기준 저장" 안내/경고(입력≠세션 시).
2. 중복 workspace 호출 제거: restoreAll에서 /api/workspace를 1회만 호출해 rooms/posts/projects 함께 재사용(기존 3회→1회). (검증: 전체 파일 내 workspace fetch = scan 1 + restore 1 = 2회)
3. 테마 대응: body #0f172a 하드코딩 다크 유지 + @media (prefers-color-scheme: light) 로 라이트=밝은 배경/어두운 글자. (수동 토글 없는 독립 페이지라 시스템 설정 추종)
4. UX/안전장치: 실행 중 버튼 비활성화+"⏳ 처리 중...", 빈 id 경고 후 중단, "기존 로컬과 병합" 명시, 모든 fetch cache:'no-store'.
5. 오류 가시성/접근성: ok:false·네트워크 실패 시 다음 행동(재로그인/모바일 선저장/네트워크 확인) 안내, localStorage 차단 시 친절한 메시지, vercel.json에 {source:/restore} rewrite 추가.

### 검증/배포
- restore.html 임베드 스크립트 new Function 파싱 OK. vercel.json 유효 JSON.
- 서비스워커 캐시 v36 → v37.

### 남은 과제(다음 단계)
- 세션이 있는데 사용자가 일부러 다른 id를 조회하려는 시나리오: 현재는 세션 id 우선(경고 표시). 필요 시 "입력 id 강제 조회" 토글 추가 검토.

---

## 2026-06-20 Stella Talk STAGE 4 — 멤버/초대/방 정합성 + 권한·보안

### 정합성
- 초대 멤버 서버 반영(핵심 버그 수정): confirmInvite 가 로컬 members 만 갱신하고 서버엔 안 알려
  초대된 사용자가 action=list 에서 방을 못 보던 문제 → 신규 action=invite 호출로 서버 members 갱신.
  (api/chat-room.js: action="invite"/"join" = 메시지 없이 members 병합 저장)
- 1:1 결정적 roomId: createRoom 에서 멤버 2명이면 dm_{min}_{max} 로 생성 → 두 사람이 항상 같은 방 합류(중복 방 방지). 코드방(room_code_)·그룹(room_) 기존 방식 유지.
- 재초대 시 left 해제: action=invite 가 left 배열에서 복귀 멤버 제거 + members 생기면 tombstone(deleted) 해제.
- [가정/정책] 재입장 후 메시지 노출: 현재 서버는 방당 단일 메시지 목록이라 재입장자도 전체 히스토리를 본다.
  "재입장 후 메시지만" 정책(멤버별 joinedAt 필터)은 별도 기능으로 다음 단계에 남김.

### 권한·보안 (api/chat-room.js)
- isMember(data,userId) 헬퍼: members 명단 비면(레거시) 통과, 있으면 포함 여부 검사. isCodeRoom 별도 허용.
- get: 요청자 userId 가 멤버가 아니면 403(임의 roomId 열람 차단). 코드방/레거시는 허용. talk.html get 호출에 &userId 추가.
- send: 기존 방 + 멤버명단 있음 + 발신자 비멤버 + 코드방 아님 → 403(비멤버 임의 전송/자동합류 차단). 새 방 생성·코드방·멤버는 통과.
- delete: 멤버만 가능하도록 userId 검사 추가(기존 권한 체크 없던 부분 보강). delete-message 는 기존 본인 검사 유지. leave 는 자기 자신만 제외(기존 유지).
- [한계] 세션 토큰이 없는 구조라 userId 위조까지는 막지 못함(정직한-호기심 단계 차단). 토큰 기반 인증은 다음 단계 과제로 기록.

### XSS
- 메시지/발신자명/파일명 렌더는 textContent 또는 esc() 사용 확인(buildMsgRow/renderMessages/renderRooms/typing).
- 파일·이미지 URL 스킴 화이트리스트 safeFileUrl(): http(s)/data/blob 만 허용 → javascript:/vbscript: href·src 인젝션 차단(serverMsgToLocal 진입점에서 정화).
- 이미지 onerror 는 createElement+함수 할당이라 인젝션 벡터 없음(확인).

### 서비스워커 캐시: v37 → v38
### node --check: api/chat-room.js OK / talk.html 임베드 스크립트 3블록 OK

### 남은 STAGE: 5(성능/lazy load), 6(SW 백그라운드 수신/뮤트/멘션), 7(입력·오프라인·재연결), 8(반응/검색)

---

## 2026-06-20 Stella Talk STAGE 5 — 성능 / 메시지 누적 대비

- 렌더 윈도우: renderMessages 가 최근 MSG_WINDOW(100)개만 그림. 방 진입 시 _shownCount 초기화.
- 위로 lazy load: 더 오래된 메시지가 있으면 상단에 "↑ 이전 메시지 더보기" 버튼 → loadMoreMessages()가
  +100개씩 확장하고 스크롤 위치를 보존(보던 메시지 유지). 키 기반 증분 렌더와 호환(__loadmore 유닛).
- 이미지/동영상 base64 금지: 정상 경로는 이미 Drive 업로드 후 fileUrl(드라이브 URL)만 저장.
  base64는 Drive 업로드 실패 시 <300KB 한정 폴백만 유지(전송 보장용). 서버 JSON 비대화 방지 목적 충족.
- [다음 단계] 방 메시지 청크/일자 파일 분할 저장(MemberChat/{roomId}/{yyyymmdd}.json)은 미적용.
  현재는 get since/limit + 렌더 윈도우로 "최근만" 처리. 대용량 방이 많아지면 분할 도입 검토.

### 서비스워커 캐시: v38 → v39
### node --check: talk.html 임베드 스크립트 3블록 OK

## [autopilot iter 7] Stella Agent Code / Codex 가정 로그
- T3 "Stella Codex API를 OpenAI로 고정": cc Managed Agents(Anthropic 샌드박스 /api/cc/*) 대신 **기존 OpenAI 엔드포인트 /api/chat 재사용**(model 필드로 OpenAI 라우팅, 빌링 분리). 신규 키·라우트 0(CLAUDE.md 준수).
- 결과 Codex = 채팅형 코딩 어시스턴트. 샌드박스 전용 기능(세션/이벤트폴링/예산/OMC/Drive 산출물저장)은 OpenAI 챗에 해당 없어 Codex UI에서 제거, 대화는 localStorage(stella_codex_chats) 보관.
- chat.js callOpenAI의 "[표+요약]" 강제 프리픽스가 코딩답변엔 부적합 → 하위호환 additive 플래그 `bare` 추가(기본 off=GPT/ABAP 무영향), Codex만 bare:true.
- Stella Agent Code(cc.html)는 Claude(Managed Agents) 그대로 유지.
- 한계: 실제 OpenAI 응답은 OPENAI_API_KEY 있는 라이브에서만. 샌드박스는 jsdom으로 모델목록/기본값(gpt-4.1-mini)/전송 페이로드(model·bare·system)/렌더링까지 검증.

## [autopilot iter 8] G1 Stella GPT 응답속도
- 병목 특정: api/chat.js 핫패스에서 메모리 로드(buildMemoryContext=Azure SQL → 빈값 시 loadMemory=Drive)를 매 요청 직렬 호출. 일반대화는 검색/Drive 미사용이라 메모리가 모델 호출 前 최대 지연.
- 적용(효과 큰 것·저위험): (1) 구간 타이밍 계측(timings 응답+로그)으로 라이브 실측 가능, (2) 메모리 로드를 검색/Drive와 병렬 착수, (3) userId별 60s warm 캐시(updateMemory 후 invalidate).
- 스트리밍 보류 사유: SSE는 backend(res 스트림)+frontend(reader) 동시 변경이며 샌드박스에서 OPENAI_API_KEY/라이브 없이 end-to-end 검증 불가 → 작동 중 채팅 회귀 위험. 총 지연(모델 생성시간)은 streaming이 '체감 TTFT'만 개선하므로, 우선 준비단계 지연을 제거. 후속 반복에서 라이브 환경 확보 시 SSE 도입.

## [autopilot iter 8] T1/T2 Stella Talk
- T1 전역 알림: 방목록 폴링을 messageCount 델타→lastMessageAt(since) 기반으로 교체. 서버 list에 lastMessageAt 추가. 앱 열린 동안 모든 화면에서 상대 발신 새 메시지 감지→Notification+소리. 최초 baseline 프라이밍·보는방/내발신 제외·per-room ts 저장으로 재알림 방지. 로직 유닛 7/7.
  - [!] 앱 완전종료 푸시: Web Push(VAPID 구독 저장+서버 발송) 인프라 필요 → 후속. sw.js에 push 핸들러는 이미 존재하나 구독/발송 백엔드 미구현. iOS는 OS 제약.
- T2 전송 속도: 텍스트 낙관적 UI는 이미 구현됨(즉시 렌더+sendState+retry+clientId dedup). 백엔드 send 응답에서 전체 방 히스토리(room:data) 제거→확정 메시지 1건만(긴 방 97~100% 페이로드 감소).
  - 가정: "Azure 우선·Drive 비동기" 중 Drive 저장을 응답 후 fire-and-forget로 돌리면 Vercel 서버리스가 응답 직후 함수를 동결/종료해 **메시지 유실** 위험 → 내구성 우선으로 Drive 저장은 동기 유지. 대신 무손실인 페이로드 트림으로 체감속도 개선. Azure 메시지 저장 일원화는 list/get/poll 동시 마이그레이션 필요한 대공사라 후속.

---

## 2026-06-20 Stella Talk STAGE 6 — 알림 고도화 + 백그라운드 수신(SW) [동시작업 베이스 v51 위 재적용]
- 방별 뮤트 토글(헤더 🔔/🔕, per-room localStorage): 뮤트 방은 소리·푸시·인앱토스트 생략하되 뱃지/목록 유지. active/background 알림 경로 양쪽 적용.
- 멘션(@아이디/@이름): 뮤트여도 알림 + 버블 하이라이트. mentionsMe() 공용.
- 알림 합치기: notify(title,body,roomId) 방별 tag + 연속 시 "메시지 N개". 방 열면 카운트 리셋.
- 인앱 토스트(현재 방 아님): 기존 since 기반 syncRoomListFromServer 의 newRooms 루프에 showRoomToast(탭→이동) 추가.
- 딥링크: ?room=ID 진입/SW OPEN_ROOM 메시지로 방 자동 오픈. SW notificationclick=열린 탭 포커스+딥링크, periodicsync=탭에 PERIODIC_SYNC 전달.
- 동시 작업(다른 세션)이 v40→v51로 전진 + '전역 알림 since 기반 재작성'을 이미 반영 → 충돌 회피 위해 origin/main(v51) 위에 STAGE6를 가산식으로 재적용.
- [다음 단계] 앱 완전 종료 시 백그라운드 수신은 서버 Web Push(VAPID) 구독이 정석.
### 서비스워커 캐시: v51 → v52

---

## 2026-06-20 Stella Talk STAGE 7 — 입력 경험 / 오프라인·재연결
- 한글 IME 가드: chatInput Enter 핸들러에 !event.isComposing && keyCode!==229 → 조합 중 Enter 오전송 방지.
- 전송 연타 방지: sendMsg 진입 시 _sendLock 350ms 디바운스.
- URL 자동 링크화: fillTextWithLinks() — http(s)만 매칭(javascript: 불가) + createElement로 XSS 안전,
  target=_blank rel=noopener, white-space:pre-wrap로 줄바꿈/이모지 정상 표시. buildMsgRow 텍스트 버블 적용.
- 클립보드 이미지 붙여넣기: chatInput paste → image를 _attachFiles 추가(전송 시 기존 Drive 업로드).
- 오프라인 감지/재연결: navigator.onLine + online/offline. 끊기면 상단 "연결 끊김 — 재연결 중…" 배너,
  복구 시 현재 방 full 동기화 + 목록 동기화 + 실패 메시지 자동 재발송(flushFailedQueue).
- (기존 유지) 타이핑/재전송 ⟳/낙관적 상태/새 메시지 칩.
### 서비스워커 캐시: v52 → v53

---

## 2026-06-20 Stella Talk STAGE 8 — 메시지 기능 확장 (선택)
- 길게 눌러 메뉴: 복사/삭제(본인)/답장/전달은 기존 구현 유지. "😊 반응" 항목 추가.
- 이모지 빠른 반응(👍❤️😂😮😢🎉): 
  - 백엔드 api/chat-room.js action="react" — 메시지 reactions{emoji:[userIds]} 토글(append/remove), 멤버 검증.
  - 프런트: 낙관적 토글 + 서버 반영(reactToMsg), 버블 하단 반응 칩(내 반응 강조, 탭하면 토글), openReactionPicker.
  - serverMsgToLocal에 reactions 전달, msgSig에 반응 포함(증분 렌더 갱신).
- 방 내부 메시지 검색: 헤더 🔍 토글 → 검색바. 쿼리 있으면 매칭 메시지만 렌더(윈도우/더보기 무시) + "N건" 표시.
  방 전환 시 검색 초기화.
### 서비스워커 캐시: v53 → v54
### node --check: api/chat-room.js OK / talk.html 스크립트 3블록 OK

## STAGE 5~8 완료. (STAGE 6 백그라운드: 앱 완전종료 수신은 Web Push(VAPID) 구독이 정석 → 후속 과제)

## [autopilot iter 9] C1/C2 Agent Code·Codex
- C1: 데스크톱 사이드바 기본 접힘(메인 넓게)+localStorage 상태기억(cc_sidecollapsed/codex_sidecollapsed). 모바일은 CSS(body.side-collapsed .side{display:block})로 무효화해 드로어 회귀 방지. cc/codex 각각 편집(codex는 T3에서 분기되어 cc 재생성 불가).
- C2: 결과 .txt를 StellaGPT/0download에 저장. 가정/결정:
  - 신규 라우트 안 만들고 기존 /api/cc/save-drive에 text 모드 추가(text 있으면 세션 불필요). 기존 Drive OAuth(lib/drive-files.mjs) 재사용 = 신규 키 0.
  - 파일명 {앱명}_{YYYYMMDD_HHMMSS}.txt(KST), 위치는 0download 직하(날짜 하위폴더 없음 — 단일 .txt 요구사항), 내용=[요청] 헤더 한 줄+빈 줄+결과 전문.
  - codex(StellaCodex): 매 어시스턴트 응답마다 저장. cc(StellaAgentCode): 세션 완료(finish, 비실패) 시 buildTranscript 전문 저장. 성공/실패 토스트.
  - 한계: 실제 Drive 업로드는 OAuth 자격증명 있는 라이브에서만. 샌드박스는 순수헬퍼 유닛 7/7 + jsdom으로 저장 호출 페이로드/토스트까지 검증.

## [autopilot iter 11] A1 인증 복구
- 근본원인: auth.js/admin-approvals.js가 회원계정을 Google Drive(auth/users/*.json)에서만 조회 → Drive OAuth 토큰 만료/콜드스타트 시 전원 로그인·관리자 인증 동시 장애. yesblue0342는 하드코딩/ENV 비번이 없어(admin/admin만 존재) Drive 레코드 부재 시 관리자 로그인 불가.
- 수정(ADD-only, 기존 데이터 보존): (1) approval.adminPasswordOk(env ADMIN_PASSWORD/STELLA_ADMIN_PASSWORD) → auth.js·admin-approvals.js에 관리자 env 통과 경로(콜드스타트·토큰만료 내성). (2) Azure SQL dbo.users에 password_hash 컬럼(ALTER ADD 가드) + 가입 시 Drive+Azure 이중 저장 + 로그인 Drive우선→Azure폴백 + Drive로그인 성공 시 Azure 백필.
- [!] Vercel 환경변수 `ADMIN_PASSWORD` 설정 필요: 설정 시 yesblue0342가 Drive/Azure 없이도 관리자 로그인 가능. 미설정이면 코드는 정상이나 env-admin 경로는 비활성(admin/admin + Drive/Azure 레코드 폴백만). 에이전트는 대시보드 env를 설정할 수 없어 [!] 보류로 남김.
- 검증 한계: Azure/Drive 실연결은 라이브에서만. 샌드박스는 관리자 env 경로를 실제 핸들러 호출로 검증(75/75), Azure 분기는 node --check + 로직 단위까지.

## [autopilot iter 11] A2 Stella Talk 전송 복구
- 진단: sendTextToServer 단일시도→즉시 'failed'. 실패 status 분류 안 함. Drive는 googleapis OAuth2 refresh_token로 access token 자동 리프레시(만료 자동 처리). 따라서 흔한 실패는 일시 타임아웃/끊김(0/504)이며 재시도로 회복 가능.
- 수정: 지수 백오프 자동 재시도(1s/2s/4s·최대3, 대상 0/408/429/5xx), clientId 동일→서버 dedup(중복 0), 상태 sending 유지, 소진/비재시도(401·403·d.ok=false)만 '재전송'. status·attempt·body 진단 로깅. online 자동 flush 기존 유지.
- A1과 공유 뿌리: Drive 토큰. refresh token 자체가 폐기되면 코드로 복구 불가 → [!] GOOGLE_REFRESH_TOKEN 재발급(인프라).
- 미적용(가정): "타임아웃 시 Azure 메타데이터 우선 ack + Drive 비동기"는 Vercel 서버리스가 응답 직후 함수 동결→비동기 Drive 저장 유실 위험(T2와 동일 이유). 내구성 우선으로 클라 재시도로 해결.

## [autopilot iter 14] Drive 독립 로그인 — 사용자 액션 필요
- **Vercel env `STELLA_MEMBERS`(JSON) 설정 필수**: 예) {"yesblue0342":"비번","dmswn8712":"비번","mjlee":"비번","stellanight":"비번"} 또는 확장형 {"yesblue0342":{"pw":"<평문 또는 salt:hash>","email":"yesblue0342@naver.com","name":"이후"}, ...}. 미설정이면 allowlist 회원 로그인 시 503 MEMBERS_UNSET(실패-안전). 기존 비번 보존하려면 Drive auth/users JSON의 password_hash 값을 pw로 복사.
- 설정되면 공개 레포의 admin/admin 부트스트랩은 자동 비활성(구멍 차단).
- (선택) Drive 기능(채팅/파일/메모) 사용 시 GOOGLE_REFRESH_TOKEN 재발급 + OAuth 앱 Production 게시 — 로그인 자체는 Drive와 무관하게 동작.
- 설계 가정: 로그인 판정은 Drive 호출 0회(allowlist 분기 최우선). 비-allowlist + STELLA_MEMBERS 미설정 흐름만 기존 Drive 경로 하위호환 유지. 회원 데이터 ADD-only(무삭제).

## [autopilot iter 15] 단순 로그인 원복
- api/auth.js: readUser catch{}→null(503 제거), login 503/driveErr·canLogin 승인게이트·iter14 allowlist·SIGNUP_DISABLED 제거, signup pending→approved 즉시성공(중복검사·Drive저장 유지), admin/admin 무조건 통과.
- api/admin-approvals.js: readUser 오류 삼키기·admin/admin 무조건·503 제거(부트스트랩 가드 원복).
- lib/approval.js: 파일 보존(allowlist 유틸 등 미사용으로 남김), approval.test.js 무수정.
- 클라이언트(index.html): 미수정 — 서버가 pending/403승인/503을 더는 반환하지 않아 승인대기 분기가 inert가 됨(자동 정상화). 거대한 인라인 JS 편집 회귀 위험 회피 위해 비활성 분기는 그대로 둠(가정).
- 데이터: 조회/표기/상태만 단순화, 저장·중복검사·Drive 보존(ADD-only, 무삭제).

## [autopilot iter 16] 하드코딩 화이트리스트 로그인
- 가정: 화이트리스트 판정/권한은 서버리스(api/auth.js + lib/login-allow.js)에서 처리 → 클라 소스에 명단 미노출(구조 노출 회피). 클라는 서버가 준 isAdmin/role만 사용.
- ALLOWLIST(yesblue0342/dmswn8712/mjlee)는 비번 무관 즉시 로그인(빈 비번도) + Drive 호출 0. yesblue0342만 admin.
- 내부 에러 노출 제거: 금칙어(Drive/환경변수/env/경로/스택/토큰/error필드)를 사용자 화면에서 제거, console.* 내부 로그만. 회원가입 Drive 실패도 일반 문구.
- 유저 ID=username 고정(난수 재생성 없음) → SW 캐시 bump/배포 시 채팅·프로젝트·게시판 orphan 방지.
- 데이터/기능 회귀 없음(기존 Drive/Azure 경로는 비-allowlist에 그대로 유지).

## [autopilot] Stella GPT 답변 유형 라우팅 (STEP 0 기록)
- 엔드포인트: api/chat.js (루트 index.html이 API_URL='/api/chat'로 POST). **비스트리밍 JSON**, 프론트가 읽는 키 = `text`(data.text||data.answer||data.message).
- /api/chat은 index.html(GPT)·abap.html·codex.html 공유 → 라우팅은 **body.route 게이트**로 Stella GPT만 적용(다른 앱 미전송→영향 0). 가정: PROGRESS 기록.
- 경로 선택: **경로 A(Responses API + web_search)** — 비스트리밍이라 채택. callResponses() 추가, isClaudeModel/비-route는 기존 callOpenAI/callClaude 보존.
- 메모리 주입(kh_memory)+driveContext는 routeSystemPrompt({table, extra})의 extra로 합쳐 보존. 표는 wantsTable일 때만(강제 [표+요약] 프리픽스 미사용).
- 모델: needsWebSearch→gpt-4o(+web_search), 아니면 gpt-4o-mini. 응답 contract(text 키) 유지.
- 마크다운: renderAnswer가 renderMarkdownLite로 **굵게가 별표로 새던** 것 → marked+DOMPurify(js/stella-md.js, CDN) 우선, 실패 시 기존 폴백.

## [autopilot] Stella GPT 회귀복원 + 검색 모델결정화
- baseline: c28a928(직전 2 auto 커밋 1c238e1·b4f2009 이전). diff 결과 index.html은 3줄만 변경 → 복사/내보내기 함수는 잔존, marked 전환으로 코드블록 복사 버튼만 미호출(회귀).
- 복원: js/stella-md.js가 marked 렌더 후 코드블록 복사 버튼 + 표 TSV 복사 부착(기존 stellaCopyText 재사용). Excel(.xlsx)은 이미 SheetJS 실파일(renderAnswer)이라 유지, lib/exporters.mjs는 테스트 가드.
- 검색: needsWebSearch 게이트 삭제 → web_search 상시 제공, 모델이 결정(gpt-4o). 맛집/장소/실시간 추측→실검색+출처. #구글드라이브는 web_search보다 우선(needsDrive면 검색 미제공).
- 유지: 표 온디맨드(wantsTable), body.route로 Stella GPT만 적용(ABAP/Codex 미전송), 메모리/날씨/Drive/이미지 보존.
- STEP6 라이브 스모크: 샌드박스 OPENAI_API_KEY 없음 → 실호출 불가, 배포 후 사용자 환경 확인 필요.

## [autopilot] Stella GPT 사이드바 복원 + 관리자 메뉴 + 톤다운
- nav-baseline: 현재 index.html(line 196)에 8개 바로가기 존재(Clover만 누락), 6개는 .shortcut-admin로 관리자만 노출 → 일반 사용자에겐 GPT/Talk만 보여 "사라진" 것처럼 보임.
- 가정(이번 미션 우선): 앱 바로가기 9개를 **전원 노출**(.shortcut-admin 게이트 해제). 이전 "비관리자=GPT/Talk만" 요구는 이번 미션이 명시적으로 9개 노출을 지시하므로 대체.
- 복원: Stella Clover 외부 링크(https://stella-clover.vercel.app, target _blank) 추가 → GPT·Talk·DB·ABAP·Agent Code·Codex·Cloud·Hub·Clover 9개.
- 회원 승인: 기존 플로팅 FAB(approvalFab, user.role==='admin' 게이트, window.stellaOpenApproval) → 사이드바 하단 "관리자" 섹션의 .admin-only 메뉴로 이동(동일 stellaOpenApproval 연결). FAB는 CSS로 숨김. applyShortcutVisibility 셀렉터를 .admin-only로 변경. .admin-only{display:none} 기본 + admin이면 block.
- 관리자 판별: isStellaAdmin()=user.role==='admin'(yesblue0342). 서버 로그인 응답 isAdmin/role 사용.
- 테마: body.dark 클래스 + CSS 변수(--ink/--muted/--card/--line). app-ico는 grayscale 필터+body.dark invert로 라이트=검정/다크=흰색 자동. 🛡 회원 승인·🍀 Clover 모두 app-ico-wrap 모노크롬으로 통일(빨강/주황 제거). 업데이트 버튼 #b45309→var(--muted).
- 회귀 0: api/chat.js·lib/router.mjs·lib/exporters.mjs·js/stella-md.js 변경 없음(검색/복사/Excel·Word/렌더/body.route 유지).

## [autopilot] 0Program GitHub 이중 저장 + 수정 루프
- STEP A: Drive 0download 저장부 = api/cc/save-drive.js text 모드(saveTextToDrive). Agent Code(cc.html)·Codex(codex.html) **공유**(둘 다 /api/cc/save-drive 호출). ABAP은 현재 /api/chat만 써서 save-drive 미사용 → 같은 엔드포인트 호출 시 동일 이중저장 적용됨(추후 abap.html 저장 트리거 추가 가능).
- GitHub PAT: process.env.GITHUB_TOKEN 이미 존재(save-github.js·gh-proxy 사용). 재사용, 신규 키 없음.
- STEP B: lib/github-store.mjs(검증본) + saveToGitHubBootstrap(빈 레포 시 README로 main 생성 후 재시도).
- STEP C: save-drive text 모드에서 Drive 저장 직후 0Program upsert(await하되 try/catch로 비차단·실패 허용 → Drive/응답 무영향). 응답에 github:{saved,path}만(토큰 미노출).
- STEP D: save-drive에 action:"load-github" 추가 → programName으로 현재 소스 로드(수정 루프 enabler). 프론트는 programName=대화 제목(chat.title/cur.title)으로 전송 → 같은 대화=같은 path=upsert 수정 루프.
- STEP E: 빈 레포 부트스트랩(README 초기 커밋).
- 경로 규칙: toRepoPath(programName, ext="txt", dir="src") → src/<name>.txt. 가정: ext 기본 txt(소스가 .txt로 Drive와 일치), programName 미전송 시 header→app→타임스탬프.
- STEP G 스모크: 샌드박스 GITHUB_TOKEN 없음 → 실제 PUT/update 미검증, 배포 후 사용자 환경에서 확인 필요(런 계속).

## [autopilot] 이미지 직접 분석(Vision) 수정
작업: [x]A진단 [x]B vision-format.mjs [x]C 포맷교정 [x]D 비전모델보장 [x]E 용량가드 [x]F OCR폴백정리 [x]G 테스트 [x]H 스모크/sw/push
- STEP A 진단(확정):
  - 호출부: api/chat.js — Stella GPT(루트, body.route=true)→callResponses(/v1/responses, gpt-4o), ABAP/Codex(route 미전송)→callOpenAI(/v1/chat/completions), Claude 모델→callClaude(/v1/messages).
  - 현 포맷은 **API별로 이미 일치**: Responses=`{type:"input_image",image_url:"<dataurl 문자열>"}`(line17), Chat=`{type:"image_url",image_url:{url}}`(line788), Claude=`{type:"image",source:{base64}}`(line818). → 단순 포맷 불일치는 아님.
  - **실제 유력 원인**: routed(GPT) 경로가 이미지가 있어도 `search:useSearch`로 **web_search 툴을 동시 첨부**(line469·22). 비전 요청에 web_search가 켜지면 모델이 검색/툴 흐름으로 빠져 빈/거부성 출력 → 프론트 isRefusalOrEmpty()가 OCR 폴백 발동. + 텍스트전용 모델 선택 시 비전모델 미보장.
  - OCR 폴백 순서: 프론트(index/abap)는 이미 callApi(true)[직접비전] 먼저 → 거부/빈 응답일 때만 callApi(false)[OCR]. 폴백 자체는 정상, 직접 비전이 우선 동작하도록 백엔드를 정리.
- 가정: 포맷 불일치 회귀 방지 + web_search-on-image 제거 + ensureVisionModel + 용량가드로 직접 비전 우선 동작. 신규 우회 아키텍처 없음.

## [autopilot] 복사 버튼 테마 대응(다크=흰색 / 라이트=블렌드)
작업: [x]A 복사버튼 위치/스코프 확정 [x]B index/abap .copy-btn·.url-copy 테마 CSS [x]C jsdom 검증 [x]D sw +1·커밋·push
- 대상 버튼: 코드블록/표 "복사" 핀(.copy-btn) + URL 옆 📋(.url-copy). stella-md.js와 각 앱 renderMarkdownLite가 생성.
- 스코프 확정: 이 버튼들을 실제 렌더하는 앱은 index.html(Stella GPT)·abap.html 둘뿐(codex/cc/talk/db/hub는 미렌더). gpt.html은 .msgCopyBtn(별개 답변복사)로 범위 밖.
- 가정: "다크=흰색, 라이트=주변과 동일/눈에 안 띄게" → 라이트는 저대비(반투명 슬레이트, opacity .5)로 블렌드+hover시 또렷, 다크는 흰색 핀. 코드블록은 라이트에서도 어두운 배경이라 hover로 사용성 보전.

## [autopilot] Stella Talk 개선(요일/백그라운드 알람)
TODO:
- [x] T1 날짜 구분선에 KST 요일 표시(한국날짜 기준 요일) — lib/kst-date.js kstWeekday/kstDateLabel + talk.html 날짜 구분선
- [x] T2 백그라운드 Web Push(VAPID): 앱 안 열어도 메시지 알림 — lib/push-util.js(순수) + api/push-subscribe.js(구독 저장/공개키) + chat-room send 훅(env 게이트) + talk.html 구독 + sw push payload 정렬
- [x] T3 테스트(kst-date/push-util .test.js) + sw +1 + 커밋/push
- 분석: sendMsg는 이미 즉시 서버 POST(전송 지연 아님). 미수신 원인=수신측 포그라운드 폴링(3s)만 동작→앱 닫히면 알림 없음. 정석=서버 Web Push(VAPID).
- 가정: VAPID 키(VAPID_PUBLIC_KEY/PRIVATE_KEY)는 현재 Vercel env에 없음 → 푸시 경로는 **키 있을 때만 동작(없으면 완전 무해 no-op)**. 키 추가 시 활성. web-push 의존성 추가(빌드시 설치), 키 없는 샌드박스/현행 prod엔 영향 0. 순수 헬퍼만 단위테스트.
