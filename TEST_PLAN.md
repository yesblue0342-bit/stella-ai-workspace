# Stella Workspace 동기화 — 테스트 계획

대상: 크로스-디바이스(휴대폰↔PC) 동기화. SSOT=Google Drive. 엔진=`lib/sync-engine.js`.

## 시나리오
| ID | 시나리오 | 기대 결과 | 자동화 위치 |
|----|----------|-----------|-------------|
| S1 | 생성 전파: A에서 채팅/노트/프로젝트/게시글 생성 → B 새로고침 | B에 그대로 보임 | `test/sync-engine.test.js` 통합 2-device (S1) |
| S2 | 수정 전파: A 수정 → B | LWW(updatedAt)로 최신 반영 | 통합(S2), `mergeById: LWW` |
| S3 | 삭제 전파: A 삭제 → B | 사라지고 **부활 안 함**(tombstone) | 통합(S3), `tombstone: 삭제 전파/부활금지` |
| S4 | 중복 없음: 양쪽 번갈아 동기화 반복 | 항목 수 안 늘어남(append 회귀 차단) | 통합(S4), `mergeById 멱등` |
| S5 | 재로그인 보존: 로그아웃→로그인 | 데이터 유실 0 | (클라 통합 단계에서 추가 — count 보존 회귀) |
| S6 | 오프라인→온라인 | 변경이 온라인 복귀 시 Drive 반영 | (재시도 큐 구현 단계에서 추가) |
| S7 | 마이그레이션 멱등: dedupe 2회 | 2회차 no-op | `dedupe: 멱등` |

## 단위 테스트 (엔진)
- `mergeById`: id upsert(중복 없음), 멱등 반복, LWW 최신 채택.
- tombstone: 삭제 전파/부활 금지, 더 최신 편집은 삭제를 이김(정상 LWW).
- `pruneTombstones`: 30일 경과 tombstone만 정리.
- `deterministicId`/`ensureIds`: 같은 내용→같은 id(디바이스 무관, 멱등).
- `dedupe`: 동일 내용 1개로 병합(메시지 많은 것 보존), 다른 내용은 유지, 멱등.

## 실행
```bash
npm test          # node --test test/*.test.js
```

## 남은(클라이언트/서버 통합) 검증 — 후속 반복
- index.html을 엔진 기반 pull/merge/push로 전환 후 S1·S2·S5를 실제 흐름으로 재검증.
- 삭제 tombstone 전환 후 S3을 실제 deleteRoom/deletePost 경로로 검증.
- dedupe 마이그레이션 엔드포인트 실행 전/후 카운트를 TEST_RESULTS.md에 기록.
