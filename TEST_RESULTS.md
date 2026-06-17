# Stella Workspace 동기화 — 테스트 결과

## 1. 동기화 엔진 (`lib/sync-engine.js`) — 단위/통합

실행: `npm test` (`node --test test/*.test.js`)

```
# tests 12
# pass 12
# fail 0
```

| # | 테스트 | 시나리오 | 결과 |
|---|--------|----------|------|
| 1 | mergeById id upsert (중복 누적 없음) | S4 회귀차단 | PASS |
| 2 | mergeById 반복 병합 멱등 | S4 | PASS |
| 3 | mergeById LWW(updatedAt) 최신 채택 | S2 | PASS |
| 4 | tombstone 삭제 전파/부활 금지 | S3 | PASS |
| 5 | 더 최신 편집은 삭제를 이김(정상 LWW) | S2/S3 | PASS |
| 6 | pruneTombstones 30일 경과만 정리 | 유지보수 | PASS |
| 7 | deterministicId 멱등 | S7/마이그레이션 | PASS |
| 8 | ensureIds 결정적 id 부여/기존 보존 | 마이그레이션 | PASS |
| 9 | dedupe 동일내용 1개 병합 + 멱등 | S7 | PASS |
| 10 | dedupe 다른 내용 미병합 | 안전성 | PASS |
| 11 | 통합 2-device 생성/수정/삭제/중복없음 | S1~S4 | PASS |
| 12 | 통합 레거시 id없는 데이터 동일 id 수렴 | 마이그레이션 | PASS |

### before/after (재현 → 수정)
- **before(현행 index.html 로직)**: 삭제 시 `syncToServer` count-guard가 저장을 차단 → 서버에 삭제 미반영
  → 로드 시 add-only 병합이 재추가 → **부활/중복**. (FINDINGS 참조: `index.html:424`, `:896/:968`)
- **after(엔진)**: 통합 테스트 #11에서 삭제(tombstone)가 양 디바이스로 전파되고, 5회 반복 동기화에도
  가시 항목 0 유지, drive 레코드 1개(tombstone)만 — **부활/중복 없음**.

## 2. 마이그레이션 전/후 카운트 — (후속 반복)
실데이터 dedupe 마이그레이션 엔드포인트 실행 후 아래 표를 채운다.

| 엔티티 | 전 | 후 | 중복 제거 |
|--------|----|----|-----------|
| 채팅 | 65 | (TBD) | (TBD) |
| 노트 | (TBD) | (TBD) | (TBD) |
| 프로젝트 | (TBD) | (TBD) | (TBD) |
| 게시글 | (TBD) | (TBD) | (TBD) |

## 3. 동기화 로그 흐름 — (클라 통합 후 첨부)
pull → mergeById → push 의 구조적 로그를 캡처하여 첨부 예정.

> 현 반복 범위: 검증 가능한 **동기화 코어 엔진 + 테스트 + 근본원인 확정**. 클라이언트/서버 배선과
> 실데이터 마이그레이션은 PROGRESS.md의 남은 체크리스트에서 이어서 진행.

---

# Stella Talk 백로그 — PART E (첨부 KST 날짜별 Drive 보관)

실행: `npm test` (`node --test test/*.test.js`)

```
# tests 19   # pass 19   # fail 0
```

## KST 날짜 유틸 (`lib/kst-date.js`) — 7/7 PASS
| 테스트 | 결과 |
|--------|------|
| UTC→KST(+9) 변환 | PASS |
| **KST 자정 경계** (UTC 15:00 = KST 익일 00:00, 14:59:59 = 당일) | PASS |
| 연/월 경계도 KST 기준 (연말·2월말) | PASS |
| 형식 zero-pad (YYYY-MM-DD) | PASS |
| 잘못된 입력 throw | PASS |
| familyPhotoPath 경로 배열 | PASS |
| familyPhotoPathNow KST 날짜 경로 | PASS |

## 서버 보관 (`api/drive-upload.js`, `archiveFamily`) — 코드완료/실Drive검증대기
- 업로드 후 `0가족/1_사진/stella talk/[KST날짜]`로 `drive.files.copy` 사본 생성.
- 경로 폴더 없으면 루트('root')부터 자동 생성(`ensureFamilyDateFolder`).
- 동일 이름 파일이 그 날짜 폴더에 이미 있으면 복사 스킵(중복 방지).
- `node --check` 통과. 실제 Drive 저장은 OAuth2 자격증명 필요 → 배포 후 실계정으로 확인.
- 인수조건 매핑: KST 자정 경계/경로 생성/중복 방지 = 유닛테스트 검증, 실 저장 = 실검증대기.

> 나머지 백로그(A 인증, B 친구, C1~C6, D)는 TASKS.md에 상태 기록. 다음 Ralph 반복에서 진행.
