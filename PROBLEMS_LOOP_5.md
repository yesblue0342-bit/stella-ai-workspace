# Loop 5 — 발견된 문제 (2026-07-02, 미커버 영역 진단)

Loop 1에서 세션 한도로 미완료였던 **에러 처리 · 배포 구조**와 추가로 **응답 흐름**을
병렬 진단(에이전트 19개) + 발견별 적대적 검증. 총 16건 발견, **14건 확정**, 2건 반박 기각.
(배포 영역 에이전트는 서버 오류로 실패 → 메인 세션에서 직접 점검, 확정 문제 없음.)

## 🔴 심각도 높음 (확정·수정)
1. **[api/download.js:52] 무가드 스트림 파이프 → 프로세스 전체 크래시** — `Readable.fromWeb(body).pipe(res)`가
   소스 'error' 리스너가 없어, 대용량(40MB+) 전송 중 Drive 연결이 끊기면 uncaughtException으로
   Node 프로세스 전체가 죽어 모든 앱의 진행 중 요청이 동시 중단. (process.on 핸들러 전무)
2. **[api/chat-room.js:116,165] 읽기 오류 삼킴 → 대화방 전체 영구 소실** — `readJsonFromDrive(...).catch(()=>null)`가
   '파일 없음'과 '실제 오류(429/5xx/토큰/JSON손상)'를 혼동. 전송 시 기존 방을 "없음"으로 오인해
   메시지 1개짜리로 덮어써 대화 전체·멤버·메타가 사라지고 ok:true 반환. talk.html이 매 전송마다 호출.
7. **[index.html:1172] Claude 모델 채팅 이중 과금** — 클라가 항상 SSE 시도하지만 서버 Claude 분기는
   stream:true를 무시(비스트리밍) → 스트림 실패 판정 → 폴백 callApi가 같은 Claude 호출을 재실행.
8. **[js/chat-stream.js:64] 스트림 중단 무표시** — 부분 델타 후 서버 오류로 끊겨도 잘린 답을 완결처럼
   저장·표시(silent truncation).
9. **[js/fetch-retry.js:10] 90초 타임아웃 + POST 자동 재시도 vs 서버 290초 가드** — 90초 넘는 답변마다
   사용자엔 실패로 보이면서 서버는 모델 호출을 최대 3회 유료 실행.

## 🟡 심각도 중간 (확정·수정)
3. **[api/drive-diagnostics.js:7] 무인증 공개 엔드포인트가 OAuth 시크릿 일부 노출** — describeSecret가
   GOOGLE_CLIENT_SECRET/REFRESH_TOKEN의 prefix+suffix(최대 18자)+정확한 길이를 익명 호출자에게 노출.
4. **[api/gh-file.js:45] zip 스트리밍 중 오류 시 응답 무한 대기 + 잘린 zip** — 헤더 전송 후 오류면 jsonErr가
   ERR_HTTP_HEADERS_SENT를 던져 응답이 안 닫히고 클라는 잘린 zip을 정상 다운로드로 오인.
5. **[api/auth.js:182] 회원가입 중복확인이 Drive 오류 삼킴 → 기존 계정 비번 덮어쓰기 가능** — 중복확인이
   오류를 null(중복없음)로 처리해 fail-open. 기존 계정 파일을 새 가입 데이터로 덮어쓸 수 있음(계정 탈취).
6. **[api/note.js:72] 저장소 완전 불통인데 ok:true+0건 반환 → 장애를 "노트 없음"으로 오인**.
12. **[lib/router.mjs:31] extractText가 첫 message만 읽음** — web_search 인터리빙으로 응답이 여러 message로
    나뉘면 최종 답변 텍스트를 통째로 누락(유료 응답인데 빈 문자열/일부만 반환).

## 🟢 심각도 낮음 / 이번 루프 보류 (moderate 위험, 다음 루프)
- **[index.html:1171] 비전 폴백 센티넬 오탐** — isRefusalOrEmpty에 '응답을 생성하지 못했습니다' 미포함 +
  hasOcr를 retry 후 계산해 OCR 텍스트 없어도 무의미한 2차 호출. (moderate 위험 → 별도 검증 후)
- **[index.html:1172] 현재 질문 이중 전송** — history 마지막 항목 + message 필드로 같은 질문 2번 전송.
- **[api/chat.js:598] 스트리밍 답변에 Drive 출처 푸터 누락** — driveRead 메타가 SSE로 안 넘어감(서버+클라 협응 필요).

## 반박 기각(수정 안 함)
- server.mjs:92 top-level catch가 raw 에러 에코 — 이미 sk- 마스킹 + 개인 프로젝트 맥락으로 위험도 낮음.
- api/health.js DB 호스트/에러 노출 — 의도된 진단 트레이드오프(운영자용), 별도 판단.

## 배포 영역 직접 점검 결과 (확정 문제 없음)
- .env.example에 필수 키 전부 존재(누락처럼 보인 건 fallback 별칭/deprecated/test 전용).
- 커밋된 실시크릿 없음(git grep 확인).
- Dockerfile `--omit=dev` + .dockerignore가 test/*.md 제외 → jsdom 런타임 불필요(정합).
- HEALTHCHECK가 `/`(시크릿 없는 정적 루트) → 정합.

총 확정: 14건 (즉시 수정 10건 / 보류 3건 / 배포 0건, refuted 2건)
