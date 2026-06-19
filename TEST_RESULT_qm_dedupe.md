# QM 폴더 중복 제거 — 이름 키 기반 dedupe/merge 테스트 결과

대상: `index.html`(Stella GPT) + `abap.html`(Stella ABAP). 두 앱은 같은 출처 localStorage `K.projects`를 공유.

## 원인 판별
- 이전 증분의 `dedupeById`(같은 id 중복만 제거)로도 QM가 남음 → **두 QM은 id가 다른 별개 레코드**.
- 발생 경로: `loadProjectsFromDrive`가 서버 프로젝트를 **id 기준으로만** 추가 → 다른 기기에서 만든 같은 이름 QM(다른 id)을 **두 번째 폴더로 생성**(cross-device 중복).

## 수정 (핵심 = 이름 키)
**고유 키 = `projKey(name)` = `trim + 소문자 + 연속공백 1칸`.**
1. **load 시 dedupe+merge** (`loadData`): `dedupeProjectsByName(projects, rooms)` — 같은 키는 1개만 유지하고, **사라지는 폴더의 채팅(room)을 남는 폴더 id로 repoint**(item id 기준 union, 유실 0). 병합 발생 시 정리본 자가치유 저장.
2. **생성 시 재사용** (`createProject`): 같은 키 폴더가 있으면 새로 만들지 않고 **기존 폴더 재사용**(활성화만).
3. **Drive 동기화 시 키 가드** (`loadProjectsFromDrive`): 같은 키 서버 폴더는 추가하지 않고 `_remap[serverId]=localId`로 기록 → 복원되는 채팅의 `projectId`를 remap으로 보정 → 끝에 `dedupeProjectsByName` 최종 정리.
4. 저장 직렬화(`saveProjects`)는 in-메모리 deduped 목록을 기록 → 키 유일성 영속화.
5. index.html·abap.html 동일 적용(모바일/PC + cross-device 통일).

## 테스트 결과 (PASS/FAIL)
| # | 케이스 | 기대 | 결과 |
|---|--------|------|------|
| 1 | index.html 인라인 JS 문법 | 0 에러 | ✅ PASS |
| 2 | abap.html 인라인 JS 문법 | 0 에러 | ✅ PASS |
| 3 | 두 QM(다른 id)+채팅 → **QM 1개**로 병합 | 1개 | ✅ PASS |
| 4 | 다른 폴더(PP) 보존 | 유지 | ✅ PASS |
| 5 | QM 채팅 **union 보존(누락 0)** — r1,r2(p1)+r3(p2)=3개 | 3개·총 room수 불변 | ✅ PASS |
| 6 | p2 참조 채팅(r3) → 유지된 QM id로 **repoint** | repoint | ✅ PASS |
| 7 | `projKey` 정규화(대소문자/연속공백) | 동일 키 | ✅ PASS |
| 8 | "Sales Order" vs "sales   order" → 1개 | 1개 | ✅ PASS |
| 9 | 같은 이름 **재생성 시도 → 중복 안 생김**(기존 재사용) | 재사용·1개 | ✅ PASS |

**합계: 9 PASS / 0 FAIL** (로직 유닛테스트 7건 + 양 파일 문법 2건)

## 동작 요약 (사용자 관점)
- 다음 로드 시 기존 QM 2개 → **1개로 자동 병합**, 채팅 항목 **모두 유지**(union, 누락 0).
- 같은 이름 폴더를 다시 만들려 하면 **기존 폴더로 들어감**(중복 생성 차단).
- 다른 기기에서 같은 이름 폴더가 동기화돼도 **이름 키로 1개로 합쳐짐**.

## 한계 (정직)
- 배포 보호(403)로 라이브 브라우저 검증 불가 → 인라인 JS `new Function` + **dedupe/merge 로직 유닛테스트**로 검증.
- 실제 사용자 데이터는 배포 후 앱을 한 번 열면 `loadData`에서 자동 병합·저장됨. 서버측(workspace_state) 정리는 다음 saveProjects 동기화 시 반영.
