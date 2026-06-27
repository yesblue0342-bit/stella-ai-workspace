# BLOCKERS — 무인 모드에서 진행 불가/보류한 항목

> 무인(비대화) 실행 중 막힌 항목을 기록. 질문 대신 가장 합리적인 판단을 적고 다음으로 넘어감.

## [2026-06-27] AUTOPILOT TODO#1 — "OCI Postgres(pg) 전환" : 의도적 미수행(보류)
- 사실관계: 메타데이터 DB는 이미 Azure SQL(클라우드)에서 **OCI 동거 MSSQL 컨테이너(stella-mssql)**로 이관 완료(드라이버 `mssql`, `.env` DB_SERVER=stella-mssql). 2026-06-25 PROGRESS.md에 "메타데이터 표준=OCI 동거 stella-mssql, Azure 폐기"가 **사용자 결정**으로 명시됨.
- 판단: TODO#1이 가정한 "아직 Azure SQL에 남아있으면 pg로 전환"의 전제가 거짓. auto-pause 근본원인은 self-host 컨테이너 전환으로 이미 해소. pg 전환은 api/·lib/ 수십 파일의 T-SQL(MERGE/NVARCHAR/SYSUTCDATETIME/sql.* 바인딩) 전면 재작성으로 **고위험·무가치**이며 사용자 결정과 충돌.
- 실제 수행: TODO#1의 남은 actionable = **연결 재시도 + 풀 재연결(resilience)** → 완료(커밋 ea9146b, lib/db.js 자가치유 풀 + test/db-resilience.test.js).
- 재개 조건: 사용자가 명시적으로 "MSSQL→Postgres 전환"을 다시 지시할 때만.

## [2026-06-27] AUTOPILOT TODO#3 — "Whisper 음성인식 정확도" : 보류([!])
- 사실관계: 저장소 전체에 음성 파이프라인 부재(whisper/transcribe/MediaRecorder/getUserMedia/`/api/transcribe` 검색 0건). 본 repo는 "AI Meeting & Voice Workspace"가 아니라 멀티앱 워크스페이스(GPT챗·ABAP·카톡형 챗·GitHub/Drive·에이전트코드).
- 판단: 부착할 STT 코드가 없어 language=ko 고정·청크 오버랩·오디오 정규화 등을 적용할 대상이 없음. 없는 기능을 무인 모드에서 통째로 날조하는 것은 검증 불가·고위험이라 금지.
- 재개 조건: 음성 녹음/전사 기능이 실제로 추가되거나, 해당 코드 위치를 사용자가 지정할 때.

## [2026-06-27] AUTOPILOT TODO#4 — "키워드·요약(타임스탬프 구간별 구조화)" : 부분 보류([!])
- 사실관계: 일반 요약/대화는 api/chat.js·gpt 경로에 존재하나, TODO#4가 요구한 "회의 트랜스크립트의 타임스탬프 구간별 소제목+불릿" 출력은 **입력(전사 트랜스크립트)** 자체가 없음(TODO#3과 동일 원인).
- 판단: 트랜스크립트 없이 구간 요약/키워드 추출 단계를 추가하는 것은 동작 검증 불가. 일반 GPT 요약 프롬프트 개선은 투기적이라 보류.
- 재개 조건: 음성/회의 전사 산출물이 생기면 맵-리듀스 요약 + 키워드 추출 단계를 별도 .js 모듈로 추가.

## TODO#2 — "업로드 안정화" : 완료(참고)
- 막힘 없음. Whisper 청크가 아니라 **실제 존재하는 Drive resumable 업로드**에 매핑하여 적용(커밋 741610c, lib/resumable-upload.js + talk.html). 청크 상한 상향 검토는 OCI 본문한도(25MB)에서 현 임계값(3MB→resumable)이 안전하므로 추가 변경 불요.
