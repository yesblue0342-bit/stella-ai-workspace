# RESULTS — Stella 메모리 시스템 (Azure SQL 교체, 안 3)

실행 시각: 2026-06-18 13:36:35 UTC · node v22.22.2

## 정적 검증 (node --check)
- lib/memory-db.mjs, api/profile/{save,load}.js, api/memory/{save,search,update,extract}.js,
  api/chat/history.js, api/chat.js, js/stella-memory.js(브라우저), sw.js — 전부 통과.

## 스모크 — tests/test_memory.mjs (DB 미연결 graceful)
```
PASS  buildMemoryContext → '' (no throw)
PASS  searchMemory → []
PASS  loadProfile → null
PASS  saveMemory(no DB) → ok:false (graceful)
PASS  saveMemory(빈) → 거절
PASS  listChatHistory → []
PASS  saveChatHistory(no chat_id) → 거절
PASS  updateMemory(no id) → 거절
PASS  핸들러 응답(no throw): ../api/profile/load.js [GET]
PASS  핸들러 응답(no throw): ../api/profile/save.js [POST]
PASS  핸들러 응답(no throw): ../api/memory/save.js [POST]
PASS  핸들러 응답(no throw): ../api/memory/search.js [GET]
PASS  핸들러 응답(no throw): ../api/memory/update.js [POST]
PASS  핸들러 응답(no throw): ../api/memory/extract.js [POST]
PASS  핸들러 응답(no throw): ../api/chat/history.js [GET]
PASS  핸들러 응답(no throw): ../api/chat/history.js [POST]

총 16건: 16 PASS / 0 FAIL
```
종료코드: 0

## 배포 후 사용자 확인(외부 의존 — Azure/OpenAI 필요)
- Vercel 환경변수: AZURE_SQL_* (이미 lib/db.js가 읽음), OPENAI_API_KEY, OPENAI_MEMORY_MODEL.
- T2 profile save/load, T4 memory save+dedupe, T8 ai/chat에 메모리 주입은 **배포 환경에서 실값 확인**.
- Azure 미설정이어도 채팅은 정상(메모리만 빈값) — graceful 확인 완료.

## 총합
- 스모크: 총 16건: 16 PASS / 0 FAIL
- 시크릿 노출: 0
