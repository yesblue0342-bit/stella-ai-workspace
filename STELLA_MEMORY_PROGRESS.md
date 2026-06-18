# Stella Memory — Build Progress (안 3: Azure 교체, 중복 0)
☑ lib/memory-db.mjs (Azure 백엔드, 자동스키마, graceful, ESM)
☑ api/profile/{save,load}.js
☑ api/memory/{save,search,update,extract}.js
☑ api/chat/history.js
☑ chat.js: Azure 메모리 우선 주입 + 추출 메모리 Azure 기록 (Drive 폴백 유지)
☑ js/stella-memory.js (승인 UX/관리, 별도 .js) + index.html 스크립트 태그
☑ db/04_schema.sql (참조)
☑ tests/test_memory.mjs (graceful 16/16)
☑ 서비스워커 버전 상승
☑ 시크릿 스캔
☐ (운영) Azure env 설정 후 실제 엔드포인트 스모크 + Drive 경로 제거
— 미구현(중복이라 의도적 제외): 새 인증(lib/auth.js), api/files/*(파일탐색기 기존 존재)
