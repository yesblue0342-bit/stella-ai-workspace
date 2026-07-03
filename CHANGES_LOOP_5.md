# Loop 5 — 변경사항 (2026-07-02, 에러 처리·응답 흐름 확정 10건 수정)

## 서버 에러 처리 (프로세스 안정성 · 데이터 소실 · 보안)
### api/download.js
- `Readable.fromWeb(body).pipe(res)` → `await pipeline(...)`(node:stream/promises)로 교체.
  전송 중 Drive 스트림 오류가 unhandled 'error' → uncaughtException으로 **프로세스 전체가
  죽던** 위험 제거. 오류 시 `res.destroy()`로 소켓만 정리.

### api/chat-room.js (send / invite)
- 방 읽기 `.catch(()=>null)` 제거 → try/catch로 '파일 없음(null)'과 '실제 오류(throw)'를 구분.
  오류 시 **503**("채팅방을 잠시 읽지 못했습니다") 반환 → 기존 방을 "없음"으로 오인해 메시지
  1개짜리로 덮어써 **대화 전체가 소실되던** 버그 차단.

### api/auth.js (signup)
- 중복확인을 fail-closed로 전환(`readUserStrict`가 저장소 오류를 rethrow). 오류 시 **503** →
  기존 계정 파일을 새 가입 데이터로 덮어써 **비밀번호가 교체(계정 탈취)되던** 위험 차단.

### api/note.js (list)
- collectNotes에 errors 누적 추가. 모든 소스 조회 실패 + 결과 0건이면 **503**("노트 저장소를
  읽지 못했습니다") → 저장소 장애를 "노트 없음"으로 오인하지 않게.

### api/gh-file.js (zip 스트리밍)
- catch에서 `res.headersSent` 분기 추가 → 스트리밍 중 오류면 `res.destroy()`로 소켓 파기.
  ERR_HTTP_HEADERS_SENT로 응답이 무한 대기하고 잘린 zip을 정상 다운로드로 오인하던 문제 해소.

### lib/drive-utils.js (describeSecret)
- 무인증 공개 엔드포인트 `/api/drive-diagnostics`가 노출하던 GOOGLE_CLIENT_SECRET/REFRESH_TOKEN의
  **prefix/suffix 제거**(존재 여부·길이만). clientId(공개값)·folderId(URL 오설정 진단)는 유지.

## 응답 흐름 (비용 · 정확성)
### index.html send()
- **Claude 모델은 스트리밍을 시도하지 않도록** 가드 추가 — 서버가 stream:true를 무시하는
  Claude 경로에서 스트림 실패 판정 → 폴백이 **같은 Claude 호출을 재실행하던 이중 과금** 제거.
- 폴백 callApi의 fetch에 `{timeoutMs:300000, retries:0}` 지정 — 90초 타임아웃+자동 재시도로
  느린 답변마다 사용자엔 실패, 서버는 **최대 3회 유료 호출**하던 문제 해소.
- 스트림 truncated 시 토스트로 사용자에게 중단 안내.

### js/chat-stream.js
- 스트림 fetch에 `{timeoutMs:300000, retries:0}` 지정(재시도 POST 이중 호출 방지).
- 부분 델타 후 서버 오류로 끊기면 잘린 답에 중단 표시 부착 + `truncated:true` 반환
  (비스트리밍 재요청으로 이중 과금하지 않음).

### lib/router.mjs (extractText)
- `.find(첫 message)` → 모든 message 아이템의 output_text를 순서대로 이어붙임.
  web_search 인터리빙으로 응답이 여러 message로 나뉠 때 **최종 답변을 통째로 놓치던** 버그 수정.

## 테스트
- test/loop5-fixes.test.js(신규 7종): drive-diagnostics 시크릿 미노출, download pipeline 가드,
  chat-room 503 계약, auth fail-closed 계약, note 503 계약, gh-file headersSent 계약.
- test/router.test.mjs: extractText 다중 message 결합 + output_text 우선 2종 추가.
- test/chat-stream.test.js: 부분델타 후 에러 → truncated 표시, 스트림 cfg(300s/재시도0) 2종 추가.
- 전체 회귀: **266/266 PASS**(기존 258 + 신규 8).

## 보류(다음 루프, moderate 위험)
- index.html 비전 폴백 센티넬(#11), 현재 질문 이중 전송(#13), 스트리밍 Drive 출처 푸터(#14).
